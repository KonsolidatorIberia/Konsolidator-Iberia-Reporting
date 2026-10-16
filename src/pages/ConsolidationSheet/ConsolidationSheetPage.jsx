/* ══════════════════════════════════════════════════════════════════════
   Sábana de consolidación — página.

   Para el grupo elegido: consolidado, eliminaciones y la contribución de
   cada sociedad, por cuenta. Con el "Rastro del dato" (botón en cada cuenta)
   se abre a la derecha el árbol completo de su importe hasta la línea local.

   Estructura de la carpeta:
     ConsolidationSheetPage.jsx    → estado, datos y maquetación
     ConsolidationSheetTable.jsx   → filas y celdas de la tabla
     ConsolidationSheetParts.jsx   → filtros y vistas de mapeos
     consolidationSheetExports.js  → exportación a Excel y PDF
     consolidationSheetUtils.js    → utilidades
     ConsolidationTrail.jsx        → panel del rastro del dato
     consolidationTrail.js         → cálculo del rastro
     ConsolidationSheet.module.css · ConsolidationTrail.module.css → estilos
   ══════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { X, RefreshCw, Download, Filter, TrendingUp, BarChart2, Layers, Search } from "lucide-react";
import ConsolidationTrail from "./ConsolidationTrail.jsx";
import PageHeader, { FilterPill as HeaderFilterPill } from "../../components/layout/PageHeader.jsx";
import { useTypo, useSettings } from "../../components/layout/SettingsContext";
import { t } from "../../lib/i18n";
import { BASE, TYPE_ORDER, buildTree, apiRows, isAbort, pickPeriodFromRuns, periodKey, fmtBytes, hashText } from "./consolidationSheetUtils.js";
import { generateSheetXlsxMulti, generateSheetPdf } from "./consolidationSheetExports.js";
import { SheetRow, BreakerRow } from "./ConsolidationSheetTable.jsx";
import sheetStyles from "./ConsolidationSheet.module.css";
import { MappingsLanding, MappingsLibrary } from "./ConsolidationSheetParts.jsx";
import ProgressLoader from "../../components/framework/ProgressLoader.jsx";

// Textos nuevos del cargador (es / en / da)
const LOADER_TEXT = {
  es: { meta: "Metadatos", period: "Periodo", data: "Datos", received: "recibidos", retry: "La API va lenta, reintentando…", metaErr: "No se han podido cargar los metadatos" },
  en: { meta: "Metadata", period: "Period", data: "Data", received: "received", retry: "The API is busy, retrying…", metaErr: "Couldn't load the metadata" },
  da: { meta: "Metadata", period: "Periode", data: "Data", received: "modtaget", retry: "API'et er travlt, prøver igen…", metaErr: "Metadata kunne ikke indlæses" },
};
const META_REQUESTS = 7;   // periodos, escenarios, estructuras, sociedades, consolidaciones, estructura de grupo, dimensiones
const DATA_REQUESTS = 4;   // consolidado, cuentas subidas, asientos, consolidado del mes anterior

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConsolidationSheetPage({ token, onNavigate, activeStandardKey = null }) {
const _h1 = useTypo("header1");
const _h2 = useTypo("header2");
const _h3 = useTypo("header3");
const _b1 = useTypo("body1");
const _b2 = useTypo("body2");
const _sb1 = useTypo("subbody1");
const _u1 = useTypo("underscore1");
const _u2 = useTypo("underscore2");
const _fs = useTypo("filter");
const { colors: _colors, locale } = useSettings();
const T = useCallback((k, fb) => t(locale, k, fb), [locale]);

// Stabilize references — useTypo/useSettings return new objects each render,
// which breaks React.memo on SheetRow. We snapshot the JSON-key as a stable
// primitive so the dep list is a simple expression for eslint.
const _b1Key     = JSON.stringify(_b1);
const _b2Key     = JSON.stringify(_b2);
const _sb1Key    = JSON.stringify(_sb1);
const _colorsKey = JSON.stringify(_colors);

const body1Style    = useMemo(() => _b1,     [_b1Key]);      // eslint-disable-line react-hooks/exhaustive-deps
const body2Style    = useMemo(() => _b2,     [_b2Key]);      // eslint-disable-line react-hooks/exhaustive-deps
const subbody1Style = useMemo(() => _sb1,    [_sb1Key]);     // eslint-disable-line react-hooks/exhaustive-deps
const colors        = useMemo(() => _colors, [_colorsKey]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [periods,        setPeriods]        = useState([]);
const [sources,        setSources]        = useState([]);
  const [structures,     setStructures]     = useState([]);
  const [companies,      setCompanies]      = useState([]);
const [dimensions,     setDimensions]     = useState([]);
  const [upDimGroups, setUpDimGroups] = useState(null);   // null = all, [] = none, [...] = selected
  const [upDimensions, setUpDimensions] = useState(null);
  const [consolidations, setConsolidations] = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);

  const [year,               setYear]               = useState("");
  const [month,              setMonth]              = useState("");
  const [source,             setSource]             = useState("");
  const [structure,          setStructure]          = useState("DefaultStructure");
  const [perspectiveCompany, setPerspectiveCompany] = useState("");

const [rawData,      setRawData]      = useState([]);
  const [rawDataPrev,  setRawDataPrev]  = useState([]);
const [ytdOnly,      setYtdOnly]      = useState(false);
  // Ancho visible del área con scroll: los separadores ocupan justo eso y no
  // se mueven al desplazar en horizontal (se escribe en el DOM, sin repintar).
  const sheetScrollRef = useRef(null);
  useLayoutEffect(() => {
    const el = sheetScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--cs-view-w", `${Math.round(el.clientWidth)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });
  // Rastro del dato: cuenta elegida en la sábana (panel lateral)
  const [trace, setTrace] = useState(null);
  // Con el rastro abierto la cabecera se queda solo con el título y las
  // pestañas (P&G, Balance…): el resto no cabe en el ancho reducido.
  const headerCompact = !!trace;

  // Recarga manual (botón Reintentar) y clave estable de la lista de
  // consolidaciones (antes, cada nueva lista igual relanzaba la carga).
  const [reloadTick, setReloadTick] = useState(0);
  const consolidationsKey = useMemo(
    () => (consolidations ?? []).map(c => [c.GroupShortName ?? c.groupShortName, c.Year ?? c.year, c.Month ?? c.month, c.Source ?? c.source, c.GroupStructure ?? c.groupStructure].join("|")).join(","),
    [consolidations],
  );

  // ── Buscador de la columna "Cuenta" (como en las demás páginas) ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef(null);
  const handleTrace = useCallback((acc) => setTrace(prev => (prev?.AccountCode === acc.AccountCode ? null : acc)), []);
const [selectedCurrency, setSelectedCurrency] = useState(null); // null = default (topParent's)
  const [uploadedData, setUploadedData] = useState([]);
  const [journalData,  setJournalData]  = useState([]);
  // ── Estado de la carga ──
  // metaReady: metadatos descargados · metaError: fallo definitivo (con reintentar)
  // periodPhase: "pending" (sin metadatos) → "probe" (sondeando la API) → "ready"
  // La carga de datos no usa un booleano "loading" que haya que acordarse de
  // apagar: cada combinación de filtros tiene una clave y se está cargando
  // mientras la última clave pedida no tenga respuesta (ver loadKey).
  const [metaReady,    setMetaReady]    = useState(false);
  const [metaError,    setMetaError]    = useState(null);
  const [metaTick,     setMetaTick]     = useState(0);
  const [metaCount,    setMetaCount]    = useState(0);
  const [metaRetrying, setMetaRetrying] = useState(false);
  const [periodPhase,  setPeriodPhase]  = useState("pending");
  const [probeTick,    setProbeTick]    = useState(0);
  const [loadDone,     setLoadDone]     = useState({ key: null, error: null });
  const [net,          setNet]          = useState({ key: null, done: 0, bytes: 0, retrying: false });
  const metaLoadedRef  = useRef(false);
  const periodInitRef  = useRef(false);
const [expanded,     setExpanded]     = useState(new Set());
const [elimExpanded, setElimExpanded] = useState(false);
const [elimColsVisible, setElimColsVisible] = useState(false);
const [elimColsExiting, setElimColsExiting] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [colOrder, setColOrder] = useState([]);
  const [draggingCol, setDraggingCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

const [compareMode, setCompareMode] = useState(false);
const [cmpYear,      setCmpYear]      = useState("");
const [cmpMonth,     setCmpMonth]     = useState("");
const [cmpSource,    setCmpSource]    = useState("");
const [cmpStructure, setCmpStructure] = useState("");
const [cmpRawData,   setCmpRawData]   = useState([]);
const [cmpRawDataPrev, setCmpRawDataPrev] = useState([]);
const [cmpLoading,   setCmpLoading]   = useState(false);
const [cmpVisible,   setCmpVisible]   = useState(false);
  const [cmpExiting,   setCmpExiting]   = useState(false);
  const [cmpColsExiting, setCmpColsExiting] = useState(false);
  const [cmpColsVisible, setCmpColsVisible] = useState(false);
// Compare mode: when compareMode flips ON, we mount the compare cells
  // immediately so they're in the DOM, then on the next animation frame we
  // flip cmpColsVisible to true which triggers the CSS keyframe. When it
  // flips OFF, we set exiting=true, wait for the animation, then unmount.
useEffect(() => {
    let raf, raf2, timer;
    if (compareMode) {
      raf = requestAnimationFrame(() => {
        setCmpVisible(true);
        setCmpExiting(false);
        setCmpColsExiting(false);
        raf2 = requestAnimationFrame(() => setCmpColsVisible(true));
      });
    } else if (cmpVisible) {
      raf = requestAnimationFrame(() => {
        setCmpExiting(true);
        setCmpColsExiting(true);
        timer = setTimeout(() => {
          setCmpVisible(false); setCmpExiting(false);
          setCmpColsVisible(false); setCmpColsExiting(false);
        }, 350);
      });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  useEffect(() => {
    let raf, raf2, timer;
    if (elimExpanded) {
      raf = requestAnimationFrame(() => {
        setElimColsExiting(false);
        raf2 = requestAnimationFrame(() => setElimColsVisible(true));
      });
    } else if (elimColsVisible) {
      raf = requestAnimationFrame(() => {
        setElimColsExiting(true);
        timer = setTimeout(() => {
          setElimColsVisible(false);
          setElimColsExiting(false);
        }, 320);
      });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elimExpanded]);
const [breakers, setBreakers] = useState({});
const [breakerSortOrder, setBreakerSortOrder] = useState(new Map());
  const [codeToSectionInfo, setCodeToSectionInfo] = useState(new Map());
  const [codeToNameFromStd, setCodeToNameFromStd] = useState(new Map());
  const [codeToParentFromStd, setCodeToParentFromStd] = useState(new Map());
  const [codeToStatementFromStd, setCodeToStatementFromStd] = useState(new Map());


// ── Mappings state — single shared mapping for both P/L and B/S ──────────
const [activeMapping, setActiveMapping] = useState(null);
  // System hidden-override mapping (the client's custom default). Applied on
  // entry so "All" shows the custom structure instead of the raw standard,
  // and restored when the user clears their own mapping.
  const [hiddenOverride, setHiddenOverride] = useState(null);
const overrideAppliedRef = useRef(false);

const [viewsMode, setViewsMode] = useState(null);
  const [savedMappings, setSavedMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState(null);
const [recentMappings, setRecentMappings] = useState([]);

  // ── Export modal state ───────────────────────────────────────────────────
  const [exportModal, setExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState({
    format: "xlsx",
    sheetAll: true,   // include "All" view as one sheet
    sheetPL:  true,   // include P/L view as one sheet
    sheetBS:  true,   // include B/S view as one sheet
drillDown: true,  // include row drill-down outlines
    elimDetail: true, // include per-JournalHeader elim columns
});

// Mappings only available on P/L and B/S tabs (not on All)
  const mappingTab = typeFilter === "P/L" ? "pl"
                   : typeFilter === "B/S" ? "bs"
                   : null;
  const mappingsEnabled = !!mappingTab;

  // Convert saved mapping tree → flat { rows, sections }
const convertMappingTree = useCallback((tree) => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    // rows keyed by INSTANCE id (not code), so multiple instances of the
    // same account code (with different dims) don't collide.
    const rows = new Map();
    const sections = new Map();
    let sortCounter = 0;
    let defaultSecCounter = 0;
    let synthIdCounter = 0;

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
          // Parse dims — each entry is "Group:Value" or just "Value"
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

const handleApplyMapping = useCallback((m, kind = "structure") => {
    const plConverted = convertMappingTree(m.pl_tree ?? []);
    const bsConverted = convertMappingTree(m.bs_tree ?? []);
    // El override oculto no es un mapeo "aplicado": su estructura ya es la de "Todos".
    if (m?.is_hidden || m?.name === "__custom_override__") { setActiveMapping(null); setViewsMode(null); return; }
    setActiveMapping({
      mapping_id: m.mapping_id,
      kind,
      name: m.name,
      standard: m.standard,
      plTreeRaw: m.pl_tree ?? [],
      bsTreeRaw: m.bs_tree ?? [],
      plTreeConverted: plConverted,
      bsTreeConverted: bsConverted,
    });
    // "All" can't represent a single-statement mapping, so land the user on the
    // tab the mapping actually covers — but only if they're currently on "All"
    // (functional update reads the latest typeFilter without a dep on it).
    const hasPL = !!(plConverted && plConverted.rows.size > 0);
    const hasBS = !!(bsConverted && bsConverted.rows.size > 0);
    setTypeFilter(prev => (prev === "" ? (hasPL ? "P/L" : hasBS ? "B/S" : prev) : prev));
    setViewsMode(null);
  }, [convertMappingTree]);

const clearActiveMapping = useCallback(() => {
    // Just clear the user's mapping. With no active mapping, the override
    // render branch takes over and shows the custom default automatically —
    // applying the override as a mapping would instead route it through the
    // flat mapping branch and lose the custom structure.
    setActiveMapping(null);
  }, []);

// Load the client's hidden-override mapping (the custom default) from Supabase.
  // Only runs for CUSTOM- keys; the cleanup resets on key change / unmount so a
  // non-custom key never carries a stale override (no synchronous setState here).
  useEffect(() => {
    const isCustom = activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-");
    if (!isCustom) return;
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
      } catch (e) { console.warn("[ConsolidationSheet] hidden override load failed:", e); }
    })();
return () => {
      cancelled = true;
      setHiddenOverride(null);
      overrideAppliedRef.current = false;
    };
  }, [activeStandardKey]);

  // Apply the user's chosen "standard" accounts mapping on load, if they have one.
  // This page has only P/L and B/S (no cash flow tab), so the relevant preference is
  // user_settings.preferences.standard_mapping_id (the accounts mapping, from the
  // `mappings` table, which holds pl_tree AND bs_tree together). If set, it wins over
  // the hidden override; if not, the override render branch remains the default.
  // Applied once per standard key; the user can still pick another mapping afterwards.
  const userDefaultAppliedRef = useRef(null);
  useEffect(() => {
    const isCustom = activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-");
    if (!isCustom) return;
    if (userDefaultAppliedRef.current === activeStandardKey) return; // already applied for this key
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { data: settings } = await supabase
          .from("user_settings").select("preferences").eq("user_id", uid).single();
        const stdMappingId = settings?.preferences?.standard_mapping_id;
        if (!stdMappingId) return;
        const { getMapping } = await import("../../lib/mappingsApi");
        const full = await getMapping(stdMappingId);
        if (cancelled || !full || full.is_archived) return;
        // El override oculto del cliente ya se pinta como estructura por defecto:
        // no se aplica como mapeo del usuario (no debe salir su tarjeta).
        if (full.is_hidden || full.name === "__custom_override__") return;
        const hasPL = Array.isArray(full.pl_tree) && full.pl_tree.length > 0;
        const hasBS = Array.isArray(full.bs_tree) && full.bs_tree.length > 0;
        if (!hasPL && !hasBS) return;
        userDefaultAppliedRef.current = activeStandardKey;
        handleApplyMapping(full, "structure");
      } catch (e) { console.warn("[ConsolidationSheet] user default mapping load failed:", e); }
    })();
    return () => { cancelled = true; };
  }, [activeStandardKey, handleApplyMapping]);

  // P/L + B/S use the same mappings API (mappingsApi / reportMappingsApi)
  const pickMappingApi = useCallback(async (_tab, kind) => {
    const mod = kind === "report"
      ? await import("../../lib/reportMappingsApi")
      : await import("../../lib/mappingsApi");
    return mod;
  }, []);

  // Fetch saved mappings when entering structure/report library
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

// Fetch recent mappings (structure + report combined) for quick-access dropdown
  useEffect(() => {
    if (!mappingTab) { queueMicrotask(() => setRecentMappings([])); return; }
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

  const handleApplyFromCard = useCallback(async (m, kind) => {
    try {
      const api = await pickMappingApi(mappingTab, kind);
      const full = await api.getMapping(m.mapping_id);
      handleApplyMapping(full ?? m, kind);
    } catch {
      handleApplyMapping(m, kind);
    }
  }, [mappingTab, pickMappingApi, handleApplyMapping]);

// Reset expansion when active mapping changes
  useEffect(() => { queueMicrotask(() => setExpanded(new Set())); }, [activeMapping?.mapping_id, typeFilter]);

  // ── Metadatos ─────────────────────────────────────────────────────────────
  // Todas las peticiones reintentan solas (429 / 5xx / red / sin respuesta) y
  // siempre terminan: o llegan los datos o se muestra el error con Reintentar.
  // El periodo inicial se elige con la lista de consolidaciones, sin sondear
  // la API mes a mes (antes eran hasta 24 peticiones seguidas).
  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    // Si la API está saturada, el cargador lo dice mientras reintenta
    const opts = { signal, idleMs: 30000, onRetry: () => { if (!signal.aborted) setMetaRetrying(true); } };
    queueMicrotask(() => {
      if (signal.aborted) return;
      setMetaError(null);
      setMetaRetrying(false);
      if (!metaLoadedRef.current) setMetaCount(0);
    });
    const tick = (v) => { if (!signal.aborted) setMetaCount(n => n + 1); return v; };
    const need = (path) => apiRows(`${BASE}/${path}`, token, opts).then(tick);
    const optional = (path) => apiRows(`${BASE}/${path}`, token, opts)
      .catch(e => { if (isAbort(e)) throw e; return []; })
      .then(tick);

    Promise.all([
      need("periods"), need("sources"), need("structures"), need("companies"),
      optional("consolidations"), optional("group-structure"), optional("dimensions"),
    ]).then(([p, src, st, co, cons, gs, dims]) => {
      if (signal.aborted) return;
      setMetaRetrying(false);
      setPeriods(p); setSources(src); setStructures(st); setCompanies(co);
      setConsolidations(cons); setGroupStructure(gs); setDimensions(dims);

      // Periodo inicial: solo la primera vez (si el token se renueva, los
      // filtros que haya elegido el usuario se respetan).
      if (!periodInitRef.current) {
        periodInitRef.current = true;
        const byDate = (a, b) => (b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month);
        const latest = [...p].filter(x => x.Source === "Actual" && x.Closed === true).sort(byDate)[0]
          ?? [...p].filter(x => x.Source === "Actual").sort(byDate)[0];
        const pick = pickPeriodFromRuns(cons, {
          source: "Actual",
          structure,
          before: latest ? periodKey(latest.Year, latest.Month) : undefined,
        });
        if (pick) {
          setYear(String(pick.y)); setMonth(String(pick.m));
          setSource(pick.source); setStructure(pick.structure);
          setPeriodPhase("ready");
        } else {
          if (latest) { setYear(String(latest.Year)); setMonth(String(latest.Month)); setSource("Actual"); }
          setPeriodPhase("probe");
        }
      }
      metaLoadedRef.current = true;
      setMetaReady(true);
    }).catch(e => {
      if (signal.aborted || isAbort(e)) return;
      // Si ya había metadatos (p. ej. al renovar el token) se siguen usando
      if (!metaLoadedRef.current) setMetaError(String(e?.message ?? e));
    });
    return () => ctrl.abort();
    // `structure` solo se lee para el periodo inicial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, metaTick]);

  // ── Sondeo de respaldo ────────────────────────────────────────────────────
  // Solo si la lista de consolidaciones no ha servido (vacía o caída) o el
  // usuario pide buscar otro periodo. Va hacia atrás desde el periodo elegido
  // en tandas de 6 meses en paralelo; termina siempre en "ready".
  useEffect(() => {
    if (periodPhase !== "probe" || !token) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const start = { y: parseInt(year), m: parseInt(month), source, structure };
    const back = (y, m, n) => {
      const k = y * 12 + (m - 1) - n;
      return { y: Math.floor(k / 12), m: (k % 12) + 1 };
    };
    const has = async (y, m, src, str) => {
      const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}'`;
      try {
        const rows = await apiRows(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, token,
          { signal, retries: 2, idleMs: 20000 });
        return rows.length > 0;
      } catch (e) {
        if (isAbort(e)) throw e;
        return false;
      }
    };
    const name = (v, ...keys) => (typeof v === "object" && v ? (keys.map(k => v[k]).find(Boolean) ?? Object.values(v)[0] ?? "") : String(v ?? ""));

    (async () => {
      let found = null;
      try {
        // Pasada 1 — mismo escenario y estructura, 24 meses hacia atrás
        if (start.y && start.m && start.source && start.structure) {
          for (let i = 0; i < 24 && !found; i += 6) {
            const batch = Array.from({ length: 6 }, (_, j) => back(start.y, start.m, i + j));
            const hits = await Promise.all(batch.map(b => has(b.y, b.m, start.source, start.structure)));
            const k = hits.indexOf(true);
            if (k >= 0) found = { ...batch[k], source: start.source, structure: start.structure };
          }
        }
        // Pasada 2 — cualquier escenario × estructura, últimos 12 meses
        if (!found) {
          const allSources = [...new Set(sources.map(x => name(x, "Source", "source")).filter(Boolean))];
          const allStructures = [...new Set(structures.map(x => name(x, "GroupStructure", "groupStructure")).filter(Boolean))];
          const now = new Date();
          for (let i = 0; i < 12 && !found; i++) {
            const { y, m } = back(now.getFullYear(), now.getMonth() + 1, i);
            const combos = allSources.flatMap(src => allStructures.map(str => ({ src, str })))
              .filter(c => !(c.src === start.source && c.str === start.structure));
            const hits = await Promise.all(combos.map(c => has(y, m, c.src, c.str)));
            const k = hits.indexOf(true);
            if (k >= 0) found = { y, m, source: combos[k].src, structure: combos[k].str };
          }
        }
      } catch (e) {
        if (isAbort(e)) return;
      }
      if (signal.aborted) return;
      if (found) {
        setSource(found.source);
        setStructure(found.structure);
        setYear(String(found.y));
        setMonth(String(found.m));
      }
      setPeriodPhase("ready");
    })();
    return () => ctrl.abort();
    // Se parte de los filtros del momento en que empieza el sondeo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPhase, token, probeTick]);

  // ── Perspective / subgroup derivation (driven by /v2/group-structure) ─────
  // The Perspective pill offers any holding that ALSO has its own consolidation
  // run for the current period — picking one refetches the whole dataset from
  // that consolidation, so every amount already lives in the picked holding's
  // reporting currency. No client-side FX.
  const { topParent, rootParent, contributionCompanies, holdingOptions, displayCurrency } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.companyShortName ?? g.CompanyShortName ?? "",
      parent:    g.parentShortName  ?? g.ParentShortName  ?? "",
      structure: g.groupStructure   ?? g.GroupStructure   ?? "",
      hasChild:  g.hasChild         ?? g.HasChild         ?? false,
      detached:  g.detached         ?? g.Detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    const root = gsRows.find(g => !g.parent)?.company || "";

    // Consolidation runs available for this Year/Month/Source/Structure.
    // Intersect with holdings so we never offer a perspective that has no data.
    const consolidatedGroups = new Set(
      consolidations
        .filter(c =>
          String(c.Year ?? c.year) === year &&
          String(c.Month ?? c.month) === month &&
          (c.Source ?? c.source) === source &&
          (c.GroupStructure ?? c.groupStructure) === structure
        )
        .map(c => c.GroupShortName ?? c.groupShortName)
        .filter(Boolean)
    );

    const candidates = gsRows
      .filter(g => g.hasChild || g.company === root)
      .map(g => g.company);

    // Fail-open: if the consolidations endpoint hasn't populated yet, still
    // show all holdings rather than an empty dropdown.
    const holdingShortNames = consolidatedGroups.size > 0
      ? candidates.filter(c => consolidatedGroups.has(c))
      : candidates;

    const selected = holdingShortNames.includes(perspectiveCompany)
      ? perspectiveCompany
      : (holdingShortNames.includes(root) ? root : (holdingShortNames[0] || root));

    const kids = gsRows
      .filter(g => g.parent === selected)
      .map(g => g.company)
      .sort((a, b) => {
        const lA = companies.find(c => c.CompanyShortName === a)?.CompanyLegalName || a;
        const lB = companies.find(c => c.CompanyShortName === b)?.CompanyLegalName || b;
        return lA.localeCompare(lB, "es", { sensitivity: "base" });
      });

    const holdingOpts = holdingShortNames
      .map(h => {
        const legal = companies.find(c => c.CompanyShortName === h)?.CompanyLegalName || h;
        return { value: h, label: legal };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

    // Perspective's own currency — which is ALSO the reporting currency of its
    // consolidation run, i.e. the currency every amount in the page will be in.
    const currency = companies.find(c => c.CompanyShortName === selected)?.CurrencyCode || "";

    return {
      topParent: selected,
      rootParent: root,
      contributionCompanies: [selected, ...kids].filter(Boolean),
      holdingOptions: holdingOpts,
      displayCurrency: currency,
    };
  }, [groupStructure, structure, consolidations, year, month, source, companies, perspectiveCompany]);

const isRootView = topParent === rootParent;

  // Parse ReportingCurrencies from a row: "EUR:X:Y||USD:X:Y||GBP:X:Y"
  const parseReportingCurrencies = (str) => {
    if (!str || typeof str !== "string") return {};
    const out = {};
    str.split("||").forEach(part => {
      const [cur, period, ytd] = part.split(":");
      if (cur) out[cur] = { period: Number(period ?? 0), ytd: Number(ytd ?? 0) };
    });
    return out;
  };
  // Available currencies inferred from data + the default (topParent's).
  const availableCurrencies = useMemo(() => {
    const set = new Set();
    if (displayCurrency) set.add(displayCurrency);
    for (const r of rawData) {
      const p = parseReportingCurrencies(r.ReportingCurrencies);
      Object.keys(p).forEach(c => set.add(c));
      if (set.size >= 5) break;
    }
    return Array.from(set);
  }, [rawData, displayCurrency]);
  // Effective currency: user's choice, or group default.
  const effectiveCurrency = selectedCurrency || displayCurrency;

  const getRowAmount = useCallback((r, field = "ytd") => {
    if (!r) return 0;
    // Default (group's) currency → use AmountYTD/AmountPeriod as-is (backend already reporting).
    if (!selectedCurrency || selectedCurrency === displayCurrency) {
      return field === "period" ? Number(r.AmountPeriod ?? 0) : Number(r.AmountYTD ?? 0);
    }
    const parsed = parseReportingCurrencies(r.ReportingCurrencies);
    const bucket = parsed[selectedCurrency];
    if (!bucket) return field === "period" ? Number(r.AmountPeriod ?? 0) : Number(r.AmountYTD ?? 0);
    return field === "period" ? bucket.period : bucket.ytd;
  }, [selectedCurrency, displayCurrency]);

  // ── Load consolidated accounts + journals — scoped to the perspective ─────
  // The `GroupShortName eq '${topParent}'` filter is what makes currency work:
  // rows come back from the selected consolidation, so ReportingAmountYTD is
  // already in topParent's currency (MAD for Tizon, EUR for Bird, etc.).
  // Clave de la carga: cambia con cualquier filtro que obliga a recargar.
  // Se está cargando mientras la última clave pedida no tenga respuesta; si los
  // filtros cambian a mitad, la petición anterior se cancela de verdad
  // (AbortController) y la nueva clave toma el relevo. Así el cargador no se
  // puede quedar encendido por una carga cancelada que nadie termina.
  const consolidationsHash = useMemo(() => hashText(consolidationsKey), [consolidationsKey]);
  const loadKey = metaReady && periodPhase === "ready" && year && month && source && structure && topParent
    ? [year, month, source, structure, topParent, consolidationsHash, reloadTick].join("|")
    : null;
  const loading = loadKey !== null && loadDone.key !== loadKey;
  const loadError = loadKey !== null && loadDone.key === loadKey ? loadDone.error : null;

  useEffect(() => {
    if (!loadKey || !token) return;
    const key = loadKey;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    queueMicrotask(() => {
      if (signal.aborted) return;
      setExpanded(new Set());
      setNet({ key, done: 0, bytes: 0, retrying: false });
    });
const consFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
    const baseFilter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    // year/month pueden venir como texto: se comparan como números (enero → diciembre anterior)
    const prevYear = Number(month) === 1 ? Number(year) - 1 : Number(year);
    const prevMonth = Number(month) === 1 ? 12 : Number(month) - 1;
    const prevConsFilter = `Year eq ${prevYear} and Month eq ${prevMonth} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;

    // Progreso real para el cargador (como mucho 5 avisos por segundo)
    const bytes = new Array(DATA_REQUESTS).fill(0);
    let done = 0, retrying = false, last = 0;
    const report = (force) => {
      const now = performance.now();
      if (!force && now - last < 200) return;
      last = now;
      if (!signal.aborted) setNet({ key, done, bytes: bytes.reduce((a, b) => a + b, 0), retrying });
    };
    const get = (i, url) => apiRows(url, token, {
      signal,
      idleMs: 60000,
      onBytes: (n) => { bytes[i] = n; report(false); },
      onRetry: () => { retrying = true; report(true); },
    }).then(rows => { done += 1; retrying = false; report(true); return rows; });

    Promise.all([
      get(0, `${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(consFilter)}`),
      get(1, `${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`),
      get(2, `${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`),
      get(3, `${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(prevConsFilter)}`),
    ])
      .then(([cons, uploaded, journals, consPrev]) => {
        if (signal.aborted) return;
        setRawData(cons);
        setUploadedData(uploaded);
        setJournalData(journals);
        setRawDataPrev(consPrev);
        setLoadDone({ key, error: null });
      })
      .catch((e) => {
        if (signal.aborted || isAbort(e)) return;
        setLoadDone({ key, error: String(e?.message ?? e) });
      });
    return () => ctrl.abort();
    // La clave ya resume year/month/source/structure/topParent/consolidaciones/reintento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, token]);

  // Busca un periodo con datos (botón de la sábana vacía): primero con la
  // lista de consolidaciones; si no la hay, sondeando la API.
  const findPeriodWithData = useCallback(() => {
    const pick = pickPeriodFromRuns(consolidations, { source, structure, before: periodKey(year || 9999, month || 12) });
    const differs = pick && (String(pick.y) !== String(year) || String(pick.m) !== String(month) || pick.source !== source || pick.structure !== structure);
    if (differs) {
      setYear(String(pick.y)); setMonth(String(pick.m));
      setSource(pick.source); setStructure(pick.structure);
    } else if (pick) {
      setReloadTick(n => n + 1);
    } else {
      setPeriodPhase("probe");
      setProbeTick(n => n + 1);
    }
  }, [consolidations, source, structure, year, month]);

  // ── Cargador ──
  const LT = LOADER_TEXT[locale] ?? LOADER_TEXT[String(locale || "").slice(0, 2)] ?? LOADER_TEXT.en;
  const sheetBusy = !metaError && (!metaReady || periodPhase !== "ready" || loading);
  const sheetError = metaError ? `${LT.metaErr} · ${metaError}` : loadError;
  const netNow = net.key === loadKey ? net : { done: 0, bytes: 0, retrying: false };
  const loaderSteps = [
    { key: "meta", label: LT.meta, weight: 2, state: metaReady ? "done" : "active", progress: metaCount / META_REQUESTS },
    { key: "period", label: LT.period, weight: 1, state: periodPhase === "ready" ? "done" : metaReady ? "active" : "pending" },
    { key: "data", label: LT.data, weight: 6,
      state: !metaReady || periodPhase !== "ready" ? "pending" : loading ? "active" : "done",
      progress: netNow.done / DATA_REQUESTS },
  ];
  const loaderTitle = !metaReady ? T("loading_meta") : periodPhase !== "ready" ? T("loading_overlay_period") : T("sheet_building", "Building consolidation sheet…");
  const loaderDetail = (!metaReady && metaRetrying) || (metaReady && netNow.retrying)
    ? LT.retry
    : loading && netNow.bytes > 0 ? `${fmtBytes(netNow.bytes, locale)} ${LT.received}` : null;

useEffect(() => {
    if (!rawData.length) return;
    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

    const isCustom = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");

    // CUSTOM path: unified standard_statement_* tables, paginated fetch
    if (isCustom) {
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
          if (offset > 20000) break;
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
        const secByCode = new Map(secsArr.map(s => [s.section_code, { label: s.label, color: s.color }]));
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
rowsArr.forEach(r => breakerOrder.set(r.account_code, r.sort_order));
        setBreakers(out);
        setBreakerSortOrder(breakerOrder);
        setCodeToSectionInfo(codeSecMap);
        setCodeToNameFromStd(nameMap);
        setCodeToParentFromStd(parentMap);
        setCodeToStatementFromStd(stmtMap);
      }).catch(() => {});
      return;
    }

    // Legacy path — regex detection
    (async () => {
      try {
        const standards = await fetch(
          `${SUPABASE_URL}/accounting_standards?select=*`,
          { headers: sbHeaders }
        ).then(r => r.json());
        if (!Array.isArray(standards) || standards.length === 0) return;
        const codes = [...new Set(rawData.map(r => String(r.AccountCode ?? "")))];
        let matched = null;
        for (const std of standards) {
          if (!std.detect_pattern) continue;
          const re = new RegExp(std.detect_pattern);
          if (codes.some(c => re.test(c))) { matched = std; break; }
        }
        if (!matched) return;
        const tablesToFetch = [
          matched.pl_table,
          matched.bs_table,
          matched.cf_table,
        ].filter(Boolean);
        const results = await Promise.all(
          tablesToFetch.map(t =>
            fetch(`${SUPABASE_URL}/${t}?select=*&order=sort_order.asc`, { headers: sbHeaders })
              .then(r => r.json())
              .then(rows => Array.isArray(rows) ? rows : [])
              .catch(() => [])
          )
        );
        const allRows = results.flat();
        if (!allRows.length) return;
        const breakerOrder = new Map();
        allRows.forEach((r, idx) => breakerOrder.set(r.account_code, idx));
        setBreakerSortOrder(breakerOrder);
      } catch { /* swallow */ }
    })();
  }, [rawData, activeStandardKey]);

  // ── Fetch compare data ────────────────────────────────────────────────────
