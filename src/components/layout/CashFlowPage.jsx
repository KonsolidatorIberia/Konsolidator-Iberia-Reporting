/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Maximize2, Minimize2, GitMerge, Download, Library } from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill, MultiFilterPill } from "./PageHeader.jsx";
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

function useAnimatedNumber(target, duration = 700) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    const to = Number(target) || 0;
    if (from === to) return;
    startRef.current = null;
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return display;
}

const fmt = (n) => {
  if (n == null || n === "") return "—";
  const rounded = Math.round(Number(n));
  if (rounded === 0) return "—";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(rounded);
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

function parseDimensionsField(str) {
  if (!str || typeof str !== "string") return [];
  return str.split("||").map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return { group: pair.slice(0, idx).trim(), code: pair.slice(idx + 1).trim() };
  }).filter(Boolean);
}

function rowMatchesDimMulti(r, groups, codes) {
  const groupsActive = Array.isArray(groups) && groups.length > 0;
  const codesActive  = Array.isArray(codes)  && codes.length  > 0;
  if (!groupsActive && !codesActive) return true;
  const raw = r.Dimensions ?? r.dimensions ?? "";
  const dims = parseDimensionsField(raw);
  if (!dims.length) return true;
  return dims.some(d => {
    const groupOk = !groupsActive || groups.includes(d.group);
    const codeOk  = !codesActive  || codes.includes(String(d.code));
    return groupOk && codeOk;
  });
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

function AnimCell({ v, style, className }) {
  const animated = useAnimatedNumber(Math.round(v ?? 0), 900);
  const rounded = Math.round(v ?? 0);
  const color = rounded === 0 ? "#D1D5DB" : rounded < 0 ? "#EF4444" : "#000000";
  return (
    <td className={className} style={{ ...style, color }}>
      {rounded === 0 ? "—" : fmt(animated)}
    </td>
  );
}

function PctCell({ pct, colors, rowStyle, exiting }) {
  const animated = useAnimatedNumber(pct ?? 0, 900);
  const isEmpty = pct === null || pct === 0;
  const color = isEmpty ? "#D1D5DB" : Math.abs(pct) >= 50 ? colors.primary : `${colors.primary}99`;
  return (
    <td style={{
        background: `${colors.primary}06`,
        borderLeft: exiting ? "none" : "1px dashed #e5e7eb",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textAlign: "center",
        ...rowStyle, color,
        animation: exiting
          ? "pctColOut 180ms ease both"
          : "pctColIn 380ms cubic-bezier(0.34,1.56,0.64,1) both",
      }}>
      <span style={{ display: "inline-block", padding: "0 8px" }}>
        {isEmpty ? "—" : `${animated.toFixed(1)}%`}
      </span>
    </td>
  );
}

/* ─── SheetRow (consolidated only) ──────────────────────────────────────── */
function SheetRow({
  node, depth, expanded, onToggle,
  pivot, elimPivot,
  contributionCompanies, allContributionCompanies, topParent,
  elimExpanded, elimHeaders,
  pctExpanded, pctExiting,
  compareMode, cmpExiting, cmpPivot,
  body1Style, body2Style, subbody1Style,
  colors,
  rowIndex = 0,
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
    const role = company === topParent ? "Parent" : "Contribution";
    return (byCompany[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
  };

const contribSum = contributionCompanies.reduce((s, c) => s + getContrib(c), 0);
  const fullContribSum = (allContributionCompanies ?? contributionCompanies).reduce((s, c) => s + getContrib(c), 0);

  const consTotal = (byCompany[topParent] ?? [])
    .filter(r => r.CompanyRole === "Group")
    .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
    .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);

  const elimTotal = consTotal - fullContribSum;

  const cmpByCompany = cmpPivot?.get(node.AccountCode) || {};
  const cmpGetContrib = (company) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return (cmpByCompany[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
  };
 const cmpContribSum = contributionCompanies.reduce((s, c) => s + cmpGetContrib(c), 0);
  const cmpFullContribSum = (allContributionCompanies ?? contributionCompanies).reduce((s, c) => s + cmpGetContrib(c), 0);
const cmpConsTotal = (cmpByCompany[topParent] ?? [])
    .filter(r => r.CompanyRole === "Group")
    .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
    .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
const cmpElimTotal = cmpConsTotal - cmpFullContribSum;

const renderCompareCells = (current, compare, key) => {
    const delta = current - compare;
    const pct = compare !== 0 ? (delta / Math.abs(compare)) * 100 : null;
    const devColor = delta === 0 ? "#D1D5DB" : delta > 0 ? "#059669" : "#EF4444";
    const cmpColor = compare === 0 ? "#D1D5DB" : compare < 0 ? "#EF4444" : "#CF305D";
    const hidden = !compareMode && !cmpExiting;
    const cls = `cmp-col${hidden ? " cmp-col-hidden" : ""}`;
    return [
      <AnimCell key={`${key}-cmp`} v={compare}
        className={`${cls} text-center whitespace-nowrap tabular-nums px-4 py-2.5 border-l border-gray-100`}
       style={{ ...rowStyle, color: cmpColor, background: `${colors.primary}08` }} />,
      <td key={`${key}-delta`}
        className={`${cls} text-center whitespace-nowrap tabular-nums`}
        style={{ ...rowStyle, color: devColor, background: `${colors.primary}12` }}>
        <span style={{ display: "inline-block", padding: "10px 12px" }}>
          {delta === 0 ? "—" : delta < 0
            ? `(${Math.abs(delta).toLocaleString("de-DE", { maximumFractionDigits: 0 })})`
            : delta.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
        </span>
      </td>,
      <td key={`${key}-pct`}
        className={`${cls} text-center whitespace-nowrap tabular-nums`}
       style={{ ...rowStyle, color: devColor, background: `${colors.primary}1e` }}>
        <span style={{ display: "inline-block", padding: "10px 12px" }}>
          {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
        </span>
      </td>,
    ];
  };



return (
    <>
      <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/50"
        style={{ animation: `cfRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both` }}>
<td className="sticky left-0 z-10 py-2.5 pr-4 border-r border-gray-100 bg-white group-hover:bg-gray-50"
          style={{ boxShadow: "2px 0 8px -2px rgba(0,0,0,0.06)" }}
          style={{ paddingLeft: `${14 + depth * 16}px`, minWidth: 220, width: 220 }}>
          <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => hasChildren && onToggle(node.AccountCode)}>
            {hasChildren
              ? <span className={`text-[#1a2f8a] flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}>
                  <ChevronRight size={11} />
                </span>
              : <span className="w-3 flex-shrink-0" />}
<span className="flex-shrink-0 mr-2" style={subbody1Style}>{node.AccountCode}</span>
            <span className="truncate" style={{ ...rowStyle, maxWidth: 260 }}>{node.AccountName}</span>
          </div>
        </td>

<AnimCell v={consTotal} className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100" style={{ minWidth: 130, ...rowStyle }} />
        {renderCompareCells(consTotal, cmpConsTotal, "cons")}

        <AnimCell v={elimTotal} className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100" style={{ minWidth: 110, ...rowStyle }} />
       {renderCompareCells(elimTotal, cmpElimTotal, "elim")}

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

<AnimCell v={contribSum} className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200" style={{ minWidth: 110, ...rowStyle }} />
        {renderCompareCells(contribSum, cmpContribSum, "contribsum")}

{contributionCompanies.flatMap((c, ci) => {
          const val = getContrib(c);
          const cmpVal = cmpGetContrib(c);
          const absTotal = contributionCompanies.reduce((s, co) => s + Math.abs(getContrib(co)), 0);
          const pct = absTotal !== 0 && val !== 0 ? (val / absTotal) * 100 : null;
          return [
            <AnimCell key={`col-${ci}`} v={val}
              className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
              style={{ minWidth: 120, ...rowStyle }} />,
            ...((pctExpanded || pctExiting) ? [<PctCell key={`pct-${ci}`} pct={pct} colors={colors} rowStyle={rowStyle} exiting={pctExiting} />] : []),
            ...((compareMode || cmpExiting) ? renderCompareCells(val, cmpVal, `contrib-${ci}`) : []),
          ];
        })}
      </tr>

      {isExpanded && hasChildren && node.children.map(child => (
<SheetRow key={child.AccountCode} node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          pivot={pivot} elimPivot={elimPivot}
          contributionCompanies={contributionCompanies}
          allContributionCompanies={allContributionCompanies}
          topParent={topParent}
          elimExpanded={elimExpanded} elimHeaders={elimHeaders}
pctExpanded={pctExpanded}
          pctExiting={pctExiting}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} colors={colors} />
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
  const [cfNameDict,     setCfNameDict]     = useState({});

  const [pgcCfMapping,           setPgcCfMapping]           = useState(null);
  const [danishIfrsCfMapping,    setDanishIfrsCfMapping]    = useState(null);
  const [spanishIfrsEsCfMapping, setSpanishIfrsEsCfMapping] = useState(null);

  const [year,               setYear]               = useState("");
  const [month,              setMonth]              = useState("");
  const [source,             setSource]             = useState("");
  const [structure,          setStructure]          = useState("DefaultStructure");
const [perspectiveCompany, setPerspectiveCompany] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [upDimGroups, setUpDimGroups] = useState(null);
  const [upDimensions, setUpDimensions] = useState(null);

const [rawData,      setRawData]      = useState([]);
  const [allRawData,   setAllRawData]   = useState([]);
  const [journalData,  setJournalData]  = useState([]);
const [loading,      setLoading]      = useState(true);
  const [metaReady,    setMetaReady]    = useState(false);
  const [probeReady,   setProbeReady]   = useState(false);
  const [expanded,     setExpanded]     = useState(new Set());
const [elimExpanded, setElimExpanded] = useState(false);
  const [pctExpanded,  setPctExpanded]  = useState(false);
  const [pctExiting,   setPctExiting]   = useState(false);

const [compareMode,  setCompareMode]  = useState(false);
  const [cmpVisible,   setCmpVisible]   = useState(false);
  const [cmpExiting,   setCmpExiting]   = useState(false);

  useEffect(() => {
    if (compareMode) {
      setCmpExiting(false);
      setCmpVisible(true);
    } else if (cmpVisible) {
      setCmpExiting(true);
      const t = setTimeout(() => { setCmpVisible(false); setCmpExiting(false); }, 200);
      return () => clearTimeout(t);
    }
  }, [compareMode]);
  const [cmpYear,      setCmpYear]      = useState("");
  const [cmpMonth,     setCmpMonth]     = useState("");
  const [cmpSource,    setCmpSource]    = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
const [cmpRawData,      setCmpRawData]      = useState([]);
  const [cmpAllRawData,   setCmpAllRawData]   = useState([]);
  const [cmpLoading,      setCmpLoading]      = useState(false);
  const [cmpUpDimGroups,  setCmpUpDimGroups]  = useState(null);
  const [cmpUpDimensions, setCmpUpDimensions] = useState(null);
const [viewsModalOpen, setViewsModalOpen] = useState(false);

  const [fakeProgress, setFakeProgress] = useState(0);
  const fakeRef = useRef(null);
  const fakeStartRef = useRef(null);

  useEffect(() => {
    if (loading) {
      setFakeProgress(0);
      fakeStartRef.current = performance.now();
      cancelAnimationFrame(fakeRef.current);
      const tick = (now) => {
        const elapsed = now - fakeStartRef.current;
        const t = Math.min(1, elapsed / 2400);
        const eased = 1 - Math.pow(1 - t, 2);
        setFakeProgress(eased * 88);
        fakeRef.current = requestAnimationFrame(tick);
      };
      fakeRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(fakeRef.current);
      setFakeProgress(100);
    }
    return () => cancelAnimationFrame(fakeRef.current);
  }, [loading]);

  const animatedProgress = loading ? fakeProgress : 100;

const autoPeriodDone = useRef("");

  // ─── Metadata ────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${BASE}/periods`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/sources`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/structures`,               { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/companies`,                { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/consolidations`,           { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/group-structure`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
    ]).then(([p, s, st, co, cons, gs]) => {
      if (cancelled) return;
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs) ? gs : []);

      const structureNames = (st || []).map(x => x.GroupStructure ?? x);
      const defaultFlagged = (st || []).find(x => x.IsDefault === true || x.isDefault === true)?.GroupStructure;
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
    });
    return () => { cancelled = true; };
  }, [token]);

  // ─── Detect standard ─────────────────────────────────────────────
  const cfStandard = useMemo(() => {
    const populatedCodes = new Set([
      ...rawData.map(r => String(r.AccountCode ?? "")),
      ...Object.keys(cfNameDict),
    ].filter(Boolean));
    if ([...populatedCodes].some(c => /^CF\./.test(c))) return "pgc";
    if ([...populatedCodes].some(c => /^6\d{3}$/.test(c))) return "danish_ifrs";
    if ([...populatedCodes].some(c => /^4(21|22)\d$/.test(c))) return "danish_ifrs";
    if ([...populatedCodes].some(c => /^\d{4}$/.test(c))) return "spanish_ifrs_es";
    return null;
  }, [rawData, cfNameDict]);

  const loadCfStandardMapping = (table_rows, table_sections, setter) => {
    const SB_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SB_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sb = { apikey: SB_APIKEY, Authorization: `Bearer ${SB_APIKEY}` };
    Promise.all([
      fetch(`${SB_URL}/${table_rows}?select=*&order=sort_order.asc`,    { headers: sb }).then(r => r.json()),
      fetch(`${SB_URL}/${table_sections}?select=*&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
      rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setter({ rows, sections });
    }).catch(() => setter(null));
  };

  useEffect(() => {
    if (cfStandard !== "pgc")            { setPgcCfMapping(null); return; }
    loadCfStandardMapping("pgc_cf_rows", "pgc_cf_sections", setPgcCfMapping);
  }, [cfStandard]);

  useEffect(() => {
    if (cfStandard !== "danish_ifrs")    { setDanishIfrsCfMapping(null); return; }
    loadCfStandardMapping("danish_ifrs_cf_rows", "danish_ifrs_cf_sections", setDanishIfrsCfMapping);
  }, [cfStandard]);

  useEffect(() => {
    if (cfStandard !== "spanish_ifrs_es") { setSpanishIfrsEsCfMapping(null); return; }
    loadCfStandardMapping("spanish_ifrs_es_cf_rows", "spanish_ifrs_es_cf_sections", setSpanishIfrsEsCfMapping);
  }, [cfStandard]);

  const activeCfMapping = pgcCfMapping ?? danishIfrsCfMapping ?? spanishIfrsEsCfMapping;

  // ─── Auto period probe ─────────────────────────────────────────



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

useEffect(() => {
    const key = `${source}|${structure}|${topParent}`;
    if (autoPeriodDone.current === key) return;
    if (!token || !source || !structure || !metaReady || !topParent) return;
    autoPeriodDone.current = key;
    let cancelled = false;
    (async () => {
      const now = new Date();
      let probeY = now.getFullYear(), probeM = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        if (cancelled) break;
        try {
          const filter = `Year eq ${probeY} and Month eq ${probeM} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
          const res = await fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!res.ok) { probeM -= 1; if (probeM < 1) { probeM = 12; probeY -= 1; } continue; }
          const d = await res.json();
if ((d.value ?? []).length > 0) {
            if (!cancelled) { setYear(String(probeY)); setMonth(String(probeM)); setProbeReady(true); }
            return;
          }
        } catch { break; }
        probeM -= 1;
        if (probeM < 1) { probeM = 12; probeY -= 1; }
      }
})().finally(() => { if (!cancelled) setProbeReady(true); });
    return () => { cancelled = true; };
  }, [token, metaReady, source, structure, topParent]);

const cmpDimGroups = useMemo(() => {
    const seen = new Set();
    cmpAllRawData.forEach(r => {
      parseDimensionsField(r.Dimensions ?? r.dimensions ?? "").forEach(d => {
        if (d.group) seen.add(d.group);
      });
    });
    return [...seen].sort();
  }, [cmpAllRawData]);

const cmpDimNameMap = useMemo(() => {
    const m = new Map();
    cmpAllRawData.forEach(r => {
      const raw = r.Dimensions ?? r.dimensions ?? "";
      const name = r.DimensionName ?? r.dimensionName ?? "";
      parseDimensionsField(raw).forEach(d => {
        if (!m.has(d.code) && name) m.set(d.code, name);
      });
    });
    return m;
}, [cmpAllRawData]);

const cmpFilteredDims = useMemo(() => {
    const seen = new Set();
    const dims = [];
    cmpAllRawData.forEach(r => {
      parseDimensionsField(r.Dimensions ?? r.dimensions ?? "").forEach(d => {
        if (!cmpUpDimGroups || cmpUpDimGroups.includes(d.group)) {
          const key = `${d.group}:${d.code}`;
          if (!seen.has(key)) { seen.add(key); dims.push({ group: d.group, code: d.code }); }
        }
      });
    });
    return dims.sort((a, b) => a.code.localeCompare(b.code));
  }, [cmpAllRawData, cmpUpDimGroups]);

const dimGroups = useMemo(() => {
    const seen = new Set();
    allRawData.forEach(r => {
      parseDimensionsField(r.Dimensions ?? r.dimensions ?? "").forEach(d => {
        if (d.group) seen.add(d.group);
      });
    });
    return [...seen].sort();
  }, [allRawData]);

const dimNameMap = useMemo(() => {
    const m = new Map();
    allRawData.forEach(r => {
      const raw = r.Dimensions ?? r.dimensions ?? "";
      const name = r.DimensionName ?? r.dimensionName ?? "";
      parseDimensionsField(raw).forEach(d => {
        if (!m.has(d.code) && name) m.set(d.code, name);
      });
    });
    return m;
  }, [allRawData]);

  const filteredDims = useMemo(() => {
    const seen = new Set();
    const dims = [];
    allRawData.forEach(r => {
      parseDimensionsField(r.Dimensions ?? r.dimensions ?? "").forEach(d => {
        if (!upDimGroups || upDimGroups.includes(d.group)) {
          const key = `${d.group}:${d.code}`;
          if (!seen.has(key)) { seen.add(key); dims.push({ group: d.group, code: d.code }); }
        }
      });
    });
    return dims.sort((a, b) => a.code.localeCompare(b.code));
  }, [allRawData, upDimGroups]);

const effectiveCompanies = useMemo(() =>
    selectedCompanies.length === 0
      ? contributionCompanies
      : contributionCompanies.filter(c => selectedCompanies.includes(c)),
  [contributionCompanies, selectedCompanies]);

  const [colOrder, setColOrder] = useState(null);
  const [draggingCol, setDraggingCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

const orderedEffectiveCompanies = colOrder
    ? (() => {
        const set = new Set(effectiveCompanies);
        const ordered = colOrder.filter(c => set.has(c));
        const rest = effectiveCompanies.filter(c => !colOrder.includes(c));
        return [...ordered, ...rest];
      })()
    : effectiveCompanies;
  const effectiveKey = effectiveCompanies.join(",");
  useEffect(() => { setColOrder(null); }, [effectiveKey]);

  // ─── Fetch consolidated data ────────────────────────────────────
useEffect(() => {
    if (!metaReady || !probeReady || !year || !month || !source || !structure || !topParent) return;
    let cancelled = false;
    setLoading(true);
    setRawData([]); setJournalData([]);
    setExpanded(new Set());

    const consFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
    const baseFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    Promise.all([
      fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(consFilter)}`, auth)
        .then(r => r.json()).then(d => d.value || []),
      fetch(`${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`, auth)
        .then(r => r.json()).then(d => d.value || []),
    ]).then(([cons, journals]) => {
      if (cancelled) return;
      const cfRows = cons.filter(r => {
        const t = r.AccountType ?? r.accountType ?? "";
        return t === "C/F" || t === "CFS";
      });
      setCfNameDict(prev => {
        const next = { ...prev };
        cfRows.forEach(r => {
          const code = r.AccountCode ?? r.accountCode;
          const name = r.AccountName ?? r.accountName;
          if (code && name && !next[code]) next[code] = name;
        });
        return next;
      });
      setRawData(cfRows);
      setAllRawData(cons);
      setJournalData(journals);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
 }, [token, metaReady, probeReady, year, month, source, structure, topParent]);

// ─── Fetch compare data ─────────────────────────────────────────
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !topParent) return;
    let cancelled = false;
    setCmpLoading(true);
    const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}' and GroupShortName eq '${topParent}'`;
    fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
.then(d => {
        if (cancelled) return;
        const allRows = d.value || [];
        const cfRows = allRows.filter(r => {
          const t = r.AccountType ?? r.accountType ?? "";
          return t === "C/F" || t === "CFS";
        });
        setCmpRawData(cfRows);
        setCmpAllRawData(allRows);
        setCmpLoading(false);
      })
      .catch(() => { if (!cancelled) { setCmpRawData([]); setCmpLoading(false); } });
    return () => { cancelled = true; };
  }, [token, compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, topParent]);

  // ─── Pivots ─────────────────────────────────────────────────────
const filteredRawData = useMemo(() => {
    return allRawData.filter(r => {
      const t = r.AccountType ?? r.accountType ?? "";
      if (t !== "C/F" && t !== "CFS") return false;
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role === "Group") return true;
      return rowMatchesDimMulti(r, upDimGroups, upDimensions);
    });
  }, [allRawData, upDimGroups, upDimensions]);

const consolidatedPivot = useMemo(() => {
    const m = new Map();
    filteredRawData.forEach(r => {
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      const role = r.CompanyRole ?? r.companyRole ?? "";
      const key = role === "Group" ? topParent : (r.CompanyShortName ?? "");
      if (!c[key]) c[key] = [];
      c[key].push(r);
    });
    return m;
  }, [filteredRawData, topParent]);

const cmpConsolidatedPivot = useMemo(() => {
    const m = new Map();
    cmpRawData.forEach(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Group" && !rowMatchesDimMulti(r, cmpUpDimGroups, cmpUpDimensions)) return;
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      const key = role === "Group" ? topParent : (r.CompanyShortName ?? "");
      if (!c[key]) c[key] = [];
      c[key].push(r);
    });
    return m;
  }, [cmpRawData, topParent, cmpUpDimGroups, cmpUpDimensions]);

const accountMap = useMemo(() => {
    const m = new Map();
    filteredRawData.forEach(r => {
      if (!m.has(r.AccountCode)) {
        m.set(r.AccountCode, {
          AccountCode: r.AccountCode, AccountName: r.AccountName,
          AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
        });
      }
    });
    return m;
}, [filteredRawData]);

  const tree = useMemo(() => buildTree([...accountMap.values()], cfSort), [accountMap]);

const { elimPivot, elimHeaders } = useMemo(() => {
    // Cross-reference with known CF account codes instead of relying on
    // AccountType being populated in journal entries (it often isn't)
    const cfAccountCodes = new Set([...accountMap.keys()]);
    const groupJournals = journalData.filter(r =>
      r.CompanyShortName === topParent &&
      cfAccountCodes.has(String(r.AccountCode ?? ""))
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
  }, [journalData, rawData, topParent]);

  const toggleExpand = code => setExpanded(prev => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next;
  });

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
  const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: MONTHS.find(x => x.value === m)?.label ?? String(m) }));

  const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;

  const hasData = rawData.length > 0;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
