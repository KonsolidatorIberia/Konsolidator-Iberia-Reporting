import { useState } from "react";

const TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

/* ─── Background grid of finance-style ticker chips ─── */
const TICKERS = [
  { label: "EBITDA",     value: "+8.4%",  color: "#34d399" },
  { label: "REVENUE",    value: "€42.1M", color: "#ffffff" },
  { label: "MARGIN",     value: "18.0%",  color: "#34d399" },
  { label: "FX EUR/USD", value: "1.094",  color: "#fbbf24" },
  { label: "GROUP NI",   value: "+12.3%", color: "#34d399" },
  { label: "ENTITIES",   value: "12",     color: "#ffffff" },
  { label: "CONSOL.",    value: "ACTIVE", color: "#34d399" },
  { label: "CASH FLOW",  value: "€8.7M",  color: "#ffffff" },
];

/* ─── Orbiting nodes for the consolidation graph ─── */
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
      style={{ opacity: 0.55 }}
    >
      {/* Concentric rings */}
      <circle cx="0" cy="0" r="160" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <circle cx="0" cy="0" r="120" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 4" />
      <circle cx="0" cy="0" r="80"  fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

      {/* Lines from each entity node to the central hub */}
      {NODES.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const x = Math.cos(rad) * 140;
        const y = Math.sin(rad) * 140;
        return (
          <line
            key={`line-${i}`}
            x1={x} y1={y} x2="0" y2="0"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.8"
            strokeDasharray="280"
            style={{
              animation: `drawLine 3s ease-out ${n.delay}ms both, fadeLine 6s ease-in-out ${n.delay + 3000}ms infinite`,
            }}
          />
        );
      })}

      {/* Outer entity nodes */}
      {NODES.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const x = Math.cos(rad) * 140;
        const y = Math.sin(rad) * 140;
        return (
          <g key={`node-${i}`}>
            <circle
              cx={x} cy={y} r="6"
              fill="rgba(255,255,255,0.15)"
              style={{ animation: `pulseNode 4s ease-in-out ${n.delay}ms infinite` }}
            />
            <circle
              cx={x} cy={y} r="3"
              fill="#ffffff"
              style={{
                animation: `nodeAppear 600ms ease-out ${n.delay + 500}ms both`,
                filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))",
              }}
            />
          </g>
        );
      })}

      {/* Central hub (= consolidated group) */}
      <circle
        cx="0" cy="0" r="14"
        fill="rgba(232,57,74,0.2)"
        style={{ animation: "pulseHub 3s ease-in-out infinite" }}
      />
      <circle
        cx="0" cy="0" r="8"
        fill="#e8394a"
        style={{ filter: "drop-shadow(0 0 12px rgba(232,57,74,0.8))" }}
      />

      {/* Slowly rotating outer ring */}
      <g style={{ animation: "rotateRing 40s linear infinite", transformOrigin: "0 0" }}>
        <circle
          cx="0" cy="0" r="180"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.5"
          strokeDasharray="3 8"
        />
      </g>
    </svg>
  );
}

/* ─── Floating ticker chips ─── */
function FloatingTickers() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {TICKERS.map((t, i) => {
        const top = ((i * 37) % 80) + 10;
        const left = ((i * 53) % 80) + 10;
        const delay = i * 600;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              top: `${top}%`,
              left: `${left}%`,
              animation: `floatTicker 8s ease-in-out ${delay}ms infinite, fadeInTicker 800ms ease-out ${delay}ms both`,
              opacity: 0,
            }}
          >
            <div
              className="bg-white/5 backdrop-blur-sm rounded-md px-2 py-1 border border-white/10"
              style={{ fontSize: 9 }}
            >
              <span className="text-blue-200/60 font-bold tracking-widest mr-2">{t.label}</span>
              <span className="font-black tabular-nums" style={{ color: t.color }}>{t.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Background financial chart ─── */
function BackgroundChart() {
  const points = [];
  const W = 800, H = 200;
  for (let x = 0; x <= W; x += 10) {
    const y = H * 0.5
      + Math.sin(x * 0.012) * 30
      + Math.sin(x * 0.03)  * 12
      + Math.cos(x * 0.045) * 6;
    points.push(`${x},${y.toFixed(1)}`);
  }
  const path = "M" + points.join(" L");
  return (
    <svg
      className="absolute bottom-0 left-0 w-full pointer-events-none"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height: "40%", opacity: 0.4 }}
    >
      <defs>
        <linearGradient id="bg-chart-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.15)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)"    />
        </linearGradient>
      </defs>
      <path
        d={`${path} L${W},${H} L0,${H} Z`}
        fill="url(#bg-chart-grad)"
        style={{ animation: "waveSlide 14s ease-in-out infinite" }}
      />
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="1"
        style={{ animation: "waveSlide 14s ease-in-out infinite" }}
      />
    </svg>
  );
}

