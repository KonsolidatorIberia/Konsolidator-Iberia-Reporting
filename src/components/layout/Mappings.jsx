import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X, Plus, Search, Layers, FilePlus, Library, ChevronLeft,
  ChevronDown, ChevronRight,
  Calendar, User, Clock, FileText, Sparkles, ArrowRightLeft,
  CheckCircle2, Pencil, Trash2, Check,
} from "lucide-react";
import { useSettings } from "./SettingsContext.jsx";

/* ═══════════════════════════════════════════════════════════════
   MAPPINGS MODAL
   ───────────────────────────────────────────────────────────────
   Internal views:
     1. "list"           → library of saved mappings + "Create new"
     2. "create"          → choose creation method (scratch / existing)
     3. "selectStandard"  → pick PGC / SpanishIFRS / DanishIFRS card
     4. "mapper"          → split-screen with hierarchical trees both sides

   Visual only — no save/load/match/drag logic yet.
═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = {
  apikey: SUPABASE_APIKEY,
  Authorization: `Bearer ${SUPABASE_APIKEY}`,
};

/* ═══════════════════════════════════════════════════════════════
   FIELD ACCESSOR (case-insensitive)
═══════════════════════════════════════════════════════════════ */
function normalizeKey(str) {
  return String(str).replace(/[_\s-]/g, "").toLowerCase();
}
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

