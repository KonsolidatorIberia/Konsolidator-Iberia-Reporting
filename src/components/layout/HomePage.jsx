import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  TrendingUp, DollarSign, Target, Activity,
  Building2, Layers, Database, Network, Loader2, ArrowUp, ArrowDown,
  Sparkles, ChevronRight, Wallet, Settings, Search, ChevronDown, GitCompare,
  Edit3, Trash2,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useSettings, useTypo, useSettingsControls, useT } from "./SettingsContext.jsx";
import AiPanel from "./AiPanel.jsx";
import { supabase } from "../../lib/supabaseClient";
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
const STANDARD_TO_BS_TABLE = {
  PGC: "pgc_bs_rows",
  DanishIFRS: "danish_ifrs_bs_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_bs_rows",
};
const STANDARD_TO_SECTION_TABLE = {
  PGC: "pgc_pl_sections",
  DanishIFRS: "danish_ifrs_pl_sections",
  "SpanishIFRS-ES": "spanish_ifrs_es_pl_sections",
};

async function loadStandardMapping(standard, groupAccounts) {
  const plTable = STANDARD_TO_PL_TABLE[standard];
  const bsTable = STANDARD_TO_BS_TABLE[standard];
if (!plTable) return null;

  const cacheKey = `resolver_mapping_${standard}_${(groupAccounts || []).length}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { cc, sc } = JSON.parse(cached);
      return { ccTagToCodes: new Map(cc), sectionCodes: new Map(sc) };
    }
  } catch { /* re-fetch */ }

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


try {
    sessionStorage.setItem(cacheKey, JSON.stringify({
      cc: [...ccTagToCodes.entries()],
      sc: [...sectionCodes.entries()],
    }));
  } catch { /* storage full or unavailable */ }
  return { ccTagToCodes, sectionCodes };
}

async function loadKpiLibrary(standard, companyId) {
  const cacheKey = `resolver_library_${standard}_${companyId ?? "none"}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* re-fetch */ }

  const [defs, overrides, custom] = await Promise.all([
    sbGet("kpi_definitions?select=*&order=sort_order.asc"),
    standard
      ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}`)
      : Promise.resolve([]),
    companyId
      ? sbGet(`company_kpis?select=*&company_id=eq.${encodeURIComponent(companyId)}&is_archived=eq.false`)
      : Promise.resolve([]),
  ]);

if (!Array.isArray(defs)) return [];

  const overrideByKpi = new Map();
  if (Array.isArray(overrides)) {
    overrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  }

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

  const customKpis = Array.isArray(custom) ? custom.map(d => ({
    id:          d.kpi_id,
    label:       d.label,
    description: d.description ?? "",
    category:    d.category ?? "Custom",
    format:      d.format ?? "currency",
    tag:         d.tag ?? "",
    benchmark:   d.benchmark ?? null,
    formula:     d.formula,
    isCustom:    true,
  })) : [];


const result = [...standardKpis, ...customKpis];
  try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

function useResolvedKpiList(groupAccounts, companyId) {
  const standard = useMemo(() => detectStandard(groupAccounts), [groupAccounts]);

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
if (!standard) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(s => ({ ...s, ready: true, kpiList: [], standard: null }));
      return;
    }
setState(s => ({ ...s, ready: false, error: null }));

    Promise.all([loadStandardMapping(standard, groupAccounts), loadKpiLibrary(standard, companyId)])
      .then(([{ ccTagToCodes, sectionCodes }, fullKpiList]) => {
        if (cancelled) return;
        setState({
          kpiList:       fullKpiList,    // FULL list — HomePage picks heros by id
          ccTagToCodes,
          sectionCodes,
          standard,
          ready:         true,
          error:         null,
        });
      })
.catch(e => {
        if (cancelled) return;
        setState(s => ({ ...s, ready: true, error: String(e?.message ?? e) }));
      });

return () => { cancelled = true; };
  }, [standard, groupAccounts, companyId]);

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
  const val = evalFormulaWithCcTags(kpi.formula, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
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
function buildPivotFromRows(rows, sumAccountCodes) {
  const p = new Map();
  if (!rows?.length) return p;
  rows.forEach(r => {
    const ac = r.AccountCode ?? r.accountCode ?? "";
    if (!ac) return;
    if (sumAccountCodes && sumAccountCodes.has(ac)) return;
    const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
    p.set(ac, (p.get(ac) ?? 0) + amt);
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

/* ═══════════════════════════════════════════════════════════════
   KPI HERO CARD
═══════════════════════════════════════════════════════════════ */
function HeroKPI({ label, value, prevValue, trend, color, accent, icon: Icon, delay = 0, loading }) {
  const change = prevValue && prevValue !== 0 ? ((value - prevValue) / Math.abs(prevValue)) * 100 : null;
  const isPositive = change != null ? change >= 0 : null;
  const sparklineData = useMemo(() => (trend ?? []).map((v, i) => ({ x: i, y: v })), [trend]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 transition-all duration-500 hover:scale-[1.015] hover:shadow-2xl group h-full flex flex-col"
style={{
        background: `linear-gradient(135deg, ${color}f0 0%, ${color} 70%, ${accent ?? color} 100%)`,
        boxShadow: `0 16px 40px -8px ${color}90, 0 6px 16px -4px ${color}60, inset 0 1px 0 rgba(255,255,255,0.2)`,
        animation: `kCardEntry 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s both`,
      }}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
        style={{
          background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)",
          backgroundSize: "200% 100%",
          animation: "kShimmer 1.5s ease-in-out infinite",
        }} />
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-2xl"
        style={{ background: "rgba(255,255,255,0.5)" }} />

<div className="relative z-10 flex flex-col h-full">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20 flex-shrink-0">
              {Icon && <Icon size={14} className="text-white" />}
            </div>
<div className="min-w-0">
              <p className="text-[9px] font-black text-white/75 uppercase tracking-[0.18em] truncate">{label}</p>
            </div>
          </div>
          {change != null && (
            <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black flex-shrink-0 ${
              isPositive ? "bg-emerald-400/30 text-emerald-50" : "bg-red-400/30 text-red-50"
            } border ${isPositive ? "border-emerald-300/40" : "border-red-300/40"}`}>
              {isPositive ? <ArrowUp size={8} /> : <ArrowDown size={8} />}
              {Math.abs(change).toFixed(1)}%
            </div>
          )}
        </div>

        <div className="mb-2 flex-shrink-0">
          {loading ? (
            <div className="h-8 w-28 bg-white/15 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-black text-white tracking-tight" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
              {fmtBig(value)}
            </p>
          )}
{prevValue != null && prevValue !== 0 && (
            <p className="text-[12px] text-white/65 mt-1 font-semibold">vs {fmtBig(prevValue)}</p>
          )}
        </div>

        {sparklineData.length > 1 && (
          <div className="flex-1 min-h-[36px] -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="white" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="white" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="y" stroke="white" strokeWidth={1.4}
                  fill={`url(#spark-${label})`} dot={false} isAnimationActive />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function MiniTile({ label, value, icon: Icon, color, delay = 0, onClick }) {
  return (
    <button
      onClick={onClick}
      className="relative overflow-hidden rounded-xl p-3 bg-white/95 backdrop-blur-sm border border-gray-100/80 hover:shadow-md hover:scale-[1.02] hover:border-gray-200 transition-all duration-300 group text-left w-full cursor-pointer"
style={{ animation: `kCardEntry 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s both`, boxShadow: "0 8px 24px -8px rgba(26,47,138,0.15), 0 2px 8px -2px rgba(0,0,0,0.06)" }}
    >
      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full opacity-10 blur-xl group-hover:opacity-20 transition-opacity"
        style={{ background: color }} />
      <div className="relative flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
          <Icon size={13} style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-400 truncate">{label}</p>
          <p className="text-base font-black text-gray-800">{value}</p>
</div>
      </div>
    </button>
  );
}

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

// eslint-disable-next-line no-unused-vars
function DetailPopup({ title, items, icon: Icon, color, onClose, renderItem }) {
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
      <div className="overflow-y-auto p-1.5 hide-scrollbar" style={{ maxHeight: 220 }}>
        {Object.entries(grouped).map(([cat, kpis], catIdx) => {
          const CAT_COLORS = [
            "#1a2f8a", "#CF305D", "#57aa78", "#7c3aed",
            "#d97706", "#0891b2", "#be185d", "#065f46",
          ];
          const catColor = CAT_COLORS[catIdx % CAT_COLORS.length];
          return (
            <div key={cat} className="mb-1">
              {/* Section header */}
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

              {/* KPI rows */}
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

function BreakdownLibraryModal({
  structures, activeViewId, defaultViewId, colors,
  onApply, onSetDefault, onEdit, onDelete, onCreate, onClose,
}) {
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
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-0.5">Company library</p>
            <p className="text-base font-black text-gray-800">Breakdown Structures</p>
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
              <p className="text-xs font-black text-gray-400">No structures yet</p>
              <p className="text-[10px] text-gray-300">Create the first one below</p>
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
                          style={{ background: colors.primary }}>Active</span>
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
                      Default
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
                      <span className="text-[10px] font-black text-red-500 flex-1">Delete this structure?</span>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1.5 rounded-xl text-[10px] font-black bg-gray-100 text-gray-500 transition-all">
                        Cancel
                      </button>
                      <button
                        onClick={() => { onDelete(s.id); setConfirmDeleteId(null); }}
                        className="px-2.5 py-1.5 rounded-xl text-[10px] font-black text-white transition-all"
                        style={{ background: "#dc2626" }}>
                        Delete
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
                        {isActive ? "Active ✓" : "Apply"}
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
              + Create new breakdown
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

const GROUP_PALETTE = ["#1a2f8a","#CF305D","#57aa78","#7c3aed","#d97706","#0891b2","#be185d","#065f46"];

function BreakdownBuilderModal({ structure, groupAccounts, currentPivot, colors, onSave, onDelete, onClose }) {
  const [name, setName]               = useState(structure?.name ?? "");
  const [description, setDescription] = useState(structure?.description ?? "");
  const [groups, setGroups]           = useState(() =>
    (structure?.items ?? []).map((g, gi) => ({
      ...g,
      color: g.color ?? GROUP_PALETTE[gi % GROUP_PALETTE.length],
      sign:  g.sign  ?? "+",
      _key:  g.id    ?? Math.random().toString(36).slice(2),
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
    const lk = Math.random().toString(36).slice(2);
    updateGroup(groupKey, { lines: [...(groups.find(g => g._key === groupKey)?.lines ?? []), { account_code: code, account_name: name, sign: "+", _key: lk }] });
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
      lines: (lines ?? []).map(({ _key: lk, ...l }) => l),
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
              {structure ? "Edit" : "New"} breakdown
            </p>
            <p className="text-[17px] font-black text-gray-900 leading-tight">Custom Account Breakdown</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">✕</button>
        </div>

        {/* ── Name + description ── */}
        <div className="grid grid-cols-2 gap-3 px-6 pb-5 flex-shrink-0 border-b border-gray-100">
          <div>
            <label className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400 block mb-1.5">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My P&L"
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none border border-gray-200 transition-all"
              onFocus={e => e.target.style.borderColor = colors.primary + "50"}
              onBlur={e => e.target.style.borderColor = "#e5e7eb"} />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400 block mb-1.5">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
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
                  placeholder="Group name…"
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
                            {a.hasData ? fmtBig(a.balance) : "no data"}
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
            + Add group
          </button>
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex items-center gap-2">
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="px-3 py-2 rounded-xl text-xs font-black"
              style={{ background: "#fee2e2", color: "#dc2626" }}>Delete</button>
          )}
          {confirmDelete && (
            <>
              <button onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={onDelete}
                className="px-3 py-2 rounded-xl text-xs font-black text-white"
                style={{ background: "#dc2626" }}>Confirm delete</button>
            </>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-600">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim()}
            className="px-5 py-2 rounded-xl text-xs font-black text-white disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)` }}>
            {structure ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════════ */
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
    kpiList, ccTagToCodes, sectionCodes, standard: detectedStandard,
    ready: resolverReady,
  } = useResolvedKpiList(groupAccounts, settingsCompanyId);

const { setDetectedLocale } = useSettingsControls();

  // ── KPI slot configuration ───────────────────────────────────────
  const DEFAULT_SLOTS = ["revenue", "ebitda", "ebit", "net_result"];
  const [kpiSlots, setKpiSlots]     = useState(DEFAULT_SLOTS);
 const [editingSlot, setEditingSlot]     = useState(null);   // 0-3 | null
  const [trendWindow, setTrendWindow]     = useState(24);      // 12 | 24 | 36 | 48 months
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

  // Load saved slots from user_settings.preferences
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("user_settings")
        .select("preferences")
        .eq("user_id", userId)
        .single();
      if (data?.preferences?.home_kpi_slots?.length === 4) {
        setKpiSlots(data.preferences.home_kpi_slots);
      }
    })();
  }, [userId]);

  const saveKpiSlots = useCallback(async (slots) => {
    if (!userId) return;
    const { data } = await supabase
      .from("user_settings")
      .select("preferences")
      .eq("user_id", userId)
      .single();
    const current = data?.preferences ?? {};
    await supabase.from("user_settings").upsert({
      user_id: userId,
      preferences: { ...current, home_kpi_slots: slots },
      updated_at: new Date().toISOString(),
    });
  }, [userId]);

  const updateSlot = useCallback((slotIdx, kpiId) => {
    const next = [...kpiSlots];
    next[slotIdx] = kpiId;
    setKpiSlots(next);
    saveKpiSlots(next);
    setEditingSlot(null);
  }, [kpiSlots, saveKpiSlots]);

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
  const [viewScope, setViewScope]           = useState("consolidated"); // "consolidated" | "individual"
  const [valueMode, setValueMode]           = useState("monthly"); // "monthly" | "ytd"
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
  const [compareYear, setCompareYear]   = useState("");
  const [compareMonth, setCompareMonth] = useState("");
  const [compareTouched, setCompareTouched] = useState(false);
  useEffect(() => {
    if (compareTouched) return;
    if (!year || !month) return;
    const y = Number(year), m = Number(month);
    let pm = m - 1, py = y;
    if (pm < 1) { pm = 12; py -= 1; }
// eslint-disable-next-line react-hooks/set-state-in-effect
    setCompareYear(String(py));
setCompareMonth(String(pm));
  }, [year, month, compareTouched]);
  const compareLabel = useMemo(() => {
    if (!compareYear || !compareMonth) return "—";
    const mNum = Number(compareMonth);
    if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) return "—";
    return `${MONTHS_ABBR[mNum - 1]} ${compareYear}`;
  }, [compareYear, compareMonth, MONTHS_ABBR]);

  const [currentRows, setCurrentRows]     = useState(prefetch?.current ?? []);
  const [prevRows, setPrevRows]           = useState(prefetch?.prev ?? []);
  const [trendRows, setTrendRows]         = useState(prefetch?.trend ?? []);
const [allCoCurrentRows, setAllCoCurrentRows] = useState(prefetch?.allCoCurrentRows ?? []);
  const [loading, setLoading]             = useState(false);
  const [trendLoading, setTrendLoading]   = useState(false);
  const [allCoLoading, setAllCoLoading]   = useState(false);
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
       // eslint-disable-next-line react-hooks/set-state-in-effect
        if (p) { setYear(String(p.year)); setMonth(String(p.month)); return; }
        sessionStorage.removeItem(cacheKey);
      } catch { sessionStorage.removeItem(cacheKey); }
    }

    setProbing(true);
    (async () => {
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
          setYear(String(found.y)); setMonth(String(found.m));
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ year: found.y, month: found.m })); } catch { /* storage unavailable */ }
          setProbing(false); return;
        }
      }
      setProbing(false);
    })();
  }, [source, structure, company, token, year, month, headers]);

