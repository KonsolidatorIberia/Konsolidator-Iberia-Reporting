import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Loader2, X, RefreshCw, Search, Database, GitMerge, Maximize2, Minimize2, Library, Download, TrendingUp, Scale } from "lucide-react";
import PageHeader from "./PageHeader.jsx";
import MappingsModal from "./Mappings.jsx";
import { useTypo, useSettings } from "./SettingsContext";
const BASE_URL = "";

// ════════════════════════════════════════════════════════════════════════════
// KPI RESOLVER (same as individual Dimensiones)
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

const SB_HEADERS = {
  apikey:        SUPABASE_APIKEY,
  Authorization: `Bearer ${SUPABASE_APIKEY}`,
};
const sbGet = (path) =>
  fetch(`${SUPABASE_URL}/${path}`, { headers: SB_HEADERS }).then(r => r.json());

function detectStandard(groupAccounts) {
  if (!groupAccounts?.length) return null;
  const codes = [];
  groupAccounts.forEach(n => {
    const ac = String(n.accountCode ?? n.AccountCode ?? "");
    const pc = String(n.parentCode  ?? n.ParentCode  ?? "");
    if (ac) codes.push(ac);
    if (pc) codes.push(pc);
  });
  if (codes.length === 0) return null;
  const isPGC = codes.some(c => c.endsWith(".S"));
  const isSpanishIfrsEs = !isPGC && codes.some(c => c.endsWith(".PL"));
  const isSpanishIFRS = !isPGC && !isSpanishIfrsEs && codes.some(c => /^[A-Z]\.\d/.test(c));
  const isDanishIFRS = !isPGC && !isSpanishIfrsEs && !isSpanishIFRS && codes.some(c => /^\d{5,6}$/.test(c));
  if (isPGC)           return "PGC";
  if (isSpanishIfrsEs) return "SpanishIFRS-ES";
  if (isSpanishIFRS)   return "SpanishIFRS";
  if (isDanishIFRS)    return "DanishIFRS";
  return null;
}

const STANDARD_TO_PL_TABLE = {
  PGC: "pgc_pl_rows",
  DanishIFRS: "danish_ifrs_pl_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_pl_rows",
};

async function loadStandardMapping(standard, groupAccounts) {
  const plTable = STANDARD_TO_PL_TABLE[standard];
  if (!plTable) return null;

  const plRows = await sbGet(`${plTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`);
  const allRows = Array.isArray(plRows) ? plRows : [];

  const codeCcTag = new Map();
  for (const r of allRows) {
    if (r.cc_tag) codeCcTag.set(String(r.account_code), r.cc_tag);
  }

  const parentOf = new Map();
  for (const ga of (groupAccounts || [])) {
    if (ga.AccountCode && ga.SumAccountCode) {
      parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
    }
  }

  const resolveCcTag = (code) => {
    let cur = String(code);
    let hops = 0;
    while (cur && hops < 25) {
      if (codeCcTag.has(cur)) return codeCcTag.get(cur);
      cur = parentOf.get(cur);
      hops++;
    }
    return null;
  };

  const ccTagToCodes = new Map();
  for (const ga of (groupAccounts || [])) {
    const code = String(ga.AccountCode);
    const foundTag = resolveCcTag(code);
    if (foundTag) {
      if (!ccTagToCodes.has(foundTag)) ccTagToCodes.set(foundTag, []);
      ccTagToCodes.get(foundTag).push(code);
    }
  }

  console.log(`[ConsDim Resolver] ${standard} mapping loaded: ${ccTagToCodes.size} cc_tags`);
  return { ccTagToCodes, resolveCcTag };
}

async function loadKpiLibrary() {
  const defs = await sbGet("kpi_definitions?select=*&order=sort_order.asc");
  if (!Array.isArray(defs)) return [];
  return defs.map(d => ({
    id:       d.id,
    label:    d.label,
    category: d.category ?? "",
    format:   d.format ?? "currency",
    formula:  d.formula,
  }));
}

function useKpiResolver(groupAccounts) {
  const standard = useMemo(() => detectStandard(groupAccounts), [groupAccounts]);
  const [state, setState] = useState({
    kpiList: [],
    ccTagToCodes: new Map(),
    resolveCcTag: () => null,
    standard: null,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!standard) { setState(s => ({ ...s, ready: true })); return; }
    setState(s => ({ ...s, ready: false }));
    Promise.all([loadStandardMapping(standard, groupAccounts), loadKpiLibrary()])
      .then(([mapping, kpiList]) => {
        if (cancelled) return;
        setState({
          kpiList,
          ccTagToCodes: mapping?.ccTagToCodes ?? new Map(),
          resolveCcTag: mapping?.resolveCcTag ?? (() => null),
          standard,
          ready: true,
        });
      })
      .catch(e => {
        if (cancelled) return;
        console.error("[ConsDim Resolver] load failed:", e);
        setState(s => ({ ...s, ready: true }));
      });
    return () => { cancelled = true; };
  }, [standard, groupAccounts]);

  return state;
}

