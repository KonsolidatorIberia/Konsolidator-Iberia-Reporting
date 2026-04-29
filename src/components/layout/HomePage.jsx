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

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

const MONTHS_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const NI_COLOR = "#7c3aed";
const NI_ACCENT = "#a855f7";

/* ═══════════════════════════════════════════════════════════════
   PARSING & FORMATTING
═══════════════════════════════════════════════════════════════ */
function parseAmt(val) {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (!s || s === "—" || s === "-") return 0;
  const hasEuropeanFormat = /\d\.\d{3},\d/.test(s) || (/,/.test(s) && /\./.test(s) && s.indexOf(".") < s.indexOf(","));
  if (hasEuropeanFormat) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
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

function getField(obj, ...names) {
  if (!obj) return undefined;
  for (const n of names) if (obj[n] !== undefined) return obj[n];
  const norm = (s) => String(s).replace(/[_\s-]/g, "").toLowerCase();
  const map = new Map();
  Object.keys(obj).forEach(k => map.set(norm(k), obj[k]));
  for (const n of names) {
    const v = map.get(norm(n));
    if (v !== undefined) return v;
  }
  return undefined;
}

function sumByCode(rows, code, opts = {}) {
  if (!code || !rows?.length) return 0;
  const { skipLocal = true } = opts;
  return rows
    .filter(r => {
      const ac = String(getField(r, "AccountCode", "accountCode") ?? "");
      if (ac !== String(code)) return false;
      if (skipLocal) {
        const lc = getField(r, "LocalAccountCode", "localAccountCode");
        if (lc && String(lc) !== "" && String(lc) !== "null") return false;
      }
      return true;
    })
    .reduce((s, r) => s + parseAmt(getField(r, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod")), 0);
}

function topEntitiesByCode(rows, code, n = 6) {
  if (!code || !rows?.length) return [];
  const byCo = new Map();
  rows.forEach(r => {
    const ac = String(getField(r, "AccountCode", "accountCode") ?? "");
    if (ac !== String(code)) return;
    const lc = getField(r, "LocalAccountCode", "localAccountCode");
    if (lc && String(lc) !== "" && String(lc) !== "null") return;
    const co = String(getField(r, "CompanyShortName", "companyShortName") ?? "");
    if (!co) return;
    const amt = parseAmt(getField(r, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    byCo.set(co, (byCo.get(co) ?? 0) + amt);
  });
  return [...byCo.entries()]
    .map(([name, value]) => ({ name, value: -value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
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
   BACKGROUND VISUAL
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

/* ═══════════════════════════════════════════════════════════════
   MINI TILE
═══════════════════════════════════════════════════════════════ */
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
  const underscoreStyle = useTypo("underscore1");

  const sources    = initialData.sources ?? [];
  const structures = initialData.structures ?? [];
  const companies  = initialData.companies ?? [];
  const dimensions = initialData.dimensions ?? [];
  const groupAccounts = initialData.groupAccounts ?? [];

  console.log("[HomePage] mount — token?", !!token,
    "sources:", sources.length,
    "structures:", structures.length,
    "companies:", companies.length,
    "groupAccounts:", groupAccounts.length,
    "prefetch?", !!initialData.__homePrefetch);

  const prefetchRaw = initialData.__homePrefetch ?? null;
  const prefetch = useMemo(() => {
    if (!prefetchRaw) return null;
    const period = extractPeriod(prefetchRaw) ?? extractPeriod(prefetchRaw.latestPeriod);
    if (!period) return null;
    return {
      year: period.year,
      month: period.month,
      current: prefetchRaw.current ?? prefetchRaw.currentRows ?? [],
      prev:    prefetchRaw.prev    ?? prefetchRaw.prevRows    ?? [],
      trend:   prefetchRaw.trend   ?? prefetchRaw.trendRows   ?? [],
    };
  }, [prefetchRaw]);

  // ── Filters ──────────────────────────────────────────
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

  // ── Data ─────────────────────────────────────────────
  const [currentRows, setCurrentRows]     = useState(prefetch?.current ?? []);
  const [prevRows, setPrevRows]           = useState(prefetch?.prev ?? []);
  const [trendRows, setTrendRows]         = useState(prefetch?.trend ?? []);
  const [allCoCurrentRows, setAllCoCurrentRows] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [trendLoading, setTrendLoading]   = useState(false);
  const [allCoLoading, setAllCoLoading]   = useState(false);
  const [probing, setProbing]             = useState(false);

  const trendCacheRef = useRef(new Map());
  const allCoCacheRef = useRef(new Map());

  // ── Supabase mapping ─────────────────────────────────
  const [kpiMapping, setKpiMapping] = useState(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [detectedStandard, setDetectedStandard] = useState(null);

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  }), [token]);

  /* ─────────────────────────────────────────────────────
     SUPABASE — auto-detect standard + fetch mapping
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!groupAccounts.length) {
      setKpiMapping(null);
      setDetectedStandard(null);
      return;
    }

    const codes = groupAccounts.map(n => String(n.accountCode ?? n.AccountCode ?? ""));
    console.log("[HomePage] codes sample:", codes.slice(0, 10));

    const isPGC           = codes.some(c => /[a-zA-Z]/.test(c) && c.endsWith(".S"));
    const isSpanishIfrsEs = !isPGC && codes.some(c => /\.PL$/.test(c));
    const isSpanishIFRS   = !isPGC && !isSpanishIfrsEs && codes.some(c => /^[A-Z]\.\d/.test(c));
    const isDanish        = !isPGC && !isSpanishIfrsEs && !isSpanishIFRS && codes.some(c => /^\d{5,6}$/.test(c));

    console.log("[HomePage] detection flags:", { isPGC, isSpanishIfrsEs, isSpanishIFRS, isDanish });

    let plTable, secTable, standard;
    if (isPGC)              { plTable = "pgc_pl_rows";              secTable = "pgc_pl_sections";              standard = "PGC"; }
    else if (isSpanishIfrsEs) { plTable = "spanish_ifrs_es_pl_rows"; secTable = "spanish_ifrs_es_pl_sections"; standard = "SpanishIFRS-ES"; }
    else if (isDanish)      { plTable = "danish_ifrs_pl_rows";      secTable = "danish_ifrs_pl_sections";      standard = "DanishIFRS"; }
    else { console.warn("[HomePage] no standard matched"); setKpiMapping(null); setDetectedStandard(null); return; }

    console.log("[HomePage] standard:", standard, "→ fetching", plTable, "+", secTable);
    setDetectedStandard(standard);
    setMappingLoading(true);

    Promise.all([
      fetch(`${SUPABASE_URL}/${plTable}?select=*&order=sort_order.asc`,  { headers: sbHeaders }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/${secTable}?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
    ])
      .then(([rowsArr, secsArr]) => {
        if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) {
          console.error("[HomePage] supabase response not arrays:", rowsArr, secsArr);
          setKpiMapping(null);
          return;
        }
        console.log("[HomePage] supabase loaded — rows:", rowsArr.length, "sections:", secsArr.length);
        console.log("[HomePage] sample row KEYS:", rowsArr[0] ? Object.keys(rowsArr[0]) : "no rows");
        console.log("[HomePage] sample row FULL:", JSON.stringify(rowsArr[0], null, 2));
        console.log("[HomePage] sample section FULL:", JSON.stringify(secsArr[0], null, 2));

        // Robust field accessor: handles snake_case, camelCase, PascalCase, mixed
        const gf = (obj, ...names) => {
          if (!obj) return undefined;
          for (const n of names) if (obj[n] !== undefined) return obj[n];
          const norm = s => String(s).replace(/[_\s-]/g, "").toLowerCase();
          for (const k of Object.keys(obj)) {
            if (names.some(n => norm(n) === norm(k))) return obj[k];
          }
          return undefined;
        };
        // Robust truthy: handles boolean, "true"/"false" strings, 1/0, "1"/"0"
        const truthy = v => v === true || v === 1 || v === "1" || v === "true" || v === "TRUE" || v === "True";

        const rows = new Map();
        rowsArr.forEach(r => {
          const code = String(gf(r, "account_code", "accountCode", "AccountCode") ?? "");
          if (!code) return;
          rows.set(code, {
            section:       String(gf(r, "section_code", "sectionCode", "SectionCode") ?? ""),
            sortOrder:     Number(gf(r, "sort_order", "sortOrder", "SortOrder") ?? 0),
            isSum:         truthy(gf(r, "is_sum", "isSum", "IsSum", "is_sum_account", "isSumAccount", "IsSumAccount")),
            showInSummary: truthy(gf(r, "show_in_summary", "showInSummary", "ShowInSummary")),
            ccTag:         gf(r, "cc_tag", "ccTag", "CcTag") ?? null,
            name:          gf(r, "account_name", "accountName", "AccountName") ?? "",
            level:         Number(gf(r, "level", "Level") ?? 0),
          });
        });
        const sections = new Map();
        secsArr.forEach(s => {
          const code = String(gf(s, "section_code", "sectionCode", "SectionCode") ?? "");
          if (!code) return;
          sections.set(code, {
            label:     String(gf(s, "label", "Label") ?? ""),
            color:     String(gf(s, "color", "Color") ?? "#1a2f8a"),
            sortOrder: Number(gf(s, "sort_order", "sortOrder", "SortOrder") ?? 0),
          });
        });

        // Diagnostic: how many sums did we end up with?
        let sumCount = 0, summaryCount = 0;
        rows.forEach(info => { if (info.isSum) sumCount++; if (info.showInSummary) summaryCount++; });
        console.log("[HomePage] hydrated rows:", rows.size, "isSum=true:", sumCount, "showInSummary=true:", summaryCount);
        console.log("[HomePage] hydrated sections:", [...sections.entries()].map(([k, v]) => `${k}(sort=${v.sortOrder}):${v.label}`));

        setKpiMapping({ rows, sections, standard });
      })
      .catch((e) => { console.error("[HomePage] supabase mapping fetch failed", e); setKpiMapping(null); })
      .finally(() => setMappingLoading(false));
  }, [groupAccounts]);

  /* ─────────────────────────────────────────────────────
     HERO KPIs — 100% data-driven, no hardcoded codes
     Strategy:
       - Order sections by sort_order (smallest = revenue side, largest = result side)
       - Identify "Revenue section" = lowest sort_order section
       - Identify "Result section" = highest sort_order section
       - Identify "Cost section" = middle sections
       - Revenue: first sum row of revenue section
       - Net Income: last sum row in result section (highest sort_order)
       - EBIT: regex match on name across all sums
       - EBITDA: regex match on name; fallback to first sum after revenue (Contribución/Gross Margin)
  ───────────────────────────────────────────────────── */
  const heroKpis = useMemo(() => {
    if (!kpiMapping) return null;

    const allSums = [...kpiMapping.rows.entries()]
      .filter(([, info]) => info.isSum)
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder);

    if (!allSums.length) {
      console.warn("[HomePage] no sum accounts in mapping");
      return null;
    }

    // Section order
    const sectionsBySort = [...kpiMapping.sections.entries()]
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => code);
    console.log("[HomePage] sections by sort_order:", sectionsBySort);

    const revenueSection = sectionsBySort[0];                          // first
    const resultSection  = sectionsBySort[sectionsBySort.length - 1];  // last

    const sumsInSection = (secCode) => allSums.filter(([, info]) => info.section === secCode);
    const findByName = (pattern, exclude) => allSums.find(([, info]) => pattern.test(info.name) && (!exclude || !exclude.test(info.name)));
    const findByCcTag = (pattern) => allSums.find(([, info]) => info.ccTag && pattern.test(info.ccTag));

    // ── Revenue: first sum in revenue section that shows in summary ──
    const revSumsInSec = sumsInSection(revenueSection);
    let revenue = revSumsInSec.find(([, info]) => info.showInSummary) ?? revSumsInSec[0];
    // Cross-standard fallback via cc_tag
    if (!revenue) revenue = findByCcTag(/Revenue/i);
    // PGC last-resort: A.01
    if (!revenue && kpiMapping.rows.get("A.01")) revenue = ["A.01", kpiMapping.rows.get("A.01")];

    // ── Net Income: last sum in result section (or last sum overall) ──
    const resultSumsInSec = sumsInSection(resultSection);
    let netIncome = resultSumsInSec.findLast?.(([, info]) => info.showInSummary)
      ?? resultSumsInSec[resultSumsInSec.length - 1]
      ?? allSums[allSums.length - 1];

    // ── EBIT: name match cross-language ──
    let ebit = findByName(/\bEBIT\b(?!.*EBITDA)|EXPLOTACI[OÓ]N|OPERATING\s+(PROFIT|RESULT|INCOME)/i, /EBITDA/i);

    // ── EBITDA: name match ──
    let ebitda = findByName(/EBITDA/i) ?? findByCcTag(/EBITDA/i);

    // ── EBITDA fallback: first sum AFTER revenue but BEFORE EBIT (Contribución/Gross Margin) ──
    if (!ebitda && revenue && ebit) {
      const revSort = revenue[1].sortOrder;
      const ebitSort = ebit[1].sortOrder;
      ebitda = allSums.find(([, info]) =>
        info.showInSummary &&
        info.sortOrder > revSort &&
        info.sortOrder < ebitSort
      );
    }

    // ── If still no EBIT: pick a middle sum as fallback ──
    if (!ebit && revenue && netIncome) {
      const revSort = revenue[1].sortOrder;
      const niSort  = netIncome[1].sortOrder;
      const middle = allSums.filter(([, info]) =>
        info.showInSummary &&
        info.sortOrder > revSort &&
        info.sortOrder < niSort
      );
      if (middle.length > 0) {
        // Pick the one closest to the end (most likely operating result)
        ebit = middle[middle.length - 1];
      }
    }

    const result = {
      revenue:   revenue   ? { code: revenue[0],   name: revenue[1].name }   : null,
      ebitda:    ebitda    ? { code: ebitda[0],    name: ebitda[1].name }    : null,
      ebit:      ebit      ? { code: ebit[0],      name: ebit[1].name }      : null,
      netIncome: netIncome ? { code: netIncome[0], name: netIncome[1].name } : null,
    };
    console.log("[HomePage] heroKpis identified:", result);
    return result;
  }, [kpiMapping]);

  /* ─────────────────────────────────────────────────────
     COST ACCOUNTS — purely data-driven
     All sum accounts of any section that is NOT the
     revenue section and NOT the result section.
     We pick the ones with show_in_summary=true at
     the lowest level (main P&L lines, not sub-totals).
  ───────────────────────────────────────────────────── */
  const costAccounts = useMemo(() => {
    if (!kpiMapping) return [];

    const sectionsBySort = [...kpiMapping.sections.entries()]
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => code);

    if (sectionsBySort.length < 2) return [];

    // Cost sections = everything except first (revenue) and last (result)
    const costSections = sectionsBySort.slice(1, -1);
    if (costSections.length === 0) {
      // Only 2 sections → costs are the middle ones... in 3-section model we have INGRESOS/GASTOS/RESULTADO
      // If only 2 sections exist, no cost section. Fallback: section with most sum rows
      console.warn("[HomePage] no middle section identified for costs");
      return [];
    }

    console.log("[HomePage] cost sections:", costSections);

    const candidates = [...kpiMapping.rows.entries()]
      .filter(([, info]) => info.isSum && costSections.includes(info.section))
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder);

    if (candidates.length === 0) {
      console.warn("[HomePage] no cost candidates found");
      return [];
    }

    // Prefer rows that are in summary view (top-level expense lines) and are NOT section subtotals
    // Section subtotals tend to be shorter codes or end in .S
    const visible = candidates.filter(([code, info]) => info.showInSummary);
    const filtered = visible.length > 0 ? visible : candidates;

    // Exclude section-totals (codes ending in .S which are KPIs themselves)
    const final = filtered.filter(([code]) => !code.endsWith(".S"));

    console.log("[HomePage] cost accounts found:", final.length, "sample:", final.slice(0, 3).map(([c, i]) => `${c}:${i.name}`));

    return (final.length > 0 ? final : filtered).slice(0, 7).map(([code, info]) => ({ code, name: info.name }));
  }, [kpiMapping]);

  /* ─────────────────────────────────────────────────────
     FETCH HELPERS
  ───────────────────────────────────────────────────── */
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

  /* ─────────────────────────────────────────────────────
     PROBE
  ───────────────────────────────────────────────────── */
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
        const period = extractPeriod(JSON.parse(cached));
        if (period) {
          console.log("[HomePage] using cached period:", period.year, period.month);
          setYear(String(period.year));
          setMonth(String(period.month));
          return;
        }
        sessionStorage.removeItem(cacheKey);
      } catch { sessionStorage.removeItem(cacheKey); }
    }

    console.log("[HomePage] probing for latest period…");
    setProbing(true);
    (async () => {
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      const candidates = [];
      for (let i = 0; i < 24; i++) {
        candidates.push({ y, m });
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
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
          console.log("[HomePage] probe found:", found);
          setYear(String(found.y));
          setMonth(String(found.m));
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ year: found.y, month: found.m })); } catch {}
          setProbing(false);
          return;
        }
      }
      console.warn("[HomePage] probe found NO data in 24 months back");
      setProbing(false);
    })();
  }, [source, structure, company, token, year, month, headers]);

  /* ─────────────────────────────────────────────────────
     FETCH current + prev
  ───────────────────────────────────────────────────── */
  const initialFetchSkippedRef = useRef(!!prefetch);
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
    if (year === "undefined" || month === "undefined") {
      setYear(""); setMonth(""); probedRef.current = false;
      return;
    }
    if (initialFetchSkippedRef.current) {
      initialFetchSkippedRef.current = false;
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      console.log("[HomePage] fetching current+prev for", year, month, "co:", company);
      const [cur, prev] = await Promise.all([
        fetchPeriod(year, month, source, structure, company),
        Number(month) > 1 ? fetchPeriod(year, String(Number(month) - 1), source, structure, company) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      console.log("[HomePage] fetched current rows:", cur.length, "prev rows:", prev.length);
      if (cur.length > 0) console.log("[HomePage] sample current row:", cur[0]);
      setCurrentRows(cur);
      setPrevRows(prev);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [year, month, source, structure, company, fetchPeriod]);

  /* ─────────────────────────────────────────────────────
     FETCH 36-month trend
  ───────────────────────────────────────────────────── */
  const initialTrendSkippedRef = useRef(!!(prefetch?.trend?.length >= 12));
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
    if (year === "undefined" || month === "undefined") return;

    const cacheKey = `${source}|${structure}|${company}|${year}|${month}|36mo`;
    const cached = trendCacheRef.current.get(cacheKey);
    if (cached) { setTrendRows(cached); return; }

    if (initialTrendSkippedRef.current && prefetch?.trend?.length >= 12) {
      setTrendRows(prefetch.trend);
      initialTrendSkippedRef.current = false;
    }

    let cancelled = false;
    setTrendLoading(true);
    (async () => {
      const months36 = [];
      let y = Number(year), m = Number(month);
      if (!Number.isFinite(y) || !Number.isFinite(m)) { setTrendLoading(false); return; }
      for (let i = 0; i < 36; i++) {
        months36.unshift({ y, m });
        m--; if (m < 1) { m = 12; y--; }
      }
      const results = [];
      for (let i = 0; i < months36.length; i += 8) {
        const batch = months36.slice(i, i + 8);
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
  }, [year, month, source, structure, company, fetchPeriod, prefetch]);

  /* ─────────────────────────────────────────────────────
     FETCH all-companies YTD
  ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!year || !month || !source || !structure) return;
    if (year === "undefined" || month === "undefined") return;

    const cacheKey = `${source}|${structure}|${year}|${month}|ytd-allco`;
    const cached = allCoCacheRef.current.get(cacheKey);
    if (cached) { setAllCoCurrentRows(cached); return; }

    let cancelled = false;
    setAllCoLoading(true);
    (async () => {
      console.log("[HomePage] fetching all-companies for", year, month);
      const rows = await fetchPeriodAllCompanies(year, month, source, structure);
      if (cancelled) return;
      console.log("[HomePage] fetched all-companies rows:", rows.length);
      allCoCacheRef.current.set(cacheKey, rows);
      setAllCoCurrentRows(rows);
      setAllCoLoading(false);
    })();
    return () => { cancelled = true; };
  }, [year, month, source, structure, fetchPeriodAllCompanies]);

  /* ─────────────────────────────────────────────────────
     COMPUTED
  ───────────────────────────────────────────────────── */
  const SIGN = -1;

  const kpiValues = useMemo(() => {
    if (!heroKpis) return null;
    const get = (kpi, rows) => kpi ? sumByCode(rows, kpi.code) * SIGN : 0;
    const result = {
      revenue:   { current: get(heroKpis.revenue, currentRows),   prev: get(heroKpis.revenue, prevRows) },
      ebitda:    { current: get(heroKpis.ebitda, currentRows),    prev: get(heroKpis.ebitda, prevRows) },
      ebit:      { current: get(heroKpis.ebit, currentRows),      prev: get(heroKpis.ebit, prevRows) },
      netIncome: { current: get(heroKpis.netIncome, currentRows), prev: get(heroKpis.netIncome, prevRows) },
    };
    if (currentRows.length > 0) {
      console.log("[HomePage] kpi values:",
        "rev:", result.revenue.current,
        "ebitda:", result.ebitda.current,
        "ebit:", result.ebit.current,
        "ni:", result.netIncome.current);
    }
    return result;
  }, [currentRows, prevRows, heroKpis]);

  const trendSeries = useMemo(() => {
    if (!trendRows.length || !heroKpis) return [];
    return trendRows
      .filter(t => Number.isFinite(t?.year) && Number.isFinite(t?.month))
      .map(({ year: y, month: m, rows }, idx, arr) => ({
        idx,
        label: m % 3 === 1 || idx === arr.length - 1
          ? `${MONTHS_ABBR[m - 1]} ${String(y).slice(-2)}`
          : "",
        fullLabel: `${MONTHS_ABBR[m - 1]} ${y}`,
        Revenue:    heroKpis.revenue   ? sumByCode(rows, heroKpis.revenue.code)   * SIGN : 0,
        EBITDA:     heroKpis.ebitda    ? sumByCode(rows, heroKpis.ebitda.code)    * SIGN : 0,
        EBIT:       heroKpis.ebit      ? sumByCode(rows, heroKpis.ebit.code)      * SIGN : 0,
        NetIncome:  heroKpis.netIncome ? sumByCode(rows, heroKpis.netIncome.code) * SIGN : 0,
      }));
  }, [trendRows, heroKpis]);

  const sparklines = useMemo(() => {
    const last12 = trendSeries.slice(-12);
    return {
      revenue:   last12.map(t => t.Revenue),
      ebitda:    last12.map(t => t.EBITDA),
      ebit:      last12.map(t => t.EBIT),
      netIncome: last12.map(t => t.NetIncome),
    };
  }, [trendSeries]);

  const topByRevenue = useMemo(
    () => heroKpis?.revenue ? topEntitiesByCode(allCoCurrentRows, heroKpis.revenue.code, 6) : [],
    [allCoCurrentRows, heroKpis]
  );

  const costBreakdown = useMemo(() => {
    if (!costAccounts.length || !currentRows.length) return [];
    return costAccounts
      .map(({ code, name }) => {
        const value = sumByCode(currentRows, code);
        return { code, name, value: Math.abs(value) };
      })
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [costAccounts, currentRows]);

  const totalCosts = useMemo(
    () => costBreakdown.reduce((s, c) => s + c.value, 0),
    [costBreakdown]
  );

  const periodLabel = useMemo(() => {
    if (!year || !month || year === "undefined" || month === "undefined") return probing ? "Buscando…" : "—";
    const mNum = Number(month);
    if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) return "—";
    return `${MONTHS_ABBR[mNum - 1]} ${year}`;
  }, [year, month, probing]);

  const anyLoading = loading || mappingLoading || trendLoading || probing || allCoLoading;

  const costColors = useMemo(() => {
    return [colors.primary ?? "#1a2f8a", "#3b54b8", "#7c5fcc", "#b370cc", "#cf6595", "#cf5070", "#cf3940"];
  }, [colors]);

  /* ═════════════════════════════════════════════════════
     RENDER
  ═════════════════════════════════════════════════════ */
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
                  {probing ? "Probing" : mappingLoading ? "Mapping" : trendLoading ? "Trend" : allCoLoading ? "Multi-co" : "Loading"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* HERO KPIS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0" style={{ minHeight: 140 }}>
          {heroKpis ? (
            <>
              <HeroKPI label="Revenue" code={heroKpis.revenue?.code}
                value={kpiValues?.revenue.current ?? 0} prevValue={kpiValues?.revenue.prev}
                trend={sparklines.revenue} color={colors.primary ?? "#1a2f8a"}
                accent={`${colors.primary}cc`} icon={DollarSign} loading={loading} delay={0} />
              <HeroKPI label="EBITDA" code={heroKpis.ebitda?.code}
                value={kpiValues?.ebitda.current ?? 0} prevValue={kpiValues?.ebitda.prev}
                trend={sparklines.ebitda} color={colors.secondary ?? "#CF305D"}
                accent={`${colors.secondary ?? "#CF305D"}cc`} icon={Activity} loading={loading} delay={0.06} />
              <HeroKPI label="EBIT" code={heroKpis.ebit?.code}
                value={kpiValues?.ebit.current ?? 0} prevValue={kpiValues?.ebit.prev}
                trend={sparklines.ebit} color={colors.tertiary ?? "#57aa78"}
                accent={`${colors.tertiary ?? "#57aa78"}cc`} icon={Target} loading={loading} delay={0.12} />
              <HeroKPI label="Net Income" code={heroKpis.netIncome?.code}
                value={kpiValues?.netIncome.current ?? 0} prevValue={kpiValues?.netIncome.prev}
                trend={sparklines.netIncome} color={NI_COLOR} accent={NI_ACCENT}
                icon={TrendingUp} loading={loading} delay={0.18} />
            </>
          ) : (
            <div className="col-span-full bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-100 p-6 text-center">
              {mappingLoading || probing ? (
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
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Last 36 m</p>
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
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 700 }} axisLine={false} tickLine={false} interval={0} />
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
                    <Area type="monotone" dataKey="Revenue"   stroke={colors.primary}              strokeWidth={2}   fill="url(#areaRev)"    isAnimationActive />
                    <Area type="monotone" dataKey="EBITDA"    stroke={colors.secondary ?? "#CF305D"} strokeWidth={1.6} fill="url(#areaEbitda)" isAnimationActive />
                    <Area type="monotone" dataKey="EBIT"      stroke={colors.tertiary ?? "#57aa78"}  strokeWidth={1.6} fill="url(#areaEbit)"   isAnimationActive />
                    <Area type="monotone" dataKey="NetIncome" stroke={NI_COLOR}                      strokeWidth={1.6} fill="url(#areaNi)"     isAnimationActive />
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
              <h3 className="text-sm font-black text-gray-800 mt-0.5 flex items-center gap-1.5">
                <Wallet size={13} className="text-gray-400" /> Top Expenses YTD
              </h3>
            </div>

            {costBreakdown.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                {costBreakdown.map((c, i) => {
                  const pct = totalCosts > 0 ? (c.value / totalCosts) * 100 : 0;
                  const barColor = costColors[i % costColors.length];
                  return (
                    <div key={c.code} className="flex flex-col gap-1"
                      style={{ animation: `kCardEntry 0.5s ease-out ${0.4 + i * 0.05}s both` }}>
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-gray-400 flex-shrink-0">{c.code}</span>
                          <span className="font-bold text-gray-700 truncate" title={c.name}>{c.name}</span>
                        </div>
                        <span className="font-mono font-black text-gray-700 flex-shrink-0">{fmtBig(c.value)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor} 0%, ${barColor}cc 100%)` }} />
                      </div>
                      <div className="text-[9px] text-gray-400 font-mono text-right">{pct.toFixed(1)}%</div>
                    </div>
                  );
                })}
                <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between text-[10px]">
                  <span className="font-black uppercase tracking-widest text-gray-500">Total</span>
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
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ranking · Multi-Company</p>
                
              </div>
              {allCoLoading && <Loader2 size={12} className="animate-spin text-gray-300" />}
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
            <MiniTile label="Companies"    value={companies.length}  icon={Building2} color={colors.primary}                delay={0.55} />
            <MiniTile label="Perímetres"  value={structures.length} icon={Layers}    color={colors.secondary  ?? "#CF305D"} delay={0.6}  />
            <MiniTile label="Dimensions" value={dimensions.length} icon={Network}   color={colors.tertiary   ?? "#57aa78"} delay={0.65} />
            <MiniTile label="Sources"     value={sources.length}    icon={Database}  color={NI_COLOR}                       delay={0.7}  />
          </div>
        </div>
      </div>
    </div>
  );
}