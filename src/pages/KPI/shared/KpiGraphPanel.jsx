/* ══════════════════════════════════════════════════════════════════════
   Vista de gráficos de KPIs (individual y consolidado)

   Piezas compartidas por las dos páginas:
     · GraphFilterCard   — tarjeta de filtros (cabecera + fila de pastillas)
     · GraphCompareRow   — fila de filtros de una comparación (B, C)
     · GraphKpiPicker    — selector de KPIs con buscador y colores de serie
     · GraphSegmented    — interruptor Mes / Año
     · KpiGraphPanel     — gráfico a la izquierda y tabla de datos a la
                           derecha (debajo en pantallas estrechas), con
                           cargador de progreso, resumen del último valor,
                           tooltip propio y periodo enlazado entre gráfico
                           y tabla.

   Cada página sigue calculando sus series; aquí solo se dibujan.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  BarChart3, Check, ChevronDown, Search, X, Table2, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
  ArrowUpRight, ArrowDownRight, Minus, LineChart as LineIcon,
} from "lucide-react";
import { useSettings } from "../../../components/layout/SettingsContext";
import ProgressLoader from "../../../components/framework/ProgressLoader.jsx";
import { useKpiText } from "./kpiText.js";
import g from "./kpiGraph.module.css";

const cx = (...a) => a.filter(Boolean).join(" ");

// Paleta de series (la primera es el color principal de Ajustes)
export function seriesPalette(primary = "#1a2f8a") {
  return [primary, "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#ec4899", "#84cc16", "#0ea5e9", "#a855f7"];
}

// "MM/YY" o "YYYY" → número ordenable (cronológico, no alfabético)
export function periodKey(p) {
  const s = String(p ?? "");
  if (s.includes("/")) {
    const [m, y] = s.split("/");
    return (2000 + Number(y)) * 100 + Number(m);
  }
  return Number(s) * 100;
}
export const sortPeriods = (list) => [...list].sort((a, b) => periodKey(a) - periodKey(b));

const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v)) && Number.isFinite(Number(v));

function compact(v) {
  if (!isNum(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(a >= 1 ? 1 : 2);
}

// ════════════════════════════════════════════════════════════════════════
// Filtros
// ════════════════════════════════════════════════════════════════════════
export function GraphFilterCard({ primary, title, busy, children, picker, right, below }) {
  const { locale } = useSettings();
  const kt = useKpiText(locale);
  return (
    <div className={g.filterCard} style={{ "--g-primary": primary }}>
      <div className={g.filterRow}>
        <div className={g.filterTitle}>
          <span className={g.filterIcon}><BarChart3 size={15} /></span>
          <span className={g.filterName}>{title ?? kt("g_title")}</span>
          {busy ? <span className={g.busyDot} aria-hidden="true" /> : null}
        </div>
        {picker ? <div className={g.filterLead}>{picker}</div> : null}
        <span className={g.filterSep} aria-hidden="true" />
        <div className={g.filterPills}>{children}</div>
        {right ? <div className={g.filterRight}>{right}</div> : null}
      </div>
      {below}
    </div>
  );
}

export function GraphCompareRow({ id, color, label, children, onRemove, removeLabel }) {
  return (
    <div className={g.cmpRow} style={{ "--g-tone": color }}>
      <div className={g.cmpBadge}><b>{id}</b><span>{label}</span></div>
      <div className={g.filterPills}>{children}</div>
      <button type="button" className={g.cmpRemove} onClick={onRemove} title={removeLabel} aria-label={removeLabel}><X size={13} /></button>
    </div>
  );
}

// Bloque plegable con las filas de comparación
export function GraphCompareGroup({ hidden = false, children }) {
  return (
    <div className={cx(g.cmpWrap, hidden && g.cmpWrapHidden)} aria-hidden={hidden || undefined}>
      <div>{children}</div>
    </div>
  );
}

// Botón para plegar / desplegar las comparaciones
export function GraphCollapseButton({ collapsed, onClick, title }) {
  return (
    <button type="button" className={cx(g.iconBtn, !collapsed && g.iconBtnFlip)} onClick={onClick} title={title} aria-label={title}>
      <ChevronDown size={15} />
    </button>
  );
}

export function GraphSegmented({ value, options, onChange }) {
  const i = Math.max(0, options.findIndex(o => o.value === value));
  return (
    <div className={g.seg} style={{ "--n": options.length, "--i": i }} role="tablist">
      <span className={g.segThumb} aria-hidden="true" />
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={cx(g.segBtn, o.value === value && g.segOn)} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function GraphAddCompare({ id, color, onClick }) {
  return (
    <button type="button" className={g.addCmp} style={{ "--g-tone": color }} onClick={onClick}>+ {id}</button>
  );
}

// ── Selector de KPIs ────────────────────────────────────────────────────
export function GraphKpiPicker({ kpis, isSystem, selected, onToggle, cap, colorOf }) {
  const { locale } = useSettings();
  const kt = useKpiText(locale);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onMove = () => setRect(btnRef.current?.getBoundingClientRect() ?? null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const match = (k) => !needle || String(k.label ?? "").toLowerCase().includes(needle);
  const system = kpis.filter(k => isSystem(k) && match(k));
  const custom = kpis.filter(k => !isSystem(k) && match(k));
  const selectedKpis = selected.map(id => kpis.find(k => k.id === id)).filter(Boolean);

  const left = rect ? Math.min(rect.left, window.innerWidth - 316) : 0;
  return (
    <>
      <button ref={btnRef} type="button" className={cx(g.kpiBtn, open && g.kpiBtnOn)}
        onClick={() => { setRect(btnRef.current?.getBoundingClientRect() ?? null); setOpen(o => !o); }}>
        <span className={g.kpiBtnLabel}>{kt("g_kpis")}</span>
        <span className={g.kpiDots}>
          {selectedKpis.slice(0, 5).map(k => <i key={k.id} style={{ background: colorOf(k.id) }} />)}
        </span>
        <b>{selected.length}</b>
        <ChevronDown size={13} className={g.kpiChevron} />
      </button>
      {open && rect && createPortal(
        <div ref={popRef} className={g.kpiPop} style={{ top: rect.bottom + 8, left: Math.max(8, left) }}>
          <label className={g.kpiSearch}>
            <Search size={14} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={kt("g_search")} />
            {q ? <button type="button" onClick={() => setQ("")} aria-label="clear"><X size={12} /></button> : null}
          </label>
          <div className={g.kpiCap}>
            <span>{kt("g_selected", { n: selected.length })}</span>
            <em>{kt("g_max", { n: cap })}</em>
          </div>
          <div className={g.kpiList}>
            {[[kt("g_system"), system, "sys"], [kt("g_custom"), custom, "cus"]].map(([title, list, key]) => list.length > 0 && (
              <div key={key} className={g.kpiGroup}>
                <span className={g.kpiGroupTitle}>{title}</span>
                {list.map(k => {
                  const on = selected.includes(k.id);
                  const full = !on && selected.length >= cap;
                  return (
                    <button key={k.id} type="button" disabled={full} onClick={() => onToggle(k.id)}
                      className={cx(g.kpiItem, on && g.kpiItemOn)} style={{ "--g-tone": on ? colorOf(k.id) : "#cbd5e1" }}>
                      <span className={g.kpiCheck}>{on ? <Check size={11} strokeWidth={3} /> : null}</span>
                      <span className={g.kpiItemLabel}>{k.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {system.length === 0 && custom.length === 0 && <p className={g.kpiEmpty}>{kt("g_no_results")}</p>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Panel: gráfico + tabla
// ════════════════════════════════════════════════════════════════════════
/*
  rows    : [{ period, [series.key]: number|null }]  (ya en orden cronológico)
  series  : [{ key, label, group?, color, dash?, format }]
  fmt     : (value, format) => string
  loading / progress { done, total }
  empty   : null | "pick" | "nodata"
*/
export default function KpiGraphPanel({
  rows = [], series = [], fmt, loading = false, progress = null, empty = null,
  primary = "#1a2f8a", secondary = "#CF305D", chartRef, compareMode = false, tableDefaultOpen = true,
}) {
  const { locale } = useSettings();
  const kt = useKpiText(locale);
  // Vista: "both" (gráfico + tabla), "chart" (solo gráfico) o "table" (solo
  // tabla). Se recuerda en este navegador.
  const [view, setView] = useState(() => {
    const fallback = tableDefaultOpen ? "both" : "chart";
    try {
      const v = localStorage.getItem("kpiGraphView");
      return ["both", "chart", "table"].includes(v) ? v : fallback;
    } catch { return fallback; }
  });
  const changeView = (v) => {
    setView(v);
    try { localStorage.setItem("kpiGraphView", v); } catch { /* sin almacenamiento */ }
  };
  const chartHidden = view === "table";
  const tableHidden = view === "chart";
  const [hover, setHover] = useState(null);        // { period, from: "chart" | "table" }
  const tableScrollRef = useRef(null);

  const anyValue = useMemo(() => rows.some(r => series.some(s => isNum(r[s.key]))), [rows, series]);
  const hasData = !empty && rows.length > 0 && series.length > 0 && anyValue;
  const formatOf = (s) => s?.format ?? "number";

  // Eje derecho para los % cuando se mezclan con importes
  const mixed = series.some(s => formatOf(s) === "percent") && series.some(s => formatOf(s) !== "percent");
  const axisOf = (s) => (mixed && formatOf(s) === "percent" ? "pct" : "main");

  // Área con degradado solo si hay pocas series (si no, se vuelve ruido)
  const fillAreas = series.length <= 3;
  // Con pocos puntos (vista por año) se marcan los puntos
  const showDots = rows.length <= 6;

  // Resumen: último valor y variación frente al anterior con dato
  const stats = useMemo(() => series.slice(0, 4).map(s => {
    const vals = rows.map(r => r[s.key]).filter(isNum).map(Number);
    const last = vals.length ? vals[vals.length - 1] : null;
    const prev = vals.length > 1 ? vals[vals.length - 2] : null;
    const delta = last !== null && prev !== null ? last - prev : null;
    const pct = delta !== null && prev !== 0 ? (delta / Math.abs(prev)) * 100 : null;
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { s, last, delta, pct, avg, spark: vals.slice(-12) };
  }), [rows, series]);

  // Máximo absoluto por columna para las barras de la tabla
  const colMax = useMemo(() => {
    const m = {};
    series.forEach(s => { m[s.key] = Math.max(0, ...rows.map(r => (isNum(r[s.key]) ? Math.abs(r[s.key]) : 0))); });
    return m;
  }, [rows, series]);
  const colAvg = useMemo(() => {
    const m = {};
    series.forEach(s => {
      const v = rows.map(r => r[s.key]).filter(isNum).map(Number);
      m[s.key] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });
    return m;
  }, [rows, series]);

  // Al pasar por el gráfico, la fila de la tabla se ilumina y se hace visible
  useEffect(() => {
    if (!hover || hover.from !== "chart" || !tableScrollRef.current) return;
    const tr = tableScrollRef.current.querySelector(`[data-period="${CSS.escape(String(hover.period))}"]`);
    if (!tr) return;
    const box = tableScrollRef.current;
    const top = tr.offsetTop, bottom = top + tr.offsetHeight;
    const headH = 44;
    if (top - headH < box.scrollTop) box.scrollTo({ top: top - headH - 4, behavior: "smooth" });
    else if (bottom > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: bottom - box.clientHeight + 44, behavior: "smooth" });
  }, [hover]);

  const fetchTotal = progress?.total ?? 0;
  const fetchDone = Math.min(progress?.done ?? 0, fetchTotal);
  const loaderSteps = [
    { key: "fetch", label: kt("g_step_fetch", { n: fetchTotal || "…" }), weight: 8,
      state: fetchTotal && fetchDone >= fetchTotal ? "done" : "active", progress: fetchTotal ? fetchDone / fetchTotal : 0 },
    { key: "calc", label: kt("g_step_calc"), weight: 2, state: fetchTotal && fetchDone >= fetchTotal ? "active" : "pending" },
  ];

  return (
    <div className={cx(g.panel, chartHidden && g.chartHidden, tableHidden && g.tableHidden)} style={{ "--g-primary": primary }}>
      {/* ── Gráfico ── */}
      <section className={cx(g.chartCard, chartHidden && g.collapsed)}>
        <div className={g.cardInner} aria-hidden={chartHidden || undefined}>
        <header className={g.cardHead}>
          <span className={g.cardIcon}><LineIcon size={14} /></span>
          <h3>{kt("g_chart")}</h3>
          {hasData ? <span className={g.cardMeta}>{kt("g_periods", { n: rows.length })} · {kt("g_series", { n: series.length })}</span> : null}
          {view === "both" && (
            <button type="button" className={g.tableToggle} onClick={() => changeView("table")} title={kt("g_hide_chart")}>
              <PanelLeftClose size={15} /><span>{kt("g_hide_chart")}</span>
            </button>
          )}
        </header>

        {hasData && (
          <div className={g.stats}>
            {stats.map(({ s, last, delta, pct, spark }, i) => {
              const up = delta > 0, down = delta < 0;
              return (
                <div key={s.key} className={g.stat} style={{ "--g-tone": s.color, "--i": i }}>
                  <span className={g.statLabel}>
                    <i style={{ background: s.color }} className={s.dash ? g.statDash : undefined} />
                    {s.group ? <b className={g.statGroup}>{s.group}</b> : null}
                    <span>{s.label}</span>
                  </span>
                  <span className={g.statValue}>{last === null ? "—" : fmt(last, formatOf(s))}</span>
                  <span className={g.statFoot}>
                    {pct !== null && isNum(pct) ? (
                      <span className={cx(g.delta, up && g.deltaUp, down && g.deltaDown)}>
                        {up ? <ArrowUpRight size={12} /> : down ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                        {`${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
                      </span>
                    ) : <span className={g.delta}>—</span>}
                    <small>{kt("g_vs_prev")}</small>
                  </span>
                  <Spark values={spark} color={s.color} />
                </div>
              );
            })}
          </div>
        )}

        <div ref={chartRef} className={g.chartArea}>
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%" debounce={40}>
              <ComposedChart data={rows} margin={{ top: 12, right: mixed ? 4 : 18, left: 4, bottom: 4 }}
                onMouseMove={(st) => { const p = st?.activeLabel; if (p !== undefined && p !== null && p !== hover?.period) setHover({ period: p, from: "chart" }); }}
                onMouseLeave={() => setHover(null)}>
                <defs>
                  {series.map(s => (
                    <linearGradient key={s.key} id={`kg-${s.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="#eef1f6" strokeDasharray="0" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: "#94a3b8", fontWeight: 600 }} axisLine={false} tickLine={false}
                  interval="preserveStartEnd" minTickGap={14} tickMargin={10} />
                <YAxis yAxisId="main" tick={{ fontSize: 10.5, fill: "#94a3b8", fontWeight: 600 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => (!mixed && series.every(s => formatOf(s) === "percent") ? `${compact(v)}%` : compact(v))} width={52} tickMargin={6} />
                {mixed && (
                  <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10.5, fill: "#94a3b8", fontWeight: 600 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${compact(v)}%`} width={44} tickMargin={6} />
                )}
                <ReferenceLine yAxisId="main" y={0} stroke="#dfe4ee" />
                {hover && hover.from === "table" && (
                  <ReferenceLine yAxisId="main" x={hover.period} stroke={primary} strokeOpacity={0.35} strokeDasharray="4 4" />
                )}
                <Tooltip cursor={{ stroke: primary, strokeOpacity: 0.18, strokeWidth: 28 }}
                  content={<ChartTooltip series={series} rows={rows} fmt={fmt} kt={kt} />} wrapperStyle={{ outline: "none" }} />
                {series.map(s => (fillAreas ? (
                  <Area key={s.key} yAxisId={axisOf(s)} type="monotone" dataKey={s.key} name={s.key}
                    stroke={s.color} strokeWidth={2.6} strokeDasharray={s.dash} fill={`url(#kg-${s.key.replace(/[^a-zA-Z0-9_-]/g, "_")})`}
                    dot={showDots ? { r: 4, strokeWidth: 2.5, stroke: "#fff", fill: s.color } : false} activeDot={{ r: 5.5, strokeWidth: 3, stroke: "#fff", fill: s.color }} connectNulls isAnimationActive animationDuration={700} />
                ) : (
                  <Line key={s.key} yAxisId={axisOf(s)} type="monotone" dataKey={s.key} name={s.key}
                    stroke={s.color} strokeWidth={2.4} strokeDasharray={s.dash}
                    dot={showDots ? { r: 3.5, strokeWidth: 2, stroke: "#fff", fill: s.color } : false} activeDot={{ r: 5, strokeWidth: 3, stroke: "#fff", fill: s.color }} connectNulls isAnimationActive animationDuration={700} />
                )))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : !loading ? (
            <div className={g.empty}>
              <span className={g.emptyIcon}><BarChart3 size={24} /></span>
              <strong>{empty === "pick" ? kt("g_pick_kpi") : kt("g_no_data")}</strong>
              <small>{empty === "pick" ? kt("g_hint_pick") : kt("g_hint_range")}</small>
            </div>
          ) : null}

          {hasData && series.length > 0 && (
            <div className={g.legend}>
              {series.map(s => (
                <span key={s.key} className={g.legendItem}>
                  <i className={s.dash ? g.legendDash : undefined} style={{ "--g-tone": s.color }} />
                  {s.group ? <b>{s.group}</b> : null}{s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <ProgressLoader visible={loading && !chartHidden} steps={loaderSteps} title={kt("g_loading")} subtitle={kt("g_loading_sub")}
          primary={primary} secondary={secondary} className={g.loader} />
        </div>
        <button type="button" className={g.rail} onClick={() => changeView("both")} tabIndex={chartHidden ? 0 : -1} title={kt("g_show_chart")}>
          <span className={g.railIcon}><LineIcon size={15} /></span>
          <span className={g.railText}>{kt("g_show_chart")}</span>
          <PanelLeftOpen size={15} className={g.railArrow} />
        </button>
      </section>

      {/* ── Tabla ── */}
        <section className={cx(g.tableCard, tableHidden && g.collapsed)}>
          <div className={g.cardInner} aria-hidden={tableHidden || undefined}>
          <header className={g.cardHead}>
            <span className={g.cardIcon}><Table2 size={14} /></span>
            <h3>{kt("g_table")}</h3>
            {hasData ? <span className={g.cardMeta}>{kt("g_periods", { n: rows.length })}</span> : null}
            {view === "both" && (
              <button type="button" className={g.tableToggle} onClick={() => changeView("chart")} title={kt("g_hide_table")}>
                <PanelRightClose size={15} /><span>{kt("g_hide_table")}</span>
              </button>
            )}
          </header>
          <div ref={tableScrollRef} className={g.tableScroll}>
            {loading && !hasData ? (
              <div className={g.skeleton}>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--i": i }} />)}</div>
            ) : !hasData ? (
              <div className={g.tableEmpty}><Table2 size={18} /><span>{empty === "pick" ? kt("g_pick_kpi") : kt("g_no_data")}</span></div>
            ) : (
              <table className={cx(g.table, compareMode && g.tableCmp)}>
                <thead>
                  <tr>
                    <th className={g.thPeriod}>{kt("g_period")}</th>
                    {series.map(s => (
                      <th key={s.key} style={{ "--g-tone": s.color }}>
                        <span className={g.thInner}>
                          <i className={s.dash ? g.legendDash : undefined} />
                          {s.group ? <b>{s.group}</b> : null}
                          <span>{s.label}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={r.period} data-period={r.period} style={{ "--ri": Math.min(ri, 24) }}
                      className={hover?.period === r.period ? g.rowOn : undefined}
                      onMouseEnter={() => setHover({ period: r.period, from: "table" })}
                      onMouseLeave={() => setHover(h => (h?.from === "table" ? null : h))}>
                      <td className={g.tdPeriod}>{r.period}</td>
                      {series.map(s => {
                        const v = r[s.key];
                        const ok = isNum(v);
                        const w = ok && colMax[s.key] ? Math.max(4, (Math.abs(v) / colMax[s.key]) * 100) : 0;
                        return (
                          <td key={s.key} style={{ "--g-tone": s.color }} className={cx(!ok && g.tdNull, ok && v < 0 && g.tdNeg)}>
                            {ok ? <span className={g.bar} style={{ width: `${w}%` }} aria-hidden="true" /> : null}
                            <span className={g.val}>{ok ? fmt(v, formatOf(s)) : "—"}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={g.tdPeriod}>{kt("g_avg_row")}</td>
                    {series.map(s => (
                      <td key={s.key} style={{ "--g-tone": s.color }}>
                        <span className={g.val}>{isNum(colAvg[s.key]) ? fmt(colAvg[s.key], formatOf(s)) : "—"}</span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          </div>
          <button type="button" className={g.rail} onClick={() => changeView("both")} tabIndex={tableHidden ? 0 : -1} title={kt("g_show_table")}>
            <span className={g.railIcon}><Table2 size={15} /></span>
            <span className={g.railText}>{kt("g_show_table")}</span>
            <PanelRightOpen size={15} className={g.railArrow} />
          </button>
        </section>
    </div>
  );
}

// Mini serie del resumen
function Spark({ values, color }) {
  if (!values || values.length < 2) return <span className={g.spark} />;
  const w = 84, h = 26;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - lo) / span) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className={g.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.6" fill={color} />
    </svg>
  );
}

// Tooltip propio: valor de cada serie y cambio frente al periodo anterior
function ChartTooltip({ active, label, series, rows, fmt, kt }) {
  if (!active || label === undefined || label === null) return null;
  const idx = rows.findIndex(r => r.period === label);
  if (idx < 0) return null;
  const row = rows[idx];
  const prev = idx > 0 ? rows[idx - 1] : null;
  return (
    <div className={g.tip}>
      <div className={g.tipHead}>{label}</div>
      {series.map(s => {
        const v = row[s.key];
        const p = prev ? prev[s.key] : null;
        const pct = isNum(v) && isNum(p) && p !== 0 ? ((v - p) / Math.abs(p)) * 100 : null;
        return (
          <div key={s.key} className={g.tipRow}>
            <i style={{ background: s.color }} />
            <span className={g.tipLabel}>{s.group ? <b>{s.group}</b> : null}{s.label}</span>
            <span className={g.tipVal}>{isNum(v) ? fmt(v, s.format) : "—"}</span>
            {pct !== null ? (
              <span className={cx(g.tipDelta, pct > 0 && g.deltaUp, pct < 0 && g.deltaDown)}>{`${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>
            ) : <span className={g.tipDelta} />}
          </div>
        );
      })}
      {prev ? <div className={g.tipFoot}>{kt("g_vs_prev")} · {prev.period}</div> : null}
    </div>
  );
}