function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, resolveCcTag) {
  if (!node) return 0;
  switch (node.type) {
    case "manual": return Number(node.value) || 0;
    case "op": {
      const l = evalFormulaWithCcTags(node.left,  pivot, cache, kpiList, ccTagToCodes, resolveCcTag);
      const r = evalFormulaWithCcTags(node.right, pivot, cache, kpiList, ccTagToCodes, resolveCcTag);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? null : l / r;
      return 0;
    }
    case "fn": {
      const a = evalFormulaWithCcTags(node.arg, pivot, cache, kpiList, ccTagToCodes, resolveCcTag);
      if (a === null) return null;
      if (node.fn === "abs") return Math.abs(a);
      if (node.fn === "neg") return -a;
      if (node.fn === "pct") return a * 100;
      return a;
    }
    case "ref": {
      if (cache.has(node.kpiId)) return cache.get(node.kpiId);
      const ref = kpiList.find(k => k.id === node.kpiId);
      if (!ref) return 0;
      const val = evalFormulaWithCcTags(ref.formula, pivot, cache, kpiList, ccTagToCodes, resolveCcTag);
      cache.set(node.kpiId, val);
      return val;
    }
    case "text": {
      if (!node.expression || !node.variables) return 0;
      try {
        let expr = node.expression;
        Object.entries(node.variables).forEach(([letter, varNode]) => {
          const v = varNode ? evalFormulaWithCcTags(varNode, pivot, cache, kpiList, ccTagToCodes, resolveCcTag) : 0;
          expr = expr.replaceAll(letter, `(${v ?? 0})`);
        });
        return Function(`"use strict"; return (${expr})`)() ?? 0;
      } catch { return null; }
    }
    case "cc": {
      const knownCodes = ccTagToCodes.get(node.tag) ?? [];
      const knownSet = new Set(knownCodes);
      let total = 0;
      for (const code of knownCodes) {
        total += pivot.get(code) ?? 0;
      }
      if (resolveCcTag) {
        pivot.forEach((val, code) => {
          if (knownSet.has(code)) return;
          const tag = resolveCcTag(code);
          if (tag === node.tag) total += val;
        });
      }
      return -total;
    }
    default: return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════

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

function parseDimensions(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("||").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
  }).filter(Boolean);
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

function pgcSort(a, b) {
  const cA = a.AccountCode || a.code || "";
  const cB = b.AccountCode || b.code || "";
  const aA = /^[A-Za-z]/.test(cA), bA = /^[A-Za-z]/.test(cB);
  if (aA && !bA) return -1;
  if (!aA && bA) return 1;
  const strip = c => c.replace(/\.S$/i, "");
  const isSum = c => /\.S$/i.test(c);
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

function buildTree(accounts) {
  const normalized = accounts.map(a => ({
    ...a,
    AccountCode:    a.AccountCode    ?? a.accountCode    ?? "",
    AccountName:    a.AccountName    ?? a.accountName    ?? "",
    SumAccountCode: a.SumAccountCode ?? a.sumAccountCode ?? "",
  })).filter(a => a.AccountCode);

  const sorted = [...normalized].sort(pgcSort);
  const map = new Map();
  sorted.forEach(a => map.set(a.AccountCode, { ...a, children: [] }));

  const hasPgcSummaries = sorted.some(a => /\.S$/i.test(a.AccountCode));

  const roots = [];
  sorted.forEach(a => {
    const parent = a.SumAccountCode ? map.get(a.SumAccountCode) : null;
    const canAttach = parent && (hasPgcSummaries ? !/\.S$/i.test(parent.AccountCode) : true);

    if (canAttach) {
      parent.children.push(map.get(a.AccountCode));
    } else {
      if (hasPgcSummaries) {
        const isNum   = /^\d/.test(a.AccountCode);
        const missing = a.SumAccountCode && !map.has(a.SumAccountCode);
        if (isNum && missing) return;
      }
      roots.push(map.get(a.AccountCode));
    }
  });
  return roots;
}

function FilterPill({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const filterTypo = useTypo("filter");
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
        style={filterTypo}>
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
        <span>{display}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 text-[#1a2f8a]/40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {options.map(o => {
              const selected = String(o.value) === String(value);
              return (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between gap-3
                    ${selected ? "bg-[#1a2f8a] text-white" : "hover:bg-[#eef1fb]"}`}
                  style={selected ? { ...filterTypo, color: "#ffffff" } : filterTypo}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const INDENT = 14;

function DimensionRow({ node, depth, expandedSet, onToggle, dimCols, getVal, body1Style, body2Style, header2Style, colors, excludeCodes = null }) {
  const code = node.AccountCode;
  const visibleChildren = excludeCodes
    ? (node.children || []).filter(c => !excludeCodes.has(String(c.AccountCode)))
    : (node.children || []);
  const hasChildren = visibleChildren.length > 0;
  const isExpanded = expandedSet.has(code);

  const getNodeVal = (dimKey) => {
    const ownVal = getVal(code, dimKey);
    if (ownVal !== 0) return ownVal;
    if (!hasChildren) return 0;
    let total = 0;
    const sumChildren = (n) => {
      n.children.forEach(c => {
        const cv = getVal(c.AccountCode, dimKey);
        if (cv !== 0) {
          total += cv;
        } else if (c.children?.length) {
          sumChildren(c);
        }
      });
    };
    sumChildren(node);
    return total;
  };
  const rowTotal = dimCols.reduce((s, d) => s + getNodeVal(d.code ?? "__none__"), 0);

  const cellColor = (v) => v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
  const rowStyle = depth === 0 ? body1Style : body2Style;

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors group">
        <td className="py-2.5 sticky left-0 z-10 border-r border-gray-100 bg-white group-hover:bg-[#f8f9ff]"
          style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 300 }}>
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}
            onClick={() => hasChildren && onToggle(code)}>
            {hasChildren
              ? <span className="flex-shrink-0 mr-2" style={{ color: rowStyle?.color }}>
                  {isExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                </span>
              : <span className="inline-block mr-2" style={{ width: 12 }} />}
            <span className="flex-shrink-0 mr-2" style={rowStyle}>{code}</span>
            <span className="truncate max-w-[280px]" style={rowStyle}>{node.AccountName ?? node.accountName ?? ""}</span>
          </div>
        </td>
        {dimCols.map(dim => {
          const val = getNodeVal(dim.code ?? "__none__");
          return (
            <td key={dim.code ?? "__none__"}
              className="px-4 py-2.5 text-center whitespace-nowrap"
              style={{ ...rowStyle, color: cellColor(val) }}>
              {val === 0 ? "—" : fmtAmt(val)}
            </td>
          );
        })}
        <td className="px-4 py-2.5 text-center whitespace-nowrap sticky right-0 z-10 border-l border-gray-100 bg-[#fafafa]"
          style={{ ...rowStyle, color: cellColor(rowTotal), minWidth: 150 }}>
          {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
        </td>
      </tr>
      {isExpanded && hasChildren && visibleChildren.map(child => (
        <DimensionRow key={child.AccountCode} node={child} depth={depth + 1}
          expandedSet={expandedSet} onToggle={onToggle}
          dimCols={dimCols} getVal={getVal}
          body1Style={body1Style} body2Style={body2Style}
          header2Style={header2Style} colors={colors}
          excludeCodes={excludeCodes} />
      ))}
    </>
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

/* ── Pivot Tab (CONSOLIDATED) ─────────────────────────────────────── */
function PivotTab({
  data, dimensions, groupAccounts = [], onShowAccounts, selGroup, compareMode,
  sources = [], structures = [], companies = [], token = "",
  masterYear = "", masterMonth = "", masterSource = "", masterStructure = "", masterTopParent = "",
  kpiList = [], ccTagToCodes = new Map(), resolveCcTag = () => null,
  plMapping = null, bsMapping = null,
  statementType = "pl",
}) {
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const header3Style = useTypo("header3");
  const { colors } = useSettings();

const [summaryMode, setSummaryMode] = useState(true);

  const headerRef = useRef(null);
  const bodyRef   = useRef(null);
  const onBodyScroll   = useCallback(() => { if (headerRef.current) headerRef.current.scrollLeft = bodyRef.current.scrollLeft; }, []);
  const onHeaderScroll = useCallback(() => { if (bodyRef.current)   bodyRef.current.scrollLeft = headerRef.current.scrollLeft; }, []);

  const [expandedSet, setExpandedSet] = useState(new Set());

  const toggleExpand = useCallback(code => {
    setExpandedSet(prev => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  }, []);

  // ─── Build pivot from CONSOLIDATED data ───────────────────────────
  // The consolidated endpoint returns rows tagged with CompanyRole:
  //   - "Group"        → consolidated total at the holding level (with eliminations)
  //   - "Parent"       → holding's own contribution (before eliminations)
  //   - "Contribution" → each subsidiary's contribution
  //
  // Dimensions only apply to Parent + Contribution rows (Group rows are
  // post-elimination aggregates without dim tags). We build the pivot from
  // those so we can break the consolidated number out by dimension.
  const { tree, accountMap: allAccountMap, dimCols, pivot } = useMemo(() => {
    if (!data.length) return { tree: [], accountMap: new Map(), dimCols: [], pivot: new Map() };

    const rows = data.filter(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      // Take Parent + Contribution rows (these carry dimensions).
      if (role !== "Parent" && role !== "Contribution") return false;
      // Filter by selected dim group if any.
      if (selGroup) {
        const pairs = parseDimensions(r.Dimensions);
        if (pairs.length === 0) return true;
        if (!pairs.some(([group]) => group === selGroup)) return false;
      }
      return true;
    });

    const dataAccountInfo = new Map();
    rows.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!code) return;
      const acType = r.AccountType ?? r.accountType ?? "";
      if (acType && acType !== "P/L") return;
      if (!dataAccountInfo.has(code)) {
        dataAccountInfo.set(code, {
          AccountCode: code,
          AccountName: r.AccountName ?? r.accountName ?? "",
          SumAccountCode: r.SumAccountCode ?? r.sumAccountCode ?? "",
          AccountType: acType,
        });
      }
    });

    const groupMap = new Map();
    (groupAccounts || []).forEach(a => {
      const code = a.AccountCode ?? a.accountCode ?? "";
      if (!code) return;
      const acType = a.AccountType ?? a.accountType ?? "";
      if (acType && acType !== "P/L") return;
      groupMap.set(code, {
        AccountCode: code,
        AccountName: a.AccountName ?? a.accountName ?? "",
        SumAccountCode: a.SumAccountCode ?? a.sumAccountCode ?? "",
        AccountType: acType,
        IsSumAccount: a.IsSumAccount ?? a.isSumAccount ?? false,
      });
    });

    const accountMap = new Map();
    if (groupMap.size > 0) {
      const includeWithAncestors = (code) => {
        if (accountMap.has(code)) return;
        const a = groupMap.get(code);
        if (!a) {
          const fallback = dataAccountInfo.get(code);
          if (fallback) accountMap.set(code, fallback);
          return;
        }
        accountMap.set(code, a);
        if (a.SumAccountCode) includeWithAncestors(a.SumAccountCode);
      };
      dataAccountInfo.forEach((_, code) => includeWithAncestors(code));
    } else {
      dataAccountInfo.forEach((info, code) => accountMap.set(code, info));
    }

    const tree = buildTree([...accountMap.values()]);

    // Dim columns
    const dimMap = new Map();
    rows.forEach(r => {
      const pairs = parseDimensions(r.Dimensions);
      if (pairs.length === 0) {
        if (!dimMap.has("__none__")) dimMap.set("__none__", { code: null, name: "No Dimension", group: null });
        return;
      }
for (const [group, code] of pairs) {
        if (selGroup && group !== selGroup) continue;
        if (!dimMap.has(code)) {
          const dimObj = dimensions?.find(d =>
            (d.DimensionCode ?? d.dimensionCode ?? d.Code ?? d.code) === code
          );
          const fullName = dimObj?.DimensionName ?? dimObj?.dimensionName ?? dimObj?.Name ?? dimObj?.name ?? code;
          dimMap.set(code, { code, name: fullName, group });
        }
      }
    });
    const dimCols = [...dimMap.values()].sort((a, b) => {
      if (!a.code && b.code) return 1;
      if (a.code && !b.code) return -1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    // Pivot
    const pivot = new Map();
    rows.forEach(r => {
      const ac  = r.AccountCode ?? r.accountCode ?? "";
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? r.AmountPeriod ?? r.amountPeriod ?? 0);
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (acType && acType !== "P/L") return;

      const pairs = parseDimensions(r.Dimensions);
      if (pairs.length === 0) {
        if (!pivot.has(ac)) pivot.set(ac, new Map());
        pivot.get(ac).set("__none__", (pivot.get(ac).get("__none__") ?? 0) + amt);
        return;
      }

      for (const [group, code] of pairs) {
        if (selGroup && group !== selGroup) continue;
        if (!pivot.has(ac)) pivot.set(ac, new Map());
        pivot.get(ac).set(code, (pivot.get(ac).get(code) ?? 0) + amt);
      }
    });

    return { tree, accountMap, dimCols, pivot };
  }, [data, selGroup, groupAccounts]);

  const expandAll = useCallback(() => {
    setExpandedSet(new Set([...allAccountMap.keys()]));
  }, [allAccountMap]);

  const collapseAll = useCallback(() => setExpandedSet(new Set()), []);

  const getVal = (ac, dk) => pivot.get(ac)?.get(dk) ?? 0;

  // Compare states
  const [cmp2Source, setCmp2Source]       = useState(masterSource);
  const [cmp2Year, setCmp2Year]           = useState(masterYear);
  const [cmp2Month, setCmp2Month]         = useState(masterMonth);
  const [cmp2Structure, setCmp2Structure] = useState(masterStructure);
  const [cmp2TopParent, setCmp2TopParent] = useState(masterTopParent);
  const [cmp3Source, setCmp3Source]       = useState(masterSource);
  const [cmp3Year, setCmp3Year]           = useState(masterYear);
  const [cmp3Month, setCmp3Month]         = useState(masterMonth);
  const [cmp3Structure, setCmp3Structure] = useState(masterStructure);
  const [cmp3TopParent, setCmp3TopParent] = useState(masterTopParent);

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
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Parent" && role !== "Contribution") return;
      const ac  = r.AccountCode ?? r.accountCode ?? "";
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (acType && acType !== "P/L") return;

      const pairs = parseDimensions(r.Dimensions);
      if (pairs.length === 0) {
        if (!p.has(ac)) p.set(ac, new Map());
        p.get(ac).set("__none__", (p.get(ac).get("__none__") ?? 0) + amt);
        return;
      }

      for (const [group, code] of pairs) {
        if (selGroup && group !== selGroup) continue;
        if (!p.has(ac)) p.set(ac, new Map());
        p.get(ac).set(code, (p.get(ac).get(code) ?? 0) + amt);
      }
    });
    return p;
  }, [selGroup]);

  const pivot2 = useMemo(() => buildPivot(cmp2Data), [cmp2Data, buildPivot]);
  const pivot3 = useMemo(() => buildPivot(cmp3Data), [cmp3Data, buildPivot]);

  const fetchCmpData = useCallback(async (yr, mo, src, str, gp, setter, loadSetter) => {
    if (!yr || !mo || !src || !str || !gp) return;
    loadSetter(true);
    try {
      const filter = `Year eq ${yr} and Month eq ${mo} and Source eq '${src}' and GroupStructure eq '${str}' and GroupShortName eq '${gp}'`;
      const res = await fetch(
        `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setter(json.value ?? (Array.isArray(json) ? json : []));
    } catch { setter([]); }
    finally { loadSetter(false); }
  }, [token]);

  useEffect(() => {
    if (!compareMode || viewMode !== "monthly" || !masterYear || !masterMonth || !masterSource || !masterStructure || !masterTopParent) return;
    const mo = Number(masterMonth);
    const yr = Number(masterYear);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), masterSource, masterStructure, masterTopParent, (d) => setPrevPivot(buildPivot(d)), () => {});
  }, [compareMode, viewMode, masterYear, masterMonth, masterSource, masterStructure, masterTopParent, fetchCmpData, buildPivot]);

  useEffect(() => {
    if (compareMode) fetchCmpData(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2TopParent, setCmp2Data, setCmp2Loading);
  }, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2TopParent, fetchCmpData]);

  useEffect(() => {
    if (compareMode) fetchCmpData(cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3TopParent, setCmp3Data, setCmp3Loading);
  }, [compareMode, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3TopParent, fetchCmpData]);

  useEffect(() => {
    if (!compareMode || viewMode !== "monthly" || !cmp2Year || !cmp2Month || !cmp2Source || !cmp2Structure || !cmp2TopParent) return;
    const mo = Number(cmp2Month);
    const yr = Number(cmp2Year);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), cmp2Source, cmp2Structure, cmp2TopParent, (d) => setPrevPivot2(buildPivot(d)), () => {});
  }, [compareMode, viewMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2TopParent, fetchCmpData, buildPivot]);

  useEffect(() => {
    if (!compareMode || viewMode !== "monthly" || !cmp3Year || !cmp3Month || !cmp3Source || !cmp3Structure || !cmp3TopParent) return;
    const mo = Number(cmp3Month);
    const yr = Number(cmp3Year);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), cmp3Source, cmp3Structure, cmp3TopParent, (d) => setPrevPivot3(buildPivot(d)), () => {});
  }, [compareMode, viewMode, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3TopParent, fetchCmpData, buildPivot]);

  const cmpSources    = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const cmpYears      = YEARS.map(y => ({ value: String(y), label: String(y) }));
  const cmpMonths     = MONTHS.map(m => ({ value: String(m.value), label: m.label }));
  const cmpStructures = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const cmpHoldings   = [...new Set(companies.map(c => typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)).filter(Boolean))].map(v => ({ value: v, label: v }));

  const ACOL = 480, DCOL = 140, TCOL = 150;
  const totalWidth = ACOL + dimCols.length * DCOL + TCOL;

  const lineOptions = useMemo(() => {
    const visibleDims = dimCols.filter(d => !!d.code);
    const evalKpiAcrossDims = (kpi, p, pPrev) => {
      for (const dim of visibleDims) {
        const dk = dim.code;
        const flat = new Map();
        p.forEach((dimMap, acCode) => {
          const ytd = dimMap.get(dk) ?? 0;
          if (viewMode === "monthly" && pPrev) {
            const prevYtd = pPrev.get(acCode)?.get(dk) ?? 0;
            flat.set(acCode, ytd - prevYtd);
          } else {
            flat.set(acCode, ytd);
          }
        });
        const cache = new Map();
        const v = evalFormulaWithCcTags(kpi.formula, flat, cache, kpiList, ccTagToCodes, resolveCcTag);
        if (v !== null && !isNaN(v) && Math.abs(v) > 0.005) return true;
      }
      return false;
    };

    const opts = [{ value: "all", label: "All" }];
    kpiList
      .filter(k => k.format !== "percent")
      .forEach(k => {
        const has = evalKpiAcrossDims(k, pivot, prevPivot)
                 || evalKpiAcrossDims(k, pivot2, prevPivot2)
                 || evalKpiAcrossDims(k, pivot3, prevPivot3);
        if (has) opts.push({ value: k.id, label: k.label });
      });
    return opts;
  }, [kpiList, ccTagToCodes, resolveCcTag, dimCols, viewMode, pivot, prevPivot, pivot2, prevPivot2, pivot3, prevPivot3]);

  useEffect(() => {
    if (line !== "all" && !lineOptions.some(o => o.value === line)) {
      setLine("all");
    }
  }, [lineOptions, line]);

  // Filter rows by P&L / B/S
  const activeMapping = statementType === "pl" ? plMapping : bsMapping;
  const targetAccountType = statementType === "pl" ? ["P/L", "DIS"] : ["B/S"];

  const displayedTree = useMemo(() => {
    if (!data.length) return [];
    const groupMap = new Map();
    (groupAccounts || []).forEach(a => {
      const code = a.AccountCode ?? a.accountCode ?? "";
      const acType = a.AccountType ?? a.accountType ?? "";
      if (!code) return;
      if (!targetAccountType.includes(acType)) return;
      groupMap.set(code, {
        AccountCode: code,
        AccountName: a.AccountName ?? a.accountName ?? "",
        SumAccountCode: a.SumAccountCode ?? a.sumAccountCode ?? "",
        AccountType: acType,
        IsSumAccount: a.IsSumAccount ?? a.isSumAccount ?? false,
      });
    });

    const dataAccountInfo = new Map();
    data.forEach(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Parent" && role !== "Contribution") return;
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!code) return;
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!targetAccountType.includes(acType)) return;
      if (selGroup) {
        const pairs = parseDimensions(r.Dimensions);
        if (pairs.length > 0 && !pairs.some(([g]) => g === selGroup)) return;
      }
      if (!dataAccountInfo.has(code)) {
        dataAccountInfo.set(code, {
          AccountCode: code,
          AccountName: r.AccountName ?? r.accountName ?? "",
          SumAccountCode: r.SumAccountCode ?? r.sumAccountCode ?? "",
          AccountType: acType,
        });
      }
    });

    const accountMap = new Map();
    if (groupMap.size > 0) {
      const includeWithAncestors = (code) => {
        if (accountMap.has(code)) return;
        const a = groupMap.get(code);
        if (!a) {
          const fb = dataAccountInfo.get(code);
          if (fb) accountMap.set(code, fb);
          return;
        }
        accountMap.set(code, a);
        if (a.SumAccountCode) includeWithAncestors(a.SumAccountCode);
      };
      dataAccountInfo.forEach((_, code) => includeWithAncestors(code));
    } else {
      dataAccountInfo.forEach((info, code) => accountMap.set(code, info));
    }

    return buildTree([...accountMap.values()]);
  }, [data, groupAccounts, selGroup, statementType]); // eslint-disable-line react-hooks/exhaustive-deps

  const treeIndex = useMemo(() => {
    const idx = new Map();
    const walk = (nodes) => nodes.forEach(n => { idx.set(String(n.AccountCode), n); walk(n.children || []); });
    walk(displayedTree);
    return idx;
  }, [displayedTree]);

  const orderedRows = useMemo(() => {
    if (activeMapping?.rows) {
      const filterFn = summaryMode ? (info => info.showInSummary) : (info => info.isSum);
      return [...activeMapping.rows.entries()]
        .filter(([, info]) => filterFn(info))
        .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
        .map(([code]) => treeIndex.get(code))
        .filter(Boolean);
    }
    return displayedTree;
  }, [activeMapping, summaryMode, treeIndex, displayedTree]);

  const palette = [colors.primary, colors.secondary, colors.tertiary];
  const dividerMap = useMemo(() => {
    if (!activeMapping?.rows || !activeMapping?.sections) return {};
    const seen = new Set();
    const out = {};
    let i = 0;
    for (const node of orderedRows) {
      const m = activeMapping.rows.get(String(node.AccountCode));
      if (!m) continue;
      if (seen.has(m.section)) continue;
      seen.add(m.section);
      const sec = activeMapping.sections.get(m.section);
      if (sec) {
        out[String(node.AccountCode)] = { label: sec.label, color: palette[i] ?? sec.color };
        i++;
      }
    }
    return out;
  }, [activeMapping, orderedRows, colors]); // eslint-disable-line react-hooks/exhaustive-deps

  if (compareMode) {
    return (
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex items-start gap-3 flex-shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col gap-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-2 h-2 rounded-full border-2 border-[#CF305D] flex-shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest text-[#CF305D]/50 flex-shrink-0">Compare 1</span>
              {cmpSources.length > 0    && <FilterPill label="Source"      value={cmp2Source}    onChange={setCmp2Source}    options={cmpSources} />}
              {cmpYears.length > 0      && <FilterPill label="Year"        value={cmp2Year}      onChange={setCmp2Year}      options={cmpYears} />}
              {cmpMonths.length > 0     && <FilterPill label="Month"       value={cmp2Month}     onChange={setCmp2Month}     options={cmpMonths} />}
              {cmpStructures.length > 0 && <FilterPill label="Structure"   value={cmp2Structure} onChange={setCmp2Structure} options={cmpStructures} />}
              {cmpHoldings.length > 0   && <FilterPill label="Perspective" value={cmp2TopParent} onChange={setCmp2TopParent} options={cmpHoldings} />}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-2 h-2 rounded-full border-2 border-[#57aa78] flex-shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest text-[#57aa78]/50 flex-shrink-0">Compare 2</span>
              {cmpSources.length > 0    && <FilterPill label="Source"      value={cmp3Source}    onChange={setCmp3Source}    options={cmpSources} />}
              {cmpYears.length > 0      && <FilterPill label="Year"        value={cmp3Year}      onChange={setCmp3Year}      options={cmpYears} />}
              {cmpMonths.length > 0     && <FilterPill label="Month"       value={cmp3Month}     onChange={setCmp3Month}     options={cmpMonths} />}
              {cmpStructures.length > 0 && <FilterPill label="Structure"   value={cmp3Structure} onChange={setCmp3Structure} options={cmpStructures} />}
              {cmpHoldings.length > 0   && <FilterPill label="Perspective" value={cmp3TopParent} onChange={setCmp3TopParent} options={cmpHoldings} />}
            </div>
          </div>

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

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center flex-shrink-0 self-stretch w-[20vw]">
            <FilterPill label="Line" value={line}
              onChange={setLine}
              options={lineOptions} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr style={{ backgroundColor: colors.primary }}>
                  <th className="sticky left-0 z-30 text-left px-5 py-3 border-r border-white/20" style={{ backgroundColor: colors.primary }}>
                    <span style={header2Style}>Dimension</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary }}>
                    <span style={header2Style}>Standard</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary }}>
                    <span style={header2Style}>Compare 1</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary, opacity: 0.85 }}>
                    <span style={header2Style}>Δ Amt</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary, opacity: 0.7 }}>
                    <span style={header2Style}>Δ %</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary, filter: "brightness(0.75)" }}>
                    <span style={header2Style}>Compare 2</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary, filter: "brightness(0.75)", opacity: 0.85 }}>
                    <span style={header2Style}>Δ Amt</span>
                  </th>
                  <th className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary, filter: "brightness(0.75)", opacity: 0.7 }}>
                    <span style={header2Style}>Δ %</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dimCols.filter(dim => !!dim.code).map(dim => {
                  const dimKey = dim.code ?? "__none__";

                  const flattenForDim = (p, pPrev) => {
                    const flat = new Map();
                    p.forEach((dimMap, acCode) => {
                      const ytd = dimMap.get(dimKey) ?? 0;
                      if (viewMode === "monthly" && pPrev) {
                        const prevYtd = pPrev.get(acCode)?.get(dimKey) ?? 0;
                        flat.set(acCode, ytd - prevYtd);
                      } else {
                        flat.set(acCode, ytd);
                      }
                    });
                    return flat;
                  };

                  const evalLine = (p, pPrev) => {
                    const flat = flattenForDim(p, pPrev);
                    if (line === "all") {
                      let total = 0;
                      flat.forEach(v => { total += v; });
                      return total;
                    }
                    const kpi = kpiList.find(k => k.id === line);
                    if (!kpi) return 0;
                    const cache = new Map();
                    const v = evalFormulaWithCcTags(kpi.formula, flat, cache, kpiList, ccTagToCodes, resolveCcTag);
                    return (v === null || isNaN(v)) ? 0 : v;
                  };
                  const v1 = evalLine(pivot,  prevPivot);
                  const v2 = evalLine(pivot2, prevPivot2);
                  const v3 = evalLine(pivot3, prevPivot3);
                  const valColor = v => v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : body1Style?.color ?? "#000000";
                  const devColor = v => v === 0 ? "#D1D5DB" : v >= 0 ? "#059669" : "#EF4444";
                  return (
                    <tr key={dimKey} className="border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors">
                      <td className="sticky left-0 z-10 px-5 py-2.5 bg-white border-r border-gray-100">
                        <span style={body1Style}>{dim.name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: valColor(v1) }}>
                        {v1 === 0 ? "—" : fmtAmt(v1)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: valColor(v2) }}>
                        {v2 === 0 ? "—" : fmtAmt(v2)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: v1 === 0 && v2 === 0 ? "#D1D5DB" : devColor(v1 - v2) }}>
                        {v1 === 0 && v2 === 0 ? "—" : fmtAmt(v1 - v2)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: v2 === 0 ? "#D1D5DB" : devColor(v1 - v2) }}>
                        {v2 === 0 ? "—" : `${(((v1 - v2) / Math.abs(v2)) * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: valColor(v3) }}>
                        {v3 === 0 ? "—" : fmtAmt(v3)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: v1 === 0 && v3 === 0 ? "#D1D5DB" : devColor(v1 - v3) }}>
                        {v1 === 0 && v3 === 0 ? "—" : fmtAmt(v1 - v3)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: v3 === 0 ? "#D1D5DB" : devColor(v1 - v3) }}>
                        {v3 === 0 ? "—" : `${(((v1 - v3) / Math.abs(v3)) * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
                {(() => {
                  const evalAll = (p, pPrev) => {
                    let total = 0;
                    dimCols.filter(d => !!d.code).forEach(d => {
                      const dk = d.code;
                      const flat = new Map();
                      p.forEach((dimMap, acCode) => {
                        const ytd = dimMap.get(dk) ?? 0;
                        if (viewMode === "monthly" && pPrev) {
                          const prevYtd = pPrev.get(acCode)?.get(dk) ?? 0;
                          flat.set(acCode, ytd - prevYtd);
                        } else {
                          flat.set(acCode, ytd);
                        }
                      });
                      if (line === "all") {
                        flat.forEach(v => { total += v; });
                      } else {
                        const kpi = kpiList.find(k => k.id === line);
                        if (kpi) {
                          const cache = new Map();
                          const v = evalFormulaWithCcTags(kpi.formula, flat, cache, kpiList, ccTagToCodes, resolveCcTag);
                          if (v !== null && !isNaN(v)) total += v;
                        }
                      }
                    });
                    return total;
                  };
                  const t1 = evalAll(pivot,  prevPivot);
                  const t2 = evalAll(pivot2, prevPivot2);
                  const t3 = evalAll(pivot3, prevPivot3);
                  const valColor = v => v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : body1Style?.color ?? "#000000";
                  const devColor = v => v === 0 ? "#D1D5DB" : v >= 0 ? "#059669" : "#EF4444";
                  return (
                    <tr key="__total__" className="border-t-2 border-[#1a2f8a]/20 bg-[#eef1fb]">
                      <td className="sticky left-0 z-10 px-5 py-2.5 bg-[#eef1fb] border-r border-gray-100">
                        <span style={body1Style}>Total</span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: valColor(t1) }}>
                        {t1 === 0 ? "—" : fmtAmt(t1)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: valColor(t2) }}>
                        {t2 === 0 ? "—" : fmtAmt(t2)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: t1 === 0 && t2 === 0 ? "#D1D5DB" : devColor(t1 - t2) }}>
                        {t1 === 0 && t2 === 0 ? "—" : fmtAmt(t1 - t2)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: t2 === 0 ? "#D1D5DB" : devColor(t1 - t2) }}>
                        {t2 === 0 ? "—" : `${(((t1 - t2) / Math.abs(t2)) * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: valColor(t3) }}>
                        {t3 === 0 ? "—" : fmtAmt(t3)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: t1 === 0 && t3 === 0 ? "#D1D5DB" : devColor(t1 - t3) }}>
                        {t1 === 0 && t3 === 0 ? "—" : fmtAmt(t1 - t3)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap" style={{ ...body1Style, color: t3 === 0 ? "#D1D5DB" : devColor(t1 - t3) }}>
                        {t3 === 0 ? "—" : `${(((t1 - t3) / Math.abs(t3)) * 100).toFixed(1)}%`}
                      </td>
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

        <div ref={headerRef} style={{ overflowX: "auto", overflowY: "hidden", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }} onScroll={onHeaderScroll}>
          <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 480, minWidth: 480 }} />
              {dimCols.map((_, i) => <col key={i} style={{ width: DCOL, minWidth: DCOL }} />)}
              <col style={{ width: TCOL, minWidth: TCOL }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: colors.primary }}>
                <th className="sticky left-0 z-30 text-left px-6 border-r border-white/20" style={{ backgroundColor: colors.primary, height: "56px" }}>
<div className="flex items-center gap-3" style={{ minWidth: ACOL }}>
                    <span className="uppercase tracking-widest" style={header2Style}>Account</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => expandedSet.size > 0 ? collapseAll() : expandAll()}
                        className="flex items-center justify-center rounded-lg transition-all"
                        style={{ background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}cc`, width: 32, height: 32 }}
                        title={expandedSet.size > 0 ? "Collapse all" : "Expand all"}>
                        {expandedSet.size > 0 ? <Minimize2 size={13}/> : <Maximize2 size={13}/>}
                      </button>
                      <button onClick={onShowAccounts}
                        className="flex items-center justify-center rounded-lg transition-all"
                        style={{ background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}cc`, width: 32, height: 32 }}
                        title="View consolidated rows">
                        <Database size={13} />
                      </button>

                      <div className="flex items-center rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.12)", padding: 4 }}>
                        <button onClick={() => setSummaryMode(false)}
                          className="rounded-md text-[11px] font-black transition-colors"
                          style={{
                            backgroundColor: !summaryMode ? (colors.quaternary ?? "#F59E0B") : "transparent",
                            color: !summaryMode ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}cc`,
                            padding: "7px 12px",
                            lineHeight: 1
                          }}>
                          Detailed
                        </button>
                        <button onClick={() => setSummaryMode(true)}
                          className="rounded-md text-[11px] font-black transition-colors"
                          style={{
                            backgroundColor: summaryMode ? (colors.quaternary ?? "#F59E0B") : "transparent",
                            color: summaryMode ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}cc`,
                            padding: "7px 12px",
                            lineHeight: 1
                          }}>
                          Summary
                        </button>
                      </div>
                    </div>
                  </div>
                </th>
                {dimCols.map(dim => (
                  <th key={dim.code ?? "__none__"} className="text-center px-4 py-3 whitespace-nowrap" style={{ backgroundColor: colors.primary }}>
                    <span className="leading-tight truncate max-w-[120px] inline-block" style={header2Style}>{dim.name}</span>
                  </th>
                ))}
                <th className="sticky right-0 z-10 text-center px-4 py-3 whitespace-nowrap border-l border-white/20" style={{ backgroundColor: colors.primary }}>
                  <span style={header2Style}>TOTAL</span>
                </th>
              </tr>
            </thead>
          </table>
        </div>

        <div ref={bodyRef} className="scrollbar-hide" style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }} onScroll={onBodyScroll}>
          <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: ACOL, minWidth: ACOL }} />
              {dimCols.map((_, i) => <col key={i} style={{ width: DCOL, minWidth: DCOL }} />)}
              <col style={{ width: TCOL, minWidth: TCOL }} />
            </colgroup>
            <tbody>
              {(() => {
                const flatCodes = new Set(orderedRows.map(n => String(n.AccountCode)));
                return orderedRows.map(node => {
                  const divider = dividerMap[String(node.AccountCode)];
                  return (
                    <React.Fragment key={node.AccountCode}>
{divider && (
                        <tr>
                          <td className="sticky left-0 z-10 px-6 py-1.5"
                            style={{ backgroundColor: divider.color }}>
                            <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
                          </td>
                          <td colSpan={dimCols.length + 1}
                            style={{ backgroundColor: divider.color }} />
                        </tr>
                      )}
                      <DimensionRow node={node} depth={0}
                        expandedSet={expandedSet} onToggle={toggleExpand}
                        dimCols={dimCols} getVal={getVal}
                        body1Style={body1Style} body2Style={body2Style}
                        header2Style={header2Style} colors={colors}
                        excludeCodes={flatCodes} />
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────── */
export default function ConsolidatedDimensionesPage({
  token, sources = [], structures = [], companies = [], dimensions = [],
}) {
  const { colors } = useSettings();
  const header1Style = useTypo("header1");

  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [metaReady, setMetaReady] = useState(false);
  const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("");
  const [topParent, setTopParent] = useState("");

const [showAccounts,    setShowAccounts]    = useState(false);
  const [viewsModalOpen,  setViewsModalOpen]  = useState(false);
  const [statementType,   setStatementType]   = useState("pl");
  const [selGroup, setSelGroup] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [rawData,   setRawData]   = useState([]);
  const [consolidations, setConsolidations] = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

  const probedRef = useRef({ key: "" });

  // Load group accounts
  const [groupAccountsLocal, setGroupAccountsLocal] = useState([]);
  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/v2/group-accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const rows = d.value ?? (Array.isArray(d) ? d : []);
        setGroupAccountsLocal(rows);
      })
      .catch(e => console.error("group-accounts fetch failed:", e));
  }, [token]);

  // Load consolidations + group-structure (for Perspective filter)
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    Promise.all([
      fetch(`${BASE_URL}/v2/consolidations`,  { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/group-structure`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
    ]).then(([cons, gs]) => {
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs) ? gs : []);
    });
  }, [token]);

  const { kpiList, ccTagToCodes, resolveCcTag } = useKpiResolver(groupAccountsLocal);

  // Supabase mappings
  const [pgcPlMapping, setPgcPlMapping] = useState(null);
  const [pgcBsMapping, setPgcBsMapping] = useState(null);
  const [danishPlMapping, setDanishPlMapping] = useState(null);
  const [danishBsMapping, setDanishBsMapping] = useState(null);
  const [spIfrsEsPlMapping, setSpIfrsEsPlMapping] = useState(null);
  const [spIfrsEsBsMapping, setSpIfrsEsBsMapping] = useState(null);

  useEffect(() => {
    if (!groupAccountsLocal.length) return;
    const codes = groupAccountsLocal.map(g => String(g.AccountCode ?? g.accountCode ?? ""));
    const isPGC = codes.some(c => /[a-zA-Z]/.test(c) && c.endsWith(".S"));
    const isSpEs = !isPGC && codes.some(c => /\.PL$/.test(c));
    const isDan = !isPGC && !isSpEs && codes.some(c => /^\d{5,6}$/.test(c));

    const loadMapping = async (rowsTable, sectionsTable, setter) => {
      try {
        const [rowsArr, secsArr] = await Promise.all([
          sbGet(`${rowsTable}?select=*&order=sort_order.asc`),
          sbGet(`${sectionsTable}?select=*&order=sort_order.asc`),
        ]);
        if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
        const rows = new Map();
        rowsArr.forEach(r => rows.set(String(r.account_code), {
          section: String(r.section_code),
          sortOrder: Number(r.sort_order),
          isSum: !!r.is_sum,
          showInSummary: !!r.show_in_summary,
          level: Number(r.level ?? 0),
        }));
        const sections = new Map();
        secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
        setter({ rows, sections });
      } catch { setter(null); }
    };

    if (isPGC) {
      loadMapping("pgc_pl_rows", "pgc_pl_sections", setPgcPlMapping);
      loadMapping("pgc_bs_rows", "pgc_bs_sections", setPgcBsMapping);
    } else if (isDan) {
      loadMapping("danish_ifrs_pl_rows", "danish_ifrs_pl_sections", setDanishPlMapping);
      loadMapping("danish_ifrs_bs_rows", "danish_ifrs_bs_sections", setDanishBsMapping);
    } else if (isSpEs) {
      loadMapping("spanish_ifrs_es_pl_rows", "spanish_ifrs_es_pl_sections", setSpIfrsEsPlMapping);
      loadMapping("spanish_ifrs_es_bs_rows", "spanish_ifrs_es_bs_sections", setSpIfrsEsBsMapping);
    }
  }, [groupAccountsLocal]);

  const plMapping = pgcPlMapping ?? danishPlMapping ?? spIfrsEsPlMapping;
  const bsMapping = pgcBsMapping ?? danishBsMapping ?? spIfrsEsBsMapping;