<style>{`
        .cf-scroll-outer { position: relative; overflow: hidden; }
        .cf-scroll { overflow: auto; height: 100%; scrollbar-width: none; -ms-overflow-style: none; }
        .cf-scroll::-webkit-scrollbar { display: none; }
        .cf-scroll thead { background: rgba(255,255,255,0.95); }
        .cf-scroll thead th { border-color: transparent !important; box-shadow: none !important; }
@keyframes cfRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes cmpColIn { 0% { opacity:0; transform:scaleX(0.4) translateX(-12px); } 60% { opacity:1; } 100% { opacity:1; transform:scaleX(1) translateX(0); } }
       @keyframes cmpColOut { 0% { opacity:1; } 100% { opacity:0; } }
.cmp-col { transition: opacity 180ms ease, min-width 180ms ease, max-width 180ms ease, padding 180ms ease; min-width: fit-content; }
        .cmp-col-hidden { opacity:0 !important; min-width:0 !important; max-width:0 !important; padding-left:0 !important; padding-right:0 !important; overflow:hidden !important; }
@keyframes pctColOut { 0% { opacity:1; } 60% { opacity:0; } 100% { opacity:0; } }
        @keyframes pctColIn  { 0% { opacity:0; transform:scaleX(0.2); } 100% { opacity:1; transform:scaleX(1); } }
        @keyframes cmpBarIn { 0% { opacity:0; max-height:0; padding-top:0; padding-bottom:0; margin-bottom:0; } 100% { opacity:1; max-height:80px; padding-top:12px; padding-bottom:12px; } }
       @keyframes cmpBarOut { 0% { opacity:1; max-height:80px; } 100% { opacity:0; max-height:0; padding-top:0; padding-bottom:0; } }
.cf-breaker-row { background-color: var(--breaker-color); }
        .cf-breaker-row td { background-color: var(--breaker-color) !important; }
      `}</style>

