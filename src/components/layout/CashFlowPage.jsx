/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, Maximize2, Minimize2, GitMerge } from "lucide-react";
import { useTypo, useSettings } from "./SettingsContext";

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

const parseAmt = (val) => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

/* ─── FilterPill ────────────────────────────────────────────────────────── */
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

/* ─── MultiSelectPill ──────────────────────────────────────────────────── */
function MsCheckbox({ checked, indeterminate, color }) {
  return (
    <span
      className="flex-shrink-0 w-4 h-4 rounded-md border flex items-center justify-center transition-all"
      style={{
        backgroundColor: checked || indeterminate ? color : "#fff",
        borderColor: checked || indeterminate ? color : "#d4d4d8",
      }}>
      {checked && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {indeterminate && !checked && (
        <span className="w-2 h-0.5 rounded bg-white" />
      )}
    </span>
  );
}

function MultiSelectPill({ label, values, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const allSelected = !values || values.length === options.length;
  const display = allSelected
    ? `All (${options.length})`
    : values.length === 0
      ? "None"
      : values.length === 1
        ? options.find(o => o.value === values[0])?.label ?? "1 selected"
        : `${values.length} selected`;
  const toggle = (v) => {
    const current = values || options.map(o => o.value);
    const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v];
    onChange(next.length === options.length ? null : next);
  };
  const someSelected = values && values.length > 0 && values.length < options.length;
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
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[220px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            <button onClick={() => onChange(allSelected ? [] : null)}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-3 text-[#1a2f8a] hover:bg-[#eef1fb] border-b border-gray-100 mb-1">
              <MsCheckbox checked={allSelected} indeterminate={someSelected} color={colors?.primary} />
              <span>{allSelected ? "Deselect all" : "Select all"}</span>
            </button>
            {options.map(o => {
              const selected = (values ?? options.map(x => x.value)).includes(o.value);
              return (
                <button key={o.value} onClick={() => toggle(o.value)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-3 text-gray-700 hover:bg-[#eef1fb] hover:text-[#1a2f8a]">
                  <MsCheckbox checked={selected} color={colors?.primary} />
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TabSelector({ tabs, activeKey, onSelect, filterStyle }) {
  const containerRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const activeIdx = Math.max(0, tabs.findIndex(t => t.key === activeKey));
  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll("button");
    const active = buttons[activeIdx];
    if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
  }, [activeIdx, tabs.length]);
  return (
    <div ref={containerRef} className="relative flex items-center gap-1 p-1 bg-[#e6e6e6] rounded-2xl flex-shrink-0 shadow-xl">
      <div className="absolute top-1 bottom-1 bg-white shadow-sm rounded-2xl transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }} />
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onSelect(t.key)}
          className="relative z-10 px-3 py-2 rounded-2xl transition-all"
          style={filterStyle}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── CF tree ───────────────────────────────────────────────────────────── */
function cfSort(a, b) {
  const cA = a.AccountCode || "", cB = b.AccountCode || "";
  const stripA = cA.replace(/^CF\.?/, "");
  const stripB = cB.replace(/^CF\.?/, "");
  const baseA = stripA.replace(/s$/, ""), baseB = stripB.replace(/s$/, "");
  if (baseA === baseB) {
    const sA = /s$/.test(stripA), sB = /s$/.test(stripB);
    if (sA && !sB) return 1;
    if (!sA && sB) return -1;
    return 0;
  }
  const pA = baseA.split("."), pB = baseB.split(".");
  for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
    const a = pA[i] ?? "", b = pB[i] ?? "";
    if (a === b) continue;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "es", { sensitivity: "base" });
  }
  return 0;
}

function buildTree(accounts, sortFn = cfSort) {
  const sorted = [...accounts].sort(sortFn);
  const map = new Map();
  sorted.forEach(a => map.set(a.AccountCode, { ...a, children: [] }));
  const roots = [];
  sorted.forEach(a => {
    const sumCode = a.SumAccountCode || "";
    const parent = sumCode ? map.get(sumCode) : null;
    if (parent && parent.AccountCode !== a.AccountCode) {
      parent.children.push(map.get(a.AccountCode));
    } else {
      roots.push(map.get(a.AccountCode));
    }
  });
  return roots;
}

/* ─── SheetRow ──────────────────────────────────────────────────────────── */
function SheetRow({
  node, depth, expanded, onToggle,
  pivot, elimPivot,
  contributionCompanies, topParent,
  elimExpanded, elimHeaders,
  compareMode, cmpPivot,
  body1Style, body2Style, subbody1Style,
  mode,
}) {
  const hasChildren = node.children?.length > 0;
  const isExpanded  = expanded.has(node.AccountCode);

const rowStyle = depth === 0 ? body1Style : (!hasChildren ? subbody1Style : body2Style);
  const cellStyle = (v) => {
    const baseColor = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
    return { ...rowStyle, color: baseColor };
  };

  const byCompany = pivot.get(node.AccountCode) || {};

  const getContrib = (company) => {
    if (mode === "consolidated") {
      const role = company === topParent ? "Parent" : "Contribution";
      return (byCompany[company] ?? [])
        .filter(r => r.CompanyRole === role)
        .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
    }
    return (byCompany[company] ?? [])
      .reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0);
  };

  const contribSum = contributionCompanies.reduce((s, c) => s + getContrib(c), 0);

  let consTotal;
  if (mode === "consolidated") {
    consTotal = (byCompany[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
  } else {
    consTotal = contribSum;
  }

  const elimTotal = mode === "consolidated" ? consTotal - contribSum : 0;

  const cmpByCompany = cmpPivot?.get(node.AccountCode) || {};
  const cmpGetContrib = (company) => {
    if (mode === "consolidated") {
      const role = company === topParent ? "Parent" : "Contribution";
      return (cmpByCompany[company] ?? [])
        .filter(r => r.CompanyRole === role)
        .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
    }
    return (cmpByCompany[company] ?? [])
      .reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0);
  };
  const cmpContribSum = contributionCompanies.reduce((s, c) => s + cmpGetContrib(c), 0);
  const cmpConsTotal = mode === "consolidated"
    ? (cmpByCompany[topParent] ?? [])
        .filter(r => r.CompanyRole === "Group")
        .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
        .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0)
    : cmpContribSum;
  const cmpElimTotal = mode === "consolidated" ? cmpConsTotal - cmpContribSum : 0;

  const renderCompareCells = (current, compare, key) => {
    const delta = current - compare;
    const pct = compare !== 0 ? (delta / Math.abs(compare)) * 100 : null;
    const baseColor = compare === 0 ? "#D1D5DB" : compare < 0 ? "#EF4444" : "#000000";
    const deltaColor = delta === 0 ? "#D1D5DB" : delta < 0 ? "#EF4444" : "#10B981";
    return [
      <td key={`${key}-cmp`}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 110, backgroundColor: "#fafafa", borderLeft: "1px solid #e5e7eb", ...rowStyle, color: baseColor }}>
        {fmt(compare)}
      </td>,
      <td key={`${key}-delta`}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 130, backgroundColor: "#fafafa", borderRight: "1px solid #e5e7eb", ...rowStyle, color: deltaColor }}>
        {delta === 0 ? "—" : (
          <span className="flex flex-col items-center gap-0.5 leading-tight">
            <span>{(delta > 0 ? "+" : "") + fmt(delta)}</span>
            {pct !== null && (
              <span className="text-[9px] opacity-70">{(pct > 0 ? "+" : "") + pct.toFixed(1) + "%"}</span>
            )}
          </span>
        )}
      </td>,
    ];
  };

  return (
    <>
      <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/50">
        <td className="sticky left-0 z-10 py-2.5 pr-4 border-r border-gray-100 bg-white group-hover:bg-gray-50/50"
          style={{ paddingLeft: `${14 + depth * 16}px`, minWidth: 220, width: 220 }}>
          <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => hasChildren && onToggle(node.AccountCode)}>
            {hasChildren
              ? <span className={`text-[#1a2f8a] flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}>
                  <ChevronRight size={11} />
                </span>
              : <span className="w-3 flex-shrink-0" />}
            <span className="flex-shrink-0 mr-2" style={rowStyle}>{node.AccountCode}</span>
            <span className="truncate" style={{ ...rowStyle, maxWidth: 260 }}>{node.AccountName}</span>
          </div>
        </td>

{mode === "consolidated" && (
          <>
            <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
              style={{ minWidth: 130, ...cellStyle(consTotal) }}>
              {fmt(consTotal)}
            </td>
            {compareMode && renderCompareCells(consTotal, cmpConsTotal, "cons")}
          </>
        )}

        {mode === "consolidated" && (
          <>
            <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
              style={{ minWidth: 110, ...cellStyle(elimTotal) }}>
              {fmt(elimTotal)}
            </td>
            {compareMode && renderCompareCells(elimTotal, cmpElimTotal, "elim")}

            {elimExpanded && elimHeaders.map((h) => {
              const subVal = (elimPivot.get(node.AccountCode) ?? {})[h] ?? 0;
              return (
                <td key={`elim-${h}`}
                  className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
                  style={{ minWidth: 140, backgroundColor: "#f8f9ff", ...cellStyle(subVal) }}>
                  {fmt(subVal)}
                </td>
              );
            })}
          </>
        )}

{mode === "consolidated" && (
          <>
            <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200"
              style={{ minWidth: 110, ...cellStyle(contribSum) }}>
              {fmt(contribSum)}
            </td>
            {compareMode && renderCompareCells(contribSum, cmpContribSum, "contribsum")}
          </>
        )}

{contributionCompanies.flatMap(c => {
  const val = getContrib(c);
  const cmpVal = cmpGetContrib(c);
const magnitudeTotal = contributionCompanies.reduce(
  (s, co) => s + Math.abs(getContrib(co)),
  0
);
const showPct = mode === "consolidated" && magnitudeTotal !== 0 && val !== 0;
const pct = showPct ? (val / magnitudeTotal) * 100 : null;
  return [
    <td key={c}
      className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
      style={{ minWidth: 120, ...cellStyle(val) }}>
{showPct ? (
        <span className="inline-flex items-baseline gap-2">
          <span>{fmt(val)}</span>
          <span className="opacity-80" style={body2Style}>({pct.toFixed(1)}%)</span>
        </span>
      ) : (
        fmt(val)
      )}
    </td>,
    ...(compareMode ? renderCompareCells(val, cmpVal, `contrib-${c}`) : []),
  ];
})}
      </tr>

      {isExpanded && hasChildren && node.children.map(child => (
        <SheetRow key={child.AccountCode} node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          pivot={pivot} elimPivot={elimPivot}
          contributionCompanies={contributionCompanies}
          topParent={topParent}
          elimExpanded={elimExpanded} elimHeaders={elimHeaders}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
          mode={mode} />
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */
export default function CashFlowPage({ token }) {
  const header1Style = useTypo("header1");
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const subbody1Style = useTypo("subbody1");
  const underscore1Style = useTypo("underscore1");
  const underscore2Style = useTypo("underscore2");
  const filterStyle = useTypo("filter");
  const { colors } = useSettings();

const [periods,        setPeriods]        = useState([]);
  const [sources,        setSources]        = useState([]);
  const [structures,     setStructures]     = useState([]);
  const [companies,      setCompanies]      = useState([]);
  const [consolidations, setConsolidations] = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);
const [cfMapping,      setCfMapping]      = useState([]);
  const [mappedAccounts, setMappedAccounts] = useState([]);
  // CF account name dictionary — populated from consolidated-accounts the
  // first time we have any CF data, and reused across modes / periods.
  const [cfNameDict, setCfNameDict] = useState({});
  // Supabase mappings per accounting standard (loaded once cfMapping is ready)
  const [pgcCfMapping,           setPgcCfMapping]           = useState(null);
  const [danishIfrsCfMapping,    setDanishIfrsCfMapping]    = useState(null);
  const [spanishIfrsEsCfMapping, setSpanishIfrsEsCfMapping] = useState(null);

const [mode,               setMode]               = useState("consolidated");
// Tracks whether we're in Individual mode by user choice or by auto-fallback
  // (consolidated returned 0 CF rows). Affects the warning banner + badge.
  const [syntheticCf,        setSyntheticCf]        = useState(false);
  // One-time popup shown when auto-fallback fires for the first time
  const [showSyntheticModal, setShowSyntheticModal] = useState(false);
  const syntheticShownRef = useRef(false);
  const [year,               setYear]               = useState("");
  const [month,              setMonth]              = useState("");
  const [source,             setSource]             = useState("");
  const [structure,          setStructure]          = useState("DefaultStructure");
const [perspectiveCompany, setPerspectiveCompany] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState(null); // null = all selected

  const [rawData,      setRawData]      = useState([]);
  const [uploadedData, setUploadedData] = useState([]);
  const [journalData,  setJournalData]  = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [metaReady,    setMetaReady]    = useState(false);
  const [expanded,     setExpanded]     = useState(new Set());
  const [elimExpanded, setElimExpanded] = useState(false);

  const [compareMode,  setCompareMode]  = useState(false);
  const [cmpYear,      setCmpYear]      = useState("");
  const [cmpMonth,     setCmpMonth]     = useState("");
  const [cmpSource,    setCmpSource]    = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
  const [cmpRawData,   setCmpRawData]   = useState([]);
  const [cmpUploaded,  setCmpUploaded]  = useState([]);
  const [cmpLoading,   setCmpLoading]   = useState(false);

  const autoPeriodDone = useRef(false);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${BASE}/periods`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/sources`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/structures`,               { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/companies`,                { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/consolidations`,           { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/group-structure`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
fetch(`${BASE}/mapped-cashflow-accounts`, { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
      fetch(`${BASE}/mapped-accounts`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
    ]).then(([p, s, st, co, cons, gs, cf, ma]) => {
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      setCfMapping(Array.isArray(cf) ? cf : []);
      setMappedAccounts(Array.isArray(ma) ? ma : []);

      // Auto-select a valid structure: prefer "DefaultStructure" if it exists
      // in this tenant; otherwise the one flagged isDefault; otherwise the first one.
      const structureNames = (st || []).map(x => x.GroupStructure ?? x);
      const defaultFlagged = (st || []).find(x => x.IsDefault === true || x.isDefault === true)
        ?.GroupStructure;
      let chosenStructure;
      if (structureNames.includes("DefaultStructure")) chosenStructure = "DefaultStructure";
      else if (defaultFlagged) chosenStructure = defaultFlagged;
      else if (structureNames.length > 0) chosenStructure = structureNames[0];
      if (chosenStructure) setStructure(chosenStructure);

      const latest = p
        .filter(x => x.Source === "Actual" && x.Closed === true)
        .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0]
        ?? p
        .filter(x => x.Source === "Actual")
        .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0];
if (latest) { setYear(String(latest.Year)); setMonth(String(latest.Month)); setSource("Actual"); }
      setMetaReady(true);

      // ═══ DEBUG: dump CF mapping for this tenant ═══
      const cfRows = Array.isArray(cf) ? cf : [];
      const codesToCheck = ["1200", "1300", "2100", "2200", "2300", "3540", "3550", "3560", "4310", "4320", "4350", "4510", "4520"];
      console.log(`[CF DEBUG] Total CF mapping rows: ${cfRows.length}`);
      codesToCheck.forEach(cfCode => {
        const matches = cfRows.filter(r =>
          String(r.cashFlowAccountCode ?? r.CashFlowAccountCode ?? "") === cfCode
        );
        if (matches.length > 0) {
          console.log(`[CF DEBUG] CF ${cfCode} ←`, matches.map(r => ({
            ga: r.groupAccountCode ?? r.GroupAccountCode,
            name: r.groupAccountName ?? r.GroupAccountName,
            sum: r.cashFlowAccountSumAccountCode ?? r.CashFlowAccountSumAccountCode,
            enabled: r.enabled ?? r.Enabled,
          })));
        } else {
          console.log(`[CF DEBUG] CF ${cfCode} ← (no mappings)`);
        }
      });
      // ═══ END DEBUG ═══
    });
  }, [token]);

// ═══ DEBUG: verify mappedAccounts and uploaded sample ═══
  useEffect(() => {
    if (!mappedAccounts.length) return;
    console.log("[CF DBG] mappedAccounts loaded:", mappedAccounts.length);
    console.log("[CF DBG] sample mappedAccounts row keys:", Object.keys(mappedAccounts[0] || {}));
    console.log("[CF DBG] first 3 mappedAccounts:", mappedAccounts.slice(0, 3));
  }, [mappedAccounts]);

  useEffect(() => {
    if (!uploadedData.length) return;
    console.log("[CF DBG] uploadedData loaded:", uploadedData.length);
    console.log("[CF DBG] sample uploaded row keys:", Object.keys(uploadedData[0] || {}));
    console.log("[CF DBG] first uploaded row:", uploadedData[0]);
    // Pick a row with a depreciation-related code to verify mapping
const depRow = uploadedData.find(r => {
      const c = String(r.AccountCode ?? r.accountCode ?? "");
      return c.startsWith("055");
    });
    console.log("[CF DBG] depreciation row found:", depRow);

    // Look at all rows where AccountCode contains depreciation-related codes
    const depRows = uploadedData.filter(r => {
      const c = String(r.AccountCode ?? r.accountCode ?? "");
      return c === "55130" || c === "55199" || c === "55999" || c.startsWith("55");
    });
    console.log("[CF DBG] rows with AccountCode 55*:", depRows.length);
    depRows.slice(0, 10).forEach(r => {
      console.log(`  - AccountCode=${r.AccountCode} LocalAccountCode=${r.LocalAccountCode} AmountYTD=${r.AmountYTD}`);
    });

    // Check what unique AccountCodes look like in this dataset
    const uniqueCodes = [...new Set(uploadedData.map(r => r.AccountCode))].sort();
    console.log("[CF DBG] all unique AccountCodes (first 30):", uniqueCodes.slice(0, 30));
    console.log("[CF DBG] total unique AccountCodes:", uniqueCodes.length);
  }, [uploadedData]);
  // ═══ END DEBUG ═══

  /* ─── Detect accounting standard + load CF mapping from Supabase ─── */
  // Detector looks at both the codes AND the SumAccountCode references in the
  // Konsolidator CF mapping endpoint. SumAccountCode references reflect the
  // tenant's actual CF chart (not a generic superset), so they're reliable
  // even when there's no consolidated/individual data populated yet.
  const cfStandard = useMemo(() => {
    const allMappingCodes = cfMapping
      .map(m => String(m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? ""))
      .filter(Boolean);
    const allMappingSums = cfMapping
      .map(m => String(m.cashFlowAccountSumAccountCode ?? m.CashFlowAccountSumAccountCode ?? ""))
      .filter(Boolean);

    // PGC: alphanumeric "CF.X.Y" codes — unmistakable
    if (allMappingCodes.some(c => /^CF\./.test(c))) return "pgc";
    if (allMappingSums.some(c => /^CF\./.test(c)))  return "pgc";

    // Danish IFRS uses 6xxx (discontinuing operations) and 42xx (leases) as
    // parent rollups. Spanish IFRS-ES does NOT — it jumps from 4999 to 5999/7999.
    if (allMappingSums.some(c => /^6\d{3}$/.test(c))) return "danish_ifrs";
    if (allMappingSums.some(c => /^4(21|22)\d$/.test(c))) return "danish_ifrs";

    // Also consult populated data when available (covers edge cases where a
    // tenant's mapping happens to be sparse).
    const populatedCodes = new Set([
      ...rawData.map(r => String(r.AccountCode ?? "")),
      ...Object.keys(cfNameDict),
    ].filter(Boolean));
    if ([...populatedCodes].some(c => /^6\d{3}$/.test(c))) return "danish_ifrs";
    if ([...populatedCodes].some(c => /^4(21|22)\d$/.test(c))) return "danish_ifrs";

    if (allMappingCodes.some(c => /^\d{4}$/.test(c))) return "spanish_ifrs_es";
    return null;
  }, [cfMapping, rawData, cfNameDict]);

  useEffect(() => {
    if (cfStandard !== "pgc") { setPgcCfMapping(null); return; }
    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sb = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };
    Promise.all([
      fetch(`${SUPABASE_URL}/pgc_cf_rows?select=*&order=sort_order.asc`,    { headers: sb }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/pgc_cf_sections?select=*&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
      rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setPgcCfMapping({ rows, sections });
    }).catch(() => setPgcCfMapping(null));
  }, [cfStandard]);

  useEffect(() => {
    if (cfStandard !== "danish_ifrs") { setDanishIfrsCfMapping(null); return; }
    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sb = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };
    Promise.all([
      fetch(`${SUPABASE_URL}/danish_ifrs_cf_rows?select=*&order=sort_order.asc`,    { headers: sb }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/danish_ifrs_cf_sections?select=*&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
      rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setDanishIfrsCfMapping({ rows, sections });
    }).catch(() => setDanishIfrsCfMapping(null));
  }, [cfStandard]);

  useEffect(() => {
    if (cfStandard !== "spanish_ifrs_es") { setSpanishIfrsEsCfMapping(null); return; }
    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sb = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };
    Promise.all([
      fetch(`${SUPABASE_URL}/spanish_ifrs_es_cf_rows?select=*&order=sort_order.asc`,    { headers: sb }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/spanish_ifrs_es_cf_sections?select=*&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
      rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setSpanishIfrsEsCfMapping({ rows, sections });
    }).catch(() => setSpanishIfrsEsCfMapping(null));
  }, [cfStandard]);

  // The active mapping (whichever standard matched)
  const activeCfMapping = pgcCfMapping ?? danishIfrsCfMapping ?? spanishIfrsEsCfMapping;

  useEffect(() => {
    if (autoPeriodDone.current) return;
    if (!token || !source || !structure || !metaReady || !year || !month) return;
    autoPeriodDone.current = true;
    (async () => {
      let probeY = parseInt(year), probeM = parseInt(month);
      for (let i = 0; i < 24; i++) {
        const filter = `Year eq ${probeY} and Month eq ${probeM} and Source eq '${source}' and GroupStructure eq '${structure}'`;
        try {
          const res = await fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const d = await res.json();
          if ((d.value ?? []).length > 0) { setYear(String(probeY)); setMonth(String(probeM)); return; }
        } catch { break; }
        probeM -= 1;
        if (probeM < 1) { probeM = 12; probeY -= 1; }
      }
    })();
  }, [token, metaReady, source, structure, year, month]);

  const { topParent, rootParent, contributionCompanies, holdingOptions, displayCurrency } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.companyShortName ?? g.CompanyShortName ?? "",
      parent:    g.parentShortName  ?? g.ParentShortName  ?? "",
      structure: g.groupStructure   ?? g.GroupStructure   ?? "",
      hasChild:  g.hasChild         ?? g.HasChild         ?? false,
      detached:  g.detached         ?? g.Detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    const root = gsRows.find(g => !g.parent)?.company || "";

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

  // Filtered list shown in Individual mode (multi-select). null = show all.
  const visibleCompanies = useMemo(() => {
    if (mode !== "individual" || !selectedCompanies) return contributionCompanies;
    return contributionCompanies.filter(c => selectedCompanies.includes(c));
  }, [mode, contributionCompanies, selectedCompanies]);

useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure || !topParent) return;
    setLoading(true);
    setRawData([]); setUploadedData([]); setJournalData([]);
    setExpanded(new Set());

    const consFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
    const baseFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;

    if (mode === "consolidated") {
      Promise.all([
        fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(consFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json()).then(d => d.value || []),
        fetch(`${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json()).then(d => d.value || []),
      ]).then(([cons, journals]) => {
        const cfRows = cons.filter(r => {
          const t = r.AccountType ?? r.accountType ?? "";
          return t === "C/F" || t === "CFS";
        });
        console.log(`[CF Cons] perspective=${topParent} total=${cons.length} cf=${cfRows.length}`);

// Auto-fallback: tenants without consolidation module return 0 CF rows.
        // Switch to Individual mode automatically — uploaded-accounts + cfMapping
        // can synthesise the cash flow from uploaded data alone.
        if (cfRows.length === 0 || cons.length === 0) {
          console.log("[CF Cons] no consolidated CF data — auto-switching to Individual mode");
          setSyntheticCf(true);
          if (!syntheticShownRef.current) {
            setShowSyntheticModal(true);
            syntheticShownRef.current = true;
          }
          setMode("individual");
          return; // The useEffect will re-run with mode="individual"
        }
        // Reaching here means we have real consolidated data
        setSyntheticCf(false);
        // Capture names for every CF code we see, accumulated across requests
        setCfNameDict(prev => {
          const next = { ...prev };
          cfRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode;
            const name = r.AccountName ?? r.accountName;
            if (code && name && !next[code]) next[code] = name;
          });
          console.log("[CF NameDict] entries:", Object.keys(next).length, "CF.A2s ->", next["CF.A2s"]);
          return next;
        });
        setRawData(cfRows);
        setJournalData(journals);
        setLoading(false);
      }).catch(() => setLoading(false));
} else {
      // Individual mode: also fetch consolidated-accounts (just for the
      // CF account NAMES — we don't use its amounts). Subtotal codes like
      // CF.A2s / CF.D1s aren't named in /mapped-cashflow-accounts, but
      // they are in /reports/consolidated-accounts.
      Promise.all([
        fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json()).then(d => d.value || []),
        fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(consFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json()).then(d => d.value || []).catch(() => []),
      ]).then(([uploaded, cons]) => {
        const cfRowsForNames = cons.filter(r => {
          const t = r.AccountType ?? r.accountType ?? "";
          return t === "C/F" || t === "CFS";
        });
        console.log(`[CF Ind] uploaded=${uploaded.length}, cf rows for names=${cfRowsForNames.length}`);
        if (cfRowsForNames[0]) {
          console.log("[CF Ind] sample CF row keys:", Object.keys(cfRowsForNames[0]));
        }
        // Populate the shared name dictionary
        setCfNameDict(prev => {
          const next = { ...prev };
          cfRowsForNames.forEach(r => {
            const code = r.AccountCode ?? r.accountCode;
            const name = r.AccountName ?? r.accountName;
            if (code && name && !next[code]) next[code] = name;
          });
          console.log("[CF Ind NameDict] entries:", Object.keys(next).length, "CF.A2s ->", next["CF.A2s"], "CF.D1s ->", next["CF.D1s"]);
          return next;
        });
        setUploadedData(uploaded);
        // Don't overwrite rawData — leave it empty in Individual mode so the
        // tree is built purely from cfAccountMap (which uses cfNameDict).
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [token, metaReady, year, month, source, structure, topParent, mode]);

  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !topParent) return;
    setCmpLoading(true);
    const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}'`;
    const consFilter = `${filter} and GroupShortName eq '${topParent}'`;
    if (mode === "consolidated") {
      fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(consFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => {
          const rows = (d.value || []).filter(r => r.AccountType === "C/F" || r.AccountType === "CFS");
          setCmpRawData(rows); setCmpLoading(false);
        }).catch(() => { setCmpRawData([]); setCmpLoading(false); });
    } else {
      fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => { setCmpUploaded(d.value || []); setCmpLoading(false); })
        .catch(() => { setCmpUploaded([]); setCmpLoading(false); });
    }
  }, [token, compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, topParent, mode]);

  /* ─── Pivots ────────────────────────────────────────────────────────── */

  const consolidatedPivot = useMemo(() => {
    const m = new Map();
    rawData.forEach(r => {
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
      c[r.CompanyShortName].push(r);
    });
    return m;
  }, [rawData]);

  const cmpConsolidatedPivot = useMemo(() => {
    const m = new Map();
    cmpRawData.forEach(r => {
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
      c[r.CompanyShortName].push(r);
    });
    return m;
  }, [cmpRawData]);

