import { useState, useEffect, useRef } from "react";
import { useSettings, useSettingsControls } from "./SettingsContext";

const ENDPOINTS = [
  { key: "sources",     label: "Sources",     endpoint: "/v2/sources",     angle: -135 },
  { key: "structures",  label: "Perimeters",  endpoint: "/v2/structures",  angle: -45  },
  { key: "companies",   label: "Companies",   endpoint: "/v2/companies",   angle:  45  },
  { key: "dimensions",  label: "Dimensions",  endpoint: "/v2/dimensions",  angle:  135 },
];

// Group-accounts is fetched silently in background — not part of the orbit animation
const SILENT_ENDPOINTS = [
  { key: "groupAccounts", endpoint: "/v2/group-accounts" },
];

/* Pre-fetch home data while the loader is animating.
   Resolves with { latestPeriod, currentRows, prevRows, trendRows } or null on failure. */
async function prefetchHomeData(token, sources, structures, companies) {
  try {
    const src = sources[0]    ? (sources[0].source    ?? sources[0].Source    ?? sources[0]) : "";
    const str = structures[0] ? (structures[0].groupStructure ?? structures[0].GroupStructure ?? structures[0]) : "";
    const co  = companies[0]  ? (companies[0].companyShortName ?? companies[0].CompanyShortName ?? companies[0]) : "";
    if (!src || !str || !co) return null;

    // 1. Get periods, sort desc, keep top 36 actuals
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

    // 2. Check sessionStorage cache first
    const cacheKey = `home_latest_period_${src}_${str}_${co}`;
    let latestPeriod = null;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.year && parsed.month) latestPeriod = parsed;
      } catch { /* ignore */ }
    }

    // 3. If no cache, probe in parallel batches of 6
    if (!latestPeriod) {
      const BATCH = 6;
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

    // 4. Fire all needed fetches in parallel: 12 trend months + prev month
    const { year, month } = latestPeriod;
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

    // Note: trend includes current month (last item) — re-use to avoid duplicate fetch
    const [trendResults, prevRows] = await Promise.all([
      Promise.all(trendMonths.map(({ year: y, month: m }) =>
        fetchOne(y, m).then(rows => ({ year: y, month: m, rows }))
      )),
      fetchOne(prevY, prevM),
    ]);
    const currentRows = trendResults[trendResults.length - 1]?.rows ?? [];
    return {
      latestPeriod,
      year: latestPeriod.year,
      month: latestPeriod.month,
      current: currentRows,
      prev: prevRows,
      trend: trendResults,
    };
  } catch (e) {
    console.error("[PREFETCH] failed:", e);
    return null;
  }
}

const PHASE = {
  LOGO_IN:        { id: 0, duration: 500  },
  ORBIT_LABELS:   { id: 1, duration: 400  },
  FETCH_LINES:    { id: 2, duration: 1500 },
  CONSOLIDATE:    { id: 3, duration: 600  },
  ZOOM_OUT:       { id: 4, duration: 500  },
};

const TOTAL_MAX = 5000;