// Fetch current (anchor period)
  const initialFetchSkippedRef = useRef(!!(prefetch?.current?.length));
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
    if (initialFetchSkippedRef.current) { initialFetchSkippedRef.current = false; return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const cur = await fetchPeriod(year, month, source, structure, company);
      if (cancelled) return;
      setCurrentRows(cur);
      setLoading(false);
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
    if (!year || !month || !source || !structure || !company) return;
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

      const results = [];
      for (let i = 0; i < months.length; i += 8) {
        const batch = months.slice(i, i + 8);
        const batchResults = await Promise.all(
          batch.map(({ y, m }) => fetchPeriod(y, String(m), source, structure, company)
            .then(rows => ({ year: y, month: m, rows })))
        );
        if (cancelled) return;
        results.push(...batchResults);
        setTrendRows([...results]);
      }
      if (cancelled) return;
      trendCacheRef.current.set(cacheKey, results);
      setTrendLoading(false);
    })();
    return () => { cancelled = true; };
}, [year, month, source, structure, company, fetchPeriod, trendWindow]);

// Fetch all-companies YTD for ranking (current)
  useEffect(() => {
    if (!year || !month || !source || !structure) return;
    const cacheKey = `${source}|${structure}|${year}|${month}|ytd-allco`;
    const cached = allCoCacheRef.current.get(cacheKey);
    if (cached) { setAllCoCurrentRows(cached); return; }
    let cancelled = false;
    setAllCoLoading(true);
    (async () => {
      const rows = await fetchPeriodAllCompanies(year, month, source, structure);
      if (cancelled) return;
      allCoCacheRef.current.set(cacheKey, rows);
      setAllCoCurrentRows(rows);
      setAllCoLoading(false);
    })();
  }, [year, month, source, structure, fetchPeriodAllCompanies]);


