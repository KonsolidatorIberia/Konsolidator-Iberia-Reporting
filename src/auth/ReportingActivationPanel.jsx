import { useState, useEffect, useMemo } from "react";
import {
  Zap, AlertTriangle, CheckCircle2, LogOut,
  ShieldAlert, Sparkles, Building2, Calendar, X,
} from "lucide-react";
import { activateReporting, getReportingStatus } from "../lib/supabaseClient";

const C = {
  navy:     "#1a2f8a",
  navyDark: "#0f1f5c",
  navyDeep: "#0a1647",
  red:      "#e8394a",
  redDark:  "#cf2c3d",
  amber:    "#fbbf24",
  amberDark:"#d97706",
  green:    "#34d399",
  greenDark:"#10b981",
};

// ════════════════════════════════════════════════════════════════
// Background atmospherics — same vibe as Login
// ════════════════════════════════════════════════════════════════
const NODES = [
  { angle:   0, delay:    0 },
  { angle:  60, delay:  200 },
  { angle: 120, delay:  400 },
  { angle: 180, delay:  600 },
  { angle: 240, delay:  800 },
  { angle: 300, delay: 1000 },
];

const EQUATIONS = [
  "EBITDA = Revenue − COGS − OpEx",
  "NPV = Σ CFₜ / (1+r)ᵗ",
  "WACC = (E/V)·Rₑ + (D/V)·R_d·(1−T)",
  "ROIC = NOPAT / Invested Capital",
  "FCF = EBIT(1−t) + D&A − ΔWC − CapEx",
  "P/E = Price / EPS",
  "Net Margin = NI / Revenue",
  "EV = MktCap + Debt − Cash",
];

const TICKERS = [
  { l: "EUR/USD",  v: "1.0942", c: "#fbbf24" },
  { l: "GROUP NI", v: "+12.3%", c: "#34d399" },
  { l: "EBITDA",   v: "+8.4%",  c: "#34d399" },
  { l: "ROIC",     v: "14.2%",  c: "#34d399" },
];

function ConsolidationGraph() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="-200 -200 400 400" preserveAspectRatio="xMidYMid slice"
      style={{ opacity: 0.4 }}>
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
              style={{ animation: `actDrawLine 3s ease-out ${n.delay}ms both, actFadeLine 6s ease-in-out ${n.delay + 3000}ms infinite` }} />
            <circle cx={x} cy={y} r="6" fill="rgba(255,255,255,0.15)"
              style={{ animation: `actPulseNode 4s ease-in-out ${n.delay}ms infinite` }} />
            <circle cx={x} cy={y} r="3" fill="#ffffff"
              style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))" }} />
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

