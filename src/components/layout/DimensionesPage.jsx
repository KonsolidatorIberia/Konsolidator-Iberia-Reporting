import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import ViewsSelector from "./ViewsSelector.jsx";
function useAnimatedNumber(target, duration = 800) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const from = Number(fromRef.current) || 0;
    const to = Number(target) || 0;
    if (from === to) { setDisplay(to); return; }
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return display;
}
import { ChevronDown, ChevronRight, Loader2, X, RefreshCw, Search, Database, GitMerge, Maximize2, Minimize2, Library, CheckCircle2, AlertTriangle, TrendingUp, Scale, BarChart2, Download, Layers, Pencil, FileText } from "lucide-react";

let __globalResizing = false;
const __resizeListeners = new Set();
if (typeof window !== "undefined") {
  let __rt;
  window.addEventListener("resize", () => {
    __globalResizing = true;
    __resizeListeners.forEach(fn => fn(true));
    clearTimeout(__rt);
    __rt = setTimeout(() => {
      __globalResizing = false;
      __resizeListeners.forEach(fn => fn(false));
    }, 200);
  });
}

function useCountUp(target, animate = true, duration = 900) {
  // Track display via state (for re-renders) AND via ref (for accurate `from`
  // value inside the effect — closure capture would otherwise be stale).
const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  // Effect reacts to `target` changes; `animate=false` snaps without tweening.
  // the signature for backward compat with existing call sites, but doesn't
  // gate the animation. Windowing already bounds how many cells animate
  // simultaneously, so we don't need this flag to throttle.
useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = displayRef.current;
    const to = Number(target) || 0;
    if (from === to) return;                       // mount or no-op
    if (!animate || __globalResizing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(to); // intentional: snap to target without tweening
      return;
    }
    let start = null;
    const tick = (ts) => {
      if (start === null) start = ts;
      const elapsed = ts - start;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
return () => cancelAnimationFrame(rafRef.current);
  }, [target, animate, duration]);

  return display;
}

// Strips Infinity/NaN cells + ExcelJS quirks so Excel doesn't pop "recovered content"
async function repairDimXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  for (const f of sheets) {
    let xml = await zip.file(f).async("string");
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>-?Infinity<\/v><\/c>/g, "");
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>NaN<\/v><\/c>/g, "");
xml = xml.replace(/(<row[^>]*outlineLevel="\d+"[^>]*?)\s*collapsed="1"/g, "$1");
    xml = xml.replace(/x14ac:dyDescent="55"/g, 'x14ac:dyDescent="0.25"');
    // Cap outlineLevel attributes to 7 (Excel's hard max). Anything higher rejects the file.
    xml = xml.replace(/outlineLevel="(\d+)"/g, (_, n) => `outlineLevel="${Math.min(7, parseInt(n))}"`);
    // Strip empty <v/> tags that ExcelJS sometimes emits for unset numeric cells
    xml = xml.replace(/<c r="[^"]+"[^>]*><v><\/v><\/c>/g, "");
    const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"/g)];
    if (cells.length > 0) {
      const cs = cells.map(c => colToNum(c[1]));
      const rs = cells.map(c => +c[2]);
      const ref = `${numToCol(Math.min(...cs))}${Math.min(...rs)}:${numToCol(Math.max(...cs))}${Math.max(...rs)}`;
      xml = xml.replace(/<dimension ref="[^"]+"\s*\/>/, `<dimension ref="${ref}"/>`);
    }
    zip.file(f, xml);
  }
  return await zip.generateAsync({ type: "arraybuffer" });
}

const DimAmountCell = React.memo(function DimAmountCell({ value, animate, typoStyle, borderLeft, bgColor, extraStyle }) {
  const target = value ?? 0;
  const v = useCountUp(target, !!animate, 900);
  const isEmpty = target === 0;
  const isNeg = v < 0;
  const color = isEmpty ? "#D1D5DB" : isNeg ? "#EF4444" : "#000000";
  const fmt = (n) => Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
<td className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums" style={{ ...typoStyle, color, borderLeft: borderLeft ? "2px solid #f0f0f0" : undefined, background: bgColor ?? undefined, ...extraStyle }}>
      {isEmpty ? "—" : isNeg ? `(${fmt(v)})` : fmt(v)}
    </td>
  );
});

// Animated diff amount cell — same format as DimAmountCell but with a color
// driven by the sign of the diff (green/red/gray) rather than the value itself.
const DimDiffCell = React.memo(function DimDiffCell({ value, animate, color, width, bgColor, extraStyle }) {
  const target = value ?? 0;
  const v = useCountUp(target, !!animate, 900);
  const fmt = (n) => Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <td className="px-2 py-2.5 text-center whitespace-nowrap tabular-nums text-xs font-bold" style={{ color, width, background: bgColor, ...extraStyle }}>
      {target === 0 ? "—" : v < 0 ? `(${fmt(v)})` : fmt(v)}
    </td>
  );
});

// Animated percent cell — handles null target (renders "—") and signed display.
const DimPctCell = React.memo(function DimPctCell({ value, animate, color, width, bgColor, extraStyle }) {
  const isNull = value === null || value === undefined;
  const target = isNull ? 0 : value;
  const v = useCountUp(target, !!animate, 900);
  return (
    <td className="px-2 py-2.5 text-center whitespace-nowrap tabular-nums text-xs font-bold" style={{ color, width, background: bgColor, ...extraStyle }}>
      {isNull ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
    </td>
  );
});
import { useTypo, useSettings } from "./SettingsContext";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";
import { t } from "../../lib/i18n";
import PageHeader, { FilterPill as HeaderFilterPill, MultiFilterPill } from "./PageHeader.jsx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
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
const [loadedStandard, setLoadedStandard] = useState(null);
  const [loaded, setLoaded] = useState({
    kpiList: [],
    ccTagToCodes: new Map(),
    resolveCcTag: () => null,
  });

useEffect(() => {
    if (!standard) return; // initial state already represents "no standard"
    let cancelled = false;
    Promise.all([loadStandardMapping(standard, groupAccounts), loadKpiLibrary()])
      .then(([mapping, kpiList]) => {
        if (cancelled) return;
        setLoaded({
          kpiList,
          ccTagToCodes: mapping?.ccTagToCodes ?? new Map(),
          resolveCcTag: mapping?.resolveCcTag ?? (() => null),
        });
        setLoadedStandard(standard);
      })
      .catch(e => {
        if (cancelled) return;
        console.error("[DimResolver] load failed:", e);
        setLoadedStandard(standard);
      });
    return () => { cancelled = true; };
  }, [standard, groupAccounts]);

  const ready = !standard || loadedStandard === standard;
  return { ...loaded, standard, ready };
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
// Saved-mapping LITERAL tree (preserves duplicates + dims + hierarchy + breakers).
// Used to render mappings the same way AccountsDashboard's PLStatement/BalanceSheet do.
function buildSavedMappingLiteral(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return null;
  const sections = []; // [{ label, color, nodes: [literalNode, ...] }]
  let current = { label: null, color: null, nodes: [] };
  sections.push(current);

function literal(node, depth, visited = new WeakSet()) {
    if (!node || depth > 50 || visited.has(node)) {
      return {
        id: String(node?.id ?? `truncated-${Math.random()}`),
        code: String(node?.code ?? ""),
        name: String(node?.name ?? ""),
        dims: null, isSum: false, depth, children: [],
      };
    }
    visited.add(node);
    return {
      id: String(node.id ?? `${node.code}-${Math.random()}`),
      code: String(node.code ?? ""),
      name: String(node.name ?? ""),
      dims: Array.isArray(node.dims) && node.dims.length > 0 ? node.dims : null,
      isSum: !!node.isSum || !!node.isSumAccount,
      depth,
      children: (node.children || [])
        .filter(c => c && c.kind !== "breaker")
        .map(c => literal(c, depth + 1, visited)),
    };
  }

  for (const node of tree) {
    if (!node) continue;
    if (node.kind === "breaker") {
      current = { label: String(node.name ?? ""), color: node.color || "#1a2f8a", nodes: [] };
      sections.push(current);
      (node.children || [])
        .filter(c => c && c.kind !== "breaker")
        .forEach(c => current.nodes.push(literal(c, 0)));
    } else {
      current.nodes.push(literal(node, 0));
    }
  }
  const cleaned = sections.filter((s, i) => i > 0 || s.nodes.length > 0);
  return cleaned.length === 0 ? null : cleaned;
}

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

const C = {
  primary:   "FF1A2F8A",
  highlight: "FFEEF1FB",
  white:     "FFFFFFFF",
  band1:     "FFFFFFFF",
  band2:     "FFF8F9FF",
  gray400:   "FF9CA3AF",
  red:       "FFDC2626",
};

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
    // Defend against self-referencing SumAccountCode rows that would otherwise
    // attach a node as its own child and break every recursion downstream.
    const isSelfRef = a.SumAccountCode && String(a.SumAccountCode) === String(a.AccountCode);
    const parent = !isSelfRef && a.SumAccountCode ? map.get(a.SumAccountCode) : null;

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
const DimensionRow = React.memo(function DimensionRow({ node, depth, expandedSet, onToggle, dimCols, getVal, getCmpVal, compareMode, cmpVisible, cmpExiting, body1Style, body2Style, header2Style, colors, excludeCodes = null, rowIndex = 0, searchQuery = "", searchExpansionSet = null, valCache = null, cmpCache = null, isAnimatingData = false, tableJustLoaded = false, cmpRecentlyToggled = false }) {
  const subbody2Style = useTypo("subbody2");
  const code = node.AccountCode;
  const visibleChildren = excludeCodes
    ? (node.children || []).filter(c => !excludeCodes.has(String(c.AccountCode)))
    : (node.children || []);
  const hasChildren = visibleChildren.length > 0;
  const isExpanded = expandedSet.has(code) || (searchExpansionSet?.has(String(code)) ?? false);
  const q = (searchQuery ?? "").trim().toLowerCase();
  const isMatch = !!q && (String(code ?? "").toLowerCase().includes(q) || String(node.AccountName ?? node.accountName ?? "").toLowerCase().includes(q));

  // Rollup logic: when a node has children that produce a non-zero sum, trust
  // the children — the journal often carries the same money at BOTH the summary
  // AccountCode and its leaf postings, so adding self on top double-counts.
  // Fall back to self's own value only when every child resolves to zero (covers
  // accounts posted directly at the summary level with no separate leaf rows).
const getNodeVal = (dimKey) => {
    const sumNode = (n, depth = 0) => {
      if (depth > 25) return 0;
      const k = `${n.AccountCode}|${dimKey}`;
      if (valCache) {
        const cached = valCache.get(k);
        if (cached !== undefined) return cached;
      }
      let v;
      if (n.children && n.children.length > 0) {
        const childSum = n.children.reduce((s, c) => s + sumNode(c, depth + 1), 0);
        v = childSum !== 0 ? childSum : getVal(n.AccountCode, dimKey);
      } else {
        v = getVal(n.AccountCode, dimKey);
      }
      if (valCache) valCache.set(k, v);
      return v;
    };
    return sumNode(node);
  };

  const getCmpNodeVal = (dimKey) => {
    if (!getCmpVal) return 0;
    const sumNode = (n, depth = 0) => {
      if (depth > 25) return 0;
      const k = `${n.AccountCode}|${dimKey}`;
      if (cmpCache) {
        const cached = cmpCache.get(k);
        if (cached !== undefined) return cached;
      }
      let v;
      if (n.children && n.children.length > 0) {
        const childSum = n.children.reduce((s, c) => s + sumNode(c, depth + 1), 0);
        v = childSum !== 0 ? childSum : getCmpVal(n.AccountCode, dimKey);
      } else {
        v = getCmpVal(n.AccountCode, dimKey);
      }
      if (cmpCache) cmpCache.set(k, v);
      return v;
    };
    return sumNode(node);
  };

  const rowTotal = dimCols.reduce((s, d) => s + getNodeVal(d.code ?? "__none__"), 0);
  const rowStyle = depth === 0 ? body1Style : body2Style;

  return (
    <>
<tr
        className={`border-b border-gray-100 ${isMatch ? "bg-[#fef3c7]" : "bg-white hover:bg-[#eef1fb]/60"}`}
        style={tableJustLoaded && rowIndex < 25 ? { animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both` } : undefined}
      >
<td
          className={`py-2.5 sticky left-0 z-10 border-r border-gray-100 ${isMatch ? "bg-[#fef3c7]" : "bg-white"}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 300, willChange: "transform" }}
          onClick={() => hasChildren && onToggle(code)}
        >
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}>
            {hasChildren
              ? <span className="flex-shrink-0 mr-2" style={{ color: colors.primary }}>
                  {isExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                </span>
              : <span className="inline-block mr-2" style={{ width: 12 }} />}
<span className="flex-shrink-0 mr-2" style={subbody2Style}>{code}</span>
            <span className="truncate max-w-[280px]" style={rowStyle}>{node.AccountName ?? node.accountName ?? ""}</span>
          </div>
        </td>
{dimCols.map(dim => {
          const dk = dim.code ?? "__none__";
          const val = getNodeVal(dk);
          const cmpVal = getCmpNodeVal(dk);
          const diff = val - cmpVal;
          const pct = cmpVal !== 0 ? (diff / Math.abs(cmpVal)) * 100 : null;
          const devColor = diff === 0 ? "#D1D5DB" : diff > 0 ? "#059669" : "#EF4444";
          const cmpAnim = cmpRecentlyToggled
            ? { animation: `${cmpExiting ? "cmpCellOut" : "cmpCellIn"} 420ms cubic-bezier(0.4,0,0.2,1) 0ms forwards` }
            : undefined;
          return (
            <React.Fragment key={dk}>
              <DimAmountCell value={val} typoStyle={rowStyle} animate={isAnimatingData} />
{cmpVisible && <>
                <DimAmountCell value={cmpVal} typoStyle={rowStyle} animate={isAnimatingData} bgColor="#fafbff" extraStyle={cmpAnim} />
                <DimDiffCell value={diff} animate={isAnimatingData} color={devColor} width={110} bgColor="#f5f7ff" extraStyle={cmpRecentlyToggled ? { animation: `${cmpExiting ? "cmpCellOut" : "cmpCellIn"} 420ms cubic-bezier(0.4,0,0.2,1) 40ms forwards` } : undefined} />
                <DimPctCell value={pct} animate={isAnimatingData} color={devColor} width={90} bgColor="#f0f3ff" extraStyle={cmpRecentlyToggled ? { animation: `${cmpExiting ? "cmpCellOut" : "cmpCellIn"} 420ms cubic-bezier(0.4,0,0.2,1) 80ms forwards` } : undefined} />
              </>}
            </React.Fragment>
          );
        })}
{!cmpVisible && <DimAmountCell value={rowTotal} typoStyle={rowStyle} animate={isAnimatingData} bgColor="#fafafa" extraStyle={{ position: "sticky", right: 0, zIndex: 10, borderLeft: "1px solid #f3f4f6", minWidth: 150 }} />}
      </tr>
{isExpanded && hasChildren && visibleChildren.map((child, ci) => (
<DimensionRow key={child.AccountCode} node={child} depth={depth + 1}
          expandedSet={expandedSet} onToggle={onToggle}
          dimCols={dimCols} getVal={getVal} getCmpVal={getCmpVal} compareMode={compareMode} cmpVisible={cmpVisible} cmpExiting={cmpExiting}
          body1Style={body1Style} body2Style={body2Style}
          header2Style={header2Style} colors={colors}
          excludeCodes={excludeCodes} rowIndex={rowIndex + ci + 1}
          searchQuery={searchQuery} searchExpansionSet={searchExpansionSet}
          valCache={valCache} cmpCache={cmpCache}
          isAnimatingData={isAnimatingData} tableJustLoaded={tableJustLoaded} cmpRecentlyToggled={cmpRecentlyToggled} />
      ))}
    </>
  );
  
}, (prev, next) => {
  // Skip re-render if this row's own state didn't change.
  if (prev.node !== next.node) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.dimCols !== next.dimCols) return false;
  if (prev.getVal !== next.getVal) return false;
  if (prev.getCmpVal !== next.getCmpVal) return false;
  if (prev.compareMode !== next.compareMode) return false;
  if (prev.cmpVisible !== next.cmpVisible) return false;
  if (prev.searchQuery !== next.searchQuery) return false;
  if (prev.valCache !== next.valCache) return false;
  if (prev.cmpCache !== next.cmpCache) return false;
  if (prev.isAnimatingData !== next.isAnimatingData) return false;
  if (prev.tableJustLoaded !== next.tableJustLoaded) return false;
  if (prev.cmpRecentlyToggled !== next.cmpRecentlyToggled) return false;
  // Re-render if THIS row's expansion flipped (own state changed).
  const code = prev.node.AccountCode;
  const prevExpanded = prev.expandedSet.has(code) || (prev.searchExpansionSet?.has(String(code)) ?? false);
  const nextExpanded = next.expandedSet.has(code) || (next.searchExpansionSet?.has(String(code)) ?? false);
  if (prevExpanded !== nextExpanded) return false;
  // If this row IS expanded, its descendants are mounted inside it. A change
  // elsewhere in expandedSet/searchExpansionSet could be a descendant toggling —
  // we must re-render so the new Set instance flows down the tree. When collapsed,
  // there are no descendants to update, so we can safely skip.
  if (nextExpanded) {
    if (prev.expandedSet !== next.expandedSet) return false;
    if (prev.searchExpansionSet !== next.searchExpansionSet) return false;
  }
  return true;
});


