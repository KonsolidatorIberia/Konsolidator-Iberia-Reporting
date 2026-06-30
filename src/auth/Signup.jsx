import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
const TOKEN_URL  = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID  = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE      = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";
const STORAGE_KEY = "signup_verification";
const IDLE_MS    = 10 * 60 * 1000;

// EU + common partner countries. `vat` = { example, regex }
// Regex are permissive — only enough to nudge the user, not bank-grade validation.
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
  // Non-EU partners
  { code: "GB", name: "United Kingdom", vat: { example: "GB123456789",      regex: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/i } },
  { code: "CH", name: "Switzerland",    vat: { example: "CHE-123.456.789",  regex: /^CHE-?\d{3}\.?\d{3}\.?\d{3}$/i } },
  { code: "NO", name: "Norway",         vat: { example: "NO123456789MVA",   regex: /^NO\d{9}(MVA)?$/i } },
  { code: "US", name: "United States",  vat: { example: "EIN 12-3456789",   regex: /^\d{2}-?\d{7}$/ } },
{ code: "CA", name: "Canada",         vat: { example: "123456789RT0001",  regex: /^\d{9}(RT|RC|RP)\d{4}$/i } },

  // ── Latin America ─────────────────────────────────────────────
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

// Country dial codes + flag emoji, keyed by ISO code
// Used for the phone prefix selector in the checkout step
const COUNTRY_DIAL = {
  AT: { dial: "+43",  flag: "🇦🇹", example: "1 234 5678" },
  BE: { dial: "+32",  flag: "🇧🇪", example: "470 12 34 56" },
  BG: { dial: "+359", flag: "🇧🇬", example: "87 123 4567" },
  HR: { dial: "+385", flag: "🇭🇷", example: "91 234 5678" },
  CY: { dial: "+357", flag: "🇨🇾", example: "96 123456" },
  CZ: { dial: "+420", flag: "🇨🇿", example: "601 234 567" },
  DK: { dial: "+45",  flag: "🇩🇰", example: "20 12 34 56" },
  EE: { dial: "+372", flag: "🇪🇪", example: "501 2345" },
  FI: { dial: "+358", flag: "🇫🇮", example: "40 123 4567" },
  FR: { dial: "+33",  flag: "🇫🇷", example: "6 12 34 56 78" },
  DE: { dial: "+49",  flag: "🇩🇪", example: "151 23456789" },
  GR: { dial: "+30",  flag: "🇬🇷", example: "691 234 5678" },
  HU: { dial: "+36",  flag: "🇭🇺", example: "20 123 4567" },
  IE: { dial: "+353", flag: "🇮🇪", example: "85 012 3456" },
  IT: { dial: "+39",  flag: "🇮🇹", example: "312 345 6789" },
  LV: { dial: "+371", flag: "🇱🇻", example: "21 234 567" },
  LT: { dial: "+370", flag: "🇱🇹", example: "612 34567" },
  LU: { dial: "+352", flag: "🇱🇺", example: "628 123 456" },
  MT: { dial: "+356", flag: "🇲🇹", example: "9696 1234" },
  NL: { dial: "+31",  flag: "🇳🇱", example: "6 12345678" },
  PL: { dial: "+48",  flag: "🇵🇱", example: "512 345 678" },
  PT: { dial: "+351", flag: "🇵🇹", example: "912 345 678" },
  RO: { dial: "+40",  flag: "🇷🇴", example: "712 345 678" },
  SK: { dial: "+421", flag: "🇸🇰", example: "912 123 456" },
  SI: { dial: "+386", flag: "🇸🇮", example: "31 234 567" },
  ES: { dial: "+34",  flag: "🇪🇸", example: "612 34 56 78" },
  SE: { dial: "+46",  flag: "🇸🇪", example: "70 123 45 67" },
  GB: { dial: "+44",  flag: "🇬🇧", example: "7400 123456" },
  CH: { dial: "+41",  flag: "🇨🇭", example: "78 123 45 67" },
  NO: { dial: "+47",  flag: "🇳🇴", example: "406 12 345" },
  US: { dial: "+1",   flag: "🇺🇸", example: "201 555 0123" },
  CA: { dial: "+1",   flag: "🇨🇦", example: "416 555 0123" },
  MX: { dial: "+52",  flag: "🇲🇽", example: "55 1234 5678" },
  BR: { dial: "+55",  flag: "🇧🇷", example: "11 91234 5678" },
  AR: { dial: "+54",  flag: "🇦🇷", example: "9 11 1234 5678" },
  CL: { dial: "+56",  flag: "🇨🇱", example: "9 1234 5678" },
  CO: { dial: "+57",  flag: "🇨🇴", example: "320 123 4567" },
  PE: { dial: "+51",  flag: "🇵🇪", example: "912 345 678" },
  UY: { dial: "+598", flag: "🇺🇾", example: "94 123 456" },
  PY: { dial: "+595", flag: "🇵🇾", example: "961 234567" },
  BO: { dial: "+591", flag: "🇧🇴", example: "71234567" },
  EC: { dial: "+593", flag: "🇪🇨", example: "99 123 4567" },
  VE: { dial: "+58",  flag: "🇻🇪", example: "412 1234567" },
  DO: { dial: "+1",   flag: "🇩🇴", example: "809 555 0123" },
  CR: { dial: "+506", flag: "🇨🇷", example: "8312 3456" },
  PA: { dial: "+507", flag: "🇵🇦", example: "6123 4567" },
  GT: { dial: "+502", flag: "🇬🇹", example: "5123 4567" },
};
const DEFAULT_DIAL = { dial: "+34", flag: "🇪🇸", example: "612 34 56 78" };

// Credentials store (email + password B2C) kept across signup steps so we
// can create the auth.users with the same password and auto-sign-in after.
// Cleared right after account creation.
const CREDS_KEY = "signup_creds";

