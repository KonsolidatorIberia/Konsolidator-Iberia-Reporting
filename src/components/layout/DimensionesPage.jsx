import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChevronDown, Loader2, X, RefreshCw, Search, Database, GitMerge } from "lucide-react";

const BASE_URL = "";

const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" }, { value: 4, label: "April" },
  { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" }, { value: 12, label: "December" },
];

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

function fmtAmt(n) {
  if (n == null || n === 0) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (isNaN(num) || num === 0) return "—";
  return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseAmt(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (!s || s === "—" || s === "-") return 0;
  if (/\d\.\d{3},\d/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (/,/.test(s) && /\./.test(s) && s.indexOf(",") < s.indexOf(".")) return parseFloat(s.replace(/,/g, "")) || 0;
  if (/,/.test(s) && !/\./.test(s)) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

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
                {String(o.value) === String(value) && <span className="w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Accounts Tab ─────────────────────────────────────────── */
function AccountsTab({ data }) {
  const [search, setSearch] = useState("");
  const cols = data.length > 0 ? Object.keys(data[0]) : [];
  const filtered = search.trim()
    ? data.filter(r => Object.values(r).some(v => String(v ?? "").toLowerCase().includes(search.toLowerCase())))
    : data;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs font-bold text-[#1a2f8a] bg-[#eef1fb] px-3 py-1.5 rounded-xl">{data.length} records</span>
        {search && <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl">{filtered.length} matching</span>}
        <div className="ml-auto flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
          <Search size={13} className="text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="text-xs outline-none text-gray-700 w-40 bg-transparent placeholder:text-gray-300" />
          {search && <button onClick={() => setSearch("")}><X size={12} className="text-gray-400" /></button>}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#eef1fb]">
                <th className="text-left px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 w-10">#</th>
                {cols.map(col => (
                  <th key={col} className="text-left px-4 py-3 text-[10px] font-black text-[#1a2f8a] uppercase tracking-widest whitespace-nowrap border-b border-gray-100">
                    {col.replace(/([A-Z])/g, " $1").trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 !== 0 ? "bg-gray-50/30" : ""}`}>
                  <td className="px-4 py-2.5 text-gray-300 font-mono">{i + 1}</td>
                  {cols.map((col, j) => {
                    const val = row[col];
                    if (val === null || val === undefined || val === "") return <td key={j} className="px-4 py-2.5 text-gray-200 italic">—</td>;
                    if (typeof val === "boolean") return <td key={j} className={`px-4 py-2.5 font-semibold ${val ? "text-emerald-600" : "text-gray-400"}`}>{val ? "Yes" : "No"}</td>;
                    if (typeof val === "number") return <td key={j} className="px-4 py-2.5 font-mono text-right">{val.toLocaleString()}</td>;
                    if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}T/)) return <td key={j} className="px-4 py-2.5 font-mono text-gray-500 whitespace-nowrap">{new Date(val).toLocaleDateString()}</td>;
                    return <td key={j} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{String(val)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const PGC_LINES = [
  { key: "all",        label: "All",            test: () => true },
  { key: "revenue",    label: "Revenue",         test: c => c.startsWith("7") },
  { key: "costs",      label: "Costs",           test: c => c.startsWith("6") },
  { key: "gross",      label: "Gross Profit",    test: c => c.startsWith("6") || c.startsWith("7") },
  { key: "personnel",  label: "Personnel",       test: c => c.startsWith("64") },
  { key: "da",         label: "D&A",             test: c => c.startsWith("68") },
  { key: "financial",  label: "Financial",       test: c => c.startsWith("66") || c.startsWith("76") },
];

/* ── Pivot Tab ────────────────────────────────────────────── */
function PivotTab({ data, dimensions, onShowAccounts, selGroup, compareMode, sources = [], structures = [], companies = [], token = "", masterYear = "", masterMonth = "", masterSource = "", masterStructure = "", masterCompany = "" }) {
  const headerRef = useRef(null);
  const bodyRef   = useRef(null);
  const onBodyScroll   = useCallback(() => { if (headerRef.current) headerRef.current.scrollLeft = bodyRef.current.scrollLeft; }, []);
  const onHeaderScroll = useCallback(() => { if (bodyRef.current)   bodyRef.current.scrollLeft = headerRef.current.scrollLeft; }, []);



  // Dims for selected group
  const groupDimCodes = useMemo(() => {
    if (!selGroup) return null; // null = all dims
    return new Set(
      dimensions
        .filter(d => (d.DimensionGroup ?? d.dimensionGroup ?? "") === selGroup)
        .map(d => d.DimensionCode ?? d.dimensionCode ?? "")
        .filter(Boolean)
    );
  }, [dimensions, selGroup]);

  // Build pivot from data
  const { accounts, dimCols, pivot } = useMemo(() => {
    if (!data.length) return { accounts: [], dimCols: [], pivot: new Map() };

    // Filter rows by selected group
    const rows = groupDimCodes
      ? data.filter(r => {
          const dc = r.DimensionCode ?? r.dimensionCode ?? "";
          return !dc || groupDimCodes.has(dc);
        })
      : data;

    // Unique accounts
    const accountMap = new Map();
    rows.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const name = r.AccountName ?? r.accountName ?? "";
      if (code && !accountMap.has(code)) accountMap.set(code, { code, name });
    });
    const accounts = [...accountMap.values()].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );

    // Unique dim columns
    const dimMap = new Map();
    rows.forEach(r => {
      const dc = r.DimensionCode ?? r.dimensionCode ?? null;
      const dn = r.DimensionName ?? r.dimensionName ?? null;
      const key = dc ?? "__none__";
      if (!dimMap.has(key)) dimMap.set(key, { code: dc, name: dn || dc || "No Dimension" });
    });
    const dimCols = [...dimMap.values()].sort((a, b) => {
      if (!a.code && b.code) return 1;
      if (a.code && !b.code) return -1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    // Build pivot
    const pivot = new Map();
    rows.forEach(r => {
      const ac  = r.AccountCode ?? r.accountCode ?? "";
      const dc  = r.DimensionCode ?? r.dimensionCode ?? null;
      const key = dc ?? "__none__";
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? r.AmountPeriod ?? r.amountPeriod ?? 0);
const lacCheck = r.LocalAccountCode ?? r.localAccountCode ?? "";
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (lacCheck && lacCheck !== "—") return;
      if (acType && acType !== "P/L") return; // only P/L summary rows
      if (!pivot.has(ac)) pivot.set(ac, new Map());
      pivot.get(ac).set(key, (pivot.get(ac).get(key) ?? 0) + amt);
    });

    return { accounts, dimCols, pivot };
  }, [data, groupDimCodes]);

const getVal      = (ac, dk) => pivot.get(ac)?.get(dk) ?? 0;
  const getRowTotal = (ac)     => dimCols.reduce((s, d) => s + getVal(ac, d.code ?? "__none__"), 0);

  // Compare filter states

const [cmp2Source, setCmp2Source]       = useState(masterSource);
  const [cmp2Year, setCmp2Year]           = useState(masterYear);
  const [cmp2Month, setCmp2Month]         = useState(masterMonth);
  const [cmp2Structure, setCmp2Structure] = useState(masterStructure);
  const [cmp2Company, setCmp2Company]     = useState(masterCompany);
  const [cmp3Source, setCmp3Source]       = useState(masterSource);
  const [cmp3Year, setCmp3Year]           = useState(masterYear);
  const [cmp3Month, setCmp3Month]         = useState(masterMonth);
  const [cmp3Structure, setCmp3Structure] = useState(masterStructure);
  const [cmp3Company, setCmp3Company]     = useState(masterCompany);

const [line, setLine] = useState("all");
const [viewMode, setViewMode] = useState("monthly");
const [prevPivot, setPrevPivot] = useState(new Map());
  const [prevPivot2, setPrevPivot2] = useState(new Map());
  const [prevPivot3, setPrevPivot3] = useState(new Map());

  const [cmp2Data, setCmp2Data] = useState([]);
  const [cmp3Data, setCmp3Data] = useState([]);
const [, setCmp2Loading] = useState(false);
  const [, setCmp3Loading] = useState(false);

const buildPivot = useCallback((rows) => {
    const p = new Map();
    rows.forEach(r => {
      const ac  = r.AccountCode ?? r.accountCode ?? "";
      const dc  = r.DimensionCode ?? r.dimensionCode ?? null;
      const key = dc ?? "__none__";
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      const lac = r.LocalAccountCode ?? r.localAccountCode ?? "";
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (lac && lac !== "—") return;
      if (acType && acType !== "P/L") return;
      if (!p.has(ac)) p.set(ac, new Map());
      p.get(ac).set(key, (p.get(ac).get(key) ?? 0) + amt);
    });
    return p;
  }, []);

const pivot2 = useMemo(() => buildPivot(cmp2Data), [cmp2Data, buildPivot]);
  const pivot3 = useMemo(() => buildPivot(cmp3Data), [cmp3Data, buildPivot]);

const fetchCmpData = useCallback(async (yr, mo, src, str, co, setter, loadSetter) => {
    if (!yr || !mo || !src || !str || !co) return;
    loadSetter(true);
    try {
      const filter = `Year eq ${yr} and Month eq ${mo} and Source eq '${src}' and GroupStructure eq '${str}' and CompanyShortName eq '${co}'`;
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setter(json.value ?? (Array.isArray(json) ? json : []));
    } catch { setter([]); }
    finally { loadSetter(false); }
  }, [token]);

// Fetch previous month data for monthly calc (Standard column)
  useEffect(() => {
    if (!compareMode || viewMode !== "monthly" || !masterYear || !masterMonth || !masterSource || !masterStructure || !masterCompany) return;
    const mo = Number(masterMonth);
    const yr = Number(masterYear);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), masterSource, masterStructure, masterCompany, (d) => setPrevPivot(buildPivot(d)), () => {});
  }, [compareMode, viewMode, masterYear, masterMonth, masterSource, masterStructure, masterCompany, fetchCmpData, buildPivot]);

useEffect(() => {
    if (compareMode) fetchCmpData(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, setCmp2Data, setCmp2Loading);
  }, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, fetchCmpData]);

  useEffect(() => {
    if (compareMode) fetchCmpData(cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, setCmp3Data, setCmp3Loading);
  }, [compareMode, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, fetchCmpData]);

  useEffect(() => {
    if (!compareMode || viewMode !== "monthly" || !cmp2Year || !cmp2Month || !cmp2Source || !cmp2Structure || !cmp2Company) return;
    const mo = Number(cmp2Month);
    const yr = Number(cmp2Year);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), cmp2Source, cmp2Structure, cmp2Company, (d) => setPrevPivot2(buildPivot(d)), () => {});
  }, [compareMode, viewMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, fetchCmpData, buildPivot]);

  useEffect(() => {
    if (!compareMode || viewMode !== "monthly" || !cmp3Year || !cmp3Month || !cmp3Source || !cmp3Structure || !cmp3Company) return;
    const mo = Number(cmp3Month);
    const yr = Number(cmp3Year);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), cmp3Source, cmp3Structure, cmp3Company, (d) => setPrevPivot3(buildPivot(d)), () => {});
  }, [compareMode, viewMode, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, fetchCmpData, buildPivot]);

  const cmpSources    = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const cmpYears      = YEARS.map(y => ({ value: String(y), label: String(y) }));
  const cmpMonths     = MONTHS.map(m => ({ value: String(m.value), label: m.label }));
  const cmpStructures = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const cmpCompanies  = [...new Set(companies.map(c => typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)).filter(Boolean))].map(v => ({ value: v, label: v }));

  const ACOL = 300, DCOL = 140, TCOL = 150;
  const totalWidth = ACOL + dimCols.length * DCOL + TCOL;

if (compareMode) {
    return (
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        {/* Compare filter rows */}
<div className="flex items-start gap-3 flex-shrink-0">
          {/* Compare filter rows */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col gap-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-2 h-2 rounded-full border-2 border-[#CF305D] flex-shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest text-[#CF305D]/50 flex-shrink-0">Compare 1</span>
              {cmpSources.length > 0    && <FilterPill label="Source"    value={cmp2Source}    onChange={setCmp2Source}    options={cmpSources} />}
              {cmpYears.length > 0      && <FilterPill label="Year"      value={cmp2Year}      onChange={setCmp2Year}      options={cmpYears} />}
              {cmpMonths.length > 0     && <FilterPill label="Month"     value={cmp2Month}     onChange={setCmp2Month}     options={cmpMonths} />}
              {cmpStructures.length > 0 && <FilterPill label="Structure" value={cmp2Structure} onChange={setCmp2Structure} options={cmpStructures} />}
              {cmpCompanies.length > 0  && <FilterPill label="Company"   value={cmp2Company}   onChange={setCmp2Company}   options={cmpCompanies} />}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-2 h-2 rounded-full border-2 border-[#57aa78] flex-shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest text-[#57aa78]/50 flex-shrink-0">Compare 2</span>
              {cmpSources.length > 0    && <FilterPill label="Source"    value={cmp3Source}    onChange={setCmp3Source}    options={cmpSources} />}
              {cmpYears.length > 0      && <FilterPill label="Year"      value={cmp3Year}      onChange={setCmp3Year}      options={cmpYears} />}
              {cmpMonths.length > 0     && <FilterPill label="Month"     value={cmp3Month}     onChange={setCmp3Month}     options={cmpMonths} />}
              {cmpStructures.length > 0 && <FilterPill label="Structure" value={cmp3Structure} onChange={setCmp3Structure} options={cmpStructures} />}
              {cmpCompanies.length > 0  && <FilterPill label="Company"   value={cmp3Company}   onChange={setCmp3Company}   options={cmpCompanies} />}
            </div>
          </div>

{/* YTD / Monthly toggle */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center gap-2 flex-shrink-0 self-stretch px-3">
            
            <div className="flex flex-col gap-2 p-2 bg-[#e6e6e6] rounded-xl items-center justify-center self-stretch w-[3vw]">
              <button onClick={() => setViewMode("ytd")}
                className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all ${viewMode === "ytd" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-[#636363]"}`}>
                YTD
              </button>
              <button onClick={() => setViewMode("monthly")}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${viewMode === "monthly" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-[#636363]"}`}>
                MTD
              </button>
            </div>
          </div>

          {/* Line filter — applies to all */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center flex-shrink-0 self-stretch w-[20vw]">
            <FilterPill label="Line" value={line} onChange={setLine} options={PGC_LINES.map(l => ({ value: l.key, label: l.label }))} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr style={{ backgroundColor: "#1a2f8a" }}>
                  <th className="sticky left-0 z-30 text-left px-5 py-3 text-white font-black uppercase tracking-widest text-xs border-r border-white/20" style={{ backgroundColor: "#1a2f8a" }}>
                    Dimension
                  </th>
<th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#1a2f8a" }}>Standard</th>
                  <th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#1a2f8a" }}>Compare 1</th>
                  <th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#1a2f8a", opacity: 0.7 }}>Δ Amt</th>
                  <th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#1a2f8a", opacity: 0.5 }}>Δ %</th>
                  <th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#0f1f5c" }}>Compare 2</th>
                  <th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#0f1f5c", opacity: 0.7 }}>Δ Amt</th>
                  <th className="text-right px-4 py-3 text-white font-black text-xs whitespace-nowrap" style={{ backgroundColor: "#0f1f5c", opacity: 0.5 }}>Δ %</th>
                </tr>
              </thead>
<tbody>
                {dimCols.filter(dim => !!dim.code).map(dim => {
                  const dimKey = dim.code ?? "__none__";

const lineDef = PGC_LINES.find(l => l.key === line) ?? PGC_LINES[0];
                  const sumPivot = (p, pPrev) => {
                    let total = 0;
                    // Iterate over ALL accounts in this pivot, not just Standard accounts
                    p.forEach((dimMap, acCode) => {
                      if (lineDef.test(acCode)) {
                        const ytd = dimMap.get(dimKey) ?? 0;
                        if (viewMode === "monthly" && pPrev) {
                          const prevYtd = pPrev.get(acCode)?.get(dimKey) ?? 0;
                          total += ytd - prevYtd;
                        } else {
                          total += ytd;
                        }
                      }
                    });
                    return total;
                  };
const v1 = sumPivot(pivot, prevPivot);
                  const v2 = sumPivot(pivot2, prevPivot2);
                  const v3 = sumPivot(pivot3, prevPivot3);
                  const fmt = v => v === 0 ? <span className="text-gray-200">—</span> : <span className={v > 0 ? "text-[#1a2f8a]" : "text-red-500"}>{fmtAmt(v)}</span>;
                  return (
                    <tr key={dimKey} className="border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors">
                      <td className="sticky left-0 z-10 px-5 py-2.5 bg-white border-r border-gray-100">
<span className="font-black text-xs text-[#1a2f8a]">{dim.name}</span>
                      </td>
<td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(v1)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(v2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-amber-600">{v1 === 0 && v2 === 0 ? <span className="text-gray-200">—</span> : <span className={v1 - v2 >= 0 ? "text-emerald-600" : "text-red-500"}>{fmtAmt(v1 - v2)}</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{v2 === 0 ? <span className="text-gray-200">—</span> : <span className={v1 - v2 >= 0 ? "text-emerald-600" : "text-red-500"}>{(((v1 - v2) / Math.abs(v2)) * 100).toFixed(1)}%</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(v3)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{v1 === 0 && v3 === 0 ? <span className="text-gray-200">—</span> : <span className={v1 - v3 >= 0 ? "text-emerald-600" : "text-red-500"}>{fmtAmt(v1 - v3)}</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{v3 === 0 ? <span className="text-gray-200">—</span> : <span className={v1 - v3 >= 0 ? "text-emerald-600" : "text-red-500"}>{(((v1 - v3) / Math.abs(v3)) * 100).toFixed(1)}%</span>}</td>
                    </tr>
                  );
                })}
             {(() => {
                  const lineDef = PGC_LINES.find(l => l.key === line) ?? PGC_LINES[0];
                  const sumAll = (p, pPrev) => {
                    let total = 0;
                    p.forEach((dimMap, acCode) => {
                      if (lineDef.test(acCode)) {
                        dimCols.filter(d => !!d.code).forEach(d => {
                          const dk = d.code;
                          const ytd = dimMap.get(dk) ?? 0;
                          if (viewMode === "monthly" && pPrev) {
                            total += ytd - (pPrev.get(acCode)?.get(dk) ?? 0);
                          } else {
                            total += ytd;
                          }
                        });
                      }
                    });
                    return total;
                  };
const t1 = sumAll(pivot, prevPivot);
                  const t2 = sumAll(pivot2, prevPivot2);
                  const t3 = sumAll(pivot3, prevPivot3);
                  const fmt = v => v === 0 ? <span className="text-gray-200">—</span> : <span className={v > 0 ? "text-[#1a2f8a]" : "text-red-500"}>{fmtAmt(v)}</span>;
                  return (
                    <tr key="__total__" className="border-t-2 border-[#1a2f8a]/20 bg-[#eef1fb]">
                      <td className="sticky left-0 z-10 px-5 py-2.5 bg-[#eef1fb] border-r border-gray-100">
                        <span className="font-black text-xs text-[#1a2f8a]">Total</span>
                      </td>
<td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{fmt(t1)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{fmt(t2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{t1 === 0 && t2 === 0 ? <span className="text-gray-200">—</span> : <span className={t1 - t2 >= 0 ? "text-emerald-600" : "text-red-500"}>{fmtAmt(t1 - t2)}</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{t2 === 0 ? <span className="text-gray-200">—</span> : <span className={t1 - t2 >= 0 ? "text-emerald-600" : "text-red-500"}>{(((t1 - t2) / Math.abs(t2)) * 100).toFixed(1)}%</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{fmt(t3)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{t1 === 0 && t3 === 0 ? <span className="text-gray-200">—</span> : <span className={t1 - t3 >= 0 ? "text-emerald-600" : "text-red-500"}>{fmtAmt(t1 - t3)}</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">{t3 === 0 ? <span className="text-gray-200">—</span> : <span className={t1 - t3 >= 0 ? "text-emerald-600" : "text-red-500"}>{(((t1 - t3) / Math.abs(t3)) * 100).toFixed(1)}%</span>}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">

<div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">


        {/* Synced header */}
       <div ref={headerRef} style={{ overflowX: "auto", overflowY: "hidden", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }} onScroll={onHeaderScroll}>
          <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: ACOL, minWidth: ACOL }} />
              {dimCols.map((_, i) => <col key={i} style={{ width: DCOL, minWidth: DCOL }} />)}
              <col style={{ width: TCOL, minWidth: TCOL }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: "#1a2f8a" }}>
<th className="sticky left-0 z-30 text-left px-5 py-3 text-white font-black uppercase tracking-widest text-xs border-r border-white/20" style={{ backgroundColor: "#1a2f8a" }}>
                  <div className="flex items-center justify-between gap-3">
                    <span>Account</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white/40 text-[10px] font-bold normal-case tracking-normal">{accounts.length} accs · {dimCols.length} dims</span>
                      <button onClick={onShowAccounts}
                        className="flex items-center justify-center w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 transition-all"
                        title="View uploaded accounts">
                        <Database size={12} className="text-white/70" />
                      </button>
                    </div>
                  </div>
                </th>
                {dimCols.map(dim => (
                  <th key={dim.code ?? "__none__"} className="text-right px-4 py-3 text-white whitespace-nowrap text-xs" style={{ backgroundColor: dim.code ? "#1a2f8a" : "#0f1f5c" }}>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-black text-[11px] leading-tight truncate max-w-[120px]">{dim.name}</span>
                      {dim.code && <span className="font-normal opacity-40 text-[9px]">{dim.code}</span>}
                    </div>
                  </th>
                ))}
                <th className="sticky right-0 z-10 text-right px-4 py-3 text-white font-black whitespace-nowrap border-l border-white/20 text-xs" style={{ backgroundColor: "#0f1f5c" }}>
                  Total
                </th>
              </tr>
            </thead>
          </table>
        </div>

        {/* Synced body */}
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto", scrollbarWidth: "none", msOverflowStyle: "none" }} onScroll={onBodyScroll}>
          <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: ACOL, minWidth: ACOL }} />
              {dimCols.map((_, i) => <col key={i} style={{ width: DCOL, minWidth: DCOL }} />)}
              <col style={{ width: TCOL, minWidth: TCOL }} />
            </colgroup>
            <tbody>
              {accounts.map(account => {
                const rowTotal = getRowTotal(account.code);
                return (
                  <tr key={account.code} className="border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors">
                    <td className="py-2.5 sticky left-0 z-10 border-r border-gray-100 bg-white hover:bg-[#f8f9ff]" style={{ paddingLeft: 16, minWidth: ACOL }}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-400 flex-shrink-0">{account.code}</span>
                        <span className="text-xs text-gray-700 truncate max-w-[180px]">{account.name}</span>
                      </div>
                    </td>
                    {dimCols.map(dim => {
                      const val = getVal(account.code, dim.code ?? "__none__");
                      return (
                        <td key={dim.code ?? "__none__"} className={`px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap ${val === 0 ? "text-gray-200" : val > 0 ? "text-[#1a2f8a]" : "text-red-500"}`}>
                          {val === 0 ? "—" : fmtAmt(val)}
                        </td>
                      );
                    })}
                    <td className={`px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap sticky right-0 z-10 border-l border-gray-100 bg-[#eef1fb] font-bold ${rowTotal === 0 ? "text-gray-300" : rowTotal > 0 ? "text-[#1a2f8a]" : "text-red-500"}`} style={{ minWidth: TCOL }}>
                      {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────── */
export default function DimensionesPage({ token, sources = [], structures = [], companies = [], dimensions = [] }) {
  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [metaReady, setMetaReady] = useState(false);
const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("");
  const [company,   setCompany]   = useState("");
const [showAccounts, setShowAccounts] = useState(false);
const [selGroup, setSelGroup] = useState("");
const [compareMode, setCompareMode] = useState(false);
  const [rawData,   setRawData]   = useState([]);
const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

const autoPeriodDone = useRef(false);
  const probedRef = useRef({ source: "", structure: "", company: "" });

  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/v2/periods`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    })
      .then(r => r.json())
      .then(d => {
        const all = d.value ?? (Array.isArray(d) ? d : []);
        const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];
        const latest = all
          .filter(p => String(getP(p, "source") ?? "").toLowerCase() === "actual")
          .sort((a, b) => {
            const ay = Number(getP(a, "year") || 0), by = Number(getP(b, "year") || 0);
            const am = Number(getP(a, "month") || 0), bm = Number(getP(b, "month") || 0);
            return by !== ay ? by - ay : bm - am;
          })[0];
        if (latest) {
          setYear(String(getP(latest, "year") ?? ""));
          setMonth(String(getP(latest, "month") ?? ""));
        }
        setMetaReady(true);
      })
      .catch(() => setMetaReady(true));
  }, [token]);

useEffect(() => {
    if (!source || !structure || !company) return;
    // Only re-probe when source/structure/company actually change
    const key = `${source}|${structure}|${company}`;
    if (probedRef.current.key === key) return;
    probedRef.current.key = key;

    (async () => {
      const now = new Date();
      // Start from the year/month we got from periods, or current date
      let y = Number(year) || now.getFullYear();
      let m = Number(month) || now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
          const res = await fetch(
            `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
          );
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            if (rows.length > 0) {
              setYear(String(y));
              setMonth(String(m));
              return;
            }
          }
        } catch { /* keep probing */ }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      // No data found — allow retry on next filter change
      probedRef.current.key = "";
    })();
  }, [metaReady, source, structure, company, token]); // stable size, no year/month



useEffect(() => {
    if (sources.length > 0 && !source) {
      const s = sources[0];
      setSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
    }
  }, [sources]);

  useEffect(() => {
    if (structures.length > 0 && !structure) {
      const s = structures[0];
      setStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
    }
  }, [structures]);

  useEffect(() => {
    if (companies.length > 0 && !company) {
      const c = companies[0];
      setCompany(typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c));
    }
  }, [companies]);

  const fetchData = useCallback(async () => {
    if (!metaReady || !year || !month || !source || !structure || !company) return;
    setLoading(true);
    setError(null);
    setRawData([]);
    try {
      const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRawData(json.value ?? (Array.isArray(json) ? json : []));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
}, [metaReady, year, month, source, structure, company, authHeaders]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dimGroups = useMemo(() => {
    const seen = new Set();
    const groups = [];
    dimensions.forEach(d => {
      const g = d.DimensionGroup ?? d.dimensionGroup ?? "";
      if (g && !seen.has(g)) { seen.add(g); groups.push(g); }
    });
    return groups.sort();
  }, [dimensions]);

  const sourceOpts    = [...new Set(sources.map(s  => typeof s === "object" ? (s.source    ?? s.Source    ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const companyOpts   = [...new Set(companies.map(c  => typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)).filter(Boolean))].map(v => ({ value: v, label: v }));

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-10 rounded-full bg-[#1a2f8a]" />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Individual</p>
            <h1 className="text-[29px] font-black text-[#1a2f8a] leading-none">Dimensiones</h1>
          </div>
        </div>

<div className="w-px h-8 bg-gray-100 flex-shrink-0" />

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {sourceOpts.length > 0    && <FilterPill label="Source"    value={source}    onChange={setSource}    options={sourceOpts} />}
          {YEARS.length > 0         && <FilterPill label="Year"      value={year}      onChange={setYear}      options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />}
          {MONTHS.length > 0        && <FilterPill label="Month"     value={month}     onChange={setMonth}     options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />}
          {structureOpts.length > 0 && <FilterPill label="Structure" value={structure} onChange={setStructure} options={structureOpts} />}
{companyOpts.length > 0   && <FilterPill label="Company"   value={company}   onChange={setCompany}   options={companyOpts} />}
          {dimGroups.length > 0     && <FilterPill label="Dim Group" value={selGroup}   onChange={setSelGroup}  options={[{ value: "", label: "All" }, ...dimGroups.map(g => ({ value: g, label: g }))]} />}
        </div>



<div className="ml-auto flex items-center gap-3 flex-shrink-0 mr-6">
          {loading && <Loader2 size={13} className="animate-spin text-[#1a2f8a]" />}
          <button onClick={() => setCompareMode(c => !c)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all
              ${compareMode ? "bg-amber-400 text-[#1a2f8a] shadow-xl" : "bg-white border border-gray-200 text-gray-500 hover:text-[#1a2f8a] shadow-xl"}`}>
            <GitMerge size={12} /> Compare
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
            <p className="text-xs text-gray-400">Loading data…</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center flex-1">
          <p className="text-sm text-red-400 font-medium">{error}</p>
        </div>
      ) : rawData.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <RefreshCw size={20} className="text-[#1a2f8a]" />
            </div>
            <p className="text-sm font-bold text-gray-400">No data for selected filters</p>
            <p className="text-xs text-gray-300 mt-1">Try adjusting the filters above</p>
          </div>
        </div>
) : (
     <PivotTab data={rawData} dimensions={dimensions} onShowAccounts={() => setShowAccounts(true)} selGroup={selGroup} dimGroups={dimGroups} compareMode={compareMode} sources={sources} structures={structures} companies={companies} token={token} masterYear={year} masterMonth={month} masterSource={source} masterStructure={structure} masterCompany={company} />
      )}

      {showAccounts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAccounts(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-[95vw] h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between flex-shrink-0">
              <p className="text-white font-black text-sm">Uploaded Accounts · {rawData.length} records</p>
              <button onClick={() => setShowAccounts(false)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <X size={13} className="text-white/70" />
              </button>
            </div>
<div className="flex-1 min-h-0 overflow-hidden flex flex-col p-4 gap-3">
              <AccountsTab data={rawData} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}