/* ── Accounts Tab ─────────────────────────────────────────── */
function AccountsTab({ data }) {
  const { locale } = useSettings();
  const T = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const [search, setSearch] = useState("");
  const cols = data.length > 0 ? Object.keys(data[0]) : [];
  const filtered = search.trim()
    ? data.filter(r => Object.values(r).some(v => String(v ?? "").toLowerCase().includes(search.toLowerCase())))
    : data;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-3 flex-shrink-0">
<span className="text-xs font-bold text-[#1a2f8a] bg-[#eef1fb] px-3 py-1.5 rounded-xl">{data.length} {T("table_records")}</span>
        {search && <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl">{filtered.length} {T("table_matching")}</span>}
        <div className="ml-auto flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
          <Search size={13} className="text-gray-400" />
<input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={T("search_placeholder")}
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
                    if (typeof val === "boolean") return <td key={j} className={`px-4 py-2.5 font-semibold ${val ? "text-emerald-600" : "text-gray-400"}`}>{val ? T("cell_yes") : T("cell_no")}</td>;
                    if (typeof val === "number") return <td key={j} className="px-4 py-2.5 font-mono text-center">{val.toLocaleString()}</td>;
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
function PivotTab({ data, dimensions, groupAccounts = [], selGroups = new Set(), selDims = new Set(), compareMode, statementType = "pl", externalViewMode = null, sources = [], structures = [], companies = [], token = "", masterYear = "", masterMonth = "", masterSource = "", masterStructure = "", masterCompany = "", kpiList = [], ccTagToCodes = new Map(), resolveCcTag = () => null, plMapping = null, bsMapping = null, plLiteral = null, bsLiteral = null, exportRef = null, hasCustomMapping = false }) {

const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const header3Style = useTypo("header3");
  const subbody2Style = useTypo("subbody2");
const { colors, locale } = useSettings();
  const T = useCallback((k, fb) => t(locale, k, fb), [locale]);

// Account header search — magnifier toggles to input, matches highlight in yellow.
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef(null);

  // Summary/Detailed toggle (only used in non-compare mode). statementType
  // is lifted to DimensionesPage to drive PageHeader tabs.
const [summaryMode, setSummaryMode] = useState(true);
  // `cmpExiting` is the only stored state — `cmpVisible` is derived.
  // Trigger logic runs at render (adjust-state-on-prop-change); the actual
  // exit timer lives in an effect keyed off `cmpExiting`.
  const [cmpExiting, setCmpExiting] = useState(false);
  const [prevCompareMode, setPrevCompareMode] = useState(compareMode);
  if (prevCompareMode !== compareMode) {
    setPrevCompareMode(compareMode);
    if (compareMode) {
      if (cmpExiting) setCmpExiting(false); // re-entered before exit finished
    } else {
      setCmpExiting(true); // start exit animation
    }
  }
  const cmpVisible = compareMode || cmpExiting;

  useEffect(() => {
    if (!cmpExiting) return;
    const t = setTimeout(() => setCmpExiting(false), 450);
    return () => clearTimeout(t);
  }, [cmpExiting]);
  const headerRef = useRef(null);
  const bodyRef   = useRef(null);
  const onBodyScroll   = useCallback(() => { if (headerRef.current) headerRef.current.scrollLeft = bodyRef.current.scrollLeft; }, []);
  const onHeaderScroll = useCallback(() => { if (bodyRef.current)   bodyRef.current.scrollLeft = headerRef.current.scrollLeft; }, []);

// Each tab keeps its own expansion state — switching tabs doesn't lose what
// you had open, and going back restores it.
  const [expandedSetPL, setExpandedSetPL] = useState(new Set());
  const [expandedSetBS, setExpandedSetBS] = useState(new Set());
  const expandedSet    = statementType === "pl" ? expandedSetPL    : expandedSetBS;
  const setExpandedSet = statementType === "pl" ? setExpandedSetPL : setExpandedSetBS;

// Track viewport so we can window large render passes.
  const [scrollTop, setScrollTop] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(800);

  // Three short-lived animation flags. Each one gates a specific animation so
  // it only fires on the event that warrants it, never during scroll or expand.
  //   - isAnimatingData : true for ~1s after pivot identity changes (count-up)
  //   - tableJustLoaded : true for ~1.5s after data load (row slide-in)
  //   - cmpRecentlyToggled : true for ~500ms after compare flips (cmp cells in/out)
  const [isAnimatingData, setIsAnimatingData] = useState(false);
  const [tableJustLoaded, setTableJustLoaded] = useState(false);
  const [cmpRecentlyToggled, setCmpRecentlyToggled] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrollTop(el.scrollTop);
        ticking = false;
      });
    };
    const ro = new ResizeObserver(() => setBodyHeight(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    setBodyHeight(el.clientHeight);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, []);

const toggleExpand = useCallback(code => {
    setExpandedSet(prev => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  }, [setExpandedSet]);

// Build pivot from data
const { accountMap: allAccountMap, dimCols, pivot } = useMemo(() => {
    if (!data.length) return { accountMap: new Map(), dimCols: [], pivot: new Map() };

    // Filter rows by selected group: keep rows that have AT LEAST ONE dim
    // in the selected group, OR rows with no dim at all (totals).
const rows = selGroups.size === 0
      ? data
      : data.filter(r => {
          const pairs = parseDimensions(r.Dimensions);
          if (pairs.length === 0) return true;
          return pairs.some(([group, code]) => {
            if (!selGroups.has(group)) return false;
            if (selDims.size > 0 && !selDims.has(code)) return false;
            return true;
          });
        });

// Get codes that actually have data in this period (with their names from data rows)
    const dataAccountInfo = new Map();
    rows.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!code) return;
      const lac = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (lac && lac !== "—") return;
const acType = r.AccountType ?? r.accountType ?? "";
      const targetType = statementType === "bs" ? "B/S" : "P/L";
      if (acType && acType !== targetType) return;
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
      const targetType = statementType === "bs" ? "B/S" : "P/L";
      if (acType && acType !== targetType) return;
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
        if (!dimMap.has("__none__")) dimMap.set("__none__", { code: null, name: T("no_dimension"), group: null });
        return;
      }
      for (const [group, code] of pairs) {
      if (selGroups.size > 0 && !selGroups.has(group)) continue;
        if (selDims.size > 0 && !selDims.has(code)) continue;
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
const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
     // Keep all rows including leaf-level postings — descendants roll up via parentOf
const targetType = statementType === "bs" ? "B/S" : "P/L";
      if (acType && acType !== targetType) return;

      const pairs = parseDimensions(r.Dimensions);
      if (pairs.length === 0) {
        if (!pivot.has(ac)) pivot.set(ac, new Map());
        pivot.get(ac).set("__none__", (pivot.get(ac).get("__none__") ?? 0) + amt);
        return;
      }

      for (const [group, code] of pairs) {
        if (selGroups.size > 0 && !selGroups.has(group)) continue;
        if (selDims.size > 0 && !selDims.has(code)) continue;
        if (!pivot.has(ac)) pivot.set(ac, new Map());
        pivot.get(ac).set(code, (pivot.get(ac).get(code) ?? 0) + amt);
      }
    });

return { accountMap, dimCols, pivot };
}, [data, selGroups, selDims, groupAccounts, statementType, dimensions, T]);

// Row slide-in fires only when the table itself appears: first time data lands,
// or when the user switches between PL and BS. Filter changes / view-mode
// toggles produce the count-up animation but never re-slide rows.
const hasLoadedOnceRef = useRef(false);
useEffect(() => {
  if (pivot.size === 0) return;
  if (!hasLoadedOnceRef.current) {
    hasLoadedOnceRef.current = true;
    setTableJustLoaded(true);
    const t = setTimeout(() => setTableJustLoaded(false), 1500);
    return () => clearTimeout(t);
  }
}, [pivot]);

// Statement type switch (PL ↔ BS) also re-runs the slide-in — it's effectively
// a different table appearing.
useEffect(() => {
  if (!hasLoadedOnceRef.current) return; // skip initial mount; handled above
  setTableJustLoaded(true);
  const t = setTimeout(() => setTableJustLoaded(false), 1500);
  return () => clearTimeout(t);
}, [statementType]);

// Flip the flag at render on cmpVisible change, then clear it in an effect.
const [prevCmpVisibleForToggle, setPrevCmpVisibleForToggle] = useState(cmpVisible);
if (prevCmpVisibleForToggle !== cmpVisible) {
  setPrevCmpVisibleForToggle(cmpVisible);
  setCmpRecentlyToggled(true);
}
useEffect(() => {
  if (!cmpRecentlyToggled) return;
  const t = setTimeout(() => setCmpRecentlyToggled(false), 500);
  return () => clearTimeout(t);
}, [cmpRecentlyToggled]);

const [colOrder, setColOrder] = useState(null); // null = use natural order
  const [draggingCol, setDraggingCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const orderedDimCols = useMemo(() => {
    if (!colOrder) return dimCols;
    const map = new Map(dimCols.map(d => [d.code ?? "__none__", d]));
    return colOrder.map(k => map.get(k)).filter(Boolean);
  }, [dimCols, colOrder]);

// Reset col order only when the actual set of dim codes changes, not on compare toggle.
  // Done during render (React's recommended pattern for "adjust state on prop change")
  // rather than in an effect — avoids an extra render cycle.
  const dimColKeys = useMemo(() => dimCols.map(d => d.code ?? "__none__").join(","), [dimCols]);
  const [prevDimColKeys, setPrevDimColKeys] = useState(dimColKeys);
  if (prevDimColKeys !== dimColKeys) {
    setPrevDimColKeys(dimColKeys);
    setColOrder(null);
  }

  const expandAll = useCallback(() => {
    const literal = statementType === "pl" ? plLiteral : bsLiteral;
    if (literal && literal.length > 0) {
      const keys = [];
      literal.forEach((section, secIdx) => {
        const walk = (node, parentPath) => {
          if (node.children && node.children.length > 0) {
            keys.push(`litrow-${secIdx}-${parentPath}-${node.id}`);
            node.children.forEach(c => walk(c, `${parentPath}-${node.id}`));
          }
        };
        section.nodes.forEach(n => walk(n, "root"));
      });
      setExpandedSet(new Set(keys));
      return;
    }
setExpandedSet(new Set([...allAccountMap.keys()]));
  }, [allAccountMap, plLiteral, bsLiteral, statementType, setExpandedSet]);

const collapseAll = useCallback(() => setExpandedSet(new Set()), [setExpandedSet]);

const sign = statementType === "pl" ? -1 : 1;



  // Compare filter states

const [cmp2Source, setCmp2Source]       = useState(masterSource);
  const [cmp2Year, setCmp2Year]           = useState(masterYear);
  const [cmp2Month, setCmp2Month]         = useState(masterMonth);
  const [cmp2Structure, setCmp2Structure] = useState(masterStructure);
  const [cmp2Company, setCmp2Company]     = useState(masterCompany);
  const [cmp2SelGroups, setCmp2SelGroups] = useState(new Set());
  const [cmp2SelDims,   setCmp2SelDims]   = useState(new Set());
const [cmp3Source]    = useState(masterSource);
  const [cmp3Year]      = useState(masterYear);
  const [cmp3Month]     = useState(masterMonth);
  const [cmp3Structure] = useState(masterStructure);
  const [cmp3Company]   = useState(masterCompany);

const [line, setLine] = useState("all");
const viewMode = externalViewMode ?? "monthly";
const [prevPivot] = useState(new Map());
  const [prevPivotMain, setPrevPivotMain] = useState(new Map());
  const [prevPivot2, setPrevPivot2] = useState(new Map());
  const [prevPivot3, setPrevPivot3] = useState(new Map());

const getVal = useCallback((ac, dk) => {
    const ytd = (pivot.get(ac)?.get(dk) ?? 0) * sign;
    if (viewMode === "ytd") return ytd;
    const prevYtd = (prevPivotMain.get(ac)?.get(dk) ?? 0) * sign;
    return ytd - prevYtd;
  }, [pivot, prevPivotMain, sign, viewMode]);

// Shared rollup cache. New Map() when underlying data changes; otherwise
  // the same Map is reused across every DimensionRow + expand/collapse, so
  // walking the BS tree only happens once per node per render cycle.
 // `getVal` referenced solely as cache-invalidation key — when its identity
  // changes (data/sign/viewMode shifts), the cache resets.
  const valCache = useMemo(() => { void getVal; return new Map(); }, [getVal]);

  const [cmp2Data, setCmp2Data] = useState([]);
  const [cmp3Data, setCmp3Data] = useState([]);
const [, setCmp2Loading] = useState(false);
  const [, setCmp3Loading] = useState(false);

const buildPivot = useCallback((rows, grpFilter = selGroups, dimFilter = selDims) => {
    const p = new Map();
    rows.forEach(r => {
      const ac  = r.AccountCode ?? r.accountCode ?? "";
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      // Keep all rows including leaf-level postings — descendants roll up via parentOf
      const targetType = statementType === "bs" ? "B/S" : "P/L";
      if (acType && acType !== targetType) return;

      const pairs = parseDimensions(r.Dimensions);
      if (pairs.length === 0) {
        if (!p.has(ac)) p.set(ac, new Map());
        p.get(ac).set("__none__", (p.get(ac).get("__none__") ?? 0) + amt);
        return;
      }

      for (const [group, code] of pairs) {
        if (grpFilter.size > 0 && !grpFilter.has(group)) continue;
        if (dimFilter.size > 0 && !dimFilter.has(code)) continue;
        if (!p.has(ac)) p.set(ac, new Map());
        p.get(ac).set(code, (p.get(ac).get(code) ?? 0) + amt);
      }
    });
    return p;
}, [selGroups, selDims, statementType]);

const pivot2 = useMemo(() => buildPivot(cmp2Data, cmp2SelGroups, cmp2SelDims), [cmp2Data, cmp2SelGroups, cmp2SelDims, buildPivot]);
  const pivot3 = useMemo(() => buildPivot(cmp3Data), [cmp3Data, buildPivot]);

// Same cache-invalidation pattern as valCache — deps are referenced via
  // `void` so ESLint sees them as used.
  const cmpCache = useMemo(() => {
    void pivot2; void prevPivot2; void sign; void viewMode;
    return new Map();
  }, [pivot2, prevPivot2, sign, viewMode]);



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

// Fetch prev month for main period (non-compare monthly mode)
  useEffect(() => {
    if (viewMode !== "monthly" || !masterYear || !masterMonth || !masterSource || !masterStructure || !masterCompany) return;
    const mo = Number(masterMonth);
    const yr = Number(masterYear);
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevYr = mo === 1 ? yr - 1 : yr;
    fetchCmpData(String(prevYr), String(prevMo), masterSource, masterStructure, masterCompany, (d) => setPrevPivotMain(buildPivot(d)), () => {});
  }, [viewMode, masterYear, masterMonth, masterSource, masterStructure, masterCompany, fetchCmpData, buildPivot]);


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

const cmp2DimGroups = useMemo(() => {
    const seen = new Set();
    cmp2Data.forEach(r => parseDimensions(r.Dimensions).forEach(([g]) => { if (g) seen.add(g); }));
    return [...seen].sort().map(v => ({ value: v, label: v }));
  }, [cmp2Data]);

  const cmp2AllDims = useMemo(() => {
    if (cmp2SelGroups.size === 0) return [];
    const seen = new Set();
    cmp2Data.forEach(r => parseDimensions(r.Dimensions).forEach(([g, code]) => { if (cmp2SelGroups.has(g)) seen.add(code); }));
    return [...seen].sort().map(v => ({ value: v, label: v }));
  }, [cmp2Data, cmp2SelGroups]);

  const cmpSources    = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const cmpYears      = YEARS.map(y => ({ value: String(y), label: String(y) }));
  const cmpMonths     = MONTHS.map(m => ({ value: String(m.value), label: T(`month_${m.value}`) }));
  const cmpStructures = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
const cmpCompanies  = companies.length > 0 && typeof companies[0] === "object"
    ? companies.map(c => ({ value: c.companyShortName ?? c.CompanyShortName ?? String(c), label: c.CompanyLegalName ?? c.companyLegalName ?? c.companyShortName ?? c.CompanyShortName ?? String(c) })).filter(o => o.value)
    : [...new Set(companies.map(c => String(c)).filter(Boolean))].map(v => ({ value: v, label: v }));
const ACOL = 480, TCOL = 150;
  const CMP_COL = 140, DELTA_COL = 110, PCT_COL = 90;
  const MIN_DCOL = 140;

  const dimColWidths = useMemo(() => {
    return orderedDimCols.map(dim => {
      const nameLen = (dim.name ?? "").length;
      return Math.max(MIN_DCOL, nameLen * 9 + 40);
    });
  }, [orderedDimCols]);

  const totalWidth = cmpVisible
    ? ACOL + dimColWidths.reduce((s, w) => s + w + CMP_COL + DELTA_COL + PCT_COL, 0)
    : ACOL + dimColWidths.reduce((s, w) => s + w, 0) + TCOL;

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

// If the selected line was filtered out (no data anymore), reset to "all".
  // Done during render — React's recommended pattern for adjusting state on
  // derived-value changes (no extra render, no lint exception needed).
  if (line !== "all" && !lineOptions.some(o => o.value === line)) {
    setLine("all");
  }

  // ─────────────────────────────────────────────────────────
  // Filter & order accounts by accountType + Supabase mapping
  // (Hooks must run unconditionally — placed BEFORE early return)
  // ─────────────────────────────────────────────────────────
const activeMapping = statementType === "pl" ? plMapping : bsMapping;

const displayedTree = useMemo(() => {
    if (!data.length) return [];
    const targetAccountType = statementType === "pl" ? ["P/L", "DIS"] : ["B/S"];

    // Build the FULL chart-of-accounts hierarchy from groupAccounts (filtered
    // to this statement type). Previously this only included accounts that had
    // journal data this period + their ancestors, which dropped the leaf
    // postings the user expects to see when drilling down.
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

    // Fallback for data-only codes (codes that exist in the journal but aren't
    // in groupAccounts — orphan postings). Add them so they're not silently lost.
    data.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (!code || groupMap.has(code)) return;
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!targetAccountType.includes(acType)) return;
      groupMap.set(code, {
        AccountCode: code,
        AccountName: r.AccountName ?? r.accountName ?? "",
        SumAccountCode: r.SumAccountCode ?? r.sumAccountCode ?? "",
        AccountType: acType,
      });
    });

    return buildTree([...groupMap.values()]);
 }, [data, groupAccounts, statementType]);

const treeIndex = useMemo(() => {
  const idx = new Map();
  const walk = (nodes) => nodes.forEach(n => { idx.set(String(n.AccountCode), n); walk(n.children || []); });
  walk(displayedTree);
  (groupAccounts || []).forEach(a => {
    const code = String(a.AccountCode ?? a.accountCode ?? "");
    if (code && !idx.has(code)) {
      idx.set(code, {
        AccountCode: code,
        AccountName: a.AccountName ?? a.accountName ?? "",
        SumAccountCode: a.SumAccountCode ?? a.sumAccountCode ?? "",
        AccountType: a.AccountType ?? a.accountType ?? "",
        children: [],
      });
    }
  });
  return idx;
}, [displayedTree, groupAccounts]);
const displayedTreeIndex = useMemo(() => {
  const idx = new Map();
  const walk = (nodes) => nodes.forEach(n => { idx.set(String(n.AccountCode), n); walk(n.children || []); });
  walk(displayedTree);
  return idx;
}, [displayedTree]);

const isCustomMapping = hasCustomMapping;
  const orderedRows = useMemo(() => {
    if (activeMapping?.rows) {
if (isCustomMapping) {
        const gaMap = new Map();
        (groupAccounts || []).forEach(a => {
          const code = String(a.AccountCode ?? a.accountCode ?? "");
          if (code) gaMap.set(code, a);
        });
        return [...activeMapping.rows.entries()]
          .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
          .map(([code]) => {
            // Prefer node from displayedTree (has children with dim data)
            if (displayedTreeIndex.has(code)) return displayedTreeIndex.get(code);
            if (treeIndex.has(code)) return treeIndex.get(code);
            const ga = gaMap.get(code);
            if (ga) return {
              AccountCode: code,
              AccountName: ga.AccountName ?? ga.accountName ?? code,
              SumAccountCode: ga.SumAccountCode ?? ga.sumAccountCode ?? "",
              children: [],
            };
            return null;
          })
          .filter(Boolean);
      }
      // Default standard mapping — respect Summary/Detailed toggle
      const filterFn = summaryMode ? (info => info.showInSummary) : (info => info.isSum);
      return [...activeMapping.rows.entries()]
        .filter(([, info]) => filterFn(info))
        .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
        .map(([code]) => treeIndex.get(code))
        .filter(Boolean);
    }
return displayedTree;
  }, [activeMapping, isCustomMapping, summaryMode, treeIndex, displayedTree, displayedTreeIndex, groupAccounts]);

