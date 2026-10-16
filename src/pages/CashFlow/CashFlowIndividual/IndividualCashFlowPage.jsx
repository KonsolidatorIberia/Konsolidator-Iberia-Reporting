/* ══════════════════════════════════════════════════════════════════════
   Cash flow individual — página.

   Reconstrucción del cash flow por sociedad como la medida
   [Importe Individual CF] del Power BI "Cockpit": cada cuenta de grupo
   mapeada en mapped-cashflow-accounts aporta su AmountYTD a su línea de
   cash flow, con signo de presentación (×−1 en patrimonio/pasivo y
   resultados) y el árbol de líneas del plan de cuentas.

   Estructura:
     CashFlowIndividual/IndividualCashFlowPage.jsx → estado, datos, exportaciones y maquetación
     shared/CashFlowTable.jsx    → la tabla (cabecera, secciones, filas, desglose)
     shared/CashFlowParts.jsx    → indicador de carga y modal de exportación
     shared/cashFlowUtils.js     → formato, parseo y conversores (sin React)
     shared/CashFlow.module.css  → estilos
   Las piezas de shared/ las usa también el cash flow consolidado.
   ══════════════════════════════════════════════════════════════════════ */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { Loader2, Layers, FileText, Library, CheckCircle2, Pencil, X } from "lucide-react";
import { useTypo, useSettings } from "../../../components/layout/SettingsContext";
import PageHeader, { FilterPill as HeaderFilterPill } from "../../../components/layout/PageHeader.jsx";
import { useCurrentUserResourceAccess } from "../../../lib/userPermissionsApi";
import { t } from "../../../lib/i18n";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import {
  BASE, MONTHS, parseDimensionsField, rowMatchesDimMulti, parseAmt, fetchJson,
  repairCfXlsx, convertCfMappingTree, buildCfMappingLiteral,
  isMultiSelection, periodsKey, closesNeeded, sumPeriodRows,
} from "../shared/cashFlowUtils.js";
import CashFlowTable, { buildCfItems, makeDrillCache, makeCmpCache, underlyingCodes, deltaText, pctText } from "../shared/CashFlowTable.jsx";
import { CfLoadingSpinner, CashFlowExportModal, CfMonthsPill, CfMultiLoader, cfPeriodsText, useCfText } from "../shared/CashFlowParts.jsx";
import styles from "../shared/CashFlow.module.css";

/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */
export default function IndividualCashFlowPage({ token, onNavigate, activeStandardKey = null }) {
const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const subbody1Style = useTypo("subbody1");
  const { colors, locale } = useSettings();
  const T = useCallback((k, fb) => t(locale, k, fb), [locale]);
const { access: resourceAccess } = useCurrentUserResourceAccess();

  const [periods,        setPeriods]        = useState([]);
  const [sources,        setSources]        = useState([]);
  const [structures,     setStructures]     = useState([]);
  const [companies,      setCompanies]      = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);
  const [cfMapping,      setCfMapping]      = useState([]);
  const [groupAccountsCf, setGroupAccountsCf] = useState([]); // plan de cuentas: signo y árbol del cash flow
  const [loadError,      setLoadError]      = useState(false); // falló la carga (red, sesión, tiempo)
  const [reloadKey,      setReloadKey]      = useState(0);     // sube para reintentar

const [pgcCfMapping,           setPgcCfMapping]           = useState(null);
  const [danishIfrsCfMapping,    setDanishIfrsCfMapping]    = useState(null);
  const [spanishIfrsEsCfMapping, setSpanishIfrsEsCfMapping] = useState(null);
  const [customCfMapping,        setCustomCfMapping]        = useState(null);

  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  // ── Multiperiodo: varios meses y años sumados (como Individuales) ──────
  // [{ year: "2026", months: [7, 8, 9] }, …]; con un solo mes, todo como siempre
  const [multiPeriods, setMultiPeriods] = useState([]);
  const multiOn = isMultiSelection(multiPeriods);
  const cfTx = useCfText();
  const multiPeriodText = multiOn ? cfPeriodsText(multiPeriods, cfTx.months) : "";
  const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("DefaultStructure");
const [selectedCompanies, setSelectedCompanies] = useState(null);
const [upDimGroups, setUpDimGroups] = useState(null);
  const [upDimensions, setUpDimensions] = useState(null);
  const [dimensionsMeta, setDimensionsMeta] = useState([]);

const [uploadedData,   setUploadedData]   = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [loading,        setLoading]        = useState(false);
  // true cuando termina la primera carga de datos (con o sin datos). Hasta
  // entonces el indicador no se retira: antes, entre "metadatos listos" y
  // "empieza la carga de datos" había un instante sin indicador (el salto
  // hacia el 50-60 %) y el indicador volvía a montarse.
  const [firstLoadDone,  setFirstLoadDone]  = useState(false);
  const [metaReady,      setMetaReady]      = useState(false);

const autoPeriodDone = useRef(false);

  /* ─── Plan de cuentas (signo y árbol del cash flow), en paralelo y sin
     bloquear la carga de la página ──────────────────────────────── */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${BASE}/group-accounts`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => d.value || d || [])
      .then(ga => { if (!cancelled) setGroupAccountsCf(Array.isArray(ga) ? ga : []); })
      .catch(err => console.error("Cash flow individual: no se pudo cargar group-accounts", err));
    return () => { cancelled = true; };
  }, [token]);

  /* ─── Metadata ─────────────────────────────────────────────────────
     Cada petición tiene tiempo máximo y valor por defecto: si una falla o
     tarda (red, sesión caducada, API lenta) la página sigue y deja de
     esperar. Antes un solo fallo dejaba la carga colgada en el 95 %. */
  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    // Cada lista se reintenta (hasta 3 veces) si la petición falla o llega
    // vacía: sin fuentes ni estructuras la página no puede filtrar ni activar
    // la comparación (era la causa de que a veces no dejara comparar).
    const get = async (path, { retryEmpty = false } = {}) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (ctrl.signal.aborted) return [];
        try {
          const res = await fetchJson(`${BASE}/${path}`, { token, signal: ctrl.signal });
          const list = Array.isArray(res) ? res : [];
          if (list.length || !retryEmpty) return list;
        } catch { /* reintento */ }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
      return [];
    };
    (async () => {
      try {
        const [p, s, st, co, gs, cf, dims] = await Promise.all([
          get("periods", { retryEmpty: true }), get("sources", { retryEmpty: true }), get("structures", { retryEmpty: true }), get("companies"),
          get("group-structure"), get("mapped-cashflow-accounts"), get("dimensions"),
        ]);
        if (ctrl.signal.aborted) return;
        const arr = (x) => (Array.isArray(x) ? x : []);
        const pp = arr(p), stt = arr(st);
        setPeriods(pp); setSources(arr(s)); setStructures(stt); setCompanies(arr(co));
        setGroupStructure(arr(gs));
        setCfMapping(arr(cf));
        setDimensionsMeta(arr(dims));
        if (!pp.length || !stt.length) { setLoadError(true); setFirstLoadDone(true); }

        const structureNames = stt.map(x => x.GroupStructure ?? x);
        const defaultFlagged = stt.find(x => x.IsDefault === true || x.isDefault === true)?.GroupStructure;
        let chosenStructure;
        if (structureNames.includes("DefaultStructure")) chosenStructure = "DefaultStructure";
        else if (defaultFlagged) chosenStructure = defaultFlagged;
        else if (structureNames.length > 0) chosenStructure = structureNames[0];
        if (chosenStructure) setStructure(chosenStructure);

        const latest = pp
          .filter(x => x.Source === "Actual" && x.Closed === true)
          .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0]
          ?? pp
          .filter(x => x.Source === "Actual")
          .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0];
        if (latest) { setYear(String(latest.Year)); setMonth(String(latest.Month)); setSource("Actual"); }
      } catch (err) {
        if (!ctrl.signal.aborted) { console.error("Cash flow individual: error en metadatos", err); setLoadError(true); setFirstLoadDone(true); }
      } finally {
        if (!ctrl.signal.aborted) setMetaReady(true);
      }
    })();
    return () => ctrl.abort();
  }, [token, reloadKey]);

  /* ─── Detect standard ─────────────────────────────────────────── */
  const cfStandard = useMemo(() => {
    const allMappingCodes = cfMapping.map(m => String(m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? "")).filter(Boolean);
    const allMappingSums  = cfMapping.map(m => String(m.cashFlowAccountSumAccountCode ?? m.CashFlowAccountSumAccountCode ?? "")).filter(Boolean);

    if (allMappingCodes.some(c => /^CF\./.test(c))) return "pgc";
    if (allMappingSums.some(c  => /^CF\./.test(c))) return "pgc";
    if (allMappingSums.some(c => /^6\d{3}$/.test(c))) return "danish_ifrs";
    if (allMappingSums.some(c => /^4(21|22)\d$/.test(c))) return "danish_ifrs";
    if (allMappingCodes.some(c => /^\d{4}$/.test(c))) return "spanish_ifrs_es";
    return null;
  }, [cfMapping]);

const loadCfStandardMapping = (table_rows, table_sections, setter) => {
    const SB_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SB_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    let sbToken = SB_APIKEY;
    try {
      const key = "sb-gmcawsapzkzmgrtiqebv-auth-token";
      const parsed = key ? JSON.parse(localStorage.getItem(key)) : null;
      sbToken = parsed?.access_token ?? parsed?.data?.session?.access_token ?? SB_APIKEY;
    } catch { /* fall back to publishable */ }
    const sb = { apikey: SB_APIKEY, Authorization: `Bearer ${sbToken}` };
    Promise.all([
      fetch(`${SB_URL}/${table_rows}?select=*&order=sort_order.asc`,    { headers: sb }).then(r => r.json()),
      fetch(`${SB_URL}/${table_sections}?select=*&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
        // Preserve parent_code + account_name so buildTree() can use them uniformly
        // across CUSTOM and legacy standards. If the legacy table doesn't carry
        // these columns, both fall through to "" harmlessly.
        parent_code: r.parent_code ? String(r.parent_code) : "",
        account_name: r.account_name ?? "",
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setter({ rows, sections });
    }).catch(() => setter(null));
  };

  // Loader for CUSTOM standards — uses the unified standard_statement_*
  // tables filtered by (standard_key, statement=CF).
  const loadCustomCfMapping = (standardKey, setter) => {
    const SB_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SB_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    let sbToken = SB_APIKEY;
    try {
      const key = "sb-gmcawsapzkzmgrtiqebv-auth-token";
      const parsed = key ? JSON.parse(localStorage.getItem(key)) : null;
      sbToken = parsed?.access_token ?? parsed?.data?.session?.access_token ?? SB_APIKEY;
    } catch { /* fall back to publishable */ }
    const sb = { apikey: SB_APIKEY, Authorization: `Bearer ${sbToken}` };
    Promise.all([
      fetch(`${SB_URL}/standard_statement_rows?select=*&standard_key=eq.${encodeURIComponent(standardKey)}&statement=eq.CF&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
      fetch(`${SB_URL}/standard_statement_sections?select=*&standard_key=eq.${encodeURIComponent(standardKey)}&statement=eq.CF&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
      rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
        parent_code: r.parent_code ? String(r.parent_code) : "",
        account_name: r.account_name ?? "",
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setter({ rows, sections });
    }).catch(() => setter(null));
  };

// When a CUSTOM standard is bound, it takes priority. Legacy sniff (cfStandard)
  // still runs as fallback for clients on PGC / DanishIFRS / SpanishIFRS-ES.
  const isCustomStandard = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");

useEffect(() => {
    if (!isCustomStandard) { setCustomCfMapping(null); return; }
    loadCustomCfMapping(activeStandardKey, setCustomCfMapping);
  }, [activeStandardKey, isCustomStandard]);
  useEffect(() => {
    if (isCustomStandard || cfStandard !== "pgc") { setPgcCfMapping(null); return; }
    loadCfStandardMapping("pgc_cf_rows", "pgc_cf_sections", setPgcCfMapping);
  }, [cfStandard, isCustomStandard]);
  useEffect(() => {
    if (isCustomStandard || cfStandard !== "danish_ifrs") { setDanishIfrsCfMapping(null); return; }
    loadCfStandardMapping("danish_ifrs_cf_rows", "danish_ifrs_cf_sections", setDanishIfrsCfMapping);
  }, [cfStandard, isCustomStandard]);
  useEffect(() => {
    if (isCustomStandard || cfStandard !== "spanish_ifrs_es") { setSpanishIfrsEsCfMapping(null); return; }
    loadCfStandardMapping("spanish_ifrs_es_cf_rows", "spanish_ifrs_es_cf_sections", setSpanishIfrsEsCfMapping);
  }, [cfStandard, isCustomStandard]);

// CUSTOM wins; then sniffed built-in.
  const activeCfMapping = customCfMapping ?? pgcCfMapping ?? danishIfrsCfMapping ?? spanishIfrsEsCfMapping;

  // For a CUSTOM standard there is no user "cf_tree", so build a cfLiteral
  // (sections → nested nodes) from the flat standard_statement_rows using
  // parent_code. This routes CUSTOM through the hierarchical MappedSheetRow
  // renderer (same as user mappings) instead of the flat SheetRow branch,
  // so children nest under their parents and only show when expanded.
  const customCfLiteral = useMemo(() => {
    if (!customCfMapping?.rows || !customCfMapping?.sections) return null;
const rows = customCfMapping.rows;
    // Build children index by parent_code (only within the mapping). A node is
    // a "section root" when its parent is missing OR the parent lives in a
    // different section (e.g. the grand-total nodes CF.D1s/E1s/F1s have
    // section=null and sit above the per-section sums). Those roots anchor each
    // section; everything else nests under its parent within the same section.
    const childrenOf = new Map();
    const roots = [];
    const sameSectionParent = (info) => {
      const p = info.parent_code;
      if (!p || !rows.has(p)) return null;
      const pInfo = rows.get(p);
      return pInfo.section === info.section ? p : null;
    };
    [...rows.entries()]
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .forEach(([code, info]) => {
        const parent = sameSectionParent(info);
        if (parent) {
          if (!childrenOf.has(parent)) childrenOf.set(parent, []);
          childrenOf.get(parent).push(code);
        } else {
          roots.push(code);
        }
      });
    const buildNode = (code, depth, seen = new Set()) => {
      if (seen.has(code) || depth > 40) return null;
      seen.add(code);
      const info = rows.get(code);
      const kids = (childrenOf.get(code) || [])
        .map(c => buildNode(c, depth + 1, seen))
        .filter(Boolean);
      return {
        id: code,
        code,
        name: info?.account_name || "",
        isSum: !!info?.isSum,
        depth,
        children: kids,
      };
    };
    // Group roots by section, preserving section order + sortOrder.
    const bySec = new Map();
    roots.forEach(code => {
      const sec = rows.get(code)?.section || "_default";
      if (!bySec.has(sec)) bySec.set(sec, []);
      bySec.get(sec).push(code);
    });
const out = [];
    const usedSecs = new Set();
    customCfMapping.sections.forEach((secInfo, secCode) => {
      const codes = bySec.get(secCode);
      if (!codes || codes.length === 0) return;
      usedSecs.add(secCode);
      out.push({
        label: secInfo.label || "",
        color: secInfo.color || "#1a2f8a",
        nodes: codes.map(c => buildNode(c, 0)).filter(Boolean),
      });
    });
    // Roots whose section has no breaker (e.g. the closing totals CF.D1s /
    // CF.E1s / CF.F1s carry section=null). Append them with no section bar
    // (label null) so they render flat at the end, as intended.
    const looseNodes = [];
    bySec.forEach((codes, secCode) => {
      if (usedSecs.has(secCode)) return;
      codes.forEach(rootCode => {
        const node = buildNode(rootCode, 0);
        if (node) looseNodes.push(node);
      });
    });
    if (looseNodes.length > 0) {
      out.push({ label: null, color: null, nodes: looseNodes });
    }
    return out.length > 0 ? out : null;
  }, [customCfMapping]);

// Probe removed — the data fetch itself walks back if it returns empty.

  /* ─── Companies under selected structure ─────────────────────── */
const contributionCompanies = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.companyShortName ?? g.CompanyShortName ?? "",
      structure: g.groupStructure   ?? g.GroupStructure   ?? "",
      detached:  g.detached         ?? g.Detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    return gsRows
      .map(g => g.company)
      .filter(Boolean)
      .sort((a, b) => {
        const lA = companies.find(c => c.CompanyShortName === a)?.CompanyLegalName || a;
        const lB = companies.find(c => c.CompanyShortName === b)?.CompanyLegalName || b;
        return lA.localeCompare(lB, "es", { sensitivity: "base" });
      });
  }, [groupStructure, structure, companies]);

  // ── Resource-access gating ───────────────────────────────────
  const effectiveSources = useMemo(() => {
    const set = resourceAccess?.source;
    if (!set) return sources;
    return sources.filter(s => set.has(String(s.Source ?? s.source ?? s)));
  }, [sources, resourceAccess]);
  const effectiveStructures = useMemo(() => {
    const set = resourceAccess?.structure;
    if (!set) return structures;
    return structures.filter(s => set.has(String(s.GroupStructure ?? s.groupStructure ?? s)));
  }, [structures, resourceAccess]);
  const effectiveContributionCompanies = useMemo(() => {
    const set = resourceAccess?.company;
    if (!set) return contributionCompanies;
    return contributionCompanies.filter(c => set.has(String(c)));
}, [contributionCompanies, resourceAccess]);