useEffect(() => {
  if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !topParent) return;
  queueMicrotask(() => setCmpLoading(true));
  const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}' and GroupShortName eq '${topParent}'`;
  fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
.then(r => r.json())
    .then(d => { setCmpRawData(d.value || []); setCmpLoading(false); })
    .catch(() => { setCmpRawData([]); setCmpLoading(false); });

  // Previous period of B (for monthly delta on the compare column).
  const pM = Number(cmpMonth) - 1;
  const pY = pM >= 1 ? Number(cmpYear) : Number(cmpYear) - 1;
  const pMonth = pM >= 1 ? pM : 12;
  const prevFilter = `Year eq ${pY} and Month eq ${pMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}' and GroupShortName eq '${topParent}'`;
  fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(prevFilter)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(r => r.json())
    .then(d => setCmpRawDataPrev(d.value || []))
    .catch(() => setCmpRawDataPrev([]));
}, [token, compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, topParent]);

  // ── Derived data ──────────────────────────────────────────────────────────

// Dimension name↔code lookup for filtering amounts by mapping instance dims.
  // Mapping instances store dims as "Group:Name" but rawData rows have "Group:Code".
  // Build a bidirectional map so we can match either shape.
const dimGroups = useMemo(() => {
    const seen = new Set();
    return (dimensions || [])
      .map(d => String(d.DimensionGroup ?? d.dimensionGroup ?? ""))
      .filter(g => g && !seen.has(g) && seen.add(g));
  }, [dimensions]);

  const filteredDims = useMemo(() => {
    if (!upDimGroups || upDimGroups.length === 0) return dimensions || [];
    return (dimensions || []).filter(d => {
      const g = String(d.DimensionGroup ?? d.dimensionGroup ?? "");
      return upDimGroups.includes(g);
    });
  }, [dimensions, upDimGroups]);

  const dimNameLookup = useMemo(() => {
    // Map key: "Group:Name" → set of "Group:Code" equivalents
    const nameToCodes = new Map();
    (dimensions || []).forEach(d => {
      const g = String(d.DimensionGroup ?? d.dimensionGroup ?? d.DimensionGroupName ?? d.dimensionGroupName ?? "").trim();
      const cd = String(d.DimensionCode ?? d.dimensionCode ?? "").trim();
      const nm = String(d.DimensionName ?? d.dimensionName ?? "").trim();
      if (!g) return;
      const nameKey = `${g}:${nm}`;
      const codeKey = `${g}:${cd}`;
      if (!nameToCodes.has(nameKey)) nameToCodes.set(nameKey, new Set());
      if (cd) nameToCodes.get(nameKey).add(codeKey);
      // Also identity mapping (allow direct match if mapping stores code already)
      if (!nameToCodes.has(codeKey)) nameToCodes.set(codeKey, new Set([codeKey]));
    });
    return nameToCodes;
  }, [dimensions]);

  // Returns true if row's Dimensions string matches any of nodeDims (mapping instance dims).
  // nodeDims is an array like ["Centro de Coste:Producción"]. row.Dimensions is like
  // "Centro de Coste:1||Categoria:X".
  const rowMatchesDims = useCallback((row, nodeDims) => {
    if (!nodeDims || nodeDims.length === 0) return true; // no filter → all rows match
    const dimsStr = String(row?.Dimensions ?? row?.dimensions ?? "").trim();
    if (!dimsStr) return false; // no dims on row but mapping requires one
    const rowPairs = new Set(
      dimsStr.split("||").map(s => s.trim()).filter(Boolean)
    );
    // For each required nodeDim, check if row has an equivalent pair
    return nodeDims.some(nd => {
      const need = String(nd).trim();
      // Direct match (mapping stored code that appears in row)
      if (rowPairs.has(need)) return true;
      // Name-based match: resolve to code equivalents
      const codeEquivalents = dimNameLookup.get(need);
      if (!codeEquivalents) return false;
      for (const codeKey of codeEquivalents) {
        if (rowPairs.has(codeKey)) return true;
      }
      return false;
    });
  }, [dimNameLookup]);

