/* ══════════════════════════════════════════════════════════════════════
   Tracker de uso de la app (alimenta Actividad en el centro de control).

   Guarda en accounts.usage_events:
     · una fila "session" por cada entrada a la app
     · una fila "page" por cada página visitada
     · filas "event" sueltas (login, export…) con trackEvent()
   Cada minuto actualiza el tiempo activo (solo cuenta con la pestaña
   visible y sin más de 5 minutos de inactividad). El tráfico real lo mide
   Supabase en su API Gateway (ver usageFetch.js y la función usage-sync);
   aquí solo se guarda un contador de respaldo.

   No usa nada de la página: la empresa la pone la base de datos según el
   usuario. Si algo falla, falla en silencio; nunca molesta al usuario.
   ══════════════════════════════════════════════════════════════════════ */
import { supabase } from "./supabaseClient";
import { takeTraffic, setUsageCompany } from "./usageFetch.js";

const TICK_MS = 60_000;
const IDLE_MS = 5 * 60_000;
const LOGIN_WINDOW_MS = 3 * 60_000;

const st = {
  running: false,
  starting: null,
  session: null,      // { id, seconds, bytes, requests }
  page: null,         // { id, key, seconds, bytes, requests }
  wantedPage: null,
  lastTick: 0,
  lastInput: 0,
  timer: null,
  unsubs: [],
};

const table = () => supabase.schema("accounts").from("usage_events");

async function insertRow(row) {
  const { data, error } = await table().insert(row).select("id, company_id").single();
  if (error) throw error;
  // La base de datos sabe la empresa del usuario: con ella se marcan las
  // peticiones para que Supabase mida el tráfico de cada cliente
  if (data.company_id) setUsageCompany(data.company_id);
  return data.id;
}

async function saveRow(r) {
  if (!r?.id) return;
  await table().update({ seconds: Math.round(r.seconds), egress_bytes: Math.round(r.bytes), requests: r.requests }).eq("id", r.id);
}

// Suma el tiempo activo desde la última vez y el tráfico pendiente
function accrue() {
  const now = Date.now();
  const dt = (now - st.lastTick) / 1000;
  st.lastTick = now;
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  const awake = now - st.lastInput < IDLE_MS;
  const active = visible && awake ? Math.max(0, Math.min(dt, TICK_MS / 1000 + 5)) : 0;
  const traffic = takeTraffic();
  for (const r of [st.session, st.page]) {
    if (!r) continue;
    r.seconds += active;
    r.bytes += traffic.bytes;
    r.requests += traffic.requests;
  }
  // Las páginas no llevan tráfico propio en el resumen: se cuenta en la sesión
}

async function flush() {
  if (!st.running) return;
  accrue();
  try { await Promise.all([saveRow(st.session), saveRow(st.page)]); } catch { /* sin conexión: se reintenta en el siguiente minuto */ }
}

const markInput = () => { st.lastInput = Date.now(); };

async function openPage(key) {
  if (!st.running || !key || st.page?.key === key) return;
  accrue();
  const prev = st.page;
  st.page = { id: null, key, seconds: 0, bytes: 0, requests: 0 };
  const current = st.page;
  try {
    if (prev) await saveRow(prev);
    current.id = await insertRow({ kind: "page", page: key });
  } catch { /* se ignora */ }
}

export async function startUsageTracking() {
  if (st.running || st.starting) return st.starting;
  st.starting = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      st.running = true;
      st.lastTick = Date.now();
      st.lastInput = Date.now();
      takeTraffic();   // lo anterior al inicio no cuenta para esta sesión
      st.session = { id: null, seconds: 0, bytes: 0, requests: 0 };
      st.session.id = await insertRow({
        kind: "session",
        meta: { ua: navigator.userAgent.slice(0, 180), lang: navigator.language, w: window.innerWidth },
      });
      // Si el inicio de sesión es de hace un momento, cuenta como login
      const signedIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
      if (Date.now() - signedIn < LOGIN_WINDOW_MS) {
        insertRow({ kind: "event", name: "login" }).catch(() => {});
      }
      const evs = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"];
      let lastMove = 0;
      const onInput = (e) => {
        if (e.type === "mousemove") { const n = Date.now(); if (n - lastMove < 5000) return; lastMove = n; }
        markInput();
      };
      evs.forEach(ev => window.addEventListener(ev, onInput, { passive: true }));
      const onVis = () => {
        if (document.visibilityState === "hidden") flush();
        else { st.lastTick = Date.now(); markInput(); }
      };
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", flush);
      st.unsubs = [
        () => evs.forEach(ev => window.removeEventListener(ev, onInput)),
        () => document.removeEventListener("visibilitychange", onVis),
        () => window.removeEventListener("pagehide", flush),
      ];
      st.timer = setInterval(flush, TICK_MS);
      if (st.wantedPage) await openPage(st.wantedPage);
    } catch {
      st.running = false;
    } finally {
      st.starting = null;
    }
  })();
  return st.starting;
}

export async function stopUsageTracking() {
  if (!st.running) return;
  await flush();
  clearInterval(st.timer);
  st.unsubs.forEach(fn => fn());
  Object.assign(st, { running: false, session: null, page: null, timer: null, unsubs: [] });
  setUsageCompany(null);
}

// Página actual de la app (la clave de página, p. ej. "consolidation-sheet")
export function trackPage(key) {
  st.wantedPage = key;
  if (st.running) openPage(key);
}

// Acción suelta: trackEvent("export", { format: "xlsx", page: "cash-flow" })
export function trackEvent(name, meta) {
  if (!st.running) return;
  insertRow({ kind: "event", name, page: st.page?.key ?? null, meta: meta ?? null }).catch(() => {});
}