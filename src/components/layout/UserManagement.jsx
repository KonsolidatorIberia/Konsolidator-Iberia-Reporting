import { useState, useEffect, useMemo } from "react";
import { Shield, Loader2, ChevronRight, ChevronLeft, Check, Minus, Building2, Network, Database, Library, Users as UsersIcon } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { listPermissions, upsertPermission } from "../../lib/permissionsApi";
import { listResourceAccess, upsertResourceAccess } from "../../lib/resourceAccessApi";
import { listMappings, getActiveCompanyId } from "../../lib/mappingsApi";
import { listMappings as listReportMappings } from "../../lib/reportMappingsApi";

const PERMISSION_TREE = [
  { key: "home", label: "Home" },
  { key: "individual", label: "Individual", children: [
    { key: "individual-data", label: "Data" },
    { key: "individual-kpis", label: "KPIs" },
    { key: "individual-dimensiones", label: "Dimensions" },
    { key: "individual-cashflow", label: "Cashflow" },
    { key: "individual-memory-notes", label: "Memory Notes" },
  ]},
  { key: "consolidated", label: "Consolidated", children: [
    { key: "individual-contributive", label: "Contributive" },
    { key: "consolidated-sheet", label: "Sheet" },
    { key: "consolidated-kpis", label: "KPIs" },
    { key: "consolidated-dimensiones", label: "Dimensions" },
    { key: "consolidated-cashflow", label: "Cashflow" },
    { key: "consolidated-notes", label: "Memory Notes" },
  ]},
  { key: "controlling", label: "Controlling", children: [
    { key: "controlling-forecast", label: "Forecasting" },
    { key: "controlling-adjustments", label: "Adjustments" },
    { key: "controlling-kpis", label: "KPIs" },
  ]},
  { key: "views", label: "Views", children: [
    { key: "mappings", label: "Mappings" },
  ]},
  { key: "data-explorer", label: "Data Explorer", children: [
    { key: "structure", label: "Structure" },
  ]},
  { key: "settings", label: "Settings", children: [
    { key: "settings-personalization", label: "Personalization" },
    { key: "settings-security", label: "Security" },
  ]},
];

const PERMISSION_ROLES = [
  { key: "admin", label: "Admin", color: "#1a2f8a", bgSoft: "#eef1fb", desc: "Full access" },
  { key: "base",  label: "Base",  color: "#57aa78", bgSoft: "#dcfce7", desc: "Standard user" },
  { key: "low",   label: "Low",   color: "#94a3b8", bgSoft: "#f1f5f9", desc: "Restricted" },
];

const CARDS = [
  { key: "pages",            label: "Pages",                    desc: "Sidebar pages by role",                  icon: Shield,    color: "#1a2f8a", bgSoft: "#eef1fb" },
  { key: "companies",        label: "Companies & Structures",   desc: "Konsolidator companies & group structures", icon: Building2, color: "#dc7533", bgSoft: "#fef3c7" },
  { key: "sources",          label: "Sources & Dimensions",     desc: "Data sources & dimension filters",       icon: Network,   color: "#57aa78", bgSoft: "#dcfce7" },
  { key: "mappings",         label: "Mappings",                 desc: "Structure & report mappings",            icon: Library,   color: "#CF305D", bgSoft: "#fef1f5" },
{ key: "users",            label: "Users",                    desc: "Members of your company",                icon: UsersIcon, color: "#7c3aed", bgSoft: "#ede9fe" },
  { key: "data",             label: "Data",                     desc: "Coming soon",                            icon: Database,  color: "#0891b2", bgSoft: "#cffafe" },
];