useEffect(() => {
    if (!resourceAccess) return;
    setSource(prev => {
      if (!prev || effectiveSources.length === 0) return prev;
      const allowed = effectiveSources.some(s => (s.Source ?? s) === prev);
      return allowed ? prev : (effectiveSources[0].Source ?? effectiveSources[0]);
    });
    setStructure(prev => {
      if (!prev || effectiveStructures.length === 0) return prev;
      const allowed = effectiveStructures.some(s => (s.GroupStructure ?? s) === prev);
      return allowed ? prev : (effectiveStructures[0].GroupStructure ?? effectiveStructures[0]);
    });
  }, [resourceAccess, effectiveSources, effectiveStructures]);

const visibleCompanies = useMemo(() => {
    if (!selectedCompanies) return effectiveContributionCompanies;
    return effectiveContributionCompanies.filter(c => selectedCompanies.includes(c));
  }, [effectiveContributionCompanies, selectedCompanies]);

const [colOrder, setColOrder] = useState(null);
  const [draggingCol, setDraggingCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

// Expand/collapse-all: bump version to re-sync every row to expandAllState
const [expandAllVersion, setExpandAllVersion] = useState(0);
  const [expandAllState, setExpandAllState] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const bumpOpenCount = useCallback((delta) => {
    setOpenCount(c => Math.max(0, c + delta));
  }, []);
  const anyRowOpen = expandAllState || openCount > 0;
  const toggleExpandAll = () => {
    const next = !anyRowOpen;
    setExpandAllState(next);
    setExpandAllVersion(v => v + 1);
    if (!next) setOpenCount(0);
  };

  // Qué está abierto/plegado en la tabla (lo comunica la propia tabla). La
  // exportación lo usa para salir con la misma estructura que la pantalla.
  const cfViewRef = useRef(null);
  const handleViewState = useCallback((v) => { cfViewRef.current = v; }, []);

  // Tipografía de la tabla en un objeto estable (ver nameFor).
  const typoKey = JSON.stringify({ body1: body1Style, body2: body2Style, sub: subbody1Style });
  const cfTypo = useMemo(() => {
    const ty = JSON.parse(typoKey);
    return { ...ty, body1Bold: { ...ty.body1, fontWeight: 800 } };
  }, [typoKey]);

// Search
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef(null);
  useEffect(() => { if (searchActive) searchInputRef.current?.focus(); }, [searchActive]);

  const orderedVisibleCompanies = useMemo(() => {
    if (!colOrder) return visibleCompanies;
    const map = new Map(visibleCompanies.map(c => [c, c]));
    return colOrder.map(c => map.get(c)).filter(Boolean);
  }, [visibleCompanies, colOrder]);

  const visibleCompaniesKey = useMemo(() => visibleCompanies.join(","), [visibleCompanies]);
  useEffect(() => { setColOrder(null); }, [visibleCompaniesKey]);

  /* ─── Signo y árbol del cash flow (igual que [Importe Individual CF] del
     Power BI "Cockpit"):
       · Cada fila de mapped-cashflow-accounts (Enabled) lleva el AmountYTD de
         su cuenta de grupo a su línea de cash flow.
       · SIGNO: se invierte (×−1) si la cuenta de grupo es de patrimonio/pasivo
         (LadoBalance = "L") o de resultados (AccountType P/L o DIS); las de
         activo se suman tal cual. Así el resultado sale con signo de
         presentación (positivo = entrada de caja).
       · ÁRBOL: las líneas de cash flow son cuentas de group-accounts (C/F y
         CFS) y cuelgan unas de otras por su SumAccountCode, hasta los totales
         (CF.A5s, CF.B8s, CF.D1s…). El padre que trae el mapeo sólo llega un
         nivel, así que los totales se quedaban sin importe.
     LadoBalance: BalanceSheetType si vale "A" o "L"; si no, se deduce por la
     raíz de la jerarquía ("G.PYC" → L, "C.ACT" → A), como la columna del
     modelo. Comprobado contra el modelo del .pbix: 1.963 importes, todos al
     céntimo. ────────────────────────────────────────────────────── */
  const cfSignInfo = useMemo(() => {
    const byCode = new Map();
    groupAccountsCf.forEach(g => {
      const code = String(g.AccountCode ?? g.accountCode ?? "");
      if (code) byCode.set(code, g);
    });
    const parentOf = (code) => {
      const g = byCode.get(code);
      const p = String(g?.SumAccountCode ?? g?.sumAccountCode ?? "");
      return p && p !== code && byCode.has(p) ? p : "";
    };
    const pathHas = (code, target) => {
      let c = code;
      const seen = new Set();
      while (c && !seen.has(c)) {
        if (c === target) return true;
        seen.add(c);
        c = parentOf(c);
      }
      return false;
    };
    const invert = new Set();
    const cfTree = new Map(); // línea de cash flow → { name, parent }
    byCode.forEach((g, code) => {
      const type = String(g.AccountType ?? g.accountType ?? "");
      if (type === "C/F" || type === "CFS") {
        cfTree.set(code, { name: String(g.AccountName ?? g.accountName ?? ""), parent: parentOf(code) });
        return;
      }
      if (type === "P/L" || type === "DIS") { invert.add(code); return; }
      if (type !== "B/S") return;
      const bst = String(g.BalanceSheetType ?? g.balanceSheetType ?? "");
      const lado = bst === "A" || bst === "L" ? bst : pathHas(code, "G.PYC") ? "L" : pathHas(code, "C.ACT") ? "A" : "";
      if (lado === "L") invert.add(code);
    });
    return { invert, cfTree };
  }, [groupAccountsCf]);

  // Filas con el importe ya en signo de cash flow (se aplica al cargar, así el
  // pivot, el desglose, la comparación y las exportaciones van a la par).
  // Se guarda en un ref para que los efectos de carga NO dependan de él: si
  // dependieran, cualquier recálculo relanzaría la carga y cancelaría la que
  // está en curso, dejando la página en «cargando».
  const signCfRows = useCallback((rows) => {
    const list = Array.isArray(rows) ? rows : [];
    try {
      return list.map(r => {
        const code = String(r.AccountCode ?? r.accountCode ?? "");
        if (!cfSignInfo.invert.has(code)) return r;
        const ytd = -parseAmt(r.AmountYTD ?? r.amountYTD);
        const per = -parseAmt(r.AmountPeriod ?? r.amountPeriod);
        return { ...r, AmountYTD: ytd, amountYTD: ytd, AmountPeriod: per, amountPeriod: per };
      });
    } catch (err) {
      console.error("Cash flow individual: no se pudo aplicar el signo", err);
      return list;
    }
  }, [cfSignInfo]);
  const signCfRowsRef = useRef(signCfRows);
  useEffect(() => { signCfRowsRef.current = signCfRows; }, [signCfRows]);

  // Si el plan de cuentas llega después que los datos, se vuelve a aplicar el
  // signo sobre lo ya cargado (guardado sin signo en rawDataRef).
  const rawDataRef = useRef({ uploaded: [], journals: [] });

/* ─── Datos del periodo (con retroceso automático si está vacío) ──────
     · En cada intento solo se pide uploaded-accounts; los asientos, cuando
       ya hay datos. Ya no se pide consolidated-accounts: era la consulta más
       pesada (sin filtro de grupo) y solo servía para nombres, que ahora
       salen del plan de cuentas.
     · Cada petición tiene tiempo máximo y se cancela al cambiar de periodo
       o salir de la página: la carga siempre termina (con datos, sin datos
       o con un aviso de error y botón de reintentar). */
  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure) return;
    // Con varios periodos los datos los carga el efecto de multiperiodo
    if (multiOn) { setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(false);

    (async () => {
      let tryY = parseInt(year), tryM = parseInt(month);
      const maxAttempts = autoPeriodDone.current ? 1 : 24;
      try {
        for (let i = 0; i < maxAttempts; i++) {
          if (ctrl.signal.aborted) return;
          const baseFilter = `Year eq ${tryY} and Month eq ${tryM} and Source eq '${source}' and GroupStructure eq '${structure}'`;
          const uploadedRes = await fetchJson(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`,
            { token, timeout: 45000, signal: ctrl.signal });
          const uploaded = Array.isArray(uploadedRes) ? uploadedRes : [];
          if (ctrl.signal.aborted) return;

          if (uploaded.length > 0 || autoPeriodDone.current) {
            const journalsRes = await fetchJson(`${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`,
              { token, timeout: 45000, fallback: [], signal: ctrl.signal });
            if (ctrl.signal.aborted) return;
            const journals = Array.isArray(journalsRes) ? journalsRes : [];
            rawDataRef.current = { uploaded, journals };
            setUploadedData(signCfRowsRef.current(uploaded));
            setJournalEntries(signCfRowsRef.current(journals));
            if (String(tryY) !== year || String(tryM) !== month) {
              setYear(String(tryY)); setMonth(String(tryM));
            }
            autoPeriodDone.current = true;
            return;
          }
          tryM -= 1;
          if (tryM < 1) { tryM = 12; tryY -= 1; }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) { console.error("Cash flow individual: error cargando datos", err); setLoadError(true); }
      } finally {
        if (!ctrl.signal.aborted) { setLoading(false); setFirstLoadDone(true); }
      }
    })();

    return () => ctrl.abort();
  }, [token, metaReady, year, month, source, structure, reloadKey, multiOn]);

  /* ─── Multiperiodo: suma de los periodos elegidos ─────────────────────
     Solo se leen los cierres frontera de cada tramo (YTD del último mes −
     YTD del mes anterior al primero), igual que Individuales. Las filas que
     salen tienen la forma de la API, así el pivot, el desglose y las
     exportaciones funcionan igual que con un mes. */
  const multiKey = (multiOn && metaReady && source && structure) ? `${periodsKey(multiPeriods)}|${source}|${structure}|${reloadKey}` : null;
  const [multiDoneKey, setMultiDoneKey] = useState(null);
  const [multiProgress, setMultiProgress] = useState({ key: null, done: 0, total: 0 });
  const multiLoading = !!multiKey && multiDoneKey !== multiKey;
  useEffect(() => {
    if (!multiKey) return undefined;
    const ctrl = new AbortController();
    const total = closesNeeded(multiPeriods) * 2;
    let done = 0;
    setMultiProgress({ key: multiKey, done: 0, total });
    const tick = () => { done += 1; if (!ctrl.signal.aborted) setMultiProgress({ key: multiKey, done, total }); };
    const get = (path, y, m) => fetchJson(
      `${BASE}/${path}?$filter=${encodeURIComponent(`Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}'`)}`,
      { token, timeout: 45000, fallback: [], signal: ctrl.signal },
    ).then(r => (Array.isArray(r) ? r : []));
    Promise.all([
      sumPeriodRows(multiPeriods, (y, m) => get("reports/uploaded-accounts", y, m), tick),
      sumPeriodRows(multiPeriods, (y, m) => get("journal-entries", y, m), tick),
    ]).then(([uploaded, journals]) => {
      if (ctrl.signal.aborted) return;
      rawDataRef.current = { uploaded, journals };
      setUploadedData(signCfRowsRef.current(uploaded));
      setJournalEntries(signCfRowsRef.current(journals));
      setLoadError(false);
      setFirstLoadDone(true);
      setMultiDoneKey(multiKey);
    }).catch(err => {
      if (ctrl.signal.aborted) return;
      console.error("Cash flow individual: error sumando periodos", err);
      setLoadError(true);
      setMultiDoneKey(multiKey);
    });
    return () => ctrl.abort();
  }, [multiKey, multiPeriods, token, source, structure]);
  const multiProg = multiProgress.key === multiKey ? multiProgress : { done: 0, total: 0 };

  useEffect(() => {
    const { uploaded, journals } = rawDataRef.current;
    if (!uploaded.length && !journals.length) return;
    setUploadedData(signCfRows(uploaded));
    setJournalEntries(signCfRows(journals));
  }, [signCfRows]);

  // Nombres de las líneas de cash flow (del plan de cuentas).
  const cfNameDict = useMemo(() => {
    const d = {};
    cfSignInfo.cfTree.forEach((v, code) => { if (v.name) d[code] = v.name; });
    return d;
  }, [cfSignInfo]);

  /* ─── CF metadata + group→cf ──────────────────────────────────── */
  const cfMetadata = useMemo(() => {
    const m = new Map();
    cfMapping.forEach(map => {
      const enabled = map.enabled ?? map.Enabled;
      if (enabled === false) return;
      const code = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
      const name = map.cashFlowAccountName ?? map.CashFlowAccountName ?? "";
      const sumParent = map.cashFlowAccountSumAccountCode ?? map.CashFlowAccountSumAccountCode ?? "";
      if (!code) return;
      if (!m.has(code)) m.set(code, { name: name || cfNameDict[code] || "", sumParent });
    });
    // El padre de cada línea sale del plan de cuentas (group-accounts) cuando
    // la línea existe allí: así se sube hasta los totales, como en el Power BI.
    const { cfTree } = cfSignInfo;
    m.forEach((node, code) => {
      const ga = cfTree.get(code);
      if (ga) m.set(code, { name: node.name || ga.name, sumParent: ga.parent || node.sumParent });
    });
    let added = true;
    while (added) {
      added = false;
      for (const node of [...m.values()]) {
        const p = node.sumParent;
        if (p && !m.has(p)) {
          const ga = cfTree.get(p);
          m.set(p, { name: ga?.name || cfNameDict[p] || "", sumParent: ga?.parent || "" });
          added = true;
        }
      }
    }
    return m;
  }, [cfMapping, cfNameDict, cfSignInfo]);

  const groupToCf = useMemo(() => {
    const m = new Map();
    cfMapping.forEach(map => {
      const enabled = map.enabled ?? map.Enabled;
      if (enabled === false) return;
      const ga = map.groupAccountCode ?? map.GroupAccountCode ?? "";
      const cf = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
      if (!ga || !cf) return;
      if (!m.has(ga)) m.set(ga, []);
      m.get(ga).push(cf);
    });
    return m;
  }, [cfMapping]);

  /* ─── Pivot from uploaded leaves ──────────────────────────────── */
const filteredUploadedData = useMemo(() => {
    return uploadedData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
  }, [uploadedData, upDimGroups, upDimensions]);

  const pivot = useMemo(() => {
    if (!filteredUploadedData.length || !cfMetadata.size) return new Map();
    const piv = new Map();

filteredUploadedData.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!groupCode || !co) return;
      const cfs = groupToCf.get(groupCode);
      if (!cfs) return;
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD);
      cfs.forEach(cfCode => {
        if (!piv.has(cfCode)) piv.set(cfCode, {});
        const c = piv.get(cfCode);
        if (!c[co]) c[co] = [];
        c[co].push({ _cfAmount: amt });
      });
    });

    // Se suben a los padres los importes DIRECTOS de cada línea (copia previa):
    // si una línea con importe propio es a la vez padre de otra, leer el pivot
    // ya acumulado contaría dos veces a sus hijas según el orden de recorrido.
    const directPiv = new Map([...piv].map(([code, byCo]) => [code, Object.fromEntries(
      Object.entries(byCo).map(([co, arr]) => [co, [{ _cfAmount: arr.reduce((s, r) => s + (r._cfAmount ?? 0), 0) }]]))]));
    const leafCodes = [...directPiv.keys()];
    leafCodes.forEach(leafCode => {
      const meta = cfMetadata.get(leafCode);
      if (!meta) return;
      let parent = meta.sumParent;
      const seen = new Set([leafCode]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const leafPiv = directPiv.get(leafCode) || {};
        if (!piv.has(parent)) piv.set(parent, {});
        const parentPiv = piv.get(parent);
        Object.entries(leafPiv).forEach(([co, rsArr]) => {
          if (!parentPiv[co]) parentPiv[co] = [];
          const sum = rsArr.reduce((s, r) => s + (r._cfAmount ?? 0), 0);
          parentPiv[co].push({ _cfAmount: sum });
        });
        const parentMeta = cfMetadata.get(parent);
        parent = parentMeta?.sumParent || "";
      }
    });

    return piv;
  }, [filteredUploadedData, cfMetadata, groupToCf]);

  const subtotalCodes = useMemo(() => {
    const s = new Set();
    cfMetadata.forEach(({ sumParent }) => { if (sumParent) s.add(sumParent); });
    return s;
  }, [cfMetadata]);

  const codesWithValue = useMemo(() => {
    const out = [];
    pivot.forEach((byCo, code) => {
      let total = 0;
      for (const co of Object.keys(byCo)) {
        for (const r of byCo[co] || []) total += Number(r._cfAmount ?? 0);
      }
      if (Math.round(total) !== 0) out.push(code);
    });
    return out;
  }, [pivot]);

  const sectionForCode = (code) => {
    const fromSb = activeCfMapping?.rows?.get(code);
    if (fromSb) return fromSb.section;
    const n = parseInt(code, 10);
    if (isNaN(n)) return "OPERATING";
    if (n < 3000) return "OPERATING";
    if (n < 4000) return "INVESTING";
    return "FINANCING";
  };
  const sortOrderFor = (code) => {
    const fromSb = activeCfMapping?.rows?.get(code);
    if (fromSb) return fromSb.sortOrder;
    const n = parseInt(code, 10);
    return isNaN(n) ? 99999 : n * 10;
  };
  // Funciones estables (useCallback): la tabla memoriza sus filas y una
  // función nueva en cada render las obligaría a repintarse todas.
  const nameFor = useCallback((code) => {
    const meta = cfMetadata.get(code);
    if (meta?.name) return meta.name;
    if (cfNameDict[code]) return cfNameDict[code];
    return "";
  }, [cfMetadata, cfNameDict]);

  // Build a set of CF codes that have a match (self or any descendant in drill)
  const matchedCfCodes = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return null;
    const out = new Set();

    filteredUploadedData.forEach(r => {
      const gc = String(r.AccountCode ?? r.accountCode ?? "");
      const gcL = gc.toLowerCase();
      const gn = String(r.AccountName ?? r.accountName ?? "").toLowerCase();
      const lc = String(r.LocalAccountCode ?? r.localAccountCode ?? "").toLowerCase();
      const ln = String(r.LocalAccountName ?? r.localAccountName ?? "").toLowerCase();
      const origin = r.Origin ?? r.origin ?? "";
      if (origin === "Journal" || !lc) return;
      if (gcL.includes(q) || gn.includes(q) || lc.includes(q) || ln.includes(q)) {
        const cfs = groupToCf.get(gc) ?? [];
        cfs.forEach(cf => out.add(String(cf)));
      }
    });
    journalEntries.forEach(j => {
      const gc = String(j.AccountCode ?? j.accountCode ?? "");
      const gcL = gc.toLowerCase();
      const gn = String(j.AccountName ?? j.accountName ?? "").toLowerCase();
      const jn = String(j.JournalNumber ?? j.journalNumber ?? "").toLowerCase();
      const jh = String(j.JournalHeader ?? j.journalHeader ?? "").toLowerCase();
      const jt = String(j.JournalType ?? j.journalType ?? "").toLowerCase();
      if (gcL.includes(q) || gn.includes(q) || jn.includes(q) || jh.includes(q) || jt.includes(q)) {
        const cfs = groupToCf.get(gc) ?? [];
        cfs.forEach(cf => out.add(String(cf)));
      }
    });

    pivot.forEach((_, code) => {
      const codeStr = String(code).toLowerCase();
      const nameStr = String(nameFor(code) || "").toLowerCase();
      if (codeStr.includes(q) || nameStr.includes(q)) out.add(String(code));
    });

// "direct" = code itself or its drill matched. Used to filter standard render.
    const direct = new Set(out);

    // "extended" = also includes sum parents. Used by custom mapping render
    // so a matched leaf surfaces its parent node in the tree.
    let added = true;
    while (added) {
      added = false;
      out.forEach(code => {
        const parent = cfMetadata.get(code)?.sumParent;
        if (parent && !out.has(parent)) { out.add(parent); added = true; }
      });
    }
    return { direct, extended: out };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filteredUploadedData, journalEntries, groupToCf, pivot, cfMetadata]);

  const bySection = useMemo(() => {
    const m = new Map();
    codesWithValue.forEach(code => {
      const sec = sectionForCode(code);
      if (!m.has(sec)) m.set(sec, []);
      m.get(sec).push(code);
    });
    m.forEach(arr => arr.sort((a, b) => sortOrderFor(a) - sortOrderFor(b)));
    return m;
  }, [codesWithValue, activeCfMapping]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionOrder = useMemo(() => {
    const order = activeCfMapping?.sections ? [...activeCfMapping.sections.keys()] : ["OPERATING", "INVESTING", "FINANCING"];
    bySection.forEach((_, sec) => { if (!order.includes(sec)) order.push(sec); });
    return order;
  }, [activeCfMapping, bySection]);

  const availableYears  = [...new Set(periods.map(p => p.Year))].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }));
const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: T(`month_${m}`) || MONTHS.find(x => x.value === m)?.label || String(m) }));

  const getLegal = useCallback(co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co, [companies]);
  const hasData = uploadedData.length > 0;

const dimGroups = useMemo(() => {
    const seen = new Set();
    const groups = [];
    uploadedData.forEach(r => {
      parseDimensionsField(r.Dimensions ?? r.dimensions ?? "").forEach(d => {
        if (d.group && !seen.has(d.group)) { seen.add(d.group); groups.push(d.group); }
      });
    });
    return groups.sort();
  }, [uploadedData]);

  const filteredDims = useMemo(() => {
    const seen = new Set();
    const dims = [];
    uploadedData.forEach(r => {
      parseDimensionsField(r.Dimensions ?? r.dimensions ?? "").forEach(d => {
        if (!upDimGroups || upDimGroups.includes(d.group)) {
          const key = `${d.group}:${d.code}`;
          if (!seen.has(key)) { seen.add(key); dims.push({ group: d.group, code: d.code }); }
        }
      });
    });
    return dims.sort((a, b) => a.code.localeCompare(b.code));
}, [uploadedData, upDimGroups]);

const [exporting, setExporting] = useState(false);

  // Pre-download modal state (mirrors Dimensiones / Individuales pattern)
  const [exportModal, setExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState({
    format: "xlsx",       // "xlsx" | "pdf"
    includeBreakers: true,
    includeTotals: true,
    includeCompare: true,
    drilldown: true,
  });

  // ── Cash flow mappings ────────────────────────────────────────────────
const [activeMapping, setActiveMapping] = useState(null);
  // System hidden-override mapping, kept so "clear" restores the initial default.
  const hiddenOverrideRef = useRef(null);
  const [recentMappings, setRecentMappings] = useState([]);
  const [viewsMode, setViewsMode] = useState(null); // null | "landing" | "structure" | "report"
  const [savedMappings, setSavedMappings] = useState([]);
  const [savedMappingsLoading, setSavedMappingsLoading] = useState(false);
  const [savedMappingsError, setSavedMappingsError] = useState(null);
  const [reportMappings, setReportMappings] = useState([]);
  const [reportMappingsLoading, setReportMappingsLoading] = useState(false);
  const [reportMappingsError, setReportMappingsError] = useState(null);

const handleApplyMapping = (m, kind = "structure") => {
    const tree = m.cf_tree ?? [];
    setActiveMapping({
      mapping_id: m.mapping_id,
      kind,
      name: m.name,
      standard: m.standard,
      cf_tree: tree,
      highlighted_ids: m.highlighted_ids ?? [],
      cf_view_mode: m.cf_view_mode ?? "consolidated",
      cfConverted: convertCfMappingTree(tree),
      cfLiteral: buildCfMappingLiteral(tree),
    });
  };

  // Load recent mappings for the hover-dropdown
  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import("../../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { listMappings: listStruct, getActiveCompanyId } = await import("../../../lib/cashflowMappingsApi");
        const { listMappings: listReport } = await import("../../../lib/cashflowReportMappingsApi");
        const cid = await getActiveCompanyId(uid);
        if (!cid) return;
        const [structRows, reportRows] = await Promise.all([
          listStruct({ companyId: cid }).catch(() => []),
          listReport({ companyId: cid }).catch(() => []),
        ]);
        const combined = [
          ...(structRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "structure", updated_at: r.updated_at, raw: r })),
          ...(reportRows  || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "report",    updated_at: r.updated_at, raw: r })),
        ];
setRecentMappings(combined);
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchSavedMappings = async () => {
    setSavedMappingsLoading(true); setSavedMappingsError(null);
    try {
      const { supabase } = await import("../../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { listMappings, getActiveCompanyId } = await import("../../../lib/cashflowMappingsApi");
      const cid = await getActiveCompanyId(uid);
      if (!cid) throw new Error("No active company");
      const rows = await listMappings({ companyId: cid });
      setSavedMappings(Array.isArray(rows) ? rows : []);
    } catch (e) { setSavedMappingsError(e.message); setSavedMappings([]); }
    finally { setSavedMappingsLoading(false); }
  };

  const fetchReportMappings = async () => {
    setReportMappingsLoading(true); setReportMappingsError(null);
    try {
      const { supabase } = await import("../../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { listMappings, getActiveCompanyId } = await import("../../../lib/cashflowReportMappingsApi");
      const cid = await getActiveCompanyId(uid);
      if (!cid) throw new Error("No active company");
      const rows = await listMappings({ companyId: cid });
      setReportMappings(Array.isArray(rows) ? rows : []);
    } catch (e) { setReportMappingsError(e.message); setReportMappings([]); }
    finally { setReportMappingsLoading(false); }
  };

useEffect(() => { if (viewsMode === "structure") fetchSavedMappings(); }, [viewsMode]);
  useEffect(() => { if (viewsMode === "report") fetchReportMappings(); }, [viewsMode]);

// On load for a CUSTOM standard, pick the default CF mapping in priority order:
  //   1) the user's "standard" CF mapping — a per-user preference stored in
  //      user_settings.preferences.cashflow_standard_mapping_id (same value the
  //      toggle in the mappings editor writes), whatever its origin
  //   2) the system hidden override (custom-no-user) as the fallback
  // The override lives in the PL/BS `mappings` table (it holds pl_tree, bs_tree AND
  // cf_tree together) and is always cached in hiddenOverrideRef for "reset to default".
  useEffect(() => {
    if (!isCustomStandard || !activeStandardKey) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("../../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { getActiveCompanyId, getHiddenOverrideMapping } = await import("../../../lib/mappingsApi");
        const cid = await getActiveCompanyId(uid);
        if (!cid) return;

        // Cache the hidden override first (fallback + reset target).
        const hidden = await getHiddenOverrideMapping({ companyId: cid, standard: activeStandardKey });
        if (cancelled) return;
        if (hidden) hiddenOverrideRef.current = hidden;

        // A user's chosen "standard" CF mapping wins over the hidden override.
        let userDefault = null;
        try {
          const { data: settings } = await supabase
            .from("user_settings")
            .select("preferences")
            .eq("user_id", uid)
            .single();
          const stdMappingId = settings?.preferences?.cashflow_standard_mapping_id;
          if (stdMappingId) {
            const { getMapping } = await import("../../../lib/cashflowMappingsApi");
            const full = await getMapping(stdMappingId);
            if (full && !full.is_archived && Array.isArray(full.cf_tree) && full.cf_tree.length > 0) {
              userDefault = full;
            }
          }
        } catch { /* no user default → fall back to override */ }
        if (cancelled) return;

        if (userDefault) {
          handleApplyMapping(userDefault, "structure");
        } else if (hidden && Array.isArray(hidden.cf_tree) && hidden.cf_tree.length > 0) {
          handleApplyMapping(hidden, "structure");
        }
      } catch (e) { console.warn("[IndividualCashFlow] default mapping load failed:", e); }
    })();
    return () => { cancelled = true; };
  }, [isCustomStandard, activeStandardKey]);

  // Refresh when the CUSTOM standard is edited from Mappings
  useEffect(() => {
    const handler = () => {
      if (!isCustomStandard || !activeStandardKey) return;
      // Force re-fetch by resetting activeMapping so the auto-apply effect re-runs
      setActiveMapping(null);
      loadCustomCfMapping(activeStandardKey, setCustomCfMapping);
    };
    window.addEventListener("custom-standard-updated", handler);
    return () => window.removeEventListener("custom-standard-updated", handler);
  }, [isCustomStandard, activeStandardKey]);
const [compareMode, setCompareMode] = useState(false);
// El comparativo trabaja sobre un único periodo: al sumar varios se apaga
if (multiOn && compareMode) setCompareMode(false);
  const [cmpVisible, setCmpVisible] = useState(false);
  const [cmpExiting, setCmpExiting] = useState(false);
  const [cmpYear,  setCmpYear]  = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
const [cmpSource, setCmpSource] = useState("");

  useEffect(() => {
    if (!resourceAccess) return;
    setCmpSource(prev => {
      if (!prev || effectiveSources.length === 0) return prev;
      const allowed = effectiveSources.some(s => (s.Source ?? s) === prev);
      return allowed ? prev : (effectiveSources[0].Source ?? effectiveSources[0]);
    });
  }, [resourceAccess, effectiveSources]);

const [cmpPivot, setCmpPivot] = useState(new Map());
  const [cmpUploadedData, setCmpUploadedData] = useState([]);
  const [cmpJournalEntries, setCmpJournalEntries] = useState([]);
  const [cmpLoading, setCmpLoading] = useState(false);

useEffect(() => {
    if (compareMode) {
      setCmpVisible(true); setCmpExiting(false);
    } else if (cmpVisible) {
      setCmpExiting(true);
      const t = setTimeout(() => { setCmpVisible(false); setCmpExiting(false); }, 350);
      return () => clearTimeout(t);
    }
  }, [compareMode, cmpVisible]);

// Fetch compare period when compare mode is active
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !structure) {
      setCmpPivot(new Map());
      setCmpUploadedData([]);
      setCmpJournalEntries([]);
      return;
    }
    let cancelled = false;
    setCmpLoading(true);
    const baseFilter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${structure}'`;
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    Promise.all([
      fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, auth).then(r => r.json()).then(d => d.value || []).catch(() => []),
      fetch(`${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`, auth).then(r => r.json()).then(d => d.value || []).catch(() => []),
    ]).then(([rawRows, rawJournals]) => {
        if (cancelled) return;
        const rows = signCfRowsRef.current(rawRows);
        setCmpUploadedData(rows);
        setCmpJournalEntries(signCfRowsRef.current(rawJournals));
        const piv = new Map();
rows.forEach(r => {
          const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
          const co = r.CompanyShortName ?? r.companyShortName ?? "";
          if (!groupCode || !co) return;
          const cfs = groupToCf.get(groupCode);
          if (!cfs) return;
          const amt = parseAmt(r.AmountYTD ?? r.amountYTD);
          cfs.forEach(cfCode => {
            if (!piv.has(cfCode)) piv.set(cfCode, {});
            const c = piv.get(cfCode);
            if (!c[co]) c[co] = [];
            c[co].push({ _cfAmount: amt });
          });
        });
        // bubble up to parents (importes directos: ver el pivot principal)
        const directCmp = new Map([...piv].map(([code, byCo]) => [code, Object.fromEntries(
          Object.entries(byCo).map(([co, arr]) => [co, [{ _cfAmount: arr.reduce((s, r) => s + (r._cfAmount ?? 0), 0) }]]))]));
        [...directCmp.keys()].forEach(leafCode => {
          const meta = cfMetadata.get(leafCode);
          if (!meta) return;
          let parent = meta.sumParent;
          const seen = new Set([leafCode]);
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            const lp = directCmp.get(leafCode) || {};
            if (!piv.has(parent)) piv.set(parent, {});
            const pp = piv.get(parent);
            Object.entries(lp).forEach(([co, arr]) => {
              if (!pp[co]) pp[co] = [];
              pp[co].push({ _cfAmount: arr.reduce((s, r) => s + (r._cfAmount ?? 0), 0) });
            });
            parent = cfMetadata.get(parent)?.sumParent || "";
          }
        });
        setCmpPivot(piv);
        setCmpLoading(false);
      }).catch(() => { if (!cancelled) setCmpLoading(false); });
    return () => { cancelled = true; };
  }, [compareMode, cmpYear, cmpMonth, cmpSource, structure, token, groupToCf, cfMetadata]);

  // Init compare filters on toggle
  useEffect(() => {
    if (!compareMode) return;
    if (!cmpSource) setCmpSource(source);
    if (!cmpYear)   setCmpYear(String(parseInt(year) - 1 || year));
    if (!cmpMonth)  setCmpMonth(month);
  }, [compareMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Filas a exportar: las MISMAS que construye la tabla (mismo orden,
     secciones, búsqueda aplicada e importes).
       · full = false → exactamente lo que se ve en pantalla.
       · full = true  → todo el desglose; cada fila sabe si se ve en pantalla
         (shown) para dejarla desplegada o agrupada en el Excel. */
  const buildExportItems = (full, compare) => {
    const view = cfViewRef.current ?? { openState: { all: false, toggled: new Set() }, collapsed: new Set() };
    const q = searchQuery.trim().toLowerCase();
    return buildCfItems({
      cfLiteral: activeMapping?.cfLiteral ?? customCfLiteral,
      sectionOrder, bySection, activeCfMapping, subtotalCodes, matchedCfCodes, nameFor,
      primary: colors.primary, q,
      openState: view.openState, collapsed: view.collapsed,
      underlying: underlyingCodes([filteredUploadedData, journalEntries, cmpUploadedData], groupToCf),
      drillFor: makeDrillCache({ uploadedData: filteredUploadedData, journalEntries, groupToCf, q }),
      cmpFor: makeCmpCache({ cmpUploadedData, cmpJournalEntries, groupToCf }),
      compareMode: compare, full,
    });
  };

const handleExportXlsx = async (opts = {}) => {
    const includeBreakers   = opts.includeBreakers   !== false;
    const includeTotalsOpt  = opts.includeTotals     !== false;
    const includeCompareOpt = opts.includeCompare    !== false;
    const drilldown         = opts.drilldown         !== false;
    // Who is exporting — surfaced in the header. Best-effort; never blocks export.
    let exportedByName = "";
    try {
      const { supabase } = await import("../../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      exportedByName = session?.user?.user_metadata?.full_name
        || session?.user?.user_metadata?.name
        || session?.user?.email
        || "";
    } catch { /* ignore — header just omits the user */ }
    const C = {
      primary: "FF1A2F8A", white: "FFFFFFFF", highlight: "FFEEF1FB",
      band1: "FFFFFFFF", band2: "FFF8F9FF",
      gray400: "FF9CA3AF", red: "FFDC2626", green: "FF059669",
      navyDk: "FF13225C", redDk: "FFCF305D",
    };
    const toArgbHex = (hex) => "FF" + String(hex ?? "#1a2f8a").replace("#", "").toUpperCase().padStart(6, "0");
const monthLabel = (m) => T(`month_${parseInt(m)}`);
    const periodLabel = (y, m) => `${monthLabel(m)} ${y}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Konsolidator";

const visCo = orderedVisibleCompanies;
    const sheetCompare = cmpVisible && includeCompareOpt;
    const showTotals = !sheetCompare && includeTotalsOpt;
    const subColsPerCo = sheetCompare ? 4 : 1;
    const totalCols = 1 + visCo.length * subColsPerCo + (showTotals ? 1 : 0);

// Sub-header lines (filters preview)
    const subLines = [];
    if (year && month) {
      const seg = [`📅 ${multiOn ? multiPeriodText : periodLabel(year, month)}`];
      if (source)    seg.push(`${T("file_field_source")}: ${source}`);
      if (structure) seg.push(`${T("file_field_structure")}: ${structure}`);
      subLines.push(seg.join("    ·    "));
    }
subLines.push(`${T("file_field_statement")}: ${T("nav_cashflow").toUpperCase()}    ·    ${T("filter_company")}: ${visCo.length}${activeMapping ? `    ·    ${T("export_filter_mapping")}: ${activeMapping.name}` : ""}${sheetCompare ? `    ·    ${T("file_compare_on")}` : ""}`);
    if (sheetCompare && cmpYear && cmpMonth) {
      const seg = [`🆚 ${T("file_vs_prefix")} ${periodLabel(cmpYear, cmpMonth)}`];
      if (cmpSource) seg.push(`${T("file_field_source")}: ${cmpSource}`);
      subLines.push(seg.join("    ·    "));
    }
subLines.push(`🕓 ${T("file_exported_at", "Exportado")}: ${new Date().toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}${exportedByName ? `    ·    ${T("file_exported_by", "por")} ${exportedByName}` : ""}`);

    const headerRowCount = 1 + subLines.length + 1 + (sheetCompare ? 2 : 1);
    const ws = wb.addWorksheet("Cash Flow", {
      views: [{ state: "frozen", xSplit: 1, ySplit: headerRowCount }],
      properties: { outlineLevelRow: 1, summaryBelow: false },
    });

    // Title banner
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
titleCell.value = T("cf_export_title");
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 28;

    // Sub-lines
    subLines.forEach((line, i) => {
      const r = 2 + i;
      ws.mergeCells(r, 1, r, totalCols);
      const c = ws.getCell(r, 1);
      c.value = line;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      c.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
      c.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
      ws.getRow(r).height = 18;
    });

    let curRow = 2 + subLines.length;
    ws.getRow(curRow).height = 6;
    curRow++;

    // Column headers
    if (sheetCompare) {
      const r1 = curRow, r2 = curRow + 1;
      const sup = ws.getRow(r1); sup.height = 22;
      const sub = ws.getRow(r2); sub.height = 18;
      const acc = sup.getCell(1);
acc.value = T("col_account");
      acc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      acc.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      acc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.mergeCells(r1, 1, r2, 1);
      visCo.forEach((co, i) => {
        const startCol = 2 + i * 4;
        const sCell = sup.getCell(startCol);
        sCell.value = getLegal(co);
        sCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        sCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
        sCell.alignment = { vertical: "middle", horizontal: "center" };
        ws.mergeCells(r1, startCol, r1, startCol + 3);
        [T("file_col_a"), T("file_col_sigma_cmp"), T("file_col_delta_amt"), T("file_col_delta_pct")].forEach((lbl, j) => {
          const cc = sub.getCell(startCol + j);
          cc.value = lbl;
          cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: j === 1 ? C.redDk : (j >= 2 ? C.navyDk : C.primary) } };
          cc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
          cc.alignment = { vertical: "middle", horizontal: "center" };
        });
      });
      curRow = r2 + 1;
    } else {
      const hRow = ws.getRow(curRow); hRow.height = 24;
const headers = [T("col_account"), ...visCo.map(co => getLegal(co))];
      if (showTotals) headers.push(T("col_total"));
      headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
       c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center", indent: i === 0 ? 1 : 0 };
      });
      curRow++;
    }

    // Cell writer
// Convert a 1-based column index to Excel letters (1→A, 26→Z, 27→AA, ...).
    const colLetter = (n) => {
      let s = "";
      let x = n;
      while (x > 0) {
        const m = (x - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        x = Math.floor((x - 1) / 26);
      }
      return s;
    };
    const cellRef = (rowN, colN) => `${colLetter(colN)}${rowN}`;

    const writeNum = (rowN, colN, val, fillArgb, opts = {}) => {
      const cell = ws.getCell(rowN, colN);
      // "Empty" test: for currency use rounded value (matches numFmt truncation);
      // for percent use the raw value so tiny non-zero pcts (e.g. -0.03%) still render.
      // Igual que en pantalla:
      //  · importes: negativos entre paréntesis en rojo, cero como "—";
      //  · Δ: con signo (+ / −), verde si sube y rojo si baja;
      //  · Δ%: con signo y una decimal; sin base de comparación, "—".
      // El cero se guarda como número (formato "—"), no como texto: así las
      // fórmulas de Δ, Δ% y total siguen funcionando al recalcular en Excel.
      const NUM_FMT = '#,##0.00;[Red](#,##0.00);"—"';
      const DELTA_FMT = '[Color10]+#,##0.00;[Red]−#,##0.00;"—"';
      const PCT_FMT = '[Color10]+0.0"%";[Red]−0.0"%";0.0"%"';
      if (val == null || !Number.isFinite(val)) {
        cell.value = opts.formula ? { formula: opts.formula, result: "—" } : "—";
        if (opts.percent) cell.numFmt = PCT_FMT; // por si al recalcular sale un número
        cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: !!opts.bold };
      } else {
        const v = opts.percent ? Math.round(val * 10) / 10 : Math.round(val * 100) / 100;
        cell.value = opts.formula ? { formula: opts.formula, result: v } : v;
        cell.numFmt = opts.percent ? PCT_FMT : opts.delta ? DELTA_FMT : NUM_FMT;
        const zero = opts.percent ? false : v === 0;
        cell.font = { name: "Calibri", size: 10, bold: !!opts.bold, color: { argb: zero ? C.gray400 : "FF0F172A" } };
      }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    };

    // Value getters per company
    const getValAt = (code, co) => {
      const rows = pivot.get(code)?.[co] ?? [];
      return rows.reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
    };
const getCmpValAt = (code, co) => {
      const rows = cmpPivot.get(code)?.[co] ?? [];
      return rows.reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
    };

    let dataIdx = 0;
    let maxDepth = 0;

const writeAccountRow = ({ code, name, depth, isBold, leafCodes, level = depth, hidden = false }) => {
      maxDepth = Math.max(maxDepth, level);
      const leaves = leafCodes ?? [code];
      const sumAt = (get, co) => leaves.reduce((s2, lc) => s2 + get(lc, co), 0);
      const band = dataIdx % 2 === 0 ? C.band1 : C.band2;
      dataIdx++;

      const labelCell = ws.getCell(curRow, 1);
      const codeStr = String(code ?? "").trim();
      const nameStr = String(name ?? "").trim() || "—";
      const runs = [];
      if (codeStr) runs.push({ text: `${codeStr}  `, font: { name: "Calibri", size: 9, color: { argb: "FF6B7280" } } });
      runs.push({ text: nameStr, font: { name: "Calibri", size: 11, bold: !!isBold, color: { argb: "FF1A2F8A" } } });
      labelCell.value = runs.length === 1 ? nameStr : { richText: runs };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 + Math.min(depth, 6) };
      labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

let rowTotal = 0;
      visCo.forEach((co, i) => {
        const a = sumAt(getValAt, co);
        rowTotal += a;
        if (sheetCompare) {
          const b = sumAt(getCmpValAt, co);
          const delta = a - b;
          const deltaPct = Math.abs(b) > 1e-9 ? ((a - b) / Math.abs(b)) * 100 : null;
          const startCol = 2 + i * 4;
          const aRef = cellRef(curRow, startCol);
          const bRef = cellRef(curRow, startCol + 1);
          writeNum(curRow, startCol,     a,        band,        { bold: isBold });
          writeNum(curRow, startCol + 1, b,        "FFFAFBFF",  { bold: isBold });
          writeNum(curRow, startCol + 2, delta,    "FFF5F7FF", {
            bold: isBold,
            formula: `${aRef}-${bRef}`,
            delta: true,
          });
          writeNum(curRow, startCol + 3, deltaPct, "FFF0F3FF", {
            bold: isBold, percent: true,
            formula: `IF(ABS(${bRef})<0.0001,"—",(${aRef}-${bRef})/ABS(${bRef})*100)`,
          });
        } else {
          writeNum(curRow, 2 + i, a, band, { bold: isBold });
        }
      });
if (showTotals) {
        const firstRef = cellRef(curRow, 2);
        const lastRef  = cellRef(curRow, 2 + visCo.length - 1);
        writeNum(curRow, 2 + visCo.length, rowTotal, C.highlight, {
          bold: true,
          formula: `SUM(${firstRef}:${lastRef})`,
        });
      }

const row = ws.getRow(curRow);
      // Con desglose, cada fila va agrupada bajo su padre y se queda abierta o
      // cerrada igual que en pantalla. Sin desglose es un informe plano.
      if (drilldown) {
        row.outlineLevel = Math.min(7, level);
        row.hidden = hidden;
      }
      curRow++;
      return rowTotal;
    };

const writeDrillGroupRow = ({ groupCode, groupName, depth, localRows, cmpMap, level = depth, hidden = true }) => {
      maxDepth = Math.max(maxDepth, level);
      const labelCell = ws.getCell(curRow, 1);
      labelCell.value = `${groupCode}  ${groupName ?? ""}`.trim();
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6FB" } };
      labelCell.font = { name: "Calibri", size: 9, italic: true, bold: true, color: { argb: "FF1A2F8A" } };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 + Math.min(depth, 6) };
      labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

      // Sum local rows per company
      const amtByCo = {};
      (localRows ?? []).forEach(lr => {
        amtByCo[lr.co] = (amtByCo[lr.co] ?? 0) + lr.amt;
      });

      let rowTotal = 0;
      visCo.forEach((co, i) => {
        const v = amtByCo[co] ?? 0;
        rowTotal += v;
        if (sheetCompare) {
          const cmpV = cmpMap?.get(`GRP::${groupCode}::${co}`) ?? 0;
          const delta = v - cmpV;
          const pct = Math.abs(cmpV) > 1e-9 ? ((v - cmpV) / Math.abs(cmpV)) * 100 : null;
          const startCol = 2 + i * 4;
const aRef = cellRef(curRow, startCol);
          const bRef = cellRef(curRow, startCol + 1);
          writeNum(curRow, startCol,     v,     "FFF4F6FB", { bold: true });
          writeNum(curRow, startCol + 1, cmpV,  "FFFAFBFF", { bold: true });
          writeNum(curRow, startCol + 2, delta, "FFF5F7FF", {
            bold: true,
            formula: `${aRef}-${bRef}`,
            delta: true,
          });
          writeNum(curRow, startCol + 3, pct,   "FFF0F3FF", {
            bold: true, percent: true,
            formula: `IF(ABS(${bRef})<0.0001,"—",(${aRef}-${bRef})/ABS(${bRef})*100)`,
          });
        } else {
          writeNum(curRow, 2 + i, v, "FFF4F6FB", { bold: true });
        }
      });
if (showTotals) {
          const firstRef = cellRef(curRow, 2);
          const lastRef  = cellRef(curRow, 2 + visCo.length - 1);
          writeNum(curRow, 2 + visCo.length, rowTotal, C.highlight, {
            bold: true,
            formula: `SUM(${firstRef}:${lastRef})`,
          });
        }

      const row = ws.getRow(curRow);
      if (drilldown) {
        row.outlineLevel = Math.min(7, level);
        row.hidden = hidden;
      }
      curRow++;
    };

const writeLocalRow = ({ localCode, localName, isJournal, co, amt, depth, groupCode, cmpMap, level = depth, hidden = true }) => {
      maxDepth = Math.max(maxDepth, level);
      const labelCell = ws.getCell(curRow, 1);
      const tag = isJournal ? "[JRN] " : "";
      labelCell.value = `${tag}${localCode}  ${localName ?? ""}`.trim();
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFD" } };
      labelCell.font = { name: "Calibri", size: 9, color: { argb: "FF6B7280" } };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 + Math.min(depth, 6) };
      labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

      visCo.forEach((coLoop, i) => {
        const v = coLoop === co ? amt : 0;
        if (sheetCompare) {
          const localKey = isJournal ? `JRN::${groupCode}::${localCode}::${coLoop}` : `ERP::${groupCode}::${localCode}::${coLoop}`;
          const cmpV = coLoop === co ? (cmpMap?.get(localKey) ?? 0) : 0;
          const delta = v - cmpV;
          const pct = Math.abs(cmpV) > 1e-9 ? ((v - cmpV) / Math.abs(cmpV)) * 100 : null;
          const startCol = 2 + i * 4;
const aRef = cellRef(curRow, startCol);
          const bRef = cellRef(curRow, startCol + 1);
          writeNum(curRow, startCol,     v,     "FFF9FAFD");
          writeNum(curRow, startCol + 1, cmpV,  "FFFAFBFF");
          writeNum(curRow, startCol + 2, delta, "FFF5F7FF", {
            formula: `${aRef}-${bRef}`,
            delta: true,
          });
          writeNum(curRow, startCol + 3, pct,   "FFF0F3FF", {
            percent: true,
            formula: `IF(ABS(${bRef})<0.0001,"—",(${aRef}-${bRef})/ABS(${bRef})*100)`,
          });
        } else {
          writeNum(curRow, 2 + i, v, "FFF9FAFD");
        }
      });
     if (showTotals) {
        const firstRef = cellRef(curRow, 2);
        const lastRef  = cellRef(curRow, 2 + visCo.length - 1);
        writeNum(curRow, 2 + visCo.length, amt, C.highlight, {
          formula: `SUM(${firstRef}:${lastRef})`,
        });
      }

      const row = ws.getRow(curRow);
      if (drilldown) {
        row.outlineLevel = Math.min(7, level);
        row.hidden = hidden;
      }
      curRow++;
    };

    const writeSectionBar = (label, colorArgb) => {
      ws.mergeCells(curRow, 1, curRow, totalCols);
      const cell = ws.getCell(curRow, 1);
      cell.value = String(label).toUpperCase();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorArgb } };
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(curRow).height = 22;
      curRow++;
      dataIdx = 0;
    };

// ── Filas: las mismas que la tabla, en el mismo orden ─────────────
    // Niveles de agrupación: sección 0 · línea 1+profundidad · cuenta de
    // grupo +1 · línea local +2. Lo que en pantalla está cerrado queda
    // agrupado (oculto) y se abre con los botones de esquema de Excel.
    const xItems = buildExportItems(drilldown, sheetCompare);
    xItems.forEach(it => {
      const hidden = drilldown && !it.shown;
      if (it.type === "section") {
        if (includeBreakers) writeSectionBar(it.label, toArgbHex(it.color));
        return;
      }
      if (it.type === "empty") return;
      if (it.type === "cf") {
        writeAccountRow({
          code: it.code, name: it.name, depth: it.depth, isBold: it.isSum, leafCodes: it.leafCodes,
          level: 1 + it.depth, hidden,
        });
        return;
      }
      if (it.type === "group") {
        writeDrillGroupRow({
          groupCode: it.g.groupCode, groupName: it.g.groupName, depth: it.depth + 1,
          localRows: it.g.localRows, cmpMap: it.cmpMap, level: 2 + it.depth, hidden,
        });
        return;
      }
      if (it.type === "local") {
        writeLocalRow({
          localCode: it.r.localCode, localName: it.r.localName, isJournal: it.r.isJournal, co: it.r.co, amt: it.r.amt,
          depth: it.depth + 2, groupCode: it.g.groupCode, cmpMap: it.cmpMap, level: 3 + it.depth, hidden,
        });
      }
    });

    // Column widths
ws.getColumn(1).width = 44;
    if (sheetCompare) {
      for (let i = 0; i < visCo.length; i++) {
        // Column A (the main value) stays at outline level 0 — always visible.
        // The three comparative columns (Σ CMP, Δ, Δ%) get outline level 1 so the
        // user can collapse them per company via Excel's column group toggle,
        // leaving just the main value. They start expanded (not hidden).
        ws.getColumn(2 + i * 4).width = 15;
        const cCmp = ws.getColumn(2 + i * 4 + 1); cCmp.width = 14; cCmp.outlineLevel = 1;
        const cDlt = ws.getColumn(2 + i * 4 + 2); cDlt.width = 12; cDlt.outlineLevel = 1;
        const cPct = ws.getColumn(2 + i * 4 + 3); cPct.width = 10; cPct.outlineLevel = 1;
      }
      // Column groups summarise to the LEFT (the main value column), so the toggle
      // (+/−) sits on the right edge of each company's block.
      ws.properties.outlineLevelCol = 1;
      ws.properties.outlineProperties = { ...(ws.properties.outlineProperties || {}), summaryRight: false };
    } else {
      for (let i = 0; i < visCo.length; i++) ws.getColumn(2 + i).width = 18;
if (showTotals) ws.getColumn(2 + visCo.length).width = 18;
    }

    // Frame each company block with a medium left border so groups visually separate.
    // In compare mode each company spans 4 sub-columns (A / Σcmp / Δ / Δ%); outside
    // compare mode each company is a single column. The Total column (if shown)
    // also gets a divider.
    {
      const subCols = sheetCompare ? 4 : 1;
      const borderStyle = { style: 'medium', color: { argb: 'FF6B7280' } };
      const boundaries = [];
      for (let i = 0; i < visCo.length; i++) {
        boundaries.push(2 + i * subCols); // start column of company i
      }
      if (showTotals) boundaries.push(2 + visCo.length * subCols); // divider before Total
      const lastRow = ws.lastRow?.number ?? 0;
      for (let r = 1; r <= lastRow; r++) {
        const row = ws.getRow(r);
        boundaries.forEach(colIdx => {
          const cell = row.getCell(colIdx);
          cell.border = { ...(cell.border || {}), left: borderStyle };
        });
      }
    }

if (drilldown) {
      ws.properties.outlineLevelRow = Math.min(7, Math.max(1, maxDepth));
      ws.properties.summaryBelow = false;
    }

let buffer;
    try { buffer = await wb.xlsx.writeBuffer(); }
    catch (e) { throw new Error(`writeBuffer failed: ${e?.message ?? e}`); }

    let repaired;
    try { repaired = await repairCfXlsx(buffer); }
    catch { repaired = buffer; }

    saveAs(
      new Blob([repaired], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Konsolidator_CashFlow_${year}_${String(month).padStart(2, "0")}.xlsx`,
    );
  };

const handleExportPdf = (opts = {}) => {
    const includeBreakers   = opts.includeBreakers   !== false;
    const includeTotalsOpt  = opts.includeTotals     !== false;
    const includeCompareOpt = opts.includeCompare    !== false;
    const drilldown         = opts.drilldown         !== false;
    const NAVY     = [26, 47, 138];
    const NAVYMID  = [40, 64, 168];
    const NAVYDK   = [10, 20, 70];
    const RED      = [207, 48, 93];
    const REDDK    = [160, 30, 65];
    const GRN      = [16, 185, 129];
    const LIGHT    = [238, 241, 251];
    const WHITE    = [255, 255, 255];
    const OFFWHITE = [250, 251, 255];
    const GRAY     = [140, 150, 175];
    const GRAYLT   = [210, 215, 230];
    const TEXTDK   = [20, 35, 80];
    const SUBBG    = [244, 246, 251];
    const LOCALBG  = [249, 250, 253];

const visCo = orderedVisibleCompanies;
    const includeCompare = cmpVisible && includeCompareOpt;
    const showTotals = !includeCompare && includeTotalsOpt;
    const TARGET_PER_PAGE = includeCompare ? 2 : 3;

    // Chunk companies — each chunk is a self-contained section that renders
    // the FULL cash flow report for that subset of companies.
    const coChunks = (() => {
      if (visCo.length <= TARGET_PER_PAGE) return [{ companies: visCo, idx: 0 }];
      const nPages = Math.ceil(visCo.length / TARGET_PER_PAGE);
      const perPage = Math.ceil(visCo.length / nPages);
      const out = [];
      for (let i = 0; i < visCo.length; i += perPage) {
        out.push({ companies: visCo.slice(i, i + perPage), idx: out.length });
      }
      return out;
    })();

const monthLabel = month ? T(`month_${parseInt(month)}`) : "";
    const cmpMonthLabel = cmpMonth ? T(`month_${parseInt(cmpMonth)}`) : "";
    const pdfPeriod = multiOn ? multiPeriodText : `${monthLabel} ${year}`;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    // pageNum tracks the physical jsPDF page (page 1 reserved for TOC).
    let pageNum = 1;

    // Manifest: one entry PER PHYSICAL PAGE. Filled by autoTable hooks.
    // { displayedPage, chunkIdx, chunkCompanies: [], firstAccount, lastAccount }
    const pageManifest = [];

    // Filas del informe (las de la tabla). Con desglose, todo el árbol.
    const pdfItems = buildExportItems(drilldown, includeCompare);

    const getValAtCode = (code, co) => {
      const rows = pivot.get(code)?.[co] ?? [];
      return rows.reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
    };
const getCmpValAtCode = (code, co) => {
      const rows = cmpPivot.get(code)?.[co] ?? [];
      return rows.reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
    };

const fmt = v => {
      const num = Number(v);
      if (!Number.isFinite(num) || Math.round(num * 100) === 0) return "—";
      const abs = Math.abs(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return num < 0 ? `(${abs})` : abs;
    };
    // Δ y Δ% como en pantalla: con signo (+ / −) y coma decimal.
    const fmtDelta = v => (Number.isFinite(Number(v)) ? deltaText(Number(v)) : "—");
    const fmtPct = v => (v == null || !Number.isFinite(v) ? "—" : pctText(v));
    const toneOf = (v) => (Math.round((v ?? 0) * 10) === 0 ? GRAY : v > 0 ? GRN : RED);

    // Build rows for a chunk, but ALSO tag each row with the parent CF account
    // code it belongs to — autoTable's didDrawCell hook reads this tag to know
    // which CF accounts ended up on which physical page.
    const buildRowsForChunk = (chunkCompanies) => {
      const rows = [];
      const rowTags = []; // parallel array: rowTags[i] = { cfCode, cfName } for rows[i]
      let currentCfCode = null;
      let currentCfName = null;

      const pushAccountRow = ({ code, name, depth, isBold, leafCodes }) => {
        currentCfCode = code;
        currentCfName = name;
        const leaves = leafCodes ?? [code];
        const getValAt = (_c, co) => leaves.reduce((s2, lc) => s2 + getValAtCode(lc, co), 0);
        const getCmpValAt = (_c, co) => leaves.reduce((s2, lc) => s2 + getCmpValAtCode(lc, co), 0);
        const indent = "  ".repeat(Math.min(depth, 6));
        const codeStr = String(code ?? "").trim();
        const nameStr = String(name ?? "").trim() || "—";
        const label = `${indent}${codeStr ? codeStr + "  " : ""}${nameStr}`;
        const cells = [{ content: label, styles: { fontStyle: isBold ? "bold" : "normal", halign: "left" } }];

        chunkCompanies.forEach(co => {
          const a = getValAt(code, co);
          if (includeCompare) {
            const b = getCmpValAt(code, co);
            const delta = a - b;
            const pct = Math.abs(b) > 1e-9 ? ((a - b) / Math.abs(b)) * 100 : null;
            const dColor = (delta == null || Math.round(delta * 100) === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(a), styles: { fontStyle: isBold ? "bold" : "normal", textColor: a < 0 ? RED : TEXTDK } });
            cells.push({ content: fmt(b), styles: { fontStyle: isBold ? "bold" : "normal", textColor: REDDK } });
            cells.push({ content: fmtDelta(delta), styles: { fontStyle: isBold ? "bold" : "normal", textColor: dColor } });
            cells.push({ content: fmtPct(pct), styles: { fontStyle: isBold ? "bold" : "normal", textColor: pct == null ? GRAY : toneOf(pct) } });
          } else {
            cells.push({ content: fmt(a), styles: { fontStyle: isBold ? "bold" : "normal", textColor: a < 0 ? RED : TEXTDK } });
          }
        });
if (showTotals) {
          // Total de TODAS las sociedades (como en pantalla), no solo de las que
          // caben en esta página del PDF.
          const total = visCo.reduce((s, co) => s + getValAt(code, co), 0);
          cells.push({ content: fmt(total), styles: { fontStyle: "bold", fillColor: LIGHT, textColor: total < 0 ? RED : TEXTDK } });
        }
        rows.push(cells);
        rowTags.push({ cfCode: code, cfName: name });
      };

const pushGroupRow = ({ groupCode, groupName, depth, localRows, cmpMap }) => {
        const indent = "  ".repeat(Math.min(depth, 6));
        const label = `${indent}${groupCode}  ${groupName ?? ""}`.trim();
        const amtByCo = {};
        (localRows ?? []).forEach(lr => { amtByCo[lr.co] = (amtByCo[lr.co] ?? 0) + lr.amt; });

        const cells = [{ content: label, styles: { fontStyle: "italic", halign: "left", fillColor: SUBBG, textColor: NAVY } }];
        chunkCompanies.forEach(co => {
          const v = amtByCo[co] ?? 0;
          if (includeCompare) {
            const cmpV = cmpMap?.get(`GRP::${groupCode}::${co}`) ?? 0;
            const delta = v - cmpV;
            const pct = Math.abs(cmpV) > 1e-9 ? ((v - cmpV) / Math.abs(cmpV)) * 100 : null;
            const dColor = (Math.round(delta * 100) === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(v),    styles: { fontStyle: "bold", fillColor: SUBBG, textColor: v < 0 ? RED : NAVY } });
            cells.push({ content: fmt(cmpV), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: cmpV < 0 ? RED : REDDK } });
            cells.push({ content: fmtDelta(delta), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: dColor } });
            cells.push({ content: fmtPct(pct), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: pct == null ? GRAY : toneOf(pct) } });
          } else {
            cells.push({ content: fmt(v), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: v < 0 ? RED : NAVY } });
          }
        });
        if (!includeCompare) {
          const total = visCo.reduce((s, co) => s + (amtByCo[co] ?? 0), 0);
          cells.push({ content: fmt(total), styles: { fontStyle: "bold", fillColor: LIGHT, textColor: total < 0 ? RED : TEXTDK } });
        }
        rows.push(cells);
        rowTags.push({ cfCode: currentCfCode, cfName: currentCfName });
      };

const pushLocalRow = ({ localCode, localName, isJournal, co, amt, depth, groupCode, cmpMap }) => {
        const indent = "  ".repeat(Math.min(depth, 6));
        const tag = isJournal ? "[JRN] " : "";
        const label = `${indent}${tag}${localCode}  ${localName ?? ""}`.trim();
        const cells = [{ content: label, styles: { halign: "left", fillColor: LOCALBG, textColor: GRAY } }];
        chunkCompanies.forEach(coLoop => {
          const v = coLoop === co ? amt : 0;
          if (includeCompare) {
            const localKey = isJournal ? `JRN::${groupCode}::${localCode}::${coLoop}` : `ERP::${groupCode}::${localCode}::${coLoop}`;
            const cmpV = coLoop === co ? (cmpMap?.get(localKey) ?? 0) : 0;
            const delta = v - cmpV;
            const pct = Math.abs(cmpV) > 1e-9 ? ((v - cmpV) / Math.abs(cmpV)) * 100 : null;
            const dColor = (Math.round(delta * 100) === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(v),    styles: { fillColor: LOCALBG, textColor: v < 0 ? RED : TEXTDK } });
            cells.push({ content: fmt(cmpV), styles: { fillColor: LOCALBG, textColor: cmpV < 0 ? RED : REDDK } });
            cells.push({ content: fmtDelta(delta), styles: { fillColor: LOCALBG, textColor: dColor } });
            cells.push({ content: fmtPct(pct), styles: { fillColor: LOCALBG, textColor: pct == null ? GRAY : toneOf(pct) } });
          } else {
            cells.push({ content: fmt(v), styles: { fillColor: LOCALBG, textColor: v < 0 ? RED : TEXTDK } });
          }
        });
        if (!includeCompare) {
          cells.push({ content: fmt(amt), styles: { fillColor: LIGHT, textColor: amt < 0 ? RED : TEXTDK } });
        }
        rows.push(cells);
        rowTags.push({ cfCode: currentCfCode, cfName: currentCfName });
      };

      const pushBreaker = (label, colorHex) => {
        const colSpan = 1 + chunkCompanies.length * (includeCompare ? 4 : 1) + (includeCompare ? 0 : 1);
        const rgb = colorHex ? [
          parseInt(colorHex.slice(1, 3), 16),
          parseInt(colorHex.slice(3, 5), 16),
          parseInt(colorHex.slice(5, 7), 16),
        ] : NAVYDK;
        rows.push([{
          content: String(label).toUpperCase(),
          colSpan,
          styles: { fillColor: rgb, textColor: WHITE, fontStyle: "bold", halign: "left", fontSize: 9 },
        }]);
        rowTags.push({ isBreaker: true, label });
      };

// ── Filas: las mismas que la tabla, en el mismo orden ─────────────
      // Sin desglose: exactamente lo que se ve en pantalla. Con desglose:
      // todo el árbol (en PDF no se puede plegar).
      pdfItems.forEach(it => {
        if (!drilldown && !it.shown) return;
        if (it.type === "section") { if (includeBreakers) pushBreaker(it.label, it.color); return; }
        if (it.type === "empty") return;
        if (it.type === "cf") {
          pushAccountRow({ code: it.code, name: it.name, depth: it.depth, isBold: it.isSum, leafCodes: it.leafCodes });
          return;
        }
        if (it.type === "group") {
          pushGroupRow({ groupCode: it.g.groupCode, groupName: it.g.groupName, depth: it.depth + 1, localRows: it.g.localRows, cmpMap: it.cmpMap });
          return;
        }
        if (it.type === "local") {
          pushLocalRow({
            localCode: it.r.localCode, localName: it.r.localName, isJournal: it.r.isJournal, co: it.r.co, amt: it.r.amt,
            depth: it.depth + 2, groupCode: it.g.groupCode, cmpMap: it.cmpMap,
          });
        }
      });
      return { rows, rowTags };
    };

    // ─── Page header / footer drawn on each physical page ────────────
    const drawPageHeader = (chunkInfo) => {
      doc.setFillColor(...NAVY); doc.rect(0, 0, W, 38, "F");
      doc.setFillColor(...RED);  doc.rect(0, 0, 5, 38, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.setTextColor(...WHITE);
     doc.text(T("cf_export_title").toUpperCase(), 12, 14);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(180, 200, 255);
      const sub = [`${pdfPeriod}`, source, structure].filter(Boolean).join("  ·  ");
      doc.text(sub, 12, 22);

      doc.setFontSize(7);
      doc.setTextColor(160, 180, 235);
      const companiesLabel = `${T("filter_company")} (${T("cf_set")} ${chunkInfo.idx + 1}/${coChunks.length}): ${chunkInfo.companies.map(c => getLegal(c)).join(", ")}`;
      doc.text(companiesLabel, 12, 29, { maxWidth: W - 60 });

if (includeCompare && cmpYear && cmpMonth) {
        const cmpSub = [`${T("file_b_prefix")}: ${cmpMonthLabel} ${cmpYear}`, cmpSource, structure].filter(Boolean).join("  ·  ");
        doc.setFillColor(...REDDK);
        doc.roundedRect(12, 32, Math.min(W - 24, 220), 5.5, 1, 1, "F");
        doc.setFontSize(7);
        doc.setTextColor(...WHITE);
        doc.text(cmpSub, 14, 35.7);
      }

      // Badges
      let curX = W - 8;
      const placeBadge = (label, fill, textColor) => {
        const w = Math.max(22, doc.getTextWidth(label) + 8);
        doc.setFillColor(...fill);
        doc.roundedRect(curX - w, 6, w, 9, 2, 2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...textColor);
        doc.text(label, curX - w / 2, 11.8, { align: "center" });
        curX -= (w + 3);
      };
if (activeMapping) placeBadge(T("badge_mapped"), [16, 185, 129], WHITE);
      placeBadge(T("nav_cashflow").toUpperCase(), NAVYDK, [160, 185, 255]);
      if (includeCompare) placeBadge(T("badge_compare"), REDDK, WHITE);
      if (coChunks.length > 1) placeBadge(`${T("cf_set").toUpperCase()} ${chunkInfo.idx + 1}/${coChunks.length}`, REDDK, WHITE);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...GRAY);
     doc.text(`${T("file_generated")} ${new Date().toLocaleDateString()}`, W - 8, 22, { align: "right" });

      doc.setDrawColor(...NAVYMID);
      doc.setLineWidth(0.4);
      doc.line(0, 38, W, 38);
    };

    const drawFooter = (chunkInfo) => {
      doc.setFillColor(...LIGHT);
      doc.rect(0, H - 10, W, 10, "F");
      doc.setDrawColor(...GRAYLT);
      doc.setLineWidth(0.3);
      doc.line(0, H - 10, W, H - 10);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...NAVY);