export default function EpicLoader({ token, onReady, onDataLoaded }) {
  const { colors } = useSettings();
  const { settings, setDetectedLocale } = useSettingsControls();
  const [phase, setPhase] = useState(PHASE.LOGO_IN.id);
  const [completedKeys, setCompletedKeys] = useState({});
  const [allDone, setAllDone] = useState(false);
  const startTimeRef = useRef(Date.now());
  const dataRef = useRef({});

  // Fetch all 4 base entities in parallel; once done, kick off home prefetch in background
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      // Phase 1a: fetch the 4 base entities (used by the animation counters)
      const visibleFetches = Promise.all(ENDPOINTS.map(async ({ key, endpoint }) => {
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
        } catch {
          if (cancelled) return;
          dataRef.current[key] = [];
          setCompletedKeys(prev => ({ ...prev, [key]: 0 }));
        }
      }));

      // Phase 1b: fetch silent endpoints (group-accounts) in parallel — needed by HomePage
      const silentFetches = Promise.all(SILENT_ENDPOINTS.map(async ({ key, endpoint }) => {
        try {
          const res = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const rows = json.value ?? (Array.isArray(json) ? json : [json]);
          if (cancelled) return;
          dataRef.current[key] = rows;
          console.log(`[EpicLoader] fetched ${key}:`, rows.length);
        } catch (e) {
          if (cancelled) return;
          dataRef.current[key] = [];
          console.error(`[EpicLoader] ${key} fetch failed:`, e);
        }
      }));

      // Wait for visible fetches (animation needs the counts) but don't block on silent ones yet
      await visibleFetches;

      // Phase 2: prefetch home data + finish silent fetches in parallel
      const [homePrefetch] = await Promise.all([
        prefetchHomeData(
          token,
          dataRef.current.sources    ?? [],
          dataRef.current.structures ?? [],
          dataRef.current.companies  ?? [],
        ),
        silentFetches,
      ]);
      if (cancelled) return;
      if (homePrefetch) {
        dataRef.current.__homePrefetch = homePrefetch;
      }
      console.log("[EpicLoader] all done. dataRef keys:", Object.keys(dataRef.current),
        "groupAccounts:", dataRef.current.groupAccounts?.length,
        "__homePrefetch?", !!dataRef.current.__homePrefetch);
    })();

    return () => { cancelled = true; };
  }, [token]);

  // Phase progression
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(PHASE.ORBIT_LABELS.id), PHASE.LOGO_IN.duration);
    const t2 = setTimeout(() => setPhase(PHASE.FETCH_LINES.id),
      PHASE.LOGO_IN.duration + PHASE.ORBIT_LABELS.duration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // When all fetches done AND minimum time elapsed → enter consolidate
  useEffect(() => {
    const allFetchesDone = Object.keys(completedKeys).length === ENDPOINTS.length;
    if (!allFetchesDone) return;

    const elapsed = Date.now() - startTimeRef.current;
    const baseTime = PHASE.LOGO_IN.duration + PHASE.ORBIT_LABELS.duration + PHASE.FETCH_LINES.duration;
    const wait = Math.max(0, baseTime - elapsed);

    const t = setTimeout(() => {
      setPhase(PHASE.CONSOLIDATE.id);
      setTimeout(() => setPhase(PHASE.ZOOM_OUT.id), PHASE.CONSOLIDATE.duration);
      setTimeout(() => {
        setAllDone(true);
        if (onDataLoaded) onDataLoaded(dataRef.current);
        if (onReady) onReady();
      }, PHASE.CONSOLIDATE.duration + PHASE.ZOOM_OUT.duration);
    }, wait);

    return () => clearTimeout(t);
  }, [completedKeys, onReady, onDataLoaded]);

  // Hard cap — if fetches stuck, force complete
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
          if (onDataLoaded) onDataLoaded(dataRef.current);
          if (onReady) onReady();
        }, PHASE.ZOOM_OUT.duration);
      }
    }, TOTAL_MAX);
    return () => clearTimeout(t);
  }, [allDone, onReady, onDataLoaded]);

  if (allDone) return null;

  const isZoomOut = phase >= PHASE.ZOOM_OUT.id;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        backgroundColor: colors.primary,
        opacity: isZoomOut ? 0 : 1,
        transform: isZoomOut ? "scale(1.4)" : "scale(1)",
        transition: `opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 500ms cubic-bezier(0.4,0,0.2,1)`,
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute rounded-full"
          style={{
            width: "120vmax", height: "120vmax",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)`,
            animation: phase >= PHASE.ORBIT_LABELS.id ? "pulse-bg 3s ease-in-out infinite" : "none",
          }}
        />
        <div
          className="absolute rounded-full border"
          style={{
            width: "40vmax", height: "40vmax",
            top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${phase >= PHASE.CONSOLIDATE.id ? 0 : 1})`,
            borderColor: "rgba(255,255,255,0.08)",
            transition: "transform 600ms cubic-bezier(0.4,0,0.2,1)",
          }}
        />
        <div
          className="absolute rounded-full border"
          style={{
            width: "60vmax", height: "60vmax",
            top: "50%", left: "50%",
            transform: `translate(-50%, -50%) scale(${phase >= PHASE.CONSOLIDATE.id ? 0 : 1})`,
            borderColor: "rgba(255,255,255,0.05)",
            transition: "transform 700ms cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </div>

      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="-500 -500 1000 1000"
        preserveAspectRatio="xMidYMid meet"
      >
        {ENDPOINTS.map((ep, i) => {
          const rad = (ep.angle * Math.PI) / 180;
          const startR = 480;
          const endR = 70;
          const x1 = Math.cos(rad) * startR;
          const y1 = Math.sin(rad) * startR;
          const x2 = Math.cos(rad) * endR;
          const y2 = Math.sin(rad) * endR;
          const isCompleted = completedKeys[ep.key] !== undefined;
          const isLineDrawing = phase >= PHASE.FETCH_LINES.id;

          return (
            <g key={ep.key}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isCompleted ? "#ffffff" : "rgba(255,255,255,0.25)"}
                strokeWidth={isCompleted ? 1.5 : 1}
                strokeDasharray="600"
                strokeDashoffset={isLineDrawing ? 0 : 600}
                style={{
                  transition: `stroke-dashoffset 1200ms cubic-bezier(0.4,0,0.2,1) ${i * 150}ms, stroke 400ms ease, stroke-width 400ms ease`,
                  opacity: phase >= PHASE.CONSOLIDATE.id ? 0 : 1,
                }}
              />
              {isCompleted && phase < PHASE.CONSOLIDATE.id && (
                <circle
                  cx={x1} cy={y1} r="4"
                  fill="#ffffff"
                  style={{
                    filter: "drop-shadow(0 0 8px rgba(255,255,255,0.8))",
                    animation: "pulse-dot 1.2s ease-in-out infinite",
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {ENDPOINTS.map((ep) => {
        const rad = (ep.angle * Math.PI) / 180;
        const r = 280;
        const x = Math.cos(rad) * r;
        const y = Math.sin(rad) * r;
        const count = completedKeys[ep.key];
        const visible = phase >= PHASE.ORBIT_LABELS.id && phase < PHASE.CONSOLIDATE.id;

        return (
          <div
            key={ep.key}
            className="absolute text-center"
            style={{
              top: "50%", left: "50%",
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${visible ? 1 : 0.6})`,
              opacity: visible ? 1 : 0,
              transition: "opacity 400ms ease, transform 400ms cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <p
              className="font-black uppercase tracking-widest"
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.5)",
                marginBottom: 4,
              }}
            >
              {ep.label}
            </p>
            <p
              className="font-black tabular-nums"
              style={{
                fontSize: 28,
                color: count !== undefined ? "#ffffff" : "rgba(255,255,255,0.3)",
                transition: "color 300ms ease",
                textShadow: count !== undefined ? "0 0 20px rgba(255,255,255,0.4)" : "none",
              }}
            >
              {count !== undefined ? count : "···"}
            </p>
          </div>
        );
      })}

      <div
        className="relative z-10 flex flex-col items-center"
        style={{
          transform: phase >= PHASE.CONSOLIDATE.id
            ? "scale(1.15)"
            : phase >= PHASE.LOGO_IN.id
              ? "scale(1)"
              : "scale(0.5)",
          opacity: phase >= PHASE.LOGO_IN.id ? 1 : 0,
          transition: "transform 500ms cubic-bezier(0.34,1.56,0.64,1), opacity 500ms ease",
        }}
      >
        <div
          className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-2xl mb-5"
          style={{
            boxShadow: phase >= PHASE.CONSOLIDATE.id
              ? "0 0 80px rgba(255,255,255,0.8), 0 0 200px rgba(255,255,255,0.4)"
              : "0 20px 60px rgba(0,0,0,0.3)",
            transition: "box-shadow 600ms ease",
          }}
        >
          <span className="font-black text-3xl" style={{ color: colors.primary }}>[K</span>
        </div>
        <p className="text-white font-black text-xl tracking-[0.3em]">KONSOLIDATOR</p>
        <p
          className="text-xs mt-3 tracking-[0.25em] uppercase font-bold"
          style={{
            color: "rgba(255,255,255,0.5)",
            opacity: phase >= PHASE.CONSOLIDATE.id ? 1 : phase >= PHASE.ORBIT_LABELS.id ? 0.7 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          {phase >= PHASE.CONSOLIDATE.id
            ? "Group Consolidated"
            : phase >= PHASE.FETCH_LINES.id
              ? "Aggregating Sources"
              : "Initializing"}
        </p>
      </div>

      <style>{`
        @keyframes pulse-bg {
          0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 0.7; transform: translate(-50%, -50%) scale(1.05); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; r: 4; }
          50%      { opacity: 0.5; r: 6; }
        }
      `}</style>
    </div>
  );
}