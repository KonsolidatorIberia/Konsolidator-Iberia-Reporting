import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X, Plus, Search, FilePlus, Library, ChevronDown, ChevronRight, Clock, FileText,
  Sparkles, CheckCircle2, Pencil, Trash2, Check, Copy,
} from "lucide-react";
import PageHeader from "../layout/PageHeader.jsx";
import {
  listMappings as listCfMappings,
  createMapping as createCfMapping,
  updateMapping as updateCfMapping,
  archiveMapping as archiveCfMapping,
  getActiveCompanyId,
} from "../../lib/cashflowMappingsApi";
import {
  listMappings as listCfReportMappings,
  createMapping as createCfReportMapping,
  updateMapping as updateCfReportMapping,
  archiveMapping as archiveCfReportMapping,
} from "../../lib/cashflowReportMappingsApi";
import { supabase } from "../../lib/supabaseClient";
import { useCurrentUserResourceAccess } from "../../lib/userPermissionsApi";
import { useT, useSettings } from "../layout/SettingsContext";
import {
  loadCustomStandard,
  saveCustomStandard,
  restoreBaseline,
  isOriginalRow,
  isOriginalSection,
} from "../../lib/standardMappingApi";
import {
  getHiddenOverrideMapping,
  upsertHiddenOverrideMapping,
  setActiveMappingSilently,
} from "../../lib/mappingsApi";

// ─── Constants ───────────────────────────────────────────────
const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };
const BASE = "https://api.konsolidator.com/v2";

const STANDARD_META = {
  PGC: {
    label: "PGC", full: "Plan General Contable - CF",
    description: "Cash flow estándar español. Operating, Investing y Financing siguiendo el modelo PGC.",
    accent: "#0891b2", accentBg: "#e0f7fa",
    cfTable: "pgc_cf",
  },
  DanishIFRS: {
    label: "Danish IFRS", full: "Danish IFRS Cash Flow",
    description: "Adaptación danesa del estándar internacional IFRS para flujo de caja.",
    accent: "#57aa78", accentBg: "#dcfce7",
    cfTable: "danish_ifrs_cf",
  },
  SpanishIFRSEs: {
    label: "Spanish IFRS-ES", full: "Spanish IFRS-ES Cash Flow",
    description: "Adaptación española del estándar internacional IFRS para flujo de caja.",
    accent: "#dc7533", accentBg: "#fef3c7",
    cfTable: "spanish_ifrs_es_cf",
  },
  Scratch: {
    label: "Custom", full: "From scratch",
    description: "Construye tu propia estructura de cash flow desde cero.",
    accent: "#0891b2", accentBg: "#e0f7fa",
    cfTable: null,
  },
};

const TOGGLE_HEIGHT = 28;
const TOGGLE_ICON_SIZE = 14;
const TOGGLE_LABEL_FONT_SIZE = 11;
const TOGGLE_PADDING_X = 10;

const MONTHS = [
  "January","February","March","April","May","June","July","August","September","October","November","December",
];

// ─── Helpers (mostly copied/adapted from MappingsPage) ───────
function parseAmt(val) {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function buildTemplateTree(rows, sections = []) {
  if (!rows?.length) return [];
  const normalize = v => v == null ? null : String(v).replace(/\.0+$/, "");
  const soSort = (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  function buildHierarchy(subsetRows) {
    const subsetCodes = new Set(subsetRows.map(r => normalize(r.account_code)));
    const childrenOf = new Map(), localRoots = [];
    subsetRows.forEach(r => {
      const parent = normalize(r.parent_code);
      if (!parent || !subsetCodes.has(parent)) localRoots.push(r);
      else { if (!childrenOf.has(parent)) childrenOf.set(parent, []); childrenOf.get(parent).push(r); }
    });
    childrenOf.forEach(arr => arr.sort(soSort)); localRoots.sort(soSort);
    function makeNode(r) {
      const code = String(r.account_code);
      return {
        kind: "row", code, name: r.account_name,
        isSum: !!(r.is_sum_account ?? r.is_sum), showInSummary: !!r.show_in_summary,
        sectionCode: r.section_code, level: Number(r.level ?? 0),
        sortOrder: Number(r.sort_order ?? 0),
        children: (childrenOf.get(normalize(code)) || []).map(makeNode),
      };
    }
    return localRoots.map(makeNode);
  }
  if (!sections.length) return buildHierarchy(rows);
  const sortedSections = [...sections].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const rowsBySection = new Map(), rowsNoSection = [];
  rows.forEach(r => {
    if (r.section_code) {
      if (!rowsBySection.has(r.section_code)) rowsBySection.set(r.section_code, []);
      rowsBySection.get(r.section_code).push(r);
    } else rowsNoSection.push(r);
  });
// Interleave breakers with orphan (section=null) roots by sort_order,
  // so a breaker placed AFTER orphans in the editor stays there on reload.
  const breakerItems = sortedSections.map(s => ({
    kind: "breaker",
    sortOrder: Number(s.sort_order ?? 0),
    node: {
      kind: "breaker",
      code: `__breaker__${s.section_code}`,
      sectionCode: s.section_code,
      name: s.label, color: s.color,
      children: buildHierarchy(rowsBySection.get(s.section_code) || []),
    },
  }));
  const orphanRoots = buildHierarchy(rowsNoSection).map(n => ({
    kind: "orphan",
    sortOrder: Number(n.sortOrder ?? 0),
    node: n,
  }));
  const merged = [...breakerItems, ...orphanRoots].sort((a, b) => a.sortOrder - b.sortOrder);
  return merged.map(it => it.node);
}

function normalizeName(s) { return String(s ?? "").trim().toLowerCase(); }
function collectNames(node) { const out = new Set(); function walk(n) { out.add(normalizeName(n.name)); (n.children || []).forEach(walk); } walk(node); return out; }
function collectNamesFromTree(tree) { const out = new Set(); function walk(nodes) { nodes.forEach(n => { out.add(normalizeName(n.name)); walk(n.children || []); }); } walk(tree); return out; }
function findDuplicates(incomingNode, destinationTree) { const incoming = collectNames(incomingNode), existing = collectNamesFromTree(destinationTree), dups = []; incoming.forEach(name => { if (existing.has(name)) dups.push(name); }); return dups; }

let __dropCounter = 0;
function cloneSubtree(node, sourceSide) {
  __dropCounter++;
  return {
    id: `imp-${sourceSide}-${node.code}-${Date.now()}-${__dropCounter}`,
    code: node.code, name: node.name, sourceSide,
    sectionCode: node.sectionCode ?? null,
    isSum: node.isSum ?? false,
    isSumAccount: node.isSum ?? false,
    showInSummary: node.showInSummary ?? false,
    children: (node.children || []).map(c => cloneSubtree(c, sourceSide)),
  };
}

function walkTransform(tree, fn) { const out = []; for (const n of tree) { const t = fn(n); if (t === null) continue; out.push({ ...t, children: walkTransform(t.children || [], fn) }); } return out; }
function removeByNames(tree, namesSet) { return walkTransform(tree, n => namesSet.has(normalizeName(n.name)) ? null : n); }
function insertAt(tree, targetId, position, newNode) {
  if (position === "inside") return walkTransform(tree, n => (n.id === targetId || n.code === targetId) ? { ...n, children: [newNode, ...(n.children || [])] } : n);
  function walk(nodes) { const out = []; for (const n of nodes) { const isTarget = n.id === targetId || n.code === targetId; if (isTarget && position === "before") out.push(newNode); out.push({ ...n, children: walk(n.children || []) }); if (isTarget && position === "after") out.push(newNode); } return out; }
  return walk(tree);
}
function appendToRoot(tree, newNode) { return [...tree, newNode]; }
function findNodeById(tree, targetId) { for (const n of tree) { if (n.id === targetId || n.code === targetId) return n; const f = findNodeById(n.children || [], targetId); if (f) return f; } return null; }
function isDescendantOf(tree, ancestorId, targetId) { if (!targetId) return false; const ancestor = findNodeById(tree, ancestorId); if (!ancestor) return false; return findNodeById(ancestor.children || [], targetId) !== null; }
function renameNode(tree, targetId, newName) { return walkTransform(tree, n => (n.id === targetId || n.code === targetId) ? { ...n, name: newName } : n); }
function deleteNode(tree, targetId) { return walkTransform(tree, n => (n.id === targetId || n.code === targetId) ? null : n); }
function collectIdsFromSubtree(node) { const out = []; function walk(n) { out.push(n.id ?? n.code); (n.children || []).forEach(walk); } walk(node); return out; }
function stripSubtreeForTransfer(node) { return { code: node.code, name: node.name, isSum: node.isSum ?? false, isSumAccount: node.isSum ?? false, sectionCode: node.sectionCode ?? null, showInSummary: node.showInSummary ?? false, children: (node.children || []).map(stripSubtreeForTransfer) }; }
function collectAllCodes(tree, prefix) { const out = []; function walk(nodes) { nodes.forEach(n => { if ((n.children?.length ?? 0) > 0) { out.push(`${prefix}-${n.code}`); walk(n.children); } }); } walk(tree); return out; }
function countNodes(tree) { let n = 0; function walk(nodes) { nodes.forEach(node => { n++; walk(node.children || []); }); } walk(tree); return n; }
function filterTree(tree, predicate) { function walk(nodes) { return nodes.map(n => { const kids = walk(n.children || []); return (predicate(n) || kids.length > 0) ? { ...n, children: kids } : null; }).filter(Boolean); } return walk(tree); }
function filterTreeTpl(tree, q) { function walk(nodes) { return nodes.map(n => { const kids = walk(n.children || []); const matches = n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q); return (matches || kids.length > 0) ? { ...n, children: kids } : null; }).filter(Boolean); } return walk(tree); }

// Build the CF account tree from /v2/mapped-cashflow-accounts rows.
// Each row links one groupAccountCode to one cashFlowAccountCode (+ name + parent CF).
// Build CF account tree using consolidated CF/CFS rows as the source of truth
// (this is what CashFlowPage does). mapped-cashflow-accounts is only used to:
//   1) include CF codes the chart has but with no data anywhere (so they can still be mapped)
//   2) collect the group→CF drill mapping
// ─── CF-only diff computer ────────────────────────────────────
// Walks the visible CF template tree and compares with liveRows + baseline
// to produce a list of changes ready for saveCustomStandard.
function diffCustomStandardCF({ cfTree, baseline, liveRows, liveSections }) {
  const rowsAdded = [];
  const rowsUpdated = [];
  const rowsDeleted = [];
  const sectionsAdded = [];
  const sectionsUpdated = [];
  const sectionsDeleted = [];

  const liveByKey = new Map();
  liveRows.forEach(r => {
    if (r.statement === "CF") liveByKey.set(String(r.account_code), r);
  });
  const liveSectionByKey = new Map();
  liveSections.forEach(s => {
    if (s.statement === "CF") liveSectionByKey.set(String(s.section_code), s);
  });

  // Walk visible tree: collect current desired state
  const seenRowCodes = new Set();
  const seenSectionCodes = new Set();
  let sortCounter = 3000000;

const walk = (nodes, parentCode = null, sectionCode = null) => {
    for (const n of (nodes || [])) {
      if (n.kind === "breaker") {
        const code = String(n.sectionCode ?? n.code ?? "");
        if (code) {
          seenSectionCodes.add(code);
          sortCounter += 10;
          const sectionSort = sortCounter;
          const existing = liveSectionByKey.get(code);
          const label = n.name ?? existing?.label ?? code;
          const color = n.color ?? existing?.color ?? null;
          if (!existing) {
            sectionsAdded.push({
              statement: "CF",
              section_code: code,
              label,
              color,
              sort_order: sectionSort,
            });
          } else {
            const patch = {};
            if (existing.label !== label) patch.label = label;
            if (existing.color !== color) patch.color = color;
            if (existing.sort_order !== sectionSort) patch.sort_order = sectionSort;
            if (Object.keys(patch).length > 0) {
              sectionsUpdated.push({
                statement: "CF",
                section_code: code,
                patch,
              });
            }
          }
}
        walk(n.children, parentCode, code);
        continue;
      }
      const code = String(n.code ?? "");
      if (!code) { walk(n.children, parentCode, sectionCode); continue; }
      seenRowCodes.add(code);
      sortCounter += 10;
      const existing = liveByKey.get(code);
      const isSum = !!(n.isSum || n.isSumAccount || (n.children && n.children.length > 0));
const desired = {
        statement: "CF",
        account_code: code,
        account_name: n.name ?? existing?.account_name ?? code,
        parent_code: parentCode,
        section_code: sectionCode,
        is_sum: isSum,
        sort_order: sortCounter,
      };
      if (!existing) {
        rowsAdded.push(desired);
      } else {
        const patch = {};
        // For originals: only position fields (parent/section/sort) allowed
        const isOriginal = isOriginalRow(baseline, "CF", code);
        if (existing.parent_code !== desired.parent_code) patch.parent_code = desired.parent_code;
        if (existing.section_code !== desired.section_code) patch.section_code = desired.section_code;
        if (existing.sort_order !== desired.sort_order) patch.sort_order = desired.sort_order;
        if (!isOriginal) {
          if (existing.account_name !== desired.account_name) patch.account_name = desired.account_name;
          if (existing.is_sum !== desired.is_sum) patch.is_sum = desired.is_sum;
        }
        if (Object.keys(patch).length > 0) {
          rowsUpdated.push({ statement: "CF", account_code: code, patch });
        }
      }
walk(n.children, code, sectionCode);
    }
  };
  walk(cfTree);
  console.log("[diff CF] rowsUpdated for 7999:", rowsUpdated.find(u => u.account_code === "7999"));
  console.log("[diff CF] rowsAdded parent-child:", rowsAdded.map(r => `${r.account_code} parent=${r.parent_code}`));
  // Deletions: any live CF row/section not present in the tree and not original
  liveRows.forEach(r => {
    if (r.statement !== "CF") return;
    if (seenRowCodes.has(String(r.account_code))) return;
    if (isOriginalRow(baseline, "CF", r.account_code)) return;
    rowsDeleted.push({ statement: "CF", account_code: r.account_code });
  });
  liveSections.forEach(s => {
    if (s.statement !== "CF") return;
    if (seenSectionCodes.has(String(s.section_code))) return;
    if (isOriginalSection(baseline, "CF", s.section_code)) return;
    sectionsDeleted.push({ statement: "CF", section_code: s.section_code });
  });

return { rowsAdded, rowsUpdated, rowsDeleted, sectionsAdded, sectionsUpdated, sectionsDeleted };
}

function buildCfAccountTree(cfMappingRows, cfChartAccounts = [], cfNameRows = []) {
  const cfInfo = new Map();      // cfCode → { name, parent }
  const groupAccountsByCf = new Map();
  const groupToCf = new Map();

  // PRIMARY: /v2/group-accounts filtered to CF types — full CF chart of accounts
  // (every code, including sums with zero data, with their proper parent links)
  (cfChartAccounts ?? []).forEach(r => {
    const code = String(r.accountCode ?? r.AccountCode ?? "");
    const name = String(r.accountName ?? r.AccountName ?? "");
    const parent = String(r.sumAccountCode ?? r.SumAccountCode ?? "");
    if (!code) return;
    cfInfo.set(code, { name, parent });
  });

  // SECONDARY: consolidated CF/CFS rows — fill in missing names
  (cfNameRows ?? []).forEach(r => {
    const code = String(r.AccountCode ?? r.accountCode ?? "");
    const name = String(r.AccountName ?? r.accountName ?? "");
    const parent = String(r.SumAccountCode ?? r.sumAccountCode ?? "");
    if (!code) return;
    if (!cfInfo.has(code)) cfInfo.set(code, { name, parent });
    else {
      const existing = cfInfo.get(code);
      if (!existing.name && name) existing.name = name;
      if (!existing.parent && parent) existing.parent = parent;
    }
  });

  // SECONDARY: mapped-cashflow-accounts — adds CF codes with no data + group→CF drill
  (cfMappingRows ?? []).forEach(r => {
    const enabled = r.enabled ?? r.Enabled;
    if (enabled === false) return;
    const cfCode = String(r.cashFlowAccountCode ?? r.CashFlowAccountCode ?? "");
    const cfName = String(r.cashFlowAccountName ?? r.CashFlowAccountName ?? "");
    const cfParent = String(r.cashFlowAccountSumAccountCode ?? r.CashFlowAccountSumAccountCode ?? "");
    const groupCode = String(r.groupAccountCode ?? r.GroupAccountCode ?? "");
    const groupName = String(r.groupAccountName ?? r.GroupAccountName ?? groupCode);
    if (!cfCode) return;
    if (!cfInfo.has(cfCode)) cfInfo.set(cfCode, { name: cfName, parent: cfParent });
    else {
      const existing = cfInfo.get(cfCode);
      if (!existing.name && cfName) existing.name = cfName;
    }
    if (groupCode) {
      if (!groupAccountsByCf.has(cfCode)) groupAccountsByCf.set(cfCode, []);
      const arr = groupAccountsByCf.get(cfCode);
      if (!arr.find(g => g.code === groupCode)) arr.push({ code: groupCode, name: groupName });
      if (!groupToCf.has(groupCode)) groupToCf.set(groupCode, []);
      const cfArr = groupToCf.get(groupCode);
      if (!cfArr.includes(cfCode)) cfArr.push(cfCode);
    }
  });

if (cfInfo.size === 0) return { tree: [], groupAccountsByCf, groupToCf };

  // Walk parents: add intermediate sum codes referenced as parents but not yet in cfInfo
  // (happens before cfNameRows has loaded, or for sums with zero data everywhere)
  let added = true;
  while (added) {
    added = false;
    for (const info of [...cfInfo.values()]) {
      if (info.parent && !cfInfo.has(info.parent)) {
        cfInfo.set(info.parent, { name: "", parent: "" });
        added = true;
      }
    }
  }

  // Build tree: codes whose parent is in cfInfo become children, others are roots
  const childrenOf = new Map();
  const roots = [];
  cfInfo.forEach((info, code) => {
    if (info.parent && cfInfo.has(info.parent) && info.parent !== code) {
      if (!childrenOf.has(info.parent)) childrenOf.set(info.parent, []);
      childrenOf.get(info.parent).push(code);
    } else {
      roots.push(code);
    }
  });
  const numSort = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  childrenOf.forEach(arr => arr.sort(numSort));
  roots.sort(numSort);

  function makeNode(code) {
    const info = cfInfo.get(code);
    const groupAccounts = groupAccountsByCf.get(code) ?? [];
    const childCodes = childrenOf.get(code) ?? [];
    const isSum = childCodes.length > 0;
    return {
      id: `cli-${code}`,
      code,
      name: info?.name || "",
      isSum,
      isSumAccount: isSum,
      groupAccounts,
      children: childCodes.map(makeNode),
    };
  }
// Skip the redundant top-level container nodes ("Cash flow" / "Cash flow sp.")
  // — promote their children to be the new roots.
  const fullTree = roots.map(makeNode);
  const promotedTree = fullTree.flatMap(r => (r.children?.length ? r.children : [r]));
  return { tree: promotedTree, groupAccountsByCf, groupToCf };
}

// ─── Main Component ──────────────────────────────────────────
export default function CashFlowMappingsView({
  search, setSearch, colors, onBack,
  token, mappingKind = "structure",
  initialView = "list", initialStandard = null,
  pendingEdit = null, onPendingEditConsumed,
  activeStandardKey = null,
}) {
const t = useT();
  const api = useMemo(() => (
    mappingKind === "report"
      ? { list: listCfReportMappings, create: createCfReportMapping, update: updateCfReportMapping, archive: archiveCfReportMapping }
      : { list: listCfMappings, create: createCfMapping, update: updateCfMapping, archive: archiveCfMapping }
  ), [mappingKind]);
  const [view, setView] = useState(initialView);
  const [selectedStandard, setSelectedStandard] = useState(initialStandard);
  const [authUserId, setAuthUserId] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [editingMapping, setEditingMapping] = useState(null);
  const [standardMappingId, setStandardMappingId] = useState(null);
  const [pendingStandardMapping, setPendingStandardMapping] = useState(null);
const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [pendingNav, setPendingNav] = useState(null);
  const [cfViewMode, setCfViewMode] = useState("consolidated"); // 'consolidated' | 'individual'
  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterSource, setFilterSource] = useState("");
  const [filterStructure, setFilterStructure] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterGroupShortName, setFilterGroupShortName] = useState("");
  const [sourcesList, setSourcesList] = useState([]);
  const [structuresList, setStructuresList] = useState([]);
  const [companiesList, setCompaniesList] = useState([]);
  const [groupShortNamesList, setGroupShortNamesList] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [filterStandard, setFilterStandard] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [sortBy, setSortBy] = useState("desc");
