import { useState, useEffect, useRef } from "react";
import { Database, Network, Building2, Layers, BookOpen, Scale, CalendarCheck, Check, AlertTriangle } from "lucide-react";
import { useSettingsControls } from "./SettingsContext";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";

/* ════════════════════════════════════════════════════════════════════════
   EpicLoader — pantalla de entrada tras el login.

   Datos (lo importante):
   · Cada endpoint se reintenta con espera creciente ante 429 / 5xx / 401 /
     fallos de red. Antes un 429 se convertía en "0 dimensiones" y se quedaba
     así hasta volver a hacer login.
   · Una lista vacía de fuentes / perímetros / sociedades / dimensiones se
     confirma con una segunda petición antes de darla por buena.
   · Ya no se corta a los 4 s con datos a medias: se espera a que todo
     termine (máx. CEILING_MS). Si algo sigue pendiente o falla, se entra
     igualmente y se sigue reintentando en segundo plano; cuando llega,
     se vuelve a llamar a onDataLoaded con los datos completos.

   Animación: red de consolidación interactiva. Las tarjetas de cada fuente
   envían paquetes de datos al núcleo; el fondo es una red de partículas que
   sigue al ratón y reacciona a los clics.
   ════════════════════════════════════════════════════════════════════════ */

const MAIN = [
  { key: "sources",    endpoint: "/v2/sources",    icon: Database,  angle: -148 },
  { key: "structures", endpoint: "/v2/structures", icon: Network,   angle: -32  },
  { key: "companies",  endpoint: "/v2/companies",  icon: Building2, angle: 32   },
  { key: "dimensions", endpoint: "/v2/dimensions", icon: Layers,    angle: 148  },
];
const SIDE = [
  { key: "groupAccounts", icon: BookOpen },
  { key: "standard",      icon: Scale },
  { key: "period",        icon: CalendarCheck },
];
const WEIGHTS = { sources: 17, structures: 17, companies: 17, dimensions: 17, groupAccounts: 18, standard: 6, period: 8 };

const MIN_ANIM_MS       = 1500;  // lo justo para que la entrada se vea
const CEILING_MS        = 15000; // nunca más que esto en la pantalla de carga
const HOME_PREFETCH_MAX = 2000;  // detección del último periodo (HomePage lo hace si no llega)
const GATHER_MS = 560, EXIT_MS = 640;

const SB_URL = "https://gmcawsapzkzmgrtiqebv.supabase.co";
const SB_KEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

const TEXT = {
  es: {
    title: "Preparando tu grupo", sources: "Fuentes", structures: "Perímetros", companies: "Sociedades", dimensions: "Dimensiones",
    groupAccounts: "Plan de cuentas", standard: "Estándar", period: "Último periodo",
    loading: "Cargando", retrying: "Reintentando", waiting: "En cola", none: "Sin datos", failed: "Sin respuesta, se reintentará",
    stepLoad: "Cargando {x}", stepRetry: "{x} no responde, reintento {n}", stepPeriod: "Buscando el último periodo con datos",
    stepStd: "Leyendo el estándar contable", stepDone: "Todo listo", stepGather: "Consolidando",
    hint: "Mueve el ratón por la red. Haz clic para enviar datos al núcleo.",
  },
  en: {
    title: "Preparing your group", sources: "Sources", structures: "Perimeters", companies: "Companies", dimensions: "Dimensions",
    groupAccounts: "Chart of accounts", standard: "Standard", period: "Latest period",
    loading: "Loading", retrying: "Retrying", waiting: "Queued", none: "No data", failed: "No response, will retry",
    stepLoad: "Loading {x}", stepRetry: "{x} not responding, retry {n}", stepPeriod: "Finding the latest period with data",
    stepStd: "Reading the accounting standard", stepDone: "All set", stepGather: "Consolidating",
    hint: "Move the mouse through the network. Click to send data to the core.",
  },
  da: {
    title: "Forbereder din koncern", sources: "Kilder", structures: "Perimetre", companies: "Selskaber", dimensions: "Dimensioner",
    groupAccounts: "Kontoplan", standard: "Standard", period: "Seneste periode",
    loading: "Indlæser", retrying: "Prøver igen", waiting: "I kø", none: "Ingen data", failed: "Intet svar, prøver igen",
    stepLoad: "Indlæser {x}", stepRetry: "{x} svarer ikke, forsøg {n}", stepPeriod: "Finder seneste periode med data",
    stepStd: "Læser regnskabsstandarden", stepDone: "Klar", stepGather: "Konsoliderer",
    hint: "Bevæg musen gennem netværket. Klik for at sende data til kernen.",
  },
  pt: {
    title: "A preparar o seu grupo", sources: "Fontes", structures: "Perímetros", companies: "Sociedades", dimensions: "Dimensões",
    groupAccounts: "Plano de contas", standard: "Normativo", period: "Último período",
    loading: "A carregar", retrying: "A repetir", waiting: "Em fila", none: "Sem dados", failed: "Sem resposta, vai repetir",
    stepLoad: "A carregar {x}", stepRetry: "{x} não responde, tentativa {n}", stepPeriod: "A procurar o último período com dados",
    stepStd: "A ler o normativo contabilístico", stepDone: "Tudo pronto", stepGather: "A consolidar",
    hint: "Mova o rato pela rede. Clique para enviar dados para o núcleo.",
  },
};

