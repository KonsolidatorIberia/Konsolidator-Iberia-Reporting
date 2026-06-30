import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Building2, Users, Activity, LogOut, Search, Plus, X,
  Edit2, Trash2, Check, AlertCircle, Loader2, Crown,
  Sparkles, RefreshCw, Calendar,
  ShieldCheck, Zap, Minus, Filter, ChevronRight, Database,
  Square, CheckSquare,
} from "lucide-react";
import { supabase, sbAccounts } from "../lib/supabaseClient";
import { LOCALES, t } from "../lib/i18n";

// ════════════════════════════════════════════════════════════════
// PALETTE
// ════════════════════════════════════════════════════════════════
const C = {
  navy:      "#1a2f8a",
  navyDark:  "#0f1f5c",
  navyDeep:  "#091548",
  red:       "#e8394a",
  redDark:   "#cf2c3d",
  amber:     "#fbbf24",
  green:     "#34d399",
  white:     "#ffffff",
};

// ════════════════════════════════════════════════════════════════
// TIER & ROLE CONFIG
// ════════════════════════════════════════════════════════════════
const TIERS = [
  { id: "low",  label: "Low",  icon: Minus,    color: "#94a3b8", desc: "Acceso básico" },
  { id: "base", label: "Base", icon: Check,    color: "#60a5fa", desc: "Plan estándar" },
  { id: "pro",  label: "Pro",  icon: Sparkles, color: "#a78bfa", desc: "Avanzado" },
  { id: "max",  label: "Max",  icon: Crown,    color: "#fbbf24", desc: "Sin límites" },
];
const tierConfig = (id) => TIERS.find(t => t.id === id) ?? TIERS[1];