const dividerMap = useMemo(() => {
    if (!activeMapping?.rows || !activeMapping?.sections) return {};
    const palette = [colors.primary, colors.secondary, colors.tertiary];
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

  // Row keys that must be force-expanded because a descendant matches the search.
  const searchExpansionSet = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return null;
    const result = new Set();
    const matchesText = (...vals) => vals.some(v => String(v ?? "").toLowerCase().includes(q));

    const literal = statementType === "pl" ? plLiteral : bsLiteral;
    if (literal) {
      literal.forEach((section, secIdx) => {
        const walk = (node, parentPath) => {
          const rowKey = `litrow-${secIdx}-${parentPath}-${node.id}`;
          let descMatch = false;
          (node.children || []).forEach(child => {
            if (walk(child, `${parentPath}-${node.id}`)) descMatch = true;
          });
          const self = matchesText(node.code, node.name);
          if (descMatch || self) result.add(rowKey);
          return descMatch || self;
        };
        section.nodes.forEach(n => walk(n, "root"));
      });
    }

    const walkFlat = (node) => {
      let any = false;
      (node.children || []).forEach(child => { if (walkFlat(child)) any = true; });
      const self = matchesText(node.AccountCode, node.AccountName);
      if (any || self) result.add(String(node.AccountCode));
      return any || self;
    };
    (orderedRows || []).forEach(walkFlat);

    return result;
  }, [debouncedQuery, plLiteral, bsLiteral, statementType, orderedRows]);

const { parentOf } = useMemo(() => {
  const childrenByParent = new Map();
  const parentOf = new Map();
  // Build from both groupAccounts AND rawData rows so posting codes are included
  const sources = [
    ...(groupAccounts || []).map(a => ({
      ac: String(a.AccountCode ?? a.accountCode ?? ""),
      sum: String(a.SumAccountCode ?? a.sumAccountCode ?? ""),
    })),
    ...data.map(r => ({
      ac: String(r.AccountCode ?? r.accountCode ?? ""),
      sum: String(r.SumAccountCode ?? r.sumAccountCode ?? ""),
    })),
  ];
  sources.forEach(({ ac, sum }) => {
    if (ac && sum && ac !== sum) {
      if (!childrenByParent.has(sum)) childrenByParent.set(sum, []);
      if (!childrenByParent.get(sum).includes(ac)) childrenByParent.get(sum).push(ac);
      parentOf.set(ac, sum);
    }
  });
  return { childrenByParent, parentOf };
}, [groupAccounts, data]);

// Precompute rolled-up pivots: walk the source pivot ONCE; for each posting,
// add its value to itself + every ancestor via parentOf. After this, looking up
// a sum-code's total is a single Map.get instead of a full pivot scan. This is
// the difference between O(N) per lookup and O(1) — the BS literal path was
// calling the old version thousands of times per render.
const rollUpPivot = useCallback((p) => {
  const r = new Map();
  if (!p || p.size === 0) return r;
  p.forEach((dimMap, ac) => {
    dimMap.forEach((val, dk) => {
      // self
      let m = r.get(ac);
      if (!m) { m = new Map(); r.set(ac, m); }
      m.set(dk, (m.get(dk) ?? 0) + val);
      // ancestors
      let cur = parentOf.get(ac);
      let hops = 0;
      while (cur && hops < 25) {
        let am = r.get(cur);
        if (!am) { am = new Map(); r.set(cur, am); }
        am.set(dk, (am.get(dk) ?? 0) + val);
        cur = parentOf.get(cur);
        hops++;
      }
    });
  });
  return r;
}, [parentOf]);

const rolledPivot      = useMemo(() => rollUpPivot(pivot),         [pivot,         rollUpPivot]);
const rolledPrevPivot  = useMemo(() => rollUpPivot(prevPivotMain), [prevPivotMain, rollUpPivot]);
const rolledPivot2     = useMemo(() => rollUpPivot(pivot2),        [pivot2,        rollUpPivot]);
const rolledPrevPivot2 = useMemo(() => rollUpPivot(prevPivot2),    [prevPivot2,    rollUpPivot]);

const getValWithDescendants = useCallback((code, dk) => {
  const ytd = (rolledPivot.get(code)?.get(dk) ?? 0) * sign;
  if (viewMode === "ytd") return ytd;
  const prevYtd = (rolledPrevPivot.get(code)?.get(dk) ?? 0) * sign;
  return ytd - prevYtd;
}, [rolledPivot, rolledPrevPivot, viewMode, sign]);

const getCmpValWithDescendants = useCallback((code, dk) => {
  const ytd = (rolledPivot2.get(code)?.get(dk) ?? 0) * sign;
  if (viewMode === "ytd") return ytd;
  const prevYtd = (rolledPrevPivot2.get(code)?.get(dk) ?? 0) * sign;
  return ytd - prevYtd;
}, [rolledPivot2, rolledPrevPivot2, viewMode, sign]);

useEffect(() => {
  if (!activeMapping) return;
  console.log("[debug] parentOf size:", parentOf.size);
  console.log("[debug] parentOf for 60100000:", parentOf.get("60100000"));
  console.log("[debug] pivot size:", pivot.size);
  console.log("[debug] pivot keys with dims:", [...pivot.entries()].filter(([, m]) => m.size > 1).slice(0,5).map(([k,m]) => [k, [...m.keys()]]));
}, [activeMapping, parentOf, pivot]);

const handleExportXlsx = useCallback(async (opts = {}) => {
    const includePL = opts.statements?.pl ?? (statementType === "pl");
    const includeBS = opts.statements?.bs ?? (statementType === "bs");
if (!includePL && !includeBS) { alert(T("export_select_statement_alert")); return; }
    const drilldown = opts.drilldown !== false;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Konsolidator";

const periodLabel = (y, m) => {
      const mm = parseInt(m);
      return `${T(`month_${mm}`)} ${y}`;
    };
    const toArgbHex = (hex) => "FF" + String(hex ?? "#1a2f8a").replace("#", "").toUpperCase().padStart(6, "0");

    const buildSimplePivot = (rows, stType) => {
      const p = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        const targetType = stType === "bs" ? "B/S" : "P/L";
        if (!ac || (acType && acType !== targetType)) return;
        const pairs = parseDimensions(r.Dimensions);
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        if (pairs.length === 0) {
          if (!p.has(ac)) p.set(ac, new Map());
          p.get(ac).set("__none__", (p.get(ac).get("__none__") ?? 0) + amt);
          return;
        }
        for (const [grp, code] of pairs) {
          if (selGroups.size > 0 && !selGroups.has(grp)) continue;
          if (selDims.size > 0 && !selDims.has(code)) continue;
          if (!p.has(ac)) p.set(ac, new Map());
          p.get(ac).set(code, (p.get(ac).get(code) ?? 0) + amt);
        }
      });
      return p;
    };

const writeSheetForStatement = (stType, viewLevel = null) => {
      const isActive = stType === statementType;
      const useLiteral = viewLevel === null;
      const sign = stType === "pl" ? -1 : 1;
      const literal = stType === "pl" ? plLiteral : bsLiteral;
      const sheetView = isActive ? viewMode : "ytd";
      const sheetCompare = cmpVisible && (opts.includeCompare !== false);
      const showTotals  = !sheetCompare && (opts.includeTotals !== false);
      const showBreakers = opts.includeBreakers !== false;

      const pivotMain = isActive ? pivot : buildSimplePivot(data, stType);
      const prevMain  = isActive ? prevPivotMain : new Map();
      const pivotCmp  = cmpVisible ? (isActive ? pivot2 : buildSimplePivot(cmp2Data, stType)) : new Map();
      const prevCmp   = isActive ? prevPivot2 : new Map();

      // Descendant-aware rollup (literal mode) — matches on-screen getValWithDescendants
      const sumPivotFor = (p, code, dk) => {
        if (!p || p.size === 0) return 0;
        let total = 0;
        p.forEach((dimMap, ac) => {
          if (ac === code) { total += (dimMap.get(dk) ?? 0) * sign; return; }
          let cur = parentOf.get(ac);
          let hops = 0;
          while (cur && hops < 25) {
            if (cur === code) { total += (dimMap.get(dk) ?? 0) * sign; break; }
            cur = parentOf.get(cur); hops++;
          }
        });
        return total;
      };
      const valFor = (code, dk) => {
        const ytd = sumPivotFor(pivotMain, code, dk);
        if (sheetView === "ytd") return ytd;
        return ytd - sumPivotFor(prevMain, code, dk);
      };
      const cmpValFor = (code, dk) => {
        const ytd = sumPivotFor(pivotCmp, code, dk);
        if (sheetView === "ytd") return ytd;
        return ytd - sumPivotFor(prevCmp, code, dk);
      };

      // Flat lookup (tree mode) — matches on-screen DimensionRow.sumNode
      const flatVal = (code, dk) => {
        const ytd = (pivotMain.get(code)?.get(dk) ?? 0) * sign;
        if (sheetView === "ytd") return ytd;
        return ytd - (prevMain.get(code)?.get(dk) ?? 0) * sign;
      };
      const flatCmpVal = (code, dk) => {
        const ytd = (pivotCmp.get(code)?.get(dk) ?? 0) * sign;
        if (sheetView === "ytd") return ytd;
        return ytd - (prevCmp.get(code)?.get(dk) ?? 0) * sign;
      };
const sumTreeForDim = (n, dk, depth = 0) => {
        if (depth > 25) return 0;
        if (n.children && n.children.length > 0) {
          const childSum = n.children.reduce((s, c) => s + sumTreeForDim(c, dk, depth + 1), 0);
          if (childSum !== 0) return childSum;
        }
        return flatVal(n.code, dk);
      };
      const sumTreeCmpForDim = (n, dk, depth = 0) => {
        if (depth > 25) return 0;
        if (n.children && n.children.length > 0) {
          const childSum = n.children.reduce((s, c) => s + sumTreeCmpForDim(c, dk, depth + 1), 0);
          if (childSum !== 0) return childSum;
        }
        return flatCmpVal(n.code, dk);
      };

      const visibleDims = orderedDimCols;
      const subColsPerDim = sheetCompare ? 4 : 1;
      const totalCols = 1 + visibleDims.length * subColsPerDim + (showTotals ? 1 : 0);

const subLines = [];
      if (masterYear && masterMonth) {
        const seg = [`📅 ${periodLabel(masterYear, masterMonth)}`];
        if (masterSource)    seg.push(`${T("file_field_source")}: ${masterSource}`);
        if (masterStructure) seg.push(`${T("file_field_structure")}: ${masterStructure}`);
        if (masterCompany)   seg.push(`${T("file_field_company")}: ${masterCompany}`);
        subLines.push(seg.join("    ·    "));
      }
      const viewLevelLabel = viewLevel === "summary" ? T("file_level_summary") : viewLevel === "detailed" ? T("file_level_detailed") : T("file_level_mapped");
      subLines.push(`${T("file_field_statement")}: ${stType.toUpperCase()}    ·    ${T("file_field_level")}: ${viewLevelLabel}    ·    ${T("file_field_view")}: ${sheetView === "ytd" ? T("mode_ytd") : T("mode_monthly")}${sheetCompare ? `    ·    ${T("file_compare_on")}` : ""}${!isActive ? `    ·    ${T("file_compare_off_note")}` : ""}`);
      subLines.push(`${T("file_field_dim_groups")}: ${selGroups.size > 0 ? [...selGroups].join(", ") : T("all")}    ·    ${T("file_field_dims")}: ${selDims.size > 0 ? [...selDims].join(", ") : T("all")}`);
      if (sheetCompare && cmp2Year && cmp2Month) {
        const seg = [`🆚 ${T("file_vs_prefix")} ${periodLabel(cmp2Year, cmp2Month)}`];
        if (cmp2Source)    seg.push(`${T("file_field_source")}: ${cmp2Source}`);
        if (cmp2Structure) seg.push(`${T("file_field_structure")}: ${cmp2Structure}`);
        if (cmp2Company)   seg.push(`${T("file_field_company")}: ${cmp2Company}`);
        subLines.push(seg.join("    ·    "));
      }

      const sheetNameSuffix = viewLevel === "summary" ? " Summary" : viewLevel === "detailed" ? " Detailed" : "";
      const ws = wb.addWorksheet(`Dim ${stType.toUpperCase()}${sheetNameSuffix}`, {
        views: [{ state: "frozen", xSplit: 1, ySplit: 1 + subLines.length + 1 + (sheetCompare ? 2 : 1) }],
        properties: { outlineLevelRow: 1, summaryBelow: false },
      });

ws.mergeCells(1, 1, 1, totalCols);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = stType === "pl" ? T("file_dimensions_pl") : T("file_dimensions_bs");
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
      titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(1).height = 28;

      subLines.forEach((line, i) => {
        const r = 2 + i;
        ws.mergeCells(r, 1, r, totalCols);
        const c = ws.getCell(r, 1);
        c.value = line;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        c.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
        c.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
        ws.getRow(r).height = 18;
      });

      let curRow = 2 + subLines.length;
      ws.getRow(curRow).height = 6;
      curRow++;

      if (sheetCompare) {
        const r1 = curRow, r2 = curRow + 1;
        const sup = ws.getRow(r1); sup.height = 22;
        const sub = ws.getRow(r2); sub.height = 18;
const acc = sup.getCell(1);
        acc.value = T("file_col_account");
        acc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        acc.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        acc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.mergeCells(r1, 1, r2, 1);
        visibleDims.forEach((d, i) => {
          const startCol = 2 + i * 4;
          const sCell = sup.getCell(startCol);
          sCell.value = d.name ?? d.code ?? "—";
          sCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
          sCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
          sCell.alignment = { vertical: "middle", horizontal: "center" };
          ws.mergeCells(r1, startCol, r1, startCol + 3);
          [T("file_col_a"), T("file_col_sigma_cmp"), T("file_col_delta_amt"), T("file_col_delta_pct")].forEach((lbl, j) => {
            const cc = sub.getCell(startCol + j);
            cc.value = lbl;
            cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: j === 1 ? "FFCF305D" : (j >= 2 ? "FF13225C" : C.primary) } };
            cc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
            cc.alignment = { vertical: "middle", horizontal: "center" };
          });
        });
        curRow = r2 + 1;
      } else {
        const hRow = ws.getRow(curRow); hRow.height = 24;
const headers = [T("file_col_account"), ...visibleDims.map(d => d.name ?? d.code ?? "—")];
        if (showTotals) headers.push(T("file_col_total"));
        headers.forEach((h, i) => {
          const c = hRow.getCell(i + 1);
          c.value = h;
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
          c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
        });
        curRow++;
      }

      const writeNum = (rowN, colN, val, fillArgb, opts2 = {}) => {
        const cell = ws.getCell(rowN, colN);
        if (val == null || !Number.isFinite(val) || val === 0) {
          cell.value = "—";
          cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: !!opts2.bold };
        } else {
          cell.value = val;
          cell.numFmt = opts2.percent ? '0.0"%"' : '#,##0.00;[Red]-#,##0.00';
          cell.font = {
            name: "Calibri", size: 10, bold: !!opts2.bold,
            color: { argb: opts2.colorOverride ?? (val < 0 ? C.red : "FF1A2F8A") },
          };
        }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      };

const leafVal = (n, dimKey) => {
        if (n.dims && n.dims.length > 0) {
          const match = n.dims.some(d => {
            const i = d.indexOf(":");
            const v = i === -1 ? d : d.slice(i + 1);
            return String(v) === String(dimKey);
          });
          if (!match) return 0;
        }
        return valFor(n.code, dimKey);
      };
      const sumLitForDim = (n, dimKey, depth = 0) => {
        if (depth > 50) return 0;
        if (n.isSum && n.children && n.children.length > 0) {
          return n.children.reduce((s, c) => s + sumLitForDim(c, dimKey, depth + 1), 0);
        }
        return leafVal(n, dimKey);
      };
      const leafCmpVal = (n, dimKey) => {
        if (n.dims && n.dims.length > 0) {
          const match = n.dims.some(d => {
            const i = d.indexOf(":");
            const v = i === -1 ? d : d.slice(i + 1);
            return String(v) === String(dimKey);
          });
          if (!match) return 0;
        }
        return cmpValFor(n.code, dimKey);
      };
      const sumLitCmpForDim = (n, dimKey, depth = 0) => {
        if (depth > 50) return 0;
        if (n.isSum && n.children && n.children.length > 0) {
          return n.children.reduce((s, c) => s + sumLitCmpForDim(c, dimKey, depth + 1), 0);
        }
        return leafCmpVal(n, dimKey);
      };

      let dataIdx = 0;
      let maxDepth = 0;
const renderRow = (node, depth, mode = "literal", excludeCodes = null) => {
        if (depth > 50 || !node) return;  // cycle / runaway guard
        const mainSum = mode === "tree" ? sumTreeForDim : sumLitForDim;
        const cmpSum  = mode === "tree" ? sumTreeCmpForDim : sumLitCmpForDim;
        maxDepth = Math.max(maxDepth, depth);
        const band = dataIdx % 2 === 0 ? C.band1 : C.band2;
        dataIdx++;
        const labelCell = ws.getCell(curRow, 1);
        const codeStr = String(node.code ?? "").trim();
        const nameStr = String(node.name ?? node.code ?? "").trim() || "—";
        const labelRuns = [];
        if (codeStr) labelRuns.push({ text: `${codeStr}  `, font: { name: "Calibri", size: 9, color: { argb: "FF6B7280" } } });
        labelRuns.push({ text: nameStr, font: { name: "Calibri", size: 11, bold: !!node.isSum, color: { argb: "FF1A2F8A" } } });
        labelCell.value = labelRuns.length === 1 ? nameStr : { richText: labelRuns };
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

        let rowTotal = 0;
        visibleDims.forEach((dim, i) => {
          const dk = dim.code ?? "__none__";
          const a = mainSum(node, dk);
          rowTotal += a;
          if (sheetCompare) {
            const startCol = 2 + i * 4;
            const c = cmpSum(node, dk);
            const delta    = (Number.isFinite(a) && Number.isFinite(c)) ? a - c : null;
            const deltaPct = (Number.isFinite(a) && Number.isFinite(c) && Math.abs(c) > 1e-9) ? ((a - c) / Math.abs(c)) * 100 : null;
            writeNum(curRow, startCol,     a, band,        { bold: node.isSum });
            writeNum(curRow, startCol + 1, c, "FFFAFBFF",  { bold: node.isSum });
            writeNum(curRow, startCol + 2, delta,    "FFF5F7FF", { bold: node.isSum, colorOverride: (delta == null || delta === 0) ? null : (delta < 0 ? C.red : "FF059669") });
            writeNum(curRow, startCol + 3, deltaPct, "FFF0F3FF", { bold: node.isSum, percent: true, colorOverride: deltaPct == null ? null : (deltaPct < 0 ? C.red : "FF059669") });
          } else {
            writeNum(curRow, 2 + i, a, band, { bold: node.isSum });
          }
        });
        if (showTotals) {
          writeNum(curRow, 2 + visibleDims.length, rowTotal, C.highlight, { bold: true });
        }
        if (drilldown) {
          const row = ws.getRow(curRow);
          const cappedDepth = Math.min(7, depth);
          row.outlineLevel = cappedDepth;
          if (cappedDepth > 0) row.hidden = true;
        }
        curRow++;

if (node.children && node.children.length > 0) {
          node.children.forEach(c => {
            // Skip children that will render at the top level as their own row
            // (mirrors on-screen DimensionRow's excludeCodes behavior). Values
            // still roll up correctly because sumTreeForDim walks the full tree
            // — this only affects what's emitted as a separate row.
            if (excludeCodes && excludeCodes.has(String(c.code ?? c.AccountCode ?? ""))) return;
            renderRow(c, depth + 1, mode, excludeCodes);
          });
        }
      };

