/* ══════════════════════════════════════════════════════════════════════
   Piezas del cash flow (individual y consolidado) que no son la tabla: el indicador de
   carga, el multiperiodo (selector de meses, etiqueta y cargador) y el
   modal de exportación (Excel / PDF).
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Download, Loader2, X } from "lucide-react";
import { useSettings } from "../../../components/layout/SettingsContext";
import ProgressLoader from "../../../components/framework/ProgressLoader.jsx";
import { closesNeeded, describePeriods } from "./cashFlowUtils.js";
import styles from "./CashFlow.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");

/* ─── Indicador de carga ─────────────────────────────────────────────────
   El cargador común de la aplicación (el mismo de la Home): anillo con el
   porcentaje real y las fases de la carga (periodos, plan de cuentas, datos).
   El porcentaje nunca baja y, al terminar, sube al 100 % y se desvanece. */
const CF_TEXT = {
  es: {
    meta: "Periodos", accounts: "Plan de cuentas", data: "Datos",
    months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    month: "Mes", pickMonths: "Elige meses", nMonths: (n) => `${n} ${n === 1 ? "mes" : "meses"}`,
    multiTitle: "Calculando el total", multiReading: (n) => `Leyendo ${n} cierres`, multiSumming: (n) => `Sumando ${n} meses`, multiOf: "Total de",
  },
  en: {
    meta: "Periods", accounts: "Chart of accounts", data: "Data",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    month: "Month", pickMonths: "Pick months", nMonths: (n) => `${n} ${n === 1 ? "month" : "months"}`,
    multiTitle: "Calculating the total", multiReading: (n) => `Reading ${n} closes`, multiSumming: (n) => `Adding up ${n} months`, multiOf: "Total of",
  },
  da: {
    meta: "Perioder", accounts: "Kontoplan", data: "Data",
    months: ["Januar", "Februar", "Marts", "April", "Maj", "Juni", "Juli", "August", "September", "Oktober", "November", "December"],
    month: "Måned", pickMonths: "Vælg måneder", nMonths: (n) => `${n} ${n === 1 ? "måned" : "måneder"}`,
    multiTitle: "Beregner totalen", multiReading: (n) => `Læser ${n} lukninger`, multiSumming: (n) => `Lægger ${n} måneder sammen`, multiOf: "Total af",
  },
};
export function useCfText() {
  const { locale } = useSettings();
  return CF_TEXT[locale] ?? CF_TEXT[String(locale ?? "").slice(0, 2)] ?? CF_TEXT.en;
}

export function CfLoadingSpinner({ colors, metaReady, accountsReady = false, dataReady = false, T, subtitle }) {
  const tx = useCfText();
  const step = (key, done, active) => ({ key, label: tx[key], state: done ? "done" : active ? "active" : "pending" });
  const steps = [
    { ...step("meta", metaReady, true), weight: 2 },
    // El plan de cuentas y los datos se piden a la vez
    { ...step("accounts", accountsReady, metaReady), weight: 2 },
    { ...step("data", dataReady, metaReady), weight: 5 },
  ];
  return (
    <div className={styles.spinnerWrap}>
      <ProgressLoader
        className={styles.loader}
        primary={colors.primary ?? "#1a2f8a"}
        secondary={colors.secondary ?? "#CF305D"}
        title={!metaReady ? T("cf_loading_finding_period") : T("cf_loading_building")}
        subtitle={subtitle ?? T("cf_individual_title")}
        steps={steps}
      />
    </div>
  );
}

/* ─── Multiperiodo: selector de meses, qué se suma y cargador ─────────── */

