/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTypo, useSettings } from "./SettingsContext";
import {
  ChevronDown, Loader2, X, Plus, Trash2, Edit3,
  GripVertical, Check, Sigma, BarChart3, Layers,
  Library, Download, CheckCircle2, AlertTriangle,
  TrendingUp, Building2,
} from "lucide-react";
import PageHeader from "./PageHeader.jsx";
import MappingsModal from "./Mappings.jsx";
import {
  listCompanyKpis, createCompanyKpi, updateCompanyKpi,
  getUserDashboard, saveUserDashboard, importKpiToScope,
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

// ── Consolidated Graph Section ─────────────────────────────────────
// Fetches consolidated-accounts (Group role) over a time range and plots KPIs
function ConsolidatedGraphSection({
  sectionId, token, source, structure, topParent,
  sourceOpts, structureOpts, holdingOptions,
  kpiList, allKpis, ccTagToCodes, sectionCodes,
  defaultKpiIds, onStateChange,
  filterStyle, colors, body1Style, body2Style,
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
  const kpiPickerRef = useRef(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const chartContainerRef = useRef(null);

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
            const currYTD = curr.pivot.get(ac) ?? 0;
            const prevYTD = curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0);
            mp.set(ac, currYTD - prevYTD);
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
    if (onStateChange) onStateChange(sectionId, { sectionId, company: secTopParent, startY: secStartYear, startM: secStartMonth, endY: secEndYear, endM: secEndMonth, source: secSource, structure: secStructure, mode: secMode, kpiIds: secKpiIds, chartData, chartContainerRef });
  }, [sectionId, secTopParent, secStartYear, secStartMonth, secEndYear, secEndMonth, secSource, secStructure, secMode, secKpiIds, chartData, onStateChange]);

  const COLORS = [colors?.primary, colors?.secondary, colors?.tertiary, "#ef4444", "#8b5cf6", "#ec4899"];
  const toggleKpi = id => setSecKpiIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className={`flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${tableOpen ? "flex-shrink-0" : "flex-1 min-h-[200px]"}`}>
      <div className="flex items-center gap-1.5 flex-wrap px-4 py-2.5 bg-[#f8f9ff] border-b border-gray-100">
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50 mr-1">§{sectionId}</span>
        {holdingOptions.length > 0 && <FilterPill label="PERSP" value={secTopParent} onChange={setSecTopParent} options={holdingOptions} filterStyle={filterStyle} colors={colors} />}
        <span className="text-[9px] font-black text-gray-300 mx-1">│</span>
        <FilterPill label="Start M" value={secStartMonth} onChange={setSecStartMonth} options={MONTHS.map(m => ({ value: String(m.value), label: m.label.slice(0,3) }))} filterStyle={filterStyle} colors={colors} />
        <FilterPill label="Start Y" value={secStartYear} onChange={setSecStartYear} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} filterStyle={filterStyle} colors={colors} />
        <FilterPill label="End M" value={secEndMonth} onChange={setSecEndMonth} options={MONTHS.map(m => ({ value: String(m.value), label: m.label.slice(0,3) }))} filterStyle={filterStyle} colors={colors} />
        <FilterPill label="End Y" value={secEndYear} onChange={setSecEndYear} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} filterStyle={filterStyle} colors={colors} />
        <span className="text-[9px] font-black text-gray-300 mx-1">│</span>
        {sourceOpts.length > 0 && <FilterPill label="SRC" value={secSource} onChange={setSecSource} options={sourceOpts} filterStyle={filterStyle} colors={colors} />}
        {structureOpts.length > 0 && <FilterPill label="STRUCT" value={secStructure} onChange={setSecStructure} options={structureOpts} filterStyle={filterStyle} colors={colors} />}
        <FilterPill label="Mode" value={secMode} onChange={setSecMode} options={[{ value: "monthly", label: "Monthly" }, { value: "ytd", label: "YTD" }]} filterStyle={filterStyle} colors={colors} />
        <div ref={kpiPickerRef} className="relative flex-shrink-0">
          <button onClick={() => setKpiPickerOpen(o => !o)}
            className="flex items-center gap-2 px-3 py-2 rounded-2xl border text-xs font-bold select-none bg-white border-[#c2c2c2] shadow-sm hover:border-[#1a2f8a]/40">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">KPIs</span>
            <span className="text-[#1a2f8a]">{secKpiIds.length}</span>
            <ChevronDown size={10} className={`text-[#1a2f8a]/40 ${kpiPickerOpen ? "rotate-180" : ""}`} />
          </button>
          {kpiPickerOpen && (
            <div className="absolute top-full right-0 mt-2 z-50 min-w-[220px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
              <div className="p-1.5 max-h-64 overflow-y-auto">
                {kpiList.map(k => (
                  <button key={k.id} onClick={() => toggleKpi(k.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-2 ${secKpiIds.includes(k.id) ? "bg-[#eef1fb] text-[#1a2f8a]" : "text-gray-600 hover:bg-[#f8f9ff]"}`}>
                    <span className="truncate">{k.label}</span>
                    {secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {loading && <Loader2 size={12} className="animate-spin text-[#1a2f8a] ml-auto" />}
      </div>

      <div ref={chartContainerRef} className={tableOpen ? "relative flex-shrink-0" : "relative flex-1 min-h-0"} style={tableOpen ? { height: "260px" } : undefined}>
        <div className="absolute inset-0 px-4 py-3">
          {chartData.length === 0 || secKpiIds.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-gray-300 font-bold">
              {secKpiIds.length === 0 ? "Select at least one KPI" : loading ? "Loading…" : "No data"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1fb" />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#6b7280" }} interval={0} />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v, name) => { const k = kpiList.find(k => k.id === name); return [fmtValue(v, k?.format), k?.label ?? name]; }} />
                <Legend wrapperStyle={{ fontSize: 10 }} formatter={v => kpiList.find(k => k.id === v)?.label ?? v} />
                {secKpiIds.map((kid, i) => (
                  <Line key={kid} type="monotone" dataKey={kid} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="border-t border-gray-100 bg-[#fafbff]">
        <button onClick={() => setTableOpen(o => !o)}
          className="w-full flex items-center justify-end gap-1.5 px-4 py-1.5 text-[10px] font-black text-[#1a2f8a]/60 hover:text-[#1a2f8a] hover:bg-[#eef1fb]/50 transition-colors">
          <span>{tableOpen ? "Hide data" : "Show data"}</span>
          <ChevronDown size={11} className={`transition-transform ${tableOpen ? "rotate-180" : ""}`} />
        </button>
        {tableOpen && chartData.length > 0 && secKpiIds.length > 0 && (
          <div className="border-t border-gray-100 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ backgroundColor: colors?.primary }}>
                  <th className="text-center px-3 py-2 whitespace-nowrap" style={{ color: colors?.quaternary }}>Period</th>
                  {secKpiIds.map(kid => { const k = kpiList.find(k => k.id === kid); return <th key={kid} className="text-center px-3 py-2 whitespace-nowrap" style={{ color: colors?.quaternary }}>{k?.label ?? kid}</th>; })}
                </tr>
              </thead>
              <tbody>
                {chartData.map((d, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                    <td className="text-center px-3 py-1.5 whitespace-nowrap font-bold text-[#1a2f8a]">{d.period}</td>
                    {secKpiIds.map(kid => { const k = kpiList.find(k => k.id === kid); const v = d[kid]; return <td key={kid} className="text-center px-3 py-1.5 whitespace-nowrap" style={{ color: v === null ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000" }}>{v === null ? "—" : fmtValue(v, k?.format)}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

  // ── Compare ────────────────────────────────────────────────────────
  const [compareMode,  setCompareMode]  = useState(false);
  const [cmpSource,    setCmpSource]    = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
  const [cmpYear,      setCmpYear]      = useState("");
  const [cmpMonth,     setCmpMonth]     = useState("");

  // ── UI ─────────────────────────────────────────────────────────────
  const [viewMode,     setViewMode]     = useState("consolidated"); // "consolidated" | "subsidiaries" | "graphs"
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
        getUserDashboard({ userId: authUserId, companyId, scope: "consolidated" }).then(row => {

      setDashboardKpiIds(row?.kpi_ids?.length ? row.kpi_ids : ["revenue","gross_profit","net_result","net_margin"]);
    }).catch(() => setDashboardKpiIds(["revenue","gross_profit","net_result","net_margin"]));
  }, [authUserId, companyId]);

  const localKpis = useMemo(() => companyKpis.map(k => ({ id: k.kpi_id, label: k.label, description: k.description ?? "", category: k.category ?? "", tag: k.tag ?? "", format: k.format, formula: k.formula, benchmark: k.benchmark, _contextMappingId: k.context_mapping_id ?? null })), [companyKpis]);

  const persistDashboard = useCallback(async (ids) => {
    if (!authUserId || !companyId) return;
      try { await saveUserDashboard({ userId: authUserId, companyId, kpiIds: ids, scope: "consolidated" }); } catch {}

  }, [authUserId, companyId]);

  const addToDashboard = useCallback((kpiId) => {
    setDashboardKpiIds(prev => { if (!prev || prev.includes(kpiId)) return prev; const next = [...prev, kpiId]; persistDashboard(next); return next; });
  }, [persistDashboard]);

  const removeFromDashboard = useCallback((kpiId) => {
    setDashboardKpiIds(prev => { if (!prev) return prev; const next = prev.filter(id => id !== kpiId); persistDashboard(next); return next; });
  }, [persistDashboard]);

  const kpiList = useMemo(() => {
    if (!dashboardKpiIds) return [];
    const byId = new Map();
    resolvedKpiList.forEach(k => byId.set(k.id, k));
    localKpis.forEach(k => byId.set(k.id, k));
    return dashboardKpiIds.map(id => byId.get(id)).filter(Boolean);
  }, [dashboardKpiIds, resolvedKpiList, localKpis]);

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
    }).catch(() => setLoading(false));
  }, [metaReady, year, month, source, structure, topParent, compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, fetchConsolidated]);

  // ── Pivot building ─────────────────────────────────────────────────
  // "CONSOLIDATED" column = Group role rows (no origin/counterparty)
  // Per-subsidiary columns = Parent/Contribution rows for that company
  const sumAccountCodes = useMemo(() => {
    const sums = new Set();
    groupAccounts.forEach(g => { if (g.IsSumAccount === true || g.isSumAccount === true) sums.add(String(g.AccountCode ?? g.accountCode ?? "")); });
    return sums;
  }, [groupAccounts]);

useEffect(() => {
    if (!rawData.length) return;
    const allDims = new Set();
    const groupDims = new Set();
    rawData.forEach(r => {
      const dims = r.Dimensions ?? r.dimensions ?? "";
      if (dims) {
        allDims.add(dims);
        if ((r.CompanyRole ?? r.companyRole ?? "") === "Group") groupDims.add(dims);
      }
    });
    const byRole = {};
    rawData.forEach(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "unknown";
      if (!byRole[role]) byRole[role] = { total: 0, withDims: 0 };
      byRole[role].total++;
      if (r.Dimensions ?? r.dimensions) byRole[role].withDims++;
    });
console.log("[DimDebug] Total rows:", rawData.length);
    console.log("[DimDebug] Rows with any Dimensions:", allDims.size);
    console.log("[DimDebug] Group-role rows with Dimensions:", groupDims.size);
    console.log("[DimDebug] Sample Group Dimensions:", [...groupDims].slice(0, 5));
    console.log("[DimDebug] Rows by role:", byRole);

    // Check what survives the origin/counterparty filter used for dimension extraction
    const groupNoOrig = rawData.filter(r =>
      (r.CompanyRole ?? r.companyRole ?? "") === "Group" &&
      !r.OriginCompanyShortName?.trim() &&
      !r.CounterpartyShortName?.trim()
    );
    const groupNoOrigWithDims = groupNoOrig.filter(r => r.Dimensions ?? r.dimensions);
    console.log("[DimDebug] Group rows after origin/cp filter:", groupNoOrig.length);
    console.log("[DimDebug] ...of which have Dimensions:", groupNoOrigWithDims.length);
    if (groupNoOrigWithDims.length === 0 && groupDims.size > 0) {
      const sample = rawData.find(r =>
        (r.CompanyRole ?? r.companyRole ?? "") === "Group" &&
        (r.Dimensions ?? r.dimensions)
      );
      console.log("[DimDebug] Sample Group row WITH dims (origin/cp values):", {
        OriginCompanyShortName: sample?.OriginCompanyShortName,
        CounterpartyShortName:  sample?.CounterpartyShortName,
        Dimensions:             sample?.Dimensions,
      });
    }
  }, [rawData]);

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
    if (viewMode === "consolidated") return ["__consolidated__"];
    if (viewMode === "dimensions")   return [...dimensionPivots.keys()].sort();
    return [];
  }, [viewMode, dimensionPivots]);

  const orderedCols = colOrder && colOrder.length === activeCols.length ? colOrder : activeCols;

  const colLabel = (col) => {
    if (col === "__consolidated__") return "Consolidated";
    if (viewMode === "dimensions") return dimensionPivots.get(col)?.name ?? col;
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
    pivotsCmp.forEach((p, col) => r.set(col, computeAllKpisResolved(kpiList, p, ccTagToCodes, sectionCodes, resolvedAllKpis)));
    return r;
  }, [pivotsCmp, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  // ── KPI CRUD ───────────────────────────────────────────────────────
  const saveKpi = useCallback(async (data) => {
    if (!companyId || !authUserId) { alert("Session or company not resolved."); return; }
    if (editingKpi !== "new" && editingKpi && editingKpi.id) {
      const inLibrary = companyKpis.some(k => k.kpi_id === editingKpi.id);
      if (!inLibrary) { alert("Built-in KPIs cannot be edited. Duplicate as custom."); setEditingKpi(null); return; }
      try {
        const updated = await updateCompanyKpi({ kpiId: editingKpi.id, userId: authUserId, ...data });
        setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
        setEditingKpi(null);
      } catch (e) { alert(`Update failed: ${e.message}`); }
      return;
    }
    const existing = data.id ? companyKpis.find(k => k.kpi_id === data.id) : null;
    if (existing) { addToDashboard(existing.kpi_id); setEditingKpi(null); return; }
    try {
        const created = await createCompanyKpi({ companyId, userId: authUserId, ...data, contextMappingId: activeMapping?.mapping_id ?? null, scope: "consolidated" });

      setCompanyKpis(prev => [...prev, created]);
      addToDashboard(created.kpi_id);
      setEditingKpi(null);
    } catch (e) { alert(`Create failed: ${e.message}`); }
  }, [companyId, authUserId, editingKpi, activeMapping, companyKpis, addToDashboard]);

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
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx && dashboardKpiIds) {
      const newRows = [...kpiList]; const [moved] = newRows.splice(dragIdx, 1); newRows.splice(dragOverIdx, 0, moved);
      const visSet = new Set(kpiList.map(k => k.id)); const queue = [...newRows.map(k => k.id)];
      const newDash = dashboardKpiIds.map(id => visSet.has(id) ? queue.shift() : id);
      setDashboardKpiIds(newDash); persistDashboard(newDash);
    }
    setDragIdx(null); setDragOverIdx(null);
  }, [dragIdx, dragOverIdx, kpiList, dashboardKpiIds, persistDashboard]);

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

      <PageHeader
        kicker="Consolidated"
        title="KPIs"
        tabs={[
          { id: "consolidated",  label: "Consolidated",  icon: TrendingUp   },
          { id: "dimensions",    label: "Dimensions",    icon: Layers       },
          { id: "graphs",        label: "Graphs",         icon: BarChart3    },
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

      <MappingsModal open={viewsModalOpen} onClose={() => setViewsModalOpen(false)} groupAccounts={groupAccounts} onApply={handleApplyMapping} />

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

      {compareMode && viewMode !== "graphs" && (
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50 mr-1">Compare with</span>
          {sourceOpts.length > 0 && <FilterPill label="Source" value={cmpSource} onChange={setCmpSource} options={sourceOpts} filterStyle={filterStyle} colors={colors} />}
          <FilterPill label="Year" value={cmpYear} onChange={setCmpYear} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} filterStyle={filterStyle} colors={colors} />
          <FilterPill label="Month" value={cmpMonth} onChange={setCmpMonth} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} filterStyle={filterStyle} colors={colors} />
          {structureOpts.length > 0 && <FilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure} options={structureOpts} filterStyle={filterStyle} colors={colors} />}
        </div>
      )}

      {!metaReady || (loading && rawData.length === 0) ? (
        <div className="flex items-center justify-center flex-1">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
            <p className="text-xs text-gray-400">{!metaReady ? "Loading metadata…" : "Building consolidated KPIs…"}</p>
          </div>
        </div>
      ) : viewMode === "graphs" ? (
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-auto pr-1">
          {[1, 2, 3].map(sid => (
            <ConsolidatedGraphSection
              key={sid} sectionId={sid} token={token}
              source={source} structure={structure} topParent={topParent}
              sourceOpts={sourceOpts} structureOpts={structureOpts}
              holdingOptions={holdingOptions}
              kpiList={kpiList} allKpis={resolvedAllKpis}
              ccTagToCodes={ccTagToCodes} sectionCodes={sectionCodes}
              defaultKpiIds={["revenue","gross_profit","net_result"]}
              onStateChange={handleGraphSectionState}
              filterStyle={filterStyle} colors={colors}
              body1Style={body1Style} body2Style={body2Style}
            />
          ))}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-40">
                <tr style={{ backgroundColor: colors.primary }}>
                  <th className="sticky left-0 z-50 text-center px-5 py-3 border-r border-white/20 min-w-[260px]" style={{ backgroundColor: colors.primary }}>
                    <span style={header2Style}>KPI</span>
                  </th>
                  {orderedCols.flatMap((col, ci) => {
                    const cells = [
                      <th key={col} draggable onDragStart={() => setColDragIdx(ci)} onDragOver={e => { e.preventDefault(); setColDragOverIdx(ci); }} onDragEnd={handleColDragEnd}
                        className={`text-center px-4 py-3 whitespace-nowrap min-w-[150px] cursor-grab select-none ${colDragOverIdx === ci ? "opacity-50" : ""}`}
                        style={{ backgroundColor: colors.primary }}>
                        <span style={header2Style}>{colLabel(col)}</span>
                      </th>
                    ];
                    if (compareMode) {
                      cells.push(
                        <th key={`${col}__cmp`} className="text-center px-4 py-3 whitespace-nowrap min-w-[130px]" style={{ backgroundColor: colors.primary, opacity: 0.85 }}><span style={header2Style}>{colLabel(col)} (cmp)</span></th>,
                        <th key={`${col}__delta`} className="text-center px-4 py-3 whitespace-nowrap min-w-[110px]" style={{ backgroundColor: colors.primary, opacity: 0.7 }}><span style={header2Style}>Δ</span></th>
                      );
                    }
                    return cells;
                  })}
                  <th className="sticky right-0 z-50 px-4 py-3 whitespace-nowrap border-l border-white/20 min-w-[150px] text-center" style={{ backgroundColor: colors.primary }}>
                    <span style={header2Style}>Total / Avg</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {kpiList.map((kpi, globalIdx) => {
                  const values = orderedCols.map(col => { const res = results.get(col); const v = res?.get(kpi.id); return (v === undefined || v === null || isNaN(v)) ? null : v; });
                  const validVals = values.filter(v => v !== null);
                  const aggregate = validVals.length === 0 ? null : kpi.format === "percent" ? validVals.reduce((a,b)=>a+b,0)/validVals.length : validVals.reduce((a,b)=>a+b,0);
                  return (
                    <tr key={kpi.id} draggable onDragStart={() => setDragIdx(globalIdx)} onDragOver={e => { e.preventDefault(); setDragOverIdx(globalIdx); }} onDragEnd={handleDragEnd}
                      className={`border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors group ${dragOverIdx === globalIdx ? "bg-[#eef1fb]" : ""}`}>
                      <td className="sticky left-0 z-20 px-4 py-3 bg-white border-r border-gray-100 group-hover:bg-[#f8f9ff]">
                        <div className="flex items-center gap-2">
                          <div className="opacity-0 group-hover:opacity-40 cursor-grab text-gray-400 flex-shrink-0"><GripVertical size={11} /></div>
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate" style={body1Style}>{kpi.label}</span>
                              {kpi.category && <span className="px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: colors.primary, ...underscore2Style }}>{kpi.category}</span>}
                            </div>
                            {kpi.description && <span className="truncate" style={underscore3Style}>{kpi.description}</span>}
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => removeFromDashboard(kpi.id)} className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-500 hover:text-white text-red-400 flex items-center justify-center transition-all"><Trash2 size={10} /></button>
                          </div>
                        </div>
                      </td>
                      {values.flatMap((val, ci) => {
                        const col = orderedCols[ci];
                        const cellStyle = val === null ? { ...body1Style, color: "#D1D5DB" } : { ...body1Style, color: val < 0 ? "#EF4444" : "#000" };
                        const out = [<td key={col} className="px-4 py-3 text-center whitespace-nowrap" style={cellStyle}>{val === null ? "—" : fmtValue(val, kpi.format)}</td>];
                        if (compareMode) {
                          const cmpRes = resultsCmp.get(col);
                          const cmpVal = cmpRes ? cmpRes.get(kpi.id) : null;
                          const cmpValid = cmpVal !== null && !isNaN(cmpVal);
                          const delta = cmpValid && val !== null ? val - cmpVal : null;
                          const deltaPct = delta !== null && kpi.format !== "percent" && Math.abs(cmpVal) > 1e-9 ? ((val - cmpVal) / Math.abs(cmpVal)) * 100 : null;
                          out.push(
                            <td key={`${col}__cmp`} className="px-4 py-3 text-center whitespace-nowrap bg-[#fafbff]" style={!cmpValid ? { ...body1Style, color: "#D1D5DB" } : { ...body1Style, color: cmpVal < 0 ? "#EF4444" : "#000" }}>{cmpValid ? fmtValue(cmpVal, kpi.format) : "—"}</td>,
                            <td key={`${col}__delta`} className="px-4 py-3 text-center whitespace-nowrap bg-[#f5f7ff]" style={delta === null ? { ...body1Style, color: "#D1D5DB" } : { ...body1Style, color: delta < 0 ? "#EF4444" : "#059669" }}>
                              {delta === null ? "—" : <div className="flex flex-col gap-0.5 leading-tight"><span>{fmtValue(delta, kpi.format)}</span>{deltaPct !== null && <span className="text-[9px] opacity-70">{deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%</span>}</div>}
                            </td>
                          );
                        }
                        return out;
                      })}
                      <td className="sticky right-0 px-4 py-3 text-center whitespace-nowrap border-l border-gray-100 bg-[#eef1fb] group-hover:bg-[#e4e8f8]"
                        style={{ ...body1Style, color: aggregate === null ? "#D1D5DB" : aggregate < 0 ? "#EF4444" : "#000" }}>
                        {aggregate === null ? "—" : <>{fmtValue(aggregate, kpi.format)}<span className="text-[9px] font-normal text-gray-400 ml-1">{kpi.format === "percent" ? "avg" : "Σ"}</span></>}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="sticky left-0 bg-white px-5 py-3">
                    <button onClick={() => setEditingKpi("new")} className="flex items-center gap-1.5 text-[11px] font-bold text-gray-300 hover:text-[#1a2f8a] transition-colors">
                      <Plus size={11} /> Add KPI row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingKpi !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingKpi(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><Sigma size={14} className="text-white/70" /><p className="text-white font-black text-sm">Add KPI to dashboard</p></div>
              <button onClick={() => setEditingKpi(null)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"><X size={13} className="text-white/70" /></button>
            </div>
            <div className="p-5">
              <p className="text-xs text-gray-500 mb-4">Select a KPI from your library to add to this dashboard.</p>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {[...resolvedKpiList, ...localKpis].filter(k => !kpiList.find(kl => kl.id === k.id)).map(k => (
                  <button key={k.id} onClick={() => { addToDashboard(k.id); setEditingKpi(null); }}
                    className="text-left p-3 rounded-xl border border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb] transition-all">
                    <p className="text-xs font-black text-[#1a2f8a]">{k.label}</p>
                    {k.category && <p className="text-[10px] text-gray-400 mt-0.5">{k.category}</p>}
                  </button>
                ))}
              </div>

              {individualKpis.filter(k => !kpiList.find(kl => kl.id === k.kpi_id)).length > 0 && (
                <>
                  <div className="flex items-center gap-2 mt-4 mb-2">
                    <div className="flex-1 h-px bg-gray-100" />
                    <button onClick={() => setShowImportPanel(o => !o)}
                      className="text-[10px] font-black text-[#1a2f8a]/50 hover:text-[#1a2f8a] uppercase tracking-widest transition-colors">
                      {showImportPanel ? "▾ Hide" : "▸ Import from Individual"}
                    </button>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                  {showImportPanel && (
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                      {individualKpis
                        .filter(k => !kpiList.find(kl => kl.id === k.kpi_id))
                        .map(k => (
                          <button key={k.kpi_id}
                            onClick={async () => {
                              if (!companyId || !authUserId) return;
                              try {
                                const created = await importKpiToScope({
                                  kpiId: k.kpi_id,
                                  targetScope: "consolidated",
                                  companyId,
                                  userId: authUserId,
                                });
                                setCompanyKpis(prev => [...prev, created]);
                                addToDashboard(created.kpi_id);
                                setEditingKpi(null);
                              } catch (e) { alert("Import failed: " + e.message); }
                            }}
                            className="text-left p-3 rounded-xl border border-dashed border-[#1a2f8a]/20 hover:border-[#1a2f8a]/40 hover:bg-[#eef1fb] transition-all">
                            <p className="text-xs font-black text-[#1a2f8a]">{k.label}</p>
                            <p className="text-[9px] text-[#1a2f8a]/40 mt-0.5 uppercase tracking-widest">from individual</p>
                          </button>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}