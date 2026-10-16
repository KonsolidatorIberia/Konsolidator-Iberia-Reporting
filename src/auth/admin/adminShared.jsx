/* ══════════════════════════════════════════════════════════════════════
   Centro de control — datos fijos, utilidades y piezas comunes
   (avatar, interruptor, menú, desplegable con búsqueda, panel lateral,
   diálogo de confirmación y avisos).
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, Crown, Minus, Sparkles, X, Zap, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import s from "./AdminPortal.module.css";

export const cx = (...a) => a.filter(Boolean).join(" ");

// ── Niveles y roles ─────────────────────────────────────────────────────────
export const TIERS = [
  { id: "low",  label: "Low",  icon: Minus,    color: "#8b95a9", descKey: "tier_low" },
  { id: "base", label: "Base", icon: Check,    color: "#3b82f6", descKey: "tier_base" },
  { id: "pro",  label: "Pro",  icon: Sparkles, color: "#8b5cf6", descKey: "tier_pro" },
  { id: "max",  label: "Max",  icon: Crown,    color: "#e8a317", descKey: "tier_max" },
];
export const tierConfig = (id) => TIERS.find(x => x.id === id) ?? TIERS[1];

export const ROLES = [
  { id: "regular",    color: "#64748b", icon: null,  labelKey: "role_regular",    descKey: "role_regular_desc" },
  { id: "admin",      color: "#d97706", icon: Crown, labelKey: "role_admin",      descKey: "role_admin_desc" },
  { id: "consultant", color: "#7c3aed", icon: Zap,   labelKey: "role_consultant", descKey: "role_consultant_desc" },
];
export const roleConfig = (id) => ROLES.find(r => r.id === id) ?? ROLES[0];

// Rol que se muestra en la lista de usuarios: el más alto entre sus empresas
export const USER_KINDS = [
  { id: "super",      color: "#e8a317", labelKey: "role_super" },
  { id: "consultant", color: "#7c3aed", labelKey: "role_consultant" },
  { id: "admin",      color: "#d97706", labelKey: "role_admin" },
  { id: "regular",    color: "#3b5bdb", labelKey: "role_regular" },
  { id: "none",       color: "#c3cad8", labelKey: "role_none" },
];
export function userKind(u) {
  if (u.is_super_admin) return "super";
  const links = u._company_links ?? [];
  if (!links.length) return "none";
  if (links.some(l => l.role === "consultant")) return "consultant";
  if (links.some(l => l.role === "admin")) return "admin";
  return "regular";
}

// ── Países (mismo léxico que Signup.jsx) ────────────────────────────────────
export const COUNTRIES = [
  { code: "AT", name: "Austria",        vat: { example: "ATU12345678",      regex: /^ATU\d{8}$/i } },
  { code: "BE", name: "Belgium",        vat: { example: "BE0123456789",     regex: /^BE\d{10}$/i } },
  { code: "BG", name: "Bulgaria",       vat: { example: "BG123456789",      regex: /^BG\d{9,10}$/i } },
  { code: "HR", name: "Croatia",        vat: { example: "HR12345678901",    regex: /^HR\d{11}$/i } },
  { code: "CY", name: "Cyprus",         vat: { example: "CY12345678X",      regex: /^CY\d{8}[A-Z]$/i } },
  { code: "CZ", name: "Czech Republic", vat: { example: "CZ1234567890",     regex: /^CZ\d{8,10}$/i } },
  { code: "DK", name: "Denmark",        vat: { example: "DK12345678",       regex: /^DK\d{8}$/i } },
  { code: "EE", name: "Estonia",        vat: { example: "EE123456789",      regex: /^EE\d{9}$/i } },
  { code: "FI", name: "Finland",        vat: { example: "FI12345678",       regex: /^FI\d{8}$/i } },
  { code: "FR", name: "France",         vat: { example: "FR12345678901",    regex: /^FR[A-Z0-9]{2}\d{9}$/i } },
  { code: "DE", name: "Germany",        vat: { example: "DE123456789",      regex: /^DE\d{9}$/i } },
  { code: "GR", name: "Greece",         vat: { example: "EL123456789",      regex: /^(EL|GR)\d{9}$/i } },
  { code: "HU", name: "Hungary",        vat: { example: "HU12345678",       regex: /^HU\d{8}$/i } },
  { code: "IE", name: "Ireland",        vat: { example: "IE1234567X",       regex: /^IE\d{7}[A-Z]{1,2}$/i } },
  { code: "IT", name: "Italy",          vat: { example: "IT12345678901",    regex: /^IT\d{11}$/i } },
  { code: "LV", name: "Latvia",         vat: { example: "LV12345678901",    regex: /^LV\d{11}$/i } },
  { code: "LT", name: "Lithuania",      vat: { example: "LT123456789",      regex: /^LT(\d{9}|\d{12})$/i } },
  { code: "LU", name: "Luxembourg",     vat: { example: "LU12345678",       regex: /^LU\d{8}$/i } },
  { code: "MT", name: "Malta",          vat: { example: "MT12345678",       regex: /^MT\d{8}$/i } },
  { code: "NL", name: "Netherlands",    vat: { example: "NL123456789B01",   regex: /^NL\d{9}B\d{2}$/i } },
  { code: "PL", name: "Poland",         vat: { example: "PL1234567890",     regex: /^PL\d{10}$/i } },
  { code: "PT", name: "Portugal",       vat: { example: "PT123456789",      regex: /^PT\d{9}$/i } },
  { code: "RO", name: "Romania",        vat: { example: "RO1234567890",     regex: /^RO\d{2,10}$/i } },
  { code: "SK", name: "Slovakia",       vat: { example: "SK1234567890",     regex: /^SK\d{10}$/i } },
  { code: "SI", name: "Slovenia",       vat: { example: "SI12345678",       regex: /^SI\d{8}$/i } },
  { code: "ES", name: "Spain",          vat: { example: "ESB12345678",      regex: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/i } },
  { code: "SE", name: "Sweden",         vat: { example: "SE123456789012",   regex: /^SE\d{12}$/i } },
  { code: "GB", name: "United Kingdom", vat: { example: "GB123456789",      regex: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/i } },
  { code: "CH", name: "Switzerland",    vat: { example: "CHE-123.456.789",  regex: /^CHE-?\d{3}\.?\d{3}\.?\d{3}$/i } },
  { code: "NO", name: "Norway",         vat: { example: "NO123456789MVA",   regex: /^NO\d{9}(MVA)?$/i } },
  { code: "US", name: "United States",  vat: { example: "EIN 12-3456789",   regex: /^\d{2}-?\d{7}$/ } },
  { code: "CA", name: "Canada",         vat: { example: "123456789RT0001",  regex: /^\d{9}(RT|RC|RP)\d{4}$/i } },
  { code: "MX", name: "Mexico",         vat: { example: "ABCD123456EF7",         regex: /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i } },
  { code: "BR", name: "Brazil",         vat: { example: "12.345.678/0001-90",    regex: /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/ } },
  { code: "AR", name: "Argentina",      vat: { example: "30-12345678-9",         regex: /^\d{2}-?\d{8}-?\d{1}$/ } },
  { code: "CL", name: "Chile",          vat: { example: "12.345.678-K",          regex: /^\d{1,2}\.?\d{3}\.?\d{3}-?[\dK]$/i } },
  { code: "CO", name: "Colombia",       vat: { example: "900.123.456-7",         regex: /^\d{3}\.?\d{3}\.?\d{3}-?\d$/ } },
  { code: "PE", name: "Peru",           vat: { example: "20123456789",           regex: /^(10|15|17|20)\d{9}$/ } },
  { code: "UY", name: "Uruguay",        vat: { example: "210123450018",          regex: /^\d{12}$/ } },
  { code: "PY", name: "Paraguay",       vat: { example: "80012345-6",            regex: /^\d{6,9}-?\d$/ } },
  { code: "BO", name: "Bolivia",        vat: { example: "1234567890",            regex: /^\d{7,12}$/ } },
  { code: "EC", name: "Ecuador",        vat: { example: "1790012345001",         regex: /^\d{13}$/ } },
  { code: "VE", name: "Venezuela",      vat: { example: "J-12345678-9",          regex: /^[JGVEP]-?\d{8,9}-?\d?$/i } },
  { code: "DO", name: "Dominican Rep.", vat: { example: "1-01-12345-6",          regex: /^\d-?\d{2}-?\d{5}-?\d$|^\d{9,11}$/ } },
  { code: "CR", name: "Costa Rica",     vat: { example: "3-101-123456",          regex: /^\d-?\d{3}-?\d{6}$/ } },
  { code: "PA", name: "Panama",         vat: { example: "155123456-2-2014",      regex: /^\d{6,12}-?\d-?\d{4}$/ } },
  { code: "GT", name: "Guatemala",      vat: { example: "1234567-8",             regex: /^\d{6,8}-?[\dK]$/i } },
];
export const findCountry = (v) => {
  const q = String(v ?? "").trim().toLowerCase();
  if (!q) return null;
  return COUNTRIES.find(c => c.name.toLowerCase() === q || c.code.toLowerCase() === q) ?? null;
};

export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ── Utilidades ──────────────────────────────────────────────────────────────
export const slugify = (v) => String(v ?? "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const initials = (v) => String(v ?? "").trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase() || "??";

const DATE_LOCALE = { es: "es-ES", en: "en-GB", da: "da-DK", pt: "pt-PT" };
export const fmtDate = (d, locale = "en") => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(DATE_LOCALE[locale] ?? "en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return "—"; }
};

const DAY = 86400000;
const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Estado del periodo de prueba: días que quedan y cuánto se ha consumido
export function trialInfo(c, now) {
  if (!c?.is_trial) return { kind: "paid" };
  const end = c.trial_ends_at ? dayStart(new Date(c.trial_ends_at).getTime()) : null;
  const startRaw = c.trial_started_at ?? c.created_at;
  const start = startRaw ? dayStart(new Date(startRaw).getTime()) : null;
  if (end == null) return { kind: "trial", days: null, pct: null, ended: false, soon: false };
  const today = dayStart(now);
  const days = Math.round((end - today) / DAY);
  const pct = start != null && end > start ? Math.min(1, Math.max(0, (today - start) / (end - start))) : null;
  return { kind: "trial", days, pct, ended: days < 0, soon: days >= 0 && days <= 14 };
}

export function trialLabel(info, tx) {
  if (info.kind !== "trial") return tx("adm_paid");
  if (info.days == null) return tx("no_end_date");
  if (info.days === 0) return tx("ends_today");
  if (info.days === 1) return tx("day_left");
  if (info.days > 1) return tx("days_left", { n: info.days });
  if (info.days === -1) return tx("ended_yesterday");
  return tx("ended_ago", { n: -info.days });
}

// Color estable a partir de un texto (avatares de usuarios)
const AVATAR_TONES = ["#1a2f8a", "#3b5bdb", "#0f766e", "#7c3aed", "#be185d", "#b45309", "#0369a1", "#4d7c0f"];
export const toneFor = (v) => {
  let h = 0;
  const str = String(v ?? "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
};

// ── Funciones del servidor (borrado de usuarios y empresas) ─────────────────
const FN_BASE = "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1";
const FN_KEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

export async function callAdminFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, sessionExpired: true };
  try {
    const res = await fetch(`${FN_BASE}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: FN_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    let result = {};
    try { result = await res.json(); } catch { /* sin cuerpo */ }
    return res.ok ? { ok: true, result } : { ok: false, error: result?.error ?? `Error ${res.status}` };
  } catch (e) {
    return { ok: false, network: true, error: e?.message ?? String(e) };
  }
}

