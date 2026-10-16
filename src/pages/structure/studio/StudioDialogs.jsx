/* ══════════════════════════════════════════════════════════════════════
   Ventanas de las estructuras propias: operaciones con fecha (compra,
   venta…), alta de empresa, cambios en la estructura, salida del
   perímetro y crear o editar una estructura.
   Ninguna edita filas: todas llaman a operaciones con fecha.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ArrowRightLeft, Building2, GitBranch, LogOut, Network, Lightbulb } from "lucide-react";
import {
  recordOwnership, setNode, exitNode, saveEntity, createStructure, updateStructure,
  coversDate, parseLedgerError, todayIso,
} from "./studioApi.js";
import { CLASSES, METHODS, EVENTS, suggestByVoting, fmtPctN, errorText } from "./studioText.js";
import st from "./studio.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");

/* ── Base ─────────────────────────────────────────────────────────────── */
export function Modal({ title, intro, icon: Icon, children, footer, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={st.overlay} onMouseDown={onClose}>
      <div className={cx(st.modal, wide && st.modalWide)} role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <header className={st.modalHead}>
          <div className={st.modalTitle}>
            {Icon && <span className={st.modalIco}><Icon size={17} /></span>}
            <div><h3>{title}</h3>{intro && <p>{intro}</p>}</div>
          </div>
          <button type="button" className={st.iconBtn} onClick={onClose} aria-label="×"><X size={16} /></button>
        </header>
        <div className={st.modalBody}>{children}</div>
        {footer && <footer className={st.modalFoot}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children, required, wide }) {
  return (
    <label className={cx(st.field, wide && st.fieldWide)}>
      <span className={st.fieldLabel}>{label}{required && <i className={st.req}>*</i>}</span>
      {children}
      {hint && <small className={st.fieldHint}>{hint}</small>}
    </label>
  );
}

export function EntitySelect({ entities, value, onChange, allowEmpty, emptyLabel, exclude = [] }) {
  return (
    <select className={st.input} value={value ?? ""} onChange={e => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {!allowEmpty && !value && <option value="" disabled>—</option>}
      {entities.filter(e => !exclude.includes(e.id)).map(e => (
        <option key={e.id} value={e.id}>{e.code}{e.legal_name ? ` · ${e.legal_name}` : ""}</option>
      ))}
    </select>
  );
}

export function Footer({ tx, busy, onCancel, onOk, okLabel, okDisabled, danger }) {
  return (
    <>
      <button type="button" className={st.btnGhost} onClick={onCancel}>{tx("cancel")}</button>
      <button type="button" className={cx(st.btnPrimary, danger && st.btnDanger)} disabled={busy || okDisabled} onClick={onOk}>
        {busy && <Loader2 size={14} className={st.spin} />}{okLabel}
      </button>
    </>
  );
}

export function ErrorLine({ text }) {
  return text ? <p className={st.formError} role="alert">{text}</p> : null;
}

// % de voto del grupo en una participada a una fecha (todas las tenedoras del perímetro)
function groupVoting(ownerships, perimeterIds, heldId, date, except) {
  return ownerships
    .filter(o => o.held_entity_id === heldId && o.holder_entity_id !== heldId && coversDate(o, date)
      && perimeterIds.has(o.holder_entity_id) && !(except && o.holder_entity_id === except))
    .reduce((s, o) => s + Number(o.voting_pct || 0), 0);
}

/* ── Registrar una operación sobre una participación ──────────────────── */
export function OperationDialog({ tx, data, companyId, structure, perimeter, date: date0, preset = {}, onDone, onClose }) {
  const [event, setEvent] = useState(preset.event ?? "purchase");
  const [date, setDate] = useState(date0 ?? todayIso());
  const [holderId, setHolder] = useState(preset.holderId ?? null);
  const [heldId, setHeld] = useState(preset.heldId ?? null);
  const [economic, setEconomic] = useState("");
  const [voting, setVoting] = useState("");
  const [note, setNote] = useState("");
  const [effect, setEffect] = useState(null);
  const [cls, setCls] = useState(null);
  const [method, setMethod] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Si el segundo paso falla, el reintento no vuelve a registrar la operación
  const [recorded, setRecorded] = useState(null);

  const before = useMemo(() => data.ownerships.find(o => o.holder_entity_id === holderId && o.held_entity_id === heldId && coversDate(o, date)), [data.ownerships, holderId, heldId, date]);
  const perimeterIds = useMemo(() => new Set(perimeter.map(p => p.entity_id)), [perimeter]);
  const node = useMemo(() => structure && heldId ? data.nodes.find(n => n.structure_id === structure.id && n.entity_id === heldId && coversDate(n, date)) : null, [data.nodes, structure, heldId, date]);
  const vAfter = voting === "" ? Number(economic || 0) : Number(voting);
  const gv = heldId ? groupVoting(data.ownerships, perimeterIds, heldId, date, holderId) + (perimeterIds.has(holderId) ? vAfter : 0) : 0;
  const sug = suggestByVoting(gv);
  const exitLike = ["sale", "loss_of_control", "liquidation", "merger"].includes(event);
  // Por defecto: sale del perímetro solo si el grupo se queda sin voto en ella; las acciones propias no tocan la estructura
  const treasury = holderId && holderId === heldId;
  const effectiveEffect = effect ?? (!structure || treasury ? "keep" : node && gv <= 0 ? "exit" : node || Number(economic || 0) > 0 ? "apply" : "keep");
  const effCls = cls ?? (node && !exitLike ? node.classification : sug.classification);
  const effMethod = method ?? (node && !exitLike ? node.method : sug.method);

  const submit = async () => {
    if (!holderId || !heldId || !date || economic === "") { setErr(tx("e_required")); return; }
    setBusy(true); setErr("");
    try {
      const sig = JSON.stringify({ holderId, heldId, date, economic, voting, event });
      if (recorded !== sig) {
        await recordOwnership({ companyId, holderId, heldId, date, economic, voting, event, note });
        setRecorded(sig);
      }
      if (structure && effectiveEffect === "exit" && node) {
        await exitNode({ structureId: structure.id, entityId: heldId, date, note });
      } else if (structure && effectiveEffect === "apply" && !(node && node.classification === effCls && node.method === effMethod)) {
        // Si ya está en la estructura conserva su matriz; si entra ahora, cuelga de la tenedora
        const parent = node ? node.parent_entity_id : holderId;
        await setNode({ structureId: structure.id, entityId: heldId, date, parentId: parent, classification: effCls, method: effMethod,
          subMethod: node?.sub_method, assocMethod: node?.assoc_method, note });
      }
      onDone(tx("op_saved"));
    } catch (e) {
      setErr(errorText(tx, parseLedgerError(e)));
    } finally { setBusy(false); }
  };

  return (
    <Modal title={tx("op_title")} intro={tx("op_intro")} icon={ArrowRightLeft} onClose={onClose}
      footer={<Footer tx={tx} busy={busy} onCancel={onClose} onOk={submit} okLabel={tx("record_operation")} />}>
      <div className={st.grid2}>
        <Field label={tx("op_type")} required>
          <select className={st.input} value={event} onChange={e => setEvent(e.target.value)}>
            {EVENTS.map(ev => <option key={ev} value={ev}>{tx(`ev_${ev}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("op_date")} hint={tx("op_date_hint")} required>
          <input type="date" className={st.input} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label={tx("op_holder")} required>
          <EntitySelect entities={data.entities} value={holderId} onChange={setHolder} />
        </Field>
        <Field label={tx("op_held")} required>
          <EntitySelect entities={data.entities} value={heldId} onChange={setHeld} />
        </Field>
        <Field label={tx("op_pct_after")} required hint={before ? tx("op_before", { e: fmtPctN(before.economic_pct, tx.lang), v: fmtPctN(before.voting_pct, tx.lang) }) : null}>
          <input type="number" min="0" max="100" step="0.0001" className={st.input} value={economic} onChange={e => setEconomic(e.target.value)} />
        </Field>
        <Field label={tx("op_vote_after")} hint={tx("op_vote_hint")}>
          <input type="number" min="0" max="100" step="0.0001" className={st.input} value={voting} onChange={e => setVoting(e.target.value)} />
        </Field>
        <Field label={tx("op_note")} wide>
          <input className={st.input} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>

      {structure && heldId && (
        <div className={st.effectBox}>
          <p className={st.effectTitle}><Network size={14} />{tx("op_struct_effect", { s: structure.name })}</p>
          <div className={st.radioRow}>
            {["keep", "apply", ...(node ? ["exit"] : [])].map(k => (
              <label key={k} className={cx(st.radio, effectiveEffect === k && st.radioOn)}>
                <input type="radio" name="effect" checked={effectiveEffect === k} onChange={() => setEffect(k)} />
                {tx(k === "keep" ? "op_struct_keep" : k === "apply" ? "op_struct_apply" : "op_struct_exit")}
              </label>
            ))}
          </div>
          {effectiveEffect === "apply" && (
            <>
              <p className={st.suggest}><Lightbulb size={13} />{tx("op_suggest", { v: fmtPctN(gv, tx.lang), c: tx(`cls_${sug.classification}`), m: tx(`mth_${sug.method}`) })}</p>
              <div className={st.grid2}>
                <Field label={tx("node_class")}>
                  <select className={st.input} value={effCls} onChange={e => setCls(e.target.value)}>
                    {CLASSES.filter(c => c !== "parent").map(c => <option key={c} value={c}>{tx(`cls_${c}`)}</option>)}
                  </select>
                </Field>
                <Field label={tx("node_method")}>
                  <select className={st.input} value={effMethod} onChange={e => setMethod(e.target.value)}>
                    {METHODS.map(m => <option key={m} value={m}>{tx(`mth_${m}`)}</option>)}
                  </select>
                </Field>
              </div>
            </>
          )}
        </div>
      )}
      <ErrorLine text={err} />
    </Modal>
  );
}

/* ── Alta de empresa (y, si se quiere, en la estructura) ──────────────── */
export function AddCompanyDialog({ tx, data, companyId, structure, perimeter, date: date0, onDone, onClose }) {
  const empty = perimeter.length === 0;
  const [f, setF] = useState({ code: "", legal_name: "", currency: "EUR", country: "ES", entity_type: "company", start_date: date0 ?? todayIso() });
  const [place, setPlace] = useState(!!structure);
  const [asHead, setAsHead] = useState(empty);
  const [parentId, setParent] = useState(perimeter.find(p => p.depth === 0)?.entity_id ?? null);
  const [pct, setPct] = useState("100");
  const [vote, setVote] = useState("");
  const [first, setFirst] = useState("");
  const [cls, setCls] = useState(null);
  const [method, setMethod] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const [created, setCreated] = useState(null);
  const sug = suggestByVoting(vote === "" ? pct : vote);
  const effCls = asHead ? "parent" : cls ?? sug.classification;
  const effMethod = asHead ? "full" : method ?? sug.method;
  const firstDate = first || f.start_date;
  const inPerimeter = useMemo(() => data.entities.filter(e => perimeter.some(p => p.entity_id === e.id)), [data.entities, perimeter]);

  const submit = async () => {
    if (!f.code.trim() || !f.legal_name.trim() || !f.currency.trim() || !f.country.trim() || !f.start_date) { setErr(tx("e_required")); return; }
    if (place && !asHead && (!parentId || pct === "")) { setErr(tx("e_required")); return; }
    setBusy(true); setErr("");
    try {
      // Si un paso posterior falla, el reintento reutiliza la empresa ya creada
      const ent = created ?? await saveEntity(companyId, { ...f, code: f.code.trim().toUpperCase() });
      if (!created) setCreated(ent);
      if (place && structure) {
        if (!asHead && Number(pct) > 0 && !created?.owned) {
          await recordOwnership({ companyId, holderId: parentId, heldId: ent.id, date: firstDate, economic: pct, voting: vote,
            event: firstDate === f.start_date ? "incorporation" : "purchase" });
          setCreated({ ...ent, owned: true });
        }
        await setNode({ structureId: structure.id, entityId: ent.id, date: firstDate, parentId: asHead ? null : parentId,
          classification: effCls, method: effMethod });
      }
      onDone(tx("add_saved"));
    } catch (e) {
      setErr(errorText(tx, parseLedgerError(e)));
    } finally { setBusy(false); }
  };

  return (
    <Modal title={tx("add_title")} intro={tx("add_intro")} icon={Building2} onClose={onClose} wide
      footer={<Footer tx={tx} busy={busy} onCancel={onClose} onOk={submit} okLabel={tx("add_company")} />}>
      <div className={st.grid3}>
        <Field label={tx("f_code")} hint={tx("f_code_hint")} required>
          <input className={st.input} value={f.code} onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))} maxLength={30} autoFocus />
        </Field>
        <Field label={tx("f_legal_name")} required>
          <input className={st.input} value={f.legal_name} onChange={set("legal_name")} />
        </Field>
        <Field label={tx("f_type")}>
          <select className={st.input} value={f.entity_type} onChange={set("entity_type")}>
            {["company", "branch", "adjustment"].map(k => <option key={k} value={k}>{tx(`type_${k}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("f_currency")} hint={tx("f_currency_hint")} required>
          <input className={st.input} value={f.currency} onChange={e => setF(p => ({ ...p, currency: e.target.value.toUpperCase().slice(0, 3) }))} />
        </Field>
        <Field label={tx("f_country")} required>
          <input className={st.input} value={f.country} onChange={e => setF(p => ({ ...p, country: e.target.value.toUpperCase().slice(0, 2) }))} />
        </Field>
        <Field label={tx("f_start")} hint={tx("f_start_hint")} required>
          <input type="date" className={st.input} value={f.start_date} onChange={set("start_date")} />
        </Field>
      </div>

      {structure && (
        <div className={st.effectBox}>
          <label className={st.check}><input type="checkbox" checked={place} onChange={e => setPlace(e.target.checked)} />{tx("add_place", { s: structure.name })}</label>
          {place && (
            <>
              {empty && <label className={st.check}><input type="checkbox" checked={asHead} onChange={e => setAsHead(e.target.checked)} />{tx("add_as_head")}</label>}
              <div className={st.grid3}>
                {!asHead && (
                  <>
                    <Field label={tx("add_parent")} required>
                      <EntitySelect entities={inPerimeter} value={parentId} onChange={setParent} />
                    </Field>
                    <Field label={tx("add_pct")} required>
                      <input type="number" min="0" max="100" className={st.input} value={pct} onChange={e => setPct(e.target.value)} />
                    </Field>
                    <Field label={tx("voting")} hint={tx("op_vote_hint")}>
                      <input type="number" min="0" max="100" className={st.input} value={vote} onChange={e => setVote(e.target.value)} />
                    </Field>
                  </>
                )}
                <Field label={tx("add_first")}>
                  <input type="date" className={st.input} value={firstDate} onChange={e => setFirst(e.target.value)} />
                </Field>
                {!asHead && (
                  <>
                    <Field label={tx("node_class")}>
                      <select className={st.input} value={effCls} onChange={e => setCls(e.target.value)}>
                        {CLASSES.filter(c => c !== "parent").map(c => <option key={c} value={c}>{tx(`cls_${c}`)}</option>)}
                      </select>
                    </Field>
                    <Field label={tx("node_method")}>
                      <select className={st.input} value={effMethod} onChange={e => setMethod(e.target.value)}>
                        {METHODS.map(m => <option key={m} value={m}>{tx(`mth_${m}`)}</option>)}
                      </select>
                    </Field>
                  </>
                )}
              </div>
              {!asHead && <p className={st.suggest}><Lightbulb size={13} />{tx("op_suggest", { v: fmtPctN(vote === "" ? pct : vote, tx.lang), c: tx(`cls_${sug.classification}`), m: tx(`mth_${sug.method}`) })}</p>}
            </>
          )}
        </div>
      )}
      <ErrorLine text={err} />
    </Modal>
  );
}

/* ── Cambiar matriz, clasificación o método desde una fecha ───────────── */
export function NodeDialog({ tx, data, structure, perimeter, entityId, date: date0, onDone, onClose }) {
  const node = data.nodes.find(n => n.structure_id === structure.id && n.entity_id === entityId && coversDate(n, date0));
  const ent = data.entities.find(e => e.id === entityId);
  const [date, setDate] = useState(date0);
  const [parentId, setParent] = useState(node?.parent_entity_id ?? null);
  const [cls, setCls] = useState(node?.classification && node.classification !== "parent" ? node.classification : "subsidiary");
  const [method, setMethod] = useState(node?.method ?? "full");
  const [subM, setSubM] = useState(node?.sub_method ?? "full");
  const [assocM, setAssocM] = useState(node?.assoc_method ?? "equity");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Una empresa no puede colgar de sí misma ni de sus descendientes
  const descendants = useMemo(() => {
    const out = new Set([entityId]);
    let grew = true;
    while (grew) {
      grew = false;
      perimeter.forEach(p => { if (p.parent_entity_id && out.has(p.parent_entity_id) && !out.has(p.entity_id)) { out.add(p.entity_id); grew = true; } });
    }
    return out;
  }, [perimeter, entityId]);
  const candidates = data.entities.filter(e => perimeter.some(p => p.entity_id === e.id) && !descendants.has(e.id));

  const submit = async () => {
    if (!date) { setErr(tx("e_date_required")); return; }
    setBusy(true); setErr("");
    try {
      await setNode({ structureId: structure.id, entityId, date, parentId, classification: parentId ? cls : "parent", method: parentId ? method : "full",
        subMethod: subM, assocMethod: assocM, note });
      onDone(tx("node_saved"));
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setBusy(false); }
  };

  return (
    <Modal title={`${tx(node ? "node_title" : "add_to_structure")} · ${ent?.code ?? ""}`} intro={tx("node_intro")} icon={GitBranch} onClose={onClose}
      footer={<Footer tx={tx} busy={busy} onCancel={onClose} onOk={submit} okLabel={tx("save")} />}>
      <div className={st.grid2}>
        <Field label={tx("op_date")} required>
          <input type="date" className={st.input} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label={tx("node_parent")}>
          <EntitySelect entities={candidates} value={parentId} onChange={setParent} allowEmpty emptyLabel={tx("head_none")} />
        </Field>
        {parentId && (
          <>
            <Field label={tx("node_class")}>
              <select className={st.input} value={cls} onChange={e => setCls(e.target.value)}>
                {CLASSES.filter(c => c !== "parent").map(c => <option key={c} value={c}>{tx(`cls_${c}`)}</option>)}
              </select>
            </Field>
            <Field label={tx("node_method")}>
              <select className={st.input} value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m} value={m}>{tx(`mth_${m}`)}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label={tx("node_sub_method")}>
          <select className={st.input} value={subM} onChange={e => setSubM(e.target.value)}>
            {["full", "proportional"].map(m => <option key={m} value={m}>{tx(`mth_${m}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("node_assoc_method")}>
          <select className={st.input} value={assocM} onChange={e => setAssocM(e.target.value)}>
            {["equity", "proportional"].map(m => <option key={m} value={m}>{tx(`mth_${m}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("op_note")} wide>
          <input className={st.input} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>
      <ErrorLine text={err} />
    </Modal>
  );
}

export function ExitDialog({ tx, data, structure, entityId, date: date0, onDone, onClose }) {
  const ent = data.entities.find(e => e.id === entityId);
  const [date, setDate] = useState(date0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    try { await exitNode({ structureId: structure.id, entityId, date, note }); onDone(tx("node_saved")); }
    catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${tx("node_exit_title")} · ${ent?.code ?? ""}`} intro={tx("node_exit_intro", { s: structure.name })} icon={LogOut} onClose={onClose}
      footer={<Footer tx={tx} busy={busy} onCancel={onClose} onOk={submit} okLabel={tx("exit_perimeter")} danger />}>
      <div className={st.grid2}>
        <Field label={tx("op_date")} required>
          <input type="date" className={st.input} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label={tx("op_note")}>
          <input className={st.input} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>
      <ErrorLine text={err} />
    </Modal>
  );
}

/* ── Crear o editar una estructura ────────────────────────────────────── */
export function StructureDialog({ tx, companyId, structure, isFirst, onDone, onClose }) {
  const [name, setName] = useState(structure?.name ?? (isFirst ? "DefaultStructure" : ""));
  const [kind, setKind] = useState(structure?.kind ?? "legal");
  const [primary, setPrimary] = useState(structure?.is_primary ?? isFirst);
  const [description, setDescription] = useState(structure?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!name.trim()) { setErr(tx("e_required")); return; }
    setBusy(true); setErr("");
    try {
      const row = structure
        ? await updateStructure(companyId, structure.id, { name: name.trim(), kind, is_primary: primary, description: description || null })
        : await createStructure(companyId, { name, kind, isPrimary: primary, description: description || null });
      onDone(tx(structure ? "st_saved" : "st_created"), row);
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setBusy(false); }
  };
  return (
    <Modal title={tx(structure ? "edit_structure" : "new_structure")} icon={Network} onClose={onClose}
      footer={<Footer tx={tx} busy={busy} onCancel={onClose} onOk={submit} okLabel={tx("save")} />}>
      <div className={st.grid2}>
        <Field label={tx("st_name")} required>
          <input className={st.input} value={name} onChange={e => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={tx("st_kind")}>
          <select className={st.input} value={kind} onChange={e => setKind(e.target.value)}>
            {["legal", "management", "subconsolidation"].map(k => <option key={k} value={k}>{tx(`kind_${k}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("st_description")} wide>
          <input className={st.input} value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
      </div>
      <label className={st.check}><input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} />
        <span><b>{tx("st_primary")}</b><small>{tx("st_primary_hint")}</small></span>
      </label>
      <ErrorLine text={err} />
    </Modal>
  );
}