<PageHeader
        kicker="Reports"
        title="Cash Flow"
        filters={[
          ...(sources.length > 0
            ? [{ label: "Source", value: source, onChange: setSource,
                options: sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s })) }]
            : []),
          ...(availableYears.length > 0
            ? [{ label: "Year", value: year, onChange: setYear, options: availableYears }]
            : []),
          ...(availableMonths.length > 0
            ? [{ label: "Month", value: month, onChange: setMonth, options: availableMonths }]
            : []),
          ...(structures.length > 0
            ? [{ label: "Structure", value: structure, onChange: setStructure,
                options: structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s })) }]
            : []),
...(holdingOptions.length > 1
            ? [{ label: "Perspective", value: topParent, onChange: setPerspectiveCompany, options: holdingOptions }]
            : []),
          ...(contributionCompanies.length > 0
            ? [{
                label: "Companies",
                multiselect: true,
                values: selectedCompanies.length === 0 ? null : selectedCompanies,
                onChange: v => setSelectedCompanies(v ?? []),
                options: contributionCompanies.map(c => ({
                  value: c,
                  label: companies.find(co => co.CompanyShortName === c)?.CompanyLegalName ?? c,
                })),
}]
            : []),
          ...(dimGroups.length > 0
            ? [{ label: "Dim Group", multiselect: true, values: upDimGroups,
                onChange: vs => { setUpDimGroups(vs); setUpDimensions(null); },
                options: dimGroups.map(g => ({ value: g, label: g })) }]
            : []),
          ...(filteredDims.length > 0
            ? [{ label: "Dims", multiselect: true, values: upDimensions,
                onChange: setUpDimensions,
                options: filteredDims.map(d => ({ value: d.code, label: dimNameMap.get(d.code) ?? d.code })) }]
            : []),
        ]}
        compareToggle={{
          active: compareMode,
          onChange: (newVal) => {
            if (newVal && !compareMode) {
              setCmpYear(year); setCmpMonth(month);
              setCmpSource(source); setCmpStructure(structure);
            }
            setCompareMode(newVal);
          },
        }}
        fabActions={[

          {
            id: "export",
            icon: Download,
            label: "Export",
            subActions: [
              {
                id: "excel",
                label: "Excel",
                src: "https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png",
                alt: "Excel",
                onClick: () => {},
              },
              {
                id: "pdf",
                label: "PDF",
                src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png",
                alt: "PDF",
                onClick: () => {},
              },
            ],
          },
        ]}
      />