// Resolve the 4 configured slot KPIs from the library
  const slottedKpis = useMemo(() => {
    if (!resolverReady || kpiList.length === 0) return null;
    return kpiSlots.map(id => kpiList.find(k => k.id === id) ?? null);
  }, [kpiList, resolverReady, kpiSlots]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m === 1 || valueMode === "ytd") { setMonthBeforeAnchorRows([]); return; }
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
    const m = parseInt(month);
    if (m === 1) return currentYtdPivot;
    if (!monthBeforeAnchorRows.length) {
      // Fallback to trendRows if dedicated fetch hasn't returned yet
      const beforeM = m - 1;
      const beforeY = Number(year);
      const found = trendRows.find(t => Number(t.year) === beforeY && Number(t.month) === beforeM);
      if (!found) return currentYtdPivot;
      const beforeYtd = buildPivotFromRows(found.rows, sumAccountCodes);
      const out = new Map();
      const allCodes = new Set([...currentYtdPivot.keys(), ...beforeYtd.keys()]);
      allCodes.forEach(ac => {
        out.set(ac, (currentYtdPivot.get(ac) ?? 0) - (beforeYtd.get(ac) ?? 0));
      });
      return out;
    }
    const beforeYtd = buildPivotFromRows(monthBeforeAnchorRows, sumAccountCodes);
    const out = new Map();
    const allCodes = new Set([...currentYtdPivot.keys(), ...beforeYtd.keys()]);
    allCodes.forEach(ac => {
      out.set(ac, (currentYtdPivot.get(ac) ?? 0) - (beforeYtd.get(ac) ?? 0));
    });
    return out;
  }, [currentYtdPivot, year, month, trendRows, monthBeforeAnchorRows, sumAccountCodes, valueMode]);

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
    return out;
  }, [prevYtdPivot, compareYear, compareMonth, trendRows, sumAccountCodes, valueMode]);

