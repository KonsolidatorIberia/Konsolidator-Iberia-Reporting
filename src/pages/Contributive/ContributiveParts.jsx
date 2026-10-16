/* ══════════════════════════════════════════════════════════════════════
   Contribución — piezas de interfaz: cargador, modales (desglose de una
   celda y asientos) y vistas de mapeos.
   ══════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useRef } from "react";
import { t } from "../../lib/i18n";
import { createPortal } from "react-dom";
import { ChevronDown, X, Layers, Search, FileText, Library, BookOpen } from "lucide-react";
import ProgressLoader from "../../components/framework/ProgressLoader.jsx";
import jm from "./JournalsModal.module.css";
import { fmtAmt } from "./contributiveUtils.js";

/* ─── Cargador ────────────────────────────────────────────────────────────
   El cargador común de la aplicación (ProgressLoader, el mismo de la Home y
   de la sábana): porcentaje real y las fases de la carga — metadatos,
   periodo con datos y datos del periodo (consolidado + asientos del mes y
   del anterior). Cubre solo la tarjeta de la tabla y se desvanece al
   terminar. Si llega del cargador de las rutas, sigue su porcentaje. */
export function ContributiveLoader({ T, locale, colors, visible, metaReady, metaProgress = 0, probing, dataProgress = 0 }) {
  const LT = { meta: t(locale, "contrib_step_meta"), period: t(locale, "contrib_step_period"), data: t(locale, "contrib_step_data") };
  const steps = [
    { key: "meta", label: LT.meta, weight: 2, state: metaReady ? "done" : "active", progress: metaProgress },
    { key: "period", label: LT.period, weight: 1, state: !metaReady ? "pending" : probing ? "active" : "done" },
    { key: "data", label: LT.data, weight: 6, state: !metaReady || probing ? "pending" : visible ? "active" : "done", progress: dataProgress },
  ];
  return (
    <ProgressLoader
      visible={visible}
      steps={steps}
      primary={colors?.primary ?? "#1a2f8a"}
      secondary={colors?.secondary ?? "#CF305D"}
      title={!metaReady ? T("loading_meta") : probing ? T("loading_overlay_period") : T("contrib_building", "Building contributive view…")}
      subtitle={T("contrib_label", "Contribution")}
    />
  );
}

/* ─── Comparación cargando ───────────────────────────────────────────────
   Píldora junto a los filtros del periodo B mientras llegan sus datos
   (antes, un icono girando de 11 px). */
export function CompareBusy({ locale, primary = "#1a2f8a" }) {
  const label = t(locale, "contrib_cmp_busy");
  return (
    <span className={jm.cmpBusy} style={{ "--jm-primary": primary }} role="status" aria-live="polite">
      <span className={jm.cmpBusyRing} aria-hidden="true" />
      {label}
      <span className={jm.cmpBusyDots} aria-hidden="true"><i /><i /><i /></span>
    </span>
  );
}

/* ─── Desglose de una celda ──────────────────────────────────────────────
   Lo que hay detrás de un importe (cuenta × sociedad): cuentas locales con
   su peso sobre el total. Mismo lenguaje que el modal de asientos: vidrio,
   cabecera con icono, filas animadas y pie con el total. Esc cierra. */
