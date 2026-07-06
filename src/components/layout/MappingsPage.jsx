import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import {
  X, Plus, Search, Layers, FilePlus, Library, ChevronLeft,
  ChevronDown, ChevronRight, Clock, FileText, Sparkles, ArrowRightLeft,
  CheckCircle2, Pencil, Trash2, Check, Copy,
} from "lucide-react";
import { useSettings } from "./SettingsContext.jsx";
import PageHeader from "./PageHeader.jsx";
import { GitMerge, LayoutTemplate } from "lucide-react";
import { useT } from "./SettingsContext.jsx";
import {
  listMappings, createMapping, updateMapping, archiveMapping, getActiveCompanyId,
} from "../../lib/mappingsApi";
import {
  listMappings as listReportMappings,
  createMapping as createReportMapping,
  updateMapping as updateReportMapping,
  archiveMapping as archiveReportMapping,
} from "../../lib/reportMappingsApi";
import CashFlowMappingsView from "../views/CashFlowMappingsView.jsx";
import { supabase } from "../../lib/supabaseClient";
import { useCurrentUserResourceAccess } from "../../lib/userPermissionsApi";

// ─── Constants ───────────────────────────────────────────────
const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = {
  apikey: SUPABASE_APIKEY,
  Authorization: `Bearer ${SUPABASE_APIKEY}`,
};

const STANDARD_META = {
  PGC:         { accent: "#1a2f8a", accentBg: "#eef1fb" },
  SpanishIFRS: { accent: "#dc7533", accentBg: "#fef3c7" },
  DanishIFRS:  { accent: "#57aa78", accentBg: "#dcfce7" },
  Scratch:     { accent: "#1a2f8a", accentBg: "#eef1fb" },
};

const stdLabel = (t, std) => {
  if (std === "PGC")         return "PGC";
  if (std === "SpanishIFRS") return t("am_std_spanish_ifrs_label");
  if (std === "DanishIFRS")  return "Danish IFRS";
  if (std === "Scratch")     return t("am_std_scratch_label");
  return std;
};
const stdFull = (t, std) => {
  if (std === "PGC")         return t("am_std_pgc_full");
  if (std === "SpanishIFRS") return t("am_std_spanish_ifrs_full");
  if (std === "DanishIFRS")  return t("am_std_danish_ifrs_full");
  if (std === "Scratch")     return t("am_std_scratch_full");
  return std;
};
const stdDesc = (t, std) => {
  if (std === "PGC")         return t("am_std_pgc_desc");
  if (std === "SpanishIFRS") return t("am_std_spanish_ifrs_desc");
  if (std === "DanishIFRS")  return t("am_std_danish_ifrs_desc");
  if (std === "Scratch")     return t("am_std_scratch_desc");
  return "";
};

// ─── Icon toggle button sizing (panel header toggles) ─────────
const TOGGLE_HEIGHT = 28;
const TOGGLE_ICON_SIZE = 14;
const TOGGLE_LABEL_FONT_SIZE = 11;
const TOGGLE_PADDING_X = 10;

// ─── Helpers ─────────────────────────────────────────────────
function normalizeKey(str) { return String(str).replace(/[_\s-]/g, "").toLowerCase(); }
function getField(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  const map = new Map();
  Object.keys(obj).forEach(k => map.set(normalizeKey(k), obj[k]));
  for (const name of names) {
    if (obj[name] !== undefined) return obj[name];
    const v = map.get(normalizeKey(name));
    if (v !== undefined) return v;
  }
  return undefined;
}
// eslint-disable-next-line react-refresh/only-export-components
export function detectStandard(groupAccounts = []) {
  if (!groupAccounts.length) return null;
  const codes = groupAccounts.map(n => String(n.accountCode ?? n.AccountCode ?? ""));
  if (codes.some(c => /[a-zA-Z]/.test(c) && c.endsWith(".S"))) return "PGC";
  if (codes.some(c => /\.PL$/.test(c))) return "SpanishIFRS";
  if (codes.some(c => /^\d{5,6}$/.test(c))) return "DanishIFRS";
  return null;
}
function buildClientTree(groupAccounts) {
  if (!groupAccounts?.length) return [];
  const byCode = new Map();
  groupAccounts.forEach(ga => { const c = String(getField(ga, "accountCode") ?? ""); if (c) byCode.set(c, ga); });
  const childrenOf = new Map(), roots = [];
groupAccounts.forEach(ga => {
    const accCode = String(getField(ga, "accountCode") ?? "");
    const parent = String(getField(ga, "sumAccountCode") ?? "");
    if (!accCode) return;
    if (!byCode.has(parent) || parent === accCode) roots.push(ga);
    else { if (!childrenOf.has(parent)) childrenOf.set(parent, []); childrenOf.get(parent).push(ga); }
  });
  const numSort = (a, b) => String(getField(a, "accountCode") ?? "").localeCompare(String(getField(b, "accountCode") ?? ""), undefined, { numeric: true });
  childrenOf.forEach(arr => arr.sort(numSort)); roots.sort(numSort);
function makeNode(ga) {
    const nodeCode = String(getField(ga, "accountCode") ?? "");
    return { code: nodeCode, name: String(getField(ga, "accountName") ?? ""), accountType: String(getField(ga, "accountType") ?? ""), isSumAccount: !!getField(ga, "isSumAccount"), level: Number(getField(ga, "level") ?? 0), children: (childrenOf.get(nodeCode) || []).map(makeNode) };
  }
  return roots.map(makeNode);
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
      return { kind: "row", code, name: r.account_name, isSum: !!r.is_sum_account, showInSummary: !!r.show_in_summary, sectionCode: r.section_code, level: Number(r.level ?? 0), sortOrder: Number(r.sort_order ?? 0), children: (childrenOf.get(normalize(code)) || []).map(makeNode) };
    }
    return localRoots.map(makeNode);
  }
  if (!sections.length) return buildHierarchy(rows);
  const sortedSections = [...sections].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const rowsBySection = new Map(), rowsNoSection = [];
  rows.forEach(r => { if (r.section_code) { if (!rowsBySection.has(r.section_code)) rowsBySection.set(r.section_code, []); rowsBySection.get(r.section_code).push(r); } else rowsNoSection.push(r); });
  const result = [];
  sortedSections.forEach(s => result.push({ kind: "breaker", code: `__breaker__${s.section_code}`, sectionCode: s.section_code, name: s.label, color: s.color, children: buildHierarchy(rowsBySection.get(s.section_code) || []) }));
  if (rowsNoSection.length > 0) result.push(...buildHierarchy(rowsNoSection));
  return result;
}
function normalizeName(s) { return String(s ?? "").trim().toLowerCase(); }
function collectNames(node) { const out = new Set(); function walk(n) { out.add(normalizeName(n.name)); (n.children || []).forEach(walk); } walk(node); return out; }
function collectNamesFromTree(tree) { const out = new Set(); function walk(nodes) { nodes.forEach(n => { out.add(normalizeName(n.name)); walk(n.children || []); }); } walk(tree); return out; }
function findDuplicates(incomingNode, destinationTree) { const incoming = collectNames(incomingNode), existing = collectNamesFromTree(destinationTree), dups = []; incoming.forEach(name => { if (existing.has(name)) dups.push(name); }); return dups; }
let __dropCounter = 0;
function cloneSubtree(node, sourceSide) { __dropCounter++; return { id: `imp-${sourceSide}-${node.code}-${Date.now()}-${__dropCounter}`, code: node.code, name: node.name, sourceSide, sectionCode: node.sectionCode ?? null, isSum: node.isSum ?? node.isSumAccount ?? false, isSumAccount: node.isSumAccount ?? node.isSum ?? false, accountType: node.accountType ?? null, showInSummary: node.showInSummary ?? false, dims: node.dims ?? null, children: (node.children || []).map(c => cloneSubtree(c, sourceSide)) }; }
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
function stripSubtreeForTransfer(node) { return { code: node.code, name: node.name, isSum: node.isSum ?? node.isSumAccount ?? false, isSumAccount: node.isSumAccount ?? node.isSum ?? false, accountType: node.accountType ?? null, sectionCode: node.sectionCode ?? null, showInSummary: node.showInSummary ?? false, dims: node.dims ?? null, children: (node.children || []).map(stripSubtreeForTransfer) }; }
function collectAllCodes(tree, prefix) {const out = []; function walk(nodes) { nodes.forEach(n => { if ((n.children?.length ?? 0) > 0) { out.push(`${prefix}-${n.code}`); walk(n.children); } }); } walk(tree); return out; }
function countNodes(tree) { let n = 0; function walk(nodes) { nodes.forEach(node => { n++; walk(node.children || []); }); } walk(tree); return n; }
function filterTree(tree, predicate) { function walk(nodes) { return nodes.map(n => { const kids = walk(n.children || []); return (predicate(n) || kids.length > 0) ? { ...n, children: kids } : null; }).filter(Boolean); } return walk(tree); }
function filterTreeTpl(tree, q) { function walk(nodes) { return nodes.map(n => { const kids = walk(n.children || []); const matches = n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q); return (matches || kids.length > 0) ? { ...n, children: kids } : null; }).filter(Boolean); } return walk(tree); }

// ─── Main export ─────────────────────────────────────────────
export default function MappingsPage({ token, preloadedData, onNavigate, onPendingEditConsumed, activeStandardKey = null }) {
  console.log("[MappingsPage] activeStandardKey =", activeStandardKey);
  const { colors } = useSettings();
  const t = useT();
const groupAccounts = preloadedData.groupAccounts ?? [];
  const preloadedDimensions = preloadedData.dimensions ?? [];

  // Read any "open this mapping in mapper" request stashed by another page (e.g. accounts dashboard banner).
  // Done as a one-shot lazy initializer so we don't trigger a cascading render via useEffect.
  const initialOpenForEdit = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("mappings:openForEdit");
      if (!raw) return null;
      sessionStorage.removeItem("mappings:openForEdit");
      const parsed = JSON.parse(raw);
      if (parsed?.mapping_id && (parsed.kind === "structure" || parsed.kind === "report")) return parsed;
    } catch { /* ignore */ }
    return null;
  }, []);

  const [category, setCategory] = useState(initialOpenForEdit ? "account" : null); // null | "account" | "cashflow"
  const [selected, setSelected] = useState(initialOpenForEdit?.kind ?? null);      // null | "structure" | "report"
  const [search, setSearch] = useState("");
  const [pendingEdit, setPendingEdit] = useState(initialOpenForEdit);

  // ── Structure view ──────────────────────────────────────────
if (category === "account" && selected === "structure") {
return (
<StructureMappingsView
        groupAccounts={groupAccounts}
        dimensions={preloadedDimensions}
        search={search}
        setSearch={setSearch}
        colors={colors}
        token={token}
        onBack={() => { setSelected(null); setSearch(""); }}
        mappingKind="structure"
        activeStandardKey={activeStandardKey}
        pendingEdit={pendingEdit}
        onPendingEditConsumed={() => setPendingEdit(null)}
      />
    );
  }

// ── Report view ─────────────────────────────────────────────
  if (category === "account" && selected === "report") {
    return (
<StructureMappingsView
        groupAccounts={groupAccounts}
        dimensions={preloadedDimensions}
        search={search}
        setSearch={setSearch}
        colors={colors}
        token={token}
        onBack={() => { setSelected(null); setSearch(""); }}
        mappingKind="report"
        activeStandardKey={activeStandardKey}
        pendingEdit={pendingEdit}
        onPendingEditConsumed={() => setPendingEdit(null)}
      />
    );
  }

// ── Cash flow Structure view ────────────────────────────────
  if (category === "cashflow" && selected === "structure") {
    return (
<CashFlowMappingsView
        groupAccounts={groupAccounts}
        dimensions={preloadedDimensions}
        search={search}
        setSearch={setSearch}
        colors={colors}
        token={token}
        onBack={() => { setSelected(null); setSearch(""); }}
        mappingKind="structure"
        activeStandardKey={activeStandardKey}
        pendingEdit={pendingEdit}
        onPendingEditConsumed={() => setPendingEdit(null)}
      />
    );
  }

  // ── Cash flow Report view ───────────────────────────────────
  if (category === "cashflow" && selected === "report") {
    return (
      <CashFlowMappingsView
        groupAccounts={groupAccounts}
        dimensions={preloadedDimensions}
        search={search}
        setSearch={setSearch}
        colors={colors}
        token={token}
        onBack={() => { setSelected(null); setSearch(""); }}
        mappingKind="report"
        pendingEdit={pendingEdit}
        onPendingEditConsumed={() => setPendingEdit(null)}
      />
    );
  }

  // ── Cash flow category (Structure / Report selection) ───────
  if (category === "cashflow") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <PageHeader kicker={t("am_kicker_views_mappings")} title={t("am_title_cashflow_mappings")} tabs={[]} activeTab={null} onTabChange={() => {}} filters={[]} onBack={() => setCategory(null)} />
        <style>{`
          @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
          @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
          @keyframes floatOrb3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(25px,15px) scale(1.05); } }
        `}</style>
        <div className="flex-1 flex px-0 pt-3 pb-0 min-h-0">
          <div className="w-full h-full">
            <div className="grid grid-cols-2 gap-5 h-full">
              {/* Structure card */}
              <button onClick={() => setSelected("structure")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#0891b2] flex flex-col h-full"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #f0fbfd 40%, #e0f7fa 100%)", boxShadow: "0 8px 32px -8px rgba(8,145,178,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #0891b218 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
                  <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #06b6d420 0%, transparent 70%)", animation: "floatOrb2 11s ease-in-out 2s infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#0891b20d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
                </div>
                <div className="relative z-10 flex flex-col h-full p-10">
                  <div className="mb-auto">
                    <div className="mb-8 relative w-20 h-20">
                      <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#0891b2", filter: "blur(12px)", transform: "translateY(4px)" }} />
                      <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #0891b2 0%, #06b6d4 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                          <path d="M18 4v28M24 8H12.5a4.5 4.5 0 0 0 0 9h8a4.5 4.5 0 0 1 0 9H9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
                        </svg>
                      </div>
                    </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_card_structure_title")}</p>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_card_structure_desc_cashflow")}</p>
                  </div>
                  <div className="mt-10 flex items-center justify-between">
                    <div className="flex gap-2">{["PGC", "Spanish IFRS-ES", "Danish IFRS"].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#0891b215", color: "#0891b2" }}>{tag}</span>)}</div>
                    <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{ color: "#0891b2" }}>{t("am_cta_open")}</span>
                  </div>
                </div>
              </button>

              {/* Report card */}
              <button onClick={() => setSelected("report")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#CF305D] flex flex-col h-full"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)", boxShadow: "0 8px 32px -8px rgba(207,48,93,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #CF305D18 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
                  <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #e0558520 0%, transparent 70%)", animation: "floatOrb1 12s ease-in-out 1s infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#CF305D0d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
                </div>
                <div className="relative z-10 flex flex-col h-full p-10">
                  <div className="mb-auto">
                    <div className="mb-8 relative w-20 h-20">
                      <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#CF305D", filter: "blur(12px)", transform: "translateY(4px)" }} />
                      <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #CF305D 0%, #e05585 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                          <rect x="4" y="5" width="28" height="5" rx="2" fill="white" opacity="0.9"/><rect x="4" y="13" width="28" height="3.5" rx="1.5" fill="white" opacity="0.6"/><rect x="4" y="19.5" width="20" height="3.5" rx="1.5" fill="white" opacity="0.5"/><rect x="4" y="26" width="14" height="3.5" rx="1.5" fill="white" opacity="0.4"/>
                        </svg>
                      </div>
                    </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_card_report_title")}</p>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_card_report_desc_cashflow")}</p>
                  </div>
                  <div className="mt-10 flex items-center justify-between">
                    <div className="flex gap-2">{[t("am_tag_operating"), t("am_tag_investing"), t("am_tag_financing")].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#CF305D15", color: "#CF305D" }}>{tag}</span>)}</div>
                    <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{ color: "#CF305D" }}>{t("am_cta_open")}</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Account-mapping category (Structure / Report selection) ─
  if (category === "account") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <PageHeader kicker={t("am_kicker_views_mappings")} title={t("am_title_account_mappings")} tabs={[]} activeTab={null} onTabChange={() => {}} filters={[]} onBack={() => setCategory(null)} />
        <style>{`
          @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
          @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
          @keyframes floatOrb3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(25px,15px) scale(1.05); } }
          @keyframes spinSlow  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes spinSlowR { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
          @keyframes dashMove  { from { stroke-dashoffset: 200; } to { stroke-dashoffset: 0; } }
          @keyframes pulseDot  { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.4); } }
        `}</style>
        <div className="flex-1 flex px-0 pt-3 pb-0 min-h-0">
          <div className="w-full h-full">
            <div className="grid grid-cols-2 gap-5 h-full">
              {/* Structure card */}
              <button onClick={() => setSelected("structure")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col h-full"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a18 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
                  <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #3b54b820 0%, transparent 70%)", animation: "floatOrb2 11s ease-in-out 2s infinite" }} />
                  <div className="absolute" style={{ top: "50%", left: "60%", width: 80, height: 80, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a12 0%, transparent 70%)", animation: "floatOrb3 9s ease-in-out 1s infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#1a2f8a0d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
                </div>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "linear-gradient(135deg, #eef1fb 0%, #ffffff 50%, #dde3f8 100%)" }} />
                <div className="relative z-10 flex flex-col h-full p-10">
                  <div className="mb-auto">
                    <div className="mb-8 relative w-20 h-20">
                      <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#1a2f8a", filter: "blur(12px)", transform: "translateY(4px)" }} />
                      <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                          <rect x="4" y="8" width="10" height="10" rx="2" fill="white" opacity="0.9"/><rect x="4" y="22" width="10" height="6" rx="1.5" fill="white" opacity="0.5"/><rect x="17" y="8" width="15" height="4" rx="1.5" fill="white" opacity="0.7"/><rect x="17" y="15" width="10" height="4" rx="1.5" fill="white" opacity="0.5"/><rect x="17" y="22" width="12" height="4" rx="1.5" fill="white" opacity="0.4"/>
                        </svg>
                      </div>
                    </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_card_structure_title")}</p>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_card_structure_desc_account")}</p>
                  </div>
                  <div className="mt-10 flex items-center justify-between">
                    <div className="flex gap-2">{["PGC", "Spanish IFRS", "Danish IFRS"].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#1a2f8a15", color: "#1a2f8a" }}>{tag}</span>)}</div>
                    <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{ color: "#1a2f8a" }}>{t("am_cta_open")}</span>
                  </div>
                </div>
              </button>

              {/* Report card */}
              <button onClick={() => setSelected("report")}
                className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#CF305D] flex flex-col h-full"
                style={{ background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)", boxShadow: "0 8px 32px -8px rgba(207,48,93,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #CF305D18 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
                  <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #e0558520 0%, transparent 70%)", animation: "floatOrb1 12s ease-in-out 1s infinite" }} />
                  <div className="absolute" style={{ top: "50%", left: "60%", width: 80, height: 80, borderRadius: "50%", background: "radial-gradient(circle, #CF305D10 0%, transparent 70%)", animation: "floatOrb3 10s ease-in-out 3s infinite" }} />
                  <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#CF305D0d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
                </div>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "linear-gradient(135deg, #fef1f5 0%, #ffffff 50%, #fde0ea 100%)" }} />
                <div className="relative z-10 flex flex-col h-full p-10">
                  <div className="mb-auto">
                    <div className="mb-8 relative w-20 h-20">
                      <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#CF305D", filter: "blur(12px)", transform: "translateY(4px)" }} />
                      <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #CF305D 0%, #e05585 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                          <rect x="4" y="5" width="28" height="5" rx="2" fill="white" opacity="0.9"/><rect x="4" y="13" width="28" height="3.5" rx="1.5" fill="white" opacity="0.6"/><rect x="4" y="19.5" width="20" height="3.5" rx="1.5" fill="white" opacity="0.5"/><rect x="4" y="26" width="14" height="3.5" rx="1.5" fill="white" opacity="0.4"/>
                        </svg>
                      </div>
                    </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_card_report_title")}</p>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_card_report_desc_account")}</p>
                  </div>
                  <div className="mt-10 flex items-center justify-between">
                    <div className="flex gap-2">{["PGC", "Spanish IFRS", "Danish IFRS"].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#CF305D15", color: "#CF305D" }}>{tag}</span>)}</div>
                    <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{ color: "#CF305D" }}>{t("am_cta_open")}</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Top landing (Account / Cash Flow) ───────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader kicker={t("am_kicker_views")} title={t("am_title_mappings")} tabs={[]} activeTab={null} onTabChange={() => {}} filters={[]} />
      <style>{`
        @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
        @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
        @keyframes floatOrb3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(25px,15px) scale(1.05); } }
        @keyframes spinSlow  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinSlowR { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes dashMove  { from { stroke-dashoffset: 200; } to { stroke-dashoffset: 0; } }
        @keyframes pulseDot  { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.4); } }
      `}</style>