/* ═══════════════════════════════════════════════════════════════
   CLIENT TREE BUILDER
   Mini-version of buildTree from IndividualesPage — structure only,
   no uploaded amounts / leaves. Uses accountCode + sumAccountCode
   to build the parent-child hierarchy.
═══════════════════════════════════════════════════════════════ */
function buildClientTree(groupAccounts) {
  if (!groupAccounts || !groupAccounts.length) return [];
  const byCode = new Map();
  groupAccounts.forEach(ga => {
    const code = String(getField(ga, "accountCode") ?? "");
    if (code) byCode.set(code, ga);
  });

  const childrenOf = new Map();
  const roots = [];
  groupAccounts.forEach(ga => {
    const code = String(getField(ga, "accountCode") ?? "");
    const parent = String(getField(ga, "sumAccountCode") ?? "");
    if (!code) return;
    if (!byCode.has(parent) || parent === code) {
      roots.push(ga);
    } else {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(ga);
    }
  });

  const numSort = (a, b) =>
    String(getField(a, "accountCode") ?? "").localeCompare(
      String(getField(b, "accountCode") ?? ""), undefined, { numeric: true }
    );
  childrenOf.forEach(arr => arr.sort(numSort));
  roots.sort(numSort);

  function makeNode(ga) {
    const code = String(getField(ga, "accountCode") ?? "");
    const children = (childrenOf.get(code) || []).map(makeNode);
    return {
      code,
      name: String(getField(ga, "accountName") ?? ""),
      accountType: String(getField(ga, "accountType") ?? ""),
      isSumAccount: !!getField(ga, "isSumAccount"),
      level: Number(getField(ga, "level") ?? 0),
      children,
    };
  }
  return roots.map(makeNode);
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE TREE BUILDER
   Builds tree from flat template_rows using parent_code.
═══════════════════════════════════════════════════════════════ */
function buildTemplateTree(rows, sections = []) {
  if (!rows || !rows.length) return [];
  const normalize = (v) => v == null ? null : String(v).replace(/\.0+$/, "");

  const soSort = (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);

  // Build a parent → children index, scoped to a given subset of rows.
  // Rows whose parent isn't in the subset become roots within that subset.
  function buildHierarchy(subsetRows) {
    const subsetCodes = new Set(subsetRows.map(r => normalize(r.account_code)));
    const childrenOf = new Map();
    const localRoots = [];
    subsetRows.forEach(r => {
      const code = normalize(r.account_code);
      const parent = normalize(r.parent_code);
      if (!parent || !subsetCodes.has(parent)) {
        localRoots.push(r);
      } else {
        if (!childrenOf.has(parent)) childrenOf.set(parent, []);
        childrenOf.get(parent).push(r);
      }
    });
    childrenOf.forEach(arr => arr.sort(soSort));
    localRoots.sort(soSort);

    function makeNode(r) {
      const code = String(r.account_code);
      const children = (childrenOf.get(normalize(code)) || []).map(makeNode);
      return {
        kind: "row",
        code,
        name: r.account_name,
        isSum: !!r.is_sum_account,
        showInSummary: !!r.show_in_summary,
        sectionCode: r.section_code,
        level: Number(r.level ?? 0),
        sortOrder: Number(r.sort_order ?? 0),
        children,
      };
    }
    return localRoots.map(makeNode);
  }

  // No sections: just build a single tree with the whole row set
  if (!sections.length) return buildHierarchy(rows);

  const sortedSections = [...sections].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  // Group rows by their section_code
  const rowsBySection = new Map();
  const rowsNoSection = [];
  rows.forEach(r => {
    if (r.section_code) {
      if (!rowsBySection.has(r.section_code)) rowsBySection.set(r.section_code, []);
      rowsBySection.get(r.section_code).push(r);
    } else {
      rowsNoSection.push(r);
    }
  });

  // For each breaker, build the hierarchy from just the rows in its section
  const result = [];
  sortedSections.forEach(s => {
    const sectionRows = rowsBySection.get(s.section_code) || [];
    const breakerNode = {
      kind: "breaker",
      code: `__breaker__${s.section_code}`,
      sectionCode: s.section_code,
      name: s.label,
      color: s.color,
      children: buildHierarchy(sectionRows),
    };
    result.push(breakerNode);
  });

  // Rows with no section_code go at the end as a flat list
  if (rowsNoSection.length > 0) {
    result.push(...buildHierarchy(rowsNoSection));
  }

  return result;
}

/* ═══════════════════════════════════════════════════════════════
   STANDARD DETECTION (mirrors IndividualesPage logic)
═══════════════════════════════════════════════════════════════ */
function detectStandard(groupAccounts = []) {
  if (!groupAccounts.length) return null;
  const codes = groupAccounts.map(n => String(n.accountCode ?? n.AccountCode ?? ""));
  const isPGC = codes.some(c => /[a-zA-Z]/.test(c) && c.endsWith(".S"));
  if (isPGC) return "PGC";
  const isSpanishIfrsEs = codes.some(c => /\.PL$/.test(c));
  if (isSpanishIfrsEs) return "SpanishIFRS";
  const isDanish = codes.some(c => /^\d{5,6}$/.test(c));
  if (isDanish) return "DanishIFRS";
  return null;
}

const STANDARD_META = {
  PGC: {
    label: "PGC",
    full: "Plan General Contable",
    description: "Estándar contable español oficial. Códigos alfanuméricos como A.01.S, A.04.D.",
    accent: "#1a2f8a",
    accentBg: "#eef1fb",
  },
  SpanishIFRS: {
    label: "Spanish IFRS",
    full: "IFRS Españolizado",
    description: "Adaptación española del estándar internacional IFRS. Códigos terminados en .PL.",
    accent: "#dc7533",
    accentBg: "#fef3c7",
  },
  DanishIFRS: {
    label: "Danish IFRS",
    full: "Danish IFRS",
    description: "Adaptación danesa del estándar internacional IFRS. Códigos numéricos de 5-6 dígitos.",
    accent: "#57aa78",
    accentBg: "#dcfce7",
  },
};

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
import {
  listMappings, getMapping, createMapping, updateMapping, archiveMapping,
  getActiveCompanyId,
} from "../../lib/mappingsApi";
import { supabase } from "../../lib/supabaseClient";

// ⬆️ Add these imports at the top of Mappings.jsx, alongside the other imports.
// (Keep the existing imports — don't replace them.)

export default function MappingsModal({ open, onClose, groupAccounts = [], onApply }) {
  const { colors } = useSettings();
  const [view, setView] = useState("list");
  const [search, setSearch] = useState("");
  const [selectedStandard, setSelectedStandard] = useState(null);

  // Active session context — used for save/load + RLS scoping
  const [authUserId, setAuthUserId] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  // When non-null, we're editing an existing mapping (vs creating new)
  const [editingMapping, setEditingMapping] = useState(null);

  // Resolve auth user + company on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setAuthUserId(uid);
      if (uid) {
        const cid = await getActiveCompanyId(uid);
        setCompanyId(cid);
      }
    })();
  }, [open]);

  // Load mappings whenever we land on the list view and have a company
  useEffect(() => {
    if (view !== "list" || !companyId) return;
    setMappingsLoading(true);
    listMappings({ companyId })
      .then(rows => setMappings(rows))
      .finally(() => setMappingsLoading(false));
  }, [view, companyId]);

  const detectedStandard = useMemo(
    () => detectStandard(groupAccounts),
    [groupAccounts]
  );


  if (!open) return null;

  const handleClose = () => {
    setView("list");
    setSearch("");
    setSelectedStandard(null);
    onClose?.();
  };

  const isMapper = view === "mapper";
  const modalSize = isMapper
    ? { maxWidth: "115rem", height: "92vh" }
    : { maxWidth: "72rem", height: "85vh" };

  const headerConfig = {
    list: {
      icon: Library,
      title: "Mappings library",
      subtitle: "Saved views and custom mappings",
      back: null,
    },
    create: {
      icon: Plus,
      title: "Create new mapping",
      subtitle: "Choose how you want to start",
      back: () => setView("list"),
    },
    selectStandard: {
      icon: Sparkles,
      title: "Select an existing structure",
      subtitle: "Pick the standard that fits your accounts",
      back: () => setView("create"),
    },
    mapper: {
      icon: ArrowRightLeft,
      title: selectedStandard
        ? `Mapping to ${STANDARD_META[selectedStandard]?.full}`
        : "Mapper",
      subtitle: "Match your accounts to the standard structure",
      back: () => setView("selectStandard"),
    },
  };
  const cfg = headerConfig[view];
  const HeaderIcon = cfg.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative bg-white rounded-2xl w-full overflow-hidden flex flex-col"
        style={{
          ...modalSize,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-8 py-5 flex items-center justify-between flex-shrink-0"
          style={{ backgroundColor: colors.primary ?? "#1a2f8a" }}
        >
          <div className="flex items-center gap-3">
            {cfg.back && (
              <button
                onClick={cfg.back}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all"
                title="Back"
              >
                <ChevronLeft size={15} className="text-white/80" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <HeaderIcon size={16} className="text-white/80" />
            </div>
            <div>
              <p
                className="font-black text-base"
                style={{ color: colors.quaternary ?? "#F59E0B" }}
              >
                {cfg.title}
              </p>
              <p className="text-white/50 text-[10px] font-medium tracking-wider uppercase mt-0.5">
                {cfg.subtitle}
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all"
          >
            <X size={15} className="text-white/80" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
{view === "list" && (
  <ListView
    mappings={mappings}
    loading={mappingsLoading}
    search={search}
    setSearch={setSearch}
    onCreate={() => { setEditingMapping(null); setView("create"); }}
    onOpen={(m) => {
      setEditingMapping(m);
      setSelectedStandard(m.standard);
      setView("mapper");
    }}
    onApply={(m) => { onApply?.(m); handleClose(); }}
    onArchive={async (m) => {
                if (!window.confirm(`Archive "${m.name}"? You can restore it later.`)) return;
                await archiveMapping({ mappingId: m.mapping_id, userId: authUserId });
                // Refresh
                const rows = await listMappings({ companyId });
                setMappings(rows);
              }}
            />
          )}
          {view === "create" && (
            <CreateView
              onScratch={() => console.log("Create from scratch — TODO")}
              onExisting={() => setView("selectStandard")}
              onCancel={() => setView("list")}
            />
          )}
          {view === "selectStandard" && (
            <SelectStandardView
              detectedStandard={detectedStandard}
              onPick={(std) => {
                setSelectedStandard(std);
                setView("mapper");
              }}
            />
          )}
{view === "mapper" && selectedStandard && (
            <MapperView
              standard={selectedStandard}
              groupAccounts={groupAccounts}
              authUserId={authUserId}
              companyId={companyId}
              editingMapping={editingMapping}
              onSaved={(saved) => {
                setEditingMapping(saved);
              }}
              onBackToList={() => {
                setEditingMapping(null);
                setSelectedStandard(null);
                setView("list");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIEW 1: LIST
═══════════════════════════════════════════════════════════════ */
function ListView({ mappings, loading, search, setSearch, onCreate, onOpen, onApply, onArchive }) {
  const filtered = search.trim()
    ? mappings.filter((m) =>
        String(m.mapping_name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : mappings;

  return (
    <div className="p-8 space-y-6 overflow-y-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[#eef1fb] text-[#1a2f8a]">
          <Layers size={12} />
          {mappings.length} {mappings.length === 1 ? "mapping" : "mappings"}
        </div>

        {search && filtered.length !== mappings.length && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">
            {filtered.length} matching
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
            <Search size={13} className="text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mappings…"
              className="text-xs outline-none text-gray-700 w-48 bg-transparent placeholder:text-gray-300"
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X size={12} className="text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>

          <button
            onClick={onCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a2f8a] hover:bg-[#1a2f8a]/90 text-white text-xs font-black transition-all shadow-md shadow-[#1a2f8a]/20"
          >
            <Plus size={14} />
            Create new mapping
          </button>
        </div>
      </div>

{loading ? (
        <div className="text-center py-20 text-xs text-gray-400">Loading mappings…</div>
      ) : filtered.length === 0 ? (
        <EmptyLibrary onCreate={onCreate} hasSearch={!!search.trim()} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
{filtered.map((m) => (
  <MappingCard key={m.mapping_id} mapping={m} onOpen={onOpen} onApply={onApply} onArchive={onArchive} />
))}
        </div>
      )}
    </div>
  );
}

function EmptyLibrary({ onCreate, hasSearch }) {
  return (
    <div className="bg-gradient-to-br from-[#f8f9ff] to-white rounded-2xl border border-gray-100 p-16 text-center">
      <div className="w-16 h-16 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Library size={28} className="text-[#1a2f8a]" />
      </div>
      <p className="text-gray-700 font-black text-base mb-2">
        {hasSearch ? "No mappings match your search" : "No mappings yet"}
      </p>
      <p className="text-gray-400 text-xs mb-6 max-w-sm mx-auto leading-relaxed">
        {hasSearch
          ? "Try a different search term or clear the search to see all mappings."
          : "Create your first mapping to start customizing how your accounts are organized and displayed."}
      </p>
      {!hasSearch && (
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1a2f8a] hover:bg-[#1a2f8a]/90 text-white text-xs font-black transition-all shadow-md shadow-[#1a2f8a]/20"
        >
          <Plus size={14} />
          Create your first mapping
        </button>
      )}
    </div>
  );
}

function MappingCard({ mapping, onOpen, onApply, onArchive }) {
  const standardMeta = STANDARD_META[mapping.standard];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#1a2f8a]/30 hover:shadow-lg transition-all group flex flex-col">
      {/* Body (clickable to edit) */}
      <div className="cursor-pointer flex-1" onClick={() => onOpen?.(mapping)}>
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ backgroundColor: standardMeta?.accentBg ?? "#eef1fb" }}
          >
            <FileText size={16} style={{ color: standardMeta?.accent ?? "#1a2f8a" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm text-gray-800 truncate">
              {mapping.name ?? "Untitled"}
            </p>
            <p
              className="text-[10px] font-bold uppercase tracking-widest mt-0.5"
              style={{ color: standardMeta?.accent ?? "#1a2f8a" }}
            >
              {standardMeta?.label ?? mapping.standard}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive?.(mapping); }}
            className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"
            title="Archive"
          >
            <Trash2 size={11} />
          </button>
        </div>

        {mapping.description && (
          <p className="text-[11px] text-gray-500 mb-3 line-clamp-2">{mapping.description}</p>
        )}
      </div>

      {/* Footer: date on left, Apply on right */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-50">
        <div className="flex items-center gap-2 text-[11px] text-gray-500 min-w-0">
          <Clock size={11} className="text-gray-300 flex-shrink-0" />
          <span className="truncate">
            Updated {new Date(mapping.updated_at).toLocaleDateString()}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onApply?.(mapping); }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm transition-all flex-shrink-0"
          title="Apply this mapping to the current page"
        >
          <CheckCircle2 size={10} />
          Apply
        </button>
      </div>
</div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIEW 2: CREATE (choose method)
═══════════════════════════════════════════════════════════════ */
function CreateView({ onScratch, onExisting, onCancel }) {
  return (
    <div className="p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-gray-700 font-black text-lg mb-2">
            How would you like to start?
          </p>
          <p className="text-gray-400 text-xs max-w-md mx-auto">
            Build a mapping from the ground up, or take an existing structure
            as a starting point.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <CreateCard
            icon={FilePlus}
            iconBg="#eef1fb"
            iconColor="#1a2f8a"
            title="Create from scratch"
            description="Start with a blank mapping and build your structure row by row. Full control over hierarchy, sections, and KPIs."
            features={[
              "Define your own row hierarchy",
              "Add custom section breakers",
              "Mark KPI rows manually",
            ]}
            onClick={onScratch}
          />

          <CreateCard
            icon={Library}
            iconBg="#fef3c7"
            iconColor="#dc7533"
            title="From existing structure"
            description="Use one of the standard structures (PGC, Spanish IFRS, Danish IFRS) as your base and customize it to fit your needs."
            features={[
              "Reorder and hide rows",
              "Customize section breakers",
              "Keep underlying mapping intact",
            ]}
            onClick={onExisting}
          />
        </div>

        <div className="text-center mt-8">
          <button
            onClick={onCancel}
            className="text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
          >
            Cancel and go back
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateCard({ icon: Icon, iconBg, iconColor, title, description, features, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-2xl border-2 border-gray-100 p-6 hover:border-[#1a2f8a] hover:shadow-xl transition-all group"
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110"
        style={{ backgroundColor: iconBg }}
      >
        <Icon size={24} style={{ color: iconColor }} />
      </div>

      <p className="font-black text-base text-gray-800 mb-2">{title}</p>
      <p className="text-xs text-gray-500 leading-relaxed mb-5">{description}</p>

      <div className="space-y-2 pt-4 border-t border-gray-50">
        {features.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: iconColor }} />
            <span className="text-[11px] text-gray-600 font-medium">{f}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-gray-50">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: iconColor }}>
          Continue →
        </span>
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIEW 3: SELECT STANDARD
═══════════════════════════════════════════════════════════════ */
function SelectStandardView({ detectedStandard, onPick }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${SUPABASE_URL}/template_catalog?select=*&active=eq.true`, { headers: sbHeaders })
      .then(r => r.json())
      .then(rows => { if (Array.isArray(rows)) setCatalog(rows); })
      .catch(() => setCatalog([]))
      .finally(() => setLoading(false));
  }, []);

  const standardsAvailable = useMemo(() => {
    const set = new Set(catalog.map(c => c.standard));
    return ["PGC", "SpanishIFRS", "DanishIFRS"].filter(s => set.has(s));
  }, [catalog]);

  return (
    <div className="p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-gray-700 font-black text-lg mb-2">
            Choose a standard structure
          </p>
          <p className="text-gray-400 text-xs max-w-md mx-auto">
            {detectedStandard ? (
              <>We detected <strong className="text-[#1a2f8a]">{STANDARD_META[detectedStandard]?.label}</strong> in your accounts. It's recommended.</>
            ) : (
              "We couldn't auto-detect your accounting standard. Pick the one that matches."
            )}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-16 text-xs text-gray-400">Loading templates…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {standardsAvailable.map(std => (
              <StandardCard
                key={std}
                meta={STANDARD_META[std]}
                isRecommended={detectedStandard === std}
                onClick={() => onPick(std)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StandardCard({ meta, isRecommended, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-2xl p-6 transition-all relative group
        ${isRecommended
          ? "border-2 shadow-xl"
          : "border-2 border-gray-100 hover:border-gray-300 hover:shadow-lg"
        }`}
      style={isRecommended ? { borderColor: meta.accent } : {}}
    >
      {isRecommended && (
        <div
          className="absolute -top-3 left-6 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-white shadow-md"
          style={{ backgroundColor: meta.accent }}
        >
          <Sparkles size={10} />
          Recommended
        </div>
      )}

      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110"
        style={{ backgroundColor: meta.accentBg }}
      >
        <Library size={24} style={{ color: meta.accent }} />
      </div>

      <p className="font-black text-base text-gray-800 mb-1">{meta.label}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: meta.accent }}>
        {meta.full}
      </p>
      <p className="text-xs text-gray-500 leading-relaxed mb-5">{meta.description}</p>

      <div className="pt-4 border-t border-gray-50 flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
          P&L + Balance Sheet
        </span>
        <span
          className="text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: meta.accent }}
        >
          Continue →
        </span>
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIEW 4: MAPPER (split-screen with drag-and-drop)
   ───────────────────────────────────────────────────────────────
   Both panels operate on local state. Dragging a row copies it
   (with descendants) to the destination. Dropped rows are checked
   for duplicate account names; user is prompted to keep both,
   replace existing, or discard the imported subtree.
═══════════════════════════════════════════════════════════════ */

function normalizeName(s) {
  return String(s ?? "").trim().toLowerCase();
}

// Collect all names (recursive) from a subtree
function collectNames(node) {
  const out = new Set();
  function walk(n) {
    out.add(normalizeName(n.name));
    (n.children || []).forEach(walk);
  }
  walk(node);
  return out;
}

// Collect all names (recursive) from a tree (array of nodes)
function collectNamesFromTree(tree) {
  const out = new Set();
  function walk(nodes) {
    nodes.forEach(n => {
      out.add(normalizeName(n.name));
      walk(n.children || []);
    });
  }
  walk(tree);
  return out;
}

// Find duplicate names between an incoming subtree and a destination tree
function findDuplicates(incomingNode, destinationTree) {
  const incoming = collectNames(incomingNode);
  const existing = collectNamesFromTree(destinationTree);
  const dups = [];
  incoming.forEach(name => { if (existing.has(name)) dups.push(name); });
  return dups;
}

// Deep-clone a node, normalizing into a uniform shape with a unique id
let __dropCounter = 0;
function cloneSubtree(node, sourceSide) {
  __dropCounter++;
  return {
    id: `imp-${sourceSide}-${node.code}-${Date.now()}-${__dropCounter}`,
    code: node.code,
    name: node.name,
    sourceSide,                                  // "client" | "template"
    sectionCode: node.sectionCode ?? null,
    isSum: node.isSum ?? node.isSumAccount ?? false,
    isSumAccount: node.isSumAccount ?? node.isSum ?? false,
    accountType: node.accountType ?? null,
    showInSummary: node.showInSummary ?? false,
    children: (node.children || []).map(c => cloneSubtree(c, sourceSide)),
  };
}

// Walk a tree, applying a transform that may return: same node, modified node, or null (delete)
function walkTransform(tree, fn) {
  const out = [];
  for (const n of tree) {
    const transformed = fn(n);
    if (transformed === null) continue;
    out.push({
      ...transformed,
      children: walkTransform(transformed.children || [], fn),
    });
  }
  return out;
}

// Remove all nodes (recursive) whose name (normalized) is in the given set
function removeByNames(tree, namesSet) {
  return walkTransform(tree, (n) => {
    if (namesSet.has(normalizeName(n.name))) return null;
    return n;
  });
}

// Insert a node into a tree at a target location.
// position: "before" | "after" | "inside"
function insertAt(tree, targetId, position, newNode) {
  if (position === "inside") {
    return walkTransform(tree, (n) => {
      if (n.id === targetId || n.code === targetId) {
        return { ...n, children: [...(n.children || []), newNode] };
      }
      return n;
    });
  }

  // before/after: walk and splice
  function walk(nodes) {
    const out = [];
    for (const n of nodes) {
      const isTarget = n.id === targetId || n.code === targetId;
      if (isTarget && position === "before") out.push(newNode);
      out.push({ ...n, children: walk(n.children || []) });
      if (isTarget && position === "after") out.push(newNode);
    }
    return out;
  }
  return walk(tree);
}

// Append to root level
function appendToRoot(tree, newNode) {
  return [...tree, newNode];
}

// Find a node by id (or code as fallback) in a tree
function findNodeById(tree, targetId) {
  for (const n of tree) {
    if (n.id === targetId || n.code === targetId) return n;
    const found = findNodeById(n.children || [], targetId);
    if (found) return found;
  }
  return null;
}

// Check if `targetId` is a descendant of `ancestorId` — prevents dropping a node into itself
function isDescendantOf(tree, ancestorId, targetId) {
  if (!targetId) return false;
  const ancestor = findNodeById(tree, ancestorId);
  if (!ancestor) return false;
  return findNodeById(ancestor.children || [], targetId) !== null;
}

// Rename a node by id-or-code
function renameNode(tree, targetId, newName) {
  return walkTransform(tree, (n) => {
    if (n.id === targetId || n.code === targetId) {
      return { ...n, name: newName };
    }
    return n;
  });
}

// Delete a node by id-or-code (cascade — removes all descendants too)
function deleteNode(tree, targetId) {
  return walkTransform(tree, (n) => {
    if (n.id === targetId || n.code === targetId) return null;
    return n;
  });
}

function MapperView({ standard, groupAccounts, authUserId, companyId, editingMapping, onSaved, onBackToList }) {
  const meta = STANDARD_META[standard];
  const [statement, setStatement] = useState("PL");
const [tplRows, setTplRows] = useState([]);
  const [tplSections, setTplSections] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  // Tracks which statement the currently-loaded tplRows actually belong to
  const [tplStatement, setTplStatement] = useState(null);

  // Editable working trees (per-statement so PL/BS toggle preserves state)
  const [clientTreeBy, setClientTreeBy] = useState({ PL: null, BS: null });
  const [templateTreeBy, setTemplateTreeBy] = useState({ PL: null, BS: null });

  // Track which IDs/codes have been moved (for highlighting source rows)
  const [movedClientIds, setMovedClientIds] = useState(() => new Set());
  const [movedTemplateIds, setMovedTemplateIds] = useState(() => new Set());

  // Conflict modal state
  const [conflict, setConflict] = useState(null); // { duplicates, onResolve }

// Fetch template — only refetch if we don't already have data for this statement
  useEffect(() => {
    const ac = new AbortController();
    const reqStandard = standard;
    const reqStatement = statement;

    // Skip fetch entirely if user already has working data for this statement
    if (templateTreeBy[reqStatement]) {
      return;
    }

    setTplLoading(true);
    setTplRows([]);
    setTplSections([]);
    setTplStatement(null);

    (async () => {
      try {
        const [rowsRes, secsRes] = await Promise.all([
          fetch(
            `${SUPABASE_URL}/template_rows?select=*&standard=eq.${reqStandard}&statement=eq.${reqStatement}&order=sort_order.asc`,
            { headers: sbHeaders, signal: ac.signal }
          ),
          fetch(
            `${SUPABASE_URL}/template_sections?select=*&standard=eq.${reqStandard}&statement=eq.${reqStatement}&order=sort_order.asc`,
            { headers: sbHeaders, signal: ac.signal }
          ),
        ]);
        const rows = await rowsRes.json();
        const secs = await secsRes.json();

        if (ac.signal.aborted) return;

        const cleanRows = Array.isArray(rows)
          ? rows.filter(r => r.statement === reqStatement && r.standard === reqStandard)
          : [];
        const cleanSecs = Array.isArray(secs)
          ? secs.filter(s => s.statement === reqStatement && s.standard === reqStandard)
          : [];

console.log(`[Mappings] Loaded ${cleanRows.length} ${reqStatement} rows for ${reqStandard}`);

        setTplRows(cleanRows);
        setTplSections(cleanSecs);
        setTplStatement(reqStatement);
      } catch (e) {
        if (e.name === "AbortError") return;
        console.error("[Mappings] fetch failed", e);
        setTplRows([]);
        setTplSections([]);
      } finally {
        if (!ac.signal.aborted) setTplLoading(false);
      }
    })();

    return () => ac.abort();
  }, [standard, statement]);

  // Build base client tree, filtered by statement
  const baseClientTree = useMemo(() => {
    if (!groupAccounts.length) return [];
    const tree = buildClientTree(groupAccounts);
    const filterFn = statement === "PL"
      ? (n) => ["P/L", "DIS"].includes(n.accountType)
      : (n) => n.accountType === "B/S";
    // Add unique ids to client nodes for drag identification
    function addIds(nodes) {
      return nodes.map(n => ({
        ...n,
        id: `cli-${n.code}`,
        children: addIds(n.children || []),
      }));
    }
    return addIds(tree.filter(filterFn));
  }, [groupAccounts, statement]);

// Build base template tree — only when tplRows match the current statement
  const baseTemplateTree = useMemo(() => {
    if (tplStatement !== statement) return [];
    const tree = buildTemplateTree(tplRows, tplSections);
    function addIds(nodes) {
      return nodes.map(n => ({
        ...n,
        id: `tpl-${n.code}`,
        children: addIds(n.children || []),
      }));
    }
    return addIds(tree);
  }, [tplRows, tplSections, tplStatement, statement]);

// Reset working trees when standard changes
  useEffect(() => {
    setClientTreeBy({ PL: null, BS: null });
    setTemplateTreeBy({ PL: null, BS: null });
    setMovedClientIds(new Set());
    setMovedTemplateIds(new Set());
  }, [standard]);

  // If opening an existing mapping, hydrate the template tree from saved JSON
  useEffect(() => {
    if (!editingMapping) return;
    setTemplateTreeBy({
      PL: Array.isArray(editingMapping.pl_tree) ? editingMapping.pl_tree : [],
      BS: Array.isArray(editingMapping.bs_tree) ? editingMapping.bs_tree : [],
    });
  }, [editingMapping]);

  // Initialize working trees once bases are populated for a statement
  useEffect(() => {
    if (baseClientTree.length > 0) {
      setClientTreeBy(prev => prev[statement] ? prev : { ...prev, [statement]: baseClientTree });
    }
  }, [baseClientTree, statement]);

  useEffect(() => {
    if (baseTemplateTree.length > 0) {
      setTemplateTreeBy(prev => prev[statement] ? prev : { ...prev, [statement]: baseTemplateTree });
    }
  }, [baseTemplateTree, statement]);

  const clientTree = clientTreeBy[statement] ?? baseClientTree;
  const templateTree = templateTreeBy[statement] ?? baseTemplateTree;

  const sectionByCode = useMemo(() => {
    const m = new Map();
    tplSections.forEach(s => m.set(s.section_code, { label: s.label, color: s.color }));
    return m;
  }, [tplSections]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [currentName, setCurrentName] = useState(editingMapping?.name ?? "");
  const [currentDescription, setCurrentDescription] = useState(editingMapping?.description ?? "");

  // Sync local form when editingMapping changes
  useEffect(() => {
    setCurrentName(editingMapping?.name ?? "");
    setCurrentDescription(editingMapping?.description ?? "");
  }, [editingMapping]);

  const handleSave = async ({ asNew = false } = {}) => {
    if (!companyId || !authUserId) {
      setSaveError("Not authenticated");
      return;
    }
    if (!currentName.trim()) {
      setSaveError("Name is required");
      setShowSaveForm(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Always serialize whatever is in the working trees (or the base if untouched)
      const plTree = templateTreeBy.PL ?? templateTree ?? [];
      const bsTree = templateTreeBy.BS ?? [];

      if (editingMapping && !asNew) {
        // Update existing
        const updated = await updateMapping({
          mappingId: editingMapping.mapping_id,
          userId: authUserId,
          name: currentName.trim(),
          description: currentDescription.trim() || null,
          plTree,
          bsTree,
        });
        onSaved?.(updated);
      } else {
        // Create new
        const created = await createMapping({
          companyId,
          userId: authUserId,
          name: currentName.trim(),
          description: currentDescription.trim() || null,
          standard,
          plTree,
          bsTree,
        });
        onSaved?.(created);
      }
      setShowSaveForm(false);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

// Reset everything to base
  const handleReset = () => {
    setClientTreeBy({ ...clientTreeBy, [statement]: baseClientTree });
    setTemplateTreeBy({ ...templateTreeBy, [statement]: baseTemplateTree });
    setMovedClientIds(new Set());
    setMovedTemplateIds(new Set());
  };

// Add a new breaker (top-level section divider)
  const handleAddBreaker = ({ name, color }) => {
    const newBreaker = {
      id: `brk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: "breaker",
      code: `__breaker__custom_${Date.now()}`,
      sectionCode: `custom_${Date.now()}`,
      name,
      color,
      children: [],
    };
    setTemplateTreeBy(prev => ({
      ...prev,
      [statement]: [...(prev[statement] ?? templateTree), newBreaker],
    }));
  };

// Add a new row to the template — optionally as a child of an existing row
  const handleAddRow = ({ code, name, isSum, parentId = null }) => {
    const newNode = {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      code,
      name,
      isSum,
      isSumAccount: isSum,
      sectionCode: null,
      showInSummary: false,
      sourceSide: "template",
      children: [],
    };
    setTemplateTreeBy(prev => {
      const currentTree = prev[statement] ?? templateTree;
      if (!parentId) {
        return { ...prev, [statement]: [...currentTree, newNode] };
      }
      // Insert as last child of parentId
      const newTree = walkTransform(currentTree, (n) => {
        if (n.id === parentId || n.code === parentId) {
          return { ...n, children: [...(n.children || []), newNode] };
        }
        return n;
      });
      return { ...prev, [statement]: newTree };
    });
  };

  // Rename and delete handlers — work on either side
  const handleRename = (side, targetId, newName) => {
    if (side === "client") {
      setClientTreeBy(prev => ({ ...prev, [statement]: renameNode(prev[statement] ?? clientTree, targetId, newName) }));
    } else {
      setTemplateTreeBy(prev => ({ ...prev, [statement]: renameNode(prev[statement] ?? templateTree, targetId, newName) }));
    }
  };

  const handleDelete = (side, targetId) => {
    if (side === "client") {
      setClientTreeBy(prev => ({ ...prev, [statement]: deleteNode(prev[statement] ?? clientTree, targetId) }));
    } else {
      setTemplateTreeBy(prev => ({ ...prev, [statement]: deleteNode(prev[statement] ?? templateTree, targetId) }));
    }
  };

// Core drop handler — called by both panels
  const handleDrop = ({ sourceNode, sourceSide, targetId, position, destSide }) => {
    // Same-side = MOVE: remove from old position, insert at new
    if (sourceSide === destSide) {
      const tree = destSide === "client" ? clientTree : templateTree;
      const sourceId = sourceNode.id ?? sourceNode.code;

      // Don't allow dropping a node onto itself or its own descendant
      if (sourceId === targetId) return;
      if (isDescendantOf(tree, sourceId, targetId)) return;

      // Find the original node in the tree (with its current children)
      const originalNode = findNodeById(tree, sourceId);
      if (!originalNode) return;

      // Remove from current position
      const without = deleteNode(tree, sourceId);
      // Insert at new position
      const newTree = targetId
        ? insertAt(without, targetId, position, originalNode)
        : appendToRoot(without, originalNode);

      if (destSide === "client") {
        setClientTreeBy({ ...clientTreeBy, [statement]: newTree });
      } else {
        setTemplateTreeBy({ ...templateTreeBy, [statement]: newTree });
      }
      return;
    }

    const destTree = destSide === "client" ? clientTree : templateTree;
    const cloned = cloneSubtree(sourceNode, sourceSide);
    const duplicates = findDuplicates(cloned, destTree);

    const performInsert = (treeAfterDedupe, nodeToInsert) => {
      const newTree = targetId
        ? insertAt(treeAfterDedupe, targetId, position, nodeToInsert)
        : appendToRoot(treeAfterDedupe, nodeToInsert);

      if (destSide === "client") {
        setClientTreeBy({ ...clientTreeBy, [statement]: newTree });
      } else {
        setTemplateTreeBy({ ...templateTreeBy, [statement]: newTree });
      }

      // Mark source as moved
      const sourceIds = collectIdsFromSubtree(sourceNode);
      if (sourceSide === "client") {
        setMovedClientIds(prev => new Set([...prev, ...sourceIds]));
      } else {
        setMovedTemplateIds(prev => new Set([...prev, ...sourceIds]));
      }
    };

    if (duplicates.length === 0) {
      performInsert(destTree, cloned);
      return;
    }

    // Open conflict modal
    setConflict({
      duplicates,
      onResolve: (choice) => {
        setConflict(null);
        if (choice === "cancel") return;

        if (choice === "keep-both") {
          performInsert(destTree, cloned);
          return;
        }

        if (choice === "replace-existing") {
          // Remove duplicate names from destination, then insert imported
          const dupSet = new Set(duplicates);
          const cleaned = removeByNames(destTree, dupSet);
          performInsert(cleaned, cloned);
          return;
        }

        if (choice === "discard-imported") {
          // Cancel the entire drop
          return;
        }
      },
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-8 py-4 border-b border-gray-100 flex items-center gap-4 flex-shrink-0 bg-gray-50/50">
        <div className="flex items-center gap-1 p-1 bg-white border border-gray-100 rounded-xl shadow-sm">
          {[
            ["PL", "Profit & Loss"],
            ["BS", "Balance Sheet"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStatement(key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${
                statement === key ? "text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              }`}
              style={statement === key ? { backgroundColor: meta.accent } : {}}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={handleReset}
          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white transition-all"
          title="Reset to original structure"
        >
          Reset
        </button>

<div className="ml-auto flex items-center gap-2">
          {editingMapping && (
            <span className="text-[10px] text-gray-400 font-medium">
              Editing: <strong className="text-gray-600">{editingMapping.name}</strong>
            </span>
          )}

          <button
            onClick={() => {
              if (!editingMapping) setShowSaveForm(true);
              else handleSave();
            }}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white shadow-md transition-all disabled:opacity-50 hover:opacity-90"
            style={{ backgroundColor: meta.accent }}
          >
            {saving ? "Saving…" : editingMapping ? "Save" : "Save mapping"}
          </button>

          {editingMapping && (
            <button
              onClick={() => setShowSaveForm(true)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white transition-all"
              title="Save as new mapping"
            >
              Save as…
            </button>
          )}

          <span
            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest"
            style={{ backgroundColor: meta.accentBg, color: meta.accent }}
          >
            {meta.label}
          </span>
        </div>
      </div>

{/* Split screen */}
      <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
        <ClientPanel
          tree={clientTree}
          statement={statement}
          movedIds={movedClientIds}
          onDrop={(payload) => handleDrop({ ...payload, destSide: "client" })}
          onRename={(targetId, newName) => handleRename("client", targetId, newName)}
          onDelete={(targetId) => handleDelete("client", targetId)}
        />
<TemplatePanel
          tree={templateTree}
          sectionByCode={sectionByCode}
          loading={tplLoading}
          accent={meta.accent}
          standardLabel={meta.label}
          movedIds={movedTemplateIds}
          onDrop={(payload) => handleDrop({ ...payload, destSide: "template" })}
          onRename={(targetId, newName) => handleRename("template", targetId, newName)}
          onDelete={(targetId) => handleDelete("template", targetId)}
          onAddRow={handleAddRow}
          onAddBreaker={handleAddBreaker}
        />
      </div>

{conflict && (
        <ConflictModal
          duplicates={conflict.duplicates}
          onResolve={conflict.onResolve}
        />
      )}

      {showSaveForm && (
        <SaveMappingForm
          name={currentName}
          setName={setCurrentName}
          description={currentDescription}
          setDescription={setCurrentDescription}
          error={saveError}
          saving={saving}
          asNew={!!editingMapping}
          accent={meta.accent}
          onCancel={() => { setShowSaveForm(false); setSaveError(null); }}
          onSave={() => handleSave({ asNew: !!editingMapping })}
        />
      )}
    </div>
  );
}

// Recursively collect all stable IDs (or codes if id missing) from a subtree
function collectIdsFromSubtree(node) {
  const out = [];
  function walk(n) {
    out.push(n.id ?? n.code);
    (n.children || []).forEach(walk);
  }
  walk(node);
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   CONFLICT MODAL
═══════════════════════════════════════════════════════════════ */
function ConflictModal({ duplicates, onResolve }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      onClick={() => onResolve("cancel")}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-amber-500 px-6 py-4">
          <p className="text-white font-black text-base">Duplicate accounts detected</p>
          <p className="text-white/70 text-[10px] uppercase tracking-widest mt-0.5">
            {duplicates.length} {duplicates.length === 1 ? "match" : "matches"} found
          </p>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-600 leading-relaxed">
            The following account {duplicates.length === 1 ? "name already exists" : "names already exist"} in the destination:
          </p>

          <div className="bg-gray-50 rounded-xl p-3 max-h-40 overflow-y-auto">
            {duplicates.map((d, i) => (
              <div key={i} className="text-xs text-gray-700 font-mono py-0.5 truncate">
                · {d}
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-2">
            <button
              onClick={() => onResolve("keep-both")}
              className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-[#1a2f8a] hover:bg-[#eef1fb]/40 transition-all group"
            >
              <p className="text-xs font-black text-gray-800 group-hover:text-[#1a2f8a]">
                Keep both
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Allow duplicate names side by side
              </p>
            </button>

            <button
              onClick={() => onResolve("replace-existing")}
              className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all group"
            >
              <p className="text-xs font-black text-gray-800 group-hover:text-emerald-700">
                Replace existing
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Remove the existing rows and use the imported ones
              </p>
            </button>

            <button
              onClick={() => onResolve("discard-imported")}
              className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-100 hover:border-red-500 hover:bg-red-50/40 transition-all group"
            >
              <p className="text-xs font-black text-gray-800 group-hover:text-red-700">
                Discard imported
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Cancel the drop and keep destination as-is
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CLIENT PANEL (left) — drag-enabled
═══════════════════════════════════════════════════════════════ */
function ClientPanel({ tree, statement, movedIds, onDrop, onRename, onDelete }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => initialExpanded(tree, "client"));

  // Reset expansion only when statement changes (not on every drop)
  useEffect(() => {
    setExpanded(initialExpanded(tree, "client"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement]);

  // For new roots added by drops, default them to expanded so user can see what was added
  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      let changed = false;
      tree.forEach(root => {
        const key = `client-${root.code}`;
        if (!(key in next) && (root.children?.length ?? 0) > 0) {
          next[key] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tree]);

  const totalCount = useMemo(() => countNodes(tree), [tree]);

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree;
    const q = search.toLowerCase();
    return filterTree(tree, (n) =>
      n.code.toLowerCase().includes(q) || (n.name ?? "").toLowerCase().includes(q)
    );
  }, [tree, search]);

  const visibleCount = useMemo(() => countNodes(filteredTree), [filteredTree]);
const allKeys = useMemo(() => collectAllCodes(tree, "client"), [tree]);

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const expandAll = () => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])));
  const collapseAll = () => setExpanded({});
  const isExpanded = allKeys.length > 0 && allKeys.every(k => expanded[k]);

  return (
    <Panel
      title="Your accounts"
      subtitle={`${totalCount} ${statement === "PL" ? "P&L" : "Balance Sheet"} accounts`}
      accent="#1a2f8a"
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
      isExpanded={isExpanded}
    >
      <PanelToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search your accounts…"
        count={visibleCount}
        total={totalCount}
      />

      <div
        className="flex-1 overflow-y-auto px-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          try {
            const data = JSON.parse(e.dataTransfer.getData("application/json"));
            if (data.sourceSide === "template") {
              onDrop({ sourceNode: data.node, sourceSide: "template", targetId: null, position: "after" });
            }
          } catch { /* ignore */ }
        }}
      >
        {filteredTree.length === 0 ? (
          <EmptyPanelState
            icon={FileText}
            message={search ? "No matches" : "No accounts"}
          />
        ) : (
          filteredTree.map(node => (
<DraggableTreeRow
              key={node.id ?? node.code}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              side="client"
              movedIds={movedIds}
              onDrop={onDrop}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE PANEL (right) — drag-enabled
═══════════════════════════════════════════════════════════════ */
function TemplatePanel({ tree, sectionByCode, loading, accent, standardLabel, movedIds, onDrop, onRename, onDelete, onAddRow, onAddBreaker }) {
  const [pendingParentId, setPendingParentId] = useState(null);
  const [showBreakerForm, setShowBreakerForm] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => initialExpanded(tree, "tpl"));

  // Reset expansion only when standard's template is fully reloaded (loading transitions)
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      // Just finished loading a new template — reset expansion
      setExpanded(initialExpanded(tree, "tpl"));
    }
    prevLoadingRef.current = loading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // For new roots added by drops, default them to expanded
  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      let changed = false;
      tree.forEach(root => {
        const key = `tpl-${root.code}`;
        if (!(key in next) && (root.children?.length ?? 0) > 0) {
          next[key] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tree]);

  const totalCount = useMemo(() => countNodes(tree), [tree]);

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree;
    return filterTreeTpl(tree, search.toLowerCase());
  }, [tree, search]);

  const visibleCount = useMemo(() => countNodes(filteredTree), [filteredTree]);
 const allKeys = useMemo(() => collectAllCodes(tree, "tpl"), [tree]);

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const expandAll = () => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])));
  const collapseAll = () => setExpanded({});
  const isExpanded = allKeys.length > 0 && allKeys.every(k => expanded[k]);

  return (
    <Panel
      title={`${standardLabel} template`}
      subtitle={loading ? "Loading…" : `${totalCount} rows`}
      accent={accent}
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
      isExpanded={isExpanded}
    >
<PanelToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search template…"
        count={visibleCount}
        total={totalCount}
      />

<AddRowForm
        accent={accent}
        onAdd={(payload) => onAddRow({ ...payload, parentId: pendingParentId })}
        existingTree={tree}
        pendingParentId={pendingParentId}
        onClearParent={() => setPendingParentId(null)}
        tree={tree}
      />

      <AddBreakerForm
        accent={accent}
        open={showBreakerForm}
        onOpen={() => setShowBreakerForm(true)}
        onClose={() => setShowBreakerForm(false)}
        onAdd={onAddBreaker}
      />

      <div
        className="flex-1 overflow-y-auto px-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          try {
            const data = JSON.parse(e.dataTransfer.getData("application/json"));
            if (data.sourceSide === "client") {
              onDrop({ sourceNode: data.node, sourceSide: "client", targetId: null, position: "after" });
            }
          } catch { /* ignore */ }
        }}
      >
        {loading ? (
          <div className="text-center py-16 text-xs text-gray-400">Loading template…</div>
        ) : filteredTree.length === 0 ? (
          <EmptyPanelState
            icon={Library}
            message={search ? "No matches" : "No rows"}
          />
        ) : (
          filteredTree.map(node => (
<DraggableTreeRow
              key={node.id ?? node.code}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              side="template"
              movedIds={movedIds}
              onDrop={onDrop}
              onRename={onRename}
              onDelete={onDelete}
              onAddChild={(parentId) => {
                setPendingParentId(parentId);
                // Auto-expand the parent so the new child is visible after creation
                setExpanded(prev => ({ ...prev, [`tpl-${parentId}`]: true }));
              }}
              sectionByCode={sectionByCode}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   UNIFIED DRAGGABLE ROW (works for both sides)
═══════════════════════════════════════════════════════════════ */
function DraggableTreeRow({ node, depth, expanded, onToggle, side, movedIds, onDrop, onRename, onDelete, onAddChild, sectionByCode }) {
  const key = `${side === "client" ? "client" : "tpl"}-${node.code}`;
  const isOpen = !!expanded[key];
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSum = node.isSum ?? node.isSumAccount;
  const isMoved = movedIds.has(node.id ?? node.code);
  const section = sectionByCode?.get(node.sectionCode);

  const [dropZone, setDropZone] = useState(null); // "before" | "inside" | "after" | null
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
  const [hovering, setHovering] = useState(false);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  const startEdit = (e) => {
    e.stopPropagation();
    setEditValue(node.name);
    setEditing(true);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== node.name) {
      onRename?.(node.id ?? node.code, trimmed);
    }
    setEditing(false);
  };
  const cancelEdit = () => {
    setEditValue(node.name);
    setEditing(false);
  };
const handleDelete = (e) => {
    e.stopPropagation();
    onDelete?.(node.id ?? node.code);
  };
  const handleAddChild = (e) => {
    e.stopPropagation();
    onAddChild?.(node.id ?? node.code);
  };

const handleDragStart = (e) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("application/json", JSON.stringify({
      sourceSide: side,
      node: { ...stripSubtreeForTransfer(node), id: node.id },
    }));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.25) setDropZone("before");
    else if (y > h * 0.75) setDropZone("after");
    else setDropZone("inside");
  };

  const handleDragLeave = () => setDropZone(null);

const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const zone = dropZone;
    setDropZone(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      // Allow same-side (move) and cross-side (copy)
      onDrop({
        sourceNode: data.node,
        sourceSide: data.sourceSide,
        targetId: node.id ?? node.code,
        position: zone ?? "after",
      });
    } catch { /* ignore */ }
  };

  const accent = side === "client" ? "#1a2f8a" : "#374151";

// Special rendering for breakers
  if (node.kind === "breaker") {
    return (
      <>
        {dropZone === "before" && (
          <div
            className="h-0.5 mx-2 rounded-full"
            style={{ background: accent, boxShadow: `0 0 6px ${accent}80` }}
          />
        )}
<div
          draggable={!editing}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onClick={!editing && hasChildren ? (e) => { if (e.detail === 1) onToggle(key); } : undefined}
          className={`flex items-center min-w-0 gap-2 px-3 py-2 my-1 rounded-lg transition-all ${editing ? "cursor-text" : "cursor-grab active:cursor-grabbing"}
            ${dropZone === "inside" ? "ring-2 ring-offset-1 ring-white" : ""}`}
          style={{
            backgroundColor: node.color || "#374151",
            ...(dropZone === "inside" ? { boxShadow: `0 0 0 2px white, 0 0 0 4px ${node.color || "#374151"}` } : {}),
          }}
        >
          {hasChildren && (
            <span className="text-white/70 flex-shrink-0">
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          )}

          {editing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              onBlur={commitEdit}
              className="text-xs flex-1 min-w-0 px-2 py-0.5 rounded border border-white/40 outline-none focus:border-white bg-white/15 text-white placeholder:text-white/50 uppercase tracking-widest font-black"
            />
) : (
            <span className="text-xs flex-1 min-w-0 truncate font-black uppercase tracking-widest text-white">
              {node.name}
            </span>
          )}

          {!editing && hovering && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={startEdit}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                title="Rename"
              >
                <Pencil size={10} />
              </button>
              <button
                onClick={handleDelete}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                title="Delete"
              >
                <Trash2 size={10} />
              </button>
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onMouseDown={(e) => { e.preventDefault(); commitEdit(); }}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                title="Save"
              >
                <Check size={10} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                title="Cancel"
              >
                <X size={10} />
              </button>
            </div>
          )}
        </div>

        {dropZone === "after" && (
          <div
            className="h-0.5 mx-2 rounded-full"
            style={{ background: accent, boxShadow: `0 0 6px ${accent}80` }}
          />
        )}

        {isOpen && hasChildren && node.children.map(child => (
          <DraggableTreeRow
            key={child.id ?? child.code}
            node={child}
            depth={1}
            expanded={expanded}
            onToggle={onToggle}
            side={side}
            movedIds={movedIds}
            onDrop={onDrop}
            onRename={onRename}
            onDelete={onDelete}
            onAddChild={onAddChild}
            sectionByCode={sectionByCode}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {/* Drop indicator — before */}
      {dropZone === "before" && (
        <div
          className="h-0.5 mx-2 rounded-full"
          style={{ background: accent, boxShadow: `0 0 6px ${accent}80` }}
        />
      )}

      <div className="flex items-stretch gap-2">
<div
          draggable={!editing}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${editing ? "cursor-text" : "cursor-grab active:cursor-grabbing"}
            ${dropZone === "inside" ? "ring-2 ring-offset-1" : "hover:bg-gray-50"}
            ${isSum ? (side === "client" ? "bg-[#eef1fb]/40" : "bg-gray-50/60") : ""}
            ${isMoved ? "opacity-50" : ""}`}
          style={{
            paddingLeft: 8 + depth * 16,
            ...(dropZone === "inside" ? { boxShadow: `0 0 0 2px ${accent}` } : {}),
          }}
          onClick={hasChildren && !editing ? (e) => { if (e.detail === 1) onToggle(key); } : undefined}
        >
          {hasChildren ? (
            <span className={`flex-shrink-0 ${side === "client" ? "text-[#1a2f8a]/40" : "text-gray-400"}`}>
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}

          <span className={`text-[10px] font-mono flex-shrink-0 w-20 truncate ${
            isSum
              ? (side === "client" ? "font-bold text-[#1a2f8a]" : "font-bold text-gray-700")
              : "text-gray-400"
          }`}>
            {node.code}
          </span>

{editing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              onBlur={commitEdit}
              className="text-xs flex-1 min-w-0 px-2 py-0.5 rounded border border-[#1a2f8a]/30 outline-none focus:border-[#1a2f8a] bg-white"
            />
          ) : (
            <span className={`text-xs flex-1 min-w-0 truncate ${
              isSum
                ? (side === "client" ? "font-bold text-[#1a2f8a]" : "font-bold text-gray-800")
                : "text-gray-600"
            }`}>
              {node.name}
            </span>
          )}

{/* Hover actions */}
          {!editing && hovering && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {onAddChild && (
                <button
                  onClick={handleAddChild}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-5 h-5 rounded flex items-center justify-center hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors"
                  title="Add child row"
                >
                  <Plus size={11} />
                </button>
              )}
              <button
                onClick={startEdit}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#1a2f8a]/10 text-gray-400 hover:text-[#1a2f8a] transition-colors"
                title="Rename"
              >
                <Pencil size={10} />
              </button>
              <button
                onClick={handleDelete}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 size={10} />
              </button>
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onMouseDown={(e) => { e.preventDefault(); commitEdit(); }}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-emerald-50 text-emerald-500 transition-colors"
                title="Save"
              >
                <Check size={10} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100 text-gray-400 transition-colors"
                title="Cancel"
              >
                <X size={10} />
              </button>
            </div>
          )}

          {!editing && !hovering && isMoved && (
            <CheckCircle2 size={11} className="text-emerald-500 flex-shrink-0" title="Already moved" />
          )}

        </div>
      </div>

      {/* Drop indicator — after */}
      {dropZone === "after" && (
        <div
          className="h-0.5 mx-2 rounded-full"
          style={{ background: accent, boxShadow: `0 0 6px ${accent}80` }}
        />
      )}

{isOpen && hasChildren && node.children.map(child => (
        <DraggableTreeRow
          key={child.id ?? child.code}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          side={side}
          movedIds={movedIds}
          onDrop={onDrop}
          onRename={onRename}
          onDelete={onDelete}
          onAddChild={onAddChild}
          sectionByCode={sectionByCode}
        />
      ))}
    </>
  );
}

// Strip non-serializable refs and keep only what we need to transfer
function stripSubtreeForTransfer(node) {
  return {
    code: node.code,
    name: node.name,
    isSum: node.isSum ?? node.isSumAccount ?? false,
    isSumAccount: node.isSumAccount ?? node.isSum ?? false,
    accountType: node.accountType ?? null,
    sectionCode: node.sectionCode ?? null,
    showInSummary: node.showInSummary ?? false,
    children: (node.children || []).map(stripSubtreeForTransfer),
  };
}


/* ═══════════════════════════════════════════════════════════════
   ADD ROW FORM — collapsible inline form to create new template rows
═══════════════════════════════════════════════════════════════ */
function AddRowForm({ accent, onAdd, existingTree, pendingParentId, onClearParent, tree }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isSum, setIsSum] = useState(false);
  const [error, setError] = useState(null);
  const codeInputRef = useRef(null);

  // Auto-open the form when a parent is selected via the per-row + button
  useEffect(() => {
    if (pendingParentId) setOpen(true);
  }, [pendingParentId]);

  useEffect(() => {
    if (open && codeInputRef.current) codeInputRef.current.focus();
  }, [open]);

  // Find parent name for display
  const parentName = useMemo(() => {
    if (!pendingParentId || !tree) return null;
    function find(nodes) {
      for (const n of nodes) {
        if (n.id === pendingParentId || n.code === pendingParentId) return n;
        const found = find(n.children || []);
        if (found) return found;
      }
      return null;
    }
    const parent = find(tree);
    return parent ? `${parent.code} · ${parent.name}` : null;
  }, [pendingParentId, tree]);

const reset = () => { setCode(""); setName(""); setIsSum(false); setError(null); };

  const fullReset = () => {
    reset();
    onClearParent?.();
  };

  const handleSubmit = () => {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) { setError("Code is required"); return; }
    if (!trimmedName) { setError("Name is required"); return; }

    const codeExists = (function check(nodes) {
      for (const n of nodes) {
        if (String(n.code) === trimmedCode) return true;
        if (check(n.children || [])) return true;
      }
      return false;
    })(existingTree);

    if (codeExists) { setError(`Code "${trimmedCode}" already exists`); return; }

onAdd({ code: trimmedCode, name: trimmedName, isSum });
    fullReset();
    setOpen(false);
  };

  const handleCancel = () => { fullReset(); setOpen(false); };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-dashed border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600 text-xs font-bold transition-all w-full justify-center"
      >
        <Plus size={12} />
        Add row
      </button>
    );
  }

  return (
    <div
      className="mb-3 p-3 rounded-lg border-2 space-y-2"
      style={{ borderColor: accent, backgroundColor: `${accent}06` }}
    >
<div className="flex items-center gap-2">
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accent }}>
          {pendingParentId ? "New child row" : "New row"}
        </span>
        {parentName && (
          <span className="text-[10px] text-gray-500 truncate flex items-center gap-1">
            <span className="text-gray-300">↳ child of</span>
            <span className="font-mono font-bold text-gray-700 truncate">{parentName}</span>
            <button
              onClick={onClearParent}
              className="text-gray-400 hover:text-gray-700 ml-1"
              title="Add at root level instead"
            >
              <X size={10} />
            </button>
          </span>
        )}
        <button
          onClick={handleCancel}
          className="ml-auto w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="Cancel"
        >
          <X size={11} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={codeInputRef}
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") handleCancel();
          }}
          placeholder="Code"
          className="text-[10px] font-mono w-24 px-2 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-white"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") handleCancel();
          }}
          placeholder="Account name"
          className="text-xs flex-1 min-w-0 px-2 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-white"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setIsSum(s => !s)}
            className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
            style={{
              borderColor: isSum ? accent : "#e5e7eb",
              backgroundColor: isSum ? accent : "white",
            }}
          >
            {isSum && <Check size={10} className="text-white" strokeWidth={3} />}
          </div>
          <span className="text-[11px] text-gray-600 font-medium">Sum / total row (bold styling)</span>
        </label>

        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          Add row
        </button>
      </div>

      {error && <p className="text-[10px] text-red-500 font-medium pt-1">{error}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ADD BREAKER FORM — section divider with color picker
═══════════════════════════════════════════════════════════════ */
function AddBreakerForm({ accent, open, onOpen, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#1a2f8a");
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const PRESET_COLORS = [
    "#1a2f8a", "#CF305D", "#374151", "#57aa78", "#dc7533", "#7c3aed", "#0891b2", "#ca8a04",
  ];

  const reset = () => {
    setName("");
    setColor("#1a2f8a");
    setError(null);
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name is required"); return; }
    onAdd({ name: trimmed.toUpperCase(), color });
    reset();
    onClose();
  };

  const handleCancel = () => { reset(); onClose(); };

  if (!open) {
    return (
      <button
        onClick={onOpen}
        className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-dashed border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600 text-xs font-bold transition-all w-full justify-center"
      >
        <Plus size={12} />
        Add breaker
      </button>
    );
  }

  return (
    <div
      className="mb-3 p-3 rounded-lg border-2 space-y-2"
      style={{ borderColor: accent, backgroundColor: `${accent}06` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: accent }}>
          New breaker
        </span>
        <button
          onClick={handleCancel}
          className="ml-auto w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="Cancel"
        >
          <X size={11} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") handleCancel();
        }}
        placeholder="Breaker label (e.g., INGRESOS)"
        className="text-xs w-full px-2 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-white uppercase tracking-widest font-black"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 font-medium">Color:</span>
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className="w-6 h-6 rounded-md border-2 transition-all"
            style={{
              backgroundColor: c,
              borderColor: color === c ? "#000" : "transparent",
              transform: color === c ? "scale(1.1)" : "scale(1)",
            }}
            title={c}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-6 h-6 rounded cursor-pointer border border-gray-200"
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div
          className="flex-1 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest text-white truncate"
          style={{ backgroundColor: color }}
        >
          {name.trim() || "PREVIEW"}
        </div>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white transition-all hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          Add
        </button>
      </div>

      {error && <p className="text-[10px] text-red-500 font-medium pt-1">{error}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SAVE FORM MODAL
═══════════════════════════════════════════════════════════════ */
function SaveMappingForm({ name, setName, description, setDescription, error, onSave, onCancel, saving, asNew, accent }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4" style={{ backgroundColor: accent }}>
          <p className="text-white font-black text-base">
            {asNew ? "Save as new mapping" : "Save mapping"}
          </p>
          <p className="text-white/70 text-[10px] uppercase tracking-widest mt-0.5">
            Give it a name your team will recognize
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Vista financiera mensual"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 outline-none focus:border-gray-400 text-sm text-gray-800"
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancel();
              }}
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">
              Description <span className="text-gray-300 font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this mapping used for?"
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 outline-none focus:border-gray-400 text-sm text-gray-800 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-50 hover:opacity-90"
              style={{ backgroundColor: accent }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED PANEL CHROME
═══════════════════════════════════════════════════════════════ */
function Panel({ title, subtitle, accent, onExpandAll, onCollapseAll, isExpanded, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 flex flex-col overflow-hidden shadow-sm">
      <div
        className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0"
        style={{ backgroundColor: `${accent}08` }}
      >
        <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm" style={{ color: accent }}>{title}</p>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">
            {subtitle}
          </p>
        </div>
        <button
          onClick={isExpanded ? onCollapseAll : onExpandAll}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
          title={isExpanded ? "Collapse all" : "Expand all"}
        >
          {isExpanded
            ? <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </button>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden p-3">
        {children}
      </div>
    </div>
  );
}

function PanelToolbar({ search, setSearch, placeholder, count, total }) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-shrink-0">
      <div className="flex-1 flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
        <Search size={12} className="text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="text-xs outline-none text-gray-700 w-full bg-transparent placeholder:text-gray-300"
        />
        {search && (
          <button onClick={() => setSearch("")}>
            <X size={11} className="text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>
      {search && count !== total && (
        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">
          {count}/{total}
        </span>
      )}
    </div>
  );
}

function EmptyPanelState({ icon: Icon, message }) {
  return (
    <div className="text-center py-16">
      <Icon size={24} className="text-gray-200 mx-auto mb-2" />
      <p className="text-xs text-gray-400 font-medium">{message}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TREE HELPERS
═══════════════════════════════════════════════════════════════ */
// Initial expanded state: only first level (roots) expanded
function initialExpanded(tree, prefix) {
  const result = {};
  tree.forEach(root => {
    if ((root.children?.length ?? 0) > 0) {
      result[`${prefix}-${root.code}`] = true;
    }
  });
  return result;
}

function collectAllCodes(tree, prefix) {
  const out = [];
  function walk(nodes) {
    nodes.forEach(n => {
      if ((n.children?.length ?? 0) > 0) {
        out.push(`${prefix}-${n.code}`);
        walk(n.children);
      }
    });
  }
  walk(tree);
  return out;
}

function countNodes(tree) {
  let n = 0;
  function walk(nodes) {
    nodes.forEach(node => { n++; walk(node.children || []); });
  }
  walk(tree);
  return n;
}

// Filter client tree: keep nodes that match OR have matching descendants
function filterTree(tree, predicate) {
  function walk(nodes) {
    return nodes
      .map(n => {
        const kids = walk(n.children || []);
        if (predicate(n) || kids.length > 0) {
          return { ...n, children: kids };
        }
        return null;
      })
      .filter(Boolean);
  }
  return walk(tree);
}

// Filter template tree by search
function filterTreeTpl(tree, q) {
  function walk(nodes) {
    return nodes
      .map(n => {
        const kids = walk(n.children || []);
        const matches =
          n.code.toLowerCase().includes(q) ||
          (n.name ?? "").toLowerCase().includes(q);
        if (matches || kids.length > 0) {
          return { ...n, children: kids };
        }
        return null;
      })
      .filter(Boolean);
  }
  return walk(tree);
}