import { useState, useEffect, useRef } from "react";
import { useSettings, useSettingsControls } from "./SettingsContext";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";

const ENDPOINTS = [
  { key: "sources",     label: "Sources",     endpoint: "/v2/sources",     angle: -135 },
  { key: "structures",  label: "Perimeters",  endpoint: "/v2/structures",  angle: -45  },
  { key: "companies",   label: "Companies",   endpoint: "/v2/companies",   angle:  45  },
  { key: "dimensions",  label: "Dimensions",  endpoint: "/v2/dimensions",  angle:  135 },
];

const SILENT_ENDPOINTS = [
  { key: "groupAccounts", endpoint: "/v2/group-accounts" },
];

async function prefetchHomeData(token, sources, structures, companies) {
  try {
    const src = sources[0]    ? (sources[0].source    ?? sources[0].Source    ?? sources[0]) : "";
    const str = structures[0] ? (structures[0].groupStructure ?? structures[0].GroupStructure ?? structures[0]) : "";
    const co  = companies[0]  ? (companies[0].companyShortName ?? companies[0].CompanyShortName ?? companies[0]) : "";
    if (!src || !str || !co) return null;

    const pRes = await fetch(`/v2/periods`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const pJson = await pRes.json();
    const allPeriods = pJson.value ?? (Array.isArray(pJson) ? pJson : []);
    const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];
    const actuals = allPeriods
      .filter(p => String(getP(p, "source") ?? "").toLowerCase() === "actual")
      .sort((a, b) => {
        const ay = Number(getP(a, "year") || 0), by = Number(getP(b, "year") || 0);
        const am = Number(getP(a, "month") || 0), bm = Number(getP(b, "month") || 0);
        return by !== ay ? by - ay : bm - am;
      })
      .slice(0, 36);

    const cacheKey = `home_latest_period_${src}_${str}_${co}`;
    let latestPeriod = null;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.year && parsed.month) latestPeriod = parsed;
      } catch { /* ignore */ }
    }

    if (!latestPeriod) {
      const BATCH = 12;
      outer: for (let i = 0; i < actuals.length; i += BATCH) {
        const batch = actuals.slice(i, i + BATCH);
        const probes = await Promise.all(batch.map(async (p) => {
          const y = Number(getP(p, "year"));
          const m = Number(getP(p, "month"));
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}' and CompanyShortName eq '${co}'`;
          const url = `/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`;
          try {
            const r = await fetch(url, {
              headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
            });
            if (!r.ok) return { y, m, hasData: false };
            const j = await r.json();
            const rows = j.value ?? (Array.isArray(j) ? j : []);
            return { y, m, source: getP(p, "source"), hasData: rows.length > 0 };
          } catch {
            return { y, m, hasData: false };
          }
        }));
        const hit = probes.find(x => x.hasData);
        if (hit) {
          latestPeriod = { year: hit.y, month: hit.m, source: hit.source };
          sessionStorage.setItem(cacheKey, JSON.stringify(latestPeriod));
          break outer;
        }
      }
    }
    if (!latestPeriod) return null;

// Return period only — no data fetches here.
    // Homepage fetches current / prev / trend / allCo on mount independently.
    // This keeps prefetchHomeData under 500 ms (cache hit) or ~1 s (cold probe),
    // so homePrefetchDone fires well before MIN_ANIM_MS and EpicLoader exits fast.
    return {
      latestPeriod,
      year:             latestPeriod.year,
      month:            latestPeriod.month,
      current:          [],
      prev:             [],
      trend:            [],
      allCoCurrentRows: [],
    };
} catch {
    return null;
  }
}

const PHASE = {
  LOGO_IN:        { id: 0, duration: 400 },
  ORBIT_LABELS:   { id: 1, duration: 350 },
  FETCH_LINES:    { id: 2, duration: 1100 },
  CONSOLIDATE:    { id: 3, duration: 400 },
  ZOOM_OUT:       { id: 4, duration: 350 },
};