<div className="flex-1 flex px-0 pt-3 pb-0 min-h-0">
        <div className="w-full h-full">
          <div className="grid grid-cols-2 gap-5 h-full">
            {/* Account mapping card */}
            <button onClick={() => setCategory("account")}
              className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col h-full"
              style={{ background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a18 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
                <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #3b54b820 0%, transparent 70%)", animation: "floatOrb2 11s ease-in-out 2s infinite" }} />
                <div className="absolute" style={{ top: "50%", left: "60%", width: 80, height: 80, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a12 0%, transparent 70%)", animation: "floatOrb3 9s ease-in-out 1s infinite" }} />
                <svg className="absolute" style={{ top: "8%", right: "8%", width: 200, height: 200, opacity: 0.07 }}>
                  <circle cx="100" cy="100" r="80" fill="none" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlow 30s linear infinite", transformOrigin: "100px 100px" }} />
                  <circle cx="100" cy="100" r="55" fill="none" stroke="#1a2f8a" strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlowR 20s linear infinite", transformOrigin: "100px 100px" }} />
                </svg>
                <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#1a2f8a0d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
                <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.08 }}>
                  <line x1="70%" y1="20%" x2="85%" y2="50%" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 4s linear infinite" }} />
                  <line x1="75%" y1="70%" x2="90%" y2="40%" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 5s linear infinite 1s" }} />
                  <circle cx="70%" cy="20%" r="3" fill="#1a2f8a" style={{ animation: "pulseDot 3s ease-in-out infinite" }} />
                  <circle cx="85%" cy="50%" r="3" fill="#1a2f8a" style={{ animation: "pulseDot 3s ease-in-out 1s infinite" }} />
                  <circle cx="90%" cy="40%" r="3" fill="#1a2f8a" style={{ animation: "pulseDot 3s ease-in-out 0.5s infinite" }} />
                </svg>
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "linear-gradient(135deg, #eef1fb 0%, #ffffff 50%, #dde3f8 100%)" }} />
              <div className="relative z-10 flex flex-col h-full p-10">
                <div className="mb-auto">
                  <div className="mb-8 relative w-20 h-20">
                    <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#1a2f8a", filter: "blur(12px)", transform: "translateY(4px)" }} />
                    <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                        <rect x="4" y="8" width="10" height="10" rx="2" fill="white" opacity="0.9"/><rect x="4" y="22" width="10" height="6" rx="1.5" fill="white" opacity="0.5"/><rect x="17" y="8" width="15" height="4" rx="1.5" fill="white" opacity="0.7"/><rect x="17" y="15" width="10" height="4" rx="1.5" fill="white" opacity="0.5"/><rect x="17" y="22" width="12" height="4" rx="1.5" fill="white" opacity="0.4"/><circle cx="27" cy="27" r="5" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5"/><path d="M27 24v3l2 1.5" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </div>
                  </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_title_account_mappings")}</p>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_card_account_desc")}</p>
                </div>
                <div className="mt-10 flex items-center justify-between">
                  <div className="flex gap-2">{[t("am_tag_structure"), t("am_tag_report")].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#1a2f8a15", color: "#1a2f8a" }}>{tag}</span>)}</div>
                  <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{ color: "#1a2f8a" }}>{t("am_cta_open")}</span>
                </div>
              </div>
            </button>

            {/* Cash flow card */}
            <button onClick={() => setCategory("cashflow")}
              className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#0891b2] flex flex-col h-full"
              style={{ background: "linear-gradient(135deg, #ffffff 0%, #f0fbfd 40%, #e0f7fa 100%)", boxShadow: "0 8px 32px -8px rgba(8,145,178,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #CF305D18 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
                <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #e0558520 0%, transparent 70%)", animation: "floatOrb1 12s ease-in-out 1s infinite" }} />
                <div className="absolute" style={{ top: "50%", left: "60%", width: 80, height: 80, borderRadius: "50%", background: "radial-gradient(circle, #CF305D10 0%, transparent 70%)", animation: "floatOrb3 10s ease-in-out 3s infinite" }} />
                <svg className="absolute" style={{ top: "8%", right: "8%", width: 200, height: 200, opacity: 0.07 }}>
                  <circle cx="100" cy="100" r="80" fill="none" stroke="#CF305D" strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlowR 25s linear infinite", transformOrigin: "100px 100px" }} />
                  <circle cx="100" cy="100" r="55" fill="none" stroke="#CF305D" strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlow 18s linear infinite", transformOrigin: "100px 100px" }} />
                </svg>
                <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#CF305D0d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
                <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.08 }}>
                  <line x1="65%" y1="25%" x2="82%" y2="55%" stroke="#CF305D" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 5s linear infinite" }} />
                  <line x1="78%" y1="65%" x2="88%" y2="35%" stroke="#CF305D" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 4s linear infinite 2s" }} />
                  <circle cx="65%" cy="25%" r="3" fill="#CF305D" style={{ animation: "pulseDot 3.5s ease-in-out infinite" }} />
                  <circle cx="82%" cy="55%" r="3" fill="#CF305D" style={{ animation: "pulseDot 3.5s ease-in-out 1.2s infinite" }} />
                  <circle cx="88%" cy="35%" r="3" fill="#CF305D" style={{ animation: "pulseDot 3.5s ease-in-out 0.6s infinite" }} />
                </svg>
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "linear-gradient(135deg, #fef1f5 0%, #ffffff 50%, #fde0ea 100%)" }} />
              <div className="relative z-10 flex flex-col h-full p-10">
                <div className="mb-auto">
                  <div className="mb-8 relative w-20 h-20">
                    <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#CF305D", filter: "blur(12px)", transform: "translateY(4px)" }} />
                    <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #CF305D 0%, #e05585 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                        <rect x="4" y="5" width="28" height="5" rx="2" fill="white" opacity="0.9"/><rect x="4" y="13" width="28" height="3.5" rx="1.5" fill="white" opacity="0.6"/><rect x="4" y="19.5" width="20" height="3.5" rx="1.5" fill="white" opacity="0.5"/><rect x="4" y="26" width="14" height="3.5" rx="1.5" fill="white" opacity="0.4"/><circle cx="29" cy="27" r="5" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5"/><path d="M27 25.5l2 1.5 3-3" stroke="rgba(255,255,255,0.9)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_title_cashflow_mappings")}</p>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_card_cashflow_desc")}</p>
                </div>
                <div className="mt-10 flex items-center justify-between">
<div className="flex gap-2">{[t("am_tag_operating"), t("am_tag_investing"), t("am_tag_financing")].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#0891b215", color: "#0891b2" }}>{tag}</span>)}</div>
                  <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{ color: "#0891b2" }}>{t("am_cta_open")}</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Structure Mappings View ──────────────────────────────────
function StructureMappingsView({ groupAccounts, dimensions = [], search, setSearch, colors, onBack, token, mappingKind = "structure", initialView = "list", initialStandard = null, pendingEdit = null, onPendingEditConsumed, activeStandardKey = null }) {
const t = useT();
  const api = useMemo(() => (
    mappingKind === "report"
      ? { list: listReportMappings, create: createReportMapping, update: updateReportMapping, archive: archiveReportMapping }
      : { list: listMappings, create: createMapping, update: updateMapping, archive: archiveMapping }
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
  const [mapperDirty, setMapperDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState(null);
  const resourceAccess = useCurrentUserResourceAccess();
const [mapperStatement, setMapperStatement] = useState("PL");
  const [mapperPeriod, setMapperPeriod] = useState("ytd");
  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterSource, setFilterSource] = useState("");
  const [filterStructure, setFilterStructure] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [sourcesList, setSourcesList] = useState([]);
  const [structuresList, setStructuresList] = useState([]);
const [companiesList, setCompaniesList] = useState([]);
  const effectiveSources = useMemo(() => {
    if (!resourceAccess?.source) return sourcesList;
    return sourcesList.filter(s => resourceAccess.source.has(s.source ?? s.Source ?? s));
  }, [sourcesList, resourceAccess]);
  const effectiveStructures = useMemo(() => {
    if (!resourceAccess?.structure) return structuresList;
    return structuresList.filter(s => resourceAccess.structure.has(s.groupStructure ?? s.GroupStructure ?? s));
  }, [structuresList, resourceAccess]);
  const effectiveCompanies = useMemo(() => {
    if (!resourceAccess?.company) return companiesList;
    return companiesList.filter(c => resourceAccess.company.has(c.companyShortName ?? c.CompanyShortName ?? c));
  }, [companiesList, resourceAccess]);
  const [favorites, setFavorites] = useState(new Set());
  const [filterStandard, setFilterStandard] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterFavorite, setFilterFavorite] = useState(false);
const [sortBy, setSortBy] = useState("desc");
  const mapperSaveRef = useRef(null);
  const mapperResetRef = useRef(null);
  

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
    api.list({ companyId }).then(rows => setMappings(rows)).finally(() => setMappingsLoading(false));
  }, [view, companyId, api]);

  // Auto-open the requested mapping once the list has loaded
  useEffect(() => {
    if (!pendingEdit || !mappings.length) return;
    const m = mappings.find(x => String(x.mapping_id) === String(pendingEdit.mapping_id));
    if (!m) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setEditingMapping(m);
    setSelectedStandard(m.standard);
    setView("mapper");
    /* eslint-enable react-hooks/set-state-in-effect */
    onPendingEditConsumed?.();
  }, [pendingEdit, mappings, onPendingEditConsumed]);

useEffect(() => {
    if (!authUserId) return;
    (async () => {
      const { data } = await supabase.from("user_settings").select("preferences").eq("user_id", authUserId).single();
      if (data?.preferences?.standard_mapping_id) setStandardMappingId(data.preferences.standard_mapping_id);
      const favKey = mappingKind === "report" ? "favorite_report_mappings" : "favorite_mappings";
      if (Array.isArray(data?.preferences?.[favKey])) setFavorites(new Set(data.preferences[favKey]));
    })();
  }, [authUserId, mappingKind]);

const handleSetStandard = async (id) => {
    if (!authUserId) return;
    const newId = standardMappingId === id ? null : id; // toggle off if already set
    const { data } = await supabase.from("user_settings").select("preferences").eq("user_id", authUserId).single();
    const prefs = data?.preferences ?? {};
    await supabase.from("user_settings").upsert({
      user_id: authUserId,
      preferences: { ...prefs, standard_mapping_id: newId },
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
    const favKey = mappingKind === "report" ? "favorite_report_mappings" : "favorite_mappings";
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

const detectedStandard = useMemo(() => detectStandard(groupAccounts), [groupAccounts]);

const [uploadedAccounts, setUploadedAccounts] = useState([]);
  const [previousUploadedAccounts, setPreviousUploadedAccounts] = useState([]);

  // Load sources/structures/companies once
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    (async () => {
      try {
        const [srcRes, strRes, coRes] = await Promise.all([
          fetch(`/v2/sources`, { headers: h }).then(r => r.json()),
          fetch(`/v2/structures`, { headers: h }).then(r => r.json()),
          fetch(`/v2/companies`, { headers: h }).then(r => r.json()),
        ]);
        setSourcesList(srcRes.value ?? srcRes ?? []);
        setStructuresList(strRes.value ?? strRes ?? []);
        setCompaniesList(coRes.value ?? coRes ?? []);
      } catch { /* ignore */ }
    })();
  }, [token]);

  // Initial probe: when filters are empty and we have lists, find latest period and seed filters
  useEffect(() => {
    if (!token || !groupAccounts.length) return;
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
          const res = await fetch(`/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`, { headers: h });
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            if (rows.length > 0) {
              setFilterYear(y); setFilterMonth(m);
              setFilterSource(source); setFilterStructure(structure); setFilterCompany(company);
              return;
            }
          }
        } catch { /* keep probing */ }
        m--; if (m < 1) { m = 12; y--; }
      }
    })();
  }, [token, groupAccounts.length, effectiveSources, effectiveStructures, effectiveCompanies, filterYear, filterMonth, filterSource, filterStructure, filterCompany]);

