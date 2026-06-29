import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ChevronDown, ChevronRight, X, RefreshCw, Maximize2, Minimize2, GitMerge, Download, Library, Filter, TrendingUp, BarChart2, Layers, FileText, Loader2 } from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill } from "./PageHeader.jsx";
import { useTypo, useSettings } from "./SettingsContext";
import { t } from "../../lib/i18n";
const BASE = "https://api.konsolidator.com/v2";


const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },
];

const fmt = (n) => {
  if (n == null || n === "") return "—";
  const rounded = Math.round(Number(n));
  if (rounded === 0) return "—";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(rounded);
};

const TYPE_ORDER = { "P/L": 0, "DIS": 0, "B/S": 1, "C/F": 2, "CFS": 2 };
const TYPE_LABELS_BASE = {
  "P/L": { label: "Profit & Loss" },
  "DIS": { label: "Distribution of Result" },
  "B/S": { label: "Balance Sheet" },
  "C/F": { label: "Cash Flow" },
  "CFS": { label: "Cash Flow" },
};

// ── FilterPill ────────────────────────────────────────────────────────────────
function FilterPill({ label, value, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => String(o.value) === String(value))?.label ?? "—";
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative flex-shrink-0">
<button onClick={() => setOpen(o => !o)}
  className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
  style={filterStyle}>
  <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
  <span>{display}</span>
  <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
</button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
           {options.map(o => {
  const selected = String(o.value) === String(value);
  return (
    <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
        ${selected ? "text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
      style={selected ? { backgroundColor: colors?.primary } : undefined}>
      {o.label}
      {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
    </button>
  );
})}
          </div>
        </div>
      )}
    </div>
  );
}

// ── pgcSort & buildTree ───────────────────────────────────────────────────────
function pgcSort(a, b) {
  const cA = a.AccountCode || "", cB = b.AccountCode || "";
  const aA = /^[A-Za-z]/.test(cA), bA = /^[A-Za-z]/.test(cB);
  if (aA && !bA) return -1; if (!aA && bA) return 1;
  const strip = c => c.replace(/\.S$/i, ""), isSum = c => /\.S$/i.test(c);
  const bsA = strip(cA), bsB = strip(cB);
  if (bsA === bsB) { if (isSum(cA) && !isSum(cB)) return 1; if (!isSum(cA) && isSum(cB)) return -1; return 0; }
  const pA = bsA.split("."), pB = bsB.split(".");
  for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
    const a = pA[i] ?? "", b = pB[i] ?? "";
    if (a === b) continue;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "es", { sensitivity: "base" });
  }
  return 0;
}

function buildTree(accounts) {
  const sorted = [...accounts].sort(pgcSort);
  const map = new Map();
  sorted.forEach(a => map.set(a.AccountCode, { ...a, children: [] }));
  const roots = [];
  sorted.forEach(a => {
    const parent = a.SumAccountCode ? map.get(a.SumAccountCode) : null;
    if (parent && !/\.S$/i.test(parent.AccountCode)) {
      parent.children.push(map.get(a.AccountCode));
    } else {
      const isNum = /^\d/.test(a.AccountCode);
      const missing = a.SumAccountCode && !map.has(a.SumAccountCode);
      if (!(isNum && missing)) roots.push(map.get(a.AccountCode));
    }
  });
  return roots;
}

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
  const rounded = Math.round(value ?? 0);
  return (
    <td className={className} style={style} onClick={onClick}>
      {rounded === 0 ? <span className="text-gray-200">—</span> : fmt(animated)}
    </td>
  );
});

const AnimatedDeltaCell = React.memo(function AnimatedDeltaCell({ value, className, style }) {
  const animated = useCountUp(value ?? 0, 900);
  const rounded = Math.round(value ?? 0);
  return (
    <td className={className} style={style}>
      {rounded === 0 ? "—" : `${rounded > 0 ? "+" : ""}${fmt(animated)}`}
    </td>
  );
});

const AnimatedPctCell = React.memo(function AnimatedPctCell({ value, className, style }) {
  const animated = useCountUp(value ?? 0, 900);
  if (value === null || value === undefined) {
    return <td className={className} style={style}>—</td>;
  }
  return (
    <td className={className} style={style}>
      {animated > 0 ? "+" : ""}{animated.toFixed(1)}%
    </td>
  );
});

// ── SheetRow ──────────────────────────────────────────────────────────────────
// Because data is fetched per-perspective (see the main fetch effect), every
// row's ReportingAmountYTD is already in the perspective's currency. No
// branching on "is root?" is needed — consolidation total is always the Group
// role (for whatever the selected consolidation is), and column values are
// always Parent for the perspective itself and Contribution for its children.
const SheetRow = React.memo(function SheetRow({
  node, depth, expanded, onToggle,
  pivot, uploadedPivot, elimPivot,
  contributionCompanies, topParent,
  elimExpanded, elimHeaders, elimColsExiting = false,
  compareMode, cmpPivot,
  body1Style, body2Style, subbody1Style, colors = { primary: "#1a2f8a" },
  cmpColsExiting = false, cmpColsVisible = false,
  rowIndex = 0,
}) {
const hasChildren = node.children?.length > 0;
  const isExpanded  = expanded.has(node.AccountCode);

  const rowStyle = !hasChildren ? subbody1Style : (depth === 0 ? body1Style : body2Style);
  const cellStyle = (v) => {
    const baseColor = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
    return { ...rowStyle, color: baseColor };
  };

  const byCompany = pivot.get(node.AccountCode) || {};

const consTotal = (byCompany[topParent] ?? [])
    .filter(r => r.CompanyRole === "Group")
    .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
    .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);

  const getContrib = (company) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return (byCompany[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);
  };

  const contribSum = contributionCompanies.reduce((s, c) => s + getContrib(c), 0);

  // Eliminations derived, not read from EJEs: Consolidation total minus the
  // sum of individual company contributions. Works uniformly for root view
  // and subgroup views — and for subgroups like Tizon, EJEs live in the
  // parent's run (BIRD), not the subgroup's, so we can't read them directly.
const elimTotal = consTotal - contribSum;

  // ── Compare-period totals (mirrors current-period derivation) ──
  const cmpByCompany = cmpPivot?.get(node.AccountCode) || {};

  const cmpConsTotal = (cmpByCompany[topParent] ?? [])
    .filter(r => r.CompanyRole === "Group")
    .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
    .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);

  const cmpGetContrib = (company) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return (cmpByCompany[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);
  };

  const cmpContribSum = contributionCompanies.reduce((s, c) => s + cmpGetContrib(c), 0);
  const cmpElimTotal  = cmpConsTotal - cmpContribSum;

