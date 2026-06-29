import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const TOKEN_URL  = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID  = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE      = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";
const STORAGE_KEY = "signup_verification";
const IDLE_MS    = 10 * 60 * 1000; // 10 min

const readToken = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
};

const writeToken = (email) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    email,
    expiresAt: Date.now() + IDLE_MS,
  }));
};

export default function Signup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(() => readToken() ? "checkout" : "verify");

  // ─── Verify state ──────────────────────────────────────────────
  const [vEmail, setVEmail]       = useState(() => readToken()?.email ?? "");
  const [vPassword, setVPassword] = useState("");
  const [vLoading, setVLoading]   = useState(false);
  const [vError, setVError]       = useState("");

// ─── Checkout state ────────────────────────────────────────────
  const [coCompanyName, setCoCompanyName] = useState("");
  const [coVat, setCoVat]                 = useState("");
  const [coCountry, setCoCountry]         = useState("");
  const [coAddress, setCoAddress]         = useState("");
  const [coPostal, setCoPostal]           = useState("");
  const [coCity, setCoCity]               = useState("");
  const [coName, setCoName]               = useState("");
  const [coPhone, setCoPhone]             = useState("");
  const [coEmail, setCoEmail]             = useState(() => readToken()?.email ?? "");
  const [planYears, setPlanYears] = useState(3);
  const [focused, setFocused]     = useState(null);

  // ─── Idle timer (sliding 10-min window) ────────────────────────
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (step !== "checkout") return;

    const bump = () => {
      lastActivityRef.current = Date.now();
      const tk = readToken();
      if (tk) writeToken(tk.email);
    };
    const check = () => {
      if (!readToken()) {
        navigate("/", { replace: true });
      }
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const interval = setInterval(check, 15 * 1000);

    return () => {
      events.forEach(e => window.removeEventListener(e, bump));
      clearInterval(interval);
    };
  }, [step, navigate]);

  // ─── Verify handler ────────────────────────────────────────────
  const handleVerify = async () => {
    if (!vEmail || !vPassword) {
      setVError("Please enter your Konsolidator email and password.");
      return;
    }
    setVLoading(true);
    setVError("");

    // Dev bypass for testing
    const isDummyTest =
      import.meta.env.DEV &&
      vEmail.trim().toLowerCase().endsWith("@dummytest.dev") &&
      vPassword === "dummytest123";

    let b2cOk = false;
    if (isDummyTest) {
      b2cOk = true;
    } else {
      try {
        const params = new URLSearchParams();
        params.append("grant_type", "password");
        params.append("client_id", CLIENT_ID);
        params.append("scope", SCOPE);
        params.append("username", vEmail);
        params.append("password", vPassword);
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        b2cOk = res.ok;
      } catch { b2cOk = false; }
    }

    if (!b2cOk) {
      setVLoading(false);
      setVError("Invalid Konsolidator credentials.");
      return;
    }

    // Block if company already exists
    const domainPart = vEmail.split("@")[1] ?? "";
    const slug = domainPart.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (slug) {
      const { data: companyExists } = await supabase
        .rpc("company_exists_by_slug", { p_slug: slug });
      if (companyExists === true) {
        setVLoading(false);
        setVError("This company already exists. Please ask your admin for access.");
        return;
      }
    }

    writeToken(vEmail);
    setCoEmail(vEmail);
    setVLoading(false);
    setStep("checkout");
  };

  // ─── Pricing math ──────────────────────────────────────────────
  const LICENSE_PER_YEAR = 3000;
  const IMPLEMENTATION   = 3600;
  const licenseGross  = LICENSE_PER_YEAR * planYears;
  const discountPct   = planYears === 3 ? 10 : 0;
  const licenseNet    = Math.round(licenseGross * (1 - discountPct / 100));
  const total         = licenseNet + IMPLEMENTATION;
  const yourSavings   = licenseGross - licenseNet;
  const monthlyEquiv  = Math.round(licenseNet / (planYears * 12));

