/* ══════════════════════════════════════════════════════════════════════
   Importar la estructura desde Konsolidator o desde el Excel, con vista
   previa de los cambios antes de aplicarlos.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, FileSpreadsheet, Loader2, Upload, AlertTriangle, ChevronDown, ChevronRight, Plus, Minus, PenLine, Check, Download } from "lucide-react";
import { readKonsolidator, importStructure, parseLedgerError, addDays } from "./studioApi.js";
import { parseStructuresFile, diffImport, buildPayloads, exportStructures } from "./studioExcel.js";
import { errorText, fmtPctN, fmtDate } from "./studioText.js";
import { Modal, Field, Footer, ErrorLine } from "./StudioDialogs.jsx";
import st from "./studio.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");
const SHEET_KEY = { E: "xl_sheet_entities", O: "xl_sheet_ownership", S: "xl_sheet_structure", M: "xl_sheet_mapping" };

function DiffList({ items, render, tone }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const Icon = tone === "add" ? Plus : tone === "del" ? Minus : PenLine;
  return (
    <div className={st.diffList}>
      <button type="button" className={cx(st.diffToggle, st[`diff_${tone}`])} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Icon size={12} />{items.length}
      </button>
      {open && (
        <ul>
          {items.slice(0, 60).map((it, i) => <li key={i} className={st[`diff_${tone}`]}>{render(it)}</li>)}
          {items.length > 60 && <li className={st.mute}>+{items.length - 60}…</li>}
        </ul>
      )}
    </div>
  );
}

function DiffSection({ tx, title, part, render }) {
  const n = (part.added?.length ?? 0) + (part.changed?.length ?? 0) + (part.removed?.length ?? 0);
  return (
    <div className={st.diffCard}>
      <div className={st.diffHead}>
        <b>{title}</b>
        <span className={st.diffBadges}>
          {part.added?.length > 0 && <em className={st.diff_add}>{tx("imp_new")} {part.added.length}</em>}
          {part.changed?.length > 0 && <em className={st.diff_chg}>{tx("imp_changed")} {part.changed.length}</em>}
          {part.removed?.length > 0 && <em className={st.diff_del}>{tx("imp_removed")} {part.removed.length}</em>}
          <em className={st.diff_same}>{tx("imp_same")} {part.same ?? 0}</em>
        </span>
      </div>
      {n > 0 && (
        <div className={st.diffBody}>
          <DiffList items={part.added ?? []} render={render} tone="add" />
          <DiffList items={part.changed ?? []} render={render} tone="chg" />
          <DiffList items={part.removed ?? []} render={render} tone="del" />
        </div>
      )}
    </div>
  );
}

export default function ImportDialog({ tx, mode, token, data, companyId, onDone, onClose }) {
  const [kNames, setKNames] = useState([]);
  const [kChosen, setKChosen] = useState(null);
  const [kPayload, setKPayload] = useState(null);
  const [target, setTarget] = useState("");
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(mode === "konsolidator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);

  // Konsolidator: se lee al abrir y al cambiar de estructura de origen
  useEffect(() => {
    if (mode !== "konsolidator") return undefined;
    let off = false;
    Promise.resolve().then(() => { if (!off) { setReading(true); setErr(""); } });
    readKonsolidator(token, kChosen)
      .then(({ structureNames, payload }) => {
        if (off) return;
        setKNames(structureNames);
        setKPayload(payload);
        if (!kChosen) setKChosen(payload.structure?.name ?? null);
        setTarget(t => t || payload.structure?.name || "DefaultStructure");
        if (!structureNames.length) setErr(tx("imp_no_k"));
      })
      .catch(e => { if (!off) setErr(tx("imp_k_error", { e: e?.message ?? e })); })
      .finally(() => { if (!off) setReading(false); });
    return () => { off = true; };
  }, [mode, token, kChosen, tx]);

  const readFile = async (file) => {
    if (!file) return;
    setReading(true); setErr(""); setFileName(file.name);
    try {
      const r = await parseStructuresFile(file, tx, data.entities.map(e => e.code));
      if (r.error) { setErr(r.error); setParsed(null); return; }
      const known = new Set([...data.entities.map(e => e.code), ...r.entities.map(e => e.code)]);
      const missing = r.unknownCodes.filter(c => !known.has(c));
      missing.forEach(c => r.errors.push({ sheet: "E", row: "—", msg: tx("e_unknown_entity", { entity: c }) }));
      setParsed(r);
    } catch (e) { setErr(String(e?.message ?? e)); } finally { setReading(false); }
  };

  // Lo que se va a importar, en el formato común
  const view = useMemo(() => {
    if (mode === "konsolidator") {
      if (!kPayload) return null;
      const name = target.trim() || kPayload.structure.name;
      return {
        parsed: { entities: kPayload.entities, ownerships: kPayload.ownerships, nodes: kPayload.nodes.map(n => ({ ...n, structure: name })), mappings: [], errors: [] },
        structures: [name],
      };
    }
    if (!parsed) return null;
    return { parsed, structures: [...new Set(parsed.nodes.map(n => n.structure))] };
  }, [mode, kPayload, target, parsed]);
  const diff = useMemo(() => (view ? diffImport(data, view.parsed, view.structures) : null), [data, view]);
  const errors = view?.parsed.errors ?? [];
  const nothing = diff && !diff.entities.added.length && !diff.entities.changed.length && !diff.ownerships.added.length
    && !diff.ownerships.removed.length && !diff.nodes.added.length && !diff.nodes.removed.length && !diff.mappings;

  const apply = async () => {
    setBusy(true); setErr("");
    try {
      const primaryName = data.structures.find(s => s.is_primary)?.name ?? view.structures[0];
      const payloads = mode === "konsolidator"
        ? [{ ...kPayload, structure: { ...kPayload.structure, name: view.structures[0], is_primary: view.structures[0] === primaryName } }]
        : buildPayloads(view.parsed, "excel", primaryName);
      const tot = { entities: 0, ownerships: 0, nodes: 0, mappings: 0 };
      let firstId = null;
      for (const p of payloads) {
        const r = await importStructure(companyId, p);
        firstId = firstId ?? r?.structure_id ?? null;
        Object.keys(tot).forEach(k => { tot[k] += Number(r?.[k] ?? 0); });
      }
      onDone(tx("imp_done", { e: tot.entities, o: tot.ownerships, n: tot.nodes, m: tot.mappings }), firstId);
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setBusy(false); }
  };

  const fmtO = (o) => `${o.holder} → ${o.held} · ${fmtPctN(o.economic, tx.lang)} % · ${fmtDate(o.from, tx.lang)}${o.to ? ` – ${fmtDate(addDays(o.to, -1), tx.lang)}` : ""}`;
  const fmtN = (n) => `${n.entity}${n.parent ? ` ← ${n.parent}` : ""} · ${tx(`cls_${n.classification}`)} · ${tx(`mth_${n.method}`)} · ${fmtDate(n.from, tx.lang)}`;
  const fmtE = (e) => `${e.code} · ${e.legal_name ?? ""} · ${e.currency}${e.fields ? ` (${e.fields.join(", ")})` : ""}`;

  return (
    <Modal wide title={tx(mode === "konsolidator" ? "imp_title_k" : "imp_title_x")} intro={tx("imp_intro")}
      icon={mode === "konsolidator" ? Building2 : FileSpreadsheet} onClose={onClose}
      footer={<Footer tx={tx} busy={busy} onCancel={onClose} onOk={apply} okLabel={tx("imp_apply")}
        okDisabled={!view || reading || errors.length > 0 || nothing} />}>
      {mode === "konsolidator" && (
        <div className={st.grid2}>
          <Field label={tx("imp_source_structure")}>
            <select className={st.input} value={kChosen ?? ""} onChange={e => setKChosen(e.target.value)} disabled={reading || !kNames.length}>
              {kNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label={tx("imp_structure")}>
            <input className={st.input} value={target} onChange={e => setTarget(e.target.value)} list="studio-structs" />
            <datalist id="studio-structs">{data.structures.map(s => <option key={s.id} value={s.name} />)}</datalist>
          </Field>
        </div>
      )}
      {mode === "excel" && (
        <div className={cx(st.drop, drag && st.dropOn)}
          onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter") fileRef.current?.click(); }}>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => readFile(e.target.files?.[0])} />
          <Upload size={20} />
          <b>{fileName || tx("imp_pick_file")}</b>
          <button type="button" className={st.linkBtn} onClick={(e) => { e.stopPropagation(); exportStructures(data, tx, { template: true }); }}>
            <Download size={12} />{tx("download_template")}
          </button>
        </div>
      )}

      {reading && <p className={st.hint}><Loader2 size={14} className={st.spin} /> {tx("imp_reading")}</p>}

      {!reading && errors.length > 0 && (
        <div className={st.errorList}>
          <p><AlertTriangle size={14} />{tx("imp_errors")} ({errors.length})</p>
          <ul>
            {errors.slice(0, 40).map((e, i) => <li key={i}><b>{tx(SHEET_KEY[e.sheet] ?? "xl_sheet_entities")}</b> · {tx("imp_row", { r: e.row, msg: e.msg })}</li>)}
          </ul>
        </div>
      )}

      {!reading && diff && errors.length === 0 && (
        nothing ? <p className={st.okLine}><Check size={15} />{tx("imp_nothing")}</p> : (
          <div className={st.diffGrid}>
            <DiffSection tx={tx} title={tx("imp_entities")} part={diff.entities} render={fmtE} />
            <DiffSection tx={tx} title={tx("imp_ownerships")} part={diff.ownerships} render={fmtO} />
            <DiffSection tx={tx} title={`${tx("imp_nodes")} · ${view.structures.join(", ")}`} part={diff.nodes} render={fmtN} />
            {diff.mappings > 0 && <DiffSection tx={tx} title={tx("imp_mappings")} part={{ added: view.parsed.mappings, same: 0 }}
              render={m => `${m.entity} · ${m.structure || tx("all_structures")} · ${fmtDate(m.from, tx.lang)} · ${tx("lines_n", { n: m.lines.length })}`} />}
          </div>
        )
      )}
      <ErrorLine text={err} />
    </Modal>
  );
}