// Render two cells (compare value + delta) for any given pair (current, compare)
const renderCompareCells = (current, compare, key) => {
    const delta = current - compare;
    const pct = compare !== 0 ? (delta / Math.abs(compare)) * 100 : null;
    const baseColor = compare === 0 ? "#D1D5DB" : compare < 0 ? "#EF4444" : "#000000";
    const deltaColor = delta === 0 ? "#D1D5DB" : delta < 0 ? "#EF4444" : "#10B981";
    const pctColor = pct === null ? "#D1D5DB" : pct > 0 ? "#059669" : pct < 0 ? "#EF4444" : "#D1D5DB";
const anim = (delay) => `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) ${delay}ms both`;
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
  const rowAnimation = isChildRow
    ? undefined  // children: animate cells, not the row
    : `sheetRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both`;
  const cellAccordionAnim = isChildRow
    ? `sheetCellAccordion 320ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 15) * 30}ms both`
    : undefined;

const [isHovered, setIsHovered] = useState(false);

  return (
    <>
      <tr className="group border-b border-gray-100 transition-colors"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          animation: rowAnimation,
          background: isHovered ? "rgba(249,250,251,0.6)" : "transparent",
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
          <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => hasChildren && onToggle(node.AccountCode)}>
            {hasChildren
              ? <span className={`text-[#1a2f8a] flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}>
                  <ChevronRight size={11} />
                </span>
              : <span className="w-3 flex-shrink-0" />}
<span className="flex-shrink-0 mr-2" style={rowStyle}>
  {node.AccountCode}
</span>
<span className="truncate" style={{ ...rowStyle, maxWidth: 240 }} title={node.AccountName}>
  {node.AccountName}
</span>
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
    expanded={expanded} onToggle={onToggle}
    pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
    contributionCompanies={contributionCompanies}
    topParent={topParent}
    elimExpanded={elimExpanded} elimHeaders={elimHeaders}
    elimColsExiting={elimColsExiting}
    compareMode={compareMode} cmpPivot={cmpPivot}
    body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
    colors={colors} cmpColsExiting={cmpColsExiting} cmpColsVisible={cmpColsVisible} />
))}
</>
  );
});

// ── Loading Spinner ───────────────────────────────────────────────────────────
// Module-level animation state — survives remounts and prop changes
const sheetAnim = { startedAt: null, raf: null, subs: new Set(), idleTimer: null };

function sheetAnimStart() {
  if (sheetAnim.idleTimer) { clearTimeout(sheetAnim.idleTimer); sheetAnim.idleTimer = null; }
  if (sheetAnim.startedAt !== null) return;
  sheetAnim.startedAt = performance.now();
  const tick = () => {
    sheetAnim.subs.forEach(fn => fn());
    sheetAnim.raf = requestAnimationFrame(tick);
  };
  sheetAnim.raf = requestAnimationFrame(tick);
}
function sheetAnimMaybeReset() {
  sheetAnim.idleTimer = setTimeout(() => {
    if (sheetAnim.subs.size === 0) {
      if (sheetAnim.raf) cancelAnimationFrame(sheetAnim.raf);
      sheetAnim.raf = null;
      sheetAnim.startedAt = null;
    }
    sheetAnim.idleTimer = null;
  }, 500);
}
function sheetAnimProgress() {
  if (sheetAnim.startedAt === null) return 0;
  const elapsed = performance.now() - sheetAnim.startedAt;
  // Asymptotic curve — climbs fast at first, then slows. Never resets.
  const t = 1 - Math.exp(-elapsed / 2500);
  return Math.min(95, t * 100);
}

function SheetLoadingSpinner({ colors, metaReady, probingPeriod, T }) {
  const [, force] = useState(0);
  useEffect(() => {
    sheetAnimStart();
    const sub = () => force(n => n + 1);
    sheetAnim.subs.add(sub);
    return () => { sheetAnim.subs.delete(sub); sheetAnimMaybeReset(); };
  }, []);
  const progress = sheetAnimProgress();
  return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
      style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
        style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
        <div className="relative" style={{ width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
            <circle cx="70" cy="70" r="60" fill="none"
              stroke="url(#sheetProgGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 60}
              strokeDashoffset={2 * Math.PI * 60 * (1 - progress / 100)}
              style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
            />
            <defs>
              <linearGradient id="sheetProgGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={colors?.primary ?? "#1a2f8a"} />
                <stop offset="100%" stopColor="#CF305D" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black tabular-nums" style={{ color: colors?.primary }}>
              {Math.round(progress)}<span className="text-base text-gray-300">%</span>
            </span>
          </div>
        </div>
<p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
          {!metaReady ? T("loading_meta") : probingPeriod ? T("loading_overlay_period") : T("sheet_building", "Building consolidation sheet…")}
        </p>
        <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
          {T("tab_consolidated")} · {T("nav_sheet")}
        </p>
      </div>
    </div>
  );
}
/* ─── Repair pass — strip values Excel rejects (Infinity / NaN, outline
   levels > 7, malformed ARGB, etc.). Runs on the buffer right before save. */
async function repairSheetXlsx(buffer) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    wb.eachSheet(ws => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (row.outlineLevel && row.outlineLevel > 7) row.outlineLevel = 7;
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value;
          if (typeof v === "number" && (!Number.isFinite(v) || Number.isNaN(v))) {
            cell.value = null;
          }
        });
      });
      ws.columns.forEach(col => {
        if (col && col.outlineLevel && col.outlineLevel > 7) col.outlineLevel = 7;
      });
    });
    return await wb.xlsx.writeBuffer();
  } catch {
    return buffer;
  }
}
/* ─── Excel export ────────────────────────────────────────────────────────
   Native Excel drill-down vertically (rows) AND horizontally (columns):
   - Account rows are outlined by depth so users can collapse parents.
   - Per-JournalHeader elim columns are grouped so the whole eliminations
     breakdown collapses to a single column.
   - Both groups start collapsed for a clean initial view. */
/**
 * Build a single worksheet given a pre-filtered tree + view name. Called once
 * per requested view ("All" / "P/L" / "B/S") from the multi-sheet entry point
 * below.
 */
async function buildSheetWorksheet(wb, ExcelJS, params) {
const {
    sheetName, viewLabel,
    tree, pivot, elimPivot, elimHeaders,
    effectiveCompanies, topParent,
    getLegal, isRootView, displayCurrency,
    source, structure, year, monthLabel,
    compareMode, cmpPivot, cmpYear, cmpMonth, cmpMoLabel,
    activeMapping, mappingDerived, colors,
    perspectiveLegal,
    drillDown, elimDetail,
  } = params;
const ws = wb.addWorksheet(sheetName);

  // ── Brand palette in ARGB. Derived from app colors so the workbook
  //    visually matches the on-screen sheet. ───────────────────────────────
  const toArgb = (hex, fallback = "1A2F8A") => {
    const h = String(hex || "").replace("#", "").toUpperCase();
    return "FF" + (h.length === 6 ? h : fallback.toUpperCase());
  };
  const PRIMARY      = toArgb(colors?.primary, "1A2F8A");      // Navy blue
  const PRIMARY_DARK = "FF0F1F5C";                             // Pressed/darker
  const PRIMARY_SOFT = "FFE8ECFB";                             // Very light primary tint
  const ACCENT       = "FFCF305D";                             // Rose/pink
  const ACCENT_SOFT  = "FFFCE7EE";                             // Very light rose tint
  const GREY_DEEP    = "FF1F2937";                             // Body text
  const GREY_MID     = "FF6B7280";                             // Secondary text
  const GREY_BORDER  = "FFE5E7EB";                             // Lines
  const BAND_A       = "FFFFFFFF";                             // Row band 1
  const BAND_B       = "FFFAFBFE";                             // Row band 2 (very subtle)
  const PARENT_ROW   = "FFF1F4FC";                             // Top-level parent row
  const HEADER_BG    = "FFF6F8FF";                             // Header background
  const WHITE        = "FFFFFFFF";
  const NEG_RED      = "FFEF4444";
  const POS_GREEN    = "FF10B981";

  // ── Compute totals per row (mirrors SheetRow math) ───────────────────────
  const getConsTotal = (code, p) => {
    const byCo = p?.get(code) || {};
    return (byCo[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);
  };
  const getContrib = (code, company, p) => {
    const byCo = p?.get(code) || {};
    const role = company === topParent ? "Parent" : "Contribution";
    return (byCo[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);
  };
  const getContribSum = (code, p) =>
    effectiveCompanies.reduce((s, c) => s + getContrib(code, c, p), 0);

  // ── Flatten tree fully, capturing depth for outline levels ───────────────
  const flat = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      flat.push({ node: n, depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);

  // ── Column layout ────────────────────────────────────────────────────────
  const consCmpCols    = compareMode ? 3 : 0;
  const elimCmpCols    = compareMode ? 3 : 0;
  const contribCmpCols = compareMode ? 3 : 0;
  const perCompanyCols = compareMode ? 4 : 1;

  let colCursor = 1;
  const codeCol       = colCursor++;
  const nameCol       = colCursor++;
  const consCol       = colCursor++;
  colCursor += consCmpCols;
  const elimCol       = colCursor++;
  colCursor += elimCmpCols;
  const elimStartSubCol = colCursor;
  colCursor += elimHeaders.length;
  const elimEndSubCol = colCursor - 1; // last elim sub col (may be < start if 0 headers)
  const contribCol    = colCursor++;
  colCursor += contribCmpCols;
  const companiesStartCol = colCursor;
  const totalCols = companiesStartCol + effectiveCompanies.length * perCompanyCols - 1;

  // ── Title rows ───────────────────────────────────────────────────────────
// Top row — accent strip
  for (let col = 1; col <= totalCols; col++) {
    ws.getCell(1, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
  }
  ws.getRow(1).height = 4;

  // Title block
  ws.mergeCells(2, 1, 2, Math.max(6, totalCols));
  const titleCell = ws.getCell(2, 1);
  titleCell.value = `${isRootView ? "Consolidated" : "Subgroup"} Sheet`;
  titleCell.font = { name: "Calibri", size: 20, bold: true, color: { argb: PRIMARY } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 30;

  ws.mergeCells(3, 1, 3, Math.max(6, totalCols));
  const subTitleCell = ws.getCell(3, 1);
  subTitleCell.value = `${monthLabel} ${year} · ${perspectiveLegal}${displayCurrency ? ` · ${displayCurrency}` : ""}`;
  subTitleCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: ACCENT } };
  subTitleCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(3).height = 18;

  // Context line (smaller, secondary info)
  ws.mergeCells(4, 1, 4, Math.max(6, totalCols));
  const subParts = [];
  if (source) subParts.push(`Source: ${source}`);
  if (structure) subParts.push(`Structure: ${structure}`);
  if (activeMapping) subParts.push(`Mapping: ${activeMapping.name}`);
if (viewLabel) subParts.push(`View: ${viewLabel}`);
  if (compareMode && cmpYear && cmpMonth) subParts.push(`vs ${cmpMoLabel} ${cmpYear}`);
  ws.getCell(4, 1).value = subParts.join("  ·  ");
  ws.getCell(4, 1).font = { name: "Calibri", size: 9, color: { argb: GREY_MID }, italic: true };
  ws.getCell(4, 1).alignment = { vertical: "middle", indent: 1 };
  ws.getRow(4).height = 16;
  ws.getRow(5).height = 8; // spacer

// ── Section band (row 6) ─────────────────────────────────────────────────
  const bandRow = 6;
  const band = (col, span, label, fill) => {
    if (span <= 0) return;
    ws.mergeCells(bandRow, col, bandRow, col + span - 1);
    const c = ws.getCell(bandRow, col);
    c.value = label;
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.font = { name: "Calibri", size: 9, bold: true, color: { argb: WHITE } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.border = {
      top:    { style: "thin", color: { argb: PRIMARY_DARK } },
      bottom: { style: "thin", color: { argb: PRIMARY_DARK } },
    };
  };
  band(codeCol, 2, "ACCOUNT", PRIMARY);
  band(consCol, 1 + consCmpCols, isRootView ? "CONSOLIDATED" : "SUBGROUP", PRIMARY);
  band(elimCol, 1 + elimCmpCols + elimHeaders.length, "ELIMINATIONS", PRIMARY_DARK);
  band(contribCol, 1 + contribCmpCols, "CONTRIBUTION SUM", "FF4B5563");
  if (effectiveCompanies.length > 0) {
    band(companiesStartCol, effectiveCompanies.length * perCompanyCols, "PER-COMPANY CONTRIBUTIONS", ACCENT);
  }
  ws.getRow(bandRow).height = 20;

  // ── Detailed header (row 7) ──────────────────────────────────────────────
  const headRow = 7;
  ws.getCell(headRow, codeCol).value = "Code";
  ws.getCell(headRow, nameCol).value = "Account";
  ws.getCell(headRow, consCol).value = getLegal(topParent);
  if (compareMode) {
    ws.getCell(headRow, consCol + 1).value = "CMP";
    ws.getCell(headRow, consCol + 2).value = "Δ";
    ws.getCell(headRow, consCol + 3).value = "Δ%";
  }
  ws.getCell(headRow, elimCol).value = "Elim. Total";
  if (compareMode) {
    ws.getCell(headRow, elimCol + 1).value = "CMP";
    ws.getCell(headRow, elimCol + 2).value = "Δ";
    ws.getCell(headRow, elimCol + 3).value = "Δ%";
  }
  elimHeaders.forEach((h, i) => {
    ws.getCell(headRow, elimStartSubCol + i).value = h;
  });
  ws.getCell(headRow, contribCol).value = "Contrib. Sum";
  if (compareMode) {
    ws.getCell(headRow, contribCol + 1).value = "CMP";
    ws.getCell(headRow, contribCol + 2).value = "Δ";
    ws.getCell(headRow, contribCol + 3).value = "Δ%";
  }
  effectiveCompanies.forEach((c, i) => {
    const baseCol = companiesStartCol + i * perCompanyCols;
    ws.getCell(headRow, baseCol).value = getLegal(c);
    if (compareMode) {
      ws.getCell(headRow, baseCol + 1).value = "CMP";
      ws.getCell(headRow, baseCol + 2).value = "Δ";
      ws.getCell(headRow, baseCol + 3).value = "Δ%";
    }
  });

for (let col = 1; col <= totalCols; col++) {
    const c = ws.getCell(headRow, col);
    c.font = { name: "Calibri", size: 9, bold: true, color: { argb: PRIMARY } };
    c.alignment = { horizontal: col <= nameCol ? "left" : "center", vertical: "middle", wrapText: true, indent: col <= nameCol ? 1 : 0 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = {
      top:    { style: "thin", color: { argb: GREY_BORDER } },
      bottom: { style: "medium", color: { argb: PRIMARY } },
      left:   { style: "thin", color: { argb: GREY_BORDER } },
      right:  { style: "thin", color: { argb: GREY_BORDER } },
    };
  }
  ws.getRow(headRow).height = 36;
  ws.getRow(headRow + 1).height = 4; // spacer

  // ── Data rows ────────────────────────────────────────────────────────────
  const DATA_START_ROW = headRow + 2;
  let rowIdx = DATA_START_ROW;

const numBorder = {
    top:    { style: "hair", color: { argb: GREY_BORDER } },
    bottom: { style: "hair", color: { argb: GREY_BORDER } },
    left:   { style: "hair", color: { argb: GREY_BORDER } },
    right:  { style: "hair", color: { argb: GREY_BORDER } },
  };

  const writeNum = (row, col, val, isParent) => {
    const cell = ws.getCell(row, col);
    const n = Number(val) || 0;
    if (Math.round(n) === 0) {
      cell.value = null;
    } else {
      cell.value = n;
      cell.numFmt = '#,##0;[Red]-#,##0;""';
    }
    cell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    cell.font = {
      name: "Calibri", size: 10,
      bold: !!isParent,
      color: { argb: n < 0 ? NEG_RED : GREY_DEEP },
    };
    cell.border = numBorder;
  };

  const writeDelta = (row, col, current, compare) => {
    const cell = ws.getCell(row, col);
    const delta = (Number(current) || 0) - (Number(compare) || 0);
    if (Math.round(delta) === 0) { cell.value = null; }
    else { cell.value = delta; cell.numFmt = '+#,##0;-#,##0;""'; }
    cell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    cell.font = { name: "Calibri", size: 10, color: { argb: delta < 0 ? NEG_RED : POS_GREEN } };
    cell.border = numBorder;
  };

  const writePct = (row, col, current, compare) => {
    const cell = ws.getCell(row, col);
    const c = Number(compare) || 0;
    if (c === 0) { cell.value = null; }
    else {
      const pct = ((current - c) / Math.abs(c));
      cell.value = pct;
      cell.numFmt = '+0.0%;-0.0%;""';
    }
    cell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: GREY_MID } };
    cell.border = numBorder;
  };

// ── Breaker config (matches UI logic) ───────────────────────────────────
  const TYPE_LABELS_EXPORT = {
    "P/L": { label: "PROFIT & LOSS",          color: (colors?.primary || "#1a2f8a") },
    "DIS": { label: "DISTRIBUTION OF RESULT", color: (colors?.primary || "#1a2f8a") },
    "B/S": { label: "BALANCE SHEET",          color: "#CF305D" },
    "C/F": { label: "CASH FLOW",              color: "#374151" },
    "CFS": { label: "CASH FLOW",              color: "#374151" },
  };
  const hexToArgb = (hex) => {
    const h = String(hex || "").replace("#", "");
    return "FF" + (h.length === 6 ? h : "1a2f8a").toUpperCase();
  };
  const mappingBreakers = mappingDerived?.breakers || {};

let prevType = null;
  flat.forEach(({ node, depth }, idx) => {
    const code = node.AccountCode;
    const isParent = !!(node.children && node.children.length > 0);
    const type = node.AccountType ?? "";
    const typeChanged = type !== prevType;
    prevType = type;

    // Mapping owns the structure when active — no type-change dividers.
    const mappingBk = mappingBreakers[code];
    const typeBk = (typeChanged && TYPE_LABELS_EXPORT[type]) ? TYPE_LABELS_EXPORT[type] : null;
    const breaker = mappingDerived
      ? (mappingBk ? { label: String(mappingBk.label).toUpperCase(), color: mappingBk.color || "#1a2f8a" } : null)
      : (mappingBk
          ? { label: String(mappingBk.label).toUpperCase(), color: mappingBk.color || "#1a2f8a" }
          : typeBk);

if (breaker) {
      ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
      const bk = ws.getCell(rowIdx, 1);
      bk.value = `  ${breaker.label}`;
      bk.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(breaker.color) } };
      bk.font = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
      bk.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      bk.border = {
        top:    { style: "medium", color: { argb: hexToArgb(breaker.color) } },
        bottom: { style: "medium", color: { argb: hexToArgb(breaker.color) } },
      };
      ws.getRow(rowIdx).height = 22;
      // Breakers never get outlineLevel — they stay visible always
      rowIdx++;
    }

    const consTotal     = getConsTotal(code, pivot);
    const cmpConsTotal  = compareMode ? getConsTotal(code, cmpPivot) : 0;
    const contribSum    = getContribSum(code, pivot);
    const cmpContribSum = compareMode ? getContribSum(code, cmpPivot) : 0;
    const elimTotal     = consTotal - contribSum;
    const cmpElimTotal  = cmpConsTotal - cmpContribSum;

// Code + Name. Code col uses small grey monospace-ish. Name col indents
    // by depth so children visually sit under their parents.
    const codeCell = ws.getCell(rowIdx, codeCol);
    codeCell.value = code;
    codeCell.font = { name: "Consolas", size: 9, bold: isParent, color: { argb: GREY_MID } };
    codeCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    codeCell.border = numBorder;

    const nameCell = ws.getCell(rowIdx, nameCol);
    nameCell.value = node.AccountName;
    nameCell.font = {
      name: "Calibri", size: 10,
      bold: isParent,
      color: { argb: isParent ? PRIMARY : GREY_DEEP },
    };
    nameCell.alignment = { horizontal: "left", vertical: "middle", indent: depth };
    nameCell.border = numBorder;

    // Numeric cells
    writeNum(rowIdx, consCol, consTotal, isParent);
    if (compareMode) {
      writeNum(rowIdx, consCol + 1, cmpConsTotal, isParent);
      writeDelta(rowIdx, consCol + 2, consTotal, cmpConsTotal);
      writePct(rowIdx, consCol + 3, consTotal, cmpConsTotal);
    }
    writeNum(rowIdx, elimCol, elimTotal, isParent);
    if (compareMode) {
      writeNum(rowIdx, elimCol + 1, cmpElimTotal, isParent);
      writeDelta(rowIdx, elimCol + 2, elimTotal, cmpElimTotal);
      writePct(rowIdx, elimCol + 3, elimTotal, cmpElimTotal);
    }
    const elimBucket = elimPivot.get(code) ?? {};
    elimHeaders.forEach((h, i) => {
      writeNum(rowIdx, elimStartSubCol + i, elimBucket[h] ?? 0, isParent);
    });
    writeNum(rowIdx, contribCol, contribSum, isParent);
    if (compareMode) {
      writeNum(rowIdx, contribCol + 1, cmpContribSum, isParent);
      writeDelta(rowIdx, contribCol + 2, contribSum, cmpContribSum);
      writePct(rowIdx, contribCol + 3, contribSum, cmpContribSum);
    }
    effectiveCompanies.forEach((co, i) => {
      const baseCol = companiesStartCol + i * perCompanyCols;
      const val = getContrib(code, co, pivot);
      writeNum(rowIdx, baseCol, val, isParent);
      if (compareMode) {
        const cmpVal = getContrib(code, co, cmpPivot);
        writeNum(rowIdx, baseCol + 1, cmpVal, isParent);
        writeDelta(rowIdx, baseCol + 2, val, cmpVal);
        writePct(rowIdx, baseCol + 3, val, cmpVal);
      }
    });

// Row banding: top-level parents get a heavier fill, regular rows get
    // alternating bands so the eye can track across the wide table.
    let rowFill = null;
    if (isParent && depth === 0) {
      rowFill = PARENT_ROW;
    } else {
      rowFill = (idx % 2 === 0) ? BAND_A : BAND_B;
    }
    for (let col = 1; col <= totalCols; col++) {
      const c = ws.getCell(rowIdx, col);
      if (!c.fill) {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      }
    }

// Row-level outline + collapsed initial state (only if drillDown enabled).
    const row = ws.getRow(rowIdx);
    if (drillDown && depth > 0) {
      row.outlineLevel = Math.min(depth, 7);  // Excel caps at 7
      row.hidden = true;
    }
    rowIdx++;
  });

// ── Column-level outline for elim subcolumns ─────────────────────────────
  if (elimDetail && elimHeaders.length > 0) {
    for (let col = elimStartSubCol; col <= elimEndSubCol; col++) {
      const c = ws.getColumn(col);
      c.outlineLevel = 1;
      c.hidden = true;
    }
  }

  // ── Column widths ────────────────────────────────────────────────────────
  ws.getColumn(codeCol).width = 12;
  ws.getColumn(nameCol).width = 46;
  for (let col = consCol; col <= totalCols; col++) {
    if (col === codeCol || col === nameCol) continue;
    const isSubElim = col >= elimStartSubCol && col <= elimEndSubCol;
    ws.getColumn(col).width = isSubElim ? 16 : 15;
  }

// ── Outline behaviour: summary above (the parent row is ABOVE children) ──
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  // ── Freeze first 2 cols + all header rows (titles + band + detailed header) ──
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: headRow, activeCell: "A1" }];

// (single-sheet build complete — the multi-sheet entry below handles save)
}

/**
 * Multi-sheet entry. Builds one worksheet per requested view (All / P&L / B/S)
 * using filterTreeByType to derive each tab's tree from the shared rawData
 * pivot. The user picks which views via the export modal.
 */
async function generateSheetXlsxMulti({
  pivot, elimPivot, elimHeaders,
  effectiveCompanies, topParent, rootParent,
  getLegal, isRootView, displayCurrency,
  source, structure, year, month, monthLabel,
  compareMode, cmpPivot, cmpYear, cmpMonth, cmpMoLabel,
  activeMapping, mappingDerivedAll, mappingDerivedPL, mappingDerivedBS,
  treeAll, treePL, treeBS,
  colors, perspectiveLegal,
  views,           // ["all", "pl", "bs"] - which sheets to generate
  drillDown, elimDetail,
}) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const fileSaver = await import("file-saver");
  const saveAs = fileSaver.saveAs ?? fileSaver.default?.saveAs;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Konsolidator";
  wb.created = new Date();

  const sheetSpecs = [];
  if (views.includes("all")) sheetSpecs.push({ name: "All",         label: "All Accounts",  tree: treeAll, derived: mappingDerivedAll });
  if (views.includes("pl"))  sheetSpecs.push({ name: "P&L",         label: "Profit & Loss", tree: treePL,  derived: mappingDerivedPL  });
  if (views.includes("bs"))  sheetSpecs.push({ name: "Balance Sheet", label: "Balance Sheet", tree: treeBS,  derived: mappingDerivedBS });

  if (sheetSpecs.length === 0) {
    alert("Select at least one sheet to export.");
    return;
  }

  for (const spec of sheetSpecs) {
    await buildSheetWorksheet(wb, ExcelJS, {
      sheetName: spec.name, viewLabel: spec.label,
      tree: spec.tree, pivot, elimPivot, elimHeaders,
      effectiveCompanies, topParent, rootParent,
      getLegal, isRootView, displayCurrency,
      source, structure, year, month, monthLabel,
      compareMode, cmpPivot, cmpYear, cmpMonth, cmpMoLabel,
      activeMapping, mappingDerived: spec.derived, colors,
      perspectiveLegal,
      drillDown, elimDetail,
    });
  }

  const safePerspective = String(perspectiveLegal || "Sheet").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const fileName = `Consolidation_Sheet_${safePerspective}_${year}-${String(month).padStart(2, "0")}.xlsx`;
  let buffer = await wb.xlsx.writeBuffer();
  buffer = await repairSheetXlsx(buffer);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, fileName);
}

/* ─── PDF export — multi-sheet with column chunking for legibility ────────
   Each requested view (All / P&L / B/S) generates its own section. Within a
   section, columns are split across multiple pages so text stays readable:
   page 1 has Consolidated + Eliminations, page 2 has Per-Company breakdowns,
   etc. The Account column is repeated on every page as a frozen reference. */
async function generateSheetPdf({
  pivot, elimPivot, elimHeaders,
  effectiveCompanies, topParent,
  getLegal, isRootView, displayCurrency,
  source, structure, year, month, monthLabel,
  compareMode, cmpPivot, cmpYear, cmpMonth, cmpMoLabel,
  activeMapping,
  treeAll, treePL, treeBS,
  mappingDerivedAll, mappingDerivedPL, mappingDerivedBS,
  colors, perspectiveLegal,
  views,
  elimDetail,
}) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  // ── Brand palette as RGB tuples (jsPDF format) ─────────────────────────
  const hexToRgb = (hex, fallback = [26, 47, 138]) => {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return fallback;
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };
  const NAVY     = hexToRgb(colors?.primary, [26, 47, 138]);
  const NAVY_DK  = [Math.max(0, NAVY[0]-12), Math.max(0, NAVY[1]-20), Math.max(0, NAVY[2]-40)];
  const ROSE     = [207, 48, 93];
  const ROSE_DK  = [160, 30, 65];
  const GREEN    = [16, 185, 129];
  const RED      = [239, 68, 68];
  const LIGHT    = [238, 241, 251];
  const OFFWHITE = [250, 251, 255];
  const GREY     = [140, 150, 175];
  const GREY_LT  = [210, 215, 230];
  const TEXT_DK  = [20, 35, 80];
  const WHITE    = [255, 255, 255];

  // ── Compute totals (mirrors UI math) ───────────────────────────────────
  const getConsTotal = (code, p) => {
    const byCo = p?.get(code) || {};
    return (byCo[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);
  };
  const getContrib = (code, company, p) => {
    const byCo = p?.get(code) || {};
    const role = company === topParent ? "Parent" : "Contribution";
    return (byCo[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + -(Number(r.AmountYTD ?? 0)), 0);
  };
  const getContribSum = (code, p) =>
    effectiveCompanies.reduce((s, c) => s + getContrib(code, c, p), 0);

  const fmt = (v) => {
    const n = Number(v) || 0;
    if (Math.round(n) === 0) return "—";
    return Math.round(n).toLocaleString("de-DE");
  };
  const fmtDelta = (v) => {
    const n = Number(v) || 0;
    if (Math.round(n) === 0) return "—";
    return (n > 0 ? "+" : "") + Math.round(n).toLocaleString("de-DE");
  };
  const fmtPct = (cur, cmp) => {
    if (!cmp || cmp === 0) return "—";
    const p = ((cur - cmp) / Math.abs(cmp)) * 100;
    return (p >= 0 ? "+" : "") + p.toFixed(1) + "%";
  };

  // ── Doc setup: A3 landscape ────────────────────────────────────────────
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const pageManifest = []; // { displayedPage, title }
  let isFirstContentPage = true;

  // ── Page header drawer ─────────────────────────────────────────────────
  const drawPageHeader = (viewLabel, partLabel) => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 36, "F");
    doc.setFillColor(...ROSE);
    doc.rect(0, 0, 5, 36, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(`${isRootView ? "Consolidated" : "Subgroup"} Sheet · ${viewLabel}`, 12, 14);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`${monthLabel} ${year}  ·  ${perspectiveLegal}${displayCurrency ? `  ·  ${displayCurrency}` : ""}`, 12, 22);
    doc.setFontSize(8.5);
    const ctx = [];
    if (source) ctx.push(`Source: ${source}`);
    if (structure) ctx.push(`Structure: ${structure}`);
    if (activeMapping) ctx.push(`Mapping: ${activeMapping.name}`);
    doc.text(ctx.join("  ·  "), 12, 28);
    // Part badge in top-right
    if (partLabel) {
      doc.setFillColor(...ROSE);
      const badgeW = 36, badgeH = 8;
      doc.roundedRect(W - badgeW - 12, 6, badgeW, badgeH, 2, 2, "F");
      doc.setTextColor(...WHITE);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(partLabel, W - badgeW / 2 - 12, 11.5, { align: "center" });
    }
    if (compareMode && cmpYear && cmpMonth) {
      doc.setFillColor(...ROSE_DK);
      doc.rect(0, 36, W, 6, "F");
      doc.setTextColor(...WHITE);
      doc.setFontSize(8);
      doc.text(`Compared with: ${cmpMoLabel} ${cmpYear}`, 12, 40);
      return 46;
    }
    return 40;
  };

  const drawFooter = (viewLabel) => {
    doc.setFillColor(...LIGHT);
    doc.rect(0, H - 10, W, 10, "F");
    doc.setTextColor(...TEXT_DK);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(`KONSOLIDATOR  ·  ${viewLabel.toUpperCase()}`, 12, H - 4);
    doc.setFont("helvetica", "normal");
    doc.text(`${monthLabel} ${year} · ${perspectiveLegal}`, W / 2, H - 4, { align: "center" });
    const pageNo = doc.internal.getNumberOfPages();
    doc.text(`Page ${pageNo}`, W - 12, H - 4, { align: "right" });
  };

  // ── Flatten tree to rows (with breakers) ───────────────────────────────
  const flattenForPdf = (tree, mappingDerived) => {
    const flat = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        flat.push({ node: n, depth });
        if (n.children?.length) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);

    const TYPE_LABELS_PDF = {
      "P/L": "PROFIT & LOSS",
      "DIS": "DISTRIBUTION OF RESULT",
      "B/S": "BALANCE SHEET",
      "C/F": "CASH FLOW",
      "CFS": "CASH FLOW",
    };
    const mappingBreakers = mappingDerived?.breakers || {};
    const rows = [];
    let prevType = null;
    flat.forEach(({ node, depth }) => {
      const type = node.AccountType ?? "";
      const typeChanged = type !== prevType;
      prevType = type;
      const mappingBk = mappingBreakers[node.AccountCode];
      const typeBk = (typeChanged && TYPE_LABELS_PDF[type]) ? TYPE_LABELS_PDF[type] : null;
      const breakerLabel = mappingDerived
        ? (mappingBk ? String(mappingBk.label).toUpperCase() : null)
        : (mappingBk ? String(mappingBk.label).toUpperCase() : typeBk);
      if (breakerLabel) {
        rows.push({ isBreaker: true, label: breakerLabel });
      }
      rows.push({ node, depth, isBreaker: false });
    });
    return rows;
  };

  // ── Build the list of "column groups" for chunking ─────────────────────
  // Account always reappears as fixed prefix on every chunk.
  const buildColumnGroups = () => {
    const groups = [];
    // Group 1: Consolidated (+ compare cols)
    const g1 = { label: "Consolidated", cols: [
      { key: "cons", header: getLegal(topParent), value: (code) => getConsTotal(code, pivot) },
    ]};
    if (compareMode) {
      g1.cols.push({ key: "cons-cmp",   header: "CMP",   value: (code) => getConsTotal(code, cmpPivot), isCompare: true });
      g1.cols.push({ key: "cons-delta", header: "Δ",     value: (code) => getConsTotal(code, pivot) - getConsTotal(code, cmpPivot), isDelta: true });
      g1.cols.push({ key: "cons-pct",   header: "Δ%",    valueText: (code) => fmtPct(getConsTotal(code, pivot), getConsTotal(code, cmpPivot)), isPct: true });
    }
    groups.push(g1);

    // Group 2: Eliminations
    const g2 = { label: "Eliminations", cols: [
      { key: "elim", header: "Elim. Total", value: (code) => getConsTotal(code, pivot) - getContribSum(code, pivot) },
    ]};
    if (compareMode) {
      g2.cols.push({ key: "elim-cmp",   header: "CMP", value: (code) => getConsTotal(code, cmpPivot) - getContribSum(code, cmpPivot), isCompare: true });
      g2.cols.push({ key: "elim-delta", header: "Δ",   value: (code) => (getConsTotal(code, pivot) - getContribSum(code, pivot)) - (getConsTotal(code, cmpPivot) - getContribSum(code, cmpPivot)), isDelta: true });
    }
    if (elimDetail) {
      elimHeaders.forEach(h => {
        g2.cols.push({ key: `elim-${h}`, header: h, value: (code) => (elimPivot.get(code) ?? {})[h] ?? 0, isElimDetail: true });
      });
    }
    groups.push(g2);

    // Group 3: Contribution sum + per-company columns
    const g3 = { label: "Per-Company Contributions", cols: [
      { key: "contrib", header: "Contrib. Sum", value: (code) => getContribSum(code, pivot) },
    ]};
    if (compareMode) {
      g3.cols.push({ key: "contrib-cmp",   header: "CMP", value: (code) => getContribSum(code, cmpPivot), isCompare: true });
      g3.cols.push({ key: "contrib-delta", header: "Δ",   value: (code) => getContribSum(code, pivot) - getContribSum(code, cmpPivot), isDelta: true });
    }
    effectiveCompanies.forEach(co => {
      g3.cols.push({ key: `co-${co}`, header: getLegal(co), value: (code) => getContrib(code, co, pivot) });
      if (compareMode) {
        g3.cols.push({ key: `co-${co}-cmp`,   header: `${getLegal(co)} · CMP`, value: (code) => getContrib(code, co, cmpPivot), isCompare: true });
        g3.cols.push({ key: `co-${co}-delta`, header: `${getLegal(co)} · Δ`,   value: (code) => getContrib(code, co, pivot) - getContrib(code, co, cmpPivot), isDelta: true });
      }
    });
    groups.push(g3);

    return groups;
  };

  // Split column groups into chunks that fit a page. Target ~10 numeric cols.
  const TARGET_COLS_PER_PAGE = 10;
  const chunkColumnGroups = (groups) => {
    const chunks = [];
    let current = { label: "", cols: [], parts: [] };
    let count = 0;
    const flush = () => {
      if (current.cols.length > 0) chunks.push(current);
      current = { label: "", cols: [], parts: [] };
      count = 0;
    };
    groups.forEach(g => {
      // If this group alone exceeds target, split it but keep cols sequential
      if (g.cols.length > TARGET_COLS_PER_PAGE) {
        flush();
        let i = 0;
        while (i < g.cols.length) {
          const slice = g.cols.slice(i, i + TARGET_COLS_PER_PAGE);
          chunks.push({ label: g.label, cols: slice, parts: [g.label] });
          i += TARGET_COLS_PER_PAGE;
        }
        return;
      }
      if (count + g.cols.length > TARGET_COLS_PER_PAGE && current.cols.length > 0) {
        flush();
      }
      current.cols.push(...g.cols);
      current.parts.push(g.label);
      count += g.cols.length;
    });
    flush();
    return chunks;
  };

  // ── Build pages for a given view ───────────────────────────────────────
  const buildPagesForView = (viewLabel, tree, mappingDerived) => {
    const groups = buildColumnGroups();
    const chunks = chunkColumnGroups(groups);
    const flatRows = flattenForPdf(tree, mappingDerived);

    chunks.forEach((chunk, ci) => {
      if (!isFirstContentPage) doc.addPage();
      isFirstContentPage = false;
      const partLabel = chunks.length > 1 ? `Part ${ci + 1}/${chunks.length}` : null;
      const chunkTitle = `${viewLabel}${partLabel ? ` · ${partLabel}` : ""} (${chunk.parts.join(" + ")})`;
      pageManifest.push({ displayedPage: doc.internal.getNumberOfPages(), title: chunkTitle });

      const startY = drawPageHeader(viewLabel, partLabel);

      // ── Head: Code + Account always, then chunk's columns ────────────
      const headRow = [
        { content: "Code", styles: { halign: "left" } },
        { content: "Account", styles: { halign: "left" } },
      ];
      chunk.cols.forEach(c => {
        headRow.push({ content: c.header, styles: { halign: "center", fontSize: c.isElimDetail ? 6 : 7 } });
      });
      const head = [headRow];

      // ── Body ──────────────────────────────────────────────────────────
      const body = [];
      const totalCols = headRow.length;
      flatRows.forEach(r => {
        if (r.isBreaker) {
          body.push([{
            content: r.label,
            colSpan: totalCols,
            styles: {
              fillColor: NAVY_DK, textColor: WHITE, fontStyle: "bold",
              halign: "left", fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
            },
          }]);
          return;
        }
        const { node, depth } = r;
        const code = node.AccountCode;
        const isParent = !!(node.children && node.children.length > 0);
        const indent = "  ".repeat(Math.min(depth, 6));
        const row = [
          { content: code, styles: { fontStyle: isParent ? "bold" : "normal", textColor: GREY } },
          { content: indent + (node.AccountName ?? code), styles: { fontStyle: isParent ? "bold" : "normal", textColor: TEXT_DK } },
        ];
        chunk.cols.forEach(c => {
          let txt, color;
          if (c.valueText) {
            txt = c.valueText(code);
            color = GREY;
          } else {
            const v = c.value(code);
            if (c.isDelta) {
              txt = fmtDelta(v);
              color = v === 0 ? GREY : v < 0 ? RED : GREEN;
            } else {
              txt = fmt(v);
              color = v < 0 ? RED : TEXT_DK;
            }
          }
          row.push({ content: txt, styles: { halign: "right", textColor: color, fontSize: c.isElimDetail ? 6 : undefined } });
        });
        body.push(row);
      });

      // Adaptive font sizing
      const bodyFontSize = totalCols <= 8 ? 8 : totalCols <= 12 ? 7.5 : 7;

      autoTable(doc, {
        startY, head, body,
        margin: { left: 8, right: 8, bottom: 14 },
        styles: {
          fontSize: bodyFontSize, cellPadding: 1.3, overflow: "linebreak",
          font: "helvetica", textColor: TEXT_DK, lineColor: GREY_LT, lineWidth: 0.1, valign: "middle",
        },
        headStyles: {
          fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: bodyFontSize, halign: "center",
          minCellHeight: 10,
        },
        columnStyles: {
          0: { halign: "left", cellWidth: 20 },
          1: { halign: "left", cellWidth: 70 },
        },
        alternateRowStyles: { fillColor: OFFWHITE },
        didDrawPage: () => drawFooter(viewLabel),
      });
    });
  };

  // ── Generate pages per requested view ──────────────────────────────────
  if (views.includes("all")) buildPagesForView("All Accounts",  treeAll, mappingDerivedAll);
  if (views.includes("pl"))  buildPagesForView("Profit & Loss", treePL,  mappingDerivedPL);
  if (views.includes("bs"))  buildPagesForView("Balance Sheet", treeBS,  mappingDerivedBS);

  // ── Build TOC on page 1 ────────────────────────────────────────────────
  doc.insertPage(1);
  doc.setPage(1);
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 50, "F");
  doc.setFillColor(...ROSE);
  doc.rect(0, 0, 5, 50, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("Consolidation Report", 12, 22);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`${monthLabel} ${year}  ·  ${perspectiveLegal}`, 12, 32);
  doc.setFontSize(9);
  const ctxParts = [];
  if (source) ctxParts.push(`Source: ${source}`);
  if (structure) ctxParts.push(`Structure: ${structure}`);
  if (activeMapping) ctxParts.push(`Mapping: ${activeMapping.name}`);
  if (compareMode && cmpYear && cmpMonth) ctxParts.push(`vs ${cmpMoLabel} ${cmpYear}`);
  ctxParts.push(`Generated ${new Date().toLocaleDateString("es-ES")}`);
  doc.text(ctxParts.join("  ·  "), 12, 40);

  doc.setTextColor(...NAVY);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CONTENTS", 12, 68);
  doc.setDrawColor(...GREY_LT);
  doc.setLineWidth(0.3);
  doc.line(12, 70, W - 12, 70);

  doc.setTextColor(...TEXT_DK);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  let tocY = 80;
  const tocBottom = H - 16;
  pageManifest.forEach((entry, i) => {
    if (tocY > tocBottom) return;
    if (i % 2 === 1) {
      doc.setFillColor(...OFFWHITE);
      doc.rect(10, tocY - 5, W - 20, 8, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.text(entry.title, 14, tocY);
    const pageStr = String(entry.displayedPage + 1);
    const titleW = doc.getTextWidth(entry.title);
    const pageW = doc.getTextWidth(pageStr);
    const dotsStart = 14 + titleW + 4;
    const dotsEnd = W - 14 - pageW - 2;
    const dotW = doc.getTextWidth(". ");
    let x = dotsStart;
    doc.setTextColor(...GREY);
    while (x < dotsEnd) {
      doc.text(".", x, tocY);
      x += dotW;
    }
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.text(pageStr, W - 14, tocY, { align: "right" });
    doc.setTextColor(...TEXT_DK);
    tocY += 9;
  });

  doc.setFillColor(...LIGHT);
  doc.rect(0, H - 10, W, 10, "F");
  doc.setTextColor(...TEXT_DK);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("KONSOLIDATOR  ·  INDEX", 12, H - 4);
  doc.setFont("helvetica", "normal");
  doc.text(`${monthLabel} ${year} · ${perspectiveLegal}`, W / 2, H - 4, { align: "center" });
  doc.text("Page 1", W - 12, H - 4, { align: "right" });

  const safePerspective = String(perspectiveLegal || "Sheet").replace(/[^a-zA-Z0-9_-]+/g, "_");
  doc.save(`Consolidation_Sheet_${safePerspective}_${year}-${String(month).padStart(2, "0")}.pdf`);
}

/* ─── MappingsLanding — 2 cards: Structure + Report ──────────────────────── */
function MappingsLanding({ colors, onPickStructure, onPickReport, T }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const PRIMARY_SOFT = "#3b54b8";
  const ACCENT = "#CF305D";
  const ACCENT_SOFT = "#e0558d";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Structure card */}
        <button onClick={onPickStructure}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)",
            boxShadow: `0 8px 32px -8px ${PRIMARY}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = PRIMARY; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${PRIMARY}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${PRIMARY}18 0%, transparent 70%)`,
              animation: "sheetMapOrb1 8s ease-in-out infinite",
            }} />
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${PRIMARY_SOFT}20 0%, transparent 70%)`,
              animation: "sheetMapOrb2 11s ease-in-out 2s infinite",
            }} />
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpin 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpinR 20s linear infinite" }} />
            </svg>
          </div>

          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                  filter: "blur(12px)", transform: "translateY(4px)", opacity: 0.2,
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
<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("views_structure_mappings")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_structure_desc")}
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
                {["PGC", "Spanish IFRS", "Danish IFRS"].map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                    style={{ background: `${PRIMARY}15`, color: PRIMARY }}>{s}</span>
                ))}
              </div>
