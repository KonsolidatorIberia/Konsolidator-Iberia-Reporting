import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Loader2, X, RefreshCw, Search, Database, GitMerge, Maximize2, Minimize2, Library, CheckCircle2, AlertTriangle, TrendingUp, Scale, Download } from "lucide-react";import { useTypo, useSettings } from "./SettingsContext";
import PageHeader from "./PageHeader.jsx";
import MappingsModal from "./Mappings.jsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
const BASE_URL = "";

// ════════════════════════════════════════════════════════════════════════════
// KPI RESOLVER — inline. Same logic used in KpiIndividualesPage. Loads cc_tag
// mapping for the active accounting standard from Supabase and builds a map
// of cc_tag → list of account codes that resolve to it via parent inheritance.
// This is what makes the same KPI definition work across PGC / Danish IFRS /
// Spanish IFRS-ES without per-standard formula overrides.
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

  // Build code → cc_tag from the taxonomy table (pgc_pl_rows etc).
  const codeCcTag = new Map();
  for (const r of allRows) {
    if (r.cc_tag) codeCcTag.set(String(r.account_code), r.cc_tag);
  }

  // Build child → parent from groupAccounts so we can walk a posting account
  // up to whatever ancestor carries a cc_tag.
  const parentOf = new Map();
  for (const ga of (groupAccounts || [])) {
    if (ga.AccountCode && ga.SumAccountCode) {
      parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
    }
  }

  // Helper: for a given account code (which may not be in the taxonomy at all,
  // because journals can have posting codes outside it), walk its parent chain
  // until we hit a code that has a cc_tag. Returns the cc_tag string, or null.
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

  // Eager precompute for groupAccounts (used by `cc` evaluator's fallback path).
  const ccTagToCodes = new Map();
  for (const ga of (groupAccounts || [])) {
    const code = String(ga.AccountCode);
    const foundTag = resolveCcTag(code);
    if (foundTag) {
      if (!ccTagToCodes.has(foundTag)) ccTagToCodes.set(foundTag, []);
      ccTagToCodes.get(foundTag).push(code);
    }
  }

  console.log(`[DimResolver] ${standard} mapping loaded: ${ccTagToCodes.size} cc_tags`);
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

// Hook: load standard mapping + KPI library reactively
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
        console.error("[DimResolver] load failed:", e);
        setState(s => ({ ...s, ready: true }));
      });
    return () => { cancelled = true; };
  }, [standard, groupAccounts]);

  return state;
}

// Pivot helpers
function pivotSum(pivot, codes) {
  if (!codes || codes.length === 0) return 0;
  let total = 0;
  codes.forEach(code => { total += (pivot.get(code) ?? 0); });
  return total;
}

// Evaluator that understands cc/ref/op/fn/manual/text formula nodes.
// `pivot` here is a flat Map<accountCode, number> (for one specific dim col).
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
      // Two-pass approach:
      //   1) Sum the precomputed account codes that we already know belong to
      //      this cc_tag (via the taxonomy).
      //   2) For any account in the pivot that we DON'T have an entry for in
      //      ccTagToCodes (typically posting codes the journal uses but the
      //      taxonomy doesn't list directly), resolve them on the fly by
      //      walking up to a parent that carries a cc_tag.
      const knownCodes = ccTagToCodes.get(node.tag) ?? [];
      const knownSet = new Set(knownCodes);
      let total = 0;
      // Sum knownCodes that exist in the pivot
      for (const code of knownCodes) {
        total += pivot.get(code) ?? 0;
      }
      // Add unknown codes that resolve to this cc_tag
      if (resolveCcTag) {
        pivot.forEach((val, code) => {
          if (knownSet.has(code)) return; // already counted above
          const tag = resolveCcTag(code);
          if (tag === node.tag) total += val;
        });
      }
      // Sign convention: -sum (revenue positive in journal flips here)
      return -total;
    }
    default: return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// END KPI RESOLVER
// ════════════════════════════════════════════════════════════════════════════

// ── Mapping → cc_tag override helpers ─────────────────────────────────────────
// More specific terms first; first match wins to prevent collisions.
const CC_TAG_SYNONYMS = {
  personnel_costs:     ["gastos de personal", "personnel costs", "personnel"],
  cost_of_goods:       ["coste de ventas", "costo de ventas", "cost of goods", "cogs", "aprovisionamientos"],
  gross_profit:        ["margen bruto", "beneficio bruto", "resultado bruto", "gross profit", "gross margin"],
  ebitda:              ["ebitda"],
  ebit:                ["resultado de explotacion", "operating income", "resultado operativo", "ebit"],
  ebt:                 ["resultado antes de impuestos", "pre-tax", "ebt", "rai"],
  net_result:          ["resultado neto", "resultado del ejercicio", "net result", "net income", "beneficio neto"],
  current_assets:      ["activo corriente", "activo circulante", "current assets"],
  current_liabilities: ["pasivo corriente", "pasivo circulante", "current liabilities"],
  total_assets:        ["total activo", "activo total", "total assets", "total de activos"],
  total_equity:        ["patrimonio neto", "fondos propios", "total equity", "total de capital"],
  total_liabilities:   ["pasivo total", "total pasivo", "total liabilities", "total de pasivo"],
  revenue:             ["ingresos", "revenue", "ventas", "sales", "income", "facturacion"],
  operating_expenses:  ["gastos operativos", "gastos de explotacion", "operating expenses", "opex"],
};

