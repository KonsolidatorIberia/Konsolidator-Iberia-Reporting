import { useEffect } from "react";
import { Lock, Clock, AlertCircle, LogOut, Mail, UserX } from "lucide-react";

const C = {
  navy:     "#1a2f8a",
  navyDark: "#0f1f5c",
  navyDeep: "#0a1647",
  red:      "#e8394a",
  redDark:  "#cf2c3d",
  amber:    "#fbbf24",
};

const VARIANTS = {
  inactive: {
    icon: Lock,
    accent: "#64748b",
    accentDark: "#475569",
    eyebrow: "Account deactivated",
    title: "Access blocked.",
    description: "Your Reporting account has been deactivated by an administrator.",
    cta: "Contact your administrator to restore access.",
    contactEmail: null,
  },
  no_account: {
    icon: UserX,
    accent: "#1a2f8a",
    accentDark: "#0f1f5c",
    eyebrow: "No reporting account",
    title: "You don't have access yet.",
    description: "Your company uses Konsolidator Reporting, but no user account has been created for you.",
    cta: "Contact your company administrator to request access.",
    contactEmail: null,
  },
  trial_expired: {
    icon: Clock,
    accent: C.amber,
    accentDark: "#d97706",
    eyebrow: "Trial expired",
    title: "Your trial has ended.",
    description: "The 5-day trial period has finished.",
    cta: "Contact our sales team to subscribe to a plan.",
    contactEmail: "sales@konsolidator.com",
  },
  error: {
    icon: AlertCircle,
    accent: C.red,
    accentDark: C.redDark,
    eyebrow: "Technical error",
    title: "We couldn't verify your access.",
    description: "Something went wrong while checking your account.",
    cta: "Please try again or contact support.",
    contactEmail: "support@konsolidator.com",
  },
};

/* ─── Orbiting consolidation graph (same as Login) ─── */
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
      style={{ opacity: 0.35 }}
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
            style={{ animation: `blkDrawLine 3s ease-out ${n.delay}ms both, blkFadeLine 6s ease-in-out ${n.delay + 3000}ms infinite` }} />
        );
      })}

      {NODES.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const x = Math.cos(rad) * 140;
        const y = Math.sin(rad) * 140;
        return (
          <g key={`node-${i}`}>
            <circle cx={x} cy={y} r="6" fill="rgba(255,255,255,0.15)"
              style={{ animation: `blkPulseNode 4s ease-in-out ${n.delay}ms infinite` }} />
            <circle cx={x} cy={y} r="3" fill="#ffffff"
              style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))" }} />
          </g>
        );
      })}

      <circle cx="0" cy="0" r="14" fill="rgba(232,57,74,0.2)"
        style={{ animation: "blkPulseHub 3s ease-in-out infinite" }} />
      <circle cx="0" cy="0" r="8" fill="#e8394a"
        style={{ filter: "drop-shadow(0 0 12px rgba(232,57,74,0.8))" }} />
    </svg>
  );
}

/* ─── Drifting equations (same vibe as Login) ─── */
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

/* ─── Ticker chips (anchored) ─── */
const TICKERS = [
  { l: "EUR/USD",  v: "1.0942", c: "#fbbf24" },
  { l: "GROUP NI", v: "+12.3%", c: "#34d399" },
  { l: "EBITDA",   v: "+8.4%",  c: "#34d399" },
  { l: "ROIC",     v: "14.2%",  c: "#34d399" },
];

