/* ══════════════════════════════════════════════════════════════════════
   Dimensiones — código común de las dos páginas
     · DimensionesPage (individual)          → ../DimensionesPage.jsx
     · ConsolidatedDimensionesPage (consol.) → ../ConsolidatedDimensionesPage.jsx
   Aquí vive todo lo que era idéntico en ambas (utilidades, celdas de
   importe, filtros, pestaña de cuentas…) y las piezas del nuevo look:
   separadores de sección, comparativo animado, desglose por empresa y
   el cargador común.
   ══════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useContext } from "react";
import { ChevronDown, Search, X, Building2 } from "lucide-react";
import JSZip from "jszip";
import { useTypo, useSettings, useLocale } from "../../../components/layout/SettingsContext";
import { t } from "../../../lib/i18n";
import ProgressLoader from "../../../components/framework/ProgressLoader.jsx";
import dimCss from "./dimensions.module.css";

export { dimCss };

export function useAnimatedNumber(target, duration = 800) {
  const [display, setDisplay] = useState(0);
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

export function useCountUp(target, animate = true, duration = 900) {
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
export async function repairDimXlsx(buffer) {
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

export const DimAmountCell = React.memo(function DimAmountCell({ value, animate, typoStyle, borderLeft, bgColor, extraStyle, ccol }) {
  const target = value ?? 0;
  const v = useCountUp(target, !!animate, 900);
  const isEmpty = target === 0;
  const isNeg = v < 0;
  const fmt = (n) => Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // La columna TOTAL llega con position sticky + right 0
  const isTotal = extraStyle?.position === "sticky" && extraStyle?.right === 0;
  const style = { ...typoStyle, borderLeft: borderLeft ? "2px solid #f0f0f0" : undefined, ...extraStyle };
  if (ccol || isTotal) delete style.background; else if (bgColor) style.background = bgColor;
  if (isTotal) { delete style.borderLeft; }
  return (
    <td className={`px-4 py-2.5 text-center whitespace-nowrap tabular-nums ${dimCss.amt}`} style={style}
      data-ccol={ccol || undefined} data-tcol={isTotal ? "" : undefined}>
      <span className={`${dimCss.val} ${isEmpty ? dimCss.zero : isNeg ? dimCss.neg : ""}`}>
        {isEmpty ? "—" : isNeg ? `(${fmt(v)})` : fmt(v)}
      </span>
    </td>
  );
});

// Desviación en importe: píldora verde / roja suave según el signo
export const DimDiffCell = React.memo(function DimDiffCell({ value, animate, width, extraStyle }) {
  const target = value ?? 0;
  const v = useCountUp(target, !!animate, 900);
  const fmt = (n) => Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tone = target === 0 ? dimCss.zero : target > 0 ? dimCss.devUp : dimCss.devDown;
  return (
    <td className={`px-2 py-2.5 text-center whitespace-nowrap tabular-nums text-xs font-bold ${dimCss.amt}`} style={{ width, ...extraStyle }} data-ccol="d">
      <span className={`${dimCss.dev} ${tone}`}>{target === 0 ? "—" : v < 0 ? `(${fmt(v)})` : fmt(v)}</span>
    </td>
  );
});

// Desviación en %: mismo lenguaje que la de importe
export const DimPctCell = React.memo(function DimPctCell({ value, animate, width, extraStyle }) {
  const isNull = value === null || value === undefined;
  const target = isNull ? 0 : value;
  const v = useCountUp(target, !!animate, 900);
  const tone = isNull || target === 0 ? dimCss.zero : target > 0 ? dimCss.devUp : dimCss.devDown;
  return (
    <td className={`px-2 py-2.5 text-center whitespace-nowrap tabular-nums text-xs font-bold ${dimCss.amt}`} style={{ width, ...extraStyle }} data-ccol="p">
      <span className={`${dimCss.dev} ${dimCss.devPct} ${tone}`}>{isNull ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}</span>
    </td>
  );
});

export const BASE_URL = "";

// ════════════════════════════════════════════════════════════════════════════
// KPI RESOLVER — inline. Same logic used in KpiIndividualesPage. Loads cc_tag
// mapping for the active accounting standard from Supabase and builds a map
// of cc_tag → list of account codes that resolve to it via parent inheritance.
// This is what makes the same KPI definition work across PGC / Danish IFRS /
// Spanish IFRS-ES without per-standard formula overrides.
// ════════════════════════════════════════════════════════════════════════════

export const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";

export const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

export function detectStandard(groupAccounts) {
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

export const STANDARD_TO_PL_TABLE = {
  PGC: "pgc_pl_rows",
  DanishIFRS: "danish_ifrs_pl_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_pl_rows",
};


// Evaluator that understands cc/ref/op/fn/manual/text formula nodes.
// `pivot` here is a flat Map<accountCode, number> (for one specific dim col).
export function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, resolveCcTag) {
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
export const CC_TAG_SYNONYMS = {
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

export function normalizeLabel(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Walks pl_tree/bs_tree and returns Map<sectionLabel, [accountCodes]>
export function extractSectionsFromTree(tree) {
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
export function buildSavedMappingLiteral(tree) {
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

export const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" }, { value: 4, label: "April" },
  { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" }, { value: 12, label: "December" },
];

export const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

export const C = {
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
export function parseDimensions(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("||").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
  }).filter(Boolean);
}

export function parseAmt(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (!s || s === "—" || s === "-") return 0;
  if (/\d\.\d{3},\d/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (/,/.test(s) && /\./.test(s) && s.indexOf(",") < s.indexOf(".")) return parseFloat(s.replace(/,/g, "")) || 0;
  if (/,/.test(s) && !/\./.test(s)) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

export function pgcSort(a, b) {
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

export function FilterPill({ label, value, onChange, options }) {
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

export const INDENT = 14;

/* ── Accounts Tab ─────────────────────────────────────────── */
export function AccountsTab({ data }) {
  const locale = useLocale();
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

/* ══════════════════════════════════════════════════════════════════════
   Nuevo look — piezas compartidas
   ══════════════════════════════════════════════════════════════════════ */

// Ritmo común de las animaciones del comparativo
export const CMP_IN_MS = 460;
export const CMP_OUT_MS = 340;
const CMP_EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
const CMP_EASE_OUT_CSS = "cubic-bezier(0.4, 0, 0.2, 1)";
const cmpEase = (x) => 1 - Math.pow(1 - x, 3);
const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Textos propios del nuevo look (es / en / da)
const UI_TEXT = {
  es: {
    companies: "Empresas", subsidiaries: "Filiales",
    byCompany: "Desglose por empresa", bySubsidiary: "Contribución por filial",
    count: (n, kind) => `${n} ${kind === "sub" ? (n === 1 ? "filial" : "filiales") : (n === 1 ? "empresa" : "empresas")}`,
    loadingCo: "Buscando empresas…", loadingSub: "Buscando filiales…",
    period: "Periodo", filters: "Filtros", accounts: "Cuentas de grupo", data: "Datos",
    periodB: "Periodo B",
    months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    month: "Mes", pickMonths: "Elige meses", nMonths: (n) => `${n} ${n === 1 ? "mes" : "meses"}`,
    multiTitle: "Calculando el total", multiReading: (n) => `Leyendo ${n} cierres`, multiSumming: (n) => `Sumando ${n} meses`, multiOf: "Total de",
  },
  en: {
    companies: "Companies", subsidiaries: "Subsidiaries",
    byCompany: "Breakdown by company", bySubsidiary: "Contribution by subsidiary",
    count: (n, kind) => `${n} ${kind === "sub" ? (n === 1 ? "subsidiary" : "subsidiaries") : (n === 1 ? "company" : "companies")}`,
    loadingCo: "Looking up companies…", loadingSub: "Looking up subsidiaries…",
    period: "Period", filters: "Filters", accounts: "Group accounts", data: "Data",
    periodB: "Period B",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    month: "Month", pickMonths: "Pick months", nMonths: (n) => `${n} ${n === 1 ? "month" : "months"}`,
    multiTitle: "Calculating the total", multiReading: (n) => `Reading ${n} closes`, multiSumming: (n) => `Adding up ${n} months`, multiOf: "Total of",
  },
  da: {
    companies: "Selskaber", subsidiaries: "Datterselskaber",
    byCompany: "Fordeling pr. selskab", bySubsidiary: "Bidrag pr. datterselskab",
    count: (n, kind) => `${n} ${kind === "sub" ? "datterselskaber" : (n === 1 ? "selskab" : "selskaber")}`,
    loadingCo: "Henter selskaber…", loadingSub: "Henter datterselskaber…",
    period: "Periode", filters: "Filtre", accounts: "Koncernkonti", data: "Data",
    periodB: "Periode B",
    months: ["Januar", "Februar", "Marts", "April", "Maj", "Juni", "Juli", "August", "September", "Oktober", "November", "December"],
    month: "Måned", pickMonths: "Vælg måneder", nMonths: (n) => `${n} ${n === 1 ? "måned" : "måneder"}`,
    multiTitle: "Beregner totalen", multiReading: (n) => `Læser ${n} lukninger`, multiSumming: (n) => `Lægger ${n} måneder sammen`, multiOf: "Total af",
  },
};
export function useDimText() {
  const locale = useLocale();
  return UI_TEXT[locale] ?? UI_TEXT[String(locale ?? "").slice(0, 2)] ?? UI_TEXT.en;
}

// ── Separador de sección: barra con degradado que crece y brilla ─────────
export function DimBreakerRow({ label, color, span }) {
  return (
    <tr className={dimCss.bk}>
      <td colSpan={span} className={dimCss.bkCell}>
        <div className={dimCss.bkBar} style={{ "--sec": color || "#1a2f8a" }}>
          <span className={dimCss.bkTitle}>{label}</span>
        </div>
      </td>
    </tr>
  );
}

// ── Comparativo: panel del periodo B que se despliega con su altura real ─
// Un envoltorio mide el panel y anima su altura (y el hueco con la tabla),
// así la tabla se desliza sin saltos; al cerrar hace lo mismo al revés.
export function CmpReveal({ leaving = false, gap = 12, children }) {
  const ref = useRef(null);
  const enter = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function" || reducedMotion()) return undefined;
    const h = el.getBoundingClientRect().height;
    el.style.overflow = "hidden";
    const a = el.animate(
      [{ height: "0px", marginBottom: `-${gap}px` }, { height: `${h}px`, marginBottom: "0px" }],
      { duration: CMP_IN_MS, easing: CMP_EASE_CSS });
    const b = el.firstElementChild?.animate?.(
      [{ opacity: 0, transform: "translateY(-12px) scale(0.985)" }, { opacity: 1, transform: "none" }],
      { duration: CMP_IN_MS, delay: 40, easing: CMP_EASE_CSS, fill: "backwards" });
    a.onfinish = () => { el.style.overflow = ""; };
    enter.current = [a, b];
    return () => { a.cancel(); b?.cancel(); };
  }, [gap]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || !el || typeof el.animate !== "function") return undefined;
    const h = parseFloat(getComputedStyle(el).height) || el.getBoundingClientRect().height;
    enter.current?.forEach(x => x?.cancel());
    el.style.overflow = "hidden";
    const dur = reducedMotion() ? 1 : CMP_OUT_MS;
    const a = el.animate(
      [{ height: `${h}px`, marginBottom: "0px" }, { height: "0px", marginBottom: `-${gap}px` }],
      { duration: dur, easing: CMP_EASE_OUT_CSS, fill: "forwards" });
    const b = el.firstElementChild?.animate?.(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-8px) scale(0.985)" }],
      { duration: Math.round(dur * 0.7), easing: CMP_EASE_OUT_CSS, fill: "forwards" });
    return () => { a.cancel(); b?.cancel(); el.style.overflow = ""; };
  }, [leaving, gap]);
  return (
    <div ref={ref} data-cmp-reveal="" style={{ display: "flow-root", flex: "0 0 auto", position: "relative", zIndex: 10 }}>
      {children}
    </div>
  );
}

