/* ══════════════════════════════════════════════════════════════════════
   Contribución — página.

   Lo que aporta cada sociedad al grupo elegido, como Konsolidator / Power BI
   (Sábana de Consolidación, bloque Contribución, y su "Rastro del dato"):
     · columnas: la matriz (filas Parent) y cada sociedad que aporta al grupo
       (filas Contribution con GroupShortName = grupo), en la divisa del grupo;
     · desglose: carga + asientos SYS/AJE/RJE contabilizados de la sociedad,
       con su signo y convertidos a la divisa del grupo; en subgrupos, además
       sus eliminaciones (EJE).
   Comprobado contra el modelo del .pbix.

   Estructura de la carpeta:
     ContributivePage.jsx     → estado, datos y maquetación
     ContributiveTable.jsx    → la tabla y sus filas
     ContributiveParts.jsx    → carga, filtros, modales y vistas de mapeos
     contributiveExports.js   → exportación a Excel y PDF
     contributiveUtils.js     → utilidades y reglas de contribución
   ══════════════════════════════════════════════════════════════════════ */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTypo, useSettings, useLocale } from "../../components/layout/SettingsContext";
import { t } from "../../lib/i18n";
import { Loader2, X, RefreshCw, Filter, TrendingUp, Download, BarChart2, Layers, Search, FileText } from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill } from "../../components/layout/PageHeader.jsx";
import { BASE_URL, MONTHS, getContributionCurrency, getCompanyCurrency, pgcSort, buildTree, buildDimKeys, amountOf, isPostedJournal, isContributionRow, makeFxToGroup, pickPeriodFromRuns } from "./contributiveUtils.js";
import { generateContributiveXlsx, generateContributivePdf } from "./contributiveExports.js";
import { SyncedTable } from "./ContributiveTable.jsx";
import { DrilldownModal, JournalsModal, MappingsLanding, MappingsLibrary, ContributiveLoader, CompareBusy } from "./ContributiveParts.jsx";
import ContributiveCharts, { ChartsToggle } from "./ContributiveCharts.jsx";


// Peticiones que mide el cargador
const META_REQUESTS = 6;   // periodos, escenarios, estructuras, sociedades, estructura de grupo, consolidaciones
const DATA_REQUESTS = 4;   // consolidado y asientos del periodo y del mes anterior

export default function ContributivePage({ token, onNavigate, activeStandardKey = null }) {
const header2Style = useTypo("header2");
  const header3Style = useTypo("header3");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const filterStyle = useTypo("filter");
  const underscore1Style = useTypo("underscore1");
  const underscore2Style = useTypo("underscore2");
const { colors } = useSettings();
const locale = useLocale();
  const T = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const [periods,       setPeriods]       = useState([]);
  const [sources,       setSources]       = useState([]);
  const [structures,    setStructures]    = useState([]);
  const [companies,     setCompanies]     = useState([]);
  const [groupStructure,setGroupStructure]= useState([]);

  const [year,       setYear]       = useState("");
  const [month,      setMonth]      = useState("");
  const [source,     setSource]     = useState("");
  const [structure,  setStructure]  = useState("DefaultStructure");
// Se abre siempre en el desglose de cuentas (tabla), con todos los tipos
const [typeFilter, setTypeFilter] = useState("");
  // Also reset expansion when a mapping flips on/off (the id space changes).
  const [selectedCompanies, setSelectedCompanies] = useState([]);
// User-defined column order (drag-and-drop). Empty array = use natural order.
  const [colOrder, setColOrder] = useState([]);
  // NEW: perspective filter — "" means none/all (default), or a parent shortName
const [perspective, setPerspective] = useState("");

const [rawData,      setRawData]      = useState([]);
const [rawDataPrev,  setRawDataPrev]  = useState([]);
const [ytdOnly,      setYtdOnly]      = useState(false);
const [customStandardVersion, setCustomStandardVersion] = useState(0);
  const [allCfSections, setAllCfSections] = useState([]);
  useEffect(() => {
    const handler = () => setCustomStandardVersion(v => v + 1);
    window.addEventListener("custom-standard-updated", handler);
    return () => window.removeEventListener("custom-standard-updated", handler);
  }, []);
  const [journalData,  setJournalData]  = useState([]);
  const [journalDataPrev, setJournalDataPrev] = useState([]); // mes anterior (desglose mensual)
  const [showJournals, setShowJournals] = useState(false);
  // ── Estado de la carga (para el cargador común) ──
  // metaCount: peticiones de metadatos terminadas · probingPeriod: buscando
  // el periodo inicial (empieza en true: hasta saberlo no hay nada que pintar)
  // · loadedKey: última combinación de filtros con datos ya recibidos. Se
  // está cargando mientras la combinación actual no sea la recibida, así el
  // cargador no parpadea entre una fase y la siguiente.
  const [metaReady,    setMetaReady]    = useState(false);
  const [metaCount,    setMetaCount]    = useState(0);
  const [probingPeriod, setProbingPeriod] = useState(true);
  const [loadedKey,    setLoadedKey]    = useState(null);
  const [dataProg,     setDataProg]     = useState({ key: null, n: 0 });
  const [consolidations, setConsolidations] = useState([]);
  const autoPeriodDone = useRef(false);
  // "Probar de nuevo" (sábana vacía): vuelve a sondear la API, sin atajos
  const forceProbeRef = useRef(false);
  const [probeTick, setProbeTick] = useState(0);
const breakersFetchedRef = useRef(false);
const [breakers, setBreakers] = useState({});
  const [breakerSortOrder, setBreakerSortOrder] = useState(new Map());
  // For CUSTOM standards: map<account_code, {section, label, color}> so we can
  // dispatch section breakers to the FIRST code of each section that actually
  // exists in the render tree (some standard sums have no data).
const [codeToSectionInfo, setCodeToSectionInfo] = useState(new Map());
  // Cache from the standard: full metadata to build the tree skeleton
  // independently of runtime data. Fixes Contributive where Konsolidator
  // does not emit Contribution rows for every roll-up (C.01, E.PL, F.PL...).
  const [codeToNameFromStd, setCodeToNameFromStd] = useState(new Map());
const [codeToParentFromStd, setCodeToParentFromStd] = useState(new Map());
  const [codeToStatementFromStd, setCodeToStatementFromStd] = useState(new Map());
const [pgcSections] = useState({});
const [expandedSet,setExpandedSet]= useState(new Set());
useEffect(() => { setExpandedSet(new Set()); }, [typeFilter]);
const [compareMode, setCompareMode] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
const [exportOpts, setExportOpts] = useState({
format: "xlsx",
    includeAdjustments: true,
    includeTotals: true,
    includeCompare: true,
    drilldown: true,
    sheets: { todos: true, pl: true, bs: true, cf: true },
  });
  const [cmpYear, setCmpYear] = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
  const [cmpSource, setCmpSource] = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
const [cfUploadedData, setCfUploadedData] = useState([]);
const [cfUploadedDataPrev, setCfUploadedDataPrev] = useState([]);
  const [cfMapping, setCfMapping] = useState([]);
  const [cfMetadata, setCfMetadata] = useState(new Map());
  const [cfGroupToCf, setCfGroupToCf] = useState(new Map());
const [, setCfLoading] = useState(false);
  // Plain dict {cfCode: name} accumulated from consolidated rows with
  // AccountType C/F or CFS. This is the most reliable name source — the
  // mapping endpoint often returns blank names for sum/system accounts.
  const [cfNameDict, setCfNameDict] = useState({});
const [cmpRawData, setCmpRawData] = useState([]);
  const [cmpRawDataPrev, setCmpRawDataPrev] = useState([]);
  const [cmpLoading, setCmpLoading] = useState(false);
  // Divisa en la que se ve cada columna:
  //  · "local" (por defecto): cada sociedad en SU moneda (la contribución
  //    deshecha con el tipo de cambio; el desglose, tal cual);
  //  · "group": todo en la divisa del grupo (como la sábana de consolidación).
  const [currencyMode, setCurrencyMode] = useState("local");
  // Tipos de cambio por periodo ("año|mes|fuente" → filas de exchange-rates).
  const [ratesByKey, setRatesByKey] = useState({});
const [drilldown,       setDrilldown]       = useState(null);

  // ── Mappings state ──────────────────────────────────────────────────────
  // activeMapping holds the currently-applied mapping (derived from typeFilter).
  // We key it by tab so switching between P/L → B/S → C/F doesn't lose state.
  const [activeMappings, setActiveMappings] = useState({ pl: null, bs: null, cf: null });
  const [hiddenOverride, setHiddenOverride] = useState(null);
  // viewsMode controls the mappings UI overlay: null | "landing" | "structure" | "report"
  const [viewsMode, setViewsMode] = useState(null);
  // Tabla o gráficos, y qué cuenta / sociedad se analiza en los gráficos
  const [view, setViewState] = useState("table");
  const [chartNav, setChartNav] = useState({ focus: null, co: null });
  // Al pasar a gráficos, "Todos" no aplica: se va a P&G
  const setView = useCallback((v) => {
    setViewState(v);
    if (v === "charts") setTypeFilter(tf => (tf === "" ? "P/L" : tf));
  }, []);
  // "Ver en gráficos" desde una fila: abre su estado y la cuenta
  const analyzeAccount = useCallback((node) => {
    const ty = node?.AccountType ?? node?.accountType ?? "";
    setTypeFilter(ty === "B/S" ? "B/S" : ty === "C/F" || ty === "CFS" ? "C/F" : "P/L");
    setChartNav({ focus: node?.AccountCode ?? null, co: null });
    setView("charts");
  }, [setView]);
  // Lists fetched on demand
  const [savedMappings, setSavedMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState(null);
  // Quick-access dropdown (combined structure + report, sorted by recency)
  const [recentMappings, setRecentMappings] = useState([]);

// Which tab is "mapping-capable"? Only P/L, B/S, C/F have their own mapping.
  // "All" (typeFilter === "") composes a synthetic mapping that concatenates
  // the treeLiterals of PL + BS mappings so custom accounts/breakers (like a
  // "NEW BREAKER" section defined in the PL mapping) still surface in Todos.
  const mappingTab = typeFilter === "P/L" ? "pl"
                   : typeFilter === "B/S" ? "bs"
                   : typeFilter === "C/F" ? "cf"
                   : null;
  const mappingsEnabled = !!mappingTab || !typeFilter;
  const buildMappingLiteral = useCallback((tree) => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    const sections = [];
    let current = { label: null, color: null, nodes: [] };
    sections.push(current);
    const visited = new WeakSet();
    const literal = (node, depth) => {
      if (!node || depth > 50 || visited.has(node)) {
        return { id: `${node?.code ?? "?"}-${Math.random()}`, code: String(node?.code ?? ""), name: String(node?.name ?? ""), isSum: false, depth, children: [] };
      }
      visited.add(node);
      return {
        id: String(node.id ?? `${node.code}-${Math.random()}`),
        originalId: node.id,
        code: String(node.code ?? ""),
        name: String(node.name ?? ""),
        dims: Array.isArray(node.dims) ? node.dims : null,
        isSum: !!node.isSum,
        depth,
        children: (node.children || [])
          .filter(c => c && c.kind !== "breaker")
          .map(c => literal(c, depth + 1)),
      };
    };
    for (const node of tree) {
      if (node?.kind === "breaker") {
        current = { label: String(node.name ?? ""), color: node.color || "#1a2f8a", nodes: [] };
        sections.push(current);
        (node.children || []).filter(c => c?.kind !== "breaker").forEach(c => current.nodes.push(literal(c, 0)));
      } else if (node) {
        current.nodes.push(literal(node, 0));
      }
    }
    return sections.filter((s, i) => i > 0 || s.nodes.length > 0);
  }, []);

const activeMapping = useMemo(() => {
if (!mappingsEnabled) return null;
    if (mappingTab) return activeMappings[mappingTab] ?? null;
    // Todos ALWAYS shows the default structure (hidden override), never the
    // user's per-tab mapping. No strip (codes collide across statements).
    const ho = hiddenOverride;
    if (!ho) return null;
    const buildLit = (tree) =>
      (Array.isArray(tree) && tree.length > 0) ? (buildMappingLiteral(tree) || null) : null;
    const plLit = buildLit(ho.pl_tree);
    const bsLit = buildLit(ho.bs_tree);
    const cfLit = buildLit(ho.cf_tree);
    const plInLit = !!plLit;
    const bsInLit = !!bsLit;
    const cfInLit = !!cfLit;
    const literals = [];
    if (plInLit) literals.push(...plLit);
    if (bsInLit) literals.push(...bsLit);
    if (cfInLit) literals.push(...cfLit);
    if (literals.length === 0) return null;
    return {
      mapping_id: `synthetic-todos-override-${ho.mapping_id ?? ""}`,
      name: "__todos_synthetic__",
      is_hidden: true,
      treeLiteral: literals,
      _inLiteral: { pl: plInLit, bs: bsInLit, cf: cfInLit },
      treeConverted: null,
      highlightedIds: new Set(Array.isArray(ho.highlighted_ids) ? ho.highlighted_ids : []),
    };
}, [mappingsEnabled, mappingTab, activeMappings, hiddenOverride, buildMappingLiteral]);
useEffect(() => { setExpandedSet(new Set()); }, [activeMapping?.mapping_id]);
const [expandedColsMap, setExpandedColsMap] = useState({});
  const _expandedCols = new Set(Object.keys(expandedColsMap).filter(k => expandedColsMap[k]));
const toggleCol = co => setExpandedColsMap(prev => ({ ...prev, [co]: !prev[co] }));

const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

  // Convert a saved mapping tree → flat { rows, sections } map for standard-style
  // rendering. Used when we want the literal to interop with our existing sortOrder.
const convertMappingTree = useCallback((tree) => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    // rows keyed by INSTANCE id (not code), so multiple instances of the
    // same code (with different dims) don't collide.
    const rows = new Map();
    const sections = new Map();
    let sortCounter = 0;
    let defaultSecCounter = 0;
    let synthIdCounter = 0;

    // Walker handles BOTH styles: recursive (breakers own code children)
    // and linear/sibling (breakers and codes at same level).
    const walk = (nodes, depth, initialParentSection) => {
      let currentSection = initialParentSection;
      for (const node of nodes || []) {
        if (!node) continue;
        if (node.kind === "breaker") {
          const secCode = node.sectionCode || `section_${defaultSecCounter++}`;
          if (!sections.has(secCode)) {
            sections.set(secCode, {
              label: String(node.name ?? "Section"),
              color: node.color || "#1a2f8a",
            });
          }
          currentSection = secCode;
          if (Array.isArray(node.children) && node.children.length > 0) {
            walk(node.children, depth, secCode);
          }
        } else if (node.code != null) {
          const code = String(node.code);
          const sec = currentSection || "_default";
          if (!sections.has(sec)) sections.set(sec, { label: "", color: "#1a2f8a" });
          const instanceId = String(node.id ?? `synth-${code}-${synthIdCounter++}`);
          const dims = Array.isArray(node.dims) ? node.dims.map(String).filter(Boolean) : [];
          rows.set(instanceId, {
            code,
            name: node.name ?? "",
            dims,
            section: sec,
            sortOrder: sortCounter++,
            isSum: !!node.isSum,
            showInSummary: !!node.showInSummary,
            level: depth,
          });
          if (Array.isArray(node.children) && node.children.length > 0) {
            walk(node.children, depth + 1, sec);
          }
        }
      }
    };
    walk(tree, 0, null);
    return rows.size > 0 ? { rows, sections } : null;
  }, []);

  // Preserve the original hierarchy (with duplicates, sums, dims). Used by the
  // literal render path.
  // Apply a mapping for the current tab. `kind` = "structure" | "report".
const handleApplyMapping = useCallback((m, kind = "structure", forceTab = null) => {
    const tab = forceTab ?? mappingTab;
    if (!tab) return;
const treeField = tab === "pl" ? "pl_tree" : tab === "bs" ? "bs_tree" : "cf_tree";
    const tree = m?.[treeField] ?? m?.tree ?? [];
    setActiveMappings(prev => ({
      ...prev,
      [tab]: {
        mapping_id: m.mapping_id,
        kind,
        tab,
        name: m.name,
        standard: m.standard,
        treeRaw: tree,
        treeConverted: convertMappingTree(tree),
        treeLiteral: buildMappingLiteral(tree),
        highlightedIds: Array.isArray(m.highlighted_ids) ? new Set(m.highlighted_ids) : new Set(),
      },
    }));
    setViewsMode(null);
  }, [mappingTab, convertMappingTree, buildMappingLiteral]);

const clearActiveMapping = useCallback(() => {
    if (!mappingTab) return;
    const treeField = mappingTab === "pl" ? "pl_tree" : mappingTab === "bs" ? "bs_tree" : "cf_tree";
    if (hiddenOverride && Array.isArray(hiddenOverride[treeField]) && hiddenOverride[treeField].length > 0) {
      handleApplyMapping(hiddenOverride, "structure", mappingTab);
    } else {
      setActiveMappings(prev => ({ ...prev, [mappingTab]: null }));
    }
  }, [mappingTab, hiddenOverride, handleApplyMapping]);

  // Auto-apply hidden override mapping for CUSTOM standards. It carries
  // pl_tree, bs_tree AND cf_tree — we apply the tree that matches the current tab.