/* ── Red ─────────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RETRYABLE = new Set([401, 408, 425, 429, 500, 502, 503, 504]);
const backoff = (a) => Math.min(3000, 350 * 2 ** (a - 1)) + Math.random() * 250;
const toRows = (json) => json?.value ?? (Array.isArray(json) ? json : (json ? [json] : []));

// GET con reintentos hasta `deadline` (o `attempts`). Nunca lanza.
async function fetchRows(url, token, { attempts = 4, deadline = Infinity, onRetry } = {}) {
  let last = null;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
      });
      if (res.ok) return { ok: true, rows: toRows(await res.json()), attempts: a };
      last = res.status;
      if (!RETRYABLE.has(res.status)) break;
      const ra = Number(res.headers.get("Retry-After"));
      const wait = ra > 0 ? Math.min(ra * 1000, 4000) : backoff(a);
      if (a >= attempts || Date.now() + wait > deadline) break;
      onRetry?.(a + 1, res.status);
      await sleep(wait);
    } catch {
      last = "network";
      const wait = backoff(a);
      if (a >= attempts || Date.now() + wait > deadline) break;
      onRetry?.(a + 1, "network");
      await sleep(wait);
    }
  }
  return { ok: false, rows: [], status: last };
}

async function prefetchHomeData(token, sources, structures, companies) {
  try {
    const src = sources[0]    ? (sources[0].source    ?? sources[0].Source    ?? sources[0]) : "";
    const str = structures[0] ? (structures[0].groupStructure ?? structures[0].GroupStructure ?? structures[0]) : "";
    const co  = companies[0]  ? (companies[0].companyShortName ?? companies[0].CompanyShortName ?? companies[0]) : "";
    if (!src || !str || !co) return null;

    const cacheKey = `home_latest_period_${src}_${str}_${co}`;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
      if (parsed?.year && parsed?.month) return { latestPeriod: parsed, year: parsed.year, month: parsed.month, current: [], prev: [], trend: [], allCoCurrentRows: [] };
    } catch { /* ignore */ }

    const pr = await fetchRows("/v2/periods", token, { attempts: 3 });
    if (!pr.ok) return null;
    const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];
    const actuals = pr.rows
      .filter(p => String(getP(p, "source") ?? "").toLowerCase() === "actual")
      .sort((a, b) => {
        const ay = Number(getP(a, "year") || 0), by = Number(getP(b, "year") || 0);
        const am = Number(getP(a, "month") || 0), bm = Number(getP(b, "month") || 0);
        return by !== ay ? by - ay : bm - am;
      })
      .slice(0, 36);

    // Tandas de 6 (antes 12): una ráfaga de 12 peticiones a la vez provocaba
    // 429 en dimensiones / plan de cuentas, que aún se estaban cargando.
    let latestPeriod = null;
    for (let i = 0; i < actuals.length && !latestPeriod; i += 6) {
      const probes = await Promise.all(actuals.slice(i, i + 6).map(async (p) => {
        const y = Number(getP(p, "year")), m = Number(getP(p, "month"));
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}' and CompanyShortName eq '${co}'`;
        const r = await fetchRows(`/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, token, { attempts: 2 });
        return { y, m, source: getP(p, "source"), hasData: r.ok && r.rows.length > 0 };
      }));
      const hit = probes.find(x => x.hasData);
      if (hit) {
        latestPeriod = { year: hit.y, month: hit.m, source: hit.source };
        try { sessionStorage.setItem(cacheKey, JSON.stringify(latestPeriod)); } catch { /* ignore */ }
      }
    }
    if (!latestPeriod) return null;
    return { latestPeriod, year: latestPeriod.year, month: latestPeriod.month, current: [], prev: [], trend: [], allCoCurrentRows: [] };
  } catch {
    return null;
  }
}

async function fetchActiveStandard() {
  const { supabase } = await import("../../lib/supabaseClient");
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id, jwt = session?.access_token;
  if (!uid || !jwt) return null;
  const get = async (url, profile) => {
    for (let a = 1; a <= 3; a++) {
      try {
        const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}`, ...(profile ? { "Accept-Profile": profile } : {}) } });
        if (res.ok) return await res.json();
        if (!RETRYABLE.has(res.status)) return null;
      } catch { /* reintento */ }
      await sleep(backoff(a));
    }
    return null;
  };
  const uc = await get(`${SB_URL}/rest/v1/user_companies?user_id=eq.${uid}&is_active=eq.true&select=company_id,is_default`, "accounts");
  if (!Array.isArray(uc) || !uc.length) return null;
  const cid = uc.find(r => r.is_default)?.company_id ?? uc[0]?.company_id;
  if (!cid) return null;
  const rows = await get(`${SB_URL}/rest/v1/company_active_standard?select=standard_key&company_id=eq.${cid}`);
  return Array.isArray(rows) && rows[0]?.standard_key ? rows[0].standard_key : null;
}

/* ── Utilidades de presentación ──────────────────────────────────────── */

function pickLang(locale) {
  const l = String(locale && locale !== "auto" ? locale : (typeof navigator !== "undefined" ? navigator.language : "en")).slice(0, 2).toLowerCase();
  return TEXT[l] ? l : "en";
}

function layoutFor(w, h) {
  const hub = { x: w / 2, y: Math.round(h * 0.43) };
  const rx = Math.min(w * 0.34, 450), ry = Math.min(h * 0.25, 215);
  const cards = MAIN.map(m => {
    const rad = (m.angle * Math.PI) / 180;
    return { key: m.key, x: Math.round(hub.x + Math.cos(rad) * rx), y: Math.round(hub.y + Math.sin(rad) * ry) };
  });
  return { hub, cards };
}

function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const val = from + (target - from) * (1 - Math.pow(1 - k, 4));
      cur.current = val;
      setV(val);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const busy = (s) => s === "loading" || s === "retrying" || s === "idle";

/* ════════════════════════════════════════════════════════════════════════ */

