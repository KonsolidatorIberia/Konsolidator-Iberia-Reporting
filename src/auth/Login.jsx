import { useState } from "react";
import { supabase, sbAccounts, getReportingStatus } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

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

// Sparkline points generated once at module load — they're decorative,
// so a single random shape is fine and avoids impure calls during render.
const SPARK_POINTS = (() => {
  const pts = [];
  const W = 180, H = 50;
  let y = H / 2;
  for (let x = 0; x <= W; x += 6) {
    y += (Math.random() - 0.5) * 8;
    y = Math.max(8, Math.min(H - 8, y));
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return { pts: pts.join(" "), W, H };
})();

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncPrompt, setSyncPrompt] = useState(null); // { acctUser, b2cToken, reporting, userEmail } | null
  const [syncing, setSyncing] = useState(false);
  const [dismantling, setDismantling] = useState(false);

const navigate = useNavigate();

// ──────────────────────────────────────────────────────────────
// finalizeSession: session-guard + onLogin tail. Extracted so the
// resync flow can reuse it after fixing a stale local password.
// ──────────────────────────────────────────────────────────────
const finalizeSession = async ({ b2cToken, acctUser, reporting, userEmail }) => {
  const SESSION_STALE_MS = 2 * 60 * 1000;

  const { data: existingSession } = await supabase
    .from("user_sessions")
    .select("last_seen")
    .eq("email", userEmail)
    .maybeSingle();

  if (existingSession) {
    const age = Date.now() - new Date(existingSession.last_seen).getTime();
    if (age < SESSION_STALE_MS) {
      setError("Another active session exists for this account. Please wait a moment and try again.");
      setLoading(false);
      setSyncing(false);
      return;
    }
  }

  const newSessionId = crypto.randomUUID();
  await supabase.from("user_sessions").upsert({
    email:      userEmail,
    session_id: newSessionId,
    last_seen:  new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  setLoading(false);
  setSyncing(false);

// Fade-out before handing off. EpicLoader will fade in on mount.
  setDismantling(true);
  setTimeout(() => {
    onLogin(
      b2cToken,
      { username, displayName: acctUser?.username ?? null },
      { username, password },
      reporting,
      newSessionId,
    );
  }, 450);
};

const handleLogin = async () => {
  if (!username || !password) { setError("Invalid credentials. Please try again."); return; }
  setLoading(true);
  setError("");

// ════════════════════════════════════════════════════════
  // PASO 0: parallel independent calls
  // ════════════════════════════════════════════════════════
  const b2cPromise = (async () => {
    // Dev bypass — mirrors the one in Signup.jsx so the whole
    // signup-from-login flow is testable without real B2C users.
    const isDummyTest =
      import.meta.env.DEV &&
      username.trim().toLowerCase().endsWith("@dummytest.dev") &&
      password === "dummytest123";
    if (isDummyTest) return "dev-bypass-token";

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
      if (!res.ok) return null;
      return data.access_token;
    } catch { return null; }
  })();

  const rpcPromise = supabase
    .rpc("get_user_by_email", { p_email: username.trim().toLowerCase() })
    .then(({ data }) => (Array.isArray(data) ? data[0] : null))
    .catch(() => null);

  // ════════════════════════════════════════════════════════
  // PASO 1: Supabase super-admin probe
  // ════════════════════════════════════════════════════════
  try {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: username,
      password,
    });

    if (!authErr && authData?.user) {
      const { data: userRow } = await sbAccounts
        .from("users")
        .select("is_super_admin, is_active")
        .eq("id", authData.user.id)
        .single();

      if (userRow?.is_super_admin && userRow?.is_active) {
        setLoading(false);
        navigate("/admin");
        return;
      }
      await supabase.auth.signOut();
    }
  } catch { /* ignore */ }

  // ════════════════════════════════════════════════════════
  // PASO 2: B2C
  // ════════════════════════════════════════════════════════
  const b2cToken = await b2cPromise;
  if (!b2cToken) {
    setError("Invalid credentials. Please try again.");
    setLoading(false);
    return;
  }

  // PASO 3: clear stale session
  await supabase.auth.signOut();

  // PASO 4: admin-created lookup + reporting status
  let reporting;
  const acctUser = await rpcPromise;
  const userEmail = username.trim().toLowerCase();

  if (acctUser?.admin_created) {
    if (!acctUser.is_active) {
      reporting = { status: "inactive", email: username };
    } else {
      try {
        const { data: links } = await supabase
          .rpc("get_user_company_links", { p_user_id: acctUser.id });

        const defaultLink = links?.find(l => l.is_default) ?? links?.[0];
        const company = defaultLink ? {
          name: defaultLink.company_name,
          slug: defaultLink.company_slug,
          is_trial: defaultLink.is_trial,
          trial_ends_at: defaultLink.trial_ends_at,
        } : null;

        if (!links || links.length === 0) {
          reporting = { status: "inactive", email: username };
        } else if (company?.is_trial && company?.trial_ends_at && new Date(company.trial_ends_at) < new Date()) {
          reporting = { status: "trial_expired", email: username, company };
        } else {
          reporting = { status: "active", user: acctUser, company };
        }
      } catch {
        reporting = { status: "active", user: acctUser, company: null };
      }
    }
} else {
    reporting = await getReportingStatus(username, password);
  }

  // Ghost user of an existing company → invalid credentials
  if (reporting?.status === "company_exists_no_user") {
    setError("Invalid credentials. Please try again.");
    setLoading(false);
    return;
  }

  // B2C accepted but user has no reporting account at all → before sending
  // them to signup, check if any OTHER user shares the same email domain.
  // If yes, the company already exists (slug just doesn't match the domain).
  // Treat the same way as company_exists_no_user → invalid credentials.
  if (reporting?.status === "needs_activation") {
    const domain = userEmail.split("@")[1] ?? "";
    if (domain) {
      const { data: peers, error: peerErr } = await sbAccounts
        .from("users")
        .select("id, email")
        .ilike("email", `%@${domain}`)
        .neq("email", userEmail)
        .limit(1);

      if (!peerErr && peers && peers.length > 0) {
        setError("Invalid credentials. Please try again.");
        setLoading(false);
        return;
      }
    }

    // No existing peers → genuine new signup, proceed
    sessionStorage.setItem("signup_autoverify", JSON.stringify({
      email: username.trim(),
      password,
      ts: Date.now(),
    }));
    setLoading(false);
    navigate("/signup");
    return;
  }

  // ════════════════════════════════════════════════════════
  // PASO 5: First-time admin_created activation
  // ════════════════════════════════════════════════════════
  if (acctUser?.admin_created && acctUser?.has_password === false) {
    try {
      const res = await fetch(
        "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/set-user-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
            Authorization: `Bearer ${b2cToken}`,
          },
          body: JSON.stringify({ user_id: acctUser.id, password }),
        }
      );
      if (res.ok) {
        await supabase.rpc("mark_user_has_password", { p_user_id: acctUser.id });
        await supabase.auth.signInWithPassword({ email: userEmail, password });
      }
    } catch { /* silent */ }

    return finalizeSession({ b2cToken, acctUser, reporting, userEmail });
  }

  // ════════════════════════════════════════════════════════
  // PASO 6: Returning admin_created user — Supabase RLS session.
  // If sign-in fails here, the local password is stale (user
  // most likely changed it upstream in Konsolidator B2C). The
  // B2C token we hold is proof of identity → offer to resync.
  // ════════════════════════════════════════════════════════
  if (acctUser?.admin_created && acctUser?.has_password === true) {
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password,
    });

    if (signInErr) {
      setSyncPrompt({ acctUser, b2cToken, reporting, userEmail });
      setLoading(false);
      return;
    }
  }

  return finalizeSession({ b2cToken, acctUser, reporting, userEmail });
};