// ════════════════════════════════════════════════════════════════
// COUNTRIES — same lexicon as Signup.jsx (27 EU + UK/CH/NO/US/CA + LATAM)
// ════════════════════════════════════════════════════════════════
const COUNTRIES = [
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

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
const slugify = (s) => String(s ?? "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return "—"; }
};

const initials = (s) => String(s ?? "").trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase() || "??";

const generatePassword = () => {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const symbols = "!@#$%&*";
  let p = "";
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  p += symbols[Math.floor(Math.random() * symbols.length)];
  p += Math.floor(Math.random() * 100);
  return p;
};

// ════════════════════════════════════════════════════════════════
// LIVE BACKGROUND — same lexicon as Login/EpicLoader
// ════════════════════════════════════════════════════════════════
function LiveBackground() {
  const EQUATIONS = [
    "EBITDA = Revenue − COGS − OpEx",
    "NPV = Σ CFₜ / (1+r)ᵗ",
    "WACC = (E/V)·Rₑ + (D/V)·R_d·(1−T)",
    "ROIC = NOPAT / Invested Capital",
    "FCF = EBIT(1−t) + D&A − ΔWC − CapEx",
    "P/E = Price / EPS",
    "DSO = (AR / Revenue) × 365",
    "Net Margin = NI / Revenue",
    "Gross Margin = (Rev − COGS) / Rev",
    "DCF: Σ FCFₜ / (1+WACC)ᵗ + TV",
    "ΔRevenue YoY = (R_t − R_{t−1}) / R_{t−1}",
    "Quick Ratio = (CA − Inv) / CL",
    "D/E = Total Debt / Equity",
    "EV = MktCap + Debt − Cash",
    "EPS = (NI − Pref Div) / Shares",
  ];

  const TICKERS = [
    { l: "COMPANIES", v: "ACTIVE",  c: "#34d399" },
    { l: "USERS",     v: "ONLINE",  c: "#34d399" },
    { l: "SECURITY",  v: "RLS",     c: "#fbbf24" },
    { l: "STATUS",    v: "LIVE",    c: "#ffffff" },
    { l: "ROLES",     v: "ADMIN",   c: "#fbbf24" },
    { l: "ACCESS",    v: "GRANTED", c: "#34d399" },
    { l: "TIER MAX",  v: "PRO",     c: "#fbbf24" },
    { l: "ENTITIES",  v: "MULTI",   c: "#ffffff" },
    { l: "AUDIT",     v: "OK",      c: "#34d399" },
    { l: "BACKUPS",   v: "DAILY",   c: "#ffffff" },
    { l: "REGION",    v: "EU",      c: "#fbbf24" },
    { l: "UPTIME",    v: "99.98%",  c: "#34d399" },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Ambient blobs */}
      <div className="absolute top-[10%] left-[8%] w-[600px] h-[600px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
          filter: "blur(60px)",
          animation: "adminFloat 22s ease-in-out infinite",
        }} />
      <div className="absolute top-[30%] right-[6%] w-[500px] h-[500px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(168,197,255,0.5), transparent 65%)",
          filter: "blur(70px)",
        }} />

      {/* Grain */}
      <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />

      {/* Drifting equations */}
      {EQUATIONS.map((eq, i) => {
        const left = (i * 17 + 5) % 90;
        const dur = 28 + (i % 7) * 3;
        const delay = -((i * 2.2) % dur);
        const size = 11 + (i % 4);
        return (
          <div key={`eq-${i}`} className="absolute"
            style={{
              bottom: "-10%",
              left: `${left}%`,
              fontSize: size,
              fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
              color: "rgba(255,255,255,0.5)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              animation: `${i % 2 === 0 ? "adminDrift" : "adminDriftSlow"} ${dur}s linear ${delay}s infinite`,
            }}>
            {eq}
          </div>
        );
      })}

      {/* Tickers — 3 anchored clusters */}
      <div className="absolute top-[6%] right-[3%] flex flex-col gap-2 items-end">
        {TICKERS.slice(0, 4).map((tk, i) => (
          <div key={`tk-top-${i}`} className="admin-ticker flex items-center gap-2">
            <span className="opacity-60">{tk.l}</span>
            <span style={{ color: tk.c }}>{tk.v}</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#34d399", animation: "adminBlink 1.6s ease-in-out infinite" }} />
          </div>
        ))}
      </div>
      <div className="absolute bottom-[10%] right-[6%] flex flex-col gap-2 items-end">
        {TICKERS.slice(4, 8).map((tk, i) => (
          <div key={`tk-bot-${i}`} className="admin-ticker flex items-center gap-2">
            <span className="opacity-60">{tk.l}</span>
            <span style={{ color: tk.c }}>{tk.v}</span>
          </div>
        ))}
      </div>
      <div className="absolute top-[55%] left-[1%] flex flex-col gap-2">
        {TICKERS.slice(8, 12).map((tk, i) => (
          <div key={`tk-left-${i}`} className="admin-ticker flex items-center gap-2">
            <span className="opacity-60">{tk.l}</span>
            <span style={{ color: tk.c }}>{tk.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// PRIMITIVES
// ════════════════════════════════════════════════════════════════

function Toggle({ checked, onChange, accent = C.red }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex shrink-0 items-center rounded-full transition-all duration-300 focus:outline-none"
      style={{
        width: 42, height: 24,
        background: checked ? accent : "rgba(26,47,138,0.15)",
        boxShadow: checked ? `0 0 20px ${accent}80, inset 0 1px 2px rgba(0,0,0,0.1)` : "inset 0 1px 2px rgba(0,0,0,0.1)",
      }}>
      <span className="inline-block rounded-full bg-white shadow-lg transition-all duration-300 ease-out"
        style={{
          width: 18, height: 18,
          transform: checked ? "translateX(22px)" : "translateX(3px)",
          boxShadow: "0 2px 4px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.3)",
        }} />
    </button>
  );
}

function Toast({ type, message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  const isError = type === "error";
  return (
    <div
      className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
      style={{
        animation: "adminSlideInRight 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(20px) saturate(150%)",
        border: `1px solid ${isError ? "rgba(232,57,74,0.4)" : "rgba(52,211,153,0.4)"}`,
        boxShadow: `0 20px 50px rgba(15,31,92,0.3), 0 0 30px ${isError ? "rgba(232,57,74,0.2)" : "rgba(52,211,153,0.2)"}`,
        minWidth: 280,
      }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: isError ? "rgba(232,57,74,0.12)" : "rgba(52,211,153,0.15)",
          border: `1px solid ${isError ? "rgba(232,57,74,0.4)" : "rgba(52,211,153,0.4)"}`,
        }}>
        {isError ? <AlertCircle size={16} style={{ color: "#dc2626" }} /> : <Check size={16} style={{ color: "#059669" }} />}
      </div>
      <span className="text-sm font-bold" style={{ color: C.navyDark }}>{message}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// HERO STAT CARD
// ════════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
function HeroStat({ label, value, icon: Icon, color, accent, delay = 0 }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 transition-all duration-500 hover:scale-[1.02] group"
      style={{
        background: `linear-gradient(135deg, ${color}f0 0%, ${color} 70%, ${accent ?? color} 100%)`,
        boxShadow: `0 8px 24px -8px ${color}90, inset 0 1px 0 rgba(255,255,255,0.15)`,
        animation: `adminCardEntry 0.7s cubic-bezier(0.34,1.56,0.64,1) ${delay}s both`,
      }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
        style={{
          background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)",
          backgroundSize: "200% 100%",
          animation: "adminShimmer 1.5s ease-in-out infinite",
        }} />
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-20 blur-2xl"
        style={{ background: "rgba(255,255,255,0.5)" }} />

      <div className="relative z-10 flex items-start justify-between mb-3">
        <p className="text-[9px] font-black text-white/75 uppercase tracking-[0.2em]">{label}</p>
        <div className="w-7 h-7 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
          <Icon size={12} className="text-white" />
        </div>
      </div>
      <p className="relative z-10 text-3xl font-black text-white tabular-nums" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        {value}
      </p>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// COMPANY MODAL — Sui-aesthetic fullscreen overlay
// Replace the entire existing CompanyModal function with this.
// All logic (state, handlers, refs, effects) stays identical.
// ════════════════════════════════════════════════════════════════
function CompanyModal({ company, onClose, onSaved, showToast, onEditUser, onAddUserForCompany, locale }) {
  const isEdit = !!company;
  const [form, setForm] = useState({
    name: company?.name ?? "",
    slug: company?.slug ?? "",
    tier: company?.tier ?? "base",
    is_trial: company?.is_trial ?? true,
    trial_started_at: company?.trial_started_at?.slice(0, 10) ?? "",
    trial_ends_at:    company?.trial_ends_at?.slice(0, 10) ?? "",
    country:          company?.country          ?? "",
    vat_id:           company?.vat_id           ?? "",
    street:           company?.street           ?? "",
    street_number:    company?.street_number    ?? "",
    postal_code:      company?.postal_code      ?? "",
    city:             company?.city             ?? "",
    full_name:        company?.full_name        ?? "",
    phone:            company?.phone            ?? "",
    bank_holder_name: company?.bank_holder_name ?? "",
    bank_iban:        company?.bank_iban        ?? "",
    billing_emails:   Array.isArray(company?.billing_emails) ? company.billing_emails : [],
    contract_start_date: company?.contract_start_date?.slice(0, 10) ?? "",
  });

  const [countryOpen, setCountryOpen]           = useState(false);
  const [countryHighlight, setCountryHighlight] = useState(0);
  const [vatBlurred, setVatBlurred]             = useState(false);

  const [addrSuggestions, setAddrSuggestions] = useState([]);
  const [addrLoading, setAddrLoading]         = useState(false);
  const [addrOpen, setAddrOpen]               = useState(false);
  const [addrHighlight, setAddrHighlight]     = useState(-1);
  const addrAbortRef    = useRef(null);
  const addrDebounceRef = useRef(null);
  const addrSilenceRef  = useRef(false);

  const [emailDraft, setEmailDraft]   = useState("");
  const [emailError, setEmailError]   = useState("");

  const [saving, setSaving] = useState(false);
  const [slugDirty, setSlugDirty] = useState(isEdit);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filteredUsers = companyUsers.filter(u => {
    if (!userSearch.trim()) return true;
    const q = userSearch.trim().toLowerCase();
    return (u.username ?? "").toLowerCase().includes(q) ||
           (u.email ?? "").toLowerCase().includes(q);
  });

  const toggleSelectedUser = (id) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;
    const ids = Array.from(selectedUsers);
    const confirmMsg = ids.length === 1
      ? t(locale, "adm_delete_user_confirm")
      : `${t(locale, "adm_delete_user_confirm")} (${ids.length})`;
    if (!window.confirm(confirmMsg)) return;

    setBulkDeleting(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBulkDeleting(false);
      showToast("error", t(locale, "adm_session_expired"));
      return;
    }

    let okCount = 0, failCount = 0;
    for (const id of ids) {
      try {
        const res = await fetch(
          "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/delete-user",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ user_id: id }),
          }
        );
        if (res.ok) okCount++; else failCount++;
      } catch { failCount++; }
    }

    setCompanyUsers(prev => prev.filter(u => !ids.includes(u.id) || failCount > 0));
    setSelectedUsers(new Set());
    setBulkDeleting(false);

    if (failCount === 0) showToast("success", `${okCount} ${t(locale, "adm_user_deleted")}`);
    else if (okCount === 0) showToast("error", `${failCount} ${t(locale, "adm_network_error")}`);
    else showToast("error", `${okCount} OK · ${failCount} failed`);
    onSaved();
  };

  const handleNameChange = (v) => setForm(f => ({ ...f, name: v, slug: slugDirty ? f.slug : slugify(v) }));

  useEffect(() => {
    if (!company?.id) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) setLoadingUsers(true);
      const { data: links } = await sbAccounts.from("user_companies").select("user_id, is_active").eq("company_id", company.id);
      const userIds = (links ?? []).map(l => l.user_id);
      if (!userIds.length) { setLoadingUsers(false); return; }
      const { data: users } = await sbAccounts.from("users").select("id, username, email, is_active").in("id", userIds);
      const ucMap = new Map((links ?? []).map(l => [l.user_id, l]));
      if (!cancelled) {
        setCompanyUsers((users ?? []).map(u => ({ ...u, uc_is_active: ucMap.get(u.id)?.is_active ?? true })));
        setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company?.id]);

  const selectedCountry = COUNTRIES.find(
    c => c.name.toLowerCase() === form.country.trim().toLowerCase() ||
         c.code.toLowerCase() === form.country.trim().toLowerCase()
  );

  const filteredCountries = (() => {
    const q = form.country.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().startsWith(q)
    );
  })();

  const vatPlaceholder = selectedCountry?.vat.example ?? "Select country first";

  const vatLooksValid = (() => {
    if (!form.vat_id.trim() || !selectedCountry) return null;
    const cleaned    = form.vat_id.replace(/\s+/g, "");
    const exampleLen = selectedCountry.vat.example.replace(/\s+/g, "").length;
    if (cleaned.length < exampleLen && !vatBlurred) return null;
    return selectedCountry.vat.regex.test(cleaned);
  })();

  const pickCountry = (c) => {
    setForm(f => ({ ...f, country: c.name }));
    setCountryOpen(false);
    setCountryHighlight(0);
    setVatBlurred(false);
  };

  const handleCountryKeyDown = (e) => {
    if (!countryOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") setCountryOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCountryHighlight(h => Math.min(h + 1, filteredCountries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCountryHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const q = form.country.trim().toLowerCase();
      const exact = filteredCountries.find(c =>
        c.name.toLowerCase() === q || c.code.toLowerCase() === q
      );
      const target = exact ?? filteredCountries[countryHighlight];
      if (target) pickCountry(target);
    } else if (e.key === "Escape") {
      setCountryOpen(false);
    }
  };

  const fetchAddressSuggestions = (query) => {
    if (addrDebounceRef.current) clearTimeout(addrDebounceRef.current);
    if (addrAbortRef.current)    addrAbortRef.current.abort();

    if (!query || query.trim().length < 3) {
      setAddrSuggestions([]); setAddrLoading(false); setAddrOpen(false);
      return;
    }

    addrDebounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      addrAbortRef.current = ctrl;
      setAddrLoading(true);
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&layer=house&layer=street`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`Photon ${res.status}`);
        const data = await res.json();
        const features = Array.isArray(data?.features) ? data.features : [];
        setAddrSuggestions(features);
        setAddrOpen(features.length > 0);
        setAddrHighlight(-1);
      } catch (err) {
        if (err.name !== "AbortError") { setAddrSuggestions([]); setAddrOpen(false); }
      } finally {
        setAddrLoading(false);
      }
    }, 300);
  };

  const pickAddressSuggestion = (f) => {
    const p = f.properties ?? {};
    addrSilenceRef.current = true;
    setForm(form => ({
      ...form,
      street:        p.name ?? form.street,
      street_number: p.housenumber ?? form.street_number,
      city:          p.city ?? p.town ?? p.village ?? p.county ?? form.city,
      postal_code:   p.postcode ?? form.postal_code,
      country:       p.country ?? form.country,
    }));
    setAddrOpen(false);
    setAddrSuggestions([]);
    setAddrHighlight(-1);
    setTimeout(() => { addrSilenceRef.current = false; }, 50);
  };

  const handleStreetChange = (value) => {
    setForm(f => ({ ...f, street: value }));
    if (addrSilenceRef.current) return;
    fetchAddressSuggestions(value);
  };

  const handleStreetKeyDown = (e) => {
    if (!addrOpen || addrSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAddrHighlight(h => Math.min(h + 1, addrSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAddrHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && addrHighlight >= 0) {
      e.preventDefault();
      pickAddressSuggestion(addrSuggestions[addrHighlight]);
    } else if (e.key === "Escape") {
      setAddrOpen(false);
    }
  };

  const ibanClean = form.bank_iban.replace(/\s+/g, "").toUpperCase();
  const ibanLooksValid = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ibanClean);
  const handleIbanChange = (raw) => {
    const cleaned = raw.replace(/\s+/g, "").toUpperCase().slice(0, 34);
    const grouped = cleaned.match(/.{1,4}/g)?.join(" ") ?? "";
    setForm(f => ({ ...f, bank_iban: grouped }));
  };

  const addEmail = () => {
    const e = emailDraft.trim();
    if (!e) return;
    if (!EMAIL_REGEX.test(e)) { setEmailError("Invalid email"); return; }
    if (form.billing_emails.some(x => x.toLowerCase() === e.toLowerCase())) {
      setEmailError("Already added"); return;
    }
    setForm(f => ({ ...f, billing_emails: [...f.billing_emails, e] }));
    setEmailDraft("");
    setEmailError("");
  };
  const removeEmail = (idx) => setForm(f => ({
    ...f, billing_emails: f.billing_emails.filter((_, i) => i !== idx),
  }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      showToast("error", "Nombre y slug son obligatorios");
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
    if (error) {
      showToast("error", error.message);
      return;
    }
    showToast("success", isEdit ? t(locale, "adm_save") : t(locale, "adm_new_company"));
    onSaved();
    onClose();
  };

  // ═══════════════════════════════════════════════════════════════
  // CREATE MODE — compact modal, single column
  // ═══════════════════════════════════════════════════════════════
  if (!isEdit) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(9,21,72,0.6)", backdropFilter: "blur(16px)", animation: "adminFadeIn 0.25s ease-out both" }}
        onClick={onClose}>
        <div className="w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
          style={{
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(28px) saturate(150%)",
            borderRadius: 28,
            boxShadow: "0 40px 100px -20px rgba(15,31,92,0.5)",
            animation: "adminModalEntry 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
          }}
          onClick={(e) => e.stopPropagation()}>

          <div className="relative px-8 py-6 overflow-hidden shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)" }}>
                  <Building2 size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-300">
                    {t(locale, "adm_create")} · {t(locale, "adm_companies")}
                  </p>
                  <h3 className="text-white font-black text-2xl leading-tight mt-0.5">
                    {t(locale, "adm_new_company")}
                  </h3>
                </div>
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="p-7 space-y-5 overflow-y-auto admin-scroll">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Legal name</label>
              <input type="text" value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Corporation" className="admin-input" />
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>ID / Slug</label>
              <input type="text" value={form.slug}
                onChange={(e) => { setSlugDirty(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })); }}
                placeholder="acme-corp" className="admin-input font-mono" />
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Tier</label>
              <div className="grid grid-cols-4 gap-2">
                {TIERS.map(ti => {
                  const active = form.tier === ti.id;
                  return (
                    <button key={ti.id} type="button"
                      onClick={() => setForm(f => ({ ...f, tier: ti.id }))}
                      className="relative rounded-2xl p-3 transition-all text-left"
                      style={{
                        background: active ? `linear-gradient(135deg, ${ti.color}f0, ${ti.color})` : "rgba(255,255,255,0.7)",
                        border: `2px solid ${active ? ti.color : "rgba(26,47,138,0.08)"}`,
                        boxShadow: active ? `0 8px 20px -4px ${ti.color}80` : "none",
                      }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-1.5"
                        style={{ background: active ? "rgba(255,255,255,0.25)" : `${ti.color}15`, color: active ? "#fff" : ti.color }}>
                        <ti.icon size={13} />
                      </div>
                      <p className="text-xs font-black" style={{ color: active ? "#fff" : C.navyDark }}>{ti.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="px-7 py-4 flex items-center justify-end gap-2 shrink-0 border-t" style={{ background: "rgba(26,47,138,0.03)", borderColor: "rgba(26,47,138,0.08)" }}>
            <button onClick={onClose} disabled={saving}
              className="px-5 py-2.5 text-xs font-black rounded-xl hover:bg-white/60 transition-colors" style={{ color: `${C.navy}70` }}>
              {t(locale, "adm_cancel")}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)`, boxShadow: `0 8px 20px -4px ${C.navy}80` }}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              {t(locale, "adm_new_company")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // EDIT MODE — fullscreen Sui overlay, 4-column grid
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(9,21,72,0.7)", backdropFilter: "blur(20px)", animation: "adminFadeIn 0.25s ease-out both" }}
      onClick={onClose}>
      <div className="w-full overflow-hidden flex flex-col relative"
style={{
          maxWidth: "1500px",
          maxHeight: "95vh",
          background: "linear-gradient(180deg, #3a5cd9 0%, #6a8cf0 50%, #a8c5ff 100%)",
          borderRadius: 32,
          boxShadow: "0 50px 120px -20px rgba(15,31,92,0.6)",
          animation: "adminModalEntry 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* Ambient blobs inside */}
        <div className="absolute top-[10%] left-[8%] w-[400px] h-[400px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.2), transparent 65%)", filter: "blur(60px)" }} />
        <div className="absolute bottom-[10%] right-[8%] w-[400px] h-[400px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(168,197,255,0.3), transparent 65%)", filter: "blur(70px)" }} />

        {/* HEADER */}
        <div className="relative px-8 py-5 shrink-0 flex items-center justify-between border-b" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.2)" }}>
              <Building2 size={22} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-200">
                ━ Edit · Company
              </p>
              <h3 className="text-white font-black text-2xl leading-tight mt-0.5"
                style={{ textShadow: "0 0 30px rgba(255,255,255,0.3)" }}>
                {form.name || "Company"}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all">
            <X size={20} />
          </button>
        </div>

        {/* 4-COLUMN GRID */}
        <div className="relative flex-1 min-h-0 grid gap-4 p-4"
          style={{ gridTemplateColumns: "1fr 1.2fr 1fr 1.3fr" }}>

          {/* ─── COL 1: Company ─────────────────────────── */}
          <div className="rounded-3xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(255,255,255,0.62)",
              backdropFilter: "blur(28px) saturate(150%)",
              border: "1px solid rgba(255,255,255,0.85)",
              boxShadow: "0 12px 32px -8px rgba(15,31,92,0.3)",
            }}>
            <div className="px-5 py-4 shrink-0 border-b" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: C.red }}>━ Company</p>
              <h4 className="text-sm font-black mt-0.5" style={{ color: C.navyDark }}>Basics</h4>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto admin-scroll px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Legal name</label>
                <input type="text" value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Acme Corporation" className="admin-input" />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>ID / Slug</label>
                <input type="text" value={form.slug}
                  onChange={(e) => { setSlugDirty(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })); }}
                  placeholder="acme-corp" className="admin-input font-mono" />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Tier</label>
                <div className="grid grid-cols-2 gap-2">
                  {TIERS.map(ti => {
                    const active = form.tier === ti.id;
                    return (
                      <button key={ti.id} type="button"
                        onClick={() => setForm(f => ({ ...f, tier: ti.id }))}
                        className="relative rounded-2xl p-3 transition-all text-left"
                        style={{
                          background: active ? `linear-gradient(135deg, ${ti.color}f0, ${ti.color})` : "rgba(255,255,255,0.7)",
                          border: `2px solid ${active ? ti.color : "rgba(26,47,138,0.08)"}`,
                          boxShadow: active ? `0 8px 20px -4px ${ti.color}80` : "none",
                        }}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-1.5"
                          style={{ background: active ? "rgba(255,255,255,0.25)" : `${ti.color}15`, color: active ? "#fff" : ti.color }}>
                          <ti.icon size={13} />
                        </div>
                        <p className="text-xs font-black" style={{ color: active ? "#fff" : C.navyDark }}>{ti.label}</p>
                        <p className="text-[9px] font-medium mt-0.5 leading-tight"
                          style={{ color: active ? "rgba(255,255,255,0.85)" : `${C.navy}60` }}>
                          {ti.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-2xl"
                style={{
                  background: form.is_trial ? "linear-gradient(135deg, #fef3c7, #fde68a)" : "linear-gradient(135deg, #d1fae5, #a7f3d0)",
                  border: `1px solid ${form.is_trial ? "#fcd34d" : "#6ee7b7"}`,
                }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm"
                    style={{ background: form.is_trial ? C.amber : "#10b981" }}>
                    {form.is_trial ? <Calendar size={13} /> : <Check size={13} />}
                  </div>
                  <div>
                    <p className="text-xs font-black" style={{ color: C.navyDark }}>
                      {form.is_trial ? t(locale, "adm_trial_only") : t(locale, "adm_paid")}
                    </p>
                  </div>
                </div>
                <Toggle checked={form.is_trial} onChange={(v) => setForm(f => ({ ...f, is_trial: v }))} accent={C.amber} />
              </div>
              {form.is_trial && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "trial_started_at", label: t(locale, "start_m") },
                    { key: "trial_ends_at",    label: t(locale, "end_m") },
                  ].map(d => (
                    <div key={d.key}>
                      <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>{d.label}</label>
                      <input type="date" value={form[d.key]}
                        onChange={(e) => setForm(f => ({ ...f, [d.key]: e.target.value }))}
                        className="admin-input text-xs" />
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Contract start</label>
                <input type="date" value={form.contract_start_date}
                  onChange={(e) => setForm(f => ({ ...f, contract_start_date: e.target.value }))}
                  className="admin-input" />
              </div>
            </div>
          </div>

          {/* ─── COL 2: Address & Contact ─────────────── */}
          <div className="rounded-3xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(255,255,255,0.62)",
              backdropFilter: "blur(28px) saturate(150%)",
              border: "1px solid rgba(255,255,255,0.85)",
              boxShadow: "0 12px 32px -8px rgba(15,31,92,0.3)",
            }}>
            <div className="px-5 py-4 shrink-0 border-b" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: C.red }}>━ Address & Contact</p>
              <h4 className="text-sm font-black mt-0.5" style={{ color: C.navyDark }}>Location and people</h4>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto admin-scroll px-5 py-4 space-y-4">
              <div className="relative">
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Country</label>
                <input type="text" value={form.country}
                  onChange={(e) => { const v = e.target.value; setForm(f => ({ ...f, country: v })); setCountryOpen(true); setCountryHighlight(0); }}
                  onFocus={() => setCountryOpen(true)}
                  onBlur={() => setTimeout(() => setCountryOpen(false), 150)}
                  onKeyDown={handleCountryKeyDown}
                  placeholder="Spain" className="admin-input" autoComplete="off" />
                {countryOpen && filteredCountries.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                    style={{
                      background: "rgba(255,255,255,0.98)",
                      backdropFilter: "blur(20px)",
                      border: "1px solid rgba(26,47,138,0.15)",
                      boxShadow: "0 20px 50px -12px rgba(15,31,92,0.25)",
                      maxHeight: 220, overflowY: "auto",
                    }}>
                    {filteredCountries.map((c, i) => {
                      const active = i === countryHighlight;
                      return (
                        <button key={c.code} type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickCountry(c); }}
                          onMouseEnter={() => setCountryHighlight(i)}
                          className="w-full text-left px-3 py-2 flex items-center justify-between gap-2"
                          style={{ background: active ? "rgba(26,47,138,0.08)" : "transparent" }}>
                          <span className="text-[12px] font-bold" style={{ color: C.navyDark }}>{c.name}</span>
                          <span className="text-[9px] font-mono" style={{ color: `${C.navy}45` }}>{c.code}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="flex items-center justify-between text-sm font-bold mb-2" style={{ color: C.navyDark }}>
                  <span>VAT / Tax ID</span>
                  {selectedCountry && (
                    <span className="text-[10px] font-mono font-medium" style={{ color: `${C.navy}45` }}>
                      {selectedCountry.code} format
                    </span>
                  )}
                </label>
                <input type="text" value={form.vat_id}
                  onChange={(e) => { setForm(f => ({ ...f, vat_id: e.target.value.toUpperCase() })); setVatBlurred(false); }}
                  onBlur={() => setVatBlurred(true)}
                  placeholder={vatPlaceholder}
                  disabled={!selectedCountry}
                  className="admin-input font-mono"
                  style={{
                    borderColor:
                      vatLooksValid === false ? "rgba(232,57,74,0.45)" :
                      vatLooksValid === true  ? "rgba(5,150,105,0.45)" : undefined,
                  }} />
                {vatLooksValid === false && (
                  <p className="text-[10px] text-[#e8394a] font-bold mt-1">
                    Doesn't match {selectedCountry?.name} format
                  </p>
                )}
              </div>
              <div className="relative">
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Street</label>
                <input type="text" value={form.street}
                  onChange={(e) => handleStreetChange(e.target.value)}
                  onFocus={() => { if (addrSuggestions.length > 0) setAddrOpen(true); }}
                  onBlur={() => setTimeout(() => setAddrOpen(false), 150)}
                  onKeyDown={handleStreetKeyDown}
                  placeholder="Start typing…" className="admin-input" autoComplete="off" />
                {addrLoading && (
                  <span className="absolute right-3 top-[34px] inline-block w-3 h-3 rounded-full border-2 border-[#1a2f8a]/20 border-t-[#1a2f8a] animate-spin" />
                )}
                {addrOpen && addrSuggestions.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                    style={{
                      background: "rgba(255,255,255,0.98)",
                      backdropFilter: "blur(20px)",
                      border: "1px solid rgba(26,47,138,0.15)",
                      boxShadow: "0 20px 50px -12px rgba(15,31,92,0.25)",
                    }}>
                    {addrSuggestions.map((f, i) => {
                      const p = f.properties ?? {};
                      const street = [p.name, p.housenumber].filter(Boolean).join(" ");
                      const sub = [p.city ?? p.town ?? p.village, p.postcode, p.country].filter(Boolean).join(", ");
                      const active = i === addrHighlight;
                      return (
                        <button key={`${p.osm_id}-${i}`} type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickAddressSuggestion(f); }}
                          onMouseEnter={() => setAddrHighlight(i)}
                          className="w-full text-left px-3 py-2"
                          style={{ background: active ? "rgba(26,47,138,0.08)" : "transparent" }}>
                          <span className="block text-[12px] font-bold truncate" style={{ color: C.navyDark }}>
                            {street || p.name || "—"}
                          </span>
                          {sub && (
                            <span className="block text-[10px] truncate" style={{ color: `${C.navy}55` }}>{sub}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
                <div>
                  <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Number</label>
                  <input type="text" value={form.street_number}
                    onChange={(e) => setForm(f => ({ ...f, street_number: e.target.value }))}
                    className="admin-input" />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Postal</label>
                  <input type="text" value={form.postal_code}
                    onChange={(e) => setForm(f => ({ ...f, postal_code: e.target.value }))}
                    className="admin-input" />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>City</label>
                  <input type="text" value={form.city}
                    onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                    className="admin-input" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Primary contact</label>
                <input type="text" value={form.full_name}
                  onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Full name" className="admin-input" />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Phone</label>
                <input type="tel" value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+34 600 000 000" className="admin-input" />
              </div>
            </div>
          </div>

          {/* ─── COL 3: Bank & Billing ─────────────────── */}
          <div className="rounded-3xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(255,255,255,0.62)",
              backdropFilter: "blur(28px) saturate(150%)",
              border: "1px solid rgba(255,255,255,0.85)",
              boxShadow: "0 12px 32px -8px rgba(15,31,92,0.3)",
            }}>
            <div className="px-5 py-4 shrink-0 border-b" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: C.red }}>━ Bank & Billing</p>
              <h4 className="text-sm font-black mt-0.5" style={{ color: C.navyDark }}>Payment details</h4>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto admin-scroll px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Account holder</label>
                <input type="text" value={form.bank_holder_name}
                  onChange={(e) => setForm(f => ({ ...f, bank_holder_name: e.target.value }))}
                  placeholder="As shown on bank statement" className="admin-input" />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>IBAN</label>
                <input type="text" value={form.bank_iban}
                  onChange={(e) => handleIbanChange(e.target.value)}
                  placeholder="ES00 0000 0000 0000 0000 0000"
                  className="admin-input font-mono"
                  style={{
                    borderColor: form.bank_iban && !ibanLooksValid ? "rgba(232,57,74,0.45)" :
                                 ibanLooksValid ? "rgba(5,150,105,0.45)" : undefined,
                  }} />
                {form.bank_iban && !ibanLooksValid && (
                  <p className="text-[10px] text-[#e8394a] font-bold mt-1">
                    Doesn't look like a valid IBAN
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: C.navyDark }}>Billing emails</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.billing_emails.map((em, idx) => (
                    <span key={`${em}-${idx}`}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold"
                      style={{ background: "rgba(26,47,138,0.08)", color: C.navyDark }}>
                      {em}
                      <button type="button" onClick={() => removeEmail(idx)}
                        className="hover:text-red-600 transition-colors">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {form.billing_emails.length === 0 && (
                    <span className="text-[10px] font-medium" style={{ color: `${C.navy}45` }}>
                      No emails yet
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input type="email" value={emailDraft}
                    onChange={(e) => { setEmailDraft(e.target.value); setEmailError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
                    placeholder="invoice@company.com"
                    className="admin-input flex-1"
                    style={{ borderColor: emailError ? "rgba(232,57,74,0.45)" : undefined }} />
                  <button type="button" onClick={addEmail}
                    className="px-3 rounded-xl text-[11px] font-black text-white transition-all hover:scale-105"
                    style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                    <Plus size={12} />
                  </button>
                </div>
                {emailError && (
                  <p className="text-[10px] text-[#e8394a] font-bold mt-1">{emailError}</p>
                )}
              </div>
            </div>
          </div>

          {/* ─── COL 4: Users ──────────────────────────── */}
          <div className="rounded-3xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(255,255,255,0.62)",
              backdropFilter: "blur(28px) saturate(150%)",
              border: "1px solid rgba(255,255,255,0.85)",
              boxShadow: "0 12px 32px -8px rgba(15,31,92,0.3)",
            }}>
<div className="px-5 py-4 shrink-0 border-b flex items-center justify-between gap-3" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: C.red }}>━ Users</p>
                <h4 className="text-sm font-black mt-0.5" style={{ color: C.navyDark }}>
                  {selectedUsers.size > 0
                    ? `${selectedUsers.size} of ${companyUsers.length} selected`
                    : `${companyUsers.length} total`}
                </h4>
              </div>
              <button type="button"
                onClick={() => onAddUserForCompany(company)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black text-white transition-all hover:scale-105 shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                  boxShadow: `0 6px 16px -4px ${C.red}70`,
                }}>
                <Plus size={12} />
                Add user
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto admin-scroll px-5 py-4 flex flex-col">
              {companyUsers.length > 0 && (
                <div className="relative mb-3 shrink-0">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: `${C.navy}40` }} />
                  <input type="text" value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by email or username…"
                    className="w-full pl-8 pr-3 py-2 text-xs font-medium rounded-xl outline-none"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: C.navyDark }} />
                </div>
              )}

              {filteredUsers.length > 0 && (
                <div className="flex items-center justify-between gap-2 mb-3 px-2 py-1.5 rounded-xl shrink-0 transition-all"
                  style={{
                    background: selectedUsers.size > 0 ? "rgba(232,57,74,0.08)" : "transparent",
                    border: selectedUsers.size > 0 ? "1px solid rgba(232,57,74,0.2)" : "1px solid transparent",
                  }}>
                  <button type="button" onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                    style={{ color: `${C.navy}70` }}>
                    {selectedUsers.size === filteredUsers.length && filteredUsers.length > 0
                      ? <CheckSquare size={13} style={{ color: C.red }} />
                      : <Square size={13} />}
                    {selectedUsers.size === filteredUsers.length && filteredUsers.length > 0 ? "Clear" : "Select all"}
                  </button>
                  {selectedUsers.size > 0 && (
                    <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black text-white transition-all hover:scale-105 disabled:opacity-50"
                      style={{
                        background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                        boxShadow: `0 4px 12px -2px ${C.red}80`,
                      }}>
                      {bulkDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Delete {selectedUsers.size}
                    </button>
                  )}
                </div>
              )}

              {loadingUsers ? (
                <div className="flex items-center justify-center py-6 gap-2" style={{ color: `${C.navy}50` }}>
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-xs">Loading…</span>
                </div>
              ) : companyUsers.length === 0 ? (
                <div className="text-center py-10 rounded-2xl" style={{ background: "rgba(26,47,138,0.04)", border: "2px dashed rgba(26,47,138,0.12)" }}>
                  <Users size={20} className="mx-auto mb-1.5" style={{ color: `${C.navy}30` }} />
                  <p className="text-xs font-bold" style={{ color: `${C.navy}55` }}>No users yet</p>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-8 rounded-2xl" style={{ background: "rgba(26,47,138,0.04)", border: "1px dashed rgba(26,47,138,0.12)" }}>
                  <p className="text-[11px] font-bold" style={{ color: `${C.navy}55` }}>No match for "{userSearch}"</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map(u => {
                    const active = u.is_active && u.uc_is_active;
                    const isSelected = selectedUsers.has(u.id);
                    return (
                      <div key={u.id}
                        className="group/urow flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                        style={{
                          background: isSelected ? "rgba(232,57,74,0.08)" : "rgba(255,255,255,0.7)",
                          border: `1px solid ${isSelected ? "rgba(232,57,74,0.3)" : "rgba(26,47,138,0.08)"}`,
                        }}>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); toggleSelectedUser(u.id); }}
                          className="shrink-0 transition-transform hover:scale-110"
                          style={{ color: isSelected ? C.red : `${C.navy}40` }}>
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 cursor-pointer"
                          style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}
                          onClick={() => onEditUser(u)}>
                          {initials(u.username || u.email)}
                        </div>
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEditUser(u)}>
                          <p className="text-xs font-black truncate" style={{ color: C.navyDark }}>{u.username ?? "—"}</p>
                          <p className="text-[10px] truncate" style={{ color: `${C.navy}60` }}>{u.email}</p>
                        </div>
                        <div className="flex-shrink-0 relative" style={{ minWidth: 70, height: 28 }}>
                          <span className="absolute inset-0 flex items-center justify-end px-2 rounded-md text-[9px] font-black uppercase tracking-wider transition-opacity group-hover/urow:opacity-0 group-hover/urow:pointer-events-none pointer-events-none"
                            style={{
                              background: active ? "#d1fae5" : "rgba(26,47,138,0.08)",
                              color: active ? "#047857" : `${C.navy}60`,
                            }}>
                            <span className="pointer-events-none">{active ? "Active" : "Inactive"}</span>
                          </span>
                          <div className="absolute inset-0 flex items-center justify-end gap-1 opacity-0 group-hover/urow:opacity-100 transition-opacity pointer-events-none group-hover/urow:pointer-events-auto">
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); onEditUser(u); }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 transition-all"
                              style={{ color: `${C.navy}60`, background: "rgba(255,255,255,0.95)" }}>
                              <Edit2 size={11} />
                            </button>
                            <button type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedUsers(new Set([u.id]));
                                handleBulkDelete();
                              }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-all"
                              style={{ color: `${C.navy}60`, background: "rgba(255,255,255,0.95)" }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="relative px-8 py-4 flex items-center justify-end gap-3 shrink-0 border-t" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <button onClick={onClose} disabled={saving}
            className="px-5 py-2.5 text-xs font-black rounded-xl transition-colors text-white/70 hover:text-white hover:bg-white/10">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-7 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02]"
            style={{
              background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
              boxShadow: `0 8px 24px -4px ${C.red}80`,
            }}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// USER MODAL
