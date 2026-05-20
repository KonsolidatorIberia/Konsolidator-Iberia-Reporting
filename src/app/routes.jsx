import HomePage                       from "../components/layout/HomePage.jsx";
import IndividualesPage               from "../components/layout/IndividualesPage.jsx";
import KpiIndividualesPage            from "../components/layout/KpiIndividualesPage";
import ContributivePage               from "../components/layout/ContributivePage.jsx";
import DimensionesPage                from "../components/layout/DimensionesPage.jsx";
import ConsolidationSheetPage         from "../components/layout/ConsolidationSheetPage.jsx";
import StructurePage                  from "../components/layout/StructurePage.jsx";
import SettingsPage                   from "../components/layout/SettingsPage.jsx";
import CashFlowPage                   from "../components/layout/CashFlowPage.jsx";
import IndividualCashFlowPage         from "../components/layout/IndividualCashFlowPage.jsx";
import MemoryNotesPage                from "../components/layout/MemoryNotesPage.jsx";
import ConsolidatedDimensionesPage    from "../components/layout/ConsolidatedDimensionesPage.jsx";
import ConsolidatedMemoryNotesPage    from "../components/layout/ConsolidatedMemoryNotesPage.jsx";
import ConsolidatedKpiPage            from "../components/layout/ConsolidatedKpiPage.jsx";
import MappingsPage                   from "../components/layout/MappingsPage.jsx";

import { useCurrentUserPermissions } from "../components/layout/Sidebar.jsx";

function AccessDenied({ pageKey }) {
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

export default function AppRoutes({ token, user, activePage, preloadedData }) {
  const sharedData = preloadedData ?? {};
  const { can, loaded } = useCurrentUserPermissions();

  // Wait until permissions load before gating, otherwise the first paint
  // would block pages momentarily.
  if (loaded && activePage !== "user") {
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
      sources={sharedData.sources ?? []}
      structures={sharedData.structures ?? []}
      companies={sharedData.companies ?? []}
      dimensions={sharedData.dimensions ?? []}
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
if (activePage === "settings") return <SettingsPage token={token} preloadedData={sharedData} />;
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