const mapperSaveRef = useRef(null);
  const mapperResetRef = useRef(null);
const [mapperDirty, setMapperDirty] = useState(false);
  // Sidebar/router calls window.__navGuard(go) before changing pages.
  // If the mapper is dirty we stash `go` and pop the discard modal; else allow.
useEffect(() => {
    window.__navGuard = (go) => {
      if (view !== "mapper" || !mapperDirty) { go(); return; }
      setPendingNav(() => go);
      setShowBackConfirm(true);
    };
    const onBeforeUnload = (e) => {
      if (view !== "mapper" || !mapperDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      delete window.__navGuard;
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [view, mapperDirty]);
  // CF mapping rows (groupAccount→cfAccount) + leaf data
const [cfMappingRows, setCfMappingRows] = useState([]);
  const [uploadedAccounts, setUploadedAccounts] = useState([]);
  const [consolidatedAccounts, setConsolidatedAccounts] = useState([]);
  const [cfNameRows, setCfNameRows] = useState([]);
  const [cfChartAccounts, setCfChartAccounts] = useState([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setAuthUserId(uid);
      if (uid) { const cid = await getActiveCompanyId(uid); setCompanyId(cid); }
    })();
  }, []);

  useEffect(() => {
    if (view !== "list" || !companyId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMappingsLoading(true);
    api.list({ companyId }).then(rows => setMappings(rows ?? [])).finally(() => setMappingsLoading(false));
  }, [view, companyId, api]);

useEffect(() => {
    if (!pendingEdit) return;
    if (pendingEdit.openCustom && pendingEdit.standard) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setEditingMapping(null);
      setSelectedStandard(pendingEdit.standard);
      setView("mapper");
      /* eslint-enable react-hooks/set-state-in-effect */
      onPendingEditConsumed?.();
      return;
    }
    if (!mappings.length) return;
    const m = mappings.find(x => String(x.mapping_id) === String(pendingEdit.mapping_id));
    if (!m) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setEditingMapping(m);
    setSelectedStandard(m.standard);
    setCfViewMode(m.cf_view_mode ?? "consolidated");
    setView("mapper");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pendingEdit, mappings, onPendingEditConsumed]);

  useEffect(() => {
    if (!authUserId) return;
    (async () => {
      const { data } = await supabase.from("user_settings").select("preferences").eq("user_id", authUserId).single();
      const stdKey = mappingKind === "report" ? "cashflow_report_standard_mapping_id" : "cashflow_standard_mapping_id";
      const favKey = mappingKind === "report" ? "favorite_cashflow_report_mappings" : "favorite_cashflow_mappings";
      if (data?.preferences?.[stdKey]) setStandardMappingId(data.preferences[stdKey]);
      if (Array.isArray(data?.preferences?.[favKey])) setFavorites(new Set(data.preferences[favKey]));
    })();
  }, [authUserId, mappingKind]);

  const handleSetStandard = async (id) => {
    if (!authUserId) return;
    const newId = standardMappingId === id ? null : id;
    const { data } = await supabase.from("user_settings").select("preferences").eq("user_id", authUserId).single();
    const prefs = data?.preferences ?? {};
    const key = mappingKind === "report" ? "cashflow_report_standard_mapping_id" : "cashflow_standard_mapping_id";
    await supabase.from("user_settings").upsert({
      user_id: authUserId,
      preferences: { ...prefs, [key]: newId },
      updated_at: new Date().toISOString(),
    });
    setStandardMappingId(newId);
  };

  const handleToggleFavorite = async (mappingId) => {
    if (!authUserId) return;
    const next = new Set(favorites);
    if (next.has(mappingId)) next.delete(mappingId); else next.add(mappingId);
    setFavorites(next);
    const { data } = await supabase.from("user_settings").select("preferences").eq("user_id", authUserId).single();
    const prefs = data?.preferences ?? {};
    const favKey = mappingKind === "report" ? "favorite_cashflow_report_mappings" : "favorite_cashflow_mappings";
    await supabase.from("user_settings").upsert({
      user_id: authUserId,
      preferences: { ...prefs, [favKey]: [...next] },
      updated_at: new Date().toISOString(),
    });
  };

const uniqueUsers = useMemo(() => {
    const set = new Set();
    mappings.forEach(m => {
      if (m.updated_by_name) set.add(m.updated_by_name);
      if (m.created_by_name) set.add(m.created_by_name);
    });
    return [...set].sort();
  }, [mappings]);

  // ── Resource-access gating ────────────────────────────────────
  // Restricts what shows in Source/Structure/Company/Group dropdowns and
  // what the auto-probe defaults to, based on the current user's permissions.
  const { access: resourceAccess } = useCurrentUserResourceAccess();
  const effectiveSources = useMemo(() => {
    const set = resourceAccess?.source;
    if (!set) return sourcesList;
    return sourcesList.filter(s => set.has(String(s.Source ?? s.source ?? s)));
  }, [sourcesList, resourceAccess]);
  const effectiveStructures = useMemo(() => {
    const set = resourceAccess?.structure;
    if (!set) return structuresList;
    return structuresList.filter(s => set.has(String(s.GroupStructure ?? s.groupStructure ?? s)));
  }, [structuresList, resourceAccess]);
  const effectiveCompanies = useMemo(() => {
    const set = resourceAccess?.company;
    if (!set) return companiesList;
    return companiesList.filter(c => set.has(String(c.CompanyShortName ?? c.companyShortName ?? c.company ?? c.Company ?? c)));
  }, [companiesList, resourceAccess]);
  const effectiveGroupShortNames = useMemo(() => {
    const set = resourceAccess?.company;
    if (!set) return groupShortNamesList;
    return groupShortNamesList.filter(g => set.has(String(g)));
  }, [groupShortNamesList, resourceAccess]);

  // Load metadata (sources, structures, companies, group short names)
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    (async () => {
      try {
        const [srcRes, strRes, coRes, gsRes] = await Promise.all([
          fetch(`${BASE}/sources`, { headers: h }).then(r => r.json()),
          fetch(`${BASE}/structures`, { headers: h }).then(r => r.json()),
          fetch(`${BASE}/companies`, { headers: h }).then(r => r.json()),
          fetch(`${BASE}/group-structure`, { headers: h }).then(r => r.json()).catch(() => ({ value: [] })),
        ]);
        setSourcesList(srcRes.value ?? srcRes ?? []);
        setStructuresList(strRes.value ?? strRes ?? []);
        setCompaniesList(coRes.value ?? coRes ?? []);
        const gs = gsRes.value ?? gsRes ?? [];
        const gsNames = [...new Set(gs.filter(g => g.hasChild ?? g.HasChild).map(g => g.companyShortName ?? g.CompanyShortName))].filter(Boolean);
        setGroupShortNamesList(gsNames);
      } catch { /* ignore */ }
    })();
  }, [token]);

// Probe latest valid period when filters empty
  useEffect(() => {
    if (!token) return;
    if (filterYear && filterMonth && filterSource && filterStructure && filterCompany) return;
    if (!effectiveSources.length || !effectiveStructures.length || !effectiveCompanies.length) return;
    const src = effectiveSources[0];
    const str = effectiveStructures[0];
    const co = effectiveCompanies[0];
    const source = src.source ?? src.Source ?? src;
    const structure = str.groupStructure ?? str.GroupStructure ?? str;
    const company = co.companyShortName ?? co.CompanyShortName ?? co;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    (async () => {
      const now = new Date();
      let y = now.getFullYear(), m = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
        try {
          const res = await fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, { headers: h });
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            if (rows.length > 0) {
              setFilterYear(y); setFilterMonth(m);
              setFilterSource(source); setFilterStructure(structure); setFilterCompany(company);
              if (!filterGroupShortName && effectiveGroupShortNames.length > 0) setFilterGroupShortName(effectiveGroupShortNames[0]);
              return;
            }
          }
        } catch { /* keep probing */ }
        m--; if (m < 1) { m = 12; y--; }
      }
    })();
  }, [token, effectiveSources, effectiveStructures, effectiveCompanies, filterYear, filterMonth, filterSource, filterStructure, filterCompany, filterGroupShortName, effectiveGroupShortNames]);

// Fetch CF mapping rows (groupAccount → cfAccount)
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    (async () => {
      try {
        const res = await fetch(`${BASE}/mapped-cashflow-accounts`, { headers: h });
        if (!res.ok) { setCfMappingRows([]); return; }
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        setCfMappingRows(rows);
      } catch { setCfMappingRows([]); }
    })();
  }, [token]);

  // Fetch CF chart of accounts from /v2/group-accounts (filtered to CF types)
  // This is the AUTHORITATIVE source for the CF tree structure (full hierarchy with parents).
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    (async () => {
      try {
        const res = await fetch(`${BASE}/group-accounts`, { headers: h });
        if (!res.ok) { setCfChartAccounts([]); return; }
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        const cfRows = rows.filter(r => {
          const t = r.accountType ?? r.AccountType ?? "";
          return t === "C/F" || t === "CFS";
        });
        setCfChartAccounts(cfRows);
      } catch { setCfChartAccounts([]); }
    })();
  }, [token]);

  // Fetch leaf data based on view mode
  useEffect(() => {
    if (!token) return;
    if (!filterYear || !filterMonth || !filterSource || !filterStructure) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
if (cfViewMode === "individual") {
      const filter = `Year eq ${filterYear} and Month eq ${filterMonth} and Source eq '${filterSource}' and GroupStructure eq '${filterStructure}'`
        + (filterCompany ? ` and CompanyShortName eq '${filterCompany}'` : "");
      (async () => {
        try {
          const res = await fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
          if (!res.ok) { setUploadedAccounts([]); return; }
          const json = await res.json();
          setUploadedAccounts(json.value ?? (Array.isArray(json) ? json : []));
        } catch { setUploadedAccounts([]); }
      })();
      
} else {
      const gsn = filterGroupShortName || (effectiveGroupShortNames[0] ?? filterCompany);
      if (!gsn) return;
      const filter = `Year eq ${filterYear} and Month eq ${filterMonth} and Source eq '${filterSource}' and GroupStructure eq '${filterStructure}' and GroupShortName eq '${gsn}'`;
      (async () => {
        try {
const res = await fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
          if (!res.ok) { setConsolidatedAccounts([]); return; }
          const json = await res.json();
          const rows = json.value ?? (Array.isArray(json) ? json : []);
setConsolidatedAccounts(rows);
        } catch { setConsolidatedAccounts([]); }
      })();
    }
}, [token, cfViewMode, filterYear, filterMonth, filterSource, filterStructure, filterCompany, filterGroupShortName, effectiveGroupShortNames]);

// Fetch CF account names (broad — no GroupShortName filter so we get names for as many codes as possible)
  useEffect(() => {
    if (!token) return;
    if (!filterYear || !filterMonth || !filterSource || !filterStructure) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const filter = `Year eq ${filterYear} and Month eq ${filterMonth} and Source eq '${filterSource}' and GroupStructure eq '${filterStructure}' and (AccountType eq 'C/F' or AccountType eq 'CFS')`;
    (async () => {
      try {
const res = await fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
        if (!res.ok) { setCfNameRows([]); return; }
        const json = await res.json();
setCfNameRows(json.value ?? (Array.isArray(json) ? json : []));
      } catch { setCfNameRows([]); }
    })();
  }, [token, filterYear, filterMonth, filterSource, filterStructure]);

  const kindLabel = mappingKind === "report" ? t("cfm_list_title_report") : t("cfm_list_title_structure");
const isCustomSelected = selectedStandard && selectedStandard.startsWith("CUSTOM-");
  const activeAccent = isCustomSelected
    ? (colors?.primary ?? "#7c3aed")
    : ((selectedStandard && STANDARD_META[selectedStandard]?.accent) || colors?.primary || "#0891b2");
const handleMapperBack = () => {
    if (mapperDirty) setShowBackConfirm(true);
    else { setEditingMapping(null); setSelectedStandard(null); setView("list"); }
  };
  const headerConfig = {
list: { title: kindLabel, back: onBack },
    create: { title: t("cfm_create_title"), back: () => setView("list") },
    selectStandard: { title: t("cfm_select_standard_title"), back: () => setView("create") },
   mapper: { title: selectedStandard ? `${t("cfm_mapper_title_prefix")} · ${STANDARD_META[selectedStandard]?.label ?? selectedStandard.replace(/^CUSTOM-/, "").toUpperCase()}` : t("cfm_mapper_title_default"), back: initialView === "mapper" ? null : handleMapperBack },
  };
  const cfg = headerConfig[view] ?? headerConfig.list;

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        kicker={t("cfm_kicker")}
        title={cfg.title}
        titleSuffix={view === "mapper" && editingMapping?.name ? editingMapping.name : undefined}
        tabs={[]}
        activeTab={null}
        onTabChange={() => {}}
        showAllFilters={view === "list" || view === "mapper"}
        filters={view === "mapper" ? [
{ label: t("filter_year"), value: String(filterYear ?? ""), onChange: v => setFilterYear(Number(v)),
            options: Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => ({ value: String(y), label: String(y) })) },
          { label: t("filter_month"), value: String(filterMonth ?? ""), onChange: v => setFilterMonth(Number(v)),
            options: Array.from({ length: 12 }, (_, i) => ({ value: String(i+1), label: t(`month_${i+1}`) })) },
          { label: t("filter_source"), value: filterSource, onChange: setFilterSource,
            options: effectiveSources.map(s => { const v = s.source ?? s.Source ?? s; return { value: v, label: v }; }) },
          { label: t("filter_structure"), value: filterStructure, onChange: setFilterStructure,
            options: effectiveStructures.map(s => { const v = s.groupStructure ?? s.GroupStructure ?? s; return { value: v, label: v }; }) },
          ...(cfViewMode === "individual"
            ? [{ label: t("filter_company"), value: filterCompany, onChange: setFilterCompany,
                options: effectiveCompanies.map(c => { const v = c.companyShortName ?? c.CompanyShortName ?? c; const label = c.companyLegalName ?? c.CompanyLegalName ?? v; return { value: v, label }; }) }]
            : effectiveGroupShortNames.length > 0
              ? [{ label: t("cfm_filter_group"), value: filterGroupShortName, onChange: setFilterGroupShortName,
                  options: effectiveGroupShortNames.map(g => {
                    const co = effectiveCompanies.find(c => (c.companyShortName ?? c.CompanyShortName) === g);
                    const label = co?.companyLegalName ?? co?.CompanyLegalName ?? g;
                    return { value: g, label };
                  }) }]
              : []),
        ] : view === "list" ? [
{ label: t("cfm_filter_standard"), value: filterStandard, onChange: setFilterStandard, options: [
            { value: "", label: t("cfm_filter_all_standards"), displayLabel: t("cfm_filter_standard") },
            { value: "PGC", label: "PGC", displayLabel: "PGC" },
            { value: "DanishIFRS", label: "Danish IFRS", displayLabel: "Danish IFRS" },
            { value: "SpanishIFRSEs", label: "Spanish IFRS-ES", displayLabel: "Spanish IFRS-ES" },
            { value: "Scratch", label: t("cfm_standard_custom"), displayLabel: t("cfm_standard_custom") },
          ]},
          { label: t("cfm_filter_user"), value: filterUser, onChange: setFilterUser, options: [
            { value: "", label: t("cfm_filter_all_users"), displayLabel: t("cfm_filter_user") },
            ...uniqueUsers.map(u => ({ value: u, label: u, displayLabel: u })),
          ]},
          { label: t("cfm_filter_sort"), value: sortBy, onChange: setSortBy, options: [
            { value: "desc", label: t("cfm_filter_most_recent"), displayLabel: t("cfm_filter_most_recent_short") },
            { value: "asc", label: t("cfm_filter_oldest"), displayLabel: t("cfm_filter_oldest_short") },
          ]},
          { label: t("cfm_filter_favorites"), value: filterFavorite ? "yes" : "", onChange: v => setFilterFavorite(v === "yes"), options: [
            { value: "", label: t("cfm_filter_all"), displayLabel: t("cfm_filter_favorites") },
            { value: "yes", label: t("cfm_filter_favorites_only"), displayLabel: t("cfm_filter_favorites_only_short") },
          ]},
        ] : []}
        onBack={cfg.back}
