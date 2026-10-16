/* ══════════════════════════════════════════════════════════════════════
   Fetch del cliente de Supabase (conectado en lib/supabaseClient.js).

   1. Marca cada petición con la empresa del usuario: añade "nr-co/<id>" a
      la cabecera x-client-info. Supabase guarda esa cabecera en los logs de
      su API Gateway, y la Edge Function usage-sync suma por empresa las
      peticiones y los bytes REALES que Supabase sirvió.
   2. Además lleva su propio contador (respaldo mientras usage-sync no esté
      desplegada o si los logs no están disponibles).
   ══════════════════════════════════════════════════════════════════════ */

const counters = { bytes: 0, requests: 0 };
let companyTag = null;

// Las propias escrituras del tracker no cuentan en el contador de respaldo
const IGNORE = /\/rest\/v1\/usage_events/;

// La pone el tracker al empezar la sesión (y la quita al salir)
export function setUsageCompany(companyId) {
  companyTag = companyId ? String(companyId).replace(/[^A-Za-z0-9-]/g, "") : null;
}

export function takeTraffic() {
  const out = { bytes: counters.bytes, requests: counters.requests };
  counters.bytes = 0;
  counters.requests = 0;
  return out;
}

function withTag(input, init) {
  if (!companyTag) return [input, init];
  try {
    const base = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    const headers = new Headers(base);
    const current = headers.get("x-client-info") ?? "";
    if (!current.includes("nr-co/")) headers.set("x-client-info", `${current} nr-co/${companyTag}`.trim());
    return [input, { ...(init ?? {}), headers }];
  } catch {
    return [input, init];
  }
}

export async function trackedFetch(input, init) {
  const [i2, init2] = withTag(input, init);
  const res = await fetch(i2, init2);
  try {
    const url = typeof input === "string" ? input : input?.url ?? String(input ?? "");
    if (IGNORE.test(url)) return res;
    counters.requests += 1;
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > 0) {
      counters.bytes += len;
    } else if (res.body) {
      res.clone().arrayBuffer().then(b => { counters.bytes += b.byteLength; }).catch(() => {});
    }
  } catch { /* medir nunca debe romper una petición */ }
  return res;
}