// ─── Form progress ─────────────────────────────────────────────
  const checkoutFields = [coCompanyName, coVat, coCountry, coAddress, coPostal, coCity, coName, coPhone, coEmail];
  const filledCount = checkoutFields.filter(v => v && v.trim() !== "").length;
  const progressPct = Math.round((filledCount / checkoutFields.length) * 100);

  const sharedKeyframes = (
    <style>{`
      @keyframes signupFadeUp {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes signupPulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.015); }
      }
      @keyframes signupShimmer {
        0%   { background-position: -200% 0; }
        100% { background-position:  200% 0; }
      }
      @keyframes signupGlow {
        0%, 100% { box-shadow: 0 20px 60px -20px rgba(232,57,74,0.4); }
        50%      { box-shadow: 0 20px 80px -10px rgba(232,57,74,0.6); }
      }
      @keyframes signupSpin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
.signup-shimmer {
        background: linear-gradient(90deg, #e8394a 0%, #e8394a 40%, #ff5563 50%, #e8394a 60%, #e8394a 100%);
        background-size: 200% 100%;
        animation: signupShimmer 3s linear infinite;
        color: #fff;
      }
      .signup-spin { animation: signupSpin 1s linear infinite; }
.signup-plan-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .signup-plan {
        position: relative;
        text-align: left;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1.5px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04);
        color: #fff;
        transition: all 0.25s ease;
        cursor: pointer;
      }
      .signup-plan:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
.signup-plan.active {
        background: linear-gradient(135deg, #e8394a 0%, #cf2c3d 100%);
        border-color: #e8394a;
        box-shadow: 0 12px 28px -8px rgba(232,57,74,0.55);
        transform: translateY(-1px);
        color: #fff;
      }
      .signup-plan.active .signup-plan-tag { color: rgba(255,255,255,0.85); }
      .signup-plan.active .signup-plan-price { color: rgba(255,255,255,0.85); }
      .signup-plan-tag {
        font-size: 9px;
        font-weight: 900;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        opacity: 0.7;
      }
      .signup-plan.active .signup-plan-tag { opacity: 0.9; }
      .signup-plan-title { font-size: 20px; font-weight: 900; margin-top: 2px; }
      .signup-plan-price { font-size: 11px; font-weight: 700; margin-top: 4px; opacity: 0.7; font-variant-numeric: tabular-nums; }
      .signup-plan-badge {
        position: absolute; top: 8px; right: 8px;
        font-size: 9px; font-weight: 900;
        padding: 2px 7px; border-radius: 6px;
        background: rgba(255,255,255,0.18); color: #fff;
        letter-spacing: 0.04em;
      }
    `}</style>
  );

  // ─── VERIFY STEP ───────────────────────────────────────────────
  if (step === "verify") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a1442 0%, #1a2f8a 50%, #0f1f5c 100%)" }}>
        {sharedKeyframes}

        {/* Ambient blobs */}
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(232,57,74,0.18), transparent 70%)" }} />
        <div className="absolute -bottom-32 -right-32 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.05), transparent 70%)" }} />

        {/* Back link */}
        <button
          onClick={() => navigate("/")}
          className="absolute top-8 left-8 text-blue-200/70 hover:text-white text-xs font-bold transition-colors flex items-center gap-2"
        >
          ← Back to sign in
        </button>

        {/* Brand */}
        <div className="absolute top-8 right-8 flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-sm tracking-widest">KONSOLIDATOR</span>
        </div>

        {/* Card */}
        <div
          className="relative w-full max-w-md bg-white rounded-[32px] p-10"
          style={{
            boxShadow: "0 40px 100px -20px rgba(0,0,0,0.5)",
            animation: "signupFadeUp 0.6s ease-out both",
          }}
        >
          <div className="flex items-center gap-2 mb-6">
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 rounded-full bg-[#1a2f8a] text-white text-[10px] font-black flex items-center justify-center">1</span>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#1a2f8a]">Verify</span>
            </div>
            <div className="flex-1 h-px bg-gray-200" />
            <div className="flex items-center gap-1.5 opacity-40">
              <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-[10px] font-black flex items-center justify-center">2</span>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Details</span>
            </div>
          </div>

          <h1 className="text-3xl font-black text-[#1a2f8a] leading-tight">
            Create your account<span className="text-[#e8394a]">.</span>
          </h1>
          <p className="text-gray-500 text-sm mt-2 mb-7">
            Verify with your existing Konsolidator credentials to continue.
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2 block">
                Konsolidator email
              </label>
              <input
                type="email"
                value={vEmail}
                onChange={(e) => setVEmail(e.target.value)}
                onFocus={() => setFocused("v-email")}
                onBlur={() => setFocused(null)}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                placeholder="you@yourcompany.com"
                disabled={vLoading}
                className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50 disabled:opacity-60"
                style={{ boxShadow: focused === "v-email" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
              />
            </div>
            <div>
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2 block">
                Konsolidator password
              </label>
              <input
                type="password"
                value={vPassword}
                onChange={(e) => setVPassword(e.target.value)}
                onFocus={() => setFocused("v-password")}
                onBlur={() => setFocused(null)}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                placeholder="••••••••"
                disabled={vLoading}
                className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50 disabled:opacity-60"
                style={{ boxShadow: focused === "v-password" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
              />
            </div>

            {vError && (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                <p className="text-red-500 text-sm">{vError}</p>
              </div>
            )}

            <button
              onClick={handleVerify}
              disabled={vLoading}
              className={`relative w-full text-white font-black py-4 rounded-2xl text-sm tracking-wide disabled:opacity-70 shadow-lg shadow-red-200 overflow-hidden ${vLoading ? "" : "signup-shimmer hover:shadow-xl"}`}
              style={{ backgroundColor: vLoading ? "#e8394a" : undefined }}
            >
              {vLoading ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="inline-block w-4 h-4 rounded-full border-2 border-white/30 border-t-white signup-spin" />
                  Verifying…
                </span>
              ) : (
                "Verify & Continue →"
              )}
            </button>
          </div>

          <p className="text-center text-[11px] text-gray-300 mt-7">
            Step 1 of 2 · Konsolidator® IFRS Consolidated Reporting
          </p>
        </div>
      </div>
    );
  }

  // ─── CHECKOUT STEP ─────────────────────────────────────────────
return (
    <div className="h-screen overflow-hidden relative flex flex-col"
      style={{ background: "linear-gradient(135deg, #0a1647 0%, #102063 50%, #1a2f8a 100%)" }}>
      {sharedKeyframes}

      {/* Ambient depth — Konsolidator palette only */}
      <div className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(232,57,74,0.18), transparent 70%)" }} />
      <div className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.06), transparent 70%)" }} />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(26,47,138,0.4), transparent 70%)" }} />

      {/* Subtle financial grid texture */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

{/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-10 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-sm tracking-widest">KONSOLIDATOR</span>
        </div>

        <button
          type="button"
          onClick={() => { sessionStorage.removeItem(STORAGE_KEY); navigate("/"); }}
          className="text-xs font-bold text-white/50 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </header>

{/* Stepper with live progress */}
      <div className="relative z-10 mx-auto mb-3 shrink-0" style={{ width: "min(460px, calc(100% - 80px))" }}>
        <div className="flex items-center gap-3">
<div className="flex items-center gap-2 shrink-0">
            <span className="w-6 h-6 rounded-full text-white text-[10px] font-black flex items-center justify-center"
              style={{ background: "#e8394a", boxShadow: "0 0 12px rgba(232,57,74,0.5)" }}>✓</span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Verified</span>
          </div>

          <div className="flex-1 relative h-1.5 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.12)" }}>
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, #ffffff 0%, #e8394a 100%)",
                boxShadow: progressPct > 0 ? "0 0 14px rgba(232,57,74,0.55)" : "none",
              }}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center transition-all"
              style={{
                background: progressPct === 100 ? "#e8394a" : "rgba(255,255,255,0.15)",
                color: "#fff",
                boxShadow: progressPct === 100 ? "0 0 12px rgba(232,57,74,0.55)" : "none",
              }}>
              {progressPct === 100 ? "✓" : "2"}
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">
              Details
            </span>
            <span className="text-[10px] font-black tabular-nums ml-1"
              style={{ color: progressPct === 100 ? "#e8394a" : "rgba(255,255,255,0.55)" }}>
              {progressPct}%
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 flex-1 min-h-0 flex items-stretch justify-center px-10 pb-6">
        <div className="w-full max-w-[1280px] grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 max-h-full">

          {/* ─── LEFT: form ─────────────────────────────────────── */}
          <div
            className="bg-white rounded-[28px] px-9 py-7 overflow-y-auto"
            style={{
              boxShadow: "0 20px 60px -20px rgba(26,47,138,0.15)",
              animation: "signupFadeUp 0.6s ease-out both",
            }}
          >
            <h1 className="text-3xl font-black text-[#1a2f8a] leading-tight">
              Your details<span className="text-[#e8394a]">.</span>
            </h1>
            <p className="text-gray-500 text-sm mt-1.5 mb-5">
              Billing and contact information.
            </p>