useEffect(() => {
    const isCustom = activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-");
    if (!isCustom) { setHiddenOverride(null); return; }
    let cancelled = false;
(async () => {
      try {
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { getActiveCompanyId, getHiddenOverrideMapping } = await import("../../lib/mappingsApi");
        const cid = await getActiveCompanyId(uid);
        if (!cid) return;
        const hidden = await getHiddenOverrideMapping({ companyId: cid, standard: activeStandardKey });
        if (!cancelled) setHiddenOverride(hidden ?? null);
      } catch (e) { console.warn("[Contributive] hidden override load failed:", e); }
    })();
    return () => { cancelled = true; };
  }, [activeStandardKey, customStandardVersion]);

// Apply the initial default ONCE per tab. Priority per tab:
  //   1) the user's chosen "standard" mapping (a per-user preference):
  //        · pl / bs → user_settings.preferences.standard_mapping_id      (mappings table; holds pl_tree + bs_tree)
  //        · cf      → user_settings.preferences.cashflow_standard_mapping_id (cashflow_mappings table)
  //   2) the system hidden override (custom-no-user) as the fallback
  // After the initial default we must NOT re-apply on every activeMappings change
  // (that would stomp the user's later choice). A ref tracks which tabs are done.
  const overrideAppliedRef = useRef(new Set());
useEffect(() => {
    // Run whenever the standard is custom — the user's standard mapping must apply
    // even when there is no hidden override. Only bail if this isn't a custom standard.
    const isCustom = activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-");
    if (!isCustom) return;
    // A new override id (or none) resets the applied set (e.g. standard changed).
    const ovId = hiddenOverride?.mapping_id ?? "__no_override__";
    if (overrideAppliedRef.current._id !== ovId) {
      overrideAppliedRef.current = new Set();
      overrideAppliedRef.current._id = ovId;
    }
    const tabsToApply = mappingTab ? [mappingTab] : ["pl", "bs", "cf"];
    let cancelled = false;

    (async () => {
      // Read the user's standard-mapping preferences once.
      let prefs = {};
      try {
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { data } = await supabase
            .from("user_settings").select("preferences").eq("user_id", uid).single();
prefs = data?.preferences ?? {};
        }
      } catch { /* no prefs → override fallback */ }

// Resolve a user's standard mapping for a given tab, or null.
      const loadUserStandardFor = async (tab) => {
        try {
if (tab === "cf") {
            const id = prefs.cashflow_standard_mapping_id;
            if (!id) return null;
            const { getMapping } = await import("../../lib/cashflowMappingsApi");
            const full = await getMapping(id);
            return (full && !full.is_archived && Array.isArray(full.cf_tree) && full.cf_tree.length > 0) ? full : null;
          } else {
            const id = prefs.standard_mapping_id;
            if (!id) return null;
            const { getMapping } = await import("../../lib/mappingsApi");
            const full = await getMapping(id);
            const field = tab === "pl" ? "pl_tree" : "bs_tree";
            return (full && !full.is_archived && Array.isArray(full[field]) && full[field].length > 0) ? full : null;
          }
        } catch { return null; }
      };

      for (const tab of tabsToApply) {
        if (cancelled) return;
        if (overrideAppliedRef.current.has(tab)) continue; // already defaulted this tab

        // 1) user's standard mapping wins.
        const userStd = await loadUserStandardFor(tab);
        if (cancelled) return;
        if (userStd) {
          handleApplyMapping(userStd, "structure", tab);
          overrideAppliedRef.current.add(tab);
          continue;
        }

        // 2) fall back to the hidden override for this tab.
        const treeField = tab === "pl" ? "pl_tree" : tab === "bs" ? "bs_tree" : "cf_tree";
        const tree = hiddenOverride?.[treeField];
        if (!Array.isArray(tree) || tree.length === 0) continue;
        if (activeMappings[tab]?.mapping_id === hiddenOverride.mapping_id) {
          overrideAppliedRef.current.add(tab);
          continue;
        }
        handleApplyMapping(hiddenOverride, "structure", tab);
        overrideAppliedRef.current.add(tab);
      }
    })();

return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenOverride, mappingTab, handleApplyMapping, activeStandardKey]);

  // Dynamically pick which API to use based on mappingTab + viewsMode.
  // pl & bs → mappingsApi / reportMappingsApi (the ones from Individuales)
  // cf      → cashflowMappingsApi / cashflowReportMappingsApi
  const pickMappingApi = useCallback(async (tab, kind) => {
    if (tab === "cf") {
      const mod = kind === "report"
        ? await import("../../lib/cashflowReportMappingsApi")
        : await import("../../lib/cashflowMappingsApi");
      return mod;
    }
    // pl & bs share the same APIs (they store both pl_tree and bs_tree in the same row)
    const mod = kind === "report"
      ? await import("../../lib/reportMappingsApi")
      : await import("../../lib/mappingsApi");
    return mod;
  }, []);

  // Fetch the list of saved mappings when entering structure/report library
  useEffect(() => {
    if (!viewsMode || viewsMode === "landing") return;
    if (!mappingTab) return;
    let cancelled = false;
    (async () => {
      setMappingsLoading(true);
      setMappingsError(null);
      setSavedMappings([]);
      try {
        const api = await pickMappingApi(mappingTab, viewsMode);
        const supa = await import("../../lib/supabaseClient");
        const { data: { session } } = await supa.supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) throw new Error("No session");
        const cid = await api.getActiveCompanyId(uid);
        if (!cid) throw new Error("No active company");
        const rows = await api.listMappings({ companyId: cid });
        if (!cancelled) setSavedMappings(rows || []);
      } catch (e) {
        if (!cancelled) setMappingsError(e?.message || String(e));
      } finally {
        if (!cancelled) setMappingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewsMode, mappingTab, pickMappingApi]);

  // Fetch recent mappings (combined structure + report) once at mount per tab
  useEffect(() => {
    if (!mappingTab) { setRecentMappings([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const supa = await import("../../lib/supabaseClient");
        const { data: { session } } = await supa.supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const structApi = await pickMappingApi(mappingTab, "structure");
        const reportApi = await pickMappingApi(mappingTab, "report");
        const cid = await structApi.getActiveCompanyId(uid);
        if (!cid) return;
        const [structRows, reportRows] = await Promise.all([
          structApi.listMappings({ companyId: cid }).catch(() => []),
          reportApi.listMappings({ companyId: cid }).catch(() => []),
        ]);
        if (cancelled) return;
        setRecentMappings([
          ...(structRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "structure", updated_at: r.updated_at, raw: r })),
          ...(reportRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "report",    updated_at: r.updated_at, raw: r })),
        ]);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [mappingTab, pickMappingApi]);

  // Click a card → fetch the full mapping (with cf_tree / pl_tree / bs_tree) and apply
  const handleApplyFromCard = useCallback(async (m, kind) => {
    try {
      const api = await pickMappingApi(mappingTab, kind);
      const full = await api.getMapping(m.mapping_id);
      handleApplyMapping(full ?? m, kind);
} catch {
      handleApplyMapping(m, kind);
    }
  }, [mappingTab, pickMappingApi, handleApplyMapping]);

  /* ── Load metadata ──────────────────────────────────────── */
  useEffect(() => {
    if (!token) return;
    const h = headers();
// Parseo tolerante: una respuesta vacía (token expirado, 204, cliente sin ese
    // recurso) no debe lanzar "Unexpected end of JSON input" ni tumbar los filtros.
    const safeJson = (r) => r.text().then(txt => {
      if (!txt) return [];
      try { const d = JSON.parse(txt); return d.value ?? (Array.isArray(d) ? d : []); }
      catch { return []; }
    });
    // Cada petición que termina hace avanzar el cargador
    const tick = (v) => { setMetaCount(n => n + 1); return v; };
    const get = (path) => fetch(`${BASE_URL}/v2/${path}`, { headers: h }).then(safeJson).catch(() => []).then(tick);
    Promise.all([
      get("periods"), get("sources"), get("structures"), get("companies"), get("group-structure"),
      // Consolidaciones hechas: dan el periodo inicial sin sondear la API mes a mes
      get("consolidations"),
    ]).then(([per, src, str, co, gs, cons]) => {
      setPeriods(per);
      setSources(src);
      setStructures(str);
      setCompanies(co);
      setGroupStructure(gs);
      setConsolidations(cons);
      // Sin fuentes o estructuras no hay periodo que buscar
      if (!src.length || !str.length) setProbingPeriod(false);

      // Default: latest Actual period
      setSource("Actual");

      // Default structure
      if (str.length > 0) {
        const s = str[0];
        const v = typeof s === "object"
          ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "")
          : String(s);
        setStructure(String(v));
      }

setMetaReady(true);
    });
  }, [token, headers]);

/* ── Auto-find latest period with data — exhaustive probe ─────────
     Strategy:
       1. Try current source+structure going back 24 months
       2. If nothing, sweep ALL combinations of source × structure for
          the last 12 months (newest period first) and switch filters
          to the first hit
       3. If still nothing, give up and show the empty state */
  useEffect(() => {
    if (!metaReady) return;
    if (autoPeriodDone.current) return;
    if (!source || !structure || sources.length === 0 || structures.length === 0) return;
    autoPeriodDone.current = true;
    setProbingPeriod(true);

    const probe = async (y, m, src, str) => {
      try {
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}'`;
        const res = await fetch(
          `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
          { headers: headers() }
        );
if (!res.ok) return false;
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        return rows.length > 0;
      } catch { return false; }
    };

    const cacheKey = (src, str) => `contributive:lastPeriod:${src}|${str}`;
    const readCachedPeriod = (src, str) => {
      try {
        const raw = localStorage.getItem(cacheKey(src, str));
        if (!raw) return null;
        const { y, m } = JSON.parse(raw);
        return (Number(y) > 0 && Number(m) > 0) ? { y: Number(y), m: Number(m) } : null;
      } catch { return null; }
    };
    const writeCachedPeriod = (src, str, y, m) => {
      try { localStorage.setItem(cacheKey(src, str), JSON.stringify({ y: Number(y), m: Number(m) })); } catch { /* ignore */ }
    };

    // 0) La lista de consolidaciones ya dice el último periodo con datos:
    //    se usa directamente (antes se sondeaba la API con una petición por
    //    mes del catálogo, todas a la vez).
    const byDate = (a, b) => (Number(b.Year) - Number(a.Year)) || (Number(b.Month) - Number(a.Month));
    const latestClosed = [...(periods || [])].filter(p => p.Source === source && p.Closed === true).sort(byDate)[0];
    const pick = forceProbeRef.current ? null : pickPeriodFromRuns(consolidations, {
      source, structure,
      before: latestClosed ? Number(latestClosed.Year) * 12 + Number(latestClosed.Month) : undefined,
    });
    forceProbeRef.current = false;
    if (pick) {
      if (pick.source !== source) setSource(pick.source);
      if (pick.structure !== structure) setStructure(pick.structure);
      setYear(String(pick.y));
      setMonth(String(pick.m));
      setProbingPeriod(false);
      return;
    }

    (async () => {
      const now = new Date();
      const monthsBack = (max) => {
        const out = [];
        let y = now.getFullYear();
        let m = now.getMonth() + 1;
        for (let i = 0; i < max; i++) {
          out.push({ y, m });
          m -= 1;
          if (m < 1) { m = 12; y -= 1; }
        }
        return out;
      };

const fromCatalogue = [...new Set(
        (periods || [])
          .map(p => {
            const yy = Number(p.Year ?? p.year ?? 0);
            const mm = Number(p.Month ?? p.month ?? 0);
            return yy > 0 && mm > 0 ? `${yy}-${mm}` : null;
          })
          .filter(Boolean)
      )]
        .map(s => { const [yy, mm] = s.split("-").map(Number); return { y: yy, m: mm }; })
        .sort((a, b) => (b.y - a.y) || (b.m - a.m));
      const candidates = fromCatalogue.length > 0 ? fromCatalogue : monthsBack(24);

      const rank = (y, m) => y * 12 + m;

      const cached = readCachedPeriod(source, structure);
      if (cached) {
        const cachedRank = rank(cached.y, cached.m);
        const newer = candidates.filter(c => rank(c.y, c.m) > cachedRank);
        const probes = await Promise.all(
          [...newer, cached].map(({ y, m }) => probe(y, m, source, structure).then(ok => ({ y, m, ok })))
        );
        const hit = probes.find(r => r.ok);
        if (hit) {
          setYear(String(hit.y));
          setMonth(String(hit.m));
          writeCachedPeriod(source, structure, hit.y, hit.m);
          setProbingPeriod(false);
          return;
        }
      }

      const pass1 = await Promise.all(
        candidates.map(({ y, m }) => probe(y, m, source, structure).then(ok => ({ y, m, ok })))
      );
      const hit1 = pass1.find(r => r.ok);
      if (hit1) {
        setYear(String(hit1.y));
        setMonth(String(hit1.m));
        writeCachedPeriod(source, structure, hit1.y, hit1.m);
        setProbingPeriod(false);
        return;
      }

      // Pass 2 — sweep all source × structure for last 12 months
      const allSources = [...new Set(sources.map(s =>
        typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s)
      ).filter(Boolean))];
      const allStructures = [...new Set(structures.map(s =>
        typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s)
      ).filter(Boolean))];

const sweepMonths = (fromCatalogue.length > 0 ? fromCatalogue : monthsBack(12)).slice(0, 12);
      for (const { y, m } of sweepMonths) {
        const combos = [];
        for (const src of allSources) {
          for (const str of allStructures) {
            if (src === source && str === structure) continue; // already tried
            combos.push({ src, str });
          }
        }
        const results = await Promise.all(
          combos.map(({ src, str }) => probe(y, m, src, str).then(ok => ({ src, str, ok })))
        );
        const hit = results.find(r => r.ok);
        if (hit) {
          setSource(hit.src);
          setStructure(hit.str);
          setYear(String(y));
          setMonth(String(m));
          writeCachedPeriod(hit.src, hit.str, y, m);
          setProbingPeriod(false);
          return;
        }
      }

      // Nothing found anywhere — leave filters as-is, table will show empty state
      setProbingPeriod(false);
    })();
}, [metaReady, source, structure, sources, structures, headers, periods, consolidations, probeTick]);

  /* ── Fetch breakers from Supabase ───────────────────────── */
useEffect(() => {
    if (!rawData.length) return;
    breakersFetchedRef.current = false;

    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    // Use auth JWT so RLS on standard_statement_* tables passes.
    let sbToken = SUPABASE_APIKEY;
    try {
      const key = "sb-gmcawsapzkzmgrtiqebv-auth-token";
      const parsed = key ? JSON.parse(localStorage.getItem(key)) : null;
      sbToken = parsed?.access_token ?? parsed?.data?.session?.access_token ?? SUPABASE_APIKEY;
    } catch { /* fall back to publishable */ }
    const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${sbToken}` };

    const isCustom = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");

    // CUSTOM path: unified standard_statement_* tables filtered by
    // (standard_key, statement=PL).
if (isCustom) {
      // Paginated fetch — Supabase/PostgREST caps at 1000 rows per request
      // by default. Standards can have >1000 rows (Konsolidator has 1190),
      // so we page until we've read everything.
      const fetchAllRows = async () => {
        const all = [];
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          const url = `${SUPABASE_URL}/standard_statement_rows?select=*` +
            `&standard_key=eq.${encodeURIComponent(activeStandardKey)}` +
            `&statement=in.(PL,BS,CF)` +
            `&order=sort_order.asc` +
            `&limit=${PAGE}&offset=${offset}`;
          const r = await fetch(url, { headers: sbHeaders });
          if (!r.ok) break;
          const batch = await r.json();
          if (!Array.isArray(batch) || batch.length === 0) break;
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
          if (offset > 20000) break; // safety
        }
        return all;
      };
      Promise.all([
        fetchAllRows(),
        fetch(
          `${SUPABASE_URL}/standard_statement_sections?select=*` +
          `&standard_key=eq.${encodeURIComponent(activeStandardKey)}` +
          `&statement=in.(PL,BS,CF)` +
          `&order=sort_order.asc`,
          { headers: sbHeaders }
        ).then(r => r.json()),
]).then(([rowsArr, secsArr]) => {
        if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
        const secByCode = new Map(secsArr.map(s => [s.section_code, { label: s.label, color: s.color, statement: s.statement, sort_order: s.sort_order }]));
        // Save all CF sections (in order) so consumers can render empty custom breakers.
        const allCfSections = secsArr
          .filter(s => s.statement === "CF")
          .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
          .map(s => ({ section_code: s.section_code, label: s.label, color: s.color, sort_order: s.sort_order }));
        setAllCfSections(allCfSections);
        const seen = new Set();
        const out = {};
const codeSecMap = new Map();
        const nameMap = new Map();
        const parentMap = new Map();
        const stmtMap = new Map();
        rowsArr.forEach(r => {
          if (r.section_code && secByCode.has(r.section_code)) {
            const sec = secByCode.get(r.section_code);
            codeSecMap.set(r.account_code, { section: r.section_code, label: sec.label, color: sec.color });
          }
          if (r.account_name) nameMap.set(r.account_code, r.account_name);
          if (r.parent_code) parentMap.set(r.account_code, r.parent_code);
          if (r.statement) stmtMap.set(r.account_code, r.statement);
          if (seen.has(r.section_code) || !r.section_code) return;
          seen.add(r.section_code);
          const sec = secByCode.get(r.section_code);
          if (sec) out[r.account_code] = { label: sec.label, color: sec.color };
        });
        const breakerOrder = new Map();
        rowsArr.forEach((r, idx) => breakerOrder.set(r.account_code, idx));
        setBreakers(out);
        setBreakerSortOrder(breakerOrder);
        setCodeToSectionInfo(codeSecMap);
        setCodeToNameFromStd(nameMap);
setCodeToParentFromStd(parentMap);
        setCodeToStatementFromStd(stmtMap);
      }).catch(() => {});
      return;
    }

    // Legacy sniff path — only runs when NOT CUSTOM.
    const isPGC           = rawData.some(n => { const c = String(n.AccountCode ?? n.accountCode ?? ""); return /[a-zA-Z]/.test(c) && c.endsWith(".S"); });
    const isSpanishIfrsEs = !isPGC && rawData.some(n => /\.PL$/i.test(String(n.AccountCode ?? n.accountCode ?? "").trim()));
    const isSpanishIFRS   = !isPGC && !isSpanishIfrsEs && rawData.some(n => /^[A-Z]\.\d/.test(String(n.AccountCode ?? n.accountCode ?? "")));
    const isDanish        = !isPGC && !isSpanishIFRS && !isSpanishIfrsEs && rawData.some(n => /^\d{5,6}$/.test(String(n.AccountCode ?? n.accountCode ?? "")));

    if (!isPGC && !isSpanishIFRS && !isSpanishIfrsEs && !isDanish) return;

    const rowsTable = isPGC ? "pgc_pl_rows"
      : isSpanishIfrsEs ? "contributive_pl_rows"
      : isDanish ? "danish_ifrs_pl_rows"
      : null;
    const secsTable = isPGC ? "pgc_pl_sections"
      : isSpanishIfrsEs ? "contributive_pl_sections"
      : isDanish ? "danish_ifrs_pl_sections"
      : null;

    if (rowsTable && secsTable) {
      Promise.all([
        fetch(`${SUPABASE_URL}/${rowsTable}?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
        fetch(`${SUPABASE_URL}/${secsTable}?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
      ]).then(([rowsArr, secsArr]) => {
if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
        const secByCode = new Map(secsArr.map(s => [s.section_code, { label: s.label, color: s.color }]));
        const seen = new Set();
        const out = {};
        const sortOrder = new Map();
        // Preserve name/parent/statement for parity with the CUSTOM loader so
        // downstream code (buildTree, section resolution) sees the same shape
        // regardless of which standard is active. If the legacy table doesn't
        // carry these columns, both fall through to "" harmlessly.
        const nameMap = new Map();
        const parentMap = new Map();
        const stmtMap = new Map();
        const codeSecMap = new Map();
        rowsArr.forEach((r, idx) => {
          sortOrder.set(r.account_code, idx);
          if (r.section_code && secByCode.has(r.section_code)) {
            const sec = secByCode.get(r.section_code);
            codeSecMap.set(r.account_code, { section: r.section_code, label: sec.label, color: sec.color });
          }
          if (r.account_name) nameMap.set(r.account_code, r.account_name);
          if (r.parent_code)  parentMap.set(r.account_code, r.parent_code);
          if (r.statement)    stmtMap.set(r.account_code, r.statement);
          if (seen.has(r.section_code) || !r.section_code) return;
          seen.add(r.section_code);
          const sec = secByCode.get(r.section_code);
          if (sec) out[r.account_code] = { label: sec.label, color: sec.color };
        });
        const breakerOrder = new Map();
        rowsArr.forEach((r, idx) => breakerOrder.set(r.account_code, idx));
        setBreakers(out);
        setBreakerSortOrder(breakerOrder);
        setCodeToSectionInfo(codeSecMap);
        setCodeToNameFromStd(nameMap);
        setCodeToParentFromStd(parentMap);
        setCodeToStatementFromStd(stmtMap);
      }).catch(() => {});
      return;
    }

    // Spanish IFRS non-ES fallback
    fetch(`${SUPABASE_URL}/spanish_ifrs_breakers?select=*`, { headers: sbHeaders })
      .then(r => r.json())
      .then(rows => {
        if (!Array.isArray(rows)) return;
        const grouped = {};
        rows.forEach(({ before_code, label, color }) => { grouped[before_code] = { label, color }; });
        setBreakers(grouped);
      })
      .catch(e => console.error("BREAKERS FETCH ERROR:", e));
}, [rawData, activeStandardKey, customStandardVersion]);
  /* ── Fetch consolidated-accounts ────────────────────────── */
  const dataKey = metaReady && year && month && source && structure ? `${year}|${month}|${source}|${structure}` : null;
  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure) return;
    const key = `${year}|${month}|${source}|${structure}`;
    // Si los filtros cambian a mitad de carga, la respuesta anterior se ignora
    // (antes podía llegar tarde y pisar los datos del periodo nuevo).
    let cancelled = false;
    const done = (v) => {
      if (!cancelled) setDataProg(d => (d.key === key ? { key, n: d.n + 1 } : { key, n: 1 }));
      return v;
    };

    setDataProg({ key, n: 0 });
    setRawData([]);
    setJournalData([]);
    setExpandedSet(new Set());
    setExpandedColsMap({});

    const h = headers();
const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevFilter = `Year eq ${prevYear} and Month eq ${prevMonth} and Source eq '${source}' and GroupStructure eq '${structure}'`;

const fetchConsWithFallback = async (flt) => {
      const cons = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(flt)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []);
      if (cons.length > 0) return cons;
      // Period not consolidated (e.g. October): fall back to uploaded-accounts, same
      // source the CF statement already uses, so PL/BS aren't blank for that period.
      return await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(flt)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []);
    };
    Promise.all([
      fetchConsWithFallback(filter).then(done),
      fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []).then(done),
      fetchConsWithFallback(prevFilter).then(done),
      fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(prevFilter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []).then(done),
    ]).then(([consolidated, journals, prevConsolidated, journalsPrev]) => {
      if (cancelled) return;
      setRawData(consolidated);
      setJournalData(journals);
      setJournalDataPrev(journalsPrev);
      setRawDataPrev(prevConsolidated);
      // Extract CF/CFS names from consolidated rows — accumulate across periods.
      setCfNameDict(prev => {
        const next = { ...prev };
        consolidated.forEach(r => {
          const t = r.AccountType ?? r.accountType ?? "";
          if (t !== "C/F" && t !== "CFS") return;
          const code = r.AccountCode ?? r.accountCode;
          const name = r.AccountName ?? r.accountName;
          if (code && name && !next[code]) next[code] = name;
        });
        return next;
      });
      setLoadedKey(key);
    }).catch(() => { if (!cancelled) setLoadedKey(key); });
    return () => { cancelled = true; };
  }, [year, month, source, structure, metaReady, headers]);