// ─── Toggle ───────────────────────────────────────────────
function Toggle({ checked, indeterminate, color, onClick }) {
  return (
    <button onClick={onClick}
      className="relative inline-flex items-center w-9 h-5 rounded-full transition-all flex-shrink-0"
      style={{
        background: checked || indeterminate ? color : "#e5e7eb",
        boxShadow: checked || indeterminate ? `0 2px 8px -2px ${color}80` : "inset 0 1px 2px rgba(0,0,0,0.05)",
      }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md flex items-center justify-center transition-all"
        style={{ left: checked || indeterminate ? "18px" : "2px" }}>
        {indeterminate && <Minus size={8} strokeWidth={4} style={{ color }} />}
        {checked && !indeterminate && <Check size={8} strokeWidth={4} style={{ color }} />}
      </span>
    </button>
  );
}

// ─── Pages drill-in (existing matrix) ───────────────────────────────────
function PagesView({ companyId, userId, onDirtyChange, saveSignal, discardSignal }) {
  const [perms, setPerms] = useState(new Map());      // server snapshot
  const [pending, setPending] = useState(new Map());  // local edits
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set());

useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    listPermissions({ companyId })
      .then(rows => {
        const map = new Map();
        rows.forEach(r => map.set(`${r.role}:${r.page_key}`, r.allowed));
        setPerms(map);

        // If no rows exist for a role, prepopulate `pending` with role defaults
        // so the next save writes them all.
        const allKeys = [];
        const collect = (nodes) => nodes.forEach(n => {
          allKeys.push(n.key);
          if (n.children) collect(n.children);
        });
        collect(PERMISSION_TREE);

        const newPending = new Map();
        PERMISSION_ROLES.forEach(r => {
          const hasAny = rows.some(row => row.role === r.key);
          if (!hasAny) {
            const def = r.key === "low" ? false : true;
            allKeys.forEach(k => newPending.set(`${r.key}:${k}`, def));
          }
        });
        setPending(newPending);
      })
      .catch(() => setPerms(new Map()))
      .finally(() => setLoading(false));
  }, [companyId]);

  const dirtyCount = pending.size;
  useEffect(() => { onDirtyChange?.(dirtyCount); }, [dirtyCount, onDirtyChange]);

  const isAllowed = (role, key) => {
    const k = `${role}:${key}`;
    if (pending.has(k)) return pending.get(k);
    if (perms.has(k)) return perms.get(k);
    if (role === "admin") return true;
    if (role === "base") return true;
    return false;
  };

  const parentState = (role, parent) => {
    if (!parent.children) return isAllowed(role, parent.key) ? "all" : "none";
    const states = parent.children.map(c => isAllowed(role, c.key));
    if (states.every(s => s)) return "all";
    if (states.every(s => !s)) return "none";
    return "some";
  };

const stage = (role, key, next) => {
    setPending(prev => {
      const m = new Map(prev);
      const k = `${role}:${key}`;
      // Server value: explicit row, else default (admin=true, base=true, low=false)
      const serverVal = perms.has(k) ? perms.get(k) : (role === "admin" || role === "base");
      if (next === serverVal && perms.has(k)) {
        // Only drop from pending if both equal AND a server row exists.
        // If no server row exists, ALWAYS stage so we persist the default.
        m.delete(k);
      } else {
        m.set(k, next);
      }
      return m;
    });
  };
  const toggleSingle = (role, key) => {
    const next = !isAllowed(role, key);
    stage(role, key, next);
  };

  const toggleParent = (role, parent) => {
    const next = parentState(role, parent) !== "all";
    const keys = parent.children ? parent.children.map(c => c.key) : [parent.key];
    if (parent.children) keys.push(parent.key);
    keys.forEach(k => stage(role, k, next));
  };

  useEffect(() => {
    if (!saveSignal) return;
    (async () => {
      if (pending.size === 0) { saveSignal.done?.(); return; }
      setSaving(true);
      const updates = [...pending.entries()];
      try {
        await Promise.all(updates.map(([k, val]) => {
          const [role, ...keyParts] = k.split(":");
          const pageKey = keyParts.join(":");
          return upsertPermission({ companyId, role, pageKey, allowed: val, userId });
        }));
        setPerms(prev => {
          const m = new Map(prev);
          updates.forEach(([k, v]) => m.set(k, v));
          return m;
        });
        setPending(new Map());
        saveSignal.done?.();
      } catch (e) {
        alert("Failed to save: " + e.message);
        saveSignal.failed?.(e);
      } finally { setSaving(false); }
    })();
  }, [saveSignal]);

  useEffect(() => {
    if (!discardSignal) return;
    setPending(new Map());
    discardSignal.done?.();
  }, [discardSignal]);

  const toggleCollapse = (k) => setCollapsed(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; });