headerSearch={view === "list" ? { value: search, onChange: setSearch, placeholder: t("cfm_search_placeholder") } : undefined}
        headerActions={view === "list" ? [{ icon: Plus, label: t("cfm_create_mapping"), onClick: () => { setEditingMapping(null); setView("create"); } }] : undefined}
        headerExtra={view === "mapper" && selectedStandard ? (
          <div className="flex items-center gap-2">
            {/* Consolidated / Individual toggle */}
            <div className="relative flex items-center gap-0.5 p-1 bg-gray-50 border border-gray-100 rounded-xl"
              ref={el => {
                if (!el) return;
                const active = el.querySelector('[data-active="true"]');
                let pill = el.querySelector('.cf-pill');
                if (!pill) {
                  pill = document.createElement('span');
                  pill.className = 'cf-pill';
                  pill.style.cssText = `position:absolute;top:4px;bottom:4px;border-radius:8px;transition:left 280ms cubic-bezier(0.34,1.56,0.64,1),width 280ms cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;z-index:0;background:${activeAccent};box-shadow:0 2px 8px -2px ${activeAccent}55`;
                  el.appendChild(pill);
                }
                if (active) {
                  pill.style.left = active.offsetLeft + 'px';
                  pill.style.width = active.offsetWidth + 'px';
                }
              }}>
             {[["consolidated", t("cfm_cons")],["individual", t("cfm_indiv")]].map(([key, label]) => (
                <button key={key} data-active={cfViewMode === key} onClick={() => setCfViewMode(key)}
                  className="relative z-10 px-4 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
                  style={{ color: cfViewMode === key ? "white" : "#9ca3af" }}>
                  {label}
                </button>
              ))}
            </div>
<button onClick={() => mapperResetRef.current?.()}
              title={t("cfm_reset_tooltip")}
              className="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:scale-105"
              style={{ background: `${activeAccent}10`, color: activeAccent, border: `1px solid ${activeAccent}20` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
<button onClick={() => mapperSaveRef.current?.()}
              title={editingMapping ? t("cfm_save_tooltip") : t("cfm_save_mapping_tooltip")}
              className="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:scale-105"
              style={{ background: activeAccent, color: "white", boxShadow: `0 4px 12px -4px ${activeAccent}60` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
          </div>
        ) : undefined}
      />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col mt-3 rounded-2xl bg-white shadow-xl border border-gray-100">
        {view === "list" && (
          <ListView
            mappings={mappings} loading={mappingsLoading} search={search}
            standardMappingId={standardMappingId} onSetStandard={handleSetStandard}
            favorites={favorites} onToggleFavorite={handleToggleFavorite}
            filterStandard={filterStandard} filterUser={filterUser} filterFavorite={filterFavorite} sortBy={sortBy}
            onCreate={() => { setEditingMapping(null); setView("create"); }}
            onOpen={m => { setEditingMapping(m); setSelectedStandard(m.standard); setCfViewMode(m.cf_view_mode ?? "consolidated"); setView("mapper"); }}
            onArchive={async m => {
              if (!window.confirm(t("cfm_delete_confirm").replace("{name}", m.name))) return;
              await api.archive({ mappingId: m.mapping_id, userId: authUserId });
              const rows = await api.list({ companyId });
              setMappings(rows ?? []);
            }}
          />
        )}
        {view === "create" && (
          <CreateView
            onScratch={() => { setSelectedStandard("Scratch"); setView("mapper"); }}
            onExisting={() => setView("selectStandard")}
          />
        )}
        {view === "selectStandard" && (
       <SelectStandardView activeStandardKey={activeStandardKey} mappingKind={mappingKind} onPick={std => { setSelectedStandard(std); setView("mapper"); }} />
        )}
        {view === "mapper" && selectedStandard && (
<CashFlowMapperView
            standard={selectedStandard}
            cfMappingRows={cfMappingRows}
            uploadedAccounts={uploadedAccounts}
            consolidatedAccounts={consolidatedAccounts}
            cfNameRows={cfNameRows}
            cfChartAccounts={cfChartAccounts}
            cfViewMode={cfViewMode}
            authUserId={authUserId}
            companyId={companyId}
            editingMapping={editingMapping}
            existingMappings={mappings}
            onSaved={saved => { setEditingMapping(saved); if (!editingMapping && !saved?.is_hidden) setPendingStandardMapping(saved); }}
saveRef={mapperSaveRef}
            resetRef={mapperResetRef}
           onDirtyChange={setMapperDirty}
            api={api}
            mappingKind={mappingKind}
          />
        )}
      </div>
{showBackConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => { setShowBackConfirm(false); setPendingNav(null); }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
<p className="text-white font-black text-lg leading-tight">{t("cfm_discard_changes")}</p>
              <p className="text-white/70 text-[11px] mt-0.5">{t("cfm_discard_changes_subtitle")}</p>
            </div>
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2">
<button onClick={() => { setShowBackConfirm(false); setPendingNav(null); }} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">{t("cfm_stay")}</button>
                <button onClick={() => {
                  setShowBackConfirm(false);
                  setMapperDirty(false);
                  if (pendingNav) { const go = pendingNav; setPendingNav(null); go(); }
                  else { setEditingMapping(null); setSelectedStandard(null); setView("list"); }
                }} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90 active:scale-[0.98]" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>{t("cfm_discard_go_back")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {pendingStandardMapping && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => setPendingStandardMapping(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #57aa78 0%, #3d8c5c 100%)" }}>
<p className="text-white font-black text-lg leading-tight">{t("cfm_set_standard_title")}</p>
              <p className="text-white/70 text-xs mt-1">"{pendingStandardMapping.name}" {t("cfm_set_standard_subtitle")}</p>
            </div>
            <div className="p-5 space-y-2">
<button onClick={async () => { await handleSetStandard(pendingStandardMapping.mapping_id); setPendingStandardMapping(null); }} className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg, #57aa78 0%, #3d8c5c 100%)" }}>{t("cfm_yes_set_standard")}</button>
              <button onClick={() => setPendingStandardMapping(null)} className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">{t("cfm_not_now")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ListView ────────────────────────────────────────────────
function ListView({ mappings, loading, search, standardMappingId, onSetStandard, favorites = new Set(), onToggleFavorite, filterStandard = "", filterUser = "", filterFavorite = false, sortBy = "desc", onCreate, onOpen, onArchive }) {
  const t = useT();
  const filtered = useMemo(() => {
    let list = mappings;
    if (search?.trim()) list = list.filter(m => String(m.name ?? "").toLowerCase().includes(search.toLowerCase()));
    if (filterStandard) list = list.filter(m => m.standard === filterStandard);
    if (filterUser) list = list.filter(m => m.updated_by_name === filterUser || m.created_by_name === filterUser);
    if (filterFavorite) list = list.filter(m => favorites.has(m.mapping_id));
    return [...list].sort((a, b) => {
      const aFav = favorites.has(a.mapping_id) ? 0 : 1;
      const bFav = favorites.has(b.mapping_id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const diff = new Date(b.updated_at ?? 0) - new Date(a.updated_at ?? 0);
      return sortBy === "asc" ? -diff : diff;
    });
  }, [mappings, search, filterStandard, filterUser, filterFavorite, favorites, sortBy]);

  return (
    <div className="overflow-y-auto flex-1 flex flex-col">
      {search && filtered.length !== mappings.length && (
        <div className="flex items-center gap-3 p-4 pb-0">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">{filtered.length} {t("cfm_records_of_matching")} {mappings.length} {t("cfm_records_matching")}</div>
        </div>
      )}
     {loading ? <div className="text-center py-20 text-xs text-gray-400">{t("cfm_loading_mappings")}</div>
        : filtered.length === 0 ? <EmptyLibrary onCreate={onCreate} hasSearch={!!search?.trim()} />
        : (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(m => <MappingCard key={m.mapping_id} mapping={m} isStandard={m.mapping_id === standardMappingId} isFavorite={favorites.has(m.mapping_id)} onSetStandard={onSetStandard} onToggleFavorite={onToggleFavorite} onOpen={onOpen} onArchive={onArchive} />)}
          </div>
        )}
    </div>
  );
}

function EmptyLibrary({ onCreate, hasSearch }) {
  const t = useT();
  return (
    <div className="flex-1 bg-gradient-to-br from-[#f0fbfd] to-white rounded-2xl border border-gray-100 text-center flex flex-col items-center justify-center">
      <div className="w-16 h-16 bg-[#e0f7fa] rounded-2xl flex items-center justify-center mx-auto mb-5"><Library size={28} className="text-[#0891b2]" /></div>
<p className="text-gray-700 font-black text-base mb-2">{hasSearch ? t("cfm_list_no_match") : t("cfm_list_empty")}</p>
      <p className="text-gray-400 text-xs mb-6 max-w-sm mx-auto leading-relaxed">{hasSearch ? t("cfm_list_try_diff_term") : t("cfm_list_empty_desc")}</p>
      {!hasSearch && <button onClick={onCreate} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0891b2] hover:bg-[#0891b2]/90 text-white text-xs font-black transition-all shadow-md"><Plus size={14} />{t("cfm_create_first")}</button>}
    </div>
  );
}

function MappingCard({ mapping, isStandard, isFavorite, onSetStandard, onToggleFavorite, onOpen, onArchive }) {
  const t = useT();
  const standardMeta = STANDARD_META[mapping.standard];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#0891b2]/30 hover:shadow-lg transition-all group flex flex-col">
      <div className="cursor-pointer flex-1" onClick={() => onOpen?.(mapping)}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: standardMeta?.accentBg ?? "#e0f7fa" }}>
            <FileText size={16} style={{ color: standardMeta?.accent ?? "#0891b2" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm text-gray-800 truncate">{mapping.name ?? t("cfm_untitled")}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: standardMeta?.accent ?? "#0891b2" }}>{standardMeta?.label ?? mapping.standard}</p>
          </div>
          <button onClick={e => { e.stopPropagation(); onToggleFavorite?.(mapping.mapping_id); }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isFavorite ? "" : "opacity-0 group-hover:opacity-100"}`}
            style={{ color: isFavorite ? "#f59e0b" : "#9ca3af" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={isFavorite ? "#f59e0b" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button onClick={e => { e.stopPropagation(); onArchive?.(mapping); }} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"><Trash2 size={11} /></button>
        </div>
        {mapping.description && <p className="text-[11px] text-gray-500 mb-3 line-clamp-2">{mapping.description}</p>}
      </div>
      <div className="flex items-center gap-3 py-2.5" onClick={e => e.stopPropagation()}>
        <span className="text-[10px] font-black uppercase tracking-wider flex-1" style={{ color: isStandard ? "#57aa78" : "#9ca3af" }}>
          {isStandard ? t("cfm_standard_active") : t("cfm_set_as_standard")}
        </span>
        <div onClick={() => onSetStandard?.(mapping.mapping_id)} className="relative cursor-pointer select-none flex-shrink-0"
          style={{ width: 34, height: 18, borderRadius: 9, background: isStandard ? "#57aa78" : "#d1d5db", transition: "background 220ms" }}>
          <div style={{ position: "absolute", top: 2, left: isStandard ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 220ms" }} />
        </div>
      </div>
      <div className="flex flex-col gap-1 pt-3 border-t border-gray-50 text-[11px] text-gray-500 min-w-0">
        <div className="flex items-center gap-2">
          <Clock size={11} className="text-gray-300 flex-shrink-0" />
          <span className="truncate">{t("cfm_updated")} {new Date(mapping.updated_at).toLocaleDateString()}{mapping.updated_by_name ? ` · ${mapping.updated_by_name}` : ""}</span>
        </div>
        {mapping.created_by_name && mapping.created_by_name !== mapping.updated_by_name && (
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="w-2.5 flex-shrink-0" />
            <span className="truncate">{t("cfm_created_by")} {mapping.created_by_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CreateView ───────────────────────────────────────────────
function CreateView({ onScratch, onExisting }) {
  const t = useT();
  return (
    <div className="flex-1 flex flex-col min-h-0 p-0">
      <div className="grid grid-cols-2 gap-5 flex-1 h-full">
        <button onClick={onScratch}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#0891b2] flex flex-col h-full"
          style={{ background: "linear-gradient(135deg, #ffffff 0%, #f0fbfd 40%, #e0f7fa 100%)", boxShadow: "0 8px 32px -8px rgba(8,145,178,0.18)" }}>
          <div className="relative z-10 flex flex-col h-full p-10">
            <div className="mb-auto">
              <div className="mb-8 relative w-20 h-20">
                <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #0891b2 0%, #06b6d4 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                  <FilePlus size={32} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("cfm_create_scratch_title")}</p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("cfm_create_scratch_desc")}</p>
            </div>
            <div className="mt-10 flex items-center justify-end">
              <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#0891b2" }}>{t("cfm_create_scratch_cta")}</span>
            </div>
          </div>
        </button>
        <button onClick={onExisting}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#dc7533] flex flex-col h-full"
          style={{ background: "linear-gradient(135deg, #ffffff 0%, #fffaf4 40%, #fef3e2 100%)", boxShadow: "0 8px 32px -8px rgba(220,117,51,0.18)" }}>
          <div className="relative z-10 flex flex-col h-full p-10">
            <div className="mb-auto">
              <div className="mb-8 relative w-20 h-20">
                <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #dc7533 0%, #e8924d 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                  <Library size={32} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("cfm_create_existing_title")}</p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("cfm_create_existing_desc")}</p>
            </div>
            <div className="mt-10 flex items-center justify-between">
              <div className="flex gap-2">{["PGC", "Danish IFRS", "Spanish IFRS-ES"].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#dc753315", color: "#dc7533" }}>{tag}</span>)}</div>
             <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#dc7533" }}>{t("cfm_create_existing_cta")}</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── SelectStandardView ───────────────────────────────────────
function SelectStandardView({ activeStandardKey, mappingKind = "structure", onPick }) {
  const t = useT();
  const { colors } = useSettings();
  const standards = ["PGC", "DanishIFRS", "SpanishIFRSEs"];
const hasCustom = activeStandardKey && activeStandardKey.startsWith("CUSTOM-") && mappingKind !== "report";
  return (
    <div className="flex-1 flex flex-col min-h-0 p-5">
      <div className={`grid ${hasCustom ? "grid-cols-4" : "grid-cols-3"} gap-5 flex-1 min-h-0`}>
        {hasCustom && (
          <StandardCard
            key={activeStandardKey}
            meta={{
              accent:      colors?.primary ?? "#7c3aed",
              accentBg:    `${colors?.primary ?? "#7c3aed"}12`,
              label:       activeStandardKey.replace(/^CUSTOM-/, "").toUpperCase(),
              full:        t("cfm_std_custom_full", "Custom standard"),
              description: t("cfm_std_custom_desc", "The onboarding standard tailored specifically for your organization"),
            }}
            onClick={() => onPick(activeStandardKey)}
          />
        )}
        {standards.map(std => <StandardCard key={std} meta={STANDARD_META[std]} onClick={() => onPick(std)} />)}
      </div>
    </div>
  );
}

function StandardCard({ meta, onClick }) {
  const t = useT();
  return (
    <button onClick={onClick}
      className="relative text-left rounded-2xl border-2 overflow-hidden transition-all group flex flex-col h-full"
      style={{ borderColor: "#f3f4f6", background: `linear-gradient(135deg, #ffffff 0%, ${meta.accentBg} 100%)`, boxShadow: `0 8px 32px -8px ${meta.accent}30` }}>
      <div className="relative z-10 flex flex-col h-full p-10">
        <div className="mb-auto">
          <div className="mb-8 relative w-20 h-20">
            <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: `linear-gradient(145deg, ${meta.accent} 0%, ${meta.accent}cc 100%)` }}>
              <Library size={32} className="text-white" strokeWidth={1.8} />
            </div>
          </div>
          <p className="font-black text-2xl text-gray-800 mb-1">{meta.label}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: meta.accent }}>{meta.full}</p>
          <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{meta.description}</p>
        </div>
        <div className="mt-10 flex items-center justify-between">
<span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: `${meta.accent}15`, color: meta.accent }}>{t("cfm_standard_tag")}</span>
          <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: meta.accent }}>{t("cfm_standard_select_cta")}</span>
        </div>
      </div>
    </button>
  );
}

