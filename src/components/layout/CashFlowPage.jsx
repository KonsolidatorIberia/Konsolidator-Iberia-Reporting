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

  const rowStyle = !hasChildren ? subbody1Style : (depth === 0 ? body1Style : body2Style);
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
          return [
            <td key={c}
              className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
              style={{ minWidth: 120, ...cellStyle(val) }}>
              {fmt(val)}
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
  // CF account name dictionary — populated from consolidated-accounts the
  // first time we have any CF data, and reused across modes / periods.
  const [cfNameDict, setCfNameDict] = useState({});

  const [mode,               setMode]               = useState("consolidated");
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
    ]).then(([p, s, st, co, cons, gs, cf]) => {
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      setCfMapping(Array.isArray(cf) ? cf : []);
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
        // Prefer the dict (full name from consolidated-accounts) over the
        // mapping name (sometimes terser).
        const name = cfNameDict[code] || mappingName || code;
        map.set(code, { AccountCode: code, AccountName: name, SumAccountCode: sum });
      }
    });

    // Synthesise virtual subtotal nodes for every parent referenced by a
    // child but never present as its own row. Walk repeatedly because
    // virtuals themselves may roll up into higher virtuals.
    let added = true;
    while (added) {
      added = false;
      for (const node of [...map.values()]) {
        const parent = node.SumAccountCode;
        if (parent && !map.has(parent)) {
          const parentName = cfNameDict[parent] || parent;
          map.set(parent, { AccountCode: parent, AccountName: parentName, SumAccountCode: "" });
          added = true;
        }
      }
    }
    console.log("[CF cfAccountMap] dict size:", Object.keys(cfNameDict).length, "map size:", map.size);
    return map;
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

  const buildIndividualPivot = (rows) => {
    if (!rows.length || !cfAccountMap.size) return new Map();
    const pivot = new Map();
    const tree = buildTree([...cfAccountMap.values()], cfSort);
    rows.forEach(r => {
      const ga = r.AccountCode ?? r.accountCode ?? "";
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!ga || !co) return;
      const cfs = groupToCf.get(ga);
      if (!cfs) return;
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD);
      cfs.forEach(cfCode => {
        if (!pivot.has(cfCode)) pivot.set(cfCode, {});
        const c = pivot.get(cfCode);
        if (!c[co]) c[co] = [];
        c[co].push({ _cfAmount: amt, _src: r });
      });
    });
    const accumulate = (node) => {
      (node.children || []).forEach(child => {
        accumulate(child);
        const childPiv = pivot.get(child.AccountCode) ?? {};
        if (!pivot.has(node.AccountCode)) pivot.set(node.AccountCode, {});
        const parentPiv = pivot.get(node.AccountCode);
        Object.entries(childPiv).forEach(([co, rs]) => {
          if (!parentPiv[co]) parentPiv[co] = [];
          const sum = rs.reduce((s, r) => s + (r._cfAmount ?? 0), 0);
          parentPiv[co].push({ _cfAmount: sum, _src: null });
        });
      });
    };
    tree.forEach(accumulate);
    return pivot;
  };

  const individualPivot    = useMemo(() => buildIndividualPivot(uploadedData), [uploadedData, cfAccountMap, groupToCf]);
  const cmpIndividualPivot = useMemo(() => buildIndividualPivot(cmpUploaded),  [cmpUploaded,  cfAccountMap, groupToCf]);

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
          padding-right: 16px; margin-right: -16px;
          scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9;
        }
        .cf-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .cf-scroll::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 5px; }
        .cf-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
        .cf-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
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
          onSelect={(k) => { setMode(k); setExpanded(new Set()); }}
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
                <table className="text-xs border-collapse" style={{ borderSpacing: 0, width: "max-content", minWidth: "100%", tableLayout: "auto" }}>
                  <thead className="sticky top-0 z-30">
                    <tr style={{ backgroundColor: colors.primary }}>
                      <th className="sticky left-0 z-40 border-r border-white/20 text-left px-4 py-3"
                        style={{ minWidth: 220, width: 220, backgroundColor: colors.primary }} rowSpan={2}>
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

{mode === "consolidated" ? (
                        <>
                          <th colSpan={(2 + (elimExpanded ? elimHeaders.length : 0)) * (compareMode ? 3 : 1)}
                            className="px-4 py-2 text-center border-l border-white/20"
                            style={{ backgroundColor: colors.primary, boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                            <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>
                              Cash Flow · {getLegal(topParent)}
                            </span>
                          </th>
                          <th colSpan={(contributionCompanies.length + 1) * (compareMode ? 3 : 1)}
                            className="px-4 py-2 text-center border-l border-white/20"
                            style={{ backgroundColor: colors.primary, boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                            <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>Contribution</span>
                          </th>
                        </>
                      ) : (
                        <th colSpan={contributionCompanies.length * (compareMode ? 3 : 1)}
                          className="px-4 py-2 text-center border-l border-white/20"
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
                          <th className="px-4 py-2.5 text-center border-l border-white/20"
                            style={{ minWidth: 100, backgroundColor: colors.primary }}>
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
                              className="px-3 py-2.5 text-center border-l border-white/10"
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

                      {contributionCompanies.flatMap(c => {
                        // In Consolidated mode every amount is in the perspective's
                        // reporting currency. In Individual mode each company is
                        // shown in its OWN local currency.
                        const colCcy = mode === "consolidated"
                          ? (displayCurrency || "—")
                          : (companies.find(x => x.CompanyShortName === c)?.CurrencyCode || "—");
                        return [
                        <th key={c} className="px-4 py-2.5 text-center border-l border-white/20"
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
                    {tree.map(node => (
                      <SheetRow key={node.AccountCode} node={node} depth={0}
                        expanded={expanded} onToggle={toggleExpand}
                        pivot={pivot} elimPivot={elimPivot}
                        contributionCompanies={contributionCompanies}
                        topParent={topParent}
                        elimExpanded={elimExpanded} elimHeaders={elimHeaders}
                        compareMode={compareMode} cmpPivot={cmpPivot}
                        body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                        mode={mode} />
                    ))}
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