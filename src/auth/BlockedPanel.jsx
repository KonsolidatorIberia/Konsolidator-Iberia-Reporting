import React, { useEffect } from "react";
import { Lock, Clock, AlertCircle, LogOut, Mail } from "lucide-react";

const C = {
  navy:     "#1a2f8a",
  navyDark: "#0f1f5c",
  red:      "#e8394a",
  amber:    "#fbbf24",
};

const VARIANTS = {
  inactive: {
    icon: Lock,
    accent: "#94a3b8",
    accentDark: "#64748b",
    eyebrow: "Cuenta desactivada",
    title: "Acceso bloqueado.",
    description: "Tu cuenta de Reporting ha sido desactivada por un administrador.",
    cta: "Contacta con tu administrador para reactivar el acceso.",
    contactEmail: null, // Sin email específico, solo mensaje
  },
  trial_expired: {
    icon: Clock,
    accent: C.amber,
    accentDark: "#d97706",
    eyebrow: "Prueba expirada",
    title: "Tu trial ha terminado.",
    description: "El periodo de 5 días de prueba ha finalizado.",
    cta: "Contacta con el equipo de ventas para contratar un plan.",
    contactEmail: "sales@konsolidator.com",
  },
  error: {
    icon: AlertCircle,
    accent: C.red,
    accentDark: "#cf2c3d",
    eyebrow: "Error técnico",
    title: "No pudimos verificar tu acceso.",
    description: "Ha ocurrido un error al comprobar tu cuenta.",
    cta: "Por favor, inténtalo de nuevo o contacta con soporte.",
    contactEmail: "support@konsolidator.com",
  },
};

export default function BlockedPanel({ variant = "inactive", email, company, message, onLogout }) {
  const v = VARIANTS[variant] ?? VARIANTS.error;
  const Icon = v.icon;

  // Bloquear scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: C.navy }}>

      <style>{`
        @keyframes blkSlideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes blkPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes blkFloat {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(15px, -20px); }
        }
      `}</style>

      {/* Background */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-white opacity-[0.04]" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-white opacity-[0.04]" />
      <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] rounded-full opacity-[0.06]"
        style={{ background: v.accent, filter: "blur(80px)" }} />

      {/* Floating particles minimal */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => {
          const top = (i * 47) % 100;
          const left = (i * 23) % 100;
          return (
            <span key={i} className="absolute rounded-full bg-white"
              style={{
                width: 1 + (i % 3), height: 1 + (i % 3),
                top: `${top}%`, left: `${left}%`,
                opacity: 0.3, filter: "blur(0.5px)",
                animation: `blkFloat ${8 + i % 4}s ease-in-out ${i * 300}ms infinite`,
              }} />
          );
        })}
      </div>

      <div className="relative z-10 w-full max-w-md mx-4 rounded-[40px] bg-white overflow-hidden flex flex-col"
        style={{
          boxShadow: "0 40px 100px -20px rgba(0,0,0,0.6)",
          animation: "blkSlideUp 0.5s cubic-bezier(0.34,1.56,0.64,1) both",
        }}>

        {/* Header */}
        <div className="relative px-9 py-8 overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${v.accent} 0%, ${v.accentDark} 100%)` }}>
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white opacity-[0.12] blur-2xl" />

          <div className="relative z-10">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-5"
              style={{
                background: "rgba(255,255,255,0.2)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.3)",
                animation: "blkPulse 2.5s ease-in-out infinite",
              }}>
              <Icon size={26} className="text-white" />
            </div>
            <p className="text-white/70 text-[10px] font-black tracking-[0.22em] uppercase mb-2">
              {v.eyebrow}
            </p>
            <h2 className="text-3xl font-black text-white leading-tight">
              {v.title}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="p-9 space-y-4">
          <p className="text-gray-700 text-sm leading-relaxed">
            {v.description}
          </p>

          {variant === "trial_expired" && company && (
            <div className="rounded-2xl bg-gray-50 p-4 border border-gray-100 space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Empresa
              </p>
              <p className="text-sm font-black text-gray-800">{company.name}</p>
              {company.trial_ends_at && (
                <p className="text-[11px] text-gray-500">
                  Expirada el {new Date(company.trial_ends_at).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
                </p>
              )}
            </div>
          )}

          {email && variant !== "trial_expired" && (
            <div className="rounded-2xl bg-gray-50 p-4 border border-gray-100 flex items-center gap-2">
              <Mail size={12} className="text-gray-400 shrink-0" />
              <span className="text-xs font-mono text-gray-600 truncate">{email}</span>
            </div>
          )}

          {message && (
            <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
              <p className="text-[11px] text-red-700 font-mono break-words">{message}</p>
            </div>
          )}

          <div className="rounded-2xl p-4"
            style={{ background: `${v.accent}10`, border: `1px solid ${v.accent}30` }}>
            <p className="text-xs leading-relaxed font-medium" style={{ color: v.accentDark }}>
              {v.cta}
            </p>
            {v.contactEmail && (
              <a href={`mailto:${v.contactEmail}`}
                className="inline-flex items-center gap-1.5 text-xs font-black mt-2 transition-colors hover:underline"
                style={{ color: v.accentDark }}>
                <Mail size={11} />
                {v.contactEmail}
              </a>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-9 py-5 bg-gray-50 border-t border-gray-100">
          <button onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black text-gray-600 hover:bg-gray-100 transition-colors">
            <LogOut size={12} />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}