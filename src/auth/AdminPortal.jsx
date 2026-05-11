import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Users, Activity, LogOut, Search, Plus, X,
  Edit2, Trash2, Check, AlertCircle, Loader2, Crown,
  Sparkles, Star, RefreshCw, Calendar,
  ShieldCheck, Zap, Minus, Filter, ChevronRight, Database,
} from "lucide-react";
import { supabase, sbAccounts } from "../lib/supabaseClient";

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

const ROLES = [
  { id: "low",   label: "Low",   color: "#94a3b8" },
  { id: "base",  label: "Base",  color: "#60a5fa" },
  { id: "admin", label: "Admin", color: "#fbbf24" },
];
const roleConfig = (id) => ROLES.find(r => r.id === id) ?? ROLES[1];

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
// CINEMATIC BACKGROUND LAYERS (from Login.jsx)
// ════════════════════════════════════════════════════════════════

const NODES = [
  { angle:   0, delay:    0 },
  { angle:  60, delay:  200 },
  { angle: 120, delay:  400 },
  { angle: 180, delay:  600 },
  { angle: 240, delay:  800 },
  { angle: 300, delay: 1000 },
];

function ConsolidationGraph() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="-200 -200 400 400"
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity: 0.5 }}
    >
      <circle cx="0" cy="0" r="160" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <circle cx="0" cy="0" r="120" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 4" />
      <circle cx="0" cy="0" r="80"  fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

      {NODES.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const x = Math.cos(rad) * 140;
        const y = Math.sin(rad) * 140;
        return (
          <line key={`line-${i}`} x1={x} y1={y} x2="0" y2="0"
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8"
            strokeDasharray="280"
            style={{
              animation: `adminDrawLine 3s ease-out ${n.delay}ms both, adminFadeLine 6s ease-in-out ${n.delay + 3000}ms infinite`,
            }}
          />
        );
      })}

      {NODES.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const x = Math.cos(rad) * 140;
        const y = Math.sin(rad) * 140;
        return (
          <g key={`node-${i}`}>
            <circle cx={x} cy={y} r="6" fill="rgba(255,255,255,0.15)"
              style={{ animation: `adminPulseNode 4s ease-in-out ${n.delay}ms infinite` }} />
            <circle cx={x} cy={y} r="3" fill="#ffffff"
              style={{ animation: `adminNodeAppear 600ms ease-out ${n.delay + 500}ms both`, filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))" }} />
          </g>
        );
      })}

      <circle cx="0" cy="0" r="14" fill="rgba(232,57,74,0.2)"
        style={{ animation: "adminPulseHub 3s ease-in-out infinite" }} />
      <circle cx="0" cy="0" r="8" fill="#e8394a"
        style={{ filter: "drop-shadow(0 0 12px rgba(232,57,74,0.8))" }} />

      <g style={{ animation: "adminRotateRing 40s linear infinite", transformOrigin: "0 0" }}>
        <circle cx="0" cy="0" r="180" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" strokeDasharray="3 8" />
      </g>
    </svg>
  );
}

const TICKERS = [
  { label: "COMPANIES",  value: "ACTIVE",  color: "#34d399" },
  { label: "ENTITIES",   value: "MULTI",   color: "#ffffff" },
  { label: "TIER MAX",   value: "PRO",     color: "#fbbf24" },
  { label: "USERS",      value: "ONLINE",  color: "#34d399" },
  { label: "ACCESS",     value: "GRANTED", color: "#34d399" },
  { label: "SECURITY",   value: "RLS",     color: "#fbbf24" },
  { label: "STATUS",     value: "LIVE",    color: "#ffffff" },
  { label: "ROLES",      value: "ADMIN",   color: "#fbbf24" },
];