function normalizeLabel(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Walks pl_tree/bs_tree and returns Map<sectionLabel, [accountCodes]>
function extractSectionsFromTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return new Map();
  const result = new Map();
  function walk(nodes, currentLabel) {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "breaker") {
        const label = String(node.name ?? "").trim();
        if (label && !result.has(label)) result.set(label, []);
        walk(node.children || [], label);
      } else {
        const code = String(node.code ?? "");
        if (code && currentLabel && result.has(currentLabel)) {
          result.get(currentLabel).push(code);
        }
        walk(node.children || [], currentLabel);
      }
    }
  }
  walk(tree, null);
  return result;
}

// Convert saved mapping tree (jsonb) into the {rows, sections} shape that
// PivotTab uses for row ordering and section breakers.
function convertSavedMappingTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return null;
  const rows = new Map();
  const sections = new Map();
  let sortCounter = 0;
  let defaultSecCounter = 0;
  function walk(nodes, depth, parentSection) {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "breaker") {
        const secCode = node.sectionCode || `section_${defaultSecCounter++}`;
        sections.set(secCode, {
          label: String(node.name ?? "Section"),
          color: node.color || "#1a2f8a",
        });
        walk(node.children || [], depth, secCode);
      } else {
        const code = String(node.code ?? "");
        if (!code) continue;
        const sec = parentSection || "_default";
        if (!sections.has(sec)) sections.set(sec, { label: "", color: "#1a2f8a" });
        rows.set(code, {
          section: sec,
          sortOrder: sortCounter++,
          isSum: true,
          showInSummary: !!node.showInSummary,
          level: depth,
        });
        walk(node.children || [], depth + 1, sec);
      }
    }
  }
  walk(tree, 0, null);
  if (rows.size === 0) return null;
  return { rows, sections };
}

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

