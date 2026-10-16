import { lazy, Suspense } from "react";

const HomePage                    = lazy(() => import("../components/layout/HomePage.jsx"));
const IndividualesPage            = lazy(() => import("../pages/Individuals/IndividualesPage.jsx"));
const KpiIndividualesPage         = lazy(() => import("../pages/KPI/individual/KpiIndividualesPage.jsx"));
const ContributivePage            = lazy(() => import("../pages/Contributive/index.js"));
const DimensionesPage             = lazy(() => import("../pages/dimensions/DimensionesPage.jsx"));
const ConsolidationSheetPage      = lazy(() => import("../pages/ConsolidationSheet/index.js"));
const StructurePage               = lazy(() => import("../pages/structure/index.js"));
const SettingsPage                = lazy(() => import("../pages/Settings/index.js"));
const CashFlowPage                = lazy(() => import("../pages/CashFlow/CashFlowConsolidated/index.js"));
const IndividualCashFlowPage      = lazy(() => import("../pages/CashFlow/CashFlowIndividual/index.js"));
const ConsolidatedDimensionesPage = lazy(() => import("../pages/dimensions/ConsolidatedDimensionesPage.jsx"));
const ConsolidatedKpiPage         = lazy(() => import("../pages/KPI/consolidated/ConsolidatedKpiPage.jsx"));
const MappingsPage                = lazy(() => import("../components/layout/MappingsPage.jsx"));
const StatisticalPartiesPage = lazy(() => import("../components/layout/StatisticalPartiesPage.jsx"));
const CashFlowMappingsView        = lazy(() => import("../components/views/CashFlowMappingsView.jsx"));
const AdminOnboardingPage         = lazy(() => import("../components/pages/AdminOnboardingPage.jsx"));
const PresentationsPage           = lazy(() => import("../pages/presentations/index.js"));
import { useEffect, useMemo, useRef } from "react";
import { useCurrentUserPermissions, useCurrentUserResourceAccess } from "../lib/userPermissionsApi";
import { useSettings } from "../components/layout/SettingsContext";
import { t } from "../lib/i18n";
import ProgressLoader from "../components/framework/ProgressLoader.jsx";
function AccessDenied() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(145deg, #ef4444 0%, #dc2626 100%)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <p className="text-gray-700 font-black text-base mb-2">Access denied</p>
        <p className="text-gray-400 text-xs">You don't have permission to view this page. Contact an administrator if you need access.</p>
      </div>
    </div>
  );
}

// Las antiguas páginas de notas de la memoria (Individual / Consolidado) llevan
// ahora a Presentaciones › Notas de memoria y usan su permiso.
const MEMORY_KEYS = new Set(["presentations-memory", "individual-memory-notes", "consolidated-notes"]);

/* Cargador mientras se descarga el código de la página (y los permisos).
   Es el cargador común (ProgressLoader) en modo relevo: cuando la página
   monta su propio cargador, este le pasa el porcentaje y la posición, así
   que se ve uno solo de principio a fin (antes asomaba unos segundos un
   círculo pequeño antes del bueno). */
const PAGE_NAV_KEY = {
  "home": "nav_home", "individual-data": "nav_data", "individual-contributive": "nav_contributive",
  "consolidated-sheet": "nav_sheet", "individual-cashflow": "nav_cashflow", "consolidated-cashflow": "nav_cashflow",
  "individual-dimensiones": "nav_dimensions", "consolidated-dimensiones": "nav_dimensions",
  "individual-kpis": "nav_kpis", "consolidated-kpis": "nav_kpis", "mappings": "nav_mappings",
  "cashflow-mappings": "nav_mappings", "structure": "nav_structure", "settings": "nav_settings",
  "statistical-parties": "nav_statistical_parties", "individual-memory-notes": "nav_memory_notes",
  "consolidated-notes": "nav_memory_notes", "presentations-memory": "nav_memory_notes",
};
const OPENING = { es: "Abriendo", en: "Opening", da: "Åbner", pt: "A abrir" };
const PREPARING = { es: "Preparando la página", en: "Preparing the page", da: "Forbereder siden", pt: "A preparar a página" };

