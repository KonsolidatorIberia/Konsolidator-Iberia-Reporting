/* ══════════════════════════════════════════════════════════════════════
   Centro de control — modelo de coste por cliente.

   Factura mensual de Supabase = parte fija (plan + compute − crédito +
   otros) + excesos sobre lo incluido (BD, storage, tráfico, MAU).
   Si se indica el importe real de la factura, se usa ese y todo se escala.

   Reparto entre clientes:
     · la parte fija, según los pesos de cada recurso (BD, storage,
       tráfico, tiempo de uso) y la cuota de cada cliente en ese recurso;
     · cada exceso, solo según la cuota del cliente en ESE recurso.
   La suma de lo repartido es exactamente la factura.
   Precios por defecto: plan Pro de supabase.com/pricing (octubre 2026).
   ══════════════════════════════════════════════════════════════════════ */

export const DEFAULT_COSTS = {
  currency: "USD",
  fx: 1,                 // 1 USD = fx en la moneda elegida
  plan_fee: 25,
  compute_fee: 10,       // Micro
  compute_credit: 10,
  extra_fixed: 0,        // PITR, dominio propio, IPv4, otros proyectos…
  actual_bill: null,     // importe real de la última factura (USD); vacío = estimado
  included: { db_gb: 8, storage_gb: 100, egress_gb: 250, mau: 100000 },
  unit: { db_gb: 0.125, storage_gb: 0.0213, egress_gb: 0.09, mau: 0.00325 },
  weights: { db: 35, storage: 15, egress: 30, activity: 20 },
  revenue: { low: null, base: null, pro: null, max: null },   // cuota mensual por nivel (moneda elegida)
};

// Ajustes efectivos = valores por defecto ← precios leídos de Supabase
// (settings.auto, los escribe usage-sync) ← cambios manuales (settings.overrides).
// Un campo manual vacío vuelve al valor automático.
const PRICE_KEYS = ["plan_fee", "compute_fee", "compute_credit", "extra_fixed"];
const has = (v) => v !== null && v !== undefined && v !== "";

export function mergeCosts(saved) {
  const s = saved ?? {};
  const auto = s.auto ?? null;
  const ov = s.overrides ?? {};
  const out = { ...DEFAULT_COSTS };
  for (const k of PRICE_KEYS) {
    out[k] = has(ov[k]) ? Number(ov[k]) : has(auto?.[k]) ? Number(auto[k]) : DEFAULT_COSTS[k];
  }
  const merge3 = (group) => {
    const r = { ...DEFAULT_COSTS[group] };
    for (const k of Object.keys(r)) {
      if (has(ov[group]?.[k])) r[k] = Number(ov[group][k]);
      else if (has(auto?.[group]?.[k])) r[k] = Number(auto[group][k]);
    }
    return r;
  };
  out.included = merge3("included");
  out.unit = merge3("unit");
  out.currency = s.currency ?? "USD";
  out.fx = out.currency === "USD" ? 1
    : has(ov.fx) ? Number(ov.fx)
    : has(auto?.fx?.[out.currency]) ? Number(auto.fx[out.currency])
    : 1;
  out.fxAuto = out.currency !== "USD" && !has(ov.fx) && has(auto?.fx?.[out.currency]);
  out.actual_bill = has(s.actual_bill) ? Number(s.actual_bill) : null;
  out.weights = { ...DEFAULT_COSTS.weights, ...(s.weights ?? {}) };
  out.revenue = { ...DEFAULT_COSTS.revenue, ...(s.revenue ?? {}) };
  out.auto = auto;
  out.overrides = ov;
  // ¿Algún precio viene a mano en vez de leído de Supabase?
  out.manual = PRICE_KEYS.some(k => has(ov[k]))
    || ["included", "unit"].some(g => Object.values(ov[g] ?? {}).some(has));
  return out;
}

export const GIB = 1024 ** 3;
export const MONTH_DAYS = 30.437;
export const RESOURCES = ["db", "storage", "egress", "activity"];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const isNone = (cid) => cid === "__none__";

// Días entre dos fechas ISO (incluidas)
export const spanDays = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;

/**
 * @param companies  filas de companies_with_user_count
 * @param rows       filas de usage_daily (desde antes de "from" para tener foto de tamaños)
 * @param platformRows filas de usage_platform_daily (tamaños + tráfico medido por Supabase)
 * @param activeUsers {cid: usuarios activos distintos en el periodo}
 */
