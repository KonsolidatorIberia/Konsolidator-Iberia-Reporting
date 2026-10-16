/* ══════════════════════════════════════════════════════════════════════
   Ficha de empresa (panel lateral): datos, propiedad, estructuras, mapeo
   de cuentas e historial. Los cambios con fecha abren las operaciones.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Building2, PieChart, Network, Link2, History, Save, Loader2, ArrowRightLeft, GitBranch, LogOut, Plus, Crown, Lock, CalendarClock,
} from "lucide-react";
import { ccyColor, initials } from "../structureShared.js";
import { coversDate, saveEntity, setFunctionalCurrency, loadAudit, parseLedgerError, addDays } from "./studioApi.js";
import { fmtPctN, fmtDate, errorText } from "./studioText.js";
import { Field, ErrorLine } from "./StudioDialogs.jsx";
import { Timeline } from "./StudioViews.jsx";
import { eventItems } from "./studioModel.js";
import st from "./studio.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");
const TABS = [
  { id: "data", icon: Building2, key: "drawer_data" },
  { id: "ownership", icon: PieChart, key: "drawer_ownership" },
  { id: "structures", icon: Network, key: "drawer_structures" },
  { id: "mapping", icon: Link2, key: "drawer_mapping" },
  { id: "history", icon: History, key: "drawer_history" },
];
const lastDay = (to) => (to ? addDays(to, -1) : null);
const byFrom = (a, b) => String(b._range.from).localeCompare(String(a._range.from));

function RangeCell({ tx, r, date }) {
  const on = (!r.from || r.from <= date) && (!r.to || date < r.to);
  return (
    <span className={cx(st.range, on && st.rangeOn)}>
      {fmtDate(r.from, tx.lang)} → {r.to ? fmtDate(lastDay(r.to), tx.lang) : tx("open_end")}
      {on && <em>{tx("current")}</em>}
    </span>
  );
}

export default function EntityDrawer({ tx, data, companyId, entityId, perimeter, structure, date, canEdit, users, onClose, onAction, onChanged, notify }) {
  const ent = data.entities.find(e => e.id === entityId);
  const [tab, setTab] = useState("data");
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector("[role=dialog][aria-modal=true]")) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!ent) return null;
  const p = perimeter.find(x => x.entity_id === entityId);
  const cc = ccyColor(p?.functional_currency || ent.currency);
  return createPortal(
    <div className={st.drawerWrap}>
      <div className={st.drawerScrim} onMouseDown={onClose} />
      <aside className={st.drawer} aria-label={ent.code}>
        <header className={st.drawerHead}>
          <span className={st.bandAv} style={{ "--cc": cc }}>{initials(ent.code)}</span>
          <div className={st.drawerTitle}>
            <h3>{ent.code}{p?.classification === "parent" && <Crown size={13} className={st.crown} />}</h3>
            <p>{ent.legal_name || "—"}</p>
            <div className={st.drawerTags}>
              <span className={st.tagCcy} style={{ "--cc": cc }}>{p?.functional_currency || ent.currency}</span>
              {p ? <span className={cx(st.cls, st[`cls_${p.classification}`])}>{tx(`cls_${p.classification}`)}</span>
                : <span className={st.tagSoft}>{tx("not_in_structure")}</span>}
              {p && p.classification !== "parent" && <span className={st.tagSoft}>{tx("col_effective")}: <b>{fmtPctN(p.effective_pct, tx.lang)} %</b></span>}
              {!canEdit && <span className={st.tagSoft}><Lock size={10} />{tx("read_only")}</span>}
            </div>
          </div>
          <button type="button" className={st.iconBtn} onClick={onClose} aria-label={tx("close")}><X size={16} /></button>
        </header>
        <nav className={st.drawerTabs}>
          {TABS.map(t => (
            <button key={t.id} type="button" className={cx(st.drawerTab, tab === t.id && st.drawerTabOn)} onClick={() => setTab(t.id)}>
              <t.icon size={13} />{tx(t.key)}
            </button>
          ))}
        </nav>
        <div className={st.drawerBody}>
          {tab === "data" && <DataTab key={ent.id} tx={tx} data={data} ent={ent} companyId={companyId} date={date} canEdit={canEdit} users={users} onChanged={onChanged} notify={notify} />}
          {tab === "ownership" && <OwnershipTab tx={tx} data={data} ent={ent} p={p} date={date} canEdit={canEdit} onAction={onAction} />}
          {tab === "structures" && <StructuresTab tx={tx} data={data} ent={ent} structure={structure} date={date} canEdit={canEdit} onAction={onAction} />}
          {tab === "mapping" && <MappingTab tx={tx} data={data} ent={ent} date={date} />}
          {tab === "history" && <HistoryTab tx={tx} data={data} ent={ent} companyId={companyId} users={users} />}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/* ── Datos ────────────────────────────────────────────────────────────── */
