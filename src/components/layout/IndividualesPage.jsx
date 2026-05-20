import React, { useState, useEffect, useMemo, useCallback, useRef, } from "react";
import {
  FileText, Search, Loader2, AlertCircle, Filter,
  ChevronDown, ChevronRight, Hash, Download, Calendar, Database, Network,
  RefreshCw, X, GitMerge, BookOpen, Upload, BarChart2, TrendingUp,
  CheckCircle2, Eye, Library, Layers, Pencil,
} from "lucide-react";
import { useSettings, useTypo, useT, useLocale } from "./SettingsContext.jsx";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";
import PageHeader, { FilterPill as HeaderFilterPill, MultiFilterPill as HeaderMultiFilterPill } from "./PageHeader.jsx";
const BASE_URL = "";


/* ═══════════════════════════════════════════════════════════════
   DIMENSION PARSING — Konsolidator API Dimensions field
   Format: "Grupo1:Valor1||Grupo2:Valor2||Grupo3:Valor3"
═══════════════════════════════════════════════════════════════ */
function parseDimensionsField(str) {
  if (!str || typeof str !== "string") return [];
  return str.split("||").map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return { group: pair.slice(0, idx).trim(), code: pair.slice(idx + 1).trim() };
  }).filter(Boolean);
}

function rowMatchesDimMulti(r, groups, codes) {
  // groups: array of group names or null (all)
  // codes: array of dimension codes or null (all)
  // null/empty on both → row passes
  const groupsActive = Array.isArray(groups) && groups.length > 0;
  const codesActive  = Array.isArray(codes)  && codes.length  > 0;
  if (!groupsActive && !codesActive) return true;

  const raw = r.Dimensions ?? r.dimensions ?? "";
  const dims = parseDimensionsField(raw);
  if (!dims.length) return false;

  return dims.some(d => {
    const groupOk = !groupsActive || groups.includes(d.group);
    const codeOk  = !codesActive  || codes.includes(String(d.code));
    return groupOk && codeOk;
  });
}

function rowMatchesDim(r, group, code) {
  const raw = r.Dimensions ?? r.dimensions ?? "";
  const dims = parseDimensionsField(raw);
  if (!dims.length) return false;
  if (code) return dims.some(d => d.group === group && String(d.code) === String(code));
  return dims.some(d => d.group === group);
}

/* ═══════════════════════════════════════════════════════════════
   SHARED UTILITIES
═══════════════════════════════════════════════════════════════ */
function formatCellValue(val) {
  if (val === null || val === undefined || val === "")
    return <span className="text-gray-300 italic text-xs">—</span>;
  if (typeof val === "boolean")
    return val
      ? <span className="text-emerald-600 font-semibold text-xs">Yes</span>
      : <span className="text-gray-400 text-xs">No</span>;
  if (typeof val === "number")
    return <span className="font-mono text-xs">{val.toLocaleString()}</span>;
  if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}T/))
    return <span className="text-xs font-mono text-gray-500">{new Date(val).toLocaleDateString()}</span>;
  return <span className="text-xs">{String(val)}</span>;
}

function formatColumnLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

const useMonths = () => {
  const t = useT();
  return [
    { value: 1, label: t("month_1") }, { value: 2, label: t("month_2") },
    { value: 3, label: t("month_3") }, { value: 4, label: t("month_4") },
    { value: 5, label: t("month_5") }, { value: 6, label: t("month_6") },
    { value: 7, label: t("month_7") }, { value: 8, label: t("month_8") },
    { value: 9, label: t("month_9") }, { value: 10, label: t("month_10") },
    { value: 11, label: t("month_11") }, { value: 12, label: t("month_12") },
  ];
};
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" }, { value: 4, label: "April" },
  { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" }, { value: 12, label: "December" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - i);

const _now = new Date();
const _prevMonth = _now.getMonth() === 0 ? 12 : _now.getMonth();
const _prevYear  = _now.getMonth() === 0 ? _now.getFullYear() - 1 : _now.getFullYear();
const DEFAULT_MONTH = String(_prevMonth);
const DEFAULT_YEAR  = String(_prevYear);
function Select({ label, icon: Icon, value, onChange, options, placeholder }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
        {Icon && <Icon size={11} />}{label}
      </label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-white border-2 border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-700 font-medium outline-none focus:border-[#1a2f8a] transition-all pr-8 cursor-pointer">
          <option value="">{placeholder}</option>
          {options.map((o) => {
            const val = typeof o === "object" ? o.value : o;
            const lbl = typeof o === "object" ? o.label : o;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

function DataTable({
  data,
  hiddenCols = new Set(),
  search,
  setSearch,
  onRefresh,
  leftControls = null
}) {
   const t = useT();
  const cols = data.length > 0 ? Object.keys(data[0]).filter((c) => !hiddenCols.has(c)) : [];
  const filtered = search.trim()
    ? data.filter((row) => Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(search.toLowerCase())))
    : data;

  return (
    <div className="space-y-4">
<div className="flex items-center gap-3 flex-wrap">
  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#eef1fb] text-[#1a2f8a]">
   <Hash size={11} />{data.length} {t("table_records")}
  </div>

  {search && (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">
      {filtered.length} {t("table_matching")}
    </div>
  )}

  {leftControls && (
    <div className="flex items-center gap-2 flex-shrink-0">
      {leftControls}
    </div>
  )}

  <div className="ml-auto flex items-center gap-2">
    <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
      <Search size={13} className="text-gray-400" />
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("table_search_placeholder")}
        className="text-xs outline-none text-gray-700 w-40 bg-transparent placeholder:text-gray-300"
      />
      {search && (
        <button onClick={() => setSearch("")}>
          <X size={12} className="text-gray-400 hover:text-gray-600" />
        </button>
      )}
    </div>

    <button
      onClick={onRefresh}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-100 shadow-sm text-xs font-bold text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/20 transition-all"
    >
     <RefreshCw size={12} /> {t("btn_refresh")}
    </button>
  </div>
</div>
      {filtered.length > 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
         <div className="scrollbar-hide" style={{ height: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            <table className="w-full">
<thead className="sticky top-0 z-10">
  <tr className="border-b border-gray-100 bg-[#1a2f8a]/5">
                  <th className="text-left px-4 py-3 text-xs font-black text-gray-400 uppercase tracking-widest w-10 bg-[#eef1fb]">#</th>
                  {cols.map((col) => (
<th key={col} className="text-left px-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest whitespace-nowrap bg-[#eef1fb]">                      {formatColumnLabel(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors ${i % 2 !== 0 ? "bg-gray-50/30" : ""}`}>
                    <td className="px-4 py-2.5 text-gray-300 text-xs font-mono">{i + 1}</td>
                    {cols.map((col, j) => (
                      <td key={j} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{formatCellValue(row[col])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <FileText size={28} className="text-gray-200 mx-auto mb-3" />
<p className="text-gray-400 text-sm font-semibold">{t("table_no_records")}</p>
          <p className="text-gray-300 text-xs mt-1">{search ? t("table_try_different_search") : t("table_no_data_filters")}</p>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message, sub = "" }) {
  const t = useT();
  message = message ?? t("loading_data");
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
        <FileText size={24} className="text-[#1a2f8a]" />
      </div>
      <p className="text-gray-400 text-sm font-semibold">{message}</p>
      {sub && <p className="text-gray-300 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function ErrorBox({ error, onRetry }) {
  const t = useT();
  return (
    <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3">
      <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-red-600">{t("error_failed_load")}</p>
        <p className="text-xs text-red-400 mt-1 font-mono break-all">{error}</p>
        {onRetry && <button onClick={onRetry} className="mt-2 text-xs font-bold text-red-500 underline underline-offset-2">{t("btn_retry")}</button>}
      </div>
    </div>
  );
}

function FilterPill({ label, value, onChange, options, dark = false, labelStyle = "", valueStyle = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => o.value === value)?.label ?? null;
  const filterTypo = useTypo("filter");

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-xs font-bold transition-all select-none
          ${value
            ? dark
              ? "bg-[#ffffff] border-[#dfdfdf] text-black hover:bg-white/30 shadow-ml"
              : "bg-[#ffffff] border-[#c2c2c2] text-[#505050] shadow-xl"
            : dark
              ? "bg-[#ffffff] border-[#dfdfdf] text-black hover:bg-white/30 shadow-l"
              : "bg-[#ffffff] border-[#c2c2c2] text-[#505050] shadow-xl"
          }`}>
<span className={`text-[9px] font-black uppercase tracking-widest ${labelStyle || (value ? (dark ? "text-black/30" : "text-[#1a2f8a]/50") : dark ? "text-black/30" : "text-[#1a2f8a]/50")}`}>{label}</span>
<span
  className={valueStyle || ""}
  style={display ? {
    fontFamily: filterTypo.fontFamily,
    fontSize: filterTypo.fontSize,
    fontWeight: filterTypo.fontWeight,
    color: filterTypo.color,
  } : { color: "rgba(100,120,180,0.4)" }}>
  {display ?? "—"}
</span>
<ChevronDown size={10} className={`transition-transform duration-200 ${open ? "rotate-180" : ""} ${value ? (dark ? "text-black/50" : "text-[#1a2f8a]/40") : dark ? "text-black/50" : "text-gray-300"}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl shadow-black/5 overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {options.map(o => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
                  ${value === o.value ? "bg-[#1a2f8a] text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}>
                {o.label}
                {value === o.value && <span className="w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AMOUNT PARSING
   Handles all formats the API may return:
     number  → 12345.67
     string  → "-35.495,37"  (European: dot=thousands, comma=decimal)
     string  → "-35495.37"   (Standard: dot=decimal)
     string  → "—" / null / undefined → 0
═══════════════════════════════════════════════════════════════ */
function parseAmt(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (s === "" || s === "—" || s === "-") return 0;

  // Detect European format: has dots before comma  e.g. "1.234,56"
  const hasEuropeanFormat = /\d\.\d{3},\d/.test(s) || (/,/.test(s) && /\./.test(s) && s.indexOf(".") < s.indexOf(","));
  if (hasEuropeanFormat) {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  // Has comma as thousands separator  e.g. "1,234.56"
  if (/,/.test(s) && /\./.test(s) && s.indexOf(",") < s.indexOf(".")) {
    return parseFloat(s.replace(/,/g, "")) || 0;
  }
  // Only comma, treat as decimal separator  e.g. "1234,56"
  if (/,/.test(s) && !/\./.test(s)) {
    return parseFloat(s.replace(",", ".")) || 0;
  }
  return parseFloat(s) || 0;
}

function fmtAmt(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/*
   FIELD ACCESSOR
   The API field names may come back in different casings.
   This helper reads a field case-insensitively from a row object.
*/
function normalizeKey(str) {
  return String(str).replace(/[_\s-]/g, "").toLowerCase();
}

function getField(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;

  const normalizedMap = new Map();
  Object.keys(obj).forEach((key) => {
    normalizedMap.set(normalizeKey(key), obj[key]);
  });

  for (const name of names) {
    if (obj[name] !== undefined) return obj[name];

    const val = normalizedMap.get(normalizeKey(name));
    if (val !== undefined) return val;
  }

  return undefined;
}

/* ═══════════════════════════════════════════════════════════════
   FINANCIAL REPORT TREE BUILDER
   ───────────────────────────────────────────────────────────────
   Builds a hierarchical tree purely from API data — no hardcoding.

   DATA SOURCES:
   ┌─ Group Accounts  (/v2/group-accounts)
   │   accountCode       → unique node ID
   │   sumAccountCode    → parent node ID (builds the hierarchy)
   │   isSumAccount      → true = header/subtotal row (displayed bold)
   │   level             → numeric depth hint
   │
   ├─ Uploaded Accounts (/v2/reports/uploaded-accounts)
   │   accountCode       → which group account this row belongs to
   │   localAccountCode  → the source-system line code (depth 2)
   │   localAccountName  → label for the local line
   │   dimensionCode     → optional drill dimension (depth 3)
   │   dimensionName     → label for the dimension
   │   amountPeriod      → the monetary value (European or standard format)
   │   companyShortName  → company identifier
   │
   └─ Mapped Accounts   (/v2/mapped-accounts)
       Not needed for tree construction — the uploaded rows already
       carry both localAccountCode and accountCode (group code).

   TREE LEVELS (matches Konsolidator drill-down exactly):
     Depth 0  Sum account     "11999 Revenue"              bold header
     Depth 1  Group account   "10500 Subscription fees IC" normal group row
     Depth 2  Local account   "011110 Intercompany Rev"    italic source line
     Depth 3  Dimension       "Department: 5. Shared"      dim badge row

   ORDERING: all siblings sorted numerically by accountCode ascending.
   AMOUNTS:  each node shows the rolled-up sum of all descendant rows.
═══════════════════════════════════════════════════════════════ */
function buildTree(groupAccounts, uploadedAccounts, skipSumAccounts = true) {
  if (!groupAccounts.length || !uploadedAccounts.length) return [];

  const gaByCode = new Map();
  groupAccounts.forEach(ga => {
    const code = String(getField(ga, "accountCode") ?? "");
    if (code) gaByCode.set(code, ga);
  });

  const childrenOf = new Map();
  const roots = [];

  groupAccounts.forEach(ga => {
    const code   = String(getField(ga, "accountCode") ?? "");
    const parent = String(getField(ga, "sumAccountCode") ?? "");
    if (!code) return;
    if (!gaByCode.has(parent) || parent === code) {
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

  const uploadIdx = new Map();

uploadedAccounts.forEach(row => {
    const gac    = String(getField(row, "accountCode") ?? "");

const ga = gaByCode.get(gac);
    if (skipSumAccounts && ga && getField(ga, "isSumAccount")) return;

    const lacRaw = getField(row, "localAccountCode");
    const lac    = lacRaw && String(lacRaw) !== "—" && String(lacRaw) !== "null" && String(lacRaw) !== "" ? String(lacRaw) : null;
    const laName = getField(row, "localAccountName");
    const laNameC = laName && String(laName) !== "—" && String(laName) !== "" ? String(laName) : null;
    const dimCodeRaw = getField(row, "dimensionCode");
    const dimCode = dimCodeRaw != null && String(dimCodeRaw) !== "" && String(dimCodeRaw) !== "null" ? String(dimCodeRaw) : null;
    const dimName = getField(row, "dimensionName") ?? null;
    const amt    = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    const co     = String(getField(row, "companyShortName", "CompanyShortName") ?? "");

    if (!gac) return;

    if (!uploadIdx.has(gac)) uploadIdx.set(gac, new Map());
    const byLoc  = uploadIdx.get(gac);
    const locKey = lac ?? "__none__";

    if (!byLoc.has(locKey)) byLoc.set(locKey, { code: lac, name: laNameC, dims: new Map() });
    const locEntry = byLoc.get(locKey);

    const dimKey = dimCode ?? "__none__";
    if (!locEntry.dims.has(dimKey))
      locEntry.dims.set(dimKey, { code: dimCode, name: String(dimName ?? ""), amount: 0, company: co });
    locEntry.dims.get(dimKey).amount += amt;
  });

  function makeNode(ga) {
    const code     = String(getField(ga, "accountCode") ?? "");
    const children = (childrenOf.get(code) || []).map(makeNode).filter(Boolean);

    const uploadLeaves = [];
    if (uploadIdx.has(code)) {
      uploadIdx.get(code).forEach((locEntry, locKey) => {
        const dims     = [...locEntry.dims.values()];
        const localAmt = dims.reduce((s, d) => s + d.amount, 0);

        if (locKey === "__none__") {
          uploadLeaves.push({ type: "plain", amount: localAmt, company: "" });
        } else {
          const dimChildren = dims
            .filter(d => d.code !== null)
            .map(d => ({ type: "dimension", code: d.code, name: d.name, amount: d.amount, company: d.company }));
          uploadLeaves.push({ type: "localAccount", code: locEntry.code, name: locEntry.name, amount: localAmt, children: dimChildren });
        }
      });
    }

    return {
      type: "groupAccount",
      code,
      name: String(getField(ga, "accountName") ?? ""),
      accountType: String(getField(ga, "accountType") ?? ""),
      isSumAccount: !!getField(ga, "isSumAccount"),
      level: Number(getField(ga, "level") ?? 0),
      children,
      uploadLeaves,
    };
  }

  return roots.map(makeNode).filter(Boolean);
}

function sumNode(node) {
  if (node.type === "localAccount" || node.type === "dimension" || node.type === "plain")
    return node.amount ?? 0;

  let s = 0;
  node.uploadLeaves?.forEach(l => { s += sumNode(l); });
  node.children?.forEach(c => { s += sumNode(c); });
  return s;
}

// A node "has data" if it or any descendant has any uploaded rows attached
function hasData(node) {
  if (node.type !== "groupAccount") return true; // leaf nodes always count
  if (node.uploadLeaves?.length > 0) return true;
  return node.children?.some(hasData) ?? false;
}

/* ── Tree row components ──────────────────────────────────── */
const INDENT = 18;

function AmountCell({ value, bold }) {
  const n = typeof value === "number" ? value : 0;
  const color = n < 0 ? "text-emerald-700" : n > 0 ? "text-[#1a2f8a]" : "text-gray-300";
  return (
    <td className={`px-4 py-1.5 text-right font-mono text-xs whitespace-nowrap w-36 ${bold ? "font-bold" : ""} ${color}`}>
      {fmtAmt(n)}
    </td>
  );
}

function DimensionRow({ node, depth }) {
  return (
    <tr className="hover:bg-amber-50/40 transition-colors">
      <td className="py-1" style={{ paddingLeft: depth * INDENT + 8 }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
          <span className="text-xs text-gray-400 italic">{node.name || node.code}</span>
          {node.company && <span className="text-[10px] text-gray-300 ml-1">· {node.company}</span>}
        </div>
      </td>
      <AmountCell value={node.amount} />
    </tr>
  );
}

function PlainRow({ node, depth }) {
  return (
    <tr className="hover:bg-gray-50/40 transition-colors">
      <td className="py-1" style={{ paddingLeft: depth * INDENT + 8 }}>
        <span className="text-xs text-gray-400 italic"></span>
      </td>
      <AmountCell value={node.amount} />
    </tr>
  );
}

function LocalAccountRow({ node, depth, expanded, onToggle }) {
  const hasDims = node.children?.length > 0;
  return (
    <>
      <tr className={`hover:bg-blue-50/20 transition-colors ${hasDims ? "cursor-pointer" : ""}`}
        onClick={hasDims ? onToggle : undefined}>
        <td className="py-1.5" style={{ paddingLeft: depth * INDENT + 8 }}>
          <div className="flex items-center gap-1.5">
            {hasDims
              ? <span className="text-gray-300 flex-shrink-0">{expanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{node.code}</span>
            <span className="text-xs text-gray-500">{node.name}</span>
          </div>
        </td>
        <AmountCell value={node.amount} />
      </tr>
      {expanded && hasDims && node.children.map((dim, i) =>
        <DimensionRow key={i} node={dim} depth={depth + 1} />
      )}
    </>
  );
}

function GroupAccountRow({ node, depth, expanded, onToggle, expandedMap, dispatch }) {
  const visibleChildren = node.children?.filter(hasData) ?? [];
  const hasContent = visibleChildren.length > 0 || node.uploadLeaves?.length > 0;
const total = sumNode(node);
  const bold  = node.isSumAccount;
  

  const rowBg = bold
    ? depth === 0
      ? "bg-[#1a2f8a]/[0.06] border-b border-[#1a2f8a]/10"
      : depth === 1
        ? "bg-[#1a2f8a]/[0.03]"
        : ""
    : "";

  return (
    <>
      <tr className={`${rowBg} hover:bg-[#1a2f8a]/5 transition-colors ${hasContent ? "cursor-pointer" : ""}`}
        onClick={hasContent ? onToggle : undefined}>
        <td className="py-2" style={{ paddingLeft: depth * INDENT + 4 }}>
          <div className="flex items-center gap-1.5">
            {hasContent
              ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{expanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            <span className={`font-mono text-xs flex-shrink-0 ${bold ? "font-bold text-[#1a2f8a]" : "text-gray-400"}`}>{node.code}</span>
            <span className={`text-xs ${bold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>{node.name}</span>
          </div>
        </td>
        <AmountCell value={total} bold={bold} />
      </tr>
      {expanded && (
        <>
          {visibleChildren.map(child => {
            const key = `ga-${child.code}`;
            return (
              <GroupAccountRow key={key} node={child} depth={depth + 1}
                expanded={!!expandedMap[key]} onToggle={() => dispatch(key)}
                expandedMap={expandedMap} dispatch={dispatch} />
            );
          })}
          {node.uploadLeaves?.map((leaf, i) => {
            const key = `leaf-${node.code}-${i}`;
            if (leaf.type === "dimension")
              return <DimensionRow key={key} node={leaf} depth={depth + 1} />;
            if (leaf.type === "plain")
              return <PlainRow key={key} node={leaf} depth={depth + 1} />;
            return (
              <LocalAccountRow key={key} node={leaf} depth={depth + 1}
                expanded={!!expandedMap[key]} onToggle={() => dispatch(key)} />
            );
          })}
        </>
      )}
    </>
  );
}

function useCountUp(target, duration = 2000) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const from = Number(fromRef.current) || 0;
    const to = Number(target) || 0;
    if (from === to) { setDisplay(to); return; }

    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}

function PLAmountCell({ value, divider, typoStyle }) {
  const animated = useCountUp(value ?? 0, 1000);
  const isEmpty = value === 0;
  const isNeg   = animated < 0;
  const semanticColor = isEmpty ? "#D1D5DB" : isNeg ? "#EF4444" : null;

  const style = {
    ...(typoStyle ?? {}),
    ...(semanticColor ? { color: semanticColor } : {}),
    ...(divider ? { borderLeft: "2px solid #e2e8f0" } : {}),
  };

return (
<td className="pl-8 pr-6 py-3 text-right whitespace-nowrap tabular-nums" style={{ ...style, width: "140px" }}>
      {isEmpty ? "—" : isNeg ? `(${fmtAmt(Math.abs(animated))})` : fmtAmt(animated)}
    </td>
  );
}

function deviation(a, b) {
  const diff = a - b;
  const pct  = b === 0 ? null : (diff / Math.abs(b)) * 100;
  return { diff, pct };
}

function DeviationCells({ a, b, typoStyle }) {
  const { diff, pct } = deviation(a, b);
  const isNeg  = diff < 0;
  const color  = diff === 0 ? "#D1D5DB" : isNeg ? "#F87171" : "#059669";
  const pctStr = pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const diffStr = diff === 0 ? "—" : isNeg ? `(${fmtAmt(Math.abs(diff))})` : fmtAmt(diff);

  const style = { ...(typoStyle ?? {}), color };

  return (
<>
      <td className="pl-4 pr-4 py-3 text-right whitespace-nowrap" style={{ ...style, width: "1px" }}>
        {diffStr}
      </td>
      <td className="pl-2 pr-4 py-3 text-right whitespace-nowrap" style={{ ...style, width: "1px" }}>
        {pctStr}
      </td>
    </>
  );
}

function generatePLXlsx({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
  month, year, source, structure,
  summaryRows,
}) {
  async function doGenerate(ExcelJS) {
    const monthLabel  = MONTHS.find(m => String(m.value) === String(month))?.label ?? month;
    const cmpMoLabel  = MONTHS.find(m => String(m.value) === String(cmpFilters?.month))?.label ?? cmpFilters?.month;
    const cmp2MoLabel = MONTHS.find(m => String(m.value) === String(cmp2Filters?.month))?.label ?? cmp2Filters?.month;

    const tree      = buildTree(groupAccounts, uploadedAccounts);
    const prevTree  = buildTree(groupAccounts, prevUploadedAccounts);
    const cmpTree   = compareMode ? buildTree(groupAccounts, cmpUploadedAccounts) : [];
    const cmpPrevT  = compareMode ? buildTree(groupAccounts, cmpPrevUploadedAccounts) : [];
    const cmp2Tree  = compareMode ? buildTree(groupAccounts, cmp2UploadedAccounts) : [];
    const cmp2PrevT = compareMode ? buildTree(groupAccounts, cmp2PrevUploadedAccounts) : [];

    const nodeMap = t => { const m = new Map(); const w = n => { m.set(n.code, n); n.children?.forEach(w); }; t.forEach(w); return m; };
    const prevMap     = nodeMap(prevTree);
    const cmpMap      = nodeMap(cmpTree);
    const cmpPrevMap  = nodeMap(cmpPrevT);
    const cmp2Map     = nodeMap(cmp2Tree);
    const cmp2PrevMap = nodeMap(cmp2PrevT);

    const getYtd  = (map, code) => { const n = map.get(code); return n ? sumNode(n) : 0; };
    const getPrev = (map, code, mo) => Number(mo) === 1 ? 0 : getYtd(map, code);

    const buildRow = node => {
      const ytdV      = -sumNode(node);
      const prevV     = -getPrev(prevMap, node.code, month);
      const monV      = ytdV - prevV;
      const cmpYtdV   = compareMode ? -getYtd(cmpMap, node.code) : null;
      const cmpPrevV  = compareMode ? -getPrev(cmpPrevMap, node.code, cmpFilters?.month) : null;
      const cmpMonV   = compareMode ? cmpYtdV - cmpPrevV : null;
      const cmp2YtdV  = compareMode ? -getYtd(cmp2Map, node.code) : null;
      const cmp2PrevV = compareMode ? -getPrev(cmp2PrevMap, node.code, cmp2Filters?.month) : null;
      const cmp2MonV  = compareMode ? cmp2YtdV - cmp2PrevV : null;
      const dA = (a, b) => (a != null && b != null) ? a - b : 0;
      const dP = (a, b) => (a != null && b != null && b !== 0) ? (a - b) / Math.abs(b) : 0;
      return compareMode
        ? { account: node.name, monA: monV, monB: cmpMonV, monBDev: dA(monV, cmpMonV), monBPct: dP(monV, cmpMonV),
            monC: cmp2MonV, monCDev: dA(monV, cmp2MonV), monCPct: dP(monV, cmp2MonV),
            ytdA: ytdV, ytdB: cmpYtdV, ytdBDev: dA(ytdV, cmpYtdV), ytdBPct: dP(ytdV, cmpYtdV),
            ytdC: cmp2YtdV, ytdCDev: dA(ytdV, cmp2YtdV), ytdCPct: dP(ytdV, cmp2YtdV), _bold: node.isSumAccount }
        : { account: node.name, monthly: monV, ytd: ytdV, _bold: node.isSumAccount };
    };

    const collectDetailed = nodes => {
      const rows = [];
      const walk = node => {
        if (!hasData(node) || !["P/L","DIS"].includes(node.accountType)) return;
        node.children?.forEach(c => walk(c));
        if (node.isSumAccount) rows.push(buildRow(node));
      };
      nodes.filter(n => hasData(n) && ["P/L","DIS"].includes(n.accountType))
        .sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}))
        .forEach(n => walk(n));
      return rows;
    };

    const summaryData  = summaryRows.map(buildRow);
    const detailedData = collectDetailed(tree);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Konsolidator";
    wb.created = new Date();

    const NAVY  = "FF1A2F8A";
    const RED   = "FFCF305D";
    const GREEN = "FF57AA78";
    const LIGHT = "FFEEF1FB";
    const STRIPE= "FFF8F9FF";
    const WHITE = "FFFFFFFF";
    const BGRD  = "FF0F1F5E";

    const mkFill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const mkFont = (bold, argb, sz = 9) => ({ bold, color: { argb }, name: "Arial", size: sz });
    const mkAlign = (h, v = "middle", wrap = false) => ({ horizontal: h, vertical: v, wrapText: wrap });
    const mkBorder = (style = "hair") => ({ bottom: { style, color: { argb: "FFE5E7EB" } } });
    const mkBorderThick = () => ({ bottom: { style: "thin", color: { argb: "FFCCCCCC" } } });

    const NUM_FMT  = '#,##0.00;(#,##0.00);"-"';
    const PCT_FMT  = '0.0%;(0.0%);"-"';

    const buildSheet = (dataRows, sheetTitle) => {
      const ws = wb.addWorksheet(sheetTitle, { views: [{ state: "frozen", ySplit: compareMode ? 7 : 6 }] });

      const totalCols = compareMode ? 15 : 3;

      // ── Row 1: main title ──
      ws.addRow([]);
      const r1 = ws.lastRow;
      r1.height = 28;
      r1.getCell(1).value = `Profit & Loss — ${sheetTitle}`;
      r1.getCell(1).font = mkFont(true, "FFFFFFFF", 13);
      r1.getCell(1).fill = mkFill(NAVY);
      r1.getCell(1).alignment = mkAlign("left");
      for (let c = 1; c <= totalCols; c++) {
        r1.getCell(c).fill = mkFill(NAVY);
      }
      ws.mergeCells(1, 1, 1, totalCols);

      // ── Row 2: subtitle ──
      ws.addRow([]);
      const r2 = ws.lastRow;
      r2.height = 16;
      r2.getCell(1).value = `${monthLabel} ${year}  ·  ${source}  ·  ${structure}`;
      r2.getCell(1).font = mkFont(false, "FFB4C6EE", 9);
      r2.getCell(1).fill = mkFill(NAVY);
      r2.getCell(1).alignment = mkAlign("left");
      for (let c = 1; c <= totalCols; c++) r2.getCell(c).fill = mkFill(NAVY);
      ws.mergeCells(2, 1, 2, totalCols);

      if (compareMode) {
        // ── Row 3: compare period labels ──
        ws.addRow([]);
        const r3 = ws.lastRow;
        r3.height = 16;
        r3.getCell(1).value = `▸ B: ${cmpMoLabel} ${cmpFilters?.year} · ${cmpFilters?.source} · ${cmpFilters?.structure}${cmpFilters?.dimension ? " · " + cmpFilters.dimension : ""}`;
        r3.getCell(1).font = mkFont(false, "FFFCD34D", 9);
        r3.getCell(1).fill = mkFill(NAVY);
        r3.getCell(1).alignment = mkAlign("left");
        r3.getCell(9).value = `▸ C: ${cmp2MoLabel} ${cmp2Filters?.year} · ${cmp2Filters?.source} · ${cmp2Filters?.structure}${cmp2Filters?.dimension ? " · " + cmp2Filters.dimension : ""}`;
        r3.getCell(9).font = mkFont(false, "FFA7F3D0", 9);
        r3.getCell(9).fill = mkFill(NAVY);
        r3.getCell(9).alignment = mkAlign("left");
        for (let c = 1; c <= totalCols; c++) r3.getCell(c).fill = mkFill(NAVY);
        ws.mergeCells(3, 1, 3, 8);
        ws.mergeCells(3, 9, 3, totalCols);
      }

      // ── Spacer row ──
      ws.addRow([]);
      ws.lastRow.height = 6;
      for (let c = 1; c <= totalCols; c++) ws.lastRow.getCell(c).fill = mkFill("FFF5F5F5");

      if (compareMode) {
        // ── Row 5: parent group headers ──
        ws.addRow([]);
        const r5 = ws.lastRow;
        r5.height = 20;

        const parentGroups = [
          { col: 1, span: 1, label: "",          fill: LIGHT,   font: NAVY },
          { col: 2, span: 1, label: "Monthly A",  fill: LIGHT,   font: NAVY },
          { col: 3, span: 3, label: `B: ${cmpMoLabel} ${cmpFilters?.year}`,  fill: "FFCF305D", font: "FFFFFFFF" },
          { col: 6, span: 3, label: `C: ${cmp2MoLabel} ${cmp2Filters?.year}`, fill: "FF57AA78", font: "FFFFFFFF" },
          { col: 9, span: 1, label: "YTD A",      fill: LIGHT,   font: NAVY },
          { col: 10, span: 3, label: `B: ${cmpMoLabel} ${cmpFilters?.year}`, fill: "FFCF305D", font: "FFFFFFFF" },
          { col: 13, span: 3, label: `C: ${cmp2MoLabel} ${cmp2Filters?.year}`, fill: "FF57AA78", font: "FFFFFFFF" },
        ];

        const parentRowNum = compareMode ? 5 : 4;
        parentGroups.forEach(({ col, span, label, fill: f, font: ft }) => {
          const cell = r5.getCell(col);
          cell.value = label;
          cell.font = mkFont(true, ft, 9);
          cell.fill = mkFill(f);
          cell.alignment = mkAlign("center");
          cell.border = mkBorderThick();
          for (let i = col; i < col + span; i++) {
            r5.getCell(i).fill = mkFill(f);
            r5.getCell(i).border = mkBorderThick();
          }
          if (span > 1) ws.mergeCells(parentRowNum, col, parentRowNum, col + span - 1);
        });

        // ── Row 6: column headers ──
        const hdrs = ["Account","Monthly A","Monthly B","Mon Δ","Mon Δ%","Monthly C","Mon Δ","Mon Δ%",
                       "YTD A","YTD B","YTD Δ","YTD Δ%","YTD C","YTD Δ","YTD Δ%"];
        ws.addRow(hdrs);
        const r6 = ws.lastRow;
        r6.height = 20;
        hdrs.forEach((_, i) => {
          const cell = r6.getCell(i + 1);
          cell.font = mkFont(true, "FFFFFFFF", 9);
          cell.fill = mkFill(NAVY);
          cell.alignment = mkAlign("center");
          cell.border = mkBorderThick();
        });

      } else {
        // ── Simple column headers ──
        ws.addRow(["Account", "Monthly", "YTD"]);
        const rh = ws.lastRow;
        rh.height = 20;
        [1,2,3].forEach(i => {
          rh.getCell(i).font = mkFont(true, "FFFFFFFF", 9);
          rh.getCell(i).fill = mkFill(NAVY);
          rh.getCell(i).alignment = mkAlign("center");
          rh.getCell(i).border = mkBorderThick();
        });
      }

      // ── Data rows ──
      dataRows.forEach((row, idx) => {
        const isBold = row._bold;
        const bgArgb = isBold ? LIGHT : (idx % 2 === 0 ? WHITE : STRIPE);

        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 16;

        const applyCell = (colIdx, value, fmt, colorArgb, alignH = "right") => {
          const cell = dr.getCell(colIdx);
          cell.value = value ?? 0;
          cell.numFmt = fmt;
          cell.font = mkFont(isBold, colorArgb, 9);
          cell.fill = mkFill(bgArgb);
          cell.alignment = mkAlign(alignH);
          cell.border = mkBorder("hair");
        };

        if (compareMode) {
          applyCell(1,  row.account,  "@",      isBold ? NAVY : "FF1F2937", "left");
          applyCell(2,  row.monA,     NUM_FMT,  "FF1F2937");
          applyCell(3,  row.monB,     NUM_FMT,  "FFCF305D");
          applyCell(4,  row.monBDev,  NUM_FMT,  row.monBDev >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(5,  row.monBPct,  PCT_FMT,  row.monBPct >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(6,  row.monC,     NUM_FMT,  "FF57AA78");
          applyCell(7,  row.monCDev,  NUM_FMT,  row.monCDev >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(8,  row.monCPct,  PCT_FMT,  row.monCPct >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(9,  row.ytdA,     NUM_FMT,  "FF1F2937");
          applyCell(10, row.ytdB,     NUM_FMT,  "FFCF305D");
          applyCell(11, row.ytdBDev,  NUM_FMT,  row.ytdBDev >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(12, row.ytdBPct,  PCT_FMT,  row.ytdBPct >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(13, row.ytdC,     NUM_FMT,  "FF57AA78");
          applyCell(14, row.ytdCDev,  NUM_FMT,  row.ytdCDev >= 0 ? "FF057A55" : "FFCF305D");
          applyCell(15, row.ytdCPct,  PCT_FMT,  row.ytdCPct >= 0 ? "FF057A55" : "FFCF305D");
        } else {
          applyCell(1, row.account, "@",     isBold ? NAVY : "FF1F2937", "left");
          applyCell(2, row.monthly, NUM_FMT, "FF1F2937");
          applyCell(3, row.ytd,     NUM_FMT, "FF1F2937");
        }
      });

      // ── Column widths ──
      if (compareMode) {
        const widths = [36, 14, 14, 12, 9, 14, 12, 9, 14, 14, 12, 9, 14, 12, 9];
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      } else {
        ws.getColumn(1).width = 42;
        ws.getColumn(2).width = 18;
        ws.getColumn(3).width = 18;
      }
    };

    buildSheet(summaryData,  "Summary");
    buildSheet(detailedData, "Detailed");

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PL_${year}_${String(month).padStart(2,"0")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const load = src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  load("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js")
    .then(() => doGenerate(window.ExcelJS))
    .catch(e => alert("Could not load Excel library: " + e.message));
}
function generatePLPdf({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
  month, year, source, structure,
  summaryRows,
}) {
  function doGenerate(jsPDF, autoTable) {
    const NAVY     = [20,  36, 112];
    const NAVYMID  = [30,  50, 140];
    const NAVYDK   = [10,  20,  70];
    const RED      = [207, 48,  93];
    const REDDK    = [160, 30,  65];
    const REDLT    = [255, 230, 238];
    const GRN      = [52,  168, 113];
    const GRNDK    = [30,  110,  70];
    const GRNLT    = [220, 250, 235];
    const LIGHT    = [238, 241, 251];
    const STRIPE   = [248, 249, 255];
    const WHITE    = [255, 255, 255];
    const OFFWHITE = [250, 251, 255];
    const GRAY     = [140, 150, 175];
    const GRAYLT   = [210, 215, 230];
    const TEXTDK   = [20,  35,  80];

    const monthLabel  = MONTHS.find(m => String(m.value) === String(month))?.label ?? month;
    const cmpMoLabel  = MONTHS.find(m => String(m.value) === String(cmpFilters?.month))?.label ?? cmpFilters?.month;
    const cmp2MoLabel = MONTHS.find(m => String(m.value) === String(cmp2Filters?.month))?.label ?? cmp2Filters?.month;

    const tree      = buildTree(groupAccounts, uploadedAccounts);
    const prevTree  = buildTree(groupAccounts, prevUploadedAccounts);
    const cmpTree   = compareMode ? buildTree(groupAccounts, cmpUploadedAccounts) : [];
    const cmpPrevT  = compareMode ? buildTree(groupAccounts, cmpPrevUploadedAccounts) : [];
    const cmp2Tree  = compareMode ? buildTree(groupAccounts, cmp2UploadedAccounts) : [];
    const cmp2PrevT = compareMode ? buildTree(groupAccounts, cmp2PrevUploadedAccounts) : [];

    const nodeMap = t => { const m = new Map(); const w = n => { m.set(n.code, n); n.children?.forEach(w); }; t.forEach(w); return m; };
    const prevMap     = nodeMap(prevTree);
    const cmpMap      = nodeMap(cmpTree);
    const cmpPrevMap  = nodeMap(cmpPrevT);
    const cmp2Map     = nodeMap(cmp2Tree);
    const cmp2PrevMap = nodeMap(cmp2PrevT);

    const getYtd  = (map, code) => { const n = map.get(code); return n ? sumNode(n) : 0; };
    const getPrev = (map, code, mo) => Number(mo) === 1 ? 0 : getYtd(map, code);
    const fmtN    = n => typeof n === "number" && !isNaN(n)
      ? n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
    const plAmt   = n => n === 0 ? "—" : n < 0 ? `(${fmtN(Math.abs(n))})` : fmtN(n);
    const devPct  = (a, b) => {
      if (b === 0) return "—";
      const p = (a - b) / Math.abs(b) * 100;
      return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
    };
    const devAmt  = (a, b) => {
      const d = a - b;
      return d === 0 ? "—" : d < 0 ? `(${fmtN(Math.abs(d))})` : fmtN(d);
    };

    const buildRowData = node => {
      const ytdV      = -sumNode(node);
      const prevV     = -getPrev(prevMap, node.code, month);
      const monV      = ytdV - prevV;
      const cmpYtdV   = compareMode ? -getYtd(cmpMap, node.code) : 0;
      const cmpPrevV  = compareMode ? -getPrev(cmpPrevMap, node.code, cmpFilters?.month) : 0;
      const cmpMonV   = cmpYtdV - cmpPrevV;
      const cmp2YtdV  = compareMode ? -getYtd(cmp2Map, node.code) : 0;
      const cmp2PrevV = compareMode ? -getPrev(cmp2PrevMap, node.code, cmp2Filters?.month) : 0;
      const cmp2MonV  = cmp2YtdV - cmp2PrevV;
      return { node, monV, cmpMonV, cmp2MonV, ytdV, cmpYtdV, cmp2YtdV, isBold: node.isSumAccount };
    };

    const collectDetailed = nodes => {
      const rows = [];
      const walk = node => {
        if (!hasData(node) || !["P/L","DIS"].includes(node.accountType)) return;
        node.children?.forEach(c => walk(c));
        if (node.isSumAccount) rows.push(buildRowData(node));
      };
      nodes.filter(n => hasData(n) && ["P/L","DIS"].includes(n.accountType))
        .sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}))
        .forEach(n => walk(n));
      return rows;
    };

    const summaryData  = summaryRows.map(buildRowData);
    const detailedData = collectDetailed(tree);

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    let pageNum = 0;

    // ─────────────────────────────────────────────────────────
    // PAGE HEADER
    // ─────────────────────────────────────────────────────────
    const drawPageHeader = (isFirst, section, view) => {
      if (!isFirst) doc.addPage();
      pageNum++;

      // Full navy background header
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, 38, "F");

      // Left bold accent bar
      doc.setFillColor(...RED);
      doc.rect(0, 0, 5, 38, "F");

      // Top-left: main title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.setTextColor(...WHITE);
      doc.text("PROFIT & LOSS", 12, 14);

      // Subtitle: period info
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(180, 200, 255);
      doc.text(`${monthLabel} ${year}  ·  ${source}  ·  ${structure}`, 12, 22);

      if (compareMode) {
        // Period B pill
        doc.setFillColor(...REDDK);
        doc.roundedRect(12, 25, 95, 6.5, 1.5, 1.5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(...WHITE);
        doc.text("B", 16, 29.8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text(`${cmpMoLabel} ${cmpFilters?.year}  ·  ${cmpFilters?.source}  ·  ${cmpFilters?.structure}${cmpFilters?.dimension ? "  ·  " + cmpFilters.dimension : ""}`, 21, 29.8);

        // Period C pill
        doc.setFillColor(...GRNDK);
        doc.roundedRect(112, 25, 95, 6.5, 1.5, 1.5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(...WHITE);
        doc.text("C", 116, 29.8);
        doc.setFont("helvetica", "normal");
        doc.text(`${cmp2MoLabel} ${cmp2Filters?.year}  ·  ${cmp2Filters?.source}  ·  ${cmp2Filters?.structure}${cmp2Filters?.dimension ? "  ·  " + cmp2Filters.dimension : ""}`, 121, 29.8);
      }

      // Top-right: section + view badges
      const rightX = W - 8;

      // View badge (Monthly / YTD)
      const viewLabel = view.toUpperCase();
      const viewW = 28;
      doc.setFillColor(...NAVYDK);
      doc.roundedRect(rightX - viewW, 6, viewW, 9, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(160, 185, 255);
      doc.text(viewLabel, rightX - viewW / 2, 11.8, { align: "center" });

      // Section badge (Summary / Detailed)
      const secLabel = section.toUpperCase();
      const secW = 28;
      doc.setFillColor(...RED);
      doc.roundedRect(rightX - viewW - secW - 3, 6, secW, 9, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...WHITE);
      doc.text(secLabel, rightX - viewW - secW / 2 - 3, 11.8, { align: "center" });

      // Generated date
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...GRAY);
      doc.text(`Generated ${new Date().toLocaleDateString()}`, rightX, 22, { align: "right" });

      // Thin separator line below header
      doc.setDrawColor(...NAVYMID);
      doc.setLineWidth(0.4);
      doc.line(0, 38, W, 38);

      return 40; // startY
    };

    // ─────────────────────────────────────────────────────────
    // FOOTER
    // ─────────────────────────────────────────────────────────
    const drawFooter = (section, view) => {
      // Footer bar
      doc.setFillColor(...LIGHT);
      doc.rect(0, H - 10, W, 10, "F");
      doc.setDrawColor(...GRAYLT);
      doc.setLineWidth(0.3);
      doc.line(0, H - 10, W, H - 10);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...NAVY);
      doc.text("PROFIT & LOSS", 10, H - 4.5);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text(`${section}  ·  ${view}  ·  ${monthLabel} ${year}  ·  ${source}`, 38, H - 4.5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...NAVY);
      doc.text(`${pageNum}`, W - 10, H - 4.5, { align: "right" });
    };

    // ─────────────────────────────────────────────────────────
    // TABLE RENDERER
    // ─────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────
    // BUILD TABLE DATA
    // ─────────────────────────────────────────────────────────
    const monCols = compareMode ? [
      { header: "ACCOUNT",   dataKey: "name" },
      { header: "MONTHLY",   dataKey: "mainVal" },
      { header: "MONTHLY B", dataKey: "bVal" },
      { header: "Δ",         dataKey: "bDev" },
      { header: "Δ %",       dataKey: "bPct" },
      { header: "MONTHLY C", dataKey: "cVal" },
      { header: "Δ",         dataKey: "cDev" },
      { header: "Δ %",       dataKey: "cPct" },
    ] : [
      { header: "ACCOUNT", dataKey: "name" },
      { header: "MONTHLY", dataKey: "mainVal" },
    ];

    const ytdCols = compareMode ? [
      { header: "ACCOUNT", dataKey: "name" },
      { header: "YTD",     dataKey: "mainVal" },
      { header: "YTD B",   dataKey: "bVal" },
      { header: "Δ",       dataKey: "bDev" },
      { header: "Δ %",     dataKey: "bPct" },
      { header: "YTD C",   dataKey: "cVal" },
      { header: "Δ",       dataKey: "cDev" },
      { header: "Δ %",     dataKey: "cPct" },
    ] : [
      { header: "ACCOUNT", dataKey: "name" },
      { header: "YTD",     dataKey: "mainVal" },
    ];

    const toRow = (d, isMonthly) => ({
      name:     d.node.name,
      mainVal:  plAmt(isMonthly ? d.monV : d.ytdV),
      bVal:     compareMode ? plAmt(isMonthly ? d.cmpMonV : d.cmpYtdV)  : "",
      bDev:     compareMode ? devAmt(isMonthly ? d.monV : d.ytdV, isMonthly ? d.cmpMonV : d.cmpYtdV) : "",
      bPct:     compareMode ? devPct(isMonthly ? d.monV : d.ytdV, isMonthly ? d.cmpMonV : d.cmpYtdV) : "",
      cVal:     compareMode ? plAmt(isMonthly ? d.cmp2MonV : d.cmp2YtdV) : "",
      cDev:     compareMode ? devAmt(isMonthly ? d.monV : d.ytdV, isMonthly ? d.cmp2MonV : d.cmp2YtdV) : "",
      cPct:     compareMode ? devPct(isMonthly ? d.monV : d.ytdV, isMonthly ? d.cmp2MonV : d.cmp2YtdV) : "",
      _isBold:  d.isBold,
      _bDevRaw: isMonthly ? (d.monV - d.cmpMonV) : (d.ytdV - d.cmpYtdV),
      _cDevRaw: isMonthly ? (d.monV - d.cmp2MonV) : (d.ytdV - d.cmp2YtdV),
    });

    // ─────────────────────────────────────────────────────────
    // COLUMN WIDTHS — set per view
    // ─────────────────────────────────────────────────────────
    const setColWidths = (cols, nameW, mainW, otherW) => {
      const styles = {};
      cols.forEach(c => {
        if (c.dataKey === "name")    styles[c.dataKey] = { cellWidth: nameW };
        else if (c.dataKey === "mainVal") styles[c.dataKey] = { cellWidth: mainW, halign: "right" };
        else if (["bPct","cPct"].includes(c.dataKey)) styles[c.dataKey] = { cellWidth: otherW * 0.85, halign: "right" };
        else styles[c.dataKey] = { cellWidth: otherW, halign: "right" };
      });
      return styles;
    };

    // ─────────────────────────────────────────────────────────
    // RENDER 4 PAGES
    // ─────────────────────────────────────────────────────────
    const pages = [
      { section: "Summary",  view: "Monthly",  data: summaryData,  cols: monCols, isMonthly: true  },
      { section: "Summary",  view: "YTD",      data: summaryData,  cols: ytdCols, isMonthly: false },
      { section: "Detailed", view: "Monthly",  data: detailedData, cols: monCols, isMonthly: true  },
      { section: "Detailed", view: "YTD",      data: detailedData, cols: ytdCols, isMonthly: false },
    ];

    pages.forEach(({ section, view, data, cols, isMonthly }, i) => {
      const startY = drawPageHeader(i === 0, section, view);
      const body   = data.map(d => toRow(d, isMonthly));
      const usable = W - 16;
      const nameW  = compareMode ? usable * 0.30 : usable * 0.55;
      const mainW  = compareMode ? usable * 0.13 : usable * 0.225;
      const otherW = compareMode ? usable * 0.12 : mainW;

      // inject columnStyles
      const colStyles = setColWidths(cols, nameW, mainW, otherW);
      autoTable(doc, {
        startY,
        columns: cols,
        body,
        margin: { left: 8, right: 8, bottom: 14 },
        tableWidth: usable,
        styles: {
          fontSize: 7.8,
          cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
          overflow: "ellipsize",
          lineColor: GRAYLT,
          lineWidth: 0.15,
          font: "helvetica",
          textColor: TEXTDK,
        },
        headStyles: {
          fillColor: NAVY,
          textColor: WHITE,
          fontStyle: "bold",
          fontSize: 7.2,
          cellPadding: { top: 4.5, bottom: 4.5, left: 5, right: 5 },
          halign: "right",
          lineWidth: 0,
        },
        columnStyles: colStyles,
        didParseCell: data => {
          const raw = data.row.raw;
          const col = data.column.dataKey;
          if (data.section === "head") {
            if (col === "name")    { data.cell.styles.fillColor = NAVYDK; data.cell.styles.halign = "left"; }
            if (col === "mainVal") { data.cell.styles.fillColor = NAVYMID; }
            if (["bVal","bDev","bPct"].includes(col)) {
              data.cell.styles.fillColor = REDDK;
              data.cell.styles.textColor = [255, 200, 215];
            }
            if (["cVal","cDev","cPct"].includes(col)) {
              data.cell.styles.fillColor = GRNDK;
              data.cell.styles.textColor = [180, 255, 215];
            }
            return;
          }
          if (raw._isBold) {
            data.cell.styles.fillColor  = LIGHT;
            data.cell.styles.fontStyle  = "bold";
            data.cell.styles.fontSize   = 8;
            if (col === "name") data.cell.styles.textColor = NAVY;
          }
          if (col === "bVal") data.cell.styles.textColor = raw._isBold ? REDDK : RED;
          if (col === "cVal") data.cell.styles.textColor = raw._isBold ? GRNDK : GRN;
          if (col === "bDev") { const v = raw._bDevRaw ?? 0; data.cell.styles.textColor = v > 0 ? GRN : v < 0 ? RED : GRAY; }
          if (col === "cDev") { const v = raw._cDevRaw ?? 0; data.cell.styles.textColor = v > 0 ? GRN : v < 0 ? RED : GRAY; }
          if (col === "bPct") { const v = raw._bDevRaw ?? 0; data.cell.styles.textColor = v > 0 ? GRN : v < 0 ? RED : GRAY; data.cell.styles.fontStyle = "bold"; }
          if (col === "cPct") { const v = raw._cDevRaw ?? 0; data.cell.styles.textColor = v > 0 ? GRN : v < 0 ? RED : GRAY; data.cell.styles.fontStyle = "bold"; }
        },
        alternateRowStyles: { fillColor: OFFWHITE },
        didDrawPage: () => drawFooter(section, view),
      });
    });

    doc.save(`PL_${year}_${String(month).padStart(2,"0")}.pdf`);
  }

  const load = src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
    .then(() => load("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"))
    .then(() => {
      const { jsPDF } = window.jspdf;
      doGenerate(jsPDF, window.jspdf.jsPDF.autoTable ?? ((d, opts) => d.autoTable(opts)));
    })
    .catch(e => alert("Could not load PDF library: " + e.message));
}

function generateKonsolidatorXlsx({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
  cmp2Enabled = true,
  bsCompareMode = false,
  bsCmpUploadedAccounts = [], bsCmpFilters = {},
  bsCmp2UploadedAccounts = [], bsCmp2Filters = {},
  bsCmp2Enabled = true,
  month, year, source, structure,
  journalEntries = [],
  summaryRows = [],
  opts = {},
}) {
  async function doGenerate(ExcelJS) {
    // ── Palette ───────────────────────────────────────────────
    const NAVY      = 'FF1A2F8A';
    const NAVY_DK   = 'FF0F1F5E';
    const RED       = 'FFCF305D';
    const GRN       = 'FF57AA78';
    const AMBER     = 'FFDC7533';
    const INDIGO    = 'FF4F46E5';
    const LIGHT     = 'FFEEF1FB';
    const STRIPE    = 'FFF8F9FF';
    const WHITE     = 'FFFFFFFF';
    const TEXT_DK   = 'FF1F2937';
    const TEXT_MUT  = 'FF6B7280';
    const BORDER    = 'FFE5E7EB';
    const DIV_BLUE  = 'FF1A2B6B';
    const DIV_RED   = 'FFCF305D';
    const DIV_GRAY  = 'FF374151';
    const LEAF_BG   = 'FFFAFBFF';
    const DIM_BG    = 'FFFEF8E7';
    const JRN_BG    = 'FFF5F7FF';

    // ── Helpers ───────────────────────────────────────────────
    const mkFill   = a => ({ type:'pattern', pattern:'solid', fgColor:{argb:a} });
    const mkFont   = (bold, argb, size=10, italic=false) => ({ bold, color:{argb}, name:'Calibri', size, italic });
    const mkBorder = () => ({ bottom:{style:'thin', color:{argb:BORDER}} });
    const NUM_FMT  = '#,##0.00;(#,##0.00);"-"';
    const PCT_FMT  = '0.0%;(0.0%);"-"';

    const monthLabel = MONTHS.find(m => String(m.value) === String(month))?.label ?? month;
    const cmpMoLabel = MONTHS.find(m => String(m.value) === String(cmpFilters?.month))?.label ?? '';
    const cmp2MoLabel = MONTHS.find(m => String(m.value) === String(cmp2Filters?.month))?.label ?? '';
    const bsCmpMoLabel = MONTHS.find(m => String(m.value) === String(bsCmpFilters?.month))?.label ?? '';
    const bsCmp2MoLabel = MONTHS.find(m => String(m.value) === String(bsCmp2Filters?.month))?.label ?? '';

    const aLabel  = `${monthLabel} ${year} · ${source}`;
    const bLabel  = compareMode ? [cmpMoLabel, cmpFilters?.year, cmpFilters?.source].filter(Boolean).join(' · ') : '';
    const cLabel  = compareMode && cmp2Enabled ? [cmp2MoLabel, cmp2Filters?.year, cmp2Filters?.source].filter(Boolean).join(' · ') : '';
    const bsBLabel = bsCompareMode ? [bsCmpMoLabel, bsCmpFilters?.year, bsCmpFilters?.source].filter(Boolean).join(' · ') : '';
    const bsCLabel = bsCompareMode && bsCmp2Enabled ? [bsCmp2MoLabel, bsCmp2Filters?.year, bsCmp2Filters?.source].filter(Boolean).join(' · ') : '';

    // ── Trees ─────────────────────────────────────────────────
    const tree      = buildTree(groupAccounts, uploadedAccounts);
    const prevTree  = buildTree(groupAccounts, prevUploadedAccounts);
    const cT        = compareMode ? buildTree(groupAccounts, cmpUploadedAccounts) : [];
    const cPT       = compareMode ? buildTree(groupAccounts, cmpPrevUploadedAccounts) : [];
    const c2T       = compareMode && cmp2Enabled ? buildTree(groupAccounts, cmp2UploadedAccounts) : [];
    const c2PT      = compareMode && cmp2Enabled ? buildTree(groupAccounts, cmp2PrevUploadedAccounts) : [];
    const bsCT      = bsCompareMode ? buildTree(groupAccounts, bsCmpUploadedAccounts) : [];
    const bsC2T     = bsCompareMode && bsCmp2Enabled ? buildTree(groupAccounts, bsCmp2UploadedAccounts) : [];

    const nodeMap = t => {
      const m = new Map();
      const w = n => { m.set(n.code, n); n.children?.forEach(w); };
      t.forEach(w);
      return m;
    };
    const pM = nodeMap(prevTree);
    const cM = nodeMap(cT), cPM = nodeMap(cPT);
    const c2M = nodeMap(c2T), c2PM = nodeMap(c2PT);
    const bsCM = nodeMap(bsCT), bsC2M = nodeMap(bsC2T);

    const getYtd  = (m, c) => { const n = m.get(c); return n ? sumNode(n) : 0; };
    const getPrev = (m, c, mo) => Number(mo) === 1 ? 0 : getYtd(m, c);
    const devColor = v => !v || v === 0 ? 'FFD1D5DB' : v > 0 ? 'FF059669' : 'FFDC2626';

    const jrnByCode = new Map();
    (journalEntries || []).forEach(j => {
      const code = String(j.AccountCode ?? j.accountCode ?? '');
      if (!code) return;
      if (!jrnByCode.has(code)) jrnByCode.set(code, []);
      jrnByCode.get(code).push(j);
    });

    // ── Column layout ─────────────────────────────────────────
    const hasB  = compareMode;
    const hasC  = compareMode && cmp2Enabled;
    const bsHasB = bsCompareMode;
    const bsHasC = bsCompareMode && bsCmp2Enabled;

    const PL = { name: 1, monA: 2 };
    let idx = 3;
    if (hasB) { PL.monB = idx++; PL.monBD = idx++; PL.monBP = idx++; }
    if (hasC) { PL.monC = idx++; PL.monCD = idx++; PL.monCP = idx++; }
    PL.ytdA = idx++;
    if (hasB) { PL.ytdB = idx++; PL.ytdBD = idx++; PL.ytdBP = idx++; }
    if (hasC) { PL.ytdC = idx++; PL.ytdCD = idx++; PL.ytdCP = idx++; }
    const plCols = idx - 1;

    const BS = { name: 1, act: 2 };
    let bidx = 3;
    if (bsHasB) { BS.cmp = bidx++; BS.cmpD = bidx++; BS.cmpP = bidx++; }
    if (bsHasC) { BS.cmp2 = bidx++; BS.cmp2D = bidx++; BS.cmp2P = bidx++; }
    const bsCols = bidx - 1;

    const setC = (row, ci, val, fmt, fontColor, bold, fill, align='right') => {
      if (!ci) return;
      const c = row.getCell(ci);
      c.value = val ?? 0;
      if (fmt) c.numFmt = fmt;
      c.font = mkFont(bold, fontColor, 10);
      c.fill = mkFill(fill);
      c.alignment = { horizontal: align, vertical: 'middle' };
      c.border = mkBorder();
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Konsolidator';
    wb.created = new Date();

    const isAlpha = summaryRows.some(n => /[a-zA-Z]/.test(String(n.code)));

    // ═══════════════════════════════════════════════════════════
    // P&L SHEET BUILDER
    // ═══════════════════════════════════════════════════════════
    const buildPLSheet = (ws, isSummary) => {
      ws.views = [{ state: 'frozen', ySplit: hasB ? 4 : 3, showOutlineSymbols: true }];
      ws.properties.outlineLevelRow = 0;
      ws.properties.outlineLevelCol = 0;

      // Title
      ws.addRow([]);
      const r1 = ws.lastRow;
      r1.height = 32;
      r1.getCell(1).value = `Profit & Loss — ${isSummary ? 'Summary' : 'Detailed'}`;
      r1.getCell(1).font = mkFont(true, WHITE, 14);
      r1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 1; c <= plCols; c++) r1.getCell(c).fill = mkFill(NAVY);
      ws.mergeCells(r1.number, 1, r1.number, plCols);

      ws.addRow([]);
      const r2 = ws.lastRow;
      r2.height = 16;
      r2.getCell(1).value = `A: ${aLabel} · ${structure}`;
      r2.getCell(1).font = mkFont(false, 'FFB4C6EE', 9);
      r2.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 1; c <= plCols; c++) r2.getCell(c).fill = mkFill(NAVY);
      ws.mergeCells(r2.number, 1, r2.number, plCols);

      if (hasB) {
        ws.addRow([]);
        const r3 = ws.lastRow;
        r3.height = 15;
        const parts = [`B: ${bLabel}`];
        if (hasC) parts.push(`C: ${cLabel}`);
        r3.getCell(1).value = parts.join('    |    ');
        r3.getCell(1).font = mkFont(false, 'FFFCD34D', 9);
        r3.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        for (let c = 1; c <= plCols; c++) r3.getCell(c).fill = mkFill(NAVY);
        ws.mergeCells(r3.number, 1, r3.number, plCols);
      }

      ws.addRow([]);
      const rh = ws.lastRow;
      rh.height = 22;
      const headers = [
        [PL.name, 'ACCOUNT', 'left', NAVY],
        [PL.monA, 'MONTHLY', 'right', NAVY],
      ];
      if (hasB) {
        headers.push([PL.monB, 'MON B', 'right', RED]);
        headers.push([PL.monBD, 'Δ', 'right', RED]);
        headers.push([PL.monBP, 'Δ%', 'right', RED]);
      }
      if (hasC) {
        headers.push([PL.monC, 'MON C', 'right', GRN]);
        headers.push([PL.monCD, 'Δ', 'right', GRN]);
        headers.push([PL.monCP, 'Δ%', 'right', GRN]);
      }
      headers.push([PL.ytdA, 'YTD', 'right', NAVY]);
      if (hasB) {
        headers.push([PL.ytdB, 'YTD B', 'right', RED]);
        headers.push([PL.ytdBD, 'Δ', 'right', RED]);
        headers.push([PL.ytdBP, 'Δ%', 'right', RED]);
      }
      if (hasC) {
        headers.push([PL.ytdC, 'YTD C', 'right', GRN]);
        headers.push([PL.ytdCD, 'Δ', 'right', GRN]);
        headers.push([PL.ytdCP, 'Δ%', 'right', GRN]);
      }
      headers.forEach(([ci, lbl, align, fillArgb]) => {
        const c = rh.getCell(ci);
        c.value = lbl;
        c.font = mkFont(true, WHITE, 9);
        c.fill = mkFill(fillArgb);
        c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
        c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
      });

      // Widths + grouping on compare columns
      ws.getColumn(PL.name).width = 46;
      ws.getColumn(PL.monA).width = 16;
      if (hasB) {
        [PL.monB, PL.monBD, PL.monBP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === PL.monB ? 16 : ci === PL.monBD ? 13 : 10;
          col.outlineLevel = 1;
        });
      }
      if (hasC) {
        [PL.monC, PL.monCD, PL.monCP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === PL.monC ? 16 : ci === PL.monCD ? 13 : 10;
          col.outlineLevel = 2;
        });
      }
      ws.getColumn(PL.ytdA).width = 16;
      if (hasB) {
        [PL.ytdB, PL.ytdBD, PL.ytdBP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === PL.ytdB ? 16 : ci === PL.ytdBD ? 13 : 10;
          col.outlineLevel = 1;
        });
      }
      if (hasC) {
        [PL.ytdC, PL.ytdCD, PL.ytdCP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === PL.ytdC ? 16 : ci === PL.ytdCD ? 13 : 10;
          col.outlineLevel = 2;
        });
      }

      const SUMMARY_DIV = isAlpha ? {
        'A.04.S': { label: 'INGRESOS',          argb: DIV_BLUE },
        'A.13.S': { label: 'GASTOS OPERATIVOS', argb: DIV_RED  },
        'A.24.S': { label: 'RESULTADO FINAL',   argb: DIV_GRAY },
      } : {
        '11999':  { label: 'INGRESOS',          argb: DIV_BLUE },
        '53999':  { label: 'GASTOS OPERATIVOS', argb: DIV_RED  },
        '89999':  { label: 'RESULTADO FINAL',   argb: DIV_GRAY },
      };

      const DETAIL_DIV_BEFORE = isAlpha ? {
        'A.01.S': { label: 'INGRESOS',          argb: DIV_BLUE },
        'A.05.S': { label: 'GASTOS OPERATIVOS', argb: DIV_RED  },
        'A.14.S': { label: 'RESULTADO FINAL',   argb: DIV_GRAY },
      } : {
        '10999':  { label: 'INGRESOS',          argb: DIV_BLUE },
        '12199':  { label: 'GASTOS OPERATIVOS', argb: DIV_RED  },
        '89999':  { label: 'RESULTADO FINAL',   argb: DIV_GRAY },
      };

      const writeDivider = (div) => {
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 20;
        for (let c = 1; c <= plCols; c++) {
          dr.getCell(c).fill = mkFill(div.argb);
          dr.getCell(c).border = { bottom: { style: 'thin', color: { argb: div.argb } } };
        }
        dr.getCell(1).value = div.label;
        dr.getCell(1).font = mkFont(true, WHITE, 10);
        dr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        ws.mergeCells(dr.number, 1, dr.number, plCols);
      };

      let zebraIdx = 0;
      const writeDataRow = (node, depth, ol, options = {}) => {
        const { forceBold = null, hidden = false } = options;
        const ytd  = -sumNode(node);
        const prev = -getPrev(pM, node.code, month);
        const mon  = ytd - prev;
        const cYtd  = hasB ? -getYtd(cM, node.code) : 0;
        const cPrev = hasB ? -getPrev(cPM, node.code, cmpFilters?.month) : 0;
        const cMon  = hasB ? cYtd - cPrev : 0;
        const c2Ytd  = hasC ? -getYtd(c2M, node.code) : 0;
        const c2Prev = hasC ? -getPrev(c2PM, node.code, cmp2Filters?.month) : 0;
        const c2Mon  = hasC ? c2Ytd - c2Prev : 0;

        const isHighlighted = PL_HIGHLIGHTED_CODES.has(String(node.code)) || String(node.code).endsWith('.S') || String(node.code).endsWith('.PL');
        const isBold = forceBold !== null ? forceBold : (node.isSumAccount && isHighlighted);

        const bg = isHighlighted ? LIGHT : (zebraIdx % 2 === 0 ? WHITE : STRIPE);
        zebraIdx++;

        const nameColor = isHighlighted ? NAVY : (node.isSumAccount ? NAVY : TEXT_DK);
        const valueColor = isHighlighted ? NAVY : TEXT_DK;

        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = isHighlighted ? 19 : 17;
        if (ol > 0) dr.outlineLevel = Math.min(ol, 7);
        if (hidden) dr.hidden = true;

        const nc = dr.getCell(PL.name);
        nc.value = isHighlighted ? (node.name || '').toUpperCase() : node.name;
        nc.font = mkFont(isBold || isHighlighted, nameColor, 10);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: Math.max(1, depth + 1) };
        nc.border = mkBorder();

        const dMB  = hasB ? mon - cMon : 0;
        const dMBP = hasB && cMon !== 0 ? dMB / Math.abs(cMon) : null;
        const dYB  = hasB ? ytd - cYtd : 0;
        const dYBP = hasB && cYtd !== 0 ? dYB / Math.abs(cYtd) : null;
        const dMC  = hasC ? mon - c2Mon : 0;
        const dMCP = hasC && c2Mon !== 0 ? dMC / Math.abs(c2Mon) : null;
        const dYC  = hasC ? ytd - c2Ytd : 0;
        const dYCP = hasC && c2Ytd !== 0 ? dYC / Math.abs(c2Ytd) : null;

        setC(dr, PL.monA, mon, NUM_FMT, valueColor, isBold, bg);
        if (hasB) {
          setC(dr, PL.monB,  cMon, NUM_FMT, RED, isBold, bg);
          setC(dr, PL.monBD, dMB,  NUM_FMT, devColor(dMB), isBold, bg);
          setC(dr, PL.monBP, dMBP, PCT_FMT, devColor(dMB), isBold, bg);
        }
        if (hasC) {
          setC(dr, PL.monC,  c2Mon, NUM_FMT, GRN, isBold, bg);
          setC(dr, PL.monCD, dMC,   NUM_FMT, devColor(dMC), isBold, bg);
          setC(dr, PL.monCP, dMCP,  PCT_FMT, devColor(dMC), isBold, bg);
        }
        setC(dr, PL.ytdA, ytd, NUM_FMT, valueColor, isBold, bg);
        if (hasB) {
          setC(dr, PL.ytdB,  cYtd, NUM_FMT, RED, isBold, bg);
          setC(dr, PL.ytdBD, dYB,  NUM_FMT, devColor(dYB), isBold, bg);
          setC(dr, PL.ytdBP, dYBP, PCT_FMT, devColor(dYB), isBold, bg);
        }
        if (hasC) {
          setC(dr, PL.ytdC,  c2Ytd, NUM_FMT, GRN, isBold, bg);
          setC(dr, PL.ytdCD, dYC,   NUM_FMT, devColor(dYC), isBold, bg);
          setC(dr, PL.ytdCP, dYCP,  PCT_FMT, devColor(dYC), isBold, bg);
        }
      };

      const writeLeafRow = (leaf, depth, ol) => {
        const amt = leaf.amount ?? 0;
        const bg = LEAF_BG;
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 15;
        dr.outlineLevel = Math.min(ol, 7);
        dr.hidden = true;

        const nc = dr.getCell(PL.name);
        nc.value = `${leaf.code || ''} ${leaf.name || ''}`.trim();
        nc.font = mkFont(false, TEXT_MUT, 9, true);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 1 };
        nc.border = mkBorder();

        setC(dr, PL.monA, -amt, NUM_FMT, TEXT_MUT, false, bg);
        setC(dr, PL.ytdA, -amt, NUM_FMT, TEXT_MUT, false, bg);
        [PL.monB, PL.monBD, PL.monBP, PL.monC, PL.monCD, PL.monCP,
         PL.ytdB, PL.ytdBD, PL.ytdBP, PL.ytdC, PL.ytdCD, PL.ytdCP].forEach(ci => {
          if (ci) {
            const c = dr.getCell(ci);
            c.value = '';
            c.fill = mkFill(bg);
            c.border = mkBorder();
          }
        });
      };

      const writeDimRow = (dim, depth, ol) => {
        const bg = DIM_BG;
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 15;
        dr.outlineLevel = Math.min(ol, 7);
        dr.hidden = true;

        const nc = dr.getCell(PL.name);
        nc.value = `◆ ${dim.name || dim.code || ''}`;
        nc.font = mkFont(false, AMBER, 9);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 1 };
        nc.border = mkBorder();

        setC(dr, PL.monA, -(dim.amount), NUM_FMT, AMBER, false, bg);
        setC(dr, PL.ytdA, -(dim.amount), NUM_FMT, AMBER, false, bg);
        [PL.monB, PL.monBD, PL.monBP, PL.monC, PL.monCD, PL.monCP,
         PL.ytdB, PL.ytdBD, PL.ytdBP, PL.ytdC, PL.ytdCD, PL.ytdCP].forEach(ci => {
          if (ci) {
            const c = dr.getCell(ci);
            c.value = '';
            c.fill = mkFill(bg);
            c.border = mkBorder();
          }
        });
      };

      const writeJrnHeaderRow = (count, depth, ol) => {
        const bg = JRN_BG;
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 15;
        dr.outlineLevel = Math.min(ol, 7);
        dr.hidden = true;
        const nc = dr.getCell(PL.name);
        nc.value = `📋 Journal entries (${count})`;
        nc.font = mkFont(true, INDIGO, 9);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 1 };
        nc.border = mkBorder();
        for (let c = 2; c <= plCols; c++) {
          dr.getCell(c).fill = mkFill(bg);
          dr.getCell(c).border = mkBorder();
        }
      };

      const writeJrnEntry = (jrn, depth, ol) => {
        const bg = JRN_BG;
        const amt = parseAmt(jrn.AmountYTD ?? jrn.amountYTD ?? 0);
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 14;
        dr.outlineLevel = Math.min(ol, 7);
        dr.hidden = true;
        const nc = dr.getCell(PL.name);
        const jnum = jrn.JournalNumber ?? jrn.journalNumber ?? '';
        const jhdr = jrn.JournalHeader ?? jrn.journalHeader ?? '';
        nc.value = `📄 ${jnum}${jhdr ? ' · ' + jhdr : ''}`;
        nc.font = mkFont(false, INDIGO, 9);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 1 };
        nc.border = mkBorder();
        setC(dr, PL.monA, -amt, NUM_FMT, INDIGO, false, bg);
        setC(dr, PL.ytdA, -amt, NUM_FMT, INDIGO, false, bg);
        [PL.monB, PL.monBD, PL.monBP, PL.monC, PL.monCD, PL.monCP,
         PL.ytdB, PL.ytdBD, PL.ytdBP, PL.ytdC, PL.ytdCD, PL.ytdCP].forEach(ci => {
          if (ci) {
            const c = dr.getCell(ci);
            c.value = '';
            c.fill = mkFill(bg);
            c.border = mkBorder();
          }
        });
      };

      // SUMMARY MODE
      if (isSummary) {
        const sortedSummary = [...summaryRows]
          .filter(n => hasData(n) && ['P/L', 'DIS'].includes(n.accountType))
          .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

        sortedSummary.forEach(node => {
          const div = SUMMARY_DIV[String(node.code)];
          if (div) writeDivider(div);
          writeDataRow(node, 0, 0, { forceBold: true });
        });
        return;
      }

      // DETAILED MODE
      const allSumRows = [];
      const walkSum = node => {
        if (!hasData(node) || !['P/L', 'DIS'].includes(node.accountType)) return;
        if (node.isSumAccount) allSumRows.push(node);
        (node.children || []).forEach(walkSum);
      };
      tree.filter(n => ['P/L', 'DIS'].includes(n.accountType)).forEach(walkSum);
      allSumRows.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

      // Drill-down for a detailed row: show non-sum children + local accounts + dimensions + journal
      const writeDrillChildren = (parentNode, depth, ol) => {
        // Non-sum group account children (the sum ones are already top-level)
        const grpChildren = (parentNode.children || []).filter(c =>
          hasData(c) && ['P/L', 'DIS'].includes(c.accountType) && !c.isSumAccount
        );
        grpChildren.forEach(child => {
          writeDataRow(child, depth, ol, { hidden: true });
          writeDrillChildren(child, depth + 1, ol + 1);
        });

        // Local account leaves
        (parentNode.uploadLeaves || []).forEach(leaf => {
          if (leaf.type === 'plain') return;
          writeLeafRow(leaf, depth, ol);
          (leaf.children || []).forEach(dim => writeDimRow(dim, depth + 1, ol + 1));
        });

        // Journal entries
        const jrns = jrnByCode.get(String(parentNode.code)) || [];
        if (jrns.length > 0) {
          writeJrnHeaderRow(jrns.length, depth, ol);
          jrns.forEach(j => writeJrnEntry(j, depth + 1, ol + 1));
        }
      };

      allSumRows.forEach((node, i) => {
        const div = DETAIL_DIV_BEFORE[String(node.code)];
        if (div) writeDivider(div);
        if (i === 0 && !div) {
          const firstKey = isAlpha ? 'A.01.S' : '10999';
          const firstDiv = DETAIL_DIV_BEFORE[firstKey];
          if (firstDiv) writeDivider(firstDiv);
        }
        writeDataRow(node, 0, 0);
        writeDrillChildren(node, 1, 1);
      });
    };

    // ═══════════════════════════════════════════════════════════
    // BS SHEET BUILDER
    // ═══════════════════════════════════════════════════════════
    const buildBSSheet = (ws, label, filterFn) => {
      ws.views = [{ state: 'frozen', ySplit: bsHasB ? 4 : 3, showOutlineSymbols: true }];
      ws.properties.outlineLevelRow = 0;
      ws.properties.outlineLevelCol = 0;

      // Title
      ws.addRow([]);
      const r1 = ws.lastRow;
      r1.height = 32;
      r1.getCell(1).value = `Balance Sheet — ${label}`;
      r1.getCell(1).font = mkFont(true, WHITE, 14);
      r1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 1; c <= bsCols; c++) r1.getCell(c).fill = mkFill(NAVY);
      ws.mergeCells(r1.number, 1, r1.number, bsCols);

      ws.addRow([]);
      const r2 = ws.lastRow;
      r2.height = 16;
      r2.getCell(1).value = `A: ${aLabel} · ${structure}`;
      r2.getCell(1).font = mkFont(false, 'FFB4C6EE', 9);
      r2.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 1; c <= bsCols; c++) r2.getCell(c).fill = mkFill(NAVY);
      ws.mergeCells(r2.number, 1, r2.number, bsCols);

      if (bsHasB) {
        ws.addRow([]);
        const r3 = ws.lastRow;
        r3.height = 15;
        const parts = [`B: ${bsBLabel}`];
        if (bsHasC) parts.push(`C: ${bsCLabel}`);
        r3.getCell(1).value = parts.join('    |    ');
        r3.getCell(1).font = mkFont(false, 'FFFCD34D', 9);
        r3.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        for (let c = 1; c <= bsCols; c++) r3.getCell(c).fill = mkFill(NAVY);
        ws.mergeCells(r3.number, 1, r3.number, bsCols);
      }

      ws.addRow([]);
      const rh = ws.lastRow;
      rh.height = 22;
      const headers = [
        [BS.name, 'ACCOUNT', 'left', NAVY],
        [BS.act,  'ACTUAL',  'right', NAVY],
      ];
      if (bsHasB) {
        headers.push([BS.cmp,  'B',   'right', RED]);
        headers.push([BS.cmpD, 'Δ',   'right', RED]);
        headers.push([BS.cmpP, 'Δ%',  'right', RED]);
      }
      if (bsHasC) {
        headers.push([BS.cmp2,  'C',  'right', GRN]);
        headers.push([BS.cmp2D, 'Δ',  'right', GRN]);
        headers.push([BS.cmp2P, 'Δ%', 'right', GRN]);
      }
      headers.forEach(([ci, lbl, align, fillArgb]) => {
        const c = rh.getCell(ci);
        c.value = lbl;
        c.font = mkFont(true, WHITE, 9);
        c.fill = mkFill(fillArgb);
        c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
        c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
      });

      // Widths + grouping on compare columns
      ws.getColumn(BS.name).width = 52;
      ws.getColumn(BS.act).width = 16;
      if (bsHasB) {
        [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === BS.cmp ? 16 : ci === BS.cmpD ? 13 : 10;
          col.outlineLevel = 1;
        });
      }
      if (bsHasC) {
        [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === BS.cmp2 ? 16 : ci === BS.cmp2D ? 13 : 10;
          col.outlineLevel = 2;
        });
      }

      const BS_DIVIDERS = {
        '399999': { label: 'ACTIVO',          argb: DIV_BLUE },
        '499999': { label: 'PATRIMONIO NETO', argb: DIV_GRAY },
        '699999': { label: 'PASIVO',          argb: DIV_RED  },
        'C.ACT':  { label: 'ACTIVO',          argb: DIV_BLUE },
        'D.S':    { label: 'PATRIMONIO NETO', argb: DIV_GRAY },
        'E.S':    { label: 'PASIVO',          argb: DIV_RED  },
      };

      const writeBSDivider = (div) => {
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 20;
        for (let c = 1; c <= bsCols; c++) {
          dr.getCell(c).fill = mkFill(div.argb);
          dr.getCell(c).border = { bottom: { style: 'thin', color: { argb: div.argb } } };
        }
        dr.getCell(1).value = div.label;
        dr.getCell(1).font = mkFont(true, WHITE, 10);
        dr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        ws.mergeCells(dr.number, 1, dr.number, bsCols);
      };

      let bsZebra = 0;
      const writeBSRow = (node, depth, ol) => {
        if (!hasData(node) || node.accountType !== 'B/S') return;

        const div = BS_DIVIDERS[String(node.code)];
        if (div) writeBSDivider(div);

        const isHighlighted = isBSHighlighted(node);
        const total = Number(node.code) >= 599999 ? -sumNode(node) : sumNode(node);
        const cRaw = bsHasB ? getYtd(bsCM, node.code) : 0;
        const cVal = bsHasB ? (Number(node.code) >= 599999 ? -cRaw : cRaw) : 0;
        const c2Raw = bsHasC ? getYtd(bsC2M, node.code) : 0;
        const c2Val = bsHasC ? (Number(node.code) >= 599999 ? -c2Raw : c2Raw) : 0;
        const dB = bsHasB ? total - cVal : 0;
        const dBP = bsHasB && cVal !== 0 ? dB / Math.abs(cVal) : null;
        const dC = bsHasC ? total - c2Val : 0;
        const dCP = bsHasC && c2Val !== 0 ? dC / Math.abs(c2Val) : null;

        const bg = isHighlighted ? LIGHT : (bsZebra % 2 === 0 ? WHITE : STRIPE);
        bsZebra++;

        const nameColor = isHighlighted ? NAVY : TEXT_DK;

        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = isHighlighted ? 19 : 17;
        // BS hierarchy rows stay VISIBLE (like the app — all structural levels shown)
        // We don't set outlineLevel on structural rows, only on drill-down (leaves/dims/journal)

        const nc = dr.getCell(BS.name);
        nc.value = isHighlighted ? (node.name || '').toUpperCase() : node.name;
        nc.font = mkFont(isHighlighted, nameColor, 10);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: Math.max(1, depth + 1) };
        nc.border = mkBorder();

        setC(dr, BS.act, total, NUM_FMT, nameColor, isHighlighted, bg);
        if (bsHasB) {
          setC(dr, BS.cmp,  cVal, NUM_FMT, RED, isHighlighted, bg);
          setC(dr, BS.cmpD, dB,   NUM_FMT, devColor(dB), isHighlighted, bg);
          setC(dr, BS.cmpP, dBP,  PCT_FMT, devColor(dB), isHighlighted, bg);
        }
        if (bsHasC) {
          setC(dr, BS.cmp2,  c2Val, NUM_FMT, GRN, isHighlighted, bg);
          setC(dr, BS.cmp2D, dC,    NUM_FMT, devColor(dC), isHighlighted, bg);
          setC(dr, BS.cmp2P, dCP,   PCT_FMT, devColor(dC), isHighlighted, bg);
        }

        // Recurse children — structural rows stay visible
        (node.children || [])
          .filter(c => hasData(c) && c.accountType === 'B/S')
          .forEach(c => writeBSRow(c, depth + 1, 0));

        // Drill-down: local accounts (collapsed)
        (node.uploadLeaves || []).forEach(leaf => {
          if (leaf.type === 'plain') return;
          const lbg = LEAF_BG;
          ws.addRow([]);
          const lr = ws.lastRow;
          lr.height = 15;
          lr.outlineLevel = 1;
          lr.hidden = true;
          const lnc = lr.getCell(BS.name);
          lnc.value = `${leaf.code || ''} ${leaf.name || ''}`.trim();
          lnc.font = mkFont(false, TEXT_MUT, 9, true);
          lnc.fill = mkFill(lbg);
          lnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
          lnc.border = mkBorder();
          setC(lr, BS.act, leaf.amount, NUM_FMT, TEXT_MUT, false, lbg);
          if (bsHasB) { [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => { if (ci) { const c = lr.getCell(ci); c.value = ''; c.fill = mkFill(lbg); c.border = mkBorder(); }}); }
          if (bsHasC) { [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => { if (ci) { const c = lr.getCell(ci); c.value = ''; c.fill = mkFill(lbg); c.border = mkBorder(); }}); }

          (leaf.children || []).forEach(dim => {
            const dbg = DIM_BG;
            ws.addRow([]);
            const dr2 = ws.lastRow;
            dr2.height = 15;
            dr2.outlineLevel = 2;
            dr2.hidden = true;
            const dnc = dr2.getCell(BS.name);
            dnc.value = `◆ ${dim.name || dim.code || ''}`;
            dnc.font = mkFont(false, AMBER, 9);
            dnc.fill = mkFill(dbg);
            dnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
            dnc.border = mkBorder();
            setC(dr2, BS.act, dim.amount, NUM_FMT, AMBER, false, dbg);
            if (bsHasB) { [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => { if (ci) { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }}); }
            if (bsHasC) { [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => { if (ci) { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }}); }
          });
        });

        // Journal entries
        const jrns = jrnByCode.get(String(node.code)) || [];
        if (jrns.length > 0) {
          const hbg = JRN_BG;
          ws.addRow([]);
          const hr = ws.lastRow;
          hr.height = 15;
          hr.outlineLevel = 1;
          hr.hidden = true;
          const hnc = hr.getCell(BS.name);
          hnc.value = `📋 Journal entries (${jrns.length})`;
          hnc.font = mkFont(true, INDIGO, 9);
          hnc.fill = mkFill(hbg);
          hnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
          hnc.border = mkBorder();
          for (let c = 2; c <= bsCols; c++) {
            hr.getCell(c).fill = mkFill(hbg);
            hr.getCell(c).border = mkBorder();
          }
          jrns.forEach(j => {
            const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
            ws.addRow([]);
            const jr = ws.lastRow;
            jr.height = 14;
            jr.outlineLevel = 2;
            jr.hidden = true;
            const jnc = jr.getCell(BS.name);
            const jnum = j.JournalNumber ?? j.journalNumber ?? '';
            const jhdr = j.JournalHeader ?? j.journalHeader ?? '';
            jnc.value = `📄 ${jnum}${jhdr ? ' · ' + jhdr : ''}`;
            jnc.font = mkFont(false, INDIGO, 9);
            jnc.fill = mkFill(hbg);
            jnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
            jnc.border = mkBorder();
            setC(jr, BS.act, amt, NUM_FMT, INDIGO, false, hbg);
            if (bsHasB) { [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => { if (ci) { const c = jr.getCell(ci); c.value = ''; c.fill = mkFill(hbg); c.border = mkBorder(); }}); }
            if (bsHasC) { [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => { if (ci) { const c = jr.getCell(ci); c.value = ''; c.fill = mkFill(hbg); c.border = mkBorder(); }}); }
          });
        }
      };

      const bsRoots = tree
        .filter(n => hasData(n) && n.accountType === 'B/S')
        .filter(n => !filterFn || filterFn(n))
        .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

      bsRoots.forEach(n => writeBSRow(n, 0, 0));
    };

    // BUILD SHEETS
    const isAssetsRoot = n => {
      const name = (n.name ?? '').toLowerCase();
      return name.includes('asset') || name.includes('activo');
    };

    if (opts.plSummary !== false) buildPLSheet(wb.addWorksheet('P&L Summary'), true);
    if (opts.plDetailed !== false) buildPLSheet(wb.addWorksheet('P&L Detailed'), false);
    if (opts.bsSummary !== false) buildBSSheet(wb.addWorksheet('BS Summary'), 'Summary', null);
    if (opts.bsAssets !== false) buildBSSheet(wb.addWorksheet('BS Assets'), 'Assets', n => isAssetsRoot(n));
    if (opts.bsEquity !== false) buildBSSheet(wb.addWorksheet('BS Equity & Liab'), 'Equity & Liabilities', n => !isAssetsRoot(n));

    // ═══════════════════════════════════════════════════════════
    // DIMENSIONS & JOURNAL SHEET
    // ═══════════════════════════════════════════════════════════
    if (opts.dimJournal !== false) {
      const ws = wb.addWorksheet('Dimensions & Journal');
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      // Dimensions title
      ws.addRow([]);
      const r1 = ws.lastRow;
      r1.height = 30;
      r1.getCell(1).value = 'DIMENSIONS';
      r1.getCell(1).font = mkFont(true, WHITE, 13);
      r1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 1; c <= 9; c++) r1.getCell(c).fill = mkFill(AMBER);
      ws.mergeCells(1, 1, 1, 9);

      ws.addRow([]);
      const rs = ws.lastRow;
      rs.height = 16;
      rs.getCell(1).value = `${aLabel} · ${structure}`;
      rs.getCell(1).font = mkFont(false, 'FFFDE5C3', 9);
      rs.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      for (let c = 1; c <= 9; c++) rs.getCell(c).fill = mkFill(AMBER);
      ws.mergeCells(2, 1, 2, 9);

      ws.addRow([]);
      const rh = ws.lastRow;
      rh.height = 22;
      const dimHeaders = ['Account Code', 'Account Name', 'Dim Code', 'Dim Name', 'Local Account', 'Amount YTD', 'Company', 'Currency', 'Type'];
      dimHeaders.forEach((h, i) => {
        const c = rh.getCell(i + 1);
        c.value = h;
        c.font = mkFont(true, WHITE, 9);
        c.fill = mkFill(NAVY);
        const align = i < 2 || i === 4 ? 'left' : (i === 5 ? 'right' : 'center');
        c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
        c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
      });
      [14, 36, 10, 26, 24, 15, 14, 11, 12].forEach((w, i) => ws.getColumn(i + 1).width = w);

      const dimRows = uploadedAccounts.filter(row => {
        const dc = getField(row, 'dimensionCode');
        return dc != null && String(dc) !== '' && String(dc) !== 'null';
      });
      dimRows.forEach((row, i) => {
        ws.addRow([
          String(getField(row, 'accountCode') ?? ''),
          String(getField(row, 'accountName') ?? ''),
          String(getField(row, 'dimensionCode') ?? ''),
          String(getField(row, 'dimensionName') ?? ''),
          String(getField(row, 'localAccountCode') ?? ''),
          parseAmt(getField(row, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')),
          String(getField(row, 'companyShortName', 'CompanyShortName') ?? ''),
          String(getField(row, 'CurrencyCode', 'currencyCode') ?? ''),
          'Uploaded',
        ]);
        const dr = ws.lastRow;
        dr.height = 16;
        for (let j = 1; j <= 9; j++) {
          const c = dr.getCell(j);
          c.font = mkFont(false, TEXT_DK, 9);
          c.fill = mkFill(i % 2 === 0 ? WHITE : STRIPE);
          c.border = mkBorder();
          const align = j < 3 || j === 5 ? 'left' : (j === 6 ? 'right' : 'center');
          c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
          if (j === 6) c.numFmt = NUM_FMT;
          if (j === 9) {
            c.font = mkFont(true, AMBER, 9);
          }
        }
      });

      if (journalEntries?.length > 0) {
        ws.addRow([]);
        ws.addRow([]);
        const jr1 = ws.lastRow;
        jr1.height = 30;
        jr1.getCell(1).value = 'JOURNAL ENTRIES';
        jr1.getCell(1).font = mkFont(true, WHITE, 13);
        jr1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        for (let c = 1; c <= 9; c++) jr1.getCell(c).fill = mkFill(INDIGO);
        ws.mergeCells(jr1.number, 1, jr1.number, 9);

        ws.addRow([]);
        const rjh = ws.lastRow;
        rjh.height = 22;
        const jHeaders = ['Journal #', 'Header', 'Row Text', 'Account Code', 'Account Name', 'Account Type', 'Amount YTD', 'Currency', 'Dimension'];
        jHeaders.forEach((h, i) => {
          const c = rjh.getCell(i + 1);
          c.value = h;
          c.font = mkFont(true, WHITE, 9);
          c.fill = mkFill(NAVY);
          const align = i < 3 || i === 4 ? 'left' : (i === 6 ? 'right' : 'center');
          c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
          c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
        });

        journalEntries.forEach((j, i) => {
          const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
          ws.addRow([
            j.JournalNumber ?? j.journalNumber ?? '',
            j.JournalHeader ?? j.journalHeader ?? '',
            j.RowText ?? j.rowText ?? '',
            j.AccountCode ?? j.accountCode ?? '',
            j.AccountName ?? j.accountName ?? '',
            j.AccountType ?? j.accountType ?? '',
            amt,
            j.CurrencyCode ?? j.currencyCode ?? '',
            j.DimensionName ?? j.dimensionName ?? '',
          ]);
          const dr = ws.lastRow;
          dr.height = 16;
          for (let k = 1; k <= 9; k++) {
            const c = dr.getCell(k);
            c.font = mkFont(false, TEXT_DK, 9);
            c.fill = mkFill(i % 2 === 0 ? WHITE : 'FFF5F3FF');
            c.border = mkBorder();
            const align = k < 4 || k === 5 ? 'left' : (k === 7 ? 'right' : 'center');
            c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
            if (k === 7) c.numFmt = NUM_FMT;
            if (k === 1) c.font = mkFont(true, INDIGO, 9);
          }
        });
      }
    }

    // WRITE & POST-PROCESS
    const buf = await wb.xlsx.writeBuffer();

    const fixXlsx = async (inputBuf) => {
      const JSZip = window.JSZip;
      if (!JSZip) return inputBuf;
      const zip = await JSZip.loadAsync(inputBuf);
      const sheetFiles = Object.keys(zip.files).filter(f => f.match(/xl\/worksheets\/sheet\d+\.xml/));
      for (const fname of sheetFiles) {
        let content = await zip.file(fname).async('string');
        content = content.replace(/ collapsed="1"/g, '');
        if (!content.includes('<outlinePr')) {
          if (content.includes('<sheetPr/>')) {
            content = content.replace(/<sheetPr\/>/g, '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>');
          } else if (content.includes('<sheetPr>')) {
            content = content.replace(/<sheetPr>/g, '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/>');
          } else {
            content = content.replace(
              /(<worksheet[^>]*>)/,
              '$1<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>'
            );
          }
        }
        zip.file(fname, content);
      }
      return await zip.generateAsync({ type: 'arraybuffer' });
    };

    const finalBuf = await fixXlsx(buf);
    const blob = new Blob([finalBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Konsolidator_${year}_${String(month).padStart(2, '0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const load = src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  Promise.all([
    load('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js'),
    load('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
  ]).then(() => doGenerate(window.ExcelJS))
    .catch(e => alert('Could not load library: ' + e.message));
}

function generateKonsolidatorPdf({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
 bsCompareMode = false,
  bsCmpUploadedAccounts = [], bsCmpFilters = {},
  bsCmp2UploadedAccounts = [], bsCmp2Filters = {},
  cmp2Enabled = true,
  bsCmp2Enabled = true,
  month, year, source, structure,
  journalEntries = [],
  opts = {},
}) {
  function doGenerate(jsPDF, autoTable) {
    const NAVY=[20,36,112],NAVYDK=[10,20,70],NAVYMID=[30,50,140];
    const RED=[207,48,93],REDDK=[160,30,65];
    const GRN=[52,168,113],GRNDK=[30,110,70];
    const AMBER=[220,120,40];
    const LIGHT=[238,241,251],STRIPE=[248,249,255],WHITE=[255,255,255];
    const GRAY=[140,150,175],GRAYLT=[210,215,230],TEXTDK=[20,35,80];

    const monthLabel=MONTHS.find(m=>String(m.value)===String(month))?.label??month;
    const cmpMoLabel=MONTHS.find(m=>String(m.value)===String(cmpFilters?.month))?.label??cmpFilters?.month;
    const cmp2MoLabel=MONTHS.find(m=>String(m.value)===String(cmp2Filters?.month))?.label??cmp2Filters?.month;
    const cmpLabel=compareMode?[cmpMoLabel,cmpFilters?.year,cmpFilters?.source,cmpFilters?.structure,cmpFilters?.company].filter(Boolean).join(' · '):'';
    const cmp2Label=compareMode?[cmp2MoLabel,cmp2Filters?.year,cmp2Filters?.source,cmp2Filters?.structure,cmp2Filters?.company].filter(Boolean).join(' · '):'';

    // ── Build trees ──────────────────────────────────────────
    const tree=buildTree(groupAccounts,uploadedAccounts);
    const prevTree=buildTree(groupAccounts,prevUploadedAccounts);
    const cmpTree=compareMode?buildTree(groupAccounts,cmpUploadedAccounts):[];
    const cmpPrevTree=compareMode?buildTree(groupAccounts,cmpPrevUploadedAccounts):[];
    const cmp2Tree=compareMode?buildTree(groupAccounts,cmp2UploadedAccounts):[];
    const cmp2PrevTree=compareMode?buildTree(groupAccounts,cmp2PrevUploadedAccounts):[];

    const nodeMapF=t=>{const m=new Map();const w=n=>{m.set(n.code,n);n.children?.forEach(w);};t.forEach(w);return m;};
    const prevMap=nodeMapF(prevTree),cmpMap=nodeMapF(cmpTree),cmpPrevMap=nodeMapF(cmpPrevTree),cmp2Map=nodeMapF(cmp2Tree),cmp2PrevMap=nodeMapF(cmp2PrevTree);
    const getYtd=(map,code)=>{const n=map.get(code);return n?sumNode(n):0;};
    const getPrev=(map,code,mo)=>Number(mo)===1?0:getYtd(map,code);
    const fmtN=n=>typeof n==='number'&&!isNaN(n)?n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
    const plAmt=n=>n===0?'—':n<0?`(${fmtN(Math.abs(n))})`:fmtN(n);
    const devPct=(a,b)=>{if(!b)return'—';const p=(a-b)/Math.abs(b)*100;return`${p>=0?'+':''}${p.toFixed(1)}%`;};
    const devAmt=(a,b)=>{const d=a-b;return d===0?'—':d<0?`(${fmtN(Math.abs(d))})`:fmtN(d);};

    const isLandscape=compareMode||bsCompareMode;
    const doc=new jsPDF({orientation:isLandscape?'landscape':'portrait',unit:'mm',format:'a4'});
    const W=doc.internal.pageSize.getWidth();
    const H=doc.internal.pageSize.getHeight();
    let pageNum=0;
    let currentSection='';

// ── Page header ──────────────────────────────────────────
    const drawHeader=(sectionTitle,isFirst,useCmp=null,useL1=null,useL2=null)=>{
      if(!isFirst)doc.addPage();
      pageNum++;
      currentSection=sectionTitle;
      const activeCmp=useCmp??compareMode;
      const activeL1=useL1??cmpLabel;
      const activeL2=useL2??cmp2Label;

      // Full navy band
      doc.setFillColor(...NAVY);
      doc.rect(0,0,W,activeCmp?38:32,'F');

      // Accent bar
      doc.setFillColor(...RED);
      doc.rect(0,0,3,activeCmp?38:32,'F');

      // Title
      doc.setFont('helvetica','bold');
      doc.setFontSize(14);
      doc.setTextColor(...WHITE);
      doc.text(sectionTitle,9,12);

      // Period A
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.5);
      doc.setTextColor(180,200,255);
      doc.text(`A: ${monthLabel} ${year}  ·  ${source}  ·  ${structure}`,9,20);

      if(activeCmp){
        // Period B
        doc.setFillColor(...REDDK);
        doc.roundedRect(9,23,W-18,5,1,1,'F');
        doc.setFont('helvetica','bold');doc.setFontSize(6.5);doc.setTextColor(...WHITE);
        doc.text('B',12,26.8);
        doc.setFont('helvetica','normal');doc.setFontSize(6.5);
        doc.text(activeL1||'—',18,26.8);
        // Period C
        doc.setFillColor(...GRNDK);
        doc.roundedRect(9,30,W-18,5,1,1,'F');
        doc.setFont('helvetica','bold');doc.setFontSize(6.5);doc.setTextColor(...WHITE);
        doc.text('C',12,33.8);
        doc.setFont('helvetica','normal');doc.setFontSize(6.5);
        doc.text(activeL2||'—',18,33.8);
      }

      // Page badge top-right
      doc.setFillColor(...NAVYDK);
      doc.roundedRect(W-22,4,18,7,1.5,1.5,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(6.5);doc.setTextColor(160,185,255);
      doc.text(`p. ${pageNum}`,W-13,8.2,{align:'center'});

      // Separator
      doc.setDrawColor(...NAVYMID);doc.setLineWidth(0.3);
      doc.line(0,activeCmp?38:32,W,activeCmp?38:32);

      return (activeCmp?38:32)+4;
    };

    // ── Footer ───────────────────────────────────────────────
    const drawFooter=()=>{
      doc.setFillColor(...LIGHT);
      doc.rect(0,H-8,W,8,'F');
      doc.setDrawColor(...GRAYLT);doc.setLineWidth(0.2);
      doc.line(0,H-8,W,H-8);
      doc.setFont('helvetica','bold');doc.setFontSize(6);doc.setTextColor(...NAVY);
      doc.text('KONSOLIDATOR',8,H-3.5);
      doc.setFont('helvetica','normal');doc.setTextColor(...GRAY);
      doc.text(`${currentSection}  ·  ${monthLabel} ${year}  ·  ${source}`,30,H-3.5);
      doc.setFont('helvetica','bold');doc.setFontSize(6.5);doc.setTextColor(...NAVY);
      doc.text(String(pageNum),W-8,H-3.5,{align:'right'});
    };



    // ── PL flat rows (same logic as xlsx) ───────────────────
    const plFlatRows=(nodes)=>{
      const rows=[];
      const walk=(node,d)=>{
        if(!hasData(node)||!['P/L','DIS'].includes(node.accountType))return;
        const ytd=-sumNode(node),prev=-getPrev(prevMap,node.code,month),mon=ytd-prev;
        const cmpYtd=compareMode?-getYtd(cmpMap,node.code):null;
        const cmpPrev=compareMode?-getPrev(cmpPrevMap,node.code,cmpFilters?.month):null;
        const cmpMon=compareMode?cmpYtd-cmpPrev:null;
        const cmp2Ytd=compareMode?-getYtd(cmp2Map,node.code):null;
        const cmp2Prev=compareMode?-getPrev(cmp2PrevMap,node.code,cmp2Filters?.month):null;
        const cmp2Mon=compareMode?cmp2Ytd-cmp2Prev:null;
        rows.push({label:'  '.repeat(d)+node.name,mon,ytd,cmpMon,cmpYtd,cmp2Mon,cmp2Ytd,isBold:node.isSumAccount,depth:d,isLeaf:false,isDim:false,isJrn:false});
        if(opts.drillDown){
          node.uploadLeaves?.forEach(leaf=>{
            if(leaf.type==='plain')return;
            rows.push({label:'  '.repeat(d+1)+' '+( leaf.name||leaf.code||''),mon:-(leaf.amount),ytd:-(leaf.amount),cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null,isBold:false,depth:d+1,isLeaf:true,isDim:false,isJrn:false});
            leaf.children?.forEach(dim=>{
              rows.push({label:'  '.repeat(d+2)+'◆ '+(dim.name||dim.code),mon:-(dim.amount),ytd:-(dim.amount),cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null,isBold:false,depth:d+2,isLeaf:false,isDim:true,isJrn:false});
            });
          });
          const jrns=(journalEntries||[]).filter(j=>String(j.AccountCode??j.accountCode??'')=== node.code);
          if(jrns.length>0){
            rows.push({label:'  '.repeat(d+1)+'📋 Journal entries ('+jrns.length+')',mon:null,ytd:null,cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null,isBold:false,depth:d+1,isLeaf:false,isDim:false,isJrn:true,isJrnHeader:true});
            jrns.forEach(j=>{
              const amt=parseAmt(j.AmountYTD??j.amountYTD??0);
              rows.push({label:'  '.repeat(d+2)+'📄 '+(j.JournalNumber??j.journalNumber??'')+(j.JournalHeader??j.journalHeader?' · '+(j.JournalHeader??j.journalHeader):''),mon:-amt,ytd:-amt,cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null,isBold:false,depth:d+2,isLeaf:false,isDim:false,isJrn:true});
            });
          }
        }
        node.children?.filter(c=>hasData(c)&&['P/L','DIS'].includes(c.accountType)).forEach(c=>walk(c,d+1));
      };
      nodes.filter(n=>hasData(n)&&['P/L','DIS'].includes(n.accountType)).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).forEach(n=>walk(n,0));
      return rows;
    };

    // ── BS flat rows ─────────────────────────────────────────
    const bsFlatRows=(nodes,filterFn=null,summaryOnly=false)=>{
      const rows=[];
      const walk=(node,d)=>{
        if(!hasData(node)||node.accountType!=='B/S')return;
        const total=Number(node.code)>=599999?-sumNode(node):sumNode(node);
        rows.push({label:'  '.repeat(d)+node.name,total,isBold:BS_HIGHLIGHTED_CODES.has(String(node.code)),depth:d,isDim:false,isJrn:false});
        if(!summaryOnly){
          if(opts.drillDown){
            node.uploadLeaves?.forEach(leaf=>{
              if(leaf.type==='plain')return;
              rows.push({label:'  '.repeat(d+1)+' '+(leaf.name||leaf.code||''),total:leaf.amount,isBold:false,depth:d+1,isDim:false,isJrn:false,isLeaf:true});
              leaf.children?.forEach(dim=>{
                rows.push({label:'  '.repeat(d+2)+'◆ '+(dim.name||dim.code),total:dim.amount,isBold:false,depth:d+2,isDim:true,isJrn:false});
              });
            });
            const jrns=(journalEntries||[]).filter(j=>String(j.AccountCode??j.accountCode??'')=== node.code);
            if(jrns.length>0){
              rows.push({label:'  '.repeat(d+1)+'📋 Journal entries ('+jrns.length+')',total:null,isBold:false,depth:d+1,isDim:false,isJrn:true,isJrnHeader:true});
              jrns.forEach(j=>{
                const amt=parseAmt(j.AmountYTD??j.amountYTD??0);
                rows.push({label:'  '.repeat(d+2)+'📄 '+(j.JournalNumber??j.journalNumber??''),total:amt,isBold:false,depth:d+2,isDim:false,isJrn:true});
              });
            }
          }
          node.children?.filter(hasData).forEach(c=>walk(c,d+1));
        }
      };
      nodes.filter(n=>!filterFn||filterFn(n)).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).forEach(n=>walk(n,0));
      return rows;
    };

const isAssetsRoot=n=>(n.name??'').toLowerCase().includes('asset')||(n.name??'').toLowerCase().includes('activo');
    const bsRoots=tree.filter(n=>hasData(n)&&n.accountType==='B/S').sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}));
    const bsCmpRoots=bsCompareMode?buildTree(groupAccounts,bsCmpUploadedAccounts).filter(n=>hasData(n)&&n.accountType==='B/S'):[];
    const bsCmp2Roots=bsCompareMode?buildTree(groupAccounts,bsCmp2UploadedAccounts).filter(n=>hasData(n)&&n.accountType==='B/S'):[];
    const bsCmpLabel=bsCompareMode?[bsCmpFilters?.month?MONTHS.find(m=>String(m.value)===String(bsCmpFilters.month))?.label:'',bsCmpFilters?.year,bsCmpFilters?.source,bsCmpFilters?.structure,bsCmpFilters?.company].filter(Boolean).join(' · '):'';
    const bsCmp2Label=bsCompareMode?[bsCmp2Filters?.month?MONTHS.find(m=>String(m.value)===String(bsCmp2Filters.month))?.label:'',bsCmp2Filters?.year,bsCmp2Filters?.source,bsCmp2Filters?.structure,bsCmp2Filters?.company].filter(Boolean).join(' · '):'';

    // ── PL columns ───────────────────────────────────────────
const makePLCols=()=>compareMode?[
      {header:'Account',dataKey:'label'},
      {header:'Monthly',dataKey:'mon'},
      {header:'B Mon',dataKey:'cmpMon'},
      {header:'Diff',dataKey:'devMon'},
      {header:'Diff%',dataKey:'devMonP'},
      ...(cmp2Enabled?[
        {header:'C Mon',dataKey:'cmp2Mon'},
        {header:'Diff',dataKey:'devMon2'},
        {header:'Diff%',dataKey:'devMon2P'},
      ]:[]),
      {header:'YTD',dataKey:'ytd'},
      {header:'B YTD',dataKey:'cmpYtd'},
      {header:'Diff',dataKey:'devYtd'},
      {header:'Diff%',dataKey:'devYtdP'},
      ...(cmp2Enabled?[
        {header:'C YTD',dataKey:'cmp2Ytd'},
        {header:'Diff',dataKey:'devYtd2'},
        {header:'Diff%',dataKey:'devYtd2P'},
      ]:[]),
    ]:[
      {header:'Account',dataKey:'label'},
      {header:'Monthly',dataKey:'mon'},
      {header:'YTD',dataKey:'ytd'},
    ];

    const toPLRow=r=>{
      const base={label:r.label,mon:r.mon!=null?plAmt(r.mon):'',ytd:r.ytd!=null?plAmt(r.ytd):'',_r:r};
      if(!compareMode)return base;
      return{...base,
        cmpMon:r.cmpMon!=null?plAmt(r.cmpMon):'',devMon:r.cmpMon!=null?devAmt(r.mon??0,r.cmpMon):'',devMonP:r.cmpMon!=null?devPct(r.mon??0,r.cmpMon):'',
        cmp2Mon:r.cmp2Mon!=null?plAmt(r.cmp2Mon):'',devMon2:r.cmp2Mon!=null?devAmt(r.mon??0,r.cmp2Mon):'',devMon2P:r.cmp2Mon!=null?devPct(r.mon??0,r.cmp2Mon):'',
        cmpYtd:r.cmpYtd!=null?plAmt(r.cmpYtd):'',devYtd:r.cmpYtd!=null?devAmt(r.ytd??0,r.cmpYtd):'',devYtdP:r.cmpYtd!=null?devPct(r.ytd??0,r.cmpYtd):'',
        cmp2Ytd:r.cmp2Ytd!=null?plAmt(r.cmp2Ytd):'',devYtd2:r.cmp2Ytd!=null?devAmt(r.ytd??0,r.cmp2Ytd):'',devYtd2P:r.cmp2Ytd!=null?devPct(r.ytd??0,r.cmp2Ytd):'',
      };
    };

    const plDidParse=(data)=>{
      if(data.section==='head'){
        data.cell.styles.halign=data.column.dataKey==='label'?'left':'right';
        if(['cmpMon','devMon','devMonP','cmpYtd','devYtd','devYtdP'].includes(data.column.dataKey))data.cell.styles.fillColor=REDDK;
        if(['cmp2Mon','devMon2','devMon2P','cmp2Ytd','devYtd2','devYtd2P'].includes(data.column.dataKey))data.cell.styles.fillColor=GRNDK;
        return;
      }
      const r=data.row.raw._r;
      if(!r)return;
      const col=data.column.dataKey;
      if(r.isBold){data.cell.styles.fillColor=LIGHT;data.cell.styles.fontStyle='bold';if(col==='label')data.cell.styles.textColor=NAVY;}
      if(r.isDim){data.cell.styles.textColor=AMBER;}
      if(r.isJrn&&!r.isJrnHeader){data.cell.styles.textColor=[100,110,200];}
      if(r.isJrnHeader){data.cell.styles.textColor=[80,90,180];data.cell.styles.fontStyle='bold';}
      if(r.isLeaf){data.cell.styles.textColor=GRAY;}
      if(col!=='label')data.cell.styles.halign='right';
      const isPos=v=>typeof v==='string'&&!v.startsWith('(')&&v!=='—'&&v!=='';
      const isNeg=v=>typeof v==='string'&&v.startsWith('(');
      if(['devMon','devYtd','devMon2','devYtd2'].includes(col)){
        const v=data.cell.text[0];
        data.cell.styles.textColor=isPos(v)?GRN:isNeg(v)?RED:GRAY;
      }
      if(['devMonP','devYtdP','devMon2P','devYtd2P'].includes(col)){
        const v=data.cell.text[0];
        data.cell.styles.textColor=isPos(v)?GRN:isNeg(v)?RED:GRAY;
        data.cell.styles.fontStyle='bold';
      }
      if(['cmpMon','cmpYtd'].includes(col))data.cell.styles.textColor=r.isBold?REDDK:RED;
      if(['cmp2Mon','cmp2Ytd'].includes(col))data.cell.styles.textColor=r.isBold?GRNDK:GRN;
    };

    // ── BS columns ───────────────────────────────────────────
const makeBSCols=()=>bsCompareMode?[
      {header:'Account',dataKey:'label'},
      {header:'Actual',dataKey:'total'},
      {header:'B',dataKey:'cmp'},
      {header:'Diff',dataKey:'devB'},
      {header:'Diff%',dataKey:'devBP'},
      ...(bsCmp2Enabled?[
        {header:'C',dataKey:'cmp2'},
        {header:'Diff',dataKey:'devC'},
        {header:'Diff%',dataKey:'devCP'},
      ]:[]),
    ]:[
      {header:'Account',dataKey:'label'},
      {header:'Amount',dataKey:'total'},
    ];

    const makeBSRowLookup=(rows)=>{
      const m=new Map();rows.forEach(r=>m.set(`${r.depth}|${r.label.trim()}`,r.total));return m;
    };

const toBSRow=(r,cmpLookup,cmp2Lookup)=>{
      const base={label:r.label,total:r.total!=null?fmtN(r.total):'',_r:r};
      if(!bsCompareMode)return base;
      const key=`${r.depth}|${r.label.trim()}`;
      const cv=cmpLookup?.get(key)??null;const c2v=cmp2Lookup?.get(key)??null;
      return{...base,
        cmp:cv!=null?fmtN(cv):'',devB:cv!=null?devAmt(r.total??0,cv):'',devBP:cv!=null?devPct(r.total??0,cv):'',
        cmp2:c2v!=null?fmtN(c2v):'',devC:c2v!=null?devAmt(r.total??0,c2v):'',devCP:c2v!=null?devPct(r.total??0,c2v):'',
      };
    };

    const bsDidParse=(data)=>{
      if(data.section==='head'){
        data.cell.styles.halign=data.column.dataKey==='label'?'left':'right';
        if(['cmp','devB','devBP'].includes(data.column.dataKey))data.cell.styles.fillColor=REDDK;
        if(['cmp2','devC','devCP'].includes(data.column.dataKey))data.cell.styles.fillColor=GRNDK;
        return;
      }
      const r=data.row.raw._r;if(!r)return;
      const col=data.column.dataKey;
      if(r.isBold){data.cell.styles.fillColor=LIGHT;data.cell.styles.fontStyle='bold';if(col==='label')data.cell.styles.textColor=NAVY;}
      if(r.isDim)data.cell.styles.textColor=AMBER;
      if(r.isJrn&&!r.isJrnHeader)data.cell.styles.textColor=[100,110,200];
      if(r.isJrnHeader){data.cell.styles.textColor=[80,90,180];data.cell.styles.fontStyle='bold';}
      if(col!=='label')data.cell.styles.halign='right';
      const isPos=v=>typeof v==='string'&&!v.startsWith('(')&&v!=='—'&&v!=='';
      const isNeg=v=>typeof v==='string'&&v.startsWith('(');
      if(['devB','devC'].includes(col)){const v=data.cell.text[0];data.cell.styles.textColor=isPos(v)?GRN:isNeg(v)?RED:GRAY;}
      if(['devBP','devCP'].includes(col)){const v=data.cell.text[0];data.cell.styles.textColor=isPos(v)?GRN:isNeg(v)?RED:GRAY;data.cell.styles.fontStyle='bold';}
      if(col==='cmp')data.cell.styles.textColor=r.isBold?REDDK:RED;
      if(col==='cmp2')data.cell.styles.textColor=r.isBold?GRNDK:GRN;
    };

const plColStyles=()=>{
      const usable=W-16;
      if(!compareMode)return{label:{cellWidth:usable*0.60},mon:{cellWidth:usable*0.20,halign:'right'},ytd:{cellWidth:usable*0.20,halign:'right'}};
      // 15 cols: label + 6 value cols (mon,B,C,ytd,Bytd,Cytd) + 4 diff cols + 4 pct cols
      // Total must = usable. Let's be explicit in mm for A4 landscape (281mm usable)
      // label=68, each value=22, each diff=18, each pct=14 → 68+6*22+4*18+4*14=68+132+72+56=328 too wide
      // Reduce: label=60, value=19, diff=15, pct=12 → 60+6*19+4*15+4*12=60+114+60+48=282 ✓
      const lw=usable*0.213,vw=usable*0.0676,dw=usable*0.0534,pw=usable*0.0427;
      return{
        label:{cellWidth:lw},
        mon:{cellWidth:vw,halign:'right'},
        cmpMon:{cellWidth:vw,halign:'right'},
        devMon:{cellWidth:dw,halign:'right'},
        devMonP:{cellWidth:pw,halign:'right'},
        cmp2Mon:{cellWidth:vw,halign:'right'},
        devMon2:{cellWidth:dw,halign:'right'},
        devMon2P:{cellWidth:pw,halign:'right'},
        ytd:{cellWidth:vw,halign:'right'},
        cmpYtd:{cellWidth:vw,halign:'right'},
        devYtd:{cellWidth:dw,halign:'right'},
        devYtdP:{cellWidth:pw,halign:'right'},
        cmp2Ytd:{cellWidth:vw,halign:'right'},
        devYtd2:{cellWidth:dw,halign:'right'},
        devYtd2P:{cellWidth:pw,halign:'right'},
      };
    };
    const bsColStyles=()=>{
      const usable=W-16;
      if(!bsCompareMode)return{label:{cellWidth:usable*0.62},total:{cellWidth:usable*0.38,halign:'right'}};
      // 8 cols: label + actual + B + diffB + pctB + C + diffC + pctC
      // label=30%, 3 values=13%, 2 diffs=9%, 2 pcts=6.5% → 30+39+18+13=100 ✓
      const lw=usable*0.30,vw=usable*0.130,dw=usable*0.090,pw=usable*0.065;
      return{
        label:{cellWidth:lw},
        total:{cellWidth:vw,halign:'right'},
        cmp:{cellWidth:vw,halign:'right'},
        devB:{cellWidth:dw,halign:'right'},
        devBP:{cellWidth:pw,halign:'right'},
        cmp2:{cellWidth:vw,halign:'right'},
        devC:{cellWidth:dw,halign:'right'},
        devCP:{cellWidth:pw,halign:'right'},
      };
    };

// ── Render a table page ──────────────────────────────────
const renderPage=(sectionTitle,isFirst,cols,body,didParse,colStyles,useCmp=null,useL1=null,useL2=null)=>{
      const startY=drawHeader(sectionTitle,isFirst,useCmp,useL1,useL2);
      const isCompact=compareMode||(useCmp??false);
      autoTable(doc,{
        startY,columns:cols,body,
        margin:{left:8,right:8,bottom:12},
        tableWidth:'auto',
        styles:{fontSize:isCompact?5.8:7.5,cellPadding:{top:isCompact?1.8:3,bottom:isCompact?1.8:3,left:isCompact?2:4,right:isCompact?2:4},overflow:'ellipsize',lineColor:GRAYLT,lineWidth:0.1,font:'helvetica',textColor:TEXTDK},
        headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:'bold',fontSize:isCompact?5.5:7,cellPadding:{top:3,bottom:3,left:isCompact?2:4,right:isCompact?2:4},lineWidth:0,overflow:'ellipsize'},
        columnStyles:colStyles,
        alternateRowStyles:{fillColor:STRIPE},
        didParseCell:didParse,
        didDrawPage:()=>drawFooter(),
      });
    };

    let isFirst=true;

    // ── P&L Summary ──────────────────────────────────────────
    if(opts.plSummary){
      const sumRows=[];
      const walkSum=node=>{
        if(!hasData(node)||!['P/L','DIS'].includes(node.accountType))return;
        node.children?.forEach(c=>walkSum(c));
        if(node.isSumAccount)sumRows.push(node);
      };
      tree.filter(n=>hasData(n)&&['P/L','DIS'].includes(n.accountType)).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).forEach(n=>walkSum(n));
      const byLevel={};
      sumRows.filter(n=>n.accountType==='P/L').forEach(n=>{if(!byLevel[n.level]||Number(n.code)<Number(byLevel[n.level].code))byLevel[n.level]=n;});
      const summaryNodes=Object.values(byLevel).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}));
      const flatRows=summaryNodes.map(node=>{
        const ytd=-sumNode(node),prev=-getPrev(prevMap,node.code,month),mon=ytd-prev;
        const cmpYtd=compareMode?-getYtd(cmpMap,node.code):null,cmpPrev=compareMode?-getPrev(cmpPrevMap,node.code,cmpFilters?.month):null,cmpMon=compareMode?cmpYtd-cmpPrev:null;
        const cmp2Ytd=compareMode?-getYtd(cmp2Map,node.code):null,cmp2Prev=compareMode?-getPrev(cmp2PrevMap,node.code,cmp2Filters?.month):null,cmp2Mon=compareMode?cmp2Ytd-cmp2Prev:null;
        return{label:node.name,mon,ytd,cmpMon,cmpYtd,cmp2Mon,cmp2Ytd,isBold:true,depth:0,isLeaf:false,isDim:false,isJrn:false};
      });
      renderPage('P&L — Summary',isFirst,makePLCols(),flatRows.map(toPLRow),plDidParse,plColStyles());
      isFirst=false;
    }

    // ── P&L Detailed ─────────────────────────────────────────
    if(opts.plDetailed){
      renderPage('P&L — Detailed',isFirst,makePLCols(),plFlatRows(tree).map(toPLRow),plDidParse,plColStyles());
      isFirst=false;
    }


    // ── BS Summary ───────────────────────────────────────────
    if(opts.bsSummary){
      const bsSumFl=[];
      const walkBSSum=(node,d)=>{
        if(!hasData(node)||node.accountType!=='B/S')return;
        const total=Number(node.code)>=599999?-sumNode(node):sumNode(node);
        bsSumFl.push({label:'  '.repeat(d)+node.name,total,isBold:BS_HIGHLIGHTED_CODES.has(String(node.code)),depth:d,isDim:false,isJrn:false});
        node.children?.filter(hasData).forEach(c=>walkBSSum(c,d+1));
      };
      bsRoots.forEach(n=>walkBSSum(n,0));
const cmpFL=bsCompareMode?bsFlatRows(bsCmpRoots):[];
const cmp2FL=bsCompareMode?bsFlatRows(bsCmp2Roots):[];
      const cmpLookup=makeBSRowLookup(cmpFL),cmp2Lookup=makeBSRowLookup(cmp2FL);
renderPage('Balance Sheet — Summary',isFirst,makeBSCols(),bsSumFl.map(r=>toBSRow(r,cmpLookup,cmp2Lookup)),bsDidParse,bsColStyles(),bsCompareMode,bsCmpLabel,bsCmp2Label);
      isFirst=false;
    }

    // ── BS Assets ────────────────────────────────────────────
    if(opts.bsAssets){
      const rows=bsFlatRows(bsRoots,isAssetsRoot);
      const cmpFL=bsCompareMode?bsFlatRows(bsCmpRoots,isAssetsRoot):[];
      const cmp2FL=bsCompareMode?bsFlatRows(bsCmp2Roots,isAssetsRoot):[];
      const cmpLookup=makeBSRowLookup(cmpFL),cmp2Lookup=makeBSRowLookup(cmp2FL);
      renderPage('Balance Sheet — Assets',isFirst,makeBSCols(),rows.map(r=>toBSRow(r,cmpLookup,cmp2Lookup)),bsDidParse,bsColStyles(),bsCompareMode,bsCmpLabel,bsCmp2Label);
      isFirst=false;
    }

    // ── BS Equity & Liabilities ───────────────────────────────
    if(opts.bsEquity){
      const rows=bsFlatRows(bsRoots,n=>!isAssetsRoot(n));
      const cmpFL=bsCompareMode?bsFlatRows(bsCmpRoots,n=>!isAssetsRoot(n)):[];
      const cmp2FL=bsCompareMode?bsFlatRows(bsCmp2Roots,n=>!isAssetsRoot(n)):[];
      const cmpLookup=makeBSRowLookup(cmpFL),cmp2Lookup=makeBSRowLookup(cmp2FL);
      renderPage('Balance Sheet — Equity & Liab.',isFirst,makeBSCols(),rows.map(r=>toBSRow(r,cmpLookup,cmp2Lookup)),bsDidParse,bsColStyles(),bsCompareMode,bsCmpLabel,bsCmp2Label);
      isFirst=false;
    }

    // ── Dimensions & Journal ─────────────────────────────────
    if(opts.dimJournal!==false){
      const startY=drawHeader('Dimensions & Journal',isFirst);
      // Dims table
      if(uploadedAccounts.length>0){
        const dimCols=[
          {header:'Account',dataKey:'acc'},
          {header:'Dimension',dataKey:'dim'},
          {header:'Local Account',dataKey:'lac'},
          {header:'Amount YTD',dataKey:'amt'},
          {header:'Company',dataKey:'co'},
          {header:'Currency',dataKey:'cur'},
        ];
        const dimBody=uploadedAccounts.filter(r=>getField(r,'dimensionCode')).map(r=>({
          acc:String(getField(r,'accountName')??(getField(r,'accountCode')??'')),
          dim:String(getField(r,'dimensionName')??getField(r,'dimensionCode')??''),
          lac:String(getField(r,'localAccountCode')??'')+(getField(r,'localAccountName')?' '+getField(r,'localAccountName'):''),
          amt:fmtN(parseAmt(getField(r,'AmountYTD','amountYTD','AmountPeriod','amountPeriod'))),
          co:String(getField(r,'companyShortName','CompanyShortName')??''),
          cur:String(getField(r,'CurrencyCode','currencyCode')??''),
          _r:{isDim:true,isJrn:false,isBold:false},
        }));
        if(dimBody.length>0){
          autoTable(doc,{
            startY,columns:dimCols,body:dimBody,
            margin:{left:8,right:8,bottom:12},tableWidth:W-16,
            styles:{fontSize:6.5,cellPadding:{top:2,bottom:2,left:3,right:3},overflow:'ellipsize',lineColor:GRAYLT,lineWidth:0.1,font:'helvetica',textColor:TEXTDK},
            headStyles:{fillColor:[180,100,20],textColor:WHITE,fontStyle:'bold',fontSize:6,lineWidth:0},
            alternateRowStyles:{fillColor:[255,248,235]},
            columnStyles:{acc:{cellWidth:45},dim:{cellWidth:38},lac:{cellWidth:45},amt:{cellWidth:22,halign:'right'},co:{cellWidth:18},cur:{cellWidth:12}},
            didParseCell:data=>{if(data.section!=='head'&&data.column.dataKey==='amt')data.cell.styles.halign='right';},
            didDrawPage:()=>drawFooter(),
          });
        }
      }
      // Journal table
      if(journalEntries?.length>0){
        const jY=(doc.lastAutoTable?.finalY??startY)+6;
        doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor(...NAVY);
        doc.text('Journal Entries',8,jY+4);
        const jCols=[
          {header:'Journal #',dataKey:'jn'},
          {header:'Header',dataKey:'jh'},
          {header:'Account',dataKey:'acc'},
          {header:'Type',dataKey:'jt'},
          {header:'Dimension',dataKey:'dim'},
          {header:'Counterparty',dataKey:'cp'},
          {header:'Amount YTD',dataKey:'amt'},
          {header:'Currency',dataKey:'cur'},
        ];
        const jBody=journalEntries.map(j=>({
          jn:String(j.JournalNumber??j.journalNumber??''),
          jh:String(j.JournalHeader??j.journalHeader??''),
          acc:String(j.AccountName??j.accountName??''),
          jt:String(j.JournalType??j.journalType??''),
          dim:String(j.DimensionName??j.dimensionName??''),
          cp:String(j.CounterpartyShortName??j.counterpartyShortName??''),
          amt:fmtN(parseAmt(j.AmountYTD??j.amountYTD??0)),
          cur:String(j.CurrencyCode??j.currencyCode??''),
          _r:{isJrn:true,isDim:false,isBold:false},
        }));
        autoTable(doc,{
          startY:jY+7,columns:jCols,body:jBody,
          margin:{left:8,right:8,bottom:12},tableWidth:W-16,
          styles:{fontSize:6.5,cellPadding:{top:2,bottom:2,left:3,right:3},overflow:'ellipsize',lineColor:GRAYLT,lineWidth:0.1,font:'helvetica',textColor:TEXTDK},
          headStyles:{fillColor:[60,50,160],textColor:WHITE,fontStyle:'bold',fontSize:6,lineWidth:0},
          alternateRowStyles:{fillColor:[245,243,255]},
          columnStyles:{jn:{cellWidth:18},jh:{cellWidth:35},acc:{cellWidth:38},jt:{cellWidth:12},dim:{cellWidth:20},cp:{cellWidth:20},amt:{cellWidth:20,halign:'right'},cur:{cellWidth:10}},
          didParseCell:data=>{if(data.section!=='head'&&data.column.dataKey==='amt')data.cell.styles.halign='right';},
          didDrawPage:()=>drawFooter(),
        });
      }
    }

    doc.save(`Konsolidator_${year}_${String(month).padStart(2,'0')}.pdf`);
  }

  const load=src=>new Promise((res,rej)=>{
    if(document.querySelector(`script[src="${src}"]`)){res();return;}
    const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });

  load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(()=>load('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
    .then(()=>{
      const{jsPDF}=window.jspdf;
      doGenerate(jsPDF,window.jspdf.jsPDF.autoTable??((d,opts)=>d.autoTable(opts)));
    })
    .catch(e=>alert('Could not load PDF library: '+e.message));
}

function PLStatement({
  externalExpandedMap, externalSetExpandedMap,
  token,
  upDimGroups, upDimensions,
  onHistoryExpandedChange,
  groupAccounts, uploadedAccounts, prevUploadedAccounts = [], dimensions = [],
  compareMode, onToggleCompare,
  cmpUploadedAccounts = [], cmpPrevUploadedAccounts = [],
  cmpFilters, onCmpFilterChange,
  cmp2UploadedAccounts = [], cmp2PrevUploadedAccounts = [],
  cmp2Filters, onCmp2FilterChange,
  sources = [], structures = [], companies = [],
dimGroups = [], cmpFilteredDims = [], cmp2FilteredDims = [],
cmp2Enabled = true, onCmp2EnabledChange,
loading, error, month, year, source, structure,
journalEntries = [], journalEntriesCmp = [], journalEntriesCmp2 = [], dimensionActive = false,
breakers = { pl: {}, bs: {}, cf: {} },
  pgcMapping = null,
savedPlLiteral = null,
  savedHighlightedIds = null,
  ytdOnly = false,
}) {
    console.log("[PL-ENTRY]", { hasLiteral: !!savedPlLiteral, isArr: Array.isArray(savedPlLiteral), len: savedPlLiteral?.length });

const { colors } = useSettings();
const header3Style = useTypo("header3");
const t = useT();

const localName = useCallback((node) => {
  return pgcMapping?.names?.get(String(node.code)) ?? node.name;
}, [pgcMapping]);
const MONTHS = useMonths();
const body1Style = useTypo("body1");
const body2Style = useTypo("body2");
const subbody1Style = useTypo("subbody1");
const subbody2Style = useTypo("subbody2");
const header2Style = useTypo("header2");
const expandedMap = externalExpandedMap ?? {};
const setExpandedMap = externalSetExpandedMap ?? (() => {});
const [hoveredDimRow, setHoveredDimRow] = useState(null);
const [summaryMode, setSummaryMode] = useState(true);
const [filtersOpen, setFiltersOpen] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyMonths, setHistoryMonths] = useState([]); // [{ year, month, data, prevData }]
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistoryMonth = useCallback(async (y, mo) => {
    if (!token || !source || !structure || !y || !mo) return { data: [], prevData: [] };
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const buildFilter = (yy, mm) => `Year eq ${yy} and Month eq ${mm} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    try {
      const resA = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(buildFilter(y, mo))}`, { headers: h });
      const jsonA = resA.ok ? await resA.json() : { value: [] };
      const data = jsonA.value ?? (Array.isArray(jsonA) ? jsonA : []);
      let prev = [];
      if (Number(mo) !== 1) {
        const resB = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(buildFilter(y, Number(mo) - 1))}`, { headers: h });
        const jsonB = resB.ok ? await resB.json() : { value: [] };
        prev = jsonB.value ?? (Array.isArray(jsonB) ? jsonB : []);
      }
      return { data, prevData: prev };
    } catch { return { data: [], prevData: [] }; }
  }, [token, source, structure]);

  const toggleHistory = useCallback(async () => {
    if (compareMode) return; // disabled in compare mode
if (historyExpanded) {
      setHistoryExpanded(false);
      setHistoryMonths([]);
      onHistoryExpandedChange?.(false);
      return;
    }
setHistoryExpanded(true);
    onHistoryExpandedChange?.(true);
    setHistoryLoading(true);
    // Compute the 11 previous months from (year, month)
const targets = [];
    let y = Number(year), m = Number(month);
    for (let i = 0; i < 5; i++) {
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      targets.push({ year: y, month: m });
    }
    // Fetch sequentially, push as each resolves
    for (const t of targets) {
      const { data, prevData } = await fetchHistoryMonth(t.year, t.month);
      setHistoryMonths(prev => [...prev, { year: t.year, month: t.month, data, prevData }]);
    }
    setHistoryLoading(false);
  }, [compareMode, historyExpanded, year, month, fetchHistoryMonth]);
  
const [jrnPopup, setJrnPopup] = useState(null);
const [dimPopup, setDimPopup] = useState(null);
  
  const tree = useMemo(() => buildTree(groupAccounts, uploadedAccounts, !dimensionActive), [groupAccounts, uploadedAccounts, dimensionActive]);

  const toggle = (code) => setExpandedMap(prev => ({ ...prev, [code]: !prev[code] }));

  // Collect all sum account nodes from P/L tree in ascending code order (post-order = leaves first)
const allSumRows = useMemo(() => {
  // PGC mapping path: order by mapping, filter to is_sum rows
  if (pgcMapping?.rows) {
    const treeByCode = new Map();
    (function index(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); index(n.children || []); });
    })(tree);
    return [...pgcMapping.rows.entries()]
      .filter(([, info]) => info.isSum)
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => treeByCode.get(code))
      .filter(n => n && hasData(n) && ["P/L", "DIS"].includes(n.accountType));
  }

  const result = [];
  function walk(node) {
    if (!hasData(node)) return;
    if (!["P/L", "DIS"].includes(node.accountType)) return;
    (node.children || []).forEach(c => walk(c));  // children first
    if (node.isSumAccount) result.push(node);      // then parent
  }
  tree
    .filter(n => ["P/L", "DIS"].includes(n.accountType))
    .forEach(n => walk(n));
  return result;
}, [tree, pgcMapping]);


// ADD THIS RIGHT HERE:
useEffect(() => {
  console.log("=== TREE DEBUG ===");
  function walkDebug(node, depth) {
    console.log(
      "  ".repeat(depth) +
      `[${node.isSumAccount ? "SUM" : "grp"}] code=${node.code} name=${node.name} type=${node.accountType} level=${node.level}`
    );
    (node.children || []).forEach(c => walkDebug(c, depth + 1));
  }
  tree
    .filter(n => ["P/L", "DIS"].includes(n.accountType))
    .forEach(n => walkDebug(n, 0));
  console.log("=== allSumRows ===");
  allSumRows.forEach(n => console.log(`  code=${n.code} name=${n.name} isSumAccount=${n.isSumAccount} level=${n.level}`));
}, [tree, allSumRows]);


const prevTree = useMemo(
  () => buildTree(groupAccounts, prevUploadedAccounts, !dimensionActive),
  [groupAccounts, prevUploadedAccounts, dimensionActive]
);

const prevLeafIndex = useMemo(() => {
  const idx = new Map();
  (prevUploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dim = String(getField(row, "dimensionCode") ?? "__none__");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    if (!idx.has(lac)) idx.set(lac, new Map());
    const dimMap = idx.get(lac);
    dimMap.set(dim, (dimMap.get(dim) ?? 0) + amt);
  });
  return idx;
}, [prevUploadedAccounts]);

const getPrevLeafAmt = useCallback((localCode) => {
  if (Number(month) === 1) return 0;
  const dimMap = prevLeafIndex.get(String(localCode));
  if (!dimMap) return 0;
  let total = 0;
  dimMap.forEach(v => { total += v; });
  return total;
}, [prevLeafIndex, month]);

const getPrevDimAmt = useCallback((localCode, dimCode) => {
  if (Number(month) === 1) return 0;
  const dimMap = prevLeafIndex.get(String(localCode));
  if (!dimMap) return 0;
  return dimMap.get(String(dimCode ?? "__none__")) ?? 0;
}, [prevLeafIndex, month]);

const cmpLeafIndex = useMemo(() => {
  const idx = new Map();
  (cmpUploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmpUploadedAccounts]);

const cmp2LeafIndex = useMemo(() => {
  const idx = new Map();
  (cmp2UploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp2UploadedAccounts]);

const getCmpLeafAmt = useCallback((localCode) => {
  return cmpLeafIndex.get(String(localCode)) ?? 0;
}, [cmpLeafIndex]);

const getCmp2LeafAmt = useCallback((localCode) => {
  return cmp2LeafIndex.get(String(localCode)) ?? 0;
}, [cmp2LeafIndex]);

const journalByCode = useMemo(() => {
  const idx = new Map();
  (journalEntries || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? row.AccountCode ?? "");
    if (!code) return;
    const jt = String(row.journalType ?? row.JournalType ?? "").toUpperCase();
    if (jt !== "AJE" && jt !== "RJE") return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntries]);

const journalByCodeCmp = useMemo(() => {
  const idx = new Map();
  (journalEntriesCmp || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? "");
    if (!code) return;
    const jt = String(row.journalType ?? row.JournalType ?? "").toUpperCase();
    if (jt !== "AJE" && jt !== "RJE") return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntriesCmp]);

const journalByCodeCmp2 = useMemo(() => {
  const idx = new Map();
  (journalEntriesCmp2 || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? "");
    if (!code) return;
    const jt = String(row.journalType ?? row.JournalType ?? "").toUpperCase();
    if (jt !== "AJE" && jt !== "RJE") return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntriesCmp2]);

const prevNodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  prevTree.forEach(walk);
  return map;
}, [prevTree]);

const getPrevYtd = useCallback((code) => {
  if (Number(month) === 1) return 0;
  const node = prevNodeByCode.get(code);
  return node ? sumNode(node) : 0;
}, [prevNodeByCode, month]);

// ── Compare period trees ────────────────────────────────────
const cmpTree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmpUploadedAccounts, !dimensionActive) : [],
  [groupAccounts, cmpUploadedAccounts, compareMode, dimensionActive]
);
const cmpPrevTree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmpPrevUploadedAccounts, !dimensionActive) : [],
  [groupAccounts, cmpPrevUploadedAccounts, compareMode, dimensionActive]
);
const cmpNodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  cmpTree.forEach(walk);
  return map;
}, [cmpTree]);
const cmpPrevNodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  cmpPrevTree.forEach(walk);
  return map;
}, [cmpPrevTree]);

const getCmpYtd  = useCallback((code) => { const n = cmpNodeByCode.get(code);     return n ? sumNode(n) : 0; }, [cmpNodeByCode]);

const getCmpPrev = useCallback((code) => {
  if (Number(cmpFilters?.month) === 1) return 0;
  const n = cmpPrevNodeByCode.get(code); return n ? sumNode(n) : 0;
}, [cmpPrevNodeByCode, cmpFilters]);

// ── Compare period 2 trees ──────────────────────────────────
const cmp2Tree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmp2UploadedAccounts, !dimensionActive) : [],
  [groupAccounts, cmp2UploadedAccounts, compareMode, dimensionActive]
);

const cmp2PrevTree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmp2PrevUploadedAccounts, !dimensionActive) : [],
  [groupAccounts, cmp2PrevUploadedAccounts, compareMode, dimensionActive]
);
const cmp2NodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  cmp2Tree.forEach(walk);
  return map;
}, [cmp2Tree]);
const cmp2PrevNodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  cmp2PrevTree.forEach(walk);
  return map;
}, [cmp2PrevTree]);

// History months: filter raw data by dims, build trees, build code lookups
const historyMonthsProcessed = useMemo(() => {
  return historyMonths.map(h => {
    const filteredData = h.data.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
    const filteredPrev = h.prevData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
    const tree = buildTree(groupAccounts, filteredData, !((upDimGroups?.length > 0) || (upDimensions?.length > 0)));
    const prevTree = buildTree(groupAccounts, filteredPrev, !((upDimGroups?.length > 0) || (upDimensions?.length > 0)));
    const map = new Map();
    const prevMap = new Map();
    const walk = (m) => (n) => { m.set(n.code, n); n.children?.forEach(walk(m)); };
    tree.forEach(walk(map));
    prevTree.forEach(walk(prevMap));
    // Leaf index: localAccountCode → YTD amount
    const leafIdx = new Map();
    const prevLeafIdx = new Map();
    filteredData.forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      leafIdx.set(lac, (leafIdx.get(lac) ?? 0) + amt);
    });
    filteredPrev.forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      prevLeafIdx.set(lac, (prevLeafIdx.get(lac) ?? 0) + amt);
    });
    return { year: h.year, month: h.month, map, prevMap, leafIdx, prevLeafIdx };
  });
}, [historyMonths, upDimGroups, upDimensions, groupAccounts]);

const getHistYtd = useCallback((h, code) => { const n = h.map.get(code); return n ? sumNode(n) : 0; }, []);
const getHistPrev = useCallback((h, code) => {
  if (Number(h.month) === 1) return 0;
  const n = h.prevMap.get(code); return n ? sumNode(n) : 0;
}, []);

const getCmp2Ytd = useCallback((code) => { const n = cmp2NodeByCode.get(code); return n ? sumNode(n) : 0; }, [cmp2NodeByCode]);
const getCmp2Prev = useCallback((code) => {
  if (Number(cmp2Filters?.month) === 1) return 0;
  const n = cmp2PrevNodeByCode.get(code); return n ? sumNode(n) : 0;
}, [cmp2PrevNodeByCode, cmp2Filters]);

const summaryRows = useMemo(() => {
  // PGC mapping path: order by mapping, filter to show_in_summary rows
  if (pgcMapping?.rows) {
    const treeByCode = new Map();
    (function index(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); index(n.children || []); });
    })(tree);
    return [...pgcMapping.rows.entries()]
      .filter(([, info]) => info.showInSummary)
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => treeByCode.get(code))
      .filter(n => n && hasData(n) && ["P/L", "DIS"].includes(n.accountType));
  }

  const allSums = [];
  function walk(node) {
    if (!hasData(node)) return;
    if (!["P/L", "DIS"].includes(node.accountType)) return;
    if (node.isSumAccount) allSums.push(node);
    (node.children || []).forEach(c => walk(c));
  }
  tree.filter(n => ["P/L", "DIS"].includes(n.accountType)).forEach(n => walk(n));

  const plSums = allSums.filter(n => n.accountType === "P/L");

  // Check if this structure uses alphanumeric codes (like A.13.S) or numeric (like 89999)
  const isAlphanumeric = plSums.some(n => /[a-zA-Z]/.test(String(n.code)));

  let filtered;
  if (isAlphanumeric) {
const hasDotS  = plSums.some(n => String(n.code).endsWith(".S"));
    const hasDotPL = !hasDotS && plSums.some(n => String(n.code).endsWith(".PL"));
    const hasAlpha = !hasDotS && plSums.some(n => /^[A-Z]\.\d/.test(String(n.code)));

    if (hasDotS) {
      filtered = plSums.filter(n => String(n.code).endsWith(".S"));
    } else if (hasDotPL || hasAlpha) {
      // Spanish IFRS: .PL = KPI rows; also include breaker entry nodes so dividers fire in summary
      const breakerKeys = new Set(Object.keys(breakers.pl));
      const plDotNodes   = plSums.filter(n => String(n.code).endsWith(".PL"));
      const breakerNodes = breakerKeys.size > 0
        ? plSums.filter(n => breakerKeys.has(String(n.code)) && !String(n.code).endsWith(".PL"))
        : plSums.filter(n => n.level === 1 && !String(n.code).endsWith(".PL")).slice(0, 1);
      filtered = [...breakerNodes, ...plDotNodes];
    } else {
      filtered = plSums.filter(n => PL_HIGHLIGHTED_CODES.has(String(n.code)));
    }
  } else {
    // Konsolidator Nordic structures: KPI nodes are in PL_HIGHLIGHTED_CODES
    filtered = plSums.filter(n => PL_HIGHLIGHTED_CODES.has(String(n.code)));
  }

  // Fallback: if neither matched anything, just show the root sum nodes (level 1)
  if (filtered.length === 0) {
    filtered = plSums.filter(n => n.level === 1);
  }

return filtered.sort((a, b) =>
    String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
  );
}, [tree, breakers, pgcMapping]);



// When PGC mapping is active, derive the 3 breakers (one per section,
// placed on the first row of each section in the rendered list).
const effectiveBreakersPl = useMemo(() => {
  const palette = [colors.primary, colors.secondary, colors.tertiary];

  // PGC mapping path
  if (pgcMapping?.rows && pgcMapping?.sections) {
    const rowsToRender = summaryMode ? summaryRows : allSumRows;
    const seen = new Set();
    const out = {};
    let i = 0;
    for (const node of rowsToRender) {
      const m = pgcMapping.rows.get(String(node.code));
      if (!m) continue;
      if (seen.has(m.section)) continue;
      seen.add(m.section);
      const sec = pgcMapping.sections.get(m.section);
      if (sec) {
        out[String(node.code)] = { label: sec.label, color: palette[i] ?? sec.color };
        i++;
      }
    }
    return out;
  }

  // Legacy Supabase path — recolor by position
  const legacy = breakers.pl ?? {};
  const codes = Object.keys(legacy).sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
  const out = {};
  codes.forEach((code, i) => {
    out[code] = { ...legacy[code], color: palette[i] ?? legacy[code].color };
  });
  return out;
}, [pgcMapping, breakers, summaryMode, summaryRows, allSumRows, colors]);

const handleExportPdf = () => {
  generatePLPdf({
    groupAccounts, uploadedAccounts, prevUploadedAccounts,
    compareMode,
    cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
    cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
    month, year, source, structure,
    summaryRows,
  });
};

const handleExportXlsx = () => {
  generatePLXlsx({
    groupAccounts, uploadedAccounts, prevUploadedAccounts,
    compareMode,
    cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
    cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
    month, year, source, structure,
    summaryRows,
  });
};






  const JournalPopup = jrnPopup ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setJrnPopup(null)}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
              <BookOpen size={13} className="text-white/70" />
            </div>
            <div>
              <p className="text-white font-black text-sm">{jrnPopup.journalNumber ?? jrnPopup.JournalNumber ?? "—"}</p>
              <p className="text-white/50 text-[10px] font-medium">{jrnPopup.journalHeader ?? jrnPopup.JournalHeader ?? ""}</p>
            </div>
          </div>
          <button onClick={() => setJrnPopup(null)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
            <X size={13} className="text-white/70" />
          </button>
        </div>
        {/* Body */}
        <div className="p-5 space-y-3">
          {[
            ["Account", `${jrnPopup.AccountCode ?? jrnPopup.accountCode ?? ""} · ${jrnPopup.AccountName ?? jrnPopup.accountName ?? ""}`],
            ["Account Type", jrnPopup.AccountType ?? jrnPopup.accountType],
            ["Journal Type", jrnPopup.JournalType ?? jrnPopup.journalType],
            ["Journal Layer", jrnPopup.JournalLayer ?? jrnPopup.journalLayer],
            ["Row Text", jrnPopup.RowText ?? jrnPopup.rowText],
            ["Counterparty", jrnPopup.CounterpartyShortName ?? jrnPopup.counterpartyShortName],
            ["Dimension", jrnPopup.DimensionName ?? jrnPopup.dimensionName],
            ["Amount YTD", jrnPopup.AmountYTD ?? jrnPopup.amountYTD],
            ["Currency", jrnPopup.CurrencyCode ?? jrnPopup.currencyCode],
            ["Period", `${jrnPopup.Month ?? jrnPopup.month} / ${jrnPopup.Year ?? jrnPopup.year}`],
            ["Source", jrnPopup.Source ?? jrnPopup.source],
            ["Company", jrnPopup.CompanyShortName ?? jrnPopup.companyShortName],
            ["System Generated", (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === true ? "Yes" : (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === false ? "No" : "—"],
            ["Posted", (jrnPopup.Posted ?? jrnPopup.posted) === true ? "Yes" : (jrnPopup.Posted ?? jrnPopup.posted) === false ? "No" : "—"],
          ].filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—").map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex-shrink-0 mt-0.5">{label}</span>
              <span className="text-xs text-gray-700 font-medium text-right">{String(value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  if (loading) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <Loader2 size={28} className="text-[#1a2f8a] animate-spin mx-auto mb-3" />
     <p className="text-gray-400 text-sm">{t("loading_pl_data")}</p>
    </div>
  );

// ────────────────────────────────────────────────────────────
  //  SAVED-MAPPING LITERAL RENDER PATH
  //  Activated only when a user-saved mapping is applied.
  //  Renders the mapping tree literally: duplicates preserved,
  //  dim filters applied, mapping hierarchy used (not groupAccounts).
  //  Standard PGC / Danish / Spanish-IFRS paths below are bypassed.
  // ────────────────────────────────────────────────────────────
const cmpLabel  = compareMode ? [cmpFilters.year, MONTHS.find(m => String(m.value) === String(cmpFilters.month))?.label, cmpFilters.source, cmpFilters.dimension].filter(Boolean).join(" · ") || "Period B" : "";
  const cmp2Label = compareMode ? [cmp2Filters?.year, MONTHS.find(m => String(m.value) === String(cmp2Filters?.month))?.label, cmp2Filters?.source, cmp2Filters?.dimension].filter(Boolean).join(" · ") || "Period C" : "";

  if (savedPlLiteral && !loading) {
// Build a lookup by code into the standard group-account tree.
// Build a lookup by code into the standard group-account tree.
    // This way every node total (no-dim case) uses the SAME computation
    // as the standard renderer: rolled-up sumNode across uploadLeaves + children.
    const treeByCode = new Map();
    (function indexTree(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); indexTree(n.children || []); });
    })(tree);

    // Dim indexes — built from the raw uploaded rows, scoped to each accountCode.
    // dimFullIdx:  `${code}|${group}:${value}` → sum
    // dimValIdx:   `${code}|${value}`          → sum
    // We also walk down to descendant codes so a node mapped at a parent code
    // picks up dims on its children (matches sumNode's roll-up behavior).
const dimFullIdx = new Map();
    const dimValIdx  = new Map();
    // name→code lookup built per row (DimensionCode + DimensionName flat columns)
    const dimNameToCode = new Map(); // key="group:name" → code
    (uploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));

      // Capture name→code mapping from flat row fields
      const dCode = String(getField(row, "DimensionCode", "dimensionCode") ?? "").trim();
      const dName = String(getField(row, "DimensionName", "dimensionName") ?? "").trim();

      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        // numeric-keyed entries (as before)
dimFullIdx.set(`${code}|${g}:${v}`, (dimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        dimValIdx.set(`${code}|${v}`,       (dimValIdx.get(`${code}|${v}`)       ?? 0) + amt);
        if (dName && v === dCode) {
          dimFullIdx.set(`${code}|${g}:${dName}`, (dimFullIdx.get(`${code}|${g}:${dName}`) ?? 0) + amt);
          dimValIdx.set(`${code}|${dName}`,       (dimValIdx.get(`${code}|${dName}`)       ?? 0) + amt);
          dimNameToCode.set(`${g}:${dName}`, dCode);
        }
      });
    });

    // Build name→code lookup from dimensions metadata, then add name-keyed entries
    if (Array.isArray(dimensions) && dimensions.length > 0) {
      const nameToCode = new Map(); // "Centro de Coste:Estudio" → "1"
      dimensions.forEach(d => {
        const group = String(d.dimensionGroup ?? d.DimensionGroup ?? d.groupName ?? d.GroupName ?? "").trim();
        const code  = String(d.dimensionCode  ?? d.DimensionCode  ?? d.code      ?? d.Code      ?? "").trim();
        const name  = String(d.dimensionName  ?? d.DimensionName  ?? d.name      ?? d.Name      ?? "").trim();
        if (group && code && name) nameToCode.set(`${group}:${name}`, code);
      });
      console.log("[NAME-MAP] dimensions metadata entries:", nameToCode.size, "sample:", [...nameToCode.entries()].slice(0, 5));
      // Mirror every existing code-keyed entry under a name-keyed entry
      [...dimFullIdx.entries()].forEach(([k, v]) => {
        const pipe = k.indexOf("|");
        const accCode = k.slice(0, pipe);
        const rest = k.slice(pipe + 1);          // "Group:Code"
        const colon = rest.indexOf(":");
        if (colon === -1) return;
        const group = rest.slice(0, colon);
        const codeVal = rest.slice(colon + 1);
        for (const [nameKey, mappedCode] of nameToCode.entries()) {
          if (mappedCode === codeVal && nameKey.startsWith(`${group}:`)) {
            const name = nameKey.slice(group.length + 1);
            dimFullIdx.set(`${accCode}|${group}:${name}`, v);
            dimValIdx.set(`${accCode}|${name}`, v);
            break;
          }
        }
      });
    }

    // PROBE: see if name-keying is actually happening
    if (typeof window !== "undefined") {
      let nameKeyCount = 0;
      let probedRows = 0;
      (uploadedAccounts || []).forEach(row => {
        const code = String(getField(row, "accountCode") ?? "");
        if (code !== "700000") return;
        const dCode = String(getField(row, "DimensionCode", "dimensionCode") ?? "").trim();
        const dName = String(getField(row, "DimensionName", "dimensionName") ?? "").trim();
        const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
        if (probedRows < 3) {
          console.log(`[NAME-PROBE] 700000 row: DimensionCode="${dCode}" DimensionName="${dName}" Dimensions="${dimsStr}"`);
          probedRows++;
        }
        if (dName) nameKeyCount++;
      });
      console.log(`[NAME-PROBE] 700000 rows with non-empty DimensionName: ${nameKeyCount}`);
      console.log(`[NAME-PROBE] dimValIdx keys for 700000:`, [...dimValIdx.keys()].filter(k => k.startsWith("700000|")));
    }
    // PROBE: see what dimension metadata is available in scope
    if (typeof window !== "undefined") {
      console.log("[DIM-META-PROBE] window.__dimensions:", typeof window.__dimensions);
      try { console.log("[DIM-META-PROBE] effectiveDimensions:", typeof effectiveDimensions !== "undefined" ? effectiveDimensions : "undefined"); } catch (e) { console.log("[DIM-META-PROBE] effectiveDimensions: NOT IN SCOPE"); }
      try { console.log("[DIM-META-PROBE] dimensions:", typeof dimensions !== "undefined" ? dimensions : "undefined"); } catch (e) { console.log("[DIM-META-PROBE] dimensions: NOT IN SCOPE"); }
      try { console.log("[DIM-META-PROBE] dataRef:", typeof dataRef !== "undefined" ? dataRef : "undefined"); } catch (e) { console.log("[DIM-META-PROBE] dataRef: NOT IN SCOPE"); }
      try { console.log("[DIM-META-PROBE] dimensionsData:", typeof dimensionsData !== "undefined" ? dimensionsData : "undefined"); } catch (e) { console.log("[DIM-META-PROBE] dimensionsData: NOT IN SCOPE"); }
    }

    // For dim-filtered nodes: walk the group-account subtree and sum any
    // descendant whose dim matches, so a parent code with dim filter rolls up.
    const sumDimRecursive = (gaNode, dimStr) => {
      if (!gaNode) return 0;
      let total = 0;
      const code = String(gaNode.code);
      if (dimStr.includes(":")) {
        total += dimFullIdx.get(`${code}|${dimStr}`) ?? 0;
      } else {
        total += dimValIdx.get(`${code}|${dimStr}`) ?? 0;
      }
      (gaNode.children || []).forEach(c => { total += sumDimRecursive(c, dimStr); });
      return total;
    };

if (typeof window !== "undefined") {
      console.log("[SAVED-PL] treeByCode has 603000?", treeByCode.has("603000"), "700000?", treeByCode.has("700000"), "610000?", treeByCode.has("610000"));
      // Are we using the same tree the standard renderer uses?
      console.log("[SAVED-PL] tree length:", tree.length, "treeByCode size:", treeByCode.size);
      console.log("[SAVED-PL] uploadedAccounts length:", (uploadedAccounts || []).length);
      const sample700 = treeByCode.get("700000");
      console.log("[SAVED-PL] 700000 node:", sample700);
      console.log("[SAVED-PL] sumNode(700000):", sample700 ? sumNode(sample700) : "no-node");
      // Sample raw row counts by company:
      const byCo = {};
      (uploadedAccounts || []).forEach(r => {
        const c = String(r.CompanyShortName ?? r.companyShortName ?? "?");
        byCo[c] = (byCo[c] ?? 0) + 1;
      });
      console.log("[SAVED-PL] uploadedAccounts company counts:", byCo);

      const probe = (code) => {
        const full = [...dimFullIdx.entries()].filter(([k]) => k.startsWith(code + "|"));
        const val  = [...dimValIdx.entries()].filter(([k]) => k.startsWith(code + "|"));
        const totalAcc = treeByCode.get(code) ? sumNode(treeByCode.get(code)) : "NO_TREE_NODE";
        console.log(`[SAVED-PL] ${code}: sumNode=${totalAcc}, dimFull entries=${full.length}, dimVal entries=${val.length}`);
        console.log(`  dimFull:`, full);
        console.log(`  dimVal:`, val);
      };
      probe("603000");
      probe("700000");
      probe("700000i");
      probe("600000");
      probe("610000");

      const rows610 = (uploadedAccounts || []).filter(r => String(getField(r, "accountCode") ?? "") === "610000");
      console.log(`[SAVED-PL] raw uploaded rows for 610000 (count=${rows610.length}):`, rows610.map(r => ({
        amt: getField(r, "AmountYTD", "amountYTD"),
        dims: getField(r, "Dimensions", "dimensions")
      })));
    }
    // Dump every saved node's dims vs what dimFullIdx/dimValIdx know for that code
    if (typeof window !== "undefined") {
      console.log("[SAVED-PL] === DIM MATCH DEBUG ===");
      // Probe the actual fields on one row to find dim name field
      const probe700 = (uploadedAccounts || []).find(r => String(getField(r, "accountCode") ?? "") === "700000" && getField(r, "Dimensions", "dimensions"));
      if (probe700) {
        console.log("[SAVED-PL] sample 700000 row keys:", Object.keys(probe700));
        console.log("[SAVED-PL] sample 700000 row:", probe700);
      }
      const walkLit = (nodes) => {
        nodes.forEach(n => {
          if (n.dims && n.dims.length > 0) {
            const gaNode = treeByCode.get(String(n.code));
            const knownFull = [...dimFullIdx.keys()].filter(k => k.startsWith(n.code + "|")).map(k => k.split("|")[1]);
            const knownVal  = [...dimValIdx.keys()].filter(k => k.startsWith(n.code + "|")).map(k => k.split("|")[1]);
            console.log(`  code=${n.code} name="${n.name}" SAVED dims:`, n.dims, "→ KNOWN full keys:", knownFull, "KNOWN val keys:", knownVal);
            // Test each saved dim
            n.dims.forEach(d => {
              const fullHit = dimFullIdx.get(`${n.code}|${d}`);
              const valHit  = dimValIdx.get(`${n.code}|${d}`);
              const recur   = sumDimRecursive(gaNode, String(d));
              console.log(`    "${d}" → fullHit=${fullHit ?? "miss"}, valHit=${valHit ?? "miss"}, sumDimRecursive=${recur}`);
            });
          }
          if (n.children) walkLit(n.children);
        });
      };
      savedPlLiteral.forEach(s => walkLit(s.nodes));
    }

// Build a prev-month index for monthly mode (mirrors current dimFullIdx/dimValIdx logic)
    const prevAccIdx = new Map();
    const prevDimFullIdx = new Map();
    const prevDimValIdx = new Map();
    (prevUploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      prevAccIdx.set(code, (prevAccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        prevDimFullIdx.set(`${code}|${g}:${v}`, (prevDimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        prevDimValIdx.set(`${code}|${v}`, (prevDimValIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });
// Mirror prev-month dim indexes by dim NAME using metadata
    if (Array.isArray(dimensions) && dimensions.length > 0) {
      const nameToCode = new Map();
      dimensions.forEach(d => {
        const group = String(d.dimensionGroup ?? d.DimensionGroup ?? d.groupName ?? d.GroupName ?? "").trim();
        const code  = String(d.dimensionCode  ?? d.DimensionCode  ?? d.code      ?? d.Code      ?? "").trim();
        const name  = String(d.dimensionName  ?? d.DimensionName  ?? d.name      ?? d.Name      ?? "").trim();
        if (group && code && name) nameToCode.set(`${group}:${name}`, code);
      });
      [...prevDimFullIdx.entries()].forEach(([k, v]) => {
        const pipe = k.indexOf("|"); const accCode = k.slice(0, pipe);
        const rest = k.slice(pipe + 1); const colon = rest.indexOf(":");
        if (colon === -1) return;
        const group = rest.slice(0, colon); const codeVal = rest.slice(colon + 1);
        for (const [nameKey, mappedCode] of nameToCode.entries()) {
          if (mappedCode === codeVal && nameKey.startsWith(`${group}:`)) {
            const name = nameKey.slice(group.length + 1);
            prevDimFullIdx.set(`${accCode}|${group}:${name}`, v);
            prevDimValIdx.set(`${accCode}|${name}`, v);
            break;
          }
        }
      });
    }

    // ── Define sumDimRecursivePrev (uses prevDimFullIdx/prevDimValIdx) ──
    const sumDimRecursivePrev = (gaNode, dimStr) => {
      if (!gaNode) return 0;
      let total = 0;
      const code = String(gaNode.code);
      if (dimStr.includes(":")) total += prevDimFullIdx.get(`${code}|${dimStr}`) ?? 0;
      else total += prevDimValIdx.get(`${code}|${dimStr}`) ?? 0;
      (gaNode.children || []).forEach(c => { total += sumDimRecursivePrev(c, dimStr); });
      return total;
    };

    // ── Compare period B indexes ───────────────────────────────
    const cmpAccIdx = new Map();
    const cmpDimFullIdx = new Map();
    const cmpDimValIdx = new Map();
    (cmpUploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmpAccIdx.set(code, (cmpAccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmpDimFullIdx.set(`${code}|${g}:${v}`, (cmpDimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        cmpDimValIdx.set(`${code}|${v}`, (cmpDimValIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });
    const cmpPrevAccIdx = new Map();
    const cmpPrevDimFullIdx = new Map();
    const cmpPrevDimValIdx = new Map();
    (cmpPrevUploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmpPrevAccIdx.set(code, (cmpPrevAccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmpPrevDimFullIdx.set(`${code}|${g}:${v}`, (cmpPrevDimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        cmpPrevDimValIdx.set(`${code}|${v}`, (cmpPrevDimValIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });

    // ── Compare period C indexes ───────────────────────────────
    const cmp2AccIdx = new Map();
    const cmp2DimFullIdx = new Map();
    const cmp2DimValIdx = new Map();
    (cmp2UploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmp2AccIdx.set(code, (cmp2AccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmp2DimFullIdx.set(`${code}|${g}:${v}`, (cmp2DimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        cmp2DimValIdx.set(`${code}|${v}`, (cmp2DimValIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });
const cmp2PrevAccIdx = new Map();
    const cmp2PrevDimFullIdx = new Map();
    const cmp2PrevDimValIdx = new Map();
    (cmp2PrevUploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmp2PrevAccIdx.set(code, (cmp2PrevAccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmp2PrevDimFullIdx.set(`${code}|${g}:${v}`, (cmp2PrevDimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        cmp2PrevDimValIdx.set(`${code}|${v}`, (cmp2PrevDimValIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });

    // ── Mirror dim indexes by NAME for all compare periods (same as current-period mirroring) ──
    if (Array.isArray(dimensions) && dimensions.length > 0) {
      const nameToCode = new Map();
      dimensions.forEach(d => {
        const group = String(d.dimensionGroup ?? d.DimensionGroup ?? d.groupName ?? d.GroupName ?? "").trim();
        const code  = String(d.dimensionCode  ?? d.DimensionCode  ?? d.code      ?? d.Code      ?? "").trim();
        const name  = String(d.dimensionName  ?? d.DimensionName  ?? d.name      ?? d.Name      ?? "").trim();
        if (group && code && name) nameToCode.set(`${group}:${name}`, code);
      });
      const mirrorIdx = (fullIdx, valIdx) => {
        [...fullIdx.entries()].forEach(([k, v]) => {
          const pipe = k.indexOf("|"); const accCode = k.slice(0, pipe);
          const rest = k.slice(pipe + 1); const colon = rest.indexOf(":");
          if (colon === -1) return;
          const group = rest.slice(0, colon); const codeVal = rest.slice(colon + 1);
          for (const [nameKey, mappedCode] of nameToCode.entries()) {
            if (mappedCode === codeVal && nameKey.startsWith(`${group}:`)) {
              const name = nameKey.slice(group.length + 1);
              fullIdx.set(`${accCode}|${group}:${name}`, v);
              valIdx.set(`${accCode}|${name}`, v);
              break;
            }
          }
        });
      };
      mirrorIdx(cmpDimFullIdx, cmpDimValIdx);
      mirrorIdx(cmpPrevDimFullIdx, cmpPrevDimValIdx);
      mirrorIdx(cmp2DimFullIdx, cmp2DimValIdx);
      mirrorIdx(cmp2PrevDimFullIdx, cmp2PrevDimValIdx);
    }

    const cmpTreeLit = buildTree(groupAccounts, cmpUploadedAccounts);
    const cmpPrevTreeLit = buildTree(groupAccounts, cmpPrevUploadedAccounts);
    const cmp2TreeLit = buildTree(groupAccounts, cmp2UploadedAccounts);
    const cmp2PrevTreeLit = buildTree(groupAccounts, cmp2PrevUploadedAccounts);
    const cmpTreeByCode = new Map();
    const cmpPrevTreeByCode = new Map();
    const cmp2TreeByCode = new Map();
    const cmp2PrevTreeByCode = new Map();
    (function indexCmpTree(nodes) {
      nodes.forEach(n => { cmpTreeByCode.set(String(n.code), n); indexCmpTree(n.children || []); });
    })(cmpTreeLit);
    (function indexCmpPrevTree(nodes) {
      nodes.forEach(n => { cmpPrevTreeByCode.set(String(n.code), n); indexCmpPrevTree(n.children || []); });
    })(cmpPrevTreeLit);
    (function indexCmp2Tree(nodes) {
      nodes.forEach(n => { cmp2TreeByCode.set(String(n.code), n); indexCmp2Tree(n.children || []); });
    })(cmp2TreeLit);
    (function indexCmp2PrevTree(nodes) {
      nodes.forEach(n => { cmp2PrevTreeByCode.set(String(n.code), n); indexCmp2PrevTree(n.children || []); });
    })(cmp2PrevTreeLit);

    const sumDimRecursiveGeneric = (gaNode, dimStr, fullIdx, valIdx) => {
      if (!gaNode) return 0;
      let total = 0;
      const code = String(gaNode.code);
      if (dimStr.includes(":")) total += fullIdx.get(`${code}|${dimStr}`) ?? 0;
      else total += valIdx.get(`${code}|${dimStr}`) ?? 0;
      (gaNode.children || []).forEach(c => { total += sumDimRecursiveGeneric(c, dimStr, fullIdx, valIdx); });
      return total;
    };

    const sumLiteralForPeriod = (node, treeByCodeMap, prevTreeByCodeMap, fullIdx, valIdx, prevFullIdx, prevValIdx, periodMonth) => {
      const gaNode = treeByCodeMap.get(String(node.code));
      if (!gaNode) return 0;
      if (!node.dims || node.dims.length === 0) {
        const ytd = -sumNode(gaNode);
        if (ytdOnly) return ytd;
        const prevGa = prevTreeByCodeMap.get(String(node.code));
        const prevYtd = prevGa && Number(periodMonth) !== 1 ? -sumNode(prevGa) : 0;
        return ytd - prevYtd;
      }
      let total = 0;
      node.dims.forEach(d => { total += sumDimRecursiveGeneric(gaNode, String(d), fullIdx, valIdx); });
      const ytd = -total;
      if (ytdOnly) return ytd;
      let prevTotal = 0;
      if (Number(periodMonth) !== 1) {
        node.dims.forEach(d => { prevTotal += sumDimRecursiveGeneric(gaNode, String(d), prevFullIdx, prevValIdx); });
      }
      const prevYtd = -prevTotal;
      return ytd - prevYtd;
    };

    const sumLiteralB = (node) => sumLiteralForPeriod(
      node, cmpTreeByCode, cmpPrevTreeByCode,
      cmpDimFullIdx, cmpDimValIdx, cmpPrevDimFullIdx, cmpPrevDimValIdx,
      cmpFilters?.month
    );
    const sumLiteralC = (node) => sumLiteralForPeriod(
      node, cmp2TreeByCode, cmp2PrevTreeByCode,
      cmp2DimFullIdx, cmp2DimValIdx, cmp2PrevDimFullIdx, cmp2PrevDimValIdx,
      cmp2Filters?.month
    );


    // Sum a literal node (YTD or Monthly based on ytdOnly toggle):
    const sumLiteral = (node) => {
      const gaNode = treeByCode.get(String(node.code));
      if (!gaNode) return 0;
      if (!node.dims || node.dims.length === 0) {
        const ytd = -sumNode(gaNode);
        if (ytdOnly) return ytd;
        // Monthly = YTD - prev-month YTD (rolled up)
        const sumPrev = (n) => {
          if (!n) return 0;
          let t = prevAccIdx.get(String(n.code)) ?? 0;
          (n.children || []).forEach(c => { t += sumPrev(c); });
          return t;
        };
        const prevYtd = -sumPrev(gaNode);
        return ytd - prevYtd;
      }
      let total = 0;
      node.dims.forEach(d => { total += sumDimRecursive(gaNode, String(d)); });
      const ytd = -total;
      if (ytdOnly) return ytd;
      let prevTotal = 0;
      node.dims.forEach(d => { prevTotal += sumDimRecursivePrev(gaNode, String(d)); });
      const prevYtd = -prevTotal;
      return ytd - prevYtd;
    };

return (
      <div className="space-y-3 flex flex-col" style={{ minHeight: 0, flex: 1, overflow: "visible" }}>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
          style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}>
          <div className="overflow-auto scrollbar-hide" style={{ flex: 1, minHeight: 0 }}>
<table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
              <colgroup>
                <col style={{ width: "1px" }} />
                <col style={{ width: "1px" }} />
                {compareMode && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
                {compareMode && cmp2Enabled && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
                {historyExpanded && historyMonthsProcessed.map((h) => (
                  <col key={`hist-col-${h.year}-${h.month}`} style={{ width: "1px" }} />
                ))}
                <col />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100" style={{
                  background: "rgba(255,255,255,0.95)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <th className="text-left px-6 whitespace-nowrap" style={{ height: "64px", background: "transparent" }}>
                    <div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>
                        {t("col_account")}
                      </span>
                      <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
                        {t("page_pl_full")}
                      </span>
                    </div>
                  </th>
                  <th className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", cursor: "pointer" }}
                    onClick={toggleHistory}
                    title={historyExpanded ? "Hide history" : "Show last 6 months"}>
                    <div className="flex items-center justify-end gap-3">
                      <span key={ytdOnly ? "ytd" : "monthly"} className="font-black tracking-tight inline-block"
                        style={{ color: colors.primary, fontSize: 16, letterSpacing: "-0.02em" }}>
                        {(ytdOnly ? t("mode_ytd") : t("mode_monthly")).split("").map((ch, i) => (
                          <span key={i} className="inline-block"
                            style={{
                              animation: `letterMorph 420ms cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 35}ms both`,
                            }}>
                            {ch}
                          </span>
                        ))}
                      </span>
                      <button onClick={(e) => {
                        e.stopPropagation();
if (Object.values(expandedMap).some(Boolean)) { setExpandedMap({}); return; }
                        const next = {};
                        savedPlLiteral.forEach((section, secIdx) => {
                          const walk = (node, parentPath) => {
                            const rowKey = `saved-${secIdx}-${parentPath}-${node.id}`;
                            next[rowKey] = true;
                            const gaNode = treeByCode.get(String(node.code));
                            const leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== "plain");
                            leaves.forEach((leaf, i) => {
                              next[`${rowKey}-leaf-${i}`] = true;
                            });
                            (node.children || []).forEach(c => walk(c, `${parentPath}-${node.id}`));
                          };
                          section.nodes.forEach(n => walk(n, "root"));
                        });
                        setExpandedMap(next);
                      }}
className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-[1.05]"
                        style={{ background: `${colors.primary}12`, color: colors.primary, width: 28, height: 28, overflow: "hidden" }}
                        title={Object.values(expandedMap).some(Boolean) ? t("btn_collapse_all") : t("btn_expand_all")}>
                        <span key={Object.values(expandedMap).some(Boolean) ? "collapse" : "expand"}
                          className="inline-flex"
                          style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                          {Object.values(expandedMap).some(Boolean)
                            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          }
                        </span>
                      </button>
                    </div>
                  </th>
                  {historyExpanded && historyMonthsProcessed.map((h) => (
                    <th key={`hist-saved-${h.year}-${h.month}`} className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
                      <div className="flex flex-col items-end">
                        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>
                          {MONTHS.find(m => m.value === h.month)?.label.slice(0,3)}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: "#9ca3af" }}>{h.year}</span>
                      </div>
                    </th>
                  ))}
{compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
                      </div>
                      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmpLabel}</span>
                    </div>
                  </th>}
                  {compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
                      </div>
                      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmp2Label}</span>
                    </div>
                  </th>}
                  {historyExpanded && historyLoading && (
                    <th className="text-center px-3 py-3" style={{ background: "transparent" }}>
                      <Loader2 size={14} className="animate-spin" style={{ color: colors.primary }} />
                    </th>
                  )}
                  <th style={{ background: "transparent" }} />
                </tr>
              </thead>
<tbody>
                {savedPlLiteral.map((section, secIdx) => {
                  const sectionRows = [];

// Section header (breaker)
                  if (section.label) {
                    sectionRows.push(
                      <tr key={`sec-${secIdx}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(sectionRows.length, 25) * 35}ms both` }}>
                      <td colSpan={3 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (historyExpanded ? historyMonthsProcessed.length : 0)} style={{ backgroundColor: section.color }} className="px-6 py-1.5">
                          <span className="uppercase tracking-widest" style={header3Style}>{section.label}</span>
                        </td>
                      </tr>
                    );
                  }

                  // Walk the literal nodes recursively, respecting mapping hierarchy.
                  const renderNode = (node, depth, parentPath) => {
                    const val = sumLiteral(node);
                    let displayVal = val;
                    if (node.isSum && node.children && node.children.length > 0) {
                      displayVal = node.children.reduce((s, c) => s + sumLiteral(c), val);
                    }

                    // Unique key per literal node (preserves duplicates across sections)
                    const rowKey = `saved-${secIdx}-${parentPath}-${node.id}`;
                    const expanded = !!expandedMap[rowKey];

// Find the matching standard group-account node to drill into
                    const gaNode = treeByCode.get(String(node.code));
                    let leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== "plain");
                    // If this saved row has dim filters, restrict leaves to those matching the dims
                    if (node.dims && node.dims.length > 0) {
                      // Resolve each saved dim (potentially a name) to its numeric code via nameToCode if available
                      const acceptedKeys = new Set(); // "g:codeOrName" forms accepted
                      node.dims.forEach(d => acceptedKeys.add(String(d)));
                      leaves = leaves.filter(leaf => {
                        // Each leaf represents a local account; check its underlying rows' Dimensions field
                        const leafRows = (uploadedAccounts || []).filter(r => {
                          const lc = String(getField(r, "localAccountCode", "LocalAccountCode") ?? "");
                          return lc === String(leaf.code ?? "");
                        });
                        return leafRows.some(r => {
                          const dimsStr = String(getField(r, "Dimensions", "dimensions") ?? "");
                          if (!dimsStr) return false;
                          return dimsStr.split("||").map(s => s.trim()).filter(Boolean).some(pair => {
                            const i = pair.indexOf(":");
                            if (i === -1) return false;
                            const g = pair.slice(0, i).trim();
                            const v = pair.slice(i + 1).trim();
// Match against numeric (g:v) or name form, since saved dims may be names
                            if (acceptedKeys.has(`${g}:${v}`)) return true;
                            // Try resolving saved key's name to code via dimensions metadata
                            return [...acceptedKeys].some(savedKey => {
                              const savedColon = savedKey.indexOf(":");
                              if (savedColon === -1) return false;
                              const savedG = savedKey.slice(0, savedColon);
                              const savedV = savedKey.slice(savedColon + 1);
                              if (savedG !== g) return false;
                              if (savedV === v) return true;
                              // savedV is a name → look up its code via dimensions metadata
                              const dimMeta = (dimensions || []).find(d => {
                                const dg = String(d.dimensionGroup ?? d.DimensionGroup ?? d.groupName ?? d.GroupName ?? "").trim();
                                const dn = String(d.dimensionName ?? d.DimensionName ?? d.name ?? d.Name ?? "").trim();
                                return dg === savedG && dn === savedV;
                              });
                              if (!dimMeta) return false;
                              const mappedCode = String(dimMeta.dimensionCode ?? dimMeta.DimensionCode ?? dimMeta.code ?? dimMeta.Code ?? "").trim();
                              return mappedCode === v;
                            });
});
                        });
                      });
                      // Fallback: if dim filter yields no leaves, show all leaves so user can still drill
                      if (leaves.length === 0) {
                        leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== "plain");
                      }
                    }
const hasDrill = leaves.length > 0 || (node.children && node.children.length > 0);
                const isHighlighted = savedHighlightedIds && (savedHighlightedIds.has?.(node.id) || savedHighlightedIds.has?.(node.originalId));
sectionRows.push(
<tr key={rowKey}
                        className={`border-b border-gray-100 transition-colors ${isHighlighted ? "bg-amber-50/60 hover:bg-amber-50" : "bg-white"} ${hasDrill ? `cursor-pointer ${isHighlighted ? "" : "hover:bg-[#eef1fb]/60"}` : ""}`}
                        style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(sectionRows.length, 25) * 35 + 50}ms both` }}
                        onClick={hasDrill ? (e) => { e.stopPropagation(); toggle(rowKey); } : undefined}
>
                        <td className="py-3 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 20}px` }}>
                          <div className="flex items-center">
                            {hasDrill
                              ? <span className="text-[#1a2f8a]/50 mr-2">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
                              : <span className="inline-block mr-2" style={{ width: 12 }} />}
                            {node.code && <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>}
<span style={depth === 0 ? body1Style : body2Style}>
                              {node.name ? (node.name.charAt(0).toUpperCase() + node.name.slice(1).toLowerCase()) : node.code}
                            </span>
                            {isHighlighted && (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1.5 flex-shrink-0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                            )}
{node.dims && node.dims.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHoveredDimRow(hoveredDimRow === rowKey ? null : rowKey);
                                }}
                                className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border transition-colors ${
                                  hoveredDimRow === rowKey
                                    ? "bg-amber-100 border-amber-300"
                                    : "bg-amber-50 border-amber-200 hover:bg-amber-100"
                                }`}>
                                <span className="text-amber-500" style={{ fontSize: 8 }}>◆</span>
                                <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">
                                  {node.dims.length}
                                </span>
                              </button>
                            )}
                          </div>
                        </td>
<PLAmountCell value={displayVal} typoStyle={depth === 0 ? body1Style : body2Style} />
                        {compareMode && (() => {
                          let cmpVal = sumLiteralB(node);
                          if (node.isSum && node.children && node.children.length > 0) {
                            cmpVal = node.children.reduce((s, c) => s + sumLiteralB(c), cmpVal);
                          }
                          return (
                            <>
                              <PLAmountCell value={cmpVal} typoStyle={depth === 0 ? body1Style : body2Style} divider />
                              <DeviationCells a={displayVal} b={cmpVal} typoStyle={depth === 0 ? body1Style : body2Style} />
                            </>
                          );
                        })()}
                        {compareMode && cmp2Enabled && (() => {
                          let cmp2Val = sumLiteralC(node);
                          if (node.isSum && node.children && node.children.length > 0) {
                            cmp2Val = node.children.reduce((s, c) => s + sumLiteralC(c), cmp2Val);
                          }
                          return (
                            <>
                              <PLAmountCell value={cmp2Val} typoStyle={depth === 0 ? body1Style : body2Style} divider />
                              <DeviationCells a={displayVal} b={cmp2Val} typoStyle={depth === 0 ? body1Style : body2Style} />
                            </>
                          );
                        })()}
                        {historyExpanded && historyMonthsProcessed.map((h) => {
                          const histGaNode = h.map.get(String(node.code));
                          let histVal = 0;
                          if (histGaNode) {
                            const ytd = -sumNode(histGaNode);
                            if (ytdOnly) {
                              histVal = ytd;
                            } else {
                              const prevNode = h.prevMap.get(String(node.code));
                              const prevYtd = prevNode ? -sumNode(prevNode) : 0;
                              histVal = ytd - prevYtd;
                            }
                          }
                          return <PLAmountCell key={`hist-saved-cell-${h.year}-${h.month}-${node.id}`} value={histVal} typoStyle={depth === 0 ? body1Style : body2Style} />;
                        })}
                        <td />
                      </tr>
                    );
                    // Hover expansion: show each dim breakdown inline
                   if (hoveredDimRow === rowKey && node.dims && node.dims.length > 0) {
                      const gaForHover = treeByCode.get(String(node.code));
                      node.dims.forEach((d, di) => {
                        const dimVal = -sumDimRecursive(gaForHover, String(d));
                        sectionRows.push(
<tr key={`${rowKey}-hoverdim-${di}`}
                            className="border-b border-amber-100 bg-amber-50/40 transition-colors">
                            <td className="py-1.5" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-px bg-amber-300 flex-shrink-0" />
                               <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                                <span style={subbody2Style}>{String(d).split(":").pop()}</span>
                              </div>
                            </td>
<PLAmountCell value={dimVal} typoStyle={subbody2Style} />
                            {compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                            {compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                            {historyExpanded && historyMonthsProcessed.map((h) => (
                              <td key={`hist-saved-dim-${h.year}-${h.month}-${di}`} />
                            ))}
                            <td />
                          </tr>
                        );
                      });
                    }

                    // Drill-down: local accounts + dim breakdown for this group account
                    if (expanded && hasDrill) {
                      leaves.forEach((leaf, i) => {
                        const leafKey = `${rowKey}-leaf-${i}`;
                        const leafExpanded = !!expandedMap[leafKey];
                        const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
                        const amt = leaf.amount ?? 0;

                        sectionRows.push(
                          <tr key={leafKey}
                            className={`border-b border-[#1a2f8a]/5 bg-white transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/30" : "hover:bg-[#f0f3ff]"}`}
                            onClick={hasDims ? (e) => { e.stopPropagation(); toggle(leafKey); } : undefined}>
<td className="py-1.5" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-px bg-[#1a2f8a]/10 flex-shrink-0" />
                                {hasDims
                                  ? <span className="text-gray-300 flex-shrink-0">{leafExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
                                  : <span className="w-3 flex-shrink-0" />}
                                {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
                                <span style={subbody1Style}>{leaf.name || ""}</span>
                              </div>
                            </td>
<PLAmountCell value={-amt} typoStyle={subbody1Style} />
                            {compareMode && (() => {
                              const cmpAmt = leaf.code ? -(cmpLeafIndex.get(String(leaf.code)) ?? 0) : 0;
                              return (
                                <>
                                  <PLAmountCell value={cmpAmt} typoStyle={subbody1Style} divider />
                                  <DeviationCells a={-amt} b={cmpAmt} typoStyle={subbody1Style} />
                                </>
                              );
                            })()}
                            {compareMode && cmp2Enabled && (() => {
                              const cmp2Amt = leaf.code ? -(cmp2LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                              return (
                                <>
                                  <PLAmountCell value={cmp2Amt} typoStyle={subbody1Style} divider />
                                  <DeviationCells a={-amt} b={cmp2Amt} typoStyle={subbody1Style} />
                                </>
                              );
                            })()}
                            {historyExpanded && historyMonthsProcessed.map((h) => {
                              const leafAmt = leaf.code ? (h.leafIdx.get(String(leaf.code)) ?? 0) : 0;
                              const leafPrev = leaf.code ? (h.prevLeafIdx.get(String(leaf.code)) ?? 0) : 0;
                              const leafVal = ytdOnly ? -leafAmt : -(leafAmt - leafPrev);
                              return <PLAmountCell key={`hist-saved-leaf-${h.year}-${h.month}-${i}`} value={leafVal} typoStyle={subbody1Style} />;
                            })}
                          </tr>
                        );

// Dim breakdown under this leaf — filtered to matching dim only if saved node has dim filters
                        if (leafExpanded && hasDims) {
                          let dimChildren = leaf.children;
                          if (node.dims && node.dims.length > 0) {
                            const acceptedKeys = new Set(node.dims.map(d => String(d)));
                            dimChildren = leaf.children.filter(dim => {
                              const dimCode = String(dim.code ?? "");
                              const dimName = String(dim.name ?? "");
                              // Match if any saved dim key equals "*:code" or "*:name" (with or without group prefix)
                              return [...acceptedKeys].some(savedKey => {
                                const colon = savedKey.indexOf(":");
                                const savedVal = colon === -1 ? savedKey : savedKey.slice(colon + 1);
                                return savedVal === dimCode || savedVal === dimName;
                              });
                            });
                          }
                          dimChildren.forEach((dim, j) => {
                            sectionRows.push(
                              <tr key={`${leafKey}-dim-${j}`}
                                className="border-b border-[#1a2f8a]/5 bg-white hover:bg-amber-50/40 transition-colors cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); setDimPopup(dim); }}>
<td className="py-1" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
                                   <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                                    <span style={subbody2Style}>{dim.name || dim.code}</span>
                                  </div>
                                </td>
                                <PLAmountCell value={-dim.amount} typoStyle={subbody2Style} />
                                {compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                                {compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                                {historyExpanded && historyMonthsProcessed.map((h) => (
                                  <td key={`hist-saved-dim-leaf-${h.year}-${h.month}-${j}`} />
                                ))}
                                <td />
                              </tr>
                            );
                          });
                        }
                      });
                    }
// Mapping children: only render if this row is expanded
                    if (expanded && node.children && node.children.length > 0) {
                      (node.children || []).forEach(c => renderNode(c, depth + 1, `${parentPath}-${node.id}`));
                    }
                  };
                  section.nodes.forEach(n => renderNode(n, 0, "root"));
                  return sectionRows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <Loader2 size={28} className="text-[#1a2f8a] animate-spin mx-auto mb-3" />
      <p className="text-gray-400 text-sm">Loading P&L data…</p>
    </div>
  );
  if (error) return <ErrorBox error={error} />;
  if (!uploadedAccounts.length || !groupAccounts.length) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
        <TrendingUp size={24} className="text-[#1a2f8a]" />
      </div>
      <p className="text-gray-400 text-sm font-semibold">{t("waiting_for_data")}</p>
    </div>
  );



return (
<div className="space-y-3 flex flex-col" style={{ minHeight: 0, flex: 1, overflow: "visible" }}>
{JournalPopup}
      {dimPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDimPopup(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-amber-500 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Network size={13} className="text-white/70" />
                </div>
                <div>
                  <p className="text-white font-black text-sm">{dimPopup.name || dimPopup.code || "—"}</p>
                  <p className="text-white/60 text-[10px] font-medium uppercase tracking-widest">Dimension</p>
                </div>
              </div>
              <button onClick={() => setDimPopup(null)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                <X size={13} className="text-white/70" />
              </button>
            </div>
            <div className="p-5 space-y-1">
              {[
                ["Code", dimPopup.code],
                ["Name", dimPopup.name],
                ["Amount YTD", dimPopup.amount != null ? fmtAmt(dimPopup.amount) : null],
                ["Company", dimPopup.company],
              ].filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—").map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex-shrink-0 mt-0.5">{label}</span>
                  <span className="text-xs text-gray-700 font-medium text-right">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
{compareMode && filtersOpen && (
  <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
    style={{ overflow: "visible", position: "relative", zIndex: 100, marginBottom: 12, flex: "0 0 auto" }}>
    {/* Period B row */}
    <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)",
            boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)",
          }}>
          <span className="text-white text-[11px] font-black">B</span>
        </div>
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Period B</span>
      </div>

   <HeaderFilterPill label="Year" value={cmpFilters.year} onChange={v => onCmpFilterChange("year", v)}
        options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
      <HeaderFilterPill label="Month" value={cmpFilters.month} onChange={v => onCmpFilterChange("month", v)}
        options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
      <HeaderFilterPill label="Source" value={cmpFilters.source} onChange={v => onCmpFilterChange("source", v)}
        options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
      <HeaderFilterPill label="Structure" value={cmpFilters.structure} onChange={v => onCmpFilterChange("structure", v)}
        options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
<HeaderFilterPill label="Company" value={cmpFilters.company} onChange={v => onCmpFilterChange("company", v)}
          options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
<HeaderMultiFilterPill label="DIM GRP" values={cmpFilters.dimGroups} onChange={vs => onCmpFilterChange("dimGroups", vs)}
        options={dimGroups.map(g => ({ value: g, label: g }))} />
      <HeaderMultiFilterPill label="DIMS" values={cmpFilters.dimensions} onChange={vs => onCmpFilterChange("dimensions", vs)}
        options={cmpFilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
      {!cmp2Enabled && (
        <button onClick={() => onCmp2EnabledChange(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
          style={{
            background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)",
            boxShadow: "0 4px 14px -4px rgba(87,170,120,0.5)",
          }}>
          <span className="text-white text-[10px] font-black">+ Add Period C</span>
        </button>
      )}
    </div>

    {/* Period C row */}
    {cmp2Enabled && (
      <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100"
        style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.06s both" }}>
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)",
              boxShadow: "0 4px 12px -4px rgba(87,170,120,0.5)",
            }}>
            <span className="text-white text-[11px] font-black">C</span>
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>Period C</span>
        </div>

<HeaderFilterPill label="Year" value={cmp2Filters?.year} onChange={v => onCmp2FilterChange("year", v)}
          options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
        <HeaderFilterPill label="Month" value={cmp2Filters?.month} onChange={v => onCmp2FilterChange("month", v)}
          options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
        <HeaderFilterPill label="Source" value={cmp2Filters?.source} onChange={v => onCmp2FilterChange("source", v)}
          options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
        <HeaderFilterPill label="Structure" value={cmp2Filters?.structure} onChange={v => onCmp2FilterChange("structure", v)}
          options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
<HeaderFilterPill label="Company" value={cmp2Filters?.company} onChange={v => onCmp2FilterChange("company", v)}
          options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
<HeaderMultiFilterPill label="DIM GRP" values={cmp2Filters?.dimGroups} onChange={vs => onCmp2FilterChange("dimGroups", vs)}
          options={dimGroups.map(g => ({ value: g, label: g }))} />
        <HeaderMultiFilterPill label="DIMS" values={cmp2Filters?.dimensions} onChange={vs => onCmp2FilterChange("dimensions", vs)}
          options={cmp2FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
        <button onClick={() => onCmp2EnabledChange(false)}
          className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all duration-200 hover:scale-[1.05]"
          style={{
            background: "#fee2e2",
            color: "#dc2626",
          }}
          title="Remove Period C">
          <X size={12} strokeWidth={2.5} />
        </button>
</div>
    )}
  </div>
)}

<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col" style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}><button id="__plExportTrigger" onClick={handleExportPdf} className="hidden" />
<button id="__plXlsxTrigger" onClick={handleExportXlsx} className="hidden" />
<div style={{ display: "none" }}>
  <div className="flex items-center gap-3">
{compareMode && (
      <button onClick={() => setFiltersOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all"
        style={{ background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}80` }}>
        <ChevronDown size={12} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
        {filtersOpen ? "Hide filters" : "Show filters"}
      </button>
    )}
<button onClick={() => {
  if (Object.values(expandedMap).some(Boolean)) {
    setExpandedMap({});
    return;
  }
  const next = {};
  const walk = (node, outerCode, depth, parentCode) => {
    (node.uploadLeaves || []).forEach((leaf, i) => {
      if (leaf.type !== "plain") {
        next[`drill-leaf-${outerCode}-${parentCode}-${depth}-${i}`] = true;
      }
    });
    (node.children || [])
      .filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType))
      .forEach(child => {
        next[`drill-${outerCode}-${child.code}`] = true;
        walk(child, outerCode, depth + 1, child.code);
      });
  };
  (summaryMode ? summaryRows : allSumRows).forEach(node => {
    next[node.code] = true;
    walk(node, node.code, 0, node.code);
  });
  setExpandedMap(next);
}}
className="flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black transition-all"
      style={{ background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}80` }}

      title={Object.values(expandedMap).some(Boolean) ? "Collapse all" : "Expand all"}>
{Object.values(expandedMap).some(Boolean)
        ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      }
    </button>
    <button onClick={onToggleCompare}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all"
      style={compareMode
        ? { backgroundColor: colors.quaternary ?? "#F59E0B", color: colors.primary ?? "#1a2f8a" }
        : { background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}80` }}>
      <GitMerge size={12} /> Compare

    </button>
<div className="relative flex items-center p-1 rounded-xl" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
      ref={el => {
        if (!el) return;
        const btns = el.querySelectorAll("button");
        const active = btns[ytdOnly ? 1 : 0];
        const pill = el.querySelector(".pl-pill-ytd");
        if (active && pill) {
          pill.style.left = active.offsetLeft + "px";
          pill.style.width = active.offsetWidth + "px";
        }
      }}>
      <span className="pl-pill-ytd" style={{
        position: "absolute",
        top: 4, bottom: 4,
        backgroundColor: colors.quaternary ?? "#F59E0B",
        borderRadius: 8,
        transition: "left 0.25s cubic-bezier(0.4,0,0.2,1), width 0.25s cubic-bezier(0.4,0,0.2,1)",
        pointerEvents: "none",
      }} />
      <button onClick={() => setYtdOnly(false)}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
        style={{ color: !ytdOnly ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        Monthly
      </button>
      <button onClick={() => setYtdOnly(true)}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
        style={{ color: ytdOnly ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        YTD
      </button>
    </div>
    <div className="relative flex items-center p-1 rounded-xl" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
      ref={el => {
        if (!el) return;
        const btns = el.querySelectorAll("button");
        const active = btns[summaryMode ? 1 : 0];
        const pill = el.querySelector(".pl-pill-sum");
        if (active && pill) {
          pill.style.left = active.offsetLeft + "px";
          pill.style.width = active.offsetWidth + "px";
        }
      }}>
      <span className="pl-pill-sum" style={{
        position: "absolute",
        top: 4, bottom: 4,
        backgroundColor: colors.quaternary ?? "#F59E0B",
        borderRadius: 8,
        transition: "left 0.25s cubic-bezier(0.4,0,0.2,1), width 0.25s cubic-bezier(0.4,0,0.2,1)",
        pointerEvents: "none",
      }} />
      <button onClick={() => setSummaryMode(false)}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
        style={{ color: !summaryMode ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        Detailed
      </button>
      <button onClick={() => setSummaryMode(true)}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
        style={{ color: summaryMode ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        Summary
      </button>
    </div>
  </div>
</div>




<div className="overflow-auto scrollbar-hide" style={{ flex: 1, minHeight: 0 }}>
<table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
  <colgroup>
    <col style={{ width: "1px" }} />
    <col style={{ width: "1px" }} />
    {compareMode && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
    {compareMode && cmp2Enabled && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
    <col />
  </colgroup>
<thead className="sticky top-0 z-10">
<tr className="border-b border-gray-100" style={{
  background: "rgba(255,255,255,0.95)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
<th className="text-left px-6 w-px whitespace-nowrap" style={{ height: "64px", background: "transparent" }}>
  <div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
    <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>
      Account
    </span>
    <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
      Profit & Loss
    </span>
  </div>
</th>
<th className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px", cursor: compareMode ? "default" : "pointer" }}
  onClick={toggleHistory}
  title={compareMode ? "" : (historyExpanded ? "Hide history" : "Show last 12 months")}>
  <span key={ytdOnly ? "ytd" : "monthly"} className="font-black tracking-tight inline-block"
    style={{ color: colors.primary, fontSize: 16, letterSpacing: "-0.02em" }}>
    {(ytdOnly ? t("mode_ytd") : t("mode_monthly")).split("").map((ch, i) => (
      <span key={i} className="inline-block"
        style={{
          animation: `letterMorph 420ms cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 35}ms both`,
        }}>
        {ch}
      </span>
    ))}
  </span>
  </th>
  {historyExpanded && historyMonthsProcessed.map((h) => (
    <th key={`hist-${h.year}-${h.month}`} className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
      <div className="flex flex-col items-end">
        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>
          {MONTHS.find(m => m.value === h.month)?.label.slice(0,3)}
        </span>
        <span className="text-[10px] font-bold" style={{ color: "#9ca3af" }}>{h.year}</span>
      </div>
    </th>
  ))}
  {historyExpanded && historyLoading && (
    <th className="text-center px-3 py-3" style={{ background: "transparent" }}>
      <Loader2 size={14} className="animate-spin" style={{ color: colors.primary }} />
    </th>
  )}
  {compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Period B</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmpLabel}</span>
    </div>
  </th>}
{compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>Period C</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmp2Label}</span>
    </div>
  </th>}
<th className="text-right pr-6 py-3" style={{ background: "transparent" }}>
    <div className="flex items-center justify-end gap-2" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
      {compareMode && (
        <button onClick={() => setFiltersOpen(o => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
          style={{
            background: filtersOpen ? `${colors.primary}12` : "transparent",
            color: filtersOpen ? colors.primary : "#9ca3af",
          }}>
          <ChevronDown size={10} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
          <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
      )}
      <button onClick={() => {
        if (Object.values(expandedMap).some(Boolean)) { setExpandedMap({}); return; }
        const next = {};
        const walk = (node, outerCode, depth, parentCode) => {
          (node.uploadLeaves || []).forEach((leaf, i) => {
            if (leaf.type !== "plain") next[`drill-leaf-${outerCode}-${parentCode}-${depth}-${i}`] = true;
          });
          (node.children || [])
            .filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType))
            .forEach(child => {
              next[`drill-${outerCode}-${child.code}`] = true;
              walk(child, outerCode, depth + 1, child.code);
            });
        };
        (summaryMode ? summaryRows : allSumRows).forEach(node => {
          next[node.code] = true;
          walk(node, node.code, 0, node.code);
        });
        setExpandedMap(next);
      }}
        className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-[1.05]"
        style={{ background: `${colors.primary}12`, color: colors.primary, width: 28, height: 28, overflow: "hidden" }}
        title={Object.values(expandedMap).some(Boolean) ? "Collapse all" : "Expand all"}>
        <span key={Object.values(expandedMap).some(Boolean) ? "collapse" : "expand"}
          className="inline-flex"
          style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
          {Object.values(expandedMap).some(Boolean)
            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </span>
      </button>
      <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}
        ref={el => {
          if (!el) return;
          const btns = el.querySelectorAll("[data-mode-pill]");
          const active = btns[summaryMode ? 0 : 1];
          const pill = el.querySelector(".sum-det-pill");
          if (active && pill) {
            pill.style.left = active.offsetLeft + "px";
            pill.style.width = active.offsetWidth + "px";
            pill.style.top = active.offsetTop + "px";
            pill.style.height = active.offsetHeight + "px";
          }
        }}>
        <span className="sum-det-pill" style={{
          position: "absolute",
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          transition: "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), width 320ms cubic-bezier(0.34, 1.56, 0.64, 1), top 320ms cubic-bezier(0.34, 1.56, 0.64, 1), height 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          pointerEvents: "none",
          zIndex: 0,
        }} />
        {[["summary","Summary"],["detailed","Detailed"]].map(([v,l]) => {
          const active = (v === "summary" && summaryMode) || (v === "detailed" && !summaryMode);
          return (
            <button key={v} data-mode-pill onClick={() => setSummaryMode(v === "summary")}
              className="relative z-10 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider"
              style={{
                background: "transparent",
                color: active ? colors.primary : "#9ca3af",
                transition: "color 280ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}>
              {l}
            </button>
          );
        })}
      </div>
    </div>
  </th>
</tr>
</thead>
            <tbody>
              {console.log("allSumRows codes:", allSumRows.map(n=>n.code), "breakers.pl:", Object.keys(breakers.pl))}
{(summaryMode ? summaryRows : allSumRows).map((node, nodeIdx, nodeArr) => {


const ytd      = -sumNode(node);
const prevYtd  = -getPrevYtd(node.code);
const cmpYtd = compareMode ? -getCmpYtd(node.code) : 0;
const cmpMon = compareMode ? -getCmpYtd(node.code) - (-getCmpPrev(node.code)) : 0;
const mon      = ytd - prevYtd;
const expanded = !!expandedMap[node.code];
const hasKids  = (node.children||[]).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType)).length > 0
                || (node.uploadLeaves || []).some(l => l.type !== "plain");
const isHighlighted = PL_HIGHLIGHTED_CODES.has(String(node.code)) || String(node.code).endsWith(".S") || String(node.code).endsWith(".PL");
const SECTION_DIVIDERS_MAP = Object.keys(effectiveBreakersPl).length
  ? effectiveBreakersPl
  : summaryRows.some(n => /[a-zA-Z]/.test(String(n.code)))
    ? { "A.04.S": { label: "Ingresos", color: colors.primary }, "A.13.S": { label: "Gastos operativos", color: colors.secondary }, "A.24.S": { label: "Resultado final", color: colors.tertiary } }
    : { "11999": { label: "Ingresos", color: colors.primary }, "53999": { label: "Gastos operativos", color: colors.secondary }, "89999": { label: "Resultado final", color: colors.tertiary } };

const DETAIL_DIVIDERS_BEFORE = (() => {
  const fallback = summaryRows.some(n => /[a-zA-Z]/.test(String(n.code)))
    ? { "A.04.S": { label: "Ingresos", color: colors.primary }, "A.13.S": { label: "Gastos operativos", color: colors.secondary }, "A.24.S": { label: "Resultado neto", color: colors.tertiary } }
    : { "10999": { label: "Ingresos", color: colors.primary }, "12199": { label: "Gastos operativos", color: colors.secondary }, "89999": { label: "Resultado final", color: colors.tertiary } };
const source = Object.keys(effectiveBreakersPl).length ? effectiveBreakersPl : fallback;
  if (allSumRows.length === 0) return source;
  const remapped = { ...source };
  const positions = Object.keys(remapped)
    .map(code => ({ code, pos: allSumRows.findIndex(n => n.code === code) }))
    .filter(x => x.pos >= 0)
    .sort((a, b) => a.pos - b.pos);
  if (positions.length > 0) {
    const earliest = positions[0];
    const firstCode = allSumRows[0].code;
    if (earliest.code !== firstCode) {
      remapped[firstCode] = remapped[earliest.code];
      delete remapped[earliest.code];
    }
  }
  return remapped;
})();

const divider = !summaryMode
  ? (DETAIL_DIVIDERS_BEFORE[String(node.code)] ?? null)
: ((PL_HIGHLIGHTED_CODES.has(String(node.code)) || String(node.code).endsWith(".S") || String(node.code).endsWith(".PL") || Object.keys(effectiveBreakersPl).includes(String(node.code)))
      ? SECTION_DIVIDERS_MAP[String(node.code)] ?? null
      : null);


  return [
divider ? (
  <tr key={`divider-${node.code}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(nodeIdx, 25) * 35}ms both` }}>
    <td colSpan={compareMode ? (cmp2Enabled ? 9 : 6) : (3 + (historyExpanded ? historyMonthsProcessed.length : 0))} style={{ backgroundColor: divider.color }} className="px-6 py-1.5">
      <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
    </td>
  </tr>
) : null,
<tr key={node.code}
      className="border-b border-gray-100 bg-white cursor-pointer hover:bg-[#eef1fb]/60 transition-colors"
      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(nodeIdx, 25) * 35 + 50}ms both` }}
      onClick={(e) => { e.stopPropagation(); toggle(node.code); }}>
<td className="py-3 px-6 whitespace-nowrap">
  <div className="flex items-center">
    {hasKids
      ? <span className="text-[#1a2f8a]/50 mr-2">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
      : <span className="inline-block mr-2" style={{ width: 12 }} />}
    <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>
    <span style={body1Style}>
      {(() => { const n = localName(node); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); })()}
    </span>
  </div>
</td>
      {!ytdOnly && <PLAmountCell value={mon} typoStyle={body1Style} />}
      {!ytdOnly && compareMode && <PLAmountCell value={cmpMon} typoStyle={body1Style} divider />}
      {!ytdOnly && compareMode && <DeviationCells a={mon} b={cmpMon} typoStyle={body1Style} />}
      {!ytdOnly && compareMode && cmp2Enabled && (() => {
        const cmp2Ytd = -getCmp2Ytd(node.code);
        const cmp2Mon = cmp2Ytd - (-getCmp2Prev(node.code));
        return <>
          <PLAmountCell value={cmp2Mon} typoStyle={body1Style} divider />
          <DeviationCells a={mon} b={cmp2Mon} typoStyle={body1Style} />
        </>;
      })()}
{ytdOnly && <PLAmountCell value={ytd} typoStyle={body1Style} />}
      {ytdOnly && compareMode && <PLAmountCell value={cmpYtd} typoStyle={body1Style} divider />}
      {ytdOnly && compareMode && <DeviationCells a={ytd} b={cmpYtd} typoStyle={body1Style} />}
      {ytdOnly && compareMode && cmp2Enabled && (() => {
        const cmp2Ytd = -getCmp2Ytd(node.code);
        return <>
          <PLAmountCell value={cmp2Ytd} typoStyle={body1Style} divider />
          <DeviationCells a={ytd} b={cmp2Ytd} typoStyle={body1Style} />
        </>;
      })()}
      {historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
        const hYtd = -getHistYtd(h, node.code);
        const hPrev = -getHistPrev(h, node.code);
        const hMon = hYtd - hPrev;
        return <PLAmountCell key={`hist-cell-${h.year}-${h.month}-${node.code}`} value={ytdOnly ? hYtd : hMon} typoStyle={body1Style} />;
      })}
    </tr>,
...(expanded ? (function renderChildren(children, leaves, depth, parentCode) {

  const rows = [];

  // Group account children
  children.filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType)).forEach(child => {
    const cYtd = -sumNode(child);
    const cPrev = -getPrevYtd(child.code);
    const cMon = cYtd - cPrev;
    const cCmpYtd = compareMode ? -getCmpYtd(child.code) : 0;
    const cCmpMon = compareMode ? cCmpYtd - (-getCmpPrev(child.code)) : 0;
    const cCmp2Ytd = compareMode ? -getCmp2Ytd(child.code) : 0;
    const cCmp2Mon = compareMode ? cCmp2Ytd - (-getCmp2Prev(child.code)) : 0;
    const childExpanded = !!expandedMap[`drill-${node.code}-${child.code}`];
    const grandkids = (child.children || []).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType));
    const hasMore = grandkids.length > 0 || (child.uploadLeaves?.length > 0);

rows.push(
  <tr key={child.code}
    className={`border-b border-[#1a2f8a]/5 bg-white transition-colors ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : "hover:bg-[#eef1fb]/20"}`}
    onClick={hasMore ? (e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [`drill-${node.code}-${child.code}`]: !prev[`drill-${node.code}-${child.code}`] })); } : undefined}>
<td className="py-2 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 20}px` }}>
      <div className="flex items-center gap-2">
        {hasMore
          ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{childExpanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
          : <span className="w-3 flex-shrink-0" />}
        <span className="font-mono text-gray-400" style={subbody2Style}>{child.code}</span>
        <span style={body2Style}>{localName(child)}</span>
      </div>
    </td>
    {!ytdOnly && <PLAmountCell value={cMon} typoStyle={body2Style} />}
    {!ytdOnly && compareMode && <PLAmountCell value={cCmpMon} typoStyle={body2Style} divider />}
    {!ytdOnly && compareMode && <DeviationCells a={cMon} b={cCmpMon} typoStyle={body2Style} />}
{!ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cCmp2Mon} typoStyle={body2Style} divider />}
    {!ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={cMon} b={cCmp2Mon} typoStyle={body2Style} />}
    {ytdOnly && <PLAmountCell value={cYtd} typoStyle={body2Style} />}
    {ytdOnly && compareMode && <PLAmountCell value={cCmpYtd} typoStyle={body2Style} divider />}
    {ytdOnly && compareMode && <DeviationCells a={cYtd} b={cCmpYtd} typoStyle={body2Style} />}
    {ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cCmp2Ytd} typoStyle={body2Style} divider />}
    {ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={cYtd} b={cCmp2Ytd} typoStyle={body2Style} />}
    {historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
      const hYtd = -getHistYtd(h, child.code);
      const hPrev = -getHistPrev(h, child.code);
      const hMon = hYtd - hPrev;
      return <PLAmountCell key={`hist-child-${h.year}-${h.month}-${child.code}`} value={ytdOnly ? hYtd : hMon} typoStyle={body2Style} />;
    })}
  </tr>
);

if (childExpanded && hasMore) {
           rows.push(...renderChildren(grandkids, child.uploadLeaves || [], depth + 1, child.code));

    }

    if (childExpanded) {
      const jrnRows = (journalByCode.get(child.code) || []);
      if (jrnRows.length > 0) {
        const jrnKey = `jrn-child-${node.code}-${child.code}`;
        const jrnExpanded = !!expandedMap[jrnKey];
rows.push(
  <tr key={jrnKey}
    className="border-b border-[#1a2f8a]/5 bg-white cursor-pointer hover:bg-indigo-50/40 transition-colors"
    onClick={(e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [jrnKey]: !prev[jrnKey] })); }}>
    <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
        <span className="text-[#1a2f8a]/40 flex-shrink-0">
          {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}
        </span>
<span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
          {t("label_journal")}
        </span>
       <span style={subbody2Style}>{jrnRows.length} {jrnRows.length === 1 ? t("entry") : t("entries")}</span>
      </div>
    </td>
<td />{compareMode && <><td /><td /><td /></>}{compareMode && cmp2Enabled && <><td /><td /><td /></>}
    {historyExpanded && !compareMode && historyMonthsProcessed.map((h) => (
      <td key={`hist-jrnhdr-${h.year}-${h.month}-${child.code}`} />
    ))}
  </tr>
);
if (jrnExpanded) {
  jrnRows.forEach((jrn, k) => {
    const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
    rows.push(
      <tr key={`jrn-child-entry-${node.code}-${child.code}-${k}`}
        className="border-b border-[#1a2f8a]/5 bg-white hover:bg-indigo-50/40 transition-colors cursor-pointer"
        onClick={(e) => { e.stopPropagation(); setJrnPopup(jrn); }}>
        <td className="py-1" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-200 flex-shrink-0" />
            <span className="flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" style={subbody2Style}>{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
            {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="flex-shrink-0" style={subbody2Style}>{jrn.journalHeader ?? jrn.JournalHeader}</span>}
            {(jrn.rowText ?? jrn.RowText) && <span className="truncate max-w-[250px]" style={subbody2Style}>— {jrn.rowText ?? jrn.RowText}</span>}
            {(jrn.counterpartyShortName ?? jrn.CounterpartyShortName) && <span className="ml-auto flex-shrink-0" style={subbody2Style}>{jrn.counterpartyShortName ?? jrn.CounterpartyShortName}</span>}
          </div>
        </td>
{(() => {
  const jrnNum = jrn.journalNumber ?? jrn.JournalNumber;
  const cmpJrn = (journalByCodeCmp.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jrnNum);
  const cmp2Jrn = (journalByCodeCmp2.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jrnNum);
  const cmpAmt = cmpJrn ? -parseAmt(cmpJrn.amountYTD ?? cmpJrn.AmountYTD ?? 0) : 0;
  const cmp2Amt = cmp2Jrn ? -parseAmt(cmp2Jrn.amountYTD ?? cmp2Jrn.AmountYTD ?? 0) : 0;
  return (
    <>
      {!ytdOnly && <PLAmountCell value={-amt} typoStyle={subbody2Style} />}
      {!ytdOnly && compareMode && <PLAmountCell value={cmpAmt} typoStyle={subbody2Style} divider />}
      {!ytdOnly && compareMode && <DeviationCells a={-amt} b={cmpAmt} typoStyle={subbody2Style} />}
      {!ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cmp2Amt} typoStyle={subbody2Style} divider />}
      {!ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={-amt} b={cmp2Amt} typoStyle={subbody2Style} />}
      {ytdOnly && <PLAmountCell value={-amt} typoStyle={subbody2Style} />}
      {ytdOnly && compareMode && <PLAmountCell value={cmpAmt} typoStyle={subbody2Style} divider />}
      {ytdOnly && compareMode && <DeviationCells a={-amt} b={cmpAmt} typoStyle={subbody2Style} />}
{ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cmp2Amt} typoStyle={subbody2Style} divider />}
      {ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={-amt} b={cmp2Amt} typoStyle={subbody2Style} />}
      {historyExpanded && !compareMode && historyMonthsProcessed.map((h) => (
        <td key={`hist-jrn-${h.year}-${h.month}-${k}`} />
      ))}
    </>
  );
})()}
      </tr>
    );
  });
}
      }
    }
  });

// Upload leaves (local accounts)
  leaves.forEach((leaf, i) => {
    if (leaf.type === "plain") return;
    const leafKey = `drill-leaf-${node.code}-${parentCode ?? node.code}-${depth}-${i}`;

    const leafExpanded = !!expandedMap[leafKey];
    const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
    const amt = leaf.amount ?? 0;

rows.push(
  <tr key={leafKey}
    className={`border-b border-[#1a2f8a]/5 bg-white transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/30" : "hover:bg-[#f0f3ff]"}`}
    onClick={hasDims ? (e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [leafKey]: !prev[leafKey] })); } : undefined}>
    <td className="py-1.5 border-r-0" style={{ paddingLeft: `${24 + depth * 20}px` }}>
      <div className="flex items-center gap-2">
        <div className="w-2 h-px bg-[#1a2f8a]/10 flex-shrink-0" />
        {hasDims
          ? <span className="text-gray-300 flex-shrink-0">{leafExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
          : <span className="w-3 flex-shrink-0" />}
        {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
        <span style={subbody1Style}>{leaf.name || ""}</span>
      </div>
    </td>
    {!ytdOnly && <PLAmountCell value={-(amt - (leaf.code ? getPrevLeafAmt(leaf.code) : 0))} typoStyle={subbody1Style} />}
    {!ytdOnly && compareMode && (() => {
      const cmpAmt = leaf.code ? -getCmpLeafAmt(leaf.code) : 0;
      return <><PLAmountCell value={cmpAmt} typoStyle={subbody1Style} divider /><DeviationCells a={-(amt - (leaf.code ? getPrevLeafAmt(leaf.code) : 0))} b={cmpAmt} typoStyle={subbody1Style} /></>;
    })()}
    {!ytdOnly && compareMode && cmp2Enabled && (() => {
      const cmp2Amt = leaf.code ? -getCmp2LeafAmt(leaf.code) : 0;
      return <><PLAmountCell value={cmp2Amt} typoStyle={subbody1Style} divider /><DeviationCells a={-(amt - (leaf.code ? getPrevLeafAmt(leaf.code) : 0))} b={cmp2Amt} typoStyle={subbody1Style} /></>;
    })()}
    {ytdOnly && <PLAmountCell value={-amt} typoStyle={subbody1Style} />}
    {ytdOnly && compareMode && (() => {
      const cmpAmt = leaf.code ? -getCmpLeafAmt(leaf.code) : 0;
      return <><PLAmountCell value={cmpAmt} typoStyle={subbody1Style} divider /><DeviationCells a={-amt} b={cmpAmt} typoStyle={subbody1Style} /></>;
    })()}
    {ytdOnly && compareMode && cmp2Enabled && (() => {
      const cmp2Amt = leaf.code ? -getCmp2LeafAmt(leaf.code) : 0;
      return <><PLAmountCell value={cmp2Amt} typoStyle={subbody1Style} divider /><DeviationCells a={-amt} b={cmp2Amt} typoStyle={subbody1Style} /></>;
    })()}
{historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
      const leafYtd = -(h.leafIdx.get(String(leaf.code ?? "")) ?? 0);
      const leafPrevYtd = -(h.prevLeafIdx.get(String(leaf.code ?? "")) ?? 0);
      const leafMon = leafYtd - leafPrevYtd;
      return <PLAmountCell key={`hist-leaf-${h.year}-${h.month}-${i}`} value={ytdOnly ? leafYtd : leafMon} typoStyle={subbody1Style} />;
    })}
  </tr>
);

if (leafExpanded && hasDims) {
  leaf.children.forEach((dim, j) => {
    rows.push(
    <tr key={`dim-${parentCode ?? node.code}-${depth}-${i}-${j}`}
      className="border-b border-[#1a2f8a]/5 bg-white hover:bg-amber-50/40 transition-colors cursor-pointer"
      onClick={(e) => { e.stopPropagation(); setDimPopup(dim); }}>
      <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
          <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
          <span style={subbody2Style}>{dim.name || dim.code}</span>
        </div>
      </td>
      {!ytdOnly && <PLAmountCell value={-(dim.amount - getPrevDimAmt(leaf.code, dim.code))} typoStyle={subbody2Style} />}
      {!ytdOnly && compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
      {!ytdOnly && compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
      {ytdOnly && <PLAmountCell value={-dim.amount} typoStyle={subbody2Style} />}
      {ytdOnly && compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
      {ytdOnly && compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
      {historyExpanded && !compareMode && historyMonthsProcessed.map((h) => (
        <td key={`hist-dim-${h.year}-${h.month}-${j}`} />
      ))}
    </tr>
    );
  });
}
  });

  return rows;
})(node.children || [], node.uploadLeaves || [], 0, node.code) : []),

  ];
})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Financial Report panel ───────────────────────────────── */
function FinancialReport({ groupAccounts, uploadedAccounts, loading, error }) {
  const [expandedMap, setExpandedMap] = useState({});
  const [typeFilter, setTypeFilter]   = useState("ALL");
  const [search, setSearch]           = useState("");

  const dispatch = (key) => setExpandedMap(prev => ({ ...prev, [key]: !prev[key] }));

  const tree = useMemo(
    () => buildTree(groupAccounts, uploadedAccounts),
    [groupAccounts, uploadedAccounts]
  );

  const visibleRoots = useMemo(() => {
    let roots = tree.filter(hasData);
   if (typeFilter !== "ALL") roots = roots.filter(n => typeFilter === "P/L" ? ["P/L","DIS"].includes(n.accountType) : n.accountType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      const matches = (node) =>
        String(node.code).toLowerCase().includes(q) ||
        String(node.name ?? "").toLowerCase().includes(q) ||
        node.children?.some(matches) ||
        node.uploadLeaves?.some(l =>
          String(l.code ?? "").toLowerCase().includes(q) ||
          String(l.name ?? "").toLowerCase().includes(q)
        );
      roots = roots.filter(matches);
    }
    return roots;
  }, [tree, typeFilter, search]);

  function expandAll() {
    const next = {};
    function walk(node) {
      next[`ga-${node.code}`] = true;
      node.children?.forEach(c => walk(c, node.code));
      node.uploadLeaves?.forEach((l, i) => {
        next[`leaf-${node.code}-${i}`] = true;
      });
    }
    visibleRoots.forEach(n => walk(n, null));
    setExpandedMap(next);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
        <Loader2 size={28} className="text-[#1a2f8a] animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading financial data…</p>
      </div>
    );
  }

  if (error) return <ErrorBox error={error} />;

  if (!uploadedAccounts.length || !groupAccounts.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
        <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <TrendingUp size={24} className="text-[#1a2f8a]" />
        </div>
        <p className="text-gray-400 text-sm font-semibold">Waiting for data…</p>
        <p className="text-gray-300 text-xs mt-1">Data is being loaded automatically.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 bg-gray-100/70 rounded-xl">
          {["ALL", "P/L", "B/S",].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${typeFilter === t ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#eef1fb] text-[#1a2f8a]">
          <Hash size={11} />{visibleRoots.length} sections · {uploadedAccounts.length} rows · {groupAccounts.length} group accs
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
            <Search size={13} className="text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts…"
              className="text-xs outline-none text-gray-700 w-36 bg-transparent placeholder:text-gray-300" />
            {search && <button onClick={() => setSearch("")}><X size={12} className="text-gray-400" /></button>}
          </div>
<button onClick={expandAll}
            className="px-3 py-2 rounded-xl bg-white border border-gray-100 shadow-sm text-xs font-bold text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/20 transition-all">
            {t("btn_expand_all")}
          </button>
          <button onClick={() => setExpandedMap({})}
            className="px-3 py-2 rounded-xl bg-white border border-gray-100 shadow-sm text-xs font-bold text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/20 transition-all">
            {t("btn_collapse_all")}
          </button>
        </div>
      </div>

      {visibleRoots.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-xl">
<p className="text-gray-400 text-sm font-semibold">{t("no_accounts_match_filter")}</p>
          <p className="text-gray-300 text-xs mt-1">{t("try_different_filter_or_clear")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col" style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 8px 24px -4px rgba(26, 47, 138, 0.15), 0 4px 8px -2px rgba(26, 47, 138, 0.08)" }}>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-gray-100 bg-[#1a2f8a]/5">
<th className="text-left px-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest">{t("col_account")}</th>
                  <th className="text-right px-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest whitespace-nowrap w-36">{t("col_amount_period")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRoots.map(node => {
                  const key = `ga-${node.code}`;
                  return (
                    <GroupAccountRow key={key} node={node} depth={0}
                      expanded={!!expandedMap[key]} onToggle={() => dispatch(key)}
                      expandedMap={expandedMap} dispatch={dispatch} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TABS CONFIG
═══════════════════════════════════════════════════════════════ */
const UPLOADED_HIDDEN = new Set(["dimensions", "journalType", "journalLayer", "origin",
  "counterpartyShortName", "branchShortName", "branchLegalName"]);

const useTabs = () => {
  const t = useT();
  return [
    { id: "pl",       label: t("tab_pl"),       icon: TrendingUp, accent: "#1a2f8a", desc: t("tab_pl_desc") },
    { id: "bs",       label: t("tab_bs_short"), icon: BarChart2,  accent: "#71E09D" },
    { id: "uploaded", label: "",                icon: Upload,     accent: "#e8394a", desc: t("tab_uploaded_desc") },
  ];
};
const TABS = [
  { id: "pl",       label: "P&L",    icon: TrendingUp, accent: "#1a2f8a", desc: "Profit & Loss statement" },
  { id: "bs",      label: "B.SH.",  icon: BarChart2,  accent: "#71E09D" },
  { id: "uploaded", label: "", icon: Upload,    accent: "#e8394a", desc: "Raw uploaded account data" },
];

/* ═══════════════════════════════════════════════════════════════
   ROOT COMPONENT
   Auto-loads all three data sources on mount (once valid
   source/structure props are available). The Financial Report
   tab is shown first by default.
═══════════════════════════════════════════════════════════════ */
const BS_HIGHLIGHTED_CODES = new Set([
  '199999', '299999', '399999', '499999', '799999', '899999', '999999',
]);

function isBSHighlighted(node) {
  if (BS_HIGHLIGHTED_CODES.has(String(node.code))) return true;
  const code = String(node.code);
  // Spanish alphanumeric BS codes — only highlight the main section totals
  const SPANISH_BS_HIGHLIGHTED = new Set([
'C.ACT', 'G.PYC', 'G.PAS',
    'A.S', 'B.S', 'D.S', 'E.S', 'F.S',
    'C', 'D', 'G', 'H',
  ]);
  if (SPANISH_BS_HIGHLIGHTED.has(code)) return true;
  return false;
}

const PL_HIGHLIGHTED_CODES = new Set([
  '11999',  // Revenue
  '15999',  // Contribution
  '53999',  // EBITDA
  '57999',  // EBIT
  '69999',  // EBT
  '89999',  // Profit/loss for the year
]);

/* ═══════════════════════════════════════════════════════════════
   SAVED-MAPPING → {rows, sections} CONVERTER
   Walks the saved pl_tree / bs_tree JSON (which has hierarchical
   nodes + "breaker" section dividers) and flattens it into the
   shape PLStatement / BalanceSheet already expect for pgcMapping.
═══════════════════════════════════════════════════════════════ */
function normalizeBSSectionCode(label) {
  const lc = String(label || "").toLowerCase();
  if (/(activo|asset)/.test(lc))            return "ACTIVO";
  if (/(pasivo|liabilit)/.test(lc))         return "PASIVO";
  if (/(patrimonio|equity|net\s*worth)/.test(lc)) return "PATRIMONIO";
  return null;
}

// Standard-mapping converter (code-keyed). Kept untouched for the
// pgcMapping / pgcBsMapping prop shape the renderers expect.
function convertSavedMappingTree(tree, opts = {}) {
  if (!Array.isArray(tree) || tree.length === 0) return null;
  const { normalizeBS = false } = opts;

  const rows = new Map();      // code -> { section, sortOrder, isSum, showInSummary, level }
  const sections = new Map();  // sectionCode -> { label, color }
  const names = new Map();     // code -> first-seen display name
  let sortCounter = 0;
  let defaultSecCounter = 0;

  function walk(nodes, depth, parentSection) {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "breaker") {
        let secCode = node.sectionCode || `section_${defaultSecCounter++}`;
        if (normalizeBS) {
          const canon = normalizeBSSectionCode(node.name);
          if (canon) secCode = canon;
        }
        sections.set(secCode, {
          label: String(node.name ?? "Section"),
          color: node.color || "#1a2f8a",
        });
        walk(node.children || [], depth, secCode);
      } else {
        const code = String(node.code ?? "");
        if (!code) continue;
        const sec = parentSection || "_default";
        if (!sections.has(sec)) sections.set(sec, { label: "", color: "#1a2f8a" });
        rows.set(code, {
          section: sec,
          sortOrder: sortCounter++,
          isSum: true,
          showInSummary: !!node.showInSummary,
          level: depth,
        });
        if (!names.has(code) && node.name) names.set(code, String(node.name));
        walk(node.children || [], depth + 1, sec);
      }
    }
  }

  walk(tree, 0, null);
  if (rows.size === 0) return null;
  return { rows, sections, names };
}

// Saved-mapping LITERAL tree (preserves duplicates + dims + hierarchy).
// Used only by the saved-mapping render path; standard mappings ignore this.
function buildSavedMappingLiteral(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return null;
  const sections = []; // [{ label, color, nodes: [literalNode, ...] }]
  let current = { label: null, color: null, nodes: [] };
  sections.push(current);

  function literal(node, depth) {
    return {
      id: String(node.id ?? `${node.code}-${Math.random()}`),
      originalId: node.id ? String(node.id) : null,
      code: String(node.code ?? ""),
      name: String(node.name ?? ""),
      dims: Array.isArray(node.dims) && node.dims.length > 0 ? node.dims : null,
      isSum: !!node.isSum || !!node.isSumAccount,
      depth,
      children: (node.children || [])
        .filter(c => c && c.kind !== "breaker")
        .map(c => literal(c, depth + 1)),
    };
  }

  for (const node of tree) {
    if (!node) continue;
    if (node.kind === "breaker") {
      current = {
        label: String(node.name ?? "Section"),
        color: node.color || "#1a2f8a",
        nodes: [],
      };
      sections.push(current);
      (node.children || [])
        .filter(c => c && c.kind !== "breaker")
        .forEach(c => current.nodes.push(literal(c, 0)));
    } else {
      current.nodes.push(literal(node, 0));
    }
  }
  // Drop the initial blank section if no rows landed in it
  const cleaned = sections.filter((s, i) => i > 0 || s.nodes.length > 0);
  return cleaned.length === 0 ? null : cleaned;
}

function BSAmountCell({ value, divider, typoStyle }) {
  const animated = useCountUp(value ?? 0, 1000);
  const isEmpty = value === 0;
  const isNeg = animated < 0;
  const semanticColor = isEmpty ? "#D1D5DB" : isNeg ? "#EF4444" : null;

  const style = {
    ...(typoStyle ?? {}),
    ...(semanticColor ? { color: semanticColor } : {}),
    ...(divider ? { borderLeft: "2px solid #e2e8f0" } : {}),
  };

  return (
    <td className="pl-8 pr-6 py-2.5 text-right whitespace-nowrap tabular-nums" style={{ ...style, width: "200px" }}>
      {isEmpty ? "—" : isNeg ? `(${fmtAmt(Math.abs(animated))})` : fmtAmt(animated)}
    </td>
  );
}

function BSDeviationCells({ a, b, typoStyle }) {
  const { diff, pct } = deviation(a, b);
  const isNeg = diff < 0;
  const color = diff === 0 ? "#D1D5DB" : isNeg ? "#F87171" : "#059669";
  const pctStr = pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const diffStr = diff === 0 ? "—" : isNeg ? `(${fmtAmt(Math.abs(diff))})` : fmtAmt(diff);

  const style = { ...(typoStyle ?? {}), color };

  return (
<>
      <td className="pl-4 pr-6 py-2.5 text-right whitespace-nowrap tabular-nums" style={{ ...style, width: "140px" }}>{diffStr}</td>
      <td className="pl-2 pr-6 py-2.5 text-right whitespace-nowrap tabular-nums" style={{ ...style, width: "100px" }}>{pctStr}</td>
    </>
  );
}



function BalanceSheet({ externalBsDrillMap, externalSetBsDrillMap, onHistoryExpandedChange, groupAccounts, uploadedAccounts,dimensions = [], loading, error, month, year, source, structure, company, sources, structures, companies, dimGroups, token, journalEntries = [], onCompareChange, dimensionActive = false, upDimGroup = "", upDimension = "", filteredDims = [], externalCmp2Enabled, onBsCmp2EnabledChange, breakers = { pl: {}, bs: {}, cf: {} }, pgcBsMapping = null, savedBsLiteral = null,
  compareMode, setCompareMode,
  cmpYear, setCmpYear, cmpMonth, setCmpMonth, cmpSource, setCmpSource, cmpStructure, setCmpStructure, cmpCompany, setCmpCompany,
  cmpData, setCmpData,
  cmp2Year, setCmp2Year, cmp2Month, setCmp2Month, cmp2Source, setCmp2Source, cmp2Structure, setCmp2Structure, cmp2Company, setCmp2Company,
  cmp2Data, setCmp2Data,
bsCmpDimGroups, setBsCmpDimGroups,
  bsCmpDimensions, setBsCmpDimensions,
  bsCmp2DimGroups, setBsCmp2DimGroups,
  bsCmp2Dimensions, setBsCmp2Dimensions,
  effectiveDimensions = [],
}) {
const { colors } = useSettings();
  const t = useT();
  const MONTHS = useMonths();
const [filtersOpen, setFiltersOpen] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyMonths, setHistoryMonths] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchBSHistoryMonth = useCallback(async (y, mo) => {
    if (!token || !source || !structure || !y || !mo) return { data: [] };
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const filter = `Year eq ${y} and Month eq ${mo} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    try {
      const res = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
      const json = res.ok ? await res.json() : { value: [] };
      return { data: json.value ?? (Array.isArray(json) ? json : []) };
    } catch { return { data: [] }; }
  }, [token, source, structure]);

  const toggleBSHistory = useCallback(async () => {
    if (compareMode) return;
    if (historyExpanded) {
      setHistoryExpanded(false);
      setHistoryMonths([]);
      onHistoryExpandedChange?.(false);
      return;
    }
    setHistoryExpanded(true);
    onHistoryExpandedChange?.(true);
    setHistoryLoading(true);
    const targets = [];
    let y = Number(year), m = Number(month);
    for (let i = 0; i < 5; i++) {
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      targets.push({ year: y, month: m });
    }
    for (const target of targets) {
      const { data } = await fetchBSHistoryMonth(target.year, target.month);
      setHistoryMonths(prev => [...prev, { year: target.year, month: target.month, data }]);
    }
    setHistoryLoading(false);
  }, [compareMode, historyExpanded, year, month, fetchBSHistoryMonth, onHistoryExpandedChange]);

  const localName = useCallback((node) => {
    return pgcBsMapping?.names?.get(String(node.code)) ?? node.name;
  }, [pgcBsMapping]);

  const [cmpLoading, setCmpLoading] = useState(false);
  const header3Style = useTypo("header3");
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const subbody1Style = useTypo("subbody1");
  const subbody2Style = useTypo("subbody2");
  const [cmp2Loading, setCmp2Loading] = useState(false);
const [bsView, setBsView] = useState("summary");

const bsCmpFilteredDims = useMemo(() => {
  if (!bsCmpDimGroups || bsCmpDimGroups.length === 0) return effectiveDimensions;
  return effectiveDimensions.filter(d => {
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return bsCmpDimGroups.includes(g);
  });
}, [effectiveDimensions, bsCmpDimGroups]);

const bsCmp2FilteredDims = useMemo(() => {
  if (!bsCmp2DimGroups || bsCmp2DimGroups.length === 0) return effectiveDimensions;
  return effectiveDimensions.filter(d => {
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return bsCmp2DimGroups.includes(g);
  });
}, [effectiveDimensions, bsCmp2DimGroups]);
const [cmp2EnabledInternal, setCmp2EnabledInternal] = useState(true);
  const cmp2Enabled = externalCmp2Enabled !== undefined ? externalCmp2Enabled : cmp2EnabledInternal;
  const setCmp2Enabled = (v) => { setCmp2EnabledInternal(v); onBsCmp2EnabledChange?.(v); };
const bsDrillMap = externalBsDrillMap ?? {};
const setBsDrillMap = externalSetBsDrillMap ?? (() => {});
useEffect(() => {
  console.log("🔥 bsDrillMap CHANGED:", Object.keys(bsDrillMap).length, "keys");
}, [bsDrillMap]);
useEffect(() => {
  console.log("🔥 compareMode CHANGED:", compareMode, "| bsDrillMap keys at this moment:", Object.keys(bsDrillMap).length);
}, [compareMode]);

// Intentionally do NOT reset bsDrillMap on compareMode/cmp2Enabled changes
// so the user keeps their expanded rows when toggling compare or removing Period C.
  const [jrnPopup, setJrnPopup] = useState(null);
  const [dimPopup, setDimPopup] = useState(null);
const bsDrill = useCallback((key) => {
  setBsDrillMap(prev => {
    const next = { ...prev, [key]: !prev[key] };
    console.log("bsDrill updating:", key, "new value:", next[key], "all keys:", Object.keys(next));
    return next;
  });
}, []);



const journalByCode = useMemo(() => {
  const idx = new Map();
  (journalEntries || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? "");
    if (!code) return;
    const jt = String(row.journalType ?? row.JournalType ?? "").toUpperCase();
    if (jt !== "AJE" && jt !== "RJE") return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntries]);

const bsCmpLeafIndex = useMemo(() => {
  const idx = new Map();
  (cmpData || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmpData]);

const bsCmp2LeafIndex = useMemo(() => {
  const idx = new Map();
  console.log("cmp2Data for leaf index:", cmp2Data?.length);
  (cmp2Data || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp2Data]);

const [allCompaniesData, setAllCompaniesData] = useState([]);
const [allCompaniesLoading, setAllCompaniesLoading] = useState(false);
const allCompaniesCacheKey = useRef("");
const allCompaniesCmpCacheKey = useRef("");
const allCompaniesCmp2CacheKey = useRef("");

const fetchAllCompanies = useCallback(async () => {
  if (!year || !month || !source || !structure || !company) return;
  const key = `${year}|${month}|${source}|${structure}|${company}`;
  if (allCompaniesCacheKey.current === key) return;
  allCompaniesCacheKey.current = key;
  setAllCompaniesLoading(true);
  try {
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const res = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    const json = res.ok ? await res.json() : { value: [] };
    setAllCompaniesData(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setAllCompaniesData([]); allCompaniesCacheKey.current = ""; }
  finally { setAllCompaniesLoading(false); }
}, [year, month, source, structure, company, token]);

useEffect(() => {
  if (bsView !== "summary") fetchAllCompanies();
}, [bsView, fetchAllCompanies]);

const [allCompaniesCmpData, setAllCompaniesCmpData] = useState([]);
const [allCompaniesCmp2Data, setAllCompaniesCmp2Data] = useState([]);
const fetchAllCompaniesCmp = useCallback(async (yr, mo, src, str) => {
  const y = yr ?? cmpYear; const m = mo ?? cmpMonth;
  const s = src ?? cmpSource; const st = str ?? cmpStructure;
  const co = cmpCompany;
  if (!y || !m || !s || !st || !co) return;
  const key = `${y}|${m}|${s}|${st}|${co}`;
  if (allCompaniesCmpCacheKey.current === key) return;
  allCompaniesCmpCacheKey.current = key;
  try {
    const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}' and CompanyShortName eq '${co}'`;
    const res = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json = res.ok ? await res.json() : { value: [] };
    setAllCompaniesCmpData(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setAllCompaniesCmpData([]); allCompaniesCmpCacheKey.current = ""; }
}, [cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, token]);

const fetchAllCompaniesCmp2 = useCallback(async (yr, mo, src, str) => {
  const y = yr ?? cmp2Year; const m = mo ?? cmp2Month;
  const s = src ?? cmp2Source; const st = str ?? cmp2Structure;
  const co = cmp2Company;
  if (!y || !m || !s || !st || !co) return;
  const key = `${y}|${m}|${s}|${st}|${co}`;
  if (allCompaniesCmp2CacheKey.current === key) return;
  allCompaniesCmp2CacheKey.current = key;
  try {
    const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}' and CompanyShortName eq '${co}'`;
    const res = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json = res.ok ? await res.json() : { value: [] };
    setAllCompaniesCmp2Data(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setAllCompaniesCmp2Data([]); allCompaniesCmp2CacheKey.current = ""; }
}, [cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, token]);

useEffect(() => {
  if (bsView !== "summary" && compareMode) {
    fetchAllCompaniesCmp();
    fetchAllCompaniesCmp2();
  }
}, [bsView, compareMode, fetchAllCompaniesCmp, fetchAllCompaniesCmp2]);

const filteredAllCompaniesData = useMemo(() => {
  if (!allCompaniesData.length) return [];
  if (upDimension) return allCompaniesData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === upDimension);
  if (upDimGroup) return allCompaniesData.filter(r => filteredDims.some(d => {
    const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d);
    return String(r.dimensionCode ?? r.DimensionCode ?? "") === v;
  }));
  return allCompaniesData;
}, [allCompaniesData, upDimension, upDimGroup, filteredDims]);

const companyColumns = useMemo(() => {
  const seen = new Set();
  const cols = [];
  filteredAllCompaniesData.forEach(r => {
    const co = String(r.CompanyShortName ?? r.companyShortName ?? "");
    const cur = String(r.CurrencyCode ?? r.currencyCode ?? "");
    const key = `${co}|||${cur}`;
    if (co && !seen.has(key)) { seen.add(key); cols.push({ company: co, currency: cur }); }
  });
  return cols.sort((a, b) => a.company.localeCompare(b.company));
}, [allCompaniesData]);



const companyTree = useMemo(() => {
  if (!filteredAllCompaniesData.length) return [];
  return buildTree(groupAccounts, filteredAllCompaniesData, !dimensionActive);
}, [groupAccounts, filteredAllCompaniesData, dimensionActive]);


function renderBSDrill(node, parentKey, parentDepth = 0) {

  if (!bsDrillMap[parentKey]) return null;
  const children = (node.children || []).filter(hasData);
  const leaves = (node.uploadLeaves || []).filter(l => l.type !== "plain");

  // PGC: build a set of codes that are already in the flat list (summary or detailed),
  // so the drill doesn't repaint them.
  const pgcRenderedCodes = (() => {
    if (!pgcBsMapping?.rows) return null;
    const flatNodes = bsView === "summary" ? bsPgcSummaryNodes : bsPgcAllSumNodes;
    return new Set((flatNodes || []).map(n => String(n.code)));
  })();

const renderDrillChildren = (children, leaves, depth, contextKey) => {

    const rows = [];

    children.filter(hasData).forEach(child => {
      // PGC: skip children whose code is already shown as a sibling in the flat list
      if (pgcRenderedCodes && pgcRenderedCodes.has(String(child.code))) return;
      const childKey = `bsdrill-${contextKey}-${child.code}`;
      const childExpanded = !!bsDrillMap[childKey];
      const grandkids = (child.children || []).filter(hasData);
      const hasMore = grandkids.length > 0 || (child.uploadLeaves?.filter(l => l.type !== "plain").length > 0);
      const total = Number(child.code) >= 599999 ? -sumNode(child) : sumNode(child);
      const isBold = BS_HIGHLIGHTED_CODES.has(String(child.code));

rows.push(
  <tr key={childKey}
    className={`border-b border-[#1a2f8a]/5 transition-colors ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : "hover:bg-[#eef1fb]/30"}`}
    onClick={hasMore ? () => setBsDrillMap(prev => ({ ...prev, [childKey]: !prev[childKey] })) : undefined}>
<td className="py-2 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 20}px` }}>
<div className="flex items-center">
  {hasMore
    ? <span className="text-[#1a2f8a]/50 mr-2">{childExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
    : <span className="inline-block mr-2" style={{ width: 12 }} />}
  <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{child.code}</span>
  <span style={body2Style}>{child.name}</span>
</div>
    </td>
<td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap w-36 ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>
            {total === 0 ? "—" : fmtAmt(total)}
          </td>
{compareMode && (() => {
const activeCmpTree = bsView === "summary" ? cmpTree : allCmpTree;
const cmpRaw = activeCmpTree.length ? getNodeValue(activeCmpTree, child.code) : 0;
const cmpVal = Number(child.code) >= 599999 ? -cmpRaw : cmpRaw;
            const devB = total - cmpVal;
            const devBPct = cmpVal !== 0 ? (devB / Math.abs(cmpVal)) * 100 : null;
            const devColor = v => v === 0 ? "text-gray-300" : v > 0 ? "text-emerald-600" : "text-red-500";
            return <>
              <td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap text-[#CF305D]`} style={{ borderLeft: "2px solid #e2e8f0" }}>{cmpVal === 0 ? "-" : fmtAmt(cmpVal)}</td>
              <td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap ${devColor(devB)}`}>{devB === 0 ? "-" : fmtAmt(devB)}</td>
              <td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap ${devColor(devB)}`}>{devBPct === null ? "—" : `${devBPct >= 0 ? "+" : ""}${devBPct.toFixed(1)}%`}</td>
              {cmp2Enabled && (() => {
                const activeCmp2Tree = bsView === "summary" ? cmp2Tree : allCmp2Tree;
const cmp2Raw = activeCmp2Tree.length ? getNodeValue(activeCmp2Tree, child.code) : 0;
const cmp2Val = Number(child.code) >= 599999 ? -cmp2Raw : cmp2Raw;
                const devC = total - cmp2Val;
                const devCPct = cmp2Val !== 0 ? (devC / Math.abs(cmp2Val)) * 100 : null;
return <>
  <td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap text-[#57aa78]`} style={{ borderLeft: "2px solid #e2e8f0" }}>{cmp2Val === 0 ? "-" : fmtAmt(cmp2Val)}</td>
                  <td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap ${devColor(devC)}`}>{devC === 0 ? "-" : fmtAmt(devC)}</td>
                  <td className={`text-right pr-4 py-2 font-mono text-xs whitespace-nowrap ${devColor(devC)}`}>{devCPct === null ? "—" : `${devCPct >= 0 ? "+" : ""}${devCPct.toFixed(1)}%`}</td>
                </>;
              })()}
            </>;
          })()}
          {historyExpanded && !compareMode && bsHistoryProcessed.map(h => (
            <BSAmountCell key={`bshist-drill-${h.year}-${h.month}-${child.code}`} value={getBSHistVal(h, child.code)} typoStyle={body2Style} />
          ))}
        </tr>
      );

if (childExpanded && hasMore) {
        // Also filter grandkids by the same rule
        const filteredGrandkids = pgcRenderedCodes
          ? grandkids.filter(g => !pgcRenderedCodes.has(String(g.code)))
          : grandkids;
        rows.push(...renderDrillChildren(filteredGrandkids, child.uploadLeaves?.filter(l => l.type !== "plain") || [], depth + 1, childKey));
      }

      if (childExpanded) {
        const jrnRows = (journalByCode.get(child.code) || []);
        if (jrnRows.length > 0) {
          const jrnKey = `bsjrn-child-${contextKey}-${child.code}`;
          const jrnExpanded = !!bsDrillMap[jrnKey];
          rows.push(
            <tr key={jrnKey}
              className="border-b border-[#1a2f8a]/5 cursor-pointer hover:bg-indigo-50/50 transition-colors bg-indigo-50/20"
              onClick={() => setBsDrillMap(prev => ({ ...prev, [jrnKey]: !prev[jrnKey] }))}>
              <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
<span className="text-[#1a2f8a]/40 flex-shrink-0">
                    {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}
                  </span>
                  <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
                    journal
                  </span>
                  <span className="text-[10px] text-gray-400">{jrnRows.length} {jrnRows.length === 1 ? t("entry") : t("entries")}</span>f
                </div>
              </td>
<td className="text-right pr-4 py-1 font-mono text-xs text-gray-300">—</td>
              {compareMode && <><td /><td /><td /></>}
              {compareMode && cmp2Enabled && <><td /><td /><td /></>}
            </tr>
          );
          if (jrnExpanded) {
            jrnRows.forEach((jrn, k) => {
              const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
              rows.push(
              <tr key={`bsjrn-child-entry-${contextKey}-${child.code}-${k}`}
                  className="border-b border-[#1a2f8a]/5 hover:bg-indigo-50/40 transition-colors bg-indigo-50/10 cursor-pointer"
                  onClick={() => setJrnPopup(jrn)}>
                  <td className="py-1" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-px bg-indigo-100 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-indigo-400 flex-shrink-0">{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader ?? ""}</span>
                      {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-300 italic truncate max-w-[200px]">{jrn.rowText ?? jrn.RowText}</span>}
                      {(jrn.counterpartyShortName ?? jrn.CounterpartyShortName) && <span className="text-[10px] text-gray-300 ml-1">· {jrn.counterpartyShortName ?? jrn.CounterpartyShortName}</span>}
                    </div>
                  </td>
<td className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">
                    {amt === 0 ? "—" : fmtAmt(amt)}
                  </td>
                  {compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                  {compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                </tr>
              );
            });
          }
        }
      }
    });

    leaves.forEach((leaf, i) => {
      const leafKey = `bsdrill-leaf-${contextKey}-${depth}-${i}`;
      const leafExpanded = !!bsDrillMap[leafKey];
      const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
      const amt = leaf.amount ?? 0;

      rows.push(
<tr key={leafKey}
          className={`border-b border-[#1a2f8a]/5 bg-[#fafbff] transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/40" : "hover:bg-[#eef1fb]/20"}`}
          onClick={hasDims ? () => setBsDrillMap(prev => ({ ...prev, [leafKey]: !prev[leafKey] })) : undefined}>
<td className="py-1.5 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 20}px` }}>
  <div className="flex items-center">
    {hasDims
      ? <span className="text-[#1a2f8a]/50 mr-2">{leafExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
      : <span className="inline-block mr-2" style={{ width: 12 }} />}
    {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
    <span style={subbody1Style}>{leaf.name || ""}</span>
  </div>
</td>
<td className="text-right pr-4 py-1.5 font-mono text-xs text-gray-400 w-36">

            {amt === 0 ? "—" : fmtAmt(amt)}
          </td>
{compareMode && (() => {
            const cmpAmt = leaf.code ? bsCmpLeafIndex.get(String(leaf.code)) ?? 0 : 0;
            const devB = amt - cmpAmt;
            const devBPct = cmpAmt !== 0 ? (devB / Math.abs(cmpAmt)) * 100 : null;
            const devColor = v => v === 0 ? "text-gray-300" : v > 0 ? "text-emerald-600" : "text-red-500";
            return <>
              <td className="text-right pr-4 py-1.5 font-mono text-xs text-[#CF305D]" style={{ borderLeft: "2px solid #e2e8f0" }}>{cmpAmt === 0 ? "—" : fmtAmt(cmpAmt)}</td>
              <td className={`text-right pr-4 py-1.5 font-mono text-xs ${devColor(devB)}`}>{devB === 0 ? "—" : fmtAmt(devB)}</td>
              <td className={`text-right pr-4 py-1.5 font-mono text-xs ${devColor(devB)}`}>{devBPct === null ? "—" : `${devBPct >= 0 ? "+" : ""}${devBPct.toFixed(1)}%`}</td>
              {cmp2Enabled && (() => {
                const cmp2Amt = leaf.code ? (bsCmp2LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                const devC = amt - cmp2Amt;
                const devCPct = cmp2Amt !== 0 ? (devC / Math.abs(cmp2Amt)) * 100 : null;
                return <>
                  <td className="text-right pr-4 py-1.5 font-mono text-xs text-[#57aa78]" style={{ borderLeft: "2px solid #e2e8f0" }}>{cmp2Amt === 0 ? "—" : fmtAmt(cmp2Amt)}</td>
                  <td className={`text-right pr-4 py-1.5 font-mono text-xs ${devColor(devC)}`}>{devC === 0 ? "—" : fmtAmt(devC)}</td>
                  <td className={`text-right pr-4 py-1.5 font-mono text-xs ${devColor(devC)}`}>{devCPct === null ? "—" : `${devCPct >= 0 ? "+" : ""}${devCPct.toFixed(1)}%`}</td>
                </>;
              })()}
            </>;
          })()}
{historyExpanded && !compareMode && bsHistoryProcessed.map(h => {
            const leafAmt = leaf.code ? (h.leafIdx.get(String(leaf.code)) ?? 0) : 0;
            return <BSAmountCell key={`bshist-leaf-${h.year}-${h.month}-${i}`} value={leafAmt} typoStyle={subbody1Style} />;
          })}
        </tr>
      );

      if (leafExpanded && hasDims) {
        leaf.children.forEach((dim, j) => {
          rows.push(
<tr key={`bsdrill-dim-${contextKey}-${depth}-${i}-${j}`}
              className="border-b border-[#1a2f8a]/5 hover:bg-amber-50/40 transition-colors bg-amber-50/10 cursor-pointer"
              onClick={() => setDimPopup(dim)}>
              <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                  <span className="text-xs text-gray-400 italic">{dim.name || dim.code}</span>
                </div>
              </td>
<td className="text-right pr-4 py-1 font-mono text-xs text-gray-400">

                {dim.amount === 0 ? "—" : fmtAmt(dim.amount)}
              </td>
{compareMode && <><td /><td /><td /></>}
{compareMode && cmp2Enabled && <><td /><td /><td /></>}
            </tr>
          );
        });
      }
  if (leafExpanded) {
        const jrnRows = (journalByCode.get(leaf.code) || []);
        if (jrnRows.length > 0) {
          const jrnKey = `bsjrn-leaf-${contextKey}-${depth}-${i}`;
          const jrnExpanded = !!bsDrillMap[jrnKey];
          rows.push(
            <tr key={jrnKey}
              className="border-b border-[#1a2f8a]/5 cursor-pointer hover:bg-indigo-50/40 transition-colors"
              onClick={() => setBsDrillMap(prev => ({ ...prev, [jrnKey]: !prev[jrnKey] }))}>
              <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
                  <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
                   {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>} {t("label_journal")}
                  </span>
                  <span className="text-[10px] text-gray-400">{jrnRows.length} entries</span>
                </div>
              </td>
              <td className="text-right pr-8 py-1 font-mono text-xs text-gray-300">—</td>
            </tr>
          );
          if (jrnExpanded) {
            jrnRows.forEach((jrn, k) => {
              const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
              rows.push(
                <tr key={`bsjrn-${contextKey}-${depth}-${i}-${k}`}
                  className="border-b border-[#1a2f8a]/5 hover:bg-indigo-50/40 transition-colors bg-indigo-50/10 cursor-pointer"
                  onClick={() => setJrnPopup(jrn)}>
                  <td className="py-1" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-px bg-indigo-100 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-indigo-400 flex-shrink-0">{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader ?? ""}</span>
                      {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-300 italic truncate max-w-[200px]">{jrn.rowText ?? jrn.RowText}</span>}
                      {(jrn.counterpartyShortName ?? jrn.CounterpartyShortName) && <span className="text-[10px] text-gray-300 ml-1">· {jrn.counterpartyShortName ?? jrn.CounterpartyShortName}</span>}
                    </div>
                  </td>
                  <td className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">

                    {amt === 0 ? "—" : fmtAmt(amt)}
                  </td>
                </tr>
              );
            });
          }
        }
      }

    });

    return rows;
  };

return renderDrillChildren(children, leaves, parentDepth + 1, parentKey);

}

function renderMultiCompanyRows(nodes, accountTypeFilter) {
  const rows = [];
  const isAssetsRoot = (node) => {
    const name = (node.name ?? "").toLowerCase();
    return name.includes("asset") || name.includes("activo");
  };
  const filteredRoots = nodes.filter(n => {
    if (n.accountType !== "B/S" || !hasData(n)) return false;
    if (accountTypeFilter === "assets") return isAssetsRoot(n);
    if (accountTypeFilter === "equity") return !isAssetsRoot(n);
    return true;
  });



  const devColor = v => v === 0 ? "text-gray-300" : v > 0 ? "text-emerald-600" : "text-red-500";

function renderNode(node, depth = 0) {
    const isBold = isBSHighlighted(node);
    const kids = (node.children || []).filter(hasData);
    const drillKey = `bsmulti-${node.code}`;
   const expanded = !!bsDrillMap[drillKey];
    console.log("BS node:", node.code, node.name);
    const hasMore = kids.length > 0 || node.uploadLeaves?.filter(l => l.type !== "plain").length > 0;

    // Render kids first (same as before — post-order)
    if (kids.length > 0) kids.forEach(k => renderNode(k, depth + 1));

    const getAmtFromData = (data, company, code) => {
      const sum = data
        .filter(r => String(r.CompanyShortName ?? r.companyShortName ?? "") === company &&
                     String(r.AccountCode ?? r.accountCode ?? "") === code)
        .reduce((s, r) => s + parseAmt(getField(r, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod")), 0);
      return Number(code) >= 599999 ? -sum : sum;
    };

    rows.push(
      <tr key={node.code}
        className={`border-b border-gray-100 ${isBold ? "bg-[#eef1fb]" : "bg-white"} ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
        onClick={hasMore ? () => bsDrill(drillKey) : undefined}>
<td className="px-6 py-2.5 sticky left-0 bg-inherit z-10 min-w-[220px]">
          <div className="flex items-center gap-2">
            {hasMore
              ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{expanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            <span className="font-mono text-gray-400 flex-shrink-0" style={subbody2Style}>{node.code}</span>
            <span className={`text-xs ${isBold ? "font-bold text-[#1a2f8a] uppercase tracking-wider" : "text-gray-600"}`}>
              {isBold ? (localName(node).toUpperCase()) : (() => { const n = localName(node); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); })()}
            </span>
          </div>
        </td>
        {companyColumns.map(({ company }) => {
          const actual = getAmtFromData(allCompaniesData, company, node.code);
          const cmpVal = compareMode ? getAmtFromData(allCompaniesCmpData, company, node.code) : null;
          const cmp2Val = compareMode ? getAmtFromData(allCompaniesCmp2Data, company, node.code) : null;
          const devB = cmpVal !== null ? actual - cmpVal : null;
          const devBPct = (cmpVal !== null && cmpVal !== 0) ? (devB / Math.abs(cmpVal)) * 100 : null;
          const devC = cmp2Val !== null ? actual - cmp2Val : null;
          const devCPct = (cmp2Val !== null && cmp2Val !== 0) ? (devC / Math.abs(cmp2Val)) * 100 : null;
          return (
            <React.Fragment key={company}>
              <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[120px] ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>
                {actual === 0 ? "-" : fmtAmt(actual)}
              </td>
{compareMode && <>
<td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[120px] ${isBold ? "font-bold text-[#CF305D]" : "text-[#CF305D]"}`} style={{ borderLeft: "2px solid #e2e8f0" }}>
                  {cmpVal === 0 ? "-" : fmtAmt(cmpVal)}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[90px] ${devColor(devB)}`}>
                  {devB === 0 ? "-" : fmtAmt(devB)}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[70px] font-bold ${devColor(devB)}`}>
                  {devBPct === null ? "—" : `${devBPct >= 0 ? "+" : ""}${devBPct.toFixed(1)}%`}
                </td>
                {cmp2Enabled && <>
<td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[120px] ${isBold ? "font-bold text-[#57aa78]" : "text-[#57aa78]"}`} style={{ borderLeft: "2px solid #e2e8f0" }}>
                    {cmp2Val === 0 ? "-" : fmtAmt(cmp2Val)}
                  </td>
                  <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[90px] ${devColor(devC)}`}>
                    {devC === 0 ? "-" : fmtAmt(devC)}
                  </td>
                  <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[70px] font-bold ${devColor(devC)}`}>
                    {devCPct === null ? "—" : `${devCPct >= 0 ? "+" : ""}${devCPct.toFixed(1)}%`}
                  </td>
                </>}
              </>}
            </React.Fragment>
          );
        })}
      </tr>
    );

if (expanded && hasMore) {
const drillRows = renderBSDrill(node, drillKey, depth);
      if (drillRows?.length) {
        rows.push(...drillRows.map((row, i) => row));
      }
    }
  }
  filteredRoots.forEach(node => renderNode(node));

  
  return rows;
}

function renderBSRows(nodes) {
  const rows = [];

 // PGC mapping path: jerárquico (padre → hijos del flat list)
  if (pgcBsMapping?.rows) {
const flatNodes = bsView === "summary" ? bsPgcSummaryNodes : bsPgcAllSumNodes;
    if (!flatNodes) return rows;

    const isPGC_BS = (code) => {
      const m = pgcBsMapping.rows.get(String(code));
      return m && (m.section === "PASIVO" || m.section === "PATRIMONIO");
    };

    const flatByCode = new Map(flatNodes.map(n => [String(n.code), n]));
    const gaByCode = new Map(groupAccounts.map(g => [String(g.accountCode ?? g.AccountCode ?? ""), g]));
    const childrenInFlat = new Map();
    const rootsInFlat = [];

    flatNodes.forEach(n => {
      let parentInFlat = null;
      const ga = gaByCode.get(String(n.code));
      let curParent = ga ? String(ga.sumAccountCode ?? ga.SumAccountCode ?? "") : "";
      const seen = new Set([String(n.code)]);
      while (curParent && !seen.has(curParent)) {
        seen.add(curParent);
        if (flatByCode.has(curParent)) { parentInFlat = curParent; break; }
        const pa = gaByCode.get(curParent);
        curParent = pa ? String(pa.sumAccountCode ?? pa.SumAccountCode ?? "") : "";
      }
      if (parentInFlat) {
        if (!childrenInFlat.has(parentInFlat)) childrenInFlat.set(parentInFlat, []);
        childrenInFlat.get(parentInFlat).push(n);
      } else {
        rootsInFlat.push(n);
      }
    });

    const sortBySO = (a, b) => {
      const sa = pgcBsMapping.rows.get(String(a.code))?.sortOrder ?? 0;
      const sb = pgcBsMapping.rows.get(String(b.code))?.sortOrder ?? 0;
      return sa - sb;
    };
    childrenInFlat.forEach(arr => arr.sort(sortBySO));
    rootsInFlat.sort(sortBySO);

    const renderFlatNode = (node, depth) => {
      const total = isPGC_BS(node.code) ? -sumNode(node) : sumNode(node);
      const isBold = isBSHighlighted(node);
      const drillKey = `bsrow-${node.code}`;
      const flatChildren = childrenInFlat.get(String(node.code)) || [];
      const treeChildren = (node.children || []).filter(hasData);
      const hasNonFlatChildren = treeChildren.some(c => !flatByCode.has(String(c.code)));
      const hasLeaves = (node.uploadLeaves || []).some(l => l.type !== "plain");
      const hasJournal = (journalByCode.get(node.code) || []).length > 0;
      const hasMore = flatChildren.length > 0 || hasNonFlatChildren || hasLeaves || hasJournal;
      const expanded = !!bsDrillMap[drillKey];

const divider = effectiveBreakersBs[String(node.code)];
      if (divider) {
rows.push(
<tr key={`bsdivider-${node.code}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}>
<td colSpan={4 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (historyExpanded ? bsHistoryProcessed.length : 0)} style={{ backgroundColor: divider.color }} className="px-6 py-1.5">
             <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
            </td>
          </tr>
        );
      }

const rowStyle = depth === 0 ? body1Style : body2Style;
rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 bg-white ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}
    onClick={hasMore ? () => bsDrill(drillKey) : undefined}>
<td className="py-2.5 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 18}px` }}>
      <div className="flex items-center">
        {hasMore
          ? <span className="text-[#1a2f8a]/50 mr-2">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
          : <span className="inline-block mr-2" style={{ width: 12 }} />}
        <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>
        <span style={rowStyle}>
          {(() => { const n = localName(node); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); })()}
        </span>
      </div>
    </td>
<BSAmountCell value={total} typoStyle={rowStyle} />
    {historyExpanded && !compareMode && bsHistoryProcessed.map(h => (
      <BSAmountCell key={`bshist-${h.year}-${h.month}-${node.code}`} value={getBSHistVal(h, node.code)} typoStyle={rowStyle} />
    ))}
  </tr>
);

if (expanded) {
  flatChildren.forEach(child => renderFlatNode(child, depth + 1));
  if (hasNonFlatChildren || hasLeaves || hasJournal) {
    const drillRows = renderBSDrill(node, drillKey, depth);
    if (drillRows?.length) rows.push(...drillRows);
  }
}
    };

    rootsInFlat.forEach(n => renderFlatNode(n, 0));
    return rows;
  }

  // ⬇⬇⬇ HARD GUARD: if PGC is active, we never reach the legacy renderer.
  if (pgcBsMapping) return rows;

  // Fallback: original recursive rendering for non-PGC structures
  nodes.filter(hasData).forEach(node => {
    const total = Number(node.code) >= 599999 ? -sumNode(node) : sumNode(node);
    const isBold = isBSHighlighted(node);
    const kids = (node.children || []).filter(hasData).filter(c => c.level <= 4);
    const drillKey = `bsrow-${node.code}`;
    const hasMore = kids.length > 0 || node.uploadLeaves?.filter(l => l.type !== "plain").length > 0;
    const expanded = !!bsDrillMap[drillKey];
console.log("renderBSRows node:", node.code, "drillKey:", drillKey, "expanded:", expanded, "bsDrillMap keys:", Object.keys(bsDrillMap));
const BS_DIVIDERS = Object.keys(breakers.bs).length
  ? effectiveBreakersBs
  : { '399999': { label: "Activo", color: colors.primary }, '499999': { label: "Patrimonio Neto", color: colors.secondary }, '699999': { label: "Pasivo", color: colors.tertiary }, 'C.ACT': { label: "Activo", color: colors.primary }, 'D.S': { label: "Patrimonio Neto", color: colors.secondary }, 'E.S': { label: "Pasivo", color: colors.tertiary } };
    const bsDivider = BS_DIVIDERS[String(node.code)];
if (divider) {
          rows.push(
            <tr key={`bsdivider-${node.code}`}>
              <td colSpan={cmp2Enabled ? 9 : 6} style={{ backgroundColor: divider.color }} className="px-6 py-1.5">
               <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
              </td>
            </tr>
          );
        }

    if (kids.length > 0) rows.push(...renderBSRows(kids));

rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 bg-white ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}
    onClick={hasMore ? () => bsDrill(drillKey) : undefined}>
<td className="px-6 py-2.5 whitespace-nowrap">
      <div className="flex items-center">
        {hasMore && (
          <span className="text-[#1a2f8a]/50 mr-2">
            {expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
          </span>
        )}
        <span style={body1Style}>
          {(node.name ?? "").charAt(0).toUpperCase() + (node.name ?? "").slice(1).toLowerCase()}
        </span>
      </div>
    </td>
    <BSAmountCell value={total} typoStyle={body1Style} />
  </tr>
);

if (expanded && hasMore) {
    const drillRows = renderBSDrill(node, drillKey);
      if (drillRows?.length) {
        rows.push(...drillRows);
      }
    }
  });
  return rows;
}

const fetchBSCompare = useCallback(async (year, month, source, structure, company, setter, loadSetter) => {
  if (!year || !month || !source || !structure || !company) return;
  loadSetter(true);
  try {
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const res = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }  // <-- token viene de props
    );
    const json = res.ok ? await res.json() : { value: [] };
    setter(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setter([]); }
  finally { loadSetter(false); }
}, [token]);  // <-- token en deps

useEffect(() => {
    if (compareMode && cmpSource && cmpStructure && cmpYear && cmpMonth && cmpCompany) {
      fetchBSCompare(cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, setCmpData, setCmpLoading);
    }
  }, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, fetchBSCompare]);

  useEffect(() => {
    if (compareMode && cmp2Source && cmp2Structure && cmp2Year && cmp2Month && cmp2Company) {
      fetchBSCompare(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, setCmp2Data, setCmp2Loading);
    }
  }, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, fetchBSCompare]);

  useEffect(() => {
    onCompareChange?.(
      compareMode,
      { year: cmpYear, month: cmpMonth, source: cmpSource, structure: cmpStructure, company: cmpCompany },
      cmpData,
      { year: cmp2Year, month: cmp2Month, source: cmp2Source, structure: cmp2Structure, company: cmp2Company },
      cmp2Data,
    );
  }, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, cmpData, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, cmp2Data]);

const tree = useMemo(() => buildTree(groupAccounts, uploadedAccounts, !dimensionActive), [groupAccounts, uploadedAccounts, dimensionActive]);
const rawSumByCode = useMemo(() => {
  const idx = new Map();
  (uploadedAccounts || []).forEach(row => {
    const code = String(getField(row, "accountCode") ?? "");
    if (!code) return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(code, (idx.get(code) ?? 0) + amt);
  });
  return idx;
}, [uploadedAccounts]);

const sumNodeFixed = useCallback((node) => {
  if (!node) return 0;
  let total = rawSumByCode.get(String(node.code)) ?? 0;
  (node.children || []).forEach(c => { total += sumNodeFixed(c); });
  return total;
}, [rawSumByCode]);
  const cmpTree = useMemo(() => compareMode ? buildTree(groupAccounts, cmpData, !dimensionActive) : [], [groupAccounts, cmpData, compareMode, dimensionActive]);
  const cmp2Tree = useMemo(() => compareMode ? buildTree(groupAccounts, cmp2Data, !dimensionActive) : [], [groupAccounts, cmp2Data, compareMode, dimensionActive]);

  // ADD THESE TWO:
const allCmpTree = useMemo(
  () => compareMode && allCompaniesCmpData.length
    ? buildTree(groupAccounts, allCompaniesCmpData, !dimensionActive)
    : [],
  [groupAccounts, allCompaniesCmpData, compareMode, dimensionActive]
);
const allCmp2Tree = useMemo(
  () => compareMode && allCompaniesCmp2Data.length
    ? buildTree(groupAccounts, allCompaniesCmp2Data, !dimensionActive)
    : [],
  [groupAccounts, allCompaniesCmp2Data, compareMode, dimensionActive]
);

const bsRoots = useMemo(() => tree.filter(n => hasData(n) && n.accountType === "B/S")
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })), [tree]);

const bsHistoryProcessed = useMemo(() => {
  return historyMonths.map(h => {
    const t = buildTree(groupAccounts, h.data, !dimensionActive);
    const map = new Map();
    const walk = (n) => { map.set(n.code, n); n.children?.forEach(walk); };
    t.forEach(walk);
    const leafIdx = new Map();
    h.data.forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      leafIdx.set(lac, (leafIdx.get(lac) ?? 0) + amt);
    });
    return { year: h.year, month: h.month, map, leafIdx };
  });
}, [historyMonths, groupAccounts, dimensionActive]);

const getBSHistVal = useCallback((h, code) => {
  const n = h.map.get(code);
  const raw = n ? sumNode(n) : 0;
  return Number(code) >= 599999 ? -raw : raw;
}, []);

// PGC mapping: ordered list of nodes — filtered by active tab (summary/assets/equity)
  const sectionFilterForView = useCallback((info) => {
    if (bsView === "assets") return info.section === "ACTIVO";
    if (bsView === "equity") return info.section === "PATRIMONIO" || info.section === "PASIVO";
    return true; // summary tab: no section filter (uses showInSummary instead)
  }, [bsView]);

  const bsPgcSummaryNodes = useMemo(() => {
    if (!pgcBsMapping?.rows) return null;
    const treeByCode = new Map();
    (function index(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); index(n.children || []); });
    })(tree);
    return [...pgcBsMapping.rows.entries()]
      .filter(([, info]) => info.showInSummary && sectionFilterForView(info))
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => treeByCode.get(code))
      .filter(n => n && hasData(n) && n.accountType === "B/S");
  }, [tree, pgcBsMapping, sectionFilterForView]);

  const bsPgcAllSumNodes = useMemo(() => {
    if (!pgcBsMapping?.rows) return null;
    const treeByCode = new Map();
    (function index(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); index(n.children || []); });
    })(tree);
    return [...pgcBsMapping.rows.entries()]
      .filter(([, info]) => info.isSum && sectionFilterForView(info))
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => treeByCode.get(code))
      .filter(n => n && hasData(n) && n.accountType === "B/S");
  }, [tree, pgcBsMapping, sectionFilterForView]);

// Derive the 3 BS breakers in render order (parents-first, matching renderFlatNode)
const effectiveBreakersBs = useMemo(() => {
  const palette = [colors.primary, colors.secondary, colors.tertiary];

  if (!pgcBsMapping?.rows || !pgcBsMapping?.sections) {
    // Legacy Supabase path — recolor by position
    const legacy = breakers.bs ?? {};
    const codes = Object.keys(legacy).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    );
    const out = {};
    codes.forEach((code, i) => {
      out[code] = { ...legacy[code], color: palette[i] ?? legacy[code].color };
    });
    return out;
  }

  const rowsToScan = (bsView === "summary" ? bsPgcSummaryNodes : bsPgcAllSumNodes) || [];
  if (!rowsToScan.length) return {};

  const flatByCode = new Map(rowsToScan.map(n => [String(n.code), n]));
  const gaByCode = new Map(groupAccounts.map(g => [String(g.accountCode ?? g.AccountCode ?? ""), g]));
  const childrenInFlat = new Map();
  const rootsInFlat = [];

  rowsToScan.forEach(n => {
    let parentInFlat = null;
    const ga = gaByCode.get(String(n.code));
    let curParent = ga ? String(ga.sumAccountCode ?? ga.SumAccountCode ?? "") : "";
    const seen = new Set([String(n.code)]);
    while (curParent && !seen.has(curParent)) {
      seen.add(curParent);
      if (flatByCode.has(curParent)) { parentInFlat = curParent; break; }
      const pa = gaByCode.get(curParent);
      curParent = pa ? String(pa.sumAccountCode ?? pa.SumAccountCode ?? "") : "";
    }
    if (parentInFlat) {
      if (!childrenInFlat.has(parentInFlat)) childrenInFlat.set(parentInFlat, []);
      childrenInFlat.get(parentInFlat).push(n);
    } else {
      rootsInFlat.push(n);
    }
  });

  const sortBySO = (a, b) => {
    const sa = pgcBsMapping.rows.get(String(a.code))?.sortOrder ?? 0;
    const sb = pgcBsMapping.rows.get(String(b.code))?.sortOrder ?? 0;
    return sa - sb;
  };
  childrenInFlat.forEach(arr => arr.sort(sortBySO));
  rootsInFlat.sort(sortBySO);

  const renderOrder = [];
  const walk = (node) => {
    renderOrder.push(node);
    const kids = childrenInFlat.get(String(node.code)) || [];
    kids.forEach(walk);
  };
  rootsInFlat.forEach(walk);

  const seenSec = new Set();
  const out = {};
  let i = 0;
  for (const node of renderOrder) {
    const m = pgcBsMapping.rows.get(String(node.code));
    if (!m) continue;
    if (seenSec.has(m.section)) continue;
    seenSec.add(m.section);
    const sec = pgcBsMapping.sections.get(m.section);
    if (sec) {
      out[String(node.code)] = { label: sec.label, color: palette[i] ?? sec.color };
      i++;
    }
  }
  return out;
}, [pgcBsMapping, breakers, bsView, bsPgcSummaryNodes, bsPgcAllSumNodes, groupAccounts, colors]);

  const monthLabel = MONTHS.find(m => String(m.value) === String(month))?.label ?? month;

  const getNodeValue = (tree, code) => {
    const find = (nodes) => {
      for (const n of nodes) {
        if (n.code === code) return n;
        const found = find(n.children || []);
        if (found) return found;
      }
      return null;
    };
    const node = find(tree);
    return node ? sumNode(node) : 0;
  };

function renderBSCompareRows(nodes, cmpTree, cmp2Tree) {
    const rows = [];

  // PGC mapping path: jerárquico
    if (pgcBsMapping?.rows) {
      const flatNodes = bsView === "summary" ? bsPgcSummaryNodes : bsPgcAllSumNodes;
      if (!flatNodes) return rows;

      const isPGC_BS = (code) => {
        const m = pgcBsMapping.rows.get(String(code));
        return m && (m.section === "PASIVO" || m.section === "PATRIMONIO");
      };

      const flatByCode = new Map(flatNodes.map(n => [String(n.code), n]));
      const gaByCode = new Map(groupAccounts.map(g => [String(g.accountCode ?? g.AccountCode ?? ""), g]));
      const childrenInFlat = new Map();
      const rootsInFlat = [];

      flatNodes.forEach(n => {
        let parentInFlat = null;
        const ga = gaByCode.get(String(n.code));
        let curParent = ga ? String(ga.sumAccountCode ?? ga.SumAccountCode ?? "") : "";
        const seen = new Set([String(n.code)]);
        while (curParent && !seen.has(curParent)) {
          seen.add(curParent);
          if (flatByCode.has(curParent)) { parentInFlat = curParent; break; }
          const pa = gaByCode.get(curParent);
          curParent = pa ? String(pa.sumAccountCode ?? pa.SumAccountCode ?? "") : "";
        }
        if (parentInFlat) {
          if (!childrenInFlat.has(parentInFlat)) childrenInFlat.set(parentInFlat, []);
          childrenInFlat.get(parentInFlat).push(n);
        } else {
          rootsInFlat.push(n);
        }
      });

      const sortBySO = (a, b) => {
        const sa = pgcBsMapping.rows.get(String(a.code))?.sortOrder ?? 0;
        const sb = pgcBsMapping.rows.get(String(b.code))?.sortOrder ?? 0;
        return sa - sb;
      };
      childrenInFlat.forEach(arr => arr.sort(sortBySO));
      rootsInFlat.sort(sortBySO);

      const devColor = (v) => v === 0 ? "text-gray-300" : v > 0 ? "text-emerald-600" : "text-red-500";

      const renderFlatNodeCmp = (node, depth) => {
        const isBold = isBSHighlighted(node);
        const actual = isPGC_BS(node.code) ? -sumNode(node) : sumNode(node);
        const cmpRaw = getNodeValue(cmpTree, node.code);
        const cmp = isPGC_BS(node.code) ? -cmpRaw : cmpRaw;
        const cmp2Raw = getNodeValue(cmp2Tree, node.code);
        const cmp2 = isPGC_BS(node.code) ? -cmp2Raw : cmp2Raw;
        const devB = actual - cmp;
        const devBPct = cmp !== 0 ? (devB / Math.abs(cmp)) * 100 : null;
        const devC = actual - cmp2;
        const devCPct = cmp2 !== 0 ? (devC / Math.abs(cmp2)) * 100 : null;

 const drillKeyCmp = `bsrow-${node.code}`;
        const flatChildrenCmp = childrenInFlat.get(String(node.code)) || [];
        const treeChildrenCmp = (node.children || []).filter(hasData);
        const hasNonFlatCmp = treeChildrenCmp.some(c => !flatByCode.has(String(c.code)));
        const hasLeavesCmp = (node.uploadLeaves || []).some(l => l.type !== "plain");
        const hasJournalCmp = (journalByCode.get(node.code) || []).length > 0;
        const hasMoreCmp = flatChildrenCmp.length > 0 || hasNonFlatCmp || hasLeavesCmp || hasJournalCmp;
        const expandedCmp = !!bsDrillMap[drillKeyCmp];
        const rowStyle = depth === 0 ? body1Style : body2Style;
        const divider = effectiveBreakersBs[String(node.code)];
if (divider) {
          rows.push(
            <tr key={`bsdivider-${node.code}`}>
              <td colSpan={3 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (historyExpanded ? bsHistoryProcessed.length : 0)} style={{ backgroundColor: divider.color }} className="px-6 py-1.5">
               <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
              </td>
            </tr>
          );
        }

const rowStyleCmp = depth === 0 ? body1Style : body2Style;
rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 bg-white ${hasMoreCmp ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    onClick={hasMoreCmp ? () => bsDrill(drillKeyCmp) : undefined}>
<td className="py-2.5 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 18}px` }}>
      <div className="flex items-center">
        {hasMoreCmp
          ? <span className="text-[#1a2f8a]/50 mr-2">{expandedCmp ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
          : <span className="inline-block mr-2" style={{ width: 12 }} />}
        <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>
        <span style={rowStyleCmp}>
          {(node.name ?? "").charAt(0).toUpperCase() + (node.name ?? "").slice(1).toLowerCase()}
        </span>
      </div>
    </td>
    <BSAmountCell value={actual} typoStyle={rowStyleCmp} />
    <BSAmountCell value={cmp} typoStyle={rowStyleCmp} divider />
    <BSDeviationCells a={actual} b={cmp} typoStyle={rowStyleCmp} />
    {cmp2Enabled && <BSAmountCell value={cmp2} typoStyle={rowStyleCmp} divider />}
    {cmp2Enabled && <BSDeviationCells a={actual} b={cmp2} typoStyle={rowStyleCmp} />}
  </tr>
);

if (expandedCmp) {
  flatChildrenCmp.forEach(child => renderFlatNodeCmp(child, depth + 1));
  if (hasNonFlatCmp || hasLeavesCmp || hasJournalCmp) {
    const drillRows = renderBSDrill(node, drillKeyCmp, depth);
    if (drillRows?.length) rows.push(...drillRows);
  }
}
      };

      rootsInFlat.forEach(n => renderFlatNodeCmp(n, 0));
      return rows;
    }

    // ⬇⬇⬇ HARD GUARD
    if (pgcBsMapping) return rows;

    // Fallback: original recursive rendering
    nodes.filter(hasData).forEach(node => {
      const isBold = isBSHighlighted(node);
      const kids = (node.children || []).filter(hasData).filter(c => c.level <= 4);

const BS_DIVIDERS = Object.keys(breakers.bs).length
  ? effectiveBreakersBs
  : { '399999': { label: "Activo", color: colors.primary }, '499999': { label: "Patrimonio Neto", color: colors.secondary }, '699999': { label: "Pasivo", color: colors.tertiary }, 'C.ACT': { label: "Activo", color: colors.primary }, 'D.S': { label: "Patrimonio Neto", color: colors.secondary }, 'E.S': { label: "Pasivo", color: colors.tertiary } };
      const bsDivider = BS_DIVIDERS[String(node.code)];
if (bsDivider) {
        rows.push(
          <tr key={`bsdivider-${node.code}`}>
            <td colSpan={cmp2Enabled ? 9 : 6} style={{ backgroundColor: bsDivider.color }} className="px-6 py-1.5">
              <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
            </td>
          </tr>
        );
      }

      if (kids.length > 0) rows.push(...renderBSCompareRows(kids, cmpTree, cmp2Tree));

      const actual = Number(node.code) >= 599999 ? -sumNode(node) : sumNode(node);
      const cmpRaw = getNodeValue(cmpTree, node.code);
      const cmp = Number(node.code) >= 599999 ? -cmpRaw : cmpRaw;
      const cmp2Raw = getNodeValue(cmp2Tree, node.code);
      const cmp2 = Number(node.code) >= 599999 ? -cmp2Raw : cmp2Raw;

      const devB = actual - cmp;
      const devBPct = cmp !== 0 ? (devB / Math.abs(cmp)) * 100 : null;
      const devC = actual - cmp2;
      const devCPct = cmp2 !== 0 ? (devC / Math.abs(cmp2)) * 100 : null;
      const devColor = (v) => v === 0 ? "text-gray-300" : v > 0 ? "text-emerald-600" : "text-red-500";

  const drillKeyCmp = `bsrow-${node.code}`;
      const hasMoreCmp = node.uploadLeaves?.filter(l => l.type !== "plain").length > 0;
      const expandedCmp = !!bsDrillMap[drillKeyCmp];

rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 bg-white ${hasMoreCmp ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    onClick={hasMoreCmp ? () => bsDrill(drillKeyCmp) : undefined}>
<td className="px-6 py-2.5 whitespace-nowrap">
      <div className="flex items-center">
        {hasMoreCmp
          ? <span className="text-[#1a2f8a]/50 mr-2">{expandedCmp ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
          : <span className="inline-block mr-2" style={{ width: 12 }} />}
        <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>
        <span style={body1Style}>
          {(node.name ?? "").charAt(0).toUpperCase() + (node.name ?? "").slice(1).toLowerCase()}
        </span>
      </div>
    </td>
    <BSAmountCell value={actual} typoStyle={body1Style} />
    <BSAmountCell value={cmp} typoStyle={body1Style} divider />
    <BSDeviationCells a={actual} b={cmp} typoStyle={body1Style} />
    {cmp2Enabled && <BSAmountCell value={cmp2} typoStyle={body1Style} divider />}
    {cmp2Enabled && <BSDeviationCells a={actual} b={cmp2} typoStyle={body1Style} />}
  </tr>
);

if (expandedCmp && hasMoreCmp) {
  const drillRows = renderBSDrill(node, drillKeyCmp);
        if (drillRows?.length) {
          rows.push(...drillRows);
        }
      }
    });
    return rows;
  }

// ────────────────────────────────────────────────────────────
  //  SAVED-MAPPING LITERAL RENDER PATH (Balance Sheet)
  // ────────────────────────────────────────────────────────────
  if (savedBsLiteral && !loading) {
    const dimIdx = new Map();
    const accIdx = new Map();
    (uploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      accIdx.set(code, (accIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const n = pair.slice(i + 1).trim();
        dimIdx.set(`${code}|${g}:${n}`, (dimIdx.get(`${code}|${g}:${n}`) ?? 0) + amt);
      });
    });

const sumLiteral = (node) => {
      let total = 0;
      if (node.dims && node.dims.length > 0) {
        node.dims.forEach(d => { total += dimIdx.get(`${node.code}|${d}`) ?? 0; });
      } else {
        total = accIdx.get(node.code) ?? 0;
      }
      return total;
    };

    // ── Compare period indexes for BS ───────────────────────────────
    const cmpAccIdxBs = new Map();
    const cmpDimIdxBs = new Map();
    (cmpData || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmpAccIdxBs.set(code, (cmpAccIdxBs.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmpDimIdxBs.set(`${code}|${g}:${v}`, (cmpDimIdxBs.get(`${code}|${g}:${v}`) ?? 0) + amt);
      });
    });
    const cmp2AccIdxBs = new Map();
    const cmp2DimIdxBs = new Map();
    (cmp2Data || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmp2AccIdxBs.set(code, (cmp2AccIdxBs.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmp2DimIdxBs.set(`${code}|${g}:${v}`, (cmp2DimIdxBs.get(`${code}|${g}:${v}`) ?? 0) + amt);
      });
    });
    const sumLiteralBSGeneric = (node, accIdxLoc, dimIdxLoc) => {
      let total = 0;
      if (node.dims && node.dims.length > 0) {
        node.dims.forEach(d => { total += dimIdxLoc.get(`${node.code}|${d}`) ?? 0; });
      } else {
        total = accIdxLoc.get(node.code) ?? 0;
      }
      return total;
    };
    const sumLiteralB = (node) => sumLiteralBSGeneric(node, cmpAccIdxBs, cmpDimIdxBs);
    const sumLiteralC = (node) => sumLiteralBSGeneric(node, cmp2AccIdxBs, cmp2DimIdxBs);

const bsCmpLabel = [cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource, cmpStructure].filter(Boolean).join(" · ") || "Period B";
    const bsCmp2Label = [cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source, cmp2Structure].filter(Boolean).join(" · ") || "Period C";

    return (
      <div className="space-y-3 flex flex-col" style={{ minHeight: 0, flex: 1, overflow: "visible" }}>
        {compareMode && filtersOpen && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
            style={{ overflow: "visible", position: "relative", zIndex: 100, marginBottom: 12, flex: "0 0 auto" }}>
            <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
                  <span className="text-white text-[11px] font-black">B</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Period B</span>
              </div>
              <HeaderFilterPill label="Year" value={cmpYear} onChange={setCmpYear}
                options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
              <HeaderFilterPill label="Month" value={cmpMonth} onChange={setCmpMonth}
                options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
              <HeaderFilterPill label="Source" value={cmpSource} onChange={setCmpSource}
                options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
              <HeaderFilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure}
                options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
              <HeaderFilterPill label="Company" value={cmpCompany} onChange={setCmpCompany}
                options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
              {!cmp2Enabled && (
                <button onClick={() => setCmp2Enabled(true)}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
                  style={{ background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)", boxShadow: "0 4px 14px -4px rgba(87,170,120,0.5)" }}>
                  <span className="text-white text-[10px] font-black">+ Add Period C</span>
                </button>
              )}
            </div>
            {cmp2Enabled && (
              <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100"
                style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.06s both" }}>
                <div className="flex items-center gap-2 mr-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)", boxShadow: "0 4px 12px -4px rgba(87,170,120,0.5)" }}>
                    <span className="text-white text-[11px] font-black">C</span>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>Period C</span>
                </div>
                <HeaderFilterPill label="Year" value={cmp2Year} onChange={setCmp2Year}
                  options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
                <HeaderFilterPill label="Month" value={cmp2Month} onChange={setCmp2Month}
                  options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
                <HeaderFilterPill label="Source" value={cmp2Source} onChange={setCmp2Source}
                  options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
                <HeaderFilterPill label="Structure" value={cmp2Structure} onChange={setCmp2Structure}
                  options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
                <HeaderFilterPill label="Company" value={cmp2Company} onChange={setCmp2Company}
                  options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
                <button onClick={() => setCmp2Enabled(false)}
                  className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all duration-200 hover:scale-[1.05]"
                  style={{ background: "#fee2e2", color: "#dc2626" }}
                  title="Remove Period C">
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        )}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
          style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}>
          <div className="scrollbar-hide" style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0 }}>
<table className="w-full">
<colgroup>
                <col style={{ width: "1px" }} />
                <col style={{ width: "1px" }} />
                {compareMode && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
                {compareMode && cmp2Enabled && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
                {historyExpanded && bsHistoryProcessed.map(h => (
                  <col key={`bshist-col-${h.year}-${h.month}`} style={{ width: "1px" }} />
                ))}
                <col />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100" style={{
                  background: "rgba(255,255,255,0.95)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <th className="text-left px-6 whitespace-nowrap" style={{ height: "64px", background: "transparent" }}>
                    <div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>
                        {t("col_account")}
                      </span>
                      <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
                        {t("page_bs_full")}
                      </span>
                    </div>
                  </th>
                  <th className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px", cursor: compareMode ? "default" : "pointer" }}
                    onClick={compareMode ? undefined : toggleBSHistory}
                    title={compareMode ? "" : historyExpanded ? "Hide history" : "Show last 6 months"}>
                    <span className="font-black tracking-tight inline-block"
                      style={{ color: colors.primary, fontSize: 16, letterSpacing: "-0.02em", animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
                      {t("col_actual")}
                    </span>
                  </th>
{compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Period B</span>
                      </div>
                      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{bsCmpLabel}</span>
                    </div>
                  </th>}
                  {compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>Period C</span>
                      </div>
<span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{bsCmp2Label}</span>
                    </div>
                  </th>}
                  {historyExpanded && bsHistoryProcessed.map(h => (
                    <th key={`bshist-saved-${h.year}-${h.month}`} className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
                      <div className="flex flex-col items-end">
                        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>
                          {MONTHS.find(m => m.value === h.month)?.label.slice(0,3)}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: "#9ca3af" }}>{h.year}</span>
                      </div>
                    </th>
                  ))}
<th className="text-right pr-6 py-3" style={{ background: "transparent" }}>
                    <div className="flex items-center justify-end gap-2" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
                      {compareMode && (
                        <button onClick={() => setFiltersOpen(o => !o)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
                          style={{ background: filtersOpen ? `${colors.primary}12` : "transparent", color: filtersOpen ? colors.primary : "#9ca3af" }}>
                          <ChevronDown size={10} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
                          <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? "Hide" : "Show"}</span>
                        </button>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
              {savedBsLiteral.map((section, secIdx) => {
                const rows = [];
if (section.label) {
                  rows.push(
                    <tr key={`bssec-${secIdx}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}>
                 <td colSpan={3 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (historyExpanded ? bsHistoryProcessed.length : 0)} style={{ backgroundColor: section.color }} className="px-6 py-1.5">
                        <span className="uppercase tracking-widest" style={header3Style}>{section.label}</span>
                      </td>
                    </tr>
                  );
                }
                const renderNode = (node, depth) => {
                  const val = sumLiteral(node);
                  let displayVal = val;
                  if (node.isSum && node.children && node.children.length > 0) {
                    displayVal = node.children.reduce((s, c) => s + sumLiteral(c), val);
                  }
                  const rowStyle = depth === 0 ? body1Style : body2Style;
                  rows.push(
                    <tr key={node.id}
                      className="border-b border-gray-100 bg-white hover:bg-[#eef1fb]/60 transition-colors"
                      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}>
                      <td className="py-2.5 whitespace-nowrap" style={{ paddingLeft: `${24 + depth * 18}px` }}>
                        <div className="flex items-center">
                          <span className="inline-block mr-2" style={{ width: 12 }} />
                          {node.code && <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>}
                          <span style={rowStyle}>
                            {node.name ? (node.name.charAt(0).toUpperCase() + node.name.slice(1).toLowerCase()) : node.code}
                          </span>
                        </div>
                      </td>
<BSAmountCell value={displayVal} typoStyle={rowStyle} />
                      {compareMode && (() => {
                        let cmpVal = sumLiteralB(node);
                        if (node.isSum && node.children && node.children.length > 0) {
                          cmpVal = node.children.reduce((s, c) => s + sumLiteralB(c), cmpVal);
                        }
                        return (
                          <>
                            <BSAmountCell value={cmpVal} typoStyle={rowStyle} divider />
                            <BSDeviationCells a={displayVal} b={cmpVal} typoStyle={rowStyle} />
                          </>
                        );
                      })()}
                      {compareMode && cmp2Enabled && (() => {
                        let cmp2Val = sumLiteralC(node);
                        if (node.isSum && node.children && node.children.length > 0) {
                          cmp2Val = node.children.reduce((s, c) => s + sumLiteralC(c), cmp2Val);
                        }
                        return (
                          <>
                            <BSAmountCell value={cmp2Val} typoStyle={rowStyle} divider />
                            <BSDeviationCells a={displayVal} b={cmp2Val} typoStyle={rowStyle} />
                          </>
                        );
                      })()}
{historyExpanded && bsHistoryProcessed.map(h => {
                        const histNode = h.map.get(String(node.code));
                        const histVal = histNode
                          ? (Number(node.code) >= 599999 ? -sumNode(histNode) : sumNode(histNode))
                          : 0;
                        return <BSAmountCell key={`bshist-saved-${h.year}-${h.month}-${node.id}`} value={histVal} typoStyle={rowStyle} />;
                      })}
                    </tr>
                  );
                  (node.children || []).forEach(c => renderNode(c, depth + 1));
                };
                section.nodes.forEach(n => renderNode(n, 0));
                return rows;
              })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

if (loading) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <Loader2 size={28} className="text-[#1a2f8a] animate-spin mx-auto mb-3" />
     <p className="text-gray-400 text-sm">{t("loading_bs_data")}</p>
    </div>
  );
  if (error) return <ErrorBox error={error} />;
  if (!uploadedAccounts.length || !groupAccounts.length) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
        <BarChart2 size={24} className="text-[#1a2f8a]" />
      </div>
      <p className="text-gray-400 text-sm font-semibold">Waiting for data…</p>
    </div>
  );

const cmpLabel = [cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource, cmpStructure].filter(Boolean).join(" · ") || t("period_b");
  const cmp2Label = [cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source, cmp2Structure].filter(Boolean).join(" · ") || t("period_c");

return (
    <div className="space-y-3 flex flex-col" style={{ minHeight: 0, flex: 1, overflow: "visible" }}>
      
{jrnPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setJrnPopup(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <BookOpen size={13} className="text-white/70" />
                </div>
                <div>
                  <p className="text-white font-black text-sm">{jrnPopup.JournalNumber ?? jrnPopup.journalNumber ?? "—"}</p>
                  <p className="text-white/50 text-[10px] font-medium">{jrnPopup.JournalHeader ?? jrnPopup.journalHeader ?? ""}</p>
                </div>
              </div>
              <button onClick={() => setJrnPopup(null)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                <X size={13} className="text-white/70" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {[
                ["Account", `${jrnPopup.AccountCode ?? jrnPopup.accountCode ?? ""} · ${jrnPopup.AccountName ?? jrnPopup.accountName ?? ""}`],
                ["Account Type", jrnPopup.AccountType ?? jrnPopup.accountType],
                ["Journal Type", jrnPopup.JournalType ?? jrnPopup.journalType],
                ["Journal Layer", jrnPopup.JournalLayer ?? jrnPopup.journalLayer],
                ["Row Text", jrnPopup.RowText ?? jrnPopup.rowText],
                ["Counterparty", jrnPopup.CounterpartyShortName ?? jrnPopup.counterpartyShortName],
                ["Dimension", jrnPopup.DimensionName ?? jrnPopup.dimensionName],
                ["Amount YTD", jrnPopup.AmountYTD ?? jrnPopup.amountYTD],
                ["Currency", jrnPopup.CurrencyCode ?? jrnPopup.currencyCode],
                ["Period", `${jrnPopup.Month ?? jrnPopup.month} / ${jrnPopup.Year ?? jrnPopup.year}`],
                ["Source", jrnPopup.Source ?? jrnPopup.source],
                ["Company", jrnPopup.CompanyShortName ?? jrnPopup.companyShortName],
                ["System Generated", (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === true ? "Yes" : (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === false ? "No" : "—"],
                ["Posted", (jrnPopup.Posted ?? jrnPopup.posted) === true ? "Yes" : (jrnPopup.Posted ?? jrnPopup.posted) === false ? "No" : "—"],
              ].filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—").map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex-shrink-0 mt-0.5">{label}</span>
                  <span className="text-xs text-gray-700 font-medium text-right">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {dimPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDimPopup(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-amber-500 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Network size={13} className="text-white/70" />
                </div>
                <div>
                  <p className="text-white font-black text-sm">{dimPopup.name || dimPopup.code || "—"}</p>
                  <p className="text-white/60 text-[10px] font-medium uppercase tracking-widest">Dimension</p>
                </div>
              </div>
              <button onClick={() => setDimPopup(null)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                <X size={13} className="text-white/70" />
              </button>
            </div>
            <div className="p-5 space-y-1">
              {[
                ["Code", dimPopup.code],
                ["Name", dimPopup.name],
                ["Amount YTD", dimPopup.amount != null ? fmtAmt(dimPopup.amount) : null],
                ["Company", dimPopup.company],
              ].filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—").map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex-shrink-0 mt-0.5">{label}</span>
                  <span className="text-xs text-gray-700 font-medium text-right">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
{/* Header (hidden) */}
      <div style={{ display: "none" }}>
        <div className="flex items-center gap-3">
{compareMode && (
            <button onClick={() => setFiltersOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all"
              style={{ background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}80` }}>
              <ChevronDown size={12} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
              {filtersOpen ? "Hide filters" : "Show filters"}
            </button>
          )}

<button onClick={() => {
  if (!compareMode) {
    setCmpYear(String(year)); setCmpMonth(String(month)); setCmpSource(source);
    setCmpStructure(structure); setCmpCompany(company);
    setCmp2Year(String(year)); setCmp2Month(String(month)); setCmp2Source(source);
    setCmp2Structure(structure); setCmp2Company(company);
    if (bsView !== "summary") {
      fetchAllCompaniesCmp(String(year), String(month), source, structure);
      fetchAllCompaniesCmp2(String(year), String(month), source, structure);
    }
  }
  setCompareMode(c => !c);
}}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all"
style={compareMode
        ? { backgroundColor: colors.quaternary ?? "#F59E0B", color: colors.primary ?? "#1a2f8a" }
              : { background: "transparent", color: `${(colors.quaternary ?? "#F59E0B")}80` }}>
            <GitMerge size={12} /> Compare
          </button>

<div className="relative flex items-center p-1 rounded-xl" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            ref={el => {
              if (!el) return;
              const btns = el.querySelectorAll("button");
const tabs = ["summary","assets","equity"];
              const idx = tabs.indexOf(bsView);
              const active = btns[idx >= 0 ? idx : 0];
              const pill = el.querySelector(".bs-pill");
              if (active && pill) {
                pill.style.left = active.offsetLeft + "px";
                pill.style.width = active.offsetWidth + "px";
              }
            }}>
            <span className="bs-pill" style={{
              position: "absolute",
              top: 4, bottom: 4,
              backgroundColor: colors.quaternary ?? "#F59E0B",
              borderRadius: 8,
              transition: "left 0.25s cubic-bezier(0.4,0,0.2,1), width 0.25s cubic-bezier(0.4,0,0.2,1)",
              pointerEvents: "none",
            }} />
{[["summary","Summary"],["assets","Assets"],["equity","Equity & Liab."]].map(([v, label]) => (
              <button key={v} onClick={() => setBsView(v)}
                className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
                style={{ color: bsView === v ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
                {label}
              </button>
            ))}
          </div>

        </div>
      </div>

{/* Compare filters */}
{compareMode && filtersOpen && (
  <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
    style={{ overflow: "visible", position: "relative", zIndex: 100, marginBottom: 12, flex: "0 0 auto" }}>
    {/* Period B row */}
    <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)",
            boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)",
          }}>
          <span className="text-white text-[11px] font-black">B</span>
        </div>
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Period B</span>
      </div>

<HeaderFilterPill label={t("filter_year")} value={cmpYear} onChange={setCmpYear}
        options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
      <HeaderFilterPill label={t("filter_month")} value={cmpMonth} onChange={setCmpMonth}
        options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
      <HeaderFilterPill label={t("filter_source")} value={cmpSource} onChange={setCmpSource}
        options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
      <HeaderFilterPill label={t("filter_structure")} value={cmpStructure} onChange={setCmpStructure}
        options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
<HeaderFilterPill label={t("filter_company")} value={cmpCompany} onChange={setCmpCompany}
        options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
      <HeaderMultiFilterPill label={t("filter_dim_group")} values={bsCmpDimGroups} onChange={vs => { setBsCmpDimGroups(vs); setBsCmpDimensions(null); }}
        options={dimGroups.map(g => ({ value: g, label: g }))} />
      <HeaderMultiFilterPill label={t("filter_dims")} values={bsCmpDimensions} onChange={vs => setBsCmpDimensions(vs)}
        options={bsCmpFilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
      {!cmp2Enabled && (
        <button onClick={() => setCmp2Enabled(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
          style={{
            background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)",
            boxShadow: "0 4px 14px -4px rgba(87,170,120,0.5)",
          }}>
          <span className="text-white text-[10px] font-black">+ Add Period C</span>
        </button>
      )}
    </div>

    {/* Period C row */}
    {cmp2Enabled && (
      <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100"
        style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.06s both" }}>
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)",
              boxShadow: "0 4px 12px -4px rgba(87,170,120,0.5)",
            }}>
            <span className="text-white text-[11px] font-black">C</span>
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>Period C</span>
        </div>

<HeaderFilterPill label={t("filter_year")} value={cmp2Year} onChange={setCmp2Year}
          options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
        <HeaderFilterPill label={t("filter_month")} value={cmp2Month} onChange={setCmp2Month}
          options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
        <HeaderFilterPill label={t("filter_source")} value={cmp2Source} onChange={setCmp2Source}
          options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
        <HeaderFilterPill label={t("filter_structure")} value={cmp2Structure} onChange={setCmp2Structure}
          options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
<HeaderFilterPill label={t("filter_company")} value={cmp2Company} onChange={setCmp2Company}
          options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
        <HeaderMultiFilterPill label={t("filter_dim_group")} values={bsCmp2DimGroups} onChange={vs => { setBsCmp2DimGroups(vs); setBsCmp2Dimensions(null); }}
          options={dimGroups.map(g => ({ value: g, label: g }))} />
        <HeaderMultiFilterPill label={t("filter_dims")} values={bsCmp2Dimensions} onChange={vs => setBsCmp2Dimensions(vs)}
          options={bsCmp2FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
        <button onClick={() => setCmp2Enabled(false)}
          className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all duration-200 hover:scale-[1.05]"
          style={{
            background: "#fee2e2",
            color: "#dc2626",
          }}
          title="Remove Period C">
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    )}
  </div>
)}

{/* Table */}


<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col" style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}>
<div className="scrollbar-hide" style={{ overflowX: "auto", overflowY: "auto", maxHeight: !compareMode ? "calc(86vh)" : filtersOpen ? cmp2Enabled ? "calc(72.5vh)" : "calc(79.5vh)" : "calc(85.5vh)" }}>
<table className="w-full">
<colgroup>
            <col style={{ width: "1px" }} />
            <col style={{ width: "1px" }} />
            {compareMode && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
            {compareMode && cmp2Enabled && <><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /><col style={{ width: "1px" }} /></>}
            <col />
          </colgroup>
<thead>
{(pgcBsMapping || bsView === "summary") ? (
<tr className="border-b border-gray-100" style={{
  position: "sticky", top: 0, zIndex: 10,
  background: "rgba(255,255,255,0.95)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
<th className="text-left px-6 whitespace-nowrap" style={{ height: "64px", background: "transparent" }}>
    <div className="flex items-center gap-3">
      <div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>
          {t("col_account")}
        </span>
        <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
          {t("page_bs_full")}
        </span>
      </div>
    </div>
  </th>
<th className="text-right pr-6 py-3 whitespace-nowrap"
  style={{ background: "transparent", width: "200px", cursor: compareMode ? "default" : "pointer" }}
  onClick={toggleBSHistory}
  title={compareMode ? "" : historyExpanded ? "Hide history" : "Show last 6 months"}>
    <span className="font-black tracking-tight inline-block"
      style={{ color: colors.primary, fontSize: 16, letterSpacing: "-0.02em", animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
      {t("col_actual")}
    </span>
  </th>
  {historyExpanded && bsHistoryProcessed.map(h => (
    <th key={`bshist-${h.year}-${h.month}`} className="text-right pr-6 py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
      <div className="flex flex-col items-end">
        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>
          {MONTHS.find(m => m.value === h.month)?.label.slice(0,3)}
        </span>
        <span className="text-[10px] font-bold" style={{ color: "#9ca3af" }}>{h.year}</span>
      </div>
    </th>
  ))}
  {historyExpanded && historyLoading && (
    <th className="text-center px-3 py-3" style={{ background: "transparent" }}>
      <Loader2 size={14} className="animate-spin" style={{ color: colors.primary }} />
    </th>
  )}
  {compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{[cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource].filter(Boolean).join(" · ")}</span>
    </div>
  </th>}
{compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap" style={{ background: "transparent" }}>
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{[cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source].filter(Boolean).join(" · ")}</span>
    </div>
  </th>}
<th className="text-right pr-6 py-3" style={{ background: "transparent" }}>
    <div className="flex items-center justify-end gap-2" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
      {compareMode && (
        <button onClick={() => setFiltersOpen(o => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
          style={{
            background: filtersOpen ? `${colors.primary}12` : "transparent",
            color: filtersOpen ? colors.primary : "#9ca3af",
          }}>
          <ChevronDown size={10} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
          <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
      )}
      <button onClick={() => {
        if (Object.values(bsDrillMap).some(Boolean)) { setBsDrillMap({}); return; }
        const next = {};
        const expandDrillChildren = (children, leaves, depth, contextKey) => {
          (children || []).filter(hasData).forEach(child => {
            const childKey = `bsdrill-${contextKey}-${child.code}`;
            next[childKey] = true;
            const grandkids = (child.children || []).filter(hasData);
            const grandLeaves = (child.uploadLeaves || []).filter(l => l.type !== "plain");
            expandDrillChildren(grandkids, grandLeaves, depth + 1, childKey);
          });
          (leaves || []).forEach((leaf, i) => {
            const leafKey = `bsdrill-leaf-${contextKey}-${depth}-${i}`;
            next[leafKey] = true;
          });
        };
        const expandTopLevel = (node) => {
          if (!hasData(node) || node.accountType !== "B/S") return;
          next[`bsrow-${node.code}`] = true;
          next[`bsmulti-${node.code}`] = true;
          const kids = (node.children || []).filter(hasData);
          const leaves = (node.uploadLeaves || []).filter(l => l.type !== "plain");
          expandDrillChildren(kids, leaves, 0, `bsrow-${node.code}`);
          expandDrillChildren(kids, leaves, 0, `bsmulti-${node.code}`);
        };
        const flatNodes = pgcBsMapping ? (bsView === "summary" ? bsPgcSummaryNodes : bsPgcAllSumNodes) : null;
        if (flatNodes && flatNodes.length > 0) flatNodes.forEach(expandTopLevel);
        else { const walkBS = (node) => { if (!hasData(node) || node.accountType !== "B/S") return; expandTopLevel(node); (node.children || []).forEach(walkBS); }; bsRoots.forEach(walkBS); }
        setBsDrillMap(next);
      }}
        className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-[1.05]"
        style={{ background: `${colors.primary}12`, color: colors.primary, width: 28, height: 28, overflow: "hidden" }}
        title={Object.values(bsDrillMap).some(Boolean) ? "Collapse all" : "Expand all"}>
        <span key={Object.values(bsDrillMap).some(Boolean) ? "collapse" : "expand"}
          className="inline-flex"
          style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
          {Object.values(bsDrillMap).some(Boolean)
            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </span>
      </button>
      <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}
        ref={el => {
          if (!el) return;
          const btns = el.querySelectorAll("[data-bs-pill]");
          const idx = ["summary","assets","equity"].indexOf(bsView);
          const active = btns[idx >= 0 ? idx : 0];
          const pill = el.querySelector(".bs-view-pill");
          if (active && pill) {
            pill.style.left = active.offsetLeft + "px";
            pill.style.width = active.offsetWidth + "px";
            pill.style.top = active.offsetTop + "px";
            pill.style.height = active.offsetHeight + "px";
          }
        }}>
        <span className="bs-view-pill" style={{
          position: "absolute", background: "#fff", borderRadius: 8,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          transition: "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), width 320ms cubic-bezier(0.34, 1.56, 0.64, 1), top 320ms cubic-bezier(0.34, 1.56, 0.64, 1), height 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          pointerEvents: "none", zIndex: 0,
        }} />
{[["summary","Summary","S"],["assets","Assets","A"],["equity","Equity & Liab.","EQ"]].map(([v, label, short]) => {
          const active = bsView === v;
          return (
            <button key={v} data-bs-pill onClick={() => setBsView(v)}
              className="relative z-10 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider overflow-hidden"
              style={{
                background: "transparent",
                color: active ? colors.primary : "#9ca3af",
                padding: "6px 8px",
                transition: "color 280ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}>
<span style={{
                display: "inline-block",
                overflow: "hidden",
                whiteSpace: "nowrap",
                maxWidth: historyExpanded ? 20 : 150,
                verticalAlign: "middle",
                transition: "max-width 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}>
                {historyExpanded ? short : label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  </th>
</tr>
) : (
  <>
<tr className="border-b border-gray-100" style={{
  background: "rgba(255,255,255,0.95)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
  <th className="text-left px-6" style={{ position: "sticky", top: 0, left: 0, zIndex: 20, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: "64px" }}>
    <div className="flex items-center gap-3">
      <div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>
          Account
        </span>
        <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
          Balance Sheet
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
        {compareMode && (
          <button onClick={() => setFiltersOpen(o => !o)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
            style={{
              background: filtersOpen ? `${colors.primary}12` : "transparent",
              color: filtersOpen ? colors.primary : "#9ca3af",
            }}>
            <ChevronDown size={10} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
            <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? "Hide" : "Show"}</span>
          </button>
        )}
        <button onClick={() => {
          if (Object.values(bsDrillMap).some(Boolean)) { setBsDrillMap({}); return; }
          const next = {};
          const walkBS = (node) => {
            if (!hasData(node) || node.accountType !== "B/S") return;
            next[`bsrow-${node.code}`] = true;
            next[`bsmulti-${node.code}`] = true;
            (node.children || []).forEach(walkBS);
          };
          bsRoots.forEach(walkBS);
          setBsDrillMap(next);
        }}
          className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-[1.05]"
          style={{ background: `${colors.primary}12`, color: colors.primary, width: 28, height: 28, overflow: "hidden" }}
          title={Object.values(bsDrillMap).some(Boolean) ? "Collapse all" : "Expand all"}>
          <span key={Object.values(bsDrillMap).some(Boolean) ? "collapse" : "expand"}
            className="inline-flex"
            style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            {Object.values(bsDrillMap).some(Boolean)
              ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </span>
        </button>
        <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6", alignItems: "center" }}
          ref={el => {
            if (!el) return;
            const btns = el.querySelectorAll("[data-bs-pill]");
            const idx = ["summary","assets","equity"].indexOf(bsView);
            const active = btns[idx >= 0 ? idx : 0];
            const pill = el.querySelector(".bs-view-pill");
            if (active && pill) {
              pill.style.left = active.offsetLeft + "px";
              pill.style.width = active.offsetWidth + "px";
              pill.style.top = active.offsetTop + "px";
              pill.style.height = active.offsetHeight + "px";
            }
          }}>
          <span className="bs-view-pill" style={{
            position: "absolute", background: "#fff", borderRadius: 8,
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            transition: "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), width 320ms cubic-bezier(0.34, 1.56, 0.64, 1), top 320ms cubic-bezier(0.34, 1.56, 0.64, 1), height 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            pointerEvents: "none", zIndex: 0,
          }} />
          {[["summary","Summary"],["assets","Assets"],["equity","Equity & Liab."]].map(([v, label]) => (
            <button key={v} data-bs-pill onClick={() => setBsView(v)}
              className="relative z-10 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider"
              style={{
                background: "transparent",
                color: bsView === v ? colors.primary : "#9ca3af",
                transition: "color 280ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  </th>
  {companyColumns.map(({ source, currency }) => (
    <React.Fragment key={source}>
      <th className="text-right pr-4 py-3 whitespace-nowrap min-w-[120px]" style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{t("col_actual")}</span>
      </th>
      {compareMode && <>
        <th colSpan={3} className="text-center pr-4 py-3 text-[9px] font-black uppercase tracking-widest whitespace-nowrap min-w-[120px]" style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", color: "#CF305D" }}>{[cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource].filter(Boolean).join(" · ")}</th>
        {cmp2Enabled && <th colSpan={3} className="text-center pr-4 py-3 text-[9px] font-black uppercase tracking-widest whitespace-nowrap min-w-[120px]" style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", color: "#57aa78" }}>{[cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source].filter(Boolean).join(" · ")}</th>}
      </>}
    </React.Fragment>
  ))}
</tr>
  </>
)}
</thead>
<tbody key={`bs-body-${bsView}-${compareMode}`}>
            {pgcBsMapping ? (
              bsRoots.length === 0
                ? <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">No Balance Sheet data found</td></tr>
                : (compareMode ? renderBSCompareRows(bsRoots, cmpTree, cmp2Tree) : renderBSRows(bsRoots))
            ) : (
              bsView === "summary" ? (
                bsRoots.length === 0
                  ? <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">{t("no_bs_data")}</td></tr>
                  : (compareMode ? renderBSCompareRows(bsRoots, cmpTree, cmp2Tree) : renderBSRows(bsRoots))
              ) : allCompaniesLoading ? (
                <tr><td colSpan={companyColumns.length + 1} className="py-12 text-center">
                  <Loader2 size={20} className="animate-spin text-[#1a2f8a] mx-auto" />
                </td></tr>
              ) : (
                renderMultiCompanyRows(companyTree, bsView)
              )
)}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}

function useAnimatedNumber(target, duration = 800) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const from = Number(fromRef.current) || 0;
    const to = Number(target) || 0;
    if (from === to) { setDisplay(to); return; }

    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // Ease out cubic — slow at the end, smooth
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}

const AccountsDashboard = React.memo(function AccountsDashboard({ token, sources = [], structures = [], companies = [], dimensions = [] }) {
const { colors } = useSettings();
const { getLatestPeriod, setLatestPeriod } = useLatestPeriod();
const dashLoadStartRef = useRef(Date.now());
const TABS = useTabs();
const headerStyle = useTypo("header1");
const header3Style = useTypo("header3");
const underscoreStyle = useTypo("underscore1");
const filterStyle = useTypo("filter");
const t = useT();
const MONTHS = useMonths();
const locale = useLocale();

const [activeTab, setActiveTab]   = useState("pl");
const [prevTab, setPrevTab]       = useState(null);
const [animKey, setAnimKey]       = useState(0);
  const [dataSubTab, setDataSubTab] = useState("uploaded");
  const [ytdOnly, setYtdOnly]     = useState(false);  // ← lifted from PLStatement; PageHeader periodToggle controls this
const [plCmpLoading, setPlCmpLoading] = useState(false);
const [plCmp2Loading, setPlCmp2Loading] = useState(false);
const [plCmp2Enabled, setPlCmp2Enabled] = useState(true);
const [bsCmp2Enabled, setBsCmp2Enabled] = useState(true);
const [plExpandedMap, setPlExpandedMap] = useState({});
const [bsDrillMap, setBsDrillMap] = useState({});
const [plHistoryExpanded, setPlHistoryExpanded] = useState(false);
const [bsHistoryExpanded, setBsHistoryExpanded] = useState(false);
const [bsCmpDimGroups, setBsCmpDimGroups] = useState(null);
const [bsCmpDimensions, setBsCmpDimensions] = useState(null);
const [bsCmp2DimGroups, setBsCmp2DimGroups] = useState(null);
const [bsCmp2Dimensions, setBsCmp2Dimensions] = useState(null);

// STEP 1 — Add this block inside AccountsDashboard
// right after: const [bsCmp2Enabled, setBsCmp2Enabled] = useState(true);
 
const [internalSources,    setInternalSources]    = useState([]);
const [internalStructures, setInternalStructures] = useState([]);
const [internalCompanies,  setInternalCompanies]  = useState([]);
const [internalDimensions, setInternalDimensions] = useState([]);
const [metaLoading,        setMetaLoading]        = useState(false);
const metaFetchedRef = useRef(false);
 
// Props win when available; internal fallback fills the gap
const effectiveSources    = sources.length    > 0 ? sources    : internalSources;
const effectiveStructures = structures.length > 0 ? structures : internalStructures;
const effectiveCompanies  = companies.length  > 0 ? companies  : internalCompanies;
const effectiveDimensions = dimensions.length > 0 ? dimensions : internalDimensions;
 
// Mirrors exactly what HomePage.jsx fetches
const fetchMetadata = useCallback(async () => {
  if (metaFetchedRef.current || metaLoading || !token) return;
  metaFetchedRef.current = true;
  setMetaLoading(true);
 
  const h = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store",
    Pragma: "no-cache",
  };
 
  const tryGet = async (url) => {
    try {
      const res = await fetch(url, { headers: h });
      if (!res.ok) return null;
      const json = await res.json();
      const arr = json.value ?? (Array.isArray(json) ? json : null);
      return arr?.length > 0 ? arr : null;
    } catch { return null; }
  };
 
  const [srcData, strData, coData, dimData] = await Promise.all([
    tryGet(`${BASE_URL}/v2/sources`),
    tryGet(`${BASE_URL}/v2/structures`),
    tryGet(`${BASE_URL}/v2/companies`),
    tryGet(`${BASE_URL}/v2/dimensions`),
  ]);
 
  if (srcData) setInternalSources(srcData);
  if (strData) setInternalStructures(strData);
  if (coData)  setInternalCompanies(coData);
  if (dimData) setInternalDimensions(dimData);
 
  setMetaLoading(false);
}, [token, metaLoading]);
 
// Trigger 1: 1s grace period — if props still empty after mount, self-fetch
useEffect(() => {
  if (sources.length > 0 && structures.length > 0 && companies.length > 0) return;
  const t = setTimeout(() => {
    if (sources.length === 0 || structures.length === 0 || companies.length === 0) {
      console.warn("[AccountsDashboard] Filter props empty — self-fetching metadata.");
      metaFetchedRef.current = false;
      fetchMetadata();
    }
  }, 1000);
  return () => clearTimeout(t);
}, [sources.length, structures.length, companies.length, fetchMetadata]);
 
// Trigger 2: token arriving late (slow login / cold start)
useEffect(() => {
  if (!token) return;
  if (sources.length > 0 && structures.length > 0 && companies.length > 0) return;
  metaFetchedRef.current = false;
  fetchMetadata();
}, [token]); // eslint-disable-line react-hooks/exhaustive-deps

const TAB_ORDER = ["pl", "bs", "uploaded"];

const handleTabChange = (newTab) => {
  if (newTab === activeTab) return;
  setPrevTab(activeTab);
  setActiveTab(newTab);
  setAnimKey(k => k + 1);
};

  // ── Filter state (shared — used by Uploaded and Report tabs) ──
  const [upYear, setUpYear] = useState(DEFAULT_YEAR);
  const [upMonth, setUpMonth] = useState(DEFAULT_MONTH);
  const [upSource, setUpSource] = useState("");
  const [upStructure, setUpStructure] = useState("");
  const [upCompany, setUpCompany] = useState("");
const [upDimGroups, setUpDimGroups] = useState(null);   // null = all, [] = none, [...] = selected
const [upDimensions, setUpDimensions] = useState(null);

  // ── Data state ─────────────────────────────────────────────
  const [upData, setUpData] = useState([]);
  const [upLoading, setUpLoading] = useState(false);
  const [upError, setUpError] = useState(null);
  const [upFetched, setUpFetched] = useState(false);
  const [upSearch, setUpSearch] = useState("");
  const [prevData, setPrevData] = useState([]);
  const [prevLoading, setPrevLoading] = useState(false);

  const [mapData, setMapData] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [mapFetched, setMapFetched] = useState(false);
  const [mapSearch, setMapSearch] = useState("");

  const [grpData, setGrpData] = useState([]);
  const [grpLoading, setGrpLoading] = useState(false);
  const [grpError, setGrpError] = useState(null);
  const [grpFetched, setGrpFetched] = useState(false);
  const [grpSearch, setGrpSearch] = useState("");
  const [jrnData, setJrnData] = useState([]);
const [jrnLoading, setJrnLoading] = useState(false);
const [jrnError, setJrnError] = useState(null);
const [jrnFetched, setJrnFetched] = useState(false);
const [jrnSearch, setJrnSearch] = useState("");
const [jrnCmpData, setJrnCmpData] = useState([]);
const [jrnCmp2Data, setJrnCmp2Data] = useState([]);

const [breakers, setBreakers] = useState({ pl: {}, bs: {}, cf: {} });
const [pgcMapping, setPgcMapping] = useState(null);
const [pgcBsMapping, setPgcBsMapping] = useState(null);
const [spanishIfrsEsPlMapping, setSpanishIfrsEsPlMapping] = useState(null);
const [spanishIfrsEsBsMapping, setSpanishIfrsEsBsMapping] = useState(null);
const [danishIfrsPlMapping, setDanishIfrsPlMapping] = useState(null);
const [danishIfrsBsMapping, setDanishIfrsBsMapping] = useState(null);

// AFTER — drop this in its place:
useEffect(() => {
 if (!grpData.length) return;
  breakersFetchedRef.current = false;

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = {
    apikey:        SUPABASE_APIKEY,
    Authorization: `Bearer ${SUPABASE_APIKEY}`,
  };

  // ── Detect structure type from the group-account codes ──────
  // PGC / Spanish IFRS  → at least one code contains a letter  (e.g. "A.01.S")
  // Danish IFRS         → all codes are numeric AND at least one is 6 digits
  //                       (the Danish B/S codes: 101101 … 999999)
  // Everything else     → no custom breakers needed (fallback defaults apply)

const isPGC         = grpData.some(n => /[a-zA-Z]/.test(String(n.accountCode ?? n.AccountCode ?? "")) && String(n.accountCode ?? n.AccountCode ?? "").endsWith(".S"));
const isSpanishIfrsEs = !isPGC && grpData.some(n => /\.PL$/i.test(String(n.accountCode ?? n.AccountCode ?? "").trim()));
  const isSpanishIFRS = !isPGC && !isSpanishIfrsEs && grpData.some(n => /^[A-Z]\.\d/.test(String(n.accountCode ?? n.AccountCode ?? "")));
const isDanish      = !isPGC && !isSpanishIFRS && !isSpanishIfrsEs && grpData.some(n => /^\d{5,6}$/.test(String(n.accountCode ?? n.AccountCode ?? "")));

// Spanish IFRS-ES and Danish IFRS use mapping tables (no breakers needed)
  if (isDanish || isSpanishIfrsEs) return;

  if (!isPGC && !isSpanishIFRS) return;

  breakersFetchedRef.current = true;

  const endpoint = isPGC
    ? `${SUPABASE_URL}/pgc_breakers?select=*`
    : `${SUPABASE_URL}/spanish_ifrs_breakers?select=*`;

  fetch(endpoint, { headers: sbHeaders })
    .then(r => r.json())
    .then(rows => {
      if (!Array.isArray(rows)) return;
      const grouped = { pl: {}, bs: {}, cf: {} };
      rows.forEach(({ table_name, before_code, label, color }) => {
        if (["pgc_pl",       "danish_pl",       "spanish_ifrs_pl"      ].includes(table_name)) grouped.pl[before_code] = { label, color };
        if (["pgc_bs",       "danish_bs",       "spanish_ifrs_bs"      ].includes(table_name)) grouped.bs[before_code] = { label, color };
        if (["pgc_cashflow", "danish_cashflow", "spanish_ifrs_cashflow"].includes(table_name)) grouped.cf[before_code] = { label, color };
      });
      setBreakers(grouped);
    })
.catch(() => { breakersFetchedRef.current = false; });
}, [grpData]);

// ── PGC: load the new 3-section mapping (pgc_pl_rows + pgc_pl_sections) ──
useEffect(() => {
  if (!grpData.length) { setPgcMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
  if (!isPGC) { setPgcMapping(null); return; }

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = {
    apikey:        SUPABASE_APIKEY,
    Authorization: `Bearer ${SUPABASE_APIKEY}`,
  };

  Promise.all([
    fetch(`${SUPABASE_URL}/pgc_pl_rows?select=*&order=sort_order.asc`,    { headers: sbHeaders }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/pgc_pl_sections?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
  ])
.then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
const rows = new Map();
      const names = new Map();
      rowsArr.forEach(r => {
        rows.set(String(r.account_code), {
          section:       String(r.section_code),
          sortOrder:     Number(r.sort_order),
          isSum:         !!r.is_sum,
          showInSummary: !!r.show_in_summary,
        });
       const localizedName = r[`account_name_${locale}`] || r.account_name;
        if (localizedName) names.set(String(r.account_code), String(localizedName));
      });
      const sections = new Map();
      secsArr.forEach(s => {
        sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) });
      });
setPgcMapping({ rows, sections, names });
    })
    .catch(() => setPgcMapping(null));
}, [grpData, locale]);

// ── PGC: load the new 3-section BALANCE SHEET mapping(pgc_bs_rows + pgc_bs_sections) ──
useEffect(() => {
  if (!grpData.length) { setPgcBsMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
  if (!isPGC) { setPgcBsMapping(null); return; }

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = {
    apikey:        SUPABASE_APIKEY,
    Authorization: `Bearer ${SUPABASE_APIKEY}`,
  };

  Promise.all([
    fetch(`${SUPABASE_URL}/pgc_bs_rows?select=*&order=sort_order.asc`,    { headers: sbHeaders }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/pgc_bs_sections?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
  ])
    .then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
const rows = new Map();
      const names = new Map();
      rowsArr.forEach(r => {
        rows.set(String(r.account_code), {
          section:       String(r.section_code),
          sortOrder:     Number(r.sort_order),
          isSum:         !!r.is_sum,
          showInSummary: !!r.show_in_summary,
          level:         Number(r.level ?? 0),
        });
        const localizedName = r[`account_name_${locale}`] || r.account_name;
if (localizedName) names.set(String(r.account_code), String(localizedName));
      });
      const sections = new Map();
      secsArr.forEach(s => {
        sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) });
      });
setPgcBsMapping({ rows, sections, names });
    })
    .catch(() => setPgcBsMapping(null));
}, [grpData, locale]);

// ── Danish IFRS: load PL mapping(danish_ifrs_pl_rows + danish_ifrs_pl_sections) ──
useEffect(() => {
  console.log("[DanishPL useEffect] fired, grpData.length=", grpData.length);
  if (!grpData.length) { setDanishIfrsPlMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
const isSpanishIfrsEs = !isPGC && grpData.some(n => /\.PL$/i.test(String(n.accountCode ?? n.AccountCode ?? "").trim()));
  const isSpanishIFRS = !isPGC && !isSpanishIfrsEs && grpData.some(n => /^[A-Z]\.\d/.test(String(n.accountCode ?? n.AccountCode ?? "")));
  const isDanish = !isPGC && !isSpanishIFRS && !isSpanishIfrsEs && grpData.some(n => /^\d{5,6}$/.test(String(n.accountCode ?? n.AccountCode ?? "")));

  console.log("[DanishPL useEffect] isPGC=", isPGC, "isSpanishIFRS=", isSpanishIFRS, "isDanish=", isDanish);

  if (!isDanish) { setDanishIfrsPlMapping(null); return; }

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = {
    apikey:        SUPABASE_APIKEY,
    Authorization: `Bearer ${SUPABASE_APIKEY}`,
  };

  Promise.all([
    fetch(`${SUPABASE_URL}/danish_ifrs_pl_rows?select=*&order=sort_order.asc`,    { headers: sbHeaders }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/danish_ifrs_pl_sections?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
  ])
    .then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
const rows = new Map();
      const names = new Map();
      rowsArr.forEach(r => {
        rows.set(String(r.account_code), {
          section:       String(r.section_code),
          sortOrder:     Number(r.sort_order),
          isSum:         !!r.is_sum,
          showInSummary: !!r.show_in_summary,
          level:         Number(r.level ?? 0),
        });
        const localizedName = r[`account_name_${locale}`] || r.account_name;
        if (localizedName) names.set(String(r.account_code), String(localizedName));
      });
      const sections = new Map();
      secsArr.forEach(s => {
        sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) });
      });
console.log("[DanishPL useEffect] SETTING mapping, rows=", rows.size, "sections=", sections.size);
      setDanishIfrsPlMapping({ rows, sections, names });
    })
    .catch((e) => { console.log("[DanishPL useEffect] FETCH ERROR:", e); setDanishIfrsPlMapping(null); });
}, [grpData, locale]);

// ── Danish IFRS: load BS mapping(danish_ifrs_bs_rows + danish_ifrs_bs_sections) ──
useEffect(() => {
  if (!grpData.length) { setDanishIfrsBsMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
  const isSpanishIFRS = !isPGC && grpData.some(n => /^[A-Z]\.\d/.test(String(n.accountCode ?? n.AccountCode ?? "")));
const isDanish = !isPGC && !isSpanishIFRS && grpData.some(n => /^\d{5,6}$/.test(String(n.accountCode ?? n.AccountCode ?? "")));

  if (!isDanish) { setDanishIfrsBsMapping(null); return; }

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = {
    apikey:        SUPABASE_APIKEY,
    Authorization: `Bearer ${SUPABASE_APIKEY}`,
  };

  Promise.all([
    fetch(`${SUPABASE_URL}/danish_ifrs_bs_rows?select=*&order=sort_order.asc`,    { headers: sbHeaders }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/danish_ifrs_bs_sections?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
  ])
    .then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
const rows = new Map();
      const names = new Map();
      rowsArr.forEach(r => {
        rows.set(String(r.account_code), {
          section:       String(r.section_code),
          sortOrder:     Number(r.sort_order),
          isSum:         !!r.is_sum,
          showInSummary: !!r.show_in_summary,
          level:         Number(r.level ?? 0),
        });
        if (r.account_name) names.set(String(r.account_code), String(r.account_name));
      });
      const sections = new Map();
      secsArr.forEach(s => {
        sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) });
      });
      setDanishIfrsBsMapping({ rows, sections, names });
    })
    .catch(() => setDanishIfrsBsMapping(null));
}, [grpData, locale]);

// ── Spanish IFRS ES Españolizado): load PL mapping ──
useEffect(() => {
  if (!grpData.length) { setSpanishIfrsEsPlMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
  const isSpanishIfrsEs = !isPGC && grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /\.PL$/.test(c);
  });

  if (!isSpanishIfrsEs) { setSpanishIfrsEsPlMapping(null); return; }

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

  Promise.all([
    fetch(`${SUPABASE_URL}/spanish_ifrs_es_pl_rows?select=*&order=sort_order.asc`,    { headers: sbHeaders }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/spanish_ifrs_es_pl_sections?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
  ])
    .then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
const rows = new Map();
      const names = new Map();
      rowsArr.forEach(r => {
        rows.set(String(r.account_code), {
          section:       String(r.section_code),
          sortOrder:     Number(r.sort_order),
          isSum:         !!r.is_sum,
          showInSummary: !!r.show_in_summary,
          level:         Number(r.level ?? 0),
        });
const localizedName = r[`account_name_${locale}`] || r.account_name;
        if (localizedName) names.set(String(r.account_code), String(localizedName));
      });
      const sections = new Map();
      secsArr.forEach(s => {
        sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) });
      });
      setSpanishIfrsEsPlMapping({ rows, sections, names });
    })
    .catch(() => setSpanishIfrsEsPlMapping(null));
}, [grpData, locale]);

// ── Spanish IFRS ES: load BS mapping──
useEffect(() => {
  if (!grpData.length) { setSpanishIfrsEsBsMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
  const isSpanishIfrsEs = !isPGC && grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /\.PL$/.test(c);
  });

  if (!isSpanishIfrsEs) { setSpanishIfrsEsBsMapping(null); return; }

  const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
  const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
  const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

  Promise.all([
    fetch(`${SUPABASE_URL}/spanish_ifrs_es_bs_rows?select=*&order=sort_order.asc`,    { headers: sbHeaders }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/spanish_ifrs_es_bs_sections?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
  ])
    .then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
const rows = new Map();
      const names = new Map();
      rowsArr.forEach(r => {
        rows.set(String(r.account_code), {
          section:       String(r.section_code),
          sortOrder:     Number(r.sort_order),
          isSum:         !!r.is_sum,
          showInSummary: !!r.show_in_summary,
          level:         Number(r.level ?? 0),
        });
const localizedName = r[`account_name_${locale}`] || r.account_name;
        if (localizedName) names.set(String(r.account_code), String(localizedName));
      });
      const sections = new Map();
      secsArr.forEach(s => {
        sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) });
      });
      setSpanishIfrsEsBsMapping({ rows, sections, names });
    })
.catch(() => setSpanishIfrsEsBsMapping(null));
}, [grpData, locale]);

const [exportModal, setExportModal] = useState(false);
const [viewsMode, setViewsMode] = useState(null); // null | "landing" | "structure" | "report"
const [savedMappings, setSavedMappings] = useState([]);
const [mappingsLoading, setMappingsLoading] = useState(false);
const [mappingsError, setMappingsError] = useState(null);

const fetchSavedMappings = useCallback(async () => {
  setMappingsLoading(true);
  setMappingsError(null);
  try {
    const { supabase } = await import("../../lib/supabaseClient");
    const { listMappings, getActiveCompanyId } = await import("../../lib/mappingsApi");
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error("Not authenticated");
    const cid = await getActiveCompanyId(uid);
    if (!cid) throw new Error("No active company");
    const rows = await listMappings({ companyId: cid });
    setSavedMappings(Array.isArray(rows) ? rows : []);
  } catch (e) {
    setMappingsError(e.message);
    setSavedMappings([]);
  } finally {
    setMappingsLoading(false);
  }
}, []);

useEffect(() => {
  if (viewsMode === "structure") fetchSavedMappings();
}, [viewsMode, fetchSavedMappings]);


const [activeMapping, setActiveMapping] = useState(null);
// activeMapping shape: { mapping_id, name, standard, plConverted, bsConverted } | null

const handleApplyMapping = useCallback((m) => {
  setActiveMapping({
    mapping_id: m.mapping_id,
    name: m.name,
    standard: m.standard,
    plConverted: convertSavedMappingTree(m.pl_tree),
    bsConverted: convertSavedMappingTree(m.bs_tree, { normalizeBS: true }),
    plLiteral: buildSavedMappingLiteral(m.pl_tree),
    bsLiteral: buildSavedMappingLiteral(m.bs_tree),
    highlightedIds: Array.isArray(m.highlighted_ids) ? new Set(m.highlighted_ids) : new Set(),
  });
}, []);

const [exportOpts, setExportOpts] = useState({
  plSummary: true, plDetailed: true,
  bsSummary: true, bsAssets: true, bsEquity: true,
  drillDown: false,
});

  // ── Compare mode state ─────────────────────────────────────

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store",
    Pragma: "no-cache",
  }), [token]);

  useEffect(() => {
if (effectiveSources.length > 0 && !upSource) {
  const s = effectiveSources[0];
      setUpSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
    }
  }, [effectiveSources, upSource]);


 useEffect(() => {
    if (effectiveStructures.length > 0 && !upStructure) {
      const s = effectiveStructures[0];
      setUpStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
    }
  }, [effectiveStructures, upStructure]);


 useEffect(() => {
    if (effectiveCompanies.length > 0 && !upCompany) {
      const c = effectiveCompanies[0];
      setUpCompany(
        typeof c === "object"
          ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
          : String(c)
      );
    }
  }, [effectiveCompanies, upCompany]);


// Auto-find the latest period with data once source/structure/company are known.
  // Fast path: read from LatestPeriodContext cache (populated on login by EpicLoader).
  // Slow path: 24-month network probe (fallback if cache is empty/expired).
const autoPeriodDone = useRef(false);
const breakersFetchedRef = useRef(false);
  const [probingPeriod, setProbingPeriod] = useState(false);
  useEffect(() => {
    if (autoPeriodDone.current) return;
    if (!upSource || !upStructure || !upCompany) return;
    autoPeriodDone.current = true;

// ── FAST PATH 1: React context cache ──────────────────
    const cached = getLatestPeriod(upSource, upStructure, upCompany);
    if (cached) {
      console.log("[IndividualesPage] CONTEXT CACHE HIT ✓", cached);
      setUpYear(String(cached.year));
      setUpMonth(String(cached.month));
      setProbingPeriod(false);
      return;
    }

    // ── FAST PATH 2: sessionStorage (written by EpicLoader's prefetchHomeData) ──
    try {
      const ssKey = `home_latest_period_${upSource}_${upStructure}_${upCompany}`;
      const ssRaw = sessionStorage.getItem(ssKey);
      if (ssRaw) {
        const parsed = JSON.parse(ssRaw);
        if (parsed.year && parsed.month) {
          console.log("[IndividualesPage] SESSION STORAGE HIT ✓", parsed);
          setUpYear(String(parsed.year));
          setUpMonth(String(parsed.month));
          setLatestPeriod(upSource, upStructure, upCompany, parsed.year, parsed.month);
          setProbingPeriod(false);
          return;
        }
      }
    } catch (e) { /* ignore */ }

    console.log("[IndividualesPage] CACHE MISS - falling back to probe");

    // ── SLOW PATH: network probe (fallback) ───────────────
    setProbingPeriod(true);
    (async () => {
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1; // current month 1-12
      // Probe up to 24 months back
      for (let i = 0; i < 24; i++) {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${upSource}' and GroupStructure eq '${upStructure}' and CompanyShortName eq '${upCompany}'`;
          const res = await fetch(
            `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
            { headers: headers() }
          );
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            if (rows.length > 0) {
              setUpYear(String(y));
              setUpMonth(String(m));
              setLatestPeriod(upSource, upStructure, upCompany, y, m);
              setProbingPeriod(false);
              return;
            }
          }
        } catch { /* keep probing */ }
        // Step back one month
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      setProbingPeriod(false);
    })();
  }, [upSource, upStructure, upCompany, headers, getLatestPeriod, setLatestPeriod]);

  // ── Fetch functions ────────────────────────────────────────
const fetchUploaded = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) return;
    setUpLoading(true); setUpError(null); setUpFetched(false);
    try {
      const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: headers() }
      );
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status} – ${t.slice(0, 200)}`); }
      const json = await res.json();
      setUpData(json.value ?? (Array.isArray(json) ? json : [json]));
      setUpFetched(true);
    } catch (e) { setUpError(e.message); }
    finally { setUpLoading(false); }
    
  }, [headers]);

const fetchPrev = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) return;
  if (Number(month) === 1) { setPrevData([]); return; }
  const prevMonth = Number(month) - 1;
  setPrevLoading(true);
  try {
    const filter = `Year eq ${year} and Month eq ${prevMonth} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const res = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: headers() }
    );
    if (!res.ok) { setPrevData([]); return; }
    const json = await res.json();
    setPrevData(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setPrevData([]); }
  finally { setPrevLoading(false); }
}, [headers]);

const fetchCmp = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) return;
setPlCmpLoading(true);
  try {
    // Current period
    const filterA = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const resA = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterA)}`,
      { headers: headers() }
    );
    const jsonA = resA.ok ? await resA.json() : { value: [] };
    setCmpData(jsonA.value ?? (Array.isArray(jsonA) ? jsonA : []));

    // Previous period (for monthly)
    if (Number(month) === 1) { setCmpPrevData([]); }
    else {
      const filterB = `Year eq ${year} and Month eq ${Number(month) - 1} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
      const resB = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterB)}`,
        { headers: headers() }
      );
      const jsonB = resB.ok ? await resB.json() : { value: [] };
      setCmpPrevData(jsonB.value ?? (Array.isArray(jsonB) ? jsonB : []));
    }
  } catch { setCmpData([]); setCmpPrevData([]); }
  finally { setCmpLoading(false); }
}, [headers]);
  

// ── DEBUG: raw fetch to inspect what API actually returns ───
  useEffect(() => {
    if (!token) return;
    (async () => {
      const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      try {
        const r1 = await fetch(`${BASE_URL}/v2/mapped-accounts`, { headers: h });
        const j1 = await r1.json();
        const rows1 = j1.value ?? (Array.isArray(j1) ? j1 : []);
        console.log("🔍🔍🔍 RAW /v2/mapped-accounts 🔍🔍🔍");
        console.log("Total rows:", rows1.length);
        console.log("First row keys:", rows1[0] ? Object.keys(rows1[0]) : "NO ROWS");
        console.log("First row:", rows1[0]);
        const m70810 = rows1.filter(r => String(r.LocalAccountCode ?? r.localAccountCode ?? "") === "70810000");
        const m70500 = rows1.filter(r => String(r.LocalAccountCode ?? r.localAccountCode ?? "") === "70500000");
        console.log("MAPPED 70810000 raw:", JSON.stringify(m70810, null, 2));
        console.log("MAPPED 70500000 raw:", JSON.stringify(m70500, null, 2));
      } catch (e) { console.error("Mapped fetch error:", e); }

      try {
        // Use a sensible filter to limit volume — current period
        const filter = `Year eq 2025 and Month eq 12 and CompanyShortName eq 'SON'`;
        const r2 = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h });
        const j2 = await r2.json();
        const rows2 = j2.value ?? (Array.isArray(j2) ? j2 : []);
        console.log("🔍🔍🔍 RAW /v2/reports/uploaded-accounts (SON 2025-12) 🔍🔍🔍");
        console.log("Total rows:", rows2.length);
        console.log("First row keys:", rows2[0] ? Object.keys(rows2[0]) : "NO ROWS");
        console.log("First row:", rows2[0]);
        const u70810 = rows2.filter(r => String(r.LocalAccountCode ?? r.localAccountCode ?? "") === "70810000");
        const u70500 = rows2.filter(r => String(r.LocalAccountCode ?? r.localAccountCode ?? "") === "70500000");
        const u70000 = rows2.filter(r => String(r.LocalAccountCode ?? r.localAccountCode ?? "") === "70000000");
        console.log("UPLOADED 70810000 raw:", JSON.stringify(u70810, null, 2));
        console.log("UPLOADED 70500000 raw:", JSON.stringify(u70500, null, 2));
        console.log("UPLOADED 70000000 raw (first 2):", JSON.stringify(u70000.slice(0, 2), null, 2));
      } catch (e) { console.error("Uploaded fetch error:", e); }
    })();
  }, [token]);

  const fetchMapped = useCallback(async () => {
    setMapLoading(true); setMapError(null); setMapFetched(false);
    try {
      const res = await fetch(`${BASE_URL}/v2/mapped-accounts`, { headers: headers() });
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status} – ${t.slice(0, 200)}`); }
      const json = await res.json();
      setMapData(json.value ?? (Array.isArray(json) ? json : [json]));
      setMapFetched(true);
    } catch (e) { setMapError(e.message); }
    finally { setMapLoading(false); }
  }, [headers]);

  const fetchGroup = useCallback(async () => {
    setGrpLoading(true); setGrpError(null); setGrpFetched(false);
    try {
      const res = await fetch(`${BASE_URL}/v2/group-accounts`, { headers: headers() });
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status} – ${t.slice(0, 200)}`); }
      const json = await res.json();
      console.log("GROUP ACCOUNTS RAW:", JSON.stringify(json.value?.slice(0,3) ?? json.slice?.(0,3), null, 2));
      setGrpData(json.value ?? (Array.isArray(json) ? json : [json]));
      setGrpFetched(true);
    } catch (e) { setGrpError(e.message); }
    finally { setGrpLoading(false); }
  }, [headers]);

useEffect(() => {
  if (upSource && upStructure && upYear && upMonth && upCompany) {
fetchUploaded(upYear, upMonth, upSource, upStructure, upCompany);
    fetchPrev(upYear, upMonth, upSource, upStructure, upCompany);
    fetchJournal(upYear, upMonth, upSource, upStructure, upCompany);
  }
}, [upSource, upStructure, upYear, upMonth, upCompany]);



const fetchJournal = useCallback(async (year, month, source, structure, company) => {
  const y = year ?? upYear; const m = month ?? upMonth;
  const s = source ?? upSource; const st = structure ?? upStructure; const co = company ?? upCompany;
  if (!y || !m || !s || !st || !co) return;
  setJrnLoading(true); setJrnError(null); setJrnFetched(false);
  try {
    const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}' and CompanyShortName eq '${co}'`;
    const res = await fetch(
      `${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`,
      { headers: headers() }
    );
    if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status} – ${t.slice(0, 200)}`); }
    const json = await res.json();
    setJrnData(json.value ?? (Array.isArray(json) ? json : [json]));
    console.log("JOURNAL RAW:", JSON.stringify(json).slice(0, 500));
    setJrnFetched(true);
  } catch (e) { setJrnError(e.message); }
  finally { setJrnLoading(false); }
}, [upYear, upMonth, upSource, upStructure, upCompany, headers]);

const fetchJournalCmp = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) { setJrnCmpData([]); return; }
  try {
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const res = await fetch(
      `${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`,
      { headers: headers() }
    );
    if (!res.ok) { setJrnCmpData([]); return; }
    const json = await res.json();
    setJrnCmpData(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setJrnCmpData([]); }
}, [headers]);

const fetchJournalCmp2 = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) { setJrnCmp2Data([]); return; }
  try {
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const res = await fetch(
      `${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`,
      { headers: headers() }
    );
    if (!res.ok) { setJrnCmp2Data([]); return; }
    const json = await res.json();
    setJrnCmp2Data(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setJrnCmp2Data([]); }
}, [headers]);

const fetchCmp2 = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) return;
  setCmp2Loading(true);
  try {
    const filterA = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const resA = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterA)}`,
      { headers: headers() }
    );
    const jsonA = resA.ok ? await resA.json() : { value: [] };
    setCmp2Data(jsonA.value ?? (Array.isArray(jsonA) ? jsonA : []));

    if (Number(month) === 1) { setCmp2PrevData([]); }
    else {
      const filterB = `Year eq ${year} and Month eq ${Number(month) - 1} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
      const resB = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterB)}`,
        { headers: headers() }
      );
      const jsonB = resB.ok ? await resB.json() : { value: [] };
      setCmp2PrevData(jsonB.value ?? (Array.isArray(jsonB) ? jsonB : []));
    }
  } catch { setCmp2Data([]); setCmp2PrevData([]); }
  finally { setCmp2Loading(false); }
}, [headers]);

useEffect(() => {
    fetchMapped();
    fetchGroup();
  }, []);

useEffect(() => {
    if (dataSubTab === "journal" && !jrnFetched && !jrnLoading) {
      fetchJournal();
    }
  }, [dataSubTab]);

  // ── Manual re-fetch for uploaded when filters change ───────
const handleLoadUploaded = () => {
  fetchUploaded(upYear, upMonth, upSource, upStructure, upCompany);
  fetchPrev(upYear, upMonth, upSource, upStructure, upCompany);
};

// ── Compare mode state ─────────────────────────────────────
const [bsCompareMode, setBsCompareMode] = useState(false);
const [bsCmpYear, setBsCmpYear] = useState("");
const [bsCmpMonth, setBsCmpMonth] = useState("");
const [bsCmpSource, setBsCmpSource] = useState("");
const [bsCmpStructure, setBsCmpStructure] = useState("");
const [bsCmpCompany, setBsCmpCompany] = useState("");
const [bsCmpData, setBsCmpData] = useState([]);
const [bsCmp2Year, setBsCmp2Year] = useState("");
const [bsCmp2Month, setBsCmp2Month] = useState("");
const [bsCmp2Source, setBsCmp2Source] = useState("");
const [bsCmp2Structure, setBsCmp2Structure] = useState("");
const [bsCmp2Company, setBsCmp2Company] = useState("");
const [bsCmp2Data, setBsCmp2Data] = useState([]);
const [compareMode, setCompareMode] = useState(false);
const [cmpYear,      setCmpYear]      = useState("");
const [cmpMonth,     setCmpMonth]     = useState("");
const [cmpSource,    setCmpSource]    = useState("");
const [cmpStructure, setCmpStructure] = useState("");
const [cmpCompany,   setCmpCompany]   = useState("");
const [cmpDimGroups, setCmpDimGroups] = useState(null);
  const [cmpDimensions, setCmpDimensions] = useState(null);
const [cmpData,     setCmpData]       = useState([]);
const [cmpPrevData, setCmpPrevData]   = useState([]);
const [cmpLoading,  setCmpLoading]    = useState(false);

// ── Compare period 2 ──────────────────────────────────────
const [cmp2Year,      setCmp2Year]      = useState("");
const [cmp2Month,     setCmp2Month]     = useState("");
const [cmp2Source,    setCmp2Source]    = useState("");
const [cmp2Structure, setCmp2Structure] = useState("");
const [cmp2Company,   setCmp2Company]   = useState("");
const [cmp2DimGroups, setCmp2DimGroups] = useState(null);
  const [cmp2Dimensions, setCmp2Dimensions] = useState(null);
const [cmp2Data,      setCmp2Data]      = useState([]);
const [cmp2PrevData,  setCmp2PrevData]  = useState([]);
const [cmp2Loading,   setCmp2Loading]   = useState(false);
  useEffect(() => {
  if (compareMode && cmpSource && cmpStructure && cmpYear && cmpMonth && cmpCompany) {
    fetchCmp(cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany);
  }
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany]);

useEffect(() => {
  if (compareMode && cmpSource && cmpStructure && cmpYear && cmpMonth && cmpCompany) {
    fetchJournalCmp(cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany);
  } else {
    setJrnCmpData([]);
  }
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, fetchJournalCmp]);

useEffect(() => {
  if (compareMode && cmp2Source && cmp2Structure && cmp2Year && cmp2Month && cmp2Company) {
    fetchJournalCmp2(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company);
  } else {
    setJrnCmp2Data([]);
  }
}, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, fetchJournalCmp2]);

useEffect(() => {
  if (compareMode && cmp2Source && cmp2Structure && cmp2Year && cmp2Month && cmp2Company) {
    fetchCmp2(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company);
  }
}, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company]);

console.log("🔴 RENDER AccountsDashboard | grpData:", grpData.length, "| pgcMapping:", pgcMapping ? "SET" : "null", "| danishIfrsPlMapping:", danishIfrsPlMapping ? "SET" : "null", "| pgcBsMapping:", pgcBsMapping ? "SET" : "null", "| danishIfrsBsMapping:", danishIfrsBsMapping ? "SET" : "null");
const tab        = TABS.find(t => t.id === activeTab);
   const anyLoading = probingPeriod || upLoading || prevLoading || plCmpLoading || plCmp2Loading || mapLoading || grpLoading || jrnLoading;

// Progress meter for the loading overlay covering the tab area
  const dashProgress = useMemo(() => {
    let pct = 0;
    if (upYear && upMonth)                                     pct += 15;
    if (effectiveSources.length > 0 && effectiveStructures.length > 0 && effectiveCompanies.length > 0) pct += 15;
    if (grpData.length > 0)                                    pct += 25;
    if (upData.length > 0)                                     pct += 25;
    if (!probingPeriod && !upLoading && !grpLoading)           pct += 20;
    return Math.min(100, pct);
  }, [upYear, upMonth, effectiveSources.length, effectiveStructures.length, effectiveCompanies.length, grpData.length, upData.length, probingPeriod, upLoading, grpLoading]);

  // Smoothly animate the displayed value between progress changes
  const animatedDashProgress = useAnimatedNumber(dashProgress, 700);

  const dashReady = dashProgress >= 100;

  console.log("jrnData:", jrnData.length, jrnData[0]);
console.log("jrnFetched:", jrnFetched, "jrnLoading:", jrnLoading, "jrnError:", jrnError);
  const dimGroups = useMemo(() => {
  const seen = new Set();
  return effectiveDimensions

    .map(d => typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "")
    .filter(g => g && !seen.has(g) && seen.add(g));
}, [effectiveDimensions]);

const filteredDims = useMemo(() => {
  if (!upDimGroups || upDimGroups.length === 0) return effectiveDimensions;
  return effectiveDimensions.filter(d => {
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return upDimGroups.includes(g);
  });
}, [effectiveDimensions, upDimGroups]);

useEffect(() => {
  window.__upDataDebug = upData;
  window.__upDimGroupsDebug = upDimGroups;
  window.__upDimensionsDebug = upDimensions;
  window.__effectiveDimensionsDebug = effectiveDimensions;
  console.log("[DEBUG EXPOSE] upData:", upData.length, "groups:", upDimGroups, "dims:", upDimensions);
}, [upData, upDimGroups, upDimensions, effectiveDimensions]);

const cmpFilteredDims = useMemo(() => {
  if (!cmpDimGroups || cmpDimGroups.length === 0) return effectiveDimensions;
  return effectiveDimensions.filter(d => {
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return cmpDimGroups.includes(g);
  });
}, [effectiveDimensions, cmpDimGroups]);

const cmp2FilteredDims = useMemo(() => {
  if (!cmp2DimGroups || cmp2DimGroups.length === 0) return effectiveDimensions;
  return effectiveDimensions.filter(d => {
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return cmp2DimGroups.includes(g);
  });
}, [effectiveDimensions, cmp2DimGroups]);
const dataSubTabSelector = (
  <div className="flex items-center gap-1 p-1 bg-gray-100/70 rounded-xl">
    {["uploaded", "mapped", "group", "journal", "report"].map(t => (
      <button
        key={t}
        onClick={() => setDataSubTab(t)}
        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all capitalize
          ${dataSubTab === t
            ? "bg-white text-[#1a2f8a] shadow-sm"
            : "text-gray-400 hover:text-gray-600"}`}
      >
        {t}
      </button>
    ))}
  </div>
);

const ExportModal = exportModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setExportModal(false)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
<div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
              <FileText size={13} className="text-white/70" />
            </div>
            <div>
              <p className="k-panel-title font-black text-sm">Export Report</p>
              <p className="text-white/50 text-[10px]">{compareMode ? "P&L compare on" : "P&L standard"}{bsCompareMode ? " · BS compare on" : " · BS standard"}</p>
            </div>
          </div>
          <button onClick={() => setExportModal(false)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
            <X size={13} className="text-white/70" />
          </button>
        </div>
        <div className="p-5 space-y-4">


{/* Active compare filters info */}
          {(compareMode || bsCompareMode) && (
            <div className="bg-[#f8f9ff] rounded-xl p-3 space-y-2 border border-[#1a2f8a]/10">
              {compareMode && (
                <div>
                  <p className="text-[9px] font-black text-[#1a2f8a]/50 uppercase tracking-widest mb-1">P&L Compare</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#CF305D]/10 border border-[#CF305D]/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#CF305D] flex-shrink-0"/>
                      <span className="text-[9px] font-bold text-[#CF305D]">B</span>
                      <span className="text-[9px] text-gray-500">{[MONTHS.find(m=>String(m.value)===String(cmpMonth))?.label,cmpYear,cmpSource,cmpStructure,cmpCompany].filter(Boolean).join(' · ')||'—'}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#57aa78]/10 border border-[#57aa78]/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#57aa78] flex-shrink-0"/>
                      <span className="text-[9px] font-bold text-[#57aa78]">C</span>
                      <span className="text-[9px] text-gray-500">{[MONTHS.find(m=>String(m.value)===String(cmp2Month))?.label,cmp2Year,cmp2Source,cmp2Structure,cmp2Company].filter(Boolean).join(' · ')||'—'}</span>
                    </div>
                  </div>
                </div>
              )}
              {bsCompareMode && (
                <div>
                  <p className="text-[9px] font-black text-[#1a2f8a]/50 uppercase tracking-widest mb-1">Balance Sheet Compare</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#CF305D]/10 border border-[#CF305D]/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#CF305D] flex-shrink-0"/>
                      <span className="text-[9px] font-bold text-[#CF305D]">B</span>
                      <span className="text-[9px] text-gray-500">{[MONTHS.find(m=>String(m.value)===String(bsCmpMonth))?.label,bsCmpYear,bsCmpSource,bsCmpStructure,bsCmpCompany].filter(Boolean).join(' · ')||'—'}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#57aa78]/10 border border-[#57aa78]/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#57aa78] flex-shrink-0"/>
                      <span className="text-[9px] font-bold text-[#57aa78]">C</span>
                      <span className="text-[9px] text-gray-500">{[MONTHS.find(m=>String(m.value)===String(bsCmp2Month))?.label,bsCmp2Year,bsCmp2Source,bsCmp2Structure,bsCmp2Company].filter(Boolean).join(' · ')||'—'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* P&L */}
          <div>
            <p className="text-white font-black text-base">Profit & Loss</p>
            <div className="space-y-1.5">
              {[["plSummary","Summary"],["plDetailed","Detailed"]].map(([k,l]) => (
                <label key={k} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${exportOpts[k] ? "bg-[#1a2f8a] border-[#1a2f8a]" : "border-gray-200 group-hover:border-[#1a2f8a]/40"}`}
                    onClick={() => setExportOpts(o => ({...o,[k]:!o[k]}))}>
                    {exportOpts[k] && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                  </div>
                  <span className="text-xs text-gray-700 font-medium">{l}</span>
                </label>
              ))}
            </div>
          </div>
          {/* BS */}
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Balance Sheet</p>
            <div className="space-y-1.5">
              {[["bsSummary","Summary"],["bsAssets","Assets"],["bsEquity","Equity & Liabilities"]].map(([k,l]) => (
                <label key={k} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${exportOpts[k] ? "bg-[#1a2f8a] border-[#1a2f8a]" : "border-gray-200 group-hover:border-[#1a2f8a]/40"}`}
                    onClick={() => setExportOpts(o => ({...o,[k]:!o[k]}))}>
                    {exportOpts[k] && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                  </div>
                  <span className="text-xs text-gray-700 font-medium">{l}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Dimensions & Journal */}
          <div className="border-t border-gray-50 pt-3">
            <label className="flex items-center gap-2.5 cursor-pointer group">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${exportOpts.dimJournal !== false ? "bg-amber-500 border-amber-500" : "border-gray-200 group-hover:border-amber-300"}`}
                onClick={() => setExportOpts(o => ({...o,dimJournal:o.dimJournal===false?true:false}))}>
                {exportOpts.dimJournal !== false && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
              </div>
              <div>
                <span className="text-xs text-gray-700 font-medium">Dimensions & Journal entries</span>
                <p className="text-[10px] text-gray-400">Separate sheet with all dimension and journal data</p>
              </div>
            </label>
          </div>
<div className="border-t border-gray-50 pt-3 flex items-center gap-2">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex-shrink-0">Format</p>
            <div className="flex items-center gap-1 p-1 bg-gray-100/70 rounded-xl ml-auto">
              {[["xlsx","Excel"],["pdf","PDF"]].map(([f,l])=>(
                <button key={f} onClick={()=>setExportOpts(o=>({...o,format:f}))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${(exportOpts.format??'xlsx')===f?"bg-white text-[#1a2f8a] shadow-sm":"text-gray-400 hover:text-gray-600"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              setExportModal(false);
              const fmt = exportOpts.format ?? 'xlsx';
              const commonArgs = {
                groupAccounts: grpData,
                uploadedAccounts: upDimension ? upData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === upDimension) : upData,
                prevUploadedAccounts: upDimension ? prevData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === upDimension) : prevData,
                compareMode,
                cmpUploadedAccounts: cmpDimension ? cmpData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmpDimension) : cmpData,
                cmpPrevUploadedAccounts: cmpDimension ? cmpPrevData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmpDimension) : cmpPrevData,
                cmpFilters: { year: cmpYear, month: cmpMonth, source: cmpSource, structure: cmpStructure, company: cmpCompany },
                cmp2UploadedAccounts: cmp2Dimension ? cmp2Data.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmp2Dimension) : cmp2Data,
                cmp2PrevUploadedAccounts: cmp2Dimension ? cmp2PrevData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmp2Dimension) : cmp2PrevData,
                cmp2Filters: { year: cmp2Year, month: cmp2Month, source: cmp2Source, structure: cmp2Structure, company: cmp2Company },
                bsCompareMode,
                bsCmpUploadedAccounts: bsCmpData,
                bsCmpFilters: { year: bsCmpYear, month: bsCmpMonth, source: bsCmpSource, structure: bsCmpStructure, company: bsCmpCompany },
                bsCmp2UploadedAccounts: bsCmp2Data,
                bsCmp2Filters: { year: bsCmp2Year, month: bsCmp2Month, source: bsCmp2Source, structure: bsCmp2Structure, company: bsCmp2Company },
                month: upMonth, year: upYear, source: upSource, structure: upStructure,
                journalEntries: jrnData,
               cmp2Enabled: plCmp2Enabled,
                bsCmp2Enabled: bsCmp2Enabled,
                summaryRows: (() => {
                  const allSums = [];
                  function walk(node) {
                    if (!hasData(node)) return;
                    if (!["P/L", "DIS"].includes(node.accountType)) return;
                    if (node.isSumAccount) allSums.push(node);
                    (node.children || []).forEach(c => walk(c));
                  }
                  const localTree = buildTree(grpData, upData);
                  localTree.filter(n => ["P/L", "DIS"].includes(n.accountType)).forEach(n => walk(n));
                  const plSums = allSums.filter(n => n.accountType === "P/L");
                  const isAlpha = plSums.some(n => /[a-zA-Z]/.test(String(n.code)));
                  let filtered = isAlpha
                    ? plSums.filter(n => String(n.code).endsWith(".S"))
                    : plSums.filter(n => PL_HIGHLIGHTED_CODES.has(String(n.code)));
                  if (filtered.length === 0) filtered = plSums.filter(n => n.level === 1);
                  return filtered.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
                })(),
                opts: exportOpts,
              };
      if(fmt==='pdf') generateKonsolidatorPdf(commonArgs);
              else generateKonsolidatorXlsx({...commonArgs, compareMode});
            }}
            className="w-full py-2.5 bg-[#1a2f8a] hover:bg-[#1a2f8a]/90 text-white text-xs font-black rounded-xl transition-all">
            Download {(exportOpts.format??'xlsx')==='pdf'?'PDF':'Excel'}
          </button>
        </div>
      </div>
    </div>
) : null;

return (
    <div className="flex flex-col" style={{ height: "100%", minHeight: 0, overflow: "visible" }}>
<style>{`
@keyframes plRowSlideIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
@keyframes modeMorph {
          0%   { opacity: 0; transform: translateY(-6px) scale(0.92); filter: blur(3px); }
          60%  { opacity: 1; filter: blur(0px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0px); }
        }
@keyframes letterMorph {
          0%   { opacity: 0; transform: translateY(-8px) scale(0.7); filter: blur(4px); }
          50%  { opacity: 1; filter: blur(0px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0px); }
        }
        @keyframes iconMorph {
          0%   { opacity: 0; transform: scale(0.4) rotate(-90deg); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes kBadgesPop {
          0%   { opacity: 0; transform: translateY(8px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .tab-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .tab-content > div { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .tab-content > div > div { display: flex; flex-direction: column; flex: 1; min-height: 0; }
   .tab-content .overflow-auto { flex: 1; min-height: 0; max-height: none !important; padding-bottom: 4px; }
     .tab-content > div > div > div { margin-bottom: 6px; }
        .text-\\[\\#1a2f8a\\] { color: ${colors.primary} !important; }
        .bg-\\[\\#1a2f8a\\] { background-color: ${colors.primary} !important; }
        .border-\\[\\#1a2f8a\\] { border-color: ${colors.primary} !important; }
        .text-\\[\\#CF305D\\] { color: ${colors.secondary} !important; }
        .bg-\\[\\#CF305D\\] { background-color: ${colors.secondary} !important; }
        .border-\\[\\#CF305D\\] { border-color: ${colors.secondary} !important; }
        .text-\\[\\#57aa78\\] { color: ${colors.tertiary} !important; }
        .bg-\\[\\#57aa78\\] { background-color: ${colors.tertiary} !important; }
        .border-\\[\\#57aa78\\] { border-color: ${colors.tertiary} !important; }
        .k-panel-title { color: ${colors.quaternary ?? "#F59E0B"} !important; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
{ExportModal}


      
{/* Page header — built from shared <PageHeader> */}
<PageHeader
kicker={viewsMode ? t("kicker_accounts_views") : t("kicker_accounts")}
  title={
    viewsMode === "landing" ? t("views_mappings")
    : viewsMode === "structure" ? t("views_structure_mappings")
    : viewsMode === "report" ? t("views_report_mappings")
    : tab.label
  }
  tabs={viewsMode ? [] : TABS}
  activeTab={viewsMode ? null : activeTab}
  onTabChange={handleTabChange}
  onBack={viewsMode ? () => { if (viewsMode === "landing") setViewsMode(null); else setViewsMode("landing"); } : undefined}
filters={viewsMode ? [] : [
    { label: t("filter_year"),     value: upYear,     onChange: setUpYear,
      options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
    { label: t("filter_month"),    value: upMonth,    onChange: setUpMonth,
      options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
    { label: t("filter_source"),   value: upSource,   onChange: setUpSource,
      options: effectiveSources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; }) },
    { label: t("filter_structure"),value: upStructure,onChange: setUpStructure,
      options: effectiveStructures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; }) },
{ label: t("filter_company"),  value: upCompany,  onChange: setUpCompany,
      options: effectiveCompanies.map(c => {
        const v = typeof c === "object"
          ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
          : String(c);
        const l = typeof c === "object"
          ? (c.companyLegalName ?? c.CompanyLegalName ?? v)
          : String(c);
        return { value: v, label: l };
      }) },
{ label: t("filter_dim_group"), multiselect: true, values: upDimGroups,
  onChange: vs => { setUpDimGroups(vs); setUpDimensions(null); },
  options: dimGroups.map(g => ({ value: g, label: g })) },
{ label: t("filter_dims"), multiselect: true, values: upDimensions,
  onChange: setUpDimensions,
  options: filteredDims.map(d => {
    const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d);
    const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d);
    return { value: v, label: l };
  }) },
  ]}
periodToggle={!viewsMode && activeTab === "pl" ? {
    value: ytdOnly ? "ytd" : "monthly",
    onChange: (next) => setYtdOnly(next === "ytd"),
  } : null}
compareToggle={
    viewsMode ? null :
activeTab === "pl" ? {
      active: compareMode,
      disabled: plHistoryExpanded,
      onChange: () => {
        if (plHistoryExpanded) return;
        if (!compareMode) {
          setCmpYear(upYear); setCmpMonth(upMonth); setCmpSource(upSource);
          setCmpStructure(upStructure); setCmpCompany(upCompany);
          setCmpDimGroups(upDimGroups); setCmpDimensions(upDimensions);
          setCmp2Year(upYear); setCmp2Month(upMonth); setCmp2Source(upSource);
          setCmp2Structure(upStructure); setCmp2Company(upCompany);
          setCmp2DimGroups(upDimGroups); setCmp2Dimensions(upDimensions);
        }
        setCompareMode(c => !c);
      },
    } : activeTab === "bs" ? {
      active: bsCompareMode,
      disabled: bsHistoryExpanded,
      onChange: () => {
        if (bsHistoryExpanded) return;
        if (!bsCompareMode) {
          setBsCmpYear(String(upYear)); setBsCmpMonth(String(upMonth));
          setBsCmpSource(upSource); setBsCmpStructure(upStructure); setBsCmpCompany(upCompany);
          setBsCmp2Year(String(upYear)); setBsCmp2Month(String(upMonth));
          setBsCmp2Source(upSource); setBsCmp2Structure(upStructure); setBsCmp2Company(upCompany);
        }
        setBsCompareMode(c => !c);
      },
    } : null
  }
fabActions={viewsMode ? undefined : [
{
      id: "views",
      icon: Eye,
      label: t("btn_views"),
      onClick: () => setViewsMode("landing"),
    },
    ...((activeTab === "pl" || activeTab === "bs") ? [{
      id: "export",
      icon: Download,
      label: t("btn_export"),
      subActions: [
        {
          id: "excel",
          label: t("export_excel"),
          src: "https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png",
          alt: "Excel",
          onClick: () => { setExportOpts(o => ({ ...o, format: "xlsx" })); setExportModal(true); },
        },
{
          id: "pdf",
          label: t("export_pdf"),
          src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png",
          alt: "PDF",
          onClick: () => { setExportOpts(o => ({ ...o, format: "pdf" })); setExportModal(true); },
        },
      ],
    }] : [])
  ]}
/>


{activeMapping && (
  <div className="flex items-center gap-2 mt-3 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm">
    <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
<span className="text-xs text-emerald-700 font-medium">
      {t("mapping_active_label")}: <strong className="font-black">{activeMapping.name}</strong>
      <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
    </span>
    <button
      onClick={() => setActiveMapping(null)}
      className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
      title={t("clear_mapping_title")}
    >
      <X size={11} />
      {t("btn_clear")}
    </button>
  </div>
)}
<div className="flex-1 scrollbar-hide" style={{ marginTop: 12, minHeight: 0, display: "flex", flexDirection: "column", overflow: "visible", position: "relative" }}>

{!dashReady && !viewsMode && (
  <div
    className="absolute inset-0 z-[100] flex items-center justify-center rounded-2xl"
    style={{
      background: "rgba(255,255,255,0.78)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      animation: "indOverlayFadeIn 200ms ease-out",
    }}
  >
    <div
      className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
      style={{
        width: 380,
        boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)",
        animation: "indPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)",
      }}
    >
<div className="relative" style={{ width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
          <circle
            cx="70" cy="70" r="60" fill="none"
            stroke="url(#indProgGrad)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 60}
            strokeDashoffset={2 * Math.PI * 60 * (1 - animatedDashProgress / 100)}
            style={{
              transform: "rotate(-90deg)",
              transformOrigin: "70px 70px",
            }}
          />
          <defs>
            <linearGradient id="indProgGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
              <stop offset="100%" stopColor={colors.secondary ?? "#CF305D"} />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
            {Math.round(animatedDashProgress)}<span className="text-base text-gray-300">%</span>
          </span>
        </div>
      </div>
      <p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
{probingPeriod
          ? t("loading_overlay_period")
          : effectiveSources.length === 0 || effectiveStructures.length === 0 || effectiveCompanies.length === 0
            ? t("loading_overlay_filters")
            : grpData.length === 0
              ? t("loading_overlay_group_accounts")
              : upData.length === 0
                ? t("loading_overlay_current")
                : t("loading_overlay_finish")}
      </p>
<p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
        {t("loading_overlay_subtitle")}
      </p>
    </div>
    <style>{`
      @keyframes indOverlayFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes indPopIn {
        0%   { opacity: 0; transform: scale(0.92) translateY(8px); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }
    `}</style>
  </div>
)}

{viewsMode ? (
  <div className="flex-1 flex flex-col min-h-0">
    <style>{`
      @keyframes floatOrb1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
      @keyframes floatOrb2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
      @keyframes floatOrb3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(25px,15px) scale(1.05); } }
      @keyframes spinSlow  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes spinSlowR { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
      @keyframes pulseDot  { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.4); } }
    `}</style>



    {/* Landing: two cards */}
    {viewsMode === "landing" && (
      <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
        <button onClick={() => setViewsMode("structure")}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col"
          style={{ background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18)" }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute" style={{ top: "15%", right: "10%", width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, #1a2f8a18 0%, transparent 70%)", animation: "floatOrb1 8s ease-in-out infinite" }} />
            <div className="absolute" style={{ bottom: "10%", right: "25%", width: 100, height: 100, borderRadius: "50%", background: "radial-gradient(circle, #3b54b820 0%, transparent 70%)", animation: "floatOrb2 11s ease-in-out 2s infinite" }} />
            <svg className="absolute" style={{ top: "8%", right: "8%", width: 180, height: 180, opacity: 0.07 }}>
              <circle cx="90" cy="90" r="70" fill="none" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlow 30s linear infinite", transformOrigin: "90px 90px" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke="#1a2f8a" strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlowR 20s linear infinite", transformOrigin: "90px 90px" }} />
            </svg>
            <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#1a2f8a0d 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
          </div>
          <div className="relative z-10 flex flex-col h-full p-8">
            <div className="mb-auto">
              <div className="mb-6 relative w-16 h-16">
                <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#1a2f8a", filter: "blur(12px)", transform: "translateY(4px)" }} />
                <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                  <Layers size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<p className="font-black text-xl text-gray-800 mb-2">{t("views_structure_mappings")}</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{t("views_structure_description")}</p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">{["PGC", "Spanish IFRS", "Danish IFRS"].map(tag => <span key={tag} className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider" style={{ background: "#1a2f8a15", color: "#1a2f8a" }}>{tag}</span>)}</div>
              <span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#1a2f8a" }}>{t("btn_open_arrow")}</span>
            </div>
          </div>
        </button>

        <button onClick={() => setViewsMode("report")}
          className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#CF305D] flex flex-col"
          style={{ background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)", boxShadow: "0 8px 32px -8px rgba(207,48,93,0.18)" }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute" style={{ top: "15%", right: "10%", width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, #CF305D18 0%, transparent 70%)", animation: "floatOrb2 9s ease-in-out infinite" }} />
            <div className="absolute" style={{ bottom: "10%", right: "25%", width: 100, height: 100, borderRadius: "50%", background: "radial-gradient(circle, #e0558520 0%, transparent 70%)", animation: "floatOrb1 12s ease-in-out 1s infinite" }} />
            <svg className="absolute" style={{ top: "8%", right: "8%", width: 180, height: 180, opacity: 0.07 }}>
              <circle cx="90" cy="90" r="70" fill="none" stroke="#CF305D" strokeWidth="1" strokeDasharray="8 6" style={{ animation: "spinSlowR 25s linear infinite", transformOrigin: "90px 90px" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke="#CF305D" strokeWidth="0.8" strokeDasharray="4 8" style={{ animation: "spinSlow 18s linear infinite", transformOrigin: "90px 90px" }} />
            </svg>
            <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#CF305D0d 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
          </div>
          <div className="relative z-10 flex flex-col h-full p-8">
            <div className="mb-auto">
              <div className="mb-6 relative w-16 h-16">
                <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: "#CF305D", filter: "blur(12px)", transform: "translateY(4px)" }} />
                <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(145deg, #CF305D 0%, #e05585 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)" }}>
                  <FileText size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
              <p className="font-black text-xl text-gray-800 mb-2">Report Mappings</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">Define custom report templates and layouts. Control which sections, KPIs, and account groups appear in your financial reports.</p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider" style={{ background: "#CF305D15", color: "#CF305D" }}>Coming soon</span>
              <span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#CF305D" }}>Preview →</span>
            </div>
          </div>
        </button>
      </div>
    )}

    {/* Report: coming soon */}
    {viewsMode === "report" && (
      <div className="flex-1 flex items-center justify-center bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="text-center">
          <p className="text-5xl mb-3">🚧</p>
          <p className="text-base font-black text-gray-300">Coming soon</p>
        </div>
      </div>
    )}

    {/* Structure: library */}
    {viewsMode === "structure" && (
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Library</p>
            <p className="font-black text-xs text-gray-700">Saved mappings</p>
          </div>
          {activeMapping && (
            <button onClick={() => { setActiveMapping(null); setViewsMode(null); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors">
              <X size={10} /> Clear active
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {mappingsLoading && (
            <div className="py-16 text-center">
              <Loader2 size={24} className="text-[#1a2f8a] animate-spin mx-auto mb-2" />
              <p className="text-gray-400 text-xs">Loading mappings…</p>
            </div>
          )}

          {mappingsError && !mappingsLoading && (
            <div className="py-12 text-center">
              <AlertCircle size={20} className="text-red-400 mx-auto mb-2" />
              <p className="text-red-500 text-xs font-bold">{mappingsError}</p>
              <button onClick={fetchSavedMappings} className="mt-2 text-xs text-[#1a2f8a] underline font-bold">Retry</button>
            </div>
          )}

          {!mappingsLoading && !mappingsError && savedMappings.length === 0 && (
            <div className="py-16 text-center">
              <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Library size={24} className="text-[#1a2f8a]" />
              </div>
              <p className="text-gray-700 font-black text-sm mb-1">No saved mappings yet</p>
              <p className="text-gray-400 text-xs">Create one from the Mappings page in the sidebar.</p>
            </div>
          )}

          {!mappingsLoading && !mappingsError && savedMappings.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {savedMappings.map(m => {
                const isActive = activeMapping?.mapping_id === m.mapping_id;
                return (
                  <button key={m.mapping_id}
                    onClick={() => { handleApplyMapping(m); setViewsMode(null); }}
                    className="text-left bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md group flex flex-col"
                    style={{ borderColor: isActive ? colors.primary : "#f3f4f6", background: isActive ? `${colors.primary}06` : "white" }}>
                    <div className="flex items-start gap-2.5 mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: isActive ? colors.primary : "#eef1fb" }}>
                        <Layers size={14} style={{ color: isActive ? "white" : colors.primary }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-black text-xs text-gray-800 truncate">{m.name ?? "Untitled"}</p>
                          {isActive && (
                            <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: colors.primary, color: "white" }}>Active</span>
                          )}
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: colors.primary }}>{m.standard ?? "—"}</p>
                      </div>
                    </div>
                    {m.description && <p className="text-[10px] text-gray-500 mb-2 line-clamp-2">{m.description}</p>}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                      <span className="text-[9px] text-gray-400">Updated {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white shadow-sm transition-all">
                        <CheckCircle2 size={9} />Apply
                      </span>
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
  <>
{activeTab === "pl" && (() => {
  const filteredUpData = upData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
  const hasDimFilter = (Array.isArray(upDimGroups) && upDimGroups.length > 0) || (Array.isArray(upDimensions) && upDimensions.length > 0);

  // Build a set of accountCodes that belong to P/L or DIS in groupAccounts
  const plCodes = new Set();
  grpData.forEach(g => {
    const code = String(g.accountCode ?? g.AccountCode ?? "");
    const type = String(g.accountType ?? g.AccountType ?? "");
    if (code && (type === "P/L" || type === "DIS")) plCodes.add(code);
  });
  // Check if any filtered row maps to a P/L account
  const hasPlRows = filteredUpData.some(r => plCodes.has(String(r.accountCode ?? r.AccountCode ?? "")));

  const dimEmpty = hasDimFilter && upData.length > 0 && !hasPlRows;
  console.log("[PL EMPTY CHECK]", { groups: upDimGroups, dims: upDimensions, hasDimFilter, upDataLen: upData.length, filteredLen: filteredUpData.length, hasPlRows, dimEmpty });

if (dimEmpty) {
    return (
      <div key={`pl-${animKey}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: 0 }}>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl"
          style={{ width: 440, padding: "48px 36px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: `${colors.primary}10`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Filter size={22} style={{ color: colors.primary }} />
          </div>
<p style={{ fontSize: 15, fontWeight: 800, color: "#1f2937", marginBottom: 6 }}>
            {t("no_pl_match_filter")}
          </p>
          <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5, maxWidth: 320, marginBottom: 20 }}>
            {t("no_pl_match_filter_desc")}
          </p>
          <button onClick={() => handleTabChange("bs")}
            style={{
              padding: "8px 16px", borderRadius: 10, fontSize: 11, fontWeight: 900,
              textTransform: "uppercase", letterSpacing: "0.08em",
              background: colors.primary, color: "white",
              boxShadow: `0 4px 12px -2px ${colors.primary}60`,
              transition: "transform 200ms ease",
            }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
            {t("try_bs_arrow")}
          </button>
          <button onClick={() => { setUpDimGroups(null); setUpDimensions(null); }}
            style={{
              marginTop: 12, fontSize: 10, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: "#9ca3af", transition: "color 180ms ease",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "#4b5563"}
            onMouseLeave={e => e.currentTarget.style.color = "#9ca3af"}>
            {t("clear_dim_filter")}
          </button>
        </div>
      </div>
    );
  }

  return (
<div key={`pl-${animKey}`} className="tab-content" style={{ "--slide-from": TAB_ORDER.indexOf("pl") > TAB_ORDER.indexOf(prevTab ?? "pl") ? "30px" : "-30px" }}>
<PLStatement
  externalExpandedMap={plExpandedMap}
  externalSetExpandedMap={setPlExpandedMap}
  token={token}
  upDimGroups={upDimGroups}
  upDimensions={upDimensions}
  onHistoryExpandedChange={setPlHistoryExpanded}
  ytdOnly={ytdOnly}
  dimensionActive={(upDimGroups?.length > 0) || (upDimensions?.length > 0)}
  groupAccounts={grpData}
  dimensions={effectiveDimensions}
  dimensions={effectiveDimensions}
uploadedAccounts={upData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions))}
prevUploadedAccounts={prevData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions))}
  compareMode={compareMode}
  onToggleCompare={() => {
    if (!compareMode) {
      setCmpYear(upYear);
      setCmpMonth(upMonth);
      setCmpSource(upSource);
      setCmpStructure(upStructure);
      setCmpCompany(upCompany);
      setCmpDimGroup(upDimGroup);
      setCmpDimension(upDimension);
      setCmp2Year(upYear);
      setCmp2Month(upMonth);
      setCmp2Source(upSource);
      setCmp2Structure(upStructure);
      setCmp2Company(upCompany);
      setCmp2DimGroup(upDimGroup);
      setCmp2Dimension(upDimension);

    }
    setCompareMode(c => !c);
  }}
cmpUploadedAccounts={cmpData.filter(r => rowMatchesDimMulti(r, cmpDimGroups, cmpDimensions))}
  cmpPrevUploadedAccounts={cmpPrevData.filter(r => rowMatchesDimMulti(r, cmpDimGroups, cmpDimensions))}
cmpFilters={{
    year: cmpYear,
    month: cmpMonth,
    source: cmpSource,
    structure: cmpStructure,
    company: cmpCompany,
    dimGroups: cmpDimGroups,
    dimensions: cmpDimensions,
  }}
  onCmpFilterChange={(key, val) => {
    if (key === "year")      setCmpYear(val);
    if (key === "month")     setCmpMonth(val);
    if (key === "source")    setCmpSource(val);
    if (key === "structure") setCmpStructure(val);
    if (key === "company")   setCmpCompany(val);
    if (key === "dimGroups")  { setCmpDimGroups(val); setCmpDimensions(null); }
    if (key === "dimensions") setCmpDimensions(val);
  }}

 sources={effectiveSources}
  structures={effectiveStructures}
   companies={effectiveCompanies}
  dimGroups={dimGroups}
  cmpFilteredDims={cmpFilteredDims}
cmp2UploadedAccounts={cmp2Data.filter(r => rowMatchesDimMulti(r, cmp2DimGroups, cmp2Dimensions))}
  cmp2PrevUploadedAccounts={cmp2PrevData.filter(r => rowMatchesDimMulti(r, cmp2DimGroups, cmp2Dimensions))}
  cmp2Filters={{
    year: cmp2Year, month: cmp2Month, source: cmp2Source,
    structure: cmp2Structure, company: cmp2Company,
    dimGroups: cmp2DimGroups, dimensions: cmp2Dimensions,
  }}
  onCmp2FilterChange={(key, val) => {
    if (key === "year")      setCmp2Year(val);
    if (key === "month")     setCmp2Month(val);
    if (key === "source")    setCmp2Source(val);
    if (key === "structure") setCmp2Structure(val);
    if (key === "company")   setCmp2Company(val);
    if (key === "dimGroups")  { setCmp2DimGroups(val); setCmp2Dimensions(null); }
    if (key === "dimensions") setCmp2Dimensions(val);
  }}
  cmp2FilteredDims={cmp2FilteredDims}
  cmp2Enabled={plCmp2Enabled}
  onCmp2EnabledChange={setPlCmp2Enabled}
    loading={probingPeriod || (anyLoading && (!upData.length || !grpData.length))}

  error={upError || grpError || null}
  month={upMonth}
  year={upYear}
  source={upSource}
  structure={upStructure}
journalEntries={jrnData}
journalEntriesCmp={jrnCmpData}
journalEntriesCmp2={jrnCmp2Data}
  breakers={breakers}
pgcMapping={activeMapping?.plConverted ?? pgcMapping ?? danishIfrsPlMapping ?? spanishIfrsEsPlMapping}
savedPlLiteral={activeMapping?.plLiteral ?? null}
savedHighlightedIds={activeMapping?.highlightedIds ?? null}
/>
</div>
);
})()}

{/* ── BALANCE SHEET */}
{activeTab === "bs" && (() => {
  const filteredUpData = upData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
  const hasDimFilter = (Array.isArray(upDimGroups) && upDimGroups.length > 0) || (Array.isArray(upDimensions) && upDimensions.length > 0);

  const bsCodes = new Set();
  grpData.forEach(g => {
    const code = String(g.accountCode ?? g.AccountCode ?? "");
    const type = String(g.accountType ?? g.AccountType ?? "");
    if (code && type === "B/S") bsCodes.add(code);
  });
  const hasBsRows = filteredUpData.some(r => bsCodes.has(String(r.accountCode ?? r.AccountCode ?? "")));

  const dimEmpty = hasDimFilter && upData.length > 0 && !hasBsRows;

  if (dimEmpty) {
    return (
      <div key={`bs-${animKey}`} className="tab-content">
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center shadow-xl flex flex-col items-center justify-center" style={{ minHeight: 400 }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${colors.primary}10` }}>
            <Filter size={26} style={{ color: colors.primary }} />
          </div>
<p className="text-base font-black text-gray-700 mb-2">{t("no_bs_match_filter")}</p>
          <p className="text-xs text-gray-400 max-w-md leading-relaxed">
            {t("no_bs_match_filter_desc")}
          </p>
          <button onClick={() => handleTabChange("pl")}
            className="mt-5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all hover:scale-105"
            style={{ background: colors.primary, color: "white", boxShadow: `0 4px 12px -2px ${colors.primary}60` }}>
            {t("try_pl_arrow")}
          </button>
          <button onClick={() => { setUpDimGroups(null); setUpDimensions(null); }}
            className="mt-2 text-[10px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest">
            {t("clear_dim_filter")}
          </button>
        </div>
      </div>
    );
  }

  return (
<div key={`bs-${animKey}`} className="tab-content" style={{ "--slide-from": TAB_ORDER.indexOf("bs") > TAB_ORDER.indexOf(prevTab ?? "bs") ? "30px" : "-30px" }}>
<BalanceSheet
  externalBsDrillMap={bsDrillMap}
  externalSetBsDrillMap={setBsDrillMap}
  onHistoryExpandedChange={setBsHistoryExpanded}
dimensionActive={(upDimGroups?.length > 0) || (upDimensions?.length > 0)}
upDimensions={upDimensions}
upDimGroups={upDimGroups}
  filteredDims={filteredDims}
  groupAccounts={grpData}
  dimensions={effectiveDimensions}
  dimensions={effectiveDimensions}
uploadedAccounts={upData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions))}
  loading={probingPeriod || (anyLoading && (!upData.length || !grpData.length))}
  error={upError || grpError || null}
  month={upMonth}
  year={upYear}
  source={upSource}
  structure={upStructure}
  company={upCompany}
   sources={effectiveSources}
  structures={effectiveStructures}
   companies={effectiveCompanies}
  dimGroups={dimGroups}
  journalEntries={jrnData}
  token={token}
  onCompareChange={(mode, filters1, data1, filters2, data2) => {
    setBsCompareMode(mode);
    setBsCmpYear(filters1?.year??""); setBsCmpMonth(filters1?.month??"");
    setBsCmpSource(filters1?.source??""); setBsCmpStructure(filters1?.structure??"");
    setBsCmpCompany(filters1?.company??"");
    setBsCmpData(data1??[]);
    setBsCmp2Year(filters2?.year??""); setBsCmp2Month(filters2?.month??"");
    setBsCmp2Source(filters2?.source??""); setBsCmp2Structure(filters2?.structure??"");
    setBsCmp2Company(filters2?.company??"");
    setBsCmp2Data(data2??[]);
  }}
  compareMode={bsCompareMode} setCompareMode={setBsCompareMode}
  cmpYear={bsCmpYear} setCmpYear={setBsCmpYear}
  cmpMonth={bsCmpMonth} setCmpMonth={setBsCmpMonth}
  cmpSource={bsCmpSource} setCmpSource={setBsCmpSource}
  cmpStructure={bsCmpStructure} setCmpStructure={setBsCmpStructure}
  cmpCompany={bsCmpCompany} setCmpCompany={setBsCmpCompany}
  cmpData={bsCmpData} setCmpData={setBsCmpData}
  cmp2Year={bsCmp2Year} setCmp2Year={setBsCmp2Year}
  cmp2Month={bsCmp2Month} setCmp2Month={setBsCmp2Month}
  cmp2Source={bsCmp2Source} setCmp2Source={setBsCmp2Source}
  cmp2Structure={bsCmp2Structure} setCmp2Structure={setBsCmp2Structure}
  cmp2Company={bsCmp2Company} setCmp2Company={setBsCmp2Company}
  cmp2Data={bsCmp2Data} setCmp2Data={setBsCmp2Data}
externalCmp2Enabled={bsCmp2Enabled}
  onBsCmp2EnabledChange={setBsCmp2Enabled}
  bsCmpDimGroups={bsCmpDimGroups} setBsCmpDimGroups={setBsCmpDimGroups}
  bsCmpDimensions={bsCmpDimensions} setBsCmpDimensions={setBsCmpDimensions}
  bsCmp2DimGroups={bsCmp2DimGroups} setBsCmp2DimGroups={setBsCmp2DimGroups}
  bsCmp2Dimensions={bsCmp2Dimensions} setBsCmp2Dimensions={setBsCmp2Dimensions}
  effectiveDimensions={effectiveDimensions}
breakers={breakers}
pgcBsMapping={activeMapping?.bsConverted ?? pgcBsMapping ?? danishIfrsBsMapping ?? spanishIfrsEsBsMapping}
savedBsLiteral={activeMapping?.bsLiteral ?? null}
savedHighlightedIds={activeMapping?.highlightedIds ?? null}
/>
</div>
);
})()}

      {/* ── UPLOADED ACCOUNTS */}
{activeTab === "uploaded" && (
<div key={`uploaded-${animKey}`} className="tab-content" style={{ "--slide-from": TAB_ORDER.indexOf("uploaded") > TAB_ORDER.indexOf(prevTab ?? "uploaded") ? "30px" : "-30px" }}>
<div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>


<div style={{ display: dataSubTab === "uploaded" ? "block" : "none" }}>
  {upError && <ErrorBox error={upError} onRetry={handleLoadUploaded} />}
{upFetched && !upError && (
  <DataTable
    data={upData}
    hiddenCols={UPLOADED_HIDDEN}
    search={upSearch}
    setSearch={setUpSearch}
    onRefresh={handleLoadUploaded}
    leftControls={dataSubTabSelector}
  />
)}
</div>

<div style={{ display: dataSubTab === "mapped" ? "block" : "none" }}>
  {mapError && <ErrorBox error={mapError} onRetry={fetchMapped} />}
  {mapFetched && !mapError && (
  <DataTable
    data={mapData}
    hiddenCols={new Set()}
    search={mapSearch}
    setSearch={setMapSearch}
    onRefresh={fetchMapped}
    leftControls={dataSubTabSelector}
  />
)}
</div>

<div style={{ display: dataSubTab === "group" ? "block" : "none" }}>
  {grpError && <ErrorBox error={grpError} onRetry={fetchGroup} />}
  {grpFetched && !grpError && (
  <DataTable
    data={grpData}
    hiddenCols={new Set()}
    search={grpSearch}
    setSearch={setGrpSearch}
    onRefresh={fetchGroup}
    leftControls={dataSubTabSelector}
  />
)}
</div>
<div style={{ display: dataSubTab === "journal" ? "block" : "none" }}>
  {jrnError && <ErrorBox error={jrnError} onRetry={fetchJournal} />}
  {jrnFetched && !jrnError && (
  <DataTable
    data={jrnData}
    hiddenCols={new Set()}
    search={jrnSearch}
    setSearch={setJrnSearch}
    onRefresh={fetchJournal}
    leftControls={dataSubTabSelector}
  />
)}
</div>

<div style={{ display: dataSubTab === "report" ? "block" : "none" }}>
  <div className="flex items-center gap-3 flex-wrap">
    {dataSubTabSelector}
  </div>
  {dataSubTab === "report" && (
    <FinancialReport
      groupAccounts={grpData}
  dimensions={effectiveDimensions}
  dimensions={effectiveDimensions}
      uploadedAccounts={upData}
      loading={probingPeriod || (anyLoading && (!upData.length || !grpData.length))}
      error={upError || grpError || null}
    />
  )}
</div>
</div>
      </div>
)}

</>
)}

    </div>
    </div>
  );
});
export default AccountsDashboard;