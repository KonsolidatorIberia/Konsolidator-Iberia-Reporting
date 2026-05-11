import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Login from "../auth/Login.jsx";
import AdminPortal from "../auth/AdminPortal.jsx";
import ReportingActivationPanel from "../auth/ReportingActivationPanel.jsx";
import BlockedPanel from "../auth/BlockedPanel.jsx";
import Shell from "../components/layout/Shell.jsx";
import AppRoutes from "./routes.jsx";
import { SettingsProvider } from "../components/layout/SettingsContext.jsx";
import EpicLoader from "../components/layout/EpicLoader.jsx";

const TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

// ════════════════════════════════════════════════════════════════
// MainApp — flujo de la app de reporting con gating según
// estado de Supabase tras login B2C.
// ════════════════════════════════════════════════════════════════
function MainApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [creds, setCreds] = useState(null);
  const [reportingStatus, setReportingStatus] = useState(null);
  const [loaderActive, setLoaderActive] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [preloadedData, setPreloadedData] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleLogin = (accessToken, userData, credentials, reporting) => {
    setToken(accessToken);
    setUser(userData);
    setCreds(credentials);
    setReportingStatus(reporting);

    // Solo arrancamos el loader si el usuario tiene acceso "active".
    // Para los demás casos (needs_activation, inactive, trial_expired)
    // mostramos el panel correspondiente sin cargar datos pesados.
    if (reporting?.status === "active") {
      setLoaderActive(true);
      setShellReady(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setCreds(null);
    setReportingStatus(null);
    setLoaderActive(false);
    setShellReady(false);
    setPreloadedData(null);
  };

  // Llamado desde ReportingActivationPanel cuando el usuario activa
  // la prueba con éxito. Hacemos como si el reporting status fuera
  // "active" y seguimos el flujo normal de carga.
  const handleActivationSuccess = (newReportingStatus) => {
    setReportingStatus(newReportingStatus);
    setLoaderActive(true);
    setShellReady(false);
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

  // ────────────────────────────────────────────────────────
  // GATING
  // ────────────────────────────────────────────────────────

  // 1. No hay token → login
  if (!token) return <Login onLogin={handleLogin} />;

  // 2. Login B2C OK pero NO tiene cuenta de reporting → activación
  if (reportingStatus?.status === "needs_activation") {
    return (
      <ReportingActivationPanel
        email={reportingStatus.email}
        password={reportingStatus.password}
        onLogout={handleLogout}
        onActivated={handleActivationSuccess}
      />
    );
  }

  // 3. Cuenta inactiva → panel bloqueante
  if (reportingStatus?.status === "inactive") {
    return (
      <BlockedPanel
        variant="inactive"
        email={reportingStatus.email}
        onLogout={handleLogout}
      />
    );
  }

  // 4. Trial expirado → panel bloqueante
  if (reportingStatus?.status === "trial_expired") {
    return (
      <BlockedPanel
        variant="trial_expired"
        email={reportingStatus.email}
        company={reportingStatus.company}
        onLogout={handleLogout}
      />
    );
  }

  // 5. Error técnico → panel bloqueante genérico
  if (reportingStatus?.status === "error") {
    return (
      <BlockedPanel
        variant="error"
        message={reportingStatus.message}
        onLogout={handleLogout}
      />
    );
  }

  // 6. Acceso completo
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


// ════════════════════════════════════════════════════════════════
// App — bifurcación según URL.
// ════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminPortal />} />
      <Route path="/*"     element={<MainApp />} />
    </Routes>
  );
}