function PageFallback({ page }) {
  const { colors, locale } = useSettings();
  const lang = OPENING[locale] ? locale : String(locale ?? "").slice(0, 2);
  const navKey = PAGE_NAV_KEY[page];
  const name = navKey ? t(locale, navKey, "") : "";
  const area = String(page ?? "").startsWith("consolidated") ? t(locale, "nav_consolidated", "")
    : String(page ?? "").startsWith("individual") ? t(locale, "nav_individual", "") : "";
  return (
    <div className="relative h-full min-h-0">
      <ProgressLoader
        relay
        hideSteps
        primary={colors?.primary ?? "#1a2f8a"}
        secondary={colors?.secondary ?? "#CF305D"}
        title={name ? `${OPENING[lang] ?? OPENING.en} ${name}` : (PREPARING[lang] ?? PREPARING.en)}
        subtitle={area || undefined}
        // Descargar el código es solo el principio: se queda en un ~10 %
        // y la página sigue desde ahí con sus propias fases.
        steps={[
          { key: "page", label: "page", weight: 1, state: "active" },
          { key: "rest", label: "rest", weight: 9, state: "pending" },
        ]}
      />
    </div>
  );
}

function AppRoutesInner({ token, user, activePage, onNavigate, preloadedData }) {
const rawData = useMemo(() => preloadedData ?? {}, [preloadedData]);
  const { can, loaded } = useCurrentUserPermissions();
  const { loaded: accessLoaded, access } = useCurrentUserResourceAccess();

  // Filter resources by current user's access. Admins (no rows in
  // user_resource_access) see everything. Pages that need the full list
  // (e.g. UserManagement) receive rawData explicitly below.
const sharedData = useMemo(() => {
    if (!accessLoaded) return rawData;
    const filterBy = (items, kind, getId) => {
      const set = access[kind];
      if (!set) return items;
      return items.filter(item => set.has(String(getId(item))));
    };
    return {
      ...rawData,
      companies:  filterBy(rawData.companies  ?? [], "company",   c => c.CompanyShortName ?? c.companyShortName ?? c),
      structures: filterBy(rawData.structures ?? [], "structure", s => s.GroupStructure ?? s.groupStructure ?? s),
      sources:    filterBy(rawData.sources    ?? [], "source",    s => s.Source ?? s.source ?? s),
      dimensions: filterBy(rawData.dimensions ?? [], "dimension", d => {
        const code = String(d.DimensionCode ?? d.dimensionCode ?? d.code ?? d.Code ?? "");
        const name = String(d.DimensionName ?? d.dimensionName ?? d.name ?? d.Name ?? code);
        return code || name;
      }),
    };
}, [rawData, accessLoaded, access]);

  // ── Botón "atrás" del navegador ──────────────────────────────────────
  // Cada página del menú deja una entrada en el historial. Al pulsar "atrás"
  // desde cualquiera de ellas se vuelve a Inicio, en lugar de salir de la
  // app. La navegación interna de una página (p. ej. abrir una presentación)
  // conserva su entrada y la gestiona la propia página.
  const activeRef = useRef(activePage);
  useEffect(() => { activeRef.current = activePage; }, [activePage]);
  useEffect(() => {
    const st = window.history.state ?? {};
    if (st.appPage === activePage) return;
    if (activePage === "home") {
      window.history.replaceState({ ...st, appPage: "home" }, "");
      return;
    }
    window.history.pushState({ appPage: activePage }, "");
  }, [activePage]);
  useEffect(() => {
    const onPop = (e) => {
      const st = e.state ?? {};
      const current = activeRef.current;
      if (current === "home") return;                    // desde Inicio, "atrás" sale de la app
      if (st.appPage && st.appPage === current) return;  // navegación interna de la página
      window.history.replaceState({ ...st, appPage: "home" }, "");
      onNavigate?.("home");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onNavigate]);

  // Block rendering until both page perms and resource access have loaded.
  // Avoids passing transient/empty data to children (which can cause hook
  // count mismatches in chart libraries like Recharts that bail out on
  // zero-sized containers).
  if (!loaded || !accessLoaded) return <PageFallback page={activePage} />;

  if (activePage !== "user") {
    const allowed = activePage === "settings"
      ? (can("settings-personalization") || can("settings-security"))
      : MEMORY_KEYS.has(activePage) ? can("presentations-memory")
      : can(activePage);
    if (!allowed) return <AccessDenied pageKey={activePage} />;
  }

if (activePage === "home") return (
    <HomePage token={token} initialData={sharedData} user={user} />
  );

if (activePage === "individual-data") return (
    <IndividualesPage
      token={token}
      onNavigate={onNavigate}
      sources={rawData.sources ?? []}
      structures={rawData.structures ?? []}
      companies={rawData.companies ?? []}
      dimensions={rawData.dimensions ?? []}
      activeStandardKey={rawData?.activeStandardKey ?? null}
    />
  );

if (activePage === "individual-contributive") return (
    <ContributivePage token={token} 
      activeStandardKey={rawData?.activeStandardKey ?? null}
    onNavigate={onNavigate} />
  );

  if (activePage === "structure") return (
    <StructurePage
      token={token}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
    />
  );

if (activePage === "individual-dimensiones") return (
    <DimensionesPage
      token={token}
      onNavigate={onNavigate}
      sources={sharedData.sources ?? []}
      activeStandardKey={rawData?.activeStandardKey ?? null}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );

if (activePage === "consolidated-sheet") return (
    <ConsolidationSheetPage
      token={token}
      onNavigate={onNavigate}
      activeStandardKey={rawData?.activeStandardKey ?? null}
    />
  );

  if (activePage === "individual-kpis") return (
    <KpiIndividualesPage
      token={token}
      sources={sharedData.sources ?? []}
        activeStandardKey={rawData?.activeStandardKey ?? null}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );
if (activePage === "consolidated-cashflow") return (
    <CashFlowPage
      token={token}
      activeStandardKey={rawData?.activeStandardKey ?? null}
    />
  );

if (activePage === "individual-cashflow") return (
    <IndividualCashFlowPage token={token} 
      activeStandardKey={rawData?.activeStandardKey ?? null}
    onNavigate={onNavigate} />
  );

if (activePage === "cashflow-mappings") {
    let pendingEdit = null;
    try {
      const raw = sessionStorage.getItem("cashflow-mappings:openForEdit");
      if (raw) pendingEdit = JSON.parse(raw);
    } catch { /* ignore */ }
    return (
      <CashFlowMappingsView
        token={token}
        preloadedData={sharedData}
        onNavigate={onNavigate}
        pendingEdit={pendingEdit}
        onPendingEditConsumed={() => {
          try { sessionStorage.removeItem("cashflow-mappings:openForEdit"); } catch { /* ignore */ }
        }}
      />
    );
  }

if (activePage === "consolidated-kpis") return (
    <ConsolidatedKpiPage
      token={token}
      activeStandardKey={rawData?.activeStandardKey ?? null}
    />
  );

if (activePage === "consolidated-dimensiones") return (
    <ConsolidatedDimensionesPage
      token={token}
      activeStandardKey={rawData?.activeStandardKey ?? null}
      sources={sharedData.sources ?? []}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );
if (activePage === "statistical-parties") return (
    <StatisticalPartiesPage
      token={token}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );
// Las notas de la memoria están ahora en Presentaciones (pestaña Memorias).
// Si algo todavía abre las páginas antiguas, se va ahí.
// Presentaciones tiene dos entradas en el menú: PowerPoint y Notas de la memoria.
// Los enlaces antiguos a las notas (Individual / Consolidado) van a la segunda.
if (activePage === "presentations" || activePage === "presentations-memory" || activePage === "individual-memory-notes" || activePage === "consolidated-notes") return (
    <PresentationsPage
      key={activePage === "presentations" ? "deck" : "memory"}
      docType={activePage === "presentations" ? "deck" : "memory"}
      token={token}
      activeStandardKey={rawData?.activeStandardKey ?? null}
      sources={sharedData.sources ?? []}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );
if (activePage === "settings") return <SettingsPage token={token} preloadedData={rawData} />;

if (activePage === "admin-onboarding") return <AdminOnboardingPage token={token} onNavigate={onNavigate} />;
if (activePage === "mappings") {
    let pendingEdit = null;
    try {
      const raw = sessionStorage.getItem("mappings:openForEdit");
      if (raw) pendingEdit = JSON.parse(raw);
    } catch { /* ignore */ }
    return (
<MappingsPage
        token={token}
        preloadedData={sharedData}
        activeStandardKey={rawData?.activeStandardKey ?? null}
        onNavigate={onNavigate}
        pendingEdit={pendingEdit}
        onPendingEditConsumed={() => {
          try { sessionStorage.removeItem("mappings:openForEdit"); } catch { /* ignore */ }
        }}
      />
    );
  }

return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-6xl mb-4">🚧</p>
        <p className="text-xl font-black text-gray-300">Coming soon</p>
      </div>
    </div>
  );
}

export default function AppRoutes(props) {
  return (
    <Suspense fallback={<PageFallback page={props.activePage} />}>
      <AppRoutesInner {...props} />
    </Suspense>
  );
}