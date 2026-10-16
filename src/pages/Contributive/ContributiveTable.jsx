/* ══════════════════════════════════════════════════════════════════════
   Contribución — la tabla: filas (estándar y mapeo), columnas por sociedad
   con su desglose (Uploaded, AJE, RJE, EJE, SYS, IC) y comparación.
   ══════════════════════════════════════════════════════════════════════ */
import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useDeferredValue } from "react";
import { t } from "../../lib/i18n";
import { createPortal } from "react-dom";
import { useTypo, useLocale } from "../../components/layout/SettingsContext";
import styles from "./Contributive.module.css";
import { ChevronDown, X, Search, BarChart2 } from "lucide-react";
import { SUB_COLS, fmtAmt, getContributionCurrency, pgcSort, computeLiteralForCompany, computeLiteralJournalForCompany, computeLiteralCounterpartyForCompany, INDENT, getCompanyCurrency } from "./contributiveUtils.js";

/* ─── useCountUp ─────────────────────────────────────────────────────────── */
function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const from = Number(fromRef.current) || 0;
    const to = Number(target) || 0;
    if (from === to) { setDisplay(to); return; }
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);
  return display;
}


// Pivots en la divisa del grupo (para la columna consolidada y los %).
const GroupPivotCtx = createContext(null);
// "Ver en gráficos" desde la fila: (cuenta) => abre la vista de gráficos en ella
const AnalyzeCtx = createContext(null);