// Pre-filter for dimension dropdowns (PageHeader multiselect)
  const passesDimFilter = useCallback((r) => {
    if (Array.isArray(upDimensions) && upDimensions.length > 0) {
      const dCode = String(r.DimensionCode ?? r.dimensionCode ?? "");
      if (!upDimensions.includes(dCode)) return false;
    } else if (Array.isArray(upDimGroups) && upDimGroups.length > 0) {
      const dimsStr = String(r.Dimensions ?? r.dimensions ?? "").trim();
      if (!dimsStr) return false;
      const rowGroups = dimsStr.split("||")
        .map(p => p.slice(0, p.indexOf(":")).trim())
        .filter(Boolean);
      if (!rowGroups.some(g => upDimGroups.includes(g))) return false;
    }
    return true;
  }, [upDimGroups, upDimensions]);

const pivot = useMemo(() => {
    const m = new Map();
    rawData.forEach(r => {
      if (!passesDimFilter(r)) return;
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
      c[r.CompanyShortName].push(r);
    });
    return m;
  }, [rawData, passesDimFilter]);

  const pivotPrev = useMemo(() => {
    const m = new Map();
    rawDataPrev.forEach(r => {
      if (!passesDimFilter(r)) return;
      if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
      const c = m.get(r.AccountCode);
      if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
      c[r.CompanyShortName].push(r);
    });
    return m;
  }, [rawDataPrev, passesDimFilter]);

  // Compare-period pivot: { code → { company → consTotal, contribByCo } }
const cmpPivot = useMemo(() => {
  const m = new Map();
  cmpRawData.forEach(r => {
    if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
    const c = m.get(r.AccountCode);
    if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
    c[r.CompanyShortName].push(r);
  });
  return m;
}, [cmpRawData]);

const cmpPivotPrev = useMemo(() => {
  const m = new Map();
  cmpRawDataPrev.forEach(r => {
    if (!passesDimFilter(r)) return;
    if (!m.has(r.AccountCode)) m.set(r.AccountCode, {});
    const c = m.get(r.AccountCode);
    if (!c[r.CompanyShortName]) c[r.CompanyShortName] = [];
    c[r.CompanyShortName].push(r);
  });
  return m;
}, [cmpRawDataPrev, passesDimFilter]);

// ── Elimination rollup by JournalHeader ───────────────────────────────────
  // Each elimination journal has a meaningful Header describing what it does.
  // We collect every distinct header that appears at Group level, bucket per
  // header per account, and roll up the tree. Sub-columns are derived
  // dynamically from the data — order is stable (alphabetical, with empty
  // headers last).
const { elimPivot, elimHeaders } = useMemo(() => {
    // 1. Collect Group-level journals only (these are the consolidation engine's postings)
const groupJournals = journalData.filter(r => r.CompanyShortName === topParent);

    // 2. Discover all distinct headers
    const headerSet = new Set();
    groupJournals.forEach(r => {
      const h = String(r.JournalHeader ?? "").trim() || "(no header)";
      headerSet.add(h);
    });
    const headers = [...headerSet].sort((a, b) => {
      if (a === "(no header)") return 1;
      if (b === "(no header)") return -1;
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });

    // 3. Bucket per account per header
    const empty = () => Object.fromEntries(headers.map(h => [h, 0]));
    const detail = new Map();
    groupJournals.forEach(r => {
      const ac = String(r.AccountCode ?? "").trim();
      if (!ac) return;
      const h = String(r.JournalHeader ?? "").trim() || "(no header)";
      if (!detail.has(ac)) detail.set(ac, empty());
  detail.get(ac)[h] += -Number(getRowAmount(r) || 0);
    });

    // 4. Roll up the tree (parent inherits sum of all child journal entries)
    const parentOf = new Map();
    const seen = new Set();
    rawData.forEach(r => {
      const ac = String(r.AccountCode ?? "").trim();
      if (!ac || seen.has(ac)) return;
      seen.add(ac);
      if (r.SumAccountCode) parentOf.set(ac, String(r.SumAccountCode).trim());
    });

    const m = new Map();
    const addTo = (code, src) => {
      if (!m.has(code)) m.set(code, empty());
      const dst = m.get(code);
      headers.forEach(h => { dst[h] += src[h]; });
    };

    detail.forEach((src, ac) => {
      addTo(ac, src);
      let cur = ac;
      while (parentOf.has(cur)) {
        const par = parentOf.get(cur);
        addTo(par, src);
        cur = par;
      }
    });

// Drop headers where every account is zero (keeps the view clean)
    const headerTotals = {};
    headers.forEach(h => {
      let absSum = 0;
      for (const v of m.values()) absSum += Math.abs(v[h] ?? 0);
      headerTotals[h] = absSum;
    });
    const nonEmptyHeaders = headers.filter(h => headerTotals[h] >= 1);

return { elimPivot: m, elimHeaders: nonEmptyHeaders };
  }, [journalData, rawData, topParent, getRowAmount]);

  const uploadedPivot = useMemo(() => {
    const m = new Map();
    uploadedData.forEach(r => {
      const ac = r.AccountCode ?? r.accountCode ?? "";
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!ac || !co) return;
      if (!m.has(ac)) m.set(ac, {});
      const byCompany = m.get(ac);
      if (!byCompany[co]) byCompany[co] = [];
      byCompany[co].push(r);
    });
    return m;
  }, [uploadedData]);