const readCreds = () => {
  try {
    const raw = sessionStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(CREDS_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
};
const writeCreds = (email, password) => {
  sessionStorage.setItem(CREDS_KEY, JSON.stringify({
    email, password,
    expiresAt: Date.now() + IDLE_MS,
  }));
};
const clearCreds = () => { try { sessionStorage.removeItem(CREDS_KEY); } catch {} };

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
  const location = useLocation();

  // URL ↔ step mapping
  const urlToStep = (path) => {
    if (path.endsWith("/payment")) return "payment";
    if (path.endsWith("/details")) return "checkout";
    return "verify";
  };
  const stepToUrl = (s) => {
    if (s === "payment")  return "/signup/payment";
    if (s === "checkout") return "/signup/details";
    return "/signup";
  };

  const [step, setStep] = useState(() => {
    const fromUrl = urlToStep(location.pathname);
    // If user lands on /details or /payment but has no valid token → bounce to verify
    if ((fromUrl === "checkout" || fromUrl === "payment") && !readToken()) return "verify";
    return fromUrl;
  });

  // Keep URL in sync when step changes programmatically
  useEffect(() => {
    const desired = stepToUrl(step);
    if (location.pathname !== desired) navigate(desired, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Respond to URL changes (browser back/forward)
  useEffect(() => {
    const fromUrl = urlToStep(location.pathname);
    if (fromUrl !== step) {
      if ((fromUrl === "checkout" || fromUrl === "payment") && !readToken()) {
        navigate("/signup", { replace: true });
        setStep("verify");
      } else {
        setStep(fromUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

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
  const [coStreetNumber, setCoStreetNumber] = useState("");
  const [coPostal, setCoPostal]           = useState("");
  const [coCity, setCoCity]               = useState("");
  const [coName, setCoName]               = useState("");
  const [coPhoneDial, setCoPhoneDial]     = useState("+34");
  const [coPhone, setCoPhone]             = useState("");
  const [coEmail, setCoEmail]             = useState(() => readToken()?.email ?? "");
const [planYears, setPlanYears]         = useState(3);

// Phone dial dropdown
  const [dialOpen, setDialOpen]     = useState(false);
  const [dialPos, setDialPos]       = useState(null);
  const [dialSearch, setDialSearch] = useState("");

// ─── Country combobox state ────────────────────────────────────
  const [countryOpen, setCountryOpen]           = useState(false);
  const [countryHighlight, setCountryHighlight] = useState(0);
  const [coVatBlurred, setCoVatBlurred]         = useState(false);

  // ─── Address autocomplete state ────────────────────────────────
  const [addrSuggestions, setAddrSuggestions] = useState([]);
  const [addrLoading, setAddrLoading]         = useState(false);
  const [addrOpen, setAddrOpen]               = useState(false);
  const [addrHighlight, setAddrHighlight]     = useState(-1);
  const addrAbortRef     = useRef(null);
  const addrDebounceRef  = useRef(null);
  const addrSilenceRef   = useRef(false); // true after picking, suppresses next query

  // ─── Payment state ─────────────────────────────────────────────
  const [payIban, setPayIban]               = useState("");
  const [payHolder, setPayHolder]           = useState("");
  const [payAcceptTerms, setPayAcceptTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (step !== "checkout") return;
const bump = () => {
      lastActivityRef.current = Date.now();
      const tk = readToken();
      if (tk) writeToken(tk.email);
      const cr = readCreds();
      if (cr) writeCreds(cr.email, cr.password);
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

const handleVerify = async (overrideEmail, overridePassword) => {
    const emailToUse    = typeof overrideEmail    === "string" ? overrideEmail    : vEmail;
    const passwordToUse = typeof overridePassword === "string" ? overridePassword : vPassword;

    console.log("[handleVerify] start", { emailToUse, hasPwd: !!passwordToUse });

    if (!emailToUse || !passwordToUse) {
      setVError("Please enter your Konsolidator email and password.");
      return;
    }
    setVLoading(true);
    setVError("");

    // Dev bypass for testing
    const isDummyTest =
      import.meta.env.DEV &&
      emailToUse.trim().toLowerCase().endsWith("@dummytest.dev") &&
      passwordToUse === "dummytest123";

    let b2cOk = false;
    if (isDummyTest) {
      b2cOk = true;
    } else {
      try {
        const params = new URLSearchParams();
        params.append("grant_type", "password");
        params.append("client_id", CLIENT_ID);
        params.append("scope", SCOPE);
        params.append("username", emailToUse);
        params.append("password", passwordToUse);
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        b2cOk = res.ok;
      } catch { b2cOk = false; }
    }

console.log("[handleVerify] b2cOk =", b2cOk);

    if (!b2cOk) {
      setVLoading(false);
      setVError("Invalid Konsolidator credentials.");
      return;
    }

    // Block if company already exists
    const domainPart = emailToUse.split("@")[1] ?? "";
    const slug = domainPart.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
    console.log("[handleVerify] slug =", slug);
    if (slug) {
      try {
        const { data: companyExists, error: rpcErr } = await supabase
          .rpc("company_exists_by_slug", { p_slug: slug });
        console.log("[handleVerify] companyExists =", companyExists, "error =", rpcErr);
        if (companyExists === true) {
          setVLoading(false);
          setVError("This company already exists. Please ask your admin for access.");
          return;
        }
      } catch (e) {
        console.error("[handleVerify] rpc threw:", e);
      }
    }
console.log("[handleVerify] writing token + creds + advancing to checkout");
    writeToken(emailToUse);
    writeCreds(emailToUse, passwordToUse);
    setCoEmail(emailToUse);
    setVLoading(false);
    setStep("checkout");
  };

  // ─── Auto-verify if credentials were handed off from Login ─────
  // Login stores { email, password, ts } in sessionStorage under
  // "signup_autoverify" when it detects a B2C-valid user with no
  // reporting account. We consume it once on mount.
  useEffect(() => {
    if (step !== "verify") return;
    let raw;
    try { raw = sessionStorage.getItem("signup_autoverify"); }
    catch { return; }
    if (!raw) return;

    sessionStorage.removeItem("signup_autoverify");

    let payload;
    try { payload = JSON.parse(raw); }
    catch { return; }

    // Expire after 60 seconds to avoid acting on stale credentials
    if (!payload?.email || !payload?.password || Date.now() - (payload.ts ?? 0) > 60_000) return;

    setVEmail(payload.email);
    setVPassword(payload.password);
    handleVerify(payload.email, payload.password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

// ─── Address autocomplete (Photon / OpenStreetMap) ─────────────
  // Photon docs: https://photon.komoot.io
  // Free, no key required, returns clean JSON with structured properties.

  const fetchAddressSuggestions = (query) => {
    if (addrDebounceRef.current) clearTimeout(addrDebounceRef.current);
    if (addrAbortRef.current)    addrAbortRef.current.abort();

    if (!query || query.trim().length < 3) {
      setAddrSuggestions([]);
      setAddrLoading(false);
      setAddrOpen(false);
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
      } catch (e) {
        if (e.name !== "AbortError") {
          setAddrSuggestions([]);
          setAddrOpen(false);
        }
      } finally {
        setAddrLoading(false);
      }
    }, 300);
  };

  const formatSuggestion = (f) => {
    const p = f.properties ?? {};
    const street = [p.name, p.housenumber].filter(Boolean).join(" ");
    const cityPart = p.city ?? p.town ?? p.village ?? p.county ?? "";
    const parts = [street, cityPart, p.postcode, p.country].filter(Boolean);
    return parts.join(", ");
  };

const pickSuggestion = (f) => {
    const p = f.properties ?? {};
    addrSilenceRef.current = true; // prevent re-query from the setCoAddress below
    setCoAddress(p.name ?? "");
    setCoStreetNumber(p.housenumber ?? "");
    setCoCity(p.city ?? p.town ?? p.village ?? p.county ?? "");
    setCoPostal(p.postcode ?? "");
    setCoCountry(p.country ?? "");
    setAddrOpen(false);
    setAddrSuggestions([]);
    setAddrHighlight(-1);
    // Re-enable querying after this tick
    setTimeout(() => { addrSilenceRef.current = false; }, 50);
  };

  const handleAddressChange = (value) => {
    setCoAddress(value);
    if (addrSilenceRef.current) return;
    fetchAddressSuggestions(value);
  };

  const handleAddressKeyDown = (e) => {
    if (!addrOpen || addrSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAddrHighlight(h => Math.min(h + 1, addrSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAddrHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && addrHighlight >= 0) {
      e.preventDefault();
      pickSuggestion(addrSuggestions[addrHighlight]);
    } else if (e.key === "Escape") {
      setAddrOpen(false);
    }
  };

// ─── Country combobox + VAT format ─────────────────────────────
  const selectedCountry = COUNTRIES.find(
    c => c.name.toLowerCase() === coCountry.trim().toLowerCase() ||
         c.code.toLowerCase() === coCountry.trim().toLowerCase()
  );

const filteredCountries = (() => {
    const q = coCountry.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().startsWith(q)
    );
  })();

  const vatPlaceholder = selectedCountry?.vat.example ?? "Select a country first";
// Validate only when the input has reached the expected length (or beyond),
  // or after blur. Avoids flagging "still typing" as an error.
  const vatLooksValid = (() => {
    if (!coVat.trim() || !selectedCountry) return null;
    const cleaned     = coVat.replace(/\s+/g, "");
    const exampleLen  = selectedCountry.vat.example.replace(/\s+/g, "").length;
    if (cleaned.length < exampleLen && !coVatBlurred) return null;
    return selectedCountry.vat.regex.test(cleaned);
  })();

const pickCountry = (c) => {
    setCoCountry(c.name);
    setCountryOpen(false);
    setCountryHighlight(0);
    setCoVatBlurred(false); // reset validation feedback for the new country
    // Auto-set the phone dial code to match the country
    const meta = COUNTRY_DIAL[c.code];
    if (meta) setCoPhoneDial(meta.dial);
  };

const handleCountryKeyDown = (e) => {
    if (!countryOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setCountryOpen(true);
      }
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
      // Prefer exact case-insensitive name/code match over the highlighted row
      const q = coCountry.trim().toLowerCase();
      const exact = filteredCountries.find(c =>
        c.name.toLowerCase() === q || c.code.toLowerCase() === q
      );
      const target = exact ?? filteredCountries[countryHighlight];
      if (target) pickCountry(target);
    } else if (e.key === "Escape") {
      setCountryOpen(false);
    }
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
  const checkoutFields = [coCompanyName, coVat, coCountry, coAddress, coStreetNumber, coPostal, coCity, coName, coPhone, coEmail];
  const filledCount = checkoutFields.filter(v => v && v.trim() !== "").length;
  const progressPct = Math.round((filledCount / checkoutFields.length) * 100);

// ─── Confirm + create company + first user + auto-login ──────
  const [confirmError, setConfirmError]     = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);

const handleConfirmAndPay = async (payIban, payHolder) => {
    setConfirmError("");
    setConfirmLoading(true);

    const creds = readCreds();
    if (!creds?.email || !creds?.password) {
      setConfirmLoading(false);
      setConfirmError("Session expired. Please start over.");
      setTimeout(() => navigate("/signup"), 1500);
      return;
    }

    // Build slug from company name
    const slug = coCompanyName.trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    if (!slug) {
      setConfirmLoading(false);
      setConfirmError("Invalid company name.");
      return;
    }

    const fullPhone = coPhone.trim() ? `${coPhoneDial} ${coPhone.trim()}` : null;
    const ibanClean = payIban.replace(/\s+/g, "").toUpperCase();

    try {
      const res = await fetch(
        "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/create-account",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
          },
          body: JSON.stringify({
            email: creds.email,
            password: creds.password,
            company: {
              name: coCompanyName.trim(),
              slug,
              country:             coCountry || null,
              vat_id:              coVat.trim() || null,
              street:              coAddress.trim() || null,
              street_number:       coStreetNumber.trim() || null,
              postal_code:         coPostal.trim() || null,
              city:                coCity.trim() || null,
              full_name:           coName.trim() || null,
              phone:               fullPhone,
              bank_holder_name:    payHolder.trim() || null,
              bank_iban:           ibanClean || null,
              billing_emails:      coEmail.trim() ? [coEmail.trim()] : [],
              contract_start_date: new Date().toISOString().slice(0, 10),
            },
          }),
        },
      );

      const result = await res.json();
      if (!res.ok || !result?.ok) {
        throw new Error(result?.error ?? `Error ${res.status}`);
      }

      // Account is created. Now sign in with the same credentials so the
      // session is active when we land on the dashboard.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: creds.email,
        password: creds.password,
      });
      if (signInErr) {
        // Account exists but autologin failed — send them to login
        clearCreds();
        sessionStorage.removeItem(STORAGE_KEY);
        navigate("/");
        return;
      }

      // Cleanup and go to dashboard
      clearCreds();
      sessionStorage.removeItem(STORAGE_KEY);
      navigate("/");
    } catch (e) {
      console.error("[handleConfirmAndPay] failed:", e);
      setConfirmError(e.message ?? "Something went wrong. Please try again.");
      setConfirmLoading(false);
    }
  };

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
      .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
      .no-scrollbar::-webkit-scrollbar { display: none; }
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
                  onClick={() => handleVerify()}
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
onClick={() => { sessionStorage.removeItem(STORAGE_KEY); clearCreds(); navigate("/"); }}
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
                    {/* Country combobox (first) */}
                    <div className="relative">
                      <label className="sui-label">Country</label>
                      <input
                        type="text"
                        value={coCountry}
                       onChange={(e) => {
                          const v = e.target.value;
                          setCoCountry(v);
                          setCountryOpen(true);
                          // Try to highlight an exact match first; otherwise reset to 0
                          const q = v.trim().toLowerCase();
                          const idx = COUNTRIES.findIndex(c =>
                            c.name.toLowerCase() === q || c.code.toLowerCase() === q
                          );
                          setCountryHighlight(idx >= 0
                            ? COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().startsWith(q))
                                       .findIndex(c => c.name.toLowerCase() === q || c.code.toLowerCase() === q)
                            : 0);
                        }}
                        onFocus={() => setCountryOpen(true)}
                        onBlur={() => setTimeout(() => setCountryOpen(false), 150)}
                        onKeyDown={handleCountryKeyDown}
                        placeholder="Spain"
                        className="sui-input"
                        autoComplete="off"
                      />
                      {countryOpen && filteredCountries.length > 0 && (
                        <div
                          className="absolute z-30 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                          style={{
                            background: "rgba(255,255,255,0.96)",
                            backdropFilter: "blur(20px)",
                            border: "1px solid rgba(26,47,138,0.15)",
                            boxShadow: "0 20px 50px -12px rgba(15,31,92,0.25)",
                            maxHeight: 240,
                            overflowY: "auto",
                          }}
                        >
                          {filteredCountries.map((c, i) => {
                            const active = i === countryHighlight;
                            return (
                              <button
                                key={c.code}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); pickCountry(c); }}
                                onMouseEnter={() => setCountryHighlight(i)}
                                className="w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-2"
                                style={{ background: active ? "rgba(26,47,138,0.08)" : "transparent" }}
                              >
                                <span className="text-[13px] font-bold text-[#0a1647] truncate">{c.name}</span>
                                <span className="text-[10px] font-mono text-[#1a2f8a]/45 shrink-0">{c.code}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {countryOpen && filteredCountries.length === 0 && coCountry.trim() && (
                        <div
                          className="absolute z-30 left-0 right-0 mt-1 rounded-xl px-3 py-2.5"
                          style={{
                            background: "rgba(255,255,255,0.96)",
                            backdropFilter: "blur(20px)",
                            border: "1px solid rgba(26,47,138,0.15)",
                          }}>
                          <p className="text-[11px] text-[#1a2f8a]/55 font-medium">No match. Keep typing or use a different name.</p>
                        </div>
                      )}
                    </div>

                    {/* VAT (depends on country) */}
                    <div>
                      <label className="sui-label flex items-center justify-between">
                        <span>VAT / Tax ID</span>
                        {selectedCountry && (
                          <span className="text-[9px] font-mono normal-case tracking-normal text-[#1a2f8a]/40">
                            {selectedCountry.code} format
                          </span>
                        )}
                      </label>
<input
                        type="text"
                        value={coVat}
                        onChange={(e) => { setCoVat(e.target.value.toUpperCase()); setCoVatBlurred(false); }}
                        onBlur={() => setCoVatBlurred(true)}
                        placeholder={vatPlaceholder}
                        disabled={!selectedCountry}
                        className="sui-input font-mono"
                        style={{
                          borderColor:
                            vatLooksValid === false ? "rgba(232,57,74,0.45)" :
                            vatLooksValid === true  ? "rgba(5,150,105,0.45)" :
                            undefined,
                        }}
                      />
                      {coVat && vatLooksValid === false && (
                        <p className="text-[10px] text-[#e8394a] font-bold mt-1">
                          Doesn't match the {selectedCountry?.name} format
                        </p>
                      )}
                      {coVat && vatLooksValid === true && (
                        <p className="text-[10px] font-bold mt-1" style={{ color: "#059669" }}>
                          ✓ Looks valid
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Address */}
              <div>
<p className="sui-subsection-label" style={{ marginBottom: 8 }}>Billing address</p>
                <div className="space-y-2.5">
<div className="grid grid-cols-[2fr_1fr] gap-3">
                    <div className="relative">
                    <label className="sui-label">Street</label>
                    <input
                      type="text"
                      value={coAddress}
                      onChange={(e) => handleAddressChange(e.target.value)}
                      onFocus={() => { if (addrSuggestions.length > 0) setAddrOpen(true); }}
                      onBlur={() => setTimeout(() => setAddrOpen(false), 150)}
                      onKeyDown={handleAddressKeyDown}
                      placeholder="Start typing…"
                      className="sui-input"
                      autoComplete="off"
                    />

                    {/* Loading indicator */}
                    {addrLoading && (
                      <span className="absolute right-3 top-[34px] inline-block w-3.5 h-3.5 rounded-full border-2 border-[#1a2f8a]/20 border-t-[#1a2f8a] signup-spin pointer-events-none" />
                    )}

                    {/* Suggestions dropdown */}
                    {addrOpen && addrSuggestions.length > 0 && (
                      <div
                        className="absolute z-30 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                        style={{
                          background: "rgba(255,255,255,0.96)",
                          backdropFilter: "blur(20px)",
                          border: "1px solid rgba(26,47,138,0.15)",
                          boxShadow: "0 20px 50px -12px rgba(15,31,92,0.25)",
                        }}
                      >
                        {addrSuggestions.map((f, i) => {
                          const p = f.properties ?? {};
                          const street = [p.name, p.housenumber].filter(Boolean).join(" ");
                          const sub = [p.city ?? p.town ?? p.village, p.postcode, p.country]
                            .filter(Boolean).join(", ");
                          const active = i === addrHighlight;
                          return (
                            <button
                              key={`${p.osm_id}-${i}`}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(f); }}
                              onMouseEnter={() => setAddrHighlight(i)}
                              className="w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2"
                              style={{ background: active ? "rgba(26,47,138,0.08)" : "transparent" }}
                            >
                              <span className="text-[#1a2f8a]/40 mt-0.5 shrink-0" style={{ fontSize: 11 }}>📍</span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[13px] font-bold text-[#0a1647] truncate">
                                  {street || p.name || "—"}
                                </span>
                                {sub && (
                                  <span className="block text-[11px] text-[#1a2f8a]/55 truncate">{sub}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
<div className="px-3 py-1.5 border-t border-[#1a2f8a]/10 flex items-center justify-between"
                          style={{ background: "rgba(26,47,138,0.03)" }}>
                          <span className="text-[9px] text-[#1a2f8a]/40 font-medium">
                            Powered by{" "}
                            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
                              className="text-[#1a2f8a]/55 hover:text-[#1a2f8a] underline">
                              OpenStreetMap
                            </a>
                          </span>
                          <span className="text-[9px] text-[#1a2f8a]/40">↑↓ Enter</span>
                        </div>
                      </div>
                    )}
                    </div>
                    <div>
                      <label className="sui-label">Number</label>
                      <input type="text" value={coStreetNumber}
                        onChange={(e) => setCoStreetNumber(e.target.value)}
                        placeholder="12B" className="sui-input" />
                    </div>
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
<div className="relative">
                      <label className="sui-label">Phone</label>
                      <div className="flex gap-2">
                        <button type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            const margin = 16;
                            const maxH = 280;
                            const spaceBelow = window.innerHeight - r.bottom - margin;
                            const spaceAbove = r.top - margin;
                            const openUp = spaceAbove > spaceBelow + 40;
                            const height = Math.min(maxH, Math.max(140, openUp ? spaceAbove : spaceBelow));
                            setDialPos({
                              top:   openUp ? r.top - height - 6 : r.bottom + 6,
                              left:  r.left,
                              width: 240,
                              height,
                            });
                            setDialOpen(o => !o);
                          }}
                          className="sui-input flex items-center gap-1.5 shrink-0 cursor-pointer"
                          style={{ width: "auto", minWidth: 100, paddingRight: 10 }}>
                          <span style={{ fontSize: 18, lineHeight: 1 }}>
                            {Object.values(COUNTRY_DIAL).find(m => m.dial === coPhoneDial)?.flag ?? DEFAULT_DIAL.flag}
                          </span>
                          <span className="font-mono font-bold text-sm">{coPhoneDial}</span>
                          <span className="text-[#1a2f8a]/40 text-[10px] ml-auto">▾</span>
                        </button>
<input type="tel" value={coPhone}
                          onChange={(e) => setCoPhone(e.target.value.replace(/[^\d\s\-()]/g, ""))}
                          placeholder={Object.values(COUNTRY_DIAL).find(m => m.dial === coPhoneDial)?.example ?? DEFAULT_DIAL.example}
                          className="sui-input flex-1" />
                      </div>
                      {dialOpen && dialPos && createPortal(
                        <>
{/* Backdrop catches outside clicks */}
                          <div className="fixed inset-0 z-[9998]"
                            onMouseDown={() => { setDialOpen(false); setDialSearch(""); }} />
<div className="fixed z-[9999] rounded-xl flex flex-col"
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{
                              top: dialPos.top, left: dialPos.left,
                              width: dialPos.width, maxHeight: dialPos.height,
                              background: "rgba(255,255,255,0.98)",
                              backdropFilter: "blur(20px)",
                              border: "1px solid rgba(26,47,138,0.15)",
                              boxShadow: "0 20px 50px -12px rgba(15,31,92,0.25)",
                              overflow: "hidden",
                            }}>
                            {/* Sticky search */}
                            <div className="p-2 border-b shrink-0" style={{ borderColor: "rgba(26,47,138,0.1)" }}>
                              <input type="text" autoFocus
                                value={dialSearch}
                                onChange={(e) => setDialSearch(e.target.value)}
                                placeholder="Search country or +code"
                                className="w-full px-3 py-2 text-[12px] rounded-lg outline-none"
                                style={{
                                  background: "rgba(26,47,138,0.05)",
                                  border: "1px solid rgba(26,47,138,0.1)",
                                  color: "#0a1647",
                                }} />
                            </div>

                            {/* Results */}
                            <div className="flex-1 overflow-y-auto no-scrollbar">
                              {(() => {
                                const q = dialSearch.trim().toLowerCase();
                                const matches = COUNTRIES.filter(c => {
                                  const meta = COUNTRY_DIAL[c.code];
                                  if (!meta) return false;
                                  if (!q) return true;
                                  return (
                                    c.name.toLowerCase().includes(q) ||
                                    c.code.toLowerCase().startsWith(q) ||
                                    meta.dial.replace("+", "").startsWith(q.replace("+", ""))
                                  );
                                });
                                if (matches.length === 0) {
                                  return (
                                    <div className="px-3 py-6 text-center">
                                      <p className="text-[11px] font-bold text-[#1a2f8a]/55">No match for "{dialSearch}"</p>
                                    </div>
                                  );
                                }
                                return matches.map(c => {
                                  const meta = COUNTRY_DIAL[c.code];
                                  const active = meta.dial === coPhoneDial;
                                  return (
                                    <button key={c.code} type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        setCoPhoneDial(meta.dial);
                                        setDialOpen(false);
                                        setDialSearch("");
                                      }}
                                      className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                                      style={{ background: active ? "rgba(26,47,138,0.08)" : "transparent" }}
                                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(26,47,138,0.04)"; }}
                                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                                      <span style={{ fontSize: 16 }}>{meta.flag}</span>
                                      <span className="text-[12px] font-bold text-[#0a1647] flex-1 truncate">{c.name}</span>
                                      <span className="text-[11px] font-mono text-[#1a2f8a]/55">{meta.dial}</span>
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </>,
                        document.body
                      )}
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
                onClick={() => setStep("payment")}
                disabled={progressPct < 100}
                className="w-full text-white font-black py-3 rounded-xl text-sm tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: progressPct < 100
                    ? "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)"
                    : "linear-gradient(135deg, #e8394a 0%, #cf2c3d 100%)",
                  boxShadow: progressPct === 100
                    ? "0 12px 30px -8px rgba(232,57,74,0.55), inset 0 1px 0 rgba(255,255,255,0.2)"
                    : "none",
                }}
              >
                {progressPct < 100 ? `Complete all fields (${filledCount}/${checkoutFields.length})` : "Continue to payment →"}
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

{/* PAYMENT STEP ───────────────────────────────────────── */}
      {step === "payment" && (
        <PaymentOverlay
          coCompanyName={coCompanyName}
          coEmail={coEmail}
          planYears={planYears}
          licenseNet={licenseNet}
          licenseGross={licenseGross}
          discountPct={discountPct}
          yourSavings={yourSavings}
          IMPLEMENTATION={IMPLEMENTATION}
          total={total}
          payIban={payIban}
          setPayIban={setPayIban}
          payHolder={payHolder}
          setPayHolder={setPayHolder}
          payAcceptTerms={payAcceptTerms}
          setPayAcceptTerms={setPayAcceptTerms}
          showTermsModal={showTermsModal}
          setShowTermsModal={setShowTermsModal}
          confirmLoading={confirmLoading}
          confirmError={confirmError}
          onConfirm={() => handleConfirmAndPay(payIban, payHolder)}
          onBack={() => setStep("checkout")}
          onCancel={() => { sessionStorage.removeItem(STORAGE_KEY); clearCreds(); navigate("/"); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAYMENT STEP COMPONENT
// ═══════════════════════════════════════════════════════════════
function PaymentOverlay({
  coCompanyName, coEmail, planYears,
  licenseNet, licenseGross, discountPct, yourSavings, IMPLEMENTATION, total,
  payIban, setPayIban, payHolder, setPayHolder,
  payAcceptTerms, setPayAcceptTerms,
  showTermsModal, setShowTermsModal,
  confirmLoading, confirmError, onConfirm,
  onBack, onCancel,
}) {
  // IBAN basic format check (length + alphanumeric, no real checksum)
  const ibanClean = payIban.replace(/\s+/g, "").toUpperCase();
  const ibanLooksValid = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ibanClean);
  const canSubmit = ibanLooksValid && payHolder.trim().length >= 3 && payAcceptTerms;

  // Pretty-print IBAN in groups of 4
  const handleIbanChange = (raw) => {
    const cleaned = raw.replace(/\s+/g, "").toUpperCase().slice(0, 34);
    const grouped = cleaned.match(/.{1,4}/g)?.join(" ") ?? "";
    setPayIban(grouped);
  };

  return (
    <div className="fixed inset-0 z-50 h-screen flex flex-col overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 40%, #a8c5ff 75%, #e8f1ff 100%)",
        animation: "signupFadeUp 0.4s ease-out both",
      }}>
      <style>{`
        @keyframes signupFloat {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, -40px); }
        }
        .sui-card-pay {
          background: rgba(255,255,255,0.65);
          border: 1px solid rgba(255,255,255,0.9);
          backdrop-filter: blur(20px) saturate(140%);
          -webkit-backdrop-filter: blur(20px) saturate(140%);
          border-radius: 24px;
          box-shadow: 0 30px 80px -20px rgba(15,31,92,0.35), 0 8px 24px -8px rgba(15,31,92,0.18);
        }
        .sui-input-pay {
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
        .sui-input-pay::placeholder { color: rgba(26,47,138,0.3); }
        .sui-input-pay:focus {
          border-color: #1a2f8a;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(26,47,138,0.12);
        }
        .sui-title-glow-pay {
          text-shadow: 0 0 40px rgba(255,255,255,0.5), 0 0 80px rgba(168,197,255,0.6);
        }
      `}</style>

      {/* Atmospherics */}
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

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-10 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-[#1a2f8a] font-black text-sm">[K</span>
          </div>
          <span className="text-white font-black text-xs tracking-[0.2em]">KONSOLIDATOR</span>
        </div>
        <div className="flex items-center gap-5">
          <button type="button" onClick={onBack}
            className="text-xs font-bold text-white/70 hover:text-white transition-colors">
            ← Back
          </button>
          <button type="button" onClick={onCancel}
            className="text-xs font-bold text-white/70 hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </header>

      {/* Hero */}
      <div className="relative z-10 px-10 pt-3 pb-5 max-w-[1200px] mx-auto w-full shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-5 h-5 rounded-full bg-[#e8394a] text-white text-[10px] font-black flex items-center justify-center">✓</span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Verified</span>
          </div>
          <div className="w-12 h-0.5 rounded-full bg-[#e8394a]" style={{ boxShadow: "0 0 8px rgba(232,57,74,0.7)" }} />
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-5 h-5 rounded-full bg-[#e8394a] text-white text-[10px] font-black flex items-center justify-center">✓</span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Details</span>
          </div>
          <div className="w-12 h-0.5 rounded-full bg-[#e8394a]" style={{ boxShadow: "0 0 8px rgba(232,57,74,0.7)" }} />
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-5 h-5 rounded-full bg-white text-[#1a2f8a] text-[10px] font-black flex items-center justify-center">3</span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Payment</span>
          </div>
        </div>

        <div className="flex items-end justify-between gap-8">
          <h1 className="text-white font-black leading-[0.95] tracking-tight sui-title-glow-pay"
            style={{ fontSize: "clamp(36px, 4.5vw, 52px)" }}>
            One last step. <span style={{ color: "#0a1647" }}>Lock it in.</span>
          </h1>
          <p className="text-white/85 text-sm max-w-xs font-medium shrink-0 hidden lg:block">
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 flex-1 min-h-0 flex justify-center px-10 pb-4">
        <div className="w-full max-w-[1200px] grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 max-h-full">

          {/* LEFT: payment form */}
          <div className="sui-card-pay p-6 overflow-y-auto" style={{ animation: "signupFadeUp 0.6s ease-out both" }}>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
              style={{ color: "#e8394a", letterSpacing: "0.22em" }}>03 · Payment</p>
            <h2 className="text-[#0a1647] font-black text-2xl tracking-tight mb-1">Bank details</h2>
            <p className="text-[#1a2f8a]/55 text-sm mb-6 font-medium">
              SEPA direct debit · charged in EUR
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] mb-2 text-[#1a2f8a]/55">
                  Account holder
                </label>
                <input
                  type="text"
                  value={payHolder}
                  onChange={(e) => setPayHolder(e.target.value)}
                  placeholder="As it appears on the bank statement"
                  className="sui-input-pay"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] mb-2 text-[#1a2f8a]/55">
                  IBAN
                </label>
                <input
                  type="text"
                  value={payIban}
                  onChange={(e) => handleIbanChange(e.target.value)}
                  placeholder="ES00 0000 0000 0000 0000 0000"
                  className="sui-input-pay font-mono tracking-wider"
                  style={{
                    borderColor: payIban && !ibanLooksValid ? "rgba(232,57,74,0.5)" : undefined,
                  }}
                />
                {payIban && !ibanLooksValid && (
                  <p className="text-[11px] text-[#e8394a] font-bold mt-1.5">
                    Doesn't look like a valid IBAN
                  </p>
                )}
                {ibanLooksValid && (
                  <p className="text-[11px] font-bold mt-1.5" style={{ color: "#059669" }}>
                    ✓ IBAN looks valid
                  </p>
                )}
              </div>
            </div>

            {/* SEPA mandate */}
            <div className="mt-6 p-4 rounded-xl"
              style={{ background: "rgba(26,47,138,0.05)", border: "1px solid rgba(26,47,138,0.1)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] mb-2 text-[#1a2f8a]/55">
                SEPA mandate
              </p>
              <p className="text-[11px] text-[#0a1647]/75 leading-relaxed font-medium">
                By signing this mandate form, you authorise Konsolidator® to send instructions to your
                bank to debit your account, and your bank to debit your account in accordance with the
                instructions. You are entitled to a refund from your bank under the terms of your
                agreement with your bank within eight weeks starting from the date on which your
                account was debited.
              </p>
            </div>

            {/* Terms checkbox */}
            <div className="mt-6">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={payAcceptTerms}
                  onChange={(e) => setPayAcceptTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-[#e8394a] cursor-pointer shrink-0"
                />
                <span className="text-[12px] text-[#0a1647]/80 leading-relaxed font-medium">
                  I have read and accept the{" "}
                  <button type="button"
                    onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }}
                    className="text-[#e8394a] font-black underline underline-offset-2 hover:text-[#cf2c3d]">
                    Terms and Conditions
                  </button>
                  {" "}and authorise Konsolidator® to charge my account via SEPA direct debit on activation.
                </span>
              </label>
            </div>
          </div>

          {/* RIGHT: summary recap */}
          <div className="sui-card-pay p-6 relative overflow-y-auto"
            style={{ animation: "signupFadeUp 0.6s ease-out 0.1s both" }}>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
              style={{ color: "#e8394a" }}>Order recap</p>
            <h2 className="text-[#0a1647] font-black text-2xl tracking-tight">Group Reporting.</h2>
            <p className="text-[#1a2f8a]/55 text-xs mt-1.5 mb-5 font-medium">
              {coCompanyName || "Your company"} · {planYears} year{planYears > 1 ? "s" : ""}
            </p>

            <div className="space-y-2.5 pb-4 border-b border-[#1a2f8a]/10">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-sm font-bold text-[#0a1647]">License</p>
                  <p className="text-[11px] text-[#1a2f8a]/55 tabular-nums">
                    {planYears} year{planYears > 1 ? "s" : ""}{discountPct > 0 ? ` · -${discountPct}%` : ""}
                  </p>
                </div>
                <p className="text-sm font-black text-[#0a1647] tabular-nums">
                  €{licenseNet.toLocaleString("es-ES")}
                </p>
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
                  <p className="text-[11px] text-[#1a2f8a]/55">One-time</p>
                </div>
                <p className="text-sm font-black text-[#0a1647] tabular-nums">
                  €{IMPLEMENTATION.toLocaleString("es-ES")}
                </p>
              </div>
            </div>

            {/* Total */}
            <div className="pt-4 pb-4">
              <p className="text-[10px] font-black text-[#1a2f8a]/55 uppercase tracking-[0.18em] mb-1">
                Total due today
              </p>
              <p className="font-black tabular-nums leading-none text-[#0a1647]"
                style={{ fontSize: "clamp(36px, 4vw, 48px)" }}>
                €{total.toLocaleString("es-ES")}
              </p>
              <p className="text-[11px] text-[#1a2f8a]/50 mt-1.5 font-medium">
                VAT excluded · Charged on activation
              </p>
            </div>

            {/* Billing email reminder */}
            <div className="mb-4 p-3 rounded-xl"
              style={{ background: "rgba(26,47,138,0.04)", border: "1px solid rgba(26,47,138,0.08)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#1a2f8a]/55 mb-0.5">
                Invoice will be sent to
              </p>
              <p className="text-[12px] font-bold text-[#0a1647] truncate">{coEmail}</p>
            </div>

{confirmError && (
              <div className="mb-3 rounded-xl px-3 py-2.5"
                style={{ background: "rgba(232,57,74,0.08)", border: "1px solid rgba(232,57,74,0.25)" }}>
                <p className="text-[#e8394a] text-xs font-bold">{confirmError}</p>
              </div>
            )}

            {/* Confirm CTA */}
            <button
              type="button"
              disabled={!canSubmit || confirmLoading}
              onClick={onConfirm}
              className="w-full text-white font-black py-3.5 rounded-xl text-sm tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: canSubmit
                  ? "linear-gradient(135deg, #e8394a 0%, #cf2c3d 100%)"
                  : "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)",
                boxShadow: canSubmit
                  ? "0 12px 30px -8px rgba(232,57,74,0.55), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "none",
              }}
            >
              {confirmLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white signup-spin" />
                  Creating your account…
                </span>
              ) : canSubmit
                ? `Confirm and pay €${total.toLocaleString("es-ES")}`
                : "Complete bank details and accept terms"}
            </button>
            <p className="text-[10px] text-[#1a2f8a]/45 text-center mt-2 font-medium">
              No charge until activation · You can cancel anytime before
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 px-10 pb-4 shrink-0">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between border-t border-[#1a2f8a]/15 pt-3">
          <span className="text-[10px] text-[#1a2f8a]/55 tracking-widest font-bold">
            POWERED BY KONSOLIDATOR® · IFRS CONSOLIDATED REPORTING
          </span>
          <div className="flex items-center gap-6">
            {[
              { t: "SEPA",   s: "EU direct debit" },
              { t: "Secure", s: "256-bit TLS" },
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

      {/* Terms modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: "rgba(10,22,71,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowTermsModal(false)}>
          <div
            className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: "82vh", boxShadow: "0 40px 80px -20px rgba(0,0,0,0.4)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="px-7 py-5 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-[#0a1647] font-black text-lg">Terms and Conditions</h3>
              <button type="button" onClick={() => setShowTermsModal(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="px-7 py-5 overflow-y-auto text-sm text-gray-700 leading-relaxed space-y-4">
              <p className="font-bold text-[#0a1647]">1. Service</p>
              <p>Konsolidator® provides IFRS consolidated reporting software-as-a-service. License is granted for the term selected at signup (1 or 3 years), starting on activation.</p>

              <p className="font-bold text-[#0a1647]">2. Billing</p>
              <p>The annual license fee plus one-time implementation fee is charged via SEPA direct debit on activation. VAT is added where applicable. Licenses do not auto-renew; you'll be contacted before term end.</p>

              <p className="font-bold text-[#0a1647]">3. Refunds</p>
              <p>Implementation fees are non-refundable once work has started. License fees may be partially refunded pro-rata in case of platform-wide service failure as defined in the SLA.</p>

              <p className="font-bold text-[#0a1647]">4. Data</p>
              <p>Your data is hosted in the EU (Frankfurt region) and encrypted at rest and in transit. You retain ownership at all times. GDPR processor terms apply.</p>

              <p className="font-bold text-[#0a1647]">5. Cancellation</p>
              <p>You may cancel within 14 days of activation for a full refund of the license fee. After that, the term commitment applies.</p>

              <p className="text-xs text-gray-400 pt-4 border-t border-gray-100">
                Placeholder terms — replace with your real legal copy before launch.
              </p>
            </div>
            <div className="px-7 py-4 border-t border-gray-100 flex justify-end">
              <button type="button" onClick={() => setShowTermsModal(false)}
                className="px-5 py-2.5 text-xs font-black text-white rounded-xl"
                style={{ background: "linear-gradient(135deg, #e8394a 0%, #cf2c3d 100%)" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}