/* ══════════════════════════════════════════════════════════════════════
   Ajustes › Acceso de usuarios.

   Misma lógica que antes (usuarios de la empresa activa, estado Off /
   Regular / Admin, alta y baja de usuarios, y permisos por páginas,
   empresas, estructuras, fuentes, dimensiones y mapeos), con otra cara:
     · cabecera con el resumen (usuarios, activos, admins, desactivados) que
       también filtra, buscador siempre visible y "Añadir usuario";
     · una fila por usuario con su estado y seis "chips" de acceso que dicen
       cuánto ve de cada cosa (todo / parte / nada);
     · al pulsar un chip se abre un panel lateral con las seis pestañas del
       usuario: páginas (por secciones, con interruptores) y listas con
       buscador y "seleccionar todo";
     · los cambios de permisos se acumulan y una barra flotante permite
       guardarlos o descartarlos. El estado (Off / Regular / Admin) se guarda
       al momento, como antes.
   ══════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, X, Check, Search, Shield, Building2, Network, Library, Database, LayoutGrid, Crown, Plus, UserPlus,
  Trash2, Users, UserCheck, UserX, RotateCcw, ChevronRight, Lock,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getActiveCompanyId, listMappings } from "../../lib/mappingsApi";
import { listMappings as listReportMappings } from "../../lib/reportMappingsApi";
import { listMappings as listCashflowMappings } from "../../lib/cashflowMappingsApi";
import { listMappings as listCashflowReportMappings } from "../../lib/cashflowReportMappingsApi";
import { listUserPermissions, upsertUserPermissions, listUserResourceAccess, upsertUserResourceAccess, pageAllowed } from "../../lib/userPermissionsApi";
import { useSettings } from "../../components/layout/SettingsContext.jsx";
import s from "./UserManagement.module.css";

const BASE = "https://api.konsolidator.com/v2";
const cx = (...c) => c.filter(Boolean).join(" ");

// Páginas que se pueden permitir o quitar, en el orden del menú.
const PAGE_TREE = [
  { key: "home", label: "Home" },
  { key: "individual", label: "Individual", children: [
    { key: "individual-data",         label: "Data" },
    { key: "individual-kpis",         label: "KPIs" },
    { key: "individual-dimensiones",  label: "Dimensions" },
    { key: "individual-cashflow",     label: "Cash Flow" },
  ]},
  { key: "consolidated", label: "Consolidated", children: [
    { key: "individual-contributive",    label: "Contributive" },
    { key: "consolidated-sheet",         label: "Consolidation sheet" },
    { key: "consolidated-kpis",          label: "KPIs" },
    { key: "consolidated-dimensiones",   label: "Dimensions" },
    { key: "consolidated-cashflow",      label: "Cash Flow" },
  ]},
  { key: "views", label: "Views", children: [
    { key: "mappings",            label: "Mappings" },
    { key: "statistical-parties", label: "Statistical parties" },
  ]},
  { key: "presentations-group", label: "Presentations", children: [
    { key: "presentations",        label: "PowerPoint" },
    { key: "presentations-memory", label: "Memory notes" },
  ]},
  { key: "controlling", label: "Controlling", children: [
    { key: "controlling-forecast",    label: "Forecasting" },
    { key: "controlling-adjustments", label: "Adjustments" },
    { key: "controlling-kpis",        label: "KPIs" },
  ]},
  { key: "data-explorer", label: "Data Explorer", children: [
    { key: "structure", label: "Structure" },
  ]},
  { key: "settings", label: "Settings", children: [
    { key: "settings-personalization", label: "Personalization" },
    { key: "settings-security",        label: "Security" },
  ]},
];

const ALL_PAGE_KEYS = [];
const collectLeaves = (nodes) => nodes.forEach(n => {
  if (n.children) collectLeaves(n.children);
  else ALL_PAGE_KEYS.push(n.key);
});
collectLeaves(PAGE_TREE);

const CATEGORIES = [
  { key: "pages",      label: "Pages",      icon: Shield,     color: "#1a2f8a", kind: null },
  { key: "companies",  label: "Companies",  icon: Building2,  color: "#dc7533", kind: "company" },
  { key: "structures", label: "Structures", icon: LayoutGrid, color: "#7c3aed", kind: "structure" },
  { key: "sources",    label: "Sources",    icon: Network,    color: "#16a34a", kind: "source" },
  { key: "dimensions", label: "Dimensions", icon: Database,   color: "#0891b2", kind: "dimension" },
  { key: "mappings",   label: "Mappings",   icon: Library,    color: "#cf305d", kind: "mapping" },
];

// Color estable por usuario para el avatar
const AVATAR_TONES = [
  ["#1a2f8a", "#3a5fd9"], ["#0f766e", "#14b8a6"], ["#7c3aed", "#a78bfa"], ["#c2410c", "#fb923c"],
  ["#be185d", "#f472b6"], ["#0369a1", "#38bdf8"], ["#4d7c0f", "#a3e635"], ["#b45309", "#fbbf24"],
];
const toneFor = (id) => {
  let h = 0; for (const ch of String(id ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};
const initialsOf = (u) => {
  const name = String(u.username ?? u.email ?? "U").trim();
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "U") + (parts[1]?.[0] ?? "")).toUpperCase();
};
const userState = (u) => (!(u.is_active && u.uc_is_active) ? "inactive" : u.uc_role === "admin" ? "admin" : u.uc_role === "consultant" ? "consultant" : "regular");

/* ─── Interruptor ─── */
function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={cx(s.toggle, checked && s.toggleOn)} onClick={onChange}>
      <span />
    </button>
  );
}