/* ── Tipos de cambio del periodo ─────────────────────────────────────── */
  useEffect(() => {
    if (!token || !metaReady) return;
    const prevOf = (y, m) => (Number(m) === 1 ? [Number(y) - 1, 12] : [Number(y), Number(m) - 1]);
    const wanted = [];
    if (year && month && source) {
      wanted.push([year, month, source], [...prevOf(year, month), source]);
    }
    if (cmpYear && cmpMonth && cmpSource) {
      wanted.push([cmpYear, cmpMonth, cmpSource], [...prevOf(cmpYear, cmpMonth), cmpSource]);
    }
    let cancelled = false;
    wanted.forEach(([y, m, src]) => {
      const key = `${Number(y)}|${Number(m)}|${src}`;
      if (ratesByKey[key]) return;
      const flt = `Year eq ${Number(y)} and Month eq ${Number(m)} and Source eq '${src}'`;
      fetch(`${BASE_URL}/v2/exchange-rates?$filter=${encodeURIComponent(flt)}`, { headers: headers() })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : []))
        .then(rows => { if (!cancelled) setRatesByKey(prev => ({ ...prev, [key]: rows })); })
        .catch(() => { if (!cancelled) setRatesByKey(prev => ({ ...prev, [key]: [] })); });
    });
    return () => { cancelled = true; };
  }, [token, metaReady, year, month, source, cmpYear, cmpMonth, cmpSource, headers, ratesByKey]);

/* ── Probe for a flat CF accounts catalogue (4th name source) ──────────── */
  useEffect(() => {
    if (!token || !metaReady) return;
    const h = headers();
    // Try a few common paths. First one that responds 200 with rows wins.
    const candidates = [
      `${BASE_URL}/v2/cashflow-accounts`,
      `${BASE_URL}/v2/cash-flow-accounts`,
      `${BASE_URL}/v2/cf-accounts`,
    ];
    (async () => {
      for (const url of candidates) {
        try {
          const r = await fetch(url, { headers: h });
          if (!r.ok) continue;
          const d = await r.json();
          const rows = d.value ?? (Array.isArray(d) ? d : []);
          if (!rows.length) continue;
          // Seed cfNameDict with whatever name field exists
          setCfNameDict(prev => {
            const next = { ...prev };
            rows.forEach(r => {
              const code = r.CashFlowAccountCode ?? r.cashFlowAccountCode ?? r.AccountCode ?? r.accountCode ?? r.Code ?? r.code;
              const name = r.CashFlowAccountName ?? r.cashFlowAccountName ?? r.AccountName ?? r.accountName ?? r.Name ?? r.name;
              if (code && name && !next[code]) next[code] = name;
            });
            return next;
          });
          return; // stop after first hit
        } catch { /* try next */ }
      }
    })();
  }, [token, metaReady, headers]);

  /* ── Fetch CF mapping + uploaded data ───────────────────── */
  useEffect(() => {
    if (!token || !metaReady) return;
    const h = headers();
    fetch(`${BASE_URL}/v2/mapped-cashflow-accounts`, { headers: h })
      .then(r => r.json()).then(d => {
        const rows = d.value ?? (Array.isArray(d) ? d : []);
        setCfMapping(rows);
        // Build metadata and groupToCf maps
        const meta = new Map();
        rows.forEach(map => {
          if (map.enabled === false || map.Enabled === false) return;
          const code = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
          const name = map.cashFlowAccountName ?? map.CashFlowAccountName ?? "";
          const sumParent = map.cashFlowAccountSumAccountCode ?? map.CashFlowAccountSumAccountCode ?? "";
          if (!code) return;
          if (!meta.has(code)) meta.set(code, { name, sumParent });
        });
        // Bubble up missing parents
        let added = true;
        while (added) {
          added = false;
          for (const node of [...meta.values()]) {
            if (node.sumParent && !meta.has(node.sumParent)) {
              meta.set(node.sumParent, { name: "", sumParent: "" });
              added = true;
            }
          }
        }
        setCfMetadata(meta);
        // groupToCf
        const g2cf = new Map();
        rows.forEach(map => {
          if (map.enabled === false || map.Enabled === false) return;
          const ga = map.groupAccountCode ?? map.GroupAccountCode ?? "";
          const cf = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
          if (!ga || !cf) return;
          if (!g2cf.has(ga)) g2cf.set(ga, []);
          g2cf.get(ga).push(cf);
        });
        setCfGroupToCf(g2cf);
      }).catch(() => {});
  }, [token, metaReady, headers]);

  useEffect(() => {
    if (!token || !metaReady || !year || !month || !source || !structure) return;
    setCfLoading(true);
    const h = headers();
const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevFilter = `Year eq ${prevYear} and Month eq ${prevMonth} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    Promise.all([
      fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(prevFilter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([curr, prev]) => {
      setCfUploadedData(curr);
      setCfUploadedDataPrev(prev);
      setCfLoading(false);
    }).catch(() => setCfLoading(false));
  }, [token, metaReady, year, month, source, structure, headers]);
  
const [cmpCfUploadedData, setCmpCfUploadedData] = useState([]);
const [cmpUploadedPrev, setCmpUploadedPrev] = useState([]);
const [cmpJournalData, setCmpJournalData] = useState([]);
const [cmpJournalPrev, setCmpJournalPrev] = useState([]);
const [dimensionsMeta, setDimensionsMeta] = useState([]); // [{DimensionGroupName, DimensionGroupCode, DimensionName, DimensionCode}]
  // Dimension filter (PageHeader): null = all, [] = none, [...] = selected
  const [upDimGroups, setUpDimGroups] = useState(null);
  const [upDimensions, setUpDimensions] = useState(null);

  // Derived catalogues for dropdowns
  const dimGroups = useMemo(() => {
    const seen = new Set();
    return (dimensionsMeta || [])
      .map(d => String(d.DimensionGroup ?? d.dimensionGroup ?? ""))
      .filter(g => g && !seen.has(g) && seen.add(g));
  }, [dimensionsMeta]);

  const filteredDims = useMemo(() => {
    if (!upDimGroups || upDimGroups.length === 0) return dimensionsMeta || [];
    return (dimensionsMeta || []).filter(d => {
      const g = String(d.DimensionGroup ?? d.dimensionGroup ?? "");
      return upDimGroups.includes(g);
    });
  }, [dimensionsMeta, upDimGroups]);

  /* ── Fetch dimensions metadata (for code↔name mirror in dim index) ── */
  useEffect(() => {
if (!token || !metaReady) return;
    const h = headers();
fetch(`${BASE_URL}/v2/dimensions`, { headers: h })
      .then(async (r) => {
        // Leer como texto y parsear con guarda: una respuesta vacía (token
        // expirado, 204, o error sin cuerpo) hacía que r.json() lanzara
        // "Unexpected end of JSON input" y rompía la carga de filtros.
        const txt = await r.text();
        if (!txt) return [];
        try {
          const d = JSON.parse(txt);
          return d.value ?? (Array.isArray(d) ? d : []);
        } catch {
          return [];
        }
      })
      .then((arr) => {
        setDimensionsMeta(arr);
      })
      .catch((e) => {
        console.error("🗂️ /v2/dimensions FAILED:", e);
        setDimensionsMeta([]);
      });
  }, [token, metaReady, headers]);

  /* ── Fetch compare data ─────────────────────────────────── */
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !metaReady) return;
    setCmpLoading(true);
    const h = headers();
const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}'`;
    let pY = Number(cmpYear), pM = Number(cmpMonth) - 1;
    if (pM < 1) { pM = 12; pY -= 1; }
    const filterPrev = `Year eq ${pY} and Month eq ${pM} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}'`;
const cmpConsWithFallback = async (flt) => {
      const cons = await fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(flt)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []);
      if (cons.length > 0) return cons;
      return await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(flt)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []);
    };
    Promise.all([
      cmpConsWithFallback(filter),
      fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      cmpConsWithFallback(filterPrev),
      fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterPrev)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filterPrev)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([cons, uploaded, consPrev, uploadedPrev, journals, journalsPrev]) => {
      setCmpRawData(cons);
      setCmpCfUploadedData(uploaded);
      setCmpRawDataPrev(consPrev);
      setCmpUploadedPrev(uploadedPrev);
      setCmpJournalData(journals);
      setCmpJournalPrev(journalsPrev);
      setCmpLoading(false);
    }).catch(() => { setCmpRawData([]); setCmpCfUploadedData([]); setCmpRawDataPrev([]); setCmpLoading(false); });
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, metaReady, headers]); // cmpRawDataPrev built from consPrev

  /* ── Derive parent options & children-of-perspective from groupStructure ── */
  // A "parent" is any company that has at least one child in the current
  // structure. The empty option means "no perspective" (default flat view).
  const { parentOptions, childrenOfPerspective, rootGroup } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.CompanyShortName ?? g.companyShortName ?? "",
      parent:    g.ParentShortName  ?? g.parentShortName  ?? "",
      structure: g.GroupStructure   ?? g.groupStructure   ?? "",
      hasChild:  g.HasChild         ?? g.hasChild         ?? false,
      detached:  g.Detached         ?? g.detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    // Parents = companies that have at least one child OR have hasChild flag
    const childCountByParent = new Map();
    gsRows.forEach(g => {
      if (g.parent) childCountByParent.set(g.parent, (childCountByParent.get(g.parent) ?? 0) + 1);
    });

    const parentSet = new Set();
    gsRows.forEach(g => {
      if (g.hasChild || childCountByParent.has(g.company)) parentSet.add(g.company);
    });

    const parentList = [...parentSet]
      .map(p => {
        const legal = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === p)?.CompanyLegalName
          ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === p)?.companyLegalName
          ?? p;
        return { value: p, label: legal };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

   // Siempre hay un grupo: la contribución es SIEMPRE a un grupo concreto
    // (mezclar todos los grupos contaba dos veces las sociedades de subgrupos).
    const opts = parentList;
    const known = new Set(gsRows.map(g => g.company));
    const rootGroup = gsRows.find(g => !g.parent || !known.has(g.parent))?.company ?? parentList[0]?.value ?? "";

    // Contributors to the selected perspective = the parent itself + its
    // direct children. The parent is a contributor too because it has its own
    // operational amounts (it's both the holding entity AND an operating
    // company in its own right). This mirrors the consolidation sheet's
    // `[selected, ...kids]` pattern.
    const kids = perspective
      ? gsRows.filter(g => g.parent === perspective).map(g => g.company)
      : [];
    const contributors = perspective ? [perspective, ...kids] : [];

    return { parentOptions: opts, childrenOfPerspective: contributors, rootGroup };
  }, [groupStructure, structure, companies, perspective]);

  // Grupo por defecto: la raíz (se ajusta al renderizar, sin efecto).
  const perspectiveKey = parentOptions.map(o => o.value).join("|");
  const [seenPerspectiveKey, setSeenPerspectiveKey] = useState(null);
  if (seenPerspectiveKey !== perspectiveKey) {
    setSeenPerspectiveKey(perspectiveKey);
    if (parentOptions.length && !parentOptions.some(o => o.value === perspective)) {
      setPerspective(parentOptions.some(o => o.value === rootGroup) ? rootGroup : parentOptions[0].value);
    }
  }
  const perspectiveMode = !!perspective;

