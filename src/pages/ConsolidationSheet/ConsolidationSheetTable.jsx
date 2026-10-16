/* ══════════════════════════════════════════════════════════════════════
   Sábana de consolidación — filas de la tabla (consolidado, eliminaciones,
   contribución por sociedad, comparación) y celdas animadas.
   ══════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef } from "react";
import { ChevronRight, GitBranch } from "lucide-react";
import { fmt } from "./consolidationSheetUtils.js";
import styles from "./ConsolidationSheet.module.css";

function useCountUp(target, duration = 900) {
  const to = Number(target) || 0;
  const [display, setDisplay] = useState(to);
  const lastTargetRef = useRef(to);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const fromRef = useRef(to);

  useEffect(() => {
    // Skip if target hasn't actually changed (parent re-rendered with same data)
    if (lastTargetRef.current === to) return;
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    lastTargetRef.current = to;
    const from = Number(fromRef.current) || 0;
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
  }, [to, duration]);

  return display;
}

const AnimatedValueCell = React.memo(function AnimatedValueCell({ value, className, style, onClick }) {
const animated = useCountUp(value ?? 0, 900);
  const isZero = Math.abs(Number(value) || 0) < 0.005;
  return (
    <td className={className} style={style} onClick={onClick}>
      {isZero
        ? <span className={`${styles.val} ${styles.zero}`}>—</span>
        : <span className={`${styles.val} ${Number(value) < 0 ? styles.neg : ""}`}>{fmt(animated)}</span>}
    </td>
  );
});

const AnimatedDeltaCell = React.memo(function AnimatedDeltaCell({ value, className, style }) {
const animated = useCountUp(value ?? 0, 900);
  const v = Number(value) || 0;
  return (
    <td className={className} style={style}>
      <span className={`${styles.val} ${Math.abs(v) < 0.005 ? styles.zero : v > 0 ? styles.deltaUp : styles.deltaDown}`}>
        {Math.abs(v) < 0.005 ? "—" : `${v > 0 ? "+" : "−"}${fmt(Math.abs(animated))}`}
      </span>
    </td>
  );
});

const AnimatedPctCell = React.memo(function AnimatedPctCell({ value, className, style }) {
  const animated = useCountUp(value ?? 0, 900);
  if (value === null || value === undefined) {
    return <td className={className} style={style}><span className={`${styles.val} ${styles.zero}`}>—</span></td>;
  }
  const r = Math.round(animated * 10) / 10;
  return (
    <td className={className} style={style}>
      <span className={`${styles.val} ${r > 0 ? styles.deltaUp : r < 0 ? styles.deltaDown : styles.zero}`}>
        {r > 0 ? "+" : r < 0 ? "−" : ""}{Math.abs(r).toFixed(1).replace(".", ",")}%
      </span>
    </td>
  );
});

// ── SheetRow ──────────────────────────────────────────────────────────────────
// Because data is fetched per-perspective (see the main fetch effect), every
// row's ReportingAmountYTD is already in the perspective's currency. No
// branching on "is root?" is needed — consolidation total is always the Group
// role (for whatever the selected consolidation is), and column values are
// always Parent for the perspective itself and Contribution for its children.
/* Separador de sección animado (igual que el cash flow y el contributivo):
   barra del color de la sección que se desvanece, entra creciendo y lleva un
   brillo; ocupa el ancho visible y no se mueve al desplazar. */
export function BreakerRow({ label, color, colSpan }) {
  return (
    <tr className={styles.bk} style={{ "--sec": color }}>
      <td colSpan={colSpan} className={styles.bkCell}>
        <div className={styles.bkBar}><span className={styles.bkTitle}>{label}</span></div>
      </td>
    </tr>
  );
}

