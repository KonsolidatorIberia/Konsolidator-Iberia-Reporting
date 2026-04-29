import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
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

// ── SheetRow ──────────────────────────────────────────────────────────────────
// Because data is fetched per-perspective (see the main fetch effect), every
// row's ReportingAmountYTD is already in the perspective's currency. No
// branching on "is root?" is needed — consolidation total is always the Group
// role (for whatever the selected consolidation is), and column values are
// always Parent for the perspective itself and Contribution for its children.
function SheetRow({
  node, depth, expanded, onToggle,
  pivot, uploadedPivot, elimPivot,
  contributionCompanies, topParent,
  elimExpanded, elimHeaders,
  compareMode, cmpPivot,
  body1Style, body2Style, subbody1Style,
}) {
const hasChildren = node.children?.length > 0;
  const isExpanded  = expanded.has(node.AccountCode);
  const isSummary   = /\.S$/i.test(node.AccountCode) || hasChildren;

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
    return [
      <td key={`${key}-cmp`}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 110, backgroundColor: "#fffbf0", borderLeft: "2px solid rgba(251,191,36,0.25)", ...rowStyle, color: baseColor }}>
        {fmt(compare)}
      </td>,
      <td key={`${key}-delta`}
        className="px-3 py-2.5 text-center whitespace-nowrap"
        style={{ minWidth: 130, backgroundColor: "#fffbf0", borderRight: "2px solid rgba(251,191,36,0.25)", ...rowStyle, color: deltaColor }}>
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
<span className="flex-shrink-0 mr-2" style={rowStyle}>
  {node.AccountCode}
</span>
<span className="truncate" style={{ ...rowStyle, maxWidth: 160 }}>
  {node.AccountName}
</span>
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
      style={{
        minWidth: 140,
        backgroundColor: "#f8f9ff",
        ...cellStyle(subVal),
      }}>
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
    pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
    contributionCompanies={contributionCompanies}
    topParent={topParent}
    elimExpanded={elimExpanded} elimHeaders={elimHeaders}
    compareMode={compareMode} cmpPivot={cmpPivot}
    body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} />
))}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConsolidationSheetPage({ token }) {
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

const [compareMode, setCompareMode] = useState(false);
const [cmpYear,      setCmpYear]      = useState("");
const [cmpMonth,     setCmpMonth]     = useState("");
const [cmpSource,    setCmpSource]    = useState("");
const [cmpStructure, setCmpStructure] = useState("");
const [cmpRawData,   setCmpRawData]   = useState([]);
const [cmpLoading,   setCmpLoading]   = useState(false);

  const autoPeriodDone = useRef(false);

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
          if ((d.value ?? []).length > 0) {
            setYear(String(probeY));
            setMonth(String(probeM));
            return;
          }
        } catch { break; }
        probeM -= 1;
        if (probeM < 1) { probeM = 12; probeY -= 1; }
      }
    })();
  }, [token, metaReady, source, structure, year, month]);

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
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setRawData([]);
    setUploadedData([]);
    setJournalData([]);
    setExpanded(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
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
        // ═══════════════ DIAGNOSTIC LOGS — remove after debugging ═══════════════
        console.group(`🔍 Fetched for perspective = ${topParent}`);
        console.log("Row count:", cons.length);
        if (cons.length > 0) {
          console.log("All keys on a row:", Object.keys(cons[0]).sort());
          console.log("Sample row:", cons[0]);
          const groups = [...new Set(cons.map(r => r.GroupShortName ?? r.groupShortName))];
          console.log("GroupShortName(s) returned:", groups, "| expected:", topParent);
          const a01 = cons.filter(r => r.AccountCode === "A.01");
          console.log(`A.01 rows (${a01.length}):`);
          a01.forEach(r => {
            const amountFields = {};
            Object.keys(r).filter(k => /amount|ytd/i.test(k)).forEach(k => { amountFields[k] = r[k]; });
            console.log(`  ${r.CompanyShortName} [${r.CompanyRole}]:`, amountFields);
          });
          const mine = cons.filter(r => ["MARROC", "DEUTCH"].includes(r.CompanyShortName));
          const summary = {};
          mine.forEach(r => {
            const key = `${r.CompanyShortName}/${r.CompanyRole}`;
            summary[key] = (summary[key] ?? 0) + 1;
          });
          console.log("MARROC/DEUTCH row counts by role:", summary);
        }
        const runs = consolidations
          .filter(c => String(c.Year ?? c.year) === year && String(c.Month ?? c.month) === month)
          .map(c => c.GroupShortName ?? c.groupShortName);
        console.log("Consolidation runs for this period:", runs);
        console.groupEnd();
        // ═══════════════════════════════════════════════════════════════════════

        setRawData(cons);
        setUploadedData(uploaded);
        setJournalData(journals);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token, metaReady, year, month, source, structure, topParent]);

  // ── Fetch compare data ────────────────────────────────────────────────────