// Parses the API's Dimensions field which is a string like "Group:Code" or
// "Group1:Code1||Group2:Code2" when a transaction is tagged with multiple dimensions.
// Returns an array of [group, code] tuples.
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
  // Normalize field names (API returns camelCase, our pivot uses PascalCase)
  const normalized = accounts.map(a => ({
    ...a,
    AccountCode:    a.AccountCode    ?? a.accountCode    ?? "",
    AccountName:    a.AccountName    ?? a.accountName    ?? "",
    SumAccountCode: a.SumAccountCode ?? a.sumAccountCode ?? "",
  })).filter(a => a.AccountCode);

  const sorted = [...normalized].sort(pgcSort);
  const map = new Map();
  sorted.forEach(a => map.set(a.AccountCode, { ...a, children: [] }));

  // Detect chart type: PGC uses `.S`-suffixed summary accounts; Danish/numeric
  // standards just have a hierarchy of numeric codes where any account can have
  // children. The two need different attachment rules.
  const hasPgcSummaries = sorted.some(a => /\.S$/i.test(a.AccountCode));

  const roots = [];
  sorted.forEach(a => {
    const parent = a.SumAccountCode ? map.get(a.SumAccountCode) : null;

    // Attach to parent when:
    // - PGC: parent must NOT be a `.S` summary (PGC quirk: `.S` siblings, not parents)
    // - Numeric / Danish: any existing parent in the map is valid
    const canAttach = parent && (hasPgcSummaries ? !/\.S$/i.test(parent.AccountCode) : true);

    if (canAttach) {
      parent.children.push(map.get(a.AccountCode));
    } else {
      // PGC-only filter: drop numeric leaves whose `.S` parent isn't in the map
      // (those are orphans of an unloaded section). Doesn't apply to non-PGC.
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
  // Filter out children that are already shown as siblings in the flat list
  const visibleChildren = excludeCodes
    ? (node.children || []).filter(c => !excludeCodes.has(String(c.AccountCode)))
    : (node.children || []);
  const hasChildren = visibleChildren.length > 0;
  const isExpanded = expandedSet.has(code);
// Get value: prefer the node's own value (backend subtotal), fall back to summing children
  const getNodeVal = (dimKey) => {
    const ownVal = getVal(code, dimKey);
    if (ownVal !== 0) return ownVal;  // backend already provides this subtotal
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



/* ── Pivot Tab ────────────────────────────────────────────── */
function PivotTab({ data, dimensions, groupAccounts = [], onShowAccounts, selGroup, compareMode, statementType = "pl", sources = [], structures = [], companies = [], token = "", masterYear = "", masterMonth = "", masterSource = "", masterStructure = "", masterCompany = "", kpiList = [], ccTagToCodes = new Map(), resolveCcTag = () => null, plMapping = null, bsMapping = null, exportRef = null }) {

  const header2Style = useTypo("header2");
    const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const header3Style = useTypo("header3");
  const { colors } = useSettings();

// Summary/Detailed toggle (only used in non-compare mode). statementType
  // is lifted to DimensionesPage to drive PageHeader tabs.
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

// Build pivot from data
  const { tree, accountMap: allAccountMap, dimCols, pivot } = useMemo(() => {
    if (!data.length) return { tree: [], accountMap: new Map(), dimCols: [], pivot: new Map() };

    // Filter rows by selected group: keep rows that have AT LEAST ONE dim
    // in the selected group, OR rows with no dim at all (totals).
    const rows = !selGroup
      ? data
      : data.filter(r => {
          const pairs = parseDimensions(r.Dimensions);
          if (pairs.length === 0) return true; // untagged rows are always included
          return pairs.some(([group]) => group === selGroup);
        });

// Get codes that actually have data in this period (with their names from data rows)
    const dataAccountInfo = new Map();
    rows.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!code) return;
      const lac = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (lac && lac !== "—") return;
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

    // Build groupAccounts lookup (hierarchy source)
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

    // Build accountMap: prefer groupAccounts (has hierarchy) but fall back to data
    const accountMap = new Map();
    if (groupMap.size > 0) {
      // Walk up the hierarchy: include every ancestor of accounts that have data
      const includeWithAncestors = (code) => {
        if (accountMap.has(code)) return;
        const a = groupMap.get(code);
        if (!a) {
          // Code exists in data but not in groupAccounts — add it as orphan
          const fallback = dataAccountInfo.get(code);
          if (fallback) accountMap.set(code, fallback);
          return;
        }
        accountMap.set(code, a);
        if (a.SumAccountCode) includeWithAncestors(a.SumAccountCode);
      };
      dataAccountInfo.forEach((_, code) => includeWithAncestors(code));
    } else {
      // No groupAccounts — flat list from data
      dataAccountInfo.forEach((info, code) => accountMap.set(code, info));
    }

    const tree = buildTree([...accountMap.values()]);
    console.log("[TREE DEBUG] groupAccounts.length:", (groupAccounts || []).length, "dataAccountInfo.size:", dataAccountInfo.size, "accountMap.size:", accountMap.size, "tree roots:", tree.length);
console.log("[TREE DEBUG] accounts:", [...accountMap.values()].slice(0, 5));
console.log("[TREE DEBUG] tree roots:", tree.length, "first:", tree[0]);
console.log("[TREE DEBUG] sample with children:", tree.find(n => n.children?.length > 0));
// Unique dim columns — derived from the journal's Dimensions field.
    // When a Dim Group is selected, we restrict columns to that group; otherwise
    // we show ALL groups together (each dim code as its own column).
    const dimNameLookup = new Map();
    (dimensions || []).forEach(d => {
      const code = d.code ?? d.Code ?? d.dimensionCode ?? d.DimensionCode ?? "";
      const name = d.name ?? d.Name ?? d.dimensionName ?? d.DimensionName ?? code;
      if (code) dimNameLookup.set(String(code), name);
    });

    const dimMap = new Map();  // code → { code, name, group }
    rows.forEach(r => {
      const pairs = parseDimensions(r.Dimensions);
      if (pairs.length === 0) {
        if (!dimMap.has("__none__")) dimMap.set("__none__", { code: null, name: "No Dimension", group: null });
        return;
      }
      for (const [group, code] of pairs) {
        if (selGroup && group !== selGroup) continue;
        if (!dimMap.has(code)) dimMap.set(code, { code, name: dimNameLookup.get(code) ?? code, group });
      }
    });
    const dimCols = [...dimMap.values()].sort((a, b) => {
      if (!a.code && b.code) return 1;
      if (a.code && !b.code) return -1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    // Build pivot: for each row, for each dim it carries (matching the selected
    // group, if any), add the amount into the (account, dimCode) cell.
    const pivot = new Map();
    rows.forEach(r => {
      const ac  = r.AccountCode ?? r.accountCode ?? "";
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? r.AmountPeriod ?? r.amountPeriod ?? 0);
      const lacCheck = r.LocalAccountCode ?? r.localAccountCode ?? "";
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (lacCheck && lacCheck !== "—") return;
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
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      const lac = r.LocalAccountCode ?? r.localAccountCode ?? "";
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (lac && lac !== "—") return;
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
const ACOL = 480, DCOL = 140, TCOL = 150;
  const totalWidth = ACOL + dimCols.length * DCOL + TCOL;

  // Compute which KPI lines actually produce data given the current 3 pivots
  // and dim columns. Lines that evaluate to 0 across every dim col (in every
  // scenario) are dropped from the dropdown. We always keep "All".
  const lineOptions = useMemo(() => {
    const visibleDims = dimCols.filter(d => !!d.code);
    const evalKpiAcrossDims = (kpi, p, pPrev) => {
      // Returns true as soon as any dim column has a non-zero result.
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

// If the selected line was filtered out (no data anymore), reset to "all"
  useEffect(() => {
    if (line !== "all" && !lineOptions.some(o => o.value === line)) {
      setLine("all");
    }
  }, [lineOptions, line]);

  // ─────────────────────────────────────────────────────────
  // Filter & order accounts by accountType + Supabase mapping
  // (Hooks must run unconditionally — placed BEFORE early return)
  // ─────────────────────────────────────────────────────────
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
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!code) return;
      const lac = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (lac && lac !== "—") return;
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
  }, [data, groupAccounts, selGroup, statementType]);

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
  }, [activeMapping, orderedRows, colors]);

// ── Export helpers ──────────────────────────────────────────────────────
  const C = {
    primary:   "FF1A2F8A",
    highlight: "FFEEF1FB",
    white:     "FFFFFFFF",
    band1:     "FFFFFFFF",
    band2:     "FFF8F9FF",
    gray400:   "FF9CA3AF",
    red:       "FFDC2626",
  };
  const toArgb = (hex) => "FF" + String(hex ?? "#1a2f8a").replace("#", "").toUpperCase().padStart(6, "0");
  const filterStr = [masterSource, masterStructure, masterYear && masterMonth
    ? `${MONTHS[parseInt(masterMonth) - 1]?.label ?? masterMonth} ${masterYear}` : ""].filter(Boolean).join(" · ");

  const handleExportXlsx = useCallback(async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Konsolidator";

    if (compareMode) {
      // ── Compare sheet: rows = dims, cols = Std / Cmp1 / ΔAmt / Δ% / Cmp2 / ΔAmt / Δ%
      const ws = wb.addWorksheet("Dimensions Compare", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
      const headers = ["Dimension", "Standard", "Compare 1", "Δ Amt", "Δ %", "Compare 2", "Δ Amt", "Δ %"];
      const totalCols = headers.length;

      ws.mergeCells(1, 1, 1, totalCols);
      Object.assign(ws.getCell(1, 1), { value: "Dimensions — Compare", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 16, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
      ws.getRow(1).height = 28;
      ws.mergeCells(2, 1, 2, totalCols);
      Object.assign(ws.getCell(2, 1), { value: filterStr || "—", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 10, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
      ws.getRow(2).height = 18;
      ws.getRow(3).height = 6;

      const hRow = ws.getRow(4);
      hRow.height = 24;
      headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
      });

      const visibleDims = dimCols.filter(d => !!d.code);
      const flattenForDim = (p, pPrev, dk) => {
        const flat = new Map();
        p.forEach((dimMap, acCode) => {
          const ytd = dimMap.get(dk) ?? 0;
          if (viewMode === "monthly" && pPrev) {
            flat.set(acCode, ytd - (pPrev.get(acCode)?.get(dk) ?? 0));
          } else {
            flat.set(acCode, ytd);
          }
        });
        return flat;
      };
      const evalLineExport = (p, pPrev, dk) => {
        const flat = flattenForDim(p, pPrev, dk);
        if (line === "all") { let t = 0; flat.forEach(v => { t += v; }); return t; }
        const kpi = kpiList.find(k => k.id === line);
        if (!kpi) return 0;
        const cache = new Map();
        const v = evalFormulaWithCcTags(kpi.formula, flat, cache, kpiList, ccTagToCodes, resolveCcTag);
        return (v === null || isNaN(v)) ? 0 : v;
      };

      let rn = 5;
      visibleDims.forEach((dim, idx) => {
        const dk = dim.code;
        const v1 = evalLineExport(pivot,  prevPivot,  dk);
        const v2 = evalLineExport(pivot2, prevPivot2, dk);
        const v3 = evalLineExport(pivot3, prevPivot3, dk);
        const band = idx % 2 === 0 ? C.band1 : C.band2;
        const row = ws.getRow(rn);
        row.height = 18;
        const setCell = (col, val, opts = {}) => {
          const c = row.getCell(col);
          c.value = val;
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.bg ?? band } };
          c.font = { name: "Calibri", size: 10, bold: !!opts.bold, color: { argb: opts.color ?? "FF000000" } };
          c.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "right", indent: col === 1 ? 1 : 0 };
          if (opts.numFmt) c.numFmt = opts.numFmt;
        };
        const numFmt = '#,##0.00;[Red]-#,##0.00';
        setCell(1, dim.name);
        setCell(2, v1 === 0 ? null : v1, { numFmt, color: v1 < 0 ? C.red : "FF000000" });
        setCell(3, v2 === 0 ? null : v2, { numFmt, color: v2 < 0 ? C.red : "FF000000" });
        const d12 = v1 - v2;
        setCell(4, v1 === 0 && v2 === 0 ? null : d12, { numFmt, color: d12 >= 0 ? "FF059669" : C.red });
        setCell(5, v2 === 0 ? null : parseFloat((((v1 - v2) / Math.abs(v2)) * 100).toFixed(1)), { numFmt: '0.0"%"', color: d12 >= 0 ? "FF059669" : C.red });
        setCell(6, v3 === 0 ? null : v3, { numFmt, color: v3 < 0 ? C.red : "FF000000" });
        const d13 = v1 - v3;
        setCell(7, v1 === 0 && v3 === 0 ? null : d13, { numFmt, color: d13 >= 0 ? "FF059669" : C.red });
        setCell(8, v3 === 0 ? null : parseFloat((((v1 - v3) / Math.abs(v3)) * 100).toFixed(1)), { numFmt: '0.0"%"', color: d13 >= 0 ? "FF059669" : C.red });
        rn++;
      });

      ws.getColumn(1).width = 30;
      for (let i = 2; i <= totalCols; i++) ws.getColumn(i).width = 17;

    } else {
      // ── Pivot sheet: rows = accounts, cols = dims
      const ws = wb.addWorksheet(`Dimensions ${statementType.toUpperCase()}`, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
      const totalCols = 1 + dimCols.length + 1;

      ws.mergeCells(1, 1, 1, totalCols);
      Object.assign(ws.getCell(1, 1), { value: `Dimensions — ${statementType === "pl" ? "P&L" : "Balance Sheet"}`, fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 16, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
      ws.getRow(1).height = 28;
      ws.mergeCells(2, 1, 2, totalCols);
      Object.assign(ws.getCell(2, 1), { value: filterStr || "—", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 10, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
      ws.getRow(2).height = 18;
      ws.getRow(3).height = 6;

      const hRow = ws.getRow(4);
      hRow.height = 24;
      ["Account", ...dimCols.map(d => d.name ?? d.code ?? "—"), "TOTAL"].forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
      });

      let rn = 5;
      orderedRows.forEach((node, idx) => {
        const divider = dividerMap[String(node.AccountCode)];
        if (divider) {
          ws.mergeCells(rn, 1, rn, totalCols);
          const dc = ws.getCell(rn, 1);
          dc.value = divider.label.toUpperCase();
          dc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: toArgb(divider.color) } };
          dc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
          dc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
          ws.getRow(rn).height = 18;
          rn++;
        }

        const band = idx % 2 === 0 ? C.band1 : C.band2;
        const lc = ws.getCell(rn, 1);
        lc.value = `${node.AccountCode}  ${node.AccountName ?? ""}`.trim();
        lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        lc.font = { name: "Calibri", size: 10, color: { argb: C.primary } };
        lc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

        let rowTotal = 0;
        dimCols.forEach((dim, di) => {
          const val = getVal(node.AccountCode, dim.code ?? "__none__");
          rowTotal += val;
          const vc = ws.getCell(rn, 2 + di);
          if (val === 0) {
            vc.font = { name: "Calibri", size: 10, color: { argb: C.gray400 } };
          } else {
            vc.value = val;
            vc.numFmt = '#,##0.00;[Red]-#,##0.00';
            vc.font = { name: "Calibri", size: 10, color: { argb: val < 0 ? C.red : "FF000000" } };
          }
          vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
          vc.alignment = { vertical: "middle", horizontal: "right" };
        });

        const tc = ws.getCell(rn, 2 + dimCols.length);
        if (rowTotal !== 0) {
          tc.value = rowTotal;
          tc.numFmt = '#,##0.00;[Red]-#,##0.00';
          tc.font = { name: "Calibri", size: 10, bold: true, color: { argb: rowTotal < 0 ? C.red : "FF000000" } };
        } else {
          tc.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.gray400 } };
        }
        tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.highlight } };
        tc.alignment = { vertical: "middle", horizontal: "right" };
        ws.getRow(rn).height = 18;
        rn++;
      });

      ws.getColumn(1).width = 44;
      for (let i = 2; i <= totalCols; i++) ws.getColumn(i).width = 18;
    }

    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Konsolidator_Dimensions_${masterYear}_${String(masterMonth).padStart(2, "0")}.xlsx`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, statementType, orderedRows, dimCols, getVal, dividerMap, pivot, prevPivot, pivot2, prevPivot2, pivot3, prevPivot3, viewMode, line, kpiList, ccTagToCodes, resolveCcTag, masterYear, masterMonth, masterSource, masterStructure]);

  const handleExportPdf = useCallback(() => {
    const H = { primary: "#1A2F8A", highlight: "#EEF1FB", white: "#FFFFFF", band2: "#F8F9FF", red: "#DC2626", green: "#059669", gray: "#9CA3AF" };
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(H.primary);
    doc.rect(0, 0, pageWidth, 60, "F");
    doc.setTextColor(H.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Dimensions — ${compareMode ? "Compare" : statementType === "pl" ? "P&L" : "Balance Sheet"}`, 24, 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(filterStr || "—", 24, 46);

    if (compareMode) {
      const visibleDims = dimCols.filter(d => !!d.code);
      const flattenForDim = (p, pPrev, dk) => {
        const flat = new Map();
        p.forEach((dMap, ac) => {
          const ytd = dMap.get(dk) ?? 0;
          flat.set(ac, viewMode === "monthly" && pPrev ? ytd - (pPrev.get(ac)?.get(dk) ?? 0) : ytd);
        });
        return flat;
      };
      const evalLine = (p, pPrev, dk) => {
        const flat = flattenForDim(p, pPrev, dk);
        if (line === "all") { let t = 0; flat.forEach(v => { t += v; }); return t; }
        const kpi = kpiList.find(k => k.id === line);
        if (!kpi) return 0;
        const cache = new Map();
        const v = evalFormulaWithCcTags(kpi.formula, flat, cache, kpiList, ccTagToCodes, resolveCcTag);
        return (v === null || isNaN(v)) ? 0 : v;
      };

      const head = [["Dimension", "Standard", "Compare 1", "Δ Amt", "Δ %", "Compare 2", "Δ Amt", "Δ %"]];
      const body = visibleDims.map(dim => {
        const dk = dim.code;
        const v1 = evalLine(pivot, prevPivot, dk);
        const v2 = evalLine(pivot2, prevPivot2, dk);
        const v3 = evalLine(pivot3, prevPivot3, dk);
        const fmt = v => v === 0 ? "—" : v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return [
          dim.name,
          fmt(v1), fmt(v2),
          v1 === 0 && v2 === 0 ? "—" : fmt(v1 - v2),
          v2 === 0 ? "—" : `${(((v1 - v2) / Math.abs(v2)) * 100).toFixed(1)}%`,
          fmt(v3),
          v1 === 0 && v3 === 0 ? "—" : fmt(v1 - v3),
          v3 === 0 ? "—" : `${(((v1 - v3) / Math.abs(v3)) * 100).toFixed(1)}%`,
        ];
      });

      autoTable(doc, { head, body, startY: 80, theme: "plain",
        styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: H.primary },
        headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "right" },
        columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 120 } },
        alternateRowStyles: { fillColor: H.band2 },
      });
    } else {
      const head = [["Account", ...dimCols.map(d => d.name ?? d.code ?? "—"), "TOTAL"]];
      const body = orderedRows.map(node => {
        const fmt = v => v === 0 ? "—" : v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const vals = dimCols.map(dim => getVal(node.AccountCode, dim.code ?? "__none__"));
        const total = vals.reduce((s, v) => s + v, 0);
        return [`${node.AccountCode}  ${node.AccountName ?? ""}`.trim(), ...vals.map(fmt), fmt(total)];
      });

      autoTable(doc, { head, body, startY: 80, theme: "plain",
        styles: { font: "helvetica", fontSize: 7, cellPadding: 3, textColor: H.primary },
        headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "right" },
        columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 140 }, [dimCols.length + 1]: { fillColor: H.highlight, fontStyle: "bold" } },
        alternateRowStyles: { fillColor: H.band2 },
        didParseCell: (d) => { if (d.section === "body" && d.column.index > 0) d.cell.styles.halign = "right"; },
      });
    }

    doc.save(`Konsolidator_Dimensions_${masterYear}_${String(masterMonth).padStart(2, "0")}.pdf`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, statementType, orderedRows, dimCols, getVal, pivot, prevPivot, pivot2, prevPivot2, pivot3, prevPivot3, viewMode, line, kpiList, ccTagToCodes, resolveCcTag, masterYear, masterMonth, masterSource, masterStructure, filterStr]);

  // Wire export functions to the ref so DimensionesPage FAB can call them
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current.xlsx = handleExportXlsx;
    exportRef.current.pdf  = handleExportPdf;
  }, [exportRef, handleExportXlsx, handleExportPdf]);
  // ── End export helpers ───────────────────────────────────────────────────

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