// ─── CashFlowMapperView ───────────────────────────────────────
function CashFlowMapperView({
  standard, cfMappingRows = [], uploadedAccounts = [], consolidatedAccounts = [], cfNameRows = [], cfChartAccounts = [],
  cfViewMode = "consolidated", authUserId, companyId,
  editingMapping, existingMappings = [], onSaved,
  saveRef, resetRef, onDirtyChange, api, mappingKind = "structure",
}) {
const t = useT();
  const { colors } = useSettings();
  const meta = STANDARD_META[standard] ?? (
    standard?.startsWith("CUSTOM-")
      ? { accent: (colors?.primary ?? "#7c3aed"), accentBg: `${colors?.primary ?? "#7c3aed"}12`, label: standard.replace(/^CUSTOM-/, "").toUpperCase() }
      : { accent: "#0891b2", accentBg: "#e0f2fe", label: standard ?? "" }
  );

// ── CUSTOM standard editor mode ──────────────────────────────
  const isCustomEditor = !!standard && String(standard).startsWith("CUSTOM-") && mappingKind === "structure";
  const [customBaseline, setCustomBaseline] = useState(null);
  const [customLiveRows, setCustomLiveRows] = useState([]);
  const [customLiveSections, setCustomLiveSections] = useState([]);
  const [showRestoreBaselineConfirm, setShowRestoreBaselineConfirm] = useState(false);

  useEffect(() => {
    if (!isCustomEditor) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await loadCustomStandard(standard);
        if (cancelled) return;
        setCustomBaseline(fresh.baseline);
        setCustomLiveRows(fresh.rows);
        setCustomLiveSections(fresh.sections);
      } catch (e) {
        console.error("[CashFlowMapperView] loadCustomStandard failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [isCustomEditor, standard, companyId]);

// CF account meta (name + parent code) from consolidated CF/CFS rows
// Build CF tree: chart of accounts (primary) + consolidated names (secondary) + mappings (tertiary)
  const { tree: baseClientTree, groupToCf } = useMemo(() =>
    buildCfAccountTree(cfMappingRows, cfChartAccounts, cfNameRows),
    [cfMappingRows, cfChartAccounts, cfNameRows]);

  // Parent map derived from the built tree (used for amount rollup in Individual mode)
  const cfParentByCode = useMemo(() => {
    const m = new Map();
    const walk = (nodes, parent = "") => {
      nodes.forEach(n => {
        m.set(String(n.code), parent);
        walk(n.children || [], String(n.code));
      });
    };
    walk(baseClientTree);
    return m;
  }, [baseClientTree]);

// Build amounts per CF account based on view mode
  const amountsByCode = useMemo(() => {
    const out = new Map();
    if (cfViewMode === "consolidated") {
      // Consolidated: the API already returns pre-aggregated amounts for EVERY CF code
      // (both leaves and sum accounts like 1039, 1049). Use them directly — NO rollup,
      // otherwise sum codes get double-counted.
      consolidatedAccounts.forEach(r => {
        const t = r.AccountType ?? r.accountType ?? "";
        if (t !== "C/F" && t !== "CFS") return;
        const role = r.CompanyRole ?? r.companyRole ?? "";
        if (role !== "Group") return;
        const code = String(r.AccountCode ?? r.accountCode ?? "");
        const amt = -parseAmt(r.AmountYTD ?? r.amountYTD);
        out.set(code, (out.get(code) ?? 0) + amt);
      });
      return out;
    }
// Individual: roll up from uploaded → group → CF leaves → CF parent chain
    const leafAmounts = new Map();
    uploadedAccounts.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const amt = -parseAmt(r.AmountYTD ?? r.amountYTD);
      const cfs = groupToCf.get(groupCode);
      if (!cfs) return;
      cfs.forEach(cf => leafAmounts.set(cf, (leafAmounts.get(cf) ?? 0) + amt));
    });
    leafAmounts.forEach((amt, code) => {
      let cur = code;
      const visited = new Set();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        out.set(cur, (out.get(cur) ?? 0) + amt);
        cur = cfParentByCode.get(cur) || "";
      }
    });
    return out;
  }, [uploadedAccounts, consolidatedAccounts, cfViewMode, groupToCf, cfParentByCode]);

  // Group amounts (for the drill: under each CF account, show its group accounts with amounts)
  const groupAmountsByCode = useMemo(() => {
    const m = new Map();
    if (cfViewMode === "individual") {
      uploadedAccounts.forEach(r => {
        const code = String(r.AccountCode ?? r.accountCode ?? "");
        const amt = -parseAmt(r.AmountYTD ?? r.amountYTD);
        m.set(code, (m.get(code) ?? 0) + amt);
      });
    } else {
      consolidatedAccounts.forEach(r => {
        const role = r.CompanyRole ?? r.companyRole ?? "";
        if (role !== "Group") return;
        const code = String(r.AccountCode ?? r.accountCode ?? "");
        const amt = -parseAmt(r.AmountYTD ?? r.amountYTD);
        m.set(code, (m.get(code) ?? 0) + amt);
      });
    }
    return m;
  }, [uploadedAccounts, consolidatedAccounts, cfViewMode]);

  // Leaf data per group account (level 2 drill)
  const leavesByGroup = useMemo(() => {
    const m = new Map();
if (cfViewMode === "individual") {
      // Aggregate by company+localCode to collapse duplicate rows
      const tmp = new Map(); // groupCode → Map<key, leaf>
      uploadedAccounts.forEach(r => {
        const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
        const localCode = String(r.LocalAccountCode ?? r.localAccountCode ?? "");
        const localName = String(r.LocalAccountName ?? r.localAccountName ?? "");
        const company = String(r.CompanyShortName ?? r.companyShortName ?? "");
        const amt = -parseAmt(r.AmountYTD ?? r.amountYTD);
        if (!groupCode || !localCode) return;
        if (!tmp.has(groupCode)) tmp.set(groupCode, new Map());
        const byKey = tmp.get(groupCode);
        const key = `${company}|${localCode}`;
        const existing = byKey.get(key);
        if (existing) existing.amt += amt;
        else byKey.set(key, { kind: "local", code: localCode, name: localName, company, amt });
      });
      tmp.forEach((byKey, groupCode) => m.set(groupCode, [...byKey.values()]));
} else {
      // Aggregate by company+role to collapse rows with the same Company+CompanyRole
      const tmp = new Map(); // groupCode → Map<key, leaf>
      consolidatedAccounts.forEach(r => {
        const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
        const role = r.CompanyRole ?? r.companyRole ?? "";
        const company = String(r.CompanyShortName ?? r.companyShortName ?? "");
        const amt = -parseAmt(r.AmountYTD ?? r.amountYTD);
        if (!groupCode || role === "Group") return;
        if (!tmp.has(groupCode)) tmp.set(groupCode, new Map());
        const byKey = tmp.get(groupCode);
        const key = `${company}|${role}`;
        const existing = byKey.get(key);
        if (existing) existing.amt += amt;
        else byKey.set(key, { kind: "company", code: key, name: `${company} · ${role}`, company, role, amt });
      });
      tmp.forEach((byKey, groupCode) => m.set(groupCode, [...byKey.values()]));
    }
    return m;
  }, [uploadedAccounts, consolidatedAccounts, cfViewMode]);

  // Template state
  const [tplRows, setTplRows] = useState([]);
  const [tplSections, setTplSections] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [clientTree, setClientTree] = useState(null);
  const [templateTree, setTemplateTree] = useState(null);
  const [movedClientCodes, setMovedClientCodes] = useState(() => new Set());
  const [movedTemplateIds, setMovedTemplateIds] = useState(() => new Set());
  const [highlightedIds, setHighlightedIds] = useState(() => new Set());
const [conflict, setConflict] = useState(null);
  const [activeMultiSide, setActiveMultiSide] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [showSaveChoice, setShowSaveChoice] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [currentName, setCurrentName] = useState(editingMapping?.name ?? "");
  const [currentDescription, setCurrentDescription] = useState(editingMapping?.description ?? "");

  // ── Undo stack ──────────────────────────────────────────────
  const historyRef = useRef([]);
  const snapshotState = () => ({
    clientTree, templateTree,
    movedClientCodes: new Set(movedClientCodes),
    movedTemplateIds: new Set(movedTemplateIds),
    highlightedIds: new Set(highlightedIds),
  });
const pushHistory = () => {
    historyRef.current = [snapshotState(), ...historyRef.current].slice(0, 50);
    onDirtyChange?.(true);
  };
  const undo = () => {
    const last = historyRef.current[0]; if (!last) return;
    setClientTree(last.clientTree);
    setTemplateTree(last.templateTree);
    setMovedClientCodes(last.movedClientCodes);
    setMovedTemplateIds(last.movedTemplateIds);
    setHighlightedIds(last.highlightedIds);
    historyRef.current = historyRef.current.slice(1);
  };
const undoRef = useRef(undo);
  useEffect(() => { undoRef.current = undo; });
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        const tag = e.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => { historyRef.current = []; onDirtyChange?.(false); }, [standard, editingMapping?.mapping_id, onDirtyChange]);

  // Load template
  useEffect(() => {
    const ac = new AbortController();
    if (standard === "Scratch") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTplRows([]); setTplSections([]); setTplLoading(false);
      return;
    }
// CUSTOM-* standards live in the unified standard_statement_* tables.
    // Built-in ones still come from the legacy per-standard cf_ tables.
    const isCustom = standard?.startsWith("CUSTOM-");
    const cfTable = STANDARD_META[standard]?.cfTable;
    if (!isCustom && !cfTable) return;
    setTplLoading(true); setTplRows([]); setTplSections([]);

    const rowsUrl = isCustom
      ? `${SUPABASE_URL}/standard_statement_rows?select=*&standard_key=eq.${encodeURIComponent(standard)}&statement=eq.CF&order=sort_order.asc`
      : `${SUPABASE_URL}/${cfTable}_rows?select=*&order=sort_order.asc`;
    const secsUrl = isCustom
      ? `${SUPABASE_URL}/standard_statement_sections?select=*&standard_key=eq.${encodeURIComponent(standard)}&statement=eq.CF&order=sort_order.asc`
      : `${SUPABASE_URL}/${cfTable}_sections?select=*&order=sort_order.asc`;

    (async () => {
      try {
        const [rowsRes, secsRes] = await Promise.all([
          fetch(rowsUrl, { headers: sbHeaders, signal: ac.signal }),
          fetch(secsUrl, { headers: sbHeaders, signal: ac.signal }),
        ]);
        const rows = await rowsRes.json(), secs = await secsRes.json();
        if (ac.signal.aborted) return;
setTplRows(Array.isArray(rows) ? rows : []);
        setTplSections(Array.isArray(secs) ? secs : []);
        if (isCustom) {
          console.log("[CF CUSTOM tplRows]", rows?.length, rows?.slice(0, 10));
          console.log("[CF CUSTOM tplSections]", secs?.length, secs);
        }
      } catch (e) { if (e.name !== "AbortError") { setTplRows([]); setTplSections([]); } }
      finally { if (!ac.signal.aborted) setTplLoading(false); }
    })();
    return () => ac.abort();
  }, [standard]);

const baseTemplateTree = useMemo(() => {
    function addIds(nodes) { return nodes.map(n => ({ ...n, id: `tpl-${n.code}`, children: addIds(n.children || []) })); }
    const tree = addIds(buildTemplateTree(tplRows, tplSections));
    if (standard?.startsWith("CUSTOM-")) {
      const summarize = (nodes, depth = 0) => nodes.forEach(n => {
        console.log(`[CF tree] ${"  ".repeat(depth)}${n.code ?? n.kind ?? "?"} ${n.name ?? n.label ?? ""} (children: ${n.children?.length ?? 0})`);
        if (n.children?.length) summarize(n.children, depth + 1);
      });
      console.log("[CF baseTemplateTree] root count:", tree.length);
      summarize(tree);
    }
    return tree;
  }, [tplRows, tplSections, standard]);

  // Init trees
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClientTree(null); setTemplateTree(null);
    setMovedClientCodes(new Set()); setMovedTemplateIds(new Set());
  }, [standard]);

useEffect(() => {
    if (!editingMapping) return;
    const cfTree = Array.isArray(editingMapping.cf_tree) ? editingMapping.cf_tree : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplateTree(cfTree);
    if (Array.isArray(editingMapping.highlighted_ids)) setHighlightedIds(new Set(editingMapping.highlighted_ids));
    // Reconstruct movedClientCodes from the loaded tree
    const moved = new Set();
    const walk = (nodes) => (nodes || []).forEach(n => {
      if (n.kind === "breaker") { walk(n.children); return; }
      const code = String(n.code ?? "");
      if (code) moved.add(code);
      walk(n.children);
    });
    walk(cfTree);
    if (isCustomEditor) {
      // In CUSTOM mode, "moved" reflects only the accounts actually linked in
      // cfMappingRows (not the whole standard template). Filter down.
      const mappedCodes = new Set();
      (cfMappingRows || []).forEach(r => {
        const c = String(r.cashFlowAccountCode ?? r.CashFlowAccountCode ?? "");
        if (c) mappedCodes.add(c);
      });
      const filtered = new Set();
      moved.forEach(c => { if (mappedCodes.has(c)) filtered.add(c); });
      setMovedClientCodes(filtered);
    } else {
      setMovedClientCodes(moved);
    }
  }, [editingMapping, isCustomEditor, cfMappingRows]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (baseTemplateTree.length > 0 && !templateTree) setTemplateTree(baseTemplateTree); }, [baseTemplateTree, templateTree]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCurrentName(editingMapping?.name ?? ""); setCurrentDescription(editingMapping?.description ?? ""); }, [editingMapping]);

  // Pre-mark client CF codes that already exist in fresh template
  useEffect(() => {
    if (editingMapping || standard === "Scratch" || !baseTemplateTree.length || !cfMappingRows.length) return;
    const templateCodes = new Set();
    const walk = nodes => nodes.forEach(n => {
      if (n.kind !== "breaker" && n.code && !String(n.code).startsWith("__")) templateCodes.add(String(n.code));
      walk(n.children || []);
    });
    walk(baseTemplateTree);
    if (!templateCodes.size) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMovedClientCodes(prev => {
      const next = new Set(prev);
      const codes = new Set();
      cfMappingRows.forEach(r => codes.add(String(r.cashFlowAccountCode ?? r.CashFlowAccountCode ?? "")));
      codes.forEach(code => { if (code && templateCodes.has(code)) next.add(code); });
      return next;
    });
console.log("[CF init mark] editingMapping:", !!editingMapping, "baseLen:", baseTemplateTree.length, "cfMappingRowsLen:", cfMappingRows?.length, "templateCodes size:", templateCodes.size);
    const sampleMapping = cfMappingRows.slice(0, 3);
    console.log("[CF init mark] sample cfMappingRows:", sampleMapping);
    const codesFromMapping = [...new Set(cfMappingRows.map(r => String(r.cashFlowAccountCode ?? r.CashFlowAccountCode ?? "")))];
    const matched = codesFromMapping.filter(c => c && templateCodes.has(c));
    console.log("[CF init mark] unique cf codes in cfMappingRows:", codesFromMapping.length, "matched vs template:", matched.length);
    console.log("[CF init mark] sample matched:", matched.slice(0, 10));
    console.log("[CF client tree]", baseClientTree.slice(0, 5));
console.log("[CF client tree count nodes]", (() => { let n=0; const w=(nds)=>nds.forEach(x=>{n++;w(x.children||[])}); w(baseClientTree); return n; })());
  }, [editingMapping, standard, baseTemplateTree, cfMappingRows]);

const effectiveClientTree = useMemo(() => {
    if (!clientTree) return baseClientTree;
    if (baseClientTree.length === 0) return clientTree;
    const nameByCode = new Map();
    const collect = (nodes) => nodes.forEach(n => {
      if (n.code) nameByCode.set(String(n.code), n.name);
      collect(n.children || []);
    });
    collect(baseClientTree);
    const updateNames = (nodes) => nodes.map(n => ({
      ...n,
      name: nameByCode.get(String(n.code)) || n.name,
      children: updateNames(n.children || []),
    }));
    return updateNames(clientTree);
  }, [clientTree, baseClientTree]);