// CF account catalogue + virtual subtotals (for individual mode).
  // The mapping endpoint only contains LEAF cash-flow accounts. Subtotal
  // codes (CF.A2s, CF.D1s, CF.E1s, …) only ever appear as the parent
  // reference — never as their own row, so they have no name. Names for
  // those come from `cfNameDict`, which is populated whenever we fetch
  // consolidated-accounts (in either Cons or Ind mode).
const cfAccountMap = useMemo(() => {
    if (!cfMapping.length) return new Map();
    const map = new Map();
    cfMapping.forEach(m => {
      const enabled = m.enabled ?? m.Enabled;
      if (enabled === false) return;
      const code = m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? "";
      const mappingName = m.cashFlowAccountName ?? m.CashFlowAccountName ?? "";
      const sum  = m.cashFlowAccountSumAccountCode ?? m.CashFlowAccountSumAccountCode ?? "";
      if (!code) return;
      if (!map.has(code)) {
        const name = cfNameDict[code] || mappingName || code;
        map.set(code, { AccountCode: code, AccountName: name, SumAccountCode: sum });
      }
    });

    let added = true;
    while (added) {
      added = false;
      for (const node of [...map.values()]) {
        const parent = node.SumAccountCode;
        if (parent && !map.has(parent)) {
          const parentName = cfNameDict[parent] || "";
          map.set(parent, { AccountCode: parent, AccountName: parentName, SumAccountCode: "" });
          added = true;
        }
      }
    }
    console.log("[CF cfAccountMap] dict size:", Object.keys(cfNameDict).length, "map size:", map.size);
    return map;
  }, [cfMapping, cfNameDict]);

  // CF code → { name, sumParent } — used by the new flat Individual render
  const cfMetadata = useMemo(() => {
    const m = new Map();
    cfMapping.forEach(map => {
      const enabled = map.enabled ?? map.Enabled;
      if (enabled === false) return;
      const code = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
      const name = map.cashFlowAccountName ?? map.CashFlowAccountName ?? "";
      const sumParent = map.cashFlowAccountSumAccountCode ?? map.CashFlowAccountSumAccountCode ?? "";
      if (!code) return;
      if (!m.has(code)) {
        m.set(code, { name: name || cfNameDict[code] || "", sumParent });
      }
    });
    let added = true;
    while (added) {
      added = false;
      for (const node of [...m.values()]) {
        const p = node.sumParent;
        if (p && !m.has(p)) {
          m.set(p, { name: cfNameDict[p] || "", sumParent: "" });
          added = true;
        }
      }
    }
    return m;
  }, [cfMapping, cfNameDict]);

  const groupToCf = useMemo(() => {
    const m = new Map();
    cfMapping.forEach(map => {
      const enabled = map.enabled ?? map.Enabled;
      if (enabled === false) return;
      const ga = map.groupAccountCode ?? map.GroupAccountCode ?? "";
      const cf = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
      if (!ga || !cf) return;
      if (!m.has(ga)) m.set(ga, []);
      m.get(ga).push(cf);
    });
    return m;
  }, [cfMapping]);

