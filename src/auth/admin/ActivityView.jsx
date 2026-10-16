/* ══════════════════════════════════════════════════════════════════════
   Centro de control · Actividad
   Cuánto usa cada cliente la app y cuánto cuesta en Supabase.
   Datos: accounts.usage_daily (+ funciones admin_*), ver
   supabase/activity_analytics.sql. El coste se calcula en costModel.js.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2, Database, HardDrive, ArrowDownUp, Users, AlertTriangle, CheckCircle2, ArrowUp, ArrowDown, Search, X, Terminal, LogIn, Clock, Scale } from "lucide-react";
import { supabase, sbAccounts } from "../../lib/supabaseClient";
import { cx, Avatar, fmtDate } from "./adminShared.jsx";
import { computeCosts, dailySeries, fmtBytes, fmtDuration, fmtMoney, fmtInt, GIB } from "./costModel.js";
import { DailyChart, MetricChips, METRICS, ActivityDrawer, CostSettingsDrawer, pageLabel } from "./ActivityParts.jsx";
import s from "./AdminPortal.module.css";
import a from "./Activity.module.css";

// Fechas locales en ISO (sin desfase de zona horaria)
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (isoDay, n) => { const d = new Date(`${isoDay}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };

export function rangeFor(id, now) {
  const today = iso(new Date(now));
  if (id === "month") { const d = new Date(now); return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: today }; }
  if (id === "prev") { const d = new Date(now); return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) }; }
  const n = Number(id) || 30;
  return { from: addDays(today, -(n - 1)), to: today };
}

const isMissing = (err) => !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202"
  || /does not exist|Could not find the (table|function)/i.test(err.message ?? ""));

// Tonos de navy por orden de coste (de oscuro a claro; el último aún contrasta con el blanco)
const RANK_TONES = ["#14246e", "#1f3a9e", "#3355c0", "#5574d0", "#7a93dc", "#9aaee6"];
const OTHERS_TONE = "#c3cad8";

// Datos de uso de un periodo (también los usa el Inicio del centro de control)
export function useUsageData(from, to, tick = 0) {
  const reqKey = `${from}|${to}|${tick}`;
  const [data, setData] = useState({ key: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [daily, plat, cost, au, pages] = await Promise.all([
        sbAccounts.from("usage_daily").select("*").gte("day", addDays(from, -35)).lte("day", to),
        sbAccounts.from("usage_platform_daily").select("*").gte("day", addDays(from, -35)).lte("day", to),
        sbAccounts.from("usage_cost_settings").select("settings").eq("id", 1).maybeSingle(),
        sbAccounts.rpc("admin_usage_active_users", { p_from: from, p_to: to }),
        sbAccounts.rpc("admin_usage_pages", { p_from: from, p_to: to }),
      ]);
      if (cancelled) return;
      const missing = [daily, plat, cost, au].some(r => isMissing(r.error));
      setData({
        key: reqKey,
        missing,
        error: missing ? null : (daily.error ?? plat.error ?? au.error)?.message ?? null,
        rows: daily.data ?? [],
        platformRows: plat.data ?? [],
        settings: cost.data?.settings ?? {},
        activeUsers: au.data ?? {},
        pages: Array.isArray(pages.data) ? pages.data : [],
      });
    })();
    return () => { cancelled = true; };
  }, [reqKey, from, to]);
  return [data, setData, data.key !== reqKey];
}

export default function ActivityView({ companies, tx, locale, now, toast, costOpen, setCostOpen, onOpenCompany }) {
  const [range, setRange] = useState("30");
  const { from, to } = useMemo(() => rangeFor(range, now), [range, now]);
  const [tick, setTick] = useState(0);
  const [data, setData, loading] = useUsageData(from, to, tick);
  const [refreshing, setRefreshing] = useState(false);

  const model = useMemo(() => (data.rows ? computeCosts({
    companies, rows: data.rows, platformRows: data.platformRows, activeUsers: data.activeUsers, settings: data.settings, from, to,
  }) : null), [companies, data, from, to]);

  // 1) trae de Supabase el tráfico real de hoy y ayer (Edge Function usage-sync)
  // 2) recalcula actividad y tamaños
  const recalc = async () => {
    setRefreshing(true);
    let syncError = null;
    let syncWarning = null;
    let tagStatus = null;
    try {
      const { data: res, error } = await supabase.functions.invoke("usage-sync", { body: { days: 2 } });
      if (error) syncError = error.message;
      else if (res && res.ok === false) syncError = res.error ?? res.results?.find(r => !r.ok)?.error ?? "usage-sync";
      else {
        tagStatus = res?.tagStatus ?? null;
        if (res?.warning) syncWarning = res.warning;
      }
    } catch (e) { syncError = e?.message ?? String(e); }
    const { error } = await sbAccounts.rpc("admin_refresh_usage", { p_day: iso(new Date()), p_sizes: true });
    setRefreshing(false);
    if (error) { toast("error", error.message); return; }
    if (syncError) toast("error", tx("act_sync_failed", { e: syncError }));
    else if (tagStatus === "untagged") toast("error", tx("act_sync_untagged", { e: syncWarning ?? "" }));
    else if (syncWarning) toast("error", tx("act_sync_warn", { e: syncWarning }));
    else if (tagStatus === "waiting") toast("success", tx("act_sync_waiting"));
    else toast("success", tx("act_recalculated"));
    setTick(n => n + 1);
  };

  const [open, setOpen] = useState(null);   // id de empresa
  const openClient = model?.clients.find(c => String(c.company.id) === open) ?? null;

  if (data.missing) return <SetupNeeded tx={tx} />;

  return (
    <div className={s.view}>
      <div className={a.topBar}>
        <div className={s.chipsRow} role="radiogroup" aria-label={tx("act_period")}>
          {[["7", tx("act_r7")], ["30", tx("act_r30")], ["90", tx("act_r90")], ["month", tx("act_rmonth")], ["prev", tx("act_rprev")]].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={range === id}
              className={cx(s.filterChip, range === id && s.filterChipOn)} onClick={() => setRange(id)}>{label}</button>
          ))}
        </div>
        <span className={a.rangeText}>{fmtDate(from, locale)} – {fmtDate(to, locale)}</span>
        <span className={a.updated}>
          {model?.platform.day ? tx("act_sizes_from", { d: fmtDate(model.platform.day, locale) }) : null}
        </span>
        <button type="button" className={s.btnGhost} onClick={recalc} disabled={refreshing}>
          {refreshing ? <Loader2 size={14} className={s.spin} /> : <RefreshCw size={14} />} {tx("act_recalculate")}
        </button>
      </div>

      {data.error ? <p className={a.errorLine}>{data.error}</p> : null}

      {!model ? (
        <div className={a.skeleton}><div /><div /><div /></div>
      ) : (
        <>
          <BillStrip model={model} tx={tx} locale={locale} onPick={setOpen} loading={loading} />
          <Meters model={model} tx={tx} locale={locale} />
          <Sources model={model} tx={tx} locale={locale} />
          <div className={a.mainGrid}>
            <ActivityChart model={model} from={from} to={to} tx={tx} locale={locale} />
            <TopPages pages={data.pages ?? []} tx={tx} locale={locale} />
          </div>
          <ClientsTable model={model} tx={tx} locale={locale} onOpen={setOpen} />
        </>
      )}

      {openClient && (
        <ActivityDrawer key={open} client={openClient} model={model} from={from} to={to} tx={tx} locale={locale}
          onClose={() => setOpen(null)} onOpenCompany={onOpenCompany} />
      )}
      {costOpen && (
        <CostSettingsDrawer settings={data.settings} tx={tx} toast={toast} locale={locale}
          onClose={() => setCostOpen(false)}
          onSaved={(settings) => setData(d => ({ ...d, settings }))} />
      )}
    </div>
  );
}

// ── Dónde va la factura (la barra que también abre cada cliente) ────────
function BillStrip({ model, tx, locale, onPick, loading }) {
  const cur = model.cfg.currency;
  const ranked = [...model.clients].filter(c => c.cost_month > 0.0001).sort((x, y) => y.cost_month - x.cost_month);
  const top = ranked.slice(0, RANK_TONES.length);
  const rest = ranked.slice(RANK_TONES.length);
  const restSum = rest.reduce((acc, c) => acc + c.cost_month, 0);
  const total = model.bill.total;
  const [hover, setHover] = useState(null);
  return (
    <section className={cx(s.compo, a.bill, loading && a.isLoading)}>
      <div className={a.billHead}>
        <div>
          <h2>{tx("act_where_bill")}</h2>
          <p>{model.bill.usingActual ? tx("act_bill_actual")
            : model.cfg.auto?.plan ? tx("act_bill_auto", { plan: model.cfg.auto.plan.charAt(0).toUpperCase() + model.cfg.auto.plan.slice(1) })
            : tx("act_bill_estimated")}</p>
        </div>
        <div className={a.billTotal}>
          <strong>{fmtMoney(total, cur, locale)}</strong>
          <span>{tx("act_per_month")}</span>
        </div>
      </div>
      <div className={s.compoBar} role="group" aria-label={tx("act_where_bill")} onMouseLeave={() => setHover(null)}>
        {top.map((c, i) => (
          <button key={c.company.id} type="button"
            className={cx(s.compoSeg, a.billSeg, hover != null && hover !== c.company.id && s.compoSegDim)}
            style={{ "--seg": RANK_TONES[i], flexGrow: c.cost_month, animationDelay: `${i * 70}ms`, color: i >= 4 ? "#0f172a" : "#fff" }}
            onMouseEnter={() => setHover(c.company.id)} onFocus={() => setHover(c.company.id)}
            onClick={() => onPick(String(c.company.id))}
            aria-label={`${c.company.name}: ${fmtMoney(c.cost_month, cur, locale)}`}>
            <span className={a.segText}>{c.company.name}</span>
          </button>
        ))}
        {restSum > 0 ? (
          <span className={cx(s.compoSeg, a.billSeg)} style={{ "--seg": OTHERS_TONE, flexGrow: restSum, color: "#0f172a" }}
            title={`${tx("act_others", { n: rest.length })}: ${fmtMoney(restSum, cur, locale)}`}>
            <span className={a.segText}>{tx("act_others", { n: rest.length })}</span>
          </span>
        ) : null}
        {!ranked.length ? <span className={s.compoEmpty} /> : null}
      </div>
      <div className={s.compoLegend}>
        {top.map((c, i) => (
          <button key={c.company.id} type="button" className={cx(s.legendItem, hover === c.company.id && s.legendOn)}
            style={{ "--seg": RANK_TONES[i] }} onMouseEnter={() => setHover(c.company.id)} onMouseLeave={() => setHover(null)}
            onClick={() => onPick(String(c.company.id))}>
            <i />{c.company.name}<b>{fmtMoney(c.cost_month, cur, locale)}</b>
          </button>
        ))}
        {restSum > 0 ? <span className={s.legendItem} style={{ "--seg": OTHERS_TONE }}><i />{tx("act_others", { n: rest.length })}<b>{fmtMoney(restSum, cur, locale)}</b></span> : null}
      </div>
      <p className={a.billNote}>
        {tx("act_bill_parts", {
          fixed: fmtMoney(model.bill.fixed, cur, locale),
          over: fmtMoney(Object.values(model.bill.overages).reduce((acc, v) => acc + v, 0), cur, locale),
        })}
      </p>
    </section>
  );
}

// ── Consumo del proyecto frente a lo incluido en el plan ────────────────
function Meters({ model, tx, locale }) {
  const { platform: p, cfg } = model;
  const cur = cfg.currency;
  const items = [
    { k: "db", icon: Database, label: tx("act_db"), used: p.db_bytes / GIB, incl: cfg.included.db_gb, value: fmtBytes(p.db_bytes, locale), inclText: `${cfg.included.db_gb} GB` },
    { k: "storage", icon: HardDrive, label: tx("act_storage"), used: p.storage_bytes / GIB, incl: cfg.included.storage_gb, value: fmtBytes(p.storage_bytes, locale), inclText: `${cfg.included.storage_gb} GB` },
    { k: "egress", icon: ArrowDownUp, label: model.sources.traffic === "measured" ? tx("act_egress_month") : `${tx("act_egress_month")} (${tx("act_estimated")})`, used: p.egress_month_bytes / GIB, incl: cfg.included.egress_gb, value: fmtBytes(p.egress_month_bytes, locale), inclText: `${cfg.included.egress_gb} GB` },
    { k: "mau", icon: Users, label: tx("act_mau"), used: p.mau, incl: cfg.included.mau, value: fmtInt(p.mau, locale), inclText: fmtInt(cfg.included.mau, locale) },
  ];
  return (
    <div className={a.meters}>
      {items.map(it => {
        const pct = it.incl > 0 ? it.used / it.incl : 0;
        const status = pct > 1 ? "over" : pct >= 0.7 ? "warn" : "ok";
        const over = model.bill.overages[it.k] ?? 0;
        return (
          <div key={it.k} className={cx(a.meter, a[`meter_${status}`])}>
            <div className={a.meterHead}><it.icon size={15} /><span>{it.label}</span></div>
            <strong>{it.value}</strong>
            <div className={a.meterTrack} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(pct, 1) * 100)}>
              <span style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct * 100))}%` }} />
            </div>
            <p className={a.meterFoot}>
              {status === "ok" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {status === "over"
                ? tx("act_over_by", { v: fmtMoney(over, cur, locale) })
                : tx("act_of_included", { p: Math.round(pct * 100), v: it.inclText })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── De dónde sale cada número ───────────────────────────────────────────
function Sources({ model, tx, locale }) {
  const t = model.sources.traffic;
  const synced = model.platform.gwSyncedAt
    ? new Date(model.platform.gwSyncedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const items = [
    { icon: Database, label: tx("act_src_sizes"), state: model.sources.sizes === "measured" ? "ok" : "warn",
      text: model.platform.day ? tx("act_src_sizes_ok", { d: fmtDate(model.platform.day, locale) }) : tx("act_src_sizes_missing") },
    { icon: LogIn, label: tx("act_src_logins"), state: "ok", text: tx("act_src_logins_ok") },
    { icon: ArrowDownUp, label: tx("act_src_traffic"),
      state: t === "measured" ? "ok" : "warn",
      text: t === "measured" ? tx("act_src_traffic_ok", { d: synced ?? "—" })
        : t === "mixed" ? tx("act_src_traffic_mixed")
        : t === "estimated" ? tx("act_src_traffic_est") : tx("act_src_traffic_missing") },
    { icon: Clock, label: tx("act_src_time"), state: model.sources.activity === "measured" ? "ok" : "warn",
      text: model.sources.activity === "measured" ? tx("act_src_time_ok") : tx("act_src_time_missing") },
    { icon: Scale, label: tx("act_src_cost"), state: "info",
      text: model.bill.usingActual ? tx("act_src_cost_actual") : tx("act_src_cost_est") },
  ];
  return (
    <section className={a.sources} aria-label={tx("act_src_title")}>
      <h3>{tx("act_src_title")}</h3>
      <ul>
        {items.map(it => (
          <li key={it.label} className={a[`src_${it.state}`]}>
            <span className={a.srcIcon}><it.icon size={14} /></span>
            <span className={a.srcText}><strong>{it.label}</strong><small>{it.text}</small></span>
            {it.state === "ok" ? <CheckCircle2 size={14} className={a.srcMark} /> : it.state === "warn" ? <AlertTriangle size={14} className={a.srcMark} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Actividad diaria de todos los clientes ──────────────────────────────
export function ActivityChart({ model, from, to, tx, locale }) {
  const [metric, setMetric] = useState("active_users");
  const m = METRICS.find(x => x.id === metric);
  const series = useMemo(() => {
    const sum = new Map();
    for (const c of model.clients) {
      for (const [day, r] of c.daily) sum.set(day, (sum.get(day) ?? 0) + m.pick(r));
    }
    return dailySeries(sum, from, to, v => v);
  }, [model, from, to, m]);
  const totals = model.clients.reduce((acc, c) => ({
    logins: acc.logins + c.logins, seconds: acc.seconds + c.active_seconds, users: acc.users + c.active_users, pages: acc.pages + c.page_views,
  }), { logins: 0, seconds: 0, users: 0, pages: 0 });
  return (
    <section className={a.card}>
      <div className={a.cardHead}>
        <h3>{tx("act_daily")}</h3>
        <MetricChips value={metric} onChange={setMetric} tx={tx} />
      </div>
      <div className={a.statRow}>
        <span><b>{fmtInt(totals.users, locale)}</b>{tx("act_active_users").toLowerCase()}</span>
        <span><b>{fmtInt(totals.logins, locale)}</b>{tx("act_m_logins").toLowerCase()}</span>
        <span><b>{fmtDuration(totals.seconds, locale)}</b>{tx("act_of_use")}</span>
        <span><b>{fmtInt(totals.pages, locale)}</b>{tx("act_m_pages").toLowerCase()}</span>
      </div>
      <DailyChart series={series.map(p => ({ day: p.day, value: p.value }))} format={(v) => m.fmt(v, locale)} label={tx(m.labelKey)} locale={locale} />
      {metric === "active_users" ? <p className={a.chartNote}>{tx("act_users_note")}</p> : null}
    </section>
  );
}

function TopPages({ pages, tx, locale }) {
  const max = Math.max(1, ...pages.map(p => p.seconds || p.views));
  return (
    <section className={a.card}>
      <div className={a.cardHead}><h3>{tx("act_top_pages")}</h3></div>
      {!pages.length ? <p className={a.muted}>{tx("act_no_pages")}</p> : (
        <ul className={a.hbars}>
          {pages.slice(0, 9).map(p => (
            <li key={p.page}>
              <span className={a.hbLabel} title={p.page}>{pageLabel(p.page)}</span>
              <span className={a.hbTrack}><span style={{ width: `${((p.seconds || p.views) / max) * 100}%` }} /></span>
              <b>{fmtDuration(p.seconds, locale)}</b>
              <em>{tx("act_companies_n", { n: p.companies })}</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Tabla de clientes ───────────────────────────────────────────────────
function ClientsTable({ model, tx, locale, onOpen }) {
  const cur = model.cfg.currency;
  const [sort, setSort] = useState({ key: "cost", dir: "desc" });
  const [q, setQ] = useState("");
  const showMargin = model.clients.some(c => c.margin != null);
  const maxCost = Math.max(0.0001, ...model.clients.map(c => c.cost_month));
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = model.clients.filter(c => !needle || c.company.name.toLowerCase().includes(needle) || (c.company.slug ?? "").includes(needle));
    const val = (c) => ({
      name: c.company.name.toLowerCase(), users: c.active_users, logins: c.logins, time: c.active_seconds,
      data: c.db_bytes + c.storage_bytes, egress: c.egress_bytes, cost: c.cost_month,
      per: c.cost_per_user ?? -1, margin: c.margin ?? -1e12,
    })[sort.key];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((x, y) => (val(x) > val(y) ? dir : val(x) < val(y) ? -dir : 0));
  }, [model, q, sort]);
  const head = (k, label, cls) => {
    const on = sort.key === k;
    return (
      <span role="columnheader" className={cx(s.thCell, cls)} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className={cx(s.th, s.thSort, on && s.thOn)}
          onClick={() => setSort(on ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" ? "asc" : "desc" })}>
          {label}{on ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
        </button>
      </span>
    );
  };
  const none = model.unattributed;
  return (
    <section className={a.tableBlock}>
      <div className={s.toolbar}>
        <h3 className={a.tableTitle}>{tx("act_by_client")}</h3>
        <div className={s.searchBox}>
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("adm_search_company")} />
          {q ? <button type="button" onClick={() => setQ("")} aria-label={tx("clear_filters")}><X size={13} /></button> : null}
        </div>
      </div>
      <div className={s.tableWrap}>
        <div className={cx(s.table, a.actTable, showMargin && a.withMargin)} role="table">
          <div className={s.thead} role="row">
            {head("name", tx("col_company"))}
            {head("users", tx("act_active_users"))}
            {head("logins", tx("act_m_logins"), s.hideMd)}
            {head("time", tx("act_m_time"))}
            {head("data", tx("act_data"), s.hideLg)}
            {head("egress", tx("act_egress"), s.hideLg)}
            {head("cost", tx("act_cost_month"))}
            {head("per", tx("act_per_user_col"), s.hideMd)}
            {showMargin ? head("margin", tx("act_margin")) : null}
          </div>
          {rows.map(c => (
            <div key={c.company.id} role="row" tabIndex={0} className={cx(s.tr, !c.active_users && a.trQuiet)}
              style={{ "--rowc": "#1a2f8a" }} onClick={() => onOpen(String(c.company.id))}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(String(c.company.id)); }}>
              <span role="cell" className={cx(s.td, s.tdMain)}>
                <Avatar label={c.company.name} tone="#1a2f8a" size={36} />
                <span className={s.whoText}>
                  <strong>{c.company.name}</strong>
                  <small>{c.lastActive ? tx("act_last_active", { d: fmtDate(c.lastActive, locale) }) : tx("act_no_activity")}</small>
                </span>
              </span>
              <span role="cell" className={cx(s.td, a.tdUsers)}>
                <strong>{fmtInt(c.active_users, locale)}</strong><small>/{fmtInt(c.total_users, locale)}</small>
                <span className={a.adopt}><span style={{ width: `${c.total_users ? Math.min(100, (c.active_users / c.total_users) * 100) : 0}%` }} /></span>
              </span>
              <span role="cell" className={cx(s.td, s.hideMd, a.numCell)}>{fmtInt(c.logins, locale)}</span>
              <span role="cell" className={cx(s.td, a.numCell)}>{fmtDuration(c.active_seconds, locale)}</span>
              <span role="cell" className={cx(s.td, s.hideLg, a.numCell)}>{fmtBytes(c.db_bytes + c.storage_bytes, locale)}</span>
              <span role="cell" className={cx(s.td, s.hideLg, a.numCell)}>{fmtBytes(c.egress_bytes, locale)}</span>
              <span role="cell" className={cx(s.td, a.costCell)}>
                <strong>{fmtMoney(c.cost_month, cur, locale)}</strong>
                <span className={a.costBar}><span style={{ width: `${(c.cost_month / maxCost) * 100}%` }} /></span>
              </span>
              <span role="cell" className={cx(s.td, s.hideMd, a.numCell)}>{c.cost_per_user != null ? fmtMoney(c.cost_per_user, cur, locale) : "—"}</span>
              {showMargin ? (
                <span role="cell" className={cx(s.td, a.numCell, c.margin != null && (c.margin < 0 ? a.neg : a.pos))}>
                  {c.margin != null ? fmtMoney(c.margin, cur, locale) : "—"}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {none && (none.db_bytes + none.storage_bytes + none.active_seconds) > 0 ? (
        <p className={a.footnote}>
          {tx("act_unattributed", {
            data: fmtBytes(none.db_bytes + none.storage_bytes, locale),
            time: fmtDuration(none.active_seconds, locale),
          })}
        </p>
      ) : null}
    </section>
  );
}

// ── Aún no está instalado ───────────────────────────────────────────────
function SetupNeeded({ tx }) {
  return (
    <div className={s.view}>
      <section className={a.setup}>
        <span className={a.setupIcon}><Terminal size={22} /></span>
        <h2>{tx("act_setup_title")}</h2>
        <p>{tx("act_setup_body")}</p>
        <ol>
          <li>{tx("act_setup_1")}</li>
          <li>{tx("act_setup_2")}</li>
          <li>{tx("act_setup_3")}</li>
        </ol>
      </section>
    </div>
  );
}