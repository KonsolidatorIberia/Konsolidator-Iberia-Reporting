/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { useTypo, useSettings } from "./SettingsContext";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";
import { t } from "../../lib/i18n";
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
import JSZip from "jszip";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
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

async function loadCustomStandardRows(standardKey) {
  const rows = await sbGet(
    `standard_statement_rows?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag` +
    `&standard_key=eq.${encodeURIComponent(standardKey)}` +
    `&statement=in.(PL,BS)`
  );
  return Array.isArray(rows) ? rows : [];
}

async function loadStandardMapping(standard, groupAccounts) {
let allRows;
  if (standard.startsWith("CUSTOM-")) {
    allRows = await loadCustomStandardRows(standard);
  } else {
    const plTable = STANDARD_TO_PL_TABLE[standard];
    const bsTable = STANDARD_TO_BS_TABLE[standard];
    if (!plTable) return null;
    const [plRows, bsRows] = await Promise.all([
      sbGet(`${plTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`),
      sbGet(`${bsTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`).catch(() => []),
    ]);
    allRows = [...(Array.isArray(plRows) ? plRows : []), ...(Array.isArray(bsRows) ? bsRows : [])];
  }
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

// Resolve which standard applies:
//   1. If activeStandardKey is passed in as a prop (from the router) → use it
//   2. Otherwise if companyId is known → look it up in company_active_standard
//   3. Otherwise → fall back to the code-pattern sniff (detectStandard)
async function resolveStandardKey(companyId, groupAccounts, preResolvedKey) {
  if (preResolvedKey) return preResolvedKey;
  if (companyId) {
    try {
      const rows = await sbGet(
        `company_active_standard?select=standard_key&company_id=eq.${companyId}`
      );
      const boundKey = Array.isArray(rows) && rows[0]?.standard_key;
      if (boundKey) return boundKey;
    } catch { /* fall through to sniff */ }
  }
  return detectStandard(groupAccounts);
}

function useResolvedKpiList(groupAccounts, companyId, preResolvedStandardKey) {
const [state, setState] = useState({ kpiList: [], allKpis: [], ccTagToCodes: new Map(), sectionCodes: new Map(), standard: null, ready: false });
  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, ready: false }));
    (async () => {
      const standard = await resolveStandardKey(companyId, groupAccounts, preResolvedStandardKey);
      if (cancelled) return;
      if (!standard) {
        setState(s => ({ ...s, ready: true, kpiList: [], standard: null }));
        return;
      }
      try {
        const [mapping, fullKpiList] = await Promise.all([
          loadStandardMapping(standard, groupAccounts),
          loadKpiLibrary(standard),
        ]);
        if (cancelled) return;
        const visibleKpis = fullKpiList.filter(k => DEFAULT_VISIBLE_KPI_IDS.has(k.id));
        setState({
          kpiList: visibleKpis,
          allKpis: fullKpiList,
          ccTagToCodes: mapping?.ccTagToCodes ?? new Map(),
          sectionCodes: mapping?.sectionCodes ?? new Map(),
          standard,
          ready: true,
        });
      } catch (e) {
        if (!cancelled) {
          console.error("[KpiResolver] load failed:", e);
          setState(s => ({ ...s, ready: true }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, preResolvedStandardKey, groupAccounts]);
  return state;
}

// ── Formula evaluator ──────────────────────────────────────────────
function pivotSum(pivot, codes) {
  if (!codes || codes.size === 0) return 0;
  let total = 0;
  codes.forEach(code => { total += (pivot.get(code) ?? 0); });
  return total;
}
// ── Party cell formula resolver (ported from StatisticalPartiesPage.jsx) ──
const PARTY_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PARTY_COL_LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L"];
const PARTY_COL_INDEX = Object.fromEntries(PARTY_COL_LETTERS.map((c, i) => [c, i]));
function _partyParseRef(tok) {
  const m = /^([A-La-l])(\d+)$/.exec(tok);
  if (!m) return null;
  const col = PARTY_COL_INDEX[m[1].toUpperCase()];
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { row, col };
}
function _partyTokenize(src) {
  const tokens = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if ("+-*/()%^:,".includes(ch)) { tokens.push({ t: ch }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const asRef = _partyParseRef(word);
      if (asRef) tokens.push({ t: "ref", v: asRef, raw: word });
      else tokens.push({ t: "name", v: word.toUpperCase() });
      i = j; continue;
    }
    return null;
  }
  return tokens;
}
function _partyEvalFormula(formulaStr, computed, dims, resolving) {
  const src = formulaStr.trim().replace(/^=/, "");
  const tokens = _partyTokenize(src);
  if (!tokens) return NaN;
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => { const tok = tokens[pos]; if (tok && tok.t === t) { pos++; return tok; } return null; };
  const resolveRef = (ref) => {
    if (ref.row < 0 || ref.row >= dims.length) return 0;
    const dimCode = dims[ref.row];
    const month = ref.col + 1;
    const key = `${dimCode}:${month}`;
    if (resolving.has(key)) return 0;
    const cached = computed[dimCode]?.[month];
    if (cached != null) return cached;
    return 0;
  };
  const parseExpr = () => {
    let left = parseTerm();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = tokens[pos++].t;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = () => {
    let left = parseFactor();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = tokens[pos++].t;
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parseFactor = () => {
    let val = parseUnary();
    if (peek() && peek().t === "%") { pos++; val = val / 100; }
    if (peek() && peek().t === "^") { pos++; val = Math.pow(val, parseFactor()); }
    return val;
  };
  const parseUnary = () => {
    if (peek() && peek().t === "-") { pos++; return -parseUnary(); }
    if (peek() && peek().t === "+") { pos++; return parseUnary(); }
    return parsePrimary();
  };
  const parsePrimary = () => {
    const tok = peek();
    if (!tok) return 0;
    if (tok.t === "num") { pos++; return tok.v; }
    if (tok.t === "ref") { pos++; return resolveRef(tok.v); }
    if (tok.t === "(") { pos++; const v = parseExpr(); eat(")"); return v; }
    if (tok.t === "name") {
      const name = tok.v; pos++;
      if (!eat("(")) return 0;
      const first = eat("ref");
      if (first && eat(":")) {
        const last = eat("ref");
        eat(")");
        if (!last) return 0;
        const r0 = Math.min(first.v.row, last.v.row);
        const r1 = Math.max(first.v.row, last.v.row);
        const c0 = Math.min(first.v.col, last.v.col);
        const c1 = Math.max(first.v.col, last.v.col);
        const vals = [];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) vals.push(resolveRef({ row: r, col: c }));
        if (name === "SUM") return vals.reduce((s, v) => s + v, 0);
        if (name === "AVG" || name === "AVERAGE") return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        if (name === "MIN") return vals.length ? Math.min(...vals) : 0;
        if (name === "MAX") return vals.length ? Math.max(...vals) : 0;
        return 0;
      }
      const v = parseExpr(); eat(")");
      if (name === "ABS") return Math.abs(v);
      return v;
    }
    return 0;
  };
  try { const r = parseExpr(); return Number.isFinite(r) ? r : NaN; } catch { return NaN; }
}
function evaluatePartyYear(yearVals, dims) {
  const computed = {};
  for (const dim of dims) {
    computed[dim] = {};
    const dimMap = yearVals[dim] ?? {};
    for (const m of PARTY_MONTHS) {
      const cell = dimMap[m];
      if (!cell) continue;
      if (cell.formula == null && cell.value != null) computed[dim][m] = cell.value;
    }
  }
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const dim of dims) {
      const dimMap = yearVals[dim] ?? {};
      for (const m of PARTY_MONTHS) {
        const cell = dimMap[m];
        if (!cell?.formula) continue;
        const key = `${dim}:${m}`;
        const resolving = new Set([key]);
        const v = _partyEvalFormula(cell.formula, computed, dims, resolving);
        const prev = computed[dim][m];
        if (Number.isFinite(v) && prev !== v) { computed[dim][m] = v; changed = true; }
      }
    }
    if (!changed) break;
  }
  return computed;
}

function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;
  if (node.type === "accountGroup" && (node.dimGroup || node.dimCode)) {
  }
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
        // Variation overrides: if the pivot has a variation scope and the
        // current KPI defines variations for it, per-letter nodes can be swapped.
        const scope = pivot.__variationScope;
        const variations = pivot.__currentKpiVariations;
Object.entries(node.variables).forEach(([letter, varNode]) => {
          let effectiveNode = varNode;
if (scope && variations) {
            const map = scope.kind === "company" ? variations.byCompany : (scope.kind === "dimension" ? variations.byDimension : null);
            const override = map?.[scope.key]?.[letter];
            if (override) {
              let normalized = override;
              if (override.prefix && typeof override.prefix === "string" && override.prefix.includes(":::") && !override.dimGroup && !override.dimCode) {
                const [p, g, c] = override.prefix.split(":::");
                normalized = { ...override, prefix: p, dimGroup: g, dimCode: c };
              } else if (override.accountCode && typeof override.accountCode === "string" && override.accountCode.includes(":::") && !override.dimGroup && !override.dimCode) {
                const [a, g, c] = override.accountCode.split(":::");
                normalized = { ...override, accountCode: a, dimGroup: g, dimCode: c };
              }
              effectiveNode = normalized;
            }
          }
          const v = effectiveNode ? evalFormulaWithCcTags(effectiveNode, pivot, cache, kpiList, ccTagToCodes, sectionCodes) : 0;
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
case "account": {
      let t = 0;
      // Node may carry {accountCode, dimGroup, dimCode} for scoped variations.
      // Also handle legacy "accountCode:::dimGroup:::dimCode" packed into accountCode.
      let ac = node.accountCode ?? "";
      let dg = node.dimGroup, dc = node.dimCode;
      if (typeof ac === "string" && ac.includes(":::") && !dg && !dc) {
        const [a, g, c] = ac.split(":::"); ac = a; dg = g || undefined; dc = c || undefined;
      }
      if (dg && dc) {
        const key = `${ac}:::${dg}:::${dc}`;
        t = pivot.__dimPivot?.get(key) ?? 0;
      } else {
        pivot.forEach((v, k) => { if (k === ac) t += v; });
      }
      return -t;
    }
case "accountGroup": {
      let t = 0;
      let code = String(node.prefix ?? "");
      let dg = node.dimGroup, dc = node.dimCode;
      console.log("[varAG-entry]", "node:", node, "code:", code, "dg:", dg, "dc:", dc);
      if (code.includes(":::") && !dg && !dc) {
        const [a, g, c] = code.split(":::"); code = a; dg = g || undefined; dc = c || undefined;
        console.log("[varAG-parsed]", "code:", code, "dg:", dg, "dc:", dc);
      }
if (!code) return 0;
if (dg && dc) {
        const descendants = pivot.__descendants?.get(code);
        const bases = new Set(descendants ?? []);
        if (bases.size === 0) bases.add(code);
        pivot.__dimPivot?.forEach((v, key) => {
          const [ac, grp, cd] = key.split(":::");
          if (grp === dg && cd === dc && bases.has(ac)) t += v;
        });
        return -t;
      }
      // Prefer the direct row for sum accounts (post-eliminations, matches Sabana).
      // Fall back to summing descendants only if the sum account has no direct row.
      if (pivot.has(code)) {
        t = pivot.get(code);
      } else {
        const descendants = pivot.__descendants?.get(code);
        if (descendants && descendants.length > 0) {
          descendants.forEach(d => { if (pivot.has(d)) t += pivot.get(d); });
        }
      }
      if (t === 0 && !pivot.__descendants?.has(code)) {
        pivot.forEach((v, ac) => { if (ac.startsWith(code)) t += v; });
      }
      return -t;
    }
case "party": {
      // Statistical party (partida estadística). Consolidated scope: a
      // sharedAcrossCompanies party is a group-wide metric (counted once);
      // a per-company party sums its per-company values across every company
      // in ctx.companies. On a subsidiary column ctx.companies is [that co].
      if (!pivot.__parties || !pivot.__partyContext) return 0;
      const party = pivot.__parties.get(node.partyId);
      if (!party) return 0;
      const ctx = pivot.__partyContext;
      const companies = (ctx.companies && ctx.companies.length)
        ? ctx.companies
        : (ctx.company ? [ctx.company] : []);
      const dims = party.dims || [];
      const sumTree = (yearTree, cacheScope) => {
        const yearMap = yearTree?.[String(ctx.year)];
        if (!yearMap) return 0;
        const cacheKey = `party:${node.partyId}:${cacheScope}:${ctx.year}`;
        let computed = cache.get(cacheKey);
        if (!computed) {
          computed = evaluatePartyYear(yearMap, dims);
          cache.set(cacheKey, computed);
        }
        const dimList = (ctx.selectedDims && ctx.selectedDims.size > 0)
          ? dims.filter(d => ctx.selectedDims.has(d))
          : dims;
        const dimsToSum = node.dimCode ? [node.dimCode] : dimList;
        let t = 0;
        for (const dim of dimsToSum) {
          const v = computed[dim]?.[ctx.month];
          if (typeof v === "number") t += v;
        }
        return t;
      };
      if (party.sharedAcrossCompanies !== false) return sumTree(party.values ?? {}, "_shared");
      let total = 0;
      for (const co of companies) {
        if (party.companies?.length && !party.companies.includes(co)) continue;
        total += sumTree(party.values?.[co] ?? {}, co);
      }
      return total;
    }
    default: return 0;
  }
}

function computeAllKpisResolved(visibleKpis, pivot, ccTagToCodes, sectionCodes, allKpis) {
  const refList = allKpis ?? visibleKpis;
  const cache = new Map();
  visibleKpis.forEach(kpi => {
    if (!cache.has(kpi.id)) {
      // Inject the current KPI's variations so the "text" case can pick per-scope overrides.
pivot.__currentKpiVariations = kpi.variations ?? null;
      if (kpi.variations) console.log("[computeAllKpis]", "kpi:", kpi.label, "variations:", JSON.stringify(kpi.variations));
      const val = evalFormulaWithCcTags(kpi.formula, pivot, cache, refList, ccTagToCodes, sectionCodes);
      cache.set(kpi.id, val);
    }
  });
  pivot.__currentKpiVariations = null;
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

function getPresets(tt) {
  return [
    { label: tt("slot_account_group_sum", "Account Group sum"),          formula: { type: "text", expression: "A",           variables: { A: null } } },
      { label: tt("slot_single_account_en", "Single account"),             formula: { type: "text", expression: "A",           variables: { A: null } } },
      { label: "A ÷ B (ratio/margin)",       formula: { type: "text", expression: "A / B",       variables: { A: null, B: null } } },
      { label: "A − B (variance)",           formula: { type: "text", expression: "A - B",       variables: { A: null, B: null } } },
      { label: "(A ÷ B) × 100 (percent)",    formula: { type: "text", expression: "(A / B) * 100", variables: { A: null, B: null } } },
      { label: "Negate value (−A)",          formula: { type: "text", expression: "-A",          variables: { A: null } } },
      { label: tt("slot_kpi_reference",  "KPI reference"),              formula: { type: "text", expression: "A",           variables: { A: null } } },
      { label: tt("slot_fixed_number",   "Fixed number"),               formula: { type: "text", expression: "0",           variables: {} } },
  ];
}

/* ── Rich export helpers (ported from KpiIndividualesPage) ────────────
 * Pure functions used by PDF/Excel exports to describe KPIs, formulas
 * and benchmark bands in human-readable form. Consolidated variant
 * uses "Account" (no "Local Account" concept at group level).
 * ------------------------------------------------------------------ */

async function repairXlsxDimensions(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  for (const f of sheets) {
    let xml = await zip.file(f).async("string");

    // (1) Strip Infinity / NaN cell values — ExcelJS writes them as invalid XML
    //     and Excel pops the "we found a problem with content" recovery dialog
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>-?Infinity<\/v><\/c>/g, "");
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>NaN<\/v><\/c>/g, "");

    // (2) Strip collapsed="1" from grouped row members — only valid on the
    //     summary row, ExcelJS incorrectly puts it on every grouped row
    xml = xml.replace(/(<row[^>]*outlineLevel="\d+"[^>]*?)\s*collapsed="1"/g, "$1");

    // (3) Fix the bogus x14ac:dyDescent="55" that ExcelJS sometimes writes
    xml = xml.replace(/x14ac:dyDescent="55"/g, 'x14ac:dyDescent="0.25"');

    // (4) Recompute dimension based on actual cells
    const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"/g)];
    if (cells.length > 0) {
      const cs = cells.map(c => colToNum(c[1]));
      const rs = cells.map(c => +c[2]);
      const newDim = `${numToCol(Math.min(...cs))}${Math.min(...rs)}:${numToCol(Math.max(...cs))}${Math.max(...rs)}`;
      xml = xml.replace(/<dimension ref="[^"]+"\s*\/>/, `<dimension ref="${newDim}"/>`);
    }

    zip.file(f, xml);
  }
  return await zip.generateAsync({ type: "arraybuffer" });
}

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

async function exportKpisToXlsx({
  kpiList, kpiListCompany, kpiListDimension, kpiListFull,
  companyCodes, companyLabels, companyResults, companyResultsCmp,
  dimensionCodes, dimensionResults, dimensionResultsCmp, dimensionPivots,
  graphSections, filters, exportOpts = {}, accountCodeLabels = new Map(),
}) {
  const kListCompany   = kpiListCompany   ?? kpiList;
  const kListDimension = kpiListDimension ?? kpiList;
  // For ref-node label lookups, use the full library — even system KPIs
  // not on the current dashboard need to resolve to their friendly label.
  const kListForRefs   = kpiListFull ?? kpiList;
  const C = EXPORT_COLORS;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Konsolidator";
  wb.created = new Date();

const inlineDefs = exportOpts.inlineDefs !== false;
  const cmpEnabled = !!filters?.compareMode;

  const fmtBenchRange = (r) => {
    if (!r) return "—";
    const min = r.min !== "" && r.min !== undefined && r.min !== null ? r.min : null;
    const max = r.max !== "" && r.max !== undefined && r.max !== null ? r.max : null;
    if (min !== null && max !== null) return `${min} → ${max}`;
    if (min !== null) return `> ${min}`;
    if (max !== null) return `< ${max}`;
    return "—";
  };

  const BENCH_HEAD = {
    unhealthy: { label: "Unhealthy", hdrBg: "FFB91C1C", cellBg: "FFFEF2F2", text: "FFB91C1C" },
    healthy:   { label: "Healthy",   hdrBg: "FF15803D", cellBg: "FFF0FDF4", text: "FF15803D" },
    vhealthy:  { label: "Excellent", hdrBg: "FF1E40AF", cellBg: "FFEFF6FF", text: "FF1E40AF" },
  };

const addKpiMatrixSheet = (sheetName, titleText, cols, colLabels, sections, kList) => {
    // sections = [{ label, resultsMap, cmpResultsMap }, …]
    const anyCmp = cmpEnabled && sections.some(s => s.cmpResultsMap);
    const subColsPerCol = anyCmp ? 4 : 1;
    const totalAvgCol = 1 + cols.length * subColsPerCol + 1;
    const benchUnhCol = totalAvgCol + 1;
    const benchHCol   = totalAvgCol + 2;
    const benchVHCol  = totalAvgCol + 3;
    const totalCols   = benchVHCol;

    const subLines = buildFilterLines(filters);
    const frozenY  = 1 + subLines.length + 1; // title + subs + spacer

const ws = wb.addWorksheet(sheetName, {
      views: [{ state: "frozen", xSplit: 1, ySplit: frozenY }],
      properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
    });
    ws.properties.outlineLevelRow = 1;
    ws.properties.outlineLevelCol = 0;
    ws.properties.summaryBelow    = false;
    ws.properties.summaryRight    = false;

    // Title
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = titleText;
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 28;

    // Subtitle lines
    subLines.forEach((line, idx) => {
      const rowN = 2 + idx;
      ws.mergeCells(rowN, 1, rowN, totalCols);
      const c = ws.getCell(rowN, 1);
      c.value = line;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      c.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
      c.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
      ws.getRow(rowN).height = 18;
    });

    const spacerRow = 2 + subLines.length;
    ws.getRow(spacerRow).height = 6;
    let curRow = spacerRow + 1;

    // Section accent colors: YTD navy, Monthly pink
    const SECTION_COLORS = [C.primary, "FFCF305D"];

    sections.forEach((section, sIdx) => {
const sectAccent = C.primary;                                          // headers always navy (clear contrast with Cmp pink)
      const sectBarBg  = SECTION_COLORS[sIdx % SECTION_COLORS.length]; // section divider bar color (YTD navy, Monthly pink)
      const resultsMap    = section.resultsMap;
      const cmpResultsMap = section.cmpResultsMap;
      const showCmp       = anyCmp && cmpResultsMap;

      // Section divider bar (only when multiple sections)
      if (sections.length > 1) {
        ws.mergeCells(curRow, 1, curRow, totalCols);
        const lbl = ws.getCell(curRow, 1);
        lbl.value = section.label;
lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectBarBg } };
        lbl.font = { name: "Calibri", size: 12, bold: true, color: { argb: C.white } };
        lbl.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(curRow).height = 24;
        curRow++;
      }

      // Headers
      if (showCmp) {
        const r1 = curRow, r2 = curRow + 1;
        const superRow = ws.getRow(r1);
        superRow.height = 22;
        const kpiSuper = superRow.getCell(1);
        kpiSuper.value = "KPI";
        kpiSuper.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        kpiSuper.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        kpiSuper.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.mergeCells(r1, 1, r2, 1);
        cols.forEach((_, i) => {
          const startCol = 2 + i * 4;
          const cell = superRow.getCell(startCol);
          cell.value = colLabels[i];
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
          cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          ws.mergeCells(r1, startCol, r1, startCol + 3);
        });
        const totalSuper = superRow.getCell(totalAvgCol);
        totalSuper.value = "Total / Avg";
        totalSuper.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        totalSuper.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        totalSuper.alignment = { vertical: "middle", horizontal: "center" };
        ws.mergeCells(r1, totalAvgCol, r2, totalAvgCol);
        [["unhealthy", benchUnhCol], ["healthy", benchHCol], ["vhealthy", benchVHCol]].forEach(([key, col]) => {
          const cell = superRow.getCell(col);
          cell.value = BENCH_HEAD[key].label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BENCH_HEAD[key].hdrBg } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          ws.mergeCells(r1, col, r2, col);
        });
        const subRow = ws.getRow(r2);
        subRow.height = 18;
        cols.forEach((_, i) => {
          const startCol = 2 + i * 4;
          ["A", "Cmp", "Δ", "Δ %"].forEach((lbl, j) => {
            const c = subRow.getCell(startCol + j);
            c.value = lbl;
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: j === 0 ? sectAccent : (j === 1 ? C.compareB : C.primaryDk) } };
            c.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
            c.alignment = { vertical: "middle", horizontal: "center" };
          });
        });
        curRow = r2 + 1;
      } else {
        const headerRow = ws.getRow(curRow);
        headerRow.height = 24;
        const kpiCell = headerRow.getCell(1);
        kpiCell.value = "KPI";
        kpiCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        kpiCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        kpiCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        colLabels.forEach((label, i) => {
          const cell = headerRow.getCell(2 + i);
          cell.value = label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "right" };
        });
        const totalCell = headerRow.getCell(totalAvgCol);
        totalCell.value = "Total / Avg";
        totalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        totalCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        totalCell.alignment = { vertical: "middle", horizontal: "center" };
        [["unhealthy", benchUnhCol], ["healthy", benchHCol], ["vhealthy", benchVHCol]].forEach(([key, col]) => {
          const cell = headerRow.getCell(col);
          cell.value = BENCH_HEAD[key].label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BENCH_HEAD[key].hdrBg } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });
        curRow++;
      }

      // Data rows