<div className="space-y-3">
              {/* Section: Company */}
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2">Company</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Legal company name</label>
                    <input
                      type="text" value={coCompanyName} onChange={(e) => setCoCompanyName(e.target.value)}
                      onFocus={() => setFocused("c-companyname")} onBlur={() => setFocused(null)}
                      placeholder="Acme Corporation S.L."
                      className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                      style={{ boxShadow: focused === "c-companyname" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">VAT / Tax ID</label>
                      <input
                        type="text" value={coVat} onChange={(e) => setCoVat(e.target.value)}
                        onFocus={() => setFocused("c-vat")} onBlur={() => setFocused(null)}
                        placeholder="ESB12345678"
                        className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                        style={{ boxShadow: focused === "c-vat" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Country</label>
                      <input
                        type="text" value={coCountry} onChange={(e) => setCoCountry(e.target.value)}
                        onFocus={() => setFocused("c-country")} onBlur={() => setFocused(null)}
                        placeholder="Spain"
                        className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                        style={{ boxShadow: focused === "c-country" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                      />
                    </div>
                  </div>
                </div>
              </div>
{/* Section: Billing address */}
              <div className="pt-3 border-t border-gray-100">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2">Billing address</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Street</label>
                    <input
                      type="text" value={coAddress} onChange={(e) => setCoAddress(e.target.value)}
                      onFocus={() => setFocused("c-address")} onBlur={() => setFocused(null)}
                      placeholder="Calle Mayor 1"
                      className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                      style={{ boxShadow: focused === "c-address" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_1.4fr] gap-3">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Postal code</label>
                      <input
                        type="text" value={coPostal} onChange={(e) => setCoPostal(e.target.value)}
                        onFocus={() => setFocused("c-postal")} onBlur={() => setFocused(null)}
                        placeholder="28013"
                        className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                        style={{ boxShadow: focused === "c-postal" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">City</label>
                      <input
                        type="text" value={coCity} onChange={(e) => setCoCity(e.target.value)}
                        onFocus={() => setFocused("c-city")} onBlur={() => setFocused(null)}
                        placeholder="Madrid"
                        className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                        style={{ boxShadow: focused === "c-city" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                      />
                    </div>
                  </div>
                </div>
              </div>

{/* Section: Contact */}
              <div className="pt-3 border-t border-gray-100">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2">Primary contact</p>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Full name</label>
                      <input
                        type="text" value={coName} onChange={(e) => setCoName(e.target.value)}
                        onFocus={() => setFocused("c-name")} onBlur={() => setFocused(null)}
                        placeholder="Jane Doe"
                        className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                        style={{ boxShadow: focused === "c-name" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Phone</label>
                      <input
                        type="tel" value={coPhone} onChange={(e) => setCoPhone(e.target.value)}
                        onFocus={() => setFocused("c-phone")} onBlur={() => setFocused(null)}
                        placeholder="+34 600 000 000"
                        className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                        style={{ boxShadow: focused === "c-phone" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-1.5 block">Billing email</label>
                    <input
                      type="email" value={coEmail} onChange={(e) => setCoEmail(e.target.value)}
                      onFocus={() => setFocused("c-email")} onBlur={() => setFocused(null)}
                      placeholder="billing@company.com"
                      className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                      style={{ boxShadow: focused === "c-email" ? "0 0 0 4px rgba(26,47,138,0.08)" : "none" }}
                    />
                  </div>
                </div>
              </div>
            </div>

{/* Trust */}
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              {[
                { t: "Secure", s: "256-bit TLS" },
                { t: "IFRS",   s: "Compliant" },
                { t: "EU",     s: "Hosted" },
                { t: "GDPR",   s: "Ready" },
              ].map((b) => (
                <div key={b.t} className="text-center">
                  <p className="text-[9px] font-black text-[#1a2f8a]">{b.t}</p>
                  <p className="text-[8px] text-gray-400 mt-0.5">{b.s}</p>
                </div>
              ))}
            </div>
          </div>

{/* ─── RIGHT: pricing ─────────────────────────────────── */}
          <div
            className="relative rounded-[28px] overflow-hidden text-white"
            style={{
              background: "linear-gradient(140deg, #060e35 0%, #0a1647 35%, #102063 70%, #1a2f8a 100%)",
              boxShadow: "0 30px 80px -20px rgba(10,22,71,0.7), 0 0 50px -10px rgba(232,57,74,0.2)",
              animation: "signupFadeUp 0.6s ease-out 0.1s both",
            }}
          >
            {/* Decorative orbs — Konsolidator red + soft white */}
            <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-35 pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(232,57,74,0.6), transparent 70%)" }} />
            <div className="absolute -bottom-32 -left-24 w-96 h-96 rounded-full opacity-20 pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)" }} />
            <div className="absolute top-1/3 right-1/4 w-40 h-40 rounded-full opacity-15 pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(232,57,74,0.5), transparent 70%)", filter: "blur(20px)" }} />
<div className="relative px-8 py-7 overflow-y-auto max-h-full">
<p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-200 mb-1">Your plan</p>
              <h2 className="text-3xl font-black leading-tight">
                Group Reporting<span style={{ color: "#e8394a" }}>.</span>
              </h2>

              {/* Plan selector */}
              <div className="signup-plan-grid mt-5">
                {[
                  { years: 1, tag: "Flexible", badge: null },
                  { years: 3, tag: "Best value", badge: "−10%" },
                ].map(opt => {
                  const active = planYears === opt.years;
                  const gross  = LICENSE_PER_YEAR * opt.years;
                  const net    = opt.years === 3 ? Math.round(gross * 0.9) : gross;
                  return (
                    <button
                      key={opt.years}
                      type="button"
                      onClick={() => setPlanYears(opt.years)}
                      className={`signup-plan ${active ? "active" : ""}`}
                    >
                      {opt.badge && <span className="signup-plan-badge">{opt.badge}</span>}
                      <p className="signup-plan-tag">{opt.tag}</p>
                      <p className="signup-plan-title">{opt.years} year{opt.years > 1 ? "s" : ""}</p>
                      <p className="signup-plan-price">€{net.toLocaleString("es-ES")} total</p>
                    </button>
                  );
                })}
              </div>

{/* Monthly equiv */}
              <p className="text-white/60 text-[11px] font-medium mt-3 tabular-nums">
                ≈ €{monthlyEquiv.toLocaleString("es-ES")}/month
              </p>

{/* Receipt */}
              <div className="mt-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-sm font-bold text-white">License</p>
                    <p className="text-white/55 text-[11px] tabular-nums">
                      €{LICENSE_PER_YEAR.toLocaleString("es-ES")} × {planYears} year{planYears > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    {discountPct > 0 && (
                      <p className="text-white/40 text-[11px] tabular-nums line-through">
                        €{licenseGross.toLocaleString("es-ES")}
                      </p>
                    )}
                    <p className="text-sm font-black text-white tabular-nums">
                      €{licenseNet.toLocaleString("es-ES")}
                    </p>
                  </div>
                </div>

                {yourSavings > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ background: "rgba(52,211,153,0.22)", border: "1px solid rgba(52,211,153,0.5)", boxShadow: "0 0 20px -4px rgba(52,211,153,0.3)" }}>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#6ee7b7" }}>
                      🎉 You save
                    </span>
                    <span className="text-[12px] font-black tabular-nums" style={{ color: "#6ee7b7" }}>
                      €{yourSavings.toLocaleString("es-ES")}
                    </span>
                  </div>
                )}

                <div className="flex items-baseline justify-between pt-3 border-t border-white/15">
                  <div>
                    <p className="text-sm font-bold text-white">Implementation</p>
                    <p className="text-white/55 text-[11px]">4 days × €900 · one-time</p>
                  </div>
                  <p className="text-sm font-black text-white tabular-nums">
                    €{IMPLEMENTATION.toLocaleString("es-ES")}
                  </p>
                </div>
              </div>

{/* Total */}
              <div className="mt-5 rounded-2xl p-5 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(232,57,74,0.2), rgba(232,57,74,0.05))",
                  border: "1px solid rgba(232,57,74,0.45)",
                  boxShadow: "0 0 30px -8px rgba(232,57,74,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
                }}>
                <div className="flex items-baseline justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "#fca5a5" }}>Total today</p>
                  <p className="text-[10px] text-white/55">VAT excluded</p>
                </div>
                <p className="text-[44px] font-black mt-1 tabular-nums leading-none"
                  style={{ textShadow: "0 2px 20px rgba(232,57,74,0.35)" }}>
                  €{total.toLocaleString("es-ES")}
                </p>
                <p className="text-[11px] text-white/65 mt-2">
                  Invoiced on activation · No auto-renewal
                </p>
              </div>

{/* CTA */}
              <button
                type="button"
                disabled
                className="signup-shimmer mt-4 w-full text-white font-black py-3.5 rounded-2xl text-sm tracking-wide cursor-not-allowed disabled:opacity-90"
                style={{
                  boxShadow: "0 12px 30px -8px rgba(232,57,74,0.55), 0 0 0 1px rgba(255,255,255,0.12) inset",
                }}
              >
                Continue to payment →
              </button>
              <p className="text-center text-[10px] text-white/45 mt-2.5">
                Powered by Konsolidator® · IFRS Consolidated Reporting
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}