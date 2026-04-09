import { useState } from "react";
import HomePage from "../components/layout/HomePage.jsx";
import IndividualesPage from "../components/layout/IndividualesPage.jsx";
import KpiIndividualesPage from "../components/layout/KpiIndividualesPage";
import ContributivePage from "../components/layout/ContributivePage.jsx";
import DimensionesPage from "../components/layout/DimensionesPage.jsx";




export default function AppRoutes({ token, activePage, onNavigate }) {
  const [sharedData, setSharedData] = useState({});

  if (activePage === "home") return (
    <HomePage token={token} onNavigate={onNavigate} onDataLoaded={setSharedData} />
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

if (activePage === "individual-dimensiones") return (
  <DimensionesPage
    token={token}
    sources={sharedData.sources ?? []}
    structures={sharedData.structures ?? []}
    companies={sharedData.companies ?? []}
    dimensions={sharedData.dimensions ?? []}
  />
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

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-6xl mb-4">🚧</p>
        <p className="text-xl font-black text-gray-300">Coming soon</p>
      </div>
    </div>
  );
}