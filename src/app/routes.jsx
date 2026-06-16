import { lazy, Suspense } from "react";

const HomePage                    = lazy(() => import("../components/layout/HomePage.jsx"));
const IndividualesPage            = lazy(() => import("../components/layout/IndividualesPage.jsx"));
const KpiIndividualesPage         = lazy(() => import("../components/layout/KpiIndividualesPage"));
const ContributivePage            = lazy(() => import("../components/layout/ContributivePage.jsx"));
const DimensionesPage             = lazy(() => import("../components/layout/DimensionesPage.jsx"));
const ConsolidationSheetPage      = lazy(() => import("../components/layout/ConsolidationSheetPage.jsx"));
const StructurePage               = lazy(() => import("../components/layout/StructurePage.jsx"));
const SettingsPage                = lazy(() => import("../components/layout/SettingsPage.jsx"));
const CashFlowPage                = lazy(() => import("../components/layout/CashFlowPage.jsx"));
const IndividualCashFlowPage      = lazy(() => import("../components/layout/IndividualCashFlowPage.jsx"));
const MemoryNotesPage             = lazy(() => import("../components/layout/MemoryNotesPage.jsx"));
const ConsolidatedDimensionesPage = lazy(() => import("../components/layout/ConsolidatedDimensionesPage.jsx"));
const ConsolidatedMemoryNotesPage = lazy(() => import("../components/layout/ConsolidatedMemoryNotesPage.jsx"));
const ConsolidatedKpiPage         = lazy(() => import("../components/layout/ConsolidatedKpiPage.jsx"));
const MappingsPage                = lazy(() => import("../components/layout/MappingsPage.jsx"));
import { useMemo } from "react";
import { useCurrentUserPermissions, useCurrentUserResourceAccess } from "../lib/userPermissionsApi";
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

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-[#1a2f8a] animate-spin" />
    </div>
  );
}

function AppRoutesInner({ token, user, activePage, onNavigate, preloadedData }) {
  const rawData = preloadedData ?? {};
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

  // Block rendering until both page perms and resource access have loaded.
  // Avoids passing transient/empty data to children (which can cause hook
  // count mismatches in chart libraries like Recharts that bail out on
  // zero-sized containers).
  if (!loaded || !accessLoaded) return <PageFallback />;

  if (activePage !== "user") {
    const allowed = activePage === "settings"
      ? (can("settings-personalization") || can("settings-security"))
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
    />
  );

  if (activePage === "individual-contributive") return (
    <ContributivePage token={token} />
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
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );

if (activePage === "consolidated-sheet") return (
    <ConsolidationSheetPage token={token} />
  );


  if (activePage === "individual-kpis") return (
    <KpiIndividualesPage
      token={token}
      sources={sharedData.sources ?? []}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );
if (activePage === "consolidated-cashflow") return (
    <CashFlowPage token={token} />
  );

if (activePage === "individual-cashflow") return (
    <IndividualCashFlowPage token={token} />
  );

  if (activePage === "individual-memory-notes") return (
    <MemoryNotesPage
      token={token}
      sources={sharedData.sources ?? []}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
    />
  );

if (activePage === "consolidated-kpis") return (
    <ConsolidatedKpiPage token={token} />
  );

  if (activePage === "consolidated-notes") return (
    <ConsolidatedMemoryNotesPage token={token} />
  );

  if (activePage === "consolidated-dimensiones") return (
    <ConsolidatedDimensionesPage
      token={token}
      sources={sharedData.sources ?? []}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
    />
  );
if (activePage === "settings") return <SettingsPage token={token} preloadedData={rawData} />;
if (activePage === "mappings") return (
    <MappingsPage token={token} preloadedData={sharedData} />
  );

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
    <Suspense fallback={<PageFallback />}>
      <AppRoutesInner {...props} />
    </Suspense>
  );
}