const MIN_ANIM_MS = 1200; // minimum ms before exit animation — enough to see logo + labels + lines
const TOTAL_MAX   = 4000; // hard ceiling for slow networks

export default function EpicLoader({ token, onReady, onDataLoaded }) {
  const { colors } = useSettings();
  const { settings, setDetectedLocale } = useSettingsControls();
  const { setLatestPeriod } = useLatestPeriod();
  // Stable refs — effects don't restart if parent re-renders with new fn references
  const onReadyRef = useRef(onReady);
  const onDataLoadedRef = useRef(onDataLoaded);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onDataLoadedRef.current = onDataLoaded; }, [onDataLoaded]);
const [phase, setPhase] = useState(PHASE.LOGO_IN.id);
  const [completedKeys, setCompletedKeys] = useState({});
const [silentDone, setSilentDone] = useState(false);
  const [homePrefetchDone, setHomePrefetchDone] = useState(false);
  const [allDone, setAllDone] = useState(false);
 const startTimeRef = useRef(null);
  const dataRef = useRef({});

useEffect(() => {
    if (!token) return;
    startTimeRef.current = Date.now();
    let cancelled = false;

    (async () => {
      const trackers = {};
      const promises = {};
      ["sources", "structures", "companies"].forEach(k => {
        promises[k] = new Promise(resolve => { trackers[k] = resolve; });
      });

      const visibleFetches = ENDPOINTS.map(async ({ key, endpoint }) => {
        try {
          const res = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const rows = json.value ?? (Array.isArray(json) ? json : [json]);
          if (cancelled) return;
          dataRef.current[key] = rows;
          setCompletedKeys(prev => ({ ...prev, [key]: rows.length }));
          if (trackers[key]) trackers[key](rows);
        } catch {
          if (cancelled) return;
          dataRef.current[key] = [];
          setCompletedKeys(prev => ({ ...prev, [key]: 0 }));
          if (trackers[key]) trackers[key]([]);
        }
      });

const silentFetches = SILENT_ENDPOINTS.map(async ({ key, endpoint }) => {
        try {
          const res = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const rows = json.value ?? (Array.isArray(json) ? json : [json]);
          if (cancelled) return;
          dataRef.current[key] = rows;
        } catch {
          if (cancelled) return;
          dataRef.current[key] = [];
        }
      });

      // Signal completion so the completedKeys effect waits for groupAccounts
      // before calling onDataLoaded — prevents the 40% stall caused by
      // initialData.groupAccounts being empty when KPI resolver first runs.
      Promise.all(silentFetches).then(() => { if (!cancelled) setSilentDone(true); });

      const homePromise = (async () => {
        const [s, st, co] = await Promise.all([promises.sources, promises.structures, promises.companies]);
        if (cancelled) return null;
        return prefetchHomeData(token, s ?? [], st ?? [], co ?? []);
      })();

      const [homePrefetch] = await Promise.all([
        homePromise,
        Promise.all(visibleFetches),
        Promise.all(silentFetches),
      ]);
if (cancelled) return;
if (homePrefetch) {
        dataRef.current.__homePrefetch = homePrefetch;
        try {
          const srcArr = dataRef.current.sources    ?? [];
          const strArr = dataRef.current.structures ?? [];
          const coArr  = dataRef.current.companies  ?? [];
          const src = srcArr[0] ? (srcArr[0].source ?? srcArr[0].Source ?? srcArr[0]) : "";
          const str = strArr[0] ? (strArr[0].groupStructure ?? strArr[0].GroupStructure ?? strArr[0]) : "";
          const co  = coArr[0]  ? (coArr[0].companyShortName ?? coArr[0].CompanyShortName ?? coArr[0]) : "";
          if (src && str && co && homePrefetch.year && homePrefetch.month) {
            setLatestPeriod(src, str, co, homePrefetch.year, homePrefetch.month);
          }
        } catch {
          // LatestPeriodContext remains unpopulated; pages will probe on demand
        }
      }
      // Signal that home prefetch has settled — whether it returned data or null.
      // The completedKeys effect waits for this before calling onDataLoaded.
      if (!cancelled) setHomePrefetchDone(true);
    })();

    return () => { cancelled = true; };
 }, [token, setLatestPeriod]);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(PHASE.ORBIT_LABELS.id), PHASE.LOGO_IN.duration);
    const t2 = setTimeout(() => setPhase(PHASE.FETCH_LINES.id),
      PHASE.LOGO_IN.duration + PHASE.ORBIT_LABELS.duration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

useEffect(() => {
    const allFetchesDone = Object.keys(completedKeys).length === ENDPOINTS.length;
    if (!allFetchesDone || !silentDone || !homePrefetchDone) return;

const elapsed = Date.now() - startTimeRef.current;
    const wait = Math.max(0, MIN_ANIM_MS - elapsed);

    const t = setTimeout(() => {
      setPhase(PHASE.CONSOLIDATE.id);
      setTimeout(() => setPhase(PHASE.ZOOM_OUT.id), PHASE.CONSOLIDATE.duration);
setTimeout(() => {
        setAllDone(true);
        if (onDataLoadedRef.current) onDataLoadedRef.current(dataRef.current);
        if (onReadyRef.current) onReadyRef.current();
      }, PHASE.CONSOLIDATE.duration + PHASE.ZOOM_OUT.duration);
    }, wait);

    return () => clearTimeout(t);
}, [completedKeys, silentDone, homePrefetchDone]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!allDone) {
        setPhase(PHASE.ZOOM_OUT.id);
        setTimeout(() => {
          setAllDone(true);
          if ((settings?.locale ?? "auto") === "auto") {
            const gAccounts = dataRef.current.groupAccounts ?? [];
            const codes = [];
            gAccounts.forEach(n => {
              const ac = String(n.AccountCode ?? n.accountCode ?? "");
              if (ac) codes.push(ac);
            });
            const isDanish = codes.some(c => /^\d{5,6}$/.test(c));
            const isPGC    = codes.some(c => c.endsWith(".S"));
            setDetectedLocale(isDanish ? "da" : isPGC ? "es" : "en");
          }
if (onDataLoadedRef.current) onDataLoadedRef.current(dataRef.current);
          if (onReadyRef.current) onReadyRef.current();
        }, PHASE.ZOOM_OUT.duration);
      }
    }, TOTAL_MAX);