<span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: PRIMARY }}>{T("btn_open_arrow")}</span>
            </div>
          </div>
        </button>

        {/* Report card */}
        <button onClick={onPickReport}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)",
            boxShadow: `0 8px 32px -8px ${ACCENT}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${ACCENT}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
              animation: "sheetMapOrb1 9s ease-in-out infinite",
            }} />
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${ACCENT_SOFT}20 0%, transparent 70%)`,
              animation: "sheetMapOrb2 13s ease-in-out 1.5s infinite",
            }} />
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpinR 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpin 20s linear infinite" }} />
            </svg>
          </div>

          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                  filter: "blur(12px)", transform: "translateY(4px)", opacity: 0.2,
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
<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("views_report_mappings")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_report_desc")}
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
<span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                  style={{ background: `${ACCENT}15`, color: ACCENT }}>{T("badge_coming_soon")}</span>
              </div>
<span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: ACCENT }}>{T("btn_preview_arrow")}</span>
            </div>
          </div>
        </button>
      </div>

      <style>{`
        @keyframes sheetMapOrb1 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(20px,-30px) scale(1.1); } }
        @keyframes sheetMapOrb2 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(-15px,20px) scale(0.95); } }
        @keyframes sheetMapSpin  { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        @keyframes sheetMapSpinR { from { transform:rotate(0deg); } to { transform:rotate(-360deg); } }
      `}</style>
    </div>
  );
}