// Celdas de comparación con el mismo aspecto que el cash flow.
const deltaClass = (v) => (!v ? styles.zero : v > 0 ? styles.up : styles.down);
const deltaPillClass = (v) => (!v ? "" : v > 0 ? styles.deltaUp : styles.deltaDown);
const fmtDelta = (v) => (v === 0 ? "—" : `${v > 0 ? "+" : "−"}${fmtAmt(Math.abs(v))}`);
const fmtDeltaPct = (p) => {
  if (p === null || !Number.isFinite(p)) return "—";
  const r = Math.round(p * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1).replace(".", ",")}%`;
};

function AnimatedValueCell({ value, className, style, onClick }) {
  const animated = useCountUp(value ?? 0, 900);
  const rounded = Math.round((value ?? 0) * 100) / 100; // céntimos: 0,11 no es "—"
  const isNeg = (value ?? 0) < 0;
  return (
    <td className={className} style={style} onClick={onClick} data-cell-click={onClick ? "" : undefined}>
      {rounded === 0 ? <span className={`${styles.val} ${styles.zero}`}>—</span> : (
        <span className={`${styles.val} ${isNeg ? styles.neg : ""}`}>{fmtAmt(animated)}</span>
      )}
    </td>
  );
}

// Animated number span — count-up on value change (e.g. YTD ⇄ monthly toggle).
function AnimatedAmount({ value }) {
  const animated = useCountUp(value ?? 0, 900);
  return <>{fmtAmt(animated)}</>;
}

const PivotRow = React.memo(function PivotRow({
  node, depth, expandedSet, onToggle, cols, pivot, onCellClick,
  expandedColsMap, journalPivot, compareMode, cmpPivot,
  counterpartyPivot = new Map(),
  isOpen = null, rowMatchesSelf = () => false,
  body1Style, body2Style, colors,
  perspectiveMode, rowIndex = 0,
  breakers = {}, totalColSpan = 10, breakerSortOrder = new Map(),
  rowMatchesDims = null,
pivotPrev = null, ytdOnly = true,
  cmpPivotPrev = null,
}) {
const subbody1Style = useTypo("subbody1");

const code        = node.AccountCode;
  // _noExpand rows (e.g. CF.D1s grand total) keep their children for value computation
  // but must not be expandable in the UI — they render as a single loose row.
  const hasRealChildren = node.children?.length > 0;
  const hasChildren = hasRealChildren && !node._noExpand;
  const isExpanded  = isOpen ? isOpen(code) : expandedSet.has(code);
  const isSummary   = /\.S$/i.test(code) || hasRealChildren;
  const rowStyle    = depth === 0 ? body1Style : body2Style;
  const isMatch     = rowMatchesSelf(node);

const getValFrom = (piv, co) => {
    if (!piv) return 0;
    if (hasRealChildren) {
      let total = 0;
      const walk = (n) => {
        if (n.children && n.children.length > 0) {
          n.children.forEach(walk);
          return;
        }
        const c = piv.get(n.AccountCode)?.[co];
        if (!c) return;
        const nDims = n._dims;
        if (Array.isArray(nDims) && nDims.length > 0 && Array.isArray(c.rows) && typeof rowMatchesDims === "function") {
          c.rows.forEach(r => { if (rowMatchesDims(r, nDims)) total += Number(r._amt ?? 0); });
        } else {
          total += Number(c.total ?? 0);
        }
      };
walk(node);
      return total;
    }
    const cell = piv.get(code)?.[co];
    if (!cell) return 0;
    const nodeDims = node._dims;
    if (Array.isArray(nodeDims) && nodeDims.length > 0 && Array.isArray(cell.rows) && typeof rowMatchesDims === "function") {
      let total = 0;
      cell.rows.forEach(r => {
        if (!rowMatchesDims(r, nodeDims)) return;
        total += Number(r._amt ?? 0);
      });
      return total;
    }
    return Number(cell.total ?? 0);
  };
const getVal = co => {
    const curr = getValFrom(pivot, co);
    if (ytdOnly || !pivotPrev) return curr;
    const nodeType = node.AccountType ?? node.accountType ?? "";
// Balance sheet and cash flow accounts are always YTD (never monthly delta)
    if (nodeType === "B/S" || nodeType === "C/F" || nodeType === "CFS") return curr;
    const prev = getValFrom(pivotPrev, co);
    return curr - prev;
  };
  const getJp    = co => journalPivot?.get(code)?.[co] ?? {};
  const getSaldo = co => getVal(co);

  const rowTotal    = cols.reduce((s, co) => s + getVal(co), 0);
  // Consolidado del grupo y % SIEMPRE en la divisa del grupo (en modo local
  // las sociedades están cada una en su moneda).
  const gp = useContext(GroupPivotCtx);
  const analyze = useContext(AnalyzeCtx);
  const getValG = co => {
    if (!gp?.pivot) return getVal(co);
    const curr = getValFrom(gp.pivot, co);
    if (ytdOnly || !gp.pivotPrev) return curr;
    const nt = node.AccountType ?? node.accountType ?? "";
    if (nt === "B/S" || nt === "C/F" || nt === "CFS") return curr;
    return curr - getValFrom(gp.pivotPrev, co);
  };
  const parentTotal = perspectiveMode ? cols.reduce((s, co) => s + getValG(co), 0) : 0;

  const cellStyle = (v) => {
    const baseColor = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
    return { ...rowStyle, color: baseColor };
  };

  return (
    <>
<tr onClick={(e) => { if (hasChildren && !e.target.closest("[data-cell-click]")) onToggle(code); }}
        className={`${styles.row} ${isSummary ? styles.sumRow : ""} border-b transition-colors group ${hasChildren ? "cursor-pointer" : ""}
        ${isMatch ? "bg-[#fef3c7] border-amber-200" : (isSummary ? "bg-[#ffffff] border-[#1a2f8a]/5" : "bg-white border-gray-200 hover:bg-[#f8f9ff]")}`}
style={{
          animation: rowIndex < 25
            ? (depth === 0
              ? `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${rowIndex * 35 + 50}ms both`
              : `rowExpandIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 15) * 25}ms both`)
            : "none",
          transformOrigin: "top center",
          // Skip layout/paint for off-screen rows. Massive speedup for sidebar
          // animations (and scrolling) when many columns are expanded.
          // contain-intrinsic-size hints the row's placeholder height so the
          // scrollbar remains stable while rows are "skipped".
contentVisibility: "auto",
          // `auto 48px` lets the browser REMEMBER the actual measured height
          // per row after first render, instead of using the fixed 48 estimate.
          // Much more stable scrollbar and better skip decisions.
          containIntrinsicSize: "auto 48px",
        }}>

        {/* Account — sticky left */}
        <td className={`py-2.5 sticky left-0 z-10 border-r border-gray-100
          ${isMatch ? "bg-[#fef3c7]" : (isSummary ? "bg-[#ffffff]" : "bg-white group-hover:bg-[#f8f9ff]")}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px` }}>
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}
            >
{hasChildren
              ? <span className="flex-shrink-0 mr-2" style={{ color: rowStyle?.color, display: "inline-flex", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)", transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
                  <ChevronDown size={12}/>
                </span>
              : <span className="inline-block mr-2" style={{ width: 12 }} />}
<span className={`flex-shrink-0 mr-2 ${styles.code}`} style={subbody1Style}>{code}</span>
            <span className="truncate" style={{ ...rowStyle, fontWeight: hasChildren ? 800 : rowStyle.fontWeight }}>
              {node.AccountName ?? node.accountName ?? ""}
            </span>
            {analyze && (
              <button type="button" data-cell-click="" className={styles.analyzeBtn}
                title={analyze.label} aria-label={`${analyze.label}: ${node.AccountName ?? code}`}
                onClick={(e) => { e.stopPropagation(); analyze.open(node); }}>
                <BarChart2 size={12} strokeWidth={2.6} />
              </button>
            )}
          </div>
        </td>

{/* Parent consolidated column (only in perspective mode) */}
        {perspectiveMode && (
          <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200"
            style={{ minWidth: 160, backgroundColor: "#eef1fb", ...cellStyle(parentTotal) }}>
            {parentTotal === 0 ? <span className="text-gray-300">—</span> : fmtAmt(parentTotal)}
          </td>
        )}

        {/* Per-company values */}
        {cols.flatMap(co => {
          const val        = getVal(co);
          const rows       = pivot.get(code)?.[co]?.rows ?? [];
          const isExpanded = !!expandedColsMap[co];
          const jp         = getJp(co);
          const saldo      = getSaldo(co);

          // Percentage of parent (only meaningful in perspective mode)
          const pct = perspectiveMode && parentTotal !== 0
            ? (getValG(co) / parentTotal) * 100
            : null;

const mainTd = (
            <AnimatedValueCell key={co}
              value={saldo}
              className={`px-4 py-2.5 text-center whitespace-nowrap ${styles.coStart} ${isExpanded ? styles.coOpen : ""}
                ${val !== 0 && rows.length > 0 ? "cursor-pointer" : ""}`}
              style={{ minWidth: 130, ...cellStyle(saldo), color: undefined }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}
              isSummary={isSummary}
            />
          );

          // Percentage cell (perspective mode only)
          const pctTd = perspectiveMode ? (
            <td key={`${co}-pct`}
              className={`px-2 py-2.5 text-center whitespace-nowrap ${styles.pctCell}`}
              style={{ minWidth: 70, ...rowStyle }}>
              {pct === null || pct === 0 || !isFinite(pct) ? (
                <span className="text-gray-300 text-[10px]">—</span>
              ) : (
                <span className={`${styles.val} ${styles.pct}`}>{pct.toFixed(1).replace(".", ",")}%</span>
              )}
            </td>
          ) : null;

const cmpVal = compareMode ? (() => {
            // Roll up children for sum rows, same as getValFrom does for the main value.
            // cmpPivot stores scalars (not {total}), so sum leaves directly.
const cmpFrom = (piv, c) => {
              if (!piv) return 0;
              if (hasRealChildren) {
                let total = 0;
                const walk = (n) => {
                  const ch = n.children || [];
                  if (ch.length) { ch.forEach(walk); return; }
                  total += Number(piv.get(n.AccountCode)?.[c] ?? 0);
                };
                walk(node);
                return total;
              }
              return Number(piv.get(code)?.[c] ?? 0);
            };
            const currCmp = cmpFrom(cmpPivot, co);
            const nt = node.AccountType ?? node.accountType ?? "";
            if (ytdOnly || !cmpPivotPrev || nt === "B/S" || nt === "C/F" || nt === "CFS") return currCmp;
            const prevCmp = cmpFrom(cmpPivotPrev, co);
            return currCmp - prevCmp;
          })() : 0;
          const dev = compareMode ? saldo - cmpVal : 0;
          const devPct = compareMode && cmpVal !== 0 ? (dev / Math.abs(cmpVal)) * 100 : null;
          const cmpTd = compareMode ? (
            <AnimatedValueCell key={`${co}-cmp`}
              value={cmpVal}
              className={`px-4 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.cmp1}`}
              style={{ minWidth: 130, ...rowStyle, color: undefined }}
              isSummary={isSummary}
            />
          ) : null;
          const deltaTd = compareMode ? (
            <td key={`${co}-delta`}
              className={`px-4 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.cmp2} ${deltaClass(Math.round(dev * 100) / 100)}`}
              style={{ minWidth: 110, ...rowStyle, color: undefined }}>
              <span className={`${styles.val} ${deltaPillClass(Math.round(dev * 100) / 100)}`}>{fmtDelta(Math.round(dev * 100) / 100)}</span>
            </td>
          ) : null;
          const pctDeltaTd = compareMode ? (
            <td key={`${co}-deltapct`}
              className={`px-3 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.cmp3} ${deltaClass(devPct === null ? 0 : Math.round(devPct * 10) / 10)}`}
              style={{ minWidth: 80, ...rowStyle, color: undefined }}>
              <span className={`${styles.val} ${deltaPillClass(devPct === null ? 0 : Math.round(devPct * 10) / 10)}`}>{fmtDeltaPct(devPct)}</span>
            </td>
          ) : null;
          if (!isExpanded) return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : [])];

// Uploaded = Total - Σ(all journal types). This is the ERP carry (pre-journals).
          // Uploaded = carga de la sociedad (uploaded-accounts).
          const uploadedVal = Number(jp.Uploaded) || 0;
          const uploadedTd = (
            <td key={`${co}-uploaded`}
              className={`px-3 py-2.5 text-center whitespace-nowrap ${styles.subCell} ${styles.subFirst}`}
              data-cell-click=""
              style={{ minWidth: 110, ...cellStyle(uploadedVal), color: undefined }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}>
              <span className={`${styles.val} ${Math.abs(uploadedVal) < 0.005 ? styles.zero : uploadedVal < 0 ? styles.neg : ""}`}>{Math.abs(uploadedVal) < 0.005 ? "—" : fmtAmt(uploadedVal)}</span>
            </td>
          );

const subTds = SUB_COLS.map((sc, idx) => {
            const subVal = jp[sc.key] ?? 0;
            return (
              <td key={`${co}-${sc.key}`}
                className={`px-3 py-2.5 text-center whitespace-nowrap ${styles.subCell}`}
                style={{ minWidth: 100, ...cellStyle(subVal), color: undefined, "--sub-i": idx + 1 }}>
                <span className={`${styles.val} ${subVal === 0 ? styles.zero : subVal < 0 ? styles.neg : ""}`}>{subVal === 0 ? "—" : fmtAmt(subVal)}</span>
              </td>
            );
          });

// IC cell — counterparty impact (always shown when company is expanded)
          const icVal = counterpartyPivot.get(code)?.[co] ?? 0;
          const icTd = (
            <td key={`${co}-ic`}
              className={`px-3 py-2.5 text-center whitespace-nowrap ${styles.icCell} ${styles.coEnd}`}
              style={{ minWidth: 110, ...rowStyle, color: undefined }}>
              <span className={`${styles.val} ${icVal === 0 ? styles.zero : icVal < 0 ? styles.neg : ""}`}>{icVal === 0 ? "—" : fmtAmt(icVal)}</span>
            </td>
          );

          return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : []), uploadedTd, ...subTds, icTd];
        })}

{!perspectiveMode && (
<td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100 sticky right-0 z-10"
    style={{ minWidth: 140, backgroundColor: "#fafafa", ...cellStyle(rowTotal) }}>
    {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
  </td>
)}
      </tr>

{isExpanded && hasChildren && (() => {
        const inMapping = node.children.filter(c => breakerSortOrder.has(c.AccountCode));
        const notInMapping = node.children.filter(c => !breakerSortOrder.has(c.AccountCode));
        const hasAnyMapping = inMapping.length > 0;
        const sorted = hasAnyMapping
          ? [
              ...notInMapping.sort((a, b) => pgcSort(a, b)),
              ...inMapping.sort((a, b) => (breakerSortOrder.get(a.AccountCode) ?? 9999) - (breakerSortOrder.get(b.AccountCode) ?? 9999)),
            ]
          : node.children;
return sorted.map((child, ci) => {
        const anchorBreaker = child._sectionAnchor && child._sectionInfo
          ? { label: child._sectionInfo.label, color: child._sectionInfo.color }
          : null;
        const breaker = anchorBreaker ?? breakers[child.AccountCode] ?? null;
        if (child._sectionAnchor) {
          // Empty section: show only the breaker header, no row.
          return (
            <React.Fragment key={child.AccountCode}>
              {breaker && (
                <BreakerRow label={breaker.label} color={breaker.color} colSpan={totalColSpan} delay={Math.min(ci, 15) * 25} />
              )}
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={child.AccountCode}>
            {breaker && (
              <BreakerRow label={breaker.label} color={breaker.color} colSpan={totalColSpan} delay={Math.min(ci, 15) * 25} />
            )}
<PivotRow node={child} depth={depth + 1}
              expandedSet={expandedSet} onToggle={onToggle}
              isOpen={isOpen} rowMatchesSelf={rowMatchesSelf}
              cols={cols} pivot={pivot} onCellClick={onCellClick}
              expandedColsMap={expandedColsMap} journalPivot={journalPivot}
              counterpartyPivot={counterpartyPivot}
              compareMode={compareMode} cmpPivot={cmpPivot}
              body1Style={body1Style} body2Style={body2Style} colors={colors}
              perspectiveMode={perspectiveMode} rowIndex={ci}
breakers={breakers}
           pivotPrev={pivotPrev} ytdOnly={ytdOnly} cmpPivotPrev={cmpPivotPrev}
            breakerSortOrder={breakerSortOrder} totalColSpan={totalColSpan}
            />
</React.Fragment>
        );
        });
      })()}
</>
  );
});

/* ─── LiteralPivotRow — recursive render of a saved-mapping literal node ── */
function LiteralPivotRow({
  node, depth, expandedSet, onToggle, cols, pivot, onCellClick,
  expandedColsMap, journalPivot, counterpartyPivot,
  compareMode, cmpPivot,
  body1Style, body2Style, colors,
  perspectiveMode, rowIndex = 0,
  totalColSpan = 10,
  accountMapForDrill,
  highlightedIds,
dimIdx = null, journalDimIdx = null, cptyDimIdx = null, cmpDimIdx = null,
  pivotPrev = null, ytdOnly = true,
cmpPivotPrev = null, dimIdxPrev = null, cmpDimIdxPrev = null,
}) {
  const code = node.AccountCode;
  const hasRealChildren = node.children?.length > 0;
  const hasChildren = hasRealChildren && !node._noExpand;
  const isSummary = /\.S$/i.test(String(code)) || hasRealChildren;
  const isSum = isSummary;
  const isLeaf = !hasRealChildren;
  const isExpanded = expandedSet.has(node.id);
const rowStyle = depth === 0 ? body1Style : body2Style;
const subbody1Style = useTypo("subbody1");
const isHighlighted = highlightedIds && (highlightedIds.has(node.id) || (node.originalId && highlightedIds.has(node.originalId)));

const resolveType = (n) => {
    const t = accountMapForDrill?.get?.(n.code)?.AccountType;
    if (t) return t;
    for (const c of (n.children || [])) {
      const ct = resolveType(c);
      if (ct) return ct;
    }
    return "";
  };
  const nodeType = resolveType(node);
const getVal = (co) => {
const curr = computeLiteralForCompany(node, pivot, co, "object", dimIdx);
   if (ytdOnly || !pivotPrev || nodeType === "B/S" || nodeType === "C/F" || nodeType === "CFS") return curr;
const prev = computeLiteralForCompany(node, pivotPrev, co, "object", dimIdxPrev);
    return curr - prev;
  };
  const getJp  = (co) => computeLiteralJournalForCompany(node, journalPivot, co, journalDimIdx);
const getCmp = (co) => {
    if (!compareMode) return 0;
const curr = computeLiteralForCompany(node, cmpPivot, co, "scalar", cmpDimIdx);
    if (ytdOnly || !cmpPivotPrev || nodeType === "B/S" || nodeType === "C/F" || nodeType === "CFS") return curr;
    const prev = computeLiteralForCompany(node, cmpPivotPrev, co, "scalar", cmpDimIdxPrev);
    return curr - prev;
  };
  const getIc  = (co) => computeLiteralCounterpartyForCompany(node, counterpartyPivot, co, cptyDimIdx);

  const rowTotal    = cols.reduce((s, co) => s + getVal(co), 0);
  const gp = useContext(GroupPivotCtx);
  const getValG = (co) => {
    if (!gp?.pivot) return getVal(co);
    const curr = computeLiteralForCompany(node, gp.pivot, co, "object", dimIdx);
    if (ytdOnly || !gp.pivotPrev || nodeType === "B/S" || nodeType === "C/F" || nodeType === "CFS") return curr;
    return curr - computeLiteralForCompany(node, gp.pivotPrev, co, "object", dimIdxPrev);
  };
  const parentTotal = perspectiveMode ? cols.reduce((s, co) => s + getValG(co), 0) : 0;

  const cellStyle = (v) => ({
    ...rowStyle,
    color: v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000",
  });

  // Drill is only meaningful for real leaves (the code exists in the standard
  // accountMap and has rows). Sums and abstract aggregates → no drill.
  const drillRowsFor = (co) => {
    if (!isLeaf) return [];
    return pivot.get(node.code)?.[co]?.rows ?? [];
  };

  return (
    <>
      <tr onClick={(e) => { if (hasChildren && !e.target.closest("[data-cell-click]")) onToggle(node.id); }}
        className={`${styles.row} ${isSummary ? styles.sumRow : ""} border-b transition-colors group ${hasChildren ? "cursor-pointer" : ""}
        ${isHighlighted ? "bg-amber-50/60 border-amber-200"
          : isSum ? "bg-[#f8f9ff] border-[#1a2f8a]/10 font-semibold"
          : depth === 0 ? "bg-white border-[#1a2f8a]/5"
          : "bg-white border-gray-200 hover:bg-[#f8f9ff]"}`}
style={{
          animation: rowIndex < 25
            ? (depth === 0
              ? `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${rowIndex * 35 + 50}ms both`
              : `rowExpandIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 15) * 25}ms both`)
            : "none",
          transformOrigin: "top center",
          contentVisibility: "auto",
          containIntrinsicSize: "auto 48px",
        }}>

{/* Account column — sticky */}
    <td className={`py-2.5 border-r border-gray-100 sticky left-0 z-10
          ${isHighlighted ? "bg-amber-50/60"
            : isSum ? "bg-[#f8f9ff]"
            : "bg-white group-hover:bg-[#f8f9ff]"}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px` }}>
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}
            >
            {hasChildren ? (
              <span className="flex-shrink-0 mr-2" style={{
                color: rowStyle?.color,
                display: "inline-flex",
                transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)",
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
              }}>
                <ChevronDown size={12} />
              </span>
            ) : (
              <span className="inline-block mr-2" style={{ width: 12 }} />
            )}
            {isHighlighted && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" className="mr-1.5 flex-shrink-0">
                <polygon points="12,2 15,9 22,9.5 17,15 18.5,22 12,18 5.5,22 7,15 2,9.5 9,9" />
              </svg>
            )}
<span className={`flex-shrink-0 mr-2 ${styles.code}`} style={subbody1Style}>
              {node.code}
            </span>
            <span className="truncate" style={{ ...rowStyle, fontWeight: hasChildren ? 800 : rowStyle.fontWeight }}>
              {node.name}
            </span>
            {Array.isArray(node.dims) && node.dims.length > 0 && (
              <span className="ml-2 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">
                {node.dims.length === 1 ? node.dims[0] : `${node.dims.length} dims`}
              </span>
            )}
          </div>
        </td>

        {/* Perspective parent col */}
        {perspectiveMode && (
          <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200"
            style={{ minWidth: 160, backgroundColor: "#eef1fb", ...cellStyle(parentTotal) }}>
            {parentTotal === 0 ? <span className="text-gray-300">—</span> : fmtAmt(parentTotal)}
          </td>
        )}

        {/* Per-company cells */}
        {cols.flatMap(co => {
          const val = getVal(co);
          const cmpVal = getCmp(co);
          const dev = val - cmpVal;
          const devPct = compareMode && cmpVal !== 0 ? (dev / Math.abs(cmpVal)) * 100 : null;
          const pct = perspectiveMode && parentTotal !== 0 ? (getValG(co) / parentTotal) * 100 : null;
          const expanded = !!expandedColsMap[co];
          const drillRows = drillRowsFor(co);

          const mainTd = (
            <td key={co}
              className={`px-4 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.coStart} ${expanded ? styles.coOpen : ""}
                ${val !== 0 && drillRows.length > 0 ? "cursor-pointer" : ""}`}
              data-cell-click={val !== 0 && drillRows.length > 0 ? "" : undefined}
              style={{ minWidth: 130, ...cellStyle(val), color: undefined }}
              onClick={() => val !== 0 && drillRows.length > 0 && onCellClick(node, co, drillRows)}>
              {val === 0 ? <span className={`${styles.val} ${styles.zero}`}>—</span> : <span className={`${styles.val} ${val < 0 ? styles.neg : ""}`}><AnimatedAmount value={val} /></span>}
            </td>
          );

          const pctTd = perspectiveMode ? (
            <td key={`${co}-pct`}
              className={`px-2 py-2.5 text-center whitespace-nowrap ${styles.pctCell}`}
              style={{ minWidth: 70, ...rowStyle }}>
              {pct === null || pct === 0 ? (
                <span className="text-gray-300 text-[10px]">—</span>
              ) : (
                <span className={`${styles.val} ${styles.pct}`}>{pct.toFixed(1).replace(".", ",")}%</span>
              )}
            </td>
          ) : null;

          const cmpTd = compareMode ? (
            <td key={`${co}-cmp`}
              className={`px-4 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.cmp1}`}
              style={{ minWidth: 130, ...rowStyle, color: undefined }}>
             {cmpVal === 0 ? <span className={`${styles.val} ${styles.zero}`}>—</span> : <span className={`${styles.val} ${cmpVal < 0 ? styles.neg : ""}`}><AnimatedAmount value={cmpVal} /></span>}
            </td>
          ) : null;
          const deltaTd = compareMode ? (
            <td key={`${co}-delta`}
              className={`px-4 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.cmp2} ${deltaClass(Math.round(dev * 100) / 100)}`}
              style={{ minWidth: 110, ...rowStyle, color: undefined }}>
              <span className={`${styles.val} ${deltaPillClass(Math.round(dev * 100) / 100)}`}>{fmtDelta(Math.round(dev * 100) / 100)}</span>
            </td>
          ) : null;
          const pctDeltaTd = compareMode ? (
            <td key={`${co}-deltapct`}
              className={`px-3 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.cmp3} ${deltaClass(devPct === null ? 0 : Math.round(devPct * 10) / 10)}`}
              style={{ minWidth: 80, ...rowStyle, color: undefined }}>
              <span className={`${styles.val} ${deltaPillClass(devPct === null ? 0 : Math.round(devPct * 10) / 10)}`}>{fmtDeltaPct(devPct)}</span>
            </td>
          ) : null;

          if (!expanded) return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : [])];

          const jp = getJp(co);
          // Uploaded = carga de la sociedad (uploaded-accounts).
          const uploadedVal = Number(jp.Uploaded) || 0;
          const uploadedTd = (
            <td key={`${co}-uploaded`}
              className={`px-3 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.subCell} ${styles.subFirst}`}
              style={{ minWidth: 110, ...cellStyle(uploadedVal), color: undefined }}>
              <span className={`${styles.val} ${Math.abs(uploadedVal) < 0.005 ? styles.zero : uploadedVal < 0 ? styles.neg : ""}`}>{Math.abs(uploadedVal) < 0.005 ? "—" : fmtAmt(uploadedVal)}</span>
            </td>
          );
          const subTds = SUB_COLS.map((sc, idx) => {
            const subVal = jp[sc.key] ?? 0;
            return (
              <td key={`${co}-${sc.key}`}
                className={`px-3 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.subCell}`}
                style={{ minWidth: 100, ...cellStyle(subVal), color: undefined, "--sub-i": idx + 1 }}>
                <span className={`${styles.val} ${subVal === 0 ? styles.zero : subVal < 0 ? styles.neg : ""}`}>{subVal === 0 ? "—" : fmtAmt(subVal)}</span>
              </td>
            );
          });
          const icVal = getIc(co);
          const icTd = (
            <td key={`${co}-ic`}
              className={`px-3 py-2.5 text-center whitespace-nowrap tabular-nums ${styles.icCell} ${styles.coEnd}`}
              style={{ minWidth: 110, ...rowStyle, color: undefined }}>
              <span className={`${styles.val} ${icVal === 0 ? styles.zero : icVal < 0 ? styles.neg : ""}`}>{icVal === 0 ? "—" : fmtAmt(icVal)}</span>
            </td>
          );

          return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : []), uploadedTd, ...subTds, icTd];
        })}

{!perspectiveMode && (
         <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100 tabular-nums sticky right-0 z-10"
            style={{ minWidth: 140, backgroundColor: "#fafafa", ...cellStyle(rowTotal) }}>
           {rowTotal === 0 ? <span className={`${styles.val} ${styles.zero}`}>—</span> : <span className={`${styles.val} ${rowTotal < 0 ? styles.neg : ""}`}><AnimatedAmount value={rowTotal} /></span>}
          </td>
        )}
      </tr>

{isExpanded && hasChildren && node.children.map((child, ci) => (
        <LiteralPivotRow key={child.id}
          node={child} depth={depth + 1}
          expandedSet={expandedSet} onToggle={onToggle}
          cols={cols} pivot={pivot} onCellClick={onCellClick}
          expandedColsMap={expandedColsMap} journalPivot={journalPivot}
          counterpartyPivot={counterpartyPivot}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style} colors={colors}
          perspectiveMode={perspectiveMode} rowIndex={ci}
          totalColSpan={totalColSpan}
          accountMapForDrill={accountMapForDrill}
          highlightedIds={highlightedIds}
          dimIdx={dimIdx} dimIdxPrev={dimIdxPrev}
            journalDimIdx={journalDimIdx} cptyDimIdx={cptyDimIdx} cmpDimIdx={cmpDimIdx} cmpDimIdxPrev={cmpDimIdxPrev}
          pivotPrev={pivotPrev} ytdOnly={ytdOnly} cmpPivotPrev={cmpPivotPrev}
        />
      ))}
    </>
  );
}

/* ─── Separador de sección: barra del color de la sección que se
   desvanece, entra creciendo y lleva un brillo que la recorre (como en el
   cash flow). Ocupa el ancho visible y no se mueve al desplazar. ───────── */
function BreakerRow({ label, color, colSpan, darken = false, delay = 0 }) {
  return (
    <tr className={styles.bk} style={{ "--sec": color, "--bk-delay": `${delay}ms` }}>
      <td colSpan={colSpan} className={styles.bkCell}>
        <div className={`${styles.bkBar} ${darken ? styles.bkDark : ""}`}>
          <span className={styles.bkTitle}>{label}</span>
        </div>
      </td>
    </tr>
  );
}

// Ancho de la columna de cuentas: por defecto, mínimo y máximo (se recuerda).
const NAME_DEFAULT = 320;
const NAME_MIN = 120;
const NAME_MAX = 640;
const NAME_KEY = "konsolidator:contributive:name-width";
const clampName = (w) => Math.max(NAME_MIN, Math.min(NAME_MAX, Math.round(w)));

/* ─── Texto que se desplaza de lado a lado si no cabe (al pasar el ratón
   por su cabecera), como en el cash flow ──────────────────────────── */
function MarqueeText({ text, className, style }) {
  const ref = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const extra = el.scrollWidth - el.clientWidth;
      setShift(extra > 1 ? extra + 6 : 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={ref} title={text} className={`${styles.marquee} ${shift > 0 ? styles.marqueeOn : ""} ${className ?? ""}`}
      style={{ ...style, "--shift": `-${shift}px`, "--dur": `${Math.max(2.2, shift / 28).toFixed(2)}s` }}>
      <span className={styles.marqueeText}>{text}</span>
    </span>
  );
}

/* ─── Ayuda de las cabeceras ─────────────────────────────────────────────
   Al pasar por la cabecera de una sociedad desplegada o de una de sus
   subcolumnas aparece una tarjeta junto a la propia cabecera (antes salía
   un bloque fijo arriba a la derecha y medio en inglés). */
const tipText = (locale) => {
  const g = (k) => t(locale, k);
  const fillLC = (s, l, c) => s.replace(/\{l\}/g, l).replace(/\{c\}/g, c);
  const pair = (k) => [g(`contrib_tip_${k}_t`), g(`contrib_tip_${k}_d`)];
  return {
    company: g("contrib_tip_company"), sub: g("contrib_tip_sub"),
    local: (l, c) => fillLC(g("contrib_tip_local"), l, c),
    group: (l, c) => fillLC(g("contrib_tip_group"), l, c),
    uploaded: pair("uploaded"), AJE: pair("AJE"), RJE: pair("RJE"), EJE: pair("EJE"), SYS: pair("SYS"), CFA: pair("CFA"), IC: pair("IC"),
  };
};

function HeaderTip({ tip, locale, currencyMode }) {
  if (!tip?.rect) return null;
  const tx = tipText(locale);
  const [title, body] = tip.kind === "company"
    ? [tip.legal, (currencyMode === "local" ? tx.local : tx.group)(tip.legal, tip.co)]
    : (tx[tip.key] ?? [tip.key, ""]);
  const W = 340;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const center = tip.rect.left + tip.rect.width / 2;
  const left = Math.max(12, Math.min(vw - W - 12, center - W / 2));
  const tone = tip.kind === "company" ? "company" : tip.key === "IC" ? "ic" : "sub";
  return createPortal(
    <div key={`${tip.kind}-${tip.key ?? tip.co}`} className={`${styles.tip} ${styles[`tip_${tone}`]}`} role="tooltip"
      style={{ top: tip.rect.bottom + 10, left, width: W, "--tip-arrow": `${Math.round(center - left)}px` }}>
      <p className={styles.tipKicker}>{tip.kind === "company" ? tx.company : `${tx.sub} · ${tip.legal}`}</p>
      <p className={styles.tipTitle}>{title}</p>
      <p className={styles.tipBody}>{body}</p>
    </div>,
    document.body,
  );
}

export function SyncedTable({
  T,
  cols, tree, expandedSet, expandedColsMap, toggleCol, toggleExpand, pivot, journalPivot, accountMap, companies,
  counterpartyPivot = new Map(),
 groupStructure, hasData, collapseAll, expandAll, setDrilldown, currencyMode = "group", groupPivots = null, breakers = {}, breakerSortOrder = new Map(),
  body1Style, body2Style, colors,
compareMode, cmpPivot,
  perspectiveMode = false, perspectiveParent = "", reorderCols = () => {},
  treeLiteral = null, highlightedIds = null, typeFilter = "",
dimIdx = null, dimIdxPrev = null, journalDimIdx = null, cptyDimIdx = null, cmpDimIdx = null, cmpDimIdxPrev = null,
activeStandardKey = null,
  codeToSectionInfo = new Map(),
rowMatchesDims = null,
  pivotPrev = null, ytdOnly = true,
  cmpPivotPrev = null,
  cmpLoading = false,
  onAnalyze = null,
}) {
const [dragCol, setDragCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [exitingCols, setExitingCols] = useState(new Set());
const [headerHover, setHeaderHover] = useState(null);
  const onHeaderHover = setHeaderHover;
  const locale = useLocale();
  const analyzeCtx = useMemo(() => (onAnalyze ? { open: onAnalyze, label: t(locale, "ctg_analyze") } : null), [onAnalyze, locale]);
  // La ayuda se cierra al desplazar la tabla (se quedaría flotando fuera de sitio)
  useEffect(() => {
    if (!headerHover) return undefined;
    const close = () => setHeaderHover(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [headerHover]);

  // Stable callback ref so React.memo on PivotRow actually blocks re-renders.
  // Inline arrows create a fresh function every render → memo miss → cascade.
  const handleCellClick = useCallback((node, co, rows) => {
    setDrilldown({ node, company: co, rows });
  }, [setDrilldown]);

  // ── Search state ─────────────────────────────────────────────────────
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef(null);

  // Build the set of account codes whose subtree contains a match. Used to
  // force-open ancestors of matching rows so they're visible.
  const searchExpansionSet = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return null;
    const out = new Set();
    const matchesSelf = (node) => {
      const code = String(node.AccountCode ?? "").toLowerCase();
      const name = String(node.AccountName ?? node.accountName ?? "").toLowerCase();
      return code.includes(q) || name.includes(q);
    };
    const walk = (node) => {
      let descendantMatch = false;
      (node.children || []).forEach(child => { if (walk(child)) descendantMatch = true; });
      const self = matchesSelf(node);
      if (descendantMatch && node.children?.length > 0) out.add(node.AccountCode);
      return self || descendantMatch;
    };
    tree.forEach(walk);
    return out;
  }, [debouncedQuery, tree]);

  // Combined open-check — search forces nodes open without touching expandedSet.
  const isOpen = useCallback((code) => {
    if (searchExpansionSet?.has(code)) return true;
    return expandedSet.has(code);
  }, [expandedSet, searchExpansionSet]);

  // Per-row self-match (uses non-deferred query for instant highlight feedback).
  const rowMatchesSelf = useCallback((node) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return false;
    const code = String(node.AccountCode ?? "").toLowerCase();
    const name = String(node.AccountName ?? node.accountName ?? "").toLowerCase();
    return code.includes(q) || name.includes(q);
  }, [searchQuery]);

  // Autofocus the input when search activates.
  useEffect(() => {
    if (searchActive && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchActive]);
const totalColSpan = useMemo(() => {
    let n = perspectiveMode ? 1 : 2;
    if (perspectiveMode) n += 1; // parent consolidated col
    cols.forEach(co => {
      n += 1;
      if (perspectiveMode) n += 1; // pct col
     if (compareMode) n += 3;
      if (expandedColsMap[co]) n += 1 + SUB_COLS.length + 1; // uploaded + journals + IC
    });
    return n;
  }, [cols, expandedColsMap, compareMode, perspectiveMode]);

  const bodyRef = useRef(null);
  // ── Ancho de la columna de cuentas (arrastrando el borde de su cabecera).
  // Mínimo: lo justo para el buscador y el botón de expandir/contraer.
  const [nameW, setNameW] = useState(() => {
    try { return clampName(Number(localStorage.getItem(NAME_KEY)) || NAME_DEFAULT); } catch { return NAME_DEFAULT; }
  });
  const [resizing, setResizing] = useState(false);
  const commitNameW = (w) => {
    setNameW(w);
    bodyRef.current?.style.setProperty("--ct-name-w", `${w}px`);
    try { localStorage.setItem(NAME_KEY, String(w)); } catch { /* sin almacenamiento */ }
  };
  // Mientras se arrastra se cambia la variable CSS en el DOM, sin repintar la tabla.
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = bodyRef.current;
    const startX = e.clientX;
    const startW = nameW;
    let next = startW;
    let raf = 0;
    setResizing(true);
    const move = (ev) => {
      next = clampName(startW + ev.clientX - startX);
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; el?.style.setProperty("--ct-name-w", `${next}px`); });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      setResizing(false);
      commitNameW(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Ancho visible del área con scroll: los separadores ocupan justo eso y se
  // quedan quietos al desplazar en horizontal. Se escribe en el DOM (no en el
  // estado) para no repintar la tabla mientras se abre la barra lateral.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--ct-view-w", `${Math.round(el.clientWidth)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute column widths once based on expandedColsMap
const colWidths = useMemo(() => {
    // La primera columna (cuentas) se ajusta con el asa de su cabecera.
    const widths = ["var(--ct-name-w, 320px)"];
    if (perspectiveMode) widths.push(180); // parent total
    cols.forEach(co => {
      widths.push(160);
      if (perspectiveMode) widths.push(80); // pct
      if (compareMode) { widths.push(130); widths.push(110); widths.push(80); }
if (expandedColsMap[co]) {
        widths.push(140);
        SUB_COLS.forEach(() => widths.push(120));
        widths.push(140); // IC col
      }
    });
if (!perspectiveMode) widths.push(160);
return widths;
  }, [cols, expandedColsMap, compareMode, perspectiveMode]);

  const colgroup = (
    <colgroup>
      {colWidths.map((w, i) => <col key={i} style={{ width: w, minWidth: w }} />)}
    </colgroup>
  );

  const parentLegalName = perspectiveMode
    ? (companies.find(c => (c.CompanyShortName ?? c.companyShortName) === perspectiveParent)?.CompanyLegalName
       ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === perspectiveParent)?.companyLegalName
       ?? perspectiveParent)
    : "";

  const headerCols = cols.flatMap(co => {
    const isExp = !!expandedColsMap[co];
    const legalName = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName
      ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.companyLegalName ?? co;
const isDragging = dragCol === co;
    const isDragOver = dragOverCol === co && dragCol !== co;
const main = (
      <th key={co}
        draggable
        onDragStart={(e) => {
          setDragCol(co);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", co);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dragOverCol !== co) setDragOverCol(co);
        }}
        onDragLeave={() => { if (dragOverCol === co) setDragOverCol(null); }}
        onDrop={(e) => {
          e.preventDefault();
          const from = e.dataTransfer.getData("text/plain") || dragCol;
          if (from && from !== co) reorderCols(from, co);
          setDragCol(null);
          setDragOverCol(null);
        }}
        onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
        onMouseEnter={(e) => isExp && onHeaderHover?.({ kind: "company", co, legal: legalName, rect: e.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => onHeaderHover?.(null)}
className={`px-4 select-none cursor-grab ${styles.thCo} ${styles.coStart} ${isExp ? styles.coOpen : ""}`}
        style={{
         background: isDragOver ? `${colors.primary}15` : "#ffffff",
          opacity: isDragging ? 0.4 : 1,
          outline: isDragOver ? `2px solid ${colors.primary}` : "none",
          transition: "background 150ms ease, outline 150ms ease",
        }}
        onClick={() => {
          const isExp = !!expandedColsMap[co];
          if (isExp) {
            setExitingCols(prev => new Set([...prev, co]));
            setTimeout(() => {
              toggleCol(co);
              setExitingCols(prev => { const n = new Set(prev); n.delete(co); return n; });
            }, 250);
          } else {
            toggleCol(co);
          }
        }}>
<div className="flex flex-col items-center gap-0.5 py-4">
          <MarqueeText text={legalName} className="font-black tracking-tight max-w-[140px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} />
          <span className={styles.ccy}>{currencyMode === "local" ? getCompanyCurrency(co, companies) : getContributionCurrency(perspectiveParent, co, groupStructure, companies)}</span>
        </div>
      </th>
    );
const pctTh = perspectiveMode ? (
      <th key={`${co}-pct`}
        className="px-2 whitespace-nowrap"
   style={{ background: `linear-gradient(${colors.primary}08, ${colors.primary}08), #ffffff`, borderLeft: "1px solid #f0f0f0" }}>
        <div className="flex justify-center py-4 font-black text-[11px]" style={{ color: `${colors.primary}70` }}>%</div>
      </th>
    ) : null;
// Columnas del periodo B (lista con clave: un fragmento sin clave avisaba en consola)
    const cmpTh = compareMode ? [
<th key={`${co}-cmp`} className={`text-center px-4 whitespace-nowrap ${styles.thCmp} ${styles.cmp1}`}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
        </th>,
        <th key={`${co}-delta`} className={`text-center px-3 whitespace-nowrap ${styles.thCmp} ${styles.cmp2}`}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
        </th>,
        <th key={`${co}-deltapct`} className={`text-center px-3 whitespace-nowrap ${styles.thCmp} ${styles.cmp3}`}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
        </th>
    ] : null;
if (!isExp) return [main, ...(pctTh ? [pctTh] : []), ...(cmpTh ?? [])];
    const subColsAll = [{ key: "uploaded", label: "Uploaded" }, ...SUB_COLS];
    const subThs = subColsAll.map((sc, idx) => {
      return (
        <th key={`${co}-${sc.key}`}
          className={`px-3 whitespace-nowrap ${styles.subTh} ${idx === 0 ? styles.subFirst : ""}`}
          onMouseEnter={(e) => onHeaderHover?.({ kind: "subcol", key: sc.key, co, legal: legalName, rect: e.currentTarget.getBoundingClientRect() })}
          onMouseLeave={() => onHeaderHover?.(null)}
          style={{
            "--sub-i": idx,
            transformOrigin: "left center",
            animation: exitingCols.has(co)
              ? `subColIn 220ms cubic-bezier(0.4,0,0.2,1) reverse both`
              : `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) ${idx * 30}ms both`,
          }}>
          <div className="flex flex-col items-center gap-0.5 py-4">
            <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 11, opacity: 0.6 + idx * 0.08 }}>{sc.label}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}40` }}>{legalName}</span>
          </div>
        </th>
      );
    });

    // IC column — always visible when company is expanded (no toggle)
    const icTh = (
      <th key={`${co}-ic`}
        className={`px-3 whitespace-nowrap ${styles.icTh} ${styles.coEnd}`}
        onMouseEnter={(e) => onHeaderHover?.({ kind: "subcol", key: "IC", co, legal: legalName, rect: e.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => onHeaderHover?.(null)}
        style={{
         background: "linear-gradient(#CF305D08, #CF305D08), #ffffff",
         borderLeft: `2px solid #f0d5e0`,
          transformOrigin: "left center",
          animation: `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) ${(SUB_COLS.length + 1) * 30}ms both`,
        }}>
        <div className="flex flex-col items-center gap-0.5 py-4">
          <span className="font-black tracking-tight" style={{ color: "#CF305D", fontSize: 11 }}>↪ IC</span>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#CF305D80" }}>{legalName}</span>
        </div>
      </th>
    );

    return [main, ...(pctTh ? [pctTh] : []), ...(cmpTh ?? []), ...subThs, icTh];
  });

