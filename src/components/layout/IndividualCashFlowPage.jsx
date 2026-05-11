/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { ChevronDown, Loader2, Download, Library } from "lucide-react";
import { useTypo, useSettings } from "./SettingsContext";
import PageHeader, { MultiFilterPill } from "./PageHeader.jsx";
import MappingsModal from "./Mappings.jsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

/* ─── SheetRow (individual flat) ─────────────────────────────────────── */
function SheetRow({
  node, depth, pivot, visibleCompanies,
  body1Style, body2Style, subbody1Style,
  isSubtotal, compareMode = false, cmpPivot = new Map(),
}) {
  const rowStyle = isSubtotal ? body1Style : body2Style;
  const cellStyle = (v) => {
    const baseColor = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
    return { ...rowStyle, color: baseColor };
  };

  const byCompany = pivot.get(node.AccountCode) || {};

  const getContrib = (company) =>
    (byCompany[company] ?? []).reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0);

  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/50">
      <td className="sticky left-0 z-10 py-2.5 pr-4 border-r border-gray-100 bg-white group-hover:bg-gray-50/50"
        style={{ paddingLeft: `${14 + depth * 16}px`, minWidth: 220, width: 220 }}>
        <div className="flex items-center gap-1.5 select-none">
          <span className="w-3 flex-shrink-0" />
          <span className="flex-shrink-0 mr-2" style={rowStyle}>{node.AccountCode}</span>
          <span className="truncate" style={{ ...rowStyle, maxWidth: 260 }}>{node.AccountName}</span>
        </div>
     </td>
      {visibleCompanies.map(c => {
        const val = getContrib(c);
        const cmpVal = compareMode
          ? (cmpPivot?.get(node.AccountCode)?.[c] ?? []).reduce((s, r) => s + Number(r._cfAmount ?? 0), 0)
          : null;
        const delta = cmpVal !== null ? Math.round(val) - Math.round(cmpVal) : null;
        return (
          <Fragment key={c}>
            <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
              style={{ minWidth: 120, ...cellStyle(val) }}>
              {fmt(val)}
            </td>
            {compareMode && (
              <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100 bg-[#fafbff]"
                style={{ minWidth: 110, ...cellStyle(cmpVal ?? 0) }}>
                {fmt(cmpVal ?? 0)}
              </td>
            )}
            {compareMode && (
              <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-100 bg-[#f5f7ff]"
                style={{ minWidth: 100, ...rowStyle, color: !delta ? "#D1D5DB" : delta > 0 ? "#059669" : "#EF4444" }}>
                {delta ? fmt(delta) : "—"}
              </td>
            )}
          </Fragment>
        );
      })}
    </tr>
  );
}
 
