import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const TOKEN_URL  = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID  = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE      = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";
const STORAGE_KEY = "signup_verification";
const IDLE_MS    = 10 * 60 * 1000;

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
  const [planYears, setPlanYears]         = useState(3);

  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (step !== "checkout") return;
    const bump = () => {
      lastActivityRef.current = Date.now();
      const tk = readToken();
      if (tk) writeToken(tk.email);
    };
    const check = () => {
      if (!readToken()) navigate("/", { replace: true });
    };
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const interval = setInterval(check, 15 * 1000);
    return () => {
      events.forEach(e => window.removeEventListener(e, bump));
      clearInterval(interval);
    };
  }, [step, navigate]);

  const handleVerify = async () => {
    if (!vEmail || !vPassword) {
      setVError("Please enter your Konsolidator email and password.");
      return;
    }
    setVLoading(true);
    setVError("");

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

  // ─── Pricing ───────────────────────────────────────────────────
  const LICENSE_PER_YEAR = 3000;
  const IMPLEMENTATION   = 3600;
  const licenseGross  = LICENSE_PER_YEAR * planYears;
  const discountPct   = planYears === 3 ? 10 : 0;
  const licenseNet    = Math.round(licenseGross * (1 - discountPct / 100));
  const total         = licenseNet + IMPLEMENTATION;
  const yourSavings   = licenseGross - licenseNet;
  const monthlyEquiv  = Math.round(licenseNet / (planYears * 12));

  // ─── Progress ──────────────────────────────────────────────────
  const checkoutFields = [coCompanyName, coVat, coCountry, coAddress, coPostal, coCity, coName, coPhone, coEmail];
  const filledCount = checkoutFields.filter(v => v && v.trim() !== "").length;
  const progressPct = Math.round((filledCount / checkoutFields.length) * 100);

  const sharedKeyframes = (
    <style>{`
      @keyframes signupFadeUp {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes signupSpin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
      .signup-spin { animation: signupSpin 1s linear infinite; }

      .signup-input {
        width: 100%;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 14px;
        color: #111827;
        background: #fff;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .signup-input:focus {
        border-color: #1a2f8a;
        box-shadow: 0 0 0 3px rgba(26,47,138,0.1);
      }
      .signup-input:disabled { opacity: 0.5; }
      .signup-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #4b5563;
        margin-bottom: 6px;
      }
      .signup-section-label {
        font-size: 11px;
        font-weight: 700;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 10px;
      }
    `}</style>
  );

// ═══════════════════════════════════════════════════════════════
  // VERIFY STEP — Sui-inspired
  // ═══════════════════════════════════════════════════════════════
  if (step === "verify") {
    return (
      <div className="min-h-screen flex flex-col relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 40%, #a8c5ff 75%, #e8f1ff 100%)",
        }}>
        {sharedKeyframes}

        <style>{`
          @keyframes signupFloat {
            0%, 100% { transform: translate(0, 0); }
            50% { transform: translate(30px, -40px); }
          }
          .sui-card {
            background: rgba(255,255,255,0.65);
            border: 1px solid rgba(255,255,255,0.9);
            backdrop-filter: blur(20px) saturate(140%);
            -webkit-backdrop-filter: blur(20px) saturate(140%);
            border-radius: 24px;
            box-shadow: 0 30px 80px -20px rgba(15,31,92,0.35), 0 8px 24px -8px rgba(15,31,92,0.18);
          }
          .sui-input-light {
            width: 100%;
            background: rgba(255,255,255,0.6);
            border: 1px solid rgba(26,47,138,0.12);
            border-radius: 10px;
padding: 10px 12px;
            font-size: 14px;
            color: #0a1647;
            outline: none;
            transition: all 0.2s ease;
          }
          .sui-input-light::placeholder { color: rgba(26,47,138,0.3); }
          .sui-input-light:focus {
            border-color: #1a2f8a;
            background: #fff;
            box-shadow: 0 0 0 4px rgba(26,47,138,0.12);
          }
          .sui-input-light:disabled { opacity: 0.5; }
          .sui-title-glow {
            text-shadow: 0 0 40px rgba(255,255,255,0.5), 0 0 80px rgba(168,197,255,0.6);
          }
        `}</style>

        {/* Ambient atmospherics */}
        <div className="absolute top-[10%] left-[10%] w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
            filter: "blur(60px)",
            animation: "signupFloat 22s ease-in-out infinite",
          }} />
        <div className="absolute top-[30%] right-[8%] w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(168,197,255,0.5), transparent 65%)",
            filter: "blur(70px)",
          }} />

        {/* Grain texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }} />

        {/* Top bar */}
        <header className="relative z-10 flex items-center justify-between px-10 py-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-[#1a2f8a] font-black text-sm">[K</span>
            </div>
            <span className="text-white font-black text-xs tracking-[0.2em]">KONSOLIDATOR</span>
          </div>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-xs font-bold text-white/70 hover:text-white transition-colors"
          >
            ← Back to sign in
          </button>
        </header>

        {/* Body */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-10 pb-10">
          <div className="w-full max-w-[1100px] grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-10 items-center">

            {/* Left: hero text */}
            <div style={{ animation: "signupFadeUp 0.6s ease-out both" }}>
              <div className="flex items-center gap-3 mb-7">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="w-5 h-5 rounded-full bg-[#e8394a] text-white text-[10px] font-black flex items-center justify-center">1</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Verify</span>
                </div>
                <div className="w-20 h-0.5 rounded-full bg-white/25" />
                <div className="flex items-center gap-2 shrink-0 opacity-60">
                  <span className="w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center bg-white/20 text-white">2</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Details</span>
                </div>
              </div>

              <h1 className="text-white font-black leading-[0.95] tracking-tight sui-title-glow"
                style={{ fontSize: "clamp(44px, 6vw, 68px)" }}>
                Create your<br />
                <span style={{ color: "#0a1647" }}>account.</span>
              </h1>
              <p className="text-white/85 text-base mt-5 max-w-md font-medium">
                Verify with your existing Konsolidator credentials and we'll get you set up in seconds.
              </p>
            </div>

            {/* Right: verify card */}
            <div className="sui-card p-9" style={{ animation: "signupFadeUp 0.6s ease-out 0.1s both" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-3" style={{ color: "#e8394a" }}>
                01 · Verify
              </p>
              <h2 className="text-[#0a1647] font-black text-2xl tracking-tight mb-1">Konsolidator credentials</h2>
              <p className="text-[#1a2f8a]/55 text-sm mb-6 font-medium">
                We'll use these to confirm your identity.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.14em] mb-2 text-[#1a2f8a]/55">
                    Email
                  </label>
                  <input
                    type="email"
                    value={vEmail}
                    onChange={(e) => setVEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                    placeholder="you@yourcompany.com"
                    disabled={vLoading}
                    className="sui-input-light"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.14em] mb-2 text-[#1a2f8a]/55">
                    Password
                  </label>
                  <input
                    type="password"
                    value={vPassword}
                    onChange={(e) => setVPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                    placeholder="••••••••"
                    disabled={vLoading}
                    className="sui-input-light"
                  />
                </div>

                {vError && (
                  <div className="rounded-lg px-3 py-2.5"
                    style={{ background: "rgba(232,57,74,0.08)", border: "1px solid rgba(232,57,74,0.2)" }}>
                    <p className="text-[#e8394a] text-xs font-bold">{vError}</p>
                  </div>
                )}

                <button
                  onClick={handleVerify}
                  disabled={vLoading}
                  className="w-full text-white font-black py-3.5 rounded-xl text-sm tracking-wide transition-all disabled:opacity-70 mt-2"
                  style={{
                    background: "linear-gradient(135deg, #e8394a 0%, #cf2c3d 100%)",
                    boxShadow: "0 12px 30px -8px rgba(232,57,74,0.55), inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}
                >
                  {vLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white signup-spin" />
                      Verifying…
                    </span>
                  ) : "Verify and continue →"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="relative z-10 px-10 pb-6">
          <div className="max-w-[1100px] mx-auto text-center">
            <span className="text-[10px] text-white/60 tracking-widest font-bold">
              POWERED BY KONSOLIDATOR® · IFRS CONSOLIDATED REPORTING
            </span>
          </div>
        </footer>
      </div>
    );
  }

// ═══════════════════════════════════════════════════════════════
  // CHECKOUT STEP — Sui-inspired, Konsolidator navy as hero color
  // ═══════════════════════════════════════════════════════════════
return (
    <div className="h-screen flex flex-col relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 40%, #a8c5ff 75%, #e8f1ff 100%)",
      }}>
      {sharedKeyframes}

      <style>{`
        @keyframes signupFloat {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, -40px); }
        }
        .sui-card {
          background: rgba(255,255,255,0.65);
          border: 1px solid rgba(255,255,255,0.9);
          backdrop-filter: blur(20px) saturate(140%);
          -webkit-backdrop-filter: blur(20px) saturate(140%);
          border-radius: 24px;
          box-shadow: 0 30px 80px -20px rgba(15,31,92,0.35), 0 8px 24px -8px rgba(15,31,92,0.18);
        }
        .sui-input {
          width: 100%;
          background: rgba(255,255,255,0.6);
          border: 1px solid rgba(26,47,138,0.12);
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 14px;
          color: #0a1647;
          outline: none;
          transition: all 0.2s ease;
        }
        .sui-input::placeholder { color: rgba(26,47,138,0.3); }
        .sui-input:focus {
          border-color: #1a2f8a;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(26,47,138,0.12);
        }
        .sui-input:disabled { opacity: 0.5; }
        .sui-label {
          display: block;
          font-size: 10px;
          font-weight: 800;
          color: rgba(15,31,92,0.55);
          text-transform: uppercase;
          letter-spacing: 0.14em;
          margin-bottom: 8px;
        }
        .sui-section-label {
          font-size: 10px;
          font-weight: 800;
          color: #e8394a;
          text-transform: uppercase;
          letter-spacing: 0.22em;
          margin-bottom: 16px;
        }
        .sui-subsection-label {
          font-size: 10px;
          font-weight: 800;
          color: rgba(15,31,92,0.45);
          text-transform: uppercase;
          letter-spacing: 0.18em;
          margin-bottom: 12px;
        }
        .sui-title-glow {
          text-shadow:
            0 0 40px rgba(255,255,255,0.5),
            0 0 80px rgba(168,197,255,0.6);
        }
      `}</style>

      {/* Ambient atmospherics */}
      <div className="absolute top-[10%] left-[10%] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 65%)",
          filter: "blur(60px)",
          animation: "signupFloat 22s ease-in-out infinite",
        }} />
      <div className="absolute top-[30%] right-[8%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(168,197,255,0.5), transparent 65%)",
          filter: "blur(70px)",
        }} />

      {/* Grain texture */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />

{/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-10 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-xs tracking-[0.2em]">KONSOLIDATOR</span>
        </div>

        <button
          type="button"
          onClick={() => { sessionStorage.removeItem(STORAGE_KEY); navigate("/"); }}
          className="text-xs font-bold text-white/70 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </header>

{/* Hero — compact */}
      <div className="relative z-10 px-10 pt-3 pb-5 max-w-[1200px] mx-auto w-full shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-5 h-5 rounded-full bg-[#e8394a] text-white text-[10px] font-black flex items-center justify-center">✓</span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Verified</span>
          </div>
          <div className="w-32 relative h-0.5 rounded-full overflow-hidden bg-white/25">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                background: "#e8394a",
                boxShadow: "0 0 12px rgba(232,57,74,0.7)",
              }}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center"
              style={{
                background: progressPct === 100 ? "#e8394a" : "rgba(255,255,255,0.25)",
                color: "#fff",
              }}>
              {progressPct === 100 ? "✓" : "2"}
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">
              Details · {progressPct}%
            </span>
          </div>
        </div>

        <div className="flex items-end justify-between gap-8">
          <h1 className="text-white font-black leading-[0.95] tracking-tight sui-title-glow"
            style={{ fontSize: "clamp(36px, 4.5vw, 52px)" }}>
            Almost there. <span style={{ color: "#0a1647" }}>Let's seal it.</span>
          </h1>
          <p className="text-white/85 text-sm max-w-xs font-medium shrink-0 hidden lg:block">

          </p>
        </div>
      </div>

{/* Body */}
      <div className="relative z-10 flex-1 min-h-0 flex justify-center px-10 pb-4">
        <div className="w-full max-w-[1200px] grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 max-h-full">

          {/* ─── LEFT: form card ─────────────────────────────── */}
          <div className="sui-card p-6 overflow-y-auto" style={{ animation: "signupFadeUp 0.6s ease-out both" }}>
            <div className="flex items-baseline justify-between mb-5">
<div>
                <p className="sui-section-label" style={{ marginBottom: 8 }}>01 · Billing</p>
                <h2 className="text-[#0a1647] font-black text-2xl tracking-tight">Your details</h2>
              </div>
              <p className="text-[#1a2f8a]/40 text-[10px] font-black uppercase tracking-widest">{filledCount}/{checkoutFields.length}</p>
            </div>

            <div className="space-y-5">
              {/* Company */}
              <div>
<p className="sui-subsection-label" style={{ marginBottom: 8 }}>Company</p>
                <div className="space-y-2.5">
                  <div>
                    <label className="sui-label">Legal company name</label>
                    <input type="text" value={coCompanyName} onChange={(e) => setCoCompanyName(e.target.value)}
                      placeholder="Acme Corporation S.L." className="sui-input" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="sui-label">VAT / Tax ID</label>
                      <input type="text" value={coVat} onChange={(e) => setCoVat(e.target.value)}
                        placeholder="ESB12345678" className="sui-input" />
                    </div>
                    <div>
                      <label className="sui-label">Country</label>
                      <input type="text" value={coCountry} onChange={(e) => setCoCountry(e.target.value)}
                        placeholder="Spain" className="sui-input" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Address */}
              <div>