// localAccountCode + mappingName → groupAccountCode lookup
  const localToGroup = useMemo(() => {
    const m = new Map();
    mappedAccounts.forEach(r => {
      const local = r.localAccountCode ?? r.LocalAccountCode ?? "";
      const grp   = r.groupAccountCode ?? r.GroupAccountCode ?? "";
      const mname = r.mappingName ?? r.MappingName ?? "";
      const ignored = r.ignored ?? r.Ignored;
      if (!local || !grp || ignored === true) return;
      // Key by mappingName + localCode because the same local code can map to
      // different group codes in different mapping configurations.
      m.set(`${mname}::${local}`, grp);
      // Also store by local code alone as a fallback
      if (!m.has(local)) m.set(local, grp);
    });
    return m;
  }, [mappedAccounts]);

// Build flat pivot from uploaded LEAVES.
  // Each uploaded leaf row already carries AccountCode = group account code
  // (Konsolidator does the local→group step internally). We just need group → CF.
  // Then propagate values up the cashFlowAccountSumAccountCode chain so subtotals fill.
  const buildIndividualPivot = (rows) => {
    if (!rows.length || !cfMetadata.size) return new Map();

    const pivot = new Map();

    rows.forEach(r => {
      const localCode = r.LocalAccountCode ?? r.localAccountCode ?? null;
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";

      // Only LEAF rows have LocalAccountCode populated. Subtotal/total rows are
      // duplicates with the same AmountYTD and would triple-count.
      if (!localCode || !groupCode || !co) return;

      const cfs = groupToCf.get(groupCode);
      if (!cfs) return;

      const amt = parseAmt(r.AmountYTD ?? r.amountYTD);
      cfs.forEach(cfCode => {
        if (!pivot.has(cfCode)) pivot.set(cfCode, {});
        const c = pivot.get(cfCode);
        if (!c[co]) c[co] = [];
        c[co].push({ _cfAmount: amt, _src: r, _ga: groupCode });
      });
    });

    // Propagate up the CF parent chain (cashFlowAccountSumAccountCode).
    const leafCodes = [...pivot.keys()];
    leafCodes.forEach(leafCode => {
      const meta = cfMetadata.get(leafCode);
      if (!meta) return;
      let parent = meta.sumParent;
      const seen = new Set([leafCode]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const leafPiv = pivot.get(leafCode) || {};
        if (!pivot.has(parent)) pivot.set(parent, {});
        const parentPiv = pivot.get(parent);
        Object.entries(leafPiv).forEach(([co, rsArr]) => {
          if (!parentPiv[co]) parentPiv[co] = [];
          const sum = rsArr.reduce((s, r) => s + (r._cfAmount ?? 0), 0);
          parentPiv[co].push({ _cfAmount: sum, _src: null, _ga: `[rollup ${leafCode}→${parent}]` });
        });
        const parentMeta = cfMetadata.get(parent);
        parent = parentMeta?.sumParent || "";
      }
    });

return pivot;
  };

  const individualPivot    = useMemo(() => buildIndividualPivot(uploadedData), [uploadedData, cfMetadata, groupToCf]);