{cmpVisible && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0"
          style={{ overflow: "visible", position: "relative", zIndex: 45, animation: cmpExiting ? "cmpBarOut 350ms ease both" : "cmpBarIn 400ms cubic-bezier(0.34,1.56,0.64,1) both" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Compare with</span>
          </div>
<HeaderFilterPill label="Source"    value={cmpSource}    onChange={setCmpSource}
            options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          <HeaderFilterPill label="Year"      value={cmpYear}      onChange={setCmpYear}
            options={availableYears} />
          <HeaderFilterPill label="Month"     value={cmpMonth}     onChange={setCmpMonth}
            options={availableMonths} />
          <HeaderFilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure}
            options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))} />
          {cmpDimGroups.length > 0 && (
            <MultiFilterPill label="Dim Group" values={cmpUpDimGroups}
              onChange={vs => { setCmpUpDimGroups(vs); setCmpUpDimensions(null); }}
              options={cmpDimGroups.map(g => ({ value: g, label: g }))} />
          )}
          {cmpFilteredDims.length > 0 && (
            <MultiFilterPill label="Dims" values={cmpUpDimensions}
              onChange={setCmpUpDimensions}
              options={cmpFilteredDims.map(d => ({ value: d.code, label: cmpDimNameMap.get(d.code) ?? d.code }))} />
          )}
          {cmpLoading && <Loader2 size={11} className="animate-spin ml-2" style={{ color: "#CF305D" }} />}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
{loading ? (
            <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
              style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
              <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
                style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
                <div className="relative" style={{ width: 140, height: 140 }}>
                  <svg width="140" height="140" viewBox="0 0 140 140">
                    <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                    <circle cx="70" cy="70" r="60" fill="none"
                      stroke="url(#cfConsGrad)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 60}
                      strokeDashoffset={2 * Math.PI * 60 * (1 - animatedProgress / 100)}
                      style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
                    />
                    <defs>
                      <linearGradient id="cfConsGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                        <stop offset="100%" stopColor="#CF305D" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
                      {Math.round(animatedProgress)}<span className="text-base text-gray-300">%</span>
                    </span>
                  </div>
                </div>
                <p className="text-sm font-black text-gray-800 mt-6 tracking-wide">Building cash flow…</p>
                <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">Consolidated · Cash Flow</p>
              </div>
            </div>
          ) : !hasData ? (
            <div className="flex items-center justify-center flex-1 text-xs text-gray-300 font-black uppercase tracking-widest">
              No data for selected filters
            </div>
          ) : (
            <div className="cf-scroll-outer flex-1 min-h-0" style={{ minWidth: 0 }}>
              <div className="cf-scroll" style={{ minWidth: 0 }}>
                <table className="text-xs border-collapse" style={{ borderSpacing: 0, width: "max-content", minWidth: "100%", tableLayout: "auto" }}>
<thead className="sticky top-0 z-30">
<tr style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
                      <th className="sticky left-0 z-40 text-left px-6" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: "64px", minWidth: 220, width: 220 }}>
                        <div className="flex items-center gap-3">
                          <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>Account</span>
                          <button
                            onClick={() => { if (expanded.size > 0) setExpanded(new Set()); else setExpanded(new Set([...accountMap.keys()])); }}
                            className="flex items-center justify-center"
                            style={{ background: "#fff", color: colors.primary, width: 28, height: 28, borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.10), 0 0 0 1px rgba(26,47,138,0.06)" }}>
                            <span style={{ display: "inline-flex", transition: "transform 320ms cubic-bezier(0.34,1.56,0.64,1)", transform: expanded.size > 0 ? "rotate(180deg)" : "rotate(0deg)" }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                {expanded.size > 0 ? <path d="M18 6L6 18M6 6l12 12"/> : <><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></>}
                              </svg>
                            </span>
                          </button>
                        </div>
                      </th>

                      <th className="text-center px-4" style={{ background: "rgba(255,255,255,0.95)", borderLeft: "2px solid #f0f0f0", minWidth: 130 }}>
                        <div className="flex flex-col items-center gap-0.5 py-4">
                          <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{topParent || "Total"}</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{isRootView ? "Consolidated" : "Subgroup"}</span>
                        </div>
                      </th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}08`, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>CMP</span></th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}12`, minWidth: 100, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ AMT</span></th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}1e`, minWidth: 80, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ %</span></th>

                      <th className="text-center px-4 cursor-pointer select-none" style={{ background: "rgba(255,255,255,0.95)", borderLeft: "2px solid #f0f0f0", minWidth: 110 }}
                        onClick={() => setElimExpanded(e => !e)}>
                        <div className="flex flex-col items-center gap-0.5 py-4">
                          <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>Elim. {elimExpanded ? "▾" : "▸"}</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>Interco</span>
                        </div>
                      </th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}12`, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>CMP</span></th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}12`, minWidth: 100, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ AMT</span></th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}1e`, minWidth: 80, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ %</span></th>
                      {elimExpanded && elimHeaders.map(h => ( 
                        <th key={`elim-head-${h}`} className="text-center px-3" style={{ background: `${colors.primary}06`, borderLeft: "1px solid #e5e7eb", minWidth: 140 }}>
                          <span className="font-black" style={{ color: colors.primary, fontSize: 11 }} title={h}>{h}</span>
                        </th>
                      ))}