<p className="sui-subsection-label" style={{ marginBottom: 8 }}>Billing address</p>
                <div className="space-y-2.5">
                  <div>
                    <label className="sui-label">Street</label>
                    <input type="text" value={coAddress} onChange={(e) => setCoAddress(e.target.value)}
                      placeholder="Calle Mayor 1" className="sui-input" />
                  </div>
                  <div className="grid grid-cols-[1fr_1.6fr] gap-3">
                    <div>
                      <label className="sui-label">Postal code</label>
                      <input type="text" value={coPostal} onChange={(e) => setCoPostal(e.target.value)}
                        placeholder="28013" className="sui-input" />
                    </div>
                    <div>
                      <label className="sui-label">City</label>
                      <input type="text" value={coCity} onChange={(e) => setCoCity(e.target.value)}
                        placeholder="Madrid" className="sui-input" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div>
<p className="sui-subsection-label" style={{ marginBottom: 8 }}>Primary contact</p>
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="sui-label">Full name</label>
                      <input type="text" value={coName} onChange={(e) => setCoName(e.target.value)}
                        placeholder="Jane Doe" className="sui-input" />
                    </div>
                    <div>
                      <label className="sui-label">Phone</label>
                      <input type="tel" value={coPhone} onChange={(e) => setCoPhone(e.target.value)}
                        placeholder="+34 600 000 000" className="sui-input" />
                    </div>
                  </div>
                  <div>
                    <label className="sui-label">Billing email</label>
                    <input type="email" value={coEmail} onChange={(e) => setCoEmail(e.target.value)}
                      placeholder="billing@company.com" className="sui-input" />
                  </div>
                </div>
              </div>
            </div>
          </div>