// Etiqueta del periodo B en el panel del comparativo
export function CmpPeriodTag() {
  const tx = useDimText();
  return (
    <span className={dimCss.cmpTag}>
      <i>B</i>
      <b>{tx.periodB}</b>
    </span>
  );
}

// ── Comparativo: la columna "Cuenta" se ajusta sin saltos ─────────────────
// Sin comparativo la tabla reparte el espacio sobrante y la columna de
// cuentas es más ancha; con comparativo vuelve a su ancho fijo. En vez de
// cambiar de golpe, se anima en las dos tablas (cabecera y cuerpo) a la
// vez que entran o salen las columnas del periodo B.
export function useDimAccSqueeze(colRefs, measureRef, open, visible, baseWidth) {
  const natural = useRef(null);
  const raf = useRef(0);
  const prev = useRef({ open, visible });
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = { open, visible };
    if (was.open === open && was.visible === visible) return;
    const cols = colRefs.map(r => r.current).filter(Boolean);
    if (!cols.length) return;
    const set = (w) => cols.forEach(c => { c.style.width = `${w}px`; c.style.minWidth = `${w}px`; });
    const current = () => cols[0].getBoundingClientRect().width || baseWidth;
    const animate = (from, to, dur) => {
      cancelAnimationFrame(raf.current);
      set(from);
      if (Math.abs(from - to) < 2 || reducedMotion()) { set(to); return; }
      let t0 = 0;
      const step = (now) => {
        if (!t0) t0 = now;
        const k = Math.min(1, (now - t0) / dur);
        set(from + (to - from) * cmpEase(k));
        if (k < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    };
    if (open && !was.visible) {
      // Entrada: desde el ancho que tenía hasta su ancho fijo
      if (natural.current) animate(natural.current, baseWidth, CMP_IN_MS);
    } else if (!open && was.open && visible) {
      // Salida: vuelve a su ancho a la vez que se van las columnas
      animate(current(), natural.current ?? baseWidth, CMP_OUT_MS);
    } else if (!visible && was.visible) {
      // Ya sin columnas extra: se suelta en su ancho de siempre (mismo tamaño)
      cancelAnimationFrame(raf.current);
      set(baseWidth);
    } else if (open && !was.open && visible) {
      // Se reabrió a mitad de la salida
      animate(current(), baseWidth, CMP_IN_MS);
    }
  });
  // Ancho "normal" de la columna mientras no hay comparativo
  useLayoutEffect(() => {
    if (visible) return;
    const w = measureRef.current?.getBoundingClientRect().width;
    if (w) natural.current = w;
  });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
}

