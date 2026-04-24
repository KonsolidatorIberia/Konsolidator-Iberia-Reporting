import { useState } from "react";
import Login from "../auth/Login.jsx";
import Shell from "../components/layout/Shell.jsx";
import AppRoutes from "./routes.jsx";
import { SettingsProvider } from "../components/layout/SettingsContext.jsx";

const TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

function IntroOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a2f8a]">
      <div className="text-center">
        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
          <span className="text-[#1a2f8a] font-black text-2xl">[K</span>
        </div>
        <p className="text-white font-black text-xl tracking-widest">KONSOLIDATOR</p>
        <p className="text-blue-300 text-xs mt-2 tracking-widest uppercase">Loading your dashboard…</p>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [creds, setCreds] = useState(null);
  const [showIntro, setShowIntro] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleLogin = (accessToken, userData, credentials) => {
    setToken(accessToken);
    setUser(userData);
    setCreds(credentials);
    setShowIntro(true);
    setTimeout(() => setShowIntro(false), 1800);
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setCreds(null);
    setShowIntro(false);
  };

  const handleRefresh = async () => {
    if (!creds) return;
    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("client_id", CLIENT_ID);
    params.append("scope", SCOPE);
    params.append("username", creds.username);
    params.append("password", creds.password);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await res.json();
    if (res.ok) {
      setToken(data.access_token);
      setRefreshKey(k => k + 1);
    }
  };

  if (!token) return <Login onLogin={handleLogin} />;
  return (
    <SettingsProvider>
      {showIntro && <IntroOverlay />}
      <Shell key={refreshKey} user={user} onLogout={handleLogout} onRefresh={handleRefresh}>
        {(activePage, onNavigate) => (
          <AppRoutes token={token} activePage={activePage} onNavigate={onNavigate} />
        )}
      </Shell>
    </SettingsProvider>
  );
}