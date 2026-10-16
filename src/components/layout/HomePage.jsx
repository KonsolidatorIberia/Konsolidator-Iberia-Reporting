import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  TrendingUp, DollarSign, Target, Activity,
  Building2, Layers, Database, Network, Loader2, ArrowUp, ArrowDown,
  Sparkles, ChevronRight, Wallet, Settings, Search, ChevronDown, GitCompare,
Edit3, Trash2, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useSettings, useTypo, useSettingsControls, useT } from "./SettingsContext.jsx";
import AiPanel from "./AiPanel.jsx";
import { supabase } from "../../lib/supabaseClient";
import { MappingsModal } from "./MappingsPage.jsx";
import {
  listBreakdownStructures, createBreakdownStructure,
  updateBreakdownStructure, archiveBreakdownStructure,
  getBreakdownPreference, saveBreakdownPreference,
} from "../../lib/breakdownApi";
const BASE_URL = "";

// ════════════════════════════════════════════════════════════════════════════
// KPI RESOLVER — copied verbatim from KpiIndividualesPage.jsx so HomePage
// computes hero KPIs (Revenue / EBITDA / EBIT / Net Result) using the SAME
// cc_tag-driven path. No regex, no section heuristics, no manual sign flips
// at the call site — just feed it a pivot and ask for the kpi by id.
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

// Grab the user's live JWT so RLS policies see auth.uid() correctly.
// Falls back to the publishable key when no session (safe for public tables).
// Se lee la clave exacta de ESTE proyecto: en localhost el localStorage lo
// comparten todas las apps que se arrancan en el mismo puerto, y buscar
// cualquier clave con "auth-token" podía coger la sesión de otro proyecto o la
// clave "-code-verifier", dejando la Home sin permisos y los KPIs a cero.
const SB_AUTH_KEY = "sb-gmcawsapzkzmgrtiqebv-auth-token";
function getSbAuthToken() {
  try {
    const key = SB_AUTH_KEY;
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed?.access_token ?? parsed?.data?.session?.access_token ?? null;
  } catch { return null; }
}

// Paginated fetch — PostgREST caps individual responses at 1000 rows
// regardless of Range header. Standard tables can exceed this (Konsolidator
// alone has 1169). Fetch in 1000-row pages and concatenate.
const sbGet = async (path) => {
  const token = getSbAuthToken();
  const baseHeaders = {
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${token ?? SUPABASE_APIKEY}`,
    // Ask PostgREST for exact total count so pagination termination works
    // even with wildcard content-range responses.
    Prefer: "count=exact",
  };

  const PAGE = 1000;
  const all = [];
  let offset = 0;

  for (let safety = 0; safety < 20; safety++) {
    const rangeEnd = offset + PAGE - 1;
    const res = await fetch(`${SUPABASE_URL}/${path}`, {
      headers: { ...baseHeaders, Range: `${offset}-${rangeEnd}` },
    });
    const chunk = await res.json();
    if (!Array.isArray(chunk)) return chunk;
    all.push(...chunk);
    // Fallback: if we got less than PAGE rows, we're done regardless of headers.
    if (chunk.length < PAGE) break;
    const cr = res.headers.get("content-range");
    if (!cr) break;
    const parts = cr.split("/");
    const total = parseInt(parts[1], 10);
    if (!isNaN(total) && all.length >= total) break;
    offset += PAGE;
  }

  return all;
};

// Basic headers helper for one-off fetches that don't use sbGet's pagination
// (e.g. limit=1 queries where a single row is expected). Uses the same auth
// pattern as sbGet so RLS policies see the user's JWT.
const sbHeaders = () => {
  const token = getSbAuthToken();
  return {
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${token ?? SUPABASE_APIKEY}`,
  };
};

// Code-pattern sniff — used as fallback when company_active_standard has
// no row bound to the current company. Kept exported for legacy callers.
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

// The old per-standard tables (pgc_pl_rows, danish_ifrs_pl_rows, ...)
// have been unified into public.standard_statement_rows +
// public.standard_statement_sections. loadStandardMapping() now queries
// those directly, keyed by (standard_key, statement).

async function loadStandardMapping(standard, groupAccounts, skipCache = false) {
  if (!standard) return null;

  const cacheKey = `resolver_mapping_v2_${standard}_${(groupAccounts || []).length}`;
  if (!skipCache) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { cc, sc } = JSON.parse(cached);
        return { ccTagToCodes: new Map(cc), sectionCodes: new Map(sc) };
      }
    } catch { /* re-fetch */ }
  }

  // Unified schema: one table, filter by standard_key + statement.
  // PL and BS both carry cc_tag / section_code / parent_code needed here.
  const rows = await sbGet(
    `standard_statement_rows?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag` +
    `&standard_key=eq.${encodeURIComponent(standard)}` +
    `&statement=in.(PL,BS)`
  );
  const allRows = Array.isArray(rows) ? rows : [];

  const codeCcTag = new Map();
  const codeSection = new Map();
  for (const r of allRows) {
    if (r.cc_tag) codeCcTag.set(String(r.account_code), r.cc_tag);
    if (r.section_code) codeSection.set(String(r.account_code), r.section_code);
  }

const parentOf = new Map();
  // First: parent relationships from the standard mapping table
  for (const r of allRows) {
    if (r.account_code && r.parent_code) {
      parentOf.set(String(r.account_code), String(r.parent_code));
    }
  }
  // Then: parent relationships from groupAccounts (overrides for runtime leaves)
  for (const ga of (groupAccounts || [])) {
    if (ga.AccountCode && ga.SumAccountCode) {
      parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
    }
  }

  const ccTagToCodes = new Map();
  const sectionCodes = new Map();
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
      if (!ccTagToCodes.has(foundTag)) ccTagToCodes.set(foundTag, []);
      ccTagToCodes.get(foundTag).push(code);
      if (foundSection) {
        const key = `${foundTag}::${foundSection}`;
        if (!sectionCodes.has(key)) sectionCodes.set(key, []);
        sectionCodes.get(key).push(code);
      }
    }
  }


if (!skipCache) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        cc: [...ccTagToCodes.entries()],
        sc: [...sectionCodes.entries()],
      }));
    } catch { /* storage full or unavailable */ }
  }
  return { ccTagToCodes, sectionCodes };
}