const effectiveTemplateTree = templateTree ?? baseTemplateTree;

  // Set of codes/section_codes considered ORIGINAL (from baseline). In CUSTOM
  // editor these can be repositioned but NOT renamed, deleted, or have their
  // is_sum toggled. In non-custom mode nothing is protected.
  const originalRowCodes = useMemo(() => {
    if (!isCustomEditor || !customBaseline?.rows) return new Set();
    const s = new Set();
    customBaseline.rows.forEach(k => {
      const [statement, code] = String(k).split("::");
      if (statement === "CF") s.add(code);
    });
    return s;
  }, [isCustomEditor, customBaseline]);
  const originalSectionCodes = useMemo(() => {
    if (!isCustomEditor || !customBaseline?.sections) return new Set();
    const s = new Set();
    customBaseline.sections.forEach(k => {
      const [statement, code] = String(k).split("::");
      if (statement === "CF") s.add(code);
    });
    return s;
  }, [isCustomEditor, customBaseline]);

  const templateAmountsById = useMemo(() => {
    const out = new Map();
    const walk = node => {
      if (node.kind === "breaker") { (node.children || []).forEach(walk); return undefined; }
      const id = node.id ?? node.code;
      if (node.children?.length > 0) {
        let sum = 0, any = false;
        node.children.forEach(c => { const v = walk(c); if (v !== undefined) { sum += v; any = true; } });
        const result = any ? sum : undefined;
        out.set(id, result);
        return result;
      }
      const amt = amountsByCode.get(node.code);
      out.set(id, amt);
      return amt;
    };
    effectiveTemplateTree.forEach(walk);
    return out;
  }, [effectiveTemplateTree, amountsByCode]);

  const sectionByCode = useMemo(() => { const m = new Map(); tplSections.forEach(s => m.set(s.section_code, { label: s.label, color: s.color })); return m; }, [tplSections]);

  // ── Save ────────────────────────────────────────────────────
  const handleSave = async ({ asNew = false } = {}) => {
if (!companyId || !authUserId) { setSaveError(t("cfm_err_not_auth")); return; }
    if (!isCustomEditor && !currentName.trim()) { setSaveError(t("cfm_err_name_required")); setShowSaveForm(true); return; }

    const cfTree = templateTree ?? [];
    const effectiveMoved = new Set();
    const collect = (nodes) => (nodes || []).forEach(n => {
      if (n.kind === "breaker") { collect(n.children); return; }
      const code = String(n.code ?? ""); if (code) effectiveMoved.add(code);
      collect(n.children);
    });
    collect(cfTree);

    const countUnmapped = (tree) => {
      let n = 0;
      const walk = (nodes) => nodes.forEach(node => {
        if (!node.isSum && !node.isSumAccount && !effectiveMoved.has(node.code)) n++;
        walk(node.children || []);
      });
      walk(tree);
      return n;
    };
    const unmapped = countUnmapped(effectiveClientTree);
if (!isCustomEditor && unmapped > 0 && (!editingMapping || asNew) && mappingKind !== "report") {
      setSaveError(unmapped === 1 ? t("cfm_err_unmapped_one") : `${t("cfm_err_unmapped_many_pre")} ${unmapped} ${t("cfm_err_unmapped_many_post")}`);
      setShowSaveForm(true);
      return;
    }

if (!isCustomEditor) {
      const trimmedName = currentName.trim().toLowerCase();
      const nameConflict = existingMappings.find(m =>
        String(m.name ?? "").trim().toLowerCase() === trimmedName &&
        (asNew || !editingMapping || m.mapping_id !== editingMapping.mapping_id)
      );
      if (nameConflict) { setSaveError(`${t("cfm_err_name_exists_pre")} "${currentName.trim()}" ${t("cfm_err_name_exists_post")}`.trim()); setShowSaveForm(true); return; }
    }

setSaving(true); setSaveError(null);
    try {
      const highlightedArr = [...highlightedIds];
      if (isCustomEditor) {
        // Silent save: hidden override + direct persistence in standard_statement_rows/sections
        let saved;
        try {
          saved = await upsertHiddenOverrideMapping({
            companyId, userId: authUserId, standard,
            cfTree, highlightedIds: highlightedArr,
          });
        } catch (up) {
          console.error("[handleSave CF] upsertHiddenOverrideMapping THREW:", up);
          throw up;
        }
        if (saved?.mapping_id) {
          try {
            await setActiveMappingSilently({ userId: authUserId, mappingId: saved.mapping_id });
          } catch (sa) {
            console.error("[handleSave CF] setActiveMappingSilently THREW:", sa);
          }
        }
        onSaved?.(saved);

if (customBaseline) {
          try {
console.log("[handleSave CF] cfTree root count:", cfTree.length);
            console.log("[handleSave CF] cfTree root names:", cfTree.map(n => `${n.kind}: ${n.name ?? n.code}`));
            console.log("[handleSave CF] templateTree === cfTree ref:", templateTree === cfTree);
            console.log("[handleSave CF] customLiveRows count:", customLiveRows.length, "CF only:", customLiveRows.filter(r => r.statement === "CF").length);
            const changes = diffCustomStandardCF({
              cfTree,
              baseline: customBaseline,
              liveRows: customLiveRows,
              liveSections: customLiveSections,
            });
            const hasAnyChange = Object.values(changes).some(arr => Array.isArray(arr) && arr.length > 0);
            console.log("[custom-save CF] changes:", JSON.stringify(changes, null, 2));
            if (hasAnyChange) {
              await saveCustomStandard({
                standardKey: standard,
                changes,
                baseline: customBaseline,
                liveRows: customLiveRows,
                liveSections: customLiveSections,
              });
              const fresh = await loadCustomStandard(standard);
              setCustomBaseline(fresh.baseline);
              setCustomLiveRows(fresh.rows);
              setCustomLiveSections(fresh.sections);
              try {
                window.dispatchEvent(new CustomEvent("custom-standard-updated", { detail: { standardKey: standard } }));
              } catch { /* ignore */ }
            }
          } catch (customErr) {
            console.error("[CashFlowMapperView] saveCustomStandard failed:", customErr, customErr.details);
            setSaveError(customErr.details?.join(" · ") ?? customErr.message);
            return;
          }
        }
      } else if (editingMapping && !asNew) {
        const updated = await api.update({ mappingId: editingMapping.mapping_id, userId: authUserId, name: currentName.trim(), description: currentDescription.trim() || null, cfTree, highlightedIds: highlightedArr, cfViewMode });
        onSaved?.(updated);
      } else {
        const created = await api.create({ companyId, userId: authUserId, name: currentName.trim(), description: currentDescription.trim() || null, standard, cfTree, highlightedIds: highlightedArr, cfViewMode });
        onSaved?.(created);
      }
      onDirtyChange?.(false);
      setShowSaveForm(false);
    } catch (e) { setSaveError(e.message); } finally { setSaving(false); }
  };

useEffect(() => {
    if (saveRef) saveRef.current = () => {
      if (isCustomEditor) { handleSave(); }
      else if (!editingMapping) { setShowSaveForm(true); }
      else { setShowSaveChoice(true); }
    };
    if (resetRef) resetRef.current = () => {
      if (isCustomEditor) { setShowRestoreBaselineConfirm(true); }
      else { setShowResetConfirm(true); }
    };
  });

// ── Handlers ────────────────────────────────────────────────
const handleReset = () => {
    pushHistory();
    setClientTree(baseClientTree); setTemplateTree(baseTemplateTree);
    setMovedClientCodes(new Set()); setMovedTemplateIds(new Set()); setHighlightedIds(new Set());
  };

  const handleRestoreBaseline = async () => {
    if (!isCustomEditor || !customBaseline) return;
    setSaving(true); setSaveError(null);
    try {
      await restoreBaseline({
        standardKey: standard,
        baseline: customBaseline,
        liveRows: customLiveRows,
        liveSections: customLiveSections,
      });
      try {
        await upsertHiddenOverrideMapping({
          companyId, userId: authUserId, standard,
          cfTree: [], highlightedIds: [],
        });
      } catch (e) { console.warn("[restore] clear override failed:", e); }
      // Reload templates + baseline
      const fresh = await loadCustomStandard(standard);
      setCustomBaseline(fresh.baseline);
      setCustomLiveRows(fresh.rows);
      setCustomLiveSections(fresh.sections);
      // Force re-fetch of tpl rows/sections that build the visible tree
      const rowsUrl = `${SUPABASE_URL}/standard_statement_rows?select=*&standard_key=eq.${encodeURIComponent(standard)}&statement=eq.CF&order=sort_order.asc`;
      const secsUrl = `${SUPABASE_URL}/standard_statement_sections?select=*&standard_key=eq.${encodeURIComponent(standard)}&statement=eq.CF&order=sort_order.asc`;
      const [rowsRes, secsRes] = await Promise.all([
        fetch(rowsUrl, { headers: sbHeaders }),
        fetch(secsUrl, { headers: sbHeaders }),
      ]);
      const rows = await rowsRes.json(), secs = await secsRes.json();
      setTplRows(Array.isArray(rows) ? rows : []);
      setTplSections(Array.isArray(secs) ? secs : []);
      // Reset visible tree + history
      setTemplateTree(null);
      setClientTree(null);
      setMovedClientCodes(new Set());
      setMovedTemplateIds(new Set());
      setHighlightedIds(new Set());
      historyRef.current = [];
      onDirtyChange?.(false);
      setShowRestoreBaselineConfirm(false);
    } catch (e) {
      console.error("[handleRestoreBaseline] failed:", e);
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
};

const handleAddBreaker = ({ name, color }) => {
    pushHistory();
    const nb = { id: `brk-${Date.now()}`, kind: "breaker", code: `__breaker__custom_${Date.now()}`, sectionCode: `custom_${Date.now()}`, name, color, children: [] };
    setTemplateTree(prev => [...(prev ?? []), nb]);
  };

  const handleColorChange = (targetId, newColor) => {
    pushHistory();
    setTemplateTree(prev => walkTransform(prev ?? effectiveTemplateTree, n =>
      (n.id === targetId || n.code === targetId) && n.kind === "breaker"
        ? { ...n, color: newColor }
        : n
    ));
  };

  const handleAddRow = ({ code, name, isSum, parentId = null }) => {
    pushHistory();
    const nn = { id: `new-${Date.now()}`, code, name, isSum, isSumAccount: isSum, sectionCode: null, showInSummary: false, sourceSide: "template", children: [] };
    setTemplateTree(prev => {
      const ct = prev ?? [];
      if (!parentId) return [...ct, nn];
      return walkTransform(ct, n => (n.id === parentId || n.code === parentId) ? { ...n, children: [...(n.children || []), nn] } : n);
    });
  };
  const handleCopy = (sourceSide, nodeId) => {
    const sourceTree = sourceSide === "client" ? effectiveClientTree : effectiveTemplateTree;
    const sourceNode = findNodeById(sourceTree, nodeId);
    if (!sourceNode) return;
    pushHistory();
    const cloned = cloneSubtree(sourceNode, sourceSide);
    setTemplateTree(prev => [...(prev ?? []), cloned]);
  };
const handleRename = (side, targetId, newName) => {
    if (side === "template" && isCustomEditor) {
      const node = findNodeById(effectiveTemplateTree, targetId);
      if (node && node.kind !== "breaker" && originalRowCodes.has(String(node.code))) {
        console.warn("[handleRename] blocked rename of original row", node.code);
        return;
      }
    }
    pushHistory();
    if (side === "client") setClientTree(prev => renameNode(prev ?? effectiveClientTree, targetId, newName));
    else setTemplateTree(prev => renameNode(prev ?? effectiveTemplateTree, targetId, newName));
  };
const handleDelete = (side, target) => {
    const targets = Array.isArray(target) ? target : [target];
    if (side === "template" && isCustomEditor) {
      const blocked = [];
      const allowed = [];
      targets.forEach(id => {
        const node = findNodeById(effectiveTemplateTree, id);
        if (!node) { allowed.push(id); return; }
        if (node.kind === "breaker" && originalSectionCodes.has(String(node.sectionCode ?? ""))) {
          blocked.push(id); return;
        }
        if (node.kind !== "breaker" && originalRowCodes.has(String(node.code))) {
          blocked.push(id); return;
        }
        allowed.push(id);
      });
      if (blocked.length > 0) {
        console.warn("[handleDelete] blocked delete of originals", blocked);
      }
      if (allowed.length === 0) return;
      target = Array.isArray(target) ? allowed : allowed[0];
    }
    pushHistory();
    const finalTargets = Array.isArray(target) ? target : [target];
    if (side === "client") {
      setClientTree(prev => {
        let tree = prev ?? effectiveClientTree;
        finalTargets.forEach(id => { tree = deleteNode(tree, id); });
        return tree;
      });
    } else {
      let newTree = effectiveTemplateTree;
      // For each target being deleted in CUSTOM mode: if it contains ORIGINAL
      // descendants, extract them (with their subtrees) and reinsert them
      // as siblings of the deleted node before removing it. This preserves
      // originals when a user-created wrapper is deleted.
      if (isCustomEditor) {
        finalTargets.forEach(id => {
          const node = findNodeById(newTree, id);
          if (!node || node.kind === "breaker") return;
          // Find originals INSIDE this subtree (not the node itself — it's custom by design)
          const salvage = [];
          const walkSubtree = (n) => {
            (n.children || []).forEach(child => {
              if (child.kind === "breaker") { walkSubtree(child); return; }
              const code = String(child.code ?? "");
              if (originalRowCodes.has(code)) {
                salvage.push(child);
              } else {
                walkSubtree(child);
              }
            });
          };
          walkSubtree(node);
          if (salvage.length === 0) return;
          // Find where 'node' lives (parent + index) so we can splice salvages there
          const locate = (nodes, parent = null) => {
            for (let i = 0; i < nodes.length; i++) {
              const n = nodes[i];
              if ((n.id ?? n.code) === (node.id ?? node.code)) return { parent, index: i, siblings: nodes };
              const found = locate(n.children || [], n);
              if (found) return found;
            }
            return null;
          };
          const loc = locate(newTree);
          if (!loc) return;
          // Remove salvages from wherever they are inside the node's subtree,
          // then insert them right before the node in its parent list.
          const stripFromTree = (tree, codes) => walkTransform(tree, x => {
            if (x.kind !== "breaker" && codes.has(String(x.code))) return null;
            return x;
          });
          const salvageCodes = new Set(salvage.map(s => String(s.code)));
          const cleanedNode = stripFromTree([node], salvageCodes)[0];
          const newParent = loc.parent ? { ...loc.parent, children: [...loc.siblings.slice(0, loc.index), ...salvage, cleanedNode, ...loc.siblings.slice(loc.index + 1)] } : null;
          if (newParent) {
            newTree = walkTransform(newTree, x => (x.id ?? x.code) === (newParent.id ?? newParent.code) ? newParent : x);
          } else {
            newTree = [...loc.siblings.slice(0, loc.index), ...salvage, cleanedNode, ...loc.siblings.slice(loc.index + 1)];
          }
        });
      }
      finalTargets.forEach(id => { newTree = deleteNode(newTree, id); });
      setTemplateTree(newTree);
      const remaining = new Set();
      const walk = (nodes) => (nodes || []).forEach(n => {
        if (n.kind === "breaker") { walk(n.children); return; }
        if (n.code) remaining.add(String(n.code));
        walk(n.children);
      });
      walk(newTree);
      setMovedClientCodes(prev => { const next = new Set(); prev.forEach(c => { if (remaining.has(c)) next.add(c); }); return next; });
    }
  };

const handleDrop = ({ sourceNode, sourceSide, targetId, position, destSide }) => {
    if (sourceSide === "template" && destSide === "client" && mappingKind !== "report") return;
    pushHistory();

    // Multi-select bundle
    if (sourceNode.code === "__multi__" && Array.isArray(sourceNode.children) && sourceNode.children.length > 0) {
      const isSameSide = sourceSide === destSide;
      const sourceTree = sourceSide === "client" ? effectiveClientTree : effectiveTemplateTree;
      let incoming = sourceNode.children;
      if (!isSameSide && destSide === "template" && mappingKind !== "report") {
        const existing = new Set();
        const walkExisting = (nodes) => nodes.forEach(n => { if (n.code && !String(n.code).startsWith("__")) existing.add(String(n.code)); walkExisting(n.children || []); });
        walkExisting(effectiveTemplateTree);
        incoming = incoming.filter(c => !existing.has(String(c.code)));
        if (!incoming.length) return;
      }
      const movingNodes = incoming.map(child => {
        if (isSameSide) { const original = findNodeById(sourceTree, child.id ?? child.code); return original ?? cloneSubtree(child, sourceSide); }
        return cloneSubtree(child, sourceSide);
      });
      let newTree = isSameSide ? sourceTree : (destSide === "client" ? effectiveClientTree : effectiveTemplateTree);
      const safePos = (position === "inside" && destSide === "template") ? "inside" : (position === "inside" ? "after" : position);
      movingNodes.forEach((child, i) => {
        if (isSameSide) newTree = deleteNode(newTree, child.id ?? child.code);
        if (i === 0) { newTree = targetId ? insertAt(newTree, targetId, safePos, child) : appendToRoot(newTree, child); }
        else { const prev = movingNodes[i - 1].id ?? movingNodes[i - 1].code; newTree = insertAt(newTree, prev, "after", child); }
      });
      if (destSide === "client") setClientTree(newTree); else setTemplateTree(newTree);
      if (sourceSide === "client" && destSide === "template") {
        setMovedClientCodes(prev => new Set([...prev, ...incoming.flatMap(n => {
          const codes = []; const walk = x => { codes.push(x.code); (x.children||[]).forEach(walk); }; walk(n); return codes;
        })]));
      }
      return;
    }

    // Block if already mapped (client → template, structure mode)
    if (sourceSide === "client" && destSide === "template" && mappingKind !== "report") {
      const code = String(sourceNode.code ?? "");
      const templateHasCode = (() => {
        let found = false;
        const walk = (nodes) => nodes.forEach(n => {
          if (String(n.code ?? "") === code) found = true;
          walk(n.children || []);
        });
        walk(effectiveTemplateTree);
        return found;
      })();
      if (movedClientCodes.has(code) || templateHasCode) return;
    }

    // Demote inside to after for non-sum template rows
    if (destSide === "template" && position === "inside" && targetId) {
      const targetNode = findNodeById(effectiveTemplateTree, targetId);
      if (targetNode && targetNode.kind !== "breaker") {
        const targetIsSum = !!(targetNode.isSum || targetNode.isSumAccount);
        if (!targetIsSum) position = "after";
      }
    }

    // Same-side move
    if (sourceSide === destSide) {
      const tree = destSide === "client" ? effectiveClientTree : effectiveTemplateTree;
      const sourceId = sourceNode.id ?? sourceNode.code;
      if (sourceId === targetId || isDescendantOf(tree, sourceId, targetId)) return;
      const originalNode = findNodeById(tree, sourceId);
      if (!originalNode) return;
      const without = deleteNode(tree, sourceId);
      const newTree = targetId ? insertAt(without, targetId, position, originalNode) : appendToRoot(without, originalNode);
      if (destSide === "client") setClientTree(newTree); else setTemplateTree(newTree);
      return;
    }

    const destTree = destSide === "client" ? effectiveClientTree : effectiveTemplateTree;
    const cloned = cloneSubtree(sourceNode, sourceSide);
    const duplicates = mappingKind === "report" ? [] : findDuplicates(cloned, destTree);

    const performInsert = (treeAfterDedupe, nodeToInsert) => {
      const newTree = targetId ? insertAt(treeAfterDedupe, targetId, position, nodeToInsert) : appendToRoot(treeAfterDedupe, nodeToInsert);
      if (destSide === "client") setClientTree(newTree); else setTemplateTree(newTree);
      const sourceIds = collectIdsFromSubtree(sourceNode);
      if (sourceSide === "client") {
        function collectCodes(n) { const out = [n.code]; (n.children||[]).forEach(c => collectCodes(c).forEach(x => out.push(x))); return out; }
        const codes = collectCodes(sourceNode);
        setMovedClientCodes(prev => new Set([...prev, ...codes]));
      } else setMovedTemplateIds(prev => new Set([...prev, ...sourceIds]));
    };

    if (duplicates.length === 0) { performInsert(destTree, cloned); return; }
    setConflict({ duplicates, onResolve: choice => {
      setConflict(null);
      if (choice === "cancel" || choice === "discard-imported") return;
      if (choice === "keep-both") { performInsert(destTree, cloned); return; }
      if (choice === "replace-existing") { performInsert(removeByNames(destTree, new Set(duplicates)), cloned); return; }
    }});
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
<ClientPanel
          mappingKind={mappingKind}
          amountsByCode={amountsByCode}
          groupAmountsByCode={groupAmountsByCode}
          leavesByGroup={leavesByGroup}
          cfViewMode={cfViewMode}
          tree={effectiveClientTree}
          movedIds={movedClientCodes}
          onDrop={p => handleDrop({ ...p, destSide: "client" })}
          onRename={(id, name) => handleRename("client", id, name)}
          onDelete={id => handleDelete("client", id)}
          onCopy={id => handleCopy("client", id)}
          accent={meta.accent}
activeMultiSide={activeMultiSide}
          onSetMultiSide={setActiveMultiSide}
          isCustomEditor={isCustomEditor}
          onRestoreBaseline={isCustomEditor ? () => setShowRestoreBaselineConfirm(true) : null}
        />
        <TemplatePanel
          mappingKind={mappingKind}
          templateAmountsById={templateAmountsById}
          tree={effectiveTemplateTree}
          sectionByCode={sectionByCode}
          loading={tplLoading}
          accent={meta.accent}
          standardLabel={meta.label}
          movedIds={movedTemplateIds}
          onDrop={p => handleDrop({ ...p, destSide: "template" })}
          onRename={(id, name) => handleRename("template", id, name)}
          onDelete={id => handleDelete("template", id)}
onAddRow={handleAddRow}
          onAddBreaker={handleAddBreaker}
          onColorChange={handleColorChange}
          originalRowCodes={originalRowCodes}
          originalSectionCodes={originalSectionCodes}
          onCopy={id => handleCopy("template", id)}
          highlightedIds={highlightedIds}
          onToggleHighlight={id => { pushHistory(); setHighlightedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }}
activeMultiSide={activeMultiSide}
          onSetMultiSide={setActiveMultiSide}
          isCustomEditor={isCustomEditor}
          onRestoreBaseline={isCustomEditor ? () => setShowRestoreBaselineConfirm(true) : null}
        />
      </div>
      {conflict && <ConflictModal duplicates={conflict.duplicates} onResolve={conflict.onResolve} />}
      {showSaveForm && <SaveMappingForm name={currentName} setName={setCurrentName} description={currentDescription} setDescription={setCurrentDescription} error={saveError} saving={saving} asNew={!!editingMapping} accent={meta.accent} onCancel={() => { setShowSaveForm(false); setSaveError(null); }} onSave={() => handleSave({ asNew: !!editingMapping })} />}
{showRestoreBaselineConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={() => setShowRestoreBaselineConfirm(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)" }}>
              <p className="text-white font-black text-lg leading-tight">Restore original standard</p>
              <p className="text-white/70 text-[11px] mt-0.5">This will revert all custom edits back to the AI-generated baseline.</p>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-xs text-gray-500 leading-relaxed pb-2">All custom-added CF rows and sections will be deleted, and originals will be restored to their initial values. This cannot be undone.</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowRestoreBaselineConfirm(false)} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">Cancel</button>
                <button onClick={handleRestoreBaseline} disabled={saving} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50" style={{ background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)" }}>{saving ? "Restoring…" : "Restore"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={() => setShowResetConfirm(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
<p className="text-white font-black text-lg leading-tight">{t("cfm_reset_title_full")}</p>
              <p className="text-white/70 text-[11px] mt-0.5">{t("cfm_reset_subtitle")}</p>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-xs text-gray-500 leading-relaxed pb-2">{t("cfm_reset_desc")}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">{t("cfm_cancel_btn")}</button>
                <button onClick={() => { handleReset(); setShowResetConfirm(false); }} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90 active:scale-[0.98]" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>{t("cfm_reset_btn")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSaveChoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={() => setShowSaveChoice(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}cc 100%)` }}>
<p className="text-white font-black text-lg leading-tight">{t("cfm_save_choice_title")}</p>
              <p className="text-white/70 text-[11px] mt-0.5">{t("cfm_save_choice_subtitle")}</p>
            </div>
            <div className="p-5 space-y-2">
              <button onClick={() => { setShowSaveChoice(false); handleSave(); }} className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#0891b2] hover:bg-[#e0f7fa]/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-[#0891b2]">{t("cfm_overwrite_pre")} "{editingMapping?.name}"</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("cfm_overwrite_desc")}</p>
              </button>
              <button onClick={() => { setShowSaveChoice(false); setShowSaveForm(true); }} className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#0891b2] hover:bg-[#e0f7fa]/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-[#0891b2]">{t("cfm_save_as_new")}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("cfm_save_as_new_desc")}</p>
              </button>
              <button onClick={() => setShowSaveChoice(false)} className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all mt-2">{t("cfm_cancel_btn")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ConflictModal ────────────────────────────────────────────
function ConflictModal({ duplicates, onResolve }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={() => onResolve("cancel")}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
<div className="bg-amber-500 px-6 py-4"><p className="text-white font-black text-base">{t("cfm_conflict_title")}</p><p className="text-white/70 text-[10px] uppercase tracking-widest mt-0.5">{duplicates.length} {duplicates.length === 1 ? t("cfm_conflict_match") : t("cfm_conflict_matches")} {t("cfm_conflict_found")}</p></div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-600">{duplicates.length === 1 ? t("cfm_conflict_desc_one") : t("cfm_conflict_desc_many")}</p>
          <div className="bg-gray-50 rounded-xl p-3 max-h-40 overflow-y-auto">{duplicates.map((d, i) => <div key={i} className="text-xs text-gray-700 font-mono py-0.5 truncate">· {d}</div>)}</div>
          <div className="space-y-2 pt-2">
            {[["replace-existing", t("cfm_conflict_replace"), t("cfm_conflict_replace_desc")],["discard-imported", t("cfm_conflict_discard"), t("cfm_conflict_discard_desc")]].map(([choice, title, desc]) => (
              <button key={choice} onClick={() => onResolve(choice)} className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#0891b2] hover:bg-[#e0f7fa]/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-[#0891b2]">{title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ClientPanel (CF accounts) ────────────────────────────────
function ClientPanel({ mappingKind, amountsByCode, groupAmountsByCode, leavesByGroup, cfViewMode, tree, movedIds, onDrop, onRename, onDelete, onCopy, accent, activeMultiSide, onSetMultiSide }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [hideAmounts, setHideAmounts] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [flatMode, setFlatMode] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const lastSelectedRef = useRef(null);
  const viewMenuRef = useRef(null);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const handler = e => { if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) setViewMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewMenuOpen]);
const [prevActiveMultiSide, setPrevActiveMultiSide] = useState(activeMultiSide);
  if (prevActiveMultiSide !== activeMultiSide) {
    setPrevActiveMultiSide(activeMultiSide);
    if (activeMultiSide !== "client" && multiMode) {
      setMultiMode(false);
      setSelectedIds(new Set());
    }
  }
const [prevMovedIds, setPrevMovedIds] = useState(movedIds);
  if (prevMovedIds !== movedIds) {
    setPrevMovedIds(movedIds);
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const next = new Set();
      prev.forEach(id => {
        const code = typeof id === "string" && id.startsWith("cli-") ? id.slice(4) : id;
        if (!movedIds.has(code) && !movedIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }
  const totalCount = useMemo(() => countNodes(tree), [tree]);
  const allKeys = useMemo(() => collectAllCodes(tree, "client"), [tree]);
  const flatTree = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (!n.isSum && !n.isSumAccount) out.push({ ...n, children: [] }); walk(n.children || []); }); }
    walk(tree);
    return out;
  }, [tree]);
const filteredTree = useMemo(() => {
    let source = flatMode ? flatTree : tree;
    const flat = flatMode;
    if (unmappedOnly) {
      source = flat ? source.filter(n => !movedIds.has(n.code)) : filterTree(source, n => !movedIds.has(n.code));
    }
    if (hideZero) {
      const pred = n => { const amt = amountsByCode.get(n.code); return amt !== undefined && Math.abs(amt) >= 0.5; };
      source = flat ? source.filter(pred) : filterTree(source, pred);
    }
    if (!search.trim()) return source;
    const q = search.toLowerCase();
    const sp = n => n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q);
    return flat ? source.filter(sp) : filterTree(source, sp);
  }, [tree, flatTree, flatMode, search, unmappedOnly, hideZero, movedIds, amountsByCode]);
const flatSelectableIds = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (mappingKind === "report" || (!n.isSum && !n.isSumAccount)) out.push(n.id ?? n.code); walk(n.children || []); }); }
    walk(filteredTree);
    return out;
  }, [filteredTree, mappingKind]);
