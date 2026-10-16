/* ══════════════════════════════════════════════════════════════════════
   Vistas de las estructuras propias: ficha del grupo, barra de fecha con
   línea de tiempo, tabla en árbol del perímetro, avisos, empresas,
   configuración de grupo e historial.
   ══════════════════════════════════════════════════════════════════════ */
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronRight, ChevronLeft, ChevronDown, Crown, AlertTriangle, CheckCircle2, X, GitBranch, LogOut, ArrowRightLeft,
  Building2, Lock, Unlock, CalendarRange, Coins, Hash, Save, Loader2, History, Network, ShieldCheck, Link2, Link2Off,
  CalendarDays, FileClock, Search, FileSpreadsheet,
} from "lucide-react";
import { ccyColor, initials } from "../structureShared.js";
import { coversDate, todayIso, addDays, saveSettings, generatePeriods, setMonthLocked, loadAudit, parseLedgerError } from "./studioApi.js";
import { fmtPctN, fmtDate, errorText } from "./studioText.js";
import { groupWarnings, perimeterTree, eventItems } from "./studioModel.js";
import { Field } from "./StudioDialogs.jsx";
import st from "./studio.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");
const pctOrDash = (n, lang) => (n == null ? "—" : `${fmtPctN(n, lang)} %`);

/* ── Ficha del grupo ──────────────────────────────────────────────────── */
export function GroupBand({ tx, perimeter, warnings, structure, date, onWarnings }) {
  const head = perimeter.find(p => p.classification === "parent") ?? perimeter.find(p => p.depth === 0);
  const rest = perimeter.filter(p => p !== head);
  const consolidated = rest.filter(p => p.method !== "none");
  const avg = consolidated.length ? consolidated.reduce((s, p) => s + Number(p.effective_pct ?? 0), 0) / consolidated.length : 0;
  const withMin = rest.filter(p => Number(p.minority_pct ?? 0) > 0).length;
  const ccys = [...new Set(perimeter.map(p => p.functional_currency || p.local_currency).filter(Boolean))];
  const levels = perimeter.length ? Math.max(...perimeter.map(p => p.depth ?? 0)) + 1 : 0;
  const cc = ccyColor(head?.functional_currency || head?.local_currency);
  return (
    <section className={st.band}>
      <div className={st.bandId}>
        <span className={st.bandAv} style={{ "--cc": cc }}>{initials(head?.code)}</span>
        <div className={st.bandName}>
          <h2 title={head?.legal_name ?? ""}>{head?.legal_name || head?.code || tx("title")}</h2>
          <p>
            {head && <span className={st.tagRoot}><Crown size={11} />{head.code}</span>}
            {head?.local_currency && <span className={st.tagCcy} style={{ "--cc": cc }}>{head.functional_currency || head.local_currency}</span>}
            {structure && <span className={st.tagSoft}><Network size={11} />{structure.name}</span>}
            <span className={st.tagSoft}><CalendarDays size={11} />{fmtDate(date, tx.lang)}</span>
          </p>
        </div>
      </div>
      <div className={st.bandStats}>
        <div className={st.bStat}>
          <b>{perimeter.length}</b><span>{tx("in_perimeter")}</span>
          <span className={st.bMeter}><i style={{ width: `${perimeter.length ? (consolidated.length + (head ? 1 : 0)) / perimeter.length * 100 : 0}%` }} /></span>
        </div>
        <div className={st.bStat}><b>{fmtPctN(avg, tx.lang)}%</b><span>{tx("avg_effective")}</span></div>
        <div className={st.bStat}><b>{withMin}</b><span>{tx("minorities")}</span></div>
        <div className={st.bStat}>
          <b>{ccys.length}</b><span>{tx("currencies")}</span>
          <span className={st.bCcys}>{ccys.slice(0, 5).map(c => <i key={c} style={{ "--cc": ccyColor(c) }}>{c}</i>)}</span>
        </div>
        <div className={st.bStat}><b>{levels}</b><span>{tx("levels")}</span></div>
        <button type="button" className={cx(st.bStat, st.bStatBtn, warnings.length ? st.bStatWarn : st.bStatOk)} onClick={onWarnings}>
          {warnings.length ? <><b>{warnings.length}</b><span><AlertTriangle size={12} />{tx("warnings")}</span></>
            : <><b><CheckCircle2 size={20} /></b><span>{tx("all_good")}</span></>}
        </button>
      </div>
    </section>
  );
}