// Borra varios usuarios y devuelve los que se han borrado de verdad
export async function deleteUsers(ids) {
  const done = [];
  let failed = 0;
  let sessionExpired = false;
  for (const id of ids) {
    const r = await callAdminFunction("delete-user", { user_id: id });
    if (r.sessionExpired) { sessionExpired = true; break; }
    if (r.ok) done.push(id); else failed += 1;
  }
  return { done, failed, sessionExpired };
}

// ── Piezas ──────────────────────────────────────────────────────────────────
export function Avatar({ label, tone, size = 36, square = true, children }) {
  const bg = tone ?? toneFor(label);
  return (
    <span className={s.avatar} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), borderRadius: square ? Math.round(size * 0.32) : "50%", "--av": bg }}>
      {children ?? initials(label)}
    </span>
  );
}

export function Switch({ checked, onChange, label, tone = "#1a2f8a", disabled, size = "md" }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={cx(s.switch, size === "sm" && s.switchSm, checked && s.switchOn)}
      style={{ "--sw": tone }}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
      <span className={s.switchKnob} />
    </button>
  );
}

export function Field({ label, hint, error, aside, children, htmlFor }) {
  return (
    <div className={s.field}>
      {(label || aside) && (
        <div className={s.fieldHead}>
          {label && <label className={s.fieldLabel} htmlFor={htmlFor}>{label}</label>}
          {aside && <span className={s.fieldAside}>{aside}</span>}
        </div>
      )}
      {children}
      {error ? <p className={s.fieldError}>{error}</p> : hint ? <p className={s.fieldHint}>{hint}</p> : null}
    </div>
  );
}

