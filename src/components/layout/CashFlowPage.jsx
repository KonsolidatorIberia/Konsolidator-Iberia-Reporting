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

/* ─── SheetRow (consolidated only) ──────────────────────────────────────── */
function SheetRow({
  node, depth, expanded, onToggle,
  pivot, elimPivot,
  contributionCompanies, topParent,
  elimExpanded, elimHeaders,
  compareMode, cmpPivot,
  body1Style, body2Style, subbody1Style,
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

  const consTotal = (byCompany[topParent] ?? [])
    .filter(r => r.CompanyRole === "Group")
    .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
    .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);

  const elimTotal = consTotal - contribSum;

  const cmpByCompany = cmpPivot?.get(node.AccountCode) || {};
  const cmpGetContrib = (company) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return (cmpByCompany[company] ?? [])
      .filter(r => r.CompanyRole === role)
      .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
  };
  const cmpContribSum = contributionCompanies.reduce((s, c) => s + cmpGetContrib(c), 0);
  const cmpConsTotal = (cmpByCompany[topParent] ?? [])
    .filter(r => r.CompanyRole === "Group")
    .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
    .reduce((s, r) => s + (Number(r.AmountYTD ?? 0)), 0);
  const cmpElimTotal = cmpConsTotal - cmpContribSum;

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

        <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
          style={{ minWidth: 130, ...cellStyle(consTotal) }}>
          {fmt(consTotal)}
        </td>
        {compareMode && renderCompareCells(consTotal, cmpConsTotal, "cons")}

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

        <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200"
          style={{ minWidth: 110, ...cellStyle(contribSum) }}>
          {fmt(contribSum)}
        </td>
        {compareMode && renderCompareCells(contribSum, cmpContribSum, "contribsum")}

        {contributionCompanies.flatMap(c => {
          const val = getContrib(c);
          const cmpVal = cmpGetContrib(c);
          const magnitudeTotal = contributionCompanies.reduce((s, co) => s + Math.abs(getContrib(co)), 0);
          const showPct = magnitudeTotal !== 0 && val !== 0;
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
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} />
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

  const [rawData,      setRawData]      = useState([]);
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
  const [cmpRawData] = useState([]);
  const [cmpLoading] = useState(false);

  const autoPeriodDone = useRef(false);

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
  useEffect(() => {
    if (autoPeriodDone.current) return;
    if (!token || !source || !structure || !metaReady || !year || !month) return;
    autoPeriodDone.current = true;
    let cancelled = false;
    (async () => {
      let probeY = parseInt(year), probeM = parseInt(month);
      for (let i = 0; i < 24; i++) {
        if (cancelled) break;
        const filter = `Year eq ${probeY} and Month eq ${probeM} and Source eq '${source}' and GroupStructure eq '${structure}'`;
        try {
          const res = await fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const d = await res.json();
          if ((d.value ?? []).length > 0) {
            if (!cancelled) { setYear(String(probeY)); setMonth(String(probeM)); }
            return;
          }
        } catch { break; }
        probeM -= 1;
        if (probeM < 1) { probeM = 12; probeY -= 1; }
      }
    })();
    return () => { cancelled = true; };
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

  // ─── Fetch consolidated data ────────────────────────────────────
  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure || !topParent) return;
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
      setJournalData(journals);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [token, metaReady, year, month, source, structure, topParent]);

  // ─── Pivots ─────────────────────────────────────────────────────
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

  const accountMap = useMemo(() => {
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
  }, [rawData]);

  const tree = useMemo(() => buildTree([...accountMap.values()], cfSort), [accountMap]);

  const { elimPivot, elimHeaders } = useMemo(() => {
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
        .cf-scroll {
          overflow: auto; height: 100%;
          scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9;
        }
        .cf-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .cf-scroll::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 5px; }
        .cf-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
        .cf-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
        .cf-scroll thead { background: ${colors.primary}; }
        .cf-scroll thead th { border-color: transparent !important; }
        .cf-scroll thead th + th { box-shadow: inset 1px 0 0 rgba(255,255,255,0.25); }
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
          {holdingOptions.length > 1 && (
            <FilterPill label="Perspective" value={topParent} onChange={setPerspectiveCompany}
              options={holdingOptions} filterStyle={filterStyle} colors={colors} />
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
                      <th className="sticky left-0 z-40 text-left px-4 py-3"
                        style={{ minWidth: 220, width: 220, backgroundColor: colors.primary, boxShadow: "inset -1px 0 0 rgba(255,255,255,0.25)" }} rowSpan={2}>
                        <div className="flex items-center justify-between gap-2">
                          <span style={header2Style}>ACCOUNT</span>
                          <button
                            onClick={() => {
                              if (expanded.size > 0) setExpanded(new Set());
                              else setExpanded(new Set([...accountMap.keys()]));
                            }}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all font-bold normal-case tracking-normal flex-shrink-0">
                            {expanded.size > 0 ? <Minimize2 size={11}/> : <Maximize2 size={11}/>}
                          </button>
                        </div>
                      </th>

                      <th colSpan={(2 + (elimExpanded ? elimHeaders.length : 0)) * (compareMode ? 3 : 1)}
                        className="px-4 py-2 text-center"
                        style={{ backgroundColor: colors.primary, boxShadow: "inset 1px 0 0 rgba(255,255,255,0.25), inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                        <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>
                          Cash Flow · {getLegal(topParent)}
                        </span>
                      </th>
                      <th colSpan={(contributionCompanies.length + 1) * (compareMode ? 3 : 1)}
                        className="px-4 py-2 text-center"
                        style={{ backgroundColor: colors.primary, boxShadow: "inset 1px 0 0 rgba(255,255,255,0.25), inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                        <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>Contribution</span>
                      </th>
                    </tr>

                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      <th className="px-4 py-2.5 text-center" style={{ minWidth: 100, backgroundColor: colors.primary }}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span style={underscore1Style}>{topParent || "Total"}</span>
                          <span style={underscore2Style}>{isRootView ? "Consolidated" : "Subgroup"}</span>
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

                      <th className="px-4 py-2.5 text-center cursor-pointer hover:bg-white/10 transition-colors select-none"
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

                      <th className="px-4 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: colors.primary }}>
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

                      {contributionCompanies.flatMap(c => {
                        const colCcy = displayCurrency || "—";
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
                      if (!activeCfMapping?.rows) {
                        return tree.map(node => (
                          <SheetRow key={node.AccountCode} node={node} depth={0}
                            expanded={expanded} onToggle={toggleExpand}
                            pivot={consolidatedPivot} elimPivot={elimPivot}
                            contributionCompanies={contributionCompanies}
                            topParent={topParent}
                            elimExpanded={elimExpanded} elimHeaders={elimHeaders}
                            compareMode={compareMode} cmpPivot={cmpConsolidatedPivot}
                            body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} />
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
                            pivot={consolidatedPivot} elimPivot={elimPivot}
                            contributionCompanies={contributionCompanies}
                            topParent={topParent}
                            elimExpanded={elimExpanded} elimHeaders={elimHeaders}
                            compareMode={compareMode} cmpPivot={cmpConsolidatedPivot}
                            body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} />
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