kList.forEach((kpi, rowIdx) => {
        const bandColor = rowIdx % 2 === 0 ? C.band1 : C.band2;

        // Per-variable values for this section (only for text-formula KPIs).
        // varsMap: Map<col, Map<kpiId, Map<letter, number>>>
        const varsForKpiByCol = new Map(); // col -> Map<letter, number>
        cols.forEach(col => {
          const perKpi = section.varsMap?.get(col);
          const perLetter = perKpi?.get(kpi.id);
          if (perLetter && perLetter.size > 0) varsForKpiByCol.set(col, perLetter);
        });
        // Union of letters actually used across all columns for this KPI.
        const letters = [];
        {
          const seen = new Set();
          varsForKpiByCol.forEach(m => m.forEach((_, L) => { if (!seen.has(L)) { seen.add(L); letters.push(L); } }));
          letters.sort();
        }
// Flatten formula (works for both text-form and AST-form KPIs).
        const flat = flattenFormulaToTextForm(kpi.formula);
        const hasFormula = flat && letters.length > 0 && flat.expression;
        const expression = hasFormula
          ? flat.expression.replace(/^\s*=\s*/, "")
          : null;

        const values = cols.map(col => {
          const res = resultsMap?.get(col);
          if (!res) return null;
          const v = res.get(kpi.id);
          return Number.isFinite(v) ? v : null;
        });
        const cmpValues = showCmp ? cols.map(col => {
          const res = cmpResultsMap.get(col);
          if (!res) return null;
          const v = res.get(kpi.id);
          return Number.isFinite(v) ? v : null;
        }) : null;

        const validVals = values.filter(v => v !== null);
        const aggregateRaw = validVals.length === 0 ? null
          : kpi.format === "percent"
            ? validVals.reduce((a, b) => a + b, 0) / validVals.length
            : validVals.reduce((a, b) => a + b, 0);
        const aggregate = Number.isFinite(aggregateRaw) ? aggregateRaw : null;

const dataRowNum = curRow;
        // Pre-compute where each variable row will live so the KPI row's
        // formula cells can reference them. Description only appears on the
        // first section (sIdx === 0), so only account for it there.
        const varRowByLetter = new Map();
        if (hasFormula) {
          let base = dataRowNum + 1 + (sIdx === 0 && kpi.description ? 1 : 0);
          letters.forEach((L, i) => varRowByLetter.set(L, base + i));
        }

        const kpiType = kpi._isOverridden
          ? { label: "EDITED", color: "FF7C3AED" }
          : (kpi._kpiType === "custom" || kpi._createdBy)
            ? { label: "CUSTOM", color: "FF15803D" }
            : { label: "SYSTEM", color: "FF6B7280" };
        const labelCell = ws.getCell(dataRowNum, 1);
        labelCell.value = {
          richText: [
            { text: kpi.label, font: { name: "Calibri", size: 11, bold: true, color: { argb: C.primary } } },
            { text: `   ${kpiType.label}`, font: { name: "Calibri", size: 8, bold: true, color: { argb: kpiType.color } } },
          ]
        };
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bandColor } };
        labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

        // Build the Excel formula string for a given column, substituting each
        // variable letter with a cell reference into that column's variable row.
        const buildExcelFormula = (colLetter, colIdx) => {
          if (!hasFormula) return null;
          if (!varsForKpiByCol.has(cols[colIdx])) return null;
          // Substitute LETTER → "{colLetter}{varRow}". Match whole-letter tokens
          // only (avoid replacing letters inside function names like SUM/ABS).
          let expr = expression;
          letters.forEach(L => {
            const row = varRowByLetter.get(L);
            if (!row) return;
            expr = expr.replace(new RegExp(`\\b${L}\\b`, "g"), `${colLetter}${row}`);
          });
          return "=" + expr;
        };

        const writeNumCell = (rowN, colN, val, format, fillArgb, opts = {}) => {
          const cell = ws.getCell(rowN, colN);
          if (opts.formula) {
            cell.value = { formula: opts.formula, result: Number.isFinite(val) ? val : 0 };
            cell.numFmt = format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
            cell.font = {
              name: "Calibri", size: 10, bold: !!opts.bold,
              color: { argb: opts.colorOverride ?? ((val ?? 0) < 0 ? C.red : (format === "percent" && (val ?? 0) >= 0 ? C.green : C.primary)) },
            };
          } else if (!Number.isFinite(val)) {
            cell.value = "—";
            cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: !!opts.bold };
          } else {
            cell.value = val;
            cell.numFmt = format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
            cell.font = {
              name: "Calibri", size: 10, bold: !!opts.bold,
              color: { argb: opts.colorOverride ?? (val < 0 ? C.red : (format === "percent" && val >= 0 ? C.green : C.primary)) },
            };
          }
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
          cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
          cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
        };

        // Convert an Excel column index (1-based) to letter(s): 1→A, 27→AA, …
        const colToLetter = (n) => {
          let s = "";
          while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
          return s;
        };

if (kpi.id === "revenue" || kpi.id === "gross_profit") {
          console.log("[cell]", kpi.label, "dataRowNum:", dataRowNum, "varRowByLetter:", [...varRowByLetter.entries()], "values:", values, "hasFormula:", hasFormula);
        }
        cols.forEach((_, i) => {
          if (showCmp) {
            const startCol = 2 + i * 4;
            const a = values[i];
            const c = cmpValues[i];
            const deltaRaw    = (a !== null && c !== null) ? a - c : null;
            const deltaPctRaw = (a !== null && c !== null && kpi.format !== "percent" && Math.abs(c) > 1e-9) ? ((a - c) / Math.abs(c)) * 100 : null;
            const delta    = Number.isFinite(deltaRaw)    ? deltaRaw    : null;
            const deltaPct = Number.isFinite(deltaPctRaw) ? deltaPctRaw : null;
            const primaryFormula = buildExcelFormula(colToLetter(startCol), i);
            writeNumCell(dataRowNum, startCol,     a, kpi.format, bandColor, primaryFormula ? { formula: primaryFormula } : {});
            writeNumCell(dataRowNum, startCol + 1, c, kpi.format, bandColor, { colorOverride: c !== null && c < 0 ? C.red : C.compareB });
            writeNumCell(dataRowNum, startCol + 2, delta, kpi.format, bandColor, { colorOverride: delta === null ? null : (delta < 0 ? C.red : C.green) });
            const pctCell = ws.getCell(dataRowNum, startCol + 3);
            if (deltaPct === null) {
              pctCell.value = "—";
              pctCell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 } };
            } else {
              pctCell.value = deltaPct;
              pctCell.numFmt = '0.0"%"';
              pctCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: deltaPct < 0 ? C.red : C.green } };
            }
            pctCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bandColor } };
            pctCell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
            pctCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
          } else {
            const colN = 2 + i;
            const f = buildExcelFormula(colToLetter(colN), i);
            writeNumCell(dataRowNum, colN, values[i], kpi.format, bandColor, f ? { formula: f } : {});
          }
        });

        writeNumCell(dataRowNum, totalAvgCol, aggregate, kpi.format, C.highlight, { bold: true });

        // Benchmark columns
        [["unhealthy", benchUnhCol], ["healthy", benchHCol], ["vhealthy", benchVHCol]].forEach(([key, col]) => {
          const cell = ws.getCell(dataRowNum, col);
          const txt = fmtBenchRange(kpi.benchmark?.[key]);
          cell.value = txt;
          cell.font = { name: "Calibri", size: 10, bold: txt !== "—", color: { argb: txt === "—" ? C.gray400 : BENCH_HEAD[key].text } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BENCH_HEAD[key].cellBg } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
        });

        curRow++;

        // ── Trailers: description + one row per variable (per section) ──
        if (inlineDefs) {
         const fSum = kpiFormulaSummary(kpi, kListForRefs, accountCodeLabels);
          const trailerBg = "FFF8F9FF";
          const addTextTrailer = (label, value, accentArgb) => {
            if (!value) return;
            const r = ws.getRow(curRow);
            r.height = 16;
            r.outlineLevel = 1;
            r.hidden = true;
            const cell = r.getCell(1);
            cell.value = {
              richText: [
                { text: `  ${label}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: accentArgb } } },
                { text: value, font: { name: "Calibri", size: 9, color: { argb: "FF374151" } } },
              ]
            };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
            cell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
            for (let cc = 2; cc <= totalCols; cc++) {
              const blank = r.getCell(cc);
              blank.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
              blank.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
            }
            curRow++;
          };
          // Description (once, on first section only, so it doesn't duplicate)
          if (sIdx === 0 && kpi.description) addTextTrailer("DESCRIPTION", kpi.description, C.gray500);

          // Variable rows — one per letter, with per-column numeric values.
          if (hasFormula) {
            letters.forEach(L => {
              const r = ws.getRow(curRow);
              r.height = 16;
              r.outlineLevel = 1;
              r.hidden = true;
              // Label: "  A = Net Result"
              const desc = fSum.variables.find(v => v.letter === L)?.desc ?? "";
              const cell = r.getCell(1);
              cell.value = {
                richText: [
                  { text: `    ${L}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: C.primary } } },
                  { text: `= ${desc}`,  font: { name: "Calibri", size: 9, color: { argb: "FF374151" } } },
                ]
              };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
              cell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
              cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
              // Per-column values
              cols.forEach((col, i) => {
                const v = varsForKpiByCol.get(col)?.get(L);
                if (showCmp) {
                  const startCol = 2 + i * 4;
                  writeNumCell(curRow, startCol, Number.isFinite(v) ? v : null, "", trailerBg);
                  // leave compare/delta/% blank for variable rows
                  [startCol + 1, startCol + 2, startCol + 3].forEach(cc => {
                    const b = r.getCell(cc);
                    b.value = "";
                    b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
                    b.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
                  });
                } else {
                  writeNumCell(curRow, 2 + i, Number.isFinite(v) ? v : null, "", trailerBg);
                }
              });
              // Blank fills for total/bench cols
              for (let cc = totalAvgCol; cc <= totalCols; cc++) {
                const b = r.getCell(cc);
                b.value = "";
                b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
                b.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
              }
              curRow++;
            });
} else if (fSum.expression) {
            // No text-formula variables — show the formula description on
            // every section so both YTD and Monthly get their own +/- toggle.
            addTextTrailer("FORMULA", fSum.expression, C.primary);
          }
        }
      });

      // Spacer between sections
      if (sIdx < sections.length - 1) {
        ws.getRow(curRow).height = 14;
        curRow++;
      }
    });

    // Column widths
    ws.getColumn(1).width = 42;
    if (anyCmp) {
      for (let i = 0; i < cols.length; i++) {
        ws.getColumn(2 + i * 4).width     = 16;
        ws.getColumn(2 + i * 4 + 1).width = 14;
        ws.getColumn(2 + i * 4 + 2).width = 12;
        ws.getColumn(2 + i * 4 + 3).width = 10;
      }
    } else {
      for (let i = 2; i <= 1 + cols.length; i++) ws.getColumn(i).width = 18;
    }
    ws.getColumn(totalAvgCol).width = 16;
    ws.getColumn(benchUnhCol).width = 14;
    ws.getColumn(benchHCol).width   = 14;
    ws.getColumn(benchVHCol).width  = 14;
  };

if (companyCodes && companyCodes.length > 0 && companyResults?.ytd) {
    const labels = (companyLabels && companyLabels.length === companyCodes.length) ? companyLabels : companyCodes;
addKpiMatrixSheet("Company KPIs", "KPI Dashboard — By Company",
      companyCodes, labels,
      [
        { label: "YTD · Year-to-Date",     resultsMap: companyResults.ytd,     cmpResultsMap: companyResultsCmp?.ytd     ?? null, varsMap: companyResults.ytdVars     },
        { label: "Monthly · Period Delta", resultsMap: companyResults.monthly, cmpResultsMap: companyResultsCmp?.monthly ?? null, varsMap: companyResults.monthlyVars },
      ], kListCompany);
  }

  if (dimensionCodes && dimensionCodes.length > 0 && dimensionResults?.ytd) {
    const dimLabels = dimensionCodes.map(dc => dimensionPivots?.get(dc)?.name ?? dc);
addKpiMatrixSheet("Dimension KPIs", "KPI Dashboard — By Dimension",
      dimensionCodes, dimLabels,
      [
        { label: "YTD · Year-to-Date",     resultsMap: dimensionResults.ytd,     cmpResultsMap: dimensionResultsCmp?.ytd     ?? null, varsMap: dimensionResults.ytdVars     },
        { label: "Monthly · Period Delta", resultsMap: dimensionResults.monthly, cmpResultsMap: dimensionResultsCmp?.monthly ?? null, varsMap: dimensionResults.monthlyVars },
      ], kListDimension);
  }

// ── KPI Definitions sheet ──
  if (exportOpts.defsSheet !== false) {
    const dws = wb.addWorksheet("KPI Definitions", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });

    // Category color palette
    const catColor = (cat) => {
      const c = String(cat ?? "").toLowerCase();
      if (c.includes("p&l") || c.includes("p/l")) return { bg: "FFE0E7FF", fg: "FF1a2f8a" };
      if (c.includes("ratio")) return { bg: "FFD1FAE5", fg: "FF065F46" };
      if (c.includes("test"))  return { bg: "FFFED7AA", fg: "FF9A3412" };
      if (c.includes("custom"))return { bg: "FFEDE9FE", fg: "FF5B21B6" };
      return { bg: "FFF3F4F6", fg: "FF374151" };
    };
    const fmtColor = (fmt) => {
      const f = String(fmt ?? "").toLowerCase();
      if (f === "percent") return { bg: "FFDBEAFE", fg: "FF1E3A8A" };
      if (f === "currency") return { bg: "FFD1FAE5", fg: "FF065F46" };
      if (f === "number") return { bg: "FFF3F4F6", fg: "FF374151" };
      return { bg: "FFF3F4F6", fg: "FF374151" };
    };
    // Consistent color palette for per-company / per-dim pills
    const pillColors = ["FFDBEAFE", "FFFDE68A", "FFFECACA", "FFD1FAE5", "FFEDE9FE", "FFFED7AA", "FFCFFAFE"];
    const pillFgs   = ["FF1E3A8A", "FF854D0E", "FF991B1B", "FF065F46", "FF5B21B6", "FF9A3412", "FF155E75"];
    const pillFor = (name) => {
      let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      const idx = h % pillColors.length;
      return { bg: pillColors[idx], fg: pillFgs[idx] };
    };

    // Title band
    dws.mergeCells(1, 1, 1, 6);
    const dTitle = dws.getCell(1, 1);
    dTitle.value = "KPI Definitions · Formulas · Benchmarks";
    dTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    dTitle.font = { name: "Calibri", size: 15, bold: true, color: { argb: C.white } };
    dTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    dws.getRow(1).height = 32;

    // Subtitle
    dws.mergeCells(2, 1, 2, 6);
    const dSub = dws.getCell(2, 1);
    dSub.value = "Reference sheet for every KPI, its formula composition, per-scope variations and benchmark thresholds.";
    dSub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B54B8" } };
    dSub.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FFE0E7FF" } };
    dSub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    dws.getRow(2).height = 20;

    // Header
    const dHead = dws.getRow(3);
    dHead.height = 26;
    ["KPI", "Category", "Format", "Formula · Variables", "Variations", "Benchmark"].forEach((h, i) => {
      const cell = dHead.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      cell.border = { bottom: { style: "medium", color: { argb: C.primary } } };
    });

// Union of both views' KPIs, deduped by id, so definitions cover everything.
    const _allKpisForDefs = (() => {
      const seen = new Set();
      const out = [];
      [...kListCompany, ...kListDimension].forEach(k => {
        if (!seen.has(k.id)) { seen.add(k.id); out.push(k); }
      });
      return out;
    })();