// Selector "Mes": varios meses por año (los años se eligen en el filtro Año)
export function CfMonthsPill({ periods, singleYear, singleMonth, onChange, primary = "#1a2f8a" }) {
  const tx = useCfText();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // Sin selección múltiple todavía: el año y el mes actuales son el punto de partida
  const effPeriods = periods.length > 0
    ? periods
    : (singleYear ? [{ year: String(singleYear), months: singleMonth ? [Number(singleMonth)] : [] }] : []);
  const toggleMonth = (year, mo) => onChange(effPeriods.map(p => {
    if (p.year !== year) return p;
    const has = p.months.includes(mo);
    return { ...p, months: has ? p.months.filter(m => m !== mo) : [...p.months, mo].sort((a, b) => a - b) };
  }));
  const setYearMonths = (year, months) => onChange(effPeriods.map(p => (p.year === year ? { ...p, months } : p)));
  const withMonths = effPeriods.filter(p => p.months?.length);
  const total = withMonths.reduce((n, p) => n + p.months.length, 0);
  const label = effPeriods.length
    ? (total === 0 ? tx.pickMonths : total === 1 ? (tx.months[withMonths[0].months[0] - 1] ?? tx.nMonths(1)) : tx.nMonths(total))
    : (singleMonth ? (tx.months[Number(singleMonth) - 1] ?? tx.month) : tx.month);
  const showLabel = hover || open;
  const box = (on) => (
    <span className={cx(styles.monthBox, on && styles.monthBoxOn)}>
      {on && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );
  return (
    <div ref={ref} className={styles.monthPill} style={{ "--cf-primary": primary }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className={cx(styles.monthBtn, (open || hover) && styles.monthBtnOn)} onClick={() => setOpen(o => !o)}>
        <span className={cx(styles.monthKicker, showLabel && styles.monthKickerOn)}>{tx.month}</span>
        <span className={styles.monthLabel}>{label}</span>
        <ChevronDown size={11} className={cx(styles.monthChev, open && styles.monthChevOpen)} />
      </button>
      {open && (
        <div className={styles.monthMenu}>
          {effPeriods.map((p, pi) => {
            const allOn = p.months.length === 12;
            return (
              <div key={p.year} className={pi > 0 ? styles.monthYearSep : undefined}>
                <button type="button" className={cx(styles.monthItem, styles.monthYear)}
                  onClick={() => setYearMonths(p.year, allOn ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])}>
                  {box(allOn)}{p.year}
                </button>
                {tx.months.map((lbl, i) => {
                  const mo = i + 1;
                  return (
                    <button key={mo} type="button" className={styles.monthItem} onClick={() => toggleMonth(p.year, mo)}>
                      {box(p.months.includes(mo))}<span>{lbl}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Texto de la selección para exportaciones y el modal: "2026: Jul–Sep · 2025: Dic"
export function cfPeriodsText(periods, months) {
  return describePeriods(periods, (m) => months[m - 1]).lines.map(l => `${l.year}: ${l.text}`).join(" · ");
}

// Qué se está sumando, junto al título de la columna de cuentas
export function CfMultiBadge({ periods }) {
  const tx = useCfText();
  const { lines, count } = describePeriods(periods, (m) => tx.months[m - 1]);
  if (!count) return null;
  return (
    <span className={styles.multiBadge} title={`${tx.multiOf} ${tx.nMonths(count)}\n${lines.map(l => `${l.year}: ${l.text}`).join("\n")}`}>
      <span className={styles.multiCount}>{tx.nMonths(count)}</span>
      {lines.slice(0, 2).map(l => <span key={l.year} className={styles.multiLine}><b>{l.year}</b>{l.text}</span>)}
      {lines.length > 2 ? <span className={styles.multiMore}>+{lines.length - 2}</span> : null}
    </span>
  );
}

// Mientras se calcula el total: la tabla se queda detrás, atenuada
export function CfMultiLoader({ periods, progress, colors }) {
  const tx = useCfText();
  const { lines, count } = describePeriods(periods, (m) => tx.months[m - 1]);
  const total = progress?.total || 0;
  const done = Math.min(progress?.done ?? 0, total);
  const fetched = total > 0 && done >= total;
  return (
    <ProgressLoader
      className={styles.multiLoader}
      primary={colors?.primary ?? "#1a2f8a"}
      secondary={colors?.secondary ?? "#CF305D"}
      title={tx.multiTitle}
      subtitle={lines.map(l => `${l.year} · ${l.text}`).join("   ")}
      steps={[
        { key: "read", label: tx.multiReading(closesNeeded(periods)), weight: 8, state: fetched ? "done" : "active", progress: total ? done / total : 0 },
        { key: "sum", label: tx.multiSumming(count), weight: 2, state: fetched ? "active" : "pending" },
      ]}
    />
  );
}

/* ─── Modal de exportación ─────────────────────────────────────────── */
export function CashFlowExportModal({
  T, colors, exportOpts, setExportOpts, cmpVisible, activeMapping,
  year, month, source, cmpYear, cmpMonth, cmpSource, exporting, onDownload, onClose, periodText = null,
}) {
  const options = [
    ["includeBreakers", T("export_opt_breakers") || "Cabeceras de sección"],
    ["drilldown", T("export_opt_drilldown") || "Drill-down (colapsado)"],
    ["includeTotals", T("export_opt_totals") || "Totales de fila"],
    ["includeCompare", T("export_opt_compare") || "Columnas de comparación"],
  ];
  const mapped = activeMapping && !activeMapping.is_hidden && activeMapping.name !== "__custom_override__";
  const monthName = (m) => T(`month_${parseInt(m)}`) || m;

  return createPortal(
    <div className={styles.modalOverlay} style={{ "--cf-primary": colors.primary }} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <div className={styles.modalHeadMain}>
            <span className={styles.modalIcon}><Download size={16} /></span>
            <div>
              <h3 className={styles.modalTitle}>{T("export_cf_title") || "Exportar Cash Flow"}</h3>
              <div className={styles.badges}>
                <span className={styles.badge}>
                  {exportOpts.format === "pdf" ? T("badge_pdf") || "PDF" : T("badge_excel") || "EXCEL"}
                </span>
                {mapped && <span className={cx(styles.badge, styles.badgeOk)}>{T("badge_mapped") || "MAPEADO"}</span>}
              </div>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className={styles.modalBody}>
          <div>
            <p className={styles.modalLabel}>{T("export_design_opts") || "Opciones de diseño"}</p>
            <div className={styles.optGrid}>
              {options.map(([key, label]) => {
                const disabled = (key === "includeCompare" && !cmpVisible)
                  || (key === "includeTotals" && cmpVisible && exportOpts.includeCompare);
                const checked = !!exportOpts[key] && !disabled;
                return (
                  <button key={key} type="button" disabled={disabled} className={cx(styles.opt, checked && styles.optOn)}
                    onClick={() => !disabled && setExportOpts(o => ({ ...o, [key]: !o[key] }))}>
                    <span className={styles.optBox}>
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={styles.modalLabel}>{T("primary_period") || "Periodo"}</p>
            <div className={styles.periodChip}>
              <span className={styles.periodTag}>A</span>
              <div>
                <div className={styles.periodName}>{T("period_a") || "Periodo A"}</div>
                <div className={styles.periodValue}>
                  {periodText || (year && month ? `${monthName(month)} ${year}` : "—")}{source ? ` · ${source}` : ""}
                </div>
              </div>
            </div>
            {cmpVisible && exportOpts.includeCompare && (
              <div className={styles.periodChip}>
                <span className={cx(styles.periodTag, styles.periodTagB)}>B</span>
                <div>
                  <div className={styles.periodName}>{T("period_b") || "Periodo B"}</div>
                  <div className={styles.periodValue}>
                    {cmpYear && cmpMonth ? `${monthName(cmpMonth)} ${cmpYear}` : "—"}{cmpSource ? ` · ${cmpSource}` : ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.modalFoot}>
          <div className={styles.formatToggle}>
            {["xlsx", "pdf"].map(f => (
              <button key={f} type="button" className={cx(styles.formatBtn, exportOpts.format === f && styles.formatOn)}
                onClick={() => setExportOpts(o => ({ ...o, format: f }))}>
                {f}
              </button>
            ))}
          </div>
          <button type="button" className={styles.downloadBtn} onClick={onDownload} disabled={exporting}>
            {exporting
              ? <><Loader2 size={12} className={styles.spin} /><span>{T("btn_exporting") || "Exportando…"}</span></>
              : <><Download size={12} /><span>{T("btn_download") || "Download"}</span></>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}