doc.text(T("nav_cashflow").toUpperCase(), 10, H - 4.5);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      const setPart = coChunks.length > 1 ? ` · ${T("cf_set")} ${chunkInfo.idx + 1}/${coChunks.length}` : "";
      doc.text(`${pdfPeriod}  ·  ${source}${setPart}`, 36, H - 4.5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...NAVY);
      doc.text(`${pageNum}`, W - 10, H - 4.5, { align: "right" });
    };

    // ─── Render one chunk (set of companies) — autoTable handles pagination ──
    const renderChunk = (chunkInfo) => {
      const { companies: chunkCompanies } = chunkInfo;
      const subColsPerCo = includeCompare ? 4 : 1;
   const showTotals = !includeCompare && includeTotalsOpt;
      const totalColCount = 1 + chunkCompanies.length * subColsPerCo + (showTotals ? 1 : 0);

      let head;
      if (includeCompare) {
const top = [{ content: T("col_account"), rowSpan: 2, styles: { halign: "left", fillColor: NAVYDK, valign: "middle" } }];
        const bot = [];
        chunkCompanies.forEach(co => {
          top.push({ content: getLegal(co), colSpan: 4, styles: { halign: "center", fillColor: NAVY } });
        });
        chunkCompanies.forEach(() => {
          bot.push({ content: T("file_col_a"),  styles: { halign: "right", fillColor: NAVYMID } });
          bot.push({ content: T("file_col_b"),  styles: { halign: "right", fillColor: REDDK } });
          bot.push({ content: "Δ",  styles: { halign: "right", fillColor: REDDK } });
          bot.push({ content: "Δ%", styles: { halign: "right", fillColor: REDDK } });
        });
        head = [top, bot];
      } else {
       head = [[T("col_account"), ...chunkCompanies.map(co => getLegal(co)), ...(showTotals ? [T("col_total")] : [])]];
      }

      const { rows: body, rowTags } = buildRowsForChunk(chunkCompanies);

      const usable = W - 16;
      const nameW = usable * (totalColCount > 10 ? 0.26 : totalColCount > 6 ? 0.32 : 0.38);
      const remaining = usable - nameW;

      const columnStyles = { 0: { halign: "left", cellWidth: nameW } };
      if (includeCompare) {
        const dimBlock = remaining / chunkCompanies.length;
        const wA = dimBlock * 0.30;
        const wB = dimBlock * 0.30;
        const wD = dimBlock * 0.25;
        const wP = dimBlock * 0.15;
        for (let i = 0; i < chunkCompanies.length; i++) {
          columnStyles[1 + i * 4]     = { halign: "right", cellWidth: wA };
          columnStyles[1 + i * 4 + 1] = { halign: "right", cellWidth: wB };
          columnStyles[1 + i * 4 + 2] = { halign: "right", cellWidth: wD };
          columnStyles[1 + i * 4 + 3] = { halign: "right", cellWidth: wP };
        }
      } else {
        const valueColCount = chunkCompanies.length + 1;
        const colW = remaining / valueColCount;
        for (let i = 0; i < chunkCompanies.length; i++) {
          columnStyles[i + 1] = { halign: "right", cellWidth: colW };
        }
        columnStyles[chunkCompanies.length + 1] = { halign: "right", cellWidth: colW, fillColor: LIGHT, fontStyle: "bold" };
      }

      const bodyFont = totalColCount <= 6 ? 8.5 : totalColCount <= 9 ? 7.8 : 7;
      const headFont = Math.max(6.5, bodyFont - 0.5);

      // Track which physical page each body row lands on.
      // didParseCell fires for each cell before it's drawn — we use it to
      // record the row's parent CF code on every physical page transition.
      let lastSeenPage = -1;
      const physicalPageFirstRow = new Map(); // physicalPage → first body row index on that page
      const physicalPageLastRow  = new Map(); // physicalPage → last body row index on that page

      autoTable(doc, {
        startY: 42,
        head,
        body,
        margin: { left: 8, right: 8, top: 42, bottom: 14 },
        tableWidth: usable,
        styles: {
          fontSize: bodyFont,
          cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 },
          overflow: "linebreak",
          font: "helvetica",
          textColor: TEXTDK,
          lineColor: GRAYLT,
          lineWidth: 0.12,
          valign: "middle",
        },
        headStyles: {
          fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: headFont,
          cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
          halign: "right", lineWidth: 0,
          overflow: "linebreak",
          valign: "middle",
        },
        columnStyles,
        alternateRowStyles: { fillColor: OFFWHITE },
didParseCell: d => {
          if (d.section === "head" && d.column.index === 0) {
            d.cell.styles.fillColor = NAVYDK;
            d.cell.styles.halign = "left";
          }
          // Frame each company block with a stronger left border so groups
          // visually separate (mirrors the xlsx medium-left-border treatment).
          // In compare mode each company spans 4 cols (A/Σcmp/Δ/Δ%). Otherwise
          // one col per company. The Total column (if shown) also gets a divider.
          const subCols = includeCompare ? 4 : 1;
          const colIdx = d.column.index;
          const isCompanyStart = colIdx >= 1 && ((colIdx - 1) % subCols === 0) && colIdx <= chunkCompanies.length * subCols;
          const isTotalDivider = showTotals && colIdx === (chunkCompanies.length * subCols + 1);
          if (isCompanyStart || isTotalDivider) {
            d.cell.styles.lineWidth = { ...(d.cell.styles.lineWidth || {}), left: 0.5 };
            d.cell.styles.lineColor = { ...(d.cell.styles.lineColor || {}), left: [110, 120, 145] };
          }
        },
        didDrawCell: d => {
          if (d.section !== "body" || d.column.index !== 0) return;
          const physPage = doc.internal.getCurrentPageInfo().pageNumber;
          const rowIdx = d.row.index;
          if (!physicalPageFirstRow.has(physPage)) physicalPageFirstRow.set(physPage, rowIdx);
          physicalPageLastRow.set(physPage, rowIdx);
        },
        willDrawPage: () => {
          // First page of this chunk uses pageNum already advanced; subsequent
          // pages within the same chunk: jsPDF auto-adds, increment our counter.
          const physPage = doc.internal.getCurrentPageInfo().pageNumber;
          if (physPage !== lastSeenPage) {
            lastSeenPage = physPage;
            if (pageManifest.length > 0 && physPage > pageNum) {
              // autoTable created a new physical page during this chunk
              pageNum = physPage;
            }
            drawPageHeader(chunkInfo);
          }
        },
        didDrawPage: () => {
          drawFooter(chunkInfo);
        },
      });

      // After the chunk renders, populate manifest entries: one per physical
      // page this chunk occupied, with the CF accounts that ended up on it.
      const sortedPages = [...physicalPageFirstRow.keys()].sort((a, b) => a - b);
      sortedPages.forEach(physPage => {
        const firstIdx = physicalPageFirstRow.get(physPage);
        const lastIdx = physicalPageLastRow.get(physPage);

        // Walk rowTags from firstIdx to lastIdx, collect unique CF accounts.
        const cfAccountsOnPage = [];
        const seen = new Set();
        for (let i = firstIdx; i <= lastIdx; i++) {
          const tag = rowTags[i];
          if (!tag || tag.isBreaker) continue;
          if (!tag.cfCode) continue;
          const key = String(tag.cfCode);
          if (seen.has(key)) continue;
          seen.add(key);
          cfAccountsOnPage.push({ code: tag.cfCode, name: tag.cfName });
        }

        pageManifest.push({
          displayedPage: physPage,
          chunkIdx: chunkInfo.idx,
          totalChunks: coChunks.length,
          chunkCompanies: chunkInfo.companies.map(c => getLegal(c)),
          cfAccounts: cfAccountsOnPage,
        });
      });
    };

    // ─── Reserve page 1 for TOC ──────────────────────────────────────
    // Render all content pages first, then come back and draw TOC on page 1.