_allKpisForDefs.forEach((kpi, i) => {
      const r = dws.getRow(4 + i);
      const band = i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFF";
      const fSum = kpiFormulaSummary(kpi, kpiList, accountCodeLabels);
      const bDesc = describeBenchmark(kpi.benchmark);
      const cat = catColor(kpi.category);
      const fmt = fmtColor(kpi.format);

      // Col 1 — KPI label
      const cLabel = r.getCell(1);
      cLabel.value = kpi.label;
      cLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      cLabel.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.primary } };
      cLabel.alignment = { vertical: "top", horizontal: "left", indent: 1, wrapText: true };
      cLabel.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "hair", color: { argb: "FFF3F4F6" } } };

      // Col 2 — Category pill
      const cCat = r.getCell(2);
      cCat.value = kpi.category ?? "—";
      cCat.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kpi.category ? cat.bg : band } };
      cCat.font = { name: "Calibri", size: 9, bold: true, color: { argb: kpi.category ? cat.fg : "FF9CA3AF" } };
      cCat.alignment = { vertical: "top", horizontal: "center", wrapText: true };
      cCat.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "hair", color: { argb: "FFF3F4F6" } } };

      // Col 3 — Format pill
      const cFmt = r.getCell(3);
      cFmt.value = kpi.format ?? "—";
      cFmt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kpi.format ? fmt.bg : band } };
      cFmt.font = { name: "Calibri", size: 9, bold: true, color: { argb: kpi.format ? fmt.fg : "FF9CA3AF" } };
      cFmt.alignment = { vertical: "top", horizontal: "center", wrapText: true };
      cFmt.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "hair", color: { argb: "FFF3F4F6" } } };

      // Col 4 — Formula · Variables (rich text)
      const cFormula = r.getCell(4);
      const richFormula = [];
      if (fSum.expression) {
        richFormula.push({ text: "Formula   ", font: { name: "Calibri", size: 9, bold: true, color: { argb: "FF6B7280" } } });
        richFormula.push({ text: `${fSum.expression}\n`, font: { name: "Consolas", size: 11, bold: true, color: { argb: C.primary } } });
      }
      if (fSum.variables.length > 0) {
        fSum.variables.forEach(v => {
          richFormula.push({ text: `\n${v.letter}`, font: { name: "Consolas", size: 10, bold: true, color: { argb: "FFCF305D" } } });
          richFormula.push({ text: `   ${v.desc}`, font: { name: "Calibri", size: 10, color: { argb: "FF374151" } } });
        });
      }
      if (kpi.description) {
        richFormula.push({ text: "\n\n" });
        richFormula.push({ text: `${kpi.description}`, font: { name: "Calibri", size: 9, italic: true, color: { argb: "FF6B7280" } } });
      }
      if (richFormula.length === 0) richFormula.push({ text: "—", font: { name: "Calibri", size: 10, color: { argb: "FFD1D5DB" } } });
      cFormula.value = { richText: richFormula };
      cFormula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      cFormula.alignment = { vertical: "top", horizontal: "left", indent: 1, wrapText: true };
      cFormula.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "hair", color: { argb: "FFF3F4F6" } } };

      // Col 5 — Variations (rich text)
      const cVars = r.getCell(5);
      const richVars = [];
      const byCo = kpi.variations?.byCompany ?? {};
      const byDim = kpi.variations?.byDimension ?? {};
      const coEntries = Object.entries(byCo);
      const dimEntries = Object.entries(byDim);
      if (coEntries.length === 0 && dimEntries.length === 0) {
        richVars.push({ text: "—", font: { name: "Calibri", size: 10, color: { argb: "FFD1D5DB" } } });
      } else {
        if (coEntries.length > 0) {
          richVars.push({ text: "By Company\n", font: { name: "Calibri", size: 8, bold: true, color: { argb: "FF9CA3AF" } } });
          coEntries.forEach(([co, letters]) => {
            const pill = pillFor(co);
            Object.entries(letters ?? {}).forEach(([letter, node]) => {
              if (!node) return;
              richVars.push({ text: `  ${co}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: pill.fg } } });
              richVars.push({ text: `${letter}`, font: { name: "Consolas", size: 9, bold: true, color: { argb: "FFCF305D" } } });
              richVars.push({ text: ` → ${describeFormulaNode(node, kpiList, accountCodeLabels)}\n`, font: { name: "Calibri", size: 9, color: { argb: "FF374151" } } });
            });
          });
        }
        if (dimEntries.length > 0) {
          if (coEntries.length > 0) richVars.push({ text: "\n" });
          richVars.push({ text: "By Dimension\n", font: { name: "Calibri", size: 8, bold: true, color: { argb: "FF9CA3AF" } } });
          dimEntries.forEach(([dim, letters]) => {
            const pill = pillFor(dim);
            Object.entries(letters ?? {}).forEach(([letter, node]) => {
              if (!node) return;
              richVars.push({ text: `  ${dim}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: pill.fg } } });
              richVars.push({ text: `${letter}`, font: { name: "Consolas", size: 9, bold: true, color: { argb: "FFCF305D" } } });
              richVars.push({ text: ` → ${describeFormulaNode(node, kpiList, accountCodeLabels)}\n`, font: { name: "Calibri", size: 9, color: { argb: "FF374151" } } });
            });
          });
        }
      }
      cVars.value = { richText: richVars };
      cVars.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      cVars.alignment = { vertical: "top", horizontal: "left", indent: 1, wrapText: true };
      cVars.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "hair", color: { argb: "FFF3F4F6" } } };

      // Col 6 — Benchmark (rich text)
      const cBench = r.getCell(6);
      const bench = kpi.benchmark ?? {};
      const hasBench = bench && (bench.malo || bench.saludable || bench.excelente);
      const richBench = [];
      if (!hasBench) {
        richBench.push({ text: "—", font: { name: "Calibri", size: 10, color: { argb: "FFD1D5DB" } } });
      } else {
        const rangeStr = (r) => {
          if (!r) return null;
          const mn = r.min ?? r.from ?? null;
          const mx = r.max ?? r.to ?? null;
          if (mn == null && mx == null) return null;
          if (mn != null && mx != null) return `${mn} – ${mx}`;
          if (mn != null) return `≥ ${mn}`;
          return `≤ ${mx}`;
        };
        const addRow = (label, range, bg, fg) => {
          const s = rangeStr(range);
          if (!s) return;
          richBench.push({ text: `  ${label}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: fg } } });
          richBench.push({ text: `${s}\n`, font: { name: "Consolas", size: 10, color: { argb: "FF374151" } } });
        };
        addRow("MALO",      bench.malo,      "FFFEE2E2", "FF991B1B");
        addRow("SALUDABLE", bench.saludable, "FFD1FAE5", "FF065F46");
        addRow("EXCELENTE", bench.excelente, "FFDBEAFE", "FF1E3A8A");
        if (richBench.length === 0) {
          // Fallback to describeBenchmark string if structure unknown
          richBench.push({ text: bDesc ?? "—", font: { name: "Calibri", size: 10, color: { argb: "FF374151" } } });
        }
      }
      cBench.value = { richText: richBench };
      cBench.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      cBench.alignment = { vertical: "top", horizontal: "left", indent: 1, wrapText: true };
      cBench.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

      // Row height — proportional to content
      const formulaLines = 2 + fSum.variables.length + (kpi.description ? 2 : 0);
      const varLines = Object.entries(byCo).reduce((n, [, ls]) => n + Object.keys(ls ?? {}).length, 0)
                     + Object.entries(byDim).reduce((n, [, ls]) => n + Object.keys(ls ?? {}).length, 0)
                     + (coEntries.length > 0 ? 1 : 0) + (dimEntries.length > 0 ? 1 : 0);
      const benchLines = ["malo","saludable","excelente"].filter(k => bench?.[k]).length;
      const maxLines = Math.max(formulaLines, varLines, benchLines, 2);
      r.height = Math.max(36, maxLines * 15);
    });

    dws.getColumn(1).width = 28;
    dws.getColumn(2).width = 14;
    dws.getColumn(3).width = 12;
    dws.getColumn(4).width = 55;
    dws.getColumn(5).width = 50;
    dws.getColumn(6).width = 36;
  }

// Graphs tab — one sheet per section: YTD chart+table on top, Monthly chart+table below
  if (graphSections && graphSections.length > 0) {
    for (let secIdx = 0; secIdx < graphSections.length; secIdx++) {
      const section = graphSections[secIdx];
      const { sectionId, company, startY, startM, endY, endM, source: secSource, structure: secStructure,
              dimGroup, dim,
              ytdData, ytdImg, monthlyData, monthlyImg, series } = section;
      const seriesList = Array.isArray(series) ? series : [];

      const sheetName = `Graph ${sectionId}`;
      const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 3 }] });

      // Title row (merged narrow — over data-table cols only, prevents dimension corruption)
      const TBL_COL = 12;                                                  // data table starts at L
      const TBL_END_COL = Math.max(20, TBL_COL + seriesList.length);       // grows with series count
      ws.mergeCells(1, TBL_COL, 1, TBL_END_COL);
      const t = ws.getCell(1, TBL_COL);
      t.value = `Section ${sectionId} — ${company || "—"}`;
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      t.font = { name: "Calibri", size: 14, bold: true, color: { argb: C.white } };
      t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(1).height = 26;

      // Subtitle (filters)
      ws.mergeCells(2, TBL_COL, 2, TBL_END_COL);
      const s = ws.getCell(2, TBL_COL);
      const rangeStr = `${monthLabel(startM)} ${startY} → ${monthLabel(endM)} ${endY}`;
      const descParts = [rangeStr, secSource, secStructure];
const dgArr = Array.isArray(dimGroup) ? dimGroup : (dimGroup ? [dimGroup] : []);
      const dArr  = Array.isArray(dim)      ? dim      : (dim      ? [dim]      : []);
      if (dgArr.length > 0) descParts.push(`Dim Groups: ${dgArr.join(", ")}`);
      if (dArr.length  > 0) descParts.push(`Dims: ${dArr.join(", ")}`);
      s.value = descParts.join(" · ");
      s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      s.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
      s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(2).height = 18;
      ws.getRow(3).height = 6;
// Per-series header background: A = navy (always), B = pink, C = amber
      const headerBgFor = (s) => {
        if (!s || s.barId === "a") return C.primary;
        if (s.barId === "B") return "FFCF305D";
        if (s.barId === "C") return "FFF59E0B";
        return C.primary;
      };

      const renderPeriodSection = (label, accentBg, imgB64, data, startRow) => {
        ws.mergeCells(startRow, TBL_COL, startRow, TBL_END_COL);
        const lbl = ws.getCell(startRow, TBL_COL);
        lbl.value = label;
        lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentBg } };
        lbl.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
        lbl.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(startRow).height = 20;

        if (imgB64) {
          try {
            const imageId = wb.addImage({ base64: imgB64, extension: "png" });
            ws.addImage(imageId, {
              tl: { col: 0, row: startRow },
              br: { col: 10, row: startRow + 19 },
              editAs: "oneCell",
            });
          } catch (e) { console.warn(`Chart embed failed (${label}):`, e); }
        }

        const headerRow = ws.getRow(startRow + 1);
        headerRow.height = 22;
        const periodHdr = headerRow.getCell(TBL_COL);
        periodHdr.value = "Period";
        periodHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentBg } };
        periodHdr.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        periodHdr.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        seriesList.forEach((s, i) => {
          const c = headerRow.getCell(TBL_COL + 1 + i);
          c.value = s.label;
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBgFor(s) } };
          c.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
          c.alignment = { vertical: "middle", horizontal: "right", indent: 1, wrapText: true };
        });

        (data || []).forEach((d, idx) => {
          const r = ws.getRow(startRow + 2 + idx);
          r.height = 18;
          const band = idx % 2 === 0 ? C.band1 : C.band2;
          const periodCell = r.getCell(TBL_COL);
          periodCell.value = d.period;
          periodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
          periodCell.font = { name: "Calibri", size: 10, color: { argb: C.primary }, bold: true };
          periodCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
          seriesList.forEach((s, i) => {
            const val = d[s.key];
            const c = r.getCell(TBL_COL + 1 + i);
            if (!Number.isFinite(val)) {
              c.value = "—";
              c.font = { name: "Calibri", size: 9, color: { argb: C.gray400 } };
            } else {
              c.value = val;
              c.numFmt = s.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
              c.font = { name: "Calibri", size: 9, color: { argb: val < 0 ? C.red : C.primary } };
            }
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
            c.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
          });
        });

        return startRow + Math.max(22, (data?.length ?? 0) + 3);
      };

      let nextRow = 4;
      nextRow = renderPeriodSection("YTD · Year-to-Date",  C.primary,   ytdImg,     ytdData,     nextRow);
      nextRow += 1;
      renderPeriodSection("Monthly · Period Delta",        "FFCF305D",  monthlyImg, monthlyData, nextRow);

      // Column widths
      for (let i = 1; i <= 10; i++) ws.getColumn(i).width = 10;
      ws.getColumn(11).width = 2;
      ws.getColumn(TBL_COL).width = 14;
      seriesList.forEach((_, i) => { ws.getColumn(TBL_COL + 1 + i).width = 15; });
    }
  }

const buffer   = await wb.xlsx.writeBuffer();
  const repaired = await repairXlsxDimensions(buffer);
  const blob     = new Blob([repaired], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fname    = `Konsolidator_KPIs_${filters?.year ?? ""}_${String(filters?.month ?? "").padStart(2, "0")}.xlsx`;
  saveAs(blob, fname);
}

async function exportKpisToPdf({
  kpiList, kpiListCompany, kpiListDimension, kpiListFull,
  companyCodes, companyLabels, companyResults, companyResultsCmp,
  dimensionCodes, dimensionResults, dimensionResultsCmp, dimensionPivots,
  graphSections, filters, exportOpts = {}, accountCodeLabels = new Map(),
}) {
  const kListCompany   = kpiListCompany   ?? kpiList;
  const kListDimension = kpiListDimension ?? kpiList;
  const kListForRefs   = kpiListFull      ?? kpiList;
  const H = {
    primary:   [26, 47, 138],
    primaryDk: [13, 27, 84],
    compareB:  [207, 48, 93],
    compareC:  [16, 185, 129],
    band2:     [248, 249, 255],
    highlight: [238, 241, 251],
    white:     [255, 255, 255],
    gray400:   [156, 163, 175],
    gray500:   [107, 114, 128],
    gray700:   [55, 65, 81],
    red:       [220, 38, 38],
    green:     [5, 150, 105],
    benchUnBg: [254, 242, 242], benchUnHd: [185, 28, 28],
    benchHeBg: [240, 253, 244], benchHeHd: [21, 128, 61],
    benchVHBg: [239, 246, 255], benchVHHd: [30, 64, 175],
  };

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const fmtBenchRange = (r) => {
    if (!r) return "—";
    const min = r.min !== "" && r.min !== undefined && r.min !== null ? r.min : null;
    const max = r.max !== "" && r.max !== undefined && r.max !== null ? r.max : null;
    if (min !== null && max !== null) return `${min} to ${max}`;
    if (min !== null) return `> ${min}`;
    if (max !== null) return `< ${max}`;
    return "—";
  };

  const kpiTypeBadge = (kpi) => {
    if (kpi._isOverridden) return "EDITED";
    if (kpi._kpiType === "custom" || kpi._createdBy) return "CUSTOM";
    return "SYSTEM";
  };

  // PDF-safe filter line builder — jsPDF's default helvetica can't render emoji or Greek
  // characters, so we strip the calendar/vs emojis from the header version and use plain
  // ASCII labels instead.
  const buildPdfFilterLines = (f) => {
    if (!f) return ["—"];
    const lines = [];
    const period = [];
    if (f.year && f.month) period.push(`PERIOD: ${monthLabel(f.month)} ${f.year}`);
    if (f.source)    period.push(`SOURCE: ${f.source}`);
    if (f.structure) period.push(`STRUCTURE: ${f.structure}`);
    if (period.length) lines.push(period.join("   ·   "));

    if (Array.isArray(f.companies) && f.companies.length > 0) {
      const txt = f.companies.length > 6
        ? `COMPANIES (${f.companies.length}): ${f.companies.slice(0,4).join(", ")} +${f.companies.length - 4} more`
        : `COMPANIES: ${f.companies.join(", ")}`;
      lines.push(txt);
    }

    const dim = [];
    if (Array.isArray(f.dimGroups) && f.dimGroups.length > 0) dim.push(`DIM GROUPS: ${f.dimGroups.join(", ")}`);
    if (Array.isArray(f.dims)      && f.dims.length      > 0) dim.push(`DIMS: ${f.dims.join(", ")}`);
    if (dim.length) lines.push(dim.join("   ·   "));

    if (f.compareMode && f.cmpYear && f.cmpMonth) {
      const cmp = [`COMPARED WITH: ${monthLabel(f.cmpMonth)} ${f.cmpYear}`];
      if (f.cmpSource)    cmp.push(`SOURCE: ${f.cmpSource}`);
      if (f.cmpStructure) cmp.push(`STRUCTURE: ${f.cmpStructure}`);
      lines.push(cmp.join("   ·   "));
    }

    return lines.length ? lines : ["—"];
  };

  // Graph-page filters are different: section-scoped date range, the section's own
  // companies (which can differ from the global multi-select), dim group/dim, and the
  // KPIs being charted.
  const buildGraphFilterLines = (section) => {
    const lines = [];
    const period = [];
    period.push(`RANGE: ${monthLabel(section.startM)} ${section.startY}  to  ${monthLabel(section.endM)} ${section.endY}`);
    if (section.source)    period.push(`SOURCE: ${section.source}`);
    if (section.structure) period.push(`STRUCTURE: ${section.structure}`);
    lines.push(period.join("   ·   "));

    const companies = Array.isArray(section.companies) && section.companies.length > 0
      ? section.companies
      : (section.company ? section.company.split(", ").filter(Boolean) : []);
    if (companies.length > 0) lines.push(`COMPANIES: ${companies.join(", ")}`);

const dim = [];
    const sgs = Array.isArray(section.dimGroup) ? section.dimGroup : (section.dimGroup ? [section.dimGroup] : []);
    const sds = Array.isArray(section.dim)      ? section.dim      : (section.dim      ? [section.dim]      : []);
    if (sgs.length > 0) dim.push(`DIM GROUPS: ${sgs.join(", ")}`);
    if (sds.length > 0) dim.push(`DIMS: ${sds.join(", ")}`);
    if (dim.length) lines.push(dim.join("   ·   "));

    const seriesList = Array.isArray(section.series) ? section.series : [];
    const kpiIds = [...new Set(seriesList.map(s => s.kpiId))];
    const kpiNames = kpiIds.map(id => kpiList.find(k => k.id === id)?.label ?? id);
    if (kpiNames.length > 0) {
      const cmpNote = section.compareMode ? "   ·   WITH COMPARE OVERLAY" : "";
      lines.push(`KPIs: ${kpiNames.join(", ")}${cmpNote}`);
    }

    return lines.length ? lines : ["—"];
  };

  const drawTitleBar = (title) => {
    doc.setFillColor(...H.primary);
    doc.rect(0, 0, pageW, 36, "F");
    doc.setTextColor(...H.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 24, 24);
  };

  const drawSubtitleLines = (startY, lines) => {
    const lineH = 12;
    const totalH = lines.length * lineH + 10;
    doc.setFillColor(...H.primary);
    doc.rect(0, startY, pageW, totalH, "F");
    doc.setTextColor(220, 230, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    lines.forEach((line, i) => {
      doc.text(line, 24, startY + 6 + lineH * (i + 0.7));
    });
    return startY + totalH;
  };

  const drawSectionBar = (label, startY, accentRgb) => {
    doc.setFillColor(...accentRgb);
    doc.rect(0, startY, pageW, 16, "F");
    doc.setTextColor(...H.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, 24, startY + 11);
    return startY + 16;
  };

  // Cover / contents page
  const drawCoverPage = () => {
    drawTitleBar("KPI Dashboard Report");

    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    doc.setTextColor(220, 230, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const todayLabel = `Generated ${today}`;
    doc.text(todayLabel, pageW - 24 - doc.getTextWidth(todayLabel), 24);

    let y = 110;
    doc.setTextColor(...H.primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(38);
    const bigPeriod = `${monthLabel(filters?.month) ?? ""} ${filters?.year ?? ""}`.trim() || "KPI Report";
    doc.text(bigPeriod, 36, y);

    y += 26;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...H.gray700);
    const subPieces = [];
    if (filters?.source)    subPieces.push(filters.source);
    if (filters?.structure) subPieces.push(filters.structure);
    if (subPieces.length > 0) doc.text(subPieces.join("   ·   "), 36, y);

    if (filters?.compareMode && filters?.cmpYear && filters?.cmpMonth) {
      y += 22;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...H.compareB);
      doc.text(`Compared with  ${monthLabel(filters.cmpMonth)} ${filters.cmpYear}`, 36, y);
    }

    if (Array.isArray(filters?.companies) && filters.companies.length > 0) {
      y += 32;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...H.gray500);
      doc.text("COMPANIES IN THIS REPORT", 36, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...H.primary);
      const compText = filters.companies.join("   ·   ");
      const split = doc.splitTextToSize(compText, pageW - 72);
      split.forEach(line => { doc.text(line, 36, y); y += 13; });
    }

    // Contents
    y = Math.max(y + 40, pageH * 0.58);
    doc.setFillColor(...H.primary);
    doc.rect(36, y - 12, 3, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...H.primary);
    doc.text("CONTENTS", 46, y);
    y += 24;

    const tocItems = [];
    if (companyCodes && companyCodes.length > 0)     tocItems.push({ label: "Company KPIs",     desc: "YTD + Monthly Delta per company, with compare period" });
    if (dimensionCodes && dimensionCodes.length > 0) tocItems.push({ label: "Dimension KPIs",   desc: "YTD + Monthly Delta per dimension, with compare period" });
    if (graphSections && graphSections.length > 0) {
      graphSections.forEach(s => tocItems.push({
        label: `Graphs — Section ${s.sectionId}`,
        desc:  `${s.company || "—"}  ·  ${s.compareMode ? "with compare overlay" : "primary period"}`,
      }));
    }
    if (exportOpts.defsSheet !== false) tocItems.push({ label: "KPI Definitions", desc: "Formulas, variables, benchmark ranges" });

    tocItems.forEach((it, idx) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...H.gray400);
      doc.text(String(idx + 1).padStart(2, "0"), 36, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...H.primary);
      doc.text(it.label, 70, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...H.gray500);
      doc.text(it.desc, 70, y + 13);
      doc.setDrawColor(230, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(36, y + 22, pageW - 36, y + 22);
      y += 34;
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...H.gray400);
    doc.text("Konsolidator", 24, pageH - 18);
  };

const renderMatrixTable = (cols, colLabels, resultsMap, cmpResultsMap, startY, kList = kpiList, varsMap = null) => {
    const useCmp = cmpResultsMap != null;

const _kListForAgg = kList;
    const kpiAggregates = _kListForAgg.map(kpi => {
      const allVals = cols.map(col => {
        const res = resultsMap?.get(col);
        if (!res) return null;
        const v = res.get(kpi.id);
        return Number.isFinite(v) ? v : null;
      }).filter(v => v !== null);
      const raw = allVals.length === 0 ? null
        : kpi.format === "percent"
          ? allVals.reduce((a,b) => a+b, 0) / allVals.length
          : allVals.reduce((a,b) => a+b, 0);
      return Number.isFinite(raw) ? raw : null;
    });

const renderChunk = (chunkCols, chunkLabels, sY) => {
      const _kList = kList;
      const _varsMap = varsMap;
      const nCols = chunkCols.length;
      let head, body;
      const totalAvgIdx = 1 + nCols * (useCmp ? 4 : 1);
      const benchUnIdx  = totalAvgIdx + 1;
      const benchHeIdx  = totalAvgIdx + 2;
      const benchVHIdx  = totalAvgIdx + 3;

      if (useCmp) {
        const headSuper = [
{ content: "KPI", rowSpan: 2, styles: { halign: "left", valign: "middle", fillColor: H.primary, textColor: H.white, fontStyle: "bold", fontSize: 9 } },
        ];
        chunkLabels.forEach(l => {
headSuper.push({ content: l, colSpan: 4, styles: { halign: "center", valign: "middle", fillColor: H.primary, textColor: H.white, fontStyle: "bold", fontSize: 9 } });
        });
headSuper.push({ content: "Total/Avg", rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.primary, textColor: H.white, fontStyle: "bold", fontSize: 8.5 } });
        headSuper.push({ content: "Unhealthy", rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.benchUnHd, textColor: H.white, fontStyle: "bold", fontSize: 8.5 } });
        headSuper.push({ content: "Healthy",   rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.benchHeHd, textColor: H.white, fontStyle: "bold", fontSize: 8.5 } });
        headSuper.push({ content: "Excellent", rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.benchVHHd, textColor: H.white, fontStyle: "bold", fontSize: 8.5 } });

        // Sub-row: A / Cmp / DIFF / DIFF % — no Greek (jsPDF helvetica can't render it)
        const headSub = [];
        chunkCols.forEach(() => {
headSub.push({ content: "A",       styles: { halign: "center", valign: "middle", fillColor: H.primary,   textColor: H.white, fontStyle: "bold", fontSize: 8 } });
          headSub.push({ content: "Cmp",     styles: { halign: "center", valign: "middle", fillColor: H.compareB,  textColor: H.white, fontStyle: "bold", fontSize: 8 } });
          headSub.push({ content: "DIFF",    styles: { halign: "center", valign: "middle", fillColor: H.primaryDk, textColor: H.white, fontStyle: "bold", fontSize: 8 } });
          headSub.push({ content: "DIFF %",  styles: { halign: "center", valign: "middle", fillColor: H.primaryDk, textColor: H.white, fontStyle: "bold", fontSize: 8 } });
        });

        head = [headSuper, headSub];

body = [];
_kList.forEach((kpi) => {
          const ki = _kListForAgg.indexOf(kpi);
          const row = [`${kpi.label}  [${kpiTypeBadge(kpi)}]`];
          chunkCols.forEach(col => {
            const aRes = resultsMap?.get(col);
            const cRes = cmpResultsMap?.get(col);
            const aVal = aRes ? aRes.get(kpi.id) : null;
            const cVal = cRes ? cRes.get(kpi.id) : null;
            const a = Number.isFinite(aVal) ? aVal : null;
            const c = Number.isFinite(cVal) ? cVal : null;
            const delta = (a !== null && c !== null) ? a - c : null;
            const dPct  = (a !== null && c !== null && kpi.format !== "percent" && Math.abs(c) > 1e-9) ? ((a - c) / Math.abs(c)) * 100 : null;
            row.push(a === null ? "—" : fmtValue(a, kpi.format));
            row.push(c === null ? "—" : fmtValue(c, kpi.format));
            row.push(!Number.isFinite(delta) ? "—" : fmtValue(delta, kpi.format));
            row.push(!Number.isFinite(dPct)  ? "—" : `${dPct > 0 ? "+" : ""}${dPct.toFixed(1)}%`);
          });
          const agg = ki >= 0 ? kpiAggregates[ki] : null;
          row.push(agg === null ? "—" : fmtValue(agg, kpi.format));
          row.push(fmtBenchRange(kpi.benchmark?.unhealthy));
          row.push(fmtBenchRange(kpi.benchmark?.healthy));
          row.push(fmtBenchRange(kpi.benchmark?.vhealthy));
          row._kpiId = kpi.id;
          body.push(row);

          // Variable sub-rows for traceability (works for text and AST formulas)
          const flat = flattenFormulaToTextForm(kpi.formula);
          if (flat && flat.variables) {
            const letters = Object.keys(flat.variables).sort();
            letters.forEach(L => {
              const desc = describeFormulaNode(flat.variables[L], kListForRefs, accountCodeLabels);
              const subRow = [`    ${L} = ${desc}`];
              chunkCols.forEach(col => {
                const v = _varsMap?.get(col)?.get(kpi.id)?.get(L);
                subRow.push(Number.isFinite(v) ? fmtValue(v, "") : "—");
                subRow.push(""); subRow.push(""); subRow.push("");
              });
              subRow.push(""); subRow.push(""); subRow.push(""); subRow.push("");
              subRow._isVarRow = true;
              body.push(subRow);
            });
          }
        });
      } else {
        head = [["KPI", ...chunkLabels, "Total/Avg", "Unhealthy", "Healthy", "Excellent"]];
        body = [];
_kList.forEach((kpi) => {
          const ki = _kListForAgg.indexOf(kpi);
          const vals = chunkCols.map(col => {
            const res = resultsMap?.get(col);
            if (!res) return null;
            const v = res.get(kpi.id);
            return Number.isFinite(v) ? v : null;
          });
          const row = [`${kpi.label}  [${kpiTypeBadge(kpi)}]`];
          vals.forEach(v => row.push(v === null ? "—" : fmtValue(v, kpi.format)));
          const agg = ki >= 0 ? kpiAggregates[ki] : null;
          row.push(agg === null ? "—" : fmtValue(agg, kpi.format));
          row.push(fmtBenchRange(kpi.benchmark?.unhealthy));
row.push(fmtBenchRange(kpi.benchmark?.healthy));
          row.push(fmtBenchRange(kpi.benchmark?.vhealthy));
          row._kpiId = kpi.id;
          body.push(row);

          // Variable sub-rows (non-cmp branch)
          const flat = flattenFormulaToTextForm(kpi.formula);
          if (flat && flat.variables) {
            const letters = Object.keys(flat.variables).sort();
            letters.forEach(L => {
              const desc = describeFormulaNode(flat.variables[L], kListForRefs, accountCodeLabels);
              const subRow = [`    ${L} = ${desc}`];
              chunkCols.forEach(col => {
                const v = _varsMap?.get(col)?.get(kpi.id)?.get(L);
                subRow.push(Number.isFinite(v) ? fmtValue(v, "") : "—");
              });
              subRow.push(""); subRow.push(""); subRow.push(""); subRow.push("");
              subRow._isVarRow = true;
              body.push(subRow);
            });
          }
        });
      }

      const colStyles = {
        0: { halign: "left", fontStyle: "bold", cellWidth: useCmp ? 95 : 140 },
      };
      if (useCmp) {
        // Explicit widths per sub-cell so the colSpan-4 super-header spans the right area
        chunkCols.forEach((_, ci) => {
          const start = 1 + ci * 4;
          colStyles[start]     = { halign: "right", cellWidth: 40 };
          colStyles[start + 1] = { halign: "right", cellWidth: 40 };
          colStyles[start + 2] = { halign: "right", cellWidth: 36 };
          colStyles[start + 3] = { halign: "right", cellWidth: 32 };
        });
      }
      colStyles[totalAvgIdx] = { cellWidth: useCmp ? 48 : 60, halign: "right" };
      colStyles[benchUnIdx]  = { cellWidth: useCmp ? 38 : 50, halign: "center" };
      colStyles[benchHeIdx]  = { cellWidth: useCmp ? 38 : 50, halign: "center" };
      colStyles[benchVHIdx]  = { cellWidth: useCmp ? 38 : 50, halign: "center" };

      autoTable(doc, {
        head, body, startY: sY,
        theme: "plain",
styles: { font: "helvetica", fontSize: useCmp ? 7.5 : 9, cellPadding: useCmp ? 3 : 4.5, textColor: H.primary, valign: "middle", overflow: "linebreak", lineColor: [235, 237, 244], lineWidth: 0.25 },
        headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "center", fontSize: useCmp ? 8 : 8.5, valign: "middle", lineColor: [255, 255, 255], lineWidth: 0.5 },
        margin: { left: 20, right: 20 },
        tableWidth: "auto",
        columnStyles: colStyles,
        alternateRowStyles: { fillColor: H.band2 },
didParseCell: (data) => {
          if (data.section === "body") {
            const rowRaw = data.row.raw;
            const isVarRow = rowRaw && rowRaw._isVarRow;
            if (isVarRow) {
              data.cell.styles.fontSize = (useCmp ? 5.5 : 6.5);
              data.cell.styles.textColor = H.gray500;
              data.cell.styles.fontStyle = "normal";
              data.cell.styles.fillColor = [251, 252, 255];
              if (data.column.index === 0) data.cell.styles.halign = "left";
              return;
            }
            const ci = data.column.index;
            if (ci === 0) return;
            if (ci === benchUnIdx) { data.cell.styles.fillColor = H.benchUnBg; data.cell.styles.textColor = H.benchUnHd; data.cell.styles.halign = "center"; return; }
            if (ci === benchHeIdx) { data.cell.styles.fillColor = H.benchHeBg; data.cell.styles.textColor = H.benchHeHd; data.cell.styles.halign = "center"; return; }
            if (ci === benchVHIdx) { data.cell.styles.fillColor = H.benchVHBg; data.cell.styles.textColor = H.benchVHHd; data.cell.styles.halign = "center"; return; }
            if (ci === totalAvgIdx) {
              data.cell.styles.fillColor = H.highlight; data.cell.styles.halign = "right"; data.cell.styles.fontStyle = "bold";
              const raw = String(data.cell.raw ?? "");
              if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
              return;
            }
            data.cell.styles.halign = "right";
            const raw = String(data.cell.raw ?? "");
            if (useCmp) {
              const subOff = (ci - 1) % 4;
              if (subOff === 1) {
                if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
                else data.cell.styles.textColor = H.compareB;
              } else if (subOff === 2 || subOff === 3) {
                if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
                else if (raw !== "—" && !raw.startsWith("0")) data.cell.styles.textColor = H.green;
              } else {
                if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
              }
            } else {
              if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
            }
          }
        },
      });

      return doc.lastAutoTable.finalY;
    };

    if (!useCmp) {
      return renderChunk(cols, colLabels, startY);
    }

    const CHUNK = 3;
    let y = startY;
    for (let i = 0; i < cols.length; i += CHUNK) {
      const chunkCols   = cols.slice(i, i + CHUNK);
      const chunkLabels = colLabels.slice(i, i + CHUNK);
      if (i > 0) {
        if (y + 110 > pageH) { doc.addPage(); y = 24; }
        else y += 12;
      }
      y = renderChunk(chunkCols, chunkLabels, y);
    }
    return y;
  };

const renderViewSheet = (title, cols, colLabels, resultsBoth, cmpBoth, kList) => {
    drawTitleBar(title);
    let y = drawSubtitleLines(36, buildPdfFilterLines(filters));

    y = drawSectionBar("YTD · Year-to-Date", y + 6, H.primary);
    y = renderMatrixTable(cols, colLabels, resultsBoth.ytd, cmpBoth?.ytd ?? null, y + 4, kList, resultsBoth.ytdVars ?? null);

    if (y + 100 > pageH) {
      doc.addPage();
      y = 16;
    }

    y = drawSectionBar("Monthly · Period Delta", y + 12, H.compareB);
    renderMatrixTable(cols, colLabels, resultsBoth.monthly, cmpBoth?.monthly ?? null, y + 4, kList, resultsBoth.monthlyVars ?? null);
  };

  // ── Render order: Cover → Company → Dimension → Graphs → Definitions ──
  drawCoverPage();

  if (companyCodes && companyCodes.length > 0 && companyResults?.ytd) {
    doc.addPage();
    const labels = (companyLabels && companyLabels.length === companyCodes.length) ? companyLabels : companyCodes;
renderViewSheet("KPI Dashboard — By Company", companyCodes, labels, companyResults, companyResultsCmp, kListCompany);
  }

  if (dimensionCodes && dimensionCodes.length > 0 && dimensionResults?.ytd) {
    doc.addPage();
    const dimLabels = dimensionCodes.map(dc => dimensionPivots?.get(dc)?.name ?? dc);
renderViewSheet("KPI Dashboard — By Dimension", dimensionCodes, dimLabels, dimensionResults, dimensionResultsCmp, kListDimension);
  }

  if (graphSections && graphSections.length > 0) {
    const PDF_CMP_BG = { B: [207, 48, 93], C: [16, 185, 129] };
    for (const section of graphSections) {
      const { sectionId, company, ytdData, ytdImg, monthlyData, monthlyImg, series } = section;
      const seriesList = Array.isArray(series) ? series : [];
      doc.addPage();
      drawTitleBar(`Graphs — Section ${sectionId} · ${company || "—"}`);
      // Graph pages get section-scoped filters, not the global ones
      let y = drawSubtitleLines(36, buildGraphFilterLines(section));

      const availH = pageH - y - 28;
      const halfH = (availH - 2 * 16 - 10) / 2;
      const imgW = pageW * 0.55 - 36;
      const tableX = pageW * 0.55 + 12;

      const renderTable = (data, sectAccent, sy) => {
        const head = [[
          { content: "Period", styles: { fillColor: sectAccent, textColor: H.white } },
          ...seriesList.map(s => ({
            content: s.label,
            styles: {
              fillColor: s.barId === "a" ? sectAccent : (PDF_CMP_BG[s.barId] ?? sectAccent),
              textColor: H.white,
              halign: "right",
            },
          })),
        ]];
        const body = (data || []).map(d => [
          d.period,
          ...seriesList.map(s => {
            const v = d[s.key];
            return Number.isFinite(v) ? fmtValue(v, s.format) : "—";
          }),
        ]);
        autoTable(doc, {
          head, body, startY: sy,
          margin: { left: tableX, right: 24 },
          theme: "plain",
          styles: { font: "helvetica", fontSize: 6, cellPadding: 2, textColor: H.primary, overflow: "linebreak" },
          headStyles: { fontStyle: "bold", fontSize: 6 },
          columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 30 } },
          alternateRowStyles: { fillColor: H.band2 },
          didParseCell: (info) => {
            if (info.section === "body" && info.column.index > 0) {
              info.cell.styles.halign = "right";
              const raw = String(info.cell.raw ?? "");
              if (raw.startsWith("-")) info.cell.styles.textColor = H.red;
            }
          },
        });
      };

      y = drawSectionBar("YTD · Year-to-Date", y + 6, H.primary);
      if (ytdImg) {
        try { doc.addImage(ytdImg, "PNG", 24, y + 4, imgW, halfH - 8); } catch (e) { console.warn("YTD img:", e); }
      }
      renderTable(ytdData, H.primary, y + 4);
      y = y + halfH;

      y = drawSectionBar("Monthly · Period Delta", y + 8, H.compareB);
      if (monthlyImg) {
        try { doc.addImage(monthlyImg, "PNG", 24, y + 4, imgW, halfH - 8); } catch (e) { console.warn("Monthly img:", e); }
      }
      renderTable(monthlyData, H.compareB, y + 4);
    }
  }

  if (exportOpts.defsSheet !== false) {
    doc.addPage();
    drawTitleBar("KPI Definitions · Formulas · Benchmarks");

const defHead = [["KPI", "Category", "Format", "Formula · Variables", "Variations", "Benchmark"]];
// Union of both view lists so definitions cover every KPI that showed up.
    const _allKpisForDefs = (() => {
      const seen = new Set();
      const out = [];
      [...kListCompany, ...kListDimension].forEach(k => {
        if (!seen.has(k.id)) { seen.add(k.id); out.push(k); }
      });
      return out;
    })();
const defBody = _allKpisForDefs.map(kpi => {
      const fSum = kpiFormulaSummary(kpi, kListForRefs, accountCodeLabels);
      const bDesc = describeBenchmark(kpi.benchmark);
      const formulaTxt = [
        fSum.expression ? `Formula: ${fSum.expression}` : null,
        fSum.variables.length > 0 ? fSum.variables.map(v => `${v.letter} = ${v.desc}`).join("\n") : null,
        kpi.description ? `Description: ${kpi.description}` : null,
      ].filter(Boolean).join("\n");
      const varSum = kpiVariationsSummary(kpi, kListForRefs, accountCodeLabels);
      const varLines = [];
      if (varSum.byCompany && varSum.byCompany.length > 0) {
        varLines.push("By Company:");
        varSum.byCompany.forEach(v => varLines.push(`  ${v}`));
      }
      if (varSum.byDimension && varSum.byDimension.length > 0) {
        if (varLines.length > 0) varLines.push("");
        varLines.push("By Dimension:");
        varSum.byDimension.forEach(v => varLines.push(`  ${v}`));
      }
      const variationsTxt = varLines.length > 0 ? varLines.join("\n") : "—";
      return [
        `${kpi.label}  [${kpiTypeBadge(kpi)}]`,
        kpi.category ?? "",
        kpi.format ?? "",
        formulaTxt || "—",
        variationsTxt,
        bDesc ?? "—",
      ];
    });

autoTable(doc, {
      head: defHead, body: defBody,
      startY: 44,
      margin: { left: 20, right: 20 },
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: H.gray700, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "left", fontSize: 9 },
      columnStyles: {
        0: { fontStyle: "bold", textColor: H.primary, cellWidth: 130 },
        1: { cellWidth: 70 },
        2: { cellWidth: 55 },
        3: { cellWidth: 230 },
        4: { cellWidth: 200 },
        5: { cellWidth: "auto" },
      },
      alternateRowStyles: { fillColor: H.band2 },
    });
  }

  const fname = `Konsolidator_KPIs_${filters?.year ?? ""}_${String(filters?.month ?? "").padStart(2, "0")}.pdf`;
  doc.save(fname);
}

function monthLabel(m) {
  const n = parseInt(m);
  return isNaN(n) ? String(m) : (MONTHS[n - 1]?.label ?? String(m));
}

/* eslint-disable-next-line no-unused-vars */
function buildFilterLines(f) {
  if (!f) return ["—"];
  const lines = [];

  const period = [];
  if (f.year && f.month) period.push(`📅 ${monthLabel(f.month)} ${f.year}`);
  if (f.source)    period.push(`Source: ${f.source}`);
  if (f.structure) period.push(`Structure: ${f.structure}`);
  if (f.topParent) period.push(`Perspective: ${f.topParent}`);
  if (period.length) lines.push(period.join("    ·    "));

  if (Array.isArray(f.companies) && f.companies.length > 0) {
    const txt = f.companies.length > 6
      ? `Companies (${f.companies.length}): ${f.companies.slice(0, 4).join(", ")}, …`
      : `Companies: ${f.companies.join(", ")}`;
    lines.push(txt);
  }

  const dimLine = [];
  if (Array.isArray(f.dimGroups) && f.dimGroups.length > 0) dimLine.push(`Dim Groups: ${f.dimGroups.join(", ")}`);
  if (Array.isArray(f.dims)      && f.dims.length      > 0) dimLine.push(`Dims: ${f.dims.join(", ")}`);
  if (dimLine.length) lines.push(dimLine.join("    ·    "));

  if (f.compareMode && f.cmpYear && f.cmpMonth) {
    const cmp = [`🆚 vs ${monthLabel(f.cmpMonth)} ${f.cmpYear}`];
    if (f.cmpSource)    cmp.push(`Source: ${f.cmpSource}`);
    if (f.cmpStructure) cmp.push(`Structure: ${f.cmpStructure}`);
    lines.push(cmp.join("    ·    "));
  }

  return lines.length ? lines : ["—"];
}

function describeFormulaNode(node, kpiList, accountCodeLabels) {
  if (!node) return "—";
  switch (node.type) {
    case "cc": return String(node.tag ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    case "ref": {
      const k = (kpiList || []).find(k => k.id === node.kpiId);
      return k?.label ?? node.kpiId ?? "?";
    }
    case "account": {
      const name = accountCodeLabels?.get?.(node.accountCode);
      const base = `Account ${node.accountCode ?? "?"}${name ? ` — ${name}` : ""}`;
      if (node.dimGroup || node.dimCode) return `${base} [${node.dimGroup ?? ""}:${node.dimName || node.dimCode || ""}]`;
      return base;
    }
    case "accountGroup": {
      const code = node.groupCode ?? node.prefix ?? "?";
      const name = accountCodeLabels?.get?.(code);
      const base = `${code}${name ? ` — ${name}` : ""}`;
      if (node.dimGroup || node.dimCode) {
        return `${base} · ${node.dimGroup}: ${node.dimName || node.dimCode}`;
      }
      return base;
    }
    case "manual": return String(node.value ?? 0);
    case "party": return `${node.partyName ?? node.partyId ?? "?"} (partida)`;
    case "op": {
      const sym = { "+": "+", "-": "−", "*": "×", "/": "÷" }[node.op] ?? node.op;
      return `(${describeFormulaNode(node.left, kpiList, accountCodeLabels)} ${sym} ${describeFormulaNode(node.right, kpiList, accountCodeLabels)})`;
    }
    case "fn": {
      const inner = describeFormulaNode(node.arg, kpiList, accountCodeLabels);
      if (node.fn === "neg") return `−(${inner})`;
      if (node.fn === "abs") return `|${inner}|`;
      if (node.fn === "pct") return `(${inner}) × 100`;
      return inner;
    }
    case "text": return node.expression ?? "—";
    default: return "—";
  }
}

/* eslint-disable-next-line no-unused-vars */
function describeBenchmark(b) {
  if (!b) return null;
  const fmtRange = (r) => {
    if (!r) return null;
    const min = r.min !== "" && r.min !== undefined && r.min !== null ? r.min : null;
    const max = r.max !== "" && r.max !== undefined && r.max !== null ? r.max : null;
    if (min !== null && max !== null) return `${min} → ${max}`;
    if (min !== null) return `> ${min}`;
    if (max !== null) return `< ${max}`;
    return null;
  };
  const parts = [];
  const un = fmtRange(b.unhealthy); if (un) parts.push(`Unhealthy: ${un}`);
  const h  = fmtRange(b.healthy);   if (h)  parts.push(`Healthy: ${h}`);
  const vh = fmtRange(b.vhealthy);  if (vh) parts.push(`Excellent: ${vh}`);
  return parts.length ? parts.join("  ·  ") : null;
}

function flattenFormulaToTextForm(formula) {
  if (!formula) return null;
  if (formula.type === "text") {
    const expr = String(formula.expression ?? "").replace(/^\s*=\s*/, "");
    return { expression: expr, variables: formula.variables ?? {} };
  }
  const variables = {};
  const usedLetters = [];
  const nextLetter = () => {
    const idx = usedLetters.length;
    if (idx < 26) return String.fromCharCode(65 + idx);
    const first = Math.floor(idx / 26) - 1;
    return String.fromCharCode(65 + first) + String.fromCharCode(65 + (idx % 26));
  };
  const assignLetter = (node) => {
    const key = JSON.stringify(node);
    for (const L of usedLetters) {
      if (variables[L] && JSON.stringify(variables[L]) === key) return L;
    }
    const L = nextLetter();
    variables[L] = node;
    usedLetters.push(L);
    return L;
  };
  const walk = (node) => {
    if (!node) return "0";
    switch (node.type) {
      case "op": {
        const l = walk(node.left);
        const r = walk(node.right);
        return `(${l} ${node.op} ${r})`;
      }
      case "fn": {
        const inner = walk(node.arg);
        if (node.fn === "neg") return `(-${inner})`;
        if (node.fn === "abs") return `ABS(${inner})`;
        if (node.fn === "pct") return `(${inner} * 100)`;
        return inner;
      }
      case "ref":
      case "account":
      case "accountGroup":
      case "party":
      case "cc":
      case "manual":
        return assignLetter(node);
      default:
        return "0";
    }
  };
  const expression = walk(formula);
  return { expression, variables };
}

/* eslint-disable-next-line no-unused-vars */
function kpiVariationsSummary(kpi, kpiList, accountCodeLabels) {
  if (!kpi?.variations) return null;
  const lines = [];
  const byCo = kpi.variations.byCompany ?? {};
  Object.entries(byCo).forEach(([co, letters]) => {
    Object.entries(letters ?? {}).forEach(([letter, node]) => {
      if (!node) return;
      lines.push(`Company ${co} · ${letter} = ${describeFormulaNode(node, kpiList, accountCodeLabels)}`);
    });
  });
  const byDim = kpi.variations.byDimension ?? {};
  Object.entries(byDim).forEach(([dim, letters]) => {
    Object.entries(letters ?? {}).forEach(([letter, node]) => {
      if (!node) return;
      lines.push(`Dim ${dim} · ${letter} = ${describeFormulaNode(node, kpiList, accountCodeLabels)}`);
    });
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function kpiFormulaSummary(kpi, kpiList, accountCodeLabels) {
  if (!kpi?.formula) return { expression: null, variables: [] };
  const flat = flattenFormulaToTextForm(kpi.formula);
  if (!flat) return { expression: null, variables: [] };
  const vars = Object.entries(flat.variables ?? {}).map(([letter, node]) => ({
    letter,
    desc: node ? describeFormulaNode(node, kpiList, accountCodeLabels) : "—",
  }));
  return { expression: flat.expression ?? "—", variables: vars };
}

function buildLibrarySections(tt) {
  const mk = (id, refKpiId, format, category) => ({
    id,
    label:       tt(`kpilib_${id.replace(/^_lib_/, "")}_label`),
    description: tt(`kpilib_${id.replace(/^_lib_/, "")}_desc`),
    benchmark:   tt(`kpilib_${id.replace(/^_lib_/, "")}_bench`),
    format,
    category,
    formula:     refKpiId ? { type: "ref", kpiId: refKpiId } : { type: "op", op: "/", left: null, right: null },
  });
  const mkPct = (id, leftRef, rightRef, format, category) => ({
    id,
    label:       tt(`kpilib_${id.replace(/^_lib_/, "")}_label`),
    description: tt(`kpilib_${id.replace(/^_lib_/, "")}_desc`),
    benchmark:   tt(`kpilib_${id.replace(/^_lib_/, "")}_bench`),
    format,
    category,
    formula:     { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: leftRef }, right: { type: "ref", kpiId: rightRef } } },
  });
  const mkMkt = (id) => ({
    id: `_lib_mkt_${id}`,
    label:       tt(`kpilib_mkt_${id}_label`),
    description: tt(`kpilib_mkt_${id}_desc`),
    benchmark:   tt(`kpilib_mkt_${id}_bench`),
    format:      id === "dividend_yield" ? "percent" : "number",
    category:    tt("kpilib_section_mercado_label"),
    formula:     id === "dividend_yield"
      ? { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: null, right: null } }
      : { type: "op", op: "/", left: null, right: null },
  });

  const liquidez     = tt("kpilib_section_liquidez_label");
  const solvencia    = tt("kpilib_section_solvencia_label");
  const rentabilidad = tt("kpilib_section_rentabilidad_label");
  const eficiencia   = tt("kpilib_section_eficiencia_label");

  return [
    { key: "liquidez", label: liquidez, color: "bg-emerald-700", kpis: [
      mk("_lib_current_ratio",   "current_ratio",   "number",   liquidez),
      mk("_lib_quick_ratio",     "quick_ratio",     "number",   liquidez),
      mk("_lib_cash_ratio",      "cash_ratio",      "number",   liquidez),
      mk("_lib_working_capital", "working_capital", "currency", liquidez),
    ]},
    { key: "solvencia", label: solvencia, color: "bg-blue-700", kpis: [
      mk("_lib_debt_ratio",        "debt_ratio",         "percent", solvencia),
      mk("_lib_debt_to_equity",    "debt_to_equity",     "number",  solvencia),
      mk("_lib_net_debt_ebitda",   "net_debt_to_ebitda", "number",  solvencia),
      mk("_lib_interest_coverage", null,                 "number",  solvencia),
    ]},
    { key: "rentabilidad", label: rentabilidad, color: "bg-[#1a2f8a]", kpis: [
      mkPct("_lib_gross_margin", "gross_profit", "revenue",      "percent", rentabilidad),
      mkPct("_lib_ebit_margin",  "ebit",         "revenue",      "percent", rentabilidad),
      mkPct("_lib_net_margin",   "net_result",   "revenue",      "percent", rentabilidad),
      mkPct("_lib_roa",          "net_result",   "total_assets", "percent", rentabilidad),
      mkPct("_lib_roe",          "net_result",   "total_equity", "percent", rentabilidad),
      mk("_lib_ebitda", "ebitda", "currency", rentabilidad),
      mk("_lib_ebit",   "ebit",   "currency", rentabilidad),
    ]},
    { key: "eficiencia", label: eficiencia, color: "bg-amber-600", kpis: [
      mk("_lib_asset_turnover", "asset_turnover", "number", eficiencia),
      mk("_lib_dio",            "inventory_days", "number", eficiencia),
      mk("_lib_dso",            "dso",            "number", eficiencia),
      mk("_lib_dpo",            "dpo",            "number", eficiencia),
    ]},
    { key: "mercado", label: tt("kpilib_section_mercado_label"), color: "bg-rose-800", kpis: [
      mkMkt("eps"),
      mkMkt("pe"),
      mkMkt("pbv"),
      mkMkt("dividend_yield"),
      mkMkt("ev_ebitda"),
    ]},
  ];
}

function LibraryPicker({ onSave, onDuplicate }) {
  const { locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const LIBRARY_SECTIONS = useMemo(() => buildLibrarySections(tt), [tt]);
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
  const { locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const [search, setSearch] = useState("");
  const filtered = kpiList.filter(k => !search.trim() || k.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder={tt("search_kpi",             "Buscar KPI...")}
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
  const { locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const [search, setSearch] = useState("");
  const [expandedDims, setExpandedDims] = useState(new Set());
  const selectedCode = value?.split(":::")?.[0] ?? value;
  const filtered = items.filter(i => !search.trim() || i.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder={tt("search_account",         "Buscar cuenta...")}
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

function PartyPicker({ parties, partyContext, evalPartyValue, value, onChange }) {
  const [search, setSearch] = useState("");
  // Applicable = party covers at least one company in scope, the current
  // year, and (if dims are selected) at least one selected dim.
  const applicable = useMemo(() => {
    if (!partyContext) return parties;
    const { companies, year, selectedDims } = partyContext;
    return parties.filter(p => {
      if (companies && companies.length && p.companies?.length && !p.companies.some(c => companies.includes(c))) return false;
      if (year && p.years?.length && !p.years.includes(String(year))) return false;
      if (selectedDims && selectedDims.size > 0) return p.dims?.some(d => selectedDims.has(d));
      return true;
    });
  }, [parties, partyContext]);
  const filtered = search.trim()
    ? applicable.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.unit || "").toLowerCase().includes(search.toLowerCase()))
    : applicable;
  const fmtVal = (n) => typeof n === "number" ? n.toLocaleString("de-DE", { maximumFractionDigits: 2 }) : "—";
  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50">
        <Search size={12} className="text-gray-400" />
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar partida..."
          className="text-sm outline-none bg-transparent flex-1" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto border border-gray-100 rounded-xl">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-400">
            {applicable.length === 0
              ? "No hay partidas aplicables al filtro actual (empresas, periodo, dimensiones)"
              : "Sin resultados"}
          </div>
        ) : filtered.map((p) => {
          const selected = value === p.id;
          const preview = evalPartyValue ? evalPartyValue(p.id) : null;
          return (
            <button key={p.id} onClick={() => onChange(p.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-100 last:border-b-0"
              style={{ background: selected ? "#ecfdf5" : "transparent" }}
              onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#f9fafb"; }}
              onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: selected ? "#059669" : "#d1fae5", color: selected ? "white" : "#059669" }}>
                <span className="text-sm font-black">◆</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900 truncate">{p.name}</p>
                <p className="text-[10px] font-bold text-gray-400 mt-0.5">{(p.dims || []).length} dims{p.unit ? ` · ${p.unit}` : ""}</p>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Valor</span>
                <span className="text-sm font-black tabular-nums" style={{ color: "#047857" }}>{fmtVal(preview)}</span>
              </div>
              {selected && <Check size={12} className="text-emerald-600 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotPicker({ onSelect, onClose, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), parties = [], partyContext = null, evalPartyValue = null }) {
  const { locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const [step, setStep] = useState("type");
  const [type, setType] = useState(null);
  const [prefix, setPrefix] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [kpiId, setKpiId] = useState("");
  const [partyId, setPartyId] = useState("");
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
    console.log("[SP-confirm]", "type:", type, "prefix:", prefix, "accountCode:", accountCode);
    console.log("[SP-confirm]", "type:", type, "prefix:", prefix, "accountCode:", accountCode);
if (type === "accountGroup") {
      if (prefix.includes(":::")) {
        const [pc, dimGroup, dimCode] = prefix.split(":::");
        onSelect({ type: "accountGroup", prefix: pc, dimGroup: dimGroup || undefined, dimCode: dimCode || undefined });
      } else { onSelect({ type: "accountGroup", prefix }); }
    }
    else if (type === "account") {
      if (accountCode.includes(":::")) {
        const [ac, dimGroup, dimCode] = accountCode.split(":::");
        onSelect({ type: "account", accountCode: ac, dimGroup: dimGroup || undefined, dimCode: dimCode || undefined });
      } else { onSelect({ type: "account", accountCode }); }
    } else if (type === "ref") onSelect({ type: "ref", kpiId });
    else if (type === "party") { const p = parties.find(pp => pp.id === partyId); onSelect({ type: "party", partyId, partyName: p?.name }); }
    onClose();
  };
return (
    <div onClick={onClose} data-slotpicker-root="true" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)" }} />
      <div className="relative flex flex-col bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
        style={{ boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25)", height: "90vh", maxHeight: "90vh", zIndex: 1 }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {step === "detail" && (
              <button onClick={() => setStep("type")} className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110" style={{ background: "#f3f4f6", color: "#6b7280" }}>
                <ChevronDown size={12} className="rotate-90" />
              </button>
            )}
            <p className="font-black text-[14px] text-gray-900 leading-tight">{step === "type" ? tt("slot_variable_type",       "Tipo de variable") : type}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110" style={{ background: "#f3f4f6", color: "#6b7280" }}><X size={12} /></button>
        </div>
        <div className="h-px mx-5" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />
        {step === "type" && (
          <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
            {[
              { id: "accountGroup", label: tt("slot_account_group",  "Grupo de cuentas"), desc: tt("slot_prefix_sum_desc", "Suma todas las cuentas bajo un código padre"), icon: "Σ", iconBg: "#dbeafe", iconColor: "#1d4ed8" },
              { id: "account", label: tt("slot_single_account", "Cuenta individual"), desc: tt("slot_exact_code_desc",     "Código exacto de una cuenta"), icon: "#", iconBg: "#eef1fb", iconColor: "#1a2f8a" },
              { id: "ref", label: tt("slot_kpi_existing",   "KPI existente"), desc: tt("slot_ref_kpi_desc",       "Referencia a otro KPI calculado"), icon: "↗", iconBg: "#f3e8ff", iconColor: "#7c3aed" },
              { id: "party", label: tt("slot_stat_party", "Partida estadística"), desc: tt("slot_stat_party_desc", "Empleados, superficie u otras métricas no financieras"), icon: "◆", iconBg: "#d1fae5", iconColor: "#047857" },
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
              <p className="text-[10px] text-gray-400 leading-snug bg-blue-50 px-3 py-2 rounded-xl flex-shrink-0">Suma todas las cuentas cuyo código empiece por este prefijo.</p>
            )}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {type === "accountGroup" && (() => {
                const items = accountCodes.map(ac => ({ code: ac, label: accountCodeLabels.get(ac) ? `${ac} — ${accountCodeLabels.get(ac)}` : ac }));
                return <AccountPicker items={items} value={prefix} onChange={setPrefix} dimsByAccount={dimsByAccount} />;
              })()}
              {type === "account" && (() => {
                const items = accountCodes.map(ac => ({ code: ac, label: accountCodeLabels.get(ac) ? `${ac} — ${accountCodeLabels.get(ac)}` : ac }));
                return <AccountPicker items={items} value={accountCode} onChange={setAccountCode} dimsByAccount={dimsByAccount} />;
              })()}
              {type === "ref" && <KpiRefPicker kpiList={kpiList} kpiId={kpiId} setKpiId={setKpiId} builtInIds={builtInIds} />}
              {type === "party" && <PartyPicker parties={parties} partyContext={partyContext} evalPartyValue={evalPartyValue} value={partyId} onChange={setPartyId} />}
            </div>
            <button onClick={confirm}
              disabled={(type === "accountGroup" && !prefix) || (type === "account" && !accountCode.split(":::")[0]) || (type === "ref" && !kpiId) || (type === "party" && !partyId)}
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

function SlotLabel({ node, kpiList, accountCodeLabels = new Map(), dimsByAccount = new Map() }) {
  if (!node) return <span className="text-gray-300 italic">vacío</span>;
  if (node.type === "accountGroup") {
    // Legacy nodes stored the whole "code:::dimGroup:::dimCode" string inside
    // groupCode/prefix. Detect and split so we can render nicely.
    let code    = node.groupCode ?? node.prefix ?? "?";
    let dimGroup = node.dimGroup;
    let dimCode  = node.dimCode;
    const dimName = node.dimName;
    if (code.includes(":::") && !dimGroup && !dimCode) {
      const [gc, dg, dc] = code.split(":::");
      code = gc; dimGroup = dg || undefined; dimCode = dc || undefined;
    }
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : code;
    if (dimGroup || dimCode) {
      const entry = dimsByAccount.get(code)?.find(d => d.group === dimGroup && d.code === dimCode);
      const label = dimName || entry?.name || dimCode;
      return <span><span className="font-black">{base}</span> <span style={{ color: "#d97706", fontWeight: 700 }}> → {dimGroup}: {label}</span></span>;
    }
    return <span className="font-black">{base}</span>;
  }
  if (node.type === "account") {
    let code    = node.accountCode ?? "?";
    let dimGroup = node.dimGroup;
    let dimCode  = node.dimCode;
    const dimName = node.dimName;
    if (code.includes(":::") && !dimGroup && !dimCode) {
      const [ac, dg, dc] = code.split(":::");
      code = ac; dimGroup = dg || undefined; dimCode = dc || undefined;
    }
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : code;
    if (dimGroup || dimCode) {
      const entry = dimsByAccount.get(code)?.find(d => d.group === dimGroup && d.code === dimCode);
      const label = dimName || entry?.name || dimCode;
      return <span className="font-black">{base} <span style={{ color: "#d97706", fontWeight: 700 }}> → {dimGroup}: {label}</span></span>;
    }
    return <span className="font-black">{base}</span>;
  }
  if (node.type === "ref") { const k = kpiList.find(k => k.id === node.kpiId); return <span className="font-black">{k?.label || node.kpiId || "?"}</span>; }
  if (node.type === "manual") return <span className="font-black">{node.value}</span>;
  if (node.type === "party") return <span className="font-black">◆ {node.partyName || node.partyId || "?"}</span>;
  return <span className="text-gray-400 text-[10px]">complejo</span>;
}

function Slot({ node, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), color = "bg-[#eef1fb] text-[#1a2f8a] border-[#1a2f8a]/20" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:shadow-sm ${node ? color : "bg-gray-50 text-gray-400 border-gray-200 border-dashed hover:border-[#1a2f8a]/30 hover:bg-[#f8f9ff]"}`}>
{node ? <SlotLabel node={node} kpiList={kpiList} accountCodeLabels={accountCodeLabels} dimsByAccount={dimsByAccount} /> : <><Plus size={10} className="opacity-50" /> variable</>}
      </button>
     {open && createPortal(<SlotPicker onSelect={onChange} onClose={() => setOpen(false)} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} />, document.body)}
    </>
  );
}