{/* Line filter — applies to all. Uses cc_tag KPIs from Supabase.
              Only KPIs that produce a non-zero value in at least one of the
              visible dim columns (any of the 3 scenarios) are shown — empty
              lines are hidden so the dropdown stays manageable. */}
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

                  // Build a flat Map<accountCode, number> for THIS dim col,
                  // applying the monthly delta if needed, then evaluate the
                  // selected KPI's formula against it.
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
const visibleDims = dimCols.filter(d => !!d.code);
                  const evalLine = (p, pPrev, label) => {
                    const flat = flattenForDim(p, pPrev);
                    if (line === "all") {
                      let total = 0;
                      flat.forEach(v => { total += v; });
                      return total;
                    }
                    const kpi = kpiList.find(k => k.id === line);
                    if (!kpi) return 0;
if (label === "Standard" && kpi.id === "revenue") {
                      const flatNonZero = [...flat.entries()].filter(([, v]) => Math.abs(v) > 0.005);
                      if (flatNonZero.length > 0) {
                        const flatCodes = flatNonZero.map(([code]) => code);
                        const revenueCodes = ccTagToCodes.get("CC_01-Revenue") ?? [];
                        const flatSet = new Set(flatCodes);
                        const revSet  = new Set(revenueCodes);
                        const intersection = flatCodes.filter(c => revSet.has(c));
                        const inFlatNotInCcTag = flatCodes.filter(c => !revSet.has(c));
                        console.log(`[Dim ${dimKey}] flat codes:`, flatCodes);
                        console.log(`[Dim ${dimKey}] CC_01-Revenue codes (sample):`, revenueCodes.slice(0, 15));
                        console.log(`[Dim ${dimKey}] intersection:`, intersection);
                        console.log(`[Dim ${dimKey}] in flat NOT in cc_tag:`, inFlatNotInCcTag);
                      }
                    }
const cache = new Map();
                    const v = evalFormulaWithCcTags(kpi.formula, flat, cache, kpiList, ccTagToCodes, resolveCcTag);
                    if (dimKey === visibleDims[0]?.code && label) {
                      console.log(`[Dim ${dimKey} / ${label}] result=${v}`);
                    }
                    return (v === null || isNaN(v)) ? 0 : v;
                  };
                  const v1 = evalLine(pivot,  prevPivot,  "Standard");
                  const v2 = evalLine(pivot2, prevPivot2, "Cmp1");
                  const v3 = evalLine(pivot3, prevPivot3, "Cmp2");
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
                  // Total row = sum of the line value across every dim column.
                  // We build one flat pivot per dim col, evaluate the KPI on
                  // each, and sum the results.
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

        {/* Synced header */}
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
                        title="View uploaded accounts">
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

        {/* Synced body */}
        <div ref={bodyRef} className="scrollbar-hide" style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }} onScroll={onBodyScroll}>
          <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: ACOL, minWidth: ACOL }} />
              {dimCols.map((_, i) => <col key={i} style={{ width: DCOL, minWidth: DCOL }} />)}
              <col style={{ width: TCOL, minWidth: TCOL }} />
            </colgroup>