// Clases de las tablas según el momento del comparativo
export function dimCmpTableClass({ entering, leaving, back }) {
  return [entering ? dimCss.cmpIn : "", leaving ? dimCss.cmpOut : "", back ? dimCss.totIn : ""].filter(Boolean).join(" ");
}

// ── Desglose por empresa ──────────────────────────────────────────────────
export const DIM_CO_TONES = ["#1a2f8a", "#0f9f6e", "#d97706", "#8b5cf6", "#0891b2", "#db2777", "#65a30d", "#ea580c"];
export const DRILL_OUT_MS = 240;

// Botón de cada cuenta (edificio). Aparece al pasar por la fila y, encendido,
// se queda marcado mientras el desglose está abierto.
export function dimDrillBtnClass(active) {
  return `${dimCss.drillBtn} ${active ? dimCss.drillBtnOn : ""}`;
}
export function DimDrillBtnInner({ kind = "co" }) {
  const tx = useDimText();
  return (
    <>
      <Building2 size={12} strokeWidth={2.3} />
      <span className={dimCss.drillBtnLabel}>{kind === "sub" ? tx.subsidiaries : tx.companies}</span>
    </>
  );
}

// Fila de cabecera del desglose: "Desglose por empresa · 3 empresas"
export function DimDrillHead({ span, count, kind = "co", pad = 40, leaving = false }) {
  const tx = useDimText();
  return (
    <tr className={`${dimCss.drillHead} ${leaving ? dimCss.drillOut : ""}`}>
      <td colSpan={span}>
        <div className={dimCss.drillHeadInner} style={{ paddingLeft: pad }}>
          <Building2 size={11} strokeWidth={2.4} />
          <b>{kind === "sub" ? tx.bySubsidiary : tx.byCompany}</b>
          {count != null ? <span className={dimCss.drillCount}>{tx.count(count, kind)}</span> : null}
        </div>
      </td>
    </tr>
  );
}