const OP_SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷" };

const VARIABLE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function TextFormulaBuilder({ formula, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), parties = [], partyContext = null, evalPartyValue = null }) {
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
<SlotLabel node={variables[letter]} kpiList={kpiList} accountCodeLabels={accountCodeLabels} dimsByAccount={dimsByAccount} />
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
      {editingVar && createPortal(<SlotPicker onSelect={(node) => updateVar(editingVar, node)} onClose={() => setEditingVar(null)} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} parties={parties} partyContext={partyContext} evalPartyValue={evalPartyValue} />, document.body)}
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

function describeVariationNode(node, accountCodeLabels = new Map()) {
  if (!node) return "";
  const parseCodeWithDim = (raw) => {
    if (typeof raw === "string" && raw.includes(":::")) {
      const [code, dimGroup, dimCode] = raw.split(":::");
      return { code, dimGroup, dimCode };
    }
    return { code: raw };
  };
  if (node.type === "accountGroup") {
    const { code, dimGroup, dimCode } = parseCodeWithDim(node.prefix ?? node.groupCode);
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : `Grupo ${code}`;
    return dimGroup ? `${base} → ${dimGroup}: ${dimCode}` : base;
  }
  if (node.type === "account") {
    const { code, dimGroup, dimCode } = parseCodeWithDim(node.accountCode);
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : code;
    return dimGroup ? `${base} → ${dimGroup}: ${dimCode}` : base;
  }
  if (node.type === "cc") return `${node.tag}`;
  if (node.type === "section") return `${node.statement} · ${node.section}`;
  if (node.type === "party") return `${node.partyName ?? "Partida"}${node.dimCode ? ` · ${node.dimCode}` : ""}`;
  if (node.type === "ref") return `KPI ref`;
  if (node.type === "manual") return `${node.value}`;
  return node.type;
}