// Refetch uploadedAccounts whenever filters change
  useEffect(() => {
    if (!token) return;
    if (!filterYear || !filterMonth || !filterSource || !filterStructure || !filterCompany) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const filter = `Year eq ${filterYear} and Month eq ${filterMonth} and Source eq '${filterSource}' and GroupStructure eq '${filterStructure}' and CompanyShortName eq '${filterCompany}'`;
    (async () => {
      try {
        const res = await fetch(`/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
        if (!res.ok) { setUploadedAccounts([]); return; }
        const json = await res.json();
const rows = json.value ?? (Array.isArray(json) ? json : []);
        setUploadedAccounts(rows);
      } catch { setUploadedAccounts([]); }
    })();
  }, [token, filterYear, filterMonth, filterSource, filterStructure, filterCompany]);

  // Previous-month YTD (used to derive monthly amount = YTD_curr - YTD_prev)
  useEffect(() => {
    if (!token) return;
    if (!filterYear || !filterMonth || !filterSource || !filterStructure || !filterCompany) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (filterMonth === 1) { setPreviousUploadedAccounts([]); return; } // January: monthly == YTD
    const prevY = filterYear;
    const prevM = filterMonth - 1;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const filter = `Year eq ${prevY} and Month eq ${prevM} and Source eq '${filterSource}' and GroupStructure eq '${filterStructure}' and CompanyShortName eq '${filterCompany}'`;
    (async () => {
      try {
        const res = await fetch(`/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
        if (!res.ok) { setPreviousUploadedAccounts([]); return; }
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        setPreviousUploadedAccounts(rows);
      } catch { setPreviousUploadedAccounts([]); }
    })();
  }, [token, filterYear, filterMonth, filterSource, filterStructure, filterCompany]);

const handleMapperBack = () => {
    if (mapperDirty) { setShowBackConfirm(true); return; }
    setEditingMapping(null); setSelectedStandard(null); setView("list");
  };

useEffect(() => {
    window.__navGuard = (go) => {
      if (view !== "mapper" || !mapperDirty) { go(); return; }
      setPendingNav(() => go);
      setShowBackConfirm(true);
    };
    return () => { window.__navGuard = null; };
  }, [view, mapperDirty]);

  useEffect(() => {
    if (!mapperDirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [mapperDirty]);

const kindLabel = mappingKind === "report" ? t("am_list_title_report") : t("am_list_title_structure");
const isCustomSelected = selectedStandard && selectedStandard.startsWith("CUSTOM-");
const activeAccent = isCustomSelected
  ? (colors?.primary ?? "#7c3aed")
  : ((selectedStandard && STANDARD_META[selectedStandard]?.accent) || colors?.primary || "#1a2f8a");
  const headerConfig = {
    list: { title: kindLabel, back: onBack },
    create: { title: t("am_create_title"), back: () => setView("list") },
    selectStandard: { title: t("am_select_standard_title"), back: () => setView("create") },
mapper: { title: selectedStandard ? `${t("am_mapper_title_prefix")} · ${stdLabel(t, selectedStandard)}` : t("am_mapper_title_default"), back: initialView === "mapper" ? null : handleMapperBack },
  };
  const cfg = headerConfig[view] ?? headerConfig.list;

  return (
    <div className="flex flex-col h-full min-h-0">
<PageHeader
        kicker={t("am_kicker_views_mappings")}
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
          { label: t("filter_company"), value: filterCompany, onChange: setFilterCompany,
            options: effectiveCompanies.map(c => { const v = c.companyShortName ?? c.CompanyShortName ?? c; const label = c.companyLegalName ?? c.CompanyLegalName ?? v; return { value: v, label }; }) },
        ] : view === "list" ? [
{ label: t("am_filter_standard"), value: filterStandard, onChange: setFilterStandard, options: [
            { value: "", label: t("am_filter_all_standards"), displayLabel: t("am_filter_standard") },
            { value: "PGC", label: "PGC", displayLabel: "PGC" },
            { value: "SpanishIFRS", label: t("am_std_spanish_ifrs_label"), displayLabel: t("am_std_spanish_ifrs_label") },
            { value: "DanishIFRS", label: "Danish IFRS", displayLabel: "Danish IFRS" },
            { value: "Scratch", label: t("am_filter_custom"), displayLabel: t("am_filter_custom") },
          ]},
          { label: t("am_filter_user"), value: filterUser, onChange: setFilterUser, options: [
            { value: "", label: t("am_filter_all_users"), displayLabel: t("am_filter_user") },
            ...uniqueUsers.map(u => ({ value: u, label: u, displayLabel: u })),
          ]},
{ label: t("am_filter_sort"), value: sortBy, onChange: setSortBy, options: [
            { value: "desc", label: t("am_filter_most_recent"), displayLabel: t("am_filter_most_recent_short") },
            { value: "asc", label: t("am_filter_oldest"), displayLabel: t("am_filter_oldest_short") },
          ]},
{ label: t("am_filter_favorites"), value: filterFavorite ? "yes" : "", onChange: v => setFilterFavorite(v === "yes"), options: [
            { value: "", label: t("am_filter_all"), displayLabel: t("am_filter_favorites") },
            { value: "yes", label: t("am_filter_favorites_only"), displayLabel: t("am_filter_favorites_only_short") },
          ]},
        ] : []}
onBack={cfg.back}
        periodToggle={view === "mapper" && mapperStatement === "PL" ? { value: mapperPeriod, onChange: setMapperPeriod } : undefined}
headerSearch={view === "list" ? { value: search, onChange: setSearch, placeholder: t("am_search_placeholder") } : undefined}
      headerActions={view === "list" ? [{ icon: Plus, label: t("am_create_mapping_btn"), onClick: () => { setEditingMapping(null); setView("create"); } }] : undefined}
        headerExtra={view === "mapper" && selectedStandard ? (
          <div className="flex items-center gap-2">
<div className="relative flex items-center gap-0.5 p-1 bg-gray-50 border border-gray-100 rounded-xl"
              ref={el => {
                if (!el) return;
                const active = el.querySelector('[data-active="true"]');
                let pill = el.querySelector('.mapper-pill');
                if (!pill) {
                  pill = document.createElement('span');
                  pill.className = 'mapper-pill';
                  pill.style.cssText = `position:absolute;top:4px;bottom:4px;border-radius:8px;transition:left 280ms cubic-bezier(0.34,1.56,0.64,1),width 280ms cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;z-index:0;background:${activeAccent};box-shadow:0 2px 8px -2px rgba(26,47,138,0.35)`;
                  el.appendChild(pill);
                }
                if (active) {
                  pill.style.left = active.offsetLeft + 'px';
                  pill.style.width = active.offsetWidth + 'px';
                }
              }}>
              {[["PL", t("am_mapper_pl")],["BS", t("am_mapper_bs")]].map(([key, label]) => (
                <button key={key} data-active={mapperStatement === key} onClick={() => setMapperStatement(key)}
                  className="relative z-10 px-4 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
                  style={{ color: mapperStatement === key ? "white" : "#9ca3af" }}>
                  {label}
                </button>
              ))}
            </div>
<button onClick={() => mapperResetRef.current?.()}
              title={t("am_mapper_reset_tooltip")}
              className="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:scale-105"
              style={{ background: "rgba(26,47,138,0.06)", color: activeAccent, border: "1px solid rgba(26,47,138,0.1)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
<button onClick={() => mapperSaveRef.current?.()}
              title={editingMapping ? t("am_mapper_save_tooltip") : t("am_mapper_save_mapping_tooltip")}
              className="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:scale-105"
              style={{ background: activeAccent, color: "white", boxShadow: `0 4px 12px -4px ${activeAccent}60` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
            {initialView === "mapper" && onBack && (
              <button onClick={onBack} title={t("am_mapper_close_tooltip")}
                className="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:scale-105 ml-1"
                style={{ background: "rgba(0,0,0,0.06)", color: "#6b7280", border: "1px solid rgba(0,0,0,0.08)" }}>
                ✕
              </button>
            )}
          </div>
        ) : undefined}
      />
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col mt-3 rounded-2xl bg-white shadow-xl border border-gray-100">
{view === "list" && (
          <ListView
            mappings={mappings}
            loading={mappingsLoading}
            search={search}
            standardMappingId={standardMappingId}
            onSetStandard={handleSetStandard}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            filterStandard={filterStandard}
            filterUser={filterUser}
            filterFavorite={filterFavorite}
            sortBy={sortBy}
            onCreate={() => { setEditingMapping(null); setView("create"); }}
            onOpen={m => { setEditingMapping(m); setSelectedStandard(m.standard); setView("mapper"); }}
            onArchive={async m => {
              if (!window.confirm(t("am_card_delete_confirm").replace("{name}", m.name))) return;
              await api.archive({ mappingId: m.mapping_id, userId: authUserId });
              const rows = await api.list({ companyId });
              setMappings(rows);
            }}
          />
        )}
{view === "create" && (
          <CreateView
            onScratch={() => { setSelectedStandard("Scratch"); setView("mapper"); }}
            onExisting={() => setView("selectStandard")}
            onCancel={() => setView("list")}
          />
        )}
{view === "selectStandard" && (
          <SelectStandardView
            detectedStandard={detectedStandard}
            activeStandardKey={activeStandardKey}
            onPick={std => { setSelectedStandard(std); setView("mapper"); }}
          />
        )}
{view === "mapper" && selectedStandard && (
<MapperView
            standard={selectedStandard}
            groupAccounts={groupAccounts}
            uploadedAccounts={uploadedAccounts}
            previousUploadedAccounts={previousUploadedAccounts}
            dimensions={dimensions}
            authUserId={authUserId}
            companyId={companyId}
editingMapping={editingMapping}
            existingMappings={mappings}
            onSaved={saved => { setEditingMapping(saved); if (!editingMapping) setPendingStandardMapping(saved); }}
            onBackToList={() => { setEditingMapping(null); setSelectedStandard(null); setView("list"); }}
statement={mapperStatement}
            setStatement={setMapperStatement}
            periodMode={mapperPeriod}
            saveRef={mapperSaveRef}
resetRef={mapperResetRef}
            onDirtyChange={setMapperDirty}
api={api}
            mappingKind={mappingKind}
          />
        )}
      </div>
{showBackConfirm && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => setShowBackConfirm(false)}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
        <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </div>
<p className="text-white font-black text-lg leading-tight">{t("am_discard_changes_title")}</p>
            <p className="text-white/70 text-[11px] mt-0.5">{t("am_discard_changes_subtitle")}</p>
          </div>
          <div className="p-5 space-y-2">
            <p className="text-xs text-gray-500 leading-relaxed pb-2">{t("am_discard_changes_desc")}</p>
            <div className="flex items-center gap-2">
<button onClick={() => { setShowBackConfirm(false); setPendingNav(null); }}
                className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
                {t("am_btn_stay")}
              </button>
              <button onClick={() => {
                  setShowBackConfirm(false);
                  setMapperDirty(false);
                  if (pendingNav) { const go = pendingNav; setPendingNav(null); go(); return; }
                  setEditingMapping(null); setSelectedStandard(null); setView("list");
                }}
                className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)", boxShadow: "0 4px 14px -4px rgba(245,158,11,0.5)" }}>
                {t("am_btn_discard_go_back")}
              </button>
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
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </div>
<p className="text-white font-black text-lg leading-tight">{t("am_set_standard_modal_title")}</p>
            <p className="text-white/70 text-xs mt-1 leading-relaxed">
              {t("am_set_standard_modal_subtitle").replace("{name}", pendingStandardMapping.name)}
            </p>
          </div>
          <div className="p-5 space-y-2">
            <button
              onClick={async () => { await handleSetStandard(pendingStandardMapping.mapping_id); setPendingStandardMapping(null); }}
              className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #57aa78 0%, #3d8c5c 100%)" }}>
              {t("am_btn_yes_set_standard")}
            </button>
            <button
              onClick={() => setPendingStandardMapping(null)}
              className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
              {t("am_btn_not_now")}
            </button>
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
    if (search.trim()) list = list.filter(m => String(m.name ?? m.mapping_name ?? "").toLowerCase().includes(search.toLowerCase()));
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
<div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">{filtered.length} {t("am_matching_count_of")} {mappings.length} {t("am_matching_count_matching")}</div>
        </div>
      )}
      {loading ? (
        <div className="text-center py-20 text-xs text-gray-400">{t("am_loading_mappings")}</div>
      ) : filtered.length === 0 ? (
        <EmptyLibrary onCreate={onCreate} hasSearch={!!search.trim()} />
) : (
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
    <div className="flex-1 bg-gradient-to-br from-[#f8f9ff] to-white rounded-2xl border border-gray-100 text-center flex flex-col items-center justify-center">
      <div className="w-16 h-16 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-5"><Library size={28} className="text-[#1a2f8a]" /></div>
      <p className="text-gray-700 font-black text-base mb-2">{hasSearch ? t("am_empty_search") : t("am_empty_no_mappings")}</p>
      <p className="text-gray-400 text-xs mb-6 max-w-sm mx-auto leading-relaxed">{hasSearch ? t("am_empty_search_desc") : t("am_empty_desc")}</p>
      {!hasSearch && <button onClick={onCreate} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1a2f8a] hover:bg-[#1a2f8a]/90 text-white text-xs font-black transition-all shadow-md shadow-[#1a2f8a]/20"><Plus size={14} />{t("am_create_first")}</button>}
    </div>
  );
}

function MappingCard({ mapping, isStandard, isFavorite, onSetStandard, onToggleFavorite, onOpen, onArchive }) {
  const t = useT();
  const standardMeta = STANDARD_META[mapping.standard];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#1a2f8a]/30 hover:shadow-lg transition-all group flex flex-col">
      <div className="cursor-pointer flex-1" onClick={() => onOpen?.(mapping)}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: standardMeta?.accentBg ?? "#eef1fb" }}>
            <FileText size={16} style={{ color: standardMeta?.accent ?? "#1a2f8a" }} />
          </div>
          <div className="flex-1 min-w-0">
<p className="font-black text-sm text-gray-800 truncate">{mapping.name ?? t("am_untitled")}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: standardMeta?.accent ?? "#1a2f8a" }}>{stdLabel(t, mapping.standard)}</p>
          </div>
          <button onClick={e => { e.stopPropagation(); onToggleFavorite?.(mapping.mapping_id); }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isFavorite ? "" : "opacity-0 group-hover:opacity-100"}`}
            style={{ color: isFavorite ? "#f59e0b" : "#9ca3af" }}
            title={isFavorite ? t("am_card_remove_favorites") : t("am_card_add_favorites")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={isFavorite ? "#f59e0b" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button onClick={e => { e.stopPropagation(); onArchive?.(mapping); }} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all" title={t("am_card_archive")}><Trash2 size={11} /></button>
        </div>
        {mapping.description && <p className="text-[11px] text-gray-500 mb-3 line-clamp-2">{mapping.description}</p>}
</div>

      {/* Standard mapping toggle */}
      <div className="flex items-center gap-3 py-2.5" onClick={e => e.stopPropagation()}>
        <span className="text-[10px] font-black uppercase tracking-wider flex-1"
          style={{ color: isStandard ? "#57aa78" : "#9ca3af" }}>
          {isStandard ? t("am_card_standard_active") : t("am_card_set_as_standard")}
        </span>
        <div onClick={() => onSetStandard?.(mapping.mapping_id)}
          className="relative cursor-pointer select-none flex-shrink-0"
          style={{ width: 34, height: 18, borderRadius: 9, background: isStandard ? "#57aa78" : "#d1d5db", transition: "background 220ms" }}>
          <div style={{ position: "absolute", top: 2, left: isStandard ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 220ms" }} />
        </div>
      </div>

      <div className="flex flex-col gap-1 pt-3 border-t border-gray-50 text-[11px] text-gray-500 min-w-0">
        <div className="flex items-center gap-2">
          <Clock size={11} className="text-gray-300 flex-shrink-0" />
          <span className="truncate">{t("am_card_updated")} {new Date(mapping.updated_at).toLocaleDateString()}{mapping.updated_by_name ? ` · ${mapping.updated_by_name}` : ""}</span>
        </div>
        {mapping.created_by_name && mapping.created_by_name !== mapping.updated_by_name && (
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="w-2.5 flex-shrink-0" />
            <span className="truncate">{t("am_card_created_by")} {mapping.created_by_name}</span>
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
      <style>{`
        @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
        @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
        @keyframes floatOrb3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(25px,15px) scale(1.05); } }
        @keyframes spinSlow  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinSlowR { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes dashMove  { from { stroke-dashoffset: 200; } to { stroke-dashoffset: 0; } }
        @keyframes pulseDot  { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.4); } }
      `}</style>
      <div className="grid grid-cols-2 gap-5 flex-1 h-full">

        {/* Create from scratch */}
        <button onClick={onScratch}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col h-full"
          style={{ background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a18 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
            <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #3b54b820 0%, transparent 70%)", animation: "floatOrb2 11s ease-in-out 2s infinite" }} />
            <div className="absolute" style={{ top: "50%", left: "60%", width: 80, height: 80, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a12 0%, transparent 70%)", animation: "floatOrb3 9s ease-in-out 1s infinite" }} />
            <svg className="absolute" style={{ top: "8%", right: "8%", width: 200, height: 200, opacity: 0.07 }}>
              <circle cx="100" cy="100" r="80" fill="none" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlow 30s linear infinite", transformOrigin: "100px 100px" }} />
              <circle cx="100" cy="100" r="55" fill="none" stroke="#1a2f8a" strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlowR 20s linear infinite", transformOrigin: "100px 100px" }} />
            </svg>
            <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#1a2f8a0d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
            <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.08 }}>
              <line x1="70%" y1="20%" x2="85%" y2="50%" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 4s linear infinite" }} />
              <line x1="75%" y1="70%" x2="90%" y2="40%" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 5s linear infinite 1s" }} />
              <circle cx="70%" cy="20%" r="3" fill="#1a2f8a" style={{ animation: "pulseDot 3s ease-in-out infinite" }} />
              <circle cx="85%" cy="50%" r="3" fill="#1a2f8a" style={{ animation: "pulseDot 3s ease-in-out 1s infinite" }} />
              <circle cx="90%" cy="40%" r="3" fill="#1a2f8a" style={{ animation: "pulseDot 3s ease-in-out 0.5s infinite" }} />
            </svg>
          </div>
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "linear-gradient(135deg, #eef1fb 0%, #ffffff 50%, #dde3f8 100%)" }} />
          <div className="relative z-10 flex flex-col h-full p-10">
            <div className="mb-auto">
              <div className="mb-8 relative w-20 h-20">
                <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#1a2f8a", filter: "blur(12px)", transform: "translateY(4px)" }} />
                <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                  <FilePlus size={32} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_create_scratch_title")}</p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_create_scratch_desc")}</p>
              <div className="mt-6 space-y-2">
                {[t("am_create_scratch_f1"), t("am_create_scratch_f2"), t("am_create_scratch_f3")].map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#1a2f8a" }} />
                    <span className="text-xs text-gray-500 font-medium">{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-10 flex items-center justify-end">
              <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#1a2f8a" }}>{t("am_cta_start")}</span>
            </div>
          </div>
        </button>

        {/* From existing structure */}
        <button onClick={onExisting}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#dc7533] flex flex-col h-full"
          style={{ background: "linear-gradient(135deg, #ffffff 0%, #fffaf4 40%, #fef3e2 100%)", boxShadow: "0 8px 32px -8px rgba(220,117,51,0.18), 0 2px 8px -2px rgba(0,0,0,0.06)" }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, #dc753318 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
            <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, #dc753320 0%, transparent 70%)", animation: "floatOrb1 12s ease-in-out 1s infinite" }} />
            <div className="absolute" style={{ top: "50%", left: "60%", width: 80, height: 80, borderRadius: "50%", background: "radial-gradient(circle, #dc753310 0%, transparent 70%)", animation: "floatOrb3 10s ease-in-out 3s infinite" }} />
            <svg className="absolute" style={{ top: "8%", right: "8%", width: 200, height: 200, opacity: 0.07 }}>
              <circle cx="100" cy="100" r="80" fill="none" stroke="#dc7533" strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlowR 25s linear infinite", transformOrigin: "100px 100px" }} />
              <circle cx="100" cy="100" r="55" fill="none" stroke="#dc7533" strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlow 18s linear infinite", transformOrigin: "100px 100px" }} />
            </svg>
            <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#dc75330d 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
            <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.08 }}>
              <line x1="65%" y1="25%" x2="82%" y2="55%" stroke="#dc7533" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 5s linear infinite" }} />
              <line x1="78%" y1="65%" x2="88%" y2="35%" stroke="#dc7533" strokeWidth="1" strokeDasharray="6 4" style={{ animation: "dashMove 4s linear infinite 2s" }} />
              <circle cx="65%" cy="25%" r="3" fill="#dc7533" style={{ animation: "pulseDot 3.5s ease-in-out infinite" }} />
              <circle cx="82%" cy="55%" r="3" fill="#dc7533" style={{ animation: "pulseDot 3.5s ease-in-out 1.2s infinite" }} />
              <circle cx="88%" cy="35%" r="3" fill="#dc7533" style={{ animation: "pulseDot 3.5s ease-in-out 0.6s infinite" }} />
            </svg>
          </div>
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "linear-gradient(135deg, #fef3e2 0%, #ffffff 50%, #fde8cc 100%)" }} />
          <div className="relative z-10 flex flex-col h-full p-10">
            <div className="mb-auto">
              <div className="mb-8 relative w-20 h-20">
                <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#dc7533", filter: "blur(12px)", transform: "translateY(4px)" }} />
                <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #dc7533 0%, #e8924d 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                  <Library size={32} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<p className="font-black text-2xl text-gray-800 mb-3">{t("am_create_existing_title")}</p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{t("am_create_existing_desc")}</p>
              <div className="mt-6 space-y-2">
                {[t("am_create_existing_f1"), t("am_create_existing_f2"), t("am_create_existing_f3")].map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#dc7533" }} />
                    <span className="text-xs text-gray-500 font-medium">{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-10 flex items-center justify-between">
              <div className="flex gap-2">{["PGC", "Spanish IFRS", "Danish IFRS"].map(tag => <span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: "#dc753315", color: "#dc7533" }}>{tag}</span>)}</div>
             <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#dc7533" }}>{t("am_cta_choose")}</span>
            </div>
          </div>
        </button>

      </div>
    </div>
  );
}

// ─── SelectStandardView ───────────────────────────────────────
function SelectStandardView({ detectedStandard, activeStandardKey, onPick }) {
  const t = useT();
  const { colors } = useSettings();
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${SUPABASE_URL}/template_catalog?select=*&active=eq.true`, { headers: sbHeaders })
      .then(r => r.json()).then(rows => { if (Array.isArray(rows)) setCatalog(rows); }).catch(() => setCatalog([])).finally(() => setLoading(false));
  }, []);
  const standardsAvailable = useMemo(() => { const set = new Set(catalog.map(c => c.standard)); return ["PGC","SpanishIFRS","DanishIFRS"].filter(s => set.has(s)); }, [catalog]);

  // If this tenant has a CUSTOM-* standard bound, show it as an extra card
  // (marked recommended, using their brand colour).
const hasCustom = activeStandardKey && activeStandardKey.startsWith("CUSTOM-");
  console.log("[SelectStandardView] activeStandardKey =", activeStandardKey, "hasCustom =", hasCustom);

  if (loading) return <div className="flex-1 flex items-center justify-center text-xs text-gray-400">{t("am_loading_templates")}</div>;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5">
      <div className={`grid ${hasCustom ? "grid-cols-4" : "grid-cols-3"} gap-5 flex-1 min-h-0`}>
        {hasCustom && (
          <StandardCard
            key={activeStandardKey}
            stdKey={activeStandardKey}
            meta={{
              accent:      colors?.primary ?? "#7c3aed",
              accentBg:    `${colors?.primary ?? "#7c3aed"}12`,
              customLabel: activeStandardKey.replace(/^CUSTOM-/, "").toUpperCase(),
              customFull:  t("am_std_custom_full", "Custom standard"),
              customDesc:  t("am_std_custom_desc", "The onboarding standard tailored specifically for your organization"),
            }}
            isRecommended={true}
            isCustom={true}
            onClick={() => onPick(activeStandardKey)}
          />
        )}
        {standardsAvailable.map(std => (
          <StandardCard
            key={std}
            stdKey={std}
            meta={STANDARD_META[std]}
            isRecommended={!hasCustom && detectedStandard === std}
            onClick={() => onPick(std)}
          />
        ))}
      </div>
    </div>
  );
}

