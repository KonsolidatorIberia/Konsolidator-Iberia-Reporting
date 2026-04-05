import { useState } from "react";

const TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    } catch  {
      setError("Invalid credentials. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0f4ff] to-[#e8eeff] flex items-center justify-center p-8">
      <div className="flex w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl">

        {/* Left */}
        <div className="hidden lg:flex w-1/2 bg-[#1a2f8a] flex-col justify-between p-14 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-white opacity-5" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-white opacity-5" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
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
          <div className="relative z-10 grid grid-cols-2 gap-3">
            {[
              { label: "Consolidated P&L", desc: "Live data" },
              { label: "Group KPIs", desc: "Interactive" },
              { label: "Multi-currency", desc: "Auto FX" },
              { label: "By Dimensions", desc: "Drill down" },
            ].map((f) => (
              <div key={f.label} className="bg-white/10 rounded-xl p-4 border border-white/10">
                <p className="text-white font-semibold text-sm">{f.label}</p>
                <p className="text-blue-300 text-xs mt-1">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div className="flex-1 bg-white flex items-center justify-center p-14">
          <div className="w-full max-w-sm">
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
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="you@konsolidator.com"
                  className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                  className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-800 outline-none focus:border-[#1a2f8a] transition-all bg-gray-50"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                  <p className="text-red-500 text-sm">{error}</p>
                </div>
              )}
              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full bg-[#e8394a] hover:bg-[#d02e3e] text-white font-black py-4 rounded-2xl transition-all text-sm tracking-wide disabled:opacity-50 shadow-lg shadow-red-200"
              >
                {loading ? "Signing in..." : "Sign In →"}
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