coChunks.forEach((chunkInfo) => {
      doc.addPage();
      pageNum = doc.internal.getCurrentPageInfo().pageNumber;
      renderChunk(chunkInfo);
    });

// ─── Render TOC: paginated across as many pages as needed ────────
    // Step 1: build all TOC entries as a flat list of "items" (set headers
    // mixed with page entries). Step 2: split items into pages so each TOC
    // page has ~22 lines of content.

    const tocItems = [];
    const byChunk = new Map();
    pageManifest.forEach(entry => {
      if (!byChunk.has(entry.chunkIdx)) byChunk.set(entry.chunkIdx, []);
      byChunk.get(entry.chunkIdx).push(entry);
    });

[...byChunk.keys()].sort((a, b) => a - b).forEach(chunkIdx => {
      const entries = byChunk.get(chunkIdx);
      const first = entries[0];
      tocItems.push({
        kind: "setHeader",
        label: `${T("cf_set").toUpperCase()} ${chunkIdx + 1}/${first.totalChunks}  ·  ${first.chunkCompanies.join("  ·  ")}`,
      });
      entries.forEach(entry => {
        let accSummary;
        if (entry.cfAccounts.length === 0) {
          accSummary = T("cf_toc_continued");
        } else if (entry.cfAccounts.length === 1) {
          const a = entry.cfAccounts[0];
          accSummary = `${a.code} ${a.name ?? ""}`.trim();
        } else if (entry.cfAccounts.length <= 3) {
          accSummary = entry.cfAccounts.map(a => `${a.code} ${a.name ?? ""}`.trim()).join("  ·  ");
        } else {
          const f = entry.cfAccounts[0];
          const l = entry.cfAccounts[entry.cfAccounts.length - 1];
          accSummary = `${f.code} ${f.name ?? ""}  →  ${l.code} ${l.name ?? ""}  (${entry.cfAccounts.length} ${T("cf_accounts_lower")})`;
        }
        tocItems.push({
          kind: "page",
          pageNum: entry.displayedPage,
          summary: accSummary,
        });
      });
      tocItems.push({ kind: "spacer" });
    });

    // Step 2: how many TOC pages do we need? Reserve them now BEFORE the
    // content pages by inserting blank pages at position 1, then shifting
    // content page numbers up by (tocPagesNeeded - 1). We already reserved
    // page 1, but if we need more TOC pages we must insert them.

    // Approximate items-per-page calculation: page 1 has bigger header (banner
    // ~50mm + CONTENTS title ~15mm). Subsequent TOC pages have a slim banner.
    // Available body height: ~(H - 50 - 18 - 14) for page 1; ~(H - 24 - 14) after.
    const ITEM_H = { setHeader: 9, page: 9, spacer: 4 };
    const TOC_FIRST_TOP   = 76;            // y where items start on page 1
    const TOC_OTHER_TOP   = 32;            // y where items start on pages 2..N of TOC
    const TOC_BOTTOM      = H - 18;

    // First, simulate pagination to count how many TOC pages we need.
    let simY = TOC_FIRST_TOP;
    let tocPagesNeeded = 1;