function StandardCard({ stdKey, meta, isRecommended, isCustom = false, onClick }) {
  const t = useT();
  return (
    <button onClick={onClick}
      className="relative text-left rounded-2xl border-2 overflow-hidden transition-all group flex flex-col h-full"
      style={{ borderColor: isRecommended ? meta.accent : "#f3f4f6", background: `linear-gradient(135deg, #ffffff 0%, ${meta.accentBg} 100%)`, boxShadow: `0 8px 32px -8px ${meta.accent}30, 0 2px 8px -2px rgba(0,0,0,0.06)` }}>
      {isRecommended && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-white shadow-md z-10" style={{ backgroundColor: meta.accent }}>
          <Sparkles size={10} />{t("am_recommended")}
        </div>
      )}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute" style={{ top: "15%", right: "10%", width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle, ${meta.accent}18 0%, transparent 70%)`, animation: "floatOrb1 8s ease-in-out infinite" }} />
        <div className="absolute" style={{ bottom: "10%", right: "25%", width: 120, height: 120, borderRadius: "50%", background: `radial-gradient(circle, ${meta.accent}20 0%, transparent 70%)`, animation: "floatOrb2 11s ease-in-out 2s infinite" }} />
        <svg className="absolute" style={{ top: "8%", right: "8%", width: 200, height: 200, opacity: 0.07 }}>
          <circle cx="100" cy="100" r="80" fill="none" stroke={meta.accent} strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlow 30s linear infinite", transformOrigin: "100px 100px" }} />
          <circle cx="100" cy="100" r="55" fill="none" stroke={meta.accent} strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlowR 20s linear infinite", transformOrigin: "100px 100px" }} />
        </svg>
        <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(${meta.accent}0d 1px, transparent 1px)`, backgroundSize: "28px 28px" }} />
      </div>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `linear-gradient(135deg, ${meta.accentBg} 0%, #ffffff 50%, ${meta.accentBg} 100%)` }} />
      <div className="relative z-10 flex flex-col h-full p-10">
        <div className="mb-auto">
          <div className="mb-8 relative w-20 h-20">
            <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: meta.accent, filter: "blur(12px)", transform: "translateY(4px)" }} />
            <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: `linear-gradient(145deg, ${meta.accent} 0%, ${meta.accent}cc 100%)`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
              <Library size={32} className="text-white" strokeWidth={1.8} />
            </div>
          </div>
<p className="font-black text-2xl text-gray-800 mb-1">{isCustom ? meta.customLabel : stdLabel(t, stdKey)}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: meta.accent }}>{isCustom ? meta.customFull : stdFull(t, stdKey)}</p>
          <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{isCustom ? meta.customDesc : stdDesc(t, stdKey)}</p>
        </div>
        <div className="mt-10 flex items-center justify-between">
          <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{ background: `${meta.accent}15`, color: meta.accent }}>{t("am_pl_plus_bs")}</span>
          <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: meta.accent }}>{t("am_cta_select")}</span>
        </div>
      </div>
    </button>
  );
}

// ─── MapperView ───────────────────────────────────────────────
function MapperView({ standard, groupAccounts, uploadedAccounts = [], previousUploadedAccounts = [], dimensions = [], authUserId, companyId, editingMapping, existingMappings = [], onSaved, statement, periodMode = "ytd", saveRef, resetRef, onDirtyChange, api = { create: createMapping, update: updateMapping }, mappingKind = "structure" }) {
const t = useT();
  const { colors: mapperColors } = useSettings();
  // CUSTOM standards live outside STANDARD_META — synthesize a meta shell
  // so components that read meta.accent / meta.accentBg don't blow up.
  const meta = STANDARD_META[standard] ?? (
    standard?.startsWith("CUSTOM-")
      ? { accent: (mapperColors?.primary ?? "#7c3aed"), accentBg: `${mapperColors?.primary ?? "#7c3aed"}12` }
      : { accent: "#1a2f8a", accentBg: "#eef1fb" }
  );
  // Balance Sheet is a point-in-time snapshot — always YTD regardless of toggle
  const effectivePeriodMode = statement === "BS" ? "ytd" : periodMode;

  // ── Undo stack ──────────────────────────────────────────────
  const historyRef = useRef([]);
  const snapshotState = () => ({
    clientTreeBy: { ...clientTreeBy },
    templateTreeBy: { ...templateTreeBy },
    movedClientCodes: new Set(movedClientCodes),
    movedDimsByCode: new Map([...movedDimsByCode].map(([k, v]) => [k, new Set(v)])),
    movedTemplateIds: new Set(movedTemplateIds),
    highlightedIds: new Set(highlightedIds),
  });
  const pushHistory = () => { historyRef.current = [snapshotState(), ...historyRef.current].slice(0, 50); onDirtyChange?.(true); };
  const undo = () => {
    const last = historyRef.current[0];
    if (!last) return;
    setClientTreeBy(last.clientTreeBy);
    setTemplateTreeBy(last.templateTreeBy);
    setMovedClientCodes(last.movedClientCodes);
    setMovedDimsByCode(last.movedDimsByCode);
    setMovedTemplateIds(last.movedTemplateIds);
    setHighlightedIds(last.highlightedIds);
    historyRef.current = historyRef.current.slice(1);
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
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
  // Clear history when switching standard or loading a different mapping
  useEffect(() => { historyRef.current = []; }, [standard, editingMapping?.mapping_id]);

  const dimsByGroupCode = useMemo(() => {
    // Build code → name lookup from dimensions prop
    const dimNameLookup = new Map();
    dimensions.forEach(d => {
      const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "");
      const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "");
      if (code && name) dimNameLookup.set(code, name);
    });
    const map = new Map();
    uploadedAccounts.forEach(row => {
      const groupCode = String(row.AccountCode ?? row.accountCode ?? "");
      const dimsRaw = String(row.Dimensions ?? row.dimensions ?? "");
      if (!groupCode || !dimsRaw || dimsRaw === "—") return;
      const pairs = dimsRaw.split("||").map(s => s.trim()).filter(Boolean);
      if (!pairs.length) return;
if (!map.has(groupCode)) map.set(groupCode, new Set());
      pairs.forEach(p => {
        const idx = p.indexOf(":");
        const dimGroup = idx !== -1 ? p.slice(0, idx).trim() : "";
        const dimCode = idx !== -1 ? p.slice(idx + 1).trim() : p;
        const dimName = dimNameLookup.get(dimCode) ?? dimCode;
        map.get(groupCode).add(`${dimGroup}:${dimName}`);
      });
    });
return map;
  }, [uploadedAccounts, dimensions]);

const amountsByCode = useMemo(() => {
    const parentOf = new Map();
    groupAccounts.forEach(g => {
      const code = String(g.accountCode ?? g.AccountCode ?? "");
      const parent = String(g.sumAccountCode ?? g.SumAccountCode ?? "");
      if (code && parent && parent !== code) parentOf.set(code, parent);
    });
    // Also pick up parent links from the rows themselves (leaf codes may not be in groupAccounts)
    [...uploadedAccounts, ...previousUploadedAccounts].forEach(row => {
      const code = String(row.AccountCode ?? row.accountCode ?? "");
      const parent = String(row.SumAccountCode ?? row.sumAccountCode ?? row.ParentCode ?? row.parentCode ?? "");
      if (code && parent && parent !== code && !parentOf.has(code)) parentOf.set(code, parent);
    });
    // Sum YTD per leaf code (sign-flipped, matching the previous convention)
    const sumLeafYTD = (rows) => {
      const m = new Map();
      rows.forEach(row => {
        const code = String(row.AccountCode ?? row.accountCode ?? "");
        if (!code) return;
        const raw = row.AmountYTD ?? row.amountYTD ?? 0;
        const rawAmt = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, "")) || 0;
        m.set(code, (m.get(code) ?? 0) + (-rawAmt));
      });
      return m;
    };
const currLeaf = sumLeafYTD(uploadedAccounts);
    const prevLeaf = effectivePeriodMode === "monthly" ? sumLeafYTD(previousUploadedAccounts) : new Map();
    // Period leaf amounts: monthly = curr - prev (incl. codes only in prev); ytd = curr
    const leafAmounts = new Map();
    if (effectivePeriodMode === "monthly") {
      const allCodes = new Set([...currLeaf.keys(), ...prevLeaf.keys()]);
      allCodes.forEach(code => leafAmounts.set(code, (currLeaf.get(code) ?? 0) - (prevLeaf.get(code) ?? 0)));
    } else {
      currLeaf.forEach((v, k) => leafAmounts.set(k, v));
    }
    // Roll up to parents
    const map = new Map();
    leafAmounts.forEach((amt, code) => {
      let cur = code;
      const visited = new Set();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        map.set(cur, (map.get(cur) ?? 0) + amt);
        cur = parentOf.get(cur);
      }
    });
return map;
}, [uploadedAccounts, previousUploadedAccounts, groupAccounts, effectivePeriodMode]);

  const NO_DIM_KEY = "—:Sin dimensión";
  const amountsByCodeDim = useMemo(() => {
    const dimNameLookup = new Map();
    dimensions.forEach(d => {
      const c = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "");
      const nm = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "");
      if (c && nm) dimNameLookup.set(c, nm);
    });
    const sumByCodeDim = (rows) => {
      const m = new Map();
      rows.forEach(row => {
        const code = String(row.AccountCode ?? row.accountCode ?? "");
        const dimsRaw = String(row.Dimensions ?? row.dimensions ?? "");
        if (!code || !dimsRaw || dimsRaw === "—") return;
        const raw = row.AmountYTD ?? row.amountYTD ?? 0;
        const amt = -(typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, "")) || 0);
        dimsRaw.split("||").map(s => s.trim()).filter(Boolean).forEach(p => {
          const idx = p.indexOf(":");
          const g = idx !== -1 ? p.slice(0, idx).trim() : "";
          const dc = idx !== -1 ? p.slice(idx + 1).trim() : p;
          const nm = dimNameLookup.get(dc) ?? dc;
          const key = `${code}||${g}:${nm}`;
          m.set(key, (m.get(key) ?? 0) + amt);
        });
      });
      return m;
    };
    const curr = sumByCodeDim(uploadedAccounts);
    const base = effectivePeriodMode !== "monthly" ? curr : (() => {
      const prev = sumByCodeDim(previousUploadedAccounts);
      const all = new Set([...curr.keys(), ...prev.keys()]);
      const out = new Map();
      all.forEach(k => out.set(k, (curr.get(k) ?? 0) - (prev.get(k) ?? 0)));
      return out;
    })();
    // Compute residual per account: total leaf amount - sum of all dim-tagged amounts
    const dimSumByCode = new Map();
    base.forEach((v, k) => {
      const code = k.split("||")[0];
      dimSumByCode.set(code, (dimSumByCode.get(code) ?? 0) + v);
    });
    // Only add residual for accounts that actually have some dim-tagged amounts
    const leafByCode = new Map();
    const rowsForLeaf = effectivePeriodMode !== "monthly" ? uploadedAccounts : null;
    (rowsForLeaf ?? uploadedAccounts).forEach(row => {
      const code = String(row.AccountCode ?? row.accountCode ?? "");
      if (!code) return;
      const raw = row.AmountYTD ?? row.amountYTD ?? 0;
      const amt = -(typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, "")) || 0);
      leafByCode.set(code, (leafByCode.get(code) ?? 0) + amt);
    });
    if (effectivePeriodMode === "monthly") {
      const prevLeaf = new Map();
      previousUploadedAccounts.forEach(row => {
        const code = String(row.AccountCode ?? row.accountCode ?? "");
        if (!code) return;
        const raw = row.AmountYTD ?? row.amountYTD ?? 0;
        const amt = -(typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, "")) || 0);
        prevLeaf.set(code, (prevLeaf.get(code) ?? 0) + amt);
      });
      new Set([...leafByCode.keys(), ...prevLeaf.keys()]).forEach(code => {
        leafByCode.set(code, (leafByCode.get(code) ?? 0) - (prevLeaf.get(code) ?? 0));
      });
    }
    dimSumByCode.forEach((dSum, code) => {
      const total = leafByCode.get(code) ?? 0;
      const residual = total - dSum;
      if (Math.abs(residual) >= 0.5) base.set(`${code}||${NO_DIM_KEY}`, residual);
    });
    return base;
  }, [uploadedAccounts, previousUploadedAccounts, dimensions, effectivePeriodMode]);

  // Extend dimsByGroupCode to include the synthetic residual dim
  const dimsByGroupCodeWithResidual = useMemo(() => {
    const out = new Map();
    dimsByGroupCode.forEach((dims, code) => out.set(code, new Set(dims)));
    amountsByCodeDim.forEach((_v, k) => {
      const [code, dim] = k.split("||");
      if (dim === NO_DIM_KEY) {
        if (!out.has(code)) out.set(code, new Set());
        out.get(code).add(dim);
      }
    });
    return out;
  }, [dimsByGroupCode, amountsByCodeDim]);

  const [tplRows, setTplRows] = useState([]);
  const [tplSections, setTplSections] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplStatement, setTplStatement] = useState(null);
  const [clientTreeBy, setClientTreeBy] = useState({ PL: null, BS: null });
  const [templateTreeBy, setTemplateTreeBy] = useState({ PL: null, BS: null });
const [activeMultiSide, setActiveMultiSide] = useState(null);
const [movedClientCodes, setMovedClientCodes] = useState(() => new Set());
  const [movedDimsByCode, setMovedDimsByCode] = useState(() => new Map()); // Map<accountCode, Set<dimString>>
  const [highlightedIds, setHighlightedIds] = useState(() => new Set());
  const [movedTemplateIds, setMovedTemplateIds] = useState(() => new Set());
  const [conflict, setConflict] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
const [showSaveChoice, setShowSaveChoice] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [currentName, setCurrentName] = useState(editingMapping?.name ?? "");
  const [currentDescription, setCurrentDescription] = useState(editingMapping?.description ?? "");

useEffect(() => {
    const ac = new AbortController();
    if (templateTreeBy[statement]) return;
if (standard === "Scratch") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTplRows([]); setTplSections([]); setTplStatement(statement); setTplLoading(false);
      return;
    }
    setTplLoading(true); setTplRows([]); setTplSections([]); setTplStatement(null);

    // CUSTOM-* standards live in the unified standard_statement_* tables.
    // Built-in standards (PGC/SpanishIFRS/DanishIFRS) still come from the
    // legacy template_* tables. Column shapes match, so downstream is agnostic.
    const isCustom = standard.startsWith("CUSTOM-");
    const rowsUrl = isCustom
      ? `${SUPABASE_URL}/standard_statement_rows?select=*&standard_key=eq.${encodeURIComponent(standard)}&statement=eq.${statement}&order=sort_order.asc`
      : `${SUPABASE_URL}/template_rows?select=*&standard=eq.${standard}&statement=eq.${statement}&order=sort_order.asc`;
    const secsUrl = isCustom
      ? `${SUPABASE_URL}/standard_statement_sections?select=*&standard_key=eq.${encodeURIComponent(standard)}&statement=eq.${statement}&order=sort_order.asc`
      : `${SUPABASE_URL}/template_sections?select=*&standard=eq.${standard}&statement=eq.${statement}&order=sort_order.asc`;

    (async () => {
      try {
        const [rowsRes, secsRes] = await Promise.all([
          fetch(rowsUrl, { headers: sbHeaders, signal: ac.signal }),
          fetch(secsUrl, { headers: sbHeaders, signal: ac.signal }),
        ]);
        const rows = await rowsRes.json(), secs = await secsRes.json();
        if (ac.signal.aborted) return;
        const cleanRows = Array.isArray(rows) ? rows.filter(r => r.statement === statement) : [];
        const cleanSecs = Array.isArray(secs) ? secs.filter(s => s.statement === statement) : [];
        setTplRows(cleanRows); setTplSections(cleanSecs); setTplStatement(statement);
      } catch (e) { if (e.name !== "AbortError") { setTplRows([]); setTplSections([]); } }
      finally { if (!ac.signal.aborted) setTplLoading(false); }
    })();
return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standard, statement]);

  const baseClientTree = useMemo(() => {
    if (!groupAccounts.length) return [];
    const tree = buildClientTree(groupAccounts);
    const filterFn = statement === "PL" ? n => ["P/L","DIS"].includes(n.accountType) : n => n.accountType === "B/S";
    function addIds(nodes) { return nodes.map(n => ({ ...n, id: `cli-${n.code}`, children: addIds(n.children || []) })); }
return addIds(tree.filter(filterFn));
  }, [groupAccounts, statement]);

  const baseTemplateTree = useMemo(() => {
    if (tplStatement !== statement) return [];
    function addIds(nodes) { return nodes.map(n => ({ ...n, id: `tpl-${n.code}`, children: addIds(n.children || []) })); }
    return addIds(buildTemplateTree(tplRows, tplSections));
  }, [tplRows, tplSections, tplStatement, statement]);

useEffect(() => {
    setClientTreeBy({ PL: null, BS: null });
    setTemplateTreeBy({ PL: null, BS: null });
    setMovedClientCodes(new Set());
    setMovedTemplateIds(new Set());
  }, [standard]);
useEffect(() => {
  if (!editingMapping) return;
  const plTree = Array.isArray(editingMapping.pl_tree) ? editingMapping.pl_tree : [];
  const bsTree = Array.isArray(editingMapping.bs_tree) ? editingMapping.bs_tree : [];
setTemplateTreeBy({ PL: plTree, BS: bsTree });
  if (Array.isArray(editingMapping.highlighted_ids)) setHighlightedIds(new Set(editingMapping.highlighted_ids));
  // Walk both trees and reconstruct movedClientCodes + movedDimsByCode
  const movedCodes = new Set();
  const movedDims = new Map();
  const walk = (nodes) => {
    (nodes || []).forEach(n => {
      if (n.kind === "breaker") { walk(n.children); return; }
      const code = String(n.code ?? "");
      if (!code) { walk(n.children); return; }
      if (Array.isArray(n.dims) && n.dims.length > 0) {
        // Dim-specific mapping — track each dim
        const ex = movedDims.get(code) ?? new Set();
        n.dims.forEach(d => ex.add(d));
        movedDims.set(code, ex);
      } else {
        // Full account mapping
        movedCodes.add(code);
      }
      walk(n.children);
    });
  };
  walk(plTree);
  walk(bsTree);
  setMovedClientCodes(movedCodes);
  setMovedDimsByCode(movedDims);
}, [editingMapping]);
  useEffect(() => { if (baseClientTree.length > 0) setClientTreeBy(prev => prev[statement] ? prev : { ...prev, [statement]: baseClientTree }); }, [baseClientTree, statement]);
  useEffect(() => { if (baseTemplateTree.length > 0) setTemplateTreeBy(prev => prev[statement] ? prev : { ...prev, [statement]: baseTemplateTree }); }, [baseTemplateTree, statement]);
  const [prevEditingMappingId, setPrevEditingMappingId] = useState(editingMapping?.mapping_id);
  if (prevEditingMappingId !== editingMapping?.mapping_id) {
    setPrevEditingMappingId(editingMapping?.mapping_id);
    setCurrentName(editingMapping?.name ?? "");
    setCurrentDescription(editingMapping?.description ?? "");
  }