export default function EpicLoader({ token, onReady, onDataLoaded }) {
  const { settings, setDetectedLocale } = useSettingsControls();
  const { setLatestPeriod } = useLatestPeriod();

  // Refs estables: los efectos no se reinician si el padre cambia de función
  const onReadyRef = useRef(onReady);
  const onDataLoadedRef = useRef(onDataLoaded);
  const setLatestPeriodRef = useRef(setLatestPeriod);
  const setDetectedLocaleRef = useRef(setDetectedLocale);
  const localeRef = useRef(settings?.locale ?? "auto");
  useEffect(() => {
    onReadyRef.current = onReady;
    onDataLoadedRef.current = onDataLoaded;
    setLatestPeriodRef.current = setLatestPeriod;
    setDetectedLocaleRef.current = setDetectedLocale;
    localeRef.current = settings?.locale ?? "auto";
  });

  const L = TEXT[pickLang(settings?.locale)];

  const [nodes, setNodes] = useState(() =>
    Object.fromEntries([...MAIN, ...SIDE].map(n => [n.key, { status: "idle" }])));
  const [phase, setPhase] = useState("loading"); // loading | gather | exit | done
  // ¿Venimos del login? Entonces el login ya ha dejado el núcleo pintado en el
  // mismo sitio (puente en el <body>): no hay fundido de entrada y las
  // partículas salen disparadas desde el núcleo.
  const [handoff] = useState(() => {
    try {
      const ts = Number(sessionStorage.getItem("k_login_handoff"));
      return !!ts && Date.now() - ts < 6000;
    } catch { return false; }
  });
  const handoffRef = useRef(handoff);
  useEffect(() => {
    try { sessionStorage.removeItem("k_login_handoff"); } catch { /* ignore */ }
    const bridge = typeof document !== "undefined" ? document.getElementById("k-handoff-bridge") : null;
    if (!bridge) return undefined;
    let t = 0;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      bridge.style.opacity = "0";
      t = setTimeout(() => bridge.remove(), 450);
    }));
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, []);
  const [size, setSize] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1440,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  }));

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const sceneRef = useRef({ layout: layoutFor(size.w, size.h), nodes, phase });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layout = layoutFor(size.w, size.h);
  useEffect(() => { sceneRef.current = { layout: layoutFor(size.w, size.h), nodes, phase }; }, [size, nodes, phase]);

  /* ── Carga de datos ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false, handed = false, finishing = false;
    const live = () => !cancelled || handed;
    const t0 = Date.now();
    const deadline = t0 + CEILING_MS - 1200;
    const data = {};
    const settled = new Set();
    const failed = new Set();
    const timers = [];
    let periodSettled = false;

    const patch = (key, p) => { if (live()) setNodes(prev => ({ ...prev, [key]: { ...prev[key], ...p } })); };
    const lateUpdate = () => { if (handed) onDataLoadedRef.current?.({ ...data }); };

    // Tras entrar en la app: reintentos en segundo plano de lo que faltó
    const backgroundFix = async (key, endpoint) => {
      for (let i = 0; i < 8 && handed; i++) {
        await sleep(3500 + i * 1500);
        const r = await fetchRows(endpoint, token, { attempts: 2 });
        if (r.ok) { data[key] = r.rows; lateUpdate(); return; }
      }
    };

    const loadKey = async (key, endpoint, confirmEmpty) => {
      const s = performance.now();
      patch(key, { status: "loading", attempt: 1 });
      let r = await fetchRows(endpoint, token, {
        attempts: 40, deadline,
        onRetry: (attempt, why) => patch(key, { status: "retrying", attempt, why }),
      });
      // Una lista vacía puede ser un fallo transitorio de la API: se confirma.
      if (r.ok && confirmEmpty && r.rows.length === 0) {
        await sleep(650);
        const again = await fetchRows(endpoint, token, { attempts: 3 });
        if (again.ok) r = again;
      }
      if (!live()) return;
      if (r.ok) {
        data[key] = r.rows;
        patch(key, { status: "done", count: r.rows.length, ms: Math.round(performance.now() - s) });
        lateUpdate();
      } else {
        patch(key, { status: "error", why: r.status });
        failed.add(key);
        if (handed) backgroundFix(key, endpoint);
      }
      settled.add(key);
      check();
    };

    const finish = () => {
      if (handed || cancelled || finishing) return;
      finishing = true;
      // Lo que no haya llegado entra vacío y se completa después
      [...MAIN.map(m => m.key), "groupAccounts"].forEach(k => { if (!(k in data)) data[k] = []; });
      if (!("activeStandardKey" in data)) data.activeStandardKey = null;

      if ((localeRef.current ?? "auto") === "auto") {
        const codes = (data.groupAccounts ?? []).map(n => String(n.AccountCode ?? n.accountCode ?? "")).filter(Boolean);
        if (codes.length) {
          const isDanish = codes.some(c => /^\d{5,6}$/.test(c));
          const isPGC = codes.some(c => c.endsWith(".S"));
          setDetectedLocaleRef.current?.(isDanish ? "da" : isPGC ? "es" : "en");
        }
      }

      setPhase("gather");
      engineRef.current?.consolidate();
      timers.push(setTimeout(() => setPhase("exit"), GATHER_MS));
      timers.push(setTimeout(() => {
        handed = true;
        onDataLoadedRef.current?.({ ...data });
        onReadyRef.current?.();
        setPhase("done");
        // Reintentos en segundo plano de lo que falló o aún no ha llegado
        [...MAIN, { key: "groupAccounts", endpoint: "/v2/group-accounts" }].forEach(({ key, endpoint }) => {
          // Lo que sigue en vuelo avisa solo al terminar (loadKey → lateUpdate)
          if (failed.has(key)) backgroundFix(key, endpoint);
        });
      }, GATHER_MS + EXIT_MS));
    };

    function check() {
      if (handed || cancelled || finishing) return;
      const required = [...MAIN.map(m => m.key), "groupAccounts", "standard"];
      if (required.some(k => !settled.has(k)) || !periodSettled) return;
      const wait = Math.max(0, MIN_ANIM_MS - (Date.now() - t0));
      timers.push(setTimeout(finish, wait));
    }

    // Arranque escalonado (60 ms) para no disparar todas a la vez contra la API
    const mainPromises = {};
    MAIN.forEach((m, i) => {
      mainPromises[m.key] = sleep(i * 60).then(() => loadKey(m.key, m.endpoint, true));
    });
    sleep(260).then(() => loadKey("groupAccounts", "/v2/group-accounts", false));

    (async () => {
      patch("standard", { status: "loading" });
      let key = null;
      try { key = await fetchActiveStandard(); } catch { key = null; }
      if (!live()) return;
      data.activeStandardKey = key;
      patch("standard", { status: "done", label: key });
      lateUpdate();
      settled.add("standard");
      check();
    })();

    (async () => {
      await Promise.all([mainPromises.sources, mainPromises.structures, mainPromises.companies]);
      if (!live()) return;
      patch("period", { status: "loading" });
      const prefetch = prefetchHomeData(token, data.sources ?? [], data.structures ?? [], data.companies ?? []);
      const res = await Promise.race([prefetch, sleep(HOME_PREFETCH_MAX).then(() => "timeout")]);
      if (!live()) return;
      const applyPeriod = (hp) => {
        if (!hp?.year || !hp?.month) return;
        try {
          const s = data.sources?.[0], st = data.structures?.[0], c = data.companies?.[0];
          const src = s ? (s.source ?? s.Source ?? s) : "";
          const str = st ? (st.groupStructure ?? st.GroupStructure ?? st) : "";
          const co = c ? (c.companyShortName ?? c.CompanyShortName ?? c) : "";
          if (src && str && co) setLatestPeriodRef.current?.(src, str, co, hp.year, hp.month);
        } catch { /* las páginas lo detectan por su cuenta */ }
      };
      if (res && res !== "timeout") {
        data.__homePrefetch = res;
        applyPeriod(res);
        patch("period", { status: "done", label: `${String(res.month).padStart(2, "0")}/${res.year}` });
      } else {
        patch("period", { status: "done", label: null });
        // Si llega tarde, igualmente se aprovecha
        if (res === "timeout") prefetch.then(late => { if (late && live()) { data.__homePrefetch = late; applyPeriod(late); } });
      }
      periodSettled = true;
      check();
    })();

    timers.push(setTimeout(finish, CEILING_MS));

    return () => {
      timers.forEach(clearTimeout);
      if (!handed) cancelled = true;
    };
  }, [token]);

  /* ── Motor visual (canvas) ─────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current, root = rootRef.current;
    if (!canvas || !root) return undefined;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now();
    const mouse = { x: -9999, y: -9999, sx: 0, sy: 0, px: 0, py: 0, inside: false };
    let particles = [], packets = [], shocks = [];
    let energy = 0, flash = 0;
    const spawnClock = {};

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = reduce ? 40 : Math.round(Math.min(130, (W * H) / 12000));
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: 0.8 + Math.random() * 1.6, a: 0.25 + Math.random() * 0.5,
      }));
    };
    resize();
    window.addEventListener("resize", resize);
    // Llegada desde el login: las partículas salen disparadas desde el núcleo
    let burst = 0;
    if (handoffRef.current && !reduce) {
      const { hub } = sceneRef.current.layout;
      burst = 1;
      particles.forEach(p => {
        const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 10;
        p.x = hub.x + Math.cos(ang) * 30; p.y = hub.y + Math.sin(ang) * 30;
        p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
      });
    }

    const parallax = (depth) => ({ x: mouse.px * depth, y: mouse.py * depth });

    const sendPacket = (x, y, opts = {}) => {
      const { hub } = sceneRef.current.layout;
      const hp = parallax(-8);
      const tx = hub.x + hp.x, ty = hub.y + hp.y;
      const dx = tx - x, dy = ty - y, len = Math.hypot(dx, dy) || 1;
      const bend = (Math.random() - 0.5) * 0.5 * len;
      packets.push({
        x0: x, y0: y, x1: tx, y1: ty,
        cx: (x + tx) / 2 + (-dy / len) * bend, cy: (y + ty) / 2 + (dx / len) * bend,
        t: 0, speed: (opts.speed ?? 0.6) + Math.random() * 0.35,
        color: opts.color ?? "255,255,255", size: opts.size ?? 2.2,
      });
    };

    const shock = (x, y, power = 1) => {
      shocks.push({ x, y, r: 6, a: 0.7 * power, power });
      particles.forEach(p => {
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
        if (d < 300 * power) { const f = (1 - d / (300 * power)) * 5 * power; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      });
    };

    const cardPos = (key) => {
      const c = sceneRef.current.layout.cards.find(k => k.key === key);
      const p = parallax(16);
      return c ? { x: c.x + p.x, y: c.y + p.y } : null;
    };

    engineRef.current = {
      burst(key, n = 14) {
        const c = cardPos(key); if (!c) return;
        for (let i = 0; i < n; i++) sendPacket(c.x + (Math.random() - 0.5) * 40, c.y + (Math.random() - 0.5) * 30, { speed: 0.8 });
        shock(c.x, c.y, 0.55);
      },
      clickAt(x, y) {
        shock(x, y, 1);
        for (let i = 0; i < 9; i++) sendPacket(x, y, { speed: 0.7, color: "255,220,150" });
      },
      hub() {
        const { hub } = sceneRef.current.layout;
        shock(hub.x, hub.y, 1.6); flash = 1;
      },
      consolidate() {
        const { hub } = sceneRef.current.layout;
        MAIN.forEach(m => { const c = cardPos(m.key); if (c) for (let i = 0; i < 10; i++) sendPacket(c.x, c.y, { speed: 1.3 }); });
        setTimeout(() => { shock(hub.x, hub.y, 2); flash = 1; }, 320);
      },
    };

    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; };
    const onLeave = () => { mouse.inside = false; };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);

    const bez = (p, t) => {
      const u = 1 - t;
      return { x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1, y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1 };
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { layout, nodes: st, phase: ph } = sceneRef.current;
      burst = Math.max(0, burst - dt * 0.7);

      // Ratón suavizado → parallax (variables CSS, sin re-render)
      const tx = mouse.inside ? (mouse.x / W - 0.5) * 2 : 0, ty = mouse.inside ? (mouse.y / H - 0.5) * 2 : 0;
      mouse.px += (tx - mouse.px) * (reduce ? 1 : 0.06);
      mouse.py += (ty - mouse.py) * (reduce ? 1 : 0.06);
      if (reduce) { mouse.px = 0; mouse.py = 0; }
      energy *= Math.pow(0.35, dt); flash *= Math.pow(0.06, dt);
      root.style.setProperty("--px", mouse.px.toFixed(4));
      root.style.setProperty("--py", mouse.py.toFixed(4));
      root.style.setProperty("--energy", Math.min(1, energy + flash).toFixed(3));

      ctx.clearRect(0, 0, W, H);

      // Partículas
      for (const p of particles) {
        if (mouse.inside && !reduce) {
          const dx = mouse.x - p.x, dy = mouse.y - p.y, d = Math.hypot(dx, dy);
          if (d < 190 && d > 1) { const f = (1 - d / 190) * 0.035; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
        }
        p.vx += (Math.random() - 0.5) * 0.015; p.vy += (Math.random() - 0.5) * 0.015;
        p.vx *= 0.975; p.vy *= 0.975;
        const lim = 3 + burst * 10; const sp = Math.hypot(p.vx, p.vy); if (sp > lim) { p.vx *= lim / sp; p.vy *= lim / sp; }
        if (!reduce) { p.x += p.vx; p.y += p.vy; }
        if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 125 * 125) {
            ctx.strokeStyle = `rgba(190,210,255,${(1 - Math.sqrt(d2) / 125) * 0.16})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        if (mouse.inside) {
          const dx = a.x - mouse.x, dy = a.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 190) {
            ctx.strokeStyle = `rgba(255,255,255,${(1 - d / 190) * 0.45})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
          }
        }
      }
      for (const p of particles) {
        ctx.fillStyle = `rgba(255,255,255,${p.a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      if (mouse.inside && !reduce) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 60);
        g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 60, 0, Math.PI * 2); ctx.fill();
      }

      // Conductos tarjeta → núcleo
      const hp = parallax(-8), hub = { x: layout.hub.x + hp.x, y: layout.hub.y + hp.y };
      if (ph === "loading") {
        layout.cards.forEach(c => {
          const s = st[c.key]?.status, pp = parallax(16), x = c.x + pp.x, y = c.y + pp.y;
          const done = s === "done", warn = s === "retrying" || s === "error";
          ctx.setLineDash(done ? [] : [3, 6]);
          ctx.lineDashOffset = -now / 40;
          ctx.strokeStyle = warn ? "rgba(251,191,36,0.45)" : done ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.16)";
          ctx.lineWidth = done ? 1.4 : 1;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo((x + hub.x) / 2, (y + hub.y) / 2 - 30, hub.x, hub.y); ctx.stroke();
          ctx.setLineDash([]);
          // Paquetes mientras se carga
          spawnClock[c.key] = (spawnClock[c.key] ?? Math.random() * 0.3) - dt;
          if (busy(s) && spawnClock[c.key] <= 0 && !reduce) {
            spawnClock[c.key] = s === "retrying" ? 0.6 : 0.22;
            sendPacket(x, y, { color: s === "retrying" ? "251,191,36" : "255,255,255" });
          }
        });
      }

      // Paquetes
      ctx.globalCompositeOperation = "lighter";
      packets = packets.filter(p => {
        p.t += dt * p.speed;
        if (p.t >= 1) { energy = Math.min(1, energy + 0.05); return false; }
        for (let k = 6; k >= 0; k--) {
          const tt = Math.max(0, p.t - k * 0.018), q = bez(p, tt);
          ctx.fillStyle = `rgba(${p.color},${(1 - k / 7) * 0.55})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, p.size * (1 - k / 9), 0, Math.PI * 2); ctx.fill();
        }
        const h = bez(p, p.t), g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 9);
        g.addColorStop(0, `rgba(${p.color},0.5)`); g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, 9, 0, Math.PI * 2); ctx.fill();
        return true;
      });

      // Ondas
      shocks = shocks.filter(s => {
        s.r += dt * 520 * Math.max(0.6, s.power * 0.8); s.a *= Math.pow(0.08, dt);
        ctx.strokeStyle = `rgba(255,255,255,${s.a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
        return s.a > 0.02;
      });
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      engineRef.current = null;
    };
  }, []);

  // Ráfaga de paquetes cuando una tarjeta termina
  const burstDone = useRef(new Set());
  useEffect(() => {
    MAIN.forEach(m => {
      if (nodes[m.key]?.status === "done" && !burstDone.current.has(m.key)) {
        burstDone.current.add(m.key);
        engineRef.current?.burst(m.key, 10);
      }
    });
  }, [nodes]);

  if (phase === "done") return null;

  /* ── Estado agregado ───────────────────────────────────────────────── */
  const pctRaw = Object.entries(WEIGHTS).reduce((s, [k, w]) => {
    const st = nodes[k]?.status;
    return s + (st === "done" || st === "error" ? w : st === "retrying" ? w * 0.2 : st === "loading" ? w * 0.1 : 0);
  }, 0);
  const label = (k) => L[k] ?? k;
  const retrying = [...MAIN, { key: "groupAccounts" }].find(m => nodes[m.key]?.status === "retrying");
  const loadingMain = [...MAIN, { key: "groupAccounts" }].find(m => busy(nodes[m.key]?.status));
  let step;
  if (phase !== "loading") step = L.stepGather;
  else if (retrying) step = L.stepRetry.replace("{x}", label(retrying.key)).replace("{n}", nodes[retrying.key].attempt ?? 2);
  else if (loadingMain) step = L.stepLoad.replace("{x}", label(loadingMain.key).toLowerCase());
  else if (busy(nodes.period.status)) step = L.stepPeriod;
  else if (busy(nodes.standard.status)) step = L.stepStd;
  else step = L.stepDone;

  const { hub } = layout;

  return (
    <div
      ref={rootRef}
      className={`ekRoot ek-${phase} ${handoff ? "ek-handoff" : ""}`}
      style={{ "--hx": `${hub.x}px`, "--hy": `${hub.y}px` }}
      onPointerDown={(e) => { if (e.target === rootRef.current || e.target === canvasRef.current) engineRef.current?.clickAt(e.clientX, e.clientY); }}
    >
      <style>{EK_CSS}</style>
      <div className="ekGlow" aria-hidden="true" />
      <canvas ref={canvasRef} className="ekCanvas" aria-hidden="true" />

      {/* Núcleo */}
      <div className="ekHub" style={{ left: hub.x, top: hub.y }}>
        <HubRing nodes={nodes} pct={pctRaw} />
        <button type="button" className="ekCore" onClick={() => engineRef.current?.hub()} aria-label={L.title}>
          <img src="/favicon.svg" alt="" className="ekLogo" draggable={false} />
          <Pct value={pctRaw} />
        </button>
      </div>

      {/* Tarjetas de cada fuente de datos */}
      {MAIN.map((m, i) => {
        const pos = layout.cards[i];
        return (
          <NodeCard key={m.key} meta={m} node={nodes[m.key]} label={label(m.key)} L={L} index={i}
            pos={pos} hub={hub}
            onActivate={() => engineRef.current?.burst(m.key, 16)} />
        );
      })}

      {/* Texto de estado y tareas secundarias */}
      <div className="ekStatus" style={{ left: hub.x, top: hub.y + 148 }} role="status" aria-live="polite">
        <h1 className="ekTitle">{L.title}</h1>
        <p className="ekStep" key={step}>{step}</p>
        <div className="ekSide">
          {SIDE.map(s => {
            const n = nodes[s.key], Icon = s.icon;
            const done = n.status === "done" || n.status === "error";
            return (
              <span key={s.key} className={`ekChip ${done ? "isDone" : ""}`}>
                <span className="ekChipIco">
                  {done ? <Check size={11} strokeWidth={3} /> : <Icon size={11} strokeWidth={2.4} />}
                </span>
                {label(s.key)}
                {s.key === "groupAccounts" && n.status === "done" && <b>{n.count}</b>}
                {s.key === "period" && n.label && <b>{n.label}</b>}
              </span>
            );
          })}
        </div>
      </div>

      <p className="ekHint">{L.hint}</p>
    </div>
  );
}

