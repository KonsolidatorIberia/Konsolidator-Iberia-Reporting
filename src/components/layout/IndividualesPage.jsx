import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from "react";
import { useCurrentUserResourceAccess } from "../../lib/userPermissionsApi";
import {
  FileText, Search, Loader2, AlertCircle, Filter,
  ChevronDown, ChevronRight, Hash, Download, Calendar, Database, Network,
  RefreshCw, X, GitMerge, BookOpen, Upload, BarChart2, TrendingUp,
  CheckCircle2, Eye, Library, Layers, Pencil,
} from "lucide-react";
import { useSettings, useTypo, useT, useLocale } from "./SettingsContext.jsx";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";
import ReactDOM from "react-dom";
import { createPortal } from "react-dom";
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

function buildCompanyFilter(companies) {
  const arr = Array.isArray(companies) ? companies : (companies ? [companies] : []);
  if (arr.length === 0) return "";
  if (arr.length === 1) return `CompanyShortName eq '${arr[0]}'`;
  return `(${arr.map(c => `CompanyShortName eq '${c}'`).join(" or ")})`;
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
          <table className="w-full k-sticky-table">
<thead>
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
function buildTree(groupAccounts, uploadedAccounts) {
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
    // Always attach postings to their matching group account, even sum-flagged ones.
    // sumNode handles roll-up correctly via children recursion.

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

  // Any node with children acts as a sum: own postings + all descendants.
  // Matches the mapper's amountsByCode walk-up behavior.
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
  const t = useT();
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

function PLAmountCell({ value, divider, typoStyle, centered = true }) {
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
<td className={`py-3 whitespace-nowrap tabular-nums ${centered ? "text-center px-4" : "pl-8 pr-6 text-right"}`} style={{ ...style, width: "140px" }}>
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
  t = (k) => k, MONTHS: MONTHS_T = MONTHS,
}) {
  async function doGenerate(ExcelJS) {
    const monthLabel  = MONTHS_T.find(m => String(m.value) === String(month))?.label ?? month;
    const cmpMoLabel  = MONTHS_T.find(m => String(m.value) === String(cmpFilters?.month))?.label ?? cmpFilters?.month;
    const cmp2MoLabel = MONTHS_T.find(m => String(m.value) === String(cmp2Filters?.month))?.label ?? cmp2Filters?.month;

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
     r1.getCell(1).value = `${t("page_pl_full")} — ${sheetTitle}`;
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
          { col: 1, span: 1, label: "",                              fill: LIGHT,   font: NAVY },
          { col: 2, span: 1, label: `${t("pl_monthly")} A`,           fill: LIGHT,   font: NAVY },
          { col: 3, span: 3, label: `B: ${cmpMoLabel} ${cmpFilters?.year}`,  fill: "FFCF305D", font: "FFFFFFFF" },
          { col: 6, span: 3, label: `C: ${cmp2MoLabel} ${cmp2Filters?.year}`, fill: "FF57AA78", font: "FFFFFFFF" },
          { col: 9, span: 1, label: `${t("pl_ytd")} A`,               fill: LIGHT,   font: NAVY },
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
const hdrs = [t("col_account"), `${t("pl_monthly")} A`, `${t("pl_monthly")} B`, `${t("pl_monthly")} Δ`, `${t("pl_monthly")} Δ%`, `${t("pl_monthly")} C`, `${t("pl_monthly")} Δ`, `${t("pl_monthly")} Δ%`,
                       `${t("pl_ytd")} A`, `${t("pl_ytd")} B`, `${t("pl_ytd")} Δ`, `${t("pl_ytd")} Δ%`, `${t("pl_ytd")} C`, `${t("pl_ytd")} Δ`, `${t("pl_ytd")} Δ%`];
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
      ws.addRow([t("col_account"), t("pl_monthly"), t("pl_ytd")]);
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

buildSheet(summaryData,  t("view_summary"));
    buildSheet(detailedData, t("view_detailed"));

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
    .catch(e => alert(t("error_load_excel_lib") + ": " + e.message));
}
function generatePLPdf({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
  month, year, source, structure,
  summaryRows,
  t = (k) => k, MONTHS: MONTHS_T = MONTHS,
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

const monthLabel  = MONTHS_T.find(m => String(m.value) === String(month))?.label ?? month;
    const cmpMoLabel  = MONTHS_T.find(m => String(m.value) === String(cmpFilters?.month))?.label ?? cmpFilters?.month;
    const cmp2MoLabel = MONTHS_T.find(m => String(m.value) === String(cmp2Filters?.month))?.label ?? cmp2Filters?.month;

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
      doc.text(t("page_pl_full").toUpperCase(), 12, 14);

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
     doc.text(`${t("export_generated")} ${new Date().toLocaleDateString()}`, rightX, 22, { align: "right" });

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
      doc.text(t("page_pl_full").toUpperCase(), 10, H - 4.5);

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
      { header: t("col_account").toUpperCase(),   dataKey: "name" },
      { header: t("pl_monthly").toUpperCase(),    dataKey: "mainVal" },
      { header: `${t("pl_monthly").toUpperCase()} B`, dataKey: "bVal" },
      { header: "Δ",         dataKey: "bDev" },
      { header: "Δ %",       dataKey: "bPct" },
      { header: `${t("pl_monthly").toUpperCase()} C`, dataKey: "cVal" },
      { header: "Δ",         dataKey: "cDev" },
      { header: "Δ %",       dataKey: "cPct" },
    ] : [
      { header: t("col_account").toUpperCase(), dataKey: "name" },
      { header: t("pl_monthly").toUpperCase(), dataKey: "mainVal" },
    ];

    const ytdCols = compareMode ? [
      { header: t("col_account").toUpperCase(), dataKey: "name" },
      { header: t("pl_ytd").toUpperCase(),     dataKey: "mainVal" },
      { header: `${t("pl_ytd").toUpperCase()} B`,   dataKey: "bVal" },
      { header: "Δ",       dataKey: "bDev" },
      { header: "Δ %",     dataKey: "bPct" },
      { header: `${t("pl_ytd").toUpperCase()} C`,   dataKey: "cVal" },
      { header: "Δ",       dataKey: "cDev" },
      { header: "Δ %",     dataKey: "cPct" },
    ] : [
      { header: t("col_account").toUpperCase(), dataKey: "name" },
      { header: t("pl_ytd").toUpperCase(),     dataKey: "mainVal" },
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
      { section: t("view_summary"),  view: t("pl_monthly"),  data: summaryData,  cols: monCols, isMonthly: true  },
      { section: t("view_summary"),  view: t("pl_ytd"),      data: summaryData,  cols: ytdCols, isMonthly: false },
      { section: t("view_detailed"), view: t("pl_monthly"),  data: detailedData, cols: monCols, isMonthly: true  },
      { section: t("view_detailed"), view: t("pl_ytd"),      data: detailedData, cols: ytdCols, isMonthly: false },
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
    .catch(e => alert(t("error_load_pdf_lib") + ": " + e.message));
}

function generateKonsolidatorXlsx({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
cmp2Enabled = true,
  cmp3UploadedAccounts = [], cmp3PrevUploadedAccounts = [], cmp3Filters = {},
  cmp3Enabled = false,
  bsCompareMode = false,
  bsCmpUploadedAccounts = [], bsCmpFilters = {},
  bsCmp2UploadedAccounts = [], bsCmp2Filters = {},
  bsCmp2Enabled = true,
bsCmp3UploadedAccounts = [], bsCmp3Filters = {},
  bsCmp3Enabled = false,
plHistoryMonths = [],
  bsHistoryMonths = [],
  selectedCompanies = [],
  ytdOnly = false,
savedPlLiteral = null,
  savedBsLiteral = null,
  savedHighlightedIds = null,
  prevUploadedAccountsRaw = [],
  month, year, source, structure,
  aFilters = {},
  companies = [],
  dimensions = [],
journalEntries = [],
  journalEntriesCmp = [],
  journalEntriesCmp2 = [],
  journalEntriesCmp3 = [],
  summaryRows = [],
  breakers = { pl: {}, bs: {}, cf: {} },
  pgcMapping = null,
  pgcBsMapping = null,
  colors = { primary: '#1a2f8a', secondary: '#CF305D', tertiary: '#57aa78' },
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
    const PURPLE    = 'FFA855F7';
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

// Resolve short company code → legal name
    const resolveCompany = (code) => {
      if (!code) return null;
      const lookup = (c) => {
        const m = companies.find(co => {
          const v = typeof co === 'object' ? (co.companyShortName ?? co.CompanyShortName ?? co.company ?? co.Company ?? '') : String(co);
          return String(v) === String(c);
        });
        if (!m || typeof m !== 'object') return c;
        return m.companyLegalName ?? m.CompanyLegalName ?? c;
      };
      return Array.isArray(code) ? code.map(lookup).join(', ') : lookup(code);
    };

    // Resolve dimension codes → list of names
    const resolveDims = (codes) => {
      if (!Array.isArray(codes) || codes.length === 0) return null;
      return codes.map(c => {
        const d = dimensions.find(dd => {
          const v = typeof dd === 'object' ? (dd.dimensionCode ?? dd.DimensionCode ?? dd.code ?? '') : String(dd);
          return String(v) === String(c);
        });
        if (!d || typeof d !== 'object') return c;
        return d.dimensionName ?? d.DimensionName ?? d.name ?? c;
      }).join(', ');
    };

    // Build a complete filter label (month · year · source · structure · company · dim groups · dims)
    const buildFilterLabel = (filters) => {
      if (!filters) return '';
      const mo = MONTHS.find(m => String(m.value) === String(filters.month))?.label ?? filters.month;
      const co = resolveCompany(filters.company);
      const dgTxt = Array.isArray(filters.dimGroups) && filters.dimGroups.length > 0
        ? `Groups: ${filters.dimGroups.join(', ')}` : null;
      const dTxt = resolveDims(filters.dimensions);
      return [
        mo && filters.year ? `${mo} ${filters.year}` : null,
        filters.source,
        filters.structure,
        co,
        dgTxt,
        dTxt ? `Dims: ${dTxt}` : null,
      ].filter(Boolean).join(' · ');
    };

    const aLabel  = buildFilterLabel({
      year:       aFilters?.year       ?? year,
      month:      aFilters?.month      ?? month,
      source:     aFilters?.source     ?? source,
      structure:  aFilters?.structure  ?? structure,
      company:    aFilters?.company,
      dimGroups:  aFilters?.dimGroups,
      dimensions: aFilters?.dimensions,
    });
    const bLabel   = compareMode                                       ? buildFilterLabel(cmpFilters)   : '';
    const cLabel   = compareMode   && cmp2Enabled                      ? buildFilterLabel(cmp2Filters)  : '';
    const dLabel   = compareMode   && cmp2Enabled  && cmp3Enabled      ? buildFilterLabel(cmp3Filters)  : '';
    const bsBLabel = bsCompareMode                                     ? buildFilterLabel(bsCmpFilters) : '';
    const bsCLabel = bsCompareMode && bsCmp2Enabled                    ? buildFilterLabel(bsCmp2Filters): '';
    const bsDLabel = bsCompareMode && bsCmp2Enabled && bsCmp3Enabled   ? buildFilterLabel(bsCmp3Filters): '';

    // ── Trees ─────────────────────────────────────────────────
    const tree      = buildTree(groupAccounts, uploadedAccounts);
    const prevTree  = buildTree(groupAccounts, prevUploadedAccounts);
    const cT        = compareMode ? buildTree(groupAccounts, cmpUploadedAccounts) : [];
    const cPT       = compareMode ? buildTree(groupAccounts, cmpPrevUploadedAccounts) : [];
const c2T       = compareMode && cmp2Enabled ? buildTree(groupAccounts, cmp2UploadedAccounts) : [];
    const c2PT      = compareMode && cmp2Enabled ? buildTree(groupAccounts, cmp2PrevUploadedAccounts) : [];
    const c3T       = compareMode && cmp2Enabled && cmp3Enabled ? buildTree(groupAccounts, cmp3UploadedAccounts) : [];
    const c3PT      = compareMode && cmp2Enabled && cmp3Enabled ? buildTree(groupAccounts, cmp3PrevUploadedAccounts) : [];
    const bsCT      = bsCompareMode ? buildTree(groupAccounts, bsCmpUploadedAccounts) : [];
    const bsC2T     = bsCompareMode && bsCmp2Enabled ? buildTree(groupAccounts, bsCmp2UploadedAccounts) : [];
    const bsC3T     = bsCompareMode && bsCmp2Enabled && bsCmp3Enabled ? buildTree(groupAccounts, bsCmp3UploadedAccounts) : [];

    const nodeMap = t => {
      const m = new Map();
      const w = n => { m.set(n.code, n); n.children?.forEach(w); };
      t.forEach(w);
      return m;
    };
    const pM = nodeMap(prevTree);
    const cM = nodeMap(cT), cPM = nodeMap(cPT);
const c2M = nodeMap(c2T), c2PM = nodeMap(c2PT);
    const c3M = nodeMap(c3T), c3PM = nodeMap(c3PT);
    const bsCM = nodeMap(bsCT), bsC2M = nodeMap(bsC2T), bsC3M = nodeMap(bsC3T);

    const getYtd  = (m, c) => { const n = m.get(c); return n ? sumNode(n) : 0; };
    const getPrev = (m, c, mo) => Number(mo) === 1 ? 0 : getYtd(m, c);
    const devColor = v => !v || v === 0 ? 'FFD1D5DB' : v > 0 ? 'FF059669' : 'FFDC2626';

const jrnByCode = new Map();
    (journalEntries || []).forEach(j => {
      const code = String(j.AccountCode ?? j.accountCode ?? '');
      const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
      if (!code || (jt !== 'AJE' && jt !== 'RJE')) return;
      if (!jrnByCode.has(code)) jrnByCode.set(code, []);
      jrnByCode.get(code).push(j);
    });
    const buildJrnByCode = (entries) => {
      const m = new Map();
      (entries || []).forEach(j => {
        const code = String(j.AccountCode ?? j.accountCode ?? '');
        const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
        if (!code || (jt !== 'AJE' && jt !== 'RJE')) return;
        if (!m.has(code)) m.set(code, []);
        m.get(code).push(j);
      });
      return m;
    };
    const jrnByCodeCmp  = buildJrnByCode(journalEntriesCmp);
    const jrnByCodeCmp2 = buildJrnByCode(journalEntriesCmp2);
    const jrnByCodeCmp3 = buildJrnByCode(journalEntriesCmp3);

    // ── Column layout ─────────────────────────────────────────
// History view replaces compare cols (mutually exclusive)
// History view (dedupe by year+month to prevent duplicate columns)
    const dedupHist = (arr) => {
      const seen = new Set();
      return (arr || []).filter(h => {
        if (!h?.year || !h?.month) return false;
        const k = `${h.year}-${h.month}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    const plHist = dedupHist(plHistoryMonths);
    const bsHist = dedupHist(bsHistoryMonths);
let hasHistoryPL = !compareMode && plHist.length > 0;
    let hasHistoryBS = !bsCompareMode && bsHist.length > 0;

    // Multi-company view: one column per selected company
    const _selectedCo = (typeof selectedCompanies !== 'undefined' && Array.isArray(selectedCompanies)) ? selectedCompanies : [];
    const _ytdOnly = typeof ytdOnly === 'boolean' ? ytdOnly : false;
const hasMultiCo = _selectedCo.length > 1;
    console.log('[Export] multi-co check', { selectedCompanies, _selectedCo, hasMultiCo, ytdOnly: _ytdOnly });
    const getCoF = r => String(getField(r, 'companyShortName', 'CompanyShortName') ?? '');
    const perCoMaps = hasMultiCo ? _selectedCo.map(co => {
      const f = (uploadedAccounts || []).filter(r => getCoF(r) === co);
      const pf = (prevUploadedAccounts || []).filter(r => getCoF(r) === co);
      const legal = (() => {
        const m = (companies || []).find(c => String(typeof c === 'object' ? (c.companyShortName ?? c.CompanyShortName) : c) === co);
        return (m && typeof m === 'object' ? (m.companyLegalName ?? m.CompanyLegalName) : null) ?? co;
      })();
      return { co, legal, map: nodeMap(buildTree(groupAccounts, f)), prevMap: nodeMap(buildTree(groupAccounts, pf)) };
    }) : [];
    console.log('[Export] history check', {
      plHistoryMonthsArg: plHistoryMonths,
      bsHistoryMonthsArg: bsHistoryMonths,
      plHistLength: plHist.length,
      bsHistLength: bsHist.length,
      compareMode, bsCompareMode,
      hasHistoryPL, hasHistoryBS
    });

if (hasMultiCo) { hasHistoryPL = false; hasHistoryBS = false; }
    const hasB  = compareMode && !hasMultiCo;
    const hasC  = compareMode && cmp2Enabled && !hasMultiCo;
    const hasD  = compareMode && cmp2Enabled && cmp3Enabled && !hasMultiCo;
    const bsHasB = bsCompareMode && !hasMultiCo;
    const bsHasC = bsCompareMode && bsCmp2Enabled && !hasMultiCo;
    const bsHasD = bsCompareMode && bsCmp2Enabled && bsCmp3Enabled && !hasMultiCo;

const plHistMaps = hasHistoryPL ? plHist.map(h => {
      const histJrnByCode = new Map();
      (h.journals || []).forEach(j => {
        const code = String(j.AccountCode ?? j.accountCode ?? '');
        const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
        if (!code || (jt !== 'AJE' && jt !== 'RJE')) return;
        if (!histJrnByCode.has(code)) histJrnByCode.set(code, []);
        histJrnByCode.get(code).push(j);
      });
      return {
        year: h.year, month: h.month,
        map: nodeMap(buildTree(groupAccounts, h.data || [])),
        prevMap: nodeMap(buildTree(groupAccounts, h.prevData || [])),
        jrnByCode: histJrnByCode,
      };
    }) : [];
    const bsHistMaps = hasHistoryBS ? bsHist.map(h => ({
      year: h.year, month: h.month,
      map: nodeMap(buildTree(groupAccounts, h.data || [])),
    })) : [];

const PL = { name: 1 };
    let idx = 2;
    if (!hasMultiCo) {
      PL.monA = idx++;
      if (hasB) { PL.monB = idx++; PL.monBD = idx++; PL.monBP = idx++; }
      if (hasC) { PL.monC = idx++; PL.monCD = idx++; PL.monCP = idx++; }
      if (hasD) { PL.monD = idx++; PL.monDD = idx++; PL.monDP = idx++; }
    }
    PL.histMon = [];
    if (hasHistoryPL) plHistMaps.forEach(() => PL.histMon.push(idx++));
    if (!hasMultiCo) {
      PL.ytdA = idx++;
      if (hasB) { PL.ytdB = idx++; PL.ytdBD = idx++; PL.ytdBP = idx++; }
      if (hasC) { PL.ytdC = idx++; PL.ytdCD = idx++; PL.ytdCP = idx++; }
      if (hasD) { PL.ytdD = idx++; PL.ytdDD = idx++; PL.ytdDP = idx++; }
    }
PL.histYtd = [];
    if (hasHistoryPL) plHistMaps.forEach(() => PL.histYtd.push(idx++));
    PL.co = [];
    if (hasMultiCo) perCoMaps.forEach(() => PL.co.push(idx++));
    const plCols = idx - 1;

const BS = { name: 1 };
    let bidx = 2;
    if (!hasMultiCo) {
      BS.act = bidx++;
      if (bsHasB) { BS.cmp = bidx++; BS.cmpD = bidx++; BS.cmpP = bidx++; }
      if (bsHasC) { BS.cmp2 = bidx++; BS.cmp2D = bidx++; BS.cmp2P = bidx++; }
      if (bsHasD) { BS.cmp3 = bidx++; BS.cmp3D = bidx++; BS.cmp3P = bidx++; }
    }
BS.hist = [];
    if (hasHistoryBS) bsHistMaps.forEach(() => BS.hist.push(bidx++));
    BS.co = [];
    if (hasMultiCo) perCoMaps.forEach(() => BS.co.push(bidx++));
    const bsCols = bidx - 1;

const setC = (row, ci, val, fmt, fontColor, bold, fill, align='right') => {
      if (!ci || !Number.isFinite(ci) || !row) return;
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
      r2.getCell(1).value = `A: ${aLabel}`;
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
        if (hasD) parts.push(`D: ${dLabel}`);
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
if (hasD) {
        headers.push([PL.monD, 'MON D', 'right', PURPLE]);
        headers.push([PL.monDD, 'Δ', 'right', PURPLE]);
        headers.push([PL.monDP, 'Δ%', 'right', PURPLE]);
      }
      if (hasHistoryPL) {
        plHistMaps.forEach((h, i) => {
          const moLbl = MONTHS.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3).toUpperCase() ?? String(h.month);
          headers.push([PL.histMon[i], `MON ${moLbl} ${h.year}`, 'right', NAVY_DK]);
        });
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
if (hasD) {
        headers.push([PL.ytdD, 'YTD D', 'right', PURPLE]);
        headers.push([PL.ytdDD, 'Δ', 'right', PURPLE]);
        headers.push([PL.ytdDP, 'Δ%', 'right', PURPLE]);
      }
if (hasHistoryPL) {
        plHistMaps.forEach((h, i) => {
          const moLbl = MONTHS.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3).toUpperCase() ?? String(h.month);
          headers.push([PL.histYtd[i], `YTD ${moLbl} ${h.year}`, 'right', NAVY_DK]);
        });
      }
      if (hasMultiCo) {
        perCoMaps.forEach((c, i) => headers.push([PL.co[i], c.legal, 'right', NAVY]));
      }
headers.filter(h => Array.isArray(h) && Number.isFinite(h[0]) && h[0] > 0).forEach(([ci, lbl, align, fillArgb]) => {
        const c = rh.getCell(ci);
        c.value = lbl;
        c.font = mkFont(true, WHITE, 9);
        c.fill = mkFill(fillArgb);
        c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
        c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
      });

// Widths + grouping on compare columns
      ws.getColumn(PL.name).width = 46;
      if (PL.monA) ws.getColumn(PL.monA).width = 16;
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
if (hasD) {
        [PL.monD, PL.monDD, PL.monDP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === PL.monD ? 16 : ci === PL.monDD ? 13 : 10;
          col.outlineLevel = 3;
        });
      }
     if (hasHistoryPL) PL.histYtd.forEach(ci => { ws.getColumn(ci).width = 15; });
      if (hasMultiCo) PL.co.forEach(ci => { ws.getColumn(ci).width = 20; });
if (PL.ytdA) ws.getColumn(PL.ytdA).width = 16;
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
      if (hasD) {
        [PL.ytdD, PL.ytdDD, PL.ytdDP].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === PL.ytdD ? 16 : ci === PL.ytdDD ? 13 : 10;
          col.outlineLevel = 3;
        });
      }

// ── Build real PL breakers from mapping/Supabase (matches PLStatement.effectiveBreakersPl) ──
      const hexToArgb = (h) => {
        const s = String(h || '').replace('#', '').replace(/^FF/i, '').toUpperCase();
        return /^[0-9A-F]{6}$/.test(s) ? `FF${s}` : DIV_BLUE;
      };
      const paletteArgb = [hexToArgb(colors.primary), hexToArgb(colors.secondary), hexToArgb(colors.tertiary)];

      const buildEffectivePlBreakers = () => {
        // PGC mapping path
        if (pgcMapping?.rows && pgcMapping?.sections) {
          const rowsToScan = isSummary ? summaryRows : (() => {
            const all = [];
            const walk = n => {
              if (!hasData(n) || !['P/L','DIS'].includes(n.accountType)) return;
              (n.children || []).forEach(walk);
              if (n.isSumAccount) all.push(n);
            };
            tree.filter(n => ['P/L','DIS'].includes(n.accountType)).forEach(walk);
            return all.sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}));
          })();
          const seen = new Set();
          const out = {};
          let i = 0;
          for (const node of rowsToScan) {
            const m = pgcMapping.rows.get(String(node.code));
            if (!m) continue;
            if (seen.has(m.section)) continue;
            seen.add(m.section);
            const sec = pgcMapping.sections.get(m.section);
            if (sec) {
              out[String(node.code)] = { label: sec.label, argb: paletteArgb[i] ?? hexToArgb(sec.color) };
              i++;
            }
          }
          return out;
        }
        // Legacy Supabase breakers
        const legacy = breakers.pl ?? {};
        const codes = Object.keys(legacy).sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
        if (codes.length > 0) {
          const out = {};
          codes.forEach((code, i) => {
            out[code] = { label: legacy[code].label, argb: paletteArgb[i] ?? hexToArgb(legacy[code].color) };
          });
          return out;
        }
        // Hardcoded fallback (original behaviour)
        return isAlpha ? {
          'A.04.S': { label: 'INGRESOS',          argb: DIV_BLUE },
          'A.13.S': { label: 'GASTOS OPERATIVOS', argb: DIV_RED  },
          'A.24.S': { label: 'RESULTADO FINAL',   argb: DIV_GRAY },
        } : {
          '11999':  { label: 'INGRESOS',          argb: DIV_BLUE },
          '53999':  { label: 'GASTOS OPERATIVOS', argb: DIV_RED  },
          '89999':  { label: 'RESULTADO FINAL',   argb: DIV_GRAY },
        };
      };

      const SUMMARY_DIV = buildEffectivePlBreakers();

      // For detailed mode, remap the first breaker to the first allSumRows code (matches PLStatement)
      const DETAIL_DIV_BEFORE = (() => {
        const base = buildEffectivePlBreakers();
        const allSumRowsLocal = [];
        const walkSum = n => {
          if (!hasData(n) || !['P/L','DIS'].includes(n.accountType)) return;
          (n.children || []).forEach(walkSum);
          if (n.isSumAccount) allSumRowsLocal.push(n);
        };
        tree.filter(n => ['P/L','DIS'].includes(n.accountType)).forEach(walkSum);
        allSumRowsLocal.sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}));
        if (allSumRowsLocal.length === 0) return base;
        const positions = Object.keys(base)
          .map(code => ({ code, pos: allSumRowsLocal.findIndex(n => String(n.code) === code) }))
          .filter(x => x.pos >= 0)
          .sort((a,b) => a.pos - b.pos);
        if (positions.length === 0) return base;
        const remapped = { ...base };
        const earliest = positions[0];
        const firstCode = String(allSumRowsLocal[0].code);
        if (earliest.code !== firstCode) {
          remapped[firstCode] = remapped[earliest.code];
          delete remapped[earliest.code];
        }
        return remapped;
      })();

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
        const c3Ytd  = hasD ? -getYtd(c3M, node.code) : 0;
        const c3Prev = hasD ? -getPrev(c3PM, node.code, cmp3Filters?.month) : 0;
        const c3Mon  = hasD ? c3Ytd - c3Prev : 0;

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
        const nmTxt = isHighlighted ? (node.name || '').toUpperCase() : (node.name || '');
        if (node.code) {
          nc.value = {
            richText: [
              { text: `${node.code}    `, font: { name: 'Consolas', color: { argb: 'FF9CA3AF' }, size: 9 } },
              { text: nmTxt, font: { name: 'Calibri', color: { argb: nameColor }, size: 10, bold: isBold || isHighlighted } },
            ]
          };
        } else {
          nc.value = nmTxt;
          nc.font = mkFont(isBold || isHighlighted, nameColor, 10);
        }
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
        const dMD  = hasD ? mon - c3Mon : 0;
        const dMDP = hasD && c3Mon !== 0 ? dMD / Math.abs(c3Mon) : null;
        const dYD  = hasD ? ytd - c3Ytd : 0;
        const dYDP = hasD && c3Ytd !== 0 ? dYD / Math.abs(c3Ytd) : null;

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
if (hasD) {
          setC(dr, PL.monD,  c3Mon, NUM_FMT, PURPLE, isBold, bg);
          setC(dr, PL.monDD, dMD,   NUM_FMT, devColor(dMD), isBold, bg);
          setC(dr, PL.monDP, dMDP,  PCT_FMT, devColor(dMD), isBold, bg);
        }
        if (hasHistoryPL) {
          plHistMaps.forEach((h, i) => {
            const hYtd = -getYtd(h.map, node.code);
            const hPrev = -getPrev(h.prevMap, node.code, h.month);
            setC(dr, PL.histMon[i], hYtd - hPrev, NUM_FMT, valueColor, isBold, bg);
          });
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
if (hasD) {
          setC(dr, PL.ytdD,  c3Ytd, NUM_FMT, PURPLE, isBold, bg);
          setC(dr, PL.ytdDD, dYD,   NUM_FMT, devColor(dYD), isBold, bg);
          setC(dr, PL.ytdDP, dYDP,  PCT_FMT, devColor(dYD), isBold, bg);
        }
if (hasHistoryPL) {
          plHistMaps.forEach((h, i) => {
            setC(dr, PL.histYtd[i], -getYtd(h.map, node.code), NUM_FMT, valueColor, isBold, bg);
          });
        }
        if (hasMultiCo) {
          perCoMaps.forEach((c, i) => {
            const ytdC = -getYtd(c.map, node.code);
            const prevC = Number(month) === 1 ? 0 : -getYtd(c.prevMap, node.code);
            const val = _ytdOnly ? ytdC : (ytdC - prevC);
            setC(dr, PL.co[i], val, NUM_FMT, valueColor, isBold, bg);
          });
        }
      };
// Build leaf indexes once for the standard path (LAC → YTD sum)
      const buildLeafIdx = (rows) => {
        const m = new Map();
        (rows || []).forEach(r => {
          const lac = String(getField(r, 'localAccountCode') ?? '');
          if (!lac) return;
          m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
        });
        return m;
      };
      const aPrevLeafIdx = buildLeafIdx(prevUploadedAccounts);
      const bLeafIdx     = hasB ? buildLeafIdx(cmpUploadedAccounts) : new Map();
      const bPrevLeafIdx = hasB ? buildLeafIdx(cmpPrevUploadedAccounts) : new Map();
      const cLeafIdxStd  = hasC ? buildLeafIdx(cmp2UploadedAccounts) : new Map();
      const cPrevLeafIdxStd = hasC ? buildLeafIdx(cmp2PrevUploadedAccounts) : new Map();
      const dLeafIdxStd  = hasD ? buildLeafIdx(cmp3UploadedAccounts) : new Map();
      const dPrevLeafIdxStd = hasD ? buildLeafIdx(cmp3PrevUploadedAccounts) : new Map();
      const perCoLeafIdx = hasMultiCo ? _selectedCo.map(co => ({
        cur:  buildLeafIdx((uploadedAccounts || []).filter(r => getCoF(r) === co)),
        prev: buildLeafIdx((prevUploadedAccounts || []).filter(r => getCoF(r) === co)),
      })) : [];
const plHistLeafIdx = hasHistoryPL ? plHist.map(h => ({
        cur:  buildLeafIdx(h.data || []),
        prev: buildLeafIdx(h.prevData || []),
        month: h.month,
      })) : [];

      // Per-leaf+dim indexes for compare periods (key: "lac|dc")
      const buildLeafDimIdx = (rows) => {
        const m = new Map();
        (rows || []).forEach(r => {
          const lac = String(getField(r, 'localAccountCode') ?? '');
          const dc  = String(getField(r, 'dimensionCode') ?? '');
          if (!lac || !dc || dc === 'null') return;
          const amt = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
          m.set(`${lac}|${dc}`, (m.get(`${lac}|${dc}`) ?? 0) + amt);
        });
        return m;
};

      const writeLeafRow = (leaf, depth, ol) => {
        const amt = leaf.amount ?? 0;
        const bg = LEAF_BG;
        const lac = String(leaf.code ?? '');
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

        const ytdA = -amt;
        const prevA = lac && Number(month) !== 1 ? (aPrevLeafIdx.get(lac) ?? 0) : 0;
        const monA = -(amt - prevA);

        setC(dr, PL.monA, monA, NUM_FMT, TEXT_MUT, false, bg);
        setC(dr, PL.ytdA, ytdA, NUM_FMT, TEXT_MUT, false, bg);

        const dA = (a, b) => a - b;
        const dP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

        if (hasB && lac) {
          const bY = -(bLeafIdx.get(lac) ?? 0);
          const bP = Number(cmpFilters?.month) === 1 ? 0 : -(bPrevLeafIdx.get(lac) ?? 0);
          const bM = bY - bP;
          setC(dr, PL.monB,  bM, NUM_FMT, RED, false, bg);
          const dm = dA(monA, bM); setC(dr, PL.monBD, dm, NUM_FMT, devColor(dm), false, bg);
          setC(dr, PL.monBP, dP(monA, bM), PCT_FMT, devColor(dm), false, bg);
          setC(dr, PL.ytdB,  bY, NUM_FMT, RED, false, bg);
          const dy = dA(ytdA, bY); setC(dr, PL.ytdBD, dy, NUM_FMT, devColor(dy), false, bg);
          setC(dr, PL.ytdBP, dP(ytdA, bY), PCT_FMT, devColor(dy), false, bg);
        }
        if (hasC && lac) {
          const cY = -(cLeafIdxStd.get(lac) ?? 0);
          const cP = Number(cmp2Filters?.month) === 1 ? 0 : -(cPrevLeafIdxStd.get(lac) ?? 0);
          const cM = cY - cP;
          setC(dr, PL.monC,  cM, NUM_FMT, GRN, false, bg);
          const dm = dA(monA, cM); setC(dr, PL.monCD, dm, NUM_FMT, devColor(dm), false, bg);
          setC(dr, PL.monCP, dP(monA, cM), PCT_FMT, devColor(dm), false, bg);
          setC(dr, PL.ytdC,  cY, NUM_FMT, GRN, false, bg);
          const dy = dA(ytdA, cY); setC(dr, PL.ytdCD, dy, NUM_FMT, devColor(dy), false, bg);
          setC(dr, PL.ytdCP, dP(ytdA, cY), PCT_FMT, devColor(dy), false, bg);
        }
        if (hasD && lac) {
          const dY = -(dLeafIdxStd.get(lac) ?? 0);
          const dPV = Number(cmp3Filters?.month) === 1 ? 0 : -(dPrevLeafIdxStd.get(lac) ?? 0);
          const dM = dY - dPV;
          setC(dr, PL.monD,  dM, NUM_FMT, PURPLE, false, bg);
          const dm = dA(monA, dM); setC(dr, PL.monDD, dm, NUM_FMT, devColor(dm), false, bg);
          setC(dr, PL.monDP, dP(monA, dM), PCT_FMT, devColor(dm), false, bg);
          setC(dr, PL.ytdD,  dY, NUM_FMT, PURPLE, false, bg);
          const dy = dA(ytdA, dY); setC(dr, PL.ytdDD, dy, NUM_FMT, devColor(dy), false, bg);
          setC(dr, PL.ytdDP, dP(ytdA, dY), PCT_FMT, devColor(dy), false, bg);
        }
        if (hasHistoryPL && lac) {
          plHistLeafIdx.forEach((h, i) => {
            const hY = -(h.cur.get(lac) ?? 0);
            const hP = Number(h.month) === 1 ? 0 : -(h.prev.get(lac) ?? 0);
            setC(dr, PL.histMon[i], hY - hP, NUM_FMT, TEXT_MUT, false, bg);
            setC(dr, PL.histYtd[i], hY, NUM_FMT, TEXT_MUT, false, bg);
          });
        }
        if (hasMultiCo && lac) {
          perCoLeafIdx.forEach((idx, i) => {
            const ytdC = -(idx.cur.get(lac) ?? 0);
            const prevC = Number(month) === 1 ? 0 : -(idx.prev.get(lac) ?? 0);
            const val = _ytdOnly ? ytdC : (ytdC - prevC);
            setC(dr, PL.co[i], val, NUM_FMT, TEXT_MUT, false, bg);
          });
        }
};
      const aPrevLeafDimIdx = buildLeafDimIdx(prevUploadedAccounts);
      const bLeafDimIdx     = hasB ? buildLeafDimIdx(cmpUploadedAccounts) : new Map();
      const bPrevLeafDimIdx = hasB ? buildLeafDimIdx(cmpPrevUploadedAccounts) : new Map();
      const cLeafDimIdx     = hasC ? buildLeafDimIdx(cmp2UploadedAccounts) : new Map();
      const cPrevLeafDimIdx = hasC ? buildLeafDimIdx(cmp2PrevUploadedAccounts) : new Map();
      const dLeafDimIdx     = hasD ? buildLeafDimIdx(cmp3UploadedAccounts) : new Map();
const dPrevLeafDimIdx = hasD ? buildLeafDimIdx(cmp3PrevUploadedAccounts) : new Map();
      const perCoLeafDimIdx = hasMultiCo ? _selectedCo.map(co =>
        buildLeafDimIdx((uploadedAccounts || []).filter(r => getCoF(r) === co))
      ) : [];
const perCoPrevLeafDimIdx = hasMultiCo ? _selectedCo.map(co =>
        buildLeafDimIdx((prevUploadedAccounts || []).filter(r => getCoF(r) === co))
      ) : [];
      const plHistLeafDimIdx = hasHistoryPL ? plHist.map(h => ({
        month: h.month,
        cur:  buildLeafDimIdx(h.data || []),
        prev: buildLeafDimIdx(h.prevData || []),
      })) : [];

      const writeDimRow = (dim, depth, ol, parentLac) => {
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

        const lac = parentLac ? String(parentLac) : '';
        const dc  = String(dim.code ?? '');
        const key = lac && dc ? `${lac}|${dc}` : null;

        const ytdA = -(dim.amount ?? 0);
        const prevA = key && Number(month) !== 1 ? -(aPrevLeafDimIdx.get(key) ?? 0) : 0;
        const monA = ytdA - prevA;

        setC(dr, PL.monA, monA, NUM_FMT, AMBER, false, bg);
        setC(dr, PL.ytdA, ytdA, NUM_FMT, AMBER, false, bg);

        const dA = (a, b) => a - b;
        const dP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

        if (hasB && key) {
          const bY = -(bLeafDimIdx.get(key) ?? 0);
          const bP = Number(cmpFilters?.month) === 1 ? 0 : -(bPrevLeafDimIdx.get(key) ?? 0);
          const bM = bY - bP;
          setC(dr, PL.monB, bM, NUM_FMT, RED, false, bg);
          const dm = dA(monA, bM); setC(dr, PL.monBD, dm, NUM_FMT, devColor(dm), false, bg);
          setC(dr, PL.monBP, dP(monA, bM), PCT_FMT, devColor(dm), false, bg);
          setC(dr, PL.ytdB, bY, NUM_FMT, RED, false, bg);
          const dy = dA(ytdA, bY); setC(dr, PL.ytdBD, dy, NUM_FMT, devColor(dy), false, bg);
          setC(dr, PL.ytdBP, dP(ytdA, bY), PCT_FMT, devColor(dy), false, bg);
        }
        if (hasC && key) {
          const cY = -(cLeafDimIdx.get(key) ?? 0);
          const cP = Number(cmp2Filters?.month) === 1 ? 0 : -(cPrevLeafDimIdx.get(key) ?? 0);
          const cM = cY - cP;
          setC(dr, PL.monC, cM, NUM_FMT, GRN, false, bg);
          const dm = dA(monA, cM); setC(dr, PL.monCD, dm, NUM_FMT, devColor(dm), false, bg);
          setC(dr, PL.monCP, dP(monA, cM), PCT_FMT, devColor(dm), false, bg);
          setC(dr, PL.ytdC, cY, NUM_FMT, GRN, false, bg);
          const dy = dA(ytdA, cY); setC(dr, PL.ytdCD, dy, NUM_FMT, devColor(dy), false, bg);
          setC(dr, PL.ytdCP, dP(ytdA, cY), PCT_FMT, devColor(dy), false, bg);
        }
if (hasD && key) {
          const dY = -(dLeafDimIdx.get(key) ?? 0);
          const dPV = Number(cmp3Filters?.month) === 1 ? 0 : -(dPrevLeafDimIdx.get(key) ?? 0);
          const dM = dY - dPV;
          setC(dr, PL.monD, dM, NUM_FMT, PURPLE, false, bg);
          const dm = dA(monA, dM); setC(dr, PL.monDD, dm, NUM_FMT, devColor(dm), false, bg);
          setC(dr, PL.monDP, dP(monA, dM), PCT_FMT, devColor(dm), false, bg);
          setC(dr, PL.ytdD, dY, NUM_FMT, PURPLE, false, bg);
          const dy = dA(ytdA, dY); setC(dr, PL.ytdDD, dy, NUM_FMT, devColor(dy), false, bg);
          setC(dr, PL.ytdDP, dP(ytdA, dY), PCT_FMT, devColor(dy), false, bg);
        }
if (hasMultiCo && key) {
          perCoLeafDimIdx.forEach((idx, i) => {
            const ytdC = -(idx.get(key) ?? 0);
            const prevC = Number(month) === 1 ? 0 : -(perCoPrevLeafDimIdx[i]?.get(key) ?? 0);
            const val = _ytdOnly ? ytdC : (ytdC - prevC);
            if (PL.co[i]) setC(dr, PL.co[i], val, NUM_FMT, AMBER, false, bg);
          });
        }
        if (hasHistoryPL && key) {
          plHistLeafDimIdx.forEach((h, i) => {
            const hY = -(h.cur.get(key) ?? 0);
            const hP = Number(h.month) === 1 ? 0 : -(h.prev.get(key) ?? 0);
            setC(dr, PL.histMon[i], hY - hP, NUM_FMT, AMBER, false, bg);
            setC(dr, PL.histYtd[i], hY, NUM_FMT, AMBER, false, bg);
          });
        }
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
        const accCode = String(jrn.AccountCode ?? jrn.accountCode ?? '');
        const jnum = jrn.JournalNumber ?? jrn.journalNumber ?? '';
        const findMatch = (idx) => {
          if (!accCode || jnum === '') return null;
          const m = (idx.get(accCode) || []).find(j => (j.JournalNumber ?? j.journalNumber) === jnum);
          return m ? -parseAmt(m.AmountYTD ?? m.amountYTD ?? 0) : null;
        };
        const bVal = hasB ? findMatch(jrnByCodeCmp) : null;
        const cVal = hasC ? findMatch(jrnByCodeCmp2) : null;
        const dVal = hasD ? findMatch(jrnByCodeCmp3) : null;
        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = 14;
        dr.outlineLevel = Math.min(ol, 7);
        dr.hidden = true;
        const nc = dr.getCell(PL.name);
        const jhdr = jrn.JournalHeader ?? jrn.journalHeader ?? '';
        nc.value = `📄 ${jnum}${jhdr ? ' · ' + jhdr : ''}`;
        nc.font = mkFont(false, INDIGO, 9);
        nc.fill = mkFill(bg);
        nc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 1 };
        nc.border = mkBorder();
        setC(dr, PL.monA, -amt, NUM_FMT, INDIGO, false, bg);
        setC(dr, PL.ytdA, -amt, NUM_FMT, INDIGO, false, bg);
        if (hasB && bVal != null) { setC(dr, PL.monB, bVal, NUM_FMT, INDIGO, false, bg); setC(dr, PL.ytdB, bVal, NUM_FMT, INDIGO, false, bg); }
        if (hasC && cVal != null) { setC(dr, PL.monC, cVal, NUM_FMT, INDIGO, false, bg); setC(dr, PL.ytdC, cVal, NUM_FMT, INDIGO, false, bg); }
        if (hasD && dVal != null) { setC(dr, PL.monD, dVal, NUM_FMT, INDIGO, false, bg); setC(dr, PL.ytdD, dVal, NUM_FMT, INDIGO, false, bg); }
if (hasMultiCo) {
          const jrnCo = String(jrn.CompanyShortName ?? jrn.companyShortName ?? '');
          _selectedCo.forEach((co, i) => {
            const v = jrnCo === co ? -amt : 0;
            if (PL.co[i]) setC(dr, PL.co[i], v, NUM_FMT, INDIGO, false, bg);
          });
        }
if (hasHistoryPL) {
          plHistMaps.forEach((h, i) => {
            const entries = h.jrnByCode?.get(accCode) || [];
            const histAmt = entries.reduce((acc, j) => acc + -parseAmt(j.AmountYTD ?? j.amountYTD ?? 0), 0);
            setC(dr, PL.histMon[i], histAmt, NUM_FMT, INDIGO, false, bg);
            setC(dr, PL.histYtd[i], histAmt, NUM_FMT, INDIGO, false, bg);
          });
        }
        const blankCols = [
          ...(hasB ? [PL.monBD, PL.monBP, PL.ytdBD, PL.ytdBP, ...(bVal == null ? [PL.monB, PL.ytdB] : [])] : []),
          ...(hasC ? [PL.monCD, PL.monCP, PL.ytdCD, PL.ytdCP, ...(cVal == null ? [PL.monC, PL.ytdC] : [])] : []),
          ...(hasD ? [PL.monDD, PL.monDP, PL.ytdDD, PL.ytdDP, ...(dVal == null ? [PL.monD, PL.ytdD] : [])] : []),
          ...(hasMultiCo ? [] : PL.co),
        ];
        blankCols.forEach(ci => {
          if (ci) { const c = dr.getCell(ci); c.value = ''; c.fill = mkFill(bg); c.border = mkBorder(); }
        });
      };

      const writeJrnExtras = (parentCode, aJrns, depth, ol) => {
        if (!parentCode || (!hasB && !hasC && !hasD)) return;
        const aNums = new Set(aJrns.map(j => j.JournalNumber ?? j.journalNumber));
        const seen = new Map();
        const collect = (idx, period) => {
          (idx.get(String(parentCode)) || []).forEach(j => {
            const num = j.JournalNumber ?? j.journalNumber;
            if (aNums.has(num)) return;
            if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
            seen.get(num).periods[period] = -parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
          });
        };
        if (hasB) collect(jrnByCodeCmp, 'B');
        if (hasC) collect(jrnByCodeCmp2, 'C');
        if (hasD) collect(jrnByCodeCmp3, 'D');
        seen.forEach((entry, num) => {
          ['B','C','D'].forEach(p => {
            if (entry.periods[p] != null) return;
            const idx = p === 'B' ? jrnByCodeCmp : p === 'C' ? jrnByCodeCmp2 : jrnByCodeCmp3;
            const match = (idx.get(String(parentCode)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
            if (match) entry.periods[p] = -parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
          });
        });
        if (seen.size === 0) return;
        ws.addRow([]);
        const xhr = ws.lastRow;
        xhr.height = 14;
        xhr.outlineLevel = Math.min(ol, 7);
        xhr.hidden = true;
        const xnc = xhr.getCell(PL.name);
        xnc.value = `↳ B/C/D only (${seen.size})`;
        xnc.font = mkFont(true, INDIGO, 9);
        xnc.fill = mkFill(JRN_BG);
        xnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 1 };
        xnc.border = mkBorder();
        for (let c = 2; c <= plCols; c++) { xhr.getCell(c).fill = mkFill(JRN_BG); xhr.getCell(c).border = mkBorder(); }
        seen.forEach((entry, num) => {
          ws.addRow([]);
          const xr = ws.lastRow;
          xr.height = 14;
          xr.outlineLevel = Math.min(ol + 1, 7);
          xr.hidden = true;
          const xec = xr.getCell(PL.name);
          const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
          xec.value = `📄 ${num}${jhdr ? ' · ' + jhdr : ''}`;
          xec.font = mkFont(false, INDIGO, 9);
          xec.fill = mkFill(JRN_BG);
          xec.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
          xec.border = mkBorder();
          if (hasB && entry.periods.B != null) { setC(xr, PL.monB, entry.periods.B, NUM_FMT, INDIGO, false, JRN_BG); setC(xr, PL.ytdB, entry.periods.B, NUM_FMT, INDIGO, false, JRN_BG); }
          if (hasC && entry.periods.C != null) { setC(xr, PL.monC, entry.periods.C, NUM_FMT, INDIGO, false, JRN_BG); setC(xr, PL.ytdC, entry.periods.C, NUM_FMT, INDIGO, false, JRN_BG); }
          if (hasD && entry.periods.D != null) { setC(xr, PL.monD, entry.periods.D, NUM_FMT, INDIGO, false, JRN_BG); setC(xr, PL.ytdD, entry.periods.D, NUM_FMT, INDIGO, false, JRN_BG); }
          [PL.monA, PL.ytdA, PL.monBD, PL.monBP, PL.monCD, PL.monCP, PL.monDD, PL.monDP,
           PL.ytdBD, PL.ytdBP, PL.ytdCD, PL.ytdCP, PL.ytdDD, PL.ytdDP,
           ...PL.histMon, ...PL.histYtd, ...PL.co].forEach(ci => {
            if (ci && !xr.getCell(ci).value) { const c = xr.getCell(ci); c.value = ''; c.fill = mkFill(JRN_BG); c.border = mkBorder(); }
          });
        });
      };

// SUMMARY MODE
      if (isSummary) {
        const sortedSummary = [...summaryRows]
          .filter(n => hasData(n) && ['P/L', 'DIS'].includes(n.accountType))
          .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

        // Code -> node map of the local tree (so drill-down references the SAME tree)
        const localTreeByCode = new Map();
        (function index(nodes) {
          nodes.forEach(n => { localTreeByCode.set(String(n.code), n); index(n.children || []); });
        })(tree);

// Drill-down: include ALL children, only skip OTHER summary rows (shown at top level)
        const summaryRowCodes = new Set(sortedSummary.map(n => String(n.code)));
        const writeSummaryDrill = (parentNode, depth, ol) => {
          const grpChildren = (parentNode.children || []).filter(c =>
            hasData(c) && ['P/L', 'DIS'].includes(c.accountType) && !summaryRowCodes.has(String(c.code))
          );
          grpChildren.forEach(child => {
            writeDataRow(child, depth, ol, { hidden: true });
            writeSummaryDrill(child, depth + 1, ol + 1);
          });

          (parentNode.uploadLeaves || []).forEach(leaf => {
            if (leaf.type === 'plain') return;
            writeLeafRow(leaf, depth, ol);
            (leaf.children || []).forEach(dim => writeDimRow(dim, depth + 1, ol + 1, leaf.code));
          });

const jrns = jrnByCode.get(String(parentNode.code)) || [];
          if (jrns.length > 0) {
            writeJrnHeaderRow(jrns.length, depth, ol);
            jrns.forEach(j => writeJrnEntry(j, depth + 1, ol + 1));
            writeJrnExtras(parentNode.code, jrns, depth + 1, ol + 1);
          }
        };

        sortedSummary.forEach(node => {
          const div = SUMMARY_DIV[String(node.code)];
          if (div) writeDivider(div);
          writeDataRow(node, 0, 0, { forceBold: true });
          const localNode = localTreeByCode.get(String(node.code)) ?? node;
          writeSummaryDrill(localNode, 1, 1);
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
          (leaf.children || []).forEach(dim => writeDimRow(dim, depth + 1, ol + 1, leaf.code));
        });

// Journal entries
        const jrns = jrnByCode.get(String(parentNode.code)) || [];
        if (jrns.length > 0) {
          writeJrnHeaderRow(jrns.length, depth, ol);
          jrns.forEach(j => writeJrnEntry(j, depth + 1, ol + 1));
          writeJrnExtras(parentNode.code, jrns, depth + 1, ol + 1);
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
// SAVED LITERAL P&L SHEET — matches app render path 1:1
// ═══════════════════════════════════════════════════════════
const buildSavedPLSheet = (ws) => {
  ws.views = [{ state: 'frozen', ySplit: hasB ? 4 : 3, showOutlineSymbols: true }];
  ws.properties.outlineLevelRow = 0;

  // ── Title ──
  ws.addRow([]);
  const r1 = ws.lastRow;
  r1.height = 32;
  r1.getCell(1).value = `Profit & Loss`;
  r1.getCell(1).font = mkFont(true, WHITE, 14);
  r1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  for (let c = 1; c <= plCols; c++) r1.getCell(c).fill = mkFill(NAVY);
  ws.mergeCells(r1.number, 1, r1.number, plCols);

  ws.addRow([]);
  const r2 = ws.lastRow;
  r2.height = 16;
  r2.getCell(1).value = `A: ${aLabel}`;
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
    if (hasD) parts.push(`D: ${dLabel}`);
    r3.getCell(1).value = parts.join('    |    ');
    r3.getCell(1).font = mkFont(false, 'FFFCD34D', 9);
    r3.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    for (let c = 1; c <= plCols; c++) r3.getCell(c).fill = mkFill(NAVY);
    ws.mergeCells(r3.number, 1, r3.number, plCols);
  }

  // ── Column headers (same layout as buildPLSheet) ──
  ws.addRow([]);
  const rh = ws.lastRow;
  rh.height = 22;
  const headers = [[PL.name, 'ACCOUNT', 'left', NAVY], [PL.monA, 'MONTHLY', 'right', NAVY]];
  if (hasB) headers.push([PL.monB, 'MON B', 'right', RED], [PL.monBD, 'Δ', 'right', RED], [PL.monBP, 'Δ%', 'right', RED]);
  if (hasC) headers.push([PL.monC, 'MON C', 'right', GRN], [PL.monCD, 'Δ', 'right', GRN], [PL.monCP, 'Δ%', 'right', GRN]);
  if (hasD) headers.push([PL.monD, 'MON D', 'right', PURPLE], [PL.monDD, 'Δ', 'right', PURPLE], [PL.monDP, 'Δ%', 'right', PURPLE]);
  if (hasHistoryPL) plHistMaps.forEach((h, i) => {
    const moLbl = MONTHS.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3).toUpperCase() ?? String(h.month);
    headers.push([PL.histMon[i], `MON ${moLbl} ${h.year}`, 'right', NAVY_DK]);
  });
  headers.push([PL.ytdA, 'YTD', 'right', NAVY]);
  if (hasB) headers.push([PL.ytdB, 'YTD B', 'right', RED], [PL.ytdBD, 'Δ', 'right', RED], [PL.ytdBP, 'Δ%', 'right', RED]);
  if (hasC) headers.push([PL.ytdC, 'YTD C', 'right', GRN], [PL.ytdCD, 'Δ', 'right', GRN], [PL.ytdCP, 'Δ%', 'right', GRN]);
  if (hasD) headers.push([PL.ytdD, 'YTD D', 'right', PURPLE], [PL.ytdDD, 'Δ', 'right', PURPLE], [PL.ytdDP, 'Δ%', 'right', PURPLE]);
  if (hasHistoryPL) plHistMaps.forEach((h, i) => {
    const moLbl = MONTHS.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3).toUpperCase() ?? String(h.month);
    headers.push([PL.histYtd[i], `YTD ${moLbl} ${h.year}`, 'right', NAVY_DK]);
  });
if (hasMultiCo) perCoMaps.forEach((c, i) => headers.push([PL.co[i], c.legal, 'right', NAVY]));

  headers.filter(h => Array.isArray(h) && Number.isFinite(h[0]) && h[0] > 0).forEach(([ci, lbl, align, fillArgb]) => {
    const c = rh.getCell(ci);
    c.value = lbl;
    c.font = mkFont(true, WHITE, 9);
    c.fill = mkFill(fillArgb);
    c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
    c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
  });
// Column widths
  ws.getColumn(PL.name).width = 52;
  if (PL.monA) ws.getColumn(PL.monA).width = 16;
  if (PL.ytdA) ws.getColumn(PL.ytdA).width = 16;
  if (hasB) [PL.monB, PL.monBD, PL.monBP, PL.ytdB, PL.ytdBD, PL.ytdBP].forEach(ci => {
    ws.getColumn(ci).width = (ci === PL.monB || ci === PL.ytdB) ? 16 : (ci === PL.monBD || ci === PL.ytdBD) ? 13 : 10;
  });
  if (hasC) [PL.monC, PL.monCD, PL.monCP, PL.ytdC, PL.ytdCD, PL.ytdCP].forEach(ci => {
    ws.getColumn(ci).width = (ci === PL.monC || ci === PL.ytdC) ? 16 : (ci === PL.monCD || ci === PL.ytdCD) ? 13 : 10;
  });
  if (hasD) [PL.monD, PL.monDD, PL.monDP, PL.ytdD, PL.ytdDD, PL.ytdDP].forEach(ci => {
    ws.getColumn(ci).width = (ci === PL.monD || ci === PL.ytdD) ? 16 : (ci === PL.monDD || ci === PL.ytdDD) ? 13 : 10;
  });
  if (hasHistoryPL) { PL.histMon.forEach(ci => { ws.getColumn(ci).width = 15; }); PL.histYtd.forEach(ci => { ws.getColumn(ci).width = 15; }); }
  if (hasMultiCo) PL.co.forEach(ci => { ws.getColumn(ci).width = 20; });

  // ── Build the same indexes the app uses for sumLiteral calculations ──
  const buildDimIdx = (rows) => {
    const fullIdx = new Map();
    const valIdx = new Map();
    (rows || []).forEach(row => {
      const code = String(getField(row, 'accountCode') ?? '');
      if (!code) return;
      const amt = parseAmt(getField(row, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
      const dimsStr = String(getField(row, 'Dimensions', 'dimensions') ?? '');
      if (!dimsStr) return;
      dimsStr.split('||').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(':'); if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        fullIdx.set(`${code}|${g}:${v}`, (fullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        valIdx.set(`${code}|${v}`, (valIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });
    if (Array.isArray(dimensions) && dimensions.length > 0) {
      const nameToCode = new Map();
      dimensions.forEach(d => {
        const g = String(d.dimensionGroup ?? d.DimensionGroup ?? d.groupName ?? d.GroupName ?? '').trim();
        const cd = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? d.Code ?? '').trim();
        const nm = String(d.dimensionName ?? d.DimensionName ?? d.name ?? d.Name ?? '').trim();
        if (g && cd && nm) nameToCode.set(`${g}:${nm}`, cd);
      });
      [...fullIdx.entries()].forEach(([k, v]) => {
        const pipe = k.indexOf('|'); const acc = k.slice(0, pipe);
        const rest = k.slice(pipe + 1); const colon = rest.indexOf(':');
        if (colon === -1) return;
        const g = rest.slice(0, colon); const cv = rest.slice(colon + 1);
        for (const [nk, mc] of nameToCode.entries()) {
          if (mc === cv && nk.startsWith(`${g}:`)) {
            const nm = nk.slice(g.length + 1);
            fullIdx.set(`${acc}|${g}:${nm}`, v);
            valIdx.set(`${acc}|${nm}`, v);
            break;
          }
        }
      });
    }
    return { fullIdx, valIdx };
  };

  const treeByCode = (rows) => {
    const m = new Map();
    (function w(nodes) { nodes.forEach(n => { m.set(String(n.code), n); w(n.children || []); }); })(buildTree(groupAccounts, rows || []));
    return m;
  };

  const aTree = treeByCode(uploadedAccounts);
  const aPrevTree = treeByCode(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);
  const aIdx = buildDimIdx(uploadedAccounts);
  const aPrevIdx = buildDimIdx(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);

  const bTree = hasB ? treeByCode(cmpUploadedAccounts) : null;
  const bPrevTree = hasB ? treeByCode(cmpPrevUploadedAccounts) : null;
  const bIdx = hasB ? buildDimIdx(cmpUploadedAccounts) : null;
  const bPrevIdx = hasB ? buildDimIdx(cmpPrevUploadedAccounts) : null;

  const cTree = hasC ? treeByCode(cmp2UploadedAccounts) : null;
  const cPrevTree = hasC ? treeByCode(cmp2PrevUploadedAccounts) : null;
  const cIdx = hasC ? buildDimIdx(cmp2UploadedAccounts) : null;
  const cPrevIdx = hasC ? buildDimIdx(cmp2PrevUploadedAccounts) : null;
const dTree = hasD ? treeByCode(cmp3UploadedAccounts) : null;
  const dPrevTree = hasD ? treeByCode(cmp3PrevUploadedAccounts) : null;
  const dIdx = hasD ? buildDimIdx(cmp3UploadedAccounts) : null;
  const dPrevIdx = hasD ? buildDimIdx(cmp3PrevUploadedAccounts) : null;

  // Per-company trees for multi-co mode (built once, used for sum-walks)
  const perCoTrees = hasMultiCo ? _selectedCo.map(co => ({
    tree: treeByCode((uploadedAccounts || []).filter(r => getCoF(r) === co)),
    prevTree: treeByCode((prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts || []).filter(r => getCoF(r) === co)),
  })) : [];

  const sumDimRec = (gaNode, dimStr, idx) => {
    if (!gaNode || !idx) return 0;
    let total = 0;
    const code = String(gaNode.code);
    total += dimStr.includes(':') ? (idx.fullIdx.get(`${code}|${dimStr}`) ?? 0) : (idx.valIdx.get(`${code}|${dimStr}`) ?? 0);
    (gaNode.children || []).forEach(c => { total += sumDimRec(c, dimStr, idx); });
    return total;
  };

  // sumLiteral: returns { ytd, mon } for one literal node in one period — matches app exactly
  const sumLit = (node, tree, prevTree, idx, prevIdx, periodMonth) => {
    const ga = tree?.get(String(node.code));
    if (!ga) return { ytd: 0, mon: 0 };
    if (!node.dims || node.dims.length === 0) {
      const ytd = -sumNode(ga);
      const prevGa = prevTree?.get(String(node.code));
      const prevYtd = prevGa && Number(periodMonth) !== 1 ? -sumNode(prevGa) : 0;
      return { ytd, mon: ytd - prevYtd };
    }
    let total = 0, prevTotal = 0;
    node.dims.forEach(d => { total += sumDimRec(ga, String(d), idx); });
    if (Number(periodMonth) !== 1 && prevIdx) {
      node.dims.forEach(d => { prevTotal += sumDimRec(ga, String(d), prevIdx); });
    }
    return { ytd: -total, mon: -total - (-prevTotal) };
  };

  // Apply the "sum + children" rule that the app applies for isSum nodes with children
  const sumLitWithKids = (node, tree, prevTree, idx, prevIdx, periodMonth) => {
    const self = sumLit(node, tree, prevTree, idx, prevIdx, periodMonth);
    let ytd = self.ytd, mon = self.mon;
    if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
      node.children.forEach(c => {
        const ch = sumLit(c, tree, prevTree, idx, prevIdx, periodMonth);
        ytd += ch.ytd;
        mon += ch.mon;
      });
    }
    return { ytd, mon };
  };

  const isHl = (node) => savedHighlightedIds && (
    savedHighlightedIds.has?.(node.id) || savedHighlightedIds.has?.(node.originalId)
  );

  const dA = (a, b) => a - b;
  const dP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

// Pre-build leaf indexes ONCE (was rebuilt per node — caused major lag)
  const buildLeafIdxOnce = (rows) => {
    const m = new Map();
    (rows || []).forEach(r => {
      const lac = String(getField(r, 'localAccountCode') ?? '');
      if (!lac) return;
      m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
    });
    return m;
  };
  const aPrevLeafIdxOnce = buildLeafIdxOnce(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);
  const bLeafIdxOnce = hasB ? buildLeafIdxOnce(cmpUploadedAccounts) : new Map();
  const bPrevLeafIdxOnce = hasB ? buildLeafIdxOnce(cmpPrevUploadedAccounts) : new Map();
  const cLeafIdxOnce = hasC ? buildLeafIdxOnce(cmp2UploadedAccounts) : new Map();
  const cPrevLeafIdxOnce = hasC ? buildLeafIdxOnce(cmp2PrevUploadedAccounts) : new Map();
const dLeafIdxOnce = hasD ? buildLeafIdxOnce(cmp3UploadedAccounts) : new Map();
  const dPrevLeafIdxOnce = hasD ? buildLeafIdxOnce(cmp3PrevUploadedAccounts) : new Map();
  const plHistLeafIdxOnce = hasHistoryPL ? plHist.map(h => ({
    month: h.month,
    cur:  buildLeafIdxOnce(h.data || []),
    prev: buildLeafIdxOnce(h.prevData || []),
  })) : [];

  // Pre-index uploaded rows by localAccountCode for dim-filter lookup
  const rowsByLac = new Map();
  (uploadedAccounts || []).forEach(r => {
    const lac = String(getField(r, 'localAccountCode', 'LocalAccountCode') ?? '');
    if (!lac) return;
    if (!rowsByLac.has(lac)) rowsByLac.set(lac, []);
    rowsByLac.get(lac).push(r);
  });

  let zebra = 0;

  const writeNode = (node, depth) => {
    const a = sumLitWithKids(node, aTree, aPrevTree, aIdx, aPrevIdx, month);
    const b = hasB ? sumLitWithKids(node, bTree, bPrevTree, bIdx, bPrevIdx, cmpFilters?.month) : null;
    const c = hasC ? sumLitWithKids(node, cTree, cPrevTree, cIdx, cPrevIdx, cmp2Filters?.month) : null;
    const d = hasD ? sumLitWithKids(node, dTree, dPrevTree, dIdx, dPrevIdx, cmp3Filters?.month) : null;

    const hl = isHl(node);
    const bg = hl ? LIGHT : (zebra % 2 === 0 ? WHITE : STRIPE);
    zebra++;
    const nameColor = hl ? NAVY : (depth === 0 ? NAVY : TEXT_DK);
    const valColor = hl ? NAVY : TEXT_DK;
    const bold = hl || depth === 0;

    ws.addRow([]);
    const dr = ws.lastRow;
    dr.height = hl ? 19 : 17;

    const nc = dr.getCell(PL.name);
    const txt = depth === 0 ? (node.name || '').toUpperCase() : (node.name || '');
    if (node.code) {
      nc.value = { richText: [
        { text: `${node.code}    `, font: { name: 'Consolas', color: { argb: 'FF9CA3AF' }, size: 9 } },
        { text: txt, font: { name: 'Calibri', color: { argb: nameColor }, size: 10, bold } },
      ]};
    } else {
      nc.value = txt;
      nc.font = mkFont(bold, nameColor, 10);
    }
    nc.fill = mkFill(bg);
    nc.alignment = { horizontal: 'left', vertical: 'middle', indent: Math.max(1, depth + 1) };
    nc.border = mkBorder();

    // Monthly side
    setC(dr, PL.monA, a.mon, NUM_FMT, valColor, bold, bg);
    if (hasB) {
      setC(dr, PL.monB, b.mon, NUM_FMT, RED, bold, bg);
      const diff = dA(a.mon, b.mon);
      setC(dr, PL.monBD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, PL.monBP, dP(a.mon, b.mon), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasC) {
      setC(dr, PL.monC, c.mon, NUM_FMT, GRN, bold, bg);
      const diff = dA(a.mon, c.mon);
      setC(dr, PL.monCD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, PL.monCP, dP(a.mon, c.mon), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasD) {
      setC(dr, PL.monD, d.mon, NUM_FMT, PURPLE, bold, bg);
      const diff = dA(a.mon, d.mon);
      setC(dr, PL.monDD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, PL.monDP, dP(a.mon, d.mon), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasHistoryPL) plHistMaps.forEach((h, i) => {
      const hYtd = -getYtd(h.map, node.code);
      const hPrev = -getPrev(h.prevMap, node.code, h.month);
      setC(dr, PL.histMon[i], hYtd - hPrev, NUM_FMT, valColor, bold, bg);
    });

    // YTD side
    setC(dr, PL.ytdA, a.ytd, NUM_FMT, valColor, bold, bg);
    if (hasB) {
      setC(dr, PL.ytdB, b.ytd, NUM_FMT, RED, bold, bg);
      const diff = dA(a.ytd, b.ytd);
      setC(dr, PL.ytdBD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, PL.ytdBP, dP(a.ytd, b.ytd), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasC) {
      setC(dr, PL.ytdC, c.ytd, NUM_FMT, GRN, bold, bg);
      const diff = dA(a.ytd, c.ytd);
      setC(dr, PL.ytdCD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, PL.ytdCP, dP(a.ytd, c.ytd), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasD) {
      setC(dr, PL.ytdD, d.ytd, NUM_FMT, PURPLE, bold, bg);
      const diff = dA(a.ytd, d.ytd);
      setC(dr, PL.ytdDD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, PL.ytdDP, dP(a.ytd, d.ytd), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasHistoryPL) plHistMaps.forEach((h, i) => {
      setC(dr, PL.histYtd[i], -getYtd(h.map, node.code), NUM_FMT, valColor, bold, bg);
    });
if (hasMultiCo) perCoTrees.forEach((cot, i) => {
      const ga = cot.tree.get(String(node.code));
      let ytdC = ga ? -sumNode(ga) : 0;
      let prevC = 0;
      if (Number(month) !== 1) {
        const prevGa = cot.prevTree.get(String(node.code));
        if (prevGa) prevC = -sumNode(prevGa);
      }
      // Sum-with-kids rollup for isSum nodes (matches sumLitWithKids)
      if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
        node.children.forEach(ch => {
          const g = cot.tree.get(String(ch.code));
          if (g) ytdC += -sumNode(g);
          if (Number(month) !== 1) {
            const pg = cot.prevTree.get(String(ch.code));
            if (pg) prevC += -sumNode(pg);
          }
        });
      }
      const val = _ytdOnly ? ytdC : (ytdC - prevC);
      setC(dr, PL.co[i], val, NUM_FMT, valColor, bold, bg);
    });

// ── Drill-down: uploadLeaves (local accounts) + dimensions ──
    const gaNode = aTree.get(String(node.code));
    let leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== 'plain');

// Filter leaves by node.dims if present (same logic as app render)
    if (node.dims && node.dims.length > 0 && leaves.length > 0) {
      const accepted = new Set(node.dims.map(d => String(d)));
      const filtered = leaves.filter(leaf => {
        const leafRows = rowsByLac.get(String(leaf.code ?? '')) || [];
        return leafRows.some(r => {
          const dimsStr = String(getField(r, 'Dimensions', 'dimensions') ?? '');
          if (!dimsStr) return false;
          return dimsStr.split('||').map(s => s.trim()).filter(Boolean).some(pair => {
            const i = pair.indexOf(':'); if (i === -1) return false;
            const g = pair.slice(0, i).trim();
            const v = pair.slice(i + 1).trim();
            if (accepted.has(`${g}:${v}`)) return true;
            return [...accepted].some(sk => {
              const sc = sk.indexOf(':');
              const sv = sc === -1 ? sk : sk.slice(sc + 1);
              if (sv === v) return true;
              const dm = (dimensions || []).find(dd => {
                const dg = String(dd.dimensionGroup ?? dd.DimensionGroup ?? '').trim();
                const dn = String(dd.dimensionName ?? dd.DimensionName ?? '').trim();
                return dn === sv && (sc === -1 || dg === sk.slice(0, sc));
              });
              if (!dm) return false;
              return String(dm.dimensionCode ?? dm.DimensionCode ?? '') === v;
            });
          });
        });
      });
      if (filtered.length > 0) leaves = filtered;
    }

   leaves.forEach((leaf) => {
      const ytdA = -(leaf.amount ?? 0);
      const prevA = leaf.code && Number(month) !== 1 ? (aPrevLeafIdxOnce.get(String(leaf.code)) ?? 0) : 0;
      const monA = -(((leaf.amount ?? 0) - prevA));

      ws.addRow([]);
      const dr2 = ws.lastRow;
      dr2.height = 15;
      dr2.outlineLevel = Math.min(depth + 1, 7);
      dr2.hidden = true;

      const lnc = dr2.getCell(PL.name);
      lnc.value = `${leaf.code || ''}  ${leaf.name || ''}`.trim();
      lnc.font = mkFont(false, TEXT_MUT, 9, true);
      lnc.fill = mkFill(LEAF_BG);
      lnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
      lnc.border = mkBorder();

      setC(dr2, PL.monA, monA, NUM_FMT, TEXT_MUT, false, LEAF_BG);
      setC(dr2, PL.ytdA, ytdA, NUM_FMT, TEXT_MUT, false, LEAF_BG);

      if (hasB && leaf.code) {
        const bY = -(bLeafIdxOnce.get(String(leaf.code)) ?? 0);
        const bP = Number(cmpFilters?.month) === 1 ? 0 : -(bPrevLeafIdxOnce.get(String(leaf.code)) ?? 0);
        const bM = bY - bP;
        setC(dr2, PL.monB, bM, NUM_FMT, RED, false, LEAF_BG);
        const dm = dA(monA, bM); setC(dr2, PL.monBD, dm, NUM_FMT, devColor(dm), false, LEAF_BG);
        setC(dr2, PL.monBP, dP(monA, bM), PCT_FMT, devColor(dm), false, LEAF_BG);
        setC(dr2, PL.ytdB, bY, NUM_FMT, RED, false, LEAF_BG);
        const dy = dA(ytdA, bY); setC(dr2, PL.ytdBD, dy, NUM_FMT, devColor(dy), false, LEAF_BG);
        setC(dr2, PL.ytdBP, dP(ytdA, bY), PCT_FMT, devColor(dy), false, LEAF_BG);
      }
      if (hasC && leaf.code) {
        const cY = -(cLeafIdxOnce.get(String(leaf.code)) ?? 0);
        const cP = Number(cmp2Filters?.month) === 1 ? 0 : -(cPrevLeafIdxOnce.get(String(leaf.code)) ?? 0);
        const cM = cY - cP;
        setC(dr2, PL.monC, cM, NUM_FMT, GRN, false, LEAF_BG);
        const dm = dA(monA, cM); setC(dr2, PL.monCD, dm, NUM_FMT, devColor(dm), false, LEAF_BG);
        setC(dr2, PL.monCP, dP(monA, cM), PCT_FMT, devColor(dm), false, LEAF_BG);
        setC(dr2, PL.ytdC, cY, NUM_FMT, GRN, false, LEAF_BG);
        const dy = dA(ytdA, cY); setC(dr2, PL.ytdCD, dy, NUM_FMT, devColor(dy), false, LEAF_BG);
        setC(dr2, PL.ytdCP, dP(ytdA, cY), PCT_FMT, devColor(dy), false, LEAF_BG);
      }
if (hasD && leaf.code) {
        const dY = -(dLeafIdxOnce.get(String(leaf.code)) ?? 0);
        const dPV = Number(cmp3Filters?.month) === 1 ? 0 : -(dPrevLeafIdxOnce.get(String(leaf.code)) ?? 0);
        const dM = dY - dPV;
        setC(dr2, PL.monD, dM, NUM_FMT, PURPLE, false, LEAF_BG);
        const dm = dA(monA, dM); setC(dr2, PL.monDD, dm, NUM_FMT, devColor(dm), false, LEAF_BG);
        setC(dr2, PL.monDP, dP(monA, dM), PCT_FMT, devColor(dm), false, LEAF_BG);
        setC(dr2, PL.ytdD, dY, NUM_FMT, PURPLE, false, LEAF_BG);
        const dy = dA(ytdA, dY); setC(dr2, PL.ytdDD, dy, NUM_FMT, devColor(dy), false, LEAF_BG);
        setC(dr2, PL.ytdDP, dP(ytdA, dY), PCT_FMT, devColor(dy), false, LEAF_BG);
      }
if (hasHistoryPL && leaf.code) {
        plHistLeafIdxOnce.forEach((h, i) => {
          const hY = -(h.cur.get(String(leaf.code)) ?? 0);
          const hP = Number(h.month) === 1 ? 0 : -(h.prev.get(String(leaf.code)) ?? 0);
          setC(dr2, PL.histMon[i], hY - hP, NUM_FMT, TEXT_MUT, false, LEAF_BG);
          setC(dr2, PL.histYtd[i], hY, NUM_FMT, TEXT_MUT, false, LEAF_BG);
        });
      }
      if (hasMultiCo && leaf.code) {
        if (!ws._savedPerCoLeafIdx) {
          ws._savedPerCoLeafIdx = _selectedCo.map(co => ({
            cur:  buildLeafIdxOnce((uploadedAccounts || []).filter(r => getCoF(r) === co)),
            prev: buildLeafIdxOnce(((prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts) || []).filter(r => getCoF(r) === co)),
          }));
        }
        ws._savedPerCoLeafIdx.forEach((idx, i) => {
          const ytdC = -(idx.cur.get(String(leaf.code)) ?? 0);
          const prevC = Number(month) === 1 ? 0 : -(idx.prev.get(String(leaf.code)) ?? 0);
          const val = _ytdOnly ? ytdC : (ytdC - prevC);
          if (PL.co[i]) setC(dr2, PL.co[i], val, NUM_FMT, TEXT_MUT, false, LEAF_BG);
        });
      }

      // Dimension sub-rows
      let dimChildren = leaf.children || [];
      if (node.dims && node.dims.length > 0) {
        const accepted = new Set(node.dims.map(d => String(d)));
        dimChildren = dimChildren.filter(dim => {
          const dc = String(dim.code ?? ''); const dn = String(dim.name ?? '');
          return [...accepted].some(sk => {
            const colon = sk.indexOf(':');
            const sv = colon === -1 ? sk : sk.slice(colon + 1);
            return sv === dc || sv === dn;
          });
        });
      }
// Build per-leaf+dim indexes once for saved-mapping export
      if (!ws._savedLeafDimIdx) {
        const buildLDI = (rows) => {
          const m = new Map();
          (rows || []).forEach(r => {
            const l = String(getField(r, 'localAccountCode') ?? '');
            const dcd = String(getField(r, 'dimensionCode') ?? '');
            if (!l || !dcd || dcd === 'null') return;
            const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
            m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
          });
          return m;
        };
ws._savedLeafDimIdx = {
          aPrev: buildLDI(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts),
          b:     hasB ? buildLDI(cmpUploadedAccounts) : new Map(),
          bPrev: hasB ? buildLDI(cmpPrevUploadedAccounts) : new Map(),
          c:     hasC ? buildLDI(cmp2UploadedAccounts) : new Map(),
          cPrev: hasC ? buildLDI(cmp2PrevUploadedAccounts) : new Map(),
          d:     hasD ? buildLDI(cmp3UploadedAccounts) : new Map(),
          dPrev: hasD ? buildLDI(cmp3PrevUploadedAccounts) : new Map(),
          hist:  hasHistoryPL ? plHist.map(h => ({ month: h.month, cur: buildLDI(h.data || []), prev: buildLDI(h.prevData || []) })) : [],
        };
      }
      const sLDI = ws._savedLeafDimIdx;

      dimChildren.forEach(dim => {
        ws.addRow([]);
        const drd = ws.lastRow;
        drd.height = 15;
        drd.outlineLevel = Math.min(depth + 2, 7);
        drd.hidden = true;
        const dnc = drd.getCell(PL.name);
        dnc.value = `◆  ${dim.name || dim.code || ''}`;
        dnc.font = mkFont(false, AMBER, 9);
        dnc.fill = mkFill(DIM_BG);
        dnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
        dnc.border = mkBorder();

        const lac = String(leaf.code ?? '');
        const dc  = String(dim.code ?? '');
        const key = lac && dc ? `${lac}|${dc}` : null;
        const ytdA = -(dim.amount ?? 0);
        const prevA = key && Number(month) !== 1 ? -(sLDI.aPrev.get(key) ?? 0) : 0;
        const monA = ytdA - prevA;

        setC(drd, PL.monA, monA, NUM_FMT, AMBER, false, DIM_BG);
        setC(drd, PL.ytdA, ytdA, NUM_FMT, AMBER, false, DIM_BG);

        const dA = (a, b) => a - b;
        const dP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

        if (hasB && key) {
          const bY = -(sLDI.b.get(key) ?? 0);
          const bP = Number(cmpFilters?.month) === 1 ? 0 : -(sLDI.bPrev.get(key) ?? 0);
          const bM = bY - bP;
          setC(drd, PL.monB, bM, NUM_FMT, RED, false, DIM_BG);
          const dm = dA(monA, bM); setC(drd, PL.monBD, dm, NUM_FMT, devColor(dm), false, DIM_BG);
          setC(drd, PL.monBP, dP(monA, bM), PCT_FMT, devColor(dm), false, DIM_BG);
          setC(drd, PL.ytdB, bY, NUM_FMT, RED, false, DIM_BG);
          const dy = dA(ytdA, bY); setC(drd, PL.ytdBD, dy, NUM_FMT, devColor(dy), false, DIM_BG);
          setC(drd, PL.ytdBP, dP(ytdA, bY), PCT_FMT, devColor(dy), false, DIM_BG);
        }
        if (hasC && key) {
          const cY = -(sLDI.c.get(key) ?? 0);
          const cP = Number(cmp2Filters?.month) === 1 ? 0 : -(sLDI.cPrev.get(key) ?? 0);
          const cM = cY - cP;
          setC(drd, PL.monC, cM, NUM_FMT, GRN, false, DIM_BG);
          const dm = dA(monA, cM); setC(drd, PL.monCD, dm, NUM_FMT, devColor(dm), false, DIM_BG);
          setC(drd, PL.monCP, dP(monA, cM), PCT_FMT, devColor(dm), false, DIM_BG);
          setC(drd, PL.ytdC, cY, NUM_FMT, GRN, false, DIM_BG);
          const dy = dA(ytdA, cY); setC(drd, PL.ytdCD, dy, NUM_FMT, devColor(dy), false, DIM_BG);
          setC(drd, PL.ytdCP, dP(ytdA, cY), PCT_FMT, devColor(dy), false, DIM_BG);
        }
if (hasD && key) {
          const dY = -(sLDI.d.get(key) ?? 0);
          const dPV = Number(cmp3Filters?.month) === 1 ? 0 : -(sLDI.dPrev.get(key) ?? 0);
          const dM = dY - dPV;
          setC(drd, PL.monD, dM, NUM_FMT, PURPLE, false, DIM_BG);
          const dm = dA(monA, dM); setC(drd, PL.monDD, dm, NUM_FMT, devColor(dm), false, DIM_BG);
          setC(drd, PL.monDP, dP(monA, dM), PCT_FMT, devColor(dm), false, DIM_BG);
          setC(drd, PL.ytdD, dY, NUM_FMT, PURPLE, false, DIM_BG);
          const dy = dA(ytdA, dY); setC(drd, PL.ytdDD, dy, NUM_FMT, devColor(dy), false, DIM_BG);
          setC(drd, PL.ytdDP, dP(ytdA, dY), PCT_FMT, devColor(dy), false, DIM_BG);
        }
        if (hasHistoryPL && key) {
          sLDI.hist.forEach((h, i) => {
            const hY = -(h.cur.get(key) ?? 0);
            const hP = Number(h.month) === 1 ? 0 : -(h.prev.get(key) ?? 0);
            setC(drd, PL.histMon[i], hY - hP, NUM_FMT, AMBER, false, DIM_BG);
            setC(drd, PL.histYtd[i], hY, NUM_FMT, AMBER, false, DIM_BG);
          });
        }
        if (hasMultiCo && key) {
          if (!ws._savedPerCoLeafDimIdx) {
            const buildLDIco = (rows) => {
              const m = new Map();
              (rows || []).forEach(r => {
                const l = String(getField(r, 'localAccountCode') ?? '');
                const dcd = String(getField(r, 'dimensionCode') ?? '');
                if (!l || !dcd || dcd === 'null') return;
                const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
                m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
              });
              return m;
            };
            ws._savedPerCoLeafDimIdx = _selectedCo.map(co => ({
              cur:  buildLDIco((uploadedAccounts || []).filter(r => getCoF(r) === co)),
              prev: buildLDIco(((prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts) || []).filter(r => getCoF(r) === co)),
            }));
          }
          ws._savedPerCoLeafDimIdx.forEach((idx, i) => {
            const ytdC = -(idx.cur.get(key) ?? 0);
            const prevC = Number(month) === 1 ? 0 : -(idx.prev.get(key) ?? 0);
            const val = _ytdOnly ? ytdC : (ytdC - prevC);
            if (PL.co[i]) setC(drd, PL.co[i], val, NUM_FMT, AMBER, false, DIM_BG);
          });
        }
      });
    });

// ── Journal entries at node level (PL saved-mapping) — matches app: only AJE/RJE ──
    if (node.code && jrnByCode.has(String(node.code))) {
      const jrns = (jrnByCode.get(String(node.code)) || []).filter(j => {
        const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
        return jt === 'AJE' || jt === 'RJE';
      });
      if (jrns.length > 0) {
        // Header row
        ws.addRow([]);
        const jhr = ws.lastRow;
        jhr.height = 15;
        jhr.outlineLevel = Math.min(depth + 1, 7);
        jhr.hidden = true;
        const jnc = jhr.getCell(PL.name);
        jnc.value = `📋 Journal entries (${jrns.length})`;
        jnc.font = mkFont(true, INDIGO, 9);
        jnc.fill = mkFill(JRN_BG);
        jnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
        jnc.border = mkBorder();
        for (let c = 2; c <= plCols; c++) {
          jhr.getCell(c).fill = mkFill(JRN_BG);
          jhr.getCell(c).border = mkBorder();
        }
jrns.forEach(j => {
          const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
          ws.addRow([]);
          const jr = ws.lastRow;
          jr.height = 14;
          jr.outlineLevel = Math.min(depth + 2, 7);
          jr.hidden = true;
          const jec = jr.getCell(PL.name);
          const jnum = j.JournalNumber ?? j.journalNumber ?? '';
          const jhdr = j.JournalHeader ?? j.journalHeader ?? '';
          jec.value = `📄 ${jnum}${jhdr ? ' · ' + jhdr : ''}`;
          jec.font = mkFont(false, INDIGO, 9);
          jec.fill = mkFill(JRN_BG);
          jec.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
          jec.border = mkBorder();
setC(jr, PL.monA, -amt, NUM_FMT, INDIGO, false, JRN_BG);
          setC(jr, PL.ytdA, -amt, NUM_FMT, INDIGO, false, JRN_BG);
          if (hasMultiCo) {
            const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
            _selectedCo.forEach((co, i) => {
              const v = jrnCo === co ? -amt : 0;
              if (PL.co[i]) setC(jr, PL.co[i], v, NUM_FMT, INDIGO, false, JRN_BG);
            });
          }
          // Cross-period cells blank
          [PL.monB, PL.monBD, PL.monBP, PL.monC, PL.monCD, PL.monCP, PL.monD, PL.monDD, PL.monDP,
           ...PL.histMon,
           PL.ytdB, PL.ytdBD, PL.ytdBP, PL.ytdC, PL.ytdCD, PL.ytdCP, PL.ytdD, PL.ytdDD, PL.ytdDP,
           ...PL.histYtd,
           ...(hasMultiCo ? [] : PL.co)].forEach(ci => {
            if (ci) { const c = jr.getCell(ci); c.value = ''; c.fill = mkFill(JRN_BG); c.border = mkBorder(); }
          });
        });

// ── Compare-period-only journals (B/C/D not in A) ──
        if (hasB || hasC || hasD) {
          const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
          const seen = new Map();
          const collect = (idx, period) => {
            (idx.get(String(node.code)) || []).forEach(j => {
              const num = j.JournalNumber ?? j.journalNumber;
              if (aNums.has(num)) return;
              if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
              seen.get(num).periods[period] = -parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
            });
          };
          if (hasB) collect(jrnByCodeCmp,  'B');
          if (hasC) collect(jrnByCodeCmp2, 'C');
          if (hasD) collect(jrnByCodeCmp3, 'D');
          seen.forEach((entry, num) => {
            ['B','C','D'].forEach(p => {
              if (entry.periods[p] != null) return;
              const idx = p === 'B' ? jrnByCodeCmp : p === 'C' ? jrnByCodeCmp2 : jrnByCodeCmp3;
              const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
              if (match) entry.periods[p] = -parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
            });
          });
          if (seen.size > 0) {
            ws.addRow([]);
            const xhr = ws.lastRow;
            xhr.height = 14;
            xhr.outlineLevel = Math.min(depth + 2, 7);
            xhr.hidden = true;
            const xnc = xhr.getCell(PL.name);
            xnc.value = `↳ B/C/D only (${seen.size})`;
            xnc.font = mkFont(true, INDIGO, 9);
            xnc.fill = mkFill(JRN_BG);
            xnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
            xnc.border = mkBorder();
            for (let c = 2; c <= plCols; c++) { xhr.getCell(c).fill = mkFill(JRN_BG); xhr.getCell(c).border = mkBorder(); }
            seen.forEach((entry, num) => {
              ws.addRow([]);
              const xr = ws.lastRow;
              xr.height = 14;
              xr.outlineLevel = Math.min(depth + 3, 7);
              xr.hidden = true;
              const xec = xr.getCell(PL.name);
              const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
              xec.value = `📄 ${num}${jhdr ? ' · ' + jhdr : ''}`;
              xec.font = mkFont(false, INDIGO, 9);
              xec.fill = mkFill(JRN_BG);
              xec.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 4 };
              xec.border = mkBorder();
              if (hasB && entry.periods.B != null) { setC(xr, PL.monB, entry.periods.B, NUM_FMT, INDIGO, false, JRN_BG); setC(xr, PL.ytdB, entry.periods.B, NUM_FMT, INDIGO, false, JRN_BG); }
              if (hasC && entry.periods.C != null) { setC(xr, PL.monC, entry.periods.C, NUM_FMT, INDIGO, false, JRN_BG); setC(xr, PL.ytdC, entry.periods.C, NUM_FMT, INDIGO, false, JRN_BG); }
              if (hasD && entry.periods.D != null) { setC(xr, PL.monD, entry.periods.D, NUM_FMT, INDIGO, false, JRN_BG); setC(xr, PL.ytdD, entry.periods.D, NUM_FMT, INDIGO, false, JRN_BG); }
              [PL.monA, PL.ytdA, PL.monBD, PL.monBP, PL.monCD, PL.monCP, PL.monDD, PL.monDP,
               PL.ytdBD, PL.ytdBP, PL.ytdCD, PL.ytdCP, PL.ytdDD, PL.ytdDP,
               ...PL.histMon, ...PL.histYtd, ...PL.co].forEach(ci => {
                if (ci && !xr.getCell(ci).value) { const c = xr.getCell(ci); c.value = ''; c.fill = mkFill(JRN_BG); c.border = mkBorder(); }
              });
            });
          }
        }
      }
    }

    // Recurse mapping children (preserve literal hierarchy)
    (node.children || []).forEach(child => writeNode(child, depth + 1));
  };

  // ── Render sections exactly as savedPlLiteral describes them ──
console.log('[Export] savedPlLiteral sections', savedPlLiteral?.map(s => ({
    keys: Object.keys(s || {}),
    label: s?.label, name: s?.name, title: s?.title, breaker: s?.breaker, breakerLabel: s?.breakerLabel,
    color: s?.color, colour: s?.colour, bg: s?.bg, background: s?.background,
    nodes: s?.nodes?.length,
  })));

  savedPlLiteral.forEach((section) => {
    const lbl = section.label ?? section.name ?? section.title ?? section.breaker ?? section.breakerLabel ?? section.heading;
    const col = section.color ?? section.colour ?? section.bg ?? section.background ?? section.fill;
    if (lbl) {
      ws.addRow([]);
      const dr = ws.lastRow;
      dr.height = 22;
      const raw = String(col || '').trim();
      const hex = raw.startsWith('#') ? raw.slice(1) : raw.startsWith('FF') && raw.length === 8 ? raw.slice(2) : raw;
      const divColor = /^[0-9a-fA-F]{6}$/.test(hex) ? `FF${hex.toUpperCase()}` : DIV_BLUE;
      for (let c = 1; c <= plCols; c++) {
        dr.getCell(c).fill = mkFill(divColor);
        dr.getCell(c).border = { bottom: { style: 'thin', color: { argb: divColor } } };
      }
      dr.getCell(1).value = String(lbl).toUpperCase();
      dr.getCell(1).font = mkFont(true, WHITE, 11);
      dr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.mergeCells(dr.number, 1, dr.number, plCols);
      zebra = 0;
    }
    (section.nodes || []).forEach(n => writeNode(n, 0));
  });
};

// ═══════════════════════════════════════════════════════════
// SAVED LITERAL BALANCE SHEET — single sheet, matches app
// ═══════════════════════════════════════════════════════════
const buildSavedBSSheet = (ws) => {
  ws.views = [{ state: 'frozen', ySplit: bsHasB ? 4 : 3, showOutlineSymbols: true }];
  ws.properties.outlineLevelRow = 0;

  // ── Title ──
  ws.addRow([]);
  const r1 = ws.lastRow;
  r1.height = 32;
  r1.getCell(1).value = `Balance Sheet`;
  r1.getCell(1).font = mkFont(true, WHITE, 14);
  r1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  for (let c = 1; c <= bsCols; c++) r1.getCell(c).fill = mkFill(NAVY);
  ws.mergeCells(r1.number, 1, r1.number, bsCols);

  ws.addRow([]);
  const r2 = ws.lastRow;
  r2.height = 16;
  r2.getCell(1).value = `A: ${aLabel}`;
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
    if (bsHasD) parts.push(`D: ${bsDLabel}`);
    r3.getCell(1).value = parts.join('    |    ');
    r3.getCell(1).font = mkFont(false, 'FFFCD34D', 9);
    r3.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    for (let c = 1; c <= bsCols; c++) r3.getCell(c).fill = mkFill(NAVY);
    ws.mergeCells(r3.number, 1, r3.number, bsCols);
  }

  // ── Headers ──
  ws.addRow([]);
  const rh = ws.lastRow;
  rh.height = 22;
  const headers = [[BS.name, 'ACCOUNT', 'left', NAVY], [BS.act, 'ACTUAL', 'right', NAVY]];
  if (bsHasB) headers.push([BS.cmp, 'B', 'right', RED], [BS.cmpD, 'Δ', 'right', RED], [BS.cmpP, 'Δ%', 'right', RED]);
  if (bsHasC) headers.push([BS.cmp2, 'C', 'right', GRN], [BS.cmp2D, 'Δ', 'right', GRN], [BS.cmp2P, 'Δ%', 'right', GRN]);
  if (bsHasD) headers.push([BS.cmp3, 'D', 'right', PURPLE], [BS.cmp3D, 'Δ', 'right', PURPLE], [BS.cmp3P, 'Δ%', 'right', PURPLE]);
  if (hasHistoryBS) bsHistMaps.forEach((h, i) => {
    const moLbl = MONTHS.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3).toUpperCase() ?? String(h.month);
    headers.push([BS.hist[i], `${moLbl} ${h.year}`, 'right', NAVY_DK]);
  });
if (hasMultiCo) perCoMaps.forEach((c, i) => headers.push([BS.co[i], c.legal, 'right', NAVY]));

  headers.filter(h => Array.isArray(h) && Number.isFinite(h[0]) && h[0] > 0).forEach(([ci, lbl, align, fillArgb]) => {
    const c = rh.getCell(ci);
    c.value = lbl;
    c.font = mkFont(true, WHITE, 9);
    c.fill = mkFill(fillArgb);
    c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
    c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
  });

ws.getColumn(BS.name).width = 56;
  if (BS.act) ws.getColumn(BS.act).width = 16;
  if (bsHasB) [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => { ws.getColumn(ci).width = ci === BS.cmp ? 16 : ci === BS.cmpD ? 13 : 10; });
  if (bsHasC) [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => { ws.getColumn(ci).width = ci === BS.cmp2 ? 16 : ci === BS.cmp2D ? 13 : 10; });
  if (bsHasD) [BS.cmp3, BS.cmp3D, BS.cmp3P].forEach(ci => { ws.getColumn(ci).width = ci === BS.cmp3 ? 16 : ci === BS.cmp3D ? 13 : 10; });
  if (hasHistoryBS) BS.hist.forEach(ci => { ws.getColumn(ci).width = 15; });
  if (hasMultiCo) BS.co.forEach(ci => { ws.getColumn(ci).width = 20; });

  // ── BS literal sum: flat (no monthly delta), with dim filter support ──
  const buildBsAccIdx = (rows) => {
    const acc = new Map();
    const dim = new Map();
    (rows || []).forEach(row => {
      const code = String(getField(row, 'accountCode') ?? '');
      if (!code) return;
      const amt = parseAmt(getField(row, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
      acc.set(code, (acc.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, 'Dimensions', 'dimensions') ?? '');
      if (!dimsStr) return;
      dimsStr.split('||').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(':'); if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        dim.set(`${code}|${g}:${v}`, (dim.get(`${code}|${g}:${v}`) ?? 0) + amt);
      });
    });
    return { acc, dim };
  };

const aBs = buildBsAccIdx(uploadedAccounts);
  const bBs = bsHasB ? buildBsAccIdx(bsCmpUploadedAccounts) : null;
  const cBs = bsHasC ? buildBsAccIdx(bsCmp2UploadedAccounts) : null;
  const dBs = bsHasD ? buildBsAccIdx(bsCmp3UploadedAccounts) : null;

  // Per-company trees for multi-co BS (built once)
  const bsTreeByCode = (rows) => {
    const m = new Map();
    (function w(nodes) { nodes.forEach(n => { m.set(String(n.code), n); w(n.children || []); }); })(buildTree(groupAccounts, rows || []));
    return m;
  };
  const perCoBsTrees = hasMultiCo ? _selectedCo.map(co => ({
    tree: bsTreeByCode((uploadedAccounts || []).filter(r => getCoF(r) === co)),
  })) : [];

  const sumBsLit = (node, src) => {
    if (!src) return 0;
    if (node.dims && node.dims.length > 0) {
      let total = 0;
      node.dims.forEach(d => { total += src.dim.get(`${node.code}|${d}`) ?? 0; });
      return total;
    }
    return src.acc.get(String(node.code)) ?? 0;
  };

  const sumBsWithKids = (node, src) => {
    let total = sumBsLit(node, src);
    if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
      node.children.forEach(c => { total += sumBsLit(c, src); });
    }
    return total;
  };

  const isHl = (node) => savedHighlightedIds && (
    savedHighlightedIds.has?.(node.id) || savedHighlightedIds.has?.(node.originalId)
  );

  const dA = (a, b) => a - b;
  const dP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

// Pre-build leaf indexes + tree ONCE
  const buildBsLeafOnce = (rows) => {
    const m = new Map();
    (rows || []).forEach(r => {
      const lac = String(getField(r, 'localAccountCode') ?? '');
      if (!lac) return;
      m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
    });
    return m;
  };
  const bsBLeafIdxOnce = bsHasB ? buildBsLeafOnce(bsCmpUploadedAccounts) : new Map();
  const bsCLeafIdxOnce = bsHasC ? buildBsLeafOnce(bsCmp2UploadedAccounts) : new Map();
  const bsDLeafIdxOnce = bsHasD ? buildBsLeafOnce(bsCmp3UploadedAccounts) : new Map();

  const bsTreeByCodeOnce = (function build() {
    const m = new Map();
    (function w(nodes) { nodes.forEach(n => { m.set(String(n.code), n); w(n.children || []); }); })(buildTree(groupAccounts, uploadedAccounts || []));
    return m;
  })();

  const bsRowsByLac = new Map();
  (uploadedAccounts || []).forEach(r => {
    const lac = String(getField(r, 'localAccountCode', 'LocalAccountCode') ?? '');
    if (!lac) return;
    if (!bsRowsByLac.has(lac)) bsRowsByLac.set(lac, []);
    bsRowsByLac.get(lac).push(r);
  });

  let zebra = 0;

  const writeBsNode = (node, depth) => {
    const a = sumBsWithKids(node, aBs);
    const bv = bsHasB ? sumBsWithKids(node, bBs) : null;
    const cv = bsHasC ? sumBsWithKids(node, cBs) : null;
    const dv = bsHasD ? sumBsWithKids(node, dBs) : null;

    const hl = isHl(node);
    const bg = hl ? LIGHT : (zebra % 2 === 0 ? WHITE : STRIPE);
    zebra++;
    const nameColor = hl ? NAVY : (depth === 0 ? NAVY : TEXT_DK);
    const valColor = hl ? NAVY : TEXT_DK;
    const bold = hl || depth === 0;

    ws.addRow([]);
    const dr = ws.lastRow;
    dr.height = hl ? 19 : 17;

    const nc = dr.getCell(BS.name);
    const txt = depth === 0 ? (node.name || '').toUpperCase() : (node.name || '');
    if (node.code) {
      nc.value = { richText: [
        { text: `${node.code}    `, font: { name: 'Consolas', color: { argb: 'FF9CA3AF' }, size: 9 } },
        { text: txt, font: { name: 'Calibri', color: { argb: nameColor }, size: 10, bold } },
      ]};
    } else {
      nc.value = txt;
      nc.font = mkFont(bold, nameColor, 10);
    }
    nc.fill = mkFill(bg);
    nc.alignment = { horizontal: 'left', vertical: 'middle', indent: Math.max(1, depth + 1) };
    nc.border = mkBorder();

    setC(dr, BS.act, a, NUM_FMT, valColor, bold, bg);
    if (bsHasB) {
      setC(dr, BS.cmp, bv, NUM_FMT, RED, bold, bg);
      const diff = dA(a, bv);
      setC(dr, BS.cmpD, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, BS.cmpP, dP(a, bv), PCT_FMT, devColor(diff), bold, bg);
    }
    if (bsHasC) {
      setC(dr, BS.cmp2, cv, NUM_FMT, GRN, bold, bg);
      const diff = dA(a, cv);
      setC(dr, BS.cmp2D, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, BS.cmp2P, dP(a, cv), PCT_FMT, devColor(diff), bold, bg);
    }
    if (bsHasD) {
      setC(dr, BS.cmp3, dv, NUM_FMT, PURPLE, bold, bg);
      const diff = dA(a, dv);
      setC(dr, BS.cmp3D, diff, NUM_FMT, devColor(diff), bold, bg);
      setC(dr, BS.cmp3P, dP(a, dv), PCT_FMT, devColor(diff), bold, bg);
    }
    if (hasHistoryBS) bsHistMaps.forEach((h, i) => {
      const n = h.map.get(String(node.code));
      const raw = n ? sumNode(n) : 0;
      setC(dr, BS.hist[i], raw, NUM_FMT, valColor, bold, bg);
    });
if (hasMultiCo) perCoBsTrees.forEach((cot, i) => {
      const ga = cot.tree.get(String(node.code));
      let total = ga ? sumNode(ga) : 0;
      if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
        node.children.forEach(ch => {
          const g = cot.tree.get(String(ch.code));
          if (g) total += sumNode(g);
        });
      }
      setC(dr, BS.co[i], total, NUM_FMT, valColor, bold, bg);
    });

// ── Drill-down: uploadLeaves + dimensions ──
    const gaNodeB = bsTreeByCodeOnce.get(String(node.code));
    let leavesB = (gaNodeB?.uploadLeaves || []).filter(l => l.type !== 'plain');

    if (node.dims && node.dims.length > 0 && leavesB.length > 0) {
      const accepted = new Set(node.dims.map(d => String(d)));
      const filtered = leavesB.filter(leaf => {
        const leafRows = bsRowsByLac.get(String(leaf.code ?? '')) || [];
        return leafRows.some(r => {
          const dimsStr = String(getField(r, 'Dimensions', 'dimensions') ?? '');
          if (!dimsStr) return false;
          return dimsStr.split('||').map(s => s.trim()).filter(Boolean).some(pair => {
            const i = pair.indexOf(':'); if (i === -1) return false;
            const g = pair.slice(0, i).trim();
            const v = pair.slice(i + 1).trim();
            return accepted.has(`${g}:${v}`) || [...accepted].some(sk => {
              const colon = sk.indexOf(':');
              const sv = colon === -1 ? sk : sk.slice(colon + 1);
              return sv === v;
            });
          });
        });
      });
      if (filtered.length > 0) leavesB = filtered;
    }

   leavesB.forEach((leaf) => {
      const amt = leaf.amount ?? 0;
      ws.addRow([]);
      const dr2 = ws.lastRow;
      dr2.height = 15;
      dr2.outlineLevel = Math.min(depth + 1, 7);
      dr2.hidden = true;

      const lnc = dr2.getCell(BS.name);
      lnc.value = `${leaf.code || ''}  ${leaf.name || ''}`.trim();
      lnc.font = mkFont(false, TEXT_MUT, 9, true);
      lnc.fill = mkFill(LEAF_BG);
      lnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
      lnc.border = mkBorder();
      setC(dr2, BS.act, amt, NUM_FMT, TEXT_MUT, false, LEAF_BG);
if (bsHasB && leaf.code) {
        const bV = bsBLeafIdxOnce.get(String(leaf.code)) ?? 0;
        setC(dr2, BS.cmp, bV, NUM_FMT, RED, false, LEAF_BG);
        const d = dA(amt, bV); setC(dr2, BS.cmpD, d, NUM_FMT, devColor(d), false, LEAF_BG);
        setC(dr2, BS.cmpP, dP(amt, bV), PCT_FMT, devColor(d), false, LEAF_BG);
      }
if (bsHasC && leaf.code) {
        const cV = bsCLeafIdxOnce.get(String(leaf.code)) ?? 0;
        setC(dr2, BS.cmp2, cV, NUM_FMT, GRN, false, LEAF_BG);
        const d = dA(amt, cV); setC(dr2, BS.cmp2D, d, NUM_FMT, devColor(d), false, LEAF_BG);
        setC(dr2, BS.cmp2P, dP(amt, cV), PCT_FMT, devColor(d), false, LEAF_BG);
      }
if (bsHasD && leaf.code) {
        const dV = bsDLeafIdxOnce.get(String(leaf.code)) ?? 0;
        setC(dr2, BS.cmp3, dV, NUM_FMT, PURPLE, false, LEAF_BG);
        const d = dA(amt, dV); setC(dr2, BS.cmp3D, d, NUM_FMT, devColor(d), false, LEAF_BG);
        setC(dr2, BS.cmp3P, dP(amt, dV), PCT_FMT, devColor(d), false, LEAF_BG);
      }

      let dimChildrenB = leaf.children || [];
      if (node.dims && node.dims.length > 0) {
        const accepted = new Set(node.dims.map(d => String(d)));
        dimChildrenB = dimChildrenB.filter(dim => {
          const dc = String(dim.code ?? ''); const dn = String(dim.name ?? '');
          return [...accepted].some(sk => {
            const colon = sk.indexOf(':');
            const sv = colon === -1 ? sk : sk.slice(colon + 1);
            return sv === dc || sv === dn;
          });
        });
      }
if (!ws._savedBsLeafDimIdx) {
        const buildBDI = (rows) => {
          const m = new Map();
          (rows || []).forEach(r => {
            const l = String(getField(r, 'localAccountCode') ?? '');
            const dcd = String(getField(r, 'dimensionCode') ?? '');
            if (!l || !dcd || dcd === 'null') return;
            const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
            m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
          });
          return m;
        };
        ws._savedBsLeafDimIdx = {
          b: bsHasB ? buildBDI(bsCmpUploadedAccounts) : new Map(),
          c: bsHasC ? buildBDI(bsCmp2UploadedAccounts) : new Map(),
          d: bsHasD ? buildBDI(bsCmp3UploadedAccounts) : new Map(),
        };
      }
      const sBLDI = ws._savedBsLeafDimIdx;
      const bsdA = (a, b) => a - b;
      const bsdP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

      dimChildrenB.forEach(dim => {
        ws.addRow([]);
        const drd = ws.lastRow;
        drd.height = 15;
        drd.outlineLevel = Math.min(depth + 2, 7);
        drd.hidden = true;
        const dnc = drd.getCell(BS.name);
        dnc.value = `◆  ${dim.name || dim.code || ''}`;
        dnc.font = mkFont(false, AMBER, 9);
        dnc.fill = mkFill(DIM_BG);
        dnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
        dnc.border = mkBorder();

        const lac = String(leaf.code ?? '');
        const dc  = String(dim.code ?? '');
        const key = lac && dc ? `${lac}|${dc}` : null;
        const amtA = dim.amount ?? 0;

        setC(drd, BS.act, amtA, NUM_FMT, AMBER, false, DIM_BG);

        if (bsHasB && key) {
          const v = sBLDI.b.get(key) ?? 0;
          setC(drd, BS.cmp, v, NUM_FMT, RED, false, DIM_BG);
          const d = bsdA(amtA, v); setC(drd, BS.cmpD, d, NUM_FMT, devColor(d), false, DIM_BG);
          setC(drd, BS.cmpP, bsdP(amtA, v), PCT_FMT, devColor(d), false, DIM_BG);
        }
        if (bsHasC && key) {
          const v = sBLDI.c.get(key) ?? 0;
          setC(drd, BS.cmp2, v, NUM_FMT, GRN, false, DIM_BG);
          const d = bsdA(amtA, v); setC(drd, BS.cmp2D, d, NUM_FMT, devColor(d), false, DIM_BG);
          setC(drd, BS.cmp2P, bsdP(amtA, v), PCT_FMT, devColor(d), false, DIM_BG);
        }
if (bsHasD && key) {
          const v = sBLDI.d.get(key) ?? 0;
          setC(drd, BS.cmp3, v, NUM_FMT, PURPLE, false, DIM_BG);
          const d = bsdA(amtA, v); setC(drd, BS.cmp3D, d, NUM_FMT, devColor(d), false, DIM_BG);
          setC(drd, BS.cmp3P, bsdP(amtA, v), PCT_FMT, devColor(d), false, DIM_BG);
        }
        if (hasMultiCo && key) {
          if (!ws._savedBsPerCoLeafDimIdx) {
            const buildBDIco = (rows) => {
              const m = new Map();
              (rows || []).forEach(r => {
                const l = String(getField(r, 'localAccountCode') ?? '');
                const dcd = String(getField(r, 'dimensionCode') ?? '');
                if (!l || !dcd || dcd === 'null') return;
                const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
                m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
              });
              return m;
            };
            ws._savedBsPerCoLeafDimIdx = _selectedCo.map(co =>
              buildBDIco((uploadedAccounts || []).filter(r => getCoF(r) === co))
            );
          }
          ws._savedBsPerCoLeafDimIdx.forEach((idx, i) => {
            const v = idx.get(key) ?? 0;
            if (BS.co[i]) setC(drd, BS.co[i], v, NUM_FMT, AMBER, false, DIM_BG);
          });
        }
      });
    });

// ── Journal entries at node level (BS saved-mapping) — matches app: only AJE/RJE ──
    if (node.code && jrnByCode.has(String(node.code))) {
      const jrns = (jrnByCode.get(String(node.code)) || []).filter(j => {
        const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
        return jt === 'AJE' || jt === 'RJE';
      });
      if (jrns.length > 0) {
        ws.addRow([]);
        const jhr = ws.lastRow;
        jhr.height = 15;
        jhr.outlineLevel = Math.min(depth + 1, 7);
        jhr.hidden = true;
        const jnc = jhr.getCell(BS.name);
        jnc.value = `📋 Journal entries (${jrns.length})`;
        jnc.font = mkFont(true, INDIGO, 9);
        jnc.fill = mkFill(JRN_BG);
        jnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 2 };
        jnc.border = mkBorder();
        for (let c = 2; c <= bsCols; c++) {
          jhr.getCell(c).fill = mkFill(JRN_BG);
          jhr.getCell(c).border = mkBorder();
        }
jrns.forEach(j => {
          const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
          ws.addRow([]);
          const jr = ws.lastRow;
          jr.height = 14;
          jr.outlineLevel = Math.min(depth + 2, 7);
          jr.hidden = true;
          const jec = jr.getCell(BS.name);
          const jnum = j.JournalNumber ?? j.journalNumber ?? '';
          const jhdr = j.JournalHeader ?? j.journalHeader ?? '';
          jec.value = `📄 ${jnum}${jhdr ? ' · ' + jhdr : ''}`;
          jec.font = mkFont(false, INDIGO, 9);
          jec.fill = mkFill(JRN_BG);
          jec.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
          jec.border = mkBorder();
setC(jr, BS.act, amt, NUM_FMT, INDIGO, false, JRN_BG);
          if (hasMultiCo) {
            const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
            _selectedCo.forEach((co, i) => {
              const v = jrnCo === co ? amt : 0;
              if (BS.co[i]) setC(jr, BS.co[i], v, NUM_FMT, INDIGO, false, JRN_BG);
            });
          }
          [...(bsHasB ? [BS.cmp, BS.cmpD, BS.cmpP] : []),
           ...(bsHasC ? [BS.cmp2, BS.cmp2D, BS.cmp2P] : []),
           ...(bsHasD ? [BS.cmp3, BS.cmp3D, BS.cmp3P] : []),
           ...BS.hist,
           ...(hasMultiCo ? [] : BS.co)].forEach(ci => {
            if (ci) { const c = jr.getCell(ci); c.value = ''; c.fill = mkFill(JRN_BG); c.border = mkBorder(); }
          });
        });

if (bsHasB || bsHasC || bsHasD) {
          const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
          const seen = new Map();
          const collect = (idx, period) => {
            (idx.get(String(node.code)) || []).forEach(j => {
              const num = j.JournalNumber ?? j.journalNumber;
              if (aNums.has(num)) return;
              if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
              seen.get(num).periods[period] = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
            });
          };
          if (bsHasB) collect(jrnByCodeCmp,  'B');
          if (bsHasC) collect(jrnByCodeCmp2, 'C');
          if (bsHasD) collect(jrnByCodeCmp3, 'D');
          seen.forEach((entry, num) => {
            ['B','C','D'].forEach(p => {
              if (entry.periods[p] != null) return;
              const idx = p === 'B' ? jrnByCodeCmp : p === 'C' ? jrnByCodeCmp2 : jrnByCodeCmp3;
              const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
              if (match) entry.periods[p] = parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
            });
          });
          if (seen.size > 0) {
            ws.addRow([]);
            const xhr = ws.lastRow;
            xhr.height = 14;
            xhr.outlineLevel = Math.min(depth + 2, 7);
            xhr.hidden = true;
            const xnc = xhr.getCell(BS.name);
            xnc.value = `↳ B/C/D only (${seen.size})`;
            xnc.font = mkFont(true, INDIGO, 9);
            xnc.fill = mkFill(JRN_BG);
            xnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
            xnc.border = mkBorder();
            for (let c = 2; c <= bsCols; c++) { xhr.getCell(c).fill = mkFill(JRN_BG); xhr.getCell(c).border = mkBorder(); }
            seen.forEach((entry, num) => {
              ws.addRow([]);
              const xr = ws.lastRow;
              xr.height = 14;
              xr.outlineLevel = Math.min(depth + 3, 7);
              xr.hidden = true;
              const xec = xr.getCell(BS.name);
              const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
              xec.value = `📄 ${num}${jhdr ? ' · ' + jhdr : ''}`;
              xec.font = mkFont(false, INDIGO, 9);
              xec.fill = mkFill(JRN_BG);
              xec.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 4 };
              xec.border = mkBorder();
              if (bsHasB && entry.periods.B != null) setC(xr, BS.cmp,  entry.periods.B, NUM_FMT, INDIGO, false, JRN_BG);
              if (bsHasC && entry.periods.C != null) setC(xr, BS.cmp2, entry.periods.C, NUM_FMT, INDIGO, false, JRN_BG);
              if (bsHasD && entry.periods.D != null) setC(xr, BS.cmp3, entry.periods.D, NUM_FMT, INDIGO, false, JRN_BG);
              [BS.act, BS.cmpD, BS.cmpP, BS.cmp2D, BS.cmp2P, BS.cmp3D, BS.cmp3P, ...BS.hist, ...BS.co].forEach(ci => {
                if (ci && !xr.getCell(ci).value) { const c = xr.getCell(ci); c.value = ''; c.fill = mkFill(JRN_BG); c.border = mkBorder(); }
              });
            });
          }
        }
      }
    }

    (node.children || []).forEach(child => writeBsNode(child, depth + 1));
  };

console.log('[Export] savedBsLiteral sections', savedBsLiteral?.map(s => ({
    keys: Object.keys(s || {}),
    label: s?.label, name: s?.name, title: s?.title, breaker: s?.breaker, breakerLabel: s?.breakerLabel,
    color: s?.color, colour: s?.colour, bg: s?.bg, background: s?.background,
    nodes: s?.nodes?.length,
  })));

  savedBsLiteral.forEach((section) => {
    const lbl = section.label ?? section.name ?? section.title ?? section.breaker ?? section.breakerLabel ?? section.heading;
    const col = section.color ?? section.colour ?? section.bg ?? section.background ?? section.fill;
    if (lbl) {
      ws.addRow([]);
      const dr = ws.lastRow;
      dr.height = 22;
      const raw = String(col || '').trim();
      const hex = raw.startsWith('#') ? raw.slice(1) : raw.startsWith('FF') && raw.length === 8 ? raw.slice(2) : raw;
      const divColor = /^[0-9a-fA-F]{6}$/.test(hex) ? `FF${hex.toUpperCase()}` : DIV_BLUE;
      for (let c = 1; c <= bsCols; c++) {
        dr.getCell(c).fill = mkFill(divColor);
        dr.getCell(c).border = { bottom: { style: 'thin', color: { argb: divColor } } };
      }
      dr.getCell(1).value = String(lbl).toUpperCase();
      dr.getCell(1).font = mkFont(true, WHITE, 11);
      dr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.mergeCells(dr.number, 1, dr.number, bsCols);
      zebra = 0;
    }
    (section.nodes || []).forEach(n => writeBsNode(n, 0));
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
        if (bsHasD) parts.push(`D: ${bsDLabel}`);
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
if (bsHasD) {
        headers.push([BS.cmp3,  'D',  'right', PURPLE]);
        headers.push([BS.cmp3D, 'Δ',  'right', PURPLE]);
        headers.push([BS.cmp3P, 'Δ%', 'right', PURPLE]);
      }
if (hasHistoryBS) {
        bsHistMaps.forEach((h, i) => {
          const moLbl = MONTHS.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3).toUpperCase() ?? String(h.month);
          headers.push([BS.hist[i], `${moLbl} ${h.year}`, 'right', NAVY_DK]);
        });
      }
if (hasMultiCo) {
        perCoMaps.forEach((c, i) => headers.push([BS.co[i], c.legal, 'right', NAVY]));
      }
      headers.filter(h => Array.isArray(h) && Number.isFinite(h[0]) && h[0] > 0).forEach(([ci, lbl, align, fillArgb]) => {
        const c = rh.getCell(ci);
        c.value = lbl;
        c.font = mkFont(true, WHITE, 9);
        c.fill = mkFill(fillArgb);
        c.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
        c.border = { bottom: { style: 'medium', color: { argb: NAVY_DK } } };
      });

// Widths + grouping on compare columns
      ws.getColumn(BS.name).width = 52;
      if (BS.act) ws.getColumn(BS.act).width = 16;
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
if (bsHasD) {
        [BS.cmp3, BS.cmp3D, BS.cmp3P].forEach(ci => {
          const col = ws.getColumn(ci);
          col.width = ci === BS.cmp3 ? 16 : ci === BS.cmp3D ? 13 : 10;
          col.outlineLevel = 3;
        });
      }
    if (hasHistoryBS) BS.hist.forEach(ci => { ws.getColumn(ci).width = 15; });
      if (hasMultiCo) BS.co.forEach(ci => { ws.getColumn(ci).width = 20; });

// ── Build real BS breakers from mapping/Supabase (matches BalanceSheet.effectiveBreakersBs) ──
      const hexToArgbBs = (h) => {
        const s = String(h || '').replace('#', '').replace(/^FF/i, '').toUpperCase();
        return /^[0-9A-F]{6}$/.test(s) ? `FF${s}` : DIV_BLUE;
      };
      const paletteArgbBs = [hexToArgbBs(colors.primary), hexToArgbBs(colors.secondary), hexToArgbBs(colors.tertiary)];

      const BS_DIVIDERS = (() => {
        // PGC BS mapping path
        if (pgcBsMapping?.rows && pgcBsMapping?.sections) {
          const flatNodes = [];
          (function walk(nodes) {
            nodes.forEach(n => {
              if (hasData(n) && n.accountType === 'B/S') {
                const m = pgcBsMapping.rows.get(String(n.code));
                if (m && m.isSum) flatNodes.push({ node: n, sortOrder: m.sortOrder, section: m.section });
              }
              walk(n.children || []);
            });
          })(tree);
          flatNodes.sort((a,b) => a.sortOrder - b.sortOrder);
          const seen = new Set();
          const out = {};
          let i = 0;
          for (const { node, section } of flatNodes) {
            if (seen.has(section)) continue;
            seen.add(section);
            const sec = pgcBsMapping.sections.get(section);
            if (sec) {
              out[String(node.code)] = { label: sec.label, argb: paletteArgbBs[i] ?? hexToArgbBs(sec.color) };
              i++;
            }
          }
          if (Object.keys(out).length > 0) return out;
        }
        // Legacy Supabase breakers
        const legacy = breakers.bs ?? {};
        const codes = Object.keys(legacy).sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
        if (codes.length > 0) {
          const out = {};
          codes.forEach((code, i) => {
            out[code] = { label: legacy[code].label, argb: paletteArgbBs[i] ?? hexToArgbBs(legacy[code].color) };
          });
          return out;
        }
        // Hardcoded fallback
        return {
          '399999': { label: 'ACTIVO',          argb: DIV_BLUE },
          '499999': { label: 'PATRIMONIO NETO', argb: DIV_GRAY },
          '699999': { label: 'PASIVO',          argb: DIV_RED  },
          'C.ACT':  { label: 'ACTIVO',          argb: DIV_BLUE },
          'D.S':    { label: 'PATRIMONIO NETO', argb: DIV_GRAY },
          'E.S':    { label: 'PASIVO',          argb: DIV_RED  },
        };
      })();

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
      const writeBSRow = (node, depth) => {
        if (!hasData(node) || node.accountType !== 'B/S') return;

        const div = BS_DIVIDERS[String(node.code)];
        if (div) writeBSDivider(div);

        const isHighlighted = isBSHighlighted(node);
        const total = Number(node.code) >= 599999 ? -sumNode(node) : sumNode(node);
        const cRaw = bsHasB ? getYtd(bsCM, node.code) : 0;
        const cVal = bsHasB ? (Number(node.code) >= 599999 ? -cRaw : cRaw) : 0;
const c2Raw = bsHasC ? getYtd(bsC2M, node.code) : 0;
        const c2Val = bsHasC ? (Number(node.code) >= 599999 ? -c2Raw : c2Raw) : 0;
        const c3Raw = bsHasD ? getYtd(bsC3M, node.code) : 0;
        const c3Val = bsHasD ? (Number(node.code) >= 599999 ? -c3Raw : c3Raw) : 0;
        const dB = bsHasB ? total - cVal : 0;
        const dBP = bsHasB && cVal !== 0 ? dB / Math.abs(cVal) : null;
        const dC = bsHasC ? total - c2Val : 0;
        const dCP = bsHasC && c2Val !== 0 ? dC / Math.abs(c2Val) : null;
        const dD = bsHasD ? total - c3Val : 0;
        const dDP = bsHasD && c3Val !== 0 ? dD / Math.abs(c3Val) : null;

        const bg = isHighlighted ? LIGHT : (bsZebra % 2 === 0 ? WHITE : STRIPE);
        bsZebra++;

        const nameColor = isHighlighted ? NAVY : TEXT_DK;

        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = isHighlighted ? 19 : 17;
        // BS hierarchy rows stay VISIBLE (like the app — all structural levels shown)
        // We don't set outlineLevel on structural rows, only on drill-down (leaves/dims/journal)
const nc = dr.getCell(BS.name);
        const bnmTxt = isHighlighted ? (node.name || '').toUpperCase() : (node.name || '');
        if (node.code) {
          nc.value = {
            richText: [
              { text: `${node.code}    `, font: { name: 'Consolas', color: { argb: 'FF9CA3AF' }, size: 9 } },
              { text: bnmTxt, font: { name: 'Calibri', color: { argb: nameColor }, size: 10, bold: isHighlighted } },
            ]
          };
        } else {
          nc.value = bnmTxt;
          nc.font = mkFont(isHighlighted, nameColor, 10);
        }
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
if (bsHasD) {
          setC(dr, BS.cmp3,  c3Val, NUM_FMT, PURPLE, isHighlighted, bg);
          setC(dr, BS.cmp3D, dD,    NUM_FMT, devColor(dD), isHighlighted, bg);
          setC(dr, BS.cmp3P, dDP,   PCT_FMT, devColor(dD), isHighlighted, bg);
        }
if (hasHistoryBS) {
          bsHistMaps.forEach((h, i) => {
            const hRaw = getYtd(h.map, node.code);
            const hVal = Number(node.code) >= 599999 ? -hRaw : hRaw;
            setC(dr, BS.hist[i], hVal, NUM_FMT, nameColor, isHighlighted, bg);
          });
        }
        if (hasMultiCo) {
          perCoMaps.forEach((c, i) => {
            const raw = getYtd(c.map, node.code);
            const val = Number(node.code) >= 599999 ? -raw : raw;
            setC(dr, BS.co[i], val, NUM_FMT, nameColor, isHighlighted, bg);
          });
        }

        // Recurse children — structural rows stay visible
        (node.children || [])
          .filter(c => hasData(c) && c.accountType === 'B/S')
          .forEach(c => writeBSRow(c, depth + 1));

// Drill-down: local accounts (collapsed) — fully populated with compare/history/multi-co values
        const bsLeafIdxOf = (rows) => {
          const m = new Map();
          (rows || []).forEach(r => {
            const lac = String(getField(r, 'localAccountCode') ?? '');
            if (!lac) return;
            m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
          });
          return m;
        };
        // Cache leaf indexes on the worksheet so we build them once per sheet
        if (!ws._bsLeafIdxCache) {
          ws._bsLeafIdxCache = {
            b:  bsHasB ? bsLeafIdxOf(bsCmpUploadedAccounts) : new Map(),
            c:  bsHasC ? bsLeafIdxOf(bsCmp2UploadedAccounts) : new Map(),
            d:  bsHasD ? bsLeafIdxOf(bsCmp3UploadedAccounts) : new Map(),
            hist: hasHistoryBS ? bsHist.map(h => bsLeafIdxOf(h.data || [])) : [],
            co:   hasMultiCo ? _selectedCo.map(co => bsLeafIdxOf((uploadedAccounts || []).filter(r => getCoF(r) === co))) : [],
          };
        }
        const bsIdx = ws._bsLeafIdxCache;
        const dA = (a, b) => a - b;
        const dP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

        (node.uploadLeaves || []).forEach(leaf => {
          if (leaf.type === 'plain') return;
          const lbg = LEAF_BG;
          const lac = String(leaf.code ?? '');
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
          const amtA = leaf.amount ?? 0;
          setC(lr, BS.act, amtA, NUM_FMT, TEXT_MUT, false, lbg);

          if (bsHasB && lac) {
            const bV = bsIdx.b.get(lac) ?? 0;
            setC(lr, BS.cmp, bV, NUM_FMT, RED, false, lbg);
            const d = dA(amtA, bV); setC(lr, BS.cmpD, d, NUM_FMT, devColor(d), false, lbg);
            setC(lr, BS.cmpP, dP(amtA, bV), PCT_FMT, devColor(d), false, lbg);
          } else if (bsHasB) {
            [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => { if (ci) { const c = lr.getCell(ci); c.value = ''; c.fill = mkFill(lbg); c.border = mkBorder(); }});
          }
          if (bsHasC && lac) {
            const cV = bsIdx.c.get(lac) ?? 0;
            setC(lr, BS.cmp2, cV, NUM_FMT, GRN, false, lbg);
            const d = dA(amtA, cV); setC(lr, BS.cmp2D, d, NUM_FMT, devColor(d), false, lbg);
            setC(lr, BS.cmp2P, dP(amtA, cV), PCT_FMT, devColor(d), false, lbg);
          } else if (bsHasC) {
            [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => { if (ci) { const c = lr.getCell(ci); c.value = ''; c.fill = mkFill(lbg); c.border = mkBorder(); }});
          }
          if (bsHasD && lac) {
            const dV = bsIdx.d.get(lac) ?? 0;
            setC(lr, BS.cmp3, dV, NUM_FMT, PURPLE, false, lbg);
            const d = dA(amtA, dV); setC(lr, BS.cmp3D, d, NUM_FMT, devColor(d), false, lbg);
            setC(lr, BS.cmp3P, dP(amtA, dV), PCT_FMT, devColor(d), false, lbg);
          } else if (bsHasD) {
            [BS.cmp3, BS.cmp3D, BS.cmp3P].forEach(ci => { if (ci) { const c = lr.getCell(ci); c.value = ''; c.fill = mkFill(lbg); c.border = mkBorder(); }});
          }
          if (hasHistoryBS) {
            BS.hist.forEach((ci, i) => {
              const v = lac ? (bsIdx.hist[i]?.get(lac) ?? 0) : 0;
              setC(lr, ci, v, NUM_FMT, TEXT_MUT, false, lbg);
            });
          }
          if (hasMultiCo) {
            BS.co.forEach((ci, i) => {
              const v = lac ? (bsIdx.co[i]?.get(lac) ?? 0) : 0;
              setC(lr, ci, v, NUM_FMT, TEXT_MUT, false, lbg);
            });
          }

// Build BS leaf+dim indexes once per sheet (cached on ws)
          if (!ws._bsDimIdxCache) {
            const buildBsLeafDimIdx = (rows) => {
              const m = new Map();
              (rows || []).forEach(r => {
                const l = String(getField(r, 'localAccountCode') ?? '');
                const dcd = String(getField(r, 'dimensionCode') ?? '');
                if (!l || !dcd || dcd === 'null') return;
                const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
                m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
              });
              return m;
            };
            ws._bsDimIdxCache = {
              b: bsHasB ? buildBsLeafDimIdx(bsCmpUploadedAccounts) : new Map(),
              c: bsHasC ? buildBsLeafDimIdx(bsCmp2UploadedAccounts) : new Map(),
              d: bsHasD ? buildBsLeafDimIdx(bsCmp3UploadedAccounts) : new Map(),
            };
          }
          const bsDimIdx = ws._bsDimIdxCache;
          const dimDA = (a, b) => a - b;
          const dimDP = (a, b) => b !== 0 ? (a - b) / Math.abs(b) : null;

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

            const lac = String(leaf.code ?? '');
            const dc  = String(dim.code ?? '');
            const key = lac && dc ? `${lac}|${dc}` : null;

            setC(dr2, BS.act, dim.amount, NUM_FMT, AMBER, false, dbg);

            if (bsHasB && key) {
              const bV = bsDimIdx.b.get(key) ?? 0;
              setC(dr2, BS.cmp, bV, NUM_FMT, RED, false, dbg);
              const d = dimDA(dim.amount, bV); setC(dr2, BS.cmpD, d, NUM_FMT, devColor(d), false, dbg);
              setC(dr2, BS.cmpP, dimDP(dim.amount, bV), PCT_FMT, devColor(d), false, dbg);
            } else if (bsHasB) {
              [BS.cmp, BS.cmpD, BS.cmpP].forEach(ci => { if (ci) { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }});
            }
            if (bsHasC && key) {
              const cV = bsDimIdx.c.get(key) ?? 0;
              setC(dr2, BS.cmp2, cV, NUM_FMT, GRN, false, dbg);
              const d = dimDA(dim.amount, cV); setC(dr2, BS.cmp2D, d, NUM_FMT, devColor(d), false, dbg);
              setC(dr2, BS.cmp2P, dimDP(dim.amount, cV), PCT_FMT, devColor(d), false, dbg);
            } else if (bsHasC) {
              [BS.cmp2, BS.cmp2D, BS.cmp2P].forEach(ci => { if (ci) { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }});
            }
            if (bsHasD && key) {
              const dV = bsDimIdx.d.get(key) ?? 0;
              setC(dr2, BS.cmp3, dV, NUM_FMT, PURPLE, false, dbg);
              const d = dimDA(dim.amount, dV); setC(dr2, BS.cmp3D, d, NUM_FMT, devColor(d), false, dbg);
              setC(dr2, BS.cmp3P, dimDP(dim.amount, dV), PCT_FMT, devColor(d), false, dbg);
            } else if (bsHasD) {
              [BS.cmp3, BS.cmp3D, BS.cmp3P].forEach(ci => { if (ci) { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }});
            }
if (hasHistoryBS) { BS.hist.forEach(ci => { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }); }
            if (hasMultiCo && key) {
              if (!ws._bsPerCoLeafDimIdx) {
                const buildBsLeafDimIdxCo = (rows) => {
                  const m = new Map();
                  (rows || []).forEach(r => {
                    const l = String(getField(r, 'localAccountCode') ?? '');
                    const dcd = String(getField(r, 'dimensionCode') ?? '');
                    if (!l || !dcd || dcd === 'null') return;
                    const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
                    m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
                  });
                  return m;
                };
                ws._bsPerCoLeafDimIdx = _selectedCo.map(co =>
                  buildBsLeafDimIdxCo((uploadedAccounts || []).filter(r => getCoF(r) === co))
                );
              }
              BS.co.forEach((ci, i) => {
                const v = ws._bsPerCoLeafDimIdx[i]?.get(key) ?? 0;
                setC(dr2, ci, v, NUM_FMT, AMBER, false, dbg);
              });
            } else if (hasMultiCo) { BS.co.forEach(ci => { const c = dr2.getCell(ci); c.value = ''; c.fill = mkFill(dbg); c.border = mkBorder(); }); }
          });
        });

// Journal entries
        const jrns = jrnByCode.get(String(node.code)) || [];
        if (jrns.length > 0) {
          const hbg = JRN_BG;
          const findMatchBs = (idx, accCode, jnum) => {
            if (!accCode || jnum === '') return null;
            const m = (idx.get(accCode) || []).find(jj => (jj.JournalNumber ?? jj.journalNumber) === jnum);
            return m ? parseAmt(m.AmountYTD ?? m.amountYTD ?? 0) : null;
          };
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
            const accCode = String(j.AccountCode ?? j.accountCode ?? node.code);
            const jnum = j.JournalNumber ?? j.journalNumber ?? '';
            const bVal = bsHasB ? findMatchBs(jrnByCodeCmp,  accCode, jnum) : null;
            const cVal = bsHasC ? findMatchBs(jrnByCodeCmp2, accCode, jnum) : null;
            const dVal = bsHasD ? findMatchBs(jrnByCodeCmp3, accCode, jnum) : null;
            ws.addRow([]);
            const jr = ws.lastRow;
            jr.height = 14;
            jr.outlineLevel = 2;
            jr.hidden = true;
            const jnc = jr.getCell(BS.name);
            const jhdr = j.JournalHeader ?? j.journalHeader ?? '';
            jnc.value = `📄 ${jnum}${jhdr ? ' · ' + jhdr : ''}`;
            jnc.font = mkFont(false, INDIGO, 9);
            jnc.fill = mkFill(hbg);
            jnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
            jnc.border = mkBorder();
setC(jr, BS.act, amt, NUM_FMT, INDIGO, false, hbg);
            if (bsHasB && bVal != null) setC(jr, BS.cmp,  bVal, NUM_FMT, INDIGO, false, hbg);
            if (bsHasC && cVal != null) setC(jr, BS.cmp2, cVal, NUM_FMT, INDIGO, false, hbg);
            if (bsHasD && dVal != null) setC(jr, BS.cmp3, dVal, NUM_FMT, INDIGO, false, hbg);
            if (hasMultiCo) {
              const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
              _selectedCo.forEach((co, i) => {
                const v = jrnCo === co ? amt : 0;
                if (BS.co[i]) setC(jr, BS.co[i], v, NUM_FMT, INDIGO, false, hbg);
              });
            }
            const blankBs = [
              ...(bsHasB ? [BS.cmpD, BS.cmpP, ...(bVal == null ? [BS.cmp] : [])] : []),
              ...(bsHasC ? [BS.cmp2D, BS.cmp2P, ...(cVal == null ? [BS.cmp2] : [])] : []),
              ...(bsHasD ? [BS.cmp3D, BS.cmp3P, ...(dVal == null ? [BS.cmp3] : [])] : []),
              ...(hasHistoryBS ? BS.hist : []),
            ];
            blankBs.forEach(ci => { if (ci) { const c = jr.getCell(ci); c.value = ''; c.fill = mkFill(hbg); c.border = mkBorder(); }});
          });
          // B/C/D-only journals
          if (bsHasB || bsHasC || bsHasD) {
            const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
            const seen = new Map();
            const collect = (idx, period) => {
              (idx.get(String(node.code)) || []).forEach(j => {
                const num = j.JournalNumber ?? j.journalNumber;
                if (aNums.has(num)) return;
                if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                seen.get(num).periods[period] = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
              });
            };
            if (bsHasB) collect(jrnByCodeCmp, 'B');
            if (bsHasC) collect(jrnByCodeCmp2, 'C');
            if (bsHasD) collect(jrnByCodeCmp3, 'D');
            seen.forEach((entry, num) => {
              ['B','C','D'].forEach(p => {
                if (entry.periods[p] != null) return;
                const idx = p === 'B' ? jrnByCodeCmp : p === 'C' ? jrnByCodeCmp2 : jrnByCodeCmp3;
                const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
                if (match) entry.periods[p] = parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
              });
            });
            if (seen.size > 0) {
              ws.addRow([]);
              const xhr = ws.lastRow;
              xhr.height = 14;
              xhr.outlineLevel = 2;
              xhr.hidden = true;
              const xnc = xhr.getCell(BS.name);
              xnc.value = `↳ B/C/D only (${seen.size})`;
              xnc.font = mkFont(true, INDIGO, 9);
              xnc.fill = mkFill(JRN_BG);
              xnc.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 3 };
              xnc.border = mkBorder();
              for (let c = 2; c <= bsCols; c++) { xhr.getCell(c).fill = mkFill(JRN_BG); xhr.getCell(c).border = mkBorder(); }
              seen.forEach((entry, num) => {
                ws.addRow([]);
                const xr = ws.lastRow;
                xr.height = 14;
                xr.outlineLevel = 3;
                xr.hidden = true;
                const xec = xr.getCell(BS.name);
                const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
                xec.value = `📄 ${num}${jhdr ? ' · ' + jhdr : ''}`;
                xec.font = mkFont(false, INDIGO, 9);
                xec.fill = mkFill(JRN_BG);
                xec.alignment = { horizontal: 'left', vertical: 'middle', indent: depth + 4 };
                xec.border = mkBorder();
                if (bsHasB && entry.periods.B != null) setC(xr, BS.cmp,  entry.periods.B, NUM_FMT, INDIGO, false, JRN_BG);
                if (bsHasC && entry.periods.C != null) setC(xr, BS.cmp2, entry.periods.C, NUM_FMT, INDIGO, false, JRN_BG);
                if (bsHasD && entry.periods.D != null) setC(xr, BS.cmp3, entry.periods.D, NUM_FMT, INDIGO, false, JRN_BG);
                [BS.act, BS.cmpD, BS.cmpP, BS.cmp2D, BS.cmp2P, BS.cmp3D, BS.cmp3P, ...BS.hist, ...BS.co].forEach(ci => {
                  if (ci && !xr.getCell(ci).value) { const c = xr.getCell(ci); c.value = ''; c.fill = mkFill(JRN_BG); c.border = mkBorder(); }
                });
              });
            }
          }
        }
      };

      const bsRoots = tree
        .filter(n => hasData(n) && n.accountType === 'B/S')
        .filter(n => !filterFn || filterFn(n))
        .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

      bsRoots.forEach(n => writeBSRow(n, 0));
    };

    // BUILD SHEETS
    const isAssetsRoot = n => {
      const name = (n.name ?? '').toLowerCase();
      return name.includes('asset') || name.includes('activo');
    };

const hasSavedLiteral = Array.isArray(savedPlLiteral) && savedPlLiteral.length > 0;
const hasSavedBsLiteral = Array.isArray(savedBsLiteral) && savedBsLiteral.length > 0;

if (hasSavedLiteral) {
  if (opts.plSaved !== false) buildSavedPLSheet(wb.addWorksheet('Profit & Loss'));
} else {
  if (opts.plSummary !== false) buildPLSheet(wb.addWorksheet('P&L Summary'), true);
  if (opts.plDetailed !== false) buildPLSheet(wb.addWorksheet('P&L Detailed'), false);
}

if (hasSavedBsLiteral) {
  if (opts.bsSaved !== false) buildSavedBSSheet(wb.addWorksheet('Balance Sheet'));
} else {
  if (opts.bsSummary !== false) buildBSSheet(wb.addWorksheet('BS Summary'), 'Summary', null);
  if (opts.bsAssets !== false) buildBSSheet(wb.addWorksheet('BS Assets'), 'Assets', n => isAssetsRoot(n));
  if (opts.bsEquity !== false) buildBSSheet(wb.addWorksheet('BS Equity & Liab'), 'Equity & Liabilities', n => !isAssetsRoot(n));
}

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
      rs.getCell(1).value = aLabel;
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
  t = (k) => k, MONTHS: MONTHS_T = MONTHS,
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
  cmp2Enabled = true,
  cmp3UploadedAccounts = [], cmp3PrevUploadedAccounts = [], cmp3Filters = {},
  cmp3Enabled = false,
  bsCompareMode = false,
  bsCmpUploadedAccounts = [], bsCmpFilters = {},
  bsCmp2UploadedAccounts = [], bsCmp2Filters = {},
  bsCmp2Enabled = true,
bsCmp3UploadedAccounts = [], bsCmp3Filters = {},
  bsCmp3Enabled = false,
plHistoryMonths = [],
  bsHistoryMonths = [],
  selectedCompanies = [],
  ytdOnly = false,
  savedPlLiteral = null,
  savedBsLiteral = null,
  savedHighlightedIds = null,
  prevUploadedAccountsRaw = [],
  month, year, source, structure,
  aFilters = {},
  companies = [],
  dimensions = [],
journalEntries = [],
  journalEntriesCmp = [],
  journalEntriesCmp2 = [],
  journalEntriesCmp3 = [],
  summaryRows = [],
  breakers = { pl: {}, bs: {}, cf: {} },
  pgcMapping = null,
  pgcBsMapping = null,
  colors = { primary: '#1a2f8a', secondary: '#CF305D', tertiary: '#57aa78' },
  opts = {},
}) {
  function doGenerate(jsPDF, autoTable) {
    const buildJrnByCodePdf = (entries) => {
      const m = new Map();
      (entries || []).forEach(j => {
        const code = String(j.AccountCode ?? j.accountCode ?? '');
        const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
        if (!code || (jt !== 'AJE' && jt !== 'RJE')) return;
        if (!m.has(code)) m.set(code, []);
        m.get(code).push(j);
      });
      return m;
    };
    const jrnByCodeCmpPdf  = buildJrnByCodePdf(journalEntriesCmp);
    const jrnByCodeCmp2Pdf = buildJrnByCodePdf(journalEntriesCmp2);
    const jrnByCodeCmp3Pdf = buildJrnByCodePdf(journalEntriesCmp3);
    // Palette
    const NAVY=[26,47,138], NAVYDK=[15,31,94], NAVYMID=[30,50,140];
    const RED=[207,48,93], REDDK=[160,30,65];
    const GRN=[87,170,120], GRNDK=[40,120,80];
    const PURPLE=[168,85,247], PURPLEDK=[124,58,202];
    const AMBER=[220,120,40];
const LIGHT=[238,241,251], STRIPE=[248,249,255], WHITE=[255,255,255];
    const GRAY=[140,150,175], GRAYLT=[210,215,230], TEXTDK=[20,35,80], TEXT_MUT=[107,114,128];
    const hexToRgb = (h) => {
      const s = String(h || '').replace('#', '').replace(/^FF/i, '');
      if (!/^[0-9a-fA-F]{6}$/.test(s)) return NAVYDK;
      return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
    };

    // Resolvers
    const resolveCompany = (code) => {
      if (!code) return null;
      const lookup = (c) => {
        const m = companies.find(co => String(typeof co === 'object' ? (co.companyShortName ?? co.CompanyShortName ?? co.company ?? co.Company ?? '') : co) === String(c));
        return (m && typeof m === 'object' ? (m.companyLegalName ?? m.CompanyLegalName) : null) ?? c;
      };
      return Array.isArray(code) ? code.map(lookup).join(', ') : lookup(code);
    };
    const resolveDims = (codes) => {
      if (!Array.isArray(codes) || codes.length === 0) return null;
      return codes.map(c => {
        const d = dimensions.find(dd => String(typeof dd === 'object' ? (dd.dimensionCode ?? dd.DimensionCode ?? dd.code ?? '') : dd) === String(c));
        return (d && typeof d === 'object' ? (d.dimensionName ?? d.DimensionName ?? d.name) : null) ?? c;
      }).join(', ');
    };
    const buildFilterLabel = (f) => {
      if (!f) return '';
      const mo = MONTHS.find(m => String(m.value) === String(f.month))?.label ?? f.month;
      const co = resolveCompany(f.company);
      const dgTxt = Array.isArray(f.dimGroups) && f.dimGroups.length > 0 ? `Groups: ${f.dimGroups.join(', ')}` : null;
      const dTxt = resolveDims(f.dimensions);
      return [mo && f.year ? `${mo} ${f.year}` : null, f.source, f.structure, co, dgTxt, dTxt ? `Dims: ${dTxt}` : null].filter(Boolean).join('  ·  ');
    };

    const aLabel = buildFilterLabel({ year: aFilters?.year ?? year, month: aFilters?.month ?? month, source: aFilters?.source ?? source, structure: aFilters?.structure ?? structure, company: aFilters?.company, dimGroups: aFilters?.dimGroups, dimensions: aFilters?.dimensions });
    const bLabel = compareMode ? buildFilterLabel(cmpFilters) : '';
    const cLabel = compareMode && cmp2Enabled ? buildFilterLabel(cmp2Filters) : '';
    const dLabel = compareMode && cmp2Enabled && cmp3Enabled ? buildFilterLabel(cmp3Filters) : '';
    const bsBLabel = bsCompareMode ? buildFilterLabel(bsCmpFilters) : '';
    const bsCLabel = bsCompareMode && bsCmp2Enabled ? buildFilterLabel(bsCmp2Filters) : '';
    const bsDLabel = bsCompareMode && bsCmp2Enabled && bsCmp3Enabled ? buildFilterLabel(bsCmp3Filters) : '';

    // Trees and maps
    const tree = buildTree(groupAccounts, uploadedAccounts);
    const prevTree = buildTree(groupAccounts, prevUploadedAccounts);
    const nodeMapF = t => { const m = new Map(); const w = n => { m.set(n.code, n); n.children?.forEach(w); }; t.forEach(w); return m; };
    const prevMap = nodeMapF(prevTree);
    const cmpMap = compareMode ? nodeMapF(buildTree(groupAccounts, cmpUploadedAccounts)) : new Map();
    const cmpPrevMap = compareMode ? nodeMapF(buildTree(groupAccounts, cmpPrevUploadedAccounts)) : new Map();
    const cmp2Map = compareMode && cmp2Enabled ? nodeMapF(buildTree(groupAccounts, cmp2UploadedAccounts)) : new Map();
    const cmp2PrevMap = compareMode && cmp2Enabled ? nodeMapF(buildTree(groupAccounts, cmp2PrevUploadedAccounts)) : new Map();
    const cmp3Map = compareMode && cmp2Enabled && cmp3Enabled ? nodeMapF(buildTree(groupAccounts, cmp3UploadedAccounts)) : new Map();
    const cmp3PrevMap = compareMode && cmp2Enabled && cmp3Enabled ? nodeMapF(buildTree(groupAccounts, cmp3PrevUploadedAccounts)) : new Map();
    const bsCmpMap = bsCompareMode ? nodeMapF(buildTree(groupAccounts, bsCmpUploadedAccounts)) : new Map();
    const bsCmp2Map = bsCompareMode && bsCmp2Enabled ? nodeMapF(buildTree(groupAccounts, bsCmp2UploadedAccounts)) : new Map();
    const bsCmp3Map = bsCompareMode && bsCmp2Enabled && bsCmp3Enabled ? nodeMapF(buildTree(groupAccounts, bsCmp3UploadedAccounts)) : new Map();

    const getYtd = (m, c) => { const n = m.get(c); return n ? sumNode(n) : 0; };
    const getPrev = (m, c, mo) => Number(mo) === 1 ? 0 : getYtd(m, c);
    const fmtN = n => typeof n === 'number' && !isNaN(n) ? n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const plAmt = n => n == null ? '' : n === 0 ? '—' : n < 0 ? `(${fmtN(Math.abs(n))})` : fmtN(n);
    const devPct = (a, b) => { if (!b) return '—'; const p = (a - b) / Math.abs(b) * 100; return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`; };
    const devAmt = (a, b) => { const d = a - b; return d === 0 ? '—' : d < 0 ? `(${fmtN(Math.abs(d))})` : fmtN(d); };

// History view (dedupe by year+month to prevent duplicate columns)
    const dedupHist = (arr) => {
      const seen = new Set();
      return (arr || []).filter(h => {
        if (!h?.year || !h?.month) return false;
        const k = `${h.year}-${h.month}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    const plHist = dedupHist(plHistoryMonths);
    const bsHist = dedupHist(bsHistoryMonths);
    const hasHistoryPL = !compareMode && plHist.length > 0;
    const hasHistoryBS = !bsCompareMode && bsHist.length > 0;
const plHistMaps = hasHistoryPL ? plHist.map(h => {
      const histJrnByCode = new Map();
      (h.journals || []).forEach(j => {
        const code = String(j.AccountCode ?? j.accountCode ?? '');
        const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
        if (!code || (jt !== 'AJE' && jt !== 'RJE')) return;
        if (!histJrnByCode.has(code)) histJrnByCode.set(code, []);
        histJrnByCode.get(code).push(j);
      });
      return {
        year: h.year, month: h.month,
        map: nodeMapF(buildTree(groupAccounts, h.data || [])),
        prevMap: nodeMapF(buildTree(groupAccounts, h.prevData || [])),
        jrnByCode: histJrnByCode,
      };
    }) : [];
    const bsHistMaps = hasHistoryBS ? bsHist.map(h => ({
      year: h.year, month: h.month,
      map: nodeMapF(buildTree(groupAccounts, h.data || [])),
    })) : [];

// Multi-company view
    const hasMultiCo = Array.isArray(selectedCompanies) && selectedCompanies.length > 1;
    const MULTI_CO_CHUNK = 7;
    const coChunksAll = hasMultiCo
      ? Array.from({ length: Math.ceil(selectedCompanies.length / MULTI_CO_CHUNK) },
          (_, i) => selectedCompanies.slice(i * MULTI_CO_CHUNK, (i + 1) * MULTI_CO_CHUNK))
      : [selectedCompanies];
    const getCoF = r => String(r.companyShortName ?? r.CompanyShortName ?? '');
const buildPerCoMaps = (coList) => coList.map(co => {
      const f = (uploadedAccounts || []).filter(r => getCoF(r) === co);
      const pf = (prevUploadedAccounts || []).filter(r => getCoF(r) === co);
      const legal = (() => {
        const m = (companies || []).find(c => String(typeof c === 'object' ? (c.companyShortName ?? c.CompanyShortName) : c) === co);
        return (m && typeof m === 'object' ? (m.companyLegalName ?? m.CompanyLegalName) : null) ?? co;
      })();
      return { co, legal, map: nodeMapF(buildTree(groupAccounts, f)), prevMap: nodeMapF(buildTree(groupAccounts, pf)) };
    });
    let perCoMaps = hasMultiCo ? buildPerCoMaps(selectedCompanies) : [];

    const hasB = compareMode && !hasHistoryPL && !hasMultiCo;
    const hasC = compareMode && cmp2Enabled && !hasHistoryPL && !hasMultiCo;
    const hasD = compareMode && cmp2Enabled && cmp3Enabled && !hasHistoryPL && !hasMultiCo;
    const bsHasB = bsCompareMode && !hasHistoryBS && !hasMultiCo;
    const bsHasC = bsCompareMode && bsCmp2Enabled && !hasHistoryBS && !hasMultiCo;
    const bsHasD = bsCompareMode && bsCmp2Enabled && bsCmp3Enabled && !hasHistoryBS && !hasMultiCo;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

const sections = [];
    let currentSection = '';

const drawHeader = (sectionTitle, isFirst, useCmpFlag = null, useLabels = null) => {
      if (!isFirst) doc.addPage();
      const actualPage = doc.internal.getNumberOfPages();
      currentSection = sectionTitle;
      const activeCmp = useCmpFlag ?? hasB;
      const labels = useLabels ?? { b: bLabel, c: cLabel, d: dLabel };
      const hasCActive = !!(labels.c && labels.c.length);
      const hasDActive = !!(labels.d && labels.d.length);
      const cmpCount = activeCmp ? (1 + (hasCActive ? 1 : 0) + (hasDActive ? 1 : 0)) : 0;
      const headerH = 22 + cmpCount * 7;

      doc.setFillColor(...NAVY); doc.rect(0, 0, W, headerH, 'F');
      doc.setFillColor(...RED);  doc.rect(0, 0, 3, headerH, 'F');

      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...WHITE);
      doc.text(sectionTitle, 9, 11);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(180, 200, 255);
      doc.text(`A:  ${aLabel}`, 9, 17);

      if (activeCmp) {
        let y = 21;
        const pill = (letter, txt, fill) => {
          doc.setFillColor(...fill);
          doc.roundedRect(9, y, W - 18, 5.5, 1.2, 1.2, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...WHITE);
          doc.text(letter, 12, y + 3.9);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
          doc.text(txt || '—', 18, y + 3.9);
          y += 7;
        };
        pill('B', labels.b, REDDK);
        if (hasCActive) pill('C', labels.c, GRNDK);
        if (hasDActive) pill('D', labels.d, PURPLEDK);
      }

      doc.setDrawColor(...NAVYMID); doc.setLineWidth(0.3);
      doc.line(0, headerH, W, headerH);

if (!sections.find(s => s.title === sectionTitle)) {
        sections.push({ title: sectionTitle, page: actualPage });
        try { doc.outline.add(null, sectionTitle, { pageNumber: actualPage });} catch { /* ignore */ }
      }
      return headerH + 4;
    };

    const drawFooterBrand = () => {
      doc.setFillColor(...LIGHT); doc.rect(0, H - 7, W, 7, 'F');
      doc.setDrawColor(...GRAYLT); doc.setLineWidth(0.2);
      doc.line(0, H - 7, W, H - 7);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...NAVY);
      doc.text('KONSOLIDATOR', 8, H - 2.8);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
      doc.text(currentSection, 30, H - 2.8);
    };

// ── Build PL breakers (matches Excel buildEffectivePlBreakers / app effectiveBreakersPl) ──
    const hexToRgbLocal = (h) => {
      const s = String(h || '').replace('#', '').replace(/^FF/i, '');
      if (!/^[0-9a-fA-F]{6}$/.test(s)) return NAVYDK;
      return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
    };
    const palettePl = [hexToRgbLocal(colors.primary), hexToRgbLocal(colors.secondary), hexToRgbLocal(colors.tertiary)];

    const buildPlBreakersForPdf = (isSummary, treeArg) => {
      if (pgcMapping?.rows && pgcMapping?.sections) {
        const rowsToScan = isSummary ? summaryRows : (() => {
          const all = [];
          const walkS = n => {
            if (!hasData(n) || !['P/L','DIS'].includes(n.accountType)) return;
            (n.children || []).forEach(walkS);
            if (n.isSumAccount) all.push(n);
          };
          treeArg.filter(n => ['P/L','DIS'].includes(n.accountType)).forEach(walkS);
          return all.sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}));
        })();
        const seen = new Set();
        const out = {};
        let i = 0;
        for (const node of rowsToScan) {
          const m = pgcMapping.rows.get(String(node.code));
          if (!m) continue;
          if (seen.has(m.section)) continue;
          seen.add(m.section);
          const sec = pgcMapping.sections.get(m.section);
          if (sec) { out[String(node.code)] = { label: sec.label, color: palettePl[i] ?? hexToRgbLocal(sec.color) }; i++; }
        }
        return out;
      }
      const legacy = breakers.pl ?? {};
      const codes = Object.keys(legacy).sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
      if (codes.length > 0) {
        const out = {};
        codes.forEach((code, i) => {
          out[code] = { label: legacy[code].label, color: palettePl[i] ?? hexToRgbLocal(legacy[code].color) };
        });
        return out;
      }
      return {};
    };

// Build leaf indexes once for PDF drill-down
    const buildLeafIdxPdf = (rows) => {
      const m = new Map();
      (rows || []).forEach(r => {
        const lac = String(getField(r, 'localAccountCode') ?? '');
        if (!lac) return;
        m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
      });
      return m;
    };
    const pdfPrevLeafIdx  = buildLeafIdxPdf(prevUploadedAccounts);
    const pdfBLeafIdx     = hasB ? buildLeafIdxPdf(cmpUploadedAccounts) : new Map();
    const pdfBPrevLeafIdx = hasB ? buildLeafIdxPdf(cmpPrevUploadedAccounts) : new Map();
    const pdfCLeafIdx     = hasC ? buildLeafIdxPdf(cmp2UploadedAccounts) : new Map();
    const pdfCPrevLeafIdx = hasC ? buildLeafIdxPdf(cmp2PrevUploadedAccounts) : new Map();
    const pdfDLeafIdx     = hasD ? buildLeafIdxPdf(cmp3UploadedAccounts) : new Map();
    const pdfDPrevLeafIdx = hasD ? buildLeafIdxPdf(cmp3PrevUploadedAccounts) : new Map();
    const pdfPlHistLeafIdx = hasHistoryPL ? plHist.map(h => ({
      cur: buildLeafIdxPdf(h.data || []),
      prev: buildLeafIdxPdf(h.prevData || []),
      month: h.month,
    })) : [];
    const pdfPerCoLeafIdx = hasMultiCo ? selectedCompanies.map(co => ({
      cur: buildLeafIdxPdf((uploadedAccounts || []).filter(r => getCoF(r) === co)),
      prev: buildLeafIdxPdf((prevUploadedAccounts || []).filter(r => getCoF(r) === co)),
    })) : [];

    // Per-leaf+dim indexes for PDF compare periods
    const buildLeafDimIdxPdf = (rows) => {
      const m = new Map();
      (rows || []).forEach(r => {
        const lac = String(getField(r, 'localAccountCode') ?? '');
        const dc  = String(getField(r, 'dimensionCode') ?? '');
        if (!lac || !dc || dc === 'null') return;
        const amt = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
        m.set(`${lac}|${dc}`, (m.get(`${lac}|${dc}`) ?? 0) + amt);
      });
      return m;
    };
    const pdfPrevLeafDimIdx  = buildLeafDimIdxPdf(prevUploadedAccounts);
    const pdfBLeafDimIdx     = hasB ? buildLeafDimIdxPdf(cmpUploadedAccounts) : new Map();
    const pdfBPrevLeafDimIdx = hasB ? buildLeafDimIdxPdf(cmpPrevUploadedAccounts) : new Map();
    const pdfCLeafDimIdx     = hasC ? buildLeafDimIdxPdf(cmp2UploadedAccounts) : new Map();
    const pdfCPrevLeafDimIdx = hasC ? buildLeafDimIdxPdf(cmp2PrevUploadedAccounts) : new Map();
const pdfDLeafDimIdx     = hasD ? buildLeafDimIdxPdf(cmp3UploadedAccounts) : new Map();
    const pdfDPrevLeafDimIdx = hasD ? buildLeafDimIdxPdf(cmp3PrevUploadedAccounts) : new Map();
const pdfPerCoLeafDimIdx = hasMultiCo ? selectedCompanies.map(co => ({
      cur:  buildLeafDimIdxPdf((uploadedAccounts || []).filter(r => getCoF(r) === co)),
      prev: buildLeafDimIdxPdf((prevUploadedAccounts || []).filter(r => getCoF(r) === co)),
    })) : [];
    const pdfPlHistLeafDimIdx = hasHistoryPL ? plHist.map(h => ({
      month: h.month,
      cur:  buildLeafDimIdxPdf(h.data || []),
      prev: buildLeafDimIdxPdf(h.prevData || []),
    })) : [];

    // Build PL rows — fully expanded, all leaves/dims/journals
    const buildPlRows = (treeArg) => {
      const rows = [];
      const breakerMap = buildPlBreakersForPdf(false, treeArg);
      const walk = (node, d) => {
        if (!hasData(node) || !['P/L', 'DIS'].includes(node.accountType)) return;
        // Emit breaker row before this node if applicable (and only when d === 0)
        if (d === 0 && breakerMap[String(node.code)]) {
          const br = breakerMap[String(node.code)];
          rows.push({
            code: '', label: String(br.label).toUpperCase(),
            mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null,
            _isSectionHeader: true, _sectionColor: br.color,
          });
        }
        const ytd = -sumNode(node);
        const prev = -getPrev(prevMap, node.code, month);
        const mon = ytd - prev;
        const cYtd = hasB ? -getYtd(cmpMap, node.code) : null;
        const cMon = hasB ? cYtd - (-getPrev(cmpPrevMap, node.code, cmpFilters?.month)) : null;
        const c2Ytd = hasC ? -getYtd(cmp2Map, node.code) : null;
        const c2Mon = hasC ? c2Ytd - (-getPrev(cmp2PrevMap, node.code, cmp2Filters?.month)) : null;
        const c3Ytd = hasD ? -getYtd(cmp3Map, node.code) : null;
        const c3Mon = hasD ? c3Ytd - (-getPrev(cmp3PrevMap, node.code, cmp3Filters?.month)) : null;
        const isHl = PL_HIGHLIGHTED_CODES.has(String(node.code)) || String(node.code).endsWith('.S') || String(node.code).endsWith('.PL');
        const histVals = plHistMaps.map(h => {
          const hYtd = -getYtd(h.map, node.code);
          const hPrev = -getPrev(h.prevMap, node.code, h.month);
          return { mon: hYtd - hPrev, ytd: hYtd };
        });
        const coVals = perCoMaps.map(c => {
          const ytdC = -getYtd(c.map, node.code);
          const prevC = Number(month) === 1 ? 0 : -getYtd(c.prevMap, node.code);
          return ytdOnly ? ytdC : (ytdC - prevC);
        });
        rows.push({ code: String(node.code ?? ''), label: '  '.repeat(d) + (node.name || ''), mon, ytd, cMon, cYtd, c2Mon, c2Ytd, c3Mon, c3Ytd, histVals, coVals, isBold: node.isSumAccount, depth: d, isHighlighted: isHl });
        node.children?.forEach(c => walk(c, d + 1));
(node.uploadLeaves || []).forEach(leaf => {
          if (leaf.type === 'plain') return;
          const lac = String(leaf.code ?? '');
          const amt = leaf.amount ?? 0;
          const ytdA = -amt;
          const prevA = lac && Number(month) !== 1 ? (pdfPrevLeafIdx.get(lac) ?? 0) : 0;
          const monA = -(amt - prevA);
          const bY = hasB && lac ? -(pdfBLeafIdx.get(lac) ?? 0) : null;
          const bP = hasB && lac ? (Number(cmpFilters?.month) === 1 ? 0 : -(pdfBPrevLeafIdx.get(lac) ?? 0)) : null;
          const cY = hasC && lac ? -(pdfCLeafIdx.get(lac) ?? 0) : null;
          const cP = hasC && lac ? (Number(cmp2Filters?.month) === 1 ? 0 : -(pdfCPrevLeafIdx.get(lac) ?? 0)) : null;
          const dY = hasD && lac ? -(pdfDLeafIdx.get(lac) ?? 0) : null;
          const dPV = hasD && lac ? (Number(cmp3Filters?.month) === 1 ? 0 : -(pdfDPrevLeafIdx.get(lac) ?? 0)) : null;
          const leafHistVals = hasHistoryPL ? pdfPlHistLeafIdx.map(h => {
            const hY = lac ? -(h.cur.get(lac) ?? 0) : 0;
            const hP = lac && Number(h.month) !== 1 ? -(h.prev.get(lac) ?? 0) : 0;
            return { mon: hY - hP, ytd: hY };
          }) : [];
          const leafCoVals = hasMultiCo ? pdfPerCoLeafIdx.map(idx => {
            const ytdC = lac ? -(idx.cur.get(lac) ?? 0) : 0;
            const prevC = lac && Number(month) !== 1 ? -(idx.prev.get(lac) ?? 0) : 0;
            return ytdOnly ? ytdC : (ytdC - prevC);
          }) : [];
          rows.push({
            code: lac, label: '  '.repeat(d + 1) + (leaf.name || leaf.code || ''),
            mon: monA, ytd: ytdA,
            cMon: bY != null ? bY - bP : null, cYtd: bY,
            c2Mon: cY != null ? cY - cP : null, c2Ytd: cY,
            c3Mon: dY != null ? dY - dPV : null, c3Ytd: dY,
            histVals: leafHistVals, coVals: leafCoVals,
            isBold: false, depth: d + 1, isLeaf: true,
          });
(leaf.children || []).forEach(dim => {
            const lac = String(leaf.code ?? '');
            const dc  = String(dim.code ?? '');
            const key = lac && dc ? `${lac}|${dc}` : null;
            const ytdAdim = -(dim.amount ?? 0);
            const prevAdim = key && Number(month) !== 1 ? -(pdfPrevLeafDimIdx.get(key) ?? 0) : 0;
            const monAdim = ytdAdim - prevAdim;
            const bYdim = hasB && key ? -(pdfBLeafDimIdx.get(key) ?? 0) : null;
            const bPdim = hasB && key ? (Number(cmpFilters?.month) === 1 ? 0 : -(pdfBPrevLeafDimIdx.get(key) ?? 0)) : null;
            const cYdim = hasC && key ? -(pdfCLeafDimIdx.get(key) ?? 0) : null;
            const cPdim = hasC && key ? (Number(cmp2Filters?.month) === 1 ? 0 : -(pdfCPrevLeafDimIdx.get(key) ?? 0)) : null;
            const dYdim = hasD && key ? -(pdfDLeafDimIdx.get(key) ?? 0) : null;
            const dPdimV = hasD && key ? (Number(cmp3Filters?.month) === 1 ? 0 : -(pdfDPrevLeafDimIdx.get(key) ?? 0)) : null;
const dimCoVals = hasMultiCo && key ? pdfPerCoLeafDimIdx.map(idx => {
              const ytdC = -(idx.cur.get(key) ?? 0);
              const prevC = Number(month) === 1 ? 0 : -(idx.prev.get(key) ?? 0);
              return ytdOnly ? ytdC : (ytdC - prevC);
            }) : [];
            const dimHistVals = hasHistoryPL && key ? pdfPlHistLeafDimIdx.map(h => {
              const hY = -(h.cur.get(key) ?? 0);
              const hP = Number(h.month) === 1 ? 0 : -(h.prev.get(key) ?? 0);
              return { mon: hY - hP, ytd: hY };
            }) : [];
            rows.push({
              code: dc, label: '  '.repeat(d + 2) + (dim.name || dim.code || ''),
              mon: monAdim, ytd: ytdAdim,
              cMon: bYdim != null ? bYdim - bPdim : null, cYtd: bYdim,
              c2Mon: cYdim != null ? cYdim - cPdim : null, c2Ytd: cYdim,
              c3Mon: dYdim != null ? dYdim - dPdimV : null, c3Ytd: dYdim,
              histVals: dimHistVals,
              coVals: dimCoVals,
              isBold: false, depth: d + 2, isDim: true,
            });
          });
        });
const jrns = (journalEntries || []).filter(j => {
          const acc = String(j.AccountCode ?? j.accountCode ?? '');
          const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
          return acc === String(node.code) && (jt === 'AJE' || jt === 'RJE');
        });
if (jrns.length > 0) {
          const hdrHistVals = hasHistoryPL ? plHistMaps.map(h => {
            const entries = h.jrnByCode?.get(String(node.code)) || [];
            const histAmt = entries.reduce((acc, je) => acc + -parseAmt(je.AmountYTD ?? je.amountYTD ?? 0), 0);
            return { mon: histAmt, ytd: histAmt };
          }) : [];
         rows.push({ code: '', label: '  '.repeat(d + 1) + `${t("entries").charAt(0).toUpperCase() + t("entries").slice(1)} (${jrns.length})`, mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null, histVals: hdrHistVals, isBold: false, depth: d + 1, isJrn: true, isJrnHeader: true });
          const findMatchPl = (idx, jnum) => {
            const m = (idx.get(String(node.code)) || []).find(jj => (jj.JournalNumber ?? jj.journalNumber) === jnum);
            return m ? -parseAmt(m.AmountYTD ?? m.amountYTD ?? 0) : null;
          };
jrns.forEach(j => {
            const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
            const jnum = j.JournalNumber ?? j.journalNumber ?? '';
            const bV = hasB ? findMatchPl(jrnByCodeCmpPdf,  jnum) : null;
            const cV = hasC ? findMatchPl(jrnByCodeCmp2Pdf, jnum) : null;
            const dV = hasD ? findMatchPl(jrnByCodeCmp3Pdf, jnum) : null;
            const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
            const coVals = hasMultiCo ? selectedCompanies.map(co => jrnCo === co ? -amt : 0) : [];
            rows.push({ code: String(jnum), label: '  '.repeat(d + 2) + (j.JournalHeader ?? j.journalHeader ?? ''), mon: -amt, ytd: -amt, cMon: bV, cYtd: bV, c2Mon: cV, c2Ytd: cV, c3Mon: dV, c3Ytd: dV, coVals, isBold: false, depth: d + 2, isJrn: true });
          });
          if (hasB || hasC || hasD) {
            const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
            const seen = new Map();
            const collect = (idx, period) => {
              (idx.get(String(node.code)) || []).forEach(j => {
                const num = j.JournalNumber ?? j.journalNumber;
                if (aNums.has(num)) return;
                if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                seen.get(num).periods[period] = -parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
              });
            };
            if (hasB) collect(jrnByCodeCmpPdf, 'B');
            if (hasC) collect(jrnByCodeCmp2Pdf, 'C');
            if (hasD) collect(jrnByCodeCmp3Pdf, 'D');
            seen.forEach((entry, num) => {
              ['B','C','D'].forEach(p => {
                if (entry.periods[p] != null) return;
                const idx = p === 'B' ? jrnByCodeCmpPdf : p === 'C' ? jrnByCodeCmp2Pdf : jrnByCodeCmp3Pdf;
                const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
                if (match) entry.periods[p] = -parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
              });
            });
            if (seen.size > 0) {
              rows.push({ code: '', label: '  '.repeat(d + 1) + `↳ B/C/D only (${seen.size})`, mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null, depth: d + 1, isJrn: true, isJrnHeader: true });
              seen.forEach((entry, num) => {
                const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
                rows.push({ code: String(num), label: '  '.repeat(d + 2) + jhdr, mon: null, ytd: null, cMon: entry.periods.B, cYtd: entry.periods.B, c2Mon: entry.periods.C, c2Ytd: entry.periods.C, c3Mon: entry.periods.D, c3Ytd: entry.periods.D, depth: d + 2, isJrn: true });
              });
            }
          }
        }
      };
      treeArg.filter(n => hasData(n) && ['P/L', 'DIS'].includes(n.accountType)).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })).forEach(n => walk(n, 0));
      return rows;
    };

const buildPlSummaryRows = () => {
      if (!Array.isArray(summaryRows) || summaryRows.length === 0) return [];
      const breakerMap = buildPlBreakersForPdf(true, tree);
      const sorted = summaryRows.filter(n => hasData(n) && ['P/L', 'DIS'].includes(n.accountType))
        .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
      const out = [];
      sorted.forEach(node => {
        if (breakerMap[String(node.code)]) {
          const br = breakerMap[String(node.code)];
          out.push({
            code: '', label: String(br.label).toUpperCase(),
            mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null,
            _isSectionHeader: true, _sectionColor: br.color,
          });
        }
        out.push((() => {
          const ytd = -sumNode(node);
          const mon = ytd - (-getPrev(prevMap, node.code, month));
          const cYtd = hasB ? -getYtd(cmpMap, node.code) : null;
          const cMon = hasB ? cYtd - (-getPrev(cmpPrevMap, node.code, cmpFilters?.month)) : null;
          const c2Ytd = hasC ? -getYtd(cmp2Map, node.code) : null;
          const c2Mon = hasC ? c2Ytd - (-getPrev(cmp2PrevMap, node.code, cmp2Filters?.month)) : null;
          const c3Ytd = hasD ? -getYtd(cmp3Map, node.code) : null;
          const c3Mon = hasD ? c3Ytd - (-getPrev(cmp3PrevMap, node.code, cmp3Filters?.month)) : null;
          const histVals = plHistMaps.map(h => {
            const hYtd = -getYtd(h.map, node.code);
            const hPrev = -getPrev(h.prevMap, node.code, h.month);
            return { mon: hYtd - hPrev, ytd: hYtd };
          });
          const coVals = perCoMaps.map(c => {
            const ytdC = -getYtd(c.map, node.code);
            const prevC = Number(month) === 1 ? 0 : -getYtd(c.prevMap, node.code);
            return ytdOnly ? ytdC : (ytdC - prevC);
          });
return { code: String(node.code ?? ''), label: node.name || '', mon, ytd, cMon, cYtd, c2Mon, c2Ytd, c3Mon, c3Ytd, histVals, coVals, isBold: true, depth: 0, isHighlighted: true };
        })());
      });
      return out;
    };

// BS leaf indexes for PDF drill-down
    const pdfBsBLeafIdx = bsHasB ? buildLeafIdxPdf(bsCmpUploadedAccounts) : new Map();
    const pdfBsCLeafIdx = bsHasC ? buildLeafIdxPdf(bsCmp2UploadedAccounts) : new Map();
    const pdfBsDLeafIdx = bsHasD ? buildLeafIdxPdf(bsCmp3UploadedAccounts) : new Map();
    const pdfBsHistLeafIdx = hasHistoryBS ? bsHist.map(h => buildLeafIdxPdf(h.data || [])) : [];
    const pdfBsPerCoLeafIdx = hasMultiCo ? selectedCompanies.map(co => buildLeafIdxPdf((uploadedAccounts || []).filter(r => getCoF(r) === co))) : [];
const pdfBsBLeafDimIdx = bsHasB ? buildLeafDimIdxPdf(bsCmpUploadedAccounts) : new Map();
    const pdfBsCLeafDimIdx = bsHasC ? buildLeafDimIdxPdf(bsCmp2UploadedAccounts) : new Map();
   const pdfBsDLeafDimIdx = bsHasD ? buildLeafDimIdxPdf(bsCmp3UploadedAccounts) : new Map();
    const pdfBsPerCoLeafDimIdx = hasMultiCo ? selectedCompanies.map(co =>
      buildLeafDimIdxPdf((uploadedAccounts || []).filter(r => getCoF(r) === co))
    ) : [];
    const buildBsBreakersForPdf = () => {
      const paletteBsLocal = [hexToRgbLocal(colors.primary), hexToRgbLocal(colors.secondary), hexToRgbLocal(colors.tertiary)];
      if (pgcBsMapping?.rows && pgcBsMapping?.sections) {
        const flatNodes = [];
        (function walk(nodes) {
          nodes.forEach(n => {
            if (hasData(n) && n.accountType === 'B/S') {
              const m = pgcBsMapping.rows.get(String(n.code));
              if (m && m.isSum) flatNodes.push({ node: n, sortOrder: m.sortOrder, section: m.section });
            }
            walk(n.children || []);
          });
        })(tree);
        flatNodes.sort((a,b) => a.sortOrder - b.sortOrder);
        const seen = new Set();
        const out = {};
        let i = 0;
        for (const { node, section } of flatNodes) {
          if (seen.has(section)) continue;
          seen.add(section);
          const sec = pgcBsMapping.sections.get(section);
          if (sec) { out[String(node.code)] = { label: sec.label, color: paletteBsLocal[i] ?? hexToRgbLocal(sec.color) }; i++; }
        }
        if (Object.keys(out).length > 0) return out;
      }
      const legacy = breakers.bs ?? {};
      const codes = Object.keys(legacy).sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
      if (codes.length > 0) {
        const out = {};
        codes.forEach((code, i) => {
          out[code] = { label: legacy[code].label, color: paletteBsLocal[i] ?? hexToRgbLocal(legacy[code].color) };
        });
        return out;
      }
      return {};
    };

    const buildBsRows = (filterFn = null) => {
      const rows = [];
      const breakerMap = buildBsBreakersForPdf();
      const walk = (node, d) => {
        if (!hasData(node) || node.accountType !== 'B/S') return;
        if (d === 0 && breakerMap[String(node.code)]) {
          const br = breakerMap[String(node.code)];
          rows.push({
            code: '', label: String(br.label).toUpperCase(),
            total: null, cVal: null, c2Val: null, c3Val: null,
            _isSectionHeader: true, _sectionColor: br.color,
          });
        }
        const isHl = BS_HIGHLIGHTED_CODES.has(String(node.code));
        const isNeg = Number(node.code) >= 599999;
        const total = isNeg ? -sumNode(node) : sumNode(node);
        const cRaw = bsHasB ? getYtd(bsCmpMap, node.code) : 0;
        const cVal = bsHasB ? (isNeg ? -cRaw : cRaw) : null;
        const c2Raw = bsHasC ? getYtd(bsCmp2Map, node.code) : 0;
        const c2Val = bsHasC ? (isNeg ? -c2Raw : c2Raw) : null;
        const c3Raw = bsHasD ? getYtd(bsCmp3Map, node.code) : 0;
        const c3Val = bsHasD ? (isNeg ? -c3Raw : c3Raw) : null;
        const histVals = bsHistMaps.map(h => {
          const hRaw = getYtd(h.map, node.code);
          return isNeg ? -hRaw : hRaw;
        });
        const coVals = perCoMaps.map(c => {
          const raw = getYtd(c.map, node.code);
          return isNeg ? -raw : raw;
        });
        rows.push({ code: String(node.code ?? ''), label: '  '.repeat(d) + (node.name || ''), total, cVal, c2Val, c3Val, histVals, coVals, isBold: isHl, depth: d, isHighlighted: isHl });
        node.children?.filter(hasData).forEach(c => walk(c, d + 1));
(node.uploadLeaves || []).forEach(leaf => {
          if (leaf.type === 'plain') return;
          const lac = String(leaf.code ?? '');
          const amtA = leaf.amount ?? 0;
          const bV = bsHasB && lac ? (pdfBsBLeafIdx.get(lac) ?? 0) : null;
          const cV = bsHasC && lac ? (pdfBsCLeafIdx.get(lac) ?? 0) : null;
          const dV = bsHasD && lac ? (pdfBsDLeafIdx.get(lac) ?? 0) : null;
          const histVals = hasHistoryBS && lac ? pdfBsHistLeafIdx.map(idx => idx.get(lac) ?? 0) : [];
          const coVals = hasMultiCo && lac ? pdfBsPerCoLeafIdx.map(idx => idx.get(lac) ?? 0) : [];
          rows.push({
            code: lac, label: '  '.repeat(d + 1) + (leaf.name || leaf.code || ''),
            total: amtA, cVal: bV, c2Val: cV, c3Val: dV, histVals, coVals,
            isBold: false, depth: d + 1, isLeaf: true,
          });
(leaf.children || []).forEach(dim => {
            const lac = String(leaf.code ?? '');
            const dc  = String(dim.code ?? '');
            const key = lac && dc ? `${lac}|${dc}` : null;
rows.push({
              code: dc, label: '  '.repeat(d + 2) + (dim.name || dim.code || ''),
              total: dim.amount,
              cVal:  bsHasB && key ? (pdfBsBLeafDimIdx.get(key) ?? 0) : null,
              c2Val: bsHasC && key ? (pdfBsCLeafDimIdx.get(key) ?? 0) : null,
              c3Val: bsHasD && key ? (pdfBsDLeafDimIdx.get(key) ?? 0) : null,
              coVals: hasMultiCo && key ? pdfBsPerCoLeafDimIdx.map(idx => idx.get(key) ?? 0) : [],
              isBold: false, depth: d + 2, isDim: true,
            });
          });
        });
const jrns = (journalEntries || []).filter(j => {
          const acc = String(j.AccountCode ?? j.accountCode ?? '');
          const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
          return acc === String(node.code) && (jt === 'AJE' || jt === 'RJE');
        });
        if (jrns.length > 0) {
         rows.push({ code: '', label: '  '.repeat(d + 1) + `📋 ${t("label_journal").charAt(0).toUpperCase() + t("label_journal").slice(1)} (${jrns.length})`, total: null, cVal: null, c2Val: null, c3Val: null, isBold: false, depth: d + 1, isJrn: true, isJrnHeader: true });
          const findMatchBs = (idx, jnum) => {
            const m = (idx.get(String(node.code)) || []).find(jj => (jj.JournalNumber ?? jj.journalNumber) === jnum);
            return m ? parseAmt(m.AmountYTD ?? m.amountYTD ?? 0) : null;
          };
            jrns.forEach(j => {
            const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
            const jnum = j.JournalNumber ?? j.journalNumber ?? '';
            const bV = bsHasB ? findMatchBs(jrnByCodeCmpPdf,  jnum) : null;
            const cV = bsHasC ? findMatchBs(jrnByCodeCmp2Pdf, jnum) : null;
            const dV = bsHasD ? findMatchBs(jrnByCodeCmp3Pdf, jnum) : null;
            const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
            const coVals = hasMultiCo ? selectedCompanies.map(co => jrnCo === co ? amt : 0) : [];
            rows.push({ code: String(jnum), label: '  '.repeat(d + 2) + (j.JournalHeader ?? j.journalHeader ?? ''), total: amt, cVal: bV, c2Val: cV, c3Val: dV, coVals, isBold: false, depth: d + 2, isJrn: true });
          });
          if (bsHasB || bsHasC || bsHasD) {
            const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
            const seen = new Map();
            const collect = (idx, period) => {
              (idx.get(String(node.code)) || []).forEach(j => {
                const num = j.JournalNumber ?? j.journalNumber;
                if (aNums.has(num)) return;
                if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                seen.get(num).periods[period] = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
              });
            };
            if (bsHasB) collect(jrnByCodeCmpPdf, 'B');
            if (bsHasC) collect(jrnByCodeCmp2Pdf, 'C');
            if (bsHasD) collect(jrnByCodeCmp3Pdf, 'D');
            seen.forEach((entry, num) => {
              ['B','C','D'].forEach(p => {
                if (entry.periods[p] != null) return;
                const idx = p === 'B' ? jrnByCodeCmpPdf : p === 'C' ? jrnByCodeCmp2Pdf : jrnByCodeCmp3Pdf;
                const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
                if (match) entry.periods[p] = parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
              });
            });
            if (seen.size > 0) {
              rows.push({ code: '', label: '  '.repeat(d + 1) + `↳ B/C/D only (${seen.size})`, total: null, cVal: null, c2Val: null, c3Val: null, depth: d + 1, isJrn: true, isJrnHeader: true });
              seen.forEach((entry, num) => {
                const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
                rows.push({ code: String(num), label: '  '.repeat(d + 2) + jhdr, total: null, cVal: entry.periods.B, c2Val: entry.periods.C, c3Val: entry.periods.D, depth: d + 2, isJrn: true });
              });
            }
          }
        }
      };
tree.filter(n => hasData(n) && n.accountType === 'B/S').filter(n => !filterFn || filterFn(n)).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })).forEach(n => walk(n, 0));
      return rows;
    };

    // ── Saved literal P&L row builder ──
const buildSavedPlRowsLit = () => {
      if (!Array.isArray(savedPlLiteral) || savedPlLiteral.length === 0) return [];

      // Per-leaf+dim indexes for compare periods (saved-mapping)
      const buildSavedLDI = (rowsArg) => {
        const m = new Map();
        (rowsArg || []).forEach(r => {
          const l = String(getField(r, 'localAccountCode') ?? '');
          const dcd = String(getField(r, 'dimensionCode') ?? '');
          if (!l || !dcd || dcd === 'null') return;
          const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
          m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
        });
        return m;
      };
      const savedDimAprev = buildSavedLDI(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);
      const savedDimB     = hasB ? buildSavedLDI(cmpUploadedAccounts) : new Map();
      const savedDimBprev = hasB ? buildSavedLDI(cmpPrevUploadedAccounts) : new Map();
      const savedDimC     = hasC ? buildSavedLDI(cmp2UploadedAccounts) : new Map();
      const savedDimCprev = hasC ? buildSavedLDI(cmp2PrevUploadedAccounts) : new Map();
      const savedDimD     = hasD ? buildSavedLDI(cmp3UploadedAccounts) : new Map();
      const savedDimDprev = hasD ? buildSavedLDI(cmp3PrevUploadedAccounts) : new Map();

      const buildDimIdx = (rowsArg) => {
        const fullIdx = new Map(), valIdx = new Map();
        (rowsArg || []).forEach(row => {
          const code = String(getField(row, 'accountCode') ?? '');
          if (!code) return;
          const amt = parseAmt(getField(row, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
          const dimsStr = String(getField(row, 'Dimensions', 'dimensions') ?? '');
          if (!dimsStr) return;
          dimsStr.split('||').map(s => s.trim()).filter(Boolean).forEach(pair => {
            const i = pair.indexOf(':'); if (i === -1) return;
            const g = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
            fullIdx.set(`${code}|${g}:${v}`, (fullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
            valIdx.set(`${code}|${v}`, (valIdx.get(`${code}|${v}`) ?? 0) + amt);
          });
        });
        if (Array.isArray(dimensions) && dimensions.length > 0) {
          const nameToCode = new Map();
          dimensions.forEach(d => {
            const g = String(d.dimensionGroup ?? d.DimensionGroup ?? '').trim();
            const cd = String(d.dimensionCode ?? d.DimensionCode ?? '').trim();
            const nm = String(d.dimensionName ?? d.DimensionName ?? '').trim();
            if (g && cd && nm) nameToCode.set(`${g}:${nm}`, cd);
          });
          [...fullIdx.entries()].forEach(([k, v]) => {
            const pipe = k.indexOf('|'); const acc = k.slice(0, pipe);
            const rest = k.slice(pipe + 1); const colon = rest.indexOf(':');
            if (colon === -1) return;
            const g = rest.slice(0, colon); const cv = rest.slice(colon + 1);
            for (const [nk, mc] of nameToCode.entries()) {
              if (mc === cv && nk.startsWith(`${g}:`)) {
                const nm = nk.slice(g.length + 1);
                fullIdx.set(`${acc}|${g}:${nm}`, v);
                valIdx.set(`${acc}|${nm}`, v);
                break;
              }
            }
          });
        }
        return { fullIdx, valIdx };
      };

      const tbc = (rowsArg) => {
        const m = new Map();
        (function w(nodes) { nodes.forEach(n => { m.set(String(n.code), n); w(n.children || []); }); })(buildTree(groupAccounts, rowsArg || []));
        return m;
      };

      const aTree = tbc(uploadedAccounts);
      const aPrevTree = tbc(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);
      const aIdx = buildDimIdx(uploadedAccounts);
      const aPrevIdx = buildDimIdx(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);
      const bTree = hasB ? tbc(cmpUploadedAccounts) : null;
      const bPrevTree = hasB ? tbc(cmpPrevUploadedAccounts) : null;
      const bIdx = hasB ? buildDimIdx(cmpUploadedAccounts) : null;
      const bPrevIdx = hasB ? buildDimIdx(cmpPrevUploadedAccounts) : null;
      const cTree = hasC ? tbc(cmp2UploadedAccounts) : null;
      const cPrevTree = hasC ? tbc(cmp2PrevUploadedAccounts) : null;
      const cIdx = hasC ? buildDimIdx(cmp2UploadedAccounts) : null;
      const cPrevIdx = hasC ? buildDimIdx(cmp2PrevUploadedAccounts) : null;
      const dTree = hasD ? tbc(cmp3UploadedAccounts) : null;
      const dPrevTree = hasD ? tbc(cmp3PrevUploadedAccounts) : null;
      const dIdx = hasD ? buildDimIdx(cmp3UploadedAccounts) : null;
      const dPrevIdx = hasD ? buildDimIdx(cmp3PrevUploadedAccounts) : null;

      const sumDimRec = (gaNode, dimStr, idx) => {
        if (!gaNode || !idx) return 0;
        let total = 0;
        const code = String(gaNode.code);
        total += dimStr.includes(':') ? (idx.fullIdx.get(`${code}|${dimStr}`) ?? 0) : (idx.valIdx.get(`${code}|${dimStr}`) ?? 0);
        (gaNode.children || []).forEach(c => { total += sumDimRec(c, dimStr, idx); });
        return total;
      };
      const sumLit = (node, treeM, prevTreeM, idx, prevIdx, periodMonth) => {
        const ga = treeM?.get(String(node.code));
        if (!ga) return { ytd: 0, mon: 0 };
        if (!node.dims || node.dims.length === 0) {
          const ytd = -sumNode(ga);
          const prevGa = prevTreeM?.get(String(node.code));
          const prevYtd = prevGa && Number(periodMonth) !== 1 ? -sumNode(prevGa) : 0;
          return { ytd, mon: ytd - prevYtd };
        }
        let total = 0, prevTotal = 0;
        node.dims.forEach(d => { total += sumDimRec(ga, String(d), idx); });
        if (Number(periodMonth) !== 1 && prevIdx) {
          node.dims.forEach(d => { prevTotal += sumDimRec(ga, String(d), prevIdx); });
        }
        return { ytd: -total, mon: -total - (-prevTotal) };
      };
      const sumLitWithKids = (node, treeM, prevTreeM, idx, prevIdx, periodMonth) => {
        const self = sumLit(node, treeM, prevTreeM, idx, prevIdx, periodMonth);
        let ytd = self.ytd, mon = self.mon;
        if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
          node.children.forEach(c => {
            const ch = sumLit(c, treeM, prevTreeM, idx, prevIdx, periodMonth);
            ytd += ch.ytd; mon += ch.mon;
          });
        }
        return { ytd, mon };
      };
      const isHl = (node) => savedHighlightedIds && (savedHighlightedIds.has?.(node.id) || savedHighlightedIds.has?.(node.originalId));

      const buildLeafOnce = (rowsArg) => {
        const m = new Map();
        (rowsArg || []).forEach(r => {
          const lac = String(getField(r, 'localAccountCode') ?? '');
          if (!lac) return;
          m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
        });
        return m;
      };
      const aPrevLeafIdx = buildLeafOnce(prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts);
      const bLeafIdx = hasB ? buildLeafOnce(cmpUploadedAccounts) : new Map();
      const bPrevLeafIdx = hasB ? buildLeafOnce(cmpPrevUploadedAccounts) : new Map();
      const cLeafIdx = hasC ? buildLeafOnce(cmp2UploadedAccounts) : new Map();
      const cPrevLeafIdx = hasC ? buildLeafOnce(cmp2PrevUploadedAccounts) : new Map();
const dLeafIdx = hasD ? buildLeafOnce(cmp3UploadedAccounts) : new Map();
      const dPrevLeafIdx = hasD ? buildLeafOnce(cmp3PrevUploadedAccounts) : new Map();

      const plHistTreeMaps = hasHistoryPL ? plHist.map(h => ({
        month: h.month,
        tree: tbc(h.data || []),
        prevTree: tbc(h.prevData || []),
        idx: buildDimIdx(h.data || []),
        prevIdx: buildDimIdx(h.prevData || []),
        leafIdx: buildLeafOnce(h.data || []),
        prevLeafIdx: buildLeafOnce(h.prevData || []),
        leafDimIdx: buildSavedLDI(h.data || []),
        prevLeafDimIdx: buildSavedLDI(h.prevData || []),
      })) : [];

// Per-company trees for multi-co — fully defensive
      let perCoTreesLit = [];
      try {
        if (hasMultiCo) {
          const cos = Array.isArray(selectedCompanies) ? selectedCompanies : [];
          const ua = Array.isArray(uploadedAccounts) ? uploadedAccounts : [];
          const puaRaw = Array.isArray(prevUploadedAccountsRaw) && prevUploadedAccountsRaw.length > 0 ? prevUploadedAccountsRaw : (Array.isArray(prevUploadedAccounts) ? prevUploadedAccounts : []);
          const pua = Array.isArray(prevUploadedAccounts) ? prevUploadedAccounts : [];
perCoTreesLit = cos.map(co => {
            const coStr = String(co);
            const fA = ua.filter(r => getCoF(r) === coStr);
            const fPRaw = puaRaw.filter(r => getCoF(r) === coStr);
            const fP = pua.filter(r => getCoF(r) === coStr);
            return {
              _co: coStr,
              tree: tbc(fA),
              prevTree: tbc(fPRaw),
              leafIdx: buildLeafOnce(fA),
              prevLeafIdx: buildLeafOnce(fP),
            };
          });
        }
      } catch (err) {
        console.error('[Export] perCoTreesLit build failed', err);
        perCoTreesLit = [];
      }

      const coValFor = (node) => {
        if (!hasMultiCo || perCoTreesLit.length === 0) return [];
        try {
          return perCoTreesLit.map(cot => {
            if (!cot || !cot.tree) return 0;
            const ga = cot.tree.get(String(node.code));
            let ytdC = ga ? -sumNode(ga) : 0;
            let prevC = 0;
            if (Number(month) !== 1 && cot.prevTree) {
              const pg = cot.prevTree.get(String(node.code));
              if (pg) prevC = -sumNode(pg);
            }
            if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
              node.children.forEach(ch => {
                const g = cot.tree.get(String(ch.code));
                if (g) ytdC += -sumNode(g);
                if (Number(month) !== 1 && cot.prevTree) {
                  const pg2 = cot.prevTree.get(String(ch.code));
                  if (pg2) prevC += -sumNode(pg2);
                }
              });
            }
            return ytdOnly ? ytdC : (ytdC - prevC);
          });
        } catch (err) {
          console.error('[Export] coValFor failed for node', node?.code, err);
          return perCoTreesLit.map(() => 0);
        }
      };

      const out = [];
      const pushNode = (node, depth) => {
        const a = sumLitWithKids(node, aTree, aPrevTree, aIdx, aPrevIdx, month);
        const b = hasB ? sumLitWithKids(node, bTree, bPrevTree, bIdx, bPrevIdx, cmpFilters?.month) : null;
        const c = hasC ? sumLitWithKids(node, cTree, cPrevTree, cIdx, cPrevIdx, cmp2Filters?.month) : null;
        const d = hasD ? sumLitWithKids(node, dTree, dPrevTree, dIdx, dPrevIdx, cmp3Filters?.month) : null;
        const hl = isHl(node);
const nodeHistVals = hasHistoryPL ? plHistTreeMaps.map(h => sumLitWithKids(node, h.tree, h.prevTree, h.idx, h.prevIdx, h.month)) : [];
        out.push({
          code: String(node.code ?? ''),
          label: '  '.repeat(depth) + (depth === 0 ? (node.name || '').toUpperCase() : (node.name || '')),
          mon: a.mon, ytd: a.ytd,
          cMon: b?.mon ?? null, cYtd: b?.ytd ?? null,
          c2Mon: c?.mon ?? null, c2Ytd: c?.ytd ?? null,
          c3Mon: d?.mon ?? null, c3Ytd: d?.ytd ?? null,
          histVals: nodeHistVals,
          coVals: hasMultiCo ? coValFor(node) : [],
          isBold: hl || depth === 0, isHighlighted: hl || depth === 0, depth,
        });

        const gaNode = aTree.get(String(node.code));
        const leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== 'plain');
        leaves.forEach(leaf => {
          const ytdA = -(leaf.amount ?? 0);
          const prevA = leaf.code && Number(month) !== 1 ? (aPrevLeafIdx.get(String(leaf.code)) ?? 0) : 0;
          const monA = -((leaf.amount ?? 0) - prevA);
          const bY = hasB && leaf.code ? -(bLeafIdx.get(String(leaf.code)) ?? 0) : null;
          const bP = hasB && leaf.code ? (Number(cmpFilters?.month) === 1 ? 0 : -(bPrevLeafIdx.get(String(leaf.code)) ?? 0)) : null;
          const cY = hasC && leaf.code ? -(cLeafIdx.get(String(leaf.code)) ?? 0) : null;
          const cP = hasC && leaf.code ? (Number(cmp2Filters?.month) === 1 ? 0 : -(cPrevLeafIdx.get(String(leaf.code)) ?? 0)) : null;
          const dY = hasD && leaf.code ? -(dLeafIdx.get(String(leaf.code)) ?? 0) : null;
          const dPV = hasD && leaf.code ? (Number(cmp3Filters?.month) === 1 ? 0 : -(dPrevLeafIdx.get(String(leaf.code)) ?? 0)) : null;
const leafHistVals = hasHistoryPL && leaf.code ? plHistTreeMaps.map(h => {
            const lY = -(h.leafIdx.get(String(leaf.code)) ?? 0);
            const lP = Number(h.month) === 1 ? 0 : -(h.prevLeafIdx.get(String(leaf.code)) ?? 0);
            return { mon: lY - lP, ytd: lY };
          }) : [];
          out.push({
            code: String(leaf.code || ''),
            label: '  '.repeat(depth + 1) + (leaf.name || ''),
            mon: monA, ytd: ytdA,
            cMon: bY != null ? bY - bP : null, cYtd: bY,
            c2Mon: cY != null ? cY - cP : null, c2Ytd: cY,
            c3Mon: dY != null ? dY - dPV : null, c3Ytd: dY,
            histVals: leafHistVals,
            coVals: hasMultiCo && leaf.code ? perCoTreesLit.map(cot => {
              const lAmt = cot.leafIdx.get(String(leaf.code)) ?? 0;
              const lPrev = cot.prevLeafIdx.get(String(leaf.code)) ?? 0;
              return ytdOnly ? -lAmt : -(lAmt - lPrev);
            }) : [],
            depth: depth + 1, isLeaf: true,
          });
(leaf.children || []).forEach(dim => {
            const lac = String(leaf.code ?? '');
            const dc  = String(dim.code ?? '');
            const key = lac && dc ? `${lac}|${dc}` : null;
            const ytdAdim = -(dim.amount ?? 0);
            const prevAdim = key && Number(month) !== 1 ? -(savedDimAprev.get(key) ?? 0) : 0;
            const monAdim = ytdAdim - prevAdim;
            const bYdim = hasB && key ? -(savedDimB.get(key) ?? 0) : null;
            const bPdim = hasB && key ? (Number(cmpFilters?.month) === 1 ? 0 : -(savedDimBprev.get(key) ?? 0)) : null;
            const cYdim = hasC && key ? -(savedDimC.get(key) ?? 0) : null;
            const cPdim = hasC && key ? (Number(cmp2Filters?.month) === 1 ? 0 : -(savedDimCprev.get(key) ?? 0)) : null;
            const dYdim = hasD && key ? -(savedDimD.get(key) ?? 0) : null;
            const dPdimV = hasD && key ? (Number(cmp3Filters?.month) === 1 ? 0 : -(savedDimDprev.get(key) ?? 0)) : null;
const dimCoValsLit = hasMultiCo && key ? perCoTreesLit.map(cot => {
              if (!cot._leafDimIdx) {
                const buildLDIcoPdf = (rows) => {
                  const m = new Map();
                  (rows || []).forEach(r => {
                    const l = String(getField(r, 'localAccountCode') ?? '');
                    const dcd = String(getField(r, 'dimensionCode') ?? '');
                    if (!l || !dcd || dcd === 'null') return;
                    const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
                    m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
                  });
                  return m;
                };
                cot._leafDimIdx = buildLDIcoPdf((uploadedAccounts || []).filter(r => getCoF(r) === cot._co));
                cot._prevLeafDimIdx = buildLDIcoPdf(((prevUploadedAccountsRaw?.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts) || []).filter(r => getCoF(r) === cot._co));
              }
              const ytdC = -(cot._leafDimIdx.get(key) ?? 0);
              const prevC = Number(month) === 1 ? 0 : -(cot._prevLeafDimIdx.get(key) ?? 0);
              return ytdOnly ? ytdC : (ytdC - prevC);
            }) : [];
const dimHistVals = hasHistoryPL && key ? plHistTreeMaps.map(h => {
              const hY = -(h.leafDimIdx.get(key) ?? 0);
              const hP = Number(h.month) === 1 ? 0 : -(h.prevLeafDimIdx.get(key) ?? 0);
              return { mon: hY - hP, ytd: hY };
            }) : [];
            out.push({
              code: dc, label: '  '.repeat(depth + 2) + '◆ ' + (dim.name || dim.code || ''),
              mon: monAdim, ytd: ytdAdim,
              cMon: bYdim != null ? bYdim - bPdim : null, cYtd: bYdim,
              c2Mon: cYdim != null ? cYdim - cPdim : null, c2Ytd: cYdim,
              c3Mon: dYdim != null ? dYdim - dPdimV : null, c3Ytd: dYdim,
              histVals: dimHistVals,
              coVals: dimCoValsLit,
              depth: depth + 2, isDim: true,
            });
          });
        });

// Journal entries at node level (PL saved PDF) — matches app: only AJE/RJE
        if (node.code) {
          const jrns = (journalEntries || []).filter(j => {
            const acc = String(j.AccountCode ?? j.accountCode ?? '');
            const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
            return acc === String(node.code) && (jt === 'AJE' || jt === 'RJE');
          });
if (jrns.length > 0) {
            const hdrHistVals = hasHistoryPL ? plHistMaps.map(h => {
              const entries = h.jrnByCode?.get(String(node.code)) || [];
              const histAmt = entries.reduce((acc, je) => acc + -parseAmt(je.AmountYTD ?? je.amountYTD ?? 0), 0);
              return { mon: histAmt, ytd: histAmt };
            }) : [];
out.push({
              code: '', label: '  '.repeat(depth + 1) + `${t("entries").charAt(0).toUpperCase() + t("entries").slice(1)} (${jrns.length})`,
              mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null,
              histVals: hdrHistVals,
              depth: depth + 1, isJrn: true, isJrnHeader: true,
            });
jrns.forEach(j => {
              const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
              const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
              const coVals = hasMultiCo ? selectedCompanies.map(co => jrnCo === co ? -amt : 0) : [];
              out.push({
                code: String(j.JournalNumber ?? j.journalNumber ?? ''),
                label: '  '.repeat(depth + 2) + (j.JournalHeader ?? j.journalHeader ?? ''),
                mon: -amt, ytd: -amt,
                cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null,
                coVals,
                depth: depth + 2, isJrn: true,
              });
            });
if (hasB || hasC || hasD) {
              const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
              const seen = new Map();
              const collect = (idx, period) => {
                (idx.get(String(node.code)) || []).forEach(j => {
                  const num = j.JournalNumber ?? j.journalNumber;
                  if (aNums.has(num)) return;
                  if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                  seen.get(num).periods[period] = -parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
                });
              };
              if (hasB) collect(jrnByCodeCmpPdf,  'B');
              if (hasC) collect(jrnByCodeCmp2Pdf, 'C');
              if (hasD) collect(jrnByCodeCmp3Pdf, 'D');
              seen.forEach((entry, num) => {
                ['B','C','D'].forEach(p => {
                  if (entry.periods[p] != null) return;
                  const idx = p === 'B' ? jrnByCodeCmpPdf : p === 'C' ? jrnByCodeCmp2Pdf : jrnByCodeCmp3Pdf;
                  const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
                  if (match) entry.periods[p] = -parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
                });
              });
              if (seen.size > 0) {
                out.push({
                  code: '', label: '  '.repeat(depth + 1) + `↳ B/C/D only (${seen.size})`,
                  mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null,
                  depth: depth + 1, isJrn: true, isJrnHeader: true,
                });
                seen.forEach((entry, num) => {
                  const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
                  out.push({
                    code: String(num ?? ''),
                    label: '  '.repeat(depth + 2) + jhdr,
                    mon: null, ytd: null,
                    cMon: entry.periods.B, cYtd: entry.periods.B,
                    c2Mon: entry.periods.C, c2Ytd: entry.periods.C,
                    c3Mon: entry.periods.D, c3Ytd: entry.periods.D,
                    depth: depth + 2, isJrn: true,
                  });
                });
              }
            }
          }
        }

        (node.children || []).forEach(child => pushNode(child, depth + 1));
      };

      savedPlLiteral.forEach((section) => {
        const lbl = section.label ?? section.name ?? section.title ?? section.breaker ?? section.breakerLabel ?? section.heading;
        const col = section.color ?? section.colour ?? section.bg ?? section.background ?? section.fill;
        if (lbl) {
          out.push({
            code: '', label: String(lbl).toUpperCase(),
            mon: null, ytd: null, cMon: null, cYtd: null, c2Mon: null, c2Ytd: null, c3Mon: null, c3Ytd: null,
            _isSectionHeader: true, _sectionColor: hexToRgb(col),
          });
        }
        (section.nodes || []).forEach(n => pushNode(n, 0));
      });
      return out;
    };

    // ── Saved literal Balance Sheet row builder ──
const buildSavedBsRowsLit = () => {
      if (!Array.isArray(savedBsLiteral) || savedBsLiteral.length === 0) return [];

      const buildSavedBsLDI = (rowsArg) => {
        const m = new Map();
        (rowsArg || []).forEach(r => {
          const l = String(getField(r, 'localAccountCode') ?? '');
          const dcd = String(getField(r, 'dimensionCode') ?? '');
          if (!l || !dcd || dcd === 'null') return;
          const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
          m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
        });
        return m;
      };
      const savedBsDimB = bsHasB ? buildSavedBsLDI(bsCmpUploadedAccounts) : new Map();
      const savedBsDimC = bsHasC ? buildSavedBsLDI(bsCmp2UploadedAccounts) : new Map();
      const savedBsDimD = bsHasD ? buildSavedBsLDI(bsCmp3UploadedAccounts) : new Map();

      const buildBsAccIdx = (rowsArg) => {
        const acc = new Map(), dim = new Map();
        (rowsArg || []).forEach(row => {
          const code = String(getField(row, 'accountCode') ?? '');
          if (!code) return;
          const amt = parseAmt(getField(row, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
          acc.set(code, (acc.get(code) ?? 0) + amt);
          const dimsStr = String(getField(row, 'Dimensions', 'dimensions') ?? '');
          if (!dimsStr) return;
          dimsStr.split('||').map(s => s.trim()).filter(Boolean).forEach(pair => {
            const i = pair.indexOf(':'); if (i === -1) return;
            const g = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
            dim.set(`${code}|${g}:${v}`, (dim.get(`${code}|${g}:${v}`) ?? 0) + amt);
          });
        });
        return { acc, dim };
      };
      const aBs = buildBsAccIdx(uploadedAccounts);
      const bBs = bsHasB ? buildBsAccIdx(bsCmpUploadedAccounts) : null;
      const cBs = bsHasC ? buildBsAccIdx(bsCmp2UploadedAccounts) : null;
      const dBs = bsHasD ? buildBsAccIdx(bsCmp3UploadedAccounts) : null;

      const sumBsLit = (node, src) => {
        if (!src) return 0;
        if (node.dims && node.dims.length > 0) {
          let total = 0;
          node.dims.forEach(d => { total += src.dim.get(`${node.code}|${d}`) ?? 0; });
          return total;
        }
        return src.acc.get(String(node.code)) ?? 0;
      };
      const sumBsWithKids = (node, src) => {
        let total = sumBsLit(node, src);
        if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
          node.children.forEach(c => { total += sumBsLit(c, src); });
        }
        return total;
      };
      const isHl = (node) => savedHighlightedIds && (savedHighlightedIds.has?.(node.id) || savedHighlightedIds.has?.(node.originalId));

      const buildLeafOnce = (rowsArg) => {
        const m = new Map();
        (rowsArg || []).forEach(r => {
          const lac = String(getField(r, 'localAccountCode') ?? '');
          if (!lac) return;
          m.set(lac, (m.get(lac) ?? 0) + parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod')));
        });
        return m;
      };
      const bsBLeaf = bsHasB ? buildLeafOnce(bsCmpUploadedAccounts) : new Map();
      const bsCLeaf = bsHasC ? buildLeafOnce(bsCmp2UploadedAccounts) : new Map();
const bsDLeaf = bsHasD ? buildLeafOnce(bsCmp3UploadedAccounts) : new Map();

      const bsTreeByCode = (rows) => {
        const m = new Map();
        (function w(nodes) { nodes.forEach(n => { m.set(String(n.code), n); w(n.children || []); }); })(buildTree(groupAccounts, rows || []));
        return m;
      };

      const aTreeBs = bsTreeByCode(uploadedAccounts);

// Per-company trees for multi-co BS — defensive
      const _selectedCoBs = Array.isArray(selectedCompanies) ? selectedCompanies : [];
      const _uaListBs = Array.isArray(uploadedAccounts) ? uploadedAccounts : [];
const buildBsLDIcoPdf = (rows) => {
        const m = new Map();
        (rows || []).forEach(r => {
          const l = String(getField(r, 'localAccountCode') ?? '');
          const dcd = String(getField(r, 'dimensionCode') ?? '');
          if (!l || !dcd || dcd === 'null') return;
          const a = parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'));
          m.set(`${l}|${dcd}`, (m.get(`${l}|${dcd}`) ?? 0) + a);
        });
        return m;
      };
      const perCoBsTreesLit = hasMultiCo ? _selectedCoBs.map(co => ({
        tree: bsTreeByCode(_uaListBs.filter(r => getCoF(r) === co)),
        leafIdx: buildLeafOnce(_uaListBs.filter(r => getCoF(r) === co)),
        leafDimIdx: buildBsLDIcoPdf(_uaListBs.filter(r => getCoF(r) === co)),
      })) : [];

      const coValBsFor = (node) => perCoBsTreesLit.map(cot => {
        const ga = cot.tree.get(String(node.code));
        let total = ga ? sumNode(ga) : 0;
        if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
          node.children.forEach(ch => {
            const g = cot.tree.get(String(ch.code));
            if (g) total += sumNode(g);
          });
        }
        return total;
      });

      const out = [];
      const pushNode = (node, depth) => {
        const a = sumBsWithKids(node, aBs);
        const bv = bsHasB ? sumBsWithKids(node, bBs) : null;
        const cv = bsHasC ? sumBsWithKids(node, cBs) : null;
        const dv = bsHasD ? sumBsWithKids(node, dBs) : null;
        const hl = isHl(node);
        out.push({
          code: String(node.code ?? ''),
          label: '  '.repeat(depth) + (depth === 0 ? (node.name || '').toUpperCase() : (node.name || '')),
          total: a, cVal: bv, c2Val: cv, c3Val: dv,
          coVals: hasMultiCo ? coValBsFor(node) : [],
          isBold: hl || depth === 0, isHighlighted: hl || depth === 0, depth,
        });

        const gaNode = aTreeBs.get(String(node.code));
        const leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== 'plain');
        leaves.forEach(leaf => {
out.push({
            code: String(leaf.code || ''),
            label: '  '.repeat(depth + 1) + (leaf.name || ''),
            total: leaf.amount ?? 0,
            cVal: bsHasB && leaf.code ? (bsBLeaf.get(String(leaf.code)) ?? 0) : null,
            c2Val: bsHasC && leaf.code ? (bsCLeaf.get(String(leaf.code)) ?? 0) : null,
            c3Val: bsHasD && leaf.code ? (bsDLeaf.get(String(leaf.code)) ?? 0) : null,
            coVals: hasMultiCo && leaf.code ? perCoBsTreesLit.map(cot => cot.leafIdx.get(String(leaf.code)) ?? 0) : [],
            depth: depth + 1, isLeaf: true,
          });
(leaf.children || []).forEach(dim => {
            const lac = String(leaf.code ?? '');
            const dc  = String(dim.code ?? '');
            const key = lac && dc ? `${lac}|${dc}` : null;
out.push({
              code: dc, label: '  '.repeat(depth + 2) + '◆ ' + (dim.name || dim.code || ''),
              total: dim.amount ?? 0,
              cVal:  bsHasB && key ? (savedBsDimB.get(key) ?? 0) : null,
              c2Val: bsHasC && key ? (savedBsDimC.get(key) ?? 0) : null,
              c3Val: bsHasD && key ? (savedBsDimD.get(key) ?? 0) : null,
              coVals: hasMultiCo && key ? perCoBsTreesLit.map(cot => cot.leafDimIdx.get(key) ?? 0) : [],
              depth: depth + 2, isDim: true,
            });
          });
        });

// Journal entries at node level (BS saved PDF) — matches app: only AJE/RJE
        if (node.code) {
          const jrns = (journalEntries || []).filter(j => {
            const acc = String(j.AccountCode ?? j.accountCode ?? '');
            const jt = String(j.JournalType ?? j.journalType ?? '').toUpperCase();
            return acc === String(node.code) && (jt === 'AJE' || jt === 'RJE');
          });
          if (jrns.length > 0) {
out.push({
              code: '', label: '  '.repeat(depth + 1) + `📋 ${t("label_journal").charAt(0).toUpperCase() + t("label_journal").slice(1)} (${jrns.length})`,
              total: null, cVal: null, c2Val: null, c3Val: null,
              depth: depth + 1, isJrn: true, isJrnHeader: true,
            });
jrns.forEach(j => {
              const amt = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
              const jrnCo = String(j.CompanyShortName ?? j.companyShortName ?? '');
              const coVals = hasMultiCo ? selectedCompanies.map(co => jrnCo === co ? amt : 0) : [];
              out.push({
                code: String(j.JournalNumber ?? j.journalNumber ?? ''),
                label: '  '.repeat(depth + 2) + (j.JournalHeader ?? j.journalHeader ?? ''),
                total: amt, cVal: null, c2Val: null, c3Val: null,
                coVals,
                depth: depth + 2, isJrn: true,
              });
            });
if (bsHasB || bsHasC || bsHasD) {
              const aNums = new Set(jrns.map(j => j.JournalNumber ?? j.journalNumber));
              const seen = new Map();
              const collect = (idx, period) => {
                (idx.get(String(node.code)) || []).forEach(j => {
                  const num = j.JournalNumber ?? j.journalNumber;
                  if (aNums.has(num)) return;
                  if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                  seen.get(num).periods[period] = parseAmt(j.AmountYTD ?? j.amountYTD ?? 0);
                });
              };
              if (bsHasB) collect(jrnByCodeCmpPdf,  'B');
              if (bsHasC) collect(jrnByCodeCmp2Pdf, 'C');
              if (bsHasD) collect(jrnByCodeCmp3Pdf, 'D');
              seen.forEach((entry, num) => {
                ['B','C','D'].forEach(p => {
                  if (entry.periods[p] != null) return;
                  const idx = p === 'B' ? jrnByCodeCmpPdf : p === 'C' ? jrnByCodeCmp2Pdf : jrnByCodeCmp3Pdf;
                  const match = (idx.get(String(node.code)) || []).find(j => (j.JournalNumber ?? j.journalNumber) === num);
                  if (match) entry.periods[p] = parseAmt(match.AmountYTD ?? match.amountYTD ?? 0);
                });
              });
              if (seen.size > 0) {
                out.push({
                  code: '', label: '  '.repeat(depth + 1) + `↳ B/C/D only (${seen.size})`,
                  total: null, cVal: null, c2Val: null, c3Val: null,
                  depth: depth + 1, isJrn: true, isJrnHeader: true,
                });
                seen.forEach((entry, num) => {
                  const jhdr = entry.jrn.JournalHeader ?? entry.jrn.journalHeader ?? '';
                  out.push({
                    code: String(num ?? ''),
                    label: '  '.repeat(depth + 2) + jhdr,
                    total: null,
                    cVal: entry.periods.B,
                    c2Val: entry.periods.C,
                    c3Val: entry.periods.D,
                    depth: depth + 2, isJrn: true,
                  });
                });
              }
            }
          }
        }

        (node.children || []).forEach(child => pushNode(child, depth + 1));
      };

      savedBsLiteral.forEach((section) => {
        const lbl = section.label ?? section.name ?? section.title ?? section.breaker ?? section.breakerLabel ?? section.heading;
        const col = section.color ?? section.colour ?? section.bg ?? section.background ?? section.fill;
        if (lbl) {
          out.push({
            code: '', label: String(lbl).toUpperCase(),
            total: null, cVal: null, c2Val: null, c3Val: null,
            _isSectionHeader: true, _sectionColor: hexToRgb(col),
          });
        }
        (section.nodes || []).forEach(n => pushNode(n, 0));
      });
      return out;
    };

const makePlCols = (view) => {
      // Multi-company: ONLY per-company columns
      if (hasMultiCo) {
        const cols = [{ header: t("export_col_code"), dataKey: 'code' }, { header: t("col_account"), dataKey: 'label' }];
        perCoMaps.forEach((c, i) => cols.push({ header: c.legal, dataKey: `co${i}` }));
        return cols;
      }
      // History: current month + 5 historic months, one col each (uses ytdOnly metric)
      if (hasHistoryPL) {
        const cols = [{ header: t("export_col_code"), dataKey: 'code' }, { header: t("col_account"), dataKey: 'label' }];
        const curLbl = MONTHS_T.find(m => String(m.value) === String(month))?.label?.slice(0, 3) ?? String(month);
        cols.push({ header: `${curLbl} ${year}`, dataKey: ytdOnly ? 'ytd' : 'mon' });
        plHistMaps.forEach((h, i) => {
          const moLbl = MONTHS_T.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3) ?? String(h.month);
          cols.push({ header: `${moLbl} ${h.year}`, dataKey: ytdOnly ? `histYtd${i}` : `histMon${i}` });
        });
        return cols;
      }
// Default: compare/main (view='monthly' | 'ytd' | undefined for both)
      const cols = [{ header: t("export_col_code"), dataKey: 'code' }, { header: t("col_account"), dataKey: 'label' }];
      if (view !== 'ytd') {
        cols.push({ header: t("pl_monthly"), dataKey: 'mon' });
        if (hasB) cols.push({ header: `B ${t("pl_monthly")}`, dataKey: 'cMon' }, { header: '±', dataKey: 'devM' }, { header: '± %', dataKey: 'devMP' });
        if (hasC) cols.push({ header: `C ${t("pl_monthly")}`, dataKey: 'c2Mon' }, { header: '±', dataKey: 'devM2' }, { header: '± %', dataKey: 'devM2P' });
        if (hasD) cols.push({ header: `D ${t("pl_monthly")}`, dataKey: 'c3Mon' }, { header: '±', dataKey: 'devM3' }, { header: '± %', dataKey: 'devM3P' });
      }
      if (view !== 'monthly') {
        cols.push({ header: t("pl_ytd"), dataKey: 'ytd' });
        if (hasB) cols.push({ header: `B ${t("pl_ytd")}`, dataKey: 'cYtd' }, { header: '±', dataKey: 'devY' }, { header: '± %', dataKey: 'devYP' });
        if (hasC) cols.push({ header: `C ${t("pl_ytd")}`, dataKey: 'c2Ytd' }, { header: '±', dataKey: 'devY2' }, { header: '± %', dataKey: 'devY2P' });
        if (hasD) cols.push({ header: `D ${t("pl_ytd")}`, dataKey: 'c3Ytd' }, { header: '±', dataKey: 'devY3' }, { header: '± %', dataKey: 'devY3P' });
      }
      return cols;
    };

const makeBsCols = () => {
      if (hasMultiCo) {
        const cols = [{ header: t("export_col_code"), dataKey: 'code' }, { header: t("col_account"), dataKey: 'label' }];
        perCoMaps.forEach((c, i) => cols.push({ header: c.legal, dataKey: `co${i}` }));
        return cols;
      }
      if (hasHistoryBS) {
        const cols = [{ header: t("export_col_code"), dataKey: 'code' }, { header: t("col_account"), dataKey: 'label' }];
        const curLbl = MONTHS_T.find(m => String(m.value) === String(month))?.label?.slice(0, 3) ?? String(month);
        cols.push({ header: `${curLbl} ${year}`, dataKey: 'total' });
        bsHistMaps.forEach((h, i) => {
          const moLbl = MONTHS_T.find(m => String(m.value) === String(h.month))?.label?.slice(0, 3) ?? String(h.month);
          cols.push({ header: `${moLbl} ${h.year}`, dataKey: `hist${i}` });
        });
        return cols;
      }
      const cols = [{ header: t("export_col_code"), dataKey: 'code' }, { header: t("col_account"), dataKey: 'label' }, { header: t("col_actual"), dataKey: 'total' }];
      if (bsHasB) cols.push({ header: 'B', dataKey: 'cVal' }, { header: '±', dataKey: 'devB' }, { header: '± %', dataKey: 'devBP' });
      if (bsHasC) cols.push({ header: 'C', dataKey: 'c2Val' }, { header: '±', dataKey: 'devC' }, { header: '± %', dataKey: 'devCP' });
      if (bsHasD) cols.push({ header: 'D', dataKey: 'c3Val' }, { header: '±', dataKey: 'devD' }, { header: '± %', dataKey: 'devDP' });
      return cols;
    };

    const toPlRowBody = (r) => {
      const o = { code: r.code || '', label: r.label, mon: r.mon != null ? plAmt(r.mon) : '', ytd: r.ytd != null ? plAmt(r.ytd) : '', _r: r };
      if (hasB) { o.cMon = r.cMon != null ? plAmt(r.cMon) : ''; o.devM = r.cMon != null && r.mon != null ? devAmt(r.mon, r.cMon) : ''; o.devMP = r.cMon != null && r.mon != null ? devPct(r.mon, r.cMon) : ''; o.cYtd = r.cYtd != null ? plAmt(r.cYtd) : ''; o.devY = r.cYtd != null && r.ytd != null ? devAmt(r.ytd, r.cYtd) : ''; o.devYP = r.cYtd != null && r.ytd != null ? devPct(r.ytd, r.cYtd) : ''; }
      if (hasC) { o.c2Mon = r.c2Mon != null ? plAmt(r.c2Mon) : ''; o.devM2 = r.c2Mon != null && r.mon != null ? devAmt(r.mon, r.c2Mon) : ''; o.devM2P = r.c2Mon != null && r.mon != null ? devPct(r.mon, r.c2Mon) : ''; o.c2Ytd = r.c2Ytd != null ? plAmt(r.c2Ytd) : ''; o.devY2 = r.c2Ytd != null && r.ytd != null ? devAmt(r.ytd, r.c2Ytd) : ''; o.devY2P = r.c2Ytd != null && r.ytd != null ? devPct(r.ytd, r.c2Ytd) : ''; }
if (hasD) { o.c3Mon = r.c3Mon != null ? plAmt(r.c3Mon) : ''; o.devM3 = r.c3Mon != null && r.mon != null ? devAmt(r.mon, r.c3Mon) : ''; o.devM3P = r.c3Mon != null && r.mon != null ? devPct(r.mon, r.c3Mon) : ''; o.c3Ytd = r.c3Ytd != null ? plAmt(r.c3Ytd) : ''; o.devY3 = r.c3Ytd != null && r.ytd != null ? devAmt(r.ytd, r.c3Ytd) : ''; o.devY3P = r.c3Ytd != null && r.ytd != null ? devPct(r.ytd, r.c3Ytd) : ''; }
      if (Array.isArray(r.histVals)) r.histVals.forEach((h, i) => { o[`histMon${i}`] = h.mon != null ? plAmt(h.mon) : ''; o[`histYtd${i}`] = h.ytd != null ? plAmt(h.ytd) : ''; });
      if (Array.isArray(r.coVals)) r.coVals.forEach((v, i) => { o[`co${i}`] = v != null ? plAmt(v) : ''; });
      return o;
    };

    const toBsRowBody = (r) => {
      const o = { code: r.code || '', label: r.label, total: r.total != null ? fmtN(r.total) : '', _r: r };
      if (bsHasB) { o.cVal = r.cVal != null ? fmtN(r.cVal) : ''; o.devB = r.cVal != null && r.total != null ? devAmt(r.total, r.cVal) : ''; o.devBP = r.cVal != null && r.total != null ? devPct(r.total, r.cVal) : ''; }
      if (bsHasC) { o.c2Val = r.c2Val != null ? fmtN(r.c2Val) : ''; o.devC = r.c2Val != null && r.total != null ? devAmt(r.total, r.c2Val) : ''; o.devCP = r.c2Val != null && r.total != null ? devPct(r.total, r.c2Val) : ''; }
if (bsHasD) { o.c3Val = r.c3Val != null ? fmtN(r.c3Val) : ''; o.devD = r.c3Val != null && r.total != null ? devAmt(r.total, r.c3Val) : ''; o.devDP = r.c3Val != null && r.total != null ? devPct(r.total, r.c3Val) : ''; }
      if (Array.isArray(r.histVals)) r.histVals.forEach((v, i) => { o[`hist${i}`] = v != null ? fmtN(v) : ''; });
      if (Array.isArray(r.coVals)) r.coVals.forEach((v, i) => { o[`co${i}`] = v != null ? fmtN(v) : ''; });
      return o;
    };

    const styleRowCell = (data, isPL) => {
      if (data.section === 'head') {
        data.cell.styles.halign = ['code','label'].includes(data.column.dataKey) ? 'left' : 'right';
        const k = data.column.dataKey;
        if (isPL) {
          if (['cMon','devM','devMP','cYtd','devY','devYP'].includes(k)) data.cell.styles.fillColor = REDDK;
          if (['c2Mon','devM2','devM2P','c2Ytd','devY2','devY2P'].includes(k)) data.cell.styles.fillColor = GRNDK;
          if (['c3Mon','devM3','devM3P','c3Ytd','devY3','devY3P'].includes(k)) data.cell.styles.fillColor = PURPLEDK;
        } else {
          if (['cVal','devB','devBP'].includes(k)) data.cell.styles.fillColor = REDDK;
          if (['c2Val','devC','devCP'].includes(k)) data.cell.styles.fillColor = GRNDK;
          if (['c3Val','devD','devDP'].includes(k)) data.cell.styles.fillColor = PURPLEDK;
        }
        return;
      }
const r = data.row.raw._r; if (!r) return;
      const col = data.column.dataKey;
      if (r._isSectionHeader) {
        data.cell.styles.fillColor = r._sectionColor || NAVYDK;
        data.cell.styles.textColor = WHITE;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 7.5;
        if (col === 'label') data.cell.styles.halign = 'left';
        return;
      }
      if (r.isHighlighted) { data.cell.styles.fillColor = LIGHT; data.cell.styles.fontStyle = 'bold'; if (['code','label'].includes(col)) data.cell.styles.textColor = NAVY; }
      else if (r.isBold) data.cell.styles.fontStyle = 'bold';
      if (r.isDim) data.cell.styles.textColor = AMBER;
      if (r.isJrn && !r.isJrnHeader) data.cell.styles.textColor = [100,110,200];
      if (r.isJrnHeader) { data.cell.styles.textColor = [80,90,180]; data.cell.styles.fontStyle = 'bold'; }
      if (r.isLeaf) data.cell.styles.textColor = TEXT_MUT;
      if (col === 'code') { data.cell.styles.font = 'courier'; data.cell.styles.textColor = r.isHighlighted ? NAVY : GRAY; data.cell.styles.fontStyle = 'normal'; data.cell.styles.fontSize = 5.5; }
      if (!['code','label'].includes(col)) data.cell.styles.halign = 'right';
      const isPos = v => typeof v === 'string' && !v.startsWith('(') && v !== '—' && v !== '';
      const isNeg = v => typeof v === 'string' && v.startsWith('(');
      const v = data.cell.text[0];
      if (isPL) {
        if (['devM','devY','devM2','devY2','devM3','devY3'].includes(col)) data.cell.styles.textColor = isPos(v) ? GRN : isNeg(v) ? RED : GRAY;
        if (['devMP','devYP','devM2P','devY2P','devM3P','devY3P'].includes(col)) { data.cell.styles.textColor = isPos(v) ? GRN : isNeg(v) ? RED : GRAY; data.cell.styles.fontStyle = 'bold'; }
        if (['cMon','cYtd'].includes(col)) data.cell.styles.textColor = r.isBold ? REDDK : RED;
        if (['c2Mon','c2Ytd'].includes(col)) data.cell.styles.textColor = r.isBold ? GRNDK : GRN;
        if (['c3Mon','c3Ytd'].includes(col)) data.cell.styles.textColor = r.isBold ? PURPLEDK : PURPLE;
      } else {
        if (['devB','devC','devD'].includes(col)) data.cell.styles.textColor = isPos(v) ? GRN : isNeg(v) ? RED : GRAY;
        if (['devBP','devCP','devDP'].includes(col)) { data.cell.styles.textColor = isPos(v) ? GRN : isNeg(v) ? RED : GRAY; data.cell.styles.fontStyle = 'bold'; }
        if (col === 'cVal') data.cell.styles.textColor = r.isBold ? REDDK : RED;
        if (col === 'c2Val') data.cell.styles.textColor = r.isBold ? GRNDK : GRN;
        if (col === 'c3Val') data.cell.styles.textColor = r.isBold ? PURPLEDK : PURPLE;
      }
    };

const plColStyles = (view) => {
      const usable = W - 16;
      const codeW = 22;
      if (hasMultiCo) {
        const n = perCoMaps.length;
        const labelW = Math.max(60, usable * 0.32);
        const valW = (usable - codeW - labelW) / n;
        const s = { code: { cellWidth: codeW, halign: 'left' }, label: { cellWidth: labelW, halign: 'left' } };
        for (let i = 0; i < n; i++) s[`co${i}`] = { cellWidth: valW, halign: 'right' };
        return s;
      }
      if (hasHistoryPL) {
        const n = 1 + plHistMaps.length;
        const labelW = Math.max(60, usable * 0.30);
        const valW = (usable - codeW - labelW) / n;
        const s = { code: { cellWidth: codeW, halign: 'left' }, label: { cellWidth: labelW, halign: 'left' } };
        s.mon = { cellWidth: valW, halign: 'right' };
        s.ytd = { cellWidth: valW, halign: 'right' };
        for (let i = 0; i < plHistMaps.length; i++) {
          s[`histMon${i}`] = { cellWidth: valW, halign: 'right' };
          s[`histYtd${i}`] = { cellWidth: valW, halign: 'right' };
        }
        return s;
      }
const cc = (hasB ? 1 : 0) + (hasC ? 1 : 0) + (hasD ? 1 : 0);
      const sides = view ? 1 : 2;
      const valW = view ? 22 : (cc === 0 ? usable * 0.18 : 13);
      const diffW = view ? 18 : 11;
      const pctW = view ? 14 : 9;
      const labelW = usable - codeW - (cc === 0 ? valW * sides : (valW * sides + sides * cc * (valW + diffW + pctW)));
      const s = { code: { cellWidth: codeW, halign: 'left' }, label: { cellWidth: Math.max(40, labelW), halign: 'left' }, mon: { cellWidth: valW, halign: 'right' }, ytd: { cellWidth: valW, halign: 'right' } };
      [['B','cMon','devM','devMP','cYtd','devY','devYP', hasB],['C','c2Mon','devM2','devM2P','c2Ytd','devY2','devY2P', hasC],['D','c3Mon','devM3','devM3P','c3Ytd','devY3','devY3P', hasD]].forEach(([,a,b,c,d,e,f,en]) => { if (en) { s[a] = { cellWidth: valW, halign: 'right' }; s[b] = { cellWidth: diffW, halign: 'right' }; s[c] = { cellWidth: pctW, halign: 'right' }; s[d] = { cellWidth: valW, halign: 'right' }; s[e] = { cellWidth: diffW, halign: 'right' }; s[f] = { cellWidth: pctW, halign: 'right' }; }});
      return s;
    };

const bsColStyles = () => {
      const usable = W - 16;
      const codeW = 22;
      if (hasMultiCo) {
        const n = perCoMaps.length;
        const labelW = Math.max(70, usable * 0.32);
        const valW = (usable - codeW - labelW) / n;
        const s = { code: { cellWidth: codeW, halign: 'left' }, label: { cellWidth: labelW, halign: 'left' } };
        for (let i = 0; i < n; i++) s[`co${i}`] = { cellWidth: valW, halign: 'right' };
        return s;
      }
      if (hasHistoryBS) {
        const n = 1 + bsHistMaps.length;
        const labelW = Math.max(70, usable * 0.30);
        const valW = (usable - codeW - labelW) / n;
        const s = { code: { cellWidth: codeW, halign: 'left' }, label: { cellWidth: labelW, halign: 'left' } };
        s.total = { cellWidth: valW, halign: 'right' };
        for (let i = 0; i < bsHistMaps.length; i++) s[`hist${i}`] = { cellWidth: valW, halign: 'right' };
        return s;
      }
      const cc = (bsHasB ? 1 : 0) + (bsHasC ? 1 : 0) + (bsHasD ? 1 : 0);
      const valW = 18, diffW = 14, pctW = 11;
      const labelW = usable - codeW - valW - cc * (valW + diffW + pctW);
      const s = { code: { cellWidth: codeW, halign: 'left' }, label: { cellWidth: Math.max(50, labelW), halign: 'left' }, total: { cellWidth: valW, halign: 'right' } };
      [['cVal','devB','devBP', bsHasB],['c2Val','devC','devCP', bsHasC],['c3Val','devD','devDP', bsHasD]].forEach(([a,b,c,en]) => { if (en) { s[a] = { cellWidth: valW, halign: 'right' }; s[b] = { cellWidth: diffW, halign: 'right' }; s[c] = { cellWidth: pctW, halign: 'right' }; }});
      for (let i = 0; i < bsHistMaps.length; i++) s[`hist${i}`] = { cellWidth: valW, halign: 'right' };
      return s;
    };

    const renderPage = (title, isFirst, cols, body, isPL, colStyles, useCmpFlag = null, useLabels = null) => {
      const startY = drawHeader(title, isFirst, useCmpFlag, useLabels);
      const isCompact = (useCmpFlag ?? hasB) || (useCmpFlag === null && bsHasB && title.startsWith('Balance'));
      autoTable(doc, {
        startY, columns: cols, body,
        margin: { left: 8, right: 8, bottom: 10 },
        tableWidth: 'auto',
        styles: { fontSize: isCompact ? 5.8 : 7.5, cellPadding: { top: isCompact ? 1.6 : 2.5, bottom: isCompact ? 1.6 : 2.5, left: isCompact ? 1.6 : 3, right: isCompact ? 1.6 : 3 }, overflow: 'linebreak', lineColor: GRAYLT, lineWidth: 0.1, font: 'helvetica', textColor: TEXTDK },
        headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: isCompact ? 5.5 : 7, cellPadding: { top: 3, bottom: 3, left: isCompact ? 2 : 3, right: isCompact ? 2 : 3 }, lineWidth: 0 },
        columnStyles: colStyles,
        alternateRowStyles: { fillColor: STRIPE },
        didParseCell: (d) => styleRowCell(d, isPL),
        didDrawPage: () => drawFooterBrand(),
      });
    };

let isFirst = true;
    const hasSavedPlLit = Array.isArray(savedPlLiteral) && savedPlLiteral.length > 0;
    const hasSavedBsLit = Array.isArray(savedBsLiteral) && savedBsLiteral.length > 0;

    const renderPlForChunk = (chunkIdx) => {
      if (hasMultiCo) perCoMaps = buildPerCoMaps(coChunksAll[chunkIdx]);
      const chunkSuffix = hasMultiCo && coChunksAll.length > 1
        ? ` (cos ${chunkIdx * MULTI_CO_CHUNK + 1}–${chunkIdx * MULTI_CO_CHUNK + coChunksAll[chunkIdx].length})`
        : '';

      if (hasSavedPlLit) {
        if (opts.plSaved !== false) {
          const savedPlBody = buildSavedPlRowsLit().map(toPlRowBody);
          if (hasB || hasC || hasD) {
renderPage(`${t("page_pl_full")} — ${t("pl_monthly")}${chunkSuffix}`, isFirst, makePlCols('monthly'), savedPlBody, true, plColStyles('monthly')); isFirst = false;
            renderPage(`${t("page_pl_full")} — ${t("pl_ytd")}${chunkSuffix}`,     isFirst, makePlCols('ytd'),     savedPlBody, true, plColStyles('ytd'));     isFirst = false;
          } else {
            renderPage(`${t("page_pl_full")}${chunkSuffix}`, isFirst, makePlCols(), savedPlBody, true, plColStyles()); isFirst = false;
          }
        }
      } else {
        if (opts.plSummary !== false) {
          if (hasB || hasC || hasD) {
renderPage(`${t("page_pl")} — ${t("view_summary")} — ${t("pl_monthly")}${chunkSuffix}`, isFirst, makePlCols('monthly'), buildPlSummaryRows().map(toPlRowBody), true, plColStyles('monthly')); isFirst = false;
            renderPage(`${t("page_pl")} — ${t("view_summary")} — ${t("pl_ytd")}${chunkSuffix}`,     isFirst, makePlCols('ytd'),     buildPlSummaryRows().map(toPlRowBody), true, plColStyles('ytd'));     isFirst = false;
          } else {
            renderPage(`${t("page_pl")} — ${t("view_summary")}${chunkSuffix}`, isFirst, makePlCols(), buildPlSummaryRows().map(toPlRowBody), true, plColStyles()); isFirst = false;
          }
        }
        if (opts.plDetailed !== false) {
          if (hasB || hasC || hasD) {
            renderPage(`${t("page_pl")} — ${t("view_detailed")} — ${t("pl_monthly")}${chunkSuffix}`, isFirst, makePlCols('monthly'), buildPlRows(tree).map(toPlRowBody), true, plColStyles('monthly')); isFirst = false;
            renderPage(`${t("page_pl")} — ${t("view_detailed")} — ${t("pl_ytd")}${chunkSuffix}`,     isFirst, makePlCols('ytd'),     buildPlRows(tree).map(toPlRowBody), true, plColStyles('ytd'));     isFirst = false;
          } else {
            renderPage(`${t("page_pl")} — ${t("view_detailed")}${chunkSuffix}`, isFirst, makePlCols(), buildPlRows(tree).map(toPlRowBody), true, plColStyles()); isFirst = false;
          }
        }
      }
    };

    if (hasMultiCo && coChunksAll.length > 1) {
      coChunksAll.forEach((_, i) => renderPlForChunk(i));
    } else {
      renderPlForChunk(0);
    }

    const isAssetsRoot = n => (n.name ?? '').toLowerCase().includes('asset') || (n.name ?? '').toLowerCase().includes('activo');

const renderBsForChunk = (chunkIdx) => {
      if (hasMultiCo) perCoMaps = buildPerCoMaps(coChunksAll[chunkIdx]);
      const chunkSuffix = hasMultiCo && coChunksAll.length > 1 ? ` (cos ${chunkIdx * MULTI_CO_CHUNK + 1}–${chunkIdx * MULTI_CO_CHUNK + coChunksAll[chunkIdx].length})` : '';

      if (hasSavedBsLit) {
if (opts.bsSaved !== false) { renderPage(`${t("page_bs_full")}${chunkSuffix}`, isFirst, makeBsCols(), buildSavedBsRowsLit().map(toBsRowBody), false, bsColStyles(), bsHasB, { b: bsBLabel, c: bsCLabel, d: bsDLabel }); isFirst = false; }
      } else {
        if (opts.bsSummary !== false) { renderPage(`${t("page_bs_full")} — ${t("view_summary")}${chunkSuffix}`, isFirst, makeBsCols(), buildBsRows().map(toBsRowBody),                       false, bsColStyles(), bsHasB, { b: bsBLabel, c: bsCLabel, d: bsDLabel }); isFirst = false; }
        if (opts.bsAssets  !== false) { renderPage(`${t("page_bs_full")} — ${t("bs_assets")}${chunkSuffix}`,   isFirst, makeBsCols(), buildBsRows(isAssetsRoot).map(toBsRowBody),          false, bsColStyles(), bsHasB, { b: bsBLabel, c: bsCLabel, d: bsDLabel }); isFirst = false; }
        if (opts.bsEquity  !== false) { renderPage(`${t("page_bs_full")} — ${t("bs_equity_liab_full")}${chunkSuffix}`, isFirst, makeBsCols(), buildBsRows(n => !isAssetsRoot(n)).map(toBsRowBody), false, bsColStyles(), bsHasB, { b: bsBLabel, c: bsCLabel, d: bsDLabel }); isFirst = false; }
      }
    };

    if (hasMultiCo && coChunksAll.length > 1) {
      coChunksAll.forEach((_, i) => renderBsForChunk(i));
    } else {
      renderBsForChunk(0);
    }

    // Dims & Journal
    if (opts.dimJournal !== false && (uploadedAccounts.some(r => getField(r, 'dimensionCode')) || (journalEntries?.length > 0))) {
     const startY = drawHeader(t("export_dim_journal_title"), isFirst); isFirst = false;
      const dimBody = uploadedAccounts.filter(r => getField(r, 'dimensionCode')).map(r => ({
        acc: `${String(getField(r, 'accountCode') ?? '')}  ${String(getField(r, 'accountName') ?? '')}`.trim(),
        dim: `${String(getField(r, 'dimensionCode') ?? '')}  ${String(getField(r, 'dimensionName') ?? '')}`.trim(),
        lac: String(getField(r, 'localAccountCode') ?? '') + (getField(r, 'localAccountName') ? ' ' + getField(r, 'localAccountName') : ''),
        amt: fmtN(parseAmt(getField(r, 'AmountYTD', 'amountYTD', 'AmountPeriod', 'amountPeriod'))),
        co: String(getField(r, 'companyShortName', 'CompanyShortName') ?? ''),
        cur: String(getField(r, 'CurrencyCode', 'currencyCode') ?? ''),
      }));
      if (dimBody.length > 0) {
       autoTable(doc, { startY, columns: [{ header: t("col_account"), dataKey: 'acc' }, { header: t("dimension"), dataKey: 'dim' }, { header: t("export_local_account"), dataKey: 'lac' }, { header: t("dim_amount_ytd"), dataKey: 'amt' }, { header: t("dim_company"), dataKey: 'co' }, { header: t("jrn_currency"), dataKey: 'cur' }],
          body: dimBody, margin: { left: 8, right: 8, bottom: 10 }, tableWidth: W - 16,
          styles: { fontSize: 6.5, cellPadding: 2, overflow: 'ellipsize', lineColor: GRAYLT, lineWidth: 0.1, font: 'helvetica', textColor: TEXTDK },
          headStyles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', fontSize: 6, lineWidth: 0 },
          alternateRowStyles: { fillColor: [255, 248, 235] },
          didParseCell: (d) => { if (d.section !== 'head' && d.column.dataKey === 'amt') d.cell.styles.halign = 'right'; },
          didDrawPage: () => drawFooterBrand(),
        });
      }
      if (journalEntries?.length > 0) {
        const jY = (doc.lastAutoTable?.finalY ?? startY) + 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NAVY);
       doc.text(t("export_journal_entries"), 8, jY + 4);
        const jBody = journalEntries.map(j => ({
          jn: String(j.JournalNumber ?? j.journalNumber ?? ''), jh: String(j.JournalHeader ?? j.journalHeader ?? ''),
          acc: `${String(j.AccountCode ?? j.accountCode ?? '')}  ${String(j.AccountName ?? j.accountName ?? '')}`.trim(),
          jt: String(j.JournalType ?? j.journalType ?? ''), dim: String(j.DimensionName ?? j.dimensionName ?? ''),
          cp: String(j.CounterpartyShortName ?? j.counterpartyShortName ?? ''),
          amt: fmtN(parseAmt(j.AmountYTD ?? j.amountYTD ?? 0)),
          cur: String(j.CurrencyCode ?? j.currencyCode ?? ''),
        }));
       autoTable(doc, { startY: jY + 7, columns: [{ header: t("jrn_number"), dataKey: 'jn' }, { header: t("jrn_header"), dataKey: 'jh' }, { header: t("col_account"), dataKey: 'acc' }, { header: t("jrn_account_type"), dataKey: 'jt' }, { header: t("dimension"), dataKey: 'dim' }, { header: t("jrn_counterparty"), dataKey: 'cp' }, { header: t("jrn_amount_ytd"), dataKey: 'amt' }, { header: t("jrn_currency"), dataKey: 'cur' }],
          body: jBody, margin: { left: 8, right: 8, bottom: 10 }, tableWidth: W - 16,
          styles: { fontSize: 6.5, cellPadding: 2, overflow: 'ellipsize', lineColor: GRAYLT, lineWidth: 0.1, font: 'helvetica', textColor: TEXTDK },
          headStyles: { fillColor: [60, 50, 160], textColor: WHITE, fontStyle: 'bold', fontSize: 6, lineWidth: 0 },
          alternateRowStyles: { fillColor: [245, 243, 255] },
          didParseCell: (d) => { if (d.section !== 'head' && d.column.dataKey === 'amt') d.cell.styles.halign = 'right'; },
          didDrawPage: () => drawFooterBrand(),
        });
      }
    }

    // ── Insert Cover at page 1 ──
    doc.insertPage(1); doc.setPage(1);
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(38); doc.setTextColor(...WHITE);
    doc.text('KONSOLIDATOR', W / 2, H / 4, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(180, 200, 255);
doc.text(t("export_financial_report"), W / 2, H / 4 + 12, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...WHITE);
    doc.text(t("export_primary_period").toUpperCase(), W / 2, H / 4 + 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(200, 215, 255);
    const aLines = doc.splitTextToSize(aLabel, W - 40);
    let aY = H / 4 + 34;
    aLines.forEach(l => { doc.text(l, W / 2, aY, { align: 'center' }); aY += 5; });
    if (hasB || bsHasB) {
      let cY = aY + 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...WHITE);
     doc.text(t("export_compare_periods").toUpperCase(), W / 2, cY, { align: 'center' });
      cY += 6;
      const cmpLine = (letter, label, color) => {
        if (!label) return;
        doc.setFillColor(...color); doc.roundedRect(20, cY, W - 40, 5, 1, 1, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...WHITE);
        doc.text(letter, 23, cY + 3.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text(label, 29, cY + 3.5);
        cY += 6.5;
      };
      if (hasB) cmpLine('B', bLabel, REDDK);
      if (hasC) cmpLine('C', cLabel, GRNDK);
      if (hasD) cmpLine('D', dLabel, PURPLEDK);
      if (bsHasB && !hasB) cmpLine('B (BS)', bsBLabel, REDDK);
      if (bsHasC && !hasC) cmpLine('C (BS)', bsCLabel, GRNDK);
      if (bsHasD && !hasD) cmpLine('D (BS)', bsDLabel, PURPLEDK);
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 175, 230);
const dateStr = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(`${t("export_generated")}  ·  ${dateStr}`, W / 2, H - 12, { align: 'center' });

    // ── Insert TOC at page 2 ──
    doc.insertPage(2); doc.setPage(2);
    doc.setFillColor(...WHITE); doc.rect(0, 0, W, H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...NAVY);
    doc.text(t("export_toc"), W / 2, 30, { align: 'center' });
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.5);
    doc.line(W / 2 - 22, 33, W / 2 + 22, 33);
    let tocY = 55;
    sections.forEach((s, i) => {
      const adjustedPage = s.page + 2;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY);
      doc.text(`${String(i + 1).padStart(2, '0')}`, 30, tocY);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...TEXTDK);
      doc.text(s.title, 45, tocY);
      doc.setDrawColor(...GRAYLT); doc.setLineWidth(0.3); doc.setLineDashPattern([0.5, 1], 0);
      doc.line(45 + doc.getTextWidth(s.title) + 4, tocY - 1, W - 50, tocY - 1);
      doc.setLineDashPattern([], 0);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
      doc.text(String(adjustedPage), W - 30, tocY, { align: 'right' });
      try { doc.link(30, tocY - 5, W - 60, 7, { pageNumber: adjustedPage }); } catch { /* ignore */ }
      tocY += 11;
    });

    // ── Stamp page numbers on all content pages (3+) ──
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 3; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFillColor(...NAVYDK); doc.roundedRect(W - 26, 4, 22, 6, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(160, 185, 255);
      doc.text(`p. ${i} / ${totalPages}`, W - 15, 8, { align: 'center' });
      doc.setFillColor(...LIGHT); doc.rect(W - 35, H - 7, 35, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...NAVY);
      doc.text(`${i} / ${totalPages}`, W - 8, H - 2.8, { align: 'right' });
    }

    doc.save(`Konsolidator_${year}_${String(month).padStart(2, '0')}.pdf`);
  }

  const load = src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(() => load('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
    .then(() => { const { jsPDF } = window.jspdf; doGenerate(jsPDF, window.jspdf.jsPDF.autoTable ?? ((d, opts) => d.autoTable(opts))); })
.catch(e => alert(t("error_load_pdf_lib") + ': ' + e.message));
}


function PLStatement({
  externalAccColWidth, onAccColWidthChange,
  externalExpandedMap, externalSetExpandedMap,
  multiCompany = false,
  selectedCompanies = [],
  token,
  upDimGroups, upDimensions,
  onHistoryExpandedChange,
  externalHistoryExpanded,
  externalHistoryMonths,
  onHistoryMonthsChange,
  groupAccounts, uploadedAccounts, prevUploadedAccounts = [], dimensions = [],
  compareMode, onToggleCompare,
  cmpUploadedAccounts = [], cmpPrevUploadedAccounts = [],
  cmpFilters, onCmpFilterChange,
  prevUploadedAccountsRaw = [],
cmp2UploadedAccounts = [], cmp2PrevUploadedAccounts = [],
  cmp2Filters, onCmp2FilterChange,
  cmp3UploadedAccounts = [], cmp3PrevUploadedAccounts = [],
  cmp3Filters, onCmp3FilterChange,
  cmp3FilteredDims = [],
  cmp3Enabled = true, onCmp3EnabledChange,
  journalEntriesCmp3 = [],
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

const { colors } = useSettings();
const header3Style = useTypo("header3");
const t = useT();

const localName = useCallback((node) => {
  return pgcMapping?.names?.get(String(node.code)) ?? node.name;
}, [pgcMapping]);

const matchesSelf = useCallback((n, q) => {
  if (!q) return false;
  if (String(n.code ?? "").toLowerCase().includes(q)) return true;
  if (String(localName(n) ?? "").toLowerCase().includes(q)) return true;
  if (Array.isArray(n.uploadLeaves)) {
    for (const leaf of n.uploadLeaves) {
      if (leaf.type === "plain") continue;
      if (String(leaf.code ?? "").toLowerCase().includes(q)) return true;
      if (String(leaf.name ?? "").toLowerCase().includes(q)) return true;
      if (Array.isArray(leaf.children)) {
        for (const dim of leaf.children) {
          if (String(dim.code ?? "").toLowerCase().includes(q)) return true;
          if (String(dim.name ?? "").toLowerCase().includes(q)) return true;
        }
      }
    }
  }
  return false;
}, [localName]);

const subtreeMatches = useCallback((node, q) => {
  if (!q) return true;
  if (matchesSelf(node, q)) return true;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      if (!hasData(c)) continue;
      if (c.accountType && !["P/L", "DIS"].includes(c.accountType)) continue;
      if (subtreeMatches(c, q)) return true;
    }
  }
  return false;
}, [matchesSelf]);

const MONTHS = useMonths();
const body1Style = useTypo("body1");
const body2Style = useTypo("body2");
const subbody1Style = useTypo("subbody1");
const subbody2Style = useTypo("subbody2");
const expandedMap = useMemo(() => externalExpandedMap ?? {}, [externalExpandedMap]);
const setExpandedMap = externalSetExpandedMap ?? (() => {});
const [hoveredDimRow, setHoveredDimRow] = useState(null);
const [summaryMode, setSummaryMode] = useState(true);
const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef(null);
const [accColWidthInternal, setAccColWidthInternal] = useState(null);
const accColWidth = externalAccColWidth !== undefined ? externalAccColWidth : accColWidthInternal;
const setAccColWidth = onAccColWidthChange ?? setAccColWidthInternal;
const startAccResize = useCallback((e) => {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const th = handle.parentElement;
  const startX = e.clientX;
  const startW = accColWidth ?? th.getBoundingClientRect().width;

  // Medir el min: posición del último botón del header (expand/collapse all) + padding
const thRect = th.getBoundingClientRect();
  let maxRight = thRect.left;
  th.querySelectorAll("button").forEach(b => {
    const r = b.getBoundingClientRect().right;
    if (r > maxRight) maxRight = r;
  });
const minW = maxRight > thRect.left ? Math.max(60, maxRight - thRect.left + 12) : 220;

  const table = th.closest("table");
  const col = table?.querySelector("colgroup col:first-child");

  handle.classList.add("is-dragging");
  let latestW = startW;

  const move = (ev) => {
    const dx = ev.clientX - startX;
    latestW = Math.max(minW, Math.min(1200, startW + dx));
    if (col) col.style.width = `${latestW}px`;
    th.style.width = `${latestW}px`;
  };
  const up = () => {
    handle.classList.remove("is-dragging");
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setAccColWidth(latestW);
  };
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}, [accColWidth, setAccColWidth]);

useEffect(() => {
  const clamp = () => {
    const th = document.querySelector(".k-sticky-acc-head");
    if (!th) return;
    const thRect = th.getBoundingClientRect();
    let maxRight = thRect.left;
    th.querySelectorAll("button").forEach(b => {
      const r = b.getBoundingClientRect().right;
      if (r > maxRight) maxRight = r;
    });
    const minW = maxRight > thRect.left ? Math.max(60, maxRight - thRect.left + 12) : 220;
    const currentW = accColWidth ?? thRect.width;
    if (currentW < minW) setAccColWidth(minW);
  };
const raf = requestAnimationFrame(() => requestAnimationFrame(clamp));
  return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [accColWidth, savedPlLiteral, compareMode, multiCompany]);

  const searchDebounceRef = useRef(null);
  useEffect(() => () => clearTimeout(searchDebounceRef.current), []);
const [filtersOpen, setFiltersOpen] = useState(true);
  const [historyExpandedInternal, setHistoryExpandedInternal] = useState(false);
  const historyExpanded = externalHistoryExpanded !== undefined ? externalHistoryExpanded : historyExpandedInternal;
const setHistoryExpanded = useCallback((v) => {
    setHistoryExpandedInternal(v);
    onHistoryExpandedChange?.(v);
  }, [onHistoryExpandedChange]);
const [historyMonthsInternal, setHistoryMonthsInternal] = useState([]);
  const historyMonths = externalHistoryMonths !== undefined ? externalHistoryMonths : historyMonthsInternal;
  const historyMonthsRef = useRef(historyMonths);
  useEffect(() => { historyMonthsRef.current = historyMonths; }, [historyMonths]);
  const setHistoryMonths = useCallback((updater) => {
    const current = historyMonthsRef.current;
    const next = typeof updater === "function" ? updater(current) : updater;
    historyMonthsRef.current = next;
    setHistoryMonthsInternal(next);
    onHistoryMonthsChange?.(next);
  }, [onHistoryMonthsChange]);
  const [historyLoading, setHistoryLoading] = useState(false);
const fetchHistoryMonth = useCallback(async (y, mo) => {
    if (!token || !source || !structure || !y || !mo) return { data: [], prevData: [], journals: [] };
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const coClause = selectedCompanies?.[0] ? ` and CompanyShortName eq '${selectedCompanies[0]}'` : '';
    const buildFilter = (yy, mm) => `Year eq ${yy} and Month eq ${mm} and Source eq '${source}' and GroupStructure eq '${structure}'${coClause}`;
    const buildJrnFilter = (yy, mm) => `Year eq ${yy} and Month eq ${mm} and Source eq '${source}'${coClause}`;
    try {
      const [resA, resJ] = await Promise.all([
        fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(buildFilter(y, mo))}`, { headers: h }),
        fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(buildJrnFilter(y, mo))}`, { headers: h }),
      ]);
      console.log('[JRN-FETCH]', y, mo, 'status:', resJ.status, 'url:', `${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(buildJrnFilter(y, mo))}`);
      const jsonA = resA.ok ? await resA.json() : { value: [] };
      const data = jsonA.value ?? (Array.isArray(jsonA) ? jsonA : []);
const jsonJ = resJ.ok ? await resJ.json() : { value: [] };
      const journals = jsonJ.value ?? (Array.isArray(jsonJ) ? jsonJ : []);
      console.log('[PL hist fetch]', y, mo, 'journals:', journals.length, 'resJStatus:', resJ.status, 'sample:', JSON.stringify(journals[0]));
      let prev = [];
      if (Number(mo) !== 1) {
        const resB = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(buildFilter(y, Number(mo) - 1))}`, { headers: h });
        const jsonB = resB.ok ? await resB.json() : { value: [] };
        prev = jsonB.value ?? (Array.isArray(jsonB) ? jsonB : []);
      }
      return { data, prevData: prev, journals };
    } catch { return { data: [], prevData: [], journals: [] }; }
 }, [token, source, structure, selectedCompanies]);

const toggleHistory = useCallback(() => {
    if (compareMode || multiCompany) return;
    setHistoryExpanded(!historyExpanded);
}, [compareMode, multiCompany, historyExpanded, setHistoryExpanded]);
// Single sync effect: fetches when expanded turns on or period changes; clears when off.
// Skips refetch on remount when nothing actually changed.
const plHistSyncRef = useRef({ expanded: externalHistoryExpanded, period: `${year}-${month}`, scope: `${source}|${structure}|${selectedCompanies?.[0] ?? ''}` });
useEffect(() => {
  const currentPeriod = `${year}-${month}`;
  const currentScope = `${source}|${structure}|${selectedCompanies?.[0] ?? ''}`;
  const last = plHistSyncRef.current;
  const expandedChanged = last.expanded !== externalHistoryExpanded;
  const periodChanged = last.period !== currentPeriod;
  const scopeChanged = last.scope !== currentScope;
  plHistSyncRef.current = { expanded: externalHistoryExpanded, period: currentPeriod, scope: currentScope };

  if (!externalHistoryExpanded) {
    if (expandedChanged && historyMonthsRef.current.length > 0) setHistoryMonths([]);
    return;
  }
  if (compareMode || multiCompany) return;
  if (!expandedChanged && !periodChanged && !scopeChanged && historyMonthsRef.current.length > 0) return;

  (async () => {
    setHistoryLoading(true);
    setHistoryMonths([]);
    const targets = [];
    let y = Number(year), m = Number(month);
    for (let i = 0; i < 5; i++) {
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      targets.push({ year: y, month: m });
    }
    for (const tg of targets) {
      const { data, prevData, journals } = await fetchHistoryMonth(tg.year, tg.month);
      setHistoryMonths(prev => {
        const filtered = prev.filter(p => !(p.year === tg.year && p.month === tg.month));
        return [...filtered, { year: tg.year, month: tg.month, data, prevData, journals }];
      });
    }
    setHistoryLoading(false);
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [externalHistoryExpanded, year, month, source, structure, selectedCompanies]);

const [jrnPopup, setJrnPopup] = useState(null);
const [dimPopup, setDimPopup] = useState(null);
  
  const tree = useMemo(() => buildTree(groupAccounts, uploadedAccounts, !dimensionActive), [groupAccounts, uploadedAccounts, dimensionActive]);

  const toggle = (code) => setExpandedMap(prev => ({ ...prev, [code]: !isOpen(code) }));

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

const cmpLeafDimIndex = useMemo(() => {
  const idx = new Map();
  (cmpUploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dc  = String(getField(row, "dimensionCode") ?? "");
    if (!lac || !dc || dc === "null") return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
  });
  return idx;
}, [cmpUploadedAccounts]);

const cmp2LeafDimIndex = useMemo(() => {
  const idx = new Map();
  (cmp2UploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dc  = String(getField(row, "dimensionCode") ?? "");
    if (!lac || !dc || dc === "null") return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
  });
  return idx;
}, [cmp2UploadedAccounts]);

const cmp3LeafDimIndex = useMemo(() => {
  const idx = new Map();
  (cmp3UploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dc  = String(getField(row, "dimensionCode") ?? "");
    if (!lac || !dc || dc === "null") return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
  });
  return idx;
}, [cmp3UploadedAccounts]);

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

const cmpPrevLeafIndex = useMemo(() => {
  const idx = new Map();
  (cmpPrevUploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmpPrevUploadedAccounts]);

const cmp2PrevLeafIndex = useMemo(() => {
  const idx = new Map();
  (cmp2PrevUploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp2PrevUploadedAccounts]);

const getCmpPrevLeafAmt = useCallback((localCode) => {
  if (Number(cmpFilters?.month) === 1) return 0;
  return cmpPrevLeafIndex.get(String(localCode)) ?? 0;
}, [cmpPrevLeafIndex, cmpFilters]);

const getCmp2PrevLeafAmt = useCallback((localCode) => {
  if (Number(cmp2Filters?.month) === 1) return 0;
  return cmp2PrevLeafIndex.get(String(localCode)) ?? 0;
}, [cmp2PrevLeafIndex, cmp2Filters]);

// ── Multi-company per-company indexes ───────────────────────
const perCompanyData = useMemo(() => {
  if (!multiCompany) return null;
  const map = new Map();
  selectedCompanies.forEach(co => map.set(co, []));
  (uploadedAccounts || []).forEach(row => {
    const co = String(getField(row, "companyShortName", "CompanyShortName") ?? "");
    if (map.has(co)) map.get(co).push(row);
  });
  return map;
}, [uploadedAccounts, selectedCompanies, multiCompany]);

const perCompanyPrevData = useMemo(() => {
  if (!multiCompany) return null;
  const map = new Map();
  selectedCompanies.forEach(co => map.set(co, []));
  (prevUploadedAccounts || []).forEach(row => {
    const co = String(getField(row, "companyShortName", "CompanyShortName") ?? "");
    if (map.has(co)) map.get(co).push(row);
  });
  return map;
}, [prevUploadedAccounts, selectedCompanies, multiCompany]);

const perCompanyNodeByCode = useMemo(() => {
  if (!multiCompany || !perCompanyData) return null;
  const map = new Map();
  selectedCompanies.forEach(co => {
    const t = buildTree(groupAccounts, perCompanyData.get(co) ?? [], !dimensionActive);
    const codeMap = new Map();
    const walk = (n) => { codeMap.set(n.code, n); n.children?.forEach(walk); };
    t.forEach(walk);
    map.set(co, codeMap);
  });
  return map;
}, [groupAccounts, perCompanyData, selectedCompanies, multiCompany, dimensionActive]);

const perCompanyPrevNodeByCode = useMemo(() => {
  if (!multiCompany || !perCompanyPrevData) return null;
  const map = new Map();
  selectedCompanies.forEach(co => {
    const t = buildTree(groupAccounts, perCompanyPrevData.get(co) ?? [], !dimensionActive);
    const codeMap = new Map();
    const walk = (n) => { codeMap.set(n.code, n); n.children?.forEach(walk); };
    t.forEach(walk);
    map.set(co, codeMap);
  });
  return map;
}, [groupAccounts, perCompanyPrevData, selectedCompanies, multiCompany, dimensionActive]);

const getNodeValForCompany = useCallback((code, company, isYtd) => {
  const node = perCompanyNodeByCode?.get(company)?.get(code);
  const ytdV = node ? -sumNode(node) : 0;
  if (isYtd) return ytdV;
  if (Number(month) === 1) return ytdV;
  const prev = perCompanyPrevNodeByCode?.get(company)?.get(code);
  const prevV = prev ? -sumNode(prev) : 0;
  return ytdV - prevV;
}, [perCompanyNodeByCode, perCompanyPrevNodeByCode, month]);

const perCompanyLeafIdx = useMemo(() => {
  if (!multiCompany) return null;
  const result = new Map();
  selectedCompanies.forEach(co => {
    const idx = new Map();
    (perCompanyData?.get(co) || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      idx.set(lac, (idx.get(lac) ?? 0) + amt);
    });
    result.set(co, idx);
  });
  return result;
}, [multiCompany, perCompanyData, selectedCompanies]);

const perCompanyPrevLeafIdx = useMemo(() => {
  if (!multiCompany) return null;
  const result = new Map();
  selectedCompanies.forEach(co => {
    const idx = new Map();
    (perCompanyPrevData?.get(co) || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      idx.set(lac, (idx.get(lac) ?? 0) + amt);
    });
    result.set(co, idx);
  });
  return result;
}, [multiCompany, perCompanyPrevData, selectedCompanies]);

const getLeafValForCompany = useCallback((localCode, co, isYtd) => {
  const ytd = perCompanyLeafIdx?.get(co)?.get(String(localCode)) ?? 0;
  if (isYtd) return -ytd;
  if (Number(month) === 1) return -ytd;
  const prev = perCompanyPrevLeafIdx?.get(co)?.get(String(localCode)) ?? 0;
  return -(ytd - prev);
}, [perCompanyLeafIdx, perCompanyPrevLeafIdx, month]);

const perCompanyLeafDimIdx = useMemo(() => {
  if (!multiCompany) return null;
  const result = new Map();
  selectedCompanies.forEach(co => {
    const idx = new Map();
    (perCompanyData?.get(co) || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      const dc  = String(getField(row, "dimensionCode") ?? "");
      if (!lac || !dc || dc === "null") return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
    });
    result.set(co, idx);
  });
  return result;
}, [multiCompany, perCompanyData, selectedCompanies]);

const perCompanyPrevLeafDimIdx = useMemo(() => {
  if (!multiCompany) return null;
  const result = new Map();
  selectedCompanies.forEach(co => {
    const idx = new Map();
    (perCompanyPrevData?.get(co) || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      const dc  = String(getField(row, "dimensionCode") ?? "");
      if (!lac || !dc || dc === "null") return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
    });
    result.set(co, idx);
  });
  return result;
}, [multiCompany, perCompanyPrevData, selectedCompanies]);

const getDimValForCompany = useCallback((localCode, dimCode, co, isYtd) => {
  const ytd = perCompanyLeafDimIdx?.get(co)?.get(`${String(localCode)}|${String(dimCode)}`) ?? 0;
  if (isYtd) return -ytd;
  if (Number(month) === 1) return -ytd;
  const prev = perCompanyPrevLeafDimIdx?.get(co)?.get(`${String(localCode)}|${String(dimCode)}`) ?? 0;
  return -(ytd - prev);
}, [perCompanyLeafDimIdx, perCompanyPrevLeafDimIdx, month]);

const journalByCode = useMemo(() => {
  const idx = new Map();
  (journalEntries || []).forEach(row => {
    if (idx.size === 0) console.log('[A]', JSON.stringify(row));
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

// ── Compare period 3 trees ──────────────────────────────────
const cmp3Tree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmp3UploadedAccounts, !dimensionActive) : [],
  [groupAccounts, cmp3UploadedAccounts, compareMode, dimensionActive]
);
const cmp3PrevTree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmp3PrevUploadedAccounts, !dimensionActive) : [],
  [groupAccounts, cmp3PrevUploadedAccounts, compareMode, dimensionActive]
);
const cmp3NodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  cmp3Tree.forEach(walk);
  return map;
}, [cmp3Tree]);
const cmp3PrevNodeByCode = useMemo(() => {
  const map = new Map();
  function walk(node) { map.set(node.code, node); node.children?.forEach(walk); }
  cmp3PrevTree.forEach(walk);
  return map;
}, [cmp3PrevTree]);

const cmp3LeafIndex = useMemo(() => {
  const idx = new Map();
  (cmp3UploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp3UploadedAccounts]);

const cmp3PrevLeafIndex = useMemo(() => {
  const idx = new Map();
  (cmp3PrevUploadedAccounts || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp3PrevUploadedAccounts]);

const getCmp3LeafAmt = useCallback((localCode) => {
  return cmp3LeafIndex.get(String(localCode)) ?? 0;
}, [cmp3LeafIndex]);

const getCmp3PrevLeafAmt = useCallback((localCode) => {
  if (Number(cmp3Filters?.month) === 1) return 0;
  return cmp3PrevLeafIndex.get(String(localCode)) ?? 0;
}, [cmp3PrevLeafIndex, cmp3Filters]);

const getCmp3Ytd = useCallback((code) => { const n = cmp3NodeByCode.get(code); return n ? sumNode(n) : 0; }, [cmp3NodeByCode]);
const getCmp3Prev = useCallback((code) => {
  if (Number(cmp3Filters?.month) === 1) return 0;
  const n = cmp3PrevNodeByCode.get(code); return n ? sumNode(n) : 0;
}, [cmp3PrevNodeByCode, cmp3Filters]);

const journalByCodeCmp3 = useMemo(() => {
  const idx = new Map();
  (journalEntriesCmp3 || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? "");
    if (!code) return;
    const jt = String(row.journalType ?? row.JournalType ?? "").toUpperCase();
    if (jt !== "AJE" && jt !== "RJE") return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntriesCmp3]);

// History months: filter raw data by dims, build trees, build code lookups
const historyMonthsProcessed = useMemo(() => {
  console.log('[HIST-MONTHS-RAW]', historyMonths.length, historyMonths.map(h => ({ y: h.year, m: h.month, dataLen: h.data?.length, jrnLen: h.journals?.length })));
return historyMonths.map(hRaw => {
    const h = {
      ...hRaw,
      data: (hRaw.data || []).filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions)),
      prevData: (hRaw.prevData || []).filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions)),
      journals: (hRaw.journals || []).filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions)),
    };
    console.log('[hist]', h.year, h.month, 'journals:', h.journals?.length ?? 0, 'sample:', JSON.stringify(h.journals?.[0]));
    const tree = buildTree(groupAccounts, h.data, !((upDimGroups?.length > 0) || (upDimensions?.length > 0)));
    const prevTree = buildTree(groupAccounts, h.prevData, !((upDimGroups?.length > 0) || (upDimensions?.length > 0)));
    const map = new Map();
    const prevMap = new Map();
    const walk = (m) => (n) => { m.set(n.code, n); n.children?.forEach(walk(m)); };
    tree.forEach(walk(map));
    prevTree.forEach(walk(prevMap));
    const leafIdx = new Map();
    const aPrevLeafIdxOnce = new Map();
    const leafDimIdx = new Map();
    const prevLeafDimIdx = new Map();
    // Dim indexes by accountCode + dim (for saved-mapping node.dims filtering)
    const dimFullIdx = new Map();
    const dimValIdx = new Map();
    const prevDimFullIdx = new Map();
    const prevDimValIdx = new Map();
    const buildDimIdx = (rows, fullIdx, valIdx) => {
      (rows || []).forEach(row => {
        const code = String(getField(row, "accountCode") ?? "");
        if (!code) return;
        const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
        const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
        if (!dimsStr) return;
        dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
          const i = pair.indexOf(":");
          if (i === -1) return;
          const g = pair.slice(0, i).trim();
          const v = pair.slice(i + 1).trim();
          fullIdx.set(`${code}|${g}:${v}`, (fullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
          valIdx.set(`${code}|${v}`, (valIdx.get(`${code}|${v}`) ?? 0) + amt);
        });
      });
    };
buildDimIdx(h.data, dimFullIdx, dimValIdx);
    buildDimIdx(h.prevData, prevDimFullIdx, prevDimValIdx);
    // Mirror by dim NAME using metadata (so saved dims stored as names still match)
    if (Array.isArray(dimensions) && dimensions.length > 0) {
      const nameToCode = new Map();
      dimensions.forEach(d => {
        const group = String(d.dimensionGroup ?? d.DimensionGroup ?? d.groupName ?? d.GroupName ?? "").trim();
        const c = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? d.Code ?? "").trim();
        const n = String(d.dimensionName ?? d.DimensionName ?? d.name ?? d.Name ?? "").trim();
        if (group && c && n) nameToCode.set(`${group}:${n}`, c);
      });
      const mirror = (fullIdx, valIdx) => {
        [...fullIdx.entries()].forEach(([k, vv]) => {
          const pipe = k.indexOf("|"); const accCode = k.slice(0, pipe);
          const rest = k.slice(pipe + 1); const colon = rest.indexOf(":");
          if (colon === -1) return;
          const group = rest.slice(0, colon); const codeVal = rest.slice(colon + 1);
          for (const [nameKey, mappedCode] of nameToCode.entries()) {
            if (mappedCode === codeVal && nameKey.startsWith(`${group}:`)) {
              const name = nameKey.slice(group.length + 1);
              fullIdx.set(`${accCode}|${group}:${name}`, vv);
              valIdx.set(`${accCode}|${name}`, vv);
              break;
            }
          }
        });
      };
      mirror(dimFullIdx, dimValIdx);
      mirror(prevDimFullIdx, prevDimValIdx);
    }
h.data.forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      leafIdx.set(lac, (leafIdx.get(lac) ?? 0) + amt);
      const dc = String(getField(row, "dimensionCode") ?? "");
      if (dc && dc !== "null") {
        leafDimIdx.set(`${lac}|${dc}`, (leafDimIdx.get(`${lac}|${dc}`) ?? 0) + amt);
      }
    });
const prevAccIdx = new Map();
    h.prevData.forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      const accCode = String(getField(row, "accountCode") ?? "");
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      if (accCode) prevAccIdx.set(accCode, (prevAccIdx.get(accCode) ?? 0) + amt);
      if (!lac) return;
      aPrevLeafIdxOnce.set(lac, (aPrevLeafIdxOnce.get(lac) ?? 0) + amt);
      const dc = String(getField(row, "dimensionCode") ?? "");
      if (dc && dc !== "null") {
        prevLeafDimIdx.set(`${lac}|${dc}`, (prevLeafDimIdx.get(`${lac}|${dc}`) ?? 0) + amt);
      }
    });
    const jrnByCode = new Map();
    (h.journals || []).forEach(j => {
      const code = String(j.accountCode ?? j.AccountCode ?? "");
      const jt = String(j.journalType ?? j.JournalType ?? "").toUpperCase();
      if (!code || (jt !== "AJE" && jt !== "RJE")) return;
      if (!jrnByCode.has(code)) jrnByCode.set(code, []);
      jrnByCode.get(code).push(j);
    });
    return { year: h.year, month: h.month, map, prevMap, leafIdx, aPrevLeafIdxOnce, leafDimIdx, prevLeafDimIdx, jrnByCode, dimFullIdx, dimValIdx, prevDimFullIdx, prevDimValIdx, prevAccIdx };
  });
}, [historyMonths, upDimGroups, upDimensions, groupAccounts, dimensions]);

const getHistYtd = useCallback((h, code) => {
  const n = h.map.get(code);
  if (!n) return 0;
  // Use uploadLeaves when present (matches current period's sumNode behavior for sum accounts)
  const sumYtdH = (nd) => {
    if (!nd) return 0;
    if (nd.type === "localAccount" || nd.type === "dimension" || nd.type === "plain") {
      return h.leafIdx?.get(String(nd.code)) ?? 0;
    }
    if (nd.uploadLeaves?.length > 0) {
      let s = 0;
      nd.uploadLeaves.forEach(l => { s += sumYtdH(l); });
      (nd.children || []).forEach(c => { s += sumYtdH(c); });
      return s;
    }
    let s = 0;
    (nd.children || []).forEach(c => { s += sumYtdH(c); });
    return s;
  };
  return sumYtdH(n);
}, []);
const getHistPrev = useCallback((h, code) => {
  if (Number(h.month) === 1) return 0;
  const curN = h.map.get(code);
  if (!curN) return 0;
  // Mirror sumNode's traversal but read prev amounts from h.aPrevLeafIdxOnce (keyed by localAccountCode)
  const sumPrevH = (n) => {
    if (!n) return 0;
    if (n.type === "localAccount" || n.type === "dimension" || n.type === "plain") {
      return h.aPrevLeafIdxOnce?.get(String(n.code)) ?? 0;
    }
    if (n.uploadLeaves?.length > 0) {
      let s = 0;
      n.uploadLeaves.forEach(l => { s += sumPrevH(l); });
      return s;
    }
    let s = 0;
    n.children?.forEach(c => { s += sumPrevH(c); });
    return s;
  };
  return sumPrevH(curN);
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

const searchExpansionMap = useMemo(() => {
  const q = debouncedQuery.trim().toLowerCase();
  if (!q) return null;
  const result = {};

  // Saved-mapping literal path: keys are `saved-${secIdx}-${parentPath}-${node.id}` and `${rowKey}-leaf-${i}`
  if (savedPlLiteral) {
    // Build group-account lookup so we can inspect uploadLeaves for each literal node's code
const treeByCode = new Map();
    (function indexTree(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); indexTree(n.children || []); });
    })(tree);

    savedPlLiteral.forEach((section, secIdx) => {
      const walk = (node, parentPath) => {
        const rowKey = `saved-${secIdx}-${parentPath}-${node.id}`;
        let descendantMatch = false;

        // Children in the literal mapping tree
        (node.children || []).forEach(child => {
          if (walk(child, `${parentPath}-${node.id}`)) descendantMatch = true;
        });

        // Leaves under the matching group-account (same logic as render path)
        const gaNode = treeByCode.get(String(node.code));
        const leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== "plain");
        leaves.forEach((leaf, i) => {
          const leafMatch =
            String(leaf.code ?? "").toLowerCase().includes(q) ||
            String(leaf.name ?? "").toLowerCase().includes(q);
          const dimMatch = (leaf.children || []).some(d =>
            String(d.code ?? "").toLowerCase().includes(q) ||
            String(d.name ?? "").toLowerCase().includes(q));
          if (leafMatch || dimMatch) {
            descendantMatch = true;
            if (dimMatch) result[`${rowKey}-leaf-${i}`] = true;
          }
        });

        const selfMatch =
          String(node.code ?? "").toLowerCase().includes(q) ||
          String(node.name ?? "").toLowerCase().includes(q);

        if (descendantMatch || selfMatch) {
          result[rowKey] = true;
        }
        return descendantMatch || selfMatch;
      };
      section.nodes.forEach(n => walk(n, "root"));
    });

return result;
  }

  // Standard path
  const rows = summaryMode ? summaryRows : allSumRows;
  rows.forEach(top => {
    const walk = (node, childDepth, parentCode, isTop) => {
      let descendantMatch = false;
      (node.children || [])
        .filter(c => hasData(c) && ["P/L", "DIS"].includes(c.accountType))
        .forEach(child => {
          if (walk(child, childDepth + 1, child.code, false)) descendantMatch = true;
        });
      (node.uploadLeaves || []).forEach((leaf, i) => {
        if (leaf.type === "plain") return;
        const leafMatch =
          String(leaf.code ?? "").toLowerCase().includes(q) ||
          String(leaf.name ?? "").toLowerCase().includes(q);
        const dimMatch = (leaf.children || []).some(d =>
          String(d.code ?? "").toLowerCase().includes(q) ||
          String(d.name ?? "").toLowerCase().includes(q));
        if (leafMatch || dimMatch) {
          descendantMatch = true;
          if (dimMatch) result[`drill-leaf-${top.code}-${parentCode ?? top.code}-${childDepth}-${i}`] = true;
        }
      });
      if (descendantMatch) {
        if (isTop) result[node.code] = true;
        else result[`drill-${top.code}-${node.code}`] = true;
      }
      return matchesSelf(node, q) || descendantMatch;
    };
    walk(top, 0, top.code, true);
  });
  return result;
}, [debouncedQuery, summaryMode, summaryRows, allSumRows, matchesSelf, savedPlLiteral, tree]);

const isOpen = useCallback((key) => {
  if (searchExpansionMap?.[key]) return true;
  if (key in expandedMap) return !!expandedMap[key];
  return false;
}, [expandedMap, searchExpansionMap]);
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
[t("jrn_account"), `${jrnPopup.AccountCode ?? jrnPopup.accountCode ?? ""} · ${jrnPopup.AccountName ?? jrnPopup.accountName ?? ""}`],
            [t("jrn_account_type"), jrnPopup.AccountType ?? jrnPopup.accountType],
            [t("jrn_journal_type"), jrnPopup.JournalType ?? jrnPopup.journalType],
            [t("jrn_journal_layer"), jrnPopup.JournalLayer ?? jrnPopup.journalLayer],
            [t("jrn_row_text"), jrnPopup.RowText ?? jrnPopup.rowText],
            [t("jrn_counterparty"), jrnPopup.CounterpartyShortName ?? jrnPopup.counterpartyShortName],
            [t("jrn_dimension"), jrnPopup.DimensionName ?? jrnPopup.dimensionName],
            [t("jrn_amount_ytd"), jrnPopup.AmountYTD ?? jrnPopup.amountYTD],
            [t("jrn_currency"), jrnPopup.CurrencyCode ?? jrnPopup.currencyCode],
            [t("jrn_period"), `${jrnPopup.Month ?? jrnPopup.month} / ${jrnPopup.Year ?? jrnPopup.year}`],
            [t("jrn_source"), jrnPopup.Source ?? jrnPopup.source],
            [t("jrn_company"), jrnPopup.CompanyShortName ?? jrnPopup.companyShortName],
            [t("jrn_system_generated"), (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === true ? t("cell_yes") : (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === false ? t("cell_no") : "—"],
            [t("jrn_posted"), (jrnPopup.Posted ?? jrnPopup.posted) === true ? t("cell_yes") : (jrnPopup.Posted ?? jrnPopup.posted) === false ? t("cell_no") : "—"],
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
  //  PRECOMPUTED INDEXES (memoized — heavy work runs only on data change)
  // ────────────────────────────────────────────────────────────
const cmpLabel  = compareMode ? [cmpFilters.year, MONTHS.find(m => String(m.value) === String(cmpFilters.month))?.label, cmpFilters.source, cmpFilters.dimension].filter(Boolean).join(" · ") || t("period_b") : "";
  const cmp2Label = compareMode ? [cmp2Filters?.year, MONTHS.find(m => String(m.value) === String(cmp2Filters?.month))?.label, cmp2Filters?.source, cmp2Filters?.dimension].filter(Boolean).join(" · ") || t("period_c") : "";

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


// Build a prev-month index for monthly mode — use RAW (unfiltered) prev data
    // so that posting-account leaf rows (which have Dimensions="—") are included
    const prevAccIdx = new Map();
    const prevDimFullIdx = new Map();
    const prevDimValIdx = new Map();
    const prevRawRows = prevUploadedAccountsRaw.length > 0 ? prevUploadedAccountsRaw : prevUploadedAccounts;
    (prevRawRows || []).forEach(row => {
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

// Build raw prev leaf index (localAccountCode → YTD) for leaf monthly delta
    const prevLeafIndexRaw = new Map();
    (prevRawRows || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      prevLeafIndexRaw.set(lac, (prevLeafIndexRaw.get(lac) ?? 0) + amt);
    });

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
// ── Compare period D indexes ───────────────────────────────
    const cmp3AccIdx = new Map();
    const cmp3DimFullIdx = new Map();
    const cmp3DimValIdx = new Map();
    (cmp3UploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmp3AccIdx.set(code, (cmp3AccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmp3DimFullIdx.set(`${code}|${g}:${v}`, (cmp3DimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        cmp3DimValIdx.set(`${code}|${v}`, (cmp3DimValIdx.get(`${code}|${v}`) ?? 0) + amt);
      });
    });
    const cmp3PrevAccIdx = new Map();
    const cmp3PrevDimFullIdx = new Map();
    const cmp3PrevDimValIdx = new Map();
    (cmp3PrevUploadedAccounts || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmp3PrevAccIdx.set(code, (cmp3PrevAccIdx.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmp3PrevDimFullIdx.set(`${code}|${g}:${v}`, (cmp3PrevDimFullIdx.get(`${code}|${g}:${v}`) ?? 0) + amt);
        cmp3PrevDimValIdx.set(`${code}|${v}`, (cmp3PrevDimValIdx.get(`${code}|${v}`) ?? 0) + amt);
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
      mirrorIdx(cmp3DimFullIdx, cmp3DimValIdx);
      mirrorIdx(cmp3PrevDimFullIdx, cmp3PrevDimValIdx);
    }

    const cmpTreeLit = buildTree(groupAccounts, cmpUploadedAccounts);
    const cmpPrevTreeLit = buildTree(groupAccounts, cmpPrevUploadedAccounts);
const cmp2TreeLit = buildTree(groupAccounts, cmp2UploadedAccounts);
    const cmp2PrevTreeLit = buildTree(groupAccounts, cmp2PrevUploadedAccounts);
    const cmp3TreeLit = buildTree(groupAccounts, cmp3UploadedAccounts);
    const cmp3PrevTreeLit = buildTree(groupAccounts, cmp3PrevUploadedAccounts);
    const cmpTreeByCode = new Map();
    const cmpPrevTreeByCode = new Map();
    const cmp2TreeByCode = new Map();
    const cmp2PrevTreeByCode = new Map();
    const cmp3TreeByCode = new Map();
    const cmp3PrevTreeByCode = new Map();
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
    (function indexCmp3Tree(nodes) {
      nodes.forEach(n => { cmp3TreeByCode.set(String(n.code), n); indexCmp3Tree(n.children || []); });
    })(cmp3TreeLit);
    (function indexCmp3PrevTree(nodes) {
      nodes.forEach(n => { cmp3PrevTreeByCode.set(String(n.code), n); indexCmp3PrevTree(n.children || []); });
    })(cmp3PrevTreeLit);

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
      if (node.isSum && node.children && node.children.length > 0) {
        return node.children.reduce((s, c) => s + sumLiteralForPeriod(c, treeByCodeMap, prevTreeByCodeMap, fullIdx, valIdx, prevFullIdx, prevValIdx, periodMonth), 0);
      }
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
    const sumLiteralD = (node) => sumLiteralForPeriod(
      node, cmp3TreeByCode, cmp3PrevTreeByCode,
      cmp3DimFullIdx, cmp3DimValIdx, cmp3PrevDimFullIdx, cmp3PrevDimValIdx,
      cmp3Filters?.month
    );

    // Sum a literal node (YTD or Monthly based on ytdOnly toggle):
const sumLiteralLeaf = (node) => {
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
    const sumLiteral = (node) => {
      if (node.isSum && node.children && node.children.length > 0) {
        return node.children.reduce((s, c) => s + sumLiteral(c), 0);
      }
      return sumLiteralLeaf(node);
    };

return (
      <div className="space-y-3 flex flex-col" style={{ minHeight: 0, flex: 1, overflow: "visible" }}>
{compareMode && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
            style={{
              overflow: filtersOpen ? "visible" : "hidden",
              position: "relative",
              zIndex: 100,
              marginBottom: filtersOpen ? 12 : 0,
              flex: "0 0 auto",
              maxHeight: filtersOpen ? 800 : 0,
              opacity: filtersOpen ? 1 : 0,
              transition: "max-height 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease, margin-bottom 240ms ease",
            }}>
            <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
                  <span className="text-white text-[11px] font-black">B</span>
                </div>
               <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
              </div>
<HeaderFilterPill label={t("filter_year")} value={cmpFilters.year} onChange={v => onCmpFilterChange("year", v)} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
              <HeaderFilterPill label={t("filter_month")} value={cmpFilters.month} onChange={v => onCmpFilterChange("month", v)} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
              <HeaderFilterPill label={t("filter_source")} value={cmpFilters.source} onChange={v => onCmpFilterChange("source", v)} options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
              <HeaderFilterPill label={t("filter_structure")} value={cmpFilters.structure} onChange={v => onCmpFilterChange("structure", v)} options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
              <HeaderFilterPill label={t("filter_company")} value={cmpFilters.company} onChange={v => onCmpFilterChange("company", v)} options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
              <HeaderMultiFilterPill label={t("filter_dim_group").toUpperCase()} values={cmpFilters.dimGroups} onChange={vs => onCmpFilterChange("dimGroups", vs)} options={dimGroups.map(g => ({ value: g, label: g }))} />
              <HeaderMultiFilterPill label={t("filter_dims")} values={cmpFilters.dimensions} onChange={vs => onCmpFilterChange("dimensions", vs)} options={cmpFilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
            {!cmp2Enabled && <button onClick={() => onCmp2EnabledChange(true)} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)", boxShadow: "0 4px 14px -4px rgba(87,170,120,0.5)" }}><span className="text-white text-[10px] font-black">{t("add_period_c")}</span></button>}
            </div>
            {cmp2Enabled && (
              <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100">
                <div className="flex items-center gap-2 mr-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)", boxShadow: "0 4px 12px -4px rgba(87,170,120,0.5)" }}>
                    <span className="text-white text-[11px] font-black">C</span>
                  </div>
                 <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
                </div>
<HeaderFilterPill label={t("filter_year")} value={cmp2Filters?.year} onChange={v => onCmp2FilterChange("year", v)} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
                <HeaderFilterPill label={t("filter_month")} value={cmp2Filters?.month} onChange={v => onCmp2FilterChange("month", v)} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
                <HeaderFilterPill label={t("filter_source")} value={cmp2Filters?.source} onChange={v => onCmp2FilterChange("source", v)} options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
                <HeaderFilterPill label={t("filter_structure")} value={cmp2Filters?.structure} onChange={v => onCmp2FilterChange("structure", v)} options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
                <HeaderFilterPill label={t("filter_company")} value={cmp2Filters?.company} onChange={v => onCmp2FilterChange("company", v)} options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
                <HeaderMultiFilterPill label={t("filter_dim_group").toUpperCase()} values={cmp2Filters?.dimGroups} onChange={vs => onCmp2FilterChange("dimGroups", vs)} options={dimGroups.map(g => ({ value: g, label: g }))} />
                <HeaderMultiFilterPill label={t("filter_dims")} values={cmp2Filters?.dimensions} onChange={vs => onCmp2FilterChange("dimensions", vs)} options={cmp2FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
<button onClick={() => onCmp2EnabledChange(false)} className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all" style={{ background: "#fee2e2", color: "#dc2626" }} title={t("remove_period_c")}><X size={12} strokeWidth={2.5} /></button>
              {!cmp3Enabled && (
                <button onClick={() => onCmp3EnabledChange(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)", boxShadow: "0 4px 14px -4px rgba(168,85,247,0.5)" }}><span className="text-white text-[10px] font-black">{t("add_period_d")}</span></button>
              )}
            </div>
          )}
          {cmp2Enabled && cmp3Enabled && (
            <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100">
              <div className="flex items-center gap-2 mr-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)", boxShadow: "0 4px 12px -4px rgba(168,85,247,0.5)" }}>
                  <span className="text-white text-[11px] font-black">D</span>
                </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>{t("period_d")}</span>
              </div>
              <HeaderFilterPill label={t("filter_year")} value={cmp3Filters?.year} onChange={v => onCmp3FilterChange("year", v)} options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
              <HeaderFilterPill label={t("filter_month")} value={cmp3Filters?.month} onChange={v => onCmp3FilterChange("month", v)} options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
              <HeaderFilterPill label={t("filter_source")} value={cmp3Filters?.source} onChange={v => onCmp3FilterChange("source", v)} options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
              <HeaderFilterPill label={t("filter_structure")} value={cmp3Filters?.structure} onChange={v => onCmp3FilterChange("structure", v)} options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
              <HeaderFilterPill label={t("filter_company")} value={cmp3Filters?.company} onChange={v => onCmp3FilterChange("company", v)} options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
              <HeaderMultiFilterPill label={t("filter_dim_group").toUpperCase()} values={cmp3Filters?.dimGroups} onChange={vs => onCmp3FilterChange("dimGroups", vs)} options={dimGroups.map(g => ({ value: g, label: g }))} />
              <HeaderMultiFilterPill label={t("filter_dims")} values={cmp3Filters?.dimensions} onChange={vs => onCmp3FilterChange("dimensions", vs)} options={cmp3FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
              <button onClick={() => onCmp3EnabledChange(false)} className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all" style={{ background: "#fee2e2", color: "#dc2626" }} title={t("remove_period_d")}><X size={12} strokeWidth={2.5} /></button>
            </div>
          )}
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
        style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}>
         <div className="overflow-auto k-scroll k-scroll-overlay" style={{ flex: 1, minHeight: 0, willChange: "scroll-position", transform: "translateZ(0)" }}>
<table className="w-full k-sticky-table">
<colgroup>
  <col style={{ width: accColWidth ? `${accColWidth}px` : "auto" }} />
                {multiCompany
                  ? selectedCompanies.map(co => <col key={`mc-saved-col-${co}`} style={{ width: "180px" }} />)
                  : <col style={{ width: "160px" }} />}
{!multiCompany && compareMode && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
                {!multiCompany && compareMode && cmp2Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
                {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
                {!multiCompany && historyExpanded && historyMonthsProcessed.map((h) => (
                  <col key={`hist-col-${h.year}-${h.month}`} style={{ width: "140px" }} />
                ))}
                <col />
              </colgroup>
<thead>
<tr className="border-b border-gray-100" style={{
                  background: "rgba(255,255,255,0.98)",
                  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
                }}>
<th className="text-left px-6 whitespace-nowrap k-sticky-acc-head" style={{ height: "64px" }}>
                    <div className="k-acc-resize-handle" onMouseDown={startAccResize} title="Drag to resize column" />
                    <div className="flex items-center gap-5">
                      <div className="flex items-center gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
                        <button onClick={() => setSearchActive(a => !a)}
                          className="flex items-center justify-center"
                          style={{ background: "transparent", color: searchActive ? colors.primary : "#94a3b8", padding: 0, transition: "color 240ms" }}
                          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                          onMouseLeave={e => { e.currentTarget.style.color = searchActive ? colors.primary : "#94a3b8"; }}
                          title={t("table_search_placeholder")}>
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
                            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                        {searchActive ? (
                          <>
                            <input
                              ref={searchInputRef}
                              autoFocus
                              type="text"
                              value={searchQuery}
                              onChange={e => setSearchQuery(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Escape") {
                                  setSearchActive(false);
                                  setSearchQuery("");
                                }
                              }}
                             placeholder={t("search_code_or_name")}
                              style={{
                                fontSize: 16, fontWeight: 700, color: colors.primary,
                                border: "none", outline: "none", background: "transparent",
                                width: 240, padding: 0, letterSpacing: "-0.02em"
                              }}
                            />
                            <button onClick={() => { setSearchActive(false); setSearchQuery(""); }}
                              className="flex items-center justify-center ml-1"
                              style={{ background: "transparent", color: "#94a3b8", padding: 2, transition: "color 200ms" }}
                              onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                              onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
                             title={t("close_search")}>
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span onClick={() => setSearchActive(true)} className="font-black tracking-tight"
                              style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em", cursor: "pointer" }}>
                              {t("col_account")}
                            </span>
                            <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
                              {t("page_pl_full")}
                            </span>
                          </>
                        )}
                      </div>
<div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
                      {compareMode && (
                        <>
                          <button onClick={() => setFiltersOpen(o => !o)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                            style={{
                              background: "transparent",
                              color: filtersOpen ? colors.primary : "#94a3b8",
                              transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                            onMouseLeave={e => { e.currentTarget.style.color = filtersOpen ? colors.primary : "#94a3b8"; }}>
                            <ChevronDown size={10} style={{ transition: "transform 300ms cubic-bezier(0.34,1.56,0.64,1)", transform: filtersOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
                            <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? t("btn_hide") : t("btn_show")}</span>
                          </button>
                          <div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
                        </>
                      )}
<button onClick={(e) => {
                        e.stopPropagation();
                        if (Object.keys(expandedMap).some(k => k.startsWith('saved-') && expandedMap[k])) { setExpandedMap({}); return; }
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
                        className="flex items-center justify-center"
                        style={{ background: "transparent", color: "#94a3b8", padding: 4, transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                        onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
title={Object.keys(expandedMap).some(k => k.startsWith('saved-') && expandedMap[k]) ? t("btn_collapse_all") : t("btn_expand_all")}>
                        <span key={Object.keys(expandedMap).some(k => k.startsWith('saved-') && expandedMap[k]) ? "collapse" : "expand"}
                          className="inline-flex"
                          style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                          {Object.keys(expandedMap).some(k => k.startsWith('saved-') && expandedMap[k])
                            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          }
                        </span>
</button>
                    </div>
                  </th>
{multiCompany ? selectedCompanies.map(co => (
                    <th key={`mc-saved-th-${co}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{co}</span>
                    </th>
                  )) : (
<th className="text-center py-3 whitespace-nowrap k-sticky-head" style={{ cursor: "pointer" }}
                      onClick={toggleHistory}
                      title={historyExpanded ? t("hide_history") : t("show_last_6_months")}>
                      <div className="flex items-center justify-center gap-3">
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
                      </div>
                    </th>
                  )}
{historyExpanded && historyMonthsProcessed.map((h) => (
                    <th key={`hist-saved-${h.year}-${h.month}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
                      <div className="flex flex-col items-center">
                        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>
                          {MONTHS.find(m => m.value === h.month)?.label.slice(0,3)}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: "#9ca3af" }}>{h.year}</span>
                      </div>
                    </th>
                  ))}
{compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
                      </div>
                      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmpLabel}</span>
                    </div>
                  </th>}
{compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
                      </div>
                      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmp2Label}</span>
                    </div>
                  </th>}
                  {compareMode && cmp2Enabled && cmp3Enabled && (() => {
                    const cmp3Label = [cmp3Filters?.year, MONTHS.find(m => String(m.value) === String(cmp3Filters?.month))?.label, cmp3Filters?.source].filter(Boolean).join(" · ") || t("period_d");
                    return <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#a855f7" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>{t("period_d")}</span>
                        </div>
                        <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmp3Label}</span>
                      </div>
                    </th>;
                  })()}
                  {historyExpanded && historyLoading && (
                    <th className="text-center px-3 py-3" style={{ background: "transparent" }}>
                      <Loader2 size={14} className="animate-spin" style={{ color: colors.primary }} />
                    </th>
                  )}
                  <th className="k-sticky-head" />
                </tr>
              </thead>
<tbody>
{savedPlLiteral.map((section, secIdx) => {
                  const sectionRows = [];

                  // Per-leaf+dim indexes for compare periods (saved-mapping path)
                  const buildSavedLeafDimIdx = (rows) => {
                    const m = new Map();
                    (rows || []).forEach(row => {
                      const lac = String(getField(row, "localAccountCode") ?? "");
                      const dc  = String(getField(row, "dimensionCode") ?? "");
                      if (!lac || !dc || dc === "null") return;
                      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
                      m.set(`${lac}|${dc}`, (m.get(`${lac}|${dc}`) ?? 0) + amt);
                    });
                    return m;
                  };
                  const aPrevLeafDimIdxSaved = buildSavedLeafDimIdx(prevUploadedAccounts);
                  const bLeafDimIdxSaved     = compareMode ? buildSavedLeafDimIdx(cmpUploadedAccounts) : new Map();
                  const bPrevLeafDimIdxSaved = compareMode ? buildSavedLeafDimIdx(cmpPrevUploadedAccounts) : new Map();
                  const cLeafDimIdxSaved     = compareMode && cmp2Enabled ? buildSavedLeafDimIdx(cmp2UploadedAccounts) : new Map();
                  const cPrevLeafDimIdxSaved = compareMode && cmp2Enabled ? buildSavedLeafDimIdx(cmp2PrevUploadedAccounts) : new Map();
                  const dLeafDimIdxSaved     = compareMode && cmp2Enabled && cmp3Enabled ? buildSavedLeafDimIdx(cmp3UploadedAccounts) : new Map();
                  const dPrevLeafDimIdxSaved = compareMode && cmp2Enabled && cmp3Enabled ? buildSavedLeafDimIdx(cmp3PrevUploadedAccounts) : new Map();

// Section header (breaker)
if (section.label) {
const dividerColSpan = multiCompany
                      ? 1 + selectedCompanies.length + 1
                      : 3 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (compareMode && cmp2Enabled && cmp3Enabled ? 3 : 0) + (historyExpanded ? historyMonthsProcessed.length : 0);
sectionRows.push(
                      <tr key={`sec-${secIdx}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(sectionRows.length, 25) * 35}ms both` }}>
                        <td style={{ backgroundColor: section.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
                          <span className="uppercase tracking-widest" style={header3Style}>{section.label}</span>
                        </td>
                        <td colSpan={dividerColSpan - 1} style={{ backgroundColor: section.color }} />
                      </tr>
                    );
                  }

                  // Walk the literal nodes recursively, respecting mapping hierarchy.
const renderNode = (node, depth, parentPath) => {
const displayVal = sumLiteral(node);
if (node.code === 'A.03' || node.code === 'A.03.a' || node.code === 'A.01') {
  historyMonthsProcessed.forEach(h => {
    const histGaNode = h.map.get(String(node.code));
    console.log('[HIST-RENDER]', node.code, h.year, h.month, {
      sumNodeResult: histGaNode ? sumNode(histGaNode) : null,
      uploadLeavesCount: histGaNode?.uploadLeaves?.length ?? 0,
      uploadLeavesTotal: histGaNode?.uploadLeaves?.reduce((s,l) => s + (l.amount ?? 0), 0) ?? 0,
      childrenCount: histGaNode?.children?.length ?? 0,
      childrenSums: histGaNode?.children?.map(c => `${c.code}=${sumNode(c)}`).join(' | ') ?? '',
      currentPeriodDisplay: displayVal,
    });
  });
}
// Unique key per literal node (preserves duplicates across sections)
                    const rowKey = `saved-${secIdx}-${parentPath}-${node.id}`;
              const expanded = isOpen(rowKey);

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
                        className={`border-b border-gray-100 transition-colors ${(() => {
                          const q = debouncedQuery.trim().toLowerCase();
                          if (!q) return isHighlighted ? "bg-amber-50/60 hover:bg-amber-50" : "bg-white";
                          const nodeMatch = String(node.code ?? "").toLowerCase().includes(q) || String(node.name ?? "").toLowerCase().includes(q);
                          if (nodeMatch) return "bg-[#fef3c7]";
                          return isHighlighted ? "bg-amber-50/60 hover:bg-amber-50" : "bg-white";
                        })()} ${hasDrill ? `cursor-pointer ${isHighlighted ? "" : "hover:bg-[#eef1fb]/60"}` : ""}`}
                        style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(sectionRows.length, 25) * 35 + 50}ms both` }}
                        onClick={hasDrill ? (e) => { e.stopPropagation(); toggle(rowKey); } : undefined}
>
                       <td className="py-3 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 20}px` }}>
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
{multiCompany ? selectedCompanies.map(co => (
                          <PLAmountCell key={`mc-saved-${node.id}-${co}`} value={getNodeValForCompany(node.code, co, ytdOnly)} typoStyle={depth === 0 ? body1Style : body2Style} centered />
                        )) : (
                          <>
                            <PLAmountCell value={displayVal} typoStyle={depth === 0 ? body1Style : body2Style} />
{compareMode && (() => {
                              const cmpVal = sumLiteralB(node);
                              return (
                                <>
                                  <PLAmountCell value={cmpVal} typoStyle={depth === 0 ? body1Style : body2Style} divider />
                                  <DeviationCells a={displayVal} b={cmpVal} typoStyle={depth === 0 ? body1Style : body2Style} />
                                </>
                              );
                            })()}
{compareMode && cmp2Enabled && (() => {
                          const cmp2Val = sumLiteralC(node);
                          return (
                            <>
                              <PLAmountCell value={cmp2Val} typoStyle={depth === 0 ? body1Style : body2Style} divider />
                              <DeviationCells a={displayVal} b={cmp2Val} typoStyle={depth === 0 ? body1Style : body2Style} />
                            </>
                          );
                        })()}
{compareMode && cmp2Enabled && cmp3Enabled && (() => {
                          const cmp3Val = sumLiteralD(node);
                          return (
                            <>
                              <PLAmountCell value={cmp3Val} typoStyle={depth === 0 ? body1Style : body2Style} divider />
                              <DeviationCells a={displayVal} b={cmp3Val} typoStyle={depth === 0 ? body1Style : body2Style} />
                            </>
                          );
                        })()}
                          </>
                        )}
{historyExpanded && historyMonthsProcessed.map((h) => {
                          const computeHistForNode = (nd) => {
                            // Recurse for sum nodes — mirror sumLiteral's behavior
                            if (nd.isSum && Array.isArray(nd.children) && nd.children.length > 0) {
                              return nd.children.reduce((s, c) => s + computeHistForNode(c), 0);
                            }
                            const histGaNode = h.map.get(String(nd.code));
                            if (!histGaNode) return 0;
                            if (nd.dims && nd.dims.length > 0) {
                              const sumDimH = (gaN, dimStr, fullI, valI) => {
                                if (!gaN) return 0;
                                let t = 0;
                                const c = String(gaN.code);
                                if (dimStr.includes(":")) t += fullI.get(`${c}|${dimStr}`) ?? 0;
                                else t += valI.get(`${c}|${dimStr}`) ?? 0;
                                (gaN.children || []).forEach(ch => { t += sumDimH(ch, dimStr, fullI, valI); });
                                return t;
                              };
                              let total = 0;
                              nd.dims.forEach(d => { total += sumDimH(histGaNode, String(d), h.dimFullIdx, h.dimValIdx); });
                              const ytd = -total;
                              if (ytdOnly) return ytd;
                              let prevTotal = 0;
                              if (Number(h.month) !== 1) {
                                nd.dims.forEach(d => { prevTotal += sumDimH(histGaNode, String(d), h.prevDimFullIdx, h.prevDimValIdx); });
                              }
                              return ytd - (-prevTotal);
                            }
                            const ytd = -sumNode(histGaNode);
                            if (ytdOnly) return ytd;
                            const sumPrevH = (n) => {
                              if (!n) return 0;
                              if (n.type === "localAccount" || n.type === "dimension" || n.type === "plain") {
                                return h.aPrevLeafIdxOnce?.get(String(n.code)) ?? 0;
                              }
                              if (n.uploadLeaves?.length > 0) {
                                let s = 0;
                                n.uploadLeaves.forEach(l => { s += sumPrevH(l); });
                                return s;
                              }
                              let s = 0;
                              (n.children || []).forEach(c => { s += sumPrevH(c); });
                              return s;
                            };
                            const prevYtd = Number(h.month) === 1 ? 0 : -sumPrevH(histGaNode);
                            return ytd - prevYtd;
                          };
                          const histVal = computeHistForNode(node);
                          return <PLAmountCell key={`hist-saved-cell-${h.year}-${h.month}-${node.id}`} value={histVal} typoStyle={depth === 0 ? body1Style : body2Style} centered />;
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
                            <td className="py-1.5 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-px bg-amber-300 flex-shrink-0" />
                               <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                                <span style={subbody2Style}>{String(d).split(":").pop()}</span>
                              </div>
                            </td>
<PLAmountCell value={ytdOnly ? dimVal : (() => {
  const prevVal = prevDimFullIdx.get(`${node.code}|${String(d)}`) ?? 0;
  return dimVal + prevVal;
})() } typoStyle={subbody2Style} />
{compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                            {compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                            {compareMode && cmp2Enabled && cmp3Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
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
                        const leafExpanded = isOpen(leafKey);
                        const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
                        const amt = leaf.amount ?? 0;

const leafIsMatch = (() => {
                          const q = debouncedQuery.trim().toLowerCase();
                          if (!q) return false;
                          return String(leaf.code ?? "").toLowerCase().includes(q) || String(leaf.name ?? "").toLowerCase().includes(q);
                        })();
                        sectionRows.push(
                          <tr key={leafKey}
                            className={`border-b border-[#1a2f8a]/5 ${leafIsMatch ? "bg-[#fef3c7]" : "bg-white"} transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/30" : "hover:bg-[#f0f3ff]"}`}
                            onClick={hasDims ? (e) => { e.stopPropagation(); toggle(leafKey); } : undefined}>
<td className="py-1.5 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-px bg-[#1a2f8a]/10 flex-shrink-0" />
                                {hasDims
                                  ? <span className="text-gray-300 flex-shrink-0">{leafExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
                                  : <span className="w-3 flex-shrink-0" />}
                                {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
                                <span style={subbody1Style}>{leaf.name || ""}</span>
                              </div>
                            </td>
{multiCompany ? selectedCompanies.map(co => (
                              <PLAmountCell key={`mc-saved-leaf-${leaf.code ?? "noleaf"}-${co}-${i}`} value={leaf.code ? getLeafValForCompany(leaf.code, co, ytdOnly) : 0} typoStyle={subbody1Style} centered />
                            )) : (
                              <>
                                {(() => {
                                  const ytdAmt = -amt;
                                  const prevAmt = leaf.code && Number(month) !== 1
                                    ? (prevLeafIndexRaw.get(String(leaf.code)) ?? 0)
                                    : 0;
                                  const displayAmt = ytdOnly ? ytdAmt : -(amt - prevAmt);
                                  return <PLAmountCell value={displayAmt} typoStyle={subbody1Style} />;
                                })()}
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
                            {compareMode && cmp2Enabled && cmp3Enabled && (() => {
                              const cmp3Amt = leaf.code ? -(cmp3LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                              return (
                                <>
                                  <PLAmountCell value={cmp3Amt} typoStyle={subbody1Style} divider />
                                  <DeviationCells a={-amt} b={cmp3Amt} typoStyle={subbody1Style} />
                                </>
                              );
                            })()}
                              </>
                            )}
{historyExpanded && historyMonthsProcessed.map((h) => {
                              const leafAmt = leaf.code ? (h.leafIdx.get(String(leaf.code)) ?? 0) : 0;
                              const leafPrev = leaf.code ? (h.aPrevLeafIdxOnce.get(String(leaf.code)) ?? 0) : 0;
                              const leafVal = ytdOnly ? -leafAmt : -(leafAmt - leafPrev);
                              return <PLAmountCell key={`hist-saved-leaf-${h.year}-${h.month}-${i}`} value={leafVal} typoStyle={subbody1Style} centered />;
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
const dimIsMatch = (() => {
                              const q = debouncedQuery.trim().toLowerCase();
                              if (!q) return false;
                              return String(dim.code ?? "").toLowerCase().includes(q) || String(dim.name ?? "").toLowerCase().includes(q);
                            })();
                            sectionRows.push(
                              <tr key={`${leafKey}-dim-${j}`}
                                className={`border-b border-[#1a2f8a]/5 ${dimIsMatch ? "bg-[#fef3c7]" : "bg-white"} hover:bg-amber-50/40 transition-colors cursor-pointer`}
                                onClick={(e) => { e.stopPropagation(); setDimPopup(dim); }}>
<td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
                                   <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                                    <span style={subbody2Style}>{dim.name || dim.code}</span>
                                  </div>
                                </td>
{multiCompany ? selectedCompanies.map(co => (
                                  <PLAmountCell key={`mc-saved-dim-${dim.code ?? "nocode"}-${co}-${j}`} value={leaf.code ? getDimValForCompany(leaf.code, dim.code, co, ytdOnly) : 0} typoStyle={subbody2Style} centered />
                                )) : (() => {
                                  const k = `${leaf.code}|${dim.code}`;
                                  const ytdA = -(dim.amount ?? 0);
                                  const prevA = Number(month) !== 1 ? -(aPrevLeafDimIdxSaved.get(k) ?? 0) : 0;
                                  const monA = ytdA - prevA;
                                  const displayA = ytdOnly ? ytdA : monA;
                                  return <PLAmountCell value={displayA} typoStyle={subbody2Style} />;
                                })()}
{compareMode && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const ytdA = -(dim.amount ?? 0);
  const prevA = Number(month) !== 1 ? -(aPrevLeafDimIdxSaved.get(k) ?? 0) : 0;
  const monA = ytdA - prevA;
  const displayA = ytdOnly ? ytdA : monA;
  const bY = -(bLeafDimIdxSaved.get(k) ?? 0);
  const bP = Number(cmpFilters?.month) === 1 ? 0 : -(bPrevLeafDimIdxSaved.get(k) ?? 0);
  const displayB = ytdOnly ? bY : (bY - bP);
  return <><PLAmountCell value={displayB} typoStyle={subbody2Style} divider /><DeviationCells a={displayA} b={displayB} typoStyle={subbody2Style} /></>;
})()}
{compareMode && cmp2Enabled && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const ytdA = -(dim.amount ?? 0);
  const prevA = Number(month) !== 1 ? -(aPrevLeafDimIdxSaved.get(k) ?? 0) : 0;
  const displayA = ytdOnly ? ytdA : (ytdA - prevA);
  const cY = -(cLeafDimIdxSaved.get(k) ?? 0);
  const cP = Number(cmp2Filters?.month) === 1 ? 0 : -(cPrevLeafDimIdxSaved.get(k) ?? 0);
  const displayC = ytdOnly ? cY : (cY - cP);
  return <><PLAmountCell value={displayC} typoStyle={subbody2Style} divider /><DeviationCells a={displayA} b={displayC} typoStyle={subbody2Style} /></>;
})()}
{compareMode && cmp2Enabled && cmp3Enabled && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const ytdA = -(dim.amount ?? 0);
  const prevA = Number(month) !== 1 ? -(aPrevLeafDimIdxSaved.get(k) ?? 0) : 0;
  const displayA = ytdOnly ? ytdA : (ytdA - prevA);
  const dY = -(dLeafDimIdxSaved.get(k) ?? 0);
  const dPV = Number(cmp3Filters?.month) === 1 ? 0 : -(dPrevLeafDimIdxSaved.get(k) ?? 0);
  const displayD = ytdOnly ? dY : (dY - dPV);
  return <><PLAmountCell value={displayD} typoStyle={subbody2Style} divider /><DeviationCells a={displayA} b={displayD} typoStyle={subbody2Style} /></>;
})()}
{historyExpanded && historyMonthsProcessed.map((h) => {
                              const k = `${leaf.code}|${dim.code}`;
                              const hYtd = -(h.leafDimIdx.get(k) ?? 0);
                              const hPrev = Number(h.month) === 1 ? 0 : -(h.prevLeafDimIdx.get(k) ?? 0);
                              const v = ytdOnly ? hYtd : hYtd - hPrev;
                              return <PLAmountCell key={`hist-saved-dim-leaf-${h.year}-${h.month}-${j}`} value={v} typoStyle={subbody2Style} centered />;
                            })}
                                <td />
                              </tr>
                            );
                          });
                        }
});
                    }
// ── Journal entries at NODE level (saved-mapping path) ──
                    if (node.code) {
                      const nodeJrns = journalByCode.get(String(node.code)) || [];
                      const hasHistJrns = historyMonthsProcessed.some(h => (h.jrnByCode?.get(String(node.code)) || []).length > 0);
                      console.log('[JRN-CHECK]', node.code, 'current:', nodeJrns.length, 'histAny:', hasHistJrns, 'histExp:', historyExpanded, 'histMonths:', historyMonthsProcessed.length, 'detail:', historyMonthsProcessed.map(h => ({ m: `${h.year}-${h.month}`, n: (h.jrnByCode?.get(String(node.code)) || []).length, mapSize: h.jrnByCode?.size })));
                      if (nodeJrns.length > 0 || hasHistJrns) {
                        const jrnKey = `${rowKey}-jrn`;
                        const jrnExpanded = isOpen(jrnKey);
sectionRows.push(
                          <tr key={jrnKey}
                            className="border-b border-[#1a2f8a]/5 bg-white cursor-pointer hover:bg-indigo-50/40 transition-colors"
                            onClick={(e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [jrnKey]: !isOpen(jrnKey) })); }}>
                            <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
                                <span className="text-[#1a2f8a]/40 flex-shrink-0">
                                  {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}
                                </span>
                                <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_journal")}</span>
                                <span style={subbody2Style}>{Math.max(nodeJrns.length, historyMonthsProcessed.reduce((m, h) => Math.max(m, (h.jrnByCode?.get(String(node.code)) || []).length), 0))} {t("entries")}</span>
                              </div>
                            </td>
                            {multiCompany ? selectedCompanies.map(co => <td key={`mc-jhdr-${node.code}-${co}`} />) : <td />}
                            {!multiCompany && compareMode && <><td /><td /><td /></>}
                            {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                            {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                            {!multiCompany && historyExpanded && historyMonthsProcessed.map((h) => {
                              const histEntries = h.jrnByCode?.get(String(node.code)) || [];
                              const histAmt = histEntries.reduce((acc, je) => acc + -parseAmt(je.amountYTD ?? je.AmountYTD ?? 0), 0);
                              return <PLAmountCell key={`hist-saved-jhdr-${h.year}-${h.month}-${node.code}`} value={histAmt} typoStyle={subbody2Style} centered />;
                            })}
                          </tr>
                        );
if (jrnExpanded) {
// Build a unified list: each row = one journal entry. For current period use nodeJrns. For each history month, append its own journals as separate rows.
                          const allJrnRows = [];
                          nodeJrns.forEach(jrn => allJrnRows.push({ jrn, source: 'current' }));
                          if (historyExpanded) {
                            historyMonthsProcessed.forEach(h => {
                              const hjrns = h.jrnByCode?.get(String(node.code)) || [];
                              hjrns.forEach(jrn => allJrnRows.push({ jrn, source: `hist-${h.year}-${h.month}` }));
                            });
                          }
                          allJrnRows.forEach(({ jrn, source: jsrc }, k) => {
                            const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
                            const jnum = jrn.journalNumber ?? jrn.JournalNumber;
                            const cmpJrn = (journalByCodeCmp.get(String(node.code)) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jnum);
                            const cmp2Jrn = (journalByCodeCmp2.get(String(node.code)) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jnum);
                            const cmp3Jrn = (journalByCodeCmp3.get(String(node.code)) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jnum);
                            const cmpAmt = cmpJrn ? -parseAmt(cmpJrn.amountYTD ?? cmpJrn.AmountYTD ?? 0) : 0;
                            const cmp2Amt = cmp2Jrn ? -parseAmt(cmp2Jrn.amountYTD ?? cmp2Jrn.AmountYTD ?? 0) : 0;
                            const cmp3Amt = cmp3Jrn ? -parseAmt(cmp3Jrn.amountYTD ?? cmp3Jrn.AmountYTD ?? 0) : 0;
                            sectionRows.push(
                              <tr key={`${jrnKey}-entry-${k}`}
                                className="border-b border-[#1a2f8a]/5 bg-white hover:bg-indigo-50/40 transition-colors cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); setJrnPopup(jrn); }}>
                                <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-200 flex-shrink-0" />
                                    <span className="flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" style={subbody2Style}>{jnum ?? ""}</span>
                                    {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="flex-shrink-0" style={subbody2Style}>{jrn.journalHeader ?? jrn.JournalHeader}</span>}
                                    {(jrn.rowText ?? jrn.RowText) && <span className="truncate max-w-[250px]" style={subbody2Style}>— {jrn.rowText ?? jrn.RowText}</span>}
                                  </div>
                                </td>
{multiCompany ? selectedCompanies.map(co => {
                                  const jrnCo = String(jrn.companyShortName ?? jrn.CompanyShortName ?? "");
                                  const v = jrnCo === co ? -amt : 0;
                                  return <PLAmountCell key={`mc-jentry-${node.code}-${co}-${k}`} value={v} typoStyle={subbody2Style} centered />;
                                }) : <PLAmountCell value={jsrc === 'current' ? -amt : 0} typoStyle={subbody2Style} />}
                                {!multiCompany && compareMode && <><PLAmountCell value={cmpAmt} typoStyle={subbody2Style} divider /><DeviationCells a={-amt} b={cmpAmt} typoStyle={subbody2Style} /></>}
                                {!multiCompany && compareMode && cmp2Enabled && <><PLAmountCell value={cmp2Amt} typoStyle={subbody2Style} divider /><DeviationCells a={-amt} b={cmp2Amt} typoStyle={subbody2Style} /></>}
{!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><PLAmountCell value={cmp3Amt} typoStyle={subbody2Style} divider /><DeviationCells a={-amt} b={cmp3Amt} typoStyle={subbody2Style} /></>}
{!multiCompany && historyExpanded && historyMonthsProcessed.map((h) => {
                                  // If this row belongs to this history month, show its amount; otherwise blank
                                  const v = jsrc === `hist-${h.year}-${h.month}` ? -amt : 0;
                                  return <PLAmountCell key={`hist-saved-jrn-${h.year}-${h.month}-${k}`} value={v} typoStyle={subbody2Style} centered />;
                                })}
                              </tr>
                            );
                          });

                          // ── Historical-only journals (exist in past months but not current) ──
                          if (historyExpanded && historyMonthsProcessed.length > 0) {
                            const currentNums = new Set(nodeJrns.map(j => j.journalNumber ?? j.JournalNumber));
                            const histSeen = new Map();
                            historyMonthsProcessed.forEach(h => {
                              (h.jrnByCode?.get(String(node.code)) || []).forEach(j => {
                                const num = j.journalNumber ?? j.JournalNumber;
                                if (currentNums.has(num)) return;
                                if (!histSeen.has(num)) histSeen.set(num, { jrn: j, byMonth: new Map() });
                                histSeen.get(num).byMonth.set(`${h.year}-${h.month}`, -parseAmt(j.amountYTD ?? j.AmountYTD ?? 0));
                              });
                            });
                            [...histSeen.entries()].forEach(([num, entry], xi) => {
                              const jrn = entry.jrn;
                              sectionRows.push(
                                <tr key={`${jrnKey}-hist-only-${xi}`}
                                  className="border-b border-[#1a2f8a]/5 bg-indigo-50/10 hover:bg-indigo-50/40 transition-colors cursor-pointer"
                                  onClick={(e) => { e.stopPropagation(); setJrnPopup(jrn); }}>
                                  <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                                    <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-300 flex-shrink-0" />
                                      <span className="flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" style={subbody2Style}>{num ?? ""}</span>
                                      {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="flex-shrink-0" style={subbody2Style}>{jrn.journalHeader ?? jrn.JournalHeader}</span>}
                                      {(jrn.rowText ?? jrn.RowText) && <span className="truncate max-w-[250px]" style={subbody2Style}>— {jrn.rowText ?? jrn.RowText}</span>}
                                    </div>
                                  </td>
                                  {multiCompany ? selectedCompanies.map(co => <td key={`mc-jhistonly-${node.code}-${co}-${xi}`} />) : <PLAmountCell value={0} typoStyle={subbody2Style} />}
                                  {!multiCompany && compareMode && <><td /><td /><td /></>}
                                  {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                                  {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                                  {!multiCompany && historyExpanded && historyMonthsProcessed.map(h => {
                                    const v = entry.byMonth.get(`${h.year}-${h.month}`) ?? 0;
                                    return <PLAmountCell key={`hist-jrn-only-${h.year}-${h.month}-${xi}`} value={v} typoStyle={subbody2Style} centered />;
                                  })}
                                </tr>
                              );
                            });
                          }

                          // ── Compare-period-only journals (exist in B/C/D but not A) ──
                          if (compareMode) {
                            const aNums = new Set(nodeJrns.map(j => j.journalNumber ?? j.JournalNumber));
                            const extraJrns = [];
                            const collect = (idx, period) => {
                              (idx.get(String(node.code)) || []).forEach(j => {
                                const num = j.journalNumber ?? j.JournalNumber;
                                if (!aNums.has(num)) extraJrns.push({ jrn: j, period, num });
                              });
                            };
                            collect(journalByCodeCmp, 'B');
                            if (cmp2Enabled) collect(journalByCodeCmp2, 'C');
                            if (cmp2Enabled && cmp3Enabled) collect(journalByCodeCmp3, 'D');
                            // Dedupe by JournalNumber across periods (one row each, populated per matching period)
                            const seen = new Map();
                            extraJrns.forEach(e => {
                              if (!seen.has(e.num)) seen.set(e.num, { jrn: e.jrn, periods: { B: null, C: null, D: null } });
                              seen.get(e.num).periods[e.period] = -parseAmt(e.jrn.amountYTD ?? e.jrn.AmountYTD ?? 0);
                            });
                            // Now fill periods properly: re-scan to populate values from each available period
                            seen.forEach((entry, num) => {
                              ['B','C','D'].forEach(p => {
                                if (entry.periods[p] != null) return;
                                const idx = p === 'B' ? journalByCodeCmp : p === 'C' ? journalByCodeCmp2 : journalByCodeCmp3;
                                const match = (idx.get(String(node.code)) || []).find(j => (j.journalNumber ?? j.JournalNumber) === num);
                                if (match) entry.periods[p] = -parseAmt(match.amountYTD ?? match.AmountYTD ?? 0);
                              });
                            });
                            const extras = [...seen.entries()];
                            if (extras.length > 0) {
                              sectionRows.push(
                                <tr key={`${jrnKey}-extra-hdr`}
                                  className="border-b border-[#1a2f8a]/5 bg-indigo-50/30">
                                  <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-2 h-px bg-indigo-300 flex-shrink-0" />
                                      <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-100 border border-indigo-200 px-1.5 py-0.5 rounded flex-shrink-0">B/C/D only</span>
                                      <span style={subbody2Style}>{extras.length} {extras.length === 1 ? t("entry") : t("entries")}</span>
                                    </div>
                                  </td>
                                  {multiCompany ? selectedCompanies.map(co => <td key={`mc-jextra-hdr-${node.code}-${co}`} />) : <td />}
                                  {!multiCompany && compareMode && <><td /><td /><td /></>}
                                  {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                                  {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                                </tr>
                              );
                              extras.forEach(([num, entry], xi) => {
                                const jrn = entry.jrn;
                                sectionRows.push(
                                  <tr key={`${jrnKey}-extra-${xi}`}
                                    className="border-b border-[#1a2f8a]/5 bg-indigo-50/10 hover:bg-indigo-50/40 transition-colors cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); setJrnPopup(jrn); }}>
                                    <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 3) * 20}px` }}>
                                      <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-300 flex-shrink-0" />
                                        <span className="flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" style={subbody2Style}>{num ?? ""}</span>
                                        {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="flex-shrink-0" style={subbody2Style}>{jrn.journalHeader ?? jrn.JournalHeader}</span>}
                                        {(jrn.rowText ?? jrn.RowText) && <span className="truncate max-w-[250px]" style={subbody2Style}>— {jrn.rowText ?? jrn.RowText}</span>}
                                      </div>
                                    </td>
                                    {multiCompany ? selectedCompanies.map(co => <td key={`mc-jextra-${node.code}-${co}-${xi}`} />) : <td className="text-right pr-6 py-1 text-gray-300" style={subbody2Style}>—</td>}
                                    {!multiCompany && compareMode && <><PLAmountCell value={entry.periods.B ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
                                    {!multiCompany && compareMode && cmp2Enabled && <><PLAmountCell value={entry.periods.C ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
                                    {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><PLAmountCell value={entry.periods.D ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
                                  </tr>
                                );
                              });
                            }
                          }
                        }
                      }
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
      <p className="text-gray-400 text-sm">{t("loading_pl_data")}</p>
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
                 <p className="text-white/60 text-[10px] font-medium uppercase tracking-widest">{t("dimension")}</p>
                </div>
              </div>
              <button onClick={() => setDimPopup(null)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                <X size={13} className="text-white/70" />
              </button>
            </div>
            <div className="p-5 space-y-1">
{[
                [t("dim_code"), dimPopup.code],
                [t("dim_name"), dimPopup.name],
                [t("dim_amount_ytd"), dimPopup.amount != null ? fmtAmt(dimPopup.amount) : null],
                [t("dim_company"), dimPopup.company],
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
{compareMode && (
  <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
    style={{
      overflow: filtersOpen ? "visible" : "hidden",
      position: "relative",
      zIndex: 100,
      marginBottom: filtersOpen ? 12 : 0,
      flex: "0 0 auto",
      maxHeight: filtersOpen ? 800 : 0,
      opacity: filtersOpen ? 1 : 0,
      transition: "max-height 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease, margin-bottom 240ms ease",
      border: filtersOpen ? undefined : "1px solid transparent",
    }}>
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
        {!cmp3Enabled && (
          <button onClick={() => onCmp3EnabledChange(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
            style={{
              background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)",
              boxShadow: "0 4px 14px -4px rgba(168,85,247,0.5)",
            }}>
            <span className="text-white text-[10px] font-black">+ Add Period D</span>
          </button>
        )}
</div>
    )}
    {cmp2Enabled && cmp3Enabled && (
      <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)",
              boxShadow: "0 4px 12px -4px rgba(168,85,247,0.5)",
            }}>
            <span className="text-white text-[11px] font-black">D</span>
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>Period D</span>
        </div>
        <HeaderFilterPill label="Year" value={cmp3Filters?.year} onChange={v => onCmp3FilterChange("year", v)}
          options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
        <HeaderFilterPill label="Month" value={cmp3Filters?.month} onChange={v => onCmp3FilterChange("month", v)}
          options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
        <HeaderFilterPill label="Source" value={cmp3Filters?.source} onChange={v => onCmp3FilterChange("source", v)}
          options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
        <HeaderFilterPill label="Structure" value={cmp3Filters?.structure} onChange={v => onCmp3FilterChange("structure", v)}
          options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
        <HeaderFilterPill label="Company" value={cmp3Filters?.company} onChange={v => onCmp3FilterChange("company", v)}
          options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
        <HeaderMultiFilterPill label="DIM GRP" values={cmp3Filters?.dimGroups} onChange={vs => onCmp3FilterChange("dimGroups", vs)}
          options={dimGroups.map(g => ({ value: g, label: g }))} />
        <HeaderMultiFilterPill label="DIMS" values={cmp3Filters?.dimensions} onChange={vs => onCmp3FilterChange("dimensions", vs)}
          options={cmp3FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
        <button onClick={() => onCmp3EnabledChange(false)}
          className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all"
          style={{ background: "#fee2e2", color: "#dc2626" }}
          title="Remove Period D">
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
       {filtersOpen ? t("pl_hide_filters") : t("pl_show_filters")}
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

     title={Object.values(expandedMap).some(Boolean) ? t("btn_collapse_all") : t("btn_expand_all")}>
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
<GitMerge size={12} /> {t("btn_compare")}

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
      <button onClick={() => {}}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
style={{ color: !ytdOnly ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        {t("pl_monthly")}
      </button>
      <button onClick={() => {}}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
        style={{ color: ytdOnly ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        {t("pl_ytd")}
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
        {t("pl_detailed")}
      </button>
      <button onClick={() => setSummaryMode(true)}
        className="relative z-10 px-3 py-1.5 rounded-lg text-xs font-black transition-colors duration-200"
        style={{ color: summaryMode ? (colors.primary ?? "#1a2f8a") : `${(colors.quaternary ?? "#F59E0B")}80` }}>
        {t("pl_summary")}
      </button>
    </div>
  </div>
</div>




<div className="overflow-auto k-scroll k-scroll-overlay" style={{ flex: 1, minHeight: 0 }}>
<table className="w-full k-sticky-table">
<colgroup>
  <col style={{ width: accColWidth ? `${accColWidth}px` : "auto" }} />
    {multiCompany
      ? selectedCompanies.map(co => <col key={`mc-col-${co}`} style={{ width: "180px" }} />)
      : <col style={{ width: "160px" }} />}
{!multiCompany && compareMode && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
    {!multiCompany && compareMode && cmp2Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
    {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
    <col />
  </colgroup>
<thead>
<tr className="border-b border-gray-100" style={{
  background: "rgba(255,255,255,0.98)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
<th className="text-left px-6 whitespace-nowrap k-sticky-acc-head" style={{ height: "64px", position: "relative" }}>
                    <div className="k-acc-resize-handle" onMouseDown={startAccResize} title="Drag to resize column" />
  <div className="flex items-center gap-5">
<div className="flex items-center gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
      <button onClick={() => setSearchActive(a => !a)}
        className="flex items-center justify-center"
        style={{ background: "transparent", color: searchActive ? colors.primary : "#94a3b8", padding: 0, transition: "color 240ms" }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
        onMouseLeave={e => { e.currentTarget.style.color = searchActive ? colors.primary : "#94a3b8"; }}
       title={t("table_search_placeholder")}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>
{searchActive ? (
        <>
<input
          ref={searchInputRef}
          autoFocus
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") {
              setSearchActive(false);
              setSearchQuery("");
            }
          }}
         placeholder={t("search_code_or_name")}
          style={{
            fontSize: 16, fontWeight: 700, color: colors.primary,
            border: "none", outline: "none", background: "transparent",
            width: 240, padding: 0, letterSpacing: "-0.02em"
          }}
        />
        <button onClick={() => { setSearchActive(false); setSearchQuery(""); }}
          className="flex items-center justify-center ml-1"
          style={{ background: "transparent", color: "#94a3b8", padding: 2, transition: "color 200ms" }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
         title={t("close_search")}>
          <X size={14} />
        </button>
        </>
      ) : (
        <>
<span onClick={() => setSearchActive(true)} className="font-black tracking-tight"
            style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em", cursor: "pointer" }}>
            {t("col_account")}
          </span>
          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
            {t("page_pl_full")}
          </span>
        </>
      )}
    </div>
<div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
    <div className="flex items-center gap-4" style={{ flexDirection: "row-reverse" }}>
<button onClick={() => {
        if (Object.keys(expandedMap).some(k => !k.startsWith('saved-') && expandedMap[k])) { setExpandedMap({}); return; }
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
        className="flex items-center justify-center"
        style={{ background: "transparent", color: "#94a3b8", padding: 4, transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)" }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
        title={Object.keys(expandedMap).some(k => !k.startsWith('saved-') && expandedMap[k]) ? "Collapse all" : "Expand all"}>
        <span key={Object.keys(expandedMap).some(k => !k.startsWith('saved-') && expandedMap[k]) ? "collapse" : "expand"}
          className="inline-flex"
          style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
          {Object.keys(expandedMap).some(k => !k.startsWith('saved-') && expandedMap[k])
            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </span>
      </button>
<div className="relative flex items-center"
        ref={el => {
          if (!el) return;
          const tabs = el.querySelectorAll("[data-pl-tab]");
          const idx = summaryMode ? 0 : 1;
          const active = tabs[idx];
          const indicator = el.querySelector(".pl-view-indicator");
          if (active && indicator) {
            indicator.style.left = active.offsetLeft + "px";
            indicator.style.width = active.offsetWidth + "px";
          }
        }}>
        <span className="pl-view-indicator" style={{
          position: "absolute", bottom: -4, height: 2,
          background: colors.primary, borderRadius: 1,
          transition: "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), width 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          pointerEvents: "none",
        }} />
{[["summary","Summary"],["detailed","Detailed"]].map(([v, label]) => {
          const active = (v === "summary" && summaryMode) || (v === "detailed" && !summaryMode);
          return (
            <button key={v} data-pl-tab onClick={() => setSummaryMode(v === "summary")}
              className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] whitespace-nowrap"
              style={{
                background: "transparent",
                color: active ? colors.primary : "#94a3b8",
                transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}>
              {label}
            </button>
          );
        })}
      </div>
      {compareMode && (
        <>
          <div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
          <button onClick={() => setFiltersOpen(o => !o)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{
              background: "transparent",
              color: filtersOpen ? colors.primary : "#94a3b8",
              transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
            onMouseLeave={e => { e.currentTarget.style.color = filtersOpen ? colors.primary : "#94a3b8"; }}>
            <ChevronDown size={10} style={{ transition: "transform 300ms cubic-bezier(0.34,1.56,0.64,1)", transform: filtersOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
            <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? t("btn_hide") : t("btn_show")}</span>
          </button>
        </>
      )}
    </div>
  </div>
</th>
{multiCompany ? selectedCompanies.map(co => (
  <th key={`mc-th-${co}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
    <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{co}</span>
  </th>
)) : (
<th className="text-center py-3 whitespace-nowrap k-sticky-head" style={{ width: "200px", cursor: (compareMode || multiCompany) ? "default" : "pointer" }}
  onClick={toggleHistory}
 title={(compareMode || multiCompany) ? "" : (historyExpanded ? t("hide_history") : t("show_last_12_months"))}>
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
)}
{historyExpanded && historyMonthsProcessed.map((h) => (
    <th key={`hist-${h.year}-${h.month}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
      <div className="flex flex-col items-center">
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
  {compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Period B</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmpLabel}</span>
    </div>
  </th>}
{compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
        <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>Period C</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmp2Label}</span>
    </div>
  </th>}
  {compareMode && cmp2Enabled && cmp3Enabled && (() => {
    const cmp3Label = [cmp3Filters?.year, MONTHS.find(m => String(m.value) === String(cmp3Filters?.month))?.label, cmp3Filters?.source].filter(Boolean).join(" · ") || t("period_d");
    return <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#a855f7" }} />
          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>Period D</span>
        </div>
        <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{cmp3Label}</span>
      </div>
    </th>;
  })()}
<th className="k-sticky-head" />
</tr>
</thead>
            <tbody>
{(summaryMode ? summaryRows : allSumRows).map((node, nodeIdx) => {


const ytd      = -sumNode(node);
const prevYtd  = -getPrevYtd(node.code);
const cmpYtd = compareMode ? -getCmpYtd(node.code) : 0;
const cmpMon = compareMode ? -getCmpYtd(node.code) - (-getCmpPrev(node.code)) : 0;
const mon      = ytd - prevYtd;
const isMatchSelf = (() => {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return false;
  return String(node.code ?? "").toLowerCase().includes(q) || String(localName(node) ?? "").toLowerCase().includes(q);
})();
const expanded = isOpen(node.code);
const hasKids  = (node.children||[]).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType)).length > 0
                || (node.uploadLeaves || []).some(l => l.type !== "plain");
const SECTION_DIVIDERS_MAP = Object.keys(effectiveBreakersPl).length
  ? effectiveBreakersPl
  : summaryRows.some(n => /[a-zA-Z]/.test(String(n.code)))
    ? { "A.04.S": { label: t("pl_divider_revenue"), color: colors.primary }, "A.13.S": { label: t("pl_divider_opex"), color: colors.secondary }, "A.24.S": { label: t("pl_divider_result"), color: colors.tertiary } }
    : { "11999": { label: t("pl_divider_revenue"), color: colors.primary }, "53999": { label: t("pl_divider_opex"), color: colors.secondary }, "89999": { label: t("pl_divider_result"), color: colors.tertiary } };

const DETAIL_DIVIDERS_BEFORE = (() => {
const fallback = summaryRows.some(n => /[a-zA-Z]/.test(String(n.code)))
    ? { "A.04.S": { label: t("pl_divider_revenue"), color: colors.primary }, "A.13.S": { label: t("pl_divider_opex"), color: colors.secondary }, "A.24.S": { label: t("pl_divider_result"), color: colors.tertiary } }
    : { "10999": { label: t("pl_divider_revenue"), color: colors.primary }, "12199": { label: t("pl_divider_opex"), color: colors.secondary }, "89999": { label: t("pl_divider_result"), color: colors.tertiary } };
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
    <td style={{ backgroundColor: divider.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
      <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
    </td>
    <td colSpan={(multiCompany ? selectedCompanies.length + 1 : compareMode ? (cmp2Enabled ? (cmp3Enabled ? 11 : 8) : 5) : (2 + (historyExpanded ? historyMonthsProcessed.length : 0)))} style={{ backgroundColor: divider.color }} />
  </tr>
) : null,
<tr key={node.code}
      className={`border-b border-gray-100 ${isMatchSelf ? "bg-[#fef3c7]" : "bg-white"} cursor-pointer hover:bg-[#eef1fb]/60 transition-colors`}
      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(nodeIdx, 25) * 35 + 50}ms both` }}
      onClick={(e) => { e.stopPropagation(); toggle(node.code); }}>
<td className="py-3 px-6 whitespace-nowrap k-sticky-acc">
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
{multiCompany && selectedCompanies.map(co => (
        <PLAmountCell key={`mc-val-${node.code}-${co}`} value={getNodeValForCompany(node.code, co, ytdOnly)} typoStyle={body1Style} centered />
      ))}
      {!multiCompany && !ytdOnly && <PLAmountCell value={mon} typoStyle={body1Style} />}
      {!multiCompany && !ytdOnly && compareMode && <PLAmountCell value={cmpMon} typoStyle={body1Style} divider />}
      {!multiCompany && !ytdOnly && compareMode && <DeviationCells a={mon} b={cmpMon} typoStyle={body1Style} />}
{!multiCompany && !ytdOnly && compareMode && cmp2Enabled && (() => {
        const cmp2Ytd = -getCmp2Ytd(node.code);
        const cmp2Mon = cmp2Ytd - (-getCmp2Prev(node.code));
        return <>
          <PLAmountCell value={cmp2Mon} typoStyle={body1Style} divider />
          <DeviationCells a={mon} b={cmp2Mon} typoStyle={body1Style} />
        </>;
      })()}
      {!multiCompany && !ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && (() => {
        const cmp3Ytd = -getCmp3Ytd(node.code);
        const cmp3Mon = cmp3Ytd - (-getCmp3Prev(node.code));
        return <>
          <PLAmountCell value={cmp3Mon} typoStyle={body1Style} divider />
          <DeviationCells a={mon} b={cmp3Mon} typoStyle={body1Style} />
        </>;
      })()}
{!multiCompany && ytdOnly && <PLAmountCell value={ytd} typoStyle={body1Style} />}
      {ytdOnly && compareMode && <PLAmountCell value={cmpYtd} typoStyle={body1Style} divider />}
      {ytdOnly && compareMode && <DeviationCells a={ytd} b={cmpYtd} typoStyle={body1Style} />}
{ytdOnly && compareMode && cmp2Enabled && (() => {
        const cmp2Ytd = -getCmp2Ytd(node.code);
        return <>
          <PLAmountCell value={cmp2Ytd} typoStyle={body1Style} divider />
          <DeviationCells a={ytd} b={cmp2Ytd} typoStyle={body1Style} />
        </>;
      })()}
      {ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && (() => {
        const cmp3Ytd = -getCmp3Ytd(node.code);
        return <>
          <PLAmountCell value={cmp3Ytd} typoStyle={body1Style} divider />
          <DeviationCells a={ytd} b={cmp3Ytd} typoStyle={body1Style} />
        </>;
      })()}
{historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
        const hYtd = -getHistYtd(h, node.code);
        const hPrev = -getHistPrev(h, node.code);
        const hMon = hYtd - hPrev;
        return <PLAmountCell key={`hist-cell-${h.year}-${h.month}-${node.code}`} value={ytdOnly ? hYtd : hMon} typoStyle={body1Style} centered />;
      })}
    </tr>,
...((expanded) ? (function renderChildren(children, leaves, depth, parentCode) {

  const q = searchQuery.trim().toLowerCase();
  const rows = [];

  // Group account children
children
    .filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType))
    .forEach(child => {
    const cYtd = -sumNode(child);
    const cPrev = -getPrevYtd(child.code);
    const cMon = cYtd - cPrev;
    const cCmpYtd = compareMode ? -getCmpYtd(child.code) : 0;
    const cCmpMon = compareMode ? cCmpYtd - (-getCmpPrev(child.code)) : 0;
    const cCmp2Ytd = compareMode ? -getCmp2Ytd(child.code) : 0;
    const cCmp2Mon = compareMode ? cCmp2Ytd - (-getCmp2Prev(child.code)) : 0;
const childExpanded = isOpen(`drill-${node.code}-${child.code}`);
    const grandkids = (child.children || []).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType));
    const hasMore = grandkids.length > 0 || (child.uploadLeaves?.length > 0);
    const isChildMatch = (() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return false;
      return String(child.code ?? "").toLowerCase().includes(q) || String(localName(child) ?? "").toLowerCase().includes(q);
    })();

rows.push(
  <tr key={child.code}
    className={`border-b border-[#1a2f8a]/5 ${isChildMatch ? "bg-[#fef3c7]" : "bg-white"} transition-colors ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : "hover:bg-[#eef1fb]/20"}`}
    onClick={hasMore ? (e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [`drill-${node.code}-${child.code}`]: !prev[`drill-${node.code}-${child.code}`] })); } : undefined}>
<td className="py-2 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 20}px` }}>
      <div className="flex items-center gap-2">
        {hasMore
          ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{childExpanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
          : <span className="w-3 flex-shrink-0" />}
        <span className="font-mono text-gray-400" style={subbody2Style}>{child.code}</span>
        <span style={body2Style}>{localName(child)}</span>
      </div>
    </td>
{multiCompany && selectedCompanies.map(co => (
      <PLAmountCell key={`mc-child-${child.code}-${co}`} value={getNodeValForCompany(child.code, co, ytdOnly)} typoStyle={body2Style} centered />
    ))}
    {!multiCompany && !ytdOnly && <PLAmountCell value={cMon} typoStyle={body2Style} />}
    {!multiCompany && !ytdOnly && compareMode && <PLAmountCell value={cCmpMon} typoStyle={body2Style} divider />}
    {!multiCompany && !ytdOnly && compareMode && <DeviationCells a={cMon} b={cCmpMon} typoStyle={body2Style} />}
{!multiCompany && !ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cCmp2Mon} typoStyle={body2Style} divider />}
    {!multiCompany && !ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={cMon} b={cCmp2Mon} typoStyle={body2Style} />}
    {!multiCompany && !ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && (() => {
      const cCmp3Ytd = -getCmp3Ytd(child.code);
      const cCmp3Mon = cCmp3Ytd - (-getCmp3Prev(child.code));
      return <><PLAmountCell value={cCmp3Mon} typoStyle={body2Style} divider /><DeviationCells a={cMon} b={cCmp3Mon} typoStyle={body2Style} /></>;
    })()}
    {!multiCompany && ytdOnly && <PLAmountCell value={cYtd} typoStyle={body2Style} />}
    {!multiCompany && ytdOnly && compareMode && <PLAmountCell value={cCmpYtd} typoStyle={body2Style} divider />}
    {!multiCompany && ytdOnly && compareMode && <DeviationCells a={cYtd} b={cCmpYtd} typoStyle={body2Style} />}
{!multiCompany && ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cCmp2Ytd} typoStyle={body2Style} divider />}
    {!multiCompany && ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={cYtd} b={cCmp2Ytd} typoStyle={body2Style} />}
    {!multiCompany && ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && (() => {
      const cCmp3Ytd = -getCmp3Ytd(child.code);
      return <><PLAmountCell value={cCmp3Ytd} typoStyle={body2Style} divider /><DeviationCells a={cYtd} b={cCmp3Ytd} typoStyle={body2Style} /></>;
    })()}
{historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
      const hYtd = -getHistYtd(h, child.code);
      const hPrev = -getHistPrev(h, child.code);
      const hMon = hYtd - hPrev;
      return <PLAmountCell key={`hist-child-${h.year}-${h.month}-${child.code}`} value={ytdOnly ? hYtd : hMon} typoStyle={body2Style} centered />;
    })}
  </tr>
);

if (childExpanded && hasMore) {
      rows.push(...renderChildren(grandkids, child.uploadLeaves || [], depth + 1, child.code));
    }

if (childExpanded) {
      const jrnRows = (journalByCode.get(child.code) || []);
      const hasHistJrnsStd = historyMonthsProcessed.some(h => (h.jrnByCode?.get(String(child.code)) || []).length > 0);
      if (jrnRows.length > 0 || hasHistJrnsStd) {
        const jrnKey = `jrn-child-${node.code}-${child.code}`;
       const jrnExpanded = isOpen(jrnKey);
rows.push(
  <tr key={jrnKey}
    className="border-b border-[#1a2f8a]/5 bg-white cursor-pointer hover:bg-indigo-50/40 transition-colors"
    onClick={(e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [jrnKey]: !isOpen(jrnKey) })); }}>
    <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
        <span className="text-[#1a2f8a]/40 flex-shrink-0">
          {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}
        </span>
<span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
          {t("label_journal")}
        </span>
<span style={subbody2Style}>{Math.max(jrnRows.length, historyMonthsProcessed.reduce((m, h) => Math.max(m, (h.jrnByCode?.get(String(child.code)) || []).length), 0))} {t("entries")}</span>
      </div>
    </td>
{multiCompany ? selectedCompanies.map(co => (
      <td key={`mc-jrnhdr-${child.code}-${co}`} />
    )) : <td />}
{!multiCompany && compareMode && <><td /><td /><td /></>}
    {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
    {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
    {!multiCompany && historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
      const histEntries = h.jrnByCode?.get(String(child.code)) || [];
      const histAmt = histEntries.reduce((acc, je) => acc + -parseAmt(je.amountYTD ?? je.AmountYTD ?? 0), 0);
      return <PLAmountCell key={`hist-jrnhdr-${h.year}-${h.month}-${child.code}`} value={histAmt} typoStyle={subbody2Style} centered />;
    })}
  </tr>
);
if (jrnExpanded) {
  // Unified list: current period entries + each historical month's own entries as separate rows
  const allJrnRows = [];
  jrnRows.forEach(jrn => allJrnRows.push({ jrn, source: 'current' }));
  if (historyExpanded && !compareMode) {
    historyMonthsProcessed.forEach(h => {
      const hjrns = h.jrnByCode?.get(String(child.code)) || [];
      hjrns.forEach(jrn => allJrnRows.push({ jrn, source: `hist-${h.year}-${h.month}` }));
    });
  }
  allJrnRows.forEach(({ jrn, source: jsrc }, k) => {
    const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
    rows.push(
      <tr key={`jrn-child-entry-${node.code}-${child.code}-${k}`}
        className="border-b border-[#1a2f8a]/5 bg-white hover:bg-indigo-50/40 transition-colors cursor-pointer"
        onClick={(e) => { e.stopPropagation(); setJrnPopup(jrn); }}>
        <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-200 flex-shrink-0" />
            <span className="flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" style={subbody2Style}>{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
            {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="flex-shrink-0" style={subbody2Style}>{jrn.journalHeader ?? jrn.JournalHeader}</span>}
            {(jrn.rowText ?? jrn.RowText) && <span className="truncate max-w-[250px]" style={subbody2Style}>— {jrn.rowText ?? jrn.RowText}</span>}
            {(jrn.counterpartyShortName ?? jrn.CounterpartyShortName) && <span className="ml-auto flex-shrink-0" style={subbody2Style}>{jrn.counterpartyShortName ?? jrn.CounterpartyShortName}</span>}
          </div>
        </td>
{multiCompany ? selectedCompanies.map(co => {
  const jrnCo = String(jrn.companyShortName ?? jrn.CompanyShortName ?? "");
  const v = jrnCo === co ? -parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0) : 0;
  return <PLAmountCell key={`mc-jentry-${child.code}-${co}-${k}`} value={v} typoStyle={subbody2Style} centered />;
}) : (() => {
  const jrnNum = jrn.journalNumber ?? jrn.JournalNumber;
  const cmpJrn = (journalByCodeCmp.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jrnNum);
  const cmp2Jrn = (journalByCodeCmp2.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jrnNum);
  const cmp3Jrn = (journalByCodeCmp3.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === jrnNum);
  const cmpAmt = cmpJrn ? -parseAmt(cmpJrn.amountYTD ?? cmpJrn.AmountYTD ?? 0) : 0;
  const cmp2Amt = cmp2Jrn ? -parseAmt(cmp2Jrn.amountYTD ?? cmp2Jrn.AmountYTD ?? 0) : 0;
  const cmp3Amt = cmp3Jrn ? -parseAmt(cmp3Jrn.amountYTD ?? cmp3Jrn.AmountYTD ?? 0) : 0;
  const ownVal = jsrc === 'current' ? -amt : 0;
  return (
    <>
      {!ytdOnly && <PLAmountCell value={ownVal} typoStyle={subbody2Style} />}
      {!ytdOnly && compareMode && <PLAmountCell value={cmpAmt} typoStyle={subbody2Style} divider />}
      {!ytdOnly && compareMode && <DeviationCells a={ownVal} b={cmpAmt} typoStyle={subbody2Style} />}
      {!ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cmp2Amt} typoStyle={subbody2Style} divider />}
      {!ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={ownVal} b={cmp2Amt} typoStyle={subbody2Style} />}
      {!ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && <PLAmountCell value={cmp3Amt} typoStyle={subbody2Style} divider />}
      {!ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && <DeviationCells a={ownVal} b={cmp3Amt} typoStyle={subbody2Style} />}
      {ytdOnly && <PLAmountCell value={ownVal} typoStyle={subbody2Style} />}
      {ytdOnly && compareMode && <PLAmountCell value={cmpAmt} typoStyle={subbody2Style} divider />}
      {ytdOnly && compareMode && <DeviationCells a={ownVal} b={cmpAmt} typoStyle={subbody2Style} />}
{ytdOnly && compareMode && cmp2Enabled && <PLAmountCell value={cmp2Amt} typoStyle={subbody2Style} divider />}
      {ytdOnly && compareMode && cmp2Enabled && <DeviationCells a={ownVal} b={cmp2Amt} typoStyle={subbody2Style} />}
{ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && <PLAmountCell value={cmp3Amt} typoStyle={subbody2Style} divider />}
      {ytdOnly && compareMode && cmp2Enabled && cmp3Enabled && <DeviationCells a={ownVal} b={cmp3Amt} typoStyle={subbody2Style} />}
{historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
        const v = jsrc === `hist-${h.year}-${h.month}` ? -amt : 0;
        return <PLAmountCell key={`hist-jrn-${h.year}-${h.month}-${k}`} value={v} typoStyle={subbody2Style} centered />;
      })}
    </>
  );
})()}
      </tr>
    );
  });

  // ── Compare-period-only journals (B/C/D not in A) — standard path ──
  if (compareMode) {
    const aNums = new Set(jrnRows.map(j => j.journalNumber ?? j.JournalNumber));
    const seen = new Map();
const collect = (idx, period) => {
      (idx.get(child.code) || []).forEach(j => {
        const num = j.journalNumber ?? j.JournalNumber;
        if (aNums.has(num)) return;
        if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
        seen.get(num).periods[period] = -parseAmt(j.amountYTD ?? j.AmountYTD ?? 0);
      });
    };
    collect(journalByCodeCmp, 'B');
    if (cmp2Enabled) collect(journalByCodeCmp2, 'C');
    if (cmp2Enabled && cmp3Enabled) collect(journalByCodeCmp3, 'D');
    // Fill cross-period values
    seen.forEach((entry, num) => {
      ['B','C','D'].forEach(p => {
        if (entry.periods[p] != null) return;
        const idx = p === 'B' ? journalByCodeCmp : p === 'C' ? journalByCodeCmp2 : journalByCodeCmp3;
        const match = (idx.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === num);
        if (match) entry.periods[p] = -parseAmt(match.amountYTD ?? match.AmountYTD ?? 0);
      });
    });
    const extras = [...seen.entries()];
    if (extras.length > 0) {
      const extraHdrKey = `jrn-child-extra-hdr-${node.code}-${child.code}`;
      rows.push(
        <tr key={extraHdrKey} className="border-b border-[#1a2f8a]/5 bg-indigo-50/30">
          <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-px bg-indigo-300 flex-shrink-0" />
              <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-100 border border-indigo-200 px-1.5 py-0.5 rounded flex-shrink-0">B/C/D only</span>
              <span style={subbody2Style}>{extras.length} {extras.length === 1 ? t("entry") : t("entries")}</span>
            </div>
          </td>
          {multiCompany ? selectedCompanies.map(co => <td key={`mc-jxhdr-${child.code}-${co}`} />) : <td />}
          {!multiCompany && compareMode && <><td /><td /><td /></>}
          {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
          {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
          {historyExpanded && !compareMode && historyMonthsProcessed.map((h) => (
            <td key={`hist-jxhdr-${h.year}-${h.month}-${child.code}`} />
          ))}
        </tr>
      );
      extras.forEach(([num, entry], xi) => {
        const jrn = entry.jrn;
        rows.push(
          <tr key={`jrn-child-extra-${node.code}-${child.code}-${xi}`}
            className="border-b border-[#1a2f8a]/5 bg-indigo-50/10 hover:bg-indigo-50/40 transition-colors cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setJrnPopup(jrn); }}>
            <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-300 flex-shrink-0" />
                <span className="flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded" style={subbody2Style}>{num ?? ""}</span>
                {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="flex-shrink-0" style={subbody2Style}>{jrn.journalHeader ?? jrn.JournalHeader}</span>}
                {(jrn.rowText ?? jrn.RowText) && <span className="truncate max-w-[250px]" style={subbody2Style}>— {jrn.rowText ?? jrn.RowText}</span>}
              </div>
            </td>
            {multiCompany ? selectedCompanies.map(co => <td key={`mc-jx-${child.code}-${co}-${xi}`} />) : <td className="text-right pr-6 py-1 text-gray-300" style={subbody2Style}>—</td>}
            {!multiCompany && compareMode && <><PLAmountCell value={entry.periods.B ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
            {!multiCompany && compareMode && cmp2Enabled && <><PLAmountCell value={entry.periods.C ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
            {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><PLAmountCell value={entry.periods.D ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
          </tr>
        );
      });
    }
  }
}
      }
    }
  });

// Upload leaves (local accounts)
leaves.forEach((leaf, i) => {
    if (leaf.type === "plain") return;
    const leafKey = `drill-leaf-${node.code}-${parentCode ?? node.code}-${depth}-${i}`;

    const leafExpanded = isOpen(leafKey);
    const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
    const amt = leaf.amount ?? 0;

const leafIsMatch = (() => {
      const q = debouncedQuery.trim().toLowerCase();
      if (!q) return false;
      return String(leaf.code ?? "").toLowerCase().includes(q) || String(leaf.name ?? "").toLowerCase().includes(q);
    })();
    rows.push(
  <tr key={leafKey}
    className={`border-b border-[#1a2f8a]/5 ${leafIsMatch ? "bg-[#fef3c7]" : "bg-white"} transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/30" : "hover:bg-[#f0f3ff]"}`}
    onClick={hasDims ? (e) => { e.stopPropagation(); setExpandedMap(prev => ({ ...prev, [leafKey]: !isOpen(leafKey) })); } : undefined}>
    <td className="py-1.5 border-r-0 k-sticky-acc" style={{ paddingLeft: `${24 + depth * 20}px` }}>
      <div className="flex items-center gap-2">
        <div className="w-2 h-px bg-[#1a2f8a]/10 flex-shrink-0" />
        {hasDims
          ? <span className="text-gray-300 flex-shrink-0">{leafExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
          : <span className="w-3 flex-shrink-0" />}
        {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
        <span style={subbody1Style}>{leaf.name || ""}</span>
      </div>
    </td>
{multiCompany && selectedCompanies.map(co => (
      <PLAmountCell key={`mc-leaf-${leaf.code ?? "noleaf"}-${co}-${depth}-${i}`} value={leaf.code ? getLeafValForCompany(leaf.code, co, ytdOnly) : 0} typoStyle={subbody1Style} centered />
    ))}
    {!multiCompany && (() => {
      const monthlyAmt = -(amt - (leaf.code ? getPrevLeafAmt(leaf.code) : 0));
      const ytdAmt = -amt;
      const displayAmt = ytdOnly ? ytdAmt : monthlyAmt;
      return (
        <>
          <PLAmountCell value={displayAmt} typoStyle={subbody1Style} />
{compareMode && (() => {
            const cmpYtd = leaf.code ? -(getCmpLeafAmt(leaf.code)) : 0;
            const cmpPrev = leaf.code ? -(getCmpPrevLeafAmt(leaf.code)) : 0;
            const cmpDisplay = ytdOnly ? cmpYtd : cmpYtd - cmpPrev;
            return <><PLAmountCell value={cmpDisplay} typoStyle={subbody1Style} divider /><DeviationCells a={displayAmt} b={cmpDisplay} typoStyle={subbody1Style} /></>;
          })()}
{compareMode && cmp2Enabled && (() => {
            const cmp2Ytd = leaf.code ? -(getCmp2LeafAmt(leaf.code)) : 0;
            const cmp2Prev = leaf.code ? -(getCmp2PrevLeafAmt(leaf.code)) : 0;
            const cmp2Display = ytdOnly ? cmp2Ytd : cmp2Ytd - cmp2Prev;
            return <><PLAmountCell value={cmp2Display} typoStyle={subbody1Style} divider /><DeviationCells a={displayAmt} b={cmp2Display} typoStyle={subbody1Style} /></>;
          })()}
          {compareMode && cmp2Enabled && cmp3Enabled && (() => {
            const cmp3Ytd = leaf.code ? -(getCmp3LeafAmt(leaf.code)) : 0;
            const cmp3Prev = leaf.code ? -(getCmp3PrevLeafAmt(leaf.code)) : 0;
            const cmp3Display = ytdOnly ? cmp3Ytd : cmp3Ytd - cmp3Prev;
            return <><PLAmountCell value={cmp3Display} typoStyle={subbody1Style} divider /><DeviationCells a={displayAmt} b={cmp3Display} typoStyle={subbody1Style} /></>;
          })()}
        </>
      );
    })()}

{historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
      const leafYtd = -(h.leafIdx.get(String(leaf.code ?? "")) ?? 0);
      const leafPrevYtd = -(h.aPrevLeafIdxOnce.get(String(leaf.code ?? "")) ?? 0);
      const leafMon = leafYtd - leafPrevYtd;
      return <PLAmountCell key={`hist-leaf-${h.year}-${h.month}-${i}`} value={ytdOnly ? leafYtd : leafMon} typoStyle={subbody1Style} centered />;
    })}
  </tr>
);

if (leafExpanded && hasDims) {
  leaf.children.forEach((dim, j) => {
    const dimIsMatch = q && (
      String(dim.code ?? "").toLowerCase().includes(q)||
      String(dim.name ?? "").toLowerCase().includes(q));
    rows.push(
<tr key={`dim-${parentCode ?? node.code}-${depth}-${i}-${j}`}
      className={`border-b border-[#1a2f8a]/5 ${dimIsMatch ? "bg-[#fef3c7]" : "bg-white"} hover:bg-amber-50/40 transition-colors cursor-pointer`}
      onClick={(e) => { e.stopPropagation(); setDimPopup(dim); }}>
      <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
          <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
          <span style={subbody2Style}>{dim.name || dim.code}</span>
        </div>
      </td>
{multiCompany ? selectedCompanies.map(co => (
        <PLAmountCell key={`mc-dim-${dim.code ?? "nocode"}-${co}-${depth}-${i}-${j}`} value={leaf.code ? getDimValForCompany(leaf.code, dim.code, co, ytdOnly) : 0} typoStyle={subbody2Style} centered />
      )) : <PLAmountCell value={-dim.amount} typoStyle={subbody2Style} />}
      {!multiCompany && compareMode && (() => {
        const k = `${leaf.code}|${dim.code}`;
        const cmpDimAmt = -(cmpLeafDimIndex.get(k) ?? 0);
        return <><PLAmountCell value={cmpDimAmt} typoStyle={subbody2Style} divider /><DeviationCells a={-dim.amount} b={cmpDimAmt} typoStyle={subbody2Style} /></>;
      })()}
      {!multiCompany && compareMode && cmp2Enabled && (() => {
        const k = `${leaf.code}|${dim.code}`;
        const cmp2DimAmt = -(cmp2LeafDimIndex.get(k) ?? 0);
        return <><PLAmountCell value={cmp2DimAmt} typoStyle={subbody2Style} divider /><DeviationCells a={-dim.amount} b={cmp2DimAmt} typoStyle={subbody2Style} /></>;
      })()}
      {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && (() => {
        const k = `${leaf.code}|${dim.code}`;
        const cmp3DimAmt = -(cmp3LeafDimIndex.get(k) ?? 0);
        return <><PLAmountCell value={cmp3DimAmt} typoStyle={subbody2Style} divider /><DeviationCells a={-dim.amount} b={cmp3DimAmt} typoStyle={subbody2Style} /></>;
      })()}
{historyExpanded && !compareMode && historyMonthsProcessed.map((h) => {
        const k = `${leaf.code}|${dim.code}`;
        const hYtd = -(h.leafDimIdx.get(k) ?? 0);
        const hPrev = Number(h.month) === 1 ? 0 : -(h.prevLeafDimIdx.get(k) ?? 0);
        const v = ytdOnly ? hYtd : hYtd - hPrev;
        return <PLAmountCell key={`hist-dim-${h.year}-${h.month}-${j}`} value={v} typoStyle={subbody2Style} centered />;
      })}
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
  const t = useT();
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
       <p className="text-gray-400 text-sm">{t("loading_financial_data")}</p>
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
<p className="text-gray-400 text-sm font-semibold">{t("waiting_for_data")}</p>
        <p className="text-gray-300 text-xs mt-1">{t("data_loading_automatically")}</p>
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
          <Hash size={11} />{visibleRoots.length} {t("table_sections")} · {uploadedAccounts.length} {t("table_rows")} · {groupAccounts.length} {t("table_group_accs")}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
            <Search size={13} className="text-gray-400" />
         <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("search_accounts_placeholder")}
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
          label: String(node.name ?? ""),
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
        label: String(node.name ?? ""),
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

function BSAmountCell({ value, divider, typoStyle, centered = true }) {
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
    <td className={`py-2.5 whitespace-nowrap tabular-nums ${centered ? "text-center px-4" : "pl-8 pr-6 text-right"}`} style={{ ...style, width: "200px" }}>
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



function BalanceSheet({ plCompareMode = false, externalAccColWidth, onAccColWidthChange, multiCompany = false, selectedCompanies = [], externalBsDrillMap, externalSetBsDrillMap, onHistoryExpandedChange, externalHistoryExpanded, externalHistoryMonths, onHistoryMonthsChange, groupAccounts, uploadedAccounts, loading, error, month, year, source, structure, company, sources, structures, companies, dimGroups, token, journalEntries = [], journalEntriesCmp = [], journalEntriesCmp2 = [], journalEntriesCmp3 = [], onCompareChange, dimensionActive = false,upDimGroup = "", upDimension = "", upDimGroups = [], upDimensions = [], filteredDims = [], externalCmp2Enabled, onBsCmp2EnabledChange,breakers = { pl: {}, bs: {}, cf: {} }, pgcBsMapping = null, savedBsLiteral = null,
  compareMode, setCompareMode,
  cmpYear, setCmpYear, cmpMonth, setCmpMonth, cmpSource, setCmpSource, cmpStructure, setCmpStructure, cmpCompany, setCmpCompany,
  cmpData, setCmpData,
cmp2Year, setCmp2Year, cmp2Month, setCmp2Month, cmp2Source, setCmp2Source, cmp2Structure, setCmp2Structure, cmp2Company, setCmp2Company,
  cmp2Data, setCmp2Data,
  cmp3Year, setCmp3Year, cmp3Month, setCmp3Month, cmp3Source, setCmp3Source, cmp3Structure, setCmp3Structure, cmp3Company, setCmp3Company,
  cmp3Data, setCmp3Data,
  externalCmp3Enabled, onBsCmp3EnabledChange,
  bsCmp3DimGroups, setBsCmp3DimGroups,
  bsCmp3Dimensions, setBsCmp3Dimensions,
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
  const [historyExpandedInternal, setHistoryExpandedInternal] = useState(false);
  const historyExpanded = externalHistoryExpanded !== undefined ? externalHistoryExpanded : historyExpandedInternal;
const setHistoryExpanded = useCallback((v) => {
    setHistoryExpandedInternal(v);
    onHistoryExpandedChange?.(v);
  }, [onHistoryExpandedChange]);
const [historyMonthsInternal, setHistoryMonthsInternal] = useState([]);
  const historyMonths = externalHistoryMonths !== undefined ? externalHistoryMonths : historyMonthsInternal;
  const historyMonthsRef = useRef(historyMonths);
  useEffect(() => { historyMonthsRef.current = historyMonths; }, [historyMonths]);
  const setHistoryMonths = useCallback((updater) => {
    const current = historyMonthsRef.current;
    const next = typeof updater === "function" ? updater(current) : updater;
    historyMonthsRef.current = next;
    setHistoryMonthsInternal(next);
    onHistoryMonthsChange?.(next);
  }, [onHistoryMonthsChange]);
  const [historyLoading, setHistoryLoading] = useState(false);

const fetchBSHistoryMonth = useCallback(async (y, mo) => {
    if (!token || !source || !structure || !y || !mo) return { data: [] };
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const coClause = selectedCompanies?.[0] ? ` and CompanyShortName eq '${selectedCompanies[0]}'` : '';
    const filter = `Year eq ${y} and Month eq ${mo} and Source eq '${source}' and GroupStructure eq '${structure}'${coClause}`;
    const jrnFilter = `Year eq ${y} and Month eq ${mo} and Source eq '${source}'${coClause}`;
try {
      const [resA, resJ] = await Promise.all([
        fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h }),
        fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(jrnFilter)}`, { headers: h }),
      ]);
      console.log('[BS-JRN-FETCH]', y, mo, 'status:', resJ.status);
      const jsonA = resA.ok ? await resA.json() : { value: [] };
      const jsonJ = resJ.ok ? await resJ.json() : { value: [] };
      const data = jsonA.value ?? (Array.isArray(jsonA) ? jsonA : []);
      const journals = jsonJ.value ?? (Array.isArray(jsonJ) ? jsonJ : []);
      return { data, journals };
    } catch { return { data: [], journals: [] }; }
 }, [token, source, structure, selectedCompanies]);

const loadBSHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryMonths([]);
    const targets = [];
    let y = Number(year), m = Number(month);
    for (let i = 0; i < 5; i++) {
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      targets.push({ year: y, month: m });
    }
for (const target of targets) {
      const { data, journals } = await fetchBSHistoryMonth(target.year, target.month);
      setHistoryMonths(prev => {
        const filtered = prev.filter(p => !(p.year === target.year && p.month === target.month));
        return [...filtered, { year: target.year, month: target.month, data, journals }];
      });
    }
setHistoryLoading(false);
  }, [year, month, fetchBSHistoryMonth, setHistoryMonths]);

const toggleBSHistory = useCallback(() => {
    if (compareMode || multiCompany || plCompareMode) return;
    setHistoryExpanded(!historyExpanded);
}, [compareMode, multiCompany, plCompareMode, historyExpanded, setHistoryExpanded]);

// Single sync effect: fetches when expanded turns on or period changes; clears when off.
  // Skips refetch on remount when nothing actually changed.
const bsHistSyncRef = useRef({ expanded: externalHistoryExpanded, period: `${year}-${month}`, scope: `${source}|${structure}|${selectedCompanies?.[0] ?? ''}` });
  useEffect(() => {
    const currentPeriod = `${year}-${month}`;
    const currentScope = `${source}|${structure}|${selectedCompanies?.[0] ?? ''}`;
    const last = bsHistSyncRef.current;
    const expandedChanged = last.expanded !== externalHistoryExpanded;
    const periodChanged = last.period !== currentPeriod;
    const scopeChanged = last.scope !== currentScope;
    bsHistSyncRef.current = { expanded: externalHistoryExpanded, period: currentPeriod, scope: currentScope };

    if (!externalHistoryExpanded) {
      if (expandedChanged && historyMonthsRef.current.length > 0) setHistoryMonths([]);
      return;
    }
if (compareMode || multiCompany) return;
   if (!expandedChanged && !periodChanged && !scopeChanged && historyMonthsRef.current.length > 0) return;
    loadBSHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalHistoryExpanded, year, month, source, structure, selectedCompanies]);

const localName = useCallback((node) => {
    return pgcBsMapping?.names?.get(String(node.code)) ?? node.name;
  }, [pgcBsMapping]);

const matchesSelf = useCallback((n, q) => {
  if (!q) return false;
  if (String(n.code ?? "").toLowerCase().includes(q)) return true;
  if (String(localName(n) ?? "").toLowerCase().includes(q)) return true;
  if (Array.isArray(n.uploadLeaves)) {
    for (const leaf of n.uploadLeaves) {
      if (leaf.type === "plain") continue;
      if (String(leaf.code ?? "").toLowerCase().includes(q)) return true;
      if (String(leaf.name ?? "").toLowerCase().includes(q)) return true;
      if (Array.isArray(leaf.children)) {
        for (const dim of leaf.children) {
          if (String(dim.code ?? "").toLowerCase().includes(q)) return true;
          if (String(dim.name ?? "").toLowerCase().includes(q)) return true;
        }
      }
    }
  }
  return false;
}, [localName]);

const [, setCmpLoading] = useState(false);
  const header3Style = useTypo("header3");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const subbody1Style = useTypo("subbody1");
  const subbody2Style = useTypo("subbody2");
const [, setCmp2Loading] = useState(false);
const [bsView, setBsView] = useState("summary");
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDeferredValue(searchQuery);
const searchInputRef = useRef(null);
const [accColWidthInternal, setAccColWidthInternal] = useState(null);
const accColWidth = externalAccColWidth !== undefined ? externalAccColWidth : accColWidthInternal;
const setAccColWidth = onAccColWidthChange ?? setAccColWidthInternal;
const startAccResize = useCallback((e) => {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const th = handle.parentElement;
  const startX = e.clientX;
  const startW = accColWidth ?? th.getBoundingClientRect().width;

  // Medir el min: posición del último botón del header (expand/collapse all) + padding
const thRect = th.getBoundingClientRect();
  let maxRight = thRect.left;
  th.querySelectorAll("button").forEach(b => {
    const r = b.getBoundingClientRect().right;
    if (r > maxRight) maxRight = r;
  });
const minW = maxRight > thRect.left ? Math.max(60, maxRight - thRect.left + 12) : 220;

  const table = th.closest("table");
  const col = table?.querySelector("colgroup col:first-child");

  handle.classList.add("is-dragging");
  let latestW = startW;

  const move = (ev) => {
    const dx = ev.clientX - startX;
    latestW = Math.max(minW, Math.min(1200, startW + dx));
    if (col) col.style.width = `${latestW}px`;
    th.style.width = `${latestW}px`;
  };
  const up = () => {
    handle.classList.remove("is-dragging");
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setAccColWidth(latestW);
  };
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}, [accColWidth, setAccColWidth]);

useEffect(() => {
  const clamp = () => {
    const th = document.querySelector(".k-sticky-acc-head");
    if (!th) return;
    const thRect = th.getBoundingClientRect();
    let maxRight = thRect.left;
    th.querySelectorAll("button").forEach(b => {
      const r = b.getBoundingClientRect().right;
      if (r > maxRight) maxRight = r;
    });
    const minW = maxRight > thRect.left ? Math.max(60, maxRight - thRect.left + 12) : 220;
    const currentW = accColWidth ?? thRect.width;
    if (currentW < minW) setAccColWidth(minW);
  };
const raf = requestAnimationFrame(() => requestAnimationFrame(clamp));
  return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [accColWidth, savedBsLiteral, pgcBsMapping, bsView, compareMode, historyExpanded, multiCompany]);

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
const [cmp3EnabledInternal, setCmp3EnabledInternal] = useState(true);
  const cmp3Enabled = externalCmp3Enabled !== undefined ? externalCmp3Enabled : cmp3EnabledInternal;
  const setCmp3Enabled = (v) => { setCmp3EnabledInternal(v); onBsCmp3EnabledChange?.(v); };
const bsCmp3FilteredDims = useMemo(() => {
  if (!bsCmp3DimGroups || bsCmp3DimGroups.length === 0) return effectiveDimensions;
  return effectiveDimensions.filter(d => {
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return bsCmp3DimGroups.includes(g);
  });
}, [effectiveDimensions, bsCmp3DimGroups]);
const bsDrillMap = useMemo(() => externalBsDrillMap ?? {}, [externalBsDrillMap]);
const setBsDrillMap = useMemo(() => externalSetBsDrillMap ?? (() => {}), [externalSetBsDrillMap]);

const bsDrill = useCallback((key) => {
  setBsDrillMap(prev => ({ ...prev, [key]: !prev[key] }));
}, [setBsDrillMap]);
// Intentionally do NOT reset bsDrillMap on compareMode/cmp2Enabled changes
// so the user keeps their expanded rows when toggling compare or removing Period C.
  const [jrnPopup, setJrnPopup] = useState(null);
  const [dimPopup, setDimPopup] = useState(null);

const journalByCode = useMemo(() => {
  const idx = new Map();
  (journalEntries || []).forEach(row => {
    if (idx.size === 0) console.log('[A]', JSON.stringify(row));
    const code = String(row.accountCode ?? row.AccountCode ?? "");
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

const journalByCodeCmp3 = useMemo(() => {
  const idx = new Map();
  (journalEntriesCmp3 || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? "");
    if (!code) return;
    const jt = String(row.journalType ?? row.JournalType ?? "").toUpperCase();
    if (jt !== "AJE" && jt !== "RJE") return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntriesCmp3]);

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
  (cmp2Data || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp2Data]);
const bsCmpLeafDimIndex = useMemo(() => {
  const idx = new Map();
  (cmpData || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dc  = String(getField(row, "dimensionCode") ?? "");
    if (!lac || !dc || dc === "null") return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
  });
  return idx;
}, [cmpData]);

const bsCmp2LeafDimIndex = useMemo(() => {
  const idx = new Map();
  (cmp2Data || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dc  = String(getField(row, "dimensionCode") ?? "");
    if (!lac || !dc || dc === "null") return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
  });
  return idx;
}, [cmp2Data]);

const bsCmp3LeafDimIndex = useMemo(() => {
  const idx = new Map();
  (cmp3Data || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const dc  = String(getField(row, "dimensionCode") ?? "");
    if (!lac || !dc || dc === "null") return;
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
  });
  return idx;
}, [cmp3Data]);
const bsCmp3LeafIndex = useMemo(() => {
  const idx = new Map();
  (cmp3Data || []).forEach(row => {
    const lac = String(getField(row, "localAccountCode") ?? "");
    const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
    if (!lac) return;
    idx.set(lac, (idx.get(lac) ?? 0) + amt);
  });
  return idx;
}, [cmp3Data]);

// ── Multi-company BS indexes ────────────────────────────────
const perCompanyBsData = useMemo(() => {
  if (!multiCompany) return null;
  const map = new Map();
  selectedCompanies.forEach(co => map.set(co, []));
  (uploadedAccounts || []).forEach(row => {
    const co = String(getField(row, "companyShortName", "CompanyShortName") ?? "");
    if (map.has(co)) map.get(co).push(row);
  });
  return map;
}, [uploadedAccounts, selectedCompanies, multiCompany]);

const perCompanyBsNodeByCode = useMemo(() => {
  if (!multiCompany || !perCompanyBsData) return null;
  const map = new Map();
  selectedCompanies.forEach(co => {
    const t = buildTree(groupAccounts, perCompanyBsData.get(co) ?? [], !dimensionActive);
    const codeMap = new Map();
    const walk = (n) => { codeMap.set(n.code, n); n.children?.forEach(walk); };
    t.forEach(walk);
    map.set(co, codeMap);
  });
  return map;
}, [groupAccounts, perCompanyBsData, selectedCompanies, multiCompany, dimensionActive]);

const getBsValForCompany = useCallback((code, company) => {
  const node = perCompanyBsNodeByCode?.get(company)?.get(code);
  if (!node) return 0;
  const raw = sumNode(node);
  if (pgcBsMapping?.rows) {
    const m = pgcBsMapping.rows.get(String(code));
    if (m && (m.section === "PASIVO" || m.section === "PATRIMONIO")) return -raw;
    return raw;
  }
  return Number(code) >= 599999 ? -raw : raw;
}, [perCompanyBsNodeByCode, pgcBsMapping]);

const perCompanyBsLeafIdx = useMemo(() => {
  if (!multiCompany) return null;
  const result = new Map();
  selectedCompanies.forEach(co => {
    const idx = new Map();
    (perCompanyBsData?.get(co) || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      if (!lac) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      idx.set(lac, (idx.get(lac) ?? 0) + amt);
    });
    result.set(co, idx);
  });
  return result;
}, [multiCompany, perCompanyBsData, selectedCompanies]);

const perCompanyBsLeafDimIdx = useMemo(() => {
  if (!multiCompany) return null;
  const result = new Map();
  selectedCompanies.forEach(co => {
    const idx = new Map();
    (perCompanyBsData?.get(co) || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      const dc  = String(getField(row, "dimensionCode") ?? "");
      if (!lac || !dc || dc === "null") return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      idx.set(`${lac}|${dc}`, (idx.get(`${lac}|${dc}`) ?? 0) + amt);
    });
    result.set(co, idx);
  });
  return result;
}, [multiCompany, perCompanyBsData, selectedCompanies]);

const getBsDimValForCompany = useCallback((localCode, dimCode, co) => {
  return perCompanyBsLeafDimIdx?.get(co)?.get(`${String(localCode)}|${String(dimCode)}`) ?? 0;
}, [perCompanyBsLeafDimIdx]);

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
}, [filteredAllCompaniesData]);


const companyTree = useMemo(() => {
  if (!filteredAllCompaniesData.length) return [];
  return buildTree(groupAccounts, filteredAllCompaniesData, !dimensionActive);
}, [groupAccounts, filteredAllCompaniesData, dimensionActive]);


function renderBSDrill(node, parentKey, parentDepth = 0) {

  if (!isOpen(parentKey)) return null;
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
      const childExpanded = isOpen(childKey);
      const grandkids = (child.children || []).filter(hasData);
      const hasMore = grandkids.length > 0 || (child.uploadLeaves?.filter(l => l.type !== "plain").length > 0);
      const total = Number(child.code) >= 599999 ? -sumNode(child) : sumNode(child);
      // const isBold = BS_HIGHLIGHTED_CODES.has(String(node.code));

const isChildMatch = (() => {
        const q = debouncedQuery.trim().toLowerCase();
        if (!q) return false;
        return String(child.code ?? "").toLowerCase().includes(q) || String(localName(child) ?? "").toLowerCase().includes(q);
      })();
      rows.push(
  <tr key={childKey}
    className={`border-b border-[#1a2f8a]/5 ${isChildMatch ? "bg-[#fef3c7]" : ""} transition-colors ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : "hover:bg-[#eef1fb]/30"}`}
    onClick={hasMore ? () => setBsDrillMap(prev => ({ ...prev, [childKey]: !prev[childKey] })) : undefined}>
<td className="py-2 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 20}px` }}>
<div className="flex items-center">
  {hasMore
    ? <span className="text-[#1a2f8a]/50 mr-2">{childExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
    : <span className="inline-block mr-2" style={{ width: 12 }} />}
  <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{child.code}</span>
  <span style={body2Style}>{child.name}</span>
</div>
    </td>
{multiCompany && selectedCompanies.map(co => (
            <BSAmountCell key={`bsmc-child-${child.code}-${co}`} value={getBsValForCompany(child.code, co)} typoStyle={body2Style} centered />
          ))}
          {!multiCompany && <BSAmountCell value={total} typoStyle={body2Style} />}
{!multiCompany && compareMode && (() => {
            const activeCmpTree = bsView === "summary" ? cmpTree : allCmpTree;
            const cmpRaw = activeCmpTree.length ? getNodeValue(activeCmpTree, child.code) : 0;
            const cmpVal = Number(child.code) >= 599999 ? -cmpRaw : cmpRaw;
            return <>
              <BSAmountCell value={cmpVal} typoStyle={body2Style} divider />
              <BSDeviationCells a={total} b={cmpVal} typoStyle={body2Style} />
              {cmp2Enabled && (() => {
                const activeCmp2Tree = bsView === "summary" ? cmp2Tree : allCmp2Tree;
                const cmp2Raw = activeCmp2Tree.length ? getNodeValue(activeCmp2Tree, child.code) : 0;
                const cmp2Val = Number(child.code) >= 599999 ? -cmp2Raw : cmp2Raw;
                return <>
                  <BSAmountCell value={cmp2Val} typoStyle={body2Style} divider />
                  <BSDeviationCells a={total} b={cmp2Val} typoStyle={body2Style} />
                </>;
              })()}
              {cmp2Enabled && cmp3Enabled && (() => {
                const cmp3Raw = cmp3Tree.length ? getNodeValue(cmp3Tree, child.code) : 0;
                const cmp3Val = Number(child.code) >= 599999 ? -cmp3Raw : cmp3Raw;
                return <>
                  <BSAmountCell value={cmp3Val} typoStyle={body2Style} divider />
                  <BSDeviationCells a={total} b={cmp3Val} typoStyle={body2Style} />
                </>;
              })()}
            </>;
          })()}
{historyExpanded && !compareMode && bsHistoryProcessed.map(h => (
            <BSAmountCell key={`bshist-drill-${h.year}-${h.month}-${child.code}`} value={getBSHistVal(h, child.code)} typoStyle={body2Style} centered />
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
        const hasHistJrnsBsStd = bsHistoryProcessed.some(h => (h.jrnByCode?.get(String(child.code)) || []).length > 0);
        if (jrnRows.length > 0 || hasHistJrnsBsStd) {
          const jrnKey = `bsjrn-child-${contextKey}-${child.code}`;
          const jrnExpanded = isOpen(jrnKey);
          rows.push(
            <tr key={jrnKey}
              className="border-b border-[#1a2f8a]/5 cursor-pointer hover:bg-indigo-50/50 transition-colors bg-indigo-50/20"
              onClick={() => setBsDrillMap(prev => ({ ...prev, [jrnKey]: !prev[jrnKey] }))}>
<td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
<span className="text-[#1a2f8a]/40 flex-shrink-0">
                    {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}
                  </span>
                  <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
{t("label_journal")}
                  </span>
                  <span className="text-[10px] text-gray-400">{jrnRows.length} {jrnRows.length === 1 ? t("entry") : t("entries")}</span>
                </div>
              </td>
{multiCompany ? selectedCompanies.map(co => (
                <td key={`bsmc-jrnhdr-${child.code}-${co}`} />
              )) : <td className="text-right pr-4 py-1 font-mono text-xs text-gray-300">—</td>}
              {!multiCompany && compareMode && <><td /><td /><td /></>}
              {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
              {!multiCompany && historyExpanded && !compareMode && bsHistoryProcessed.map(h => {
                const histEntries = h.jrnByCode?.get(String(child.code)) || [];
                const histAmt = histEntries.reduce((acc, je) => acc + parseAmt(je.amountYTD ?? je.AmountYTD ?? 0), 0);
                return <BSAmountCell key={`bshist-jrnhdr-${h.year}-${h.month}-${child.code}`} value={histAmt} typoStyle={subbody2Style} centered />;
              })}
            </tr>
          );
if (jrnExpanded) {
            // Unified list: current entries + each historical month's own entries
            const allJrnRowsBs = [];
            jrnRows.forEach(jrn => allJrnRowsBs.push({ jrn, source: 'current' }));
            if (historyExpanded && !compareMode) {
              bsHistoryProcessed.forEach(h => {
                const hjrns = h.jrnByCode?.get(String(child.code)) || [];
                hjrns.forEach(jrn => allJrnRowsBs.push({ jrn, source: `hist-${h.year}-${h.month}` }));
              });
            }
            allJrnRowsBs.forEach(({ jrn, source: jsrc }, k) => {
              const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
              rows.push(
              <tr key={`bsjrn-child-entry-${contextKey}-${child.code}-${k}`}
                  className="border-b border-[#1a2f8a]/5 hover:bg-indigo-50/40 transition-colors bg-indigo-50/10 cursor-pointer"
                  onClick={() => setJrnPopup(jrn)}>
                  <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-px bg-indigo-100 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-indigo-400 flex-shrink-0">{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader ?? ""}</span>
                      {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-300 italic truncate max-w-[200px]">{jrn.rowText ?? jrn.RowText}</span>}
                      {(jrn.counterpartyShortName ?? jrn.CounterpartyShortName) && <span className="text-[10px] text-gray-300 ml-1">· {jrn.counterpartyShortName ?? jrn.CounterpartyShortName}</span>}
                    </div>
                  </td>
{multiCompany ? selectedCompanies.map(co => {
                    const jrnCo = String(jrn.companyShortName ?? jrn.CompanyShortName ?? "");
                    const v = jrnCo === co ? amt : 0;
                    return <td key={`bsmc-jrn-${jrn.journalNumber ?? jrn.JournalNumber ?? k}-${co}`} className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">
                      {v === 0 ? "—" : fmtAmt(v)}
                    </td>;
                  }) : <td className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">
                    {jsrc === 'current' ? (amt === 0 ? "—" : fmtAmt(amt)) : "—"}
                  </td>}
{!multiCompany && compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                  {!multiCompany && compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} /><td /><td /></>}
                  {historyExpanded && !compareMode && bsHistoryProcessed.map(h => {
                    const v = jsrc === `hist-${h.year}-${h.month}` ? amt : 0;
                    return <td key={`bshist-jrn-${h.year}-${h.month}-${k}`} className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">
                      {v === 0 ? "—" : fmtAmt(v)}
                    </td>;
                  })}
                </tr>
              );
});

            // ── Compare-period-only journals (B/C/D not in A) ──
            if (compareMode) {
              const aNums = new Set(jrnRows.map(j => j.journalNumber ?? j.JournalNumber));
              const seen = new Map();
              const collect = (idx, period) => {
                (idx.get(child.code) || []).forEach(j => {
                  const num = j.journalNumber ?? j.JournalNumber;
                  if (aNums.has(num)) return;
                  if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                  seen.get(num).periods[period] = parseAmt(j.amountYTD ?? j.AmountYTD ?? 0);
                });
              };
              collect(journalByCodeCmp, 'B');
              if (cmp2Enabled) collect(journalByCodeCmp2, 'C');
              if (cmp2Enabled && cmp3Enabled) collect(journalByCodeCmp3, 'D');
              seen.forEach((entry, num) => {
                ['B','C','D'].forEach(p => {
                  if (entry.periods[p] != null) return;
                  const idx = p === 'B' ? journalByCodeCmp : p === 'C' ? journalByCodeCmp2 : journalByCodeCmp3;
                  const match = (idx.get(child.code) || []).find(j => (j.journalNumber ?? j.JournalNumber) === num);
                  if (match) entry.periods[p] = parseAmt(match.amountYTD ?? match.AmountYTD ?? 0);
                });
              });
              const extras = [...seen.entries()];
              if (extras.length > 0) {
                rows.push(
                  <tr key={`bsjrn-child-extra-hdr-${contextKey}-${child.code}`}
                    className="border-b border-[#1a2f8a]/5 bg-indigo-50/30">
                    <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-px bg-indigo-300 flex-shrink-0" />
                        <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-100 border border-indigo-200 px-1.5 py-0.5 rounded flex-shrink-0">B/C/D only</span>
                        <span className="text-[10px] text-gray-400">{extras.length} {extras.length === 1 ? t("entry") : t("entries")}</span>
                      </div>
                    </td>
                    {multiCompany ? selectedCompanies.map(co => <td key={`bsmc-jxhdr-${child.code}-${co}`} />) : <td />}
                    {!multiCompany && compareMode && <><td /><td /><td /></>}
                    {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                    {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                  </tr>
                );
                extras.forEach(([num, entry], xi) => {
                  const jrn = entry.jrn;
                  rows.push(
                    <tr key={`bsjrn-child-extra-${contextKey}-${child.code}-${xi}`}
                      className="border-b border-[#1a2f8a]/5 bg-indigo-50/10 hover:bg-indigo-50/40 transition-colors cursor-pointer"
                      onClick={() => setJrnPopup(jrn)}>
                      <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-px bg-indigo-100 flex-shrink-0" />
                          <span className="text-[10px] font-mono text-indigo-400 flex-shrink-0">{num ?? ""}</span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader ?? ""}</span>
                          {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-300 italic truncate max-w-[200px]">{jrn.rowText ?? jrn.RowText}</span>}
                        </div>
                      </td>
                      {multiCompany ? selectedCompanies.map(co => <td key={`bsmc-jx-${child.code}-${co}-${xi}`} />) : <td className="text-right pr-4 py-1 font-mono text-xs text-gray-300">—</td>}
                      {!multiCompany && compareMode && <><td style={{ borderLeft: "2px solid #e2e8f0" }} className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">{entry.periods.B == null || entry.periods.B === 0 ? "—" : fmtAmt(entry.periods.B)}</td><td /><td /></>}
                      {!multiCompany && compareMode && cmp2Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">{entry.periods.C == null || entry.periods.C === 0 ? "—" : fmtAmt(entry.periods.C)}</td><td /><td /></>}
                      {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td style={{ borderLeft: "2px solid #e2e8f0" }} className="text-right pr-4 py-1 font-mono text-xs text-indigo-400">{entry.periods.D == null || entry.periods.D === 0 ? "—" : fmtAmt(entry.periods.D)}</td><td /><td /></>}
                    </tr>
                  );
                });
              }
            }
          }
        }
      }
    });

    leaves.forEach((leaf, i) => {
      const leafKey = `bsdrill-leaf-${contextKey}-${depth}-${i}`;
      const leafExpanded = isOpen(leafKey);
      const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
      const amt = leaf.amount ?? 0;

      rows.push(
<tr key={leafKey}
          className={`border-b border-[#1a2f8a]/5 ${(() => {
            const q = debouncedQuery.trim().toLowerCase();
            if (!q) return "bg-[#fafbff]";
            const m = String(leaf.code ?? "").toLowerCase().includes(q) || String(leaf.name ?? "").toLowerCase().includes(q);
            return m ? "bg-[#fef3c7]" : "bg-[#fafbff]";
          })()} transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/40" : "hover:bg-[#eef1fb]/20"}`}
          onClick={hasDims ? () => setBsDrillMap(prev => ({ ...prev, [leafKey]: !prev[leafKey] })) : undefined}>
<td className="py-1.5 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 20}px` }}>
  <div className="flex items-center">
    {hasDims
      ? <span className="text-[#1a2f8a]/50 mr-2">{leafExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
      : <span className="inline-block mr-2" style={{ width: 12 }} />}
    {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
    <span style={subbody1Style}>{leaf.name || ""}</span>
  </div>
</td>
{multiCompany && selectedCompanies.map(co => (
            <BSAmountCell key={`bsmc-leaf-${leaf.code ?? "noleaf"}-${co}-${depth}-${i}`} value={leaf.code ? (perCompanyBsLeafIdx?.get(co)?.get(String(leaf.code)) ?? 0) : 0} typoStyle={subbody1Style} centered />
          ))}
          {!multiCompany && <BSAmountCell value={amt} typoStyle={subbody1Style} />}
{!multiCompany && compareMode && (() => {
            const cmpAmt = leaf.code ? bsCmpLeafIndex.get(String(leaf.code)) ?? 0 : 0;
            return <>
              <BSAmountCell value={cmpAmt} typoStyle={subbody1Style} divider />
              <BSDeviationCells a={amt} b={cmpAmt} typoStyle={subbody1Style} />
              {cmp2Enabled && (() => {
                const cmp2Amt = leaf.code ? (bsCmp2LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                return <>
                  <BSAmountCell value={cmp2Amt} typoStyle={subbody1Style} divider />
                  <BSDeviationCells a={amt} b={cmp2Amt} typoStyle={subbody1Style} />
                </>;
              })()}
              {cmp2Enabled && cmp3Enabled && (() => {
                const cmp3Amt = leaf.code ? (bsCmp3LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                return <>
                  <BSAmountCell value={cmp3Amt} typoStyle={subbody1Style} divider />
                  <BSDeviationCells a={amt} b={cmp3Amt} typoStyle={subbody1Style} />
                </>;
              })()}
            </>;
          })()}
{historyExpanded && !compareMode && bsHistoryProcessed.map(h => {
            const leafAmt = leaf.code ? (h.leafIdx.get(String(leaf.code)) ?? 0) : 0;
            return <BSAmountCell key={`bshist-leaf-${h.year}-${h.month}-${i}`} value={leafAmt} typoStyle={subbody1Style} centered />;
          })}
        </tr>
      );

      if (leafExpanded && hasDims) {
        leaf.children.forEach((dim, j) => {
          rows.push(
<tr key={`bsdrill-dim-${contextKey}-${depth}-${i}-${j}`}
              className={`border-b border-[#1a2f8a]/5 ${(() => {
                const q = debouncedQuery.trim().toLowerCase();
                if (!q) return "bg-amber-50/10";
                const m = String(dim.code ?? "").toLowerCase().includes(q) || String(dim.name ?? "").toLowerCase().includes(q);
                return m ? "bg-[#fef3c7]" : "bg-amber-50/10";
              })()} hover:bg-amber-50/40 transition-colors cursor-pointer`}
              onClick={() => setDimPopup(dim)}>
              <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                  <span className="text-xs text-gray-400 italic">{dim.name || dim.code}</span>
                </div>
              </td>
{multiCompany ? selectedCompanies.map(co => (
                  <BSAmountCell key={`bsmc-dim-${dim.code ?? "nocode"}-${co}-${depth}-${i}-${j}`} value={leaf.code ? getBsDimValForCompany(leaf.code, dim.code, co) : 0} typoStyle={subbody2Style} centered />
                )) : <BSAmountCell value={dim.amount} typoStyle={subbody2Style} />}
{!multiCompany && compareMode && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const cmpDimVal = bsCmpLeafDimIndex.get(k) ?? 0;
  return <><BSAmountCell value={cmpDimVal} typoStyle={subbody2Style} divider /><BSDeviationCells a={dim.amount} b={cmpDimVal} typoStyle={subbody2Style} /></>;
})()}
{!multiCompany && compareMode && cmp2Enabled && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const cmp2DimVal = bsCmp2LeafDimIndex.get(k) ?? 0;
  return <><BSAmountCell value={cmp2DimVal} typoStyle={subbody2Style} divider /><BSDeviationCells a={dim.amount} b={cmp2DimVal} typoStyle={subbody2Style} /></>;
})()}
{!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const cmp3DimVal = bsCmp3LeafDimIndex.get(k) ?? 0;
  return <><BSAmountCell value={cmp3DimVal} typoStyle={subbody2Style} divider /><BSDeviationCells a={dim.amount} b={cmp3DimVal} typoStyle={subbody2Style} /></>;
})()}
{historyExpanded && !compareMode && bsHistoryProcessed.map(h => {
  const k = `${leaf.code}|${dim.code}`;
  const v = h.dimIdx?.get(k) ?? 0;
  return <BSAmountCell key={`bshist-dim-${h.year}-${h.month}-${i}-${j}`} value={v} typoStyle={subbody2Style} centered />;
})}
            </tr>
          );
        });
      }
  if (leafExpanded) {
        const jrnRows = (journalByCode.get(leaf.code) || []);
        if (jrnRows.length > 0) {
          const jrnKey = `bsjrn-leaf-${contextKey}-${depth}-${i}`;
          const jrnExpanded = isOpen(jrnKey);
          rows.push(
            <tr key={jrnKey}
              className="border-b border-[#1a2f8a]/5 cursor-pointer hover:bg-indigo-50/40 transition-colors"
              onClick={() => setBsDrillMap(prev => ({ ...prev, [jrnKey]: !prev[jrnKey] }))}>
              <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
                  <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
                   {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>} {t("label_journal")}
                  </span>
                  <span className="text-[10px] text-gray-400">{jrnRows.length} {jrnRows.length === 1 ? t("entry") : t("entries")}</span>
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
                  <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
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
   const expanded = isOpen(drillKey);
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
<td className="px-6 py-2.5 k-sticky-acc min-w-[220px]">
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
       rows.push(...drillRows);
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
      const drillKey = `bsrow-${node.code}`;
      const flatChildren = childrenInFlat.get(String(node.code)) || [];
      const treeChildren = (node.children || []).filter(hasData);
      const hasNonFlatChildren = treeChildren.some(c => !flatByCode.has(String(c.code)));
      const hasLeaves = (node.uploadLeaves || []).some(l => l.type !== "plain");
      const hasJournal = (journalByCode.get(node.code) || []).length > 0;
      const hasMore = flatChildren.length > 0 || hasNonFlatChildren || hasLeaves || hasJournal;
     const expanded = isOpen(drillKey);

const divider = effectiveBreakersBs[String(node.code)];
      if (divider) {
rows.push(
<tr key={`bsdivider-${node.code}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}>
            <td style={{ backgroundColor: divider.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
              <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
            </td>
            <td colSpan={(multiCompany ? selectedCompanies.length + 1 : 3 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (historyExpanded ? bsHistoryProcessed.length : 0))} style={{ backgroundColor: divider.color }} />
          </tr>
        );
      }

const rowStyle = depth === 0 ? body1Style : body2Style;
const isMatchSelf = (() => {
        const q = debouncedQuery.trim().toLowerCase();
        if (!q) return false;
        return String(node.code ?? "").toLowerCase().includes(q) || String(localName(node) ?? "").toLowerCase().includes(q);
      })();
      rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 ${isMatchSelf ? "bg-[#fef3c7]" : "bg-white"} ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}
    onClick={hasMore ? () => bsDrill(drillKey) : undefined}>
<td className="py-2.5 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 18}px` }}>
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
{multiCompany
  ? selectedCompanies.map(co => (
      <BSAmountCell key={`bsmc-val-${node.code}-${co}`} value={getBsValForCompany(node.code, co)} typoStyle={rowStyle} centered />
    ))
  : <BSAmountCell value={total} typoStyle={rowStyle} />}
{!multiCompany && historyExpanded && !compareMode && bsHistoryProcessed.map(h => (
      <BSAmountCell key={`bshist-${h.year}-${h.month}-${node.code}`} value={getBSHistVal(h, node.code)} typoStyle={rowStyle} centered />
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
    const kids = (node.children || []).filter(hasData).filter(c => c.level <= 4);
    const drillKey = `bsrow-${node.code}`;
    const hasMore = kids.length > 0 || node.uploadLeaves?.filter(l => l.type !== "plain").length > 0;
    const expanded = !!bsDrillMap[drillKey];
const BS_DIVIDERS = Object.keys(breakers.bs).length
  ? effectiveBreakersBs
  : { '399999': { label: t("bs_assets"), color: colors.primary }, '499999': { label: t("bs_equity"), color: colors.secondary }, '699999': { label: t("bs_liabilities"), color: colors.tertiary }, 'C.ACT': { label: t("bs_assets"), color: colors.primary }, 'D.S': { label: t("bs_equity"), color: colors.secondary }, 'E.S': { label: t("bs_liabilities"), color: colors.tertiary } };
    const bsDivider = BS_DIVIDERS[String(node.code)];
if (bsDivider) {
          rows.push(
            <tr key={`bsdivider-${node.code}`}>
              <td style={{ backgroundColor: bsDivider.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
                <span className="uppercase tracking-widest" style={header3Style}>{bsDivider.label}</span>
              </td>
              <td colSpan={(cmp2Enabled ? 8 : 5)} style={{ backgroundColor: bsDivider.color }} />
            </tr>
          );
        }

    if (kids.length > 0) rows.push(...renderBSRows(kids));

rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 bg-white ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}
    onClick={hasMore ? () => bsDrill(drillKey) : undefined}>
    <td className="px-6 py-2.5 whitespace-nowrap k-sticky-acc">
      <div className="flex items-center">
        {hasMore
          ? <span className="text-[#1a2f8a]/50 mr-2">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
          : <span className="inline-block mr-2" style={{ width: 12 }} />}
        <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>
        <span style={body1Style}>
          {(() => { const n = localName(node); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); })()}
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
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, fetchBSCompare, setCmpData]);

useEffect(() => {
    if (compareMode && cmp2Source && cmp2Structure && cmp2Year && cmp2Month && cmp2Company) {
      fetchBSCompare(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, setCmp2Data, setCmp2Loading);
    }
}, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, fetchBSCompare, setCmp2Data]);

  useEffect(() => {
    if (compareMode && cmp3Enabled && cmp3Source && cmp3Structure && cmp3Year && cmp3Month && cmp3Company) {
      fetchBSCompare(cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, setCmp3Data, () => {});
    }
}, [compareMode, cmp3Enabled, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, fetchBSCompare, setCmp3Data]);

  useEffect(() => {
    onCompareChange?.(
      compareMode,
      { year: cmpYear, month: cmpMonth, source: cmpSource, structure: cmpStructure, company: cmpCompany },
      cmpData,
      { year: cmp2Year, month: cmp2Month, source: cmp2Source, structure: cmp2Structure, company: cmp2Company },
      cmp2Data,
    );
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, cmpData, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, cmp2Data, onCompareChange]);

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
  const cmp3Tree = useMemo(() => compareMode && cmp3Enabled ? buildTree(groupAccounts, cmp3Data, !dimensionActive) : [], [groupAccounts, cmp3Data, compareMode, cmp3Enabled, dimensionActive]);

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
    const filteredData = (h.data || []).filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
    const filteredJournals = (h.journals || []).filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions));
    h = { ...h, data: filteredData, journals: filteredJournals };
    console.log('[hist]', h.year, h.month, JSON.stringify(h.journals?.[0]));
    const t = buildTree(groupAccounts, h.data, !dimensionActive);
    const map = new Map();
    const walk = (n) => { map.set(n.code, n); n.children?.forEach(walk); };
    t.forEach(walk);
    const leafIdx = new Map();
    const dimIdx = new Map();
    (h.data || []).forEach(row => {
      const lac = String(getField(row, "localAccountCode") ?? "");
      const dc  = String(getField(row, "dimensionCode") ?? "");
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      if (lac) leafIdx.set(lac, (leafIdx.get(lac) ?? 0) + amt);
      if (lac && dc && dc !== "null") {
        const k = `${lac}|${dc}`;
        dimIdx.set(k, (dimIdx.get(k) ?? 0) + amt);
      }
    });
const jrnByCode = new Map();
    console.log('[BS Hist]', h.year, h.month, 'journals count:', (h.journals || []).length);
    (h.journals || []).forEach(j => {
      const code = String(j.AccountCode ?? j.accountCode ?? "");
      const jt = String(j.JournalType ?? j.journalType ?? "").toUpperCase();
      if (!code || (jt !== "AJE" && jt !== "RJE")) return;
      if (!jrnByCode.has(code)) jrnByCode.set(code, []);
      jrnByCode.get(code).push(j);
    });
    return { year: h.year, month: h.month, map, leafIdx, dimIdx, jrnByCode };
});
}, [historyMonths, groupAccounts, dimensionActive, upDimGroups, upDimensions]);

const getBSHistVal = useCallback((h, code) => {
  const n = h.map.get(code);
  if (!n) return 0;
  const sumYtdH = (nd) => {
    if (!nd) return 0;
    if (nd.type === "localAccount" || nd.type === "dimension" || nd.type === "plain") {
      return h.leafIdx?.get(String(nd.code)) ?? 0;
    }
    if (nd.uploadLeaves?.length > 0) {
      let s = 0;
      nd.uploadLeaves.forEach(l => { s += sumYtdH(l); });
      (nd.children || []).forEach(c => { s += sumYtdH(c); });
      return s;
    }
    let s = 0;
    (nd.children || []).forEach(c => { s += sumYtdH(c); });
    return s;
  };
  const raw = sumYtdH(n);
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

const searchExpansionMap = useMemo(() => {
  const q = debouncedQuery.trim().toLowerCase();
  if (!q) return null;
  const result = {};

  // Saved-mapping literal path
  if (savedBsLiteral) {
const treeByCode = new Map();
    (function indexTree(nodes) {
      nodes.forEach(n => { treeByCode.set(String(n.code), n); indexTree(n.children || []); });
    })(tree);

    savedBsLiteral.forEach((section, secIdx) => {
      const walk = (node, parentPath) => {
        const rowKey = `bssaved-${secIdx}-${parentPath}-${node.id}`;
        let descendantMatch = false;

        (node.children || []).forEach(child => {
          if (walk(child, `${parentPath}-${node.id}`)) descendantMatch = true;
        });

        const gaNode = treeByCode.get(String(node.code));
        const leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== "plain");
        leaves.forEach((leaf, i) => {
          const leafMatch =
            String(leaf.code ?? "").toLowerCase().includes(q) ||
            String(leaf.name ?? "").toLowerCase().includes(q);
          const dimMatch = (leaf.children || []).some(d =>
            String(d.code ?? "").toLowerCase().includes(q) ||
            String(d.name ?? "").toLowerCase().includes(q));
          if (leafMatch || dimMatch) {
            descendantMatch = true;
            if (dimMatch) result[`${rowKey}-leaf-${i}`] = true;
          }
        });

        const selfMatch =
          String(node.code ?? "").toLowerCase().includes(q) ||
          String(node.name ?? "").toLowerCase().includes(q);

        if (descendantMatch || selfMatch) {
          result[rowKey] = true;
        }
        return descendantMatch || selfMatch;
      };
      section.nodes.forEach(n => walk(n, "root"));
    });

    return result;
  }

  // PGC flat-list path: expand ancestors in the flat list when a descendant matches
  if (pgcBsMapping?.rows) {
    const flatNodes = bsView === "summary" ? bsPgcSummaryNodes : bsPgcAllSumNodes;
    if (!flatNodes) return null;

    const flatByCode = new Map(flatNodes.map(n => [String(n.code), n]));
    const gaByCode = new Map(groupAccounts.map(g => [String(g.accountCode ?? g.AccountCode ?? ""), g]));

    const parentInFlatOf = new Map();
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
      if (parentInFlat) parentInFlatOf.set(String(n.code), parentInFlat);
    });

    const walkDrill = (node, drillContextKey, depth) => {
      let any = false;
      (node.children || []).filter(c => hasData(c) && c.accountType === "B/S").forEach(child => {
        const childDrillKey = `bsdrill-${drillContextKey}-${child.code}`;
        if (walkDrill(child, childDrillKey, depth + 1)) {
          any = true;
          result[childDrillKey] = true;
        }
        if (matchesSelf(child, q)) {
          any = true;
          result[childDrillKey] = true;
        }
      });
      (node.uploadLeaves || []).forEach((leaf, i) => {
        if (leaf.type === "plain") return;
        const leafMatch = String(leaf.code ?? "").toLowerCase().includes(q) || String(leaf.name ?? "").toLowerCase().includes(q);
        const dimMatch = (leaf.children || []).some(d =>
          String(d.code ?? "").toLowerCase().includes(q) ||
          String(d.name ?? "").toLowerCase().includes(q));
        if (leafMatch || dimMatch) {
          any = true;
          if (dimMatch) result[`bsdrill-leaf-${drillContextKey}-${depth}-${i}`] = true;
        }
      });
      return any;
    };

    flatNodes.forEach(node => {
      const rowKey = `bsrow-${node.code}`;
      const selfMatch = matchesSelf(node, q);
      const drillMatch = walkDrill(node, rowKey, 0);
      if (selfMatch || drillMatch) {
        result[rowKey] = true;
        let p = parentInFlatOf.get(String(node.code));
        while (p) {
          result[`bsrow-${p}`] = true;
          p = parentInFlatOf.get(p);
        }
      }
    });

    return result;
  }

  const walk = (node, drillContextKey, depth) => {
    let descendantMatch = false;
    (node.children || []).filter(c => hasData(c) && c.accountType === "B/S").forEach(child => {
      const childDrillKey = `bsdrill-${drillContextKey}-${child.code}`;
      if (walk(child, childDrillKey, depth + 1)) {
        descendantMatch = true;
        result[`bsrow-${child.code}`] = true;
        result[`bsmulti-${child.code}`] = true;
        result[childDrillKey] = true;
      }
    });
    (node.uploadLeaves || []).forEach((leaf, i) => {
      if (leaf.type === "plain") return;
      const leafMatch = String(leaf.code ?? "").toLowerCase().includes(q) || String(leaf.name ?? "").toLowerCase().includes(q);
      const dimMatch = (leaf.children || []).some(d =>
        String(d.code ?? "").toLowerCase().includes(q) ||
        String(d.name ?? "").toLowerCase().includes(q));
      if (leafMatch || dimMatch) {
        descendantMatch = true;
        if (dimMatch) result[`bsdrill-leaf-${drillContextKey}-${depth}-${i}`] = true;
      }
    });
    return matchesSelf(node, q) || descendantMatch;
  };
  bsRoots.forEach(top => {
    const initialKey = `bsrow-${top.code}`;
    if (walk(top, initialKey, 0)) {
      result[initialKey] = true;
      result[`bsmulti-${top.code}`] = true;
    }
  });
  return result;
}, [debouncedQuery, bsRoots, matchesSelf, pgcBsMapping, bsView, bsPgcSummaryNodes, bsPgcAllSumNodes, groupAccounts, savedBsLiteral, tree]);

const isOpen = useCallback((key) => {
  if (searchExpansionMap?.[key]) return true;
  if (key in bsDrillMap) return !!bsDrillMap[key];
  return false;
}, [bsDrillMap, searchExpansionMap]);

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

function renderBSCompareRows(nodes, cmpTree, cmp2Tree, cmp3Tree) {
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

const renderFlatNodeCmp = (node, depth) => {
        const actual = isPGC_BS(node.code) ? -sumNode(node) : sumNode(node);
        const cmpRaw = getNodeValue(cmpTree, node.code);
        const cmp = isPGC_BS(node.code) ? -cmpRaw : cmpRaw;
        const cmp2Raw = getNodeValue(cmp2Tree, node.code);
        const cmp2 = isPGC_BS(node.code) ? -cmp2Raw : cmp2Raw;

 const drillKeyCmp = `bsrow-${node.code}`;
        const flatChildrenCmp = childrenInFlat.get(String(node.code)) || [];
        const treeChildrenCmp = (node.children || []).filter(hasData);
        const hasNonFlatCmp = treeChildrenCmp.some(c => !flatByCode.has(String(c.code)));
        const hasLeavesCmp = (node.uploadLeaves || []).some(l => l.type !== "plain");
        const hasJournalCmp = (journalByCode.get(node.code) || []).length > 0;
        const hasMoreCmp = flatChildrenCmp.length > 0 || hasNonFlatCmp || hasLeavesCmp || hasJournalCmp;
        const expandedCmp = isOpen(drillKeyCmp);
        const divider = effectiveBreakersBs[String(node.code)];
if (divider) {
          rows.push(
            <tr key={`bsdivider-${node.code}`}>
              <td style={{ backgroundColor: divider.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
                <span className="uppercase tracking-widest" style={header3Style}>{divider.label}</span>
              </td>
<td colSpan={2 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (compareMode && cmp2Enabled && cmp3Enabled ? 3 : 0) + (historyExpanded ? bsHistoryProcessed.length : 0)} style={{ backgroundColor: divider.color }} />
            </tr>
          );
        }

const rowStyleCmp = depth === 0 ? body1Style : body2Style;
const isMatchSelf = (() => {
          const q = debouncedQuery.trim().toLowerCase();
          if (!q) return false;
          return String(node.code ?? "").toLowerCase().includes(q) || String(localName(node) ?? "").toLowerCase().includes(q);
        })();
        rows.push(
  <tr key={node.code}
    className={`border-b border-gray-100 ${isMatchSelf ? "bg-[#fef3c7]" : "bg-white"} ${hasMoreCmp ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
    onClick={hasMoreCmp ? () => bsDrill(drillKeyCmp) : undefined}>
<td className="py-2.5 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 18}px` }}>
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
    {cmp2Enabled && cmp3Enabled && (() => {
      const cmp3Raw = getNodeValue(cmp3Tree, node.code);
      const cmp3Val = isPGC_BS(node.code) ? -cmp3Raw : cmp3Raw;
      return <>
        <BSAmountCell value={cmp3Val} typoStyle={rowStyleCmp} divider />
        <BSDeviationCells a={actual} b={cmp3Val} typoStyle={rowStyleCmp} />
      </>;
    })()}
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
      const kids = (node.children || []).filter(hasData).filter(c => c.level <= 4);

const BS_DIVIDERS = Object.keys(breakers.bs).length
  ? effectiveBreakersBs
  : { '399999': { label: "Activo", color: colors.primary }, '499999': { label: "Patrimonio Neto", color: colors.secondary }, '699999': { label: "Pasivo", color: colors.tertiary }, 'C.ACT': { label: "Activo", color: colors.primary }, 'D.S': { label: "Patrimonio Neto", color: colors.secondary }, 'E.S': { label: "Pasivo", color: colors.tertiary } };
      const bsDivider = BS_DIVIDERS[String(node.code)];
if (bsDivider) {
        rows.push(
          <tr key={`bsdivider-${node.code}`}>
            <td style={{ backgroundColor: bsDivider.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
              <span className="uppercase tracking-widest" style={header3Style}>{bsDivider.label}</span>
            </td>
           <td colSpan={(cmp2Enabled ? (cmp3Enabled ? 11 : 8) : 5)} style={{ backgroundColor: bsDivider.color }} />
          </tr>
        );
      }

      if (kids.length > 0) rows.push(...renderBSCompareRows(kids, cmpTree, cmp2Tree));

      const actual = Number(node.code) >= 599999 ? -sumNode(node) : sumNode(node);
      const cmpRaw = getNodeValue(cmpTree, node.code);
      const cmp = Number(node.code) >= 599999 ? -cmpRaw : cmpRaw;
      const cmp2Raw = getNodeValue(cmp2Tree, node.code);
      const cmp2 = Number(node.code) >= 599999 ? -cmp2Raw : cmp2Raw;
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
    {cmp2Enabled && cmp3Enabled && (() => {
      const cmp3Raw = getNodeValue(cmp3Tree, node.code);
      const cmp3Val = Number(node.code) >= 599999 ? -cmp3Raw : cmp3Raw;
      return <>
        <BSAmountCell value={cmp3Val} typoStyle={body1Style} divider />
        <BSDeviationCells a={actual} b={cmp3Val} typoStyle={body1Style} />
      </>;
    })()}
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

const sumLiteralLeaf = (node) => {
      let total = 0;
      if (node.dims && node.dims.length > 0) {
        node.dims.forEach(d => { total += dimIdx.get(`${node.code}|${d}`) ?? 0; });
      } else {
        total = accIdx.get(node.code) ?? 0;
      }
      return total;
    };
    const sumLiteral = (node) => {
      if (node.isSum && node.children && node.children.length > 0) {
        return node.children.reduce((s, c) => s + sumLiteral(c), 0);
      }
      return sumLiteralLeaf(node);
    };

    // Per-leaf+dim indexes for BS saved-mapping compare periods
    const buildBsSavedLeafDimIdx = (rows) => {
      const m = new Map();
      (rows || []).forEach(row => {
        const lac = String(getField(row, "localAccountCode") ?? "");
        const dc  = String(getField(row, "dimensionCode") ?? "");
        if (!lac || !dc || dc === "null") return;
        const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
        m.set(`${lac}|${dc}`, (m.get(`${lac}|${dc}`) ?? 0) + amt);
      });
      return m;
    };
    const bsBLeafDimIdxSaved = compareMode ? buildBsSavedLeafDimIdx(cmpData) : new Map();
    const bsCLeafDimIdxSaved = compareMode && cmp2Enabled ? buildBsSavedLeafDimIdx(cmp2Data) : new Map();
    const bsDLeafDimIdxSaved = compareMode && cmp2Enabled && cmp3Enabled ? buildBsSavedLeafDimIdx(cmp3Data) : new Map();

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
    const cmp3AccIdxBs = new Map();
    const cmp3DimIdxBs = new Map();
    (cmp3Data || []).forEach(row => {
      const code = String(getField(row, "accountCode") ?? "");
      if (!code) return;
      const amt = parseAmt(getField(row, "AmountYTD", "amountYTD", "AmountPeriod", "amountPeriod"));
      cmp3AccIdxBs.set(code, (cmp3AccIdxBs.get(code) ?? 0) + amt);
      const dimsStr = String(getField(row, "Dimensions", "dimensions") ?? "");
      if (!dimsStr) return;
      dimsStr.split("||").map(s => s.trim()).filter(Boolean).forEach(pair => {
        const i = pair.indexOf(":");
        if (i === -1) return;
        const g = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        cmp3DimIdxBs.set(`${code}|${g}:${v}`, (cmp3DimIdxBs.get(`${code}|${g}:${v}`) ?? 0) + amt);
      });
    });
const sumLiteralBSGenericLeaf = (node, accIdxLoc, dimIdxLoc) => {
      let total = 0;
      if (node.dims && node.dims.length > 0) {
        node.dims.forEach(d => { total += dimIdxLoc.get(`${node.code}|${d}`) ?? 0; });
      } else {
        total = accIdxLoc.get(node.code) ?? 0;
      }
      return total;
    };
    const sumLiteralBSGeneric = (node, accIdxLoc, dimIdxLoc) => {
      if (node.isSum && node.children && node.children.length > 0) {
        return node.children.reduce((s, c) => s + sumLiteralBSGeneric(c, accIdxLoc, dimIdxLoc), 0);
      }
      return sumLiteralBSGenericLeaf(node, accIdxLoc, dimIdxLoc);
    };
    const sumLiteralB = (node) => sumLiteralBSGeneric(node, cmpAccIdxBs, cmpDimIdxBs);
    const sumLiteralC = (node) => sumLiteralBSGeneric(node, cmp2AccIdxBs, cmp2DimIdxBs);
    const sumLiteralD = (node) => sumLiteralBSGeneric(node, cmp3AccIdxBs, cmp3DimIdxBs);

const bsCmpLabel = [cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource, cmpStructure].filter(Boolean).join(" · ") || t("period_b");
    const bsCmp2Label = [cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source, cmp2Structure].filter(Boolean).join(" · ") || t("period_c");

    return (
      <div className="space-y-3 flex flex-col" style={{ minHeight: 0, flex: 1, overflow: "visible" }}>
{compareMode && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
            style={{
              overflow: filtersOpen ? "visible" : "hidden",
              position: "relative",
              zIndex: 100,
              marginBottom: filtersOpen ? 12 : 0,
              flex: "0 0 auto",
              maxHeight: filtersOpen ? 800 : 0,
              opacity: filtersOpen ? 1 : 0,
              transition: "max-height 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease, margin-bottom 240ms ease",
            }}>
            <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
                  <span className="text-white text-[11px] font-black">B</span>
                </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
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
              <HeaderMultiFilterPill label={t("filter_dim_group").toUpperCase()} values={bsCmpDimGroups} onChange={vs => { setBsCmpDimGroups(vs); setBsCmpDimensions(null); }} options={dimGroups.map(g => ({ value: g, label: g }))} />
              <HeaderMultiFilterPill label={t("filter_dims")} values={bsCmpDimensions} onChange={vs => setBsCmpDimensions(vs)} options={bsCmpFilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
              {!cmp2Enabled && (
                <button onClick={() => setCmp2Enabled(true)}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
                  style={{ background: "linear-gradient(135deg, #57aa78 0%, #7bc795 100%)", boxShadow: "0 4px 14px -4px rgba(87,170,120,0.5)" }}>
                  <span className="text-white text-[10px] font-black">{t("add_period_c")}</span>
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
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
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
                <HeaderMultiFilterPill label={t("filter_dim_group").toUpperCase()} values={bsCmp2DimGroups} onChange={vs => { setBsCmp2DimGroups(vs); setBsCmp2Dimensions(null); }} options={dimGroups.map(g => ({ value: g, label: g }))} />
                <HeaderMultiFilterPill label={t("filter_dims")} values={bsCmp2Dimensions} onChange={vs => setBsCmp2Dimensions(vs)} options={bsCmp2FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
<button onClick={() => setCmp2Enabled(false)}
                  className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all duration-200 hover:scale-[1.05]"
                  style={{ background: "#fee2e2", color: "#dc2626" }}
                  title={t("remove_period_c")}>
                  <X size={12} strokeWidth={2.5} />
                </button>
                {!cmp3Enabled && (
                  <button onClick={() => setCmp3Enabled(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
                    style={{ background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)", boxShadow: "0 4px 14px -4px rgba(168,85,247,0.5)" }}>
                    <span className="text-white text-[10px] font-black">{t("add_period_d")}</span>
                  </button>
                )}
              </div>
            )}
            {cmp2Enabled && cmp3Enabled && (
              <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100">
                <div className="flex items-center gap-2 mr-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)", boxShadow: "0 4px 12px -4px rgba(168,85,247,0.5)" }}>
                    <span className="text-white text-[11px] font-black">D</span>
                  </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>{t("period_d")}</span>
                </div>
                <HeaderFilterPill label={t("filter_year")} value={cmp3Year} onChange={setCmp3Year}
                  options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
                <HeaderFilterPill label={t("filter_month")} value={cmp3Month} onChange={setCmp3Month}
                  options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
                <HeaderFilterPill label={t("filter_source")} value={cmp3Source} onChange={setCmp3Source}
                  options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
                <HeaderFilterPill label={t("filter_structure")} value={cmp3Structure} onChange={setCmp3Structure}
                  options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
                <HeaderFilterPill label={t("filter_company")} value={cmp3Company} onChange={setCmp3Company}
                  options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
                <HeaderMultiFilterPill label={t("filter_dim_group").toUpperCase()} values={bsCmp3DimGroups} onChange={vs => { setBsCmp3DimGroups(vs); setBsCmp3Dimensions(null); }} options={dimGroups.map(g => ({ value: g, label: g }))} />
                <HeaderMultiFilterPill label={t("filter_dims")} values={bsCmp3Dimensions} onChange={vs => setBsCmp3Dimensions(vs)} options={bsCmp3FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
                <button onClick={() => setCmp3Enabled(false)}
                  className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all"
                  style={{ background: "#fee2e2", color: "#dc2626" }}
                  title={t("remove_period_d")}>
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        )}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
          style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}>
          <div className="scrollbar-hide" style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0 }}>
<table className="w-full k-sticky-table">
<colgroup>
<col style={{ width: accColWidth ? `${accColWidth}px` : "auto" }} />
                {multiCompany
                  ? selectedCompanies.map(co => <col key={`bsmc-saved-col-${co}`} style={{ width: "180px" }} />)
                  : <col style={{ width: "160px" }} />}
{!multiCompany && compareMode && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
                {!multiCompany && compareMode && cmp2Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
               {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
                {!multiCompany && historyExpanded && bsHistoryProcessed.map(h => (
                  <col key={`bshist-col-${h.year}-${h.month}`} style={{ width: "140px" }} />
                ))}
                <col />
              </colgroup>
<thead>
<tr className="border-b border-gray-100" style={{
                  background: "rgba(255,255,255,0.98)",
                  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
                }}>
<th className="text-left px-6 whitespace-nowrap k-sticky-acc-head" style={{ height: "64px", position: "relative" }}>
                    <div className="k-acc-resize-handle" onMouseDown={startAccResize} title="Drag to resize column" />
                    <div className="flex items-center gap-5">
                      <div className="flex items-center gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
                        <button onClick={() => setSearchActive(a => !a)}
                          className="flex items-center justify-center"
                          style={{ background: "transparent", color: searchActive ? colors.primary : "#94a3b8", padding: 0, transition: "color 240ms" }}
                          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                          onMouseLeave={e => { e.currentTarget.style.color = searchActive ? colors.primary : "#94a3b8"; }}
                         title={t("table_search_placeholder")}>
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
                            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                        {searchActive ? (
                          <>
                            <input
                              ref={searchInputRef}
                              autoFocus
                              type="text"
                              value={searchQuery}
                              onChange={e => setSearchQuery(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Escape") {
                                  setSearchActive(false);
                                  setSearchQuery("");
                                }
                              }}
                              placeholder={t("search_code_or_name")}
                              style={{
                                fontSize: 16, fontWeight: 700, color: colors.primary,
                                border: "none", outline: "none", background: "transparent",
                                width: 240, padding: 0, letterSpacing: "-0.02em"
                              }}
                            />
                            <button onClick={() => { setSearchActive(false); setSearchQuery(""); }}
                              className="flex items-center justify-center ml-1"
                              style={{ background: "transparent", color: "#94a3b8", padding: 2, transition: "color 200ms" }}
                              onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                              onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
                              title={t("close_search")}>
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span onClick={() => setSearchActive(true)} className="font-black tracking-tight"
                              style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em", cursor: "pointer" }}>
                              {t("col_account")}
                            </span>
                            <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
                              {t("page_bs_full")}
                            </span>
</>
                        )}
                      </div>
<div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
                      {compareMode && (
                        <>
                          <button onClick={() => setFiltersOpen(o => !o)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                            style={{
                              background: "transparent",
                              color: filtersOpen ? colors.primary : "#94a3b8",
                              transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                            onMouseLeave={e => { e.currentTarget.style.color = filtersOpen ? colors.primary : "#94a3b8"; }}>
                            <ChevronDown size={10} style={{ transition: "transform 300ms cubic-bezier(0.34,1.56,0.64,1)", transform: filtersOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
                            <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? t("btn_hide") : t("btn_show")}</span>
                          </button>
                          <div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
                        </>
                      )}
<button onClick={(e) => {
                        e.stopPropagation();
                        if (Object.keys(bsDrillMap).some(k => k.startsWith('bssaved-') && bsDrillMap[k])) { setBsDrillMap({}); return; }
                        const next = {};
                        savedBsLiteral.forEach((section, secIdx) => {
                          const walk = (node, parentPath) => {
                            const rowKey = `bssaved-${secIdx}-${parentPath}-${node.id}`;
                            next[rowKey] = true;
                            (node.children || []).forEach(c => walk(c, `${parentPath}-${node.id}`));
                          };
                          section.nodes.forEach(n => walk(n, "root"));
                        });
                        setBsDrillMap(next);
                      }}
                        className="flex items-center justify-center"
                        style={{ background: "transparent", color: "#94a3b8", padding: 4, transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                        onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
title={Object.keys(bsDrillMap).some(k => k.startsWith('bssaved-') && bsDrillMap[k]) ? t("btn_collapse_all") : t("btn_expand_all")}>
                        <span key={Object.keys(bsDrillMap).some(k => k.startsWith('bssaved-') && bsDrillMap[k]) ? "collapse" : "expand"}
                          className="inline-flex"
                          style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                          {Object.keys(bsDrillMap).some(k => k.startsWith('bssaved-') && bsDrillMap[k])
                            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          }
                        </span>
</button>
                    </div>
                  </th>
{multiCompany ? selectedCompanies.map(co => (
                    <th key={`bsmc-saved-th-${co}`} className="text-center py-3 whitespace-nowrap k-sticky-head" style={{ width: "200px" }}>
                      <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{co}</span>
                    </th>
                  )) : (
<th className="text-center py-3 whitespace-nowrap k-sticky-head" style={{ width: "200px", cursor: compareMode ? "default" : "pointer" }}
                      onClick={compareMode ? undefined : toggleBSHistory}
                      title={compareMode ? "" : historyExpanded ? t("hide_history") : t("show_last_6_months")}>
                      <span className="font-black tracking-tight inline-block"
                        style={{ color: colors.primary, fontSize: 16, letterSpacing: "-0.02em", animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
                        {t("col_actual")}
                      </span>
                    </th>
                  )}
{compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
                      </div>
                      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{bsCmpLabel}</span>
                    </div>
                  </th>}
{compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
                    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
                      </div>
<span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{bsCmp2Label}</span>
                    </div>
                  </th>}
                  {compareMode && cmp2Enabled && cmp3Enabled && (() => {
const bsCmp3Label = [cmp3Year, MONTHS.find(m => String(m.value) === String(cmp3Month))?.label, cmp3Source].filter(Boolean).join(" · ") || t("period_d");
                    return <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#a855f7" }} />
                          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>{t("period_d")}</span>
                        </div>
                        <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{bsCmp3Label}</span>
                      </div>
                    </th>;
                  })()}
{historyExpanded && bsHistoryProcessed.map(h => (
                    <th key={`bshist-saved-${h.year}-${h.month}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
                      <div className="flex flex-col items-center">
                        <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>
                          {MONTHS.find(m => m.value === h.month)?.label.slice(0,3)}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: "#9ca3af" }}>{h.year}</span>
                      </div>
                    </th>
                  ))}
<th className="text-right pr-6 py-3" style={{ background: "transparent" }}>
                    <div className="flex items-center justify-centergap-2" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
                      {compareMode && (
                        <button onClick={() => setFiltersOpen(o => !o)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
                          style={{ background: filtersOpen ? `${colors.primary}12` : "transparent", color: filtersOpen ? colors.primary : "#9ca3af" }}>
                          <ChevronDown size={10} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
                          <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? t("btn_hide") : t("btn_show")}</span>
                        </button>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
{(() => {
                const treeByCode = new Map();
                (function indexTree(nodes) {
                  nodes.forEach(n => { treeByCode.set(String(n.code), n); indexTree(n.children || []); });
                })(tree);
                return savedBsLiteral.map((section, secIdx) => {
                const rows = [];
if (section.label) {
const dividerColSpan = multiCompany
                    ? 1 + selectedCompanies.length + 1
                    : 3 + (compareMode ? 3 : 0) + (compareMode && cmp2Enabled ? 3 : 0) + (compareMode && cmp2Enabled && cmp3Enabled ? 3 : 0) + (historyExpanded ? bsHistoryProcessed.length : 0);
rows.push(
                    <tr key={`bssec-${secIdx}`} style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}>
                      <td style={{ backgroundColor: section.color, position: "sticky", left: 0, zIndex: 4 }} className="px-6 py-1.5 whitespace-nowrap">
                        <span className="uppercase tracking-widest" style={header3Style}>{section.label}</span>
                      </td>
                      <td colSpan={dividerColSpan - 1} style={{ backgroundColor: section.color }} />
                    </tr>
                  );
                }
const renderNode = (node, depth, parentPath) => {
const displayVal = sumLiteral(node);
                  const rowStyle = depth === 0 ? body1Style : body2Style;
const rowKey = `bssaved-${secIdx}-${parentPath}-${node.id}`;
                  const gaNodeForKids = treeByCode.get(String(node.code));
                  const leavesCount = (gaNodeForKids?.uploadLeaves || []).filter(l => l.type !== "plain").length;
                  const hasKids = (node.children && node.children.length > 0) || leavesCount > 0;
                  const expanded = isOpen(rowKey);
                  const isMatchSelf = (() => {
                    const q = debouncedQuery.trim().toLowerCase();
                    if (!q) return false;
                    return String(node.code ?? "").toLowerCase().includes(q) || String(node.name ?? "").toLowerCase().includes(q);
                  })();
                  rows.push(
                    <tr key={rowKey}
                      className={`border-b border-gray-100 ${isMatchSelf ? "bg-[#fef3c7]" : "bg-white"} ${hasKids ? "cursor-pointer" : ""} hover:bg-[#eef1fb]/60 transition-colors`}
                      onClick={hasKids ? (e) => { e.stopPropagation(); bsDrill(rowKey); } : undefined}
                      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rows.length, 25) * 40}ms both` }}>
<td className="py-2.5 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + depth * 18}px` }}>
                        <div className="flex items-center">
                          {hasKids
                            ? <span className="text-[#1a2f8a]/50 mr-2">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
                            : <span className="inline-block mr-2" style={{ width: 12 }} />}
                          {node.code && <span className="mr-2 font-mono text-gray-400" style={subbody2Style}>{node.code}</span>}
                          <span style={rowStyle}>
                            {node.name ? (node.name.charAt(0).toUpperCase() + node.name.slice(1).toLowerCase()) : node.code}
                          </span>
                        </div>
                      </td>
{multiCompany ? selectedCompanies.map(co => (
                        <BSAmountCell key={`bsmc-saved-${node.id}-${co}`} value={getBsValForCompany(node.code, co)} typoStyle={rowStyle} centered />
                      )) : (
                        <>
                          <BSAmountCell value={displayVal} typoStyle={rowStyle} />
{compareMode && (() => {
                            const cmpVal = sumLiteralB(node);
                            return (
                              <>
                                <BSAmountCell value={cmpVal} typoStyle={rowStyle} divider />
                                <BSDeviationCells a={displayVal} b={cmpVal} typoStyle={rowStyle} />
                              </>
                            );
                          })()}
{compareMode && cmp2Enabled && (() => {
                            const cmp2Val = sumLiteralC(node);
                            return (
                              <>
                                <BSAmountCell value={cmp2Val} typoStyle={rowStyle} divider />
                                <BSDeviationCells a={displayVal} b={cmp2Val} typoStyle={rowStyle} />
                              </>
                            );
                          })()}
{compareMode && cmp2Enabled && cmp3Enabled && (() => {
                            const cmp3Val = sumLiteralD(node);
                            return (
                              <>
                                <BSAmountCell value={cmp3Val} typoStyle={rowStyle} divider />
                                <BSDeviationCells a={displayVal} b={cmp3Val} typoStyle={rowStyle} />
                              </>
                            );
                          })()}
{historyExpanded && bsHistoryProcessed.map(h => {
                            const computeBsHistForNode = (nd) => {
                              if (nd.isSum && Array.isArray(nd.children) && nd.children.length > 0) {
                                return nd.children.reduce((s, c) => s + computeBsHistForNode(c), 0);
                              }
                              const histNode = h.map.get(String(nd.code));
                              if (!histNode) return 0;
                              const raw = sumNode(histNode);
                              return Number(nd.code) >= 599999 ? -raw : raw;
                            };
                            const histVal = computeBsHistForNode(node);
                            return <BSAmountCell key={`bshist-saved-${h.year}-${h.month}-${node.id}`} value={histVal} typoStyle={rowStyle} centered />;
                          })}
                        </>
                      )}
</tr>
                  );
                  if (expanded) {
                    (node.children || []).forEach(c => renderNode(c, depth + 1, `${parentPath}-${node.id}`));

                    // Render uploadLeaves from the matching group-account
                    const gaNode = treeByCode.get(String(node.code));
                    const leaves = (gaNode?.uploadLeaves || []).filter(l => l.type !== "plain");
                    leaves.forEach((leaf, i) => {
                      const leafKey = `${rowKey}-leaf-${i}`;
                      const leafExpanded = isOpen(leafKey);
                      const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
                      const amt = leaf.amount ?? 0;
                      const leafIsMatch = (() => {
                        const q = debouncedQuery.trim().toLowerCase();
                        if (!q) return false;
                        return String(leaf.code ?? "").toLowerCase().includes(q) || String(leaf.name ?? "").toLowerCase().includes(q);
                      })();
                      rows.push(
                        <tr key={leafKey}
                          className={`border-b border-[#1a2f8a]/5 ${leafIsMatch ? "bg-[#fef3c7]" : "bg-[#fafbff]"} transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/40" : "hover:bg-[#eef1fb]/20"}`}
                          onClick={hasDims ? () => bsDrill(leafKey) : undefined}>
                          <td className="py-1.5 whitespace-nowrap k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 18}px` }}>
                            <div className="flex items-center">
                              {hasDims
                                ? <span className="text-[#1a2f8a]/50 mr-2">{leafExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
                                : <span className="inline-block mr-2" style={{ width: 12 }} />}
                              {leaf.code && <span className="font-mono text-gray-400 mr-2" style={subbody2Style}>{leaf.code}</span>}
                              <span style={subbody1Style}>{leaf.name || ""}</span>
                            </div>
                          </td>
{multiCompany ? selectedCompanies.map(co => (
                            <BSAmountCell key={`bsmc-saved-leaf-${leaf.code ?? "noleaf"}-${co}-${i}`} value={leaf.code ? (perCompanyBsLeafIdx?.get(co)?.get(String(leaf.code)) ?? 0) : 0} typoStyle={subbody1Style} centered />
                          )) : (
                            <>
                              <BSAmountCell value={amt} typoStyle={subbody1Style} />
                              {compareMode && (() => {
                                const cmpAmt = leaf.code ? (bsCmpLeafIndex.get(String(leaf.code)) ?? 0) : 0;
                                return <>
                                  <BSAmountCell value={cmpAmt} typoStyle={subbody1Style} divider />
                                  <BSDeviationCells a={amt} b={cmpAmt} typoStyle={subbody1Style} />
{cmp2Enabled && (() => {
                                    const cmp2Amt = leaf.code ? (bsCmp2LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                                    return <>
                                      <BSAmountCell value={cmp2Amt} typoStyle={subbody1Style} divider />
                                      <BSDeviationCells a={amt} b={cmp2Amt} typoStyle={subbody1Style} />
                                    </>;
                                  })()}
                                  {cmp2Enabled && cmp3Enabled && (() => {
                                    const cmp3Amt = leaf.code ? (bsCmp3LeafIndex.get(String(leaf.code)) ?? 0) : 0;
                                    return <>
                                      <BSAmountCell value={cmp3Amt} typoStyle={subbody1Style} divider />
                                      <BSDeviationCells a={amt} b={cmp3Amt} typoStyle={subbody1Style} />
                                    </>;
                                  })()}
                                </>;
                              })()}
                              {historyExpanded && !compareMode && bsHistoryProcessed.map(h => {
                                const leafAmt = leaf.code ? (h.leafIdx.get(String(leaf.code)) ?? 0) : 0;
                                return <BSAmountCell key={`bshist-saved-leaf-${h.year}-${h.month}-${i}`} value={leafAmt} typoStyle={subbody1Style} centered />;
                              })}
                            </>
                          )}
                        </tr>
                      );
                      if (leafExpanded && hasDims) {
                        leaf.children.forEach((dim, j) => {
                          const dimIsMatch = (() => {
                            const q = debouncedQuery.trim().toLowerCase();
                            if (!q) return false;
                            return String(dim.code ?? "").toLowerCase().includes(q) || String(dim.name ?? "").toLowerCase().includes(q);
                          })();
                          rows.push(
<tr key={`${leafKey}-dim-${j}`}
                              className={`border-b border-[#1a2f8a]/5 ${dimIsMatch ? "bg-[#fef3c7]" : "bg-amber-50/10"} hover:bg-amber-50/40 transition-colors cursor-pointer`}
                              onClick={() => setDimPopup(dim)}>
                              <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 18}px` }}>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
                                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_dim")}</span>
                                  <span className="text-xs text-gray-400 italic">{dim.name || dim.code}</span>
                                </div>
                              </td>
{multiCompany ? selectedCompanies.map(co => (
                                <BSAmountCell key={`bsmc-saved-dim-${dim.code ?? "nocode"}-${co}-${j}`} value={leaf.code ? getBsDimValForCompany(leaf.code, dim.code, co) : 0} typoStyle={subbody2Style} centered />
                              )) : (
                                <>
                                  <BSAmountCell value={dim.amount} typoStyle={subbody2Style} />
{compareMode && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const v = bsBLeafDimIdxSaved.get(k) ?? 0;
  return <><BSAmountCell value={v} typoStyle={subbody2Style} divider /><BSDeviationCells a={dim.amount} b={v} typoStyle={subbody2Style} /></>;
})()}
{compareMode && cmp2Enabled && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const v = bsCLeafDimIdxSaved.get(k) ?? 0;
  return <><BSAmountCell value={v} typoStyle={subbody2Style} divider /><BSDeviationCells a={dim.amount} b={v} typoStyle={subbody2Style} /></>;
})()}
{compareMode && cmp2Enabled && cmp3Enabled && (() => {
  const k = `${leaf.code}|${dim.code}`;
  const v = bsDLeafDimIdxSaved.get(k) ?? 0;
  return <><BSAmountCell value={v} typoStyle={subbody2Style} divider /><BSDeviationCells a={dim.amount} b={v} typoStyle={subbody2Style} /></>;
})()}
                                  {historyExpanded && !compareMode && bsHistoryProcessed.map(h => (
                                    <td key={`bshist-saved-dim-${h.year}-${h.month}-${j}`} />
                                  ))}
                                </>
                              )}
                            </tr>
                          );
                        });
}
                    });

// ── Journal entries at NODE level (BS saved-mapping path) ──
                    if (node.code) {
                      const nodeJrns = journalByCode.get(String(node.code)) || [];
                      const hasHistJrns = bsHistoryProcessed.some(h => (h.jrnByCode?.get(String(node.code)) || []).length > 0);
                      if (nodeJrns.length > 0 || hasHistJrns) {
                        const jrnKey = `${rowKey}-jrn`;
                        const jrnExpanded = isOpen(jrnKey);
rows.push(
                          <tr key={jrnKey}
                            className="border-b border-[#1a2f8a]/5 cursor-pointer hover:bg-indigo-50/50 transition-colors bg-indigo-50/20"
                            onClick={() => bsDrill(jrnKey)}>
                            <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 18}px` }}>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
                                <span className="text-[#1a2f8a]/40 flex-shrink-0">{jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
                                <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">{t("label_journal")}</span>
                               <span className="text-[10px] text-gray-400">{nodeJrns.length} {nodeJrns.length === 1 ? t("entry") : t("entries")}</span>
                              </div>
                            </td>
                            {multiCompany ? selectedCompanies.map(co => <td key={`bsmc-saved-jhdr-${node.code}-${co}`} />) : <td />}
                            {!multiCompany && compareMode && <><td /><td /><td /></>}
                            {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                            {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                            {!multiCompany && historyExpanded && bsHistoryProcessed.map(h => {
                              const histEntries = h.jrnByCode?.get(String(node.code)) || [];
                              const histAmt = histEntries.reduce((acc, je) => acc + parseAmt(je.amountYTD ?? je.AmountYTD ?? 0), 0);
                              return <BSAmountCell key={`bshist-saved-jhdr-${h.year}-${h.month}-${node.code}`} value={histAmt} typoStyle={subbody2Style} centered />;
                            })}
                          </tr>
                        );
if (jrnExpanded) {
                          // Build unified list: current period entries + each history month's own entries
                          const allJrnRows = [];
                          nodeJrns.forEach(jrn => allJrnRows.push({ jrn, source: 'current' }));
                          if (historyExpanded) {
                            bsHistoryProcessed.forEach(h => {
                              const hjrns = h.jrnByCode?.get(String(node.code)) || [];
                              hjrns.forEach(jrn => allJrnRows.push({ jrn, source: `hist-${h.year}-${h.month}` }));
                            });
                          }
                          allJrnRows.forEach(({ jrn, source: jsrc }, k) => {
                            const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
                            rows.push(
                              <tr key={`${jrnKey}-entry-${k}`}
                                className="border-b border-[#1a2f8a]/5 hover:bg-indigo-50/40 transition-colors bg-indigo-50/10 cursor-pointer"
                                onClick={() => setJrnPopup(jrn)}>
                                <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 18}px` }}>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-px bg-indigo-100 flex-shrink-0" />
                                    <span className="text-[10px] font-mono text-indigo-400 flex-shrink-0">{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
                                    <span className="text-[10px] text-gray-400 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader ?? ""}</span>
                                    {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-300 italic truncate max-w-[200px]">{jrn.rowText ?? jrn.RowText}</span>}
                                  </div>
                                </td>
{multiCompany ? selectedCompanies.map(co => {
                                  const jrnCo = String(jrn.companyShortName ?? jrn.CompanyShortName ?? "");
                                  const v = jrnCo === co ? amt : 0;
                                  return <BSAmountCell key={`bsmc-saved-jentry-${node.code}-${co}-${k}`} value={v} typoStyle={subbody2Style} centered />;
                                }) : <BSAmountCell value={jsrc === 'current' ? amt : 0} typoStyle={subbody2Style} />}
                                {!multiCompany && compareMode && <><td /><td /><td /></>}
                                {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                                {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                                {!multiCompany && historyExpanded && bsHistoryProcessed.map(h => {
                                  // Show amount only in this row's own month column
                                  const v = jsrc === `hist-${h.year}-${h.month}` ? amt : 0;
                                  return <BSAmountCell key={`bshist-saved-jentry-${h.year}-${h.month}-${node.code}-${k}`} value={v} typoStyle={subbody2Style} centered />;
                                })}
                              </tr>
                            );
});

                          // ── Compare-period-only journals (B/C/D not in A) ──
                          if (compareMode) {
                            const aNums = new Set(nodeJrns.map(j => j.journalNumber ?? j.JournalNumber));
                            const seen = new Map();
                            const collect = (idx, period) => {
                              (idx.get(String(node.code)) || []).forEach(j => {
                                const num = j.journalNumber ?? j.JournalNumber;
                                if (aNums.has(num)) return;
                                if (!seen.has(num)) seen.set(num, { jrn: j, periods: { B: null, C: null, D: null } });
                                seen.get(num).periods[period] = parseAmt(j.amountYTD ?? j.AmountYTD ?? 0);
                              });
                            };
                            collect(journalByCodeCmp, 'B');
                            if (cmp2Enabled) collect(journalByCodeCmp2, 'C');
                            if (cmp2Enabled && cmp3Enabled) collect(journalByCodeCmp3, 'D');
                            seen.forEach((entry, num) => {
                              ['B','C','D'].forEach(p => {
                                if (entry.periods[p] != null) return;
                                const idx = p === 'B' ? journalByCodeCmp : p === 'C' ? journalByCodeCmp2 : journalByCodeCmp3;
                                const match = (idx.get(String(node.code)) || []).find(j => (j.journalNumber ?? j.JournalNumber) === num);
                                if (match) entry.periods[p] = parseAmt(match.amountYTD ?? match.AmountYTD ?? 0);
                              });
                            });
                            const extras = [...seen.entries()];
                            if (extras.length > 0) {
                              rows.push(
                                <tr key={`${jrnKey}-extra-hdr`}
                                  className="border-b border-[#1a2f8a]/5 bg-indigo-50/30">
                                  <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 1) * 18}px` }}>
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-2 h-px bg-indigo-300 flex-shrink-0" />
                                      <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-100 border border-indigo-200 px-1.5 py-0.5 rounded flex-shrink-0">B/C/D only</span>
                                     <span className="text-[10px] text-gray-400">{extras.length} {extras.length === 1 ? t("entry") : t("entries")}</span>
                                    </div>
                                  </td>
                                  {multiCompany ? selectedCompanies.map(co => <td key={`bsmc-saved-jxhdr-${node.code}-${co}`} />) : <td />}
                                  {!multiCompany && compareMode && <><td /><td /><td /></>}
                                  {!multiCompany && compareMode && cmp2Enabled && <><td /><td /><td /></>}
                                  {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><td /><td /><td /></>}
                                </tr>
                              );
                              extras.forEach(([num, entry], xi) => {
                                const jrn = entry.jrn;
                                rows.push(
                                  <tr key={`${jrnKey}-extra-${xi}`}
                                    className="border-b border-[#1a2f8a]/5 bg-indigo-50/10 hover:bg-indigo-50/40 transition-colors cursor-pointer"
                                    onClick={() => setJrnPopup(jrn)}>
                                    <td className="py-1 k-sticky-acc" style={{ paddingLeft: `${24 + (depth + 2) * 18}px` }}>
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-px bg-indigo-100 flex-shrink-0" />
                                        <span className="text-[10px] font-mono text-indigo-400 flex-shrink-0">{num ?? ""}</span>
                                        <span className="text-[10px] text-gray-400 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader ?? ""}</span>
                                        {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-300 italic truncate max-w-[200px]">{jrn.rowText ?? jrn.RowText}</span>}
                                      </div>
                                    </td>
                                    {multiCompany ? selectedCompanies.map(co => <td key={`bsmc-saved-jx-${node.code}-${co}-${xi}`} />) : <td className="text-right pr-4 py-1 text-gray-300" style={subbody2Style}>—</td>}
                                    {!multiCompany && compareMode && <><BSAmountCell value={entry.periods.B ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
                                    {!multiCompany && compareMode && cmp2Enabled && <><BSAmountCell value={entry.periods.C ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
                                    {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><BSAmountCell value={entry.periods.D ?? 0} typoStyle={subbody2Style} divider /><td /><td /></>}
                                  </tr>
                                );
                              });
                            }
                          }
                        }
                      }
                    }
                  }
                };
section.nodes.forEach(n => renderNode(n, 0, "root"));
                return rows;
              });
              })()}
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
<p className="text-gray-400 text-sm font-semibold">{t("waiting_for_data")}</p>
    </div>
  );

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
[t("jrn_account"), `${jrnPopup.AccountCode ?? jrnPopup.accountCode ?? ""} · ${jrnPopup.AccountName ?? jrnPopup.accountName ?? ""}`],
                [t("jrn_account_type"), jrnPopup.AccountType ?? jrnPopup.accountType],
                [t("jrn_journal_type"), jrnPopup.JournalType ?? jrnPopup.journalType],
                [t("jrn_journal_layer"), jrnPopup.JournalLayer ?? jrnPopup.journalLayer],
                [t("jrn_row_text"), jrnPopup.RowText ?? jrnPopup.rowText],
                [t("jrn_counterparty"), jrnPopup.CounterpartyShortName ?? jrnPopup.counterpartyShortName],
                [t("jrn_dimension"), jrnPopup.DimensionName ?? jrnPopup.dimensionName],
                [t("jrn_amount_ytd"), jrnPopup.AmountYTD ?? jrnPopup.amountYTD],
                [t("jrn_currency"), jrnPopup.CurrencyCode ?? jrnPopup.currencyCode],
                [t("jrn_period"), `${jrnPopup.Month ?? jrnPopup.month} / ${jrnPopup.Year ?? jrnPopup.year}`],
                [t("jrn_source"), jrnPopup.Source ?? jrnPopup.source],
                [t("jrn_company"), jrnPopup.CompanyShortName ?? jrnPopup.companyShortName],
                [t("jrn_system_generated"), (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === true ? t("cell_yes") : (jrnPopup.SystemGenerated ?? jrnPopup.systemGenerated) === false ? t("cell_no") : "—"],
                [t("jrn_posted"), (jrnPopup.Posted ?? jrnPopup.posted) === true ? t("cell_yes") : (jrnPopup.Posted ?? jrnPopup.posted) === false ? t("cell_no") : "—"],
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
                  <p className="text-white/60 text-[10px] font-medium uppercase tracking-widest">{t("dimension")}</p>
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
             {filtersOpen ? t("pl_hide_filters") : t("pl_show_filters")}
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
<GitMerge size={12} /> {t("btn_compare")}
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
{[["summary",t("view_summary")],["assets",t("bs_assets")],["equity",t("bs_equity_liab")]].map(([v, label]) => (
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
{compareMode && (
  <div className="bg-white rounded-2xl shadow-xl border border-gray-100"
    style={{
      overflow: filtersOpen ? "visible" : "hidden",
      position: "relative",
      zIndex: 100,
      marginBottom: filtersOpen ? 12 : 0,
      flex: "0 0 auto",
      maxHeight: filtersOpen ? 800 : 0,
      opacity: filtersOpen ? 1 : 0,
      transition: "max-height 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease, margin-bottom 240ms ease",
    }}>
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
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
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
<span className="text-white text-[10px] font-black">{t("add_period_c")}</span>
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
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
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
title={t("remove_period_c")}>
          <X size={12} strokeWidth={2.5} />
        </button>
        {!cmp3Enabled && (
          <button onClick={() => setCmp3Enabled(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-200 hover:scale-[1.03]"
            style={{
              background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)",
              boxShadow: "0 4px 14px -4px rgba(168,85,247,0.5)",
            }}>
            <span className="text-white text-[10px] font-black">{t("add_period_d")}</span>
          </button>
        )}
      </div>
    )}
    {cmp2Enabled && cmp3Enabled && (
      <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)", boxShadow: "0 4px 12px -4px rgba(168,85,247,0.5)" }}>
            <span className="text-white text-[11px] font-black">D</span>
          </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>{t("period_d")}</span>
        </div>
        <HeaderFilterPill label={t("filter_year")} value={cmp3Year} onChange={setCmp3Year}
          options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
        <HeaderFilterPill label={t("filter_month")} value={cmp3Month} onChange={setCmp3Month}
          options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
        <HeaderFilterPill label={t("filter_source")} value={cmp3Source} onChange={setCmp3Source}
          options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
        <HeaderFilterPill label={t("filter_structure")} value={cmp3Structure} onChange={setCmp3Structure}
          options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
        <HeaderFilterPill label={t("filter_company")} value={cmp3Company} onChange={setCmp3Company}
          options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); const l = typeof c === "object" ? (c.companyLegalName ?? c.CompanyLegalName ?? v) : String(c); return { value: v, label: l }; })} />
        <HeaderMultiFilterPill label={t("filter_dim_group")} values={bsCmp3DimGroups} onChange={vs => { setBsCmp3DimGroups(vs); setBsCmp3Dimensions(null); }}
          options={dimGroups.map(g => ({ value: g, label: g }))} />
        <HeaderMultiFilterPill label={t("filter_dims")} values={bsCmp3Dimensions} onChange={vs => setBsCmp3Dimensions(vs)}
          options={bsCmp3FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })} />
        <button onClick={() => setCmp3Enabled(false)}
          className="ml-auto flex items-center justify-center w-7 h-7 rounded-xl transition-all duration-200 hover:scale-[1.05]"
          style={{ background: "#fee2e2", color: "#dc2626" }}
title={t("remove_period_d")}>
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    )}
  </div>
)}

{/* Table */}


<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col" style={{ maxHeight: "100%", minHeight: 0, boxShadow: "0 20px 40px -8px rgba(26, 47, 138, 0.15), 0 4px 12px -2px rgba(26, 47, 138, 0.08)" }}>
<div className="scrollbar-hide" style={{ overflowX: "auto", overflowY: "auto", maxHeight: !compareMode ? "calc(86vh)" : filtersOpen ? cmp2Enabled ? "calc(72.5vh)" : "calc(79.5vh)" : "calc(85.5vh)" }}>
<table className="w-full k-sticky-table">
<colgroup>
  <col style={{ width: accColWidth ? `${accColWidth}px` : "auto" }} />
            {multiCompany
              ? selectedCompanies.map(co => <col key={`bsmc-col-${co}`} style={{ width: "180px" }} />)
              : <col style={{ width: "160px" }} />}
{!multiCompany && compareMode && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
           {!multiCompany && compareMode && cmp2Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
            {!multiCompany && compareMode && cmp2Enabled && cmp3Enabled && <><col style={{ width: "160px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /></>}
            <col />
          </colgroup>
<thead>
{(pgcBsMapping || bsView === "summary") ? (
<tr className="border-b border-gray-100" style={{
  background: "rgba(255,255,255,0.98)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
<th className="text-left px-6 whitespace-nowrap k-sticky-acc-head" style={{ height: "64px", position: "relative" }}>
                    <div className="k-acc-resize-handle" onMouseDown={startAccResize} title="Drag to resize column" />
    <div className="flex items-center gap-5">
      <div className="flex items-center gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
        <button onClick={() => setSearchActive(a => !a)}
          className="flex items-center justify-center"
          style={{ background: "transparent", color: searchActive ? colors.primary : "#94a3b8", padding: 0, transition: "color 240ms" }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
          onMouseLeave={e => { e.currentTarget.style.color = searchActive ? colors.primary : "#94a3b8"; }}
title={t("table_search_placeholder")}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
        {searchActive ? (
          <>
            <input
              ref={searchInputRef}
              autoFocus
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  setSearchActive(false);
                  setSearchQuery("");
                }
              }}
           placeholder={t("search_code_or_name")}
              style={{
                fontSize: 16, fontWeight: 700, color: colors.primary,
                border: "none", outline: "none", background: "transparent",
                width: 240, padding: 0, letterSpacing: "-0.02em"
              }}
            />
            <button onClick={() => { setSearchActive(false); setSearchQuery(""); }}
              className="flex items-center justify-center ml-1"
              style={{ background: "transparent", color: "#94a3b8", padding: 2, transition: "color 200ms" }}
              onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
       title={t("close_search")}>
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <span onClick={() => setSearchActive(true)} className="font-black tracking-tight"
              style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em", cursor: "pointer" }}>
              {t("col_account")}
            </span>
            <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
              {t("page_bs_full")}
            </span>
          </>
        )}
      </div>
     <div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
<div className="flex items-center gap-4" style={{ flexDirection: "row-reverse" }}>
<button onClick={() => {
          if (Object.keys(bsDrillMap).some(k => !k.startsWith('bssaved-') && bsDrillMap[k])) { setBsDrillMap({}); return; }
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
className="flex items-center justify-center"
          style={{ background: "transparent", color: "#94a3b8", padding: 4, transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
title={Object.keys(bsDrillMap).some(k => !k.startsWith('bssaved-') && bsDrillMap[k]) ? t("btn_collapse_all") : t("btn_expand_all")}>
          <span key={Object.keys(bsDrillMap).some(k => !k.startsWith('bssaved-') && bsDrillMap[k]) ? "collapse" : "expand"}
            className="inline-flex"
            style={{ animation: "iconMorph 360ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            {Object.keys(bsDrillMap).some(k => !k.startsWith('bssaved-') && bsDrillMap[k])
              ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L6 6M3 3L6 6M9 9L6 6M3 9L6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 2L10 4M2 8L6 10L10 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </span>
        </button>
<div className="relative flex items-center"
          ref={el => {
            if (!el) return;
            const tabs = el.querySelectorAll("[data-bs-tab]");
            const idx = ["summary","assets","equity"].indexOf(bsView);
            const active = tabs[idx >= 0 ? idx : 0];
            const indicator = el.querySelector(".bs-view-indicator");
            if (active && indicator) {
              indicator.style.left = active.offsetLeft + "px";
              indicator.style.width = active.offsetWidth + "px";
            }
          }}>
          <span className="bs-view-indicator" style={{
            position: "absolute",
            bottom: -4,
            height: 2,
            background: colors.primary,
            borderRadius: 1,
            transition: "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), width 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            pointerEvents: "none",
          }} />
{[["summary",t("view_summary")],["assets",t("bs_assets")],["equity",t("bs_equity_liab")]].map(([v, label]) => {
            const active = bsView === v;
            return (
              <button key={v} data-bs-tab onClick={() => setBsView(v)}
                className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] whitespace-nowrap"
                style={{
                  background: "transparent",
                  color: active ? colors.primary : "#94a3b8",
                  transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}>
                {label}
              </button>
            );
          })}
        </div>
        {compareMode && (
          <>
            <div style={{ width: 1, height: 18, background: "#e5e7eb", flexShrink: 0 }} />
            <button onClick={() => setFiltersOpen(o => !o)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{
                background: "transparent",
                color: filtersOpen ? colors.primary : "#94a3b8",
                transition: "color 240ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={e => { e.currentTarget.style.color = filtersOpen ? colors.primary : "#94a3b8"; }}>
              <ChevronDown size={10} style={{ transition: "transform 300ms cubic-bezier(0.34,1.56,0.64,1)", transform: filtersOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
              <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? t("btn_hide") : t("btn_show")}</span>
            </button>
          </>
        )}
      </div>
    </div>
  </th>
{multiCompany ? selectedCompanies.map(co => (
  <th key={`bsmc-th-${co}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
    <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em" }}>{co}</span>
  </th>
)) : (
<th className="text-center py-3 whitespace-nowrap"
  style={{ background: "transparent", width: "200px", cursor: (compareMode || multiCompany) ? "default" : "pointer" }}
  onClick={toggleBSHistory}
 title={(compareMode || multiCompany) ? "" : historyExpanded ? t("hide_history") : t("show_last_6_months")}>
    <span className="font-black tracking-tight inline-block"
      style={{ color: colors.primary, fontSize: 16, letterSpacing: "-0.02em", animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
      {t("col_actual")}
    </span>
  </th>
)}
{historyExpanded && bsHistoryProcessed.map(h => (
    <th key={`bshist-${h.year}-${h.month}`} className="text-center py-3 whitespace-nowrap" style={{ background: "transparent", width: "200px" }}>
      <div className="flex flex-col items-center">
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
  {compareMode && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.26s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CF305D" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{t("period_b")}</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{[cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource].filter(Boolean).join(" · ")}</span>
    </div>
  </th>}
{compareMode && cmp2Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
    <div className="flex flex-col items-center" style={{ animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.30s both" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#57aa78" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#57aa78" }}>{t("period_c")}</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{[cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source].filter(Boolean).join(" · ")}</span>
    </div>
  </th>}
  {compareMode && cmp2Enabled && cmp3Enabled && <th colSpan={3} className="text-center pr-6 py-3 whitespace-nowrap k-sticky-head">
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#a855f7" }} />
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#a855f7" }}>{t("period_d")}</span>
      </div>
      <span className="text-[11px] font-semibold tracking-tight mt-0.5" style={{ color: "#9ca3af" }}>{[cmp3Year, MONTHS.find(m => String(m.value) === String(cmp3Month))?.label, cmp3Source].filter(Boolean).join(" · ")}</span>
    </div>
  </th>}
<th className="k-sticky-head" />
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
          {t("col_account")}
        </span>
        <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>
          {t("page_bs_full")}
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
            <span className="text-[9px] font-black uppercase tracking-wider">{filtersOpen ? t("btn_hide") : t("btn_show")}</span>
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
          title={Object.values(bsDrillMap).some(Boolean) ? t("btn_collapse_all") : t("btn_expand_all")}>
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
{[["summary",t("view_summary")],["assets",t("bs_assets")],["equity",t("bs_equity_liab")]].map(([v, label]) => (
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
 {companyColumns.map(({ source }) => (
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
               ? <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">{t("no_bs_data")}</td></tr>
                : (compareMode ? renderBSCompareRows(bsRoots, cmpTree, cmp2Tree, cmp3Tree) : renderBSRows(bsRoots))
            ) : (
              bsView === "summary" ? (
                bsRoots.length === 0
                  ? <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">{t("no_bs_data")}</td></tr>
                  : (compareMode ? renderBSCompareRows(bsRoots, cmpTree, cmp2Tree, cmp3Tree) : renderBSRows(bsRoots))
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

const AccountsDashboard = React.memo(function AccountsDashboard({ token, onNavigate, sources = [], structures = [], companies = [], dimensions = [] }) {
const { colors } = useSettings();
const { getLatestPeriod, setLatestPeriod } = useLatestPeriod();
const TABS = useTabs();
const t = useT();
const MONTHS = useMonths();
const locale = useLocale();

const [activeTab, setActiveTab]   = useState("pl");
const [prevTab, setPrevTab]       = useState(null);
const [animKey, setAnimKey]       = useState(0);
  const [dataSubTab, setDataSubTab] = useState("uploaded");
  const [ytdOnly, setYtdOnly]     = useState(false);  // ← lifted from PLStatement; PageHeader periodToggle controls this
const [plCmpLoading, setPlCmpLoading] = useState(false);
const [plCmp2Loading] = useState(false);
const [plCmp2Enabled, setPlCmp2Enabled] = useState(true);
const [bsCmp2Enabled, setBsCmp2Enabled] = useState(true);
const [plExpandedMap, setPlExpandedMap] = useState({});
const [accColWidth, setAccColWidth] = useState(null);
const [bsDrillMap, setBsDrillMap] = useState({});
const [plHistoryExpanded, setPlHistoryExpandedRaw] = useState(false);
const [bsHistoryExpanded, setBsHistoryExpandedRaw] = useState(false);
const setPlHistoryExpanded = (v) => {
  setPlHistoryExpandedRaw(v);
  setBsHistoryExpandedRaw(v);
  if (!v) { setPlHistoryMonths([]); setBsHistoryMonths([]); }
};
const setBsHistoryExpanded = (v) => {
  setBsHistoryExpandedRaw(v);
  setPlHistoryExpandedRaw(v);
  if (!v) { setPlHistoryMonths([]); setBsHistoryMonths([]); }
};


const [plHistoryMonths, setPlHistoryMonths] = useState([]);
const [bsHistoryMonths, setBsHistoryMonths] = useState([]);
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
const { access: resourceAccess } = useCurrentUserResourceAccess();
const filterByAccess = (items, kind, getId) => {
  const set = resourceAccess[kind];
  if (!set) return items;
  return items.filter(item => set.has(String(getId(item))));
};
const effectiveSources    = filterByAccess(sources.length    > 0 ? sources    : internalSources, "source", s => s.Source ?? s.source ?? s);
const effectiveStructures = filterByAccess(structures.length > 0 ? structures : internalStructures, "structure", s => s.GroupStructure ?? s.groupStructure ?? s);
const effectiveCompanies  = filterByAccess(companies.length  > 0 ? companies  : internalCompanies, "company", c => c.CompanyShortName ?? c.companyShortName ?? c.company ?? c.Company ?? c);
const effectiveDimensions = filterByAccess(dimensions.length > 0 ? dimensions : internalDimensions, "dimension", d => {
  const code = String(d.DimensionCode ?? d.dimensionCode ?? d.code ?? d.Code ?? "");
  const name = String(d.DimensionName ?? d.dimensionName ?? d.name ?? d.Name ?? code);
  return code || name;
});
 
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
const [upYear, setUpYear] = useState("");
  const [upMonth, setUpMonth] = useState("");
  // When the period changes while history is expanded, clear both history arrays
// so each side re-fetches against the new period (handles unmounted tab too).
const histPeriodRef = useRef(`${upYear}-${upMonth}`);
useEffect(() => {
  const current = `${upYear}-${upMonth}`;
  if (histPeriodRef.current === current) return;
  histPeriodRef.current = current;
  if (plHistoryExpanded || bsHistoryExpanded) {
    setPlHistoryMonths([]);
    setBsHistoryMonths([]);
  }
}, [upYear, upMonth, plHistoryExpanded, bsHistoryExpanded]);
  const [upSource, setUpSource] = useState("");
  const [upStructure, setUpStructure] = useState("");
const [upCompaniesRaw, setUpCompaniesRaw] = useState([]);
const upCompanies = useMemo(() => Array.isArray(upCompaniesRaw) ? upCompaniesRaw : [], [upCompaniesRaw]);
  const setUpCompanies = (v) => setUpCompaniesRaw(Array.isArray(v) ? v : []);
 const upCompany = upCompanies[0] ?? "";
const [upCompaniesDebounced, setUpCompaniesDebounced] = useState(upCompanies);
useEffect(() => {
  const t = setTimeout(() => setUpCompaniesDebounced(upCompanies), 300);
  return () => clearTimeout(t);
}, [upCompanies]);
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

// PGC, Spanish IFRS-ES and Danish IFRS use mapping tables (no legacy breakers needed)
  if (isPGC || isDanish || isSpanishIfrsEs) return;

  if (!isSpanishIFRS) return;

  breakersFetchedRef.current = true;

  const endpoint = `${SUPABASE_URL}/spanish_ifrs_breakers?select=*`;

  fetch(endpoint, { headers: sbHeaders })
    .then(r => r.ok ? r.json() : [])
    .catch(() => [])
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
  if (!grpData.length) { setDanishIfrsPlMapping(null); return; }

  const isPGC = grpData.some(n => {
    const c = String(n.accountCode ?? n.AccountCode ?? "");
    return /[a-zA-Z]/.test(c) && c.endsWith(".S");
  });
const isSpanishIfrsEs = !isPGC && grpData.some(n => /\.PL$/i.test(String(n.accountCode ?? n.AccountCode ?? "").trim()));
  const isSpanishIFRS = !isPGC && !isSpanishIfrsEs && grpData.some(n => /^[A-Z]\.\d/.test(String(n.accountCode ?? n.AccountCode ?? "")));
  const isDanish = !isPGC && !isSpanishIFRS && !isSpanishIfrsEs && grpData.some(n => /^\d{5,6}$/.test(String(n.accountCode ?? n.AccountCode ?? "")));

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
setDanishIfrsPlMapping({ rows, sections, names });
    })
    .catch(() => setDanishIfrsPlMapping(null));
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
const [reportMappings, setReportMappings] = useState([]);
const [reportMappingsLoading, setReportMappingsLoading] = useState(false);
const [reportMappingsError, setReportMappingsError] = useState(null);

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

const fetchReportMappings = useCallback(async () => {
  setReportMappingsLoading(true);
  setReportMappingsError(null);
  try {
    const { supabase } = await import("../../lib/supabaseClient");
    const { listMappings: listRpt } = await import("../../lib/reportMappingsApi");
    const { getActiveCompanyId } = await import("../../lib/mappingsApi");
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error("Not authenticated");
    const cid = await getActiveCompanyId(uid);
    if (!cid) throw new Error("No active company");
    const rows = await listRpt({ companyId: cid });
    setReportMappings(Array.isArray(rows) ? rows : []);
  } catch (e) {
    setReportMappingsError(e.message);
    setReportMappings([]);
  } finally {
    setReportMappingsLoading(false);
  }
}, []);

useEffect(() => {
  if (viewsMode === "report") fetchReportMappings();
}, [viewsMode, fetchReportMappings]);


const [activeMapping, setActiveMapping] = useState(null);
// activeMapping shape: { mapping_id, name, standard, plConverted, bsConverted } | null

const handleApplyMapping = useCallback((m, kind = "structure") => {
  setActiveMapping({
    mapping_id: m.mapping_id,
    kind,
    name: m.name,
    standard: m.standard,
    plConverted: convertSavedMappingTree(m.pl_tree),
    bsConverted: convertSavedMappingTree(m.bs_tree, { normalizeBS: true }),
    plLiteral: buildSavedMappingLiteral(m.pl_tree),
    bsLiteral: buildSavedMappingLiteral(m.bs_tree),
    highlightedIds: Array.isArray(m.highlighted_ids) ? new Set(m.highlighted_ids) : new Set(),
  });
}, []);

// Recent mappings for the PageHeader hover-dropdown quick-access
const [recentMappings, setRecentMappings] = useState([]);
useEffect(() => {
  (async () => {
    try {
      const { supabase } = await import("../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { listMappings, getActiveCompanyId } = await import("../../lib/mappingsApi");
      const { listMappings: listReportMappings } = await import("../../lib/reportMappingsApi");
      const cid = await getActiveCompanyId(uid);
      if (!cid) return;
      const [structRows, reportRows] = await Promise.all([
        listMappings({ companyId: cid }).catch(() => []),
        listReportMappings({ companyId: cid }).catch(() => []),
      ]);
      const combined = [
        ...(structRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "structure", updated_at: r.updated_at, raw: r })),
        ...(reportRows  || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "report",    updated_at: r.updated_at, raw: r })),
      ];
      setRecentMappings(combined);
    } catch (err) { console.error("[recent-mappings] error:", err); }
  })();
}, []);

// Auto-activate the user's saved standard mapping on mount (from AccountsDashboard preference)
const autoMappingAppliedRef = useRef(false);
useEffect(() => {
  if (autoMappingAppliedRef.current) return;
  autoMappingAppliedRef.current = true;
(async () => {
    try {
      const { supabase } = await import("../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data: settingsData } = await supabase
        .from("user_settings")
        .select("preferences")
        .eq("user_id", uid)
        .single();
const mid = settingsData?.preferences?.standard_mapping_id;
      console.log("[auto-mapping] settingsData:", settingsData, "mid:", mid);
      if (!mid) return;
      const SUPABASE_URL = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
      const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const { listMappings, getActiveCompanyId } = await import("../../lib/mappingsApi");
      const cid = await getActiveCompanyId(uid);
      console.log("[auto-mapping] cid:", cid);
      if (!cid) return;
      const allMappings = await listMappings({ companyId: cid });
      console.log("[auto-mapping] all mappings:", allMappings);
      const match = (allMappings || []).find(m => String(m.mapping_id) === String(mid));
      console.log("[auto-mapping] match:", match);
      if (match) {
        handleApplyMapping(match);
      }
    } catch (err) { console.error("[auto-mapping] error:", err); }
})();
}, [handleApplyMapping]);

const [exportOpts, setExportOpts] = useState({
  plSummary: true, plDetailed: true,
  bsSummary: true, bsAssets: true, bsEquity: true,
  plSaved: true, bsSaved: true,
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


const upCompanyInitDone = useRef(false);
  useEffect(() => {
    if (upCompanyInitDone.current) return;
    if (effectiveCompanies.length > 0 && upCompanies.length === 0) {
      const c = effectiveCompanies[0];
      const v = typeof c === "object"
        ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
        : String(c);
      setUpCompanies([v]);
      upCompanyInitDone.current = true;
    }
  }, [effectiveCompanies, upCompanies.length]);


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
   } catch { /* ignore */ }

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
const fetchUploaded = useCallback(async (year, month, source, structure, companies) => {
  const coFilter = buildCompanyFilter(companies);
  if (!year || !month || !source || !structure || !coFilter) return;
    setUpLoading(true); setUpError(null); setUpFetched(false);
    try {
      const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and ${coFilter}`;
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

const fetchPrev = useCallback(async (year, month, source, structure, companies) => {
  const coFilter = buildCompanyFilter(companies);
  if (!year || !month || !source || !structure || !coFilter) return;
  if (Number(month) === 1) { setPrevData([]); return; }
  const prevMonth = Number(month) - 1;
  setPrevLoading(true);
  try {
    const filter = `Year eq ${year} and Month eq ${prevMonth} and Source eq '${source}' and GroupStructure eq '${structure}' and ${coFilter}`;
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
      setGrpData(json.value ?? (Array.isArray(json) ? json : [json]));
      setGrpFetched(true);
    } catch (e) { setGrpError(e.message); }
    finally { setGrpLoading(false); }
  }, [headers]);

const fetchJournal = useCallback(async (year, month, source, structure, companies) => {
  const y = year ?? upYear; const m = month ?? upMonth;
  const s = source ?? upSource; const st = structure ?? upStructure;
  const co = companies ?? upCompanies;
  const coFilter = buildCompanyFilter(co);
  if (!y || !m || !s || !st || !coFilter) return;
  setJrnLoading(true); setJrnError(null); setJrnFetched(false);
  try {
    const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}' and ${coFilter}`;
    const res = await fetch(
      `${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`,
      { headers: headers() }
    );
    if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status} – ${t.slice(0, 200)}`); }
    const json = await res.json();
    setJrnData(json.value ?? (Array.isArray(json) ? json : [json]));
    setJrnFetched(true);
} catch (e) { setJrnError(e.message); }
  finally { setJrnLoading(false); }
}, [upYear, upMonth, upSource, upStructure, upCompanies, headers]);

useEffect(() => {
  if (upSource && upStructure && upYear && upMonth && upCompaniesDebounced.length > 0) {
    fetchUploaded(upYear, upMonth, upSource, upStructure, upCompaniesDebounced);
    fetchPrev(upYear, upMonth, upSource, upStructure, upCompaniesDebounced);
    fetchJournal(upYear, upMonth, upSource, upStructure, upCompaniesDebounced);
  }
}, [upSource, upStructure, upYear, upMonth, upCompaniesDebounced, fetchUploaded, fetchPrev, fetchJournal]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

useEffect(() => {
    if (dataSubTab === "journal" && !jrnFetched && !jrnLoading) {
      fetchJournal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSubTab]);

  // ── Manual re-fetch for uploaded when filters change ───────
const handleLoadUploaded = () => {
  fetchUploaded(upYear, upMonth, upSource, upStructure, upCompanies);
  fetchPrev(upYear, upMonth, upSource, upStructure, upCompanies);
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
const [bsCmp3Year, setBsCmp3Year] = useState("");
const [bsCmp3Month, setBsCmp3Month] = useState("");
const [bsCmp3Source, setBsCmp3Source] = useState("");
const [bsCmp3Structure, setBsCmp3Structure] = useState("");
const [bsCmp3Company, setBsCmp3Company] = useState("");
const [bsCmp3Data, setBsCmp3Data] = useState([]);
const [bsCmp3Enabled, setBsCmp3Enabled] = useState(true);
const [bsCmp3DimGroups, setBsCmp3DimGroups] = useState(null);
const [bsCmp3Dimensions, setBsCmp3Dimensions] = useState(null);
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
const [, setCmpLoading]    = useState(false);

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
const [, setCmp2Loading]   = useState(false);

// ── Compare period 3 (Period D) ───────────────────────────
const [cmp3Year,      setCmp3Year]      = useState("");
const [cmp3Month,     setCmp3Month]     = useState("");
const [cmp3Source,    setCmp3Source]    = useState("");
const [cmp3Structure, setCmp3Structure] = useState("");
const [cmp3Company,   setCmp3Company]   = useState("");
const [cmp3DimGroups, setCmp3DimGroups] = useState(null);
const [cmp3Dimensions, setCmp3Dimensions] = useState(null);
const [cmp3Data,      setCmp3Data]      = useState([]);
const [cmp3PrevData,  setCmp3PrevData]  = useState([]);
const [, setCmp3Loading]   = useState(false);
const [plCmp3Enabled, setPlCmp3Enabled] = useState(true);
const [jrnCmp3Data, setJrnCmp3Data]     = useState([]);
  useEffect(() => {
  if (compareMode && cmpSource && cmpStructure && cmpYear && cmpMonth && cmpCompany) {
    fetchCmp(cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany);
  }
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany, fetchCmp]);

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
}, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company, fetchCmp2]);

const fetchCmp3 = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) return;
  setCmp3Loading(true);
  try {
    const filterA = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const resA = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterA)}`,
      { headers: headers() }
    );
    const jsonA = resA.ok ? await resA.json() : { value: [] };
    setCmp3Data(jsonA.value ?? (Array.isArray(jsonA) ? jsonA : []));

    if (Number(month) === 1) { setCmp3PrevData([]); }
    else {
      const filterB = `Year eq ${year} and Month eq ${Number(month) - 1} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
      const resB = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filterB)}`,
        { headers: headers() }
      );
      const jsonB = resB.ok ? await resB.json() : { value: [] };
      setCmp3PrevData(jsonB.value ?? (Array.isArray(jsonB) ? jsonB : []));
    }
  } catch { setCmp3Data([]); setCmp3PrevData([]); }
  finally { setCmp3Loading(false); }
}, [headers]);

const fetchJournalCmp3 = useCallback(async (year, month, source, structure, company) => {
  if (!year || !month || !source || !structure || !company) { setJrnCmp3Data([]); return; }
  try {
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    const res = await fetch(
      `${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`,
      { headers: headers() }
    );
    if (!res.ok) { setJrnCmp3Data([]); return; }
    const json = await res.json();
    setJrnCmp3Data(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setJrnCmp3Data([]); }
}, [headers]);

useEffect(() => {
  if (compareMode && cmp3Source && cmp3Structure && cmp3Year && cmp3Month && cmp3Company) {
    fetchCmp3(cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company);
  }
}, [compareMode, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, fetchCmp3]);

useEffect(() => {
  if (compareMode && cmp3Source && cmp3Structure && cmp3Year && cmp3Month && cmp3Company) {
    fetchJournalCmp3(cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company);
  } else {
    setJrnCmp3Data([]);
  }
}, [compareMode, cmp3Year, cmp3Month, cmp3Source, cmp3Structure, cmp3Company, fetchJournalCmp3]);

const tab        = TABS.find(t => t.id === activeTab);
   const anyLoading = probingPeriod || upLoading || prevLoading || plCmpLoading || plCmp2Loading || mapLoading || grpLoading || jrnLoading;

// Progress meter for the loading overlay covering the tab area
const hasStartedFetching = useRef(false);
  if (upLoading || grpLoading || probingPeriod) hasStartedFetching.current = true;
  const hasBeenReady = useRef(false);

  const dashProgress = useMemo(() => {
    // Until the first fetch has kicked off, force progress to 0 so the overlay
    // doesn't briefly show a half-filled state from stale prop data on mount.
    if (!hasStartedFetching.current && upData.length === 0 && grpData.length === 0) return 0;
    let pct = 0;
    if (upYear && upMonth)                                     pct += 15;
    if (effectiveSources.length > 0 && effectiveStructures.length > 0 && effectiveCompanies.length > 0) pct += 15;
    if (grpData.length > 0)                                    pct += 25;
    if (upData.length > 0)                                     pct += 25;
    if (!probingPeriod && !upLoading && !grpLoading && (upData.length > 0 || grpData.length > 0)) pct += 20;
    return Math.min(100, pct);
  }, [upYear, upMonth, effectiveSources.length, effectiveStructures.length, effectiveCompanies.length, grpData.length, upData.length, probingPeriod, upLoading, grpLoading]);

  // Smoothly animate the displayed value between progress changes
  const animatedDashProgress = useAnimatedNumber(dashProgress, 700);
const dashReady = dashProgress >= 100
    || !!upError
    || !!grpError
    || (upFetched && !upLoading && !probingPeriod && !grpLoading);
  if (dashReady) hasBeenReady.current = true;


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
{["uploaded", "mapped", "group", "journal", "report"].map(tab => (
      <button
        key={tab}
        onClick={() => setDataSubTab(tab)}
        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all capitalize
          ${dataSubTab === tab
            ? "bg-white text-[#1a2f8a] shadow-sm"
            : "text-gray-400 hover:text-gray-600"}`}
      >
        {t(`datatab_${tab}`)}
      </button>
    ))}
  </div>
);

const PeriodChip = ({ letter, color, label, filters, MONTHS, t = (k) => k, companies = [] }) => {
  if (!filters) return null;
  const moLabel = MONTHS.find(m => String(m.value) === String(filters.month))?.label ?? filters.month;
  const resolveCompany = (code) => {
    if (!code) return null;
    if (Array.isArray(code)) {
      return code.map(c => companies.find(co => String(co.value ?? co.code) === String(c))?.label ?? companies.find(co => String(co.value ?? co.code) === String(c))?.name ?? c).join(", ");
    }
    const m = companies.find(co => String(co.value ?? co.code) === String(code));
    return m?.label ?? m?.name ?? code;
  };
  const lines = [
    moLabel && filters.year ? `${moLabel} ${filters.year}` : null,
    filters.source,
    filters.structure,
    resolveCompany(filters.company),
Array.isArray(filters.dimGroups) && filters.dimGroups.length > 0 ? `${filters.dimGroups.length} ${filters.dimGroups.length === 1 ? t("periodchip_dim_group") : t("periodchip_dim_groups")}` : null,
    Array.isArray(filters.dimensions) && filters.dimensions.length > 0 ? `${filters.dimensions.length} ${filters.dimensions.length === 1 ? t("periodchip_dim") : t("periodchip_dims")}` : null,
  ].filter(Boolean);
return (
    <div className="group flex gap-3 p-3 rounded-2xl border transition-all hover:shadow-sm"
      style={{ borderColor: `${color}25`, background: `linear-gradient(135deg, ${color}08 0%, ${color}03 100%)` }}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-black"
        style={{ background: color, boxShadow: `0 4px 12px -2px ${color}50` }}>
        {letter}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color }}>{label}</p>
          {lines[0] && <p className="text-[11px] font-bold text-gray-800 truncate">{lines[0]}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {lines.slice(1).map((line, i) => (
            <span key={i} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white/60 text-gray-600 border border-gray-100/80">{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

const ExportModal = exportModal ? createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", animation: "kBadgesPop 280ms cubic-bezier(0.34,1.56,0.64,1)" }}
      onClick={() => setExportModal(false)}>
      <div className="relative bg-white w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col"
        style={{
          borderRadius: 28,
          boxShadow: `0 30px 80px -12px ${colors.primary}40, 0 12px 24px -6px rgba(0,0,0,0.12)`,
          animation: "plRowSlideIn 340ms cubic-bezier(0.34,1.56,0.64,1)"
        }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="relative px-7 pt-7 pb-5 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)`,
                  boxShadow: `0 8px 20px -6px ${colors.primary}60`
                }}>
                <Download size={17} className="text-white" strokeWidth={2.5} />
              </div>
              <div>
                <p className="font-black text-[20px] tracking-tight" style={{ color: colors.primary, letterSpacing: "-0.02em" }}>
                  {t("export_report") || "Export Report"}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                    style={{ background: `${colors.primary}10`, color: colors.primary }}>
{(exportOpts.format ?? "xlsx") === "pdf" ? t("export_pdf") : t("export_excel")}
                  </span>
                  {(compareMode || bsCompareMode) && (
                    <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                      style={{ background: "#CF305D15", color: "#CF305D" }}>
                      {t("btn_compare")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={() => setExportModal(false)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-[1.05]"
              style={{ background: "#f3f4f6", color: "#6b7280" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#e5e7eb"; e.currentTarget.style.color = "#111827"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.color = "#6b7280"; }}>
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
{/* Body */}
        <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-6 scrollbar-hide">
          {/* Period A — always shown */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{t("primary_period") || "Primary Period"}</p>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
            </div>
           <PeriodChip letter="A" color={colors.primary} label={t("period_a")}
              filters={{ year: upYear, month: upMonth, source: upSource, structure: upStructure, company: upCompany, dimGroups: upDimGroups, dimensions: upDimensions }}
              MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
          </div>

{/* P&L compare periods */}
          {compareMode && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{t("export_pl_compare")}</p>
                <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
              </div>
              <div className="space-y-2">
<PeriodChip letter="B" color="#CF305D" label={t("period_b")}
                  filters={{ year: cmpYear, month: cmpMonth, source: cmpSource, structure: cmpStructure, company: cmpCompany, dimGroups: cmpDimGroups, dimensions: cmpDimensions }}
                  MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
                {plCmp2Enabled && (
                  <PeriodChip letter="C" color="#57aa78" label={t("period_c")}
                    filters={{ year: cmp2Year, month: cmp2Month, source: cmp2Source, structure: cmp2Structure, company: cmp2Company, dimGroups: cmp2DimGroups, dimensions: cmp2Dimensions }}
                    MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
                )}
                {plCmp2Enabled && plCmp3Enabled && (
                  <PeriodChip letter="D" color="#a855f7" label={t("period_d")}
                    filters={{ year: cmp3Year, month: cmp3Month, source: cmp3Source, structure: cmp3Structure, company: cmp3Company, dimGroups: cmp3DimGroups, dimensions: cmp3Dimensions }}
                    MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
                )}
              </div>
            </div>
          )}

          {/* BS compare periods */}
          {bsCompareMode && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
               <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{t("export_bs_compare")}</p>
                <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
              </div>
              <div className="space-y-2">
<PeriodChip letter="B" color="#CF305D" label={t("period_b")}
                  filters={{ year: bsCmpYear, month: bsCmpMonth, source: bsCmpSource, structure: bsCmpStructure, company: bsCmpCompany, dimGroups: bsCmpDimGroups, dimensions: bsCmpDimensions }}
                  MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
                {bsCmp2Enabled && (
                  <PeriodChip letter="C" color="#57aa78" label={t("period_c")}
                    filters={{ year: bsCmp2Year, month: bsCmp2Month, source: bsCmp2Source, structure: bsCmp2Structure, company: bsCmp2Company, dimGroups: bsCmp2DimGroups, dimensions: bsCmp2Dimensions }}
                    MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
                )}
                {bsCmp2Enabled && bsCmp3Enabled && (
                  <PeriodChip letter="D" color="#a855f7" label={t("period_d")}
                    filters={{ year: bsCmp3Year, month: bsCmp3Month, source: bsCmp3Source, structure: bsCmp3Structure, company: bsCmp3Company, dimGroups: bsCmp3DimGroups, dimensions: bsCmp3Dimensions }}
                    MONTHS={MONTHS} t={t} companies={effectiveCompanies} />
                )}
              </div>
            </div>
          )}

{/* What to include */}
          <div>
            <div className="flex items-center gap-2 mb-3">
             <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{t("export_what_to_include")}</p>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
{(activeMapping ? [
                ["plSaved",    t("page_pl_full"),                                         colors.primary],
                ["bsSaved",    t("page_bs_full"),                                         colors.primary],
                ["dimJournal", t("export_dim_journal_title"),                             "#dc7533"],
              ] : [
                ["plSummary",  `${t("page_pl")} ${t("view_summary")}`,                    colors.primary],
                ["plDetailed", `${t("page_pl")} ${t("view_detailed")}`,                   colors.primary],
                ["bsSummary",  `${t("page_bs")} ${t("view_summary")}`,                    colors.primary],
                ["bsAssets",   `${t("page_bs")} ${t("bs_assets")}`,                       colors.primary],
                ["bsEquity",   `${t("page_bs")} ${t("bs_equity_liab")}`,                  colors.primary],
                ["dimJournal", t("export_dim_journal_title"),                             "#dc7533"],
              ]).map(([k, label, accent]) => {
                const checked = k === "dimJournal" ? exportOpts.dimJournal !== false : !!exportOpts[k];
                return (
                  <label key={k} className="flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                    style={{ borderColor: checked ? `${accent}40` : "#f3f4f6", background: checked ? `${accent}06` : "white" }}
                    onClick={() => setExportOpts(o => ({ ...o, [k]: k === "dimJournal" ? (o.dimJournal === false) : !o[k] }))}>
                    <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                      style={{ background: checked ? accent : "transparent", borderColor: checked ? accent : "#d1d5db" }}>
                      {checked && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                    </div>
                    <span className="text-xs font-bold text-gray-700">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

{/* Footer */}
        <div className="px-7 py-5 flex items-center gap-3 flex-shrink-0"
          style={{ background: "linear-gradient(180deg, transparent 0%, #f9fafb 100%)" }}>
          <div className="relative flex items-center p-1 rounded-xl"
            style={{ background: "#f3f4f6" }}
            ref={el => {
              if (!el) return;
              const btns = el.querySelectorAll("[data-fmt]");
              const idx = ["xlsx","pdf"].indexOf(exportOpts.format ?? "xlsx");
              const active = btns[idx >= 0 ? idx : 0];
              const pill = el.querySelector(".fmt-pill");
              if (active && pill) {
                pill.style.left = active.offsetLeft + "px";
                pill.style.width = active.offsetWidth + "px";
              }
            }}>
            <span className="fmt-pill" style={{
              position: "absolute", top: 4, bottom: 4,
              background: "white", borderRadius: 8,
              boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
              transition: "left 320ms cubic-bezier(0.34,1.56,0.64,1), width 320ms cubic-bezier(0.34,1.56,0.64,1)",
              pointerEvents: "none"
            }} />
           {[["xlsx", t("export_excel")], ["pdf", t("export_pdf")]].map(([f, l]) => (
              <button key={f} data-fmt onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                className="relative z-10 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors duration-200"
                style={{ background: "transparent", color: (exportOpts.format ?? "xlsx") === f ? colors.primary : "#9ca3af" }}>
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setExportModal(false);
              const fmt = exportOpts.format ?? 'xlsx';
              const commonArgs = {
                groupAccounts: grpData,
                uploadedAccounts: upData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions)),
                prevUploadedAccounts: prevData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions)),
                compareMode,
                cmpUploadedAccounts: cmpData.filter(r => rowMatchesDimMulti(r, cmpDimGroups, cmpDimensions)),
                cmpPrevUploadedAccounts: cmpPrevData.filter(r => rowMatchesDimMulti(r, cmpDimGroups, cmpDimensions)),
                cmpFilters: { year: cmpYear, month: cmpMonth, source: cmpSource, structure: cmpStructure, company: cmpCompany, dimGroups: cmpDimGroups, dimensions: cmpDimensions },
                cmp2UploadedAccounts: cmp2Data.filter(r => rowMatchesDimMulti(r, cmp2DimGroups, cmp2Dimensions)),
                cmp2PrevUploadedAccounts: cmp2PrevData.filter(r => rowMatchesDimMulti(r, cmp2DimGroups, cmp2Dimensions)),
                cmp2Filters: { year: cmp2Year, month: cmp2Month, source: cmp2Source, structure: cmp2Structure, company: cmp2Company, dimGroups: cmp2DimGroups, dimensions: cmp2Dimensions },
                cmp3UploadedAccounts: cmp3Data.filter(r => rowMatchesDimMulti(r, cmp3DimGroups, cmp3Dimensions)),
                cmp3PrevUploadedAccounts: cmp3PrevData.filter(r => rowMatchesDimMulti(r, cmp3DimGroups, cmp3Dimensions)),
                cmp3Filters: { year: cmp3Year, month: cmp3Month, source: cmp3Source, structure: cmp3Structure, company: cmp3Company, dimGroups: cmp3DimGroups, dimensions: cmp3Dimensions },
                bsCompareMode,
                bsCmpUploadedAccounts: bsCmpData,
                bsCmpFilters: { year: bsCmpYear, month: bsCmpMonth, source: bsCmpSource, structure: bsCmpStructure, company: bsCmpCompany, dimGroups: bsCmpDimGroups, dimensions: bsCmpDimensions },
                bsCmp2UploadedAccounts: bsCmp2Data,
                bsCmp2Filters: { year: bsCmp2Year, month: bsCmp2Month, source: bsCmp2Source, structure: bsCmp2Structure, company: bsCmp2Company, dimGroups: bsCmp2DimGroups, dimensions: bsCmp2Dimensions },
                bsCmp3UploadedAccounts: bsCmp3Data,
                bsCmp3Filters: { year: bsCmp3Year, month: bsCmp3Month, source: bsCmp3Source, structure: bsCmp3Structure, company: bsCmp3Company, dimGroups: bsCmp3DimGroups, dimensions: bsCmp3Dimensions },
                month: upMonth, year: upYear, source: upSource, structure: upStructure,
                aFilters: { year: upYear, month: upMonth, source: upSource, structure: upStructure, company: upCompany, dimGroups: upDimGroups, dimensions: upDimensions },
journalEntries: jrnData,
                journalEntriesCmp: jrnCmpData,
                journalEntriesCmp2: jrnCmp2Data,
                journalEntriesCmp3: jrnCmp3Data,
                cmp2Enabled: plCmp2Enabled,
                cmp3Enabled: plCmp3Enabled,
                bsCmp2Enabled: bsCmp2Enabled,
                bsCmp3Enabled: bsCmp3Enabled,
selectedCompanies: upCompaniesDebounced,
                companies: effectiveCompanies,
                dimensions: effectiveDimensions,
dimGroups,
breakers,
                pgcMapping: activeMapping?.plConverted ?? pgcMapping ?? danishIfrsPlMapping ?? spanishIfrsEsPlMapping,
                pgcBsMapping: activeMapping?.bsConverted ?? pgcBsMapping ?? danishIfrsBsMapping ?? spanishIfrsEsBsMapping,
                colors,
plHistoryMonths: plHistoryExpanded ? plHistoryMonths : [],
                bsHistoryMonths: bsHistoryExpanded ? bsHistoryMonths : [],
                ytdOnly,
                savedPlLiteral: activeMapping?.plLiteral ?? null,
                savedBsLiteral: activeMapping?.bsLiteral ?? null,
                savedHighlightedIds: activeMapping?.highlightedIds ?? null,
                prevUploadedAccountsRaw: prevData,
                summaryRows: (() => {
                  const effectivePlMapping = activeMapping?.plConverted ?? pgcMapping ?? danishIfrsPlMapping ?? spanishIfrsEsPlMapping;
                  const localTree = buildTree(grpData, upData);
                  if (effectivePlMapping?.rows) {
                    const treeByCode = new Map();
                    (function index(nodes) {
                      nodes.forEach(n => { treeByCode.set(String(n.code), n); index(n.children || []); });
                    })(localTree);
                    return [...effectivePlMapping.rows.entries()]
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
                  localTree.filter(n => ["P/L", "DIS"].includes(n.accountType)).forEach(n => walk(n));
                  const plSums = allSums.filter(n => n.accountType === "P/L");
                  const isAlpha = plSums.some(n => /[a-zA-Z]/.test(String(n.code)));
                  let filtered;
                  if (isAlpha) {
                    const hasDotS = plSums.some(n => String(n.code).endsWith(".S"));
                    const hasDotPL = !hasDotS && plSums.some(n => String(n.code).endsWith(".PL"));
                    const hasAlphaPlain = !hasDotS && plSums.some(n => /^[A-Z]\.\d/.test(String(n.code)));
                    if (hasDotS) filtered = plSums.filter(n => String(n.code).endsWith(".S"));
                    else if (hasDotPL || hasAlphaPlain) {
                      const breakerKeys = new Set(Object.keys(breakers.pl));
                      const plDotNodes = plSums.filter(n => String(n.code).endsWith(".PL"));
                      const breakerNodes = breakerKeys.size > 0
                        ? plSums.filter(n => breakerKeys.has(String(n.code)) && !String(n.code).endsWith(".PL"))
                        : plSums.filter(n => n.level === 1 && !String(n.code).endsWith(".PL")).slice(0, 1);
                      filtered = [...breakerNodes, ...plDotNodes];
                    } else filtered = plSums.filter(n => PL_HIGHLIGHTED_CODES.has(String(n.code)));
                  } else filtered = plSums.filter(n => PL_HIGHLIGHTED_CODES.has(String(n.code)));
                  if (filtered.length === 0) filtered = plSums.filter(n => n.level === 1);
                  return filtered.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
                })(),
                opts: exportOpts,
              };
if (fmt === 'pdf') generateKonsolidatorPdf({ ...commonArgs, t, MONTHS });
              else generateKonsolidatorXlsx({ ...commonArgs, compareMode, t, MONTHS });
            }}
className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03]"
            style={{
              background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 100%)`,
              color: "white",
              boxShadow: `0 8px 20px -6px ${colors.primary}80, 0 2px 6px -2px ${colors.primary}40`
            }}>
            <Download size={13} strokeWidth={2.5} />
            {t("download") || "Download"}
          </button>
        </div>
</div>
    </div>,
    document.body
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
.k-scroll { scrollbar-width: thin; scrollbar-color: ${colors.primary}40 transparent; }
.k-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.k-scroll::-webkit-scrollbar-track { background: transparent; }
.k-scroll::-webkit-scrollbar-thumb { background: ${colors.primary}30; border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; transition: background-color 200ms ease; }
.k-scroll::-webkit-scrollbar-thumb:hover { background: ${colors.primary}80; background-clip: padding-box; }
.k-scroll::-webkit-scrollbar-corner { background: transparent; }
.k-scroll::-webkit-scrollbar-button:vertical:start:decrement { display: block; height: 64px; background: transparent; }
.k-scroll::-webkit-scrollbar-button:vertical:end:increment { display: block; height: 40px; background: transparent; }
.k-scroll::-webkit-scrollbar-button:vertical:start:increment,
.k-scroll::-webkit-scrollbar-button:vertical:end:decrement { display: none; }
.k-scroll::-webkit-scrollbar-button:horizontal { display: none; }
.k-scroll-overlay { overflow: overlay; }
@supports not (overflow: overlay) { .k-scroll-overlay { overflow: auto; } }
/* Sticky requires the table to have border-collapse: separate */
        .k-sticky-table { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
       .k-sticky-table thead th { position: sticky; top: 0; z-index: 10; background: #ffffff !important; will-change: transform; }
        .k-sticky-table thead th.k-sticky-acc-head { position: sticky !important; top: 0; left: 0; z-index: 25; border-right: 1px solid rgba(0,0,0,0.06); }
.k-sticky-table tbody td.k-sticky-acc,
        .k-sticky-table tbody th.k-sticky-acc { position: sticky; left: 0; z-index: 5; background: white; border-right: 1px solid rgba(0,0,0,0.06); }
.k-sticky-acc, .k-sticky-acc-head { overflow: hidden !important; }
.k-sticky-acc > div { min-width: 0; max-width: 100%; overflow: hidden; }
.k-sticky-acc span:not(.k-no-truncate) { white-space: nowrap; flex-shrink: 0; }
.k-sticky-acc > div { flex-wrap: nowrap; min-width: max-content; width: max-content; }
.k-acc-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: col-resize; z-index: 50; background: transparent; transition: background 160ms; user-select: none; }
        .k-acc-resize-handle:hover, .k-acc-resize-handle.is-dragging { background: rgba(26,47,138,0.35); }
        .k-sticky-table tbody tr.bg-\\[\\#fef3c7\\] td.k-sticky-acc { background: #fef3c7; }
        .k-sticky-table tbody tr.bg-\\[\\#fafbff\\] td.k-sticky-acc { background: #fafbff; }
        .k-sticky-table tbody tr.bg-amber-50\\/10 td.k-sticky-acc { background: #fffbeb1a; }
        tr.bg-\\[\\#fef3c7\\] .k-sticky-acc { background: #fef3c7; }
        tr.bg-\\[\\#fafbff\\] .k-sticky-acc { background: #fafbff; }
        tr.bg-amber-50\\/10 .k-sticky-acc { background: #fffbeb1a; }
        tr.bg-indigo-50\\/20 .k-sticky-acc { background: rgba(238,242,255,0.2); }
        tr.bg-indigo-50\\/10 .k-sticky-acc { background: rgba(238,242,255,0.1); }
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
(compareMode || bsCompareMode || plHistoryExpanded || bsHistoryExpanded)
      ? { label: t("filter_company"), value: upCompany,
          onChange: v => setUpCompanies(v ? [v] : []),
          options: effectiveCompanies.map(c => {
            const v = typeof c === "object"
              ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
              : String(c);
            const l = typeof c === "object"
              ? (c.companyLegalName ?? c.CompanyLegalName ?? v)
              : String(c);
            return { value: v, label: l };
          }) }
: { label: t("filter_company"), multiselect: true, values: upCompanies,
          onChange: vs => {
            if (!vs || vs.length === 0) {
              setUpCompanies(effectiveCompanies.map(c =>
                typeof c === "object"
                  ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
                  : String(c)
              ));
            } else {
              setUpCompanies(vs);
            }
          },
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
      disabled: plHistoryExpanded || upCompanies.length > 1,
      onChange: () => {
        if (plHistoryExpanded || upCompanies.length > 1) return;
if (!compareMode) {
          setCmpYear(upYear); setCmpMonth(upMonth); setCmpSource(upSource);
          setCmpStructure(upStructure); setCmpCompany(upCompany);
          setCmpDimGroups(upDimGroups); setCmpDimensions(upDimensions);
          setCmp2Year(upYear); setCmp2Month(upMonth); setCmp2Source(upSource);
          setCmp2Structure(upStructure); setCmp2Company(upCompany);
          setCmp2DimGroups(upDimGroups); setCmp2Dimensions(upDimensions);
          setCmp3Year(upYear); setCmp3Month(upMonth); setCmp3Source(upSource);
          setCmp3Structure(upStructure); setCmp3Company(upCompany);
          setCmp3DimGroups(upDimGroups); setCmp3Dimensions(upDimensions);
        }
        setCompareMode(c => !c);
      },
} : activeTab === "bs" ? {
      active: bsCompareMode,
      disabled: bsHistoryExpanded || upCompanies.length > 1,
      onChange: () => {
        if (bsHistoryExpanded || upCompanies.length > 1) return;
        if (!bsCompareMode) {
          setBsCmpYear(String(upYear)); setBsCmpMonth(String(upMonth));
          setBsCmpSource(upSource); setBsCmpStructure(upStructure); setBsCmpCompany(upCompany);
setBsCmp2Year(String(upYear)); setBsCmp2Month(String(upMonth));
          setBsCmp2Source(upSource); setBsCmp2Structure(upStructure); setBsCmp2Company(upCompany);
          setBsCmp3Year(String(upYear)); setBsCmp3Month(String(upMonth));
          setBsCmp3Source(upSource); setBsCmp3Structure(upStructure); setBsCmp3Company(upCompany);
        }
        setBsCompareMode(c => !c);
      },
    } : null
  }
onMappingsClick={viewsMode ? undefined : () => setViewsMode("landing")}
mappingsQuickAccess={viewsMode ? [] : recentMappings}
onQuickApplyMapping={(m) => handleApplyMapping(m.raw, m.kind)}
onExportPdf={(!viewsMode && (activeTab === "pl" || activeTab === "bs"))
  ? () => { setExportOpts(o => ({ ...o, format: "pdf" })); setExportModal(true); }
  : undefined}
onExportXlsx={(!viewsMode && (activeTab === "pl" || activeTab === "bs"))
  ? () => { setExportOpts(o => ({ ...o, format: "xlsx" })); setExportModal(true); }
  : undefined}
/>


{activeMapping && (
  <div className="flex items-center gap-2 mt-3 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm">
    <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
<span className="text-xs text-emerald-700 font-medium">
      {t("mapping_active_label")}: <strong className="font-black">{activeMapping.name}</strong>
      <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
    </span>
    <button
      onClick={() => {
        try {
          sessionStorage.setItem("mappings:openForEdit", JSON.stringify({
            mapping_id: activeMapping.mapping_id,
            kind: activeMapping.kind ?? "structure",
          }));
        } catch { /* ignore quota errors */ }
        onNavigate?.("mappings");
      }}
      className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
      title={t("edit_mapping_title") ?? "Edit mapping"}
    >
      <Pencil size={11} />
      {t("btn_edit") ?? "Edit"}
    </button>
    <button
      onClick={() => setActiveMapping(null)}
      className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
      title={t("clear_mapping_title")}
    >
      <X size={11} />
      {t("btn_clear")}
    </button>
  </div>
)}
<div className="flex-1 scrollbar-hide" style={{ marginTop: 12, minHeight: 0, display: "flex", flexDirection: "column", overflow: "visible", position: "relative" }}>

{!dashReady && !hasBeenReady.current && !viewsMode && (
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
<p className="font-black text-xl text-gray-800 mb-2">{t("views_report_mappings")}</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">{t("views_report_description")}</p>
            </div>
            <div className="mt-6 flex items-center justify-between">
<span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider" style={{ background: "#CF305D15", color: "#CF305D" }}>{t("badge_coming_soon")}</span>
              <span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ color: "#CF305D" }}>{t("btn_preview_arrow")}</span>
            </div>
          </div>
        </button>
      </div>
    )}

{/* Report: library */}
    {viewsMode === "report" && (
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
<div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{t("views_library")}</p>
            <p className="font-black text-xs text-gray-700">{t("views_saved_report_mappings")}</p>
          </div>
          {activeMapping && (
            <button onClick={() => { setActiveMapping(null); setViewsMode(null); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors">
              <X size={10} /> {t("btn_clear_active")}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {reportMappingsLoading && (
            <div className="py-16 text-center">
              <Loader2 size={24} className="text-[#CF305D] animate-spin mx-auto mb-2" />
              <p className="text-gray-400 text-xs">{t("views_loading_report_mappings")}</p>
            </div>
          )}

          {reportMappingsError && !reportMappingsLoading && (
            <div className="py-12 text-center">
              <AlertCircle size={20} className="text-red-400 mx-auto mb-2" />
              <p className="text-red-500 text-xs font-bold">{reportMappingsError}</p>
             <button onClick={fetchReportMappings} className="mt-2 text-xs text-[#CF305D] underline font-bold">{t("btn_retry")}</button>
            </div>
          )}

          {!reportMappingsLoading && !reportMappingsError && reportMappings.length === 0 && (
            <div className="py-16 text-center">
              <div className="w-14 h-14 bg-[#fef1f5] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <FileText size={24} className="text-[#CF305D]" />
              </div>
<p className="text-gray-700 font-black text-sm mb-1">{t("views_no_report_mappings")}</p>
              <p className="text-gray-400 text-xs">{t("views_no_report_mappings_hint")}</p>
            </div>
          )}

          {!reportMappingsLoading && !reportMappingsError && reportMappings.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {reportMappings.map(m => {
                const isActive = activeMapping?.mapping_id === m.mapping_id;
                return (
                  <button key={m.mapping_id}
                    onClick={() => { handleApplyMapping(m, "report"); setViewsMode(null); }}
                    className="text-left bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md group flex flex-col"
                    style={{ borderColor: isActive ? "#CF305D" : "#f3f4f6", background: isActive ? "#CF305D06" : "white" }}>
                    <div className="flex items-start gap-2.5 mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: isActive ? "#CF305D" : "#fef1f5" }}>
                        <FileText size={14} style={{ color: isActive ? "white" : "#CF305D" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
<p className="font-black text-xs text-gray-800 truncate">{m.name ?? t("views_untitled")}</p>
                          {isActive && (
                            <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: "#CF305D", color: "white" }}>{t("views_active")}</span>
                          )}
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "#CF305D" }}>{m.standard ?? "—"}</p>
                      </div>
                    </div>
                    {m.description && <p className="text-[10px] text-gray-500 mb-2 line-clamp-2">{m.description}</p>}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                      <span className="text-[9px] text-gray-400">{t("views_updated")} {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white shadow-sm transition-all">
                        <CheckCircle2 size={9} />{t("views_apply")}
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

    {/* Structure: library */}
    {viewsMode === "structure" && (
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
<p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{t("views_library")}</p>
            <p className="font-black text-xs text-gray-700">{t("views_saved_mappings")}</p>
          </div>
          {activeMapping && (
            <button onClick={() => { setActiveMapping(null); setViewsMode(null); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors">
              <X size={10} /> {t("btn_clear_active")}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {mappingsLoading && (
            <div className="py-16 text-center">
              <Loader2 size={24} className="text-[#1a2f8a] animate-spin mx-auto mb-2" />
              <p className="text-gray-400 text-xs">{t("views_loading_mappings")}</p>
            </div>
          )}

          {mappingsError && !mappingsLoading && (
            <div className="py-12 text-center">
              <AlertCircle size={20} className="text-red-400 mx-auto mb-2" />
              <p className="text-red-500 text-xs font-bold">{mappingsError}</p>
             <button onClick={fetchSavedMappings} className="mt-2 text-xs text-[#1a2f8a] underline font-bold">{t("btn_retry")}</button>
            </div>
          )}

          {!mappingsLoading && !mappingsError && savedMappings.length === 0 && (
            <div className="py-16 text-center">
              <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Library size={24} className="text-[#1a2f8a]" />
              </div>
<p className="text-gray-700 font-black text-sm mb-1">{t("views_no_mappings")}</p>
              <p className="text-gray-400 text-xs">{t("views_no_mappings_hint")}</p>
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
<p className="font-black text-xs text-gray-800 truncate">{m.name ?? t("views_untitled")}</p>
                          {isActive && (
                            <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: colors.primary, color: "white" }}>{t("views_active")}</span>
                          )}
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: colors.primary }}>{m.standard ?? "—"}</p>
                      </div>
                    </div>
                    {m.description && <p className="text-[10px] text-gray-500 mb-2 line-clamp-2">{m.description}</p>}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50 mt-auto">
                      <span className="text-[9px] text-gray-400">{t("views_updated")} {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white shadow-sm transition-all">
                        <CheckCircle2 size={9} />{t("views_apply")}
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
  externalAccColWidth={accColWidth}
  onAccColWidthChange={setAccColWidth}
  bsCompareMode={bsCompareMode}
  externalExpandedMap={plExpandedMap}
  externalSetExpandedMap={setPlExpandedMap}
multiCompany={upCompaniesDebounced.length > 1}
selectedCompanies={upCompaniesDebounced}
  token={token}
  upDimGroups={upDimGroups}
  upDimensions={upDimensions}
  onHistoryExpandedChange={setPlHistoryExpanded}
  externalHistoryExpanded={plHistoryExpanded}
  externalHistoryMonths={plHistoryMonths}
  onHistoryMonthsChange={setPlHistoryMonths}
  ytdOnly={ytdOnly}
  dimensionActive={(upDimGroups?.length > 0) || (upDimensions?.length > 0)}
  groupAccounts={grpData}
  dimensions={effectiveDimensions}
  dimensions={effectiveDimensions}
uploadedAccounts={upData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions))}
prevUploadedAccounts={prevData.filter(r => rowMatchesDimMulti(r, upDimGroups, upDimensions))}
prevUploadedAccountsRaw={prevData}
  compareMode={compareMode}
  onToggleCompare={() => {
    if (!compareMode) {
      setCmpYear(upYear);
      setCmpMonth(upMonth);
      setCmpSource(upSource);
      setCmpStructure(upStructure);
setCmpCompany(upCompany);
      setCmp2Year(upYear);
      setCmp2Month(upMonth);
      setCmp2Source(upSource);
      setCmp2Structure(upStructure);
      setCmp2Company(upCompany);

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
  cmp3UploadedAccounts={cmp3Data.filter(r => rowMatchesDimMulti(r, cmp3DimGroups, cmp3Dimensions))}
  cmp3PrevUploadedAccounts={cmp3PrevData.filter(r => rowMatchesDimMulti(r, cmp3DimGroups, cmp3Dimensions))}
  cmp3Filters={{
    year: cmp3Year, month: cmp3Month, source: cmp3Source,
    structure: cmp3Structure, company: cmp3Company,
    dimGroups: cmp3DimGroups, dimensions: cmp3Dimensions,
  }}
  onCmp3FilterChange={(key, val) => {
    if (key === "year")      setCmp3Year(val);
    if (key === "month")     setCmp3Month(val);
    if (key === "source")    setCmp3Source(val);
    if (key === "structure") setCmp3Structure(val);
    if (key === "company")   setCmp3Company(val);
    if (key === "dimGroups")  { setCmp3DimGroups(val); setCmp3Dimensions(null); }
    if (key === "dimensions") setCmp3Dimensions(val);
  }}
  cmp3FilteredDims={(() => {
    if (!cmp3DimGroups || cmp3DimGroups.length === 0) return effectiveDimensions;
    return effectiveDimensions.filter(d => {
      const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
      return cmp3DimGroups.includes(g);
    });
  })()}
  cmp3Enabled={plCmp3Enabled}
  onCmp3EnabledChange={setPlCmp3Enabled}
  journalEntriesCmp3={jrnCmp3Data}
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
externalAccColWidth={accColWidth}
  onAccColWidthChange={setAccColWidth}
  multiCompany={upCompanies.length > 1}
  selectedCompanies={upCompanies}
  externalBsDrillMap={bsDrillMap}
  compareMode={bsCompareMode}
 plCompareMode={compareMode}
 setCompareMode={setBsCompareMode}
  externalSetBsDrillMap={setBsDrillMap}
  onHistoryExpandedChange={setBsHistoryExpanded}
  externalHistoryExpanded={bsHistoryExpanded}
  externalHistoryMonths={bsHistoryMonths}
  onHistoryMonthsChange={setBsHistoryMonths}
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
  journalEntriesCmp={jrnCmpData}
  journalEntriesCmp2={jrnCmp2Data}
  journalEntriesCmp3={jrnCmp3Data}
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
  cmp3Year={bsCmp3Year} setCmp3Year={setBsCmp3Year}
  cmp3Month={bsCmp3Month} setCmp3Month={setBsCmp3Month}
  cmp3Source={bsCmp3Source} setCmp3Source={setBsCmp3Source}
  cmp3Structure={bsCmp3Structure} setCmp3Structure={setBsCmp3Structure}
  cmp3Company={bsCmp3Company} setCmp3Company={setBsCmp3Company}
  cmp3Data={bsCmp3Data} setCmp3Data={setBsCmp3Data}
  externalCmp3Enabled={bsCmp3Enabled}
  onBsCmp3EnabledChange={setBsCmp3Enabled}
  bsCmp3DimGroups={bsCmp3DimGroups} setBsCmp3DimGroups={setBsCmp3DimGroups}
  bsCmp3Dimensions={bsCmp3Dimensions} setBsCmp3Dimensions={setBsCmp3Dimensions}
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