const treeAsLit = (n, depth, visited = new WeakSet()) => {
        if (!n || depth > 50 || visited.has(n)) {
          return {
            id: String(n?.AccountCode ?? ""), code: String(n?.AccountCode ?? ""),
            name: n?.AccountName ?? n?.accountName ?? "",
            dims: null, isSum: false, depth, children: [],
          };
        }
        visited.add(n);
        return {
          id: String(n.AccountCode), code: String(n.AccountCode),
          name: n.AccountName ?? n.accountName ?? "",
          dims: null, isSum: (n.children?.length ?? 0) > 0, depth,
          children: (n.children || []).map(c => treeAsLit(c, depth + 1, visited)),
        };
      };

      const renderSectionBar = (label, colorArgb) => {
        ws.mergeCells(curRow, 1, curRow, totalCols);
        const cell = ws.getCell(curRow, 1);
        cell.value = String(label).toUpperCase();
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorArgb } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(curRow).height = 22;
        curRow++;
        dataIdx = 0;
      };

if (useLiteral && literal && literal.length > 0) {
        // Custom mapping literal mode — matches on-screen literal renderer
        literal.forEach(section => {
          if (section.label && showBreakers) renderSectionBar(section.label, toArgbHex(section.color));
          section.nodes.forEach(n => renderRow(n, 0, "literal"));
        });
      } else {
        // No-literal mode (Summary or Detailed view): rebuild a tree from groupAccounts
        // + the statement's mapping. Same logic as the on-screen Summary/Detailed toggle.
        const mappingForSt = stType === "pl" ? plMapping : bsMapping;
        const gaMap = new Map();
        (groupAccounts || []).forEach(a => {
          const code = String(a.AccountCode ?? a.accountCode ?? "");
          if (!code) return;
          gaMap.set(code, {
            AccountCode: code,
            AccountName: a.AccountName ?? a.accountName ?? "",
            SumAccountCode: String(a.SumAccountCode ?? a.sumAccountCode ?? ""),
            AccountType: a.AccountType ?? a.accountType ?? "",
            IsSumAccount: !!(a.IsSumAccount ?? a.isSumAccount),
          });
        });
        const targetType = stType === "bs" ? "B/S" : "P/L";
        const stCodes = new Set();
        gaMap.forEach((ga, code) => {
          if (!ga.AccountType || ga.AccountType === targetType) stCodes.add(code);
        });
        const childrenIdx = new Map();
        stCodes.forEach(code => {
          const ga = gaMap.get(code);
          const parent = ga.SumAccountCode;
          if (parent && stCodes.has(parent) && parent !== code) {
            if (!childrenIdx.has(parent)) childrenIdx.set(parent, []);
            childrenIdx.get(parent).push(code);
          }
        });
const buildTreeNode = (code, depth, visited = new Set()) => {
          // Cycle / runaway-depth guard: chart-of-accounts data sometimes carries
          // circular SumAccountCode chains (A → B → A) that would otherwise
          // recurse forever.
          if (visited.has(code) || depth > 25) {
            return {
              AccountCode: code,
              AccountName: gaMap.get(code)?.AccountName ?? "",
              children: [],
              IsSumAccount: false,
            };
          }
          const nextVisited = new Set(visited);
          nextVisited.add(code);
          const ga = gaMap.get(code);
          const kids = (childrenIdx.get(code) || []).map(c => buildTreeNode(c, depth + 1, nextVisited));
          return {
            AccountCode: code,
            AccountName: ga?.AccountName ?? "",
            children: kids,
            IsSumAccount: !!ga?.IsSumAccount,
          };
        };

if (mappingForSt?.rows && mappingForSt?.sections) {
          const filterFn = viewLevel === "summary"
            ? (info => info.showInSummary)
            : (info => info.isSum);
          const orderedEntries = [...mappingForSt.rows.entries()]
            .filter(([, info]) => filterFn(info))
            .sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
          // Set of codes that render as their own top-level row. Passed to
          // renderRow so descendants matching these are skipped, mirroring
          // the on-screen `excludeCodes` filter in DimensionRow.
          const topLevelCodes = new Set(orderedEntries.map(([code]) => String(code)));
          const palette = ["FF1A2F8A", "FFCF305D", "FF10B981", "FFD97706"];
          const seenSections = new Set();
          let sectionIdx = 0;
          orderedEntries.forEach(([code, info]) => {
            if (!stCodes.has(code)) return;
            if (!seenSections.has(info.section) && showBreakers) {
              const sec = mappingForSt.sections.get(info.section);
              if (sec?.label) {
                renderSectionBar(sec.label, palette[sectionIdx % palette.length]);
                sectionIdx++;
              }
              seenSections.add(info.section);
            }
            renderRow(treeAsLit(buildTreeNode(code, 0), 0), 0, "tree", topLevelCodes);
          });
        } else {
          // Truly nothing to lean on — just top-level codes
          const topCodes = [...stCodes].filter(code => {
            const p = gaMap.get(code).SumAccountCode;
            return !p || !stCodes.has(p);
          }).sort();
          topCodes.forEach(code => renderRow(treeAsLit(buildTreeNode(code, 0), 0), 0, "tree"));
        }
      }

      if (drilldown) {
        ws.properties.outlineLevelRow = Math.min(7, Math.max(1, maxDepth));
        ws.properties.summaryBelow = false;
      }

      ws.getColumn(1).width = 44;
      if (sheetCompare) {
        for (let i = 0; i < visibleDims.length; i++) {
          ws.getColumn(2 + i * 4).width     = 15;
          ws.getColumn(2 + i * 4 + 1).width = 14;
          ws.getColumn(2 + i * 4 + 2).width = 12;
          ws.getColumn(2 + i * 4 + 3).width = 10;
        }
      } else {
        for (let i = 0; i < visibleDims.length; i++) ws.getColumn(2 + i).width = 18;
        if (showTotals) ws.getColumn(2 + visibleDims.length).width = 18;
      }
    };

console.log("[export] opts.statements:", opts.statements, "→ includePL=", includePL, "includeBS=", includeBS);
    console.log("[export] statementType (active tab):", statementType);
    console.log("[export] plLiteral:", plLiteral?.length, "sections, bsLiteral:", bsLiteral?.length, "sections");
    console.log("[export] plMapping rows:", plMapping?.rows?.size, "bsMapping rows:", bsMapping?.rows?.size);
    console.log("[export] groupAccounts:", groupAccounts?.length);

const safeWriteSheet = (st, viewLevel = null) => {
      const label = viewLevel ? `${st} ${viewLevel}` : st;
      try {
        console.log(`[export] ▶ writing sheet "${label}"…`);
        writeSheetForStatement(st, viewLevel);
        console.log(`[export] ✓ sheet "${label}" written. Workbook now has ${wb.worksheets.length} sheets:`, wb.worksheets.map(w => w.name));
} catch (e) {
        console.error(`[export] ✗ FAILED writing sheet "${label}":`, e);
        alert(`${T("export_sheet_failed_alert")} (${label.toUpperCase()}):\n\n${e?.message ?? e}`);
      }
    };

    const dispatchStatement = (st) => {
      const lit = st === "pl" ? plLiteral : bsLiteral;
      if (lit && lit.length > 0) {
        // Custom mapping active → single sheet using the literal structure
        safeWriteSheet(st, null);
      } else {
        // No custom mapping → mirror on-screen Summary + Detailed views
        safeWriteSheet(st, "summary");
        safeWriteSheet(st, "detailed");
      }
    };

    if (includePL) dispatchStatement("pl");
    if (includeBS) dispatchStatement("bs");

    console.log(`[export] final workbook has ${wb.worksheets.length} sheets:`, wb.worksheets.map(w => w.name));
if (wb.worksheets.length === 0) {
      alert(T("export_no_sheets_alert"));
      return;
    }

console.log("[export] all sheets built. Calling writeBuffer…", wb.worksheets.map(s => `${s.name}: ${s.rowCount} rows, ${s.columnCount} cols`));
    let buffer;
    try {
      buffer = await wb.xlsx.writeBuffer();
      console.log("[export] writeBuffer OK, bytes:", buffer.byteLength);
    } catch (e) {
      console.error("[export] writeBuffer threw:", e);
      throw new Error(`writeBuffer failed: ${e?.message ?? e}`);
    }

    console.log("[export] running repairDimXlsx…");
    let repaired;
    try {
      repaired = await repairDimXlsx(buffer);
      console.log("[export] repairDimXlsx OK");
    } catch (e) {
      console.error("[export] repairDimXlsx threw:", e);
      console.warn("[export] saving UNREPAIRED buffer for inspection");
      repaired = buffer;
    }