// Initial period — pick latest "Actual" closed period, fallback to current date
  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/v2/periods`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    })
      .then(r => r.json())
      .then(d => {
        const all = d.value ?? (Array.isArray(d) ? d : []);
        const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];
        const actualSorted = all
          .filter(p => String(getP(p, "source") ?? "").toLowerCase() === "actual")
          .sort((a, b) => {
            const ay = Number(getP(a, "year") || 0), by = Number(getP(b, "year") || 0);
            const am = Number(getP(a, "month") || 0), bm = Number(getP(b, "month") || 0);
            return by !== ay ? by - ay : bm - am;
          });
        const closed = actualSorted.find(p => getP(p, "closed") === true);
        const latest = closed ?? actualSorted[0];

        if (latest) {
          setYear(String(getP(latest, "year") ?? ""));
          setMonth(String(getP(latest, "month") ?? ""));
        } else {
          // Fallback to current date if periods API returned nothing usable
          const now = new Date();
          setYear(String(now.getFullYear()));
          setMonth(String(now.getMonth() + 1));
        }
        setMetaReady(true);
      })
      .catch(() => {
        const now = new Date();
        setYear(String(now.getFullYear()));
        setMonth(String(now.getMonth() + 1));
        setMetaReady(true);
      });
  }, [token]);

  // Compute holding options + topParent based on group-structure + consolidations
  const { holdingOptions, rootParent } = useMemo(() => {
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

    const holdings = consolidatedGroups.size > 0
      ? candidates.filter(c => consolidatedGroups.has(c))
      : candidates;

    const opts = holdings
      .map(h => {
        const legal = companies.find(c => (c.companyShortName ?? c.CompanyShortName) === h);
        const label = legal?.companyLegalName ?? legal?.CompanyLegalName ?? h;
        return { value: h, label };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

    return { holdingOptions: opts, rootParent: root };
  }, [groupStructure, structure, consolidations, year, month, source, companies]);

  // Auto-pick topParent when holdings change
  useEffect(() => {
    if (holdingOptions.length === 0) return;
    if (holdingOptions.some(h => h.value === topParent)) return;
    const fallback = holdingOptions.some(h => h.value === rootParent) ? rootParent : holdingOptions[0].value;
    setTopParent(fallback);
  }, [holdingOptions, rootParent, topParent]);

  // Defaults
  useEffect(() => {
    if (sources.length > 0 && !source) {
      const s = sources[0];
      setSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  useEffect(() => {
    if (structures.length > 0 && !structure) {
      const s = structures[0];
      setStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures]);

// Probe back through months looking for data when source/structure/topParent change
  useEffect(() => {
    if (!metaReady || !source || !structure || !topParent || !year || !month) return;
    const key = `${source}|${structure}|${topParent}`;
    if (probedRef.current.key === key) return;
    probedRef.current.key = key;

    let cancelled = false;

    (async () => {
      let y = Number(year);
      let m = Number(month);
      console.log(`[ConsDim probe] starting from ${y}-${m} for ${source}/${structure}/${topParent}`);

      for (let i = 0; i < 24; i++) {
        if (cancelled) return;
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
          const res = await fetch(
            `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=50`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
          );
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            // Accept ANY rows for this period — we filter by CompanyRole
            // later in the PivotTab. The probe just looks for "is there
            // SOMETHING here at all?".
            if (rows.length > 0) {
              console.log(`[ConsDim probe] found ${rows.length} rows at ${y}-${m}`);
              if (!cancelled) {
                setYear(String(y));
                setMonth(String(m));
              }
              return;
            }
          }
        } catch { /* keep probing */ }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      console.warn(`[ConsDim probe] no data found in last 24 months`);
      probedRef.current.key = "";
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaReady, source, structure, topParent, token]);

  const fetchData = useCallback(async () => {
    if (!metaReady || !year || !month || !source || !structure || !topParent) return;
    setLoading(true);
    setError(null);
    setRawData([]);
    try {
      const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
      const res = await fetch(
        `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRawData(json.value ?? (Array.isArray(json) ? json : []));
      requestAnimationFrame(() => setLoading(false));
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [metaReady, year, month, source, structure, topParent, authHeaders]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Dim groups (only from Parent + Contribution rows in consolidated data)
  const dimGroups = useMemo(() => {
    const seen = new Set();
    rawData.forEach(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Parent" && role !== "Contribution") return;
      const pairs = parseDimensions(r.Dimensions);
      pairs.forEach(([group]) => { if (group) seen.add(group); });
    });
    return [...seen].sort();
  }, [rawData]);

  const sourceOpts    = [...new Set(sources.map(s  => typeof s === "object" ? (s.source    ?? s.Source    ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

<PageHeader
kicker="Consolidated"
        title="Dimensions"
        tabs={[
          { id: "pl", label: "P&L",           icon: TrendingUp },
          { id: "bs", label: "Balance Sheet",  icon: Scale      },
        ]}
        activeTab={statementType}
        onTabChange={setStatementType}
        filters={[
          ...(sourceOpts.length > 0
            ? [{ label: "Source", value: source, onChange: setSource, options: sourceOpts }]
            : []),
          { label: "Year", value: year, onChange: setYear,
            options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
          { label: "Month", value: month, onChange: setMonth,
            options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
          ...(structureOpts.length > 0
            ? [{ label: "Structure", value: structure, onChange: setStructure, options: structureOpts }]
            : []),
          ...(holdingOptions.length > 0
            ? [{ label: "Perspective", value: topParent, onChange: setTopParent, options: holdingOptions }]
            : []),
          ...(dimGroups.length > 0
            ? [{ label: "Dim Group", value: selGroup, onChange: setSelGroup,
                options: [{ value: "", label: "All" }, ...dimGroups.map(g => ({ value: g, label: g }))] }]
            : []),
        ]}
        compareToggle={{
          active: compareMode,
          onChange: (newVal) => setCompareMode(newVal),
        }}
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

      <MappingsModal
        open={viewsModalOpen}
        onClose={() => setViewsModalOpen(false)}
        groupAccounts={groupAccountsLocal}
        onApply={() => {}}
      />

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
        <PivotTab
          data={rawData}
          dimensions={dimensions}
          groupAccounts={groupAccountsLocal}
          onShowAccounts={() => setShowAccounts(true)}
          selGroup={selGroup}
          dimGroups={dimGroups}
          compareMode={compareMode}
          sources={sources}
          structures={structures}
          companies={companies}
          token={token}
          masterYear={year}
          masterMonth={month}
          masterSource={source}
          masterStructure={structure}
          masterTopParent={topParent}
kpiList={kpiList}
          ccTagToCodes={ccTagToCodes}
          resolveCcTag={resolveCcTag}
          plMapping={plMapping}
          bsMapping={bsMapping}
          statementType={statementType} />
      )}

      {showAccounts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAccounts(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-[95vw] h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between flex-shrink-0">
              <p className="text-white font-black text-sm">Consolidated Rows · {rawData.length} records</p>
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