/* ── Derive pivot data ──────────────────────────────────── */

// When a mapping is active, derive its sortOrder + breakers + the set of
  // mapped account codes. We use the *converted* form which gives us a flat
  // Map<code, {section, sortOrder, isSum}> — perfect for swapping in for
  // the standard breakerSortOrder/breakers pair without changing the renderer.
  //
  // IMPORTANT: When `treeLiteral` is available (Phase E), we skip this entire
  // derivation because the literal render path handles ordering, breakers,
  // filtering, duplicates and sum nodes itself. Phase D would interfere.
const mappingDerived = useMemo(() => {
    if (activeMapping?.treeLiteral) return null;
    if (!activeMapping?.treeConverted) return null;
    const { rows, sections } = activeMapping.treeConverted;
    // rows keyed by instance id, each with { code, name, dims, section, ... }
    const instances = [];
    const sortOrder = new Map();   // instanceId → sortOrder
    const codeSection = new Map(); // instanceId → sectionId
    const mappedCodes = new Set(); // unique code strings for filtering rawData
    rows.forEach((info, instanceId) => {
      if (!info.isSum) mappedCodes.add(info.code);
      instances.push({ instanceId, ...info });
      sortOrder.set(instanceId, info.sortOrder);
      codeSection.set(instanceId, info.section);
    });
    instances.sort((a, b) => a.sortOrder - b.sortOrder);
    // Assign breaker to first instance of each section
    const breakers = {};
    const seenSections = new Set();
    instances.forEach(inst => {
      if (inst.isSum) return;
      if (seenSections.has(inst.section)) return;
      seenSections.add(inst.section);
      const secInfo = sections.get(inst.section);
      if (secInfo && secInfo.label) {
        breakers[inst.instanceId] = { label: secInfo.label, color: secInfo.color || "#1a2f8a" };
      }
    });
    return { instances, sortOrder, codeSection, breakers, mappedCodes };
  }, [activeMapping]);

const { accountMap, pivot, pivotPrev, pivotG, pivotPrevG, journalPivotG, journalPivotPrevG, tree, plTreeStd, bsTreeStd, cols, journalPivot, counterpartyPivot, cmpPivot, cmpPivotPrev, dimIdx, dimIdxPrev, journalDimIdx, cptyDimIdx, cmpDimIdx, cmpDimIdxPrev, rowMatchesDims } = useMemo(() => {
    if (!rawData.length) return { accountMap: new Map(), pivot: new Map(), tree: [], cols: [], journalPivot: new Map(), cmpPivot: new Map() };
    // Conversión por periodo (la del propio periodo para cada pivot).
    const ratesFor = (y, m, src) => ratesByKey[`${Number(y)}|${Number(m)}|${src}`] ?? [];
    const prevOf = (y, m) => (Number(m) === 1 ? [Number(y) - 1, 12] : [Number(y), Number(m) - 1]);
    const fxCur = makeFxToGroup(ratesFor(year, month, source), companies, perspective);
    const fxPrev = makeFxToGroup(ratesFor(...prevOf(year, month), source), companies, perspective);
    const fxCmp = makeFxToGroup(ratesFor(cmpYear, cmpMonth, cmpSource), companies, perspective);
    const fxCmpPrev = makeFxToGroup(ratesFor(...prevOf(cmpYear, cmpMonth), cmpSource), companies, perspective);
    const toView = (r, fx) => {
      const amt = amountOf(r);
      if (currencyMode !== "local") return amt;
      const f = fx(r.CompanyShortName ?? r.companyShortName ?? "", r.AccountType ?? r.accountType ?? "");
      return f ? amt / f : amt;
    };

    const accountMap = new Map();
const filtered = rawData.filter(r => {
      // Contribución al grupo elegido: matriz (Parent) + sociedades (Contribution).
      if (!isContributionRow(r, perspective)) return false;

      // When a mapping is active, restrict the dataset to ONLY the accounts
      // present in the mapping. This is what "applying" the mapping means
      // visually: foreign codes don't pollute the view.
// NOTE: mapping-based code restriction removed from the pivot too — the
      // pivot holds all codes; the mapping's literal decides what's shown/where.

// NOTE: intentionally NOT filtering the pivot by typeFilter. The pivot must
      // hold ALL statement types so the export can render every sheet (BS/CF)
      // regardless of the active tab. The on-screen view is filtered by the TREE
      // (which is per-tab), not by the pivot, so this doesn't change the app.
      // DIMENSION FILTER (from PageHeader multiselect)
      if (Array.isArray(upDimensions) && upDimensions.length > 0) {
        const dCode = String(r.DimensionCode ?? r.dimensionCode ?? "");
        if (!upDimensions.includes(dCode)) return false;
      } else if (Array.isArray(upDimGroups) && upDimGroups.length > 0) {
        // Filter by group when no specific dimension chosen
        const dimsStr = String(r.Dimensions ?? r.dimensions ?? "").trim();
        if (!dimsStr) return false;
        const rowGroups = dimsStr.split("||")
          .map(p => p.slice(0, p.indexOf(":")).trim())
          .filter(Boolean);
        if (!rowGroups.some(g => upDimGroups.includes(g))) return false;
      }
      return true;
    });

    // Build accountMap from filtered rows
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (code && !accountMap.has(code)) {
        accountMap.set(code, {
          AccountCode:    code,
          AccountName:    r.AccountName    ?? r.accountName    ?? "",
          AccountType:    r.AccountType    ?? r.accountType    ?? "",
          SumAccountCode: r.SumAccountCode ?? r.sumAccountCode ?? "",
        });
      }
    });

// Catalogue of all dimension values: code/name/groupCode/groupName.
    // Resolver: given a value (code or name) and optional group hint, return
    // every catalogue entry that matches → lets buildDimKeys expand all forms.
const dimCatalogue = (dimensionsMeta || []).map(d => {
      // The API returns a single `DimensionGroup` field — use it as both
      // groupName and groupCode since we don't have separate values.
      const grp = String(d.DimensionGroup ?? d.dimensionGroup ?? d.DimensionGroupName ?? d.dimensionGroupName ?? "").trim();
      return {
        groupName: grp,
        groupCode: String(d.DimensionGroupCode ?? d.dimensionGroupCode ?? grp).trim(),
        name:      String(d.DimensionName      ?? d.dimensionName      ?? "").trim(),
        code:      String(d.DimensionCode      ?? d.dimensionCode      ?? "").trim(),
      };
    });

const dimResolver = (value, groupHint) => {
      const v = String(value || "").trim();
      const g = String(groupHint || "").trim();
      if (!v) return [];
      return dimCatalogue.filter(d => {
        const matchVal = d.name === v || d.code === v;
        if (!matchVal) return false;
        if (!g) return true;
        return d.groupName === g || d.groupCode === g;
      });
    };

    // rowMatchesDims: nodeDims is ["Group:Name"] from mapping. row.Dimensions
    // is like "Group:Code||OtherGroup:Code". Resolves name↔code via catalogue.
    const rowMatchesDims = (r, nodeDims) => {
      if (!nodeDims || nodeDims.length === 0) return true;
      const dimsStr = String(r?.Dimensions ?? r?.dimensions ?? "").trim();
      if (!dimsStr) return false;
      const rowPairs = new Set(
        dimsStr.split("||").map(s => s.trim()).filter(Boolean)
      );
      return nodeDims.some(nd => {
        const need = String(nd).trim();
        if (rowPairs.has(need)) return true;
        const colonIdx = need.indexOf(":");
        if (colonIdx <= 0) return false;
        const grp = need.slice(0, colonIdx).trim();
        const val = need.slice(colonIdx + 1).trim();
        const hits = dimResolver(val, grp);
        for (const h of hits) {
          if (rowPairs.has(`${grp}:${h.code}`)) return true;
          if (rowPairs.has(`${h.groupCode}:${h.code}`)) return true;
          if (rowPairs.has(`${grp}:${h.name}`)) return true;
          if (rowPairs.has(`${h.groupCode}:${h.name}`)) return true;
        }
        return false;
      });
    };

    const pivot = new Map();
    // Mismo pivot en la divisa del grupo: la columna consolidada del grupo y
    // los % se calculan siempre en esa divisa (en modo local cada sociedad
    // está en su moneda y no se pueden sumar entre sí).
    const pivotG = new Map();
    const addG = (pv, code, co, r) => {
      if (!pv.has(code)) pv.set(code, {});
      const cg = pv.get(code);
      if (!cg[co]) cg[co] = { total: 0, rows: [] };
      const a = amountOf(r);
      cg[co].total += a;
      cg[co].rows.push({ ...r, _amt: a });
    };
    const dimIdx = new Map(); // `${code}|${co}` → Map<dimKey, amount>
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!code || !co) return;
      if (!pivot.has(code)) pivot.set(code, {});
      const c = pivot.get(code);
      if (!c[co]) c[co] = { total: 0, rows: [] };
// Importe de la contribución: en la divisa del grupo (Konsolidator) o, en
      // modo local, deshecho con el tipo de cambio del periodo.
      const amt = toView(r, fxCur);
      c[co].total += amt;
      c[co].rows.push({ ...r, _amt: amt });
      addG(pivotG, code, co, r);
// Dim index for literal-mode dim filters
      const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${co}`;
        if (!dimIdx.has(k)) dimIdx.set(k, new Map());
        const m = dimIdx.get(k);
        dimKeys.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
      }
    });
const TYPE_ORDER = { "P/L": 0, "DIS": 0, "B/S": 1, "C/F": 2, "CFS": 2 };

// Effective sort order: mapping overrides standard.
    // Note: when mapping is active, sortOrder is keyed by instanceId (not code).
    const effectiveSortOrder = mappingDerived?.sortOrder ?? breakerSortOrder;

let tree;
    let plTreeStd = [];
    let bsTreeStd = [];
    // Mapping-active branch: build a tree with one node per INSTANCE, so the
    // same code with different dims renders as separate rows (Sabana pattern).
    if (mappingDerived && mappingDerived.instances && mappingDerived.instances.length > 0) {
      const instTree = mappingDerived.instances
        .filter(inst => !inst.isSum) // sum instances not shown as data rows
        .map(inst => {
          const existing = accountMap.get(inst.code);
          return {
            AccountCode: inst.code,
            AccountName: inst.name || existing?.AccountName || inst.code,
            AccountType: existing?.AccountType || "P/L",
            SumAccountCode: existing?.SumAccountCode ?? null,
            children: [],
            _instanceId: inst.instanceId,
            _dims: inst.dims || [],
            _isSum: inst.isSum,
          };
        });
      tree = instTree;
    } else if (effectiveSortOrder.size > 0) {
      const isCustomStd = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");

if (isCustomStd && codeToSectionInfo && codeToSectionInfo.size > 0) {
        // CUSTOM: build hierarchical tree from the standard.
        //
        // The standard defines parent_code for every account. But grand
        // totals (section_code=null, e.g. I.PL, C, H) semantically
        // aggregate across sections, so we do NOT nest their children
        // beneath them for the render — that would collapse Revenue,
        // COGS, etc. beneath I.PL. Instead, we treat grand-total accounts
        // as leaves (no children) and let their descendants become roots
        // at the section level.
        const STMT_TO_TYPE = { PL: "P/L", BS: "B/S", CF: "C/F" };
        const isGrandTotal = (code) => {
          const info = codeToSectionInfo.get(code);
          return !info || !info.section;
        };

        // Build nodes for every code in the standard
        const stdNodes = new Map();
        for (const code of effectiveSortOrder.keys()) {
          const fromMap = accountMap.get(code);
          const stmt = codeToStatementFromStd.get(code);
          const accountType = fromMap?.AccountType ?? STMT_TO_TYPE[stmt] ?? "P/L";
          stdNodes.set(code, {
            AccountCode: code,
            AccountName: fromMap?.AccountName ?? codeToNameFromStd.get(code) ?? code,
            AccountType: accountType,
           SumAccountCode: (isCustomStd ? codeToParentFromStd.get(code) : null) ?? fromMap?.SumAccountCode ?? codeToParentFromStd.get(code) ?? "",
            children: [],
          });
        }
// Wire parent-child links. SKIP the link if:
        //  1. parent is a grand total (section=null) — nesting under I.PL, C,
        //     H collapses everything under one root
        //  2. parent belongs to a DIFFERENT section than the child — the
        //     standard uses narrative parent_code where A.01(REV) parents to
        //     A.03.a(COGS), which is contable but breaks section rendering
        stdNodes.forEach(node => {
          const parentCode = node.SumAccountCode;
          if (!parentCode) return;
          if (isGrandTotal(parentCode)) return;
          const nodeSec = codeToSectionInfo.get(node.AccountCode)?.section;
          const parentSec = codeToSectionInfo.get(parentCode)?.section;
          if (nodeSec && parentSec && nodeSec !== parentSec) return;
          const parent = stdNodes.get(parentCode);
          if (parent && parent !== node) parent.children.push(node);
        });

// Build roots for a given type-filter predicate. Extracted so we can call
        // it multiple times in "Todos" mode and get the same roots the standalone
        // P/L and B/S tabs would render, instead of one giant merged filter.
        const buildRootsForFilter = (typePasses) => {
          const set = new Set(
            [...stdNodes.values()].filter(typePasses).map(n => n.AccountCode)
          );
          const sortRec = (node) => {
            if (!node.children || !node.children.length) return;
            node.children = node.children
              .filter(c => set.has(c.AccountCode))
              .sort((a, b) => {
                const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999999;
                const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999999;
                return sA - sB;
              });
            node.children.forEach(sortRec);
          };
          const roots = [...stdNodes.values()]
            .filter(typePasses)
            .filter(n => {
              const p = n.SumAccountCode;
              if (!p) return true;
              if (isGrandTotal(p)) return true;
              if (!stdNodes.has(p)) return true;
              if (!set.has(p)) return true;
              const nodeSec = codeToSectionInfo.get(n.AccountCode)?.section;
              const parentSec = codeToSectionInfo.get(p)?.section;
              if (nodeSec && parentSec && nodeSec !== parentSec) return true;
              return false;
            })
            .sort((a, b) => {
              const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999999;
              const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999999;
              return sA - sB;
            });
// Note: sortRec MUTATES children. Clone shallow before to avoid
          // corrupting a shared node between P/L and B/S passes.
          const cloneShallow = (n) => ({ ...n, children: n.children.map(cloneShallow) });
          const clonedRoots = roots.map(cloneShallow);
clonedRoots.forEach(sortRec);
// Grand totals (C.ACT / G.PYC / G.PAS, section=null) must not render as rows.
          // The standard's parent wiring already skips linking children under grand totals,
          // so these come through as empty roots — drop them (and splice any children, just
          // in case a future standard does nest under them). Real section rows keep their breakers.
          const dropGrandTotals = (nodes) => {
            const out = [];
            for (const n of nodes) {
              if (isGrandTotal(n.AccountCode)) {
                if (n.children && n.children.length) out.push(...dropGrandTotals(n.children));
                // else: empty grand-total container — drop entirely
              } else {
                out.push(n);
              }
            }
            return out;
          };
          return dropGrandTotals(clonedRoots);
        };

const plPass  = (n) => { const t = n.AccountType ?? ""; return t === "P/L" || t === "DIS"; };
        const bsPass  = (n) => (n.AccountType ?? "") === "B/S";
       

// Build PL and BS roots independently ALWAYS, so exports can render each
        // statement from its own custom-no-user structure regardless of which tab
        // is active. Otherwise the on-screen `tree` (shaped for the active tab, e.g.
        // a PL user mapping) leaks into the other statement sheets.
        plTreeStd = buildRootsForFilter(plPass);
        bsTreeStd = buildRootsForFilter(bsPass);
if (!typeFilter) {
          tree = [...plTreeStd, ...bsTreeStd];
        } else if (typeFilter === "P/L") {
          tree = plTreeStd;
        } else if (typeFilter === "B/S") {
          tree = bsTreeStd;
} else if (typeFilter === "C/F") {
          tree = buildRootsForFilter((n) => { const t = n.AccountType ?? ""; return t === "C/F" || t === "CFS"; });
        } else {
          tree = buildRootsForFilter((n) => (n.AccountType ?? "") === typeFilter);
        }
} else {
        // Non-CUSTOM legacy path
const filtered = [...accountMap.values()].filter(n => {
          const type = n.AccountType ?? "";
          return type === "P/L" || type === "DIS" || type === "B/S";
        });
        const fullTree = buildTree(filtered);
        const treeIndex = new Map();
        const walk = (nodes) => nodes.forEach(n => {
          treeIndex.set(String(n.AccountCode), n);
          walk(n.children || []);
        });
        walk(fullTree);
        const flatOrdered = filtered
          .map(n => treeIndex.get(String(n.AccountCode)) ?? { ...n, children: [] })
          .filter(n => effectiveSortOrder.has(n.AccountCode))
          .sort((a, b) => {
            const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999;
            const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999;
            if (sA !== sB) return sA - sB;
            const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
            const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
            return tA - tB;
          });
        tree = flatOrdered.map(n => ({ ...n, children: [] }));
      }
    } else {
      const rawTree = buildTree([...accountMap.values()]);
      tree = [...rawTree].sort((a, b) => {
        const tA = TYPE_ORDER[a.AccountType ?? a.accountType ?? ""] ?? 99;
        const tB = TYPE_ORDER[b.AccountType ?? b.accountType ?? ""] ?? 99;
        if (tA !== tB) return tA - tB;
        return pgcSort(a, b);
      });
    }
    const cols = [...new Set(filtered.map(r => r.CompanyShortName ?? r.companyShortName ?? "").filter(Boolean))].sort();

// Journal pivot — Phase 1 fixes:
    //  • Use currencyMode to pick reporting vs local amount (same as main pivot)
    //  • Sign matches main pivot (no inversion)
    //  • Only count journals where CompanyShortName === target company
    //    (counterparty impact moved to a separate pivot in a later phase)
    const journalPivot = new Map();
    const add = (code, co, jt, amt) => {
      if (!code || !co) return;
      if (!journalPivot.has(code)) journalPivot.set(code, {});
      const c = journalPivot.get(code);
      if (!c[co]) c[co] = {};
      c[co][jt] = (c[co][jt] ?? 0) + amt;
    };
const journalDimIdx = new Map(); // `${code}|${co}` → Map<dimKey, {AJE, RJE, ...}>
    // Desglose como Konsolidator (comprobado contra el modelo):
    //  · solo asientos CONTABILIZADOS de la propia sociedad;
    //  · SYS, AJE y RJE siempre; EJE solo en subgrupos (son sus eliminaciones);
    //    CFA nunca (no forma parte de la contribución);
    //  · con su signo (el mismo que consolidated-accounts: antes se invertía)
    //    y convertidos a la divisa del grupo.
    // "Uploaded" = total − asientos, que así es la carga convertida (y el
    // redondeo de la conversión, de céntimos).
    const fx = fxCur;
    const subgroups = new Set(rawData
      .filter(r => (r.CompanyRole ?? r.companyRole) === "Group")
      .map(r => r.CompanyShortName ?? r.companyShortName ?? ""));
    const contributors = new Set(filtered.map(r => r.CompanyShortName ?? r.companyShortName ?? ""));
    journalData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      const jt   = String(r.JournalType ?? r.journalType ?? "").toUpperCase();
      if (!code || !co || !jt || !contributors.has(co) || !isPostedJournal(r)) return;
      const isSub = co !== perspective && subgroups.has(co);
      const counts = jt === "SYS" || jt === "AJE" || jt === "RJE" || (jt === "EJE" && isSub);
      if (!counts) return;
      const amt = currencyMode === "local" ? amountOf(r) : amountOf(r) * fx(co, r.AccountType ?? r.accountType ?? "");

      add(code, co, jt, amt);

const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${co}`;
        if (!journalDimIdx.has(k)) journalDimIdx.set(k, new Map());
        const m = journalDimIdx.get(k);
        dimKeys.forEach(dk => {
          if (!m.has(dk)) m.set(dk, {});
          const bucket = m.get(dk);
          bucket[jt] = (bucket[jt] ?? 0) + amt;
        });
      }
    });

    const rolled = new Map();
    const rollUp = (node) => {
      const code = node.AccountCode;
      const result = {};
      const direct = journalPivot.get(code) ?? {};
      Object.entries(direct).forEach(([co, jtMap]) => {
        if (!result[co]) result[co] = {};
        Object.entries(jtMap).forEach(([jt, amt]) => { result[co][jt] = (result[co][jt] ?? 0) + amt; });
      });
      (node.children || []).forEach(child => {
        const childRolled = rollUp(child);
        Object.entries(childRolled).forEach(([co, jtMap]) => {
          if (!result[co]) result[co] = {};
          Object.entries(jtMap).forEach(([jt, amt]) => { result[co][jt] = (result[co][jt] ?? 0) + amt; });
        });
      });
      rolled.set(code, result);
      return result;
    };