return () => clearTimeout(t);
  }, [allDone, setDetectedLocale, settings?.locale]);

if (allDone) return null;

  const isZoomOut = phase >= PHASE.ZOOM_OUT.id;
  const isMounted = phase >= PHASE.LOGO_IN.id; // becomes true on first paint

  // Equations for ambient background — same vibe as Login
  const EQUATIONS = [
    "EBITDA = Revenue − COGS − OpEx",
    "NPV = Σ CFₜ / (1+r)ᵗ",
    "WACC = (E/V)·Rₑ + (D/V)·R_d·(1−T)",
    "ROIC = NOPAT / Invested Capital",
    "FCF = EBIT(1−t) + D&A − ΔWC − CapEx",
    "Net Margin = NI / Revenue",
    "DSO = (AR / Revenue) × 365",
    "DCF: Σ FCFₜ / (1+WACC)ᵗ + TV",
    "Quick Ratio = (CA − Inv) / CL",
    "D/E = Total Debt / Equity",
    "EV = MktCap + Debt − Cash",
    "P/E = Price / EPS",
  ];

return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 35%, #7a9fef 70%, #d8e4ff 100%)",
        opacity: isZoomOut ? 0 : 1,
        transform: isZoomOut ? "scale(1.4)" : "scale(1)",
        animation: "loader-mount-fade 500ms cubic-bezier(0.25,0.1,0.25,1) both",
        transition: `opacity 350ms cubic-bezier(0.4,0,0.2,1), transform 350ms cubic-bezier(0.4,0,0.2,1)`,
      }}
    >
      {/* Ambient atmospherics — same as Login */}
      <div className="absolute top-[10%] left-[8%] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
          filter: "blur(60px)",
          animation: "loader-float 22s ease-in-out infinite",
        }} />
      <div className="absolute bottom-[15%] right-[6%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(168,197,255,0.5), transparent 65%)",
          filter: "blur(70px)",
        }} />

      {/* Grain */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />

      {/* Drifting equations */}
      {EQUATIONS.map((eq, i) => {
        const left = (i * 19 + 3) % 92;
        const dur = 26 + (i % 6) * 3;
        const delay = -((i * 2.4) % dur);
        const size = 11 + (i % 3);
        return (
          <div key={`eq-${i}`} className="absolute pointer-events-none"
            style={{
              bottom: "-10%",
              left: `${left}%`,
              fontSize: size,
              fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
              color: "rgba(255,255,255,0.45)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              animation: `${i % 2 === 0 ? "loader-drift" : "loader-drift-slow"} ${dur}s linear ${delay}s infinite`,
            }}>
            {eq}
          </div>
        );
      })}

      {/* Concentric rings (subtle, in white) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute rounded-full border"
          style={{
            width: "40vmax", height: "40vmax", top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${phase >= PHASE.CONSOLIDATE.id ? 0 : 1})`,
            borderColor: "rgba(255,255,255,0.18)",
            transition: "transform 400ms cubic-bezier(0.4,0,0.2,1)",
          }} />
        <div className="absolute rounded-full border"
          style={{
            width: "60vmax", height: "60vmax", top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${phase >= PHASE.CONSOLIDATE.id ? 0 : 1})`,
            borderColor: "rgba(255,255,255,0.1)",
            borderStyle: "dashed",
            transition: "transform 500ms cubic-bezier(0.4,0,0.2,1)",
          }} />
      </div>

      {/* Connection lines (white with glow) */}
      <svg className="absolute inset-0 w-full h-full" viewBox="-500 -500 1000 1000" preserveAspectRatio="xMidYMid meet">
        {ENDPOINTS.map((ep, i) => {
          const rad = (ep.angle * Math.PI) / 180;
          const startR = 480, endR = 70;
          const x1 = Math.cos(rad) * startR, y1 = Math.sin(rad) * startR;
          const x2 = Math.cos(rad) * endR,   y2 = Math.sin(rad) * endR;
          const isCompleted = completedKeys[ep.key] !== undefined;
          const isLineDrawing = phase >= PHASE.FETCH_LINES.id;
          return (
            <g key={ep.key}>
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isCompleted ? "#ffffff" : "rgba(255,255,255,0.35)"}
                strokeWidth={isCompleted ? 1.5 : 1}
                strokeDasharray="600"
                strokeDashoffset={isLineDrawing ? 0 : 600}
                style={{
                  transition: `stroke-dashoffset 700ms cubic-bezier(0.4,0,0.2,1) ${i * 80}ms, stroke 300ms ease, stroke-width 300ms ease`,
                  opacity: phase >= PHASE.CONSOLIDATE.id ? 0 : 1,
                  filter: isCompleted ? "drop-shadow(0 0 6px rgba(255,255,255,0.5))" : "none",
                }} />
              {isCompleted && phase < PHASE.CONSOLIDATE.id && (
                <circle cx={x1} cy={y1} r="4" fill="#ffffff"
                  style={{ filter: "drop-shadow(0 0 8px rgba(255,255,255,0.9))", animation: "loader-pulse-dot 1.2s ease-in-out infinite" }} />
              )}
            </g>
          );
        })}
      </svg>

