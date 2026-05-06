import React, { useState, useEffect, useMemo } from "react";
import {
  X, Plus, Search, Layers, FilePlus, Library, ChevronLeft,
  ChevronDown, ChevronRight,
  Calendar, User, Clock, FileText, Sparkles, ArrowRightLeft,
  CheckCircle2,
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
function buildTemplateTree(rows) {
  if (!rows || !rows.length) return [];
  const byCode = new Map();
  rows.forEach(r => byCode.set(String(r.account_code), r));

  const childrenOf = new Map();
  const roots = [];
  rows.forEach(r => {
    const code = String(r.account_code);
    const parent = r.parent_code ? String(r.parent_code) : null;
    if (!parent || !byCode.has(parent)) {
      roots.push(r);
    } else {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(r);
    }
  });

  // Preserve sort_order from DB
  const soSort = (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  childrenOf.forEach(arr => arr.sort(soSort));
  roots.sort(soSort);

  function makeNode(r) {
    const code = String(r.account_code);
    const children = (childrenOf.get(code) || []).map(makeNode);
    return {
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
  return roots.map(makeNode);
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
export default function MappingsModal({ open, onClose, groupAccounts = [] }) {
  const { colors } = useSettings();
  const [view, setView] = useState("list");
  const [search, setSearch] = useState("");
  const [selectedStandard, setSelectedStandard] = useState(null);

  const detectedStandard = useMemo(
    () => detectStandard(groupAccounts),
    [groupAccounts]
  );

  const mappings = [];

  if (!open) return null;

  const handleClose = () => {
    setView("list");
    setSearch("");
    setSelectedStandard(null);
    onClose?.();
  };

  const isMapper = view === "mapper";
  const modalSize = isMapper
    ? { maxWidth: "90rem", height: "92vh" }
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
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
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
              search={search}
              setSearch={setSearch}
              onCreate={() => setView("create")}
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
function ListView({ mappings, search, setSearch, onCreate }) {
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

      {filtered.length === 0 ? (
        <EmptyLibrary onCreate={onCreate} hasSearch={!!search.trim()} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((m) => (
            <MappingCard key={m.mapping_id} mapping={m} />
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

function MappingCard({ mapping }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#1a2f8a]/30 hover:shadow-lg transition-all cursor-pointer group">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#eef1fb] flex items-center justify-center flex-shrink-0 group-hover:bg-[#1a2f8a]/10 transition-colors">
          <FileText size={16} className="text-[#1a2f8a]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-gray-800 truncate">
            {mapping.mapping_name ?? "Untitled"}
          </p>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest mt-0.5">
            Custom mapping
          </p>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px] text-gray-500">
        <div className="flex items-center gap-2">
          <User size={11} className="text-gray-300 flex-shrink-0" />
          <span>Created by {mapping.created_by ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={11} className="text-gray-300 flex-shrink-0" />
          <span>
            {mapping.created_at
              ? new Date(mapping.created_at).toLocaleDateString()
              : "—"}
          </span>
        </div>
        {mapping.last_saved && (
          <div className="flex items-center gap-2">
            <Clock size={11} className="text-gray-300 flex-shrink-0" />
            <span>
              Last saved {new Date(mapping.last_saved).toLocaleDateString()}
            </span>
          </div>
        )}
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
   VIEW 4: MAPPER (split-screen with hierarchical trees)
═══════════════════════════════════════════════════════════════ */
function MapperView({ standard, groupAccounts }) {
  const meta = STANDARD_META[standard];
  const [statement, setStatement] = useState("PL");
  const [tplRows, setTplRows] = useState([]);
  const [tplSections, setTplSections] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);

  // Fetch template
  useEffect(() => {
    setTplLoading(true);
    setTplRows([]);
    setTplSections([]);

    Promise.all([
      fetch(
        `${SUPABASE_URL}/template_rows?select=*&standard=eq.${standard}&statement=eq.${statement}&order=sort_order.asc`,
        { headers: sbHeaders }
      ).then(r => r.json()),
      fetch(
        `${SUPABASE_URL}/template_sections?select=*&standard=eq.${standard}&statement=eq.${statement}&order=sort_order.asc`,
        { headers: sbHeaders }
      ).then(r => r.json()),
    ])
      .then(([rows, secs]) => {
        if (Array.isArray(rows)) setTplRows(rows);
        if (Array.isArray(secs)) setTplSections(secs);
      })
      .catch(() => { setTplRows([]); setTplSections([]); })
      .finally(() => setTplLoading(false));
  }, [standard, statement]);

  /* ── Client tree (filtered by statement) ── */
  const clientTree = useMemo(() => {
    if (!groupAccounts.length) return [];
    const tree = buildClientTree(groupAccounts);
    const filterFn = statement === "PL"
      ? (n) => ["P/L", "DIS"].includes(n.accountType)
      : (n) => n.accountType === "B/S";
    return tree.filter(filterFn);
  }, [groupAccounts, statement]);

  /* ── Template tree ── */
  const templateTree = useMemo(() => buildTemplateTree(tplRows), [tplRows]);

  /* ── Section colors lookup ── */
  const sectionByCode = useMemo(() => {
    const m = new Map();
    tplSections.forEach(s => m.set(s.section_code, { label: s.label, color: s.color }));
    return m;
  }, [tplSections]);

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

        <div className="ml-auto flex items-center gap-2">
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
        />
        <TemplatePanel
          tree={templateTree}
          sectionByCode={sectionByCode}
          loading={tplLoading}
          totalRows={tplRows.length}
          totalSections={tplSections.length}
          accent={meta.accent}
          standardLabel={meta.label}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CLIENT PANEL (left)
═══════════════════════════════════════════════════════════════ */
function ClientPanel({ tree, statement }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => initialExpanded(tree, "client"));

  // Re-init expansion when tree changes (e.g., PL <-> BS toggle)
  useEffect(() => {
    setExpanded(initialExpanded(tree, "client"));
  }, [tree]);

  // Total accounts (recursive count)
  const totalCount = useMemo(() => countNodes(tree), [tree]);

  // Filter tree by search (keeps ancestors of matches)
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

  return (
    <Panel
      title="Your accounts"
      subtitle={`${totalCount} ${statement === "PL" ? "P&L" : "Balance Sheet"} accounts`}
      accent="#1a2f8a"
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
    >
      <PanelToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search your accounts…"
        count={visibleCount}
        total={totalCount}
      />

      <div className="flex-1 overflow-y-auto px-1">
        {filteredTree.length === 0 ? (
          <EmptyPanelState
            icon={FileText}
            message={search ? "No matches" : "No accounts"}
          />
        ) : (
          filteredTree.map(node => (
            <ClientTreeRow
              key={node.code}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

function ClientTreeRow({ node, depth, expanded, onToggle }) {
  const key = `client-${node.code}`;
  const isOpen = !!expanded[key];
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSum = node.isSumAccount;

  return (
    <>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer ${
          isSum ? "bg-[#eef1fb]/40" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={hasChildren ? () => onToggle(key) : undefined}
      >
        {hasChildren ? (
          <span className="text-[#1a2f8a]/40 flex-shrink-0">
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <span className={`text-[10px] font-mono flex-shrink-0 w-20 truncate ${
          isSum ? "font-bold text-[#1a2f8a]" : "text-gray-400"
        }`}>
          {node.code}
        </span>
        <span className={`text-xs flex-1 truncate ${
          isSum ? "font-bold text-[#1a2f8a]" : "text-gray-600"
        }`}>
          {node.name}
        </span>
      </div>

      {isOpen && hasChildren && node.children.map(child => (
        <ClientTreeRow
          key={child.code}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATE PANEL (right)
═══════════════════════════════════════════════════════════════ */
function TemplatePanel({ tree, sectionByCode, loading, totalRows, totalSections, accent, standardLabel }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => initialExpanded(tree, "tpl"));

  useEffect(() => {
    setExpanded(initialExpanded(tree, "tpl"));
  }, [tree]);

  const visibleCount = useMemo(() => {
    if (!search.trim()) return totalRows;
    return countNodes(filterTreeTpl(tree, search.toLowerCase()));
  }, [tree, search, totalRows]);

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree;
    return filterTreeTpl(tree, search.toLowerCase());
  }, [tree, search]);

  const allKeys = useMemo(() => collectAllCodes(tree, "tpl"), [tree]);

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const expandAll = () => setExpanded(Object.fromEntries(allKeys.map(k => [k, true])));
  const collapseAll = () => setExpanded({});

  return (
    <Panel
      title={`${standardLabel} template`}
      subtitle={loading ? "Loading…" : `${totalRows} rows · ${totalSections} sections`}
      accent={accent}
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
    >
      <PanelToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search template…"
        count={visibleCount}
        total={totalRows}
      />

      <div className="flex-1 overflow-y-auto px-1">
        {loading ? (
          <div className="text-center py-16 text-xs text-gray-400">Loading template…</div>
        ) : filteredTree.length === 0 ? (
          <EmptyPanelState
            icon={Library}
            message={search ? "No matches" : "No rows"}
          />
        ) : (
          filteredTree.map(node => (
            <TemplateTreeRow
              key={node.code}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              sectionByCode={sectionByCode}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

function TemplateTreeRow({ node, depth, expanded, onToggle, sectionByCode }) {
  const key = `tpl-${node.code}`;
  const isOpen = !!expanded[key];
  const hasChildren = (node.children?.length ?? 0) > 0;
  const section = sectionByCode.get(node.sectionCode);

  return (
    <>
      <div className="flex items-stretch gap-2">
        {section && (
          <div
            className="w-1 rounded-full flex-shrink-0 my-0.5"
            style={{ backgroundColor: section.color }}
            title={section.label}
          />
        )}
        <div
          className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer ${
            node.isSum ? "bg-gray-50/60" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={hasChildren ? () => onToggle(key) : undefined}
        >
          {hasChildren ? (
            <span className="text-gray-400 flex-shrink-0">
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span className={`text-[10px] font-mono flex-shrink-0 w-20 truncate ${
            node.isSum ? "font-bold text-gray-700" : "text-gray-400"
          }`}>
            {node.code}
          </span>
          <span className={`text-xs flex-1 truncate ${
            node.isSum ? "font-bold text-gray-800" : "text-gray-600"
          }`}>
            {node.name}
          </span>
          {node.showInSummary && (
            <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" title="Shown in summary" />
          )}
        </div>
      </div>

      {isOpen && hasChildren && node.children.map(child => (
        <TemplateTreeRow
          key={child.code}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          sectionByCode={sectionByCode}
        />
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED PANEL CHROME
═══════════════════════════════════════════════════════════════ */
function Panel({ title, subtitle, accent, onExpandAll, onCollapseAll, children }) {
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
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onExpandAll}
            className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 px-2 py-1 rounded transition-colors"
            title="Expand all"
          >
            Expand
          </button>
          <span className="text-gray-200 text-[9px]">·</span>
          <button
            onClick={onCollapseAll}
            className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 px-2 py-1 rounded transition-colors"
            title="Collapse all"
          >
            Collapse
          </button>
        </div>
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