import React, { useState, useEffect, useMemo } from "react";
import {
  Zap, AlertTriangle, CheckCircle2, Loader2, LogOut,
  ShieldAlert, Sparkles, Building2, Calendar, X,
} from "lucide-react";
import { activateReporting, getReportingStatus } from "../lib/supabaseClient";

const C = {
  navy:     "#1a2f8a",
  navyDark: "#0f1f5c",
  red:      "#e8394a",
  redDark:  "#cf2c3d",
  amber:    "#fbbf24",
  green:    "#34d399",
};

// ════════════════════════════════════════════════════════════════
// CINEMATIC BACKGROUND (subset of the login layers)
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
    <svg className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="-200 -200 400 400" preserveAspectRatio="xMidYMid slice"
      style={{ opacity: 0.5 }}>
      <circle cx="0" cy="0" r="160" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <circle cx="0" cy="0" r="120" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 4" />
      <circle cx="0" cy="0" r="80"  fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      {NODES.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const x = Math.cos(rad) * 140;
        const y = Math.sin(rad) * 140;
        return (
          <g key={i}>
            <line x1={x} y1={y} x2="0" y2="0"
              stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="280"
              style={{ animation: `actDrawLine 3s ease-out ${n.delay}ms both` }} />
            <circle cx={x} cy={y} r="6" fill="rgba(255,255,255,0.15)"
              style={{ animation: `actPulseNode 4s ease-in-out ${n.delay}ms infinite` }} />
            <circle cx={x} cy={y} r="3" fill="#ffffff"
              style={{ animation: `actNodeAppear 600ms ease-out ${n.delay + 500}ms both`,
                       filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))" }} />
          </g>
        );
      })}
      <circle cx="0" cy="0" r="14" fill="rgba(232,57,74,0.2)"
        style={{ animation: "actPulseHub 3s ease-in-out infinite" }} />
      <circle cx="0" cy="0" r="8" fill="#e8394a"
        style={{ filter: "drop-shadow(0 0 12px rgba(232,57,74,0.8))" }} />
    </svg>
  );
}

