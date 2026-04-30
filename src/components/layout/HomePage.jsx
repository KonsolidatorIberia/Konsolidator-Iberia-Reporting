import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  TrendingUp, DollarSign, Target, Activity,
  Building2, Layers, Database, Network, Loader2, ArrowUp, ArrowDown,
  Sparkles, ChevronRight, Wallet,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useSettings, useTypo } from "./SettingsContext.jsx";

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
    if (ga.AccountCode && ga.SumAccountCode) {
      parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
    }
  }

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

  console.log(`[HomeResolver] ${standard} mapping loaded: ${ccTagToCodes.size} cc_tags, ${sectionCodes.size} sections, ${taggedCount}/${totalAccounts} accounts tagged via inheritance`);

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
    console.error("[HomeResolver] kpi_definitions returned non-array:", defs);
    return [];
  }

  const overrideByKpi = new Map();
  if (Array.isArray(overrides)) {
    overrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  }

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
        console.error("[HomeResolver] load failed:", e);
        setState(s => ({ ...s, ready: true, error: String(e?.message ?? e) }));
      });

    return () => { cancelled = true; };
  }, [standard, groupAccounts]);

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

const MONTHS_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const NI_COLOR = "#7c3aed";
const NI_ACCENT = "#a855f7";

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

// Convert an amount in `from` currency to `to` currency using the rate map
// (Map<currency, rate>). Convention discovered empirically below; we try
// `amount * rate` first ("1 unit of from = rate units of to") and assume
// that's correct. If the API uses the opposite convention we flip it.
//
// CONVENTION: We will configure this once we know the API. For now:
//   amountInTo = amountInFrom * (rateFrom / rateTo)
// Where rate is "1 currency_X = rateX units of base". This is the standard
// "rate against base" convention. If `from === to`, return as-is.
function convertAmount(amount, fromCurrency, toCurrency, rateMap) {
  if (!amount) return 0;
  if (!fromCurrency || !toCurrency) return amount;
  if (fromCurrency === toCurrency) return amount;
  const rateFrom = rateMap.get(fromCurrency);
  const rateTo   = rateMap.get(toCurrency);
  if (rateFrom == null || rateTo == null) return amount; // best effort
  if (rateTo === 0) return amount;
  return amount * (rateFrom / rateTo);
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
    const acType = r.AccountType ?? r.accountType ?? "";
    if (!ac) return;
    if (sumAccountCodes && sumAccountCodes.has(ac)) return;
    if (acType && acType !== "P/L") return;
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
function HeroKPI({ label, code, value, prevValue, trend, color, accent, icon: Icon, delay = 0, loading }) {
  const change = prevValue && prevValue !== 0 ? ((value - prevValue) / Math.abs(prevValue)) * 100 : null;
  const isPositive = change != null ? change >= 0 : null;
  const sparklineData = useMemo(() => (trend ?? []).map((v, i) => ({ x: i, y: v })), [trend]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 transition-all duration-500 hover:scale-[1.015] hover:shadow-2xl group h-full flex flex-col"
      style={{
        background: `linear-gradient(135deg, ${color}f0 0%, ${color} 70%, ${accent ?? color} 100%)`,
        boxShadow: `0 6px 20px -8px ${color}90, 0 3px 10px -4px ${color}60, inset 0 1px 0 rgba(255,255,255,0.15)`,
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
              {code && <p className="text-[9px] text-white/45 font-mono mt-0.5 truncate">{code}</p>}
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
            <p className="text-[9px] text-white/55 mt-0.5 font-medium">vs {fmtBig(prevValue)}</p>
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

function MiniTile({ label, value, icon: Icon, color, delay = 0 }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-3 bg-white/95 backdrop-blur-sm border border-gray-100/80 hover:shadow-md transition-all duration-300 group"
      style={{ animation: `kCardEntry 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s both` }}
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
   MAIN
═══════════════════════════════════════════════════════════════ */
export default function HomePage({ token, initialData = {} }) {
  const { colors } = useSettings();
  const headerStyle = useTypo("header1");

  const sources    = initialData.sources ?? [];
  const structures = initialData.structures ?? [];
  const companies  = initialData.companies ?? [];
  const dimensions = initialData.dimensions ?? [];
  const groupAccountsProp = initialData.groupAccounts ?? [];

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
  } = useResolvedKpiList(groupAccounts);

  // Cost breakdown rows from PL table — fetched independently to avoid
  // touching the resolver. Same standard detection.
  const [plRowsForCosts, setPlRowsForCosts] = useState([]);
  const [sectionsForCosts, setSectionsForCosts] = useState([]);
  useEffect(() => {
    if (!detectedStandard) return;
    const plTable  = STANDARD_TO_PL_TABLE[detectedStandard];
    const secTable = STANDARD_TO_SECTION_TABLE[detectedStandard];
    if (!plTable || !secTable) return;
    Promise.all([
      sbGet(`${plTable}?select=*&order=sort_order.asc`),
      sbGet(`${secTable}?select=*&order=sort_order.asc`),
    ]).then(([rows, secs]) => {
      setPlRowsForCosts(Array.isArray(rows) ? rows : []);
      setSectionsForCosts(Array.isArray(secs) ? secs : []);
    }).catch(() => {});
  }, [detectedStandard]);

  const prefetch = useMemo(() => {
    const raw = initialData.__homePrefetch ?? null;
    if (!raw) return null;
    const period = extractPeriod(raw) ?? extractPeriod(raw.latestPeriod);
    if (!period) return null;
    return {
      year: period.year,
      month: period.month,
      current: raw.current ?? raw.currentRows ?? [],
      prev:    raw.prev    ?? raw.prevRows    ?? [],
      trend:   raw.trend   ?? raw.trendRows   ?? [],
    };
  }, [initialData]);

  const [year, setYear]   = useState(prefetch?.year ? String(prefetch.year) : "");
  const [month, setMonth] = useState(prefetch?.month ? String(prefetch.month) : "");
  const source = useMemo(() => {
    const s = sources[0];
    return typeof s === "object" ? (s.source ?? s.Source ?? "") : (s ?? "");
  }, [sources]);
  const structure = useMemo(() => {
    const s = structures[0];
    return typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : (s ?? "");
  }, [structures]);
  const company = useMemo(() => {
    const c = companies[0];
    return typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : (c ?? "");
  }, [companies]);

  const [currentRows, setCurrentRows]     = useState(prefetch?.current ?? []);
  const [prevRows, setPrevRows]           = useState(prefetch?.prev ?? []);
  const [trendRows, setTrendRows]         = useState(prefetch?.trend ?? []);
const [allCoCurrentRows, setAllCoCurrentRows] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [trendLoading, setTrendLoading]   = useState(false);
  const [allCoLoading, setAllCoLoading]   = useState(false);
  const [probing, setProbing]             = useState(false);

  // FX rates indexed by `${year}-${month}-${currencyCode}` → endRate
  // Used only to convert the multi-company ranking to the group's reporting
  // currency. Rest of the dashboard runs in parent currency natively.
  const [fxRates, setFxRates] = useState(new Map());
  const [fxLoading, setFxLoading] = useState(false);

  const trendCacheRef = useRef(new Map());
  const allCoCacheRef = useRef(new Map());
  const fxFetchedRef = useRef(false);

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

// Fetch all exchange rates once. The endpoint is small (one row per source ×
  // year × month × currency) so we pull everything and index in memory.
  useEffect(() => {
    if (fxFetchedRef.current) return;
    if (!token || !source) return;
    fxFetchedRef.current = true;
    setFxLoading(true);
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/v2/exchange-rates`, { headers: headers() });
        if (!res.ok) { setFxLoading(false); return; }
        const json = await res.json();
const rows = json.value ?? (Array.isArray(json) ? json : []);
        if (rows.length > 0) {
          const vndRow = rows.find(r => {
            const cc = String(r.currencyCode ?? r.CurrencyCode ?? "").toUpperCase();
            return cc === "VND";
          });
          console.log("[FX-RAW] sample VND row:", vndRow);
          console.log("[FX-RAW] all field names of first row:", Object.keys(rows[0]));
          console.log("[FX-RAW] first row full:", rows[0]);
        }
        const map = new Map();
        rows.forEach(r => {
          const src = String(r.source ?? r.Source ?? "").trim();
          if (src && src !== source) return; // only rates for the active source
          const y = Number(r.year ?? r.Year);
          const m = Number(r.month ?? r.Month);
          const cc = String(r.currencyCode ?? r.CurrencyCode ?? "").trim().toUpperCase();
          if (!Number.isFinite(y) || !Number.isFinite(m) || !cc) return;
// Closing rate (end of month). Custom override wins if present and non-zero.
          const customRate = r.customEndRate ?? r.CustomEndRate;
          const defaultRate = r.defaultEndRate ?? r.DefaultEndRate;
          const rate = (customRate != null && customRate !== 0)
                       ? customRate
                       : defaultRate;
          if (rate == null || rate === 0) return;
          map.set(`${y}-${m}-${cc}`, Number(rate));
        });
        console.log(`[FX] loaded ${map.size} rates for source=${source}`);
        // Quick sanity print: rates for VND and EUR for a recent month, to
        // confirm convention. A "1 EUR = 26000 VND" world means VND > EUR;
        // a "1 VND = 0.000038 EUR" world means VND < EUR.
const vndKeys = [...map.keys()].filter(k => k.endsWith("-VND")).slice(0, 5);
        const sampleVnd = vndKeys.map(k => [k, map.get(k)]);
        const eurKeys = [...map.keys()].filter(k => k.endsWith("-EUR")).slice(0, 5);
        const sampleEur = eurKeys.map(k => [k, map.get(k)]);
        const allCurrencies = new Set([...map.keys()].map(k => k.split("-").pop()));
        console.log(`[FX] sample VND keys+rates:`, sampleVnd);
        console.log(`[FX] sample EUR keys+rates:`, sampleEur);
        console.log(`[FX] all currencies in map:`, [...allCurrencies]);
        console.log(`[FX] looking for: 2025-12-VND, exists?`, map.has("2025-12-VND"));
        setFxRates(map);
      } catch (e) {
        console.error("[FX] fetch failed:", e);
      } finally {
        setFxLoading(false);
      }
    })();
  }, [token, source, headers]);

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
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ year: found.y, month: found.m })); } catch {}
          setProbing(false); return;
        }
      }
      setProbing(false);
    })();
  }, [source, structure, company, token, year, month, headers]);

  // Fetch current + prev (for KPI deltas)
  const initialFetchSkippedRef = useRef(!!prefetch);
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
    if (initialFetchSkippedRef.current) { initialFetchSkippedRef.current = false; return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [cur, prev] = await Promise.all([
        fetchPeriod(year, month, source, structure, company),
        Number(month) > 1 ? fetchPeriod(year, String(Number(month) - 1), source, structure, company) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setCurrentRows(cur);
      setPrevRows(prev);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [year, month, source, structure, company, fetchPeriod]);

// Fetch trend — extend the rolling 24-month window backwards so the chart
  // always starts on a January (option B). The window covers from January of
  // (anchorYear − 1) up to anchorYear/anchorMonth inclusive, plus one prior
  // month (December of anchorYear−2) for the monthly delta of the first
  // visible point. Each item is { year, month, rows }.
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
    const cacheKey = `${source}|${structure}|${company}|${year}|${month}|jan-anchored`;
    const cached = trendCacheRef.current.get(cacheKey);
    if (cached) { setTrendRows(cached); return; }

    let cancelled = false;
    setTrendLoading(true);
    (async () => {
      const anchorY = Number(year), anchorM = Number(month);
      // Visible range: from January of (anchorY − 1) to anchor month inclusive.
      const startY = anchorY - 1, startM = 1;
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
  }, [year, month, source, structure, company, fetchPeriod]);

  // Fetch all-companies YTD for ranking
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

  // Hero KPIs identification — by id from kpi_definitions
  const heroKpis = useMemo(() => {
    if (!resolverReady || kpiList.length === 0) return null;
    const find = (id) => kpiList.find(k => k.id === id);
    const revenue   = find("revenue");
    const ebitda    = find("ebitda");
    const ebit      = find("ebit");
    const netResult = find("net_result") ?? find("net_income");
    if (!revenue && !ebitda && !ebit && !netResult) return null;
    return { revenue, ebitda, ebit, netResult };
  }, [kpiList, resolverReady]);

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

  // Monthly pivot for the CURRENT period: subtract previous-month YTD from
  // current-month YTD per account. For January, monthly = YTD (no prior month
  // in the same fiscal year).
  const currentMonthlyPivot = useMemo(() => {
    const isJanuary = parseInt(month) === 1;
    if (isJanuary) return currentYtdPivot;
    const out = new Map();
    const allCodes = new Set([...currentYtdPivot.keys(), ...prevYtdPivot.keys()]);
    allCodes.forEach(ac => {
      out.set(ac, (currentYtdPivot.get(ac) ?? 0) - (prevYtdPivot.get(ac) ?? 0));
    });
    return out;
  }, [currentYtdPivot, prevYtdPivot, month]);

  // Monthly pivot for the PREVIOUS period (used as the "vs" comparison in hero
  // cards). We need YTD of the month BEFORE prev to subtract — pull it from
  // the trend results when available; otherwise fall back to YTD only.
  const prevMonthlyPivot = useMemo(() => {
    const prevM = Number(month) - 1;
    if (prevM < 1) return prevYtdPivot; // best effort: Dec of prior year as YTD
    if (prevM === 1) return prevYtdPivot; // Jan monthly = Jan YTD
    // Find month-2 in trendRows
    const prevPrevM = prevM - 1;
    const prevPrevY = Number(year);
    const found = trendRows.find(t => Number(t.year) === prevPrevY && Number(t.month) === prevPrevM);
    if (!found) return prevYtdPivot; // best effort
    const prevPrevYtd = buildPivotFromRows(found.rows, sumAccountCodes);
    const out = new Map();
    const allCodes = new Set([...prevYtdPivot.keys(), ...prevPrevYtd.keys()]);
    allCodes.forEach(ac => {
      out.set(ac, (prevYtdPivot.get(ac) ?? 0) - (prevPrevYtd.get(ac) ?? 0));
    });
    return out;
  }, [prevYtdPivot, month, year, trendRows, sumAccountCodes]);

  // Hero KPIs use MONTHLY values (matches the "Monthly" column in
  // KpiIndividualesPage). The "vs prevValue" badge uses the previous month's
  // monthly value.
  const kpiValues = useMemo(() => {
    if (!heroKpis || kpiList.length === 0) return null;
    const cacheCur = new Map();
    const cachePrev = new Map();
    const get = (id) => ({
      current: computeKpiById(id, currentMonthlyPivot, kpiList, ccTagToCodes, sectionCodes, cacheCur),
      prev:    computeKpiById(id, prevMonthlyPivot,    kpiList, ccTagToCodes, sectionCodes, cachePrev),
    });
    return {
      revenue:   get("revenue"),
      ebitda:    get("ebitda"),
      ebit:      get("ebit"),
      netIncome: get(heroKpis.netResult?.id ?? "net_result"),
    };
  }, [heroKpis, currentMonthlyPivot, prevMonthlyPivot, kpiList, ccTagToCodes, sectionCodes]);
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

const cache = new Map();
      out.push({
        idx: out.length,
        label: `${MONTHS_ABBR[m - 1]} ${String(y).slice(-2)}`,
        fullLabel: `${MONTHS_ABBR[m - 1]} ${y}`,
        Revenue:   computeKpiById("revenue",    monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache),
        EBITDA:    computeKpiById("ebitda",     monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache),
        EBIT:      computeKpiById("ebit",       monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache),
        NetIncome: computeKpiById(heroKpis.netResult?.id ?? "net_result", monthlyPivot, kpiList, ccTagToCodes, sectionCodes, cache),
      });
    }
    return out;
  }, [trendRows, heroKpis, kpiList, ccTagToCodes, sectionCodes, sumAccountCodes]);

  // Sparklines — last 12 monthly points
  const sparklines = useMemo(() => {
    const last12 = trendSeries.slice(-12);
    return {
      revenue:   last12.map(t => t.Revenue),
      ebitda:    last12.map(t => t.EBITDA),
      ebit:      last12.map(t => t.EBIT),
      netIncome: last12.map(t => t.NetIncome),
    };
  }, [trendSeries]);

  // Top by revenue (multi-company): group rows by company, build pivot per company,
  // evaluate revenue KPI on each. Same approach as KpiIndividualesPage.
// Detected reporting currency (parent's currency = most common in journal).
  const reportingCurrency = useMemo(
    () => detectReportingCurrency(allCoCurrentRows),
    [allCoCurrentRows]
  );

  const topByRevenue = useMemo(() => {
    if (!heroKpis?.revenue || !allCoCurrentRows.length || kpiList.length === 0) return [];

    // Group rows by company, but ALSO track each company's currency.
    const byCompany = new Map();
    allCoCurrentRows.forEach(r => {
      const co = String(r.CompanyShortName ?? r.companyShortName ?? "");
      if (!co) return;
      if (!byCompany.has(co)) byCompany.set(co, { rows: [], currency: null });
      const entry = byCompany.get(co);
      entry.rows.push(r);
      if (!entry.currency) {
        const cc = String(r.CurrencyCode ?? r.currencyCode ?? "").trim().toUpperCase();
        if (cc) entry.currency = cc;
      }
    });

    const y = Number(year), m = Number(month);

    const out = [];
    byCompany.forEach(({ rows: coRows, currency }, name) => {
      const pivot = buildPivotFromRows(coRows, sumAccountCodes);
      const cache = new Map();
      let v = computeKpiById("revenue", pivot, kpiList, ccTagToCodes, sectionCodes, cache);
      if (v === null || isNaN(v) || v <= 0) return;
// Look up the rate for the current period; if 0 or missing, walk back
      // up to 12 months trying earlier rate snapshots (the FX feed sometimes
      // lags the journal by a month or two).
      const findRate = (cc) => {
        let yy = y, mm = m;
        for (let i = 0; i < 12; i++) {
          const r = fxRates.get(`${yy}-${mm}-${cc}`);
          if (r != null && r !== 0) return { rate: r, yy, mm };
          mm--; if (mm < 1) { mm = 12; yy--; }
        }
        return null;
      };

// Walk back up to 24 months to find a non-zero rate (FX feed lags).
const lookupRate = (cc) => {
        const allKeys = Array.from(fxRates.keys());
        const matchingKeys = allKeys.filter(k => k.endsWith(`-${cc}`));
        console.log(`[FX-DEEP] ${cc}: total keys=${allKeys.length}, matching=${matchingKeys.length}, first 3 of all:`, allKeys.slice(0, 3), `, first 3 matching:`, matchingKeys.slice(0, 3));
        for (let i = matchingKeys.length - 1; i >= 0; i--) {
          const k = matchingKeys[i];
          const r = fxRates.get(k);
          console.log(`[FX-DEEP]   trying key="${k}" -> rate=${r}`);
          if (r != null && r !== 0) {
            console.log(`[FX-DEEP] ${cc}: FOUND rate=${r} at key=${k}`);
            return r;
          }
        }
        console.log(`[FX-DEEP] ${cc}: nothing matched`);
        return null;
      };
console.log(`[FX-CHECK] ${name}: currency=${currency} reportingCurrency=${reportingCurrency} fxSize=${fxRates.size}`);
      let converted = v;
      if (currency && currency !== reportingCurrency && fxRates.size > 0) {
        const rateFrom = lookupRate(currency);
        const rateTo   = lookupRate(reportingCurrency) ?? 1;
        console.log(`[FX-RATES] ${name}: rateFrom(${currency})=${rateFrom} rateTo(${reportingCurrency})=${rateTo}`);
        if (rateFrom != null && rateFrom !== 0) {
          converted = (v * rateFrom) / rateTo;
        }
      }

      console.log(`[topByRevenue] ${name}: rev=${v} ${currency} → ${converted.toFixed(0)} ${reportingCurrency}`);
      out.push({ name, value: converted, originalValue: v, originalCurrency: currency });
    });
    return out.sort((a, b) => b.value - a.value).slice(0, 6);
  }, [allCoCurrentRows, heroKpis, kpiList, ccTagToCodes, sectionCodes, sumAccountCodes, fxRates, reportingCurrency, year, month]);

  const periodLabel = useMemo(() => {
    if (!year || !month) return probing ? "Buscando…" : "—";
    const mNum = Number(month);
    if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) return "—";
    return `${MONTHS_ABBR[mNum - 1]} ${year}`;
  }, [year, month, probing]);

  const anyLoading = loading || trendLoading || probing || allCoLoading || !resolverReady;

// Cost breakdown — driven by cc_tags. Uses the cc_tag mapping the resolver
  // already built. We pick all expense-side cc_tags, label them with
  // human-readable names, and rank them by absolute monthly value. Comparison
  // is monthly vs previous-month monthly (option C).
  const COST_CC_TAGS = useMemo(() => ([
    { tag: "CC_02-Cost Of Sales",                            label: "Cost of Sales" },
    { tag: "CC_05-Lease Expense",                            label: "Lease Expense" },
    { tag: "CC_06-General and administrative",               label: "General & Administrative" },
    { tag: "CC_07-Employee Expense",                         label: "Employee Expense" },
    { tag: "CC_08-R&D",                                      label: "R&D" },
    { tag: "CC_09-Impairment Gain (Loss) on Fixed Assets",   label: "Impairment (Fixed Assets)" },
    { tag: "CC_10-Depreciation and Amotization",             label: "Depreciation & Amortization" },
    { tag: "CC_11-Other Operating Expenses",                 label: "Other Operating Expenses" },
    { tag: "CC_15-Interest expense",                         label: "Interest Expense" },
    { tag: "CC_16-Other financial expense",                  label: "Other Financial Expense" },
    { tag: "CC_18-Income Tax",                               label: "Income Tax" },
  ]), []);

  const ccValue = useCallback((pivot, tag) => {
    const codes = ccTagToCodes.get(tag);
    if (!codes || codes.length === 0) return 0;
    return -pivotSum(pivot, codes);
  }, [ccTagToCodes]);

  const costBreakdown = useMemo(() => {
    if (!ccTagToCodes || ccTagToCodes.size === 0) return [];
    if (!currentMonthlyPivot || currentMonthlyPivot.size === 0) return [];

    const rows = COST_CC_TAGS.map(({ tag, label }) => {
      const curr = ccValue(currentMonthlyPivot, tag);
      const prev = ccValue(prevMonthlyPivot,    tag);
      const currAbs = Math.abs(curr);
      const prevAbs = Math.abs(prev);
      let change = null;
      if (prevAbs > 0.005) change = ((currAbs - prevAbs) / prevAbs) * 100;
      return { tag, name: label, value: currAbs, prevValue: prevAbs, change };
    })
      .filter(r => r.value > 0.005)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    return rows;
  }, [COST_CC_TAGS, ccTagToCodes, currentMonthlyPivot, prevMonthlyPivot, ccValue]);

  const totalCosts = useMemo(
    () => costBreakdown.reduce((s, c) => s + c.value, 0),
    [costBreakdown]
  );

  const costColors = useMemo(() => {
    return [colors.primary ?? "#1a2f8a", "#3b54b8", "#7c5fcc", "#b370cc", "#cf6595", "#cf5070", "#cf3940"];
  }, [colors]);

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col">
      <ConsolidationBackground primary={colors.primary ?? "#1a2f8a"} />

      <style>{`
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
        .hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
      <div className="relative z-10 flex flex-col flex-1 min-h-0 px-5 py-3 gap-3 w-full">
        {/* HEADER */}
        <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0"
          style={{ animation: "kFadeInUp 0.5s ease-out both" }}>
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-10 rounded-full" style={{ background: colors.primary }} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none mb-0.5 flex items-center gap-2">
                Dashboard
                {detectedStandard && (
                  <span className="ml-1 px-2 py-0.5 rounded-full text-[8px] font-black tracking-wider"
                    style={{ background: `${colors.primary}15`, color: colors.primary, border: `1px solid ${colors.primary}30` }}>
                    {detectedStandard}
                  </span>
                )}
              </p>
              <h1 style={{ ...headerStyle, lineHeight: 1, fontSize: "1.5rem" }}>Summary</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm">
              <div className="w-2 h-2 rounded-full" style={{ background: colors.primary, boxShadow: `0 0 8px ${colors.primary}` }} />
              <span className="text-[11px] font-black text-gray-700 uppercase tracking-wider">{periodLabel}</span>
              {company && (<><ChevronRight size={11} className="text-gray-300" />
                <span className="text-[11px] font-medium text-gray-500">{company}</span></>)}
            </div>
            {anyLoading && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200">
                <Loader2 size={11} className="animate-spin text-amber-500" />
                <span className="text-[10px] font-black text-amber-600 uppercase">
                  {probing ? "Probing" : !resolverReady ? "Mapping" : trendLoading ? "Trend" : allCoLoading ? "Multi-co" : "Loading"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* HERO KPIS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0" style={{ minHeight: 140 }}>
          {heroKpis && kpiValues ? (
            <>
              <HeroKPI label="Revenue" code={heroKpis.revenue?.id}
                value={kpiValues.revenue.current} prevValue={kpiValues.revenue.prev}
                trend={sparklines.revenue} color={colors.primary ?? "#1a2f8a"}
                accent={`${colors.primary}cc`} icon={DollarSign} loading={loading} delay={0} />
              <HeroKPI label="EBITDA" code={heroKpis.ebitda?.id}
                value={kpiValues.ebitda.current} prevValue={kpiValues.ebitda.prev}
                trend={sparklines.ebitda} color={colors.secondary ?? "#CF305D"}
                accent={`${colors.secondary ?? "#CF305D"}cc`} icon={Activity} loading={loading} delay={0.06} />
              <HeroKPI label="EBIT" code={heroKpis.ebit?.id}
                value={kpiValues.ebit.current} prevValue={kpiValues.ebit.prev}
                trend={sparklines.ebit} color={colors.tertiary ?? "#57aa78"}
                accent={`${colors.tertiary ?? "#57aa78"}cc`} icon={Target} loading={loading} delay={0.12} />
              <HeroKPI label="Net Income" code={heroKpis.netResult?.id}
                value={kpiValues.netIncome.current} prevValue={kpiValues.netIncome.prev}
                trend={sparklines.netIncome} color={NI_COLOR} accent={NI_ACCENT}
                icon={TrendingUp} loading={loading} delay={0.18} />
            </>
          ) : (
            <div className="col-span-full bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-100 p-6 text-center">
              {!resolverReady || probing ? (
                <><Loader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: colors.primary }} />
                <p className="text-gray-500 font-semibold text-xs">
                  {probing ? "Buscando último periodo con datos…" : "Detectando estándar contable…"}
                </p></>
              ) : (
                <><Sparkles size={24} className="mx-auto mb-2 text-gray-300" />
                <p className="text-gray-500 font-semibold text-xs">
                  {!groupAccounts.length ? "Esperando group-accounts…" : "Estándar contable no reconocido"}
                </p></>
              )}
            </div>
          )}
        </div>

        {/* MIDDLE */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 flex-1 min-h-0">
          <div className="lg:col-span-3 relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm p-4 flex flex-col"
            style={{ animation: "kCardEntry 0.6s ease-out 0.25s both" }}>
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Monthly · From January {Number(year) - 1}</p>
                <h3 className="text-sm font-black text-gray-800 mt-0.5">KPI Evolution</h3>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                {[
                  { label: "Revenue",  color: colors.primary },
                  { label: "EBITDA",   color: colors.secondary ?? "#CF305D" },
                  { label: "EBIT",     color: colors.tertiary ?? "#57aa78" },
                  { label: "Net Inc.", color: NI_COLOR },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-[9px] font-bold text-gray-500">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {trendSeries.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendSeries} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
                    <defs>
                      <linearGradient id="areaRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colors.primary} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={colors.primary} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="areaEbitda" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colors.secondary ?? "#CF305D"} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={colors.secondary ?? "#CF305D"} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="areaEbit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colors.tertiary ?? "#57aa78"} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={colors.tertiary ?? "#57aa78"} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="areaNi" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={NI_COLOR} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={NI_COLOR} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label"
                      tick={{ fontSize: 9, fill: "#9ca3af", fontWeight: 700 }}
                      axisLine={false} tickLine={false}
                      interval={1} />
                    <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={fmtBig} width={50} />
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
                  <Area type="monotone" dataKey="Revenue"   stroke={colors.primary}                strokeWidth={2}   fill="url(#areaRev)"    isAnimationActive dot={false} />
                    <Area type="monotone" dataKey="EBITDA"    stroke={colors.secondary ?? "#CF305D"} strokeWidth={1.6} fill="url(#areaEbitda)" isAnimationActive dot={false} />
                    <Area type="monotone" dataKey="EBIT"      stroke={colors.tertiary ?? "#57aa78"}  strokeWidth={1.6} fill="url(#areaEbit)"   isAnimationActive dot={false} />
                    <Area type="monotone" dataKey="NetIncome" stroke={NI_COLOR}                      strokeWidth={1.6} fill="url(#areaNi)"     isAnimationActive dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-300 text-xs">
                  {trendLoading ? <Loader2 size={20} className="animate-spin" /> : "Sin datos suficientes"}
                </div>
              )}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm p-4 flex flex-col"
            style={{ animation: "kCardEntry 0.6s ease-out 0.35s both" }}>
<div className="mb-3 flex-shrink-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Cost Structure</p>

            </div>

{costBreakdown.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1 hide-scrollbar">
                {costBreakdown.map((c, i) => {
                  const pct = totalCosts > 0 ? (c.value / totalCosts) * 100 : 0;
                  const barColor = costColors[i % costColors.length];
                  const changeColor =
                    c.change == null ? "text-gray-300"
                      : c.change > 0  ? "text-red-500"
                                       : "text-emerald-500";
                  return (
                    <div key={c.tag} className="flex flex-col gap-1"
                      style={{ animation: `kCardEntry 0.5s ease-out ${0.4 + i * 0.05}s both` }}>
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="font-bold text-gray-700 truncate min-w-0" title={c.name}>{c.name}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-mono font-black text-gray-700">{fmtBig(c.value)}</span>
                          {c.change != null && (
                            <span className={`flex items-center gap-0.5 font-black tabular-nums ${changeColor}`}
                              style={{ fontSize: 9 }}
                              title={`vs prev month: ${fmtBig(c.prevValue)}`}>
                              {c.change > 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                              {Math.abs(c.change).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor} 0%, ${barColor}cc 100%)` }} />
                      </div>
                      <div className="text-[9px] text-gray-400 font-mono text-right">{pct.toFixed(1)}% of total</div>
                    </div>
                  );
                })}
                <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between text-[10px]">
                  <span className="font-black uppercase tracking-widest text-gray-500">Total Opex</span>
                  <span className="font-mono font-black text-gray-800">{fmtBig(totalCosts)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center flex-1 text-gray-300 text-xs">
                {loading ? <Loader2 size={20} className="animate-spin" /> : "Sin costes que mostrar"}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 flex-shrink-0" style={{ minHeight: 130 }}>
          <div className="lg:col-span-3 relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm p-4 flex flex-col"
            style={{ animation: "kCardEntry 0.6s ease-out 0.45s both" }}>
<div className="mb-2 flex-shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ranking · Multi-Company</p>
                {reportingCurrency && (
                  <span className="px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-wider"
                    style={{ background: `${colors.primary}15`, color: colors.primary }}>
                    in {reportingCurrency}
                  </span>
                )}
              </div>
              {(allCoLoading || fxLoading) && <Loader2 size={12} className="animate-spin text-gray-300" />}
            </div>
            <div className="flex-1 min-h-0">
              {topByRevenue.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topByRevenue} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="barRev" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={colors.primary} stopOpacity={0.6} />
                        <stop offset="100%" stopColor={colors.primary} stopOpacity={1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={fmtBig} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#6b7280", fontWeight: 700 }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: `${colors.primary}08` }} />
                    <Bar dataKey="value" fill="url(#barRev)" radius={[0, 8, 8, 0]} isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-300 text-xs">
                  {allCoLoading ? <Loader2 size={20} className="animate-spin" /> : "Sin datos"}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MiniTile label="Companies"   value={companies.length}  icon={Building2} color={colors.primary}                delay={0.55} />
            <MiniTile label="Perímetres"  value={structures.length} icon={Layers}    color={colors.secondary  ?? "#CF305D"} delay={0.6}  />
            <MiniTile label="Dimensions"  value={dimensions.length} icon={Network}   color={colors.tertiary   ?? "#57aa78"} delay={0.65} />
            <MiniTile label="Sources"     value={sources.length}    icon={Database}  color={NI_COLOR}                       delay={0.7}  />
          </div>
        </div>
      </div>
    </div>
  );
}