saveAs(new Blob([repaired], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Konsolidator_Dimensions_${masterYear}_${String(masterMonth).padStart(2, "0")}.xlsx`);
  }, [T, data, cmp2Data, statementType, cmpVisible, orderedDimCols, plLiteral, bsLiteral, pivot, prevPivotMain, pivot2, prevPivot2, parentOf, viewMode, masterYear, masterMonth, masterSource, masterStructure, masterCompany, selGroups, selDims, cmp2Source, cmp2Structure, cmp2Month, cmp2Year, cmp2Company, plMapping, bsMapping, groupAccounts]);

const handleExportPdf = useCallback((opts = {}) => {
    const includePL = opts.statements?.pl ?? (statementType === "pl");
    const includeBS = opts.statements?.bs ?? (statementType === "bs");
if (!includePL && !includeBS) { alert(T("export_select_statement_alert")); return; }
    const includeCompareOpt = (opts.includeCompare !== false) && cmpVisible;

    // Palette
    const NAVY     = [26, 47, 138];
    const NAVYMID  = [40, 64, 168];
    const NAVYDK   = [10, 20, 70];
    const RED      = [207, 48, 93];
    const REDDK    = [160, 30, 65];
    const GRN      = [16, 185, 129];
    const GRNDK    = [4, 120, 87];
    const LIGHT    = [238, 241, 251];
    const WHITE    = [255, 255, 255];
    const OFFWHITE = [250, 251, 255];
    const GRAY     = [140, 150, 175];
    const GRAYLT   = [210, 215, 230];
    const TEXTDK   = [20, 35, 80];

    const allDims = orderedDimCols;
    const TARGET_DIMS_PER_PAGE = 4;

    // When comparing, split dims into balanced chunks of ~4 dims/page.
    // Each page renders A | B | Diff | Diff% side-by-side for its dims.
    const dimChunks = includeCompareOpt && allDims.length > TARGET_DIMS_PER_PAGE
      ? (() => {
          const nPages = Math.ceil(allDims.length / TARGET_DIMS_PER_PAGE);
          const perPage = Math.ceil(allDims.length / nPages);
          const out = [];
          for (let i = 0; i < allDims.length; i += perPage) {
            out.push({
              dims: allDims.slice(i, i + perPage),
              startIdx: i,
              endIdx: Math.min(i + perPage, allDims.length) - 1,
            });
          }
          return out;
        })()
      : [{ dims: allDims, startIdx: 0, endIdx: allDims.length - 1 }];

    // Widest layout: compare → 4 sub-cols × chunk size + Account. Single → dims + Account + Total.
    const widestPerPage = includeCompareOpt
      ? Math.max(...dimChunks.map(c => c.dims.length * 4 + 1))
      : allDims.length + 2;
    const useA3 = widestPerPage > 11;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: useA3 ? "a3" : "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
// Page 1 is reserved for the index (drawn last). Content starts at page 2,
    // so pageNum is pre-set to 1 — first drawPageHeader call adds page 2 and
    // increments pageNum to match the physical jsPDF page.
    let pageNum = 1;
    const pageManifest = []; // { displayedPage, title }
    const monthLabel = masterMonth ? T(`month_${parseInt(masterMonth)}`) : masterMonth;

    const buildSimplePivot = (rows, stType) => {
      const p = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        const targetType = stType === "bs" ? "B/S" : "P/L";
        if (!ac || (acType && acType !== targetType)) return;
        const pairs = parseDimensions(r.Dimensions);
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        if (pairs.length === 0) {
          if (!p.has(ac)) p.set(ac, new Map());
          p.get(ac).set("__none__", (p.get(ac).get("__none__") ?? 0) + amt);
          return;
        }
        for (const [grp, code] of pairs) {
          if (selGroups.size > 0 && !selGroups.has(grp)) continue;
          if (selDims.size > 0 && !selDims.has(code)) continue;
          if (!p.has(ac)) p.set(ac, new Map());
          p.get(ac).set(code, (p.get(ac).get(code) ?? 0) + amt);
        }
      });
      return p;
    };

const drawPageHeader = (isFirst, stType, level, chunkInfo) => {
      // Always add a page — first content page lands at page 2 (page 1 is TOC).
      doc.addPage();
      pageNum++;
// Record this page in the manifest so the index can list it.
      const lvlTxt  = level === "summary" ? T("file_level_summary") : level === "detailed" ? T("file_level_detailed") : T("file_level_mapped");
      const stTxt   = stType === "pl" ? T("badge_pl_short") : T("page_bs_full");
      const partTxt = chunkInfo && chunkInfo.totalChunks > 1
        ? ` — ${T("badge_part")} ${chunkInfo.idx + 1}/${chunkInfo.totalChunks}`
        : "";
      pageManifest.push({
        displayedPage: pageNum,
        title: `${stTxt} · ${lvlTxt}${partTxt}`,
      });
      doc.setFillColor(...NAVY); doc.rect(0, 0, W, 38, "F");
      doc.setFillColor(...RED);  doc.rect(0, 0, 5, 38, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.setTextColor(...WHITE);
      doc.text(stType === "pl" ? T("file_dimensions_pl_upper") : T("file_dimensions_bs_upper"), 12, 14);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(180, 200, 255);
      const sub = [`${monthLabel} ${masterYear}`, masterSource, masterStructure, masterCompany].filter(Boolean).join("  ·  ");
      doc.text(sub, 12, 22);

      doc.setFontSize(7);
      doc.setTextColor(160, 180, 235);
const filterBits = [
        `${T("file_field_groups")}: ${selGroups.size > 0 ? [...selGroups].join(", ") : T("all")}`,
        `${T("file_field_dims")}: ${selDims.size > 0 ? [...selDims].join(", ") : T("all")}`,
      ];
      doc.text(filterBits.join("    ·    "), 12, 29);

if (includeCompareOpt && cmp2Year && cmp2Month) {
        const cmpMo = T(`month_${parseInt(cmp2Month)}`);
        const cmpSub = [`${T("file_b_prefix")}: ${cmpMo} ${cmp2Year}`, cmp2Source, cmp2Structure, cmp2Company].filter(Boolean).join("  ·  ");
        doc.setFillColor(...REDDK);
        doc.roundedRect(12, 32, Math.min(W - 24, 220), 5.5, 1, 1, "F");
        doc.setFontSize(7);
        doc.setTextColor(...WHITE);
        doc.text(cmpSub, 14, 35.7);
      }

      // Top-right badges (right-to-left)
      let curX = W - 8;
      const placeBadge = (label, fill, textColor) => {
        const w = Math.max(22, doc.getTextWidth(label) + 8);
        doc.setFillColor(...fill);
        doc.roundedRect(curX - w, 6, w, 9, 2, 2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...textColor);
        doc.text(label, curX - w / 2, 11.8, { align: "center" });
        curX -= (w + 3);
      };

const lvlLabel = level === "summary" ? T("badge_summary") : level === "detailed" ? T("badge_detailed") : T("badge_mapped");
      placeBadge(lvlLabel, RED, WHITE);
      placeBadge(stType === "pl" ? T("badge_pl_short") : T("badge_bs_short"), NAVYDK, [160, 185, 255]);
      if (includeCompareOpt) {
        if (chunkInfo && chunkInfo.totalChunks > 1) {
          placeBadge(`${T("badge_part")} ${chunkInfo.idx + 1}/${chunkInfo.totalChunks}`, REDDK, WHITE);
        } else {
          placeBadge(T("badge_compare"), REDDK, WHITE);
        }
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...GRAY);
      doc.text(`${T("file_generated")} ${new Date().toLocaleDateString()}`, W - 8, 22, { align: "right" });

      doc.setDrawColor(...NAVYMID);
      doc.setLineWidth(0.4);
      doc.line(0, 38, W, 38);

      return 42;
    };

    const drawFooter = (stType, level, chunkInfo) => {
      doc.setFillColor(...LIGHT);
      doc.rect(0, H - 10, W, 10, "F");
      doc.setDrawColor(...GRAYLT);
      doc.setLineWidth(0.3);
      doc.line(0, H - 10, W, H - 10);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...NAVY);
doc.text(stType === "pl" ? T("file_dimensions_pl_upper") : T("file_dimensions_bs_upper"), 10, H - 4.5);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      const lvl = level === "summary" ? T("file_level_summary") : level === "detailed" ? T("file_level_detailed") : T("file_level_mapped");
      const chunkPart = chunkInfo && chunkInfo.totalChunks > 1 ? ` · ${T("badge_part")} ${chunkInfo.idx + 1}/${chunkInfo.totalChunks}` : "";
      doc.text(`${lvl}  ·  ${monthLabel} ${masterYear}  ·  ${masterSource}${chunkPart}`, 56, H - 4.5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...NAVY);
      doc.text(`${pageNum}`, W - 10, H - 4.5, { align: "right" });
    };

    const writePageForStatement = (stType, viewLevel, dimSlice, chunkInfo, isFirst) => {
      const isCompare = includeCompareOpt;
      const showTotals = (opts.includeTotals !== false) && !isCompare;
      const showBreakers = opts.includeBreakers !== false;

      const subCols = isCompare ? 4 : 1;
      const valueColCount = dimSlice.length * subCols + (showTotals ? 1 : 0);
      const totalColCount = 1 + valueColCount;

      const bodyFont = totalColCount <= 8  ? 8
                     : totalColCount <= 12 ? 7.5
                     : totalColCount <= 18 ? 7
                     : 6.5;
      const headFont = Math.max(6, bodyFont - 0.5);

      const isActive   = stType === statementType;
      const literal    = stType === "pl" ? plLiteral : bsLiteral;
      const useLiteral = viewLevel === null;
      const sign       = stType === "pl" ? -1 : 1;

      const pivotMain = isActive ? pivot : buildSimplePivot(data, stType);
      const prevMain  = isActive ? prevPivotMain : new Map();
      const pivotCmp  = isCompare ? (isActive ? pivot2 : buildSimplePivot(cmp2Data, stType)) : new Map();
      const prevCmp   = isActive ? prevPivot2 : new Map();
      const sheetView = isActive ? viewMode : "ytd";

      const sumPivotFor = (p, code, dk) => {
        if (!p || p.size === 0) return 0;
        let total = 0;
        p.forEach((dimMap, ac) => {
          if (ac === code) { total += (dimMap.get(dk) ?? 0) * sign; return; }
          let cur = parentOf.get(ac); let hops = 0;
          while (cur && hops < 25) {
            if (cur === code) { total += (dimMap.get(dk) ?? 0) * sign; break; }
            cur = parentOf.get(cur); hops++;
          }
        });
        return total;
      };
      const valFor = (code, dk) => {
        const ytd = sumPivotFor(pivotMain, code, dk);
        if (sheetView === "ytd") return ytd;
        return ytd - sumPivotFor(prevMain, code, dk);
      };
      const cmpValFor = (code, dk) => {
        const ytd = sumPivotFor(pivotCmp, code, dk);
        if (sheetView === "ytd") return ytd;
        return ytd - sumPivotFor(prevCmp, code, dk);
      };
      const flatVal = (code, dk) => {
        const ytd = (pivotMain.get(code)?.get(dk) ?? 0) * sign;
        if (sheetView === "ytd") return ytd;
        return ytd - (prevMain.get(code)?.get(dk) ?? 0) * sign;
      };
      const flatCmpVal = (code, dk) => {
        const ytd = (pivotCmp.get(code)?.get(dk) ?? 0) * sign;
        if (sheetView === "ytd") return ytd;
        return ytd - (prevCmp.get(code)?.get(dk) ?? 0) * sign;
      };
      const sumTreeForDim = (n, dk, depth = 0) => {
        if (depth > 25) return 0;
        if (n.children && n.children.length > 0) {
          const cs = n.children.reduce((s, c) => s + sumTreeForDim(c, dk, depth + 1), 0);
          if (cs !== 0) return cs;
        }
        return flatVal(n.code, dk);
      };
      const sumTreeCmpForDim = (n, dk, depth = 0) => {
        if (depth > 25) return 0;
        if (n.children && n.children.length > 0) {
          const cs = n.children.reduce((s, c) => s + sumTreeCmpForDim(c, dk, depth + 1), 0);
          if (cs !== 0) return cs;
        }
        return flatCmpVal(n.code, dk);
      };
      const leafVal = (n, dimKey) => {
        if (n.dims && n.dims.length > 0) {
          const match = n.dims.some(d => {
            const i = d.indexOf(":");
            const v = i === -1 ? d : d.slice(i + 1);
            return String(v) === String(dimKey);
          });
          if (!match) return 0;
        }
        return valFor(n.code, dimKey);
      };
      const leafCmpVal = (n, dimKey) => {
        if (n.dims && n.dims.length > 0) {
          const match = n.dims.some(d => {
            const i = d.indexOf(":");
            const v = i === -1 ? d : d.slice(i + 1);
            return String(v) === String(dimKey);
          });
          if (!match) return 0;
        }
        return cmpValFor(n.code, dimKey);
      };
      const sumLitForDim = (n, dimKey, depth = 0) => {
        if (depth > 50) return 0;
        if (n.isSum && n.children && n.children.length > 0) {
          return n.children.reduce((s, c) => s + sumLitForDim(c, dimKey, depth + 1), 0);
        }
        return leafVal(n, dimKey);
      };
      const sumLitCmpForDim = (n, dimKey, depth = 0) => {
        if (depth > 50) return 0;
        if (n.isSum && n.children && n.children.length > 0) {
          return n.children.reduce((s, c) => s + sumLitCmpForDim(c, dimKey, depth + 1), 0);
        }
        return leafCmpVal(n, dimKey);
      };

      const rows = [];
      const renderRow = (node, depth, mode, excludeCodes = null) => {
        if (depth > 50 || !node) return;
        const mainSum = mode === "tree" ? sumTreeForDim : sumLitForDim;
        const cmpSum  = mode === "tree" ? sumTreeCmpForDim : sumLitCmpForDim;
        const values    = dimSlice.map(d => mainSum(node, d.code ?? "__none__"));
        const cmpValues = isCompare ? dimSlice.map(d => cmpSum(node, d.code ?? "__none__")) : [];
        const total = values.reduce((s, v) => s + v, 0);
        rows.push({ code: node.code, name: node.name || node.code || "", values, cmpValues, total, isSum: !!node.isSum, depth });
        if (node.children && node.children.length > 0) {
          node.children.forEach(c => {
            if (excludeCodes && excludeCodes.has(String(c.code ?? c.AccountCode ?? ""))) return;
            renderRow(c, depth + 1, mode, excludeCodes);
          });
        }
      };

      const treeAsLit = (n, depth, visited = new WeakSet()) => {
        if (!n || depth > 50 || visited.has(n)) {
          return { code: String(n?.AccountCode ?? ""), name: n?.AccountName ?? "", dims: null, isSum: false, depth, children: [] };
        }
        visited.add(n);
        return {
          code: String(n.AccountCode), name: n.AccountName ?? "",
          dims: null, isSum: (n.children?.length ?? 0) > 0, depth,
          children: (n.children || []).map(c => treeAsLit(c, depth + 1, visited)),
        };
      };

      if (useLiteral && literal && literal.length > 0) {
        literal.forEach(section => {
          if (section.label && showBreakers) rows.push({ isBreaker: true, label: section.label });
          section.nodes.forEach(n => renderRow(n, 0, "literal"));
        });
      } else {
        const mappingForSt = stType === "pl" ? plMapping : bsMapping;
        const gaMap = new Map();
        (groupAccounts || []).forEach(a => {
          const code = String(a.AccountCode ?? a.accountCode ?? "");
          if (!code) return;
          gaMap.set(code, {
            AccountCode: code,
            AccountName: a.AccountName ?? a.accountName ?? "",
            SumAccountCode: String(a.SumAccountCode ?? a.sumAccountCode ?? ""),
            AccountType: a.AccountType ?? a.accountType ?? "",
          });
        });
        const targetType = stType === "bs" ? "B/S" : "P/L";
        const stCodes = new Set();
        gaMap.forEach((ga, code) => { if (!ga.AccountType || ga.AccountType === targetType) stCodes.add(code); });
        const childrenIdx = new Map();
        stCodes.forEach(code => {
          const parent = gaMap.get(code).SumAccountCode;
          if (parent && stCodes.has(parent) && parent !== code) {
            if (!childrenIdx.has(parent)) childrenIdx.set(parent, []);
            childrenIdx.get(parent).push(code);
          }
        });
        const buildTreeNode = (code, depth, visited = new Set()) => {
          if (visited.has(code) || depth > 25) {
            return { AccountCode: code, AccountName: gaMap.get(code)?.AccountName ?? "", children: [] };
          }
          const next = new Set(visited); next.add(code);
          const kids = (childrenIdx.get(code) || []).map(c => buildTreeNode(c, depth + 1, next));
          return { AccountCode: code, AccountName: gaMap.get(code)?.AccountName ?? "", children: kids };
        };

        if (mappingForSt?.rows && mappingForSt?.sections) {
          const filterFn = viewLevel === "summary" ? (info => info.showInSummary) : (info => info.isSum);
          const orderedEntries = [...mappingForSt.rows.entries()]
            .filter(([, info]) => filterFn(info))
            .sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
          const topLevelCodes = new Set(orderedEntries.map(([code]) => String(code)));
          const seenSections = new Set();
          orderedEntries.forEach(([code, info]) => {
            if (!stCodes.has(code)) return;
            if (!seenSections.has(info.section) && showBreakers) {
              const sec = mappingForSt.sections.get(info.section);
              if (sec?.label) rows.push({ isBreaker: true, label: sec.label });
              seenSections.add(info.section);
            }
            renderRow(treeAsLit(buildTreeNode(code, 0), 0), 0, "tree", topLevelCodes);
          });
        } else {
          const topCodes = [...stCodes].filter(code => {
            const p = gaMap.get(code).SumAccountCode;
            return !p || !stCodes.has(p);
          }).sort();
          topCodes.forEach(code => renderRow(treeAsLit(buildTreeNode(code, 0), 0), 0, "tree"));
        }
      }

      const startY = drawPageHeader(isFirst, stType, viewLevel, chunkInfo);
      const fmt = v => (v == null || v === 0 || !Number.isFinite(v))
        ? "—"
        : v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtPct = v => v == null || !Number.isFinite(v)
        ? "—"
        : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

      // Header
      let head;
if (isCompare) {
        const top = [{ content: T("file_col_account"), rowSpan: 2, styles: { halign: "left", fillColor: NAVYDK, valign: "middle" } }];
        const bot = [];
        dimSlice.forEach(d => {
          top.push({ content: d.name ?? d.code ?? "—", colSpan: 4, styles: { halign: "center", fillColor: NAVY } });
        });
dimSlice.forEach(() => {
          // A = actual (navy). B / Diff / Diff% are all comparison-side, so
          // share the red palette for visual grouping.
          bot.push({ content: T("file_col_a"),        styles: { halign: "right", fillColor: NAVYMID } });
          bot.push({ content: T("file_col_b"),        styles: { halign: "right", fillColor: REDDK } });
          bot.push({ content: T("file_col_diff"),     styles: { halign: "right", fillColor: REDDK } });
          bot.push({ content: T("file_col_diff_pct"), styles: { halign: "right", fillColor: REDDK } });
        });
        head = [top, bot];
      } else {
        const top = [T("file_col_account"), ...dimSlice.map(d => d.name ?? d.code ?? "—")];
        if (showTotals) top.push(T("file_col_total"));
        head = [top];
      }

      const body = rows.map(r => {
        if (r.isBreaker) {
          return [{
            content: r.label.toUpperCase(),
            colSpan: totalColCount,
            styles: { fillColor: NAVYDK, textColor: WHITE, fontStyle: "bold", halign: "left", fontSize: bodyFont + 0.5 },
          }];
        }
        const indent = "  ".repeat(Math.min(r.depth, 6));
        const name = `${indent}${r.code ? r.code + "  " : ""}${r.name}`;
        const cells = [{ content: name, styles: { fontStyle: r.isSum ? "bold" : "normal" } }];

        if (isCompare) {
          r.values.forEach((a, i) => {
            const b = r.cmpValues[i] ?? 0;
            const delta = (Number.isFinite(a) && Number.isFinite(b)) ? a - b : null;
            const deltaPct = (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b) > 1e-9)
              ? ((a - b) / Math.abs(b)) * 100 : null;
            const dColor = (delta == null || delta === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(a),        styles: { fontStyle: r.isSum ? "bold" : "normal" } });
            cells.push({ content: fmt(b),        styles: { fontStyle: r.isSum ? "bold" : "normal", textColor: RED } });
            cells.push({ content: fmt(delta),    styles: { fontStyle: r.isSum ? "bold" : "normal", textColor: dColor } });
            cells.push({ content: fmtPct(deltaPct), styles: { fontStyle: r.isSum ? "bold" : "normal", textColor: dColor } });
          });
        } else {
          r.values.forEach(v => cells.push({ content: fmt(v), styles: { fontStyle: r.isSum ? "bold" : "normal" } }));
          if (showTotals) cells.push({ content: fmt(r.total), styles: { fontStyle: "bold", fillColor: LIGHT } });
        }
        return cells;
      });

      // Column widths
      const usable = W - 16;
      const nameW  = usable * (totalColCount > 16 ? 0.18 : totalColCount > 10 ? 0.22 : 0.28);
      const remaining = usable - nameW;

      const columnStyles = { 0: { halign: "left", cellWidth: nameW } };
      if (isCompare) {
        // Per dim: A | B | Diff | Diff%   split 30 / 30 / 25 / 15
        const dimBlock = remaining / dimSlice.length;
        const wA = dimBlock * 0.30;
        const wB = dimBlock * 0.30;
        const wD = dimBlock * 0.25;
        const wP = dimBlock * 0.15;
        for (let i = 0; i < dimSlice.length; i++) {
          columnStyles[1 + i * 4]     = { halign: "right", cellWidth: wA };
          columnStyles[1 + i * 4 + 1] = { halign: "right", cellWidth: wB };
          columnStyles[1 + i * 4 + 2] = { halign: "right", cellWidth: wD };
          columnStyles[1 + i * 4 + 3] = { halign: "right", cellWidth: wP };
        }
      } else {
        const colW = remaining / Math.max(1, valueColCount);
        for (let i = 0; i < valueColCount; i++) columnStyles[i + 1] = { halign: "right", cellWidth: colW };
        if (showTotals) columnStyles[valueColCount] = { halign: "right", cellWidth: colW, fillColor: LIGHT, fontStyle: "bold" };
      }

      autoTable(doc, {
        startY,
        head,
        body,
        margin: { left: 8, right: 8, bottom: 14 },
        tableWidth: usable,
        styles: {
          fontSize: bodyFont,
          cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 },
          overflow: "linebreak",
          font: "helvetica",
          textColor: TEXTDK,
          lineColor: GRAYLT,
          lineWidth: 0.12,
          valign: "middle",
        },
        headStyles: {
          fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: headFont,
          cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
          halign: "right", lineWidth: 0,
          overflow: "linebreak",
          valign: "middle",
        },
        columnStyles,
        alternateRowStyles: { fillColor: OFFWHITE },
        didParseCell: d => {
          if (d.section === "head" && d.column.index === 0) {
            d.cell.styles.fillColor = NAVYDK; d.cell.styles.halign = "left";
          }
        },
        didDrawPage: () => drawFooter(stType, viewLevel, chunkInfo),
      });
    };

    const dispatchStatement = (stType, isFirstRef) => {
      const lit = stType === "pl" ? plLiteral : bsLiteral;
      const levels = lit && lit.length > 0 ? [null] : ["summary", "detailed"];
      for (const level of levels) {
        for (let ci = 0; ci < dimChunks.length; ci++) {
          const chunkInfo = { idx: ci, totalChunks: dimChunks.length };
          writePageForStatement(stType, level, dimChunks[ci].dims, chunkInfo, isFirstRef.first);
          isFirstRef.first = false;
        }
      }
    };

    console.log("[pdf] === EXPORT START ===");
    console.log("[pdf] compare:", includeCompareOpt, "dims:", allDims.length, "chunks:", dimChunks.length, "useA3:", useA3);

    const isFirstRef = { first: true };
    if (includePL) dispatchStatement("pl", isFirstRef);
    if (includeBS) dispatchStatement("bs", isFirstRef);

// ── Render the index on page 1 (reserved at doc creation) ───────────────
    doc.setPage(1);

    // Navy banner header (matches content pages)
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 50, "F");
    doc.setFillColor(...RED);  doc.rect(0, 0, 5, 50, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...WHITE);
    doc.text(T("file_dimensions_report"), 12, 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(180, 200, 255);
    const tocSub = [`${monthLabel} ${masterYear}`, masterSource, masterStructure, masterCompany].filter(Boolean).join("  ·  ");
    doc.text(tocSub, 12, 33);

    doc.setFontSize(8);
    doc.setTextColor(160, 180, 235);
doc.text(
      `${includeCompareOpt ? T("file_compare_on") : T("file_single_period")}  ·  ${T("file_generated")} ${new Date().toLocaleDateString()}  ·  ${pageManifest.length} ${pageManifest.length === 1 ? T("file_content_page_one") : T("file_content_page_many")}`,
      12, 42,
    );

    // CONTENTS heading
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(T("file_contents"), 12, 70);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.5);
    doc.line(12, 73, W - 12, 73);

    // Entries
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lineH = 9;
    let tocY = 84;
    const tocBottom = H - 16;

    pageManifest.forEach((entry, i) => {
      if (tocY > tocBottom) return; // hard cap — drop overflow rather than spill

      // Alternating subtle row band
      if (i % 2 === 0) {
        doc.setFillColor(248, 249, 255);
        doc.rect(10, tocY - 6, W - 20, lineH, "F");
      }

      doc.setTextColor(...TEXTDK);
      doc.setFont("helvetica", "normal");
      doc.text(entry.title, 16, tocY);

      // Dotted leader
      const titleW = doc.getTextWidth(entry.title);
      const pgStr  = String(entry.displayedPage);
      const pgW    = doc.getTextWidth(pgStr);
      const dotsStart = 16 + titleW + 4;
      const dotsEnd   = W - 16 - pgW - 4;
      if (dotsEnd > dotsStart) {
        doc.setTextColor(...GRAY);
        doc.setFontSize(8);
        let dotStr = "";
        const dotW = doc.getTextWidth(". ");
        const dotCount = Math.max(0, Math.floor((dotsEnd - dotsStart) / dotW));
        for (let j = 0; j < dotCount; j++) dotStr += ". ";
        doc.text(dotStr, dotsStart, tocY);
        doc.setFontSize(11);
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY);
      doc.text(pgStr, W - 16, tocY, { align: "right" });

      tocY += lineH;
    });

    // Footer on the index page
    doc.setFillColor(...LIGHT);
    doc.rect(0, H - 10, W, 10, "F");
    doc.setDrawColor(...GRAYLT);
    doc.setLineWidth(0.3);
    doc.line(0, H - 10, W, H - 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...NAVY);
doc.text(T("file_dimensions_report"), 10, H - 4.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(`${T("file_index")}  ·  ${monthLabel} ${masterYear}  ·  ${masterSource}`, 56, H - 4.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...NAVY);
    doc.text("1", W - 10, H - 4.5, { align: "right" });

    console.log("[pdf] === EXPORT END === total pages:", pageNum);
doc.save(`Konsolidator_Dimensions_${masterYear}_${String(masterMonth).padStart(2, "0")}.pdf`);
}, [T, data, cmp2Data, statementType, cmpVisible, orderedDimCols, plLiteral, bsLiteral, plMapping, bsMapping, pivot, prevPivotMain, pivot2, prevPivot2, parentOf, viewMode, masterYear, masterMonth, masterSource, masterStructure, masterCompany, selGroups, selDims, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, groupAccounts]);


  // Wire export functions to the ref so DimensionesPage FAB can call them
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current.xlsx = handleExportXlsx;
    exportRef.current.pdf  = handleExportPdf;
  }, [exportRef, handleExportXlsx, handleExportPdf]);
  // ── End export helpers ───────────────────────────────────────────────────
const getCmpVal = useCallback((ac, dk) => {
    const ytd = (pivot2.get(ac)?.get(dk) ?? 0) * sign;
    if (viewMode === "ytd") return ytd;
    const prevYtd = (prevPivot2.get(ac)?.get(dk) ?? 0) * sign;
    return ytd - prevYtd;
  }, [pivot2, prevPivot2, sign, viewMode]);

  // Count-up fires on anything that changes a displayed number. getVal/getCmpVal
  // are useCallbacks whose deps already cover pivot, prevPivot, sign, viewMode;
  // cmpVisible covers the compare-toggle case.
// Trigger animation flag at render when any of the data-shaping deps change.
  const [prevAnimDeps, setPrevAnimDeps] = useState({ getVal, getCmpVal, cmpVisible });
  if (
    prevAnimDeps.getVal !== getVal ||
    prevAnimDeps.getCmpVal !== getCmpVal ||
    prevAnimDeps.cmpVisible !== cmpVisible
  ) {
    setPrevAnimDeps({ getVal, getCmpVal, cmpVisible });
    setIsAnimatingData(true);
  }
  useEffect(() => {
    if (!isAnimatingData) return;
    const t = setTimeout(() => setIsAnimatingData(false), 1100);
    return () => clearTimeout(t);
  }, [isAnimatingData]);

return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
<style>{`
        @keyframes plRowSlideIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
@keyframes cmpBarIn {
          0%   { opacity: 0; transform: translateY(-14px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cmpBarOut {
          0%   { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-14px) scale(0.98); }
        }
        @keyframes cmpCellIn {
          0%   { opacity: 0; transform: translateX(-12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes cmpCellOut {
          0%   { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(12px); }
        }
@keyframes totalColOut {
          0%   { opacity: 1; max-width: 150px; }
          100% { opacity: 0; max-width: 0; overflow: hidden; }
        }
@keyframes iconMorph {
          0%   { opacity: 0; transform: scale(0.6) rotate(-45deg); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: scale(1) rotate(0); }
        }
table td, table th { vertical-align: middle; }
        tbody tr { content-visibility: auto; contain-intrinsic-size: 44px; }
`}</style>


<div className="flex-shrink-0 overflow-hidden" style={{
        maxHeight: compareMode ? 280 : 0,
        marginTop: compareMode ? -20 : -12,
        marginBottom: compareMode ? -28 : 0,
        paddingTop: compareMode ? 24 : 0,
        paddingBottom: compareMode ? 40 : 0,
        paddingLeft: 24,
        paddingRight: 24,
        marginLeft: -24,
        marginRight: -24,
        transition: "max-height 450ms cubic-bezier(0.4,0,0.2,1), margin-top 450ms cubic-bezier(0.4,0,0.2,1), margin-bottom 450ms cubic-bezier(0.4,0,0.2,1), padding-top 450ms cubic-bezier(0.4,0,0.2,1), padding-bottom 450ms cubic-bezier(0.4,0,0.2,1)",
      }}>
      {cmpVisible && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex items-stretch gap-0" style={{ height: "7vh", padding: "0 18px", position: "relative", zIndex: 10, animation: `${cmpExiting ? "cmpBarOut" : "cmpBarIn"} 450ms cubic-bezier(0.4,0,0.2,1) forwards`, transformOrigin: "top center" }}>
          <div className="flex items-center gap-2.5 pr-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
             <span className="text-white text-[11px] font-black">{T("compare_period_b_label")}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
{cmpSources.length > 0    && <HeaderFilterPill label={T("filter_source")}    value={cmp2Source}    onChange={setCmp2Source}    options={cmpSources} />}
            {cmpYears.length > 0      && <HeaderFilterPill label={T("filter_year")}      value={cmp2Year}      onChange={setCmp2Year}      options={cmpYears} />}
            {cmpMonths.length > 0     && <HeaderFilterPill label={T("filter_month")}     value={cmp2Month}     onChange={setCmp2Month}     options={cmpMonths} />}
            {cmpStructures.length > 0 && <HeaderFilterPill label={T("filter_structure")} value={cmp2Structure} onChange={setCmp2Structure} options={cmpStructures} />}
            {cmpCompanies.length > 0  && <HeaderFilterPill label={T("filter_company")}   value={cmp2Company}   onChange={setCmp2Company}   options={cmpCompanies} />}
            {cmp2DimGroups.length > 0 && <MultiFilterPill label={T("filter_dim_group")} values={cmp2SelGroups.size === 0 ? null : [...cmp2SelGroups]} onChange={next => { setCmp2SelGroups(next ? new Set(next) : new Set()); setCmp2SelDims(new Set()); }} options={cmp2DimGroups} />}
{cmp2SelGroups.size > 0 && cmp2AllDims.length > 0 && <MultiFilterPill label={T("filter_dimension")} values={cmp2SelDims.size === 0 ? null : [...cmp2SelDims]} onChange={next => setCmp2SelDims(next ? new Set(next) : new Set())} options={cmp2AllDims} />}
          </div>
        </div>
      )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">

        {/* Synced header */}
        <div ref={headerRef} style={{ overflowX: "auto", overflowY: "hidden", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none", boxShadow: "0 4px 12px -4px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",contain: "layout style" }} onScroll={onHeaderScroll}>
<table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
<colgroup>
              <col style={{ width: 480, minWidth: 480 }} />
{orderedDimCols.map((_, i) => (
                <React.Fragment key={i}>
                  <col style={{ width: dimColWidths[i], minWidth: dimColWidths[i] }} />
                  {cmpVisible && <><col style={{ width: CMP_COL, minWidth: CMP_COL }} /><col style={{ width: DELTA_COL, minWidth: DELTA_COL }} /><col style={{ width: PCT_COL, minWidth: PCT_COL }} /></>}
                </React.Fragment>
              ))}
              <col style={{ width: TCOL, minWidth: TCOL }} />
            </colgroup>
        <thead>

<tr style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
                  <th className="sticky left-0 z-30 text-left px-6" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: "64px", boxShadow: "0 4px 12px -4px rgba(26,47,138,0.08)" }}>
<div className="flex items-center gap-3" style={{ minWidth: ACOL }}>
                      <div className="flex items-center gap-2.5">
                        <button onClick={() => setSearchActive(a => !a)}
                          className="flex items-center justify-center"
                          style={{ background: "transparent", color: searchActive ? colors.primary : "#94a3b8", padding: 0, transition: "color 240ms" }}
                          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
onMouseLeave={e => { e.currentTarget.style.color = searchActive ? colors.primary : "#94a3b8"; }}
                          title={T("dim_search_tooltip")}>
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
                            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                        {searchActive ? (
                          <>
                            <input
                              ref={searchInputRef}
                              autoFocus
                              type="text"
                              value={searchQuery}
                              onChange={e => setSearchQuery(e.target.value)}
                              onKeyDown={e => { if (e.key === "Escape") { setSearchActive(false); setSearchQuery(""); } }}
                              placeholder={T("pivot_account_search_placeholder")}
                              style={{ fontSize: 16, fontWeight: 700, color: colors.primary, border: "none", outline: "none", background: "transparent", width: 240, padding: 0, letterSpacing: "-0.02em" }}
                            />
                            <button onClick={() => { setSearchActive(false); setSearchQuery(""); }}
                              className="flex items-center justify-center ml-1"
                              style={{ background: "transparent", color: "#94a3b8", padding: 2, transition: "color 200ms" }}
                              onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                              onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
                              title={T("dim_close_search")}>
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
<span onClick={() => setSearchActive(true)} className="font-black tracking-tight"
                              style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em", cursor: "pointer" }}>
                              {T("col_account")}
                            </span>
                            <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
                              {statementType === "pl" ? T("tab_pl") : T("tab_bs_short")}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
<button onClick={() => expandedSet.size > 0 ? collapseAll() : expandAll()}
                          className="flex items-center justify-center"
                          style={{ background: "transparent", color: "#94a3b8", padding: 4, transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                          onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
                          title={expandedSet.size > 0 ? T("btn_collapse_all") : T("btn_expand_all")}>
                          <span key={expandedSet.size > 0 ? "collapse" : "expand"} className="inline-flex"
                            style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                            {expandedSet.size > 0
                              ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            }
                          </span>
                        </button>
{!hasCustomMapping && <div className="relative flex items-center"
                          ref={el => {
                            if (!el) return;
                            const tabs = el.querySelectorAll("[data-dim-tab]");
                            const idx = summaryMode ? 0 : 1;
                            const active = tabs[idx];
                            const indicator = el.querySelector(".dim-view-indicator");
                            if (active && indicator) {
                              indicator.style.left = active.offsetLeft + "px";
                              indicator.style.width = active.offsetWidth + "px";
                            }
                          }}>
                          <span className="dim-view-indicator" style={{
                            position: "absolute", bottom: -4, height: 2,
                            background: colors.primary, borderRadius: 1,
                            transition: "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), width 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                            pointerEvents: "none",
                          }} />
                          {[["summary", T("view_summary")], ["detailed", T("view_detailed")]].map(([v, label]) => {
                            const active = (v === "summary" && summaryMode) || (v === "detailed" && !summaryMode);
                            return (
                              <button key={v} data-dim-tab onClick={() => setSummaryMode(v === "summary")}
                                className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] whitespace-nowrap"
                                style={{
                                  background: "transparent",
                                  color: active ? colors.primary : "#94a3b8",
                                  transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
                                }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>}
                      </div>
                    </div>
                  </th>
{orderedDimCols.map((dim) => (
                    <React.Fragment key={dim.code ?? "__none__"}>
<th
                        className="text-center px-4 py-3 whitespace-nowrap select-none"
                        draggable
                        onDragStart={() => setDraggingCol(dim.code ?? "__none__")}
                        onDragOver={e => { e.preventDefault(); setDragOverCol(dim.code ?? "__none__"); }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={e => {
                          e.preventDefault();
                          if (!draggingCol || draggingCol === (dim.code ?? "__none__")) { setDraggingCol(null); setDragOverCol(null); return; }
                          const cols = (colOrder ?? orderedDimCols.map(d => d.code ?? "__none__"));
                          const from = cols.indexOf(draggingCol);
                          const to = cols.indexOf(dim.code ?? "__none__");
                          if (from === -1 || to === -1) { setDraggingCol(null); setDragOverCol(null); return; }
                          const next = [...cols];
                          next.splice(from, 1);
                          next.splice(to, 0, draggingCol);
                          setColOrder(next);
                          setDraggingCol(null);
                          setDragOverCol(null);
                        }}
                        onDragEnd={() => { setDraggingCol(null); setDragOverCol(null); }}
                        style={{
                          background: dragOverCol === (dim.code ?? "__none__") ? `${colors.primary}15` : "rgba(255,255,255,0.95)",
                          cursor: "grab",
                          outline: dragOverCol === (dim.code ?? "__none__") ? `2px solid ${colors.primary}` : "none",
                          transition: "background 150ms ease, outline 150ms ease",
                          opacity: draggingCol === (dim.code ?? "__none__") ? 0.4 : 1,
                        }}>
                        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{String(dim.name ?? "").replace(/^\d+\s*[-:.]?\s*/, "")}</span>
                      </th>
{cmpVisible && <>
                        <th className="text-center px-3 py-2 whitespace-nowrap" style={{ background: "#fafbff", animation: `${cmpExiting ? "cmpCellOut" : "cmpCellIn"} 420ms cubic-bezier(0.4,0,0.2,1) 0ms forwards` }}>
                         <span style={{ ...header2Style, color: "#CF305D", opacity: 0.7 }}>{T("pivot_col_sigma_cmp")}</span>
                        </th>
                        <th className="text-center px-3 py-2 whitespace-nowrap" style={{ background: "#f5f7ff", animation: `${cmpExiting ? "cmpCellOut" : "cmpCellIn"} 420ms cubic-bezier(0.4,0,0.2,1) 40ms forwards` }}>
                          <span style={{ ...header2Style, color: "#CF305D", opacity: 0.7 }}>{T("pivot_col_delta_amt")}</span>
                        </th>
                        <th className="text-center px-3 py-2 whitespace-nowrap" style={{ background: "#f0f3ff", animation: `${cmpExiting ? "cmpCellOut" : "cmpCellIn"} 420ms cubic-bezier(0.4,0,0.2,1) 80ms forwards` }}>
                          <span style={{ ...header2Style, color: "#CF305D", opacity: 0.7 }}>{T("pivot_col_delta_pct")}</span>
                        </th>
                      </>}
                    </React.Fragment>
                  ))}
{!cmpVisible && <th className="sticky right-0 z-10 text-center px-4 py-2" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
                    <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{T("pivot_col_total")}</span>
                  </th>}
</tr>
            </thead>
          </table>
        </div>

        {/* Synced body */}
        <div ref={bodyRef} className="scrollbar-hide" style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto", contain: "layout style" }} onScroll={onBodyScroll}>
          <table style={{ borderCollapse: "collapse", minWidth: totalWidth, width: "100%", tableLayout: "fixed" }}>
<colgroup>
              <col style={{ width: ACOL, minWidth: ACOL }} />
{orderedDimCols.map((_, i) => (
                <React.Fragment key={i}>
                  <col style={{ width: dimColWidths[i], minWidth: dimColWidths[i] }} />
                  {cmpVisible && <><col style={{ width: CMP_COL, minWidth: CMP_COL }} /><col style={{ width: DELTA_COL, minWidth: DELTA_COL }} /><col style={{ width: PCT_COL, minWidth: PCT_COL }} /></>}
                </React.Fragment>
              ))}
{!cmpVisible && <col style={{ width: TCOL, minWidth: TCOL }} />}
            </colgroup>
<tbody>
              {(() => {
                // ── SAVED-MAPPING LITERAL RENDER PATH ────────────────────────
                // Mirrors AccountsDashboard's PLStatement/BalanceSheet rendering:
                // walks the literal tree (with breakers, sum nodes, dim filters),
                // indents by tree depth, and rolls up via own + descendants.
const literal = statementType === "pl" ? plLiteral : bsLiteral;
                if (literal && literal.length > 0) {
                  const ROW_H = 44;
                  const BUFFER = 10;

                  const __sumCache = new Map();
                  const __sumCmpCache = new Map();
                  const leafVal = (node, dimKey) => {
                    if (node.dims && node.dims.length > 0) {
                      const match = node.dims.some(d => {
                        const i = d.indexOf(":");
                        const v = i === -1 ? d : d.slice(i + 1);
                        return String(v) === String(dimKey);
                      });
                      if (!match) return 0;
                    }
                    return getValWithDescendants(node.code, dimKey);
                  };
                  const sumLitForDim = (node, dimKey) => {
                    const k = `${node.id}|${dimKey}`;
                    const cached = __sumCache.get(k);
                    if (cached !== undefined) return cached;
                    const v = (node.isSum && node.children && node.children.length > 0)
                      ? node.children.reduce((s, c) => s + sumLitForDim(c, dimKey), 0)
                      : leafVal(node, dimKey);
                    __sumCache.set(k, v);
                    return v;
                  };
                  const leafValCmp = (node, dimKey) => {
                    if (node.dims && node.dims.length > 0) {
                      const match = node.dims.some(d => {
                        const i = d.indexOf(":");
                        const v = i === -1 ? d : d.slice(i + 1);
                        return String(v) === String(dimKey);
                      });
                      if (!match) return 0;
                    }
                    return getCmpValWithDescendants(node.code, dimKey);
                  };
                  const sumLitCmpForDim = (node, dimKey) => {
                    const k = `${node.id}|${dimKey}`;
                    const cached = __sumCmpCache.get(k);
                    if (cached !== undefined) return cached;
                    const v = (node.isSum && node.children && node.children.length > 0)
                      ? node.children.reduce((s, c) => s + sumLitCmpForDim(c, dimKey), 0)
                      : leafValCmp(node, dimKey);
                    __sumCmpCache.set(k, v);
                    return v;
                  };

                  // PASS 1: build a flat list of descriptors for every visible row.
                  // No JSX yet — just data. Cheap.
                  const descriptors = [];
                  const walkLit = (node, depth, parentPath, secIdx) => {
                    const rowKey = `litrow-${secIdx}-${parentPath}-${node.id}`;
                    const hasKids = node.children && node.children.length > 0;
                    const expanded = expandedSet.has(rowKey) || (searchExpansionSet?.has(rowKey) ?? false);
                    descriptors.push({ kind: "row", rowKey, node, depth, hasKids, expanded });
                    if (expanded && hasKids) {
                      node.children.forEach(c => walkLit(c, depth + 1, `${parentPath}-${node.id}`, secIdx));
                    }
                  };
                  literal.forEach((section, secIdx) => {
                    if (section.label) descriptors.push({ kind: "section", secIdx, section });
                    section.nodes.forEach(n => walkLit(n, 0, "root", secIdx));
                  });

                  // PASS 2: window — only build JSX for visible slice + buffer.
                  const totalRows = descriptors.length;
                  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
                  const lastVisible  = Math.min(totalRows, Math.ceil((scrollTop + bodyHeight) / ROW_H) + BUFFER);
                  const topPad    = firstVisible * ROW_H;
                  const bottomPad = (totalRows - lastVisible) * ROW_H;

                  const out = [];
                  if (topPad > 0) {
                    out.push(<tr key="__top_pad" style={{ height: topPad }}><td colSpan={orderedDimCols.length * (cmpVisible ? 4 : 1) + 2} /></tr>);
                  }

                  const q = debouncedQuery.trim().toLowerCase();
                  for (let i = firstVisible; i < lastVisible; i++) {
                    const d = descriptors[i];
                    if (d.kind === "section") {
                      out.push(
                        <tr key={`litsec-${d.secIdx}`}>
                          <td className="sticky left-0 z-20 px-6 py-1.5" style={{ backgroundColor: d.section.color }}>
                            <span className="uppercase tracking-widest" style={header3Style}>{d.section.label}</span>
                          </td>
                          {Array.from({ length: cmpVisible ? orderedDimCols.length * 4 : orderedDimCols.length + 1 }).map((_, j) => (
                            <td key={j} style={{ backgroundColor: d.section.color }} />
                          ))}
                        </tr>
                      );
                      continue;
                    }
                    const { node, depth, hasKids, expanded, rowKey } = d;
                    const rowStyle = depth === 0 ? body1Style : body2Style;
                    const rowTotal = orderedDimCols.reduce((s, dim) => s + sumLitForDim(node, dim.code ?? "__none__"), 0);
                    const isMatch = !!q && (String(node.code ?? "").toLowerCase().includes(q) || String(node.name ?? "").toLowerCase().includes(q));
const rowAnim = tableJustLoaded && i < 25
                      ? { animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(i, 25) * 35 + 50}ms both` }
                      : null;
                    out.push(
                      <tr key={rowKey} className={`border-b border-gray-100 ${isMatch ? "bg-[#fef3c7]" : "bg-white hover:bg-[#eef1fb]/60"}`}
                          onClick={hasKids ? () => toggleExpand(rowKey) : undefined}
                          style={{ cursor: hasKids ? "pointer" : "default", ...(rowAnim ?? {}) }}>
                        <td className={`py-2.5 sticky left-0 z-10 border-r border-gray-100 ${isMatch ? "bg-[#fef3c7]" : "bg-white"}`}
                            style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 300 }}>
                          <div className="flex items-center">
                            {hasKids
                              ? <span className="flex-shrink-0 mr-2" style={{ color: colors.primary }}>
                                  {expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                                </span>
                              : <span className="inline-block mr-2" style={{ width: 12 }} />}
                            {node.code && <span className="flex-shrink-0 mr-2" style={subbody2Style}>{node.code}</span>}
                            <span className="truncate max-w-[280px]" style={rowStyle}>{node.name || node.code}</span>
                          </div>
                        </td>
{orderedDimCols.map(dim => {
                          const dk = dim.code ?? "__none__";
                          const val = sumLitForDim(node, dk);
                          if (!cmpVisible) return <DimAmountCell key={dk} value={val} typoStyle={rowStyle} animate={isAnimatingData} />;
                          const cmpVal = sumLitCmpForDim(node, dk);
                          const diff = val - cmpVal;
                          const pct = cmpVal !== 0 ? (diff / Math.abs(cmpVal)) * 100 : null;
                          const devColor = diff === 0 ? "#D1D5DB" : diff > 0 ? "#059669" : "#EF4444";
                          const cmpA = cmpRecentlyToggled ? { animation: `cmpCellIn 420ms cubic-bezier(0.4,0,0.2,1) 0ms forwards` } : undefined;
                          return (
                            <React.Fragment key={dk}>
                              <DimAmountCell value={val} typoStyle={rowStyle} animate={isAnimatingData} />
<DimAmountCell value={cmpVal} typoStyle={rowStyle} animate={isAnimatingData} bgColor="#fafbff" extraStyle={cmpA} />
                              <DimDiffCell value={diff} animate={isAnimatingData} color={devColor} width={110} bgColor="#f5f7ff" extraStyle={cmpRecentlyToggled ? { animation: `cmpCellIn 420ms cubic-bezier(0.4,0,0.2,1) 40ms forwards` } : undefined} />
                              <DimPctCell value={pct} animate={isAnimatingData} color={devColor} width={90} bgColor="#f0f3ff" extraStyle={cmpRecentlyToggled ? { animation: `cmpCellIn 420ms cubic-bezier(0.4,0,0.2,1) 80ms forwards` } : undefined} />
                            </React.Fragment>
                          );
                        })}
                        {!cmpVisible && <DimAmountCell value={rowTotal} typoStyle={rowStyle} animate={isAnimatingData} bgColor="#fafafa" extraStyle={{ position: "sticky", right: 0, zIndex: 10, borderLeft: "1px solid #f3f4f6", minWidth: 150 }} />}
                      </tr>
                    );
                  }

                  if (bottomPad > 0) {
                    out.push(<tr key="__bot_pad" style={{ height: bottomPad }}><td colSpan={orderedDimCols.length * (cmpVisible ? 4 : 1) + 2} /></tr>);
                  }
                  return out;
                }

                // ── DEFAULT FLAT RENDER PATH (no literal) ───────────────────
                // Codes already rendered as flat siblings — drill-down expansion
                // should skip them to avoid duplicate rows.
                const flatCodes = new Set(orderedRows.map(n => String(n.AccountCode)));
                // Per-code indent level from the active mapping. Falls back to 0
                // when no mapping is active (default tree rendering).
// Only honor mapping `level` for indent when a CUSTOM saved mapping is active.
// Default standard mappings (PGC / Danish / Spanish IFRS from Supabase) carry
// level values intended for a different renderer and produce wrong indent here.
const levelByCode = (hasCustomMapping && activeMapping?.rows)
                  ? new Map([...activeMapping.rows.entries()].map(([code, info]) => [String(code), info.level ?? 0]))
                  : null;                         
                return orderedRows.map((node, idx) => {
                  const divider = dividerMap[String(node.AccountCode)];
                  const depth = levelByCode?.get(String(node.AccountCode)) ?? 0;
                  return (
                    <React.Fragment key={node.AccountCode}>
                      {divider && (
                        <tr>
                          <td className="sticky left-0 z-20 px-6 py-1.5" style={{ backgroundColor: divider.color }}>
                            <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
                          </td>
                          {Array.from({ length: dimCols.length * (cmpVisible ? 4 : 1) + 1 }).map((_, i) => (
                            <td key={i} style={{ backgroundColor: divider.color }} />
                          ))}
                        </tr>
                      )}
<DimensionRow node={node} depth={depth}
                        expandedSet={expandedSet} onToggle={toggleExpand}
                        dimCols={orderedDimCols} getVal={getVal} getCmpVal={compareMode ? getCmpVal : null}
                        compareMode={compareMode} cmpVisible={cmpVisible} cmpExiting={cmpExiting}
                        body1Style={body1Style} body2Style={body2Style}
                        header2Style={header2Style} colors={colors}
                        excludeCodes={flatCodes} rowIndex={idx}
                        searchQuery={debouncedQuery} searchExpansionSet={searchExpansionSet}
                        valCache={valCache} cmpCache={cmpCache}
                        isAnimatingData={isAnimatingData} tableJustLoaded={tableJustLoaded} cmpRecentlyToggled={cmpRecentlyToggled} />
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
export default function DimensionesPage({ token, onNavigate, sources = [], structures = [], companies = [], dimensions = [], cachedPeriod = null }) {
const { colors, locale } = useSettings();
const T = useCallback((k, fb) => t(locale, k, fb), [locale]);
const { getLatestPeriod, setLatestPeriod } = useLatestPeriod();

  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [metaReady, setMetaReady] = useState(false);
const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("");
  const [company,   setCompany]   = useState("");
const [showAccounts, setShowAccounts] = useState(false);
const [selGroups, setSelGroups] = useState(new Set());
const [selDims, setSelDims] = useState(new Set());
const [compareMode, setCompareMode] = useState(false);
const [ytdOnly, setYtdOnly] = useState(false);
  const viewMode = ytdOnly ? "ytd" : "monthly";
  // P&L / B/S statement type — lifted from PivotTab to drive PageHeader tabs
  const [statementType, setStatementType] = useState("pl");
const [activeMapping, setActiveMapping] = useState(null);
const [exporting, setExporting] = useState(false);
  const pivotExportRef = useRef({ xlsx: null, pdf: null });
const [exportModal, setExportModal] = useState(false);
const [exportOpts, setExportOpts] = useState({
    statements: { pl: true, bs: true },
    includeBreakers: true,
    includeTotals: true,
    includeCompare: true,
    drilldown: true,
    format: "xlsx",
  });
// Keep the statement toggle in sync with the active tab so the user's current
  // view defaults to on. Done during render (React's recommended pattern for
  // adjusting state on prop change).
  const [prevStatementType, setPrevStatementType] = useState(statementType);
  if (prevStatementType !== statementType) {
    setPrevStatementType(statementType);
    setExportOpts(o => ({
      ...o,
      statements: { ...o.statements, [statementType]: true },
    }));
  }

const runExport = useCallback(async () => {
    console.log("[export] runExport called, opts:", exportOpts);
    console.log("[export] pivotExportRef.current:", pivotExportRef.current);
    setExportModal(false);
    setExporting(true);
    try {
      const fn = exportOpts.format === "pdf" ? pivotExportRef.current.pdf : pivotExportRef.current.xlsx;
      console.log("[export] resolved fn:", typeof fn);
if (!fn) {
        alert(T("export_not_ready_alert"));
        return;
      }
      console.log("[export] calling export fn…");
      await fn(exportOpts);
      console.log("[export] export fn returned");
} catch (e) {
      console.error("[export] Export failed:", e);
      alert(`${T("export_failed_alert")}: ${e?.message ?? e}`);
    } finally {
      setExporting(false);
    }
}, [exportOpts, T]);

  const handleApplyMapping = useCallback((m, kind = "structure") => {
    console.log("[apply mapping]", {
      kind,
      hasPlTree: Array.isArray(m.pl_tree),
      plTreeLen: m.pl_tree?.length,
      plTreeSample: m.pl_tree?.[0],
      bsTreeLen: m.bs_tree?.length,
      plLiteralBuilt: buildSavedMappingLiteral(m.pl_tree),
    });
    setActiveMapping({
      mapping_id:  m.mapping_id,
      kind,
      name:        m.name,
      standard:    m.standard,
      plConverted: convertSavedMappingTree(m.pl_tree),
      bsConverted: convertSavedMappingTree(m.bs_tree),
      plSections:  extractSectionsFromTree(m.pl_tree),
      bsSections:  extractSectionsFromTree(m.bs_tree),
      plLiteral:   buildSavedMappingLiteral(m.pl_tree),
      bsLiteral:   buildSavedMappingLiteral(m.bs_tree),
    });
}, []);

  // Auto-apply the user's saved standard mapping once per page load. Mirrors
  // the same flow used by AccountsDashboard / KpiIndividualesPage so jumping
  // between tabs doesn't lose your default view.
  const autoMappingAppliedRef = useRef(false);
  useEffect(() => {
    if (autoMappingAppliedRef.current) return;
    autoMappingAppliedRef.current = true;
    (async () => {
      try {
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { data: settingsData } = await supabase
          .from("user_settings")
          .select("preferences")
          .eq("user_id", uid)
          .single();
        const mid = settingsData?.preferences?.standard_mapping_id;
        if (!mid) return;
        const { listMappings, getMapping, getActiveCompanyId } = await import("../../lib/mappingsApi");
        const cid = await getActiveCompanyId(uid);
        if (!cid) return;
        const allMappings = await listMappings({ companyId: cid });
        const match = (allMappings || []).find(m => String(m.mapping_id) === String(mid));
        if (!match) return;
        // Fetch the full mapping (with pl_tree / bs_tree) — list endpoint omits them
        const full = await getMapping(match.mapping_id);
        handleApplyMapping(full ?? match, "structure");
      } catch (err) { console.error("[auto-mapping] error:", err); }
    })();
  }, [handleApplyMapping]);

  // Recent mappings for the PageHeader hover-dropdown quick-access
  const [recentMappings, setRecentMappings] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { listMappings, getActiveCompanyId } = await import("../../lib/mappingsApi");
        const { listMappings: listReportMappings } = await import("../../lib/reportMappingsApi");
        const cid = await getActiveCompanyId(uid);
        if (!cid) return;
        const [structRows, reportRows] = await Promise.all([
          listMappings({ companyId: cid }).catch(() => []),
          listReportMappings({ companyId: cid }).catch(() => []),
        ]);
        const combined = [
          ...(structRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "structure", updated_at: r.updated_at, raw: r })),
          ...(reportRows  || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "report",    updated_at: r.updated_at, raw: r })),
        ];
        setRecentMappings(combined);
      } catch (err) { console.error("[recent-mappings] error:", err); }
    })();
  }, []);

