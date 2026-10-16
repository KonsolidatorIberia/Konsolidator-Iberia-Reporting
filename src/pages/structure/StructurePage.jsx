/* ══════════════════════════════════════════════════════════════════════
   Estructura del grupo — página.

   Arriba, la ficha del grupo: la matriz, cuántas sociedades consolidan, la
   participación media, las monedas, las desvinculadas y los niveles del
   árbol. Debajo, tres vistas: organigrama (lienzo interactivo), empresas
   (tabla) y periodos (mapa de calor de cierres).

   Estructura de la carpeta:
     StructurePage.jsx    → datos, cabecera, ficha del grupo y pestañas
     StructureTree.jsx    → organigrama, ficha de sociedad y desvinculadas
     StructureViews.jsx   → pestañas de empresas y periodos
     structureShared.js   → textos, API, colores y disposición del árbol
     structure.module.css → estilos
     studio/              → estructuras propias (planes Pro y Max)

   Los clientes Base ven la estructura de Konsolidator (solo lectura); los
   Pro y Max configuran la suya (studio/StructureStudio.jsx).
   ══════════════════════════════════════════════════════════════════════ */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Building2, GitBranch, CalendarRange, RefreshCw, AlertTriangle, CheckCircle2, Unlink, Crown } from "lucide-react";
import { useSettings, useSettingsControls, useT } from "../../components/layout/SettingsContext.jsx";
import PageHeader from "../../components/layout/PageHeader.jsx";
import ProgressLoader from "../../components/framework/ProgressLoader.jsx";
import { apiFetch, buildNodes, treeIndex, ccyColor, ownColor, initials, fmtPct, useStText } from "./structureShared.js";
import { OrgCanvas, DetachedRail } from "./StructureTree.jsx";
import { CompaniesView, PeriodsView } from "./StructureViews.jsx";
import { loadAccess, isProTier } from "./studio/studioApi.js";
import s from "./structure.module.css";

const StructureStudio = lazy(() => import("./studio/StructureStudio.jsx"));

// Plan del cliente: Pro y Max configuran su estructura; el resto, la de Konsolidator
export default function StructurePage(props) {
  const { userId } = useSettingsControls();
  const [access, setAccess] = useState(null);
  useEffect(() => {
    let off = false;
    if (!userId) return undefined;
    loadAccess(userId)
      .then(a => { if (!off) setAccess({ ...a, userId }); })
      .catch(() => { if (!off) setAccess({ tier: null, userId }); });
    return () => { off = true; };
  }, [userId]);
  // Hasta saber el plan no se pinta nada (así no se lanza la página Base para nada)
  if (!userId || access?.userId !== userId) return <div className={s.page} />;
  if (access.companyId && isProTier(access.tier)) {
    return (
      <Suspense fallback={<div className={s.page} />}>
        <StructureStudio token={props.token} access={access} />
      </Suspense>
    );
  }
  return <KonsolidatorStructurePage {...props} />;
}

const ENDPOINTS = [
  { key: "groupStructure", path: "/v2/group-structure", step: "gs" },
  { key: "structures", path: "/v2/structures", step: "gs" },
  { key: "companies", path: "/v2/companies", step: "co" },
  { key: "ownership", path: "/v2/ownership", step: "ow" },
  { key: "periods", path: "/v2/periods", step: "pe" },
];