// Derive sortOrder + breakers + mappedCodes from active mapping (if any).
  // Picks the right tree based on the current tab. If the mapping doesn't
  // have a tree for the current tab (e.g. only pl_tree exists and user is
  // on B/S), return null so the standard render path takes over instead of
  // showing an empty table.
const mappingDerived = useMemo(() => {
    if (!activeMapping) return null;

// The "All" tab shows the client's custom override structure and NEVER a
    // user mapping (a mapping is single-statement and can't represent the mixed
    // All view) — so mappingDerived is null there. Mappings apply only on their
    // own P/L or B/S tab.
    if (!mappingTab) return null;
    const parts = [[mappingTab, mappingTab === "pl" ? activeMapping.plTreeConverted : activeMapping.bsTreeConverted]];

    const usable = parts.filter(([, c]) => c && c.rows.size > 0);
    if (usable.length === 0) return null;

    const instances = [];
    const sortOrder = new Map();
    const codeSection = new Map();
    const mappedCodes = new Set();
    const sectionMeta = {};
    let sortBase = 0;

    usable.forEach(([ns, converted]) => {
      const { rows, sections } = converted;
      const nsId = (id) => usable.length > 1 ? `${ns}:${id}` : String(id);
      let localMax = 0;
      rows.forEach((info, instanceId) => {
        const iid = nsId(instanceId);
        const so = sortBase + (info.sortOrder ?? 0);
        const secNs = nsId(info.section);
        instances.push({ instanceId: iid, ...info, section: secNs, sortOrder: so });
        sortOrder.set(iid, so);
        codeSection.set(iid, secNs);
        if (!info.isSum) mappedCodes.add(info.code);
        if ((info.sortOrder ?? 0) > localMax) localMax = info.sortOrder ?? 0;
      });
      sections.forEach((secInfo, secId) => {
        if (secInfo && secInfo.label) {
          sectionMeta[nsId(secId)] = { label: secInfo.label, color: secInfo.color || "#1a2f8a" };
        }
      });
      sortBase += localMax + 1000; // BS strictly after PL
    });

    instances.sort((a, b) => a.sortOrder - b.sortOrder);
    return { instances, sortOrder, codeSection, sectionMeta, mappedCodes };
  }, [activeMapping, mappingTab]);