const cmpIndividualPivot = useMemo(() => buildIndividualPivot(cmpUploaded),  [cmpUploaded,  cfMetadata, groupToCf]);
  const pivot    = mode === "consolidated" ? consolidatedPivot    : individualPivot;
  const cmpPivot = mode === "consolidated" ? cmpConsolidatedPivot : cmpIndividualPivot;

  const accountMap = useMemo(() => {
    if (mode === "consolidated") {
      const m = new Map();
      rawData.forEach(r => {
        if (!m.has(r.AccountCode)) {
          m.set(r.AccountCode, {
            AccountCode: r.AccountCode, AccountName: r.AccountName,
            AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
          });
        }
      });
      return m;
    }
    return cfAccountMap;
  }, [mode, rawData, cfAccountMap]);

  const tree = useMemo(() => buildTree([...accountMap.values()], cfSort), [accountMap]);

  const { elimPivot, elimHeaders } = useMemo(() => {
    if (mode !== "consolidated") return { elimPivot: new Map(), elimHeaders: [] };
    const groupJournals = journalData.filter(r =>
      r.CompanyShortName === topParent &&
      (r.AccountType === "C/F" || r.AccountType === "CFS")
    );
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
    const empty = () => Object.fromEntries(headers.map(h => [h, 0]));
    const detail = new Map();
    groupJournals.forEach(r => {
      const ac = String(r.AccountCode ?? "").trim();
      if (!ac) return;
      const h = String(r.JournalHeader ?? "").trim() || "(no header)";
      if (!detail.has(ac)) detail.set(ac, empty());
      detail.get(ac)[h] += (Number(r.AmountYTD ?? 0));
    });
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
      while (parentOf.has(cur)) { const par = parentOf.get(cur); addTo(par, src); cur = par; }
    });
    const headerTotals = {};
    headers.forEach(h => {
      let absSum = 0;
      for (const v of m.values()) absSum += Math.abs(v[h] ?? 0);
      headerTotals[h] = absSum;
    });
    const nonEmpty = headers.filter(h => headerTotals[h] >= 1);
    return { elimPivot: m, elimHeaders: nonEmpty };
  }, [mode, journalData, rawData, topParent]);

  const toggleExpand = code => setExpanded(prev => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next;
  });

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
  const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: MONTHS.find(x => x.value === m)?.label ?? String(m) }));

  const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;

  const hasData = mode === "consolidated" ? rawData.length > 0 : uploadedData.length > 0;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <style>{`
        .cf-scroll-outer { position: relative; overflow: hidden; }
.cf-scroll {
          overflow: auto; height: 100%;
          scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9;
        }
        .cf-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .cf-scroll::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 5px; }
        .cf-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
.cf-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
        .cf-scroll thead th { border-color: transparent !important; }
        .cf-scroll thead tr:first-child th:first-child { border-top-left-radius: 1rem; }
        .cf-scroll thead tr:first-child th:last-child  { border-top-right-radius: 1rem; }
      `}</style>

      <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