function DataTab({ tx, data, ent, companyId, date, canEdit, users, onChanged, notify }) {
  const [f, setF] = useState(() => ({ ...ent, tags: (ent.tags ?? []).join(", ") }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fc, setFc] = useState({ date, currency: "" });
  const [fcBusy, setFcBusy] = useState(false);
  const set = (k, up) => (e) => setF(p => ({ ...p, [k]: up ? e.target.value.toUpperCase() : e.target.value }));
  const versions = data.currencies.filter(c => c.entity_id === ent.id).sort(byFrom);
  const dis = !canEdit;
  const dirty = ["code", "legal_name", "country", "tax_id", "currency", "entity_type", "start_date", "end_date", "data_source", "data_owner"]
    .some(k => String(f[k] ?? "") !== String(ent[k] ?? "")) || f.tags !== (ent.tags ?? []).join(", ");

  const save = async () => {
    if (!String(f.code).trim() || !String(f.currency).trim()) { setErr(tx("e_required")); return; }
    setBusy(true); setErr("");
    try {
      await saveEntity(companyId, { ...f, tags: String(f.tags ?? "").split(",").map(s => s.trim()).filter(Boolean) });
      notify(tx("saved")); onChanged();
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setBusy(false); }
  };
  const changeFc = async () => {
    if (!fc.date || !/^[A-Z]{3}$/.test(fc.currency)) { setErr(tx("e_required")); return; }
    setFcBusy(true); setErr("");
    try {
      await setFunctionalCurrency({ companyId, entityId: ent.id, date: fc.date, currency: fc.currency });
      notify(tx("saved")); setFc({ date, currency: "" }); onChanged();
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setFcBusy(false); }
  };

  return (
    <div className={st.drawerSection}>
      <div className={st.grid2}>
        <Field label={tx("f_code")} hint={tx("f_code_hint")} required wide>
          <input className={st.input} disabled={dis} value={f.code ?? ""} onChange={set("code", true)} />
        </Field>
        <Field label={tx("f_legal_name")} wide>
          <input className={st.input} disabled={dis} value={f.legal_name ?? ""} onChange={set("legal_name")} />
        </Field>
        <Field label={tx("f_country")}>
          <input className={st.input} disabled={dis} maxLength={2} value={f.country ?? ""} onChange={set("country", true)} />
        </Field>
        <Field label={tx("f_tax_id")}>
          <input className={st.input} disabled={dis} value={f.tax_id ?? ""} onChange={set("tax_id")} />
        </Field>
        <Field label={tx("f_currency")} hint={tx("f_currency_hint")} required>
          <input className={st.input} disabled={dis} maxLength={3} value={f.currency ?? ""} onChange={set("currency", true)} />
        </Field>
        <Field label={tx("f_type")}>
          <select className={st.input} disabled={dis} value={f.entity_type ?? "company"} onChange={set("entity_type")}>
            {["company", "branch", "adjustment"].map(k => <option key={k} value={k}>{tx(`type_${k}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("f_start")} hint={tx("f_start_hint")}>
          <input type="date" className={st.input} disabled={dis} value={f.start_date ?? ""} onChange={set("start_date")} />
        </Field>
        <Field label={tx("f_end")} hint={tx("f_end_hint")}>
          <input type="date" className={st.input} disabled={dis} value={f.end_date ?? ""} onChange={set("end_date")} />
        </Field>
        <Field label={tx("f_source")}>
          <select className={st.input} disabled={dis} value={f.data_source ?? ""} onChange={set("data_source")}>
            <option value="">{tx("none")}</option>
            {["erp", "excel", "api"].map(k => <option key={k} value={k}>{tx(`src_${k}`)}</option>)}
          </select>
        </Field>
        <Field label={tx("f_owner")}>
          <select className={st.input} disabled={dis} value={f.data_owner ?? ""} onChange={set("data_owner")}>
            <option value="">{tx("none")}</option>
            {[...users.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
        <Field label={tx("f_tags")} hint={tx("f_tags_hint")} wide>
          <input className={st.input} disabled={dis} value={f.tags ?? ""} onChange={set("tags")} />
        </Field>
      </div>
      {canEdit && (
        <div className={st.cardFoot}>
          <button type="button" className={st.btnPrimary} disabled={busy || !dirty} onClick={save}>
            {busy ? <Loader2 size={14} className={st.spin} /> : <Save size={14} />}{tx("save")}
          </button>
        </div>
      )}

      <h4 className={st.subHead}><CalendarClock size={13} />{tx("f_functional")}</h4>
      <p className={st.hint}>{tx("f_functional_hint")}</p>
      <ul className={st.versionList}>
        {versions.length === 0 && <li><span className={st.range}>{tx("same_as_local")}</span><b>{ent.currency}</b></li>}
        {versions.map(v => <li key={v.id ?? v.valid}><RangeCell tx={tx} r={v._range} date={date} /><b>{v.functional_currency}</b></li>)}
      </ul>
      {canEdit && (
        <div className={st.inlineForm}>
          <span className={st.fieldLabel}>{tx("f_change_functional")}</span>
          <input type="date" className={st.input} value={fc.date} onChange={e => setFc(p => ({ ...p, date: e.target.value }))} />
          <input className={cx(st.input, st.inputCcy)} placeholder="USD" maxLength={3} value={fc.currency} onChange={e => setFc(p => ({ ...p, currency: e.target.value.toUpperCase() }))} />
          <button type="button" className={st.btnGhost} disabled={fcBusy} onClick={changeFc}>{fcBusy && <Loader2 size={13} className={st.spin} />}{tx("apply")}</button>
        </div>
      )}
      <ErrorLine text={err} />
    </div>
  );
}

/* ── Propiedad ────────────────────────────────────────────────────────── */
function OwnList({ tx, rows, code, date, side }) {
  if (!rows.length) return <p className={st.hint}>{tx("no_ownership")}</p>;
  return (
    <table className={st.miniTable}>
      <thead><tr><th>{tx(side === "held" ? "holder" : "held")}</th><th>{tx("version_from")} → {tx("version_to")}</th><th className={st.num}>{tx("economic")}</th><th className={st.num}>{tx("voting")}</th></tr></thead>
      <tbody>
        {rows.map(o => (
          <tr key={o.id} className={coversDate(o, date) ? st.rowOn : st.rowMuted}>
            <td><b>{code.get(side === "held" ? o.holder_entity_id : o.held_entity_id) ?? "?"}</b>{o.holder_entity_id === o.held_entity_id && <small className={st.mute}> ({tx("treasury")})</small>}</td>
            <td><RangeCell tx={tx} r={o._range} date={date} /></td>
            <td className={st.num}>{fmtPctN(o.economic_pct, tx.lang)} %</td>
            <td className={st.num}>{fmtPctN(o.voting_pct, tx.lang)} %</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function OwnershipTab({ tx, data, ent, p, date, canEdit, onAction }) {
  const code = useMemo(() => new Map(data.entities.map(e => [e.id, e.code])), [data.entities]);
  const heldBy = data.ownerships.filter(o => o.held_entity_id === ent.id).sort(byFrom);
  const holds = data.ownerships.filter(o => o.holder_entity_id === ent.id && o.held_entity_id !== ent.id).sort(byFrom);
  return (
    <div className={st.drawerSection}>
      {p && p.classification !== "parent" && (
        <div className={st.kpiRow}>
          <div><small>{tx("col_direct")}</small><b>{fmtPctN(p.direct_pct, tx.lang)} %</b></div>
          <div><small>{tx("col_voting")}</small><b>{fmtPctN(p.group_voting_pct, tx.lang)} %</b></div>
          <div><small>{tx("col_effective")}</small><b>{fmtPctN(p.effective_pct, tx.lang)} %</b></div>
          <div><small>{tx("col_minority")}</small><b>{fmtPctN(p.minority_pct, tx.lang)} %</b></div>
        </div>
      )}
      <div className={st.subHeadRow}>
        <h4 className={st.subHead}>{tx("held_by")}</h4>
        {canEdit && <button type="button" className={st.btnGhost} onClick={() => onAction("operation", { entity_id: ent.id })}><ArrowRightLeft size={13} />{tx("record_operation")}</button>}
      </div>
      <OwnList tx={tx} rows={heldBy} code={code} date={date} side="held" />
      <div className={st.subHeadRow}>
        <h4 className={st.subHead}>{tx("holds")}</h4>
        {canEdit && <button type="button" className={st.btnGhost} onClick={() => onAction("operation", { holder_id: ent.id })}><Plus size={13} />{tx("record_operation")}</button>}
      </div>
      <OwnList tx={tx} rows={holds} code={code} date={date} side="holder" />
    </div>
  );
}

/* ── Estructuras ──────────────────────────────────────────────────────── */
function StructuresTab({ tx, data, ent, structure, date, canEdit, onAction }) {
  const code = new Map(data.entities.map(e => [e.id, e.code]));
  return (
    <div className={st.drawerSection}>
      {data.structures.map(s => {
        const vs = data.nodes.filter(n => n.structure_id === s.id && n.entity_id === ent.id).sort(byFrom);
        const cur = vs.find(n => coversDate(n, date));
        const isCurrent = structure?.id === s.id;
        return (
          <div key={s.id} className={cx(st.structBlock, isCurrent && st.structBlockOn)}>
            <div className={st.subHeadRow}>
              <h4 className={st.subHead}><Network size={13} />{s.name}{s.is_primary && <span className={st.tagRoot}>{tx("primary")}</span>}</h4>
              {canEdit && isCurrent && (
                <span className={st.rowActionsOn}>
                  <button type="button" className={st.btnGhost} onClick={() => onAction("node", { entity_id: ent.id })}>
                    {cur ? <GitBranch size={13} /> : <Plus size={13} />}{tx(cur ? "change_parent_method" : "add_to_structure")}
                  </button>
                  {cur && cur.parent_entity_id && <button type="button" className={cx(st.btnGhost, st.btnGhostDanger)} onClick={() => onAction("exit", { entity_id: ent.id })}><LogOut size={13} />{tx("exit_perimeter")}</button>}
                </span>
              )}
            </div>
            {vs.length === 0 ? <p className={st.hint}>{tx("not_in_this_structure")}</p> : (
              <table className={st.miniTable}>
                <thead><tr><th>{tx("version_from")} → {tx("version_to")}</th><th>{tx("col_parent")}</th><th>{tx("col_class")}</th><th>{tx("col_method")}</th></tr></thead>
                <tbody>
                  {vs.map(n => (
                    <tr key={n.id} className={coversDate(n, date) ? st.rowOn : st.rowMuted}>
                      <td><RangeCell tx={tx} r={n._range} date={date} /></td>
                      <td>{n.parent_entity_id ? code.get(n.parent_entity_id) : <span className={st.tagRoot}><Crown size={10} /></span>}</td>
                      <td>{tx(`cls_${n.classification}`)}</td>
                      <td className={st.mute}>{tx(`mth_${n.method}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Mapeo de cuentas ─────────────────────────────────────────────────── */
function MappingTab({ tx, data, ent, date }) {
  const stName = new Map(data.structures.map(s => [s.id, s.name]));
  const vs = data.mappings.filter(m => m.entity_id === ent.id).sort(byFrom);
  return (
    <div className={st.drawerSection}>
      <p className={st.hint}>{tx("mapping_hint")}</p>
      {vs.length === 0 ? <p className={st.emptyMini}><Link2 size={16} />{tx("no_mapping_yet")}</p> : (
        <table className={st.miniTable}>
          <thead><tr><th>{tx("version_from")} → {tx("version_to")}</th><th>{tx("structure")}</th><th className={st.num}>{tx("col_accounts")}</th></tr></thead>
          <tbody>
            {vs.map(m => (
              <tr key={m.id} className={coversDate(m, date) ? st.rowOn : st.rowMuted}>
                <td><RangeCell tx={tx} r={m._range} date={date} />{m.name && <small className={st.mute}> {m.name}</small>}</td>
                <td>{m.structure_id ? stName.get(m.structure_id) : tx("all_structures")}</td>
                <td className={st.num}>{tx("lines_n", { n: m.lines })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Historial de la empresa ──────────────────────────────────────────── */
function HistoryTab({ tx, data, ent, companyId, users }) {
  const [audit, setAudit] = useState(null);
  useEffect(() => {
    let off = false;
    loadAudit(companyId, ent.id, 100).then(r => { if (!off) setAudit(r); }).catch(() => { if (!off) setAudit([]); });
    return () => { off = true; };
  }, [companyId, ent.id]);
  const items = useMemo(() => {
    const ev = eventItems(tx, data, { entityId: ent.id }).map(i => ({ ...i, entityId: null }));
    const au = (audit ?? []).filter(a => a.table_name === "entities" || a.table_name === "entity_currencies").map(a => {
      const changed = a.action === "update" && a.old_row && a.new_row
        ? Object.keys(a.new_row).filter(k => !["updated_at", "updated_by"].includes(k) && JSON.stringify(a.new_row[k]) !== JSON.stringify(a.old_row[k]))
        : [];
      return { key: `a${a.id}`, kind: "audit", at: a.at, by: a.actor, title: `${tx(`tbl_${a.table_name}`)} · ${tx(`aud_${a.action}`)}`,
        text: changed.map(k => `${k}: ${a.old_row[k] ?? "—"} → ${a.new_row[k] ?? "—"}`).join(" · "), tone: "flat" };
    });
    return [...ev, ...au].sort((x, y) => String(y.at).localeCompare(String(x.at)));
  }, [tx, data, ent.id, audit]);
  return <div className={st.drawerSection}><Timeline tx={tx} items={items} users={users} /></div>;
}
