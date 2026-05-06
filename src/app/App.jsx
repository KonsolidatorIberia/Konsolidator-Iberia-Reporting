import { useState } from "react";
import Login from "../auth/Login.jsx";
import Shell from "../components/layout/Shell.jsx";
import AppRoutes from "./routes.jsx";
import { SettingsProvider } from "../components/layout/SettingsContext.jsx";
import EpicLoader from "../components/layout/EpicLoader.jsx";

const TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [creds, setCreds] = useState(null);
  const [loaderActive, setLoaderActive] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [preloadedData, setPreloadedData] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleLogin = (accessToken, userData, credentials) => {
    setToken(accessToken);
    setUser(userData);
    setCreds(credentials);
    setLoaderActive(true);
    setShellReady(false);
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setCreds(null);
    setLoaderActive(false);
    setShellReady(false);
    setPreloadedData(null);
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
      {loaderActive && (
        <EpicLoader
          token={token}
          onDataLoaded={(d) => setPreloadedData(d)}
          onReady={() => {
            setShellReady(true);
            setTimeout(() => setLoaderActive(false), 100);
          }}
        />
      )}
      <div
        style={{
          opacity: shellReady ? 1 : 0,
          transform: shellReady ? "scale(1)" : "scale(0.96)",
          transition: "opacity 600ms cubic-bezier(0.4,0,0.2,1) 100ms, transform 600ms cubic-bezier(0.4,0,0.2,1) 100ms",
        }}
      >
        <Shell key={refreshKey} user={user} onLogout={handleLogout} onRefresh={handleRefresh}>
          {(activePage, onNavigate) => (
            <AppRoutes
              token={token}
              activePage={activePage}
              onNavigate={onNavigate}
              preloadedData={preloadedData}
            />
          )}
        </Shell>
      </div>
    </SettingsProvider>
  );
}