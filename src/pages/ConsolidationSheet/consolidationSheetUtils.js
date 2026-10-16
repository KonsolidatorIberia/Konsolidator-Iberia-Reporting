/* ══════════════════════════════════════════════════════════════════════
   Sábana de consolidación — utilidades sin React: API, meses, formato,
   orden PGC y árbol de cuentas.
   ══════════════════════════════════════════════════════════════════════ */


export const BASE = "https://api.konsolidator.com/v2";

const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },
];

export const fmt = (n) => {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "—";
  const s = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return v < 0 ? `(${s})` : s;
};

export const TYPE_ORDER = { "P/L": 0, "DIS": 0, "B/S": 1, "C/F": 2, "CFS": 2 };

const TYPE_LABELS_BASE = {
  "P/L": { label: "Profit & Loss" },
  "DIS": { label: "Distribution of Result" },
  "B/S": { label: "Balance Sheet" },
  "C/F": { label: "Cash Flow" },
  "CFS": { label: "Cash Flow" },
};

// ── pgcSort & buildTree ───────────────────────────────────────────────────────
function pgcSort(a, b) {
  const cA = a.AccountCode || "", cB = b.AccountCode || "";
  const aA = /^[A-Za-z]/.test(cA), bA = /^[A-Za-z]/.test(cB);
  if (aA && !bA) return -1; if (!aA && bA) return 1;
  const strip = c => c.replace(/\.S$/i, ""), isSum = c => /\.S$/i.test(c);
  const bsA = strip(cA), bsB = strip(cB);
  if (bsA === bsB) { if (isSum(cA) && !isSum(cB)) return 1; if (!isSum(cA) && isSum(cB)) return -1; return 0; }
  const pA = bsA.split("."), pB = bsB.split(".");
  for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
    const a = pA[i] ?? "", b = pB[i] ?? "";
    if (a === b) continue;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "es", { sensitivity: "base" });
  }
  return 0;
}

export function buildTree(accounts) {
  const sorted = [...accounts].sort(pgcSort);
  const map = new Map();
  sorted.forEach(a => map.set(a.AccountCode, { ...a, children: [] }));
  const roots = [];
  sorted.forEach(a => {
    const parent = a.SumAccountCode ? map.get(a.SumAccountCode) : null;
    if (parent && !/\.S$/i.test(parent.AccountCode)) {
      parent.children.push(map.get(a.AccountCode));
    } else {
      const isNum = /^\d/.test(a.AccountCode);
      const missing = a.SumAccountCode && !map.has(a.SumAccountCode);
      if (!(isNum && missing)) roots.push(map.get(a.AccountCode));
    }
  });
  return roots;
}

// ── Peticiones a la API ───────────────────────────────────────────────────────
// Cada petición acaba siempre: o devuelve el JSON o lanza un error. Reintenta
// sola cuando la API está saturada (429), falla temporalmente (5xx), se corta
// la red o deja de responder (sin datos durante `idleMs`). Se puede cancelar
// con `signal` y avisa de los bytes recibidos (`onBytes`) y de cada reintento
// (`onRetry`). Antes, un 429 al abrir la página por primera vez (justo después
// de la ráfaga de peticiones de la Home) rompía la carga en silencio y el
// cargador se quedaba para siempre en el 95 %.
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}
export const isAbort = (e) => e?.name === "AbortError";

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(abortError()); return; }
  const onAbort = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

async function fetchOnce(url, token, signal, idleMs, onBytes) {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  signal?.addEventListener("abort", relay, { once: true });
  let idle = 0;
  let timedOut = false;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { timedOut = true; ctrl.abort(); }, idleMs);
  };
  try {
    arm();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`);
      e.status = r.status;
      e.retryable = RETRY_STATUS.has(r.status);
      const ra = Number(r.headers.get("Retry-After"));
      if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra * 1000;
      throw e;
    }
    let text;
    if (onBytes && r.body && typeof r.body.getReader === "function") {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      const parts = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        received += value.byteLength;
        parts.push(dec.decode(value, { stream: true }));
        onBytes(received);
      }
      parts.push(dec.decode());
      text = parts.join("");
    } else {
      text = await r.text();
    }
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (timedOut) {
      const t = new Error("timeout");
      t.retryable = true;
      throw t;
    }
    if (e?.status) throw e;
    // Red caída, CORS de un 429 sin cabeceras o cuerpo cortado: se reintenta
    const n = new Error(e?.message || "network");
    n.retryable = true;
    throw n;
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener("abort", relay);
  }
}

export async function apiJson(url, token, { signal, retries = 4, idleMs = 45000, onBytes, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError();
    let failure;
    try {
      return await fetchOnce(url, token, signal, idleMs, onBytes);
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw abortError();
      if (!e.retryable || attempt >= retries) throw e;
      failure = e;
    }
    onRetry?.({ attempt: attempt + 1, error: failure });
    await wait(failure.retryAfter ? Math.min(failure.retryAfter, 15000) : 700 * 2 ** attempt, signal);
  }
}

// Lista de filas (OData `value` o array directo)
export async function apiRows(url, token, opts) {
  const d = await apiJson(url, token, opts);
  if (Array.isArray(d?.value)) return d.value;
  return Array.isArray(d) ? d : [];
}

// ── Periodo inicial ───────────────────────────────────────────────────────────
// Elige el periodo a abrir a partir de la lista de consolidaciones (que ya se
// descarga con los metadatos), sin sondear la API mes a mes:
//   1. la última consolidación de ese escenario y estructura hasta `before`
//      (normalmente el último periodo cerrado);
//   2. si no hay, la última de ese escenario y estructura;
//   3. si no, la última de ese escenario; 4. si no, la última que haya.
// Devuelve null si la lista viene vacía (entonces se sondea la API).
const ym = (y, m) => Number(y) * 100 + Number(m);

export function pickPeriodFromRuns(runs, { source = "Actual", structure, before } = {}) {
  const list = (Array.isArray(runs) ? runs : [])
    .map(c => ({
      y: Number(c.Year ?? c.year),
      m: Number(c.Month ?? c.month),
      source: c.Source ?? c.source ?? "",
      structure: c.GroupStructure ?? c.groupStructure ?? "",
    }))
    .filter(r => r.y && r.m && r.source && r.structure);
  if (!list.length) return null;
  const latest = (arr) => arr.reduce((best, r) => (!best || ym(r.y, r.m) > ym(best.y, best.m) ? r : best), null);
  const same = list.filter(r => r.source === source && r.structure === structure);
  const limit = before ?? Infinity;
  return latest(same.filter(r => ym(r.y, r.m) <= limit))
    ?? latest(same)
    ?? latest(list.filter(r => r.source === source))
    ?? latest(list);
}

export const periodKey = ym;

// Tamaño legible de una descarga ("3,4 MB")
export function fmtBytes(n, locale = "es") {
  if (!n) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
}

// Hash corto y estable de un texto (para claves de carga)
export function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}