// Inline mappings library (mirrors AccountsDashboard's viewsMode pattern)
  const [viewsMode, setViewsMode] = useState(null); // null | "landing" | "structure" | "report"
  const [savedMappings, setSavedMappings]           = useState([]);
  const [savedMappingsLoading, setSavedMappingsLoading] = useState(false);
  const [savedMappingsError, setSavedMappingsError] = useState(null);
  const [reportMappings, setReportMappings]         = useState([]);
  const [reportMappingsLoading, setReportMappingsLoading] = useState(false);
  const [reportMappingsError, setReportMappingsError] = useState(null);

  const fetchSavedMappings = useCallback(async () => {
    setSavedMappingsLoading(true); setSavedMappingsError(null);
    try {
      const { supabase } = await import("../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { listMappings, getActiveCompanyId } = await import("../../lib/mappingsApi");
      const cid = await getActiveCompanyId(uid);
      if (!cid) throw new Error("No active company");
      const rows = await listMappings({ companyId: cid });
      setSavedMappings(Array.isArray(rows) ? rows : []);
    } catch (e) { setSavedMappingsError(e.message); setSavedMappings([]); }
    finally { setSavedMappingsLoading(false); }
  }, []);

  const fetchReportMappings = useCallback(async () => {
    setReportMappingsLoading(true); setReportMappingsError(null);
    try {
      const { supabase } = await import("../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { listMappings: listRpt, getActiveCompanyId } = await import("../../lib/reportMappingsApi");
      const cid = await getActiveCompanyId(uid);
      if (!cid) throw new Error("No active company");
      const rows = await listRpt({ companyId: cid });
      setReportMappings(Array.isArray(rows) ? rows : []);
    } catch (e) { setReportMappingsError(e.message); setReportMappings([]); }
    finally { setReportMappingsLoading(false); }
  }, []);

// Fetch-on-mode-change: the called fns setState internally for loading/data,
  // which is the canonical async pattern. No TanStack Query / SWR in this codebase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (viewsMode === "structure") fetchSavedMappings(); }, [viewsMode, fetchSavedMappings]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (viewsMode === "report") fetchReportMappings(); }, [viewsMode, fetchReportMappings]);

const [rawData, setRawData] = useState([]);
  const [probeFinished, setProbeFinished] = useState(false);
  // `loading` / `hasCompletedFetch` / `error` are all derived from a fetch-key.
  // The fetch effect only writes state inside async callbacks (post-await),
  // which the lint doesn't flag.
  const [fetchedKey, setFetchedKey] = useState(null);
  const [errorState, setErrorState] = useState({ key: null, msg: null });
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
const { ccTagToCodes, resolveCcTag } = useMemo(() => {
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

// Sync the LatestPeriodContext cache into local state on arrival/change.
  // Done during render (React's "adjust state on prop change" pattern) — no
  // effect, no extra render cycle, no lint disable.
  const cachedKey = `${cachedPeriod?.year ?? ""}|${cachedPeriod?.month ?? ""}`;
  const [prevSyncKey, setPrevSyncKey] = useState(null);
  const syncKey = `${token ?? ""}::${cachedKey}`;
  if (token && prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey);
    if (cachedPeriod?.year && cachedPeriod?.month) {
      setYear(String(cachedPeriod.year));
      setMonth(String(cachedPeriod.month));
    }
    setMetaReady(true);
  }

// Cache-hit + probe-reset live at render time (React's "adjust state on prop
  // change" pattern). The async probe itself stays in the effect below — its
  // setStates run inside async callbacks, which the rule doesn't flag.
  const probeKey = (source && structure && company) ? `${source}|${structure}|${company}` : null;
  const [prevProbeKey, setPrevProbeKey] = useState(null);
if (probeKey && prevProbeKey !== probeKey) {
    setPrevProbeKey(probeKey);
    const cached = getLatestPeriod(source, structure, company);
    if (cached?.year && cached?.month) {
      setYear(String(cached.year));
      setMonth(String(cached.month));
      setProbeFinished(true);
    } else {
      setProbeFinished(false); // about to probe asynchronously
    }
  }

  useEffect(() => {
    if (!source || !structure || !company) return;
    const key = `${source}|${structure}|${company}`;
    if (probedRef.current.key === key) return;
    probedRef.current.key = key;

    // Cache hit was already handled at render time above; this effect only
    // runs the FALLBACK probe when the cache missed.
    const cached = getLatestPeriod(source, structure, company);
    if (cached?.year && cached?.month) return;
    (async () => {
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      for (let i = 0; i < 60; i++) {
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
              setLatestPeriod(source, structure, company, y, m);
              setProbeFinished(true);
              return;
            }
          }
        } catch { /* keep probing */ }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      // Nothing found in 5 years — give up and show current date so user can
      // pick manually. Don't leave year/month at some stale future value.
      probedRef.current.key = "";
      setYear(String(now.getFullYear()));
      setMonth(String(now.getMonth() + 1));
      setProbeFinished(true);
})();
  }, [metaReady, source, structure, company, token, getLatestPeriod, setLatestPeriod]);

// Default each filter to the first available option. Done during render —
  // the guards (`!source` etc.) self-disable after the first set, so no loop.
  if (sources.length > 0 && !source) {
    const s = sources[0];
    setSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
  }
  if (structures.length > 0 && !structure) {
    const s = structures[0];
    setStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
  }
  if (companies.length > 0 && !company) {
    const c = companies[0];
    setCompany(typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c));
  }