<tbody>
              {(() => {
                // Codes that are already siblings in the flat list — drill-down
                // expansion should NOT re-render these as descendants, otherwise
                // the same account appears twice (once as a sibling, once nested).
                const flatCodes = new Set(orderedRows.map(n => String(n.AccountCode)));
                return orderedRows.map(node => {
                  const divider = dividerMap[String(node.AccountCode)];
                  return (
                    <React.Fragment key={node.AccountCode}>
                      {divider && (
                        <tr>
                          <td colSpan={dimCols.length + 2} style={{ backgroundColor: divider.color }} className="px-6 py-1.5">
                            <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
                          </td>
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
/* ── Main ─────────────────────────────────────────────────── */
export default function DimensionesPage({ token, sources = [], structures = [], companies = [], dimensions = [], groupAccounts = [] }) {
  const { colors } = useSettings();
  const header1Style = useTypo("header1");
  const underscore1Style = useTypo("underscore1");

  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [metaReady, setMetaReady] = useState(false);
const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("");
  const [company,   setCompany]   = useState("");
const [showAccounts, setShowAccounts] = useState(false);
const [selGroup, setSelGroup] = useState("");
const [compareMode, setCompareMode] = useState(false);
  // P&L / B/S statement type — lifted from PivotTab to drive PageHeader tabs
  const [statementType, setStatementType] = useState("pl");
  // Mapping application — Views modal + active custom mapping override
  const [viewsModalOpen, setViewsModalOpen]     = useState(false);
  const [activeMapping, setActiveMapping]       = useState(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pivotExportRef = useRef({ xlsx: null, pdf: null });

  const handleApplyMapping = useCallback((m) => {
    setActiveMapping({
      mapping_id:  m.mapping_id,
      name:        m.name,
      standard:    m.standard,
      plConverted: convertSavedMappingTree(m.pl_tree),
      bsConverted: convertSavedMappingTree(m.bs_tree),
      plSections:  extractSectionsFromTree(m.pl_tree),
      bsSections:  extractSectionsFromTree(m.bs_tree),
    });
    setWarningDismissed(false);
  }, []);

  const [rawData,   setRawData]   = useState([]);
const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

const probedRef = useRef({ source: "", structure: "", company: "" });
// Load group accounts hierarchy (needed for drill-down tree)
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
        console.log("[GROUP ACCOUNTS LOADED]", rows.length, "first:", rows[0]);
        setGroupAccountsLocal(rows);
      })
      .catch(e => console.error("group-accounts fetch failed:", e));
  }, [token]);

// Resolve KPIs against the current accounting standard
  const {
    kpiList,
    ccTagToCodes: defaultCcTagToCodes,
    resolveCcTag: defaultResolveCcTag,
  } = useKpiResolver(groupAccountsLocal);

  // Load Supabase row/section mappings for breakers (PGC / Danish / Spanish IFRS-ES)
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

const defaultPlMapping = pgcPlMapping ?? danishPlMapping ?? spIfrsEsPlMapping;
  const defaultBsMapping = pgcBsMapping ?? danishBsMapping ?? spIfrsEsBsMapping;

  // When a custom mapping is applied, its converted tree takes over for row
  // ordering and section breakers.
  const plMapping = activeMapping?.plConverted ?? defaultPlMapping;
  const bsMapping = activeMapping?.bsConverted ?? defaultBsMapping;

  // Effective ccTagToCodes + resolveCcTag. When a mapping is active:
  //   - Each section label is fuzzy-matched against cc_tag synonyms; matches
  //     override the default codes for that tag.
  //   - resolveCcTag is wrapped so any code the user has placed in the
  //     mapping (matched OR unmatched) doesn't get auto-resolved via the
  //     standard taxonomy — that would double-count.
  const { ccTagToCodes, resolveCcTag, mappingMatched, mappingUnmatched } = useMemo(() => {
    if (!activeMapping) {
      return {
        ccTagToCodes:     defaultCcTagToCodes,
        resolveCcTag:     defaultResolveCcTag,
        mappingMatched:   [],
        mappingUnmatched: [],
      };
    }
    const override = new Map(defaultCcTagToCodes);
    const matched = [];
    const unmatched = [];
    const mappedCodes = new Set();
    const allSections = new Map([
      ...(activeMapping.plSections || new Map()),
      ...(activeMapping.bsSections || new Map()),
    ]);
    allSections.forEach((codes, label) => {
      if (!codes || codes.length === 0) return;
      codes.forEach(c => mappedCodes.add(String(c)));
      const norm = normalizeLabel(label);
      let foundTag = null;
      for (const [ccTag, synonyms] of Object.entries(CC_TAG_SYNONYMS)) {
        if (synonyms.some(syn => norm.includes(normalizeLabel(syn)))) {
          foundTag = ccTag;
          break;
        }
      }
      if (foundTag) {
        override.set(foundTag, codes);
        matched.push({ ccTag: foundTag, label, codeCount: codes.length });
      } else {
        unmatched.push({ label, codeCount: codes.length });
      }
    });
    const wrappedResolve = (code) => {
      if (mappedCodes.has(String(code))) return null;
      return defaultResolveCcTag(code);
    };
    return {
      ccTagToCodes:     override,
      resolveCcTag:     wrappedResolve,
      mappingMatched:   matched,
      mappingUnmatched: unmatched,
    };
  }, [activeMapping, defaultCcTagToCodes, defaultResolveCcTag]);
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
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaReady, source, structure, company, token]);



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

  useEffect(() => {
    if (companies.length > 0 && !company) {
      const c = companies[0];
      setCompany(typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Defer setLoading(false) so React commits the new data first
      requestAnimationFrame(() => setLoading(false));
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
}, [metaReady, year, month, source, structure, company, authHeaders]);

  useEffect(() => { fetchData(); }, [fetchData]);

// Derive dim groups from the journal's `Dimensions` field — more reliable
// than the /v2/dimensions endpoint because we know the data is there if we
// see it here.
const dimGroups = useMemo(() => {
    const seen = new Set();
    rawData.forEach(r => {
      const pairs = parseDimensions(r.Dimensions);
      pairs.forEach(([group]) => { if (group) seen.add(group); });
    });
    return [...seen].sort();
  }, [rawData]);

  const sourceOpts    = [...new Set(sources.map(s  => typeof s === "object" ? (s.source    ?? s.Source    ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const companyOpts   = [...new Set(companies.map(c  => typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)).filter(Boolean))].map(v => ({ value: v, label: v }));

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

{/* Header */}
<PageHeader
        kicker="Individual"
        title="Dimensions"
        tabs={[
          { id: "pl", label: "P&L",           icon: TrendingUp },
          { id: "bs", label: "Balance Sheet", icon: Scale },
        ]}
        activeTab={statementType}
        onTabChange={setStatementType}
        filters={[
          ...(YEARS.length > 0
            ? [{ label: "Year", value: year, onChange: setYear,
                options: YEARS.map(y => ({ value: String(y), label: String(y) })) }]
            : []),
          ...(MONTHS.length > 0
            ? [{ label: "Month", value: month, onChange: setMonth,
                options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) }]
            : []),
          ...(sourceOpts.length > 0
            ? [{ label: "Source", value: source, onChange: setSource, options: sourceOpts }]
            : []),
          ...(structureOpts.length > 0
            ? [{ label: "Structure", value: structure, onChange: setStructure, options: structureOpts }]
            : []),
          ...(companyOpts.length > 0
            ? [{ label: "Company", value: company, onChange: setCompany, options: companyOpts }]
            : []),
          ...(dimGroups.length > 0
            ? [{
                label: "Dim Group",
                value: selGroup,
                onChange: setSelGroup,
                options: [{ value: "", label: "All" }, ...dimGroups.map(g => ({ value: g, label: g }))],
              }]
            : []),
        ]}
        compareToggle={{
          active: compareMode,
          onChange: setCompareMode,
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
                onClick: async () => {
                  setExporting(true);
                  try { await pivotExportRef.current.xlsx?.(); }
                  finally { setExporting(false); }
                },
              },
              {
                id: "pdf",
                label: "PDF",
                src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png",
                alt: "PDF",
                onClick: async () => {
                  setExporting(true);
                  try { await pivotExportRef.current.pdf?.(); }
                  finally { setExporting(false); }
                },
              },
            ],
          },
        ]}
      />

      <MappingsModal
        open={viewsModalOpen}
        onClose={() => setViewsModalOpen(false)}
        groupAccounts={groupAccountsLocal}
        onApply={handleApplyMapping}
      />

      {activeMapping && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm flex-shrink-0">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
          <span className="text-xs text-emerald-700 font-medium">
            Custom mapping active: <strong className="font-black">{activeMapping.name}</strong>
            <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
          </span>
          <button
            onClick={() => setActiveMapping(null)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
            title="Clear mapping and use default"
          >
            <X size={11} />
            Clear
          </button>
        </div>
      )}

      {activeMapping && !warningDismissed && (
        <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 shadow-sm flex-shrink-0">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-xs text-amber-800 leading-relaxed">
            <strong className="font-black">Heads up:</strong> los cálculos se han recomputado con el mapping en lo posible.
            {mappingMatched.length > 0 && (
              <> <span className="font-black text-amber-900">{mappingMatched.length}</span> sección{mappingMatched.length === 1 ? "" : "es"} emparejada{mappingMatched.length === 1 ? "" : "s"} ({mappingMatched.slice(0, 3).map(m => m.label).join(", ")}{mappingMatched.length > 3 ? "…" : ""}).</>
            )}
            {mappingUnmatched.length > 0 && (
              <> <span className="font-black text-amber-900">{mappingUnmatched.length}</span> sin emparejar — siguen usando la taxonomía por defecto.</>
            )}
          </div>
          <button
            onClick={() => setWarningDismissed(true)}
            className="flex-shrink-0 w-6 h-6 rounded-md hover:bg-amber-100 text-amber-600 flex items-center justify-center transition-colors"
            title="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      )}

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
<PivotTab data={rawData} dimensions={dimensions} groupAccounts={groupAccountsLocal} onShowAccounts={() => setShowAccounts(true)} selGroup={selGroup} dimGroups={dimGroups} compareMode={compareMode} statementType={statementType} sources={sources} structures={structures} companies={companies} token={token} masterYear={year} masterMonth={month} masterSource={source} masterStructure={structure} masterCompany={company} kpiList={kpiList} ccTagToCodes={ccTagToCodes} resolveCcTag={resolveCcTag} plMapping={plMapping} bsMapping={bsMapping} exportRef={pivotExportRef} />

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