// When opening a fresh standard template (no saved mapping), pre-mark
  // client accounts that already exist in the template tree as "moved".
  // Uses baseTemplateTree directly (already loaded, same codes as right panel)
  // and accumulates with a functional update so switching PL↔BS doesn't
  // overwrite codes from the other statement.
  useEffect(() => {
    if (editingMapping || standard === "Scratch" || !baseTemplateTree.length || !groupAccounts.length) return;
    const templateCodes = new Set();
    const walkTemplate = nodes => {
      nodes.forEach(n => {
        if (n.kind !== "breaker" && n.code && !String(n.code).startsWith("__"))
          templateCodes.add(String(n.code));
        walkTemplate(n.children || []);
      });
    };
walkTemplate(baseTemplateTree);
    if (!templateCodes.size) return;
    setMovedClientCodes(prev => {
      const next = new Set(prev);
      groupAccounts.forEach(ga => {
        const code = String(ga.AccountCode ?? ga.accountCode ?? "");
        if (code && templateCodes.has(code)) next.add(code);
      });
      return next;
    });
  }, [editingMapping, standard, baseTemplateTree, groupAccounts]);

const clientTree = clientTreeBy[statement] ?? baseClientTree;
  const templateTree = templateTreeBy[statement] ?? baseTemplateTree;
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
let amt;
      if (Array.isArray(node.dims) && node.dims.length > 0) {
        let sum = 0, any = false;
        node.dims.forEach(d => { const v = amountsByCodeDim.get(`${node.code}||${d}`); if (v !== undefined) { sum += v; any = true; } });
        amt = any ? sum : undefined;
      } else {
        amt = amountsByCode.get(node.code);
      }
      out.set(id, amt);
      return amt;
    };
    templateTree.forEach(walk);
    return out;
  }, [templateTree, amountsByCode, amountsByCodeDim]);
  const sectionByCode = useMemo(() => { const m = new Map(); tplSections.forEach(s => m.set(s.section_code, { label: s.label, color: s.color })); return m; }, [tplSections]);

const handleSave = async ({ asNew = false } = {}) => {
if (!companyId || !authUserId) { setSaveError(t("am_err_not_auth")); return; }
    if (!currentName.trim()) { setSaveError(t("am_err_name_required")); setShowSaveForm(true); return; }
// Re-derive moved state from BOTH template trees (safeguard against stale state)
    const effectiveMoved = new Set();
    const dimsSeenByCode = new Map();
    const collectFromTemplate = (nodes) => {
      (nodes || []).forEach(n => {
        if (n.kind === "breaker") { collectFromTemplate(n.children); return; }
        const code = String(n.code ?? "");
        if (code) {
          if (Array.isArray(n.dims) && n.dims.length > 0) {
            const s = dimsSeenByCode.get(code) ?? new Set();
            n.dims.forEach(d => s.add(d));
            dimsSeenByCode.set(code, s);
          } else {
            effectiveMoved.add(code);
          }
        }
        collectFromTemplate(n.children);
      });
    };
    const plTreeForCheck = templateTreeBy.PL ?? templateTree ?? [];
    const bsTreeForCheck = templateTreeBy.BS ?? [];
    collectFromTemplate(plTreeForCheck);
    collectFromTemplate(bsTreeForCheck);
    // For each account where ALL dims are mapped, count it as moved
    dimsByGroupCode.forEach((dims, code) => {
      const seen = dimsSeenByCode.get(code);
      if (seen && dims.size > 0 && seen.size >= dims.size) effectiveMoved.add(code);
    });
    // If account has dim-tagged copies on right but no dims known on left, count as moved
    dimsSeenByCode.forEach((seen, code) => {
      if (seen.size > 0 && !dimsByGroupCode.has(code)) effectiveMoved.add(code);
    });
    const countUnmapped = (tree) => { let n = 0; function walk(nodes) { nodes.forEach(node => { if (!node.isSum && !node.isSumAccount && !effectiveMoved.has(node.code)) n++; walk(node.children || []); }); } walk(tree); return n; };
const plClientTree = clientTreeBy.PL ?? baseClientTree;
    const allClientNodes = buildClientTree(groupAccounts);
    function addIds(nodes) { return nodes.map(n => ({ ...n, id: `cli-${n.code}`, children: addIds(n.children || []) })); }
    const baseBSTree = addIds(allClientNodes.filter(n => n.accountType === "B/S"));
    const bsClientTree = clientTreeBy.BS ?? baseBSTree;
    const unmappedPL = countUnmapped(plClientTree);
    const unmappedBS = countUnmapped(bsClientTree);
    const totalUnmapped = unmappedPL + unmappedBS;
if (totalUnmapped > 0 && (!editingMapping || asNew) && mappingKind !== "report") {
      const parts = [];
      if (unmappedPL > 0) parts.push(`${unmappedPL} ${t("am_err_unmapped_pl_suffix")}`);
      if (unmappedBS > 0) parts.push(`${unmappedBS} ${t("am_err_unmapped_bs_suffix")}`);
      setSaveError(`${t("am_err_unmapped_pre")}${parts.join(t("am_err_unmapped_join"))}${t("am_err_unmapped_post")}`);
      setShowSaveForm(true);
      return;
    }
const trimmedName = currentName.trim().toLowerCase();
    const nameConflict = existingMappings.find(m =>
      String(m.name ?? "").trim().toLowerCase() === trimmedName &&
      (asNew || !editingMapping || m.mapping_id !== editingMapping.mapping_id)
    );
    if (nameConflict) { setSaveError(t("am_err_name_exists").replace("{name}", currentName.trim())); setShowSaveForm(true); return; }
    setSaving(true); setSaveError(null);
    try {
const plTree = templateTreeBy.PL ?? templateTree ?? [], bsTree = templateTreeBy.BS ?? [];
      const highlightedArr = [...highlightedIds];
if (editingMapping && !asNew) { const updated = await api.update({ mappingId: editingMapping.mapping_id, userId: authUserId, name: currentName.trim(), description: currentDescription.trim() || null, plTree, bsTree, highlightedIds: highlightedArr }); onSaved?.(updated); }
      else { const created = await api.create({ companyId, userId: authUserId, name: currentName.trim(), description: currentDescription.trim() || null, standard, plTree, bsTree, highlightedIds: highlightedArr }); onSaved?.(created); }
      onDirtyChange?.(false);
      setShowSaveForm(false);
    } catch (e) { setSaveError(e.message); } finally { setSaving(false); }
  };
useEffect(() => {
    if (saveRef) saveRef.current = () => {
      if (!editingMapping) { setShowSaveForm(true); }
      else { setShowSaveChoice(true); }
    };
    if (resetRef) resetRef.current = () => setShowResetConfirm(true);
  });

const handleReset = () => { pushHistory(); setClientTreeBy({ ...clientTreeBy, [statement]: baseClientTree }); setTemplateTreeBy({ ...templateTreeBy, [statement]: baseTemplateTree }); setMovedClientCodes(new Set()); setMovedTemplateIds(new Set()); setHighlightedIds(new Set()); onDirtyChange?.(false); };
  const handleAddBreaker = ({ name, color }) => { pushHistory(); const nb = { id: `brk-${Date.now()}`, kind: "breaker", code: `__breaker__custom_${Date.now()}`, sectionCode: `custom_${Date.now()}`, name, color, children: [] }; setTemplateTreeBy(prev => ({ ...prev, [statement]: [...(prev[statement] ?? templateTree), nb] })); };
const handleAddRow = ({ code, name, isSum, parentId = null }) => {
    pushHistory();
    const nn = { id: `new-${Date.now()}`, code, name, isSum, isSumAccount: isSum, sectionCode: null, showInSummary: false, sourceSide: "template", children: [] };
    setTemplateTreeBy(prev => { const ct = prev[statement] ?? templateTree; if (!parentId) return { ...prev, [statement]: [...ct, nn] }; return { ...prev, [statement]: walkTransform(ct, n => (n.id === parentId || n.code === parentId) ? { ...n, children: [...(n.children || []), nn] } : n) }; });
  };
const handleCopy = (sourceSide, nodeId) => {
    const sourceTree = sourceSide === "client" ? clientTree : templateTree;
    const sourceNode = findNodeById(sourceTree, nodeId);
    if (!sourceNode) return;
    pushHistory();
    const cloned = cloneSubtree(sourceNode, sourceSide);
    setTemplateTreeBy(prev => ({ ...prev, [statement]: [...(prev[statement] ?? templateTree), cloned] }));
  };
  const handleRename = (side, targetId, newName) => { pushHistory(); if (side === "client") setClientTreeBy(prev => ({ ...prev, [statement]: renameNode(prev[statement] ?? clientTree, targetId, newName) })); else setTemplateTreeBy(prev => ({ ...prev, [statement]: renameNode(prev[statement] ?? templateTree, targetId, newName) })); };
const handleDelete = (side, target) => {
    pushHistory();
    const targets = Array.isArray(target) ? target : [target];
    if (side === "client") {
      setClientTreeBy(prev => {
        let t = prev[statement] ?? clientTree;
        targets.forEach(id => { t = deleteNode(t, id); });
        return { ...prev, [statement]: t };
      });
      return;
    }
    // template side
    const dimTargets = targets.filter(t => typeof t === "string" && t.startsWith("__dim__"));
    const normalTargets = targets.filter(t => !(typeof t === "string" && t.startsWith("__dim__")));
    const treeBefore = templateTreeBy[statement] ?? templateTree;

    setTemplateTreeBy(prev => {
      let t = prev[statement] ?? templateTree;
      dimTargets.forEach(targetId => {
        const parts = targetId.slice(7).split("__");
        const nodeId = parts[0];
        const dimToRemove = parts.slice(1).join("__");
        t = walkTransform(t, n => {
          if ((n.id ?? n.code) !== nodeId) return n;
          const newDims = (n.dims ?? []).filter(d => d !== dimToRemove);
          return { ...n, dims: newDims.length > 0 ? newDims : null };
        });
      });
      normalTargets.forEach(id => { t = deleteNode(t, id); });
      return { ...prev, [statement]: t };
    });

    if (dimTargets.length > 0) {
      setMovedDimsByCode(prev => {
        const next = new Map(prev);
        dimTargets.forEach(targetId => {
          const parts = targetId.slice(7).split("__");
          const nodeId = parts[0];
          const dimToRemove = parts.slice(1).join("__");
          const nodeCode = findNodeById(treeBefore, nodeId)?.code ?? nodeId;
          const existing = next.get(nodeCode) ?? new Set();
          existing.delete(dimToRemove);
          if (existing.size === 0) next.delete(nodeCode);
          else next.set(nodeCode, existing);
        });
        return next;
      });
    }

    if (normalTargets.length > 0) {
      const otherTree = statement === "PL" ? (templateTreeBy.BS ?? []) : (templateTreeBy.PL ?? []);
      let finalTree = treeBefore;
      normalTargets.forEach(id => { finalTree = deleteNode(finalTree, id); });
      const remainingFullCodes = new Set();
      const remainingDimsByCode = new Map();
      const walkCollect = (nodes) => {
        (nodes || []).forEach(n => {
          if (n.kind === "breaker") { walkCollect(n.children); return; }
          const code = String(n.code ?? "");
          if (code) {
            if (Array.isArray(n.dims) && n.dims.length > 0) {
              const s = remainingDimsByCode.get(code) ?? new Set();
              n.dims.forEach(d => s.add(d));
              remainingDimsByCode.set(code, s);
            } else {
              remainingFullCodes.add(code);
            }
          }
          walkCollect(n.children);
        });
      };
      walkCollect(finalTree);
      walkCollect(otherTree);
      setMovedClientCodes(prev => {
        const next = new Set();
        prev.forEach(c => { if (remainingFullCodes.has(c)) next.add(c); });
        return next;
      });
      setMovedDimsByCode(() => {
        const next = new Map();
        remainingDimsByCode.forEach((dims, code) => { next.set(code, dims); });
        return next;
      });
    }
  };