tree.forEach(rollUp);
    // Además, cada asiento se acumula subiendo por la cuenta suma de los propios
    // datos (SumAccountCode). Así llega también a los totales que no cuelgan
    // del árbol pintado (p. ej. G.PYC): antes, en esos totales faltaban los
    // asientos y "Uploaded" (total − asientos) salía descuadrado.
    const sumParentOf = new Map();
    rawData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const parent = r.SumAccountCode ?? r.sumAccountCode ?? "";
      if (code && parent && parent !== code && !sumParentOf.has(code)) sumParentOf.set(code, parent);
    });
    const chainJournals = new Map();
    journalPivot.forEach((byCo, code) => {
      let c = code;
      const seen = new Set();
      while (c && !seen.has(c)) {
        seen.add(c);
        if (!chainJournals.has(c)) chainJournals.set(c, {});
        const target = chainJournals.get(c);
        Object.entries(byCo).forEach(([co, jtMap]) => {
          if (!target[co]) target[co] = {};
          Object.entries(jtMap).forEach(([jt, amt]) => { target[co][jt] = (target[co][jt] ?? 0) + amt; });
        });
        c = sumParentOf.get(c);
      }
    });
    chainJournals.forEach((v, code) => rolled.set(code, v));

    // ─── Counterparty pivot — Phase 3 ───────────────────────────────
    // For each (account, company), sum journals where THAT company appears
    // as CounterpartyShortName (not as CompanyShortName). This is the
    // "indirect impact" — journals other companies posted referencing
    // this one. Used in the opt-in IC column.
const counterpartyPivot = new Map();
    const cptyDimIdx = new Map();
    journalData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const cpty = r.CounterpartyShortName ?? r.counterpartyShortName ?? "";
      if (!code || !cpty || !isPostedJournal(r)) return;
      const poster = r.CompanyShortName ?? r.companyShortName ?? "";
      // IC: del que contabiliza a la divisa de la columna (grupo, o la local de la sociedad).
      const tpe = r.AccountType ?? r.accountType ?? "";
      const amt = currencyMode === "local"
        ? amountOf(r) * fx(poster, tpe) / fx(cpty, tpe)
        : amountOf(r) * fx(poster, tpe);
      if (!counterpartyPivot.has(code)) counterpartyPivot.set(code, {});
      const c = counterpartyPivot.get(code);
      c[cpty] = (c[cpty] ?? 0) + amt;

const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${cpty}`;
        if (!cptyDimIdx.has(k)) cptyDimIdx.set(k, new Map());
        const m = cptyDimIdx.get(k);
        dimKeys.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
      }
    });

    // Roll up counterparty pivot through the tree (same as journal pivot)
    const rolledCpty = new Map();
    const rollUpCpty = (node) => {
      const code = node.AccountCode;
      const result = {};
      const direct = counterpartyPivot.get(code) ?? {};
      Object.entries(direct).forEach(([co, amt]) => {
        result[co] = (result[co] ?? 0) + amt;
      });
      (node.children || []).forEach(child => {
        const childRolled = rollUpCpty(child);
        Object.entries(childRolled).forEach(([co, amt]) => {
          result[co] = (result[co] ?? 0) + amt;
        });
      });
      rolledCpty.set(code, result);
      return result;
    };
    tree.forEach(rollUpCpty);
    const chainCpty = new Map();
    counterpartyPivot.forEach((byCo, code) => {
      let c = code;
      const seen = new Set();
      while (c && !seen.has(c)) {
        seen.add(c);
        if (!chainCpty.has(c)) chainCpty.set(c, {});
        const target = chainCpty.get(c);
        Object.entries(byCo).forEach(([co, amt]) => { target[co] = (target[co] ?? 0) + amt; });
        c = sumParentOf.get(c);
      }
    });
    chainCpty.forEach((v, code) => rolledCpty.set(code, v));

const cmpPivot = new Map();
    const cmpDimIdx = new Map();
    cmpRawData.filter(r => isContributionRow(r, perspective)).forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!code || !co) return;
      if (!cmpPivot.has(code)) cmpPivot.set(code, {});
      const c = cmpPivot.get(code);
      if (!c[co]) c[co] = 0;
      const amt = toView(r, fxCmp);
      c[co] += amt;

const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${co}`;
        if (!cmpDimIdx.has(k)) cmpDimIdx.set(k, new Map());
        const m = cmpDimIdx.get(k);
        dimKeys.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
      }
    });

const pivotPrev = new Map();
const pivotPrevG = new Map();
const dimIdxPrev = new Map(); // `${code}|${co}` → Map<dimKey, amount> for prev period
rawDataPrev.forEach(r => {
  if (!isContributionRow(r, perspective)) return;
  const code = r.AccountCode ?? r.accountCode ?? "";
  const co   = r.CompanyShortName ?? r.companyShortName ?? "";
  if (!code || !co) return;
  if (!pivotPrev.has(code)) pivotPrev.set(code, {});
  const c = pivotPrev.get(code);
  if (!c[co]) c[co] = { total: 0, rows: [] };
  const amtP = toView(r, fxPrev);
  c[co].total += amtP;
  c[co].rows.push({ ...r, _amt: amtP });
  addG(pivotPrevG, code, co, r);
  // Dim index for prev period, so monthly deltas on dimensioned accounts
  // subtract the SAME dimension's prev value (not the sum of all dims).
  const dimKeysP = buildDimKeys(r, dimResolver);
  if (dimKeysP.size > 0) {
    const k = `${code}|${co}`;
    if (!dimIdxPrev.has(k)) dimIdxPrev.set(k, new Map());
    const m = dimIdxPrev.get(k);
    dimKeysP.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amtP));
  }
});
const cmpPivotPrev = new Map();
const cmpDimIdxPrev = new Map(); // `${code}|${co}` → Map<dimKey, amount> (compare prev)
(cmpRawDataPrev || []).forEach(r => {
  if (!isContributionRow(r, perspective)) return;
  const code = r.AccountCode ?? r.accountCode ?? "";
  const co   = r.CompanyShortName ?? r.companyShortName ?? "";
  if (!code || !co) return;
  if (!cmpPivotPrev.has(code)) cmpPivotPrev.set(code, {});
  const c = cmpPivotPrev.get(code);
  if (!c[co]) c[co] = 0;
  const amt = toView(r, fxCmpPrev);
  c[co] += amt;
  const dimKeysCP = buildDimKeys(r, dimResolver);
  if (dimKeysCP.size > 0) {
    const k = `${code}|${co}`;
    if (!cmpDimIdxPrev.has(k)) cmpDimIdxPrev.set(k, new Map());
    const m = cmpDimIdxPrev.get(k);
    dimKeysCP.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
  }
});



    /* ══ Importes de cada sociedad: CARGA + ASIENTOS APLICADOS ══════════
       Lo que ve la página, por cuenta y sociedad del grupo (matriz y las que
       le aportan), en su moneda local (o convertido a la del grupo con el
       selector):
         · Uploaded → su carga (uploaded-accounts, Origin = Upload)
         · AJE, RJE, EJE, SYS, CFA → sus asientos contabilizados (journal-entries)
         · Columna de la sociedad (sin desplegar) = Uploaded + asientos.
       La carga trae también las cuentas suma; los asientos van a cuentas de
       detalle y se suben por la cuenta suma (SumAccountCode). */
    const JTYPES = ["AJE", "RJE", "EJE", "SYS", "CFA"];
    // Mismo filtro de dimensiones de la cabecera que el resto de la página.
    const passesHeaderDims = (r) => {
      if (Array.isArray(upDimensions) && upDimensions.length > 0) {
        return upDimensions.includes(String(r.DimensionCode ?? r.dimensionCode ?? ""));
      }
      if (Array.isArray(upDimGroups) && upDimGroups.length > 0) {
        const dimsStr = String(r.Dimensions ?? r.dimensions ?? "").trim();
        if (!dimsStr) return false;
        return dimsStr.split("||").map(x => x.slice(0, x.indexOf(":")).trim()).filter(Boolean).some(g => upDimGroups.includes(g));
      }
      return true;
    };
    const buildCompany = (uploads, journals, fxP, conv) => {
      const pv = new Map();   // code → co → { total, rows }
      const jp = new Map();   // code → co → { Uploaded, AJE, … }
      const cell = (m, code, co, init) => {
        if (!m.has(code)) m.set(code, {});
        const byCo = m.get(code);
        if (!byCo[co]) byCo[co] = init();
        return byCo[co];
      };
      const mult = (co, tpe) => (conv ? fxP(co, tpe) : 1);
      (uploads ?? []).forEach(r => {
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const code = r.AccountCode ?? r.accountCode ?? "";
        if (!code || !contributors.has(co) || (r.Origin ?? r.origin) !== "Upload") return;
        if (!passesHeaderDims(r)) return;
        const amt = amountOf(r) * mult(co, r.AccountType ?? r.accountType ?? "");
        const pc = cell(pv, code, co, () => ({ total: 0, rows: [] }));
        pc.total += amt; pc.rows.push({ ...r, _amt: amt });
        const jc = cell(jp, code, co, () => ({}));
        jc.Uploaded = (jc.Uploaded ?? 0) + amt;
      });
      (journals ?? []).forEach(r => {
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const code = r.AccountCode ?? r.accountCode ?? "";
        const jt = String(r.JournalType ?? r.journalType ?? "").toUpperCase();
        if (!code || !contributors.has(co) || !JTYPES.includes(jt) || !isPostedJournal(r)) return;
        if (!passesHeaderDims(r)) return;
        const amt = amountOf(r) * mult(co, r.AccountType ?? r.accountType ?? "");
        let c = code;
        const seen = new Set();
        while (c && !seen.has(c)) {
          seen.add(c);
          const pc = cell(pv, c, co, () => ({ total: 0, rows: [] }));
          pc.total += amt;
          if (c === code) pc.rows.push({ ...r, _amt: amt });
          const jc = cell(jp, c, co, () => ({}));
          jc[jt] = (jc[jt] ?? 0) + amt;
          c = sumParentOf.get(c);
        }
      });
      return { pv, jp };
    };
    const conv = currencyMode !== "local";
    const cur  = buildCompany(cfUploadedData, journalData, fxCur, conv);
    const prv  = buildCompany(cfUploadedDataPrev, journalDataPrev, fxPrev, conv);
    const curG = buildCompany(cfUploadedData, journalData, fxCur, true);
    const prvG = buildCompany(cfUploadedDataPrev, journalDataPrev, fxPrev, true);
    const replacePivot = (target, src) => { target.clear(); src.forEach((v, k) => target.set(k, v)); };
    replacePivot(pivot, cur.pv);
    replacePivot(pivotPrev, prv.pv);
    replacePivot(pivotG, curG.pv);
    replacePivot(pivotPrevG, prvG.pv);
    // Desglose: acumulado o del mes (PyG y DIS, menos el mes anterior)
    const typeOf = new Map();
    [...(cfUploadedData ?? []), ...(journalData ?? [])].forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (code && !typeOf.has(code)) typeOf.set(code, r.AccountType ?? r.accountType ?? "");
    });
    rolled.clear();
    cur.jp.forEach((byCo, code) => {
      const out = {};
      Object.entries(byCo).forEach(([co, parts]) => {
        out[co] = { ...parts };
        const t = typeOf.get(code) ?? "";
        if (!ytdOnly && (t === "P/L" || t === "DIS")) {
          const pp = prv.jp.get(code)?.[co] ?? {};
          Object.keys(pp).forEach(k => { out[co][k] = (out[co][k] ?? 0) - pp[k]; });
        }
      });
      rolled.set(code, out);
    });
    // Comparación: el mismo cálculo con el periodo B
    const cmpCur = buildCompany(cmpCfUploadedData, cmpJournalData, fxCmp, conv);
    const cmpPrv = buildCompany(cmpUploadedPrev, cmpJournalPrev, fxCmpPrev, conv);
    const toNumbers = (target, src) => {
      target.clear();
      src.forEach((byCo, code) => {
        const o = {};
        Object.entries(byCo).forEach(([co, c]) => { o[co] = c.total; });
        target.set(code, o);
      });
    };
    if (cmpCfUploadedData.length || cmpJournalData.length) {
      toNumbers(cmpPivot, cmpCur.pv);
      toNumbers(cmpPivotPrev, cmpPrv.pv);
    }

    return { accountMap, pivot, pivotPrev, pivotG, pivotPrevG, journalPivotG: curG.jp, journalPivotPrevG: prvG.jp, tree, plTreeStd, bsTreeStd, cols, journalPivot: rolled, counterpartyPivot: rolledCpty, cmpPivot, cmpPivotPrev, dimIdx, dimIdxPrev, journalDimIdx, cptyDimIdx, cmpDimIdx, cmpDimIdxPrev, rowMatchesDims };
}, [rawData, rawDataPrev, journalData, journalDataPrev, cfUploadedData, cfUploadedDataPrev, cmpCfUploadedData, cmpUploadedPrev, cmpJournalData, cmpJournalPrev, ytdOnly, typeFilter, cmpRawData, cmpRawDataPrev, perspective, ratesByKey, currencyMode, year, month, source, cmpYear, cmpMonth, cmpSource, companies, breakerSortOrder, mappingDerived, dimensionsMeta, activeStandardKey, codeToSectionInfo, codeToNameFromStd, codeToParentFromStd, codeToStatementFromStd, upDimGroups, upDimensions]);