{/* ─── RIGHT: summary card ───────────────────────── */}
          <div className="sui-card p-6 relative overflow-y-auto"
            style={{ animation: "signupFadeUp 0.6s ease-out 0.1s both" }}>

            <div className="relative">
              <p className="sui-section-label" style={{ marginBottom: 8 }}>02 · Plan</p>
              <h2 className="text-[#0a1647] font-black text-2xl tracking-tight leading-tight">
                Group Reporting.
              </h2>
              <p className="text-[#1a2f8a]/55 text-xs mt-1.5 mb-5 font-medium">Konsolidator® IFRS consolidation</p>

              {/* iOS segmented term */}
              <label className="sui-label">License term</label>
              <div
                className="relative grid grid-cols-2 p-1 rounded-xl"
                style={{
                  background: "rgba(26,47,138,0.07)",
                  border: "1px solid rgba(26,47,138,0.1)",
                }}
              >
                <div
                  className="absolute top-1 bottom-1 rounded-lg transition-transform duration-300 ease-out"
                  style={{
                    width: "calc(50% - 4px)",
                    transform: planYears === 3 ? "translateX(calc(100% + 4px))" : "translateX(0)",
                    background: "#fff",
                    boxShadow: "0 2px 6px rgba(15,31,92,0.15), 0 1px 2px rgba(15,31,92,0.08)",
                  }}
                />
                {[1, 3].map((years) => {
                  const active = planYears === years;
                  return (
                    <button
                      key={years}
                      type="button"
                      onClick={() => setPlanYears(years)}
                      className="relative z-10 py-2.5 px-3 rounded-lg transition-colors"
                    >
                      <span className="text-sm font-black transition-colors"
                        style={{ color: active ? "#1a2f8a" : "rgba(26,47,138,0.4)" }}>
                        {years} year{years > 1 ? "s" : ""}
                      </span>
                      {years === 3 && (
                        <span className="text-[10px] font-bold ml-1.5 transition-colors"
                          style={{ color: active ? "#e8394a" : "rgba(232,57,74,0.35)" }}>
                          −10%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
<p className="text-[#1a2f8a]/50 text-[11px] tabular-nums font-medium mt-2 mb-5">
                ≈ €{monthlyEquiv.toLocaleString("es-ES")}/month
              </p>

              {/* Line items */}
              <div className="space-y-2.5 pb-4 border-b border-[#1a2f8a]/10">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#0a1647]">License</p>
                    <p className="text-[11px] text-[#1a2f8a]/55 tabular-nums">
                      €{LICENSE_PER_YEAR.toLocaleString("es-ES")} × {planYears} year{planYears > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    {discountPct > 0 && (
                      <p className="text-[11px] text-[#1a2f8a]/35 line-through tabular-nums">
                        €{licenseGross.toLocaleString("es-ES")}
                      </p>
                    )}
                    <p className="text-sm font-black text-[#0a1647] tabular-nums">
                      €{licenseNet.toLocaleString("es-ES")}
                    </p>
                  </div>
                </div>

                {yourSavings > 0 && (
                  <div className="flex items-baseline justify-between">
                    <p className="text-[12px] font-bold" style={{ color: "#059669" }}>You save</p>
                    <p className="text-[12px] font-bold tabular-nums" style={{ color: "#059669" }}>
                      −€{yourSavings.toLocaleString("es-ES")}
                    </p>
                  </div>
                )}

                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#0a1647]">Implementation</p>
                    <p className="text-[11px] text-[#1a2f8a]/55">4 days × €900 · one-time</p>
                  </div>
                  <p className="text-sm font-black text-[#0a1647] tabular-nums">
                    €{IMPLEMENTATION.toLocaleString("es-ES")}
                  </p>
                </div>
              </div>

{/* Total */}
              <div className="pt-4 pb-4">
                <p className="text-[10px] font-black text-[#1a2f8a]/55 uppercase tracking-[0.18em] mb-1">Total due today</p>
                <p className="font-black tabular-nums leading-none text-[#0a1647]"
                  style={{ fontSize: "clamp(36px, 4vw, 48px)" }}>
                  €{total.toLocaleString("es-ES")}
                </p>
                <p className="text-[11px] text-[#1a2f8a]/50 mt-1.5 font-medium">VAT excluded · Invoiced on activation</p>
              </div>

              {/* CTA */}
              <button
                type="button"
                disabled
                className="w-full text-white font-black py-3 rounded-xl text-sm tracking-wide transition-all disabled:opacity-90 cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #e8394a 0%, #cf2c3d 100%)",
                  boxShadow: "0 12px 30px -8px rgba(232,57,74,0.55), inset 0 1px 0 rgba(255,255,255,0.2)",
                }}
              >
                Continue to payment →
              </button>
              <p className="text-[10px] text-[#1a2f8a]/45 text-center mt-2 font-medium">
                No auto-renewal
              </p>
            </div>
          </div>
        </div>
      </div>

{/* Footer trust */}
      <footer className="relative z-10 px-10 pb-4 shrink-0">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between border-t border-[#1a2f8a]/15 pt-3">
          <span className="text-[10px] text-[#1a2f8a]/55 tracking-widest font-bold">POWERED BY KONSOLIDATOR® · IFRS CONSOLIDATED REPORTING</span>
          <div className="flex items-center gap-6">
            {[
              { t: "Secure", s: "256-bit TLS" },
              { t: "IFRS",   s: "Compliant" },
              { t: "EU",     s: "Hosted" },
              { t: "GDPR",   s: "Ready" },
            ].map((b) => (
              <div key={b.t} className="text-center">
                <p className="text-[10px] font-black text-[#0a1647]">{b.t}</p>
                <p className="text-[9px] text-[#1a2f8a]/50 mt-0.5 font-medium">{b.s}</p>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}