// Account tree
  const { accountMap, tree, mappingBreakersOverride } = useMemo(() => {
    const accountMap = new Map();
    rawData.forEach(r => {
      if (!accountMap.has(r.AccountCode)) {
        accountMap.set(r.AccountCode, {
          AccountCode: r.AccountCode, AccountName: r.AccountName,
          AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
        });
      }
    });
if (!accountMap.size) return { accountMap, tree: [], mappingBreakersOverride: null };

// ── Mapping-driven branch ─────────────────────────────────────────────
    // mappingDerived.mappedCodes already comes from the tab-specific tree
    // (plTreeConverted when on P/L, bsTreeConverted when on B/S). So every
    // code here belongs to the current tab BY DEFINITION. No AccountType
    // filtering needed — the tab separation comes from which tree (pl_tree
    // vs bs_tree) the codes were stored under in the mapping.
    //
    // Render EVERY mapped code regardless of whether it has data. Codes that
    // exist in the API response get real names/types/values; codes that only
    // live in the mapping render with the code as the name and zero values.
// ── "All" from hidden override ─────────────────────────────────────────
    // In the mixed All view (no tab), render the client's custom structure
    // straight from the override's native pl_tree + bs_tree — preserving order,
    // nesting and breakers, exactly like Contributive's "Todos". Sort-based
    // reconstruction from the standard can't place override-only custom
    // accounts (999/888/777), so we walk the override tree directly instead.
// Applies to All (both trees) and to the P/L or B/S tabs (their single
    // tree) — but only when the user has NOT activated their own mapping for
    // that tab (in which case the mapping branch below takes over).
    const userMappingActive = !!(mappingDerived && mappingDerived.instances && mappingDerived.instances.length > 0);
    const overrideForTab =
      mappingTab === "pl" ? { pl: true, bs: false } :
      mappingTab === "bs" ? { pl: false, bs: true } :
      !mappingTab        ? { pl: true, bs: true } : null;
    if (overrideForTab && !userMappingActive && hiddenOverride &&
        ((overrideForTab.pl && hiddenOverride.pl_tree?.length > 0) ||
         (overrideForTab.bs && hiddenOverride.bs_tree?.length > 0))) {
const breakersOverride = {};
      let synthCounter = 0;
// Build a subtree (children keep their own nesting, no section handling —
      // breakers only exist at the top level of pl_tree/bs_tree).
      const buildNode = (n, stmtType) => {
        const code = String(n.code ?? "");
        if (!code) return null;
        const existing = accountMap.get(code);
        const stmt = codeToStatementFromStd.get(code);
        const resolvedType = existing?.AccountType
          || (stmt === "BS" ? "B/S" : stmt === "PL" ? "P/L" : null)
          || stmtType || "P/L";
        const instanceId = String(n.id ?? `ov-${code}-${synthCounter++}`);
        const kids = (n.children || [])
          .filter(c => c && c.kind !== "breaker" && !String(c.code ?? "").startsWith("__breaker__"))
          .map(c => buildNode(c, stmtType))
          .filter(Boolean);
        return {
          AccountCode: code,
          AccountName: n.name || existing?.AccountName || code,
          AccountType: resolvedType,
          SumAccountCode: existing?.SumAccountCode ?? null,
          children: kids,
          _instanceId: instanceId,
          _dims: Array.isArray(n.dims) ? n.dims.map(String).filter(Boolean) : [],
          _isSum: !!n.isSum,
        };
      };
      // Top-level walk: a breaker opens a section that runs until the NEXT
      // breaker. Its meta attaches to the first top-level node that follows —
      // exactly like Contributive's buildMappingLiteral. Nodes NOT wrapped by a
      // breaker (siblings after the breaker's own children, e.g. I.PL) still
      // belong to the currently-open section.
const buildFromOverride = (nodes, _unused, stmtType) => {
        const out = [];
        let currentSectionMeta = null;
        let sectionOpenNeedsAnchor = false;
        const emit = (rawNode) => {
          const built = buildNode(rawNode, stmtType);
          if (!built) return;
          if (sectionOpenNeedsAnchor && currentSectionMeta) {
            breakersOverride[built._instanceId] = currentSectionMeta;
            sectionOpenNeedsAnchor = false;
          }
          out.push(built);
        };
        const walkTop = (list) => {
          for (const n of list || []) {
            if (!n) continue;
            if (n.kind === "breaker" || String(n.code ?? "").startsWith("__breaker__")) {
              currentSectionMeta = { label: String(n.name ?? ""), color: n.color || "#1a2f8a" };
              sectionOpenNeedsAnchor = true;
              walkTop(n.children);
              continue;
            }
            emit(n);
          }
        };
        walkTop(nodes);
        // A breaker with no following account (e.g. an empty "NEW BREAKER" at the
        // end) never got anchored — surface it as a standalone header row via a
        // placeholder node so it still renders.
        if (sectionOpenNeedsAnchor && currentSectionMeta) {
          const phId = `ov-emptybreaker-${synthCounter++}`;
          breakersOverride[phId] = currentSectionMeta;
          out.push({
            AccountCode: "", AccountName: "", AccountType: stmtType || "P/L",
            SumAccountCode: null, children: [], _instanceId: phId, _dims: [],
            _isSum: false, _breakerOnly: true,
          });
        }
        return out;
      };
// Clona los árboles del override (valores de estado) a datos locales antes de
      // construir, para no derivar la estructura de render directamente del estado.
      const plSrc = overrideForTab.pl ? structuredClone(hiddenOverride.pl_tree ?? []) : [];
      const bsSrc = overrideForTab.bs ? structuredClone(hiddenOverride.bs_tree ?? []) : [];
      const treeOut = [
        ...buildFromOverride(plSrc, null, "P/L"),
        ...buildFromOverride(bsSrc, null, "B/S"),
      ];
      return { accountMap, tree: treeOut, mappingBreakersOverride: breakersOverride };
    }

if (mappingDerived && mappingDerived.instances && mappingDerived.instances.length > 0) {
      // Each mapping instance becomes its own tree node. Multiple instances
      // of the same account code (with different dims) do NOT collide —
      // they render as separate rows.
const flatNodes = mappingDerived.instances.map(inst => {
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
          _level: inst.level ?? 0,
        };
      });
      // Rebuild nesting from each instance's _level (depth in the mapping tree).
      // A node at level N nests under the most recent node at level N-1. Without
      // this the sum rows and their children all render flat at the top level.
      const treeNodes = [];
      const stack = [];
      flatNodes.forEach(node => {
        const lvl = node._level;
        while (stack.length && stack[stack.length - 1]._level >= lvl) stack.pop();
        if (stack.length) {
          stack[stack.length - 1].children.push(node);
        } else {
          treeNodes.push(node);
        }
        stack.push(node);
      });
      // Already ordered by sortOrder in mappingDerived.instances
      const mappingBreakersOverride = {};
      const seenSections = new Set();
      // Breakers are keyed off top-level nodes only (sections open at the top).
      treeNodes.forEach(node => {
        const secId = mappingDerived.codeSection.get(node._instanceId);
        if (!secId || seenSections.has(secId)) return;
        const meta = mappingDerived.sectionMeta[secId];
        if (meta) mappingBreakersOverride[node._instanceId] = meta;
        seenSections.add(secId);
      });
      return { accountMap, tree: treeNodes, mappingBreakersOverride };
    }

// ── Standard branch (no mapping for this tab) ──────────────────────────
    // Effective sort: mapping overrides standard breaker order
    const effectiveSortOrder = mappingDerived?.sortOrder ?? breakerSortOrder;
    const isCustomStd = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");

    // CUSTOM: build hierarchical tree from the standard (like Contributive).
    // The standard is authoritative — accountMap only has ~4 top-level codes
    // for Konsolidator, but the standard has ~1000. Build stdNodes from
    // effectiveSortOrder and overlay accountMap data where present.
    if (isCustomStd && codeToSectionInfo && codeToSectionInfo.size > 0 && effectiveSortOrder.size > 0) {
      const STMT_TO_TYPE = { PL: "P/L", BS: "B/S", CF: "C/F" };
      const isGrandTotal = (code) => {
        const info = codeToSectionInfo.get(code);
        return !info || !info.section;
      };

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

      // ── Inject custom accounts that live ONLY in the hidden override ───────
      // (e.g. 999/888/777). Absent from the standard, so walk the override's
      // native pl_tree/bs_tree and add each missing code with its real parent
      // (from the override nesting), a section inherited from the enclosing
      // breaker, and a sortOrder anchored just after the nearest preceding
      // standard sibling — so they land in the right section AND nest (888
      // under 999, 777 under 888).
if (hiddenOverride) {
        // Minimum sortOrder per section among EXISTING standard codes, so when
        // we enter a breaker whose custom codes precede any standard sibling
        // (e.g. RESULT → 999 before E.PL), we anchor to the section's start
        // instead of leaving the anchor in the previous section.
const sectionMinSort = new Map();
        for (const [code, so] of effectiveSortOrder.entries()) {
          if (!Number.isInteger(so)) continue; // skip already-injected custom codes
          if (stdNodes.get(code)?._fromOverride) continue;
          const sec = codeToSectionInfo.get(code)?.section;
          if (!sec) continue;
          const cur = sectionMinSort.get(sec);
          if (cur == null || so < cur) sectionMinSort.set(sec, so);
        }
// Find the sortOrder of the next EXISTING standard code at or after a
        // given index among siblings — custom codes anchor just before it.
        const nextStdSort = (siblings, startIdx) => {
          for (let i = startIdx; i < siblings.length; i++) {
            const s = siblings[i];
            if (!s) continue;
            if (s.kind === "breaker" || String(s.code ?? "").startsWith("__breaker__")) continue;
            const c = String(s.code ?? "");
            if (c && stdNodes.has(c)) {
              const so = effectiveSortOrder.get(c);
              if (Number.isInteger(so)) return so;
            }
          }
          return null;
        };
        const injectOverrideTree = (nodes, parentCode, sectionInfo, anchorRef) => {
          const siblings = nodes || [];
          for (let idx = 0; idx < siblings.length; idx++) {
            const n = siblings[idx];
            if (!n) continue;
            if (n.kind === "breaker" || String(n.code ?? "").startsWith("__breaker__")) {
              const secCode = n.sectionCode || n.code;
              const secInfo = (secCode && codeToSectionInfo.get(secCode))
                || { section: secCode || sectionInfo?.section, label: n.name, color: n.color || "#1a2f8a" };
              injectOverrideTree(n.children, parentCode, secInfo, anchorRef);
              continue;
            }
            const code = String(n.code ?? "");
            if (!code) continue;

if (stdNodes.has(code)) {
              const so = effectiveSortOrder.get(code);
              if (so != null) anchorRef.sort = so;
            } else {
              // Interpolate between the previous and next EXISTING standard
              // siblings so custom codes land exactly where the override nests
              // them — between anchorRef.sort (prev std) and the next std sort.
              const prevStd = anchorRef.sort;
              const nextStd = nextStdSort(siblings, idx + 1);
              const upper = (nextStd != null && nextStd > prevStd) ? nextStd : (prevStd + 1);
              anchorRef.sort = prevStd + (upper - prevStd) / 1000;
              const stmt = codeToStatementFromStd.get(code);
              stdNodes.set(code, {
                AccountCode: code,
                AccountName: n.name || code,
                AccountType: stmt === "BS" ? "B/S" : "P/L",
                SumAccountCode: parentCode || "",
                children: [],
                _fromOverride: true,
              });
              effectiveSortOrder.set(code, anchorRef.sort);
              if (sectionInfo && !codeToSectionInfo.has(code)) {
                codeToSectionInfo.set(code, sectionInfo);
              }
if (parentCode && !codeToParentFromStd.get(code)) {
                codeToParentFromStd.set(code, parentCode);
              }
            }
            injectOverrideTree(n.children, code, sectionInfo, anchorRef);
          }
        };
        const anchorRef = { sort: 0 };
        injectOverrideTree(hiddenOverride.pl_tree, "", null, anchorRef);
        injectOverrideTree(hiddenOverride.bs_tree, "", null, anchorRef);
      }

      // Wire parent-child links, SKIP if parent is grand total OR cross-section
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

      // typeFilter for tab
      const passesTypeFilter = (n) => {
        const t = n.AccountType ?? "";
        if (typeFilter === "P/L") return t === "P/L" || t === "DIS";
        if (typeFilter === "B/S") return t === "B/S";
        if (typeFilter === "C/F") return t === "C/F" || t === "CFS";
        // "Todos" excludes CF (rendered separately in Contributive; here just PL+BS)
        return t !== "C/F" && t !== "CFS";
      };

      const filteredSet = new Set(
        [...stdNodes.values()].filter(passesTypeFilter).map(n => n.AccountCode)
      );
      const sortRec = (node) => {
        if (!node.children || !node.children.length) return;
        node.children = node.children
          .filter(c => filteredSet.has(c.AccountCode))
          .sort((a, b) => {
            const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999999;
            const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999999;
            return sA - sB;
          });
        node.children.forEach(sortRec);
      };

const rawRoots = [...stdNodes.values()]
        .filter(passesTypeFilter)
        .filter(n => {
          const p = n.SumAccountCode;
          if (!p) return true;
          if (isGrandTotal(p)) return true;
          if (!stdNodes.has(p)) return true;
          if (!filteredSet.has(p)) return true;
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

      // Grand totals (C.ACT, G.PYC, G.PAS, etc.) carry no section and must NOT
      // render as rows, nor spawn a generic "BALANCE" breaker. Drop them: if a
      // grand total has children, promote those children up in its place; if it
      // has none, remove it entirely. Mirrors the Contributive dropGrandTotals fix.
      const dropGrandTotals = (nodes) => {
        const out = [];
        for (const n of nodes) {
          if (isGrandTotal(n.AccountCode)) {
            if (n.children && n.children.length) out.push(...dropGrandTotals(n.children));
            // no children → drop entirely
          } else {
            out.push(n);
          }
        }
        return out;
      };
const roots = dropGrandTotals(rawRoots);
roots.forEach(sortRec);
      return { accountMap, tree: roots, mappingBreakersOverride: null };
    }

    // Legacy path
    const typeFilteredMap = new Map([...accountMap.entries()].filter(([, v]) => {
      const t = v.AccountType ?? "";
      let typeMatches;
      if (typeFilter === "P/L") typeMatches = (t === "P/L" || t === "DIS");
      else if (typeFilter === "B/S") typeMatches = (t === "B/S");
      else if (typeFilter === "C/F") typeMatches = (t === "C/F" || t === "CFS");
      else typeMatches = (t !== "C/F" && t !== "CFS");
      return typeMatches;
    }));

    if (effectiveSortOrder.size > 0) {
      const tree = [...typeFilteredMap.values()]
        .sort((a, b) => {
          const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999;
          const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999;
          if (sA !== sB) return sA - sB;
          const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
          const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
          return tA - tB;
        })
        .map(n => ({ ...n, children: [] }));
      return { accountMap, tree, mappingBreakersOverride: null };
    }
    const tree = buildTree([...typeFilteredMap.values()]).sort((a, b) => {
      const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
      const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
      return tA - tB;
    });
    return { accountMap, tree, mappingBreakersOverride: null };
}, [rawData, breakerSortOrder, typeFilter, mappingTab, mappingDerived, hiddenOverride, activeStandardKey, codeToSectionInfo, codeToNameFromStd, codeToParentFromStd, codeToStatementFromStd]);

// ── Pre-built trees for each export view ─────────────────────────────────
  // The on-screen `tree` uses the user's current typeFilter. The Excel export
  // needs trees for ALL three views (All, P/L, B/S) regardless of which tab
  // is active, so each sheet gets its own filtered tree.
  const exportTrees = useMemo(() => {
    const accountMap = new Map();
    rawData.forEach(r => {
      if (!accountMap.has(r.AccountCode)) {
        accountMap.set(r.AccountCode, {
          AccountCode: r.AccountCode, AccountName: r.AccountName,
          AccountType: r.AccountType, SumAccountCode: r.SumAccountCode,
        });
      }
    });
    if (!accountMap.size) return { all: [], pl: [], bs: [] };

    const buildFiltered = (filterType, mappingForView) => {
// Mapping path
      if (mappingForView && mappingForView.mappedCodes.size > 0) {
        const nodes = [];
        mappingForView.mappedCodes.forEach(code => {
          const existing = accountMap.get(code);
          if (!existing) return;
          nodes.push({
            AccountCode: code,
            AccountName: existing.AccountName,
            AccountType: existing.AccountType,
            SumAccountCode: existing.SumAccountCode ?? null,
            children: [],
          });
        });
        nodes.sort((a, b) => {
          const sA = mappingForView.sortOrder.get(a.AccountCode) ?? 9999;
          const sB = mappingForView.sortOrder.get(b.AccountCode) ?? 9999;
          return sA - sB;
        });
        // Reassign breakers to first surviving code per section
        const breakers = {};
        const seen = new Set();
        nodes.forEach(n => {
          const secId = mappingForView.codeSection?.get(n.AccountCode);
          if (!secId || seen.has(secId)) return;
          const meta = mappingForView.sectionMeta?.[secId];
          if (meta) breakers[n.AccountCode] = meta;
          seen.add(secId);
        });
        mappingForView.breakers = breakers;
        return nodes;
      }
// Standard path — replicate the on-screen custom tree EXACTLY: nodes come from
      // breakerSortOrder.keys() (the full standard incl. sum rows like A.04.S), the
      // parent link is codeToParentFromStd (the standard's real hierarchy, NOT the
      // rawData SumAccountCode), and we skip grand-total / cross-section parents.
      const isGrandTotalExp = (code) => {
        const info = codeToSectionInfo.get(String(code));
        return !info || !info.section;
      };
      const STMT_TO_TYPE = { PL: "P/L", BS: "B/S", CF: "C/F" };
      const passesTypeCode = (code, type) => {
        if (type === "C/F" || type === "CFS") return false;
        if (filterType === "P/L") return type === "P/L" || type === "DIS";
        if (filterType === "B/S") return type === "B/S";
        return true; // All
      };
      const stdNodes = new Map();
      for (const code of breakerSortOrder.keys()) {
        if (isGrandTotalExp(code)) continue;
        const fromMap = accountMap.get(code);
        const stmt = codeToStatementFromStd.get(code);
        const type = fromMap?.AccountType ?? STMT_TO_TYPE[stmt] ?? "P/L";
        if (!passesTypeCode(code, type)) continue;
        stdNodes.set(code, {
          AccountCode: code,
          AccountName: fromMap?.AccountName ?? codeToNameFromStd.get(code) ?? code,
          AccountType: type,
          SumAccountCode: codeToParentFromStd.get(code) ?? fromMap?.SumAccountCode ?? "",
          children: [],
        });
      }
      // Wire parent→child, skipping grand-total parents and cross-section links.
      stdNodes.forEach(node => {
        const parentCode = node.SumAccountCode;
        if (!parentCode) return;
        if (isGrandTotalExp(parentCode)) return;
        const nodeSec = codeToSectionInfo.get(String(node.AccountCode))?.section;
        const parentSec = codeToSectionInfo.get(String(parentCode))?.section;
        if (nodeSec && parentSec && nodeSec !== parentSec) return;
        const parent = stdNodes.get(parentCode);
        if (parent && parent !== node) parent.children.push(node);
      });
      const sortKey = (c) => breakerSortOrder.get(c) ?? 9999999;
      const sortRec = (node) => {
        if (!node.children?.length) return;
        node.children.sort((a, b) => sortKey(a.AccountCode) - sortKey(b.AccountCode));
        node.children.forEach(sortRec);
      };
      const roots = [...stdNodes.values()].filter(n => {
        const p = n.SumAccountCode;
        if (!p) return true;
        if (isGrandTotalExp(p)) return true;
        if (!stdNodes.has(p)) return true;
        const nodeSec = codeToSectionInfo.get(String(n.AccountCode))?.section;
        const parentSec = codeToSectionInfo.get(String(p))?.section;
        if (nodeSec && parentSec && nodeSec !== parentSec) return true;
        return false;
      }).sort((a, b) => sortKey(a.AccountCode) - sortKey(b.AccountCode));
      roots.forEach(sortRec);
      return roots;
    };

const getDerivedFor = (tab) => {
      if (!activeMapping) return null;
      const converted = tab === "pl" ? activeMapping.plTreeConverted
                      : tab === "bs" ? activeMapping.bsTreeConverted
                      : null;
      if (!converted || converted.rows.size === 0) return null;
      const sortOrder = new Map();
      const codeSection = new Map();
      const mappedCodes = new Set();
      converted.rows.forEach((info, code) => {
        sortOrder.set(code, info.sortOrder);
        codeSection.set(code, info.section);
        if (!info.isSum) mappedCodes.add(code);
      });
      const sectionMeta = {};
      converted.sections.forEach((secInfo, secId) => {
        if (secInfo && secInfo.label) {
          sectionMeta[secId] = { label: secInfo.label, color: secInfo.color || "#1a2f8a" };
        }
      });
      return { sortOrder, codeSection, sectionMeta, mappedCodes, breakers: {} };
    };

const derivedPL = getDerivedFor("pl");
    const derivedBS = getDerivedFor("bs");

    // When no user mapping is active but the client has a hidden override,
    // export must mirror the on-screen custom structure (the standard path only
    // has the ~8 top-level accountMap codes, so it would export almost nothing).
// Build an export tree straight from a raw structure tree (override OR a
    // user mapping — both share the same {code,name,children,breaker} shape),
    // preserving nesting and section breakers. Replaces the old flat
    // accountMap-filtered path that dropped custom accounts missing from
    // rawData (which left P/L & B/S empty when a mapping was active).
    const buildFromStructureTree = (plTree, bsTree, which) => {
      const usePl = (which === "all" || which === "pl") && Array.isArray(plTree) && plTree.length > 0;
      const useBs = (which === "all" || which === "bs") && Array.isArray(bsTree) && bsTree.length > 0;
      if (!usePl && !useBs) return null;
      const nodes = [];
      const breakers = {};
      let phCounter = 0;
      const buildOne = (n, stmtType) => {
        const code = String(n.code ?? "");
        if (!code) return null;
        const existing = accountMap.get(code);
        const stmt = codeToStatementFromStd.get(code);
        const type = existing?.AccountType || (stmt === "BS" ? "B/S" : stmt === "PL" ? "P/L" : null) || stmtType || "P/L";
        const kids = (n.children || [])
          .filter(c => c && c.kind !== "breaker" && !String(c.code ?? "").startsWith("__breaker__"))
          .map(c => buildOne(c, stmtType)).filter(Boolean);
return {
          AccountCode: code,
          AccountName: n.name || existing?.AccountName || code,
          AccountType: type,
          SumAccountCode: existing?.SumAccountCode ?? null,
          children: kids,
          _dims: Array.isArray(n.dims) ? n.dims.map(String).filter(Boolean) : [],
        };
      };
      const walkExport = (list, stmtType) => {
        let curMeta = null, needAnchor = false;
        const doWalk = (items) => {
          for (const n of items || []) {
            if (!n) continue;
            if (n.kind === "breaker" || String(n.code ?? "").startsWith("__breaker__")) {
              curMeta = { label: String(n.name ?? ""), color: n.color || "#1a2f8a" };
              needAnchor = true;
              doWalk(n.children);
              continue;
            }
            const built = buildOne(n, stmtType);
            if (!built) continue;
            if (needAnchor && curMeta) { breakers[built.AccountCode] = curMeta; needAnchor = false; }
            nodes.push(built);
          }
        };
        doWalk(list);
        if (needAnchor && curMeta) {
          const phCode = `__breaker_ph_${phCounter++}__`;
          breakers[phCode] = curMeta;
          nodes.push({ AccountCode: phCode, AccountName: "", AccountType: stmtType || "P/L", SumAccountCode: null, children: [], _breakerOnly: true });
        }
      };
      if (usePl) walkExport(plTree, "P/L");
      if (useBs) walkExport(bsTree, "B/S");
      return { nodes, breakers };
    };

// Clona árboles de estado (activeMapping / hiddenOverride) a datos locales
    // antes de construir, para no derivar la salida directamente del estado.
    const mapPl = activeMapping?.plTreeRaw ? structuredClone(activeMapping.plTreeRaw) : null;
    const mapBs = activeMapping?.bsTreeRaw ? structuredClone(activeMapping.bsTreeRaw) : null;
    const ovPl  = hiddenOverride?.pl_tree ? structuredClone(hiddenOverride.pl_tree) : null;
    const ovBs  = hiddenOverride?.bs_tree ? structuredClone(hiddenOverride.bs_tree) : null;

    // "All" always uses the override (never a mapping). P/L and B/S use the
    // mapping on their own tab if active, else the override.
    const overrideAll = buildFromStructureTree(ovPl, ovBs, "all");
    const overridePL  = (activeMapping && Array.isArray(mapPl) && mapPl.length > 0)
      ? buildFromStructureTree(mapPl, null, "pl")
      : buildFromStructureTree(ovPl, null, "pl");
    const overrideBS  = (activeMapping && Array.isArray(mapBs) && mapBs.length > 0)
      ? buildFromStructureTree(null, mapBs, "bs")
      : buildFromStructureTree(null, ovBs, "bs");

const allTree = overrideAll ? overrideAll.nodes : buildFiltered("", null);
    const plTree  = overridePL ? overridePL.nodes : buildFiltered("P/L", derivedPL);
    const bsTree  = overrideBS ? overrideBS.nodes : buildFiltered("B/S", derivedBS);

// Re-anchor breakers to the tree's actual top-level rows — exactly like the
    // on-screen render. Each section's standard anchor account may be nested (not a
    // top-level row here), so keying the bar on that anchor would drop it. Instead,
    // walk the top-level rows in order and open each section's bar on the FIRST
    // top-level row whose codeToSectionInfo section differs from the previous one.
    // This restores Cost of Sales / Other Operating / Financial Result, whose anchors
    // (A.02 / A.05 / A.14) sit nested under A.04.S / A.13.S / A.21.S.
    const reanchorBreakers = (roots) => {
      if (!codeToSectionInfo || codeToSectionInfo.size === 0) return {};
      const out = {};
      let prevSec = null;
      (roots || []).forEach(n => {
        const info = codeToSectionInfo.get(String(n.AccountCode));
        const sec = info?.section ?? null;
        if (sec && sec !== prevSec) {
          out[n.AccountCode] = { label: info.label ?? sec, color: info.color || "#1a2f8a" };
        }
        if (sec) prevSec = sec;
      });
      return out;
    };
    const stdBreakersAll = overrideAll ? null : reanchorBreakers(allTree);
    const stdBreakersPl  = overridePL ? null : reanchorBreakers(plTree);
    const stdBreakersBs  = overrideBS ? null : reanchorBreakers(bsTree);

    return {
      all: allTree,
      pl:  plTree,
      bs:  bsTree,
      overrideBreakers: {
        all: overrideAll?.breakers ?? stdBreakersAll,
        pl:  overridePL?.breakers ?? stdBreakersPl,
        bs:  overrideBS?.breakers ?? stdBreakersBs,
      },
derivedPL, derivedBS,
    };
}, [rawData, breakerSortOrder, activeMapping, hiddenOverride, codeToStatementFromStd, codeToSectionInfo, codeToParentFromStd, codeToNameFromStd]);

const toggleExpand = useCallback((code) => setExpanded(prev => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next;
  }), []);

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: T(`month_${m}`) }));

  const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;