tocItems.forEach((item) => {
      const h = ITEM_H[item.kind];
      if (simY + h > TOC_BOTTOM) {
        tocPagesNeeded++;
        simY = TOC_OTHER_TOP;
      }
      // Set header can't be the last item on a page (looks orphaned).
      // If it would be, treat its actual line + the following first page entry
      // as a unit. We approximate by reserving extra space.
      simY += h;
    });

    // We already wrote pageNum content pages starting from physical page 2.
    // Now we need to insert (tocPagesNeeded - 1) additional TOC pages BEFORE
    // them. jsPDF supports doc.insertPage(idx); when we insert at idx=2, the
    // existing page 2 becomes page 3, etc. We must also update the page
    // numbers in pageManifest AND repaint the footer page numbers on each
    // content page (since drawFooter wrote pageNum as text already).
    // To avoid having to repaint footers, the simplest robust approach is:
    // generate the entire TOC text with the FINAL page numbers (after shift),
    // then insert blank TOC pages and draw onto them.

    const tocPageShift = tocPagesNeeded - 1;

    if (tocPageShift > 0) {
      // Insert extra TOC pages right after page 1.
      for (let i = 0; i < tocPageShift; i++) {
        doc.insertPage(2);
      }
      // Shift the page numbers in our manifest, but since we already drew
      // the footers with the OLD page numbers, repaint them.
      pageManifest.forEach(entry => { entry.displayedPage += tocPageShift; });

      // Repaint footers: walk every shifted content page and overwrite the
      // page number at the bottom right with the new value.
      pageManifest.forEach(entry => {
        doc.setPage(entry.displayedPage);
        // Cover the old number with the footer band color, then re-draw.
        doc.setFillColor(...LIGHT);
        doc.rect(W - 30, H - 10, 25, 10, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...NAVY);
        doc.text(`${entry.displayedPage}`, W - 10, H - 4.5, { align: "right" });
      });
    }

    // Draw the TOC across however many pages we need.
    let tocPageIdx = 0;
    let curY = TOC_FIRST_TOP;

    const drawTocPageHeader = (isFirst) => {
      doc.setPage(tocPageIdx + 1);
if (isFirst) {
        doc.setFillColor(...NAVY); doc.rect(0, 0, W, 50, "F");
        doc.setFillColor(...RED);  doc.rect(0, 0, 5, 50, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.setTextColor(...WHITE);
        doc.text(T("cf_report_title").toUpperCase(), 12, 22);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(180, 200, 255);
        const tocSub = [`${pdfPeriod}`, source, structure].filter(Boolean).join("  ·  ");
        doc.text(tocSub, 12, 33);

        doc.setFontSize(8);
        doc.setTextColor(160, 180, 235);
doc.text(
          `${includeCompare ? T("file_compare_on") : T("file_single_period")}  ·  ${coChunks.length} ${coChunks.length === 1 ? T("cf_company_set_one") : T("cf_company_set_many")}  ·  ${pageManifest.length} ${pageManifest.length === 1 ? T("file_content_page_one") : T("file_content_page_many")}  ·  ${T("file_generated")} ${new Date().toLocaleDateString()}`,
          12, 42,
        );

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(...NAVY);
        doc.text(T("file_contents"), 12, 64);
        doc.setDrawColor(...NAVY);
        doc.setLineWidth(0.5);
        doc.line(12, 67, W - 12, 67);
      } else {
        // Slim banner for continuation pages
        doc.setFillColor(...NAVY); doc.rect(0, 0, W, 22, "F");
        doc.setFillColor(...RED);  doc.rect(0, 0, 5, 22, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...WHITE);
        doc.text(`${T("file_contents")}  (${T("cf_toc_continued_short")}, ${tocPageIdx + 1}/${tocPagesNeeded})`, 12, 14);
      }

      // Footer
      doc.setFillColor(...LIGHT);
      doc.rect(0, H - 10, W, 10, "F");
      doc.setDrawColor(...GRAYLT);
      doc.setLineWidth(0.3);
      doc.line(0, H - 10, W, H - 10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...NAVY);
doc.text(T("cf_report_title").toUpperCase(), 10, H - 4.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text(`${T("file_index")} ${tocPageIdx + 1}/${tocPagesNeeded}  ·  ${pdfPeriod}  ·  ${source}`, 50, H - 4.5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...NAVY);
      doc.text(`${tocPageIdx + 1}`, W - 10, H - 4.5, { align: "right" });
    };

    const truncate = (str, maxW) => {
      if (doc.getTextWidth(str) <= maxW) return str;
      while (doc.getTextWidth(str + "…") > maxW && str.length > 4) str = str.slice(0, -1);
      return str + "…";
    };

    drawTocPageHeader(true);

    let rowZebra = 0;
tocItems.forEach((item) => {
      const h = ITEM_H[item.kind];
      if (curY + h > TOC_BOTTOM) {
        tocPageIdx++;
        drawTocPageHeader(false);
        curY = TOC_OTHER_TOP;
        rowZebra = 0;
      }

      if (item.kind === "setHeader") {
        doc.setFillColor(...NAVY);
        doc.rect(10, curY - 5, W - 20, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...WHITE);
        doc.text(truncate(item.label, W - 28), 13, curY);
        curY += h;
        rowZebra = 0;
      } else if (item.kind === "page") {
        if (rowZebra % 2 === 0) {
          doc.setFillColor(248, 249, 255);
          doc.rect(10, curY - 5, W - 20, h, "F");
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...NAVY);
        doc.text(`p.${item.pageNum}`, 16, curY);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXTDK);
        doc.text(truncate(item.summary, W - 50), 30, curY);

        curY += h;
        rowZebra++;
      } else if (item.kind === "spacer") {
        curY += h;
      }
    });

    doc.save(`Konsolidator_CashFlow_${year}_${String(month).padStart(2, "0")}.pdf`);
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

<PageHeader
kicker={viewsMode ? T("mappings") : T("kicker_reports")}
        title={
          viewsMode === "landing"   ? T("mappings")
          : viewsMode === "structure" ? T("views_structure_mappings")
          : viewsMode === "report"    ? T("views_report_mappings")
          : T("nav_cashflow")
        }
        onBack={viewsMode ? () => { if (viewsMode === "landing") setViewsMode(null); else setViewsMode("landing"); } : undefined}
        filters={viewsMode ? [] : [
...(effectiveSources.length > 0
            ? [{ label: T("filter_source"), value: source, onChange: setSource,
                options: effectiveSources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s })) }]
            : []),
          ...(availableYears.length > 0
            ? [{
                // Varios años a la vez (los meses de cada uno se eligen en "Mes")
                label: T("filter_year"), multiselect: true,
                values: multiPeriods.length ? multiPeriods.map(p => p.year) : (year ? [String(year)] : []),
                onChange: (vs) => {
                  const years = (vs && vs.length) ? vs.map(String) : [];
                  setMultiPeriods(prev => {
                    const base = prev.length ? prev : (year ? [{ year: String(year), months: month ? [Number(month)] : [] }] : []);
                    const byYear = new Map(base.map(p => [p.year, p]));
                    return years
                      .map(y => byYear.get(y) ?? { year: y, months: years.length === 1 && month ? [Number(month)] : [] })
                      .sort((a, b) => Number(a.year) - Number(b.year));
                  });
                  if (years.length === 1) setYear(years[0]);
                },
                options: availableYears,
              }]
            : []),
          ...(availableMonths.length > 0
            ? [{
                label: T("filter_month"),
                render: () => (
                  <CfMonthsPill periods={multiPeriods} singleYear={year} singleMonth={month} primary={colors.primary}
                    onChange={(next) => {
                      setMultiPeriods(next);
                      // Un solo mes de un solo año: la página vuelve al modo normal
                      const withMonths = next.filter(p => p.months?.length);
                      if (!isMultiSelection(next) && withMonths.length === 1) {
                        setYear(withMonths[0].year);
                        setMonth(String(withMonths[0].months[0]));
                      }
                    }} />
                ),
              }]
            : []),
          ...(effectiveStructures.length > 0
            ? [{ label: T("filter_structure"), value: structure, onChange: setStructure,
                options: effectiveStructures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s })) }]
            : []),
