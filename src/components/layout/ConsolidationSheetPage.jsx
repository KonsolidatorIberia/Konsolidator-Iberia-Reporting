import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";

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
function FilterPill({ label, value, onChange, options }) {
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
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border text-xs font-bold transition-all select-none bg-white border-[#c2c2c2] text-[#505050] shadow-xl hover:border-[#1a2f8a]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
        <span className="text-[#1a2f8a]">{display}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 text-[#1a2f8a]/40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {options.map(o => (
              <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
                  ${String(o.value) === String(value) ? "bg-[#1a2f8a] text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}>
                {o.label}
                {String(o.value) === String(value) && <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
              </button>
            ))}
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
}) {
  const hasChildren = node.children?.length > 0;
  const isExpanded  = expanded.has(node.AccountCode);
  const isSummary   = /\.S$/i.test(node.AccountCode) || hasChildren;

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
            <span className={`font-mono text-[11px] flex-shrink-0 ${isSummary ? "text-[#1a2f8a]" : "text-gray-400"}`}>
              {node.AccountCode}
            </span>
            <span className={`text-xs ml-1.5 truncate ${isSummary ? "font-black text-[#1a2f8a]" : "text-gray-700 font-medium"}`} style={{ maxWidth: 160 }}>
              {node.AccountName}
            </span>
          </div>
        </td>

        <td className={`px-4 py-2.5 text-right font-mono text-xs border-l border-gray-100
          ${isSummary ? "font-black" : ""}
          ${consTotal === 0 ? "text-gray-300" : consTotal > 0 ? "text-[#1a2f8a]" : "text-[#e8394a]"}`}
          style={{ minWidth: 130 }}>
          {fmt(consTotal)}
        </td>

        <td className={`px-4 py-2.5 text-right font-mono text-xs border-l border-gray-100
          ${isSummary ? "font-black" : ""}
          ${elimTotal === 0 ? "text-gray-300" : "text-amber-600"}`}
          style={{ minWidth: 110 }}>
          {fmt(elimTotal)}
        </td>

        <td className={`px-4 py-2.5 text-right font-mono text-xs border-l border-gray-200
          ${isSummary ? "font-black" : ""}
          ${contribSum === 0 ? "text-gray-300" : "text-[#1a2f8a]"}`}
          style={{ minWidth: 110 }}>
          {fmt(contribSum)}
        </td>

        {contributionCompanies.map(c => {
          const val = getContrib(c);
          return (
            <td key={c}
              className={`px-4 py-2.5 text-right font-mono text-xs border-l border-gray-100
                ${isSummary ? "font-black" : ""}
                ${val === 0 ? "text-gray-300" : val > 0 ? "text-gray-700" : "text-[#e8394a]"}`}
              style={{ minWidth: 120 }}>
              {fmt(val)}
            </td>
          );
        })}
      </tr>

      {isExpanded && hasChildren && node.children.map(child => (
        <SheetRow key={child.AccountCode} node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
          contributionCompanies={contributionCompanies}
          topParent={topParent} />
      ))}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConsolidationSheetPage({ token }) {
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
  const [view,         setView]         = useState("accounts");

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
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;

    Promise.all([
      fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).then(d => d.value || []),
      fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).then(d => d.value || []),
      fetch(`${BASE}/journal-entries?$filter=${encodeURIComponent(filter)}`, {
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

  // The Group-role company in these rows is always the selected perspective,
  // because we fetched with GroupShortName=topParent. Keep the read here so
  // elimination filtering stays correct if the data arrives before topParent
  // updates.
  const groupRoleCompany = useMemo(() => {
    return [...new Set(
      rawData.filter(r => r.CompanyRole === "Group").map(r => r.CompanyShortName)
    )][0] || topParent;
  }, [rawData, topParent]);

  // ── Elimination rollup ────────────────────────────────────────────────────
  // Backend already scoped EJEs to this consolidation (via GroupShortName),
  // so we just sum them up and roll into parent accounts.
  const elimPivot = useMemo(() => {
    const detail = new Map();
    journalData
      .filter(r => r.JournalType === "EJE" && r.CompanyShortName === groupRoleCompany)
      .forEach(r => {
        const ac = String(r.AccountCode ?? "").trim();
        if (!ac) return;
        detail.set(ac, (detail.get(ac) ?? 0) + -(Number(r.AmountYTD ?? 0)));
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
    detail.forEach((amt, ac) => {
      m.set(ac, (m.get(ac) ?? 0) + amt);
      let cur = ac;
      while (parentOf.has(cur)) {
        const par = parentOf.get(cur);
        m.set(par, (m.get(par) ?? 0) + amt);
        cur = par;
      }
    });
    return m;
  }, [journalData, rawData, groupRoleCompany]);

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
          <div className="w-1.5 h-10 rounded-full bg-[#1a2f8a]" />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Consolidated</p>
            <h1 className="text-[29px] font-black text-[#1a2f8a] leading-none">Sheet</h1>
          </div>
        </div>
        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          {sources.length > 0 && (
            <FilterPill label="Source" value={source} onChange={setSource}
              options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          )}
          {availableYears.length > 0 && (
            <FilterPill label="Year" value={year} onChange={setYear} options={availableYears} />
          )}
          {availableMonths.length > 0 && (
            <FilterPill label="Month" value={month} onChange={setMonth} options={availableMonths} />
          )}
          {structures.length > 0 && (
            <FilterPill label="Structure" value={structure} onChange={setStructure}
              options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))} />
          )}
          {holdingOptions.length > 1 && (
            <FilterPill label="Perspective" value={topParent} onChange={setPerspectiveCompany}
              options={holdingOptions} />
          )}
          {displayCurrency && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border text-xs font-bold bg-white border-[#c2c2c2] shadow-xl">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">Currency</span>
              <span className="text-[#1a2f8a]">{displayCurrency}</span>
            </div>
          )}
          <div className="flex gap-0.5 bg-gray-100 rounded-xl p-1 ml-1">
            <button onClick={() => setView("consolidations")}
              className={`text-[10px] px-3 py-1 rounded-lg font-black transition-all ${view === "consolidations" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
              Consolidations
            </button>
            <button onClick={() => setView("accounts")}
              className={`text-[10px] px-3 py-1 rounded-lg font-black transition-all ${view === "accounts" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
              Accounts
            </button>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0 mr-6">
          {loading && <Loader2 size={13} className="animate-spin text-[#1a2f8a]" />}
          {view === "accounts" && (
            <>
              <button onClick={() => setExpanded(new Set([...accountMap.keys()]))}
                className="px-3 py-2 rounded-xl text-xs font-black bg-white border border-gray-100 text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/30 transition-all shadow-sm">
                Expand all
              </button>
              <button onClick={() => setExpanded(new Set())}
                className="px-3 py-2 rounded-xl text-xs font-black bg-white border border-gray-100 text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/30 transition-all shadow-sm">
                Collapse all
              </button>
            </>
          )}
          <button onClick={() => { setMetaReady(false); setTimeout(() => setMetaReady(true), 50); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-gray-100 text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/30 transition-all shadow-sm">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* ── View: Consolidations ── */}
      {view === "consolidations" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <div className="w-1 h-5 rounded-full bg-[#1a2f8a]" />
            <span className="text-xs font-black text-[#1a2f8a] uppercase tracking-widest">Consolidations</span>
            <span className="ml-auto text-[10px] font-black text-gray-300 uppercase tracking-widest mr-6">
              {consolidations.length} records
            </span>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden flex-1 min-h-0">
            {consolidations.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-xs text-gray-300 font-black uppercase tracking-widest">
                No consolidations found
              </div>
            ) : (
              <div className="overflow-auto h-full">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr style={{ backgroundColor: "#1a2f8a" }}>
                      {["Group", "Source", "Year", "Month", "Structure", "Consolidated By", "Consolidated At", "Prev Period"].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-white font-black text-[10px] uppercase tracking-widest whitespace-nowrap border-r border-white/10 last:border-r-0">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...consolidations]
                      .sort((a, b) => {
                        const ay = a.Year ?? a.year, by = b.Year ?? b.year;
                        const am = a.Month ?? a.month, bm = b.Month ?? b.month;
                        return by !== ay ? by - ay : bm - am;
                      })
                      .map((c, i) => {
                        const cy = String(c.Year ?? c.year), cm = String(c.Month ?? c.month);
                        const cs = c.Source ?? c.source, cg = c.GroupStructure ?? c.groupStructure;
                        const isActive = cy === year && cm === month && cs === source && cg === structure;
                        return (
                          <tr key={i}
                            onClick={() => { setYear(cy); setMonth(cm); setSource(cs ?? ""); setStructure(cg ?? ""); setView("accounts"); }}
                            className={`border-b border-gray-50 cursor-pointer transition-colors ${isActive ? "bg-[#eef1fb]" : "hover:bg-[#f8f9ff]"}`}>
                            <td className="px-4 py-2.5 font-black text-[#1a2f8a]">{c.GroupShortName ?? c.groupShortName}</td>
                            <td className="px-4 py-2.5 text-gray-500">{cs}</td>
                            <td className="px-4 py-2.5 text-gray-500 font-mono">{cy}</td>
                            <td className="px-4 py-2.5 text-gray-500">{MONTHS.find(m => m.value === Number(cm))?.label}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-[10px]">{cg}</td>
                            <td className="px-4 py-2.5 text-gray-400">{c.ConsolidatedBy ?? c.consolidatedBy ?? "—"}</td>
                            <td className="px-4 py-2.5 text-gray-400 font-mono text-[10px]">
                              {(c.ConsolidatedAt ?? c.consolidatedAt)
                                ? new Date(c.ConsolidatedAt ?? c.consolidatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                                : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-gray-400 font-mono text-[10px]">
                              {(c.PrevPeriodYear ?? c.prevPeriodYear)
                                ? `${c.PrevPeriodYear ?? c.prevPeriodYear} / ${String(c.PrevPeriodMonth ?? c.prevPeriodMonth).padStart(2, "0")}`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── View: Accounts ── */}
      {view === "accounts" && (
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
              <div className="overflow-auto flex-1 min-h-0">
                <table className="text-xs border-collapse w-full" style={{ borderSpacing: 0 }}>
                  <thead className="sticky top-0 z-30">
                    {/* ── Row 1: overarching group headers ── */}
                    <tr style={{ borderBottom: "1px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
                      <th className="sticky left-0 z-40 border-r border-gray-100" style={{ minWidth: 220, width: 220, backgroundColor: "#f9fafb" }} rowSpan={2}>
                        <span className="block px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest text-left">Account</span>
                      </th>
                      <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200" style={{ backgroundColor: "#eef1fb", boxShadow: "inset 0 3px 0 0 #1a2f8a" }}>
                        <span style={{ fontSize: 9, fontWeight: 900, color: "#1a2f8a", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                          Consolidation · {getLegal(topParent)}
                        </span>
                      </th>
                      <th colSpan={contributionCompanies.length} className="px-4 py-2 text-center border-l border-gray-200" style={{ backgroundColor: "#f0fdf4", boxShadow: "inset 0 3px 0 0 #059669" }}>
                        <span style={{ fontSize: 9, fontWeight: 900, color: "#059669", textTransform: "uppercase", letterSpacing: "0.12em" }}>Contribution</span>
                      </th>
                    </tr>
                    {/* ── Row 2: individual column headers ── */}
                    <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                      <th className="px-4 py-2 text-right border-l border-gray-200" style={{ minWidth: 100, backgroundColor: "#eef1fb" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                          <span style={{ fontSize: 10, fontWeight: 900, color: "#1a2f8a", textTransform: "uppercase", letterSpacing: "0.05em" }}>{topParent || "Total"}</span>
                          <span style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>
                            {isRootView ? "Consolidated" : "Subgroup"}
                          </span>
                        </div>
                      </th>
                      <th className="px-4 py-2 text-right border-l border-gray-200" style={{ minWidth: 100, backgroundColor: "#eef1fb" }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.05em" }}>Eliminations</span>
                      </th>
                      <th className="px-4 py-2 text-right border-l border-gray-200" style={{ minWidth: 110, backgroundColor: "#eef1fb" }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: "#1a2f8a", textTransform: "uppercase", letterSpacing: "0.05em" }}>Contribution</span>
                        <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>Sum</div>
                      </th>
                      {contributionCompanies.map(c => (
                        <th key={c} className="px-4 py-2 text-right border-l border-gray-100" style={{ minWidth: 100, backgroundColor: "#f0fdf4" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                            <span style={{ fontSize: 10, fontWeight: 900, color: "#1a2f8a", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }} title={getLegal(c)}>
                              {getLegal(c)}
                            </span>
                            <span style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>{displayCurrency}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tree.map(node => (
                      <SheetRow key={node.AccountCode} node={node} depth={0}
                        expanded={expanded} onToggle={toggleExpand}
                        pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
                        contributionCompanies={contributionCompanies}
                        topParent={topParent} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}