/* ─── MappingsLibrary — saved mappings list ─────────────────────────────── */
function MappingsLibrary({ colors, kind, activeMapping, mappings, loading, error, onApply, onClearActive, onRetry, T }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const ACCENT = kind === "report" ? "#CF305D" : PRIMARY;
  const Icon = kind === "report" ? FileText : Layers;
  const kindLabel = kind === "report" ? T("views_saved_report_mappings") : T("views_saved_mappings");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0 overflow-hidden">
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

      <div className="overflow-y-auto flex-1 p-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin mb-3" style={{ color: ACCENT }} />
           <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{T("loading_mappings")}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "rgba(220,38,38,0.1)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
           <p className="text-sm font-bold text-red-600 mb-1">{T("sheet_couldnt_load", "Couldn't load mappings")}</p>
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
                <button key={m.mapping_id} onClick={() => onApply(m)}
                  className="relative text-left p-4 rounded-xl transition-all flex flex-col"
                  style={{
                    background: isActive ? `${ACCENT}06` : "white",
                    border: `2px solid ${isActive ? ACCENT : "rgba(0,0,0,0.05)"}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 12px -2px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>
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
                            style={{ background: ACCENT, color: "white" }}>{T("views_active")}</span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: ACCENT, opacity: 0.7 }}>
                        {m.standard ?? T("am_filter_custom")}
                      </p>
                    </div>
                  </div>
                  {m.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-3">{m.description}</p>
                  )}
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConsolidationSheetPage({ token, onNavigate }) {
const _h1 = useTypo("header1");
const _h2 = useTypo("header2");
const _b1 = useTypo("body1");
const _b2 = useTypo("body2");
const _sb1 = useTypo("subbody1");
const _u1 = useTypo("underscore1");
const _u2 = useTypo("underscore2");
const _fs = useTypo("filter");
const { colors: _colors, locale } = useSettings();
const T = useCallback((k, fb) => t(locale, k, fb), [locale]);

// Stabilize references — useTypo/useSettings return new objects each render,
// which breaks React.memo on SheetRow. We snapshot the JSON-key as a stable
// primitive so the dep list is a simple expression for eslint.
const _b1Key     = JSON.stringify(_b1);
const _b2Key     = JSON.stringify(_b2);
const _sb1Key    = JSON.stringify(_sb1);
const _colorsKey = JSON.stringify(_colors);

const body1Style    = useMemo(() => _b1,     [_b1Key]);      // eslint-disable-line react-hooks/exhaustive-deps
const body2Style    = useMemo(() => _b2,     [_b2Key]);      // eslint-disable-line react-hooks/exhaustive-deps
const subbody1Style = useMemo(() => _sb1,    [_sb1Key]);     // eslint-disable-line react-hooks/exhaustive-deps
const colors        = useMemo(() => _colors, [_colorsKey]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [periods,        setPeriods]        = useState([]);
  const [sources,        setSources]        = useState([]);
  const [structures,     setStructures]     = useState([]);
  const [companies,      setCompanies]      = useState([]);
  const [consolidations, setConsolidations] = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);

  const [year,               setYear]               = useState("");
  const [month,              setMonth]              = useState("");
  const [source,             setSource]             = useState("");
  const [structure,          setStructure]          = useState("DefaultStructure");
  const [perspectiveCompany, setPerspectiveCompany] = useState("");

  const [rawData,      setRawData]      = useState([]);
  const [uploadedData, setUploadedData] = useState([]);
  const [journalData,  setJournalData]  = useState([]);
const [loading,      setLoading]      = useState(false);
  const [metaReady,    setMetaReady]    = useState(false);
  const [probingPeriod, setProbingPeriod] = useState(false);
const [expanded,     setExpanded]     = useState(new Set());
const [elimExpanded, setElimExpanded] = useState(false);
const [elimColsVisible, setElimColsVisible] = useState(false);
const [elimColsExiting, setElimColsExiting] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [colOrder, setColOrder] = useState([]);
  const [draggingCol, setDraggingCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

const [compareMode, setCompareMode] = useState(false);
const [cmpYear,      setCmpYear]      = useState("");
const [cmpMonth,     setCmpMonth]     = useState("");
const [cmpSource,    setCmpSource]    = useState("");
const [cmpStructure, setCmpStructure] = useState("");
const [cmpRawData,   setCmpRawData]   = useState([]);
const [cmpLoading,   setCmpLoading]   = useState(false);
const [cmpVisible,   setCmpVisible]   = useState(false);
  const [cmpExiting,   setCmpExiting]   = useState(false);
  const [cmpColsExiting, setCmpColsExiting] = useState(false);
  const [cmpColsVisible, setCmpColsVisible] = useState(false);
const autoPeriodDone = useRef(false);
// Compare mode: when compareMode flips ON, we mount the compare cells
  // immediately so they're in the DOM, then on the next animation frame we
  // flip cmpColsVisible to true which triggers the CSS keyframe. When it
  // flips OFF, we set exiting=true, wait for the animation, then unmount.
useEffect(() => {
    let raf, raf2, timer;
    if (compareMode) {
      raf = requestAnimationFrame(() => {
        setCmpVisible(true);
        setCmpExiting(false);
        setCmpColsExiting(false);
        raf2 = requestAnimationFrame(() => setCmpColsVisible(true));
      });
    } else if (cmpVisible) {
      raf = requestAnimationFrame(() => {
        setCmpExiting(true);
        setCmpColsExiting(true);
        timer = setTimeout(() => {
          setCmpVisible(false); setCmpExiting(false);
          setCmpColsVisible(false); setCmpColsExiting(false);
        }, 350);
      });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  useEffect(() => {
    let raf, raf2, timer;
    if (elimExpanded) {
      raf = requestAnimationFrame(() => {
        setElimColsExiting(false);
        raf2 = requestAnimationFrame(() => setElimColsVisible(true));
      });
    } else if (elimColsVisible) {
      raf = requestAnimationFrame(() => {
        setElimColsExiting(true);
        timer = setTimeout(() => {
          setElimColsVisible(false);
          setElimColsExiting(false);
        }, 320);
      });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elimExpanded]);
const [breakers] = useState({});
  const [breakerSortOrder, setBreakerSortOrder] = useState(new Map());

// ── Mappings state — single shared mapping for both P/L and B/S ──────────
  const [activeMapping, setActiveMapping] = useState(null);
  const [viewsMode, setViewsMode] = useState(null); // null | "landing" | "structure" | "report"
  const [savedMappings, setSavedMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState(null);
const [recentMappings, setRecentMappings] = useState([]);

  // ── Export modal state ───────────────────────────────────────────────────
  const [exportModal, setExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState({
    format: "xlsx",
    sheetAll: true,   // include "All" view as one sheet
    sheetPL:  true,   // include P/L view as one sheet
    sheetBS:  true,   // include B/S view as one sheet
    drillDown: true,  // include row drill-down outlines
    elimDetail: true, // include per-JournalHeader elim columns
  });

// Mappings only available on P/L and B/S tabs (not on All)
  const mappingTab = typeFilter === "P/L" ? "pl"
                   : typeFilter === "B/S" ? "bs"
                   : null;
  const mappingsEnabled = !!mappingTab;

  // Convert saved mapping tree → flat { rows, sections }
const convertMappingTree = useCallback((tree) => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    const rows = new Map();
    const sections = new Map();
    let sortCounter = 0;
    let defaultSecCounter = 0;
    const walk = (nodes, depth, parentSection) => {
      for (const node of nodes || []) {
        if (node?.kind === "breaker") {
          const secCode = node.sectionCode || `section_${defaultSecCounter++}`;
          sections.set(secCode, {
            label: String(node.name ?? "Section"),
            color: node.color || "#1a2f8a",
          });
          walk(node.children, depth, secCode);
        } else if (node?.code) {
          const code = String(node.code);
          const sec = parentSection || "_default";
          if (!sections.has(sec)) sections.set(sec, { label: "", color: "#1a2f8a" });
          rows.set(code, {
            section: sec,
            sortOrder: sortCounter++,
            isSum: !!node.isSum,
            showInSummary: !!node.showInSummary,
            level: depth,
          });
          walk(node.children, depth + 1, sec);
        }
      }
    };
walk(tree, 0, null);
    return rows.size > 0 ? { rows, sections } : null;
  }, []);

const handleApplyMapping = useCallback((m, kind = "structure") => {
    setActiveMapping({
      mapping_id: m.mapping_id,
      kind,
      name: m.name,
      standard: m.standard,
      plTreeRaw: m.pl_tree ?? [],
      bsTreeRaw: m.bs_tree ?? [],
      plTreeConverted: convertMappingTree(m.pl_tree ?? []),
      bsTreeConverted: convertMappingTree(m.bs_tree ?? []),
    });
    setViewsMode(null);
  }, [convertMappingTree]);

  const clearActiveMapping = useCallback(() => {
    setActiveMapping(null);
  }, []);
  // P/L + B/S use the same mappings API (mappingsApi / reportMappingsApi)
  const pickMappingApi = useCallback(async (_tab, kind) => {
    const mod = kind === "report"
      ? await import("../../lib/reportMappingsApi")
      : await import("../../lib/mappingsApi");
    return mod;
  }, []);

  // Fetch saved mappings when entering structure/report library
  useEffect(() => {
    if (!viewsMode || viewsMode === "landing") return;
    if (!mappingTab) return;
    let cancelled = false;
    (async () => {
      setMappingsLoading(true);
      setMappingsError(null);
      setSavedMappings([]);
      try {
        const api = await pickMappingApi(mappingTab, viewsMode);
        const supa = await import("../../lib/supabaseClient");
        const { data: { session } } = await supa.supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) throw new Error("No session");
        const cid = await api.getActiveCompanyId(uid);
        if (!cid) throw new Error("No active company");
        const rows = await api.listMappings({ companyId: cid });
        if (!cancelled) setSavedMappings(rows || []);
      } catch (e) {
        if (!cancelled) setMappingsError(e?.message || String(e));
      } finally {
        if (!cancelled) setMappingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewsMode, mappingTab, pickMappingApi]);

// Fetch recent mappings (structure + report combined) for quick-access dropdown
  useEffect(() => {
    if (!mappingTab) { queueMicrotask(() => setRecentMappings([])); return; }
    let cancelled = false;
    (async () => {
      try {
        const supa = await import("../../lib/supabaseClient");
        const { data: { session } } = await supa.supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const structApi = await pickMappingApi(mappingTab, "structure");
        const reportApi = await pickMappingApi(mappingTab, "report");
        const cid = await structApi.getActiveCompanyId(uid);
        if (!cid) return;
        const [structRows, reportRows] = await Promise.all([
          structApi.listMappings({ companyId: cid }).catch(() => []),
          reportApi.listMappings({ companyId: cid }).catch(() => []),
        ]);
        if (cancelled) return;
        setRecentMappings([
          ...(structRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "structure", updated_at: r.updated_at, raw: r })),
          ...(reportRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "report",    updated_at: r.updated_at, raw: r })),
        ]);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [mappingTab, pickMappingApi]);

  const handleApplyFromCard = useCallback(async (m, kind) => {
    try {
      const api = await pickMappingApi(mappingTab, kind);
      const full = await api.getMapping(m.mapping_id);
      handleApplyMapping(full ?? m, kind);
    } catch {
      handleApplyMapping(m, kind);
    }
  }, [mappingTab, pickMappingApi, handleApplyMapping]);

// Reset expansion when active mapping changes
  useEffect(() => { queueMicrotask(() => setExpanded(new Set())); }, [activeMapping?.mapping_id, typeFilter]);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${BASE}/periods`,         { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/sources`,         { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/structures`,      { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/companies`,       { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/consolidations`,  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/group-structure`, { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
    ]).then(([p, s, st, co, cons, gs]) => {
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      const latest = p
        .filter(x => x.Source === "Actual" && x.Closed === true)
        .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0]
        ?? p
        .filter(x => x.Source === "Actual")
        .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0];
      if (latest) { setYear(String(latest.Year)); setMonth(String(latest.Month)); setSource("Actual"); }
      setMetaReady(true);
    });
  }, [token]);

useEffect(() => {
    if (autoPeriodDone.current) return;
    if (!token || !metaReady) return;
    if (sources.length === 0 || structures.length === 0) return;
if (!source || !structure || !year || !month) return;
    autoPeriodDone.current = true;
    queueMicrotask(() => setProbingPeriod(true));

    // Snapshot the starting filters once — we don't want to react to our own writes
    const startSource    = source;
    const startStructure = structure;
    const startY         = parseInt(year);
    const startM         = parseInt(month);

    const probe = async (y, m, src, str) => {
      try {
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}'`;
        const res = await fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return false;
        const d = await res.json();
        return (d.value ?? []).length > 0;
      } catch { return false; }
    };

    (async () => {
      // Pass 1 — current source+structure, 24 months back from selected period
      let probeY = startY, probeM = startM;
      for (let i = 0; i < 24; i++) {
        if (await probe(probeY, probeM, startSource, startStructure)) {
          if (probeY !== startY || probeM !== startM) {
            setYear(String(probeY));
            setMonth(String(probeM));
          }
          setProbingPeriod(false);
          return;
        }
        probeM -= 1;
        if (probeM < 1) { probeM = 12; probeY -= 1; }
      }

      // Pass 2 — sweep all source × structure combinations for the last 12 months
      const allSources = [...new Set(sources.map(s =>
        typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s)
      ).filter(Boolean))];
      const allStructures = [...new Set(structures.map(s =>
        typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s)
      ).filter(Boolean))];

      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      for (let i = 0; i < 12; i++) {
        for (const src of allSources) {
          for (const str of allStructures) {
            if (src === startSource && str === startStructure) continue;
            if (await probe(y, m, src, str)) {
              // Batch the four updates so React commits them in a single render
              setSource(src);
              setStructure(str);
              setYear(String(y));
              setMonth(String(m));
              setProbingPeriod(false);
              return;
            }
          }
        }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      setProbingPeriod(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, metaReady, sources, structures]);

  // ── Perspective / subgroup derivation (driven by /v2/group-structure) ─────
  // The Perspective pill offers any holding that ALSO has its own consolidation
  // run for the current period — picking one refetches the whole dataset from
  // that consolidation, so every amount already lives in the picked holding's
  // reporting currency. No client-side FX.
  const { topParent, rootParent, contributionCompanies, holdingOptions, displayCurrency } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.companyShortName ?? g.CompanyShortName ?? "",
      parent:    g.parentShortName  ?? g.ParentShortName  ?? "",
      structure: g.groupStructure   ?? g.GroupStructure   ?? "",
      hasChild:  g.hasChild         ?? g.HasChild         ?? false,
      detached:  g.detached         ?? g.Detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    const root = gsRows.find(g => !g.parent)?.company || "";

    // Consolidation runs available for this Year/Month/Source/Structure.
    // Intersect with holdings so we never offer a perspective that has no data.
    const consolidatedGroups = new Set(
      consolidations
        .filter(c =>
          String(c.Year ?? c.year) === year &&
          String(c.Month ?? c.month) === month &&
          (c.Source ?? c.source) === source &&
          (c.GroupStructure ?? c.groupStructure) === structure
        )
        .map(c => c.GroupShortName ?? c.groupShortName)
        .filter(Boolean)
    );

    const candidates = gsRows
      .filter(g => g.hasChild || g.company === root)
      .map(g => g.company);

    // Fail-open: if the consolidations endpoint hasn't populated yet, still
    // show all holdings rather than an empty dropdown.
    const holdingShortNames = consolidatedGroups.size > 0
      ? candidates.filter(c => consolidatedGroups.has(c))
      : candidates;

    const selected = holdingShortNames.includes(perspectiveCompany)
      ? perspectiveCompany
      : (holdingShortNames.includes(root) ? root : (holdingShortNames[0] || root));

    const kids = gsRows
      .filter(g => g.parent === selected)
      .map(g => g.company)
      .sort((a, b) => {
        const lA = companies.find(c => c.CompanyShortName === a)?.CompanyLegalName || a;
        const lB = companies.find(c => c.CompanyShortName === b)?.CompanyLegalName || b;
        return lA.localeCompare(lB, "es", { sensitivity: "base" });
      });

    const holdingOpts = holdingShortNames
      .map(h => {
        const legal = companies.find(c => c.CompanyShortName === h)?.CompanyLegalName || h;
        return { value: h, label: legal };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

    // Perspective's own currency — which is ALSO the reporting currency of its
    // consolidation run, i.e. the currency every amount in the page will be in.
    const currency = companies.find(c => c.CompanyShortName === selected)?.CurrencyCode || "";

    return {
      topParent: selected,
      rootParent: root,
      contributionCompanies: [selected, ...kids].filter(Boolean),
      holdingOptions: holdingOpts,
      displayCurrency: currency,
    };
  }, [groupStructure, structure, consolidations, year, month, source, companies, perspectiveCompany]);

  const isRootView = topParent === rootParent;

  // ── Load consolidated accounts + journals — scoped to the perspective ─────
  // The `GroupShortName eq '${topParent}'` filter is what makes currency work:
  // rows come back from the selected consolidation, so ReportingAmountYTD is
  // already in topParent's currency (MAD for Tizon, EUR for Bird, etc.).
  useEffect(() => {
if (!metaReady || !year || !month || !source || !structure || !topParent) return;
    queueMicrotask(() => {
      setLoading(true);
      setExpanded(new Set());
    });
const consFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
    const baseFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;

    Promise.all([
      fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(consFilter)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).then(d => d.value || []),
      fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).then(d => d.value || []),
      fetch(`${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).then(d => d.value || []),
])
.then(([cons, uploaded, journals]) => {
        setRawData([]);
        setUploadedData([]);
        setJournalData([]);
        setRawData(cons);
        setUploadedData(uploaded);
        setJournalData(journals);
        setLoading(false);
      })
      .catch(() => setLoading(false));
 }, [token, metaReady, year, month, source, structure, topParent, consolidations]);

useEffect(() => {
    if (!rawData.length) return;
    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

    (async () => {
      try {
        // 1. Fetch all known standards and their table mappings
        const standards = await fetch(
          `${SUPABASE_URL}/accounting_standards?select=*`,
          { headers: sbHeaders }
        ).then(r => r.json());

        if (!Array.isArray(standards) || standards.length === 0) return;

        // 2. Collect all account codes from rawData for detection
        const codes = [...new Set(rawData.map(r => String(r.AccountCode ?? "")))];

        // 3. Find the first standard whose detect_pattern matches any code
        let matched = null;
        for (const std of standards) {
          if (!std.detect_pattern) continue;
          const re = new RegExp(std.detect_pattern);
          if (codes.some(c => re.test(c))) { matched = std; break; }
        }

        if (!matched) return;

        // 4. Fetch all mapping tables for the matched standard in parallel
        const tablesToFetch = [
          matched.pl_table,
          matched.bs_table,
          matched.cf_table,
        ].filter(Boolean);

        const results = await Promise.all(
          tablesToFetch.map(t =>
            fetch(`${SUPABASE_URL}/${t}?select=*&order=sort_order.asc`, { headers: sbHeaders })
              .then(r => r.json())
              .then(rows => Array.isArray(rows) ? rows : [])
              .catch(() => [])
          )
        );

        const allRows = results.flat();
        if (!allRows.length) return;

        const breakerOrder = new Map();
        allRows.forEach((r, idx) => breakerOrder.set(r.account_code, idx));
        setBreakerSortOrder(breakerOrder);

} catch { /* swallow */ }
    })();
  }, [rawData]);

  // ── Fetch compare data ────────────────────────────────────────────────────
useEffect(() => {
  if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !topParent) return;
  queueMicrotask(() => setCmpLoading(true));
  const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}' and GroupShortName eq '${topParent}'`;
  fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(r => r.json())
    .then(d => { setCmpRawData(d.value || []); setCmpLoading(false); })
    .catch(() => { setCmpRawData([]); setCmpLoading(false); });
}, [token, compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, topParent]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const pivot = useMemo(() => {
    const m = new Map();
    rawData.forEach(r => {
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
      c[r.CompanyShortName].push(r);
    });
    return m;
  }, [rawData]);

  // Compare-period pivot: { code → { company → consTotal, contribByCo } }
const cmpPivot = useMemo(() => {
  const m = new Map();
  cmpRawData.forEach(r => {
    if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
    const c = m.get(r.AccountCode);
    if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
    c[r.CompanyShortName].push(r);
  });
  return m;
}, [cmpRawData]);

// ── Elimination rollup by JournalHeader ───────────────────────────────────
  // Each elimination journal has a meaningful Header describing what it does.
  // We collect every distinct header that appears at Group level, bucket per
  // header per account, and roll up the tree. Sub-columns are derived
  // dynamically from the data — order is stable (alphabetical, with empty
  // headers last).
  const { elimPivot, elimHeaders } = useMemo(() => {
    // 1. Collect Group-level journals only (these are the consolidation engine's postings)
    const groupJournals = journalData.filter(r => r.CompanyShortName === topParent);

    // 2. Discover all distinct headers
    const headerSet = new Set();
    groupJournals.forEach(r => {
      const h = String(r.JournalHeader ?? "").trim() || "(no header)";
      headerSet.add(h);
    });
    const headers = [...headerSet].sort((a, b) => {
      if (a === "(no header)") return 1;
      if (b === "(no header)") return -1;
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });

    // 3. Bucket per account per header
    const empty = () => Object.fromEntries(headers.map(h => [h, 0]));
    const detail = new Map();
    groupJournals.forEach(r => {
      const ac = String(r.AccountCode ?? "").trim();
      if (!ac) return;
      const h = String(r.JournalHeader ?? "").trim() || "(no header)";
      if (!detail.has(ac)) detail.set(ac, empty());
      detail.get(ac)[h] += -(Number(r.AmountYTD ?? 0));
    });

    // 4. Roll up the tree (parent inherits sum of all child journal entries)
    const parentOf = new Map();
    const seen = new Set();
    rawData.forEach(r => {
      const ac = String(r.AccountCode ?? "").trim();
      if (!ac || seen.has(ac)) return;
      seen.add(ac);
      if (r.SumAccountCode) parentOf.set(ac, String(r.SumAccountCode).trim());
    });

    const m = new Map();
    const addTo = (code, src) => {
      if (!m.has(code)) m.set(code, empty());
      const dst = m.get(code);
      headers.forEach(h => { dst[h] += src[h]; });
    };

    detail.forEach((src, ac) => {
      addTo(ac, src);
      let cur = ac;
      while (parentOf.has(cur)) {
        const par = parentOf.get(cur);
        addTo(par, src);
        cur = par;
      }
    });

// Drop headers where every account is zero (keeps the view clean)
    const headerTotals = {};
    headers.forEach(h => {
      let absSum = 0;
      for (const v of m.values()) absSum += Math.abs(v[h] ?? 0);
      headerTotals[h] = absSum;
    });
    const nonEmptyHeaders = headers.filter(h => headerTotals[h] >= 1);

return { elimPivot: m, elimHeaders: nonEmptyHeaders };
  }, [journalData, rawData, topParent]);

  const uploadedPivot = useMemo(() => {
    const m = new Map();
    uploadedData.forEach(r => {
      const ac = r.AccountCode ?? r.accountCode ?? "";
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!ac || !co) return;
      if (!m.has(ac)) m.set(ac, {});
      const byCompany = m.get(ac);
      if (!byCompany[co]) byCompany[co] = [];
      byCompany[co].push(r);
    });
    return m;
  }, [uploadedData]);

// Derive sortOrder + breakers + mappedCodes from active mapping (if any).
  // Picks the right tree based on the current tab. If the mapping doesn't
  // have a tree for the current tab (e.g. only pl_tree exists and user is
  // on B/S), return null so the standard render path takes over instead of
  // showing an empty table.
const mappingDerived = useMemo(() => {
    if (!activeMapping) return null;
    if (!mappingTab) return null;
    const converted = mappingTab === "pl"
      ? activeMapping.plTreeConverted
      : activeMapping.bsTreeConverted;
    if (!converted || converted.rows.size === 0) return null;
    const { rows, sections } = converted;
    const sortOrder = new Map();
    const codeSection = new Map();   // code → sectionId
    const mappedCodes = new Set();
    rows.forEach((info, code) => {
      sortOrder.set(code, info.sortOrder);
      codeSection.set(code, info.section);
      if (!info.isSum) mappedCodes.add(code);
    });
    // sectionMeta: sectionId → { label, color }
    const sectionMeta = {};
    sections.forEach((secInfo, secId) => {
      if (secInfo && secInfo.label) {
        sectionMeta[secId] = { label: secInfo.label, color: secInfo.color || "#1a2f8a" };
      }
    });
    return { sortOrder, codeSection, sectionMeta, mappedCodes };
  }, [activeMapping, mappingTab]);

// Account tree
  const { accountMap, tree, mappingBreakersOverride } = useMemo(() => {
    const accountMap = new Map();
    rawData.forEach(r => {
      if (!accountMap.has(r.AccountCode)) {
        accountMap.set(r.AccountCode, {
          AccountCode: r.AccountCode, AccountName: r.AccountName,
          AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
        });
      }
    });
if (!accountMap.size) return { accountMap, tree: [], mappingBreakersOverride: null };

// ── Mapping-driven branch ─────────────────────────────────────────────
    // mappingDerived.mappedCodes already comes from the tab-specific tree
    // (plTreeConverted when on P/L, bsTreeConverted when on B/S). So every
    // code here belongs to the current tab BY DEFINITION. No AccountType
    // filtering needed — the tab separation comes from which tree (pl_tree
    // vs bs_tree) the codes were stored under in the mapping.
    //
    // Render EVERY mapped code regardless of whether it has data. Codes that
    // exist in the API response get real names/types/values; codes that only
    // live in the mapping render with the code as the name and zero values.
if (mappingDerived && mappingDerived.mappedCodes.size > 0) {
      const treeNodes = [];
      mappingDerived.mappedCodes.forEach(code => {
        const existing = accountMap.get(code);
        if (!existing) return;
        treeNodes.push({
          AccountCode: code,
          AccountName: existing.AccountName,
          AccountType: existing.AccountType,
          SumAccountCode: existing.SumAccountCode ?? null,
          children: [],
        });
      });
      treeNodes.sort((a, b) => {
        const sA = mappingDerived.sortOrder.get(a.AccountCode) ?? 9999;
        const sB = mappingDerived.sortOrder.get(b.AccountCode) ?? 9999;
        return sA - sB;
      });
      // Assign breakers to the FIRST SURVIVING code of each section. If the
      // section's original first code got filtered out (not in accountMap),
      // the breaker would otherwise be lost — this transfers it to whichever
      // mapped code actually made it into the tree first.
const mappingBreakersOverride = {};
      const seenSections = new Set();
      treeNodes.forEach(node => {
        const secId = mappingDerived.codeSection.get(node.AccountCode);
        if (!secId || seenSections.has(secId)) return;
        const meta = mappingDerived.sectionMeta[secId];
        if (meta) mappingBreakersOverride[node.AccountCode] = meta;
        seenSections.add(secId);
      });
      return { accountMap, tree: treeNodes, mappingBreakersOverride };
    }

    // ── Standard branch (no mapping for this tab) ──────────────────────────
    const typeFilteredMap = new Map([...accountMap.entries()].filter(([, v]) => {
      const t = v.AccountType ?? "";
      let typeMatches;
      if (typeFilter === "P/L") typeMatches = (t === "P/L" || t === "DIS");
      else if (typeFilter === "B/S") typeMatches = (t === "B/S");
      else if (typeFilter === "C/F") typeMatches = (t === "C/F" || t === "CFS");
      else typeMatches = (t !== "C/F" && t !== "CFS");
      return typeMatches;
    }));

    // Effective sort: mapping overrides standard breaker order
    const effectiveSortOrder = mappingDerived?.sortOrder ?? breakerSortOrder;

    if (effectiveSortOrder.size > 0) {
      const tree = [...typeFilteredMap.values()]
        .sort((a, b) => {
          const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999;
          const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999;
          if (sA !== sB) return sA - sB;
          const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
          const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
          return tA - tB;
        })
        .map(n => ({ ...n, children: [] }));
return { accountMap, tree, mappingBreakersOverride: null };
    }
    const tree = buildTree([...typeFilteredMap.values()]).sort((a, b) => {
      const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
      const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
      return tA - tB;
    });
return { accountMap, tree, mappingBreakersOverride: null };
  }, [rawData, breakerSortOrder, typeFilter, mappingDerived]);

// ── Pre-built trees for each export view ─────────────────────────────────
  // The on-screen `tree` uses the user's current typeFilter. The Excel export
  // needs trees for ALL three views (All, P/L, B/S) regardless of which tab
  // is active, so each sheet gets its own filtered tree.
  const exportTrees = useMemo(() => {
    const accountMap = new Map();
    rawData.forEach(r => {
      if (!accountMap.has(r.AccountCode)) {
        accountMap.set(r.AccountCode, {
          AccountCode: r.AccountCode, AccountName: r.AccountName,
          AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
        });
      }
    });
    if (!accountMap.size) return { all: [], pl: [], bs: [] };

    const buildFiltered = (filterType, mappingForView) => {
// Mapping path
      if (mappingForView && mappingForView.mappedCodes.size > 0) {
        const nodes = [];
        mappingForView.mappedCodes.forEach(code => {
          const existing = accountMap.get(code);
          if (!existing) return;
          nodes.push({
            AccountCode: code,
            AccountName: existing.AccountName,
            AccountType: existing.AccountType,
            SumAccountCode: existing.SumAccountCode ?? null,
            children: [],
          });
        });
        nodes.sort((a, b) => {
          const sA = mappingForView.sortOrder.get(a.AccountCode) ?? 9999;
          const sB = mappingForView.sortOrder.get(b.AccountCode) ?? 9999;
          return sA - sB;
        });
        // Reassign breakers to first surviving code per section
        const breakers = {};
        const seen = new Set();
        nodes.forEach(n => {
          const secId = mappingForView.codeSection?.get(n.AccountCode);
          if (!secId || seen.has(secId)) return;
          const meta = mappingForView.sectionMeta?.[secId];
          if (meta) breakers[n.AccountCode] = meta;
          seen.add(secId);
        });
        mappingForView.breakers = breakers;
        return nodes;
      }
      // Standard path
      const filtered = new Map([...accountMap.entries()].filter(([, v]) => {
        const t = v.AccountType ?? "";
        if (filterType === "P/L") return t === "P/L" || t === "DIS";
        if (filterType === "B/S") return t === "B/S";
        return t !== "C/F" && t !== "CFS"; // All
      }));
      if (breakerSortOrder.size > 0) {
        return [...filtered.values()].sort((a, b) => {
          const sA = breakerSortOrder.get(a.AccountCode) ?? 9999;
          const sB = breakerSortOrder.get(b.AccountCode) ?? 9999;
          if (sA !== sB) return sA - sB;
          const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
          const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
          return tA - tB;
        }).map(n => ({ ...n, children: [] }));
      }
      return buildTree([...filtered.values()]).sort((a, b) => {
        const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
        const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
        return tA - tB;
      });
    };

const getDerivedFor = (tab) => {
      if (!activeMapping) return null;
      const converted = tab === "pl" ? activeMapping.plTreeConverted
                      : tab === "bs" ? activeMapping.bsTreeConverted
                      : null;
      if (!converted || converted.rows.size === 0) return null;
      const sortOrder = new Map();
      const codeSection = new Map();
      const mappedCodes = new Set();
      converted.rows.forEach((info, code) => {
        sortOrder.set(code, info.sortOrder);
        codeSection.set(code, info.section);
        if (!info.isSum) mappedCodes.add(code);
      });
      const sectionMeta = {};
      converted.sections.forEach((secInfo, secId) => {
        if (secInfo && secInfo.label) {
          sectionMeta[secId] = { label: secInfo.label, color: secInfo.color || "#1a2f8a" };
        }
      });
      return { sortOrder, codeSection, sectionMeta, mappedCodes, breakers: {} };
    };

    const derivedPL = getDerivedFor("pl");
    const derivedBS = getDerivedFor("bs");

    return {
      all: buildFiltered("", null),
      pl:  buildFiltered("P/L", derivedPL),
      bs:  buildFiltered("B/S", derivedBS),
      derivedPL, derivedBS,
    };
}, [rawData, breakerSortOrder, activeMapping]);

const toggleExpand = useCallback((code) => setExpanded(prev => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next;
  }), []);

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: T(`month_${m}`) }));

  const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;