function FloatingTickers() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {TICKERS.map((t, i) => {
        const top  = ((i * 37) % 80) + 10;
        const left = ((i * 53) % 80) + 10;
        const delay = i * 600;
        return (
          <div key={i} className="absolute"
            style={{
              top: `${top}%`, left: `${left}%`,
              animation: `adminFloatTicker 8s ease-in-out ${delay}ms infinite, adminFadeInTicker 800ms ease-out ${delay}ms both`,
              opacity: 0,
            }}>
            <div className="bg-white/5 backdrop-blur-sm rounded-md px-2 py-1 border border-white/10" style={{ fontSize: 9 }}>
              <span className="text-blue-200/60 font-bold tracking-widest mr-2">{t.label}</span>
              <span className="font-black tabular-nums" style={{ color: t.color }}>{t.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BackgroundChart() {
  const points = [];
  const W = 800, H = 200;
  for (let x = 0; x <= W; x += 10) {
    const y = H * 0.5 + Math.sin(x * 0.012) * 30 + Math.sin(x * 0.03) * 12 + Math.cos(x * 0.045) * 6;
    points.push(`${x},${y.toFixed(1)}`);
  }
  const path = "M" + points.join(" L");
  return (
    <svg className="absolute bottom-0 left-0 w-full pointer-events-none"
      viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ height: "30%", opacity: 0.35 }}>
      <defs>
        <linearGradient id="adminBgChart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.15)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#adminBgChart)"
        style={{ animation: "adminWaveSlide 14s ease-in-out infinite" }} />
      <path d={path} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1"
        style={{ animation: "adminWaveSlide 14s ease-in-out infinite" }} />
    </svg>
  );
}

function Particles() {
  const particles = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map(i => {
        const size = 1 + (i % 3);
        const top  = (i * 47) % 100;
        const left = (i * 23) % 100;
        const dur  = 8 + (i % 6);
        const delay = (i * 400) % 4000;
        return (
          <span key={i} className="absolute rounded-full bg-white"
            style={{
              width: size, height: size,
              top: `${top}%`, left: `${left}%`,
              opacity: 0.4, filter: "blur(0.5px)",
              animation: `adminFloatParticle ${dur}s ease-in-out ${delay}ms infinite`,
            }} />
        );
      })}
    </div>
  );
}

function CinematicBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ background: C.navy }}>
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-white opacity-[0.04]" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-white opacity-[0.04]" />
      <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] rounded-full opacity-[0.06]"
        style={{ background: C.red, filter: "blur(80px)" }} />
      <BackgroundChart />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-full h-full max-w-[900px] max-h-[900px]">
          <ConsolidationGraph />
        </div>
      </div>
      <FloatingTickers />
      <Particles />
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
        background: checked ? accent : "rgba(255,255,255,0.15)",
        boxShadow: checked ? `0 0 20px ${accent}80, inset 0 1px 2px rgba(0,0,0,0.1)` : "inset 0 1px 2px rgba(0,0,0,0.2)",
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
        background: "rgba(15, 31, 92, 0.95)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${isError ? "rgba(232,57,74,0.4)" : "rgba(52,211,153,0.4)"}`,
        boxShadow: `0 20px 50px rgba(0,0,0,0.4), 0 0 30px ${isError ? "rgba(232,57,74,0.2)" : "rgba(52,211,153,0.2)"}`,
        minWidth: 280,
      }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: isError ? "rgba(232,57,74,0.2)" : "rgba(52,211,153,0.2)",
          border: `1px solid ${isError ? "rgba(232,57,74,0.4)" : "rgba(52,211,153,0.4)"}`,
        }}>
        {isError ? <AlertCircle size={16} style={{ color: "#fca5a5" }} /> : <Check size={16} style={{ color: "#86efac" }} />}
      </div>
      <span className="text-sm font-bold text-white">{message}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// HERO STAT CARD (cinematic)