useEffect(() => {
  if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !topParent) return;
  setCmpLoading(true);
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

  // The Group-role company in these rows is always the selected perspective,
  // because we fetched with GroupShortName=topParent. Keep the read here so
  // elimination filtering stays correct if the data arrives before topParent
  // updates.
  const groupRoleCompany = useMemo(() => {
    return [...new Set(
      rawData.filter(r => r.CompanyRole === "Group").map(r => r.CompanyShortName)
    )][0] || topParent;
  }, [rawData, topParent]);

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

    console.log("=== ELIM HEADERS DEBUG ===");
    console.log("All headers found:", headers);
    console.log("Header abs-sum totals:", headerTotals);
    console.log("Headers kept (abs-sum ≥ 1):", nonEmptyHeaders);
    console.log("=========================");

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

  // Account tree
  const accountMap = new Map();
  rawData.forEach(r => {
    if (!accountMap.has(r.AccountCode)) {
      accountMap.set(r.AccountCode, {
        AccountCode: r.AccountCode, AccountName: r.AccountName,
        AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
      });
    }
  });
  const tree = buildTree([...accountMap.values()]);

  const toggleExpand = code => setExpanded(prev => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next;
  });

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
  const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: MONTHS.find(x => x.value === m)?.label ?? String(m) }));

  const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

{/* ── Header ── */}
      <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: colors.primary }} />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Consolidated</p>
            <h1 className="leading-none" style={header1Style}>Sheet</h1>
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
      options={holdingOptions}
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
            className="flex items-center gap-1 text-[10px] px-3 py-1.5 rounded-2xl transition-all font-bold uppercase tracking-widest"
            style={{
              backgroundColor: compareMode ? colors.primary : `${colors.primary}15`,
              color: compareMode ? "white" : colors.primary,
            }}>
            Compare
          </button>
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export Excel">
            <img src="https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png" width="44" height="36" alt="Excel" />
          </button>
<button className="transition-all hover:opacity-80 hover:scale-105" title="Export PDF">
            <img src="https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png" width="30" height="36" alt="PDF" />
          </button>
        </div>
      </div>

      {/* ── Compare filter row ── */}
      {compareMode && (
        <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: "#FCD34D" }} />
            <p className="text-[10px] font-black uppercase tracking-widest leading-none" style={{ color: "#0c1d55" }}>
              Compare<br/>Period
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
            {cmpLoading && <Loader2 size={13} className="animate-spin text-amber-400 flex-shrink-0" />}
          </div>
        </div>
      )}

      {/* ── Accounts view ── */}
      <div className="flex-1 min-h-0 flex flex-col">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
            {loading ? (
              <div className="flex items-center justify-center flex-1 gap-3">
                <Loader2 size={22} className="animate-spin text-[#1a2f8a]" />
                <p className="text-xs text-gray-400">Building consolidation sheet…</p>
              </div>
            ) : rawData.length === 0 ? (
              <div className="flex items-center justify-center flex-1 text-xs text-gray-300 font-black uppercase tracking-widest">
                No data for selected filters
              </div>
            ) : (
<div className="flex-1 min-h-0" style={{ overflowX: "auto", overflowY: "auto" }}>
                <table className="text-xs border-collapse" style={{ borderSpacing: 0, width: "max-content", minWidth: "100%", tableLayout: "auto" }}>
<thead className="sticky top-0 z-30">
                    {/* ── Row 1: overarching group headers ── */}
                    <tr style={{ backgroundColor: colors.primary }}>
                      <th className="sticky left-0 z-40 border-r border-white/20 text-left px-4 py-3" style={{ minWidth: 220, width: 220, backgroundColor: colors.primary }} rowSpan={2}>
                        <div className="flex items-center justify-between gap-2">
                         <span style={header2Style}>ACCOUNT</span>
                          <button
                            onClick={() => {
                              if (expanded.size > 0) { setExpanded(new Set()); }
                              else { setExpanded(new Set([...accountMap.keys()])); }
                            }}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all font-bold normal-case tracking-normal flex-shrink-0">
                            {expanded.size > 0 ? <Minimize2 size={11}/> : <Maximize2 size={11}/>}
                          </button>
                        </div>
                      </th>
<th colSpan={(2 + (elimExpanded ? elimHeaders.length : 0)) * (compareMode ? 3 : 1)} className="px-4 py-2 text-center border-l border-white/20"
  style={{
    backgroundColor: colors.primary,
    boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)",
  }}>
  <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>
    Consolidation · {getLegal(topParent)}
  </span>
</th>
<th colSpan={(contributionCompanies.length + 1) * (compareMode ? 3 : 1)} className="px-4 py-2 text-center border-l border-white/20"
  style={{
    backgroundColor: colors.primary,
    boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)",
  }}>
  <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>Contribution</span>