// ════════════════════════════════════════════════════════════════
function UserModal({ user, companies, allUsers = [], allLinks = [], onClose, onSaved, showToast, locale }) {
  const isEdit = !!user?.id;
  const [form, setForm] = useState({
    email:    user?.email    ?? "",
    username: user?.username ?? "",
    password: "",
    is_super_admin: user?.is_super_admin ?? false,
    is_active:      user?.is_active      ?? true,
  });
  const [companyLinks, setCompanyLinks] = useState(user?._company_links ?? []);
  const [saving, setSaving] = useState(false);
  const [openLinkDropdown, setOpenLinkDropdown] = useState(null);
  const [dropdownPos, setDropdownPos] = useState(null);

  // Create-mode tab: new user vs existing user
  const [createMode, setCreateMode]               = useState("new"); // "new" | "existing"
  const [existingUserId, setExistingUserId]       = useState(null);
  const [existingSearch, setExistingSearch]       = useState("");
  const [existingDropdownOpen, setExistingDropdownOpen] = useState(false);

  // Users available to link: those without ANY company link.
  // Exclude super-admins (they don't need company access) and the current user.
  const availableUsers = (allUsers ?? []).filter(u => {
    if (u.is_super_admin) return false;
    const hasAnyLink = (allLinks ?? []).some(l => l.user_id === u.id);
    return !hasAnyLink;
  });

  const filteredAvailable = availableUsers.filter(u => {
    if (!existingSearch.trim()) return true;
    const q = existingSearch.trim().toLowerCase();
    return (u.username ?? "").toLowerCase().includes(q) ||
           (u.email ?? "").toLowerCase().includes(q);
  });

  const pickedExistingUser = availableUsers.find(u => u.id === existingUserId);

  useEffect(() => {
    if (openLinkDropdown === null) return;
    const handler = () => setOpenLinkDropdown(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openLinkDropdown]);

  const addLink = () => {
    if (companyLinks.length >= 1) return;
    const remaining = companies.filter(c => !companyLinks.find(l => l.company_id === c.id));
    if (remaining.length === 0) return;
    setCompanyLinks([...companyLinks, {
      company_id: remaining[0].id,
      is_default: true,
      is_active: true,
    }]);
  };

  const updateLink = (idx, patch) => {
    const next = [...companyLinks];
    next[idx] = { ...next[idx], ...patch };
    if (patch.is_default === true) next.forEach((l, i) => { if (i !== idx) l.is_default = false; });
    setCompanyLinks(next);
  };

  const removeLink = (idx) => {
    const next = companyLinks.filter((_, i) => i !== idx);
    if (next.length > 0 && !next.some(l => l.is_default)) next[0].is_default = true;
    setCompanyLinks(next);
  };

const handleSave = async () => {
    // ─── EXISTING USER FLOW (create-mode only) ─────────────────
    if (!isEdit && createMode === "existing") {
      if (!existingUserId) {
        showToast("error", "Pick a user to assign");
        return;
      }
      if (companyLinks.length === 0) {
        showToast("error", "Assign at least one company");
        return;
      }
      setSaving(true);

      const linksPayload = companyLinks.map(l => ({
        user_id:    existingUserId,
        company_id: l.company_id,
        role:       "admin",
        is_default: l.is_default,
        is_active:  l.is_active,
      }));
      const { error: linksErr } = await sbAccounts.from("user_companies").insert(linksPayload);
      setSaving(false);
      if (linksErr) { showToast("error", linksErr.message); return; }

      showToast("success", "User assigned");
      onSaved();
      onClose();
      return;
    }

    // ─── NEW USER FLOW (original) ─────────────────────────────
    if (!form.email.trim() || !form.username.trim()) {
      showToast("error", "Email y username son obligatorios");
      return;
    }

    setSaving(true);
    let userId = user?.id;

    if (!isEdit) {
      const { data: { session: adminSession } } = await supabase.auth.getSession();
      if (!adminSession) {
        setSaving(false);
        showToast("error", "Sesión perdida, vuelve a entrar");
        return;
      }

      const tempPassword = form.password || `Tmp_${Math.random().toString(36).slice(2, 10)}!Kx9`;
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: tempPassword,
        options: { data: { username: form.username.trim() } },
      });

      if (signUpErr || !signUpData?.user) {
        await supabase.auth.setSession({
          access_token:  adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
        setSaving(false);
        const msg = signUpErr?.message ?? signUpErr?.status ?? JSON.stringify(signUpErr) ?? "No se pudo crear el usuario";
        showToast("error", msg);
        return;
      }
      userId = signUpData.user.id;

      const { error: restoreErr } = await supabase.auth.setSession({
        access_token:  adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
      if (restoreErr) {
        setSaving(false);
        showToast("error", "Sesión rota tras crear usuario, recarga la página");
        return;
      }

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
      const { error } = await sbAccounts.from("users")
        .upsert(userPayload, { onConflict: "id" });
      userErr = error;
      if (!error) break;
    }

    if (userErr) {
      setSaving(false);
      showToast("error", userErr.message);
      return;
    }

    if (isEdit) await sbAccounts.from("user_companies").delete().eq("user_id", userId);
    if (companyLinks.length > 0) {
      const linksPayload = companyLinks.map(l => ({
        user_id:    userId,
        company_id: l.company_id,
        role:       "admin",
        is_default: l.is_default,
        is_active:  l.is_active,
      }));
      const { error: linksErr } = await sbAccounts.from("user_companies").insert(linksPayload);
      if (linksErr) {
        setSaving(false);
        showToast("error", linksErr.message);
        return;
      }
    }

    setSaving(false);
    showToast("success", isEdit ? t(locale, "adm_save") : t(locale, "adm_new_user"));
    onSaved();
    onClose();
  };

return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(9,21,72,0.6)", backdropFilter: "blur(16px)", animation: "adminFadeIn 0.25s ease-out both" }}
      onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]"
        style={{
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(28px) saturate(150%)",
          border: "1px solid rgba(255,255,255,0.6)",
          borderRadius: 28,
          boxShadow: "0 48px 100px -20px rgba(15,31,92,0.5)",
          animation: "adminModalEntry 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="relative overflow-hidden px-7 py-5 flex items-center justify-between flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 50%, #8b1a28 100%)` }}>
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full" style={{ background: "rgba(255,255,255,0.07)" }} />
          <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)" }} />

          <div className="relative flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-black text-white flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.25)", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
              {form.username ? initials(form.username) : <Users size={18} />}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-200">{isEdit ? `${t(locale, "adm_save")} · ${t(locale, "adm_users")}` : `${t(locale, "adm_create")} · ${t(locale, "adm_users")}`}</p>
              <h3 className="text-white font-black text-xl leading-tight mt-0.5">{isEdit ? form.username || t(locale, "adm_users") : t(locale, "adm_new_user")}</h3>
            </div>
          </div>
          <button onClick={onClose} className="relative w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:bg-white/15" style={{ color: "rgba(255,255,255,0.7)" }}><X size={16} /></button>
        </div>

{/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4" style={{ overflowX: "visible" }}>

          {/* Mode toggle — only in create mode */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl"
              style={{ background: "rgba(26,47,138,0.06)", border: "1px solid rgba(26,47,138,0.08)" }}>
              <button type="button"
                onClick={() => setCreateMode("new")}
                className="py-2 rounded-xl text-xs font-black transition-all"
                style={{
                  background: createMode === "new" ? `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)` : "transparent",
                  color: createMode === "new" ? "#fff" : `${C.navy}70`,
                  boxShadow: createMode === "new" ? `0 4px 12px -2px ${C.red}60` : "none",
                }}>
                ✨ New user
              </button>
              <button type="button"
                onClick={() => setCreateMode("existing")}
                disabled={availableUsers.length === 0}
                className="py-2 rounded-xl text-xs font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: createMode === "existing" ? `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` : "transparent",
                  color: createMode === "existing" ? "#fff" : `${C.navy}70`,
                  boxShadow: createMode === "existing" ? `0 4px 12px -2px ${C.navy}60` : "none",
                }}>
                ↪ Existing user {availableUsers.length > 0 && `(${availableUsers.length})`}
              </button>
            </div>
          )}

          {/* ─── EXISTING USER PICKER ─────────────────────── */}
          {!isEdit && createMode === "existing" && (
            <div className="relative">
              <label className="block text-[10px] font-black uppercase tracking-[0.18em] mb-1.5" style={{ color: `${C.navy}80` }}>
                Pick a user without company
              </label>

              {pickedExistingUser ? (
                <div className="flex items-center gap-3 p-3 rounded-2xl"
                  style={{ background: "linear-gradient(135deg, rgba(26,47,138,0.06), rgba(26,47,138,0.02))", border: "1.5px solid rgba(26,47,138,0.2)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                    {initials(pickedExistingUser.username || pickedExistingUser.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: C.navyDark }}>{pickedExistingUser.username ?? "—"}</p>
                    <p className="text-[11px] truncate" style={{ color: `${C.navy}60` }}>{pickedExistingUser.email}</p>
                  </div>
                  <button type="button" onClick={() => { setExistingUserId(null); setExistingSearch(""); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all flex-shrink-0"
                    style={{ color: `${C.navy}50` }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: `${C.navy}40` }} />
                    <input type="text" value={existingSearch}
                      onChange={(e) => { setExistingSearch(e.target.value); setExistingDropdownOpen(true); }}
                      onFocus={() => setExistingDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setExistingDropdownOpen(false), 150)}
                      placeholder={availableUsers.length === 0 ? "No users available" : "Search by username or email…"}
                      disabled={availableUsers.length === 0}
                      className="w-full pl-9 pr-3 py-2.5 text-sm font-medium rounded-xl outline-none transition-colors"
                      style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.12)", color: C.navyDark }} />
                  </div>
                  {existingDropdownOpen && filteredAvailable.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 rounded-2xl overflow-hidden"
                      style={{
                        background: "rgba(255,255,255,0.98)",
                        backdropFilter: "blur(20px)",
                        border: "1px solid rgba(26,47,138,0.15)",
                        boxShadow: "0 20px 50px -12px rgba(15,31,92,0.25)",
                        maxHeight: 280, overflowY: "auto",
                      }}>
                      {filteredAvailable.map(u => (
                        <button key={u.id} type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setExistingUserId(u.id);
                            setExistingSearch("");
                            setExistingDropdownOpen(false);
                          }}
                          className="w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors"
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(26,47,138,0.06)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                            style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                            {initials(u.username || u.email)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black truncate" style={{ color: C.navyDark }}>{u.username ?? "—"}</p>
                            <p className="text-[10px] truncate" style={{ color: `${C.navy}60` }}>{u.email}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {existingDropdownOpen && existingSearch.trim() && filteredAvailable.length === 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl px-3 py-3"
                      style={{ background: "rgba(255,255,255,0.98)", border: "1px solid rgba(26,47,138,0.15)" }}>
                      <p className="text-[11px] font-bold" style={{ color: `${C.navy}55` }}>No match for "{existingSearch}"</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── NEW USER FORM (only in new mode or edit) ─────── */}
          {(isEdit || createMode === "new") && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "email",    label: "Email",    type: "email",    placeholder: "user@empresa.com", disabled: isEdit },
              { key: "username", label: "Username", type: "text",     placeholder: "Juan Vidal",       disabled: false  },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10px] font-black uppercase tracking-[0.18em] mb-1.5" style={{ color: `${C.navy}80` }}>{f.label}</label>
                <input type={f.type} value={form[f.key]} disabled={f.disabled}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="admin-input disabled:opacity-50" />
              </div>
            ))}
          </div>
          )}

{/* Password — only for new users */}
          {!isEdit && createMode === "new" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-[0.18em] mb-1.5" style={{ color: `${C.navy}80` }}>
                {t(locale, "login_password")} <span className="normal-case font-medium" style={{ color: `${C.navy}50` }}>(opcional)</span>
              </label>
              <input type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                className="admin-input font-mono" />
            </div>
          )}

          {/* Toggles — hide in existing-user mode (those settings already exist on the user) */}
          {(isEdit || createMode === "new") && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "is_super_admin", label: "Super-Admin",                  sub: t(locale, "adm_settings_sub"), icon: Crown,       activeColor: C.amber,   activeBg: "linear-gradient(135deg,#fef3c7,#fde68a)", activeBorder: "#fcd34d" },
              { key: "is_active",      label: t(locale, "adm_active"),        sub: t(locale, "login_subtitle"),   icon: ShieldCheck,  activeColor: "#10b981",  activeBg: "linear-gradient(135deg,#d1fae5,#a7f3d0)", activeBorder: "#6ee7b7" },
            ].map(item => {
              const on = form[item.key];
              return (
                <div key={item.key} className="flex items-center justify-between p-3.5 rounded-2xl transition-all cursor-pointer"
                  style={{
                    background: on ? item.activeBg : "rgba(255,255,255,0.7)",
                    border: `1.5px solid ${on ? item.activeBorder : "rgba(26,47,138,0.1)"}`,
                    boxShadow: on ? `0 4px 16px -4px ${item.activeColor}40` : "none",
                  }}
                  onClick={() => setForm(p => ({ ...p, [item.key]: !p[item.key] }))}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                      style={{ background: on ? item.activeColor : "rgba(26,47,138,0.08)", color: on ? "#fff" : `${C.navy}60`, boxShadow: on ? `0 4px 10px -2px ${item.activeColor}60` : "none" }}>
                      <item.icon size={14} />
                    </div>
                    <div>
                      <p className="text-xs font-black" style={{ color: C.navyDark }}>{item.label}</p>
                      <p className="text-[10px]" style={{ color: `${C.navy}60` }}>{item.sub}</p>
                    </div>
                  </div>
<Toggle checked={on} onChange={v => setForm(p => ({ ...p, [item.key]: v }))} accent={item.activeColor} />
                </div>
              );
            })}
          </div>
          )}

          {/* Companies */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: `${C.navy}80` }}>{t(locale, "adm_companies")}</p>
                <p className="text-[10px] mt-0.5" style={{ color: `${C.navy}55` }}>★ {t(locale, "adm_settings_sub")}</p>
              </div>
            </div>
            {companyLinks.length === 0 ? (
              <div className="text-center py-8 rounded-2xl cursor-pointer transition-all hover:border-red-300 hover:bg-red-50/50"
                style={{ background: "rgba(26,47,138,0.04)", border: "2px dashed rgba(26,47,138,0.15)" }}
                onClick={addLink}>
                <Building2 size={22} className="mx-auto mb-1.5" style={{ color: `${C.navy}40` }} />
                <p className="text-xs font-bold" style={{ color: `${C.navy}60` }}>Sin empresas asignadas</p>
                <p className="text-[10px] mt-0.5" style={{ color: `${C.navy}40` }}>Click para añadir</p>
              </div>
            ) : (
              <div className="space-y-2">
                {companyLinks.map((l, idx) => {
                  const co = companies.find(c => c.id === l.company_id);
                  return (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl transition-all"
                      style={{ background: l.is_default ? "linear-gradient(135deg,#fffbeb,#fef9ee)" : "rgba(255,255,255,0.7)", border: `1.5px solid ${l.is_default ? "#fcd34d" : "rgba(26,47,138,0.1)"}`, boxShadow: l.is_default ? "0 4px 12px -4px rgba(251,191,36,0.3)" : "none" }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                        style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                        {initials(co?.name)}
                      </div>
                      <div className="flex-1 relative min-w-0">
<button type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            const maxH = 320;
                            const margin = 16;
                            const spaceBelow = window.innerHeight - r.bottom - margin;
                            const spaceAbove = r.top - margin;
                            // Prefer the side with more room; open up if it gives noticeably more
                            const openUp = spaceAbove > spaceBelow + 40;
                            const height = Math.min(maxH, Math.max(120, openUp ? spaceAbove : spaceBelow));
                            setDropdownPos({
                              top:  openUp ? r.top - height - 6 : r.bottom + 6,
                              left: r.left,
                              width: r.width,
                              height,
                            });
                            setOpenLinkDropdown(openLinkDropdown === idx ? null : idx);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all text-left"
                          style={{ background: l.is_default ? "rgba(251,191,36,0.08)" : "rgba(26,47,138,0.06)", color: C.navyDark }}>
                          <span className="truncate">{companies.find(c => c.id === l.company_id)?.name ?? "Seleccionar…"}</span>
                          <ChevronRight size={12} className="flex-shrink-0 transition-transform" style={{ color: `${C.navy}50`, transform: openLinkDropdown === idx ? "rotate(90deg)" : "rotate(0deg)" }} />
                        </button>
{openLinkDropdown === idx && dropdownPos && createPortal(
                          <div className="fixed z-[9999] rounded-2xl no-scrollbar"
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width,
                            maxHeight: dropdownPos.height, overflowY: "auto",
                            background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.15)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.25)", animation: "adminSlideDown 0.2s cubic-bezier(0.34,1.56,0.64,1) both" }}>
                            <div className="p-1.5">
                              {companies.map((c, ci) => {
                                const active = c.id === l.company_id;
                                return (
                                  <button key={c.id} type="button"
                                    onClick={() => { updateLink(idx, { company_id: c.id }); setOpenLinkDropdown(null); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                                    style={{ background: active ? `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` : "transparent", animation: `adminSlideDown 0.15s ease-out ${ci * 0.03}s both` }}
                                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0"
                                      style={{ background: active ? "rgba(255,255,255,0.2)" : `${C.navy}15`, color: active ? "#fff" : C.navy }}>
                                      {initials(c.name)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-black truncate" style={{ color: active ? "#fff" : C.navyDark }}>{c.name}</p>
                                      <p className="text-[9px] font-mono truncate" style={{ color: active ? "rgba(255,255,255,0.6)" : `${C.navy}55` }}>{c.slug}</p>
                                    </div>
                                    {active && <Check size={12} className="flex-shrink-0 text-white" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                      <button type="button" onClick={() => removeLink(idx)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all flex-shrink-0"
                        style={{ color: `${C.navy}40` }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-2 flex-shrink-0 border-t" style={{ background: "rgba(26,47,138,0.03)", borderColor: "rgba(26,47,138,0.08)" }}>
          <button onClick={onClose} disabled={saving} className="px-5 py-2.5 text-xs font-black rounded-xl hover:bg-white/60 transition-colors" style={{ color: `${C.navy}70` }}>
            {t(locale, "adm_cancel")}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02]"
            style={{ background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`, boxShadow: `0 8px 20px -4px ${C.red}70` }}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? t(locale, "adm_save") : t(locale, "adm_new_user")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN PORTAL
// ════════════════════════════════════════════════════════════════
export default function AdminPortal() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("companies");
  const [me, setMe] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [allLinks, setAllLinks] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchCo, setSearchCo] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterTrial, setFilterTrial] = useState("all");

  const [searchUser, setSearchUser] = useState("");
  const [filterActive, setFilterActive] = useState("all");

  const [editingCompany, setEditingCompany] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);

  const [toast, setToast] = useState(null);
  const showToast = (type, message) => setToast({ type, message });
  const [adminLocale, setAdminLocale] = useState(() => localStorage.getItem("admin_locale") ?? "en");

  useEffect(() => {
    localStorage.setItem("admin_locale", adminLocale);
  }, [adminLocale]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/"); return; }
      const { data: userRow } = await sbAccounts.from("users").select("*").eq("id", session.user.id).single();
      if (!userRow?.is_super_admin) { navigate("/"); return; }
      setMe(userRow);
    })();
  }, [navigate]);

  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: cos }, { data: us }, { data: links }] = await Promise.all([
      sbAccounts.from("companies_with_user_count").select("*").order("created_at", { ascending: false }),
      sbAccounts.from("users").select("*").order("created_at", { ascending: false }),
      sbAccounts.from("user_companies").select("*"),
    ]);
    setCompanies(cos ?? []);
    setUsers(us ?? []);
    setAllLinks(links ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      const [{ data: cos }, { data: us }, { data: links }] = await Promise.all([
        sbAccounts.from("companies_with_user_count").select("*").order("created_at", { ascending: false }),
        sbAccounts.from("users").select("*").order("created_at", { ascending: false }),
        sbAccounts.from("user_companies").select("*"),
      ]);
      if (cancelled) return;
      setCompanies(cos ?? []);
      setUsers(us ?? []);
      setAllLinks(links ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [me]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

const handleDeleteCompany = async (id) => {
    if (!window.confirm(t(adminLocale, "adm_delete_company_confirm"))) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast("error", t(adminLocale, "adm_session_expired"));
      return;
    }

    try {
      const res = await fetch(
        "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/delete-company",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ company_id: id }),
        }
      );
      const result = await res.json();
      if (!res.ok) {
        showToast("error", result.error ?? `Error ${res.status}`);
        return;
      }
      const msg = `${t(adminLocale, "adm_company_deleted")} · ${result.users_deleted} users removed · ${result.users_unlinked} unlinked`;
      showToast("success", msg);
      reload();
    } catch (e) {
      showToast("error", `${t(adminLocale, "adm_network_error")}: ${e.message}`);
    }
  };

  const handleDeleteUser = async (id) => {
    const confirmed = window.confirm(t(adminLocale, "adm_delete_user_confirm"));
    if (!confirmed) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast("error", t(adminLocale, "adm_session_expired"));
      return;
    }

    try {
      const res = await fetch(
        "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/delete-user",
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            apikey:          "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
            Authorization:   `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_id: id }),
        }
      );
      const result = await res.json();

      if (!res.ok) {
        showToast("error", result.error ?? `Error ${res.status}`);
        return;
      }

      showToast("success", t(adminLocale, "adm_user_deleted"));
      reload();
    } catch (e) {
      showToast("error", `${t(adminLocale, "adm_network_error")}: ${e.message}`);
    }
  };

  const usersEnriched = useMemo(() => {
    const coById = new Map(companies.map(c => [c.id, c]));
    return users.map(u => ({
      ...u,
      _company_links: allLinks.filter(l => l.user_id === u.id),
      _company_names: allLinks.filter(l => l.user_id === u.id)
        .map(l => coById.get(l.company_id)?.name).filter(Boolean),
    }));
  }, [users, companies, allLinks]);

  const companiesFiltered = useMemo(() => companies.filter(c => {
    if (searchCo && !c.name.toLowerCase().includes(searchCo.toLowerCase())
                 && !c.slug.toLowerCase().includes(searchCo.toLowerCase())) return false;
    if (filterTier !== "all" && c.tier !== filterTier) return false;
    if (filterTrial !== "all") {
      if (filterTrial === "trial" && !c.is_trial) return false;
      if (filterTrial === "paid" && c.is_trial) return false;
    }
    return true;
  }), [companies, searchCo, filterTier, filterTrial]);

  const usersFiltered = useMemo(() => usersEnriched.filter(u => {
    if (searchUser) {
      const s = searchUser.toLowerCase();
      if (!u.email.toLowerCase().includes(s) && !u.username.toLowerCase().includes(s)) return false;
    }
    if (filterActive === "active"   && !u.is_active)      return false;
    if (filterActive === "inactive" &&  u.is_active)       return false;
    if (filterActive === "super"    && !u.is_super_admin)  return false;
    return true;
  }), [usersEnriched, searchUser, filterActive]);

  const stats = useMemo(() => ({
    totalCompanies: companies.length,
    totalUsers: users.length,
    superAdmins: users.filter(u => u.is_super_admin).length,
    activeTrials: companies.filter(c => c.is_trial).length,
  }), [companies, users]);

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(180deg, #0a1647 0%, #1a2f8a 40%, #2a47b0 75%, #4a6fde 100%)" }}>
        <Loader2 size={28} className="animate-spin text-white" />
      </div>
    );
  }

  const tabConfig = tab === "companies"
    ? { title: t(adminLocale, "adm_companies"), subtitle: t(adminLocale, "adm_companies_sub"), color: C.navy,    accent: "#2d4ab8",  showKpis: true  }
    : tab === "users"
    ? { title: t(adminLocale, "adm_users"),     subtitle: t(adminLocale, "adm_users_sub"),     color: C.red,     accent: C.redDark,  showKpis: true  }
    : { title: t(adminLocale, "adm_settings"),  subtitle: t(adminLocale, "adm_settings_sub"),  color: "#7c3aed", accent: "#6d28d9",  showKpis: false };

  return (
    <div className="fixed inset-0 overflow-hidden"
      style={{ background: "linear-gradient(180deg, #0a1647 0%, #1a2f8a 40%, #2a47b0 75%, #4a6fde 100%)" }}>
      <style>{`
        @keyframes adminFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes adminSlideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes adminSlideInLeft {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes adminSlideInRight {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes adminCardEntry {
          from { opacity: 0; transform: translateY(15px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes adminModalEntry {
          from { opacity: 0; transform: translateY(30px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes adminShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes adminFloat {
          0%, 100% { transform: translate(0, 0); }
          50%      { transform: translate(30px, -40px); }
        }
        @keyframes adminDrift {
          0%   { transform: translateY(0)    rotate(0deg);   opacity: 0; }
          10%  {                              opacity: 0.55; }
          90%  {                              opacity: 0.55; }
          100% { transform: translateY(-80vh) rotate(8deg);  opacity: 0; }
        }
        @keyframes adminDriftSlow {
          0%   { transform: translateY(0)     rotate(0deg);    opacity: 0; }
          10%  {                              opacity: 0.45; }
          90%  {                              opacity: 0.45; }
          100% { transform: translateY(-90vh) rotate(-6deg);   opacity: 0; }
        }
        @keyframes adminBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        .admin-ticker {
          font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace;
          font-weight: 800;
          font-size: 10px;
          letter-spacing: 0.1em;
          padding: 4px 8px;
          border-radius: 6px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.85);
          backdrop-filter: blur(6px);
          white-space: nowrap;
        }
        .admin-input {
          width: 100%;
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(26,47,138,0.12);
          border-radius: 14px;
          padding: 12px 14px;
          font-size: 14px;
          color: #0a1647;
          outline: none;
          transition: all 0.2s ease;
        }
        .admin-input::placeholder { color: rgba(26,47,138,0.3); }
        .admin-input:focus {
          border-color: #1a2f8a;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(26,47,138,0.12);
        }
        .admin-card {
          background: rgba(255,255,255,0.62);
          border: 1px solid rgba(255,255,255,0.85);
          backdrop-filter: blur(28px) saturate(150%);
          -webkit-backdrop-filter: blur(28px) saturate(150%);
        }
.admin-scroll::-webkit-scrollbar { width: 6px; }
        .admin-scroll::-webkit-scrollbar-track { background: transparent; }
        .admin-scroll::-webkit-scrollbar-thumb { background: rgba(26,47,138,0.2); border-radius: 6px; }
        .admin-scroll::-webkit-scrollbar-thumb:hover { background: rgba(26,47,138,0.35); }

        /* Hidden scrollbar but still scrollable */
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <LiveBackground />

<div className="relative z-10 h-full flex p-4 gap-0">

        {/* OUTER FROSTED CARD — wraps both sidebar and main */}
        <div className="flex flex-1 admin-card overflow-hidden"
          style={{
            borderRadius: 36,
            boxShadow: "0 40px 100px -20px rgba(15,31,92,0.4), 0 12px 32px -10px rgba(15,31,92,0.2)",
          }}>

        {/* SIDEBAR — inside the frosted card */}
        <aside className="w-[260px] shrink-0 flex flex-col p-6 relative overflow-hidden border-r"
          style={{ animation: "adminSlideInLeft 0.7s ease-out both", borderColor: "rgba(26,47,138,0.1)" }}>

{/* New CTA — top of sidebar */}
          {tab !== "settings" && (
            <button
              onClick={() => {
                if (tab === "companies") { setEditingCompany(null); setShowCompanyModal(true); }
                else { setEditingUser(null); setShowUserModal(true); }
              }}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[12px] font-black text-white transition-all hover:scale-[1.02] shadow-xl mb-6"
              style={{
                background: `linear-gradient(135deg, ${tabConfig.color} 0%, ${tabConfig.accent} 100%)`,
                boxShadow: `0 10px 24px -6px ${tabConfig.color}80`,
              }}>
              <Plus size={14} />
              {tab === "companies" ? t(adminLocale, "adm_new_company") : t(adminLocale, "adm_new_user")}
            </button>
          )}

          {/* Nav — centered vertically */}
          <nav className="space-y-1.5 my-auto">
            {[
              { id: "companies", label: t(adminLocale, "adm_companies"), icon: Building2 },
              { id: "users",     label: t(adminLocale, "adm_users"),     icon: Users },
              { id: "activity",  label: t(adminLocale, "adm_activity"),  icon: Activity, disabled: true },
              { id: "settings",  label: t(adminLocale, "adm_settings"),  icon: Database },
            ].map((navItem, i) => {
              const active = tab === navItem.id;
              return (
                <button key={navItem.id}
                  onClick={() => !navItem.disabled && setTab(navItem.id)}
                  disabled={navItem.disabled}
className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-[13px] font-black transition-all duration-300"
                  style={{
                    background: active
                      ? `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)`
                      : "rgba(26,47,138,0.05)",
                    color: active ? "#fff" : C.navyDark,
                    boxShadow: active
                      ? `0 8px 24px -4px ${C.navy}50, inset 0 1px 0 rgba(255,255,255,0.15)`
                      : "none",
                    border: active ? "none" : "1px solid rgba(26,47,138,0.08)",
                    cursor: navItem.disabled ? "not-allowed" : "pointer",
                    opacity: navItem.disabled ? 0.4 : 1,
                    animation: `adminSlideInLeft 0.5s ease-out ${0.2 + i * 0.08}s both`,
                  }}
                  onMouseEnter={(e) => {
                    if (!active && !navItem.disabled) {
                      e.currentTarget.style.background = "rgba(26,47,138,0.12)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active && !navItem.disabled) {
                      e.currentTarget.style.background = "rgba(26,47,138,0.05)";
                    }
                  }}>
                  <navItem.icon size={15} />
                  {navItem.label}
                  {active && <ChevronRight size={14} className="ml-auto" />}
                  {navItem.disabled && <span className="ml-auto text-[8px] opacity-60 font-bold">{t(adminLocale, "adm_soon")}</span>}
                </button>
              );
            })}
          </nav>

{/* Logout */}
          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-[11px] font-black transition-all"
            style={{ color: `${C.navy}70` }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(26,47,138,0.08)"; e.currentTarget.style.color = C.navy; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = `${C.navy}70`; }}>
            <LogOut size={12} />
            {t(adminLocale, "adm_logout")}
          </button>
        </aside>

{/* MAIN PANEL — inside the frosted card */}
        <main className="flex-1 overflow-hidden flex flex-col"
          style={{
            animation: "adminSlideInRight 0.7s ease-out both",
          }}>

{/* Content — header removed, KPIs at top */}
          <div className="flex-1 min-h-0 flex flex-col px-10 py-7 gap-6 overflow-hidden">
            {/* Hero stats */}
            {tabConfig.showKpis && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
                <HeroStat label={t(adminLocale, "adm_stat_companies")}  value={stats.totalCompanies} icon={Building2} color={C.navy}   accent="#2d4ab8" delay={0} />
                <HeroStat label={t(adminLocale, "adm_stat_users")}      value={stats.totalUsers}     icon={Users}     color={C.red}    accent={C.redDark} delay={0.08} />
                <HeroStat label={t(adminLocale, "adm_stat_superadmins")}value={stats.superAdmins}    icon={Crown}     color="#d97706"  accent={C.amber} delay={0.16} />
                <HeroStat label={t(adminLocale, "adm_stat_trials")}     value={stats.activeTrials}   icon={Zap}       color="#10b981"  accent={C.green} delay={0.24} />
              </div>
            )}

            {/* COMPANIES */}
            {tab === "companies" && (
              <div style={{ animation: "adminCardEntry 0.5s ease-out 0.3s both" }} className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl flex-shrink-0"
                  style={{ background: "rgba(26,47,138,0.06)", border: "1px solid rgba(26,47,138,0.1)" }}>
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: `${C.navy}40` }} />
                    <input type="text" placeholder={t(adminLocale, "adm_search_company")}
                      value={searchCo} onChange={(e) => setSearchCo(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-xs font-medium rounded-xl outline-none transition-colors"
                      style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: C.navyDark }} />
                  </div>
                  <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
                    className="px-3 py-2.5 text-xs font-black rounded-xl outline-none cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: C.navyDark }}>
                    <option value="all">{t(adminLocale, "adm_all_tiers")}</option>
                    {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <select value={filterTrial} onChange={(e) => setFilterTrial(e.target.value)}
                    className="px-3 py-2.5 text-xs font-black rounded-xl outline-none cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: C.navyDark }}>
                    <option value="all">{t(adminLocale, "adm_all")}</option>
                    <option value="trial">{t(adminLocale, "adm_trial_only")}</option>
                    <option value="paid">{t(adminLocale, "adm_paid_only")}</option>
                  </select>
                  <div className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: `${C.navy}70` }}>
                    <Filter size={10} />
                    {companiesFiltered.length} {t(adminLocale, "adm_of")} {companies.length}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto admin-scroll">
                  {loading ? (
                    <div className="text-center py-20">
                      <Loader2 size={24} className="animate-spin mx-auto" style={{ color: `${C.navy}40` }} />
                    </div>
                  ) : companiesFiltered.length === 0 ? (
                    <div className="text-center py-20 rounded-3xl"
                      style={{ background: "rgba(26,47,138,0.04)", border: "2px dashed rgba(26,47,138,0.12)" }}>
                      <Building2 size={32} className="mx-auto mb-3" style={{ color: `${C.navy}30` }} />
                      <p className="text-sm font-black" style={{ color: `${C.navy}60` }}>{t(adminLocale, "adm_no_companies")}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: `${C.navy}45` }}>{t(adminLocale, "adm_no_companies_hint")}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {companiesFiltered.map((c, i) => {
                        const tc = tierConfig(c.tier);
                        return (
                          <div key={c.id}
                            className="relative overflow-hidden rounded-3xl p-5 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl group cursor-pointer"
                            style={{
                              background: "rgba(255,255,255,0.75)",
                              border: "1px solid rgba(26,47,138,0.1)",
                              animation: `adminCardEntry 0.5s ease-out ${0.3 + i * 0.04}s both`,
                              boxShadow: "0 4px 12px -2px rgba(15,31,92,0.08)",
                            }}
                            onClick={() => { setEditingCompany(c); setShowCompanyModal(true); }}>

                            <div className="absolute top-0 left-0 right-0 h-1" style={{ background: tc.color }} />

                            <div className="flex items-start justify-between mb-3">
                              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black text-white shadow-lg shrink-0"
                                style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                                {initials(c.name)}
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); setEditingCompany(c); setShowCompanyModal(true); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 transition-all"
                                  style={{ color: `${C.navy}50` }}>
                                  <Edit2 size={11} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteCompany(c.id); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-all"
                                  style={{ color: `${C.navy}50` }}>
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>

                            <p className="text-base font-black leading-tight" style={{ color: C.navyDark }}>{c.name}</p>
                            <p className="text-[11px] font-mono mt-0.5" style={{ color: `${C.navy}55` }}>{c.slug}</p>

                            <div className="flex items-center gap-1.5 mt-4">
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider"
                                style={{ background: `${tc.color}18`, color: tc.color }}>
                                <tc.icon size={9} />
                                {tc.label}
                              </span>
                              {c.is_trial ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider"
                                  style={{ background: "#fef3c7", color: "#d97706" }}>
                                  <Calendar size={9} /> Trial
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider"
                                  style={{ background: "#d1fae5", color: "#047857" }}>
                                  <Check size={9} /> {t(adminLocale, "adm_paid")}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between mt-4 pt-3 border-t" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: `${C.navy}50` }}>{t(adminLocale, "adm_users_label")}</p>
                                <p className="text-base font-black mt-0.5" style={{ color: C.navyDark }}>
                                  {c.active_user_count ?? 0}
                                  {c.total_user_count > c.active_user_count && (
                                    <span className="text-[10px] font-bold ml-1" style={{ color: `${C.navy}50` }}>/{c.total_user_count}</span>
                                  )}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: `${C.navy}50` }}>{t(adminLocale, "adm_created")}</p>
                                <p className="text-[10px] font-bold mt-0.5" style={{ color: `${C.navy}65` }}>{fmtDate(c.created_at)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* USERS */}
            {tab === "users" && (
              <div style={{ animation: "adminCardEntry 0.5s ease-out 0.3s both" }} className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl flex-shrink-0"
                  style={{ background: "rgba(26,47,138,0.06)", border: "1px solid rgba(26,47,138,0.1)" }}>
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: `${C.navy}40` }} />
                    <input type="text" placeholder={t(adminLocale, "adm_search_user")}
                      value={searchUser} onChange={(e) => setSearchUser(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-xs font-medium rounded-xl outline-none transition-colors"
                      style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: C.navyDark }} />
                  </div>
                  <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)}
                    className="px-3 py-2.5 text-xs font-black rounded-xl outline-none cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: C.navyDark }}>
                    <option value="all">{t(adminLocale, "adm_all")}</option>
                    <option value="active">{t(adminLocale, "adm_active_only")}</option>
                    <option value="inactive">{t(adminLocale, "adm_inactive_only")}</option>
                    <option value="super">{t(adminLocale, "adm_super_only")}</option>
                  </select>
                  <div className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(26,47,138,0.1)", color: `${C.navy}70` }}>
                    <Filter size={10} />
                    {usersFiltered.length} {t(adminLocale, "adm_of")} {users.length}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto admin-scroll">
                  {loading ? (
                    <div className="text-center py-20">
                      <Loader2 size={24} className="animate-spin mx-auto" style={{ color: `${C.navy}40` }} />
                    </div>
                  ) : usersFiltered.length === 0 ? (
                    <div className="text-center py-20 rounded-3xl"
                      style={{ background: "rgba(26,47,138,0.04)", border: "2px dashed rgba(26,47,138,0.12)" }}>
                      <Users size={32} className="mx-auto mb-3" style={{ color: `${C.navy}30` }} />
                      <p className="text-sm font-black" style={{ color: `${C.navy}60` }}>{t(adminLocale, "adm_no_users")}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: `${C.navy}45` }}>{t(adminLocale, "adm_no_users_hint")}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {usersFiltered.map((u, i) => (
                        <div key={u.id}
                          className="relative overflow-hidden rounded-3xl p-5 transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl group cursor-pointer"
                          style={{
                            background: "rgba(255,255,255,0.75)",
                            border: "1px solid rgba(26,47,138,0.1)",
                            animation: `adminCardEntry 0.5s ease-out ${0.3 + i * 0.04}s both`,
                            boxShadow: "0 4px 12px -2px rgba(15,31,92,0.08)",
                          }}
                          onClick={() => { setEditingUser(u); setShowUserModal(true); }}>

                          {u.is_super_admin && (
                            <div className="absolute top-0 left-0 right-0 h-1" style={{ background: C.amber }} />
                          )}

                          <div className="flex items-start gap-4">
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-base font-black text-white shrink-0 shadow-lg"
                              style={{
                                background: u.is_super_admin
                                  ? `linear-gradient(135deg, ${C.amber} 0%, #d97706 100%)`
                                  : `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                              }}>
                              {initials(u.username || u.email)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <p className="text-base font-black truncate flex items-center gap-1.5" style={{ color: C.navyDark }}>
                                  {u.username}
                                  {u.is_super_admin && <Crown size={12} style={{ color: C.amber }} />}
                                </p>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={(e) => { e.stopPropagation(); setEditingUser(u); setShowUserModal(true); }}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 transition-all"
                                    style={{ color: `${C.navy}50` }}>
                                    <Edit2 size={11} />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-all"
                                    style={{ color: `${C.navy}50` }}>
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                              <p className="text-[11px] font-medium truncate" style={{ color: `${C.navy}65` }}>{u.email}</p>

                              <div className="flex items-center gap-1 mt-2.5 flex-wrap">
                                {u.is_super_admin && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                                    style={{ background: "#fef3c7", color: "#d97706" }}>
                                    <Crown size={9} /> Super-Admin
                                  </span>
                                )}
                                {u.is_active ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                                    style={{ background: "#d1fae5", color: "#047857" }}>
                                    <Check size={9} /> {t(adminLocale, "adm_active")}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                                    style={{ background: "rgba(26,47,138,0.08)", color: `${C.navy}60` }}>
                                    {t(adminLocale, "adm_inactive")}
                                  </span>
                                )}
                              </div>

                              {u._company_names.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2.5 pt-2.5 border-t" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
                                  {u._company_names.slice(0, 3).map(n => (
                                    <span key={n} className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                      style={{ background: "rgba(26,47,138,0.06)", color: `${C.navy}75`, border: "1px solid rgba(26,47,138,0.1)" }}>
                                      {n}
                                    </span>
                                  ))}
                                  {u._company_names.length > 3 && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                      style={{ background: "rgba(26,47,138,0.06)", color: `${C.navy}50`, border: "1px solid rgba(26,47,138,0.1)" }}>
                                      +{u._company_names.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SETTINGS */}
            {tab === "settings" && (
              <div style={{ animation: "adminCardEntry 0.5s ease-out 0.3s both" }} className="flex-1 min-h-0 flex flex-col gap-6 overflow-hidden">
                <div className="flex-shrink-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-0.5" style={{ color: `${C.navy}55` }}>{t(adminLocale, "adm_lang_title")}</p>
                  <p className="text-xs" style={{ color: `${C.navy}55` }}>{t(adminLocale, "adm_lang_subtitle")}</p>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
                  {Object.entries(LOCALES).map(([code, { label, flag }], i) => {
                    const active = (adminLocale ?? "en") === code;
                    return (
                      <button key={code} type="button"
                        onClick={() => setAdminLocale(code)}
                        className="relative overflow-hidden rounded-3xl flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:scale-[1.02]"
                        style={{
                          background: active
                            ? `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 60%, ${C.navyDeep} 100%)`
                            : "rgba(255,255,255,0.7)",
                          border: `2px solid ${active ? C.navy : "rgba(26,47,138,0.12)"}`,
                          boxShadow: active
                            ? `0 20px 50px -12px ${C.navy}60, inset 0 1px 0 rgba(255,255,255,0.12)`
                            : "0 4px 12px -2px rgba(15,31,92,0.08)",
                          animation: `adminCardEntry 0.5s ease-out ${0.1 + i * 0.08}s both`,
                        }}>

                        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full transition-all duration-300"
                          style={{ background: active ? "rgba(255,255,255,0.06)" : "rgba(26,47,138,0.03)" }} />

                        {active && (
                          <div className="absolute top-4 right-4 w-6 h-6 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)" }}>
                            <Check size={12} className="text-white" />
                          </div>
                        )}

                        <span style={{ fontSize: 52, lineHeight: 1, filter: active ? "none" : "grayscale(20%)" }}>
                          {flag}
                        </span>

                        <div className="text-center">
                          <p className="font-black text-lg leading-tight"
                            style={{ color: active ? "#fff" : C.navyDark }}>
                            {label}
                          </p>
                          <p className="text-[11px] font-mono mt-0.5 uppercase tracking-widest"
                            style={{ color: active ? "rgba(255,255,255,0.5)" : `${C.navy}55` }}>
                            {code}
                          </p>
                        </div>

                        {active && (
                          <div className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
                            style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.2)" }}>
                            {t(adminLocale, "adm_lang_active")}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
</main>
        </div>
      </div>

      {/* MODALS */}
{showCompanyModal && (
        <CompanyModal key={`co-${editingCompany?.id}-${users.length}`}
          company={editingCompany}
          onClose={() => setShowCompanyModal(false)}
          onSaved={reload} showToast={showToast} locale={adminLocale}
          onEditUser={(u) => {
            setShowCompanyModal(false);
            setTimeout(() => {
              setEditingUser({ ...u, _company_links: allLinks.filter(l => l.user_id === u.id), _company_names: [] });
              setShowUserModal(true);
            }, 200);
          }}
onAddUserForCompany={(co) => {
            // Open the user modal ON TOP of the company modal, don't close it.
            // editingUser is null → UserModal renders in "create" mode but with
            // companyLinks pre-populated with this company as default.
            setEditingUser({
              _company_links: [{
                company_id: co.id,
                is_default: true,
                is_active: true,
              }],
              _prefilled_company: co,
            });
            setShowUserModal(true);
          }} />
      )}
{showUserModal && (
        <UserModal user={editingUser} companies={companies}
          allUsers={users} allLinks={allLinks}
          onClose={() => setShowUserModal(false)}
          onSaved={reload} showToast={showToast} locale={adminLocale} />
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}