// ════════════════════════════════════════════════════════════════
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
// COMPANY MODAL
// ════════════════════════════════════════════════════════════════
function CompanyModal({ company, onClose, onSaved, showToast }) {
  const isEdit = !!company;
  const [form, setForm] = useState({
    name: company?.name ?? "",
    slug: company?.slug ?? "",
    tier: company?.tier ?? "base",
    is_trial: company?.is_trial ?? true,
    trial_started_at: company?.trial_started_at?.slice(0, 10) ?? "",
    trial_ends_at:    company?.trial_ends_at?.slice(0, 10) ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [slugDirty, setSlugDirty] = useState(isEdit);

  const handleNameChange = (v) => setForm(f => ({ ...f, name: v, slug: slugDirty ? f.slug : slugify(v) }));

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
    };
    const { error } = isEdit
      ? await sbAccounts.from("companies").update(payload).eq("id", company.id)
      : await sbAccounts.from("companies").insert(payload);
    setSaving(false);
    if (error) {
      showToast("error", error.message);
      return;
    }
    showToast("success", isEdit ? "Empresa actualizada" : "Empresa creada");
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(9, 21, 72, 0.7)",
        backdropFilter: "blur(12px)",
        animation: "adminFadeIn 0.25s ease-out both",
      }}
      onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[32px] overflow-hidden flex flex-col max-h-[90vh] bg-white"
        style={{
          boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5), 0 0 60px rgba(232,57,74,0.15)",
          animation: "adminModalEntry 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* Cinematic Header */}
        <div className="relative px-8 py-6 overflow-hidden shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white opacity-[0.05] blur-2xl" />
          <div className="absolute -bottom-20 -left-10 w-40 h-40 rounded-full opacity-[0.1] blur-2xl"
            style={{ background: C.red }} />

          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.18)" }}>
                <Building2 size={20} className="text-white" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-300">
                  {isEdit ? "Edit · Company" : "Create · Company"}
                </p>
                <h3 className="text-white font-black text-2xl leading-tight mt-0.5">
                  {isEdit ? form.name || "Empresa" : "Nueva empresa"}
                </h3>
              </div>
            </div>
            <button onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-7 space-y-5 overflow-y-auto flex-1">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-[0.16em] mb-2 text-gray-400">
              Nombre de la empresa
            </label>
            <input type="text" value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Corporation"
              className="w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none transition-all bg-gray-50 border-2 border-gray-100 focus:border-[#1a2f8a] focus:bg-white text-gray-800" />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-[0.16em] mb-2 text-gray-400">
              Identificador
            </label>
            <input type="text" value={form.slug}
              onChange={(e) => { setSlugDirty(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })); }}
              placeholder="acme-corp"
              className="w-full rounded-2xl px-4 py-3.5 text-sm font-mono outline-none transition-all bg-gray-50 border-2 border-gray-100 focus:border-[#1a2f8a] focus:bg-white text-gray-800" />
          </div>

          {/* Tier */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-[0.16em] mb-2 text-gray-400">
              Tier · Plan
            </label>
            <div className="grid grid-cols-4 gap-2">
              {TIERS.map(t => {
                const active = form.tier === t.id;
                return (
                  <button key={t.id} type="button"
                    onClick={() => setForm(f => ({ ...f, tier: t.id }))}
                    className="relative rounded-2xl p-3 transition-all duration-300 text-left overflow-hidden group"
                    style={{
                      background: active ? `linear-gradient(135deg, ${t.color}f0, ${t.color})` : "#fafbfc",
                      border: `2px solid ${active ? t.color : "#f3f4f6"}`,
                      boxShadow: active ? `0 8px 20px -4px ${t.color}80, inset 0 1px 0 rgba(255,255,255,0.2)` : "none",
                      transform: active ? "scale(1.03)" : "scale(1)",
                    }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-1.5"
                      style={{
                        background: active ? "rgba(255,255,255,0.25)" : `${t.color}15`,
                        color: active ? "#fff" : t.color,
                      }}>
                      <t.icon size={13} />
                    </div>
                    <p className="text-xs font-black" style={{ color: active ? "#fff" : "#0f172a" }}>{t.label}</p>
                    <p className="text-[9px] font-medium mt-0.5 leading-tight"
                      style={{ color: active ? "rgba(255,255,255,0.85)" : "#94a3b8" }}>
                      {t.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trial toggle */}
          <div
            className="flex items-center justify-between p-4 rounded-2xl transition-all"
            style={{
              background: form.is_trial ? "linear-gradient(135deg, #fef3c7, #fde68a)" : "linear-gradient(135deg, #d1fae5, #a7f3d0)",
              border: `1px solid ${form.is_trial ? "#fcd34d" : "#6ee7b7"}`,
            }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg"
                style={{ background: form.is_trial ? C.amber : "#10b981" }}>
                {form.is_trial ? <Calendar size={15} /> : <Check size={15} />}
              </div>
              <div>
                <p className="text-sm font-black text-gray-800">
                  {form.is_trial ? "Cliente de prueba" : "Cliente pagado"}
                </p>
                <p className="text-[11px] font-medium text-gray-600">
                  {form.is_trial ? "Define el periodo de prueba abajo" : "Suscripción activa, sin trial"}
                </p>
              </div>
            </div>
            <Toggle checked={form.is_trial} onChange={(v) => setForm(f => ({ ...f, is_trial: v }))} accent={C.amber} />
          </div>

          {/* Trial dates */}
          {form.is_trial && (
            <div className="grid grid-cols-2 gap-3" style={{ animation: "adminSlideDown 0.3s ease-out both" }}>
              {[
                { key: "trial_started_at", label: "Inicio" },
                { key: "trial_ends_at",    label: "Fin" },
              ].map(d => (
                <div key={d.key}>
                  <label className="block text-[11px] font-black uppercase tracking-[0.14em] mb-1.5 text-gray-400">
                    {d.label}
                  </label>
                  <input type="date" value={form[d.key]}
                    onChange={(e) => setForm(f => ({ ...f, [d.key]: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-xs font-medium outline-none bg-gray-50 border-2 border-gray-100 focus:border-[#1a2f8a] focus:bg-white text-gray-800" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 flex items-center justify-end gap-2 shrink-0 bg-gray-50 border-t border-gray-100">
          <button onClick={onClose} disabled={saving}
            className="px-5 py-2.5 text-xs font-black rounded-xl text-gray-500 hover:bg-gray-100 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg hover:shadow-xl hover:scale-[1.02]"
            style={{
              background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)`,
              boxShadow: `0 8px 20px -4px ${C.navy}80`,
            }}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear empresa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// USER MODAL
// ════════════════════════════════════════════════════════════════
function UserModal({ user, companies, onClose, onSaved, showToast }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email:    user?.email    ?? "",
    username: user?.username ?? "",
    password: "",
    is_super_admin: user?.is_super_admin ?? false,
    is_active:      user?.is_active      ?? true,
  });
  const [companyLinks, setCompanyLinks] = useState(user?._company_links ?? []);
  const [saving, setSaving] = useState(false);

  const handleGenerate = () => setForm(f => ({ ...f, password: generatePassword() }));

  const addLink = () => {
    const remaining = companies.filter(c => !companyLinks.find(l => l.company_id === c.id));
    if (remaining.length === 0) return;
    setCompanyLinks([...companyLinks, {
      company_id: remaining[0].id,
      role: "base",
      is_default: companyLinks.length === 0,
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
    if (!form.email.trim() || !form.username.trim()) {
      showToast("error", "Email y username son obligatorios");
      return;
    }
    if (!isEdit && !form.password) {
      showToast("error", "Define una contraseña inicial");
      return;
    }
    setSaving(true);

    let userId = user?.id;

    // ════════════════════════════════════════════════════════
    // CRÍTICO: si es CREATE, hacemos signUp y luego restauramos
    // la sesión del super-admin. Sin esto, RLS bloquea los
    // inserts posteriores porque la sesión queda como el user
    // nuevo (que no tiene permisos).
    // ════════════════════════════════════════════════════════
    if (!isEdit) {
      const { data: { session: adminSession } } = await supabase.auth.getSession();
      if (!adminSession) {
        setSaving(false);
        showToast("error", "Sesión perdida, vuelve a entrar");
        return;
      }

      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { username: form.username.trim() } },
      });

      if (signUpErr || !signUpData?.user) {
        await supabase.auth.setSession({
          access_token:  adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
        setSaving(false);
        showToast("error", signUpErr?.message ?? "No se pudo crear el usuario");
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
      username:       form.username.trim(),
      email:          form.email.trim(),
      is_super_admin: form.is_super_admin,
      is_active:      form.is_active,
    };
    const { error: userErr } = await sbAccounts.from("users").update(userPayload).eq("id", userId);
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
        role:       l.role,
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
    showToast("success", isEdit ? "Usuario actualizado" : "Usuario creado");
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(9, 21, 72, 0.7)",
        backdropFilter: "blur(12px)",
        animation: "adminFadeIn 0.25s ease-out both",
      }}
      onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-[32px] overflow-hidden flex flex-col max-h-[92vh] bg-white"
        style={{
          boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5), 0 0 60px rgba(232,57,74,0.2)",
          animation: "adminModalEntry 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* Cinematic Header */}
        <div className="relative px-8 py-6 overflow-hidden shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)` }}>
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white opacity-[0.1] blur-2xl" />
          <div className="absolute -bottom-20 -left-10 w-40 h-40 rounded-full opacity-[0.1] blur-2xl"
            style={{ background: "#fff" }} />

          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.25)" }}>
                <Users size={20} className="text-white" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-100">
                  {isEdit ? "Edit · User" : "Create · User"}
                </p>
                <h3 className="text-white font-black text-2xl leading-tight mt-0.5">
                  {isEdit ? form.username || "Usuario" : "Nuevo usuario"}
                </h3>
              </div>
            </div>
            <button onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition-all">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-7 space-y-5 overflow-y-auto flex-1">
          {/* Email + Username */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-[0.16em] mb-2 text-gray-400">Email</label>
              <input type="email" value={form.email} disabled={isEdit}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@empresa.com"
                className="w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none transition-all bg-gray-50 border-2 border-gray-100 focus:border-[#e8394a] focus:bg-white disabled:opacity-60 text-gray-800" />
            </div>
            <div>
              <label className="block text-[11px] font-black uppercase tracking-[0.16em] mb-2 text-gray-400">Username</label>
              <input type="text" value={form.username}
                onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="juan.perez"
                className="w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none transition-all bg-gray-50 border-2 border-gray-100 focus:border-[#e8394a] focus:bg-white text-gray-800" />
            </div>
          </div>

          {/* Password */}
          {!isEdit && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">Contraseña inicial</label>
                <button type="button" onClick={handleGenerate}
                  className="text-[11px] font-black flex items-center gap-1 transition-all hover:scale-105"
                  style={{ color: C.red }}>
                  <RefreshCw size={11} /> Generar segura
                </button>
              </div>
              <input type="text" value={form.password}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                className="w-full rounded-2xl px-4 py-3.5 text-sm font-mono outline-none transition-all bg-gray-50 border-2 border-gray-100 focus:border-[#e8394a] focus:bg-white text-gray-800" />
            </div>
          )}

          {/* Permissions */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-4 rounded-2xl transition-all"
              style={{
                background: form.is_super_admin ? "linear-gradient(135deg, #fef3c7, #fde68a)" : "#fafbfc",
                border: `1px solid ${form.is_super_admin ? "#fcd34d" : "#f3f4f6"}`,
              }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                  style={{
                    background: form.is_super_admin ? C.amber : "#fff",
                    color: form.is_super_admin ? "#fff" : "#94a3b8",
                    border: form.is_super_admin ? "none" : "1px solid #e5e7eb",
                  }}>
                  <Crown size={15} />
                </div>
                <div>
                  <p className="text-xs font-black text-gray-800">Super-Admin</p>
                  <p className="text-[10px] font-medium text-gray-500">Acceso total</p>
                </div>
              </div>
              <Toggle checked={form.is_super_admin} onChange={(v) => setForm(f => ({ ...f, is_super_admin: v }))} accent={C.amber} />
            </div>

            <div className="flex items-center justify-between p-4 rounded-2xl transition-all"
              style={{
                background: form.is_active ? "linear-gradient(135deg, #d1fae5, #a7f3d0)" : "#fafbfc",
                border: `1px solid ${form.is_active ? "#6ee7b7" : "#f3f4f6"}`,
              }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                  style={{
                    background: form.is_active ? "#10b981" : "#fff",
                    color: form.is_active ? "#fff" : "#94a3b8",
                    border: form.is_active ? "none" : "1px solid #e5e7eb",
                  }}>
                  <ShieldCheck size={15} />
                </div>
                <div>
                  <p className="text-xs font-black text-gray-800">Activo</p>
                  <p className="text-[10px] font-medium text-gray-500">Puede iniciar sesión</p>
                </div>
              </div>
              <Toggle checked={form.is_active} onChange={(v) => setForm(f => ({ ...f, is_active: v }))} accent="#10b981" />
            </div>
          </div>

          {/* Companies */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">
                  Empresas asignadas
                </p>
                <p className="text-[10px] font-medium mt-0.5 text-gray-400">
                  La marcada con ★ se abre por defecto al hacer login
                </p>
              </div>
              <button type="button" onClick={addLink}
                disabled={companyLinks.length >= companies.length}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black transition-all disabled:opacity-30 hover:scale-105 text-white shadow-md"
                style={{ background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)` }}>
                <Plus size={11} /> Añadir
              </button>
            </div>

            <div className="space-y-2">
              {companyLinks.length === 0 && (
                <div className="text-center py-10 rounded-2xl"
                  style={{ background: "#fafbfc", border: "2px dashed #e5e7eb" }}>
                  <Building2 size={24} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-xs font-bold text-gray-400">Sin empresas asignadas</p>
                  <p className="text-[11px] mt-0.5 text-gray-300">Click en "Añadir" para empezar</p>
                </div>
              )}

              {companyLinks.map((l, idx) => {
                const co = companies.find(c => c.id === l.company_id);
                const rc = roleConfig(l.role);
                return (
                  <div key={idx}
                    className="rounded-2xl overflow-hidden transition-all"
                    style={{
                      background: l.is_default ? "linear-gradient(135deg, #fef3c7 0%, #fff 60%)" : "#fafbfc",
                      border: `2px solid ${l.is_default ? "#fcd34d" : "#f3f4f6"}`,
                      boxShadow: l.is_default ? "0 4px 16px -4px rgba(251, 191, 36, 0.4)" : "none",
                    }}>
                    <div className="p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-white shrink-0 shadow-md"
                        style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                        {initials(co?.name)}
                      </div>

                      <select value={l.company_id}
                        onChange={(e) => updateLink(idx, { company_id: e.target.value })}
                        className="flex-1 bg-transparent text-sm font-black outline-none cursor-pointer text-gray-800">
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>

                      <select value={l.role}
                        onChange={(e) => updateLink(idx, { role: e.target.value })}
                        className="rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider outline-none cursor-pointer"
                        style={{ background: `${rc.color}18`, color: rc.color, border: `1px solid ${rc.color}40` }}>
                        {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>

                      <button type="button"
                        onClick={() => updateLink(idx, { is_default: !l.is_default })}
                        title={l.is_default ? "Empresa por defecto" : "Marcar como por defecto"}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition-all text-[10px] font-black uppercase tracking-wider"
                        style={{
                          background: l.is_default ? C.amber : "transparent",
                          color: l.is_default ? "#fff" : "#94a3b8",
                          boxShadow: l.is_default ? `0 4px 12px ${C.amber}60` : "none",
                        }}>
                        <Star size={11} fill={l.is_default ? "#fff" : "none"} />
                        {l.is_default ? "Default" : "Marcar"}
                      </button>

                      <button type="button" onClick={() => removeLink(idx)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-7 py-4 flex items-center justify-end gap-2 shrink-0 bg-gray-50 border-t border-gray-100">
          <button onClick={onClose} disabled={saving}
            className="px-5 py-2.5 text-xs font-black rounded-xl text-gray-500 hover:bg-gray-100 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02]"
            style={{
              background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
              boxShadow: `0 8px 20px -4px ${C.red}80`,
            }}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? "Guardar" : "Crear usuario"}
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
  const [filterSuper, setFilterSuper] = useState("all");

  const [editingCompany, setEditingCompany] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);

  const [toast, setToast] = useState(null);
  const showToast = (type, message) => setToast({ type, message });

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
    if (!window.confirm("¿Eliminar empresa? Esta acción no se puede deshacer.")) return;
    const { error } = await sbAccounts.from("companies").delete().eq("id", id);
    if (error) { showToast("error", error.message); return; }
    showToast("success", "Empresa eliminada"); reload();
  };

const handleDeleteUser = async (id) => {
  const confirmed = window.confirm(
    "¿Eliminar usuario completamente?\n\n" +
    "Esto borrará al usuario de Supabase Auth, de la tabla accounts.users, " +
    "y de todas sus empresas asignadas. Esta acción NO se puede deshacer.\n\n" +
    "¿Continuar?"
  );
  if (!confirmed) return;

  // Hard delete via Edge Function (uses service_role on server side):
  // 1. Verifies caller is super-admin
  // 2. Deletes from auth.users → ON DELETE CASCADE removes accounts.users + user_companies
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    showToast("error", "Sesión expirada, vuelve a iniciar sesión");
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

    showToast("success", "Usuario eliminado completamente");
    reload();
  } catch (e) {
    showToast("error", `Error de red: ${e.message}`);
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
    if (filterSuper === "super" && !u.is_super_admin) return false;
    if (filterSuper === "regular" && u.is_super_admin) return false;
    return true;
  }), [usersEnriched, searchUser, filterSuper]);

  const stats = useMemo(() => ({
    totalCompanies: companies.length,
    totalUsers: users.length,
    superAdmins: users.filter(u => u.is_super_admin).length,
    activeTrials: companies.filter(c => c.is_trial).length,
  }), [companies, users]);

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.navy }}>
        <Loader2 size={28} className="animate-spin text-white" />
      </div>
    );
  }

  const tabConfig = tab === "companies"
    ? { title: "Empresas", subtitle: "Gestión de cuentas cliente", color: C.navy, accent: "#2d4ab8" }
    : { title: "Usuarios",  subtitle: "Gestión de accesos", color: C.red, accent: C.redDark };

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: C.navy }}>
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
        @keyframes adminDrawLine {
          from { stroke-dashoffset: 280; opacity: 0; }
          to   { stroke-dashoffset: 0;   opacity: 1; }
        }
        @keyframes adminFadeLine {
          0%, 100% { opacity: 0.18; }
          50%      { opacity: 0.4;  }
        }
        @keyframes adminNodeAppear {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes adminPulseNode {
          0%, 100% { r: 6; opacity: 0.15; }
          50%      { r: 9; opacity: 0.3;  }
        }
        @keyframes adminPulseHub {
          0%, 100% { r: 14; opacity: 0.2; }
          50%      { r: 22; opacity: 0.4; }
        }
        @keyframes adminRotateRing {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
        @keyframes adminFloatTicker {
          0%, 100% { transform: translate(0, 0);     }
          50%      { transform: translate(8px, -12px); }
        }
        @keyframes adminFadeInTicker {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes adminWaveSlide {
          0%, 100% { transform: translateX(0);     }
          50%      { transform: translateX(-30px); }
        }
        @keyframes adminFloatParticle {
          0%, 100% { transform: translate(0, 0);        opacity: 0.4; }
          50%      { transform: translate(20px, -30px); opacity: 0.8; }
        }
        .admin-scroll::-webkit-scrollbar { width: 6px; }
        .admin-scroll::-webkit-scrollbar-track { background: transparent; }
        .admin-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 6px; }
        .admin-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
      `}</style>

      <CinematicBackground />

      <div className="relative z-10 min-h-screen flex">

        {/* SIDEBAR */}
        <aside className="w-[260px] shrink-0 flex flex-col p-6 relative"
          style={{ animation: "adminSlideInLeft 0.7s ease-out both" }}>

          {/* Brand */}
          <div className="flex items-center gap-3 mb-12">
            <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-2xl">
              <Crown size={18} style={{ color: C.navy }} />
            </div>
          </div>

          {/* Tag */}
          <p className="text-blue-300 text-[10px] font-black tracking-[0.22em] uppercase mb-3">Control Center</p>
          <h2 className="text-3xl font-black text-white leading-tight mb-1">
            Manage<br />Your<br /><span style={{ color: C.red }}>Accounts.</span>
          </h2>
          <p className="text-blue-200/70 text-xs leading-relaxed mb-8 max-w-[200px]">
            Empresas, usuarios y accesos en tiempo real.
          </p>

          {/* Nav */}
          <nav className="space-y-1.5 mb-auto">
            {[
              { id: "companies", label: "Empresas",  icon: Building2 },
              { id: "users",     label: "Usuarios",  icon: Users },
              { id: "activity",  label: "Actividad", icon: Activity, disabled: true },
            ].map((t, i) => {
              const active = tab === t.id;
              return (
                <button key={t.id}
                  onClick={() => !t.disabled && setTab(t.id)}
                  disabled={t.disabled}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-[13px] font-black transition-all duration-300"
                  style={{
                    background: active
                      ? "rgba(255,255,255,0.95)"
                      : "rgba(255,255,255,0.04)",
                    color: active ? C.navy : "rgba(255,255,255,0.7)",
                    boxShadow: active
                      ? `0 8px 20px -4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.5)`
                      : "inset 0 1px 0 rgba(255,255,255,0.05)",
                    border: active ? "none" : "1px solid rgba(255,255,255,0.08)",
                    cursor: t.disabled ? "not-allowed" : "pointer",
                    opacity: t.disabled ? 0.4 : 1,
                    animation: `adminSlideInLeft 0.5s ease-out ${0.2 + i * 0.08}s both`,
                  }}
                  onMouseEnter={(e) => {
                    if (!active && !t.disabled) {
                      e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                      e.currentTarget.style.color = "#fff";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active && !t.disabled) {
                      e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                    }
                  }}>
                  <t.icon size={15} />
                  {t.label}
                  {active && <ChevronRight size={14} className="ml-auto" />}
                  {t.disabled && <span className="ml-auto text-[8px] opacity-60 font-bold">SOON</span>}
                </button>
              );
            })}
          </nav>

          {/* Session */}
          <div className="space-y-2 pt-4">
            <div className="px-3.5 py-3 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[10px] font-black text-white shrink-0 shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${C.amber} 0%, #d97706 100%)` }}>
                  {initials(me.username || me.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-black text-white truncate flex items-center gap-1">
                    {me.username}
                    <Crown size={9} style={{ color: C.amber }} />
                  </p>
                  <p className="text-[9px] truncate text-blue-200/60">{me.email}</p>
                </div>
              </div>
            </div>
            <button onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-[11px] font-black text-blue-200/70 hover:text-white hover:bg-white/5 transition-all">
              <LogOut size={12} />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* MAIN PANEL — floating white panel with rounded corner like login */}
        <main className="flex-1 m-4 mr-4 ml-0 rounded-[40px] overflow-hidden flex flex-col"
          style={{
            background: "rgba(255,255,255,0.98)",
            backdropFilter: "blur(20px)",
            boxShadow: "-30px 0 80px -20px rgba(0,0,0,0.4), 0 30px 80px -20px rgba(0,0,0,0.3)",
            animation: "adminSlideInRight 0.7s ease-out both",
          }}>

          {/* Top header */}
          <div className="px-10 py-7 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400 mb-1">
                {tabConfig.subtitle}
              </p>
              <h1 className="text-5xl font-black leading-tight" style={{ color: C.navy }}>
                {tabConfig.title}<span style={{ color: tabConfig.color === C.navy ? C.red : C.navy }}>.</span>
              </h1>
            </div>

            <button
              onClick={() => {
                if (tab === "companies") { setEditingCompany(null); setShowCompanyModal(true); }
                else { setEditingUser(null); setShowUserModal(true); }
              }}
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl text-[12px] font-black text-white transition-all hover:scale-[1.04] shadow-xl"
              style={{
                background: `linear-gradient(135deg, ${tabConfig.color} 0%, ${tabConfig.accent} 100%)`,
                boxShadow: `0 12px 28px -8px ${tabConfig.color}90`,
              }}>
              <Plus size={14} />
              {tab === "companies" ? "Nueva empresa" : "Nuevo usuario"}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto admin-scroll px-10 py-7 space-y-6">
            {/* Hero stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <HeroStat label="Empresas"      value={stats.totalCompanies} icon={Building2} color={C.navy}    accent="#2d4ab8" delay={0} />
              <HeroStat label="Usuarios"      value={stats.totalUsers}     icon={Users}     color={C.red}     accent={C.redDark} delay={0.08} />
              <HeroStat label="Super-Admins"  value={stats.superAdmins}    icon={Crown}     color="#d97706"   accent={C.amber} delay={0.16} />
              <HeroStat label="Trials"        value={stats.activeTrials}   icon={Zap}       color="#10b981"   accent={C.green} delay={0.24} />
            </div>

            {/* COMPANIES */}
            {tab === "companies" && (
              <div style={{ animation: "adminCardEntry 0.5s ease-out 0.3s both" }}>
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl mb-4 bg-gray-50 border border-gray-100">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input type="text" placeholder="Buscar por nombre o slug..."
                      value={searchCo} onChange={(e) => setSearchCo(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-xs font-medium rounded-xl outline-none bg-white border border-gray-100 focus:border-[#1a2f8a] text-gray-800 transition-colors" />
                  </div>
                  <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
                    className="px-3 py-2.5 text-xs font-black rounded-xl outline-none cursor-pointer bg-white border border-gray-100 text-gray-700">
                    <option value="all">Todos los tiers</option>
                    {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <select value={filterTrial} onChange={(e) => setFilterTrial(e.target.value)}
                    className="px-3 py-2.5 text-xs font-black rounded-xl outline-none cursor-pointer bg-white border border-gray-100 text-gray-700">
                    <option value="all">Todos</option>
                    <option value="trial">Solo trial</option>
                    <option value="paid">Solo pagados</option>
                  </select>
                  <div className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black bg-white border border-gray-100 text-gray-500">
                    <Filter size={10} />
                    {companiesFiltered.length} de {companies.length}
                  </div>
                </div>

                {/* Companies grid as cards */}
                {loading ? (
                  <div className="text-center py-20">
                    <Loader2 size={24} className="animate-spin mx-auto text-gray-300" />
                  </div>
                ) : companiesFiltered.length === 0 ? (
                  <div className="text-center py-20 rounded-3xl bg-gray-50 border-2 border-dashed border-gray-100">
                    <Building2 size={32} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-black text-gray-400">Sin empresas</p>
                    <p className="text-[11px] text-gray-300 mt-0.5">Crea la primera para empezar</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {companiesFiltered.map((c, i) => {
                      const tc = tierConfig(c.tier);
                      return (
                        <div key={c.id}
                          className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 p-5 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl group cursor-pointer"
                          style={{
                            animation: `adminCardEntry 0.5s ease-out ${0.3 + i * 0.04}s both`,
                            boxShadow: "0 4px 12px -2px rgba(0,0,0,0.04)",
                          }}
                          onClick={() => { setEditingCompany(c); setShowCompanyModal(true); }}>

                          {/* Tier accent bar */}
                          <div className="absolute top-0 left-0 right-0 h-1" style={{ background: tc.color }} />

                          <div className="flex items-start justify-between mb-3">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black text-white shadow-lg shrink-0"
                              style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                              {initials(c.name)}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); setEditingCompany(c); setShowCompanyModal(true); }}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-all">
                                <Edit2 size={11} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteCompany(c.id); }}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all">
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>

                          <p className="text-base font-black text-gray-800 leading-tight">{c.name}</p>
                          <p className="text-[11px] font-mono text-gray-400 mt-0.5">{c.slug}</p>

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
                                <Check size={9} /> Pagado
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                            <div>
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Usuarios</p>
                              <p className="text-base font-black text-gray-800 mt-0.5">
                                {c.active_user_count ?? 0}
                                {c.total_user_count > c.active_user_count && (
                                  <span className="text-[10px] font-bold text-gray-400 ml-1">/{c.total_user_count}</span>
                                )}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Creado</p>
                              <p className="text-[10px] font-bold text-gray-500 mt-0.5">{fmtDate(c.created_at)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* USERS */}
            {tab === "users" && (
              <div style={{ animation: "adminCardEntry 0.5s ease-out 0.3s both" }}>
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl mb-4 bg-gray-50 border border-gray-100">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input type="text" placeholder="Buscar por email o username..."
                      value={searchUser} onChange={(e) => setSearchUser(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-xs font-medium rounded-xl outline-none bg-white border border-gray-100 focus:border-[#e8394a] text-gray-800 transition-colors" />
                  </div>
                  <select value={filterSuper} onChange={(e) => setFilterSuper(e.target.value)}
                    className="px-3 py-2.5 text-xs font-black rounded-xl outline-none cursor-pointer bg-white border border-gray-100 text-gray-700">
                    <option value="all">Todos los usuarios</option>
                    <option value="super">Solo super-admins</option>
                    <option value="regular">Solo regulares</option>
                  </select>
                  <div className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black bg-white border border-gray-100 text-gray-500">
                    <Filter size={10} />
                    {usersFiltered.length} de {users.length}
                  </div>
                </div>

                {loading ? (
                  <div className="text-center py-20">
                    <Loader2 size={24} className="animate-spin mx-auto text-gray-300" />
                  </div>
                ) : usersFiltered.length === 0 ? (
                  <div className="text-center py-20 rounded-3xl bg-gray-50 border-2 border-dashed border-gray-100">
                    <Users size={32} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-black text-gray-400">Sin usuarios</p>
                    <p className="text-[11px] text-gray-300 mt-0.5">Crea el primero para empezar</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {usersFiltered.map((u, i) => (
                      <div key={u.id}
                        className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 p-5 transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl group cursor-pointer"
                        style={{
                          animation: `adminCardEntry 0.5s ease-out ${0.3 + i * 0.04}s both`,
                          boxShadow: "0 4px 12px -2px rgba(0,0,0,0.04)",
                        }}
                        onClick={() => { setEditingUser(u); setShowUserModal(true); }}>

                        {/* Top accent for super-admin */}
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
                              <p className="text-base font-black text-gray-800 truncate flex items-center gap-1.5">
                                {u.username}
                                {u.is_super_admin && <Crown size={12} style={{ color: C.amber }} />}
                              </p>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); setEditingUser(u); setShowUserModal(true); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-all">
                                  <Edit2 size={11} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] font-medium text-gray-500 truncate">{u.email}</p>

                            <div className="flex items-center gap-1 mt-2.5 flex-wrap">
                              {u.is_super_admin ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                                  style={{ background: "#fef3c7", color: "#d97706" }}>
                                  <Crown size={9} /> Super-Admin
                                </span>
                              ) : (
                                [...new Set(u._company_links.map(l => l.role))].slice(0, 2).map(r => {
                                  const rc = roleConfig(r);
                                  return (
                                    <span key={r} className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                                      style={{ background: `${rc.color}18`, color: rc.color }}>
                                      {rc.label}
                                    </span>
                                  );
                                })
                              )}
                              {u.is_active ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                                  style={{ background: "#d1fae5", color: "#047857" }}>
                                  <Check size={9} /> Activo
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-500">
                                  Inactivo
                                </span>
                              )}
                            </div>

                            {u._company_names.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2.5 pt-2.5 border-t border-gray-100">
                                {u._company_names.slice(0, 3).map(n => (
                                  <span key={n} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-100">
                                    {n}
                                  </span>
                                ))}
                                {u._company_names.length > 3 && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-50 text-gray-400 border border-gray-100">
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
            )}
          </div>
        </main>
      </div>

      {/* MODALS */}
      {showCompanyModal && (
        <CompanyModal company={editingCompany}
          onClose={() => setShowCompanyModal(false)}
          onSaved={reload} showToast={showToast} />
      )}
      {showUserModal && (
        <UserModal user={editingUser} companies={companies}
          onClose={() => setShowUserModal(false)}
          onSaved={reload} showToast={showToast} />
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}