/* ── Fecha de consulta y línea de tiempo de cambios ───────────────────── */
export function DateBar({ tx, date, setDate, changeDates, yearEndMonth = 12 }) {
  const today = todayIso();
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  const y = Number(today.slice(0, 4));
  const yeCandidate = (yy) => addDays(yearEndMonth === 12 ? `${yy + 1}-01-01` : `${yy}-${String(yearEndMonth + 1).padStart(2, "0")}-01`, -1);
  const lastYearEnd = yeCandidate(y) < today ? yeCandidate(y) : yeCandidate(y - 1);
  const prev = [...changeDates].reverse().find(d => d < date);
  const next = changeDates.find(d => d > date);
  const lo = changeDates[0] ?? date;
  const hi = [changeDates[changeDates.length - 1] ?? date, today, date].sort().pop();
  const span = Math.max(1, (new Date(hi) - new Date(lo)) / 86400000);
  const at = (d) => Math.min(100, Math.max(0, ((new Date(d) - new Date(lo)) / 86400000) / span * 100));
  return (
    <div className={st.dateBar}>
      <span className={st.dateLabel}><CalendarDays size={13} />{tx("as_of")}</span>
      <div className={st.dateCtl}>
        <button type="button" className={st.iconBtn} disabled={!prev} onClick={() => prev && setDate(prev)} title={prev ? fmtDate(prev, tx.lang) : ""}><ChevronLeft size={15} /></button>
        <input type="date" className={st.dateInput} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
        <button type="button" className={st.iconBtn} disabled={!next} onClick={() => next && setDate(next)} title={next ? fmtDate(next, tx.lang) : ""}><ChevronRight size={15} /></button>
      </div>
      <div className={st.quick}>
        {[["today", today], ["month_end", lastMonthEnd], ["year_end", lastYearEnd]].map(([k, d]) => (
          <button key={k} type="button" className={cx(st.chip, date === d && st.chipOn)} onClick={() => setDate(d)}>{tx(k)}</button>
        ))}
      </div>
      <div className={st.timeline} title={tx("changes_on")}>
        <span className={st.tlTrack} />
        {changeDates.length === 0 && <span className={st.tlEmpty}>{tx("no_changes")}</span>}
        {changeDates.map(d => (
          <button key={d} type="button" className={cx(st.tlDot, d === date && st.tlDotOn, d > today && st.tlDotFuture)}
            style={{ left: `${at(d)}%` }} onClick={() => setDate(d)} aria-label={fmtDate(d, tx.lang)}>
            <span className={st.tlTip}>{fmtDate(d, tx.lang)}</span>
          </button>
        ))}
        <span className={st.tlNow} style={{ left: `${at(date)}%` }} />
      </div>
    </div>
  );
}