function KpiEditorModal({ kpi, onSave, onClose, onReset, onEditLibraryKpi, onDeleteLibraryKpi, onDuplicate, kpiList, allLocalKpis = [], systemKpis = [], accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), currentUserId, dimsByAccount = new Map(), parties = [], partyContext = null, evalPartyValue = null, variationCompanies = [], companyLabelsMap = new Map(), variationDimensions = [] }) {
  const { locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
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
  const [variations, setVariations] = useState(() => {
    const v = kpi?.variations ?? kpi?.variations_data ?? null;
    return v && (v.byCompany || v.byDimension) ? { byCompany: v.byCompany ?? {}, byDimension: v.byDimension ?? {} } : { byCompany: {}, byDimension: {} };
  });
const hasVariations = () =>
    Object.keys(variations.byCompany).some(k => Object.keys(variations.byCompany[k] ?? {}).length > 0) ||
    Object.keys(variations.byDimension).some(k => Object.keys(variations.byDimension[k] ?? {}).length > 0);
const [variationOpen, setVariationOpen] = useState(false);
  const [variationTab, setVariationTab] = useState("companies");
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [expandedDimension, setExpandedDimension] = useState(null);
  const [slotPickerContext, setSlotPickerContext] = useState(null); // {scope, key, letter}
  const variationCount = () => {
    let n = 0;
    Object.values(variations.byCompany).forEach(m => n += Object.keys(m ?? {}).length);
    Object.values(variations.byDimension).forEach(m => n += Object.keys(m ?? {}).length);
    return n;
  };
const setOverride = (scope, key, letter, node) => {
    console.log("[setOverride]", "scope:", scope, "key:", key, "letter:", letter, "node:", node);
    setVariations(prev => {
      const bucket = scope === "company" ? "byCompany" : "byDimension";
      const next = { ...prev, [bucket]: { ...prev[bucket] } };
      const entry = { ...(next[bucket][key] ?? {}) };
      if (node) entry[letter] = node;
      else delete entry[letter];
      if (Object.keys(entry).length > 0) next[bucket][key] = entry;
      else delete next[bucket][key];
      return next;
    });
  };
const formulaLetters = useMemo(() => {
    if (!formula || formula.type !== "text") return [];
    return Object.keys(formula.variables ?? {});
  }, [formula]);
  // Prune orphaned overrides when the formula's variables change (e.g. user
  // deletes letter B from the builder — any per-company/per-dim override for B
  // must go with it).
  useEffect(() => {
    const validLetters = new Set(formulaLetters);
    setVariations(prev => {
      let changed = false;
      const cleanBucket = (bucket) => {
        const next = {};
        Object.entries(bucket).forEach(([key, letters]) => {
          const filtered = {};
          Object.entries(letters).forEach(([l, node]) => {
            if (validLetters.has(l)) filtered[l] = node;
            else changed = true;
          });
          if (Object.keys(filtered).length > 0) next[key] = filtered;
          else if (Object.keys(letters).length > 0) changed = true;
        });
        return next;
      };
      const nextByCompany = cleanBucket(prev.byCompany ?? {});
      const nextByDimension = cleanBucket(prev.byDimension ?? {});
      return changed ? { byCompany: nextByCompany, byDimension: nextByDimension } : prev;
    });
  }, [formulaLetters]);
  const [libSearch, setLibSearch] = useState("");
  const [libCatFilter, setLibCatFilter] = useState(null);
  const [libTagFilter, setLibTagFilter] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [disintegratingId, setDisintegratingId] = useState(null);
  const [removedIds, setRemovedIds] = useState(new Set());
  const [dupeLabelWarning, setDupeLabelWarning] = useState(false);
const [formulaWarning, setFormulaWarning] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
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
<div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => mode === "custom" ? setConfirmClose(true) : onClose()}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
<div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
style={{
          boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)",
          transform: variationOpen ? "translateX(-22rem)" : "translateX(0)",
          transition: "transform 460ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
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
{confirmClose && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center rounded-3xl" style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
            <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6" style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "#fef3c7" }}>
                <AlertTriangle size={22} style={{ color: "#d97706" }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-black text-gray-900 mb-1">¿Cerrar sin guardar?</p>
                <p className="text-xs text-gray-400 leading-relaxed max-w-[260px]">Si cierras ahora perderás cualquier cambio que no hayas guardado.</p>
              </div>
              <div className="flex gap-2 w-full">
                <button onClick={() => setConfirmClose(false)} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all" style={{ background: "#f3f4f6", color: "#6b7280" }}>Continuar editando</button>
                <button onClick={() => { setConfirmClose(false); onClose(); }} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all" style={{ background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)", boxShadow: "0 4px 14px -4px rgba(220,38,38,0.4)" }}>Cerrar</button>
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
                {kpi ? (builtInIds.has(kpi.id) ? "⚙ System KPI" : "✦ Custom KPI") : tt("slot_library_or_custom",   "Library or custom formula")}
              </p>
            </div>
          </div>
<button onClick={() => mode === "custom" ? setConfirmClose(true) : onClose()} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110" style={{ background: "#f3f4f6", color: "#6b7280" }}><X size={13} /></button>
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
                  <input value={customCategoryLabel} onChange={e => setCustomCategoryLabel(e.target.value)} placeholder={tt("category_name_placeholder","Category name")}
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
                  {getPresets(tt).map((p, i) => (
                    <button key={i} onClick={() => { setFormula(JSON.parse(JSON.stringify(p.formula))); setTab("builder"); }}
                      className="text-left p-3 rounded-xl border border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb] transition-all group">
                      <p className="text-xs font-black text-[#1a2f8a]">{p.label}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-[#f8f9ff] rounded-xl border border-gray-100 p-4 min-h-[80px]">
                  <TextFormulaBuilder formula={formula?.type === "text" ? formula : null} onChange={setFormula} kpiList={otherKpis} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} parties={parties} partyContext={partyContext} evalPartyValue={evalPartyValue} />
                </div>
              )}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-2 block" style={{ color: "#9ca3af" }}>Benchmark Ranges</label>
              <div className="flex flex-col gap-1.5">
                {[
                  { key: "unhealthy", label: tt("bench_unhealthy", "Unhealthy"), accent: "#dc2626", bg: "#fff8f8" },
                  { key: "healthy",   label: tt("bench_healthy",   "Healthy"),   accent: "#16a34a", bg: "#f8fff9" },
                  { key: "vhealthy",  label: tt("bench_excellent", "Excellent"), accent: "#1a2f8a", bg: "#f8f9ff" },
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
            <div className="flex gap-2">
              <button onClick={() => {
                const allLabels = new Set([...(allLocalKpis ?? []).map(k => k.label), ...(systemKpis ?? []).map(k => k.label)]);
                if (kpi) allLabels.delete(kpi.label);
                const finalLabel = label.trim();
                if ([...allLabels].some(l => l.toLowerCase() === finalLabel.toLowerCase())) { setDupeLabelWarning(true); return; }
                const formulaErr = validateFormula(formula);
                if (formulaErr) { setFormulaWarning(formulaErr); return; }
                onSave({ label: finalLabel, description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula, variations });
              }} disabled={!label}
                className="flex-1 py-3 rounded-xl text-xs font-black transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", color: "white", boxShadow: "0 4px 14px -4px rgba(26,47,138,0.5)" }}>
                <Check size={12} /> {kpi ? "Save Changes" : "Create KPI"}
              </button>
              <button onClick={() => setVariationOpen(o => !o)}
                disabled={formulaLetters.length === 0}
                className="flex-shrink-0 py-3 px-4 rounded-xl text-xs font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  background: variationOpen ? "linear-gradient(135deg, #ec4899 0%, #f472b6 100%)" : "#fff",
                  color: variationOpen ? "#fff" : "#ec4899",
                  border: `2px solid ${variationOpen ? "transparent" : "#ec4899"}`,
                  boxShadow: variationOpen ? "0 4px 14px -4px rgba(236,72,153,0.5)" : "none",
                }}
                title={formulaLetters.length === 0 ? "Añade una fórmula primero" : "Variación por empresa / dimensión"}>
                <Sigma size={12} /> Variación
                {variationCount() > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: variationOpen ? "rgba(255,255,255,0.25)" : "#ec489915" }}>{variationCount()}</span>}
              </button>
            </div>
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

{/* ── Variation side panel — same height as modal, paired centered ── */}
<div className="absolute top-1/2 pointer-events-none"
        style={{
          left: "50%",
          transform: `translateY(-50%) translateX(calc(1rem + ${variationOpen ? "0px" : "-40px"})) scale(${variationOpen ? 1 : 0.94})`,
          transformOrigin: "left center",
          opacity: variationOpen ? 1 : 0,
          transition: "opacity 340ms cubic-bezier(0.4,0,0.2,1), transform 460ms cubic-bezier(0.34,1.56,0.64,1)",
          height: "77vh",
          width: "min(42rem, 45vw)",
        }}>