const baseEffectiveCompanies = useMemo(() => (
    selectedCompanies.length === 0
      ? contributionCompanies
      : contributionCompanies.filter(c => selectedCompanies.includes(c))
  ), [selectedCompanies, contributionCompanies]);

  const effectiveCompanies = useMemo(() => {
    if (colOrder.length === 0) return baseEffectiveCompanies;
    const ordered = colOrder.filter(c => baseEffectiveCompanies.includes(c));
    const rest = baseEffectiveCompanies.filter(c => !ordered.includes(c));
    return [...ordered, ...rest];
  }, [baseEffectiveCompanies, colOrder]);
return (
   <div className="flex flex-col gap-4 h-full min-h-0" style={{ overflow: "visible" }}>
<style>{`
        /* Outer wrapper clips the vertical scrollbar by being narrower than the inner scroller */
        .consolidation-scroll-outer {
          position: relative;
          overflow: hidden;
        }
.consolidation-scroll {
          overflow: auto;
          height: 100%;
          /* Push the vertical scrollbar outside the visible area */
          padding-right: 16px;
          margin-right: -16px;
          /* Isolate layout/paint from the rest of the page so the sidebar
             resize doesn't force the browser to re-measure every cell */
          contain: layout paint style;
          /* Firefox */
          scrollbar-width: thin;
          scrollbar-color: #94a3b8 #f1f5f9;
        }
        .consolidation-scroll-outer {
          contain: layout paint;
        }
.consolidation-scroll::-webkit-scrollbar {
          height: 14px;
          width: 10px;
        }
        .consolidation-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #94a3b8 0%, #64748b 100%);
          border-radius: 7px;
          border: 2px solid #f1f5f9;
        }
        .consolidation-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #64748b 0%, #475569 100%);
        }
.consolidation-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
          border-radius: 7px;
        }
        /* Section dividers — thick vertical accent between Consolidated /
           Eliminations / Contribution sum / Per-company areas */
        .sheet-area-start {
          position: relative;
          border-left: 1px solid rgba(26,47,138,0.20) !important;
        }
        .sheet-area-start::before {
          content: "";
          position: absolute;
          left: -1px;
          top: 0;
          bottom: 0;
          width: 3px;
          background: linear-gradient(180deg, rgba(26,47,138,0.10) 0%, rgba(26,47,138,0.04) 100%);
          pointer-events: none;
          z-index: 1;
        }
        .sheet-area-elim    { background-color: rgba(26,47,138,0.015); }
        .sheet-area-contrib { background-color: rgba(26,47,138,0.025); }
        .sheet-area-cos     { background-color: rgba(26,47,138,0.04); }
        /* Solid background layer under the sticky thead so breaker rows don't
           bleed through the inter-column gaps when scrolling */
        .consolidation-scroll table > thead {
          position: sticky;
          top: 0;
          z-index: 30;
          background: #ffffff;
        }
        .consolidation-scroll table > thead::before {
          content: "";
          position: absolute;
          inset: 0;
          background: #ffffff;
          z-index: -1;
        }
        /* Remove gaps between th cells in the sticky header */
        .consolidation-scroll table > thead > tr > th {
          background-clip: padding-box;
        }
@keyframes cmpColIn  { from { opacity:0; transform:scaleX(0.6); } to { opacity:1; transform:scaleX(1); } }
        @keyframes cmpColOut { from { opacity:1; transform:scaleX(1); } to { opacity:0; transform:scaleX(0.6); } }
        @keyframes sheetIconMorph { 0% { opacity:0; transform: scale(0.4) rotate(-90deg); } 60% { opacity:1; } 100% { opacity:1; transform: scale(1) rotate(0deg); } }
@keyframes sheetRowSlideIn  { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes sheetCellAccordion {
          0%   { opacity: 0; transform: translateY(-10px) scaleY(0.6); filter: blur(2px); }
          60%  { opacity: 0.8; filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scaleY(1); filter: blur(0); }
        }
        @keyframes sheetEmptyIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes sheetOrb1 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(20px,-30px) scale(1.1); } }
        @keyframes sheetOrb2 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(-15px,20px) scale(0.95); } }
        @keyframes sheetSpin  { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
  @keyframes sheetSpinR { from { transform:rotate(0deg); } to { transform:rotate(-360deg); } }
        @keyframes kBadgesPop { 0% { opacity:0; transform:translateY(8px) scale(0.96); } 100% { opacity:1; transform:translateY(0) scale(1); } }
@keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes cmpBarIn { 
          0%   { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 
          100% { opacity: 1; max-height: 80px; padding-top: 12px; padding-bottom: 12px; } 
        }
        @keyframes cmpBarOut { 
          0%   { opacity: 1; max-height: 80px; padding-top: 12px; padding-bottom: 12px; } 
          100% { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 
        }
      `}</style>
<PageHeader
kicker={viewsMode ? T("mappings") : T("tab_consolidated")}
        title={viewsMode === "landing" ? T("mappings")
             : viewsMode === "structure" ? T("views_structure_mappings")
             : viewsMode === "report" ? T("views_report_mappings")
             : T("nav_sheet")}
        onBack={viewsMode ? () => {
          if (viewsMode === "landing") setViewsMode(null);
          else setViewsMode("landing");
        } : undefined}
        mappingsQuickAccess={!viewsMode ? recentMappings : []}
        onQuickApplyMapping={async (m) => {
          const api = await pickMappingApi(mappingTab, m.kind);
          const full = await api.getMapping(m.id);
          handleApplyMapping(full ?? m.raw, m.kind);
        }}
        onMappingsClick={viewsMode ? undefined : (mappingsEnabled ? () => setViewsMode("landing") : undefined)}
tabs={viewsMode ? [] : [
          { id: "",    label: T("all"),          icon: Filter    },
          { id: "P/L", label: T("tab_pl"),       icon: TrendingUp },
          { id: "B/S", label: T("tab_bs_short"), icon: BarChart2 },
        ]}
        activeTab={viewsMode ? null : typeFilter}
        onTabChange={viewsMode ? undefined : setTypeFilter}
        filters={viewsMode ? [] : [
...(sources.length > 0
            ? [{ label: T("filter_source"), value: source, onChange: setSource,
                options: sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s })) }]
            : []),