export const SheetRow = React.memo(function SheetRow({
  node, depth, expanded, onToggle,
  pivot, uploadedPivot, elimPivot,
  contributionCompanies, topParent,
  elimExpanded, elimHeaders, elimColsExiting = false,
compareMode, cmpPivot, cmpPivotPrev = null,
  body1Style, body2Style, subbody1Style, colors = { primary: "#1a2f8a" },
  cmpColsExiting = false, cmpColsVisible = false,
  rowIndex = 0,
  rowMatchesDims = null,
  pivotPrev = null, ytdOnly = true,
  getRowAmount = (r) => Number(r?.AmountYTD ?? 0),
  onTrace = null, tracedCode = null, traceLabel = "Rastro del dato",
  searchVisible = null, searchMatch = null,
}) {
const hasChildren = node.children?.length > 0;
  const rowKey = node._instanceId ?? node.AccountCode;
  const isExpanded  = expanded.has(rowKey);
  // A node reads as a "parent/total" (bold name) if it has children OR is a
  // sum account (explicit _isSum flag, or the ".S" code convention).
const isBoldName = hasChildren || !!node._isSum || /\.S$/i.test(String(node.AccountCode ?? ""));

// Match Contributive: style by DEPTH, not by hasChildren — depth-0 rows use
  // body1 (bold), deeper rows body2. This makes top-level accounts bold even
  // when they have no children.
  const rowStyle = depth === 0 ? body1Style : body2Style;
  const cellStyle = (v) => {
    const baseColor = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
    return { ...rowStyle, color: baseColor };
  };

  // Filter rows by mapping-instance dims if this node has them
  const nodeDims = node._dims || null;
  const dimFilter = (r) => {
    if (!nodeDims || nodeDims.length === 0) return true;
    if (typeof rowMatchesDims !== "function") return true;
    return rowMatchesDims(r, nodeDims);
  };

// Collect all descendant leaf codes for rollup on sum nodes
  const collectLeafCodes = (n) => {
    if (n.children && n.children.length > 0) {
      const out = [];
      n.children.forEach(c => { out.push(...collectLeafCodes(c)); });
      return out;
    }
    return [n.AccountCode];
  };
  const rollupCodes = hasChildren ? collectLeafCodes(node) : [node.AccountCode];

const consTotalFrom = (piv) => rollupCodes.reduce((acc, leafCode) => {
    const bc = piv?.get(leafCode);
    if (!bc) return acc;
    // El consolidado del grupo incluye TODAS las filas Group, también las que llevan
    // origin/counterparty (p.ej. eliminaciones interco registradas a nivel grupo).
    // Excluirlas dejaba fuera partidas legítimas del consolidado (bug: 700000 daba
    // 29.972.294,28 en vez de 31.162.412,56).
    return acc + (bc[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(dimFilter)
      .reduce((s, r) => s + -getRowAmount(r), 0);
  }, 0);

  const getContribFrom = (piv, company) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return rollupCodes.reduce((acc, leafCode) => {
      const bc = piv?.get(leafCode);
      if (!bc) return acc;
      return acc + (bc[company] ?? [])
        .filter(r => r.CompanyRole === role)
        .filter(dimFilter)
        .reduce((s, r) => s + -getRowAmount(r), 0);
    }, 0);
  };

const nodeAccountType = node.AccountType ?? node.accountType ?? "";
  const applyDelta = !ytdOnly && pivotPrev && (nodeAccountType === "P/L" || nodeAccountType === "DIS");

  const consTotalCurr = consTotalFrom(pivot);
  const consTotal = applyDelta ? consTotalCurr - consTotalFrom(pivotPrev) : consTotalCurr;

  const getContrib = (company) => {
    const currV = getContribFrom(pivot, company);
    if (!applyDelta) return currV;
    return currV - getContribFrom(pivotPrev, company);
  };

const contribSum = contributionCompanies.reduce((s, c) => s + getContrib(c), 0);
  const elimTotal = consTotal - contribSum;

// ── Compare-period totals (mirrors current-period derivation) ──
  // Same rollup as the current period (so SUM nodes aggregate children), and
  // the same monthly-delta treatment: when not YTD, subtract the period before
  // B (cmpPivotPrev) for P/L accounts.
  const cmpConsFrom = (piv) => rollupCodes.reduce((acc, leafCode) => {
    const bc = piv?.get(leafCode);
    if (!bc) return acc;
    return acc + (bc[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .filter(dimFilter)
      .reduce((s, r) => s + -getRowAmount(r), 0);
  }, 0);

  const cmpApplyDelta = !ytdOnly && cmpPivotPrev && (nodeAccountType === "P/L" || nodeAccountType === "DIS");

  const cmpConsCurr = cmpConsFrom(cmpPivot);
  const cmpConsTotal = cmpApplyDelta ? cmpConsCurr - cmpConsFrom(cmpPivotPrev) : cmpConsCurr;

  const cmpGetContribFrom = (piv, company) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return rollupCodes.reduce((acc, leafCode) => {
      const bc = piv?.get(leafCode);
      if (!bc) return acc;
      return acc + (bc[company] ?? [])
        .filter(r => r.CompanyRole === role)
        .filter(dimFilter)
        .reduce((s, r) => s + -getRowAmount(r), 0);
    }, 0);
  };
  const cmpGetContrib = (company) => {
    const currV = cmpGetContribFrom(cmpPivot, company);
    if (!cmpApplyDelta) return currV;
    return currV - cmpGetContribFrom(cmpPivotPrev, company);
  };

  const cmpContribSum = contributionCompanies.reduce((s, c) => s + cmpGetContrib(c), 0);
  const cmpElimTotal  = cmpConsTotal - cmpContribSum;

// Render two cells (compare value + delta) for any given pair (current, compare)
const renderCompareCells = (current, compare, key) => {
    const delta = current - compare;
    // Guard against absurd percentages when the compare base is a rounding
    // residual (e.g. 0.0001): treat sub-unit magnitudes as zero for the % only.
    const pct = Math.abs(compare) >= 1 ? (delta / Math.abs(compare)) * 100 : null;
    const baseColor = compare === 0 ? "#D1D5DB" : compare < 0 ? "#EF4444" : "#000000";
    const deltaColor = delta === 0 ? "#D1D5DB" : delta < 0 ? "#EF4444" : "#10B981";
    const pctColor = pct === null ? "#D1D5DB" : pct > 0 ? "#059669" : pct < 0 ? "#EF4444" : "#D1D5DB";
const anim = (delay) => (rowIndex >= 30 && !cmpColsExiting) ? undefined : `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) ${delay}ms both`;
    return [
      <AnimatedValueCell key={`${key}-cmp`} value={compare}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 110, ...rowStyle, color: baseColor, background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, animation: anim(60), transformOrigin: "left center" }} />,
      <AnimatedDeltaCell key={`${key}-delta`} value={delta}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 110, ...rowStyle, color: deltaColor, background: `${colors.primary}12`, animation: anim(80), transformOrigin: "left center" }} />,
      <AnimatedPctCell key={`${key}-pct`} value={pct}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 80, ...rowStyle, color: pctColor, background: `${colors.primary}1e`, animation: anim(100), transformOrigin: "left center" }} />,
    ];
  };