// Unfiltered pivots for custom breakdown — no sum-account exclusion so
  // user-picked accounts always resolve correctly
  const rawCurrentMonthlyPivot = useMemo(() => {
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
    return slottedKpis.map(kpi => ({
      current: kpi ? computeKpiById(kpi.id, currentMonthlyPivot, kpiList, ccTagToCodes, sectionCodes, cacheCur) : 0,
      prev:    kpi ? computeKpiById(kpi.id, prevMonthlyPivot,    kpiList, ccTagToCodes, sectionCodes, cachePrev) : 0,
    }));
  }, [slottedKpis, currentMonthlyPivot, prevMonthlyPivot, kpiList, ccTagToCodes, sectionCodes]);
  // Trend series — MONTHLY values, derived from YTD diffs.
  // For each month, monthly = YTD(month) - YTD(month-1) per account.
  // January: monthly = YTD (since previous month YTD belongs to a different fiscal year).
  const trendSeries = useMemo(() => {
    if (!trendRows.length || !heroKpis || kpiList.length === 0) return [];

    // Build pivots per (year, month)
    const pivotsByKey = new Map();
    trendRows.forEach(({ year: y, month: m, rows }) => {
      pivotsByKey.set(`${y}-${m}`, buildPivotFromRows(rows, sumAccountCodes));
    });

    const sorted = [...trendRows]
      .filter(t => Number.isFinite(t?.year) && Number.isFinite(t?.month))
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const { year: y, month: m } = sorted[i];
      const currP = pivotsByKey.get(`${y}-${m}`);
      if (!currP) continue;

let monthlyPivot;
      if (valueMode === "ytd") {
        monthlyPivot = currP;
      } else {
        const isJanuary = m === 1;
        if (isJanuary) {
          monthlyPivot = currP;
        } else {
          const prevP = pivotsByKey.get(`${y}-${m - 1}`);
          if (!prevP) continue; // skip oldest if we can't compute its delta
          monthlyPivot = new Map();
          const allCodes = new Set([...currP.keys(), ...prevP.keys()]);
          allCodes.forEach(ac => {
            monthlyPivot.set(ac, (currP.get(ac) ?? 0) - (prevP.get(ac) ?? 0));
          });
        }
      }

const cache = new Map();
const entry = {
        _year: y,
        _month: m,
        idx: out.length,
        label: `${MONTHS_ABBR[m - 1]} ${String(y).slice(-2)}`,
        fullLabel: `${MONTHS_ABBR[m - 1]} ${y}`,
      };
      kpiSlots.forEach((id, si) => {
        entry[`slot${si}`] = computeKpiById(id, monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache);
      });
      out.push(entry);
    }
    return out;
}, [trendRows, kpiSlots, kpiList, ccTagToCodes, sectionCodes, sumAccountCodes, valueMode, MONTHS_ABBR, heroKpis]);

const trendFromYear = useMemo(() => {
    if (!year) return null;
    return Number(year) - Math.ceil(trendWindow / 12) + 1;
  }, [year, trendWindow]);

  const trendSeriesDisplay = useMemo(() => {
    if (!trendSeries.length) return [];
    const windowed = trendSeries.slice(-trendWindow);
    if (trendInterval === "6months")
      return windowed.filter((t, i) =>
        t._month === 1 || t._month === 7 || i === windowed.length - 1
      );
    if (trendInterval === "yearly")
      return windowed.filter((t, i) =>
        t._month === 12 || i === windowed.length - 1
      );
    return windowed; // monthly — all points
  }, [trendSeries, trendWindow, trendInterval]);

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
    const out = [];
    rankingEntities.forEach(entity => {
      const data = rankingDataByEntity[entity];
      if (!data || !data.curRows?.length) return;

// SAME as hero: currentYtdPivot
      const curYtdPivot = buildPivotFromRows(data.curRows, sumAccountCodes);

      // SAME as hero: currentMonthlyPivot
      let monthlyPivot;
      if (valueMode === "ytd") {
        monthlyPivot = curYtdPivot;
      } else if (m === 1) {
        monthlyPivot = curYtdPivot;
      } else {
        const beforeYtd = buildPivotFromRows(data.monthBeforeCurRows ?? [], sumAccountCodes);
        monthlyPivot = new Map();
        const allCodes = new Set([...curYtdPivot.keys(), ...beforeYtd.keys()]);
        allCodes.forEach(ac => {
          monthlyPivot.set(ac, (curYtdPivot.get(ac) ?? 0) - (beforeYtd.get(ac) ?? 0));
        });
      }

// SAME as hero: computeKpiById on monthlyPivot
      const cache = new Map();
      let v = computeKpiById(rankingKpiId, monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache);
      if (v === null || isNaN(v)) return;

// NO FX conversion. The API returns each holding's data already
      // consolidated in that holding's own reporting currency — exactly
      // what the hero card displays. Re-converting would double-count.
      // For mixed-currency comparisons across holdings, the user can
      // toggle the period picker; values stay in each holding's native
      // currency just like the hero does.

      out.push({ name: entity, value: v });
    });
    return out.sort((a, b) => b.value - a.value);
}, [rankingEntities, rankingDataByEntity, kpiList, ccTagToCodes, sectionCodes, sumAccountCodes, month, valueMode, rankingKpiId]);

  const periodLabel = useMemo(() => {
   if (!year || !month) return probing ? t("loading_searching") : "—";
    const mNum = Number(month);
    if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) return "—";
return `${MONTHS_ABBR[mNum - 1]} ${year}`;
  }, [year, month, probing, t, MONTHS_ABBR]);