...(effectiveContributionCompanies.length > 1
            ? [{
                label: T("filter_company"),
                multiselect: true,
                values: selectedCompanies,
                onChange: setSelectedCompanies,
                options: effectiveContributionCompanies.map(c => ({
                  value: c,
                  label: companies.find(x => x.CompanyShortName === c)?.CompanyLegalName || c,
                })),
              }]
            : []),
...(dimGroups.length > 0
            ? [{ label: T("filter_dim_group"), multiselect: true, values: upDimGroups,
                onChange: vs => { setUpDimGroups(vs); setUpDimensions(null); },
               options: dimGroups.map(g => ({ value: g, label: g })) }]
            : []),
          ...(filteredDims.length > 0
            ? [{ label: T("filter_dims"), multiselect: true, values: upDimensions,
                onChange: setUpDimensions,
                options: filteredDims.map(d => {
const meta = dimensionsMeta.find(m =>
                    (m.dimensionCode ?? m.DimensionCode ?? m.code ?? m.Code) === d.code
                  );
                  const name = meta?.dimensionName ?? meta?.DimensionName ?? meta?.name ?? meta?.Name;
                  return { value: d.code, label: name ?? d.code };
                }) }]
            : []),
        ]}
compareToggle={(viewsMode || multiOn) ? null : {
          active: compareMode,
          onChange: setCompareMode,
          disabled: !metaReady || effectiveSources.length === 0 || effectiveStructures.length === 0,
          // Motivo real (el PageHeader mostraba siempre "desactiva el historial").
          disabledReason: !metaReady
            ? T("cf_compare_loading", "Cargando periodos…")
            : T("cf_compare_unavailable", "No hay fuentes o estructuras disponibles para comparar"),
        }}