export function computeCosts({ companies, rows, platformRows = [], activeUsers, settings, from, to }) {
  const cfg = mergeCosts(settings);
  const days = Math.max(1, spanDays(from, to));
  const months = days / MONTH_DAYS;

  // ── Por empresa ──
  const per = new Map();
  const ensure = (cid) => {
    if (!per.has(cid)) per.set(cid, {
      id: cid, logins: 0, sessions: 0, page_views: 0, active_seconds: 0, egress_bytes: 0, requests: 0, events: 0,
      db_bytes: 0, db_rows: 0, db_tables: {}, storage_bytes: 0, storage_objects: 0, snapDay: null,
      daily: new Map(), lastActive: null, active_users: num(activeUsers?.[cid]),
      gwDays: 0, estDays: 0, byKind: {},
    });
    return per.get(cid);
  };
  companies.forEach(c => ensure(String(c.id)));
  ensure("__none__");
  for (const r of rows) {
    const day = String(r.day).slice(0, 10);
    const p = ensure(String(r.company_id));
    if (r.db_bytes != null && day <= to && (!p.snapDay || day > p.snapDay)) {
      p.snapDay = day;
      p.db_bytes = num(r.db_bytes); p.db_rows = num(r.db_rows); p.db_tables = r.db_tables ?? {};
      p.storage_bytes = num(r.storage_bytes); p.storage_objects = num(r.storage_objects);
    }
    if (day < from || day > to) continue;
    p.logins += num(r.logins); p.sessions += num(r.sessions); p.page_views += num(r.page_views);
    p.active_seconds += num(r.active_seconds); p.events += num(r.events);
    // Tráfico: el medido por Supabase (API Gateway) manda; si ese día aún no
    // está sincronizado se usa el contador de la app
    if (r.gw_egress_bytes != null) {
      p.egress_bytes += num(r.gw_egress_bytes); p.requests += num(r.gw_requests); p.gwDays += 1;
      for (const [k, v] of Object.entries(r.gw_by_kind ?? {})) {
        const cur = p.byKind[k] ?? (p.byKind[k] = { requests: 0, bytes: 0 });
        cur.requests += num(v?.requests); cur.bytes += num(v?.bytes);
      }
    } else {
      p.egress_bytes += num(r.egress_bytes); p.requests += num(r.requests);
      if (num(r.egress_bytes) > 0) p.estDays += 1;
    }
    p.daily.set(day, r);
    if (num(r.active_users) > 0 && (!p.lastActive || day > p.lastActive)) p.lastActive = day;
  }

  const clients = companies.map(c => per.get(String(c.id)));
  const totals = {
    db: clients.reduce((a, p) => a + p.db_bytes, 0),
    storage: clients.reduce((a, p) => a + p.storage_bytes, 0),
    egress: clients.reduce((a, p) => a + p.egress_bytes, 0),
    activity: clients.reduce((a, p) => a + p.active_seconds, 0),
    mau: clients.reduce((a, p) => a + p.active_users, 0),
  };

  // ── Factura del mes ──
  const all = [...per.values()];
  const dayOf = (r) => String(r.day).slice(0, 10);
  const platform = [...platformRows].filter(r => r.db_bytes != null && dayOf(r) <= to)
    .sort((x, y) => (dayOf(x) < dayOf(y) ? 1 : -1))[0] ?? null;
  const gwRows = platformRows.filter(r => r.gw_egress_bytes != null && dayOf(r) >= from && dayOf(r) <= to);
  const gwEgress = gwRows.reduce((acc, r) => acc + num(r.gw_egress_bytes), 0);
  const gwRequests = gwRows.reduce((acc, r) => acc + num(r.gw_requests), 0);
  const estEgress = all.reduce((a, p) => a + p.egress_bytes, 0);
  const plat = {
    db_bytes: num(platform?.db_bytes) || all.reduce((a, p) => a + p.db_bytes, 0),
    storage_bytes: num(platform?.storage_bytes) || all.reduce((a, p) => a + p.storage_bytes, 0),
    // Total del proyecto: lo medido por Supabase (incluye lo que no es de ningún cliente)
    egress_month_bytes: (gwRows.length ? gwEgress : estEgress) / months,
    egress_period_bytes: gwRows.length ? gwEgress : estEgress,
    requests_period: gwRows.length ? gwRequests : all.reduce((a, p) => a + p.requests, 0),
    mau: num(platform?.mau) || all.reduce((a, p) => a + p.active_users, 0),
    auth_users: num(platform?.auth_users),
    day: platform?.day ? dayOf(platform) : null,
    gwDays: gwRows.length,
    gwSyncedAt: gwRows.map(r => r.gw_synced_at).filter(Boolean).sort().pop() ?? null,
  };
  // measured: todo el tráfico del periodo viene de Supabase · mixed: algunos
  // días solo tienen el contador de la app · estimated: aún sin sincronizar
  const estDaysAll = clients.reduce((a, p) => a + p.estDays, 0);
  const trafficSource = plat.gwDays === 0 ? (estEgress > 0 ? "estimated" : "missing") : estDaysAll > 0 ? "mixed" : "measured";
  const over = (qty, incl, unit) => Math.max(0, qty - num(incl)) * num(unit);
  const overages = {
    db: over(plat.db_bytes / GIB, cfg.included.db_gb, cfg.unit.db_gb),
    storage: over(plat.storage_bytes / GIB, cfg.included.storage_gb, cfg.unit.storage_gb),
    egress: over(plat.egress_month_bytes / GIB, cfg.included.egress_gb, cfg.unit.egress_gb),
    mau: over(plat.mau, cfg.included.mau, cfg.unit.mau),
  };
  const fixed = num(cfg.plan_fee) + Math.max(0, num(cfg.compute_fee) - num(cfg.compute_credit)) + num(cfg.extra_fixed);
  const estimated = fixed + overages.db + overages.storage + overages.egress + overages.mau;
  const actual = num(cfg.actual_bill);
  const scale = actual > 0 && estimated > 0 ? actual / estimated : 1;
  const total = actual > 0 ? actual : estimated;

  // ── Reparto ──
  const usable = RESOURCES.filter(r => totals[r] > 0 && num(cfg.weights[r]) > 0);
  const wSum = usable.reduce((a, r) => a + num(cfg.weights[r]), 0);
  const fx = num(cfg.fx) || 1;
  const n = clients.length || 1;

  const list = companies.map(c => {
    const p = per.get(String(c.id));
    const share = {
      db: totals.db ? p.db_bytes / totals.db : 0,
      storage: totals.storage ? p.storage_bytes / totals.storage : 0,
      egress: totals.egress ? p.egress_bytes / totals.egress : 0,
      activity: totals.activity ? p.active_seconds / totals.activity : 0,
      mau: totals.mau ? p.active_users / totals.mau : 0,
    };
    const fixedShare = wSum > 0 ? usable.reduce((a, r) => a + (num(cfg.weights[r]) / wSum) * share[r], 0) : 1 / n;
    const breakdown = {
      fixed: fixed * fixedShare * scale,
      db: overages.db * share.db * scale,
      storage: overages.storage * share.storage * scale,
      egress: overages.egress * share.egress * scale,
      mau: overages.mau * share.mau * scale,
    };
    const monthUsd = Object.values(breakdown).reduce((a, v) => a + v, 0);
    const month = monthUsd * fx;
    const revenue = cfg.revenue?.[c.tier];
    const hasRevenue = revenue != null && revenue !== "" && Number.isFinite(Number(revenue));
    return {
      company: c,
      ...p,
      total_users: num(c.total_user_count),
      share,
      billShare: total > 0 ? monthUsd / total : 0,
      breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, v * fx])),
      cost_month: month,
      cost_period: month * months,
      cost_per_user: p.active_users > 0 ? month / p.active_users : null,
      revenue: hasRevenue ? Number(revenue) : null,
      margin: hasRevenue ? Number(revenue) - month : null,
    };
  });

  return {
    cfg, days, months, fx,
    platform: plat,
    totals,
    bill: {
      fixed: fixed * scale * fx,
      overages: Object.fromEntries(Object.entries(overages).map(([k, v]) => [k, v * scale * fx])),
      total: total * fx,
      estimated: estimated * fx,
      usingActual: actual > 0,
    },
    clients: list,
    unattributed: per.get("__none__"),
    weightsUsed: usable,
    sources: {
      traffic: trafficSource,
      sizes: plat.day ? "measured" : "missing",
      activity: all.some(p => p.active_seconds > 0) ? "measured" : "missing",
    },
  };
}

// Serie diaria (rellena con ceros los días sin datos)
export function dailySeries(daily, from, to, pick) {
  const out = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    const r = daily instanceof Map ? daily.get(key) : daily?.[key];
    out.push({ day: key, value: r ? pick(r) : 0 });
  }
  return out;
}

// ── Formatos ──
export function fmtBytes(n, locale = "en") {
  const v = num(n);
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024, i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
  return `${x.toLocaleString(locale, { maximumFractionDigits: x < 10 ? 1 : 0 })} ${units[i]}`;
}
export function fmtDuration(seconds, locale = "en") {
  const s = Math.round(num(seconds));
  if (s < 60) return s ? "<1 min" : "0 min";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (!h) return `${m} min`;
  return `${h.toLocaleString(locale)} h${m ? ` ${m} min` : ""}`;
}
export function fmtMoney(v, currency = "USD", locale = "en", digits) {
  const x = num(v);
  const d = digits ?? (Math.abs(x) < 10 ? 2 : 0);
  try { return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(x); }
  catch { return `${x.toFixed(d)} ${currency}`; }
}
export const fmtInt = (v, locale = "en") => Math.round(num(v)).toLocaleString(locale);