const drillText = (locale) => ({
  amount: t(locale, "contrib_drill_amount"),
  total: t(locale, "contrib_drill_total"),
  count: (a, b) => `${a} ${t(locale, a === 1 ? "contrib_drill_acc_one" : "contrib_drill_acc_other")} · ${b} ${t(locale, b === 1 ? "contrib_drill_line_one" : "contrib_drill_line_other")}`,
});
export function DrilldownModal({ T, locale, accountCode, accountName, company, companyName, rows, currency, colors, onClose }) {
  const DT = drillText(locale);
  const total = rows.reduce((sum, r) => sum + (-(Number(r.AmountYTD ?? r.amountYTD) || 0)), 0);

  const entries = useMemo(() => {
    const byLocal = new Map();
    rows.forEach(r => {
      const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "__none__";
      const lanm = r.LocalAccountName ?? r.localAccountName ?? "";
      const dim  = r.DimensionName    ?? r.dimensionName    ?? "";
      const amt  = -(Number(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD) || 0);
      if (!byLocal.has(lac)) byLocal.set(lac, { code: lac === "__none__" ? null : lac, name: lanm, amt: 0, dims: new Set(), n: 0 });
      const e = byLocal.get(lac);
      e.amt += amt;
      e.n += 1;
      if (dim) e.dims.add(dim);
    });
    return [...byLocal.values()].sort((x, y) => Math.abs(y.amt) - Math.abs(x.amt));
  }, [rows]);
  const absSum = entries.reduce((sum, e) => sum + Math.abs(e.amt), 0) || 1;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amtCls = (v) => `${jm.amt} ${Math.abs(v) < 0.005 ? jm.zero : v < 0 ? jm.neg : ""}`;

  return createPortal(
    <div className={jm.overlay} style={{ "--jm-primary": colors?.primary ?? "#1a2f8a" }} onClick={onClose}>
      <div className={`${jm.modal} ${jm.drill}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={jm.head}>
          <div className={jm.headMain}>
            <span className={jm.headIcon}><Layers size={18} strokeWidth={2.2} /></span>
            <div className={jm.headText}>
              <h3 className={jm.title}>{accountName || accountCode}</h3>
              <p className={jm.subtitle}>
                <span className={jm.drillCode}>{accountCode}</span>
                <span className={jm.dot} />{companyName || company}
                {currency ? <><span className={jm.dot} />{currency}</> : null}
              </p>
            </div>
          </div>
          <div className={jm.drillTotal}>
            <em>{DT.amount}</em>
            <b className={total < 0 ? jm.neg : ""}>{fmtAmt(total)}</b>
          </div>
          <button type="button" onClick={onClose} className={jm.close} aria-label="Close"><X size={16} /></button>
        </div>

        <div className={jm.body}>
          <p className={jm.drillKicker}>{T("drill_local_breakdown", "Local Account Breakdown")}</p>
          {entries.length === 0 ? (
            <div className={jm.empty}>
              <span className={jm.emptyIcon}><Search size={20} /></span>
              <p className={jm.emptyTitle}>{T("drill_no_detail", "No detail available.")}</p>
            </div>
          ) : (
            <ul className={jm.drillList}>
              {entries.map((e, i) => {
                const share = Math.abs(e.amt) / absSum;
                return (
                  <li key={e.code ?? `none-${i}`} className={jm.drillItem} style={{ "--i": Math.min(i, 30), "--share": share }}>
                    <div className={jm.drillMain}>
                      {e.code ? <span className={jm.code}>{e.code}</span> : null}
                      <span className={jm.drillName} title={e.name}>{e.name || "—"}</span>
                      {[...e.dims].slice(0, 3).map(d => <span key={d} className={jm.drillDim}>{d}</span>)}
                      {e.dims.size > 3 ? <span className={jm.drillDim}>+{e.dims.size - 3}</span> : null}
                    </div>
                    <div className={jm.drillShare}>
                      <span className={jm.drillBar}><i /></span>
                      <span className={jm.drillPct}>{(share * 100).toFixed(1).replace(".", ",")}%</span>
                    </div>
                    <span className={amtCls(e.amt)}>{Math.abs(e.amt) < 0.005 ? "—" : fmtAmt(e.amt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={jm.foot}>
          <span className={jm.footCount}>{DT.count(entries.length, rows.length)}</span>
          <div className={jm.footTotals}>
            <span className={`${jm.footItem} ${jm.footNet}`}><em>{DT.total}</em><b className={total < 0 ? jm.neg : ""}>{fmtAmt(total)}</b></span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── JournalsPill — multi-select pill (extracted to module scope so its state survives parent re-renders) */
function JournalsPill({ T, label, values, onChange, options, colors }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  const ddRef = useRef(null);

  useEffect(() => {
    const h = e => {
      const inPill = ref.current && ref.current.contains(e.target);
      const inDd = ddRef.current && ddRef.current.contains(e.target);
      if (!inPill && !inDd) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (!open) return;
    let rafId;
    const track = () => {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  const active = values.length > 0;
  const showLabel = active || hover || open;
const display = !active
    ? T("all")
    : values.length === 1
      ? values[0]
      : `${values.length} ${T("jrn_selected", "selected")}`;

  const toggle = (o) => {
    if (values.includes(o)) onChange(values.filter(v => v !== o));
    else onChange([...values, o]);
  };

  return (
    <div ref={ref} className="relative flex-shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl select-none overflow-hidden"
        style={{
          padding: "7px 12px",
          background: active
            ? `${colors.primary}10`
            : (open || hover ? "rgba(26,47,138,0.05)" : "transparent"),
          border: `1px solid ${active ? `${colors.primary}40` : "rgba(26,47,138,0.08)"}`,
          transition: "background 200ms, border-color 200ms",
          lineHeight: 1,
        }}>
        <span className="inline-flex items-center overflow-hidden whitespace-nowrap"
          style={{
            maxWidth: showLabel ? 110 : 0,
            opacity: showLabel ? 1 : 0,
            marginRight: showLabel ? 5 : 0,
            transition: "max-width 280ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease, margin-right 280ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none"
            style={{ color: colors.primary, opacity: active ? 0.7 : 0.5 }}>
            {label}
          </span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: active ? colors.primary : "rgba(100,120,180,0.7)", lineHeight: 1 }}>
          {display}
        </span>
        {active && (
          <button
            onClick={e => { e.stopPropagation(); onChange([]); }}
            className="flex items-center justify-center rounded-full ml-0.5"
            style={{ width: 14, height: 14, background: `${colors.primary}15` }}
            title={T("btn_clear")}>
            <X size={8} style={{ color: colors.primary }} strokeWidth={3} />
          </button>
        )}
        {!active && (
          <ChevronDown size={10}
            style={{ color: colors.primary, opacity: 0.4, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 240ms cubic-bezier(0.34,1.56,0.64,1)" }} />
        )}
      </button>

      {open && createPortal(
        <div ref={ddRef}
          className="fixed z-[70] min-w-[220px] max-h-[320px] overflow-y-auto rounded-2xl"
          style={{
            top: rect ? rect.bottom + 6 : 0,
            left: rect ? rect.left : 0,
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.22), 0 0 0 1px rgba(255,255,255,0.5) inset",
            animation: "ddIn 220ms cubic-bezier(0.34,1.56,0.64,1)",
            padding: 6,
          }}>
          <button
            onClick={() => onChange(active ? [] : [...options])}
            className="w-full text-left px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2.5 border-b border-gray-100 mb-1"
            style={{ color: colors.primary }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(26,47,138,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: !active ? colors.primary : "#fff",
                borderColor: !active ? colors.primary : "#d4d4d8",
              }}>
              {!active && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            {active ? T("jrn_clear_selection", "Clear selection") : T("all")}
          </button>
          {options.map(o => {
            const selected = values.includes(o);
            return (
              <button key={o}
                onClick={() => toggle(o)}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2.5"
                style={{
                  background: selected ? "rgba(26,47,138,0.08)" : "transparent",
                  color: "#475569",
                }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.04)"; }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: selected ? colors.primary : "#fff",
                    borderColor: selected ? colors.primary : "#d4d4d8",
                  }}>
                  {selected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                <span className="truncate">{o}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ─── JournalsModal — modern search + filter UI over journal entries ────── */
export function JournalsModal({ T, journalData, onClose, year, month, source, colors }) {
const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState([]);
  const [filterCounterparty, setFilterCounterparty] = useState([]);
  const [filterJournalType, setFilterJournalType] = useState([]);
  const [filterAccountType, setFilterAccountType] = useState([]);

  // Derive option lists from data
  const opts = useMemo(() => {
    const companies = new Set();
    const counterparties = new Set();
    const journalTypes = new Set();
    const accountTypes = new Set();
    journalData.forEach(r => {
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      const cpty = r.CounterpartyShortName ?? r.counterpartyShortName ?? "";
      const jt = r.JournalType ?? r.journalType ?? "";
      const at = r.AccountType ?? r.accountType ?? "";
      if (co) companies.add(co);
      if (cpty) counterparties.add(cpty);
      if (jt) journalTypes.add(jt);
      if (at) accountTypes.add(at);
    });
    return {
      companies: [...companies].sort(),
      counterparties: [...counterparties].sort(),
      journalTypes: [...journalTypes].sort(),
      accountTypes: [...accountTypes].sort(),
    };
  }, [journalData]);

// Apply all filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journalData.filter(r => {
      if (filterCompany.length      && !filterCompany.includes(r.CompanyShortName ?? r.companyShortName)) return false;
      if (filterCounterparty.length && !filterCounterparty.includes(r.CounterpartyShortName ?? r.counterpartyShortName)) return false;
      if (filterJournalType.length  && !filterJournalType.includes(r.JournalType ?? r.journalType)) return false;
      if (filterAccountType.length  && !filterAccountType.includes(r.AccountType ?? r.accountType)) return false;
      if (q) {
        const fields = [
          r.AccountCode, r.accountCode,
          r.AccountName, r.accountName,
          r.JournalNumber, r.journalNumber,
          r.JournalHeader, r.journalHeader,
          r.RowText, r.rowText,
          r.DimensionName, r.dimensionName,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!fields.includes(q)) return false;
      }
      return true;
    });
  }, [journalData, search, filterCompany, filterCounterparty, filterJournalType, filterAccountType]);

  const anyFilterActive = !!(search || filterCompany.length || filterCounterparty.length || filterJournalType.length || filterAccountType.length);

  const clearAll = () => {
    setSearch(""); setFilterCompany([]); setFilterCounterparty([]);
    setFilterJournalType([]); setFilterAccountType([]);
  };

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Resumen: nº de asientos por tipo (chips que filtran) y totales de lo filtrado
  const typeCounts = useMemo(() => {
    const m = new Map();
    journalData.forEach(r => { const jt = r.JournalType ?? r.journalType ?? ""; if (jt) m.set(jt, (m.get(jt) ?? 0) + 1); });
    return [...m.entries()].sort((a2, b2) => a2[0].localeCompare(b2[0]));
  }, [journalData]);
  const totals = useMemo(() => {
    let debe = 0, haber = 0;
    filtered.forEach(r => { const v = Number(r.AmountYTD ?? r.amountYTD) || 0; if (v >= 0) debe += v; else haber += v; });
    return { debe, haber, neto: debe + haber };
  }, [filtered]);
  const toggleType = (jt) => setFilterJournalType(prev => (prev.includes(jt) ? prev.filter(x => x !== jt) : [...prev, jt]));
  const typeClass = (jt) => jm[`t${String(jt).toUpperCase()}`] ?? jm.tOTHER;

  const heads = [
    T("jrn_company"), T("jrn_account"), T("jrn_account_type"), T("jrn_number"), T("jrn_header"),
    T("jrn_journal_type"), T("jrn_journal_layer"), T("jrn_counterparty"), T("jrn_dimension"),
    T("jrn_amount_ytd"), T("jrn_currency"), T("jrn_row_text"), T("jrn_posted"), T("jrn_system_generated"),
  ];

  return createPortal(
    <div className={jm.overlay} style={{ "--jm-primary": colors.primary }} onClick={onClose}>
      <div className={jm.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* ── Cabecera ── */}
        <div className={jm.head}>
          <div className={jm.headMain}>
            <span className={jm.headIcon}><BookOpen size={18} strokeWidth={2.2} /></span>
            <div className={jm.headText}>
              <h3 className={jm.title}>{T("export_journal_entries")}</h3>
              <p className={jm.subtitle}>
                {anyFilterActive ? `${filtered.length} ${T("am_matching_count_of")} ${journalData.length}` : `${journalData.length}`} {T("entries")}
                <span className={jm.dot} />{T(`month_${Number(month)}`)} {year}
                <span className={jm.dot} />{source}
              </p>
            </div>
          </div>
          <div className={jm.typeChips}>
            {typeCounts.map(([jt, n]) => (
              <button key={jt} type="button" onClick={() => toggleType(jt)}
                className={`${jm.typeChip} ${typeClass(jt)} ${filterJournalType.includes(jt) ? jm.typeChipOn : ""}`}>
                <span className={jm.typeDot} />{jt}<span className={jm.typeCount}>{n}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className={jm.close} aria-label="Close"><X size={16} /></button>
        </div>

        {/* ── Filtros ── */}
        <div className={jm.filters}>
          <div className={jm.search}>
            <Search size={14} className={jm.searchIcon} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={T("jrn_search_placeholder", "Search account, journal #, header, row text…")} />
            {search && (
              <button type="button" className={jm.searchClear} onClick={() => setSearch("")} aria-label="Clear"><X size={10} strokeWidth={3} /></button>
            )}
          </div>
          <span className={jm.sep} />
          <JournalsPill T={T} colors={colors} label={T("jrn_company")}      values={filterCompany}      onChange={setFilterCompany}      options={opts.companies} />
          <JournalsPill T={T} colors={colors} label={T("jrn_counterparty")} values={filterCounterparty} onChange={setFilterCounterparty} options={opts.counterparties} />
          <JournalsPill T={T} colors={colors} label={T("jrn_journal_type")} values={filterJournalType}  onChange={setFilterJournalType}  options={opts.journalTypes} />
          <JournalsPill T={T} colors={colors} label={T("jrn_account_type")} values={filterAccountType}  onChange={setFilterAccountType}  options={opts.accountTypes} />
          {anyFilterActive && (
            <button type="button" onClick={clearAll} className={jm.clearAll}>
              <X size={10} strokeWidth={3} />{T("jrn_clear_all", "Clear all")}
            </button>
          )}
        </div>

        {/* ── Tabla ── */}
        <div className={jm.body}>
          {filtered.length === 0 ? (
            <div className={jm.empty}>
              <span className={jm.emptyIcon}><Search size={20} /></span>
              <p className={jm.emptyTitle}>{T("jrn_no_match", "No journals match your filters")}</p>
              <p className={jm.emptyText}>{T("jrn_no_match_hint", "Try removing some filters or adjusting your search")}</p>
            </div>
          ) : (
            <table className={jm.table}>
              <thead>
                <tr>{heads.map(h => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const amt = Number(r.AmountYTD ?? r.amountYTD) || 0;
                  const jn = r.JournalNumber ?? r.journalNumber;
                  const prevJn = i > 0 ? (filtered[i - 1].JournalNumber ?? filtered[i - 1].journalNumber) : null;
                  const jt = r.JournalType ?? r.journalType ?? "";
                  const posted = !!(r.Posted ?? r.posted);
                  const sys = !!(r.SystemGenerated ?? r.systemGenerated);
                  return (
                    <tr key={i} className={`${jm.row} ${typeClass(jt)} ${jn !== prevJn ? jm.newJournal : ""}`}
                      style={{ "--i": Math.min(i, 30) }}>
                      <td className={jm.strong}>{r.CompanyShortName ?? r.companyShortName}</td>
                      <td>
                        <span className={jm.code}>{r.AccountCode ?? r.accountCode}</span>
                        <span className={jm.accName}>{r.AccountName ?? r.accountName}</span>
                      </td>
                      <td><span className={jm.soft}>{r.AccountType ?? r.accountType}</span></td>
                      <td><span className={jm.jn}>{jn}</span></td>
                      <td className={jm.clip} title={r.JournalHeader ?? r.journalHeader}>{r.JournalHeader ?? r.journalHeader}</td>
                      <td><span className={jm.badge}>{jt}</span></td>
                      <td><span className={jm.soft}>{r.JournalLayer ?? r.journalLayer}</span></td>
                      <td>{r.CounterpartyShortName ?? r.counterpartyShortName}</td>
                      <td className={jm.clip}>{r.DimensionName ?? r.dimensionName}</td>
                      <td className={jm.amtCell}>
                        <span className={`${jm.amt} ${amt === 0 ? jm.zero : amt < 0 ? jm.neg : ""}`}>{amt === 0 ? "—" : fmtAmt(amt)}</span>
                      </td>
                      <td><span className={jm.ccy}>{r.CurrencyCode ?? r.currencyCode}</span></td>
                      <td className={jm.clip} title={r.RowText ?? r.rowText}>{r.RowText ?? r.rowText}</td>
                      <td><span className={`${jm.flag} ${posted ? jm.flagOk : jm.flagWarn}`}><span className={jm.flagDot} />{posted ? T("cell_yes") : T("cell_no")}</span></td>
                      <td><span className={`${jm.flag} ${sys ? jm.flagSys : jm.flagOff}`}><span className={jm.flagDot} />{sys ? T("cell_yes") : T("cell_no")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pie: totales de lo que se ve ── */}
        <div className={jm.foot}>
          <span className={jm.footCount}>{filtered.length} {T("entries")}</span>
          <div className={jm.footTotals}>
            <span className={jm.footItem}><em>{T("jrn_debit", "Debe")}</em><b>{fmtAmt(totals.debe)}</b></span>
            <span className={jm.footItem}><em>{T("jrn_credit", "Haber")}</em><b className={jm.neg}>{fmtAmt(totals.haber)}</b></span>
            <span className={`${jm.footItem} ${jm.footNet}`}><em>{T("jrn_net", "Neto")}</em><b className={Math.abs(totals.neto) < 0.005 ? jm.ok : totals.neto < 0 ? jm.neg : ""}>{Math.abs(totals.neto) < 0.005 ? "0,00" : fmtAmt(totals.neto)}</b></span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── MappingsLanding — 2 GIANT cards with full decoration stack ─────────── */
export function MappingsLanding({ T, colors, onPickStructure, onPickReport }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const PRIMARY_SOFT = "#3b54b8";
  const ACCENT = "#CF305D";
  const ACCENT_SOFT = "#e0558d";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* ─── Structure card (blue) ─── */}
        <button
          onClick={onPickStructure}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: `linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)`,
            boxShadow: `0 8px 32px -8px ${PRIMARY}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = PRIMARY; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          {/* Decoration layer */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {/* Dotted pattern */}
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${PRIMARY}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            {/* Big orb top-right */}
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${PRIMARY}18 0%, transparent 70%)`,
              animation: "floatOrb1 8s ease-in-out infinite",
            }} />
            {/* Small orb bottom-right */}
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${PRIMARY_SOFT}20 0%, transparent 70%)`,
              animation: "floatOrb2 11s ease-in-out 2s infinite",
            }} />
            {/* SVG rotating circles top-right */}
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "spinSlow 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "spinSlowR 20s linear infinite" }} />
            </svg>
          </div>

          {/* Content */}
          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              {/* Icon with glow */}
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                  filter: "blur(12px)",
                  transform: "translateY(4px)",
                  opacity: 0.2,
                }} />
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}>
                  <Layers size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>