// ════════════════════════════════════════════════════════════════
// MAIN PANEL — 5 states: initial, confirm, activating, success, error
// ════════════════════════════════════════════════════════════════
export default function ReportingActivationPanel({ email, password, onLogout, onActivated }) {
  const [phase, setPhase] = useState("initial");
  const [errorMsg, setErrorMsg] = useState("");
  const [activationResult, setActivationResult] = useState(null);

  const slug = useMemo(() => {
    const dom = email.split("@")[1] ?? "";
    return dom.split(".")[0].toLowerCase();
  }, [email]);
  const companyName = slug.charAt(0).toUpperCase() + slug.slice(1);

  // Lock body scroll while panel is up
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Block ESC so the panel can't be dismissed accidentally
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") e.preventDefault(); };
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

    const newStatus = await getReportingStatus(email, password);
    if (newStatus.status !== "active") {
      setErrorMsg("Activation created but we couldn't verify access. Please reload the page.");
      setPhase("error");
      return;
    }

    setPhase("success");
    setTimeout(() => onActivated(newStatus), 2500);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 50%, #7a9fef 70%, #d8e4ff 100%)",
      }}>

      <style>{`
        @keyframes actDrawLine { from { stroke-dashoffset: 280; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
        @keyframes actFadeLine { 0%, 100% { opacity: 0.18; } 50% { opacity: 0.4; } }
        @keyframes actPulseNode { 0%, 100% { r: 6; opacity: 0.15; } 50% { r: 9; opacity: 0.3; } }
        @keyframes actPulseHub { 0%, 100% { r: 14; opacity: 0.2; } 50% { r: 22; opacity: 0.4; } }
        @keyframes actFloat {
          0%, 100% { transform: translate(0, 0); }
          50%      { transform: translate(30px, -40px); }
        }
        @keyframes actDrift {
          0%   { transform: translateY(0)    rotate(0deg);   opacity: 0; }
          10%  {                              opacity: 0.45; }
          90%  {                              opacity: 0.45; }
          100% { transform: translateY(-80vh) rotate(8deg);  opacity: 0; }
        }
        @keyframes actSlideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes actFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes actPulseGlow {
          0%, 100% { box-shadow: 0 12px 28px -6px rgba(232,57,74,0.55), 0 0 0 0 rgba(232,57,74,0.4); }
          50%      { box-shadow: 0 12px 28px -6px rgba(232,57,74,0.55), 0 0 0 16px rgba(232,57,74,0); }
        }
        @keyframes actBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes actSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes actCheckPop {
          0%   { transform: scale(0);   opacity: 0; }
          60%  { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes actProgressShift {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .act-card {
          background: rgba(255,255,255,0.62);
          border: 1px solid rgba(255,255,255,0.85);
          backdrop-filter: blur(28px) saturate(150%);
          -webkit-backdrop-filter: blur(28px) saturate(150%);
          border-radius: 36px;
          box-shadow: 0 40px 100px -20px rgba(15,31,92,0.4), 0 12px 32px -10px rgba(15,31,92,0.2);
        }
        .act-equation {
          font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace;
          color: rgba(255,255,255,0.45);
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .act-ticker {
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
      `}</style>

      {/* Ambient blobs */}
      <div className="absolute top-[10%] left-[8%] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
          filter: "blur(60px)",
          animation: "actFloat 22s ease-in-out infinite",
        }} />
      <div className="absolute top-[30%] right-[6%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(168,197,255,0.5), transparent 65%)",
          filter: "blur(70px)",
        }} />

      {/* Grain */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />

      {/* Consolidation graph centerpiece */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[700px] h-[700px] opacity-60">
          <ConsolidationGraph />
        </div>
      </div>

      {/* Drifting equations */}
      {EQUATIONS.map((eq, i) => {
        const left = (i * 17 + 5) % 90;
        const dur = 28 + (i % 7) * 3;
        const delay = -((i * 2.2) % dur);
        const size = 11 + (i % 4);
        return (
          <div key={`eq-${i}`}
            className="act-equation absolute pointer-events-none"
            style={{
              bottom: "-10%",
              left: `${left}%`,
              fontSize: size,
              animation: `actDrift ${dur}s linear ${delay}s infinite`,
            }}>
            {eq}
          </div>
        );
      })}

      {/* Ticker chips */}
      <div className="absolute top-[8%] right-[4%] flex flex-col gap-2 items-end pointer-events-none">
        {TICKERS.slice(0, 2).map((t, i) => (
          <div key={`tk-top-${i}`} className="act-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#34d399", animation: "actBlink 1.6s ease-in-out infinite" }} />
          </div>
        ))}
      </div>
      <div className="absolute bottom-[10%] left-[4%] flex flex-col gap-2 pointer-events-none">
        {TICKERS.slice(2, 4).map((t, i) => (
          <div key={`tk-bot-${i}`} className="act-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
          </div>
        ))}
      </div>

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-10 py-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-xs tracking-[0.2em]">KONSOLIDATOR</span>
        </div>
      </header>

      {/* ─── CARD ─────────────────────────────────────────── */}
      <div className="relative z-10 act-card w-full max-w-lg mx-4 flex flex-col overflow-hidden"
        style={{
          animation: "actSlideUp 0.5s cubic-bezier(0.34,1.56,0.64,1) both",
          maxHeight: "88vh",
        }}>

        {/* ═══ STATE: INITIAL ═══ */}
        {phase === "initial" && (
          <>
            <div className="p-10 overflow-y-auto flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-3"
                style={{ color: C.red }}>
                Access restricted
              </p>

              <div className="flex items-start gap-4 mb-5">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)`,
                    boxShadow: `0 12px 28px -6px ${C.navy}60`,
                  }}>
                  <ShieldAlert size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[#0a1647] font-black tracking-tight leading-[1.05]"
                    style={{ fontSize: "clamp(26px, 2.6vw, 32px)" }}>
                    Reporting<br />
                    <span style={{ color: C.red }}>not activated.</span>
                  </h2>
                </div>
              </div>

              <p className="text-[#1a2f8a]/75 text-sm leading-relaxed font-medium mb-5">
                Your <span className="font-black" style={{ color: C.navyDeep }}>Konsolidator</span> account is validated,
                but the <span className="font-black" style={{ color: C.navyDeep }}>Reporting</span> extension is not
                available for you yet.
              </p>

              {/* Trial highlight card */}
              <div className="rounded-2xl p-4 mb-4"
                style={{
                  background: `${C.red}10`,
                  border: `1px solid ${C.red}30`,
                }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                      color: "#fff",
                      boxShadow: `0 8px 18px -4px ${C.red}60`,
                    }}>
                    <Sparkles size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-black" style={{ color: C.navyDeep }}>
                      Activate a free trial
                    </p>
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: `${C.navy}80` }}>
                      5 days of full access to every feature. No card, no commitment.
                    </p>
                  </div>
                </div>
              </div>

              {/* Company info */}
              <div className="rounded-2xl p-4 space-y-2"
                style={{
                  background: "rgba(255,255,255,0.45)",
                  border: "1px solid rgba(26,47,138,0.12)",
                }}>
                <div className="flex items-center gap-2 text-xs">
                  <Building2 size={12} style={{ color: `${C.navy}55` }} />
                  <span className="font-medium" style={{ color: `${C.navy}65` }}>Company:</span>
                  <span className="font-black" style={{ color: C.navyDeep }}>{companyName}</span>
                </div>
                <div className="flex items-center gap-2 text-xs ml-[18px]">
                  <span className="font-medium" style={{ color: `${C.navy}65` }}>Email:</span>
                  <span className="font-mono" style={{ color: `${C.navy}80` }}>{email}</span>
                </div>
              </div>
            </div>

            <div className="px-10 py-5 flex items-center gap-3 border-t"
              style={{ borderColor: "rgba(26,47,138,0.1)", background: "rgba(255,255,255,0.3)" }}>
              <button onClick={onLogout}
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-black transition-colors hover:bg-white/60"
                style={{ color: `${C.navy}70` }}>
                <LogOut size={12} />
                Sign out
              </button>
              <button onClick={handleStartConfirm}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-black text-white transition-all hover:scale-[1.02]"
                style={{
                  background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                  animation: "actPulseGlow 2.5s ease-in-out infinite",
                }}>
                <Zap size={14} />
                Activate 5-day trial
              </button>
            </div>
          </>
        )}

        {/* ═══ STATE: CONFIRM ═══ */}
        {phase === "confirm" && (
          <>
            <div className="p-10 overflow-y-auto flex-1"
              style={{ animation: "actFadeIn 0.4s ease-out both" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-3"
                style={{ color: C.amberDark }}>
                Confirmation required
              </p>

              <div className="flex items-start gap-4 mb-5">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${C.amber} 0%, ${C.amberDark} 100%)`,
                    boxShadow: `0 12px 28px -6px ${C.amber}60`,
                  }}>
                  <AlertTriangle size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[#0a1647] font-black tracking-tight leading-[1.05]"
                    style={{ fontSize: "clamp(26px, 2.6vw, 32px)" }}>
                    This affects<br />
                    <span style={{ color: C.amberDark }}>the entire company.</span>
                  </h2>
                </div>
              </div>

              <p className="text-[#1a2f8a]/75 text-sm leading-relaxed font-medium mb-5">
                When you activate the trial, <span className="font-black" style={{ color: C.navyDeep }}>all users</span> at
                <span className="font-black" style={{ color: C.navy }}> {companyName}</span> will share
                the same 5-day full access window.
              </p>

              {/* Warning bullets */}
              <div className="rounded-2xl p-4 space-y-3 mb-4"
                style={{
                  background: `${C.amber}15`,
                  border: `1px solid ${C.amber}40`,
                }}>
                {[
                  { icon: Calendar,     title: "Fixed duration: 5 days",   desc: "Starts now and can't be paused" },
                  { icon: X,            title: "Cannot be reactivated",    desc: "Once it expires, the company needs to subscribe" },
                  { icon: ShieldAlert,  title: "Irreversible action",      desc: "Cannot be undone after confirmation" },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <item.icon size={14} style={{ color: C.amberDark }} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-black" style={{ color: C.amberDark }}>{item.title}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: `${C.amberDark}cc` }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-center font-medium" style={{ color: `${C.navy}65` }}>
                Do you want to proceed with the activation?
              </p>
            </div>

            <div className="px-10 py-5 flex items-center gap-3 border-t"
              style={{ borderColor: "rgba(26,47,138,0.1)", background: "rgba(255,255,255,0.3)" }}>
              <button onClick={handleBack}
                className="flex-1 px-4 py-3 rounded-xl text-xs font-black transition-colors hover:bg-white/60"
                style={{ color: `${C.navy}70` }}>
                Cancel
              </button>
              <button onClick={handleActivate}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-black text-white transition-all hover:scale-[1.02]"
                style={{
                  background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                  boxShadow: `0 8px 20px -4px ${C.red}80`,
                }}>
                <Zap size={12} />
                Confirm and activate
              </button>
            </div>
          </>
        )}

        {/* ═══ STATE: ACTIVATING ═══ */}
        {phase === "activating" && (
          <div className="p-12 flex flex-col items-center text-center"
            style={{ animation: "actFadeIn 0.4s ease-out both", minHeight: 400 }}>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
              style={{
                background: `linear-gradient(135deg, ${C.navy}15, ${C.red}15)`,
                border: `2px solid ${C.navy}25`,
              }}>
              <div className="w-12 h-12 rounded-full border-4"
                style={{
                  borderColor: "rgba(26,47,138,0.15)",
                  borderTopColor: C.red,
                  animation: "actSpin 1s linear infinite",
                }} />
            </div>
            <h3 className="text-2xl font-black mb-2" style={{ color: C.navyDeep }}>
              Setting up your account…
            </h3>
            <p className="text-sm leading-relaxed max-w-[300px]" style={{ color: `${C.navy}65` }}>
              Creating company, assigning permissions and activating your 5-day trial
            </p>
            <div className="mt-8 w-full max-w-[280px]">
              <div className="h-1.5 rounded-full overflow-hidden relative"
                style={{ background: "rgba(26,47,138,0.1)" }}>
                <div className="absolute inset-y-0 w-1/2 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${C.navy}, ${C.red}, ${C.navy})`,
                    animation: "actProgressShift 1.6s ease-in-out infinite",
                  }} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ STATE: SUCCESS ═══ */}
        {phase === "success" && (
          <div className="p-12 flex flex-col items-center text-center"
            style={{ animation: "actFadeIn 0.4s ease-out both", minHeight: 400 }}>
            <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
              style={{
                background: `linear-gradient(135deg, ${C.green}, ${C.greenDark})`,
                animation: "actCheckPop 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
                boxShadow: `0 12px 32px -4px ${C.green}80`,
              }}>
              <CheckCircle2 size={40} className="text-white" />
            </div>
            <h3 className="text-3xl font-black mb-2" style={{ color: C.navyDeep, animation: "actFadeIn 0.5s ease-out 0.3s both" }}>
              Welcome!
            </h3>
            <p className="text-sm leading-relaxed max-w-[320px]"
              style={{ color: `${C.navy}75`, animation: "actFadeIn 0.5s ease-out 0.5s both" }}>
              Your <span className="font-black">5-day trial</span> is active.
              Loading your dashboard…
            </p>
            {activationResult?.isNewCompany && (
              <p className="mt-4 text-[11px] font-medium"
                style={{ color: `${C.navy}55`, animation: "actFadeIn 0.5s ease-out 0.7s both" }}>
                Company <span className="font-black" style={{ color: C.navy }}>{activationResult.companyName}</span> created
              </p>
            )}
          </div>
        )}

        {/* ═══ STATE: ERROR ═══ */}
        {phase === "error" && (
          <>
            <div className="p-12 flex flex-col items-center text-center" style={{ minHeight: 350 }}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
                style={{
                  background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDark} 100%)`,
                  boxShadow: `0 12px 28px -6px ${C.red}60`,
                }}>
                <AlertTriangle size={32} className="text-white" />
              </div>
              <h3 className="text-2xl font-black mb-2" style={{ color: C.navyDeep }}>
                Activation failed
              </h3>
              <p className="text-sm leading-relaxed max-w-[340px] mb-2" style={{ color: `${C.navy}65` }}>
                We couldn't complete the activation. Please try again.
              </p>
              {errorMsg && (
                <p className="text-[11px] font-mono px-3 py-2 rounded-lg max-w-[340px] break-words"
                  style={{
                    color: C.redDark,
                    background: `${C.red}10`,
                    border: `1px solid ${C.red}25`,
                  }}>
                  {errorMsg}
                </p>
              )}
            </div>
            <div className="px-10 py-5 flex items-center gap-3 border-t"
              style={{ borderColor: "rgba(26,47,138,0.1)", background: "rgba(255,255,255,0.3)" }}>
              <button onClick={onLogout}
                className="flex-1 px-4 py-3 rounded-xl text-xs font-black transition-colors hover:bg-white/60"
                style={{ color: `${C.navy}70` }}>
                Sign out
              </button>
              <button onClick={() => setPhase("initial")}
                className="flex-1 px-6 py-3 rounded-xl text-xs font-black text-white transition-all hover:scale-[1.02]"
                style={{
                  background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDark} 100%)`,
                  boxShadow: `0 8px 20px -4px ${C.navy}60`,
                }}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 left-0 right-0 text-center pointer-events-none">
        <span className="text-[10px] text-white/60 tracking-widest font-bold">
          POWERED BY KONSOLIDATOR® · IFRS CONSOLIDATED REPORTING
        </span>
      </div>
    </div>
  );
}