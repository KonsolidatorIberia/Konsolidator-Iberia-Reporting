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

const { year, month } = latestPeriod;
// Trailing 12 months — fast (12 calls), finishes well within EpicLoader's
    // time budget. Gives trendRows its initial data so loadProgress credits 20%
    // immediately on HomePage mount. The Jan-anchored re-fetch happens in
    // background after the overlay is already gone.
    const trendMonths = [];
    for (let i = 11; i >= 0; i--) {
      let m = month - i, y = year;
      while (m < 1) { m += 12; y -= 1; }
      trendMonths.push({ year: y, month: m });
    }
    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;

    const fetchOne = async (y, m) => {
      const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}' and CompanyShortName eq '${co}'`;
      const url = `/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`;
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" }
        });
        if (!r.ok) return [];
        const j = await r.json();
        return j.value ?? (Array.isArray(j) ? j : []);
      } catch { return []; }
    };

// All-companies fetch (no CompanyShortName filter) — feeds HomePage's
    // allCoCurrentRows state (15% of loadProgress) without a second network call.
    const fetchAllCo = async () => {
      try {
        const allCoFilter = `Year eq ${year} and Month eq ${month} and Source eq '${src}' and GroupStructure eq '${str}'`;
        const r = await fetch(
          `/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(allCoFilter)}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );
        if (!r.ok) return [];
        const j = await r.json();
        return j.value ?? (Array.isArray(j) ? j : []);
      } catch { return []; }
    };

    const [trendResults, prevRows, allCoCurrentRows] = await Promise.all([
      Promise.all(trendMonths.map(({ year: y, month: m }) =>
        fetchOne(y, m).then(rows => ({ year: y, month: m, rows }))
      )),
      fetchOne(prevY, prevM),
      fetchAllCo(),
    ]);
    const currentRows = trendResults.find(t => t.year === year && t.month === month)?.rows ?? [];
    return {
      latestPeriod,
      year: latestPeriod.year,
      month: latestPeriod.month,
      current: currentRows,
      prev: prevRows,
      trend: trendResults,
      allCoCurrentRows,
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
    if (!allFetchesDone || !silentDone) return;

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
}, [completedKeys, silentDone]);

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

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        backgroundColor: colors.primary,
        opacity: isZoomOut ? 0 : 1,
        transform: isZoomOut ? "scale(1.4)" : "scale(1)",
        transition: `opacity 350ms cubic-bezier(0.4,0,0.2,1), transform 350ms cubic-bezier(0.4,0,0.2,1)`,
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute rounded-full"
          style={{
            width: "120vmax", height: "120vmax", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)`,
            animation: phase >= PHASE.ORBIT_LABELS.id ? "pulse-bg 3s ease-in-out infinite" : "none",
          }} />
        <div className="absolute rounded-full border"
          style={{
            width: "40vmax", height: "40vmax", top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${phase >= PHASE.CONSOLIDATE.id ? 0 : 1})`,
            borderColor: "rgba(255,255,255,0.08)",
            transition: "transform 400ms cubic-bezier(0.4,0,0.2,1)",
          }} />
        <div className="absolute rounded-full border"
          style={{
            width: "60vmax", height: "60vmax", top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${phase >= PHASE.CONSOLIDATE.id ? 0 : 1})`,
            borderColor: "rgba(255,255,255,0.05)",
            transition: "transform 500ms cubic-bezier(0.4,0,0.2,1)",
          }} />
      </div>

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
                stroke={isCompleted ? "#ffffff" : "rgba(255,255,255,0.25)"}
                strokeWidth={isCompleted ? 1.5 : 1}
                strokeDasharray="600"
                strokeDashoffset={isLineDrawing ? 0 : 600}
                style={{
                  transition: `stroke-dashoffset 700ms cubic-bezier(0.4,0,0.2,1) ${i * 80}ms, stroke 300ms ease, stroke-width 300ms ease`,
                  opacity: phase >= PHASE.CONSOLIDATE.id ? 0 : 1,
                }} />
              {isCompleted && phase < PHASE.CONSOLIDATE.id && (
                <circle cx={x1} cy={y1} r="4" fill="#ffffff"
                  style={{ filter: "drop-shadow(0 0 8px rgba(255,255,255,0.8))", animation: "pulse-dot 1.2s ease-in-out infinite" }} />
              )}
            </g>
          );
        })}
      </svg>

      {ENDPOINTS.map((ep) => {
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
            <p className="font-black uppercase tracking-widest" style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              {ep.label}
            </p>
            <p className="font-black tabular-nums"
              style={{
                fontSize: 28,
                color: count !== undefined ? "#ffffff" : "rgba(255,255,255,0.3)",
                transition: "color 200ms ease",
                textShadow: count !== undefined ? "0 0 20px rgba(255,255,255,0.4)" : "none",
              }}>
              {count !== undefined ? count : "···"}
            </p>
          </div>
        );
      })}

      <div className="relative z-10 flex flex-col items-center"
        style={{
          transform: phase >= PHASE.CONSOLIDATE.id ? "scale(1.15)" : phase >= PHASE.LOGO_IN.id ? "scale(1)" : "scale(0.5)",
          opacity: phase >= PHASE.LOGO_IN.id ? 1 : 0,
          transition: "transform 350ms cubic-bezier(0.34,1.56,0.64,1), opacity 350ms ease",
        }}>
        <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-2xl mb-5"
          style={{
            boxShadow: phase >= PHASE.CONSOLIDATE.id
              ? "0 0 80px rgba(255,255,255,0.8), 0 0 200px rgba(255,255,255,0.4)"
              : "0 20px 60px rgba(0,0,0,0.3)",
            transition: "box-shadow 400ms ease",
          }}>
          <span className="font-black text-3xl" style={{ color: colors.primary }}>[K</span>
        </div>
        <p className="text-white font-black text-xl tracking-[0.3em]">KONSOLIDATOR</p>
        <p className="text-xs mt-3 tracking-[0.25em] uppercase font-bold"
          style={{
            color: "rgba(255,255,255,0.5)",
            opacity: phase >= PHASE.CONSOLIDATE.id ? 1 : phase >= PHASE.ORBIT_LABELS.id ? 0.7 : 0,
            transition: "opacity 300ms ease",
          }}>
          {phase >= PHASE.CONSOLIDATE.id ? "Group Consolidated" : phase >= PHASE.FETCH_LINES.id ? "Aggregating Sources" : "Initializing"}
        </p>
      </div>

      <style>{`
        @keyframes pulse-bg { 0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.05); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; r: 4; } 50% { opacity: 0.5; r: 6; } }
      `}</style>
    </div>
  );
}