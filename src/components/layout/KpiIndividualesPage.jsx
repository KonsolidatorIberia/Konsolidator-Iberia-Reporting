import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTypo, useSettings } from "./SettingsContext";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";
import { createRoot } from "react-dom/client";

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

function AnimatedCell({ value, format, baseStyle }) {
  const isNum = value !== null && value !== undefined && !isNaN(value) && isFinite(value);
  const animated = useAnimatedNumber(isNum ? value : 0);
  if (!isNum) return <span style={{ ...baseStyle, color: "#D1D5DB" }}>—</span>;
  return <span style={{ ...baseStyle, color: value < 0 ? "#EF4444" : "#000000" }}>{fmtValue(animated, format)}</span>;
}

// ════════════════════════════════════════════════════════════════════════════
// KPI RESOLVER (inline) — was previously KpiResolver.js
// Loads KPI library + cc_tag mapping for the active accounting standard from
// Supabase and exposes a formula evaluator that understands cc / section nodes.
//
// SIGN CONVENTION: this resolver does NOT flip signs. Pivot values are used
// raw — Revenue arrives positive, costs/expenses arrive negative.
// Net Result = sum of all P&L cc nodes (no manual negation).
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

// Default KPIs shown on first load. The full library stays in Supabase so
// formulas like net_result -> ebt -> ebit -> ebitda can still resolve via refs.
const DEFAULT_VISIBLE_KPI_IDS = new Set([
  "revenue",
  "gross_profit",
  "net_result",
  "net_margin",
]);
const SB_HEADERS = {
  apikey:        SUPABASE_APIKEY,
  Authorization: `Bearer ${SUPABASE_APIKEY}`,
};
const sbGet = (path) =>
  fetch(`${SUPABASE_URL}/${path}`, { headers: SB_HEADERS }).then(r => r.json());

function detectStandard(groupAccounts) {
  if (!groupAccounts?.length) {
    console.log("[KpiResolver] detectStandard: no groupAccounts");
    return null;
  }

  // Inspect BOTH accountCode and parentCode — the standard markers (.S, .PL,
  // alpha codes like "A.01") often live in the parent column, not the leaf.
  const codes = [];
  groupAccounts.forEach(n => {
    const ac = String(n.accountCode ?? n.AccountCode ?? "");
    const pc = String(n.parentCode  ?? n.ParentCode  ?? "");
    if (ac) codes.push(ac);
    if (pc) codes.push(pc);
  });

  if (codes.length === 0) return null;

  // PGC: presence of a code ending in ".S" anywhere in the chart of accounts
  const isPGC = codes.some(c => c.endsWith(".S"));

  // Spanish IFRS-ES: presence of ".PL" suffix
  const isSpanishIfrsEs = !isPGC && codes.some(c => c.endsWith(".PL"));

  // Spanish IFRS (classic): alpha codes like "A.01", "B.12" — but NOT PGC/ES variants
  const isSpanishIFRS = !isPGC && !isSpanishIfrsEs &&
                        codes.some(c => /^[A-Z]\.\d/.test(c));

  // Danish IFRS: pure-numeric 5-6 digit codes
  const isDanishIFRS = !isPGC && !isSpanishIfrsEs && !isSpanishIFRS &&
                       codes.some(c => /^\d{5,6}$/.test(c));

  let standard = null;
  if      (isPGC)           standard = "PGC";
  else if (isSpanishIfrsEs) standard = "SpanishIFRS-ES";
  else if (isSpanishIFRS)   standard = "SpanishIFRS";
  else if (isDanishIFRS)    standard = "DanishIFRS";

  console.log("[KpiResolver] detectStandard:", {
    standard,
    sampleCodes: codes.slice(0, 10),
    flags: { isPGC, isSpanishIfrsEs, isSpanishIFRS, isDanishIFRS },
  });

  return standard;
}

const STANDARD_TO_TABLE = {
  PGC:               { pl: "pgc_pl_rows",             bs: "pgc_bs_rows" },
  DanishIFRS:        { pl: "danish_ifrs_pl_rows",     bs: "danish_ifrs_bs_rows" },
  "SpanishIFRS-ES":  { pl: "spanish_ifrs_es_pl_rows", bs: "spanish_ifrs_es_bs_rows" },
};
const STANDARD_TO_PL_TABLE = {
  PGC: "pgc_pl_rows",
  DanishIFRS: "danish_ifrs_pl_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_pl_rows",
};

const STANDARD_TO_BS_TABLE = {
  PGC: "pgc_bs_rows",
  DanishIFRS: "danish_ifrs_bs_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_bs_rows",
};

async function loadStandardMapping(standard, groupAccounts) {
  const plTable = STANDARD_TO_PL_TABLE[standard];
  const bsTable = STANDARD_TO_BS_TABLE[standard];
  if (!plTable) return null;

  // Fetch BOTH tables in parallel
const [plRows, bsRows] = await Promise.all([
    sbGet(`${plTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`),
    sbGet(`${bsTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`).catch(() => []),
  ]);
  const allRows = [...(Array.isArray(plRows) ? plRows : []), ...(Array.isArray(bsRows) ? bsRows : [])];

  // STEP 1: build codeCcTag and codeSection from taxonomy (ignore is_sum filter)
  const codeCcTag = new Map();
  const codeSection = new Map();
  for (const r of allRows) {
    if (r.cc_tag) codeCcTag.set(String(r.account_code), r.cc_tag);
    if (r.section_code) codeSection.set(String(r.account_code), r.section_code);
  }

  // STEP 2: build parentOf from groupAccounts (climb SumAccountCode chain)
  const parentOf = new Map();
  for (const ga of (groupAccounts || [])) {
    if (ga.AccountCode && ga.SumAccountCode) {
      parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
    }
  }

  // STEP 3: invert into ccTagToCodes and sectionCodes
  const ccTagToCodes = new Map();
  const sectionCodes = new Map();
  let taggedCount = 0;
  const totalAccounts = (groupAccounts || []).length;

  for (const ga of (groupAccounts || [])) {
    const code = String(ga.AccountCode);
    let cur = code;
    let hops = 0;
    let foundTag = null;
    let foundSection = null;
    while (cur && hops < 25) {
      if (codeCcTag.has(cur) && !foundTag) foundTag = codeCcTag.get(cur);
      if (codeSection.has(cur) && !foundSection) foundSection = codeSection.get(cur);
      if (foundTag && foundSection) break;
      cur = parentOf.get(cur);
      hops++;
    }
    if (foundTag) {
      taggedCount++;
      if (!ccTagToCodes.has(foundTag)) ccTagToCodes.set(foundTag, []);
      ccTagToCodes.get(foundTag).push(code);
      if (foundSection) {
        const key = `${foundTag}::${foundSection}`;
        if (!sectionCodes.has(key)) sectionCodes.set(key, []);
        sectionCodes.get(key).push(code);
      }
    }
  }

  console.log(`[KpiResolver] ${standard} mapping loaded: ${ccTagToCodes.size} cc_tags, ${sectionCodes.size} sections, ${taggedCount}/${totalAccounts} accounts tagged via inheritance`);

  return { ccTagToCodes, sectionCodes };
}
async function loadKpiLibrary(standard) {
  const [defs, overrides] = await Promise.all([
    sbGet("kpi_definitions?select=*&order=sort_order.asc"),
    standard
      ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}`)
      : Promise.resolve([]),
  ]);

  if (!Array.isArray(defs)) {
    console.error("[KpiResolver] kpi_definitions returned non-array:", defs);
    return [];
  }

  const overrideByKpi = new Map();
  if (Array.isArray(overrides)) {
    overrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  }

  console.log(`[KpiResolver] loaded ${defs.length} KPI definitions`);

  return defs.map(d => ({
    id:          d.id,
    label:       d.label,
    description: d.description ?? "",
    category:    d.category ?? "",
    format:      d.format ?? "currency",
    tag:         d.tag ?? "",
    benchmark:   d.benchmark ?? null,
    formula:     overrideByKpi.get(d.id) ?? d.formula,
  }));
}

function useResolvedKpiList(groupAccounts) {
  const standard = useMemo(() => detectStandard(groupAccounts), [groupAccounts]);

  const [state, setState] = useState({
    kpiList:      [],
    allKpis:      [],
    ccTagToCodes: new Map(),
    sectionCodes: new Map(),
    standard:     null,
    ready:        false,
    error:        null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!standard) {
      setState(s => ({ ...s, ready: true, kpiList: [], standard: null }));
      return;
    }
    setState(s => ({ ...s, ready: false, error: null }));

    Promise.all([loadStandardMapping(standard, groupAccounts), loadKpiLibrary(standard)])
      .then(([{ ccTagToCodes, sectionCodes }, fullKpiList]) => {
        if (cancelled) return;
        // Only show the 4 default KPIs in the table, but keep the rest in
        // `allKpis` so ref-based formulas (e.g. net_result → ebt → ebit) resolve.
        const visibleKpis = fullKpiList.filter(k => DEFAULT_VISIBLE_KPI_IDS.has(k.id));
        setState({
          kpiList:       visibleKpis,
          allKpis:       fullKpiList,    // for resolving refs internally
          ccTagToCodes,
          sectionCodes,
          standard,
          ready:         true,
          error:         null,
        });
      })
      .catch(e => {
        if (cancelled) return;
        console.error("[KpiResolver] load failed:", e);
        setState(s => ({ ...s, ready: true, error: String(e?.message ?? e) }));
      });

return () => { cancelled = true; };
  }, [standard, groupAccounts]);

  return state;
}

function pivotSum(pivot, codes) {
  if (!codes || codes.size === 0) return 0;
  let total = 0;
  codes.forEach(code => { total += (pivot.get(code) ?? 0); });
  return total;
}

function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;

  switch (node.type) {
case "account": {
      if (node.dimGroup || node.dimCode) {
        if (pivot.__dimPivot) {
          const key = `${node.accountCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
          return -(pivot.__dimPivot.get(key) ?? 0);
        }
      }
      let total = 0;
      pivot.forEach((val, ac) => { if (ac === node.accountCode) total += val; });
      return -total;
    }
    case "accountGroup": {
      let total = 0;
      pivot.forEach((val, ac) => { if (node.prefix && ac.startsWith(node.prefix)) total += val; });
      return -total;
    }
    case "manual": return Number(node.value) || 0;
    case "op": {
      const l = evalFormulaWithCcTags(node.left,  pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      const r = evalFormulaWithCcTags(node.right, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? null : l / r;
      return 0;
    }
    case "fn": {
      const a = evalFormulaWithCcTags(node.arg, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
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
      const val = evalFormulaWithCcTags(ref.formula, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      cache.set(node.kpiId, val);
      return val;
    }
    case "text": {
      if (!node.expression || !node.variables) return 0;
      try {
        let expr = node.expression;
        Object.entries(node.variables).forEach(([letter, varNode]) => {
          const v = varNode ? evalFormulaWithCcTags(varNode, pivot, cache, kpiList, ccTagToCodes, sectionCodes) : 0;
          expr = expr.replaceAll(letter, `(${v ?? 0})`);
        });
        return Function(`"use strict"; return (${expr})`)() ?? 0;
      } catch { return null; }
    }
case "cc": {
      const codes = ccTagToCodes.get(node.tag);
      if (!codes) {
        if (node.tag?.startsWith("BS_")) {
          console.log(`[evalFormula] cc tag NOT FOUND: ${node.tag}`);
        }
        return 0;
      }
      const result = -pivotSum(pivot, codes);
      if (node.tag?.startsWith("BS_")) {
        console.log(`[evalFormula] cc tag ${node.tag}: codes=${codes.length}, sum=${result}`);
      }
      return result;
    }
    case "section": {
      const key = `${node.statement}::${node.section}`;
      const codes = sectionCodes.get(key);
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
    default: return 0;
  }
}

function computeAllKpisResolved(visibleKpis, pivot, ccTagToCodes, sectionCodes, allKpis = null) {
  // Use the full list for ref lookups so chained refs still resolve when only
  // a subset of KPIs is visible. Falls back to visibleKpis if no full list given.
  const refList = allKpis ?? visibleKpis;
  const cache = new Map();
  visibleKpis.forEach(kpi => {
    if (!cache.has(kpi.id)) {
      const val = evalFormulaWithCcTags(kpi.formula, pivot, cache, refList, ccTagToCodes, sectionCodes);
      cache.set(kpi.id, val);
    }
  });
  return cache;
}
// ════════════════════════════════════════════════════════════════════════════
// END KPI RESOLVER
// ════════════════════════════════════════════════════════════════════════════
import {
  ChevronDown, Loader2, X, Plus, Trash2, Edit3,
  GripVertical, Hash, Percent, DollarSign,
  Check, Sigma, BarChart3, Building2, Layers,
  GitCompareArrows, Library, Download,
  CheckCircle2, AlertTriangle, Search,
} from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill, MultiFilterPill } from "./PageHeader.jsx";

import {
  listCompanyKpis, createCompanyKpi, updateCompanyKpi, archiveCompanyKpi, deleteCompanyKpi,
  getUserDashboard, saveUserDashboard,
} from "../../lib/kpisApi";
import { getActiveCompanyId } from "../../lib/mappingsApi";
import { supabase } from "../../lib/supabaseClient";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";

function ExcelLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#107C41"/>
      <path d="M19 4v8h8" fill="#0B5E30"/>
      <path d="M14.5 15.5 17 19l-2.5 3.5h1.8L18 20.1l1.7 2.4h1.8L19 19l2.5-3.5h-1.8L18 17.9l-1.7-2.4z" fill="#FFFFFF"/>
    </svg>
  );
}

function PdfLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#D93025"/>
      <path d="M19 4v8h8" fill="#A1271B"/>
      <text x="9" y="23" fill="#FFFFFF" fontSize="7" fontWeight="700" fontFamily="Arial, sans-serif">PDF</text>
    </svg>
  );
}

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

// ── Formula node types ────────────────────────────────────────────────────────
// { type: "account",      accountCode, dimCode? }
// { type: "accountGroup", prefix }
// { type: "manual",       value }
// { type: "op",           op: "+"|"-"|"*"|"/", left, right }
// { type: "fn",           fn: "abs"|"neg"|"pct", arg }
// { type: "ref",          kpiId }

function makeId() { return Math.random().toString(36).slice(2, 10); }



