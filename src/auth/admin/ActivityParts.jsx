/* ══════════════════════════════════════════════════════════════════════
   Centro de control · Actividad — piezas: gráfico diario, ficha de
   actividad de un cliente y ajustes de costes.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, RotateCcw, Database, HardDrive, ArrowDownUp, Users, Clock, LogIn, Info, Sparkles, RefreshCw, ChevronRight } from "lucide-react";
import { supabase, sbAccounts } from "../../lib/supabaseClient";
import { cx, Avatar, Drawer, Field, TierChip, fmtDate } from "./adminShared.jsx";
import { DEFAULT_COSTS, mergeCosts, dailySeries, fmtBytes, fmtDuration, fmtMoney, fmtInt, GIB } from "./costModel.js";
import s from "./AdminPortal.module.css";
import a from "./Activity.module.css";

// ── Métricas del gráfico diario ─────────────────────────────────────────
export const METRICS = [
  { id: "active_users", labelKey: "act_m_users", pick: r => Number(r.active_users) || 0, fmt: (v, l) => fmtInt(v, l) },
  { id: "logins", labelKey: "act_m_logins", pick: r => Number(r.logins) || 0, fmt: (v, l) => fmtInt(v, l) },
  { id: "active_seconds", labelKey: "act_m_time", pick: r => Number(r.active_seconds) || 0, fmt: (v, l) => fmtDuration(v, l) },
  { id: "page_views", labelKey: "act_m_pages", pick: r => Number(r.page_views) || 0, fmt: (v, l) => fmtInt(v, l) },
];

// Colores categóricos (orden fijo, validado) para el desglose de coste
export const BREAKDOWN_COLORS = { fixed: "#2a78d6", db: "#eb6834", storage: "#1baf7a", egress: "#eda100", mau: "#e87ba4" };

export const pageLabel = (k) => String(k ?? "—").replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase());

// ── Gráfico de barras diario (una sola serie, un solo eje) ──────────────
export function DailyChart({ series, format, label, locale, height = 190 }) {
  const wrap = useRef(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(1, ...series.map(p => p.value));
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    const m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  })();
  // El margen izquierdo se ajusta a la etiqueta más larga del eje
  const padL = Math.max(28, Math.round(Math.max(...[0, nice / 2, nice].map(v => format(v).length)) * 6.2) + 12);
  const padR = 8, padT = 10, padB = 24;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const step = innerW / Math.max(1, series.length);
  const bw = Math.max(2, Math.min(28, step - 2));
  const y = v => padT + innerH - (v / nice) * innerH;
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(innerW / 64)));
  const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const total = series.reduce((acc, p) => acc + p.value, 0);

  return (
    <div ref={wrap} className={a.chartWrap} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={`${label}: ${format(total)}`}>
        {ticks.map(tk => (
          <g key={tk}>
            <line x1={padL} x2={w - padR} y1={y(tk)} y2={y(tk)} className={a.grid} />
            <text x={padL - 8} y={y(tk) + 4} textAnchor="end" className={a.axis}>{format(tk)}</text>
          </g>
        ))}
        {series.map((p, i) => {
          const x = padL + i * step + (step - bw) / 2;
          const h = Math.max(p.value > 0 ? 2 : 0, padT + innerH - y(p.value));
          const on = hover === i;
          return (
            <g key={p.day}>
              {h > 0 ? (
                <path className={cx(a.bar, hover != null && !on && a.barDim)}
                  d={`M${x},${padT + innerH} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, bw / 2)},${-Math.min(4, h)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`}
                  style={{ animationDelay: `${Math.min(i * 12, 400)}ms` }} />
              ) : null}
              {i % labelEvery === 0 ? <text x={padL + i * step + step / 2} y={height - 6} textAnchor="middle" className={a.axis}>{fmtDay(p.day)}</text> : null}
              <rect x={padL + i * step} y={padT} width={step} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={padL} x2={w - padR} y1={padT + innerH} y2={padT + innerH} className={a.baseline} />
        {hover != null ? <line x1={padL + hover * step + step / 2} x2={padL + hover * step + step / 2} y1={padT} y2={padT + innerH} className={a.crosshair} /> : null}
      </svg>
      {hover != null && series[hover] ? (
        <div className={a.tip} style={{ left: Math.min(w - 150, Math.max(0, padL + hover * step + step / 2 - 70)) }}>
          <small>{new Date(`${series[hover].day}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}</small>
          <strong>{format(series[hover].value)}</strong>
          <span>{label}</span>
        </div>
      ) : null}
    </div>
  );
}

export function MetricChips({ value, onChange, tx }) {
  return (
    <div className={s.chipsRow} role="radiogroup">
      {METRICS.map(m => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id}
          className={cx(s.filterChip, value === m.id && s.filterChipOn)} onClick={() => onChange(m.id)}>
          {tx(m.labelKey)}
        </button>
      ))}
    </div>
  );
}

// Barra de desglose de coste (fijo + excesos) con leyenda
export function CostBreakdown({ breakdown, currency, locale, tx }) {
  const parts = Object.entries(breakdown).filter(([, v]) => v > 0.0001);
  const total = parts.reduce((acc, [, v]) => acc + v, 0);
  if (!total) return <p className={a.muted}>{tx("act_no_cost")}</p>;
  return (
    <div className={a.breakdown}>
      <div className={a.bdBar}>
        {parts.map(([k, v]) => (
          <span key={k} style={{ flexGrow: v, background: BREAKDOWN_COLORS[k] }} title={`${tx(`act_part_${k}`)}: ${fmtMoney(v, currency, locale)}`} />
        ))}
      </div>
      <ul className={a.bdLegend}>
        {parts.map(([k, v]) => (
          <li key={k}>
            <i style={{ background: BREAKDOWN_COLORS[k] }} />
            <span>{tx(`act_part_${k}`)}</span>
            <b>{fmtMoney(v, currency, locale)}</b>
            <em>{Math.round((v / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Ficha de actividad de un cliente
// ════════════════════════════════════════════════════════════════════════
export function ActivityDrawer({ client, model, from, to, tx, locale, onClose, onOpenCompany }) {
  const c = client.company;
  const cur = model.cfg.currency;
  const [metric, setMetric] = useState("active_seconds");
  const m = METRICS.find(x => x.id === metric);
  const series = useMemo(() => dailySeries(client.daily, from, to, m.pick), [client.daily, from, to, m]);

  const reqKey = `${c.id}|${from}|${to}`;
  const [detail, setDetail] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    sbAccounts.rpc("admin_company_activity", { p_company: String(c.id), p_from: from, p_to: to })
      .then(({ data, error }) => { if (!cancelled) setDetail({ key: reqKey, data: data ?? null, error: error?.message ?? null }); });
    return () => { cancelled = true; };
  }, [reqKey, c.id, from, to]);
  const loadingDetail = detail.key !== reqKey;
  const users = detail.data?.users ?? [];
  const pages = detail.data?.pages ?? [];
  const maxPage = Math.max(1, ...pages.map(p => p.seconds || p.views));
  const tables = Object.entries(client.db_tables ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 8);
  const maxTable = Math.max(1, ...tables.map(([, v]) => v));

  return (
    <Drawer onClose={onClose} width={860} labelledBy="act-drawer-title">
      {(close) => (
        <>
          <header className={s.dHead}>
            <Avatar label={c.name} tone="#1a2f8a" size={48} />
            <div className={s.dHeadText}>
              <h2 id="act-drawer-title" className={s.dTitle}>{c.name}</h2>
              <div className={s.dMeta}>
                <code className={s.slug}>{c.slug}</code>
                <TierChip tier={c.tier} />
                <span className={s.dMetaText}>{fmtDate(from, locale)} – {fmtDate(to, locale)}</span>
              </div>
            </div>
            <button type="button" className={s.btnGhost} onClick={() => { close(); setTimeout(() => onOpenCompany(c), 240); }}>{tx("act_open_company")}</button>
            <button type="button" className={s.iconBtn} onClick={close} aria-label={tx("close")}><X size={18} /></button>
          </header>

          <div className={s.dBody}>
            <div className={a.kpis}>
              <div className={a.kpi}>
                <small>{tx("act_cost_month")}</small>
                <strong>{fmtMoney(client.cost_month, cur, locale)}</strong>
                <span>{tx("act_share_bill", { p: (client.billShare * 100).toFixed(1) })}</span>
              </div>
              <div className={a.kpi}>
                <small>{tx("act_active_users")}</small>
                <strong>{fmtInt(client.active_users, locale)}<em> / {fmtInt(client.total_users, locale)}</em></strong>
                <span>{client.cost_per_user != null ? tx("act_per_user", { v: fmtMoney(client.cost_per_user, cur, locale) }) : tx("act_no_active")}</span>
              </div>
              <div className={a.kpi}>
                <small>{tx("act_m_logins")}</small>
                <strong>{fmtInt(client.logins, locale)}</strong>
                <span>{tx("act_sessions_n", { n: fmtInt(client.sessions, locale) })}</span>
              </div>
              <div className={a.kpi}>
                <small>{tx("act_m_time")}</small>
                <strong>{fmtDuration(client.active_seconds, locale)}</strong>
                <span>{client.lastActive ? tx("act_last_active", { d: fmtDate(client.lastActive, locale) }) : tx("act_never")}</span>
              </div>
              {client.margin != null ? (
                <div className={cx(a.kpi, client.margin < 0 && a.kpiBad)}>
                  <small>{tx("act_margin")}</small>
                  <strong>{fmtMoney(client.margin, cur, locale)}</strong>
                  <span>{tx("act_revenue_v", { v: fmtMoney(client.revenue, cur, locale) })}</span>
                </div>
              ) : null}
            </div>

            <section className={a.block}>
              <div className={a.blockHead}>
                <h3>{tx("act_daily")}</h3>
                <MetricChips value={metric} onChange={setMetric} tx={tx} />
              </div>
              <DailyChart series={series} format={(v) => m.fmt(v, locale)} label={tx(m.labelKey)} locale={locale} />
            </section>

            <div className={a.twoCol}>
              <section className={a.block}>
                <div className={a.blockHead}><h3>{tx("act_cost_breakdown")}</h3></div>
                <CostBreakdown breakdown={client.breakdown} currency={cur} locale={locale} tx={tx} />
              </section>
              <section className={a.block}>
                <div className={a.blockHead}><h3>{tx("act_resources")}</h3></div>
                <ul className={a.resList}>
                  <li><Database size={14} /><span>{tx("act_db")}</span><b>{fmtBytes(client.db_bytes, locale)}</b><em>{tx("act_rows_n", { n: fmtInt(client.db_rows, locale) })}</em></li>
                  <li><HardDrive size={14} /><span>{tx("act_storage")}</span><b>{fmtBytes(client.storage_bytes, locale)}</b><em>{tx("act_files_n", { n: fmtInt(client.storage_objects, locale) })}</em></li>
                  <li><ArrowDownUp size={14} /><span>{tx("act_egress")}</span><b>{fmtBytes(client.egress_bytes, locale)}</b><em>{tx("act_requests_n", { n: fmtInt(client.requests, locale) })} · {client.gwDays ? tx("act_measured_supabase") : tx("act_estimated_app")}</em></li>
                </ul>
                {Object.keys(client.byKind ?? {}).length ? (
                  <>
                    <p className={a.subhead}>{tx("act_traffic_by_kind")}</p>
                    <ul className={a.hbars}>
                      {Object.entries(client.byKind).sort((x, y) => y[1].bytes - x[1].bytes).map(([k, v]) => (
                        <li key={k}>
                          <span className={a.hbLabel}>{tx(`act_kind_${k}`)}</span>
                          <span className={a.hbTrack}><span style={{ width: `${(v.bytes / Math.max(1, ...Object.values(client.byKind).map(z => z.bytes))) * 100}%` }} /></span>
                          <b>{fmtBytes(v.bytes, locale)}</b>
                          <em>{tx("act_requests_n", { n: fmtInt(v.requests, locale) })}</em>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {tables.length ? (
                  <>
                    <p className={a.subhead}>{tx("act_heaviest_tables")}</p>
                    <ul className={a.hbars}>
                      {tables.map(([name, v]) => (
                        <li key={name}>
                          <span className={a.hbLabel} title={name}>{name.replace(/^public\./, "")}</span>
                          <span className={a.hbTrack}><span style={{ width: `${(v / maxTable) * 100}%` }} /></span>
                          <b>{fmtBytes(v, locale)}</b>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            </div>

            <section className={a.block}>
              <div className={a.blockHead}><h3>{tx("adm_users")}</h3>{loadingDetail ? <Loader2 size={14} className={s.spin} /> : null}</div>
              {detail.error ? <p className={a.errorLine}>{detail.error}</p> : null}
              {!loadingDetail && !users.length ? <p className={a.muted}>{tx("act_no_users")}</p> : (
                <div className={a.miniTable}>
                  <div className={a.miniHead}>
                    <span>{tx("col_user")}</span><span>{tx("act_m_logins")}</span><span>{tx("act_sessions")}</span>
                    <span>{tx("act_m_time")}</span><span>{tx("act_m_pages")}</span><span>{tx("act_last_seen")}</span>
                  </div>
                  {(loadingDetail ? [] : users).map(u => (
                    <div key={u.user_id} className={cx(a.miniRow, !u.seconds && !u.logins && a.miniIdle)}>
                      <span className={a.miniWho}>
                        <Avatar label={u.username || u.email} size={28} square={false} />
                        <span className={s.whoText}><strong>{u.username ?? "—"}</strong><small>{u.email}</small></span>
                      </span>
                      <span>{fmtInt(u.logins, locale)}</span>
                      <span>{fmtInt(u.sessions, locale)}</span>
                      <span>{fmtDuration(u.seconds, locale)}</span>
                      <span>{fmtInt(u.pages, locale)}</span>
                      <span className={a.muted}>{u.last_seen ? fmtDate(u.last_seen, locale) : tx("act_never")}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className={a.block}>
              <div className={a.blockHead}><h3>{tx("act_top_pages")}</h3></div>
              {!loadingDetail && !pages.length ? <p className={a.muted}>{tx("act_no_pages")}</p> : (
                <ul className={a.hbars}>
                  {pages.slice(0, 10).map(p => (
                    <li key={p.page}>
                      <span className={a.hbLabel}>{pageLabel(p.page)}</span>
                      <span className={a.hbTrack}><span style={{ width: `${((p.seconds || p.views) / maxPage) * 100}%` }} /></span>
                      <b>{fmtDuration(p.seconds, locale)}</b>
                      <em>{tx("act_views_n", { n: fmtInt(p.views, locale) })}</em>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Ajustes de costes: casi todo se lee solo de Supabase
// ════════════════════════════════════════════════════════════════════════
const CURRENCIES = ["USD", "EUR", "DKK", "GBP"];
const PLAN_LABEL = { free: "Free", pro: "Pro", team: "Team", enterprise: "Enterprise" };

export function CostSettingsDrawer({ settings, onClose, onSaved, tx, toast, locale }) {
  const [saved, setSaved] = useState(() => settings ?? {});
  const [currency, setCurrency] = useState(saved.currency ?? "USD");
  const [actualBill, setActualBill] = useState(saved.actual_bill ?? "");
  const [revenue, setRevenue] = useState(() => ({ ...DEFAULT_COSTS.revenue, ...(saved.revenue ?? {}) }));
  const [weights, setWeights] = useState(() => ({ ...DEFAULT_COSTS.weights, ...(saved.weights ?? {}) }));
  const [ov, setOv] = useState(() => saved.overrides ?? {});
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const draft = { ...saved, currency, actual_bill: actualBill, revenue, weights, overrides: ov };
  const eff = mergeCosts(draft);
  const auto = saved.auto ?? null;
  const usd = (v) => fmtMoney(v, "USD", locale);
  const wSum = Object.values(weights).reduce((acc, v) => acc + (Number(v) || 0), 0) || 1;

  // Vuelve a leer plan, compute, add-ons y cambio de moneda
  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("usage-sync", { body: { pricingOnly: true } });
      if (error || data?.ok === false) throw new Error(error?.message ?? data?.pricingError ?? "usage-sync");
      setSaved(prev => ({ ...prev, auto: data.pricing }));
      toast("success", tx("act_prices_read"));
    } catch (e) {
      toast("error", tx("act_prices_read_failed", { e: e?.message ?? String(e) }));
    } finally {
      setRefreshing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === "" ? undefined : v)));
    const next = clean({
      ...saved,
      currency,
      actual_bill: actualBill === "" ? null : Number(actualBill),
      revenue: Object.fromEntries(Object.entries(revenue).map(([k, v]) => [k, v === "" || v == null ? null : Number(v)])),
      weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Number(v) || 0])),
      overrides: ov,
    });
    const { error } = await sbAccounts.from("usage_cost_settings")
      .upsert({ id: 1, settings: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
    setSaving(false);
    if (error) { toast("error", error.message); return false; }
    toast("success", tx("act_settings_saved"));
    onSaved(next);
    return true;
  };

  const numInput = (value, onChange, opts = {}) => (
    <input type="number" inputMode="decimal" step={opts.step ?? "any"} min="0" className={cx(s.input, a.num)}
      value={value ?? ""} placeholder={opts.placeholder} onChange={(e) => onChange(e.target.value)} />
  );
  const setOvKey = (k, v) => setOv(prev => ({ ...prev, [k]: v }));
  const setOvIn = (g, k, v) => setOv(prev => ({ ...prev, [g]: { ...(prev[g] ?? {}), [k]: v } }));
  const autoOr = (v) => (v == null ? "" : String(Math.round(Number(v) * 10000) / 10000));

  const computeLine = eff.compute_fee > 0
    ? `${auto?.compute_name ?? "Compute"} · ${usd(eff.compute_fee)}${eff.compute_credit ? ` (${tx("act_credit_v", { v: usd(eff.compute_credit) })})` : ""}`
    : "—";
  const RES = [
    { k: "db_gb", label: tx("act_db"), unit: "GB" },
    { k: "storage_gb", label: tx("act_storage"), unit: "GB" },
    { k: "egress_gb", label: tx("act_egress"), unit: "GB" },
    { k: "mau", label: tx("act_mau"), unit: tx("act_users_unit") },
  ];

  return (
    <Drawer onClose={onClose} width={640} labelledBy="cost-title">
      {(close) => (
        <>
          <header className={s.dHead}>
            <div className={s.dHeadText}>
              <h2 id="cost-title" className={s.dTitle}>{tx("act_cost_settings")}</h2>
              <div className={s.dMeta}><span className={s.dMetaText}>{tx("act_cost_settings_sub")}</span></div>
            </div>
            <button type="button" className={s.iconBtn} onClick={close} aria-label={tx("close")}><X size={18} /></button>
          </header>
          <div className={s.dBody}>
            <div className={s.stack}>
              {/* ── Leído de Supabase ── */}
              <section className={cx(a.autoCard, !auto && a.autoMissing)}>
                <div className={a.autoHead}>
                  <span className={a.autoBadge}>{auto ? <Sparkles size={13} /> : <Info size={13} />}{tx(auto ? "act_auto_badge" : "act_auto_missing_badge")}</span>
                  <span className={a.autoWhen}>
                    {auto?.fetched_at ? tx("act_auto_when", { d: new Date(auto.fetched_at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : tx("act_auto_never")}
                  </span>
                  <button type="button" className={s.btnGhost} onClick={refresh} disabled={refreshing}>
                    {refreshing ? <Loader2 size={14} className={s.spin} /> : <RefreshCw size={14} />} {tx("act_auto_refresh")}
                  </button>
                </div>
                {!auto ? <p className={a.formNote}>{tx("act_auto_missing")}</p> : null}
                <dl className={a.autoList}>
                  <div><dt>{tx("act_plan")}</dt><dd>{auto?.plan ? `${PLAN_LABEL[auto.plan] ?? auto.plan} · ${usd(eff.plan_fee)}` : `Pro · ${usd(eff.plan_fee)}`}{has(ov.plan_fee) ? <em>{tx("act_edited")}</em> : null}</dd></div>
                  <div><dt>{tx("act_compute")}</dt><dd>{computeLine}{has(ov.compute_fee) || has(ov.compute_credit) ? <em>{tx("act_edited")}</em> : null}</dd></div>
                  <div><dt>{tx("act_addons")}</dt><dd>
                    {(auto?.addons ?? []).length
                      ? auto.addons.map(ad => `${ad.name} ${usd(ad.monthly)}`).join(" · ")
                      : tx("act_addons_none")}
                    {has(ov.extra_fixed) ? <em>{tx("act_edited")}</em> : null}
                  </dd></div>
                  <div><dt>{tx("act_monthly_fixed")}</dt><dd><strong>{usd(eff.plan_fee + Math.max(0, eff.compute_fee - eff.compute_credit) + eff.extra_fixed)}</strong></dd></div>
                </dl>
                <div className={a.autoTable}>
                  <span /><span>{tx("act_included")}</span><span>{tx("act_price_unit")}</span>
                  {RES.map(r => (
                    <AutoRow key={r.k} r={r} eff={eff} usd={usd} locale={locale} />
                  ))}
                </div>
                {auto?.plan && auto.plan_known === false ? <p className={a.formNote}><Info size={13} /> {tx("act_plan_custom")}</p> : null}
              </section>

              {/* ── Moneda ── */}
              <section className={a.formBlock}>
                <h3>{tx("act_currency")}</h3>
                <div className={a.currencyRow}>
                  <div className={s.chipsRow} role="radiogroup" aria-label={tx("act_currency")}>
                    {CURRENCIES.map(cu => (
                      <button key={cu} type="button" role="radio" aria-checked={currency === cu}
                        className={cx(s.filterChip, currency === cu && s.filterChipOn)} onClick={() => setCurrency(cu)}>{cu}</button>
                    ))}
                  </div>
                  <span className={a.fxText}>
                    {currency === "USD" ? tx("act_fx_usd")
                      : eff.fxAuto ? tx("act_fx_auto", { r: eff.fx.toLocaleString(locale, { maximumFractionDigits: 4 }), c: currency, d: auto?.fx_date ?? "" })
                      : tx("act_fx_manual", { r: eff.fx, c: currency })}
                  </span>
                </div>
              </section>

              {/* ── Opcional ── */}
              <section className={a.formBlock}>
                <h3>{tx("act_optional")}</h3>
                <Field label={tx("act_actual_bill")} hint={tx("act_actual_hint")}>
                  {numInput(actualBill, setActualBill, { placeholder: tx("act_estimated_ph") })}
                </Field>
                <div style={{ height: 14 }} />
                <Field label={tx("act_revenue")} hint={tx("act_revenue_note")}>
                  <div className={a.revenueGrid}>
                    {["low", "base", "pro", "max"].map(tier => (
                      <label key={tier} className={a.revenueCell}>
                        <TierChip tier={tier} />
                        {numInput(revenue[tier], v => setRevenue(prev => ({ ...prev, [tier]: v })), { placeholder: "—" })}
                      </label>
                    ))}
                  </div>
                </Field>
              </section>

              {/* ── Avanzado ── */}
              <section className={a.formBlock}>
                <button type="button" className={a.disclosure} onClick={() => setAdvanced(v => !v)} aria-expanded={advanced}>
                  <ChevronRight size={15} className={advanced ? a.discOpen : undefined} />
                  {tx("act_advanced")}
                  {eff.manual ? <em>{tx("act_manual_active")}</em> : null}
                </button>
                {advanced ? (
                  <div className={a.advanced}>
                    <p className={a.formNote}>{tx("act_override_note")}</p>
                    <div className={s.formGrid}>
                      <Field label={tx("act_plan_fee")}>{numInput(ov.plan_fee, v => setOvKey("plan_fee", v), { placeholder: autoOr(auto?.plan_fee ?? DEFAULT_COSTS.plan_fee) })}</Field>
                      <Field label={tx("act_compute_fee")}>{numInput(ov.compute_fee, v => setOvKey("compute_fee", v), { placeholder: autoOr(auto?.compute_fee ?? DEFAULT_COSTS.compute_fee) })}</Field>
                      <Field label={tx("act_compute_credit")}>{numInput(ov.compute_credit, v => setOvKey("compute_credit", v), { placeholder: autoOr(auto?.compute_credit ?? DEFAULT_COSTS.compute_credit) })}</Field>
                      <Field label={tx("act_extra_fixed")}>{numInput(ov.extra_fixed, v => setOvKey("extra_fixed", v), { placeholder: autoOr(auto?.extra_fixed ?? DEFAULT_COSTS.extra_fixed) })}</Field>
                    </div>
                    <div className={a.priceTable} style={{ marginTop: 14 }}>
                      <span /><span>{tx("act_included")}</span><span>{tx("act_price_unit")}</span>
                      {RES.map(r => (
                        <OverrideRow key={r.k} r={r} ov={ov} auto={auto} setOvIn={setOvIn} numInput={numInput} autoOr={autoOr} />
                      ))}
                    </div>
                    {currency !== "USD" ? (
                      <div style={{ marginTop: 14 }}>
                        <Field label={tx("act_fx", { c: currency })}>
                          {numInput(ov.fx, v => setOvKey("fx", v), { step: "0.0001", placeholder: autoOr(auto?.fx?.[currency]) })}
                        </Field>
                      </div>
                    ) : null}
                    {eff.manual || has(ov.fx) ? (
                      <button type="button" className={cx(s.btnGhost, a.resetBtn)} onClick={() => setOv({})}>
                        <RotateCcw size={14} /> {tx("act_back_to_auto")}
                      </button>
                    ) : null}

                    <h4 className={a.subhead}>{tx("act_weights")}</h4>
                    <p className={a.formNote}>{tx("act_weights_note")}</p>
                    <div className={a.weights}>
                      {[
                        { k: "db", label: tx("act_db"), icon: Database },
                        { k: "storage", label: tx("act_storage"), icon: HardDrive },
                        { k: "egress", label: tx("act_egress"), icon: ArrowDownUp },
                        { k: "activity", label: tx("act_m_time"), icon: Clock },
                      ].map(w => (
                        <label key={w.k} className={a.weightRow}>
                          <span className={a.weightName}><w.icon size={14} />{w.label}</span>
                          <input type="range" min="0" max="100" step="5" value={weights[w.k]}
                            onChange={(e) => setWeights(prev => ({ ...prev, [w.k]: Number(e.target.value) }))} />
                          <b>{Math.round(((Number(weights[w.k]) || 0) / wSum) * 100)}%</b>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
          <footer className={s.dFoot}>
            <span className={s.dState} />
            <button type="button" className={s.btnGhost} onClick={close} disabled={saving}>{tx("adm_cancel")}</button>
            <button type="button" className={s.btnPrimary} disabled={saving} onClick={async () => { if (await save()) close(); }}>
              {saving ? <Loader2 size={14} className={s.spin} /> : null}
              {tx("adm_save")}
            </button>
          </footer>
        </>
      )}
    </Drawer>
  );
}

const has = (v) => v !== null && v !== undefined && v !== "";

function AutoRow({ r, eff, usd, locale }) {
  const incl = eff.included[r.k];
  const unit = eff.unit[r.k];
  return (
    <>
      <span className={a.priceLabel}>{r.label}</span>
      <span className={a.autoVal}>{Number(incl).toLocaleString(locale)} {r.unit}</span>
      <span className={a.autoVal}>{unit ? `${fmtMoney(unit, "USD", locale, unit < 0.01 ? 5 : unit < 1 ? 4 : 2)} / ${r.unit === "GB" ? "GB" : r.unit.replace(/s$/, "")}` : "—"}</span>
    </>
  );
}

function OverrideRow({ r, ov, auto, setOvIn, numInput, autoOr }) {
  return (
    <>
      <span className={a.priceLabel}>{r.label}</span>
      <span className={a.priceCell}>{numInput(ov.included?.[r.k], v => setOvIn("included", r.k, v), { placeholder: autoOr(auto?.included?.[r.k] ?? DEFAULT_COSTS.included[r.k]) })}<em>{r.unit}</em></span>
      <span className={a.priceCell}>{numInput(ov.unit?.[r.k], v => setOvIn("unit", r.k, v), { step: "0.0001", placeholder: autoOr(auto?.unit?.[r.k] ?? DEFAULT_COSTS.unit[r.k]) })}<em>USD</em></span>
    </>
  );
}

// Iconos reutilizados por la vista
export const RES_ICONS = { db: Database, storage: HardDrive, egress: ArrowDownUp, mau: Users, logins: LogIn };
export { DEFAULT_COSTS, GIB };