/* ── Tabla en árbol ───────────────────────────────────────────────────── */
export function TreeTable({ tx, perimeter, canEdit, onOpen, onAction, warningsBy }) {
  const { kids, roots } = useMemo(() => perimeterTree(perimeter), [perimeter]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (id) => setCollapsed(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = [];
  const walk = (p, level, seen) => {
    if (seen.has(p.entity_id)) return;
    seen.add(p.entity_id);
    rows.push({ p, level });
    if (!collapsed.has(p.entity_id)) (kids.get(p.entity_id) ?? []).forEach(k => walk(k, level + 1, seen));
  };
  const seen = new Set();
  roots.forEach(r => walk(r, 0, seen));
  const withKids = perimeter.filter(p => (kids.get(p.entity_id) ?? []).length).map(p => p.entity_id);

  if (!perimeter.length) return <div className={st.emptyInline}><Network size={22} /><p>{tx("no_structure_at_date")}</p></div>;
  return (
    <div className={st.tableWrap}>
      <div className={st.tableTools}>
        <button type="button" className={st.linkBtn} onClick={() => setCollapsed(new Set())}>{tx("expand_all")}</button>
        <button type="button" className={st.linkBtn} onClick={() => setCollapsed(new Set(withKids))}>{tx("collapse_all")}</button>
      </div>
      <table className={st.table}>
        <thead>
          <tr>
            <th className={st.thCompany}>{tx("col_company")}</th>
            <th>{tx("col_class")}</th>
            <th>{tx("col_method")}</th>
            <th className={st.num}>{tx("col_direct")}</th>
            <th className={st.num}>{tx("col_voting")}</th>
            <th className={st.num}>{tx("col_effective")}</th>
            <th className={st.num}>{tx("col_minority")}</th>
            <th>{tx("col_currency")}</th>
            <th>{tx("col_since")}</th>
            <th className={st.center}>{tx("col_mapping")}</th>
            {canEdit && <th className={st.actionsTh} />}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, level }) => {
            const k = kids.get(p.entity_id) ?? [];
            const isHead = p.classification === "parent";
            const cc = ccyColor(p.functional_currency || p.local_currency);
            const warn = warningsBy.get(p.entity_id);
            return (
              <tr key={p.entity_id} className={cx(st.row, isHead && st.rowHead, p.method === "none" && st.rowMuted)} onClick={() => onOpen(p.entity_id)}>
                <td className={st.tdCompany}>
                  <div className={st.cellCompany} style={{ paddingLeft: level * 22 }}>
                    {k.length ? (
                      <button type="button" className={st.caret} onClick={(e) => { e.stopPropagation(); toggle(p.entity_id); }} aria-expanded={!collapsed.has(p.entity_id)}>
                        {collapsed.has(p.entity_id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                    ) : <span className={st.caretSpace}>{level > 0 && <i />}</span>}
                    <span className={st.miniAv} style={{ "--cc": cc }}>{initials(p.code)}</span>
                    <span className={st.coText}>
                      <b>{p.code}{isHead && <Crown size={11} className={st.crown} />}{warn && <AlertTriangle size={11} className={st.warnIco} />}</b>
                      <small title={p.legal_name ?? ""}>{p.legal_name || "—"}{collapsed.has(p.entity_id) && k.length ? ` · +${k.length}` : ""}</small>
                    </span>
                  </div>
                </td>
                <td><span className={cx(st.cls, st[`cls_${p.classification}`])}>{tx(`cls_${p.classification}`)}</span></td>
                <td className={cx(st.mute, st.nowrap)}>{tx(`mth_${p.method}`)}</td>
                <td className={st.num}>{isHead ? "—" : pctOrDash(p.direct_pct, tx.lang)}</td>
                <td className={st.num}>{isHead ? "—" : pctOrDash(p.group_voting_pct, tx.lang)}</td>
                <td className={st.num}>
                  <span className={st.pctBar}><i style={{ width: `${Math.min(100, Number(p.effective_pct ?? 0))}%` }} /></span>
                  <b>{pctOrDash(p.effective_pct, tx.lang)}</b>
                </td>
                <td className={cx(st.num, Number(p.minority_pct) > 0 && st.minTxt)}>{Number(p.minority_pct) > 0 ? pctOrDash(p.minority_pct, tx.lang) : "—"}</td>
                <td>
                  <span className={st.tagCcy} style={{ "--cc": cc }}>{p.functional_currency || p.local_currency}</span>
                  {p.functional_currency && p.functional_currency !== p.local_currency && <small className={st.mute}> {p.local_currency}</small>}
                </td>
                <td className={st.mute}>{fmtDate(p.first_consolidation, tx.lang)}</td>
                <td className={st.center}>{p.has_mapping
                  ? <Link2 size={14} className={st.okIco} aria-label={tx("mapping_ok")} />
                  : <Link2Off size={14} className={st.faintIco} aria-label={tx("mapping_missing")} />}</td>
                {canEdit && (
                  <td className={st.actionsTd} onClick={e => e.stopPropagation()}>
                    <span className={st.rowActions}>
                      {!isHead && <button type="button" className={st.iconBtn} title={tx("record_operation")} onClick={() => onAction("operation", p)}><ArrowRightLeft size={14} /></button>}
                      <button type="button" className={st.iconBtn} title={tx("change_parent_method")} onClick={() => onAction("node", p)}><GitBranch size={14} /></button>
                      {!isHead && <button type="button" className={st.iconBtn} title={tx("exit_perimeter")} onClick={() => onAction("exit", p)}><LogOut size={14} /></button>}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Avisos ───────────────────────────────────────────────────────────── */
export function WarningsPanel({ tx, warnings, onOpen, onClose }) {
  return (
    <aside className={st.warnPanel}>
      <header>
        <h4><AlertTriangle size={14} />{warnings.length ? tx("warnings_n", { n: warnings.length }) : tx("no_warnings")}</h4>
        <button type="button" className={st.iconBtn} onClick={onClose} aria-label={tx("close")}><X size={14} /></button>
      </header>
      {warnings.length === 0
        ? <p className={st.okLine}><CheckCircle2 size={15} />{tx("all_good")}</p>
        : (
          <ul>
            {groupWarnings(tx, warnings).map((w, i) => (
              <li key={`${w.code}-${w.entity_id}-${i}`}>
                <button type="button" onClick={() => w.entity_id && onOpen(w.entity_id)}>
                  <span className={st.warnDot} />
                  <span>{w.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </aside>
  );
}

/* ── Empresas ─────────────────────────────────────────────────────────── */
export function CompaniesView({ tx, data, perimeter, date, search, onOpen }) {
  const [filter, setFilter] = useState("all");
  const inPer = useMemo(() => new Map(perimeter.map(p => [p.entity_id, p])), [perimeter]);
  const fnCcy = (id) => data.currencies.find(c => c.entity_id === id && coversDate(c, date))?.functional_currency;
  const q = search.trim().toLowerCase();
  const list = data.entities.filter(e => {
    if (q && !`${e.code} ${e.legal_name ?? ""} ${e.tax_id ?? ""} ${(e.tags ?? []).join(" ")}`.toLowerCase().includes(q)) return false;
    if (filter === "in") return inPer.has(e.id);
    if (filter === "out") return !inPer.has(e.id);
    if (filter === "closed") return e.end_date && e.end_date < date;
    return true;
  });
  const counts = {
    all: data.entities.length,
    in: data.entities.filter(e => inPer.has(e.id)).length,
    out: data.entities.filter(e => !inPer.has(e.id)).length,
    closed: data.entities.filter(e => e.end_date && e.end_date < date).length,
  };
  return (
    <div className={st.tableWrap}>
      <div className={st.segRow}>
        {[["all", "hist_all"], ["in", "in_structure"], ["out", "not_in_structure"], ["closed", "status_closed"]].map(([k, l]) => (
          <button key={k} type="button" className={cx(st.chip, filter === k && st.chipOn)} onClick={() => setFilter(k)}>
            {tx(l)}<em>{counts[k]}</em>
          </button>
        ))}
      </div>
      <table className={st.table}>
        <thead>
          <tr>
            <th className={st.thCompany}>{tx("col_company")}</th>
            <th>{tx("col_type")}</th><th>{tx("col_country")}</th><th>{tx("f_tax_id")}</th>
            <th>{tx("col_currency")}</th><th>{tx("col_start")}</th><th>{tx("col_end")}</th>
            <th>{tx("col_parent")}</th><th className={st.num}>{tx("col_effective")}</th><th>{tx("f_tags")}</th>
          </tr>
        </thead>
        <tbody>
          {list.map(e => {
            const p = inPer.get(e.id);
            const fc = fnCcy(e.id) ?? e.currency;
            const closed = e.end_date && e.end_date < date;
            return (
              <tr key={e.id} className={cx(st.row, (!p || closed) && st.rowMuted)} onClick={() => onOpen(e.id)}>
                <td className={st.tdCompany}>
                  <div className={st.cellCompany}>
                    <span className={st.miniAv} style={{ "--cc": ccyColor(fc) }}>{initials(e.code)}</span>
                    <span className={st.coText}><b>{e.code}</b><small>{e.legal_name || "—"}</small></span>
                  </div>
                </td>
                <td className={st.mute}>{tx(`type_${e.entity_type ?? "company"}`)}</td>
                <td>{e.country || "—"}</td>
                <td className={st.mono}>{e.tax_id || "—"}</td>
                <td><span className={st.tagCcy} style={{ "--cc": ccyColor(fc) }}>{fc}</span>{fc !== e.currency && <small className={st.mute}> {e.currency}</small>}</td>
                <td className={st.mute}>{fmtDate(e.start_date, tx.lang)}</td>
                <td className={st.mute}>{closed ? <span className={st.tagBad}>{fmtDate(e.end_date, tx.lang)}</span> : fmtDate(e.end_date, tx.lang)}</td>
                <td>{p ? (p.parent_code || <span className={st.tagRoot}><Crown size={10} />{tx("cls_parent")}</span>) : <span className={st.tagSoft}>{tx("not_in_structure")}</span>}</td>
                <td className={st.num}>{p ? pctOrDash(p.effective_pct, tx.lang) : "—"}</td>
                <td>{(e.tags ?? []).map(t => <span key={t} className={st.tagSoft}>{t}</span>)}</td>
              </tr>
            );
          })}
          {!list.length && <tr><td colSpan={10} className={st.emptyRow}><Search size={14} />{tx("no_results")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ── Configuración de grupo ───────────────────────────────────────────── */
const DEFAULTS = {
  fiscal_year_end_month: 12, week_rule: "iso_split", week_start: 1, close_granularity: "month",
  presentation_currency: "EUR", extra_currencies: [], fx_rate_types: ["closing", "average", "historical"],
  fx_source: "manual", number_scale: "units", decimals: 2, negative_style: "parentheses",
};
const monthName = (m, lang) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang === "da" ? "da-DK" : lang === "pt" ? "pt-PT" : "es-ES", { month: "long", timeZone: "UTC" })
  .format(new Date(Date.UTC(2020, m - 1, 1)));
const monthShort = (iso, lang) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang === "da" ? "da-DK" : lang === "pt" ? "pt-PT" : "es-ES", { month: "short", timeZone: "UTC" })
  .format(new Date(`${iso}T00:00:00Z`));

export function SettingsView({ tx, data, companyId, canEdit, onChanged, notify }) {
  const [f, setF] = useState(() => ({ ...DEFAULTS, ...(data.settings ?? {}) }));
  const [extra, setExtra] = useState(() => (data.settings?.extra_currencies ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const y = new Date().getFullYear();
  const [years, setYears] = useState({ from: y - 2, to: y + 1, replace: false });
  const [genBusy, setGenBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(null);
  const dirty = JSON.stringify({ ...DEFAULTS, ...(data.settings ?? {}), extra_currencies: (data.settings?.extra_currencies ?? []) }) !== JSON.stringify({ ...f, extra_currencies: extra.split(",").map(s => s.trim().toUpperCase()).filter(Boolean) });
  const set = (k, num) => (e) => setF(p => ({ ...p, [k]: num ? Number(e.target.value) : e.target.value }));
  const toggleFx = (k) => setF(p => ({ ...p, fx_rate_types: p.fx_rate_types.includes(k) ? p.fx_rate_types.filter(x => x !== k) : [...p.fx_rate_types, k] }));

  const save = async ({ quiet = false } = {}) => {
    setBusy(true); setErr("");
    try {
      const { company_id: _c, updated_at: _u, updated_by: _b, ...rest } = f;
      await saveSettings(companyId, {
        ...rest, presentation_currency: (rest.presentation_currency || "").toUpperCase().slice(0, 3) || null,
        extra_currencies: extra.split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{3}$/.test(s)),
      });
      if (!quiet) { notify(tx("set_saved")); onChanged(); }
      return true;
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); return false; } finally { setBusy(false); }
  };
  const generate = async () => {
    setGenBusy(true); setErr("");
    try {
      if (dirty && !(await save({ quiet: true }))) return;
      const n = await generatePeriods(companyId, Number(years.from), Number(years.to), years.replace);
      notify(tx("set_generated", { n }));
      onChanged();
    } catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setGenBusy(false); }
  };
  const toggleLock = async (m) => {
    if (!canEdit) return;
    setLockBusy(m.id);
    try { await setMonthLocked(m.id, !m.is_locked); onChanged(); }
    catch (e) { setErr(errorText(tx, parseLedgerError(e))); } finally { setLockBusy(null); }
  };
  const byYear = useMemo(() => {
    const out = new Map();
    data.months.forEach(m => { if (!out.has(m.fiscal_year)) out.set(m.fiscal_year, []); out.get(m.fiscal_year).push(m); });
    return [...out.entries()].sort((a, b) => b[0] - a[0]);
  }, [data.months]);
  const dis = !canEdit;

  return (
    <div className={st.settings}>
      <section className={st.card}>
        <h3><CalendarRange size={15} />{tx("set_calendar")}</h3>
        <div className={st.grid3}>
          <Field label={tx("set_year_end")}>
            <select className={st.input} disabled={dis} value={f.fiscal_year_end_month} onChange={set("fiscal_year_end_month", true)}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1, tx.lang)}</option>)}
            </select>
          </Field>
          <Field label={tx("set_week_rule")} hint={tx(f.week_rule === "iso_split" ? "wr_hint_iso" : "wr_hint_445")}>
            <select className={st.input} disabled={dis} value={f.week_rule} onChange={set("week_rule")}>
              {["iso_split", "445", "454", "544"].map(k => <option key={k} value={k}>{tx(`wr_${k}`)}</option>)}
            </select>
          </Field>
          <Field label={tx("set_week_start")}>
            <select className={st.input} disabled={dis} value={f.week_start} onChange={set("week_start", true)}>
              {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{tx(`wd_${d}`)}</option>)}
            </select>
          </Field>
          <Field label={tx("set_granularity")}>
            <div className={st.radioRow}>
              {["month", "week"].map(k => (
                <label key={k} className={cx(st.radio, f.close_granularity === k && st.radioOn)}>
                  <input type="radio" disabled={dis} checked={f.close_granularity === k} onChange={() => setF(p => ({ ...p, close_granularity: k }))} />{tx(`gr_${k}`)}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </section>

      <section className={st.card}>
        <h3><Coins size={15} />{tx("set_currencies")}</h3>
        <div className={st.grid3}>
          <Field label={tx("set_presentation")}>
            <input className={st.input} disabled={dis} value={f.presentation_currency ?? ""} maxLength={3}
              onChange={e => setF(p => ({ ...p, presentation_currency: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label={tx("set_extra")} hint={tx("set_extra_hint")}>
            <input className={st.input} disabled={dis} value={extra} onChange={e => setExtra(e.target.value.toUpperCase())} />
          </Field>
          <Field label={tx("set_fx_source")}>
            <select className={st.input} disabled={dis} value={f.fx_source} onChange={set("fx_source")}>
              {["manual", "import", "auto"].map(k => <option key={k} value={k}>{tx(`fxs_${k}`)}</option>)}
            </select>
          </Field>
          <Field label={tx("set_fx_types")} wide>
            <div className={st.radioRow}>
              {["closing", "average", "historical"].map(k => (
                <label key={k} className={cx(st.radio, f.fx_rate_types.includes(k) && st.radioOn)}>
                  <input type="checkbox" disabled={dis} checked={f.fx_rate_types.includes(k)} onChange={() => toggleFx(k)} />{tx(`fx_${k}`)}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </section>

      <section className={st.card}>
        <h3><Hash size={15} />{tx("set_format")}</h3>
        <div className={st.grid3}>
          <Field label={tx("set_scale")}>
            <select className={st.input} disabled={dis} value={f.number_scale} onChange={set("number_scale")}>
              {["units", "thousands", "millions"].map(k => <option key={k} value={k}>{tx(`sc_${k}`)}</option>)}
            </select>
          </Field>
          <Field label={tx("set_decimals")}>
            <select className={st.input} disabled={dis} value={f.decimals} onChange={set("decimals", true)}>
              {[0, 1, 2, 3, 4].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label={tx("set_negative")} hint={tx("set_format_hint")}>
            <select className={st.input} disabled={dis} value={f.negative_style} onChange={set("negative_style")}>
              {["parentheses", "minus"].map(k => <option key={k} value={k}>{tx(`neg_${k}`)}</option>)}
            </select>
          </Field>
        </div>
        {canEdit && (
          <div className={st.cardFoot}>
            {err && <p className={st.formError}>{err}</p>}
            <button type="button" className={st.btnPrimary} disabled={busy || !dirty} onClick={() => save()}>
              {busy ? <Loader2 size={14} className={st.spin} /> : <Save size={14} />}{tx("save")}
            </button>
          </div>
        )}
      </section>

      <section className={cx(st.card, st.cardWide)}>
        <h3><CalendarDays size={15} />{tx("set_periods")}</h3>
        {canEdit && (
          <div className={st.genRow}>
            <span className={st.fieldLabel}>{tx("set_years")}</span>
            <input type="number" className={cx(st.input, st.inputYear)} value={years.from} onChange={e => setYears(p => ({ ...p, from: e.target.value }))} aria-label={tx("set_from")} />
            <span className={st.mute}>–</span>
            <input type="number" className={cx(st.input, st.inputYear)} value={years.to} onChange={e => setYears(p => ({ ...p, to: e.target.value }))} aria-label={tx("set_to")} />
            <label className={st.check}><input type="checkbox" checked={years.replace} onChange={e => setYears(p => ({ ...p, replace: e.target.checked }))} />{tx("set_replace")}</label>
            <button type="button" className={st.btnPrimary} disabled={genBusy} onClick={generate}>
              {genBusy ? <Loader2 size={14} className={st.spin} /> : <CalendarRange size={14} />}{tx("set_generate_btn")}
            </button>
          </div>
        )}
        {byYear.length === 0 ? <p className={st.hint}>{tx("set_no_periods")}</p> : (
          <>
            <p className={st.hint}>{tx("set_lock_hint")}</p>
            <div className={st.lockGrid}>
              {byYear.map(([fy, ms]) => (
                <Fragment key={fy}>
                  <span className={st.lockYear}>{fy}</span>
                  <div className={st.lockMonths}>
                    {ms.map(m => (
                      <button key={m.id} type="button" disabled={!canEdit || lockBusy === m.id}
                        className={cx(st.lockCell, m.is_locked && st.lockOn)} onClick={() => toggleLock(m)}
                        title={`${fmtDate(m.start_date, tx.lang)} – ${fmtDate(m.end_date, tx.lang)} · ${tx(m.is_locked ? "set_locked" : "set_open")}`}>
                        {lockBusy === m.id ? <Loader2 size={11} className={st.spin} /> : m.is_locked ? <Lock size={11} /> : <Unlock size={11} />}
                        <span>{monthShort(m.end_date, tx.lang)}</span>
                      </button>
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        )}
        {!canEdit && err && <p className={st.formError}>{err}</p>}
        {canEdit && err && <p className={st.formError}>{err}</p>}
      </section>
    </div>
  );
}

/* ── Historial ────────────────────────────────────────────────────────── */
function auditText(tx, a, code) {
  const changed = a.action === "update" && a.old_row && a.new_row
    ? Object.keys(a.new_row).filter(k => !["updated_at", "updated_by", "created_at"].includes(k) && JSON.stringify(a.new_row[k]) !== JSON.stringify(a.old_row[k]))
    : [];
  const row = a.new_row ?? a.old_row ?? {};
  const who = code.get(a.entity_id) ?? row.code ?? row.name ?? "";
  return { title: `${tx(`tbl_${a.table_name}`)} · ${tx(`aud_${a.action}`)}`, text: [who, changed.length ? changed.join(", ") : null].filter(Boolean).join(" — ") };
}

export function Timeline({ tx, items, users, onOpen }) {
  const userName = (id) => (id ? users.get(id) ?? tx("hist_user") : tx("hist_system"));
  if (!items.length) return <p className={st.hint}>{tx("history_empty")}</p>;
  return (
    <ol className={st.timelineList}>
      {items.map(it => (
        <li key={it.key} className={cx(st.tlItem, st[`tone_${it.tone ?? "flat"}`])}>
          <span className={st.tlIco}>{it.kind === "ownership" ? <ArrowRightLeft size={13} /> : it.kind === "audit" ? <FileClock size={13} /> : <GitBranch size={13} />}</span>
          <div className={st.tlBody}>
            <p className={st.tlHead}>
              <b>{it.title}</b>
              {it.date && <span className={st.tagSoft}>{fmtDate(it.date, tx.lang)}</span>}
            </p>
            <p className={st.tlText}>
              {it.entityId && onOpen ? <button type="button" className={st.linkBtn} onClick={() => onOpen(it.entityId)}>{it.text}</button> : it.text}
            </p>
            {it.note && <p className={st.tlNote}>“{it.note}”</p>}
            <p className={st.tlMeta}>{tx("hist_by", { u: userName(it.by) })} · {it.at ? new Date(it.at).toLocaleString(tx.lang === "en" ? "en-GB" : tx.lang) : ""}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HistoryView({ tx, data, companyId, users, onOpen }) {
  const [kind, setKind] = useState("all");
  const [audit, setAudit] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (kind !== "audit" || audit) return undefined;
    let off = false;
    loadAudit(companyId, null, 300).then(r => { if (!off) setAudit(r); }).catch(e => { if (!off) setErr(String(e?.message ?? e)); });
    return () => { off = true; };
  }, [kind, audit, companyId]);
  const code = useMemo(() => new Map(data.entities.map(e => [e.id, e.code])), [data.entities]);
  const events = useMemo(() => eventItems(tx, data), [tx, data]);
  const items = kind === "audit"
    ? (audit ?? []).map(a => ({ key: `a${a.id}`, kind: "audit", at: a.at, by: a.actor, entityId: a.entity_id, tone: a.action === "delete" ? "down" : a.action === "insert" ? "up" : "flat", ...auditText(tx, a, code) }))
    : events.filter(e => kind === "all" || e.kind === kind);
  return (
    <div className={st.history}>
      <div className={st.segRow}>
        {[["all", "hist_all"], ["ownership", "hist_ownership"], ["structure", "hist_structure"], ["audit", "hist_audit"]].map(([k, l]) => (
          <button key={k} type="button" className={cx(st.chip, kind === k && st.chipOn)} onClick={() => setKind(k)}>
            {k === "audit" ? <ShieldCheck size={12} /> : k === "ownership" ? <ArrowRightLeft size={12} /> : k === "structure" ? <GitBranch size={12} /> : <History size={12} />}{tx(l)}
          </button>
        ))}
      </div>
      {kind === "audit" && !audit && !err && <p className={st.hint}><Loader2 size={13} className={st.spin} /> {tx("loading_short")}</p>}
      {err && <p className={st.formError}>{err}</p>}
      {(kind !== "audit" || audit) && <Timeline tx={tx} items={items} users={users} onOpen={onOpen} />}
    </div>
  );
}

/* ── Estado vacío ─────────────────────────────────────────────────────── */
export function EmptyState({ tx, canEdit, hasToken, onKonsolidator, onExcel, onScratch, onTemplate }) {
  return (
    <div className={st.empty}>
      <span className={st.emptyIco}><Network size={26} /></span>
      <h2>{tx("empty_title")}</h2>
      <p>{tx("empty_text")}</p>
      {canEdit ? (
        <div className={st.emptyCards}>
          {hasToken && (
            <button type="button" className={st.emptyCard} onClick={onKonsolidator}>
              <span className={st.emptyCardIco}><Building2 size={18} /></span>
              <b>{tx("empty_from_k")}</b><small>{tx("empty_from_k_desc")}</small>
            </button>
          )}
          <button type="button" className={st.emptyCard} onClick={onExcel}>
            <span className={st.emptyCardIco}><FileSpreadsheet size={18} /></span>
            <b>{tx("empty_from_excel")}</b><small>{tx("empty_from_excel_desc")}</small>
            <span role="link" tabIndex={0} className={st.linkBtn} onClick={(e) => { e.stopPropagation(); onTemplate(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onTemplate(); } }}>{tx("download_template")}</span>
          </button>
          <button type="button" className={st.emptyCard} onClick={onScratch}>
            <span className={st.emptyCardIco}><GitBranch size={18} /></span>
            <b>{tx("empty_scratch")}</b><small>{tx("empty_scratch_desc")}</small>
          </button>
        </div>
      ) : <p className={st.readOnlyNote}><Lock size={13} />{tx("read_only_hint")}</p>}
    </div>
  );
}
