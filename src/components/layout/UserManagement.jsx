import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, X, Check, Search, Shield, Building2, Network, Library, Database, LayoutGrid, Crown, Plus, UserPlus, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getActiveCompanyId, listMappings } from "../../lib/mappingsApi";
import { listMappings as listReportMappings } from "../../lib/reportMappingsApi";
import { listMappings as listCashflowMappings } from "../../lib/cashflowMappingsApi";
import { listMappings as listCashflowReportMappings } from "../../lib/cashflowReportMappingsApi";
import { listUserPermissions, upsertUserPermissions, listUserResourceAccess, upsertUserResourceAccess } from "../../lib/userPermissionsApi";

const BASE = "https://api.konsolidator.com/v2";

const PAGE_TREE = [
  { key: "home", label: "Home" },
  { key: "individual", label: "Individual", children: [
    { key: "individual-data",         label: "Data" },
    { key: "individual-kpis",         label: "KPIs" },
    { key: "individual-dimensiones",  label: "Dimensions" },
    { key: "individual-cashflow",     label: "Cash Flow" },
    { key: "individual-memory-notes", label: "Memory Notes" },
  ]},
  { key: "consolidated", label: "Consolidated", children: [
    { key: "individual-contributive",    label: "Contributive" },
    { key: "consolidated-sheet",         label: "Sheet" },
    { key: "consolidated-kpis",          label: "KPIs" },
    { key: "consolidated-dimensiones",   label: "Dimensions" },
    { key: "consolidated-cashflow",      label: "Cash Flow" },
    { key: "consolidated-notes",         label: "Memory Notes" },
  ]},
  { key: "controlling", label: "Controlling", children: [
    { key: "controlling-forecast",    label: "Forecasting" },
    { key: "controlling-adjustments", label: "Adjustments" },
    { key: "controlling-kpis",        label: "KPIs" },
  ]},
  { key: "views", label: "Views", children: [
    { key: "mappings", label: "Mappings" },
  ]},
  { key: "data-explorer", label: "Data Explorer", children: [
    { key: "structure", label: "Structure" },
  ]},
  { key: "settings", label: "Settings", children: [
    { key: "settings-personalization", label: "Personalization" },
    { key: "settings-security",        label: "Security" },
  ]},
];

// Collect all leaf page keys
const ALL_PAGE_KEYS = [];
const collectLeaves = (nodes) => nodes.forEach(n => {
  if (n.children) collectLeaves(n.children);
  else ALL_PAGE_KEYS.push(n.key);
});
collectLeaves(PAGE_TREE);

const CATEGORY_BUTTONS = [
  { key: "pages",      label: "Pages",      icon: Shield,    color: "#1a2f8a", kind: null },
  { key: "companies",  label: "Companies",  icon: Building2, color: "#dc7533", kind: "company" },
  { key: "structures", label: "Structures", icon: LayoutGrid,color: "#7c3aed", kind: "structure" },
  { key: "sources",    label: "Sources",    icon: Network,   color: "#57aa78", kind: "source" },
  { key: "dimensions", label: "Dims",       icon: Database,  color: "#0891b2", kind: "dimension" },
  { key: "mappings",   label: "Mappings",   icon: Library,   color: "#CF305D", kind: "mapping" },
];

/* ─── Toggle ─── */
function Toggle({ checked, onChange, color = "#1a2f8a", size = "md" }) {
  const w = size === "sm" ? 32 : 36, h = size === "sm" ? 18 : 20, knob = size === "sm" ? 14 : 16;
  return (
    <button onClick={onChange} style={{
      width: w, height: h, borderRadius: h, flexShrink: 0, position: "relative", display: "inline-flex", alignItems: "center",
      background: checked ? color : "#e5e7eb",
      boxShadow: checked ? `0 2px 8px -2px ${color}80` : "inset 0 1px 2px rgba(0,0,0,0.06)",
      transition: "background 200ms ease", border: "none", cursor: "pointer",
    }}>
      <span style={{
        position: "absolute", width: knob, height: knob, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        left: checked ? w - knob - 2 : 2,
        transition: "left 200ms cubic-bezier(0.34,1.56,0.64,1)",
      }} />
    </button>
  );
}

