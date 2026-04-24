/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ChevronDown, ChevronRight, Loader2, Maximize2, Minimize2,
  X, RefreshCw, Filter, TrendingUp, TrendingDown, BookOpen,
} from "lucide-react";

const BASE_URL = "";

const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },
];


const SUB_COLS = [
  { key: "AJE", label: "AJE", color: "text-indigo-500" },
  { key: "RJE", label: "RJE", color: "text-amber-500"  },
  { key: "EJE", label: "EJE", color: "text-rose-500"   },
  { key: "SYS", label: "SYS", color: "text-gray-400"   },
];

/* ─── Formatting ──────────────────────────────────────────────────────────── */

function fmtAmt(n) {
  if (n == null || n === 0) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (isNaN(num) || num === 0) return "—";
  return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Reporting currency (same as old code) ───────────────────────────────── */
function getReportingCurrency(companyShortName, groupStructure, companies) {
  const node = groupStructure.find(g =>
    (g.CompanyShortName ?? g.companyShortName) === companyShortName
  );
  const parentName = node?.ParentShortName ?? node?.parentShortName;
  if (!node || !parentName) {
    const own = companies.find(c =>
      (c.CompanyShortName ?? c.companyShortName) === companyShortName
    );
    return own?.CurrencyCode ?? own?.currencyCode ?? "EUR";
  }
  const parent = companies.find(c =>
    (c.CompanyShortName ?? c.companyShortName) === parentName
  );
  return parent?.CurrencyCode ?? parent?.currencyCode ?? "EUR";
}

/* ─── Sort (same as old code) ─────────────────────────────────────────────── */
function pgcSort(a, b) {
  const cA = a.AccountCode ?? a.accountCode ?? "";
  const cB = b.AccountCode ?? b.accountCode ?? "";
  const aA = /^[A-Za-z]/.test(cA), bA = /^[A-Za-z]/.test(cB);
  if (aA && !bA) return -1;
  if (!aA && bA) return 1;
  const strip  = c => c.replace(/\.S$/i, "");
  const isSum  = c => /\.S$/i.test(c);
  const bsA = strip(cA), bsB = strip(cB);
  if (bsA === bsB) {
    if (isSum(cA) && !isSum(cB)) return 1;
    if (!isSum(cA) && isSum(cB)) return -1;
    return 0;
  }
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

/* ─── Tree builder (same logic as old code) ───────────────────────────────── */
function buildTree(accounts) {
  const sorted = [...accounts].sort(pgcSort);
  const map    = new Map();
  sorted.forEach(a => {
    const code = a.AccountCode ?? a.accountCode ?? "";
    map.set(code, { ...a, AccountCode: code, children: [] });
  });
  const roots = [];
  sorted.forEach(a => {
    const code      = a.AccountCode ?? a.accountCode ?? "";
    const sumCode   = a.SumAccountCode ?? a.sumAccountCode ?? "";
    const parent    = sumCode ? map.get(sumCode) : null;
    if (parent && !/\.S$/i.test(parent.AccountCode)) {
      parent.children.push(map.get(code));
    } else {
      const isNum   = /^\d/.test(code);
      const missing = sumCode && !map.has(sumCode);
      if (!(isNum && missing)) roots.push(map.get(code));
    }
  });
  return roots;
}

/* ─── FilterPill ──────────────────────────────────────────────────────────── */
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

/* ─── Drilldown modal ─────────────────────────────────────────────────────── */
function DrilldownModal({ accountCode, accountName, company, rows, currency, onClose }) {
  const total = rows.reduce((s, r) => s + (-(Number(r.AmountYTD ?? r.amountYTD) || 0)), 0);

  const byLocal = new Map();
  rows.forEach(r => {
    const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "__none__";
    const lanm = r.LocalAccountName ?? r.localAccountName ?? "";
    const dim  = r.DimensionName    ?? r.dimensionName    ?? "";
    const amt  = -(Number(r.AmountYTD ?? r.amountYTD) || 0);
    if (!byLocal.has(lac)) byLocal.set(lac, { code: lac === "__none__" ? null : lac, name: lanm, amt: 0, dims: [] });
    const e = byLocal.get(lac);
    e.amt += amt;
    if (dim) e.dims.push(dim);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-white font-black text-sm">{accountName}</p>
            <p className="text-white/50 text-[10px] mt-0.5">{company} · {accountCode} · {currency}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-white/40 text-[9px] uppercase tracking-widest">Amount YTD</p>
              <p className={`text-lg font-black ${total >= 0 ? "text-white" : "text-red-300"}`}>{fmtAmt(total)}</p>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
              <X size={13} className="text-white/70" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Local Account Breakdown</p>
          {byLocal.size === 0 ? (
            <p className="text-xs text-gray-400">No detail available.</p>
          ) : (
            <div className="space-y-1">
              {[...byLocal.values()].map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {entry.code && <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{entry.code}</span>}
                    <span className="text-xs text-gray-600 truncate">{entry.name || "—"}</span>
                    {entry.dims.length > 0 && (
                      <span className="text-[9px] font-bold text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        {[...new Set(entry.dims)].join(", ")}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-mono font-bold flex-shrink-0 ml-4 ${entry.amt >= 0 ? "text-[#1a2f8a]" : "text-red-500"}`}>
                    {fmtAmt(entry.amt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Pivot Row ───────────────────────────────────────────────────────────── */
const INDENT = 14;

function PivotRow({ node, depth, expandedSet, onToggle, cols, pivot, onCellClick, expandedColsMap, journalPivot }) {
  const code        = node.AccountCode;
  const hasChildren = node.children?.length > 0;
  const isExpanded  = expandedSet.has(code);
  const isSummary   = /\.S$/i.test(code) || hasChildren;

const getVal = co => pivot.get(code)?.[co]?.total ?? 0;
  const getJp  = co => journalPivot?.get(code)?.[co] ?? {};
  const getSaldo = co => getVal(co);

  const rowTotal = cols.reduce((s, co) => s + getVal(co), 0);


  const cellColor = (v, bold) => {
    if (v === 0) return "text-gray-200";
    if (bold)    return v > 0 ? "font-black text-[#1a2f8a]" : "font-black text-red-500";
    return v > 0 ? "text-gray-700" : "text-red-500";
  };

  return (
    <>
      <tr className={`border-b transition-colors group
        ${isSummary ? "bg-[#ffffff] border-[#1a2f8a]/10" : "bg-white border-gray-50 hover:bg-[#f8f9ff]"}`}>

        {/* Account — sticky left */}
        <td className={`py-2.5 sticky left-0 z-10 border-r border-gray-100
          ${isSummary ? "bg-[#ffffff]" : "bg-white group-hover:bg-[#f8f9ff]"}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 280 }}>
          <div className={`flex items-center gap-1.5 ${hasChildren ? "cursor-pointer" : ""}`}
            onClick={() => hasChildren && onToggle(code)}>
            {hasChildren
              ? <span className="text-[#1a2f8a]/50 flex-shrink-0">{isExpanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            <span className={`font-mono text-xs flex-shrink-0 ${isSummary ? "text-[#1a2f8a]" : "text-gray-400"}`}>
              {code}
            </span>
            <span className={`text-xs truncate max-w-[180px] ${isSummary ? "font-bold text-[#1a2f8a]" : "text-gray-700"}`}>
              {node.AccountName ?? node.accountName ?? ""}
            </span>
          </div>
        </td>

{/* Per-company values */}
{cols.flatMap(co => {
          const val        = getVal(co);
          const rows       = pivot.get(code)?.[co]?.rows ?? [];
          const isExpanded = !!expandedColsMap[co];
          const jp         = getJp(co);
          const saldo      = getSaldo(co);

          const mainTd = (
            <td key={co}
              className={`px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap transition-colors
                ${val !== 0 && rows.length > 0 ? "cursor-pointer hover:bg-[#eef1fb]" : ""}
                ${cellColor(saldo, isSummary)}`}
              style={{ minWidth: 130 }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}
            >
{saldo === 0 ? <span className="text-gray-200">—</span> : (
                <span className="flex items-center justify-end gap-1">
                  {!isSummary && (saldo > 0
                    ? <TrendingUp size={9} className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    : <TrendingDown size={9} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                  {fmtAmt(saldo)}
                </span>
              )}
            </td>
          );

if (!isExpanded) return [mainTd];

          const uploadedTd = (
            <td key={`${co}-uploaded`}
              className={`px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap bg-[#f8f9ff] border-l border-gray-100
                ${val === 0 ? "text-gray-200" : val > 0 ? "text-gray-700" : "text-red-500"}`}
              style={{ minWidth: 110 }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}>
              {val === 0 ? "—" : fmtAmt(val)}
            </td>
          );

          const subTds = SUB_COLS.map(sc => {
            const subVal = jp[sc.key] ?? 0;
            return (
              <td key={`${co}-${sc.key}`}
                className={`px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap bg-[#f8f9ff] border-l border-gray-100
                  ${subVal === 0 ? "text-gray-200" : sc.color}`}
                style={{ minWidth: 100 }}>
                {subVal === 0 ? "—" : fmtAmt(subVal)}
              </td>
            );
          });

          return [mainTd, uploadedTd, ...subTds];
        })}

        {/* Row total — sticky right */}
        <td className={`px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap sticky right-0 z-10 border-l border-gray-100
          ${isSummary ? "bg-[#eef1fb] font-bold" : "bg-white group-hover:bg-[#f8f9ff]"}
          ${rowTotal === 0 ? "text-gray-300" : rowTotal > 0 ? "text-[#1a2f8a]" : "text-red-500"}`}
          style={{ minWidth: 140 }}>
          {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
        </td>
      </tr>

{isExpanded && hasChildren && node.children.map(child => (
        <PivotRow key={child.AccountCode} node={child} depth={depth + 1}
          expandedSet={expandedSet} onToggle={onToggle}
          cols={cols} pivot={pivot} onCellClick={onCellClick}
          expandedColsMap={expandedColsMap} journalPivot={journalPivot}
        />
      ))}
    </>
  );
}

function SyncedTable({ cols, tree, expandedSet, expandedColsMap, toggleCol, toggleExpand, pivot, journalPivot, accountMap, companies, groupStructure, hasData, collapseAll, expandAll, setDrilldown, getReportingCurrency }) {
  const headerRef    = useRef(null);
  const bodyRef      = useRef(null);

  const onBodyScroll  = useCallback(() => { if (headerRef.current) headerRef.current.scrollLeft = bodyRef.current.scrollLeft; }, []);
  const onHeaderScroll = useCallback(() => { if (bodyRef.current) bodyRef.current.scrollLeft = headerRef.current.scrollLeft; }, []);

  // Compute column widths once based on expandedColsMap
const colWidths = useMemo(() => {
    const widths = [320]; // Account col
    cols.forEach(co => {
      widths.push(150); // main saldo col
      if (expandedColsMap[co]) {
        widths.push(120); // uploaded
        SUB_COLS.forEach(() => widths.push(110)); // AJE, RJE, EJE, SYS
      }
    });
    widths.push(160); // Total col
    return widths;
  }, [cols, expandedColsMap]);

const colgroup = (
    <colgroup>
      {colWidths.map((w, i) => <col key={i} style={{ width: w, minWidth: w }} />)}
    </colgroup>
  );

  const headerCols = cols.flatMap(co => {
    const isExp = !!expandedColsMap[co];
    const legalName = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName
      ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.companyLegalName ?? co;
    const main = (
      <th key={co}
        className="text-right px-4 py-3 text-white whitespace-nowrap text-xs cursor-pointer hover:bg-white/10 transition-colors select-none"
        style={{ backgroundColor: "#1a2f8a" }}
        onClick={() => toggleCol(co)}>
        <div className="flex items-center justify-end gap-1.5">
          <div>
            <p className="font-black text-[12px] leading-tight">{legalName}</p>
            <p className="font-normal opacity-50 text-[10px]">{co} · {getReportingCurrency(co, groupStructure, companies)}</p>
          </div>
          <ChevronDown size={10} className={`opacity-50 transition-transform duration-200 flex-shrink-0 ${isExp ? "rotate-180" : ""}`} />
        </div>
      </th>
    );
if (!isExp) return [main];
    const uploadedTh = (
      <th key={`${co}-uploaded`}
        className="text-right px-3 py-3 whitespace-nowrap text-[10px] font-black border-l border-white/10 text-white/50"
        style={{ backgroundColor: "#1a3070" }}>
        Uploaded
      </th>
    );
    const subs = SUB_COLS.map(sc => (
      <th key={`${co}-${sc.key}`}
        className="text-right px-3 py-3 whitespace-nowrap text-[10px] font-black border-l border-white/10 text-white/60"
        style={{ backgroundColor: "#1e3494" }}>
        {sc.label}
      </th>
    ));
    return [main, uploadedTh, ...subs];
  });

  const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 1;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
 <div ref={headerRef}
        style={{ overflowX: "auto", overflowY: "hidden", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}
        onScroll={onHeaderScroll}>
        <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed", borderSpacing: 0 }}>
{colgroup}
          <thead>
            <tr style={{ backgroundColor: "#1a2f8a" }}>
              <th className="sticky left-0 z-30 text-left px-5 py-3 text-white font-black uppercase tracking-widest text-xs border-r border-white/20"
                style={{ backgroundColor: "#1a2f8a" }}>
                <div className="flex items-center justify-between gap-3">
                  <span>Account</span>
                  <div className="flex items-center gap-2">
                    {hasData && <span className="text-white/40 text-[10px] font-bold normal-case tracking-normal">{accountMap.size} accs · {cols.length} cols</span>}
                    {hasData && (
                      <button onClick={() => expandedSet.size > 0 ? collapseAll() : expandAll()}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all font-bold normal-case tracking-normal">
                        {expandedSet.size > 0 ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
                      </button>
                    )}
                  </div>
                </div>
              </th>
              {headerCols}
              <th className="sticky right-0 z-10 text-right px-4 py-3 text-white font-black whitespace-nowrap border-l border-white/20 text-xs"
                style={{ backgroundColor: "#0f1f5c" }}>Total</th>
            </tr>
          </thead>
        </table>
      </div>
      <div ref={bodyRef}
        style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }}
        onScroll={onBodyScroll}>
        <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed", borderSpacing: 0 }}>
{colgroup}
          <tbody>
            {tree.map(node => (
              <PivotRow key={node.AccountCode} node={node} depth={0}
                expandedSet={expandedSet} onToggle={toggleExpand}
                cols={cols} pivot={pivot}
                onCellClick={(node, co, rows) => setDrilldown({ node, company: co, rows })}
                expandedColsMap={expandedColsMap} journalPivot={journalPivot}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────────────── */
export default function ContributivePage({ token }) {
  const [periods,       setPeriods]       = useState([]);
  const [sources,       setSources]       = useState([]);
  const [structures,    setStructures]    = useState([]);
  const [companies,     setCompanies]     = useState([]);
  const [groupStructure,setGroupStructure]= useState([]);

  const [year,       setYear]       = useState("");
  const [month,      setMonth]      = useState("");
  const [source,     setSource]     = useState("");
  const [structure,  setStructure]  = useState("DefaultStructure");
  const [typeFilter, setTypeFilter] = useState("");

const [rawData,      setRawData]      = useState([]);
  const [journalData,  setJournalData]  = useState([]);
  const [showJournals, setShowJournals] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [metaReady,  setMetaReady]  = useState(false);
  const [expandedSet,setExpandedSet]= useState(new Set());
const [drilldown,       setDrilldown]       = useState(null);
  const [expandedColsMap, setExpandedColsMap] = useState({});
const _expandedCols = new Set(Object.keys(expandedColsMap).filter(k => expandedColsMap[k]));
  const toggleCol = co => setExpandedColsMap(prev => ({ ...prev, [co]: !prev[co] }));

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

  /* ── Load metadata ──────────────────────────────────────── */
  useEffect(() => {
    if (!token) return;
    const h = headers();
    Promise.all([
      fetch(`${BASE_URL}/v2/periods`,        { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/sources`,        { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/structures`,     { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/companies`,      { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/group-structure`,{ headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([per, src, str, co, gs]) => {
      setPeriods(per);
      setSources(src);
      setStructures(str);
      setCompanies(co);
      setGroupStructure(gs);

      // Default: latest Actual period — try both casings
      const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];
      const actualPer = per
        .filter(p => String(getP(p, "source") ?? "").toLowerCase() === "actual")
        .sort((a, b) => {
          const ay = Number(getP(a,"year")||0), by = Number(getP(b,"year")||0);
          const am = Number(getP(a,"month")||0), bm = Number(getP(b,"month")||0);
          return by !== ay ? by - ay : bm - am;
        });
      const latest = actualPer[0];
      if (latest) {
        setYear(String(getP(latest,"year") ?? ""));
        setMonth(String(getP(latest,"month") ?? ""));
        setSource("Actual");
      }

      // Default structure
      if (str.length > 0) {
        const s = str[0];
        const v = typeof s === "object"
          ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "")
          : String(s);
        setStructure(String(v));
      }

      setMetaReady(true);
    });
  }, [token, headers]);

  /* ── Fetch consolidated-accounts (same endpoint as old working code) ─────── */
useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure) return;
setLoading(true);
setRawData([]);
    setJournalData([]);
    setExpandedSet(new Set());
    setExpandedColsMap({});

    // This endpoint returns amounts already in reporting currency
const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    const h = headers();
    Promise.all([
      fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([consolidated, journals]) => {
       console.log("CONSOLIDATED COUNT:", consolidated.length);
  console.log("SAMPLE ROW:", consolidated[0]);
  console.log("ALL ROLES:", [...new Set(consolidated.map(r => r.CompanyRole ?? r.companyRole ?? ""))]);
      setRawData(consolidated);
      setJournalData(journals);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [year, month, source, structure, metaReady, headers]);

  /* ── Derive pivot data ──────────────────────────────────── */
const types = ["B/S", "P/L", "DIS", "C/F", "CFS"];

const { accountMap, pivot, tree, cols, journalPivot } = useMemo(() => {
    if (!rawData.length) return { filtered: [], accountMap: new Map(), pivot: new Map(), tree: [], cols: [], types: [] };

    // Filter: only Contribution/Contributive role (same as old code)
    console.log("RAW ROLES:", [...new Set(rawData.map(r => r.CompanyRole ?? r.companyRole ?? ""))]);
const filtered = rawData.filter(r => {
  const role = r.CompanyRole ?? r.companyRole ?? "";
  if (role !== "Contribution" && role !== "Contributive" && role !== "Subsidiary") return false;

      if (typeFilter) {
        const t = r.AccountType ?? r.accountType ?? "";
        if (t !== typeFilter) return false;
      }
      return true;
    });

    // Dedupe accounts for tree
    const accountMap = new Map();
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!accountMap.has(code)) {
        accountMap.set(code, {
          AccountCode:    code,
          AccountName:    r.AccountName    ?? r.accountName    ?? "",
          AccountType:    r.AccountType    ?? r.accountType    ?? "",
          SumAccountCode: r.SumAccountCode ?? r.sumAccountCode ?? "",
        });
      }
    });

    // pivot[accountCode][company] = { total, rows[] }
    // Negate like the old code: total += -(AmountYTD)
    const pivot = new Map();
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!code || !co) return;
      if (!pivot.has(code)) pivot.set(code, {});
      const c = pivot.get(code);
      if (!c[co]) c[co] = { total: 0, rows: [] };
      c[co].total += -(Number(r.AmountYTD ?? r.amountYTD) || 0);
      c[co].rows.push(r);
    });

    const tree  = buildTree([...accountMap.values()]);
const cols = [...new Set(filtered.map(r => r.CompanyShortName ?? r.companyShortName ?? "").filter(Boolean))].sort();

    const journalPivot = new Map();
    const addToJournalPivot = (code, co, jt, amt) => {
      if (!code || !co) return;
      if (!journalPivot.has(code)) journalPivot.set(code, {});
      const c = journalPivot.get(code);
      if (!c[co]) c[co] = {};
      if (!c[co][jt]) c[co][jt] = 0;
      c[co][jt] += amt;
    };
    journalData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      const cpty = r.CounterpartyShortName ?? r.counterpartyShortName ?? "";
      const jt   = String(r.JournalType ?? r.journalType ?? "").toUpperCase();
      const amt  = -(Number(r.AmountYTD ?? r.amountYTD) || 0);
addToJournalPivot(code, co, jt, amt);
      if (cpty && cpty !== co && cols.includes(cpty)) {
        addToJournalPivot(code, cpty, jt, -amt);
      }
    });

   // Roll up journalPivot through the tree so parent rows show aggregated journal amounts
    const rolledJournalPivot = new Map();
    const rollUp = (node) => {
      const code = node.AccountCode;
      const result = {};
      // Start with direct entries
      const direct = journalPivot.get(code) ?? {};
      Object.entries(direct).forEach(([co, jtMap]) => {
        if (!result[co]) result[co] = {};
        Object.entries(jtMap).forEach(([jt, amt]) => {
          result[co][jt] = (result[co][jt] ?? 0) + amt;
        });
      });
      // Add children
      (node.children || []).forEach(child => {
        const childRolled = rollUp(child);
        Object.entries(childRolled).forEach(([co, jtMap]) => {
          if (!result[co]) result[co] = {};
          Object.entries(jtMap).forEach(([jt, amt]) => {
            result[co][jt] = (result[co][jt] ?? 0) + amt;
          });
        });
      });
      rolledJournalPivot.set(code, result);
      return result;
    };
    tree.forEach(rollUp);

    return { accountMap, pivot, tree, cols, journalPivot: rolledJournalPivot };
  }, [rawData, journalData, typeFilter]);

  const toggleExpand = useCallback(code => {
    setExpandedSet(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }, []);

  const expandAll   = useCallback(() => setExpandedSet(new Set([...accountMap.keys()])), [accountMap]);
  const collapseAll = useCallback(() => setExpandedSet(new Set()), []);

  // Grand totals
  const colTotal = co => [...accountMap.keys()].reduce((s, code) => s + (pivot.get(code)?.[co]?.total ?? 0), 0);
  const _grandTotal = cols.reduce((s, co) => s + colTotal(co), 0);

  // Filter options — handle both casings
  const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];

  const yearOpts = [...new Set(periods.map(p => Number(getP(p,"year")||0)).filter(n => n > 0))]
    .sort((a,b) => b - a).map(y => ({ value: String(y), label: String(y) }));

  const monthOpts = [...new Set(periods.map(p => Number(getP(p,"month")||0)).filter(n => n > 0))]
    .sort((a,b) => a - b)
    .map(m => ({ value: String(m), label: MONTHS.find(mo => mo.value === m)?.label ?? String(m) }));

  const sourceOpts = [...new Set(sources.map(s => {
    const v = typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const structureOpts = [...new Set(structures.map(s => {
    const v = typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const hasData = rawData.length > 0 && tree.length > 0;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
{showJournals && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowJournals(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-white font-black text-sm">Journal Entries</p>
                <p className="text-white/50 text-[10px]">{journalData.length} entries · {year} · {MONTHS.find(m => m.value === Number(month))?.label} · {source}</p>
              </div>
              <button onClick={() => setShowJournals(false)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <X size={13} className="text-white/70" />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#eef1fb]">
                    {["Company","Account","Type","Journal #","Header","J.Type","Layer","Counterparty","Dimension","Amount YTD","CCY","Row Text","Posted","Sys Gen"].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] font-black text-[#1a2f8a] uppercase tracking-widest whitespace-nowrap border-b border-gray-200">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {journalData.map((r, i) => (
                    <tr key={i} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/40"}`}>
                      <td className="px-3 py-2 whitespace-nowrap font-bold text-gray-700">{r.CompanyShortName ?? r.companyShortName}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="font-mono text-gray-400 mr-1">{r.AccountCode ?? r.accountCode}</span><span className="text-gray-600">{r.AccountName ?? r.accountName}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.AccountType ?? r.accountType}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono font-bold text-[#1a2f8a]">{r.JournalNumber ?? r.journalNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 max-w-[180px] truncate">{r.JournalHeader ?? r.journalHeader}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold">{r.JournalType ?? r.journalType}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.JournalLayer ?? r.journalLayer}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.CounterpartyShortName ?? r.counterpartyShortName}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.DimensionName ?? r.dimensionName}</td>
                      <td className={`px-3 py-2 whitespace-nowrap font-mono font-bold text-right ${(r.AmountYTD ?? r.amountYTD) >= 0 ? "text-[#1a2f8a]" : "text-red-500"}`}>{fmtAmt(r.AmountYTD ?? r.amountYTD)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{r.CurrencyCode ?? r.currencyCode}</td>
                      <td className="px-3 py-2 text-gray-400 max-w-[160px] truncate">{r.RowText ?? r.rowText}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded font-bold ${(r.Posted ?? r.posted) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{(r.Posted ?? r.posted) ? "Yes" : "No"}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded font-bold ${(r.SystemGenerated ?? r.systemGenerated) ? "bg-gray-100 text-gray-500" : "bg-white text-gray-400"}`}>{(r.SystemGenerated ?? r.systemGenerated) ? "Yes" : "No"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Drilldown */}
      {drilldown && (
        <DrilldownModal
          accountCode={drilldown.node.AccountCode}
          accountName={drilldown.node.AccountName ?? drilldown.node.accountName ?? ""}
          company={drilldown.company}
          rows={drilldown.rows}
          currency={getReportingCurrency(drilldown.company, groupStructure, companies)}
          onClose={() => setDrilldown(null)}
        />
      )}

{/* Header */}
      <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-10 rounded-full bg-[#1a2f8a]" />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Accounts</p>
            <h1 className="text-[29px] font-black text-[#1a2f8a] leading-none">Contributive</h1>
          </div>
        </div>

<div className="w-px h-8 bg-gray-100 flex-shrink-0" />

        {types.length > 0 && (
          <div className="flex items-center gap-1 p-1 bg-[#e6e6e6] rounded-2xl flex-shrink-0 shadow-xl">
            <button onClick={() => setTypeFilter("")}
              className={`px-3 py-2 rounded-2xl text-xs font-black transition-all ${!typeFilter ? "bg-white text-[#1a2f8a] shadow-sm" : "text-[#636363]"}`}>
              All
            </button>
            {types.map(t => (
              <button key={t} onClick={() => setTypeFilter(t === typeFilter ? "" : t)}
                className={`px-3 py-2 rounded-2xl text-xs font-black transition-all ${typeFilter === t ? "bg-white text-[#1a2f8a] shadow-sm" : "text-[#636363]"}`}>
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

<div className="flex items-center gap-2 flex-wrap">
          {sourceOpts.length > 0    && <FilterPill label="Source"    value={source}    onChange={setSource}    options={sourceOpts}    />}
          {yearOpts.length > 0      && <FilterPill label="Year"      value={year}      onChange={setYear}      options={yearOpts}      />}
          {monthOpts.length > 0     && <FilterPill label="Month"     value={month}     onChange={setMonth}     options={monthOpts}     />}
          {structureOpts.length > 0 && <FilterPill label="Structure" value={structure} onChange={setStructure} options={structureOpts} />}
        </div>

<div className="ml-auto flex items-center gap-3 flex-shrink-0 mr-6">
          {loading && <Loader2 size={13} className="animate-spin text-[#1a2f8a]" />}
          {journalData.length > 0 && (
            <button onClick={() => setShowJournals(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#eef1fb] text-[#1a2f8a] text-xs font-black hover:bg-[#1a2f8a] hover:text-white transition-all">
              Journal Entries ({journalData.length})
            </button>
          )}
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export Excel">
            <img src="https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png" width="44" height="36" alt="Excel" />
          </button>
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export PDF">
            <img src="https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png" width="30" height="36" alt="PDF" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0" style={{ overflow: "hidden" }}>
        {!metaReady || loading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
              <p className="text-xs text-gray-400">{!metaReady ? "Loading metadata…" : "Building contributive view…"}</p>
            </div>
          </div>
        ) : !hasData ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <RefreshCw size={20} className="text-[#1a2f8a]" />
              </div>
              <p className="text-sm font-bold text-gray-400">No data for selected filters</p>
              <p className="text-xs text-gray-300 mt-1">Try adjusting the source, year or month</p>
            </div>
          </div>
) : (
<SyncedTable
  cols={cols}
  tree={tree}
  expandedSet={expandedSet}
  expandedColsMap={expandedColsMap}
  toggleCol={toggleCol}
  toggleExpand={toggleExpand}
  pivot={pivot}
  journalPivot={journalPivot}
  accountMap={accountMap}
  companies={companies}
  groupStructure={groupStructure}
  hasData={hasData}
  collapseAll={collapseAll}
  expandAll={expandAll}
  setDrilldown={setDrilldown}
  getReportingCurrency={getReportingCurrency}
/>
)}
      </div>
    </div>
  );
}