/* ── Piezas ──────────────────────────────────────────────────────────── */

function Pct({ value }) {
  const v = useCountUp(Math.round(value), 700);
  return <span className="ekPct">{Math.round(v)}<small>%</small></span>;
}

function HubRing({ nodes, pct }) {
  const R = 112, C = 2 * Math.PI * R;
  const segLen = (78 / 360) * C;
  return (
    <svg className="ekRing" width="280" height="280" viewBox="-140 -140 280 280" aria-hidden="true">
      <defs>
        <linearGradient id="ekRingGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a8c5ff" />
        </linearGradient>
      </defs>
      <circle r="132" fill="none" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 7" className="ekSpinSlow" />
      {MAIN.map(m => {
        const s = nodes[m.key]?.status;
        const fill = s === "done" ? 1 : s === "error" ? 1 : s === "retrying" ? 0.35 : s === "loading" ? 0.12 : 0;
        const color = s === "retrying" || s === "error" ? "#fbbf24" : "url(#ekRingGrad)";
        return (
          <g key={m.key} transform={`rotate(${m.angle - 39})`}>
            <circle r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${segLen} ${C}`} />
            <circle r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${segLen * fill} ${C}`}
              className={s === "loading" || s === "retrying" ? "ekSegBusy" : undefined}
              style={{ transition: "stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1), stroke 300ms ease" }} />
          </g>
        );
      })}
      <g className="ekSpin">
        <circle r="96" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${(pct < 100 ? 0.12 : 0) * 2 * Math.PI * 96} ${2 * Math.PI * 96}`} />
      </g>
    </svg>
  );
}

function NodeCard({ meta, node, label, L, index, pos, hub, onActivate }) {
  const { status, count = 0, ms, attempt } = node;
  const shown = useCountUp(status === "done" ? count : 0, 1100);
  const Icon = meta.icon;
  const isBusy = busy(status);
  let sub;
  if (status === "done") sub = count === 0 ? L.none : `${ms} ms`;
  else if (status === "retrying") sub = `${L.retrying} ${attempt ?? 2}`;
  else if (status === "error") sub = L.failed;
  else if (status === "idle") sub = L.waiting;
  else sub = L.loading;

  return (
    <div className="ekCardWrap"
      style={{ left: pos.x, top: pos.y, "--gx": `${hub.x - pos.x}px`, "--gy": `${hub.y - pos.y}px`, "--i": index }}>
      <button type="button" className={`ekCard is-${status}`} onClick={onActivate}>
        <span className="ekCardTop">
          <span className="ekIco"><Icon size={16} strokeWidth={2.2} /></span>
          <span className="ekLabel">{label}</span>
          <span className="ekBadge" aria-hidden="true">
            {status === "done" ? <Check size={11} strokeWidth={3.2} />
              : status === "retrying" || status === "error" ? <AlertTriangle size={11} strokeWidth={2.6} />
              : <span className="ekDots"><i /><i /><i /></span>}
          </span>
        </span>
        <span className="ekCount">
          {isBusy ? <span className="ekSkel" /> : Math.round(shown).toLocaleString()}
        </span>
        <span className="ekSub">{sub}</span>
        <span className="ekEndpoint">{meta.endpoint}</span>
      </button>
    </div>
  );
}

/* ── Estilos ─────────────────────────────────────────────────────────── */

const EK_CSS = `
.ekRoot { position: fixed; inset: 0; z-index: 9999; overflow: hidden; color: #fff; user-select: none; cursor: default;
  --px: 0; --py: 0; --energy: 0;
  background: radial-gradient(120% 90% at 50% 38%, #3456d1 0%, #1a2f8a 46%, #0c1a5a 100%);
  clip-path: circle(150vmax at var(--hx) var(--hy));
  transition: clip-path ${EXIT_MS}ms cubic-bezier(0.7,0,0.84,0);
  animation: ekIn 520ms cubic-bezier(0.22,1,0.36,1) both; font-family: inherit; }
.ekRoot.ek-exit { clip-path: circle(0px at var(--hx) var(--hy)); }
.ekRoot.ek-handoff { animation: none; }
.ek-handoff .ekCore { animation: none; }
.ekGlow { position: absolute; left: var(--hx); top: var(--hy); width: 900px; height: 900px; margin: -450px 0 0 -450px; border-radius: 50%;
  background: radial-gradient(circle, rgba(140,175,255,0.35) 0%, rgba(140,175,255,0.08) 38%, transparent 64%);
  opacity: calc(0.55 + var(--energy) * 0.45); transform: scale(calc(0.92 + var(--energy) * 0.16)); pointer-events: none; }
.ekCanvas { position: absolute; inset: 0; display: block; }

.ekHub { position: absolute; width: 0; height: 0; z-index: 3;
  transform: translate(calc(var(--px) * -8px), calc(var(--py) * -8px)); }
.ekRing { position: absolute; left: -140px; top: -140px; overflow: visible; animation: ekPop 700ms cubic-bezier(0.34,1.56,0.64,1) both; }
.ekSpin { animation: ekRot 1.4s linear infinite; transform-origin: 0 0; }
.ekSpinSlow { animation: ekRot 40s linear infinite; transform-origin: 0 0; }
.ekSegBusy { animation: ekBreath 1.2s ease-in-out infinite; }
.ek-gather .ekSpin, .ek-exit .ekSpin { opacity: 0; transition: opacity 200ms; }
.ekCore { position: absolute; left: -80px; top: -80px; width: 160px; height: 160px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #fff;
  background: radial-gradient(circle at 35% 28%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 62%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35), 0 24px 60px -18px rgba(5,12,50,0.8), 0 0 calc(30px + var(--energy) * 60px) rgba(168,197,255, calc(0.25 + var(--energy) * 0.5));
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  transition: transform 380ms cubic-bezier(0.34,1.56,0.64,1);
  transform: perspective(600px) rotateX(calc(var(--py) * -14deg)) rotateY(calc(var(--px) * 14deg)) scale(calc(1 + var(--energy) * 0.05));
  animation: ekPop 640ms cubic-bezier(0.34,1.56,0.64,1) 80ms backwards; }
.ekCore:hover { transform: perspective(600px) rotateX(calc(var(--py) * -14deg)) rotateY(calc(var(--px) * 14deg)) scale(1.07); }
.ekCore:active { transform: scale(0.96); }
.ekCore:focus-visible { outline: 2px solid #fff; outline-offset: 6px; }
.ekLogo { width: 64px; height: 64px; object-fit: contain; filter: drop-shadow(0 8px 18px rgba(5,12,50,0.45)); pointer-events: none; }
.ekPct { font-size: 15px; font-weight: 900; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1; }
.ekPct small { font-size: 10px; opacity: 0.6; margin-left: 1px; }
.ek-gather .ekCore { animation: ekFlash 560ms ease both; }

.ekCardWrap { position: absolute; width: 0; height: 0; z-index: 2;
  transform: translate(calc(var(--px) * 16px), calc(var(--py) * 16px)); }
.ekCard { position: absolute; left: -104px; top: -62px; width: 208px; padding: 14px 16px 13px; text-align: left; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px; border-radius: 20px; color: #fff; font: inherit;
  background: linear-gradient(160deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06));
  border: 1px solid rgba(255,255,255,0.2);
  box-shadow: 0 22px 50px -24px rgba(3,10,45,0.85);
  backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
  transition: transform 420ms cubic-bezier(0.34,1.56,0.64,1), border-color 300ms, background 300ms, box-shadow 300ms;
  animation: ekCardIn 760ms cubic-bezier(0.22,1,0.36,1) calc(140ms + var(--i) * 70ms) backwards; }
.ekCard:hover { transform: translateY(-6px) scale(1.04); border-color: rgba(255,255,255,0.45);
  box-shadow: 0 30px 60px -22px rgba(3,10,45,0.9), 0 0 0 4px rgba(255,255,255,0.06); }
.ekCard:active { transform: translateY(-2px) scale(0.98); }
.ekCard:focus-visible { outline: 2px solid #fff; outline-offset: 4px; }
.ekCard.is-done { border-color: rgba(255,255,255,0.32); animation: ekCardIn 760ms cubic-bezier(0.22,1,0.36,1) calc(140ms + var(--i) * 70ms) backwards, ekDone 900ms ease-out; }
.ekCard.is-retrying, .ekCard.is-error { border-color: rgba(251,191,36,0.55); }
.ekCardTop { display: flex; align-items: center; gap: 9px; }
.ekIco { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: rgba(255,255,255,0.14); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); }
.ekLabel { flex: 1; font-size: 13px; font-weight: 800; letter-spacing: -0.01em; }
.ekBadge { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,0.1); }
.is-done .ekBadge { background: #34d399; color: #053b2a; animation: ekPopSmall 520ms cubic-bezier(0.34,1.56,0.64,1) both; }
.is-retrying .ekBadge, .is-error .ekBadge { background: #fbbf24; color: #4a2d00; }
.ekDots { display: flex; gap: 2px; }
.ekDots i { width: 3px; height: 3px; border-radius: 50%; background: #fff; animation: ekDot 900ms ease-in-out infinite; }
.ekDots i:nth-child(2) { animation-delay: 150ms; } .ekDots i:nth-child(3) { animation-delay: 300ms; }
.ekCount { height: 40px; display: flex; align-items: center; font-size: 34px; font-weight: 900; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; line-height: 1; margin-top: 6px; }
.ekSkel { width: 74px; height: 22px; border-radius: 8px; background: linear-gradient(90deg, rgba(255,255,255,0.1) 20%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0.1) 80%); background-size: 220% 100%; animation: ekShimmer 1.3s linear infinite; }
.ekSub { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.62); font-variant-numeric: tabular-nums; }
.is-retrying .ekSub, .is-error .ekSub { color: #fde68a; }
.ekEndpoint { max-height: 0; overflow: hidden; opacity: 0; font-size: 10.5px; font-weight: 700; color: rgba(255,255,255,0.5);
  transition: max-height 300ms ease, opacity 300ms ease, margin 300ms ease; }
.ekCard:hover .ekEndpoint { max-height: 16px; opacity: 1; margin-top: 2px; }
.ek-gather .ekCard, .ek-exit .ekCard { transform: translate(var(--gx), var(--gy)) scale(0.2); opacity: 0;
  transition: transform ${GATHER_MS}ms cubic-bezier(0.55,0,0.8,0.2), opacity ${GATHER_MS}ms ease-in; animation: none; }

.ekStatus { position: absolute; z-index: 2; transform: translateX(-50%); width: min(520px, 90vw); text-align: center; animation: ekRise 700ms cubic-bezier(0.22,1,0.36,1) 260ms backwards; transition: opacity 300ms ease; }
.ek-gather .ekStatus, .ek-exit .ekStatus { opacity: 0; }
.ekTitle { margin: 0; font-size: clamp(24px, 2.4vw, 32px); font-weight: 900; letter-spacing: -0.035em; line-height: 1.05; text-shadow: 0 10px 40px rgba(5,12,50,0.55); }
.ekStep { margin: 8px 0 0; min-height: 18px; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.72); animation: ekStepIn 380ms cubic-bezier(0.22,1,0.36,1) both; }
.ekSide { margin-top: 16px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.ekChip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px 5px 5px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14); transition: all 300ms ease; }
.ekChip b { font-weight: 900; color: #fff; font-variant-numeric: tabular-nums; }
.ekChip.isDone { color: #fff; background: rgba(255,255,255,0.14); }
.ekChipIco { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,0.14); }
.ekChip:not(.isDone) .ekChipIco { animation: ekBreath 1.1s ease-in-out infinite; }
.ekChip.isDone .ekChipIco { background: #34d399; color: #053b2a; animation: ekPopSmall 480ms cubic-bezier(0.34,1.56,0.64,1) both; }
.ekHint { position: absolute; left: 0; right: 0; bottom: 26px; margin: 0; text-align: center; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.45);
  animation: ekHintIn 900ms ease 1.6s backwards; pointer-events: none; }
.ek-gather .ekHint, .ek-exit .ekHint { opacity: 0; transition: opacity 200ms; }

@keyframes ekIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes ekPop { from { opacity: 0; transform: scale(0.55); } to { opacity: 1; transform: none; } }
@keyframes ekPopSmall { from { transform: scale(0.3); } to { transform: scale(1); } }
@keyframes ekRot { to { transform: rotate(360deg); } }
@keyframes ekBreath { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes ekCardIn { from { opacity: 0; transform: translate(var(--gx), var(--gy)) scale(0.3); } to { opacity: 1; transform: none; } }
@keyframes ekDone { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.55), 0 22px 50px -24px rgba(3,10,45,0.85); } 100% { box-shadow: 0 0 0 18px rgba(255,255,255,0), 0 22px 50px -24px rgba(3,10,45,0.85); } }
@keyframes ekDot { 0%,100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
@keyframes ekShimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes ekRise { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes ekStepIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@keyframes ekFlash { 0% { transform: scale(1); } 45% { transform: scale(1.14); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.6), 0 0 120px rgba(200,220,255,0.9); } 100% { transform: scale(0.9); } }
@keyframes ekHintIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .ekRoot, .ekRing, .ekCore, .ekCard, .ekStatus, .ekStep, .ekHint, .ekSpin, .ekSpinSlow, .ekSegBusy, .ekDots i, .ekSkel, .ekChipIco { animation: none !important; }
  .ekRoot { transition: none; }
}
`;