if (loading) return <div className="flex items-center justify-center py-20 gap-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Loading…</div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
      {dirtyCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
          {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
          {saving && <Loader2 size={11} className="animate-spin ml-1" />}
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <header className="px-5 py-3.5 border-b border-gray-50 bg-gray-50/40 flex items-center gap-2 flex-shrink-0">
        <Shield size={13} className="text-[#1a2f8a]/60" />
        <h2 className="text-xs font-black uppercase tracking-widest text-[#1a2f8a]">Page access matrix</h2>
      </header>
      <div className="grid items-center px-5 py-3 border-b border-gray-100 bg-white flex-shrink-0"
        style={{ gridTemplateColumns: "1fr 110px 110px 110px" }}>
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Page</span>
        {PERMISSION_ROLES.map(r => (
          <div key={r.key} className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: r.color }}>{r.label}</span>
            <span className="w-6 h-0.5 rounded-full" style={{ background: r.color, opacity: 0.4 }} />
          </div>
        ))}
      </div>
      <div className="divide-y divide-gray-50 flex-1 min-h-0 overflow-y-auto">
        {PERMISSION_TREE.map(parent => {
          const isCollapsed = collapsed.has(parent.key);
          const hasChildren = !!parent.children;
          return (
            <div key={parent.key}>
              <div onClick={hasChildren ? () => toggleCollapse(parent.key) : undefined}
                className={`grid items-center px-5 py-3 hover:bg-gray-50/60 transition-colors ${hasChildren ? "cursor-pointer" : ""}`}
                style={{ gridTemplateColumns: "1fr 110px 110px 110px" }}>
                <div className="flex items-center gap-2">
                  {hasChildren
                    ? <ChevronRight size={12} className="text-gray-400 transition-transform flex-shrink-0" style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }} />
                    : <span className="w-3 flex-shrink-0" />}
                  <span className="text-sm font-black text-gray-800">{parent.label}</span>
                </div>
                {PERMISSION_ROLES.map(r => {
                  const state = parentState(r.key, parent);
                  return (
                    <div key={r.key} className="flex justify-center" onClick={e => e.stopPropagation()}>
                      <Toggle checked={state === "all"} indeterminate={state === "some"} color={r.color}
                        onClick={() => toggleParent(r.key, parent)} />
                    </div>
                  );
                })}
              </div>
              {hasChildren && (
                <div className="overflow-hidden transition-all"
                  style={{ maxHeight: isCollapsed ? 0 : `${parent.children.length * 44}px` }}>
                  {parent.children.map(child => (
                    <div key={child.key} className="grid items-center px-5 py-2 hover:bg-gray-50/40"
                      style={{ gridTemplateColumns: "1fr 110px 110px 110px" }}>
                      <div className="flex items-center gap-2 pl-5">
                        <span className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />
                        <span className="text-[12px] text-gray-500 font-medium">{child.label}</span>
                      </div>
                      {PERMISSION_ROLES.map(r => (
                        <div key={r.key} className="flex justify-center">
                          <Toggle checked={isAllowed(r.key, child.key)} color={r.color}
                            onClick={() => toggleSingle(r.key, child.key)} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
})}
      </div>
      </div>
    </div>
  );
}

// ─── Generic resource list view (Companies / Structures+Sources / Mappings) ───
function ResourceListView({ companyId, userId, sections, loadingData, onDirtyChange, saveSignal, discardSignal }) {
  const [access, setAccess] = useState(new Map());      // server snapshot
  const [pending, setPending] = useState(new Map());    // local edits
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set());
  const toggleCollapse = (k) => setCollapsed(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; });

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    listResourceAccess({ companyId })
      .then(rows => {
        const m = new Map();
        rows.forEach(r => m.set(`${r.resource_kind}:${r.role}:${r.resource_id}`, r.allowed));
        setAccess(m);
        setPending(new Map());
      })
      .catch(() => setAccess(new Map()))
      .finally(() => setLoading(false));
  }, [companyId]);

  const dirtyCount = pending.size;
  useEffect(() => { onDirtyChange?.(dirtyCount); }, [dirtyCount, onDirtyChange]);

  const isAllowed = (kind, role, id) => {
    const k = `${kind}:${role}:${id}`;
    if (pending.has(k)) return pending.get(k);
    if (access.has(k)) return access.get(k);
    if (role === "admin") return true;
    if (role === "base") return true;
    return false;
  };

  const toggle = (kind, role, id) => {
    const current = isAllowed(kind, role, id);
    const next = !current;
    const k = `${kind}:${role}:${id}`;
    // Compare against server value: if next === server, drop from pending
    const serverVal = access.has(k) ? access.get(k) : (role === "admin" || role === "base");
    setPending(prev => {
      const m = new Map(prev);
      if (next === serverVal) m.delete(k);
      else m.set(k, next);
      return m;
    });
  };

  // Save signal from parent
  useEffect(() => {
    if (!saveSignal) return;
    (async () => {
      if (pending.size === 0) { saveSignal.done?.(); return; }
      setSaving(true);
      const updates = [...pending.entries()];
      try {
        await Promise.all(updates.map(([k, val]) => {
          const [kind, role, ...idParts] = k.split(":");
          const id = idParts.join(":");
          return upsertResourceAccess({ companyId, role, resourceKind: kind, resourceId: id, allowed: val, userId });
        }));
        setAccess(prev => {
          const m = new Map(prev);
          updates.forEach(([k, v]) => m.set(k, v));
          return m;
        });
        setPending(new Map());
        saveSignal.done?.();
      } catch (e) {
        alert("Failed to save: " + e.message);
        saveSignal.failed?.(e);
      } finally { setSaving(false); }
    })();
  }, [saveSignal]);

  // Discard signal from parent
  useEffect(() => {
    if (!discardSignal) return;
    setPending(new Map());
    discardSignal.done?.();
  }, [discardSignal]);

  if (loading || loadingData) return <div className="flex items-center justify-center py-20 gap-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Loading…</div>;

return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1">
      {dirtyCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
          {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
          {saving && <Loader2 size={11} className="animate-spin ml-1" />}
        </div>
      )}
      {sections.map(sec => {
        const isCollapsed = collapsed.has(sec.kind);
        return (
          <section key={sec.kind} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex-shrink-0">
            <header onClick={() => toggleCollapse(sec.kind)}
              className="px-5 py-3.5 border-b border-gray-50 bg-gray-50/40 flex items-center gap-2 cursor-pointer hover:bg-gray-100/40 transition-colors">
              <ChevronRight size={12} className="text-gray-400 transition-transform flex-shrink-0"
                style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }} />
              <h2 className="text-xs font-black uppercase tracking-widest text-[#1a2f8a]">{sec.label}</h2>
              <span className="text-[10px] text-gray-400 ml-1">{sec.items.length}</span>
            </header>
            {!isCollapsed && (
              <>
                <div className="grid items-center px-5 py-3 border-b border-gray-100 bg-white"
                  style={{ gridTemplateColumns: "1fr 110px 110px 110px" }}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Name</span>
                  {PERMISSION_ROLES.map(r => (
                    <div key={r.key} className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: r.color }}>{r.label}</span>
                      <span className="w-6 h-0.5 rounded-full" style={{ background: r.color, opacity: 0.4 }} />
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-gray-50">
                  {sec.items.length === 0 ? (
                    <div className="px-5 py-8 text-center text-xs text-gray-400">No items</div>
                  ) : sec.items.map(item => (
                    <div key={item.id} className="grid items-center px-5 py-2.5 hover:bg-gray-50/40 transition-colors"
                      style={{ gridTemplateColumns: "1fr 110px 110px 110px" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{item.label}</p>
                        {item.meta && <p className="text-[10px] text-gray-400 truncate">{item.meta}</p>}
                      </div>
                      {PERMISSION_ROLES.map(r => {
                        const k = `${sec.kind}:${r.key}:${item.id}`;
                        const isPending = pending.has(k);
                        return (
                          <div key={r.key} className="flex justify-center relative">
                            {isPending && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white z-10" />}
                            <Toggle checked={isAllowed(sec.kind, r.key, item.id)} color={r.color}
                              onClick={() => toggle(sec.kind, r.key, item.id)} />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ─── Users view ─────────────────────────────────────────────
const ROLE_META = {
  admin: { label: "Admin", color: "#1a2f8a", bg: "#eef1fb" },
  base:  { label: "Base",  color: "#57aa78", bg: "#dcfce7" },
  low:   { label: "Low",   color: "#94a3b8", bg: "#f1f5f9" },
};
const ROLE_ORDER = ["admin", "base", "low"];

function UsersView({ companyId, userId, onDirtyChange, saveSignal, discardSignal }) {
  const [users, setUsers] = useState([]);          // server snapshot
  const [pending, setPending] = useState(new Map()); // userId → { role?, is_active?, is_default? }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [roleConfirm, setRoleConfirm] = useState(null); // { userId, nextRole } for self-demotion

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    (async () => {
      try {
        const { data: ucRows, error: ucErr } = await supabase
          .schema("accounts")
          .from("user_companies")
          .select("user_id, role, is_default, is_active, created_at")
          .eq("company_id", companyId);
        if (ucErr) throw ucErr;

        const userIds = [...new Set((ucRows ?? []).map(r => r.user_id))];
        if (userIds.length === 0) { setUsers([]); return; }

        const { data: usersRows, error: usersErr } = await supabase
          .schema("accounts")
          .from("users")
          .select("id, username, email, is_super_admin, is_active, created_at")
          .in("id", userIds);
        if (usersErr) throw usersErr;

        const byId = new Map((usersRows ?? []).map(u => [u.id, u]));
        const combined = (ucRows ?? []).map(uc => ({
          ...byId.get(uc.user_id),
          role: uc.role,
          is_default: uc.is_default,
          uc_is_active: uc.is_active,
          joined_at: uc.created_at,
        })).filter(u => u.id);
        combined.sort((a, b) => {
          const rank = r => ROLE_ORDER.indexOf(r);
          const d = rank(a.role) - rank(b.role);
          if (d !== 0) return d;
          return String(a.username ?? a.email ?? "").localeCompare(String(b.username ?? b.email ?? ""));
        });
        setUsers(combined);
        setPending(new Map());
      } catch (e) {
        setError(e.message ?? "Failed to load users");
      } finally { setLoading(false); }
    })();
  }, [companyId]);

  const dirtyCount = pending.size;
  useEffect(() => { onDirtyChange?.(dirtyCount); }, [dirtyCount, onDirtyChange]);

  const effective = (u) => {
    const p = pending.get(u.id) ?? {};
    return {
      ...u,
      ...p,
      // If is_active is pending, override both flags
      ...(p.is_active !== undefined ? { is_active: p.is_active, uc_is_active: p.is_active } : {}),
    };
  };

const stage = (uid, field, value) => {
    const server = users.find(u => u.id === uid);
    if (!server) return;
    setPending(prev => {
      const m = new Map(prev);
      const cur = { ...(m.get(uid) ?? {}) };
      cur[field] = value;
      Object.keys(cur).forEach(k => {
        const serverField = k === "is_active" ? (server.uc_is_active === true && server.is_active === true) : server[k];
        if (cur[k] === serverField) delete cur[k];
      });
      if (Object.keys(cur).length === 0) m.delete(uid);
      else m.set(uid, cur);
      return m;
    });
  };

  const onRoleChange = (uid, nextRole) => {
    if (uid === userId) {
      setRoleConfirm({ userId: uid, nextRole });
      return;
    }
    stage(uid, "role", nextRole);
  };

  const confirmSelfRoleChange = () => {
    if (!roleConfirm) return;
    stage(roleConfirm.userId, "role", roleConfirm.nextRole);
    setRoleConfirm(null);
  };

  // Save signal
  useEffect(() => {
    if (!saveSignal) return;
    (async () => {
      if (pending.size === 0) { saveSignal.done?.(); return; }
      setSaving(true);
      const entries = [...pending.entries()];
      try {
        // Split: changes to user_companies (role, is_default, is_active) vs users (none for now)
const results = await Promise.all(entries.map(async ([uid, changes]) => {
          const ucPatch = {};
          if (changes.role !== undefined)       ucPatch.role = changes.role;
          if (changes.is_default !== undefined) ucPatch.is_default = changes.is_default;
          if (changes.is_active !== undefined)  ucPatch.is_active = changes.is_active;
          const ops = [];
          if (Object.keys(ucPatch).length > 0) {
            ops.push(supabase.schema("accounts").from("user_companies")
              .update(ucPatch).eq("user_id", uid).eq("company_id", companyId).select());
          }
          if (changes.is_active !== undefined) {
            ops.push(supabase.schema("accounts").from("users")
              .update({ is_active: changes.is_active }).eq("id", uid).select());
          }
          if (ops.length === 0) return { uid, skipped: true };
          const settled = await Promise.all(ops);
          for (const { data, error, status } of settled) {
            if (error) throw new Error(`User ${uid}: ${error.message} (status ${status})`);
            if (!data || data.length === 0) throw new Error(`User ${uid}: update affected 0 rows — RLS likely blocking.`);
          }
          return { uid, data: settled };
        }));
        console.log("[UsersView] save results:", results);
        // Re-fetch
setUsers(prev => {
          const next = prev.map(u => {
            const c = pending.get(u.id);
            if (!c) return u;
            return {
              ...u,
              role: c.role ?? u.role,
              is_default: c.is_default ?? u.is_default,
              uc_is_active: c.is_active ?? u.uc_is_active,
              is_active: c.is_active ?? u.is_active,
            };
          });
          console.log("[UsersView] after save, users:", next.map(x => ({ id: x.id, is_active: x.is_active, uc_is_active: x.uc_is_active })));
          return next;
        });
        setPending(new Map());
        saveSignal.done?.();
      } catch (e) {
        alert("Failed to save user changes: " + (e.message ?? e));
        saveSignal.failed?.(e);
      } finally { setSaving(false); }
    })();
  }, [saveSignal]);

  // Discard signal
  useEffect(() => {
    if (!discardSignal) return;
    setPending(new Map());
    discardSignal.done?.();
  }, [discardSignal]);

  if (loading) return <div className="flex items-center justify-center py-20 gap-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Loading users…</div>;
  if (error) return <div className="flex items-center justify-center py-20 text-xs text-red-400">⚠ {error}</div>;

  // Counts use effective state so the summary reacts to pending changes
  const effList = users.map(effective);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
<div className="grid grid-cols-3 gap-3 flex-shrink-0">
        {ROLE_ORDER.map(r => {
          const count = effList.filter(u => u.role === r).length;
          const meta = ROLE_META[r];
          return (
            <div key={r} className="rounded-2xl border border-gray-100 p-4"
              style={{ background: `linear-gradient(135deg, #ffffff 0%, ${meta.bg} 100%)` }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: meta.color, opacity: 0.7 }}>{meta.label}</p>
              <div className="flex items-baseline gap-1.5">
                <span className="font-black text-2xl" style={{ color: meta.color }}>{count}</span>
                <span className="text-[11px] text-gray-400">{count === 1 ? "user" : "users"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
        <header className="px-5 py-3.5 border-b border-gray-50 bg-gray-50/40 flex items-center gap-2 flex-shrink-0">
          <UsersIcon size={13} className="text-[#7c3aed]" />
          <h2 className="text-xs font-black uppercase tracking-widest text-[#7c3aed]">Members</h2>
          <span className="text-[10px] text-gray-400 ml-1">{users.length}</span>
        </header>
        <div className="grid items-center px-5 py-3 border-b border-gray-100 bg-white flex-shrink-0"
          style={{ gridTemplateColumns: "2fr 2fr 220px 90px 90px" }}>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">User</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Email</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 text-center">Role</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 text-center">Active</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 text-center">Default</span>
        </div>
        <div className="divide-y divide-gray-50 flex-1 min-h-0 overflow-y-auto">
          {users.length === 0 ? (
            <div className="px-5 py-12 text-center text-xs text-gray-400">No users found</div>
          ) : users.map(serverU => {
            const u = effective(serverU);
            const isDirty = pending.has(u.id);
            const meta = ROLE_META[u.role] ?? ROLE_META.low;
            const initials = String(u.username ?? u.email ?? "U").slice(0, 1).toUpperCase();
           const isActive = u.is_active === true && u.uc_is_active === true;
            return (
              <div key={u.id} className="grid items-center px-5 py-3 hover:bg-gray-50/40 transition-colors relative"
                style={{ gridTemplateColumns: "2fr 2fr 220px 90px 90px" }}>
                {isDirty && <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-amber-400" />}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}cc 100%)` }}>
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{u.username ?? "—"}{u.id === userId && <span className="ml-1 text-[9px] font-black uppercase tracking-widest text-gray-300">(you)</span>}</p>
                    {u.is_super_admin && <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">Super admin</p>}
                  </div>
                </div>
                <p className="text-xs text-gray-500 truncate">{u.email ?? "—"}</p>
                {/* Role segmented control */}
                <div className="flex items-center gap-1 justify-center">
                  {ROLE_ORDER.map(r => {
                    const m = ROLE_META[r];
                    const isSel = u.role === r;
                    return (
                      <button key={r} onClick={() => onRoleChange(u.id, r)}
                        className="px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all"
                        style={{
                          background: isSel ? m.color : m.bg,
                          color: isSel ? "white" : m.color,
                          opacity: isSel ? 1 : 0.7,
                        }}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                {/* Active toggle */}
                <div className="flex justify-center">
                  <Toggle checked={isActive} color="#10b981"
                    onClick={() => stage(u.id, "is_active", !isActive)} />
                </div>
                {/* Default toggle */}
                <div className="flex justify-center">
                  <Toggle checked={!!u.is_default} color="#f59e0b"
                    onClick={() => stage(u.id, "is_default", !u.is_default)} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {roleConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => setRoleConfirm(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <p className="text-white font-black text-lg leading-tight">Change your own role?</p>
              <p className="text-white/70 text-[11px] mt-0.5">You're about to change your role to <strong className="text-white">{ROLE_META[roleConfirm.nextRole]?.label}</strong>. If you remove your admin access, you may lose the ability to manage user permissions.</p>
            </div>
            <div className="p-5 space-y-2">
              <button onClick={confirmSelfRoleChange}
                className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-amber-500 hover:bg-amber-50/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-amber-600">Yes, change my role</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Stages the change — confirm by saving</p>
              </button>
              <button onClick={() => setRoleConfirm(null)}
                className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all mt-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unsaved changes dialog ──────────────────────────────
function UnsavedChangesDialog({ count, onSave, onDiscard, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
      <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <p className="text-white font-black text-lg leading-tight">Unsaved changes</p>
          <p className="text-white/70 text-[11px] mt-0.5">You have {count} unsaved {count === 1 ? "change" : "changes"}</p>
        </div>
        <div className="p-5 space-y-2">
          <button onClick={onSave}
            className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all group">
            <p className="text-xs font-black text-gray-800 group-hover:text-emerald-600">Save and continue</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Persist your changes before leaving</p>
          </button>
          <button onClick={onDiscard}
            className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-red-400 hover:bg-red-50/40 transition-all group">
            <p className="text-xs font-black text-gray-800 group-hover:text-red-500">Discard changes</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Throw away unsaved edits</p>
          </button>
          <button onClick={onCancel}
            className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all mt-2">
            Stay on this page
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────
export default function UserManagement({ token, preloadedData = {}, activeCard, setActiveCard, navGuardRef }) {
  const [companyId, setCompanyId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [saveSignal, setSaveSignal] = useState(null);
  const [discardSignal, setDiscardSignal] = useState(null);

  // Expose a guard to the parent so its "back" button can be intercepted
  useEffect(() => {
    if (!navGuardRef) return;
    navGuardRef.current = (proceedFn) => {
      if (dirtyCount > 0) setPendingNavigation(() => proceedFn);
      else proceedFn();
    };
  }, [navGuardRef, dirtyCount]);

  const requestNavigate = (target) => {
    if (dirtyCount > 0) setPendingNavigation(() => () => setActiveCard(target));
    else setActiveCard(target);
  };

// Browser tab close / reload warning
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  // Global nav guard — sidebar/elsewhere can call window.__navGuard?.(fn)
  // to ask permission before navigating.
  useEffect(() => {
    if (dirtyCount === 0) {
      if (window.__navGuard) delete window.__navGuard;
      return;
    }
    window.__navGuard = (proceedFn) => {
      setPendingNavigation(() => proceedFn);
    };
    return () => {
      if (window.__navGuard) delete window.__navGuard;
    };
  }, [dirtyCount]);

// Resource lists
  const [companies, setCompanies] = useState([]);
  const [structures, setStructures] = useState([]);
  const [sources, setSources] = useState([]);
  const [dimensions, setDimensions] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [reportMappings, setReportMappings] = useState([]);
  const [loadingLists, setLoadingLists] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const cid = await getActiveCompanyId(uid);
        setCompanyId(cid);
      }
    })();
  }, []);

  // Preferred: use preloadedData if available, else fetch
useEffect(() => {
    if (preloadedData.companies?.length) setCompanies(preloadedData.companies);
    if (preloadedData.structures?.length) setStructures(preloadedData.structures);
    if (preloadedData.sources?.length) setSources(preloadedData.sources);
    if (preloadedData.dimensions?.length) setDimensions(preloadedData.dimensions);
  }, [preloadedData]);

useEffect(() => {
    if (!token) return;
    if (companies.length && structures.length && sources.length && dimensions.length) return;
    setLoadingLists(true);
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    Promise.all([
      fetch(`/v2/companies`, { headers: h }).then(r => r.json()).catch(() => ({ value: [] })),
      fetch(`/v2/structures`, { headers: h }).then(r => r.json()).catch(() => ({ value: [] })),
      fetch(`/v2/sources`, { headers: h }).then(r => r.json()).catch(() => ({ value: [] })),
      fetch(`/v2/dimensions`, { headers: h }).then(r => r.json()).catch(() => ({ value: [] })),
    ])
      .then(([cos, strs, srcs, dims]) => {
        if (!companies.length)  setCompanies((cos.value ?? cos) ?? []);
        if (!structures.length) setStructures((strs.value ?? strs) ?? []);
        if (!sources.length)    setSources((srcs.value ?? srcs) ?? []);
        if (!dimensions.length) setDimensions((dims.value ?? dims) ?? []);
      })
      .finally(() => setLoadingLists(false));
  }, [token]);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      listMappings({ companyId }).catch(() => []),
      listReportMappings({ companyId }).catch(() => []),
    ]).then(([sm, rm]) => { setMappings(sm); setReportMappings(rm); });
  }, [companyId]);

// Build sections for resource view
// Build sections for resource view
  const companiesStructuresSections = useMemo(() => ([
    { kind: "company", label: "Companies", items: companies.map(c => {
        const code = c.CompanyShortName ?? c.companyShortName ?? "";
        const full = c.CompanyLegalName ?? c.companyLegalName ?? "";
        return {
          id:    String(code || full || c),
          label: String(full || code || c),
          meta:  code && full ? `Code: ${code}` : null,
        };
      })
    },
    { kind: "structure", label: "Structures", items: structures.map(s => ({
        id: String(s.groupStructure ?? s.GroupStructure ?? s.id ?? s),
        label: String(s.groupStructure ?? s.GroupStructure ?? s.id ?? s),
      }))
    },
  ]), [companies, structures]);

  const sourcesDimensionsSections = useMemo(() => ([
    { kind: "source", label: "Sources", items: sources.map(s => ({
        id: String(s.source ?? s.Source ?? s.id ?? s),
        label: String(s.source ?? s.Source ?? s.id ?? s),
      }))
    },
    { kind: "dimension", label: "Dimensions", items: dimensions.map(d => {
        const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "");
        const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? code);
        return {
          id: code || name,
          label: name,
          meta: code && code !== name ? `Code: ${code}` : null,
        };
      })
    },
  ]), [sources, dimensions]);

const mappingSections = useMemo(() => {
    const dedupe = (arr) => {
      const seen = new Set();
      const out = [];
      for (const m of arr) {
        if (!m?.mapping_id || seen.has(m.mapping_id)) continue;
        seen.add(m.mapping_id);
        out.push(m);
      }
      return out;
    };
    return [
      { kind: "mapping", label: "Structure mappings", items: dedupe(mappings).map(m => ({
          id: m.mapping_id,
          label: m.name ?? "Untitled",
          meta: m.standard,
        }))
      },
      { kind: "report_mapping", label: "Report mappings", items: dedupe(reportMappings).map(m => ({
          id: m.mapping_id,
          label: m.name ?? "Untitled",
          meta: m.standard,
        }))
      },
    ];
  }, [mappings, reportMappings]);
// ── Drill-in views ──
// ── Drill-in views ──
  if (activeCard) {
    const commonProps = {
      companyId, userId,
      onDirtyChange: setDirtyCount,
      saveSignal, discardSignal,
    };
    return (
      <>
        <div className="flex flex-col h-full min-h-0">
          {activeCard === "pages"     && <PagesView {...commonProps} />}
          {activeCard === "companies" && <ResourceListView {...commonProps} sections={companiesStructuresSections} loadingData={loadingLists} />}
          {activeCard === "sources"   && <ResourceListView {...commonProps} sections={sourcesDimensionsSections}   loadingData={loadingLists} />}
{activeCard === "mappings"  && <ResourceListView {...commonProps} sections={mappingSections}             loadingData={false} />}
          {activeCard === "users"     && <UsersView companyId={companyId} userId={userId} onDirtyChange={setDirtyCount} saveSignal={saveSignal} discardSignal={discardSignal} />}
        </div>
        {pendingNavigation && (
          <UnsavedChangesDialog
            count={dirtyCount}
            onSave={() => {
              const sig = {
                done: () => { setSaveSignal(null); pendingNavigation(); setPendingNavigation(null); },
                failed: () => { setSaveSignal(null); },
              };
              setSaveSignal(sig);
            }}
            onDiscard={() => {
              const sig = { done: () => { setDiscardSignal(null); pendingNavigation(); setPendingNavigation(null); } };
              setDiscardSignal(sig);
            }}
            onCancel={() => setPendingNavigation(null)}
          />
        )}
      </>
    );
  }

// ── Landing: 4 cards ──
  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-4 p-1">
      {CARDS.map(card => (
        <button key={card.key} onClick={() => setActiveCard(card.key)}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-colors group flex flex-col"
          style={{
            background: `linear-gradient(135deg, #ffffff 0%, ${card.bgSoft} 100%)`,
            boxShadow: `0 8px 32px -8px ${card.color}30, 0 2px 8px -2px rgba(0,0,0,0.06)`,
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = card.color}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#f3f4f6"}>
          <div className="relative z-10 flex flex-col h-full p-8">
            <div className="mb-auto">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-105"
                style={{ background: `linear-gradient(145deg, ${card.color} 0%, ${card.color}cc 100%)`, boxShadow: `0 8px 20px -4px ${card.color}50` }}>
                <card.icon size={26} className="text-white" strokeWidth={1.8} />
              </div>
              <p className="font-black text-xl text-gray-800 mb-2">{card.label}</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{card.desc}</p>
            </div>
            <div className="mt-6 flex items-center justify-between">
<span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest" style={{ background: `${card.color}15`, color: card.color }}>
                {card.key === "pages" ? "Sidebar pages" :
                 card.key === "companies" ? `${companies.length + structures.length} items` :
                 card.key === "sources" ? `${sources.length + dimensions.length} items` :
                 card.key === "mappings" ? `${mappings.length + reportMappings.length} mappings` :
                 "Members & roles"}
              </span>
              <span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5" style={{ color: card.color }}>
                Open <ChevronRight size={12} />
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}