const baseEffectiveCompanies = useMemo(() => (
    selectedCompanies.length === 0
      ? contributionCompanies
      : contributionCompanies.filter(c => selectedCompanies.includes(c))
  ), [selectedCompanies, contributionCompanies]);

  const effectiveCompanies = useMemo(() => {
    if (colOrder.length === 0) return baseEffectiveCompanies;
    const ordered = colOrder.filter(c => baseEffectiveCompanies.includes(c));
    const rest = baseEffectiveCompanies.filter(c => !ordered.includes(c));
return [...ordered, ...rest];
}, [baseEffectiveCompanies, colOrder]);

return (
   <div className="cs-sheet-root flex flex-col gap-4 h-full min-h-0" style={{
     overflow: "visible",
     // Con el rastro abierto la sábana se estrecha para dejarle sitio
     // El ancho del rastro vive en la variable --cs-trail-w (se arrastra desde el
     // borde del panel); la sábana deja justo ese hueco más 8 px de separación.
     paddingRight: trace ? "calc(var(--cs-trail-w, 560px) + 8px)" : 0,
     transition: "padding-right 420ms cubic-bezier(0.22,1,0.36,1)",
   }}>
<style>{`
        html.cs-trail-resizing .cs-sheet-root { transition: none !important; }
        html.cs-trail-resizing { cursor: col-resize; }
        @keyframes sheetSearchIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
        /* Outer wrapper clips the vertical scrollbar by being narrower than the inner scroller */
        .consolidation-scroll-outer {
          position: relative;
          overflow: hidden;
        }
.consolidation-scroll {
          overflow: auto;
          height: 100%;
          /* Push the vertical scrollbar outside the visible area */
          padding-right: 16px;
          margin-right: -16px;
          /* Isolate layout/paint from the rest of the page so the sidebar
             resize doesn't force the browser to re-measure every cell */
          contain: layout paint style;
          /* Firefox */
          scrollbar-width: thin;
          scrollbar-color: #94a3b8 #f1f5f9;
        }
        .consolidation-scroll-outer {
          contain: layout paint;
        }
.consolidation-scroll::-webkit-scrollbar {
          height: 14px;
          width: 10px;
        }
        .consolidation-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #94a3b8 0%, #64748b 100%);
          border-radius: 7px;
          border: 2px solid #f1f5f9;
        }
        .consolidation-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #64748b 0%, #475569 100%);
        }
.consolidation-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
          border-radius: 7px;
        }
        /* Section dividers — thick vertical accent between Consolidated /
           Eliminations / Contribution sum / Per-company areas */
        .sheet-area-start {
          position: relative;
          border-left: 1px solid rgba(26,47,138,0.20) !important;
        }
        .sheet-area-start::before {
          content: "";
          position: absolute;
          left: -1px;
          top: 0;
          bottom: 0;
          width: 3px;
          background: linear-gradient(180deg, rgba(26,47,138,0.10) 0%, rgba(26,47,138,0.04) 100%);
          pointer-events: none;
          z-index: 1;
        }
        .sheet-area-elim    { background-color: rgba(26,47,138,0.015); }
        .sheet-area-contrib { background-color: rgba(26,47,138,0.025); }
        .sheet-area-cos     { background-color: rgba(26,47,138,0.04); }
        /* Solid background layer under the sticky thead so breaker rows don't
           bleed through the inter-column gaps when scrolling */
        .consolidation-scroll table > thead {
          position: sticky;
          top: 0;
          z-index: 30;
          background: #ffffff;
        }
        .consolidation-scroll table > thead::before {
          content: "";
          position: absolute;
          inset: 0;
          background: #ffffff;
          z-index: -1;
        }
        /* Remove gaps between th cells in the sticky header */
        .consolidation-scroll table > thead > tr > th {
          background-clip: padding-box;
        }
@keyframes cmpColIn  { from { opacity:0; transform:scaleX(0.6); } to { opacity:1; transform:scaleX(1); } }
        @keyframes cmpColOut { from { opacity:1; transform:scaleX(1); } to { opacity:0; transform:scaleX(0.6); } }
        @keyframes sheetIconMorph { 0% { opacity:0; transform: scale(0.4) rotate(-90deg); } 60% { opacity:1; } 100% { opacity:1; transform: scale(1) rotate(0deg); } }
@keyframes sheetRowSlideIn  { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes sheetCellAccordion {
          0%   { opacity: 0; transform: translateY(-10px) scaleY(0.6); filter: blur(2px); }
          60%  { opacity: 0.8; filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scaleY(1); filter: blur(0); }
        }
        @keyframes sheetEmptyIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes sheetOrb1 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(20px,-30px) scale(1.1); } }
        @keyframes sheetOrb2 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(-15px,20px) scale(0.95); } }
        @keyframes sheetSpin  { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
  @keyframes sheetSpinR { from { transform:rotate(0deg); } to { transform:rotate(-360deg); } }
        @keyframes kBadgesPop { 0% { opacity:0; transform:translateY(8px) scale(0.96); } 100% { opacity:1; transform:translateY(0) scale(1); } }
@keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes cmpBarIn { 
          0%   { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 
          100% { opacity: 1; max-height: 80px; padding-top: 12px; padding-bottom: 12px; } 
        }
        @keyframes cmpBarOut { 
          0%   { opacity: 1; max-height: 80px; padding-top: 12px; padding-bottom: 12px; } 
          100% { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; } 
        }
      `}</style>
<PageHeader
kicker={viewsMode ? T("mappings") : T("tab_consolidated")}
        title={viewsMode === "landing" ? T("mappings")
             : viewsMode === "structure" ? T("views_structure_mappings")
             : viewsMode === "report" ? T("views_report_mappings")
             : T("nav_sheet")}
        onBack={viewsMode ? () => {
          if (viewsMode === "landing") setViewsMode(null);
          else setViewsMode("landing");
        } : undefined}
        mappingsQuickAccess={!viewsMode && !headerCompact ? recentMappings : []}
        onQuickApplyMapping={async (m) => {
          const api = await pickMappingApi(mappingTab, m.kind);
          const full = await api.getMapping(m.id);
          handleApplyMapping(full ?? m.raw, m.kind);
        }}
        onMappingsClick={viewsMode || headerCompact ? undefined : (mappingsEnabled ? () => setViewsMode("landing") : undefined)}
tabs={viewsMode ? [] : [
          { id: "",    label: T("all"),          icon: Filter, disabled: !!activeMapping },
          { id: "P/L", label: T("tab_pl"),       icon: TrendingUp },
          { id: "B/S", label: T("tab_bs_short"), icon: BarChart2 },
        ]}
        activeTab={viewsMode ? null : typeFilter}
        onTabChange={viewsMode ? undefined : setTypeFilter}
        filters={viewsMode || headerCompact ? [] : [
...(sources.length > 0
            ? [{ label: T("filter_source"), value: source, onChange: setSource,
                options: sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s })) }]
            : []),
...(availableYears.length > 0
            ? [{ label: T("filter_year"), value: year, onChange: setYear, options: availableYears }]
            : []),
          ...(availableMonths.length > 0
            ? [{ label: T("filter_month"), value: month, onChange: setMonth, options: availableMonths }]
            : []),
          ...(structures.length > 0
            ? [{ label: T("filter_structure"), value: structure, onChange: setStructure,
                options: structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s })) }]
            : []),
...(holdingOptions.length > 1
            ? [{ label: T("filter_perspective"), value: topParent, onChange: (v) => { setPerspectiveCompany(v); setSelectedCompanies([]); setColOrder([]); }, options: holdingOptions }]
            : []),