return (
    <>
    <HeaderTip tip={headerHover} locale={locale} currencyMode={currencyMode} />
<div ref={bodyRef} className="contributive-body"
      style={{
        "--ct-name-w": `${nameW}px`,
        flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto",
        contain: "layout paint style",
        // Promote the scroll region to a GPU compositor layer. Sidebar width
        // changes then arrive as re-composite (translate/clip) instead of
        // reflow. Zero layout recalc inside the table during animation.
        transform: "translateZ(0)",
        willChange: "transform",
      }}>
<table className={`${styles.ctTable} ${compareMode && cmpLoading ? styles.cmpWait : ""}`} style={{
          "--ct-primary": colors.primary, borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", minWidth: "100%",
          // Ancho exacto = columna de cuentas (ajustable) + el resto de columnas.
          // Con "max-content" el navegador ensanchaba la primera columna hasta el
          // nombre más largo y el asa no podía estrecharla.
          width: `calc(var(--ct-name-w, 320px) + ${colWidths.slice(1).reduce((s2, w) => s2 + (Number(w) || 0), 0)}px)`,
        }}>
        {colgroup}
<thead style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          // Solid white background on the thead itself — paints a continuous
          // rectangle across the full header area so any micro-gaps between
          // th cells are covered. Individual th backgrounds layer on top.
          background: "#ffffff",
          // isolation creates a new stacking context so this bg is
          // guaranteed to sit behind the th cells and above the data rows.
          isolation: "isolate",
        }}>
         <tr style={{ background: "#ffffff", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
<th className="sticky left-0 z-30 text-left px-6 border-r border-gray-100"
             style={{ background: "#ffffff", height: 64, position: "sticky" }}>
              <span className={`${styles.resizer} ${resizing ? styles.resizerOn : ""}`} role="separator" aria-orientation="vertical"
                title={T("cf_resize_names", "Ancho de la columna de cuentas")} tabIndex={0}
                onPointerDown={startResize} onClick={e => e.stopPropagation()} onDoubleClick={() => commitNameW(NAME_DEFAULT)}
                onKeyDown={e => {
                  if (e.key === "ArrowLeft") commitNameW(clampName(nameW - 20));
                  if (e.key === "ArrowRight") commitNameW(clampName(nameW + 20));
                }} />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* Search icon — always visible, toggles input on/off */}
<button
                    onClick={() => setSearchActive(a => !a)}
                    title={T("search_accounts_placeholder")}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      color: searchActive ? colors.primary : "#94a3b8",
                      transition: "color 240ms cubic-bezier(0.4,0,0.2,1)",
                      padding: 2,
                    }}>
                    <Search size={13} strokeWidth={2.4} />
                  </button>

                  {searchActive ? (
                    <>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Escape") {
                            setSearchActive(false);
                            setSearchQuery("");
                          }
                        }}
                        placeholder={T("search_code_or_name")}
                        className="bg-transparent outline-none flex-1 min-w-0"
                        style={{
                          color: colors.primary,
                          fontWeight: 800,
                          fontSize: 16,
                          letterSpacing: "-0.01em",
                          width: 240,
                        }}
                      />