const handleDrop = ({ sourceNode, sourceSide, targetId, position, destSide }) => {
  
if (sourceSide === "template" && destSide === "client" && mappingKind !== "report") return;
    pushHistory();
    console.log("[handleDrop]", { code: sourceNode.code, sourceSide, destSide, targetId, position, children: sourceNode.children?.length, dims: sourceNode.dims });

    // ── Failsafe (structure mode, client → template) ──────────────
    // Block any drop whose code is already represented on the template side,
    // whether as a full account or via dim-specific copies.
    if (sourceSide === "client" && destSide === "template" && mappingKind !== "report" && sourceNode.code !== "__multi__") {
      const code = String(sourceNode.code ?? "");
      const isDimDrag = Array.isArray(sourceNode.dims) && sourceNode.dims.length > 0;

      // Scan template tree for any node with this code (full or dim copy)
      const templateHasCode = (() => {
        let found = null; // "full" | "dim" | null
        const walk = (nodes) => nodes.forEach(n => {
          if (String(n.code ?? "") === code) {
            if (Array.isArray(n.dims) && n.dims.length > 0) found = found ?? "dim";
            else found = "full";
          }
          walk(n.children || []);
        });
        walk(templateTree);
        return found;
      })();

      if (isDimDrag) {
        // Dim drag: block if the dim was already mapped OR the whole account is already mapped on the right
        const dim = sourceNode.dims[0];
        const alreadyMovedDims = movedDimsByCode.get(code) ?? new Set();
        if (alreadyMovedDims.has(dim)) return;
        if (movedClientCodes.has(code)) return;
        if (templateHasCode === "full") return;
      } else {
        // Full-account drag: block if already mapped fully or if any node with this code exists on the template
        if (movedClientCodes.has(code)) return;
        if (templateHasCode) return;
      }
    }

// Dropping "inside" a non-sum template row is invalid → demote to "after" (sibling)
    if (destSide === "template" && position === "inside" && targetId) {
      const targetTree = templateTree;
      const targetNode = findNodeById(targetTree, targetId);
      if (targetNode && targetNode.kind !== "breaker") {
        const targetIsSum = !!(targetNode.isSum || targetNode.isSumAccount);
        if (!targetIsSum) {
          console.log("[drop-demote] target not sum, converting inside → after");
          position = "after";
        }
      }
    }
    
if (sourceNode.code === "__multi__" && Array.isArray(sourceNode.children) && sourceNode.children.length > 0) {
      const isSameSide = sourceSide === destSide;
      const sourceTree = sourceSide === "client" ? clientTree : templateTree;
      // Filter children that already exist in destination (cross-side, structure mode)
      let incomingChildren = sourceNode.children;
      if (!isSameSide && destSide === "template" && mappingKind !== "report") {
        const destTreeCheck = templateTree;
        const existingCodes = new Set();
        const walkExisting = (nodes) => nodes.forEach(n => { if (n.code && !String(n.code).startsWith("__")) existingCodes.add(String(n.code)); walkExisting(n.children || []); });
        walkExisting(destTreeCheck);
        incomingChildren = sourceNode.children.filter(c => !existingCodes.has(String(c.code)));
        if (incomingChildren.length === 0) return;
      }
      const childrenToMove = incomingChildren.map(child => {
        if (isSameSide) { const original = findNodeById(sourceTree, child.id ?? child.code); return original ?? cloneSubtree(child, sourceSide); }
        return cloneSubtree(child, sourceSide);
      });
let newTree = isSameSide ? sourceTree : (destSide === "client" ? clientTree : templateTree);
const safePosition = (position === "inside" && destSide === "template") ? "inside" : (position === "inside" ? "after" : position);
      if (isSameSide) {
        if (safePosition === "inside") {
          childrenToMove.forEach(child => { newTree = deleteNode(newTree, child.id ?? child.code); });
          childrenToMove.forEach(child => { newTree = insertAt(newTree, targetId, "inside", child); });
        } else {
        // Find a stable anchor: the node just before/after the target that isn't being moved
        const movingIds = new Set(childrenToMove.map(c => c.id ?? c.code));
        const flatAll = [];
        function flattenAll(nodes) { nodes.forEach(n => { flatAll.push(n); flattenAll(n.children || []); }); }
        flattenAll(newTree);
        const targetIdx = flatAll.findIndex(n => (n.id ?? n.code) === targetId);
        let anchorId = null, anchorPos = "after";
        for (let i = targetIdx + (safePosition === "before" ? -1 : 0); i < flatAll.length && i >= 0; safePosition === "before" ? i-- : i++) {
          if (!movingIds.has(flatAll[i].id ?? flatAll[i].code)) { anchorId = flatAll[i].id ?? flatAll[i].code; anchorPos = safePosition === "before" ? "before" : "after"; break; }
          if (safePosition === "before") i--;
        }
        childrenToMove.forEach(child => { newTree = deleteNode(newTree, child.id ?? child.code); });
        childrenToMove.forEach((child, i) => {
          if (i === 0) { newTree = anchorId ? insertAt(newTree, anchorId, anchorPos, child) : appendToRoot(newTree, child); }
          else { const prevId = childrenToMove[i - 1].id ?? childrenToMove[i - 1].code; newTree = insertAt(newTree, prevId, "after", child); }
        });
        }
      } else {
        childrenToMove.forEach((child, i) => {
          if (i === 0) { newTree = targetId ? insertAt(newTree, targetId, safePosition, child) : appendToRoot(newTree, child); }
          else { const prevId = childrenToMove[i - 1].id ?? childrenToMove[i - 1].code; newTree = insertAt(newTree, prevId, "after", child); }
        });
      }
if (destSide === "client") setClientTreeBy({ ...clientTreeBy, [statement]: newTree });
      else setTemplateTreeBy({ ...templateTreeBy, [statement]: newTree });
      if (sourceSide === "client" && destSide === "template") setMovedClientCodes(prev => new Set([...prev, ...incomingChildren.map(n => n.code)]));
      return;
    }
if (sourceSide === destSide) {
      console.log("[same-side drop]", { sourceSide, destSide, sourceId: sourceNode.id ?? sourceNode.code, targetId });
      const tree = destSide === "client" ? clientTree : templateTree;
      const sourceId = sourceNode.id ?? sourceNode.code;
      if (sourceId === targetId || isDescendantOf(tree, sourceId, targetId)) return;
      const originalNode = findNodeById(tree, sourceId); if (!originalNode) return;
      const without = deleteNode(tree, sourceId);
      const newTree = targetId ? insertAt(without, targetId, position, originalNode) : appendToRoot(without, originalNode);
      if (destSide === "client") setClientTreeBy({ ...clientTreeBy, [statement]: newTree }); else setTemplateTreeBy({ ...templateTreeBy, [statement]: newTree });
      return;
    }
const destTree = destSide === "client" ? clientTree : templateTree;

// Dim-only drag handling
    console.log("[pre-dim-check]", { hasDims: !!(sourceNode.dims && sourceNode.dims.length), destSide, code: sourceNode.code });
if (sourceNode.dims && sourceNode.dims.length > 0 && destSide === "template") {
      const dim = sourceNode.dims[0];
      // Block if this exact dim was already moved
      const alreadyMovedDims = movedDimsByCode.get(sourceNode.code) ?? new Set();
      if (alreadyMovedDims.has(dim)) return;
      const clonedWithDims = cloneSubtree(sourceNode, sourceSide);
      const newTree = targetId ? insertAt(destTree, targetId, position, clonedWithDims) : appendToRoot(destTree, clonedWithDims);
      setTemplateTreeBy(prev => ({ ...prev, [statement]: newTree }));
      setMovedDimsByCode(prev => {
        const next = new Map(prev);
        const ex = next.get(sourceNode.code) ?? new Set();
        ex.add(dim);
        next.set(sourceNode.code, ex);
        return next;
      });
      return;
    }
const cloned = cloneSubtree(sourceNode, sourceSide);

// If account has dim copies already on right side, offer to replace them
    if (sourceSide === "client" && destSide === "template" && mappingKind !== "report") {
      const existingDimCopies = [];
      function collectDimCopies(nodes) { nodes.forEach(n => { if (n.code === sourceNode.code && Array.isArray(n.dims)) existingDimCopies.push(n.id ?? n.code); collectDimCopies(n.children || []); }); }
      collectDimCopies(destTree);
if (existingDimCopies.length > 0) {
        console.log("[dim-conflict] found", existingDimCopies.length, "existing dim copies:", existingDimCopies, "targetId:", targetId);
        setConflict({ duplicates: [sourceNode.name], onResolve: choice => {
          setConflict(null);
          if (choice === "cancel") return;
if (choice === "replace-existing") {
            let tree = destTree;
            const deletedIds = new Set(existingDimCopies);
            existingDimCopies.forEach(id => { tree = deleteNode(tree, id); });
            // Don't auto-attach dims (see performInsert).
            // If targetId was one of the deleted nodes, append to root instead
            const safeTargetId = deletedIds.has(targetId) ? null : targetId;
            const newTree = safeTargetId ? insertAt(tree, safeTargetId, position, cloned) : appendToRoot(tree, cloned);
            setTemplateTreeBy(prev => ({ ...prev, [statement]: newTree }));
            setMovedClientCodes(prev => new Set([...prev, sourceNode.code]));
            setMovedDimsByCode(prev => {
              const next = new Map(prev);
              next.delete(sourceNode.code);
              // Mark all dims as moved since full account is now mapped
              const accountDims = dimsByGroupCode.get(sourceNode.code);
              if (accountDims) { const s = new Set(); accountDims.forEach(d => s.add(d)); next.set(sourceNode.code, s); }
              return next;
            });
          }
        }});
        return;
      }
    }

   const duplicates = mappingKind === "report" ? [] : findDuplicates(cloned, destTree);
const performInsert = (treeAfterDedupe, nodeToInsert) => {
      // Do NOT auto-attach dims on full-account drags. dims must only be set when the
      // user explicitly drags a single dim sub-row (handled in the dim-only branch above).
      // Auto-attaching here causes the main file to dim-filter the rollup, dropping
      // any untagged postings (e.g. 13100 shows -600 instead of -1200).
      const newTree = targetId ? insertAt(treeAfterDedupe, targetId, position, nodeToInsert) : appendToRoot(treeAfterDedupe, nodeToInsert);
      if (destSide === "client") setClientTreeBy({ ...clientTreeBy, [statement]: newTree }); else setTemplateTreeBy({ ...templateTreeBy, [statement]: newTree });
const sourceIds = collectIdsFromSubtree(sourceNode);
if (sourceSide === "client") {
        function collectCodes(n) { const out = [n.code]; (n.children||[]).forEach(c => collectCodes(c).forEach(x => out.push(x))); return out; }
        const codes = collectCodes(sourceNode);
        setMovedClientCodes(prev => new Set([...prev, ...codes]));
        // Also mark all dims of this account as moved
        codes.forEach(code => {
          const accountDims = dimsByGroupCode.get(code);
          if (accountDims && accountDims.size > 0) {
            setMovedDimsByCode(prev => {
              const next = new Map(prev);
              const existing = next.get(code) ?? new Set();
              accountDims.forEach(d => existing.add(d));
              next.set(code, existing);
              return next;
            });
          }
        });
      } else setMovedTemplateIds(prev => new Set([...prev, ...sourceIds]));
    };
    if (duplicates.length === 0) { performInsert(destTree, cloned); return; }
    setConflict({ duplicates, onResolve: choice => { setConflict(null); if (choice === "cancel") return; if (choice === "keep-both") { performInsert(destTree, cloned); return; } if (choice === "replace-existing") { performInsert(removeByNames(destTree, new Set(duplicates)), cloned); return; } } });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">

<div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
<ClientPanel mappingKind={mappingKind} amountsByCode={amountsByCode} amountsByCodeDim={amountsByCodeDim} onCopy={id => handleCopy("client", id)} tree={clientTree} statement={statement} movedIds={(() => {
  const effective = new Set(movedClientCodes);
  dimsByGroupCode.forEach((dims, code) => {
    const moved = movedDimsByCode.get(code);
    if (moved && dims.size > 0 && moved.size >= dims.size) effective.add(code);
  });
  movedDimsByCode.forEach((moved, code) => {
    if (moved.size > 0 && !dimsByGroupCode.has(code)) effective.add(code);
  });
  return effective;
})()} movedDimsByCode={movedDimsByCode} onDrop={p => handleDrop({ ...p, destSide: "client" })} onRename={(id, name) => handleRename("client", id, name)} onDelete={id => handleDelete("client", id)} activeMultiSide={activeMultiSide} onSetMultiSide={setActiveMultiSide} dimsByGroupCode={dimsByGroupCodeWithResidual} />
<TemplatePanel mappingKind={mappingKind} templateAmountsById={templateAmountsById} amountsByCodeDim={amountsByCodeDim} onCopy={id => handleCopy("template", id)} tree={templateTree} sectionByCode={sectionByCode} loading={tplLoading} accent={meta.accent} standardLabel={stdLabel(t, standard)} movedIds={movedTemplateIds} onDrop={p => handleDrop({ ...p, destSide: "template" })} onRename={(id, name) => handleRename("template", id, name)} onDelete={id => handleDelete("template", id)} onAddRow={handleAddRow} onAddBreaker={handleAddBreaker} activeMultiSide={activeMultiSide} onSetMultiSide={setActiveMultiSide} highlightedIds={highlightedIds} onToggleHighlight={id => { pushHistory(); setHighlightedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }}/>
      </div>
      {conflict && <ConflictModal duplicates={conflict.duplicates} onResolve={conflict.onResolve} />}
      {showSaveForm && <SaveMappingForm name={currentName} setName={setCurrentName} description={currentDescription} setDescription={setCurrentDescription} error={saveError} saving={saving} asNew={!!editingMapping} accent={meta.accent} onCancel={() => { setShowSaveForm(false); setSaveError(null); }} onSave={() => handleSave({ asNew: !!editingMapping })} />}
{showResetConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={() => setShowResetConfirm(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </div>
<p className="text-white font-black text-lg leading-tight">{t("am_reset_title")}</p>
              <p className="text-white/70 text-[11px] mt-0.5">{t("am_reset_subtitle")}</p>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-xs text-gray-500 leading-relaxed pb-2">{t("am_reset_desc")}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
                  {t("am_btn_cancel")}
                </button>
                <button onClick={() => { handleReset(); setShowResetConfirm(false); }}
                  className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)", boxShadow: "0 4px 14px -4px rgba(245,158,11,0.5)" }}>
                  {t("am_btn_reset")}
                </button>
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
<p className="text-white font-black text-lg leading-tight">{t("am_save_choice_title")}</p>
              <p className="text-white/70 text-[11px] mt-0.5">{t("am_save_choice_subtitle")}</p>
            </div>
            <div className="p-5 space-y-2">
              <button onClick={() => { setShowSaveChoice(false); handleSave(); }}
                className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#1a2f8a] hover:bg-[#eef1fb]/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-[#1a2f8a]">{t("am_save_overwrite").replace("{name}", editingMapping?.name ?? "")}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("am_save_overwrite_desc")}</p>
              </button>
              <button onClick={() => { setShowSaveChoice(false); setShowSaveForm(true); }}
                className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#1a2f8a] hover:bg-[#eef1fb]/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-[#1a2f8a]">{t("am_save_as_new")}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("am_save_as_new_desc")}</p>
              </button>
              <button onClick={() => setShowSaveChoice(false)}
                className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all mt-2">
                {t("am_btn_cancel")}
              </button>
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
        <div className="bg-amber-500 px-6 py-4"><p className="text-white font-black text-base">{t("am_conflict_title")}</p><p className="text-white/70 text-[10px] uppercase tracking-widest mt-0.5">{duplicates.length} {duplicates.length === 1 ? t("am_conflict_match") : t("am_conflict_matches")} {t("am_conflict_found")}</p></div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-600 leading-relaxed">{duplicates.length === 1 ? t("am_conflict_desc_one") : t("am_conflict_desc_many")}</p>
          <div className="bg-gray-50 rounded-xl p-3 max-h-40 overflow-y-auto">{duplicates.map((d, i) => <div key={i} className="text-xs text-gray-700 font-mono py-0.5 truncate">· {d}</div>)}</div>
          <div className="space-y-2 pt-2">
            {[["replace-existing", t("am_conflict_replace"), t("am_conflict_replace_desc")],["discard-imported", t("am_conflict_discard"), t("am_conflict_discard_desc")]].map(([choice, title, desc]) => (
              <button key={choice} onClick={() => onResolve(choice)} className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#1a2f8a] hover:bg-[#eef1fb]/40 transition-all group">
                <p className="text-xs font-black text-gray-800 group-hover:text-[#1a2f8a]">{title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DimFilterDropdown({ value, onChange, options, placeholder, accent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 h-6 px-2 rounded-md transition-all"
        style={{ background: value ? `${accent}18` : "rgba(26,47,138,0.06)", color: value ? accent : "#6b7280", border: `1px solid ${value ? accent + "25" : "transparent"}` }}>
        <span className="text-[9px] font-black uppercase tracking-widest max-w-[56px] truncate">{value || placeholder}</span>
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 200ms cubic-bezier(0.34,1.56,0.64,1)", flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div style={{
        position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 9999,
        background: "white", borderRadius: 16, minWidth: 180, overflow: "hidden",
        border: `1.5px solid ${accent}15`,
        boxShadow: `0 20px 48px -8px ${accent}25, 0 4px 16px -4px rgba(0,0,0,0.1)`,
        transformOrigin: "top right",
        transform: open ? "scale(1) translateY(0)" : "scale(0.88) translateY(-8px)",
        opacity: open ? 1 : 0, pointerEvents: open ? "all" : "none",
        transition: "transform 220ms cubic-bezier(0.34,1.56,0.64,1), opacity 160ms ease",
      }}>
        <div style={{ padding: "4px 4px 0", background: `${accent}06`, borderBottom: `1px solid ${accent}10` }}>
          <div style={{ padding: "6px 10px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: accent, opacity: 0.7 }}>{placeholder}</span>
            {value && <button onClick={() => { onChange(""); setOpen(false); }} style={{ fontSize: 9, fontWeight: 700, color: accent, background: `${accent}15`, border: "none", borderRadius: 6, padding: "2px 6px", cursor: "pointer", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("am_filter_clear")}</button>}
          </div>
        </div>
        <div style={{ padding: "4px", maxHeight: 200, overflowY: "auto" }}>
          {options.map((opt, i) => (
            <button key={opt} onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                width: "100%", textAlign: "left", padding: "7px 10px",
                borderRadius: 10, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                fontSize: 11, fontWeight: value === opt ? 800 : 500,
                color: value === opt ? accent : "#374151",
                background: value === opt ? `${accent}12` : "transparent",
                transition: `all 180ms cubic-bezier(0.34,1.56,0.64,1)`,
                transform: open ? "translateX(0)" : "translateX(-6px)",
                opacity: open ? 1 : 0,
                transitionDelay: `${i * 20}ms`,
              }}
              onMouseEnter={e => { if (value !== opt) e.currentTarget.style.background = `${accent}07`; }}
              onMouseLeave={e => { if (value !== opt) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt}</span>
              {value === opt && <div style={{ width: 16, height: 16, borderRadius: 8, background: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ClientPanel ──────────────────────────────────────────────
function ClientPanel({ mappingKind = "structure", amountsByCode = new Map(), amountsByCodeDim = new Map(), onCopy, tree, statement, movedIds, movedDimsByCode = new Map(), onDrop, onRename, onDelete, activeMultiSide, onSetMultiSide, dimsByGroupCode = new Map() }) {
  const t = useT();
  const [search, setSearch] = useState("");
const [expanded, setExpanded] = useState({});
const [flatMode, setFlatMode] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
const [selectedIds, setSelectedIds] = useState(new Set());
const lastSelectedRef = useRef(null);
 const [prevActiveMultiSide, setPrevActiveMultiSide] = useState(activeMultiSide);
  if (prevActiveMultiSide !== activeMultiSide) {
    setPrevActiveMultiSide(activeMultiSide);
    if (activeMultiSide !== "client" && multiMode) {
      setMultiMode(false);
      setSelectedIds(new Set());
    }
  }

// Auto-deselect accounts that have just been marked as moved
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const next = new Set();
      prev.forEach(id => {
        const code = typeof id === "string" && id.startsWith("cli-") ? id.slice(4) : id;
        if (!movedIds.has(code) && !movedIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [movedIds]);
  const totalCount = useMemo(() => countNodes(tree), [tree]);
  const flatTree = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (!n.isSum && !n.isSumAccount) out.push({ ...n, children: [] }); walk(n.children || []); }); }
    walk(tree);
    return out;
  }, [tree]);

const [unmappedOnly, setUnmappedOnly] = useState(false);
const [hideZero, setHideZero] = useState(false);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef(null);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const handler = e => { if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) setViewMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewMenuOpen]);
  const [filterDimGroup, setFilterDimGroup] = useState("");
  const [filterDimValue, setFilterDimValue] = useState("");
  const unmappedFlatTree = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (!n.isSum && !n.isSumAccount && !movedIds.has(n.code)) out.push({ ...n, children: [] }); walk(n.children || []); }); }
    walk(tree);
    return out;
  }, [tree, movedIds]);

const filteredTree = useMemo(() => {
    const hasDimFilter = filterDimGroup || filterDimValue;
    const amountPredicate = n => {
      if (!hideZero) return true;
      const amt = amountsByCode.get(n.code);
      return amt !== undefined && Math.abs(amt) >= 0.5;
    };
    const dimPredicate = n => {
      if (!hasDimFilter) return true;
      const dims = dimsByGroupCode.get(n.code);
      if (!dims) return false;
      return [...dims].some(d => {
        const idx = d.indexOf(":");
        const g = idx !== -1 ? d.slice(0, idx).trim() : "";
        const v = idx !== -1 ? d.slice(idx + 1).trim() : d;
        if (filterDimGroup && g !== filterDimGroup) return false;
        if (filterDimValue && v !== filterDimValue) return false;
        return true;
      });
    };
const combinedPredicate = n => (!hasDimFilter || dimPredicate(n)) && amountPredicate(n);
    let source;
    if (unmappedOnly) {
      source = unmappedFlatTree.filter(combinedPredicate);
      if (!search.trim()) return source;
      const q = search.toLowerCase();
      return source.filter(n => n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q));
    }
    source = flatMode ? flatTree : tree;
    const q = search.toLowerCase();
    const searchFiltered = !search.trim() ? source : flatMode
      ? source.filter(n => n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q))
      : filterTree(source, n => n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q));
    if (!hasDimFilter && !hideZero) return searchFiltered;
    return flatMode
      ? searchFiltered.filter(combinedPredicate)
      : filterTree(searchFiltered, combinedPredicate);
  }, [tree, flatTree, unmappedFlatTree, flatMode, unmappedOnly, hideZero, search, filterDimGroup, filterDimValue, dimsByGroupCode, amountsByCode]);
const visibleCount = useMemo(() => countNodes(filteredTree), [filteredTree]);
  const [prevFilteredTreeRef, setPrevFilteredTreeRef] = useState(filteredTree);
  if (prevFilteredTreeRef !== filteredTree) {
    setPrevFilteredTreeRef(filteredTree);
    const visibleIds = new Set();
    (function walk(nodes) { nodes.forEach(n => { visibleIds.add(n.id ?? n.code); walk(n.children || []); }); })(filteredTree);
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const next = new Set();
      prev.forEach(id => { if (visibleIds.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }
const allKeys = useMemo(() => collectAllCodes(tree, "client"), [tree]);

const flatSelectableIds = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (mappingKind === "report" || (!n.isSum && !n.isSumAccount)) out.push(n.id ?? n.code); walk(n.children || []); }); }
    walk(filteredTree);
    return out;
  }, [filteredTree, mappingKind]);
const dimGroups = useMemo(() => {
    const groups = new Set();
    dimsByGroupCode.forEach(dims => dims.forEach(d => { const idx = d.indexOf(":"); if (idx !== -1) groups.add(d.slice(0, idx).trim()); }));
    return [...groups].sort();
  }, [dimsByGroupCode]);

  const dimValues = useMemo(() => {
    if (!filterDimGroup) return [];
    const values = new Set();
    dimsByGroupCode.forEach(dims => dims.forEach(d => {
      const idx = d.indexOf(":");
      if (idx !== -1 && d.slice(0, idx).trim() === filterDimGroup) values.add(d.slice(idx + 1).trim());
    }));
    return [...values].sort();
  }, [dimsByGroupCode, filterDimGroup]);

  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const isExpanded = allKeys.length > 0 && allKeys.every(k => expanded[k]);
const multiToggleBtn = (
    <button onClick={() => { const next = !multiMode; setMultiMode(next); setSelectedIds(new Set()); onSetMultiSide(next ? "client" : null); }} title={multiMode ? t("am_exit_multi") : t("am_multi_select")}
      className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
      style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: multiMode ? "#1a2f8a" : "rgba(26,47,138,0.06)", color: multiMode ? "white" : "#1a2f8a" }}>
      <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
        <path d="M17 14v6M14 17h6"/>
      </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("am_select_label")}</span>
    </button>
  );
const flatToggleBtn = (
    <button onClick={() => setFlatMode(f => !f)} title={flatMode ? t("am_tree_title") : t("am_flat_title")}
      className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
      style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: flatMode ? "#1a2f8a" : "rgba(26,47,138,0.06)", color: flatMode ? "white" : "#1a2f8a" }}>
      <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        {flatMode ? <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="13" y1="18" x2="21" y2="18"/></>}
      </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{flatMode ? t("am_flat_label") : t("am_tree_label")}</span>
    </button>
  );