// Build a key representing the current request. `loading` is true whenever
  // this key doesn't match the last completed fetch; `hasCompletedFetch` is
  // true once any fetch has finished. Both are pure derivations of state.
  const fetchKey = (metaReady && year && month && source && structure && company)
    ? `${year}|${month}|${source}|${structure}|${company}`
    : null;
  const loading = !!fetchKey && fetchedKey !== fetchKey;
  const hasCompletedFetch = fetchedKey !== null;
  const error = errorState.key === fetchKey ? errorState.msg : null;

  useEffect(() => {
    if (!fetchKey) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
        const res = await fetch(
          `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
          { headers: authHeaders(), signal: ctrl.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (ctrl.signal.aborted) return;
        setRawData(json.value ?? (Array.isArray(json) ? json : []));
        setErrorState({ key: fetchKey, msg: null });
        setFetchedKey(fetchKey);
      } catch (e) {
        if (ctrl.signal.aborted || e.name === "AbortError") return;
        setErrorState({ key: fetchKey, msg: e.message });
        setFetchedKey(fetchKey); // mark as complete even on error
      }
    })();
    return () => ctrl.abort();
  }, [fetchKey, year, month, source, structure, company, authHeaders]);

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

const allDimsForGroups = useMemo(() => {
    if (selGroups.size === 0) return [];
    const seen = new Set();
    rawData.forEach(r => {
      parseDimensions(r.Dimensions).forEach(([grp, code]) => {
        if (selGroups.has(grp)) seen.add(code);
      });
    });
    const dimNameLookup = new Map();
    (dimensions || []).forEach(d => {
      const code = d.code ?? d.Code ?? d.dimensionCode ?? d.DimensionCode ?? "";
      const name = d.name ?? d.Name ?? d.dimensionName ?? d.DimensionName ?? code;
      if (code) dimNameLookup.set(String(code), name);
    });
    return [...seen].sort().map(code => ({ value: code, label: dimNameLookup.get(code) ?? code }));
  }, [rawData, selGroups, dimensions]);

const dimDashProgress = useMemo(() => {
    let pct = 0;
    if (year && month)                                           pct += 20;
    if (sources.length > 0 && structures.length > 0)            pct += 15;
    if (groupAccountsLocal.length > 0)                          pct += 25;
    if (!loading)                                                pct += 40;
    return Math.min(100, pct);
  }, [year, month, sources.length, structures.length, groupAccountsLocal.length, loading]);

const animatedDimProgress = useAnimatedNumber(dimDashProgress, 700);
// Once we have data, we're ready — never go back to the loading screen on refetches.
  // Otherwise wait until probe AND fetch both finish AND no fetch is in flight; this
  // covers the gap where the first (wrong-period) fetch completes empty but the probe
  // has already kicked off a second fetch — we don't want to flash "No data" in between.
  const dimDashReady = rawData.length > 0 || (hasCompletedFetch && probeFinished && !loading);

  const sourceOpts    = [...new Set(sources.map(s  => typeof s === "object" ? (s.source    ?? s.Source    ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
const companyOpts   = companies.length > 0 && typeof companies[0] === "object"
    ? (console.log("[companyOpts] sample:", companies[0]), companies.map(c => ({ value: c.companyShortName ?? c.CompanyShortName ?? String(c), label: c.CompanyLegalName ?? c.companyLegalName ?? c.companyShortName ?? c.CompanyShortName ?? String(c)})).filter(o => o.value))
    : [...new Set(companies.map(c => String(c)).filter(Boolean))].map(v => ({ value: v, label: v }));

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

{/* Header */}
<PageHeader
kicker={viewsMode ? T("dim_kicker_views") : T("dim_kicker")}
        title={
          viewsMode === "landing"   ? T("mappings")
          : viewsMode === "structure" ? T("views_structure_mappings")
          : viewsMode === "report"    ? T("views_report_mappings")
          : (statementType === "pl" ? T("tab_pl") : T("tab_bs_short"))
        }
        tabs={viewsMode ? [] : [
          { id: "pl", label: T("tab_pl"),       icon: TrendingUp },
          { id: "bs", label: T("tab_bs_short"), icon: BarChart2 },
        ]}
        activeTab={viewsMode ? null : statementType}
        onTabChange={setStatementType}
        onBack={viewsMode ? () => { if (viewsMode === "landing") setViewsMode(null); else setViewsMode("landing"); } : undefined}
        filters={viewsMode ? [] : [
...(YEARS.length > 0
            ? [{ label: T("filter_year"), value: year, onChange: setYear,
                options: (() => {
                  const base = YEARS.map(y => String(y));
                  // Include the currently selected year even if it's outside the
                  // rolling 6-year window — otherwise the FilterPill renders "—"
                  // and the filter looks "empty" to the user.
                  if (year && !base.includes(String(year))) base.unshift(String(year));
                  return base.map(y => ({ value: y, label: y }));
                })() }]
            : []),
...(MONTHS.length > 0
            ? [{ label: T("filter_month"), value: month, onChange: setMonth,
                options: MONTHS.map(m => ({ value: String(m.value), label: T(`month_${m.value}`) })) }]
            : []),
          ...(sourceOpts.length > 0
            ? [{ label: T("filter_source"), value: source, onChange: setSource, options: sourceOpts }]
            : []),
          ...(structureOpts.length > 0
            ? [{ label: T("filter_structure"), value: structure, onChange: setStructure, options: structureOpts }]
            : []),
...(companyOpts.length > 0
            ? [{ label: T("filter_company"), value: company, onChange: setCompany, options: companyOpts }]
            : []),
...(dimGroups.length > 0
            ? [{ label: T("filter_dim_group"), multiselect: true, values: selGroups.size === 0 ? null : [...selGroups], onChange: (next) => {
                setSelGroups(next ? new Set(next) : new Set());
                setSelDims(new Set());
              }, options: dimGroups.map(g => ({ value: g, label: g })) }]
            : []),
...(selGroups.size > 0 && allDimsForGroups.length > 0
            ? [{ label: T("filter_dimension"), multiselect: true, values: selDims.size === 0 ? null : [...selDims], onChange: (next) => {
                setSelDims(next ? new Set(next) : new Set());
              }, options: allDimsForGroups }]
            : []),
        ]}
periodToggle={(viewsMode || statementType === "bs") ? null : {
          value: ytdOnly ? "ytd" : "monthly",
          onChange: (next) => setYtdOnly(next === "ytd"),
        }}
        compareToggle={viewsMode ? null : {
          active: compareMode,
          onChange: setCompareMode,
        }}
        onMappingsClick={viewsMode ? undefined : () => setViewsMode("landing")}
        mappingsQuickAccess={viewsMode ? [] : recentMappings}
  onQuickApplyMapping={async (m) => {
          try {
            const mod = await import(m.kind === "report" ? "../../lib/reportMappingsApi" : "../../lib/mappingsApi");
            const full = await mod.getMapping(m.id);
            handleApplyMapping(full ?? m.raw, m.kind);
          } catch (err) {
            console.error("[quick apply mapping]", err);
          }
        }}
onExportXlsx={() => {
          console.log("[export] onExportXlsx fired");
          setExportOpts(o => ({ ...o, format: "xlsx" }));
          setExportModal(true);
        }}
        onExportPdf={() => {
          console.log("[export] onExportPdf fired");
          setExportOpts(o => ({ ...o, format: "pdf" }));
          setExportModal(true);
        }}
      />

{activeMapping && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm flex-shrink-0">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
<span className="text-xs text-emerald-700 font-medium">
            {T("mapping_active")}: <strong className="font-black">{activeMapping.name}</strong>
            <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
          </span>
          <button
            onClick={() => {
              try {
                sessionStorage.setItem("mappings:openForEdit", JSON.stringify({
                  mapping_id: activeMapping.mapping_id,
                  kind: activeMapping.kind ?? "structure",
                }));
              } catch { /* ignore quota errors */ }
              onNavigate?.("mappings");
            }}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
title={T("edit_mapping_title")}
          >
            <Pencil size={11} />
            {T("btn_edit")}
          </button>
          <button
            onClick={() => setActiveMapping(null)}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
title={T("clear_mapping_title")}
          >
            <X size={11} />
            {T("btn_clear")}
          </button>
        </div>
      )}



{/* Inline mappings library (replaces dimensions content when active) */}
      {viewsMode ? (
        <div className="flex-1 flex flex-col min-h-0">
          <style>{`
            @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
            @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
          `}</style>

          {/* Landing: Structure vs Report cards */}
          {viewsMode === "landing" && (
            <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
              <button onClick={() => setViewsMode("structure")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a18 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#1a2f8a0d 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
                </div>
                <div className="relative z-10 flex flex-col h-full p-8">
                  <div className="mb-auto">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                      style={{ background: "linear-gradient(145deg, #1a2f8a 0%, #3b54b8 100%)" }}>
                      <Layers size={26} className="text-white" strokeWidth={1.8} />
                    </div>
<p className="font-black text-xl text-gray-800 mb-2">{T("views_structure_mappings")}</p>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{T("mappings_landing_structure_desc")}</p>
                  </div>
                </div>
              </button>

              <button onClick={() => setViewsMode("report")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#CF305D] flex flex-col"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)", boxShadow: "0 8px 32px -8px rgba(207,48,93,0.18)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, #CF305D18 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#CF305D0d 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
                </div>
                <div className="relative z-10 flex flex-col h-full p-8">
                  <div className="mb-auto">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                      style={{ background: "linear-gradient(145deg, #CF305D 0%, #e05585 100%)" }}>
                      <FileText size={26} className="text-white" strokeWidth={1.8} />
                    </div>
<p className="font-black text-xl text-gray-800 mb-2">{T("views_report_mappings")}</p>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{T("mappings_landing_report_desc")}</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Structure library */}
          {viewsMode === "structure" && (
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
              <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
<p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{T("views_library")}</p>
                <p className="font-black text-xs text-gray-700">{T("views_saved_mappings")}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {savedMappingsLoading && <div className="py-16 text-center"><Loader2 size={24} className="text-[#1a2f8a] animate-spin mx-auto mb-2" /><p className="text-gray-400 text-xs">{T("views_loading_mappings")}</p></div>}
                {savedMappingsError && !savedMappingsLoading && <div className="py-12 text-center"><p className="text-red-500 text-xs font-bold">{savedMappingsError}</p></div>}
                {!savedMappingsLoading && !savedMappingsError && savedMappings.length === 0 && <div className="py-16 text-center"><Library size={24} className="text-[#1a2f8a] mx-auto mb-2" /><p className="text-gray-700 font-black text-sm">{T("views_no_mappings")}</p></div>}
                {!savedMappingsLoading && !savedMappingsError && savedMappings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
{savedMappings.map(m => {
                      const isActive = activeMapping?.mapping_id === m.mapping_id;
                      return (
                        <button key={m.mapping_id}
                          onClick={async () => {
                            try {
                              const { getMapping } = await import("../../lib/mappingsApi");
                              const full = await getMapping(m.mapping_id);
                              handleApplyMapping(full ?? m, "structure");
                              setViewsMode(null);
                            } catch (err) {
                              console.error("[apply structure mapping]", err);
                            }
                          }}
                          className="text-left bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md group flex flex-col"
                          style={{ borderColor: isActive ? colors.primary : "#f3f4f6", background: isActive ? `${colors.primary}06` : "white" }}>
                          <div className="flex items-start gap-2.5 mb-3">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isActive ? colors.primary : "#eef1fb" }}>
                              <Layers size={14} style={{ color: isActive ? "white" : colors.primary }} />
                            </div>
                            <div className="flex-1 min-w-0">
<p className="font-black text-xs text-gray-800 truncate">{m.name ?? T("untitled")}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: colors.primary }}>{m.standard ?? "—"}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                            <span className="text-[9px] text-gray-400">{T("updated")} {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white"><CheckCircle2 size={9} />{T("btn_apply")}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Report library */}
          {viewsMode === "report" && (
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
              <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
<p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{T("views_library")}</p>
                <p className="font-black text-xs text-gray-700">{T("views_saved_report_mappings")}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
{reportMappingsLoading && <div className="py-16 text-center"><Loader2 size={24} className="text-[#CF305D] animate-spin mx-auto mb-2" /><p className="text-gray-400 text-xs">{T("views_loading_report_mappings")}</p></div>}
                {reportMappingsError && !reportMappingsLoading && <div className="py-12 text-center"><p className="text-red-500 text-xs font-bold">{reportMappingsError}</p></div>}
                {!reportMappingsLoading && !reportMappingsError && reportMappings.length === 0 && <div className="py-16 text-center"><FileText size={24} className="text-[#CF305D] mx-auto mb-2" /><p className="text-gray-700 font-black text-sm">{T("views_no_report_mappings")}</p></div>}
                {!reportMappingsLoading && !reportMappingsError && reportMappings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
{reportMappings.map(m => {
                      const isActive = activeMapping?.mapping_id === m.mapping_id;
                      return (
                        <button key={m.mapping_id}
                          onClick={async () => {
                            try {
                              const { getMapping } = await import("../../lib/reportMappingsApi");
                              const full = await getMapping(m.mapping_id);
                              handleApplyMapping(full ?? m, "report");
                              setViewsMode(null);
                            } catch (err) {
                              console.error("[apply report mapping]", err);
                            }
                          }}
                          className="text-left bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md group flex flex-col"
                          style={{ borderColor: isActive ? "#CF305D" : "#f3f4f6", background: isActive ? "#CF305D06" : "white" }}>
                          <div className="flex items-start gap-2.5 mb-3">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isActive ? "#CF305D" : "#fef1f5" }}>
                              <FileText size={14} style={{ color: isActive ? "white" : "#CF305D" }} />
                            </div>
                            <div className="flex-1 min-w-0">
<p className="font-black text-xs text-gray-800 truncate">{m.name ?? T("untitled")}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "#CF305D" }}>{m.standard ?? "—"}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                            <span className="text-[9px] text-gray-400">{T("updated")} {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white"><CheckCircle2 size={9} />{T("btn_apply")}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : !dimDashReady ? (
        <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
          style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
            style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
            <div className="relative" style={{ width: 140, height: 140 }}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                <circle cx="70" cy="70" r="60" fill="none"
                  stroke="url(#dimProgGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 60}
                  strokeDashoffset={2 * Math.PI * 60 * (1 - animatedDimProgress / 100)}
                  style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
                />
                <defs>
                  <linearGradient id="dimProgGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                    <stop offset="100%" stopColor={colors.secondary ?? "#CF305D"} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
                  {Math.round(animatedDimProgress)}<span className="text-base text-gray-300">%</span>
                </span>
              </div>
            </div>
<p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
              {!metaReady
                ? T("dim_loading_finding_period")
                : sources.length === 0 || structures.length === 0
                  ? T("dim_loading_filter_options")
                  : groupAccountsLocal.length === 0
                    ? T("dim_loading_group_accs")
                    : loading
                      ? T("dim_loading_data")
                      : T("dim_loading_finalizing")}
            </p>
            <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
              {T("dim_loading_setup")}
            </p>
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
<p className="text-sm font-bold text-gray-400">{T("no_data")}</p>
            <p className="text-xs text-gray-300 mt-1">{T("no_data_hint")}</p>
          </div>
        </div>
) : (
<PivotTab data={rawData} dimensions={dimensions} groupAccounts={groupAccountsLocal} onShowAccounts={() => setShowAccounts(true)} selGroups={selGroups} selDims={selDims} onSelGroupsChange={setSelGroups} onSelDimsChange={setSelDims} dimGroups={dimGroups}compareMode={compareMode} statementType={statementType} externalViewMode={statementType === "bs" ? "ytd" : (ytdOnly ? "ytd" : "monthly")} sources={sources} structures={structures} companies={companies} token={token} masterYear={year} masterMonth={month} masterSource={source} masterStructure={structure} masterCompany={company} kpiList={kpiList} ccTagToCodes={ccTagToCodes} resolveCcTag={resolveCcTag}plMapping={plMapping} bsMapping={bsMapping}
plLiteral={activeMapping?.plLiteral ?? null}
bsLiteral={activeMapping?.bsLiteral ?? null}
exportRef={pivotExportRef} hasCustomMapping={!!activeMapping} />

      )}



{exportModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", animation: "kBadgesPop 280ms cubic-bezier(0.34,1.56,0.64,1)" }}
          onClick={() => setExportModal(false)}>
          <div className="relative bg-white w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col"
            style={{ borderRadius: 28, boxShadow: `0 30px 80px -12px ${colors.primary}40, 0 12px 24px -6px rgba(0,0,0,0.12)` }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="relative px-7 pt-7 pb-5 flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)`, boxShadow: `0 8px 20px -6px ${colors.primary}60` }}>
                    <Download size={17} className="text-white" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-black text-[20px] tracking-tight" style={{ color: colors.primary, letterSpacing: "-0.02em" }}>{T("export_dimensions_title")}</p>
                    <div className="flex items-center gap-1.5 mt-1">
<span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                        style={{ background: `${colors.primary}10`, color: colors.primary }}>
                        {exportOpts.format === "pdf" ? T("badge_pdf") : T("badge_excel")}
                      </span>
                      {compareMode && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                          style={{ background: "#CF305D15", color: "#CF305D" }}>{T("badge_compare")}</span>
                      )}
                      {activeMapping && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                          style={{ background: "#10B98115", color: "#10B981" }}>{T("badge_mapped")}</span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => setExportModal(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-[1.05]"
                  style={{ background: "#f3f4f6", color: "#6b7280" }}>
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-6 no-scrollbar">

              {/* Statements */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_statements_to_include")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
["pl", T("tab_pl"),         T("export_pl_subtitle"), colors.primary],
                    ["bs", T("page_bs_full"),   T("export_bs_subtitle"), "#dc7533"],
                  ].map(([k, label, sub, accent]) => {
                    const checked = !!exportOpts.statements[k];
                    return (
                      <label key={k} className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${accent}40` : "#f3f4f6", background: checked ? `${accent}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, statements: { ...o.statements, [k]: !o.statements[k] } }))}>
                        <div className="w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? accent : "transparent", borderColor: checked ? accent : "#d1d5db" }}>
                          {checked && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-gray-800">{label}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Options */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                 <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_layout_options")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
["includeBreakers", T("export_opt_section_headers")],
                    ["drilldown",       T("export_opt_drilldown")],
                    ["includeTotals",   T("export_opt_row_totals")],
                    ["includeCompare",  T("export_opt_compare_columns")],
                  ].map(([k, label]) => {
                    const checked = !!exportOpts[k];
                    const disabled = (k === "includeCompare" && !compareMode) || (k === "includeTotals" && compareMode);
                    return (
                      <label key={k}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"}`}
                        style={{ borderColor: checked && !disabled ? `${colors.primary}40` : "#f3f4f6", background: checked && !disabled ? `${colors.primary}06` : "white" }}
                        onClick={() => { if (!disabled) setExportOpts(o => ({ ...o, [k]: !o[k] })); }}>
                        <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked && !disabled ? colors.primary : "transparent", borderColor: checked && !disabled ? colors.primary : "#d1d5db" }}>
                          {checked && !disabled && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                        </div>
                        <span className="text-xs font-bold text-gray-700">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Current filters preview */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_current_filters")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="rounded-xl p-4 text-xs text-gray-600 leading-relaxed space-y-0.5"
                  style={{ background: "#f8f9ff", border: "1px solid #e8eaf0" }}>
<div><span className="font-bold text-gray-500">{T("export_filter_period")}:</span> {month && year ? `${T(`month_${parseInt(month)}`)} ${year}` : "—"}</div>
                  <div><span className="font-bold text-gray-500">{T("export_filter_source_structure")}:</span> {source} · {structure}</div>
                  <div><span className="font-bold text-gray-500">{T("export_filter_company")}:</span> {company}</div>
                  <div><span className="font-bold text-gray-500">{T("export_filter_view")}:</span> {viewMode === "ytd" ? T("mode_ytd") : T("mode_monthly")}</div>
                  <div><span className="font-bold text-gray-500">{T("export_filter_dim_groups")}:</span> {selGroups.size > 0 ? [...selGroups].join(", ") : <span className="italic text-gray-400">{T("all")}</span>}</div>
                  <div><span className="font-bold text-gray-500">{T("export_filter_dims")}:</span> {selDims.size > 0 ? [...selDims].join(", ") : <span className="italic text-gray-400">{T("all")}</span>}</div>
                  <div><span className="font-bold text-gray-500">{T("export_filter_compare")}:</span> {compareMode ? T("export_compare_on") : <span className="italic text-gray-400">{T("export_compare_off")}</span>}</div>
                  {activeMapping && <div><span className="font-bold text-gray-500">{T("export_filter_mapping")}:</span> {activeMapping.name}</div>}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-7 py-5 flex items-center gap-3 flex-shrink-0"
              style={{ background: "linear-gradient(180deg, transparent 0%, #f9fafb 100%)" }}>
              <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}>
                {[["xlsx", T("export_excel")], ["pdf", T("export_pdf")]].map(([f, l]) => (
                  <button key={f} onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                    className="relative z-10 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-200"
                    style={{
                      background: exportOpts.format === f ? "white" : "transparent",
                      color: exportOpts.format === f ? colors.primary : "#9ca3af",
                      boxShadow: exportOpts.format === f ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                    }}>{l}</button>
                ))}
              </div>
              <button
                onClick={runExport}
                disabled={exporting || (!exportOpts.statements.pl && !exportOpts.statements.bs)}
                className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 100%)`,
                  color: "white",
                  boxShadow: `0 8px 20px -6px ${colors.primary}80, 0 2px 6px -2px ${colors.primary}40`,
                }}>
{exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} strokeWidth={2.5} />}
                {exporting ? T("export_downloading") : T("btn_download")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showAccounts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAccounts(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-[95vw] h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between flex-shrink-0">
              <p className="text-white font-black text-sm">{T("dim_uploaded_accounts")} · {rawData.length} {T("table_records")}</p>
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