<div className={`${variationOpen ? "pointer-events-auto" : "pointer-events-none"} rounded-3xl shadow-2xl overflow-hidden flex flex-col bg-white h-full`}
          style={{
            boxShadow: "0 32px 80px -16px rgba(236,72,153,0.30), 0 8px 24px -8px rgba(0,0,0,0.10)",
          }}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="px-6 pt-6 pb-5 flex items-center justify-between flex-shrink-0 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #ec4899 0%, #f472b6 100%)", boxShadow: "0 6px 16px -4px rgba(236,72,153,0.5)" }}>
                <Sigma size={16} className="text-white" />
              </div>
              <div>
                <p className="font-black text-[15px] text-gray-900 leading-tight">Variación</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] mt-0.5" style={{ color: "#ec4899" }}>
                  ✦ Overrides por empresa / dimensión
                </p>
              </div>
            </div>
            <button onClick={() => setVariationOpen(false)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
              style={{ background: "#f3f4f6", color: "#6b7280" }}><X size={13} /></button>
          </div>

          {/* Tabs */}
          <div className="px-6 pt-4 pb-2 flex-shrink-0">
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#f8f9ff" }}>
              <button onClick={() => setVariationTab("companies")}
                className="flex-1 py-2 px-3 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2"
                style={{
                  background: variationTab === "companies" ? "#fff" : "transparent",
                  color: variationTab === "companies" ? "#1a2f8a" : "#9ca3af",
                  boxShadow: variationTab === "companies" ? "0 2px 8px -2px rgba(26,47,138,0.15)" : "none",
                }}>
                <Building2 size={11} /> Empresas
                <span className="text-[9px] px-1.5 py-0.5 rounded-md"
                  style={{ background: variationTab === "companies" ? "#eef1fb" : "transparent", color: variationTab === "companies" ? "#1a2f8a" : "#9ca3af" }}>
                  {variationCompanies.length}
                </span>
              </button>
              <button onClick={() => setVariationTab("dimensions")}
                className="flex-1 py-2 px-3 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2"
                style={{
                  background: variationTab === "dimensions" ? "#fff" : "transparent",
                  color: variationTab === "dimensions" ? "#15803d" : "#9ca3af",
                  boxShadow: variationTab === "dimensions" ? "0 2px 8px -2px rgba(22,163,74,0.15)" : "none",
                }}>
                <Layers size={11} /> Dimensiones
                <span className="text-[9px] px-1.5 py-0.5 rounded-md"
                  style={{ background: variationTab === "dimensions" ? "#dcfce7" : "transparent", color: variationTab === "dimensions" ? "#15803d" : "#9ca3af" }}>
                  {variationDimensions.length}
                </span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 px-6 pb-6 pt-3" style={{ scrollbarWidth: "thin" }}>
            {variationTab === "companies" && (
              <div className="flex flex-col gap-1.5">
                {variationCompanies.length === 0 && (
                  <p className="text-[11px] text-gray-300 text-center py-12 font-bold">No hay empresas disponibles</p>
                )}
                {variationCompanies.map(co => {
                  const label = companyLabelsMap.get(co) ?? co;
                  const overrides = variations.byCompany[co] ?? {};
                  const overrideCount = Object.keys(overrides).length;
                  const isExpanded = expandedCompany === co;
                  return (
                    <div key={co} className="rounded-2xl overflow-hidden transition-all"
                      style={{ background: isExpanded ? "#f8f9ff" : "#fff", border: `1px solid ${isExpanded ? "rgba(26,47,138,0.15)" : "#eef1fb"}` }}>
                      <button onClick={() => setExpandedCompany(isExpanded ? null : co)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left transition-all hover:bg-[#f8f9ff]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: overrideCount > 0 ? "#ec489915" : "#eef1fb" }}>
                            <Building2 size={11} style={{ color: overrideCount > 0 ? "#ec4899" : "#1a2f8a" }} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-gray-900 truncate">{label}</span>
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.15em]">{co}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {overrideCount > 0 && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-md text-white"
                              style={{ background: "#ec4899" }}>{overrideCount}</span>
                          )}
                          <ChevronDown size={11} className="text-gray-400"
                            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 flex flex-col gap-2" style={{ animation: "plRowSlideIn 260ms ease-out" }}>
                          {formulaLetters.length === 0 && (
                            <p className="text-[10px] text-gray-300 text-center py-3 font-bold">Sin variables en la fórmula</p>
                          )}
                          {formulaLetters.map(letter => {
                            const override = overrides[letter];
                            return (
                              <div key={letter} className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black"
                                  style={{ background: "#1a2f8a", color: "#fff" }}>{letter}</div>
                                <button onClick={() => setSlotPickerContext({ scope: "company", key: co, letter })}
                                  className="flex-1 text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-all hover:scale-[1.01]"
                                  style={{
                                    background: override ? "#ec489912" : "#fff",
                                    color: override ? "#ec4899" : "#9ca3af",
                                    border: `1.5px solid ${override ? "#ec489930" : "#e5e7eb"}`,
                                  }}>
                                  {override ? describeVariationNode(override, accountCodeLabels) : "— usar fórmula base —"}
                                </button>
                                {override && (
                                  <button onClick={() => setOverride("company", co, letter, null)}
                                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 hover:scale-110 transition-all"
                                    style={{ background: "#fee2e2", color: "#dc2626" }}>
                                    <X size={10} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {variationTab === "dimensions" && (
              <div className="flex flex-col gap-1.5">
                {variationDimensions.length === 0 && (
                  <p className="text-[11px] text-gray-300 text-center py-12 font-bold">No hay dimensiones disponibles</p>
                )}
                {variationDimensions.map(d => {
                  const code = d.code ?? d;
                  const name = d.name ?? code;
                  const group = d.group;
                  const overrides = variations.byDimension[code] ?? {};
                  const overrideCount = Object.keys(overrides).length;
                  const isExpanded = expandedDimension === code;
                  return (
                    <div key={code} className="rounded-2xl overflow-hidden transition-all"
                      style={{ background: isExpanded ? "#f0fdf4" : "#fff", border: `1px solid ${isExpanded ? "rgba(22,163,74,0.15)" : "#dcfce780"}` }}>
                      <button onClick={() => setExpandedDimension(isExpanded ? null : code)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left transition-all hover:bg-[#f0fdf4]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: overrideCount > 0 ? "#ec489915" : "#dcfce7" }}>
                            <Layers size={11} style={{ color: overrideCount > 0 ? "#ec4899" : "#15803d" }} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-gray-900 truncate">{name}</span>
                            {group && <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.15em]">{group}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {overrideCount > 0 && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-md text-white"
                              style={{ background: "#ec4899" }}>{overrideCount}</span>
                          )}
                          <ChevronDown size={11} className="text-gray-400"
                            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 flex flex-col gap-2" style={{ animation: "plRowSlideIn 260ms ease-out" }}>
                          {formulaLetters.length === 0 && (
                            <p className="text-[10px] text-gray-300 text-center py-3 font-bold">Sin variables en la fórmula</p>
                          )}
                          {formulaLetters.map(letter => {
                            const override = overrides[letter];
                            return (
                              <div key={letter} className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black"
                                  style={{ background: "#15803d", color: "#fff" }}>{letter}</div>
                                <button onClick={() => setSlotPickerContext({ scope: "dimension", key: code, letter })}
                                  className="flex-1 text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-all hover:scale-[1.01]"
                                  style={{
                                    background: override ? "#ec489912" : "#fff",
                                    color: override ? "#ec4899" : "#9ca3af",
                                    border: `1.5px solid ${override ? "#ec489930" : "#e5e7eb"}`,
                                  }}>
                                  {override ? describeVariationNode(override, accountCodeLabels) : "— usar fórmula base —"}
                                </button>
                                {override && (
                                  <button onClick={() => setOverride("dimension", code, letter, null)}
                                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 hover:scale-110 transition-all"
                                    style={{ background: "#fee2e2", color: "#dc2626" }}>
                                    <X size={10} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

{/* SlotPicker for variation overrides — portaled out to escape modal's transform */}
      {slotPickerContext && createPortal(
        <SlotPicker
          onSelect={(node) => { setOverride(slotPickerContext.scope, slotPickerContext.key, slotPickerContext.letter, node); setSlotPickerContext(null); }}
          onClose={() => setSlotPickerContext(null)}
          kpiList={kpiList}
          accountCodes={accountCodes}
          accountCodeLabels={accountCodeLabels}
          builtInIds={builtInIds}
          dimsByAccount={dimsByAccount}
          parties={parties}
          partyContext={partyContext}
          evalPartyValue={evalPartyValue}
        />,
        document.body
      )}
    </div>
  );
}

function ConsolidatedGraphSection({
  sectionId, token, source, structure, topParent,
  sourceOpts, structureOpts, holdingOptions,
  kpiList, allKpis, ccTagToCodes, sectionCodes,
  defaultKpiIds, onStateChange, colors,
  compareModeOuter,
  viewPeriod,
scope = "consolidated",
  perspectiveCompanies = [],
  companyLabelsMap = new Map(),
  groupDescendants = new Map(),
}) {
  const { locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const anchorY = parseInt(new Date().getFullYear());
  const anchorM = new Date().getMonth() + 1;
  let startY = anchorY, startM = anchorM - 11;
  while (startM < 1) { startM += 12; startY -= 1; }

const [secTopParent, setSecTopParent] = useState(topParent || "");
const [secCompany, setSecCompany] = useState(perspectiveCompanies[0] ?? "");
  useEffect(() => {
    if (!perspectiveCompanies.length) return;
    if (!perspectiveCompanies.includes(secCompany)) setSecCompany(perspectiveCompanies[0]);
  }, [perspectiveCompanies, secCompany]);
  const [secStartYear, setSecStartYear] = useState(String(startY));
  const [secStartMonth, setSecStartMonth] = useState(String(startM));
  const [secEndYear, setSecEndYear] = useState(String(anchorY));
  const [secEndMonth, setSecEndMonth] = useState(String(anchorM));
  const [secSource, setSecSource] = useState(source);
  const [secStructure, setSecStructure] = useState(structure);
const secMode = viewPeriod === "ytd" ? "ytd" : "monthly";
  const [secKpiIds, setSecKpiIds] = useState(defaultKpiIds || []);
  const [kpiPickerOpen, setKpiPickerOpen] = useState(false);
  const [kpiPickerRect, setKpiPickerRect] = useState(null);
  const kpiPickerRef = useRef(null);
  const [kpiSearch, setKpiSearch] = useState("");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
const [tableOpen, setTableOpen] = useState(false);
  const chartContainerRef = useRef(null);
const [cmpBars, setCmpBars] = useState([]);
  const [cmpChartData, setCmpChartData] = useState({});
  const updateCmpBar = (id, patch) => setCmpBars(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeCmpBar = (id) => setCmpBars(prev => prev.filter(b => b.id !== id));
const compareMode = compareModeOuter;

  const KPI_CAP_COMPARE = 2;
  const KPI_CAP_NORMAL = 10;
  const kpiCap = compareMode ? KPI_CAP_COMPARE : KPI_CAP_NORMAL;

  // Truncate KPI selection when the cap tightens (e.g. entering compare mode).
  useEffect(() => {
    setSecKpiIds(prev => prev.length > kpiCap ? prev.slice(0, kpiCap) : prev);
  }, [kpiCap]);

  // Combined & de-duplicated picker list (system + custom), sorted.
  const allPickerKpis = useMemo(() => {
    const seen = new Set();
    const result = [];
    [...(allKpis ?? []), ...(kpiList ?? [])].forEach(k => {
      if (!seen.has(k.id)) { seen.add(k.id); result.push(k); }
    });
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [allKpis, kpiList]);

  // Auto-populate B and C bars when compare mode turns on; clear when it turns off.
  useEffect(() => {
if (compareMode) {
      const others = perspectiveCompanies.filter(c => c !== secCompany && c !== topParent);
      setCmpBars([
        { id: "B", topParent: secTopParent || "", company: others[0] ?? secCompany, source: secSource, structure: secStructure, startYear: secStartYear, startMonth: secStartMonth, endYear: secEndYear, endMonth: secEndMonth },
        { id: "C", topParent: secTopParent || "", company: others[1] ?? others[0] ?? secCompany, source: secSource, structure: secStructure, startYear: secStartYear, startMonth: secStartMonth, endYear: secEndYear, endMonth: secEndMonth },
      ]);
    } else {
      setCmpBars([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

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
const useCompany = scope === "perspective";
    console.log("[graph]", "scope:", scope, "useCompany:", useCompany, "secCompany:", secCompany, "topParent(prop):", topParent, "secTopParent:", secTopParent, "periods:", periods.length);
    if (!token || !secSource || !secStructure || (!useCompany && !secTopParent) || (useCompany && !secCompany) || periods.length < 2) { setChartData([]); return; }
    setLoading(true);
    try {
      const results = await Promise.all(periods.map(async ({ y, m, isPrior }) => {
        const perspectiveForQuery = useCompany ? (topParent || secTopParent) : secTopParent;
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and GroupShortName eq '${perspectiveForQuery}'`;
        const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
        });
        if (!res.ok) return { y, m, isPrior, pivot: new Map() };
        const json = await res.json();
        const rows = useCompany
          ? (json.value ?? []).filter(r => {
              const role = r.CompanyRole ?? r.companyRole ?? "";
              const co   = r.CompanyShortName ?? r.companyShortName ?? "";
              return (role === "Parent" || role === "Contribution") && co === secCompany;
            })
          : (json.value ?? []).filter(r =>
              (r.CompanyRole ?? r.companyRole ?? "") === "Group" &&
              !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim()
            );
const p = new Map();
        const dp = new Map();
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          if (!ac) return;
          const acType = r.AccountType ?? r.accountType ?? "";
          if (acType && acType !== "P/L") return;
          const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          p.set(ac, (p.get(ac) ?? 0) + amt);
          parseDimensions(r.Dimensions ?? "").forEach(([g2, c2]) => {
            if (!g2 || !c2) return;
            const k = `${ac}:::${g2}:::${c2}`;
            dp.set(k, (dp.get(k) ?? 0) + amt);
          });
        });
        p.__dimPivot = dp;
        p.__descendants = groupDescendants;
p.__variationScope = useCompany
          ? { kind: "company", key: secCompany }
          : { kind: "consolidated", key: "__consolidated__" };
        return { y, m, isPrior, pivot: p };
      }));

const series = [];
      console.log("[graph-mode]", "secMode:", secMode, "viewPeriod:", viewPeriod);
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
          const mdp = new Map();
          const currDP = curr.pivot.__dimPivot ?? new Map();
          const prevDP = prev.pivot.__dimPivot ?? new Map();
          const allDPKeys = new Set([...currDP.keys(), ...prevDP.keys()]);
          allDPKeys.forEach(k => {
            mdp.set(k, (currDP.get(k) ?? 0) - (curr.m === 1 ? 0 : (prevDP.get(k) ?? 0)));
          });
          mp.__dimPivot = mdp;
          mp.__descendants = curr.pivot.__descendants;
          mp.__variationScope = curr.pivot.__variationScope;
          pivotForKpi = mp;
        }
        console.log("[graph-eval]", "period:", curr.m, "hasA05:", pivotForKpi.has("A.05"), "descendantsA05:", pivotForKpi.__descendants?.get("A.05"), "dimPivotSize:", pivotForKpi.__dimPivot?.size);
        const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, allKpis);
        const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
        const row = { period: label };
        secKpiIds.forEach(kid => { const v = kpis.get(kid); row[kid] = (v === null || isNaN(v)) ? null : v; });
        series.push(row);
      }
console.log("[graph-series]", "mode:", secMode, "series[0]:", series[0], "series[last]:", series[series.length-1]);
      setChartData(series);
    } catch (e) { console.error("Graph fetch error:", e); }
    finally { setLoading(false); }
}, [token, secSource, secStructure, secTopParent, secCompany, scope, topParent, perspectiveCompanies, periods, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, secMode]);

useEffect(() => { fetchChartData(); }, [fetchChartData]);

useEffect(() => {
    if (!compareMode || !token) { setCmpChartData({}); return; }
    const useCompany = scope === "perspective";
    cmpBars.forEach(bar => {
      const barTop = bar.topParent || secTopParent;
      const barCompany = bar.company || secCompany;
      if (!bar.source || !bar.structure || !barTop) return;
      if (useCompany && !barCompany) return;
      const perspectiveForQuery = useCompany ? (bar.topParent || topParent || secTopParent) : barTop;
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
            const filter = `Year eq ${y} and Month eq ${m} and Source eq '${bar.source}' and GroupStructure eq '${bar.structure}' and GroupShortName eq '${perspectiveForQuery}'`;
            const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
            });
            if (!res.ok) return { y, m, isPrior, pivot: new Map() };
            const json = await res.json();
            const rows = (json.value ?? []).filter(r => {
              const role = r.CompanyRole ?? r.companyRole ?? "";
              const co = r.CompanyShortName ?? r.companyShortName ?? "";
              if (useCompany) {
                return (role === "Parent" || role === "Contribution") && co === barCompany;
              }
              return role === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim();
            });
            const p = new Map();
            const dp = new Map();
            rows.forEach(r => {
              const ac = r.AccountCode ?? r.accountCode ?? "";
              if (!ac) return;
              const acType = r.AccountType ?? r.accountType ?? "";
              if (acType && acType !== "P/L") return;
              const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
              p.set(ac, (p.get(ac) ?? 0) + amt);
              parseDimensions(r.Dimensions ?? "").forEach(([g2, c2]) => {
                if (!g2 || !c2) return;
                const k = `${ac}:::${g2}:::${c2}`;
                dp.set(k, (dp.get(k) ?? 0) + amt);
              });
            });
            p.__dimPivot = dp;
            p.__descendants = groupDescendants;
            p.__variationScope = useCompany
              ? { kind: "company", key: barCompany }
              : { kind: "consolidated", key: "__consolidated__" };
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
              const mdp = new Map();
              const currDP = curr.pivot.__dimPivot ?? new Map();
              const prevDP = prev.pivot.__dimPivot ?? new Map();
              new Set([...currDP.keys(), ...prevDP.keys()]).forEach(k => {
                mdp.set(k, (currDP.get(k) ?? 0) - (curr.m === 1 ? 0 : (prevDP.get(k) ?? 0)));
              });
              mp.__dimPivot = mdp;
              mp.__descendants = curr.pivot.__descendants;
              mp.__variationScope = curr.pivot.__variationScope;
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
  }, [compareMode, cmpBars, token, secTopParent, secMode, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, scope, secCompany, topParent, groupDescendants]);

  useEffect(() => {
if (onStateChange) onStateChange(sectionId, { sectionId, company: secTopParent, startY: secStartYear, startM: secStartMonth, endY: secEndYear, endM: secEndMonth, source: secSource, structure: secStructure, mode: secMode, kpiIds: secKpiIds, chartData, cmpBars, cmpChartData, chartContainerRef, scope, secCompany });
  }, [sectionId, secTopParent, secStartYear, secStartMonth, secEndYear, secEndMonth, secSource, secStructure, secMode, secKpiIds, chartData, cmpBars, cmpChartData, onStateChange, scope, secCompany]);

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
{scope === "perspective"
            ? (perspectiveCompanies.length > 0 && (
                <HeaderFilterPill label="Company" value={secCompany} onChange={setSecCompany}
                  options={perspectiveCompanies.map(c => ({ value: c, label: companyLabelsMap.get(c) ?? c }))} />
              ))
            : (holdingOptions.length > 0 && (
                <HeaderFilterPill label="Perspective" value={secTopParent} onChange={setSecTopParent}
                  options={holdingOptions} />
              ))
          }
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
              <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.55 }}>{tt("label_kpis", "KPIs")}</span>
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
                  {(() => {
                    const systemKpis = allPickerKpis.filter(k => allKpis?.some(s => s.id === k.id) && !kpiList?.some(c => c.id === k.id && c._createdBy));
                    const customKpis = allPickerKpis.filter(k => !systemKpis.some(s => s.id === k.id));
                    const filtered = (group) => group.filter(k => !kpiSearch.trim() || k.label.toLowerCase().includes(kpiSearch.toLowerCase()));
                    const filteredSystem = filtered(systemKpis);
                    const filteredCustom = filtered(customKpis);
                    return (
                      <>
                        {filteredSystem.length > 0 && (
                          <>
                            <div className="flex items-center gap-2 px-2 py-1.5">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors?.primary }} />
                              <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.5 }}>System</span>
                            </div>
                            {filteredSystem.map(k => {
                              const atCap = !secKpiIds.includes(k.id) && secKpiIds.length >= kpiCap;
                              return (
                                <button key={k.id} onClick={() => toggleKpi(k.id)} disabled={atCap}
                                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ background: secKpiIds.includes(k.id) ? "#eef1fb" : "transparent", color: secKpiIds.includes(k.id) ? "#1a2f8a" : "#475569" }}
                                  onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f8f9ff"; }}
                                  onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                                  <span className="truncate">{k.label}</span>
                                  {secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0" style={{ color: colors?.primary }} />}
                                </button>
                              );
                            })}
                          </>
                        )}
                        {filteredCustom.length > 0 && (
                          <>
                            <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#16a34a" }} />
                              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-600" style={{ opacity: 0.7 }}>Custom</span>
                            </div>
                            {filteredCustom.map(k => {
                              const atCap = !secKpiIds.includes(k.id) && secKpiIds.length >= kpiCap;
                              return (
                                <button key={k.id} onClick={() => toggleKpi(k.id)} disabled={atCap}
                                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ background: secKpiIds.includes(k.id) ? "#dcfce7" : "transparent", color: secKpiIds.includes(k.id) ? "#15803d" : "#475569" }}
                                  onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f0fdf4"; }}
                                  onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                                  <span className="truncate">{k.label}</span>
                                  {secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0 text-emerald-600" />}
                                </button>
                              );
                            })}
                          </>
                        )}
                        {filteredSystem.length === 0 && filteredCustom.length === 0 && (
                          <p className="text-[10px] text-gray-300 text-center py-4 font-bold">No results</p>
                        )}
                      </>
                    );
                  })()}
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
                    <button key={id} onClick={() => setCmpBars(prev => [...prev, { id, topParent: secTopParent, company: secCompany, source: secSource, structure: secStructure, startYear: secStartYear, startMonth: secStartMonth, endYear: secEndYear, endMonth: secEndMonth }])}
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
{scope === "perspective"
                ? (perspectiveCompanies.length > 0 && <HeaderFilterPill label="Company" value={bar.company || perspectiveCompanies[0]} onChange={v => updateCmpBar(bar.id, { company: v })} options={perspectiveCompanies.map(c => ({ value: c, label: companyLabelsMap.get(c) ?? c }))} />)
                : (holdingOptions.length > 0 && <HeaderFilterPill label="Perspective" value={bar.topParent} onChange={v => updateCmpBar(bar.id, { topParent: v })} options={holdingOptions} />)}
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
              ])].sort((a, b) => {
                const [ma, ya] = a.split("/");
                const [mb, yb] = b.split("/");
                return ya !== yb ? Number(ya) - Number(yb) : Number(ma) - Number(mb);
              });
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
{(() => {
                const CMP_HEADER_COLORS = { B: "#CF305D", C: "#f59e0b" };
                const CMP_CELL_TINT = { B: "rgba(207,48,93,0.05)", C: "rgba(245,158,11,0.05)" };
                const activeCmpBars = compareMode ? cmpBars : [];
                const visibleKpiIds = secKpiIds.slice(0, kpiCap);
                const allPeriods = compareMode
                  ? [...new Set([
                      ...chartData.map(d => d.period),
                      ...activeCmpBars.flatMap(b => (cmpChartData[b.id] ?? []).map(d => d.period)),
                    ])].sort()
                  : chartData.map(d => d.period);
                const rows = allPeriods.map(period => {
                  const main = chartData.find(d => d.period === period) ?? {};
                  const row = { period };
                  visibleKpiIds.forEach(kid => { row[`a__${kid}`] = main[kid] ?? null; });
                  if (compareMode) {
                    activeCmpBars.forEach(bar => {
                      const barRow = (cmpChartData[bar.id] ?? []).find(d => d.period === period) ?? {};
                      visibleKpiIds.forEach(kid => { row[`${bar.id}__${kid}`] = barRow[kid] ?? null; });
                    });
                  }
                  return row;
                });
                const renderCell = (v, fmt, key, cmpId = null) => {
                  const isNull = v === null || v === undefined || isNaN(v);
                  const tint = cmpId ? CMP_CELL_TINT[cmpId] : undefined;
                  return (
                    <td key={key} className="px-4 py-2 text-xs font-semibold text-center whitespace-nowrap"
                      style={{ color: isNull ? "#d1d5db" : v < 0 ? "#ef4444" : "#111827", background: tint }}>
                      {isNull ? "—" : fmtValue(v, fmt)}
                    </td>
                  );
                };
                return (
                  <>
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="text-center px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap" style={{ background: colors?.primary }}>Period</th>
                        {visibleKpiIds.map(kid => {
                          const k = kpiList.find(k => k.id === kid);
                          const label = k?.label ?? kid;
                          return (
                            <Fragment key={kid}>
                              <th className="text-center px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/90 whitespace-nowrap" style={{ background: colors?.primary }}>
                                {compareMode ? `A · ${label}` : label}
                              </th>
                              {compareMode && activeCmpBars.map(bar => (
                                <th key={`${kid}-${bar.id}`} className="text-center px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/90 whitespace-nowrap" style={{ background: CMP_HEADER_COLORS[bar.id] ?? colors?.primary }}>
                                  {`${bar.id} · ${label}`}
                                </th>
                              ))}
                            </Fragment>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                          <td className="px-4 py-2 text-xs font-bold whitespace-nowrap text-center" style={{ color: colors?.primary }}>{d.period}</td>
                          {visibleKpiIds.map(kid => {
                            const k = kpiList.find(k => k.id === kid);
                            return (
                              <Fragment key={kid}>
                                {renderCell(d[`a__${kid}`], k?.format, `${i}-a-${kid}`)}
                                {compareMode && activeCmpBars.map(bar => renderCell(d[`${bar.id}__${kid}`], k?.format, `${i}-${bar.id}-${kid}`, bar.id))}
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </>
                );
              })()}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
async function renderChartToImage({ data, series, width = 1100, height = 480 }) {
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
        <LineChart data={data} width={width - 24} height={height - 56} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1fb" />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6b7280" }} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }}
            tickFormatter={v => Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={10} />
          {(series || []).map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
              isAnimationActive={false}
              stroke={s.color} strokeWidth={2.2}
              strokeDasharray={s.dash ?? undefined}
              dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
          ))}
        </LineChart>
      </div>
    );
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 250));
    const canvas = await html2canvas(host, { backgroundColor: "#ffffff", scale: 2, logging: false });
    return canvas.toDataURL("image/png");
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
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
  // Monotonic progress based on real readiness signals.
  const target = !metaReady ? 30 : !kpiResolverReady ? 65 : 100;
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
export default function ConsolidatedKpiPage({ token, groupAccounts: groupAccountsProp = [], activeStandardKey = null }) {
  const [authUserId, setAuthUserId] = useState(null);
  const [companyId, setCompanyId]   = useState(null);
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setAuthUserId(uid);
      if (uid) { const cid = await getActiveCompanyId(uid); setCompanyId(cid); }
    })();
}, []);
  const header2Style = useTypo("header2");
  const body1Style   = useTypo("body1");
  const body2Style   = useTypo("body2");
  const underscore2Style = useTypo("underscore2");
  const underscore3Style = useTypo("underscore3");
  const filterStyle  = useTypo("filter");
  const { colors, locale } = useSettings();
  const tt = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const { getLatestPeriod, setLatestPeriod } = useLatestPeriod();

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
  const [graphScope,   setGraphScope]   = useState("consolidated");
  const [viewPeriod,   setViewPeriod]   = useState("ytd");
  const [viewsModalOpen, setViewsModalOpen] = useState(false);
  const [activeMapping,  setActiveMapping]  = useState(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [dragIdx,    setDragIdx]    = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [colDragIdx,  setColDragIdx]  = useState(null);
  const [colDragOverIdx, setColDragOverIdx] = useState(null);
const [colOrder,   setColOrder]   = useState(null);
const [selGroups,  setSelGroups]  = useState(null);
  const [selDims,    setSelDims]    = useState(null);
const [exporting,  setExporting]  = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState({
    company: true,
    dimension: true,
    graphs: true,
    inlineDefs: true,
    defsSheet: true,
    format: "xlsx",
  });
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
  const { kpiList: resolvedKpiList, allKpis: resolvedAllKpis, ccTagToCodes: defaultCcTagToCodes, sectionCodes, ready: kpiResolverReady } = useResolvedKpiList(groupAccounts, companyId, activeStandardKey);

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
  const [statParties, setStatParties] = useState([]);
  const [companyKpis, setCompanyKpis] = useState([]);
const [dashboardKpiIds, setDashboardKpiIds] = useState(null);
  const [dashboardKpiIdsDim, setDashboardKpiIdsDim] = useState(null);
 const [editingKpi,      setEditingKpi]      = useState(null);
  const [individualKpis,  setIndividualKpis]  = useState([]);
  const [showImportPanel, setShowImportPanel] = useState(false);

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
      variations:         k.variations ?? null,
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
          variations:        overrideData.variations ?? null,
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
          variations:        overrideData.variations ?? null,
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

const buildKpiList = useCallback((ids, overrideScope) => {
    if (!ids) return [];
    const scope = overrideScope ?? (viewMode === "dimensions" ? "dim" : "comp");
    const byId = new Map();
    resolvedAllKpis.forEach(k => byId.set(k.id, k));
    resolvedKpiList.forEach(k => byId.set(k.id, k));
    localKpis.forEach(k => byId.set(k.id, k));
    const seen = new Set();
    return ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; }).map(id => {
      const base = byId.get(id);
      if (!base) return null;
if (builtInKpiIds.has(id)) {
        const overrideMap = scope === "dim" ? systemOverrides.dim : systemOverrides.comp;
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
            variations:  override.variations ?? null,
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

  // ── Statistical parties (partidas estadísticas) as KPI variables ──────────
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data, error } = await supabase.rpc("list_statistical_parties");
      if (error) { console.error("[ConsolidatedKpiPage] statistical parties load failed:", error); return; }
      setStatParties((data ?? []).map(r => ({
        id: r.id, name: r.name, unit: r.unit ?? "",
        companies: r.companies ?? [], years: r.years ?? [],
        dimGroups: r.dim_groups ?? [], dims: r.dims ?? [],
        sharedAcrossCompanies: r.shared_across_companies !== false,
        values: r.values ?? {},
      })));
    })();
  }, [companyId]);

  const partiesById = useMemo(() => {
    const m = new Map();
    statParties.forEach(p => m.set(p.id, p));
    return m;
  }, [statParties]);

  // Scope handed to the editor picker + preview: the whole consolidation
  // (all contributing companies), current period. selectedDims null → sum all.
  const partyContext = useMemo(() => ({
    companies: contributionCompanies,
    year: parseInt(year) || null,
    month: parseInt(month) || null,
    selectedDims: null,
  }), [contributionCompanies, year, month]);

  const evalPartyValue = useCallback((partyId) => {
    const p = partiesById.get(partyId);
    if (!p) return null;
    const yr = String(year);
    const mo = parseInt(month);
    const sumTree = (tree) => {
      const ym = tree?.[yr];
      if (!ym) return 0;
      let t = 0;
      for (const dim of (p.dims || [])) {
        const cell = ym[dim]?.[mo];
        if (cell == null) continue;
        const v = typeof cell === "object" ? cell.value : cell;
        if (typeof v === "number") t += v;
      }
      return t;
    };
    if (p.sharedAcrossCompanies !== false) return sumTree(p.values ?? {});
    let total = 0;
    for (const co of contributionCompanies) {
      if (p.companies?.length && !p.companies.includes(co)) continue;
      total += sumTree(p.values?.[co] ?? {});
    }
    return total;
  }, [partiesById, year, month, contributionCompanies]);

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

  // Auto-find latest period — fast-path from React context cache, then
  // sessionStorage prefetch (populated by EpicLoader), then probe backwards.
  const autoPeriodDone = useRef(false);
  useEffect(() => {
    if (autoPeriodDone.current || !metaReady || !source || !structure || !topParent) return;
    autoPeriodDone.current = true;

    // FAST PATH 1: React context cache
    const cached = getLatestPeriod(source, structure, topParent);
    if (cached?.year && cached?.month) {
      setYear(String(cached.year));
      setMonth(String(cached.month));
      return;
    }

    // FAST PATH 2: sessionStorage prefetch
    try {
      const ssKey = `home_latest_period_${source}_${structure}_${topParent}`;
      const ssRaw = sessionStorage.getItem(ssKey);
      if (ssRaw) {
        const parsed = JSON.parse(ssRaw);
        if (parsed.year && parsed.month) {
          setYear(String(parsed.year));
          setMonth(String(parsed.month));
          setLatestPeriod(source, structure, topParent, parsed.year, parsed.month);
          return;
        }
      }
    } catch { /* ignore */ }

    // SLOW PATH: probe backwards from today
    (async () => {
      const now = new Date(); let y = now.getFullYear(), m = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
          const res = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const json = await res.json();
            if ((json.value ?? []).length > 0) {
              setYear(String(y));
              setMonth(String(m));
              setLatestPeriod(source, structure, topParent, y, m);
              return;
            }
          }
        } catch { break; }
        m--; if (m < 1) { m = 12; y--; }
      }
    })();
  }, [metaReady, source, structure, topParent, token, getLatestPeriod, setLatestPeriod]);

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
useEffect(() => {
    if (!groupAccounts.length) return;
    const a05 = groupAccounts.find(g => (g.AccountCode ?? g.accountCode) === "A.05");
const a05Rows = rawData.filter(r => (r.AccountCode ?? r.accountCode) === "A.05");
    if (a05Rows.length) {
    }
    // Y por descendientes reales:
    const a05Descendants = groupDescendants.get("A.05") ?? [];
    const rowsForDescendants = rawData.filter(r => a05Descendants.includes(r.AccountCode ?? r.accountCode) && r.CompanyRole === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim());
  }, [groupAccounts, rawData]);

// Map<parent AccountCode, [all descendant AccountCodes, including sum sub-parents]>
  // Used by the "accountGroup" KPI variable to sum values for sum accounts
  // (like A.05) which never appear as a row themselves — only their children do.
  const groupDescendants = useMemo(() => {
    const parentToChildren = new Map();
    groupAccounts.forEach(g => {
      const code   = String(g.AccountCode ?? g.accountCode ?? "");
      const parent = String(g.SumAccountCode ?? g.sumAccountCode ?? "");
      if (!code || !parent) return;
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
      parentToChildren.get(parent).push(code);
    });
    // Depth-first walk: for each code, collect ALL transitive descendants.
    const result = new Map();
    const collect = (code) => {
      if (result.has(code)) return result.get(code);
      const direct = parentToChildren.get(code) ?? [];
      const all = new Set(direct);
      direct.forEach(child => collect(child).forEach(x => all.add(x)));
      const arr = [...all];
      result.set(code, arr);
      return arr;
    };
    [...parentToChildren.keys()].forEach(collect);
    return result;
  }, [groupAccounts]);

  const sumAccountCodes = useMemo(() => {
    const sums = new Set();
    groupAccounts.forEach(g => { if (g.IsSumAccount === true || g.isSumAccount === true) sums.add(String(g.AccountCode ?? g.accountCode ?? "")); });
    return sums;
  }, [groupAccounts]);


const buildPivots = useCallback((rows, prevRows, mo, yr) => {
    const effYear = yr ?? year;
    const isJanuary = parseInt(mo) === 1;

    // Ancestor map so a leaf row's amount also flows into its sum-account
    // parents in the per-dim lookup. Built once per buildPivots call.
    const parentOfLocal = new Map();
    (groupAccounts || []).forEach(ga => {
      const c = String(ga.AccountCode ?? ga.accountCode ?? "");
      const p = String(ga.SumAccountCode ?? ga.sumAccountCode ?? "");
      if (c && p) parentOfLocal.set(c, p);
    });
    const ancestorsOf = (code) => {
      const out = [];
      let cur = parentOfLocal.get(code);
      let hops = 0;
      while (cur && hops < 25) { out.push(cur); cur = parentOfLocal.get(cur); hops++; }
      return out;
    };

// Helper: build raw YTD pivot for a set of rows
    const hasGroupFilter = Array.isArray(selGroups) && selGroups.length > 0;
    const hasDimFilter   = Array.isArray(selDims)   && selDims.length   > 0;
const buildRaw = (rs) => {
      const p = new Map();
      // Sub-lookup: "accountCode:::dimGroup:::dimCode" -> amount
      const dimP = new Map();
rs.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (acType && acType !== "P/L") return;
if (Array.isArray(selGroups) && selGroups.length === 0) return;
        if (Array.isArray(selDims) && selDims.length === 0) return;
        const rowPairs = parseDimensions(r.Dimensions ?? "");
        if (hasGroupFilter || hasDimFilter) {
          if (rowPairs.length === 0) return;
          const passes = rowPairs.some(([grp, code]) =>
            (!hasGroupFilter || selGroups.includes(grp)) &&
            (!hasDimFilter   || selDims.includes(code))
          );
          if (!passes) return;
        }
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
p.set(ac, (p.get(ac) ?? 0) + amt);
        // Also index this amount by every (group, code) dim pair AND by each
        // ancestor sum account, so variation overrides like
        // "sumAccount X → dim Y:Z" can resolve directly and match the plain
        // pageheader-filter behaviour.
// Never propagate to ancestors — in the consolidated dataset the
        // sum account row already carries the aggregate. Indexing only under
        // ac avoids double-counting when both parent and child rows exist.
        rowPairs.forEach(([grp, code]) => {
          const k = `${ac}:::${grp}:::${code}`;
          dimP.set(k, (dimP.get(k) ?? 0) + amt);
        });
      });
      p.__dimPivot = dimP;
      return p;
    };

    // Monthly = curr - prev
const toMonthly = (curr, prev) => {
      const mp = new Map();
      const all = new Set([...curr.keys(), ...prev.keys()]);
      all.forEach(ac => { mp.set(ac, (curr.get(ac) ?? 0) - (isJanuary ? 0 : (prev.get(ac) ?? 0))); });
      // Same for the per-dim sub-lookup
      const currDim = curr.__dimPivot ?? new Map();
      const prevDim = prev.__dimPivot ?? new Map();
      const dimAll = new Set([...currDim.keys(), ...prevDim.keys()]);
      const mpDim = new Map();
      dimAll.forEach(k => { mpDim.set(k, (currDim.get(k) ?? 0) - (isJanuary ? 0 : (prevDim.get(k) ?? 0))); });
      mp.__dimPivot = mpDim;
      return mp;
    };

    const result = new Map();
// Consolidated column
    // rows = current month YTD, prevRows = previous month YTD.
    // Monthly is computed as (curr - prev). We don't need a month filter on
    // rows because each fetch already targets a single month.
    const moNum = parseInt(mo);
    const isGroupPure = r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim();
    const consGroupRows = rows.filter(isGroupPure);
    const consGroupPrev = prevRows.filter(isGroupPure);
    const consYTD  = buildRaw(consGroupRows);
    const consPYTD = buildRaw(consGroupPrev);
    const consPivot = viewPeriod === "ytd" ? consYTD : toMonthly(consYTD, consPYTD);
consPivot.__parties = partiesById;
    consPivot.__partyContext = { companies: contributionCompanies, year: parseInt(effYear) || null, month: parseInt(mo) || null, selectedDims: null };
    consPivot.__descendants = groupDescendants;
    consPivot.__variationScope = { kind: "consolidated", key: "__consolidated__" };
    result.set("__consolidated__", consPivot);

// Per-subsidiary columns
    contributionCompanies.forEach(co => {
      const role = co === topParent ? "Parent" : "Contribution";
const coRows = rows.filter(r => (r.CompanyShortName ?? r.companyShortName ?? "") === co && (r.CompanyRole ?? r.companyRole ?? "") === role);
      const coPrev = prevRows.filter(r => (r.CompanyShortName ?? r.companyShortName ?? "") === co && (r.CompanyRole ?? r.companyRole ?? "") === role);
      const coYTD  = buildRaw(coRows);
      const coPYTD = buildRaw(coPrev);
      const coPivot = viewPeriod === "ytd" ? coYTD : toMonthly(coYTD, coPYTD);
coPivot.__parties = partiesById;
      coPivot.__partyContext = { companies: [co], year: parseInt(effYear) || null, month: parseInt(mo) || null, selectedDims: null };
      coPivot.__descendants = groupDescendants;
      coPivot.__variationScope = { kind: "company", key: co };
      result.set(co, coPivot);
    });

    return result;
}, [contributionCompanies, topParent, sumAccountCodes, viewPeriod, partiesById, year, selGroups, selDims, groupDescendants, groupAccounts]);

const pivots    = useMemo(() => buildPivots(rawData, rawDataPrev, month), [rawData, rawDataPrev, month, buildPivots]);
const pivotsCmp = useMemo(() => buildPivots(rawDataCmp, rawDataCmpPrev, cmpMonth, cmpYear), [rawDataCmp, rawDataCmpPrev, cmpMonth, cmpYear, buildPivots]);



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
          if (!ac) return;
          if (acType && acType !== "P/L") return;
const allRowPairs = parseDimensions(r.Dimensions ?? "");
          allRowPairs.forEach(([grp, code]) => {
            if (Array.isArray(selGroups) && selGroups.length > 0 && !selGroups.includes(grp)) return;
            if (Array.isArray(selDims) && selDims.length > 0 && !selDims.includes(code)) return;
            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            if (!pivots.has(code)) {
              const p = new Map();
              p.__dimPivot = new Map();
              p.__descendants = groupDescendants;
              pivots.set(code, { name: dimNameLookup.get(grp)?.get(code) ?? code, group: grp, pivot: p });
            }
            const entry = pivots.get(code);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
            allRowPairs.forEach(([g2, c2]) => {
              const k = `${ac}:::${g2}:::${c2}`;
              entry.pivot.__dimPivot.set(k, (entry.pivot.__dimPivot.get(k) ?? 0) + amt);
            });
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
      const mdp = new Map();
      const cDP = c?.pivot.__dimPivot ?? new Map();
      const pDP = p?.pivot.__dimPivot ?? new Map();
      new Set([...cDP.keys(), ...pDP.keys()]).forEach(k => {
        mdp.set(k, (cDP.get(k) ?? 0) - (isJanuary ? 0 : (pDP.get(k) ?? 0)));
      });
      mp.__dimPivot = mdp;
      mp.__descendants = groupDescendants;
      mp.__variationScope = { kind: "dimension", key };
      result.set(key, { name: meta.name, group: meta.group, pivot: mp });
    });
    return result;
}, [rawDataCmp, rawDataCmpPrev, viewPeriod, cmpMonth, sumAccountCodes, selGroups, selDims, dimNameLookup, groupDescendants]);

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

  // Global dims cache — accumulates across all perimeters visited during this
  // session so the KPI variation editor always sees every dim, not just the
  // ones present in the currently loaded rawData.
  const allDimsByGroupRef = useRef(new Map());
  const [allDimsByGroupVersion, setAllDimsByGroupVersion] = useState(0);
  useEffect(() => {
    let changed = false;
    dimsByGroup.forEach((codeMap, group) => {
      if (!allDimsByGroupRef.current.has(group)) {
        allDimsByGroupRef.current.set(group, new Map());
      }
      const target = allDimsByGroupRef.current.get(group);
      codeMap.forEach((name, code) => {
        if (!target.has(code) || target.get(code) !== name) {
          target.set(code, name);
          changed = true;
        }
      });
    });
if (changed) setAllDimsByGroupVersion(v => v + 1);
  }, [dimsByGroup]);

  // Flat list of every dim ever seen this session, for the KPI variation editor.
  // Re-derives whenever the accumulator gains new entries.
const allDimensionsFlat = useMemo(() => {
    const out = [];
    const seen = new Set();
    // Prefer the global lookup (all dims that exist in the tenant),
    // falling back to the accumulator, then to the current perimeter.
    if (dimNameLookup && dimNameLookup.size > 0) {
      dimNameLookup.forEach((codeMap, group) => {
        codeMap.forEach((name, code) => {
          const k = `${group}:::${code}`;
          if (seen.has(k)) return;
          seen.add(k);
          out.push({ code, name: name ?? code, group });
        });
      });
    }
dimsByGroup.forEach((codeMap, group) => {
      codeMap.forEach((name, code) => {
        const k = `${group}:::${code}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ code, name: name ?? code, group });
      });
    });
    return out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDimsByGroupVersion, dimsByGroup, dimNameLookup]);

const groupDimOptions = useMemo(() => {
    const groups = (selGroups && selGroups.length > 0) ? selGroups : [...dimsByGroup.keys()];
    const out = [];
    groups.forEach(g => {
      const m = dimsByGroup.get(g);
      if (m) m.forEach((name, code) => out.push({ code, name, group: g }));
    });
    return out;
  }, [dimsByGroup, selGroups]);

const dimensionPivots = useMemo(() => {
    const buildDimPivots = (rows) => {
      const pivots = new Map();
      rows
        .filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
        .forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (acType && acType !== "P/L") return;
const allRowPairs = parseDimensions(r.Dimensions ?? "");
allRowPairs.forEach(([grp, code]) => {
            if (Array.isArray(selGroups) && selGroups.length === 0) return;
            if (Array.isArray(selDims) && selDims.length === 0) return;
            if (Array.isArray(selGroups) && selGroups.length > 0 && !selGroups.includes(grp)) return;
            if (Array.isArray(selDims) && selDims.length > 0 && !selDims.includes(code)) return;
            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
           if (!pivots.has(code)) {
              const p = new Map();
              p.__dimPivot = new Map();
              p.__descendants = groupDescendants;
              pivots.set(code, { name: dimNameLookup.get(grp)?.get(code) ?? code, group: grp, pivot: p });
            }
            const entry = pivots.get(code);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
            // Also index into per-dim sublookup so variation overrides
            // like "A.05 dim UK" resolve within a dimension column.
            allRowPairs.forEach(([g2, c2]) => {
              const k = `${ac}:::${g2}:::${c2}`;
              entry.pivot.__dimPivot.set(k, (entry.pivot.__dimPivot.get(k) ?? 0) + amt);
            });
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
      const mdp = new Map();
      const cDP = c?.pivot.__dimPivot ?? new Map();
      const pDP = p?.pivot.__dimPivot ?? new Map();
      new Set([...cDP.keys(), ...pDP.keys()]).forEach(k => {
        mdp.set(k, (cDP.get(k) ?? 0) - (isJanuary ? 0 : (pDP.get(k) ?? 0)));
      });
      mp.__dimPivot = mdp;
      mp.__descendants = groupDescendants;
      mp.__variationScope = { kind: "dimension", key };
      result.set(key, { name: meta.name, group: meta.group, pivot: mp });
    });
    return result;
}, [rawData, rawDataPrev, viewPeriod, month, sumAccountCodes, selGroups, selDims, dimNameLookup, groupDescendants]);

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
    if (metaReady) pct += 20;
    if (!loading && metaReady) pct += 25;
    return Math.min(100, pct);
  }, [year, month, sources.length, structures.length, companiesAll.length, groupAccounts.length, rawData.length, metaReady, loading]);

  const animatedKpiDashProgress = useAnimatedNumber(kpiDashProgress, 700);
  const kpiDashReadyOnce = useRef(false);
  if (kpiDashProgress >= 100) kpiDashReadyOnce.current = true;
  const kpiDashReady = kpiDashReadyOnce.current;

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
      if (code && name) map.set(code, name);
    });
    // Also add labels from rawData account descriptions — fill in codes still
    // missing a name, or upgrade codes whose stored name is empty.
    rawData.forEach(r => {
      const code = String(r.AccountCode ?? r.accountCode ?? "");
      const name = String(r.AccountName ?? r.accountName ?? r.AccountDescription ?? r.accountDescription ?? "");
      if (code && name && !map.get(code)) map.set(code, name);
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
        entry.pivot.__variationScope = { kind: "dimension", key };
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
      dimensionPivotsCmp.forEach((entry, key) => {
        entry.pivot.__variationScope = { kind: "dimension", key };
        r.set(key, computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis));
      });
    } else {
      pivotsCmp.forEach((p, col) => {
        p.__variationScope = { kind: "company", key: col };
        r.set(col, computeAllKpisResolved(kpiList, p, ccTagToCodes, sectionCodes, resolvedAllKpis));
      });
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
        console.log("[saveKpi->override]", "variations being sent:", JSON.stringify(data.variations));
        await saveSystemOverride(editingKpi.id, {
          label:       editingKpi.label,
          description: data.description,
          category:    data.category,
          format:      data.format ?? editingKpi.format,
          formula:     data.formula ?? editingKpi.formula,
          benchmark:   data.benchmark,
          variations:  data.variations ?? null,
        });
        setEditingKpi(null);
        refreshCompanyKpis();
        return;
      }

if (isBuiltIn && labelChanged) {
        try {
          const allLabels = new Set([...localKpis.map(k => k.label), ...resolvedAllKpis.map(k => k.label)]);
          allLabels.delete(editingKpi.label);
          const finalLabel = data.label;
          if ([...allLabels].some(l => l.toLowerCase() === finalLabel.toLowerCase())) {
            alert(`Ya existe un KPI llamado "${finalLabel}". Elige un nombre único.`);
            return;
          }
const created = await createCompanyKpi({ companyId, userId: authUserId, label: finalLabel, description: data.description ?? null, category: data.category ?? null, tag: data.tag ?? null, format: data.format ?? "currency", formula: data.formula ?? editingKpi.formula, benchmark: data.benchmark ?? null, variations: data.variations ?? null, contextMappingId: null, scope: "consolidated" });
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
        console.log("[saveKpi->update]", "variations being sent:", JSON.stringify(data.variations));
const updated = await updateCompanyKpi({ kpiId: editingKpi.id, userId: authUserId, label: data.label, description: data.description ?? null, category: data.category ?? null, tag: data.tag ?? null, format: data.format ?? "currency", formula: data.formula, benchmark: data.benchmark ?? null, variations: data.variations ?? null, sourceSystemKpiId: null });
        console.log("[saveKpi->update] response variations:", JSON.stringify(updated?.variations));
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
              variations:        base.variations ?? null,
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
      const finalLabel = data.label;
      if ([...allLabels].some(l => l.toLowerCase() === finalLabel.toLowerCase())) {
        alert(`Ya existe un KPI llamado "${finalLabel}". Elige un nombre único.`);
        return;
      }
const created = await createCompanyKpi({ companyId, userId: authUserId, label: finalLabel, description: data.description ?? null, category: data.category ?? null, tag: (data.tag && !data.tag.startsWith("__")) ? data.tag : null, format: data.format ?? "currency", formula: data.formula, benchmark: data.benchmark ?? null, variations: data.variations ?? null, contextMappingId: activeMapping?.mapping_id ?? null, scope: "consolidated" });
      setCompanyKpis(prev => [...prev, created]);
      addToDashboard(created.kpi_id, viewMode === "dimensions" ? "consolidated_dimension" : "consolidated_company");
      setEditingKpi(null);
      refreshCompanyKpis();
    } catch (e) { alert(`Create failed: ${e.message}`); }
  }, [companyId, authUserId, editingKpi, activeMapping, companyKpis, addToDashboard, builtInKpiIds, systemOverrides, OVERRIDE_TAG_PREFIX, persistDashboard, refreshCompanyKpis]);

  // ── Export ─────────────────────────────────────────────────────────
// Fetch consolidated data for a given range and produce a series of KPI values per period.
const fetchSectionData = useCallback(async (sectionConfig) => {
    const { startY, startM, endY, endM, source: secSource, structure: secStructure,
            topParent: secTop, dimGroup, dim, mode, kpiIds,
            scope: secScope, company: secCompanyArg } = sectionConfig;
    if (!token || !secSource || !secStructure || !secTop) return [];
    const useCompany = secScope === "perspective" && secCompanyArg;

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
      const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and GroupShortName eq '${secTop}'`;
      try {
        const res = await fetch(
          `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );
        if (!res.ok) return { y, m, isPrior, pivot: new Map(), hasData: false };
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        const p = new Map();
const dimPivot = new Map();
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (acType && acType !== "P/L") return;
          const role = r.CompanyRole ?? r.companyRole ?? "";
          const co = r.CompanyShortName ?? r.companyShortName ?? "";
          if (useCompany) {
            if (!(role === "Parent" || role === "Contribution") || co !== secCompanyArg) return;
          } else {
            if (role !== "Group" || (r.OriginCompanyShortName?.trim()) || (r.CounterpartyShortName?.trim())) return;
          }
          const hasDim   = Array.isArray(dim)      ? dim.length      > 0 : !!dim;
          const hasGroup = Array.isArray(dimGroup) ? dimGroup.length > 0 : !!dimGroup;
          if (hasDim || hasGroup) {
            const dimPairs = parseDimensions(r.Dimensions);
            if (hasDim) {
              const dimArr = Array.isArray(dim) ? dim : [dim];
              const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
              if (!dimArr.some(d => rowDimCodes.has(d))) return;
            } else if (hasGroup) {
              const grpArr = Array.isArray(dimGroup) ? dimGroup : [dimGroup];
              const dimPairs2 = parseDimensions(r.Dimensions);
              if (!grpArr.some(g => dimPairs2.some(([rg]) => rg === g))) return;
            }
          }
const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          p.set(ac, (p.get(ac) ?? 0) + amt);
          parseDimensions(r.Dimensions ?? "").forEach(([g2, c2]) => {
            if (!g2 || !c2) return;
            const k = `${ac}:::${g2}:::${c2}`;
            dimPivot.set(k, (dimPivot.get(k) ?? 0) + amt);
          });
        });
        p.__dimPivot = dimPivot;
        p.__descendants = groupDescendants;
        p.__variationScope = useCompany
          ? { kind: "company", key: secCompanyArg }
          : { kind: "consolidated", key: "__consolidated__" };
        return { y, m, isPrior, pivot: p, hasData: rows.length > 0 };
      } catch {
        return { y, m, isPrior, pivot: new Map(), hasData: false };
      }
    }));

    const seriesOut = [];
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
        const mdp = new Map();
        const currDP = curr.pivot.__dimPivot ?? new Map();
        const prevDP = prev.pivot.__dimPivot ?? new Map();
        new Set([...currDP.keys(), ...prevDP.keys()]).forEach(k => {
          mdp.set(k, (currDP.get(k) ?? 0) - (curr.m === 1 ? 0 : (prevDP.get(k) ?? 0)));
        });
        mp.__dimPivot = mdp;
        mp.__descendants = groupDescendants;
        mp.__variationScope = curr.pivot.__variationScope;
        pivotForKpi = mp;
      }
      const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, resolvedAllKpis);
      const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
      const row = { period: label };
      kpiIds.forEach(kid => {
        const v = kpis.get(kid);
        row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v;
      });
      seriesOut.push(row);
    }
    return seriesOut;
  }, [token, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis, groupDescendants]);

  const buildGraphSections = useCallback(async () => {
    const result = [];
    for (const sid of [1]) {
      const live = graphSectionsRef.current[sid];
      const defaults = (() => {
        const anchorY = parseInt(year) || new Date().getFullYear();
        const anchorM = parseInt(month) || new Date().getMonth() + 1;
        let sY = anchorY, sM = anchorM - 11;
        while (sM < 1) { sM += 12; sY -= 1; }
        return { startY: String(sY), startM: String(sM), endY: String(anchorY), endM: String(anchorM), source, structure, topParent };
      })();
      const baseConfig = {
        sectionId: sid,
        topParent: live?.company ?? defaults.topParent,
        startY:   live?.startY   ?? defaults.startY,
        startM:   live?.startM   ?? defaults.startM,
        endY:     live?.endY     ?? defaults.endY,
        endM:     live?.endM     ?? defaults.endM,
        source:   live?.source   ?? defaults.source,
        structure: live?.structure ?? defaults.structure,
        dimGroup: live?.dimGroup ?? "",
        dim:      live?.dim      ?? "",
        kpiIds:   (live?.kpiIds?.length ? live.kpiIds : ["revenue", "gross_profit", "net_result"]),
      };
      const cmpBarsLive = Array.isArray(live?.cmpBars) ? live.cmpBars : [];
      const isCompare = cmpBarsLive.length > 0;
      const liveCmpData = live?.cmpChartData ?? {};
      const liveMain = Array.isArray(live?.chartData) ? live.chartData : null;
      const liveMode = live?.mode ?? "ytd";

      const CMP_COLORS = { B: "#CF305D", C: "#f59e0b" };
      const RAINBOW    = ["#1a2f8a", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
      const series = [];
      baseConfig.kpiIds.forEach((kid, i) => {
        const kpi = kpiList.find(k => k.id === kid);
        series.push({
          key:    `a__${kid}`,
          label:  isCompare ? `A · ${kpi?.label ?? kid}` : (kpi?.label ?? kid),
          color:  isCompare ? "#1a2f8a" : RAINBOW[i % RAINBOW.length],
          dash:   isCompare && i === 1 ? "5 4" : undefined,
          kpiId:  kid, barId: "a", format: kpi?.format,
        });
      });
      cmpBarsLive.forEach(bar => {
        baseConfig.kpiIds.slice(0, 2).forEach((kid, i) => {
          const kpi = kpiList.find(k => k.id === kid);
          series.push({
            key:    `${bar.id}__${kid}`,
            label:  `${bar.id} · ${kpi?.label ?? kid}`,
            color:  CMP_COLORS[bar.id] ?? "#CF305D",
            dash:   i === 1 ? "5 4" : undefined,
            kpiId:  kid, barId: bar.id, format: kpi?.format,
          });
        });
      });

      const mergeRows = (primaryArr, cmpDataMap) => {
        const allPeriods = new Set();
        (primaryArr ?? []).forEach(d => allPeriods.add(d.period));
        Object.values(cmpDataMap ?? {}).forEach(arr => (arr ?? []).forEach(d => allPeriods.add(d.period)));
return [...allPeriods].sort((a, b) => {
          const [ma, ya] = a.split("/");
          const [mb, yb] = b.split("/");
          return ya !== yb ? Number(ya) - Number(yb) : Number(ma) - Number(mb);
        }).map(period => {
          const row = { period };
          const pRow = (primaryArr ?? []).find(d => d.period === period) ?? {};
          baseConfig.kpiIds.forEach(kid => { row[`a__${kid}`] = Number.isFinite(pRow[kid]) ? pRow[kid] : null; });
          Object.entries(cmpDataMap ?? {}).forEach(([barId, arr]) => {
            const barRow = (arr ?? []).find(d => d.period === period) ?? {};
            baseConfig.kpiIds.forEach(kid => { row[`${barId}__${kid}`] = Number.isFinite(barRow[kid]) ? barRow[kid] : null; });
          });
          return row;
        });
      };

      const fetchModeData = async (mode) => {
const isPerspective = live?.scope === "perspective";
        const primaryConfig = {
          ...baseConfig,
          mode,
          scope: live?.scope,
          topParent: isPerspective ? topParent : baseConfig.topParent,
          company: isPerspective ? (live?.company || baseConfig.topParent) : null,
        };
        const primary = await fetchSectionData(primaryConfig);
const cmpMap = {};
        for (const bar of cmpBarsLive) {
          cmpMap[bar.id] = await fetchSectionData({
            mode,
            topParent: isPerspective ? topParent : (bar.topParent || baseConfig.topParent),
            startY: baseConfig.startY, startM: baseConfig.startM,
            endY:   baseConfig.endY,   endM:   baseConfig.endM,
            source: bar.source, structure: bar.structure,
            dimGroup: bar.dimGroup ?? "", dim: bar.dim ?? "",
            kpiIds: baseConfig.kpiIds,
            scope: live?.scope,
            company: isPerspective ? (bar.company || live?.company) : null,
          });
        }
        return { primary, cmpMap };
      };

      let ytdMerged, monthlyMerged;
      if (liveMain && liveMain.length > 0 && liveMode === "ytd") {
        ytdMerged = mergeRows(liveMain, liveCmpData);
        const m = await fetchModeData("monthly");
        monthlyMerged = mergeRows(m.primary, m.cmpMap);
      } else if (liveMain && liveMain.length > 0 && liveMode === "monthly") {
        monthlyMerged = mergeRows(liveMain, liveCmpData);
        const y = await fetchModeData("ytd");
        ytdMerged = mergeRows(y.primary, y.cmpMap);
      } else {
        const [y, m] = await Promise.all([fetchModeData("ytd"), fetchModeData("monthly")]);
        ytdMerged     = mergeRows(y.primary, y.cmpMap);
        monthlyMerged = mergeRows(m.primary, m.cmpMap);
      }

      const renderImg = async (data) => {
        if (!data || data.length === 0) return null;
        try { return await renderChartToImage({ data, series }); }
        catch (e) { console.warn("Chart render failed:", e); return null; }
      };
      const [ytdImg, monthlyImg] = await Promise.all([renderImg(ytdMerged), renderImg(monthlyMerged)]);

      result.push({
        sectionId: sid,
        company: baseConfig.topParent,
        companies: [baseConfig.topParent],
        startY: baseConfig.startY, startM: baseConfig.startM,
        endY:   baseConfig.endY,   endM:   baseConfig.endM,
        source: baseConfig.source, structure: baseConfig.structure,
        dimGroup: baseConfig.dimGroup, dim: baseConfig.dim,
        kpiIds: baseConfig.kpiIds,
        ytdData:     ytdMerged,     ytdImg,
        monthlyData: monthlyMerged, monthlyImg,
        series,
        compareMode: isCompare,
      });
    }
    return result;
  }, [year, month, source, structure, topParent, kpiList, fetchSectionData]);

  const buildExportPayload = async () => {
    // Legal-name lookup for subsidiaries
    const legalNameFor = (co) => {
      const c = companiesAll.find(x => (x.CompanyShortName ?? x.companyShortName) === co);
      return c?.CompanyLegalName ?? c?.companyLegalName ?? co;
    };

    const fullCompanyLabels = contributionCompanies.map(c => legalNameFor(c));

    // Each tab has its OWN dashboard selection. Build both KPI lists so the
    // company sheet and the dimension sheet each show their own KPIs.
const kpiListCompany   = buildKpiList(dashboardKpiIds,    "comp");
    const kpiListDimension = buildKpiList(dashboardKpiIdsDim, "dim");

    // Consolidated has flat rawData; the exporter expects Map<company, rows>.
    // Group rawData / rawDataPrev by company (Parent + Contribution roles), and
    // add a "__consolidated__" bucket built from Group-role rows.
    const groupRowsByCompany = (rows) => {
      const m = new Map();
      const consRows = [];
      rows.forEach(r => {
        const role = r.CompanyRole ?? r.companyRole ?? "";
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const isConsolidated = role === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim();
        if (isConsolidated) { consRows.push(r); return; }
        if (!co || (role !== "Parent" && role !== "Contribution")) return;
        if (!m.has(co)) m.set(co, []);
        m.get(co).push(r);
      });
      m.set("__consolidated__", consRows);
      return m;
    };
    const companyData     = groupRowsByCompany(rawData);
    const companyDataPrev = groupRowsByCompany(rawDataPrev);
    const companyDataCmp     = compareMode ? groupRowsByCompany(rawDataCmp)     : new Map();
    const companyDataCmpPrev = compareMode ? groupRowsByCompany(rawDataCmpPrev) : new Map();

const filteredCompanyCodes = [...contributionCompanies];
    const fullCompanyLabelsWithCons = filteredCompanyCodes.map(c => legalNameFor(c));

    // Dimension codes (all keys currently in dimensionPivots)
    const dimensionCodes = [...dimensionPivots.keys()].sort();

    // === Compute YTD + Monthly results inline for export ===
    const buildPivotOne = (rows, applyDimFilter, gFilter, dFilter) => {
      const p = new Map();
      const dimPivot = new Map();
rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (acType && acType !== "P/L") return;
        const dimPairs = parseDimensions(r.Dimensions ?? r.dimensions ?? "");
        if (applyDimFilter) {
          if (Array.isArray(dFilter) && dFilter.length === 0) return;
          if (Array.isArray(gFilter) && gFilter.length === 0) return;
          if (Array.isArray(dFilter) && dFilter.length > 0) {
            const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
            if (!dFilter.some(d => rowDimCodes.has(d))) return;
          } else if (Array.isArray(gFilter) && gFilter.length > 0) {
            const rowGroups = new Set(dimPairs.map(([g]) => g));
            if (!gFilter.some(g => rowGroups.has(g))) return;
          }
        }
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);
        dimPairs.forEach(([dGroup, dCode]) => {
          if (!dGroup || !dCode) return;
          const key = `${ac}:::${dGroup}:::${dCode}`;
          dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
        });
      });
p.__dimPivot      = dimPivot;
      p.__localPivot    = new Map();
      p.__localDimPivot = new Map();
      p.__descendants   = groupDescendants;
      return p;
    };

    const diffPivots = (curr, prev, isJan) => {
      const out = new Map();
      new Set([...curr.keys(), ...prev.keys()]).forEach(k => {
        out.set(k, (curr.get(k) ?? 0) - (isJan ? 0 : (prev.get(k) ?? 0)));
      });
      const diffSub = (a, b) => {
        const r = new Map();
        new Set([...(a ?? new Map()).keys(), ...(b ?? new Map()).keys()]).forEach(k => {
          r.set(k, ((a?.get(k)) ?? 0) - (isJan ? 0 : ((b?.get(k)) ?? 0)));
        });
        return r;
      };
out.__dimPivot      = diffSub(curr.__dimPivot, prev.__dimPivot);
      out.__localPivot    = new Map();
      out.__localDimPivot = new Map();
      out.__descendants   = groupDescendants;
      out.__parties = curr.__parties;
      out.__partyContext = curr.__partyContext;
      return out;
    };

    // Resolve every variable letter for every KPI against a pivot. Returns
    // Map<kpiId, Map<letter, number>>. Only KPIs with a text-formula have vars.
const resolveVarsFor = (kList, pivot) => {
      const out = new Map();
      const cache = new Map();
      kList.forEach(kpi => {
        const flat = flattenFormulaToTextForm(kpi.formula);
        if (!flat || !flat.variables) return;
        const letterMap = new Map();
        pivot.__currentKpiVariations = kpi.variations ?? null;
        const scope = pivot.__variationScope;
        const variations = kpi.variations;
        Object.entries(flat.variables).forEach(([letter, node]) => {
          if (!node) return;
          let effectiveNode = node;
          if (scope && variations) {
            const map = scope.kind === "company" ? variations.byCompany : (scope.kind === "dimension" ? variations.byDimension : null);
            const override = map?.[scope.key]?.[letter];
            if (override) {
              let normalized = override;
              if (override.prefix && typeof override.prefix === "string" && override.prefix.includes(":::") && !override.dimGroup && !override.dimCode) {
                const [p, g, c] = override.prefix.split(":::");
                normalized = { ...override, prefix: p, dimGroup: g, dimCode: c };
              } else if (override.accountCode && typeof override.accountCode === "string" && override.accountCode.includes(":::") && !override.dimGroup && !override.dimCode) {
                const [a, g, c] = override.accountCode.split(":::");
                normalized = { ...override, accountCode: a, dimGroup: g, dimCode: c };
              }
              effectiveNode = normalized;
            }
          }
          try {
            const v = evalFormulaWithCcTags(effectiveNode, pivot, cache, resolvedAllKpis, ccTagToCodes, sectionCodes);
            if (Number.isFinite(v)) letterMap.set(letter, v);
          } catch { /* ignore */ }
        });
        pivot.__currentKpiVariations = null;
        if (letterMap.size > 0) out.set(kpi.id, letterMap);
if (kpi.id === "revenue") {
          console.log("[vars] revenue letterMap:", JSON.stringify([...letterMap.entries()]), "expression:", flat.expression);
        }
      });
      return out;
    };

    const buildResultsFor = (dataMap, prevMap, monthNum, gFilter, dFilter, kList) => {
      const isJan = parseInt(monthNum) === 1;
      const ytdResults = new Map();
      const monthlyResults = new Map();
      const ytdVars = new Map();
      const monthlyVars = new Map();
      dataMap.forEach((rows, co) => {
        const curr = buildPivotOne(rows, true, gFilter, dFilter);
        const prev = buildPivotOne(prevMap.get(co) ?? [], true, gFilter, dFilter);
        const partyCtx = {
          companies: co === "__consolidated__" ? contributionCompanies : [co],
          year: parseInt(year),
          month: parseInt(monthNum),
          selectedDims: null,
        };
curr.__parties = partiesById;
        curr.__partyContext = partyCtx;
        prev.__parties = partiesById;
        prev.__partyContext = partyCtx;
        const scope = co === "__consolidated__"
          ? { kind: "consolidated", key: "__consolidated__" }
          : { kind: "company", key: co };
curr.__variationScope = scope;
        prev.__variationScope = scope;
        if (co === "BLK") {
          console.log("[exp-blk] dimPivot A05 UK entries:", [...(curr.__dimPivot?.entries() ?? [])].filter(([k]) => k.includes(":::Territorio:::UK")).slice(0, 10), "descendants A05:", curr.__descendants?.get("A.05"));
        }
const monthly = diffPivots(curr, prev, isJan);
        monthly.__variationScope = scope;
        monthly.__descendants = curr.__descendants;
ytdResults.set(co,     computeAllKpisResolved(kList, curr,    ccTagToCodes, sectionCodes, resolvedAllKpis));
        monthlyResults.set(co, computeAllKpisResolved(kList, monthly, ccTagToCodes, sectionCodes, resolvedAllKpis));
        if (co === "CAP") {
          console.log("[exp-cap] month=" + monthNum,
            "A.01 monthly:", monthly.get("A.01"),
            "700000 monthly:", monthly.get("700000"),
            "results Revenue:", monthlyResults.get("CAP")?.get?.("revenue"));
        }
        ytdVars.set(co,      resolveVarsFor(kList, curr));
        monthlyVars.set(co,  resolveVarsFor(kList, monthly));
      });
      return { ytd: ytdResults, monthly: monthlyResults, ytdVars, monthlyVars };
    };

    const buildDimResultsFor = (dataMap, prevMap, monthNum, kList) => {
      const isJan = parseInt(monthNum) === 1;
const buildDim = (dMap) => {
        const out = new Map();
        // Only pull from the __consolidated__ bucket for dimension breakdowns
        const rows = dMap.get("__consolidated__") ?? [];
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac || (acType && acType !== "P/L")) return;
          const pairs = parseDimensions(r.Dimensions);
          if (pairs.length === 0) return;
          for (const [group, code] of pairs) {
            if (Array.isArray(selGroups)) {
              if (selGroups.length === 0) continue;
              if (!selGroups.includes(group)) continue;
            }
            if (Array.isArray(selDims)) {
              if (selDims.length === 0) continue;
              if (!selDims.includes(code)) continue;
            }
            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            if (!out.has(code)) {
              const p = new Map();
              p.__dimPivot = new Map();
              p.__descendants = groupDescendants;
              out.set(code, p);
            }
            const m = out.get(code);
            m.set(ac, (m.get(ac) ?? 0) + amt);
            pairs.forEach(([g2, c2]) => {
              const k = `${ac}:::${g2}:::${c2}`;
              m.__dimPivot.set(k, (m.__dimPivot.get(k) ?? 0) + amt);
            });
          }
        });
        return out;
      };
      const currMap = buildDim(dataMap);
      const prevMap2 = buildDim(prevMap);
      const ytdResults = new Map();
      const monthlyResults = new Map();
      const ytdVars = new Map();
      const monthlyVars = new Map();
      const allCodes = new Set([...currMap.keys(), ...prevMap2.keys()]);
      allCodes.forEach(code => {
        const curr = currMap.get(code) ?? new Map();
        const prev = prevMap2.get(code) ?? new Map();
const monthly = new Map();
        new Set([...curr.keys(), ...prev.keys()]).forEach(ac => {
          monthly.set(ac, (curr.get(ac) ?? 0) - (isJan ? 0 : (prev.get(ac) ?? 0)));
        });
        const monthlyDP = new Map();
        const currDP = curr.__dimPivot ?? new Map();
        const prevDP = prev.__dimPivot ?? new Map();
        new Set([...currDP.keys(), ...prevDP.keys()]).forEach(k => {
          monthlyDP.set(k, (currDP.get(k) ?? 0) - (isJan ? 0 : (prevDP.get(k) ?? 0)));
        });
        const partyCtx = { companies: contributionCompanies, year: parseInt(year), month: parseInt(monthNum), selectedDims: null };
curr.__parties = partiesById;
        curr.__partyContext = partyCtx;
        monthly.__parties = partiesById;
        monthly.__partyContext = partyCtx;
        const scope = { kind: "dimension", key: code };
        curr.__variationScope = scope;
        monthly.__variationScope = scope;
        monthly.__dimPivot = monthlyDP;
        monthly.__descendants = curr.__descendants;
        ytdResults.set(code,     computeAllKpisResolved(kList, curr,    ccTagToCodes, sectionCodes, resolvedAllKpis));
        monthlyResults.set(code, computeAllKpisResolved(kList, monthly, ccTagToCodes, sectionCodes, resolvedAllKpis));
        ytdVars.set(code,      resolveVarsFor(kList, curr));
        monthlyVars.set(code,  resolveVarsFor(kList, monthly));
      });
      return { ytd: ytdResults, monthly: monthlyResults, ytdVars, monthlyVars };
    };

    const companyBoth    = buildResultsFor(companyData,    companyDataPrev,    month,    selGroups, selDims, kpiListCompany);
    const companyCmpBoth = compareMode ? buildResultsFor(companyDataCmp, companyDataCmpPrev, cmpMonth, selGroups, selDims, kpiListCompany) : null;
    const dimBoth        = buildDimResultsFor(companyData,    companyDataPrev,    month,    kpiListDimension);
    const dimCmpBoth     = compareMode ? buildDimResultsFor(companyDataCmp, companyDataCmpPrev, cmpMonth, kpiListDimension) : null;

    return {
      kpiList: kpiListCompany,
      kpiListCompany,
      kpiListDimension,
      kpiListFull: resolvedAllKpis,
      companyCodes:        exportOpts.company   ? filteredCompanyCodes : [],
      companyLabels:       exportOpts.company   ? fullCompanyLabelsWithCons : [],
      companyResults:      companyBoth,
      companyResultsCmp:   companyCmpBoth,
      dimensionCodes:      exportOpts.dimension ? dimensionCodes : [],
      dimensionResults:    dimBoth,
      dimensionResultsCmp: dimCmpBoth,
      dimensionPivots,
graphSections:       exportOpts.graphs ? await buildGraphSections() : [],
      exportOpts,
      accountCodeLabels,
      filters: {
        source, structure, year, month, topParent,
        dimGroups: selGroups, dims: selDims,
        companies: fullCompanyLabels,
        compareMode,
        cmpYear, cmpMonth, cmpSource, cmpStructure,
      },
    };
  };

const _handleExportXlsxRun = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      await exportKpisToXlsx(payload);
    } catch (e) { console.error("Excel export failed:", e); alert("Excel export failed — check console"); }
    finally { setExporting(false); }
  };

  const _handleExportPdfRun = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      await exportKpisToPdf(payload);
    } catch (e) { console.error("PDF export failed:", e); alert("PDF export failed — check console"); }
    finally { setExporting(false); }
  };

  const handleExportXlsx = () => {
    setExportOpts(o => ({ ...o, format: "xlsx" }));
    setExportModal(true);
  };

  const handleExportPdf = () => {
    setExportOpts(o => ({ ...o, format: "pdf" }));
    setExportModal(true);
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
        @keyframes cmpCellIn  { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
        @keyframes cmpCellOut { from { opacity:1; transform:translateX(0); }    to { opacity:0; transform:translateX(-8px); } }
        @keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
      `}</style>
      <PageHeader
        kicker="Consolidated"
        title="KPIs"
tabs={[
          { id: "subsidiaries",  label: tt("filter_companies", "Companies"),   icon: Building2  },
          { id: "dimensions",    label: tt("filter_dimensions", "Dimensions"),  icon: Layers     },
          { id: "graphs",        label: "Graphs",      icon: BarChart3  },
        ]}
        activeTab={viewMode}
onTabChange={v => { setViewMode(v); setColOrder(null); setSelGroups(null); setSelDims(null); }}
filters={viewMode === "graphs"
          ? (graphScope === "perspective" && holdingOptions.length > 0
              ? [{ label: tt("filter_perspective", "Perspective"), value: topParent, onChange: setTopParent, options: holdingOptions }]
              : [])
          : [
          ...(sourceOpts.length > 0 ? [{ label: tt("filter_source", "Source"), value: source, onChange: setSource, options: sourceOpts }] : []),
          { label: tt("filter_year", "Year"),  value: year,  onChange: setYear,  options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
          { label: tt("filter_month", "Month"), value: month, onChange: setMonth, options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
          ...(structureOpts.length > 0 ? [{ label: tt("filter_structure", "Structure"), value: structure, onChange: setStructure, options: structureOpts }] : []),
          ...(holdingOptions.length > 0 ? [{ label: tt("filter_perspective", "Perspective"), value: topParent, onChange: setTopParent, options: holdingOptions }] : []),
...(dimGroups.length > 0 ? [{ label: tt("filter_dim_group", "Dim Group"), values: selGroups, onChange: v => { setSelGroups(v); setSelDims(null); }, options: dimGroups.map(g => ({ value: g, label: g })), multiselect: true }] : []),
          ...(groupDimOptions.length > 0 ? [{ label: tt("filter_dimension", "Dimension"), values: selDims, onChange: setSelDims, options: groupDimOptions.map(d => ({ value: d.code, label: d.name || d.code })), multiselect: true }] : []),
        ]}
periodToggle={{ value: viewPeriod, onChange: setViewPeriod }}
        {...(viewMode === "graphs" ? { scopeToggle: { value: graphScope, onChange: setGraphScope } } : {})}
        compareToggle={{ active: compareMode, onChange: setCompareMode }}
onExportXlsx={handleExportXlsx}
        onExportPdf={handleExportPdf}
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
          compareModeOuter={compareMode}
          viewPeriod={viewPeriod}
scope={graphScope}
          perspectiveCompanies={contributionCompanies}
          companyLabelsMap={new Map(companiesAll.map(c => [c.CompanyShortName ?? c.companyShortName, c.CompanyLegalName ?? c.companyLegalName ?? (c.CompanyShortName ?? c.companyShortName)]))}
          groupDescendants={groupDescendants}
        />
) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
<thead className="sticky top-0 z-40">
                <tr style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
                  <th className="sticky left-0 z-50 text-left px-6 border-r border-gray-100"
                    style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: 64, minWidth: 260 }}>
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{tt("label_kpi",  "KPI")}</span>
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
                          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>{tt("kpi_col_sigma_cmp", "Σ CMP")}</span>
                        </th>,
                        <th key={`${col}__delta`} className="text-center px-3 whitespace-nowrap" style={{ background: `${colors.primary}12`, minWidth: 110, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 120ms both", transformOrigin: "left center" }}>
                          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>{tt("col_delta_amt", "Δ")}</span>
                        </th>,
                        <th key={`${col}__deltapct`} className="text-center px-3 whitespace-nowrap" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 180ms both", transformOrigin: "left center" }}>
                          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>{tt("kpi_col_delta_pct", "Δ%")}</span>
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
const cellSpinner = <Loader2 size={11} className="animate-spin mx-auto" style={{ color: `${colors.primary}80` }} />;
                        const out = [<td key={col} className="px-4 py-3 text-center whitespace-nowrap transition-all" style={bColor ? { background: bColor.bg, borderLeft: `2px solid ${bColor.border}` } : undefined}>{loading ? cellSpinner : <AnimatedCell value={val} format={kpi.format} baseStyle={{ ...body1Style, color: bColor ? bColor.text : undefined }} />}</td>];
if (compareMode) {
                          const cmpRes = resultsCmp.get(col);
                          const cmpVal = cmpRes ? cmpRes.get(kpi.id) : null;
                          const cmpValid = cmpVal !== undefined && cmpVal !== null && !isNaN(cmpVal);
                          const cmpLoading = loading || resultsCmp.size === 0;
                          const cmpSpinner = <Loader2 size={11} className="animate-spin mx-auto" style={{ color: `${colors.primary}80` }} />;
                          const delta = cmpValid && val !== null ? val - cmpVal : null;
                          const deltaPct = delta !== null && kpi.format !== "percent" && Math.abs(cmpVal) > 1e-9 ? ((val - cmpVal) / Math.abs(cmpVal)) * 100 : null;
out.push(
                            <td key={`${col}__cmp`} className="px-4 py-3 text-center whitespace-nowrap"
                              style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 60ms both", transformOrigin: "left center" }}>
                              {cmpLoading ? cmpSpinner : <AnimatedCell value={cmpValid ? cmpVal : null} format={kpi.format} baseStyle={body1Style} />}
                            </td>,
                            <td key={`${col}__delta`} className="px-4 py-3 text-center whitespace-nowrap"
                              style={{ background: `${colors.primary}12`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 120ms both", transformOrigin: "left center" }}>
                              {cmpLoading ? cmpSpinner : (delta === null ? <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span> : <AnimatedCell value={delta} format={kpi.format} baseStyle={{ ...body1Style, color: delta < 0 ? "#EF4444" : "#059669" }} />)}
                            </td>,
                            <td key={`${col}__deltapct`} className="px-4 py-3 text-center whitespace-nowrap"
                              style={{ ...body1Style, color: deltaPct === null ? "#D1D5DB" : deltaPct < 0 ? "#EF4444" : "#059669", background: `${colors.primary}1e`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 180ms both", transformOrigin: "left center" }}>
                              {cmpLoading ? cmpSpinner : (deltaPct === null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`)}
                            </td>
                          );
                        }
                        return out;
                      })}