<div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: colors.primary }} />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Reports</p>
<h1 className="leading-none" style={header1Style}>Cash Flow</h1>
          </div>
        </div>

        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

<TabSelector
          tabs={[{ key: "consolidated", label: "Consolidated" }, { key: "individual", label: "Individual" }]}
          activeKey={mode}
          onSelect={(k) => {
            // If user manually selects Consolidated on a tenant we already
            // know has no consolidated CF data, give them a heads-up.
            if (k === "consolidated" && syntheticCf) {
              const ok = window.confirm(
                "This tenant has no consolidated Cash Flow data.\n\n" +
                "Switching to Consolidated mode will likely show an empty table. " +
                "The Individual view shows a synthesised Cash Flow built from " +
                "uploaded accounts.\n\n" +
                "Switch to Consolidated anyway?"
              );
              if (!ok) return;
              setSyntheticCf(false);
            }
            setMode(k);
            setExpanded(new Set());
          }}
          filterStyle={filterStyle} />

        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

        <div className="flex items-center gap-2 flex-wrap">
          {sources.length > 0 && (
            <FilterPill label="Source" value={source} onChange={setSource}
              options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))}
              filterStyle={filterStyle} colors={colors} />
          )}
          {availableYears.length > 0 && (
            <FilterPill label="Year" value={year} onChange={setYear} options={availableYears}
              filterStyle={filterStyle} colors={colors} />
          )}
          {availableMonths.length > 0 && (
            <FilterPill label="Month" value={month} onChange={setMonth} options={availableMonths}
              filterStyle={filterStyle} colors={colors} />
          )}
          {structures.length > 0 && (
            <FilterPill label="Structure" value={structure} onChange={setStructure}
              options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))}
              filterStyle={filterStyle} colors={colors} />
          )}
{mode === "consolidated" && holdingOptions.length > 1 && (
            <FilterPill label="Perspective" value={topParent} onChange={setPerspectiveCompany}
              options={holdingOptions} filterStyle={filterStyle} colors={colors} />
          )}
          {mode === "individual" && contributionCompanies.length > 1 && (
            <MultiSelectPill label="Companies"
              values={selectedCompanies}
              onChange={setSelectedCompanies}
              options={contributionCompanies.map(c => ({
                value: c,
                label: companies.find(x => x.CompanyShortName === c)?.CompanyLegalName || c
              }))}
              filterStyle={filterStyle} colors={colors} />
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 flex-shrink-0 mr-6">
          {loading && <Loader2 size={13} className="animate-spin text-[#1a2f8a]" />}
          <button
            onClick={() => {
              if (!compareMode) {
                setCmpYear(year); setCmpMonth(month);
                setCmpSource(source); setCmpStructure(structure);
              }
              setCompareMode(c => !c);
            }}
            title={compareMode ? "Disable comparison" : "Compare with another period"}
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:scale-110 hover:shadow-md"
            style={{
              backgroundColor: compareMode ? colors.primary : `${colors.primary}15`,
              color: compareMode ? "white" : colors.primary,
            }}>
            <GitMerge size={16} />
          </button>
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export Excel">
            <img src="https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png" width="44" height="36" alt="Excel" />
          </button>
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export PDF">
            <img src="https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png" width="30" height="36" alt="PDF" />
          </button>
        </div>
      </div>

      {compareMode && (
        <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-1.5 h-8 rounded-full bg-gray-300" />
            <p className="text-[10px] font-black uppercase tracking-widest leading-none" style={{ color: "#0c1d55" }}>
              Compare Period
            </p>
          </div>
          <div className="w-px h-8 bg-gray-100 flex-shrink-0" />
          <div className="flex items-center gap-2 flex-wrap">
            <FilterPill label="Source"    value={cmpSource}    onChange={setCmpSource}
              options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))}
              filterStyle={filterStyle} colors={colors} />
            <FilterPill label="Year"      value={cmpYear}      onChange={setCmpYear}
              options={availableYears} filterStyle={filterStyle} colors={colors} />
            <FilterPill label="Month"     value={cmpMonth}     onChange={setCmpMonth}
              options={availableMonths} filterStyle={filterStyle} colors={colors} />
            <FilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure}
              options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))}
              filterStyle={filterStyle} colors={colors} />
            {cmpLoading && <Loader2 size={13} className="animate-spin text-gray-400 flex-shrink-0" />}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center flex-1 gap-3">
              <Loader2 size={22} className="animate-spin text-[#1a2f8a]" />
              <p className="text-xs text-gray-400">Building cash flow…</p>
            </div>
          ) : !hasData ? (
            <div className="flex items-center justify-center flex-1 text-xs text-gray-300 font-black uppercase tracking-widest">
              No data for selected filters
            </div>
          ) : (
            <div className="cf-scroll-outer flex-1 min-h-0" style={{ minWidth: 0 }}>
              <div className="cf-scroll" style={{ minWidth: 0 }}>
              <table className="text-xs border-collapse" style={{ borderSpacing: 0, width: "100%", minWidth: "max-content", tableLayout: "auto" }}>
<thead className="sticky top-0 z-30" style={{ backgroundColor: colors.primary }}>
                    <tr style={{ backgroundColor: colors.primary }}>
                      <th className="sticky left-0 z-40 border-r border-white/20 text-left px-4 py-3"
                        style={{ minWidth: 220, width: 220, backgroundColor: colors.primary, boxShadow: `0 0 0 1px ${colors.primary}` }} rowSpan={2}>
                        <div className="flex items-center justify-between gap-2">
                          <span style={header2Style}>ACCOUNT</span>
{mode === "consolidated" && (
                            <button
                              onClick={() => {
                                if (expanded.size > 0) setExpanded(new Set());
                                else setExpanded(new Set([...accountMap.keys()]));
                              }}
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all font-bold normal-case tracking-normal flex-shrink-0">
                              {expanded.size > 0 ? <Minimize2 size={11}/> : <Maximize2 size={11}/>}
                            </button>
                          )}
                        </div>
                      </th>

{mode === "consolidated" ? (
                        <>
<th colSpan={(2 + (elimExpanded ? elimHeaders.length : 0)) * (compareMode ? 3 : 1)}
                            className="px-4 py-2 text-center"
                            style={{ backgroundColor: colors.primary, boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                            <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>
                              Cash Flow · {getLegal(topParent)}
                            </span>
                          </th>
<th colSpan={(contributionCompanies.length + 1) * (compareMode ? 3 : 1)}
                            className="px-4 py-2 text-center"
                            style={{ backgroundColor: colors.primary, boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                            <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>Contribution</span>
                          </th>
                        </>
) : (
<th colSpan={visibleCompanies.length * (compareMode ? 3 : 1)}
                          className="px-4 py-2 text-center"
                          style={{ backgroundColor: colors.primary, boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                          <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>
                            Cash Flow · By Company (local currency)
                          </span>
                        </th>
                      )}
                    </tr>

<tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      {mode === "consolidated" && (
                        <>
                          <th className="px-4 py-2.5 text-center"
                            style={{ minWidth: 100, backgroundColor: colors.primary }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span style={underscore1Style}>{topParent || "Total"}</span>
                              <span style={underscore2Style}>{isRootView ? "Consolidated" : "Subgroup"}</span>
                            </div>
                          </th>
{/* Synthetic CF info modal */}
      {showSyntheticModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
          onClick={() => setShowSyntheticModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: `${colors.quaternary || "#F59E0B"}20`,
                  color: colors.quaternary || "#F59E0B",
                }}>
                <span className="text-lg font-black">!</span>
              </div>
              <div className="flex-1">
                <h2 className="text-base font-black mb-2" style={{ color: colors.primary }}>
                  No consolidated Cash Flow available
                </h2>
                <p className="text-sm text-gray-600 leading-relaxed">
                  This tenant doesn't have the consolidation module configured for Cash Flow,
                  so a consolidated view can't be generated.
                </p>
                <p className="text-sm text-gray-600 leading-relaxed mt-2">
                  We've switched to <strong>Individual mode</strong>, which shows the uploaded
                  accountds for each company in their local currency.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSyntheticModal(false)}
              className="self-end px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all hover:opacity-90"
              style={{ backgroundColor: colors.primary }}>
              Got it
            </button>
          </div>
        </div>
      )}

      {compareMode && (
                            <>
                              <th className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, color: "#FFF" }}>Compare</span>
                                  <span style={underscore2Style}>&nbsp;</span>
                                </div>
                              </th>
                              <th className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "1px solid rgba(255,255,255,0.15)" }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, color: "#FFF" }}>Δ</span>
                                  <span style={underscore2Style}>&nbsp;</span>
                                </div>
                              </th>
                            </>
                          )}
                        </>
                      )}

                      {mode === "consolidated" && (
                        <>
                          <th className="px-4 py-2.5 text-center border-l border-white/20 cursor-pointer hover:bg-white/10 transition-colors select-none"
                            style={{ minWidth: 100, backgroundColor: colors.primary }}
                            onClick={() => setElimExpanded(e => !e)}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span style={underscore1Style}>Eliminations {elimExpanded ? "▾" : "▸"}</span>
                              <span style={underscore2Style}>&nbsp;</span>
                            </div>
                          </th>
                          {compareMode && (
                            <>
                              <th className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, color: "#FFF" }}>Compare</span>
                                  <span style={underscore2Style}>&nbsp;</span>
                                </div>
                              </th>
                              <th className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "1px solid rgba(255,255,255,0.15)" }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, color: "#FFF" }}>Δ</span>
                                  <span style={underscore2Style}>&nbsp;</span>
                                </div>
                              </th>
                            </>
                          )}
                          {elimExpanded && elimHeaders.map((h, idx) => (
                            <th key={`elim-head-${h}`}
                              className="px-3 py-2.5 text-center"
                              style={{
                                minWidth: 140, backgroundColor: colors.primary,
                                boxShadow: `inset 0 0 0 9999px rgba(0,0,0,${0.03 * (idx + 1)})`,
                              }}>
                              <div className="flex flex-col items-center gap-0.5">
                                <span style={{ ...underscore1Style, position: "relative", textTransform: "none" }} title={h}>{h}</span>
                                <span style={underscore2Style}>&nbsp;</span>
                              </div>
                            </th>
                          ))}
                        </>
                      )}