// Prune selection to whatever is currently visible — robust against any filter combo.
  const [prevFilteredTreeRef, setPrevFilteredTreeRef] = useState(filteredTree);
  if (prevFilteredTreeRef !== filteredTree) {
    setPrevFilteredTreeRef(filteredTree);
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set();
      const walk = (nodes) => nodes.forEach(n => { visible.add(n.id ?? n.code); walk(n.children || []); });
      walk(filteredTree);
      const next = new Set();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }

  const visibleCount = useMemo(() => countNodes(filteredTree), [filteredTree]);
  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const isExpanded = allKeys.length > 0 && allKeys.every(k => expanded[k]);

  return (
<Panel
      title={t("cfm_panel_client_title")}
      subtitle={unmappedOnly ? `${visibleCount} ${t("cfm_unmapped_count_suffix")}` : `${totalCount} ${t("cfm_cf_accounts_suffix")} · ${cfViewMode === "individual" ? t("cfm_mode_individual") : t("cfm_mode_consolidated")}`}
      accent={accent}
      onExpandAll={() => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])))}
      onCollapseAll={() => setExpanded({})}
      isExpanded={isExpanded}
extra={
        <div className="flex items-center gap-1">
          <button onClick={() => { const next = !multiMode; setMultiMode(next); setSelectedIds(new Set()); onSetMultiSide?.(next ? "client" : null); }} title={multiMode ? t("cfm_exit_multi") : t("cfm_multi_select")}
            className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
            style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: multiMode ? accent : `${accent}10`, color: multiMode ? "white" : accent }}>
            <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17 14v6M14 17h6"/>
            </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("cfm_select_label")}</span>
          </button>
          <button onClick={() => setFlatMode(f => !f)} title={flatMode ? t("cfm_tree_title") : t("cfm_flat_title")}
            className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
            style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: flatMode ? accent : `${accent}10`, color: flatMode ? "white" : accent }}>
            <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              {flatMode ? <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="13" y1="18" x2="21" y2="18"/></>}
            </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{flatMode ? t("cfm_flat_label") : t("cfm_tree_label")}</span>
          </button>
          <button onClick={() => setUnmappedOnly(u => !u)} title={unmappedOnly ? t("cfm_show_all_title") : t("cfm_show_unmapped_title")}
            className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
            style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: unmappedOnly ? accent : `${accent}10`, color: unmappedOnly ? "white" : accent }}>
            <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            <span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[120px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("cfm_unmapped_label")}</span>
          </button>
          <div ref={viewMenuRef} className="relative flex-shrink-0">
            <button onClick={() => setViewMenuOpen(o => !o)} title="View options"
              className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
              style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: (hideZero || hideAmounts) ? accent : `${accent}10`, color: (hideZero || hideAmounts) ? "white" : accent }}>
              <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("cfm_values_label")}</span>
            </button>
            {viewMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-[60] min-w-[210px] rounded-xl bg-white overflow-hidden"
                style={{ border: `1px solid ${accent}15`, boxShadow: `0 20px 50px -12px ${accent}30`, animation: "viewMenuIn 220ms cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="px-3 pt-2 pb-1.5 border-b border-gray-50">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: accent, opacity: 0.55 }}>{t("cfm_view_options")}</p>
                </div>
                <button onClick={() => setHideZero(z => !z)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
                  <span className="text-[11px] font-bold text-gray-700">{t("cfm_hide_zero")}</span>
                  <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideZero ? accent : "#d1d5db" }}>
                    <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideZero ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                  </span>
                </button>
                <button onClick={() => setHideAmounts(a => !a)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors border-t border-gray-50">
                  <span className="text-[11px] font-bold text-gray-700">{t("cfm_hide_amounts")}</span>
                  <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideAmounts ? accent : "#d1d5db" }}>
                    <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideAmounts ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                  </span>
                </button>
              </div>
            )}
            <style>{`@keyframes viewMenuIn { from { opacity: 0; transform: translateY(-6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
          </div>
        </div>
      }>
<PanelToolbar search={search} setSearch={setSearch} placeholder={t("cfm_search_cf")} count={visibleCount} total={totalCount} />
      <div className="flex-1 overflow-y-auto px-1" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("application/json")); if (data.sourceSide === "template") onDrop({ sourceNode: data.node, sourceSide: "template", targetId: null, position: "after" }); } catch { /* ignore */ } }}>
        {filteredTree.length === 0 ? <EmptyPanelState icon={FileText} message={search ? t("cfm_no_matches") : t("cfm_no_cf_accounts")} />
: filteredTree.map(node => (
<DraggableTreeRow
              key={node.id ?? node.code} node={node} depth={0}
              expanded={expanded} onToggle={toggle}
              side="client" mappingKind={mappingKind} hideAmounts={hideAmounts} hideZero={hideZero}
              amountsByCode={amountsByCode}
              groupAmountsByCode={groupAmountsByCode}
              leavesByGroup={leavesByGroup}
              cfViewMode={cfViewMode}
              movedIds={movedIds}
              onDrop={onDrop} onRename={onRename} onDelete={onDelete} onCopy={onCopy}
              multiMode={multiMode} selectedIds={selectedIds} clientTree={tree}
              onToggleSelect={(id, shiftKey) => {
                if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
                  const from = flatSelectableIds.indexOf(lastSelectedRef.current);
                  const to = flatSelectableIds.indexOf(id);
                  if (from !== -1 && to !== -1) {
                    const range = flatSelectableIds.slice(Math.min(from, to), Math.max(from, to) + 1);
                    setSelectedIds(prev => new Set([...prev, ...range]));
                    lastSelectedRef.current = id;
                    return;
                  }
                }
                lastSelectedRef.current = id;
                setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
              }}
            />
          ))}
      </div>
    </Panel>
  );
}

// ─── TemplatePanel ────────────────────────────────────────────
function TemplatePanel({ mappingKind, templateAmountsById, tree, sectionByCode, loading, accent, standardLabel, movedIds, onDrop, onRename, onDelete, onAddRow, onAddBreaker, onCopy, highlightedIds, onToggleHighlight, activeMultiSide, onSetMultiSide, isCustomEditor = false, onRestoreBaseline = null, onColorChange, originalRowCodes = new Set(), originalSectionCodes = new Set() }) {
  const t = useT();
  const [pendingParentId, setPendingParentId] = useState(null);
  const [showBreakerForm, setShowBreakerForm] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [hideAmounts, setHideAmounts] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef(null);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const handler = e => { if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) setViewMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewMenuOpen]);
  const [multiMode, setMultiMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const lastSelectedRef = useRef(null);
const [prevActiveMultiSide, setPrevActiveMultiSide] = useState(activeMultiSide);
  if (prevActiveMultiSide !== activeMultiSide) {
    setPrevActiveMultiSide(activeMultiSide);
    if (activeMultiSide !== "template" && multiMode) {
      setMultiMode(false);
      setSelectedIds(new Set());
    }
  }
  const totalCount = useMemo(() => countNodes(tree), [tree]);
const filteredTree = useMemo(() => {
    let source = tree;
    if (hideZero) {
      source = filterTree(source, n => {
        if (n.kind === "breaker") return true;
        const amt = templateAmountsById.get(n.id ?? n.code);
        return amt !== undefined && Math.abs(amt) >= 0.5;
      });
    }
    if (!search.trim()) return source;
    return filterTreeTpl(source, search.toLowerCase());
  }, [tree, search, hideZero, templateAmountsById]);
  const flatSelectableIds = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (n.kind !== "breaker") out.push(n.id ?? n.code); walk(n.children || []); }); }
    walk(filteredTree);
    return out;
  }, [filteredTree]);
// Prune selection to whatever is currently visible — robust against any filter combo.
  const [prevFilteredTreeRef, setPrevFilteredTreeRef] = useState(filteredTree);
  if (prevFilteredTreeRef !== filteredTree) {
    setPrevFilteredTreeRef(filteredTree);
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set();
      const walk = (nodes) => nodes.forEach(n => { visible.add(n.id ?? n.code); walk(n.children || []); });
      walk(filteredTree);
      const next = new Set();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }
  const visibleCount = useMemo(() => countNodes(filteredTree), [filteredTree]);
  const allKeys = useMemo(() => collectAllCodes(tree, "tpl"), [tree]);
  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const isExpanded = allKeys.length > 0 && allKeys.every(k => expanded[k]);
  return (
<Panel
      title={`${standardLabel} ${t("cfm_panel_template_suffix")}`}
      subtitle={loading ? t("cfm_loading_ellipsis") : `${totalCount} ${t("cfm_rows_suffix")}`}
      accent={accent}
      onExpandAll={() => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])))}
      onCollapseAll={() => setExpanded({})}
      isExpanded={isExpanded}
extra={
        <div className="flex items-center gap-1">
{isCustomEditor && onRestoreBaseline && (
          <button onClick={onRestoreBaseline} title="Restore original standard"
            className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
            style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: "#dc262610", color: "#dc2626" }}>
            <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
            <span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>Restore</span>
          </button>
        )}
       <button onClick={() => { const next = !multiMode; setMultiMode(next); setSelectedIds(new Set()); onSetMultiSide?.(next ? "template" : null); }} title={multiMode ? t("cfm_exit_multi") : t("cfm_multi_select")}
          className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
          style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: multiMode ? accent : `${accent}10`, color: multiMode ? "white" : accent }}>
          <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17 14v6M14 17h6"/>
          </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("cfm_select_label")}</span>
        </button>
<div ref={viewMenuRef} className="relative flex-shrink-0">
          <button onClick={() => setViewMenuOpen(o => !o)} title={t("cfm_view_options")}
            className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
            style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: (hideZero || hideAmounts) ? accent : `${accent}10`, color: (hideZero || hideAmounts) ? "white" : accent }}>
            <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("cfm_values_label")}</span>
          </button>
          {viewMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-[60] min-w-[210px] rounded-xl bg-white overflow-hidden"
              style={{ border: `1px solid ${accent}15`, boxShadow: `0 20px 50px -12px ${accent}30`, animation: "viewMenuIn 220ms cubic-bezier(0.34,1.56,0.64,1)" }}>
              <div className="px-3 pt-2 pb-1.5 border-b border-gray-50">
                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: accent, opacity: 0.55 }}>{t("cfm_view_options")}</p>
              </div>
              <button onClick={() => setHideZero(z => !z)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
                <span className="text-[11px] font-bold text-gray-700">{t("cfm_hide_zero")}</span>
                <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideZero ? accent : "#d1d5db" }}>
                  <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideZero ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                </span>
              </button>
              <button onClick={() => setHideAmounts(a => !a)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors border-t border-gray-50">
                <span className="text-[11px] font-bold text-gray-700">{t("cfm_hide_amounts")}</span>
                <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideAmounts ? accent : "#d1d5db" }}>
                  <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideAmounts ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                </span>
              </button>
            </div>
          )}
        </div>
        </div>
      }>
     <PanelToolbar search={search} setSearch={setSearch} placeholder={t("cfm_search_template")} count={visibleCount} total={totalCount} />
      <AddRowForm accent={accent} onAdd={p => onAddRow({ ...p, parentId: pendingParentId })} existingTree={tree} pendingParentId={pendingParentId} onClearParent={() => setPendingParentId(null)} tree={tree} />
      <AddBreakerForm accent={accent} open={showBreakerForm} onOpen={() => setShowBreakerForm(true)} onClose={() => setShowBreakerForm(false)} onAdd={onAddBreaker} />
      <div className="flex-1 overflow-y-auto px-1" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("application/json")); onDrop({ sourceNode: data.node, sourceSide: data.sourceSide, targetId: null, position: "after" }); } catch { /* ignore */ } }}>
{loading ? <div className="text-center py-16 text-xs text-gray-400">{t("cfm_loading_template")}</div>
          : filteredTree.length === 0 ? <EmptyPanelState icon={Library} message={search ? t("cfm_no_matches") : t("cfm_no_rows")} />
: filteredTree.map(node => (
            <DraggableTreeRow
              key={node.id ?? node.code} node={node} depth={0}
              expanded={expanded} onToggle={toggle}
side="template" mappingKind={mappingKind} hideAmounts={hideAmounts}
              templateAmountsById={templateAmountsById}
              movedIds={movedIds}
              onDrop={onDrop} onRename={onRename}
onDelete={id => {
                if (multiMode && selectedIds.size > 0 && selectedIds.has(id)) {
                  onDelete([...selectedIds]);
                  setSelectedIds(new Set());
                } else {
                  onDelete(id);
                }
              }}
onCopy={onCopy}
              onColorChange={onColorChange}
              originalRowCodes={originalRowCodes}
              originalSectionCodes={originalSectionCodes}
              onAddChild={parentId => { setPendingParentId(parentId); setExpanded(prev => ({ ...prev, [`tpl-${parentId}`]: true })); }}
              sectionByCode={sectionByCode}
              highlightedIds={highlightedIds} onToggleHighlight={onToggleHighlight}
              multiMode={multiMode} selectedIds={selectedIds} templateTree={tree}
              onToggleSelect={(id, shiftKey) => {
                if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
                  const from = flatSelectableIds.indexOf(lastSelectedRef.current);
                  const to = flatSelectableIds.indexOf(id);
                  if (from !== -1 && to !== -1) {
                    const range = flatSelectableIds.slice(Math.min(from, to), Math.max(from, to) + 1);
                    setSelectedIds(prev => new Set([...prev, ...range]));
                    lastSelectedRef.current = id;
                    return;
                  }
                }
                lastSelectedRef.current = id;
                setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
              }}
            />
          ))}
      </div>
    </Panel>
  );
}

// ─── AnimatedAmount ──────────────────────────────────────────
function AnimatedAmount({ value, hidden }) {
  const t = useT();
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const isFirstRef = useRef(true);
  useEffect(() => {
    if (isFirstRef.current) { isFirstRef.current = false; prevRef.current = value; setDisplay(value); return; }
    const from = prevRef.current, to = value;
    if (to === undefined || from === undefined) { setDisplay(to); prevRef.current = to; return; }
    if (Math.abs(from - to) < 0.5) { setDisplay(to); prevRef.current = to; return; }
    const start = performance.now(), duration = 700;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick); else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const hasAmt = display !== undefined;
  const isZero = hasAmt && Math.abs(display) < 0.5;
  const colorClass = !hasAmt || isZero ? "text-gray-300" : display < 0 ? "text-red-500" : "text-gray-600";
  return (
    <span className={`text-[11px] font-mono font-semibold flex-shrink-0 tabular-nums overflow-hidden whitespace-nowrap inline-block ${colorClass}`}
      style={{
        maxWidth: hidden ? 0 : 120, opacity: hidden ? 0 : 1,
        transform: hidden ? "translateX(8px) scale(0.7)" : "translateX(0) scale(1)",
        userSelect: hidden ? "none" : "auto",
        transition: "max-width 380ms cubic-bezier(0.34,1.56,0.64,1), opacity 240ms ease, transform 380ms cubic-bezier(0.34,1.56,0.64,1)",
      }}
      title={hidden ? "" : (hasAmt ? Math.round(value).toLocaleString() : t("cfm_no_data"))}>
      {!hasAmt ? "—" : Math.round(display).toLocaleString()}
    </span>
  );
}

// ─── DraggableTreeRow ────────────────────────────────────────
function DraggableTreeRow({
  node, depth, expanded, onToggle, side, mappingKind, hideAmounts, hideZero = false,
  amountsByCode = new Map(), templateAmountsById = new Map(),
  groupAmountsByCode = new Map(), leavesByGroup = new Map(),
  cfViewMode = "consolidated",
movedIds, onDrop, onRename, onDelete, onCopy, onAddChild, onColorChange,
  originalRowCodes = new Set(), originalSectionCodes = new Set(),
  sectionByCode, highlightedIds, onToggleHighlight,
multiMode = false, selectedIds = new Set(), onToggleSelect, clientTree, templateTree,
}) {
  const t = useT();
  const key = `${side === "client" ? "client" : "tpl"}-${node.code}`;
  const isOpen = !!expanded[key];
  const hasChildren = (node.children?.length ?? 0) > 0;
  // For client CF accounts, "expand" means show group accounts even if there are no CF children
  const hasGroupAccounts = side === "client" && (node.groupAccounts?.length ?? 0) > 0;
  const canExpand = hasChildren || hasGroupAccounts;
  const isSum = node.isSum ?? node.isSumAccount;
  const isMoved = side === "client" ? movedIds.has(node.code) : movedIds.has(node.id ?? node.code);
  const [dropZone, setDropZone] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
const [hovering, setHovering] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const editInputRef = useRef(null);
  const colorPickerRef = useRef(null);
  useEffect(() => {
    if (!showColorPicker) return;
    const handler = e => { if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) setShowColorPicker(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColorPicker]);
  useEffect(() => { if (editing && editInputRef.current) { editInputRef.current.focus(); editInputRef.current.select(); } }, [editing]);
  const startEdit = e => { e.stopPropagation(); setEditValue(node.name); setEditing(true); };
  const commitEdit = () => { const trimmed = editValue.trim(); if (trimmed && trimmed !== node.name) onRename?.(node.id ?? node.code, trimmed); setEditing(false); };
  const cancelEdit = () => { setEditValue(node.name); setEditing(false); };

const handleDragStart = e => {
    if (side === "client" && mappingKind !== "report" && !isSum && movedIds?.has(node.code)) { e.preventDefault(); return; }
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "copyMove";
    const nodeId = node.id ?? node.code;
    if (multiMode && selectedIds?.size > 0 && selectedIds.has(nodeId)) {
      const sourceTree = side === "client" ? clientTree : templateTree;
      const selected = [];
      const isClientStructure = side === "client" && mappingKind !== "report";
      function collect(ns) {
        ns.forEach(n => {
          const id = n.id ?? n.code;
          const blockedClient = isClientStructure && !(n.isSum || n.isSumAccount) && (movedIds?.has(n.code) || movedIds?.has(id));
          if (selectedIds.has(id) && n.kind !== "breaker" && !blockedClient) {
            selected.push({ ...stripSubtreeForTransfer(n), id });
          }
          collect(n.children || []);
        });
      }
      collect(sourceTree ?? []);
      if (!selected.length) { e.preventDefault(); return; }
      const multiNode = { id: `multi-${Date.now()}`, code: "__multi__", name: `${selected.length} accounts`, isSum: false, isSumAccount: false, children: selected };
      e.dataTransfer.setData("application/json", JSON.stringify({ sourceSide: side, node: multiNode }));
      return;
    }
    e.dataTransfer.setData("application/json", JSON.stringify({ sourceSide: side, node: { ...stripSubtreeForTransfer(node), id: node.id } }));
  };
  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const canHaveInside = isSum || node.kind === "breaker";
    if (canHaveInside) {
      if (y < h * 0.2) setDropZone("before");
      else if (y > h * 0.8) setDropZone("after");
      else setDropZone("inside");
    } else {
      setDropZone(y < h * 0.5 ? "before" : "after");
    }
  };
  const handleDrop = e => { e.preventDefault(); e.stopPropagation(); const zone = dropZone; setDropZone(null); try { const data = JSON.parse(e.dataTransfer.getData("application/json")); onDrop({ sourceNode: data.node, sourceSide: data.sourceSide, targetId: node.id ?? node.code, position: zone ?? "after" }); } catch { /* ignore */ } };
  const accent = side === "client" ? "#0891b2" : "#374151";
  const dropLine = (
    <div className="relative my-0.5 pointer-events-none" style={{ marginLeft: 8 + depth * 14, marginRight: 8 }}>
      <div style={{ height: 3, background: accent, borderRadius: 2, boxShadow: `0 0 14px ${accent}, 0 0 4px ${accent}` }} />
      <div className="absolute top-1/2 -translate-y-1/2" style={{ left: -3, width: 9, height: 9, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${accent}, 0 0 2px ${accent}` }} />
    </div>
  );

  // Breaker rendering
  if (node.kind === "breaker") {
    return (
      <>
        {dropZone === "before" && dropLine}
        <div draggable={!editing} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragLeave={() => setDropZone(null)} onDrop={handleDrop} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} onClick={!editing && hasChildren ? e => { if (e.detail === 1) onToggle(key); } : undefined}
          className={`flex items-center min-w-0 gap-2 px-3 py-2 my-1 rounded-lg transition-all ${editing ? "cursor-text" : "cursor-grab active:cursor-grabbing"}`}
          style={{ backgroundColor: node.color || "#374151" }}>
          {hasChildren && <span className="text-white/70 flex-shrink-0">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>}
          {editing ? (
            <input ref={editInputRef} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} onBlur={commitEdit} className="text-xs flex-1 min-w-0 px-2 py-0.5 rounded border border-white/40 outline-none focus:border-white bg-white/15 text-white uppercase tracking-widest font-black" />
          ) : <span className="text-xs flex-1 min-w-0 truncate font-black uppercase tracking-widest text-white">{node.name}</span>}
{!editing && (hovering || showColorPicker) && (() => {
            const isOriginalBreaker = side === "template" && originalSectionCodes.has(String(node.sectionCode ?? ""));
            return (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={startEdit} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white"><Pencil size={13} /></button>
              {onColorChange && (
                <div ref={colorPickerRef} className="relative" onMouseDown={e => e.stopPropagation()}>
                  <button onClick={e => { e.stopPropagation(); setShowColorPicker(v => !v); }} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white" title="Cambiar color">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
                  </button>
                  {showColorPicker && (
                    <div className="absolute top-full right-0 mt-1 z-50 bg-white rounded-xl shadow-2xl p-2.5 border border-gray-100" style={{ minWidth: 200 }} onClick={e => e.stopPropagation()}>
                      <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2 px-1">Color de sección</div>
                      <div className="grid grid-cols-6 gap-1.5">
                        {["#0891b2","#CF305D","#374151","#57aa78","#dc7533","#7c3aed","#1a2f8a","#ca8a04"].map(c => (
                          <button key={c} onClick={() => { onColorChange(node.id ?? node.code, c); setShowColorPicker(false); }} className="w-7 h-7 rounded-lg transition-all hover:scale-110" style={{ backgroundColor: c, boxShadow: (node.color || "").toLowerCase() === c.toLowerCase() ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : "none", transform: (node.color || "").toLowerCase() === c.toLowerCase() ? "scale(1.12)" : "scale(1)" }} title={c} />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-gray-100">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 flex-shrink-0">Personalizado</span>
                        <input type="color" value={node.color || "#374151"} onChange={e => onColorChange(node.id ?? node.code, e.target.value)} className="w-6 h-6 rounded-md cursor-pointer border border-gray-200 p-0 bg-transparent" style={{ appearance: "none" }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
{!isOriginalBreaker && (
                <button onClick={e => { e.stopPropagation(); onDelete?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white"><Trash2 size={13} /></button>
              )}
            </div>
            );
          })()}
        </div>
        {dropZone === "after" && dropLine}
{isOpen && hasChildren && node.children.map(child => (
          <DraggableTreeRow key={child.id ?? child.code} node={child} depth={1}
            expanded={expanded} onToggle={onToggle}
            side={side} mappingKind={mappingKind} hideAmounts={hideAmounts} hideZero={hideZero}
            amountsByCode={amountsByCode} templateAmountsById={templateAmountsById}
            groupAmountsByCode={groupAmountsByCode} leavesByGroup={leavesByGroup} cfViewMode={cfViewMode}
movedIds={movedIds} onDrop={onDrop} onRename={onRename} onDelete={onDelete} onCopy={onCopy}
            onColorChange={onColorChange} originalRowCodes={originalRowCodes} originalSectionCodes={originalSectionCodes} onAddChild={onAddChild} sectionByCode={sectionByCode}
            highlightedIds={highlightedIds} onToggleHighlight={onToggleHighlight}
            multiMode={multiMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect}
            clientTree={clientTree} templateTree={templateTree}
          />
        ))}
      </>
    );
  }

const cursorClass = editing ? "cursor-text" : "cursor-grab active:cursor-grabbing";
  const bgClass = isSum ? (side === "client" ? "bg-[#e0f7fa]/40" : "bg-gray-50/60") : "";

  return (
    <>
      {dropZone === "before" && dropLine}
      <div className="flex items-stretch gap-2">
        <div draggable={!editing} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragLeave={() => setDropZone(null)} onDrop={handleDrop} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} onClick={canExpand && !editing ? e => { if (e.detail === 1) onToggle(key); } : undefined}
className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-2.5 rounded-lg transition-all ${cursorClass} ${dropZone === "inside" ? "" : "hover:bg-gray-50"} ${bgClass} ${isMoved && dropZone !== "inside" ? "bg-emerald-50/30" : ""}`} style={dropZone === "inside" ? { background: `${accent}1f`, boxShadow: `inset 0 0 0 2px ${accent}, 0 0 0 4px ${accent}20, 0 6px 20px -6px ${accent}80`, transform: "scale(1.01)" } : undefined}>
          {multiMode && node.kind !== "breaker" && (
            <span onClick={e => { e.stopPropagation(); onToggleSelect?.(node.id ?? node.code, e.shiftKey); }}
              className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-all"
              style={{ borderColor: selectedIds?.has(node.id ?? node.code) ? accent : "#d1d5db", backgroundColor: selectedIds?.has(node.id ?? node.code) ? accent : "white" }}>
              {selectedIds?.has(node.id ?? node.code) && <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
          )}
          {canExpand
            ? <span onClick={e => { e.stopPropagation(); onToggle(key); }} className={`flex-shrink-0 cursor-pointer ${side === "client" ? "text-[#0891b2]/40 hover:text-[#0891b2]" : "text-gray-400 hover:text-gray-600"}`}>{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
            : <span className="w-3 flex-shrink-0" />}
          <span className={`text-[10px] font-mono flex-shrink-0 w-20 truncate ${isSum ? (side === "client" ? "font-bold text-[#0891b2]" : "font-bold text-gray-700") : "text-gray-400"}`}>{node.code}</span>
{editing
            ? <input ref={editInputRef} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} onBlur={commitEdit} className="text-xs flex-1 min-w-0 px-2 py-0.5 rounded border border-[#0891b2]/30 outline-none focus:border-[#0891b2] bg-white" />
            : <span className={`text-xs flex-1 min-w-0 truncate ${isSum ? (side === "client" ? "font-bold text-[#0891b2]" : "font-bold text-gray-800") : "text-gray-600"}`}>{node.name || ""}</span>}
          {node.kind !== "breaker" && (() => {
            const amt = side === "client" ? amountsByCode.get(node.code) : templateAmountsById.get(node.id ?? node.code);
            return <AnimatedAmount value={amt} hidden={hideAmounts} />;
          })()}
{!editing && hovering && (() => {
            const isOriginalRowNode = side === "template" && node.kind !== "breaker" && originalRowCodes.has(String(node.code));
            return (
            <div className="flex items-center gap-0.5 flex-shrink-0">
{onAddChild && isSum && <button onClick={e => { e.stopPropagation(); onAddChild?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} title={t("cfm_add_child_row")} className="w-6 h-6 rounded flex items-center justify-center hover:bg-emerald-50 text-gray-400 hover:text-emerald-600"><Plus size={14} /></button>}
              {!isOriginalRowNode && <button onClick={startEdit} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-[#0891b2]/10 text-gray-400 hover:text-[#0891b2]"><Pencil size={13} /></button>}
              {mappingKind === "report" && <button onClick={e => { e.stopPropagation(); onCopy?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} title={t("cfm_duplicate_to_template")} className="w-6 h-6 rounded flex items-center justify-center hover:bg-indigo-50 text-gray-400 hover:text-indigo-600"><Copy size={12} /></button>}
              {side !== "client" && (
                <>
                  <button onClick={e => { e.stopPropagation(); onToggleHighlight?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: highlightedIds?.has(node.id ?? node.code) ? "#f59e0b" : undefined }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={highlightedIds?.has(node.id ?? node.code) ? "#f59e0b" : "none"} stroke={highlightedIds?.has(node.id ?? node.code) ? "#f59e0b" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </button>
                  {!isOriginalRowNode && <button onClick={e => { e.stopPropagation(); onDelete?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>}
                </>
              )}
{side === "client" && mappingKind === "report" && (
                <button onClick={e => { e.stopPropagation(); onDelete?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
              )}
            </div>
            );
          })()}
          {editing && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onMouseDown={e => { e.preventDefault(); commitEdit(); }} className="w-5 h-5 rounded flex items-center justify-center hover:bg-emerald-50 text-emerald-500"><Check size={10} /></button>
              <button onMouseDown={e => { e.preventDefault(); cancelEdit(); }} className="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100 text-gray-400"><X size={10} /></button>
            </div>
          )}
          {!editing && !hovering && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {isMoved && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 size={11} className="text-emerald-600" strokeWidth={2.5} />
                 <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600">{t("cfm_mapped_badge")}</span>
                </span>
              )}
              {side !== "client" && highlightedIds?.has(node.id ?? node.code) && <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
            </div>
          )}
        </div>
      </div>
      {dropZone === "after" && dropLine}
{/* Group account drill (level 1) - for client side only */}
      {isOpen && side === "client" && (node.groupAccounts?.length ?? 0) > 0 && (
        node.groupAccounts
          .filter(ga => !hideZero || Math.abs(groupAmountsByCode.get(ga.code) ?? 0) >= 0.5)
          .map(ga => <GroupAccountDrillRow key={`${node.code}-${ga.code}`} ga={ga} depth={depth + 1} hideAmounts={hideAmounts} hideZero={hideZero} cfViewMode={cfViewMode} groupAmountsByCode={groupAmountsByCode} leavesByGroup={leavesByGroup} />)
      )}

{/* CF children */}
      {isOpen && hasChildren && node.children.map(child => (
        <DraggableTreeRow key={child.id ?? child.code} node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          side={side} mappingKind={mappingKind} hideAmounts={hideAmounts} hideZero={hideZero}
          amountsByCode={amountsByCode} templateAmountsById={templateAmountsById}
          groupAmountsByCode={groupAmountsByCode} leavesByGroup={leavesByGroup} cfViewMode={cfViewMode}
          movedIds={movedIds} onDrop={onDrop} onRename={onRename} onDelete={onDelete} onCopy={onCopy}
          onAddChild={onAddChild} sectionByCode={sectionByCode}
          highlightedIds={highlightedIds} onToggleHighlight={onToggleHighlight}
          multiMode={multiMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect}
          clientTree={clientTree} templateTree={templateTree}
        />
      ))}
    </>
  );
}

// ─── GroupAccountDrillRow (under a CF account) ───────────────
function GroupAccountDrillRow({ ga, depth, hideAmounts, cfViewMode, groupAmountsByCode, leavesByGroup }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const amt = groupAmountsByCode.get(ga.code);
  const leaves = leavesByGroup.get(ga.code) ?? [];
  return (
    <>
      <div className="flex items-center gap-2 py-1.5 rounded-lg hover:bg-amber-50/40" style={{ paddingLeft: `${depth * 14 + 14}px`, paddingRight: 8 }}>
        <span className="flex-shrink-0 cursor-pointer text-amber-500/60 hover:text-amber-600" onClick={() => leaves.length > 0 && setOpen(o => !o)}>
          {leaves.length > 0 ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="block w-2.5" />}
        </span>
       <span className="text-[9px] font-black uppercase tracking-widest text-amber-500 flex-shrink-0">{t("cfm_drill_group")}</span>
        <span className="text-[10px] font-mono text-gray-500 flex-shrink-0 w-16 truncate">{ga.code}</span>
        <span className="text-[11px] text-gray-600 leading-relaxed flex-1 truncate">{ga.name}</span>
        <AnimatedAmount value={amt} hidden={hideAmounts} />
      </div>
      {open && leaves.map((leaf, i) => (
        <div key={i} className="flex items-center gap-2 py-1 rounded-lg hover:bg-gray-50" style={{ paddingLeft: `${(depth + 1) * 14 + 14}px`, paddingRight: 8 }}>
          <span className="block w-2.5 flex-shrink-0" />
         <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 flex-shrink-0">{cfViewMode === "individual" ? t("cfm_drill_local") : t("cfm_drill_entity")}</span>
          <span className="text-[10px] font-mono text-gray-400 flex-shrink-0 w-16 truncate">{leaf.code}</span>
         <span className="text-[10px] text-gray-500 leading-relaxed flex-1 truncate">{leaf.kind === "company" ? leaf.name : `${leaf.name}${leaf.company ? ` · ${leaf.company}` : ""}`}</span>
          <AnimatedAmount value={leaf.amt} hidden={hideAmounts} />
        </div>
      ))}
    </>
  );
}

// ─── AddRowForm ──────────────────────────────────────────────
function AddRowForm({ accent, onAdd, existingTree, pendingParentId, onClearParent, tree }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(""), [name, setName] = useState(""), [isSum, setIsSum] = useState(false), [error, setError] = useState(null);
  const codeInputRef = useRef(null);
  useEffect(() => { if (pendingParentId) setOpen(true); }, [pendingParentId]);
  useEffect(() => { if (open && codeInputRef.current) codeInputRef.current.focus(); }, [open]);
  const parentName = useMemo(() => { if (!pendingParentId || !tree) return null; function find(nodes) { for (const n of nodes) { if (n.id === pendingParentId || n.code === pendingParentId) return n; const f = find(n.children || []); if (f) return f; } return null; } const p = find(tree); return p ? `${p.code} · ${p.name}` : null; }, [pendingParentId, tree]);
  const reset = () => { setCode(""); setName(""); setIsSum(false); setError(null); };
  const fullReset = () => { reset(); onClearParent?.(); };
  const handleSubmit = () => {
    const tc = code.trim(), tn = name.trim();
if (!tc) { setError(t("cfm_err_code_required")); return; }
    if (!tn) { setError(t("cfm_err_name_required")); return; }
    const exists = (function check(nodes) { for (const n of nodes) { if (String(n.code) === tc) return true; if (check(n.children || [])) return true; } return false; })(existingTree);
    if (exists) { setError(`${t("cfm_err_code_exists_pre")} "${tc}" ${t("cfm_err_code_exists_post")}`); return; }
    onAdd({ code: tc, name: tn, isSum }); fullReset(); setOpen(false);
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="group flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl border border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 text-gray-400 hover:text-gray-500 text-xs font-semibold transition-all w-full justify-center">
      <Plus size={11} /><span>{t("cfm_add_row")}</span>
    </button>
  );
  return (
    <div className="mb-3 rounded-xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${accent}30` }}>
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: `${accent}08` }}>
        <div className="flex items-center gap-2">
         <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accent }}>{pendingParentId ? t("cfm_child_row") : t("cfm_new_row")}</span>
          {parentName && <span className="flex items-center gap-1 text-[10px] text-gray-400"><span>↳</span><span className="font-mono font-semibold text-gray-600 truncate max-w-[120px]">{parentName}</span><button onClick={onClearParent} className="text-gray-300 hover:text-gray-500 ml-0.5"><X size={9} /></button></span>}
        </div>
        <button onClick={() => { fullReset(); setOpen(false); }} className="w-5 h-5 rounded-lg flex items-center justify-center hover:bg-black/5 text-gray-400 hover:text-gray-600"><X size={11} /></button>
      </div>
      <div className="p-3 space-y-2.5 bg-white">
        <div className="flex items-center gap-2">
<input ref={codeInputRef} type="text" value={code} onChange={e => { setCode(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { fullReset(); setOpen(false); } }} placeholder={t("cfm_code")} className="w-24 px-3 py-2 rounded-lg text-[11px] font-mono bg-gray-50 border border-gray-200 outline-none transition-all" onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
          <input type="text" value={name} onChange={e => { setName(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { fullReset(); setOpen(false); } }} placeholder={t("cfm_account_name")} className="flex-1 min-w-0 px-3 py-2 rounded-lg text-xs bg-gray-50 border border-gray-200 outline-none transition-all" onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <div onClick={() => setIsSum(s => !s)} className="w-4 h-4 rounded-md flex items-center justify-center transition-all flex-shrink-0 shadow-sm" style={{ border: `2px solid ${isSum ? accent : '#e5e7eb'}`, backgroundColor: isSum ? accent : 'white' }}>{isSum && <Check size={9} className="text-white" strokeWidth={3} />}</div>
<span className="text-[11px] text-gray-500 font-medium group-hover:text-gray-700">{t("cfm_sum_total_row")}</span>
          </label>
          <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider text-white transition-all hover:opacity-90 active:scale-95 shadow-sm" style={{ backgroundColor: accent }}>{t("cfm_add_btn")}</button>
        </div>
        {error && <p className="text-[10px] text-red-400 font-medium flex items-center gap-1"><span>⚠</span>{error}</p>}
      </div>
    </div>
  );
}

// ─── AddBreakerForm ──────────────────────────────────────────
function AddBreakerForm({ accent, open, onOpen, onClose, onAdd }) {
  const t = useT();
  const [name, setName] = useState(""), [color, setColor] = useState("#0891b2"), [error, setError] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  const PRESET_COLORS = ["#0891b2","#CF305D","#374151","#57aa78","#dc7533","#7c3aed","#1a2f8a","#ca8a04"];
  const reset = () => { setName(""); setColor("#0891b2"); setError(null); };
  const handleSubmit = () => { const tx = name.trim(); if (!tx) { setError(t("cfm_err_name_required")); return; } onAdd({ name: tx.toUpperCase(), color }); reset(); onClose(); };
  if (!open) return (
    <button onClick={onOpen} className="group flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl border border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 text-gray-400 hover:text-gray-500 text-xs font-semibold transition-all w-full justify-center">
      <Plus size={11} /><span>{t("cfm_add_breaker")}</span>
    </button>
  );
  return (
    <div className="mb-3 rounded-xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${accent}30` }}>
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: `${accent}08` }}>
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accent }}>{t("cfm_new_breaker")}</span>
        <button onClick={() => { reset(); onClose(); }} className="w-5 h-5 rounded-lg flex items-center justify-center hover:bg-black/5 text-gray-400 hover:text-gray-600"><X size={11} /></button>
      </div>
      <div className="p-3 space-y-2.5 bg-white">
