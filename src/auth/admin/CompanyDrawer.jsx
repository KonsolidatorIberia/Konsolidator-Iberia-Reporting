/* ══════════════════════════════════════════════════════════════════════
   Centro de control — ficha de empresa (panel lateral).
   Pestañas: General · Dirección y contacto · Facturación · Usuarios.
   Al crear se rellenan las tres primeras de una vez; los usuarios se
   gestionan cuando la empresa ya existe (se guardan al momento).
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, MapPin, CreditCard, Users, X, Plus, Search, Trash2, Edit2, Loader2,
  ChevronDown, Calendar, Mail, Check, MoreHorizontal, Globe2,
} from "lucide-react";
import { sbAccounts } from "../../lib/supabaseClient";
import {
  cx, TIERS, ROLES, roleConfig, COUNTRIES, findCountry, EMAIL_REGEX, slugify, trialInfo, trialLabel,
  Avatar, Switch, Field, TierChip, Drawer, ConfirmDialog, Menu, MenuItem, Combo, deleteUsers,
} from "./adminShared.jsx";
import s from "./AdminPortal.module.css";

const emptyForm = (c) => ({
  name: c?.name ?? "",
  slug: c?.slug ?? "",
  tier: c?.tier ?? "base",
  is_trial: c?.is_trial ?? true,
  trial_started_at: c?.trial_started_at?.slice(0, 10) ?? "",
  trial_ends_at:    c?.trial_ends_at?.slice(0, 10) ?? "",
  country:          c?.country          ?? "",
  vat_id:           c?.vat_id           ?? "",
  street:           c?.street           ?? "",
  street_number:    c?.street_number    ?? "",
  postal_code:      c?.postal_code      ?? "",
  city:             c?.city             ?? "",
  full_name:        c?.full_name        ?? "",
  phone:            c?.phone            ?? "",
  bank_holder_name: c?.bank_holder_name ?? "",
  bank_iban:        c?.bank_iban        ?? "",
  billing_emails:   Array.isArray(c?.billing_emails) ? c.billing_emails : [],
  contract_start_date: c?.contract_start_date?.slice(0, 10) ?? "",
});

export default function CompanyDrawer({
  company, dataVersion, onClose, onSaved, toast, onEditUser, onAddUser, onDelete, tx, locale, now,
}) {
  const isEdit = !!company;
  const [form, setForm] = useState(() => emptyForm(company));
  const [initial] = useState(() => JSON.stringify(emptyForm(company)));
  const dirty = JSON.stringify(form) !== initial;
  const [tab, setTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [slugDirty, setSlugDirty] = useState(isEdit);
  const [vatBlurred, setVatBlurred] = useState(false);
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  // ── País y NIF ──
  const selectedCountry = findCountry(form.country);
  const countryItems = useMemo(() => {
    const q = form.country.trim().toLowerCase();
    if (!q || selectedCountry) return COUNTRIES;
    return COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().startsWith(q));
  }, [form.country, selectedCountry]);
  const vatLooksValid = (() => {
    if (!form.vat_id.trim() || !selectedCountry) return null;
    const cleaned = form.vat_id.replace(/\s+/g, "");
    const exampleLen = selectedCountry.vat.example.replace(/\s+/g, "").length;
    if (cleaned.length < exampleLen && !vatBlurred) return null;
    return selectedCountry.vat.regex.test(cleaned);
  })();

  // ── Dirección con sugerencias (Photon) ──
  const [addr, setAddr] = useState({ items: [], loading: false });
  const addrAbort = useRef(null);
  const addrTimer = useRef(null);
  useEffect(() => () => { clearTimeout(addrTimer.current); addrAbort.current?.abort(); }, []);
  const handleStreetChange = (value) => {
    set({ street: value });
    clearTimeout(addrTimer.current);
    addrAbort.current?.abort();
    if (!value || value.trim().length < 3) { setAddr({ items: [], loading: false }); return; }
    addrTimer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      addrAbort.current = ctrl;
      setAddr(a => ({ ...a, loading: true }));
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(value)}&limit=6&layer=house&layer=street`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`Photon ${res.status}`);
        const data = await res.json();
        setAddr({ items: Array.isArray(data?.features) ? data.features : [], loading: false });
      } catch (err) {
        if (err.name !== "AbortError") setAddr({ items: [], loading: false });
      }
    }, 300);
  };
  const pickAddress = (f) => {
    const p = f.properties ?? {};
    setForm(prev => ({
      ...prev,
      street:        p.name ?? prev.street,
      street_number: p.housenumber ?? prev.street_number,
      city:          p.city ?? p.town ?? p.village ?? p.county ?? prev.city,
      postal_code:   p.postcode ?? prev.postal_code,
      country:       p.country ?? prev.country,
    }));
    setAddr({ items: [], loading: false });
  };

  // ── IBAN y emails de facturación ──
  const ibanClean = form.bank_iban.replace(/\s+/g, "").toUpperCase();
  const ibanLooksValid = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ibanClean);
  const handleIbanChange = (raw) => {
    const cleaned = raw.replace(/\s+/g, "").toUpperCase().slice(0, 34);
    set({ bank_iban: cleaned.match(/.{1,4}/g)?.join(" ") ?? "" });
  };
  const [emailDraft, setEmailDraft] = useState("");
  const [emailError, setEmailError] = useState("");
  const addEmail = () => {
    const e = emailDraft.trim();
    if (!e) return;
    if (!EMAIL_REGEX.test(e)) { setEmailError(tx("email_invalid")); return; }
    if (form.billing_emails.some(x => x.toLowerCase() === e.toLowerCase())) { setEmailError(tx("email_dupe")); return; }
    set({ billing_emails: [...form.billing_emails, e] });
    setEmailDraft("");
    setEmailError("");
  };

  // ── Guardar ──
  const handleSave = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast("error", tx("required_company"));
      setTab("general");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      tier: form.tier,
      is_trial: form.is_trial,
      trial_started_at: form.trial_started_at || null,
      trial_ends_at:    form.trial_ends_at    || null,
      country:          form.country.trim()          || null,
      vat_id:           form.vat_id.trim()           || null,
      street:           form.street.trim()           || null,
      street_number:    form.street_number.trim()    || null,
      postal_code:      form.postal_code.trim()      || null,
      city:             form.city.trim()             || null,
      full_name:        form.full_name.trim()        || null,
      phone:            form.phone.trim()            || null,
      bank_holder_name: form.bank_holder_name.trim() || null,
      bank_iban:        ibanClean                    || null,
      billing_emails:   form.billing_emails.length ? form.billing_emails : [],
      contract_start_date: form.contract_start_date || null,
    };
    const { error } = isEdit
      ? await sbAccounts.from("companies").update(payload).eq("id", company.id)
      : await sbAccounts.from("companies").insert(payload);
    setSaving(false);
    if (error) { toast("error", error.message); return; }
    toast("success", isEdit ? tx("changes_saved") : tx("company_created"));
    onSaved();
    return true;
  };

  // ── Usuarios de la empresa ──
  const companyId = company?.id;
  const usersKey = companyId ? `${companyId}|${dataVersion}` : null;
  const [usersData, setUsersData] = useState({ key: null, companyId: null, list: [] });
  useEffect(() => {
    if (!usersKey) return;
    let cancelled = false;
    (async () => {
      const { data: links } = await sbAccounts
        .from("user_companies")
        .select("user_id, is_active, role")
        .eq("company_id", companyId);
      if (cancelled) return;
      const ids = (links ?? []).map(l => l.user_id);
      let users = [];
      if (ids.length) {
        const { data } = await sbAccounts.from("users").select("id, username, email, is_active").in("id", ids);
        if (cancelled) return;
        users = data ?? [];
      }
      const ucMap = new Map((links ?? []).map(l => [l.user_id, l]));
      setUsersData({
        key: usersKey,
        companyId,
        list: users.map(u => ({
          ...u,
          uc_is_active: ucMap.get(u.id)?.is_active ?? true,
          uc_role:      ucMap.get(u.id)?.role ?? "regular",
        })),
      });
    })();
    return () => { cancelled = true; };
  }, [usersKey, companyId]);
  const companyUsers = usersData.companyId === companyId ? usersData.list : [];
  const loadingUsers = !!companyId && usersData.companyId !== companyId;
  const refreshingUsers = !!companyId && usersData.companyId === companyId && usersData.key !== usersKey;
  const patchUser = (id, patch) => setUsersData(d => ({ ...d, list: d.list.map(u => (u.id === id ? { ...u, ...patch } : u)) }));

  const [userSearch, setUserSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const filteredUsers = companyUsers.filter(u => {
    const q = userSearch.trim().toLowerCase();
    return !q || (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });
  const allSelected = filteredUsers.length > 0 && filteredUsers.every(u => selected.has(u.id));
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filteredUsers.map(u => u.id)));

  const changeRole = async (u, newRole) => {
    if (newRole === u.uc_role) return;
    const prevRole = u.uc_role;
    patchUser(u.id, { uc_role: newRole });
    const { error } = await sbAccounts.from("user_companies").update({ role: newRole })
      .eq("user_id", u.id).eq("company_id", company.id);
    if (error) { patchUser(u.id, { uc_role: prevRole }); toast("error", error.message); return; }
    toast("success", tx("role_saved", { r: tx(roleConfig(newRole).labelKey) }));
    onSaved?.();
  };

  const toggleActive = async (u) => {
    const active = u.is_active && u.uc_is_active;
    const next = !active;
    patchUser(u.id, { is_active: next, uc_is_active: next });
    // Se guardan los dos: el usuario (global) y su vínculo con la empresa
    const { error: userErr } = await sbAccounts.from("users").update({ is_active: next }).eq("id", u.id);
    const { error: linkErr } = await sbAccounts.from("user_companies").update({ is_active: next })
      .eq("user_id", u.id).eq("company_id", company.id);
    if (userErr || linkErr) {
      patchUser(u.id, { is_active: !next, uc_is_active: !next });
      toast("error", userErr?.message ?? linkErr?.message ?? tx("update_failed"));
      return;
    }
    toast("success", next ? tx("user_on") : tx("user_off"));
    onSaved?.();
  };

  // Borrado (uno o varios) con confirmación
  const [confirm, setConfirm] = useState(null);   // { ids }
  const [deleting, setDeleting] = useState(false);
  const runDelete = async () => {
    const ids = confirm.ids;
    setDeleting(true);
    const { done, failed, sessionExpired } = await deleteUsers(ids);
    setDeleting(false);
    setConfirm(null);
    if (sessionExpired) { toast("error", tx("adm_session_expired")); return; }
    setUsersData(d => ({ ...d, list: d.list.filter(u => !done.includes(u.id)) }));
    setSelected(prev => { const n = new Set(prev); done.forEach(id => n.delete(id)); return n; });
    if (!failed) toast("success", done.length === 1 ? tx("adm_user_deleted") : tx("users_deleted", { n: done.length }));
    else if (!done.length) toast("error", `${failed} · ${tx("adm_network_error")}`);
    else toast("error", tx("deleted_partial", { ok: done.length, fail: failed }));
    onSaved();
  };

  const [roleMenu, setRoleMenu] = useState(null);   // { user, anchor }
  const [headMenu, setHeadMenu] = useState(null);   // anchor

  // ── Pestañas ──
  const addressBad = vatLooksValid === false;
  const billingBad = !!form.bank_iban && !ibanLooksValid;
  const tabs = [
    { id: "general", label: tx("sec_general"), icon: Building2 },
    { id: "address", label: tx("sec_address"), icon: MapPin, warn: addressBad },
    { id: "billing", label: tx("sec_billing"), icon: CreditCard, warn: billingBad },
    ...(isEdit ? [{ id: "users", label: tx("adm_users"), icon: Users, count: companyUsers.length }] : []),
  ];
  const info = trialInfo({ ...company, ...form, created_at: company?.created_at }, now);

  const headerTitleId = "company-drawer-title";
  return (
    <Drawer onClose={onClose} width={900} labelledBy={headerTitleId}>
      {(close) => (
        <>
          <header className={s.dHead}>
            <Avatar label={form.name || "?"} tone="#1a2f8a" size={48}>
              {form.name ? undefined : <Building2 size={20} />}
            </Avatar>
            <div className={s.dHeadText}>
              <h2 id={headerTitleId} className={s.dTitle}>{form.name || tx("adm_new_company")}</h2>
              <div className={s.dMeta}>
                {form.slug ? <code className={s.slug}>{form.slug}</code> : null}
                <TierChip tier={form.tier} />
                <span className={cx(s.planTag, info.kind === "trial" && (info.ended ? s.planEnded : info.soon ? s.planSoon : s.planTrial))}>
                  {info.kind === "trial" ? `${tx("trial")} · ${trialLabel(info, tx)}` : tx("adm_paid")}
                </span>
              </div>
            </div>
            {isEdit ? (
              <button type="button" className={s.iconBtn} aria-label={tx("more_actions")}
                onClick={(e) => setHeadMenu(headMenu ? null : e.currentTarget)}>
                <MoreHorizontal size={18} />
              </button>
            ) : null}
            <button type="button" className={s.iconBtn} onClick={close} aria-label={tx("close")}><X size={18} /></button>
          </header>

          <nav className={s.dTabs} role="tablist">
            {tabs.map(tb => (
              <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id}
                className={cx(s.dTab, tab === tb.id && s.dTabOn)} onClick={() => setTab(tb.id)}>
                <tb.icon size={14} />
                <span>{tb.label}</span>
                {tb.count != null ? <span className={s.dTabCount}>{tb.count}</span> : null}
                {tb.warn ? <span className={s.dTabWarn} aria-hidden="true" /> : null}
              </button>
            ))}
          </nav>

          <div className={s.dBody} key={tab}>
            {tab === "general" && (
              <div className={s.formGrid}>
                <Field label={tx("legal_name")} htmlFor="co-name">
                  <input id="co-name" className={s.input} value={form.name} placeholder="Acme Corporation" autoFocus={!isEdit}
                    onChange={(e) => { const v = e.target.value; setForm(f => ({ ...f, name: v, slug: slugDirty ? f.slug : slugify(v) })); }} />
                </Field>
                <Field label={tx("slug")} hint={tx("slug_hint")} htmlFor="co-slug">
                  <input id="co-slug" className={cx(s.input, s.mono)} value={form.slug} placeholder="acme-corp"
                    onChange={(e) => { setSlugDirty(true); set({ slug: slugify(e.target.value) }); }} />
                </Field>

                <div className={s.span2}>
                  <Field label={tx("tier")}>
                    <div className={s.tierGrid} role="radiogroup" aria-label={tx("tier")}>
                      {TIERS.map(ti => {
                        const on = form.tier === ti.id;
                        return (
                          <button key={ti.id} type="button" role="radio" aria-checked={on}
                            className={cx(s.tierOpt, on && s.tierOptOn)} style={{ "--tc": ti.color }}
                            onClick={() => set({ tier: ti.id })}>
                            <span className={s.tierIcon}><ti.icon size={15} strokeWidth={2.4} /></span>
                            <span className={s.tierName}>{ti.label}</span>
                            <span className={s.tierDesc}>{tx(ti.descKey)}</span>
                            {on ? <Check size={14} className={s.tierCheck} strokeWidth={3} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>

                <div className={cx(s.span2, s.planCard, form.is_trial && s.planCardTrial)}>
                  <div className={s.planRow}>
                    <span className={s.planIcon}>{form.is_trial ? <Calendar size={16} /> : <Check size={16} strokeWidth={3} />}</span>
                    <div className={s.planText}>
                      <p>{form.is_trial ? tx("trial_toggle") : tx("adm_paid")}</p>
                      <small>{form.is_trial ? tx("trial_toggle_sub") : tx("trial_toggle_sub_paid")}</small>
                    </div>
                    <Switch checked={form.is_trial} onChange={(v) => set({ is_trial: v })} tone="#e8a317" label={tx("trial_toggle")} />
                  </div>
                  {form.is_trial && (
                    <>
                      <div className={s.planDates}>
                        <Field label={tx("trial_start")} htmlFor="co-ts">
                          <input id="co-ts" type="date" className={s.input} value={form.trial_started_at} onChange={(e) => set({ trial_started_at: e.target.value })} />
                        </Field>
                        <Field label={tx("trial_end")} htmlFor="co-te">
                          <input id="co-te" type="date" className={s.input} value={form.trial_ends_at} onChange={(e) => set({ trial_ends_at: e.target.value })} />
                        </Field>
                      </div>
                      {info.pct != null ? (
                        <div className={cx(s.runway, info.ended && s.runwayEnded, info.soon && s.runwaySoon)}>
                          <span style={{ width: `${Math.round(info.pct * 100)}%` }} />
                          <em>{trialLabel(info, tx)}</em>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <Field label={tx("contract_start")} htmlFor="co-cs">
                  <input id="co-cs" type="date" className={s.input} value={form.contract_start_date} onChange={(e) => set({ contract_start_date: e.target.value })} />
                </Field>
              </div>
            )}

            {tab === "address" && (
              <div className={s.formGrid}>
                <Field label={tx("country")} htmlFor="co-country">
                  <Combo id="co-country" value={form.country} icon={Globe2}
                    onChange={(v) => set({ country: v })}
                    items={countryItems} getKey={c => c.code}
                    renderItem={(c) => <><span className={s.comboMain}>{c.name}</span><span className={s.comboCode}>{c.code}</span></>}
                    onPick={(c) => { set({ country: c.name }); setVatBlurred(false); }}
                    placeholder="Spain" />
                </Field>
                <Field label={tx("vat")} htmlFor="co-vat"
                  aside={selectedCountry ? tx("vat_format", { c: selectedCountry.code }) : null}
                  error={vatLooksValid === false ? tx("vat_bad", { c: selectedCountry?.name }) : null}>
                  <input id="co-vat" className={cx(s.input, s.mono, vatLooksValid === false && s.inputBad, vatLooksValid === true && s.inputOk)}
                    value={form.vat_id} disabled={!selectedCountry}
                    placeholder={selectedCountry?.vat.example ?? tx("vat_pick_country")}
                    onChange={(e) => { set({ vat_id: e.target.value.toUpperCase() }); setVatBlurred(false); }}
                    onBlur={() => setVatBlurred(true)} />
                </Field>

                <div className={s.span2}>
                  <Field label={tx("street")} htmlFor="co-street">
                    <Combo id="co-street" value={form.street} icon={MapPin} filterLocally={false}
                      onChange={handleStreetChange}
                      items={addr.items} loading={addr.loading}
                      getKey={(f) => `${f.properties?.osm_id}-${f.properties?.name}-${f.properties?.housenumber}`}
                      renderItem={(f) => {
                        const p = f.properties ?? {};
                        const street = [p.name, p.housenumber].filter(Boolean).join(" ");
                        const sub = [p.city ?? p.town ?? p.village, p.postcode, p.country].filter(Boolean).join(", ");
                        return <span className={s.comboStack}><span className={s.comboMain}>{street || p.name || "—"}</span>{sub ? <small>{sub}</small> : null}</span>;
                      }}
                      onPick={pickAddress}
                      placeholder={tx("street_ph")} />
                  </Field>
                </div>
                <div className={cx(s.span2, s.addrRow)}>
                  <Field label={tx("number")} htmlFor="co-num">
                    <input id="co-num" className={s.input} value={form.street_number} onChange={(e) => set({ street_number: e.target.value })} />
                  </Field>
                  <Field label={tx("postal")} htmlFor="co-pc">
                    <input id="co-pc" className={s.input} value={form.postal_code} onChange={(e) => set({ postal_code: e.target.value })} />
                  </Field>
                  <Field label={tx("city")} htmlFor="co-city">
                    <input id="co-city" className={s.input} value={form.city} onChange={(e) => set({ city: e.target.value })} />
                  </Field>
                </div>
                <Field label={tx("contact")} htmlFor="co-contact">
                  <input id="co-contact" className={s.input} value={form.full_name} placeholder={tx("full_name_ph")} onChange={(e) => set({ full_name: e.target.value })} />
                </Field>
                <Field label={tx("phone")} htmlFor="co-phone">
                  <input id="co-phone" type="tel" className={s.input} value={form.phone} placeholder="+34 600 000 000" onChange={(e) => set({ phone: e.target.value })} />
                </Field>
              </div>
            )}

            {tab === "billing" && (
              <div className={s.formGrid}>
                <Field label={tx("holder")} htmlFor="co-holder">
                  <input id="co-holder" className={s.input} value={form.bank_holder_name} placeholder={tx("holder_ph")} onChange={(e) => set({ bank_holder_name: e.target.value })} />
                </Field>
                <Field label={tx("iban")} htmlFor="co-iban" error={billingBad ? tx("iban_bad") : null}>
                  <input id="co-iban" className={cx(s.input, s.mono, billingBad && s.inputBad, form.bank_iban && ibanLooksValid && s.inputOk)}
                    value={form.bank_iban} placeholder="ES00 0000 0000 0000 0000 0000" onChange={(e) => handleIbanChange(e.target.value)} />
                </Field>
                <div className={s.span2}>
                  <Field label={tx("billing_emails")} hint={emailError ? null : tx("billing_emails_hint")} error={emailError || null} htmlFor="co-email">
                    <div className={s.emailBox}>
                      {form.billing_emails.map((em, idx) => (
                        <span key={`${em}-${idx}`} className={s.emailTag}>
                          <Mail size={12} />
                          {em}
                          <button type="button" aria-label={`${tx("delete")} ${em}`}
                            onClick={() => set({ billing_emails: form.billing_emails.filter((_, i) => i !== idx) })}>
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input id="co-email" type="email" className={s.emailInput} value={emailDraft}
                        placeholder={form.billing_emails.length ? "" : "invoice@company.com"}
                        onChange={(e) => { setEmailDraft(e.target.value); setEmailError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addEmail(); }
                          if (e.key === "Backspace" && !emailDraft && form.billing_emails.length) set({ billing_emails: form.billing_emails.slice(0, -1) });
                        }} />
                      <button type="button" className={s.emailAdd} onClick={addEmail} disabled={!emailDraft.trim()}>
                        <Plus size={13} /> {tx("email_add")}
                      </button>
                    </div>
                    {!form.billing_emails.length ? <p className={s.emptyInline}>{tx("no_emails")}</p> : null}
                  </Field>
                </div>
              </div>
            )}

            {tab === "users" && isEdit && (
              <div className={s.cuWrap}>
                <div className={s.cuTools}>
                  <div className={s.searchBox}>
                    <Search size={14} />
                    <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder={tx("search_in_company")} />
                    {refreshingUsers ? <Loader2 size={13} className={s.spin} /> : null}
                  </div>
                  <button type="button" className={s.btnPrimary} onClick={() => onAddUser(company)}>
                    <Plus size={14} /> {tx("add_user")}
                  </button>
                </div>

                {filteredUsers.length > 0 && (
                  <div className={cx(s.bulkBar, selected.size > 0 && s.bulkBarOn)}>
                    <label className={s.check}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                      <span>{selected.size > 0 ? tx("selected", { n: selected.size }) : tx("select_all")}</span>
                    </label>
                    {selected.size > 0 && (
                      <>
                        <button type="button" className={s.linkBtn} onClick={() => setSelected(new Set())}>{tx("clear_sel")}</button>
                        <button type="button" className={s.btnDangerSm} onClick={() => setConfirm({ ids: [...selected] })}>
                          <Trash2 size={13} /> {tx("delete_n", { n: selected.size })}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {loadingUsers ? (
                  <div className={s.cuList}>{[0, 1, 2].map(i => <div key={i} className={s.skelRow} />)}</div>
                ) : companyUsers.length === 0 ? (
                  <div className={s.emptyCard}>
                    <Users size={22} />
                    <p>{tx("no_users_company")}</p>
                    <small>{tx("no_users_company_hint")}</small>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className={s.emptyCard}><p>{tx("no_match", { q: userSearch })}</p></div>
                ) : (
                  <ul className={s.cuList}>
                    {filteredUsers.map(u => {
                      const active = u.is_active && u.uc_is_active;
                      const rc = roleConfig(u.uc_role);
                      const isSel = selected.has(u.id);
                      return (
                        <li key={u.id} className={cx(s.cuRow, isSel && s.cuRowSel, !active && s.cuRowOff)}>
                          <label className={s.check} aria-label={u.username ?? u.email}>
                            <input type="checkbox" checked={isSel} onChange={() => toggleOne(u.id)} />
                          </label>
                          <button type="button" className={s.cuWho} onClick={() => onEditUser(u)}>
                            <Avatar label={u.username || u.email} size={34} />
                            <span className={s.whoText}>
                              <strong>{u.username ?? "—"}</strong>
                              <small>{u.email}</small>
                            </span>
                          </button>
                          <button type="button" className={s.roleBtn} style={{ "--chip": rc.color }}
                            onClick={(e) => setRoleMenu(roleMenu?.user.id === u.id ? null : { user: u, anchor: e.currentTarget })}>
                            {rc.icon ? <rc.icon size={11} strokeWidth={2.6} /> : null}
                            {tx(rc.labelKey)}
                            <ChevronDown size={12} />
                          </button>
                          <span className={s.cuActive}>
                            <Switch size="sm" checked={active} onChange={() => toggleActive(u)} tone="#0f9f6e"
                              label={active ? tx("adm_active") : tx("adm_inactive")} />
                            <span className={s.cuActiveTxt}>{active ? tx("adm_active") : tx("adm_inactive")}</span>
                          </span>
                          <span className={s.rowActions}>
                            <button type="button" className={s.iconBtnSm} onClick={() => onEditUser(u)} aria-label={tx("edit")}><Edit2 size={13} /></button>
                            <button type="button" className={cx(s.iconBtnSm, s.iconDanger)} onClick={() => setConfirm({ ids: [u.id] })} aria-label={tx("delete")}><Trash2 size={13} /></button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <footer className={s.dFoot}>
            <span className={cx(s.dState, dirty && s.dStateDirty)}>
              {tab === "users" ? tx("users_instant") : !isEdit ? null : dirty ? tx("unsaved") : tx("all_saved")}
            </span>
            <button type="button" className={s.btnGhost} onClick={close} disabled={saving}>{tx("adm_cancel")}</button>
            {tab !== "users" || !isEdit ? (
              <button type="button" className={s.btnPrimary} disabled={saving || (isEdit && !dirty)}
                onClick={async () => { if (await handleSave()) close(); }}>
                {saving ? <Loader2 size={14} className={s.spin} /> : null}
                {isEdit ? tx("adm_save") : tx("create_company")}
              </button>
            ) : null}
          </footer>

          {roleMenu && (
            <Menu anchor={roleMenu.anchor} onClose={() => setRoleMenu(null)} width={272}>
              {ROLES.map(r => (
                <MenuItem key={r.id} icon={r.icon ?? Users} active={roleMenu.user.uc_role === r.id} sub={tx(r.descKey)}
                  onClick={() => { const u = roleMenu.user; setRoleMenu(null); changeRole(u, r.id); }}>
                  {tx(r.labelKey)}
                </MenuItem>
              ))}
            </Menu>
          )}
          {headMenu && (
            <Menu anchor={headMenu} onClose={() => setHeadMenu(null)} width={220}>
              <MenuItem icon={Plus} onClick={() => { setHeadMenu(null); onAddUser(company); }}>{tx("add_user")}</MenuItem>
              <MenuItem icon={Trash2} danger onClick={() => { setHeadMenu(null); onDelete(company); }}>{tx("delete")}</MenuItem>
            </Menu>
          )}
          {confirm && (
            <ConfirmDialog
              title={confirm.ids.length === 1
                ? tx("delete_user_title", { name: companyUsers.find(u => u.id === confirm.ids[0])?.username ?? "" })
                : tx("delete_users_title", { n: confirm.ids.length })}
              body={tx("delete_user_body")}
              confirmLabel={confirm.ids.length === 1 ? tx("delete") : tx("delete_n", { n: confirm.ids.length })}
              cancelLabel={tx("adm_cancel")}
              busy={deleting}
              onConfirm={runDelete}
              onCancel={() => setConfirm(null)} />
          )}
        </>
      )}
    </Drawer>
  );
}