function Particles() {
  const particles = Array.from({ length: 18 }, (_, i) => i);
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
              animation: `actFloatParticle ${dur}s ease-in-out ${delay}ms infinite`,
            }} />
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN PANEL — 4 states: initial, confirm, activating, success
// ════════════════════════════════════════════════════════════════
export default function ReportingActivationPanel({ email, password, onLogout, onActivated }) {
  const [phase, setPhase] = useState("initial"); // initial | confirm | activating | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const [activationResult, setActivationResult] = useState(null);

  // Slug derivado del email
  const slug = useMemo(() => {
    const dom = email.split("@")[1] ?? "";
    return dom.split(".")[0].toLowerCase();
  }, [email]);
  const companyName = slug.charAt(0).toUpperCase() + slug.slice(1);

  // Bloquear scroll del body mientras el panel está activo
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Bloquear ESC y otros atajos para que NO se pueda cerrar
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleStartConfirm = () => setPhase("confirm");
  const handleBack = () => setPhase("initial");

  const handleActivate = async () => {
    setPhase("activating");
    setErrorMsg("");

    const result = await activateReporting(email, password);
    if (!result.ok) {
      setErrorMsg(result.error);
      setPhase("error");
      return;
    }

    setActivationResult(result);

    // Re-comprobar el status para conseguir el user/company actualizados
    const newStatus = await getReportingStatus(email, password);
    if (newStatus.status !== "active") {
      setErrorMsg("Activación creada pero no se pudo verificar acceso. Recarga la página.");
      setPhase("error");
      return;
    }

    setPhase("success");
    // Auto-redirige a la app después de 2.5s
    setTimeout(() => onActivated(newStatus), 2500);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: C.navy }}>

      <style>{`
        @keyframes actDrawLine { from { stroke-dashoffset: 280; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
        @keyframes actNodeAppear { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes actPulseNode { 0%, 100% { r: 6; opacity: 0.15; } 50% { r: 9; opacity: 0.3; } }
        @keyframes actPulseHub { 0%, 100% { r: 14; opacity: 0.2; } 50% { r: 22; opacity: 0.4; } }
        @keyframes actFloatParticle {
          0%, 100% { transform: translate(0, 0); opacity: 0.4; }
          50% { transform: translate(20px, -30px); opacity: 0.8; }
        }
        @keyframes actSlideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes actFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes actPulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(232,57,74,0.4); }
          50% { box-shadow: 0 0 0 16px rgba(232,57,74,0); }
        }
        @keyframes actSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes actCheckPop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Background blur orbs */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-white opacity-[0.04]" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-white opacity-[0.04]" />
      <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] rounded-full opacity-[0.08]"
        style={{ background: C.red, filter: "blur(80px)" }} />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-full h-full max-w-[900px] max-h-[900px]">
          <ConsolidationGraph />
        </div>
      </div>

      <Particles />

      {/* MAIN CARD */}
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-[40px] bg-white overflow-hidden flex flex-col"
        style={{
          boxShadow: "0 40px 100px -20px rgba(0,0,0,0.6), 0 0 80px rgba(232,57,74,0.2)",
          animation: "actSlideUp 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
          maxHeight: "92vh",
        }}>

        {/* ════ STATE: INITIAL ════ */}
        {phase === "initial" && (
          <>
            <div className="relative px-9 py-8 overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white opacity-[0.08] blur-2xl" />
              <div className="absolute -bottom-20 -left-10 w-40 h-40 rounded-full opacity-[0.15] blur-2xl"
                style={{ background: C.red }} />

              <div className="relative z-10">
                <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-5 shadow-2xl"
                  style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.2)" }}>
                  <ShieldAlert size={26} className="text-white" />
                </div>
                <p className="text-blue-300 text-[10px] font-black tracking-[0.22em] uppercase mb-2">
                  Acceso restringido
                </p>
                <h2 className="text-3xl font-black text-white leading-tight">
                  Reporting<br />
                  <span style={{ color: C.red }}>no activado.</span>
                </h2>
              </div>
            </div>

            <div className="p-9 space-y-5 overflow-y-auto flex-1">
              <p className="text-gray-700 text-sm leading-relaxed">
                Tu cuenta de <span className="font-black text-gray-900">Konsolidator</span> está validada,
                pero la extensión de <span className="font-black text-gray-900">Reporting</span> no está
                disponible para ti todavía.
              </p>

              <div className="rounded-2xl p-5 relative overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${C.red}10 0%, ${C.red}05 100%)`,
                  border: `2px solid ${C.red}30`,
                }}>
                <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-20 blur-xl"
                  style={{ background: C.red }} />
                <div className="relative z-10 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: C.red, color: "#fff", boxShadow: `0 8px 20px ${C.red}50` }}>
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-900">Activa una prueba gratuita</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      5 días de acceso completo a todas las funcionalidades.
                      Sin tarjeta, sin compromiso.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 p-4 space-y-2 border border-gray-100">
                <div className="flex items-center gap-2 text-xs">
                  <Building2 size={12} className="text-gray-400" />
                  <span className="text-gray-500 font-medium">Empresa:</span>
                  <span className="font-black text-gray-800">{companyName}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 font-medium ml-[18px]">Email:</span>
                  <span className="font-mono text-gray-700">{email}</span>
                </div>
              </div>
            </div>

            <div className="px-9 py-5 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
              <button onClick={onLogout}
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-black text-gray-500 hover:bg-gray-100 transition-colors">
                <LogOut size={12} />
                Cerrar sesión
              </button>
              <button onClick={handleStartConfirm}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-black text-white transition-all hover:scale-[1.02] shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                  boxShadow: `0 12px 28px -6px ${C.red}80`,
                  animation: "actPulseGlow 2.5s ease-in-out infinite",
                }}>
                <Zap size={14} />
                Activar prueba de 5 días
              </button>
            </div>
          </>
        )}

        {/* ════ STATE: CONFIRM ════ */}
        {phase === "confirm" && (
          <>
            <div className="relative px-9 py-8 overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${C.amber} 0%, #d97706 100%)` }}>
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white opacity-[0.15] blur-2xl" />

              <div className="relative z-10">
                <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-5"
                  style={{ background: "rgba(255,255,255,0.25)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.3)" }}>
                  <AlertTriangle size={26} className="text-white" />
                </div>
                <p className="text-amber-50 text-[10px] font-black tracking-[0.22em] uppercase mb-2">
                  Confirmación requerida
                </p>
                <h2 className="text-3xl font-black text-white leading-tight">
                  Esto afecta a<br />
                  toda la empresa.
                </h2>
              </div>
            </div>

            <div className="p-9 space-y-4 overflow-y-auto flex-1"
              style={{ animation: "actFadeIn 0.4s ease-out both" }}>
              <p className="text-gray-700 text-sm leading-relaxed">
                Al activar la prueba, <span className="font-black">todos los usuarios</span> de
                la empresa <span className="font-black" style={{ color: C.navy }}>{companyName}</span> compartirán
                el mismo periodo de 5 días de acceso completo.
              </p>

              <div className="rounded-2xl p-4 space-y-3"
                style={{ background: "#fef3c7", border: "2px solid #fcd34d" }}>
                <div className="flex items-start gap-3">
                  <Calendar size={14} className="text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-black text-amber-900">Duración fija: 5 días</p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      El periodo empieza ahora y no se puede pausar
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <X size={14} className="text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-black text-amber-900">No se puede reactivar</p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      Una vez expire, la empresa necesitará contratar un plan
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ShieldAlert size={14} className="text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-black text-amber-900">Acción irreversible</p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      No se puede deshacer una vez confirmes
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-gray-500 text-center font-medium">
                ¿Quieres proceder con la activación?
              </p>
            </div>

            <div className="px-9 py-5 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
              <button onClick={handleBack}
                className="flex-1 px-4 py-3 rounded-xl text-xs font-black text-gray-600 hover:bg-gray-100 transition-colors">
                Cancelar
              </button>
              <button onClick={handleActivate}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-black text-white transition-all hover:scale-[1.02] shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                  boxShadow: `0 8px 20px -4px ${C.red}80`,
                }}>
                <Zap size={12} />
                Confirmar y activar
              </button>
            </div>
          </>
        )}

        {/* ════ STATE: ACTIVATING ════ */}
        {phase === "activating" && (
          <div className="p-12 flex flex-col items-center text-center"
            style={{ animation: "actFadeIn 0.4s ease-out both", minHeight: 400 }}>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
              style={{
                background: `linear-gradient(135deg, ${C.navy}10, ${C.red}10)`,
                border: `2px solid ${C.navy}20`,
              }}>
              <div className="w-12 h-12 rounded-full border-4 border-gray-200"
                style={{
                  borderTopColor: C.red,
                  animation: "actSpin 1s linear infinite",
                }} />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">
              Configurando tu cuenta…
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[300px]">
              Creando empresa, asignando permisos y activando la prueba de 5 días
            </p>
            <div className="mt-8 w-full max-w-[280px]">
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${C.navy}, ${C.red})`,
                    animation: "actSlideUp 2s ease-in-out infinite alternate",
                    width: "70%",
                  }} />
              </div>
            </div>
          </div>
        )}

        {/* ════ STATE: SUCCESS ════ */}
        {phase === "success" && (
          <div className="p-12 flex flex-col items-center text-center"
            style={{ animation: "actFadeIn 0.4s ease-out both", minHeight: 400 }}>
            <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${C.green}, #10b981)`,
                animation: "actCheckPop 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
                boxShadow: `0 12px 32px -4px ${C.green}80`,
              }}>
              <CheckCircle2 size={40} className="text-white" />
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-2"
              style={{ animation: "actFadeIn 0.5s ease-out 0.3s both" }}>
              ¡Bienvenido!
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed max-w-[320px]"
              style={{ animation: "actFadeIn 0.5s ease-out 0.5s both" }}>
              Tu prueba de <span className="font-black">5 días</span> está activa.
              Cargando tu dashboard…
            </p>
            {activationResult?.isNewCompany && (
              <p className="mt-4 text-[11px] text-gray-400 font-medium"
                style={{ animation: "actFadeIn 0.5s ease-out 0.7s both" }}>
                Empresa <span className="font-black" style={{ color: C.navy }}>{activationResult.companyName}</span> creada
              </p>
            )}
          </div>
        )}

        {/* ════ STATE: ERROR ════ */}
        {phase === "error" && (
          <>
            <div className="p-12 flex flex-col items-center text-center" style={{ minHeight: 350 }}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5 bg-red-100">
                <AlertTriangle size={32} className="text-red-600" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">
                Error en la activación
              </h3>
              <p className="text-sm text-gray-500 leading-relaxed max-w-[340px] mb-2">
                No se pudo completar la activación. Por favor inténtalo de nuevo.
              </p>
              {errorMsg && (
                <p className="text-[11px] text-red-600 font-mono bg-red-50 px-3 py-2 rounded-lg max-w-[340px] break-words">
                  {errorMsg}
                </p>
              )}
            </div>
            <div className="px-9 py-5 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
              <button onClick={onLogout}
                className="flex-1 px-4 py-3 rounded-xl text-xs font-black text-gray-600 hover:bg-gray-100 transition-colors">
                Cerrar sesión
              </button>
              <button onClick={() => setPhase("initial")}
                className="flex-1 px-6 py-3 rounded-xl text-xs font-black text-white transition-all hover:scale-[1.02] shadow-lg"
                style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)` }}>
                Reintentar
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}