async function loadKpiLibrary(standard, companyId) {
  // Don't cache when companyId is null — that's a transient first-render
  // state that would otherwise poison the cache for the whole session.
  if (!companyId) {
    const [defs, standardOverrides] = await Promise.all([
      sbGet("kpi_definitions?select=*&order=sort_order.asc"),
      standard
        ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}&company_id=is.null`)
        : Promise.resolve([]),
    ]);
    if (!Array.isArray(defs)) return [];
    const overrideByKpi = new Map();
    if (Array.isArray(standardOverrides)) standardOverrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
    return defs.map(d => ({
      id: d.id, label: d.label, description: d.description ?? "",
      category: d.category ?? "", format: d.format ?? "currency",
      tag: d.tag ?? "", benchmark: d.benchmark ?? null,
      formula: overrideByKpi.get(d.id) ?? d.formula, isCustom: false,
    }));
  }

  const cacheKey = `resolver_library_v2_${standard}_${companyId}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* re-fetch */ }

  // Pull: base defs, standard-level overrides, per-company overrides, custom KPIs
  const [defs, standardOverrides, companyOverrides, custom] = await Promise.all([
    sbGet("kpi_definitions?select=*&order=sort_order.asc"),
    standard
      ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}&company_id=is.null`)
      : Promise.resolve([]),
    companyId
      ? sbGet(`kpi_definitions_override?select=*&company_id=eq.${encodeURIComponent(companyId)}`)
      : Promise.resolve([]),
    companyId
      ? sbGet(`company_kpis?select=*&company_id=eq.${encodeURIComponent(companyId)}&is_archived=eq.false`)
      : Promise.resolve([]),
  ]);

  if (!Array.isArray(defs)) return [];

  // Resolution order: per-company override > standard override > base
  const overrideByKpi = new Map();
  if (Array.isArray(standardOverrides)) standardOverrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  if (Array.isArray(companyOverrides))  companyOverrides .forEach(o => overrideByKpi.set(o.kpi_id, o.formula));

  const standardKpis = defs.map(d => ({
    id:          d.id,
    label:       d.label,
    description: d.description ?? "",
    category:    d.category ?? "",
    format:      d.format ?? "currency",
    tag:         d.tag ?? "",
    benchmark:   d.benchmark ?? null,
    formula:     overrideByKpi.get(d.id) ?? d.formula,
    isCustom:    false,
  }));

const customKpis = Array.isArray(custom) ? custom.map(d => {
    let formula = d.formula;
    if (typeof formula === "string") {
      try { formula = JSON.parse(formula); } catch { formula = null; }
    }
    return {
      id:          d.kpi_id,
      label:       d.label,
      description: d.description ?? "",
      category:    "Custom",
      format:      d.format ?? "currency",
      tag:         d.tag ?? "",
      benchmark:   d.benchmark ?? null,
      formula,
      isCustom:    true,
    };
  }).filter(k => k.id && k.label && k.formula) : [];


const result = [...standardKpis, ...customKpis];
  try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

// Async standard resolver:
//   1. If the company has an entry in public.company_active_standard,
//      use that standard_key (works for custom clients like 'ACME-<uuid>').
//   2. Otherwise fall back to the code-pattern sniff (built-in standards).
// Resolve the standard for a company:
//   1. If companyId is known → check binding. If found, return it. If not found, sniff.
//   2. If companyId is null (settings still loading) → return null so the resolver waits
//      instead of falling to sniff (which would poison the cache for the session).
async function resolveStandardKey(companyId, groupAccounts, preResolvedKey) {
  // If EpicLoader already fetched the binding, use it (no roundtrip).
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
  const [state, setState] = useState({
    kpiList:      [],
    ccTagToCodes: new Map(),
    sectionCodes: new Map(),
    standard:     null,
    ready:        false,
    error:        null,
  });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, ready: false, error: null }));

(async () => {
const standard = await resolveStandardKey(companyId, groupAccounts, preResolvedStandardKey);
      if (cancelled) return;

      if (!standard) {
        setState(s => ({ ...s, ready: true, kpiList: [], standard: null }));
        return;
      }

      // Only allow caching when we know for sure which tenant we're serving.
      // Pass `skipCache=true` when companyId is null so the fallback-sniff
      // result doesn't poison the cache for the whole session.
      const skipCache = !companyId;
      try {
        const [mapping, fullKpiList] = await Promise.all([
          loadStandardMapping(standard, groupAccounts, skipCache),
          loadKpiLibrary(standard, companyId),
        ]);
        if (cancelled) return;
        const { ccTagToCodes, sectionCodes } = mapping ?? { ccTagToCodes: new Map(), sectionCodes: new Map() };
        setState({
          kpiList:       fullKpiList,
          ccTagToCodes,
          sectionCodes,
          standard,
          ready:         true,
          error:         null,
        });
      } catch (e) {
        if (cancelled) return;
        setState(s => ({ ...s, ready: true, error: String(e?.message ?? e) }));
      }
    })();

return () => { cancelled = true; };
  }, [groupAccounts, companyId, preResolvedStandardKey]);

  return state;
}

function pivotSum(pivot, codes) {
  if (!codes || codes.length === 0) return 0;
  let total = 0;
  codes.forEach(code => { total += (pivot.get(code) ?? 0); });
  return total;
}

function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;

  switch (node.type) {
case "account": {
      // Dim-scoped account: look up in __dimPivot (keyed as "ac:::group:::code")
      if (node.accountCode && (node.dimGroup || node.dimCode)) {
        const key = `${node.accountCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
        return -(pivot.__dimPivot?.get(key) ?? 0);
      }
      let total = 0;
      pivot.forEach((val, ac) => { if (ac === node.accountCode) total += val; });
      return -total;
    }
case "accountGroup": {
      // Group + dim → use ONLY the group code itself (sum-row already carries aggregate)
      if (node.groupCode && (node.dimGroup || node.dimCode)) {
        const key = `${node.groupCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
        return -(pivot.__dimPivot?.get(key) ?? 0);
      }
      // If the sum-row for this prefix exists directly in pivot (or __sumPivot), use it.
      if (node.prefix && pivot.__sumPivot?.has(node.prefix)) {
        return -pivot.__sumPivot.get(node.prefix);
      }
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
        const scope = pivot.__variationScope;
        const variations = pivot.__currentKpiVariations;
        Object.entries(node.variables).forEach(([letter, varNode]) => {
          let effectiveNode = varNode;
          if (scope && variations) {
            const map = scope.kind === "company" ? variations.byCompany
                      : scope.kind === "dimension" ? variations.byDimension
                      : null;
            const override = map?.[scope.key]?.[letter];
            if (override) {
              const norm = { ...override };
              if (norm.type === "accountGroup" && typeof norm.prefix === "string" && norm.prefix.includes(":::")) {
                const [gc, dg, dc] = norm.prefix.split(":::");
                norm.prefix = gc; norm.groupCode = gc;
                if (!norm.dimGroup) norm.dimGroup = dg || undefined;
                if (!norm.dimCode)  norm.dimCode  = dc || undefined;
              }
              if (norm.type === "account" && typeof norm.accountCode === "string" && norm.accountCode.includes(":::")) {
                const [ac, dg, dc] = norm.accountCode.split(":::");
                norm.accountCode = ac;
                if (!norm.dimGroup) norm.dimGroup = dg || undefined;
                if (!norm.dimCode)  norm.dimCode  = dc || undefined;
              }
              effectiveNode = norm;
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
    default: return 0;
  }
}

function computeKpiById(id, pivot, kpiList, ccTagToCodes, sectionCodes, cache) {
  if (cache.has(id)) return cache.get(id);
  const kpi = kpiList.find(k => k.id === id);
  if (!kpi) { cache.set(id, 0); return 0; }
  pivot.__currentKpiVariations = kpi.variations ?? null;
const val = evalFormulaWithCcTags(kpi.formula, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
  pivot.__currentKpiVariations = null;
  cache.set(id, val);
  return val;
}
// ════════════════════════════════════════════════════════════════════════════
// END KPI RESOLVER
// ════════════════════════════════════════════════════════════════════════════

const MONTHS_ABBR_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const NI_COLOR = "#7c3aed";
const NI_ACCENT = "#a855f7";

const INCOME_TAGS = new Set([
  "CC_01-Revenue", "CC_03-Other Operating Income",
  "CC_13-Interest Income", "CC_14-Other financial income",
]);

function parseAmt(val) {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (!s || s === "—" || s === "-") return 0;
  if (/\d\.\d{3},\d/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (/,/.test(s) && /\./.test(s) && s.indexOf(",") < s.indexOf(".")) return parseFloat(s.replace(/,/g, "")) || 0;
  if (/,/.test(s) && !/\./.test(s)) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

function fmtBig(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

// Auto-detect the group's reporting currency: the currency that appears in
// the most rows of the dataset. Falls back to "EUR" if no rows.
function detectReportingCurrency(rows) {
  if (!rows?.length) return "EUR";
  const counts = new Map();
  rows.forEach(r => {
    const cc = String(r.CurrencyCode ?? r.currencyCode ?? "").trim().toUpperCase();
    if (!cc) return;
    counts.set(cc, (counts.get(cc) ?? 0) + 1);
  });
  if (counts.size === 0) return "EUR";
  let best = null, bestCount = -1;
  counts.forEach((n, cc) => { if (n > bestCount) { best = cc; bestCount = n; } });
  return best;
}

// Build pivot the SAME way KpiIndividualesPage does:
//   - skip rows whose AccountCode is in sumAccountCodes (avoid double counting)
//   - skip rows where AccountType is set and != "P/L"
//   - sum AmountYTD (or amountYTD) into Map<accountCode, total>
function parseDimensions(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("||").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
  }).filter(Boolean);
}

function buildPivotFromRows(rows, sumAccountCodes) {
  const p = new Map();
  const dimP = new Map();
  const sumP = new Map();
  p.__dimPivot = dimP;
  p.__sumPivot = sumP;
  if (!rows?.length) return p;
  rows.forEach(r => {
    const ac = r.AccountCode ?? r.accountCode ?? "";
    if (!ac) return;
    const isSum = sumAccountCodes && sumAccountCodes.has(ac);
    const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
    const pairs = dimsRaw ? parseDimensions(dimsRaw) : [];
    const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
    if (isSum) {
      sumP.set(ac, (sumP.get(ac) ?? 0) + amt);
    } else {
      p.set(ac, (p.get(ac) ?? 0) + amt);
    }
    pairs.forEach(([g, c]) => {
      if (!g || !c) return;
      const k = `${ac}:::${g}:::${c}`;
      dimP.set(k, (dimP.get(k) ?? 0) + amt);
    });
  });
  return p;
}

function extractPeriod(obj) {
  if (!obj || typeof obj !== "object") return null;
  const y = obj.year ?? obj.y ?? obj.Year;
  const m = obj.month ?? obj.m ?? obj.Month;
  if (y == null || m == null) return null;
  const yNum = Number(y), mNum = Number(m);
  if (!Number.isFinite(yNum) || !Number.isFinite(mNum) || yNum < 1900 || mNum < 1 || mNum > 12) return null;
  return { year: yNum, month: mNum };
}

/* ═══════════════════════════════════════════════════════════════
   BACKGROUND VISUAL  (unchanged)
═══════════════════════════════════════════════════════════════ */
function ConsolidationBackground({ primary }) {
  const cx = 700, cy = 350;
  const nodes = Array.from({ length: 8 }).map((_, i) => {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * 200, y: cy + Math.sin(angle) * 200, delay: i * 0.15 };
  });

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1400 700">
        <defs>
          <radialGradient id="bgFade" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={primary} stopOpacity="0.06" />
            <stop offset="60%" stopColor={primary} stopOpacity="0.015" />
            <stop offset="100%" stopColor={primary} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hubGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={primary} stopOpacity="0.18" />
            <stop offset="100%" stopColor={primary} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1400" height="700" fill="url(#bgFade)" />
        {[100, 200, 300].map((r, i) => (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={primary} strokeWidth="0.5" strokeOpacity={0.07 - i * 0.015}
            style={{ transformOrigin: `${cx}px ${cy}px`, animation: `kBgRotate ${60 + i * 20}s linear infinite ${i % 2 ? "reverse" : ""}` }}
          />
        ))}
        {nodes.map((n, i) => (
          <line key={`l${i}`} x1={n.x} y1={n.y} x2={cx} y2={cy}
            stroke={primary} strokeWidth="0.6" strokeOpacity="0.05"
            style={{ animation: `kBgPulse 4s ease-in-out infinite ${n.delay}s` }} />
        ))}
        {nodes.map((n, i) => (
          <g key={`n${i}`}>
            <circle cx={n.x} cy={n.y} r="3" fill={primary} fillOpacity="0.15" />
            <circle cx={n.x} cy={n.y} r="6" fill={primary} fillOpacity="0.04"
              style={{ animation: `kBgPulse 3s ease-in-out infinite ${n.delay}s` }} />
          </g>
        ))}
        <circle cx={cx} cy={cy} r="40" fill="url(#hubGrad)" />
        <circle cx={cx} cy={cy} r="6" fill={primary} fillOpacity="0.3" />
        {Array.from({ length: 12 }).map((_, i) => (
          <circle key={`p${i}`}
            cx={100 + (i * 89) % 1300}
            cy={50 + (i * 53) % 600}
            r="1.5"
            fill={primary} fillOpacity="0.12"
            style={{ animation: `kBgFloat ${8 + i % 5}s ease-in-out infinite ${i * 0.3}s` }} />
        ))}
      </svg>
    </div>
  );
}

// Gráfica de evolución, memorizada: así pasar el ratón por otras zonas de la
// Home (que re-renderiza la página) no vuelve a animar las líneas desde cero.
const TrendChart = React.memo(function TrendChart({ data, slotColors, labels, hidden }) {
  return (
                <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      {slotColors.map((sc, i) => (
                        <linearGradient key={i} id={`areaSlot${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={sc.color} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={sc.color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke="#eef1f6" vertical={false} />
                    <XAxis dataKey="label"
                      tick={{ fontSize: 11, fill: "#94a3b8", fontWeight: 700 }}
                      axisLine={false} tickLine={false} tickMargin={8}
                      interval={data.length <= 12 ? 0 : Math.floor(data.length / 12)} />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#94a3b8", fontWeight: 600 }}
                      axisLine={false} tickLine={false}
                      tickFormatter={fmtBig}
                      width={52} tickCount={5} />
                    <Tooltip
                      cursor={{ stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "4 4" }}
                      content={<TrendTooltip slotLabels={labels} />} />
                    {slotColors.map((sc, i) => (
                      <Area
                        key={i}
                        className={`hpArea hpArea${i}`}
                        type="monotone"
                        dataKey={`slot${i}`}
                        name={labels[i]}
                        hide={hidden.has(i)}
                        stroke={sc.color}
                        strokeWidth={2}
                        fill={`url(#areaSlot${i})`}
                        isAnimationActive
                        animationDuration={700}
                        connectNulls={false}
                        dot={false}
                        activeDot={{ r: 4.5, fill: "#fff", stroke: sc.color, strokeWidth: 2.5 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
  );
});

/* ═══════════════════════════════════════════════════════════════
   KPI HERO CARD — tarjeta de color
═══════════════════════════════════════════════════════════════ */
const HeroKPI = React.memo(function HeroKPI({ label, value, prevValue, trend, color, icon: Icon, delay = 0, loading, noData = false }) {
  const t = useT();
  const change = (!noData && prevValue && prevValue !== 0) ? ((value - prevValue) / Math.abs(prevValue)) * 100 : null;
  const isPositive = change != null ? change >= 0 : null;
  const sparklineData = useMemo(() => (trend ?? []).map((v, i) => ({ x: i, y: v })), [trend]);
  const gradId = `hpSpark-${String(label).replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="hpKpi" style={{ "--kc": color, animationDelay: `${delay}s` }}>
      <span className="hpKpiOrb" aria-hidden="true" />
      <span className="hpKpiSheen" aria-hidden="true" />

      <div className="hpKpiTop">
        <span className="hpKpiIco">{Icon && <Icon size={14} strokeWidth={2.4} />}</span>
        <span className="hpKpiLabel" title={label}>{label}</span>
      </div>

      <div className="hpKpiRow">
        {loading ? (
          <span className="hpSkel" />
        ) : noData ? (
          <span className="hpKpiValue isEmpty">—</span>
        ) : (
          <span className="hpKpiValue"><AnimatedNumber value={value} duration={900} /></span>
        )}
        {change != null && !loading && (
          <span className={`hpDelta ${isPositive ? "isUp" : "isDown"}`}>
            {isPositive ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>

      <p className="hpKpiSub">
        {noData && !loading
          ? t("home_period_no_data")
          : (prevValue != null && prevValue !== 0) ? `${t("hero_vs")} ${fmtBig(prevValue)}` : " "}
      </p>

      {sparklineData.length > 1 && (
        <div className="hpKpiSpark">
          <ResponsiveContainer width="100%" height={42}>
            <AreaChart data={sparklineData} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="y" stroke="#ffffff" strokeWidth={1.8}
                fill={`url(#${gradId})`} isAnimationActive animationDuration={900}
                dot={(p) => p.index === sparklineData.length - 1
                  ? <circle key="end" cx={p.cx} cy={p.cy} r={3.2} fill="#fff" stroke="rgba(255,255,255,0.45)" strokeWidth={5} />
                  : null} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});

// Tarjetas de recuento (sociedades, perímetros, dimensiones, fuentes)
function MiniTile({ label, value, icon: Icon, color, delay = 0, onClick }) { // eslint-disable-line no-unused-vars
  return (
    <button type="button" onClick={onClick} className="hpTile" style={{ "--tc": color, animationDelay: `${delay}s` }}>
      <span className="hpTileIco"><Icon size={15} strokeWidth={2.2} /></span>
      <span className="hpTileText">
        <span className="hpTileLabel">{label}</span>
        <span className="hpTileValue">{value}</span>
      </span>
      <ChevronRight size={15} className="hpTileGo" />
    </button>
  );
}

// Pantalla de carga de la Home (clara, con el anillo de progreso)
function HomeBootOverlay({ visible, progress: rawProgress, label, sub, primary = "#1a2f8a", secondary = "#CF305D" }) {
  const R = 64, C = 2 * Math.PI * R;
  // El % mostrado nunca baja, pase lo que pase con los datos por debajo
  const [progress, setProgress] = useState(rawProgress);
  if (rawProgress > progress) setProgress(rawProgress);
  return (
    <div className={`hpBoot ${visible ? "" : "isGone"}`} aria-hidden={!visible} role="status" aria-live="polite">
      <div className="hpBootCard">
        <div className="hpBootHub">
          <svg width="168" height="168" viewBox="-84 -84 168 168" aria-hidden="true">
            <defs>
              <linearGradient id="hpBootGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={primary} />
                <stop offset="100%" stopColor={secondary} />
              </linearGradient>
            </defs>
            <circle r="78" fill="none" stroke="#e8ecf5" strokeDasharray="2 6" className="hpSpinSlow" />
            <circle r={R} fill="none" stroke="#eef1f7" strokeWidth="8" />
            <circle r={R} fill="none" stroke="url(#hpBootGrad)" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${C * Math.max(0.02, Math.min(1, progress / 100))} ${C}`} transform="rotate(-90)"
              style={{ transition: "stroke-dasharray 500ms cubic-bezier(0.22,1,0.36,1)" }} />
            <g className="hpSpinFast">
              <circle r="52" fill="none" stroke={primary} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 52 * 0.14} ${2 * Math.PI * 52}`} />
            </g>
          </svg>
          <div className="hpBootCore">
            <img src="/favicon.svg" alt="" draggable={false} />
          </div>
        </div>
        <p className="hpBootPct" style={{ color: primary }}>{Math.round(progress)}<small>%</small></p>
        <p className="hpBootTitle">{label}</p>
        <p className="hpBootSub">{sub}</p>
      </div>
    </div>
  );
}

// Donut de la estructura de costes, con el total (o el segmento señalado) en el centro
function BreakdownDonut({ items, total, hover, onHover, onPick, centerLabel }) {
  const data = items.map(it => ({ ...it, v: Math.abs(it.value) || 0.0001 }));
  const h = hover != null ? items[hover] : null;
  const absTot = Math.abs(total) || 1;
  return (
    <div className="hpDonut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="v" nameKey="name" innerRadius="70%" outerRadius="100%" paddingAngle={2}
            cornerRadius={4} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}
            isAnimationActive={false}
            onMouseEnter={(_, i) => onHover(i)} onMouseLeave={() => onHover(null)}
            onClick={(_, i) => onPick(i)}>
            {data.map((d, i) => (
              <Cell key={d.tag ?? i} fill={d.color} style={{ cursor: "pointer", transition: "opacity 200ms ease" }}
                opacity={hover == null || hover === i ? 1 : 0.28} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="hpDonutCenter">
        {h ? (
          <>
            <b>{((Math.abs(h.value) / absTot) * 100).toFixed(1)}%</b>
            <span title={h.name}>{h.name}</span>
          </>
        ) : (
          <>
            <b>{fmtBig(total)}</b>
            <span>{centerLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}

// Tooltip de la evolución
function TrendTooltip({ active, payload, slotLabels }) {
  if (!active || !payload?.length) return null;
  const fullLabel = payload[0]?.payload?.fullLabel ?? "";
  const rows = payload.filter(p => p.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="hpTip">
      <p className="hpTipHead">{fullLabel}</p>
      {rows.map(p => {
        const idx = Number(String(p.dataKey).replace("slot", ""));
        return (
          <div key={p.dataKey} className="hpTipRow">
            <i style={{ background: p.color }} />
            <span>{slotLabels[idx] ?? p.name}</span>
            <b>{fmtBig(p.value)}</b>
          </div>
        );
      })}
    </div>
  );
}

const HOME_CSS = `
.hpRoot, .hpBoot { --hp-ink: #0f172a; --hp-mute: #8a93a8; --hp-line: #eef1f6; }

/* ── KPI de color ── */
.hpKpi { position: relative; height: 100%; min-height: 148px; display: flex; flex-direction: column; padding: 14px 16px 0; border-radius: 22px; overflow: hidden; color: #fff; isolation: isolate;
  background:
    radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--kc) 55%, white) 0%, transparent 55%),
    linear-gradient(150deg, color-mix(in srgb, var(--kc) 82%, white) 0%, var(--kc) 48%, color-mix(in srgb, var(--kc) 80%, black) 100%);
  box-shadow: 0 1px 0 rgba(255,255,255,0.28) inset, 0 22px 40px -22px color-mix(in srgb, var(--kc) 85%, transparent), 0 8px 16px -10px color-mix(in srgb, var(--kc) 60%, transparent);
  transition: transform 420ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 300ms ease;
  animation: hpRise 640ms cubic-bezier(0.22,1,0.36,1) backwards; }
.group\\/kpislot:hover .hpKpi { transform: translateY(-4px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.3) inset, 0 30px 50px -22px color-mix(in srgb, var(--kc) 95%, transparent), 0 10px 20px -10px color-mix(in srgb, var(--kc) 70%, transparent); }
.hpKpiOrb { position: absolute; z-index: -1; width: 190px; height: 190px; right: -70px; bottom: -90px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 0 0 26px rgba(255,255,255,0.05), 0 0 0 56px rgba(255,255,255,0.035); }
.hpKpiSheen { position: absolute; inset: 0; z-index: -1; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.22) 50%, transparent 65%);
  background-size: 250% 100%; background-position: 120% 0; opacity: 0; transition: opacity 300ms ease; }
.group\\/kpislot:hover .hpKpiSheen { opacity: 1; animation: hpSheen 1.2s ease-out both; }
.hpKpiTop { display: flex; align-items: center; gap: 9px; padding-right: 30px; }
.hpKpiIco { width: 28px; height: 28px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0;
  background: rgba(255,255,255,0.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28); backdrop-filter: blur(6px); }
.hpKpiLabel { font-size: 13px; font-weight: 800; letter-spacing: -0.01em; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpKpiRow { display: flex; align-items: center; gap: 10px; margin-top: 14px; min-height: 34px; }
.hpKpiValue { font-size: 30px; font-weight: 900; letter-spacing: -0.045em; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 0 6px 22px rgba(0,0,0,0.18); }
.hpKpiValue.isEmpty { opacity: 0.5; }
.hpDelta { display: inline-flex; align-items: center; gap: 2px; padding: 3px 8px 3px 6px; border-radius: 999px; font-size: 11px; font-weight: 900; font-variant-numeric: tabular-nums;
  background: rgba(255,255,255,0.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.3); backdrop-filter: blur(6px); }
.hpDelta.isUp svg { color: #bbf7d0; } .hpDelta.isDown svg { color: #fecaca; }
.hpKpiSub { margin: 6px 0 0; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.72); font-variant-numeric: tabular-nums; }
.hpKpiSpark { margin: auto -16px 0; height: 42px; }
.hpSkel { width: 120px; height: 26px; border-radius: 9px; background: linear-gradient(90deg, rgba(255,255,255,0.15) 20%, rgba(255,255,255,0.38) 50%, rgba(255,255,255,0.15) 80%);
  background-size: 220% 100%; animation: hpShimmer 1.3s linear infinite; }

/* ── Tarjetas blancas ── */
.hpCard { position: relative; background: #fff; border-radius: 22px; border: 1px solid rgba(15,23,42,0.05);
  box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 20px 44px -30px rgba(26,47,138,0.35);
  animation: hpRise 640ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpTitle { margin: 0; font-size: 15px; font-weight: 900; letter-spacing: -0.02em; color: var(--hp-ink); white-space: nowrap; }
.hpMeta { margin: 0; font-size: 12px; font-weight: 600; color: var(--hp-mute); }
.hpSegm { display: inline-flex; padding: 3px; gap: 2px; border-radius: 12px; background: #f2f4f9; }
.hpSegm button { border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 800; color: #64748b; padding: 5px 10px; border-radius: 9px;
  transition: background 180ms ease, color 180ms ease, box-shadow 180ms ease; white-space: nowrap; }
.hpSegm button:hover { color: var(--hp-ink); }
.hpSegm button.on { background: #fff; color: var(--hp-p); box-shadow: 0 1px 2px rgba(15,23,42,0.08), 0 4px 10px -6px rgba(26,47,138,0.35); }
.hpBack { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px 5px 7px; border-radius: 999px; border: 0; cursor: pointer; font: inherit;
  font-size: 11.5px; font-weight: 800; color: #475569; background: #f2f4f9; transition: background 160ms ease; }
.hpBack:hover { background: #e6eaf3; }
.hpIconBtn { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; border: 0; cursor: pointer; flex-shrink: 0;
  transition: opacity 200ms ease, background 200ms ease, color 200ms ease; background: #f2f4f9; color: #64748b; }
.hpIconBtn:hover, .hpIconBtn.isOpen { background: var(--hp-p); color: #fff; }
.hpLink { display: inline-flex; align-items: center; gap: 3px; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 800; color: var(--hp-p);
  padding: 5px 8px; border-radius: 9px; transition: background 160ms ease; }
.hpLink:hover { background: color-mix(in srgb, var(--hp-p) 8%, white); }

/* Evolución: tooltip */
.hpTip { min-width: 190px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.97); backdrop-filter: blur(10px);
  border: 1px solid rgba(15,23,42,0.06); box-shadow: 0 18px 40px -16px rgba(15,23,42,0.3); }
.hpTipHead { margin: 0 0 6px; font-size: 12px; font-weight: 900; color: var(--hp-ink); }
.hpTipRow { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; }
.hpTipRow i { width: 8px; height: 8px; border-radius: 3px; flex-shrink: 0; }
.hpTipRow span { flex: 1; color: #64748b; font-weight: 600; }
.hpTipRow b { color: var(--hp-ink); font-weight: 900; font-variant-numeric: tabular-nums; }

/* Desglose */
.hpDonut { position: relative; height: 136px; flex-shrink: 0; margin: 6px 0 8px; animation: hpDonutIn 700ms cubic-bezier(0.34,1.56,0.64,1) 0.3s backwards; }
@keyframes hpDonutIn { from { opacity: 0; transform: scale(0.85) rotate(-40deg); } to { opacity: 1; transform: none; } }
.hpDonutCenter { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; text-align: center; padding: 0 30%; }
.hpDonutCenter b { font-size: 19px; font-weight: 900; letter-spacing: -0.03em; color: var(--hp-ink); font-variant-numeric: tabular-nums; line-height: 1.1; }
.hpDonutCenter span { margin-top: 2px; font-size: 11px; font-weight: 700; color: var(--hp-mute); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpBdRow { display: grid; grid-template-columns: 10px minmax(0,1fr) auto; align-items: center; column-gap: 10px; row-gap: 0; padding: 6px 10px; margin: 0 -10px; border-radius: 12px; cursor: pointer;
  transition: background 160ms ease, opacity 200ms ease; animation: hpRise 520ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpBdRow:hover, .hpBdRow.isHover { background: #f6f7fb; }
.hpBdRow.isDim { opacity: 0.5; }
.hpBdRow.isActive { background: color-mix(in srgb, var(--bc) 10%, white); }
.hpBdSw { width: 10px; height: 10px; border-radius: 4px; background: var(--bc); grid-row: span 2; }
.hpBdName { font-size: 12.5px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpBdVal { font-size: 12.5px; font-weight: 900; color: var(--hp-ink); text-align: right; font-variant-numeric: tabular-nums; }
.hpBdPct { font-size: 11px; font-weight: 600; color: var(--hp-mute); font-variant-numeric: tabular-nums; }
.hpChg { justify-self: end; display: inline-flex; align-items: center; gap: 1px; font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hpChg.isGood { color: #0f9b67; } .hpChg.isBad { color: #d0344f; }

/* Ranking */
.hpPodium { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; flex: 1; min-height: 0; }
.hpPod { position: relative; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; padding: 11px 13px; border-radius: 16px; border: 1px solid var(--hp-line);
  background: linear-gradient(180deg, #fff, #fafbfe); overflow: hidden; transition: transform 320ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease, border-color 200ms ease;
  animation: hpRise 520ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpPod:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--hp-p) 20%, white); box-shadow: 0 14px 28px -20px rgba(26,47,138,0.5); }
.hpPod.isFirst { border-color: color-mix(in srgb, var(--hp-p) 22%, white); background: linear-gradient(160deg, color-mix(in srgb, var(--hp-p) 7%, white), #fff 60%); }
.hpPodTop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.hpRankN { width: 22px; height: 22px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; font-size: 11px; font-weight: 900; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--hp-p) 9%, white); color: var(--hp-p); }
.hpRankN.isFirst { background: var(--hp-p); color: #fff; box-shadow: 0 6px 14px -6px var(--hp-p); }
.hpRankN.isMuted { background: #f1f3f8; color: #94a3b8; }
.hpPodName { font-size: 12.5px; font-weight: 800; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpPodVal { font-size: 20px; font-weight: 900; letter-spacing: -0.035em; color: var(--hp-ink); font-variant-numeric: tabular-nums; line-height: 1; }
.hpPodFoot { display: flex; align-items: center; gap: 8px; }
.hpPodFoot span { font-size: 11px; font-weight: 700; color: var(--hp-mute); white-space: nowrap; font-variant-numeric: tabular-nums; }
.hpTrack { position: relative; flex: 1; height: 6px; border-radius: 999px; background: #eef1f8; overflow: hidden; }
.hpTrack > span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: linear-gradient(90deg, color-mix(in srgb, var(--hp-p) 50%, #8fb0ff), color-mix(in srgb, var(--hp-p) 18%, #b7ccff));
  transition: width 900ms cubic-bezier(0.22,1,0.36,1); animation: hpGrow 900ms cubic-bezier(0.22,1,0.36,1) backwards; transform-origin: left; }
.hpRankHead, .hpRankRow { display: grid; grid-template-columns: 26px 34px minmax(140px, 1.2fr) minmax(0, 3fr) 70px 90px; align-items: center; column-gap: 12px; }
.hpRankHead { padding: 0 10px 8px; font-size: 11px; font-weight: 700; color: var(--hp-mute); border-bottom: 1px solid var(--hp-line); margin-bottom: 4px; }
.hpRankRow { padding: 7px 10px; border-radius: 12px; transition: background 160ms ease; animation: hpRise 480ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpRankRow:hover { background: #f6f7fb; }
.hpAvatarCo { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; font-size: 10.5px; font-weight: 900; color: var(--hp-p);
  background: color-mix(in srgb, var(--hp-p) 8%, white); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hp-p) 14%, white); }
.hpRankName { font-size: 13px; font-weight: 800; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpRankShare { font-size: 12px; font-weight: 700; color: #64748b; text-align: right; font-variant-numeric: tabular-nums; }
.hpRankVal { font-size: 13px; font-weight: 900; color: var(--hp-ink); text-align: right; font-variant-numeric: tabular-nums; }

/* Ranking ampliado */
.hpRkStats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.hpRkStat { position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 10px 13px; border-radius: 14px; background: #f7f8fc; border: 1px solid var(--hp-line);
  animation: hpRise 520ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpRkStat > span { font-size: 11.5px; font-weight: 700; color: var(--hp-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpRkStat > b { font-size: 19px; font-weight: 900; letter-spacing: -0.03em; color: var(--hp-ink); line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 54px; }
.hpRkStat > em { position: absolute; right: 12px; bottom: 11px; display: inline-flex; align-items: center; gap: 1px; padding: 2px 7px 2px 5px; border-radius: 999px; font-style: normal; font-size: 11px; font-weight: 900; font-variant-numeric: tabular-nums; }
.hpRkStat > em.isUp { background: #e6f7ef; color: #0f9b67; } .hpRkStat > em.isDown { background: #fdecef; color: #d0344f; }
.hpRkStat > em.isNeutral { background: color-mix(in srgb, var(--hp-p) 9%, white); color: var(--hp-p); padding: 2px 7px; }
.hpRkMini { position: absolute; right: 12px; bottom: 16px; width: 46px; height: 5px; border-radius: 999px; background: #e7eaf3; overflow: hidden; }
.hpRkMini span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: color-mix(in srgb, var(--hp-p) 45%, #8fb0ff); }
.hpRkStrip { display: flex; gap: 2px; height: 12px; margin-bottom: 12px; border-radius: 999px; overflow: hidden; animation: hpGrow 900ms cubic-bezier(0.22,1,0.36,1) 0.15s backwards; transform-origin: left; }
.hpRkStrip span { flex-basis: 0; min-width: 3px; transition: opacity 200ms ease; cursor: default; }
.hpRkHead, .hpRkRow { display: grid; grid-template-columns: 24px minmax(170px, 1.3fr) minmax(0, 2.6fr) 64px 104px 84px; align-items: center; column-gap: 14px; }
.hpRkHead { padding: 0 10px 7px; font-size: 11px; font-weight: 700; color: var(--hp-mute); border-bottom: 1px solid var(--hp-line); margin-bottom: 4px; }
.hpRkHead span:nth-child(n+4) { text-align: right; }
.hpRkHead span:nth-child(3) { display: inline-flex; align-items: center; gap: 6px; }
.hpRkAvgKey { display: inline-block; width: 2px; height: 11px; margin-left: 0; border-radius: 2px; background: #94a3b8; }
.hpRkRow { padding: var(--rk-pad, 7px) 10px; border-radius: 12px; transition: background 160ms ease, opacity 200ms ease; animation: hpRise 480ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpRkRow.isHover { background: #f5f7fc; }
.hpRkRow.isDim { opacity: 0.55; }
.hpRkWho { display: flex; align-items: center; gap: 10px; min-width: 0; }
.hpRkLegal { margin: 1px 0 0; font-size: 11px; font-weight: 600; color: var(--hp-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpRkBar { position: relative; }
.hpRkAvg { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; border-radius: 2px; background: #94a3b8; opacity: 0.7; }
.hpRkDelta { display: flex; justify-content: flex-end; }
.hpRkRow .hpRankShare, .hpRkRow .hpRankVal { text-align: right; }

/* Recuentos */
.hpTile { position: relative; display: flex; align-items: center; gap: 9px; min-width: 0; width: 100%; padding: 11px; border-radius: 18px; cursor: pointer; font: inherit; text-align: left;
  background: #fff; border: 1px solid rgba(15,23,42,0.05); box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 16px 34px -26px rgba(26,47,138,0.35);
  transition: transform 320ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease, border-color 200ms ease; animation: hpRise 600ms cubic-bezier(0.22,1,0.36,1) backwards; }
.hpTile:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--tc) 25%, white); box-shadow: 0 18px 34px -20px color-mix(in srgb, var(--tc) 60%, transparent); }
.hpTile:focus-visible { outline: 2px solid var(--tc); outline-offset: 2px; }
.hpTileIco { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; color: var(--tc);
  background: color-mix(in srgb, var(--tc) 10%, white); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tc) 18%, white); }
.hpTileText { display: flex; flex-direction: column; min-width: 0; }
.hpTileLabel { font-size: 11.5px; font-weight: 700; color: var(--hp-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hpTileValue { font-size: 20px; font-weight: 900; letter-spacing: -0.03em; color: var(--hp-ink); line-height: 1.1; font-variant-numeric: tabular-nums; }
.hpTileGo { position: absolute; right: 10px; top: 50%; margin-top: -7.5px; color: #cbd5e1; opacity: 0; transform: translateX(-4px); transition: opacity 200ms ease, transform 200ms ease; }
.hpTile:hover .hpTileGo { opacity: 1; transform: none; }

/* Carga inicial (clara) */
.hpBoot { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center;
  background: rgba(246,248,252,0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  transition: opacity 420ms ease, visibility 0s linear 0s; }
.hpBoot.isGone { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 420ms ease, visibility 0s linear 420ms; }
.hpBootCard { display: flex; flex-direction: column; align-items: center; padding: 30px 44px 28px; border-radius: 28px; background: #fff; min-width: 340px;
  border: 1px solid rgba(15,23,42,0.05); box-shadow: 0 30px 80px -30px rgba(26,47,138,0.4); animation: hpPop 420ms cubic-bezier(0.34,1.56,0.64,1) both; }
.hpBoot.isGone .hpBootCard { transform: scale(0.97); transition: transform 420ms ease; }
.hpBootHub { position: relative; width: 168px; height: 168px; }
.hpBootHub svg { position: absolute; inset: 0; overflow: visible; }
.hpBootCore { position: absolute; left: 50%; top: 50%; width: 92px; height: 92px; margin: -46px 0 0 -46px; border-radius: 50%; display: grid; place-items: center;
  background: #fff; box-shadow: 0 12px 30px -12px rgba(26,47,138,0.45), inset 0 0 0 1px rgba(15,23,42,0.05); }
.hpBootCore img { width: 48px; height: 48px; object-fit: contain; }
.hpBootPct { margin: 14px 0 0; font-size: 26px; font-weight: 900; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; line-height: 1; }
.hpBootPct small { font-size: 13px; opacity: 0.45; margin-left: 1px; }
.hpBootTitle { margin: 10px 0 0; font-size: 14px; font-weight: 800; color: var(--hp-ink); text-align: center; }
.hpBootSub { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--hp-mute); text-align: center; }
.hpSpinSlow { animation: hpRot 30s linear infinite; transform-origin: 0 0; }
.hpSpinFast { animation: hpRot 1.4s linear infinite; transform-origin: 0 0; }

/* Resaltado de series sin re-animar la gráfica */
.hpChartWrap .hpArea .recharts-area-curve { transition: stroke-opacity 220ms ease, stroke-width 220ms ease; }
.hpChartWrap .hpArea .recharts-area-area { fill-opacity: 0; transition: fill-opacity 260ms ease; }
.hpChartWrap[data-fill="0"]:not([data-focus="0"]):not([data-focus="1"]):not([data-focus="2"]):not([data-focus="3"]) .hpArea0 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-focus="0"] .hpArea:not(.hpArea0) .recharts-area-curve { stroke-opacity: 0.16; }
.hpChartWrap[data-focus="0"] .hpArea0 .recharts-area-curve { stroke-width: 2.8px; }
.hpChartWrap[data-focus="0"] .hpArea0 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-fill="1"]:not([data-focus="0"]):not([data-focus="1"]):not([data-focus="2"]):not([data-focus="3"]) .hpArea1 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-focus="1"] .hpArea:not(.hpArea1) .recharts-area-curve { stroke-opacity: 0.16; }
.hpChartWrap[data-focus="1"] .hpArea1 .recharts-area-curve { stroke-width: 2.8px; }
.hpChartWrap[data-focus="1"] .hpArea1 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-fill="2"]:not([data-focus="0"]):not([data-focus="1"]):not([data-focus="2"]):not([data-focus="3"]) .hpArea2 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-focus="2"] .hpArea:not(.hpArea2) .recharts-area-curve { stroke-opacity: 0.16; }
.hpChartWrap[data-focus="2"] .hpArea2 .recharts-area-curve { stroke-width: 2.8px; }
.hpChartWrap[data-focus="2"] .hpArea2 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-fill="3"]:not([data-focus="0"]):not([data-focus="1"]):not([data-focus="2"]):not([data-focus="3"]) .hpArea3 .recharts-area-area { fill-opacity: 1; }
.hpChartWrap[data-focus="3"] .hpArea:not(.hpArea3) .recharts-area-curve { stroke-opacity: 0.16; }
.hpChartWrap[data-focus="3"] .hpArea3 .recharts-area-curve { stroke-width: 2.8px; }
.hpChartWrap[data-focus="3"] .hpArea3 .recharts-area-area { fill-opacity: 1; }

@keyframes hpRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes hpPop { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: none; } }
@keyframes hpShimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes hpSheen { from { background-position: 120% 0; } to { background-position: -60% 0; } }
@keyframes hpGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes hpRot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .hpKpi, .hpCard, .hpTile, .hpBdRow, .hpRankRow, .hpPod, .hpTrack > span, .hpSpinSlow, .hpSpinFast, .hpSkel, .hpBootCard { animation: none !important; }
}
`;

function AnimatedNumber({ value, format = fmtBig, duration = 600 }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const target = Number(value) || 0;
    const from = Number(fromRef.current) || 0;
    if (from === target) { setDisplay(target); return; }

    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format(display)}</>;
}

function useAnimatedNumber(target, duration = 700) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}

function DetailPopup({ title, items, icon: Icon, color, onClose, renderItem }) { // eslint-disable-line no-unused-vars
  const t = useT();
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const escHandler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-6"
      style={{
        background: "rgba(15, 23, 42, 0.4)",
        backdropFilter: "blur(8px)",
        animation: "hpOverlayFadeIn 200ms ease-out",
      }}
    >
      <div
        ref={ref}
        className="relative bg-white rounded-3xl border border-gray-100 flex flex-col"
        style={{
          width: 480,
          maxHeight: "75vh",
          boxShadow: "0 24px 80px -12px rgba(26,47,138,0.3), 0 8px 24px -8px rgba(0,0,0,0.1)",
          animation: "hpPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: `${color}15`, border: `1px solid ${color}25` }}
            >
              <Icon size={15} style={{ color }} />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400">{title}</p>
             <p className="text-base font-black text-gray-800">{items.length} {items.length === 1 ? t("detail_item") : t("detail_items")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 hide-scrollbar">
          {items.length === 0 ? (
           <p className="text-xs text-gray-300 text-center py-10">{t("detail_no_items")}</p>
          ) : (
            <div className="space-y-1">
              {items.map((item, i) => (
                <div
                  key={i}
                  className="px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                  style={{ animation: `kCardEntry 0.3s ease-out ${Math.min(i, 15) * 0.02}s both` }}
                >
                  {renderItem(item, i)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur-md border border-gray-100 rounded-xl shadow-xl px-3 py-2 text-xs">
      <p className="font-black text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-500 font-medium">{p.name}:</span>
          <span className="font-black text-gray-700">{fmtBig(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PERIOD + SCOPE PICKER
═══════════════════════════════════════════════════════════════ */
function CompareCalendar({ compareYear, compareMonth, onSelectCompare, colors }) {
  const t = useT();
  const [browseYear, setBrowseYear] = useState(Number(compareYear) || new Date().getFullYear());
  const MONTHS = [t("month_1"),t("month_2"),t("month_3"),t("month_4"),t("month_5"),t("month_6"),t("month_7"),t("month_8"),t("month_9"),t("month_10"),t("month_11"),t("month_12")].map(m => m.slice(0,3));
  const currentYear = new Date().getFullYear();
  return (
    <div className="p-3 border-b border-gray-100">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2">{t("picker_compare_to")}</p>
      <div className="flex items-center justify-between mb-2.5">
        <button onClick={() => setBrowseYear(y => y - 1)}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500">‹</button>
        <span className="text-sm font-black text-gray-800">{browseYear}</span>
        <button onClick={() => setBrowseYear(y => Math.min(y + 1, currentYear))}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
          disabled={browseYear >= currentYear}>›</button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {MONTHS.map((m, i) => {
          const mNum = i + 1;
          const isSelected = String(browseYear) === String(compareYear) && String(mNum) === String(compareMonth);
          const isFuture = browseYear === currentYear && mNum > new Date().getMonth() + 1;
          return (
            <button key={m}
              disabled={isFuture}
              onClick={() => { onSelectCompare?.(String(browseYear), String(mNum)); }}
              className="py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{
                background: isSelected ? colors.primary : "transparent",
                color: isSelected ? "#fff" : isFuture ? "#d1d5db" : "#374151",
                cursor: isFuture ? "not-allowed" : "pointer",
              }}
              onMouseEnter={e => { if (!isSelected && !isFuture) e.currentTarget.style.background = `${colors.primary}12`; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodPicker({
  year, month, onSelectPeriod,
  viewScope, onScopeChange,
  valueMode, onValueModeChange,
  companies, holdings = [],
  selectedCompany, onCompanyChange,
  compareYear, compareMonth, onSelectCompare,
  colors, onClose,
}) {
  const t = useT();
  const [browseYear, setBrowseYear] = useState(Number(year) || new Date().getFullYear());
  const MONTHS = [t("month_1"),t("month_2"),t("month_3"),t("month_4"),t("month_5"),t("month_6"),t("month_7"),t("month_8"),t("month_9"),t("month_10"),t("month_11"),t("month_12")].map(m => m.slice(0,3));
  const currentYear = new Date().getFullYear();

  return (
<div
     className="absolute top-full mt-2 z-[200] rounded-2xl overflow-hidden"
      style={{
        width: 340,
        right: 0,
        background: "rgba(255,255,255,0.99)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(26,47,138,0.1)",
        boxShadow: "0 24px 60px -12px rgba(26,47,138,0.25), 0 0 0 1px rgba(255,255,255,0.5) inset",
animation: "pickerFoldDown 280ms cubic-bezier(0.4, 0, 0.2, 1) 280ms both",
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* ── Month / Year selector ── */}
      <div className="p-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2.5">
          <button
            onClick={() => setBrowseYear(y => y - 1)}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
          >‹</button>
          <span className="text-sm font-black text-gray-800">{browseYear}</span>
          <button
            onClick={() => setBrowseYear(y => Math.min(y + 1, currentYear))}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
            disabled={browseYear >= currentYear}
          >›</button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {MONTHS.map((m, i) => {
            const mNum = i + 1;
            const isSelected = String(browseYear) === String(year) && String(mNum) === String(month);
            const isFuture = browseYear === currentYear && mNum > new Date().getMonth() + 1;
            return (
              <button
                key={m}
                disabled={isFuture}
                onClick={() => { onSelectPeriod(String(browseYear), String(mNum)); onClose(); }}
                className="py-1.5 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: isSelected ? colors.primary : isFuture ? "transparent" : "transparent",
                  color: isSelected ? "#fff" : isFuture ? "#d1d5db" : "#374151",
                  cursor: isFuture ? "not-allowed" : "pointer",
                }}
                onMouseEnter={e => { if (!isSelected && !isFuture) e.currentTarget.style.background = `${colors.primary}12`; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

{/* ── Compare-to mini calendar ── */}
      <CompareCalendar
        compareYear={compareYear} compareMonth={compareMonth}
        onSelectCompare={onSelectCompare}
        colors={colors}
      />

{/* ── Value-mode toggle (Monthly / YTD) ── */}
      <div className="p-3 border-b border-gray-100">
<p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2">{t("picker_values")}</p>
        <div className="flex gap-1.5 p-1 rounded-xl bg-gray-100">
          {[
            { value: "monthly", label: t("picker_monthly") },
            { value: "ytd",     label: t("picker_ytd") },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => onValueModeChange?.(opt.value)}
              className="flex-1 py-1.5 rounded-lg text-xs font-black transition-all"
              style={{
                background: valueMode === opt.value ? "#fff" : "transparent",
                color: valueMode === opt.value ? colors.primary : "#9ca3af",
                boxShadow: valueMode === opt.value ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scope toggle ── */}
      <div className="p-3 border-b border-gray-100">
<p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2">{t("picker_view")}</p>
        <div className="flex gap-1.5 p-1 rounded-xl bg-gray-100">
          {[
            { value: "consolidated", label: t("picker_consolidated") },
            { value: "individual",   label: t("picker_individual") },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => onScopeChange(opt.value)}
              className="flex-1 py-1.5 rounded-lg text-xs font-black transition-all"
              style={{
                background: viewScope === opt.value ? "#fff" : "transparent",
                color: viewScope === opt.value ? colors.primary : "#9ca3af",
                boxShadow: viewScope === opt.value ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

{/* ── Company / Holding selector ── */}
      <div className="p-3 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
<p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2">
          {viewScope === "consolidated" ? t("picker_holding") : t("picker_company")}
        </p>
{viewScope === "consolidated" ? (
          holdings.length > 0 ? holdings.map(h => {
            const active = h.shortName === selectedCompany;
            return (
              <button key={h.shortName}
                onClick={() => { onCompanyChange(h.shortName); onClose(); }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? colors.primary : "transparent"; }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${colors.primary}10`; }}
                className="w-full text-left px-3 py-2 rounded-xl mb-0.5 transition-all"
                style={{ background: active ? colors.primary : "transparent" }}
              >
                <p className="text-xs font-bold flex items-center gap-2" style={{ color: active ? "#fff" : "#374151" }}>
                  {h.legalName}
                  {h.isRoot && (
                    <span className="px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider"
                      style={{ background: active ? "rgba(255,255,255,0.2)" : `${colors.primary}15`, color: active ? "#fff" : colors.primary }}>
{t("picker_root")}
                    </span>
                  )}
                </p>
                <p className="text-[9px] font-mono mt-0.5" style={{ color: active ? "rgba(255,255,255,0.7)" : "#9ca3af" }}>{h.shortName}</p>
              </button>
            );
          }) : <p className="text-xs text-gray-300 px-2">{t("picker_no_holdings")}</p>
        ) : (
          companies.length > 0 ? companies.map((c, i) => {
            const shortName = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? String(c)) : String(c);
            const legalName = typeof c === "object" ? (c.CompanyLegalName ?? c.companyLegalName ?? shortName) : shortName;
            const active = shortName === selectedCompany;
            return (
              <button key={i}
                onClick={() => { onCompanyChange(shortName); onClose(); }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? colors.primary : "transparent"; }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${colors.primary}10`; }}
                className="w-full text-left px-3 py-2 rounded-xl mb-0.5 transition-all"
                style={{ background: active ? colors.primary : "transparent" }}
              >
                <p className="text-xs font-bold" style={{ color: active ? "#fff" : "#374151" }}>{legalName}</p>
                <p className="text-[9px] font-mono mt-0.5" style={{ color: active ? "rgba(255,255,255,0.7)" : "#9ca3af" }}>{shortName}</p>
              </button>
            );
          }) : <p className="text-xs text-gray-300 px-2">{t("picker_no_companies")}</p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   KPI SLOT SELECTOR POPOVER
═══════════════════════════════════════════════════════════════ */
function KpiSelectorPopover({ kpiList, currentId, onSelect, onClose }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return kpiList.filter(k =>
      !q || k.label.toLowerCase().includes(q) || k.id.toLowerCase().includes(q) || (k.category ?? "").toLowerCase().includes(q)
    );
  }, [kpiList, search]);

  const grouped = useMemo(() => filtered.reduce((acc, k) => {
    const cat = k.category || "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(k);
    return acc;
  }, {}), [filtered]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 right-0 mt-2 z-[60] rounded-2xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.98)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(26,47,138,0.1)",
        boxShadow: "0 24px 60px -12px rgba(26,47,138,0.3), 0 0 0 1px rgba(255,255,255,0.6) inset",
        animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)",
      }}
      onClick={e => e.stopPropagation()}
    >
{/* Header — search only, no title */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-gray-50 border border-gray-100">
          <Search size={11} className="text-gray-400 flex-shrink-0" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
           placeholder={t("kpi_search")}
            className="flex-1 text-xs outline-none bg-transparent text-gray-700 placeholder:text-gray-300"
          />
        </div>
      </div>

{/* List */}
<div className="overflow-y-auto p-1.5 hide-scrollbar" style={{ maxHeight: 280 }}>
        {/* Custom company KPIs pinned at top */}
        {(() => {
          const custom = filtered.filter(k => k.isCustom);
          if (!custom.length) return null;
          return (
            <div className="mb-2">
              <div className="flex items-center gap-2 px-2 py-1.5 mb-0.5">
                <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: "#7c3aed" }} />
<p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "#7c3aed" }}>
                  {t("kpi_company_kpis")}
                </p>
                <div className="flex-1 h-px" style={{ background: "#7c3aed25" }} />
                <span className="text-[8px] font-bold tabular-nums" style={{ color: "#7c3aed80" }}>{custom.length}</span>
              </div>
              {custom.map(k => {
                const active = k.id === currentId;
                return (
                  <button
                    key={k.id}
                    onClick={() => onSelect(k.id)}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all flex items-center gap-2"
                    style={{
                      background: active ? "#7c3aed" : "transparent",
                      color: active ? "#fff" : "#374151",
                      fontWeight: active ? 700 : 500,
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#7c3aed12"; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span className="flex-1">{k.label}</span>
<span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0"
                      style={{ background: active ? "rgba(255,255,255,0.2)" : "#7c3aed15", color: active ? "#fff" : "#7c3aed" }}>
                      {t("kpi_custom")}
                    </span>
                  </button>
                );
              })}
              <div className="h-px bg-gray-100 mx-2 mt-1.5" />
            </div>
          );
        })()}

        {/* System KPIs grouped by category */}
        {Object.entries(grouped)
          .filter(([cat]) => cat !== "Custom")
          .map(([cat, kpis], catIdx) => {
            const CAT_COLORS = [
              "#1a2f8a", "#CF305D", "#57aa78", "#7c3aed",
              "#d97706", "#0891b2", "#be185d", "#065f46",
            ];
            const catColor = CAT_COLORS[catIdx % CAT_COLORS.length];
            return (
              <div key={cat} className="mb-1">
                <div className="flex items-center gap-2 px-2 py-1.5 mb-0.5">
                  <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: catColor }} />
                  <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: catColor }}>
                    {cat}
                  </p>
                  <div className="flex-1 h-px" style={{ background: `${catColor}25` }} />
                  <span className="text-[8px] font-bold tabular-nums" style={{ color: `${catColor}80` }}>
                    {kpis.length}
                  </span>
                </div>
                {kpis.map(k => {
                  const active = k.id === currentId;
                  return (
                    <button
                      key={k.id}
                      onClick={() => onSelect(k.id)}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all"
                      style={{
                        background: active ? catColor : "transparent",
                        color: active ? "#fff" : "#374151",
                        fontWeight: active ? 700 : 500,
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${catColor}12`; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
            );
          })}

        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">{t("kpi_no_match")}</p>
        )}
      </div>

<style>{`
        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
function UnmappedAccountsAlert({ accounts, standard, onClose, onMapNow }) {
  const t = useT();
  const filtered = accounts;

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-6"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(10px)" }}>
      <div className="relative bg-white rounded-3xl flex flex-col overflow-hidden"
        style={{ width: 520, maxHeight: "82vh",
          boxShadow: "0 32px 80px -12px rgba(217,119,6,0.3), 0 8px 24px -8px rgba(0,0,0,0.1)",
          animation: "hpPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)" }}>

        {/* Header */}
        <div className="relative overflow-hidden px-6 pt-6 pb-5 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #b45309 0%, #d97706 60%, #f59e0b 100%)" }}>
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full opacity-15"
            style={{ background: "white" }} />
          <div className="relative flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)" }}>
              <AlertTriangle size={22} className="text-white" />
            </div>
            <div>
<p className="text-white font-black text-lg leading-tight">
                {accounts.length} {t("unmapped_title")}
              </p>
              <p className="text-white/70 text-[11px] mt-0.5 uppercase tracking-wider font-bold">
                {standard} · {t("unmapped_subtitle")}
              </p>
              <p className="text-white/80 text-xs mt-2 leading-relaxed max-w-sm">
                {t("unmapped_desc_pre")}{" "}
                <span className="font-black text-white">{standard}</span>{" "}
                {t("unmapped_desc_post")}
              </p>
            </div>
          </div>
        </div>


        {/* Account list */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-5 pb-2 space-y-0.5">
          {filtered.map((a, i) => (
            <div key={a.code}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-amber-50/60 transition-colors"
              style={{ animation: `kCardEntry 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#d97706" }} />
              <span className="font-mono font-bold text-[11px] flex-shrink-0 w-20 truncate"
                style={{ color: "#d97706" }}>{a.code}</span>
              <span className="text-xs text-gray-600 flex-1 truncate">{a.name}</span>
            </div>
          ))}
          {filtered.length === 0 && (
           <p className="text-xs text-gray-300 text-center py-8">{t("unmapped_no_match")}</p>
          )}
        </div>

{/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex items-center gap-3">
<button onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-black bg-gray-100 text-gray-500 transition-all hover:bg-gray-200">
            {t("unmapped_dismiss")}
          </button>
          <button onClick={() => { onClose(); onMapNow?.(); }}
            className="flex-1 py-2.5 rounded-xl text-sm font-black text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #b45309 0%, #d97706 100%)",
              boxShadow: "0 4px 14px -4px rgba(180,83,9,0.5)" }}>
            {t("unmapped_map_now")}
          </button>
        </div>
      </div>
    </div>
  );
}

function BreakdownLibraryModal({
  structures, activeViewId, defaultViewId, colors,
  onApply, onSetDefault, onEdit, onDelete, onCreate, onClose,
}) {
  void colors;
  const t = useT();
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-6"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(8px)" }}>
      <div className="relative bg-white rounded-3xl flex flex-col"
        style={{ width: 520, maxHeight: "82vh",
          boxShadow: "0 24px 80px -12px rgba(26,47,138,0.3)",
          animation: "hpPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div>
<p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-0.5">{t("breakdown_lib_kicker")}</p>
            <p className="text-base font-black text-gray-800">{t("breakdown_lib_title")}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400">✕</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto hide-scrollbar p-5 space-y-2.5">
          {structures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: `${colors.primary}10` }}>
                <Layers size={24} style={{ color: colors.primary, opacity: 0.3 }} />
              </div>
<p className="text-xs font-black text-gray-400">{t("breakdown_lib_empty")}</p>
              <p className="text-[10px] text-gray-300">{t("breakdown_lib_empty_sub")}</p>
            </div>
          ) : structures.map((s, si) => {
            const isActive  = s.id === activeViewId;
            const isDefault = s.id === defaultViewId;
            return (
              <div key={s.id}
                className="rounded-2xl border transition-all"
                style={{
                  borderColor: isActive ? colors.primary + "40" : "#f0f0f0",
                  background:  isActive ? colors.primary + "06" : "#fafbff",
                  animation:   `kCardEntry 0.3s ease-out ${si * 0.04}s both`,
                }}>

{/* Top row */}
                <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-gray-800 text-sm">{s.name}</p>
{isActive && (
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full text-white"
                          style={{ background: colors.primary }}>{t("breakdown_lib_active")}</span>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-gray-400 mt-0.5">{s.description}</p>
                    )}
                    <p className="text-[9px] font-bold text-gray-300 mt-1">
                      {s.items?.length ?? 0} group{s.items?.length !== 1 ? "s" : ""}
                      {s._editorName && (
                        <span className="ml-1.5 text-gray-300">· {s._editorName}</span>
                      )}
                    </p>
                  </div>

                  {/* Default toggle — inline label + pill */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
<span className="text-[8px] font-black uppercase tracking-wider"
                      style={{ color: isDefault ? colors.primary : "#9ca3af" }}>
                      {t("breakdown_lib_default")}
                    </span>
                    <div
                      onClick={() => onSetDefault(isDefault ? null : s.id)}
                      className="relative cursor-pointer select-none flex-shrink-0"
                      style={{
                        width: 34, height: 18, borderRadius: 9,
                        background: isDefault ? colors.primary : "#d1d5db",
                        transition: "background 220ms",
                      }}>
                      <div style={{
                        position: "absolute",
                        top: 2,
                        left: isDefault ? 16 : 2,
                        width: 14, height: 14,
                        borderRadius: "50%",
                        background: "white",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        transition: "left 220ms",
                      }} />
                    </div>
                  </div>
                </div>

{/* Actions */}
                <div className="flex items-center gap-2 px-4 pb-3">
                  {confirmDeleteId === s.id ? (
<>
                      <span className="text-[10px] font-black text-red-500 flex-1">{t("breakdown_lib_confirm_delete")}</span>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1.5 rounded-xl text-[10px] font-black bg-gray-100 text-gray-500 transition-all">
                        {t("breakdown_lib_cancel")}
                      </button>
                      <button
                        onClick={() => { onDelete(s.id); setConfirmDeleteId(null); }}
                        className="px-2.5 py-1.5 rounded-xl text-[10px] font-black text-white transition-all"
                        style={{ background: "#dc2626" }}>
                        {t("breakdown_lib_delete")}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Edit */}
                      <button
                        onClick={() => onEdit(s)}
                        className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                        style={{ background: `${colors.primary}10`, color: colors.primary }}
                        title="Edit">
                        <Edit3 size={11} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => setConfirmDeleteId(s.id)}
                        className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                        style={{ background: "#fee2e2", color: "#dc2626" }}
                        title="Delete">
                        <Trash2 size={11} />
                      </button>

                      {/* Apply */}
                      <button
                        onClick={() => { onApply(s.id); onClose(); }}
                        className="flex-1 py-1.5 rounded-xl text-[10px] font-black transition-all hover:scale-[1.01]"
                        style={{
                          background: isActive
                            ? "#e5e7eb"
                            : `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)`,
                          color: isActive ? "#9ca3af" : "white",
                        }}
disabled={isActive}>
                        {isActive ? t("breakdown_lib_active_check") : t("breakdown_lib_apply")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100">
          <button onClick={onCreate}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed transition-all hover:bg-gray-50"
            style={{ borderColor: `${colors.primary}25` }}>
<span className="text-xs font-black" style={{ color: colors.primary, opacity: 0.6 }}>
              {t("breakdown_lib_create_new")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

const GROUP_PALETTE = ["#1a2f8a","#CF305D","#57aa78","#7c3aed","#d97706","#0891b2","#be185d","#065f46"];
function BreakdownBuilderModal({ structure, groupAccounts, currentPivot, colors, onSave, onDelete, onClose }) {
  const t = useT();
  const [name, setName]               = useState(structure?.name ?? "");
  const [description, setDescription] = useState(structure?.description ?? "");
  const [groups, setGroups]           = useState(() =>
    (structure?.items ?? []).map((g, gi) => ({
      ...g,
      color: g.color ?? GROUP_PALETTE[gi % GROUP_PALETTE.length],
      sign:  g.sign  ?? "+",
      _key:  g.id    ?? crypto.randomUUID(),
      lines: (g.lines ?? []).map(l => ({ ...l, _key: Math.random().toString(36).slice(2) })),
    }))
  );
  const [addingToGroup, setAddingToGroup] = useState(null);
  const [acSearch, setAcSearch]           = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accountMap = useMemo(() => {
    const m = new Map();
    (groupAccounts ?? []).forEach(g => {
      const code = String(g.AccountCode ?? g.accountCode ?? "");
      const name = String(g.AccountName ?? g.accountName ?? "");
      if (code) m.set(code, name);
    });
    return m;
  }, [groupAccounts]);

const allAccounts = useMemo(() =>
    [...accountMap.entries()]
      .map(([code, name]) => {
        const raw = currentPivot?.get(code) ?? 0;
        return { code, name, balance: Math.abs(raw), hasData: Math.abs(raw) > 0.005 };
      })
      .sort((a, b) => {
        // Accounts with data first, then alphabetically by code
        if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
        return a.code.localeCompare(b.code);
      }),
    [accountMap, currentPivot]
  );

  const addGroup = () => {
    const key = Math.random().toString(36).slice(2);
    setGroups(prev => [...prev, { id: key, _key: key, label: "", color: GROUP_PALETTE[prev.length % GROUP_PALETTE.length], sign: "+", order: prev.length, lines: [] }]);
  };
  const updateGroup = (key, patch) => setGroups(prev => prev.map(g => g._key === key ? { ...g, ...patch } : g));
  const removeGroup = (key) => setGroups(prev => prev.filter(g => g._key !== key).map((g, i) => ({ ...g, order: i })));

const addLine = (groupKey, code, name) => {
    updateGroup(groupKey, { lines: [...(groups.find(g => g._key === groupKey)?.lines ?? []), { account_code: code, account_name: name, sign: "+", _key: crypto.randomUUID() }] });
    setAddingToGroup(null); setAcSearch("");
  };
  const updateLine = (groupKey, lineKey, patch) =>
    updateGroup(groupKey, { lines: groups.find(g => g._key === groupKey)?.lines.map(l => l._key === lineKey ? { ...l, ...patch } : l) ?? [] });
  const removeLine = (groupKey, lineKey) =>
    updateGroup(groupKey, { lines: groups.find(g => g._key === groupKey)?.lines.filter(l => l._key !== lineKey) ?? [] });

  const availableFor = (groupKey) => {
    const used = new Set(groups.find(g => g._key === groupKey)?.lines.map(l => l.account_code) ?? []);
    const q = acSearch.toLowerCase();
    return allAccounts.filter(a => !used.has(a.code) && (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const cleanItems = groups.map(({ _key, lines, ...rest }, idx) => ({
      ...rest, id: rest.id ?? _key, order: idx,
     lines: (lines ?? []).map((line) => { const { _key, ...rest } = line; void _key; return rest; }),
    }));
    onSave({ name: name.trim(), description: description.trim() || null, items: cleanItems });
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-6"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(10px)" }}>
      <div className="relative bg-white rounded-3xl flex flex-col"
        style={{ width: 540, maxHeight: "90vh", boxShadow: "0 32px 80px -12px rgba(26,47,138,0.28)", animation: "hpPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)" }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
<p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400 mb-0.5">
              {structure ? t("builder_edit") : t("builder_new")} {t("builder_breakdown")}
            </p>
            <p className="text-[17px] font-black text-gray-900 leading-tight">{t("builder_title")}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">✕</button>
        </div>

        {/* ── Name + description ── */}
        <div className="grid grid-cols-2 gap-3 px-6 pb-5 flex-shrink-0 border-b border-gray-100">
          <div>
<label className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400 block mb-1.5">{t("builder_name_label")}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t("builder_name_placeholder")}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none border border-gray-200 transition-all"
              onFocus={e => e.target.style.borderColor = colors.primary + "50"}
              onBlur={e => e.target.style.borderColor = "#e5e7eb"} />
          </div>
          <div>
<label className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400 block mb-1.5">{t("builder_desc_label")}</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t("builder_desc_placeholder")}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none border border-gray-200 transition-all"
              onFocus={e => e.target.style.borderColor = colors.primary + "50"}
              onBlur={e => e.target.style.borderColor = "#e5e7eb"} />
          </div>
        </div>

        {/* ── Groups ── */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-6 py-5 space-y-3">
          {groups.map((group) => (
            <div key={group._key} className="rounded-2xl border border-gray-100 overflow-hidden bg-white"
              style={{ boxShadow: "0 2px 8px -2px rgba(26,47,138,0.06)" }}>

              {/* Coloured top stripe */}
              <div style={{ height: 3, background: group.color ?? "#1a2f8a" }} />

              {/* Group header */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Colour picker dot */}
                <label className="w-5 h-5 rounded-full cursor-pointer flex-shrink-0 ring-2 ring-white ring-offset-1"
                  style={{ background: group.color ?? "#1a2f8a", boxShadow: `0 0 0 1px ${group.color ?? "#1a2f8a"}40` }}
                  title="Change colour">
                  <input type="color" value={group.color ?? "#1a2f8a"}
                    onChange={e => updateGroup(group._key, { color: e.target.value })}
                    style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                </label>

                {/* Group name */}
<input value={group.label} onChange={e => updateGroup(group._key, { label: e.target.value })}
                  placeholder={t("builder_group_name_placeholder")}
                  className="flex-1 text-sm font-black text-gray-800 outline-none bg-transparent min-w-0" />

{/* Contribution sign — matches account line pill style */}
                <button
                  onClick={() => updateGroup(group._key, { sign: (group.sign ?? "+") === "+" ? "-" : "+" })}
                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black transition-all"
                  style={{
                    background: (group.sign ?? "+") === "+" ? "#dcfce7" : "#fee2e2",
                    color:      (group.sign ?? "+") === "+" ? "#15803d" : "#dc2626",
                  }}
                  title={(group.sign ?? "+") === "+" ? "Adds to total — click to flip" : "Subtracts from total — click to flip"}>
                  {(group.sign ?? "+") === "+" ? "+" : "−"}
                </button>

                {/* Count */}
                <span className="text-[10px] font-bold text-gray-400 flex-shrink-0">
                  {group.lines?.length ?? 0}
                </span>

                {/* Remove group */}
                <button onClick={() => removeGroup(group._key)}
                  className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 text-xs">✕</button>
              </div>

              {/* Account rows */}
              {(group.lines?.length ?? 0) > 0 && (
                <div className="border-t border-gray-50 divide-y divide-gray-50">
                  {group.lines.map(line => (
                    <div key={line._key} className="flex items-center gap-3 px-4 py-2.5 group/line">
                      {/* Line sign */}
                      <button
                        onClick={() => updateLine(group._key, line._key, { sign: line.sign === "+" ? "-" : "+" })}
                        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-black transition-all"
                        style={{
                          background: line.sign === "+" ? "#dcfce7" : "#fee2e2",
                          color:      line.sign === "+" ? "#15803d" : "#dc2626",
                        }}>
                        {line.sign}
                      </button>
                      <span className="font-mono text-[11px] font-bold text-gray-400 flex-shrink-0 w-14 truncate">
                        {line.account_code}
                      </span>
                      <span className="flex-1 text-xs text-gray-600 truncate">{line.account_name}</span>
                      <button onClick={() => removeLine(group._key, line._key)}
                        className="w-4 h-4 flex items-center justify-center text-gray-200 hover:text-red-400 opacity-0 group-hover/line:opacity-100 transition-all flex-shrink-0 text-[10px]">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Account picker / add button */}
              <div className="border-t border-gray-50 px-4 py-2.5">
                {addingToGroup === group._key ? (
                  <div>
                    <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-gray-50 border border-gray-100">
                      <Search size={11} className="text-gray-400 flex-shrink-0" />
                      <input autoFocus value={acSearch} onChange={e => setAcSearch(e.target.value)}
                        placeholder="Search by code or name…"
                        className="flex-1 text-xs text-gray-700 outline-none bg-transparent" />
                      <button onClick={() => { setAddingToGroup(null); setAcSearch(""); }}
                        className="text-gray-300 hover:text-gray-500 text-[10px]">✕</button>
                    </div>
                    <div className="mt-1 max-h-44 overflow-y-auto hide-scrollbar">
                      {availableFor(group._key).length === 0 ? (
                        <p className="text-[10px] text-gray-300 text-center py-3 font-bold">No accounts found</p>
                      ) : availableFor(group._key).map(a => (
<button key={a.code} onClick={() => addLine(group._key, a.code, a.name)}
                          className="w-full text-left flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors"
style={{ opacity: a.hasData ? 1 : 0.4 }}>
                          <span className="font-mono font-bold text-[11px] w-14 flex-shrink-0"
                            style={{ color: a.hasData ? colors.primary : "#9ca3af" }}>{a.code}</span>
                          <span className="text-xs text-gray-600 truncate flex-1">{a.name}</span>
                          <span className="text-[10px] font-mono font-bold flex-shrink-0"
                            style={{ color: a.hasData ? "#16a34a" : "#d1d5db" }}>
                            {a.hasData ? fmtBig(a.balance) : t("builder_no_data")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingToGroup(group._key); setAcSearch(""); }}
                    className="text-[11px] font-bold text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1">
                    <span className="text-sm leading-none">+</span> Add account
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Add group button */}
<button onClick={addGroup}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-gray-200 text-xs font-black text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-all">
            {t("builder_add_group")}
          </button>
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex items-center gap-2">
{onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="px-3 py-2 rounded-xl text-xs font-black"
              style={{ background: "#fee2e2", color: "#dc2626" }}>{t("builder_delete")}</button>
          )}
          {confirmDelete && (
            <>
              <button onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-600">{t("builder_cancel")}</button>
              <button onClick={onDelete}
                className="px-3 py-2 rounded-xl text-xs font-black text-white"
                style={{ background: "#dc2626" }}>{t("builder_confirm_delete")}</button>
            </>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-600">{t("builder_cancel")}</button>
          <button onClick={handleSave} disabled={!name.trim()}
            className="px-5 py-2 rounded-xl text-xs font-black text-white disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)` }}>
            {structure ? t("builder_save_changes") : t("builder_create")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════════ */
const DEFAULT_SLOTS = ["revenue", "ebitda", "ebit", "net_result"];

export default function HomePage({ token, initialData = {}, user = {} }) {
const { colors } = useSettings();
  const headerStyle = useTypo("header1");
  const t = useT();
  const { userId, companyId: settingsCompanyId } = useSettingsControls();

  // ── Company metadata from Supabase ──────────────────────────────
const [companyMeta, setCompanyMeta] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  useEffect(() => {
    if (!settingsCompanyId && !userId) return;
    (async () => {
      const [{ data: co }, { data: up }] = await Promise.all([
        settingsCompanyId
          ? supabase.schema("accounts").from("companies")
              .select("name, tier, is_trial, trial_ends_at")
              .eq("id", settingsCompanyId).single()
          : Promise.resolve({ data: null }),
        userId
          ? supabase.schema("accounts").from("users")
              .select("username, email")
              .eq("id", userId).single()
          : Promise.resolve({ data: null }),
      ]);
      if (co) setCompanyMeta(co);
      if (up) setUserProfile(up);
    })();
  }, [settingsCompanyId, userId]);

  // ── Time-based greeting ──────────────────────────────────────────
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? t("greeting_morning") : h < 18 ? t("greeting_afternoon") : t("greeting_evening");
  }, [t]);

  // ── Display name: extract first name from email or username ──────
const displayName = useMemo(() => {
    // Prefer the actual username from accounts.users (e.g. "Ignacio Vidal")
    const raw = (userProfile?.username ?? user?.username ?? "").trim();
    if (!raw) return "";
    if (raw.includes("@")) {
      const local = raw.split("@")[0];
      const first = local.split(/[._\-+]/)[0] ?? local;
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
    if (raw.includes(" ")) return raw;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [userProfile, user]);

  // ── Trial days remaining ─────────────────────────────────────────
  const trialDaysLeft = useMemo(() => {
    if (!companyMeta?.is_trial || !companyMeta?.trial_ends_at) return null;
    const days = Math.ceil((new Date(companyMeta.trial_ends_at) - new Date()) / 86400000);
    return days > 0 ? days : 0;
  }, [companyMeta]);
  const MONTHS_ABBR = [
    t("month_1"), t("month_2"), t("month_3"), t("month_4"),
    t("month_5"), t("month_6"), t("month_7"), t("month_8"),
    t("month_9"), t("month_10"), t("month_11"), t("month_12"),
  ].map(m => m.slice(0, 3));

const sources    = useMemo(() => initialData.sources    ?? [], [initialData]);
  const structures = useMemo(() => initialData.structures ?? [], [initialData]);
  const companies  = useMemo(() => initialData.companies  ?? [], [initialData]);
  const dimensions = useMemo(() => initialData.dimensions ?? [], [initialData]);
  const groupAccountsProp = useMemo(() => initialData.groupAccounts ?? [], [initialData]);

// Current user's role + resource-access whitelist for this company
const [allowedCompanyShortNames, setAllowedCompanyShortNames] = useState(null);
useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      // Resolve user's active company directly (don't rely on settings context)
      const { data: ucRow } = await supabase.schema("accounts").from("user_companies")
       .select("company_id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const cid = ucRow?.company_id;
      if (!cid) return;
const { data: rows } = await supabase
        .from("user_resource_access")
        .select("resource_id, allowed")
        .eq("company_id", cid)
        .eq("user_id", userId)
        .eq("resource_kind", "company");
      if (cancelled) return;
      // If no rows exist → null means all allowed (default)
      if (!rows || rows.length === 0) { setAllowedCompanyShortNames(null); return; }
      const allowed = new Set();
      rows.forEach(r => { if (r.allowed) allowed.add(String(r.resource_id)); });
      setAllowedCompanyShortNames(allowed);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Group structure rows (parent/child relations) — fetched lazily for the picker
  const [groupStructure, setGroupStructure] = useState(initialData.groupStructure ?? []);
  useEffect(() => {
    if (groupStructure.length > 0) return;
    if (!token) return;
    fetch(`${BASE_URL}/v2/group-structure`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const rows = d.value ?? (Array.isArray(d) ? d : []);
        setGroupStructure(rows);
      })
      .catch(() => {});
  }, [token, groupStructure.length]);

  // If parent didn't pre-load groupAccounts, fetch them ourselves
  const [groupAccountsLocal, setGroupAccountsLocal] = useState([]);
  useEffect(() => {
    if (groupAccountsProp.length > 0) return;
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
      .catch(() => {});
  }, [token, groupAccountsProp.length]);
  const groupAccounts = groupAccountsProp.length > 0 ? groupAccountsProp : groupAccountsLocal;

  // Sum-account exclusion set (same as KpiIndividualesPage)
  const sumAccountCodes = useMemo(() => {
    const sums = new Set();
    groupAccounts.forEach(g => {
      const isSum = g.IsSumAccount === true || g.isSumAccount === true;
      if (isSum) {
        const code = String(g.AccountCode ?? g.accountCode ?? "");
        if (code) sums.add(code);
      }
    });
    return sums;
  }, [groupAccounts]);

  // Resolver — same hook as KpiIndividualesPage
const {
    kpiList: kpiListSystem, ccTagToCodes, sectionCodes, standard: detectedStandard,
    ready: resolverReady,
  } = useResolvedKpiList(groupAccounts, settingsCompanyId, initialData?.activeStandardKey);

  // viewScope must be declared before any effect that reads it.
const [viewScope, setViewScope] = useState("consolidated"); // "consolidated" | "individual"
  const [valueMode, setValueMode] = useState("monthly"); // "monthly" | "ytd"
  // Saved company from preferences, applied once holdings/companies resolve.
  const [savedCompany, setSavedCompany] = useState(null);
  const [savedCompanyApplied, setSavedCompanyApplied] = useState(false);

const [companyKpis, setCompanyKpis] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const jwt = session?.access_token ?? SUPABASE_APIKEY;

        // Resolve companyId the same way KpiIndividualesPage does
        const { getActiveCompanyId } = await import("../../lib/mappingsApi");
        const companyId = await getActiveCompanyId(uid);
        if (!companyId) return;

        // Scope-aware fetch: individual view → individual+shared,
        // consolidated view → consolidated+shared.
        const scopeFilter = viewScope === "consolidated"
          ? "scope=in.(consolidated,shared)"
          : "scope=in.(individual,shared)";

        const res = await fetch(
          `${SUPABASE_URL}/company_kpis?company_id=eq.${companyId}&is_archived=eq.false&kpi_type=eq.custom&${scopeFilter}&select=*`,
          { headers: { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${jwt}` } }
        );
        const rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) { setCompanyKpis([]); return; }
        setCompanyKpis(rows.map(d => {
          let formula = d.formula;
          if (typeof formula === "string") { try { formula = JSON.parse(formula); } catch { formula = null; } }
          return {
            id:          d.kpi_id ?? d.id,
            label:       d.label,
            description: d.description ?? "",
            category:    "Custom",
            format:      d.format ?? "currency",
            tag:         d.tag ?? "",
            benchmark:   null,
            formula,
            isCustom:    true,
          };
        }).filter(k => k.id && k.label));
      } catch { /* non-critical */ }
    })();
  }, [userId, viewScope]);

  // Merge — shadow kpiList so every existing reference picks up custom KPIs
  const kpiList = useMemo(() => {
    const ids = new Set(kpiListSystem.map(k => k.id));
    return [...kpiListSystem, ...companyKpis.filter(k => !ids.has(k.id))];
  }, [kpiListSystem, companyKpis]);

const { setDetectedLocale } = useSettingsControls();

// ── KPI slot configuration ───────────────────────────────────────
  // Keep BOTH scope slot lists in state so switching is instant and each
  // scope remembers its own last selection independently.
  const [slotsIndividual,   setSlotsIndividual]   = useState(DEFAULT_SLOTS);
  const [slotsConsolidated, setSlotsConsolidated] = useState(DEFAULT_SLOTS);
  const kpiSlots    = viewScope === "consolidated" ? slotsConsolidated : slotsIndividual;
  const setKpiSlots = viewScope === "consolidated" ? setSlotsConsolidated : setSlotsIndividual;
 const [editingSlot, setEditingSlot]     = useState(null);   // 0-3 | null
  const [trendWindow, setTrendWindow]     = useState(24);      // 12 | 24 | 36 | 48 months
  const [trendHidden]                     = useState(() => new Set()); // series ocultas en la evolución
  const [trendFocus, setTrendFocus]       = useState(null);    // serie resaltada al pasar el ratón
  const [bdHover, setBdHover]             = useState(null);    // segmento del desglose señalado
  // true cuando se han leído las preferencias guardadas (ventana, intervalo,
  // modo, ámbito, KPIs). Antes el histórico se pedía y se pintaba con los
  // valores por defecto y, al llegar las preferencias, se volvía a pedir y a
  // dibujar con otros: por eso la gráfica salía distinta cada vez.
  const [prefsReady, setPrefsReady]       = useState(false);
  // Si las preferencias no llegan (sin usuario, sin red), no bloquear: tras
  // unos segundos se sigue con los valores por defecto.
  useEffect(() => {
    const id = setTimeout(() => setPrefsReady(true), 4000);
    return () => clearTimeout(id);
  }, []);
  const [trendInterval, setTrendInterval] = useState("monthly"); // monthly | 6months | yearly
  const [trendChipOpen, setTrendChipOpen] = useState(null);   // "interval" | "window" | null
  const trendHeaderRef = useRef(null);

  // Close chip dropdowns on outside click
  useEffect(() => {
    if (!trendChipOpen) return;
    const handler = (e) => {
      if (trendHeaderRef.current && !trendHeaderRef.current.contains(e.target))
        setTrendChipOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [trendChipOpen]);

// Load saved slots from user_settings.preferences (per scope).
  // Back-compat: if the legacy `home_kpi_slots` key exists, seed BOTH
  // scopes from it, then rely on scope-specific keys going forward.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      let prefs = {};
      try {
        const { data } = await supabase
          .from("user_settings")
          .select("preferences")
          .eq("user_id", userId)
          .single();
        prefs = data?.preferences ?? {};
      } catch { /* sin preferencias: valores por defecto */ }
      const legacy = Array.isArray(prefs.home_kpi_slots) && prefs.home_kpi_slots.length === 4
        ? prefs.home_kpi_slots : null;
      const ind = Array.isArray(prefs.home_kpi_slots_individual)   && prefs.home_kpi_slots_individual.length   === 4
        ? prefs.home_kpi_slots_individual   : (legacy ?? DEFAULT_SLOTS);
const con = Array.isArray(prefs.home_kpi_slots_consolidated) && prefs.home_kpi_slots_consolidated.length === 4
        ? prefs.home_kpi_slots_consolidated : (legacy ?? DEFAULT_SLOTS);
      setSlotsIndividual(ind);
      setSlotsConsolidated(con);

      // Restore Home view filters (scope / value mode / company / trend).
      // Period (year/month/compare) is intentionally NOT restored — it always
      // auto-picks the latest month with data and its comparison.
      if (prefs.home_view_scope === "consolidated" || prefs.home_view_scope === "individual") {
        setViewScope(prefs.home_view_scope);
      }
      if (prefs.home_value_mode === "monthly" || prefs.home_value_mode === "ytd") {
        setValueMode(prefs.home_value_mode);
      }
      if ([12, 24, 36, 48].includes(prefs.home_trend_window)) {
        setTrendWindow(prefs.home_trend_window);
      }
      if (["monthly", "6months", "yearly"].includes(prefs.home_trend_interval)) {
        setTrendInterval(prefs.home_trend_interval);
      }
      // Company is a single saved value; apply it to whichever scope is active
      // once holdings/companies have resolved (handled by a dedicated effect).
if (typeof prefs.home_company === "string" && prefs.home_company) {
        setSavedCompany(prefs.home_company);
      }
      // A partir de aquí la ventana, el intervalo, el modo y los KPIs del
      // histórico son los definitivos (ver prefsReady).
      setPrefsReady(true);
    })();
  }, [userId]);  // DEFAULT_SLOTS is a module-level constant (stable), not needed here
const saveKpiSlots = useCallback(async (slots, scope) => {
    if (!userId) return;
    const { data } = await supabase
      .from("user_settings")
      .select("preferences")
      .eq("user_id", userId)
      .single();
    const current = data?.preferences ?? {};
    const key = scope === "consolidated" ? "home_kpi_slots_consolidated" : "home_kpi_slots_individual";
await supabase.from("user_settings").upsert({
      user_id: userId,
      preferences: { ...current, [key]: slots },
      updated_at: new Date().toISOString(),
    });
  }, [userId]);

  // Generic per-user preference writer: merges a single key into
  // user_settings.preferences. Used for the Home view filters (scope, value
  // mode, company, trend window/interval) so they survive re-login.
  const savePref = useCallback(async (key, value) => {
    if (!userId) return;
    try {
      const { data } = await supabase
        .from("user_settings")
        .select("preferences")
        .eq("user_id", userId)
        .single();
      const current = data?.preferences ?? {};
      await supabase.from("user_settings").upsert({
        user_id: userId,
        preferences: { ...current, [key]: value },
        updated_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }
  }, [userId]);

  const updateSlot = useCallback((slotIdx, kpiId) => {
    const next = [...kpiSlots];
    next[slotIdx] = kpiId;
    setKpiSlots(next);
    saveKpiSlots(next, viewScope);
    setEditingSlot(null);
  }, [kpiSlots, setKpiSlots, saveKpiSlots, viewScope]);

// When scope changes, any slot ID that isn't present in the (new)
  // kpiList — because it was a custom KPI scoped to the other view —
  // falls back to a default so cards never render empty.
// Cards must never render empty. If a saved slot id isn't in the CURRENT
  // kpiList we substitute a default FOR DISPLAY ONLY — we never persist that
  // substitution, because the id may simply not have loaded yet (custom KPIs
  // arrive after the base list). Persisting here previously clobbered the
  // user's real selection with defaults on every reload.
  const displaySlots = useMemo(() => {
    if (!resolverReady || kpiList.length === 0) return kpiSlots;
    const validIds = new Set(kpiList.map(k => k.id));
    return kpiSlots.map((id, i) => (validIds.has(id) ? id : (DEFAULT_SLOTS[i] ?? DEFAULT_SLOTS[0])));
  }, [kpiSlots, kpiList, resolverReady]);

  // Visual config per slot (colours stay fixed, icons stay fixed)
  const SLOT_COLORS = useMemo(() => [
    { color: colors.primary ?? "#1a2f8a",    accent: `${colors.primary ?? "#1a2f8a"}cc`,    icon: DollarSign },
    { color: colors.secondary ?? "#CF305D",  accent: `${colors.secondary ?? "#CF305D"}cc`,  icon: Activity   },
    { color: colors.tertiary ?? "#57aa78",   accent: `${colors.tertiary ?? "#57aa78"}cc`,   icon: Target     },
    { color: NI_COLOR,                        accent: NI_ACCENT,                              icon: TrendingUp },
  ], [colors]);

  // Drive interface language from the detected accounting standard.
  // Only fires when standard is freshly detected and user hasn't set an
  // explicit locale preference.
  useEffect(() => {
    if (!detectedStandard) return;
    const locale =
      detectedStandard === "DanishIFRS"    ? "da" :
      detectedStandard === "PGC"           ? "es" : "en";
    setDetectedLocale(locale);
  }, [detectedStandard, setDetectedLocale]);

// ── Standard mapping ────────────────────────────────────────
  const [standardMappingData, setStandardMappingData] = useState(null);
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { data } = await supabase.from("user_settings").select("preferences").eq("user_id", userId).single();
        const mid = data?.preferences?.standard_mapping_id;
        if (!mid) return;
        const res = await fetch(`${SUPABASE_URL}/mappings?mapping_id=eq.${mid}&select=*&limit=1`, { headers: sbHeaders() });
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0]) setStandardMappingData(rows[0]);
      } catch { /* non-critical */ }
    })();
  }, [userId]);

  // ── Unmapped accounts detection ─────────────────────────────
  const [unmappedAccounts, setUnmappedAccounts]       = useState(null);
  const [unmappedDismissed, setUnmappedDismissed]     = useState(false);
  const [mappingsModalOpen, setMappingsModalOpen]     = useState(false);
  const unmappedCheckDoneRef                          = useRef(false);

useEffect(() => {
    if (!detectedStandard || !groupAccounts.length || !userId) return;
    // Wait for the company id before running — resolveStandardKey needs it to
    // find the custom binding (e.g. CUSTOM-genesal). Running early would sniff a
    // generic standard and, because the check only runs once, never recover.
    if (!settingsCompanyId) return;
    if (unmappedCheckDoneRef.current) return;
    unmappedCheckDoneRef.current = true;

    (async () => {
      try {
        // If a standard mapping is already set, the user has handled their
        // account organisation — no need to show the unmapped warning
        const { data: settingsData } = await supabase
          .from("user_settings")
          .select("preferences")
          .eq("user_id", userId)
          .single();
        if (settingsData?.preferences?.standard_mapping_id) return;

        // Resolve the standard the COMPANY is actually bound to. For custom
        // clients this is e.g. "CUSTOM-genesal" — their real chart lives in
        // standard_statement_rows under that key, NOT in generic template_rows.
        // Comparing against template_rows was the bug: every custom account
        // (…P, group accounts, distribution rows) looked "unmapped".
        const standardKey = await resolveStandardKey(settingsCompanyId, groupAccounts, null);
        if (!standardKey) return;

        const H = sbHeaders();
        const [plRes, bsRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/standard_statement_rows?select=account_code&standard_key=eq.${encodeURIComponent(standardKey)}&statement=eq.PL`, { headers: H }),
          fetch(`${SUPABASE_URL}/standard_statement_rows?select=account_code&standard_key=eq.${encodeURIComponent(standardKey)}&statement=eq.BS`, { headers: H }),
        ]);
        const [plRows, bsRows] = await Promise.all([plRes.json(), bsRes.json()]);

        const plCodes = new Set((Array.isArray(plRows) ? plRows : []).map(r => String(r.account_code ?? "")).filter(Boolean));
        const bsCodes = new Set((Array.isArray(bsRows) ? bsRows : []).map(r => String(r.account_code ?? "")).filter(Boolean));

        if (!plCodes.size && !bsCodes.size) return;

        const unmapped = [];
        groupAccounts.forEach(ga => {
          const code    = String(ga.AccountCode  ?? ga.accountCode  ?? "");
          const name    = String(ga.AccountName  ?? ga.accountName  ?? "");
          const isSum   = !!(ga.IsSumAccount ?? ga.isSumAccount);
          const acctType = String(ga.AccountType ?? ga.accountType ?? "");
          if (!code || isSum) return;

          // Mirror the mapper: compare each account against its own statement's template
          const isPL = acctType === "P/L" || acctType === "DIS";
          const isBS = acctType === "B/S";

          if (isPL && plCodes.size > 0 && !plCodes.has(code)) unmapped.push({ code, name });
          else if (isBS && bsCodes.size > 0 && !bsCodes.has(code)) unmapped.push({ code, name });
        });

        if (unmapped.length > 0) setUnmappedAccounts(unmapped);
      } catch { /* non-critical */ }
    })();
}, [detectedStandard, groupAccounts, userId, settingsCompanyId]);

  // Cost breakdown rows from PL table — fetched independently to avoid
  // touching the resolver. Same standard detection.

  const prefetch = useMemo(() => {
    const raw = initialData.__homePrefetch ?? null;
    if (!raw) return null;
    const period = extractPeriod(raw) ?? extractPeriod(raw.latestPeriod);
    if (!period) return null;
return {
      year:             period.year,
      month:            period.month,
      current:          raw.current          ?? raw.currentRows    ?? [],
      prev:             raw.prev             ?? raw.prevRows       ?? [],
      trend:            raw.trend            ?? raw.trendRows      ?? [],
      allCoCurrentRows: raw.allCoCurrentRows ?? [],
    };
  }, [initialData]);

const [year, setYear]     = useState(prefetch?.year  ? String(prefetch.year)  : "");
  const [month, setMonth]   = useState(prefetch?.month ? String(prefetch.month) : "");
const [pickerOpen, setPickerOpen]         = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

const source = useMemo(() => {
    const s = sources[0];
    return typeof s === "object" ? (s.source ?? s.Source ?? "") : (s ?? "");
  }, [sources]);
  const defaultStructure = useMemo(() => {
    const s = structures[0];
    return typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : (s ?? "");
  }, [structures]);
// Default companies — computed once per scope; the active one is picked
  // further down once viewScope is in scope.
// Filter companies by access whitelist (admin/null = pass-through)
  const visibleCompanies = useMemo(() => {
    if (!allowedCompanyShortNames) return companies;
    return companies.filter(c => {
      const sn = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c);
      return allowedCompanyShortNames.has(sn);
    });
  }, [companies, allowedCompanyShortNames]);

  const defaultIndividualCompany = useMemo(() => {
    const c = visibleCompanies[0];
    return typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : (c ?? "");
  }, [visibleCompanies]);

const [structureOverride] = useState(null);
  // Two independent overrides — one per scope. Switching scope clears the other.
const [consolidatedCompanyOverride, setConsolidatedCompanyOverride] = useState(null);
const [individualCompanyOverride,   setIndividualCompanyOverride]   = useState(null);
  const structure = structureOverride ?? defaultStructure;

  // Holdings: companies that act as parent (have children) plus the root.
  // Source: /v2/group-structure, filtered by current structure, non-detached.
  const holdings = useMemo(() => {
    const gsRows = groupStructure
      .map(g => ({
        company:   g.companyShortName ?? g.CompanyShortName ?? "",
        parent:    g.parentShortName  ?? g.ParentShortName  ?? "",
        structure: g.groupStructure   ?? g.GroupStructure   ?? "",
        hasChild:  g.hasChild         ?? g.HasChild         ?? false,
        detached:  g.detached         ?? g.Detached         ?? false,
      }))
      .filter(g => !g.detached && (!g.structure || g.structure === structure));
    const root = gsRows.find(g => !g.parent)?.company || "";
    const shortNames = gsRows
      .filter(g => g.hasChild || g.company === root)
      .map(g => g.company);
return shortNames
      .filter(sn => !allowedCompanyShortNames || allowedCompanyShortNames.has(sn))
      .map(sn => {
        const co = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === sn);
        return {
          shortName: sn,
          legalName: co?.CompanyLegalName ?? co?.companyLegalName ?? sn,
          isRoot:    sn === root,
        };
      })
.sort((a, b) => a.legalName.localeCompare(b.legalName, "es", { sensitivity: "base" }));
  }, [groupStructure, structure, companies, allowedCompanyShortNames]);

  // Default company per scope
  const defaultConsolidatedCompany = useMemo(() => {
    const root = holdings.find(h => h.isRoot);
    if (root) return root.shortName;
    if (holdings.length > 0) return holdings[0].shortName;
    return defaultIndividualCompany;
  }, [holdings, defaultIndividualCompany]);

// Active company = override-for-scope ?? default-for-scope
  const company = viewScope === "consolidated"
    ? (consolidatedCompanyOverride ?? defaultConsolidatedCompany)
    : (individualCompanyOverride   ?? defaultIndividualCompany);

  // Apply the saved company (single value) to the active scope's override,
  // once — after companies/holdings have resolved so we can validate it.
  useEffect(() => {
    if (savedCompanyApplied || !savedCompany) return;
    const holdingNames = new Set(holdings.map(h => h.shortName));
    const companyNames = new Set(visibleCompanies.map(c =>
      typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)
    ));
    // Wait until the relevant list for the active scope has loaded.
    const pool = viewScope === "consolidated" ? holdingNames : companyNames;
if (pool.size === 0) return;
    // Defer the state writes to a microtask so we don't setState synchronously
    // in the effect body (avoids the cascading-render lint + the runtime cost).
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (pool.has(savedCompany)) {
        if (viewScope === "consolidated") setConsolidatedCompanyOverride(savedCompany);
        else                              setIndividualCompanyOverride(savedCompany);
      }
      setSavedCompanyApplied(true);
    });
    return () => { cancelled = true; };
  }, [savedCompany, savedCompanyApplied, viewScope, holdings, visibleCompanies]);

  // ── Persist Home view filters whenever they change ──────────────────
  // A "loaded" gate prevents writing during the initial restore pass (which
  // would clobber saved prefs with defaults before they're read).
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    if (!userId) return;
    // mark loaded on the first run after userId is known + a tick
    const id = setTimeout(() => { prefsLoadedRef.current = true; }, 0);
    return () => clearTimeout(id);
  }, [userId]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    savePref("home_view_scope", viewScope);
  }, [viewScope, savePref]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    savePref("home_value_mode", valueMode);
  }, [valueMode, savePref]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    savePref("home_trend_window", trendWindow);
  }, [trendWindow, savePref]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    savePref("home_trend_interval", trendInterval);
  }, [trendInterval, savePref]);

  // Company: single saved value. Only persist once the saved company has been
  // applied (or there was none), so we don't overwrite it with the default.
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    if (savedCompany && !savedCompanyApplied) return;
    if (!company) return;
    savePref("home_company", company);
  }, [company, savedCompany, savedCompanyApplied, savePref]);

  const [compareYear, setCompareYear]   = useState("");
  const [compareMonth, setCompareMonth] = useState("");
  const [compareTouched, setCompareTouched] = useState(false);
  useEffect(() => {
    if (compareTouched) return;
    if (!year || !month) return;
    const y = Number(year), m = Number(month);
let pm = m - 1, py = y;
    if (pm < 1) { pm = 12; py -= 1; }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setCompareYear(String(py));
      setCompareMonth(String(pm));
    });
    return () => { cancelled = true; };
  }, [year, month, compareTouched]);
  const compareLabel = useMemo(() => {
    if (!compareYear || !compareMonth) return "—";
    const mNum = Number(compareMonth);
    if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) return "—";
    return `${MONTHS_ABBR[mNum - 1]} ${compareYear}`;
  }, [compareYear, compareMonth, MONTHS_ABBR]);

  const [currentRows, setCurrentRows]     = useState(prefetch?.current ?? []);
  const [prevRows, setPrevRows]           = useState(prefetch?.prev ?? []);
  const [trendRows, setTrendRows]         = useState([]);
const [allCoCurrentRows, setAllCoCurrentRows] = useState(prefetch?.allCoCurrentRows ?? []);
  const [loading, setLoading]             = useState(false);
  const [trendLoading, setTrendLoading]   = useState(false);
  // Progreso del histórico (meses cargados / total) para el cargador de la gráfica
  const [trendProgress, setTrendProgress] = useState({ done: 0, total: 0 });
  const [allCoLoading, setAllCoLoading]   = useState(false);
  // Hitos de la carga inicial: solo pueden pasar de "no" a "sí", así la barra
  // de la pantalla de carga nunca retrocede (antes contaba "no está cargando"
  // como hecho y arrancaba en 55 % para luego bajar).
  const [bootMarks, setBootMarks] = useState(() => ({
    period: false,
    resolver: false,
    current: !!prefetch?.current?.length,
    allCo: !!prefetch?.allCoCurrentRows?.length,
  }));
  const [probing, setProbing]             = useState(false);


const trendCacheRef = useRef(new Map());
  const allCoCacheRef = useRef(new Map());

  // Seed in-component caches from the EpicLoader prefetch so the trend and
  // all-companies effects find their keys on first run and skip the re-fetch.
  // Mutating a ref during render is safe here — it is idempotent and has no
  // visible effect on other components.

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  }), [token]);

  const fetchPeriod = useCallback(async (y, m, src, str, co) => {
    const yNum = Number(y), mNum = Number(m);
    if (!Number.isFinite(yNum) || !Number.isFinite(mNum) || yNum < 1900 || mNum < 1 || mNum > 12) return [];
    if (!src || !str || !co) return [];
    const filter = `Year eq ${yNum} and Month eq ${mNum} and Source eq '${src}' and GroupStructure eq '${str}' and CompanyShortName eq '${co}'`;
    try {
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: headers() }
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.value ?? (Array.isArray(json) ? json : []);
    } catch { return []; }
  }, [headers]);

  // Para el histórico: igual que fetchPeriod pero SIN tragarse los errores.
  // Reintenta (hasta 3 intentos con espera creciente) y, si aun así falla,
  // devuelve null. Antes un fallo puntual (límite de peticiones, red) se
  // trataba como "mes sin datos" y dibujaba un cero distinto en cada visita.
  const fetchPeriodStrict = useCallback(async (y, m, src, str, co) => {
    const yNum = Number(y), mNum = Number(m);
    if (!Number.isFinite(yNum) || !Number.isFinite(mNum) || yNum < 1900 || mNum < 1 || mNum > 12) return [];
    if (!src || !str || !co) return [];
    const filter = `Year eq ${yNum} and Month eq ${mNum} and Source eq '${src}' and GroupStructure eq '${str}' and CompanyShortName eq '${co}'`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch(
          `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
          { headers: headers(), signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          return json.value ?? (Array.isArray(json) ? json : []);
        }
        if (res.status === 401 || res.status === 403) return null;
      } catch { /* reintento */ }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    return null;
  }, [headers]);

  const fetchPeriodAllCompanies = useCallback(async (y, m, src, str) => {
    const yNum = Number(y), mNum = Number(m);
    if (!Number.isFinite(yNum) || !Number.isFinite(mNum) || yNum < 1900 || mNum < 1 || mNum > 12) return [];
    if (!src || !str) return [];
    const filter = `Year eq ${yNum} and Month eq ${mNum} and Source eq '${src}' and GroupStructure eq '${str}'`;
    try {
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: headers() }
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.value ?? (Array.isArray(json) ? json : []);
    } catch { return []; }
  }, [headers]);


  // Probe latest period
  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current) return;
    if (year && month) return;
    if (!source || !structure || !company || !token) return;
    probedRef.current = true;

const cacheKey = `home_latest_period_${source}_${structure}_${company}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const p = extractPeriod(JSON.parse(cached));
        if (p) {
          let cancelled = false;
          Promise.resolve().then(() => {
            if (cancelled) return;
            setYear(String(p.year));
            setMonth(String(p.month));
          });
          // Si el efecto se re-ejecuta antes de aplicar el periodo (p. ej. la
          // empresa por defecto cambia al cargar la estructura), volver a probar.
          return () => { cancelled = true; probedRef.current = false; };
        }
        sessionStorage.removeItem(cacheKey);
      } catch { sessionStorage.removeItem(cacheKey); }
    }

let cancelled = false;
    (async () => {
      setProbing(true);
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      const candidates = [];
      for (let i = 0; i < 24; i++) { candidates.push({ y, m }); m -= 1; if (m < 1) { m = 12; y -= 1; } }
      for (let i = 0; i < candidates.length; i += 6) {
        const batch = candidates.slice(i, i + 6);
        const probes = await Promise.all(batch.map(async ({ y, m }) => {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
          try {
            const res = await fetch(
              `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
              { headers: headers() }
            );
            if (!res.ok) return null;
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            return rows.length > 0 ? { y, m } : null;
          } catch { return null; }
        }));
const found = probes.find(Boolean);
        if (found) {
          if (!cancelled) { setYear(String(found.y)); setMonth(String(found.m)); }
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ year: found.y, month: found.m })); } catch { /* storage unavailable */ }
          if (!cancelled) setProbing(false);
          return;
        }
      }
      if (!cancelled) setProbing(false);
    })();
    // Si se cancela a medias (la empresa por defecto cambia al llegar la
    // estructura del grupo, o StrictMode monta dos veces), permitir que la
    // siguiente ejecución vuelva a buscar el periodo; si no, se quedaba sin
    // año/mes y la Home aparecía vacía tras el login.
    return () => {
      cancelled = true;
      probedRef.current = false;
      setProbing(false);
    };
  }, [source, structure, company, token, year, month, headers]);

// Fetch current (anchor period)
  const initialFetchSkippedRef = useRef(!!(prefetch?.current?.length));
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
if (initialFetchSkippedRef.current) { initialFetchSkippedRef.current = false; return; }
    let cancelled = false;
    setLoading(true);
    // Clear stale rows from the previous period so an empty new period doesn't
    // keep showing the old month's data in the KPIs and breakdown.
    setCurrentRows([]);
    (async () => {
      const cur = await fetchPeriod(year, month, source, structure, company);
      if (cancelled) return;
      setCurrentRows(cur);
      setLoading(false);
      setBootMarks(m => (m.current ? m : { ...m, current: true }));
    })();
    return () => { cancelled = true; };
  }, [year, month, source, structure, company, fetchPeriod]);

// Fetch compare period (drives KPI deltas + cost-structure deltas).
  // Skip the first run if EpicLoader already prefetched prevRows — the
  // compareYear/compareMonth auto-setter fires immediately and would otherwise
  // trigger a redundant fetch for data we already have.
  const initialCompareFetchSkippedRef = useRef(!!(prefetch?.prev?.length));
  useEffect(() => {
    if (!compareYear || !compareMonth || !source || !structure || !company) return;
    if (initialCompareFetchSkippedRef.current) { initialCompareFetchSkippedRef.current = false; return; }
    let cancelled = false;
    (async () => {
      const cmp = await fetchPeriod(compareYear, compareMonth, source, structure, company);
      if (cancelled) return;
      setPrevRows(cmp);
    })();
    return () => { cancelled = true; };
  }, [compareYear, compareMonth, source, structure, company, fetchPeriod]);

// Fetch trend — extend the rolling 24-month window backwards so the chart
  // always starts on a January (option B). The window covers from January of
  // (anchorYear − 1) up to anchorYear/anchorMonth inclusive, plus one prior
  // month (December of anchorYear−2) for the monthly delta of the first
  // visible point. Each item is { year, month, rows }.
  useEffect(() => {
    if (!prefsReady || !year || !month || !source || !structure || !company) return;
    const cacheKey = `${source}|${structure}|${company}|${year}|${month}|${trendWindow}|jan-anchored`;
    const cached = trendCacheRef.current.get(cacheKey);
    if (cached) { setTrendRows(cached); return; }

    let cancelled = false;
    setTrendLoading(true);
    (async () => {
const anchorY = Number(year), anchorM = Number(month);
      // Visible range: from January of (anchorY − yearsBack) to anchor month inclusive.
      const yearsBack = Math.ceil(trendWindow / 12);
      const startY = anchorY - yearsBack, startM = 1;
      // Prior month for delta computation: December of (startY − 1).
      const priorY = startY - 1, priorM = 12;

      const months = [{ y: priorY, m: priorM }];
      let y = startY, m = startM;
      while (y < anchorY || (y === anchorY && m <= anchorM)) {
        months.push({ y, m });
        m++; if (m > 12) { m = 1; y++; }
      }

      // Se piden todos los meses y la gráfica se actualiza UNA vez, al final.
      // Antes se iba repintando por tandas de 8 meses (series a medias que
      // cambiaban de forma mientras cargaba).
      const results = [];
      setTrendProgress({ done: 0, total: months.length });
      for (let i = 0; i < months.length; i += 6) {
        const batch = months.slice(i, i + 6);
        const batchResults = await Promise.all(
          batch.map(({ y, m }) => fetchPeriodStrict(y, String(m), source, structure, company)
            .then(rows => {
              // cada mes que llega avanza el cargador de la gráfica
              if (!cancelled) setTrendProgress(p => ({ ...p, done: Math.min(p.total, p.done + 1) }));
              return { year: y, month: m, rows: rows ?? [], failed: rows === null };
            }))
        );
        if (cancelled) return;
        results.push(...batchResults);
      }
      if (cancelled) return;
      // Solo se guarda en caché si no falló ningún mes (si no, se reintenta
      // la próxima vez en lugar de dejar el hueco fijado).
      if (!results.some(r => r.failed)) trendCacheRef.current.set(cacheKey, results);
      setTrendRows(results);
      setTrendLoading(false);
    })();
    return () => { cancelled = true; };
}, [prefsReady, year, month, source, structure, company, fetchPeriodStrict, trendWindow]);

// Fetch all-companies YTD for ranking (current)
  useEffect(() => {
    if (!year || !month || !source || !structure) return;
    const cacheKey = `${source}|${structure}|${year}|${month}|ytd-allco`;
    const cached = allCoCacheRef.current.get(cacheKey);
    if (cached) {
      setAllCoCurrentRows(cached);
      setBootMarks(m => (m.allCo ? m : { ...m, allCo: true }));
      return;
    }
    let cancelled = false;
    setAllCoLoading(true);
    (async () => {
      const rows = await fetchPeriodAllCompanies(year, month, source, structure);
      if (cancelled) return;
      allCoCacheRef.current.set(cacheKey, rows);
      setAllCoCurrentRows(rows);
      setAllCoLoading(false);
      setBootMarks(m => (m.allCo ? m : { ...m, allCo: true }));
    })();
  }, [year, month, source, structure, fetchPeriodAllCompanies]);


// Resolve the 4 configured slot KPIs from the library
const slottedKpis = useMemo(() => {
    if (!resolverReady || kpiList.length === 0) return null;
    return displaySlots.map(id => kpiList.find(k => k.id === id) ?? null);
  }, [kpiList, resolverReady, displaySlots]);

  // Keep heroKpis for backwards compat (trend needs the net_result id)
  const heroKpis = useMemo(() => {
    if (!slottedKpis) return null;
    return { netResult: slottedKpis[3] };
  }, [slottedKpis]);

// Pivots — exact same buildPivot pattern as KpiIndividualesPage.
  // YTD pivots first (raw fetch results), then monthly = curr YTD − prev YTD per account.
  const currentYtdPivot = useMemo(
    () => buildPivotFromRows(currentRows, sumAccountCodes),
    [currentRows, sumAccountCodes]
  );
  const prevYtdPivot = useMemo(
    () => buildPivotFromRows(prevRows, sumAccountCodes),
    [prevRows, sumAccountCodes]
  );

// Dedicated fetch for the month-before-anchor
  // which races against the 24-month window load. This is the same approach
  // the ranking uses, so hero === ranking always.
  const [monthBeforeAnchorRows, setMonthBeforeAnchorRows] = useState([]);
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
const m = Number(month);
    if (m === 1 || valueMode === "ytd") {
      let cancelledEarly = false;
      Promise.resolve().then(() => { if (!cancelledEarly) setMonthBeforeAnchorRows([]); });
      return () => { cancelledEarly = true; };
    }
    const beforeM = m - 1;
    const beforeY = Number(year);
    let cancelled = false;
    (async () => {
      const rows = await fetchPeriod(beforeY, String(beforeM), source, structure, company);
      if (!cancelled) setMonthBeforeAnchorRows(rows);
    })();
    return () => { cancelled = true; };
  }, [year, month, source, structure, company, valueMode, fetchPeriod]);

  // Pivot for the CURRENT anchor period. In YTD mode = raw YTD pivot. In
  // monthly mode = YTD(current) − YTD(month-1). For Jan, monthly = YTD.
const currentMonthlyPivot = useMemo(() => {
    if (valueMode === "ytd") return currentYtdPivot;
    // If the anchor period reported NO rows, it has no data — return an empty
    // pivot instead of computing (0 − previousYTD), which would surface the
    // prior month's figures as phantom negatives. "Not reported" ≠ "zero".
    if (currentRows.length === 0) {
      const empty = new Map();
      empty.__dimPivot = new Map();
      empty.__sumPivot = new Map();
      return empty;
    }
    const m = parseInt(month);
    if (m === 1) return currentYtdPivot;
    const diffWith = (beforeYtd) => {
      const out = new Map();
      const allCodes = new Set([...currentYtdPivot.keys(), ...beforeYtd.keys()]);
      allCodes.forEach(ac => {
        out.set(ac, (currentYtdPivot.get(ac) ?? 0) - (beforeYtd.get(ac) ?? 0));
      });
      const mdp = new Map();
      const cDP = currentYtdPivot.__dimPivot ?? new Map();
      const pDP = beforeYtd.__dimPivot ?? new Map();
      new Set([...cDP.keys(), ...pDP.keys()]).forEach(k => {
        mdp.set(k, (cDP.get(k) ?? 0) - (pDP.get(k) ?? 0));
      });
      out.__dimPivot = mdp;
      const msp = new Map();
      const cSP = currentYtdPivot.__sumPivot ?? new Map();
      const pSP = beforeYtd.__sumPivot ?? new Map();
      new Set([...cSP.keys(), ...pSP.keys()]).forEach(k => {
        msp.set(k, (cSP.get(k) ?? 0) - (pSP.get(k) ?? 0));
      });
      out.__sumPivot = msp;
      return out;
    };
    if (!monthBeforeAnchorRows.length) {
      const beforeM = m - 1;
      const beforeY = Number(year);
      const found = trendRows.find(t => Number(t.year) === beforeY && Number(t.month) === beforeM);
      if (!found) return currentYtdPivot;
      return diffWith(buildPivotFromRows(found.rows, sumAccountCodes));
    }
return diffWith(buildPivotFromRows(monthBeforeAnchorRows, sumAccountCodes));
  }, [currentYtdPivot, currentRows, year, month, trendRows, monthBeforeAnchorRows, sumAccountCodes, valueMode]);

// Pivot for the COMPARE period. In YTD mode = raw YTD. In monthly mode =
  // YTD(compare) − YTD(month-before-compare).
const prevMonthlyPivot = useMemo(() => {
    if (valueMode === "ytd") return prevYtdPivot;
    const cmpM = Number(compareMonth);
    const cmpY = Number(compareYear);
    if (!Number.isFinite(cmpM) || cmpM < 1 || cmpM > 12) return prevYtdPivot;
    if (cmpM === 1) return prevYtdPivot;
    const beforeM = cmpM - 1;
    const beforeY = cmpY;
    const found = trendRows.find(t => Number(t.year) === beforeY && Number(t.month) === beforeM);
    if (!found) return prevYtdPivot;
    const beforeYtd = buildPivotFromRows(found.rows, sumAccountCodes);
    const out = new Map();
    const allCodes = new Set([...prevYtdPivot.keys(), ...beforeYtd.keys()]);
    allCodes.forEach(ac => {
      out.set(ac, (prevYtdPivot.get(ac) ?? 0) - (beforeYtd.get(ac) ?? 0));
    });
    const mdp = new Map();
    const cDP = prevYtdPivot.__dimPivot ?? new Map();
    const pDP = beforeYtd.__dimPivot ?? new Map();
    new Set([...cDP.keys(), ...pDP.keys()]).forEach(k => {
      mdp.set(k, (cDP.get(k) ?? 0) - (pDP.get(k) ?? 0));
    });
    out.__dimPivot = mdp;
    const msp = new Map();
    const cSP = prevYtdPivot.__sumPivot ?? new Map();
    const pSP = beforeYtd.__sumPivot ?? new Map();
    new Set([...cSP.keys(), ...pSP.keys()]).forEach(k => {
      msp.set(k, (cSP.get(k) ?? 0) - (pSP.get(k) ?? 0));
    });
    out.__sumPivot = msp;
    return out;
  }, [prevYtdPivot, compareYear, compareMonth, trendRows, sumAccountCodes, valueMode]);

// Unfiltered pivots for custom breakdown — no sum-account exclusion so
  // user-picked accounts always resolve correctly
const rawCurrentMonthlyPivot = useMemo(() => {
    // No rows for the anchor period → empty, not (0 − previous).
    if (currentRows.length === 0) return new Map();
    const ytd = buildPivotFromRows(currentRows, null);
    if (valueMode === "ytd" || parseInt(month) === 1) return ytd;
    const before = buildPivotFromRows(monthBeforeAnchorRows, null);
    const out = new Map();
    new Set([...ytd.keys(), ...before.keys()]).forEach(ac =>
      out.set(ac, (ytd.get(ac) ?? 0) - (before.get(ac) ?? 0))
    );
    return out;
  }, [currentRows, monthBeforeAnchorRows, month, valueMode]);

  const rawPrevMonthlyPivot = useMemo(() => {
    const ytd = buildPivotFromRows(prevRows, null);
    if (valueMode === "ytd") return ytd;
    const cmpM = Number(compareMonth);
    if (!Number.isFinite(cmpM) || cmpM < 1 || cmpM > 12 || cmpM === 1) return ytd;
    const found = trendRows.find(t => Number(t.year) === Number(compareYear) && Number(t.month) === cmpM - 1);
    if (!found) return ytd;
    const before = buildPivotFromRows(found.rows, null);
    const out = new Map();
    new Set([...ytd.keys(), ...before.keys()]).forEach(ac =>
      out.set(ac, (ytd.get(ac) ?? 0) - (before.get(ac) ?? 0))
    );
    return out;
  }, [prevRows, trendRows, compareYear, compareMonth, valueMode]);

const kpiValues = useMemo(() => {
    if (!slottedKpis || kpiList.length === 0) return null;
    const cacheCur = new Map();
    const cachePrev = new Map();
    // Clone so we can attach variation metadata without mutating memoized upstream pivots
const wrap = (src) => {
      if (!src) return src;
      const m = new Map(src);
      m.__dimPivot = src.__dimPivot;
      m.__sumPivot = src.__sumPivot;
      m.__groupDescendants = src.__groupDescendants;
      if (viewScope === "individual" && company) {
        m.__variationScope = { kind: "company", key: company };
      }
      return m;
    };
    const curP = wrap(currentMonthlyPivot);
    const prvP = wrap(prevMonthlyPivot);
    return slottedKpis.map(kpi => ({
      current: kpi ? computeKpiById(kpi.id, curP, kpiList, ccTagToCodes, sectionCodes, cacheCur) : 0,
      prev:    kpi ? computeKpiById(kpi.id, prvP, kpiList, ccTagToCodes, sectionCodes, cachePrev) : 0,
    }));
}, [slottedKpis, currentMonthlyPivot, prevMonthlyPivot, kpiList, ccTagToCodes, sectionCodes, company, viewScope]);
  // Trend series — MONTHLY values, derived from YTD diffs.
  // For each month, monthly = YTD(month) - YTD(month-1) per account.
  // January: monthly = YTD (since previous month YTD belongs to a different fiscal year).
  const trendSeries = useMemo(() => {
    if (!trendRows.length || !heroKpis || kpiList.length === 0) return [];

// Build pivots per (year, month). Track which months actually have
    // reported rows — an empty fetch means "not reported", NOT "zero balance".
    const pivotsByKey = new Map();
    const hasDataByKey = new Map();
    const failedByKey = new Set();
    trendRows.forEach(({ year: y, month: m, rows, failed }) => {
      pivotsByKey.set(`${y}-${m}`, buildPivotFromRows(rows, sumAccountCodes));
      hasDataByKey.set(`${y}-${m}`, Array.isArray(rows) && rows.length > 0);
      if (failed) failedByKey.add(`${y}-${m}`);
    });

    const sorted = [...trendRows]
      .filter(t => Number.isFinite(t?.year) && Number.isFinite(t?.month))
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    const out = [];
    for (let i = 0; i < sorted.length; i++) {
const { year: y, month: m } = sorted[i];
      const currP = pivotsByKey.get(`${y}-${m}`);
      if (!currP) continue;
      const currHasData = hasDataByKey.get(`${y}-${m}`);

let monthlyPivot;
      if (valueMode === "ytd") {
        monthlyPivot = currP;
} else {
        const isJanuary = m === 1;
        if (!currHasData) {
          // Month has no reported data → its monthly value is 0 (flat on the
          // floor), NOT curr - prev (which would draw a phantom negative spike
          // equal to -(previous month)).
          monthlyPivot = new Map();
          monthlyPivot.__dimPivot = new Map();
          monthlyPivot.__sumPivot = new Map();
        } else if (isJanuary) {
          monthlyPivot = currP;
        } else {
          const prevP = pivotsByKey.get(`${y}-${m - 1}`);
          const safePrev = prevP ?? new Map();
          monthlyPivot = new Map();
          const allCodes = new Set([...currP.keys(), ...safePrev.keys()]);
          allCodes.forEach(ac => {
            monthlyPivot.set(ac, (currP.get(ac) ?? 0) - (safePrev.get(ac) ?? 0));
          });
const mdp = new Map();
          const cDP = currP.__dimPivot ?? new Map();
          const pDP = safePrev.__dimPivot ?? new Map();
          new Set([...cDP.keys(), ...pDP.keys()]).forEach(k => {
            mdp.set(k, (cDP.get(k) ?? 0) - (pDP.get(k) ?? 0));
          });
          monthlyPivot.__dimPivot = mdp;
          const msp = new Map();
          const cSP = currP.__sumPivot ?? new Map();
          const pSP = safePrev.__sumPivot ?? new Map();
          new Set([...cSP.keys(), ...pSP.keys()]).forEach(k => {
            msp.set(k, (cSP.get(k) ?? 0) - (pSP.get(k) ?? 0));
          });
          monthlyPivot.__sumPivot = msp;
        }
      }
      if (viewScope === "individual" && company) {
        const wrapped = new Map(monthlyPivot);
        wrapped.__dimPivot = monthlyPivot.__dimPivot;
        wrapped.__sumPivot = monthlyPivot.__sumPivot;
        wrapped.__variationScope = { kind: "company", key: company };
        monthlyPivot = wrapped;
      }

const cache = new Map();
const entry = {
        _year: y,
        _month: m,
        idx: out.length,
        label: `${MONTHS_ABBR[m - 1]} ${String(y).slice(-2)}`,
        fullLabel: `${MONTHS_ABBR[m - 1]} ${y}`,
      };
      // Mes que no se pudo cargar (o cuyo mes anterior falló, en mensual):
      // sin valor → la línea deja un hueco en lugar de caer a cero.
      const unknown = failedByKey.has(`${y}-${m}`)
        || (valueMode !== "ytd" && m !== 1 && failedByKey.has(`${y}-${m - 1}`));
      kpiSlots.forEach((id, si) => {
        entry[`slot${si}`] = unknown ? null : computeKpiById(id, monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache);
      });
      out.push(entry);
    }
    return out;
}, [trendRows, kpiSlots, kpiList, ccTagToCodes, sectionCodes, sumAccountCodes, valueMode, MONTHS_ABBR, heroKpis, viewScope, company]);

const trendFromYear = useMemo(() => {
    if (!year) return null;
    return Number(year) - Math.ceil(trendWindow / 12) + 1;
  }, [year, trendWindow]);

const trendSeriesDisplay = useMemo(() => {
    if (!trendSeries.length) return [];

    // Slice by CALENDAR YEAR (matches the "From Jan YYYY" label), not by count.
    const yearsBack = Math.ceil(trendWindow / 12);
    const startY = Number(year) - yearsBack + 1;
    const windowed = trendSeries.filter(t => t._year >= startY);

    if (trendInterval === "monthly") return windowed;

    const bucketSize = trendInterval === "6months" ? 6 : 12;
    const out = [];

    for (let i = 0; i < windowed.length; i += bucketSize) {
      const bucket = windowed.slice(i, i + bucketSize);
      if (!bucket.length) continue;
      const first = bucket[0];
      const last  = bucket[bucket.length - 1];

      const entry = {
        _year:  last._year,
        _month: last._month,
        idx:    out.length,
        label: bucketSize === 12
          ? `${last._year}`
          : `${MONTHS_ABBR[first._month - 1]}–${MONTHS_ABBR[last._month - 1]} ${String(last._year).slice(-2)}`,
        fullLabel: bucketSize === 12
          ? `FY ${last._year}`
          : `${MONTHS_ABBR[first._month - 1]}–${MONTHS_ABBR[last._month - 1]} ${last._year}`,
      };

// Both modes: show the LAST entry's value.
      // YTD → cumulative to that point. Monthly → that month's delta.
      kpiSlots.forEach((_, si) => {
        entry[`slot${si}`] = last[`slot${si}`] ?? 0;
      });
      out.push(entry);
    }
    return out;
}, [trendSeries, trendWindow, trendInterval, kpiSlots, year, MONTHS_ABBR]);

  const sparklines = useMemo(() => {
    const last12 = trendSeries.slice(-12);
    return kpiSlots.map((_, si) => last12.map(t => t[`slot${si}`] ?? 0));
  }, [trendSeries, kpiSlots]);

  // Top by revenue (multi-company): group rows by company, build pivot per company,
  // evaluate revenue KPI on each. Same approach as KpiIndividualesPage.
// Detected reporting currency (parent's currency = most common in journal).
  const reportingCurrency = useMemo(
    () => detectReportingCurrency(allCoCurrentRows),
    [allCoCurrentRows]
  );

  // KPI used to rank companies / holdings in the multi-company card
  const [rankingKpiId, setRankingKpiId] = useState("revenue");
// Ranking entities — the set of companies/holdings we'll rank.
  // Individual: ALL visible companies (leaves + holdings shown as standalone).
  // Consolidated: only holdings.
  const rankingEntities = useMemo(() => {
    if (viewScope === "individual") {
      const companyNames = (visibleCompanies ?? []).map(c =>
        typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)
      ).filter(Boolean);
      return companyNames;
    }
    return holdings.map(h => h.shortName);
  }, [viewScope, visibleCompanies, holdings]);

  // Per-entity fetch state: { [entity]: { currentRows, prevRows, trendRows } }
  // These mirror EXACTLY what the hero cards have (currentRows, prevRows,
  // trendRows) — just one set per ranked entity instead of one for the page.
  const rankingFetchCacheRef = useRef(new Map());
  const [rankingDataByEntity, setRankingDataByEntity] = useState({});
  useEffect(() => {
    if (!year || !month || !source || !structure || rankingEntities.length === 0) return;
    let cancelled = false;
    const anchorY = Number(year), anchorM = Number(month);
    // We need: currentRows, prevRows (compare period), AND the month-before-current
    // (for monthly mode). Same as hero cards.
    const prevAnchorM = anchorM > 1 ? anchorM - 1 : 12;
    const prevAnchorY = anchorM > 1 ? anchorY : anchorY - 1;
    // Compare period — same as compareYear/compareMonth state
    const cmpY = compareYear ? Number(compareYear) : null;
    const cmpM = compareMonth ? Number(compareMonth) : null;
    const cmpPrevM = cmpM && cmpM > 1 ? cmpM - 1 : (cmpM === 1 ? 12 : null);
    const cmpPrevY = cmpM && cmpM > 1 ? cmpY : (cmpM === 1 ? cmpY - 1 : null);

    (async () => {
      const out = {};
      for (let i = 0; i < rankingEntities.length; i += 4) {
        const batch = rankingEntities.slice(i, i + 4);
        const results = await Promise.all(batch.map(async (entity) => {
          const cache = rankingFetchCacheRef.current;
          const getOrFetch = async (y, m) => {
            if (!y || !m) return [];
            const key = `${entity}|${y}|${m}`;
            let rows = cache.get(key);
            if (!rows) {
              rows = await fetchPeriod(y, String(m), source, structure, entity);
              cache.set(key, rows);
            }
            return rows;
          };
          const [curRows, monthBeforeCurRows, cmpRows, monthBeforeCmpRows] = await Promise.all([
            getOrFetch(anchorY, anchorM),
            getOrFetch(prevAnchorY, prevAnchorM),
            getOrFetch(cmpY, cmpM),
            getOrFetch(cmpPrevY, cmpPrevM),
          ]);
          return [entity, { curRows, monthBeforeCurRows, cmpRows, monthBeforeCmpRows }];
        }));
        if (cancelled) return;
        results.forEach(([k, v]) => { out[k] = v; });
      }
      if (!cancelled) setRankingDataByEntity(out);
    })();
    return () => { cancelled = true; };
  }, [rankingEntities, year, month, compareYear, compareMonth, source, structure, fetchPeriod]);

  // Compute the ranking KPI per entity using THE EXACT SAME cadena as hero:
  //   currentYtdPivot = buildPivotFromRows(currentRows)
  //   currentMonthlyPivot = valueMode==="ytd" ? currentYtdPivot
  //                        : m===1 ? currentYtdPivot
  //                        : currentYtdPivot - buildPivotFromRows(monthBeforeCurRows)
  //   v = computeKpiById(id, currentMonthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache)
  // Then FX-convert to reporting currency on the final scalar.
  const topByRevenue = useMemo(() => {
    if (kpiList.length === 0) return [];
    const m = Number(month);
    const cm = compareMonth ? Number(compareMonth) : null;

    // Pivote del periodo (YTD o mensual = YTD − YTD del mes anterior),
    // la MISMA cadena que usan las tarjetas de arriba.
    const periodPivot = (ytdRows, beforeRows, mm) => {
      const ytd = buildPivotFromRows(ytdRows, sumAccountCodes);
      if (valueMode === "ytd" || mm === 1) return ytd;
      const before = buildPivotFromRows(beforeRows ?? [], sumAccountCodes);
      const out = new Map();
      new Set([...ytd.keys(), ...before.keys()]).forEach(ac => out.set(ac, (ytd.get(ac) ?? 0) - (before.get(ac) ?? 0)));
      const diff = (a, b) => {
        const r = new Map();
        new Set([...a.keys(), ...b.keys()]).forEach(k => r.set(k, (a.get(k) ?? 0) - (b.get(k) ?? 0)));
        return r;
      };
      out.__dimPivot = diff(ytd.__dimPivot ?? new Map(), before.__dimPivot ?? new Map());
      out.__sumPivot = diff(ytd.__sumPivot ?? new Map(), before.__sumPivot ?? new Map());
      return out;
    };
    const kpiOf = (pivot, entity) => {
      let p = pivot;
      if (viewScope === "individual" && company) {
        p = new Map(pivot);
        p.__dimPivot = pivot.__dimPivot;
        p.__sumPivot = pivot.__sumPivot;
        p.__variationScope = { kind: "company", key: entity };
      }
      const v = computeKpiById(rankingKpiId, p, kpiList, ccTagToCodes, sectionCodes, new Map());
      return (v === null || isNaN(v)) ? null : v;
    };

    const out = [];
    rankingEntities.forEach(entity => {
      const data = rankingDataByEntity[entity];
      if (!data || !data.curRows?.length) return;
      // Sin conversión de divisa: cada holding viene ya en su moneda de
      // reporte, igual que las tarjetas de arriba.
      const v = kpiOf(periodPivot(data.curRows, data.monthBeforeCurRows, m), entity);
      if (v === null) return;
      const prev = (cm && data.cmpRows?.length)
        ? kpiOf(periodPivot(data.cmpRows, data.monthBeforeCmpRows, cm), entity)
        : null;
      out.push({ name: entity, value: v, prev });
    });
    return out.sort((a, b) => b.value - a.value);
}, [rankingEntities, rankingDataByEntity, kpiList, ccTagToCodes, sectionCodes, sumAccountCodes, month, compareMonth, valueMode, rankingKpiId, viewScope, company]);

  const periodLabel = useMemo(() => {
   if (!year || !month) return probing ? t("loading_searching") : "—";
    const mNum = Number(month);
    if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) return "—";
return `${MONTHS_ABBR[mNum - 1]} ${year}`;
  }, [year, month, probing, t, MONTHS_ABBR]);

const _anyLoading = loading || trendLoading || probing || allCoLoading || !resolverReady;

  // True when the selected period's anchor fetch has FINISHED but returned no
  // rows — i.e. this period genuinely has no data. Used to show an explicit
  // "no data" state instead of rendering 0s that look like real values.
  const noPeriodData = !!year && !!month && !loading && currentRows.length === 0;

// Progress meter: 5 stages, weighted by perceptual cost.
  // IMPORTANT: stages count as complete when the corresponding FETCH has
  // finished — NOT when it returned rows. A period with no data is a valid
  // result, so an empty currentRows/trendRows/allCoCurrentRows must still
  // advance the bar to 100%. Otherwise selecting an empty month leaves the
  // loader stuck (~60%) and its overlay blocks the whole page forever.
  // El histórico de 24 meses NO cuenta aquí: es lo más lento y ya no bloquea
  // la página. Cuando lo demás está listo el cargador general desaparece y la
  // evolución sigue cargando dentro de su propia gráfica (TrendBuildingLoader).
  // Hitos derivados (patrón "estado a partir del render anterior" de React)
  if (!bootMarks.period && year && month) setBootMarks(m => ({ ...m, period: true }));
  if (!bootMarks.resolver && resolverReady) setBootMarks(m => ({ ...m, resolver: true }));

  const loadProgress = useMemo(() => {
    let pct = 0;
    if (bootMarks.period)   pct += 15;   // periodo detectado
    if (bootMarks.resolver) pct += 30;   // estándar y KPIs resueltos
    if (bootMarks.current)  pct += 30;   // datos del periodo descargados (aunque vengan vacíos)
    if (bootMarks.allCo)    pct += 25;   // datos de todas las sociedades descargados
    return Math.min(100, pct);
  }, [bootMarks]);

  // Smoothly animate the displayed value between progress changes
  const animatedLoadProgress = useAnimatedNumber(loadProgress, 700);


// ── Breakdown views ─────────────────────────────────────────────
  const BREAKDOWN_VIEWS = useMemo(() => [
    {
      id: "cost_structure",
      label: t("breakdown_cost_structure"),
      icon: "💰",
      description: t("breakdown_cost_structure_desc"),
      tags: ["CC_02-Cost Of Sales","CC_05-Lease Expense","CC_06-General and administrative","CC_07-Employee Expense","CC_08-R&D","CC_09-Impairment Gain (Loss) on Fixed Assets","CC_10-Depreciation and Amotization","CC_11-Other Operating Expenses","CC_15-Interest expense","CC_16-Other financial expense","CC_18-Income Tax"],
    },
    {
      id: "revenue_mix",
      label: t("breakdown_revenue_mix"),
      icon: "📈",
      description: t("breakdown_revenue_mix_desc"),
      tags: ["CC_01-Revenue","CC_03-Other Operating Income","CC_13-Interest Income","CC_14-Other financial income"],
    },
    {
      id: "opex_detail",
      label: t("breakdown_opex_detail"),
      icon: "🔧",
      description: t("breakdown_opex_detail_desc"),
      tags: ["CC_05-Lease Expense","CC_06-General and administrative","CC_07-Employee Expense","CC_08-R&D","CC_09-Impairment Gain (Loss) on Fixed Assets","CC_10-Depreciation and Amotization","CC_11-Other Operating Expenses"],
    },
    {
      id: "financial_pl",
      label: t("breakdown_financial_pl"),
      icon: "🏦",
      description: t("breakdown_financial_pl_desc"),
      tags: ["CC_13-Interest Income","CC_14-Other financial income","CC_15-Interest expense","CC_16-Other financial expense","CC_17-Foreign Exchange","CC_18-Income Tax"],
    },
    {
      id: "pl_bridge",
      label: t("breakdown_pl_bridge"),
      icon: "🌉",
      description: t("breakdown_pl_bridge_desc"),
      tags: ["CC_01-Revenue","CC_03-Other Operating Income","CC_02-Cost Of Sales","CC_05-Lease Expense","CC_06-General and administrative","CC_07-Employee Expense","CC_08-R&D","CC_10-Depreciation and Amotization","CC_11-Other Operating Expenses","CC_13-Interest Income","CC_14-Other financial income","CC_15-Interest expense","CC_16-Other financial expense","CC_17-Foreign Exchange","CC_18-Income Tax"],
    },
  ], [t]);


const [activeBreakdownView, setActiveBreakdownView] = useState("cost_structure");
const [breakdownSettingsOpen, setBreakdownSettingsOpen] = useState(false);
const [customStructures, setCustomStructures]     = useState([]);
const [editingStructure, setEditingStructure]     = useState(null);
const [breakdownLibraryOpen, setBreakdownLibraryOpen] = useState(false);
const [defaultViewId, setDefaultViewId]           = useState(null);// null | "new" | structure object
  const breakdownSettingsRef = useRef(null);
const [aiPanelOpen, setAiPanelOpen] = useState(false);
const [openDetail, setOpenDetail] = useState(null); // "companies" | "structures" | "dimensions" | "sources" | null
const [middleCardView, setMiddleCardView] = useState("trend"); // "trend" | "ranking" | "tag_drill"
  const [drillTag, setDrillTag] = useState(null); // CC tag string when middleCardView === "tag_drill"
  const [rankingSelectorOpen, setRankingSelectorOpen] = useState(false);
  const rankingSelectorRef = useRef(null);

  useEffect(() => {
    if (!rankingSelectorOpen) return;
    const handler = (e) => {
      if (rankingSelectorRef.current && !rankingSelectorRef.current.contains(e.target))
        setRankingSelectorOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [rankingSelectorOpen]);

  useEffect(() => {
    if (!breakdownSettingsOpen) return;
    const handler = (e) => {
      if (breakdownSettingsRef.current && !breakdownSettingsRef.current.contains(e.target))
        setBreakdownSettingsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [breakdownSettingsOpen]);

const loadStructuresWithNames = useCallback(async (cid) => {
    const structures = await listBreakdownStructures({ companyId: cid });
    const userIds = [...new Set([
      ...(structures ?? []).map(s => s.created_by).filter(Boolean),
      ...(structures ?? []).map(s => s.updated_by).filter(Boolean),
    ])];
    let nameMap = new Map();
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .schema("accounts").from("users")
        .select("id, username, email")
        .in("id", userIds);
      (users ?? []).forEach(u => {
        const name = u.username?.split(" ")[0] || u.email?.split("@")[0] || "Teammate";
        nameMap.set(u.id, name);
      });
    }
    return (structures ?? []).map(s => ({
      ...s,
      _editorName: nameMap.get(s.updated_by ?? s.created_by) ?? "Teammate",
    }));
  }, []);

  // Load company-wide custom structures + restore user's last active view
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id ?? userId;
        if (!uid) return;

        // Resolve company ID — same fallback as onSave
        let cid = settingsCompanyId;
        if (!cid) {
          const { data: ucRow } = await supabase
            .schema("accounts").from("user_companies")
            .select("company_id").eq("user_id", uid).eq("is_active", true)
            .order("is_default", { ascending: false }).limit(1).maybeSingle();
          cid = ucRow?.company_id ?? null;
        }
        if (!cid || cancelled) return;

const [structures, pref] = await Promise.all([
          loadStructuresWithNames(cid),
          getBreakdownPreference({ userId: uid, companyId: cid }),
        ]);
        if (cancelled) return;
setCustomStructures(structures ?? []);
        if (pref?.active_view_id) {
          setActiveBreakdownView(pref.active_view_id);
          setDefaultViewId(pref.active_view_id);
        }
      } catch { /* ignore */ }
    })();
return () => { cancelled = true; };
  }, [settingsCompanyId, userId, loadStructuresWithNames]);

  // Persist user's active view whenever it changes
  const prevActiveViewRef = useRef(null);
  useEffect(() => {
    if (!userId || !settingsCompanyId) return;
    if (prevActiveViewRef.current === activeBreakdownView) return;
    prevActiveViewRef.current = activeBreakdownView;
    saveBreakdownPreference({ userId, companyId: settingsCompanyId, activeViewId: activeBreakdownView });
  }, [activeBreakdownView, userId, settingsCompanyId]);

// Convert the standard mapping's pl_tree into a costBreakdown-compatible structure
  const standardMappingStructure = useMemo(() => {
    const plTree = Array.isArray(standardMappingData?.pl_tree) ? standardMappingData.pl_tree : [];
    if (!plTree.length) return null;

    function collectLeaves(nodes) {
      const out = [];
      (nodes || []).forEach(n => {
        if (n.kind === "breaker") { out.push(...collectLeaves(n.children)); return; }
        if (!n.children || n.children.length === 0) {
          out.push({ account_code: n.code, account_name: n.name, sign: "+", _key: n.code });
        } else {
          out.push(...collectLeaves(n.children));
        }
      });
      return out;
    }

    const items = [];
    let gi = 0;
    plTree.forEach((node, i) => {
      if (node.kind === "breaker") {
        const lines = collectLeaves(node.children || []);
        if (lines.length > 0) {
          items.push({ id: node.code ?? `brk-${i}`, label: node.name, color: node.color ?? GROUP_PALETTE[gi % GROUP_PALETTE.length], sign: "+", order: gi, lines });
          gi++;
        }
      } else {
        const lines = (node.isSum || node.isSumAccount)
          ? collectLeaves(node.children || [])
          : [{ account_code: node.code, account_name: node.name, sign: "+", _key: node.code }];
        if (lines.length > 0) {
          items.push({ id: node.code ?? `node-${i}`, label: node.name, color: GROUP_PALETTE[gi % GROUP_PALETTE.length], sign: "+", order: gi, lines });
          gi++;
        }
      }
    });
   const rawName = standardMappingData.name;
    const cleanName = (!rawName || /^__.*__$/.test(String(rawName).trim()))
      ? t("breakdown_standard_mapping", "Standard mapping")
      : rawName;
return items.length ? { id: "standard_mapping", name: cleanName, description: "From your standard mapping", items } : null;
  }, [standardMappingData, t]);

  const activeCustomStructure = useMemo(() => {
    const fromCustom = customStructures.find(s => s.id === activeBreakdownView);
    if (fromCustom) return fromCustom;
    if (activeBreakdownView === "standard_mapping" && standardMappingStructure) return standardMappingStructure;
    return null;
  }, [customStructures, activeBreakdownView, standardMappingStructure]);

// When the standard mapping loads, switch to it if still on a preset view
useEffect(() => {
    if (!standardMappingStructure) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setActiveBreakdownView(prev =>
        BREAKDOWN_VIEWS.some(v => v.id === prev) ? "standard_mapping" : prev
      );
    });
    return () => { cancelled = true; };
  }, [standardMappingStructure, BREAKDOWN_VIEWS]);

  const activeView = BREAKDOWN_VIEWS.find(v => v.id === activeBreakdownView) ?? BREAKDOWN_VIEWS[0];

const TAG_LABELS = useMemo(() => ({
    "CC_01-Revenue":                                t("tag_revenue"),
    "CC_02-Cost Of Sales":                          t("cost_of_sales"),
    "CC_03-Other Operating Income":                 t("tag_other_op_income"),
    "CC_05-Lease Expense":                          t("lease_expense"),
    "CC_06-General and administrative":             t("general_admin"),
    "CC_07-Employee Expense":                       t("employee_expense"),
    "CC_08-R&D":                                    t("rd"),
    "CC_09-Impairment Gain (Loss) on Fixed Assets": t("impairment"),
    "CC_10-Depreciation and Amotization":           t("depreciation"),
    "CC_11-Other Operating Expenses":               t("other_opex"),
    "CC_13-Interest Income":                        t("tag_interest_income"),
    "CC_14-Other financial income":                 t("tag_other_fin_income"),
    "CC_15-Interest expense":                       t("interest_expense"),
    "CC_16-Other financial expense":                t("other_fin_expense"),
    "CC_17-Foreign Exchange":                       t("tag_fx"),
    "CC_18-Income Tax":                             t("income_tax"),
  }), [t]);

const costBreakdown = useMemo(() => {
    if (!ccTagToCodes || ccTagToCodes.size === 0) return [];
    if (!currentMonthlyPivot || currentMonthlyPivot.size === 0) return [];

// Custom structure path — each item is a GROUP with multiple lines inside
    if (activeCustomStructure) {
      return [...(activeCustomStructure.items ?? [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(group => {
          // Sum all lines: sign "+" → negate raw (income stored as negative credit)
          //                sign "-" → abs value (cost stored as positive debit)
let curr = 0, prev = 0;
          (group.lines ?? []).forEach(line => {
            const rawCurr = rawCurrentMonthlyPivot.get(line.account_code) ?? 0;
            const rawPrev = rawPrevMonthlyPivot.get(line.account_code)    ?? 0;
            const f = (line.sign ?? "+") === "+" ? 1 : -1;
            curr += f * Math.abs(rawCurr);
            prev += f * Math.abs(rawPrev);
          });
          let change = null;
          if (Math.abs(prev) > 0.005) change = ((curr - prev) / Math.abs(prev)) * 100;
          // isIncome drives the change-arrow colour: green if positive change is good
const isInc = (group.lines?.[0]?.sign ?? "+") === "+";
          return {
            tag:        group.id,
            name:       group.label,
            value:      curr,
            prevValue:  prev,
            change,
            isIncome:   isInc,
            groupSign:  group.sign  ?? "+",
            groupColor: group.color ?? "#1a2f8a",
          };
        })
        .filter(r => Math.abs(r.value) > 0.005);
    }

    // Preset structure path (unchanged)
    const isIncome = (tag) => INCOME_TAGS.has(tag);
    return activeView.tags
      .map(tag => {
        const rawCurr = pivotSum(currentMonthlyPivot, ccTagToCodes.get(tag) ?? []);
        const rawPrev = pivotSum(prevMonthlyPivot,    ccTagToCodes.get(tag) ?? []);
        const curr = isIncome(tag) ? -rawCurr : Math.abs(rawCurr);
        const prev = isIncome(tag) ? -rawPrev : Math.abs(rawPrev);
        let change = null;
        if (Math.abs(prev) > 0.005) change = ((curr - prev) / Math.abs(prev)) * 100;
        return { tag, name: TAG_LABELS[tag] ?? tag, value: curr, prevValue: prev, change, isIncome: isIncome(tag) };
      })
      .filter(r => Math.abs(r.value) > 0.005)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8);
}, [activeCustomStructure, activeView, ccTagToCodes, currentMonthlyPivot, prevMonthlyPivot, rawCurrentMonthlyPivot, rawPrevMonthlyPivot, TAG_LABELS]);

const totalCosts = useMemo(
    () => activeCustomStructure
      ? costBreakdown.reduce((s, c) => s + ((c.groupSign ?? "+") === "+" ? c.value : -c.value), 0)
      : costBreakdown.reduce((s, c) => s + Math.abs(c.value), 0),
    [costBreakdown, activeCustomStructure]
  );

// ── TAG DRILL-DOWN: data when a cost-structure row is clicked ───────────
const drillAccountBreakdown = useMemo(() => {
    if (!drillTag) return [];

    // Custom structure group — use group lines directly
    if (activeCustomStructure) {
      const group = activeCustomStructure.items?.find(g => g.id === drillTag);
      if (!group) return [];
      return (group.lines ?? [])
        .map(line => {
          const rawCurr = rawCurrentMonthlyPivot.get(line.account_code) ?? 0;
          const rawPrev = rawPrevMonthlyPivot.get(line.account_code) ?? 0;
          const f = (line.sign ?? "+") === "+" ? 1 : -1;
const curr = f * Math.abs(rawCurr);
          const prev = f * Math.abs(rawPrev);
          let change = null;
          if (Math.abs(prev) > 0.005) change = ((curr - prev) / Math.abs(prev)) * 100;
          return { code: line.account_code, name: line.account_name ?? line.account_code, value: curr, prevValue: prev, change };
        })
        .filter(r => Math.abs(r.value) > 0.005)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 12);
    }

    if (!ccTagToCodes || !currentMonthlyPivot) return [];
    const codes = ccTagToCodes.get(drillTag) ?? [];
    const isIncome = INCOME_TAGS.has(drillTag);
    const rows = codes.map(code => {
      const rawCurr = currentMonthlyPivot.get(code) ?? 0;
      const rawPrev = prevMonthlyPivot.get(code) ?? 0;
      const curr = isIncome ? -rawCurr : Math.abs(rawCurr);
      const prev = isIncome ? -rawPrev : Math.abs(rawPrev);
      const ga = groupAccounts.find(g => String(g.AccountCode ?? g.accountCode) === code);
      const name = ga?.AccountName ?? ga?.accountName ?? code;
      let change = null;
      if (Math.abs(prev) > 0.005) change = ((curr - prev) / Math.abs(prev)) * 100;
      return { code, name, value: curr, prevValue: prev, change };
    });
    return rows
      .filter(r => Math.abs(r.value) > 0.005)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 12);
}, [drillTag, activeCustomStructure, ccTagToCodes, currentMonthlyPivot, prevMonthlyPivot, rawCurrentMonthlyPivot, rawPrevMonthlyPivot, groupAccounts]);

const drillTimeSeries = useMemo(() => {
    if (!drillTag || !trendRows.length) return [];

    // Custom structure group
    if (activeCustomStructure) {
      const group = activeCustomStructure.items?.find(g => g.id === drillTag);
      if (!group?.lines?.length) return [];
      const anchorY = Number(year), anchorM = Number(month);
      if (!Number.isFinite(anchorY) || !Number.isFinite(anchorM)) return [];

      const pivotsByKey = new Map();
      trendRows.forEach(({ year: y, month: m, rows }) => {
        pivotsByKey.set(`${y}-${m}`, buildPivotFromRows(rows, null));
      });

      const getGroupVal = (y, m) => {
        const currP = pivotsByKey.get(`${y}-${m}`);
        if (!currP) return null;
        let pivot;
        if (m === 1) {
          pivot = currP;
        } else {
          const prevP = pivotsByKey.get(`${y}-${m - 1}`);
          if (!prevP) return null;
          pivot = new Map();
          new Set([...currP.keys(), ...prevP.keys()]).forEach(ac =>
            pivot.set(ac, (currP.get(ac) ?? 0) - (prevP.get(ac) ?? 0))
          );
        }
        let total = 0;
        (group.lines ?? []).forEach(line => {
          const raw = pivot.get(line.account_code) ?? 0;
          const f = (line.sign ?? "+") === "+" ? 1 : -1;
          total += f * Math.abs(raw);
        });
        return total;
      };

      return Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        return {
          month: m,
          label: MONTHS_ABBR[m - 1],
          current: m <= anchorM ? getGroupVal(anchorY, m) : null,
          prior:   getGroupVal(anchorY - 1, m),
        };
      });
    }

    if (!ccTagToCodes) return [];
    const codes = ccTagToCodes.get(drillTag) ?? [];
    if (codes.length === 0) return [];
    const isIncome = INCOME_TAGS.has(drillTag);
    const anchorY = Number(year);
    const anchorM = Number(month);
    if (!Number.isFinite(anchorY) || !Number.isFinite(anchorM)) return [];

    const pivotsByKey = new Map();
    trendRows.forEach(({ year: y, month: m, rows }) => {
      pivotsByKey.set(`${y}-${m}`, buildPivotFromRows(rows, sumAccountCodes));
    });

    const getMonthlyTagValue = (y, m) => {
      const currP = pivotsByKey.get(`${y}-${m}`);
      if (!currP) return null;
      let monthlyPivot;
      if (m === 1) {
        monthlyPivot = currP;
      } else {
        const prevP = pivotsByKey.get(`${y}-${m - 1}`);
        if (!prevP) return null;
        monthlyPivot = new Map();
        const allCodes = new Set([...currP.keys(), ...prevP.keys()]);
        allCodes.forEach(ac => monthlyPivot.set(ac, (currP.get(ac) ?? 0) - (prevP.get(ac) ?? 0)));
      }
      let total = 0;
      codes.forEach(c => { total += (monthlyPivot.get(c) ?? 0); });
      return isIncome ? -total : Math.abs(total);
    };

    const out = [];
    for (let m = 1; m <= 12; m++) {
      const curVal = getMonthlyTagValue(anchorY, m);
      const prevVal = getMonthlyTagValue(anchorY - 1, m);
      const cur = m <= anchorM ? curVal : null;
      out.push({
        month: m,
        label: MONTHS_ABBR[m - 1],
        current: cur,
        prior: prevVal,
      });
    }
    return out;
}, [drillTag, activeCustomStructure, trendRows, ccTagToCodes, year, month, sumAccountCodes, MONTHS_ABBR]);

  const drillStats = useMemo(() => {
    if (!drillTag) return null;
    const row = costBreakdown.find(r => r.tag === drillTag);
    if (!row) return null;
    let ytdCurrent = 0, ytdPrior = 0;
    const anchorM = Number(month);
    drillTimeSeries.forEach(p => {
      if (p.current != null) ytdCurrent += p.current;
      if (p.month <= anchorM && p.prior != null) ytdPrior += p.prior;
    });
    const yoyChange = ytdPrior > 0.005 ? ((ytdCurrent - ytdPrior) / Math.abs(ytdPrior)) * 100 : null;
    return {
      label: row.name,
      isIncome: row.isIncome,
      monthlyValue: row.value,
      monthlyChange: row.change,
      ytdCurrent,
      ytdPrior,
      yoyChange,
    };
  }, [drillTag, costBreakdown, drillTimeSeries, month]);
  

  const rankingKpiLabel = useMemo(() => {
    const k = kpiList.find(k => k.id === rankingKpiId);
    return k?.label ?? rankingKpiId;
  }, [kpiList, rankingKpiId]);

  // Nombre largo de cada sociedad / holding para el ranking ampliado
  const entityLegalName = useMemo(() => {
    const m = new Map();
    (companies ?? []).forEach(c => {
      if (typeof c !== "object") return;
      const sn = c.companyShortName ?? c.CompanyShortName;
      const ln = c.CompanyLegalName ?? c.companyLegalName;
      if (sn && ln) m.set(sn, ln);
    });
    (holdings ?? []).forEach(h => { if (h.shortName && h.legalName) m.set(h.shortName, h.legalName); });
    return m;
  }, [companies, holdings]);
  const [rankHover, setRankHover] = useState(null);

  const trendLabels = useMemo(
    () => SLOT_COLORS.map((_, i) => slottedKpis?.[i]?.label ?? kpiSlots[i]),
    [SLOT_COLORS, slottedKpis, kpiSlots]
  );

const costColors = useMemo(() => {
    return [colors.primary ?? "#1a2f8a", "#3b54b8", "#7c5fcc", "#b370cc", "#cf6595", "#cf5070", "#cf3940"];
  }, [colors]);

return (
<>
    <style>{HOME_CSS}</style>
    <HomeBootOverlay
      visible={loadProgress < 100 || animatedLoadProgress < 99.5}
      progress={animatedLoadProgress}
      label={probing
        ? t("loading_overlay_period")
        : !resolverReady
          ? t("loading_overlay_kpi")
          : currentRows.length === 0
            ? t("loading_overlay_current")
            : allCoCurrentRows.length === 0
              ? t("loading_overlay_multico")
              : t("loading_overlay_finish")}
      sub={t("loading_overlay_subtitle")}
      primary={colors.primary ?? "#1a2f8a"}
      secondary={colors.secondary ?? "#CF305D"}
    />
    <div className="hpRoot relative h-full flex flex-col" style={{ "--hp-p": colors.primary ?? "#1a2f8a" }}>
      <style>{`
        @keyframes hpOverlayFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes hpPopIn {
          0%   { opacity: 0; transform: scale(0.92) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <ConsolidationBackground primary={colors.primary ?? "#1a2f8a"} />

      <style>{`
@keyframes pickerFoldDown {
          0%   { opacity: 0; clip-path: inset(0 0 100% 0 round 16px); }
          100% { opacity: 1; clip-path: inset(0 0 0% 0 round 16px); }
        }
        @keyframes kBgRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes kBgPulse  { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes kBgFloat  { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-20px); } }
        @keyframes kCardEntry {
          0% { opacity: 0; transform: translateY(15px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes kShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
@keyframes kFadeInUp {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes kAvatarPop {
          0%   { opacity: 0; transform: scale(0.4) rotate(-12deg); }
          60%  { transform: scale(1.08) rotate(2deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes kAvatarRing {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes kGreetingSlide {
          0%   { opacity: 0; transform: translateX(-16px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes kNameReveal {
          0%   { opacity: 0; transform: translateY(14px) skewY(1deg); }
          100% { opacity: 1; transform: translateY(0) skewY(0deg); }
        }
        @keyframes kBadgesPop {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes kPeriodSlide {
          0%   { opacity: 0; transform: translateX(20px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes kOnlinePing {
          0%   { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.4); opacity: 0; }
        }
.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes drillFadeIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes acctSlide {
          0%   { opacity: 0; transform: translateX(12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes barGrow {
          0%   { width: 0 !important; opacity: 0.4; }
          100% { opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
<div className="relative z-10 flex flex-col flex-1 min-h-0 pl-1 pr-1 gap-3">
  {/* HEADER — same height/style as PageHeader so it aligns with sidebar logo card */}
<div
          className="relative flex-shrink-0 bg-white rounded-2xl border border-gray-100 flex items-center justify-between px-5"
          style={{
            height: "7vh",
            boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
            overflow: "visible",
            zIndex: 40,
          }}>



{/* LEFT — greeting + name + divider + company + badges */}
          <div className="flex items-center gap-4 pl-2 min-w-0">
            {/* Initials avatar */}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-black flex-shrink-0 select-none"
              style={{
                background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary ?? "#CF305D"} 100%)`,
                boxShadow: `0 4px 12px -4px ${colors.primary}60`,
                animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0s both",
              }}>
              {(displayName || "?").split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase()}
            </div>
<div className="flex items-baseline gap-2 whitespace-nowrap flex-shrink-0">
              <span style={{
                ...headerStyle,
                lineHeight: 1,
                letterSpacing: "-0.018em",
                fontSize: "1.4rem",
                display: "inline-block",
                animation: "kGreetWord 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.05s both",
                color: "inherit",
              }}>
                {greeting},
              </span>
              <span style={{
                ...headerStyle,
                lineHeight: 1,
                letterSpacing: "-0.018em",
                fontSize: "1.4rem",
                display: "inline-block",
                animation: "kNamePop 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.22s both",
                color: "inherit",
              }}>
                {displayName || "—"}
              </span>
            </div>

            {/* Soft divider */}
            <div style={{
              width: 1, height: "40%", flexShrink: 0,
              background: "linear-gradient(180deg, transparent 0%, rgba(26,47,138,0.12) 30%, rgba(26,47,138,0.12) 70%, transparent 100%)",
            }} />

            {/* Company + badges */}
            <div className="flex items-center gap-2 min-w-0" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.4,0,0.2,1) 0.18s both" }}>
              {companyMeta?.name && (
                <span className="text-[12px] font-semibold text-gray-500 truncate">{companyMeta.name}</span>
              )}
              {companyMeta?.tier && (
                <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider"
                  style={{ background: `${colors.primary}12`, color: colors.primary }}>
                  {companyMeta.tier}
                </span>
              )}
              {trialDaysLeft !== null && (
                <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider"
                  style={{ background: "#fffbeb", color: "#d97706" }}>
                  {trialDaysLeft}d {t("home_trial")}
                </span>
              )}
            </div>
          </div>

{/* RIGHT — period + standard + loading */}
          <div className="flex items-center gap-2" style={{ animation: "kPeriodSlide 0.4s cubic-bezier(0.4,0,0.2,1) 0.12s both" }}>
{/* Clickable period chip */}
            <div className="relative" ref={pickerRef}>
<button
                onClick={() => setPickerOpen(o => !o)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border hover:shadow-md whitespace-nowrap"
                style={{
                  background: pickerOpen ? colors.primary : "#f9fafb",
                  borderColor: pickerOpen ? colors.primary : "#f3f4f6",
                 minWidth: pickerOpen ? 340 : 0,
                  transition: "min-width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onMouseEnter={e => { if (!pickerOpen) { e.currentTarget.style.background = "#f0f4ff"; e.currentTarget.style.borderColor = "#e0e7ff"; }}}
                onMouseLeave={e => { if (!pickerOpen) { e.currentTarget.style.background = "#f9fafb"; e.currentTarget.style.borderColor = "#f3f4f6"; }}}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: pickerOpen ? "rgba(255,255,255,0.8)" : colors.primary }} />
<span className="text-[11px] font-black uppercase tracking-wider"
                  style={{ color: pickerOpen ? "#fff" : "#374151" }}>
                  {periodLabel}
                </span>
                <GitCompare size={10} style={{ color: pickerOpen ? "rgba(255,255,255,0.7)" : "#9ca3af", marginLeft: 2 }} />
                <span className="text-[11px] font-black uppercase tracking-wider"
                  style={{ color: pickerOpen ? "#fff" : "#374151" }}>
                  {compareLabel}
                </span>
{company && (
                  <>
                    <div style={{ width: 1, height: 14, background: pickerOpen ? "rgba(255,255,255,0.3)" : "rgba(26,47,138,0.1)", flexShrink: 0 }} />
                    <span className="text-[11px] font-semibold" style={{ color: pickerOpen ? "rgba(255,255,255,0.85)" : "#9ca3af" }}>
                      {company}
                    </span>
                  </>
                )}
                <div style={{ width: 1, height: 14, background: pickerOpen ? "rgba(255,255,255,0.3)" : "rgba(26,47,138,0.1)", flexShrink: 0 }} />
                <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                  style={{
                    background: pickerOpen ? "rgba(255,255,255,0.18)" : `${colors.primary}12`,
                    color: pickerOpen ? "rgba(255,255,255,0.9)" : colors.primary,
                  }}>
                  {viewScope === "consolidated" ? t("picker_consolidated") : t("picker_individual")}
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                  style={{
                    background: pickerOpen ? "rgba(255,255,255,0.18)" : `${colors.primary}12`,
                    color: pickerOpen ? "rgba(255,255,255,0.9)" : colors.primary,
                  }}>
                  {valueMode === "ytd" ? t("picker_ytd") : t("picker_monthly")}
                </span>
<ChevronDown size={10} style={{ color: pickerOpen ? "rgba(255,255,255,0.7)" : "#9ca3af", marginLeft: 2 }} />
</button>

{pickerOpen && (
                <PeriodPicker
                  year={year} month={month}
                  onSelectPeriod={(y, m) => { setYear(y); setMonth(m); }}
                  viewScope={viewScope}
                  onScopeChange={(scope) => {
                    // Clear the *other* scope's override so it falls back to its default
                    if (scope === "consolidated") setIndividualCompanyOverride(null);
                    else                          setConsolidatedCompanyOverride(null);
                    setViewScope(scope);
                  }}
                  valueMode={valueMode} onValueModeChange={setValueMode}
companies={visibleCompanies}
holdings={holdings}
selectedCompany={company}
                  onCompanyChange={(v) => {
                    if (viewScope === "consolidated") setConsolidatedCompanyOverride(v);
                    else                              setIndividualCompanyOverride(v);
                  }}
                  compareYear={compareYear} compareMonth={compareMonth}
                  onSelectCompare={(y, m) => { setCompareYear(y); setCompareMonth(m); setCompareTouched(true); }}
                  colors={colors}
                  onClose={() => setPickerOpen(false)}
                />
              )}
</div>

{/* Accounting standard — read-only, not part of the picker */}
            {detectedStandard && (
<div
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border"
                style={{ background: "#f9fafb", borderColor: "#f3f4f6" }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: `${colors.primary}50` }} />
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                  {detectedStandard}
                </span>
              </div>
            )}

</div>

          <style>{`
            @keyframes titleMorph {
              0%   { opacity: 0; transform: translateY(4px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            @keyframes kGreetingSlide {
              0%   { opacity: 0; transform: translateX(-12px); }
              100% { opacity: 1; transform: translateX(0); }
            }
            @keyframes kBadgesPop {
              0%   { opacity: 0; transform: translateY(6px); }
              100% { opacity: 1; transform: translateY(0); }
            }
@keyframes kPeriodSlide {
              0%   { opacity: 0; transform: translateX(12px); }
              100% { opacity: 1; transform: translateX(0); }
            }
            @keyframes kGreetWord {
              0%   { opacity: 0; transform: translateX(-18px); filter: blur(4px); }
              60%  { filter: blur(0px); }
              100% { opacity: 1; transform: translateX(0); filter: blur(0px); }
            }
            @keyframes kNamePop {
              0%   { opacity: 0; transform: translateY(10px) scale(0.92); }
              60%  { transform: translateY(-2px) scale(1.02); }
              100% { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
        </div>

{/* HERO KPIS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0" style={{ minHeight: 140 }}>
          {slottedKpis && kpiValues ? (
            kpiSlots.map((slotId, idx) => {
              const kpi  = slottedKpis[idx];
              const vals = kpiValues[idx];
              const sc   = SLOT_COLORS[idx];
              return (
                <div key={`slot-${idx}`} className="relative group/kpislot h-full"
                  onMouseEnter={() => setTrendFocus(idx)} onMouseLeave={() => setTrendFocus(null)}>
<HeroKPI
                    label={kpi?.label ?? slotId}
                    value={vals?.current ?? 0}
                    prevValue={vals?.prev ?? 0}
                    trend={sparklines[idx] ?? []}
color={sc.color}
                    accent={sc.accent}
                    icon={sc.icon}
                    loading={loading}
                    noData={noPeriodData}
                    delay={idx * 0.06}
                  />

                  {/* Settings gear — appears on hover */}
<button
                    onClick={e => { e.stopPropagation(); setEditingSlot(editingSlot === idx ? null : idx); }}
                    className="absolute top-2.5 right-2.5 z-20 w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-200 opacity-0 group-hover/kpislot:opacity-100 hover:!opacity-100"
                    style={{
                      background: "rgba(255,255,255,0.18)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      opacity: editingSlot === idx ? "1" : undefined,
                    }}
                    title="Change KPI"
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.32)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                  >
                    <Settings size={11} className="text-white" />
                  </button>

                  {/* The group hover trick — make gear visible when card is hovered */}
                  <style>{`
                    .group\\/kpislot:hover .kpi-gear-${idx} { opacity: 1 !important; }
                  `}</style>

                  {/* KPI selector popover */}
                  {editingSlot === idx && (
                    <KpiSelectorPopover
                      kpiList={kpiList}
                      currentId={slotId}
                      slotColor={sc.color}
                      onSelect={id => updateSlot(idx, id)}
                      onClose={() => setEditingSlot(null)}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <div className="col-span-full bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-100 p-6 text-center">
              {!resolverReady || probing ? (
                <><Loader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: colors.primary }} />
                <p className="text-gray-500 font-semibold text-xs">
                  {probing ? t("home_probing") : t("home_detecting")}
                </p></>
              ) : (
                <><Sparkles size={24} className="mx-auto mb-2 text-gray-300" />
                <p className="text-gray-500 font-semibold text-xs">
                  {!groupAccounts.length ? t("home_waiting_accounts") : t("home_unknown_standard")}
                </p></>
              )}
            </div>
          )}
        </div>

{/* MIDDLE */}
        <div className={`grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-0 transition-all duration-300 ${middleCardView === "ranking" ? "flex-1" : "flex-1"}`}>
<div className="hpCard lg:col-span-3 overflow-hidden px-5 pt-4 pb-3 flex flex-col" style={{ animationDelay: "0.18s" }}>
            {middleCardView === "ranking" ? (() => {
              const rows = topByRevenue;
              const max = Math.max(0, ...rows.map(r => r.value));
              const sum = rows.reduce((acc, r) => acc + Math.max(0, r.value), 0);
              const avg = rows.length ? rows.reduce((acc, r) => acc + r.value, 0) / rows.length : 0;
              const top3 = rows.slice(0, 3).reduce((acc, r) => acc + Math.max(0, r.value), 0);
              const leader = rows[0];
              const prevSum = rows.every(r => r.prev != null) ? rows.reduce((acc, r) => acc + (r.prev ?? 0), 0) : null;
              const sumDelta = prevSum && Math.abs(prevSum) > 0.005 ? ((sum - prevSum) / Math.abs(prevSum)) * 100 : null;
              const shade = (i) => `color-mix(in srgb, var(--hp-p) ${Math.max(8, 52 - i * (rows.length > 1 ? 44 / (rows.length - 1) : 0))}%, #a9c2ff)`;
              const avgPct = max > 0 ? Math.max(0, Math.min(100, (avg / max) * 100)) : 0;
              const RANK_IDS = ["revenue", "gross_profit", "ebitda", "ebit", "net_result"];
              const rankKpis = RANK_IDS.map(id => kpiList.find(k => k.id === id)).filter(Boolean);
              if (!RANK_IDS.includes(rankingKpiId)) {
                const cur = kpiList.find(k => k.id === rankingKpiId);
                if (cur) rankKpis.push(cur);
              }
              const initialsOf = (name) => String(name).replace(/[^A-Za-zÀ-ÿ0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase();
              return (
              <>
                {/* Cabecera */}
                <div className="mb-3 flex-shrink-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button type="button" onClick={() => setMiddleCardView("trend")} className="hpBack">
                      <ChevronRight size={13} style={{ transform: "rotate(180deg)" }} />
                      {t("back")}
                    </button>
                    <div className="min-w-0">
                      <h3 className="hpTitle">{t("home_ranking")}</h3>
                      <p className="hpMeta truncate">
                        {rows.length} {rows.length === 1 ? t("rank_entry") : t("rank_entries")} · {periodLabel}
                        {compareLabel && compareLabel !== "—" ? ` vs ${compareLabel}` : ""}
                      </p>
                    </div>
                  </div>
                  {rankKpis.length > 1 && (
                    <div className="hpSegm flex-shrink-0" role="tablist" aria-label={t("rank_by")}>
                      {rankKpis.map(k => (
                        <button key={k.id} type="button" role="tab" aria-selected={k.id === rankingKpiId}
                          className={k.id === rankingKpiId ? "on" : ""}
                          onClick={() => setRankingKpiId(k.id)}>
                          {k.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cifras clave */}
                <div className="hpRkStats flex-shrink-0">
                  <div className="hpRkStat">
                    <span>{t("rank_group_total", "Total del grupo")}</span>
                    <b>{fmtBig(sum)}</b>
                    {sumDelta != null && (
                      <em className={sumDelta >= 0 ? "isUp" : "isDown"}>
                        {sumDelta >= 0 ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />}
                        {Math.abs(sumDelta).toFixed(1)}%
                      </em>
                    )}
                  </div>
                  <div className="hpRkStat">
                    <span>{t("rank_leader", "Líder")}</span>
                    <b className="truncate" title={leader ? (entityLegalName.get(leader.name) ?? leader.name) : ""}>{leader?.name ?? "—"}</b>
                    {leader && sum > 0 && <em className="isNeutral">{((Math.max(0, leader.value) / sum) * 100).toFixed(1)}%</em>}
                  </div>
                  <div className="hpRkStat">
                    <span>{t("rank_top3_share", "Concentración top 3")}</span>
                    <b>{sum > 0 ? `${((top3 / sum) * 100).toFixed(0)}%` : "—"}</b>
                    <i className="hpRkMini"><span style={{ width: `${sum > 0 ? (top3 / sum) * 100 : 0}%` }} /></i>
                  </div>
                  <div className="hpRkStat">
                    <span>{t("rank_average", "Media por sociedad")}</span>
                    <b>{fmtBig(avg)}</b>
                  </div>
                </div>

                {/* Cuota de cada sociedad en una sola barra */}
                {sum > 0 && (
                  <div className="hpRkStrip flex-shrink-0" onMouseLeave={() => setRankHover(null)}>
                    {rows.map((r, i) => r.value > 0 && (
                      <span key={r.name} style={{ flexGrow: r.value, background: shade(i), opacity: rankHover == null || rankHover === i ? 1 : 0.3 }}
                        title={`${r.name} · ${((r.value / sum) * 100).toFixed(1)}%`}
                        onMouseEnter={() => setRankHover(i)} />
                    ))}
                  </div>
                )}

                {/* Lista */}
                <div className="hpRkHead flex-shrink-0">
                  <span>#</span>
                  <span>{t("rank_entity", "Sociedad")}</span>
                  <span><i className="hpRkAvgKey" />{t("rank_avg_marker", "Media")}</span>
                  <span>{t("rank_share", "Cuota")}</span>
                  <span>{t("rank_vs_compare", "vs comparativo")}</span>
                  <span>{rankingKpiLabel}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar -mx-2 px-2" onMouseLeave={() => setRankHover(null)}
                  style={{ "--rk-pad": rows.length <= 6 ? "12px" : rows.length <= 10 ? "8px" : "6px" }}>
                  {rows.map((c, i) => {
                    const pct = max > 0 ? Math.max(0, (c.value / max) * 100) : 0;
                    const share = sum > 0 ? (Math.max(0, c.value) / sum) * 100 : 0;
                    const delta = c.prev != null && Math.abs(c.prev) > 0.005 ? ((c.value - c.prev) / Math.abs(c.prev)) * 100 : null;
                    const legal = entityLegalName.get(c.name);
                    return (
                      <div key={c.name} className={`hpRkRow ${rankHover === i ? "isHover" : rankHover != null ? "isDim" : ""}`}
                        style={{ animationDelay: `${Math.min(i, 14) * 0.035}s` }}
                        onMouseEnter={() => setRankHover(i)}>
                        <span className={`hpRankN ${i === 0 ? "isFirst" : i < 3 ? "" : "isMuted"}`}>{i + 1}</span>
                        <div className="hpRkWho">
                          <span className="hpAvatarCo">{initialsOf(c.name)}</span>
                          <div className="min-w-0">
                            <p className="hpRankName" title={legal ?? c.name}>{c.name}</p>
                            {legal && legal !== c.name && <p className="hpRkLegal" title={legal}>{legal}</p>}
                          </div>
                        </div>
                        <div className="hpRkBar">
                          <div className="hpTrack" style={{ height: 10 }}>
                            <span style={{ width: `${pct}%`, background: shade(i), animationDelay: `${0.1 + Math.min(i, 14) * 0.035}s` }} />
                          </div>
                          <i className="hpRkAvg" style={{ left: `${avgPct}%` }} />
                        </div>
                        <span className="hpRankShare">{share.toFixed(1)}%</span>
                        <span className="hpRkDelta">
                          {delta != null ? (
                            <span className={`hpChg ${delta >= 0 ? "isGood" : "isBad"}`}>
                              {delta >= 0 ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />}
                              {Math.abs(delta).toFixed(1)}%
                            </span>
                          ) : <span className="hpMeta">—</span>}
                        </span>
                        <span className="hpRankVal">{fmtBig(c.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
              );
            })() : middleCardView === "tag_drill" && drillTag ? (
              <>
                <div className="mb-3 flex-shrink-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button type="button" onClick={() => { setMiddleCardView("trend"); setDrillTag(null); }} className="hpBack">
                      <ChevronRight size={13} style={{ transform: "rotate(180deg)" }} />
                      {t("drill_back")}
                    </button>
                    <h3 className="hpTitle truncate">{drillStats?.label ?? drillTag}</h3>
                    <p className="hpMeta whitespace-nowrap">{drillAccountBreakdown.length} {t("drill_accounts")}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
<div className="flex flex-col items-end">
<span className="text-[11px] font-bold text-gray-400">{t("drill_monthly")}</span>
                      <span className="text-[15px] font-black text-gray-900 tabular-nums tracking-tight">
                        <AnimatedNumber value={drillStats?.monthlyValue ?? 0} />
                      </span>
                    </div>
                    {drillStats?.monthlyChange != null && (
                      <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                        (drillStats.isIncome ? drillStats.monthlyChange > 0 : drillStats.monthlyChange < 0)
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      }`}>
                        {drillStats.monthlyChange > 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                        {Math.abs(drillStats.monthlyChange).toFixed(1)}%
                      </div>
                    )}
                    <div style={{ width: 1, height: 24, background: "rgba(0,0,0,0.08)" }} />
<div className="flex flex-col items-end">
<span className="text-[11px] font-bold text-gray-400">{t("drill_ytd_vs_py")}</span>
                      <span className="text-[15px] font-black text-gray-900 tabular-nums tracking-tight">
                        <AnimatedNumber value={drillStats?.ytdCurrent ?? 0} />
                      </span>
                    </div>
                    {drillStats?.yoyChange != null && (
                      <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                        (drillStats.isIncome ? drillStats.yoyChange > 0 : drillStats.yoyChange < 0)
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      }`}>
                        {drillStats.yoyChange > 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                        {Math.abs(drillStats.yoyChange).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>

<div key={`drill-${drillTag}`} className="flex-1 min-h-0 grid grid-cols-5 gap-4" style={{ animation: "drillFadeIn 0.4s cubic-bezier(0.4,0,0.2,1) both" }}>
                  <div className="col-span-3 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between mb-1">
<p className="text-[12px] font-extrabold text-gray-500">
                        {t("drill_monthly_evolution")}
                      </p>
                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-sm" style={{ background: "#9ca3af", opacity: 0.4 }} />
                          <span className="text-[9px] font-bold text-gray-400">{Number(year) - 1}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-sm" style={{ background: drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a") }} />
                          <span className="text-[9px] font-bold" style={{ color: drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a") }}>{year}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0">
                      {drillTimeSeries.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={drillTimeSeries} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} barCategoryGap="18%">
                            <defs>
                              <linearGradient id="drillBarCur" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a")} stopOpacity={1} />
                                <stop offset="100%" stopColor={drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a")} stopOpacity={0.65} />
                              </linearGradient>
                              <linearGradient id="drillBarCurActive" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%"  stopColor={drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.secondary ?? "#CF305D")} stopOpacity={1} />
                                <stop offset="100%" stopColor={drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a")} stopOpacity={0.85} />
                              </linearGradient>
                              <linearGradient id="drillBarPrior" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#9ca3af" stopOpacity={0.45} />
                                <stop offset="100%" stopColor="#9ca3af" stopOpacity={0.18} />
                              </linearGradient>
                              <filter id="drillGlow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge>
                                  <feMergeNode in="blur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            </defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" vertical={false} />
                            <XAxis dataKey="label"
                              tick={(props) => {
                                const { x, y, payload } = props;
                                const isActive = payload.value === MONTHS_ABBR[Number(month) - 1];
                                return (
                                  <text x={x} y={y + 14} textAnchor="middle"
                                    fontSize={isActive ? 11 : 10}
                                    fontWeight={isActive ? 900 : 700}
                                    fill={isActive ? (colors.primary ?? "#1a2f8a") : "#6b7280"}>
                                    {payload.value}
                                  </text>
                                );
                              }}
                              axisLine={false} tickLine={false} />
                            <YAxis
                              tick={{ fontSize: 9, fill: "#9ca3af", fontWeight: 600 }}
                              axisLine={false} tickLine={false}
                              tickFormatter={fmtBig} width={42} />
                            <Tooltip cursor={{ fill: "rgba(0,0,0,0.025)" }} content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              const cur = payload.find(p => p.dataKey === "current")?.value;
                              const pri = payload.find(p => p.dataKey === "prior")?.value;
                              let yoy = null;
                              if (cur != null && pri != null && Math.abs(pri) > 0.005) yoy = ((cur - pri) / Math.abs(pri)) * 100;
return (
                                <div className="rounded-xl border border-gray-200 px-3 py-2 text-xs"
                                  style={{
                                    background: "#ffffff",
                                    boxShadow: "0 8px 24px -6px rgba(15,23,42,0.18), 0 2px 6px -2px rgba(15,23,42,0.08)",
                                  }}>
                                  <p className="font-black text-gray-800 mb-1.5">{label}</p>
                                  {payload.map((p, i) => (
                                    <div key={i} className="flex items-center gap-2 py-0.5">
                                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                                      <span className="text-gray-500 font-medium">{p.name}:</span>
                                      <span className="font-black text-gray-800 ml-auto tabular-nums">{p.value != null ? fmtBig(p.value) : "—"}</span>
                                    </div>
                                  ))}
                                  {yoy != null && (
                                    <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex items-center justify-between">
                                      <span className="text-[10px] font-bold text-gray-500">YoY</span>
                                      <span className={`text-[10px] font-black ${yoy >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            }} />
                            <Bar dataKey="prior"   name={`${Number(year) - 1}`} fill="url(#drillBarPrior)" radius={[4, 4, 0, 0]} animationDuration={700} animationBegin={0} />
                            <Bar dataKey="current" name={`${year}`}             radius={[4, 4, 0, 0]} animationDuration={900} animationBegin={150}
                              shape={(props) => {
                                const { x, y, width, height, payload } = props;
                                const isActive = payload.month === Number(month);
                                if (y == null || height == null) return null;
                                return (
                                  <g>
                                    {isActive && (
                                      <rect x={x - 2} y={y - 4} width={width + 4} height={height + 4}
                                        rx={5} fill="none"
                                        stroke={drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.secondary ?? "#CF305D")}
                                        strokeWidth={1.5} strokeDasharray="3 2" opacity={0.6} />
                                    )}
                                    <rect x={x} y={y} width={width} height={height}
                                      rx={4}
                                      fill={isActive ? "url(#drillBarCurActive)" : "url(#drillBarCur)"}
                                      filter={isActive ? "url(#drillGlow)" : undefined} />
                                  </g>
                                );
                              }} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-300 text-xs">
                          <Loader2 size={20} className="animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
<div className="col-span-2 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between mb-1.5">
<p className="text-[12px] font-extrabold text-gray-500">
                        {t("drill_top_accounts")}
                      </p>
<span className="text-[8px] font-bold text-gray-300">
                        {drillAccountBreakdown.length} {t("drill_of")} {
                          activeCustomStructure
                            ? (activeCustomStructure.items?.find(g => g.id === drillTag)?.lines?.length ?? 0)
                            : (ccTagToCodes.get(drillTag) ?? []).length
                        }
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar space-y-2 pr-1">
                      {drillAccountBreakdown.length === 0 ? (
                       <p className="text-xs text-gray-300 text-center py-4">{t("drill_no_accounts")}</p>
                      ) : (
                        drillAccountBreakdown.map((row, i) => {
const maxAbs = Math.max(...drillAccountBreakdown.map(r => Math.abs(r.value)));
                          const pct = maxAbs > 0 ? (Math.abs(row.value) / maxAbs) * 100 : 0;
                          const drillGroup = activeCustomStructure?.items?.find(g => g.id === drillTag);
                          const barColor = drillGroup
                            ? (drillGroup.color ?? colors.primary)
                            : drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : costColors[i % costColors.length];
                          const changeIsGood = drillStats?.isIncome ? row.change > 0 : row.change < 0;
                          const changeColor = row.change == null ? "text-gray-300" : changeIsGood ? "text-emerald-500" : "text-red-500";
                          return (
                            <div key={row.code}
                              className="flex flex-col gap-0.5 group/acct cursor-default px-1 -mx-1 py-0.5 rounded-md transition-colors hover:bg-gray-50/70"
                              style={{ animation: `acctSlide 0.5s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.04}s both` }}>
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <div className="flex flex-col min-w-0">
                                  <span className="font-bold text-gray-700 truncate" title={row.name}>{row.name}</span>
                                  <span className="text-[8px] font-mono text-gray-400">{row.code}</span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className="font-black text-gray-900 tabular-nums group-hover/acct:scale-110 transition-transform inline-block origin-right">{fmtBig(row.value)}</span>
                                  {row.change != null && (
                                    <span className={`font-black tabular-nums ${changeColor}`} style={{ fontSize: 9 }}>
                                      {row.change > 0 ? "+" : ""}{row.change.toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden relative">
                                <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 group-hover/acct:brightness-110"
                                  style={{
                                    width: `${pct}%`,
                                    background: `linear-gradient(90deg, ${barColor} 0%, ${barColor}dd 100%)`,
                                    boxShadow: `0 0 8px -2px ${barColor}80`,
                                    animation: `barGrow 0.9s cubic-bezier(0.4,0,0.2,1) ${i * 0.04 + 0.1}s both`,
                                  }} />
                              </div>
                            </div>
                          );
                        })
                      )}

                      {/* Concentration insight footer */}
                      {drillAccountBreakdown.length >= 3 && (() => {
                        const totalDrill = drillAccountBreakdown.reduce((s, r) => s + r.value, 0);
                        const top3 = drillAccountBreakdown.slice(0, 3).reduce((s, r) => s + r.value, 0);
                        const concentration = totalDrill > 0 ? (top3 / totalDrill) * 100 : 0;
                        return (
                          <div className="mt-2 pt-2 border-t border-gray-100"
                            style={{ animation: "acctSlide 0.6s ease-out 0.5s both" }}>
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-gray-500 font-bold">{t("drill_top3_concentration")}</span>
                              <span className="font-black tabular-nums" style={{ color: drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a") }}>
                                {concentration.toFixed(0)}%
                              </span>
                            </div>
                            <div className="mt-1 h-0.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-1000"
                                style={{
                                  width: `${concentration}%`,
                                  background: drillStats?.isIncome ? (colors.tertiary ?? "#57aa78") : (colors.primary ?? "#1a2f8a"),
                                  animation: "barGrow 1s cubic-bezier(0.4,0,0.2,1) 0.7s both",
                                }} />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
<div ref={trendHeaderRef} className="flex items-center justify-between mb-3 flex-shrink-0 gap-4">
              <div className="min-w-0">
                <h3 className="hpTitle">{t("home_kpi_evolution")}</h3>
                <p className="hpMeta mt-0.5 truncate">
                  {trendSeriesDisplay.length > 1
                    ? `${trendSeriesDisplay[0]?.fullLabel ?? ""} – ${trendSeriesDisplay[trendSeriesDisplay.length - 1]?.fullLabel ?? ""}`
                    : `${t("trend_from_jan")} ${trendFromYear ?? "…"}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="hpSegm" role="tablist" aria-label={t("trend_monthly")}>
                  {[
                    { value: "monthly",  label: t("trend_monthly") },
                    { value: "6months",  label: t("trend_6months") },
                    { value: "yearly",   label: t("trend_yearly") },
                  ].map(opt => (
                    <button key={opt.value} type="button" role="tab" aria-selected={trendInterval === opt.value}
                      className={trendInterval === opt.value ? "on" : ""}
                      onClick={() => setTrendInterval(opt.value)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="hpSegm" role="tablist" aria-label={t("trend_months")}>
                  {[12, 24, 36, 48].map(w => (
                    <button key={w} type="button" role="tab" aria-selected={trendWindow === w}
                      className={trendWindow === w ? "on" : ""} title={`${w} ${t("trend_months")}`}
                      onClick={() => setTrendWindow(w)}>
                      {w}M
                    </button>
                  ))}
                </div>
              </div>
            </div>

<div className="flex-1 hpChartWrap" style={{ minHeight: 200, width: "100%", position: "relative" }}
              data-focus={trendFocus ?? ""} data-fill={SLOT_COLORS.findIndex((_, k) => !trendHidden.has(k))}>
{/* Recargando con una gráfica ya pintada (otro periodo): aviso discreto encima */}
{trendLoading && prefsReady && trendSeriesDisplay.length > 1 && (
  <TrendRefreshBadge done={trendProgress.done} total={trendProgress.total} primary={colors.primary ?? "#1a2f8a"} secondary={colors.secondary ?? "#CF305D"} t={t} />
)}
{prefsReady && trendSeriesDisplay.length > 1 ? (
                <TrendChart data={trendSeriesDisplay} slotColors={SLOT_COLORS} labels={trendLabels} hidden={trendHidden} />
) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
                  {trendLoading || !prefsReady ? (
                    <TrendBuildingLoader done={trendProgress.done} total={trendProgress.total}
                      year={year} month={month} window={trendWindow} monthsAbbr={MONTHS_ABBR}
                      primary={colors.primary ?? "#1a2f8a"} secondary={colors.secondary ?? "#CF305D"} t={t} />
                  ) : (year && month) ? (
                    <>
                      <AlertTriangle size={20} className="text-amber-400" />
                      <p className="text-xs font-black text-gray-400">{t("home_period_no_data")}</p>
                      <p className="text-[10px] text-gray-300">{t("home_period_no_data_sub")}</p>
                    </>
                  ) : (
                    <span className="text-gray-300 text-xs">{t("home_no_trend")}</span>
                  )}
                </div>
              )}
            </div>
              </>
            )}
          </div>

          <div className="hpCard px-5 pt-4 pb-3 flex flex-col group/breakdown min-h-0" style={{ animationDelay: "0.26s" }}>

            {/* Header */}
            <div className="flex-shrink-0 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="hpTitle truncate">
                  {activeCustomStructure
                    ? (/^__.*__$/.test(String(activeCustomStructure.name ?? "").trim())
                        ? t("breakdown_standard_mapping", "Standard mapping")
                        : activeCustomStructure.name)
                    : activeView.label}
                </h3>
                <p className="hpMeta mt-0.5 truncate">
                  {activeCustomStructure ? (activeCustomStructure.description || "Custom breakdown") : activeView.description}
                </p>
              </div>
              <div className="relative flex-shrink-0" ref={breakdownSettingsRef} style={{ overflow: "visible", zIndex: 10 }}>
                <button type="button"
                  onClick={() => setBreakdownSettingsOpen(o => !o)}
                  className={`hpIconBtn ${breakdownSettingsOpen ? "isOpen" : ""}`}
                  aria-label={t("breakdown_view_label")}
                >
                  <Settings size={14} />
                </button>
                {breakdownSettingsOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 z-[500] rounded-2xl p-2 flex flex-col gap-1"
                    style={{
                      width: 250,
                      background: "#fff",
                      border: "1px solid rgba(15,23,42,0.06)",
                      boxShadow: "0 24px 50px -18px rgba(26,47,138,0.35)",
                      animation: "pickerFoldDown 320ms cubic-bezier(0.34,1.56,0.64,1)",
                      transformOrigin: "top center",
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-[11px] font-bold text-gray-400 px-2 pt-1 pb-0.5">{t("breakdown_view_label")}</p>
                    {BREAKDOWN_VIEWS.map((v) => {
                      const active = v.id === activeBreakdownView;
                      return (
                        <button key={v.id} type="button"
                          onClick={() => { setActiveBreakdownView(v.id); setBreakdownSettingsOpen(false); }}
                          className="flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors w-full hover:bg-gray-50"
                          style={{ background: active ? colors.primary : undefined }}>
                          <span className="text-base leading-none">{v.icon}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-black truncate" style={{ color: active ? "#fff" : "#1e293b" }}>{v.label}</p>
                            <p className="text-[10.5px] truncate mt-0.5" style={{ color: active ? "rgba(255,255,255,0.7)" : "#94a3b8" }}>{v.description}</p>
                          </div>
                        </button>
                      );
                    })}
                    <div className="mt-1 pt-1 border-t border-gray-100">
                      <button type="button"
                        onClick={() => { setBreakdownLibraryOpen(true); setBreakdownSettingsOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors hover:bg-gray-50">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${colors.primary}14`, color: colors.primary }}>
                          <Layers size={12} />
                        </div>
                        <p className="text-xs font-black" style={{ color: colors.primary }}>{t("breakdown_custom_label")}</p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {costBreakdown.length > 0 ? (() => {
              const absTot = Math.abs(totalCosts);
              const items = costBreakdown.map((c, i) => ({
                ...c,
                color: activeCustomStructure
                  ? (c.groupColor ?? colors.primary)
                  : c.isIncome ? (colors.tertiary ?? "#57aa78") : costColors[i % costColors.length],
              }));
              const pick = (c) => {
                const isActive = drillTag === c.tag && middleCardView === "tag_drill";
                if (isActive) { setMiddleCardView("trend"); setDrillTag(null); }
                else          { setDrillTag(c.tag); setMiddleCardView("tag_drill"); }
              };
              return (
                <>
                  <BreakdownDonut items={items} total={totalCosts} hover={bdHover} onHover={setBdHover}
                    onPick={(i) => items[i] && pick(items[i])} centerLabel={t("cost_total")} />
                  <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar px-2.5 -mx-2.5">
                    {items.map((c, i) => {
                      const pct = absTot > 0 ? (Math.abs(c.value) / absTot) * 100 : 0;
                      const changeIsGood = c.isIncome ? c.change > 0 : c.change < 0;
                      const isActive = drillTag === c.tag && middleCardView === "tag_drill";
                      return (
                        <div key={`${activeBreakdownView}-${c.tag}`}
                          role="button" tabIndex={0}
                          onClick={() => pick(c)}
                          onKeyDown={e => { if (e.key === "Enter") pick(c); }}
                          onMouseEnter={() => setBdHover(i)} onMouseLeave={() => setBdHover(null)}
                          className={`hpBdRow ${isActive ? "isActive" : ""} ${bdHover === i ? "isHover" : bdHover != null ? "isDim" : ""}`}
                          style={{ "--bc": c.color, animationDelay: `${0.3 + i * 0.04}s` }}
                        >
                          <span className="hpBdSw" />
                          <span className="hpBdName" title={c.name}>{c.name}</span>
                          <span className="hpBdVal">{fmtBig(Math.abs(c.value))}</span>
                          <span className="hpBdPct">{pct.toFixed(1)}%</span>
                          {c.change != null ? (
                            <span className={`hpChg ${changeIsGood ? "isGood" : "isBad"}`}>
                              {c.change > 0 ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />}
                              {Math.abs(c.change).toFixed(1)}%
                            </span>
                          ) : <span />}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })() : (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-4">
                {loading ? (
                  <Loader2 size={20} className="animate-spin text-gray-300" />
                ) : noPeriodData ? (
                  <>
                    <AlertTriangle size={20} className="text-amber-400" />
                    <p className="text-xs font-black text-gray-400">{t("home_period_no_data")}</p>
                    <p className="text-[11px] text-gray-300">{t("home_period_no_data_sub")}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-black text-gray-400">
                      {activeCustomStructure ? t("breakdown_no_data") : t("home_no_costs")}
                    </p>
                    {activeCustomStructure && (
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        {t("breakdown_no_data_hint_1")} {periodLabel}. {t("breakdown_no_data_hint_2")}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

{/* BOTTOM — collapses smoothly when ranking expands into middle card */}
     <div
       className="grid grid-cols-1 lg:grid-cols-4 gap-3 flex-shrink-0 transition-all duration-500 ease-in-out"
       style={{
         minHeight: middleCardView === "ranking" ? 0 : 150,
         maxHeight: middleCardView === "ranking" ? 0 : 160,
         opacity:   middleCardView === "ranking" ? 0 : 1,
         marginTop: middleCardView === "ranking" ? "-0.75rem" : 0,
         pointerEvents: middleCardView === "ranking" ? "none" : "auto",
         overflow:  middleCardView === "ranking" ? "hidden" : "visible",
         paddingBottom: middleCardView === "ranking" ? 0 : 8,
       }}>
<div
            onClick={() => !rankingSelectorOpen && topByRevenue.length > 0 && setMiddleCardView(v => v === "ranking" ? "trend" : "ranking")}
            ref={rankingSelectorRef}
            className="hpCard lg:col-span-3 overflow-hidden px-5 pt-3.5 pb-3.5 flex flex-col text-left group/ranking"
            style={{
              animationDelay: "0.34s",
              cursor: !rankingSelectorOpen && topByRevenue.length > 0 ? "pointer" : "default",
            }}>
{!rankingSelectorOpen && (
              <div className="mb-2.5 flex-shrink-0 flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-3 min-w-0">
                  <h3 className="hpTitle">{t("home_ranking")}</h3>
                  <p className="hpMeta truncate">
                    {t("rank_by")} {rankingKpiLabel}
                    {topByRevenue.length === 0 ? ` · ${t("rank_no_data")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {allCoLoading && <Loader2 size={13} className="animate-spin text-gray-300" />}
                  {topByRevenue.length > 0 && (
                    <span className="hpLink">
                      {t("rank_click_expand")} <ChevronRight size={13} />
                    </span>
                  )}
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setRankingSelectorOpen(true); }}
                    className="hpIconBtn"
                    aria-label={t("rank_by")}
                  >
                    <Settings size={14} />
                  </button>
                </div>
              </div>
            )}

{rankingSelectorOpen ? (
              <div className="flex-1 min-h-0" onClick={e => e.stopPropagation()}>
                <div className="grid grid-cols-5 gap-3 w-full h-full">
                  {(() => {
                    const TOP_IDS = ["revenue", "gross_profit", "ebitda", "ebit", "net_result"];
                    const PRESET_ICONS = [DollarSign, Target, Activity, TrendingUp, Wallet];
                    const PRESET_COLORS = [
                      colors.primary ?? "#1a2f8a",
                      "#0891b2",
                      colors.tertiary ?? "#57aa78",
                      "#d97706",
                      NI_COLOR,
                    ];
                    const cards = TOP_IDS
                      .map(id => kpiList.find(k => k.id === id))
                      .filter(Boolean);
                    // If the active KPI isn't in top 5, append it so user sees it highlighted
                    if (!TOP_IDS.includes(rankingKpiId)) {
                      const active = kpiList.find(k => k.id === rankingKpiId);
                      if (active) cards.push(active);
                    }
                    return cards.slice(0, 5).map((k, i) => {
                      const active = k.id === rankingKpiId;
                      const cardColor = PRESET_COLORS[i] ?? colors.primary;
                      const Icon = PRESET_ICONS[i] ?? Sparkles;
                      return (
                        <button
                          key={k.id}
                          onClick={(e) => { e.stopPropagation(); setRankingKpiId(k.id); setRankingSelectorOpen(false); }}
                          className="relative overflow-hidden rounded-2xl p-4 flex flex-col justify-between transition-all hover:scale-[1.03] hover:shadow-xl text-left"
                          style={{
                            height: "100%",
                            minHeight: 110,
                            background: active
                              ? `linear-gradient(135deg, ${cardColor}f0 0%, ${cardColor} 100%)`
                              : "rgba(255,255,255,0.6)",
                            border: `1px solid ${active ? cardColor : `${cardColor}30`}`,
                            boxShadow: active
                              ? `0 12px 28px -8px ${cardColor}80, 0 2px 6px -2px ${cardColor}50`
                              : `0 2px 8px -2px ${cardColor}15`,
                            animation: `kCardEntry 0.35s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.05}s both`,
                          }}
                        >
                          {/* Decorative blob */}
                          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-20 blur-2xl"
                            style={{ background: active ? "rgba(255,255,255,0.6)" : cardColor }} />

                          <div className="relative flex items-start justify-between">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                              style={{
                                background: active ? "rgba(255,255,255,0.2)" : `${cardColor}15`,
                                border: `1px solid ${active ? "rgba(255,255,255,0.25)" : `${cardColor}25`}`,
                              }}>
                              <Icon size={14} style={{ color: active ? "#fff" : cardColor }} />
                            </div>
                            {active && (
                              <div className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center flex-shrink-0">
                                <div className="w-1.5 h-1.5 rounded-full bg-white" />
                              </div>
                            )}
                          </div>

                          <div className="relative">
                            <p className="text-[13px] font-black leading-tight tracking-tight"
                              style={{ color: active ? "#fff" : "#374151" }}>
                              {k.label}
                            </p>
<p className="text-[9px] font-bold uppercase tracking-[0.18em] mt-1.5"
                              style={{ color: active ? "rgba(255,255,255,0.7)" : `${cardColor}aa` }}>
                              {k.category ?? t("kpi_metric")}
                            </p>
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : (
<div className="hpPodium">
                {topByRevenue.length > 0 ? (() => {
                  const max = topByRevenue[0].value;
                  const sum = topByRevenue.reduce((acc, r) => acc + Math.max(0, r.value), 0);
                  return topByRevenue.slice(0, 3).map((c, i) => {
                    const pct = max > 0 ? (c.value / max) * 100 : 0;
                    const share = sum > 0 ? (Math.max(0, c.value) / sum) * 100 : 0;
                    return (
                      <div key={c.name} className={`hpPod ${i === 0 ? "isFirst" : ""}`} style={{ animationDelay: `${0.4 + i * 0.06}s` }}>
                        <div className="hpPodTop">
                          <span className={`hpRankN ${i === 0 ? "isFirst" : ""}`}>{i + 1}</span>
                          <span className="hpPodName" title={c.name}>{c.name}</span>
                        </div>
                        <span className="hpPodVal">{fmtBig(c.value)}</span>
                        <div className="hpPodFoot">
                          <div className="hpTrack"><span style={{ width: `${pct}%`, animationDelay: `${0.5 + i * 0.06}s` }} /></div>
                          <span>{share.toFixed(0)}%</span>
                        </div>
                      </div>
                    );
                  });
                })() : (
                  <div className="col-span-3 flex items-center justify-center h-full text-gray-300 text-xs">
                    {allCoLoading ? <Loader2 size={20} className="animate-spin" /> : t("no_data")}
                  </div>
                )}
              </div>
            )}
          </div>

<div className="grid grid-cols-2 gap-3">
            <MiniTile label={t("mini_companies")}  value={companies.length}  icon={Building2} color={colors.primary}                delay={0.55} onClick={() => setOpenDetail("companies")}  />
            <MiniTile label={t("mini_perimeters")} value={structures.length} icon={Layers}    color={colors.secondary  ?? "#CF305D"} delay={0.6}  onClick={() => setOpenDetail("structures")} />
            <MiniTile label={t("mini_dimensions")} value={dimensions.length} icon={Network}   color={colors.tertiary   ?? "#57aa78"} delay={0.65} onClick={() => setOpenDetail("dimensions")} />
            <MiniTile label={t("mini_sources")}    value={sources.length}    icon={Database}  color={NI_COLOR}                       delay={0.7}  onClick={() => setOpenDetail("sources")}    />
          </div>
        </div>
</div>
</div>



{openDetail === "companies" && (
        <DetailPopup
          title={t("mini_companies")}
          items={companies}
          icon={Building2}
          color={colors.primary}
          onClose={() => setOpenDetail(null)}
          renderItem={(c) => {
            const shortName = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? String(c)) : String(c);
            const legalName = typeof c === "object" ? (c.CompanyLegalName ?? c.companyLegalName ?? shortName) : shortName;
            return (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{legalName}</p>
                  <p className="text-[10px] font-mono text-gray-400 mt-0.5">{shortName}</p>
                </div>
              </div>
            );
          }}
        />
      )}
      {openDetail === "structures" && (
        <DetailPopup
          title={t("mini_perimeters")}
          items={structures}
          icon={Layers}
          color={colors.secondary ?? "#CF305D"}
          onClose={() => setOpenDetail(null)}
          renderItem={(s) => {
            const name = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? String(s)) : String(s);
            return <p className="text-sm font-bold text-gray-800">{name}</p>;
          }}
        />
      )}
      {openDetail === "dimensions" && (
        <DetailPopup
          title={t("mini_dimensions")}
          items={dimensions}
          icon={Network}
          color={colors.tertiary ?? "#57aa78"}
          onClose={() => setOpenDetail(null)}
          renderItem={(d) => {
            const name = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? String(d)) : String(d);
            const code = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : "";
            return (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-gray-800 truncate">{name}</p>
                {code && <p className="text-[10px] font-mono text-gray-400 flex-shrink-0">{code}</p>}
              </div>
            );
          }}
        />
      )}
{openDetail === "sources" && (
        <DetailPopup
          title={t("mini_sources")}
          items={sources}
          icon={Database}
          color={NI_COLOR}
          onClose={() => setOpenDetail(null)}
          renderItem={(s) => {
            const name = typeof s === "object" ? (s.source ?? s.Source ?? String(s)) : String(s);
            return <p className="text-sm font-bold text-gray-800">{name}</p>;
          }}
        />
      )}

{breakdownLibraryOpen && (
        <BreakdownLibraryModal
          structures={customStructures}
          activeViewId={activeBreakdownView}
          defaultViewId={defaultViewId}
          colors={colors}
          onApply={(id) => setActiveBreakdownView(id)}
          onSetDefault={async (id) => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const uid = session?.user?.id ?? userId;
              let cid = settingsCompanyId;
              if (!cid) {
                const { data: ucRow } = await supabase
                  .schema("accounts").from("user_companies")
                  .select("company_id").eq("user_id", uid).eq("is_active", true)
                  .order("is_default", { ascending: false }).limit(1).maybeSingle();
                cid = ucRow?.company_id ?? null;
              }
              await saveBreakdownPreference({ userId: uid, companyId: cid, activeViewId: id ?? "cost_structure" });
              setDefaultViewId(id);
            } catch (e) { alert(`Could not save default: ${e.message}`); }
          }}
onEdit={(s) => { setBreakdownLibraryOpen(false); setEditingStructure(s); }}
          onDelete={async (id) => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const uid = session?.user?.id ?? userId;
              let cid = settingsCompanyId;
              if (!cid) {
                const { data: ucRow } = await supabase
                  .schema("accounts").from("user_companies")
                  .select("company_id").eq("user_id", uid).eq("is_active", true)
                  .order("is_default", { ascending: false }).limit(1).maybeSingle();
                cid = ucRow?.company_id ?? null;
              }
              await archiveBreakdownStructure({ id, userId: uid });
              const all = await listBreakdownStructures({ companyId: cid });
              setCustomStructures(all ?? []);
              if (activeBreakdownView === id) setActiveBreakdownView("cost_structure");
              if (defaultViewId === id) setDefaultViewId(null);
            } catch (e) { alert(`Could not delete: ${e.message}`); }
          }}
          onCreate={() => { setBreakdownLibraryOpen(false); setEditingStructure("new"); }}
          onClose={() => setBreakdownLibraryOpen(false)}
        />
      )}

      {editingStructure !== null && (
<BreakdownBuilderModal
          structure={editingStructure === "new" ? null : editingStructure}
          groupAccounts={groupAccounts}
          currentPivot={rawCurrentMonthlyPivot}
          colors={colors}
onSave={async (data) => {
            try {
              // Get session directly — context userId can be null during first render
const { data: { session } } = await supabase.auth.getSession();
              const uid = session?.user?.id ?? userId;
              if (!uid) { alert("User session not found — please log in again."); return; }

              // settingsCompanyId may not be ready yet — resolve directly if needed
              let cid = settingsCompanyId;
              if (!cid) {
                const { data: ucRow } = await supabase
                  .schema("accounts")
                  .from("user_companies")
                  .select("company_id")
                  .eq("user_id", uid)
                  .eq("is_active", true)
                  .order("is_default", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                cid = ucRow?.company_id ?? null;
              }
              if (!cid) { alert("Could not resolve company — please reload the page."); return; }

if (editingStructure === "new") {
                const created = await createBreakdownStructure({ companyId: cid, userId: uid, ...data });
                if (!created?.id) throw new Error("Server returned no data — check the Supabase table exists and RLS is enabled.");
                // Small wait to ensure Supabase read-after-write consistency
await new Promise(r => setTimeout(r, 300));
                const all = await loadStructuresWithNames(cid);
                setCustomStructures(all ?? []);
                setActiveBreakdownView(created.id);
              } else {
                const updated = await updateBreakdownStructure({ id: editingStructure.id, userId: uid, ...data });
                if (!updated?.id) throw new Error("Server returned no data.");
                await new Promise(r => setTimeout(r, 300));
                const all = await loadStructuresWithNames(cid);
                setCustomStructures(all ?? []);
              }
setEditingStructure(null);
              setBreakdownLibraryOpen(true);
            } catch (e) {
              alert(`Could not save breakdown:\n\n${e.message}`);
            }
          }}
onDelete={editingStructure === "new" ? null : async () => {
            try {
const { data: { session } } = await supabase.auth.getSession();
              const uid = session?.user?.id ?? userId;
              let cid = settingsCompanyId;
              if (!cid) {
                const { data: ucRow } = await supabase
                  .schema("accounts")
                  .from("user_companies")
                  .select("company_id")
                  .eq("user_id", uid)
                  .eq("is_active", true)
                  .order("is_default", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                cid = ucRow?.company_id ?? null;
              }
              await archiveBreakdownStructure({ id: editingStructure.id, userId: uid });
              const all = await listBreakdownStructures({ companyId: cid });
              setCustomStructures(all ?? []);
              if (activeBreakdownView === editingStructure.id) setActiveBreakdownView("cost_structure");
              setEditingStructure(null);
            } catch (e) { alert(`Could not delete: ${e.message}`); }
          }}
          onClose={() => setEditingStructure(null)}
        />
      )}

{unmappedAccounts?.length > 0 && !unmappedDismissed && (
        <UnmappedAccountsAlert
          accounts={unmappedAccounts}
          standard={detectedStandard}
          colors={colors}
          onClose={() => setUnmappedDismissed(true)}
          onMapNow={() => { setUnmappedDismissed(true); setMappingsModalOpen(true); }}
        />
      )}

      {mappingsModalOpen && (
        <MappingsModal
          open={mappingsModalOpen}
          onClose={() => setMappingsModalOpen(false)}
          groupAccounts={groupAccounts}
          dimensions={dimensions}
          token={token}
          initialStandard={detectedStandard}
        />
      )}

      <AiPanel
        open={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        colors={colors}
        periodLabel={periodLabel}
        companyName={companyMeta?.name}
        detectedStandard={detectedStandard}
        reportingCurrency={reportingCurrency}
        viewScope={viewScope}
        company={company}
        slottedKpis={slottedKpis}
        kpiValues={kpiValues}
        costBreakdown={costBreakdown}
        activeViewLabel={activeView?.label}
        topByRevenue={topByRevenue}
        trendSeries={trendSeries}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Cargador de la evolución de KPIs (dentro de su propia gráfica).
   El histórico es lo que más tarda: en vez de bloquear la página, la
   gráfica se "construye" aquí mientras el resto ya se puede usar.
   · Un esqueleto de columnas, una por mes del periodo que se va a pintar,
     con los meses reales en el eje X.
   · Cada mes que llega levanta su columna con un muelle y la línea avanza
     suavemente hasta ella (cabeza luminosa que recorre la curva).
   · Píldora de estado arriba a la izquierda con el % que cuenta hacia arriba.
   ══════════════════════════════════════════════════════════════════════ */

// Interpola un valor hacia su objetivo con requestAnimationFrame (ease-out).
function useTween(target, ms = 700) {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  useEffect(() => {
    const from = valueRef.current;
    if (from === target) return undefined;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 1 : ms;
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * e;
      valueRef.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

// Tamaño real del contenedor (el SVG se dibuja en píxeles: nada deformado).
function useBoxSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(s => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1) ? s : { w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Catmull-Rom → Bézier: tramos de control para una curva suave por los puntos.
function tlSegments(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    segs.push([
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return segs;
}

function tlBezier([a, b, c, d], t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

const TL_CSS = `
.hpTl { position: absolute; inset: 0; overflow: hidden; animation: hpTlFade 420ms cubic-bezier(0.22,1,0.36,1) both; }
.hpTl svg { position: absolute; inset: 0; display: block; }
.hpTlGrid { stroke: #eef0f5; stroke-width: 1; stroke-dasharray: 2 4; }
.hpTlSkel { animation: hpTlSkelIn 620ms cubic-bezier(0.22,1,0.36,1) both; transform-box: fill-box; transform-origin: 50% 100%; }
.hpTlNext { animation: hpTlSkelIn 620ms cubic-bezier(0.22,1,0.36,1) both, hpTlBreathe 1.3s ease-in-out 620ms infinite; transform-box: fill-box; transform-origin: 50% 100%; }
.hpTlBar { animation: hpTlGrow 760ms cubic-bezier(0.34,1.56,0.64,1) both; transform-box: fill-box; transform-origin: 50% 100%; }
.hpTlCap { animation: hpTlCapIn 520ms cubic-bezier(0.22,1,0.36,1) 120ms both; }
.hpTlShimmer { animation: hpTlSweep 1.9s cubic-bezier(0.45,0,0.55,1) infinite; }
.hpTlRing { transform-box: fill-box; transform-origin: center; animation: hpTlPing 1.6s cubic-bezier(0,0,0.2,1) infinite; }
.hpTlLabel { transition: fill 420ms ease; }
.hpTlLine { filter: drop-shadow(0 6px 10px rgba(26,47,138,0.22)); }
.hpTlCard { position: absolute; top: 10px; left: 16px; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 9px 12px 11px 10px; border-radius: 16px; background: rgba(255,255,255,0.84); backdrop-filter: blur(12px) saturate(1.4); -webkit-backdrop-filter: blur(12px) saturate(1.4); box-shadow: 0 14px 34px -20px rgba(26,47,138,0.55), 0 0 0 1px rgba(26,47,138,0.07); overflow: hidden; animation: hpTlCardIn 560ms cubic-bezier(0.22,1,0.36,1) 80ms both; }
.hpTlOrb { position: relative; width: 30px; height: 30px; flex-shrink: 0; border-radius: 999px; display: grid; place-items: center; }
.hpTlOrb::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: conic-gradient(from 0deg, var(--tl-a), var(--tl-b), transparent 72%, var(--tl-a)); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px)); mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px)); animation: hpTlSpin 1.1s linear infinite; }
.hpTlOrb::after { content: ""; position: absolute; inset: 6px; border-radius: inherit; background: color-mix(in srgb, var(--tl-a) 10%, white); animation: hpTlBeat 1.3s ease-in-out infinite; }
.hpTlOrb > svg { position: relative; z-index: 1; }
.hpTlTitle { font-size: 12px; font-weight: 900; color: #1f2937; letter-spacing: -0.01em; line-height: 1.2; white-space: nowrap; }
.hpTlSub { margin-top: 2px; font-size: 10px; font-weight: 700; color: #9ca3af; white-space: nowrap; font-variant-numeric: tabular-nums; }
.hpTlSub b { color: #4b5563; font-weight: 900; }
.hpTlPct { margin-left: 4px; padding-left: 12px; border-left: 1px solid #eef0f5; font-size: 20px; font-weight: 900; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.hpTlPct small { font-size: 11px; font-weight: 900; margin-left: 1px; opacity: 0.55; }
.hpTlTrack { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #f1f3f8; }
.hpTlTrack > span { position: absolute; inset: 0 auto 0 0; border-radius: 0 3px 3px 0; overflow: hidden; }
.hpTlTrack > span::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent); transform: translateX(-100%); animation: hpTlTrackShine 1.4s ease-in-out infinite; }
.hpTlChip { position: absolute; top: 4px; right: 24px; z-index: 3; display: flex; align-items: center; gap: 8px; padding: 5px 11px 5px 6px; border-radius: 999px; background: rgba(255,255,255,0.88); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 10px 24px -14px rgba(26,47,138,0.55), 0 0 0 1px rgba(26,47,138,0.07); font-size: 10px; font-weight: 800; color: #4b5563; white-space: nowrap; animation: hpTlCardIn 420ms cubic-bezier(0.22,1,0.36,1) both; font-variant-numeric: tabular-nums; }
.hpTlChip .hpTlOrb { width: 18px; height: 18px; }
.hpTlChip .hpTlOrb::before { -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); }
.hpTlChip .hpTlOrb::after { inset: 5px; background: var(--tl-a); opacity: 0.85; }
@keyframes hpTlFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes hpTlSkelIn { from { opacity: 0; transform: scaleY(0.2); } to { opacity: 1; transform: scaleY(1); } }
@keyframes hpTlGrow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes hpTlCapIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes hpTlBreathe { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes hpTlSweep { from { transform: translateX(-160px); } to { transform: translateX(var(--tl-w)); } }
@keyframes hpTlPing { 0% { transform: scale(1); opacity: 0.55; } 80%,100% { transform: scale(3.2); opacity: 0; } }
@keyframes hpTlSpin { to { transform: rotate(360deg); } }
@keyframes hpTlBeat { 0%,100% { transform: scale(0.82); } 50% { transform: scale(1); } }
@keyframes hpTlCardIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes hpTlTrackShine { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) {
  .hpTl, .hpTlSkel, .hpTlNext, .hpTlBar, .hpTlCap, .hpTlCard, .hpTlChip, .hpTlOrb::before, .hpTlOrb::after, .hpTlTrack > span::after { animation: none !important; }
  .hpTlShimmer, .hpTlRing { display: none; }
}
`;

function TrendBuildingLoader({
  done = 0, total = 0, year, month, window: trendWindow = 24, monthsAbbr = [],
  primary = "#1a2f8a", secondary = "#CF305D", t = (k, f) => f ?? k,
}) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [boxRef, { w, h }] = useBoxSize();

  // Meses que va a pintar la gráfica: de enero de (año − años + 1) al mes ancla.
  const months = useMemo(() => {
    const ay = Number(year), am = Number(month);
    const n = Math.max(12, Number(trendWindow) || 24);
    if (!ay || !am) return Array.from({ length: n }, (_, i) => ({ y: null, m: (i % 12) + 1 }));
    const startY = ay - Math.ceil(n / 12) + 1;
    const out = [];
    let y = startY, m = 1;
    while (y < ay || (y === ay && m <= am)) {
      out.push({ y, m });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }, [year, month, trendWindow]);

  const n = months.length;
  const ratio = total ? Math.min(1, done / total) : 0;
  const loaded = Math.min(n, Math.floor(ratio * n));
  const pctTarget = Math.round(ratio * 100);
  const pct = Math.round(useTween(pctTarget, 650));
  const head = useTween(loaded, 760);

  // Geometría en píxeles
  const padL = 20, padR = 20, padT = Math.min(78, Math.max(56, h * 0.26)), padB = 28;
  const plotW = Math.max(0, w - padL - padR), plotH = Math.max(0, h - padT - padB);
  const step = n ? plotW / n : 0;
  const barW = Math.max(4, Math.min(22, step * 0.56));
  const baseY = padT + plotH;

  // Alturas deterministas y suaves (forma de "serie" con tendencia al alza)
  const pts = useMemo(() => months.map((_, i) => {
    const k = n > 1 ? i / (n - 1) : 0;
    const v = 0.36 + 0.3 * k + 0.13 * Math.sin(i / 2.1) + 0.06 * Math.sin(i / 0.9 + 1.3);
    const hv = Math.max(0.16, Math.min(0.94, v));
    return { x: padL + (i + 0.5) * step, y: baseY - hv * plotH, hv };
  }), [months, n, padL, step, baseY, plotH]);

  const segs = useMemo(() => tlSegments(pts), [pts]);
  const linePath = useMemo(() => {
    if (!pts.length) return "";
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` + segs.map(([, b, c, d]) =>
      ` C${b.x.toFixed(1)},${b.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}`).join("");
  }, [pts, segs]);
  const areaPath = pts.length ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${baseY} L${pts[0].x.toFixed(1)},${baseY} Z` : "";

  // Cabeza de la línea: recorre la curva de forma continua
  const pos = Math.max(0, Math.min(n - 1, head - 1));
  const segI = Math.min(Math.floor(pos), Math.max(0, segs.length - 1));
  const headPt = !pts.length ? null : segs.length ? tlBezier(segs[segI], pos - segI) : pts[0];
  const headOn = head > 0.35 && headPt;
  const headOpacity = Math.max(0, Math.min(1, (head - 0.35) / 0.4));
  const clipW = headOn ? Math.max(0, headPt.x - padL + 1) : 0;

  // Etiquetas del eje X (sin amontonarse)
  const every = Math.max(1, Math.ceil(n / 12), step ? Math.ceil(46 / step) : 1);
  const labelOf = ({ y, m }) => `${monthsAbbr[m - 1] ?? m}${y ? ` ${String(y).slice(-2)}` : ""}`;
  const first = months[0], last = months[n - 1];

  const ready = w > 0 && h > 0 && plotH > 20;

  return (
    <div ref={boxRef} className="hpTl" role="status" aria-live="polite"
      style={{ "--tl-a": primary, "--tl-b": secondary, "--tl-w": `${w + 160}px` }}>
      <style>{TL_CSS}</style>

      {ready && (
        <svg width={w} height={h} aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}stroke`} gradientUnits="userSpaceOnUse" x1={padL} y1="0" x2={padL + plotW} y2="0">
              <stop offset="0%" stopColor={primary} />
              <stop offset="100%" stopColor={secondary} />
            </linearGradient>
            <linearGradient id={`${uid}area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary} stopOpacity="0.20" />
              <stop offset="100%" stopColor={primary} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary} stopOpacity="0.26" />
              <stop offset="100%" stopColor={primary} stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id={`${uid}guide`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary} stopOpacity="0.45" />
              <stop offset="100%" stopColor={primary} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}shine`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="50%" stopColor="#fff" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${uid}reveal`}>
              <rect x={padL - 2} y="0" width={clipW + 2} height={h} />
            </clipPath>
            <clipPath id={`${uid}pending`}>
              {pts.map((p, i) => i >= loaded && (
                <rect key={i} x={p.x - barW / 2} y={p.y} width={barW} height={baseY - p.y} rx={Math.min(barW / 2, 6)} />
              ))}
            </clipPath>
          </defs>

          {/* Rejilla */}
          {[0, 1, 2, 3].map(k => {
            const y = padT + (plotH * k) / 3;
            return <line key={k} className="hpTlGrid" x1={padL} x2={padL + plotW} y1={y} y2={y} />;
          })}

          {/* Columnas: esqueleto pendiente / mes ya cargado */}
          {pts.map((p, i) => {
            const rx = Math.min(barW / 2, 6);
            if (i < loaded) {
              return (
                <g key={`l${i}`}>
                  <rect className="hpTlBar" x={p.x - barW / 2} y={p.y} width={barW} height={baseY - p.y} rx={rx}
                    fill={`url(#${uid}bar)`} />
                </g>
              );
            }
            const next = i === loaded;
            return (
              <rect key={`s${i}`} className={next ? "hpTlNext" : "hpTlSkel"}
                style={{ animationDelay: next ? undefined : `${Math.min(i, 40) * 18}ms` }}
                x={p.x - barW / 2} y={p.y} width={barW} height={baseY - p.y} rx={rx}
                fill={next ? `color-mix(in srgb, ${primary} 16%, #f2f4f9)` : "#f1f3f8"} />
            );
          })}

          {/* Brillo que barre el esqueleto pendiente */}
          {loaded < n && (
            <g clipPath={`url(#${uid}pending)`}>
              <rect className="hpTlShimmer" x="0" y={padT - 4} width="160" height={plotH + 8} fill={`url(#${uid}shine)`} />
            </g>
          )}

          {/* Área + línea reveladas hasta la cabeza */}
          <g clipPath={`url(#${uid}reveal)`}>
            <path d={areaPath} fill={`url(#${uid}area)`} />
            <path className="hpTlLine" d={linePath} fill="none" stroke={`url(#${uid}stroke)`}
              strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          {/* Cabeza luminosa + guía vertical */}
          {headOn && (
            <g style={{ opacity: headOpacity }}>
              <line x1={headPt.x} x2={headPt.x} y1={headPt.y + 6} y2={baseY} stroke={`url(#${uid}guide)`}
                strokeWidth="1.5" strokeDasharray="3 3" />
              <circle className="hpTlRing" cx={headPt.x} cy={headPt.y} r="5" fill={primary} />
              <circle cx={headPt.x} cy={headPt.y} r="9" fill={primary} opacity="0.12" />
              <circle cx={headPt.x} cy={headPt.y} r="4.6" fill="#fff" stroke={primary} strokeWidth="2.6" />
            </g>
          )}

          {/* Eje X con los meses reales */}
          {months.map((mo, i) => {
            if ((n - 1 - i) % every !== 0) return null;
            return (
              <text key={i} className="hpTlLabel" x={pts[i].x} y={h - 9} textAnchor="middle"
                fontSize="11" fontWeight="700" fill={i < loaded ? "#6b7280" : "#d4d8e1"}>
                {labelOf(mo)}
              </text>
            );
          })}
        </svg>
      )}

      {/* Estado */}
      <div className="hpTlCard">
        <span className="hpTlOrb" aria-hidden="true">
          <TrendingUp size={13} strokeWidth={2.6} color={primary} />
        </span>
        <div>
          <div className="hpTlTitle">{t("home_trend_building", "Construyendo la evolución de los KPIs")}</div>
          <div className="hpTlSub">
            {total ? (
              <>
                <b>{Math.min(loaded, n)}</b> / {n} {t("home_trend_months", "meses")}
                {first?.y ? <> · {labelOf(first)} → {labelOf(last)}</> : null}
              </>
            ) : t("home_trend_preparing", "Preparando…")}
          </div>
        </div>
        <div className="hpTlPct" style={{ color: primary }}>
          {pct}<small>%</small>
        </div>
        <div className="hpTlTrack" aria-hidden="true">
          <span style={{
            width: `${Math.max(2, ratio * 100)}%`,
            background: `linear-gradient(90deg, ${primary}, ${secondary})`,
            transition: "width 650ms cubic-bezier(0.22,1,0.36,1)",
          }} />
        </div>
      </div>
    </div>
  );
}

// Recarga del histórico con la gráfica ya pintada: chip discreto en la esquina
function TrendRefreshBadge({ done = 0, total = 0, primary = "#1a2f8a", secondary = "#CF305D", t = (k, f) => f ?? k }) {
  const pct = Math.round(useTween(total ? Math.round((done / total) * 100) : 0, 650));
  return (
    <div className="hpTlChip" role="status" aria-live="polite" style={{ "--tl-a": primary, "--tl-b": secondary }}>
      <style>{TL_CSS}</style>
      <span className="hpTlOrb" aria-hidden="true" />
      {t("home_trend_updating", "Actualizando evolución")}
      <span style={{ color: primary, fontWeight: 900 }}>{pct}%</span>
    </div>
  );
}