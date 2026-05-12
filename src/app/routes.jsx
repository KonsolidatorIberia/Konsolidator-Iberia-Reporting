import HomePage from "../components/layout/HomePage.jsx";
import IndividualesPage from "../components/layout/IndividualesPage.jsx";
import KpiIndividualesPage from "../components/layout/KpiIndividualesPage";
import ContributivePage from "../components/layout/ContributivePage.jsx";
import DimensionesPage from "../components/layout/DimensionesPage.jsx";
import ConsolidationSheetPage from "../components/layout/ConsolidationSheetPage.jsx";
import StructurePage from "../components/layout/StructurePage.jsx";
import SettingsPage from "../components/layout/SettingsPage.jsx";
import CashFlowPage from "../components/layout/CashFlowPage.jsx";
import IndividualCashFlowPage    from "../components/layout/IndividualCashFlowPage.jsx";
import MemoryNotesPage            from "../components/layout/MemoryNotesPage.jsx";
import ConsolidatedDimensionesPage    from "../components/layout/ConsolidatedDimensionesPage.jsx";
import ConsolidatedMemoryNotesPage    from "../components/layout/ConsolidatedMemoryNotesPage.jsx";
import ConsolidatedKpiPage            from "../components/layout/ConsolidatedKpiPage.jsx";

export default function AppRoutes({ token, user, activePage, preloadedData }) {
  const sharedData = preloadedData ?? {};

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
  if (activePage === "settings") return <SettingsPage />;

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-6xl mb-4">🚧</p>
        <p className="text-xl font-black text-gray-300">Coming soon</p>
      </div>
    </div>
  );
}