<button
                        onClick={() => { setSearchActive(false); setSearchQuery(""); }}
                        title={T("close_search")}
                        className="flex items-center justify-center flex-shrink-0"
                        style={{ color: "#94a3b8", padding: 2 }}>
                        <X size={14} strokeWidth={2.4} />
                      </button>
                    </>
                  ) : (
                    <div
                      onClick={() => setSearchActive(true)}
                      className="flex items-baseline gap-2.5 cursor-pointer select-none">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{T("kicker_accounts")}</span>
                      <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>{T("contrib_label", "Contribution")}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
{hasData && (() => {
                    const anyExpanded = expandedSet.size > 0;
                    return (
                      <button
                        onClick={() => anyExpanded ? collapseAll() : expandAll()}
                        title={anyExpanded ? T("btn_collapse_all") : T("btn_expand_all")}
                        className="flex items-center justify-center w-8 h-8 rounded-lg relative overflow-hidden"
style={{
                          color: anyExpanded ? colors.primary : "#94a3b8",
                          background: "transparent",
                          transition: "color 240ms cubic-bezier(0.4,0,0.2,1)",
                        }}>
{/* Collapsed: two chevrons (^ on top, v on bottom). Expanded: X. */}
                        <span key={anyExpanded ? "collapse" : "expand"}
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ animation: "iconMorph 360ms cubic-bezier(0.34,1.56,0.64,1)" }}>
                          {anyExpanded ? (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 3 L13 13" />
                              <path d="M13 3 L3 13" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6 L8 1 L13 6" />
                              <path d="M3 10 L8 15 L13 10" />
                            </svg>
                          )}
                        </span>
                      </button>
                    );
                  })()}
                </div>
              </div>
            </th>