// CF-specific pivot from uploaded data
 const { cfTree, cfPivot, cfPivotPrev, cfCols, cmpCfPivot } = useMemo(() => {
// Compute for "C/F" tab AND "Todos" view (typeFilter is null/empty).
// In Todos, the Cash Flow sheet still needs cfTree/cfPivot to render.
// Always compute CF (not just on the CF/Todos tabs) so the export can render
// the Cash Flow sheet regardless of which tab the user is currently on.
const shouldComputeCf = true;
if (!shouldComputeCf || !cfUploadedData.length || !cfMetadata.size) {
      return { cfTree: [], cfPivot: new Map(), cfCols: [], cmpCfPivot: new Map() };
    }
    // When a CF mapping is active, mappingDerived tells us which CF account
    // codes to keep and how to order them. Sum nodes excluded (MVP).
const cfMappingActive = mappingTab === "cf" ? mappingDerived : null;

    const piv = new Map();
    const filteredUploaded = perspectiveMode
      ? cfUploadedData.filter(r => childrenOfPerspective.includes(r.CompanyShortName ?? r.companyShortName ?? ""))
      : cfUploadedData;

    filteredUploaded.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!groupCode || !co) return;
      const cfs = cfGroupToCf.get(groupCode);
      if (!cfs) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      cfs.forEach(cfCode => {
        if (!piv.has(cfCode)) piv.set(cfCode, {});
        const c = piv.get(cfCode);
        if (!c[co]) c[co] = { total: 0, rows: [] };
        c[co].total += amt;
        c[co].rows.push(r);
      });
    });

// Bubble up to parents — only from direct children, not all descendants
    const directChildren = new Map(); // parent -> [child codes]
    cfMetadata.forEach(({ sumParent }, code) => {
      if (sumParent && piv.has(code)) {
        if (!directChildren.has(sumParent)) directChildren.set(sumParent, []);
        directChildren.get(sumParent).push(code);
      }
    });

    // Process bottom-up: find all codes that have no children in piv (leaves)
    // then sum upward level by level
    const allCodes = new Set([...piv.keys()]);
cfMetadata.forEach(({ sumParent }) => {
      if (sumParent) allCodes.add(sumParent);
    });

    // Topological sort - process leaves first
    const processed = new Set();
    const processCode = (code) => {
      if (processed.has(code)) return;
      const children = directChildren.get(code) || [];
      children.forEach(c => processCode(c));
      // Sum direct children into this parent
      if (children.length > 0 && !piv.has(code)) {
        piv.set(code, {});
      }
      if (children.length > 0) {
        const pp = piv.get(code);
        children.forEach(childCode => {
          const cp = piv.get(childCode) || {};
Object.entries(cp).forEach(([co, { total }]) => {
            if (!pp[co]) pp[co] = { total: 0, rows: [] };
            pp[co].total += total;
          });
        });
      }
      processed.add(code);
      // Bubble to parent
      const meta = cfMetadata.get(code);
      if (meta?.sumParent) {
        const parent = meta.sumParent;
        if (!piv.has(parent)) piv.set(parent, {});
        const pp = piv.get(parent);
        const cp = piv.get(code) || {};
        Object.entries(cp).forEach(([co, { total }]) => {
          if (!pp[co]) pp[co] = { total: 0, rows: [] };
          pp[co].total += total;
        });
      }
    };

// Only process leaf nodes (those with no children in piv)
    [...piv.keys()].forEach(code => {
      const hasChildren = directChildren.has(code);
      if (!hasChildren) processCode(code);
    });

    // Build tree nodes from cfMetadata
    const cfAccountMap = new Map();
// Build a name lookup combining all 3 sources (priority order):
    //  1. cfMetadata (from /v2/mapped-cashflow-accounts — cashFlowAccountName)
    //  2. cfMapping rows (sumAccountName fallback for parents)
    //  3. cfNameDict (from consolidated rows with AccountType C/F or CFS)
    const cfNameLookup = new Map();
    // Source 3 first (lowest priority — used as fallback only)
    Object.entries(cfNameDict).forEach(([code, name]) => {
      if (code && name) cfNameLookup.set(String(code), String(name));
    });
    // Source 2 — override with mapping rows
    cfMapping.forEach(map => {
      const code    = map.cashFlowAccountCode            ?? map.CashFlowAccountCode            ?? "";
      const name    = map.cashFlowAccountName            ?? map.CashFlowAccountName            ?? "";
      const sumCode = map.cashFlowAccountSumAccountCode  ?? map.CashFlowAccountSumAccountCode  ?? "";
      const sumName = map.cashFlowAccountSumAccountName  ?? map.CashFlowAccountSumAccountName  ?? "";
      if (code && name)    cfNameLookup.set(String(code), String(name));
      if (sumCode && sumName && !cfNameLookup.has(String(sumCode))) cfNameLookup.set(String(sumCode), String(sumName));
    });
    // Source 1 — highest priority (cfMetadata is authoritative)
cfMetadata.forEach(({ name }, code) => {
      if (name && code) cfNameLookup.set(String(code), String(name));
    });



// Synthetic parents (reconstructed from sumAccountCode chains but with no
    // name available anywhere) are noise — exclude them. Their children will
    // bubble up to the next named ancestor automatically.
    const resolveNamedAncestor = (startCode) => {
      let cur = cfMetadata.get(startCode)?.sumParent ?? "";
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const name = cfNameLookup.get(cur);
        if (name) return cur;
        cur = cfMetadata.get(cur)?.sumParent ?? "";
      }
      return "";
    };

    cfMetadata.forEach(({ name, sumParent }, code) => {
      if (!piv.has(code)) return;
      const resolvedName = cfNameLookup.get(code) || name || "";
      if (!resolvedName) return; // skip synthetic parents
      cfAccountMap.set(code, {
        AccountCode: code,
        AccountName: resolvedName,
        AccountType: "C/F",
        // If the immediate parent has no name, climb up to find one
        SumAccountCode: (sumParent && cfNameLookup.get(sumParent))
          ? sumParent
          : resolveNamedAncestor(code),
      });
    });

// If a CF mapping is active: drop unmapped accounts and order flat by mapping sortOrder.
    // If not: use the standard bubble-up tree as before.
let cfTree;
    const isCustomCf = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");
    if (cfMappingActive) {
      const filteredMap = new Map();
      cfAccountMap.forEach((node, code) => {
        if (cfMappingActive.mappedCodes.has(code)) filteredMap.set(code, node);
      });
      cfTree = [...filteredMap.values()]
        .sort((a, b) => {
          const sA = cfMappingActive.sortOrder.get(a.AccountCode) ?? 9999;
          const sB = cfMappingActive.sortOrder.get(b.AccountCode) ?? 9999;
          return sA - sB;
        })
        .map(n => ({ ...n, children: [] }));
} else if (isCustomCf && breakerSortOrder.size > 0) {
      // CUSTOM standard has CF entries in breakerSortOrder (loaded from
      // standard_statement_rows statement=CF). Apply narrative sort so
      // section breakers show correctly.
      // Include ALL CF codes from the standard even if they have no data
      // (user-created sums like "1", "2", or orphans like 7999, 8200 that
      // may not receive postings). This way the full custom structure renders.
      const cfStdCodesInStatement = new Set();
      codeToStatementFromStd.forEach((stmt, code) => {
        if (stmt === "CF") cfStdCodesInStatement.add(String(code));
      });
cfStdCodesInStatement.forEach(code => {
        if (cfAccountMap.has(code)) return;
        const name = codeToNameFromStd.get(code) ?? code;
        const parent = codeToParentFromStd.get(code) ?? "";
        cfAccountMap.set(code, {
          AccountCode: code,
          AccountName: name,
          AccountType: "C/F",
          SumAccountCode: parent,
        });
      });
      // Override SumAccountCode with the standard's parent_code for EVERY node.
      // Data-carrying nodes (already in cfAccountMap) often have an empty or
      // wrong SumAccountCode, which breaks buildTree nesting (e.g. 3020 ends up
      // a loose root instead of nested under 3099 → 3999). The standard's
      // parent_code is the source of truth for the custom hierarchy.
      cfAccountMap.forEach((node, code) => {
        const stdParent = codeToParentFromStd.get(code);
        if (stdParent) {
          cfAccountMap.set(code, { ...node, SumAccountCode: stdParent });
        }
      });
      const fullTree = buildTree([...cfAccountMap.values()]);
      const treeIndex = new Map();
      const walk = (nodes) => nodes.forEach(n => {
        treeIndex.set(String(n.AccountCode), n);
        walk(n.children || []);
      });
      walk(fullTree);
      const flatOrdered = [...cfAccountMap.values()]
        .map(n => treeIndex.get(String(n.AccountCode)) ?? { ...n, children: [] })
        .filter(n => breakerSortOrder.has(n.AccountCode))
        .sort((a, b) => {
          const sA = breakerSortOrder.get(a.AccountCode) ?? 9999;
          const sB = breakerSortOrder.get(b.AccountCode) ?? 9999;
          return sA - sB;
        });
// Collect every code that appears as a descendant of a sum node already
      // in flatOrdered. SumAccountCode is unreliable here (often empty), so we
      // walk the actual children arrays instead. Any code that is nested under
      // a sum must NOT also appear as a loose root — that's the duplication.
      const nestedCodes = new Set();
      const collectNested = (node) => {
        (node.children || []).forEach(c => {
          nestedCodes.add(String(c.AccountCode));
          collectNested(c);
        });
      };
      flatOrdered.forEach(collectNested);
// The standard nests section anchors (A5s/CF_OP, B8s/CF_INV, C11s/CF_FIN) under a
      // grand-total row (D1s "Aumento/disminución neta", which sums them). For rendering we
      // need them FLAT: the three sectioned rows first (each shows its breaker), then the
      // grand totals (D1s/E1s/F1s) as loose rows after. D1s keeps its children ONLY so its
      // value still computes (sum of the three); we mark it _noExpand so the renderer won't
      // re-draw those children nested (they already render as top-level rows above).
      const cfSecOf = (code) => codeToSectionInfo.get(String(code))?.section ?? null;
      const flatRoots = flatOrdered.filter(n => !nestedCodes.has(String(n.AccountCode)));
      const sectionRows = [];
      const totalRows = [];
      for (const n of flatRoots) {
        const kids = n.children || [];
        const sectionKids = kids.filter(k => cfSecOf(k.AccountCode));
        if (!cfSecOf(n.AccountCode) && sectionKids.length) {
          // Grand total over section anchors: lift the section anchors up (they render with
          // their breakers), and keep this total as a loose row that still sums via children.
          sectionRows.push(...sectionKids);
          totalRows.push({ ...n, _noExpand: true });
        } else {
          totalRows.push(n);
        }
      }
      cfTree = [...sectionRows, ...totalRows];
      // A section-null container (e.g. CF.D1s) that nests the real section anchors
      // (CF.A5s/CF_OP, CF.B8s/CF_INV, CF.C11s/CF_FIN) hides their breakers until expanded.
      // Splice up any child that carries its own section, so section rows sit at top level
      // with their breakers. Containers whose children have no section stay as-is.
// Sanity: nothing here — cfTree keeps its natural shape. Section anchors nested
      // under a grand-total row (e.g. CF.D1s) get their breakers surfaced by the
      // renderer, which auto-expands these containers (see collectExpandableCodes /
      // default expanded set) so CF_OP / CF_INV / CF_FIN show without a manual click.
} else {
      cfTree = buildTree([...cfAccountMap.values()]);
    }
    // Append synthetic anchor nodes for CUSTOM CF sections that have no rows
    // — otherwise their breakers would never surface in the render.
    if (isCustomCf && Array.isArray(allCfSections) && allCfSections.length > 0) {
      const sectionsUsed = new Set();
      const walkForSections = (nodes) => (nodes || []).forEach(n => {
        const info = codeToSectionInfo.get(String(n.AccountCode));
        if (info?.section) sectionsUsed.add(info.section);
        walkForSections(n.children);
      });
      walkForSections(cfTree);
      allCfSections.forEach(s => {
        if (sectionsUsed.has(s.section_code)) return;
        const anchorCode = `__empty_section__${s.section_code}`;
        cfTree.push({
          AccountCode: anchorCode,
          AccountName: "",
          AccountType: "C/F",
          SumAccountCode: "",
          _sectionAnchor: true,
          _sectionInfo: { section: s.section_code, label: s.label, color: s.color },
          children: [],
        });
      });
    }
    const cfCols = [...new Set(filteredUploaded.map(r => r.CompanyShortName ?? r.companyShortName ?? "").filter(Boolean))].sort();

// Build compare CF pivot
    const cmpPivCf = new Map();
    const cmpFiltered = perspectiveMode
      ? cmpCfUploadedData.filter(r => childrenOfPerspective.includes(r.CompanyShortName ?? r.companyShortName ?? ""))
      : cmpCfUploadedData;

    cmpFiltered.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!groupCode || !co) return;
      const cfs = cfGroupToCf.get(groupCode);
      if (!cfs) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      cfs.forEach(cfCode => {
        if (!cmpPivCf.has(cfCode)) cmpPivCf.set(cfCode, {});
        const c = cmpPivCf.get(cfCode);
        if (!c[co]) c[co] = 0;
        c[co] += amt;
      });
    });

    // Bubble up compare pivot
    [...cmpPivCf.keys()].forEach(leafCode => {
      const meta = cfMetadata.get(leafCode);
      if (!meta) return;
      let parent = meta.sumParent;
      const seen = new Set([leafCode]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const lp = cmpPivCf.get(leafCode) || {};
        if (!cmpPivCf.has(parent)) cmpPivCf.set(parent, {});
        const pp = cmpPivCf.get(parent);
        Object.entries(lp).forEach(([co, total]) => {
          pp[co] = (pp[co] ?? 0) + total;
        });
        parent = cfMetadata.get(parent)?.sumParent || "";
      }
    });

// Build previous-period cf pivot with same logic (for monthly toggle)
    const cfPivPrev = new Map();
    const filteredUploadedPrev = perspectiveMode
      ? cfUploadedDataPrev.filter(r => childrenOfPerspective.includes(r.CompanyShortName ?? r.companyShortName ?? ""))
      : cfUploadedDataPrev;
    filteredUploadedPrev.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!groupCode || !co) return;
      const cfs = cfGroupToCf.get(groupCode);
      if (!cfs) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      cfs.forEach(cfCode => {
        if (!cfPivPrev.has(cfCode)) cfPivPrev.set(cfCode, {});
        const c = cfPivPrev.get(cfCode);
        if (!c[co]) c[co] = { total: 0, rows: [] };
        c[co].total += amt;
        c[co].rows.push(r);
      });
    });
return { cfTree, cfPivot: piv, cfPivotPrev: cfPivPrev, cfCols, cmpCfPivot: cmpPivCf };
}, [cfUploadedData, cfUploadedDataPrev, cfMetadata, cfGroupToCf, perspectiveMode, childrenOfPerspective, cmpCfUploadedData, mappingDerived, mappingTab, cfNameDict, cfMapping, activeStandardKey, breakerSortOrder, allCfSections, codeToNameFromStd, codeToParentFromStd, codeToSectionInfo, codeToStatementFromStd]);
// Flujo de caja en la divisa del grupo, para los gráficos (la tabla lo pinta en
// moneda local): importe de cada partida de flujo por sociedad, convertido al
// tipo medio del periodo. Solo hojas; los gráficos suman por el árbol.
const cfPivotG = useMemo(() => {
  const out = new Map();
  if (!cfUploadedData.length || !cfGroupToCf.size) return out;
  const fx = makeFxToGroup(ratesByKey[`${Number(year)}|${Number(month)}|${source}`] ?? [], companies, perspective);
  const rows = perspectiveMode
    ? cfUploadedData.filter(r => childrenOfPerspective.includes(r.CompanyShortName ?? r.companyShortName ?? ""))
    : cfUploadedData;
  rows.forEach(r => {
    const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
    const co = r.CompanyShortName ?? r.companyShortName ?? "";
    const cfs = cfGroupToCf.get(groupCode);
    if (!groupCode || !co || !cfs) return;
    const f = fx(co, "P/L") || 1;
    const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0) * f;
    cfs.forEach(cfCode => {
      if (!out.has(cfCode)) out.set(cfCode, {});
      const c = out.get(cfCode);
      if (!c[co]) c[co] = { total: 0 };
      c[co].total += amt;
    });
  });
  return out;
}, [cfUploadedData, cfGroupToCf, ratesByKey, year, month, source, companies, perspective, perspectiveMode, childrenOfPerspective]);
// Columna consolidada y % de la tabla: también para el flujo de caja (antes
// salían vacíos porque pivotG no tiene las partidas de flujo)
const groupPivots = useMemo(() => ({
  pivot: typeFilter === "C/F" ? cfPivotG : (!typeFilter ? new Map([...(pivotG ?? []), ...cfPivotG]) : pivotG),
  pivotPrev: pivotPrevG,
}), [typeFilter, pivotG, pivotPrevG, cfPivotG]);
const toggleExpand = useCallback(code => {
    setExpandedSet(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }, []);
// Walk the visible tree, collect ids/codes of nodes that have children.
  // In literal mode nodes use `id`; in standard mode they use `AccountCode`.
  const collectExpandableCodes = useCallback((nodes, useId = false) => {
    const out = [];
    const walk = (n) => {
      if (n.children?.length > 0) {
        out.push(useId ? n.id : n.AccountCode);
        n.children.forEach(walk);
      }
    };
nodes.forEach(walk);
    return out;
  }, []);

  // In Cash Flow, grand-total rows (e.g. CF.D1s "Aumento/disminución neta") nest the
  // real section anchors (CF_OP/INV/FIN). Auto-expand those so their breakers show
  // without a manual click, while keeping the total row and its value visible.
  useEffect(() => {
    if (typeFilter !== "C/F" || !Array.isArray(cfTree) || cfTree.length === 0) return;
    const secOf = (code) => codeToSectionInfo.get(String(code))?.section ?? null;
    const toExpand = [];
    const walk = (nodes) => (nodes || []).forEach(n => {
      const kids = n.children || [];
      if (!secOf(n.AccountCode) && kids.some(k => secOf(k.AccountCode))) {
        toExpand.push(n.AccountCode);
      }
      walk(kids);
    });
    walk(cfTree);
    if (toExpand.length) setExpandedSet(prev => { const s = new Set(prev); toExpand.forEach(c => s.add(c)); return s; });
  }, [typeFilter, cfTree, codeToSectionInfo]);

const expandAll = useCallback(() => {
    if (activeMapping?.treeLiteral) {
      // Literal mode — flatten all sections' nodes and collect by id
      const all = [];
      activeMapping.treeLiteral.forEach(sec => (sec.nodes || []).forEach(n => all.push(n)));
      setExpandedSet(new Set(collectExpandableCodes(all, true)));
      return;
    }
    const activeTree = typeFilter === "C/F" ? cfTree : tree;
    setExpandedSet(new Set(collectExpandableCodes(activeTree)));
  }, [tree, cfTree, typeFilter, collectExpandableCodes, activeMapping]);

  const collapseAll = useCallback(() => setExpandedSet(new Set()), []);

  // Grand totals
  const colTotal = co => [...accountMap.keys()].reduce((s, code) => s + (pivot.get(code)?.[co]?.total ?? 0), 0);
  const _grandTotal = cols.reduce((s, co) => s + colTotal(co), 0);

  // Filter options
  const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];

  const yearOpts = [...new Set(periods.map(p => Number(getP(p,"year")||0)).filter(n => n > 0))]
    .sort((a,b) => b - a).map(y => ({ value: String(y), label: String(y) }));