<td className="sticky right-0 px-4 py-3 text-center whitespace-nowrap border-l border-gray-100 bg-[#eef1fb] group-hover:bg-[#e4e8f8]"
                        style={{ ...body1Style, color: aggregate === null ? "#D1D5DB" : aggregate < 0 ? "#EF4444" : "#000" }}>
                        {loading ? <Loader2 size={11} className="animate-spin mx-auto" style={{ color: `${colors.primary}80` }} /> : aggregate === null ? "—" : <><AnimatedCell value={aggregate} format={kpi.format} baseStyle={body1Style} /><span className="text-[9px] font-normal text-gray-400 ml-1">{kpi.format === "percent" ? "avg" : "Σ"}</span></>}
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
const created = await createCompanyKpi({ companyId, userId: authUserId, label: `${base} ${n}`, description: data.description ?? null, category: data.category ?? null, tag: null, format: data.format ?? "currency", formula: data.formula, benchmark: data.benchmark ?? null, variations: data.variations ?? null, contextMappingId: null, scope: "consolidated" });
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
parties={statParties}
          partyContext={partyContext}
          evalPartyValue={evalPartyValue}
variationCompanies={(companiesAll ?? []).map(c => c.CompanyShortName ?? c.companyShortName).filter(Boolean).sort()}
          companyLabelsMap={(() => {
            const m = new Map();
            (companiesAll ?? []).forEach(c => {
              const code = c.CompanyShortName ?? c.companyShortName;
              const legal = c.CompanyLegalName ?? c.companyLegalName ?? code;
              if (code) m.set(code, legal);
            });
            return m;
          })()}
