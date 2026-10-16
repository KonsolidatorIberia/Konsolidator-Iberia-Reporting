/* ══════════════════════════════════════════════════════════════════════
   Centro de control (solo super-admins): empresas, usuarios y accesos.

   Estructura:
   Todo vive en src/auth/admin/:
     AdminPortal.jsx              → estructura, datos, inicio y listas (este archivo)
     CompanyDrawer.jsx            → ficha de empresa
     UserDrawer.jsx               → ficha de usuario
     adminShared.jsx              → datos fijos, utilidades y piezas comunes
     ActivityView.jsx             → actividad y coste por cliente
     ActivityParts.jsx            → gráfico, ficha de actividad y ajustes de costes
     costModel.js                 → reparto de la factura de Supabase
     adminText.js                 → textos (en / es / da)
     AdminPortal.module.css       → estilos
     Activity.module.css          → estilos de Actividad
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Building2, Users, Activity, LogOut, Search, Plus, Settings2, RefreshCw, MoreHorizontal,
  Edit2, Trash2, ArrowUp, ArrowDown, Crown, X, Command, CornerDownLeft, Check, UserPlus,
  LayoutDashboard, ChevronRight, Hourglass, UserX, ZapOff, CheckCircle2, Wallet, Clock,
} from "lucide-react";
import { supabase, sbAccounts } from "../../lib/supabaseClient";
import { LOCALES } from "../../lib/i18n";
import ProgressLoader from "../../components/framework/ProgressLoader.jsx";
import {
  cx, TIERS, tierConfig, USER_KINDS, userKind, trialInfo, trialLabel, fmtDate, Avatar, TierChip, toneFor,
  Menu, MenuItem, ConfirmDialog, useToasts, Toaster, callAdminFunction, deleteUsers,
} from "./adminShared.jsx";
import { makeText } from "./adminText.js";
import CompanyDrawer from "./CompanyDrawer.jsx";
import UserDrawer from "./UserDrawer.jsx";
import ActivityView, { useUsageData, rangeFor } from "./ActivityView.jsx";
import { METRICS } from "./ActivityParts.jsx";
import { computeCosts, dailySeries, fmtMoney, fmtInt, fmtDuration } from "./costModel.js";
import s from "./AdminPortal.module.css";

// Clave nueva para cada ficha de alta (así siempre empieza vacía)
let drawerSeq = 0;
const newKey = () => `new-${++drawerSeq}`;

const readLocale = () => { try { return localStorage.getItem("admin_locale") ?? "en"; } catch { return "en"; } };

// Secciones: van en la URL (/admin?view=users). El Inicio es /admin a secas.
// Desde el Inicio se entra a una sección añadiendo un paso al historial; entre
// secciones se sustituye. Así "Atrás" del navegador siempre vuelve al Inicio.
const VIEWS = ["companies", "users", "activity", "settings"];

// Cierre de sesión por inactividad
const IDLE_MS = 5 * 60 * 1000;   // 5 minutos sin tocar nada → fuera
const IDLE_WARN_MS = 60 * 1000;  // el último minuto se avisa con cuenta atrás
const IDLE_KEY = "admin_last_activity";   // compartido entre pestañas
const IDLE_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];

const fmtClock = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

// Devuelve los ms que quedan cuando falta menos de un minuto (si no, null) y
// llama a onTimeout al llegar a cero. Cualquier ratón, tecla o scroll —en
// esta pestaña o en otra del panel— vuelve a empezar la cuenta.
function useIdleTimer(enabled, onTimeout) {
  const [left, setLeft] = useState(null);
  const last = useRef(0);
  const cb = useRef(onTimeout);
  useEffect(() => { cb.current = onTimeout; });

  useEffect(() => {
    if (!enabled) return undefined;
    let lastWrite = 0;
    let fired = false;
    const mark = () => {
      const t = Date.now();
      last.current = t;
      if (t - lastWrite > 5000) {
        lastWrite = t;
        try { localStorage.setItem(IDLE_KEY, String(t)); } catch { /* sin almacenamiento */ }
      }
    };
    const check = () => {
      if (fired) return;
      let shared = 0;
      try { shared = Number(localStorage.getItem(IDLE_KEY)) || 0; } catch { /* sin almacenamiento */ }
      const rest = IDLE_MS - (Date.now() - Math.max(last.current, shared));
      if (rest <= 0) { fired = true; setLeft(null); cb.current(); return; }
      setLeft(rest <= IDLE_WARN_MS ? rest : null);
    };
    const onActivity = () => { mark(); setLeft(null); };
    // Al volver de otra pestaña o de suspender el ordenador se comprueba al momento
    const onWake = () => { if (document.visibilityState === "visible") check(); };
    mark();
    IDLE_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    const id = setInterval(check, 1000);
    return () => {
      IDLE_EVENTS.forEach(e => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(id);
    };
  }, [enabled]);
  return left;
}