const monthOpts = [...new Set(periods.map(p => Number(getP(p,"month")||0)).filter(n => n > 0))]
    .sort((a,b) => a - b)
    .map(m => ({ value: String(m), label: T(`month_${m}`, String(m)) }));

  const sourceOpts = [...new Set(sources.map(s => {
    const v = typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const structureOpts = [...new Set(structures.map(s => {
    const v = typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const hasData = rawData.length > 0;
  // Cargando: metadatos, periodo inicial o datos de la combinación actual
  const busy = !metaReady || probingPeriod || (dataKey !== null && loadedKey !== dataKey);

  // Effective cols after company filter — always derived from current `cols`,
  // which is already perspective-filtered.
const baseEffectiveCols = selectedCompanies.length === 0
    ? cols
    : cols.filter(c => selectedCompanies.includes(c));

  // Apply user's drag-and-drop ordering. Any cols not yet in colOrder
  // (e.g. newly-arrived after a perspective change) get appended at the end.
  const effectiveCols = useMemo(() => {
    if (colOrder.length === 0) return baseEffectiveCols;
    const ordered = colOrder.filter(c => baseEffectiveCols.includes(c));
    const rest = baseEffectiveCols.filter(c => !ordered.includes(c));
    return [...ordered, ...rest];
  }, [baseEffectiveCols, colOrder]);

  const reorderCols = useCallback((from, to) => {
    setColOrder(prev => {
      const current = prev.length > 0 ? [...prev] : [...effectiveCols];
      const fromIdx = current.indexOf(from);
      const toIdx = current.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = current.splice(fromIdx, 1);
      current.splice(toIdx, 0, moved);
      return current;
    });
  }, [effectiveCols]);

// Shared export prep: build the CF name lookup + standard override literals.
  const buildExportPayload = () => {
    const cfNameLookup = new Map();
    Object.entries(cfNameDict).forEach(([code, name]) => { if (code && name) cfNameLookup.set(String(code), String(name)); });
    cfMapping.forEach(m => {
      const code = m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? "";
      const name = m.cashFlowAccountName ?? m.CashFlowAccountName ?? "";
      const sumCode = m.cashFlowAccountSumAccountCode ?? m.CashFlowAccountSumAccountCode ?? "";
      const sumName = m.cashFlowAccountSumAccountName ?? m.CashFlowAccountSumAccountName ?? "";
      if (code && name) cfNameLookup.set(String(code), String(name));
      if (sumCode && sumName && !cfNameLookup.has(String(sumCode))) cfNameLookup.set(String(sumCode), String(sumName));
    });
    cfMetadata.forEach(({ name }, code) => { if (name && code) cfNameLookup.set(String(code), String(name)); });
const overrideLiteralPl = (hiddenOverride && Array.isArray(hiddenOverride.pl_tree) && hiddenOverride.pl_tree.length > 0) ? buildMappingLiteral(hiddenOverride.pl_tree) : null;
    const overrideLiteralBs = (hiddenOverride && Array.isArray(hiddenOverride.bs_tree) && hiddenOverride.bs_tree.length > 0) ? buildMappingLiteral(hiddenOverride.bs_tree) : null;
    const overrideLiteralCf = (hiddenOverride && Array.isArray(hiddenOverride.cf_tree) && hiddenOverride.cf_tree.length > 0) ? buildMappingLiteral(hiddenOverride.cf_tree) : null;
    return {
     T, tree, plTreeStd, bsTreeStd, overrideLiteralPl, overrideLiteralBs, overrideLiteralCf,
      treeLiteral: activeMapping?.treeLiteral ?? null,
      pivot, pivotPrev, cfTree, cfPivot, cfPivotPrev, ytdOnly,
      cols: effectiveCols, cfCols,
      cmpPivot, cmpPivotPrev, cmpCfPivot,
      typeFilter, activeMapping, mappingTab,
      activeMappings, journalData, codeToSectionInfo, codeToStatementFromStd,
      dimIdx, dimIdxPrev, cmpDimIdx, cmpDimIdxPrev,
      journalPivot, counterpartyPivot, cfNameLookup,
      companies, groupStructure, compareMode,
      perspectiveMode, perspectiveParent: perspective,
      month, year, source, structure,
cmpMonth, cmpYear, cmpSource, cmpStructure,
exportSheets: exportOpts.sheets ?? { todos: true, pl: true, bs: true, cf: true },
      drilldownOpt: exportOpts.drilldown !== false,
      includeAdjustments: exportOpts.includeAdjustments !== false,
    };
  };
  const handleExportXlsx = async () => { generateContributiveXlsx(buildExportPayload()); };
  const handleExportPdf  = async () => { generateContributivePdf(buildExportPayload()); };

  return (
     <div className="flex flex-col gap-4 h-full min-h-0">
<style>{`
        .contributive-body::-webkit-scrollbar { width: 0px; height: 6px; }
        .contributive-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .contributive-body::-webkit-scrollbar-track { background: transparent; }
.contributive-body thead { background: #ffffff; }
        .contributive-body thead th { border-color: transparent !important; box-shadow: none !important; }
@keyframes subColIn    { 0% { opacity:0; transform:translateX(-10px) scaleX(0.85); } 100% { opacity:1; transform:translateX(0) scaleX(1); } }
        @keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes rowExpandIn  { 0% { opacity:0; transform:translateY(-4px) scaleY(0.92); } 100% { opacity:1; transform:translateY(0) scaleY(1); } }
        @keyframes iconMorph    { 0% { opacity:0; transform: scale(0.4) rotate(-90deg); } 60% { opacity:1; } 100% { opacity:1; transform: scale(1) rotate(0deg); } }
        @keyframes floatOrb1    { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
        @keyframes floatOrb2    { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
        @keyframes spinSlow     { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinSlowR    { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes cmpBarIn     { from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; transform: translateY(-6px); } to { opacity: 1; max-height: 80px; transform: none; } }
      `}</style>
{showJournals && (
<JournalsModal
          T={T}
          journalData={journalData}
          onClose={() => setShowJournals(false)}
          year={year}
          month={month}
          source={source}
          colors={colors}
          header2Style={header2Style}
          underscore1Style={underscore1Style}
          underscore2Style={underscore2Style}
          body2Style={body2Style}
        />
      )}

{/* Drilldown */}
      {drilldown && (
<DrilldownModal
          T={T}
          locale={locale}
          accountCode={drilldown.node.AccountCode}
          accountName={drilldown.node.AccountName ?? drilldown.node.accountName ?? ""}
          company={drilldown.company}
          companyName={companies.find(c => (c.CompanyShortName ?? c.companyShortName) === drilldown.company)?.CompanyLegalName ?? ""}
          colors={colors}
          rows={drilldown.rows}
          currency={currencyMode === "local" ? getCompanyCurrency(drilldown.company, companies) : getContributionCurrency(perspective, drilldown.company, groupStructure, companies)}
          onClose={() => setDrilldown(null)}
        />
      )}

<PageHeader
          collapseAllOnFilterHover
      collapseTabsOnFilterHover
kicker={viewsMode ? T("mappings") : T("kicker_accounts")}
        title={viewsMode === "landing" ? T("mappings")
             : viewsMode === "structure" ? T("am_card_structure_title")
             : viewsMode === "report" ? T("am_card_report_title")
             : T("contrib_label", "Contribution")}
        onBack={viewsMode ? () => {
          if (viewsMode === "landing") setViewsMode(null);
          else setViewsMode("landing");
        } : undefined}
        mappingsQuickAccess={!viewsMode ? recentMappings : []}
        onQuickApplyMapping={async (m) => {
          const api = await pickMappingApi(mappingTab, m.kind);
          const full = await api.getMapping(m.id);
          handleApplyMapping(full ?? m.raw, m.kind);
        }}
tabs={viewsMode ? [] : [
          ...(view === "charts" ? [] : [{ id: "", label: T("all"), icon: Filter }]),
          { id: "P/L", label: T("tab_pl"),              icon: TrendingUp },
          { id: "B/S", label: T("tab_bs_short"),        icon: BarChart2 },
          { id: "C/F", label: T("nav_cashflow"),        icon: Layers },
        ]}
        activeTab={viewsMode ? null : typeFilter}
        onTabChange={viewsMode ? undefined : setTypeFilter}
        filters={viewsMode ? [] : [
          ...(sourceOpts.length > 0
? [{ label: T("filter_source"), value: source, onChange: setSource, options: sourceOpts }]
            : []),
          ...(yearOpts.length > 0
            ? [{ label: T("filter_year"), value: year, onChange: setYear, options: yearOpts }]
            : []),
          ...(monthOpts.length > 0
            ? [{ label: T("filter_month"), value: month, onChange: setMonth, options: monthOpts }]
            : []),
          ...(parentOptions.length > 0
            ? [{ label: T("filter_perspective"), value: perspective, onChange: (v) => { setPerspective(v); setSelectedCompanies([]); }, options: parentOptions }]
            : []),
          { label: T("filter_currency", "Currency"), value: currencyMode, onChange: setCurrencyMode,
            options: [
              { value: "local", label: T("currency_local", "Local") },
              { value: "group", label: T("currency_group", "Grupo") },
            ] },
...(cols.length > 0
            ? [{
                label: T("filter_company"),
                multiselect: true,
                values: selectedCompanies.length === 0 ? null : selectedCompanies,
                onChange: (v) => setSelectedCompanies(v ?? []),
                options: cols.map(co => ({
                  value: co,
                  label: companies.find(c =>
                    (c.CompanyShortName ?? c.companyShortName) === co
                  )?.CompanyLegalName ?? co,
                })),
              }]
            : []),
          ...(dimGroups.length > 0
            ? [{
                label: T("filter_dim_group", "Dim group"),
                multiselect: true,
                values: upDimGroups,
                onChange: vs => { setUpDimGroups(vs); setUpDimensions(null); },
                options: dimGroups.map(g => ({ value: g, label: g })),
              }]
            : []),
          ...(filteredDims.length > 0
            ? [{
                label: T("filter_dims", "Dimension"),
                multiselect: true,
                values: upDimensions,
                onChange: setUpDimensions,
                options: filteredDims.map(d => {
                  const v = String(d.DimensionCode ?? d.dimensionCode ?? "");
                  const l = String(d.DimensionName ?? d.dimensionName ?? v);
                  return { value: v, label: l };
                }),
              }]
            : []),
        ]}
periodToggle={!viewsMode && typeFilter !== "B/S" && typeFilter !== "C/F" ? {
          value: ytdOnly ? "ytd" : "monthly",
          onChange: (next) => setYtdOnly(next === "ytd"),
        } : null}
compareToggle={viewsMode ? null : {
          active: compareMode,
          onChange: (newVal) => {
            if (newVal && !compareMode) {
              setCmpYear(year); setCmpMonth(month);
              setCmpSource(source); setCmpStructure(structure);
            }
            setCompareMode(newVal);
          },
        }}
headerExtra={viewsMode ? null : <ChartsToggle locale={locale} view={view} onToggle={() => setView(view === "charts" ? "table" : "charts")} />}
headerActions={viewsMode ? [] : (journalData.length > 0 ? [
          {
            label: `${T("export_journal_entries")} (${journalData.length})`,
            icon: FileText,
            onClick: () => setShowJournals(true),
          },
        ] : [])}
       onMappingsClick={viewsMode ? undefined : (mappingsEnabled && typeFilter ? () => setViewsMode("landing") : undefined)}
onExportXlsx={viewsMode ? undefined : () => { setExportOpts(o => ({ ...o, format: "xlsx" })); setExportModal(true); }}
          onExportPdf={viewsMode ? undefined : () => { setExportOpts(o => ({ ...o, format: "pdf" })); setExportModal(true); }}
      />

{activeMapping && activeMapping.name !== "__custom_override__" && activeMapping.name !== "__todos_synthetic__" && !viewsMode && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            borderColor: "rgba(16,185,129,0.25)",
            boxShadow: "0 2px 8px -2px rgba(16,185,129,0.15)",
          }}>
          <div className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
            style={{ background: "rgba(16,185,129,0.18)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            </div>
            <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#047857", opacity: 0.7 }}>
            {T("mapping_active")} · {(mappingTab ?? "all").toUpperCase()}
            </p>
            <p className="text-sm font-black truncate" style={{ color: "#064e3b" }}>
              {activeMapping.name} <span className="font-bold opacity-50">· {activeMapping.standard ?? T("am_filter_custom")} · {activeMapping.kind === "report" ? T("am_tag_report") : T("am_tag_structure")}</span>
            </p>
            </div>
            <button
            onClick={() => {
              // CF uses its own mapper page + storage key; PL/BS share the
              // "mappings" page with Individuales since they hit the same APIs.
              const isCf = activeMapping.tab === "cf";
              const storageKey = isCf ? "cashflow-mappings:openForEdit" : "mappings:openForEdit";
              const route = isCf ? "cashflow-mappings" : "mappings";
              try {
                sessionStorage.setItem(storageKey, JSON.stringify({
                  mapping_id: activeMapping.mapping_id,
                  kind: activeMapping.kind ?? "structure",
                }));
              } catch { /* ignore quota errors */ }
              if (typeof onNavigate === "function") {
                onNavigate(route);
              } else {
                // Fallback: hash routing in case the parent didn't wire onNavigate
                window.location.hash = `#/${route}`;
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "white", color: "#047857", border: "1px solid rgba(16,185,129,0.2)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f0fdf4"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            {T("btn_edit")}
            </button>
            <button
            onClick={clearActiveMapping}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "rgba(207,48,93,0.08)", color: "#CF305D", border: "1px solid rgba(207,48,93,0.15)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(207,48,93,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(207,48,93,0.08)"; }}>
            <X size={10} strokeWidth={3} />
            {T("btn_clear")}
          </button>
        </div>
      )}

      {compareMode && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0"
          style={{ animation: "cmpBarIn 420ms cubic-bezier(0.22,1,0.36,1) both", overflow: "hidden" }}>
        <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
        <span className="text-white text-[11px] font-black">B</span>
        </div>
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("btn_compare_with")}</span>
        </div>
        <HeaderFilterPill label={T("filter_source")}    value={cmpSource}    onChange={setCmpSource}    options={sourceOpts} />
        <HeaderFilterPill label={T("filter_year")}      value={cmpYear}      onChange={setCmpYear}      options={yearOpts} />
        <HeaderFilterPill label={T("filter_month")}     value={cmpMonth}     onChange={setCmpMonth}     options={monthOpts} />
        <HeaderFilterPill label={T("filter_structure")} value={cmpStructure} onChange={setCmpStructure} options={structureOpts} />
        {cmpLoading && <CompareBusy locale={locale} primary={colors.primary} />}
        </div>
      )}

      {/* Mappings landing / library — replaces the table when viewsMode is set */}
      {viewsMode === "landing" && (
          <MappingsLanding
          T={T}
          colors={colors}
          mappingTab={mappingTab}
          onPickStructure={() => setViewsMode("structure")}
          onPickReport={() => setViewsMode("report")}
          />
          )}
          {(viewsMode === "structure" || viewsMode === "report") && (
          <MappingsLibrary
          T={T}
          colors={colors}
          kind={viewsMode}
          mappingTab={mappingTab}
          activeMapping={activeMapping}
          mappings={savedMappings}
          loading={mappingsLoading}
          error={mappingsError}
          onApply={(m) => handleApplyFromCard(m, viewsMode)}
          onClearActive={clearActiveMapping}
          onRetry={() => {
            // Re-trigger fetch by bouncing viewsMode
            const m = viewsMode;
            setViewsMode("landing");
            setTimeout(() => setViewsMode(m), 50);
          }}
        />
      )}

      {/* Table — only when not in views mode */}
      {!viewsMode && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0 relative" style={{ overflow: "hidden" }}>
          <ContributiveLoader
            T={T}
            locale={locale}
            colors={colors}
            visible={busy}
            metaReady={metaReady}
            metaProgress={metaCount / META_REQUESTS}
            probing={probingPeriod}
            dataProgress={dataProg.key === dataKey ? dataProg.n / DATA_REQUESTS : 0}
          />
          {busy ? (
          <div className="flex-1 min-h-0" />
          ) : !hasData ? (
          <div className="flex items-center justify-center flex-1 p-8">
            <div className="relative max-w-md w-full text-center"
              style={{ animation: "plRowSlideIn 500ms cubic-bezier(0.34,1.56,0.64,1)" }}>

              {/* Decorative background orbs */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                <div className="absolute" style={{
                  width: 180, height: 180, top: -40, right: -40,
                  background: `radial-gradient(circle, ${colors.primary}12 0%, transparent 70%)`,
                  animation: "floatOrb1 8s ease-in-out infinite",
                }} />
                <div className="absolute" style={{
                  width: 120, height: 120, bottom: -20, left: -20,
                  background: "radial-gradient(circle, rgba(207,48,93,0.10) 0%, transparent 70%)",
                  animation: "floatOrb2 11s ease-in-out 2s infinite",
                }} />
              </div>

              <div className="relative z-10 p-10 rounded-3xl"
                style={{
                  background: "linear-gradient(135deg, #ffffff 0%, #fafbff 100%)",
                  border: "1px solid rgba(26,47,138,0.06)",
                  boxShadow: "0 20px 60px -12px rgba(26,47,138,0.08)",
                }}>

                {/* Icon with concentric rings */}
                <div className="relative mx-auto mb-6" style={{ width: 88, height: 88 }}>
                  <svg width="88" height="88" viewBox="0 0 88 88" className="absolute inset-0">
                    <circle cx="44" cy="44" r="40" fill="none"
                      stroke={`${colors.primary}15`} strokeWidth="1.5"
                      strokeDasharray="4 6"
                      style={{ transformOrigin: "44px 44px", animation: "spinSlow 20s linear infinite" }} />
                    <circle cx="44" cy="44" r="28" fill="none"
                      stroke={`${colors.primary}25`} strokeWidth="1.5"
                      strokeDasharray="3 5"
                      style={{ transformOrigin: "44px 44px", animation: "spinSlowR 14s linear infinite" }} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{
                        background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                        boxShadow: `0 8px 24px -6px ${colors.primary}50, inset 0 1px 0 rgba(255,255,255,0.2)`,
                      }}>
                      <Search size={20} className="text-white" strokeWidth={2.2} />
                    </div>
                  </div>
                </div>

                <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
                  style={{ color: colors.primary, opacity: 0.6 }}>
                  {T("contrib_empty_kicker", "Búsqueda completada")}
                </p>

                <h3 className="font-black text-xl text-gray-800 mb-3 tracking-tight"
                  style={{ letterSpacing: "-0.02em" }}>
                  {perspectiveMode
                    ? T("contrib_empty_perspective_title", "Sin datos para esta perspectiva")
                    : T("contrib_empty_title", "No encontramos datos")}
                </h3>

                <p className="text-sm text-gray-500 leading-relaxed mb-6">
                  {perspectiveMode
                    ? T("contrib_no_perspective_data") + ` ${perspective}.`
                    : T("contrib_empty_desc", "Hemos probado varias combinaciones de fuente, estructura y periodo sin éxito. Es posible que otra combinación de filtros sí tenga datos.")}
                </p>

                {/* Suggestion chips */}
                <div className="flex flex-col gap-2 mb-6">
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                    style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: `${colors.primary}15`, color: colors.primary }}>
                      <Filter size={13} strokeWidth={2.4} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-700">
                        {T("contrib_empty_tip1_title", "Prueba otra fuente o estructura")}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {T("contrib_empty_tip1_desc", "Usa los filtros de arriba para cambiar el origen de los datos")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                    style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: `${colors.primary}15`, color: colors.primary }}>
                      <RefreshCw size={13} strokeWidth={2.4} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-700">
                        {T("contrib_empty_tip2_title", "Ajusta el periodo")}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {T("contrib_empty_tip2_desc", "Selecciona otro año o mes desde la cabecera")}
                      </p>
                    </div>
                  </div>

                  {perspectiveMode && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                      style={{ background: "rgba(207,48,93,0.05)", border: "1px solid rgba(207,48,93,0.10)" }}>
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(207,48,93,0.12)", color: "#CF305D" }}>
                        <X size={13} strokeWidth={2.4} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-700">
                          {T("contrib_empty_tip3_title", "Quita la perspectiva")}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {T("contrib_empty_tip3_desc", "Selecciona \"Ninguna\" en el filtro Perspectiva")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    autoPeriodDone.current = false;
                    forceProbeRef.current = true;
                    setProbingPeriod(true);
                    setProbeTick(n => n + 1);
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                  style={{
                    background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                    color: "white",
                    boxShadow: `0 6px 16px -4px ${colors.primary}40`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
                  <RefreshCw size={12} strokeWidth={2.6} />
                  {T("contrib_empty_retry", "Probar de nuevo")}
                </button>
              </div>
            </div>
          </div>
        ) : view === "charts" ? (
          <ContributiveCharts
            locale={locale}
            tree={tree}
            cfTree={cfTree}
            typeFilter={typeFilter}
            pivotG={pivotG}
            pivotPrevG={pivotPrevG}
            jpG={journalPivotG}
            jpPrevG={journalPivotPrevG}
            cfPivotG={cfPivotG}
            cols={effectiveCols}
            companies={companies}
            perspective={perspective}
            ytdOnly={ytdOnly}
            year={year}
            month={month}
            mappingActive={!!activeMapping && !["__custom_override__", "__todos_synthetic__"].includes(activeMapping.name)}
            nav={chartNav}
            setNav={setChartNav}
          />
        ) : (
<SyncedTable
            T={T}
            onAnalyze={analyzeAccount}
            groupPivots={groupPivots}
activeStandardKey={activeStandardKey}
            codeToSectionInfo={codeToSectionInfo}
rowMatchesDims={rowMatchesDims}
        pivotPrev={typeFilter === "C/F" ? cfPivotPrev : (!typeFilter ? (() => {
              // Same raw-C/F strip as `pivot` below — keep prev-period aligned.
              const base = pivotPrev || new Map();
              const cfP  = cfPivotPrev || new Map();
              const clean = new Map(
                [...base].filter(([code]) => {
                  const a = accountMap.get(code);
                  const t = a?.AccountType ?? "";
                  return t !== "C/F" && t !== "CFS";
                })
              );
              return new Map([...clean, ...cfP]);
            })() : pivotPrev)}
            ytdOnly={ytdOnly}
       cols={(() => {
const c = typeFilter === "C/F" ? cfCols : (!typeFilter ? [...new Set([...effectiveCols, ...cfCols])] : effectiveCols);
              return c;
            })()}
tree={typeFilter === "C/F" ? cfTree : (!typeFilter ? (
              // Todos: if a PL literal is being rendered (via synthetic
              // activeMapping), strip PL/DIS from tree to avoid duplicating
              // what the literal already shows. BS + CF still come via tree.
activeMapping?.treeLiteral
                ? (() => {
const plInLit = !!activeMappings.pl?.treeLiteral;
                    const bsInLit = !!activeMappings.bs?.treeLiteral;
                    const cfInLit = !!activeMappings.cf?.treeLiteral && activeMappings.cf.treeLiteral.length > 0;
                    const dropTypes = [];
                    if (plInLit) dropTypes.push("P/L", "DIS");
                    if (bsInLit) dropTypes.push("B/S");
                    const stripTypes = nodes => (nodes || [])
                      .filter(n => !dropTypes.includes(n?.AccountType ?? n?.accountType ?? ""))
                      .map(n => ({ ...n, children: stripTypes(n.children) }));
                    const base = dropTypes.length ? stripTypes(tree) : tree.map(n => ({ ...n }));
                    return cfInLit ? base : [...base, ...cfTree];
                  })()
                // Strip raw C/F rows from base tree — cfTree is the authoritative
                // CF source (mapped codes + bubbled sums). Leaving raw C/F nodes
                // in would duplicate CF and mismatch values against the C/F tab.
: (() => {
                    const isCf = n => {
                      const t = n?.AccountType ?? n?.accountType ?? "";
                      return t === "C/F" || t === "CFS";
                    };
                    const stripCf = nodes => (nodes || [])
                      .filter(n => !isCf(n))
                      .map(n => ({ ...n, children: stripCf(n.children) }));
                    return [...stripCf(tree), ...cfTree];
                  })()
            ) : tree)}
treeLiteral={activeMapping?.treeLiteral ?? null}
            typeFilter={typeFilter}
            highlightedIds={activeMapping?.highlightedIds ?? null}
dimIdx={dimIdx}
     dimIdxPrev={dimIdxPrev}
cmpDimIdxPrev={cmpDimIdxPrev}
            journalDimIdx={journalDimIdx}
            cptyDimIdx={cptyDimIdx}
            cmpDimIdx={cmpDimIdx}
            body1Style={body1Style}
            body2Style={body2Style}
            header2Style={header2Style}
            header3Style={header3Style}
            underscore1Style={underscore1Style}
            underscore2Style={underscore2Style}
            filterStyle={filterStyle}
            colors={colors}
            expandedSet={expandedSet}
            expandedColsMap={expandedColsMap}
            toggleCol={toggleCol}
            toggleExpand={toggleExpand}
pivot={(() => {
              // In All mode, `pivot` includes raw C/F rows (typeFilter is null so
              // filter at line ~4694 didn't run). Those must be stripped before
              // merging cfPivot, otherwise raw-vs-mapped CF codes collide and CF
              // values diverge from the C/F tab.
              const stripRawCf = (m) => new Map(
                [...m].filter(([code]) => {
                  const a = accountMap.get(code);
                  const t = a?.AccountType ?? "";
                  return t !== "C/F" && t !== "CFS";
                })
              );
const p = typeFilter === "C/F"
                ? cfPivot
                : (!typeFilter ? new Map([...stripRawCf(pivot), ...cfPivot]) : pivot);
              return p;
            })()}
            journalPivot={journalPivot}
            accountMap={accountMap}
            companies={companies}
            groupStructure={groupStructure}
            hasData={hasData}
            collapseAll={collapseAll}
            expandAll={expandAll}
            setDrilldown={setDrilldown}
            currencyMode={currencyMode}
            breakers={mappingDerived?.breakers ?? (Object.keys(pgcSections).length > 0 ? pgcSections : breakers)}
            compareMode={compareMode}
            onToggleCompare={() => {
              if (!compareMode) {
                setCmpYear(year); setCmpMonth(month);
                setCmpSource(source); setCmpStructure(structure);
              }
              setCompareMode(c => !c);
            }}
cmpPivot={typeFilter === "C/F" ? cmpCfPivot : (!typeFilter ? new Map([...(cmpPivot || new Map()), ...(cmpCfPivot || new Map())]) : cmpPivot)}
            cmpPivotPrev={cmpPivotPrev}
            counterpartyPivot={counterpartyPivot}
            cmpLoading={cmpLoading}
            cmpYear={cmpYear} setCmpYear={setCmpYear}
            cmpMonth={cmpMonth} setCmpMonth={setCmpMonth}
            cmpSource={cmpSource} setCmpSource={setCmpSource}
            cmpStructure={cmpStructure} setCmpStructure={setCmpStructure}
            yearOpts={yearOpts}
            monthOpts={monthOpts}
            sourceOpts={sourceOpts}
structureOpts={structureOpts}
perspectiveMode={perspectiveMode}
            perspectiveParent={perspective}
            reorderCols={reorderCols}
onShowJournals={journalData.length > 0 ? () => setShowJournals(true) : null}
            journalCount={journalData.length}
          />
)}
      </div>
      )}

      {exportModal && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(10px)" }}
          onClick={() => setExportModal(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-white rounded-3xl w-full max-w-lg"
            style={{ boxShadow: "0 32px 80px -12px rgba(26,47,138,0.32)" }}>
            <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)` }}>
                  <Download size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="font-black text-gray-800 tracking-tight" style={{ fontSize: 17 }}>
                    {T("export_title") || "Exportar"}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-md tracking-wider uppercase"
                      style={{ background: `${colors.primary}18`, color: colors.primary }}>
                      {exportOpts.format === "pdf" ? "PDF" : "EXCEL"}
                    </span>
                    {activeMapping && activeMapping.name !== "__custom_override__" && activeMapping.name !== "__todos_synthetic__" && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-md tracking-wider uppercase bg-emerald-50 text-emerald-700">
                        {T("badge_mapped") || "MAPEADO"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => setExportModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <p className="text-[10px] font-black text-gray-400 tracking-widest uppercase mb-3">
                  {T("export_design_opts") || "Opciones de diseño"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                   ["includeAdjustments", T("export_opt_adjustments") || "Columnas de ajustes y eliminaciones"],
                    ["drilldown",       T("export_opt_drilldown") || "Drill-down (colapsado)"],
                    ["includeTotals",   T("export_opt_totals") || "Totales de fila"],
                    ["includeCompare",  T("export_opt_compare") || "Columnas de comparación"],
                  ].map(([key, label]) => {
                    const isCompare = key === "includeCompare";
                    const disabled = isCompare && !compareMode;
                    const isTotals = key === "includeTotals";
                    const totalsDisabledByCompare = isTotals && compareMode && exportOpts.includeCompare;
                    const isDisabled = disabled || totalsDisabledByCompare;
                    const checked = !!exportOpts[key] && !isDisabled;
                    return (
                      <button key={key}
                        onClick={() => !isDisabled && setExportOpts(o => ({ ...o, [key]: !o[key] }))}
                        disabled={isDisabled}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-bold text-left transition-all ${
                          isDisabled
                            ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                            : checked
                              ? "border-transparent text-gray-800"
                              : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                        }`}
                        style={checked ? { background: `${colors.primary}12`, borderColor: `${colors.primary}40` } : undefined}>
                        <div className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 border ${
                          checked ? "text-white" : "border-gray-300 bg-white"
                        }`}
                          style={checked ? { background: colors.primary, borderColor: colors.primary } : undefined}>
                          {checked && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
</div>
              </div>
              <div>
                <p className="text-[10px] font-black text-gray-400 tracking-widest uppercase mb-3">
                  {T("export_sheets") || "Hojas a exportar"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["todos", T("filter_all") || "Todos"],
                    ["pl",    T("tab_pl") || "P&G"],
                    ["bs",    T("tab_bs_short") || "Balance"],
                    ["cf",    T("nav_cashflow") || "Flujo de caja"],
                  ].map(([key, label]) => {
                    const checked = !!exportOpts.sheets?.[key];
                    return (
                      <button key={key}
                        onClick={() => setExportOpts(o => ({ ...o, sheets: { ...o.sheets, [key]: !o.sheets?.[key] } }))}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-bold text-left transition-all ${
                          checked ? "border-transparent text-gray-800" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                        }`}
                        style={checked ? { background: `${colors.primary}12`, borderColor: `${colors.primary}40` } : undefined}>
                        <div className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 border ${checked ? "text-white" : "border-gray-300 bg-white"}`}
                          style={checked ? { background: colors.primary, borderColor: colors.primary } : undefined}>
                          {checked && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-black text-gray-400 tracking-widest uppercase mb-2">
                  {T("primary_period") || "Periodo"}
                </p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: colors.primary, color: "white", fontSize: 10, fontWeight: 900 }}>A</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                      {T("period_a") || "Periodo A"}
                    </div>
                    <div className="text-xs font-bold text-gray-700 truncate">
                {year && month ? `${MONTHS[Number(month) - 1]?.label ?? month} ${year}` : "—"}
                      {source ? ` · ${source}` : ""}
                    </div>
                  </div>
                </div>
                {compareMode && exportOpts.includeCompare && (
                  <div className="flex items-center gap-2 px-3 py-2.5 mt-2 rounded-xl border border-gray-200 bg-gray-50/50">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "#7c3aed", color: "white", fontSize: 10, fontWeight: 900 }}>B</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                        {T("period_b") || "Periodo B"}
                      </div>
                      <div className="text-xs font-bold text-gray-700 truncate">
                    {cmpYear && cmpMonth ? `${MONTHS[Number(cmpMonth) - 1]?.label ?? cmpMonth} ${cmpYear}` : "—"}
                        {cmpSource ? ` · ${cmpSource}` : ""}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/40 rounded-b-3xl">
              <div className="inline-flex rounded-xl p-1 bg-white border border-gray-200">
                {["xlsx", "pdf"].map(f => (
                  <button key={f}
                    onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                    className="px-3 py-1.5 text-[10px] font-black tracking-wider uppercase rounded-lg transition-all"
                    style={{
                      background: exportOpts.format === f ? `${colors.primary}15` : "transparent",
                      color: exportOpts.format === f ? colors.primary : "#9ca3af",
                    }}>
                    {f}
                  </button>
                ))}
              </div>
              <button
                onClick={async () => {
                  const fn = exportOpts.format === "pdf" ? handleExportPdf : handleExportXlsx;
                  setExportModal(false);
                  setExporting(true);
                  try { await fn(); }
                  finally { setExporting(false); }
                }}
                disabled={exporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black text-white tracking-wider uppercase transition-all disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)` }}>
                {exporting
                  ? <><Loader2 size={12} className="animate-spin" /><span>{T("btn_exporting") || "Exportando…"}</span></>
                  : <><Download size={12} /><span>{T("btn_download") || "Descargar"}</span></>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