// ── Formula evaluator ─────────────────────────────────────────────────────────
function evalFormula(node, pivot, cache, kpiList) {
  if (!node) return 0;
  switch (node.type) {
case "account": {
      if (node.dimGroup || node.dimCode) {
        if (pivot.__dimPivot) {
          const key = `${node.accountCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
          return -(pivot.__dimPivot.get(key) ?? 0);
        }
      }
      let total = 0;
      pivot.forEach((val, ac) => { if (ac === node.accountCode) total += val; });
      return -total;
    }
    case "accountGroup": {
      let total = 0;
      pivot.forEach((val, ac) => { if (node.prefix && ac.startsWith(node.prefix)) total += val; });
      return -total;
    }
    case "manual": return Number(node.value) || 0;
    case "op": {
      const l = evalFormula(node.left, pivot, cache, kpiList);
      const r = evalFormula(node.right, pivot, cache, kpiList);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? null : l / r;
      return 0;
    }
    case "fn": {
      const a = evalFormula(node.arg, pivot, cache, kpiList);
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
      const val = evalFormula(ref.formula, pivot, cache, kpiList);
      cache.set(node.kpiId, val);
      return val;
    }
case "text": {
      if (!node.expression || !node.variables) return 0;
      try {
        let expr = node.expression;
        Object.entries(node.variables).forEach(([letter, varNode]) => {
          const val = varNode ? evalFormula(varNode, pivot, cache, kpiList) : 0;
          expr = expr.replaceAll(letter, `(${val ?? 0})`);
        });
return Function(`"use strict"; return (${expr})`)() ?? 0;
      } catch { return null; }
    }
    default: return 0;
  }
}

function computeAllKpis(kpiList, pivot) {
  const cache = new Map();
  kpiList.forEach(kpi => {
    if (!cache.has(kpi.id)) {
      const val = evalFormula(kpi.formula, pivot, cache, kpiList);
      cache.set(kpi.id, val);
    }
  });
  return cache;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtValue(val, format) {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return "—";
  if (format === "percent") return val.toFixed(1) + "%";
  if (format === "currency") return val.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return val.toFixed(2);
}

function getBenchmarkColor(value, benchmark) {
if (!benchmark || value === null || value === undefined || isNaN(value) || !isFinite(value)) return null;
  const check = (range) => {
    if (!range) return false;
    const min = range.min !== "" && range.min !== undefined ? parseFloat(range.min) : null;
    const max = range.max !== "" && range.max !== undefined ? parseFloat(range.max) : null;
    if (min !== null && max !== null) return value > min && value < max;
    if (min !== null) return value > min;
    if (max !== null) return value < max;
    return false;
  };
  if (check(benchmark.vhealthy)) return {
    bg: "linear-gradient(90deg, rgba(26,47,138,0.08) 0%, rgba(26,47,138,0.03) 60%, transparent 100%)",
    border: "rgba(26,47,138,0.25)",
    text: "#1a2f8a",
  };
  if (check(benchmark.healthy)) return {
    bg: "linear-gradient(90deg, rgba(22,163,74,0.10) 0%, rgba(22,163,74,0.04) 60%, transparent 100%)",
    border: "rgba(22,163,74,0.35)",
    text: "#16a34a",
  };
  if (check(benchmark.unhealthy)) return {
    bg: "linear-gradient(90deg, rgba(220,38,38,0.08) 0%, rgba(220,38,38,0.03) 60%, transparent 100%)",
    border: "rgba(220,38,38,0.25)",
    text: "#dc2626",
  };
  return null;
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

// ── Mapping → KPI override helpers ────────────────────────────────────────────
// When a user applies a custom mapping, we re-bind known cc_tags (revenue,
// ebitda, etc.) to the account codes the user has grouped under each mapping
// section. Matching is fuzzy by label — more specific terms first because the
// first match wins (so "Gastos de personal" doesn't collide with the generic
// "Gastos operativos" bucket).
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
  // General last — these are broad and would over-match if placed before
  // the specific entries above.
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

// Walks a saved mapping pl_tree / bs_tree and extracts { sectionLabel → [accountCodes] }.
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

// ── Export helpers ────────────────────────────────────────────────────────────
const EXPORT_COLORS = {
  primary:    "FF1A2F8A",
  primaryDk:  "FF1A2B6B",
  highlight:  "FFEEF1FB",
  compareB:   "FFCF305D",
  compareC:   "FF57AA78",
  band1:      "FFFFFFFF",
  band2:      "FFF8F9FF",
  band3:      "FFFAFBFF",
  finalGray:  "FF374151",
  white:      "FFFFFFFF",
  gray400:    "FF9CA3AF",
  gray500:    "FF6B7280",
  green:      "FF059669",
  red:        "FFDC2626",
};

function monthLabel(m) {
  const n = parseInt(m);
  return isNaN(n) ? String(m) : (MONTHS[n - 1]?.label ?? String(m));
}

function buildFilterString(f) {
  const parts = [];
  if (f.source) parts.push(f.source);
  if (f.structure) parts.push(f.structure);
  if (f.year && f.month) parts.push(`${monthLabel(f.month)} ${f.year}`);
  if (f.dimGroup) parts.push(`Dim Group: ${f.dimGroup}`);
  if (f.dim) parts.push(`Dim: ${f.dim}`);
  return parts.join(" · ");
}

async function exportKpisToXlsx({
  kpiList, companyCodes, companyResults,
  dimensionCodes, dimensionResults, dimensionPivots,
  graphSections, filters,
}) {
  const C = EXPORT_COLORS;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Konsolidator";
  wb.created = new Date();

  const addKpiMatrixSheet = (sheetName, titleText, cols, colLabels, resultsMap) => {
    const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const totalCols = 2 + cols.length;

    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = titleText;
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 28;

    ws.mergeCells(2, 1, 2, totalCols);
    const filtCell = ws.getCell(2, 1);
    filtCell.value = buildFilterString(filters) || "—";
    filtCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    filtCell.font = { name: "Calibri", size: 10, color: { argb: C.white } };
    filtCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(2).height = 18;

    ws.getRow(3).height = 6;

    const headerRow = ws.getRow(4);
    headerRow.height = 24;
    const headerCells = ["KPI", ...colLabels, "Total / Avg"];
    headerCells.forEach((label, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = label;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
    });

    kpiList.forEach((kpi, rowIdx) => {
      const rowNum = 5 + rowIdx;
      const bandColor = rowIdx % 2 === 0 ? C.band1 : C.band2;

      const values = cols.map(col => {
        const res = resultsMap.get(col);
        if (!res) return null;
        const v = res.get(kpi.id);
        return (v === undefined || v === null || isNaN(v)) ? null : v;
      });
      const validVals = values.filter(v => v !== null);
      const aggregate = validVals.length === 0 ? null
        : kpi.format === "percent"
          ? validVals.reduce((a, b) => a + b, 0) / validVals.length
          : validVals.reduce((a, b) => a + b, 0);

      const labelCell = ws.getCell(rowNum, 1);
      labelCell.value = kpi.label + (kpi.description ? `\n${kpi.description}` : "");
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bandColor } };
      labelCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.primary } };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
      labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

      values.forEach((val, i) => {
        const cell = ws.getCell(rowNum, 2 + i);
        if (val === null) {
          cell.value = "—";
          cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 } };
        } else {
          cell.value = val;
          cell.numFmt = kpi.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
          cell.font = {
            name: "Calibri", size: 10,
            color: { argb: val < 0 ? C.red : (kpi.format === "percent" && val >= 0 ? C.green : C.primary) },
          };
        }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bandColor } };
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      });

      const aggCell = ws.getCell(rowNum, 2 + cols.length);
      if (aggregate === null) {
        aggCell.value = "—";
        aggCell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: true };
      } else {
        aggCell.value = aggregate;
        aggCell.numFmt = kpi.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
        aggCell.font = {
          name: "Calibri", size: 10, bold: true,
          color: { argb: aggregate < 0 ? C.red : C.primary },
        };
      }
      aggCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.highlight } };
      aggCell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      aggCell.border = {
        left:   { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });

    ws.getColumn(1).width = 38;
    for (let i = 2; i <= 2 + cols.length; i++) ws.getColumn(i).width = 18;
  };

  if (companyCodes && companyCodes.length > 0 && companyResults) {
    addKpiMatrixSheet("KPIs by Company", "KPI Dashboard — By Company",
      companyCodes, companyCodes, companyResults);
  }

  if (dimensionCodes && dimensionCodes.length > 0 && dimensionResults) {
    const dimLabels = dimensionCodes.map(dc => dimensionPivots?.get(dc)?.name ?? dc);
    addKpiMatrixSheet("KPIs by Dimension", "KPI Dashboard — By Dimension",
      dimensionCodes, dimLabels, dimensionResults);
  }

// Graphs tab — one sheet per section: chart image on left, data table on right
  if (graphSections && graphSections.length > 0) {
    for (let secIdx = 0; secIdx < graphSections.length; secIdx++) {
  const section = graphSections[secIdx];
      const { sectionId, company, startY, startM, endY, endM, source: secSource, structure: secStructure,
              dimGroup, dim, mode, kpiIds, chartData } = section;

      const sheetName = `Graph ${sectionId}`;
      const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 4 }] });

      // Title
      ws.mergeCells(1, 1, 1, 20);
      const t = ws.getCell(1, 1);
      t.value = `Section ${sectionId} — ${company || "—"}`;
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      t.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
      t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(1).height = 28;

      // Filter subtitle
      ws.mergeCells(2, 1, 2, 20);
      const s = ws.getCell(2, 1);
      const rangeStr = `${monthLabel(startM)} ${startY} → ${monthLabel(endM)} ${endY}`;
      const descParts = [rangeStr, secSource, secStructure, mode === "ytd" ? "YTD" : "Monthly"];
      if (dimGroup) descParts.push(`Dim Group: ${dimGroup}`);
      if (dim) descParts.push(`Dim: ${dim}`);
      s.value = descParts.join(" · ");
      s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      s.font = { name: "Calibri", size: 10, color: { argb: C.white } };
      s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(2).height = 18;
      ws.getRow(3).height = 6;

      const kpis = (kpiIds || []).map(id => kpiList.find(k => k.id === id)).filter(Boolean);

const imageDataUrl = section.imageDataUrl;
      if (imageDataUrl) {
        try {
          const imageId = wb.addImage({ base64: imageDataUrl, extension: "png" });
          ws.addImage(imageId, {
            tl: { col: 0, row: 3 },
            br: { col: 10, row: 22 },
            editAs: "oneCell",
          });
        } catch (e) {
          console.warn(`Chart embed failed for section ${sectionId}:`, e);
        }
      }

      // Data table on right half, starting column 12 (L)
      const tableStartCol = 12;
      const tableStartRow = 4;
      const headerRow = ws.getRow(tableStartRow);
      headerRow.height = 22;
      headerRow.getCell(tableStartCol).value = "Period";
      kpis.forEach((kpi, i) => headerRow.getCell(tableStartCol + 1 + i).value = kpi.label);
      for (let i = 0; i <= kpis.length; i++) {
        const c = headerRow.getCell(tableStartCol + i);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: 1 };
      }

      (chartData || []).forEach((d, idx) => {
        const r = ws.getRow(tableStartRow + 1 + idx);
        r.height = 18;
        const band = idx % 2 === 0 ? C.band1 : C.band2;
        r.getCell(tableStartCol).value = d.period;
        r.getCell(tableStartCol).fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        r.getCell(tableStartCol).font = { name: "Calibri", size: 10, color: { argb: C.primary }, bold: true };
        r.getCell(tableStartCol).alignment = { vertical: "middle", horizontal: "left", indent: 1 };

        kpis.forEach((kpi, i) => {
          const val = d[kpi.id];
          const c = r.getCell(tableStartCol + 1 + i);
          if (val === null || val === undefined || isNaN(val)) {
            c.value = null;
            c.font = { name: "Calibri", size: 10, color: { argb: C.gray400 } };
          } else {
            c.value = val;
            c.numFmt = kpi.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
            c.font = {
              name: "Calibri", size: 10,
              color: { argb: val < 0 ? C.red : C.primary },
            };
          }
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
          c.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
        });
      });

      // Column widths: leave cols 1-10 for chart image, 11 as spacer, 12+ for table
      for (let i = 1; i <= 10; i++) ws.getColumn(i).width = 10;
      ws.getColumn(11).width = 2;
      ws.getColumn(tableStartCol).width = 14;
      kpis.forEach((_, i) => { ws.getColumn(tableStartCol + 1 + i).width = 16; });
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fname = `Konsolidator_KPIs_${filters?.year ?? ""}_${String(filters?.month ?? "").padStart(2, "0")}.xlsx`;
  saveAs(blob, fname);
}

async function exportKpisToPdf({
  kpiList, companyCodes, companyResults,
  dimensionCodes, dimensionResults, dimensionPivots,
  graphSections, filters,
}) {
  const H = {
    primary:   "#1A2F8A",
    primaryDk: "#1A2B6B",
    highlight: "#EEF1FB",
    band1:     "#FFFFFF",
    band2:     "#F8F9FF",
    white:     "#FFFFFF",
    gray400:   "#9CA3AF",
    gray500:   "#6B7280",
    green:     "#059669",
    red:       "#DC2626",
  };

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  const drawHeader = (title, subtitle) => {
    doc.setFillColor(H.primary);
    doc.rect(0, 0, pageWidth, 60, "F");
    doc.setTextColor(H.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(title, 24, 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(subtitle, 24, 46);
  };

  const addKpiMatrix = (title, cols, colLabels, resultsMap, isFirst) => {
    if (!isFirst) doc.addPage();
    drawHeader(title, buildFilterString(filters) || "—");

    const head = [["KPI", ...colLabels, "Total / Avg"]];
    const body = kpiList.map(kpi => {
      const values = cols.map(col => {
        const res = resultsMap.get(col);
        if (!res) return null;
        const v = res.get(kpi.id);
        return (v === undefined || v === null || isNaN(v)) ? null : v;
      });
      const validVals = values.filter(v => v !== null);
      const aggregate = validVals.length === 0 ? null
        : kpi.format === "percent"
          ? validVals.reduce((a, b) => a + b, 0) / validVals.length
          : validVals.reduce((a, b) => a + b, 0);

      return [
        kpi.label,
        ...values.map(v => v === null ? "—" : fmtValue(v, kpi.format)),
        aggregate === null ? "—" : fmtValue(aggregate, kpi.format),
      ];
    });

 autoTable(doc, {
      head, body,
      startY: 80,
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 5, textColor: H.primary },
      headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "right" },
      columnStyles: {
        0: { halign: "left", fontStyle: "bold", cellWidth: 140 },
        [cols.length + 1]: { fillColor: H.highlight, fontStyle: "bold" },
      },
      alternateRowStyles: { fillColor: H.band2 },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index > 0) {
          data.cell.styles.halign = "right";
          const raw = data.cell.raw;
          if (typeof raw === "string" && raw.startsWith("-")) {
            data.cell.styles.textColor = H.red;
          }
        }
      },
    });
  };

  let firstPage = true;
  if (companyCodes && companyCodes.length > 0 && companyResults) {
    addKpiMatrix("KPI Dashboard — By Company", companyCodes, companyCodes, companyResults, firstPage);
    firstPage = false;
  }

  if (dimensionCodes && dimensionCodes.length > 0 && dimensionResults) {
    const dimLabels = dimensionCodes.map(dc => dimensionPivots?.get(dc)?.name ?? dc);
    addKpiMatrix("KPI Dashboard — By Dimension", dimensionCodes, dimLabels, dimensionResults, firstPage);
    firstPage = false;
  }

 if (graphSections && graphSections.length > 0) {
 for (const section of graphSections) {
      const { sectionId, company, startY, startM, endY, endM, source: secSource, structure: secStructure,
              dimGroup, dim, mode, kpiIds, chartData, imageDataUrl } = section;

      doc.addPage();
      const rangeStr = `${monthLabel(startM)} ${startY} → ${monthLabel(endM)} ${endY}`;
      const descParts = [rangeStr, secSource, secStructure, mode === "ytd" ? "YTD" : "Monthly"];
      if (dimGroup) descParts.push(`Dim Group: ${dimGroup}`);
      if (dim) descParts.push(`Dim: ${dim}`);

      drawHeader(`Graphs — Section ${sectionId} · ${company || "—"}`, descParts.join(" · "));

      // Embed pre-rendered chart image (from either live DOM or headless render)
      let hasImage = false;
      if (imageDataUrl) {
        try {
          doc.addImage(imageDataUrl, "PNG", 24, 80, 400, 240);
          hasImage = true;
        } catch (e) {
          console.warn(`PDF chart embed failed for section ${sectionId}:`, e);
        }
      }

      const kpis = (kpiIds || []).map(id => kpiList.find(k => k.id === id)).filter(Boolean);
      const head = [["Period", ...kpis.map(k => k.label)]];
      const body = (chartData || []).map(d => [
        d.period,
        ...kpis.map(k => {
          const v = d[k.id];
          return (v === null || v === undefined || isNaN(v)) ? "—" : fmtValue(v, k.format);
        }),
      ]);

    autoTable(doc, {
        head, body,
        startY: 80,
        margin: { left: hasImage ? 440 : 24, right: 24 },
        theme: "plain",
        styles: { font: "helvetica", fontSize: 7, cellPadding: 3, textColor: H.primary },
        headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "right" },
        columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
        alternateRowStyles: { fillColor: H.band2 },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index > 0) {
            data.cell.styles.halign = "right";
            const raw = data.cell.raw;
            if (typeof raw === "string" && raw.startsWith("-")) {
              data.cell.styles.textColor = H.red;
            }
          }
        },
      });
    }
  }

  const fname = `Konsolidator_KPIs_${filters?.year ?? ""}_${String(filters?.month ?? "").padStart(2, "0")}.pdf`;
  doc.save(fname);
}

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

// ── Formula Node Builder ──────────────────────────────────────────────────────
function NodeBuilder({ node, onChange, onRemove, depth = 0, kpiList, accountCodes, dimCodes }) {
  if (!node || !node.type) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {[
          { t: "accountGroup", label: "Account Group", color: "bg-blue-50 text-blue-700 hover:bg-blue-700 hover:text-white" },
          { t: "account", label: "Single Account", color: "bg-[#eef1fb] text-[#1a2f8a] hover:bg-[#1a2f8a] hover:text-white" },
          { t: "manual", label: "Fixed Number", color: "bg-amber-50 text-amber-700 hover:bg-amber-700 hover:text-white" },
          { t: "ref", label: "KPI Reference", color: "bg-purple-50 text-purple-700 hover:bg-purple-700 hover:text-white" },
          { t: "op", label: "Math Operation", color: "bg-orange-50 text-orange-700 hover:bg-orange-700 hover:text-white" },
          { t: "fn", label: "Function", color: "bg-emerald-50 text-emerald-700 hover:bg-emerald-700 hover:text-white" },
        ].map(({ t, label, color }) => (
          <button key={t} onClick={() => {
            const defaults = {
              accountGroup: { type: "accountGroup", prefix: "" },
              account: { type: "account", accountCode: "" },
              manual: { type: "manual", value: 0 },
              ref: { type: "ref", kpiId: "" },
              op: { type: "op", op: "+", left: null, right: null },
              fn: { type: "fn", fn: "neg", arg: null },
            };
            onChange(defaults[t]);
          }}
            className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all ${color}`}>
            {label}
          </button>
        ))}
      </div>
    );
  }

  const wrap = (children) => (
    <div className={`flex items-start gap-1.5 ${depth > 0 ? "mt-1 pl-3 border-l-2 border-[#eef1fb]" : ""}`}>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">{children}</div>
      {onRemove && (
        <button onClick={onRemove} className="flex-shrink-0 w-5 h-5 rounded-md bg-red-50 text-red-400 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all">
          <X size={9} />
        </button>
      )}
    </div>
  );

  if (node.type === "accountGroup") return wrap(
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">GROUP</span>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-400">prefix</span>
        <input value={node.prefix ?? ""} onChange={e => onChange({ ...node, prefix: e.target.value })}
          placeholder="e.g. 42"
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white w-20" />
      </div>
      <span className="text-[10px] text-gray-300">→ sums all accounts with that prefix</span>
    </div>
  );

  if (node.type === "account") return wrap(
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-[#1a2f8a] bg-[#eef1fb] px-2 py-0.5 rounded-md">ACCOUNT</span>
      <select value={node.accountCode ?? ""} onChange={e => onChange({ ...node, accountCode: e.target.value })}
        className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white max-w-[180px]">
        <option value="">— select account —</option>
        {accountCodes.map(ac => <option key={ac} value={ac}>{ac}</option>)}
      </select>
      {dimCodes.length > 0 && (
        <select value={node.dimCode ?? ""} onChange={e => onChange({ ...node, dimCode: e.target.value || undefined })}
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white max-w-[140px]">
          <option value="">All dimensions</option>
          {dimCodes.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
    </div>
  );

  if (node.type === "manual") return wrap(
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">NUMBER</span>
      <input type="number" value={node.value ?? 0} onChange={e => onChange({ ...node, value: parseFloat(e.target.value) || 0 })}
        className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white w-32" />
    </div>
  );

  if (node.type === "ref") return wrap(
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">KPI REF</span>
      <select value={node.kpiId ?? ""} onChange={e => onChange({ ...node, kpiId: e.target.value })}
        className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white">
        <option value="">— select KPI —</option>
        {kpiList.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>
    </div>
  );

  if (node.type === "fn") return wrap(
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">FUNC</span>
        <select value={node.fn ?? "neg"} onChange={e => onChange({ ...node, fn: e.target.value })}
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white">
          <option value="neg">Negate (−x)</option>
          <option value="abs">Absolute (|x|)</option>
          <option value="pct">To Percent (×100)</option>
        </select>
        <span className="text-[10px] text-gray-400">applied to:</span>
      </div>
      <NodeBuilder node={node.arg} onChange={arg => onChange({ ...node, arg })}
        onRemove={node.arg ? () => onChange({ ...node, arg: null }) : null}
        depth={depth + 1} kpiList={kpiList} accountCodes={accountCodes} dimCodes={dimCodes} />
    </>
  );

  if (node.type === "op") return wrap(
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-black text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md">OPERATION</span>
        <select value={node.op ?? "+"} onChange={e => onChange({ ...node, op: e.target.value })}
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white">
          <option value="+">Add (+)</option>
          <option value="-">Subtract (−)</option>
          <option value="*">Multiply (×)</option>
          <option value="/">Divide (÷)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 pl-2">
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5 block">Left operand</span>
          <NodeBuilder node={node.left} onChange={left => onChange({ ...node, left })}
            onRemove={node.left ? () => onChange({ ...node, left: null }) : null}
            depth={depth + 1} kpiList={kpiList} accountCodes={accountCodes} dimCodes={dimCodes} />
        </div>
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5 block">Right operand</span>
          <NodeBuilder node={node.right} onChange={right => onChange({ ...node, right })}
            onRemove={node.right ? () => onChange({ ...node, right: null }) : null}
            depth={depth + 1} kpiList={kpiList} accountCodes={accountCodes} dimCodes={dimCodes} />
        </div>
      </div>
    </>
  );

  return null;
}

// ── KPI Editor Modal ──────────────────────────────────────────────────────────
const PRESETS = [
  { label: "Account Group sum",          formula: { type: "text", expression: "A",           variables: { A: null } } },
  { label: "Single account",             formula: { type: "text", expression: "A",           variables: { A: null } } },
  { label: "A ÷ B (ratio/margin)",       formula: { type: "text", expression: "A / B",       variables: { A: null, B: null } } },
  { label: "A − B (variance)",           formula: { type: "text", expression: "A - B",       variables: { A: null, B: null } } },
  { label: "(A ÷ B) × 100 (percent)",    formula: { type: "text", expression: "(A / B) * 100", variables: { A: null, B: null } } },
  { label: "Negate value (−A)",          formula: { type: "text", expression: "-A",          variables: { A: null } } },
  { label: "KPI reference",              formula: { type: "text", expression: "A",           variables: { A: null } } },
  { label: "Fixed number",               formula: { type: "text", expression: "0",           variables: {} } },
];

const LIBRARY_SECTIONS = [
{
    key: "liquidez",
    label: "Liquidez",
    color: "bg-emerald-700",
    kpis: [
      { id: "_lib_current_ratio", label: "Ratio Liquidez", description: "Mide cuántos pesos de activos líquidos respaldan cada peso de deuda a corto plazo.", benchmark: "> 1.5 saludable; entre 1 y 1.5 aceptable", format: "number", category: "Liquidez",
        formula: { type: "ref", kpiId: "current_ratio" } },
      { id: "_lib_quick_ratio", label: "Prueba Ácida (Quick Ratio)", description: "Excluye inventarios por ser el activo menos líquido. Medida más estricta de la liquidez real.", benchmark: "> 1.0 ideal", format: "number", category: "Liquidez",
        formula: { type: "ref", kpiId: "quick_ratio" } },
      { id: "_lib_cash_ratio", label: "Ratio de Tesorería (Cash Ratio)", description: "Solo considera el efectivo y equivalentes disponibles de inmediato.", benchmark: "> 0.2 aceptable", format: "number", category: "Liquidez",
        formula: { type: "ref", kpiId: "cash_ratio" } },
      { id: "_lib_working_capital", label: "Capital Circulante (Working Capital)", description: "Recursos disponibles para operar la empresa luego de cubrir todas las obligaciones a corto plazo.", benchmark: "Positivo y creciente", format: "currency", category: "Liquidez",
        formula: { type: "ref", kpiId: "working_capital" } },
    ],
  },
{
    key: "solvencia",
    label: "Solvencia / Endeudamiento",
    color: "bg-blue-700",
    kpis: [
      { id: "_lib_debt_ratio", label: "Razón de Endeudamiento", description: "Porcentaje de los activos financiados con deuda. A mayor valor, más apalancada y riesgosa la empresa.", benchmark: "< 50% conservador", format: "percent", category: "Solvencia",
        formula: { type: "ref", kpiId: "debt_ratio" } },
      { id: "_lib_debt_to_equity", label: "Apalancamiento Financiero (D/E)", description: "Compara la deuda total con el capital propio. Indica el nivel de riesgo financiero asumido.", benchmark: "< 1.0 conservador; varía por sector", format: "number", category: "Solvencia",
        formula: { type: "ref", kpiId: "debt_to_equity" } },
      { id: "_lib_net_debt_ebitda", label: "Deuda Neta / EBITDA", description: "Cuántos años le tomaría pagar su deuda neta con el flujo operativo generado.", benchmark: "< 3x manejable; > 5x elevado", format: "number", category: "Solvencia",
        formula: { type: "ref", kpiId: "net_debt_to_ebitda" } },
      { id: "_lib_interest_coverage", label: "Cobertura de Intereses", description: "Cuántas veces puede la empresa pagar sus intereses con su utilidad operativa. Requiere personalización manual.", benchmark: "> 3x saludable", format: "number", category: "Solvencia",
        formula: { type: "op", op: "/", left: null, right: null } },
    ],
  },
{
    key: "rentabilidad",
    label: "Rentabilidad",
    color: "bg-[#1a2f8a]",
    kpis: [
      { id: "_lib_gross_margin", label: "Margen Bruto", description: "Porcentaje de las ventas que queda tras el costo directo de producción o compra.", benchmark: "Depende del sector", format: "percent", category: "Rentabilidad",
        formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "gross_profit" }, right: { type: "ref", kpiId: "revenue" } } } },
      { id: "_lib_ebit_margin", label: "Margen Operativo (EBIT %)", description: "Utilidad generada por la operación principal antes de intereses e impuestos.", benchmark: "> 10% generalmente bueno", format: "percent", category: "Rentabilidad",
        formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "ebit" }, right: { type: "ref", kpiId: "revenue" } } } },
      { id: "_lib_net_margin", label: "Margen Neto", description: "Cuántos centavos de utilidad neta genera cada peso de ventas.", benchmark: "Depende del sector", format: "percent", category: "Rentabilidad",
        formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "net_result" }, right: { type: "ref", kpiId: "revenue" } } } },
      { id: "_lib_roa", label: "ROA — Rentabilidad sobre Activos", description: "Eficiencia con que la empresa usa todos sus activos para generar utilidad. Requiere KPI 'total_assets' en Supabase.", benchmark: "> 5% bueno; > 10% excelente", format: "percent", category: "Rentabilidad",
        formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "net_result" }, right: { type: "ref", kpiId: "total_assets" } } } },
      { id: "_lib_roe", label: "ROE — Rentabilidad sobre Patrimonio", description: "Retorno generado para los accionistas sobre su inversión en la empresa. Requiere KPI 'total_equity' en Supabase.", benchmark: "> 15% atractivo", format: "percent", category: "Rentabilidad",
        formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "net_result" }, right: { type: "ref", kpiId: "total_equity" } } } },
      { id: "_lib_ebitda", label: "EBITDA", description: "Aproximación al flujo de caja operativo antes de estructura financiera e impuestos.", benchmark: "Positivo y creciente", format: "currency", category: "Rentabilidad",
        formula: { type: "ref", kpiId: "ebitda" } },
      { id: "_lib_ebit", label: "EBIT", description: "Earnings before interest and tax.", benchmark: "Positivo y creciente", format: "currency", category: "Rentabilidad",
        formula: { type: "ref", kpiId: "ebit" } },
    ],
  },
{
    key: "eficiencia",
    label: "Eficiencia",
    color: "bg-amber-600",
    kpis: [
      { id: "_lib_asset_turnover", label: "Rotación de Activos Totales", description: "Cuántos pesos en ventas genera cada peso invertido en activos.", benchmark: "> 1x generalmente bueno", format: "number", category: "Eficiencia",
        formula: { type: "ref", kpiId: "asset_turnover" } },
      { id: "_lib_dio", label: "Días de Inventario (DIO)", description: "Promedio de días que el inventario permanece almacenado antes de venderse.", benchmark: "Menor = más eficiente", format: "number", category: "Eficiencia",
        formula: { type: "ref", kpiId: "inventory_days" } },
      { id: "_lib_dso", label: "Días de Cobro (DSO)", description: "Días promedio que tarda la empresa en cobrar sus ventas a crédito.", benchmark: "Menor = más eficiente", format: "number", category: "Eficiencia",
        formula: { type: "ref", kpiId: "dso" } },
      { id: "_lib_dpo", label: "Días de Pago a Proveedores (DPO)", description: "Días promedio que la empresa demora en pagar a sus proveedores.", benchmark: "Mayor puede ser favorable", format: "number", category: "Eficiencia",
        formula: { type: "ref", kpiId: "dpo" } },
    ],
  },
  {
    key: "mercado",
    label: "Mercado",
    color: "bg-rose-800",
    kpis: [
      { label: "EPS — Utilidad por Acción", description: "Cuánta utilidad corresponde a cada acción emitida.", benchmark: "Positivo y creciente", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
      { label: "P/E — Precio / Utilidad", description: "Cuántas veces paga el mercado la utilidad anual de la empresa.", benchmark: "10x–20x común; varía por sector", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
      { label: "P/BV — Precio / Valor en Libros", description: "Compara el valor de mercado con el patrimonio contable.", benchmark: "> 1x indica prima; < 1x posible subvaloración", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
      { label: "Dividend Yield", description: "Retorno anual en dividendos respecto al precio actual de la acción.", benchmark: "> 3% atractivo para renta", format: "percent", category: "Mercado", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: null, right: null } } },
      { label: "EV/EBITDA", description: "Múltiplo de valoración independiente de la estructura de capital y política fiscal.", benchmark: "6x–12x común en industria", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
    ],
  },
];



function LibraryPicker({ onSave, onDuplicate }) {
  const [activeSection, setActiveSection] = useState(null);

  if (!activeSection) {
const SECTION_META = {
      liquidez:      { icon: "💧", hint: "Capacidad de pagar obligaciones a corto plazo" },
      solvencia:     { icon: "🏦", hint: "Nivel de deuda y solidez financiera estructural" },
      rentabilidad:  { icon: "📈", hint: "Márgenes, retornos y generación de beneficios" },
      eficiencia:    { icon: "⚙️", hint: "Gestión de activos, cobros, pagos e inventarios" },
      mercado:       { icon: "📊", hint: "Valoración bursátil y métricas para inversores" },
    };

// DESPUÉS — añade la tarjeta custom al final del grid:
return (
  <div className="overflow-y-auto flex-1 p-5">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">Selecciona una categoría</p>
    <div className="grid grid-cols-2 gap-3">
      {LIBRARY_SECTIONS.map(sec => {
        const meta = SECTION_META[sec.key] ?? {};
        return (
<button key={sec.key} onClick={() => setActiveSection(sec.key)}
            className="text-left p-5 rounded-2xl border border-gray-100 hover:border-[#1a2f8a]/25 hover:shadow-md transition-all group bg-white hover:bg-[#f8f9ff]">
            <div className="flex items-start justify-between gap-2 mb-4">
              <span className="text-3xl leading-none inline-block group-hover:scale-110 transition-transform duration-200">{meta.icon}</span>
              <span className="text-[10px] font-black text-gray-300 group-hover:text-[#1a2f8a]/40 transition-colors">
                {sec.kpis.length} indicadores
              </span>
            </div>
            <p className="text-sm font-black text-[#1a2f8a] mb-1.5">{sec.label}</p>
            <p className="text-xs text-gray-400 leading-snug">{meta.hint}</p>
          </button>
        );
      })}

{/* Tarjeta Custom KPI */}
<button onClick={() => onSave("__custom__")}
className="text-left p-5 rounded-2xl border border-gray-100 hover:border-[#1a2f8a]/25 hover:shadow-md transition-all group bg-white hover:bg-[#f8f9ff]">
        <div className="flex items-start justify-between gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1a2f8a] to-[#4f63c2] flex items-center justify-center flex-shrink-0 shadow-md shadow-[#1a2f8a]/20 group-hover:scale-110 transition-transform">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 4v10M4 9h10" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    </div>
    <span className="text-[9px] font-black text-gray-300 group-hover:text-[#1a2f8a]/40 transition-colors">
      desde cero
    </span>
  </div>
  <p className="text-xs font-black text-[#1a2f8a] mb-1">KPI personalizado</p>
  <p className="text-[10px] text-gray-400 leading-snug">Crea tu propia fórmula con cuentas, grupos y operaciones</p>
</button>
    </div>
  </div>
);
  }

  const sec = LIBRARY_SECTIONS.find(s => s.key === activeSection);
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        <button onClick={() => setActiveSection(null)}
          className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 hover:text-[#1a2f8a] transition-colors">
          <ChevronDown size={11} className="rotate-90" /> Volver
        </button>
        <span className="text-[10px] text-gray-300">·</span>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md text-white ${sec.color}`}>{sec.label}</span>
      </div>
      <div className="overflow-y-auto flex-1 px-5 pb-5 grid grid-cols-2 gap-2 content-start">
        {sec.kpis.map((k, i) => (
<div key={i} className="relative group">
            <button onClick={() => onSave({ ...k, _fromLibrary: true })}
              className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb] transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-[#1a2f8a] leading-snug">{k.label}</p>
                  <p className="text-xs text-gray-700 mt-1 leading-snug">{k.description}</p>
                </div>
                <span className={`flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-md ${k.format === "percent" ? "bg-emerald-50 text-emerald-700" : k.format === "currency" ? "bg-[#eef1fb] text-[#1a2f8a]" : "bg-gray-50 text-gray-500"}`}>
                  {k.format === "percent" ? "%" : k.format === "currency" ? "€" : "#"}
                </span>
              </div>
              {k.benchmark && (
                <p className="text-[10px] text-gray-600 mt-2 italic">{k.benchmark}</p>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate?.({ ...k, label: k.label + " 2" }); }}
              className="absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
              style={{ background: "#eef1fb", color: "#1a2f8a" }}
              title="Duplicate">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchableList({ items, value, onChange, placeholder = "Buscar..." }) {
  const [search, setSearch] = useState("");
  const filtered = items.filter(i =>
    i.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-[#f8f9ff] pr-7"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <X size={10} />
          </button>
        )}
      </div>
     <div className="max-h-[55vh] overflow-y-auto flex flex-col gap-0.5 border border-gray-100 rounded-xl bg-white">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
        ) : filtered.map(item => (
          <button key={item} onClick={() => onChange(item)}
            className={`text-left px-3 py-2 text-xs transition-all flex items-center justify-between ${value === item ? "bg-[#1a2f8a] text-white font-black" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a] font-medium"}`}>
            {item}
            {value === item && <Check size={10} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiRefPicker({ kpiList, kpiId, setKpiId, builtInIds }) {
  const [search, setSearch] = useState("");
  const filtered = kpiList.filter(k =>
    !search.trim() || k.label.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar KPI..."
          className="w-full rounded-xl px-3 py-2 text-xs text-gray-700 outline-none pr-7"
          style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300"><X size={10} /></button>}
      </div>
<div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
        ) : filtered.map(k => {
          const isSystem = builtInIds?.has(k.id);
          const selected = kpiId === k.id;
          return (
<button key={k.id} onClick={() => setKpiId(k.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all border-b border-gray-50 last:border-0"
              style={{ background: selected ? "#eef1fb" : "transparent", color: selected ? "#1a2f8a" : "#374151" }}
              onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#f8f9ff"; }}
              onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: isSystem ? "#1a2f8a" : "#16a34a" }} />
              <span className="flex-1 font-semibold text-xs truncate">{k.label}</span>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-lg flex-shrink-0"
                style={{ background: isSystem ? "#eef1fb" : "#dcfce7", color: isSystem ? "#1a2f8a" : "#15803d" }}>
                {isSystem ? "sistema" : "custom"}
              </span>
              {selected && <Check size={11} className="flex-shrink-0 text-[#1a2f8a]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccountPicker({ items, value, onChange, dimsByAccount = new Map() }) {
  const [search, setSearch] = useState("");
  const [expandedDims, setExpandedDims] = useState(new Set());

  // value can be "code" or "code:::dimGroup:::dimCode"
  const selectedCode = value?.split(":::")?.[0] ?? value;

  const filtered = items.filter(i =>
    !search.trim() || i.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cuenta..."
          className="w-full rounded-xl px-3 py-2 text-xs text-gray-700 outline-none pr-7"
          style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300"><X size={10} /></button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
        ) : filtered.map(item => {
          const isSelected = selectedCode === item.code && !value?.includes(":::");
          const [code, ...nameParts] = item.label.split(" — ");
          const name = nameParts.join(" — ");
          const dims = dimsByAccount.get(item.code) ?? [];
          const hasDims = dims.length > 0;
          const isDimExpanded = expandedDims.has(item.code);

          return (
            <div key={item.code} className="border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-1">
                <button onClick={() => onChange(item.code)}
                  className="flex-1 text-left px-4 py-3 flex items-center gap-3 transition-all"
                  style={{ background: isSelected ? "#eef1fb" : "transparent" }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f8f9ff"; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                  <span className="font-mono font-black text-[#1a2f8a] flex-shrink-0 w-16 text-xs">{code}</span>
                  {name && <span className="flex-1 text-gray-600 text-xs">{name}</span>}
                  {hasDims && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-black"
                      style={{ background: "#fef3c7", color: "#d97706" }}>
                      dims
                    </span>
                  )}
                  {isSelected && <Check size={11} className="flex-shrink-0 text-[#1a2f8a]" />}
                </button>
                {hasDims && (
                  <button onClick={() => setExpandedDims(prev => {
                    const next = new Set(prev);
                    next.has(item.code) ? next.delete(item.code) : next.add(item.code);
                    return next;
                  })}
                    className="px-2 py-3 text-gray-400 hover:text-amber-600 transition-colors flex-shrink-0"
                    title="Ver dimensiones">
                    <ChevronDown size={11} className={`transition-transform ${isDimExpanded ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>
              {isDimExpanded && hasDims && dims.map((d, di) => {
                const dimKey = `${item.code}:::${d.group}:::${d.code}`;
                const isDimSelected = value === dimKey;
                return (
                  <button key={di} onClick={() => onChange(dimKey)}
                    className="w-full text-left flex items-center gap-2 py-2 transition-all"
                    style={{
                      paddingLeft: 48, paddingRight: 16,
                      background: isDimSelected ? "#fef3c7" : "transparent"
                    }}
                    onMouseEnter={e => { if (!isDimSelected) e.currentTarget.style.background = "#fffbeb"; }}
                    onMouseLeave={e => { if (!isDimSelected) e.currentTarget.style.background = "transparent"; }}>
                    <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                    <span className="text-[9px] font-black uppercase tracking-wider text-amber-500 flex-shrink-0">{d.group}:</span>
                    <span className="text-xs text-gray-600 flex-1">{d.name || d.code}</span>
                    {isDimSelected && <Check size={10} className="flex-shrink-0 text-amber-600" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotPicker({ onSelect, onClose, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map() }) {
  const [step, setStep] = useState("type");
  const [type, setType] = useState(null);
  const [prefix, setPrefix] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [kpiId, setKpiId] = useState("");
  const [manualVal, setManualVal] = useState(0);

  // derive group prefixes from accountCodes (unique 1-2 char prefixes)
  const groupPrefixes = useMemo(() => {
    const seen = new Set();
    accountCodes.forEach(ac => {
      for (let len = 1; len <= 4; len++) {
        const p = ac.slice(0, len);
        if (accountCodes.filter(c => c.startsWith(p)).length > 1) seen.add(p);
      }
    });
    return [...seen].sort();
  }, [accountCodes]);

const TYPES = [
    { id: "accountGroup", label: "Grupo de cuentas", desc: "Suma todas las cuentas bajo un código padre", color: "bg-blue-50 text-blue-700 border-blue-200" },
    { id: "account",      label: "Cuenta individual", desc: "Código exacto de una cuenta",   color: "bg-[#eef1fb] text-[#1a2f8a] border-[#1a2f8a]/20" },
    { id: "ref",          label: "KPI existente",     desc: "Referencia a otro KPI calculado", color: "bg-purple-50 text-purple-700 border-purple-200" },
  ];

const confirm = () => {
    if (type === "accountGroup") onSelect({ type: "accountGroup", prefix });
    else if (type === "account") {
if (accountCode.includes(":::")) {
        const [ac, dimGroup, dimCode] = accountCode.split(":::");
        const dimEntry = dimsByAccount.get(ac)?.find(d => d.group === dimGroup && d.code === dimCode);
        onSelect({ type: "account", accountCode: ac, dimGroup: dimGroup || undefined, dimCode: dimCode || undefined, dimName: dimEntry?.name || dimCode || undefined });
      } else {
        onSelect({ type: "account", accountCode });
      }
    }
    else if (type === "ref")      onSelect({ type: "ref", kpiId });
    else if (type === "manual")   onSelect({ type: "manual", value: manualVal });
    onClose();
  };

return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />
<div className="relative flex flex-col bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
        style={{ boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25)", height: "90vh", maxHeight: "90vh" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {step === "detail" && (
              <button onClick={() => setStep("type")}
                className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                style={{ background: "#f3f4f6", color: "#6b7280" }}>
                <ChevronDown size={12} className="rotate-90" />
              </button>
            )}
            <div>
              <p className="font-black text-[14px] text-gray-900 leading-tight">
                {step === "type" ? "Tipo de variable" : TYPES.find(t => t.id === type)?.label}
              </p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                {step === "type" ? "Selecciona cómo calcular esta variable" : TYPES.find(t => t.id === type)?.desc}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "#f3f4f6", color: "#6b7280" }}>
            <X size={12} />
          </button>
        </div>

        <div className="h-px mx-5" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />

{step === "type" && (
          <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
            {[
              { id: "accountGroup", label: "Grupo de cuentas", desc: "Suma todas las cuentas bajo un código padre", icon: "Σ", iconBg: "#dbeafe", iconColor: "#1d4ed8" },
              { id: "account",      label: "Cuenta individual", desc: "Código exacto de una cuenta", icon: "#", iconBg: "#eef1fb", iconColor: "#1a2f8a" },
              { id: "ref",          label: "KPI existente",     desc: "Referencia a otro KPI calculado", icon: "↗", iconBg: "#f3e8ff", iconColor: "#7c3aed" },
            ].map((t) => (
              <button key={t.id} onClick={() => { setType(t.id); setStep("detail"); }}
                className="text-left rounded-2xl border transition-all duration-200 group flex-1 flex items-center"
                style={{ background: "#f8f9ff", borderColor: "#e8eaf0", padding: "24px 24px" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#1a2f8a30"; e.currentTarget.style.background = "#fff"; e.currentTarget.style.boxShadow = "0 4px 20px -4px rgba(26,47,138,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e8eaf0"; e.currentTarget.style.background = "#f8f9ff"; e.currentTarget.style.boxShadow = "none"; }}>
                <div className="flex items-center gap-4 w-full">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl font-black transition-transform duration-200 group-hover:scale-110"
                    style={{ background: t.iconBg, color: t.iconColor }}>
                    {t.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-900 text-base leading-tight">{t.label}</p>
                    <p className="text-xs text-gray-400 mt-1">{t.desc}</p>
                  </div>
                  <ChevronDown size={16} className="-rotate-90 text-gray-300 group-hover:text-[#1a2f8a] transition-colors flex-shrink-0" />
                </div>
              </button>
))}
          </div>
        )}

        {step === "detail" &&(
          <div className="p-5 flex flex-col gap-4 flex-1 min-h-0">
{type === "accountGroup" && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-gray-400 leading-snug bg-blue-50 px-3 py-2 rounded-xl">
                  Suma todas las cuentas cuyo código empiece por este prefijo. Ej: <span className="font-mono font-bold text-blue-700">70</span> incluye 7000, 7001, 7010…
                </p>
                <SearchableList
                  items={groupPrefixes.length > 0 ? groupPrefixes : accountCodes}
                  value={prefix}
                  onChange={setPrefix}
                  placeholder="Buscar prefijo..."
                />
              </div>
            )}
<div className="flex-1 min-h-0 overflow-hidden flex flex-col">
{type === "account" && (() => {
              const items = accountCodes.map(ac => ({
                code: ac,
                label: accountCodeLabels.get(ac) ? `${ac} — ${accountCodeLabels.get(ac)}` : ac,
              }));
              return (
                <AccountPicker
                  items={items}
                  value={accountCode}
                  onChange={setAccountCode}
                  dimsByAccount={dimsByAccount}
                />
              );
            })()}
{type === "ref" && (
              <KpiRefPicker kpiList={kpiList} kpiId={kpiId} setKpiId={setKpiId} builtInIds={builtInIds} />
            )}
</div>
            <button onClick={confirm}
              disabled={(type === "accountGroup" && !prefix) || (type === "account" && !accountCode.split(":::")[0]) || (type === "ref" && !kpiId)}
              className="w-full py-3 rounded-xl text-white text-sm font-black transition-all disabled:opacity-30 flex items-center justify-center gap-2 flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "0 6px 20px -4px rgba(26,47,138,0.45)" }}>
              <Check size={14} /> Confirmar selección
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SlotLabel({ node, kpiList, accountCodeLabels = new Map() }) {
  if (!node) return <span className="text-gray-300 italic">vacío</span>;
  if (node.type === "accountGroup") return <span>Grupo <span className="font-black">{node.prefix || "?"}</span></span>;
if (node.type === "account") {
    const name = accountCodeLabels.get(node.accountCode);
    const base = name ? `${node.accountCode} — ${name}` : (node.accountCode || "?");
if (node.dimGroup || node.dimCode) {
      return <span className="font-black">{base} <span style={{ color: "#d97706", fontWeight: 700 }}>· {node.dimGroup}: {node.dimName || node.dimCode}</span></span>;
    }
    return <span className="font-black">{base}</span>;
  }
  if (node.type === "ref") {
    const k = kpiList.find(k => k.id === node.kpiId);
    return <span className="font-black">{k?.label || node.kpiId || "?"}</span>;
  }
  if (node.type === "manual") return <span className="font-black">{node.value}</span>;
  return <span className="text-gray-400 text-[10px]">complejo</span>;
}
function Slot({ node, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), color = "bg-[#eef1fb] text-[#1a2f8a] border-[#1a2f8a]/20" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:shadow-sm ${node ? color : "bg-gray-50 text-gray-400 border-gray-200 border-dashed hover:border-[#1a2f8a]/30 hover:bg-[#f8f9ff]"}`}>
        {node ? <SlotLabel node={node} kpiList={kpiList} accountCodeLabels={accountCodeLabels} /> : <>
          <Plus size={10} className="opacity-50" /> variable
        </>}
      </button>
{open && <SlotPicker onSelect={onChange} onClose={() => setOpen(false)} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} />}
    </>
  );
}

const OP_SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷" };

function VisualFormula({ formula, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set() }) {
  if (!formula) return null;

  const updateLeft  = left  => onChange({ ...formula, left });
  const updateRight = right => onChange({ ...formula, right });
  const updateArg   = arg   => onChange({ ...formula, arg });

  if (formula.type === "op") return (
    <div className="flex items-center gap-2 flex-wrap">
      <Slot node={formula.left}  onChange={updateLeft}  kpiList={kpiList} accountCodes={accountCodes} />
      <span className="text-lg font-black text-[#1a2f8a]/50 px-1">{OP_SYMBOL[formula.op]}</span>
      <Slot node={formula.right} onChange={updateRight} kpiList={kpiList} accountCodes={accountCodes} />
    </div>
  );

  if (formula.type === "fn" && formula.fn === "pct") return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">( </span>
      {formula.arg?.type === "op" ? (
        <>
          <Slot node={formula.arg.left}  onChange={l => onChange({ ...formula, arg: { ...formula.arg, left: l } })} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
          <span className="text-lg font-black text-[#1a2f8a]/50 px-1">{OP_SYMBOL[formula.arg.op]}</span>
          <Slot node={formula.arg.right} onChange={r => onChange({ ...formula, arg: { ...formula.arg, right: r } })} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
        </>
      ) : (
        <Slot node={formula.arg} onChange={updateArg} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
      )}
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg"> ) × 100</span>
    </div>
  );

  if (formula.type === "fn" && formula.fn === "neg") return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-lg font-black text-[#1a2f8a]/50 px-1">−</span>
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">( </span>
      <Slot node={formula.arg} onChange={updateArg} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg"> )</span>
    </div>
  );

  if (formula.type === "fn" && formula.fn === "abs") return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">|</span>
      <Slot node={formula.arg} onChange={updateArg} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">|</span>
    </div>
  );

  // fallback for single node types
  return (
    <Slot node={formula} onChange={onChange} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
  );
}

// ── Text Formula Builder ──────────────────────────────────────────────────────
const VARIABLE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function TextFormulaBuilder({ formula, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map() }) {
  const [expression, setExpression] = useState(() => {
    if (formula?.type === "text") return formula.expression ?? "";
    return "";
  });
  const [variables, setVariables] = useState(() => {
    if (formula?.type === "text") return formula.variables ?? {};
    return {};
  });
  const [editingVar, setEditingVar] = useState(null);
  const inputRef = useRef(null);
  const lastSyncRef = useRef(formula);

// Sync internal state when the incoming formula changes (e.g. preset selected).
  // Only fires when the inbound formula actually differs from what's rendered
  // — silences react-hooks/set-state-in-effect.
  useEffect(() => {
    if (formula === lastSyncRef.current) return;
    lastSyncRef.current = formula;

    const nextExpr = formula?.type === "text" ? (formula.expression ?? "") : "";
    const nextVars = formula?.type === "text" ? (formula.variables ?? {})  : {};

    setExpression(prev => prev === nextExpr ? prev : nextExpr);
    setVariables(prev => {
      const a = Object.keys(prev), b = Object.keys(nextVars);
      if (a.length === b.length && a.every(k => prev[k] === nextVars[k])) return prev;
      return nextVars;
    });
  }, [formula]);

  const usedLetters = Object.keys(variables);
  const nextLetter = VARIABLE_LETTERS.find(l => !usedLetters.includes(l)) ?? "?";

  const insertVariable = () => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? expression.length;
    const end = el.selectionEnd ?? expression.length;
    const newExpr = expression.slice(0, start) + nextLetter + expression.slice(end);
    const newVars = { ...variables, [nextLetter]: null };
    setExpression(newExpr);
    setVariables(newVars);
    onChange({ type: "text", expression: newExpr, variables: newVars });
    setTimeout(() => { el.focus(); el.setSelectionRange(start + 1, start + 1); }, 0);
  };

const updateExpr = (val) => {
    const newVars = { ...variables };
    // Remove variables no longer in expression
    Object.keys(newVars).forEach(l => { if (!val.includes(l)) delete newVars[l]; });
    // Auto-add new capital letters found in expression
    const lettersInExpr = [...new Set([...val.matchAll(/[A-Z]/g)].map(m => m[0]))];
    lettersInExpr.forEach(l => {
      if (!(l in newVars)) newVars[l] = null;
    });
    setExpression(val);
    setVariables(newVars);
    onChange({ type: "text", expression: val, variables: newVars });
  };

  const updateVar = (letter, node) => {
    const newVars = { ...variables, [letter]: node };
    setVariables(newVars);
    onChange({ type: "text", expression, variables: newVars });
    setEditingVar(null);
  };

  const removeVar = (letter) => {
    const newVars = { ...variables };
    delete newVars[letter];
    const newExpr = expression.replaceAll(letter, "");
    setExpression(newExpr);
    setVariables(newVars);
    onChange({ type: "text", expression: newExpr, variables: newVars });
  };

  const VAR_COLORS = [
    "bg-blue-50 text-blue-700 border-blue-200",
    "bg-purple-50 text-purple-700 border-purple-200",
    "bg-emerald-50 text-emerald-700 border-emerald-200",
    "bg-amber-50 text-amber-700 border-amber-200",
    "bg-rose-50 text-rose-700 border-rose-200",
    "bg-orange-50 text-orange-700 border-orange-200",
  ];

  const colorFor = (letter) => VAR_COLORS[VARIABLE_LETTERS.indexOf(letter) % VAR_COLORS.length];

  return (
    <div className="flex flex-col gap-3">

      {/* Expression input */}
      <div className="relative">
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Expresión</label>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={expression}
            onChange={e => updateExpr(e.target.value)}
            placeholder="e.g.  (A - B) / C * 100"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white tracking-wide"
          />
          <button onClick={insertVariable}
            title={`Insertar variable ${nextLetter}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1a2f8a] text-white text-xs font-black hover:bg-[#1a2f8a]/90 transition-all flex-shrink-0">
            <Plus size={11} />
            <span className="font-mono">{nextLetter}</span>
          </button>
        </div>
        <p className="text-[10px] text-gray-300 mt-1">

        </p>
      </div>

      {/* Variable mapping */}
      {usedLetters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Mapping de variables</label>
          {usedLetters.sort().map(letter => (
            <div key={letter} className={`flex items-center gap-2 p-2.5 rounded-xl border ${colorFor(letter)}`}>
              <span className="font-mono font-black text-sm w-5 text-center flex-shrink-0">{letter}</span>
              <span className="text-[10px] font-black opacity-40">=</span>
              <div className="flex-1 min-w-0">
                {variables[letter] ? (
<button onClick={() => setEditingVar(letter)}
                    className="text-xs font-black truncate hover:opacity-70 transition-opacity text-left w-full">
                    <SlotLabel node={variables[letter]} kpiList={kpiList} accountCodeLabels={accountCodeLabels} />
                  </button>
                ) : (
                  <button onClick={() => setEditingVar(letter)}
                    className="text-[10px] font-bold opacity-50 hover:opacity-80 transition-opacity italic">
                    sin asignar — click para definir
                  </button>
                )}
              </div>
              <button onClick={() => setEditingVar(letter)}
                className="flex-shrink-0 w-6 h-6 rounded-lg bg-white/50 hover:bg-white flex items-center justify-center transition-all">
                <Edit3 size={9} />
              </button>
              <button onClick={() => removeVar(letter)}
                className="flex-shrink-0 w-6 h-6 rounded-lg bg-white/50 hover:bg-red-100 hover:text-red-500 flex items-center justify-center transition-all">
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SlotPicker popover for editing a variable */}
{editingVar && (
<SlotPicker
          onSelect={(node) => updateVar(editingVar, node)}
          onClose={() => setEditingVar(null)}
          kpiList={kpiList}
          accountCodes={accountCodes}
          accountCodeLabels={accountCodeLabels}
          builtInIds={builtInIds}
          dimsByAccount={dimsByAccount}
        />
      )}
    </div>
  );
}

function LibTagPill({ value, onChange, allLocalKpis }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";

  const tags = useMemo(() => {
    const seen = new Set();
    allLocalKpis.forEach(k => {
      if (k.tag && k.tag !== "__library__") seen.add(k.tag);
    });
    return [...seen].sort();
  }, [allLocalKpis]);

  const options = [{ value: null, label: "All tags" }, ...tags.map(t => ({ value: t, label: t }))];
  const display = options.find(o => o.value === value)?.label ?? "All tags";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (tags.length === 0) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all"
        style={{ background: value ? colors.primary : "#f8f9ff", color: value ? "#fff" : "#6b7280", border: `1.5px solid ${value ? colors.primary : "#e8eaf0"}` }}>
        <span>{display}</span>
        <ChevronDown size={10} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: `transform 280ms ${SPRING}` }} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 min-w-[160px] rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)", animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          <div className="p-1.5 overflow-y-auto" style={{ maxHeight: "calc(5 * 36px)", scrollbarWidth: "none" }}>
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={String(o.value)} onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{ background: selected ? colors.primary : "transparent", color: selected ? "#fff" : "#475569", transition: `background 180ms ${SMOOTH}` }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LibCategoryPill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";
  const options = [
    { value: null, label: "All categories" },
    ...["Liquidez","Solvencia","Rentabilidad","Eficiencia","Mercado","P&L","Custom"].map(c => ({ value: c, label: c }))
  ];
  const display = options.find(o => o.value === value)?.label ?? "All categories";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all"
        style={{
          background: value ? colors.primary : "#f8f9ff",
          color: value ? "#fff" : "#6b7280",
          border: `1.5px solid ${value ? colors.primary : "#e8eaf0"}`,
        }}>
        <span>{display}</span>
        <ChevronDown size={10} style={{
          opacity: 0.6,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: `transform 280ms ${SPRING}`,
        }} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 min-w-[160px] rounded-2xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.98)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)",
            animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
            <div className="p-1.5 overflow-y-auto" style={{ maxHeight: "calc(5 * 36px)", msOverflowStyle: "none", scrollbarWidth: "none" }}>
            <style>{`.libcat-scroll::-webkit-scrollbar { display: none; }`}</style>
            <div className="libcat-scroll">
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={String(o.value)}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{
                    background: selected ? colors.primary : "transparent",
                    color: selected ? "#fff" : "#475569",
                    transition: `background 180ms ${SMOOTH}`,
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_OPTIONS = [
  { value: "Liquidez",      label: "Liquidez" },
  { value: "Solvencia",     label: "Solvencia" },
  { value: "Rentabilidad",  label: "Rentabilidad" },
  { value: "Eficiencia",    label: "Eficiencia" },
  { value: "Mercado",       label: "Mercado" },
  { value: "__custom__",    label: "Custom…" },
];

function CategoryPill({ value, onChange, options: optionsProp }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

const options = optionsProp ?? CATEGORY_OPTIONS;
  const display = options.find(o => o.value === value)?.label ?? value ?? "—";
  const showLabel = hover || open;

  return (
    <div ref={ref} className="relative w-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
        style={{ background: "#f8f9ff", border: `1.5px solid ${open ? `${colors.primary}40` : "#e8eaf0"}` }}>
        <span style={{ color: value ? "#1f2937" : "#9ca3af" }}>{display}</span>
        <ChevronDown size={11} style={{
          color: colors.primary,
          opacity: 0.4,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: `transform 280ms ${SPRING}`,
        }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.98)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)",
            animation: `dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)`,
          }}>
          <div className="p-1.5">
          {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{
                    background: selected ? colors.primary : "transparent",
                    color: selected ? "#fff" : "#475569",
                    transition: `background 180ms ${SMOOTH}, color 180ms ${SMOOTH}`,
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <style>{`@keyframes dropdownIn { from { opacity:0; transform:translateY(-6px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
        </div>
      )}
    </div>
  );
}

function DisintegrationOverlay() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const W = canvas.width = parent.offsetWidth;
    const H = canvas.height = parent.offsetHeight;
    const ctx = canvas.getContext("2d");

    // Sample the parent's visual content via html2canvas-style approach
    // Since we can't do that easily, build dense grid of colored particles
    const COLS = 40, ROWS = 20;
    const pw = W / COLS, ph = H / ROWS;
    const particles = [];

    // Color palette sampled from common card colors
    const colors = [
      "#1a2f8a","#3b54b8","#6b7280","#9ca3af","#e5e7eb",
      "#eef1fb","#f8f9ff","#ffffff","#d1d5db","#4f63c2"
    ];

    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const x = col * pw + pw / 2;
        const y = row * ph + ph / 2;
        // Stagger delay from left to right + slight random
        const delay = (col / COLS) * 0.6 + Math.random() * 0.25;
        // Each particle explodes rightward and downward (Thanos style)
        const spread = Math.random() * 0.4 + 0.8;
        const vx = (Math.random() * 2 + 1) * spread;
        const vy = (Math.random() * 1.5 - 0.3) * spread;
        const size = Math.random() * (pw * 0.6) + 1.5;
        const color = colors[Math.floor(Math.random() * colors.length)];
        // Darker particles for text/border areas
        const isDark = col < 6 || row < 3;
        particles.push({ x, y, ox: x, oy: y, vx, vy, size, delay,
          color: isDark ? "#1a2f8a" : color, alpha: 1, rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.3 });
      }
    }

    let start = null;
    const DURATION = 1400;

    const animate = (ts) => {
      if (!start) start = ts;
      const elapsed = (ts - start) / DURATION;
      ctx.clearRect(0, 0, W, H);

      let anyAlive = false;
      particles.forEach(p => {
        const t = Math.max(0, elapsed - p.delay);
        if (t <= 0) {
          anyAlive = true;
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.ox - p.size / 2, p.oy - p.size / 2, p.size, p.size);
          return;
        }
        const progress = Math.min(1, t / (1 - Math.min(p.delay, 0.7)));
        p.alpha = Math.max(0, 1 - Math.pow(progress, 1.8));
        if (p.alpha <= 0) return;
        anyAlive = true;

        const px = p.ox + p.vx * progress * W * 0.5;
        const py = p.oy + p.vy * progress * H * 0.5 + progress * progress * H * 0.12;
        const s = p.size * (1 - progress * 0.4);
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(px, py);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      });

      ctx.globalAlpha = 1;
      if (anyAlive && elapsed < 2.5) requestAnimationFrame(animate);
      else ctx.clearRect(0, 0, W, H);
    };

    requestAnimationFrame(animate);
  }, []);

return (
    <canvas ref={canvasRef}
      className="absolute inset-0 rounded-xl pointer-events-none"
  style={{ zIndex: 10, width: "100%", height: "100%", animation: "disintCanvasFade 1.6s ease-out forwards" }} />
  );
}

function TagInput({ tag, setTag, allLocalKpis }) {
  const existingTags = [...new Set(allLocalKpis.map(k => k.tag).filter(t => t && t !== "__library__" && !t.startsWith("__")))].sort();
  const [tagOpen, setTagOpen] = useState(false);
  const tagRef = useRef(null);
  useEffect(() => {
    const h = e => { if (tagRef.current && !tagRef.current.contains(e.target)) setTagOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={tagRef} className="relative">
      <div className="flex rounded-xl overflow-hidden" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
        <input value={tag} onChange={e => setTag(e.target.value)}
          placeholder="e.g. Core, Deuda…"
          className="flex-1 px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none bg-transparent"
          onFocus={e => e.currentTarget.parentElement.style.borderColor = "#1a2f8a40"}
          onBlur={e => e.currentTarget.parentElement.style.borderColor = "#e8eaf0"} />
        {existingTags.length > 0 && (
          <button type="button" onClick={() => setTagOpen(o => !o)}
            className="px-2 flex items-center justify-center border-l border-gray-200 hover:bg-gray-100 transition-colors flex-shrink-0">
            <ChevronDown size={11} className={`text-gray-400 transition-transform ${tagOpen ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {tagOpen && existingTags.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)" }}>
          <div className="p-1.5 max-h-48 overflow-y-auto">
            {existingTags.map(t => (
              <button key={t} type="button"
                onClick={() => { setTag(t); setTagOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 transition-all"
                style={{ background: tag === t ? "#1a2f8a" : "transparent", color: tag === t ? "#fff" : "#475569" }}
                onMouseEnter={e => { if (tag !== t) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                onMouseLeave={e => { if (tag !== t) e.currentTarget.style.background = "transparent"; }}>
                {t}
                {tag === t && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiEditorModal({ kpi, onSave, onClose, onReset, onEditLibraryKpi, onDeleteLibraryKpi, onDuplicate, kpiList, allLocalKpis = [], systemKpis = [], accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), currentUserId, dimsByAccount = new Map() }) {
  const [mode, setMode] = useState(kpi ? "custom" : "library");

  const [label, setLabel] = useState(kpi?.label ?? "");
  const [description, setDescription] = useState(kpi?.description ?? "");
const [format] = useState(kpi?.format ?? "currency");
  const [category, setCategory] = useState(kpi?.category ?? "");
const [formula, setFormula] = useState(() => {
    if (!kpi?.formula) return null;
    // If already text type, use as-is
    if (kpi.formula.type === "text") return kpi.formula;
    // Convert AST to text type so TextFormulaBuilder can render it
    const astToText = (node) => {
      if (!node) return { expr: "0", vars: {} };
      if (node.type === "cc") return { expr: "A", vars: { A: { type: "cc", tag: node.tag } } };
      if (node.type === "ref") return { expr: "A", vars: { A: { type: "ref", kpiId: node.kpiId } } };
      if (node.type === "manual") return { expr: String(node.value ?? 0), vars: {} };
      if (node.type === "account") return { expr: "A", vars: { A: { type: "account", accountCode: node.accountCode } } };
      if (node.type === "accountGroup") return { expr: "A", vars: { A: { type: "accountGroup", prefix: node.prefix } } };
if (node.type === "op") {
        const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        const l = astToText(node.left);
        const r = astToText(node.right);
        const sym = { "+": "+", "-": "-", "*": "*", "/": "/" }[node.op] ?? node.op;
        const usedLetters = new Set(Object.keys(l.vars));
        const remapR = {};
        const rVarMap = {};
        Object.entries(r.vars).forEach(([letter, val]) => {
          let newLetter = letter;
          if (usedLetters.has(letter)) {
            newLetter = allLetters.find(ll => !usedLetters.has(ll) && !Object.values(rVarMap).includes(ll)) ?? letter;
          }
          usedLetters.add(newLetter);
          rVarMap[letter] = newLetter;
          remapR[newLetter] = val;
        });
        const rExpr = r.expr.replace(/[A-Z]/g, m => rVarMap[m] ?? m);
        return { expr: `(${l.expr} ${sym} ${rExpr})`, vars: { ...l.vars, ...remapR } };
      }
      if (node.type === "fn") {
        const inner = astToText(node.arg);
        if (node.fn === "neg") return { expr: `-(${inner.expr})`, vars: inner.vars };
        if (node.fn === "abs") return { expr: `Math.abs(${inner.expr})`, vars: inner.vars };
        if (node.fn === "pct") return { expr: `(${inner.expr}) * 100`, vars: inner.vars };
        return inner;
      }
      return { expr: "0", vars: {} };
    };
    const { expr, vars } = astToText(kpi.formula);
    return { type: "text", expression: expr, variables: vars };
  });
const [tab, setTab] = useState(kpi ? "builder" : "presets");
const [customCategoryLabel, setCustomCategoryLabel] = useState("");
const [benchmark, setBenchmark] = useState(() => {
    const b = kpi?.benchmark;
    return {
      unhealthy: { min: b?.unhealthy?.min ?? "", max: b?.unhealthy?.max ?? "" },
      healthy:   { min: b?.healthy?.min   ?? "", max: b?.healthy?.max   ?? "" },
      vhealthy:  { min: b?.vhealthy?.min  ?? "", max: b?.vhealthy?.max  ?? "" },
    };
  });
const [tag, setTag] = useState(kpi?.tag ?? "");
const [libSearch, setLibSearch] = useState("");
  const [libCatFilter, setLibCatFilter] = useState(null);
const [libTagFilter, setLibTagFilter] = useState(null);
const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [disintegratingId, setDisintegratingId] = useState(null);
const [removedIds, setRemovedIds] = useState(new Set());
const [dupeLabelWarning, setDupeLabelWarning] = useState(false);
const [formulaWarning, setFormulaWarning] = useState(null);
  useEffect(() => {
    if (document.getElementById("disint-style")) return;
    const s = document.createElement("style");
    s.id = "disint-style";
    s.textContent = `@keyframes disintCanvasFade { 0%{opacity:1} 85%{opacity:1} 100%{opacity:0} }`;
    document.head.appendChild(s);
  }, []);

const otherKpis = useMemo(() => {
    const seen = new Set();
    const result = [];
    // systemKpis first (built-in), then custom library — dedup by id
    [...(systemKpis ?? []), ...(allLocalKpis ?? [])].forEach(k => {
      if (k.id !== kpi?.id && !seen.has(k.id)) { seen.add(k.id); result.push(k); }
    });
    return result;
  }, [systemKpis, allLocalKpis, kpi?.id]);

const validateFormula = (f) => {
    if (!f) return "No hay fórmula definida.";
    if (f.type === "text") {
      const unassigned = Object.entries(f.variables ?? {}).filter(([, v]) => !v).map(([k]) => k);
      if (unassigned.length > 0) return `Variables sin asignar: ${unassigned.join(", ")}`;
      if (!f.expression?.trim()) return "La expresión está vacía.";
      try {
        let expr = f.expression;
        Object.keys(f.variables ?? {}).forEach(letter => { expr = expr.replaceAll(letter, "(1)"); });
        Function(`"use strict"; return (${expr})`)();
      } catch (e) {
        return `Expresión inválida: ${e.message}`;
      }
      const usedLetters = [...(f.expression ?? "").matchAll(/[A-Z]/g)].map(m => m[0]);
      const definedLetters = new Set(Object.keys(f.variables ?? {}));
      const undefinedLetters = [...new Set(usedLetters)].filter(l => !definedLetters.has(l));
      if (undefinedLetters.length > 0) return `Letras sin mapear: ${undefinedLetters.join(", ")}`;
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
<div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        style={{ boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}
onClick={e => e.stopPropagation()}>

{dupeLabelWarning && (
  <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl"
    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6"
      style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: "#fef3c7" }}>
        <AlertTriangle size={22} style={{ color: "#d97706" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-black text-gray-900 mb-1">Nombre duplicado</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Ya existe un KPI llamado <span className="font-black text-gray-700">"{label.trim()}"</span>.<br />
          Por favor elige un nombre único antes de guardar.
        </p>
      </div>
      <button
        onClick={() => setDupeLabelWarning(false)}
        className="w-full py-2.5 rounded-xl text-xs font-black text-white transition-all"
        style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)" }}>
        Entendido
      </button>
    </div>
  </div>
)}
{formulaWarning && (
  <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl"
    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6"
      style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: "#fee2e2" }}>
        <AlertTriangle size={22} style={{ color: "#dc2626" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-black text-gray-900 mb-1">Fórmula inválida</p>
        <p className="text-xs text-gray-400 leading-relaxed">{formulaWarning}</p>
      </div>
      <div className="flex gap-2 w-full">
        <button
          onClick={() => setFormulaWarning(null)}
          className="flex-1 py-2.5 rounded-xl text-xs font-black transition-all"
          style={{ background: "#f3f4f6", color: "#6b7280" }}>
          Corregir
        </button>
        <button
          onClick={() => {
            setFormulaWarning(null);
            onSave({ label: label.trim(), description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula });
          }}
          className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all"
          style={{ background: "#dc2626" }}>
          Guardar igual
        </button>
      </div>
    </div>
  </div>
)}

{/* Header */}
<div className="px-6 pt-6 pb-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">

            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 relative"
              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "0 6px 16px -4px rgba(26,47,138,0.5)" }}>
              <Sigma size={16} className="text-white" />
              {kpi?._isOverridden && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-violet-500 border-2 border-white" />
              )}
            </div>
            <div>
              <p className="font-black text-[15px] text-gray-900 leading-tight">
                {kpi ? kpi.label : mode === "library" ? "KPI Selector" : "New KPI"}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] mt-0.5"
                style={{ color: kpi ? (builtInIds.has(kpi.id) ? "#6d28d9" : "#16a34a") : "#9ca3af" }}>
                {kpi ? (builtInIds.has(kpi.id) ? "⚙ System KPI" : "✦ Custom KPI") : "Library or custom formula"}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "#f3f4f6", color: "#6b7280" }}>
            <X size={13} />
          </button>
        </div>
        <div className="h-px mx-6 mb-1" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />

{/* Library mode */}
{mode === "library" && (
<LibraryPicker
    onSave={(data) => {
      if (data === "__custom__") {
        setMode("customList");
      } else {
        onSave(data);
      }
    }}
    onDuplicate={onDuplicate}
  />
)}
{/* Custom KPI list mode */}
{mode === "customList" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Search + category filter */}
            <div className="px-5 pb-3 flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 flex-1 rounded-xl px-3 py-2"
                style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
                <Search size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />
                <input
                  type="text"
                  value={libSearch}
                  onChange={e => setLibSearch(e.target.value)}
                  placeholder="Search KPIs…"
                  className="flex-1 text-xs font-semibold text-gray-700 outline-none bg-transparent"
                />
                {libSearch && (
                  <button onClick={() => setLibSearch("")}>
                    <X size={10} style={{ color: "#9ca3af" }} />
                  </button>
                )}
              </div>
<LibCategoryPill value={libCatFilter} onChange={setLibCatFilter} />
              <LibTagPill value={libTagFilter} onChange={setLibTagFilter} allLocalKpis={allLocalKpis} />
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-5">
             {(() => {
const filtered = allLocalKpis.filter(k => {
                  if (removedIds.has(k.id)) return false;
                  if (k.tag === "__library__") return false;
                  const matchSearch = !libSearch.trim() || k.label.toLowerCase().includes(libSearch.toLowerCase()) || (k.description ?? "").toLowerCase().includes(libSearch.toLowerCase());
                  const matchCat = !libCatFilter || k.category === libCatFilter;
                  const matchTag = !libTagFilter || k.tag === libTagFilter;
                  return matchSearch && matchCat && matchTag;
                });
                return filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#eef1fb] flex items-center justify-center mb-3">
                    <Sigma size={20} className="text-[#1a2f8a]/40" />
                  </div>
                  <p className="text-xs font-black text-gray-400">Aún no hay KPIs personalizados</p>
                  <p className="text-[10px] text-gray-300 mt-1">Crea tu primero con el botón de abajo</p>
                </div>
) : (
<div className="grid grid-cols-2 gap-2 mb-4 pt-2">
                  {filtered.map(k => (
<div key={k.id}
  onClick={() => (confirmDeleteId === k.id || disintegratingId === k.id) ? null : onSave(k)}
  className={`relative flex flex-col rounded-xl border transition-all group overflow-hidden ${
    disintegratingId === k.id ? "border-gray-100 cursor-default p-4" :
    confirmDeleteId === k.id ? "border-red-200 bg-red-50 cursor-pointer p-4" :
    "border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb]/50 p-4 cursor-pointer"
  }`}
style={{
    pointerEvents: disintegratingId === k.id ? "none" : "auto",
    opacity: disintegratingId === k.id ? 0 : 1,
    transition: disintegratingId === k.id ? "opacity 0.4s ease-in 0.2s" : "none",
  }}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <p className="text-sm font-black text-[#1a2f8a] leading-snug">{k.label}</p>
                            <span className={`flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md ${k.format === "percent" ? "bg-emerald-50 text-emerald-700" : k.format === "currency" ? "bg-[#eef1fb] text-[#1a2f8a]" : "bg-gray-50 text-gray-500"}`}>
                              {k.format === "percent" ? "%" : k.format === "currency" ? "€" : "#"}
                            </span>
                          </div>
                          {k.description && <p className="text-[12px] text-gray-400 leading-snug">{k.description}</p>}
                          {k.category && <p className="text-[11px] text-gray-300 mt-0.5 uppercase tracking-wider font-bold">{k.category}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mb-2">
{k._createdBy && (
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-black text-white"
                              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)" }}>
{k._createdBy === currentUserId ? "Y" : "U"}
                            </div>
                            <span className="text-[11px] text-gray-300 font-bold">
                              {k._createdBy === currentUserId ? "Created by you" : "Created by teammate"}
                            </span>
                          </div>
                        )}
                        {k._updatedAt && (
                          <span className="text-[11px] text-gray-300 font-bold ml-auto">
                            {new Date(k._updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
<div className="flex items-center justify-end gap-1.5 mt-auto pt-2 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button onClick={(e) => { e.stopPropagation(); onDuplicate?.({ ...k, label: k.label + " 2" }); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                          style={{ background: "#f3f4f6", color: "#6b7280" }}
                          title="Duplicate">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onEditLibraryKpi?.(k); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                          style={{ background: "#eef1fb", color: "#1a2f8a" }}>
                          <Edit3 size={10} />
                        </button>
{confirmDeleteId !== k.id && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(k.id); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                            style={{ background: "#fee2e2", color: "#dc2626" }}>
                            <Trash2 size={10} />
                          </button>
                        )}
</div>
{disintegratingId === k.id && (
                      <>
                        <div className="absolute inset-0 rounded-xl z-[9]"
                          style={{ animation: "disintFade 1.4s ease-in forwards" }} />
                        <DisintegrationOverlay />
                        <style>{`@keyframes disintFade { 0% { background: transparent; } 30% { background: rgba(255,255,255,0); } 100% { background: rgba(255,255,255,1); } }`}</style>
                      </>
                    )}
                    {confirmDeleteId === k.id && (
                      <div className="absolute inset-0 rounded-xl flex flex-col items-center justify-center gap-3 p-4"
                        style={{ background: "rgba(254,242,242,0.97)", backdropFilter: "blur(4px)" }}
                        onClick={e => e.stopPropagation()}>
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                          <Trash2 size={16} className="text-red-500" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-black text-red-700">¿Eliminar KPI?</p>
                          <p className="text-[10px] text-red-400 mt-0.5 leading-snug">"{k.label}" será eliminado permanentemente</p>
                        </div>
                        <div className="flex gap-2 w-full">
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            className="flex-1 py-2 rounded-xl text-xs font-black transition-all hover:scale-105"
                            style={{ background: "#f3f4f6", color: "#6b7280" }}>
                            Cancelar
                          </button>
<button onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                            setDisintegratingId(k.id);
                            setTimeout(() => {
                              setRemovedIds(prev => new Set([...prev, k.id]));
                              onDeleteLibraryKpi?.(k.id);
                              setDisintegratingId(null);
                            }, 1600);
                          }}
                            className="flex-1 py-2 rounded-xl text-xs font-black text-white transition-all hover:scale-105"
                            style={{ background: "#dc2626", boxShadow: "0 4px 12px -2px rgba(220,38,38,0.4)" }}>
                            Eliminar
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  ))}
</div>
              );
              })()}
            </div>
            <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setMode("custom")}
                className="w-full py-2.5 rounded-xl bg-[#1a2f8a] text-white text-xs font-black hover:bg-[#1a2f8a]/90 transition-all flex items-center justify-center gap-2">
                <Plus size={12} /> Crear nuevo KPI personalizado
              </button>
            </div>
          </div>
        )}

{/* Custom builder mode */}
        {mode === "custom" && (
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

{/* Label + Category side by side */}
<div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Label *</label>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. EBITDA Margin"
                className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
                style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}
                onFocus={e => e.target.style.borderColor = "#1a2f8a40"}
                onBlur={e => e.target.style.borderColor = "#e8eaf0"} />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Category</label>
{(() => {
  const existingCategories = [...new Set(allLocalKpis.map(k => k.category).filter(c => c && c !== "__custom__"))].sort();
  const dynamicOptions = [
    { value: "Liquidez",     label: "Liquidez" },
    { value: "Solvencia",    label: "Solvencia" },
    { value: "Rentabilidad", label: "Rentabilidad" },
    { value: "Eficiencia",   label: "Eficiencia" },
    { value: "Mercado",      label: "Mercado" },
    ...existingCategories
      .filter(c => !["Liquidez","Solvencia","Rentabilidad","Eficiencia","Mercado"].includes(c))
      .map(c => ({ value: c, label: c })),
    { value: "__custom__", label: "Custom…" },
  ];
  return (
    <CategoryPill
      value={category}
      onChange={v => { setCategory(v); if (v !== "__custom__") setCustomCategoryLabel(""); }}
      options={dynamicOptions}
    />
  );
})()}
              {category === "__custom__" && (
                <input value={customCategoryLabel} onChange={e => setCustomCategoryLabel(e.target.value)}
                  placeholder="Category name"
                  className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none mt-2"
                  style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this KPI measure?"
                className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
                style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}
                onFocus={e => e.target.style.borderColor = "#1a2f8a40"}
                onBlur={e => e.target.style.borderColor = "#e8eaf0"} />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Tag</label>
<TagInput tag={tag} setTag={setTag} allLocalKpis={allLocalKpis} />
            </div>
          </div>



{/* Formula */}
          <div>
<div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Formula</label>
              {!kpi && (
                <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "#f0f0f0" }}>
                  <button onClick={() => setTab("presets")} className={`px-3 py-1 rounded-md text-[10px] font-black transition-all ${tab === "presets" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400"}`}>Presets</button>
                  <button onClick={() => setTab("builder")} className={`px-3 py-1 rounded-md text-[10px] font-black transition-all ${tab === "builder" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400"}`}>Builder</button>
                </div>
              )}
            </div>

{tab === "presets" ? (
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p, i) => (
                  <button key={i} onClick={() => { setFormula(JSON.parse(JSON.stringify(p.formula))); setTab("builder"); }}
                    className="text-left p-3 rounded-xl border border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb] transition-all group">
                    <p className="text-xs font-black text-[#1a2f8a]">{p.label}</p>
                  </button>
                ))}
              </div>
) : (
              <div className="bg-[#f8f9ff] rounded-xl border border-gray-100 p-4 min-h-[80px]">
<TextFormulaBuilder
                  formula={formula?.type === "text" ? formula : null}
                  onChange={setFormula}
                  kpiList={otherKpis}
                  accountCodes={accountCodes}
                  accountCodeLabels={accountCodeLabels}
                  builtInIds={builtInIds}
                  dimsByAccount={dimsByAccount}
                />
              </div>
            )}
          </div>


{/* Benchmark ranges */}
<div>
  <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-2 block" style={{ color: "#9ca3af" }}>Benchmark Ranges</label>
  <div className="flex flex-col gap-1.5">
    {[
      { key: "unhealthy", label: "Unhealthy", accent: "#dc2626", bg: "#fff8f8" },
      { key: "healthy",   label: "Healthy",   accent: "#16a34a", bg: "#f8fff9" },
      { key: "vhealthy",  label: "Excellent", accent: "#1a2f8a", bg: "#f8f9ff" },
    ].map(({ key, label, accent, bg }) => (
      <div key={key} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: bg }}>
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
        <span className="text-[10px] font-black uppercase tracking-wider flex-shrink-0" style={{ color: accent, width: 68 }}>{label}</span>
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[9px] font-black text-gray-300 flex-shrink-0">MIN</span>
          <input
            value={benchmark[key].min}
            onChange={e => setBenchmark(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value } }))}
            placeholder="—"
            className="w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all"
            style={{ background: "rgba(0,0,0,0.04)", color: "#1f2937" }}
            onFocus={e => { e.target.style.background = "#fff"; e.target.style.boxShadow = `0 0 0 2px ${accent}30`; }}
            onBlur={e => { e.target.style.background = "rgba(0,0,0,0.04)"; e.target.style.boxShadow = "none"; }}
          />
          <span className="text-[9px] font-black text-gray-300 flex-shrink-0">MAX</span>
          <input
            value={benchmark[key].max}
            onChange={e => setBenchmark(prev => ({ ...prev, [key]: { ...prev[key], max: e.target.value } }))}
            placeholder="—"
            className="w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all"
            style={{ background: "rgba(0,0,0,0.04)", color: "#1f2937" }}
            onFocus={e => { e.target.style.background = "#fff"; e.target.style.boxShadow = `0 0 0 2px ${accent}30`; }}
            onBlur={e => { e.target.style.background = "rgba(0,0,0,0.04)"; e.target.style.boxShadow = "none"; }}
          />
        </div>
      </div>
    ))}
  </div>
</div>

        </div>
        )}


        {/* Footer — only for custom mode */}
{mode === "custom" && (
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex flex-col gap-2"
          style={{ background: "rgba(248,249,255,0.8)" }}>
<button onClick={() => {
            const allLabels = new Set([
              ...(allLocalKpis ?? []).map(k => k.label),
              ...(systemKpis ?? []).map(k => k.label),
            ]);
            if (kpi) allLabels.delete(kpi.label);
            const finalLabel = label.trim();
            const finalLabelLower = finalLabel.toLowerCase();
            if ([...allLabels].some(l => l.toLowerCase() === finalLabelLower)) {
              setDupeLabelWarning(true);
              return;
            }
            const formulaErr = validateFormula(formula);
            if (formulaErr) {
              setFormulaWarning(formulaErr);
              return;
            }
            onSave({ label: finalLabel, description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula });
          }}
            disabled={!label}
            className="w-full py-3 rounded-xl text-xs font-black transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", color: "white", boxShadow: "0 4px 14px -4px rgba(26,47,138,0.5)" }}>
            <Check size={12} /> {kpi ? "Save Changes" : "Create KPI"}
          </button>
          {kpi?._isOverridden && onReset && (
            <button onClick={() => { onReset(kpi.id); onClose(); }}
              className="w-full py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 hover:opacity-80"
              style={{ background: "#fee2e2", color: "#dc2626" }}>
              ↺ Reset to factory defaults
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

// ── Graph Section Component ───────────────────────────────────────────────────
// ── Graph Section Component ───────────────────────────────────────────────────
function GraphSection({
  sectionId, token, source, structure, year, month,
  sourceOpts, structureOpts, companyCodes, dimensions,
  kpiList, allKpis,
  ccTagToCodes, sectionCodes, sumAccountCodes,
  defaultCompany, defaultKpiIds,
  onStateChange,
  companyLegalName,
  viewPeriod,
  compareMode,
  filterStyle, colors, body1Style, body2Style,
}) {
  // Default: end = anchor year/month, start = 12 months earlier
  const anchorY = parseInt(year) || new Date().getFullYear();
  const anchorM = parseInt(month) || new Date().getMonth() + 1;
  let startY = anchorY, startM = anchorM - 11;
  while (startM < 1) { startM += 12; startY -= 1; }

 const [secCompanies, setSecCompanies] = useState(defaultCompany ? [defaultCompany] : []);
  const [secStartYear, setSecStartYear] = useState(String(startY));
  const [secStartMonth, setSecStartMonth] = useState(String(startM));
  const [secEndYear, setSecEndYear] = useState(String(anchorY));
  const [secEndMonth, setSecEndMonth] = useState(String(anchorM));
  const [secSource, setSecSource] = useState(source);
  const [secStructure, setSecStructure] = useState(structure);
  const [secDimGroup, setSecDimGroup] = useState("");
  const [secDim, setSecDim] = useState("");
const secMode = viewPeriod === "ytd" ? "ytd" : "monthly";
const [secXAxis, setSecXAxis] = useState("month");
const [cmpBars, setCmpBars] = useState([
    { id: "B", companies: [], source, structure, startYear: String(startY), startMonth: String(startM), endYear: String(anchorY), endMonth: String(anchorM), dimGroup: "", dim: "" },
    { id: "C", companies: [], source, structure, startYear: String(startY), startMonth: String(startM), endYear: String(anchorY), endMonth: String(anchorM), dimGroup: "", dim: "" },
  ]);
  const [cmpChartData, setCmpChartData] = useState({});
  const updateCmpBar = (id, patch) => setCmpBars(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeCmpBar = (id) => setCmpBars(prev => prev.filter(b => b.id !== id));

  const [secKpiIds, setSecKpiIds] = useState(defaultKpiIds || []);
const [kpiPickerOpen, setKpiPickerOpen] = useState(false);
  const [kpiSearch, setKpiSearch] = useState("");
  const [kpiPickerRect, setKpiPickerRect] = useState(null);
  const kpiPickerRef = useRef(null);

const [chartData, setChartData] = useState([]);

  const [loading, setLoading] = useState(false);
const [tableOpen, setTableOpen] = useState(true);
  const chartContainerRef = useRef(null);

  useEffect(() => {
    const h = e => { if (kpiPickerRef.current && !kpiPickerRef.current.contains(e.target)) setKpiPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

// Dim groups derived from the prop dimensions (or fall back to nothing)
  const secDimGroups = useMemo(() => {
    const seen = new Set();
    const groups = [];
    dimensions.forEach(d => {
      const g = d.DimensionGroup ?? d.dimensionGroup ?? "";
      if (g && !seen.has(g)) { seen.add(g); groups.push(g); }
    });
    return groups.sort();
  }, [dimensions]);

  const secGroupDimOptions = useMemo(() => {
    if (!secDimGroup) return [];
    return dimensions
      .filter(d => (d.DimensionGroup ?? d.dimensionGroup ?? "") === secDimGroup)
      .map(d => ({ code: d.DimensionCode ?? d.dimensionCode ?? "", name: d.DimensionName ?? d.dimensionName ?? "" }))
      .filter(d => d.code);
  }, [dimensions, secDimGroup]);

  const secGroupDimCodes = useMemo(() => {
    if (secDim) return new Set([secDim]);
    if (!secDimGroup) return null;
    return new Set(secGroupDimOptions.map(d => d.code));
  }, [secDimGroup, secDim, secGroupDimOptions]);

// secAdaptedKpis removed — kpiList is already standard-resolved by KpiResolver.

  // Build list of periods [start..end] inclusive (oldest first), plus one prior for monthly deltas
  const periods = useMemo(() => {
    const sY = parseInt(secStartYear), sM = parseInt(secStartMonth);
    const eY = parseInt(secEndYear),   eM = parseInt(secEndMonth);
    if (!sY || !sM || !eY || !eM) return [];
    const list = [];
    // Prior period (for monthly delta at first displayed month)
    let pY = sY, pM = sM - 1;
    if (pM < 1) { pM = 12; pY -= 1; }
    list.push({ y: pY, m: pM, isPrior: true });
    // Main range
    let y = sY, m = sM;
    while (y < eY || (y === eY && m <= eM)) {
      list.push({ y, m, isPrior: false });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (list.length > 120) break; // safety
    }
    return list;
  }, [secStartYear, secStartMonth, secEndYear, secEndMonth]);

  const fetchChartData = useCallback(async () => {
    if (!token || !secSource || !secStructure || !secCompanies?.length || periods.length < 2) { setChartData([]); return; }
    setLoading(true);

    try {
      const results = await Promise.all(periods.map(async ({ y, m, isPrior }) => {
      const companyFilter = secCompanies.map(c => `CompanyShortName eq '${c}'`).join(" or ");
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and (${companyFilter})`;
        const res = await fetch(
          `/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );
        if (!res.ok) return { y, m, isPrior, pivot: new Map(), hasData: false };
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
const p = new Map();
rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (sumAccountCodes && sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;

if (secDim || secDimGroup) {
            const dimPairs = parseDimensions(r.Dimensions);
            if (secDim) {
              const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
              if (!rowDimCodes.has(secDim)) return;
            } else if (secDimGroup) {
              const hasGroupMatch = dimPairs.some(([g]) => g === secDimGroup);
              if (!hasGroupMatch) return;
            }
          }
          const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          p.set(ac, (p.get(ac) ?? 0) + amt);
        });
        return { y, m, isPrior, pivot: p, hasData: rows.length > 0 };
      }));

      // Build chart series
      const series = [];
      for (let i = 1; i < results.length; i++) {
        const curr = results[i];
        if (curr.isPrior) continue;

        let pivotForKpi;
        if (secMode === "ytd") {
          pivotForKpi = curr.pivot;
        } else {
          // monthly delta
          const prev = results[i - 1];
          const mp = new Map();
          const allCodes = new Set([...curr.pivot.keys(), ...prev.pivot.keys()]);
          allCodes.forEach(ac => {
            const currYTD = curr.pivot.get(ac) ?? 0;
            const prevYTD = curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0);
            mp.set(ac, currYTD - prevYTD);
          });
          pivotForKpi = mp;
        }

const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, allKpis);
        const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
        const row = { period: label, _hasData: curr.hasData };
        secKpiIds.forEach(kid => {
          const v = kpis.get(kid);
          row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v;
        });
        series.push(row);
      }

      setChartData(series);
    } catch (e) {
      console.error("Graph fetch error:", e);
    } finally {
      setLoading(false);
    }
}, [token, secSource, secStructure, secCompanies, periods, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, sumAccountCodes, secMode, secGroupDimCodes]);

useEffect(() => { fetchChartData(); }, [fetchChartData]);

useEffect(() => {
    if (!compareMode || !token) { setCmpChartData({}); return; }
    cmpBars.forEach(bar => {
      if (!bar.source || !bar.structure || !bar.companies?.length) return;
      const sY = parseInt(bar.startYear), sM = parseInt(bar.startMonth);
      const eY = parseInt(bar.endYear), eM = parseInt(bar.endMonth);
      if (!sY || !sM || !eY || !eM) return;
      const list = [];
      let pY = sY, pM = sM - 1;
      if (pM < 1) { pM = 12; pY -= 1; }
      list.push({ y: pY, m: pM, isPrior: true });
      let y = sY, m = sM;
      while (y < eY || (y === eY && m <= eM)) {
        list.push({ y, m, isPrior: false });
        m += 1; if (m > 12) { m = 1; y += 1; }
        if (list.length > 120) break;
      }
      (async () => {
        try {
          const results = await Promise.all(list.map(async ({ y, m, isPrior }) => {
            const cf = bar.companies.map(c => `CompanyShortName eq '${c}'`).join(" or ");
            const filter = `Year eq ${y} and Month eq ${m} and Source eq '${bar.source}' and GroupStructure eq '${bar.structure}' and (${cf})`;
            const res = await fetch(`/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
              { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
            if (!res.ok) return { y, m, isPrior, pivot: new Map() };
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            const p = new Map();
            rows.forEach(r => {
              const ac = r.AccountCode ?? r.accountCode ?? "";
              const acType = r.AccountType ?? r.accountType ?? "";
              if (!ac || (sumAccountCodes && sumAccountCodes.has(ac)) || (acType && acType !== "P/L")) return;
              if (bar.dim) {
                if (!parseDimensions(r.Dimensions).some(([, code]) => code === bar.dim)) return;
              } else if (bar.dimGroup) {
                if (!parseDimensions(r.Dimensions).some(([g]) => g === bar.dimGroup)) return;
              }
              p.set(ac, (p.get(ac) ?? 0) + parseAmt(r.AmountYTD ?? r.amountYTD ?? 0));
            });
            return { y, m, isPrior, pivot: p };
          }));
          const series = [];
          for (let i = 1; i < results.length; i++) {
            const curr = results[i];
            if (curr.isPrior) continue;
            let pivot;
            if (secMode === "ytd") {
              pivot = curr.pivot;
            } else {
              const prev = results[i - 1];
              const mp = new Map();
              new Set([...curr.pivot.keys(), ...prev.pivot.keys()]).forEach(ac => {
                mp.set(ac, (curr.pivot.get(ac) ?? 0) - (curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0)));
              });
              pivot = mp;
            }
            const kpis = computeAllKpisResolved(kpiList, pivot, ccTagToCodes, sectionCodes, allKpis);
            const row = { period: `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}` };
            secKpiIds.forEach(kid => { const v = kpis.get(kid); row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v; });
            series.push(row);
          }
          setCmpChartData(prev => ({ ...prev, [bar.id]: series }));
        } catch (e) { console.error("Cmp fetch error:", e); }
      })();
    });
  }, [compareMode, cmpBars, token, secMode, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, sumAccountCodes]);


  // Expose state up to parent for export
  useEffect(() => {
    if (onStateChange) {
      onStateChange(sectionId, {
        sectionId,
   company: Array.isArray(secCompanies) ? secCompanies.join(", ") : "",
        startY: secStartYear, startM: secStartMonth,
        endY: secEndYear, endM: secEndMonth,
        source: secSource, structure: secStructure,
        dimGroup: secDimGroup, dim: secDim,
        mode: secMode, kpiIds: secKpiIds,
        chartData,
        chartContainerRef,
      });
    }
}, [sectionId, secCompanies, secStartYear, secStartMonth, secEndYear, secEndMonth,
      secSource, secStructure, secDimGroup, secDim, secMode, secKpiIds, chartData, onStateChange]);

const COLORS = [
    colors?.primary,
    colors?.secondary,
    colors?.tertiary,
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];

const toggleKpi = (id) => {
    setSecKpiIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };



  const allPickerKpis = useMemo(() => {
    const seen = new Set();
    const result = [];
    [...(allKpis ?? []), ...(kpiList ?? [])].forEach(k => {
      if (!seen.has(k.id)) { seen.add(k.id); result.push(k); }
    });
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [allKpis, kpiList]);

const graphFilters = [
{ label: "Company", values: secCompanies, onChange: setSecCompanies, options: companyCodes.map(c => ({ value: c, label: companyLegalName(c) })), multiselect: true },
    { label: "Start M", value: secStartMonth, onChange: setSecStartMonth, options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
    { label: "Start Y", value: secStartYear, onChange: setSecStartYear, options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
    { label: "End M", value: secEndMonth, onChange: setSecEndMonth, options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
    { label: "End Y", value: secEndYear, onChange: setSecEndYear, options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
    ...(sourceOpts.length > 0 ? [{ label: "Source", value: secSource, onChange: setSecSource, options: sourceOpts }] : []),
    ...(structureOpts.length > 0 ? [{ label: "Structure", value: secStructure, onChange: setSecStructure, options: structureOpts }] : []),
    ...(secDimGroups.length > 0 ? [{ label: "Dim Grp", value: secDimGroup, onChange: v => { setSecDimGroup(v); setSecDim(""); }, options: [{ value: "", label: "Dim Grp" }, ...secDimGroups.map(g => ({ value: g, label: g }))] }] : []),
    ...(secDimGroup && secGroupDimOptions.length > 0 ? [{ label: "Dims", value: secDim, onChange: setSecDim, options: [{ value: "", label: "Dims" }, ...secGroupDimOptions.map(d => ({ value: d.code, label: d.name || d.code }))] }] : []),

  ];
return (
  <div className="flex flex-col gap-3 flex-1 min-h-0">
{/* Filter card — matches compare filter style */}
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 flex-shrink-0"
      style={{ overflow: "visible", position: "relative", zIndex: 30 }}>
      <div className="px-5 py-3 flex items-center gap-2 no-scrollbar" style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "visible" }}>
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${colors?.primary} 0%, #3b54b8 100%)`, boxShadow: `0 4px 12px -4px ${colors?.primary}80` }}>
            <BarChart3 size={14} className="text-white" />
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: colors?.primary }}>Graph</span>
        </div>
{graphFilters.map((f, i) =>
          f.multiselect ? (
            <MultiFilterPill key={i} label={f.label} values={f.values} onChange={f.onChange} options={f.options} colors={colors} />
          ) : (
            <HeaderFilterPill key={i} label={f.label} value={f.value} onChange={f.onChange} options={f.options} />
          )
        )}
        {/* KPI multiselect */}
        <div ref={kpiPickerRef} className="relative flex-shrink-0">
<button onClick={() => {
            const rect = kpiPickerRef.current?.getBoundingClientRect();
            setKpiPickerRect(rect ?? null);
            setKpiPickerOpen(o => !o);
          }}
            className="flex items-center gap-2 rounded-xl select-none"
            style={{ padding: "8px 12px", background: kpiPickerOpen ? "rgba(26,47,138,0.06)" : "transparent", transition: "background 220ms" }}>
            <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.55 }}>KPIs</span>
            <span className="text-xs font-bold" style={{ color: colors?.primary }}>{secKpiIds.length}</span>
            <ChevronDown size={11} style={{ color: colors?.primary, opacity: 0.4, transform: kpiPickerOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
          </button>
{kpiPickerOpen && (() => {
            const systemKpis = allPickerKpis.filter(k => allKpis?.some(s => s.id === k.id) && !kpiList?.some(c => c.id === k.id && c._createdBy));
            const customKpis = allPickerKpis.filter(k => !systemKpis.some(s => s.id === k.id));
            const filtered = (group) => group.filter(k => !kpiSearch.trim() || k.label.toLowerCase().includes(kpiSearch.toLowerCase()));
            const filteredSystem = filtered(systemKpis);
            const filteredCustom = filtered(customKpis);
            return (
              <div className="fixed z-[9999] rounded-2xl overflow-hidden flex flex-col"
                style={{
top: kpiPickerRect ? kpiPickerRect.bottom + 8 : 0,
                  left: kpiPickerRect ? kpiPickerRect.left : 0,
                  width: 280,
                  maxHeight: 380,
                  background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)",
                  border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)"
                }}>
                {/* Search */}
                <div className="px-3 pt-3 pb-2 flex-shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
                    <Search size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />
                    <input
                      autoFocus
                      value={kpiSearch}
                      onChange={e => setKpiSearch(e.target.value)}
                      placeholder="Search KPIs…"
                      className="flex-1 text-xs font-semibold text-gray-700 outline-none bg-transparent"
                    />
                    {kpiSearch && <button onClick={() => setKpiSearch("")}><X size={10} style={{ color: "#9ca3af" }} /></button>}
                  </div>
                </div>
                {/* List */}
                <div className="overflow-y-auto flex-1 px-1.5 pb-1.5" style={{ scrollbarWidth: "none" }}>
                  {filteredSystem.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors?.primary }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.5 }}>System</span>
                      </div>
                      {filteredSystem.map(k => (
                        <button key={k.id} onClick={() => toggleKpi(k.id)}
                          className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                          style={{ background: secKpiIds.includes(k.id) ? "#eef1fb" : "transparent", color: secKpiIds.includes(k.id) ? "#1a2f8a" : "#475569" }}
                          onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f8f9ff"; }}
                          onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                          <span className="truncate">{k.label}</span>
                          {secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0" style={{ color: colors?.primary }} />}
                        </button>
                      ))}
                    </>
                  )}
                  {filteredCustom.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#16a34a" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-600" style={{ opacity: 0.7 }}>Custom</span>
                      </div>
                      {filteredCustom.map(k => (
                        <button key={k.id} onClick={() => toggleKpi(k.id)}
                          className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                          style={{ background: secKpiIds.includes(k.id) ? "#dcfce7" : "transparent", color: secKpiIds.includes(k.id) ? "#15803d" : "#475569" }}
                          onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f0fdf4"; }}
                          onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                          <span className="truncate">{k.label}</span>
                          {secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0 text-emerald-600" />}
                        </button>
                      ))}
                    </>
                  )}
                  {filteredSystem.length === 0 && filteredCustom.length === 0 && (
                    <p className="text-[10px] text-gray-300 text-center py-4 font-bold">No results</p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
{loading && <Loader2 size={12} className="animate-spin ml-2" style={{ color: colors?.primary }} />}
        {compareMode && (() => {
          const CMP_COLORS = ["#CF305D", "#f59e0b"];
          const allIds = ["B", "C"];
          const missingIds = allIds.filter(id => !cmpBars.some(b => b.id === id));
          if (missingIds.length === 0) return null;
          return (
            <div className="flex items-center gap-1 ml-1">
              {missingIds.map((id, i) => {
                const color = CMP_COLORS[allIds.indexOf(id)];
                return (
                  <button key={id} onClick={() => setCmpBars(prev => [...prev, {
                    id,
                    companies: [],
                    source: secSource,
                    structure: secStructure,
                    startYear: secStartYear,
                    startMonth: secStartMonth,
                    endYear: secEndYear,
                    endMonth: secEndMonth,
                    dimGroup: "",
                    dim: "",
                  }])}
                    className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] transition-all hover:scale-105 flex-shrink-0"
                    style={{ background: `${color}12`, color, border: `1px solid ${color}30` }}>
                    <Plus size={9} />
                    {id}
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>
{compareMode && cmpBars.map((bar, bi) => {
        const CMP_COLORS = ["#CF305D", "#f59e0b"];
        const cmpColor = CMP_COLORS[bi % CMP_COLORS.length];
        const cmpDimOptions = bar.dimGroup ? dimensions.filter(d => (d.DimensionGroup ?? d.dimensionGroup ?? "") === bar.dimGroup).map(d => ({ code: d.DimensionCode ?? d.dimensionCode ?? "", name: d.DimensionName ?? d.dimensionName ?? "" })).filter(d => d.code) : [];
        return (
          <div key={bar.id} className="px-5 py-3 flex items-center gap-2 no-scrollbar border-t border-gray-50"
            style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "visible" }}>
            <div className="flex items-center gap-2 mr-2 flex-shrink-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${cmpColor} 0%, ${cmpColor}aa 100%)`, boxShadow: `0 4px 12px -4px ${cmpColor}80` }}>
                <span className="text-white text-[10px] font-black">{bar.id}</span>
              </div>
              <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: cmpColor }}>Compare {bar.id}</span>
            </div>
            <MultiFilterPill label="Company" values={bar.companies} onChange={v => updateCmpBar(bar.id, { companies: v })} options={companyCodes.map(c => ({ value: c, label: companyLegalName(c) }))} colors={{ primary: cmpColor }} />
            <HeaderFilterPill label="Start M" value={bar.startMonth} onChange={v => updateCmpBar(bar.id, { startMonth: v })} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
            <HeaderFilterPill label="Start Y" value={bar.startYear} onChange={v => updateCmpBar(bar.id, { startYear: v })} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
            <HeaderFilterPill label="End M" value={bar.endMonth} onChange={v => updateCmpBar(bar.id, { endMonth: v })} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
            <HeaderFilterPill label="End Y" value={bar.endYear} onChange={v => updateCmpBar(bar.id, { endYear: v })} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
            {sourceOpts.length > 0 && <HeaderFilterPill label="Source" value={bar.source} onChange={v => updateCmpBar(bar.id, { source: v })} options={sourceOpts} />}
            {structureOpts.length > 0 && <HeaderFilterPill label="Structure" value={bar.structure} onChange={v => updateCmpBar(bar.id, { structure: v })} options={structureOpts} />}
            {secDimGroups.length > 0 && <HeaderFilterPill label="Dim Grp" value={bar.dimGroup} onChange={v => updateCmpBar(bar.id, { dimGroup: v, dim: "" })} options={[{ value: "", label: "Dim Grp" }, ...secDimGroups.map(g => ({ value: g, label: g }))]} />}
            {bar.dimGroup && cmpDimOptions.length > 0 && <HeaderFilterPill label="Dims" value={bar.dim} onChange={v => updateCmpBar(bar.id, { dim: v })} options={[{ value: "", label: "Dims" }, ...cmpDimOptions.map(d => ({ value: d.code, label: d.name || d.code }))]} />}
            <button onClick={() => removeCmpBar(bar.id)}
              className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ml-2 transition-all hover:scale-110"
              style={{ background: `${cmpColor}15`, color: cmpColor }}>
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>

{/* Chart card */}
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">

{/* Chart */}
      <div ref={chartContainerRef} className="relative flex-1 min-h-0" style={{ minHeight: 0 }}>
        <div className="absolute inset-0 px-4 py-4">
          {/* X-axis granularity toggle */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-xl p-0.5 shadow-sm"
            style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(26,47,138,0.08)", backdropFilter: "blur(8px)" }}>
            {["month","year"].map(x => (
              <button key={x} onClick={() => setSecXAxis(x)}
                className="px-3 py-1 rounded-lg text-[10px] font-black transition-all"
                style={{ background: secXAxis === x ? colors?.primary : "transparent", color: secXAxis === x ? "#fff" : colors?.primary }}>
                {x.charAt(0).toUpperCase() + x.slice(1)}
              </button>
            ))}
          </div>

{loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="relative" style={{ width: 80, height: 80 }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#f3f4f6" strokeWidth="6" />
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke="url(#graphProgGrad)" strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 32}
                    strokeDashoffset={2 * Math.PI * 32 * 0.25}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "40px 40px", animation: "graphSpin 1.1s linear infinite" }}
                  />
                  <defs>
                    <linearGradient id="graphProgGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={colors?.primary ?? "#1a2f8a"} />
                      <stop offset="100%" stopColor="#CF305D" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <BarChart3 size={18} style={{ color: colors?.primary, opacity: 0.4 }} />
                </div>
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">Loading data…</p>
              <style>{`@keyframes graphSpin { from { transform: rotate(-90deg); } to { transform: rotate(270deg); } }`}</style>
            </div>
          ) : chartData.length === 0 || secKpiIds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: `${colors?.primary}10` }}>
                <BarChart3 size={28} style={{ color: colors?.primary, opacity: 0.3 }} />
              </div>
              <p className="text-xs font-bold text-gray-300">
                {secKpiIds.length === 0 ? "Select at least one KPI above" : "No data for selected range"}
              </p>
            </div>
          ) : (() => {
            let displayData = chartData;
            if (secXAxis === "year") {
              const byYear = new Map();
              chartData.forEach(d => {
                const [, yy] = d.period.split("/");
                if (!byYear.has(yy)) byYear.set(yy, { period: `20${yy}`, _months: [] });
                byYear.get(yy)._months.push(d);
              });
              displayData = [...byYear.values()].map(entry => {
                const row = { period: entry.period };
                secKpiIds.forEach(kid => {
                  const kpi = kpiList.find(k => k.id === kid);
                  if (secMode === "ytd") {
                    row[kid] = entry._months[entry._months.length - 1]?.[kid];
                  } else {
                    const vals = entry._months.map(m => m[kid]).filter(v => v !== null && v !== undefined && !isNaN(v));
                    row[kid] = vals.length === 0 ? null : kpi?.format === "percent" ? vals.reduce((a,b) => a+b,0)/vals.length : vals.reduce((a,b) => a+b,0);
                  }
                });
                return row;
              });
            }
const CHART_COLORS = [colors?.primary ?? "#1a2f8a", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4"];
const CMP_COLORS = { B: "#CF305D", C: "#f59e0b" };
            const activeCmpBars = compareMode ? cmpBars.filter(b => (cmpChartData[b.id]?.length ?? 0) > 0) : [];

            const allPeriods = [...new Set([
              ...displayData.map(d => d.period),
              ...activeCmpBars.flatMap(b => (cmpChartData[b.id] ?? []).map(d => d.period)),
            ])].sort();

            const mergedData = allPeriods.map(period => {
              const main = displayData.find(d => d.period === period) ?? {};
              const row = { period };
              secKpiIds.forEach(kid => { row[`a__${kid}`] = main[kid] ?? null; });
              activeCmpBars.forEach(bar => {
                const barRow = (cmpChartData[bar.id] ?? []).find(d => d.period === period) ?? {};
                secKpiIds.forEach(kid => { row[`${bar.id}__${kid}`] = barRow[kid] ?? null; });
              });
              return row;
            });

            return (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mergedData} margin={{ top: 8, right: 24, left: 8, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,47,138,0.06)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600 }} axisLine={false} tickLine={false} interval={secXAxis === "year" ? 0 : "preserveStartEnd"} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={v => Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} width={56} />
                  <Tooltip
                    contentStyle={{ borderRadius: 16, border: "none", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.25)", padding: "12px 16px", fontSize: 12 }}
                    labelStyle={{ fontWeight: 800, color: "#1a2f8a", marginBottom: 6 }}
formatter={(value, name) => {
                      const [prefix, kid] = name.split("__");
                      const kpi = kpiList.find(k => k.id === kid);
                      return [fmtValue(value, kpi?.format), `${prefix.toUpperCase()} · ${kpi?.label ?? kid}`];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(value) => {
                    const [prefix, kid] = value.split("__");
                    const kpi = kpiList.find(k => k.id === kid);
                    return `${prefix.toUpperCase()} · ${kpi?.label ?? kid}`;
                  }} />
                  {secKpiIds.map((kid, i) => (
                    <Line key={`a__${kid}`} type="monotone" dataKey={`a__${kid}`}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2.5} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls />
                  ))}
{activeCmpBars.flatMap(bar => secKpiIds.map((kid, i) => (
                    <Line key={`${bar.id}__${kid}`} type="monotone" dataKey={`${bar.id}__${kid}`}
                      stroke={CMP_COLORS[bar.id] ?? "#CF305D"}
                      strokeWidth={2}
                      strokeOpacity={i === 0 ? 1 : 0.65 - i * 0.1}
                      strokeDasharray={bar.id === "B" ? "6 3" : "2 3"}
                      dot={false} activeDot={{ r: 5, strokeWidth: 0 }} connectNulls />
                  )))}
                </LineChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      </div>

</div>

    {/* Data table card — collapsible */}
<div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-shrink-0 overflow-hidden flex flex-col">
      <button onClick={() => setTableOpen(o => !o)}
        className="flex items-center justify-between px-5 py-3 hover:bg-[#f8f9ff] transition-colors"
        style={{ borderBottom: tableOpen ? "1px solid #f0f0f0" : "none" }}>
        <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.6 }}>Data Table</span>
        <div className="flex items-center gap-2">
          {chartData.length > 0 && <span className="text-[9px] font-bold text-gray-400">{chartData.length} periods</span>}
          <ChevronDown size={13} style={{ color: colors?.primary, opacity: 0.4, transform: tableOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
        </div>
      </button>
<div style={{
        maxHeight: tableOpen ? "20vh" : "0px",
        overflowY: tableOpen ? "auto" : "hidden",
        scrollbarWidth: "none",
        transition: "max-height 350ms cubic-bezier(0.4,0,0.2,1)",
      }}>
          {chartData.length === 0 || secKpiIds.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[10px] text-gray-300 font-bold">
              {secKpiIds.length === 0 ? "Select KPIs to view data" : "—"}
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: colors?.primary }}>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap">Period</th>
                  {secKpiIds.map(kid => {
                    const k = kpiList.find(k => k.id === kid);
                    return <th key={kid} className="text-right px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap">{k?.label ?? kid}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {chartData.map((d, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                    <td className="px-4 py-2 text-xs font-bold whitespace-nowrap" style={{ color: colors?.primary }}>{d.period}</td>
                    {secKpiIds.map(kid => {
                      const k = kpiList.find(k => k.id === kid);
                      const v = d[kid];
                      const isNull = v === null || v === undefined || isNaN(v);
                      return (
                        <td key={kid} className="px-4 py-2 text-xs font-semibold text-right whitespace-nowrap"
                          style={{ color: isNull ? "#d1d5db" : v < 0 ? "#ef4444" : "#111827" }}>
                          {isNull ? "—" : fmtValue(v, k?.format)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
</div>
</div>
      </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
async function renderChartToImage({data, kpiIds, kpiList, width = 900, height = 420 }) {
  const COLORS = ["#1a2f8a", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.background = "#ffffff";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      <div style={{ width, height, background: "#fff", padding: 12 }}>
        <LineChart data={data} width={width - 24} height={height - 24} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1fb" />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6b7280" }} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }}
            tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} />
          <Legend wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => kpiList.find(k => k.id === value)?.label ?? value} />
          {kpiIds.map((kid, i) => (
            <Line key={kid} type="monotone" dataKey={kid} isAnimationActive={false}
              stroke={COLORS[i % COLORS.length]} strokeWidth={2}
              dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
          ))}
        </LineChart>
      </div>
    );

    // Wait two animation frames for recharts to actually paint the SVG
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 150));

    const canvas = await html2canvas(host, { backgroundColor: "#ffffff", scale: 2, logging: false });
    return canvas.toDataURL("image/png");
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}

function AnimatedTabSelector({
  tabs, activeKey, onSelect, colors,
  pillColor,
  bgColor,
  inactiveColor,
  activeColor,
}) {
  const containerRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const activeIdx = Math.max(0, tabs.findIndex(t => t.key === activeKey));

  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll("button");
    const active = buttons[activeIdx];
    if (active) {
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    }
  }, [activeIdx, tabs.length]);

  const resolvedPill     = pillColor     ?? colors?.primary;
  const resolvedBg       = bgColor       ?? `${colors?.primary}25`;
  const resolvedInactive = inactiveColor ?? "#6b7280";
  const resolvedActive   = activeColor   ?? "#FFFFFF";

  return (
    <div ref={containerRef} className="relative flex items-center gap-0.5 p-0.5 rounded-xl"
      style={{ backgroundColor: resolvedBg, isolation: "isolate" }}>
      <div
        className="absolute top-0.5 bottom-0.5 rounded-lg transition-all duration-300 ease-out shadow-sm"
        style={{
          left: indicator.left,
          width: indicator.width,
          backgroundColor: resolvedPill,
          zIndex: 0,
        }}
      />
      {tabs.map(t => {
        const isActive = t.key === activeKey;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className="relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-colors"
            style={{ color: isActive ? resolvedActive : resolvedInactive }}>
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function KpiIndividualesPage({ token, sources = [], structures = [], companies = [], dimensions = [], groupAccounts: groupAccountsProp = [] }) {
  // Auto-fetch groupAccounts if parent didn't pass them
  const [groupAccountsLocal, setGroupAccountsLocal] = useState([]);
  useEffect(() => {
    if (groupAccountsProp.length > 0) return;
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/v2/group-accounts`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (!res.ok) {
          console.warn("[KpiPage] /v2/group-accounts failed:", res.status);
          return;
        }
        const json = await res.json();
        const arr = json.value ?? (Array.isArray(json) ? json : []);
        if (!cancelled) {
          console.log("[KpiPage] auto-fetched groupAccounts:", arr.length);
          setGroupAccountsLocal(arr);
        }
      } catch (e) {
        console.error("[KpiPage] groupAccounts fetch error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [token, groupAccountsProp.length]);

const groupAccounts = groupAccountsProp.length > 0 ? groupAccountsProp : groupAccountsLocal;

  // Diagnostic: check if API codes (38450 etc) exist in groupAccounts
  useEffect(() => {
    if (groupAccounts.length === 0) return;
    const sampleApiCodes = ["38450", "38999", "39999"];
    const gaCodes = new Set(groupAccounts.map(g => String(g.accountCode ?? g.AccountCode ?? "")));
    sampleApiCodes.forEach(c => {
      console.log(`[KpiPage] is "${c}" in groupAccounts?`, gaCodes.has(c));
    });
    console.log(`[KpiPage] sample groupAccount:`, groupAccounts[0]);
    console.log(`[KpiPage] groupAccount keys:`, Object.keys(groupAccounts[0] ?? {}));
  }, [groupAccounts.length]);

  const header1Style = useTypo("header1");
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const underscore2Style = useTypo("underscore2");
  const underscore3Style = useTypo("underscore3");
  const filterStyle = useTypo("filter");
const { colors } = useSettings();
  const { getLatestPeriod, setLatestPeriod } = useLatestPeriod();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [source, setSource] = useState("");
  const [structure, setStructure] = useState("");
  const [metaReady, setMetaReady] = useState(false);
  const [loading, setLoading] = useState(false);
const [companyData, setCompanyData] = useState(new Map());
const [companyDataPrev, setCompanyDataPrev] = useState(new Map()); // previous month for monthly delta
const [companyDataCmp, setCompanyDataCmp] = useState(new Map()); // current period in compare scenario
const [companyDataCmpPrev, setCompanyDataCmpPrev] = useState(new Map()); // previous period in compare scenario
const {
  kpiList: resolvedKpiList,
  allKpis: resolvedAllKpis,
  ccTagToCodes: defaultCcTagToCodes,
  sectionCodes,
  standard: detectedStandard,
  ready:    kpiResolverReady,
  error:    kpiResolverError,
} = useResolvedKpiList(groupAccounts);

// activeMapping comes from the Views/Mappings modal. When set, we override
// the cc_tag → account-code map so KPIs are computed against the user's
// custom grouping wherever a section label fuzzy-matches a known cc_tag.
// All downstream computation (companyResults, dimensionResults, GraphSection,
// fetchSectionData) reads `ccTagToCodes` from this scope — so they pick up
// the override automatically without further plumbing.
const [activeMapping, setActiveMapping] = useState(null);
const [warningDismissed, setWarningDismissed] = useState(false);

const { ccTagToCodes, mappingMatched, mappingUnmatched } = useMemo(() => {
  if (!activeMapping) {
    return { ccTagToCodes: defaultCcTagToCodes, mappingMatched: [], mappingUnmatched: [] };
  }
  const override = new Map(defaultCcTagToCodes);
  const matched = [];
  const unmatched = [];
  const allSections = new Map([
    ...(activeMapping.plSections || new Map()),
    ...(activeMapping.bsSections || new Map()),
  ]);
  allSections.forEach((codes, label) => {
    if (!codes || codes.length === 0) return;
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
  return { ccTagToCodes: override, mappingMatched: matched, mappingUnmatched: unmatched };
}, [activeMapping, defaultCcTagToCodes]);

const handleApplyMapping = useCallback((m) => {
  setActiveMapping({
    mapping_id: m.mapping_id,
    name: m.name,
    standard: m.standard,
    plSections: extractSectionsFromTree(m.pl_tree),
    bsSections: extractSectionsFromTree(m.bs_tree),
  });
  setWarningDismissed(false);
}, []);

// Diagnostic logging — easy way to see what's going on in console
useEffect(() => {
  if (!kpiResolverReady) return;
  console.group("[KpiPage] KPI resolver ready");
  console.log("standard:",     detectedStandard);
  console.log("kpiList size:", resolvedKpiList.length);
  console.log("cc tags:",      ccTagToCodes.size);
  console.log("sections:",     sectionCodes.size);
  if (kpiResolverError) console.error("error:", kpiResolverError);
  if (resolvedKpiList.length === 0) {
    console.warn("⚠️  No KPIs loaded — check Supabase 'kpi_definitions' table");
  }
  console.groupEnd();
}, [kpiResolverReady, detectedStandard, resolvedKpiList.length, ccTagToCodes.size, sectionCodes.size, kpiResolverError]);

// Auth + company resolved from Supabase session (mirrors Mappings pattern).
const [authUserId, setAuthUserId] = useState(null);
const [companyId, setCompanyId]   = useState(null);

// Custom KPIs fetched from Supabase — the company-wide LIBRARY (shared).
const [companyKpis, setCompanyKpis] = useState([]);

// User's PERSONAL dashboard — ordered list of KPI ids (built-in OR custom).
// null = not loaded yet; defaults applied once fetch resolves.
const [dashboardKpiIds, setDashboardKpiIds] = useState(null);
const [dashboardKpiIdsDim, setDashboardKpiIdsDim] = useState(null);

// Resolve session + company on mount
useEffect(() => {
  (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setAuthUserId(uid);
    if (uid) {
      const cid = await getActiveCompanyId(uid);
      setCompanyId(cid);
    }
  })();
}, []);

// Fetch the company's shared KPI library (every saved custom KPI)
const refreshCompanyKpis = useCallback(() => {
  if (!companyId) return;
  listCompanyKpis({ companyId, contextMappingId: "*", scope: "individual" })
    .then(rows => setCompanyKpis(rows ?? []))
    .catch(e => console.error("[KpiPage] listCompanyKpis:", e));
}, [companyId]);

useEffect(() => { refreshCompanyKpis(); }, [refreshCompanyKpis]);

// Fetch this user's personal dashboards (one per tab)
useEffect(() => {
  if (!authUserId || !companyId) return;
  const defaults = ["revenue", "gross_profit", "net_result", "net_margin"];

const loadDash = async (scope, setter) => {
    try {
      const row = await getUserDashboard({ userId: authUserId, companyId, scope });
      if (row && Array.isArray(row.kpi_ids)) {
        const deduped = [...new Set(row.kpi_ids)];
        setter(deduped);
      } else {
        setter(defaults);
        try {
          await saveUserDashboard({ userId: authUserId, companyId, kpiIds: defaults, scope });
        } catch (e) { console.error(`[KpiPage] failed to save defaults for ${scope}:`, e); }
      }
    } catch (e) {
      console.error(`[KpiPage] getUserDashboard ${scope}:`, e);
      setter(defaults);
    }
  };

  loadDash("individual_company", setDashboardKpiIds);
  loadDash("individual_dimension", setDashboardKpiIdsDim);
}, [authUserId, companyId]);

// Adapt Supabase rows to the renderer's KPI shape. _contextMappingId is UI
// metadata for badges + context filtering.
// ── System KPI override helpers ───────────────────────────────────────────
const OVERRIDE_TAG_PREFIX = "__override__:";
const [editingKpi, setEditingKpi] = useState(null);
const [viewMode, setViewMode] = useState("company");

const systemOverrides = useMemo(() => {
  const compMap = new Map();
  const dimMap = new Map();
  companyKpis.forEach(k => {
    if (k.kpi_type === 'system_override' && k.source_system_kpi_id && k.created_by === authUserId) {
      if (k.tag?.includes(":dim")) dimMap.set(k.source_system_kpi_id, k);
      else compMap.set(k.source_system_kpi_id, k);
    }
  });
  return { comp: compMap, dim: dimMap };
}, [companyKpis, authUserId]);

const saveSystemOverride = useCallback(async (originalKpiId, overrideData) => {
  if (!companyId || !authUserId) return;
  const overrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
  const existing = overrideMap.get(originalKpiId);
  try {
    if (existing) {
      const updated = await updateCompanyKpi({
        kpiId:              existing.kpi_id,
        userId:             authUserId,
        label:              overrideData.label,
        description:        overrideData.description ?? null,
        category:           overrideData.category ?? null,
        tag:               `${OVERRIDE_TAG_PREFIX}${originalKpiId}:${viewMode === "dimension" ? "dim" : "comp"}`,
        format:             overrideData.format ?? "currency",
        formula:            overrideData.formula,
        benchmark:          overrideData.benchmark ?? null,
        kpiType:            'system_override',
        sourceSystemKpiId:  originalKpiId,
      });
      setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
    } else {
      const created = await createCompanyKpi({
        companyId,
        userId:             authUserId,
        label:              overrideData.label,
        description:        overrideData.description ?? null,
        category:           overrideData.category ?? null,
        tag:               `${OVERRIDE_TAG_PREFIX}${originalKpiId}:${viewMode === "dimension" ? "dim" : "comp"}`,
        format:             overrideData.format ?? "currency",
        formula:            overrideData.formula,
        benchmark:          overrideData.benchmark ?? null,
        contextMappingId:   null,
        scope:              "individual",
        kpiType:            'system_override',
        sourceSystemKpiId:  originalKpiId,
      });
      setCompanyKpis(prev => [...prev, created]);
    }
  } catch (e) {
    alert(`Could not save override: ${e.message}`);
  }
}, [companyId, authUserId, systemOverrides, viewMode]);

const resetSystemOverride = useCallback(async (originalKpiId) => {
  const overrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
  const existing = overrideMap.get(originalKpiId);
  if (!existing) return;
  try {
    await archiveCompanyKpi({ kpiId: existing.kpi_id, userId: authUserId });
    setCompanyKpis(prev => prev.filter(k => k.kpi_id !== existing.kpi_id));
  } catch (e) {
    alert(`Could not reset: ${e.message}`);
  }
}, [systemOverrides, authUserId, viewMode]);

const localKpis = useMemo(() => companyKpis
  .filter(k => k.kpi_type !== 'system_override')
  .map(k => ({
    id:                  k.kpi_id,
    label:               k.label,
    description:         k.description ?? "",
    category:            k.category    ?? "",
    tag:                 k.tag         ?? "",
    format:              k.format,
    formula:             k.formula,
    benchmark:           k.benchmark,
    _contextMappingId:   k.context_mapping_id ?? null,
    _createdBy:          k.created_by,
    _updatedBy:          k.updated_by,
    _updatedAt:          k.updated_at,
    _createdAt:          k.created_at,
    _kpiType:            k.kpi_type ?? "custom",
    _sourceSystemKpiId:  k.source_system_kpi_id ?? null,
  })), [companyKpis]);

// Persist dashboard changes to Supabase (optimistic — UI updates first)
const persistDashboard = useCallback(async (ids, scope = "individual_company") => {
  if (!authUserId || !companyId) return;
  try {
    await saveUserDashboard({ userId: authUserId, companyId, kpiIds: ids, scope });
  } catch (e) {
    console.error("[KpiPage] saveUserDashboard:", e);
  }
}, [authUserId, companyId]);



// Visible KPIs: resolve every dashboard id from built-ins or the custom
// library and drop anything that can't be found (e.g. removed from library).
// We DON'T filter by mapping context here — the badge on each row tells the
// user where the KPI was created, and the cc_tag override system already
// recomputes values against the active mapping. Hiding KPIs on mapping change
// is more confusing than helpful.


const builtInKpiIds = useMemo(() => new Set(resolvedAllKpis.map(k => k.id)), [resolvedAllKpis]);

const buildKpiList = useCallback((ids) => {
  if (!ids) return [];
  const byId = new Map();
  resolvedAllKpis.forEach(k => byId.set(k.id, k));
  resolvedKpiList.forEach(k => byId.set(k.id, k));
  localKpis.forEach(k => byId.set(k.id, k));
  const seen = new Set();
  return ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; }).map(id => {
    const base = byId.get(id);
    if (!base) return null;
// Only apply override if the dashboard id IS the system id (not a promoted custom UUID)
if (builtInKpiIds.has(id)) {
      const overrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
      const override = overrideMap.get(id);
      if (override) {
        return {
          ...base,
          label:       override.label       ?? base.label,
          description: override.description ?? base.description,
          category:    override.category    ?? base.category,
          format:      override.format      ?? base.format,
          formula:     override.formula     ?? base.formula,
          benchmark:   override.benchmark   ?? base.benchmark,
          tag:         override.tag?.startsWith("__override__:") ? base.tag : (override.tag ?? base.tag),
          _isOverridden:  true,
          _overrideKpiId: override.kpi_id,
        };
      }
    }
    return base;
  }).filter(Boolean);
}, [resolvedAllKpis, resolvedKpiList, localKpis, systemOverrides, builtInKpiIds, viewMode]);

const kpiList = useMemo(() =>
  viewMode === "dimension" ? buildKpiList(dashboardKpiIdsDim) : buildKpiList(dashboardKpiIds),
  [viewMode, dashboardKpiIds, dashboardKpiIdsDim, buildKpiList]
);
const addToDashboard = useCallback((kpiId, scope = "individual_company") => {
  const setter = scope === "individual_dimension" ? setDashboardKpiIdsDim : setDashboardKpiIds;
  setter(prev => {
    if (!prev) return prev;
    if (prev.includes(kpiId)) return prev;
    const next = [...prev, kpiId];
    persistDashboard(next, scope);
    return next;
  });
}, [persistDashboard]);

const removeFromDashboard = useCallback((kpiId, scope = "individual_company") => {
  const setter = scope === "individual_dimension" ? setDashboardKpiIdsDim : setDashboardKpiIds;
  setter(prev => {
    if (!prev) return prev;
    const next = prev.filter(id => id !== kpiId);
    persistDashboard(next, scope);
    return next;
  });
if (builtInKpiIds.has(kpiId)) {
    const overrideMap = scope === "individual_dimension" ? systemOverrides.dim : systemOverrides.comp;
    const override = overrideMap.get(kpiId);
    if (override) {
      archiveCompanyKpi({ kpiId: override.kpi_id, userId: authUserId }).catch(console.error);
      setCompanyKpis(prev => prev.filter(k => k.kpi_id !== override.kpi_id));
    }
  }
}, [persistDashboard, builtInKpiIds, systemOverrides, authUserId]);
const [viewPeriod, setViewPeriod] = useState("ytd"); // "monthly" | "ytd"

// Compare mode: when enabled, show 2 extra columns per existing column
// (compare value + delta) using the comparison filter set below.
const [compareMode, setCompareMode] = useState(false);
const [cmpSource, setCmpSource] = useState("");
const [cmpStructure, setCmpStructure] = useState("");
const [cmpYear, setCmpYear] = useState("");
const [cmpMonth, setCmpMonth] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [colDragIdx, setColDragIdx] = useState(null);
  const [colDragOverIdx, setColDragOverIdx] = useState(null);
  const [colOrder, setColOrder] = useState(null);
const [selGroup, setSelGroup] = useState("");
  const [selDim, setSelDim] = useState("");
const [selCompanies, setSelCompanies] = useState(null);
  const graphSectionsRef = useRef({}); // { 1: {...}, 2: {...}, 3: {...} }
const [exporting, setExporting] = useState(false);
  const [viewsModalOpen, setViewsModalOpen] = useState(false);
  const handleGraphSectionState = useCallback((sid, state) => {
    graphSectionsRef.current[sid] = state;
  }, []);
  useEffect(() => { setColOrder(null); }, [viewMode]);

  // Auto-find the latest period with data once source/structure/company are known
const autoPeriodDone = useRef(false);

useEffect(() => {
    if (sources.length > 0 && !source) {
      const s = sources[0];
      setSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
    }
  }, [sources, source]);

useEffect(() => {
    if (structures.length > 0 && !structure) {
      const s = structures[0];
      setStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
    }
}, [structures, structure]);

// Default the comparison filters once when the user enables compare mode.
// We populate them on transition false→true so the user lands on a sensible
// initial scenario (previous year, same month). After that, the user can
// override freely without us forcing the values back.
const compareInitDoneRef = useRef(false);
useEffect(() => {
  if (!compareMode) {
    compareInitDoneRef.current = false;
    return;
  }
  if (compareInitDoneRef.current) return;
  if (!source || !structure || !year || !month) return;
  setCmpSource(source);
  setCmpStructure(structure);
  setCmpYear(String(parseInt(year) - 1));
  setCmpMonth(month);
  compareInitDoneRef.current = true;
}, [compareMode, source, structure, year, month]);

const companyCodes = useMemo(() =>
    [...new Set(companies.map(c => typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)).filter(Boolean))],
    [companies]
  );

const kpiDashProgress = useMemo(() => {
  let pct = 0;
  if (year && month)                                           pct += 15;
  if (sources.length > 0 && structures.length > 0 && companies.length > 0) pct += 15;
  if (groupAccounts.length > 0)                                pct += 25;
  if (companyData.size > 0)                                    pct += 25;
  if (metaReady && !loading)                                   pct += 20;
  return Math.min(100, pct);
}, [year, month, sources.length, structures.length, companies.length, groupAccounts.length, companyData, metaReady, loading]);

const animatedKpiDashProgress = useAnimatedNumber(kpiDashProgress, 700);
const kpiDashReady = kpiDashProgress >= 100;

  const companyLegalName = useCallback((shortName) => {
    const co = companies.find(c => (c.companyShortName ?? c.CompanyShortName ?? "") === shortName);
    return co?.CompanyLegalName ?? co?.companyLegalName ?? shortName;
  }, [companies]);

// Auto-find the latest period with data once source/structure/company are known.
  // Fast path: LatestPeriodContext (populated by EpicLoader). Slow path: 24-month probe.
  useEffect(() => {
    if (autoPeriodDone.current) return;
    if (!token || !source || !structure || companyCodes.length === 0) return;
    autoPeriodDone.current = true;
    const co = companyCodes[0];

    // FAST PATH 1: React context cache
    const cached = getLatestPeriod(source, structure, co);
    if (cached) {
      console.log("[KpiPage] CONTEXT CACHE HIT ✓", cached);
      setYear(String(cached.year));
      setMonth(String(cached.month));
      setMetaReady(true);
      return;
    }

    // FAST PATH 2: sessionStorage (EpicLoader's prefetchHomeData)
    try {
      const ssKey = `home_latest_period_${source}_${structure}_${co}`;
      const ssRaw = sessionStorage.getItem(ssKey);
      if (ssRaw) {
        const parsed = JSON.parse(ssRaw);
        if (parsed.year && parsed.month) {
          console.log("[KpiPage] SESSION STORAGE HIT ✓", parsed);
          setYear(String(parsed.year));
          setMonth(String(parsed.month));
          setLatestPeriod(source, structure, co, parsed.year, parsed.month);
          setMetaReady(true);
          return;
        }
      }
    } catch { /* ignore */ }

    console.log("[KpiPage] CACHE MISS - probing");

    (async () => {
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${co}'`;
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
              setLatestPeriod(source, structure, co, y, m);
              setMetaReady(true);
              return;
            }
          }
        } catch { /* keep probing */ }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      setMetaReady(true);
    })();
  }, [token, source, structure, companyCodes, getLatestPeriod, setLatestPeriod]);

// Derive dim groups and codes from the journal's `Dimensions` field — more
// reliable than /v2/dimensions because we know the data is there if we see it
// here.
const { dimGroups, dimsByGroup } = useMemo(() => {
    const groupSet = new Set();
    const byGroup = new Map();
    // Build name lookup from dimensions prop
    const nameLookup = new Map();
    dimensions.forEach(d => {
      const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "").trim();
      const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "").trim();
      if (code && name) nameLookup.set(code, name);
    });
    companyData.forEach(rows => {
      rows.forEach(r => {
        const pairs = parseDimensions(r.Dimensions);
        for (const [group, code] of pairs) {
          if (!group || !code) continue;
          groupSet.add(group);
          if (!byGroup.has(group)) byGroup.set(group, new Map());
          const name = nameLookup.get(code) ?? code;
          byGroup.get(group).set(code, name);
        }
      });
    });
    return {
      dimGroups: [...groupSet].sort(),
      dimsByGroup: byGroup,
    };
  }, [companyData, dimensions]);

const groupDimOptions = useMemo(() => {
    if (!selGroup) return [];
    const m = dimsByGroup.get(selGroup);
    if (!m) return [];
    return [...m.entries()].map(([code, name]) => ({ code, name }));
  }, [dimsByGroup, selGroup]);

  const groupDimCodes = useMemo(() => {
    if (selDim) return new Set([selDim]);
    if (!selGroup) return null;
    return new Set(groupDimOptions.map(d => d.code));
  }, [selGroup, selDim, groupDimOptions]);

const fetchAllCompanies = useCallback(async () => {
    if (!metaReady || !year || !month || !source || !structure || companyCodes.length === 0) return;
    setLoading(true);

    // Generic fetcher for one (year, month, source, structure) combination
    const fetchPeriod = async (y, m, s, st) => {
      const map = new Map();
      await Promise.all(companyCodes.map(async co => {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}' and CompanyShortName eq '${co}'`;
          const res = await fetch(
            `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" } }
          );
          if (!res.ok) { map.set(co, []); return; }
          const json = await res.json();
          map.set(co, json.value ?? (Array.isArray(json) ? json : []));
        } catch { map.set(co, []); }
      }));
      return map;
    };

    // Compute previous month (used for monthly delta in main + compare scenarios)
    const prevOf = (y, m) => {
      let pY = parseInt(y), pM = parseInt(m) - 1;
      if (pM < 1) { pM = 12; pY -= 1; }
      return { y: pY, m: pM };
    };

    // Fetch main scenario (current + prev for monthly)
    const mainPrev = prevOf(year, month);
    const [curr, prev] = await Promise.all([
      fetchPeriod(year, month, source, structure),
      fetchPeriod(mainPrev.y, mainPrev.m, source, structure),
    ]);
    setCompanyData(curr);
    setCompanyDataPrev(prev);

// Fetch comparison scenario only when compareMode is enabled and the
    // compare filters are populated (no point fetching otherwise).
    console.log("[KpiPage] compareMode check:", { compareMode, cmpSource, cmpStructure, cmpYear, cmpMonth });
    if (compareMode && cmpSource && cmpStructure && cmpYear && cmpMonth) {
      const cmpPrev = prevOf(cmpYear, cmpMonth);
      console.log("[KpiPage] fetching cmp:", { cmpYear, cmpMonth, cmpPrev });
      const [currC, prevC] = await Promise.all([
        fetchPeriod(cmpYear, cmpMonth, cmpSource, cmpStructure),
        fetchPeriod(cmpPrev.y, cmpPrev.m, cmpSource, cmpStructure),
      ]);
      console.log("[KpiPage] cmp data fetched:", { currCSize: currC.size, prevCSize: prevC.size });
      // Sample inspection
      const sampleCo = [...currC.keys()][0];
      if (sampleCo) {
        console.log(`[KpiPage] cmp ${sampleCo} rows:`, currC.get(sampleCo)?.length);
      }
      setCompanyDataCmp(currC);
      setCompanyDataCmpPrev(prevC);
    } else {
      console.log("[KpiPage] skipping cmp fetch");
      setCompanyDataCmp(new Map());
      setCompanyDataCmpPrev(new Map());
    }

    setLoading(false);
  }, [metaReady, year, month, source, structure, companyCodes, token,
      compareMode, cmpSource, cmpStructure, cmpYear, cmpMonth]);

useEffect(() => { fetchAllCompanies(); }, [fetchAllCompanies]);

  // Build flat pivot per company (account code → YTD sum, P/L summary rows only)
// Build a Set of sum account codes from groupAccounts so we can filter them
  // out of the pivot. The API returns both posting and sum rows together;
  // including sums would double-count revenue/etc.
  const sumAccountCodes = useMemo(() => {
    const sums = new Set();
    groupAccounts.forEach(g => {
      const isSum = g.IsSumAccount === true || g.isSumAccount === true;
      if (isSum) {
        const code = String(g.AccountCode ?? g.accountCode ?? "");
        if (code) sums.add(code);
      }
    });
    console.log(`[KpiPage] identified ${sums.size} sum accounts to exclude from pivot`);
    return sums;
  }, [groupAccounts]);

const companyPivots = useMemo(() => {
    // Build dimPivot from ALL rows (no AccountType filter, no sum filter)
    // because dimension tags live on sum/aggregate rows (A.02, A.PL etc), not posting rows
    const buildDimPivotFromRaw = (rows) => {
      const dimPivot = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        if (!ac) return;
        const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
        if (!dimsRaw || dimsRaw === "—") return;
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        parseDimensions(dimsRaw).forEach(([dGroup, dCode]) => {
          if (!dGroup || !dCode) return;
          const key = `${ac}:::${dGroup}:::${dCode}`;
          dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
        });
      });
      return dimPivot;
    };

    const buildPivot = (rows) => {
      const p = new Map();
      const dimPivot = new Map(); // kept for compat, replaced below
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (sumAccountCodes.has(ac)) return;
        if (acType && acType !== "P/L") return;

       const dimPairs = parseDimensions(r.Dimensions ?? r.dimensions ?? "");

        if (selDim || selGroup) {
          if (selDim) {
            const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
            if (!rowDimCodes.has(selDim)) return;
          } else if (selGroup) {
            const hasGroupMatch = dimPairs.some(([g]) => g === selGroup);
            if (!hasGroupMatch) return;
          }
        }

        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);

        // Build dim pivot from ALL dim pairs on this row (regardless of page-level filter)
        // This allows formula-level dim filtering to work correctly even when the page
        // is already filtered by a different dimension
        dimPairs.forEach(([dGroup, dCode]) => {
          if (!dGroup || !dCode) return;
          const key = `${ac}:::${dGroup}:::${dCode}`;
          dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
        });
      });
p.__dimPivot = dimPivot; // will be overwritten below with full raw version
      return p;
    };

const pivots = new Map();
    companyData.forEach((rows, co) => {
      const currPivot = buildPivot(rows);
      // Overwrite with full raw dimPivot (includes sum account rows where dims live)
      currPivot.__dimPivot = buildDimPivotFromRaw(rows);

      if (viewPeriod === "ytd") {
        pivots.set(co, currPivot);
      } else {
        // Monthly = current YTD - previous month YTD (per account).
        // For January (month=1) the previous month is in the prior year, so
        // the delta equals YTD itself (which is correct: Jan YTD = Jan monthly).
        const prevRows = companyDataPrev.get(co) ?? [];
        const prevPivot = buildPivot(prevRows);
const monthlyPivot = new Map();
        const isJanuary = parseInt(month) === 1;
        const allCodes = new Set([...currPivot.keys(), ...prevPivot.keys()]);
        allCodes.forEach(ac => {
          const currYTD = currPivot.get(ac) ?? 0;
          const prevYTD = isJanuary ? 0 : (prevPivot.get(ac) ?? 0);
          monthlyPivot.set(ac, currYTD - prevYTD);
        });
// Build monthly dimPivot from raw rows (curr YTD - prev YTD)
        const currRawDimPivot = buildDimPivotFromRaw(rows);
        const prevRawDimPivot = buildDimPivotFromRaw(companyDataPrev.get(co) ?? []);
        const monthlyDimPivot = new Map();
        const allDimKeys = new Set([...currRawDimPivot.keys(), ...prevRawDimPivot.keys()]);
        allDimKeys.forEach(key => {
          const currVal = currRawDimPivot.get(key) ?? 0;
          const prevVal = isJanuary ? 0 : (prevRawDimPivot.get(key) ?? 0);
          monthlyDimPivot.set(key, currVal - prevVal);
        });
        monthlyPivot.__dimPivot = monthlyDimPivot;
        pivots.set(co, monthlyPivot);
      }
    });
    return pivots;
  }, [companyData, companyDataPrev, viewPeriod, month, selGroup, selDim, sumAccountCodes]);

// Compare-scenario company pivots — same logic as companyPivots but reading
  // from companyDataCmp / companyDataCmpPrev.
  const companyPivotsCmp = useMemo(() => {
    const buildPivot = (rows) => {
      const p = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (sumAccountCodes.has(ac)) return;
        if (acType && acType !== "P/L") return;
        if (selDim || selGroup) {
          const dimPairs = parseDimensions(r.Dimensions);
          if (selDim) {
            const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
            if (!rowDimCodes.has(selDim)) return;
          } else if (selGroup) {
            const hasGroupMatch = dimPairs.some(([g]) => g === selGroup);
            if (!hasGroupMatch) return;
          }
        }
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);
      });
      return p;
    };
    const pivots = new Map();
    companyDataCmp.forEach((rows, co) => {
      const currPivot = buildPivot(rows);
      if (viewPeriod === "ytd") {
        pivots.set(co, currPivot);
      } else {
        const prevRows = companyDataCmpPrev.get(co) ?? [];
        const prevPivot = buildPivot(prevRows);
const monthlyPivot = new Map();
        const isJanuary = parseInt(cmpMonth) === 1;
        const allCodes = new Set([...currPivot.keys(), ...prevPivot.keys()]);
        allCodes.forEach(ac => {
          const currYTD = currPivot.get(ac) ?? 0;
          const prevYTD = isJanuary ? 0 : (prevPivot.get(ac) ?? 0);
          monthlyPivot.set(ac, currYTD - prevYTD);
        });
        if (currPivot.__dimPivot) {
          const monthlyDimPivot = new Map();
          const allDimKeys = new Set([
            ...currPivot.__dimPivot.keys(),
            ...(prevPivot.__dimPivot?.keys() ?? []),
          ]);
          allDimKeys.forEach(key => {
            const currVal = currPivot.__dimPivot.get(key) ?? 0;
            const prevVal = isJanuary ? 0 : (prevPivot.__dimPivot?.get(key) ?? 0);
            monthlyDimPivot.set(key, currVal - prevVal);
          });
          monthlyPivot.__dimPivot = monthlyDimPivot;
        }
        pivots.set(co, monthlyPivot);
      }
    });
    return pivots;
  }, [companyDataCmp, companyDataCmpPrev, viewPeriod, cmpMonth, selGroup, selDim, sumAccountCodes]);

// Dimension-level pivots: one flat pivot per dimension code, aggregating across all companies
  const dimensionPivots = useMemo(() => {
    // Build separate YTD pivots per (dim code) for current and previous, then
    // diff them when viewPeriod === "monthly".
const buildDimPivots = (dataMap) => {
      const pivots = new Map();
      dataMap.forEach((rows, co) => {
if (selCompanies && selCompanies.length > 0 && !selCompanies.includes(co)) return;
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;

          const dimPairs = parseDimensions(r.Dimensions);
          if (dimPairs.length === 0) return;

          for (const [group, code] of dimPairs) {
            if (groupDimCodes && !groupDimCodes.has(code)) continue;
            if (selGroup && group !== selGroup) continue;

            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            const key = code;
            const dimEntry = dimensions.find(d => (d.DimensionCode ?? d.dimensionCode ?? "") === code);
          const dimName = dimEntry?.DimensionName ?? dimEntry?.dimensionName ?? code;
          if (!pivots.has(key)) pivots.set(key, { name: dimName, group, pivot: new Map() });
            const entry = pivots.get(key);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
          }
        });
      });
      return pivots;
    };

    const currPivots = buildDimPivots(companyData);
    if (viewPeriod === "ytd") return currPivots;

    // Monthly = curr YTD - prev YTD per dim
    const prevPivots = buildDimPivots(companyDataPrev);
    const isJanuary = parseInt(month) === 1;
    const result = new Map();
    const allKeys = new Set([...currPivots.keys(), ...prevPivots.keys()]);
    allKeys.forEach(key => {
      const curr = currPivots.get(key);
      const prev = prevPivots.get(key);
      const meta = curr ?? prev;
      const monthlyPivot = new Map();
      const allCodes = new Set([
        ...(curr?.pivot.keys() ?? []),
        ...(prev?.pivot.keys() ?? []),
      ]);
      allCodes.forEach(ac => {
        const currVal = curr?.pivot.get(ac) ?? 0;
        const prevVal = isJanuary ? 0 : (prev?.pivot.get(ac) ?? 0);
        monthlyPivot.set(ac, currVal - prevVal);
      });
      result.set(key, { name: meta.name, group: meta.group, pivot: monthlyPivot });
    });
    return result;
}, [companyData, companyDataPrev, viewPeriod, month, groupDimCodes, sumAccountCodes, selGroup, selCompanies]);
  // Compare-scenario dimension pivots — mirrors dimensionPivots but reads
  // from companyDataCmp / companyDataCmpPrev with cmpMonth as the period.
  const dimensionPivotsCmp = useMemo(() => {
    const buildDimPivots = (dataMap) => {
      const pivots = new Map();
      dataMap.forEach(rows => {
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;

          const dimPairs = parseDimensions(r.Dimensions);
          if (dimPairs.length === 0) return;

          for (const [group, code] of dimPairs) {
            if (groupDimCodes && !groupDimCodes.has(code)) continue;
            if (selGroup && group !== selGroup) continue;

            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            const key = code;
            if (!pivots.has(key)) pivots.set(key, { name: code, group, pivot: new Map() });
            const entry = pivots.get(key);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
          }
        });
      });
      return pivots;
    };

    const currPivots = buildDimPivots(companyDataCmp);
    if (viewPeriod === "ytd") return currPivots;

    const prevPivots = buildDimPivots(companyDataCmpPrev);
    const isJanuary = parseInt(cmpMonth) === 1;
    const result = new Map();
    const allKeys = new Set([...currPivots.keys(), ...prevPivots.keys()]);
    allKeys.forEach(key => {
      const curr = currPivots.get(key);
      const prev = prevPivots.get(key);
      const meta = curr ?? prev;
      const monthlyPivot = new Map();
      const allCodes = new Set([
        ...(curr?.pivot.keys() ?? []),
        ...(prev?.pivot.keys() ?? []),
      ]);
      allCodes.forEach(ac => {
        const currVal = curr?.pivot.get(ac) ?? 0;
        const prevVal = isJanuary ? 0 : (prev?.pivot.get(ac) ?? 0);
        monthlyPivot.set(ac, currVal - prevVal);
      });
      result.set(key, { name: meta.name, group: meta.group, pivot: monthlyPivot });
    });
    return result;
  }, [companyDataCmp, companyDataCmpPrev, viewPeriod, cmpMonth, groupDimCodes, sumAccountCodes, selGroup]);

const dimensionCodes = useMemo(() => [...dimensionPivots.keys()].sort(), [dimensionPivots]);

  // Collect all account codes and dim codes available
const allAccountCodes = useMemo(() => {
    const codes = new Set();
    companyPivots.forEach(p => p.forEach((_, ac) => codes.add(ac)));
    return [...codes].sort();
  }, [companyPivots]);

const accountCodeLabels = useMemo(() => {
    const map = new Map();
    groupAccounts.forEach(g => {
      const code = String(g.accountCode ?? g.AccountCode ?? "");
      const name = String(g.accountName ?? g.AccountName ?? g.name ?? "");
      if (code) map.set(code, name);
    });
    return map;
  }, [groupAccounts]);

// Build dimsByAccount from actual data rows: Map<accountCode, [{group, code, name}]>
  const dimsByAccount = useMemo(() => {
    // Build a code → name lookup from the dimensions prop
    const dimNameLookup = new Map();
dimensions.forEach(d => {
      const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "");
      const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "");
      if (code && name) {
        dimNameLookup.set(code, name);
        // Also index by name in case the API returns the name as the "code"
        dimNameLookup.set(name, name);
      }
    });

const map = new Map();
    companyData.forEach(rows => {
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
        if (!ac || !dimsRaw || dimsRaw === "—") return;
        const pairs = parseDimensions(dimsRaw);
        if (!pairs.length) return;
        if (!map.has(ac)) map.set(ac, new Map());
        pairs.forEach(([group, rawCode]) => {
          if (!group || !rawCode) return;
          // rawCode is what appears in the data (could be "2", "1", "UK", etc.)
          // dimNameLookup maps that code → human name ("Producción", "España"…)
          const name = dimNameLookup.get(rawCode) ?? rawCode;
          const key = `${group}:::${rawCode}`;
          if (!map.get(ac).has(key)) {
            map.get(ac).set(key, { group, code: rawCode, name });
          }
        });
      });
    });
    const result = new Map();
    map.forEach((inner, ac) => result.set(ac, [...inner.values()]));
    return result;
  }, [companyData, dimensions]);

  const allDimCodes = useMemo(() => {
    const codes = new Set();
    companyData.forEach(rows => rows.forEach(r => {
      const dc = r.DimensionCode ?? r.dimensionCode ?? "";
      if (dc) codes.add(dc);
    }));
    return [...codes].sort();
  }, [companyData]);

// isAlphaStructure removed — KpiResolver detects the standard now.

 // adaptedKpiList removed — KpiResolver loads KPIs already in the active
  // standard's vocabulary via cc_tag mapping.

useEffect(() => { window.__debug_companyPivots = companyPivots; }, [companyPivots]);

const companyResults = useMemo(() => {
    const results = new Map();
    companyPivots.forEach((pivot, co) => {
      const r = computeAllKpisResolved(kpiList, pivot, ccTagToCodes, sectionCodes, resolvedAllKpis);
      results.set(co, r);
      const rev = r.get("revenue");
      const sampleAcc = pivot.size > 0 ? [...pivot.entries()].slice(0, 3) : [];
      console.log(`[KpiPage] ${co}: pivot=${pivot.size} accounts, revenue=${rev}, sample=`, sampleAcc);
    });
    return results;
  }, [companyPivots, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  const companyResultsCmp = useMemo(() => {
    const results = new Map();
    companyPivotsCmp.forEach((pivot, co) => {
      results.set(co, computeAllKpisResolved(kpiList, pivot, ccTagToCodes, sectionCodes, resolvedAllKpis));
    });
    return results;
  }, [companyPivotsCmp, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

 // Dimension-level results: one KPI map per dimension code
  const dimensionResults = useMemo(() => {
    const results = new Map();
    dimensionPivots.forEach((entry, key) => {
      const r = computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis);
      results.set(key, r);
    });
    return results;
  }, [dimensionPivots, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  const dimensionResultsCmp = useMemo(() => {
    const results = new Map();
    dimensionPivotsCmp.forEach((entry, key) => {
      const r = computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis);
      results.set(key, r);
    });
    return results;
  }, [dimensionPivotsCmp, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);
// KPI CRUD — three paths:
  //   1. Editing existing → UPDATE library entry (visible to other users too)
  //   2. Clicked existing in library picker → ADD to dashboard only
  //   3. New from preset / custom builder → CREATE in library + ADD to dashboard
  const saveKpi = useCallback(async (data) => {
    if (!companyId || !authUserId) {
      alert("Sesión o empresa no resueltas — no se puede guardar.");
      return;
    }

// Path 1: editing existing KPI from the table pencil icon
    if (editingKpi !== "new" && editingKpi && typeof editingKpi === "object" && editingKpi.id) {
const inLibrary = companyKpis.some(k => k.kpi_id === editingKpi.id && !k.tag?.startsWith(OVERRIDE_TAG_PREFIX));
      const isBuiltIn = builtInKpiIds.has(editingKpi.id);
      const sourceSystemId = editingKpi._sourceSystemKpiId ?? null;
      const labelChanged = data.label !== editingKpi.label;
      const descChanged  = data.description !== editingKpi.description;

      // If editing a clean system clone, treat as editing the original system KPI
      if (!isBuiltIn && sourceSystemId && builtInKpiIds.has(sourceSystemId)) {
if (!labelChanged) {
          // Benchmark/formula/desc edit on clean clone → promote to independent custom KPI
          // Auto-generate a unique label since the name is taken by the system KPI
          const baseLabel = editingKpi.label;
          const allLabels = new Set([
            ...localKpis.map(k => k.label),
            ...resolvedAllKpis.map(k => k.label),
          ]);
          let n = 2;
          while (allLabels.has(`${baseLabel} ${n}`)) n++;
          const uniqueLabel = `${baseLabel} ${n}`;
          try {
            const updated = await updateCompanyKpi({
              kpiId:            editingKpi.id, userId: authUserId,
              label:            uniqueLabel,
              description:      data.description ?? null,
              category:         data.category ?? null,
              tag:              null,
              format:           data.format ?? editingKpi.format,
              formula:          data.formula ?? editingKpi.formula,
              benchmark:        data.benchmark ?? null,
              sourceSystemKpiId: null,
            });
            setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
            setEditingKpi(null);
          } catch (e) { alert(`No se pudo actualizar: ${e.message}`); }
          return;
        } else {
          // Label changed → promote to full custom KPI, clear sourceSystemKpiId
          try {
            const updated = await updateCompanyKpi({
              kpiId: editingKpi.id, userId: authUserId,
              label:            data.label,
              description:      data.description ?? null,
              category:         data.category ?? null,
              tag:              null,
              format:           data.format ?? "currency",
              formula:          data.formula,
              benchmark:        data.benchmark ?? null,
              sourceSystemKpiId: null,
            });
            setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
            setEditingKpi(null);
          } catch (e) { alert(`No se pudo actualizar: ${e.message}`); }
          return;
        }
      }

      // If label/description changed on a built-in → promote to full custom KPI


if (isBuiltIn && !labelChanged) {
        // Any edit on built-in without label change → save as system override (shows 'edited')
        await saveSystemOverride(editingKpi.id, {
          label:       editingKpi.label,
          description: data.description,
          category:    data.category,
          format:      data.format ?? editingKpi.format,
          formula:     data.formula ?? editingKpi.formula,
          benchmark:   data.benchmark,
        });
        setEditingKpi(null);
        return;
      }

      if (!inLibrary && isBuiltIn && labelChanged) {
        // Promote built-in to full custom KPI
        try {
          const created = await createCompanyKpi({
            companyId, userId: authUserId,
            label:       data.label,
            description: data.description ?? null,
            category:    data.category ?? null,
            tag:         data.tag ?? null,
            format:      data.format ?? "currency",
            formula:     data.formula ?? editingKpi.formula,
            benchmark:   data.benchmark ?? null,
            contextMappingId: null,
            scope: "individual",
          });
setCompanyKpis(prev => [...prev, created]);
          // Replace in dashboard
setDashboardKpiIds(prev => {
            if (!prev) return prev;
const next = prev.map(id => id === editingKpi.id ? created.kpi_id : id);
            const scope = viewMode === "dimension" ? "individual_dimension" : "individual_company";
            (async () => {
              try {
                await saveUserDashboard({ userId: authUserId, companyId, kpiIds: next, scope });
                console.log("[KpiPage] dashboard persisted after promote ✓", next);
              } catch (e) {
                console.error("[KpiPage] dashboard persist FAILED after promote:", e);
              }
            })();
            return next;
          });
          setEditingKpi(null);
        } catch (e) { alert(`Could not promote KPI: ${e.message}`); }
        return;
      }

      if (!inLibrary) {
        setEditingKpi(null);
        return;
      }
try {
        const updated = await updateCompanyKpi({
          kpiId:            editingKpi.id, userId: authUserId,
          label:            data.label,
          description:      data.description ?? null,
          category:         data.category    ?? null,
          tag:              data.tag         ?? null,
          format:           data.format      ?? "currency",
          formula:          data.formula,
          benchmark:        data.benchmark   ?? null,
          sourceSystemKpiId: null,
        });
        setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
        setEditingKpi(null);
      } catch (e) {
        alert(`No se pudo actualizar: ${e.message}`);
      }
      return;
    }

const activeScope = viewMode === "dimension" ? "individual_dimension" : "individual_company";

    // Path 2a: system KPI from library picker → just add id to dashboard, no library entry
const resolveSystemId = (data) => {
      if (data.id && builtInKpiIds.has(data.id)) return data.id;
      if (data._fromLibrary) {
        const strippedId = (data.id ?? "").replace(/^_lib_/, "");
        if (strippedId && builtInKpiIds.has(strippedId)) return strippedId;
      }
      return null;
    };

const systemId = resolveSystemId(data);
    if (systemId) {
const activeOverrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
      if (activeOverrideMap.has(systemId)) {
        // An edited version already exists — create a clean copy with its own UUID
        const base = resolvedAllKpis.find(k => k.id === systemId);
        if (base) {
          try {
            const created = await createCompanyKpi({
              companyId, userId: authUserId,
              label:            base.label,
              description:      base.description ?? null,
              category:         base.category ?? null,
              tag:              null,
              format:           base.format ?? "currency",
              formula:          base.formula,
              benchmark:        base.benchmark ?? null,
              contextMappingId: null,
              scope:            "individual",
              kpiType:          "custom",
              sourceSystemKpiId: systemId,
            });
            setCompanyKpis(prev => [...prev, created]);
            addToDashboard(created.kpi_id, activeScope);
            setEditingKpi(null);
            return;
          } catch (e) { alert(`No se pudo crear: ${e.message}`); return; }
        }
      }
      addToDashboard(systemId, activeScope);
      setEditingKpi(null);
      return;
    }

    // Path 2b: existing custom KPI from library picker → just add to dashboard
    const existing = data.id ? companyKpis.find(k => k.kpi_id === data.id) : null;
    if (existing) {
      addToDashboard(existing.kpi_id, activeScope);
      setEditingKpi(null);
      return;
    }

// Path 3: brand-new KPI (preset or custom builder) → create in library + add to dashboard
    try {
const created = await createCompanyKpi({
        companyId, userId: authUserId,
        label:       data.label,
        description: data.description ?? null,
        category:    data.category    ?? null,
        tag:         (data.tag && !data.tag.startsWith("__")) ? data.tag : null,
        format:      data.format      ?? "currency",
        formula:     data.formula,
        benchmark:   data.benchmark   ?? null,
        contextMappingId: activeMapping?.mapping_id ?? null,
        scope: "individual",
      });
setCompanyKpis(prev => [...prev, created]);
      addToDashboard(created.kpi_id, activeScope);
      setEditingKpi(null);
      refreshCompanyKpis();
    } catch (e) {
      alert(`No se pudo crear: ${e.message}`);
    }
  }, [companyId, authUserId, editingKpi, activeMapping, companyKpis, addToDashboard, refreshCompanyKpis]);

  // Trash icon removes the KPI from THIS user's dashboard only — the library
  // entry stays so other users on the company still have it.
const deleteKpi = useCallback((id) => {
    const scope = viewMode === "dimension" ? "individual_dimension" : "individual_company";
    removeFromDashboard(id, scope);
  }, [removeFromDashboard, viewMode]);

 const fetchSectionData = useCallback(async (sectionConfig) => {
    const { company, startY, startM, endY, endM, source: secSource, structure: secStructure,
            dimGroupCodes, mode, kpiIds } = sectionConfig;

    if (!token || !secSource || !secStructure || !company) return [];

    // Build period list
    const periods = [];
    let pY = parseInt(startY), pM = parseInt(startM) - 1;
    if (pM < 1) { pM = 12; pY -= 1; }
    periods.push({ y: pY, m: pM, isPrior: true });
    let y = parseInt(startY), m = parseInt(startM);
    const eY = parseInt(endY), eM = parseInt(endM);
    while (y < eY || (y === eY && m <= eM)) {
      periods.push({ y, m, isPrior: false });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (periods.length > 120) break;
    }

    const results = await Promise.all(periods.map(async ({ y, m, isPrior }) => {
      const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and CompanyShortName eq '${company}'`;
      try {
        const res = await fetch(
          `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );
        if (!res.ok) return { y, m, isPrior, pivot: new Map(), hasData: false };
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        const p = new Map();
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const lac = r.LocalAccountCode ?? r.localAccountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          const dc = r.DimensionCode ?? r.dimensionCode ?? "";
          if (!ac) return;
          if (lac && lac !== "—") return;
          if (acType && acType !== "P/L") return;
          if (dimGroupCodes) {
            if (!dc || !dimGroupCodes.has(dc)) return;
          } else {
            if (dc) return;
          }
          const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          p.set(ac, (p.get(ac) ?? 0) + amt);
        });
        return { y, m, isPrior, pivot: p, hasData: rows.length > 0 };
      } catch {
        return { y, m, isPrior, pivot: new Map(), hasData: false };
      }
    }));

    const series = [];
    for (let i = 1; i < results.length; i++) {
      const curr = results[i];
      if (curr.isPrior) continue;
      let pivotForKpi;
      if (mode === "ytd") {
        pivotForKpi = curr.pivot;
      } else {
        const prev = results[i - 1];
        const mp = new Map();
        const allCodes = new Set([...curr.pivot.keys(), ...prev.pivot.keys()]);
        allCodes.forEach(ac => {
          const currYTD = curr.pivot.get(ac) ?? 0;
          const prevYTD = curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0);
          mp.set(ac, currYTD - prevYTD);
        });
        pivotForKpi = mp;
      }
const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, resolvedAllKpis);
      const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
      const row = { period: label };
      kpiIds.forEach(kid => {
        const v = kpis.get(kid);
        row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v;
      });
      series.push(row);
    }
    return series;
}, [token, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  // Build graph sections — use live refs if user visited Graphs tab, else synthesize defaults
  const buildGraphSections = useCallback(async () => {
    const result = [];
    for (const sid of [1, 2, 3]) {
      const live = graphSectionsRef.current[sid];
      if (live && live.chartData && live.chartData.length > 0) {
        // Use the live section's data and render image headlessly from it (for Excel consistency)
const imageDataUrl = await renderChartToImage({
          data: live.chartData,
          kpiIds: live.kpiIds,
          kpiList,
        }).catch(e => { console.warn("Chart render failed:", e); return null; });
        result.push({ ...live, imageDataUrl });
        continue;
      }

      // Synthesize defaults: same logic as GraphSection defaults
      const anchorY = parseInt(year) || new Date().getFullYear();
      const anchorM = parseInt(month) || new Date().getMonth() + 1;
      let startY = anchorY, startM = anchorM - 11;
      while (startM < 1) { startM += 12; startY -= 1; }

      const defaultKpiIds = ["revenue", "ebitda", "net_result"];
      const config = {
        sectionId: sid,
        company: companyCodes[0] || "",
        startY: String(startY), startM: String(startM),
        endY: String(anchorY), endM: String(anchorM),
        source, structure,
        dimGroup: "", dim: "",
        mode: "monthly",
        kpiIds: defaultKpiIds,
        dimGroupCodes: null,
      };
      const chartData = await fetchSectionData(config);
      const imageDataUrl = chartData.length > 0
? await renderChartToImage({
            data: chartData, kpiIds: defaultKpiIds, kpiList,
          }).catch(e => { console.warn("Chart render failed:", e); return null; })
        : null;
      result.push({ ...config, chartData, imageDataUrl });
    }
    return result;
}, [companyCodes, source, structure, year, month, kpiList, fetchSectionData]);

  const buildExportPayload = async () => ({
    kpiList,
    companyCodes,
    companyResults,
    dimensionCodes,
    dimensionResults,
    dimensionPivots,
    graphSections: await buildGraphSections(),
    filters: {
      source, structure, year, month,
      dimGroup: selGroup, dim: selDim,
    },
  });

  const handleExportXlsx = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      await exportKpisToXlsx(payload);
    } catch (e) { console.error("Excel export failed:", e); alert("Excel export failed — check console"); }
    finally { setExporting(false); }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      await exportKpisToPdf(payload);
    } catch (e) { console.error("PDF export failed:", e); alert("PDF export failed — check console"); }
    finally { setExporting(false); }
  };

const handleDragEnd = useCallback(() => {
const activeDashIds = viewMode === "dimension" ? dashboardKpiIdsDim : dashboardKpiIds;
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx && activeDashIds) {
      const newRows = [...kpiList];
      const [moved] = newRows.splice(dragIdx, 1);
      newRows.splice(dragOverIdx, 0, moved);
      const oldVisibleIds = kpiList.map(k => k.id);
      const newVisibleIds = newRows.map(k => k.id);
      const visibleSet = new Set(oldVisibleIds);
      const queue = [...newVisibleIds];
      const newDashboard = activeDashIds.map(id =>
        visibleSet.has(id) ? queue.shift() : id
      );
const scope = viewMode === "dimension" ? "individual_dimension" : "individual_company";
      if (viewMode === "dimension") setDashboardKpiIdsDim(newDashboard);
      else setDashboardKpiIds(newDashboard);
      persistDashboard(newDashboard, scope);
    }
    setDragIdx(null); setDragOverIdx(null);
  }, [dragIdx, dragOverIdx, kpiList, dashboardKpiIds, persistDashboard]);

  const handleColDragEnd = () => {
    if (colDragIdx !== null && colDragOverIdx !== null && colDragIdx !== colDragOverIdx) {
      const cols = orderedCols;
      const newCols = [...cols];
      const [moved] = newCols.splice(colDragIdx, 1);
      newCols.splice(colDragOverIdx, 0, moved);
      setColOrder(newCols);
    }
    setColDragIdx(null); setColDragOverIdx(null);
  };



const activeCols = viewMode === "company" ? companyCodes : dimensionCodes;
const activeResults = viewMode === "company" ? companyResults : dimensionResults;
const orderedCols = colOrder && colOrder.length === activeCols.length ? colOrder : activeCols;

  const sourceOpts = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));

return (
    <div className="flex flex-col gap-4 h-full min-h-0">
<style>{`
        @keyframes plRowSlideIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes kBadgesPop {
          0%   { opacity: 0; transform: translateY(8px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

{/* Header — built from shared <PageHeader> */}
      <PageHeader
        kicker="Individual"
        title="KPIs"
        tabs={[
          { id: "company",   label: "Company",   icon: Building2 },
          { id: "dimension", label: "Dimension", icon: Layers },
          { id: "graphs",    label: "Graphs",    icon: BarChart3 },
        ]}
        activeTab={viewMode}
        onTabChange={setViewMode}
filters={viewMode === "graphs" ? [] : [
          { label: "Year",  value: year,  onChange: setYear,
            options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
          { label: "Month", value: month, onChange: setMonth,
            options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
          ...(sourceOpts.length > 0
            ? [{ label: "Source", value: source, onChange: setSource, options: sourceOpts }]
            : []),
          ...(structureOpts.length > 0
            ? [{ label: "Structure", value: structure, onChange: setStructure, options: structureOpts }]
            : []),
...(viewMode === "dimension" && companyCodes.length > 0
            ? [{ label: "Company", values: selCompanies, onChange: setSelCompanies, options: companyCodes.map(c => ({ value: c, label: companyLegalName(c) })), multiselect: true }]
            : []),
...(dimGroups.length > 0
            ? [{
                label: "Dim Group",
                value: selGroup,
                onChange: v => { setSelGroup(v); setSelDim(""); },
                options: [{ value: "", label: "All", displayLabel: "Dim Group" }, ...dimGroups.map(g => ({ value: g, label: g }))],
              }]
            : []),
          ...(selGroup && groupDimOptions.length > 0
            ? [{
                label: "Dimension",
                value: selDim,
                onChange: setSelDim,
                options: [
                  { value: "", label: "All" },
                  ...groupDimOptions.map(d => ({ value: d.code, label: d.name || d.code })),
                ],
              }]
            : []),
        ]}
periodToggle={{
          value: viewPeriod,
          onChange: setViewPeriod,
        }}
        compareToggle={{
          active: compareMode,
          onChange: setCompareMode,
        }}
fabActions={[
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
                onClick: handleExportXlsx,
              },
              {
                id: "pdf",
                label: "PDF",
                src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png",
                alt: "PDF",
                onClick: handleExportPdf,
              },
            ],
          },
        ]}
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
            <strong className="font-black">Heads up:</strong> los cálculos de KPI se han recalculado con el nuevo mapeo en lo posible.
            {mappingMatched.length > 0 && (
              <> <span className="font-black text-amber-900">{mappingMatched.length}</span> sección{mappingMatched.length === 1 ? "" : "es"} emparejada{mappingMatched.length === 1 ? "" : "s"} ({mappingMatched.slice(0, 3).map(m => m.label).join(", ")}{mappingMatched.length > 3 ? "…" : ""}).</>
            )}
            {mappingUnmatched.length > 0 && (
              <> <span className="font-black text-amber-900">{mappingUnmatched.length}</span> sin emparejar — siguen usando la taxonomía por defecto, revísalos.</>
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


{!kpiDashReady ? (
        <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.78)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            animation: "indOverlayFadeIn 200ms ease-out",
          }}>
          <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
            style={{
              width: 380,
              boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)",
              animation: "indPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)",
            }}>
            <div className="relative" style={{ width: 140, height: 140 }}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                <circle
                  cx="70" cy="70" r="60" fill="none"
                  stroke="url(#kpiProgGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 60}
                  strokeDashoffset={2 * Math.PI * 60 * (1 - animatedKpiDashProgress / 100)}
                  style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
                />
                <defs>
                  <linearGradient id="kpiProgGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                    <stop offset="100%" stopColor={colors.secondary ?? "#CF305D"} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
                  {Math.round(animatedKpiDashProgress)}<span className="text-base text-gray-300">%</span>
                </span>
              </div>
            </div>
            <p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
              {!metaReady
                ? "Finding latest period with data…"
                : sources.length === 0 || structures.length === 0 || companies.length === 0
                  ? "Loading filter options…"
                  : groupAccounts.length === 0
                    ? "Loading group accounts…"
                    : companyData.size === 0
                      ? `Loading KPIs for ${companyCodes.length} ${companyCodes.length === 1 ? "company" : "companies"}…`
                      : "Finalizing…"}
            </p>
            <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
              Setting up your dashboard
            </p>
          </div>
          <style>{`
            @keyframes indOverlayFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes indPopIn {
              0%   { opacity: 0; transform: scale(0.92) translateY(8px); }
              100% { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </div>
) : viewMode === "graphs" ? (
<div className="flex flex-col gap-3 flex-1 min-h-0">
  <GraphSection
    sectionId={1}
    token={token}
    source={source}
    structure={structure}
    year={year}
    month={month}
    sourceOpts={sourceOpts}
    structureOpts={structureOpts}
    companyCodes={companyCodes}
    dimensions={dimensions}
    kpiList={kpiList}
    allKpis={resolvedAllKpis}
    ccTagToCodes={ccTagToCodes}
    sectionCodes={sectionCodes}
    sumAccountCodes={sumAccountCodes}
    defaultCompany={companyCodes[0] || ""}
defaultKpiIds={["revenue", "gross_profit", "net_result"]}
onStateChange={handleGraphSectionState}
viewPeriod={viewPeriod}
    compareMode={compareMode}
    companyLegalName={companyLegalName}
    filterStyle={filterStyle}
    colors={colors}
    body1Style={body1Style}
    body2Style={body2Style}
  />
</div>
      ) : loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
            <p className="text-xs text-gray-400">Loading data for {companyCodes.length} {companyCodes.length === 1 ? "company" : "companies"}…</p>
          </div>
        </div>
      ) : (
<div className="flex flex-col gap-3 flex-1 min-h-0">
{compareMode && (
<div className="bg-white rounded-2xl shadow-xl border border-gray-100 flex-shrink-0"
    style={{ overflow: "visible", position: "relative", zIndex: 30 }}>
   <div className="px-5 py-3 flex items-center gap-2 no-scrollbar" style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "visible" }}>
      <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
          <span className="text-white text-[11px] font-black">B</span>
        </div>
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Compare With</span>
      </div>
      {sourceOpts.length > 0 && (
        <HeaderFilterPill label="Source" value={cmpSource} onChange={setCmpSource} options={sourceOpts} />
      )}
      {structureOpts.length > 0 && (
        <HeaderFilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure} options={structureOpts} />
      )}
      <HeaderFilterPill label="Year" value={cmpYear} onChange={setCmpYear}
        options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
      <HeaderFilterPill label="Month" value={cmpMonth} onChange={setCmpMonth}
        options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
{dimGroups.length > 0 && (
        <HeaderFilterPill label="Dim Grp" value={selGroup} onChange={v => { setSelGroup(v); setSelDim(""); }}
          options={[{ value: "", label: "Dim Grp" }, ...dimGroups.map(g => ({ value: g, label: g }))]} />
      )}
      {selGroup && groupDimOptions.length > 0 && (
        <HeaderFilterPill label="Dims" value={selDim} onChange={setSelDim}
          options={[{ value: "", label: "Dims" }, ...groupDimOptions.map(d => ({ value: d.code, label: d.name || d.code }))]} />
      )}
    </div>
  </div>
)}
<div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1" style={{ paddingBottom: "0" }}>
            <table className="w-full text-xs border-collapse">
<thead className="sticky top-0 z-20">
<tr style={{
  background: "rgba(255,255,255,0.95)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
<th className="sticky left-0 top-0 z-20 text-left px-6 py-3 border-r border-gray-100 min-w-[250px]"
  style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: "64px" }}>
  <div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
    <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>KPI</span>
    <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>Dashboard</span>
  </div>
</th>
{orderedCols.flatMap((col, ci) => {
                    const label = viewMode === "dimension" ? (dimensionPivots.get(col)?.name ?? col) : companyLegalName(col);
                    const cells = [
<th key={col}
                        draggable
                        onDragStart={() => setColDragIdx(ci)}
                        onDragOver={e => { e.preventDefault(); setColDragOverIdx(ci); }}
                        onDragEnd={handleColDragEnd}
                        className={`text-center px-4 py-3 whitespace-nowrap min-w-[140px] cursor-grab select-none transition-all ${colDragOverIdx === ci ? "opacity-50" : ""}`}
                        style={{ background: "transparent" }}>
                        <span className="font-black tracking-tight inline-block"
                          style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em", animation: `kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) ${0.10 + ci * 0.03}s both` }}>
                          {label}
                        </span>
                      </th>
                    ];
                    if (compareMode) {
                      cells.push(
<th key={`${col}__cmp`}
                          className="text-center px-4 py-3 whitespace-nowrap min-w-[120px]"
                          style={{ background: "transparent" }}>
                          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}50`, fontSize: 10 }}>Σ cmp</span>
                        </th>,
                        <th key={`${col}__delta`}
                          className="text-center px-4 py-3 whitespace-nowrap min-w-[100px]"
                          style={{ background: "transparent" }}>
                          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}50`, fontSize: 10 }}>Δ amt</span>
                        </th>,
                        <th key={`${col}__deltapct`}
                          className="text-center px-4 py-3 whitespace-nowrap min-w-[90px]"
                          style={{ background: "transparent" }}>
                          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}50`, fontSize: 10 }}>Δ %</span>
                        </th>
                      );
                    }
                    return cells;
                  })}
<th className="sticky right-0 top-0 z-20 px-4 py-3 whitespace-nowrap border-l border-gray-100 min-w-[160px] text-center"
  style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
  <span className="font-black tracking-tight inline-block"
    style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em", animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
    Total / Avg
  </span>
</th>
                </tr>
              </thead>
              <tbody>
                {kpiList.map((kpi) => {
                  const globalIdx = kpiList.findIndex(k => k.id === kpi.id);
 const values = orderedCols.map(col => {
                    const res = activeResults.get(col);
                    if (!res) return null;
                    const v = res.get(kpi.id);
                    return (v === undefined || v === null || isNaN(v)) ? null : v;
                  });
                  const validVals = values.filter(v => v !== null);
                  const aggregate = validVals.length === 0 ? null
                    : kpi.format === "percent"
                      ? validVals.reduce((a, b) => a + b, 0) / validVals.length
                      : validVals.reduce((a, b) => a + b, 0);

return (
                    <tr key={kpi.id}
                      draggable
                      onDragStart={() => setDragIdx(globalIdx)}
                      onDragOver={e => { e.preventDefault(); setDragOverIdx(globalIdx); }}
                      onDragEnd={handleDragEnd}
                      className={`border-b border-gray-100 bg-white hover:bg-[#eef1fb]/60 transition-colors group ${dragOverIdx === globalIdx ? "bg-[#eef1fb]" : ""}`}
                      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(globalIdx, 25) * 40}ms both` }}>

<td className="sticky left-0 z-20 bg-white border-r border-gray-100 group-hover:bg-[#eef1fb]/40 transition-colors"
  style={{ padding: "14px 20px" }}>
  <div className="flex items-center gap-2.5">
    <div className="opacity-0 group-hover:opacity-30 transition-opacity cursor-grab text-gray-400 flex-shrink-0">
      <GripVertical size={11} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
<span className="truncate" style={{ ...body1Style, fontSize: (parseFloat(body1Style.fontSize) + 2) + "px" }}>
          {kpi.label}
        </span>
{kpi.category && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: `${colors.primary}12`, color: colors.primary, ...body1Style, fontWeight: 900 }}>
            {kpi.category}
          </span>
        )}
{kpi._isOverridden && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0 text-[8px] font-black uppercase tracking-wider"
            style={{ background: "#ede9fe", color: "#6d28d9" }}>
            edited
          </span>
        )}
{kpi._contextMappingId && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0 text-[8px] font-black uppercase tracking-wider"
            style={{ background: "#fef3c7", color: "#92400e" }}>
            mapped
          </span>
        )}
{kpi._kpiType === "custom" && kpi._createdBy && !kpi._contextMappingId && !kpi._sourceSystemKpiId && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0 text-[8px] font-black uppercase tracking-wider"
            style={{ background: "#dcfce7", color: "#15803d" }}>
            custom
          </span>
        )}
      </div>
{kpi.description && (
        <span className="truncate block" style={body2Style}>
          {kpi.description}
        </span>
      )}
    </div>
    <div className="opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 flex-shrink-0">
      <button onClick={() => setEditingKpi(kpi)}
        className="w-6 h-6 rounded-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: `${colors.primary}12`, color: colors.primary }}>
        <Edit3 size={9} />
      </button>
      <button onClick={() => deleteKpi(kpi.id)}
        className="w-6 h-6 rounded-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: "#fee2e2", color: "#dc2626" }}>
        <Trash2 size={9} />
      </button>
    </div>
  </div>
</td>
{values.flatMap((val, ci) => {
                        const col = orderedCols[ci];
const bColor = getBenchmarkColor(val, kpi.benchmark);
                        const out = [
                          <td key={col}
                            className="px-4 py-3 text-center whitespace-nowrap transition-all"
                            style={bColor ? {
                              background: bColor.bg,
                              borderLeft: `2px solid ${bColor.border}`,
                            } : undefined}>
                            <AnimatedCell value={val} format={kpi.format} baseStyle={{ ...body1Style, color: bColor ? bColor.text : undefined }} />
                          </td>
                        ];
if (compareMode) {
                          // Compare scenario reads from the matching cmp results
                          // map depending on the current view mode.
                          const cmpResultsMap = viewMode === "dimension" ? dimensionResultsCmp : companyResultsCmp;
                          const cmpRes = cmpResultsMap.get(col);
                          const cmpVal = cmpRes ? cmpRes.get(kpi.id) : null;
                          if (kpi.id === "revenue" && ci === 0) {
                            console.log(`[Cmp render] viewMode=${viewMode} col=${col} cmpResultsMap.size=${cmpResultsMap.size} cmpRes=${!!cmpRes} cmpVal=${cmpVal}`);
                          }
                          const cmpValid = cmpVal !== undefined && cmpVal !== null && !isNaN(cmpVal);

                          // Delta amount + percent (skip percent for percent KPIs to avoid % of %)
                          let delta = null;
                          let deltaPct = null;
                          if (cmpValid && val !== null) {
                            delta = val - cmpVal;
                            if (kpi.format !== "percent" && Math.abs(cmpVal) > 1e-9) {
                              deltaPct = ((val - cmpVal) / Math.abs(cmpVal)) * 100;
                            }
                          }

                          const cmpStyle = !cmpValid
                            ? { ...body1Style, color: "#D1D5DB" }
                            : { ...body1Style, color: cmpVal < 0 ? "#EF4444" : "#000000" };
                          const deltaStyle = delta === null
                            ? { ...body1Style, color: "#D1D5DB" }
                            : { ...body1Style, color: delta < 0 ? "#EF4444" : "#059669" };

out.push(
                            <td key={`${col}__cmp`}
                              className="px-4 py-3 text-center whitespace-nowrap bg-[#fafbff]">
                              <AnimatedCell value={cmpValid ? cmpVal : null} format={kpi.format} baseStyle={body1Style} />
                            </td>,
                            <td key={`${col}__delta`}
                              className="px-4 py-3 text-center whitespace-nowrap bg-[#f5f7ff]">
                              {delta === null
                                ? <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span>
                                : <AnimatedCell value={delta} format={kpi.format} baseStyle={{ ...body1Style, color: delta < 0 ? "#EF4444" : "#059669" }} />
                              }
                            </td>,
                            <td key={`${col}__deltapct`}
                              className="px-4 py-3 text-center whitespace-nowrap bg-[#f0f3ff]">
                              {deltaPct === null
                                ? <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span>
                                : <span className="text-xs font-black" style={{ color: deltaPct < 0 ? "#EF4444" : "#059669" }}>
                                    {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
                                  </span>
                              }
                            </td>
                          );
                        }
                        return out;
                      })}

{(() => {
                          const aggColor = getBenchmarkColor(aggregate, kpi.benchmark);
                          return (
<td className="sticky right-0 px-4 py-3 text-center whitespace-nowrap transition-all"
                              style={{
                                background: aggColor ? aggColor.bg : "#eef1fb",
                                borderLeft: aggColor ? `2px solid ${aggColor.border}` : "1px solid #e5e7eb",
                              }}>
                              {aggregate === null ? (
                                <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span>
                              ) : (
                                <>
                                  <AnimatedCell value={aggregate} format={kpi.format} baseStyle={{ ...body1Style, color: aggColor ? aggColor.text : undefined }} />
                                  <span className="text-[9px] font-normal text-gray-400 ml-1">{kpi.format === "percent" ? "avg" : "Σ"}</span>
                                </>
                              )}
                            </td>
                          );
                        })()}
                    </tr>
                  );
                })}


              </tbody>
            </table>
</div>

          {/* Add KPI — outside scroll, always pinned */}
          <div className="flex-shrink-0 px-4 py-2 border-t border-gray-50">
            <button onClick={() => setEditingKpi("new")}
              className="w-full group flex items-center justify-center gap-2.5 py-2.5 rounded-xl transition-all duration-200 hover:bg-[#eef1fb]"
              style={{ border: `1.5px dashed ${colors.primary}25` }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200 group-hover:scale-110"
                style={{ background: colors.primary, color: "white", boxShadow: `0 4px 10px -2px ${colors.primary}50` }}>
                <Plus size={12} strokeWidth={3} />
              </div>
              <span className="text-[11px] font-black uppercase tracking-[0.18em] transition-colors duration-200"
                style={{ color: colors.primary, opacity: 0.6 }}>
                Add KPI
              </span>
            </button>
          </div>

</div>
      </div>
      )}

      {/* Editor modal */}
{editingKpi !== null && (
        <KpiEditorModal
          kpi={editingKpi === "new" ? null : editingKpi}
          onSave={saveKpi}
          onClose={() => setEditingKpi(null)}
          onReset={resetSystemOverride}
          onEditLibraryKpi={(k) => { setEditingKpi(null); setTimeout(() => setEditingKpi(k), 0); }}
onDeleteLibraryKpi={async (id) => {
            try {
              await deleteCompanyKpi({ kpiId: id });
              setCompanyKpis(prev => prev.filter(k => k.kpi_id !== id));
              removeFromDashboard(id, viewMode === "dimension" ? "individual_dimension" : "individual_company");
              refreshCompanyKpis();
            } catch (e) { alert(`Could not delete: ${e.message}`); }
          }}
          onDuplicate={async (data) => {
            if (!companyId || !authUserId) return;
            // Auto-increment suffix: "Label 2" → "Label 3" etc.
            const base = data.label.replace(/ \d+$/, "");
            const existing = [...(localKpis ?? []), ...(resolvedKpiList ?? [])];
            let n = 2;
            while (existing.some(k => k.label === `${base} ${n}`)) n++;
            try {
              const created = await createCompanyKpi({
                companyId, userId: authUserId,
                label:       `${base} ${n}`,
                description: data.description ?? null,
                category:    data.category ?? null,
                tag:         null,
                format:      data.format ?? "currency",
                formula:     data.formula,
                benchmark:   data.benchmark ?? null,
                contextMappingId: null,
                scope: "individual",
              });
              setCompanyKpis(prev => [...prev, created]);
            } catch (e) { alert(`Could not duplicate: ${e.message}`); }
          }}
kpiList={kpiList}
          allLocalKpis={localKpis}
          systemKpis={resolvedAllKpis}
          accountCodes={allAccountCodes}
          accountCodeLabels={accountCodeLabels}
builtInIds={new Set(resolvedAllKpis.map(k => k.id))}
          currentUserId={authUserId}
          dimsByAccount={dimsByAccount}
        />
      )}
    </div>
  );
} 