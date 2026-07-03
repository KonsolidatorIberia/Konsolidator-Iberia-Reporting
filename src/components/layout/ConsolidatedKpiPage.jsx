/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTypo, useSettings } from "./SettingsContext";
import {
  ChevronDown, Loader2, X, Plus, Trash2, Edit3,
  GripVertical, Check, Sigma, BarChart3, Layers,
  Library, Download, CheckCircle2, AlertTriangle,
  TrendingUp, Building2, Search,
} from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill } from "./PageHeader.jsx";

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
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";

// ── KPI Resolver (same as individual) ─────────────────────────────
const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const SB_HEADERS = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };
const sbGet = (path) => fetch(`${SUPABASE_URL}/${path}`, { headers: SB_HEADERS }).then(r => r.json());
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
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  const to = isNum ? value : 0;
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    if (from === to) return;
    startRef.current = null;
    const duration = 800;
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to]);
  if (!isNum) return <span style={{ ...baseStyle, color: "#D1D5DB" }}>—</span>;
  return <span style={{ ...baseStyle, color: value < 0 ? "#EF4444" : "#000000" }}>{fmtValue(display, format)}</span>;
}



const DEFAULT_VISIBLE_KPI_IDS = new Set(["revenue","gross_profit","net_result","net_margin"]);

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

// ── Standard detection ─────────────────────────────────────────────
function detectStandard(groupAccounts) {
  if (!groupAccounts?.length) return null;
  const codes = [];
  groupAccounts.forEach(n => {
    const ac = String(n.accountCode ?? n.AccountCode ?? "");
    const pc = String(n.parentCode  ?? n.ParentCode  ?? "");
    if (ac) codes.push(ac);
    if (pc) codes.push(pc);
  });
  if (!codes.length) return null;
  const isPGC          = codes.some(c => c.endsWith(".S"));
  const isSpanishIfrsEs = !isPGC && codes.some(c => c.endsWith(".PL"));
  const isSpanishIFRS   = !isPGC && !isSpanishIfrsEs && codes.some(c => /^[A-Z]\.\d/.test(c));
  const isDanishIFRS    = !isPGC && !isSpanishIfrsEs && !isSpanishIFRS && codes.some(c => /^\d{5,6}$/.test(c));
  if (isPGC)           return "PGC";
  if (isSpanishIfrsEs) return "SpanishIFRS-ES";
  if (isSpanishIFRS)   return "SpanishIFRS";
  if (isDanishIFRS)    return "DanishIFRS";
  return null;
}

const STANDARD_TO_PL_TABLE = { PGC: "pgc_pl_rows", DanishIFRS: "danish_ifrs_pl_rows", "SpanishIFRS-ES": "spanish_ifrs_es_pl_rows" };
const STANDARD_TO_BS_TABLE = { PGC: "pgc_bs_rows", DanishIFRS: "danish_ifrs_bs_rows", "SpanishIFRS-ES": "spanish_ifrs_es_bs_rows" };

async function loadStandardMapping(standard, groupAccounts) {
  const plTable = STANDARD_TO_PL_TABLE[standard];
  const bsTable = STANDARD_TO_BS_TABLE[standard];
  if (!plTable) return null;
  const [plRows, bsRows] = await Promise.all([
    sbGet(`${plTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`),
    sbGet(`${bsTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`).catch(() => []),
  ]);
  const allRows = [...(Array.isArray(plRows) ? plRows : []), ...(Array.isArray(bsRows) ? bsRows : [])];
  const codeCcTag = new Map();
  const codeSection = new Map();
  for (const r of allRows) {
    if (r.cc_tag) codeCcTag.set(String(r.account_code), r.cc_tag);
    if (r.section_code) codeSection.set(String(r.account_code), r.section_code);
  }
  const parentOf = new Map();
  for (const ga of (groupAccounts || [])) {
    if (ga.AccountCode && ga.SumAccountCode) parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
  }
  const ccTagToCodes = new Map();
  const sectionCodes = new Map();
  for (const ga of (groupAccounts || [])) {
    const code = String(ga.AccountCode);
    let cur = code, hops = 0, foundTag = null, foundSection = null;
    while (cur && hops < 25) {
      if (codeCcTag.has(cur) && !foundTag) foundTag = codeCcTag.get(cur);
      if (codeSection.has(cur) && !foundSection) foundSection = codeSection.get(cur);
      if (foundTag && foundSection) break;
      cur = parentOf.get(cur); hops++;
    }
    if (foundTag) {
      if (!ccTagToCodes.has(foundTag)) ccTagToCodes.set(foundTag, []);
      ccTagToCodes.get(foundTag).push(code);
      if (foundSection) {
        const key = `${foundTag}::${foundSection}`;
        if (!sectionCodes.has(key)) sectionCodes.set(key, []);
        sectionCodes.get(key).push(code);
      }
    }
  }
  return { ccTagToCodes, sectionCodes };
}

async function loadKpiLibrary(standard) {
  const [defs, overrides] = await Promise.all([
    sbGet("kpi_definitions?select=*&order=sort_order.asc"),
    standard ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}`).catch(() => []) : Promise.resolve([]),
  ]);
  if (!Array.isArray(defs)) return [];
  const overrideByKpi = new Map();
  if (Array.isArray(overrides)) overrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  return defs.map(d => ({
    id: d.id, label: d.label, description: d.description ?? "",
    category: d.category ?? "", format: d.format ?? "currency",
    tag: d.tag ?? "", benchmark: d.benchmark ?? null,
    formula: overrideByKpi.get(d.id) ?? d.formula,
  }));
}

function useResolvedKpiList(groupAccounts) {
  const standard = useMemo(() => detectStandard(groupAccounts), [groupAccounts]);
  const [state, setState] = useState({ kpiList: [], allKpis: [], ccTagToCodes: new Map(), sectionCodes: new Map(), standard: null, ready: false });
  useEffect(() => {
    let cancelled = false;
    if (!standard) { setState(s => ({ ...s, ready: true, kpiList: [], standard: null })); return; }
    setState(s => ({ ...s, ready: false }));
    Promise.all([loadStandardMapping(standard, groupAccounts), loadKpiLibrary(standard)])
      .then(([mapping, fullKpiList]) => {
        if (cancelled) return;
        const visibleKpis = fullKpiList.filter(k => DEFAULT_VISIBLE_KPI_IDS.has(k.id));
        setState({ kpiList: visibleKpis, allKpis: fullKpiList, ccTagToCodes: mapping?.ccTagToCodes ?? new Map(), sectionCodes: mapping?.sectionCodes ?? new Map(), standard, ready: true });
      })
      .catch(() => { if (!cancelled) setState(s => ({ ...s, ready: true })); });
    return () => { cancelled = true; };
  }, [standard, groupAccounts]);
  return state;
}

// ── Formula evaluator ──────────────────────────────────────────────
function pivotSum(pivot, codes) {
  if (!codes || codes.size === 0) return 0;
  let total = 0;
  codes.forEach(code => { total += (pivot.get(code) ?? 0); });
  return total;
}

function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;
  switch (node.type) {
    case "manual": return Number(node.value) || 0;
    case "op": {
      const l = evalFormulaWithCcTags(node.left, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
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
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
    case "section": {
      const key = `${node.statement}::${node.section}`;
      const codes = sectionCodes.get(key);
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
    case "account": { let t = 0; pivot.forEach((v, ac) => { if (ac === node.accountCode) t += v; }); return -t; }
    case "accountGroup": { let t = 0; pivot.forEach((v, ac) => { if (node.prefix && ac.startsWith(node.prefix)) t += v; }); return -t; }
    default: return 0;
  }
}

function computeAllKpisResolved(visibleKpis, pivot, ccTagToCodes, sectionCodes, allKpis) {
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

// ── Formatters ─────────────────────────────────────────────────────
function fmtValue(val, format) {
  if (val === null || val === undefined || isNaN(val)) return "—";
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
  if (check(benchmark.vhealthy)) return { bg: "linear-gradient(90deg, rgba(26,47,138,0.08) 0%, rgba(26,47,138,0.03) 60%, transparent 100%)", border: "rgba(26,47,138,0.25)", text: "#1a2f8a" };
  if (check(benchmark.healthy)) return { bg: "linear-gradient(90deg, rgba(22,163,74,0.10) 0%, rgba(22,163,74,0.04) 60%, transparent 100%)", border: "rgba(22,163,74,0.35)", text: "#16a34a" };
  if (check(benchmark.unhealthy)) return { bg: "linear-gradient(90deg, rgba(220,38,38,0.08) 0%, rgba(220,38,38,0.03) 60%, transparent 100%)", border: "rgba(220,38,38,0.25)", text: "#dc2626" };
  return null;
}

function parseAmt(val) {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  return parseFloat(String(val).replace(/,/g, "")) || 0;
}

function parseDimensions(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("||").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
  }).filter(Boolean);
}

function normalizeLabel(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const CC_TAG_SYNONYMS = {
  revenue: ["ingresos","revenue","ventas","sales","income"],
  gross_profit: ["margen bruto","gross profit"],
  net_result: ["resultado neto","net result","net income"],
  ebitda: ["ebitda"],
  ebit: ["resultado de explotacion","ebit"],
  current_assets: ["activo corriente","current assets"],
  total_assets: ["total activo","total assets"],
  total_equity: ["patrimonio neto","total equity"],
};

function extractSectionsFromTree(tree) {
  if (!Array.isArray(tree)) return new Map();
  const result = new Map();
  function walk(nodes, label) {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "breaker") {
        const lbl = String(node.name ?? "").trim();
        if (lbl && !result.has(lbl)) result.set(lbl, []);
        walk(node.children || [], lbl);
      } else {
        const code = String(node.code ?? "");
        if (code && label && result.has(label)) result.get(label).push(code);
        walk(node.children || [], label);
      }
    }
  }
  walk(tree, null);
  return result;
}

// ── FilterPill ─────────────────────────────────────────────────────
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
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3 ${selected ? "text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
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

// ── Icon components ────────────────────────────────────────────────
function ExcelLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32"><path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#107C41"/><path d="M19 4v8h8" fill="#0B5E30"/><path d="M14.5 15.5 17 19l-2.5 3.5h1.8L18 20.1l1.7 2.4h1.8L19 19l2.5-3.5h-1.8L18 17.9l-1.7-2.4z" fill="#fff"/></svg>
  );
}
function PdfLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32"><path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#D93025"/><path d="M19 4v8h8" fill="#A1271B"/><text x="9" y="23" fill="#fff" fontSize="7" fontWeight="700" fontFamily="Arial,sans-serif">PDF</text></svg>
  );
}

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
    key: "liquidez", label: "Liquidez", color: "bg-emerald-700",
    kpis: [
      { id: "_lib_current_ratio", label: "Ratio Liquidez", description: "Mide cuántos pesos de activos líquidos respaldan cada peso de deuda a corto plazo.", benchmark: "> 1.5 saludable; entre 1 y 1.5 aceptable", format: "number", category: "Liquidez", formula: { type: "ref", kpiId: "current_ratio" } },
      { id: "_lib_quick_ratio", label: "Prueba Ácida (Quick Ratio)", description: "Excluye inventarios por ser el activo menos líquido. Medida más estricta de la liquidez real.", benchmark: "> 1.0 ideal", format: "number", category: "Liquidez", formula: { type: "ref", kpiId: "quick_ratio" } },
      { id: "_lib_cash_ratio", label: "Ratio de Tesorería (Cash Ratio)", description: "Solo considera el efectivo y equivalentes disponibles de inmediato.", benchmark: "> 0.2 aceptable", format: "number", category: "Liquidez", formula: { type: "ref", kpiId: "cash_ratio" } },
      { id: "_lib_working_capital", label: "Capital Circulante (Working Capital)", description: "Recursos disponibles para operar la empresa luego de cubrir todas las obligaciones a corto plazo.", benchmark: "Positivo y creciente", format: "currency", category: "Liquidez", formula: { type: "ref", kpiId: "working_capital" } },
    ],
  },
  {
    key: "solvencia", label: "Solvencia / Endeudamiento", color: "bg-blue-700",
    kpis: [
      { id: "_lib_debt_ratio", label: "Razón de Endeudamiento", description: "Porcentaje de los activos financiados con deuda.", benchmark: "< 50% conservador", format: "percent", category: "Solvencia", formula: { type: "ref", kpiId: "debt_ratio" } },
      { id: "_lib_debt_to_equity", label: "Apalancamiento Financiero (D/E)", description: "Compara la deuda total con el capital propio.", benchmark: "< 1.0 conservador; varía por sector", format: "number", category: "Solvencia", formula: { type: "ref", kpiId: "debt_to_equity" } },
      { id: "_lib_net_debt_ebitda", label: "Deuda Neta / EBITDA", description: "Cuántos años le tomaría pagar su deuda neta con el flujo operativo generado.", benchmark: "< 3x manejable; > 5x elevado", format: "number", category: "Solvencia", formula: { type: "ref", kpiId: "net_debt_to_ebitda" } },
      { id: "_lib_interest_coverage", label: "Cobertura de Intereses", description: "Cuántas veces puede la empresa pagar sus intereses con su utilidad operativa.", benchmark: "> 3x saludable", format: "number", category: "Solvencia", formula: { type: "op", op: "/", left: null, right: null } },
    ],
  },
  {
    key: "rentabilidad", label: "Rentabilidad", color: "bg-[#1a2f8a]",
    kpis: [
      { id: "_lib_gross_margin", label: "Margen Bruto", description: "Porcentaje de las ventas que queda tras el costo directo.", benchmark: "Depende del sector", format: "percent", category: "Rentabilidad", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "gross_profit" }, right: { type: "ref", kpiId: "revenue" } } } },
      { id: "_lib_ebit_margin", label: "Margen Operativo (EBIT %)", description: "Utilidad generada por la operación principal antes de intereses e impuestos.", benchmark: "> 10% generalmente bueno", format: "percent", category: "Rentabilidad", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "ebit" }, right: { type: "ref", kpiId: "revenue" } } } },
      { id: "_lib_net_margin", label: "Margen Neto", description: "Cuántos centavos de utilidad neta genera cada peso de ventas.", benchmark: "Depende del sector", format: "percent", category: "Rentabilidad", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "net_result" }, right: { type: "ref", kpiId: "revenue" } } } },
      { id: "_lib_roa", label: "ROA — Rentabilidad sobre Activos", description: "Eficiencia con que la empresa usa todos sus activos.", benchmark: "> 5% bueno; > 10% excelente", format: "percent", category: "Rentabilidad", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "net_result" }, right: { type: "ref", kpiId: "total_assets" } } } },
      { id: "_lib_roe", label: "ROE — Rentabilidad sobre Patrimonio", description: "Retorno generado para los accionistas.", benchmark: "> 15% atractivo", format: "percent", category: "Rentabilidad", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: "net_result" }, right: { type: "ref", kpiId: "total_equity" } } } },
      { id: "_lib_ebitda", label: "EBITDA", description: "Aproximación al flujo de caja operativo.", benchmark: "Positivo y creciente", format: "currency", category: "Rentabilidad", formula: { type: "ref", kpiId: "ebitda" } },
      { id: "_lib_ebit", label: "EBIT", description: "Earnings before interest and tax.", benchmark: "Positivo y creciente", format: "currency", category: "Rentabilidad", formula: { type: "ref", kpiId: "ebit" } },
    ],
  },
  {
    key: "eficiencia", label: "Eficiencia", color: "bg-amber-600",
    kpis: [
      { id: "_lib_asset_turnover", label: "Rotación de Activos Totales", description: "Cuántos pesos en ventas genera cada peso invertido en activos.", benchmark: "> 1x generalmente bueno", format: "number", category: "Eficiencia", formula: { type: "ref", kpiId: "asset_turnover" } },
      { id: "_lib_dio", label: "Días de Inventario (DIO)", description: "Promedio de días que el inventario permanece almacenado.", benchmark: "Menor = más eficiente", format: "number", category: "Eficiencia", formula: { type: "ref", kpiId: "inventory_days" } },
      { id: "_lib_dso", label: "Días de Cobro (DSO)", description: "Días promedio que tarda la empresa en cobrar.", benchmark: "Menor = más eficiente", format: "number", category: "Eficiencia", formula: { type: "ref", kpiId: "dso" } },
      { id: "_lib_dpo", label: "Días de Pago a Proveedores (DPO)", description: "Días promedio que la empresa demora en pagar.", benchmark: "Mayor puede ser favorable", format: "number", category: "Eficiencia", formula: { type: "ref", kpiId: "dpo" } },
    ],
  },
  {
    key: "mercado", label: "Mercado", color: "bg-rose-800",
    kpis: [
      { label: "EPS — Utilidad por Acción", description: "Cuánta utilidad corresponde a cada acción emitida.", benchmark: "Positivo y creciente", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
      { label: "P/E — Precio / Utilidad", description: "Cuántas veces paga el mercado la utilidad anual.", benchmark: "10x–20x común; varía por sector", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
      { label: "P/BV — Precio / Valor en Libros", description: "Compara el valor de mercado con el patrimonio contable.", benchmark: "> 1x indica prima; < 1x posible subvaloración", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
      { label: "Dividend Yield", description: "Retorno anual en dividendos respecto al precio actual.", benchmark: "> 3% atractivo para renta", format: "percent", category: "Mercado", formula: { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: null, right: null } } },
      { label: "EV/EBITDA", description: "Múltiplo de valoración independiente de la estructura de capital.", benchmark: "6x–12x común en industria", format: "number", category: "Mercado", formula: { type: "op", op: "/", left: null, right: null } },
    ],
  },
];

function LibraryPicker({ onSave, onDuplicate }) {
  const [activeSection, setActiveSection] = useState(null);
  if (!activeSection) {
    const SECTION_META = {
      liquidez:     { icon: "💧", hint: "Capacidad de pagar obligaciones a corto plazo" },
      solvencia:    { icon: "🏦", hint: "Nivel de deuda y solidez financiera estructural" },
      rentabilidad: { icon: "📈", hint: "Márgenes, retornos y generación de beneficios" },
      eficiencia:   { icon: "⚙️", hint: "Gestión de activos, cobros, pagos e inventarios" },
      mercado:      { icon: "📊", hint: "Valoración bursátil y métricas para inversores" },
    };
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
                  <span className="text-[10px] font-black text-gray-300 group-hover:text-[#1a2f8a]/40 transition-colors">{sec.kpis.length} indicadores</span>
                </div>
                <p className="text-sm font-black text-[#1a2f8a] mb-1.5">{sec.label}</p>
                <p className="text-xs text-gray-400 leading-snug">{meta.hint}</p>
              </button>
            );
          })}
          <button onClick={() => onSave("__custom__")}
            className="text-left p-5 rounded-2xl border border-gray-100 hover:border-[#1a2f8a]/25 hover:shadow-md transition-all group bg-white hover:bg-[#f8f9ff]">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1a2f8a] to-[#4f63c2] flex items-center justify-center flex-shrink-0 shadow-md shadow-[#1a2f8a]/20 group-hover:scale-110 transition-transform">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 4v10M4 9h10" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
              </div>
              <span className="text-[9px] font-black text-gray-300 group-hover:text-[#1a2f8a]/40 transition-colors">desde cero</span>
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
        <button onClick={() => setActiveSection(null)} className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 hover:text-[#1a2f8a] transition-colors">
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
              {k.benchmark && <p className="text-[10px] text-gray-600 mt-2 italic">{k.benchmark}</p>}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDuplicate?.({ ...k, label: k.label + " 2" }); }}
              className="absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
              style={{ background: "#eef1fb", color: "#1a2f8a" }} title="Duplicate">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchableList({ items, value, onChange, placeholder = "Buscar..." }) {
  const [search, setSearch] = useState("");
  const filtered = items.filter(i => i.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-[#f8f9ff] pr-7" />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"><X size={10} /></button>}
      </div>
      <div className="max-h-[55vh] overflow-y-auto flex flex-col gap-0.5 border border-gray-100 rounded-xl bg-white">
        {filtered.length === 0 ? <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
          : filtered.map(item => (
            <button key={item} onClick={() => onChange(item)}
              className={`text-left px-3 py-2 text-xs transition-all flex items-center justify-between ${value === item ? "bg-[#1a2f8a] text-white font-black" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a] font-medium"}`}>
              {item}{value === item && <Check size={10} />}
            </button>
          ))}
      </div>
    </div>
  );
}