<th className="text-center px-4 cursor-pointer select-none" style={{ background: "rgba(255,255,255,0.95)", borderLeft: "2px solid #f0f0f0", minWidth: 110 }}
                       onClick={() => {
                          if (pctExpanded) {
setPctExiting(true);
            setTimeout(() => { setPctExpanded(false); setPctExiting(false); }, 200);
                          } else {
                            setPctExiting(false);
                            setPctExpanded(true);
                          }
                        }}>
                        <div className="flex flex-col items-center gap-0.5 py-4">
                          <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>Contribution {pctExpanded ? "▾" : "▸"}</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>Sum</span>
                        </div>
                      </th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}1e`, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>CMP</span></th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}12`, minWidth: 100, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ AMT</span></th>
<th className={`cmp-col${!compareMode && !cmpExiting ? " cmp-col-hidden" : ""}`} style={{ background: `${colors.primary}1e`, minWidth: 80, textAlign: "center" }}><span style={{ display: "inline-block", padding: "0 12px", fontWeight: 900, color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ %</span></th>

{orderedEffectiveCompanies.map(c => (
                        <React.Fragment key={c}>
                          <th className="text-center px-4 select-none"
                            draggable
                            onDragStart={() => setDraggingCol(c)}
                            onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
                            onDragLeave={() => setDragOverCol(null)}
onDrop={e => {
                              e.preventDefault();
                              if (!draggingCol || draggingCol === c) { setDraggingCol(null); setDragOverCol(null); return; }
                              const cols = [...orderedEffectiveCompanies];
                              const from = cols.indexOf(draggingCol);
                              const to = cols.indexOf(c);
                              if (from === -1 || to === -1) { setDraggingCol(null); setDragOverCol(null); return; }
                              const next = [...cols]; next.splice(from, 1); next.splice(to, 0, draggingCol);
                              setColOrder(next); setDraggingCol(null); setDragOverCol(null);
                            }}
                            onDragEnd={() => { setDraggingCol(null); setDragOverCol(null); }}
                            style={{
                              background: dragOverCol === c ? `${colors.primary}15` : "rgba(255,255,255,0.95)",
                              borderLeft: "1px solid #f0f0f0", minWidth: 130, cursor: "grab",
                              outline: dragOverCol === c ? `2px solid ${colors.primary}` : "none",
                              opacity: draggingCol === c ? 0.4 : 1,
                            }}>
                            <div className="flex flex-col items-center gap-0.5 py-4">
                              <span className="font-black tracking-tight truncate max-w-[140px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} title={getLegal(c)}>{getLegal(c)}</span>
                              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{displayCurrency || "—"}</span>
                            </div>
                          </th>
{(pctExpanded || pctExiting) && <th style={{
                              background: `${colors.primary}06`,
                              borderLeft: pctExiting ? "none" : "1px dashed #e5e7eb",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textAlign: "center",
                              animation: pctExiting
                                ? "pctColOut 180ms ease both"
                                : "pctColIn 380ms cubic-bezier(0.34,1.56,0.64,1) both",
                            }}>
                            <span style={{ display: "inline-block", padding: "0 8px", fontWeight: 900, color: `${colors.primary}80`, fontSize: 11 }}>%</span>
                          </th>}
{compareMode && <>
                            <th className="text-center px-3" style={{ background: `${colors.primary}08`, minWidth: 90 }}><span className="font-black" style={{ color: "#CF305D", fontSize: 11, opacity: 0.8 }}>CMP</span></th>
                            <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 100 }}><span className="font-black" style={{ color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ AMT</span></th>
                            <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80 }}><span className="font-black" style={{ color: "#CF305D", fontSize: 11, opacity: 0.8 }}>Δ %</span></th>
                          </>}
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {(() => {
                      if (!activeCfMapping?.rows) {
return tree.map((node, ri) => (
<SheetRow key={node.AccountCode} node={node} depth={0}
                            expanded={expanded} onToggle={toggleExpand}
                            pivot={consolidatedPivot} elimPivot={elimPivot}
                            contributionCompanies={orderedEffectiveCompanies}
                            allContributionCompanies={contributionCompanies}
                            topParent={topParent}
                            elimExpanded={elimExpanded} elimHeaders={elimHeaders}
pctExpanded={pctExpanded}
                            pctExiting={pctExiting}
                            compareMode={compareMode} cmpPivot={cmpConsolidatedPivot}
                            body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                            colors={colors} rowIndex={ri} />
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
                        const byCo = consolidatedPivot.get(node.AccountCode) || {};
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
const activeCmp = compareMode || cmpExiting;
                      const totalColsCons =
                        1
                        + (1 + (activeCmp ? 3 : 0)
                          + 1 + (activeCmp ? 3 : 0)
                          + (elimExpanded ? elimHeaders.length : 0)
                          + 1 + (activeCmp ? 3 : 0))
                        + orderedEffectiveCompanies.length * (activeCmp ? 5 : (pctExpanded || pctExiting ? 2 : 1));
                      const rowsOut = [];
                      ordered.forEach(({ node, info }) => {
                        if (!seenSections.has(info.section)) {
                          seenSections.add(info.section);
                          const sec = activeCfMapping.sections.get(info.section);
                          if (sec) {
rowsOut.push(
<tr key={`section-${info.section}`}
                                style={{ '--breaker-color': sec.color, animation: `cfRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowsOut.length, 25) * 35 + 50}ms both`, backgroundColor: sec.color }}>
                                <td className="sticky left-0 z-10" style={{ backgroundColor: sec.color, color: "#fff", padding: "8px 16px", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                                  {sec.label}
                                </td>
                                <td colSpan={9999} style={{ backgroundColor: sec.color }} />
                              </tr>
                            );
                          }
                        }
rowsOut.push(
                         <SheetRow key={node.AccountCode} node={node} depth={0}
                            expanded={expanded} onToggle={toggleExpand}
                            pivot={consolidatedPivot} elimPivot={elimPivot}
                            contributionCompanies={orderedEffectiveCompanies}
                            allContributionCompanies={contributionCompanies}
                            topParent={topParent}
                            elimExpanded={elimExpanded} elimHeaders={elimHeaders}
pctExpanded={pctExpanded}
                            pctExiting={pctExiting}
                            compareMode={compareMode} cmpPivot={cmpConsolidatedPivot}
                            body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                            colors={colors} rowIndex={rowsOut.length} />
                        );
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