{/* Parent consolidated column header */}
{perspectiveMode && (
              <th className="px-4 py-3 whitespace-nowrap border-l border-gray-100"
                style={{ background: "#ffffff" }}>
                <div className="flex flex-col items-center gap-0.5 py-4">
                  <span className="font-black tracking-tight truncate max-w-[160px]"
                    style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}
                    title={parentLegalName}>
                    {parentLegalName}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-widest"
                    style={{ color: `${colors.primary}60` }}>
                    {T("col_consolidated").toUpperCase()} · {perspectiveParent}
                  </span>
                </div>
              </th>
            )}

            {headerCols}
{!perspectiveMode && (
  <th className="sticky right-0 z-10 px-4 whitespace-nowrap border-l border-gray-100"
  style={{ background: "#ffffff" }}>
    <div className="flex flex-col items-center gap-0.5 py-4">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13 }}>{T("col_total")}</span>
      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>/ {T("col_avg")}</span>
    </div>
  </th>
)}
          </tr>

        </thead>
<AnalyzeCtx.Provider value={analyzeCtx}>
<GroupPivotCtx.Provider value={groupPivots}>
<tbody>
{treeLiteral && (
  // ── LITERAL MODE — render sections + recursive nodes ────────────────
  treeLiteral.map((section, secIdx) => (
    <React.Fragment key={`lit-sec-${secIdx}`}>
      {section.label && (
        <BreakerRow label={section.label} color={section.color || colors.primary} colSpan={totalColSpan} />
      )}
{section.nodes.map((n, ni) => (
        <LiteralPivotRow key={n.id}
          node={n} depth={0}
          expandedSet={expandedSet} onToggle={toggleExpand}
          cols={cols} pivot={pivot}
         onCellClick={handleCellClick}
          expandedColsMap={expandedColsMap} journalPivot={journalPivot}
          counterpartyPivot={counterpartyPivot}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style} colors={colors}
          perspectiveMode={perspectiveMode} rowIndex={ni}
          totalColSpan={totalColSpan}
accountMapForDrill={accountMap}
          highlightedIds={highlightedIds}
          dimIdx={dimIdx} dimIdxPrev={dimIdxPrev}
            journalDimIdx={journalDimIdx} cptyDimIdx={cptyDimIdx} cmpDimIdx={cmpDimIdx} cmpDimIdxPrev={cmpDimIdxPrev}
          pivotPrev={pivotPrev} ytdOnly={ytdOnly} cmpPivotPrev={cmpPivotPrev}
        />
      ))}
</React.Fragment>
  ))
)}
{(!treeLiteral || (!typeFilter && tree && tree.length > 0)) && (
  // ── STANDARD MODE — original render path ───────────────────────────
  // Runs alongside literal when the tree has extra content beyond what
  // the literal covers (e.g. Todos view: BS+CF live in tree, PL in literal).
  (() => {
    // Effective breakers: for CUSTOM standards, dispatch each section breaker
    // to the FIRST code in the actual render tree that belongs to that section.
    // The static `breakers` prop misses breakers when the first standard row
    // for a section is a sum-code that isn't in the tree.
const effectiveBreakers = { ...breakers };
    if (codeToSectionInfo && codeToSectionInfo.size > 0) {
      // Reset seenSections and rebuild breakers dispatch from scratch based on
      // the actual tree. The static `breakers` prop from the effect assigns
      // section labels to arbitrary standard codes, but those codes may not
      // appear in the tree at all. Better strategy: for each top-level node,
      // walk its descendants to find any code that carries a section_code.
      // The first top-level node encountered per section owns the breaker.
      const newBreakers = {};
      const seenSections = new Set();

      const findSectionOfSubtree = (node) => {
        // Returns the "dominant" section of a subtree: first section found
        // via DFS on codeToSectionInfo. Priority is on the node itself, then
        // its descendants.
        const stack = [node];
        while (stack.length) {
          const n = stack.pop();
          const info = codeToSectionInfo.get(String(n.AccountCode));
          if (info?.section) return info;
          const children = n.children || [];
          // Reverse so first child is processed first
          for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]);
        }
        return null;
      };

      tree.forEach(node => {
        const info = findSectionOfSubtree(node);
        if (!info || seenSections.has(info.section)) return;
        seenSections.add(info.section);
        newBreakers[node.AccountCode] = { label: info.label, color: info.color };
      });

      // Replace effectiveBreakers with the freshly-computed set (do not merge
      // with the static breakers prop, which may point to codes not in tree).
      Object.keys(effectiveBreakers).forEach(k => delete effectiveBreakers[k]);
      Object.assign(effectiveBreakers, newBreakers);
    }
return tree.map((node, i) => {
            // Empty custom section anchor: render only the breaker header, no
            // row, no divider — it exists solely to surface the section label.
            if (node._sectionAnchor && node._sectionInfo) {
              const br = { label: node._sectionInfo.label, color: node._sectionInfo.color };
              return (
                <BreakerRow key={`anchor-${node.AccountCode}`} label={br.label} color={br.color} colSpan={totalColSpan} delay={Math.min(i, 25) * 35} />
              );
            }
            const type = node.AccountType ?? node.accountType ?? "";
            const prevType = i > 0 ? (tree[i-1].AccountType ?? tree[i-1].accountType ?? "") : null;
            const showDivider = type !== prevType;
const TYPE_LABELS = {
              "P/L": { label: T("page_pl_full"),                                       color: colors.primary,   darken: true },
              "DIS": { label: T("contrib_dist_result", "Distribution of Result"),      color: colors.primary,   },
              "B/S": { label: T("page_bs_full"),                                       color: colors.secondary               },
              "C/F": { label: T("nav_cashflow"),                                       color: colors.tertiary                },
              "CFS": { label: T("nav_cashflow"),                                       color: colors.tertiary                },
            };
// For CUSTOM standards, the section breakers (Revenue / COGS /
            // NCA / CA / Operating etc.) already convey the statement scope.
            // Suppress the P/L / B/S / C/F top-level breaker to avoid the
            // "double breaker" visual mismatch.
            const suppressTypeDivider = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");
            const divider = (showDivider && !suppressTypeDivider) ? (TYPE_LABELS[type] ?? { label: type, color: colors.quaternary }) : null;
            return (
              <React.Fragment key={`row-${node._instanceId ?? node.AccountCode}`}>
{(() => {
              // Breakers can be keyed by instanceId (mapping active) or AccountCode (standard render)
              const brKey = node._instanceId ?? node.AccountCode;
              const br = effectiveBreakers[brKey];
              if (!br) return null;
              return (
                <BreakerRow key={`breaker-${brKey}`} label={br.label} color={br.color} colSpan={totalColSpan} delay={Math.min(i, 25) * 35} />
              );
            })()}
{divider && (
                  <BreakerRow key={`divider-${node.AccountCode}`} label={divider.label} color={divider.color} darken={divider.darken} colSpan={totalColSpan} />
                )}
<PivotRow key={node._instanceId ?? node.AccountCode} node={node} depth={0}
                  expandedSet={expandedSet} onToggle={toggleExpand}
                  isOpen={isOpen} rowMatchesSelf={rowMatchesSelf}
                  cols={cols} pivot={pivot}
                  onCellClick={handleCellClick}
                  expandedColsMap={expandedColsMap} journalPivot={journalPivot}
                  counterpartyPivot={counterpartyPivot}
                  compareMode={compareMode} cmpPivot={cmpPivot}
                  body1Style={body1Style} body2Style={body2Style} colors={colors}
                  perspectiveMode={perspectiveMode} rowIndex={i}
breakers={breakers}
                  rowMatchesDims={rowMatchesDims}
                  pivotPrev={pivotPrev} ytdOnly={ytdOnly}
                  breakerSortOrder={breakerSortOrder} totalColSpan={totalColSpan}
                />
              </React.Fragment>
);
          });
})()
)}
{treeLiteral && (!tree || tree.length === 0) && null /* just literal, no extra tree */}
</tbody>
</GroupPivotCtx.Provider>
</AnalyzeCtx.Provider>
      </table>
    </div>
    </>
  );
}