...(availableYears.length > 0
            ? [{ label: T("filter_year"), value: year, onChange: setYear, options: availableYears }]
            : []),
          ...(availableMonths.length > 0
            ? [{ label: T("filter_month"), value: month, onChange: setMonth, options: availableMonths }]
            : []),
          ...(structures.length > 0
            ? [{ label: T("filter_structure"), value: structure, onChange: setStructure,
                options: structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s })) }]
            : []),
...(holdingOptions.length > 1
            ? [{ label: T("filter_perspective"), value: topParent, onChange: (v) => { setPerspectiveCompany(v); setSelectedCompanies([]); setColOrder([]); }, options: holdingOptions }]
            : []),
...(contributionCompanies.length > 1
            ? [{
                label: T("filter_company"),
                multiselect: true,
                values: selectedCompanies.length === 0 ? null : selectedCompanies,
                onChange: (v) => setSelectedCompanies(v ?? []),
                options: contributionCompanies.map(co => ({
                  value: co,
                  label: companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co,
                })),
              }]
            : []),
        ]}
compareToggle={viewsMode ? null : {
          active: compareMode,
          onChange: (newVal) => {
            if (newVal && !compareMode) {
              setCmpYear(year); setCmpMonth(month);
              setCmpSource(source); setCmpStructure(structure);
            }
            setCompareMode(newVal);
          },
        }}
