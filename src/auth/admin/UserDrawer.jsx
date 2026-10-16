/* ══════════════════════════════════════════════════════════════════════
   Centro de control — ficha de usuario (panel lateral).
   Crear uno nuevo, asignar uno existente sin empresa o editar uno.
   Se abre encima de la ficha de empresa cuando viene de ahí.
   ══════════════════════════════════════════════════════════════════════ */
import { useMemo, useState } from "react";
import { X, Loader2, Crown, ShieldCheck, Building2, Trash2, UserPlus, UserCheck, Search, Sparkles } from "lucide-react";
import { supabase, sbAccounts } from "../../lib/supabaseClient";
import { cx, ROLES, Avatar, Switch, Field, Drawer, Combo } from "./adminShared.jsx";
import s from "./AdminPortal.module.css";

export default function UserDrawer({ user, companies, allUsers = [], allLinks = [], onClose, onSaved, toast, tx, layer = 0 }) {
  const isEdit = !!user?.id;
  const [form, setForm] = useState({
    email:    user?.email    ?? "",
    username: user?.username ?? "",
    password: "",
    is_super_admin: user?.is_super_admin ?? false,
    is_active:      user?.is_active      ?? true,
  });
  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  // Cada vínculo lleva su rol; los nuevos empiezan como "regular"
  const [companyLinks, setCompanyLinks] = useState(() => (user?._company_links ?? []).map(l => ({ role: "regular", ...l })));
  const [saving, setSaving] = useState(false);

  // Crear: usuario nuevo o uno existente sin empresa
  const [createMode, setCreateMode] = useState("new");
  const [existingUserId, setExistingUserId] = useState(null);
  const [existingSearch, setExistingSearch] = useState("");
  const availableUsers = useMemo(() => (allUsers ?? []).filter(u =>
    !u.is_super_admin && !(allLinks ?? []).some(l => l.user_id === u.id)), [allUsers, allLinks]);
  const filteredAvailable = availableUsers.filter(u => {
    const q = existingSearch.trim().toLowerCase();
    return !q || (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });
  const pickedExisting = availableUsers.find(u => u.id === existingUserId);

  // Empresa (una por usuario)
  const [companySearch, setCompanySearch] = useState("");
  const link = companyLinks[0] ?? null;
  const linkCompany = link ? companies.find(c => c.id === link.company_id) : null;
  const companyItems = companies.filter(c => {
    const q = companySearch.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.slug ?? "").toLowerCase().includes(q);
  });
  const setLinkCompany = (c) => {
    setCompanyLinks(link
      ? [{ ...link, company_id: c.id }]
      : [{ company_id: c.id, is_default: true, is_active: true, role: "regular" }]);
    setCompanySearch("");
  };
  const setLinkRole = (role) => setCompanyLinks(link ? [{ ...link, role }] : []);
  const removeLink = () => setCompanyLinks([]);

  const handleSave = async () => {
    // ── Asignar un usuario existente ──
    if (!isEdit && createMode === "existing") {
      if (!existingUserId) { toast("error", tx("pick_user_err")); return false; }
      if (companyLinks.length === 0) { toast("error", tx("need_company")); return false; }
      setSaving(true);
      const { error } = await sbAccounts.from("user_companies").insert(companyLinks.map(l => ({
        user_id: existingUserId, company_id: l.company_id, role: l.role ?? "regular", is_default: l.is_default, is_active: l.is_active,
      })));
      setSaving(false);
      if (error) { toast("error", error.message); return false; }
      toast("success", tx("user_assigned"));
      onSaved();
      return true;
    }

    // ── Usuario nuevo o edición ──
    if (!form.email.trim() || !form.username.trim()) { toast("error", tx("need_email")); return false; }
    setSaving(true);
    let userId = user?.id;

    if (!isEdit) {
      const { data: { session: adminSession } } = await supabase.auth.getSession();
      if (!adminSession) { setSaving(false); toast("error", tx("session_lost")); return false; }
      const tempPassword = form.password || `Tmp_${Math.random().toString(36).slice(2, 10)}!Kx9`;
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: tempPassword,
        options: { data: { username: form.username.trim() } },
      });
      if (signUpErr || !signUpData?.user) {
        await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
        setSaving(false);
        toast("error", signUpErr?.message ?? String(signUpErr?.status ?? tx("create_failed")));
        return false;
      }
      userId = signUpData.user.id;
      // signUp cambia la sesión: se recupera la del super-admin
      const { error: restoreErr } = await supabase.auth.setSession({
        access_token: adminSession.access_token, refresh_token: adminSession.refresh_token,
      });
      if (restoreErr) { setSaving(false); toast("error", tx("session_broken")); return false; }
      await new Promise(r => setTimeout(r, 700));
    }

    const userPayload = {
      id:             userId,
      username:       form.username.trim(),
      email:          form.email.trim(),
      is_super_admin: form.is_super_admin,
      is_active:      form.is_active,
      has_password:   !!form.password,
      admin_created:  true,
    };
    let userErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 600 * attempt));
      const { error } = await sbAccounts.from("users").upsert(userPayload, { onConflict: "id" });
      userErr = error;
      if (!error) break;
    }
    if (userErr) { setSaving(false); toast("error", userErr.message); return false; }

    if (isEdit) await sbAccounts.from("user_companies").delete().eq("user_id", userId);
    if (companyLinks.length > 0) {
      const { error: linksErr } = await sbAccounts.from("user_companies").insert(companyLinks.map(l => ({
        user_id: userId, company_id: l.company_id, role: l.role ?? "regular", is_default: l.is_default, is_active: l.is_active,
      })));
      if (linksErr) { setSaving(false); toast("error", linksErr.message); return false; }
    }
    setSaving(false);
    toast("success", isEdit ? tx("user_saved") : tx("user_created"));
    onSaved();
    return true;
  };

  const showProfile = isEdit || createMode === "new";
  const titleId = "user-drawer-title";
  const headLabel = isEdit ? (form.username || user?.email) : createMode === "existing" && pickedExisting ? pickedExisting.username : form.username;

  return (
    <Drawer onClose={onClose} width={560} layer={layer} labelledBy={titleId}>
      {(close) => (
        <>
          <header className={s.dHead}>
            <Avatar label={headLabel || "?"} size={48} tone={form.is_super_admin ? "#e8a317" : headLabel ? undefined : "#1a2f8a"}>
              {headLabel ? undefined : <UserPlus size={20} />}
            </Avatar>
            <div className={s.dHeadText}>
              <h2 id={titleId} className={s.dTitle}>{isEdit ? (form.username || tx("adm_users")) : tx("adm_new_user")}</h2>
              <div className={s.dMeta}>
                {isEdit ? <span className={s.dMetaText}>{user.email}</span> : null}
                {form.is_super_admin && showProfile ? <span className={s.chip} style={{ "--chip": "#e8a317" }}><Crown size={10} /> {tx("role_super")}</span> : null}
              </div>
            </div>
            <button type="button" className={s.iconBtn} onClick={close} aria-label={tx("close")}><X size={18} /></button>
          </header>

          <div className={s.dBody}>
            {!isEdit && (
              <div className={s.segment} role="tablist">
                <button type="button" role="tab" aria-selected={createMode === "new"}
                  className={cx(s.segBtn, createMode === "new" && s.segOn)} onClick={() => setCreateMode("new")}>
                  <Sparkles size={14} /> {tx("new_user_tab")}
                </button>
                <button type="button" role="tab" aria-selected={createMode === "existing"} disabled={availableUsers.length === 0}
                  className={cx(s.segBtn, createMode === "existing" && s.segOn)} onClick={() => setCreateMode("existing")}
                  title={availableUsers.length === 0 ? tx("none_available") : undefined}>
                  <UserCheck size={14} /> {tx("existing_tab")}
                  {availableUsers.length > 0 ? <span className={s.segCount}>{availableUsers.length}</span> : null}
                </button>
              </div>
            )}

            <div className={s.stack}>
              {!isEdit && createMode === "existing" && (
                <Field label={tx("pick_user")} htmlFor="u-existing">
                  {pickedExisting ? (
                    <div className={s.picked}>
                      <Avatar label={pickedExisting.username || pickedExisting.email} size={36} />
                      <span className={s.whoText}><strong>{pickedExisting.username ?? "—"}</strong><small>{pickedExisting.email}</small></span>
                      <button type="button" className={s.iconBtnSm} aria-label={tx("clear_sel")}
                        onClick={() => { setExistingUserId(null); setExistingSearch(""); }}><X size={14} /></button>
                    </div>
                  ) : (
                    <Combo id="u-existing" value={existingSearch} icon={Search} autoFocus
                      onChange={setExistingSearch}
                      items={filteredAvailable} getKey={u => u.id}
                      renderItem={(u) => (
                        <span className={s.comboWho}>
                          <Avatar label={u.username || u.email} size={28} />
                          <span className={s.whoText}><strong>{u.username ?? "—"}</strong><small>{u.email}</small></span>
                        </span>
                      )}
                      onPick={(u) => { setExistingUserId(u.id); setExistingSearch(""); }}
                      placeholder={availableUsers.length ? tx("pick_user_ph") : tx("none_available")}
                      disabled={!availableUsers.length}
                      emptyText={tx("no_match", { q: existingSearch })} />
                  )}
                </Field>
              )}

              {showProfile && (
                <>
                  <div className={s.formGrid}>
                    <Field label={tx("email")} htmlFor="u-email">
                      <input id="u-email" type="email" className={s.input} value={form.email} disabled={isEdit}
                        placeholder="user@company.com" autoFocus={!isEdit}
                        onChange={(e) => set({ email: e.target.value })} />
                    </Field>
                    <Field label={tx("username")} htmlFor="u-name">
                      <input id="u-name" className={s.input} value={form.username} placeholder="Juan Vidal"
                        onChange={(e) => set({ username: e.target.value })} />
                    </Field>
                  </div>
                  {!isEdit && (
                    <Field label={<>{tx("login_password")} <span className={s.optional}>({tx("optional")})</span></>} hint={tx("pwd_hint")} htmlFor="u-pwd">
                      <input id="u-pwd" type="text" className={cx(s.input, s.mono)} value={form.password} autoComplete="new-password"
                        onChange={(e) => set({ password: e.target.value })} />
                    </Field>
                  )}
                  <div className={s.toggleList}>
                    {[
                      { key: "is_active", label: tx("adm_active"), sub: tx("active_sub"), icon: ShieldCheck, tone: "#0f9f6e" },
                      { key: "is_super_admin", label: tx("super_admin"), sub: tx("super_sub"), icon: Crown, tone: "#e8a317" },
                    ].map(item => (
                      <label key={item.key} className={cx(s.toggleRow, form[item.key] && s.toggleRowOn)} style={{ "--tg": item.tone }}>
                        <span className={s.toggleIcon}><item.icon size={15} /></span>
                        <span className={s.toggleText}><strong>{item.label}</strong><small>{item.sub}</small></span>
                        <Switch checked={form[item.key]} onChange={(v) => set({ [item.key]: v })} tone={item.tone} label={item.label} />
                      </label>
                    ))}
                  </div>
                </>
              )}

              <section className={s.accessBlock}>
                <div className={s.blockHead}>
                  <h3>{tx("company_access")}</h3>
                  <p>{tx("company_access_sub")}</p>
                </div>
                {link ? (
                  <div className={s.accessCard}>
                    <div className={s.accessTop}>
                      <Avatar label={linkCompany?.name ?? "?"} tone="#1a2f8a" size={36} />
                      <span className={s.whoText}>
                        <strong>{linkCompany?.name ?? "—"}</strong>
                        <small className={s.mono}>{linkCompany?.slug}</small>
                      </span>
                      <button type="button" className={cx(s.iconBtnSm, s.iconDanger)} onClick={removeLink} aria-label={tx("remove_access")} title={tx("remove_access")}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <Combo value={companySearch} icon={Building2} onChange={setCompanySearch}
                      items={companyItems} getKey={c => c.id}
                      renderItem={(c) => (
                        <span className={s.comboWho}>
                          <Avatar label={c.name} tone="#1a2f8a" size={26} />
                          <span className={s.whoText}><strong>{c.name}</strong><small className={s.mono}>{c.slug}</small></span>
                        </span>
                      )}
                      onPick={setLinkCompany} placeholder={tx("pick_company_ph")}
                      emptyText={tx("no_match", { q: companySearch })} />
                    <div className={s.roleSeg} role="radiogroup" aria-label={tx("role")}>
                      {ROLES.map(r => {
                        const on = (link.role ?? "regular") === r.id;
                        return (
                          <button key={r.id} type="button" role="radio" aria-checked={on}
                            className={cx(s.roleOpt, on && s.roleOptOn)} style={{ "--chip": r.color }}
                            onClick={() => setLinkRole(r.id)}>
                            <strong>{r.icon ? <r.icon size={12} /> : null}{tx(r.labelKey)}</strong>
                            <small>{tx(r.descKey)}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className={s.accessEmpty}>
                    <Building2 size={18} />
                    <Combo value={companySearch} onChange={setCompanySearch}
                      items={companyItems} getKey={c => c.id}
                      renderItem={(c) => (
                        <span className={s.comboWho}>
                          <Avatar label={c.name} tone="#1a2f8a" size={26} />
                          <span className={s.whoText}><strong>{c.name}</strong><small className={s.mono}>{c.slug}</small></span>
                        </span>
                      )}
                      onPick={setLinkCompany} placeholder={tx("assign_company")}
                      emptyText={tx("no_match", { q: companySearch })} />
                  </div>
                )}
              </section>
            </div>
          </div>

          <footer className={s.dFoot}>
            <span className={s.dState} />
            <button type="button" className={s.btnGhost} onClick={close} disabled={saving}>{tx("adm_cancel")}</button>
            <button type="button" className={s.btnPrimary} disabled={saving}
              onClick={async () => { if (await handleSave()) close(); }}>
              {saving ? <Loader2 size={14} className={s.spin} /> : null}
              {isEdit ? tx("adm_save") : createMode === "existing" ? tx("assign_user") : tx("create_user")}
            </button>
          </footer>
        </>
      )}
    </Drawer>
  );
}