function KpiRefPicker({ kpiList, kpiId, setKpiId, builtInIds }) {
  const [search, setSearch] = useState("");
  const filtered = kpiList.filter(k => !search.trim() || k.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar KPI..."
          className="w-full rounded-xl px-3 py-2 text-xs text-gray-700 outline-none pr-7"
          style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300"><X size={10} /></button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-100 bg-white">
        {filtered.length === 0 ? <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
          : filtered.map(k => {
            const isSystem = builtInIds?.has(k.id);
            const selected = kpiId === k.id;
            return (
              <button key={k.id} onClick={() => setKpiId(k.id)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all border-b border-gray-50 last:border-0"
                style={{ background: selected ? "#eef1fb" : "transparent", color: selected ? "#1a2f8a" : "#374151" }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#f8f9ff"; }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isSystem ? "#1a2f8a" : "#16a34a" }} />
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
  const selectedCode = value?.split(":::")?.[0] ?? value;
  const filtered = items.filter(i => !search.trim() || i.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cuenta..."
          className="w-full rounded-xl px-3 py-2 text-xs text-gray-700 outline-none pr-7"
          style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300"><X size={10} /></button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-100 bg-white">
        {filtered.length === 0 ? <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
          : filtered.map(item => {
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
                        style={{ background: "#fef3c7", color: "#d97706" }}>dims</span>
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
                      style={{ paddingLeft: 48, paddingRight: 16, background: isDimSelected ? "#fef3c7" : "transparent" }}
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
  const confirm = () => {
    if (type === "accountGroup") onSelect({ type: "accountGroup", prefix });
    else if (type === "account") {
      if (accountCode.includes(":::")) {
        const [ac, dimGroup, dimCode] = accountCode.split(":::");
        onSelect({ type: "account", accountCode: ac, dimGroup: dimGroup || undefined, dimCode: dimCode || undefined });
      } else { onSelect({ type: "account", accountCode }); }
    } else if (type === "ref") onSelect({ type: "ref", kpiId });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative flex flex-col bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
        style={{ boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25)", height: "90vh", maxHeight: "90vh" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {step === "detail" && (
              <button onClick={() => setStep("type")} className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110" style={{ background: "#f3f4f6", color: "#6b7280" }}>
                <ChevronDown size={12} className="rotate-90" />
              </button>
            )}
            <p className="font-black text-[14px] text-gray-900 leading-tight">{step === "type" ? "Tipo de variable" : type}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110" style={{ background: "#f3f4f6", color: "#6b7280" }}><X size={12} /></button>
        </div>
        <div className="h-px mx-5" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />
        {step === "type" && (
          <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
            {[
              { id: "accountGroup", label: "Grupo de cuentas", desc: "Suma todas las cuentas bajo un código padre", icon: "Σ", iconBg: "#dbeafe", iconColor: "#1d4ed8" },
              { id: "account", label: "Cuenta individual", desc: "Código exacto de una cuenta", icon: "#", iconBg: "#eef1fb", iconColor: "#1a2f8a" },
              { id: "ref", label: "KPI existente", desc: "Referencia a otro KPI calculado", icon: "↗", iconBg: "#f3e8ff", iconColor: "#7c3aed" },
            ].map(t => (
              <button key={t.id} onClick={() => { setType(t.id); setStep("detail"); }}
                className="text-left rounded-2xl border transition-all duration-200 group flex-1 flex items-center"
                style={{ background: "#f8f9ff", borderColor: "#e8eaf0", padding: "24px 24px" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#1a2f8a30"; e.currentTarget.style.background = "#fff"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e8eaf0"; e.currentTarget.style.background = "#f8f9ff"; }}>
                <div className="flex items-center gap-4 w-full">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl font-black" style={{ background: t.iconBg, color: t.iconColor }}>{t.icon}</div>
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
        {step === "detail" && (
          <div className="p-5 flex flex-col gap-4 flex-1 min-h-0">
            {type === "accountGroup" && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-gray-400 leading-snug bg-blue-50 px-3 py-2 rounded-xl">Suma todas las cuentas cuyo código empiece por este prefijo.</p>
                <SearchableList items={groupPrefixes.length > 0 ? groupPrefixes : accountCodes} value={prefix} onChange={setPrefix} placeholder="Buscar prefijo..." />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {type === "account" && (() => {
                const items = accountCodes.map(ac => ({ code: ac, label: accountCodeLabels.get(ac) ? `${ac} — ${accountCodeLabels.get(ac)}` : ac }));
                return <AccountPicker items={items} value={accountCode} onChange={setAccountCode} dimsByAccount={dimsByAccount} />;
              })()}
              {type === "ref" && <KpiRefPicker kpiList={kpiList} kpiId={kpiId} setKpiId={setKpiId} builtInIds={builtInIds} />}
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
    return <span className="font-black">{base}</span>;
  }
  if (node.type === "ref") { const k = kpiList.find(k => k.id === node.kpiId); return <span className="font-black">{k?.label || node.kpiId || "?"}</span>; }
  if (node.type === "manual") return <span className="font-black">{node.value}</span>;
  return <span className="text-gray-400 text-[10px]">complejo</span>;
}

function Slot({ node, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), color = "bg-[#eef1fb] text-[#1a2f8a] border-[#1a2f8a]/20" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:shadow-sm ${node ? color : "bg-gray-50 text-gray-400 border-gray-200 border-dashed hover:border-[#1a2f8a]/30 hover:bg-[#f8f9ff]"}`}>
        {node ? <SlotLabel node={node} kpiList={kpiList} accountCodeLabels={accountCodeLabels} /> : <><Plus size={10} className="opacity-50" /> variable</>}
      </button>
      {open && <SlotPicker onSelect={onChange} onClose={() => setOpen(false)} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} />}
    </>
  );
}

const OP_SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷" };

const VARIABLE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function TextFormulaBuilder({ formula, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map() }) {
  const [expression, setExpression] = useState(() => formula?.type === "text" ? formula.expression ?? "" : "");
  const [variables, setVariables] = useState(() => formula?.type === "text" ? formula.variables ?? {} : {});
  const [editingVar, setEditingVar] = useState(null);
  const inputRef = useRef(null);
  const lastSyncRef = useRef(formula);
  useEffect(() => {
    if (formula === lastSyncRef.current) return;
    lastSyncRef.current = formula;
    const nextExpr = formula?.type === "text" ? (formula.expression ?? "") : "";
    const nextVars = formula?.type === "text" ? (formula.variables ?? {}) : {};
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
    setExpression(newExpr); setVariables(newVars);
    onChange({ type: "text", expression: newExpr, variables: newVars });
    setTimeout(() => { el.focus(); el.setSelectionRange(start + 1, start + 1); }, 0);
  };
  const updateExpr = (val) => {
    const newVars = { ...variables };
    Object.keys(newVars).forEach(l => { if (!val.includes(l)) delete newVars[l]; });
    [...new Set([...val.matchAll(/[A-Z]/g)].map(m => m[0]))].forEach(l => { if (!(l in newVars)) newVars[l] = null; });
    setExpression(val); setVariables(newVars);
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
    setExpression(newExpr); setVariables(newVars);
    onChange({ type: "text", expression: newExpr, variables: newVars });
  };
  const VAR_COLORS = ["bg-blue-50 text-blue-700 border-blue-200","bg-purple-50 text-purple-700 border-purple-200","bg-emerald-50 text-emerald-700 border-emerald-200","bg-amber-50 text-amber-700 border-amber-200","bg-rose-50 text-rose-700 border-rose-200","bg-orange-50 text-orange-700 border-orange-200"];
  const colorFor = (letter) => VAR_COLORS[VARIABLE_LETTERS.indexOf(letter) % VAR_COLORS.length];
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div className="flex items-center gap-2 mb-1.5"><label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Expresión</label></div>
        <div className="flex gap-2">
          <input ref={inputRef} value={expression} onChange={e => updateExpr(e.target.value)} placeholder="e.g.  (A - B) / C * 100"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white tracking-wide" />
          <button onClick={insertVariable} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1a2f8a] text-white text-xs font-black hover:bg-[#1a2f8a]/90 transition-all flex-shrink-0">
            <Plus size={11} /><span className="font-mono">{nextLetter}</span>
          </button>
        </div>
      </div>
      {usedLetters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Mapping de variables</label>
          {usedLetters.sort().map(letter => (
            <div key={letter} className={`flex items-center gap-2 p-2.5 rounded-xl border ${colorFor(letter)}`}>
              <span className="font-mono font-black text-sm w-5 text-center flex-shrink-0">{letter}</span>
              <span className="text-[10px] font-black opacity-40">=</span>
              <div className="flex-1 min-w-0">
                {variables[letter] ? (
                  <button onClick={() => setEditingVar(letter)} className="text-xs font-black truncate hover:opacity-70 transition-opacity text-left w-full">
                    <SlotLabel node={variables[letter]} kpiList={kpiList} accountCodeLabels={accountCodeLabels} />
                  </button>
                ) : (
                  <button onClick={() => setEditingVar(letter)} className="text-[10px] font-bold opacity-50 hover:opacity-80 transition-opacity italic">sin asignar — click para definir</button>
                )}
              </div>
              <button onClick={() => setEditingVar(letter)} className="flex-shrink-0 w-6 h-6 rounded-lg bg-white/50 hover:bg-white flex items-center justify-center transition-all"><Edit3 size={9} /></button>
              <button onClick={() => removeVar(letter)} className="flex-shrink-0 w-6 h-6 rounded-lg bg-white/50 hover:bg-red-100 hover:text-red-500 flex items-center justify-center transition-all"><X size={9} /></button>
            </div>
          ))}
        </div>
      )}
      {editingVar && <SlotPicker onSelect={(node) => updateVar(editingVar, node)} onClose={() => setEditingVar(null)} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} />}
    </div>
  );
}

function LibTagPill({ value, onChange, allLocalKpis }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const tags = useMemo(() => { const seen = new Set(); allLocalKpis.forEach(k => { if (k.tag && k.tag !== "__library__") seen.add(k.tag); }); return [...seen].sort(); }, [allLocalKpis]);
  const options = [{ value: null, label: "All tags" }, ...tags.map(t => ({ value: t, label: t }))];
  const display = options.find(o => o.value === value)?.label ?? "All tags";
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  if (tags.length === 0) return null;
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all"
        style={{ background: value ? colors.primary : "#f8f9ff", color: value ? "#fff" : "#6b7280", border: `1.5px solid ${value ? colors.primary : "#e8eaf0"}` }}>
        <span>{display}</span><ChevronDown size={10} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 min-w-[160px] rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)" }}>
          <div className="p-1.5 overflow-y-auto" style={{ maxHeight: "calc(5 * 36px)", scrollbarWidth: "none" }}>
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={String(o.value)} onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{ background: selected ? colors.primary : "transparent", color: selected ? "#fff" : "#475569" }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}{selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
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
  const options = [{ value: null, label: "All categories" }, ...["Liquidez","Solvencia","Rentabilidad","Eficiencia","Mercado","P&L","Custom"].map(c => ({ value: c, label: c }))];
  const display = options.find(o => o.value === value)?.label ?? "All categories";
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all"
        style={{ background: value ? colors.primary : "#f8f9ff", color: value ? "#fff" : "#6b7280", border: `1.5px solid ${value ? colors.primary : "#e8eaf0"}` }}>
        <span>{display}</span><ChevronDown size={10} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 min-w-[160px] rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)" }}>
          <div className="p-1.5 overflow-y-auto" style={{ maxHeight: "calc(5 * 36px)", scrollbarWidth: "none" }}>
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={String(o.value)} onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{ background: selected ? colors.primary : "transparent", color: selected ? "#fff" : "#475569" }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}{selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_OPTIONS = [
  { value: "Liquidez", label: "Liquidez" }, { value: "Solvencia", label: "Solvencia" },
  { value: "Rentabilidad", label: "Rentabilidad" }, { value: "Eficiencia", label: "Eficiencia" },
  { value: "Mercado", label: "Mercado" }, { value: "__custom__", label: "Custom…" },
];

function CategoryPill({ value, onChange, options: optionsProp }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const options = optionsProp ?? CATEGORY_OPTIONS;
  const display = options.find(o => o.value === value)?.label ?? value ?? "—";
  return (
    <div ref={ref} className="relative w-full">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
        style={{ background: "#f8f9ff", border: `1.5px solid ${open ? `${colors.primary}40` : "#e8eaf0"}` }}>
        <span style={{ color: value ? "#1f2937" : "#9ca3af" }}>{display}</span>
        <ChevronDown size={11} style={{ color: colors.primary, opacity: 0.4, transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)", animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          <div className="p-1.5">
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{ background: selected ? colors.primary : "transparent", color: selected ? "#fff" : "#475569" }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}{selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
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
    const COLS = 40, ROWS = 20;
    const pw = W / COLS, ph = H / ROWS;
    const particles = [];
    const colors = ["#1a2f8a","#3b54b8","#6b7280","#9ca3af","#e5e7eb","#eef1fb","#f8f9ff","#ffffff","#d1d5db","#4f63c2"];
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const x = col * pw + pw / 2, y = row * ph + ph / 2;
        const delay = (col / COLS) * 0.6 + Math.random() * 0.25;
        const spread = Math.random() * 0.4 + 0.8;
        const vx = (Math.random() * 2 + 1) * spread, vy = (Math.random() * 1.5 - 0.3) * spread;
        const size = Math.random() * (pw * 0.6) + 1.5;
        const color = colors[Math.floor(Math.random() * colors.length)];
        particles.push({ x, y, ox: x, oy: y, vx, vy, size, delay, color: (col < 6 || row < 3) ? "#1a2f8a" : color, alpha: 1, rotation: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.3 });
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
        if (t <= 0) { anyAlive = true; ctx.globalAlpha = 1; ctx.fillStyle = p.color; ctx.fillRect(p.ox - p.size / 2, p.oy - p.size / 2, p.size, p.size); return; }
        const progress = Math.min(1, t / (1 - Math.min(p.delay, 0.7)));
        p.alpha = Math.max(0, 1 - Math.pow(progress, 1.8));
        if (p.alpha <= 0) return;
        anyAlive = true;
        const px = p.ox + p.vx * progress * W * 0.5, py = p.oy + p.vy * progress * H * 0.5 + progress * progress * H * 0.12;
        const s = p.size * (1 - progress * 0.4);
        p.rotation += p.rotSpeed;
        ctx.save(); ctx.globalAlpha = p.alpha; ctx.translate(px, py); ctx.rotate(p.rotation);
        ctx.fillStyle = p.color; ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
      });
      ctx.globalAlpha = 1;
      if (anyAlive && elapsed < 2.5) requestAnimationFrame(animate);
      else ctx.clearRect(0, 0, W, H);
    };
    requestAnimationFrame(animate);
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 rounded-xl pointer-events-none" style={{ zIndex: 10, width: "100%", height: "100%", animation: "disintCanvasFade 1.6s ease-out forwards" }} />;
}

function TagInput({ tag, setTag, allLocalKpis }) {
  const existingTags = [...new Set(allLocalKpis.map(k => k.tag).filter(t => t && t !== "__library__" && !t.startsWith("__")))].sort();
  const [tagOpen, setTagOpen] = useState(false);
  const tagRef = useRef(null);
  useEffect(() => { const h = e => { if (tagRef.current && !tagRef.current.contains(e.target)) setTagOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return (
    <div ref={tagRef} className="relative">
      <div className="flex rounded-xl overflow-hidden" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="e.g. Core, Deuda…"
          className="flex-1 px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none bg-transparent"
          onFocus={e => e.currentTarget.parentElement.style.borderColor = "#1a2f8a40"}
          onBlur={e => e.currentTarget.parentElement.style.borderColor = "#e8eaf0"} />
        {existingTags.length > 0 && (
          <button type="button" onClick={() => setTagOpen(o => !o)} className="px-2 flex items-center justify-center border-l border-gray-200 hover:bg-gray-100 transition-colors flex-shrink-0">
            <ChevronDown size={11} className={`text-gray-400 transition-transform ${tagOpen ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {tagOpen && existingTags.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)" }}>
          <div className="p-1.5 max-h-48 overflow-y-auto">
            {existingTags.map(t => (
              <button key={t} type="button" onClick={() => { setTag(t); setTagOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 transition-all"
                style={{ background: tag === t ? "#1a2f8a" : "transparent", color: tag === t ? "#fff" : "#475569" }}
                onMouseEnter={e => { if (tag !== t) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                onMouseLeave={e => { if (tag !== t) e.currentTarget.style.background = "transparent"; }}>
                {t}{tag === t && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
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
    if (kpi.formula.type === "text") return kpi.formula;
    const astToText = (node) => {
      if (!node) return { expr: "0", vars: {} };
      if (node.type === "cc") return { expr: "A", vars: { A: { type: "cc", tag: node.tag } } };
      if (node.type === "ref") return { expr: "A", vars: { A: { type: "ref", kpiId: node.kpiId } } };
      if (node.type === "manual") return { expr: String(node.value ?? 0), vars: {} };
      if (node.type === "account") return { expr: "A", vars: { A: { type: "account", accountCode: node.accountCode } } };
      if (node.type === "accountGroup") return { expr: "A", vars: { A: { type: "accountGroup", prefix: node.prefix } } };
      if (node.type === "op") {
        const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        const l = astToText(node.left), r = astToText(node.right);
        const sym = { "+": "+", "-": "-", "*": "*", "/": "/" }[node.op] ?? node.op;
        const usedLetters = new Set(Object.keys(l.vars));
        const rVarMap = {}, remapR = {};
        Object.entries(r.vars).forEach(([letter, val]) => {
          let newLetter = letter;
          if (usedLetters.has(letter)) newLetter = allLetters.find(ll => !usedLetters.has(ll) && !Object.values(rVarMap).includes(ll)) ?? letter;
          usedLetters.add(newLetter); rVarMap[letter] = newLetter; remapR[newLetter] = val;
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
    const seen = new Set(); const result = [];
    [...(systemKpis ?? []), ...(allLocalKpis ?? [])].forEach(k => { if (k.id !== kpi?.id && !seen.has(k.id)) { seen.add(k.id); result.push(k); } });
    return result;
  }, [systemKpis, allLocalKpis, kpi?.id]);
  const validateFormula = (f) => {
    if (!f) return "No hay fórmula definida.";
    if (f.type === "text") {
      const unassigned = Object.entries(f.variables ?? {}).filter(([, v]) => !v).map(([k]) => k);
      if (unassigned.length > 0) return `Variables sin asignar: ${unassigned.join(", ")}`;
      if (!f.expression?.trim()) return "La expresión está vacía.";
      try { let expr = f.expression; Object.keys(f.variables ?? {}).forEach(letter => { expr = expr.replaceAll(letter, "(1)"); }); Function(`"use strict"; return (${expr})`)(); } catch (e) { return `Expresión inválida: ${e.message}`; }
      const usedLetters = [...(f.expression ?? "").matchAll(/[A-Z]/g)].map(m => m[0]);
      const undefinedLetters = [...new Set(usedLetters)].filter(l => !new Set(Object.keys(f.variables ?? {})).has(l));
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
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
            <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6" style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "#fef3c7" }}><AlertTriangle size={22} style={{ color: "#d97706" }} /></div>
              <div className="text-center"><p className="text-sm font-black text-gray-900 mb-1">Nombre duplicado</p><p className="text-xs text-gray-400 leading-relaxed">Ya existe un KPI llamado <span className="font-black text-gray-700">"{label.trim()}"</span>.<br />Por favor elige un nombre único.</p></div>
              <button onClick={() => setDupeLabelWarning(false)} className="w-full py-2.5 rounded-xl text-xs font-black text-white transition-all" style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)" }}>Entendido</button>
            </div>
          </div>
        )}
        {formulaWarning && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
            <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6" style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "#fee2e2" }}><AlertTriangle size={22} style={{ color: "#dc2626" }} /></div>
              <div className="text-center"><p className="text-sm font-black text-gray-900 mb-1">Fórmula inválida</p><p className="text-xs text-gray-400 leading-relaxed">{formulaWarning}</p></div>
              <div className="flex gap-2 w-full">
                <button onClick={() => setFormulaWarning(null)} className="flex-1 py-2.5 rounded-xl text-xs font-black transition-all" style={{ background: "#f3f4f6", color: "#6b7280" }}>Corregir</button>
                <button onClick={() => { setFormulaWarning(null); onSave({ label: label.trim(), description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula }); }} className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all" style={{ background: "#dc2626" }}>Guardar igual</button>
              </div>
            </div>
          </div>
        )}
        <div className="px-6 pt-6 pb-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 relative" style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "0 6px 16px -4px rgba(26,47,138,0.5)" }}>
              <Sigma size={16} className="text-white" />
              {kpi?._isOverridden && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-violet-500 border-2 border-white" />}
            </div>
            <div>
              <p className="font-black text-[15px] text-gray-900 leading-tight">{kpi ? kpi.label : mode === "library" ? "KPI Selector" : "New KPI"}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] mt-0.5" style={{ color: kpi ? (builtInIds.has(kpi.id) ? "#6d28d9" : "#16a34a") : "#9ca3af" }}>
                {kpi ? (builtInIds.has(kpi.id) ? "⚙ System KPI" : "✦ Custom KPI") : "Library or custom formula"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110" style={{ background: "#f3f4f6", color: "#6b7280" }}><X size={13} /></button>
        </div>
        <div className="h-px mx-6 mb-1" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />
        {mode === "library" && (
          <LibraryPicker onSave={(data) => { if (data === "__custom__") setMode("customList"); else onSave(data); }} onDuplicate={onDuplicate} />
        )}
        {mode === "customList" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="px-5 pb-3 flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 flex-1 rounded-xl px-3 py-2" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
                <Search size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />
                <input type="text" value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search KPIs…" className="flex-1 text-xs font-semibold text-gray-700 outline-none bg-transparent" />
                {libSearch && <button onClick={() => setLibSearch("")}><X size={10} style={{ color: "#9ca3af" }} /></button>}
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
                    <div className="w-12 h-12 rounded-2xl bg-[#eef1fb] flex items-center justify-center mb-3"><Sigma size={20} className="text-[#1a2f8a]/40" /></div>
                    <p className="text-xs font-black text-gray-400">No custom KPIs yet</p>
                    <p className="text-[10px] text-gray-300 mt-1">Create your first below</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mb-4 pt-2">
                    {filtered.map(k => (
                      <div key={k.id} onClick={() => (confirmDeleteId === k.id || disintegratingId === k.id) ? null : onSave(k)}
                        className={`relative flex flex-col rounded-xl border transition-all group overflow-hidden ${disintegratingId === k.id ? "border-gray-100 cursor-default p-4" : confirmDeleteId === k.id ? "border-red-200 bg-red-50 cursor-pointer p-4" : "border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb]/50 p-4 cursor-pointer"}`}
                        style={{ pointerEvents: disintegratingId === k.id ? "none" : "auto", opacity: disintegratingId === k.id ? 0 : 1, transition: disintegratingId === k.id ? "opacity 0.4s ease-in 0.2s" : "none" }}>
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
                        <div className="flex items-center justify-end gap-1.5 mt-auto pt-2 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={(e) => { e.stopPropagation(); onDuplicate?.({ ...k, label: k.label + " 2" }); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0" style={{ background: "#f3f4f6", color: "#6b7280" }} title="Duplicate">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onEditLibraryKpi?.(k); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0" style={{ background: "#eef1fb", color: "#1a2f8a" }}><Edit3 size={10} /></button>
                          {confirmDeleteId !== k.id && (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(k.id); }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0" style={{ background: "#fee2e2", color: "#dc2626" }}><Trash2 size={10} /></button>
                          )}
                        </div>
                        {disintegratingId === k.id && (<><div className="absolute inset-0 rounded-xl z-[9]" style={{ animation: "disintFade 1.4s ease-in forwards" }} /><DisintegrationOverlay /><style>{`@keyframes disintFade { 0% { background: transparent; } 100% { background: rgba(255,255,255,1); } }`}</style></>)}
                        {confirmDeleteId === k.id && (
                          <div className="absolute inset-0 rounded-xl flex flex-col items-center justify-center gap-3 p-4" style={{ background: "rgba(254,242,242,0.97)", backdropFilter: "blur(4px)" }} onClick={e => e.stopPropagation()}>
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center"><Trash2 size={16} className="text-red-500" /></div>
                            <div className="text-center"><p className="text-sm font-black text-red-700">¿Eliminar KPI?</p><p className="text-[10px] text-red-400 mt-0.5 leading-snug">"{k.label}" será eliminado permanentemente</p></div>
                            <div className="flex gap-2 w-full">
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="flex-1 py-2 rounded-xl text-xs font-black transition-all hover:scale-105" style={{ background: "#f3f4f6", color: "#6b7280" }}>Cancelar</button>
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); setDisintegratingId(k.id); setTimeout(() => { setRemovedIds(prev => new Set([...prev, k.id])); onDeleteLibraryKpi?.(k.id); setDisintegratingId(null); }, 1600); }}
                                className="flex-1 py-2 rounded-xl text-xs font-black text-white transition-all hover:scale-105" style={{ background: "#dc2626", boxShadow: "0 4px 12px -2px rgba(220,38,38,0.4)" }}>Eliminar</button>
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
              <button onClick={() => setMode("custom")} className="w-full py-2.5 rounded-xl bg-[#1a2f8a] text-white text-xs font-black hover:bg-[#1a2f8a]/90 transition-all flex items-center justify-center gap-2">
                <Plus size={12} /> Crear nuevo KPI personalizado
              </button>
            </div>
          </div>
        )}
        {mode === "custom" && (
          <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Label *</label>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. EBITDA Margin"
                  className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
                  style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}
                  onFocus={e => e.target.style.borderColor = "#1a2f8a40"} onBlur={e => e.target.style.borderColor = "#e8eaf0"} />
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Category</label>
                {(() => {
                  const existingCategories = [...new Set(allLocalKpis.map(k => k.category).filter(c => c && c !== "__custom__"))].sort();
                  const dynamicOptions = [
                    { value: "Liquidez", label: "Liquidez" }, { value: "Solvencia", label: "Solvencia" },
                    { value: "Rentabilidad", label: "Rentabilidad" }, { value: "Eficiencia", label: "Eficiencia" },
                    { value: "Mercado", label: "Mercado" },
                    ...existingCategories.filter(c => !["Liquidez","Solvencia","Rentabilidad","Eficiencia","Mercado"].includes(c)).map(c => ({ value: c, label: c })),
                    { value: "__custom__", label: "Custom…" },
                  ];
                  return <CategoryPill value={category} onChange={v => { setCategory(v); if (v !== "__custom__") setCustomCategoryLabel(""); }} options={dynamicOptions} />;
                })()}
                {category === "__custom__" && (
                  <input value={customCategoryLabel} onChange={e => setCustomCategoryLabel(e.target.value)} placeholder="Category name"
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
                  onFocus={e => e.target.style.borderColor = "#1a2f8a40"} onBlur={e => e.target.style.borderColor = "#e8eaf0"} />
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Tag</label>
                <TagInput tag={tag} setTag={setTag} allLocalKpis={allLocalKpis} />
              </div>
            </div>
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
                  <TextFormulaBuilder formula={formula?.type === "text" ? formula : null} onChange={setFormula} kpiList={otherKpis} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} />
                </div>
              )}
            </div>
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
                      <input value={benchmark[key].min} onChange={e => setBenchmark(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value } }))} placeholder="—"
                        className="w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all" style={{ background: "rgba(0,0,0,0.04)", color: "#1f2937" }}
                        onFocus={e => { e.target.style.background = "#fff"; e.target.style.boxShadow = `0 0 0 2px ${accent}30`; }}
                        onBlur={e => { e.target.style.background = "rgba(0,0,0,0.04)"; e.target.style.boxShadow = "none"; }} />
                      <span className="text-[9px] font-black text-gray-300 flex-shrink-0">MAX</span>
                      <input value={benchmark[key].max} onChange={e => setBenchmark(prev => ({ ...prev, [key]: { ...prev[key], max: e.target.value } }))} placeholder="—"
                        className="w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all" style={{ background: "rgba(0,0,0,0.04)", color: "#1f2937" }}
                        onFocus={e => { e.target.style.background = "#fff"; e.target.style.boxShadow = `0 0 0 2px ${accent}30`; }}
                        onBlur={e => { e.target.style.background = "rgba(0,0,0,0.04)"; e.target.style.boxShadow = "none"; }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {mode === "custom" && (
          <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex flex-col gap-2" style={{ background: "rgba(248,249,255,0.8)" }}>
            <button onClick={() => {
              const allLabels = new Set([...(allLocalKpis ?? []).map(k => k.label), ...(systemKpis ?? []).map(k => k.label)]);
              if (kpi) allLabels.delete(kpi.label);
              const finalLabel = label.trim();
              if ([...allLabels].some(l => l.toLowerCase() === finalLabel.toLowerCase())) { setDupeLabelWarning(true); return; }
              const formulaErr = validateFormula(formula);
              if (formulaErr) { setFormulaWarning(formulaErr); return; }
              onSave({ label: finalLabel, description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula });
            }} disabled={!label}
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

function ConsolidatedGraphSection({
  sectionId, token, source, structure, topParent,
  sourceOpts, structureOpts, holdingOptions,
  kpiList, allKpis, ccTagToCodes, sectionCodes,
  defaultKpiIds, onStateChange, colors,
  compareModeOuter,
}) {
  const anchorY = parseInt(new Date().getFullYear());
  const anchorM = new Date().getMonth() + 1;
  let startY = anchorY, startM = anchorM - 11;
  while (startM < 1) { startM += 12; startY -= 1; }

  const [secTopParent, setSecTopParent] = useState(topParent || "");
  const [secStartYear, setSecStartYear] = useState(String(startY));
  const [secStartMonth, setSecStartMonth] = useState(String(startM));
  const [secEndYear, setSecEndYear] = useState(String(anchorY));
  const [secEndMonth, setSecEndMonth] = useState(String(anchorM));
  const [secSource, setSecSource] = useState(source);
  const [secStructure, setSecStructure] = useState(structure);
  const [secMode, setSecMode] = useState("monthly");
  const [secKpiIds, setSecKpiIds] = useState(defaultKpiIds || []);
  const [kpiPickerOpen, setKpiPickerOpen] = useState(false);
  const [kpiPickerRect, setKpiPickerRect] = useState(null);
  const kpiPickerRef = useRef(null);
  const [kpiSearch, setKpiSearch] = useState("");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
const [tableOpen, setTableOpen] = useState(false);
  const chartContainerRef = useRef(null);
const [cmpBars, setCmpBars] = useState([
    { id: "B", topParent: topParent || "", source: source, structure: structure, startYear: String(startY), startMonth: String(startM), endYear: String(anchorY), endMonth: String(anchorM) },
    { id: "C", topParent: topParent || "", source: source, structure: structure, startYear: String(startY), startMonth: String(startM), endYear: String(anchorY), endMonth: String(anchorM) },
  ]);
  const [cmpChartData, setCmpChartData] = useState({});
  const updateCmpBar = (id, patch) => setCmpBars(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeCmpBar = (id) => setCmpBars(prev => prev.filter(b => b.id !== id));
  const compareMode = compareModeOuter;

  useEffect(() => {
    const h = e => { if (kpiPickerRef.current && !kpiPickerRef.current.contains(e.target)) setKpiPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const periods = useMemo(() => {
    const sY = parseInt(secStartYear), sM = parseInt(secStartMonth);
    const eY = parseInt(secEndYear), eM = parseInt(secEndMonth);
    if (!sY || !sM || !eY || !eM) return [];
    const list = [];
    let pY = sY, pM = sM - 1;
    if (pM < 1) { pM = 12; pY -= 1; }
    list.push({ y: pY, m: pM, isPrior: true });
    let y = sY, m = sM;
    while (y < eY || (y === eY && m <= eM)) {
      list.push({ y, m, isPrior: false });
      m++; if (m > 12) { m = 1; y++; }
      if (list.length > 120) break;
    }
    return list;
  }, [secStartYear, secStartMonth, secEndYear, secEndMonth]);

  const fetchChartData = useCallback(async () => {
    if (!token || !secSource || !secStructure || !secTopParent || periods.length < 2) { setChartData([]); return; }
    setLoading(true);
    try {
      const results = await Promise.all(periods.map(async ({ y, m, isPrior }) => {
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and GroupShortName eq '${secTopParent}'`;
        const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
        });
        if (!res.ok) return { y, m, isPrior, pivot: new Map() };
        const json = await res.json();
        const rows = (json.value ?? []).filter(r =>
          (r.CompanyRole ?? r.companyRole ?? "") === "Group" &&
          !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim()
        );
        const p = new Map();
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          if (!ac) return;
          const acType = r.AccountType ?? r.accountType ?? "";
          if (acType && acType !== "P/L") return;
          const amt = parseAmt(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD ?? 0);
          p.set(ac, (p.get(ac) ?? 0) + amt);
        });
        return { y, m, isPrior, pivot: p };
      }));

      const series = [];
      for (let i = 1; i < results.length; i++) {
        const curr = results[i];
        if (curr.isPrior) continue;
        let pivotForKpi;
        if (secMode === "ytd") {
          pivotForKpi = curr.pivot;
        } else {
          const prev = results[i - 1];
          const mp = new Map();
          const allCodes = new Set([...curr.pivot.keys(), ...prev.pivot.keys()]);
          allCodes.forEach(ac => {
            mp.set(ac, (curr.pivot.get(ac) ?? 0) - (curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0)));
          });
          pivotForKpi = mp;
        }
        const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, allKpis);
        const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
        const row = { period: label };
        secKpiIds.forEach(kid => { const v = kpis.get(kid); row[kid] = (v === null || isNaN(v)) ? null : v; });
        series.push(row);
      }
      setChartData(series);
    } catch (e) { console.error("Graph fetch error:", e); }
    finally { setLoading(false); }
  }, [token, secSource, secStructure, secTopParent, periods, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, secMode]);

useEffect(() => { fetchChartData(); }, [fetchChartData]);

  useEffect(() => {
    if (!compareMode || !token) { setCmpChartData({}); return; }
    cmpBars.forEach(bar => {
      const barTop = bar.topParent || secTopParent;
      if (!bar.source || !bar.structure || !barTop) return;
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
        m++; if (m > 12) { m = 1; y++; }
        if (list.length > 120) break;
      }
      (async () => {
        try {
          const results = await Promise.all(list.map(async ({ y, m, isPrior }) => {
            const filter = `Year eq ${y} and Month eq ${m} and Source eq '${bar.source}' and GroupStructure eq '${bar.structure}' and GroupShortName eq '${barTop}'`;
            const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
            });
            if (!res.ok) return { y, m, isPrior, pivot: new Map() };
            const json = await res.json();
            const rows = (json.value ?? []).filter(r =>
              (r.CompanyRole ?? r.companyRole ?? "") === "Group" &&
              !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim()
            );
            const p = new Map();
            rows.forEach(r => {
              const ac = r.AccountCode ?? r.accountCode ?? "";
              if (!ac) return;
              const acType = r.AccountType ?? r.accountType ?? "";
              if (acType && acType !== "P/L") return;
              const amt = parseAmt(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD ?? 0);
              p.set(ac, (p.get(ac) ?? 0) + amt);
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
            secKpiIds.forEach(kid => { const v = kpis.get(kid); row[kid] = (v === null || isNaN(v)) ? null : v; });
            series.push(row);
          }
          setCmpChartData(prev => ({ ...prev, [bar.id]: series }));
        } catch (e) { console.error("Cmp graph fetch error:", e); }
      })();
    });
  }, [compareMode, cmpBars, token, secTopParent, secMode, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes]);

  useEffect(() => {
    if (onStateChange) onStateChange(sectionId, { sectionId, company: secTopParent, startY: secStartYear, startM: secStartMonth, endY: secEndYear, endM: secEndMonth, source: secSource, structure: secStructure, mode: secMode, kpiIds: secKpiIds, chartData, chartContainerRef });
  }, [sectionId, secTopParent, secStartYear, secStartMonth, secEndYear, secEndMonth, secSource, secStructure, secMode, secKpiIds, chartData, onStateChange]);

  const COLORS = [colors?.primary, colors?.secondary, colors?.tertiary, "#ef4444", "#8b5cf6", "#ec4899"];
  const toggleKpi = id => setSecKpiIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Filter card */}
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
{holdingOptions.length > 0 && (
            <HeaderFilterPill label="Perspective" value={secTopParent} onChange={setSecTopParent}
              options={holdingOptions} />
          )}
          <HeaderFilterPill label="Start M" value={secStartMonth} onChange={setSecStartMonth}
            options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
          <HeaderFilterPill label="Start Y" value={secStartYear} onChange={setSecStartYear}
            options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
          <HeaderFilterPill label="End M" value={secEndMonth} onChange={setSecEndMonth}
            options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
          <HeaderFilterPill label="End Y" value={secEndYear} onChange={setSecEndYear}
            options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
          {sourceOpts.length > 0 && (
            <HeaderFilterPill label="Source" value={secSource} onChange={setSecSource}
              options={sourceOpts} />
          )}
          {structureOpts.length > 0 && (
            <HeaderFilterPill label="Structure" value={secStructure} onChange={setSecStructure}
              options={structureOpts} />
          )}
          <div ref={kpiPickerRef} className="relative flex-shrink-0">
            <button onClick={() => {
              const rect = kpiPickerRef.current?.getBoundingClientRect();
              setKpiPickerRect(rect ?? null);
              setKpiPickerOpen(o => !o);
            }}
              className="flex items-center gap-2 rounded-xl select-none px-3 py-2"
              style={{ background: kpiPickerOpen ? `${colors?.primary}10` : "transparent", transition: "background 200ms" }}>
              <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.55 }}>KPIs</span>
              <span className="text-xs font-bold" style={{ color: colors?.primary }}>{secKpiIds.length}</span>
              <ChevronDown size={11} style={{ color: colors?.primary, opacity: 0.4, transform: kpiPickerOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
            </button>
            {kpiPickerOpen && (
              <div className="fixed z-[9999] rounded-2xl overflow-hidden flex flex-col"
                style={{
                  top: kpiPickerRect ? kpiPickerRect.bottom + 8 : 0,
                  left: kpiPickerRect ? kpiPickerRect.left : 0,
                  width: 260, maxHeight: 340,
                  background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)",
                  border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)"
                }}>
                <div className="px-3 pt-3 pb-2 flex-shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
                    <input autoFocus value={kpiSearch} onChange={e => setKpiSearch(e.target.value)}
                      placeholder="Search KPIs…"
                      className="flex-1 text-xs font-semibold text-gray-700 outline-none bg-transparent" />
                    {kpiSearch && <button onClick={() => setKpiSearch("")}><X size={10} style={{ color: "#9ca3af" }} /></button>}
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-1.5 pb-1.5" style={{ scrollbarWidth: "none" }}>
                  {kpiList.filter(k => !kpiSearch.trim() || k.label.toLowerCase().includes(kpiSearch.toLowerCase())).map(k => (
                    <button key={k.id} onClick={() => toggleKpi(k.id)}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                      style={{ background: secKpiIds.includes(k.id) ? "#eef1fb" : "transparent", color: secKpiIds.includes(k.id) ? "#1a2f8a" : "#475569" }}
                      onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f8f9ff"; }}
                      onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                      <span className="truncate">{k.label}</span>
                      {secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0" style={{ color: colors?.primary }} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
{/* Compare toggle */}
          {compareMode && (() => {
            const CMP_COLORS = ["#CF305D", "#f59e0b"];
            const allIds = ["B", "C"];
            const missingIds = allIds.filter(id => !cmpBars.some(b => b.id === id));
            return missingIds.length > 0 ? (
              <div className="flex items-center gap-1 ml-1">
                {missingIds.map(id => {
                  const color = CMP_COLORS[allIds.indexOf(id)];
                  return (
                    <button key={id} onClick={() => setCmpBars(prev => [...prev, { id, topParent: secTopParent, source: secSource, structure: secStructure, startYear: secStartYear, startMonth: secStartMonth, endYear: secEndYear, endMonth: secEndMonth }])}
                      className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] transition-all hover:scale-105 flex-shrink-0"
                      style={{ background: `${color}12`, color, border: `1px solid ${color}30` }}>
                      + {id}
                    </button>
                  );
                })}
              </div>
            ) : null;
          })()}
          {loading && <Loader2 size={12} className="animate-spin ml-2" style={{ color: colors?.primary }} />}
        </div>

        {/* Compare bars */}
        {compareMode && cmpBars.map((bar, bi) => {
          const CMP_COLORS = ["#CF305D", "#f59e0b"];
          const cmpColor = CMP_COLORS[bi % CMP_COLORS.length];
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
              {holdingOptions.length > 0 && <HeaderFilterPill label="Perspective" value={bar.topParent} onChange={v => updateCmpBar(bar.id, { topParent: v })} options={holdingOptions} />}
              <HeaderFilterPill label="Start M" value={bar.startMonth} onChange={v => updateCmpBar(bar.id, { startMonth: v })} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
              <HeaderFilterPill label="Start Y" value={bar.startYear} onChange={v => updateCmpBar(bar.id, { startYear: v })} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
              <HeaderFilterPill label="End M" value={bar.endMonth} onChange={v => updateCmpBar(bar.id, { endMonth: v })} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
              <HeaderFilterPill label="End Y" value={bar.endYear} onChange={v => updateCmpBar(bar.id, { endYear: v })} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
              {sourceOpts.length > 0 && <HeaderFilterPill label="Source" value={bar.source} onChange={v => updateCmpBar(bar.id, { source: v })} options={sourceOpts} />}
              {structureOpts.length > 0 && <HeaderFilterPill label="Structure" value={bar.structure} onChange={v => updateCmpBar(bar.id, { structure: v })} options={structureOpts} />}
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
        <div ref={chartContainerRef} className="relative flex-1 min-h-0">
          <div className="absolute inset-0 px-4 py-4">
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-xl p-0.5 shadow-sm"
              style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(26,47,138,0.08)", backdropFilter: "blur(8px)" }}>
              {["monthly", "ytd"].map(mode => (
                <button key={mode} onClick={() => setSecMode(mode)}
                  className="px-3 py-1 rounded-lg text-[10px] font-black transition-all"
                  style={{ background: secMode === mode ? colors?.primary : "transparent", color: secMode === mode ? "#fff" : colors?.primary }}>
                  {mode === "monthly" ? "Month" : "YTD"}
                </button>
              ))}
            </div>
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="relative" style={{ width: 80, height: 80 }}>
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="32" fill="none" stroke="#f3f4f6" strokeWidth="6" />
                    <circle cx="40" cy="40" r="32" fill="none"
                      stroke="url(#consGraphGrad2)" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 32}
                      strokeDashoffset={2 * Math.PI * 32 * 0.25}
                      style={{ transform: "rotate(-90deg)", transformOrigin: "40px 40px", animation: "graphSpin 1.1s linear infinite" }} />
                    <defs>
                      <linearGradient id="consGraphGrad2" x1="0" y1="0" x2="1" y2="1">
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
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={(() => {
              const allPeriods = [...new Set([
                ...chartData.map(d => d.period),
                ...cmpBars.flatMap(b => (cmpChartData[b.id] ?? []).map(d => d.period)),
              ])].sort();
              return allPeriods.map(period => {
                const main = chartData.find(d => d.period === period) ?? {};
                const row = { period };
                secKpiIds.forEach(kid => { row[`a__${kid}`] = main[kid] ?? null; });
                cmpBars.forEach(bar => {
                  const barRow = (cmpChartData[bar.id] ?? []).find(d => d.period === period) ?? {};
                  secKpiIds.forEach(kid => { row[`${bar.id}__${kid}`] = barRow[kid] ?? null; });
                });
                return row;
              });
            })()} margin={{ top: 8, right: 24, left: 8, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,47,138,0.06)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600 }} axisLine={false} tickLine={false}
                    tickFormatter={v => Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} width={56} />
<Tooltip
                    contentStyle={{ borderRadius: 16, border: "none", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.25)", padding: "12px 16px", fontSize: 12 }}
                    labelStyle={{ fontWeight: 800, color: "#1a2f8a", marginBottom: 6 }}
                    formatter={(value, name) => {
                      const [prefix, kid] = name.split("__");
                      const kpi = kpiList.find(k => k.id === kid);
                      return [fmtValue(value, kpi?.format), `${prefix.toUpperCase()} · ${kpi?.label ?? kid}`];
                    }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={value => {
                      const [prefix, kid] = value.split("__");
                      const kpi = kpiList.find(k => k.id === kid);
                      return `${prefix.toUpperCase()} · ${kpi?.label ?? kid}`;
                    }} />
{secKpiIds.map((kid, i) => {
                    const A_COLORS = [colors?.primary ?? "#1a2f8a", "#3b54b8", "#6b7fd4", "#9aa9e0", "#c3cdef"];
                    return (
                      <Line key={`a__${kid}`} type="monotone" dataKey={`a__${kid}`}
                        stroke={compareMode ? A_COLORS[i % A_COLORS.length] : COLORS[i % COLORS.length]}
                        strokeWidth={2.5} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls />
                    );
                  })}
                  {compareMode && cmpBars.flatMap(bar => {
                    const CMP_COLORS = { B: "#CF305D", C: "#f59e0b" };
                    return secKpiIds.map((kid, i) => (
                      <Line key={`${bar.id}__${kid}`} type="monotone" dataKey={`${bar.id}__${kid}`}
                        stroke={CMP_COLORS[bar.id] ?? "#CF305D"}
                        strokeWidth={2} strokeDasharray={bar.id === "B" ? "6 3" : "2 3"}
                        dot={false} activeDot={{ r: 5, strokeWidth: 0 }} connectNulls />
                    ));
                  })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Data table — separate card */}
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
        <div style={{ maxHeight: tableOpen ? "20vh" : "0px", overflowY: tableOpen ? "auto" : "hidden", scrollbarWidth: "none", transition: "max-height 350ms cubic-bezier(0.4,0,0.2,1)" }}>
          {chartData.length > 0 && secKpiIds.length > 0 && (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: colors?.primary }}>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap">Period</th>
                  {secKpiIds.map(kid => { const k = kpiList.find(k => k.id === kid); return <th key={kid} className="text-right px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap">{k?.label ?? kid}</th>; })}
                </tr>
              </thead>
              <tbody>
                {chartData.map((d, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                    <td className="px-4 py-2 font-bold whitespace-nowrap" style={{ color: colors?.primary }}>{d.period}</td>
                    {secKpiIds.map(kid => { const k = kpiList.find(k => k.id === kid); const v = d[kid]; return <td key={kid} className="px-4 py-2 text-right whitespace-nowrap" style={{ color: v === null ? "#d1d5db" : v < 0 ? "#ef4444" : "#111827" }}>{v === null ? "—" : fmtValue(v, k?.format)}</td>; })}
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
function useAnimatedNumberCons(target, duration = 800) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    const to = Number(target) || 0;
    if (from === to) return;
    startRef.current = null;
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return display;
}

function ConsolidatedKpiSpinner({ colors, metaReady, kpiResolverReady }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTick(1), 100);
    const t2 = setTimeout(() => setTick(2), 600);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, []);
  const target = tick === 0 ? 0 : tick === 1 ? 50 : 90;
  const progress = useAnimatedNumberCons(target);
  return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
      style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
        style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
        <div className="relative" style={{ width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
            <circle cx="70" cy="70" r="60" fill="none"
              stroke="url(#consKpiGrad)" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 60}
              strokeDashoffset={2 * Math.PI * 60 * (1 - progress / 100)}
              style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }} />
            <defs>
              <linearGradient id="consKpiGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={colors?.primary ?? "#1a2f8a"} />
                <stop offset="100%" stopColor="#CF305D" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black tabular-nums" style={{ color: colors?.primary }}>
              {Math.round(progress)}<span className="text-base text-gray-300">%</span>
            </span>
          </div>
        </div>
        <p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
          {!metaReady ? "Loading metadata…" : !kpiResolverReady ? "Loading KPI definitions…" : "Building consolidated KPIs…"}
        </p>
        <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
          Consolidated · KPIs
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//   MAIN — ConsolidatedKpiPage
// ═══════════════════════════════════════════════════════════════════
export default function ConsolidatedKpiPage({ token, groupAccounts: groupAccountsProp = [] }) {
  const header2Style = useTypo("header2");
  const body1Style   = useTypo("body1");
  const body2Style   = useTypo("body2");
  const underscore2Style = useTypo("underscore2");
  const underscore3Style = useTypo("underscore3");
  const filterStyle  = useTypo("filter");
  const { colors }   = useSettings();

  // ── Metadata ──────────────────────────────────────────────────────
  const [consolidations, setConsolidations] = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);
  const [companiesAll,   setCompaniesAll]   = useState([]);
  const [sources,        setSources]        = useState([]);
const [structures,     setStructures]     = useState([]);
  const [dimensionsAll,  setDimensionsAll]  = useState([]);
  const [metaReady,      setMetaReady]      = useState(false);

  // ── Filters ────────────────────────────────────────────────────────
  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [source,    setSource]    = useState("Actual");
  const [structure, setStructure] = useState("DefaultStructure");
  const [topParent, setTopParent] = useState("");

  // ── Data ───────────────────────────────────────────────────────────
  const [rawData,      setRawData]      = useState([]);
  const [rawDataPrev,  setRawDataPrev]  = useState([]);
  const [rawDataCmp,   setRawDataCmp]   = useState([]);
  const [rawDataCmpPrev, setRawDataCmpPrev] = useState([]);
const [loading,      setLoading]      = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // ── Compare ────────────────────────────────────────────────────────
  const [compareMode,  setCompareMode]  = useState(false);
  const [cmpSource,    setCmpSource]    = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
  const [cmpYear,      setCmpYear]      = useState("");
  const [cmpMonth,     setCmpMonth]     = useState("");

  // ── UI ─────────────────────────────────────────────────────────────
  const [viewMode,     setViewMode]     = useState("subsidiaries");
  const [viewPeriod,   setViewPeriod]   = useState("ytd");
  const [viewsModalOpen, setViewsModalOpen] = useState(false);
  const [activeMapping,  setActiveMapping]  = useState(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [dragIdx,    setDragIdx]    = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [colDragIdx,  setColDragIdx]  = useState(null);
  const [colDragOverIdx, setColDragOverIdx] = useState(null);
const [colOrder,   setColOrder]   = useState(null);
  const [selGroup,   setSelGroup]   = useState("");
  const [selDim,     setSelDim]     = useState("");
 const [exporting,  setExporting]  = useState(false);
  const [cmpVisible, setCmpVisible] = useState(false);
  const [cmpExiting, setCmpExiting] = useState(false);
  const graphSectionsRef = useRef({});
  const handleGraphSectionState = useCallback((sid, state) => { graphSectionsRef.current[sid] = state; }, []);

  // ── Group accounts ─────────────────────────────────────────────────
  const [groupAccountsLocal, setGroupAccountsLocal] = useState([]);
  useEffect(() => {
    if (groupAccountsProp.length > 0 || !token) return;
    fetch(`${BASE_URL}/v2/group-accounts`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setGroupAccountsLocal(d.value ?? (Array.isArray(d) ? d : [])); })
      .catch(() => {});
  }, [token, groupAccountsProp.length]);
  const groupAccounts = groupAccountsProp.length > 0 ? groupAccountsProp : groupAccountsLocal;

  // ── KPI Resolver ───────────────────────────────────────────────────
  const { kpiList: resolvedKpiList, allKpis: resolvedAllKpis, ccTagToCodes: defaultCcTagToCodes, sectionCodes, ready: kpiResolverReady } = useResolvedKpiList(groupAccounts);

  const { ccTagToCodes, mappingMatched, mappingUnmatched } = useMemo(() => {
    if (!activeMapping) return { ccTagToCodes: defaultCcTagToCodes, mappingMatched: [], mappingUnmatched: [] };
    const override = new Map(defaultCcTagToCodes);
    const matched = [], unmatched = [];
    const allSections = new Map([...(activeMapping.plSections || new Map()), ...(activeMapping.bsSections || new Map())]);
    allSections.forEach((codes, label) => {
      if (!codes?.length) return;
      const norm = normalizeLabel(label);
      let foundTag = null;
      for (const [ccTag, synonyms] of Object.entries(CC_TAG_SYNONYMS)) {
        if (synonyms.some(s => norm.includes(normalizeLabel(s)))) { foundTag = ccTag; break; }
      }
      if (foundTag) { override.set(foundTag, codes); matched.push({ ccTag: foundTag, label, codeCount: codes.length }); }
      else unmatched.push({ label, codeCount: codes.length });
    });
    return { ccTagToCodes: override, mappingMatched: matched, mappingUnmatched: unmatched };
  }, [activeMapping, defaultCcTagToCodes]);

  const handleApplyMapping = useCallback((m) => {
    setActiveMapping({ mapping_id: m.mapping_id, name: m.name, standard: m.standard, plSections: extractSectionsFromTree(m.pl_tree), bsSections: extractSectionsFromTree(m.bs_tree) });
    setWarningDismissed(false);
  }, []);

  // ── Auth + custom KPIs ─────────────────────────────────────────────
  const [authUserId, setAuthUserId] = useState(null);
  const [companyId, setCompanyId]   = useState(null);
  const [companyKpis, setCompanyKpis] = useState([]);
const [dashboardKpiIds, setDashboardKpiIds] = useState(null);
  const [dashboardKpiIdsDim, setDashboardKpiIdsDim] = useState(null);
 const [editingKpi,      setEditingKpi]      = useState(null);
  const [individualKpis,  setIndividualKpis]  = useState([]);
  const [showImportPanel, setShowImportPanel] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setAuthUserId(uid);
      if (uid) { const cid = await getActiveCompanyId(uid); setCompanyId(cid); }
    })();
  }, []);

  useEffect(() => {
    if (!companyId) return;
 listCompanyKpis({ companyId, contextMappingId: "*", scope: "individual" })
      .then(rows => setIndividualKpis(rows ?? [])).catch(() => {});
    listCompanyKpis({ companyId, contextMappingId: "*", scope: "consolidated" })
      .then(rows => setCompanyKpis(rows ?? [])).catch(() => {});  }, [companyId]);

useEffect(() => {
    if (!authUserId || !companyId) return;
    const defaults = ["revenue","gross_profit","net_result","net_margin"];

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
          } catch (e) { console.error(`[ConsolidatedKpiPage] failed to save defaults for ${scope}:`, e); }
        }
      } catch (e) {
        console.error(`[ConsolidatedKpiPage] getUserDashboard ${scope}:`, e);
        setter(defaults);
      }
    };
loadDash("consolidated_company", setDashboardKpiIds);
    loadDash("consolidated_dimension", setDashboardKpiIdsDim);
  }, [authUserId, companyId]);

const localKpis = useMemo(() => companyKpis
    .filter(k => k.kpi_type !== "system_override")
    .map(k => ({
      id:                 k.kpi_id,
      label:              k.label,
      description:        k.description ?? "",
      category:           k.category    ?? "",
      tag:                k.tag         ?? "",
      format:             k.format,
      formula:            k.formula,
      benchmark:          k.benchmark,
      _contextMappingId:  k.context_mapping_id ?? null,
      _createdBy:         k.created_by,
      _updatedBy:         k.updated_by,
      _updatedAt:         k.updated_at,
      _createdAt:         k.created_at,
      _kpiType:           k.kpi_type ?? "custom",
      _sourceSystemKpiId: k.source_system_kpi_id ?? null,
      _isOverridden:      false,
    })), [companyKpis]);



const persistDashboard = useCallback(async (ids, scope = "consolidated_company") => {
    if (!authUserId || !companyId) return;
    try { await saveUserDashboard({ userId: authUserId, companyId, kpiIds: ids, scope }); } catch {}
  }, [authUserId, companyId]);

const builtInKpiIds = useMemo(() => new Set(resolvedAllKpis.map(k => k.id)), [resolvedAllKpis]);

  const OVERRIDE_TAG_PREFIX = "__override__:";

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
    const overrideMap = viewMode === "dimensions" ? systemOverrides.dim : systemOverrides.comp;
    const existing = overrideMap.get(originalKpiId);
    try {
      if (existing) {
        const updated = await updateCompanyKpi({
          kpiId:             existing.kpi_id,
          userId:            authUserId,
          label:             overrideData.label,
          description:       overrideData.description ?? null,
          category:          overrideData.category ?? null,
          tag:               `${OVERRIDE_TAG_PREFIX}${originalKpiId}:${viewMode === "dimensions" ? "dim" : "comp"}`,
          format:            overrideData.format ?? "currency",
          formula:           overrideData.formula,
          benchmark:         overrideData.benchmark ?? null,
          kpiType:           'system_override',
          sourceSystemKpiId: originalKpiId,
        });
        setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
      } else {
        const created = await createCompanyKpi({
          companyId,
          userId:            authUserId,
          label:             overrideData.label,
          description:       overrideData.description ?? null,
          category:          overrideData.category ?? null,
          tag:               `${OVERRIDE_TAG_PREFIX}${originalKpiId}:${viewMode === "dimensions" ? "dim" : "comp"}`,
          format:            overrideData.format ?? "currency",
          formula:           overrideData.formula,
          benchmark:         overrideData.benchmark ?? null,
          contextMappingId:  null,
          scope:             "consolidated",
          kpiType:           'system_override',
          sourceSystemKpiId: originalKpiId,
        });
        setCompanyKpis(prev => [...prev, created]);
      }
    } catch (e) {
      alert(`Could not save override: ${e.message}`);
    }
 }, [companyId, authUserId, systemOverrides, viewMode]);

const resetSystemOverride = useCallback(async (originalKpiId) => {
    const overrideMap = viewMode === "dimensions" ? systemOverrides.dim : systemOverrides.comp;
    const existing = overrideMap.get(originalKpiId);
    if (!existing) return;
    try {
      await archiveCompanyKpi({ kpiId: existing.kpi_id, userId: authUserId });
      setCompanyKpis(prev => prev.filter(k => k.kpi_id !== existing.kpi_id));
    } catch (e) { alert(`Could not reset: ${e.message}`); }
  }, [systemOverrides, authUserId, viewMode]);

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
if (builtInKpiIds.has(id)) {
        const overrideMap = viewMode === "dimensions" ? systemOverrides.dim : systemOverrides.comp;
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
    viewMode === "dimensions" ? buildKpiList(dashboardKpiIdsDim) : buildKpiList(dashboardKpiIds),
    [viewMode, dashboardKpiIds, dashboardKpiIdsDim, buildKpiList]
  );

  const addToDashboard = useCallback((kpiId, scope = "consolidated_company") => {
    const setter = scope === "consolidated_dimension" ? setDashboardKpiIdsDim : setDashboardKpiIds;
    setter(prev => {
      if (!prev || prev.includes(kpiId)) return prev;
      const next = [...prev, kpiId];
      persistDashboard(next, scope);
      return next;
    });
  }, [persistDashboard]);

  const removeFromDashboard = useCallback((kpiId, scope = "consolidated_company") => {
    const setter = scope === "consolidated_dimension" ? setDashboardKpiIdsDim : setDashboardKpiIds;
    setter(prev => {
      if (!prev) return prev;
      const next = prev.filter(id => id !== kpiId);
      persistDashboard(next, scope);
      return next;
    });
if (builtInKpiIds.has(kpiId)) {
      const overrideMap = scope === "consolidated_dimension" ? systemOverrides.dim : systemOverrides.comp;
      const override = overrideMap.get(kpiId);
      if (override) {
        archiveCompanyKpi({ kpiId: override.kpi_id, userId: authUserId }).catch(console.error);
        setCompanyKpis(prev => prev.filter(k => k.kpi_id !== override.kpi_id));
      }
    }
  }, [persistDashboard, builtInKpiIds, systemOverrides, authUserId]);

// ── Metadata fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
Promise.all([
      fetch(`${BASE_URL}/v2/sources`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/structures`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/companies`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/consolidations`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/group-structure`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/dimensions`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
    ]).then(([src, str, co, cons, gs, dims]) => {
      setSources(Array.isArray(src) ? src : []);
      setStructures(Array.isArray(str) ? str : []);
      setCompaniesAll(Array.isArray(co) ? co : []);
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      setDimensionsAll(Array.isArray(dims) ? dims : []);
      if (src.length > 0) setSource(src[0].Source ?? src[0].source ?? "Actual");
      if (str.length > 0) setStructure(str[0].GroupStructure ?? str[0].groupStructure ?? "DefaultStructure");
      setMetaReady(true);
    });
  }, [token]);

  // ── Holding options ────────────────────────────────────────────────
  const { holdingOptions, contributionCompanies } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:  g.companyShortName ?? g.CompanyShortName ?? "",
      parent:   g.parentShortName  ?? g.ParentShortName  ?? "",
      structure: g.groupStructure  ?? g.GroupStructure   ?? "",
      hasChild: g.hasChild ?? g.HasChild ?? false,
      detached: g.detached ?? g.Detached ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    const root = gsRows.find(g => !g.parent)?.company || "";
    const consolidatedGroups = new Set(consolidations.filter(c => String(c.Year ?? c.year) === year && String(c.Month ?? c.month) === month && (c.Source ?? c.source) === source && (c.GroupStructure ?? c.groupStructure) === structure).map(c => c.GroupShortName ?? c.groupShortName).filter(Boolean));
    const candidates = gsRows.filter(g => g.hasChild || g.company === root).map(g => g.company);
    const holdings = consolidatedGroups.size > 0 ? candidates.filter(c => consolidatedGroups.has(c)) : candidates;
    const opts = holdings.map(h => { const co = companiesAll.find(c => (c.CompanyShortName ?? c.companyShortName) === h); return { value: h, label: co?.CompanyLegalName ?? co?.companyLegalName ?? h }; }).sort((a, b) => a.label.localeCompare(b.label));
    const kids = gsRows.filter(g => g.parent === topParent).map(g => g.company).sort((a, b) => {
      const la = companiesAll.find(c => (c.CompanyShortName ?? c.companyShortName) === a)?.CompanyLegalName ?? a;
      const lb = companiesAll.find(c => (c.CompanyShortName ?? c.companyShortName) === b)?.CompanyLegalName ?? b;
      return la.localeCompare(lb);
    });
    return { holdingOptions: opts, contributionCompanies: topParent ? [topParent, ...kids] : [] };
  }, [groupStructure, structure, consolidations, year, month, source, companiesAll, topParent]);

  useEffect(() => {
    if (!holdingOptions.length) return;
    if (holdingOptions.some(h => h.value === topParent)) return;
    setTopParent(holdingOptions[0]?.value ?? "");
  }, [holdingOptions, topParent]);

useEffect(() => {
    if (compareMode) {
      setCmpVisible(true); setCmpExiting(false);
    } else if (cmpVisible) {
      setCmpExiting(true);
      const t = setTimeout(() => { setCmpVisible(false); setCmpExiting(false); }, 350);
      return () => clearTimeout(t);
    }
  }, [compareMode]);

  // Compare init
  const compareInitDone = useRef(false);
  useEffect(() => {
    if (!compareMode) { compareInitDone.current = false; return; }
    if (compareInitDone.current || !source || !structure || !year || !month) return;
    setCmpSource(source); setCmpStructure(structure); setCmpYear(String(parseInt(year) - 1)); setCmpMonth(month);
    compareInitDone.current = true;
  }, [compareMode, source, structure, year, month]);

  // Auto-find latest period
  const autoPeriodDone = useRef(false);
  useEffect(() => {
    if (autoPeriodDone.current || !metaReady || !source || !structure || !topParent) return;
    autoPeriodDone.current = true;
    (async () => {
      const now = new Date(); let y = now.getFullYear(), m = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
          const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) { const json = await res.json(); if ((json.value ?? []).length > 0) { setYear(String(y)); setMonth(String(m)); return; } }
        } catch { break; }
        m--; if (m < 1) { m = 12; y--; }
      }
    })();
  }, [metaReady, source, structure, topParent, token]);

  // ── Fetch consolidated data ────────────────────────────────────────
  const fetchConsolidated = useCallback(async (yr, mo, src, str, gp) => {
    if (!yr || !mo || !src || !str || !gp) return [];
    const filter = `Year eq ${yr} and Month eq ${mo} and Source eq '${src}' and GroupStructure eq '${str}' and GroupShortName eq '${gp}'`;
    try {
      const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!res.ok) return [];
      const json = await res.json();
      return json.value ?? (Array.isArray(json) ? json : []);
    } catch { return []; }
  }, [token]);

  const prevOf = (y, m) => { let pY = parseInt(y), pM = parseInt(m) - 1; if (pM < 1) { pM = 12; pY--; } return { y: pY, m: pM }; };

  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure || !topParent) return;
    setLoading(true);
    const p = prevOf(year, month);
    const fetches = [fetchConsolidated(year, month, source, structure, topParent), fetchConsolidated(p.y, p.m, source, structure, topParent)];
    if (compareMode && cmpYear && cmpMonth && cmpSource && cmpStructure) {
      const cp = prevOf(cmpYear, cmpMonth);
      fetches.push(fetchConsolidated(cmpYear, cmpMonth, cmpSource, cmpStructure, topParent));
      fetches.push(fetchConsolidated(cp.y, cp.m, cmpSource, cmpStructure, topParent));
    }
Promise.all(fetches).then(([curr, prev, cmp, cmpPrev]) => {
      setRawData(curr || []);
      setRawDataPrev(prev || []);
      setRawDataCmp(cmp || []);
      setRawDataCmpPrev(cmpPrev || []);
      setLoading(false);
      setTimeout(() => setInitialLoadDone(true), 1000);
    }).catch(() => { setLoading(false); setTimeout(() => setInitialLoadDone(true), 1000); });
  }, [metaReady, year, month, source, structure, topParent, compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, fetchConsolidated]);

  // ── Pivot building ─────────────────────────────────────────────────
  // "CONSOLIDATED" column = Group role rows (no origin/counterparty)
  // Per-subsidiary columns = Parent/Contribution rows for that company
  const sumAccountCodes = useMemo(() => {
    const sums = new Set();
    groupAccounts.forEach(g => { if (g.IsSumAccount === true || g.isSumAccount === true) sums.add(String(g.AccountCode ?? g.accountCode ?? "")); });
    return sums;
  }, [groupAccounts]);


  const buildPivots = useCallback((rows, prevRows, mo) => {
    const isJanuary = parseInt(mo) === 1;

    // Helper: build raw YTD pivot for a set of rows
    const buildRaw = (rs) => {
      const p = new Map();
      rs.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac || sumAccountCodes.has(ac)) return;
        if (acType && acType !== "P/L") return;
        const amt = parseAmt(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);
      });
      return p;
    };

    // Monthly = curr - prev
    const toMonthly = (curr, prev) => {
      const mp = new Map();
      const all = new Set([...curr.keys(), ...prev.keys()]);
      all.forEach(ac => { mp.set(ac, (curr.get(ac) ?? 0) - (isJanuary ? 0 : (prev.get(ac) ?? 0))); });
      return mp;
    };

    const result = new Map();

    // Consolidated column
    const consGroupRows = rows.filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim());
    const consGroupPrev = prevRows.filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim());
    const consYTD  = buildRaw(consGroupRows);
    const consPYTD = buildRaw(consGroupPrev);
    result.set("__consolidated__", viewPeriod === "ytd" ? consYTD : toMonthly(consYTD, consPYTD));

    // Per-subsidiary columns
    contributionCompanies.forEach(co => {
      const role = co === topParent ? "Parent" : "Contribution";
      const coRows = rows.filter(r => (r.CompanyShortName ?? r.companyShortName ?? "") === co && (r.CompanyRole ?? r.companyRole ?? "") === role);
      const coPrev = prevRows.filter(r => (r.CompanyShortName ?? r.companyShortName ?? "") === co && (r.CompanyRole ?? r.companyRole ?? "") === role);
      const coYTD  = buildRaw(coRows);
      const coPYTD = buildRaw(coPrev);
      result.set(co, viewPeriod === "ytd" ? coYTD : toMonthly(coYTD, coPYTD));
    });

    return result;
  }, [contributionCompanies, topParent, sumAccountCodes, viewPeriod]);

const pivots    = useMemo(() => buildPivots(rawData, rawDataPrev, month), [rawData, rawDataPrev, month, buildPivots]);
  const pivotsCmp = useMemo(() => buildPivots(rawDataCmp, rawDataCmpPrev, cmpMonth), [rawDataCmp, rawDataCmpPrev, cmpMonth, buildPivots]);



// Lookup of dimension full names by group, built from /v2/dimensions.
  // Falls back gracefully to the bare code if the endpoint returns nothing
  // or uses a field name we didn't anticipate.
  const dimNameLookup = useMemo(() => {
    const m = new Map();
    (dimensionsAll || []).forEach(d => {
      const grp  = d.DimensionGroup ?? d.dimensionGroup ?? d.Group ?? d.group ?? "";
      const code = String(d.DimensionCode ?? d.dimensionCode ?? d.Code ?? d.code ?? "");
      const name = d.DimensionName ?? d.dimensionName ?? d.Name ?? d.name ?? code;
      if (!grp || !code) return;
      if (!m.has(grp)) m.set(grp, new Map());
      m.get(grp).set(code, name);
    });
    return m;
  }, [dimensionsAll]);

  const dimensionPivotsCmp = useMemo(() => {
    const buildDimPivots = (rows) => {
      const pivots = new Map();
      rows
        .filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
        .forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac || sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;
          parseDimensions(r.Dimensions ?? "").forEach(([grp, code]) => {
            if (selGroup && grp !== selGroup) return;
            if (selDim && code !== selDim) return;
            const amt = parseAmt(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD ?? 0);
            if (!pivots.has(code)) pivots.set(code, { name: dimNameLookup.get(grp)?.get(code) ?? code, group: grp, pivot: new Map() });
            const entry = pivots.get(code);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
          });
        });
      return pivots;
    };
    const curr = buildDimPivots(rawDataCmp);
    if (viewPeriod === "ytd") return curr;
    const prev = buildDimPivots(rawDataCmpPrev);
    const isJanuary = parseInt(cmpMonth) === 1;
    const result = new Map();
    new Set([...curr.keys(), ...prev.keys()]).forEach(key => {
      const c = curr.get(key), p = prev.get(key);
      const meta = c ?? p;
      const mp = new Map();
      new Set([...(c?.pivot.keys() ?? []), ...(p?.pivot.keys() ?? [])]).forEach(ac => {
        mp.set(ac, (c?.pivot.get(ac) ?? 0) - (isJanuary ? 0 : (p?.pivot.get(ac) ?? 0)));
      });
      result.set(key, { name: meta.name, group: meta.group, pivot: mp });
    });
    return result;
  }, [rawDataCmp, rawDataCmpPrev, viewPeriod, cmpMonth, sumAccountCodes, selGroup, selDim, dimNameLookup]);

  // ── Dimension groups derived from consolidated Group-role rows ─────
  const { dimGroups, dimsByGroup } = useMemo(() => {
    const groupSet = new Set();
    const byGroup = new Map();
    rawData
      .filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .forEach(r => {
        parseDimensions(r.Dimensions ?? "").forEach(([grp, code]) => {
          if (!grp || !code) return;
          groupSet.add(grp);
          if (!byGroup.has(grp)) byGroup.set(grp, new Map());
          const fullName = dimNameLookup.get(grp)?.get(code) ?? code;
          byGroup.get(grp).set(code, fullName);
        });
      });
    return { dimGroups: [...groupSet].sort(), dimsByGroup: byGroup };
  }, [rawData, dimNameLookup]);

  const groupDimOptions = useMemo(() => {
    if (!selGroup) return [];
    const m = dimsByGroup.get(selGroup);
    return m ? [...m.entries()].map(([code, name]) => ({ code, name })) : [];
  }, [dimsByGroup, selGroup]);

  const dimensionPivots = useMemo(() => {
    const buildDimPivots = (rows) => {
      const pivots = new Map();
      rows
        .filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
        .forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac || sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;
          parseDimensions(r.Dimensions ?? "").forEach(([grp, code]) => {
            if (selGroup && grp !== selGroup) return;
            if (selDim && code !== selDim) return;
            const amt = parseAmt(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD ?? 0);
           if (!pivots.has(code)) pivots.set(code, { name: dimNameLookup.get(grp)?.get(code) ?? code, group: grp, pivot: new Map() });
            const entry = pivots.get(code);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
          });
        });
      return pivots;
    };

    const curr = buildDimPivots(rawData);
    if (viewPeriod === "ytd") return curr;

    const prev = buildDimPivots(rawDataPrev);
    const isJanuary = parseInt(month) === 1;
    const result = new Map();
    new Set([...curr.keys(), ...prev.keys()]).forEach(key => {
      const c = curr.get(key), p = prev.get(key);
      const meta = c ?? p;
      const mp = new Map();
      new Set([...(c?.pivot.keys() ?? []), ...(p?.pivot.keys() ?? [])]).forEach(ac => {
        mp.set(ac, (c?.pivot.get(ac) ?? 0) - (isJanuary ? 0 : (p?.pivot.get(ac) ?? 0)));
      });
      result.set(key, { name: meta.name, group: meta.group, pivot: mp });
    });
    return result;
 }, [rawData, rawDataPrev, viewPeriod, month, sumAccountCodes, selGroup, selDim, dimNameLookup]);

// ── Columns ────────────────────────────────────────────────────────
const activeCols = useMemo(() => {
    if (viewMode === "subsidiaries") return contributionCompanies;
    if (viewMode === "dimensions")   return [...dimensionPivots.keys()].sort();
    return [];
  }, [viewMode, dimensionPivots, contributionCompanies]);

const orderedCols = colOrder && colOrder.length === activeCols.length ? colOrder : activeCols;

  const kpiDashProgress = useMemo(() => {
    let pct = 0;
    if (year && month) pct += 15;
    if (sources.length > 0 && structures.length > 0 && companiesAll.length > 0) pct += 15;
    if (groupAccounts.length > 0) pct += 25;
    if (rawData.length > 0) pct += 25;
    if (metaReady && !loading) pct += 20;
    return Math.min(100, pct);
  }, [year, month, sources.length, structures.length, companiesAll.length, groupAccounts.length, rawData.length, metaReady, loading]);

  const animatedKpiDashProgress = useAnimatedNumber(kpiDashProgress, 700);
const kpiDashReady = kpiDashProgress >= 100;

const allAccountCodes = useMemo(() => {
    const codes = new Set();
    // First from groupAccounts
    groupAccounts.forEach(g => {
      const code = String(g.AccountCode ?? g.accountCode ?? "");
      if (code) codes.add(code);
    });
    // Also from rawData so dim-tagged codes are always present
    rawData.forEach(r => {
      const code = String(r.AccountCode ?? r.accountCode ?? "");
      if (code) codes.add(code);
    });
    return [...codes].sort();
  }, [groupAccounts, rawData]);
const accountCodeLabels = useMemo(() => {
    const map = new Map();
    groupAccounts.forEach(g => {
      const code = String(g.AccountCode ?? g.accountCode ?? "");
      const name = String(g.accountName ?? g.AccountName ?? g.name ?? "");
      if (code) map.set(code, name);
    });
    // Also add labels from rawData account descriptions
    rawData.forEach(r => {
      const code = String(r.AccountCode ?? r.accountCode ?? "");
      const name = String(r.AccountName ?? r.accountName ?? r.AccountDescription ?? r.accountDescription ?? "");
      if (code && !map.has(code)) map.set(code, name);
    });
    return map;
  }, [groupAccounts, rawData]);

const dimsByAccount = useMemo(() => {
    const nameLookup = new Map();
    (dimensionsAll || []).forEach(d => {
      const code = String(d.DimensionCode ?? d.dimensionCode ?? d.Code ?? d.code ?? "");
      const name = String(d.DimensionName ?? d.dimensionName ?? d.Name ?? d.name ?? "");
      if (code && name) nameLookup.set(code, name);
    });
    const map = new Map();
    rawData.forEach(r => {
      const ac = r.AccountCode ?? r.accountCode ?? "";
      const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
      if (!ac || !dimsRaw || dimsRaw === "—") return;
      const pairs = parseDimensions(dimsRaw);
      if (!pairs.length) return;
      if (!map.has(ac)) map.set(ac, new Map());
      pairs.forEach(([group, rawCode]) => {
        if (!group || !rawCode) return;
        const name = nameLookup.get(rawCode) ?? rawCode;
        const key = `${group}:::${rawCode}`;
        if (!map.get(ac).has(key)) {
          map.get(ac).set(key, { group, code: rawCode, name });
        }
      });
    });
    const result = new Map();
    map.forEach((inner, ac) => result.set(ac, [...inner.values()]));
    return result;
  }, [rawData, dimensionsAll]);




const colLabel = (col) => {
    if (col === "__consolidated__") return "Consolidated";
    if (viewMode === "dimensions") return dimensionPivots.get(col)?.name ?? col;
    if (viewMode === "subsidiaries") {
      const co = companiesAll.find(c => (c.CompanyShortName ?? c.companyShortName) === col);
      return co?.CompanyLegalName ?? co?.companyLegalName ?? col;
    }
    return col;
  };

  // ── KPI results ────────────────────────────────────────────────────
  const results = useMemo(() => {
    const r = new Map();
    if (viewMode === "dimensions") {
      dimensionPivots.forEach((entry, key) => {
        r.set(key, computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis));
      });
    } else {
      pivots.forEach((p, col) => r.set(col, computeAllKpisResolved(kpiList, p, ccTagToCodes, sectionCodes, resolvedAllKpis)));
    }
    return r;
  }, [viewMode, pivots, dimensionPivots, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

const resultsCmp = useMemo(() => {
    const r = new Map();
    if (viewMode === "dimensions") {
      dimensionPivotsCmp.forEach((entry, key) => r.set(key, computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis)));
    } else {
      pivotsCmp.forEach((p, col) => r.set(col, computeAllKpisResolved(kpiList, p, ccTagToCodes, sectionCodes, resolvedAllKpis)));
    }
    return r;
  }, [viewMode, pivotsCmp, dimensionPivotsCmp, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  // ── KPI CRUD ───────────────────────────────────────────────────────
const refreshCompanyKpis = useCallback(() => {
    if (!companyId) return;
    listCompanyKpis({ companyId, contextMappingId: "*", scope: "consolidated" })
      .then(rows => setCompanyKpis(rows ?? []))
      .catch(() => {});
  }, [companyId]);

  const saveKpi = useCallback(async (data) => {
    if (!companyId || !authUserId) { alert("Session or company not resolved."); return; }

    if (editingKpi !== "new" && editingKpi && typeof editingKpi === "object" && editingKpi.id) {
      const inLibrary = companyKpis.some(k => k.kpi_id === editingKpi.id && !k.tag?.startsWith(OVERRIDE_TAG_PREFIX));
      const isBuiltIn = builtInKpiIds.has(editingKpi.id);
      const labelChanged = data.label !== editingKpi.label;

if (isBuiltIn && !labelChanged) {
        await saveSystemOverride(editingKpi.id, {
          label:       editingKpi.label,
          description: data.description,
          category:    data.category,
          format:      data.format ?? editingKpi.format,
          formula:     data.formula ?? editingKpi.formula,
          benchmark:   data.benchmark,
        });
        setEditingKpi(null);
        refreshCompanyKpis();
        return;
      }

if (isBuiltIn && labelChanged) {
        try {
          const allLabels = new Set([...localKpis.map(k => k.label), ...resolvedAllKpis.map(k => k.label)]);
          let finalLabel = data.label;
          if (allLabels.has(finalLabel)) {
            const base = finalLabel.replace(/ \d+$/, "");
            let n = 2;
            while (allLabels.has(`${base} ${n}`)) n++;
            finalLabel = `${base} ${n}`;
          }
          const created = await createCompanyKpi({ companyId, userId: authUserId, label: finalLabel, description: data.description ?? null, category: data.category ?? null, tag: data.tag ?? null, format: data.format ?? "currency", formula: data.formula ?? editingKpi.formula, benchmark: data.benchmark ?? null, contextMappingId: null, scope: "consolidated" });
          setCompanyKpis(prev => [...prev, created]);
          const activeScope = viewMode === "dimensions" ? "consolidated_dimension" : "consolidated_company";
          setDashboardKpiIds(prev => {
            if (!prev) return prev;
            const next = prev.map(id => id === editingKpi.id ? created.kpi_id : id);
            persistDashboard(next, activeScope);
            return next;
          });
          setEditingKpi(null);
          refreshCompanyKpis();
        } catch (e) { alert(`Could not promote KPI: ${e.message}`); }
        return;
      }

      if (!inLibrary) { setEditingKpi(null); return; }
      try {
        const updated = await updateCompanyKpi({ kpiId: editingKpi.id, userId: authUserId, label: data.label, description: data.description ?? null, category: data.category ?? null, tag: data.tag ?? null, format: data.format ?? "currency", formula: data.formula, benchmark: data.benchmark ?? null, sourceSystemKpiId: null });
        setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
        setEditingKpi(null);
        refreshCompanyKpis();
      } catch (e) { alert(`Update failed: ${e.message}`); }
      return;
    }
const activeScope = viewMode === "dimensions" ? "consolidated_dimension" : "consolidated_company";

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
      const activeOverrideMap = viewMode === "dimensions" ? systemOverrides.dim : systemOverrides.comp;
      if (activeOverrideMap.has(systemId)) {
        // An edited version already exists — create a clean copy with its own UUID
        const base = resolvedAllKpis.find(k => k.id === systemId);
        if (base) {
          try {
            const created = await createCompanyKpi({
              companyId, userId: authUserId,
              label:             base.label,
              description:       base.description ?? null,
              category:          base.category ?? null,
              tag:               null,
              format:            base.format ?? "currency",
              formula:           base.formula,
              benchmark:         base.benchmark ?? null,
              contextMappingId:  null,
              scope:             "consolidated",
              kpiType:           "custom",
              sourceSystemKpiId: systemId,
            });
            setCompanyKpis(prev => [...prev, created]);
            addToDashboard(created.kpi_id, activeScope);
            setEditingKpi(null);
            refreshCompanyKpis();
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
try {
      const allLabels = new Set([...localKpis.map(k => k.label), ...resolvedAllKpis.map(k => k.label)]);
      let finalLabel = data.label;
      if (allLabels.has(finalLabel)) {
        const base = finalLabel.replace(/ \d+$/, "");
        let n = 2;
        while (allLabels.has(`${base} ${n}`)) n++;
        finalLabel = `${base} ${n}`;
      }
      const created = await createCompanyKpi({ companyId, userId: authUserId, label: finalLabel, description: data.description ?? null, category: data.category ?? null, tag: (data.tag && !data.tag.startsWith("__")) ? data.tag : null, format: data.format ?? "currency", formula: data.formula, benchmark: data.benchmark ?? null, contextMappingId: activeMapping?.mapping_id ?? null, scope: "consolidated" });
      setCompanyKpis(prev => [...prev, created]);
      addToDashboard(created.kpi_id, viewMode === "dimensions" ? "consolidated_dimension" : "consolidated_company");
      setEditingKpi(null);
      refreshCompanyKpis();
    } catch (e) { alert(`Create failed: ${e.message}`); }
  }, [companyId, authUserId, editingKpi, activeMapping, companyKpis, addToDashboard, builtInKpiIds, systemOverrides, OVERRIDE_TAG_PREFIX, persistDashboard, refreshCompanyKpis]);

  // ── Export ─────────────────────────────────────────────────────────
  const handleExportXlsx = async () => {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Konsolidator"; wb.created = new Date();
      const ws = wb.addWorksheet("Consolidated KPIs", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
      const cols = orderedCols;
      const totalCols = 2 + cols.length;
      ws.mergeCells(1, 1, 1, totalCols);
      ws.getCell(1,1).value = `Consolidated KPIs · ${year}/${String(month).padStart(2,"0")} · ${topParent}`;
      ws.getCell(1,1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      ws.getCell(1,1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2F8A" } };
      ws.getRow(1).height = 28;
      const hr = ws.getRow(4); hr.height = 22;
      hr.getCell(1).value = "KPI";
      cols.forEach((col, i) => { hr.getCell(2 + i).value = colLabel(col); });
      hr.getCell(2 + cols.length).value = "Total / Avg";
      hr.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2F8A" } }; c.alignment = { vertical: "middle", horizontal: "right" }; });
      kpiList.forEach((kpi, ri) => {
        const r = ws.getRow(5 + ri); r.height = 16;
        const values = cols.map(col => { const res = results.get(col); const v = res?.get(kpi.id); return (v === undefined || v === null || isNaN(v)) ? null : v; });
        const validVals = values.filter(v => v !== null);
        const agg = validVals.length === 0 ? null : kpi.format === "percent" ? validVals.reduce((a,b)=>a+b,0)/validVals.length : validVals.reduce((a,b)=>a+b,0);
        r.getCell(1).value = kpi.label; r.getCell(1).font = { bold: true, color: { argb: "FF1A2F8A" } };
        values.forEach((v, i) => {
          const c = r.getCell(2 + i);
          if (v === null) { c.value = "—"; } else { c.value = v; c.numFmt = kpi.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0'; }
        });
        const aggC = r.getCell(2 + cols.length);
        if (agg === null) aggC.value = "—"; else { aggC.value = agg; aggC.numFmt = kpi.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0'; aggC.font = { bold: true, color: { argb: "FF1A2F8A" } }; }
      });
      ws.getColumn(1).width = 36; cols.forEach((_, i) => ws.getColumn(2 + i).width = 18); ws.getColumn(2 + cols.length).width = 18;
      const buf = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `ConsolidatedKPIs_${topParent}_${year}_${month}.xlsx`);
    } catch (e) { alert("Export failed: " + e.message); }
    finally { setExporting(false); }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      doc.setFillColor(26,47,138); doc.rect(0, 0, W, 50, "F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(14);
      doc.text(`Consolidated KPIs · ${topParent}`, 24, 24);
      doc.setFont("helvetica","normal"); doc.setFontSize(9);
      doc.text(`${year}/${String(month).padStart(2,"0")} · ${source} · ${structure}`, 24, 40);
      const cols = orderedCols;
      autoTable(doc, {
        head: [["KPI", ...cols.map(colLabel), "Total / Avg"]],
        body: kpiList.map(kpi => {
          const values = cols.map(col => { const res = results.get(col); const v = res?.get(kpi.id); return (v === null || isNaN(v)) ? "—" : fmtValue(v, kpi.format); });
          const validVals = cols.map(col => { const res = results.get(col); const v = res?.get(kpi.id); return (v === null || isNaN(v)) ? null : v; }).filter(v => v !== null);
          const agg = validVals.length === 0 ? "—" : fmtValue(kpi.format === "percent" ? validVals.reduce((a,b)=>a+b,0)/validVals.length : validVals.reduce((a,b)=>a+b,0), kpi.format);
          return [kpi.label, ...values, agg];
        }),
        startY: 70, theme: "plain",
        styles: { font: "helvetica", fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [26,47,138], textColor: [255,255,255], fontStyle: "bold" },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 140 } },
        alternateRowStyles: { fillColor: [248,249,255] },
      });
      doc.save(`ConsolidatedKPIs_${topParent}_${year}_${month}.pdf`);
    } catch (e) { alert("PDF failed: " + e.message); }
    finally { setExporting(false); }
  };

  // ── Drag reorder ───────────────────────────────────────────────────
const handleDragEnd = useCallback(() => {
    const activeDashIds = viewMode === "dimensions" ? dashboardKpiIdsDim : dashboardKpiIds;
    const setter = viewMode === "dimensions" ? setDashboardKpiIdsDim : setDashboardKpiIds;
    const scope = viewMode === "dimensions" ? "consolidated_dimension" : "consolidated_company";
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx && activeDashIds) {
      const newRows = [...kpiList];
      const [moved] = newRows.splice(dragIdx, 1);
      newRows.splice(dragOverIdx, 0, moved);
      const oldVisibleIds = kpiList.map(k => k.id);
      const newVisibleIds = newRows.map(k => k.id);
      const visibleSet = new Set(oldVisibleIds);
      const queue = [...newVisibleIds];
      const newDash = activeDashIds.map(id => visibleSet.has(id) ? queue.shift() : id);
      setter(newDash);
      persistDashboard(newDash, scope);
    }
    setDragIdx(null); setDragOverIdx(null);
  }, [dragIdx, dragOverIdx, kpiList, dashboardKpiIds, dashboardKpiIdsDim, persistDashboard, viewMode]);

  const handleColDragEnd = () => {
    if (colDragIdx !== null && colDragOverIdx !== null && colDragIdx !== colDragOverIdx) {
      const newCols = [...orderedCols]; const [moved] = newCols.splice(colDragIdx, 1); newCols.splice(colDragOverIdx, 0, moved); setColOrder(newCols);
    }
    setColDragIdx(null); setColDragOverIdx(null);
  };

  // ── Filter options ─────────────────────────────────────────────────
  const sourceOpts    = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
<style>{`
        @keyframes cmpBarIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes cmpBarOut { from { opacity:1; } to { opacity:0; } }
        @keyframes cmpColIn  { from { opacity:0; transform:scaleX(0.6); } to { opacity:1; transform:scaleX(1); } }
        @keyframes cmpColOut { from { opacity:1; transform:scaleX(1); } to { opacity:0; transform:scaleX(0.6); } }
        @keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
      `}</style>
      <PageHeader
        kicker="Consolidated"
        title="KPIs"
tabs={[
          { id: "subsidiaries",  label: "Companies",   icon: Building2  },
          { id: "dimensions",    label: "Dimensions",  icon: Layers     },
          { id: "graphs",        label: "Graphs",      icon: BarChart3  },
        ]}
        activeTab={viewMode}
        onTabChange={v => { setViewMode(v); setColOrder(null); setSelGroup(""); setSelDim(""); }}
        filters={viewMode === "graphs" ? [] : [
          ...(sourceOpts.length > 0 ? [{ label: "Source", value: source, onChange: setSource, options: sourceOpts }] : []),
          { label: "Year",  value: year,  onChange: setYear,  options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
          { label: "Month", value: month, onChange: setMonth, options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
          ...(structureOpts.length > 0 ? [{ label: "Structure", value: structure, onChange: setStructure, options: structureOpts }] : []),
          ...(holdingOptions.length > 0 ? [{ label: "Perspective", value: topParent, onChange: setTopParent, options: holdingOptions }] : []),
          ...(dimGroups.length > 0 ? [{ label: "Dim Group", value: selGroup, onChange: v => { setSelGroup(v); setSelDim(""); }, options: [{ value: "", label: "All" }, ...dimGroups.map(g => ({ value: g, label: g }))] }] : []),
          ...(selGroup && groupDimOptions.length > 0 ? [{ label: "Dimension", value: selDim, onChange: setSelDim, options: [{ value: "", label: "All" }, ...groupDimOptions.map(d => ({ value: d.code, label: d.name }))] }] : []),
        ]}
        periodToggle={{ value: viewPeriod, onChange: setViewPeriod }}
        compareToggle={{ active: compareMode, onChange: setCompareMode }}
        fabActions={[
          { id: "views", icon: Library, label: "Views", onClick: () => setViewsModalOpen(true) },
          {
            id: "export", icon: Download, label: "Export",
            subActions: [
              { id: "excel", label: "Excel", src: "https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png", alt: "Excel", onClick: handleExportXlsx },
              { id: "pdf",   label: "PDF",   src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png", alt: "PDF", onClick: handleExportPdf },
            ],
          },
        ]}
      />



      {activeMapping && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex-shrink-0">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
          <span className="text-xs text-emerald-700 font-medium">Mapping active: <strong>{activeMapping.name}</strong></span>
          <button onClick={() => setActiveMapping(null)} className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest"><X size={11} /> Clear</button>
        </div>
      )}

      {activeMapping && !warningDismissed && (
        <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex-shrink-0">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-amber-800">{mappingMatched.length} sections matched, {mappingUnmatched.length} unmatched.</span>
          <button onClick={() => setWarningDismissed(true)} className="ml-auto w-5 h-5 rounded hover:bg-amber-100 text-amber-600 flex items-center justify-center"><X size={10} /></button>
        </div>
      )}

{cmpVisible && viewMode !== "graphs" && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0"
          style={{ animation: cmpExiting ? "cmpBarOut 350ms ease both" : "cmpBarIn 400ms ease both", position: "relative", zIndex: 45, overflow: "visible" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Compare with</span>
          </div>
          {sourceOpts.length > 0 && <HeaderFilterPill label="Source" value={cmpSource} onChange={setCmpSource} options={sourceOpts} />}
          <HeaderFilterPill label="Year" value={cmpYear} onChange={setCmpYear} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
          <HeaderFilterPill label="Month" value={cmpMonth} onChange={setCmpMonth} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
          {structureOpts.length > 0 && <HeaderFilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure} options={structureOpts} />}
        </div>
      )}

{!kpiDashReady ? (
        <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
          style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
            style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
            <div className="relative" style={{ width: 140, height: 140 }}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                <circle cx="70" cy="70" r="60" fill="none" stroke="url(#consKpiGrad)" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 60}
                  strokeDashoffset={2 * Math.PI * 60 * (1 - animatedKpiDashProgress / 100)}
                  style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }} />
                <defs>
                  <linearGradient id="consKpiGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                    <stop offset="100%" stopColor="#CF305D" />
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
              {!metaReady ? "Finding latest period…" : groupAccounts.length === 0 ? "Loading group accounts…" : rawData.length === 0 ? "Building consolidated KPIs…" : "Finalizing…"}
            </p>
            <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">Consolidated · KPIs</p>
          </div>
        </div>
) : viewMode === "graphs" ? (
<ConsolidatedGraphSection
          sectionId={1} token={token}
          source={source} structure={structure} topParent={topParent}
          sourceOpts={sourceOpts} structureOpts={structureOpts}
          holdingOptions={holdingOptions}
          kpiList={kpiList} allKpis={resolvedAllKpis}
          ccTagToCodes={ccTagToCodes} sectionCodes={sectionCodes}
          defaultKpiIds={["revenue","gross_profit","net_result"]}
          onStateChange={handleGraphSectionState}
          colors={colors} body1Style={body1Style}
          compareMode={compareMode}
        />
      ) : loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
<thead className="sticky top-0 z-40">
                <tr style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
                  <th className="sticky left-0 z-50 text-left px-6 border-r border-gray-100"
                    style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: 64, minWidth: 260 }}>
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>KPI</span>
                      <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>Dashboard</span>
                    </div>
                  </th>
                  {orderedCols.flatMap((col, ci) => {
                    const isDragging = colDragIdx === ci;
                    const isDragOver = colDragOverIdx === ci && colDragIdx !== ci;
                    const cells = [
                      <th key={col}
                        draggable
                        onDragStart={() => setColDragIdx(ci)}
                        onDragOver={e => { e.preventDefault(); setColDragOverIdx(ci); }}
                        onDragLeave={() => { if (colDragOverIdx === ci) setColDragOverIdx(null); }}
                        onDrop={e => { e.preventDefault(); handleColDragEnd(); }}
                        onDragEnd={handleColDragEnd}
                        className="text-center px-4 select-none cursor-grab"
                        style={{
                          background: isDragOver ? `${colors.primary}15` : "rgba(255,255,255,0.95)",
                          borderLeft: "1px solid #f0f0f0",
                          minWidth: 150,
                          opacity: isDragging ? 0.4 : 1,
                          outline: isDragOver ? `2px solid ${colors.primary}` : "none",
                          transition: "background 150ms ease, outline 150ms ease",
                        }}>
                        <div className="flex flex-col items-center gap-0.5 py-4">
                          <span className="font-black tracking-tight truncate max-w-[160px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} title={colLabel(col)}>{colLabel(col)}</span>
                          {viewMode === "subsidiaries" && (
                            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>
                              {companiesAll.find(c => (c.CompanyShortName ?? c.companyShortName) === col)?.CurrencyCode ?? "—"}
                            </span>
                          )}
                        </div>
                      </th>
                    ];
                    if (compareMode) {
                      cells.push(
                        <th key={`${col}__cmp`} className="text-center px-3 whitespace-nowrap" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 60ms both", transformOrigin: "left center" }}>
                          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
                        </th>,
                        <th key={`${col}__delta`} className="text-center px-3 whitespace-nowrap" style={{ background: `${colors.primary}12`, minWidth: 110, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 120ms both", transformOrigin: "left center" }}>
                          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
                        </th>,
                        <th key={`${col}__deltapct`} className="text-center px-3 whitespace-nowrap" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 180ms both", transformOrigin: "left center" }}>
                          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
                        </th>
                      );
                    }
                    return cells;
                  })}
                  <th className="sticky right-0 z-10 px-4 whitespace-nowrap border-l border-gray-100"
                    style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", minWidth: 150 }}>
                    <div className="flex flex-col items-center gap-0.5 py-4">
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13 }}>Total</span>
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>/ Avg</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {kpiList.map((kpi, globalIdx) => {
                  const values = orderedCols.map(col => { const res = results.get(col); const v = res?.get(kpi.id); return (v === undefined || v === null || isNaN(v)) ? null : v; });
                  const validVals = values.filter(v => v !== null);
                  const aggregate = validVals.length === 0 ? null : kpi.format === "percent" ? validVals.reduce((a,b)=>a+b,0)/validVals.length : validVals.reduce((a,b)=>a+b,0);
                  return (
<tr key={`${viewMode}-${kpi.id}`} draggable onDragStart={() => setDragIdx(globalIdx)} onDragOver={e => { e.preventDefault(); setDragOverIdx(globalIdx); }} onDragEnd={handleDragEnd}
                      className={`border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors group ${dragOverIdx === globalIdx ? "bg-[#eef1fb]" : ""}`}
                      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(globalIdx, 25) * 40}ms both` }}>
                      <td className="sticky left-0 z-20 px-4 py-3 bg-white border-r border-gray-100 group-hover:bg-[#f8f9ff]">
                        <div className="flex items-center gap-2">
                          <div className="opacity-0 group-hover:opacity-40 cursor-grab text-gray-400 flex-shrink-0"><GripVertical size={11} /></div>
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
<div className="flex items-center gap-1.5 flex-wrap">
                              <span className="truncate" style={body1Style}>{kpi.label}</span>
                              {kpi.category && <span className="px-1.5 py-0.5 rounded-md flex-shrink-0 text-[9px] font-black uppercase tracking-wider" style={{ background: `${colors.primary}15`, color: colors.primary }}>{kpi.category}</span>}
                              {kpi._isOverridden && <span className="px-1.5 py-0.5 rounded-md flex-shrink-0 text-[8px] font-black uppercase tracking-wider" style={{ background: "#ede9fe", color: "#6d28d9" }}>edited</span>}
                              {kpi._kpiType === "custom" && !kpi._isOverridden && !kpi._sourceSystemKpiId && !kpi._contextMappingId && <span className="px-1.5 py-0.5 rounded-md flex-shrink-0 text-[8px] font-black uppercase tracking-wider" style={{ background: "#dcfce7", color: "#15803d" }}>custom</span>}
                            </div>
                            {kpi.description && <span className="truncate" style={underscore3Style}>{kpi.description}</span>}
                          </div>
<div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => setEditingKpi(kpi)} className="w-6 h-6 rounded-lg flex items-center justify-center transition-all hover:scale-110" style={{ background: `${colors.primary}12`, color: colors.primary }}><Edit3 size={9} /></button>
                           <button onClick={() => removeFromDashboard(kpi.id, viewMode === "dimensions" ? "consolidated_dimension" : "consolidated_company")} className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-500 hover:text-white text-red-400 flex items-center justify-center transition-all"><Trash2 size={10} /></button>
                          </div>
                        </div>
                      </td>
                      {values.flatMap((val, ci) => {
                        const col = orderedCols[ci];
                        const cellStyle = val === null ? { ...body1Style, color: "#D1D5DB" } : { ...body1Style, color: val < 0 ? "#EF4444" : "#000" };
                       const bColor = getBenchmarkColor(val, kpi.benchmark);
                        const out = [<td key={col} className="px-4 py-3 text-center whitespace-nowrap transition-all" style={bColor ? { background: bColor.bg, borderLeft: `2px solid ${bColor.border}` } : undefined}><AnimatedCell value={val} format={kpi.format} baseStyle={{ ...body1Style, color: bColor ? bColor.text : undefined }} /></td>];
                        if (compareMode) {
                          const cmpRes = resultsCmp.get(col);
                          const cmpVal = cmpRes ? cmpRes.get(kpi.id) : null;
                          const cmpValid = cmpVal !== null && !isNaN(cmpVal);
                          const delta = cmpValid && val !== null ? val - cmpVal : null;
                          const deltaPct = delta !== null && kpi.format !== "percent" && Math.abs(cmpVal) > 1e-9 ? ((val - cmpVal) / Math.abs(cmpVal)) * 100 : null;
out.push(
                            <td key={`${col}__cmp`} className="px-4 py-3 text-center whitespace-nowrap"
                              style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 60ms both", transformOrigin: "left center" }}>
                              <AnimatedCell value={cmpValid ? cmpVal : null} format={kpi.format} baseStyle={body1Style} />
                            </td>,
                            <td key={`${col}__delta`} className="px-4 py-3 text-center whitespace-nowrap"
                              style={{ background: `${colors.primary}12`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 120ms both", transformOrigin: "left center" }}>
                              {delta === null ? <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span> : <AnimatedCell value={delta} format={kpi.format} baseStyle={{ ...body1Style, color: delta < 0 ? "#EF4444" : "#059669" }} />}
                            </td>,
                            <td key={`${col}__deltapct`} className="px-4 py-3 text-center whitespace-nowrap"
                              style={{ ...body1Style, color: deltaPct === null ? "#D1D5DB" : deltaPct < 0 ? "#EF4444" : "#059669", background: `${colors.primary}1e`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 180ms both", transformOrigin: "left center" }}>
                              {deltaPct === null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
                            </td>
                          );
                        }
                        return out;
                      })}
                      <td className="sticky right-0 px-4 py-3 text-center whitespace-nowrap border-l border-gray-100 bg-[#eef1fb] group-hover:bg-[#e4e8f8]"
                        style={{ ...body1Style, color: aggregate === null ? "#D1D5DB" : aggregate < 0 ? "#EF4444" : "#000" }}>
                        {aggregate === null ? "—" : <><AnimatedCell value={aggregate} format={kpi.format} baseStyle={body1Style} /><span className="text-[9px] font-normal text-gray-400 ml-1">{kpi.format === "percent" ? "avg" : "Σ"}</span></>}
                      </td>
                    </tr>
                  );
                })}
</tbody>
            </table>
          </div>
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
      )}

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
              removeFromDashboard(id);
            } catch (e) { alert(`Could not delete: ${e.message}`); }
          }}
          onDuplicate={async (data) => {
            if (!companyId || !authUserId) return;
            const base = data.label.replace(/ \d+$/, "");
            const existing = [...(localKpis ?? []), ...(resolvedAllKpis ?? [])];
            let n = 2;
            while (existing.some(k => k.label === `${base} ${n}`)) n++;
            try {
              const created = await createCompanyKpi({ companyId, userId: authUserId, label: `${base} ${n}`, description: data.description ?? null, category: data.category ?? null, tag: null, format: data.format ?? "currency", formula: data.formula, benchmark: data.benchmark ?? null, contextMappingId: null, scope: "consolidated" });
              setCompanyKpis(prev => [...prev, created]);
            } catch (e) { alert(`Could not duplicate: ${e.message}`); }
          }}
          kpiList={kpiList}
          allLocalKpis={localKpis}
          systemKpis={resolvedAllKpis}
          accountCodes={allAccountCodes}
          accountCodeLabels={accountCodeLabels}
          builtInIds={builtInKpiIds}
          currentUserId={authUserId}
          dimsByAccount={dimsByAccount}
        />
      )}
    </div>
  );
}