</th>
                    </tr>
{/* ── Row 2: individual column headers ── */}
<tr style={{ borderBottom: "2px solid rgba(255,255,255,0.1)" }}>
<th className="px-4 py-2.5 text-center border-l border-white/20" style={{ minWidth: 100, backgroundColor: colors.primary }}>
    <div className="flex flex-col items-center gap-0.5">
      <span style={underscore1Style}>{topParent || "Total"}</span>
      <span style={underscore2Style}>{isRootView ? "Consolidated" : "Subgroup"}</span>
    </div>
  </th>
  {compareMode && (
    <>
      <th className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Compare</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>
      <th className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Δ</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>
    </>
  )}
<th className="px-4 py-2.5 text-center border-l border-white/20 cursor-pointer hover:bg-white/10 transition-colors select-none"
    style={{ minWidth: 100, backgroundColor: colors.primary }}
    onClick={() => setElimExpanded(e => !e)}>
    <div className="flex flex-col items-center gap-0.5">
      <span style={underscore1Style}>
        Eliminations {elimExpanded ? "▾" : "▸"}
      </span>
      <span style={underscore2Style}>&nbsp;</span>
    </div>
  </th>
  {compareMode && (
    <>
      <th className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Compare</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>
      <th className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Δ</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>
    </>
  )}
{elimExpanded && elimHeaders.map((h, idx) => (
    <th key={`elim-head-${h}`}
      className="px-3 py-2.5 text-center border-l border-white/10"
      style={{
        minWidth: 140,
        backgroundColor: colors.primary,
        boxShadow: `inset 0 0 0 9999px rgba(0,0,0,${0.03 * (idx + 1)})`,
      }}>
      <div className="flex flex-col items-center gap-0.5">
        <span style={{ ...underscore1Style, position: "relative", textTransform: "none" }}
          title={h}>
          {h}
        </span>
        <span style={underscore2Style}>&nbsp;</span>
      </div>
    </th>
  ))}
<th className="px-4 py-2.5 text-center border-l border-white/20" style={{ minWidth: 110, backgroundColor: colors.primary }}>
    <div className="flex flex-col items-center gap-0.5">
      <span style={underscore1Style}>Contribution</span>
      <span style={underscore2Style}>Sum</span>
    </div>
  </th>
  {compareMode && (
    <>
      <th className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Compare</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>
      <th className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Δ</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>
    </>
  )}
{contributionCompanies.flatMap(c => [
    <th key={c} className="px-4 py-2.5 text-center border-l border-white/20" style={{ minWidth: 100, backgroundColor: colors.primary }}>
      <div className="flex flex-col items-center gap-0.5">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap max-w-full" style={underscore1Style} title={getLegal(c)}>
          {getLegal(c)}
        </span>
        <span style={underscore2Style}>{displayCurrency}</span>
      </div>
    </th>,
    ...(compareMode ? [
      <th key={`${c}-cmp`} className="px-3 py-2.5 text-center" style={{ minWidth: 110, backgroundColor: "#0c1d55", borderLeft: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Compare</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>,
      <th key={`${c}-delta`} className="px-3 py-2.5 text-center" style={{ minWidth: 130, backgroundColor: "#0c1d55", borderRight: "2px solid rgba(251,191,36,0.35)" }}>
        <div className="flex flex-col items-center gap-0.5">
          <span style={{ ...underscore1Style, color: "#Ffffff" }}>Δ</span>
          <span style={underscore2Style}>&nbsp;</span>
        </div>
      </th>,
    ] : []),
  ])}
</tr>

                  </thead>
                  <tbody>
{tree.map(node => (
  <SheetRow key={node.AccountCode} node={node} depth={0}
    expanded={expanded} onToggle={toggleExpand}
    pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
    contributionCompanies={contributionCompanies}
    topParent={topParent}
    elimExpanded={elimExpanded} elimHeaders={elimHeaders}
    compareMode={compareMode} cmpPivot={cmpPivot}
    body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} />
))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
</div>
      </div>
  );
}