onExportXlsx={() => {
          setExportOpts(o => ({ ...o, format: "xlsx" }));
          setExportModal(true);
        }}
        onExportPdf={() => {
          setExportOpts(o => ({ ...o, format: "pdf" }));
          setExportModal(true);
        }}
      />



{activeMapping && !viewsMode && (() => {
        const hasPL = !!(activeMapping.plTreeConverted && activeMapping.plTreeConverted.rows.size > 0);
        const hasBS = !!(activeMapping.bsTreeConverted && activeMapping.bsTreeConverted.rows.size > 0);
        const coverageParts = [];
        if (hasPL) coverageParts.push("P/L");
        if (hasBS) coverageParts.push("B/S");
        const coverage = coverageParts.join(" + ") || "—";

        // Is the mapping actually applied to the CURRENT tab right now?
        const appliedToCurrentTab =
          (typeFilter === "P/L" && hasPL) ||
          (typeFilter === "B/S" && hasBS);
        const onUncoveredTab =
          mappingsEnabled && !appliedToCurrentTab;

        return (
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border flex-shrink-0"
          style={{
            background: onUncoveredTab
              ? "linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)"
              : "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            borderColor: onUncoveredTab ? "rgba(234,88,12,0.25)" : "rgba(16,185,129,0.25)",
            boxShadow: onUncoveredTab
              ? "0 2px 8px -2px rgba(234,88,12,0.15)"
              : "0 2px 8px -2px rgba(16,185,129,0.15)",
          }}>
          <div className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
            style={{ background: onUncoveredTab ? "rgba(234,88,12,0.18)" : "rgba(16,185,129,0.18)" }}>
            {onUncoveredTab ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.22em]"
              style={{ color: onUncoveredTab ? "#9a3412" : "#047857", opacity: 0.75 }}>
{onUncoveredTab
                ? `${T("sheet_mapping_covers", "Mapping covers")} ${coverage} · ${T("sheet_mapping_standard_render", "this tab uses standard render")}`
                : `${T("mapping_active")} · ${coverage}`}
            </p>
            <p className="text-sm font-black truncate" style={{ color: onUncoveredTab ? "#7c2d12" : "#064e3b" }}>
              {activeMapping.name} <span className="font-bold opacity-50">· {activeMapping.standard ?? "Custom"} · {activeMapping.kind === "report" ? "Report" : "Structure"}</span>
            </p>
          </div>
<button
            onClick={() => {
              try {
                sessionStorage.setItem("mappings:openForEdit", JSON.stringify({
                  mapping_id: activeMapping.mapping_id,
                  kind: activeMapping.kind ?? "structure",
                }));
              } catch { /* ignore quota errors */ }
              if (typeof onNavigate === "function") {
                onNavigate("mappings");
} else {
                window.location.hash = "#/mappings";
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "white", color: "#047857", border: "1px solid rgba(16,185,129,0.2)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f0fdf4"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; }}>
<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            {T("btn_edit")}
          </button>
          <button
            onClick={clearActiveMapping}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "rgba(207,48,93,0.08)", color: "#CF305D", border: "1px solid rgba(207,48,93,0.15)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(207,48,93,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(207,48,93,0.08)"; }}>
<X size={10} strokeWidth={3} />
            {T("btn_clear")}
          </button>
        </div>
        );
      })()}

{viewsMode === "landing" && (
<MappingsLanding
          colors={colors}
          T={T}
          onPickStructure={() => setViewsMode("structure")}
          onPickReport={() => setViewsMode("report")}
        />
      )}
{(viewsMode === "structure" || viewsMode === "report") && (
<MappingsLibrary
          colors={colors}
          T={T}
          kind={viewsMode}
          activeMapping={activeMapping}
          mappings={savedMappings}
          loading={mappingsLoading}
          error={mappingsError}
          onApply={(m) => handleApplyFromCard(m, viewsMode)}
          onClearActive={clearActiveMapping}
          onRetry={() => {
            const m = viewsMode;
            setViewsMode("landing");
            setTimeout(() => setViewsMode(m), 50);
          }}
        />
      )}

{cmpVisible && !viewsMode && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0"
         style={{ overflow: "hidden", animation: cmpExiting ? "cmpBarOut 350ms ease both" : "cmpBarIn 400ms ease both" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("btn_compare_with")}</span>
          </div>
<HeaderFilterPill label={T("filter_source")}    value={cmpSource}    onChange={setCmpSource}
            options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          <HeaderFilterPill label={T("filter_year")}      value={cmpYear}      onChange={setCmpYear}
            options={availableYears} />
          <HeaderFilterPill label={T("filter_month")}     value={cmpMonth}     onChange={setCmpMonth}
            options={availableMonths} />
          <HeaderFilterPill label={T("filter_structure")} value={cmpStructure} onChange={setCmpStructure}
            options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))} />
          {cmpLoading && <div className="w-4 h-4 border-2 border-[#1a2f8a] border-t-transparent rounded-full animate-spin ml-2" />}
        </div>
      )}