<input ref={inputRef} type="text" value={name} onChange={e => { setName(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { reset(); onClose(); } }} placeholder={t("cfm_breaker_placeholder")} className="w-full px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest bg-gray-50 border border-gray-200 outline-none" onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-medium flex-shrink-0">{t("cfm_color")}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {PRESET_COLORS.map(c => <button key={c} onClick={() => setColor(c)} className="w-5 h-5 rounded-md transition-all hover:scale-110" style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : 'none', transform: color === c ? 'scale(1.15)' : 'scale(1)' }} />)}
          </div>
        </div>
        <div className="flex items-center gap-2">
<div className="flex-1 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-white truncate" style={{ backgroundColor: color }}>{name.trim() || t("cfm_preview")}</div>
          <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider text-white transition-all hover:opacity-90 active:scale-95" style={{ backgroundColor: accent }}>{t("cfm_add_btn")}</button>
        </div>
        {error && <p className="text-[10px] text-red-400 font-medium flex items-center gap-1"><span>⚠</span>{error}</p>}
      </div>
    </div>
  );
}

// ─── SaveMappingForm ─────────────────────────────────────────
function SaveMappingForm({ name, setName, description, setDescription, error, onSave, onCancel, saving, asNew, accent }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
      <div className="relative w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()} style={{ borderRadius: 20, background: "white", boxShadow: "0 32px 80px -12px rgba(0,0,0,0.35)" }}>
        <div className="relative px-6 pt-6 pb-5 overflow-hidden" style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)` }}>
<p className="text-white font-black text-lg leading-tight">{asNew ? t("cfm_save_form_save_new") : t("cfm_save_form_save")}</p>
          <p className="text-white/60 text-[11px] mt-0.5">{t("cfm_save_form_subtitle")}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">{t("cfm_save_form_name_label")}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("cfm_save_form_name_placeholder")} autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-gray-800 outline-none transition-all"
              style={{ background: "#f8f9ff", border: "1.5px solid #eef1fb" }}
              onFocus={e => { e.target.style.borderColor = accent; e.target.style.background = "white"; e.target.style.boxShadow = `0 0 0 3px ${accent}15`; }}
              onBlur={e => { e.target.style.borderColor = "#eef1fb"; e.target.style.background = "#f8f9ff"; e.target.style.boxShadow = "none"; }}
              onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }} />
          </div>
          <div className="space-y-1.5">
<label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">{t("cfm_save_form_desc_label")} <span className="text-gray-300 font-normal normal-case tracking-normal">· {t("cfm_save_form_optional")}</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("cfm_save_form_desc_placeholder")} rows={3} className="w-full px-3.5 py-2.5 rounded-xl text-sm text-gray-800 outline-none transition-all resize-none" style={{ background: "#f8f9ff", border: "1.5px solid #eef1fb" }} onFocus={e => { e.target.style.borderColor = accent; e.target.style.background = "white"; e.target.style.boxShadow = `0 0 0 3px ${accent}15`; }} onBlur={e => { e.target.style.borderColor = "#eef1fb"; e.target.style.background = "#f8f9ff"; e.target.style.boxShadow = "none"; }} />
          </div>
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              <p className="text-xs text-red-500 font-medium leading-relaxed">{error}</p>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
<button onClick={onCancel} disabled={saving} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">{t("cfm_cancel_btn")}</button>
            <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-40 hover:opacity-90 active:scale-[0.98]" style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}dd 100%)`, boxShadow: `0 4px 14px -4px ${accent}60` }}>{saving ? t("cfm_saving") : t("cfm_save_btn")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel / PanelToolbar / EmptyPanelState ──────────────────
function Panel({ title, subtitle, accent, onExpandAll, onCollapseAll, isExpanded, extra, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 flex flex-col overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-shrink-0" style={{ backgroundColor: `${accent}06` }}>
        <div className="w-[3px] h-9 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 min-w-0">
          <p className="font-black text-[13px] leading-tight" style={{ color: accent }}>{title}</p>
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-[0.12em] mt-0.5">{subtitle}</p>
        </div>
        {extra && <div className="flex-shrink-0 flex items-center">{extra}</div>}
        <button onClick={isExpanded ? onCollapseAll : onExpandAll} className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0" style={{ background: `${accent}10`, color: accent }}>
          {isExpanded
            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden p-3">{children}</div>
    </div>
  );
}
function PanelToolbar({ search, setSearch, placeholder, count, total }) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-shrink-0">
      <div className="flex-1 flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
        <Search size={12} className="text-gray-400 flex-shrink-0" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder} className="text-xs outline-none text-gray-700 w-full bg-transparent placeholder:text-gray-300" />
        {search && <button onClick={() => setSearch("")}><X size={11} className="text-gray-400 hover:text-gray-600" /></button>}
      </div>
      {search && count !== total && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">{count}/{total}</span>}
    </div>
  );
}
function EmptyPanelState(props) {
  const IconCmp = props.icon;
  return <div className="text-center py-16"><IconCmp size={24} className="text-gray-200 mx-auto mb-2" /><p className="text-xs text-gray-400 font-medium">{props.message}</p></div>;
}