// Mientras llegan los datos: líneas que respiran en vez de un spinner
export function DimDrillLoading({ span, kind = "co", pad = 40, leaving = false, label }) {
  const tx = useDimText();
  return (
    <tr className={`${dimCss.drillLoad} ${leaving ? dimCss.drillOut : ""}`}>
      <td colSpan={span}>
        <div className={dimCss.drillLoadInner} style={{ paddingLeft: pad }}>
          <span className={dimCss.drillPulse}><i /><i /><i /></span>
          <b>{label || (kind === "sub" ? tx.loadingSub : tx.loadingCo)}</b>
          <span className={dimCss.drillSkel}><i /><i /><i /></span>
        </div>
      </td>
    </tr>
  );
}

export function DimDrillEmpty({ span, label, pad = 40, leaving = false }) {
  return (
    <tr className={`${dimCss.drillLoad} ${leaving ? dimCss.drillOut : ""}`}>
      <td colSpan={span}>
        <div className={dimCss.drillLoadInner} style={{ paddingLeft: pad }}>
          <Building2 size={11} strokeWidth={2.4} style={{ opacity: 0.5 }} />
          <span className={dimCss.drillEmpty}>{label}</span>
        </div>
      </td>
    </tr>
  );
}

// Clase de cada fila de empresa (entra en cascada; sale plegándose)
export function dimDrillRowClass(leaving) {
  return `${dimCss.drillRow} ${leaving ? dimCss.drillOut : ""}`;
}