{mode === "consolidated" && (
                        <>
                          <th className="px-4 py-2.5 text-center border-l border-white/20"
                            style={{ minWidth: 110, backgroundColor: colors.primary }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span style={underscore1Style}>Contribution</span>
                              <span style={underscore2Style}>Sum</span>
                            </div>
                          </th>
                          {compareMode && (
                            <>
                              <th className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, color: "#FFF" }}>Compare</span>
                                  <span style={underscore2Style}>&nbsp;</span>
                                </div>
                              </th>
                              <th className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "1px solid rgba(255,255,255,0.15)" }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, color: "#FFF" }}>Δ</span>
                                  <span style={underscore2Style}>&nbsp;</span>
                                </div>
                              </th>
                            </>
                          )}
                        </>
                      )}

{(mode === "individual" ? visibleCompanies : contributionCompanies).flatMap(c => {
                        const colCcy = mode === "consolidated"
                          ? (displayCurrency || "—")
                          : (companies.find(x => x.CompanyShortName === c)?.CurrencyCode || "—");
                        return [
<th key={c} className="px-4 py-2.5 text-center"
                          style={{ minWidth: 100, backgroundColor: colors.primary }}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap max-w-full" style={underscore1Style} title={getLegal(c)}>
                              {getLegal(c)}
                            </span>
                            <span style={underscore2Style}>{colCcy}</span>
                          </div>
                        </th>,
...(compareMode ? [
                          <th key={`${c}-cmp`} className="px-3 py-2.5 text-center"
                            style={{ minWidth: 110, backgroundColor: "#0a1547", borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span style={{ ...underscore1Style, opacity: 0.85, position: "relative" }}>Compare</span>
                              <span style={underscore2Style}>&nbsp;</span>
                            </div>
                          </th>,
                          <th key={`${c}-delta`} className="px-3 py-2.5 text-center"
                            style={{ minWidth: 130, backgroundColor: "#0a1547", borderRight: "1px solid rgba(255,255,255,0.15)" }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span style={{ ...underscore1Style, opacity: 0.85, position: "relative" }}>Δ</span>
                              <span style={underscore2Style}>&nbsp;</span>
                            </div>
                          </th>,
                        ] : []),
                      ];
                      })}
                    </tr>
                  </thead>
<tbody>
                    {(() => {
                      // ─── CONSOLIDATED MODE: keep existing tree-based render ───
                      if (mode === "consolidated") {
                        if (!activeCfMapping?.rows) {
                          return tree.map(node => (
                            <SheetRow key={node.AccountCode} node={node} depth={0}
                              expanded={expanded} onToggle={toggleExpand}
                              pivot={pivot} elimPivot={elimPivot}
                              contributionCompanies={contributionCompanies}
                              topParent={topParent}
                              elimExpanded={elimExpanded} elimHeaders={elimHeaders}
                              compareMode={compareMode} cmpPivot={cmpPivot}
                              body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                              mode={mode} />
                          ));
                        }
                        const nodesByCode = new Map();
                        const indexNodes = (nodes) => {
                          nodes.forEach(n => {
                            nodesByCode.set(String(n.AccountCode), n);
                            if (n.children?.length) indexNodes(n.children);
                          });
                        };
                        indexNodes(tree);
                        const topLevelCodes = new Set(
                          [...activeCfMapping.rows.entries()]
                            .filter(([, info]) => info.level === 0)
                            .map(([code]) => code)
                        );
                        const stripTopLevelChildren = (node) => {
                          if (!node.children?.length) return node;
                          return {
                            ...node,
                            children: node.children
                              .filter(c => !topLevelCodes.has(String(c.AccountCode)))
                              .map(stripTopLevelChildren),
                          };
                        };
                        const hasValue = (node) => {
                          const byCo = pivot.get(node.AccountCode) || {};
                          for (const co of Object.keys(byCo)) {
                            const rs = byCo[co] || [];
                            for (const r of rs) {
                              const v = Number(r.AmountYTD ?? 0);
                              if (Math.round(v) !== 0) return true;
                            }
                          }
                          return (node.children || []).some(hasValue);
                        };
                        const ordered = [...activeCfMapping.rows.entries()]
                          .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
                          .filter(([, info]) => info.level === 0)
                          .map(([code, info]) => {
                            const treeNode = nodesByCode.get(code);
                            if (treeNode) return { node: stripTopLevelChildren(treeNode), info };
                            return {
                              node: { AccountCode: code, AccountName: cfNameDict[code] || "", SumAccountCode: "", children: [] },
                              info,
                            };
                          })
                          .filter(({ node }) => hasValue(node));
                        const seenSections = new Set();
                        const totalColsCons =
                          1
                          + (1 + (compareMode ? 2 : 0)
                            + 1 + (compareMode ? 2 : 0)
                            + (elimExpanded ? elimHeaders.length : 0)
                            + 1 + (compareMode ? 2 : 0))
                          + contributionCompanies.length * (compareMode ? 3 : 1);
                        const rowsOut = [];
                        ordered.forEach(({ node, info }) => {
                          if (!seenSections.has(info.section)) {
                            seenSections.add(info.section);
                            const sec = activeCfMapping.sections.get(info.section);
                            if (sec) {
                              rowsOut.push(
                                <tr key={`section-${info.section}`}>
                                  <td colSpan={totalColsCons}
                                    style={{ backgroundColor: sec.color, color: "#fff", padding: "8px 16px",
                                             fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                                    {sec.label}
                                  </td>
                                </tr>
                              );
                            }
                          }
                          rowsOut.push(
                            <SheetRow key={node.AccountCode} node={node} depth={0}
                              expanded={expanded} onToggle={toggleExpand}
                              pivot={pivot} elimPivot={elimPivot}
                              contributionCompanies={contributionCompanies}
                              topParent={topParent}
                              elimExpanded={elimExpanded} elimHeaders={elimHeaders}
                              compareMode={compareMode} cmpPivot={cmpPivot}
                              body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                              mode={mode} />
                          );
                        });
                        return rowsOut;
                      }

                      // ─── INDIVIDUAL MODE: flat per-section render ─────────
                      // Show every CF code with non-zero value, grouped by section.
                      // Subtotals (codes that are SumAccountCode of someone) shown bold.

                      const subtotalCodes = new Set();
                      cfMetadata.forEach(({ sumParent }) => { if (sumParent) subtotalCodes.add(sumParent); });

                      const codesWithValue = [];
                      pivot.forEach((byCo, code) => {
                        let total = 0;
                        for (const co of Object.keys(byCo)) {
                          for (const r of byCo[co] || []) total += Number(r._cfAmount ?? 0);
                        }
                        if (Math.round(total) !== 0) codesWithValue.push(code);
                      });

                      const sectionForCode = (code) => {
                        const fromSb = activeCfMapping?.rows?.get(code);
                        if (fromSb) return fromSb.section;
                        const n = parseInt(code, 10);
                        if (isNaN(n)) return "OPERATING";
                        if (n < 3000) return "OPERATING";
                        if (n < 4000) return "INVESTING";
                        return "FINANCING";
                      };
                      const sortOrderFor = (code) => {
                        const fromSb = activeCfMapping?.rows?.get(code);
                        if (fromSb) return fromSb.sortOrder;
                        const n = parseInt(code, 10);
                        return isNaN(n) ? 99999 : n * 10;
                      };
                      const nameFor = (code) => {
                        const meta = cfMetadata.get(code);
                        if (meta?.name) return meta.name;
                        if (cfNameDict[code]) return cfNameDict[code];
                        return "";
                      };

                      const bySection = new Map();
                      codesWithValue.forEach(code => {
                        const sec = sectionForCode(code);
                        if (!bySection.has(sec)) bySection.set(sec, []);
                        bySection.get(sec).push(code);
                      });
                      bySection.forEach(arr => arr.sort((a, b) => sortOrderFor(a) - sortOrderFor(b)));

                      const sectionOrder = activeCfMapping?.sections
                        ? [...activeCfMapping.sections.keys()]
                        : ["OPERATING", "INVESTING", "FINANCING"];
                      bySection.forEach((_, sec) => {
                        if (!sectionOrder.includes(sec)) sectionOrder.push(sec);
                      });

                      const totalColsInd = 1 + visibleCompanies.length * (compareMode ? 3 : 1);
                      const rowsOut = [];

                      sectionOrder.forEach(sec => {
                        const codes = bySection.get(sec);
                        if (!codes || codes.length === 0) return;

                        const secInfo = activeCfMapping?.sections?.get(sec);
                        rowsOut.push(
                          <tr key={`section-${sec}`}>
                            <td colSpan={totalColsInd}
                              style={{
                                backgroundColor: secInfo?.color || colors.primary,
                                color: "#fff", padding: "8px 16px",
                                fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                              }}>
                              {secInfo?.label || sec}
                            </td>
                          </tr>
                        );

                        codes.forEach(code => {
                          const isSubtotal = subtotalCodes.has(code);
                          const node = {
                            AccountCode: code,
                            AccountName: nameFor(code),
                            SumAccountCode: "",
                            children: [],
                          };
rowsOut.push(
                            <SheetRow key={code} node={node} depth={0}
                              expanded={expanded} onToggle={toggleExpand}
                              pivot={pivot} elimPivot={elimPivot}
                              contributionCompanies={visibleCompanies}
                              topParent={topParent}
                              elimExpanded={elimExpanded} elimHeaders={elimHeaders}
                              compareMode={compareMode} cmpPivot={cmpPivot}
                              body1Style={isSubtotal ? body1Style : body2Style}
                              body2Style={body2Style}
                              subbody1Style={body2Style}
                              mode={mode} />
                          );
                        });
                      });

                      return rowsOut;
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}