const anyLoading = loading || trendLoading || probing || allCoLoading || !resolverReady;

// Progress meter: 5 stages, weighted by perceptual cost
  const loadProgress = useMemo(() => {
    let pct = 0;
    if (year && month)                        pct += 15;
    if (resolverReady && kpiList.length > 0)  pct += 25;
    if (currentRows.length > 0)               pct += 25;
    if (trendRows.length >= 6)                pct += 20;
    if (allCoCurrentRows.length > 0)          pct += 15;
    return Math.min(100, pct);
  }, [year, month, resolverReady, kpiList.length, currentRows.length, trendRows.length, allCoCurrentRows.length]);

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
  }, [settingsCompanyId, userId]);

  // Persist user's active view whenever it changes
  const prevActiveViewRef = useRef(null);
  useEffect(() => {
    if (!userId || !settingsCompanyId) return;
    if (prevActiveViewRef.current === activeBreakdownView) return;
    prevActiveViewRef.current = activeBreakdownView;
    saveBreakdownPreference({ userId, companyId: settingsCompanyId, activeViewId: activeBreakdownView });
  }, [activeBreakdownView, userId, settingsCompanyId]);

  const activeCustomStructure = useMemo(
    () => customStructures.find(s => s.id === activeBreakdownView) ?? null,
    [customStructures, activeBreakdownView]
  );

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
 }, [activeCustomStructure, activeView, ccTagToCodes, currentMonthlyPivot, prevMonthlyPivot, rawCurrentMonthlyPivot, rawPrevMonthlyPivot, TAG_LABELS, INCOME_TAGS]);

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
  }, [drillTag, ccTagToCodes, currentMonthlyPivot, prevMonthlyPivot, groupAccounts]);

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
  }, [drillTag, trendRows, ccTagToCodes, year, month, sumAccountCodes, MONTHS_ABBR]);

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

const costColors = useMemo(() => {
    return [colors.primary ?? "#1a2f8a", "#3b54b8", "#7c5fcc", "#b370cc", "#cf6595", "#cf5070", "#cf3940"];
  }, [colors]);

return (
<>
    {loadProgress < 100 && (
      <div
        className="fixed inset-0 z-[300] flex items-center justify-center"
        style={{
          background: "rgba(255,255,255,0.78)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          animation: "hpOverlayFadeIn 200ms ease-out",
        }}
      >
        <div
          className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
          style={{
            width: 380,
            boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)",
            animation: "hpPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)",
          }}
        >
{/* Circular progress */}
          <div className="relative" style={{ width: 140, height: 140 }}>
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
              <circle
                cx="70" cy="70" r="60" fill="none"
                stroke={`url(#hpProgGrad)`}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 60}
                strokeDashoffset={2 * Math.PI * 60 * (1 - animatedLoadProgress / 100)}
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "70px 70px",
                }}
              />
              <defs>
                <linearGradient id="hpProgGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                  <stop offset="100%" stopColor={colors.secondary ?? "#CF305D"} />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