const unmappedToggleBtn = (
    <button onClick={() => setUnmappedOnly(u => !u)} title={unmappedOnly ? t("am_show_all_accounts") : t("am_show_unmapped")}
      className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
      style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: unmappedOnly ? "#1a2f8a" : "rgba(26,47,138,0.06)", color: unmappedOnly ? "white" : "#1a2f8a" }}>
      <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
      <span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[120px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("am_unmapped_label")}</span>
    </button>
  );
  return (
<Panel title={t("am_panel_client_title")} subtitle={unmappedOnly ? `${unmappedFlatTree.length} ${t("am_panel_unmapped_suffix")}` : `${flatMode ? flatTree.length : totalCount} ${statement === "PL" ? t("am_panel_pl_suffix") : t("am_panel_bs_suffix")}`} accent="#1a2f8a" onExpandAll={() => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])))} onCollapseAll={() => setExpanded({})} isExpanded={isExpanded} extra={
  <div className="flex items-center gap-1">
    {dimGroups.length > 0 && (
      <div className="flex items-center gap-1 mr-1">
<DimFilterDropdown
          value={filterDimGroup}
          onChange={v => { setFilterDimGroup(v); setFilterDimValue(""); }}
          options={dimGroups}
          placeholder={t("am_filter_group_placeholder")}
          accent="#1a2f8a"
        />
        {filterDimGroup && (
          <DimFilterDropdown
            value={filterDimValue}
            onChange={setFilterDimValue}
            options={dimValues}
            placeholder={t("am_filter_value_placeholder")}
            accent="#1a2f8a"
          />
        )}
        {(filterDimGroup || filterDimValue) && (
          <button onClick={() => { setFilterDimGroup(""); setFilterDimValue(""); }}
            className="w-6 h-6 rounded-md flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-500 transition-colors flex-shrink-0">
            <X size={10} />
          </button>
        )}
      </div>
    )}
   {multiToggleBtn}{flatToggleBtn}{unmappedToggleBtn}
<div ref={viewMenuRef} className="relative flex-shrink-0">
<button onClick={() => setViewMenuOpen(o => !o)} title={t("am_view_options")}
        className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
        style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: (hideZero || hideAmounts) ? "#1a2f8a" : "rgba(26,47,138,0.06)", color: (hideZero || hideAmounts) ? "white" : "#1a2f8a" }}>
        <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        <span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("am_values_label")}</span>
      </button>
      {viewMenuOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-[60] min-w-[210px] rounded-xl bg-white overflow-hidden"
          style={{ border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)", animation: "viewMenuIn 220ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          <div className="px-3 pt-2 pb-1.5 border-b border-gray-50">
            <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "#1a2f8a", opacity: 0.55 }}>{t("am_view_options")}</p>
          </div>
          <button onClick={() => setHideZero(z => !z)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[#1a2f8a]/[0.04] transition-colors">
            <span className="text-[11px] font-bold text-gray-700">{t("am_hide_zero")}</span>
            <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideZero ? "#1a2f8a" : "#d1d5db" }}>
              <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideZero ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
            </span>
          </button>
          <button onClick={() => setHideAmounts(a => !a)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[#1a2f8a]/[0.04] transition-colors border-t border-gray-50">
<span className="text-[11px] font-bold text-gray-700">{t("am_hide_amounts")}</span>
            <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideAmounts ? "#1a2f8a" : "#d1d5db" }}>
              <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideAmounts ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
            </span>
          </button>
        </div>
      )}
      <style>{`@keyframes viewMenuIn { from { opacity: 0; transform: translateY(-6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>
  </div>
}>
<PanelToolbar search={search} setSearch={setSearch} placeholder={t("am_search_accounts")} count={visibleCount} total={totalCount} />

      <div className="flex-1 overflow-y-auto px-1"onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("application/json")); if (data.sourceSide === "template") onDrop({ sourceNode: data.node, sourceSide: "template", targetId: null, position: "after" }); } catch { /* ignore parse */ } }}>
     {filteredTree.length === 0 ? <EmptyPanelState icon={FileText} message={search ? t("am_no_matches") : t("am_no_accounts")} /> : filteredTree.map(node => <DraggableTreeRow key={node.id ?? node.code} node={node} depth={0} expanded={expanded} onToggle={toggle} side="client" mappingKind={mappingKind} hideAmounts={hideAmounts} amountsByCode={amountsByCode} amountsByCodeDim={amountsByCodeDim} onCopy={onCopy} movedIds={movedIds} movedDimsByCode={movedDimsByCode}onDrop={onDrop} onRename={onRename} onDelete={id => { if (multiMode && selectedIds.size > 0 && selectedIds.has(id)) { onDelete([...selectedIds]); setSelectedIds(new Set()); } else { onDelete(id); } }}multiMode={multiMode} selectedIds={selectedIds} clientTree={tree}
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
}} dimsByGroupCode={dimsByGroupCode} movedDimsByCode={movedDimsByCode} />)}
      </div>
    </Panel>
  );
}

// ─── TemplatePanel ────────────────────────────────────────────
function TemplatePanel({ mappingKind = "structure", templateAmountsById = new Map(), amountsByCodeDim = new Map(), onCopy, tree, sectionByCode, loading, accent, standardLabel, movedIds, onDrop, onRename, onDelete, onAddRow, onAddBreaker, activeMultiSide, onSetMultiSide, highlightedIds, onToggleHighlight }) {
  const t = useT();
  const [pendingParentId, setPendingParentId] = useState(null);
const [showBreakerForm, setShowBreakerForm] = useState(false);
  const [search, setSearch] = useState("");
const [expanded, setExpanded] = useState({});
  const [multiMode, setMultiMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hideAmounts, setHideAmounts] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef(null);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const handler = e => { if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) setViewMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewMenuOpen]);
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
  const filteredTree = useMemo(() => { if (!search.trim()) return tree; return filterTreeTpl(tree, search.toLowerCase()); }, [tree, search]);
  const visibleCount = useMemo(() => countNodes(filteredTree), [filteredTree]);
  const [prevFilteredTreeRef, setPrevFilteredTreeRef] = useState(filteredTree);
  if (prevFilteredTreeRef !== filteredTree) {
    setPrevFilteredTreeRef(filteredTree);
    const visibleIds = new Set();
    (function walk(nodes) { nodes.forEach(n => { visibleIds.add(n.id ?? n.code); walk(n.children || []); }); })(filteredTree);
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const next = new Set();
      prev.forEach(id => { if (visibleIds.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }
const allKeys = useMemo(() => collectAllCodes(tree, "tpl"), [tree]);
const flatSelectableIds = useMemo(() => {
    const out = [];
    function walk(nodes) { nodes.forEach(n => { if (n.kind !== "breaker" && !n.isSum) { out.push(n.id ?? n.code); } walk(n.children || []); }); }
    walk(filteredTree);
    return out;
  }, [filteredTree]);
  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const isExpanded = allKeys.length > 0 && allKeys.every(k => expanded[k]);
const multiToggleBtn = (
    <button onClick={() => { const next = !multiMode; setMultiMode(next); setSelectedIds(new Set()); onSetMultiSide(next ? "template" : null); }} title={multiMode ? t("am_exit_multi") : t("am_multi_select_rows")}
      className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
      style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: multiMode ? accent : `${accent}10`, color: multiMode ? "white" : accent }}>
      <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
        <path d="M17 14v6M14 17h6"/>
      </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("am_select_label")}</span>
    </button>
  );
  const viewMenuBtn = (
    <div ref={viewMenuRef} className="relative flex-shrink-0">
      <button onClick={() => setViewMenuOpen(o => !o)} title={t("am_view_options")}
        className="group rounded-md flex items-center justify-center overflow-hidden transition-all flex-shrink-0"
        style={{ height: TOGGLE_HEIGHT, paddingLeft: TOGGLE_PADDING_X, paddingRight: TOGGLE_PADDING_X, background: hideAmounts ? accent : `${accent}10`, color: hideAmounts ? "white" : accent }}>
        <svg width={TOGGLE_ICON_SIZE} height={TOGGLE_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
<span className="overflow-hidden whitespace-nowrap font-black uppercase tracking-widest max-w-0 opacity-0 ml-0 group-hover:max-w-[110px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out" style={{ fontSize: TOGGLE_LABEL_FONT_SIZE }}>{t("am_values_label")}</span>
      </button>
      {viewMenuOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-[60] min-w-[210px] rounded-xl bg-white overflow-hidden"
          style={{ border: `1px solid ${accent}15`, boxShadow: `0 20px 50px -12px ${accent}30`, animation: "viewMenuIn 220ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          <div className="px-3 pt-2 pb-1.5 border-b border-gray-50">
            <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: accent, opacity: 0.55 }}>{t("am_view_options")}</p>
          </div>
          <button onClick={() => setHideAmounts(a => !a)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
            <span className="text-[11px] font-bold text-gray-700">{t("am_hide_amounts")}</span>
            <span className="relative w-7 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: hideAmounts ? accent : "#d1d5db" }}>
              <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" style={{ left: hideAmounts ? 14 : 2, transition: "left 220ms cubic-bezier(0.34,1.56,0.64,1)" }} />
            </span>
          </button>
        </div>
      )}
    </div>
  );
  return (
<Panel title={`${standardLabel} ${t("am_panel_template_suffix")}`} subtitle={loading ? t("am_loading_ellipsis") : `${totalCount} ${t("am_rows_suffix")}`} accent={accent} onExpandAll={() => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])))} onCollapseAll={() => setExpanded({})} isExpanded={isExpanded} extra={<div className="flex items-center gap-1">{multiToggleBtn}{viewMenuBtn}</div>}>
      <PanelToolbar search={search} setSearch={setSearch} placeholder={t("am_search_template")} count={visibleCount} total={totalCount} />
      <AddRowForm accent={accent} onAdd={p => onAddRow({ ...p, parentId: pendingParentId })} existingTree={tree} pendingParentId={pendingParentId} onClearParent={() => setPendingParentId(null)} tree={tree} />
      <AddBreakerForm accent={accent} open={showBreakerForm} onOpen={() => setShowBreakerForm(true)} onClose={() => setShowBreakerForm(false)} onAdd={onAddBreaker} />

<div className="flex-1 overflow-y-auto px-1" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("application/json")); if (data.sourceSide === "client") onDrop({ sourceNode: data.node, sourceSide: "client", targetId: null, position: "after" }); else if (data.sourceSide === "template") onDrop({ sourceNode: data.node, sourceSide: "template", targetId: null, position: "after" }); } catch { /* ignore parse */ } }}>
        {loading ? <div className="text-center py-16 text-xs text-gray-400">{t("am_loading_template")}</div> : filteredTree.length === 0 ? <EmptyPanelState icon={Library} message={search ? t("am_no_matches") : t("am_no_rows")} /> : filteredTree.map(node => <DraggableTreeRow key={node.id ?? node.code} node={node} depth={0} expanded={expanded} onToggle={toggle} side="template" mappingKind={mappingKind} hideAmounts={hideAmounts} templateAmountsById={templateAmountsById} amountsByCodeDim={amountsByCodeDim} onCopy={onCopy}movedIds={movedIds} onDrop={onDrop}onRename={onRename} onDelete={id => { if (multiMode && selectedIds.size > 0 && selectedIds.has(id)) { onDelete([...selectedIds]); setSelectedIds(new Set()); } else { onDelete(id); } }} onAddChild={parentId => { setPendingParentId(parentId); setExpanded(prev => ({ ...prev, [`tpl-${parentId}`]: true })); }} sectionByCode={sectionByCode} multiMode={multiMode} selectedIds={selectedIds} templateTree={tree} onToggleSelect={(id, shiftKey) => {
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
}} highlightedIds={highlightedIds} onToggleHighlight={onToggleHighlight} />)}
      </div>
    </Panel>
  );
}

// ─── AnimatedAmount — count up/down between values ────────────
function AnimatedAmount({ value, hidden }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const isFirstRef = useRef(true);
  useEffect(() => {
    if (isFirstRef.current) {
      isFirstRef.current = false;
      prevRef.current = value;
      setDisplay(value);
      return;
    }
    const from = prevRef.current;
    const to = value;
    if (to === undefined || from === undefined) {
      setDisplay(to); prevRef.current = to; return;
    }
    if (Math.abs(from - to) < 0.5) {
      setDisplay(to); prevRef.current = to; return;
    }
    const start = performance.now();
    const duration = 700;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(from + (to - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
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
        maxWidth: hidden ? 0 : 120,
        opacity: hidden ? 0 : 1,
        transform: hidden ? "translateX(8px) scale(0.7)" : "translateX(0) scale(1)",
        userSelect: hidden ? "none" : "auto",
        transition: "max-width 380ms cubic-bezier(0.34,1.56,0.64,1), opacity 240ms ease, transform 380ms cubic-bezier(0.34,1.56,0.64,1)",
      }}
      title={hidden ? "" : (hasAmt ? Math.round(value).toLocaleString() : "Sin datos para este periodo")}>
      {!hasAmt ? "—" : Math.round(display).toLocaleString()}
    </span>
  );
}

// ─── DraggableTreeRow ─────────────────────────────────────────
function DraggableTreeRow({ node, depth, expanded, onToggle, side, mappingKind = "structure", hideAmounts = false, amountsByCode = new Map(), templateAmountsById = new Map(), amountsByCodeDim = new Map(), onCopy, movedIds, movedDimsByCode = new Map(), onDrop, onRename, onDelete, onAddChild, sectionByCode, multiMode, selectedIds, onToggleSelect, clientTree, templateTree, highlightedIds, onToggleHighlight, dimsByGroupCode }) {
  const t = useT();
  const key = `${side === "client" ? "client" : "tpl"}-${node.code}`;
  const isOpen = !!expanded[key];
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSum = node.isSum ?? node.isSumAccount;
  const isMoved = side === "client" ? movedIds.has(node.code) || movedIds.has(node.id ?? node.code) : movedIds.has(node.id ?? node.code);
  const [dropZone, setDropZone] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
const [hovering, setHovering] = useState(false);
const [showDims, setShowDims] = useState(false);
const dimUid = useId();
  const dimIdRef = useRef(`dim-${node.code}-${dimUid}`);
  useEffect(() => {
    const handler = (e) => { if (e.detail !== dimIdRef.current) setShowDims(false); };
    window.addEventListener("dim-popover-open", handler);
    return () => window.removeEventListener("dim-popover-open", handler);
  }, []);
  const editInputRef = useRef(null);
  const dims = side === "client" ? (dimsByGroupCode?.get(node.code) ?? new Set()) : (node.dims ? new Set(node.dims) : new Set());
  const hasDims = dims.size > 0;
  const movedDims = movedDimsByCode?.get(node.code) ?? new Set();
  useEffect(() => { if (editing && editInputRef.current) { editInputRef.current.focus(); editInputRef.current.select(); } }, [editing]);
  const startEdit = e => { e.stopPropagation(); setEditValue(node.name); setEditing(true); };
  const commitEdit = () => { const trimmed = editValue.trim(); if (trimmed && trimmed !== node.name) onRename?.(node.id ?? node.code, trimmed); setEditing(false); };
  const cancelEdit = () => { setEditValue(node.name); setEditing(false); };
const handleDragStart = e => {
    if (side === "client" && (node.isSum || node.isSumAccount) && mappingKind !== "report") { e.preventDefault(); return; }
    // Block dragging a client account that's already mapped (structure mode)
    if (side === "client" && mappingKind !== "report" && (movedIds?.has(node.code) || movedIds?.has(node.id ?? node.code))) { e.preventDefault(); return; }
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
          const isMovedClient = isClientStructure && (movedIds?.has(n.code) || movedIds?.has(id));
          if (selectedIds.has(id) && (mappingKind === "report" || (!n.isSum && !n.isSumAccount)) && n.kind !== "breaker" && !isMovedClient) {
            selected.push({ ...stripSubtreeForTransfer(n), id });
          }
          collect(n.children || []);
        });
      }
      collect(sourceTree ?? []);
      if (selected.length === 0) { e.preventDefault(); return; }
if (selected.length > 0) {
        const multiNode = { id: `multi-${Date.now()}`, code: "__multi__", name: `${selected.length} accounts`, isSum: false, isSumAccount: false, children: selected };
        console.log("[multi-drag] packaging", selected.length, "nodes", selected.map(n => n.code));
        e.dataTransfer.setData("application/json", JSON.stringify({ sourceSide: side, node: multiNode }));
        return;
      }
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
  const handleDrop = e => { e.preventDefault(); e.stopPropagation(); const zone = dropZone; setDropZone(null); try { const data = JSON.parse(e.dataTransfer.getData("application/json")); onDrop({ sourceNode: data.node, sourceSide: data.sourceSide, targetId: node.id ?? node.code, position: zone ?? "after" }); } catch { /* ignore parse */ } };
const accent = side === "client" ? "#1a2f8a" : "#374151";
  const dropLine = (
    <div className="relative my-0.5 pointer-events-none" style={{ marginLeft: 8 + depth * 14, marginRight: 8 }}>
      <div style={{ height: 3, background: accent, borderRadius: 2, boxShadow: `0 0 14px ${accent}, 0 0 4px ${accent}` }} />
      <div className="absolute top-1/2 -translate-y-1/2" style={{ left: -3, width: 9, height: 9, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${accent}, 0 0 2px ${accent}` }} />
    </div>
  );

  const editControls = editing ? (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button onMouseDown={e => { e.preventDefault(); commitEdit(); }} className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"><Check size={10} /></button>
      <button onMouseDown={e => { e.preventDefault(); cancelEdit(); }} className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"><X size={10} /></button>
    </div>
  ) : null;

  if (node.kind === "breaker") {
    return (
      <>
        {dropZone === "before" && dropLine}
        <div draggable={!editing} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragLeave={() => setDropZone(null)} onDrop={handleDrop} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} onClick={!editing && hasChildren ? e => { if (e.detail === 1) onToggle(key); } : undefined} className={`flex items-center min-w-0 gap-2 px-3 py-2 my-1 rounded-lg transition-all ${editing ? "cursor-text" : "cursor-grab active:cursor-grabbing"} ${dropZone === "inside" ? "ring-2 ring-offset-1 ring-white" : ""}`} style={{ backgroundColor: node.color || "#374151", ...(dropZone === "inside" ? { boxShadow: `0 0 0 2px white, 0 0 0 4px ${node.color || "#374151"}` } : {}) }}>
          {hasChildren && <span className="text-white/70 flex-shrink-0">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>}
          {editing ? <input ref={editInputRef} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} onBlur={commitEdit} className="text-xs flex-1 min-w-0 px-2 py-0.5 rounded border border-white/40 outline-none focus:border-white bg-white/15 text-white placeholder:text-white/50 uppercase tracking-widest font-black" />
          : <span className="text-xs flex-1 min-w-0 truncate font-black uppercase tracking-widest text-white">{node.name}</span>}
         {!editing && hovering && <div className="flex items-center gap-0.5 flex-shrink-0"><button onClick={startEdit} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"><Pencil size={13} /></button><button onClick={e => { e.stopPropagation(); onDelete?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"><Trash2 size={13} /></button></div>}
          {editControls}
        </div>
        {dropZone === "after" && dropLine}
     {isOpen && hasChildren && node.children.map(child => <DraggableTreeRow key={child.id ?? child.code} node={child}depth={1} expanded={expanded} onToggle={onToggle} side={side} mappingKind={mappingKind} hideAmounts={hideAmounts} amountsByCode={amountsByCode} templateAmountsById={templateAmountsById} amountsByCodeDim={amountsByCodeDim} onCopy={onCopy} movedIds={movedIds}movedDimsByCode={movedDimsByCode} onDrop={onDrop} onRename={onRename} onDelete={onDelete} onAddChild={onAddChild} sectionByCode={sectionByCode} multiMode={multiMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} clientTree={clientTree} templateTree={templateTree} highlightedIds={highlightedIds} onToggleHighlight={onToggleHighlight} />)}
      </>
    );
  }