export function TierChip({ tier, tx, size }) {
  const tc = tierConfig(tier);
  const Icon = tc.icon;
  return (
    <span className={cx(s.chip, size === "lg" && s.chipLg)} style={{ "--chip": tc.color }}>
      <Icon size={size === "lg" ? 12 : 10} strokeWidth={2.6} />
      {tc.label}
      {size === "lg" && tx ? <span className={s.chipSub}>{tx(tc.descKey)}</span> : null}
    </span>
  );
}

export function RoleChip({ role, tx }) {
  const rc = roleConfig(role);
  const Icon = rc.icon;
  return (
    <span className={s.chip} style={{ "--chip": rc.color }}>
      {Icon ? <Icon size={10} strokeWidth={2.6} /> : null}
      {tx(rc.labelKey)}
    </span>
  );
}

// ── Capas: solo la de arriba responde a Escape ──────────────────────────────
const layerStack = [];
function useTopLayerEscape(onEscape) {
  const id = useId();
  const cb = useRef(onEscape);
  useEffect(() => { cb.current = onEscape; });
  useEffect(() => {
    layerStack.push(id);
    const onKey = (e) => {
      if (e.key !== "Escape" || layerStack[layerStack.length - 1] !== id) return;
      e.stopPropagation();
      cb.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = layerStack.lastIndexOf(id);
      if (i >= 0) layerStack.splice(i, 1);
    };
  }, [id]);
}