export default function AdminPortal() {
  const navigate = useNavigate();
  const location = useLocation();
  const viewParam = new URLSearchParams(location.search).get("view");
  const tab = VIEWS.includes(viewParam) ? viewParam : "home";
  const fromHome = !!location.state?.fromHome;
  const [me, setMe] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [allLinks, setAllLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [now] = useState(() => Date.now());

  const [locale, setLocale] = useState(readLocale);
  useEffect(() => { try { localStorage.setItem("admin_locale", locale); } catch { /* sin almacenamiento */ } }, [locale]);
  const tx = useMemo(() => makeText(locale), [locale]);

  const { toasts, show: toast, dismiss } = useToasts();

  // ── Acceso: solo super-admins ──
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/"); return; }
      const { data: userRow } = await sbAccounts.from("users").select("*").eq("id", session.user.id).single();
      if (!userRow?.is_super_admin) { navigate("/"); return; }
      setMe(userRow);
    })();
  }, [navigate]);

  // ── Datos ──
  const fetchAll = useCallback(() => Promise.all([
    sbAccounts.from("companies_with_user_count").select("*").order("created_at", { ascending: false }),
    sbAccounts.from("users").select("*").order("created_at", { ascending: false }),
    sbAccounts.from("user_companies").select("*"),
  ]), []);
  const apply = useCallback(([{ data: cos }, { data: us }, { data: links }]) => {
    setCompanies(cos ?? []);
    setUsers(us ?? []);
    setAllLinks(links ?? []);
    setLoading(false);
    setLoadedOnce(true);
    setDataVersion(v => v + 1);
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    apply(await fetchAll());
  }, [fetchAll, apply]);
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    fetchAll().then(res => { if (!cancelled) apply(res); });
    return () => { cancelled = true; };
  }, [me, fetchAll, apply]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  // ── Inactividad: a los 5 minutos, fuera (solo esta sesión del navegador) ──
  const idleLeft = useIdleTimer(!!me, async () => {
    await supabase.auth.signOut({ scope: "local" });
    navigate("/", { replace: true });
  });

  // ── Navegación entre secciones (con el historial del navegador) ──
  const goTo = (view) => {
    if (view === tab) return;
    const pathname = location.pathname;
    if (view === "home") {
      if (fromHome) navigate(-1);                               // deshace el paso que añadimos
      else navigate({ pathname, search: "" }, { replace: true });
      return;
    }
    navigate({ pathname, search: `?view=${view}` },
      tab === "home" ? { state: { fromHome: true } } : { replace: true, state: { fromHome } });
  };
  // Si se entra directamente a una sección (enlace o recarga sin historial),
  // se pone el Inicio debajo para que "Atrás" lleve allí
  const entryFixed = useRef(false);
  useEffect(() => {
    if (entryFixed.current) return;
    entryFixed.current = true;
    if (tab !== "home" && !fromHome) {
      navigate({ pathname: location.pathname, search: "" }, { replace: true });
      navigate({ pathname: location.pathname, search: `?view=${tab}` }, { state: { fromHome: true } });
    }
  }, [tab, fromHome, navigate, location.pathname]);

  // ── Fichas abiertas ──
  const [companyDrawer, setCompanyDrawer] = useState(null);   // { company | null }
  const [userDrawer, setUserDrawer] = useState(null);         // { user | null, layer }
  const openCompany = (company) => setCompanyDrawer({ company: company ?? null, key: company?.id ?? newKey() });
  const openUser = (user, layer = 0) => setUserDrawer({ user: user ?? null, layer, key: user?.id ?? newKey() });

  const usersEnriched = useMemo(() => {
    const coById = new Map(companies.map(c => [c.id, c]));
    return users.map(u => {
      const links = allLinks.filter(l => l.user_id === u.id);
      return { ...u, _company_links: links, _company_names: links.map(l => coById.get(l.company_id)?.name).filter(Boolean) };
    });
  }, [users, companies, allLinks]);

  // ── Borrados (con confirmación) ──
  const [confirm, setConfirm] = useState(null);   // { kind: "company" | "user", item }
  const [busy, setBusy] = useState(false);
  const runConfirm = async () => {
    setBusy(true);
    if (confirm.kind === "company") {
      const c = confirm.item;
      const r = await callAdminFunction("delete-company", { company_id: c.id });
      setBusy(false);
      if (r.sessionExpired) { toast("error", tx("adm_session_expired")); return; }
      if (!r.ok) { toast("error", r.network ? `${tx("adm_network_error")}: ${r.error}` : r.error); return; }
      toast("success", tx("company_deleted_detail", { name: c.name, a: r.result?.users_deleted ?? 0, b: r.result?.users_unlinked ?? 0 }));
      setConfirm(null);
      setCompanyDrawer(d => (d?.company?.id === c.id ? null : d));
      reload();
    } else {
      const u = confirm.item;
      const { done, sessionExpired } = await deleteUsers([u.id]);
      setBusy(false);
      if (sessionExpired) { toast("error", tx("adm_session_expired")); return; }
      if (!done.length) { toast("error", tx("adm_network_error")); return; }
      toast("success", tx("adm_user_deleted"));
      setConfirm(null);
      reload();
    }
  };

  // ── Paleta de búsqueda (Ctrl/⌘ + K) ──
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(p => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const booting = !me || !loadedOnce;
  const [costOpen, setCostOpen] = useState(false);

  // Al volver al Inicio (también con "Atrás") se cierra lo que hubiera abierto
  const [prevTab, setPrevTab] = useState(tab);
  if (prevTab !== tab) {
    setPrevTab(tab);
    if (tab === "home") {
      setCompanyDrawer(null); setUserDrawer(null); setConfirm(null); setPalette(false); setCostOpen(false);
    }
  }
  const NAV = [
    { id: "home",      label: tx("home_title"),    icon: LayoutDashboard },
    { id: "companies", label: tx("adm_companies"), icon: Building2, count: companies.length },
    { id: "users",     label: tx("adm_users"),     icon: Users,     count: users.length },
    { id: "activity",  label: tx("adm_activity"),  icon: Activity },
    { id: "settings",  label: tx("adm_settings"),  icon: Settings2 },
  ];
  const page = {
    home:      { title: tx("home_title"),    sub: tx("home_sub") },
    companies: { title: tx("adm_companies"), sub: tx("adm_companies_sub"), cta: tx("adm_new_company"), onCta: () => openCompany(null) },
    users:     { title: tx("adm_users"),     sub: tx("adm_users_sub"),     cta: tx("adm_new_user"),    onCta: () => openUser(null) },
    activity:  { title: tx("adm_activity"),  sub: tx("act_sub"), cta: tx("act_cost_settings"), ctaIcon: Settings2, onCta: () => setCostOpen(true) },
    settings:  { title: tx("adm_settings"),  sub: tx("adm_settings_sub") },
  }[tab];

  return (
    <div className={s.root}>
      <ProgressLoader fixed visible={booting}
        title={!me ? tx("checking_access") : tx("loading_data")}
        subtitle={tx("adm_control_center")}
        steps={[
          { key: "session", label: tx("step_session"), weight: 1, state: me ? "done" : "active" },
          { key: "data", label: tx("step_data"), weight: 3, state: !me ? "pending" : loadedOnce ? "done" : "active" },
        ]} />

      {/* ── Barra lateral ── */}
      <aside className={s.rail}>
        <div className={s.brand}>
          <span className={s.brandMark}><img src="/favicon.svg" alt="" /></span>
          <span className={s.brandText}>
            <strong>Next Reporting</strong>
            <small>{tx("adm_control_center")}</small>
          </span>
        </div>

        <nav className={s.nav} aria-label={tx("adm_control_center")}>
          {NAV.map(n => (
            <button key={n.id} type="button" disabled={n.disabled} aria-current={tab === n.id ? "page" : undefined}
              className={cx(s.navItem, tab === n.id && s.navOn)} onClick={() => !n.disabled && goTo(n.id)}
              title={n.label}>
              <n.icon size={18} />
              <span className={s.navLabel}>{n.label}</span>
              {n.disabled ? <span className={s.navSoon}>{tx("adm_soon")}</span>
                : n.count != null && loadedOnce ? <span className={s.navCount}>{n.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className={s.railFoot}>
          {me ? (
            <div className={s.meCard} title={me.email}>
              <Avatar label={me.username || me.email} tone="#e8a317" size={34} square={false} />
              <span className={s.meText}>
                <small>{tx("signed_in_as")}</small>
                <strong>{me.username || me.email}</strong>
              </span>
            </div>
          ) : null}
          <button type="button" className={s.logout} onClick={handleLogout} title={tx("adm_logout")}>
            <LogOut size={16} /> <span className={s.navLabel}>{tx("adm_logout")}</span>
          </button>
        </div>
      </aside>

      {/* ── Contenido ── */}
      {/* En Empresas y Usuarios la cabecera, la barra y los filtros quedan fijos:
          solo se desplaza la lista (con su cabecera de columnas fija) */}
      <main className={cx(s.main, (tab === "companies" || tab === "users") && s.mainFixed, tab === "home" && s.mainHome)}>
        <div className={cx(s.topProgress, loading && loadedOnce && s.topProgressOn)} aria-hidden="true" />
        <header className={s.pageHead}>
          <div className={s.pageTitle}>
            <h1>{page.title}</h1>
            <p>{page.sub}</p>
          </div>
          <div className={s.pageActions}>
            <button type="button" className={s.searchTrigger} onClick={() => setPalette(true)}>
              <Search size={15} />
              <span>{tx("search_all")}</span>
              <kbd><Command size={11} />K</kbd>
            </button>
            <button type="button" className={s.iconBtn} onClick={reload} aria-label={tx("refresh")} title={tx("refresh")} disabled={loading}>
              <RefreshCw size={16} className={loading && loadedOnce ? s.spin : undefined} />
            </button>
            {page.cta ? (
              <button type="button" className={s.btnPrimary} onClick={page.onCta}>
                {page.ctaIcon ? <page.ctaIcon size={15} /> : <Plus size={15} strokeWidth={2.6} />} <span>{page.cta}</span>
              </button>
            ) : null}
          </div>
        </header>

        {tab === "home" && (
          <HomeView companies={companies} users={usersEnriched} loading={!loadedOnce} tx={tx} locale={locale} now={now}
            onGo={goTo}
            onOpenCompany={(c) => { goTo("companies"); openCompany(c); }}
            onOpenUser={(u) => { goTo("users"); openUser(u); }} />
        )}
        {tab === "companies" && (
          <CompaniesView companies={companies} loading={!loadedOnce} tx={tx} locale={locale} now={now}
            onOpen={openCompany} onDelete={(c) => setConfirm({ kind: "company", item: c })}
            onAddUser={(c) => { openCompany(c); setTimeout(() => openUser({ _company_links: [{ company_id: c.id, is_default: true, is_active: true }], _prefilled_company: c }, 1), 60); }} />
        )}
        {tab === "users" && (
          <UsersView users={usersEnriched} loading={!loadedOnce} tx={tx} locale={locale}
            onOpen={(u) => openUser(u)} onDelete={(u) => setConfirm({ kind: "user", item: u })} />
        )}
        {tab === "activity" && loadedOnce && (
          <ActivityView companies={companies} tx={tx} locale={locale} now={now} toast={toast}
            costOpen={costOpen} setCostOpen={setCostOpen} onOpenCompany={(c) => openCompany(c)} />
        )}
        {tab === "settings" && <SettingsView locale={locale} setLocale={setLocale} tx={tx} />}
      </main>

      {/* ── Fichas ── */}
      {companyDrawer && (
        <CompanyDrawer key={companyDrawer.key} company={companyDrawer.company} dataVersion={dataVersion}
          tx={tx} locale={locale} now={now} toast={toast} onSaved={reload}
          onClose={() => setCompanyDrawer(null)}
          onEditUser={(u) => openUser({ ...u, ...(usersEnriched.find(x => x.id === u.id) ?? {}), _company_links: allLinks.filter(l => l.user_id === u.id) }, 1)}
          onAddUser={(co) => openUser({ _company_links: [{ company_id: co.id, is_default: true, is_active: true }], _prefilled_company: co }, 1)}
          onDelete={(c) => setConfirm({ kind: "company", item: c })} />
      )}
      {userDrawer && (
        <UserDrawer key={userDrawer.key} user={userDrawer.user} companies={companies} allUsers={users} allLinks={allLinks}
          layer={companyDrawer ? 1 : 0} tx={tx} toast={toast} onSaved={reload}
          onClose={() => setUserDrawer(null)} />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "company" ? tx("delete_company_title", { name: confirm.item.name }) : tx("delete_user_title", { name: confirm.item.username || confirm.item.email })}
          body={confirm.kind === "company" ? tx("delete_company_body") : tx("delete_user_body")}
          requireText={confirm.kind === "company" ? confirm.item.slug : null}
          requireLabel={confirm.kind === "company" ? tx("type_to_confirm", { slug: confirm.item.slug }) : null}
          confirmLabel={tx("delete")} cancelLabel={tx("adm_cancel")} busy={busy}
          onConfirm={runConfirm} onCancel={() => setConfirm(null)} />
      )}

      {palette && (
        <CommandPalette companies={companies} users={usersEnriched} tx={tx}
          onClose={() => setPalette(false)}
          onCompany={(c) => { setPalette(false); goTo("companies"); openCompany(c); }}
          onUser={(u) => { setPalette(false); goTo("users"); openUser(u); }}
          onNewCompany={() => { setPalette(false); goTo("companies"); openCompany(null); }}
          onNewUser={() => { setPalette(false); goTo("users"); openUser(null); }} />
      )}

      {idleLeft != null && (
        <div className={s.idleWarn} role="alertdialog" aria-live="assertive" aria-labelledby="idle-title">
          <span className={s.idleClock}><Clock size={18} /></span>
          <span className={s.idleText}>
            <strong id="idle-title">{tx("idle_title")}</strong>
            <small>{tx("idle_body", { s: fmtClock(idleLeft) })}</small>
          </span>
          {/* El clic ya cuenta como actividad; el botón solo lo hace evidente */}
          <button type="button" className={s.idleStay}>{tx("idle_stay")}</button>
        </div>
      )}

      <Toaster toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Inicio: resumen de empresas, usuarios y actividad
// Ocupa justo la pantalla: cifras arriba y cuatro paneles; si una lista es
// larga, se desplaza solo esa lista. Estilos propios (home*) en
// AdminPortal.module.css: no depende de los de Actividad.
// ════════════════════════════════════════════════════════════════════════
const isSince = (at, t) => !!at && new Date(at).getTime() >= t;
const dayIso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shortDay = (day, locale) => new Date(`${day}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });

function HomeView({ companies, users, loading, tx, locale, now, onGo, onOpenCompany, onOpenUser }) {
  // Actividad y coste de los últimos 30 días (los mismos datos que Actividad)
  const { from, to } = useMemo(() => rangeFor("30", now), [now]);
  const [usage] = useUsageData(from, to);
  const model = useMemo(() => (usage.rows && !usage.missing ? computeCosts({
    companies, rows: usage.rows, platformRows: usage.platformRows, activeUsers: usage.activeUsers, settings: usage.settings, from, to,
  }) : null), [companies, usage, from, to]);
  const usageLoading = !usage.key;

  const monthStart = useMemo(() => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }, [now]);

  const co = useMemo(() => {
    const info = companies.map(c => ({ c, info: trialInfo(c, now) }));
    return {
      info,
      paid: info.filter(x => x.info.kind === "paid").length,
      trial: info.filter(x => x.info.kind === "trial").length,
      fresh: companies.filter(c => isSince(c.created_at, monthStart)).length,
      tiers: TIERS.map(t => ({ id: t.id, label: t.label, color: t.color, value: companies.filter(c => c.tier === t.id).length })),
    };
  }, [companies, now, monthStart]);
  const us = useMemo(() => ({
    active: users.filter(u => u.is_active).length,
    fresh: users.filter(u => isSince(u.created_at, monthStart)).length,
    kinds: USER_KINDS.map(k => ({ id: k.id, label: tx(k.labelKey), color: k.color, value: users.filter(u => userKind(u) === k.id).length })),
  }), [users, monthStart, tx]);

  // Totales y serie diaria de actividad (todas las empresas)
  const act = useMemo(() => {
    if (!model) return null;
    const sums = model.clients.reduce((acc, c) => ({
      users: acc.users + c.active_users, logins: acc.logins + c.logins, seconds: acc.seconds + c.active_seconds, pages: acc.pages + c.page_views,
    }), { users: 0, logins: 0, seconds: 0, pages: 0 });
    // Primer día con actividad registrada: si el seguimiento es reciente, aún
    // no tiene sentido avisar de "sin actividad en 30 días"
    let first = null;
    for (const r of usage.rows ?? []) {
      const d = String(r.day).slice(0, 10);
      if ((Number(r.sessions) || Number(r.active_seconds) || Number(r.logins)) && (!first || d < first)) first = d;
    }
    return { ...sums, first };
  }, [model, usage.rows]);
  const trackingSettled = !!act?.first && act.first <= dayIso(now - 7 * 86400000);

  // ── Requiere atención ──
  const attention = useMemo(() => {
    const out = [];
    const listed = new Set();
    const ended = co.info.filter(x => x.info.kind === "trial" && x.info.ended).sort((x, y) => y.info.days - x.info.days);
    const soon = co.info.filter(x => x.info.soon).sort((x, y) => x.info.days - y.info.days);
    for (const { c, info } of [...ended, ...soon]) {
      listed.add(c.id);
      out.push({ key: `t-${c.id}`, icon: Hourglass, tone: info.ended ? "red" : "amber", name: c.name, detail: trialLabel(info, tx), open: () => onOpenCompany(c) });
    }
    for (const c of companies) {
      if (listed.has(c.id) || (c.active_user_count ?? 0) > 0) continue;
      listed.add(c.id);
      out.push({ key: `n-${c.id}`, icon: UserX, tone: "mute", name: c.name, detail: tx("home_no_active"), open: () => onOpenCompany(c) });
    }
    if (model && trackingSettled) {
      for (const cl of model.clients) {
        if (listed.has(cl.company.id) || cl.lastActive || (cl.company.active_user_count ?? 0) === 0) continue;
        out.push({ key: `q-${cl.company.id}`, icon: ZapOff, tone: "mute", name: cl.company.name, detail: tx("home_quiet"), open: () => onOpenCompany(cl.company) });
      }
    }
    for (const u of users) {
      if (userKind(u) !== "none") continue;
      out.push({ key: `u-${u.id}`, icon: UserX, tone: "mute", name: u.username || u.email, detail: tx("home_no_company"), open: () => onOpenUser(u) });
    }
    return out;
  }, [co, companies, users, model, trackingSettled, tx, onOpenCompany, onOpenUser]);

  // ── Clientes más activos y últimas altas ──
  const top = useMemo(() => (model ? [...model.clients].filter(c => c.active_seconds > 0)
    .sort((x, y) => y.active_seconds - x.active_seconds).slice(0, 8) : []), [model]);
  const topMax = Math.max(1, ...top.map(c => c.active_seconds));
  const recent = useMemo(() => [
    ...companies.map(c => ({ kind: "company", item: c, at: c.created_at })),
    ...users.map(u => ({ kind: "user", item: u, at: u.created_at })),
  ].filter(x => x.at).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 12), [companies, users]);

  // Serie de usuarios activos para la mini gráfica de la cifra
  const activeSeries = useMemo(() => {
    if (!model) return [];
    const sum = new Map();
    for (const c of model.clients) for (const [day, r] of c.daily) sum.set(day, (sum.get(day) ?? 0) + (Number(r.active_users) || 0));
    return dailySeries(sum, from, to, v => v).map(p => p.value);
  }, [model, from, to]);

  const cur = model?.cfg.currency ?? "USD";
  const plan = model?.cfg.auto?.plan;
  const kpis = [
    { id: "companies", icon: Building2, label: tx("adm_companies"), value: fmtInt(companies.length, locale),
      foot: tx("home_companies_foot", { paid: co.paid, trial: co.trial }), delta: co.fresh, go: "companies",
      visual: <MiniStack parts={co.tiers} /> },
    { id: "users", icon: Users, label: tx("adm_users"), value: fmtInt(users.length, locale),
      foot: tx("home_users_foot", { a: us.active, i: users.length - us.active }), delta: us.fresh, go: "users",
      visual: <MiniStack parts={us.kinds} /> },
    { id: "active", icon: Activity, label: tx("home_active_users"), hint: tx("home_last_30"),
      value: act ? fmtInt(act.users, locale) : "—",
      foot: act ? tx("home_active_foot", { l: fmtInt(act.logins, locale), t: fmtDuration(act.seconds, locale) }) : tx("home_no_activity"),
      go: "activity", pending: usageLoading, visual: <Spark values={activeSeries} /> },
    { id: "cost", icon: Wallet, label: tx("home_cost"), hint: tx("act_per_month"),
      value: model ? fmtMoney(model.bill.total, cur, locale) : "—",
      foot: model ? tx("home_cost_foot", { v: fmtMoney(model.bill.total / Math.max(1, companies.length), cur, locale) }) : tx("home_no_activity"),
      go: "activity", pending: usageLoading,
      visual: plan ? <span className={s.homePlan}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</span> : null },
  ];

  return (
    <div className={cx(s.view, s.homeView)}>
      <div className={s.homeKpis}>
        {kpis.map((k, i) => (
          <button key={k.id} type="button" className={cx(s.kpi, (loading || k.pending) && s.kpiLoading)}
            style={{ animationDelay: `${i * 60}ms` }} onClick={() => onGo(k.go)}>
            <span className={s.kpiHead}>
              <span className={s.kpiIcon}><k.icon size={15} /></span>
              <span className={s.kpiLabel}>{k.label}</span>
              {k.hint ? <span className={s.kpiHint}>{k.hint}</span> : null}
              <ChevronRight size={15} className={s.kpiGo} />
            </span>
            <span className={s.kpiMid}>
              <strong className={s.kpiValue}>{loading || k.pending ? "—" : k.value}</strong>
              {!loading && !k.pending ? <span className={s.kpiVisual}>{k.visual}</span> : null}
            </span>
            <span className={s.kpiFoot}>
              {!loading && k.delta > 0 ? <b className={s.kpiDelta}>{tx("home_new_month", { n: k.delta })}</b> : null}
              <small>{loading ? " " : k.foot}</small>
            </span>
          </button>
        ))}
      </div>

      <div className={s.homeBoard}>
        <HomeCard className={s.areaChart} title={tx("act_daily")} hint={tx("home_last_30")}
          action={<button type="button" className={s.homeLink} onClick={() => onGo("activity")}>{tx("home_view_all")} <ChevronRight size={13} /></button>}>
          {usageLoading ? <div className={s.homeSkel} /> : !model ? (
            <HomeEmpty icon={Activity} title={tx("home_no_activity")} />
          ) : (
            <HomeChart model={model} from={from} to={to} tx={tx} locale={locale} totals={act} />
          )}
        </HomeCard>

        <HomeCard className={s.areaTop} title={tx("home_top_clients")} hint={tx("home_last_30")}>
          {usageLoading ? <div className={s.homeSkel} /> : !top.length ? (
            <HomeEmpty icon={Clock} title={tx("home_top_empty")} />
          ) : (
            <ol className={s.homeList}>
              {top.map((c, i) => (
                <li key={c.company.id}>
                  <button type="button" className={s.homeRow} onClick={() => onOpenCompany(c.company)}>
                    <span className={s.homeRank}>{i + 1}</span>
                    <span className={s.homeRowText}>
                      <strong>{c.company.name}</strong>
                      <span className={s.homeBar}><span style={{ width: `${Math.max(3, (c.active_seconds / topMax) * 100)}%` }} /></span>
                    </span>
                    <span className={s.homeNums}>
                      <b>{fmtDuration(c.active_seconds, locale)}</b>
                      <small>{c.active_users === 1 ? tx("home_users_1") : tx("home_users_n", { n: fmtInt(c.active_users, locale) })}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </HomeCard>

        <HomeCard className={s.areaAttention} title={tx("home_attention")}
          badge={attention.length ? attention.length : null}>
          {loading ? <div className={s.homeSkel} /> : attention.length === 0 ? (
            <HomeEmpty icon={CheckCircle2} tone="ok" title={tx("home_all_good")} hint={tx("home_all_good_hint")} />
          ) : (
            <ul className={s.homeList}>
              {attention.map(x => (
                <li key={x.key}>
                  <button type="button" className={s.homeRow} onClick={x.open}>
                    <span className={cx(s.homeDot, s[`tone_${x.tone}`])}><x.icon size={15} /></span>
                    <span className={s.homeRowText}><strong>{x.name}</strong><small>{x.detail}</small></span>
                    <ChevronRight size={15} className={s.homeChevron} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </HomeCard>

        <HomeCard className={s.areaRecent} title={tx("home_recent")}>
          {loading ? <div className={s.homeSkel} /> : (
            <ul className={s.homeList}>
              {recent.map(x => {
                const isCo = x.kind === "company";
                const name = isCo ? x.item.name : (x.item.username || x.item.email);
                return (
                  <li key={`${x.kind}-${x.item.id}`}>
                    <button type="button" className={s.homeRow} onClick={() => (isCo ? onOpenCompany(x.item) : onOpenUser(x.item))}>
                      <Avatar label={name} tone={isCo ? "#1a2f8a" : toneFor(x.item.email ?? name)} size={32} square={isCo} />
                      <span className={s.homeRowText}>
                        <strong>{name}</strong>
                        <small>{isCo ? (x.item.slug ?? "") : (x.item._company_names?.[0] ?? x.item.email)}</small>
                      </span>
                      <span className={s.homeNums}>
                        <span className={cx(s.homeKind, isCo && s.homeKindCo)}>{tx(isCo ? "home_kind_company" : "home_kind_user")}</span>
                        <small>{fmtDate(x.at, locale)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </HomeCard>
      </div>
    </div>
  );
}

function HomeCard({ className, title, hint, badge, action, children }) {
  return (
    <section className={cx(s.homeCard, className)}>
      <header className={s.homeCardHead}>
        <h3>{title}</h3>
        {hint ? <span className={s.homeHint}>{hint}</span> : null}
        {badge != null ? <span className={s.homeBadge}>{badge}</span> : null}
        {action ? <span className={s.homeAction}>{action}</span> : null}
      </header>
      <div className={s.homeBody}>{children}</div>
    </section>
  );
}

function HomeEmpty({ icon: Icon, title, hint, tone }) {
  return (
    <div className={cx(s.homeEmpty, tone === "ok" && s.homeEmptyOk)}>
      <span><Icon size={20} /></span>
      <strong>{title}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

// Barra apilada pequeña (niveles de empresa, tipos de usuario)
function MiniStack({ parts }) {
  const total = parts.reduce((acc, p) => acc + p.value, 0);
  if (!total) return null;
  return (
    <span className={s.miniStack} aria-hidden="true">
      {parts.filter(p => p.value > 0).map(p => (
        <i key={p.id} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />
      ))}
    </span>
  );
}

// Mini gráfica de línea (sin ejes): solo la forma de los últimos 30 días
function Spark({ values }) {
  const max = Math.max(0, ...values);
  if (!values.length || max <= 0) return null;
  const W = 120, H = 34;
  const pts = values.map((v, i) => [values.length === 1 ? W : (i / (values.length - 1)) * W, max > 0 ? H - 3 - (v / max) * (H - 6) : H - 3]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${H} ${line} ${W},${H}`} className={s.sparkArea} />
      <polyline points={line} className={s.sparkLine} />
    </svg>
  );
}

// Gráfico de barras diario: una serie, un eje, valor al pasar el ratón
function HomeChart({ model, from, to, tx, locale, totals }) {
  const [metric, setMetric] = useState("active_users");
  const [hover, setHover] = useState(null);
  const m = METRICS.find(x => x.id === metric);
  const series = useMemo(() => {
    const sum = new Map();
    for (const c of model.clients) for (const [day, r] of c.daily) sum.set(day, (sum.get(day) ?? 0) + m.pick(r));
    return dailySeries(sum, from, to, v => v);
  }, [model, from, to, m]);
  const max = Math.max(0, ...series.map(p => p.value));
  // Tope "redondo" para la escala (1, 2, 5, 10, 20, 50…)
  // (siempre par, para que la línea del medio sea un número entero)
  const nice = (() => {
    if (max <= 0) return 2;
    const unit = metric === "active_seconds" ? 3600 : 1;
    const v = max / unit;
    const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
    return Math.max(2, [1, 2, 4, 6, 8, 10].map(k => k * p).find(x => x >= v) ?? 10 * p) * unit;
  })();
  const fmt = (v) => m.fmt(v, locale);
  const n = series.length;
  const hp = hover != null ? series[hover] : null;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className={s.hChart}>
      <div className={s.hChartTop}>
        <div className={s.hStats}>
          <span><b>{fmtInt(totals.users, locale)}</b>{tx("act_m_users").toLowerCase()}</span>
          <span><b>{fmtInt(totals.logins, locale)}</b>{tx("act_m_logins").toLowerCase()}</span>
          <span><b>{fmtDuration(totals.seconds, locale)}</b>{tx("act_m_time").toLowerCase()}</span>
          <span><b>{fmtInt(totals.pages, locale)}</b>{tx("act_m_pages").toLowerCase()}</span>
        </div>
        <div className={s.hMetrics} role="radiogroup" aria-label={tx("act_daily")}>
          {METRICS.map(x => (
            <button key={x.id} type="button" role="radio" aria-checked={metric === x.id}
              className={cx(s.hMetric, metric === x.id && s.hMetricOn)} onClick={() => setMetric(x.id)}>{tx(x.labelKey)}</button>
          ))}
        </div>
      </div>

      <div className={s.hPlotWrap}>
        <div className={s.hYAxis} aria-hidden="true">
          {max > 0 ? <><span>{fmt(nice)}</span><span>{fmt(nice / 2)}</span><span>0</span></> : null}
        </div>
        <div className={s.hPlot} onMouseLeave={() => setHover(null)}>
          <i className={s.hGrid} style={{ top: 0 }} /><i className={s.hGrid} style={{ top: "50%" }} /><i className={cx(s.hGrid, s.hGridBase)} style={{ top: "100%" }} />
          <div className={s.hBars}>
            {series.map((p, i) => (
              <span key={p.day} className={s.hBarCol} onMouseEnter={() => setHover(i)}>
                <span className={cx(s.hBar, hover != null && hover !== i && s.hBarDim)}
                  style={{ height: `${(p.value / nice) * 100}%`, animationDelay: `${i * 12}ms` }} />
              </span>
            ))}
          </div>
          {max <= 0 ? (
            <div className={s.hNoData}><strong>{tx("home_chart_empty")}</strong><small>{tx("home_chart_empty_hint")}</small></div>
          ) : null}
          {hp ? (
            <div className={s.hTip} style={{ left: `clamp(56px, ${((hover + 0.5) / n) * 100}%, calc(100% - 56px))`, top: `${(1 - hp.value / nice) * 100}%` }}>
              <small>{new Date(`${hp.day}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}</small>
              <strong>{fmt(hp.value)}</strong>
            </div>
          ) : null}
        </div>
        <div className={s.hXAxis} aria-hidden="true">
          {ticks.map((t, k) => (
            <span key={k} style={{ left: `${((t + 0.5) / n) * 100}%` }} className={k === 0 ? s.hXFirst : k === 2 ? s.hXLast : undefined}>
              {shortDay(series[t].day, locale)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Barra de composición: cada tramo es un filtro
// ════════════════════════════════════════════════════════════════════════
function CompositionBar({ title, total, totalLabel, segments, active, onPick, extra }) {
  return (
    <section className={s.compo}>
      <div className={s.compoHead}>
        <h2>{title}</h2>
        <p><strong>{total}</strong> {totalLabel}</p>
      </div>
      <div className={s.compoBar} role="group" aria-label={title}>
        {segments.filter(sg => sg.value > 0).map((sg, i) => (
          <button key={sg.id} type="button" title={`${sg.label}: ${sg.value}`}
            className={cx(s.compoSeg, active && active !== sg.id && s.compoSegDim, active === sg.id && s.compoSegOn)}
            style={{ "--seg": sg.color, flexGrow: sg.value, animationDelay: `${i * 70}ms` }}
            onClick={() => onPick(active === sg.id ? null : sg.id)} aria-pressed={active === sg.id}>
            <span>{sg.value}</span>
          </button>
        ))}
        {total === 0 ? <span className={s.compoEmpty} /> : null}
      </div>
      <div className={s.compoLegend}>
        {segments.map(sg => (
          <button key={sg.id} type="button" className={cx(s.legendItem, active === sg.id && s.legendOn, sg.value === 0 && s.legendZero)}
            style={{ "--seg": sg.color }} onClick={() => onPick(active === sg.id ? null : sg.id)} aria-pressed={active === sg.id}>
            <i />{sg.label}<b>{sg.value}</b>
          </button>
        ))}
        {extra}
      </div>
    </section>
  );
}

function FilterChips({ value, options, onChange }) {
  return (
    <div className={s.chipsRow} role="radiogroup">
      {options.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id}
          className={cx(s.filterChip, value === o.id && s.filterChipOn)} onClick={() => onChange(o.id)}>
          {o.dot ? <i className={s.pingDot} /> : null}
          {o.label}
          {o.count != null ? <b>{o.count}</b> : null}
        </button>
      ))}
    </div>
  );
}

function SortHead({ label, k, sort, setSort, className }) {
  const on = sort.key === k;
  return (
    <span role="columnheader" className={cx(s.thCell, className)} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={cx(s.th, s.thSort, on && s.thOn)}
        onClick={() => setSort(on ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" ? "asc" : "desc" })}>
        {label}
        {on ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
      </button>
    </span>
  );
}

function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon}><Icon size={22} /></span>
      <p>{title}</p>
      <small>{hint}</small>
      {action}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Empresas
// ════════════════════════════════════════════════════════════════════════
const TIER_ORDER = { low: 0, base: 1, pro: 2, max: 3 };

function CompaniesView({ companies, loading, tx, locale, now, onOpen, onDelete, onAddUser }) {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState(null);
  const [plan, setPlan] = useState("all");
  const [sort, setSort] = useState({ key: "created", dir: "desc" });
  const [menu, setMenu] = useState(null);   // { company, anchor }

  const withInfo = useMemo(() => companies.map(c => ({ c, info: trialInfo(c, now) })), [companies, now]);
  const counts = useMemo(() => ({
    trial: withInfo.filter(x => x.info.kind === "trial").length,
    soon: withInfo.filter(x => x.info.soon).length,
    ended: withInfo.filter(x => x.info.ended).length,
    paid: withInfo.filter(x => x.info.kind === "paid").length,
  }), [withInfo]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = withInfo.filter(({ c, info }) => {
      if (needle && !c.name.toLowerCase().includes(needle) && !(c.slug ?? "").toLowerCase().includes(needle)
        && !(c.country ?? "").toLowerCase().includes(needle)) return false;
      if (tier && c.tier !== tier) return false;
      if (plan === "trial" && info.kind !== "trial") return false;
      if (plan === "paid" && info.kind !== "paid") return false;
      if (plan === "soon" && !info.soon) return false;
      if (plan === "ended" && !info.ended) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = ({ c, info }) => {
      switch (sort.key) {
        case "name": return c.name.toLowerCase();
        case "tier": return TIER_ORDER[c.tier] ?? 1;
        case "plan": return info.kind === "paid" ? 1e6 : (info.days ?? 1e5);
        case "users": return c.active_user_count ?? 0;
        default: return c.created_at ?? "";
      }
    };
    return [...list].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
  }, [withInfo, q, tier, plan, sort]);

  const filtered = q || tier || plan !== "all";
  const clear = () => { setQ(""); setTier(null); setPlan("all"); };

  return (
    <div className={cx(s.view, s.listView)}>
      <CompositionBar
        title={tx("companies_by_tier")}
        total={companies.length}
        totalLabel={tx("adm_companies").toLowerCase()}
        segments={TIERS.map(ti => ({ id: ti.id, label: ti.label, color: ti.color, value: companies.filter(c => c.tier === ti.id).length }))}
        active={tier} onPick={setTier} />

      <div className={s.toolbar}>
        <div className={s.searchBox}>
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("adm_search_company")} />
          {q ? <button type="button" onClick={() => setQ("")} aria-label={tx("clear_filters")}><X size={13} /></button> : null}
        </div>
        <FilterChips value={plan} onChange={setPlan} options={[
          { id: "all", label: tx("adm_all"), count: companies.length },
          { id: "trial", label: tx("trial"), count: counts.trial },
          { id: "soon", label: tx("ending_soon"), count: counts.soon, dot: counts.soon > 0 },
          ...(counts.ended ? [{ id: "ended", label: tx("trial_ended"), count: counts.ended }] : []),
          { id: "paid", label: tx("adm_paid"), count: counts.paid },
        ]} />
        <span className={s.resultCount}>
          {rows.length} {tx("adm_of")} {companies.length}
          {filtered ? <button type="button" className={s.linkBtn} onClick={clear}>{tx("clear_filters")}</button> : null}
        </span>
      </div>

      <div className={s.tableWrap}>
        <div className={cx(s.table, s.coTable)} role="table">
          <div className={s.thead} role="row">
            <SortHead label={tx("col_company")} k="name" sort={sort} setSort={setSort} />
            <SortHead label={tx("col_tier")} k="tier" sort={sort} setSort={setSort} />
            <SortHead label={tx("col_plan")} k="plan" sort={sort} setSort={setSort} />
            <SortHead label={tx("adm_users_label")} k="users" sort={sort} setSort={setSort} />
            <span role="columnheader" className={cx(s.th, s.hideLg)}>{tx("col_country")}</span>
            <SortHead label={tx("adm_created")} k="created" sort={sort} setSort={setSort} className={s.hideMd} />
            <span role="columnheader" className={s.th} />
          </div>

          {loading ? (
            [0, 1, 2, 3, 4].map(i => <div key={i} className={s.skelLine} style={{ animationDelay: `${i * 90}ms` }} />)
          ) : rows.length === 0 ? (
            companies.length === 0
              ? <Empty icon={Building2} title={tx("adm_no_companies")} hint={tx("adm_no_companies_hint")}
                  action={<button type="button" className={s.btnPrimary} onClick={() => onOpen(null)}><Plus size={14} /> {tx("adm_new_company")}</button>} />
              : <Empty icon={Search} title={tx("nothing_found")} hint={tx("nothing_found_hint")}
                  action={<button type="button" className={s.btnGhost} onClick={clear}>{tx("clear_filters")}</button>} />
          ) : rows.map(({ c, info }) => {
            const tc = tierConfig(c.tier);
            const active = c.active_user_count ?? 0;
            const total = Math.max(c.total_user_count ?? active, active);
            return (
              <div key={c.id} role="row" tabIndex={0} className={s.tr} style={{ "--rowc": tc.color }}
                onClick={() => onOpen(c)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(c); }}>
                <span role="cell" className={cx(s.td, s.tdMain)}>
                  <Avatar label={c.name} tone="#1a2f8a" size={38} />
                  <span className={s.whoText}>
                    <strong>{c.name}</strong>
                    <small className={s.mono}>{c.slug}</small>
                  </span>
                </span>
                <span role="cell" className={cx(s.td, s.tdTier)}><TierChip tier={c.tier} /></span>
                <span role="cell" className={cx(s.td, s.tdPlan)}>
                  {info.kind === "paid" ? (
                    <span className={s.paid}><Check size={12} strokeWidth={3} /> {tx("adm_paid")}</span>
                  ) : (
                    <span className={cx(s.trialCell, info.ended && s.trialEnded, info.soon && s.trialSoon)}>
                      <span className={s.trialText}>
                        {info.soon ? <i className={s.pingDot} /> : null}
                        {trialLabel(info, tx)}
                      </span>
                      {info.pct != null ? <span className={s.trialBar}><span style={{ width: `${Math.round(info.pct * 100)}%` }} /></span> : null}
                    </span>
                  )}
                </span>
                <span role="cell" className={cx(s.td, s.tdUsers)}>
                  <strong>{active}</strong>{total > active ? <small>/{total}</small> : null}
                  <small className={s.mobileOnly}>{tx("adm_users_label").toLowerCase()}</small>
                  <span className={s.userDots} aria-hidden="true">
                    {Array.from({ length: Math.min(total, 8) }, (_, i) => <i key={i} className={i < active ? s.dotOn : undefined} />)}
                  </span>
                </span>
                <span role="cell" className={cx(s.td, s.hideLg, s.muted)}>{c.country ?? "—"}</span>
                <span role="cell" className={cx(s.td, s.hideMd, s.muted)}>{fmtDate(c.created_at, locale)}</span>
                <span role="cell" className={cx(s.td, s.tdAct)}>
                  <button type="button" className={s.iconBtnSm} aria-label={tx("more_actions")}
                    onClick={(e) => { e.stopPropagation(); setMenu(menu?.company.id === c.id ? null : { company: c, anchor: e.currentTarget }); }}>
                    <MoreHorizontal size={16} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {menu && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} width={210}>
          <MenuItem icon={Edit2} onClick={() => { setMenu(null); onOpen(menu.company); }}>{tx("edit")}</MenuItem>
          <MenuItem icon={UserPlus} onClick={() => { setMenu(null); onAddUser(menu.company); }}>{tx("add_user")}</MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => { setMenu(null); onDelete(menu.company); }}>{tx("delete")}</MenuItem>
        </Menu>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Usuarios
// ════════════════════════════════════════════════════════════════════════
const KIND_ORDER = { super: 0, consultant: 1, admin: 2, regular: 3, none: 4 };

function UsersView({ users, loading, tx, locale, onOpen, onDelete }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(null);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState({ key: "created", dir: "desc" });
  const [menu, setMenu] = useState(null);

  const withKind = useMemo(() => users.map(u => ({ u, kind: userKind(u) })), [users]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = withKind.filter(({ u, kind: k }) => {
      if (needle && !(u.email ?? "").toLowerCase().includes(needle) && !(u.username ?? "").toLowerCase().includes(needle)
        && !u._company_names.some(n => n.toLowerCase().includes(needle))) return false;
      if (kind && k !== kind) return false;
      if (status === "active" && !u.is_active) return false;
      if (status === "inactive" && u.is_active) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = ({ u, kind: k }) => {
      switch (sort.key) {
        case "name": return (u.username || u.email || "").toLowerCase();
        case "role": return KIND_ORDER[k];
        case "company": return (u._company_names[0] ?? "~").toLowerCase();
        case "status": return u.is_active ? 0 : 1;
        default: return u.created_at ?? "";
      }
    };
    return [...list].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
  }, [withKind, q, kind, status, sort]);

  const activeCount = users.filter(u => u.is_active).length;
  const filtered = q || kind || status !== "all";
  const clear = () => { setQ(""); setKind(null); setStatus("all"); };

  return (
    <div className={cx(s.view, s.listView)}>
      <CompositionBar
        title={tx("users_by_role")}
        total={users.length}
        totalLabel={tx("adm_users").toLowerCase()}
        segments={USER_KINDS.map(k => ({ id: k.id, label: tx(k.labelKey), color: k.color, value: withKind.filter(x => x.kind === k.id).length }))}
        active={kind} onPick={setKind} />

      <div className={s.toolbar}>
        <div className={s.searchBox}>
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("adm_search_user")} />
          {q ? <button type="button" onClick={() => setQ("")} aria-label={tx("clear_filters")}><X size={13} /></button> : null}
        </div>
        <FilterChips value={status} onChange={setStatus} options={[
          { id: "all", label: tx("adm_all"), count: users.length },
          { id: "active", label: tx("adm_active"), count: activeCount },
          { id: "inactive", label: tx("adm_inactive"), count: users.length - activeCount },
        ]} />
        <span className={s.resultCount}>
          {rows.length} {tx("adm_of")} {users.length}
          {filtered ? <button type="button" className={s.linkBtn} onClick={clear}>{tx("clear_filters")}</button> : null}
        </span>
      </div>

      <div className={s.tableWrap}>
        <div className={cx(s.table, s.usTable)} role="table">
          <div className={s.thead} role="row">
            <SortHead label={tx("col_user")} k="name" sort={sort} setSort={setSort} />
            <SortHead label={tx("col_role")} k="role" sort={sort} setSort={setSort} />
            <SortHead label={tx("col_company")} k="company" sort={sort} setSort={setSort} />
            <SortHead label={tx("col_status")} k="status" sort={sort} setSort={setSort} />
            <SortHead label={tx("adm_created")} k="created" sort={sort} setSort={setSort} className={s.hideMd} />
            <span role="columnheader" className={s.th} />
          </div>

          {loading ? (
            [0, 1, 2, 3, 4].map(i => <div key={i} className={s.skelLine} style={{ animationDelay: `${i * 90}ms` }} />)
          ) : rows.length === 0 ? (
            users.length === 0
              ? <Empty icon={Users} title={tx("adm_no_users")} hint={tx("adm_no_users_hint")}
                  action={<button type="button" className={s.btnPrimary} onClick={() => onOpen(null)}><Plus size={14} /> {tx("adm_new_user")}</button>} />
              : <Empty icon={Search} title={tx("nothing_found")} hint={tx("nothing_found_hint")}
                  action={<button type="button" className={s.btnGhost} onClick={clear}>{tx("clear_filters")}</button>} />
          ) : rows.map(({ u, kind: k }) => {
            const kc = USER_KINDS.find(x => x.id === k);
            return (
              <div key={u.id} role="row" tabIndex={0} className={cx(s.tr, !u.is_active && s.trOff)} style={{ "--rowc": kc.color }}
                onClick={() => onOpen(u)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(u); }}>
                <span role="cell" className={cx(s.td, s.tdMain)}>
                  <Avatar label={u.username || u.email} size={38} square={false} tone={u.is_super_admin ? "#e8a317" : undefined} />
                  <span className={s.whoText}>
                    <strong>{u.username || "—"}{u.is_super_admin ? <Crown size={12} className={s.crown} /> : null}</strong>
                    <small>{u.email}</small>
                  </span>
                </span>
                <span role="cell" className={s.td}>
                  <span className={s.chip} style={{ "--chip": kc.color === "#c3cad8" ? "#8b95a9" : kc.color }}>{tx(kc.labelKey)}</span>
                </span>
                <span role="cell" className={cx(s.td, s.tdCompany)}>
                  {u._company_names.length ? (
                    <>
                      <span className={s.coName}>{u._company_names[0]}</span>
                      {u._company_names.length > 1 ? <small className={s.more}>+{u._company_names.length - 1}</small> : null}
                    </>
                  ) : <span className={s.muted}>—</span>}
                </span>
                <span role="cell" className={s.td}>
                  <span className={cx(s.status, u.is_active && s.statusOn)}><i />{u.is_active ? tx("adm_active") : tx("adm_inactive")}</span>
                </span>
                <span role="cell" className={cx(s.td, s.hideMd, s.muted)}>{fmtDate(u.created_at, locale)}</span>
                <span role="cell" className={cx(s.td, s.tdAct)}>
                  <button type="button" className={s.iconBtnSm} aria-label={tx("more_actions")}
                    onClick={(e) => { e.stopPropagation(); setMenu(menu?.user.id === u.id ? null : { user: u, anchor: e.currentTarget }); }}>
                    <MoreHorizontal size={16} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {menu && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} width={200}>
          <MenuItem icon={Edit2} onClick={() => { setMenu(null); onOpen(menu.user); }}>{tx("edit")}</MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => { setMenu(null); onDelete(menu.user); }}>{tx("delete")}</MenuItem>
        </Menu>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Ajustes: idioma del portal
// ════════════════════════════════════════════════════════════════════════
function SettingsView({ locale, setLocale, tx }) {
  return (
    <div className={s.view}>
      <section className={s.settingsCard}>
        <div className={s.blockHead}>
          <h3>{tx("adm_lang_title")}</h3>
          <p>{tx("adm_lang_subtitle")}</p>
        </div>
        <div className={s.langGrid} role="radiogroup" aria-label={tx("language")}>
          {Object.entries(LOCALES).map(([code, { label, flag }]) => {
            const on = locale === code;
            return (
              <button key={code} type="button" role="radio" aria-checked={on}
                className={cx(s.langOpt, on && s.langOn)} onClick={() => setLocale(code)}>
                <span className={s.langFlag}>{flag}</span>
                <span className={s.langText}><strong>{label}</strong><small>{code.toUpperCase()}</small></span>
                {on ? <span className={s.langCheck}><Check size={13} strokeWidth={3} /></span> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Paleta de búsqueda
// ════════════════════════════════════════════════════════════════════════
function CommandPalette({ companies, users, tx, onClose, onCompany, onUser, onNewCompany, onNewUser }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const needle = q.trim().toLowerCase();
  const items = useMemo(() => {
    const cos = companies
      .filter(c => !needle || c.name.toLowerCase().includes(needle) || (c.slug ?? "").toLowerCase().includes(needle))
      .slice(0, 6).map(c => ({ kind: "company", id: `c-${c.id}`, item: c }));
    const us = users
      .filter(u => !needle || (u.username ?? "").toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle))
      .slice(0, 6).map(u => ({ kind: "user", id: `u-${u.id}`, item: u }));
    const actions = [
      { kind: "action", id: "a-co", label: tx("adm_new_company"), icon: Building2, run: onNewCompany },
      { kind: "action", id: "a-us", label: tx("adm_new_user"), icon: UserPlus, run: onNewUser },
    ].filter(a => !needle || a.label.toLowerCase().includes(needle));
    return [...cos, ...us, ...actions];
  }, [companies, users, needle, tx, onNewCompany, onNewUser]);
  const run = (it) => {
    if (!it) return;
    if (it.kind === "company") onCompany(it.item);
    else if (it.kind === "user") onUser(it.item);
    else it.run();
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  let lastKind = null;
  const groupLabel = { company: tx("adm_companies"), user: tx("adm_users"), action: tx("actions") };
  return (
    <div className={s.paletteWrap}>
      <div className={s.scrim} onClick={onClose} />
      <div className={s.palette} role="dialog" aria-modal="true" aria-label={tx("search_all")}>
        <div className={s.paletteInput}>
          <Search size={17} />
          <input autoFocus value={q} placeholder={tx("palette_ph")} onKeyDown={onKey}
            onChange={(e) => { setQ(e.target.value); setHi(0); }} />
          <kbd>Esc</kbd>
        </div>
        <div className={s.paletteList}>
          {items.length === 0 ? <p className={s.paletteEmpty}>{tx("palette_empty")}</p> : items.map((it, i) => {
            const head = it.kind !== lastKind ? <p key={`h-${it.kind}`} className={s.paletteGroup}>{groupLabel[it.kind]}</p> : null;
            lastKind = it.kind;
            return [head, (
              <button key={it.id} type="button" className={cx(s.paletteItem, i === hi && s.paletteHi)}
                onMouseEnter={() => setHi(i)} onClick={() => run(it)}>
                {it.kind === "company" ? <Avatar label={it.item.name} tone="#1a2f8a" size={30} />
                  : it.kind === "user" ? <Avatar label={it.item.username || it.item.email} size={30} square={false} />
                  : <span className={s.paletteActIcon}><it.icon size={15} /></span>}
                <span className={s.whoText}>
                  <strong>{it.kind === "company" ? it.item.name : it.kind === "user" ? (it.item.username || it.item.email) : it.label}</strong>
                  {it.kind === "company" ? <small className={s.mono}>{it.item.slug}</small> : it.kind === "user" ? <small>{it.item.email}</small> : null}
                </span>
                {it.kind === "company" ? <TierChip tier={it.item.tier} /> : null}
                {i === hi ? <CornerDownLeft size={14} className={s.paletteEnter} /> : null}
              </button>
            )];
          })}
        </div>
      </div>
    </div>
  );
}