export default function BlockedPanel({ variant = "inactive", email, company, message, onLogout }) {
  const v = VARIANTS[variant] ?? VARIANTS.error;
  const Icon = v.icon;

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 50%, #7a9fef 70%, #d8e4ff 100%)",
      }}>

      <style>{`
        @keyframes blkSlideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes blkFloat {
          0%, 100% { transform: translate(0, 0); }
          50%      { transform: translate(30px, -40px); }
        }
        @keyframes blkPulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
        @keyframes blkDrift {
          0%   { transform: translateY(0)    rotate(0deg);   opacity: 0; }
          10%  {                              opacity: 0.45; }
          90%  {                              opacity: 0.45; }
          100% { transform: translateY(-80vh) rotate(8deg);  opacity: 0; }
        }
        @keyframes blkDrawLine {
          from { stroke-dashoffset: 280; opacity: 0; }
          to   { stroke-dashoffset: 0;   opacity: 1; }
        }
        @keyframes blkFadeLine {
          0%, 100% { opacity: 0.18; }
          50%      { opacity: 0.4;  }
        }
        @keyframes blkPulseNode {
          0%, 100% { r: 6; opacity: 0.15; }
          50%      { r: 9; opacity: 0.3;  }
        }
        @keyframes blkPulseHub {
          0%, 100% { r: 14; opacity: 0.2; }
          50%      { r: 22; opacity: 0.4; }
        }
        @keyframes blkBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        .blk-card {
          background: rgba(255,255,255,0.62);
          border: 1px solid rgba(255,255,255,0.85);
          backdrop-filter: blur(28px) saturate(150%);
          -webkit-backdrop-filter: blur(28px) saturate(150%);
          border-radius: 36px;
          box-shadow: 0 40px 100px -20px rgba(15,31,92,0.4), 0 12px 32px -10px rgba(15,31,92,0.2);
        }
        .blk-equation {
          font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace;
          color: rgba(255,255,255,0.45);
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .blk-ticker {
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
        .blk-title-glow {
          text-shadow: 0 0 40px rgba(255,255,255,0.5), 0 0 80px rgba(168,197,255,0.6);
        }
      `}</style>

      {/* Ambient blobs */}
      <div className="absolute top-[10%] left-[8%] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
          filter: "blur(60px)",
          animation: "blkFloat 22s ease-in-out infinite",
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
            className="blk-equation absolute pointer-events-none"
            style={{
              bottom: "-10%",
              left: `${left}%`,
              fontSize: size,
              animation: `blkDrift ${dur}s linear ${delay}s infinite`,
            }}>
            {eq}
          </div>
        );
      })}

      {/* Ticker chips top-right */}
      <div className="absolute top-[8%] right-[4%] flex flex-col gap-2 items-end pointer-events-none">
        {TICKERS.slice(0, 2).map((t, i) => (
          <div key={`tk-top-${i}`} className="blk-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#34d399", animation: "blkBlink 1.6s ease-in-out infinite" }} />
          </div>
        ))}
      </div>

      {/* Ticker chips bottom-left */}
      <div className="absolute bottom-[10%] left-[4%] flex flex-col gap-2 pointer-events-none">
        {TICKERS.slice(2, 4).map((t, i) => (
          <div key={`tk-bot-${i}`} className="blk-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
          </div>
        ))}
      </div>

      {/* Top bar — minimal brand */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-10 py-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-xs tracking-[0.2em]">KONSOLIDATOR</span>
        </div>
      </header>

      {/* ─── CARD ─────────────────────────────────────────── */}
      <div className="relative z-10 blk-card w-full max-w-md mx-4 p-10 flex flex-col"
        style={{ animation: "blkSlideUp 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}>

        {/* Eyebrow */}
        <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-3"
          style={{ color: v.accent }}>
          {v.eyebrow}
        </p>

        {/* Icon + title */}
        <div className="flex items-start gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${v.accent} 0%, ${v.accentDark} 100%)`,
              boxShadow: `0 12px 28px -6px ${v.accent}60`,
              animation: "blkPulse 2.5s ease-in-out infinite",
            }}>
            <Icon size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[#0a1647] font-black tracking-tight leading-[1.05]"
              style={{ fontSize: "clamp(24px, 2.4vw, 30px)" }}>
              {v.title}
            </h2>
          </div>
        </div>

        {/* Description */}
        <p className="text-[#1a2f8a]/75 text-sm leading-relaxed font-medium mb-5">
          {v.description}
        </p>

        {/* Company info — trial expired only */}
        {variant === "trial_expired" && company && (
          <div className="rounded-2xl p-4 mb-4"
            style={{
              background: "rgba(255,255,255,0.45)",
              border: "1px solid rgba(26,47,138,0.12)",
            }}>
            <p className="text-[10px] font-black uppercase tracking-widest mb-1"
              style={{ color: `${C.navy}55` }}>
              Company
            </p>
            <p className="text-sm font-black" style={{ color: C.navyDeep }}>
              {company.name}
            </p>
            {company.trial_ends_at && (
              <p className="text-[11px] mt-1" style={{ color: `${C.navy}65` }}>
                Expired on {new Date(company.trial_ends_at).toLocaleDateString("en-GB", {
                  day: "2-digit", month: "long", year: "numeric",
                })}
              </p>
            )}
          </div>
        )}

        {/* Email pill */}
        {email && variant !== "trial_expired" && (
          <div className="rounded-2xl p-3 mb-4 flex items-center gap-2"
            style={{
              background: "rgba(255,255,255,0.45)",
              border: "1px solid rgba(26,47,138,0.12)",
            }}>
            <Mail size={12} style={{ color: `${C.navy}55` }} className="shrink-0" />
            <span className="text-xs font-mono truncate" style={{ color: `${C.navy}80` }}>
              {email}
            </span>
          </div>
        )}

        {/* Technical message */}
        {message && (
          <div className="rounded-2xl p-3.5 mb-4"
            style={{
              background: "rgba(232,57,74,0.06)",
              border: "1px solid rgba(232,57,74,0.18)",
            }}>
            <p className="text-[11px] font-mono break-words" style={{ color: C.redDark }}>
              {message}
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="rounded-2xl p-4 mb-6"
          style={{
            background: `${v.accent}12`,
            border: `1px solid ${v.accent}30`,
          }}>
          <p className="text-xs leading-relaxed font-medium" style={{ color: v.accentDark }}>
            {v.cta}
          </p>
          {v.contactEmail && (
            <a href={`mailto:${v.contactEmail}`}
              className="inline-flex items-center gap-1.5 text-xs font-black mt-2 transition-opacity hover:opacity-80"
              style={{ color: v.accentDark }}>
              <Mail size={11} />
              {v.contactEmail}
            </a>
          )}
        </div>

        {/* Logout */}
        <button onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-xs font-black transition-all hover:scale-[1.01]"
          style={{
            background: "rgba(255,255,255,0.55)",
            border: "1px solid rgba(26,47,138,0.15)",
            color: C.navy,
            backdropFilter: "blur(8px)",
          }}>
          <LogOut size={12} />
          Sign out
        </button>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 left-0 right-0 text-center">
        <span className="text-[10px] text-white/60 tracking-widest font-bold">
          POWERED BY KONSOLIDATOR® · IFRS CONSOLIDATED REPORTING
        </span>
      </div>
    </div>
  );
}