<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("am_card_structure_title")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_structure_desc")}
              </p>
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
               {[T("am_std_pgc_full").includes("Plan") ? "PGC" : "PGC", T("am_std_spanish_ifrs_label"), T("am_std_danish_ifrs_full")].map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                    style={{ background: `${PRIMARY}15`, color: PRIMARY }}>
                    {s}
                  </span>
                ))}
              </div>
<span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: PRIMARY }}>
                {T("am_cta_open")}
              </span>
            </div>
          </div>
        </button>

        {/* ─── Report card (rose) ─── */}
        <button
          onClick={onPickReport}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)",
            boxShadow: `0 8px 32px -8px ${ACCENT}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          {/* Decoration layer */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${ACCENT}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
              animation: "floatOrb1 9s ease-in-out infinite",
            }} />
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${ACCENT_SOFT}20 0%, transparent 70%)`,
              animation: "floatOrb2 13s ease-in-out 1.5s infinite",
            }} />
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "spinSlowR 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "spinSlow 20s linear infinite" }} />
            </svg>
          </div>

          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                  filter: "blur(12px)",
                  transform: "translateY(4px)",
                  opacity: 0.2,
                }} />
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}>
                  <FileText size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>

<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("am_card_report_title")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_report_desc")}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
<span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                  style={{ background: `${ACCENT}15`, color: ACCENT }}>
                  {T("badge_coming_soon")}
                </span>
              </div>
              <span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: ACCENT }}>
                {T("btn_preview_arrow")}
              </span>
            </div>
          </div>
        </button>
      </div>

      <style>{`
        @keyframes floatOrb1 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(20px,-30px) scale(1.1); }
        }
        @keyframes floatOrb2 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-15px,20px) scale(0.95); }
        }
        @keyframes floatOrb3 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(25px,15px) scale(1.05); }
        }
        @keyframes spinSlow  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinSlowR { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
      `}</style>
    </div>
  );
}