function KonsolidatorStructurePage({ token, structures: sharedStructures = [], companies: sharedCompanies = [] }) {
  const t = useT();
  const tx = useStText();
  const { colors } = useSettings();
  const primary = colors?.primary || "#1a2f8a";

  const [raw, setRaw] = useState({});
  const [loading, setLoading] = useState(true);
  const [doneKeys, setDoneKeys] = useState(() => new Set());
  const [errors, setErrors] = useState({});
  const [tab, setTab] = useState("tree");
  const [structKey, setStructKey] = useState(null);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [periodStruct, setPeriodStruct] = useState("all");
  const [periodSource, setPeriodSource] = useState("all");

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const ctrl = new AbortController();
    Promise.resolve().then(() => { if (!cancelled) { setLoading(true); setErrors({}); setDoneKeys(new Set()); } });
    const mark = (key) => { if (!cancelled) setDoneKeys(prev => new Set(prev).add(key)); };
    Promise.allSettled(ENDPOINTS.map(({ key, path }) => apiFetch(path, token, ctrl.signal).finally(() => mark(key))))
      .then(results => {
        if (ctrl.signal.aborted || cancelled) return;
        const out = {}, errs = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled") out[ENDPOINTS[i].key] = r.value;
          else errs[ENDPOINTS[i].key] = r.reason?.message || "error";
        });
        setRaw(out);
        setErrors(errs);
        setStructKey(prev => {
          const structs = out.structures || [];
          if (structs.find(x => x.groupStructure === prev)) return prev;
          return structs.find(x => x.isDefault)?.groupStructure || structs[0]?.groupStructure || out.groupStructure?.[0]?.groupStructure || null;
        });
        setLoading(false);
      });
    return () => { cancelled = true; ctrl.abort(); };
  }, [token, tick]);

  const companies = raw.companies?.length ? raw.companies : sharedCompanies;
  const { groupStructure = [], ownership = [], periods = [], structures = sharedStructures } = raw;

  const nodes = useMemo(
    () => (structKey ? buildNodes(groupStructure, structKey, companies, ownership) : []),
    [groupStructure, structKey, companies, ownership],
  );
  const connected = useMemo(() => nodes.filter(n => !n.detached), [nodes]);
  const detached = useMemo(() => nodes.filter(n => n.detached), [nodes]);
  const idx = useMemo(() => treeIndex(connected), [connected]);

  // Ficha del grupo
  const root = connected.find(n => idx.roots[0] === n.id);
  const rootCo = root ? companies.find(c => c.companyShortName === root.id) : null;
  const inStruct = nodes.length ? companies.filter(c => nodes.some(n => n.id === c.companyShortName)) : companies;
  const nCons = inStruct.filter(c => c.consolidate).length;
  const owIn = ownership.filter(o => nodes.some(n => n.id === o.companyShortName && !idx.roots.includes(n.id)));
  const avgOwn = owIn.length ? owIn.reduce((a, o) => a + (o.ownershipPercentage || 0), 0) / owIn.length : 0;
  const wholly = owIn.filter(o => (o.ownershipPercentage || 0) >= 100).length;
  const ccys = [...new Set(inStruct.map(c => c.currencyCode).filter(Boolean))];
  const levels = idx.depth.size ? Math.max(...idx.depth.values()) + 1 : 0;

  const goToTree = (id) => {
    setTab("tree");
    setSelected(id);
    setFocus({ id });
  };

  const headerTabs = [
    { id: "tree", label: t("st_tab_tree"), icon: GitBranch },
    { id: "companies", label: t("st_tab_companies"), icon: Building2 },
    { id: "periods", label: t("st_tab_periods"), icon: CalendarRange },
  ];
  const structFilter = structures.length > 1
    ? [{
        label: tx.structure,
        value: structKey || "",
        onChange: (v) => { setStructKey(v); setSelected(null); },
        options: structures.map(x => ({ value: x.groupStructure, label: `${x.groupStructure}${x.isDefault ? " ★" : ""}` })),
      }]
    : [];
  const periodStructOpts = ["all", ...new Set(periods.map(p => p.groupStructure).filter(Boolean))];
  const periodSourceOpts = ["all", ...new Set(periods.map(p => p.source).filter(Boolean))];
  const periodFilters = [
    { label: t("st_all_structures"), value: periodStruct, onChange: setPeriodStruct,
      options: periodStructOpts.map(x => ({ value: x, label: x === "all" ? t("st_all_structures") : x })) },
    { label: t("st_all_sources"), value: periodSource, onChange: setPeriodSource,
      options: periodSourceOpts.map(x => ({ value: x, label: x === "all" ? t("st_all_sources") : x })) },
  ];

  const stepState = (step) => {
    const keys = ENDPOINTS.filter(e => e.step === step).map(e => e.key);
    const n = keys.filter(k => doneKeys.has(k)).length;
    return { state: n === keys.length ? "done" : "active", progress: n / keys.length };
  };
  const steps = [
    { key: "gs", label: tx.loadSteps.gs, weight: 3, ...stepState("gs") },
    { key: "co", label: tx.loadSteps.co, weight: 2, ...stepState("co") },
    { key: "ow", label: tx.loadSteps.ow, weight: 2, ...stepState("ow") },
    { key: "pe", label: tx.loadSteps.pe, weight: 2, ...stepState("pe") },
  ];
  const fatal = !loading && (errors.groupStructure || errors.companies);

  return (
    <div className={s.page} style={{ "--pr": primary }}>
      <PageHeader
        kicker={t("st_kicker", tx.group)}
        title={t("st_title")}
        tabs={headerTabs}
        activeTab={tab}
        onTabChange={(v) => { setTab(v); if (v !== "tree") setSelected(null); }}
        filters={tab === "periods" ? periodFilters : structFilter}
        showAllFilters
        headerSearch={tab === "companies" ? { value: search, onChange: setSearch, placeholder: t("st_search_companies") } : undefined}
        headerActions={[{ icon: RefreshCw, label: t("st_refresh"), onClick: () => setTick(x => x + 1) }]}
      />

      {/* Ficha del grupo */}
      {!loading && !fatal && (
        <section className={s.band}>
          <div className={s.bandId}>
            <span className={s.bandAv} style={{ "--cc": ccyColor(root?.currency) }}>{initials(root?.id)}</span>
            <div className={s.bandName}>
              <h2 title={rootCo?.companyLegalName || root?.label}>{rootCo?.companyLegalName || root?.label || t("st_title")}</h2>
              <p>
                {root ? <span className={s.bandRoot}><Crown size={11} />{root.id}</span> : null}
                {root?.currency ? <span className={s.tagCcy} style={{ "--cc": ccyColor(root.currency) }}>{root.currency}</span> : null}
                {structKey ? <span className={s.bandStruct}>{structKey}</span> : null}
              </p>
            </div>
          </div>
          <div className={s.bandStats}>
            <div className={s.bStat}>
              <b>{inStruct.length}</b>
              <span>{tx.companies(inStruct.length).replace(/^\d+\s/, "")}</span>
              <span className={s.bMeter} title={tx.consolidatedN(nCons)}>
                <i style={{ width: `${inStruct.length ? (nCons / inStruct.length) * 100 : 0}%` }} />
              </span>
              <small>{tx.consolidatedN(nCons)}</small>
            </div>
            <div className={s.bStat}>
              <b style={{ color: ownColor(avgOwn) }}>{fmtPct(avgOwn)}%</b>
              <span>{tx.avgOwnership}</span>
              <small>{t("st_kpi_wholly_owned").replace("{n}", wholly)}</small>
            </div>
            <div className={s.bStat}>
              <b>{ccys.length}</b>
              <span>{tx.currencies(ccys.length).replace(/^\d+\s/, "")}</span>
              <span className={s.bCcys}>{ccys.slice(0, 6).map(c => <i key={c} style={{ "--cc": ccyColor(c) }} title={c}>{c}</i>)}</span>
            </div>
            <div className={s.bStat}>
              <b>{levels}</b>
              <span>{tx.levels(levels).replace(/^\d+\s/, "")}</span>
              <small>{connected.length} {tx.inTree}</small>
            </div>
            <div className={s.bStat}>
              {detached.length
                ? <><b className={s.warnTxt}>{detached.length}</b><span>{tx.detachedN(detached.length).replace(/^\d+\s/, "")}</span><small className={s.warnTxt}><Unlink size={11} />{t("st_kpi_outside_structure")}</small></>
                : <><b className={s.okTxt}><CheckCircle2 size={20} /></b><span>{tx.allLinked}</span></>}
            </div>
          </div>
        </section>
      )}

      {/* Contenido */}
      <div className={s.body}>
        <ProgressLoader visible={loading} steps={steps} title={tx.loadTitle} subtitle={t("st_title")}
          primary={primary} secondary={colors?.secondary ?? "#CF305D"} failed={!!fatal} />
        {fatal ? (
          <div className={s.errorBox} role="alert">
            <span className={s.errorIc}><AlertTriangle size={20} /></span>
            <h3>{tx.errorTitle}</h3>
            <p>{tx.errorHint}</p>
            <button type="button" onClick={() => setTick(n => n + 1)}><RefreshCw size={13} />{tx.retry}</button>
          </div>
        ) : !loading && (
          <>
            {tab === "tree" && (
              <div className={s.treeRow}>
                <OrgCanvas nodes={connected} detached={detached} idx={idx} companies={companies} ownership={ownership}
                  groupStructure={groupStructure} selected={selected} onSelect={setSelected} focus={focus}
                  primary={primary} t={t} structKey={structKey} />
                <DetachedRail detached={detached} selected={selected} onSelect={setSelected} tx={tx} />
              </div>
            )}
            {tab === "companies" && (
              <CompaniesView companies={companies} ownership={ownership} structKey={structKey}
                groupStructure={groupStructure} idx={idx} search={search} onOpenInTree={goToTree} t={t} />
            )}
            {tab === "periods" && (
              <div className={s.scroll}>
                <PeriodsView periods={periods} filterStruct={periodStruct} filterSource={periodSource} t={t} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}