...(contributionCompanies.length > 1
            ? [{
                label: T("filter_company"),
                multiselect: true,
                values: selectedCompanies.length === 0 ? null : selectedCompanies,
                onChange: (v) => setSelectedCompanies(v ?? []),
                options: contributionCompanies.map(co => ({
                  value: co,
                  label: companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co,
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
currencyToggle={!headerCompact && availableCurrencies.length > 1 ? {
          value: effectiveCurrency,
          options: availableCurrencies.map(c => ({
            value: c,
            label: c === displayCurrency ? `${c} (grupo)` : c
          })),
          onChange: (next) => setSelectedCurrency(next === displayCurrency ? null : next),
        } : null}
periodToggle={!viewsMode && !headerCompact && typeFilter !== "B/S" ? {
          value: ytdOnly ? "ytd" : "monthly",
          onChange: (next) => setYtdOnly(next === "ytd"),
        } : null}
compareToggle={viewsMode || headerCompact ? null : {
          active: compareMode,
          onChange: (newVal) => {
            if (newVal && !compareMode) {
              setCmpYear(year); setCmpMonth(month);
              setCmpSource(source); setCmpStructure(structure);
            }
            setCompareMode(newVal);
          },
        }}
onExportXlsx={headerCompact ? undefined : () => {
          setExportOpts(o => ({ ...o, format: "xlsx" }));
          setExportModal(true);
        }}
        onExportPdf={headerCompact ? undefined : () => {
          setExportOpts(o => ({ ...o, format: "pdf" }));
          setExportModal(true);
        }}
      />



{activeMapping && !viewsMode && (() => {
        const hasPL = !!(activeMapping.plTreeConverted && activeMapping.plTreeConverted.rows.size > 0);
        const hasBS = !!(activeMapping.bsTreeConverted && activeMapping.bsTreeConverted.rows.size > 0);
        const coverageParts = [];
        if (hasPL) coverageParts.push("P/L");
        if (hasBS) coverageParts.push("B/S");
        const coverage = coverageParts.join(" + ") || "—";

        // Is the mapping actually applied to the CURRENT tab right now?
        const appliedToCurrentTab =
          (typeFilter === "P/L" && hasPL) ||
          (typeFilter === "B/S" && hasBS);
        const onUncoveredTab =
          mappingsEnabled && !appliedToCurrentTab;

        return (
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border flex-shrink-0"
          style={{
            background: onUncoveredTab
              ? "linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)"
              : "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            borderColor: onUncoveredTab ? "rgba(234,88,12,0.25)" : "rgba(16,185,129,0.25)",
            boxShadow: onUncoveredTab
              ? "0 2px 8px -2px rgba(234,88,12,0.15)"
              : "0 2px 8px -2px rgba(16,185,129,0.15)",
          }}>
          <div className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
            style={{ background: onUncoveredTab ? "rgba(234,88,12,0.18)" : "rgba(16,185,129,0.18)" }}>
            {onUncoveredTab ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.22em]"
              style={{ color: onUncoveredTab ? "#9a3412" : "#047857", opacity: 0.75 }}>
{onUncoveredTab
                ? `${T("sheet_mapping_covers", "Mapping covers")} ${coverage} · ${T("sheet_mapping_standard_render", "this tab uses standard render")}`
                : `${T("mapping_active")} · ${coverage}`}
            </p>
            <p className="text-sm font-black truncate" style={{ color: onUncoveredTab ? "#7c2d12" : "#064e3b" }}>
              {activeMapping.name} <span className="font-bold opacity-50">· {activeMapping.standard ?? "Custom"} · {activeMapping.kind === "report" ? "Report" : "Structure"}</span>
            </p>
          </div>
<button
            onClick={() => {
              try {
                sessionStorage.setItem("mappings:openForEdit", JSON.stringify({
                  mapping_id: activeMapping.mapping_id,
                  kind: activeMapping.kind ?? "structure",
                }));
              } catch { /* ignore quota errors */ }
              if (typeof onNavigate === "function") {
                onNavigate("mappings");
} else {
                window.location.hash = "#/mappings";
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
        );
      })()}

{viewsMode === "landing" && (
<MappingsLanding
          colors={colors}
          T={T}
          onPickStructure={() => setViewsMode("structure")}
          onPickReport={() => setViewsMode("report")}
        />
      )}
{(viewsMode === "structure" || viewsMode === "report") && (
<MappingsLibrary
          colors={colors}
          T={T}
          kind={viewsMode}
          activeMapping={activeMapping}
          mappings={savedMappings}
          loading={mappingsLoading}
          error={mappingsError}
          onApply={(m) => handleApplyFromCard(m, viewsMode)}
          onClearActive={clearActiveMapping}
          onRetry={() => {
            const m = viewsMode;
            setViewsMode("landing");
            setTimeout(() => setViewsMode(m), 50);
          }}
        />
      )}

{cmpVisible && !viewsMode && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0"
         style={{ overflow: "hidden", animation: cmpExiting ? "cmpBarOut 350ms ease both" : "cmpBarIn 400ms ease both" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("btn_compare_with")}</span>
          </div>
<HeaderFilterPill label={T("filter_source")}    value={cmpSource}    onChange={setCmpSource}
            options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          <HeaderFilterPill label={T("filter_year")}      value={cmpYear}      onChange={setCmpYear}
            options={availableYears} />
          <HeaderFilterPill label={T("filter_month")}     value={cmpMonth}     onChange={setCmpMonth}
            options={availableMonths} />
          <HeaderFilterPill label={T("filter_structure")} value={cmpStructure} onChange={setCmpStructure}
            options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))} />
          {cmpLoading && <div className="w-4 h-4 border-2 border-[#1a2f8a] border-t-transparent rounded-full animate-spin ml-2" />}
        </div>
      )}

{/* ── Accounts view (hidden when in mappings views) ── */}
{!viewsMode && (
<div className="flex-1 min-h-0 flex flex-col">
          <div className="relative bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 flex flex-col" style={{ overflow: "hidden" }}>
            <ProgressLoader
              visible={sheetBusy}
              steps={loaderSteps}
              title={loaderTitle}
              subtitle={`${T("tab_consolidated")} · ${T("nav_sheet")}`}
              detail={loaderDetail}
              failed={!!sheetError}
              primary={colors.primary ?? "#1a2f8a"}
            />
{sheetError ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8 text-center"
                style={{ animation: "sheetEmptyIn 500ms cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl" style={{ background: "#fef2f2", color: "#e11d48" }}>
                  <RefreshCw size={20} />
                </div>
                <p className="font-black" style={{ color: "#0f172a", fontSize: 15 }}>{T("sheet_load_error", "No se han podido cargar los datos")}</p>
                <p style={{ color: "#94a3b8", fontSize: 12 }}>{sheetError}</p>
                <button type="button" onClick={() => (metaError ? setMetaTick(n => n + 1) : setReloadTick(n => n + 1))}
                  className="px-4 py-2 rounded-xl font-black text-white"
                  style={{ background: colors.primary, fontSize: 12, boxShadow: `0 8px 20px -8px ${colors.primary}` }}>
                  {T("btn_retry", "Reintentar")}
                </button>
              </div>
            ) : sheetBusy && rawData.length === 0 ? (
              <div className="flex-1" />
            ) : rawData.length === 0 ? (
              <div className="flex items-center justify-center flex-1 p-8">
                <div className="relative max-w-md w-full text-center"
                  style={{ animation: "sheetEmptyIn 500ms cubic-bezier(0.34,1.56,0.64,1)" }}>

                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                    <div className="absolute" style={{
                      width: 180, height: 180, top: -40, right: -40,
                      background: `radial-gradient(circle, ${colors.primary}12 0%, transparent 70%)`,
                      animation: "sheetOrb1 8s ease-in-out infinite",
                    }} />
                    <div className="absolute" style={{
                      width: 120, height: 120, bottom: -20, left: -20,
                      background: "radial-gradient(circle, rgba(207,48,93,0.10) 0%, transparent 70%)",
                      animation: "sheetOrb2 11s ease-in-out 2s infinite",
                    }} />
                  </div>

                  <div className="relative z-10 p-10 rounded-3xl"
                    style={{
                      background: "linear-gradient(135deg, #ffffff 0%, #fafbff 100%)",
                      border: "1px solid rgba(26,47,138,0.06)",
                      boxShadow: "0 20px 60px -12px rgba(26,47,138,0.08)",
                    }}>

                    <div className="relative mx-auto mb-6" style={{ width: 88, height: 88 }}>
                      <svg width="88" height="88" viewBox="0 0 88 88" className="absolute inset-0">
                        <circle cx="44" cy="44" r="40" fill="none"
                          stroke={`${colors.primary}15`} strokeWidth="1.5"
                          strokeDasharray="4 6"
                          style={{ transformOrigin: "44px 44px", animation: "sheetSpin 20s linear infinite" }} />
                        <circle cx="44" cy="44" r="28" fill="none"
                          stroke={`${colors.primary}25`} strokeWidth="1.5"
                          strokeDasharray="3 5"
                          style={{ transformOrigin: "44px 44px", animation: "sheetSpinR 14s linear infinite" }} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                          style={{
                            background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                            boxShadow: `0 8px 24px -6px ${colors.primary}50, inset 0 1px 0 rgba(255,255,255,0.2)`,
                          }}>
                          <Layers size={20} className="text-white" strokeWidth={2.2} />
                        </div>
                      </div>
                    </div>

<p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
                      style={{ color: colors.primary, opacity: 0.6 }}>
                      {T("contrib_empty_kicker")}
                    </p>

                    <h3 className="font-black text-xl text-gray-800 mb-3 tracking-tight"
                      style={{ letterSpacing: "-0.02em" }}>
                      {T("contrib_empty_title")}
                    </h3>

                    <p className="text-sm text-gray-500 leading-relaxed mb-6">
                      {T("contrib_empty_desc")}
                    </p>

                    <div className="flex flex-col gap-2 mb-6">
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                        style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: `${colors.primary}15`, color: colors.primary }}>
                          <Filter size={13} strokeWidth={2.4} />
                        </div>
                        <div className="flex-1 min-w-0">
<p className="text-xs font-bold text-gray-700">
                            {T("contrib_empty_tip1_title")}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {T("contrib_empty_tip1_desc")}
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
                            {T("contrib_empty_tip2_title")}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {T("contrib_empty_tip2_desc")}
                          </p>
                        </div>
                      </div>

                      {topParent !== rootParent && (
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                          style={{ background: "rgba(207,48,93,0.05)", border: "1px solid rgba(207,48,93,0.10)" }}>
                          <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: "rgba(207,48,93,0.12)", color: "#CF305D" }}>
                            <X size={13} strokeWidth={2.4} />
                          </div>
                          <div className="flex-1 min-w-0">
<p className="text-xs font-bold text-gray-700">
                              {T("sheet_empty_root_title", "Return to root perspective")}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {T("sheet_empty_root_desc", "Select the main holding in the Perspective filter")}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
<button
                      onClick={findPeriodWithData}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                      style={{
                        background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                        color: "white",
                        boxShadow: `0 6px 16px -4px ${colors.primary}40`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
<RefreshCw size={12} strokeWidth={2.6} />
                      {T("contrib_empty_retry")}
                    </button>
                  </div>
                </div>
              </div>
) : (
<div className="consolidation-scroll-outer flex-1 min-h-0" style={{ minWidth: 0 }}>
              <div ref={sheetScrollRef} className="consolidation-scroll" style={{ minWidth: 0 }}>
                <table className={`${sheetStyles.csTable} text-xs`} style={{ "--cs-primary": colors.primary, borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%", tableLayout: "auto" }}>
<thead className="sticky top-0 z-30" style={{ background: "#ffffff" }}>
  <tr style={{ background: "#ffffff", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>

    {/* Account sticky left */}
<th className="sticky left-0 z-40 text-left px-6 border-r border-gray-100"
      style={{ background: "#ffffff", height: 64, minWidth: 340, width: 340 }}>
      <div className="flex items-center justify-between gap-3">
        {searchOpen ? (
          <div className="flex items-center gap-2 flex-1 min-w-0" style={{ animation: "sheetSearchIn 260ms cubic-bezier(0.22,1,0.36,1) both" }}>
            <Search size={15} style={{ color: colors.primary, flexShrink: 0 }} />
            <input ref={searchInputRef} value={search} autoFocus
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") { setSearch(""); setSearchOpen(false); } }}
              placeholder={T("search_account_ph", "Buscar cuenta por código o nombre")}
              className="flex-1 min-w-0 bg-transparent outline-none"
              style={{ color: colors.primary, fontSize: 14, fontWeight: 700 }} />
            <button type="button" onClick={() => { setSearch(""); setSearchOpen(false); }}
              className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
              style={{ background: `${colors.primary}12`, color: colors.primary }} aria-label={T("btn_close", "Cerrar")}>
              <X size={12} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => setSearchOpen(true)} title={T("search_account_ph", "Buscar cuenta por código o nombre")}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ color: `${colors.primary}99` }}
              onMouseEnter={e => { e.currentTarget.style.background = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = `${colors.primary}99`; }}>
              <Search size={15} strokeWidth={2.4} />
            </button>
            <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{T("col_account")}</span>
            <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>{T("nav_sheet")}</span>
          </div>
        )}
{(() => {
          const anyExpanded = expanded.size > 0;
          return (
            <button
              onClick={() => anyExpanded ? setExpanded(new Set()) : setExpanded(new Set([...accountMap.keys()]))}
              title={anyExpanded ? T("btn_collapse_all") : T("btn_expand_all")}
              className="flex items-center justify-center w-8 h-8 rounded-lg relative overflow-hidden"
              style={{
                color: anyExpanded ? colors.primary : "#94a3b8",
                background: "transparent",
                transition: "color 240ms cubic-bezier(0.4,0,0.2,1)",
              }}>
              <span key={anyExpanded ? "collapse" : "expand"}
                className="absolute inset-0 flex items-center justify-center"
                style={{ animation: "sheetIconMorph 360ms cubic-bezier(0.34,1.56,0.64,1)" }}>
                {anyExpanded ? (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3 L13 13" />
                    <path d="M13 3 L3 13" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6 L8 1 L13 6" />
                    <path d="M3 10 L8 15 L13 10" />
                  </svg>
                )}
              </span>
            </button>
          );
        })()}
      </div>
    </th>

{/* Consolidated total */}
    <th className="text-center px-4 border-l border-gray-100" style={{ background: "#ffffff", minWidth: 130 }}>
      <div className="flex flex-col items-center gap-0.5 py-4">
        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>{getLegal(topParent)}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{isRootView ? T("col_consolidated") : T("sheet_subgroup", "Subgroup")}</span>
      </div>
    </th>
{cmpColsVisible && <>
      <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
      </th>
    </>}

{/* Eliminations */}
<th className="text-center px-4 cursor-pointer select-none sheet-area-start sheet-area-elim"
      style={{ minWidth: 110 }}
      onClick={() => setElimExpanded(e => !e)}>
      <div className="flex flex-col items-center gap-0.5 py-4">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>
          {T("sheet_elim", "Elim.")} {elimExpanded ? "▾" : "▸"}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{T("sheet_interco", "Interco")}</span>
      </div>
    </th>
{cmpColsVisible && <>
      <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
      </th>
    </>}
{elimColsVisible && elimHeaders.map((h, hi) => (
      <th key={`elim-head-${h}`} className="text-center px-3"
        style={{
          background: "#f8f9ff",
          borderLeft: "1px solid #e5e7eb",
          minWidth: 140,
          animation: `${elimColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) ${hi * 40}ms both`,
          transformOrigin: "left center",
        }}>
        <div className="flex flex-col items-center gap-0.5 py-4">
          <span className="font-black" style={{ color: colors.primary, fontSize: 11 }} title={h}>{h}</span>
        </div>
      </th>
    ))}

{/* Contribution sum */}
    <th className="text-center px-4 sheet-area-start sheet-area-contrib" style={{ minWidth: 110 }}>
      <div className="flex flex-col items-center gap-0.5 py-4">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>{T("contrib_label")}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{T("sheet_sum", "Sum")}</span>
      </div>
    </th>
{cmpColsVisible && <>
      <th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
      </th>
      <th className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
        <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
      </th>
    </>}

    {/* Per-company columns */}
{effectiveCompanies.map((c, ci) => {
      const isDragging = draggingCol === c;
      const isDragOver = dragOverCol === c && draggingCol !== c;
      const isFirstCompany = ci === 0;
      return (
        <th key={c}
          draggable
          onDragStart={() => setDraggingCol(c)}
          onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
          onDragLeave={() => { if (dragOverCol === c) setDragOverCol(null); }}
          onDrop={e => {
            e.preventDefault();
            if (!draggingCol || draggingCol === c) { setDraggingCol(null); setDragOverCol(null); return; }
            const cols = colOrder.length > 0 ? [...colOrder] : [...effectiveCompanies];
            const from = cols.indexOf(draggingCol);
            const to = cols.indexOf(c);
            if (from === -1 || to === -1) { setDraggingCol(null); setDragOverCol(null); return; }
            const next = [...cols];
            next.splice(from, 1);
            next.splice(to, 0, draggingCol);
            setColOrder(next);
            setDraggingCol(null);
            setDragOverCol(null);
          }}
          onDragEnd={() => { setDraggingCol(null); setDragOverCol(null); }}
className={`text-center px-3 select-none cursor-grab sheet-area-cos ${isFirstCompany ? "sheet-area-start" : ""}`}
          style={{
            background: isDragOver ? `${colors.primary}15` : undefined,
            borderLeft: isFirstCompany ? undefined : "1px solid #f0f0f0",
            minWidth: 140,
            opacity: isDragging ? 0.4 : 1,
            outline: isDragOver ? `2px solid ${colors.primary}` : "none",
            transition: "background 150ms ease, outline 150ms ease",
          }}>
          <div className="flex flex-col items-center gap-0.5 py-4">
            <span className="font-black tracking-tight truncate max-w-[120px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} title={getLegal(c)}>{getLegal(c)}</span>
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{displayCurrency}</span>
          </div>
        </th>
      );
    }).flatMap((companyTh, ci) => {
      const c = effectiveCompanies[ci];
      if (!cmpColsVisible) return [companyTh];
      return [
        companyTh,
        <th key={`${c}-cmp`} className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 60ms both`, transformOrigin: "left center" }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
        </th>,
        <th key={`${c}-delta`} className="text-center px-3" style={{ background: `${colors.primary}12`, minWidth: 110, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 80ms both`, transformOrigin: "left center" }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
        </th>,
        <th key={`${c}-pct`} className="text-center px-3" style={{ background: `${colors.primary}1e`, minWidth: 80, animation: `${cmpColsExiting ? "cmpColOut" : "cmpColIn"} 320ms cubic-bezier(0.34,1.56,0.64,1) 100ms both`, transformOrigin: "left center" }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
</th>,
      ];
    })}
  </tr>
</thead>
<tbody>
{(() => {
  // Re-anchor custom-no-user breakers to the tree's actual top-level rows.
  // The `breakers` map keys each section on the standard's first account_code,
  // which may be nested (not a top-level node here) — so those bars never paint.
  // Walk the top-level nodes in order and open each section's bar on the FIRST
  // top-level node whose codeToSectionInfo section differs from the previous one.
  const reanchored = {};
  const isCustomStdRender = activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-");
  const usesStateBreakers = !mappingBreakersOverride && !mappingDerived?.breakers;
  if (isCustomStdRender && usesStateBreakers && codeToSectionInfo && codeToSectionInfo.size > 0) {
    let prevSec = null;
    for (const n of tree) {
      const info = codeToSectionInfo.get(String(n.AccountCode));
      const sec = info?.section ?? null;
      if (sec && sec !== prevSec) {
        reanchored[n.AccountCode] = { label: info.label ?? sec, color: info.color || "#1a2f8a" };
      }
      if (sec) prevSec = sec;
    }
  }
  // Buscador: filas que coinciden y sus antepasados (para llegar a ellas)
  const q = search.trim().toLowerCase();
  let searchVisible = null, searchMatch = null, searchExpanded = null;
  if (q) {
    searchVisible = new Set(); searchMatch = new Set(); searchExpanded = new Set();
    const walk = (n, ancestors) => {
      const key = n._instanceId ?? n.AccountCode;
      const hit = `${n.AccountCode ?? ""} ${n.AccountName ?? ""}`.toLowerCase().includes(q);
      let any = hit;
      (n.children ?? []).forEach(c => { if (walk(c, [...ancestors, key])) any = true; });
      if (hit) searchMatch.add(key);
      if (any) { searchVisible.add(key); ancestors.forEach(k => { searchVisible.add(k); searchExpanded.add(k); }); }
      return any;
    };
    tree.forEach(n => walk(n, []));
  }
  return tree.map((node, i) => {
    if (searchVisible && !searchVisible.has(node._instanceId ?? node.AccountCode)) return null;
  const type = node.AccountType ?? "";
  const prevType = i > 0 ? (tree[i-1].AccountType ?? "") : null;
  const typeChanged = type !== prevType;
  const reanchoredBreaker = reanchored[node.AccountCode] ?? null;
  const TYPE_LABEL_COLORS = {
    "P/L": colors.primary,
    "DIS": colors.primary,
    "B/S": "#CF305D",
    "C/F": "#374151",
    "CFS": "#374151",
  };
const TYPE_LABELS_LOCAL = {
    "P/L": { label: T("export_section_pl") },
    "DIS": { label: T("contrib_dist_result") },
    "B/S": { label: T("export_section_bs") },
    "C/F": { label: T("nav_cashflow") },
    "CFS": { label: T("nav_cashflow") },
  };
  const TYPE_LABELS = TYPE_LABELS_LOCAL[type]
    ? { ...TYPE_LABELS_LOCAL, [type]: { ...TYPE_LABELS_LOCAL[type], color: TYPE_LABEL_COLORS[type] } }
    : TYPE_LABELS_LOCAL;
// When a mapping is active, ONLY use mapping-defined breakers. Type-change
  // dividers (Profit & Loss / Distribution of Result / Balance Sheet) are
  // standard-render fallbacks — they should NOT appear when the mapping
  // owns the structure, since the mapping might intentionally put DIS codes
  // somewhere other than "Distribution of Result".
const effectiveBreakers = mappingBreakersOverride ?? mappingDerived?.breakers ?? breakers;
  // When mapping is active with instances, look up breaker by instanceId;
  // otherwise fall back to account code (standard render).
  const breakerKey = node._instanceId ?? node.AccountCode;
  const mappingBreaker = effectiveBreakers[breakerKey] ?? null;
  // When the override or a mapping owns the structure, ONLY its breakers may
  // show — never the standard type-dividers (Profit & Loss / Distribution of
  // Result / Balance Sheet), which belong to a different structure entirely.
// Custom standards (Genesal etc.) own their structure via codeToSectionInfo, so the
  // generic type-dividers (Profit & Loss / Distribution of Result / Balance Sheet) must
  // not appear — they're a legacy-standard fallback and would inject a stray "Distribution
  // of Result" breaker whenever a DIS-typed account follows the P/L accounts.
  const isCustomStdRender = activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-");
  const structureOwned = !!mappingBreakersOverride || !!mappingDerived || isCustomStdRender;
const breaker = structureOwned
    ? (mappingBreaker || reanchoredBreaker)
    : (mappingBreaker || (typeChanged && TYPE_LABELS[type] ? TYPE_LABELS[type] : null));
const totalCols = 1 // account col
    + 1 + (compareMode ? 3 : 0) // consolidated
    + 1 + (compareMode ? 3 : 0) // eliminations
    + (elimExpanded ? elimHeaders.length : 0) // elim sub-cols
    + 1 + (compareMode ? 3 : 0) // contribution sum
    + effectiveCompanies.length * (compareMode ? 4 : 1); // per-company
  return (
   <React.Fragment key={node._instanceId ?? node.AccountCode}>
{breaker && <BreakerRow label={breaker.label} color={breaker.color} colSpan={totalCols} />}
      {!node._breakerOnly && (
<SheetRow node={node} depth={0}
        rowIndex={i}
        onTrace={handleTrace} tracedCode={trace?.AccountCode ?? null} traceLabel={T("trail_open", "Rastro del dato")}
        searchVisible={searchVisible} searchMatch={searchMatch}
        expanded={searchExpanded ?? expanded} onToggle={toggleExpand}
        pivot={pivot} uploadedPivot={uploadedPivot} elimPivot={elimPivot}
pivotPrev={pivotPrev} ytdOnly={ytdOnly}
        getRowAmount={getRowAmount}
        contributionCompanies={effectiveCompanies}
        topParent={topParent}
        elimExpanded={elimColsVisible} elimHeaders={elimHeaders}
        elimColsExiting={elimColsExiting}
compareMode={cmpColsVisible} cmpPivot={cmpPivot} cmpPivotPrev={cmpPivotPrev}
        body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
colors={colors} cmpColsExiting={cmpColsExiting} cmpColsVisible={cmpColsVisible}
        rowMatchesDims={rowMatchesDims} />
      )}
</React.Fragment>
  );
  });
})()}
</tbody>
                </table>
              </div>
              </div>
)}
          </div>
</div>
)}
{/* ── Export modal ──────────────────────────────────────────────── */}
      {exportModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            animation: "kBadgesPop 280ms cubic-bezier(0.34,1.56,0.64,1)",
          }}
          onClick={() => setExportModal(false)}>
          <div className="bg-white w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{
              borderRadius: 28,
              boxShadow: `0 30px 80px -12px ${colors.primary}40, 0 12px 24px -6px rgba(0,0,0,0.12)`,
              animation: "plRowSlideIn 340ms cubic-bezier(0.34,1.56,0.64,1)",
            }}>

{/* Header — branded banner */}
            <div className="relative flex-shrink-0 px-7 pt-7 pb-6 overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 52%, #CF305D 168%)` }}>
              <div className="absolute inset-0 pointer-events-none"
                style={{ backgroundImage: "radial-gradient(circle at 88% 10%, rgba(255,255,255,0.18) 0%, transparent 42%)" }} />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.16)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)", backdropFilter: "blur(6px)" }}>
                    <Download size={19} strokeWidth={2.5} color="white" />
                  </div>
                  <div>
                    <h2 className="font-black text-white" style={{ fontSize: 21, letterSpacing: "-0.02em" }}>
                      {T("export_report")}
                    </h2>
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md text-white"
                        style={{ background: "rgba(255,255,255,0.18)" }}>
                        {exportOpts.format === "pdf" ? T("badge_pdf") : T("badge_excel")}
                      </span>
                      {compareMode && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md text-white"
                          style={{ background: "rgba(255,255,255,0.18)" }}>
                          {T("badge_compare")}
                        </span>
                      )}
                      {activeMapping && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md text-white"
                          style={{ background: "rgba(16,185,129,0.38)" }}>
                          {T("badge_mapped")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => setExportModal(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-[1.05] text-white"
                  style={{ background: "rgba(255,255,255,0.14)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.28)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}>
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-6" style={{ scrollbarWidth: "none" }}>
              {/* Primary period */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_primary_period")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="flex gap-3 p-3 rounded-2xl border"
                  style={{ borderColor: `${colors.primary}25`, background: `linear-gradient(135deg, ${colors.primary}08 0%, ${colors.primary}03 100%)` }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-black"
                    style={{ background: colors.primary, boxShadow: `0 4px 12px -2px ${colors.primary}50` }}>A</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: colors.primary }}>{T("period_a")}</span>
                      <span className="text-xs font-bold text-gray-700">
                        {T(`month_${Number(month)}`)} {year}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {[source, structure, getLegal(topParent), displayCurrency].filter(Boolean).map((tag, i) => (
                        <span key={i} className="text-[10px] font-semibold text-gray-600 px-2 py-0.5 rounded-md bg-white/60 border border-gray-100">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Compare period */}
              {compareMode && cmpYear && cmpMonth && (
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("btn_compare_with")}</p>
                    <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                  </div>
                  <div className="flex gap-3 p-3 rounded-2xl border"
                    style={{ borderColor: "#CF305D25", background: "linear-gradient(135deg, #CF305D08 0%, #CF305D03 100%)" }}>
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-black"
                      style={{ background: "#CF305D", boxShadow: "0 4px 12px -2px #CF305D50" }}>B</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                       <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("period_b")}</span>
                        <span className="text-xs font-bold text-gray-700">
                         {T(`month_${Number(cmpMonth)}`)} {cmpYear}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {[cmpSource, cmpStructure].filter(Boolean).map((tag, i) => (
                          <span key={i} className="text-[10px] font-semibold text-gray-600 px-2 py-0.5 rounded-md bg-white/60 border border-gray-100">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sheets to include */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_statements_to_include")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
{ key: "sheetAll", label: T("all"), accent: colors.primary },
                    { key: "sheetPL",  label: T("export_section_pl"), accent: colors.primary },
                    { key: "sheetBS",  label: T("export_section_bs"), accent: "#CF305D" },
                  ].map(opt => {
                    const checked = !!exportOpts[opt.key];
                    return (
                      <label key={opt.key}
                        className="flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${opt.accent}40` : "#f3f4f6", background: checked ? `${opt.accent}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [opt.key]: !o[opt.key] }))}>
                        <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? opt.accent : "transparent", borderColor: checked ? opt.accent : "#d1d5db" }}>
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 8 8">
                              <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xs font-bold text-gray-700">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Options */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                 <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("export_layout_options")}</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
<div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "drillDown",  label: T("export_opt_drilldown"), desc: T("export_opt_drilldown_desc", "Expande cada subcuenta. Off = resumen de primer nivel."), accent: colors.primary },
                    { key: "elimDetail", label: T("sheet_opt_elim_breakdown", "Elim. breakdown"), desc: T("export_opt_elim_desc", "Una columna por diario de eliminación."), accent: "#4B5563" },
                  ].map(opt => {
                    const checked = !!exportOpts[opt.key];
                    return (
                      <button key={opt.key} type="button"
                        className="text-left p-3 rounded-xl border transition-all hover:shadow-sm"
                        style={{ borderColor: checked ? `${opt.accent}55` : "#f3f4f6", background: checked ? `${opt.accent}08` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [opt.key]: !o[opt.key] }))}>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                            style={{ background: checked ? opt.accent : "transparent", borderColor: checked ? opt.accent : "#d1d5db" }}>
                            {checked && (
                              <svg width="8" height="8" viewBox="0 0 8 8">
                                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                              </svg>
                            )}
                          </div>
                          <span className="text-[11px] font-bold text-gray-700 leading-tight">{opt.label}</span>
                        </div>
                        <p className="text-[9.5px] text-gray-400 leading-snug mt-1.5">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-7 py-5 flex items-center gap-3 flex-shrink-0"
              style={{ background: "linear-gradient(180deg, transparent 0%, #f9fafb 100%)" }}>
              <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}>
               {[["xlsx", T("export_excel")], ["pdf", T("export_pdf")]].map(([f, l]) => (
                  <button key={f} onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                    className="relative z-10 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors duration-200"
                    style={{
                      background: exportOpts.format === f ? "white" : "transparent",
                      color: exportOpts.format === f ? colors.primary : "#9ca3af",
                      boxShadow: exportOpts.format === f ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              <button
                onClick={async () => {
                  const views = [];
                  if (exportOpts.sheetAll) views.push("all");
                  if (exportOpts.sheetPL)  views.push("pl");
                  if (exportOpts.sheetBS)  views.push("bs");
                 if (views.length === 0) { alert(T("sheet_pick_one_alert", "Pick at least one sheet.")); return; }

try {
const monthLabel = T(`month_${Number(month)}`, String(month));
                    const cmpMoLabel = T(`month_${Number(cmpMonth)}`, String(cmpMonth));
                    const L = {
                      code: T("exp_col_code"), account: T("exp_col_account"), cmp: T("exp_col_cmp"),
                      delta: "Δ", deltaPct: "Δ%",
                      elimTotal: T("exp_col_elim_total"), contribSum: T("exp_col_contrib_sum"),
                      bandAccount: T("exp_band_account"), bandConsolidated: T("exp_band_consolidated"),
                      bandSubgroup: T("exp_band_subgroup"), bandEliminations: T("exp_band_eliminations"),
                      bandContribSum: T("exp_band_contrib_sum"), bandPerCompany: T("exp_band_per_company"),
                      grpConsolidated: T("exp_grp_consolidated"), grpEliminations: T("exp_grp_eliminations"),
                      grpPerCompany: T("exp_grp_per_company"),
                      sheetConsolidated: T("exp_sheet_consolidated"), sheetSubgroup: T("exp_sheet_subgroup"),
                      sheetWord: T("exp_sheet_word"),
                      viewAll: T("exp_view_all"), viewPL: T("exp_view_pl"), viewBS: T("exp_view_bs"),
                      reportTitle: T("exp_report_title"), contents: T("exp_contents"), part: T("exp_part"),
                      ctxSource: T("exp_ctx_source"), ctxStructure: T("exp_ctx_structure"), ctxMapping: T("exp_ctx_mapping"),
                      ctxVs: T("exp_ctx_vs"), ctxGenerated: T("exp_ctx_generated"),
                      comparedWith: T("exp_compared_with"), footerIndex: T("exp_footer_index"),
                      types: {
                        "P/L": T("exp_type_pl"), "DIS": T("exp_type_dis"),
                        "B/S": T("exp_type_bs"), "C/F": T("exp_type_cf"), "CFS": T("exp_type_cf"),
                      },
                    };
                    const sharedArgs = {
                      pivot, elimPivot, elimHeaders,
                      effectiveCompanies, topParent, rootParent,
                      getLegal, isRootView, displayCurrency,
                      source, structure, year, month, monthLabel,
compareMode: cmpColsVisible, cmpPivot, cmpPivotPrev, cmpYear, cmpMonth, cmpMoLabel,
pivotPrev, ytdOnly,
rowMatchesDims,
                      getRowAmount,
                      L,
                      activeMapping,
                      mappingDerivedAll: exportTrees.overrideBreakers?.all
                        ? { breakers: exportTrees.overrideBreakers.all }
                        : null,
                      mappingDerivedPL: exportTrees.overrideBreakers?.pl
                        ? { breakers: exportTrees.overrideBreakers.pl }
                        : exportTrees.derivedPL,
                      mappingDerivedBS: exportTrees.overrideBreakers?.bs
                        ? { breakers: exportTrees.overrideBreakers.bs }
                        : exportTrees.derivedBS,
                      treeAll: exportTrees.all,
                      treePL:  exportTrees.pl,
                      treeBS:  exportTrees.bs,
                      colors,
                      perspectiveLegal: getLegal(topParent),
views,
                      drillDown:  !!exportOpts.drillDown,
                      elimDetail: !!exportOpts.elimDetail,
                      isCustomStd: !!(activeStandardKey && String(activeStandardKey).startsWith("CUSTOM-")),
                    };
                    if (exportOpts.format === "pdf") {
                      await generateSheetPdf(sharedArgs);
                    } else {
                      await generateSheetXlsxMulti({ ...sharedArgs, rawData });
                    }
                    setExportModal(false);
} catch {
                    alert(T("export_failed_alert", "Export failed"));
                  }
                }}
                className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03]"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 100%)`,
                  color: "white",
                  boxShadow: `0 8px 20px -6px ${colors.primary}80, 0 2px 6px -2px ${colors.primary}40`,
                }}>
<Download size={13} strokeWidth={2.5} />
                {T("btn_download")}
              </button>
            </div>
          </div>
        </div>
      )}

      {trace && (
        <ConsolidationTrail
          token={token}
          account={trace}
          root={topParent}
          year={year}
          month={month}
          source={source}
          structure={structure}
          ytdOnly={ytdOnly}
          companies={companies}
          consRoot={rawData}
          consRootPrev={rawDataPrev}
          uploaded={uploadedData}
          journals={journalData}
          colors={colors}
          T={T}
          onClose={() => setTrace(null)}
        />
      )}
      </div>
  );
}