// Panel lateral con entrada y salida animadas. children(close) recibe la
// función que cierra con animación.
export function Drawer({ onClose, width = 880, layer = 0, labelledBy, children }) {
  const [closing, setClosing] = useState(false);
  const panelRef = useRef(null);
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 230);
  }, [onClose]);
  useTopLayerEscape(close);
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);
  return createPortal(
    <div className={cx(s.drawerWrap, closing && s.isClosing)} style={{ zIndex: 70 + layer * 10 }}>
      <div className={s.scrim} onClick={close} />
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        className={s.drawer} style={{ "--dw": `${width}px` }}>
        {children(close)}
      </section>
    </div>,
    document.body,
  );
}

// Diálogo de confirmación (con texto a escribir para las acciones graves)
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, requireText, requireLabel, busy, onConfirm, onCancel }) {
  const [typed, setTyped] = useState("");
  const ok = !requireText || typed.trim() === requireText;
  useTopLayerEscape(() => { if (!busy) onCancel(); });
  const inputId = useId();
  return createPortal(
    <div className={s.dialogWrap}>
      <div className={s.scrim} onClick={() => !busy && onCancel()} />
      <div className={s.dialog} role="alertdialog" aria-modal="true" aria-labelledby={`${inputId}-t`}>
        <span className={s.dialogIcon}><AlertCircle size={20} /></span>
        <h2 id={`${inputId}-t`} className={s.dialogTitle}>{title}</h2>
        <p className={s.dialogBody}>{body}</p>
        {requireText ? (
          <div className={s.dialogType}>
            <label htmlFor={inputId}>{requireLabel}</label>
            <input id={inputId} className={s.input} value={typed} autoFocus autoComplete="off" spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && ok && !busy) onConfirm(); }} />
          </div>
        ) : null}
        <div className={s.dialogActions}>
          <button type="button" className={s.btnGhost} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={s.btnDanger} onClick={onConfirm} disabled={!ok || busy} autoFocus={!requireText}>
            {busy ? <Loader2 size={14} className={s.spin} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Menú flotante anclado a un botón (se abre hacia donde haya sitio)
export function Menu({ anchor, onClose, children, width = 240, align = "end" }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 200;
      const below = window.innerHeight - r.bottom - 12;
      const up = below < h && r.top > below;
      const left = align === "end" ? r.right - width : r.left;
      setPos({
        top: up ? Math.max(8, r.top - h - 6) : r.bottom + 6,
        left: Math.min(Math.max(8, left), window.innerWidth - width - 8),
        origin: up ? "bottom" : "top",
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, width, align]);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);
  useTopLayerEscape(onClose);
  return createPortal(
    <div ref={ref} role="menu" className={s.menu}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, transformOrigin: pos?.origin === "bottom" ? "bottom right" : "top right", visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, sub, active }) {
  return (
    <button type="button" role="menuitem" className={cx(s.menuItem, danger && s.menuDanger, active && s.menuActive)} onClick={onClick}>
      {Icon ? <Icon size={14} /> : null}
      <span className={s.menuText}>
        {children}
        {sub ? <small>{sub}</small> : null}
      </span>
      {active ? <Check size={14} className={s.menuCheck} /> : null}
    </button>
  );
}