/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */
export default function IndividualCashFlowPage({ token }) {
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
  const [groupStructure, setGroupStructure] = useState([]);
  const [cfMapping,      setCfMapping]      = useState([]);
  const [mappedAccounts, setMappedAccounts] = useState([]);
  const [cfNameDict,     setCfNameDict]     = useState({});

  const [pgcCfMapping,           setPgcCfMapping]           = useState(null);
  const [danishIfrsCfMapping,    setDanishIfrsCfMapping]    = useState(null);
  const [spanishIfrsEsCfMapping, setSpanishIfrsEsCfMapping] = useState(null);

  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("DefaultStructure");
  const [selectedCompanies, setSelectedCompanies] = useState(null);

  const [uploadedData, setUploadedData] = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [metaReady,    setMetaReady]    = useState(false);

  const autoPeriodDone = useRef(false);

  /* ─── Metadata ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${BASE}/periods`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/sources`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/structures`,               { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/companies`,                { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/group-structure`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
      fetch(`${BASE}/mapped-cashflow-accounts`, { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
      fetch(`${BASE}/mapped-accounts`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
    ]).then(([p, s, st, co, gs, cf, ma]) => {
      if (cancelled) return;
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      setCfMapping(Array.isArray(cf) ? cf : []);
      setMappedAccounts(Array.isArray(ma) ? ma : []);

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

  /* ─── Detect standard ─────────────────────────────────────────── */
  const cfStandard = useMemo(() => {
    const allMappingCodes = cfMapping.map(m => String(m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? "")).filter(Boolean);
    const allMappingSums  = cfMapping.map(m => String(m.cashFlowAccountSumAccountCode ?? m.CashFlowAccountSumAccountCode ?? "")).filter(Boolean);

    if (allMappingCodes.some(c => /^CF\./.test(c))) return "pgc";
    if (allMappingSums.some(c  => /^CF\./.test(c))) return "pgc";
    if (allMappingSums.some(c => /^6\d{3}$/.test(c))) return "danish_ifrs";
    if (allMappingSums.some(c => /^4(21|22)\d$/.test(c))) return "danish_ifrs";
    if (allMappingCodes.some(c => /^\d{4}$/.test(c))) return "spanish_ifrs_es";
    return null;
  }, [cfMapping]);

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

  /* ─── Auto period probe ───────────────────────────────────────── */
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
          const res = await fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, {
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

  /* ─── Companies under selected structure ─────────────────────── */
  const contributionCompanies = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.companyShortName ?? g.CompanyShortName ?? "",
      structure: g.groupStructure   ?? g.GroupStructure   ?? "",
      detached:  g.detached         ?? g.Detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    return gsRows
      .map(g => g.company)
      .filter(Boolean)
      .sort((a, b) => {
        const lA = companies.find(c => c.CompanyShortName === a)?.CompanyLegalName || a;
        const lB = companies.find(c => c.CompanyShortName === b)?.CompanyLegalName || b;
        return lA.localeCompare(lB, "es", { sensitivity: "base" });
      });
  }, [groupStructure, structure, companies]);

  const visibleCompanies = useMemo(() => {
    if (!selectedCompanies) return contributionCompanies;
    return contributionCompanies.filter(c => selectedCompanies.includes(c));
  }, [contributionCompanies, selectedCompanies]);

  /* ─── Fetch uploaded data + CF names ───────────────────────────── */
  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure) return;
    let cancelled = false;
    setLoading(true);
    setUploadedData([]);

    const baseFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    Promise.all([
      fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, auth)
        .then(r => r.json()).then(d => d.value || []),
      fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(baseFilter)}`, auth)
        .then(r => r.json()).then(d => d.value || []).catch(() => []),
    ]).then(([uploaded, cons]) => {
      if (cancelled) return;
      const cfRowsForNames = cons.filter(r => {
        const t = r.AccountType ?? r.accountType ?? "";
        return t === "C/F" || t === "CFS";
      });
      setCfNameDict(prev => {
        const next = { ...prev };
        cfRowsForNames.forEach(r => {
          const code = r.AccountCode ?? r.accountCode;
          const name = r.AccountName ?? r.accountName;
          if (code && name && !next[code]) next[code] = name;
        });
        return next;
      });
      setUploadedData(uploaded);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [token, metaReady, year, month, source, structure]);

  /* ─── CF metadata + group→cf ──────────────────────────────────── */
  const cfMetadata = useMemo(() => {
    const m = new Map();
    cfMapping.forEach(map => {
      const enabled = map.enabled ?? map.Enabled;
      if (enabled === false) return;
      const code = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
      const name = map.cashFlowAccountName ?? map.CashFlowAccountName ?? "";
      const sumParent = map.cashFlowAccountSumAccountCode ?? map.CashFlowAccountSumAccountCode ?? "";
      if (!code) return;
      if (!m.has(code)) m.set(code, { name: name || cfNameDict[code] || "", sumParent });
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

  /* ─── Pivot from uploaded leaves ──────────────────────────────── */
  const pivot = useMemo(() => {
    if (!uploadedData.length || !cfMetadata.size) return new Map();
    const piv = new Map();

    uploadedData.forEach(r => {
      const localCode = r.LocalAccountCode ?? r.localAccountCode ?? null;
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!localCode || !groupCode || !co) return;
      const cfs = groupToCf.get(groupCode);
      if (!cfs) return;
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD);
      cfs.forEach(cfCode => {
        if (!piv.has(cfCode)) piv.set(cfCode, {});
        const c = piv.get(cfCode);
        if (!c[co]) c[co] = [];
        c[co].push({ _cfAmount: amt });
      });
    });

    const leafCodes = [...piv.keys()];
    leafCodes.forEach(leafCode => {
      const meta = cfMetadata.get(leafCode);
      if (!meta) return;
      let parent = meta.sumParent;
      const seen = new Set([leafCode]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const leafPiv = piv.get(leafCode) || {};
        if (!piv.has(parent)) piv.set(parent, {});
        const parentPiv = piv.get(parent);
        Object.entries(leafPiv).forEach(([co, rsArr]) => {
          if (!parentPiv[co]) parentPiv[co] = [];
          const sum = rsArr.reduce((s, r) => s + (r._cfAmount ?? 0), 0);
          parentPiv[co].push({ _cfAmount: sum });
        });
        const parentMeta = cfMetadata.get(parent);
        parent = parentMeta?.sumParent || "";
      }
    });

    return piv;
  }, [uploadedData, cfMetadata, groupToCf]);

  const subtotalCodes = useMemo(() => {
    const s = new Set();
    cfMetadata.forEach(({ sumParent }) => { if (sumParent) s.add(sumParent); });
    return s;
  }, [cfMetadata]);

  const codesWithValue = useMemo(() => {
    const out = [];
    pivot.forEach((byCo, code) => {
      let total = 0;
      for (const co of Object.keys(byCo)) {
        for (const r of byCo[co] || []) total += Number(r._cfAmount ?? 0);
      }
      if (Math.round(total) !== 0) out.push(code);
    });
    return out;
  }, [pivot]);

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

  const bySection = useMemo(() => {
    const m = new Map();
    codesWithValue.forEach(code => {
      const sec = sectionForCode(code);
      if (!m.has(sec)) m.set(sec, []);
      m.get(sec).push(code);
    });
    m.forEach(arr => arr.sort((a, b) => sortOrderFor(a) - sortOrderFor(b)));
    return m;
  }, [codesWithValue, activeCfMapping]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionOrder = useMemo(() => {
    const order = activeCfMapping?.sections ? [...activeCfMapping.sections.keys()] : ["OPERATING", "INVESTING", "FINANCING"];
    bySection.forEach((_, sec) => { if (!order.includes(sec)) order.push(sec); });
    return order;
  }, [activeCfMapping, bySection]);

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
  const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: MONTHS.find(x => x.value === m)?.label ?? String(m) }));

 const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;
  const hasData = uploadedData.length > 0;

const [exporting, setExporting] = useState(false);
  const [viewsModalOpen, setViewsModalOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [cmpYear,  setCmpYear]  = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
  const [cmpSource, setCmpSource] = useState("");
  const [cmpPivot, setCmpPivot] = useState(new Map());
  const [cmpLoading, setCmpLoading] = useState(false);

 // Fetch compare period when compare mode is active
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !structure) { setCmpPivot(new Map()); return; }
    let cancelled = false;
    setCmpLoading(true);
    const baseFilter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${structure}'`;
    fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        if (cancelled) return;
        const rows = d.value || [];
        const piv = new Map();
        rows.forEach(r => {
          const localCode = r.LocalAccountCode ?? r.localAccountCode ?? null;
          const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
          const co = r.CompanyShortName ?? r.companyShortName ?? "";
          if (!localCode || !groupCode || !co) return;
          const cfs = groupToCf.get(groupCode);
          if (!cfs) return;
          const amt = parseAmt(r.AmountYTD ?? r.amountYTD);
          cfs.forEach(cfCode => {
            if (!piv.has(cfCode)) piv.set(cfCode, {});
            const c = piv.get(cfCode);
            if (!c[co]) c[co] = [];
            c[co].push({ _cfAmount: amt });
          });
        });
        // bubble up to parents
        [...piv.keys()].forEach(leafCode => {
          const meta = cfMetadata.get(leafCode);
          if (!meta) return;
          let parent = meta.sumParent;
          const seen = new Set([leafCode]);
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            const lp = piv.get(leafCode) || {};
            if (!piv.has(parent)) piv.set(parent, {});
            const pp = piv.get(parent);
            Object.entries(lp).forEach(([co, arr]) => {
              if (!pp[co]) pp[co] = [];
              pp[co].push({ _cfAmount: arr.reduce((s, r) => s + (r._cfAmount ?? 0), 0) });
            });
            parent = cfMetadata.get(parent)?.sumParent || "";
          }
        });
        setCmpPivot(piv);
        setCmpLoading(false);
      }).catch(() => { if (!cancelled) setCmpLoading(false); });
    return () => { cancelled = true; };
  }, [compareMode, cmpYear, cmpMonth, cmpSource, structure, token, groupToCf, cfMetadata]);

  // Init compare filters on toggle
  useEffect(() => {
    if (!compareMode) return;
    if (!cmpSource) setCmpSource(source);
    if (!cmpYear)   setCmpYear(String(parseInt(year) - 1 || year));
    if (!cmpMonth)  setCmpMonth(month);
  }, [compareMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterStr = [source, structure,
    year && month ? `${MONTHS.find(m => m.value === parseInt(month))?.label ?? month} ${year}` : ""
  ].filter(Boolean).join(" · ");

  const handleExportXlsx = async () => {
    const C = { primary: "FF1A2F8A", white: "FFFFFFFF", highlight: "FFEEF1FB", band2: "FFF8F9FF", red: "FFDC2626", gray: "FF9CA3AF" };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cash Flow", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const totalCols = 1 + visibleCompanies.length;

    ws.mergeCells(1, 1, 1, totalCols);
    Object.assign(ws.getCell(1, 1), { value: "Cash Flow — By Company", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 16, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, totalCols);
    Object.assign(ws.getCell(2, 1), { value: filterStr || "—", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 10, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 6;

    const hRow = ws.getRow(4);
    hRow.height = 24;
    ["Account", ...visibleCompanies.map(c => getLegal(c))].forEach((h, i) => {
      const c = hRow.getCell(i + 1);
      c.value = h;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
    });

    let rn = 5;
    sectionOrder.forEach(sec => {
      const codes = bySection.get(sec);
      if (!codes?.length) return;
      const secInfo = activeCfMapping?.sections?.get(sec);

      ws.mergeCells(rn, 1, rn, totalCols);
      const sc = ws.getCell(rn, 1);
      sc.value = (secInfo?.label || sec).toUpperCase();
      sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + (secInfo?.color || "#1a2f8a").replace("#", "").toUpperCase().padStart(6, "0") } };
      sc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
      sc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(rn).height = 18;
      rn++;

      codes.forEach((code, idx) => {
        const name = nameFor(code);
        const isSubtotal = subtotalCodes.has(code);
        const band = idx % 2 === 0 ? "FFFFFFFF" : C.band2;
        const lc = ws.getCell(rn, 1);
        lc.value = `${code}  ${name}`.trim();
        lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        lc.font = { name: "Calibri", size: 10, bold: isSubtotal, color: { argb: C.primary } };
        lc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        visibleCompanies.forEach((co, ci) => {
          const byCo = pivot.get(code) || {};
          const val = Math.round((byCo[co] ?? []).reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0));
          const vc = ws.getCell(rn, 2 + ci);
          if (val !== 0) { vc.value = val; vc.numFmt = '#,##0;[Red]-#,##0'; vc.font = { name: "Calibri", size: 10, bold: isSubtotal, color: { argb: val < 0 ? C.red : "FF000000" } }; }
          else { vc.font = { name: "Calibri", size: 10, color: { argb: C.gray } }; }
          vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
          vc.alignment = { vertical: "middle", horizontal: "right" };
        });
        ws.getRow(rn).height = 18;
        rn++;
      });
    });

    ws.getColumn(1).width = 42;
    visibleCompanies.forEach((_, i) => { ws.getColumn(2 + i).width = 18; });
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `CashFlow_${year}_${String(month).padStart(2, "0")}.xlsx`);
  };

  const handleExportPdf = () => {
    const H = { primary: "#1A2F8A", white: "#FFFFFF", band2: "#F8F9FF", red: "#DC2626" };
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(H.primary); doc.rect(0, 0, pageWidth, 60, "F");
    doc.setTextColor(H.white); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Cash Flow — By Company", 24, 28);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(filterStr || "—", 24, 46);

    const head = [["Account", ...visibleCompanies.map(c => getLegal(c))]];
    const body = [];
    sectionOrder.forEach(sec => {
      const codes = bySection.get(sec);
      if (!codes?.length) return;
      const secInfo = activeCfMapping?.sections?.get(sec);
      body.push([{ content: (secInfo?.label || sec).toUpperCase(), colSpan: 1 + visibleCompanies.length, styles: { fillColor: secInfo?.color || H.primary, textColor: H.white, fontStyle: "bold" } }]);
      codes.forEach(code => {
        const name = nameFor(code);
        const isSubtotal = subtotalCodes.has(code);
        const fmtVal = v => { const r = Math.round(v); return r === 0 ? "—" : r.toLocaleString("de-DE"); };
        body.push([
          { content: `${code}  ${name}`.trim(), styles: { fontStyle: isSubtotal ? "bold" : "normal", halign: "left" } },
          ...visibleCompanies.map(co => {
            const byCo = pivot.get(code) || {};
            const val = (byCo[co] ?? []).reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
            return { content: fmtVal(val), styles: { halign: "right", textColor: val < 0 ? H.red : "#000000" } };
          }),
        ]);
      });
    });

    autoTable(doc, { head, body, startY: 80, theme: "plain",
      styles: { font: "helvetica", fontSize: 7, cellPadding: 3, textColor: H.primary },
      headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "right" },
      columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 130 } },
      alternateRowStyles: { fillColor: H.band2 },
    });
    doc.save(`CashFlow_${year}_${String(month).padStart(2, "0")}.pdf`);
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <style>{`
        .cf-scroll-outer { position: relative; overflow: hidden; }
        .cf-scroll {
          overflow: auto; height: 100%;
          scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9;
        }
.cf-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .cf-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .cf-scroll::-webkit-scrollbar-thumb { background: transparent; }
        .cf-scroll::-webkit-scrollbar-track { background: transparent; }
        .cf-scroll thead { background: ${colors.primary}; }
        .cf-scroll thead th { border-color: transparent !important; }
        .cf-scroll thead th + th { box-shadow: inset 1px 0 0 rgba(255,255,255,0.25); }
        .cf-scroll thead tr:first-child th:first-child { border-top-left-radius: 1rem; }
        .cf-scroll thead tr:first-child th:last-child  { border-top-right-radius: 1rem; }
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
          ...(contributionCompanies.length > 1
            ? [{
                label: "Companies",
                multiselect: true,
                values: selectedCompanies,
                onChange: setSelectedCompanies,
                options: contributionCompanies.map(c => ({
                  value: c,
                  label: companies.find(x => x.CompanyShortName === c)?.CompanyLegalName || c,
                })),
              }]
            : []),
        ]}
        compareToggle={{ active: compareMode, onChange: setCompareMode }}
fabActions={[
          {
            id: "views",
            icon: Library,
            label: "Views",
            onClick: () => setViewsModalOpen(true),
          },
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
                onClick: async () => {
                  setExporting(true);
                  try { await handleExportXlsx(); }
                  finally { setExporting(false); }
                },
              },
              {
                id: "pdf",
                label: "PDF",
                src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png",
                alt: "PDF",
                onClick: () => { handleExportPdf(); },
              },
            ],
          },
        ]}
      />

<MappingsModal
        open={viewsModalOpen}
        onClose={() => setViewsModalOpen(false)}
        groupAccounts={[]}
        onApply={() => {}}
      />

      {compareMode && (
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50 mr-1">Compare with</span>
          <FilterPill label="Source" value={cmpSource} onChange={setCmpSource}
            options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))}
            filterStyle={filterStyle} colors={colors} />
          <FilterPill label="Year" value={cmpYear} onChange={setCmpYear}
            options={availableYears} filterStyle={filterStyle} colors={colors} />
          <FilterPill label="Month" value={cmpMonth} onChange={setCmpMonth}
            options={availableMonths} filterStyle={filterStyle} colors={colors} />
          {cmpLoading && <Loader2 size={11} className="animate-spin text-[#1a2f8a] ml-2" />}
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
                        style={{ minWidth: 220, width: 220, backgroundColor: colors.primary, boxShadow: "inset -1px 0 0 rgba(255,255,255,0.25)" }}>
                        <span style={header2Style}>ACCOUNT</span>
                      </th>

                      <th colSpan={visibleCompanies.length * (compareMode ? 3 : 1)}
                        className="px-4 py-2 text-center"
                        style={{ backgroundColor: colors.primary, boxShadow: "inset 1px 0 0 rgba(255,255,255,0.25), inset 0 0 0 9999px rgba(0,0,0,0.1)" }}>
                        <span style={{ ...header2Style, textTransform: "uppercase", position: "relative" }}>
                          Cash Flow · By Company (local currency)
                        </span>
                      </th>
                    </tr>

<tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      <th className="sticky left-0 z-40"
                        style={{ minWidth: 220, width: 220, backgroundColor: colors.primary,
                          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.25)" }} />
{visibleCompanies.map(c => {
                        const ccy = companies.find(x => x.CompanyShortName === c)?.CurrencyCode || "—";
                        return (
                          <Fragment key={c}>
                            <th className="px-4 py-2.5 text-center"
                              style={{ minWidth: 120, backgroundColor: colors.primary }}>
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="block overflow-hidden text-ellipsis whitespace-nowrap max-w-full" style={underscore1Style} title={getLegal(c)}>
                                  {getLegal(c)}
                                </span>
                                <span style={underscore2Style}>{ccy}</span>
                              </div>
                            </th>
                            {compareMode && (
                              <th className="px-4 py-2.5 text-center"
                                style={{ minWidth: 110, backgroundColor: colors.primary, opacity: 0.8 }}>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span style={{ ...underscore1Style, fontSize: 9 }}>Cmp</span>
                                  <span style={underscore2Style}>{ccy}</span>
                                </div>
                              </th>
                            )}
                            {compareMode && (
                              <th className="px-4 py-2.5 text-center"
                                style={{ minWidth: 100, backgroundColor: colors.primary, opacity: 0.65 }}>
                                <span style={{ ...underscore1Style, fontSize: 9 }}>Δ</span>
                              </th>
                            )}
                          </Fragment>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {sectionOrder.map(sec => {
                      const codes = bySection.get(sec);
                      if (!codes || codes.length === 0) return null;

                      const secInfo = activeCfMapping?.sections?.get(sec);
                                            const totalCols = 1 + visibleCompanies.length * (compareMode ? 3 : 1);

                      return (
                        <Fragment key={`section-${sec}`}>
<tr>
                            <td className="sticky left-0 z-10"
                              style={{
                                backgroundColor: secInfo?.color || colors.primary,
                                color: "#fff", padding: "8px 16px",
                                fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                                minWidth: 220, width: 220,
                              }}>
                              {secInfo?.label || sec}
                            </td>
                            <td colSpan={totalCols - 1}
                              style={{ backgroundColor: secInfo?.color || colors.primary }} />
                          </tr>
                          {codes.map(code => {
                            const isSubtotal = subtotalCodes.has(code);
                            const node = {
                              AccountCode: code,
                              AccountName: nameFor(code),
                            };
                            return (
<SheetRow key={code} node={node} depth={0}
                                pivot={pivot} visibleCompanies={visibleCompanies}
                                body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                                isSubtotal={isSubtotal}
                                compareMode={compareMode} cmpPivot={cmpPivot} />
                            );
                          })}
                        </Fragment>
                      );
                    })}
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