{/* Orbiting labels — frosted chips that fly in from below to assemble */}
      {ENDPOINTS.map((ep, i) => {
        const rad = (ep.angle * Math.PI) / 180;
        const r = 280;
        const x = Math.cos(rad) * r, y = Math.sin(rad) * r;
        const count = completedKeys[ep.key];
        const visible = phase >= PHASE.ORBIT_LABELS.id && phase < PHASE.CONSOLIDATE.id;
        return (
          <div key={ep.key} className="absolute text-center"
            style={{
              top: "50%", left: "50%",
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${visible ? 1 : 0.6})`,
              opacity: visible ? 1 : 0,
              transition: "opacity 300ms ease, transform 300ms cubic-bezier(0.4,0,0.2,1)",
            }}>
<div className="px-4 py-3 rounded-2xl backdrop-blur-md"
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.22)",
                minWidth: 110,
              }}>
              <p className="font-black uppercase tracking-widest" style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>
                {ep.label}
              </p>
              <p className="font-black tabular-nums"
                style={{
                  fontSize: 26,
                  color: count !== undefined ? "#ffffff" : "rgba(255,255,255,0.4)",
                  transition: "color 200ms ease",
                  textShadow: count !== undefined ? "0 0 20px rgba(255,255,255,0.6)" : "none",
                }}>
                {count !== undefined ? count : "···"}
              </p>
            </div>
          </div>
        );
      })}

{/* Centerpiece — logo + brand */}
      <div className="relative z-10 flex flex-col items-center"
        style={{
          transform: phase >= PHASE.CONSOLIDATE.id ? "scale(1.15)" : phase >= PHASE.LOGO_IN.id ? "scale(1)" : "scale(0.5)",
          opacity: phase >= PHASE.LOGO_IN.id ? 1 : 0,
          transition: "transform 350ms cubic-bezier(0.34,1.56,0.64,1), opacity 350ms ease",
        }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
          style={{
            background: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(255,255,255,0.95)",
            backdropFilter: "blur(20px) saturate(150%)",
            boxShadow: phase >= PHASE.CONSOLIDATE.id
              ? "0 0 80px rgba(255,255,255,0.9), 0 0 200px rgba(168,197,255,0.6)"
              : "0 20px 60px rgba(15,31,92,0.4), 0 8px 20px rgba(15,31,92,0.2)",
            transition: "box-shadow 400ms ease",
          }}>
          <img src="/logo-icon.png" alt="K" className="w-14 h-14 object-contain" />
        </div>
        <p className="text-white font-black text-xl tracking-[0.3em]"
          style={{ textShadow: "0 0 30px rgba(255,255,255,0.4), 0 0 60px rgba(168,197,255,0.5)" }}>
          KONSOLIDATOR
        </p>
        <p className="text-[10px] mt-3 tracking-[0.25em] uppercase font-bold"
          style={{
            color: "rgba(255,255,255,0.7)",
            opacity: phase >= PHASE.CONSOLIDATE.id ? 1 : phase >= PHASE.ORBIT_LABELS.id ? 0.8 : 0,
            transition: "opacity 300ms ease",
          }}>
          {phase >= PHASE.CONSOLIDATE.id ? "━ Group Consolidated" : phase >= PHASE.FETCH_LINES.id ? "━ Aggregating Sources" : "━ Initializing"}
        </p>
      </div>

      <style>{`
        @keyframes loader-float {
          0%, 100% { transform: translate(0, 0); }
          50%      { transform: translate(30px, -40px); }
        }
        @keyframes loader-drift {
          0%   { transform: translateY(0)    rotate(0deg);  opacity: 0; }
          10%  {                              opacity: 0.5; }
          90%  {                              opacity: 0.5; }
          100% { transform: translateY(-100vh) rotate(8deg); opacity: 0; }
        }
        @keyframes loader-drift-slow {
          0%   { transform: translateY(0)     rotate(0deg);   opacity: 0; }
          10%  {                              opacity: 0.4;  }
          90%  {                              opacity: 0.4;  }
          100% { transform: translateY(-110vh) rotate(-6deg); opacity: 0; }
        }
@keyframes loader-pulse-dot { 0%, 100% { opacity: 1; r: 4; } 50% { opacity: 0.5; r: 6; } }
@keyframes loader-mount-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}