const handleConfirmSync = async () => {
  if (!syncPrompt) return;
  const { acctUser, b2cToken, reporting, userEmail } = syncPrompt;

  setSyncing(true);
  setError("");

  try {
    const res = await fetch(
      "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/set-user-password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
          Authorization: `Bearer ${b2cToken}`,
        },
        body: JSON.stringify({ user_id: acctUser.id, password }),
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      setSyncing(false);
      setSyncPrompt(null);
      setError(`Could not sync password (${res.status}). ${txt}`);
      return;
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password,
    });
    if (signInErr) {
      setSyncing(false);
      setSyncPrompt(null);
      setError("Password was updated but sign-in still failed. Please try again or contact support.");
      return;
    }

    setSyncPrompt(null);
    await finalizeSession({ b2cToken, acctUser, reporting, userEmail });
  } catch (e) {
    setSyncing(false);
    setSyncPrompt(null);
    setError(`Sync failed: ${e.message}`);
  }
};

const handleCancelSync = () => {
  setSyncPrompt(null);
  setSyncing(false);
  setError("Sign-in cancelled. Your local password was not changed.");
};


return (
    <div className="h-screen flex relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 50%, #7a9fef 70%, #d8e4ff 100%)",
      }}>
      <style>{`
        @keyframes loginFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes loginFloat {
          0%, 100% { transform: translate(0, 0); }
          50%      { transform: translate(30px, -40px); }
        }
        @keyframes loginSpin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes loginShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes loginDrift {
          0%   { transform: translateY(0)    rotate(0deg);   opacity: 0; }
          10%  {                              opacity: 0.55; }
          90%  {                              opacity: 0.55; }
          100% { transform: translateY(-80vh) rotate(8deg);  opacity: 0; }
        }
        @keyframes loginDriftSlow {
          0%   { transform: translateY(0)     rotate(0deg);    opacity: 0; }
          10%  {                              opacity: 0.45; }
          90%  {                              opacity: 0.45; }
          100% { transform: translateY(-90vh) rotate(-6deg);   opacity: 0; }
        }
        @keyframes loginPulseEq {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.65; }
        }
        @keyframes loginDashFlow {
          to { stroke-dashoffset: -100; }
        }
        @keyframes loginBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        @keyframes loginRollCount {
          from { transform: translateY(0); }
          to   { transform: translateY(-1100%); }
        }
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

/* Simple fade-out for handoff to EpicLoader */
        @keyframes dismantleFade {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        .dismantle-piece {
          animation: dismantleFade 500ms ease-out both;
          will-change: opacity;
        }
        .login-shimmer-btn {
          background: linear-gradient(90deg, #e8394a 0%, #e8394a 40%, #ff5563 50%, #e8394a 60%, #e8394a 100%);
          background-size: 200% 100%;
          animation: loginShimmer 3s linear infinite;
        }
        .login-spin { animation: loginSpin 1s linear infinite; }
        .login-card {
          background: rgba(255,255,255,0.62);
          border: 1px solid rgba(255,255,255,0.85);
          backdrop-filter: blur(28px) saturate(150%);
          -webkit-backdrop-filter: blur(28px) saturate(150%);
          border-radius: 36px;
          box-shadow: 0 40px 100px -20px rgba(15,31,92,0.4), 0 12px 32px -10px rgba(15,31,92,0.2);
        }
        .login-input {
          width: 100%;
          background: rgba(255,255,255,0.65);
          border: 1px solid rgba(26,47,138,0.12);
          border-radius: 16px;
          padding: 14px 18px;
          font-size: 14px;
          color: #0a1647;
          outline: none;
          transition: all 0.2s ease;
        }
        .login-input::placeholder { color: rgba(26,47,138,0.3); }
        .login-input:focus {
          border-color: #1a2f8a;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(26,47,138,0.12);
        }
        .login-title-glow {
          text-shadow: 0 0 40px rgba(255,255,255,0.5), 0 0 80px rgba(168,197,255,0.6);
        }
        .login-eq {
          font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace;
          color: rgba(255,255,255,0.55);
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .login-ticker {
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
        .login-roll-digit {
          display: inline-block;
          height: 1em;
          overflow: hidden;
          vertical-align: bottom;
        }
        .login-roll-digit > span {
          display: block;
          line-height: 1em;
          animation: loginRollCount 4s steps(11) infinite;
        }
      `}</style>

      {/* ─── Live background field ─────────────────────────── */}
      <LiveBackground />