<span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
                {Math.round(animatedLoadProgress)}<span className="text-base text-gray-300">%</span>
              </span>
            </div>
          </div>

          {/* Label + sub-step */}
          <p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
{probing
              ? t("loading_overlay_period")
              : !resolverReady
                ? t("loading_overlay_kpi")
                : currentRows.length === 0
                  ? t("loading_overlay_current")
                  : trendRows.length < 6
                    ? t("loading_overlay_trend")
                    : allCoCurrentRows.length === 0
                      ? t("loading_overlay_multico")
                      : t("loading_overlay_finish")}
          </p>
          <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
            {t("loading_overlay_subtitle")}
          </p>
        </div>
      </div>
    )}
    <div className="relative h-full flex flex-col">
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
<div className="relative z-10 flex flex-col flex-1 min-h-0 pl-2 pr-5 gap-3">
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
          <div className="flex items-center gap-4 pl-2">
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
<div className="flex items-baseline gap-2">
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
            <div className="flex items-center gap-2" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.4,0,0.2,1) 0.18s both" }}>
              {companyMeta?.name && (
                <span className="text-[12px] font-semibold text-gray-500">{companyMeta.name}</span>
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
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border hover:shadow-md"
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

            {/* AI Assistant button */}
            <button
              onClick={() => setAiPanelOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.02]"
              style={{
                background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary ?? "#CF305D"} 100%)`,
                boxShadow: `0 4px 14px -4px ${colors.primary}80`,
              }}
            >
              <Sparkles size={11} className="text-white" />
              <span className="text-[11px] font-black text-white uppercase tracking-wider">AI</span>
            </button>
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
                <div key={`slot-${idx}`} className="relative group/kpislot h-full">
<HeroKPI
                    label={kpi?.label ?? slotId}
                    value={vals?.current ?? 0}
                    prevValue={vals?.prev ?? 0}
                    trend={sparklines[idx] ?? []}
                    color={sc.color}
                    accent={sc.accent}
                    icon={sc.icon}
                    loading={loading}
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
<div className="lg:col-span-3 relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-100 p-4 flex flex-col"
            style={{ boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18), 0 2px 8px -2px rgba(0,0,0,0.08)", animation: "kCardEntry 0.6s ease-out 0.25s both" }}>
            {middleCardView === "ranking" ? (
              <>
                <div className="mb-2.5 flex-shrink-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setMiddleCardView("trend")}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg transition-colors hover:bg-gray-100"
                      style={{ color: "#6b7280" }}
                    >
                      <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
                      <span className="text-[10px] font-black uppercase tracking-wider">Back</span>
                    </button>
                    <span className="h-px w-3 bg-gray-200 flex-shrink-0" />
<p className="text-[12px] font-black uppercase tracking-widest text-gray-500 flex-shrink-0">{t("home_ranking")}</p>
                    <span className="h-px w-3 bg-gray-200 flex-shrink-0" />
                    <p className="text-[11px] text-gray-400 truncate">{t("rank_all")} {topByRevenue.length} {t("rank_by")} {rankingKpiLabel}</p>
                  </div>


                </div>
                <div className="flex-1 min-h-0 overflow-y-auto pr-1 hide-scrollbar space-y-1.5">
                  {topByRevenue.map((c, i) => {
                    const max = topByRevenue[0].value;
                    const pct = max > 0 ? (c.value / max) * 100 : 0;
                    return (
                      <div key={c.name}
                        className="grid items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50/60 transition-colors"
                        style={{
                          gridTemplateColumns: "32px 200px 1fr 100px",
                          animation: `kCardEntry 0.3s ease-out ${Math.min(i, 10) * 0.03}s both`,
                        }}>
                        <span className="text-[11px] font-black tabular-nums text-center" style={{ color: i === 0 ? colors.primary : i < 3 ? colors.primary : "#9ca3af" }}>
                          {i + 1}
                        </span>
                        <span className="text-[12px] font-bold text-gray-800 truncate" title={c.name}>{c.name}</span>
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${colors.primary}cc 0%, ${colors.primary} 100%)` }} />
                        </div>
                        <span className="text-[12px] font-mono font-black text-right" style={{ color: colors.primary }}>{fmtBig(c.value)}</span>
                      </div>
                    );
                  })}