/* ─── MappingsLibrary — list with compact mapping cards ──────────────────── */
export function MappingsLibrary({ T, colors, kind, activeMapping, mappings, loading, error, onApply, onClearActive, onRetry }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const ACCENT = kind === "report" ? "#CF305D" : PRIMARY;
  const Icon = kind === "report" ? FileText : Layers;
  const kindLabel = kind === "report" ? T("views_saved_report_mappings") : T("views_saved_mappings");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("views_library")}</p>
          <h2 className="font-black tracking-tight mt-0.5 text-gray-800" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
            {kindLabel}
          </h2>
        </div>
        {activeMapping && (
          <button onClick={onClearActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.15)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; }}>
<X size={10} strokeWidth={3} />
            {T("btn_clear_active")}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="overflow-y-auto flex-1 p-5">
        {loading ? (
          // Esqueleto de tarjetas mientras llegan los mapeos
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-busy="true" aria-label={T("views_loading_mappings")}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={jm.skelCard} style={{ "--i": i, "--jm-primary": ACCENT }}>
                <div className="flex items-center gap-2.5 mb-4">
                  <span className={jm.skel} style={{ width: 36, height: 36, borderRadius: 10 }} />
                  <div className="flex-1">
                    <span className={jm.skel} style={{ width: "62%", height: 12 }} />
                    <span className={jm.skel} style={{ width: "34%", height: 9, marginTop: 7 }} />
                  </div>
                </div>
                <span className={jm.skel} style={{ width: "90%", height: 9 }} />
                <span className={jm.skel} style={{ width: "70%", height: 9, marginTop: 6 }} />
                <div className="flex justify-between mt-5">
                  <span className={jm.skel} style={{ width: 90, height: 9 }} />
                  <span className={jm.skel} style={{ width: 64, height: 18, borderRadius: 8 }} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "rgba(220,38,38,0.1)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
<p className="text-sm font-bold text-red-600 mb-1">{T("error_failed_load")}</p>
            <p className="text-xs text-gray-400 mb-4">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="text-xs font-black uppercase tracking-widest underline" style={{ color: ACCENT }}>
                {T("btn_retry")}
              </button>
            )}
          </div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${ACCENT}10` }}>
              <Library size={20} style={{ color: ACCENT }} />
            </div>
<p className="text-sm font-bold text-gray-500 mb-1">{T("views_no_mappings")}</p>
            <p className="text-xs text-gray-400">{T("views_no_mappings_hint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mappings.map(m => {
              const isActive = activeMapping?.mapping_id === m.mapping_id;
              return (
                <button key={m.mapping_id}
                  onClick={() => onApply(m)}
                  className="relative text-left p-4 rounded-xl transition-all flex flex-col"
                  style={{
                    background: isActive ? `${ACCENT}06` : "white",
                    border: `2px solid ${isActive ? ACCENT : "rgba(0,0,0,0.05)"}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 12px -2px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>

                  {/* Top: icon + title + active badge */}
                  <div className="flex items-start gap-2.5 mb-3">
                    <div className="rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 36, height: 36,
                        background: isActive ? "white" : `${ACCENT}15`,
                        color: ACCENT,
                        border: isActive ? `1px solid ${ACCENT}30` : "none",
                      }}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
<p className="font-black text-sm text-gray-800 truncate" style={{ letterSpacing: "-0.01em" }}>
                          {m.name ?? T("views_untitled")}
                        </p>
                        {isActive && (
                          <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md flex-shrink-0"
                            style={{ background: ACCENT, color: "white" }}>
                            {T("views_active")}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: ACCENT, opacity: 0.7 }}>
                        {m.standard ?? T("am_filter_custom")}
                      </p>
                    </div>
                  </div>

                  {/* Description */}
                  {m.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-3">
                      {m.description}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="mt-auto pt-3 border-t border-gray-50 flex items-center justify-between">
<span className="text-[10px] text-gray-400">
                      {m.updated_at ? `${T("views_updated")} ${new Date(m.updated_at).toLocaleDateString()}` : "—"}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#059669" }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      {T("views_apply")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