{/* Top bar */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-10 py-6">
<div
          className={`flex items-center gap-3 ${dismantling ? "dismantle-piece" : ""}`}
          style={{ "--dx": "-15px", "--rot": "-6deg", "--delay": "0ms" }}
        >
          <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-xs tracking-[0.2em]">KONSOLIDATOR</span>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 flex-1 flex items-center px-10">
        <div className="w-full max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-10 items-center">

          {/* LEFT: hero + brand graph */}
          <div className="relative pl-2 pr-8" style={{ animation: "loginFadeUp 0.6s ease-out both" }}>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ opacity: 0.45 }}>
              <div className="w-full h-full max-w-[560px] max-h-[560px]">
                <ConsolidationGraph />
              </div>
            </div>
<div className="relative z-10">
<div
                className={dismantling ? "dismantle-piece" : ""}
                style={{ "--dx": "-30px", "--rot": "-3deg", "--delay": "200ms" }}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/90 mb-3">
                  Financial Intelligence
                </p>
                <h1 className="text-white font-black leading-[0.95] tracking-tight login-title-glow"
                  style={{ fontSize: "clamp(48px, 6.5vw, 76px)" }}>
                  Welcome back.<br />
                  <span style={{ color: "#0a1647" }}>Let's get you in.</span>
                </h1>
                <p className="text-white/85 text-base mt-5 max-w-md font-medium">
                  Real-time consolidated financials, KPIs, and group analytics — all in one place.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-8 max-w-md">
{[
                  { label: "Consolidated P&L", desc: "Live data",   dx: "-20px", rot: "-5deg", delay: 350 },
                  { label: "Group KPIs",       desc: "Interactive", dx: "20px",  rot: "4deg",  delay: 420 },
                  { label: "Multi-currency",   desc: "Auto FX",     dx: "-15px", rot: "-6deg", delay: 490 },
                  { label: "By Dimensions",    desc: "Drill down",  dx: "25px",  rot: "5deg",  delay: 560 },
                ].map((f, i) => (
                  <div
                    key={f.label}
                    className={`rounded-2xl px-3.5 py-2.5 backdrop-blur-md ${dismantling ? "dismantle-piece" : ""}`}
                    style={{
                      background: "rgba(255,255,255,0.12)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      animation: dismantling
                        ? undefined
                        : `loginFadeUp 0.5s ease-out ${0.2 + i * 0.06}s both`,
                      "--dx": f.dx,
                      "--rot": f.rot,
                      "--delay": `${f.delay}ms`,
                    }}>
                    <p className="text-white font-black text-[12px]">{f.label}</p>
                    <p className="text-white/65 text-[10px] mt-0.5 font-medium">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

{/* RIGHT: compact login card — height matches left column */}
          <div
className={`login-card relative flex flex-col p-10 max-w-[440px] w-full justify-self-center lg:justify-self-end ${dismantling ? "dismantle-piece" : ""}`}
            style={{
              animation: dismantling ? undefined : "loginFadeUp 0.6s ease-out 0.1s both",
              "--dx": "30px",
              "--rot": "3deg",
              "--delay": "650ms",
            }}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-3" style={{ color: "#e8394a" }}>
              Sign in
            </p>
            <h2 className="text-[#0a1647] font-black tracking-tight mb-1"
              style={{ fontSize: "clamp(28px, 2.6vw, 36px)", lineHeight: 1.05 }}>
              Your dashboard<span style={{ color: "#e8394a" }}>.</span>
            </h2>
            <p className="text-[#1a2f8a]/55 text-sm mb-8 font-medium">
              Pick up where you left off.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] mb-2 text-[#1a2f8a]/55">
                  Email
                </label>
<input
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="you@konsolidator.com"
                  className="login-input"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] mb-2 text-[#1a2f8a]/55">
                  Password
                </label>
<input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                  className="login-input"
                />
              </div>

              {error && (
                <div className="rounded-2xl px-4 py-3"
                  style={{ background: "rgba(232,57,74,0.08)", border: "1px solid rgba(232,57,74,0.2)" }}>
                  <p className="text-[#e8394a] text-xs font-bold">{error}</p>
                </div>
              )}

              <button
                onClick={handleLogin}
                disabled={loading}
                className={`relative w-full text-white font-black py-4 transition-all text-sm tracking-wide disabled:opacity-70 overflow-hidden mt-2 ${loading ? "" : "login-shimmer-btn hover:shadow-xl"}`}
                style={{
                  borderRadius: 20,
                  backgroundColor: loading ? "#e8394a" : undefined,
                  boxShadow: loading ? "none" : "0 14px 36px -10px rgba(232,57,74,0.6), inset 0 1px 0 rgba(255,255,255,0.2)",
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white login-spin" />
                    Signing in…
                  </span>
                ) : (
                  "Sign In →"
                )}
              </button>

<button
                type="button"
                onClick={() => navigate("/signup")}
                disabled={loading}
                className="w-full font-black py-3.5 transition-all text-sm tracking-wide disabled:opacity-50"
                style={{
                  borderRadius: 18,
                  background: "rgba(255,255,255,0.45)",
                  border: "1px solid rgba(26,47,138,0.15)",
                  color: "#1a2f8a",
                  backdropFilter: "blur(8px)",
                }}
              >
                Create an account →
              </button>
            </div>

            <p className="text-[10px] text-[#1a2f8a]/55 font-bold tracking-widest text-center mt-6">
              IFRS · MULTI-CURRENCY · EU HOSTED
            </p>
          </div>
        </div>
      </div>

      {/* Sync prompt — unchanged */}
      {syncPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(10,22,71,0.55)", backdropFilter: "blur(12px)" }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white overflow-hidden"
            style={{ boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5)" }}
          >
            <div
              className="px-7 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #0f1f5c 100%)" }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-300 mb-1">
                Password change detected
              </p>
              <h3 className="text-2xl font-black leading-tight">Sync your password?</h3>
            </div>

            <div className="px-7 py-6 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Your Konsolidator credentials were accepted, but the password stored
                in our reporting platform is out of date — most likely because you
                changed it in Konsolidator.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                We can update your reporting-platform password to match the one you
                just used. This is required to grant the access permissions for your account.
              </p>
              <div className="rounded-xl px-3 py-2.5 bg-amber-50 border border-amber-200">
                <p className="text-[11px] font-bold text-amber-700">
                  Account: <span className="font-mono">{syncPrompt.userEmail}</span>
                </p>
              </div>
            </div>

            <div className="px-7 py-4 flex items-center justify-end gap-2 bg-gray-50 border-t border-gray-100">
              <button
                onClick={handleCancelSync}
                disabled={syncing}
                className="px-5 py-2.5 text-xs font-black rounded-xl text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSync}
                disabled={syncing}
                className="px-6 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #1a2f8a 0%, #0f1f5c 100%)",
                  boxShadow: "0 8px 20px -4px rgba(26,47,138,0.5)",
                }}
              >
                {syncing && (
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white login-spin" />
                )}
                {syncing ? "Syncing…" : "Yes, sync password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// LiveBackground — financial atmospherics behind the login
// ════════════════════════════════════════════════════════════════
function LiveBackground() {
  // Pool of equations / formulas that drift upward
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

  // Tickers
  const TICKERS = [
    { l: "EUR/USD", v: "1.0942", c: "#fbbf24" },
    { l: "GROUP NI", v: "+12.3%", c: "#34d399" },
    { l: "EBITDA",   v: "+8.4%",  c: "#34d399" },
    { l: "REVENUE",  v: "€42.1M", c: "#ffffff" },
    { l: "MARGIN",   v: "18.0%",  c: "#34d399" },
    { l: "CASH",     v: "€8.7M",  c: "#ffffff" },
    { l: "DSO",      v: "42 d",   c: "#fbbf24" },
    { l: "ROIC",     v: "14.2%",  c: "#34d399" },
    { l: "FX JPY",   v: "168.4",  c: "#fbbf24" },
    { l: "CONSOL.",  v: "ACTIVE", c: "#34d399" },
    { l: "ENTITIES", v: "12 / 12", c: "#ffffff" },
    { l: "P/E",      v: "18.6 ×", c: "#fbbf24" },
  ];

// Mini chart (sparkline) — uses the module-level constant defined below
  const sparkPoints = SPARK_POINTS;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Soft ambient blobs */}
      <div className="absolute top-[10%] left-[8%] w-[600px] h-[600px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
          filter: "blur(60px)",
          animation: "loginFloat 22s ease-in-out infinite",
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
        const delay = -((i * 2.2) % dur); // staggered
        const size = 11 + (i % 4);
        return (
          <div
            key={`eq-${i}`}
            className="login-eq absolute"
            style={{
              bottom: "-10%",
              left: `${left}%`,
              fontSize: size,
              animation: `${i % 2 === 0 ? "loginDrift" : "loginDriftSlow"} ${dur}s linear ${delay}s infinite`,
            }}
          >
            {eq}
          </div>
        );
      })}

      {/* Tickers — anchored, lightly pulsing */}
      <div className="absolute top-[8%] right-[3%] flex flex-col gap-2 items-end"
        style={{ animation: "loginPulseEq 5s ease-in-out infinite" }}>
        {TICKERS.slice(0, 4).map((t, i) => (
          <div key={`tk-top-${i}`} className="login-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#34d399", animation: "loginBlink 1.6s ease-in-out infinite" }} />
          </div>
        ))}
      </div>
      <div className="absolute bottom-[18%] right-[6%] flex flex-col gap-2 items-end"
        style={{ animation: "loginPulseEq 7s ease-in-out infinite" }}>
        {TICKERS.slice(4, 8).map((t, i) => (
          <div key={`tk-bot-${i}`} className="login-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
          </div>
        ))}
      </div>
      <div className="absolute top-[60%] left-[2%] flex flex-col gap-2"
        style={{ animation: "loginPulseEq 6s ease-in-out infinite" }}>
        {TICKERS.slice(8, 12).map((t, i) => (
          <div key={`tk-left-${i}`} className="login-ticker flex items-center gap-2">
            <span className="opacity-60">{t.l}</span>
            <span style={{ color: t.c }}>{t.v}</span>
          </div>
        ))}
      </div>

      {/* Sparkline mini-chart top-right */}
      <svg className="absolute top-[18%] right-[3%]"
        viewBox={`0 0 ${sparkPoints.W} ${sparkPoints.H}`}
        style={{ width: 180, height: 50, opacity: 0.55 }}>
        <polyline
          points={sparkPoints.pts}
          fill="none"
          stroke="#34d399"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="4 4"
          style={{ animation: "loginDashFlow 4s linear infinite" }}
        />
      </svg>

      {/* Sparkline bottom-left */}
      <svg className="absolute bottom-[28%] left-[4%]"
        viewBox={`0 0 ${sparkPoints.W} ${sparkPoints.H}`}
        style={{ width: 160, height: 44, opacity: 0.5 }}>
        <polyline
          points={sparkPoints.pts}
          fill="none"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="3 5"
          style={{ animation: "loginDashFlow 5s linear infinite" }}
        />
      </svg>

      {/* Big rolling number — bottom right corner */}
      <div className="absolute bottom-[10%] right-[10%] flex items-baseline gap-2"
        style={{ opacity: 0.55 }}>
        <span className="text-white/55 text-[10px] font-black tracking-widest">GROUP NET INCOME</span>
        <span className="text-white font-black font-mono tabular-nums" style={{ fontSize: 36 }}>
          €
          <RollingDigit />
          <RollingDigit delay="0.4s" />
          <span>.</span>
          <RollingDigit delay="0.8s" />
          <RollingDigit delay="1.2s" />
          <RollingDigit delay="1.6s" />
          M
        </span>
      </div>
    </div>
  );
}

function RollingDigit({ delay = "0s" }) {
  return (
    <span className="login-roll-digit">
      <span style={{ animationDelay: delay }}>
        0<br/>1<br/>2<br/>3<br/>4<br/>5<br/>6<br/>7<br/>8<br/>9<br/>0
      </span>
    </span>
  );
}