/* ─── 3-state segmented control: Inactive · Regular · Admin ─── */
function StateSegmented({ user, disabled, onChange }) {
  const active = user.is_active && user.uc_is_active;
  const current = !active ? "inactive" : (user.uc_role === "admin" ? "admin" : "regular");

  const SEGMENTS = [
    { key: "inactive", label: "Off",     color: "#94a3b8", icon: null },
    { key: "regular",  label: "Regular", color: "#1a2f8a", icon: null },
    { key: "admin",    label: "Admin",   color: "#f59e0b", icon: Crown },
  ];

  return (
    <div
      title={disabled ? "Only super-admins and company admins can change roles" : undefined}
      style={{
        display: "inline-flex",
        background: "#f5f5f7",
        borderRadius: 10,
        padding: 2,
        border: "1px solid rgba(26,47,138,0.08)",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "default",
      }}>
      {SEGMENTS.map(seg => {
        const isCurrent = current === seg.key;
        const Icon = seg.icon;
        return (
          <button
            key={seg.key}
            onClick={() => !disabled && !isCurrent && onChange(seg.key)}
            disabled={disabled || isCurrent}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 8px", borderRadius: 8, border: "none",
              fontSize: 10, fontWeight: 900, letterSpacing: "0.04em",
              textTransform: "uppercase",
              background: isCurrent
                ? (seg.key === "admin"
                    ? `linear-gradient(135deg, ${seg.color} 0%, #d97706 100%)`
                    : seg.key === "regular"
                    ? `linear-gradient(135deg, ${seg.color} 0%, #3a5fd9 100%)`
                    : "#cbd5e1")
                : "transparent",
              color: isCurrent ? "#fff" : seg.color,
              boxShadow: isCurrent ? `0 2px 6px -1px ${seg.color}70` : "none",
              cursor: disabled ? "not-allowed" : isCurrent ? "default" : "pointer",
              transition: "all 150ms ease",
            }}>
            {Icon && <Icon size={9} />}
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Category pill ─── */
function CatButton({ cat, count, total, onClick, disabled = false }) {
  const pct = total > 0 ? count / total : 0;
  const noneOn = count === 0;
  const allOn = total > 0 && count === total;
  const iconColor = noneOn ? "#d1d5db" : allOn ? "#fff" : cat.color;

  return (
<div
      title={disabled
        ? "Only super-admins and company admins can change permissions"
        : `${cat.label}: ${count}/${total}`}
      onClick={() => { if (!disabled) onClick(); }}
      style={{
        width: 40, height: 40, flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "transform 150ms ease, opacity 150ms ease",
        transform: "translateZ(0)", willChange: "transform",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = "scale(1.08) translateZ(0)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateZ(0)"; }}>

      {/* Inner handles clip + visuals — no transform */}
      <div style={{
        position: "relative", width: "100%", height: "100%", borderRadius: 11,
        border: `1.5px solid ${noneOn ? "#e9eaf0" : allOn ? `${cat.color}cc` : `${cat.color}35`}`,
        background: "rgba(255,255,255,0.7)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        overflow: "hidden",
        boxShadow: noneOn ? "inset 0 1px 2px rgba(0,0,0,0.04)" : `inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 4px ${cat.color}20`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {/* Fill */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: `${pct * 100}%`,
          background: allOn
            ? `linear-gradient(180deg, ${cat.color}cc 0%, ${cat.color} 100%)`
            : `linear-gradient(180deg, ${cat.color}18 0%, ${cat.color}40 100%)`,
          transition: "height 500ms cubic-bezier(0.34,1.56,0.64,1)",
        }} />
        {/* Shine */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "50%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 100%)",
          pointerEvents: "none", zIndex: 2,
        }} />
        {/* Icon */}
        <cat.icon size={15} style={{ position: "relative", zIndex: 3, color: iconColor, transition: "color 300ms ease" }} />
      </div>
    </div>
  );
}

/* ─── Modal shell ─── */
function Modal({ title, icon: Icon, color, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 20, width: "100%", maxWidth: 520,
        maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 32px 80px -12px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px",
          borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}15`,
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={16} style={{ color }} />
          </div>
          <span style={{ fontWeight: 900, fontSize: 14, color: "#1a1a2e", letterSpacing: "-0.02em" }}>{title}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 8,
            background: "#f5f5f5", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={13} style={{ color: "#666" }} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ─── Pages modal ─── */
function PagesModal({ user, pagePerms, onChange, onClose }) {
  const isOn = (key) => pagePerms[key] !== false; // default true

  const parentState = (parent) => {
    if (!parent.children) return isOn(parent.key) ? "all" : "none";
    const states = parent.children.map(c => isOn(c.key));
    if (states.every(Boolean)) return "all";
    if (states.every(s => !s)) return "none";
    return "some";
  };

  const toggleSingle = (key) => onChange({ ...pagePerms, [key]: !isOn(key) });

  const toggleParent = (parent) => {
    const next = parentState(parent) !== "all";
    const keys = parent.children ? [...parent.children.map(c => c.key), parent.key] : [parent.key];
    const updated = { ...pagePerms };
    keys.forEach(k => { updated[k] = next; });
    onChange(updated);
  };

  const enabledCount = ALL_PAGE_KEYS.filter(k => isOn(k)).length;

  return (
    <Modal title={`Pages — ${user.username ?? user.email}`} icon={Shield} color="#1a2f8a" onClose={onClose}>
      <div style={{ padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 20px 12px", borderBottom: "1px solid #f5f5f5" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>
            {enabledCount}/{ALL_PAGE_KEYS.length} pages enabled
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { const u = {}; ALL_PAGE_KEYS.forEach(k => u[k] = true); onChange(u); }}
              style={{ fontSize: 10, fontWeight: 900, color: "#1a2f8a", background: "#eef1fb", border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
              All on
            </button>
            <button onClick={() => { const u = {}; ALL_PAGE_KEYS.forEach(k => u[k] = false); onChange(u); }}
              style={{ fontSize: 10, fontWeight: 900, color: "#94a3b8", background: "#f5f5f5", border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
              All off
            </button>
          </div>
        </div>
        {PAGE_TREE.map(parent => (
          <div key={parent.key}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 20px", background: "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "#1a1a2e" }}>{parent.label}</span>
              <Toggle checked={parentState(parent) === "all"} onChange={() => toggleParent(parent)} color="#1a2f8a" size="sm" />
            </div>
            {parent.children?.map(child => (
              <div key={child.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 20px 9px 36px", borderBottom: "1px solid #f9f9f9" }}>
                <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{child.label}</span>
                <Toggle checked={isOn(child.key)} onChange={() => toggleSingle(child.key)} color="#1a2f8a" size="sm" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ─── List modal ─── */
function ListModal({ title, icon, color, items, selected, onChange, onClose }) {
  const [q, setQ] = useState("");
  const filtered = items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase()));
  const allOn = items.length > 0 && items.every(i => selected.includes(i.id));

  const toggle = (id) => selected.includes(id)
    ? onChange(selected.filter(x => x !== id))
    : onChange([...selected, id]);

  return (
    <Modal title={title} icon={icon} color={color} onClose={onClose}>
      {items.length > 6 && (
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f5f5f5", borderRadius: 10, padding: "7px 12px" }}>
            <Search size={12} style={{ color: "#94a3b8", flexShrink: 0 }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 12, color: "#374151", width: "100%" }} />
          </div>
          <div style={{ height: 12 }} />
        </div>
      )}
      <div style={{ padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 20px 10px", borderBottom: "1px solid #f5f5f5" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>{selected.length}/{items.length} selected</span>
          <button onClick={() => onChange(allOn ? [] : items.map(i => i.id))}
            style={{ fontSize: 10, fontWeight: 900, border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer",
              color: allOn ? "#94a3b8" : color, background: allOn ? "#f5f5f5" : `${color}15` }}>
            {allOn ? "Deselect all" : "Select all"}
          </button>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 12, color: "#94a3b8" }}>No items found</div>
        )}
        {filtered.map(item => {
          const on = selected.includes(item.id);
          return (
            <div key={item.id} onClick={() => toggle(item.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px",
                borderBottom: "1px solid #f9f9f9", cursor: "pointer",
                background: on ? `${color}06` : "transparent" }}
              onMouseEnter={e => e.currentTarget.style.background = `${color}0d`}
              onMouseLeave={e => e.currentTarget.style.background = on ? `${color}06` : "transparent"}>
              <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `2px solid ${on ? color : "#d1d5db"}`, background: on ? color : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all 150ms ease" }}>
                {on && <Check size={10} style={{ color: "#fff" }} strokeWidth={3} />}
              </div>
<div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </div>
                  {item.meta && <div style={{ fontSize: 10, color: "#94a3b8" }}>{item.meta}</div>}
                </div>
                {item.pill && (
                  <span style={{
                    flexShrink: 0,
                    display: "inline-flex", alignItems: "center",
                    padding: "3px 8px", borderRadius: 6,
                    fontSize: 9, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
                    background: `${item.pill.color}18`,
                    color: item.pill.color,
                    border: `1px solid ${item.pill.color}30`,
                  }}>
                    {item.pill.text}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ─── Create user modal ─── */
function CreateUserModal({ existingEmails, onClose, onCreate }) {
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
    <Modal title="Add user" icon={UserPlus} color="#1a2f8a" onClose={onClose}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
<p style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, margin: 0 }}>
          The new user is added to this company as <strong style={{ color: "#1a2f8a" }}>Regular</strong>.
          They will set their password the first time they sign in. You can promote them to Admin afterwards.
        </p>

        <div>
          <label style={{ fontSize: 10, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em" }}>Email</label>
          <input
            type="email" value={email} autoFocus
            onChange={e => { setEmail(e.target.value); setErr(""); }}
            placeholder="user@company.com"
            style={{
              marginTop: 6, width: "100%",
              padding: "10px 12px", borderRadius: 10,
              border: `1.5px solid ${email && !emailValid ? "#e8394a55" : emailTaken ? "#e8394a55" : "rgba(26,47,138,0.15)"}`,
              fontSize: 13, fontWeight: 600, color: "#1a1a2e",
              background: "#fff", outline: "none",
            }} />
          {email && !emailValid && (
            <p style={{ fontSize: 10, color: "#e8394a", fontWeight: 700, marginTop: 4 }}>Invalid email</p>
          )}
          {emailTaken && (
            <p style={{ fontSize: 10, color: "#e8394a", fontWeight: 700, marginTop: 4 }}>Already in this company</p>
          )}
        </div>

        <div>
          <label style={{ fontSize: 10, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em" }}>Username</label>
          <input
            type="text" value={username}
            onChange={e => { setUsername(e.target.value); setErr(""); }}
            placeholder="Jane Doe"
            style={{
              marginTop: 6, width: "100%",
              padding: "10px 12px", borderRadius: 10,
              border: "1.5px solid rgba(26,47,138,0.15)",
              fontSize: 13, fontWeight: 600, color: "#1a1a2e",
              background: "#fff", outline: "none",
            }} />
        </div>



        {err && (
          <div style={{ padding: "8px 12px", borderRadius: 10, background: "#fee2e2", border: "1px solid #fecaca",
            fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "8px 14px", borderRadius: 10, border: "none",
              background: "#f5f5f7", color: "#475569",
              fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase",
              cursor: busy ? "default" : "pointer",
            }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "8px 14px", borderRadius: 10, border: "none",
              display: "flex", alignItems: "center", gap: 6,
              background: canSubmit ? "linear-gradient(135deg, #1a2f8a 0%, #3a5fd9 100%)" : "#cbd5e1",
              color: "#fff",
              fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase",
              cursor: canSubmit ? "pointer" : "not-allowed",
              boxShadow: canSubmit ? "0 4px 16px -4px rgba(26,47,138,0.5)" : "none",
            }}>
            {busy && <Loader2 size={11} className="animate-spin" />}
            {busy ? "Creating…" : "Create user"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════ */
export default function UserManagement({ token, preloadedData = {} }) {
  const [companyId, setCompanyId] = useState(null);
  const [myUserId, setMyUserId]   = useState(null);
const [users, setUsers]         = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Current user's role on this company — drives who can change roles.
  // Super-admin (global) overrides everything; admin (per-link) can also edit.
  const me = users.find(u => u.id === myUserId);
  const canEditRoles = !!(me?.is_super_admin || me?.uc_role === "admin");

const [companies,      setCompanies]      = useState(() => preloadedData.companies  ?? []);
  const [structures,     setStructures]     = useState(() => preloadedData.structures ?? []);
  const [sources,        setSources]        = useState(() => preloadedData.sources    ?? []);
  const [dimensions,     setDimensions]     = useState(() => preloadedData.dimensions ?? []);
const [mappings,               setMappings]               = useState([]);
  const [reportMappings,         setReportMappings]         = useState([]);
  const [cashflowMappings,       setCashflowMappings]       = useState([]);
  const [cashflowReportMappings, setCashflowReportMappings] = useState([]);

  // Map<userId, { pages: {pageKey: bool}, companies: string[]|null, structures: string[]|null, ... }>
  // null = no restrictions = all allowed
  const [userPerms, setUserPerms] = useState(new Map());
  const [pending,   setPending]   = useState(new Map());
  const [saving,    setSaving]    = useState(false);
const [modal,     setModal]     = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
const [search,     setSearch]     = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  /* ── Bootstrap ── */
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setMyUserId(uid);
      if (uid) setCompanyId(await getActiveCompanyId(uid));
    })();
  }, []);

/* ── Load users + permissions ── */
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoadingUsers(true);
      try {
// Users
        const { data: ucRows, error: ucErr } = await supabase.schema("accounts")
          .from("user_companies").select("user_id, is_active, role").eq("company_id", companyId);
        if (ucErr) throw ucErr;

        const userIds = (ucRows ?? []).map(r => r.user_id);
        if (!userIds.length) { setUsers([]); setLoadingUsers(false); return; }

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
        setUsers(combined);

        // Permissions — from public schema (no .schema("accounts"))
        const [pageRows, resourceRows] = await Promise.all([
          listUserPermissions({ companyId }).catch(() => []),
          listUserResourceAccess({ companyId }).catch(() => []),
        ]);

        const permsMap = new Map();
        combined.forEach(u => {
          // Pages: default true when no row
          const pages = {};
          (pageRows ?? []).filter(r => r.user_id === u.id).forEach(r => { pages[r.page_key] = r.allowed; });

          // Resources: null = no rows yet = all allowed
          const res = (resourceRows ?? []).filter(r => r.user_id === u.id);
          const hasKind = (kind) => res.some(r => r.resource_kind === kind);
          const pick    = (kind) => res.filter(r => r.resource_kind === kind && r.allowed).map(r => r.resource_id);

          permsMap.set(u.id, {
            pages,
            companies:  hasKind("company")   ? pick("company")   : null,
            structures: hasKind("structure")  ? pick("structure") : null,
            sources:    hasKind("source")     ? pick("source")    : null,
            dimensions: hasKind("dimension")  ? pick("dimension") : null,
            mappings:   hasKind("mapping")    ? pick("mapping")   : null,
          });
        });
        setUserPerms(permsMap);
} catch (e) {
        console.error("Error loading users:", e);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  /* ── Load resources ── */
// preloadedData is consumed via lazy init above; no effect needed.

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
      // Functional updaters: only fill in when the current list is empty, so
      // we don't clobber preloadedData that arrived via lazy init.
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

  /* ── Item lists ── */
  const companyItems   = useMemo(() => companies.map(c => ({ id: String(c.CompanyShortName ?? c), label: String(c.CompanyLegalName ?? c.CompanyShortName ?? c), meta: c.CompanyShortName ?? null })), [companies]);
  const structureItems = useMemo(() => structures.map(s => ({ id: String(s.GroupStructure ?? s), label: String(s.GroupStructure ?? s) })), [structures]);
  const sourceItems    = useMemo(() => sources.map(s => ({ id: String(s.Source ?? s), label: String(s.Source ?? s) })), [sources]);
 const dimensionItems = useMemo(() => dimensions.map(d => {
    const code = String(d.DimensionCode ?? d.dimensionCode ?? d.code ?? d.Code ?? "");
    const name = String(d.DimensionName ?? d.dimensionName ?? d.name ?? d.Name ?? code);
    return { id: code || name, label: name, meta: code && code !== name ? code : null };
  }), [dimensions]);
const mappingItems   = useMemo(() => [
    ...mappings.map(m               => ({ id: `sm:${m.mapping_id}`,  label: m.name ?? "Untitled", pill: { text: "Structure", color: "#7c3aed" } })),
    ...reportMappings.map(m         => ({ id: `rm:${m.mapping_id}`,  label: m.name ?? "Untitled", pill: { text: "Report",    color: "#CF305D" } })),
    ...cashflowMappings.map(m       => ({ id: `cm:${m.mapping_id}`,  label: m.name ?? "Untitled", pill: { text: "CF",        color: "#0891b2" } })),
    ...cashflowReportMappings.map(m => ({ id: `crm:${m.mapping_id}`, label: m.name ?? "Untitled", pill: { text: "CF Report", color: "#d97706" } })),
  ], [mappings, reportMappings, cashflowMappings, cashflowReportMappings]);

  const itemsForCategory = (cat) => ({
    companies: companyItems, structures: structureItems, sources: sourceItems,
    dimensions: dimensionItems, mappings: mappingItems,
  }[cat] ?? []);

  /* ── Perms helpers ── */
  const getPerms = (uid) => userPerms.get(uid) ?? { pages: {}, companies: null, structures: null, sources: null, dimensions: null, mappings: null };

  const patchPerms = (uid, patch) => {
    setUserPerms(prev => { const m = new Map(prev); m.set(uid, { ...getPerms(uid), ...patch }); return m; });
    setPending(prev => { const m = new Map(prev); m.set(uid, { ...(m.get(uid) ?? {}), ...patch }); return m; });
  };

// Sets the user's combined state on this company: "inactive" | "regular" | "admin".
  // - "inactive" sets is_active=false on both the user and the link
  // - "regular"/"admin" sets is_active=true on the link and updates the role
  const setUserState = async (u, nextState) => {
    if (!canEditRoles) return;
    if (u.id === myUserId && nextState !== (u.uc_role ?? "regular")) {
      // Allow toggling your own active state but warn if you're demoting yourself out of admin
      if (u.uc_role === "admin" && nextState === "regular") {
        if (!window.confirm("Demote yourself to regular? You will lose admin permissions on this company.")) return;
      }
    }

    const prev = { is_active: u.is_active, uc_is_active: u.uc_is_active, uc_role: u.uc_role };
    const patch =
      nextState === "inactive" ? { is_active: false, uc_is_active: false, uc_role: u.uc_role ?? "regular" } :
      nextState === "admin"    ? { is_active: true,  uc_is_active: true,  uc_role: "admin" } :
                                 { is_active: true,  uc_is_active: true,  uc_role: "regular" };

    setUsers(list => list.map(x => x.id === u.id ? { ...x, ...patch } : x));

    const linkUpdate = { is_active: patch.uc_is_active, role: patch.uc_role };
    const { error: linkErr } = await supabase.schema("accounts").from("user_companies")
      .update(linkUpdate).eq("user_id", u.id).eq("company_id", companyId);

    // Keep global users.is_active in sync only when going inactive (or back to active)
    const { error: userErr } = await supabase.schema("accounts").from("users")
      .update({ is_active: patch.is_active }).eq("id", u.id);

if (linkErr || userErr) {
      // Rollback
      setUsers(list => list.map(x => x.id === u.id ? { ...x, ...prev } : x));
      alert("Update failed: " + (linkErr?.message ?? userErr?.message));
    }
  };

  /* ── Create user for this company ── */
const createUser = async ({ email, username }) => {
    if (!canEditRoles) throw new Error("Not allowed");
    if (!companyId)    throw new Error("No active company");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired, please sign in again");

    const res = await fetch(
      "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/create-company-user",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email:      email.trim(),
          username:   username.trim(),
          company_id: companyId,
          role:       "regular",
        }),
      }
    );
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? `Error ${res.status}`);

    // Append to local list
    setUsers(prev => [...prev, {
      id: result.user_id,
      username: username.trim(),
      email: email.trim(),
      is_active: true,
      is_super_admin: false,
      uc_is_active: true,
      uc_role: "regular",
    }].sort((a, b) => String(a.username ?? a.email ?? "").localeCompare(String(b.username ?? b.email ?? ""))));
  };

  /* ── Delete user from this company ── */
  // - If the user only belongs to THIS company → fully delete (edge function: auth + accounts.users cascade)
  // - Otherwise → just remove the user_companies link
  const deleteUser = async (u) => {
    if (!canEditRoles) return;
    if (u.id === myUserId) {
      alert("You cannot remove yourself.");
      return;
    }

    // Count this user's company links
    const { data: links, error: linksErr } = await supabase.schema("accounts")
      .from("user_companies").select("company_id").eq("user_id", u.id);
    if (linksErr) { alert("Failed to check user companies: " + linksErr.message); return; }

    const isOnlyHere = (links ?? []).length <= 1;
    const msg = isOnlyHere
      ? `Permanently delete ${u.username ?? u.email}? They don't belong to any other company so they'll be removed completely.`
      : `Remove ${u.username ?? u.email} from this company? They'll keep access to their other companies.`;
    if (!window.confirm(msg)) return;

    // Optimistic: remove from list
    const prevUsers = users;
    setUsers(prev => prev.filter(x => x.id !== u.id));
    setPending(prev => { const m = new Map(prev); m.delete(u.id); return m; });

    try {
      if (isOnlyHere) {
        // Full delete via edge function
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Session expired");

        const res = await fetch(
          "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/delete-user",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ user_id: u.id, company_id: companyId }),
          }
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? `Error ${res.status}`);
      } else {
        // Just unlink from this company
        const { error: delErr } = await supabase.schema("accounts").from("user_companies")
          .delete().eq("user_id", u.id).eq("company_id", companyId);
        if (delErr) throw new Error(delErr.message);
      }
    } catch (e) {
      // Rollback
      setUsers(prevUsers);
      alert("Delete failed: " + e.message);
    }
  };

  /* ── Save ── */
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
          // null means all allowed — write every item as allowed=true
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
        pageRows.length     ? upsertUserPermissions(pageRows)       : Promise.resolve(),
        resourceRows.length ? upsertUserResourceAccess(resourceRows) : Promise.resolve(),
      ]);
      setPending(new Map());
    } catch (e) {
      alert("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Counts ── */
  const countFor = (uid, cat) => {
    const perms = getPerms(uid);
    if (cat === "pages") return ALL_PAGE_KEYS.filter(k => perms.pages[k] !== false).length;
    const list = perms[cat];
    if (list === null) return itemsForCategory(cat).length; // all allowed
    return (list ?? []).length;
  };
  const totalFor = (cat) => cat === "pages" ? ALL_PAGE_KEYS.length : itemsForCategory(cat).length;

  /* ── Filtered users ── */
  const filteredUsers = useMemo(() =>
    users.filter(u => !search || [u.username, u.email].some(v => v?.toLowerCase().includes(search.toLowerCase()))),
    [users, search]);

  /* ── Modal ── */
  const modalUser = modal ? users.find(u => u.id === modal.userId) : null;
  const modalCat  = modal ? CATEGORY_BUTTONS.find(c => c.key === modal.category) : null;

return (
  <div className="flex flex-col flex-1 min-h-0 gap-4">
<style>{`
        .um-search-input::placeholder { color: #c8ccdb; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; font-size: 11px; }
        .um-row:hover .um-trash { opacity: 1 !important; }
      `}</style>



      {/* Table */}
<div style={{ flex: 1, minHeight: 0, background: "#fff", borderRadius: 20, border: "1px solid rgba(26,47,138,0.08)",
        boxShadow: "0 8px 40px -12px rgba(26,47,138,0.15), 0 2px 8px -2px rgba(0,0,0,0.04)",
        overflow: "hidden", display: "flex", flexDirection: "column" }}>
<div style={{ display: "grid", gridTemplateColumns: "2fr 36px 180px repeat(6, 1fr) auto", alignItems: "center",
          padding: "12px 24px", borderBottom: "1px solid #f0f0f0",
          background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", flexShrink: 0,
          boxShadow: "0 4px 24px -8px rgba(26,47,138,0.08)" }}>
<div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
            <button onClick={() => setSearchOpen(o => !o)}
              style={{ border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0,
                color: searchOpen ? "#1a2f8a" : "#94a3b8", transition: "color 200ms ease", display: "flex" }}>
              <Search size={13} />
            </button>
            <div style={{
              maxWidth: searchOpen ? 180 : 0,
              opacity: searchOpen ? 1 : 0,
              overflow: "hidden",
              transition: "max-width 300ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease",
            }}>
<input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false); }}
                placeholder="User"
                className="um-search-input"
                style={{
                  border: "none", background: "transparent", outline: "none",
                  fontSize: 11, fontWeight: 900, color: "#1a2f8a",
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  width: 180, display: "block",
                  "::placeholder": { color: "#c8ccdb" },
                }}
              />
            </div>
{!searchOpen && (
              <span onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }} style={{ fontSize: 11, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em", cursor: "pointer" }}>
                User
              </span>
            )}
          </div>