</div>
              </>
            ) : middleCardView === "tag_drill" && drillTag ? (
              <>
                <div className="mb-3 flex-shrink-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => { setMiddleCardView("trend"); setDrillTag(null); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg transition-colors hover:bg-gray-100"
                      style={{ color: "#6b7280" }}
                    >
<ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
                      <span className="text-[10px] font-black uppercase tracking-wider">{t("drill_back")}</span>
                    </button>
                    <span className="h-px w-3 bg-gray-200 flex-shrink-0" />
                    <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 flex-shrink-0">
                      {drillStats?.label ?? drillTag}
                    </p>
                    <span className="h-px w-3 bg-gray-200 flex-shrink-0" />
                    <p className="text-[11px] text-gray-400">{drillAccountBreakdown.length} {t("drill_accounts")}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
<div className="flex flex-col items-end">
<span className="text-[8px] font-black uppercase tracking-wider text-gray-400">{t("drill_monthly")}</span>
                      <span className="text-[13px] font-mono font-black text-gray-800">
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
<span className="text-[8px] font-black uppercase tracking-wider text-gray-400">{t("drill_ytd_vs_py")}</span>
                      <span className="text-[13px] font-mono font-black text-gray-800">
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
<p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400">
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
<p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400">
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
                                  <span className="font-mono font-black text-gray-800 group-hover/acct:scale-110 transition-transform inline-block origin-right">{fmtBig(row.value)}</span>
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
                              <span className="text-gray-400 font-bold uppercase tracking-wider">{t("drill_top3_concentration")}</span>
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
<div ref={trendHeaderRef} className="flex items-center justify-between mb-2 flex-shrink-0 gap-4">
              {/* LEFT — title + interactive chips */}
              <div className="flex items-center gap-3 min-w-0">
                <h3 className="text-sm font-black text-gray-800 flex-shrink-0">{t("home_kpi_evolution")}</h3>

                <div className="flex items-center gap-1.5">
{/* Interval chip */}
                  <div className="relative">
                    <button
                      onClick={() => setTrendChipOpen(trendChipOpen === "interval" ? null : "interval")}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg transition-colors"
                      style={{ background: `${colors.primary}12`, color: colors.primary }}
                    >
<span className="text-[10px] font-black uppercase tracking-wider">
                        {{ monthly: t("trend_monthly"), "6months": t("trend_6months"), yearly: t("trend_yearly") }[trendInterval]}
                      </span>
                      <ChevronDown size={8} />
                    </button>
                    {trendChipOpen === "interval" && (
                      <div className="absolute top-full left-0 mt-1.5 z-50 bg-white rounded-xl border border-gray-100 py-1 min-w-[140px]"
                        style={{ boxShadow: "0 12px 32px -8px rgba(26,47,138,0.2)" }}>
                        {[
                          { value: "monthly",  label: t("trend_monthly") },
                          { value: "6months",  label: t("trend_6months_long") },
                          { value: "yearly",   label: t("trend_yearly") },
                        ].map(opt => (
                          <button key={opt.value}
                            onClick={() => { setTrendInterval(opt.value); setTrendChipOpen(null); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-bold transition-colors hover:bg-gray-50"
                            style={{ color: trendInterval === opt.value ? colors.primary : "#6b7280" }}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="text-gray-300 text-[10px]">·</span>

                  {/* Window chip */}
                  <div className="relative">
<button
                      onClick={() => setTrendChipOpen(trendChipOpen === "window" ? null : "window")}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg transition-colors"
                      style={{ background: `${colors.primary}12`, color: colors.primary }}
                    >
<span className="text-[10px] font-black uppercase tracking-wider">
                        {t("trend_from_jan")} {trendFromYear ?? "…"}
                      </span>
                      <ChevronDown size={8} />
                    </button>
                    {trendChipOpen === "window" && (
                      <div className="absolute top-full left-0 mt-1.5 z-50 bg-white rounded-xl border border-gray-100 py-1 min-w-[130px]"
                        style={{ boxShadow: "0 12px 32px -8px rgba(26,47,138,0.2)" }}>
{[12, 24, 36, 48].map(w => (
                          <button key={w}
                            onClick={() => { setTrendWindow(w); setTrendChipOpen(null); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-bold transition-colors hover:bg-gray-50"
                            style={{ color: trendWindow === w ? colors.primary : "#6b7280" }}>
                            {w} {t("trend_months")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT — legend */}
<div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                {SLOT_COLORS.map((sc, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: sc.color }} />
                    <span className="text-[11px] font-bold text-gray-600">
                      {slottedKpis?.[i]?.label ?? kpiSlots[i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0">
{trendSeriesDisplay.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendSeriesDisplay} margin={{ top: 5, right: 20, bottom: 0, left: 20 }}>
<defs>
                      {SLOT_COLORS.map((sc, i) => (
                        <linearGradient key={i} id={`areaSlot${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={sc.color} stopOpacity={i === 0 ? 0.35 : 0.25} />
                          <stop offset="100%" stopColor={sc.color} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" vertical={false} />
<XAxis dataKey="label"
                      tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 700 }}
                      axisLine={false} tickLine={false}
                      interval={(() => {
                        if (trendWindow <= 12) return 0;   // every month
                        if (trendWindow <= 24) return 2;   // every 3 months
                        if (trendWindow <= 36) return 3;   // every 4 months
                        return 5;                          // every 6 months
                      })()} />
<YAxis
                      tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600, dx: 30 }}
                      axisLine={false} tickLine={false}
                      tickFormatter={fmtBig}
                      width={0}
                      mirror />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const fullLabel = payload[0]?.payload?.fullLabel ?? "";
                      return (
                        <div className="bg-white/95 backdrop-blur-md border border-gray-100 rounded-xl shadow-xl px-3 py-2 text-xs">
                          <p className="font-black text-gray-700 mb-1">{fullLabel}</p>
                          {payload.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 py-0.5">
                              <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                              <span className="text-gray-500 font-medium">{p.name}:</span>
                              <span className="font-black text-gray-700">{fmtBig(p.value)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }} />
{SLOT_COLORS.map((sc, i) => (
                    <Area
                      key={i}
                      type="monotone"
                      dataKey={`slot${i}`}
                      name={slottedKpis?.[i]?.label ?? kpiSlots[i]}
                      stroke={sc.color}
                      strokeWidth={i === 0 ? 2 : 1.6}
                      fill={`url(#areaSlot${i})`}
                      isAnimationActive
                      dot={false}
                    />
                  ))}
                  </AreaChart>
                </ResponsiveContainer>
) : (
                <div className="flex items-center justify-center h-full text-gray-300 text-xs">
                  {trendLoading ? <Loader2 size={20} className="animate-spin" /> : t("home_no_trend")}
                </div>
              )}
            </div>
              </>
            )}
          </div>

          <div className="relative rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-100 p-4 flex flex-col group/breakdown overflow-hidden"
            style={{ animation: "kCardEntry 0.6s ease-out 0.35s both", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.12), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>

            {/* Header */}
            <div className="mb-3 flex-shrink-0 flex items-start justify-between gap-2">
<div>
<p className="text-[12px] font-black uppercase tracking-widest text-gray-400">
                  {activeCustomStructure ? activeCustomStructure.name : activeView.label}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {activeCustomStructure ? (activeCustomStructure.description || "Custom breakdown") : activeView.description}
                </p>
              </div>
           <div className="relative flex-shrink-0" ref={breakdownSettingsRef} style={{ overflow: "visible", zIndex: 10 }}>
<button
                  onClick={() => setBreakdownSettingsOpen(o => !o)}
                  className="w-7 h-7 rounded-xl flex items-center justify-center transition-all duration-200 opacity-0 group-hover/breakdown:opacity-100"
                  style={{
                    background: breakdownSettingsOpen ? colors.primary : `${colors.primary}12`,
                    color: breakdownSettingsOpen ? "#fff" : colors.primary,
                    opacity: breakdownSettingsOpen ? 1 : undefined,
                  }}
                >
                  <Settings size={12} />
                </button>
{breakdownSettingsOpen && (
                  <div
className="absolute right-0 top-full mt-2 z-[500] rounded-2xl p-2 flex flex-col gap-1"
                    style={{
                      width: 220,
                      background: "rgba(255,255,255,0.99)",
                      backdropFilter: "blur(24px)",
                      border: "1px solid rgba(26,47,138,0.08)",
                      boxShadow: "0 20px 50px -12px rgba(26,47,138,0.22)",
                     animation: "pickerFoldDown 320ms cubic-bezier(0.34,1.56,0.64,1)",
        transformOrigin: "top center",
                    }}

                    onClick={e => e.stopPropagation()}
                  >
<p className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-400 px-2 pt-1 pb-0.5">{t("breakdown_view_label")}</p>
                    {BREAKDOWN_VIEWS.map((v, vi) => {
                      const active = v.id === activeBreakdownView;
                      return (
                        <button key={v.id}
                          onClick={() => { setActiveBreakdownView(v.id); setBreakdownSettingsOpen(false); }}
                          className="flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-all duration-150 w-full"
                          style={{ background: active ? colors.primary : "transparent", animation: `kCardEntry 0.3s ease-out ${vi * 0.05}s both` }}>
                          <span className="text-base leading-none">{v.icon}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-black truncate" style={{ color: active ? "#fff" : "#374151" }}>{v.label}</p>
                            <p className="text-[9px] truncate mt-0.5" style={{ color: active ? "rgba(255,255,255,0.65)" : "#9ca3af" }}>{v.description}</p>
                          </div>
                          {active && <div className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0 ml-auto" />}
                        </button>
                      );
                    })}

{/* Library entry point */}
                    <div className="mt-1 pt-1 border-t border-gray-100">
                      <button
                        onClick={() => { setBreakdownLibraryOpen(true); setBreakdownSettingsOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all hover:bg-gray-50">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ background: `${colors.primary}15`, color: colors.primary }}>
                          <Layers size={10} />
                        </div>
<p className="text-xs font-black" style={{ color: colors.primary }}>
                          Custom breakdowns
                        </p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Rows */}
            {costBreakdown.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1 hide-scrollbar">
{costBreakdown.map((c, i) => {
const absTot = Math.abs(totalCosts);
                  const pct = absTot > 0 ? (Math.abs(c.value) / absTot) * 100 : 0;
                  const barColor = activeCustomStructure
                    ? (c.groupColor ?? colors.primary)
                    : c.isIncome ? (colors.tertiary ?? "#57aa78") : costColors[i % costColors.length];
                  const changeIsGood = c.isIncome ? c.change > 0 : c.change < 0;
                  const changeColor = c.change == null ? "text-gray-300" : changeIsGood ? "text-emerald-500" : "text-red-500";
                  const isActive = drillTag === c.tag && middleCardView === "tag_drill";
                  return (
                    <div key={`${activeBreakdownView}-${c.tag}`}
                      onClick={() => {
                        if (isActive) { setMiddleCardView("trend"); setDrillTag(null); }
                        else          { setDrillTag(c.tag); setMiddleCardView("tag_drill"); }
                      }}
                      className="flex flex-col gap-1 cursor-pointer px-2 -mx-2 py-1 -my-1 rounded-lg transition-colors"
                      style={{
                        animation: `kCardEntry 0.4s ease-out ${i * 0.04}s both`,
                        background: isActive ? `${barColor}12` : "transparent",
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(0,0,0,0.025)"; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                    > 
<div className="flex items-center justify-between gap-2 text-[10px]">
<div className="flex items-center gap-1.5 min-w-0">
                          {activeCustomStructure ? (
                            <div className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: (c.groupSign ?? "+") === "+" ? "#16a34a" : "#dc2626" }} />
                          ) : (
                            c.isIncome && <div className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: colors.tertiary ?? "#57aa78" }} />
                          )}
                          <span className="font-bold text-gray-700 truncate" title={c.name}>{c.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-mono font-black text-gray-800">{fmtBig(Math.abs(c.value))}</span>
                          {c.change != null && (
                            <span className={`flex items-center gap-0.5 font-black tabular-nums ${changeColor}`} style={{ fontSize: 11 }}>
                              {c.change > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                              {Math.abs(c.change).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor} 0%, ${barColor}cc 100%)` }} />
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono text-right">{pct.toFixed(1)}%</div>
                    </div>
                  );
                })}
<div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between text-[12px]">
<span className="font-black uppercase tracking-widest text-gray-600">{t("cost_total")}</span>
                  <span className="font-mono font-black text-gray-900">{fmtBig(totalCosts)}</span>
                </div>
              </div>
            ) : (
<div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-4">
                {loading ? (
                  <Loader2 size={20} className="animate-spin text-gray-300" />
                ) : (
                  <>
                    <p className="text-xs font-black text-gray-400">
                      {activeCustomStructure ? "No data for these accounts" : t("home_no_costs")}
                    </p>
                    {activeCustomStructure && (
                      <p className="text-[10px] text-gray-300 leading-relaxed">
                        The accounts in this structure have no entries for {periodLabel}. Edit the structure and pick accounts shown in green.
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
            className="lg:col-span-3 relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-100 p-4 flex flex-col text-left transition-all hover:border-gray-200 group/ranking"
            style={{
              boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18), 0 2px 8px -2px rgba(0,0,0,0.08)",
              animation: "kCardEntry 0.6s ease-out 0.45s both",
              cursor: !rankingSelectorOpen && topByRevenue.length > 0 ? "pointer" : "default",
            }}>
{!rankingSelectorOpen && (
              <div className="mb-2.5 flex-shrink-0 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 flex-shrink-0">{t("home_ranking")}</p>
                  <span className="h-px w-3 bg-gray-200 flex-shrink-0" />
<p className="text-[11px] text-gray-400 truncate">
                    {t("rank_by")} {rankingKpiLabel} {topByRevenue.length > 3
                      ? `· ${t("rank_top3_of")} ${topByRevenue.length} · ${t("rank_click_expand")}`
                      : topByRevenue.length > 0
                        ? `· ${topByRevenue.length} ${topByRevenue.length === 1 ? t("rank_entry") : t("rank_entries")} · ${t("rank_click_expand")}`
                        : `· ${t("rank_no_data")}`}
                  </p>
                </div>
<div className="flex items-center gap-2 flex-shrink-0">
                 {allCoLoading && <Loader2 size={12} className="animate-spin text-gray-300" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); setRankingSelectorOpen(true); }}
                    className="w-7 h-7 rounded-xl flex items-center justify-center transition-all duration-200 opacity-0 group-hover/ranking:opacity-100"
                    style={{ background: `${colors.primary}12`, color: colors.primary }}
                  >
                    <Settings size={12} />
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
<div className="flex-1 min-h-0 flex flex-col justify-around gap-1.5 pb-1">
               
                {topByRevenue.length > 0 ? (
                  topByRevenue.slice(0, 3).map((c, i) => {
                    const max = topByRevenue[0].value;
                    const pct = max > 0 ? (c.value / max) * 100 : 0;
                    return (
                      <div key={c.name}
                        className="grid items-center gap-3"
                        style={{
                          gridTemplateColumns: "120px 1fr 80px",
                          animation: `kCardEntry 0.4s ease-out ${i * 0.05}s both`,
                        }}>
                        <span className="text-[12px] font-bold text-gray-800 truncate" title={c.name}>{c.name}</span>
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${colors.primary}cc 0%, ${colors.primary} 100%)` }} />
                        </div>
                        <span className="text-[12px] font-mono font-black text-right" style={{ color: colors.primary }}>{fmtBig(c.value)}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-300 text-xs">
                    {allCoLoading ? <Loader2 size={20} className="animate-spin" /> : t("no_data")}
                  </div>
                )}
              </div>
            )}
          </div>

<div className="grid grid-cols-2 gap-2">
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