// rowIndex prop drives the staggered slide-in animation.
  // For depth>0 rows (expanded children), use an "accordion" effect on each <td>
  // because scaleY on <tr> doesn't render correctly in most browsers.
  const isChildRow = depth > 0;
const rowAnimation = (isChildRow || rowIndex >= 30)
    ? undefined  // children animate cells; rows beyond 30 render static to avoid an animation storm
    : `sheetRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both`;
  const cellAccordionAnim = (isChildRow && rowIndex < 30)
    ? `sheetCellAccordion 320ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 15) * 30}ms both`
    : undefined;

const [isHovered, setIsHovered] = useState(false);

  // Buscador de la cabecera "Cuenta": se ocultan las filas que no coinciden ni
  // llevan a una coincidencia; las que coinciden se resaltan.
  if (searchVisible && !searchVisible.has(rowKey)) return null;
  const isMatch = !!searchMatch?.has(rowKey);

  return (
    <>
      <tr className={`${styles.row} ${isBoldName ? styles.sumRow : ""} ${hasChildren ? "cursor-pointer" : ""} group border-b border-gray-100 transition-colors`}
        onClick={(e) => { if (hasChildren && !e.target.closest("button,[data-cell-click]")) onToggle(rowKey); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          animation: rowAnimation,
          background: tracedCode === node.AccountCode ? `${colors.primary}0f` : isMatch ? "#fef9c3" : isHovered ? "rgba(249,250,251,0.6)" : "transparent",
          boxShadow: tracedCode === node.AccountCode ? `inset 3px 0 0 ${colors.primary}` : undefined,
        }}>
<td className="sticky left-0 z-10 py-2.5 pr-4 border-r border-gray-100"
          style={{
            paddingLeft: `${14 + depth * 16}px`,
            minWidth: 340,
            width: 340,
            animation: cellAccordionAnim,
            transformOrigin: "top center",
            background: isHovered ? "#f5f6f8" : "#ffffff",
            transition: "background 150ms ease",
          }}>
          <div className="flex items-center gap-1.5 cursor-pointer select-none">
            {hasChildren
              ? <span className={`text-[#1a2f8a] flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}>
                  <ChevronRight size={11} />
                </span>
              : <span className="w-3 flex-shrink-0" />}
<span className={`flex-shrink-0 mr-2 ${styles.code}`} style={subbody1Style}>
  {node.AccountCode}
</span>
<span className="truncate max-w-[280px]" style={{ ...rowStyle, fontWeight: isBoldName ? 800 : rowStyle.fontWeight }} title={node.AccountName}>
  {node.AccountName}
</span>
{onTrace && (
  <button type="button"
    title={traceLabel}
    aria-label={traceLabel}
    onClick={(e) => { e.stopPropagation(); onTrace({ AccountCode: node.AccountCode, AccountName: node.AccountName, AccountType: node.AccountType ?? node.accountType ?? "", codes: rollupCodes }); }}
    className="ml-auto flex-shrink-0 flex items-center justify-center rounded-lg transition-all"
    style={{
      width: 24, height: 24,
      opacity: isHovered || tracedCode === node.AccountCode ? 1 : 0,
      transform: isHovered || tracedCode === node.AccountCode ? "scale(1)" : "scale(0.7)",
      background: tracedCode === node.AccountCode ? colors.primary : `${colors.primary}14`,
      color: tracedCode === node.AccountCode ? "#fff" : colors.primary,
      transition: "opacity 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1), background 160ms ease",
    }}>
    <GitBranch size={13} strokeWidth={2.4} />
  </button>
)}
{Array.isArray(node._dims) && node._dims.length > 0 && (
  <span className="ml-2 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">
    {node._dims.length === 1 ? node._dims[0] : `${node._dims.length} dims`}
  </span>
)}
          </div>
        </td>

<AnimatedValueCell value={consTotal}
  className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
  style={{ minWidth: 130, ...cellStyle(consTotal), animation: cellAccordionAnim, transformOrigin: "top center" }} />
{compareMode && renderCompareCells(consTotal, cmpConsTotal, "cons")}

<AnimatedValueCell value={elimTotal}
  className="px-4 py-2.5 text-center whitespace-nowrap sheet-area-start sheet-area-elim"
  style={{ minWidth: 110, ...cellStyle(elimTotal), animation: cellAccordionAnim, transformOrigin: "top center" }} />
{compareMode && renderCompareCells(elimTotal, cmpElimTotal, "elim")}

{elimExpanded && elimHeaders.map((h, hi) => {
  const subVal = (elimPivot.get(node.AccountCode) ?? {})[h] ?? 0;
  return (
    <AnimatedValueCell key={`elim-${h}`} value={subVal}
      className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
      style={{
        minWidth: 140,
        backgroundColor: "#f8f9ff",
        ...cellStyle(subVal),
        animation: `${elimColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) ${hi * 40}ms both`,
        transformOrigin: "left center",
      }} />
  );
})}
<AnimatedValueCell value={contribSum}
  className="px-4 py-2.5 text-center whitespace-nowrap sheet-area-start sheet-area-contrib"
  style={{ minWidth: 110, ...cellStyle(contribSum), animation: cellAccordionAnim, transformOrigin: "top center" }} />
{compareMode && renderCompareCells(contribSum, cmpContribSum, "contribsum")}

{contributionCompanies.flatMap((c, ci) => {
  const val = getContrib(c);
  const cmpVal = cmpGetContrib(c);
  const isFirstCompany = ci === 0;
  return [
<AnimatedValueCell key={c} value={val}
      className={`px-3 py-2.5 text-center whitespace-nowrap sheet-area-cos ${isFirstCompany ? "sheet-area-start" : "border-l border-gray-100"}`}
      style={{ minWidth: 140, ...cellStyle(val), animation: cellAccordionAnim, transformOrigin: "top center" }} />,
    ...(compareMode ? renderCompareCells(val, cmpVal, `contrib-${c}`) : []),
  ];
})}
      </tr>

{isExpanded && hasChildren && node.children.map((child, ci) => (
<SheetRow key={child.AccountCode} node={child} depth={depth + 1}
    rowIndex={ci}
    onTrace={onTrace} tracedCode={tracedCode} traceLabel={traceLabel}
    searchVisible={searchVisible} searchMatch={searchMatch}
    expanded={expanded} onToggle={onToggle}
    pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
pivotPrev={pivotPrev} ytdOnly={ytdOnly}
    getRowAmount={getRowAmount}
    contributionCompanies={contributionCompanies}
    topParent={topParent}
    elimExpanded={elimExpanded} elimHeaders={elimHeaders}
    elimColsExiting={elimColsExiting}
compareMode={compareMode} cmpPivot={cmpPivot} cmpPivotPrev={cmpPivotPrev}
    body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
    colors={colors} cmpColsExiting={cmpColsExiting} cmpColsVisible={cmpColsVisible} />
))}
</>
  );
}, (prev, next) => {
  const key = next.node._instanceId ?? next.node.AccountCode;
  // Re-render if this row's own expansion changed.
  if (prev.expanded.has(key) !== next.expanded.has(key)) return false;
  // If this row is expanded, its rendered subtree depends on the expansion state of
  // its descendants. A child toggling deeper down produces a NEW `expanded` Set but
  // does NOT change this row's own key — so comparing only the own key would freeze
  // the subtree and swallow the click. When expanded, fall through on Set identity
  // change so the subtree re-renders; collapsed rows still skip (no visible subtree).
  const nextExpanded = next.expanded.has(key);
  if (nextExpanded && prev.expanded !== next.expanded) return false;
  const P = [
    "node","depth","rowIndex","onToggle","pivot","uploadedPivot","elimPivot",
    "contributionCompanies","topParent","elimExpanded","elimHeaders","elimColsExiting",
    "compareMode","cmpPivot","cmpPivotPrev","pivotPrev","ytdOnly","getRowAmount",
    "body1Style","body2Style","subbody1Style","colors","cmpColsExiting","cmpColsVisible","rowMatchesDims",
    "onTrace","traceLabel","searchVisible","searchMatch",
  ];
  // Rastro: re-pintar si esta fila pasa a ser (o deja de ser) la elegida.
  if ((prev.tracedCode === key) !== (next.tracedCode === key)) return false;
  if (nextExpanded && prev.tracedCode !== next.tracedCode) return false;
  for (const k of P) if (prev[k] !== next[k]) return false;
  return true;
});