// Lista de empresas (para poner la razón social cuando los datos solo traen el código)
export const DimCompaniesContext = React.createContext([]);
function legalNameOf(companies, co) {
  const m = (companies || []).find(c => (typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName) : c) === co);
  const n = m && typeof m === "object" ? (m.companyLegalName ?? m.CompanyLegalName ?? "") : "";
  return n && n !== co ? n : "";
}

// Primera celda de cada empresa: punto de color, código y razón social
export function DimCompanyCell({ co, name, index = 0, pad = 40 }) {
  const companies = useContext(DimCompaniesContext);
  const tone = DIM_CO_TONES[index % DIM_CO_TONES.length];
  const legal = name && name !== co ? name : legalNameOf(companies, co);
  return (
    <td className={`py-2 sticky left-0 z-10 ${dimCss.coCell}`} style={{ paddingLeft: pad, minWidth: 300, "--co-tone": tone }}>
      <div className={dimCss.coWrap} title={legal ? `${co} · ${legal}` : co}>
        <i className={dimCss.coDot} />
        <span className={dimCss.coCode}>{co}</span>
        {legal ? <span className={dimCss.coName}>{legal}</span> : null}
      </div>
    </td>
  );
}

// ── Cargador de la página (el mismo de la Home) ───────────────────────────
export function DimPageLoader({ title, subtitle, steps }) {
  const { colors } = useSettings();
  return (
    <div className="relative flex-1 min-h-0 rounded-2xl">
      <ProgressLoader
        className={dimCss.pageLoader}
        primary={colors?.primary ?? "#1a2f8a"}
        secondary={colors?.secondary ?? "#CF305D"}
        title={title}
        subtitle={subtitle}
        steps={steps}
      />
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   Multiperiodo (igual que en Individuales)
   periods: [{ year: "2026", months: [7, 8, 9] }, …]
   ══════════════════════════════════════════════════════════════════════ */

// ¿La selección suma más de un mes?
export function isMultiSelection(periods) {
  const withMonths = (periods || []).filter(p => p.months?.length);
  return withMonths.length > 1 || (withMonths.length === 1 && withMonths[0].months.length > 1);
}
// Clave estable de una selección (para saber si hay que recalcular)
export function periodsKey(periods) {
  return (periods || []).filter(p => p.months?.length)
    .map(p => `${p.year}:${[...p.months].sort((a, b) => a - b).join(",")}`).join("|");
}
// Meses → tramos contiguos: [1,2,3,7,8] → [[1,2,3],[7,8]]
function splitContiguous(months) {
  const ms = [...new Set((months || []).map(Number))].sort((a, b) => a - b);
  const runs = [];
  let run = [];
  ms.forEach(m => {
    if (run.length && m === run[run.length - 1] + 1) run.push(m);
    else { if (run.length) runs.push(run); run = [m]; }
  });
  if (run.length) runs.push(run);
  return runs;
}

// Cuántos cierres hay que leer para una selección (meses frontera de cada tramo)
function closesNeeded(periods) {
  const need = new Set();
  (periods || []).forEach(p => splitContiguous(p.months).forEach(run => {
    need.add(`${p.year}-${run[run.length - 1]}`);
    if (run[0] > 1) need.add(`${p.year}-${run[0] - 1}`);
  }));
  return need.size;
}

// Suma de los periodos elegidos a partir de los YTD de cada cierre.
// Para un tramo contiguo [a..b] el total es YTD(b) − YTD(a−1), así solo se
// leen los meses frontera. Cada fila conserva su cuenta, cuenta local,
// dimensiones y empresa: la tabla de dimensiones la trata como un mes más.
// fetchMonth(year, month) → Promise<rows[]>; onProgress(done, total) opcional.
export async function sumPeriodRows(periods, fetchMonth, onProgress) {
  const need = new Map();
  const plan = [];
  (periods || []).forEach(p => {
    splitContiguous(p.months).forEach(run => {
      const first = run[0], last = run[run.length - 1];
      const addKey = `${p.year}-${last}`;
      const subKey = first > 1 ? `${p.year}-${first - 1}` : null;
      need.set(addKey, { year: p.year, month: last });
      if (subKey) need.set(subKey, { year: p.year, month: first - 1 });
      plan.push({ addKey, subKey });
    });
  });
  const entries = [...need.values()];
  let done = 0;
  const results = await Promise.all(entries.map(e => Promise.resolve(fetchMonth(e.year, e.month))
    .then(r => { done += 1; onProgress?.(done, entries.length); return Array.isArray(r) ? r : []; })));
  const keyOf = (r) => [
    r.AccountCode ?? r.accountCode ?? "",
    r.LocalAccountCode ?? r.localAccountCode ?? "",
    r.Dimensions ?? r.dimensions ?? "",
    r.CompanyShortName ?? r.companyShortName ?? "",
    r.CompanyRole ?? r.companyRole ?? "",
    r.AccountType ?? r.accountType ?? "",
  ].join("\u0000");
  const ytdBy = new Map();
  entries.forEach((e, i) => {
    const m = new Map();
    results[i].forEach(r => {
      const k = keyOf(r);
      const v = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      if (m.has(k)) m.get(k).ytd += v; else m.set(k, { row: r, ytd: v });
    });
    ytdBy.set(`${e.year}-${e.month}`, m);
  });
  const acc = new Map();
  plan.forEach(({ addKey, subKey }) => {
    const add = ytdBy.get(addKey) ?? new Map();
    const sub = subKey ? (ytdBy.get(subKey) ?? new Map()) : new Map();
    add.forEach((en, k) => {
      if (!acc.has(k)) acc.set(k, { row: en.row, amount: 0 });
      acc.get(k).amount += en.ytd - (sub.get(k)?.ytd ?? 0);
    });
    // Líneas que existían en el mes anterior al tramo y ya no: se restan
    sub.forEach((en, k) => {
      if (add.has(k)) return;
      if (!acc.has(k)) acc.set(k, { row: en.row, amount: 0 });
      acc.get(k).amount -= en.ytd;
    });
  });
  return [...acc.values()].map(({ row, amount }) => ({
    ...row, AmountYTD: amount, amountYTD: amount, AmountPeriod: amount, amountPeriod: amount,
  }));
}

// Selector "Mes": varios meses por año (los años se eligen en el filtro Año)
export function DimMonthsPill({ periods, singleYear, singleMonth, onChange }) {
  const { colors } = useSettings();
  const tx = useDimText();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const primary = colors?.primary ?? "#1a2f8a";
  // Sin selección múltiple todavía: el año y mes actuales son el punto de partida
  const effPeriods = periods.length > 0
    ? periods
    : (singleYear ? [{ year: String(singleYear), months: singleMonth ? [Number(singleMonth)] : [] }] : []);
  const toggleMonth = (year, mo) => onChange(effPeriods.map(p => {
    if (p.year !== year) return p;
    const has = p.months.includes(mo);
    return { ...p, months: has ? p.months.filter(m => m !== mo) : [...p.months, mo].sort((a, b) => a - b) };
  }));
  const setYearMonths = (year, months) => onChange(effPeriods.map(p => (p.year === year ? { ...p, months } : p)));
  const withMonths = effPeriods.filter(p => p.months?.length);
  const total = withMonths.reduce((n, p) => n + p.months.length, 0);
  const label = effPeriods.length
    ? (total === 0 ? tx.pickMonths : total === 1 ? (tx.months[withMonths[0].months[0] - 1] ?? tx.nMonths(1)) : tx.nMonths(total))
    : (singleMonth ? (tx.months[Number(singleMonth) - 1] ?? tx.month) : tx.month);
  const showLabel = hover || open;
  const box = (on) => (
    <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: on ? primary : "#fff", borderColor: on ? primary : "#d4d4d8" }}>
      {on && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );
  return (
    <div ref={ref} className="relative flex-shrink-0" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 rounded-xl select-none overflow-hidden"
        style={{ padding: "8px 12px", background: open || hover ? `${primary}0F` : "transparent", transition: "background 220ms cubic-bezier(0.4,0,0.2,1)", lineHeight: 1 }}>
        <span className="inline-flex items-center overflow-hidden whitespace-nowrap"
          style={{ maxWidth: showLabel ? 100 : 0, opacity: showLabel ? 1 : 0, transition: "max-width 280ms cubic-bezier(0.4,0,0.2,1), opacity 220ms" }}>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none pr-2" style={{ color: primary, opacity: 0.55 }}>{tx.month}</span>
        </span>
        <span className="truncate text-[13px] font-bold" style={{ color: primary, maxWidth: 140 }}>{label}</span>
        <ChevronDown size={11} style={{ color: primary, opacity: 0.4, transform: open ? "rotate(180deg)" : "none", transition: "transform 280ms" }} />
      </button>
      {open && (
        <div className={`absolute z-[9999] mt-2 left-0 w-[190px] rounded-2xl overflow-hidden ${dimCss.monthsMenu}`}>
          <div className="p-1.5 max-h-72 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {effPeriods.map((p, pi) => {
              const allOn = p.months.length === 12;
              return (
                <div key={p.year} className={pi > 0 ? "mt-1 pt-1 border-t border-gray-100" : ""}>
                  <button onClick={() => setYearMonths(p.year, allOn ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-3 ${dimCss.monthsItem}`}
                    style={{ color: primary }}>
                    {box(allOn)}{p.year}
                  </button>
                  {tx.months.map((lbl, i) => {
                    const mo = i + 1;
                    const on = p.months.includes(mo);
                    return (
                      <button key={mo} onClick={() => toggleMonth(p.year, mo)}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-3 ${dimCss.monthsItem}`}
                        style={{ color: "#475569" }}>
                        {box(on)}<span>{lbl}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// [{year, months}] → líneas por año ("Ene–Mar, Jul") y nº de meses
function describePeriods(periods, monthNames) {
  const short = (m) => (monthNames[Number(m) - 1] ?? String(m)).slice(0, 3);
  let count = 0;
  const lines = (periods || []).filter(p => p.months?.length).map(p => {
    const runs = splitContiguous(p.months);
    count += runs.reduce((n, r) => n + r.length, 0);
    return { year: String(p.year), text: runs.map(r => (r.length === 1 ? short(r[0]) : `${short(r[0])}–${short(r[r.length - 1])}`)).join(", ") };
  });
  return { lines, count };
}

// Qué se está sumando, junto al título de la columna "Cuenta"
export function DimMultiBadge({ periods }) {
  const tx = useDimText();
  const { lines, count } = describePeriods(periods, tx.months);
  if (!count) return null;
  const full = lines.map(l => `${l.year}: ${l.text}`).join("\n");
  return (
    <span className={dimCss.multiBadge} title={`${tx.multiOf} ${tx.nMonths(count)}\n${full}`}>
      <span className={dimCss.multiCount}>{tx.nMonths(count)}</span>
      {lines.slice(0, 2).map(l => <span key={l.year} className={dimCss.multiLine}><b>{l.year}</b>{l.text}</span>)}
      {lines.length > 2 ? <span className={dimCss.multiMore}>+{lines.length - 2}</span> : null}
    </span>
  );
}

// Mientras se calcula el total: la tabla se queda detrás, atenuada
export function DimMultiLoader({ periods, progress }) {
  const tx = useDimText();
  const { colors } = useSettings();
  const { lines, count } = describePeriods(periods, tx.months);
  const total = progress?.total || closesNeeded(periods);
  const done = Math.min(progress?.done ?? 0, total);
  const fetched = total > 0 && done >= total;
  return (
    <ProgressLoader
      className={dimCss.multiLoader}
      primary={colors?.primary ?? "#1a2f8a"}
      secondary={colors?.secondary ?? "#CF305D"}
      title={tx.multiTitle}
      subtitle={lines.map(l => `${l.year} · ${l.text}`).join("   ")}
      steps={[
        { key: "read", label: tx.multiReading(total || "…"), weight: 8, state: fetched ? "done" : "active", progress: total ? done / total : 0 },
        { key: "sum", label: tx.multiSumming(count), weight: 2, state: fetched ? "active" : "pending" },
      ]}
    />
  );
}