// Desplegable con búsqueda (país, empresa, usuario, dirección)
export function Combo({ value, onChange, items, getKey, renderItem, onPick, placeholder, disabled, loading, invalid, valid, mono, icon: Icon, emptyText, autoFocus, id, onBlurText, filterLocally = true }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();
  const visible = items.slice(0, 50);
  const pick = (it) => { onPick(it); setOpen(false); setHi(0); };
  const onKey = (e) => {
    if (!open && (e.key === "ArrowDown" || (e.key === "Enter" && filterLocally))) { setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, visible.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { if (visible[hi]) { e.preventDefault(); pick(visible[hi]); } }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className={s.combo}>
      {Icon ? <Icon size={14} className={s.inputIcon} /> : null}
      <input id={id} type="text" value={value} disabled={disabled} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
        role="combobox" aria-expanded={open} aria-controls={listId}
        className={cx(s.input, Icon && s.inputWithIcon, mono && s.mono, invalid && s.inputBad, valid && s.inputOk)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 140); onBlurText?.(); }}
        onKeyDown={onKey} />
      {loading ? <Loader2 size={14} className={cx(s.inputTrail, s.spin)} /> : null}
      {open && !disabled && (visible.length > 0 || (emptyText && value.trim())) ? (
        <div id={listId} role="listbox" className={s.comboList}>
          {visible.length === 0 ? <p className={s.comboEmpty}>{emptyText}</p> : visible.map((it, i) => (
            <button key={getKey(it)} type="button" role="option" aria-selected={i === hi}
              className={cx(s.comboItem, i === hi && s.comboItemHi)}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              onMouseEnter={() => setHi(i)}>
              {renderItem(it)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Avisos ──────────────────────────────────────────────────────────────────
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(list => [...list.slice(-3), { id, type, message }]);
    setTimeout(() => setToasts(list => list.filter(x => x.id !== id)), type === "error" ? 6000 : 3800);
  }, []);
  const dismiss = useCallback((id) => setToasts(list => list.filter(x => x.id !== id)), []);
  return { toasts, show, dismiss };
}

export function Toaster({ toasts, dismiss }) {
  return createPortal(
    <div className={s.toaster} aria-live="polite">
      {toasts.map(tt => (
        <div key={tt.id} className={cx(s.toast, tt.type === "error" && s.toastError)} role={tt.type === "error" ? "alert" : "status"}>
          <span className={s.toastIcon}>{tt.type === "error" ? <AlertCircle size={15} /> : <Check size={15} strokeWidth={3} />}</span>
          <span className={s.toastMsg}>{tt.message}</span>
          <button type="button" className={s.toastClose} onClick={() => dismiss(tt.id)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ))}
    </div>,
    document.body,
  );
}