/* ─── Estado: Off · Regular · Admin ─── */
function StateSegmented({ user, disabled, onChange }) {
  const current = userState(user);
  const SEGMENTS = [
    { key: "inactive", label: "Off" },
    { key: "regular",  label: "Regular" },
    { key: "admin",    label: "Admin", icon: Crown },
  ];
  return (
    <div className={cx(s.seg, disabled && s.segDisabled)} title={disabled ? "Only super-admins and company admins can change roles" : undefined}>
      {current === "consultant" ? (
        <span className={s.consultant}><Shield size={11} />Consultant</span>
      ) : SEGMENTS.map(seg => {
        const on = current === seg.key;
        const Icon = seg.icon;
        return (
          <button key={seg.key} type="button" disabled={disabled || on} onClick={() => onChange(seg.key)}
            className={cx(s.segBtn, on && s[`seg_${seg.key}`])}>
            {Icon && <Icon size={10} />}{seg.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Chip de acceso (cuánto ve de una categoría) ─── */
function AccessChip({ cat, count, total, disabled, onClick }) {
  const all = total > 0 && count >= total;
  const none = count === 0;
  const pct = total > 0 ? Math.min(1, count / total) : 0;
  const Icon = cat.icon;
  return (
    <button type="button" className={cx(s.chip, all && s.chipAll, none && s.chipNone)} style={{ "--c": cat.color, "--p": `${pct * 100}%` }}
      onClick={onClick} disabled={disabled}
      title={disabled ? "Only super-admins and company admins can change permissions" : `${cat.label}: ${count} of ${total}`}>
      <span className={s.chipIcon}><Icon size={13} /></span>
      <span className={s.chipText}>
        <b>{all ? "All" : none ? "None" : count}</b>
        <em>{all ? `${total} of ${total}` : none ? `0 of ${total}` : `of ${total}`}</em>
      </span>
      <i className={s.chipBar}><i /></i>
    </button>
  );
}

/* ─── Ventana genérica (alta de usuario) ─── */
function Modal({ title, icon: Icon, onClose, children, primary }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={s.overlay} style={{ "--um-primary": primary }} onMouseDown={onClose}>
      <div className={s.modal} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className={s.modalHead}>
          <span className={s.modalIcon}><Icon size={16} /></span>
          <b>{title}</b>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ─── Alta de usuario ─── */
function CreateUserModal({ existingEmails, onClose, onCreate, primary }) {
  const [email, setEmail]       = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState("");

  const emailValid = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim());
  const emailTaken = email.trim() && existingEmails.has(email.trim().toLowerCase());
  const canSubmit  = emailValid && !emailTaken && username.trim() && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      await onCreate({ email: email.trim(), username: username.trim() });
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to create user");
      setBusy(false);
    }
  };

  return (
    <Modal title="Add user" icon={UserPlus} onClose={onClose} primary={primary}>
      <form className={s.form} onSubmit={e => { e.preventDefault(); submit(); }}>
        <p className={s.formNote}>
          The new user joins this company as <b>Regular</b> and sets a password the first time they sign in.
          You can make them Admin afterwards.
        </p>
        <label className={s.field}>
          <span>Email</span>
          <input type="email" value={email} autoFocus placeholder="user@company.com"
            className={cx((email && !emailValid) || emailTaken ? s.inputBad : null)}
            onChange={e => { setEmail(e.target.value); setErr(""); }} />
          {email && !emailValid && <em className={s.fieldErr}>Invalid email</em>}
          {emailTaken && <em className={s.fieldErr}>Already in this company</em>}
        </label>
        <label className={s.field}>
          <span>Name</span>
          <input type="text" value={username} placeholder="Jane Doe" onChange={e => { setUsername(e.target.value); setErr(""); }} />
        </label>
        {err && <div className={s.formErr}>{err}</div>}
        <div className={s.formFoot}>
          <button type="button" className={s.ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={s.primaryBtn} disabled={!canSubmit}>
            {busy ? <Loader2 size={13} className={s.spin} /> : <UserPlus size={13} />}
            {busy ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Panel lateral con los permisos de un usuario ─── */
function AccessDrawer({ user, tab, onTab, perms, itemsFor, countFor, totalFor, onPatch, onClose, readOnly, primary }) {
  const [q, setQ] = useState("");
  useEffect(() => { setQ(""); }, [tab]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cat = CATEGORIES.find(c => c.key === tab) ?? CATEGORIES[0];
  const [c1, c2] = toneFor(user.id);

  // ── Páginas ──
  const pagePerms = perms.pages ?? {};
  const isOn = (key) => pageAllowed(pagePerms, key);
  const groupState = (g) => {
    if (!g.children) return isOn(g.key) ? "all" : "none";
    const on = g.children.filter(c => isOn(c.key)).length;
    return on === g.children.length ? "all" : on === 0 ? "none" : "some";
  };
  const setPages = (next) => onPatch({ pages: next });
  const toggleKey = (key) => setPages({ ...pagePerms, [key]: !isOn(key) });
  const toggleGroup = (g) => {
    const next = groupState(g) !== "all";
    const keys = g.children ? [...g.children.map(c => c.key), g.key] : [g.key];
    const upd = { ...pagePerms };
    keys.forEach(k => { upd[k] = next; });
    setPages(upd);
  };
  const setAllPages = (on) => { const u = {}; ALL_PAGE_KEYS.forEach(k => { u[k] = on; }); setPages(u); };

  // ── Listas ──
  const items = tab === "pages" ? [] : itemsFor(tab);
  const raw = tab === "pages" ? null : perms[tab];
  const selected = Array.isArray(raw) ? raw : items.map(i => i.id);
  const selSet = new Set(selected);
  const shown = items.filter(i => !q || `${i.label} ${i.meta ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const allOn = items.length > 0 && items.every(i => selSet.has(i.id));
  const toggleItem = (id) => onPatch({ [tab]: selSet.has(id) ? selected.filter(x => x !== id) : [...selected, id] });

  return createPortal(
    <div className={s.drawerWrap} style={{ "--um-primary": primary }} onMouseDown={onClose}>
      <aside className={s.drawer} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={`Access for ${user.username ?? user.email}`}>
        <header className={s.dHead}>
          <span className={s.avatarLg} style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>{initialsOf(user)}</span>
          <div className={s.dWho}>
            <b>{user.username ?? "—"}</b>
            <em>{user.email}</em>
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <nav className={s.dTabs}>
          {CATEGORIES.map(c => {
            const Icon = c.icon;
            const cnt = countFor(user.id, c.key), tot = totalFor(c.key);
            return (
              <button key={c.key} type="button" onClick={() => onTab(c.key)} className={cx(s.dTab, tab === c.key && s.dTabOn)} style={{ "--c": c.color }}>
                <Icon size={14} />
                <span>{c.label}</span>
                <i>{cnt >= tot && tot > 0 ? "All" : `${cnt}/${tot}`}</i>
              </button>
            );
          })}
        </nav>

        {readOnly && (
          <p className={s.dReadOnly}><Lock size={12} />Only super-admins and company admins can change permissions.</p>
        )}

        {tab === "pages" ? (
          <>
            <div className={s.dBar}>
              <span>{ALL_PAGE_KEYS.filter(isOn).length} of {ALL_PAGE_KEYS.length} pages</span>
              {!readOnly && <div className={s.dBarBtns}>
                <button type="button" onClick={() => setAllPages(true)}>All on</button>
                <button type="button" onClick={() => setAllPages(false)}>All off</button>
              </div>}
            </div>
            <div className={s.dBody}>
              {PAGE_TREE.map(g => {
                const st = groupState(g);
                return (
                  <section key={g.key} className={cx(s.pGroup, st === "none" && s.pGroupOff)}>
                    <div className={s.pHead}>
                      <b>{g.label}</b>
                      {g.children && <em>{g.children.filter(c => isOn(c.key)).length}/{g.children.length}</em>}
                      <Toggle checked={st === "all"} onChange={() => toggleGroup(g)} disabled={readOnly} label={`All of ${g.label}`} />
                    </div>
                    {g.children && (
                      <div className={s.pList}>
                        {g.children.map(c => (
                          <label key={c.key} className={cx(s.pItem, !isOn(c.key) && s.pItemOff)}>
                            <span>{c.label}</span>
                            <Toggle checked={isOn(c.key)} onChange={() => toggleKey(c.key)} disabled={readOnly} label={`${g.label} · ${c.label}`} />
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className={s.dBar}>
              <label className={s.dSearch}><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cat.label.toLowerCase()}…`} /></label>
              {!readOnly && items.length > 0 && (
                <button type="button" className={s.dSelAll} style={{ "--c": cat.color }} onClick={() => onPatch({ [tab]: allOn ? [] : items.map(i => i.id) })}>
                  {allOn ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
            <div className={s.dBody}>
              <p className={s.dCount}>{selected.length} of {items.length} selected</p>
              {shown.length === 0 && <p className={s.dEmpty}>{items.length ? "Nothing matches the search." : "Nothing to choose from yet."}</p>}
              <ul className={s.lList}>
                {shown.map(item => {
                  const on = selSet.has(item.id);
                  return (
                    <li key={item.id}>
                      <button type="button" className={cx(s.lItem, on && s.lItemOn)} style={{ "--c": cat.color }} disabled={readOnly} onClick={() => toggleItem(item.id)}>
                        <span className={s.lCheck}>{on && <Check size={11} strokeWidth={3} />}</span>
                        <span className={s.lText}>
                          <b>{item.label}</b>
                          {item.meta && <em>{item.meta}</em>}
                        </span>
                        {item.pill && <span className={s.lPill} style={{ "--pc": item.pill.color }}>{item.pill.text}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
        <footer className={s.dFoot}>
          <span>Changes are kept until you save them.</span>
          <button type="button" className={s.primaryBtn} onClick={onClose}><Check size={13} />Done</button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════ */
export default function UserManagement({ token, preloadedData = {} }) {
  const { colors } = useSettings();
  const primary = colors?.primary ?? "#1a2f8a";
  const [companyId, setCompanyId] = useState(null);
  const [myUserId, setMyUserId]   = useState(null);
  const [users, setUsers]         = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Super-admin (global) manda; consultor (Konsolidator) va por encima de
  // admin, y admin (por empresa) también puede editar.
  const me = users.find(u => u.id === myUserId);
  const myRole = String(me?.uc_role ?? "").toLowerCase();
  const canEditRoles = !!(me?.is_super_admin || myRole === "consultant" || myRole === "admin");

  const [companies,  setCompanies]  = useState(() => preloadedData.companies  ?? []);
  const [structures, setStructures] = useState(() => preloadedData.structures ?? []);
  const [sources,    setSources]    = useState(() => preloadedData.sources    ?? []);
  const [dimensions, setDimensions] = useState(() => preloadedData.dimensions ?? []);
  const [mappings,               setMappings]               = useState([]);
  const [reportMappings,         setReportMappings]         = useState([]);
  const [cashflowMappings,       setCashflowMappings]       = useState([]);
  const [cashflowReportMappings, setCashflowReportMappings] = useState([]);

  // Map<userId, { pages: {pageKey: bool}, companies: string[]|null, … }>
  // null = sin restricciones = todo permitido
  const [userPerms, setUserPerms] = useState(new Map());
  const savedPermsRef = useRef(new Map()); // lo último guardado, para "Descartar"
  const [pending,   setPending]   = useState(new Map());
  const [saving,    setSaving]    = useState(false);
  const [drawer,    setDrawer]    = useState(null); // { userId, tab }
  const [createOpen, setCreateOpen] = useState(false);
  const [search,     setSearch]     = useState("");
  const [filter,     setFilter]     = useState("all"); // all | active | admin | inactive
  const [savedFlash, setSavedFlash] = useState(false);

  /* ── Arranque ── */
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setMyUserId(uid);
      if (uid) setCompanyId(await getActiveCompanyId(uid));
    })();
  }, []);

  /* ── Usuarios y permisos ── */
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      setLoadingUsers(true);
      try {
        const { data: ucRows, error: ucErr } = await supabase.schema("accounts")
          .from("user_companies").select("user_id, is_active, role").eq("company_id", companyId);
        if (ucErr) throw ucErr;

        const userIds = (ucRows ?? []).map(r => r.user_id);
        if (!userIds.length) { if (!cancelled) { setUsers([]); setLoadingUsers(false); } return; }

        const { data: usersRows, error: uErr } = await supabase.schema("accounts")
          .from("users").select("id, username, email, is_active, is_super_admin").in("id", userIds);
        if (uErr) throw uErr;

        const ucMap = new Map((ucRows ?? []).map(r => [r.user_id, r]));
        const combined = (usersRows ?? [])
          .map(u => ({
            ...u,
            uc_is_active: ucMap.get(u.id)?.is_active ?? true,
            uc_role:      ucMap.get(u.id)?.role ?? "regular",
          }))
          .sort((a, b) => String(a.username ?? a.email ?? "").localeCompare(String(b.username ?? b.email ?? "")));
        if (cancelled) return;
        setUsers(combined);

        const [pageRows, resourceRows] = await Promise.all([
          listUserPermissions({ companyId }).catch(() => []),
          listUserResourceAccess({ companyId }).catch(() => []),
        ]);

        const permsMap = new Map();
        combined.forEach(u => {
          const pages = {};
          (pageRows ?? []).filter(r => r.user_id === u.id).forEach(r => { pages[r.page_key] = r.allowed; });
          const res = (resourceRows ?? []).filter(r => r.user_id === u.id);
          const hasKind = (kind) => res.some(r => r.resource_kind === kind);
          const pick    = (kind) => res.filter(r => r.resource_kind === kind && r.allowed).map(r => r.resource_id);
          permsMap.set(u.id, {
            pages,
            companies:  hasKind("company")   ? pick("company")   : null,
            structures: hasKind("structure") ? pick("structure") : null,
            sources:    hasKind("source")    ? pick("source")    : null,
            dimensions: hasKind("dimension") ? pick("dimension") : null,
            mappings:   hasKind("mapping")   ? pick("mapping")   : null,
          });
        });
        if (cancelled) return;
        setUserPerms(permsMap);
        savedPermsRef.current = new Map(permsMap);
      } catch (e) {
        console.error("Error loading users:", e);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  /* ── Recursos ── */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    Promise.all([
      fetch(`${BASE}/companies`,  { headers: h }).then(r => r.json()).catch(() => ({})),
      fetch(`${BASE}/structures`, { headers: h }).then(r => r.json()).catch(() => ({})),
      fetch(`${BASE}/sources`,    { headers: h }).then(r => r.json()).catch(() => ({})),
      fetch(`${BASE}/dimensions`, { headers: h }).then(r => r.json()).catch(() => ({})),
    ]).then(([cos, strs, srcs, dims]) => {
      if (cancelled) return;
      // Solo se rellenan si siguen vacías (no se pisa lo que llegó precargado)
      setCompanies(prev  => prev.length ? prev : (cos.value  ?? []));
      setStructures(prev => prev.length ? prev : (strs.value ?? []));
      setSources(prev    => prev.length ? prev : (srcs.value ?? []));
      setDimensions(prev => prev.length ? prev : (dims.value ?? []));
    });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      listMappings({ companyId }).catch(() => []),
      listReportMappings({ companyId }).catch(() => []),
      listCashflowMappings({ companyId }).catch(() => []),
      listCashflowReportMappings({ companyId }).catch(() => []),
    ]).then(([sm, rm, cm, crm]) => {
      setMappings(sm);
      setReportMappings(rm);
      setCashflowMappings(cm);
      setCashflowReportMappings(crm);
    });
  }, [companyId]);

  /* ── Listas de elementos ── */
  const companyItems   = useMemo(() => companies.map(c => ({ id: String(c.CompanyShortName ?? c), label: String(c.CompanyLegalName ?? c.CompanyShortName ?? c), meta: c.CompanyShortName ?? null })), [companies]);
  const structureItems = useMemo(() => structures.map(x => ({ id: String(x.GroupStructure ?? x), label: String(x.GroupStructure ?? x) })), [structures]);
  const sourceItems    = useMemo(() => sources.map(x => ({ id: String(x.Source ?? x), label: String(x.Source ?? x) })), [sources]);
  const dimensionItems = useMemo(() => dimensions.map(d => {
    const code = String(d.DimensionCode ?? d.dimensionCode ?? d.code ?? d.Code ?? "");
    const name = String(d.DimensionName ?? d.dimensionName ?? d.name ?? d.Name ?? code);
    return { id: code || name, label: name, meta: code && code !== name ? code : null };
  }), [dimensions]);
  const mappingItems   = useMemo(() => [
    ...mappings.map(m               => ({ id: `sm:${m.mapping_id}`,  label: m.name ?? "Untitled", pill: { text: "Structure", color: "#7c3aed" } })),
    ...reportMappings.map(m         => ({ id: `rm:${m.mapping_id}`,  label: m.name ?? "Untitled", pill: { text: "Report",    color: "#cf305d" } })),
    ...cashflowMappings.map(m       => ({ id: `cm:${m.mapping_id}`,  label: m.name ?? "Untitled", pill: { text: "CF",        color: "#0891b2" } })),
    ...cashflowReportMappings.map(m => ({ id: `crm:${m.mapping_id}`, label: m.name ?? "Untitled", pill: { text: "CF Report", color: "#d97706" } })),
  ], [mappings, reportMappings, cashflowMappings, cashflowReportMappings]);

  const itemsForCategory = useCallback((cat) => ({
    companies: companyItems, structures: structureItems, sources: sourceItems,
    dimensions: dimensionItems, mappings: mappingItems,
  }[cat] ?? []), [companyItems, structureItems, sourceItems, dimensionItems, mappingItems]);

  /* ── Permisos ── */
  const getPerms = useCallback((uid) => userPerms.get(uid) ?? { pages: {}, companies: null, structures: null, sources: null, dimensions: null, mappings: null }, [userPerms]);

  const patchPerms = (uid, patch) => {
    setUserPerms(prev => { const m = new Map(prev); m.set(uid, { ...(prev.get(uid) ?? getPerms(uid)), ...patch }); return m; });
    setPending(prev => { const m = new Map(prev); m.set(uid, { ...(m.get(uid) ?? {}), ...patch }); return m; });
  };

  const discard = () => {
    setUserPerms(new Map(savedPermsRef.current));
    setPending(new Map());
  };

  // Estado combinado en esta empresa: "inactive" | "regular" | "admin".
  // Se guarda al momento (como antes).
  const setUserState = async (u, nextState) => {
    if (!canEditRoles) return;
    if (u.id === myUserId && u.uc_role === "admin" && nextState === "regular") {
      if (!window.confirm("Demote yourself to regular? You will lose admin permissions on this company.")) return;
    }
    const prev = { is_active: u.is_active, uc_is_active: u.uc_is_active, uc_role: u.uc_role };
    const patch =
      nextState === "inactive" ? { is_active: false, uc_is_active: false, uc_role: u.uc_role ?? "regular" } :
      nextState === "admin"    ? { is_active: true,  uc_is_active: true,  uc_role: "admin" } :
                                 { is_active: true,  uc_is_active: true,  uc_role: "regular" };

    setUsers(list => list.map(x => x.id === u.id ? { ...x, ...patch } : x));

    const { error: linkErr } = await supabase.schema("accounts").from("user_companies")
      .update({ is_active: patch.uc_is_active, role: patch.uc_role }).eq("user_id", u.id).eq("company_id", companyId);
    const { error: userErr } = await supabase.schema("accounts").from("users")
      .update({ is_active: patch.is_active }).eq("id", u.id);

    if (linkErr || userErr) {
      setUsers(list => list.map(x => x.id === u.id ? { ...x, ...prev } : x));
      alert("Update failed: " + (linkErr?.message ?? userErr?.message));
    }
  };

  /* ── Alta de usuario ── */
  const createUser = async ({ email, username }) => {
    if (!canEditRoles) throw new Error("Not allowed");
    if (!companyId)    throw new Error("No active company");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired, please sign in again");

    const res = await fetch("https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/create-company-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email: email.trim(), username: username.trim(), company_id: companyId, role: "regular" }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? `Error ${res.status}`);

    setUsers(prev => [...prev, {
      id: result.user_id, username: username.trim(), email: email.trim(),
      is_active: true, is_super_admin: false, uc_is_active: true, uc_role: "regular",
    }].sort((a, b) => String(a.username ?? a.email ?? "").localeCompare(String(b.username ?? b.email ?? ""))));
  };

  /* ── Baja de usuario ── */
  // Si solo pertenece a ESTA empresa → borrado completo (edge function);
  // si no → solo se quita el vínculo con esta empresa.
  const deleteUser = async (u) => {
    if (!canEditRoles) return;
    if (u.id === myUserId) { alert("You cannot remove yourself."); return; }

    const { data: links, error: linksErr } = await supabase.schema("accounts")
      .from("user_companies").select("company_id").eq("user_id", u.id);
    if (linksErr) { alert("Failed to check user companies: " + linksErr.message); return; }

    const isOnlyHere = (links ?? []).length <= 1;
    const msg = isOnlyHere
      ? `Permanently delete ${u.username ?? u.email}? They don't belong to any other company so they'll be removed completely.`
      : `Remove ${u.username ?? u.email} from this company? They'll keep access to their other companies.`;
    if (!window.confirm(msg)) return;

    const prevUsers = users;
    setUsers(prev => prev.filter(x => x.id !== u.id));
    setPending(prev => { const m = new Map(prev); m.delete(u.id); return m; });
    if (drawer?.userId === u.id) setDrawer(null);

    try {
      if (isOnlyHere) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Session expired");
        const res = await fetch("https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/delete-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_id: u.id, company_id: companyId }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? `Error ${res.status}`);
      } else {
        const { error: delErr } = await supabase.schema("accounts").from("user_companies")
          .delete().eq("user_id", u.id).eq("company_id", companyId);
        if (delErr) throw new Error(delErr.message);
      }
    } catch (e) {
      setUsers(prevUsers);
      alert("Delete failed: " + e.message);
    }
  };

  /* ── Guardar ── */
  const save = async () => {
    if (pending.size === 0 || !companyId) return;
    setSaving(true);
    const kindMap = { companies: "company", structures: "structure", sources: "source", dimensions: "dimension", mappings: "mapping" };
    const pageRows = [], resourceRows = [];
    const now = new Date().toISOString();

    for (const [uid, patch] of pending.entries()) {
      if (patch.pages) {
        Object.entries(patch.pages).forEach(([page_key, allowed]) => {
          pageRows.push({ company_id: companyId, user_id: uid, page_key, allowed, updated_by: myUserId, updated_at: now });
        });
      }
      for (const [cat, kind] of Object.entries(kindMap)) {
        if (patch[cat] !== undefined) {
          const items = itemsForCategory(cat);
          // null = todo permitido: se escribe cada elemento como permitido
          const selectedIds = patch[cat] === null ? items.map(i => i.id) : patch[cat];
          items.forEach(item => {
            resourceRows.push({
              company_id: companyId, user_id: uid,
              resource_kind: kind, resource_id: item.id,
              allowed: selectedIds.includes(item.id),
              updated_by: myUserId, updated_at: now,
            });
          });
        }
      }
    }

    try {
      await Promise.all([
        pageRows.length     ? upsertUserPermissions(pageRows)        : Promise.resolve(),
        resourceRows.length ? upsertUserResourceAccess(resourceRows) : Promise.resolve(),
      ]);
      savedPermsRef.current = new Map(userPerms);
      setPending(new Map());
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch (e) {
      alert("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Recuentos ── */
  const countFor = (uid, cat) => {
    const perms = getPerms(uid);
    if (cat === "pages") return ALL_PAGE_KEYS.filter(k => pageAllowed(perms.pages, k)).length;
    const list = perms[cat];
    if (list === null || list === undefined) return itemsForCategory(cat).length;
    return list.length;
  };
  const totalFor = (cat) => (cat === "pages" ? ALL_PAGE_KEYS.length : itemsForCategory(cat).length);

  /* ── Resumen y filtro ── */
  const stats = useMemo(() => ({
    all: users.length,
    active: users.filter(u => userState(u) !== "inactive").length,
    admin: users.filter(u => userState(u) === "admin" || userState(u) === "consultant").length,
    inactive: users.filter(u => userState(u) === "inactive").length,
  }), [users]);

  const filteredUsers = useMemo(() => users.filter(u => {
    const st = userState(u);
    if (filter === "active" && st === "inactive") return false;
    if (filter === "admin" && st !== "admin" && st !== "consultant") return false;
    if (filter === "inactive" && st !== "inactive") return false;
    return !search || [u.username, u.email].some(v => v?.toLowerCase().includes(search.toLowerCase()));
  }), [users, search, filter]);

  const drawerUser = drawer ? users.find(u => u.id === drawer.userId) : null;
  const pendingCount = pending.size;

  const STAT_TILES = [
    { key: "all",      label: "Users",       value: stats.all,      icon: Users },
    { key: "active",   label: "Active",      value: stats.active,   icon: UserCheck },
    { key: "admin",    label: "Admins",      value: stats.admin,    icon: Crown },
    { key: "inactive", label: "Deactivated", value: stats.inactive, icon: UserX },
  ];

  return (
    <div className={s.wrap} style={{ "--um-primary": primary }}>
      {/* ── Cabecera: resumen, buscador y alta ── */}
      <header className={s.top}>
        <div className={s.stats}>
          {STAT_TILES.map((t, i) => {
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" className={cx(s.stat, filter === t.key && s.statOn, s[`stat_${t.key}`])}
                style={{ "--i": i }} onClick={() => setFilter(f => (f === t.key && t.key !== "all" ? "all" : t.key))}>
                <span className={s.statIcon}><Icon size={15} /></span>
                <span className={s.statText}><b>{loadingUsers ? "–" : t.value}</b><em>{t.label}</em></span>
              </button>
            );
          })}
        </div>
        <div className={s.tools}>
          <label className={s.search}>
            <Search size={14} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear"><X size={12} /></button>}
          </label>
          {canEditRoles && (
            <button type="button" className={s.primaryBtn} onClick={() => setCreateOpen(true)}><UserPlus size={14} />Add user</button>
          )}
        </div>
      </header>

      {/* ── Lista ── */}
      <section className={s.card}>
        <div className={s.headRow}>
          <span>User</span>
          <span>Status</span>
          <div className={s.headCats}>
            {CATEGORIES.map(c => {
              const Icon = c.icon;
              return <span key={c.key} style={{ "--c": c.color }}><Icon size={11} />{c.label}</span>;
            })}
          </div>
          <span />
        </div>

        <div className={s.rows}>
          {loadingUsers ? (
            Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={s.skel} style={{ "--i": i }}>
                <i className={s.skAvatar} /><i className={s.skLine} /><i className={s.skSeg} /><i className={s.skChips} />
              </div>
            ))
          ) : filteredUsers.length === 0 ? (
            <div className={s.empty}>
              <Users size={22} />
              <b>{users.length ? "No users match" : "No users yet"}</b>
              <em>{users.length ? "Try another search or filter." : "Add the first user to give them access."}</em>
            </div>
          ) : filteredUsers.map((u, i) => {
            const st = userState(u);
            const isDirty = pending.has(u.id);
            const [c1, c2] = toneFor(u.id);
            return (
              <div key={u.id} className={cx(s.row, isDirty && s.rowDirty, st === "inactive" && s.rowOff, drawer?.userId === u.id && s.rowOpen)} style={{ "--i": Math.min(i, 14) }}>
                <div className={s.who}>
                  <span className={s.avatar} style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {initialsOf(u)}
                    {isDirty && <i className={s.dirtyDot} title="Unsaved changes" />}
                  </span>
                  <div className={s.whoText}>
                    <b>
                      {u.username ?? "—"}
                      {u.id === myUserId && <span className={s.tagYou}>You</span>}
                      {u.is_super_admin && <span className={s.tagSuper}>Super admin</span>}
                    </b>
                    <em>{u.email}</em>
                  </div>
                </div>

                <div className={s.status}>
                  <StateSegmented user={u} disabled={!canEditRoles || st === "consultant"} onChange={(next) => setUserState(u, next)} />
                </div>

                <div className={s.chips}>
                  {CATEGORIES.map(c => (
                    <AccessChip key={c.key} cat={c} count={countFor(u.id, c.key)} total={totalFor(c.key)}
                      onClick={() => setDrawer({ userId: u.id, tab: c.key })} />
                  ))}
                </div>

                <div className={s.rowActions}>
                  <button type="button" className={s.openBtn} onClick={() => setDrawer({ userId: u.id, tab: "pages" })} title="Open access">
                    <ChevronRight size={15} />
                  </button>
                  {canEditRoles && u.id !== myUserId
                    ? <button type="button" className={s.trashBtn} onClick={() => deleteUser(u)} title="Remove user"><Trash2 size={13} /></button>
                    : <span className={s.trashSlot} />}
                </div>
              </div>
            );
          })}
        </div>

        {!loadingUsers && canEditRoles && (
          <button type="button" className={s.addRow} onClick={() => setCreateOpen(true)}>
            <Plus size={14} />Add user
          </button>
        )}
      </section>

      {/* ── Barra de cambios sin guardar ── */}
      {(pendingCount > 0 || savedFlash) && canEditRoles && (
        <div className={cx(s.saveBar, savedFlash && !pendingCount && s.saveBarDone)} role="status">
          {pendingCount > 0 ? (
            <>
              <span className={s.saveDot} />
              <span className={s.saveText}><b>{pendingCount} user{pendingCount === 1 ? "" : "s"}</b> with unsaved access changes</span>
              <button type="button" className={s.saveGhost} onClick={discard} disabled={saving}><RotateCcw size={12} />Discard</button>
              <button type="button" className={s.saveBtn} onClick={save} disabled={saving}>
                {saving ? <Loader2 size={13} className={s.spin} /> : <Check size={13} />}
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <span className={s.saveText}><Check size={14} />Access saved</span>
          )}
        </div>
      )}

      {drawerUser && (
        <AccessDrawer
          user={drawerUser}
          tab={drawer.tab}
          onTab={(tab) => setDrawer(d => ({ ...d, tab }))}
          perms={getPerms(drawerUser.id)}
          itemsFor={itemsForCategory}
          countFor={countFor}
          totalFor={totalFor}
          onPatch={(patch) => patchPerms(drawerUser.id, patch)}
          onClose={() => setDrawer(null)}
          readOnly={!canEditRoles}
          primary={primary}
        />
      )}

      {createOpen && (
        <CreateUserModal
          existingEmails={new Set(users.map(u => u.email?.toLowerCase()).filter(Boolean))}
          onClose={() => setCreateOpen(false)}
          onCreate={createUser}
          primary={primary}
        />
      )}
    </div>
  );
}