<span /> {/* trash column spacer */}
          <span style={{ fontSize: 11, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em", textAlign: "center" }}>Status</span>
          {CATEGORY_BUTTONS.map(cat => (
            <span key={cat.key} style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", textAlign: "center", color: `${cat.color}99`, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <cat.icon size={10} style={{ color: `${cat.color}99` }} />
              {cat.label}
            </span>
))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
{pending.size > 0 && canEditRoles && (
              <button onClick={save} disabled={saving} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 10, border: "none",
                background: saving ? "#94a3b8" : "linear-gradient(135deg, #1a2f8a 0%, #3a5fd9 100%)",
                color: "#fff", cursor: saving ? "default" : "pointer",
                fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", flexShrink: 0,
                boxShadow: saving ? "none" : "0 4px 16px -4px rgba(26,47,138,0.5)",
              }}>
                {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                {saving ? "Saving…" : `Save ${pending.size}`}
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {loadingUsers ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, gap: 10, color: "#94a3b8", fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" /> Loading users…
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>No users found</div>
          ) : filteredUsers.map(u => {
            const isActive = u.is_active && u.uc_is_active;
            const isDirty  = pending.has(u.id);
            const initials = String(u.username ?? u.email ?? "U").slice(0, 2).toUpperCase();
return (
<div key={u.id} className="um-row" style={{
                display: "grid", gridTemplateColumns: "2fr 36px 180px repeat(6, 1fr)",
                alignItems: "center", padding: "12px 24px", borderBottom: "1px solid #f5f5f7",
                background: isDirty ? "linear-gradient(90deg, #fffdf0 0%, #ffffff 100%)" : "transparent",
                transition: "background 200ms",
              }}
                onMouseEnter={e => { if (!isDirty) e.currentTarget.style.background = "#f8f9ff"; }}
                onMouseLeave={e => { e.currentTarget.style.background = isDirty ? "linear-gradient(90deg, #fffdf0 0%, #ffffff 100%)" : "transparent"; }}>
                {/* User */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  {isDirty && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0, boxShadow: "0 0 6px #f59e0b" }} />}
<div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                    background: `linear-gradient(135deg, #1a2f8a 0%, #3a5fd9 100%)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 4px 12px -4px rgba(26,47,138,0.4)" }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: "#fff", letterSpacing: "0.02em" }}>{initials}</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.username ?? "—"}
                      {u.id === myUserId && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase" }}>(you)</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                  </div>
                </div>

{/* Trash — inline slot between user and status */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  {canEditRoles && u.id !== myUserId && (
                    <button
                      className="um-trash"
                      onClick={(e) => { e.stopPropagation(); deleteUser(u); }}
                      title="Remove user"
                      style={{
                        width: 26, height: 26, borderRadius: 8,
                        border: "none",
                        background: "rgba(232,57,74,0.08)",
                        color: "#e8394a",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: 0,
                        transition: "opacity 150ms ease, background 150ms ease",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(232,57,74,0.18)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(232,57,74,0.08)"; }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* Status: Inactive · Regular · Admin */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <StateSegmented
                    user={u}
                    disabled={!canEditRoles}
                    onChange={(next) => setUserState(u, next)}
                  />
                </div>

{/* Category buttons */}
{CATEGORY_BUTTONS.map(cat => (
                  <div key={cat.key} style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <CatButton
                      cat={cat}
                      count={countFor(u.id, cat.key)}
                      total={totalFor(cat.key)}
                      disabled={!canEditRoles}
                      onClick={() => setModal({ userId: u.id, category: cat.key })}
                    />
                  </div>
                ))}

</div>
            );
          })}

          {/* Add user row — only for admins / super-admins */}
          {!loadingUsers && canEditRoles && (
            <button
              onClick={() => setCreateOpen(true)}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                padding: "16px 24px",
                background: "transparent",
                border: "none",
                borderTop: "1px dashed rgba(26,47,138,0.15)",
                cursor: "pointer",
                color: "#1a2f8a",
                fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase",
                transition: "background 200ms ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(26,47,138,0.04)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              <Plus size={14} />
              Add user
            </button>
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && modalUser && modalCat && (() => {
        const perms = getPerms(modalUser.id);

        if (modal.category === "pages") {
          return (
            <PagesModal
              user={modalUser}
              pagePerms={perms.pages}
              onChange={(newPages) => patchPerms(modalUser.id, { pages: newPages })}
              onClose={() => setModal(null)}
            />
          );
        }

        const items = itemsForCategory(modal.category);
        const raw = perms[modal.category];
        // null = all allowed, show all selected
        const selected = raw === null ? items.map(i => i.id) : (raw ?? items.map(i => i.id));

return (
          <ListModal
            title={`${modalCat.label} — ${modalUser.username ?? modalUser.email}`}
            icon={modalCat.icon}
            color={modalCat.color}
            items={items}
            selected={selected}
            onChange={(sel) => patchPerms(modalUser.id, { [modal.category]: sel })}
            onClose={() => setModal(null)}
          />
        );
      })()}

      {createOpen && (
        <CreateUserModal
          existingEmails={new Set(users.map(u => u.email?.toLowerCase()).filter(Boolean))}
          onClose={() => setCreateOpen(false)}
          onCreate={createUser}
        />
      )}
    </div>
  );
}