variationDimensions={allDimensionsFlat}
        />
      )}
      {exportModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", animation: "kBadgesPop 280ms cubic-bezier(0.34,1.56,0.64,1)" }}
          onClick={() => setExportModal(false)}>
          <div className="relative bg-white w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col"
            style={{ borderRadius: 28, boxShadow: `0 30px 80px -12px ${colors.primary}40, 0 12px 24px -6px rgba(0,0,0,0.12)`, animation: "plRowSlideIn 340ms cubic-bezier(0.34,1.56,0.64,1)" }}
            onClick={e => e.stopPropagation()}>
            <div className="relative px-7 pt-7 pb-5 flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)`, boxShadow: `0 8px 20px -6px ${colors.primary}60` }}>
                    <Download size={17} className="text-white" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-black text-[20px] tracking-tight" style={{ color: colors.primary, letterSpacing: "-0.02em" }}>Export KPIs</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                        style={{ background: `${colors.primary}10`, color: colors.primary }}>
                        {(exportOpts.format ?? "xlsx") === "pdf" ? "PDF" : "EXCEL"}
                      </span>
                      {compareMode && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                          style={{ background: "#CF305D15", color: "#CF305D" }}>COMPARE</span>
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

            <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-6 no-scrollbar">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">Views to include</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    ["company",   "Subsidiaries",   "KPI values per subsidiary",           colors.primary],
                    ["dimension", "Dimension KPIs", "KPI values broken down by dimension", "#dc7533"],
                    ["graphs",    "Graphs",         "Time series table + chart image",     "#10B981"],
                  ].map(([k, label, sub, accent]) => {
                    const checked = !!exportOpts[k];
                    return (
                      <label key={k} className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${accent}40` : "#f3f4f6", background: checked ? `${accent}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [k]: !o[k] }))}>
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

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">KPI definitions (formula · variables · benchmarks)</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["inlineDefs", "Inline under each KPI"],
                    ["defsSheet",  "Separate definitions sheet"],
                  ].map(([k, label]) => {
                    const checked = !!exportOpts[k];
                    return (
                      <label key={k} className="flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${colors.primary}40` : "#f3f4f6", background: checked ? `${colors.primary}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [k]: !o[k] }))}>
                        <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? colors.primary : "transparent", borderColor: checked ? colors.primary : "#d1d5db" }}>
                          {checked && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                        </div>
                        <span className="text-xs font-bold text-gray-700">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

</div>

            <div className="px-7 py-5 flex items-center gap-3 flex-shrink-0"
              style={{ background: "linear-gradient(180deg, transparent 0%, #f9fafb 100%)" }}>
              <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}>
                {[["xlsx","Excel"], ["pdf","PDF"]].map(([f, l]) => (
                  <button key={f} onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                    className="relative z-10 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-200"
                    style={{
                      background: (exportOpts.format ?? "xlsx") === f ? "white" : "transparent",
                      color: (exportOpts.format ?? "xlsx") === f ? colors.primary : "#9ca3af",
                      boxShadow: (exportOpts.format ?? "xlsx") === f ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                    }}>{l}</button>
                ))}
              </div>
              <button
                onClick={() => {
                  setExportModal(false);
                  const fmt = exportOpts.format ?? "xlsx";
                  if (fmt === "pdf") _handleExportPdfRun?.();
                  else _handleExportXlsxRun?.();
                }}
                disabled={!exportOpts.company && !exportOpts.dimension && !exportOpts.graphs}
                className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 100%)`,
                  color: "white",
                  boxShadow: `0 8px 20px -6px ${colors.primary}80, 0 2px 6px -2px ${colors.primary}40`,
                }}>
                <Download size={13} strokeWidth={2.5} />
                Download
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}