/* ─── Floating particles ─── */
function Particles() {
  const particles = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map(i => {
        const size = 1 + (i % 3);
        const top = (i * 47) % 100;
        const left = (i * 23) % 100;
        const dur = 8 + (i % 6);
        const delay = (i * 400) % 4000;
        return (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: size,
              height: size,
              top: `${top}%`,
              left: `${left}%`,
              opacity: 0.4,
              filter: "blur(0.5px)",
              animation: `floatParticle ${dur}s ease-in-out ${delay}ms infinite`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(null);

  const handleLogin = async () => {
    if (!username || !password) { setError("Enter your credentials"); return; }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.append("grant_type", "password");
      params.append("client_id", CLIENT_ID);
      params.append("scope", SCOPE);
      params.append("username", username);
      params.append("password", password);
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error);
      onLogin(data.access_token, { username }, { username, password });
    } catch {
      setError("Invalid credentials. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#1a2f8a]">
      <style>{`
        @keyframes drawLine {
          from { stroke-dashoffset: 280; opacity: 0; }
          to   { stroke-dashoffset: 0;   opacity: 1; }
        }
        @keyframes fadeLine {
          0%, 100% { opacity: 0.18; }
          50%      { opacity: 0.4;  }
        }
        @keyframes nodeAppear {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseNode {
          0%, 100% { r: 6; opacity: 0.15; }
          50%      { r: 9; opacity: 0.3;  }
        }
        @keyframes pulseHub {
          0%, 100% { r: 14; opacity: 0.2; }
          50%      { r: 22; opacity: 0.4; }
        }
        @keyframes rotateRing {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
        @keyframes floatTicker {
          0%, 100% { transform: translate(0, 0);     }
          50%      { transform: translate(8px, -12px); }
        }
        @keyframes fadeInTicker {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes waveSlide {
          0%, 100% { transform: translateX(0);     }
          50%      { transform: translateX(-30px); }
        }
        @keyframes floatParticle {
          0%, 100% { transform: translate(0, 0);        opacity: 0.4; }
          50%      { transform: translate(20px, -30px); opacity: 0.8; }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes spinRing {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to   { opacity: 1; transform: translateX(0);     }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0);    }
        }
        .shimmer-btn {
          background: linear-gradient(90deg, #e8394a 0%, #e8394a 40%, #ff5563 50%, #e8394a 60%, #e8394a 100%);
          background-size: 200% 100%;
          animation: shimmer 3s linear infinite;
        }
        .spinning-ring {
          animation: spinRing 1s linear infinite;
        }
      `}</style>

      <div className="flex w-full overflow-hidden">

        {/* Left — animated cinematic panel */}
        <div className="hidden lg:flex w-3/5 bg-[#1a2f8a] flex-col justify-between p-14 relative overflow-hidden">
          {/* Layer 1: subtle blur orbs */}
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-white opacity-5" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-white opacity-5" />

          {/* Layer 2: background financial wave */}
          <BackgroundChart />

          {/* Layer 3: consolidation graph (centered) */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-full max-w-[700px] max-h-[700px]">
              <ConsolidationGraph />
            </div>
          </div>

          {/* Layer 4: floating ticker chips */}
          <FloatingTickers />

          {/* Layer 5: particles */}
          <Particles />

          {/* Foreground content */}
          <div className="relative z-10" style={{ animation: "slideInLeft 700ms ease-out both" }}>
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-[#1a2f8a] font-black text-base">[K</span>
              </div>
              <span className="text-white font-black text-xl tracking-widest">KONSOLIDATOR</span>
            </div>
            <p className="text-blue-300 text-xs font-semibold tracking-widest uppercase mb-4">Financial Intelligence</p>
            <h1 className="text-5xl font-black text-white leading-tight mb-6">
              Group<br />Reporting<br /><span className="text-[#e8394a]">Reimagined.</span>
            </h1>
            <p className="text-blue-200 text-base leading-relaxed max-w-xs">
              Real-time consolidated financials, KPIs, and group analytics — all in one place.
            </p>
          </div>

          {/* Feature cards — high-contrast over animated background */}
          <div className="relative z-10 grid grid-cols-2 gap-3" style={{ animation: "slideInLeft 800ms ease-out 200ms both" }}>
            {[
              { label: "Consolidated P&L", desc: "Live data" },
              { label: "Group KPIs",       desc: "Interactive" },
              { label: "Multi-currency",   desc: "Auto FX" },
              { label: "By Dimensions",    desc: "Drill down" },
            ].map((f, i) => (
              <div
                key={f.label}
                className="bg-[#0f1f5c]/80 backdrop-blur-md rounded-xl p-4 border border-white/15 hover:border-white/30 hover:bg-[#0f1f5c]/95 transition-all shadow-lg"
                style={{ animation: `slideInLeft 600ms ease-out ${300 + i * 100}ms both` }}
              >
                <p className="text-white font-black text-sm">{f.label}</p>
                <p className="text-blue-200 text-xs mt-1 font-medium">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right — form panel (floating over the blue with rounded corner + shadow) */}
        <div className="flex-1 bg-white flex items-center justify-center p-14 relative overflow-hidden lg:rounded-l-[40px] lg:shadow-[-20px_0_60px_rgba(0,0,0,0.15)]">
          <div className="w-full max-w-sm relative z-10" style={{ animation: "slideInRight 700ms ease-out both" }}>
            <div className="lg:hidden flex items-center gap-3 mb-10">
              <div className="w-9 h-9 bg-[#1a2f8a] rounded-xl flex items-center justify-center">
                <span className="text-white font-black text-sm">[K</span>
              </div>
              <span className="text-[#1a2f8a] font-black text-lg tracking-widest">KONSOLIDATOR</span>
            </div>
            <h2 className="text-3xl font-black text-[#1a2f8a] mb-2">Welcome back</h2>
            <p className="text-gray-400 text-sm mb-10">Sign in to your reporting dashboard</p>

            <div className="space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Email</label>
                <input
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="you@konsolidator.com"
                  className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                  style={{
                    boxShadow: focused === "email" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none",
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                  className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                  style={{
                    boxShadow: focused === "password" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none",
                  }}
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3" style={{ animation: "slideInRight 300ms ease-out" }}>
                  <p className="text-red-500 text-sm">{error}</p>
                </div>
              )}
              <button
                onClick={handleLogin}
                disabled={loading}
                className={`relative w-full text-white font-black py-4 rounded-2xl transition-all text-sm tracking-wide disabled:opacity-70 shadow-lg shadow-red-200 overflow-hidden ${loading ? "" : "shimmer-btn hover:shadow-xl"}`}
                style={{
                  backgroundColor: loading ? "#e8394a" : undefined,
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-white/30 border-t-white spinning-ring" />
                    Signing in…
                  </span>
                ) : (
                  "Sign In →"
                )}
              </button>
            </div>
            <p className="text-center text-xs text-gray-300 mt-10">
              Powered by Konsolidator® · IFRS Consolidated Reporting
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}