onExportPdf={viewsMode ? undefined : () => {
          setExportOpts(o => ({ ...o, format: "pdf" }));
          setExportModal(true);
        }}
        onExportXlsx={viewsMode ? undefined : () => {
          setExportOpts(o => ({ ...o, format: "xlsx" }));
          setExportModal(true);
        }}
        onMappingsClick={viewsMode ? undefined : () => setViewsMode("landing")}
        mappingsQuickAccess={viewsMode ? [] : recentMappings}
onQuickApplyMapping={async (m) => {
          try {
            if (m.kind === "report") {
              // El API de reporte no tiene getMapping; m.raw ya trae cf_tree.
              handleApplyMapping(m.raw, "report");
            } else {
              const mod = await import("../../../lib/cashflowMappingsApi");
              const full = mod.getMapping ? await mod.getMapping(m.id) : null;
              handleApplyMapping(full ?? m.raw, "structure");
            }
          } catch (e) { console.error("[CF quick apply] error:", e); }
        }}
      />

{activeMapping && !activeMapping.is_hidden && activeMapping.name !== "__custom_override__" && !viewsMode && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm flex-shrink-0">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
<span className="text-xs text-emerald-700 font-medium">
            {T("mapping_active_label")}: <strong className="font-black">{activeMapping.name}</strong>
            <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
          </span>
          <button
onClick={() => {
              const payload = {
                mapping_id: activeMapping.mapping_id,
                kind: activeMapping.kind ?? "structure",
              };
              try {
                sessionStorage.setItem("cashflow-mappings:openForEdit", JSON.stringify(payload));
              } catch { /* ignore storage errors */ }
              onNavigate?.("cashflow-mappings");
            }}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
title={T("edit_mapping_title")}
          >
            <Pencil size={11} />
            {T("btn_edit")}
          </button>
<button
            onClick={() => {
              // Restore the initial default (system hidden override) instead of
              // dropping to the raw standard. Fall back to null if none loaded.
              const ho = hiddenOverrideRef.current;
              if (ho && Array.isArray(ho.cf_tree) && ho.cf_tree.length > 0) {
                handleApplyMapping(ho, "structure");
              } else {
                setActiveMapping(null);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
            title={T("clear_mapping_title")}
          >
            <X size={11} />
            {T("btn_clear")}
          </button>
        </div>
      )}

{cmpVisible && !viewsMode && <div className="flex-shrink-0 overflow-hidden" style={{
        maxHeight: cmpExiting ? 0 : 200,
        opacity: cmpExiting ? 0 : 1,
        marginBottom: cmpExiting ? 0 : undefined,
        transition: "max-height 380ms cubic-bezier(0.4,0,0.2,1), opacity 280ms cubic-bezier(0.4,0,0.2,1), margin-bottom 380ms cubic-bezier(0.4,0,0.2,1)",
      }}>
      <div className={`flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm ${cmpExiting ? "" : styles.cmpBarIn}`}
        style={{ transformOrigin: "top center" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("btn_compare_with")}</span>
          </div>
          <HeaderFilterPill label={T("filter_source")} value={cmpSource} onChange={setCmpSource}
          options={effectiveSources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          <HeaderFilterPill label={T("filter_year")} value={cmpYear} onChange={setCmpYear}
            options={availableYears} />
          <HeaderFilterPill label={T("filter_month")} value={cmpMonth} onChange={setCmpMonth}
            options={availableMonths.map(o => ({ value: o.value, label: T(`month_${o.value}`) }))} />
          <HeaderFilterPill label={T("filter_structure")} value={structure} onChange={() => {}}
       options={effectiveStructures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))} />
{cmpLoading && <Loader2 size={11} className="animate-spin ml-2" style={{ color: colors.primary }} />}
</div></div>}

{viewsMode ? (
        <div className="flex-1 flex flex-col min-h-0">
          <style>{`
            @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
            @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
          `}</style>

          {viewsMode === "landing" && (
            <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
              <button onClick={() => setViewsMode("structure")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a18 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#1a2f8a0d 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
                </div>
                <div className="relative z-10 flex flex-col h-full p-8">
                  <div className="mb-auto">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                      style={{ background: "linear-gradient(145deg, #1a2f8a 0%, #3b54b8 100%)" }}>
<Layers size={26} className="text-white" strokeWidth={1.8} />
                    </div>
                    <p className="font-black text-xl text-gray-800 mb-2">{T("views_structure_mappings")}</p>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{T("cf_landing_structure_desc")}</p>
                  </div>
                </div>
              </button>

              <button onClick={() => setViewsMode("report")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#CF305D] flex flex-col"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)", boxShadow: "0 8px 32px -8px rgba(207,48,93,0.18)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, #CF305D18 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#CF305D0d 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
                </div>
                <div className="relative z-10 flex flex-col h-full p-8">
                  <div className="mb-auto">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                      style={{ background: "linear-gradient(145deg, #CF305D 0%, #e05585 100%)" }}>
<FileText size={26} className="text-white" strokeWidth={1.8} />
                    </div>
                    <p className="font-black text-xl text-gray-800 mb-2">{T("views_report_mappings")}</p>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{T("cf_landing_report_desc")}</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {viewsMode === "structure" && (
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
<div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{T("views_library")}</p>
                <p className="font-black text-xs text-gray-700">{T("cf_saved_structure_mappings")}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {savedMappingsLoading && <div className="py-16 text-center"><Loader2 size={24} className="text-[#1a2f8a] animate-spin mx-auto mb-2" /><p className="text-gray-400 text-xs">{T("views_loading_mappings")}</p></div>}
                {savedMappingsError && !savedMappingsLoading && <div className="py-12 text-center"><p className="text-red-500 text-xs font-bold">{savedMappingsError}</p></div>}
                {!savedMappingsLoading && !savedMappingsError && savedMappings.length === 0 && <div className="py-16 text-center"><Library size={24} className="text-[#1a2f8a] mx-auto mb-2" /><p className="text-gray-700 font-black text-sm">{T("views_no_mappings")}</p></div>}
                {!savedMappingsLoading && !savedMappingsError && savedMappings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {savedMappings.map(m => {
                      const isActive = activeMapping?.mapping_id === m.mapping_id;
                      return (
                        <button key={m.mapping_id}
                          onClick={async () => {
                            try {
                              const { getMapping } = await import("../../../lib/cashflowMappingsApi");
                              const full = await getMapping(m.mapping_id);
handleApplyMapping(full ?? m, "structure");
                              setViewsMode(null);
                            } catch { /* ignore */ }
                          }}
                          className="text-left bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md group flex flex-col"
                          style={{ borderColor: isActive ? colors.primary : "#f3f4f6", background: isActive ? `${colors.primary}06` : "white" }}>
                          <div className="flex items-start gap-2.5 mb-3">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isActive ? colors.primary : "#eef1fb" }}>
                              <Layers size={14} style={{ color: isActive ? "white" : colors.primary }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-xs text-gray-800 truncate">{m.name ?? "Untitled"}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: colors.primary }}>{m.standard ?? "—"}</p>
                            </div>
                          </div>
<div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                            <span className="text-[9px] text-gray-400">{T("views_updated")} {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white"><CheckCircle2 size={9} />{T("views_apply")}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {viewsMode === "report" && (
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
              <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{T("views_library")}</p>
                <p className="font-black text-xs text-gray-700">{T("cf_saved_report_mappings")}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {reportMappingsLoading && <div className="py-16 text-center"><Loader2 size={24} className="text-[#CF305D] animate-spin mx-auto mb-2" /><p className="text-gray-400 text-xs">{T("views_loading_report_mappings")}</p></div>}
                {reportMappingsError && !reportMappingsLoading && <div className="py-12 text-center"><p className="text-red-500 text-xs font-bold">{reportMappingsError}</p></div>}
                {!reportMappingsLoading && !reportMappingsError && reportMappings.length === 0 && <div className="py-16 text-center"><FileText size={24} className="text-[#CF305D] mx-auto mb-2" /><p className="text-gray-700 font-black text-sm">{T("views_no_report_mappings")}</p></div>}
                {!reportMappingsLoading && !reportMappingsError && reportMappings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {reportMappings.map(m => {
                      const isActive = activeMapping?.mapping_id === m.mapping_id;
                      return (
                        <button key={m.mapping_id}
onClick={() => {
                            // listMappings ya trae cf_tree (select=*), no hay getMapping
                            // en el API de reporte: aplicamos la fila directamente.
                            handleApplyMapping(m, "report");
                            setViewsMode(null);
                          }}
                          className="text-left bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md group flex flex-col"
                          style={{ borderColor: isActive ? "#CF305D" : "#f3f4f6", background: isActive ? "#CF305D06" : "white" }}>
                          <div className="flex items-start gap-2.5 mb-3">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isActive ? "#CF305D" : "#fef1f5" }}>
                              <FileText size={14} style={{ color: isActive ? "white" : "#CF305D" }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-xs text-gray-800 truncate">{m.name ?? "Untitled"}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "#CF305D" }}>{m.standard ?? "—"}</p>
                            </div>
                          </div>
<div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                            <span className="text-[9px] text-gray-400">{T("views_updated")} {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white"><CheckCircle2 size={9} />{T("views_apply")}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className={`relative ${multiLoading ? styles.multiBusy : ""} bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col`}>
{multiLoading && <CfMultiLoader periods={multiPeriods} progress={multiProg} colors={colors} />}
{!metaReady || !firstLoadDone || (loading && uploadedData.length === 0) ? (
            <CfLoadingSpinner colors={colors} metaReady={metaReady} accountsReady={groupAccountsCf.length > 0} dataReady={firstLoadDone} T={T} />
) : loadError && !hasData ? (
            <div className={styles.loadError}>
              <p className={styles.loadErrorTitle}>{T("cf_load_error", "No se han podido cargar los datos")}</p>
              <p className={styles.loadErrorText}>{T("cf_load_error_hint", "La conexión ha fallado o ha tardado demasiado.")}</p>
              <button type="button" className={styles.downloadBtn} style={{ "--cf-primary": colors.primary }}
                onClick={() => { autoPeriodDone.current = false; setMetaReady(false); setFirstLoadDone(false); setReloadKey(k => k + 1); }}>
                {T("btn_retry", "Reintentar")}
              </button>
            </div>
) : !hasData ? (
            <div className="flex items-center justify-center flex-1 text-xs text-gray-300 font-black uppercase tracking-widest">
              {T("no_data")}
            </div>
          ) : (
<CashFlowTable
              T={T} colors={colors} loading={loading}
              typo={cfTypo}
              companies={companies} orderedVisibleCompanies={orderedVisibleCompanies} getLegal={getLegal} compareMode={compareMode}
              colOrder={colOrder} setColOrder={setColOrder}
              draggingCol={draggingCol} setDraggingCol={setDraggingCol} dragOverCol={dragOverCol} setDragOverCol={setDragOverCol}
              searchActive={searchActive} setSearchActive={setSearchActive} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              searchInputRef={searchInputRef}
              toggleExpandAll={toggleExpandAll} anyRowOpen={anyRowOpen} expandAllState={expandAllState}
              expandAllVersion={expandAllVersion} bumpOpenCount={bumpOpenCount}
              cfLiteral={activeMapping?.cfLiteral ?? customCfLiteral}
              sectionOrder={sectionOrder} bySection={bySection} activeCfMapping={activeCfMapping}
              subtotalCodes={subtotalCodes} matchedCfCodes={matchedCfCodes} nameFor={nameFor}
              pivot={pivot} cmpPivot={cmpPivot}
              multiPeriods={multiOn ? multiPeriods : null}
              uploadedData={filteredUploadedData} journalEntries={journalEntries}
              cmpUploadedData={cmpUploadedData} cmpJournalEntries={cmpJournalEntries} groupToCf={groupToCf}
              onViewState={handleViewState}
            />
          )}
</div>
      </div>
      )}
      {exportModal && (
        <CashFlowExportModal
          T={T} colors={colors} exportOpts={exportOpts} setExportOpts={setExportOpts}
          cmpVisible={cmpVisible} activeMapping={activeMapping}
          year={year} month={month} source={source} cmpYear={cmpYear} cmpMonth={cmpMonth} cmpSource={cmpSource}
          periodText={multiOn ? multiPeriodText : null}
          exporting={exporting}
          onClose={() => setExportModal(false)}
          onDownload={async () => {
            const fn = exportOpts.format === "pdf" ? handleExportPdf : handleExportXlsx;
            setExportModal(false);
            setExporting(true);
            try { await fn(exportOpts); }
            finally { setExporting(false); }
          }}
        />
      )}
    </div>
  );
}