{/* ── Accounts view (hidden when in mappings views) ── */}
{!viewsMode && (
<div className="flex-1 min-h-0 flex flex-col">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 flex flex-col" style={{ overflow: "hidden" }}>
{!metaReady || loading || probingPeriod ? (
             <SheetLoadingSpinner key="sheet-spinner" colors={colors} metaReady={metaReady} probingPeriod={probingPeriod} T={T} />
            ) : rawData.length === 0 ? (
              <div className="flex items-center justify-center flex-1 p-8">
                <div className="relative max-w-md w-full text-center"
                  style={{ animation: "sheetEmptyIn 500ms cubic-bezier(0.34,1.56,0.64,1)" }}>

                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                    <div className="absolute" style={{
                      width: 180, height: 180, top: -40, right: -40,
                      background: `radial-gradient(circle, ${colors.primary}12 0%, transparent 70%)`,
                      animation: "sheetOrb1 8s ease-in-out infinite",
                    }} />
                    <div className="absolute" style={{
                      width: 120, height: 120, bottom: -20, left: -20,
                      background: "radial-gradient(circle, rgba(207,48,93,0.10) 0%, transparent 70%)",
                      animation: "sheetOrb2 11s ease-in-out 2s infinite",
                    }} />
                  </div>

                  <div className="relative z-10 p-10 rounded-3xl"
                    style={{
                      background: "linear-gradient(135deg, #ffffff 0%, #fafbff 100%)",
                      border: "1px solid rgba(26,47,138,0.06)",
                      boxShadow: "0 20px 60px -12px rgba(26,47,138,0.08)",
                    }}>

                    <div className="relative mx-auto mb-6" style={{ width: 88, height: 88 }}>
                      <svg width="88" height="88" viewBox="0 0 88 88" className="absolute inset-0">
                        <circle cx="44" cy="44" r="40" fill="none"
                          stroke={`${colors.primary}15`} strokeWidth="1.5"
                          strokeDasharray="4 6"
                          style={{ transformOrigin: "44px 44px", animation: "sheetSpin 20s linear infinite" }} />
                        <circle cx="44" cy="44" r="28" fill="none"
                          stroke={`${colors.primary}25`} strokeWidth="1.5"
                          strokeDasharray="3 5"
                          style={{ transformOrigin: "44px 44px", animation: "sheetSpinR 14s linear infinite" }} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                          style={{
                            background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                            boxShadow: `0 8px 24px -6px ${colors.primary}50, inset 0 1px 0 rgba(255,255,255,0.2)`,
                          }}>
                          <Layers size={20} className="text-white" strokeWidth={2.2} />
                        </div>
                      </div>
                    </div>

<p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
                      style={{ color: colors.primary, opacity: 0.6 }}>
                      {T("contrib_empty_kicker")}
                    </p>

                    <h3 className="font-black text-xl text-gray-800 mb-3 tracking-tight"
                      style={{ letterSpacing: "-0.02em" }}>
                      {T("contrib_empty_title")}
                    </h3>

                    <p className="text-sm text-gray-500 leading-relaxed mb-6">
                      {T("contrib_empty_desc")}
                    </p>

                    <div className="flex flex-col gap-2 mb-6">
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                        style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: `${colors.primary}15`, color: colors.primary }}>
                          <Filter size={13} strokeWidth={2.4} />
                        </div>
                        <div className="flex-1 min-w-0">
<p className="text-xs font-bold text-gray-700">
                            {T("contrib_empty_tip1_title")}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {T("contrib_empty_tip1_desc")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                        style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: `${colors.primary}15`, color: colors.primary }}>
                          <RefreshCw size={13} strokeWidth={2.4} />
                        </div>
                        <div className="flex-1 min-w-0">
<p className="text-xs font-bold text-gray-700">
                            {T("contrib_empty_tip2_title")}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {T("contrib_empty_tip2_desc")}
                          </p>
                        </div>
                      </div>

                      {topParent !== rootParent && (
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                          style={{ background: "rgba(207,48,93,0.05)", border: "1px solid rgba(207,48,93,0.10)" }}>
                          <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: "rgba(207,48,93,0.12)", color: "#CF305D" }}>
                            <X size={13} strokeWidth={2.4} />
                          </div>
                          <div className="flex-1 min-w-0">
<p className="text-xs font-bold text-gray-700">
                              {T("sheet_empty_root_title", "Return to root perspective")}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {T("sheet_empty_root_desc", "Select the main holding in the Perspective filter")}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
<button
                      onClick={() => {
                        autoPeriodDone.current = false;
                        setProbingPeriod(true);
                        // Bump deps to retrigger the probe effect
                        setStructure(s => s);
                      }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                      style={{
                        background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                        color: "white",
                        boxShadow: `0 6px 16px -4px ${colors.primary}40`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
<RefreshCw size={12} strokeWidth={2.6} />
                      {T("contrib_empty_retry")}
                    </button>
                  </div>
                </div>
              </div>
) : (
<div className="consolidation-scroll-outer flex-1 min-h-0" style={{ minWidth: 0 }}>
              <div className="consolidation-scroll" style={{ minWidth: 0 }}>
                <table className="text-xs border-collapse" style={{ borderSpacing: 0, width: "max-content", minWidth: "100%", tableLayout: "auto" }}>
<thead className="sticky top-0 z-30" style={{ background: "#ffffff" }}>
  <tr style={{ background: "#ffffff", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>

    {/* Account sticky left */}
<th className="sticky left-0 z-40 text-left px-6 border-r border-gray-100"
      style={{ background: "#ffffff", height: 64, minWidth: 340, width: 340 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{T("col_account")}</span>
          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>{T("nav_sheet")}</span>
        </div>
{(() => {
          const anyExpanded = expanded.size > 0;
          return (
            <button
              onClick={() => anyExpanded ? setExpanded(new Set()) : setExpanded(new Set([...accountMap.keys()]))}
              title={anyExpanded ? T("btn_collapse_all") : T("btn_expand_all")}
              className="flex items-center justify-center w-8 h-8 rounded-lg relative overflow-hidden"
              style={{
                color: anyExpanded ? colors.primary : "#94a3b8",
                background: "transparent",
                transition: "color 240ms cubic-bezier(0.4,0,0.2,1)",
              }}>
              <span key={anyExpanded ? "collapse" : "expand"}
                className="absolute inset-0 flex items-center justify-center"
                style={{ animation: "sheetIconMorph 360ms cubic-bezier(0.34,1.56,0.64,1)" }}>
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
    </th>

{/* Consolidated total */}
    <th className="text-center px-4 border-l border-gray-100" style={{ background: "#ffffff", minWidth: 130 }}>
      <div className="flex flex-col items-center gap-0.5 py-4">
        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>{getLegal(topParent)}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{isRootView ? T("col_consolidated") : T("sheet_subgroup", "Subgroup")}</span>
      </div>
    </th>
{cmpColsVisible && <>
      <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
      </th>
    </>}

{/* Eliminations */}
<th className="text-center px-4 cursor-pointer select-none sheet-area-start sheet-area-elim"
      style={{ minWidth: 110 }}
      onClick={() => setElimExpanded(e => !e)}>
      <div className="flex flex-col items-center gap-0.5 py-4">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>
          {T("sheet_elim", "Elim.")} {elimExpanded ? "▾" : "▸"}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{T("sheet_interco", "Interco")}</span>
      </div>
    </th>
{cmpColsVisible && <>
      <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
      </th>
    </>}
{elimColsVisible && elimHeaders.map((h, hi) => (
      <th key={`elim-head-${h}`} className="text-center px-3"
        style={{
          background: "#f8f9ff",
          borderLeft: "1px solid #e5e7eb",
          minWidth: 140,
          animation: `${elimColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) ${hi * 40}ms both`,
          transformOrigin: "left center",
        }}>
        <div className="flex flex-col items-center gap-0.5 py-4">
          <span className="font-black" style={{ color: colors.primary, fontSize: 11 }} title={h}>{h}</span>
        </div>
      </th>
    ))}

{/* Contribution sum */}
    <th className="text-center px-4 sheet-area-start sheet-area-contrib" style={{ minWidth: 110 }}>
      <div className="flex flex-col items-center gap-0.5 py-4">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>{T("contrib_label")}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{T("sheet_sum", "Sum")}</span>
      </div>
    </th>
{cmpColsVisible && <>
      <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
      </th>
    </>}

    {/* Per-company columns */}
{effectiveCompanies.map((c, ci) => {
      const isDragging = draggingCol === c;
      const isDragOver = dragOverCol === c && draggingCol !== c;
      const isFirstCompany = ci === 0;
      return (
        <th key={c}
          draggable
          onDragStart={() => setDraggingCol(c)}
          onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
          onDragLeave={() => { if (dragOverCol === c) setDragOverCol(null); }}
          onDrop={e => {
            e.preventDefault();
            if (!draggingCol || draggingCol === c) { setDraggingCol(null); setDragOverCol(null); return; }
            const cols = colOrder.length > 0 ? [...colOrder] : [...effectiveCompanies];
            const from = cols.indexOf(draggingCol);
            const to = cols.indexOf(c);
            if (from === -1 || to === -1) { setDraggingCol(null); setDragOverCol(null); return; }
            const next = [...cols];
            next.splice(from, 1);
            next.splice(to, 0, draggingCol);
            setColOrder(next);
            setDraggingCol(null);
            setDragOverCol(null);
          }}
          onDragEnd={() => { setDraggingCol(null); setDragOverCol(null); }}
className={`text-center px-3 select-none cursor-grab sheet-area-cos ${isFirstCompany ? "sheet-area-start" : ""}`}
          style={{
            background: isDragOver ? `${colors.primary}15` : undefined,
            borderLeft: isFirstCompany ? undefined : "1px solid #f0f0f0",
            minWidth: 140,
            opacity: isDragging ? 0.4 : 1,
            outline: isDragOver ? `2px solid ${colors.primary}` : "none",
            transition: "background 150ms ease, outline 150ms ease",
          }}>
          <div className="flex flex-col items-center gap-0.5 py-4">
            <span className="font-black tracking-tight truncate max-w-[120px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} title={getLegal(c)}>{getLegal(c)}</span>
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{displayCurrency}</span>
          </div>
        </th>
      );
    })}
{cmpColsVisible && effectiveCompanies.map(c => (
      <React.Fragment key={`${c}-cmp-headers`}>
        <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
        </th>
        <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
        </th>
        <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
        </th>
      </React.Fragment>
    ))}
  </tr>
</thead>
<tbody>
{tree.map((node, i) => {
  const type = node.AccountType ?? "";
  const prevType = i > 0 ? (tree[i-1].AccountType ?? "") : null;
  const typeChanged = type !== prevType;
  const TYPE_LABEL_COLORS = {
    "P/L": colors.primary,
    "DIS": colors.primary,
    "B/S": "#CF305D",
    "C/F": "#374151",
    "CFS": "#374151",
  };
const TYPE_LABELS_LOCAL = {
    "P/L": { label: T("export_section_pl") },
    "DIS": { label: T("contrib_dist_result") },
    "B/S": { label: T("export_section_bs") },
    "C/F": { label: T("nav_cashflow") },
    "CFS": { label: T("nav_cashflow") },
  };
  const TYPE_LABELS = TYPE_LABELS_LOCAL[type]
    ? { ...TYPE_LABELS_LOCAL, [type]: { ...TYPE_LABELS_LOCAL[type], color: TYPE_LABEL_COLORS[type] } }
    : TYPE_LABELS_LOCAL;
// When a mapping is active, ONLY use mapping-defined breakers. Type-change
  // dividers (Profit & Loss / Distribution of Result / Balance Sheet) are
  // standard-render fallbacks — they should NOT appear when the mapping
  // owns the structure, since the mapping might intentionally put DIS codes
  // somewhere other than "Distribution of Result".
const effectiveBreakers = mappingBreakersOverride ?? mappingDerived?.breakers ?? breakers;
  const mappingBreaker = effectiveBreakers[node.AccountCode] ?? null;
  const breaker = mappingDerived
    ? mappingBreaker
    : (mappingBreaker || (typeChanged && TYPE_LABELS[type] ? TYPE_LABELS[type] : null));
const totalCols = 1 // account col
    + 1 + (compareMode ? 3 : 0) // consolidated
    + 1 + (compareMode ? 3 : 0) // eliminations
    + (elimExpanded ? elimHeaders.length : 0) // elim sub-cols
    + 1 + (compareMode ? 3 : 0) // contribution sum
    + effectiveCompanies.length * (compareMode ? 4 : 1); // per-company
  return (
    <React.Fragment key={node.AccountCode}>
      {breaker && (
        <tr>
          <td className="sticky left-0 z-10 px-5 py-1.5"
            style={{ backgroundColor: breaker.color }}>
            <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "#fff", opacity: 0.92 }}>
              {breaker.label}
            </span>
          </td>
          <td colSpan={totalCols - 1} style={{ backgroundColor: breaker.color, minWidth: 0 }} />
        </tr>
      )}
<SheetRow node={node} depth={0}
        rowIndex={i}
        expanded={expanded} onToggle={toggleExpand}
        pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
        contributionCompanies={effectiveCompanies}
        topParent={topParent}
        elimExpanded={elimColsVisible} elimHeaders={elimHeaders}
        elimColsExiting={elimColsExiting}
        compareMode={cmpColsVisible} cmpPivot={cmpPivot}
        body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
        colors={colors} cmpColsExiting={cmpColsExiting} cmpColsVisible={cmpColsVisible} />
    </React.Fragment>
  );
})}
</tbody>
                </table>
              </div>
              </div>
)}
          </div>
</div>
)}
{/* ── Export modal ──────────────────────────────────────────────── */}
      {exportModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            animation: "kBadgesPop 280ms cubic-bezier(0.34,1.56,0.64,1)",
          }}
          onClick={() => setExportModal(false)}>
          <div className="bg-white w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{
              borderRadius: 28,
              boxShadow: `0 30px 80px -12px ${colors.primary}40, 0 12px 24px -6px rgba(0,0,0,0.12)`,
              animation: "plRowSlideIn 340ms cubic-bezier(0.34,1.56,0.64,1)",
            }}>

            {/* Header */}
            <div className="relative px-7 pt-7 pb-5 flex-shrink-0 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)`,
                    boxShadow: `0 8px 20px -6px ${colors.primary}60`,
                  }}>
                  <Download size={17} strokeWidth={2.5} color="white" />
                </div>
                <div>
<h2 className="font-black" style={{ color: colors.primary, fontSize: 20, letterSpacing: "-0.02em" }}>
                    {T("export_report")}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-1.5">
<span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                      style={{ background: `${colors.primary}10`, color: colors.primary }}>
                      {exportOpts.format === "pdf" ? T("badge_pdf") : T("badge_excel")}
                    </span>
                    {compareMode && (
                      <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                        style={{ background: "#CF305D15", color: "#CF305D" }}>
                        {T("badge_compare")}
                      </span>
                    )}
                    {activeMapping && (
                      <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                        style={{ background: "#10b98115", color: "#059669" }}>
                        {T("badge_mapped")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => setExportModal(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-[1.05]"
                style={{ background: "#f3f4f6", color: "#6b7280" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#e5e7eb"; e.currentTarget.style.color = "#111827"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.color = "#6b7280"; }}>
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-6" style={{ scrollbarWidth: "none" }}>
              {/* Primary period */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_primary_period")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="flex gap-3 p-3 rounded-2xl border"
                  style={{ borderColor: `${colors.primary}25`, background: `linear-gradient(135deg, ${colors.primary}08 0%, ${colors.primary}03 100%)` }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-black"
                    style={{ background: colors.primary, boxShadow: `0 4px 12px -2px ${colors.primary}50` }}>A</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: colors.primary }}>{T("period_a")}</span>
                      <span className="text-xs font-bold text-gray-700">
                        {T(`month_${Number(month)}`)} {year}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {[source, structure, getLegal(topParent), displayCurrency].filter(Boolean).map((tag, i) => (
                        <span key={i} className="text-[10px] font-semibold text-gray-600 px-2 py-0.5 rounded-md bg-white/60 border border-gray-100">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Compare period */}
              {compareMode && cmpYear && cmpMonth && (
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("btn_compare_with")}</p>
                    <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                  </div>
                  <div className="flex gap-3 p-3 rounded-2xl border"
                    style={{ borderColor: "#CF305D25", background: "linear-gradient(135deg, #CF305D08 0%, #CF305D03 100%)" }}>
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-black"
                      style={{ background: "#CF305D", boxShadow: "0 4px 12px -2px #CF305D50" }}>B</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                       <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("period_b")}</span>
                        <span className="text-xs font-bold text-gray-700">
                         {T(`month_${Number(cmpMonth)}`)} {cmpYear}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {[cmpSource, cmpStructure].filter(Boolean).map((tag, i) => (
                          <span key={i} className="text-[10px] font-semibold text-gray-600 px-2 py-0.5 rounded-md bg-white/60 border border-gray-100">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sheets to include */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_statements_to_include")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
{ key: "sheetAll", label: T("all"), accent: colors.primary },
                    { key: "sheetPL",  label: T("export_section_pl"), accent: colors.primary },
                    { key: "sheetBS",  label: T("export_section_bs"), accent: "#CF305D" },
                  ].map(opt => {
                    const checked = !!exportOpts[opt.key];
                    return (
                      <label key={opt.key}
                        className="flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${opt.accent}40` : "#f3f4f6", background: checked ? `${opt.accent}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [opt.key]: !o[opt.key] }))}>
                        <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? opt.accent : "transparent", borderColor: checked ? opt.accent : "#d1d5db" }}>
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 8 8">
                              <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xs font-bold text-gray-700">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Options */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                 <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_layout_options")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
{ key: "drillDown",  label: T("export_opt_drilldown") },
                    { key: "elimDetail", label: T("sheet_opt_elim_breakdown", "Elim. breakdown") },
                  ].map(opt => {
                    const checked = !!exportOpts[opt.key];
                    return (
                      <label key={opt.key}
                        className="flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${colors.primary}40` : "#f3f4f6", background: checked ? `${colors.primary}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [opt.key]: !o[opt.key] }))}>
                        <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? colors.primary : "transparent", borderColor: checked ? colors.primary : "#d1d5db" }}>
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 8 8">
                              <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xs font-bold text-gray-700">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-7 py-5 flex items-center gap-3 flex-shrink-0"
              style={{ background: "linear-gradient(180deg, transparent 0%, #f9fafb 100%)" }}>
              <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}>
               {[["xlsx", T("export_excel")], ["pdf", T("export_pdf")]].map(([f, l]) => (
                  <button key={f} onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                    className="relative z-10 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors duration-200"
                    style={{
                      background: exportOpts.format === f ? "white" : "transparent",
                      color: exportOpts.format === f ? colors.primary : "#9ca3af",
                      boxShadow: exportOpts.format === f ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              <button
                onClick={async () => {
                  const views = [];
                  if (exportOpts.sheetAll) views.push("all");
                  if (exportOpts.sheetPL)  views.push("pl");
                  if (exportOpts.sheetBS)  views.push("bs");
                 if (views.length === 0) { alert(T("sheet_pick_one_alert", "Pick at least one sheet.")); return; }

try {
const monthLabel = T(`month_${Number(month)}`, String(month));
                    const cmpMoLabel = T(`month_${Number(cmpMonth)}`, String(cmpMonth));
                    const sharedArgs = {
                      pivot, elimPivot, elimHeaders,
                      effectiveCompanies, topParent, rootParent,
                      getLegal, isRootView, displayCurrency,
                      source, structure, year, month, monthLabel,
                      compareMode: cmpColsVisible, cmpPivot, cmpYear, cmpMonth, cmpMoLabel,
                      activeMapping,
                      mappingDerivedAll: null,
                      mappingDerivedPL:  exportTrees.derivedPL,
                      mappingDerivedBS:  exportTrees.derivedBS,
                      treeAll: exportTrees.all,
                      treePL:  exportTrees.pl,
                      treeBS:  exportTrees.bs,
                      colors,
                      perspectiveLegal: getLegal(topParent),
                      views,
                      drillDown:  !!exportOpts.drillDown,
                      elimDetail: !!exportOpts.elimDetail,
                    };
                    if (exportOpts.format === "pdf") {
                      await generateSheetPdf(sharedArgs);
                    } else {
                      await generateSheetXlsxMulti({ ...sharedArgs, rawData });
                    }
                    setExportModal(false);
} catch {
                    alert(T("export_failed_alert", "Export failed"));
                  }
                }}
                className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03]"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 100%)`,
                  color: "white",
                  boxShadow: `0 8px 20px -6px ${colors.primary}80, 0 2px 6px -2px ${colors.primary}40`,
                }}>
<Download size={13} strokeWidth={2.5} />
                {T("btn_download")}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
  );
}