const cursorClass = editing ? "cursor-text" : (side === "client" && isSum && mappingKind !== "report") ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing";
  const bgClass = isSum ? (side === "client" ? "bg-[#eef1fb]/40" : "bg-gray-50/60") : "";

  return (
    <>
      {dropZone === "before" && dropLine}
      <div className="flex items-stretch gap-2">
     <div draggable={!editing} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragLeave={() => setDropZone(null)} onDrop={handleDrop} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} onClick={hasChildren && !editing ? e => { if (e.detail === 1) onToggle(key); } : undefined} className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-2.5 rounded-lg transition-all ${cursorClass} ${dropZone === "inside" ? "" : "hover:bg-gray-50"} ${bgClass} ${isMoved && dropZone !== "inside" ? "bg-emerald-50/30" : ""}`} style={dropZone === "inside" ? { background: `${accent}1f`, boxShadow: `inset 0 0 0 2px ${accent}, 0 0 0 4px ${accent}20, 0 6px 20px -6px ${accent}80`, transform: "scale(1.01)" } : undefined}>
{multiMode && (side === "client" ? (!isSum || mappingKind === "report") : (!isSum && node.kind !== "breaker")) && (
            <span onClick={e => { e.stopPropagation(); onToggleSelect?.(node.id ?? node.code, e.shiftKey); }}
              className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-all"
              style={{ borderColor: selectedIds?.has(node.id ?? node.code) ? "#1a2f8a" : "#d1d5db", backgroundColor: selectedIds?.has(node.id ?? node.code) ? "#1a2f8a" : "white" }}>
              {selectedIds?.has(node.id ?? node.code) && <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
          )}
         {hasChildren
            ? <span onClick={e => { e.stopPropagation(); onToggle(key); }} className={`flex-shrink-0 cursor-pointer ${side === "client" ? "text-[#1a2f8a]/40 hover:text-[#1a2f8a]" : "text-gray-400 hover:text-gray-600"}`}>{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
            : <span className="w-3 flex-shrink-0" />}
          <span className={`text-[10px] font-mono flex-shrink-0 w-20 truncate ${isSum ? (side === "client" ? "font-bold text-[#1a2f8a]" : "font-bold text-gray-700") : "text-gray-400"}`}>{node.code}</span>
          {editing ? <input ref={editInputRef} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} onBlur={commitEdit} className="text-xs flex-1 min-w-0 px-2 py-0.5 rounded border border-[#1a2f8a]/30 outline-none focus:border-[#1a2f8a] bg-white" />
: <span className={`text-xs flex-1 min-w-0 truncate ${isSum ? (side === "client" ? "font-bold text-[#1a2f8a]" : "font-bold text-gray-800") : "text-gray-600"}`}>{node.name}</span>}
{node.kind !== "breaker" && (() => {
            const amt = side === "client" ? amountsByCode.get(node.code) : templateAmountsById.get(node.id ?? node.code);
            return <AnimatedAmount value={amt} hidden={hideAmounts} />;
          })()}
          {hasDims && (
            <div className="relative flex-shrink-0">
              <button onClick={e => { e.stopPropagation(); const next = !showDims; if (next) window.dispatchEvent(new CustomEvent("dim-popover-open", { detail: dimIdRef.current })); setShowDims(next); }} onMouseDown={e => e.stopPropagation()}
                className="w-5 h-5 rounded-md flex items-center justify-center transition-colors flex-shrink-0"
style={{ background: showDims ? "#f59e0b" : "#fef3c7", color: "#d97706" }}
                title={t("am_has_dimensions")}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </button>
            </div>
          )}
          {!editing && hovering && <div className="flex items-center gap-0.5 flex-shrink-0">
{onAddChild && isSum && <button onClick={e => { e.stopPropagation(); onAddChild?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} title={t("am_add_child_row")} className="w-6 h-6 rounded flex items-center justify-center hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors"><Plus size={14} /></button>}
<button onClick={startEdit} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-[#1a2f8a]/10 text-gray-400 hover:text-[#1a2f8a] transition-colors"><Pencil size={13} /></button>
            {mappingKind === "report" && node.kind !== "breaker" && <button onClick={e => { e.stopPropagation(); onCopy?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} title={t("am_duplicate_to_template")} className="w-6 h-6 rounded flex items-center justify-center hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"><Copy size={12} /></button>}
{side !== "client" && <>
              <button onClick={e => { e.stopPropagation(); onToggleHighlight?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center transition-colors" style={{ color: highlightedIds?.has(node.id ?? node.code) ? "#f59e0b" : undefined }} title={highlightedIds?.has(node.id ?? node.code) ? t("am_remove_highlight") : t("am_highlight_row")}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill={highlightedIds?.has(node.id ?? node.code) ? "#f59e0b" : "none"} stroke={highlightedIds?.has(node.id ?? node.code) ? "#f59e0b" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
            </>}
            {side === "client" && mappingKind === "report" && (
              <button onClick={e => { e.stopPropagation(); onDelete?.(node.id ?? node.code); }} onMouseDown={e => e.stopPropagation()} className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
            )}
          </div>}
          {editing && <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onMouseDown={e => { e.preventDefault(); commitEdit(); }} className="w-5 h-5 rounded flex items-center justify-center hover:bg-emerald-50 text-emerald-500 transition-colors"><Check size={10} /></button>
            <button onMouseDown={e => { e.preventDefault(); cancelEdit(); }} className="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100 text-gray-400 transition-colors"><X size={10} /></button>
          </div>}
{!editing && !hovering && <div className="flex items-center gap-1 flex-shrink-0">
            {isMoved && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200">
                <CheckCircle2 size={11} className="text-emerald-600" strokeWidth={2.5} />
               <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600">{t("am_mapped_badge")}</span>
              </span>
            )}
            {side !== "client" && highlightedIds?.has(node.id ?? node.code) && <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
          </div>}
        </div>
      </div>
{dropZone === "after" && dropLine}
{showDims && hasDims && [...dims].map((d, i) => {
        const idx = d.indexOf(":");
        const group = idx !== -1 ? d.slice(0, idx).trim() : "";
        const name = idx !== -1 ? d.slice(idx + 1).trim() : d;
        const isDimMoved = movedDims.has(d);
        const dimNode = { ...stripSubtreeForTransfer(node), id: node.id, dims: [d] };
        return (
          <div key={i}
            draggable={side === "client"}
            onDragStart={side === "client" ? e => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = "copyMove";
              e.dataTransfer.setData("application/json", JSON.stringify({ sourceSide: "client", node: dimNode }));
            } : undefined}
className={`group/dim flex items-center gap-1 py-1.5 rounded-lg transition-colors ${side === "client" ? "cursor-grab active:cursor-grabbing hover:bg-amber-50/60" : "hover:bg-amber-50/40"} ${isDimMoved ? "opacity-40" : ""}`}
            style={{ paddingLeft: `${(depth + 1) * 14 + 8}px`, paddingRight: 8 }}>
            <span className="w-3 flex-shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-400 flex-shrink-0 mr-1">{group}:</span>
            <span className="text-[10px] text-gray-600 leading-relaxed flex-1">{name}</span>
            {(() => {
              const dAmt = amountsByCodeDim.get(`${node.code}||${d}`);
              const hasDA = dAmt !== undefined;
              const isZ = hasDA && Math.abs(dAmt) < 0.5;
              return (
                <span className={`text-[10px] font-mono font-semibold flex-shrink-0 tabular-nums mr-1 ${!hasDA || isZ ? "text-gray-300" : dAmt < 0 ? "text-red-500" : "text-gray-600"}`}
                  title={hasDA ? dAmt.toLocaleString() : ""}
                  style={{ opacity: hideAmounts ? 0 : 1, maxWidth: hideAmounts ? 0 : 120, transition: "opacity 200ms, max-width 300ms", overflow: "hidden" }}>
                  {!hasDA ? "—" : Math.round(dAmt).toLocaleString()}
                </span>
              );
            })()}
            {isDimMoved && side === "client" && <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" />}
            {side === "template" && (
              <button
                onClick={e => { e.stopPropagation(); onDelete?.(`__dim__${node.id ?? node.code}__${d}`); }}
                onMouseDown={e => e.stopPropagation()}
                className="opacity-0 group-hover/dim:opacity-100 w-4 h-4 rounded flex items-center justify-center hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all flex-shrink-0">
                <Trash2 size={9} />
              </button>
            )}
          </div>
        );
      })}
    {isOpen && hasChildren && node.children.map(child => <DraggableTreeRow key={child.id ?? child.code} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} side={side} mappingKind={mappingKind} hideAmounts={hideAmounts} amountsByCode={amountsByCode} templateAmountsById={templateAmountsById} amountsByCodeDim={amountsByCodeDim} onCopy={onCopy} movedIds={movedIds}movedDimsByCode={movedDimsByCode} onDrop={onDrop} onRename={onRename} onDelete={onDelete} onAddChild={onAddChild}sectionByCode={sectionByCode} multiMode={multiMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} clientTree={clientTree} templateTree={templateTree} highlightedIds={highlightedIds} onToggleHighlight={onToggleHighlight} dimsByGroupCode={dimsByGroupCode} />)}
    </>
  );
}

// ─── AddRowForm ───────────────────────────────────────────────
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
    if (!tc) { setError(t("am_err_code_required")); return; }
    if (!tn) { setError(t("am_err_name_required")); return; }
    const exists = (function check(nodes) { for (const n of nodes) { if (String(n.code) === tc) return true; if (check(n.children || [])) return true; } return false; })(existingTree);
    if (exists) { setError(t("am_err_code_exists").replace("{code}", tc)); return; }
    onAdd({ code: tc, name: tn, isSum }); fullReset(); setOpen(false);
  };
if (!open) return (
    <button onClick={() => setOpen(true)} className="group flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl border border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 text-gray-400 hover:text-gray-500 text-xs font-semibold transition-all w-full justify-center">
      <Plus size={11} /><span>{t("am_add_row")}</span>
    </button>
  );
  return (
    <div className="mb-3 rounded-xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${accent}30` }}>
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: `${accent}08` }}>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accent }}>{pendingParentId ? t("am_child_row") : t("am_new_row")}</span>
          {parentName && <span className="flex items-center gap-1 text-[10px] text-gray-400"><span>↳</span><span className="font-mono font-semibold text-gray-600 truncate max-w-[120px]">{parentName}</span><button onClick={onClearParent} className="text-gray-300 hover:text-gray-500 ml-0.5"><X size={9} /></button></span>}
        </div>
        <button onClick={() => { fullReset(); setOpen(false); }} className="w-5 h-5 rounded-lg flex items-center justify-center hover:bg-black/5 text-gray-400 hover:text-gray-600 transition-colors"><X size={11} /></button>
      </div>
      <div className="p-3 space-y-2.5 bg-white">
        <div className="flex items-center gap-2">
          <div className="relative">
<input ref={codeInputRef} type="text" value={code} onChange={e => { setCode(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { fullReset(); setOpen(false); } }} placeholder={t("am_code")} className="w-24 px-3 py-2 rounded-lg text-[11px] font-mono bg-gray-50 border border-gray-200 outline-none transition-all placeholder:text-gray-300" style={{ focusBorderColor: accent }} onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
          </div>
          <input type="text" value={name} onChange={e => { setName(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { fullReset(); setOpen(false); } }} placeholder={t("am_account_name")} className="flex-1 min-w-0 px-3 py-2 rounded-lg text-xs bg-gray-50 border border-gray-200 outline-none transition-all placeholder:text-gray-300" onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <div onClick={() => setIsSum(s => !s)} className="w-4 h-4 rounded-md flex items-center justify-center transition-all flex-shrink-0 shadow-sm" style={{ border: `2px solid ${isSum ? accent : '#e5e7eb'}`, backgroundColor: isSum ? accent : 'white' }}>{isSum && <Check size={9} className="text-white" strokeWidth={3} />}</div>
<span className="text-[11px] text-gray-500 font-medium group-hover:text-gray-700 transition-colors">{t("am_sum_total_row")}</span>
          </label>
          <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider text-white transition-all hover:opacity-90 active:scale-95 shadow-sm" style={{ backgroundColor: accent }}>{t("am_btn_add")}</button>
        </div>
        {error && <p className="text-[10px] text-red-400 font-medium flex items-center gap-1"><span>⚠</span>{error}</p>}
      </div>
    </div>
  );
}

// ─── AddBreakerForm ───────────────────────────────────────────
function AddBreakerForm({ accent, open, onOpen, onClose, onAdd }) {
  const t = useT();
  const [name, setName] = useState(""), [color, setColor] = useState("#1a2f8a"), [error, setError] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  const PRESET_COLORS = ["#1a2f8a","#CF305D","#374151","#57aa78","#dc7533","#7c3aed","#0891b2","#ca8a04"];
  const reset = () => { setName(""); setColor("#1a2f8a"); setError(null); };
const handleSubmit = () => { const trimmed = name.trim(); if (!trimmed) { setError(t("am_err_name_required")); return; } onAdd({ name: trimmed.toUpperCase(), color }); reset(); onClose(); };
if (!open) return (
    <button onClick={onOpen} className="group flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl border border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 text-gray-400 hover:text-gray-500 text-xs font-semibold transition-all w-full justify-center">
      <Plus size={11} /><span>{t("am_add_breaker")}</span>
    </button>
  );
  return (
    <div className="mb-3 rounded-xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${accent}30` }}>
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: `${accent}08` }}>
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accent }}>{t("am_new_breaker")}</span>
        <button onClick={() => { reset(); onClose(); }} className="w-5 h-5 rounded-lg flex items-center justify-center hover:bg-black/5 text-gray-400 hover:text-gray-600 transition-colors"><X size={11} /></button>
      </div>
      <div className="p-3 space-y-2.5 bg-white">
        <input ref={inputRef} type="text" value={name} onChange={e => { setName(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { reset(); onClose(); } }} placeholder={t("am_breaker_placeholder")} className="w-full px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest bg-gray-50 border border-gray-200 outline-none transition-all placeholder:text-gray-300 placeholder:normal-case placeholder:tracking-normal placeholder:font-normal" onFocus={e => e.target.style.borderColor = accent} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-medium flex-shrink-0">{t("am_color")}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} className="w-5 h-5 rounded-md transition-all hover:scale-110" style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : 'none', transform: color === c ? 'scale(1.15)' : 'scale(1)' }} />
            ))}
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-5 h-5 rounded-md cursor-pointer border-0 p-0 bg-transparent" style={{ appearance: 'none' }} title={t("am_custom_color")} />
          </div>
        </div>
        <div className="flex items-center gap-2">
<div className="flex-1 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-white truncate transition-colors" style={{ backgroundColor: color }}>{name.trim() || t("am_preview")}</div>
          <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider text-white transition-all hover:opacity-90 active:scale-95 shadow-sm flex-shrink-0" style={{ backgroundColor: accent }}>{t("am_btn_add")}</button>
        </div>
        {error && <p className="text-[10px] text-red-400 font-medium flex items-center gap-1"><span>⚠</span>{error}</p>}
      </div>
    </div>
  );
}

// ─── SaveMappingForm ──────────────────────────────────────────
function SaveMappingForm({ name, setName, description, setDescription, error, onSave, onCancel, saving, asNew, accent }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
      <div className="relative w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}
        style={{ borderRadius: 20, background: "white", boxShadow: "0 32px 80px -12px rgba(0,0,0,0.35)", border: "none", outline: "none" }}>
        
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 overflow-hidden" style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)` }}>
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 60%)" }} />
          <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full opacity-10" style={{ background: "white" }} />
          <div className="relative">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </div>
<p className="text-white font-black text-lg leading-tight">{asNew ? t("am_save_form_save_new") : t("am_save_form_save")}</p>
            <p className="text-white/60 text-[11px] mt-0.5">{t("am_save_form_subtitle")}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">{t("am_save_form_name_label")}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("am_save_form_name_placeholder")} autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-gray-800 outline-none transition-all placeholder:text-gray-300"
              style={{ background: "#f8f9ff", border: "1.5px solid #eef1fb" }}
              onFocus={e => { e.target.style.borderColor = accent; e.target.style.background = "white"; e.target.style.boxShadow = `0 0 0 3px ${accent}15`; }}
              onBlur={e => { e.target.style.borderColor = "#eef1fb"; e.target.style.background = "#f8f9ff"; e.target.style.boxShadow = "none"; }}
              onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }} />
          </div>
          <div className="space-y-1.5">
<label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">{t("am_save_form_desc_label")} <span className="text-gray-300 font-normal normal-case tracking-normal">· {t("am_save_form_optional")}</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("am_save_form_desc_placeholder")} rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-gray-800 outline-none transition-all resize-none placeholder:text-gray-300"
              style={{ background: "#f8f9ff", border: "1.5px solid #eef1fb" }}
              onFocus={e => { e.target.style.borderColor = accent; e.target.style.background = "white"; e.target.style.boxShadow = `0 0 0 3px ${accent}15`; }}
              onBlur={e => { e.target.style.borderColor = "#eef1fb"; e.target.style.background = "#f8f9ff"; e.target.style.boxShadow = "none"; }} />
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              <p className="text-xs text-red-500 font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
<button onClick={onCancel} disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
              {t("am_btn_cancel")}
            </button>
            <button onClick={onSave} disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-40 hover:opacity-90 active:scale-[0.98]"
              style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}dd 100%)`, boxShadow: `0 4px 14px -4px ${accent}60` }}>
              {saving ? t("am_saving") : t("am_btn_save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel / PanelToolbar / EmptyPanelState ───────────────────
function Panel({ title, subtitle, accent, onExpandAll, onCollapseAll, isExpanded, extra, children }) {
  const t = useT();
  return (
    <div className="bg-white rounded-2xl border border-gray-100 flex flex-col overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-shrink-0" style={{ backgroundColor: `${accent}06` }}>
        <div className="w-[3px] h-9 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 min-w-0">
          <p className="font-black text-[13px] leading-tight" style={{ color: accent }}>{title}</p>
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-[0.12em] mt-0.5">{subtitle}</p>
        </div>
        {extra && <div className="flex-shrink-0 flex items-center">{extra}</div>}
        <button onClick={isExpanded ? onCollapseAll : onExpandAll}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
          style={{ background: `${accent}10`, color: accent }}
          title={isExpanded ? t("am_collapse_all") : t("am_expand_all")}>
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
// eslint-disable-next-line react-refresh/only-export-components
export function normalizeMappingStandard(std) {
  if (!std) return null;
  if (STANDARD_META[std]) return std;           // already a valid STANDARD_META key
  if (std === "SpanishIFRS-ES") return "SpanishIFRS"; // KPI resolver → mapper name
  return null;
}

export function MappingsModal({ open, onClose, groupAccounts = [], dimensions = [], token, initialStandard = null }) {
  if (!open) return null;
  const std = normalizeMappingStandard(initialStandard);
  return (
    <div className="fixed inset-0 z-[480] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl overflow-hidden flex flex-col"
        style={{ width: "95vw", height: "90vh", boxShadow: "0 32px 80px -12px rgba(0,0,0,0.4)" }}
        onClick={e => e.stopPropagation()}
      >
<StructureMappingsView
          groupAccounts={groupAccounts}
          dimensions={dimensions}
          search=""
          setSearch={() => {}}
          colors={{}}
          token={token}
          onBack={onClose}
          mappingKind="structure"
          initialView={std ? "mapper" : "list"}
          initialStandard={std}
        />
      </div>
    </div>
  );
}