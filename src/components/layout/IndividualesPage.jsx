import React, { useState, useEffect, useMemo, useCallback, useRef,  useLayoutEffect } from "react";
import {
  FileText, Search, Loader2, AlertCircle, Filter,
  ChevronDown, ChevronRight, Hash, Calendar, Database, Network,
  RefreshCw, X, GitMerge, BookOpen, Upload, BarChart2, TrendingUp,
} from "lucide-react";

const BASE_URL = "";

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
  const cols = data.length > 0 ? Object.keys(data[0]).filter((c) => !hiddenCols.has(c)) : [];
  const filtered = search.trim()
    ? data.filter((row) => Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(search.toLowerCase())))
    : data;

  return (
    <div className="space-y-4">
<div className="flex items-center gap-3 flex-wrap">
  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#eef1fb] text-[#1a2f8a]">
    <Hash size={11} />{data.length} records
  </div>

  {search && (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">
      {filtered.length} matching
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
        placeholder="Search results…"
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
      <RefreshCw size={12} /> Refresh
    </button>
  </div>
</div>
      {filtered.length > 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: 'calc(114.7vh - 320px)' }}>
            <table className="w-full">
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
          <p className="text-gray-400 text-sm font-semibold">No records found</p>
          <p className="text-gray-300 text-xs mt-1">{search ? "Try a different search term" : "No data for the selected filters"}</p>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message = "Loading…", sub = "" }) {
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
  return (
    <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3">
      <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-red-600">Failed to load data</p>
        <p className="text-xs text-red-400 mt-1 font-mono break-all">{error}</p>
        {onRetry && <button onClick={onRetry} className="mt-2 text-xs font-bold text-red-500 underline underline-offset-2">Retry</button>}
      </div>
    </div>
  );
}

function FilterPill({ label, value, onChange, options, dark = false, labelStyle = "", valueStyle = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => o.value === value)?.label ?? null;

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
              ? "bg-[#ffffff] border-[#dfdfdf] text-black hover:bg-white/30 shadow-xl"
              : "bg-[#ffffff] border-[#c2c2c2] text-[#505050] shadow-xl"
            : dark
              ? "bg-[#ffffff] border-[#dfdfdf] text-black hover:bg-white/30 shadow-xl"
              : "bg-[#ffffff] border-[#c2c2c2] text-[#505050] shadow-xl"
          }`}>
<span className={`text-[9px] font-black uppercase tracking-widest ${labelStyle || (value ? (dark ? "text-black/30" : "text-[#1a2f8a]/50") : dark ? "text-black/30" : "text-[#1a2f8a]/50")}`}>{label}</span>
<span className={valueStyle || (value ? (dark ? "text-[#1a2f8a]" : "text-[#1a2f8a]") : dark ? "text-[#1a2f8a]" : "text-[#1a2f8a]")}>{display ?? "—"}</span>
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

/* ═══════════════════════════════════════════════════════════════
   FIELD ACCESSOR
   The API field names may come back in different casings.
   This helper reads a field case-insensitively from a row object.
═══════════════════════════════════════════════════════════════ */
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

    // Skip pre-aggregated sum account rows to avoid double-counting
    const ga = gaByCode.get(gac);
    if (ga && getField(ga, "isSumAccount")) return;

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
          <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">dim</span>
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

function PLAmountCell({ value, bold }) {
  const isEmpty = value === 0;
  const isNeg   = value < 0;
  const color   = isEmpty ? "text-gray-300" : isNeg ? "text-red-500" : "text-gray-800";
  return (
    <td className={`pr-6 py-3 text-right font-mono text-xs whitespace-nowrap w-36 ${bold ? "font-bold" : ""} ${color}`}>
      {isEmpty ? "—" : isNeg ? `(${fmtAmt(Math.abs(value))})` : fmtAmt(value)}
    </td>
  );
}

function deviation(a, b) {
  const diff = a - b;
  const pct  = b === 0 ? null : (diff / Math.abs(b)) * 100;
  return { diff, pct };
}

function DeviationCells({ a, b, bold }) {
  const { diff, pct } = deviation(a, b);
  const isNeg  = diff < 0;
  const color  = diff === 0 ? "text-gray-300" : isNeg ? "text-red-400" : "text-emerald-600";
  const pctStr = pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const diffStr = diff === 0 ? "—"
    : isNeg ? `(${fmtAmt(Math.abs(diff))})` : fmtAmt(diff);
  return (
    <>
      <td className={`pr-6 py-3 text-right font-mono text-xs whitespace-nowrap w-28 ${bold ? "font-bold" : ""} ${color}`}>
        {diffStr}
      </td>
      <td className={`pr-6 py-3 text-right font-mono text-xs whitespace-nowrap w-20 ${bold ? "font-bold" : ""} ${color}`}>
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
  bsCompareMode = false,
  bsCmpUploadedAccounts = [], bsCmpFilters = {},
  bsCmp2UploadedAccounts = [], bsCmp2Filters = {},
  month, year, source, structure,
  journalEntries = [],
  opts = {},
}) {
  async function doGenerate(ExcelJS) {
    const NAVY="FF1A2F8A",RED="FFCF305D",GRN="FF57AA78",LIGHT="FFEEF1FB",STRIPE="FFF8F9FF",WHITE="FFFFFFFF",AMBER="FFDC7533";
    const mkFill=argb=>({type:"pattern",pattern:"solid",fgColor:{argb}});
    const mkFont=(bold,argb,sz=9)=>({bold,color:{argb},name:"Arial",size:sz});
    const mkAlign=(h,v="middle")=>({horizontal:h,vertical:v});
    const mkBorder=()=>({bottom:{style:"hair",color:{argb:"FFE5E7EB"}}});
    const NUM_FMT='#,##0.00;(#,##0.00);"-"';
    const PCT_FMT='0.0%;(0.0%);"-"';

    const monthLabel=MONTHS.find(m=>String(m.value)===String(month))?.label??month;
    const wb=new ExcelJS.Workbook();
    wb.creator="Konsolidator"; wb.created=new Date();

    // ── Build trees ──────────────────────────────────────────
    const tree=buildTree(groupAccounts,uploadedAccounts);
    const prevTree=buildTree(groupAccounts,prevUploadedAccounts);
    const cmpTree=compareMode?buildTree(groupAccounts,cmpUploadedAccounts):[];
    const cmpPrevTree=compareMode?buildTree(groupAccounts,cmpPrevUploadedAccounts):[];
    const cmp2Tree=compareMode?buildTree(groupAccounts,cmp2UploadedAccounts):[];
    const cmp2PrevTree=compareMode?buildTree(groupAccounts,cmp2PrevUploadedAccounts):[];

    const nodeMap=t=>{const m=new Map();const w=n=>{m.set(n.code,n);n.children?.forEach(w);};t.forEach(w);return m;};
    const prevMap=nodeMap(prevTree),cmpMap=nodeMap(cmpTree),cmpPrevMap=nodeMap(cmpPrevTree),cmp2Map=nodeMap(cmp2Tree),cmp2PrevMap=nodeMap(cmp2PrevTree);
    const getYtd=(map,code)=>{const n=map.get(code);return n?sumNode(n):0;};
    const getPrev=(map,code,mo)=>Number(mo)===1?0:getYtd(map,code);

    // ── Sheet builder helper ─────────────────────────────────
const cmpLabel=compareMode?[cmpFilters?.month?MONTHS.find(m=>String(m.value)===String(cmpFilters.month))?.label:"",cmpFilters?.year,cmpFilters?.source,cmpFilters?.structure,cmpFilters?.company].filter(Boolean).join(" · "):"";
    const cmp2Label=compareMode?[cmp2Filters?.month?MONTHS.find(m=>String(m.value)===String(cmp2Filters.month))?.label:"",cmp2Filters?.year,cmp2Filters?.source,cmp2Filters?.structure,cmp2Filters?.company].filter(Boolean).join(" · "):"";

const addSheetHeader=(ws,title,subtitle,totalCols,overrideL1=null,overrideL2=null,overrideCmp=null)=>{
      const useCmp=overrideCmp??compareMode;
      const useL1=overrideL1??cmpLabel;
      const useL2=overrideL2??cmp2Label;
      ws.addRow([]);const r1=ws.lastRow;r1.height=26;
      r1.getCell(1).value=title;
      r1.getCell(1).font=mkFont(true,"FFFFFFFF",13);
      r1.getCell(1).fill=mkFill(NAVY);
      r1.getCell(1).alignment=mkAlign("left");
      for(let c=1;c<=totalCols;c++)r1.getCell(c).fill=mkFill(NAVY);
      ws.mergeCells(1,1,1,totalCols);
      ws.addRow([]);const r2=ws.lastRow;r2.height=14;
      r2.getCell(1).value=`A: ${subtitle}`;
      r2.getCell(1).font=mkFont(false,"FFB4C6EE",9);
      r2.getCell(1).fill=mkFill(NAVY);
      r2.getCell(1).alignment=mkAlign("left");
      for(let c=1;c<=totalCols;c++)r2.getCell(c).fill=mkFill(NAVY);
      ws.mergeCells(2,1,2,totalCols);
      if(useCmp&&useL1){
        ws.addRow([]);const r3=ws.lastRow;r3.height=14;
        r3.getCell(1).value=`B: ${useL1}`;
        r3.getCell(1).font=mkFont(false,"FFFCD34D",9);
        r3.getCell(1).fill=mkFill(NAVY);
        r3.getCell(1).alignment=mkAlign("left");
        for(let c=1;c<=totalCols;c++)r3.getCell(c).fill=mkFill(NAVY);
        ws.mergeCells(ws.rowCount,1,ws.rowCount,totalCols);
        ws.addRow([]);const r4=ws.lastRow;r4.height=14;
        r4.getCell(1).value=`C: ${useL2}`;
        r4.getCell(1).font=mkFont(false,"FFA7F3D0",9);
        r4.getCell(1).fill=mkFill(NAVY);
        r4.getCell(1).alignment=mkAlign("left");
        for(let c=1;c<=totalCols;c++)r4.getCell(c).fill=mkFill(NAVY);
        ws.mergeCells(ws.rowCount,1,ws.rowCount,totalCols);
      }
      ws.addRow([]);ws.lastRow.height=4;
      for(let c=1;c<=totalCols;c++)ws.lastRow.getCell(c).fill=mkFill("FFF0F0F0");
    };

    // ── PL flat row builder ──────────────────────────────────
    const plFlatRows=(nodes,)=>{
      const rows=[];
      const walk=(node,d)=>{
        if(!hasData(node)||!["P/L","DIS"].includes(node.accountType))return;
        const ytd=-sumNode(node),prev=-getPrev(prevMap,node.code,month),mon=ytd-prev;
        const cmpYtd=compareMode?-getYtd(cmpMap,node.code):null;
        const cmpPrev=compareMode?-getPrev(cmpPrevMap,node.code,cmpFilters?.month):null;
        const cmpMon=compareMode?cmpYtd-cmpPrev:null;
        const cmp2Ytd=compareMode?-getYtd(cmp2Map,node.code):null;
        const cmp2Prev=compareMode?-getPrev(cmp2PrevMap,node.code,cmp2Filters?.month):null;
        const cmp2Mon=compareMode?cmp2Ytd-cmp2Prev:null;
        rows.push({name:node.name,depth:d,isBold:node.isSumAccount,mon,ytd,cmpMon,cmpYtd,cmp2Mon,cmp2Ytd,isGroup:true});
        if(opts.drillDown){
          // local accounts + dims
          node.uploadLeaves?.forEach(leaf=>{
            if(leaf.type==="plain")return;
            rows.push({name:leaf.name||leaf.code||"",depth:d+1,isBold:false,mon:-(leaf.amount),ytd:-(leaf.amount),cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null,isLeaf:true});
            leaf.children?.forEach(dim=>{
              rows.push({name:`${dim.name||dim.code}`,depth:d+2,isBold:false,mon:-(dim.amount),ytd:-(dim.amount),cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null,isDim:true});
            });
          });
          // journal
          const jrns=(journalEntries||[]).filter(j=>String(j.AccountCode??j.accountCode??"")=== node.code);
          if(jrns.length>0){
            rows.push({name:"— Journal entries —",depth:d+1,isBold:false,isJrnHeader:true,mon:null,ytd:null});
            jrns.forEach(j=>{
              const amt=parseAmt(j.AmountYTD??j.amountYTD??0);
              rows.push({name:`${j.JournalNumber??j.journalNumber??""} ${j.JournalHeader??j.journalHeader??""}`.trim(),depth:d+2,isBold:false,isJrn:true,mon:-amt,ytd:-amt,cmpMon:null,cmpYtd:null,cmp2Mon:null,cmp2Ytd:null});
            });
          }
          node.children?.filter(c=>hasData(c)&&["P/L","DIS"].includes(c.accountType)).forEach(c=>walk(c,d+1));
        } else {
          node.children?.filter(c=>hasData(c)&&["P/L","DIS"].includes(c.accountType)).forEach(c=>walk(c,d+1));
        }
      };
      nodes.filter(n=>hasData(n)&&["P/L","DIS"].includes(n.accountType))
        .sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}))
        .forEach(n=>walk(n,0));
      return rows;
    };

    // ── BS flat row builder ──────────────────────────────────
const bsFlatRows=(nodes,filterFn=null)=>{
      const rows=[];
      const walk=(node,d)=>{
        if(!hasData(node)||node.accountType!=="B/S")return;
        const total=Number(node.code)>=599999?-sumNode(node):sumNode(node);
        rows.push({name:node.name,depth:d,isBold:BS_HIGHLIGHTED_CODES.has(String(node.code)),total,isGroup:true});
        if(opts.drillDown){
          node.uploadLeaves?.forEach(leaf=>{
            if(leaf.type==="plain")return;
            rows.push({name:leaf.name||leaf.code||"",depth:d+1,isBold:false,total:leaf.amount,isLeaf:true});
            leaf.children?.forEach(dim=>{
              rows.push({name:`${dim.name||dim.code}`,depth:d+2,isBold:false,total:dim.amount,isDim:true});
            });
          });
          const jrns=(journalEntries||[]).filter(j=>String(j.AccountCode??j.accountCode??"")=== node.code);
          if(jrns.length>0){
            rows.push({name:"— Journal entries —",depth:d+1,isBold:false,isJrnHeader:true,total:null});
            jrns.forEach(j=>{
              const amt=parseAmt(j.AmountYTD??j.amountYTD??0);
              rows.push({name:`${j.JournalNumber??j.journalNumber??""} ${j.JournalHeader??j.journalHeader??""}`.trim(),depth:d+1,isBold:false,isJrn:true,total:amt});
            });
          }
        }
        if(filterFn)node.children?.filter(hasData).forEach(c=>walk(c,d+1));
      };
      nodes.filter(n=>!filterFn||filterFn(n)).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).forEach(n=>walk(n,0));
      return rows;
    };

    // ── Write PL sheet ───────────────────────────────────────
    const writePLSheet=(sheetName,rows)=>{
      const totalCols=compareMode?15:3;
      const ws=wb.addWorksheet(sheetName,{views:[{state:"frozen",ySplit:bsCompareMode?6:4}]});
      addSheetHeader(ws,`Profit & Loss — ${sheetName}`,`${monthLabel} ${year} · ${source} · ${structure}`,totalCols);
      // col headers
      ws.addRow([]);const rh=ws.lastRow;rh.height=18;
      const hdrs=compareMode?["Account","Monthly","Monthly B","Mon Δ","Mon Δ%","Monthly C","Mon Δ","Mon Δ%","YTD","YTD B","YTD Δ","YTD Δ%","YTD C","YTD Δ","YTD Δ%"]:["Account","Monthly","YTD"];
      hdrs.forEach((h,i)=>{
        const c=rh.getCell(i+1);
        c.value=h;c.font=mkFont(true,"FFFFFFFF",9);c.fill=mkFill(NAVY);c.alignment=mkAlign(i===0?"left":"right");
      });
     ws.getColumn(1).width=42;
      for(let i=2;i<=totalCols;i++)ws.getColumn(i).width=compareMode?12:18;
      rows.forEach((row,idx)=>{
        ws.addRow([]);const dr=ws.lastRow;dr.height=15;
        const bg=row.isBold?LIGHT:idx%2===0?WHITE:STRIPE;
        const indent="  ".repeat(row.depth);
        const nameCell=dr.getCell(1);
        nameCell.value=indent+(row.isJrnHeader?"📋 ":row.isDim?"◆ ":row.isJrn?"  📄 ":"")+row.name;
        nameCell.font=mkFont(row.isBold,row.isBold?NAVY:row.isDim?AMBER:row.isJrn?"FF6B7FD0":"FF374151",9);
        nameCell.fill=mkFill(row.isJrnHeader?"FFEEF0FF":row.isDim?"FFFEF3C7":row.isJrn?"FFF5F7FF":bg);
        nameCell.alignment={...mkAlign("left"),indent:row.depth};
        nameCell.border=mkBorder();
        if(row.mon!==null){
          const c2=dr.getCell(2);c2.value=row.mon??0;c2.numFmt=NUM_FMT;c2.font=mkFont(row.isBold,"FF1F2937",9);c2.fill=mkFill(bg);c2.alignment=mkAlign("right");c2.border=mkBorder();
const ytdCol=compareMode?9:3;
          const c3=dr.getCell(ytdCol);c3.value=row.ytd??0;c3.numFmt=NUM_FMT;c3.font=mkFont(row.isBold,"FF1F2937",9);c3.fill=mkFill(bg);c3.alignment=mkAlign("right");c3.border=mkBorder();
          if(compareMode&&row.cmpMon!=null){
            // Col 3: Monthly B, Col 4: Mon Δ, Col 5: Mon Δ%
            // Col 6: Monthly C, Col 7: Mon Δ, Col 8: Mon Δ%
            // Col 10: YTD B, Col 11: YTD Δ, Col 12: YTD Δ%
            // Col 13: YTD C, Col 14: YTD Δ, Col 15: YTD Δ%
            const devMonV=(row.mon??0)-(row.cmpMon??0);const devMonP=row.cmpMon?devMonV/Math.abs(row.cmpMon):null;
            const devYtdV=(row.ytd??0)-(row.cmpYtd??0);const devYtdP=row.cmpYtd?devYtdV/Math.abs(row.cmpYtd):null;
            const devMonCV=(row.mon??0)-(row.cmp2Mon??0);const devMonCP=row.cmp2Mon?devMonCV/Math.abs(row.cmp2Mon):null;
            const devYtdCV=(row.ytd??0)-(row.cmp2Ytd??0);const devYtdCP=row.cmp2Ytd?devYtdCV/Math.abs(row.cmp2Ytd):null;
            const setCol=(col,val,fmt,colorFn)=>{const c=dr.getCell(col);c.value=val??0;c.numFmt=fmt;const color=colorFn(val);c.font=mkFont(row.isBold,color,9);c.fill=mkFill(bg);c.alignment=mkAlign("right");c.border=mkBorder();};
            const devColor=v=>(!v||v===0)?"FFD1D5DB":v>0?"FF059669":"FFDC2626";
            setCol(3,row.cmpMon,NUM_FMT,()=>RED);
            setCol(4,devMonV,NUM_FMT,devColor);
            setCol(5,devMonP,PCT_FMT,devColor);
            if(row.cmp2Mon!=null){
              setCol(6,row.cmp2Mon,NUM_FMT,()=>GRN);
              setCol(7,devMonCV,NUM_FMT,devColor);
              setCol(8,devMonCP,PCT_FMT,devColor);
            }
            setCol(10,row.cmpYtd,NUM_FMT,()=>RED);
            setCol(11,devYtdV,NUM_FMT,devColor);
            setCol(12,devYtdP,PCT_FMT,devColor);
            if(row.cmp2Ytd!=null){
              setCol(13,row.cmp2Ytd,NUM_FMT,()=>GRN);
              setCol(14,devYtdCV,NUM_FMT,devColor);
              setCol(15,devYtdCP,PCT_FMT,devColor);
            }
          }
        }
      });
    };

// ── Write BS sheet ───────────────────────────────────────
const writeBSSheet=(sheetName,rows,cmpRows=null,cmp2Rows=null)=>{
      const hasCmp=bsCompareMode&&cmpRows&&cmpRows.length>0;
      const hasCmp2=bsCompareMode&&cmp2Rows&&cmp2Rows.length>0;
      const totalCols=hasCmp?8:2;
      const ws=wb.addWorksheet(sheetName,{views:[{state:"frozen",ySplit:compareMode?6:4}]});
      addSheetHeader(ws,`Balance Sheet — ${sheetName}`,`${monthLabel} ${year} · ${source} · ${structure}`,totalCols,bsCmpLabel??null,bsCmp2Label??null,bsCompareMode);
      ws.addRow([]);const rh=ws.lastRow;rh.height=18;
      const hdrs=hasCmp?["Account","Actual","B","B Δ","B Δ%","C","C Δ","C Δ%"]:["Account","Amount"];
      hdrs.forEach((h,i)=>{const c=rh.getCell(i+1);c.value=h;c.font=mkFont(true,"FFFFFFFF",9);c.fill=mkFill(NAVY);c.alignment=mkAlign(i===0?"left":"right");});
      ws.getColumn(1).width=48;
      for(let i=2;i<=totalCols;i++)ws.getColumn(i).width=hasCmp?14:18;
      // build lookup maps for cmp rows by name+depth
      const cmpMap=new Map();const cmp2Map=new Map();
      if(hasCmp)cmpRows.forEach(r=>cmpMap.set(`${r.depth}|${r.name}`,r.total));
      if(hasCmp2)cmp2Rows.forEach(r=>cmp2Map.set(`${r.depth}|${r.name}`,r.total));
      rows.forEach((row,idx)=>{
        ws.addRow([]);const dr=ws.lastRow;dr.height=15;
        const bg=row.isBold?LIGHT:idx%2===0?WHITE:STRIPE;
        const nameCell=dr.getCell(1);
        nameCell.value="  ".repeat(row.depth)+(row.isJrnHeader?"📋 ":row.isDim?"◆ ":row.isJrn?"  📄 ":"")+row.name;
        nameCell.font=mkFont(row.isBold,row.isBold?NAVY:row.isDim?AMBER:row.isJrn?"FF6B7FD0":"FF374151",9);
        nameCell.fill=mkFill(row.isJrnHeader?"FFEEF0FF":row.isDim?"FFFEF3C7":row.isJrn?"FFF5F7FF":bg);
        nameCell.alignment={...mkAlign("left"),indent:row.depth};
        nameCell.border=mkBorder();
        if(row.total!=null){
          const c2=dr.getCell(2);c2.value=row.total;c2.numFmt=NUM_FMT;
          c2.font=mkFont(row.isBold,row.isBold?NAVY:"FF374151",9);
          c2.fill=mkFill(bg);c2.alignment=mkAlign("right");c2.border=mkBorder();
          if(hasCmp){
            const key=`${row.depth}|${row.name}`;
            const cmpVal=cmpMap.get(key)??null;
            const cmp2Val=cmp2Map.get(key)??null;
            const devColor=v=>(!v||v===0)?"FFD1D5DB":v>0?"FF059669":"FFDC2626";
            const setCol=(col,val,fmt,colorFn)=>{if(val==null)return;const c=dr.getCell(col);c.value=val;c.numFmt=fmt;c.font=mkFont(row.isBold,colorFn(val),9);c.fill=mkFill(bg);c.alignment=mkAlign("right");c.border=mkBorder();};
            if(cmpVal!=null){
              const devB=row.total-cmpVal;const devBPct=cmpVal?devB/Math.abs(cmpVal):null;
              setCol(3,cmpVal,NUM_FMT,()=>RED);
              setCol(4,devB,NUM_FMT,devColor);
              setCol(5,devBPct,PCT_FMT,devColor);
            }
            if(cmp2Val!=null){
              const devC=row.total-cmp2Val;const devCPct=cmp2Val?devC/Math.abs(cmp2Val):null;
              setCol(6,cmp2Val,NUM_FMT,()=>GRN);
              setCol(7,devC,NUM_FMT,devColor);
              setCol(8,devCPct,PCT_FMT,devColor);
            }
          }
        }
      });
    };

    // ── Write Dimensions & Journal sheet ────────────────────
    const writeDimJournalSheet=()=>{
      const ws=wb.addWorksheet("Dimensions & Journal",{views:[{state:"frozen",ySplit:3}]});
      addSheetHeader(ws,"Dimensions & Journal Entries",`${monthLabel} ${year} · ${source} · ${structure}`,9);
      // Dim section
      ws.addRow([]);const rDim=ws.lastRow;rDim.height=16;
      ["Account Code","Account Name","Dimension Code","Dimension Name","Local Account","Amount YTD","Company","Currency","Type"].forEach((h,i)=>{
        const c=rDim.getCell(i+1);c.value=h;c.font=mkFont(true,"FFFFFFFF",9);c.fill=mkFill(AMBER);c.alignment=mkAlign(i<2?"left":"center");
      });
      [10,28,14,24,22,14,12,10,10].forEach((w,i)=>ws.getColumn(i+1).width=w);
      // Collect all dim rows from uploaded
      const dimRows=[];
      uploadedAccounts.forEach(row=>{
        const dim=String(getField(row,"dimensionCode")??"");
        const dimName=String(getField(row,"dimensionName")??"");
        const lac=String(getField(row,"localAccountCode")??"");
        const lacName=String(getField(row,"localAccountName")??"");
        const amt=parseAmt(getField(row,"AmountYTD","amountYTD","AmountPeriod","amountPeriod"));
        const co=String(getField(row,"companyShortName","CompanyShortName")??"");
        const cur=String(getField(row,"CurrencyCode","currencyCode")??"");
        const gac=String(getField(row,"accountCode")??"");
        const gaName=String(getField(row,"accountName")??"");
        dimRows.push([gac,gaName,dim,dimName,lac?`${lac} ${lacName}`.trim():"",amt,co,cur,"Uploaded"]);
      });
      dimRows.forEach((r,i)=>{
        ws.addRow([]);const dr=ws.lastRow;dr.height=14;
        r.forEach((v,j)=>{
          const c=dr.getCell(j+1);c.value=v;
          c.font=mkFont(false,"FF374151",9);
          c.fill=mkFill(i%2===0?WHITE:STRIPE);
          c.alignment=mkAlign(j<2?"left":j===5?"right":"center");
          if(j===5){c.numFmt=NUM_FMT;}
          c.border=mkBorder();
        });
      });
      // Journal section
      if(journalEntries?.length>0){
        ws.addRow([]);ws.addRow([]);
        ws.addRow([]);const rJrn=ws.lastRow;rJrn.height=16;
        ["Journal #","Header","Row Text","Account Code","Account Name","Account Type","Amount YTD","Currency","Type","Dimension","Counterparty"].forEach((h,i)=>{
          const c=rJrn.getCell(i+1);c.value=h;c.font=mkFont(true,"FFFFFFFF",9);c.fill=mkFill("FF4F46E5");c.alignment=mkAlign(i<2?"left":"center");
        });
        ws.getColumn(1).width=14;ws.getColumn(2).width=28;ws.getColumn(3).width=28;ws.getColumn(4).width=12;ws.getColumn(5).width=24;ws.getColumn(6).width=12;ws.getColumn(7).width=14;ws.getColumn(8).width=10;ws.getColumn(9).width=12;ws.getColumn(10).width=20;ws.getColumn(11).width=18;
        journalEntries.forEach((j,i)=>{
          const amt=parseAmt(j.AmountYTD??j.amountYTD??0);
          ws.addRow([]);const dr=ws.lastRow;dr.height=14;
          [j.JournalNumber??j.journalNumber,j.JournalHeader??j.journalHeader,j.RowText??j.rowText,j.AccountCode??j.accountCode,j.AccountName??j.accountName,j.AccountType??j.accountType,amt,j.CurrencyCode??j.currencyCode,j.JournalType??j.journalType,j.DimensionName??j.dimensionName,j.CounterpartyShortName??j.counterpartyShortName].forEach((v,k)=>{
            const c=dr.getCell(k+1);c.value=v??"-";
            c.font=mkFont(false,"FF374151",9);
            c.fill=mkFill(i%2===0?WHITE:"FFF5F3FF");
            c.alignment=mkAlign(k<3?"left":k===6?"right":"center");
            if(k===6)c.numFmt=NUM_FMT;
            c.border=mkBorder();
          });
        });
      }
    };

    // ── Generate selected sheets ─────────────────────────────
    const bsRoots=tree.filter(n=>hasData(n)&&n.accountType==="B/S").sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}));
    const isAssetsRoot=n=>(n.name??"").toLowerCase().includes("asset")||(n.name??"").toLowerCase().includes("activo");

    if(opts.plSummary){
      // Summary: only isSumAccount P/L nodes at top level
      const sumRows=[];
      const walkSum=node=>{
        if(!hasData(node)||!["P/L","DIS"].includes(node.accountType))return;
        node.children?.forEach(c=>walkSum(c));
        if(node.isSumAccount)sumRows.push(node);
      };
      tree.filter(n=>hasData(n)&&["P/L","DIS"].includes(n.accountType)).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).forEach(n=>walkSum(n));
      const byLevel={};
      sumRows.filter(n=>n.accountType==="P/L").forEach(n=>{if(!byLevel[n.level]||Number(n.code)<Number(byLevel[n.level].code))byLevel[n.level]=n;});
      const summaryNodes=Object.values(byLevel).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}));
      const rows=summaryNodes.map(node=>{
        const ytd=-sumNode(node),prev=-getPrev(prevMap,node.code,month),mon=ytd-prev;
        const cmpYtd=compareMode?-getYtd(cmpMap,node.code):null;
        const cmpPrev=compareMode?-getPrev(cmpPrevMap,node.code,cmpFilters?.month):null;
        const cmpMon=compareMode?cmpYtd-cmpPrev:null;
        const cmp2Ytd=compareMode?-getYtd(cmp2Map,node.code):null;
        const cmp2Prev=compareMode?-getPrev(cmp2PrevMap,node.code,cmp2Filters?.month):null;
        const cmp2Mon=compareMode?cmp2Ytd-cmp2Prev:null;
        return{name:node.name,depth:0,isBold:true,mon,ytd,cmpMon,cmpYtd,cmp2Mon,cmp2Ytd};
      });
      writePLSheet("P&L Summary",rows);
    }
    if(opts.plDetailed){writePLSheet("P&L Detailed",plFlatRows(tree));}
    // BS compare trees
const bsCmpRoots=bsCompareMode?buildTree(groupAccounts,bsCmpUploadedAccounts).filter(n=>hasData(n)&&n.accountType==="B/S").sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})):[];
    const bsCmp2Roots=bsCompareMode?buildTree(groupAccounts,bsCmp2UploadedAccounts).filter(n=>hasData(n)&&n.accountType==="B/S").sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})):[];
    const bsCmpLabel=bsCompareMode?[bsCmpFilters?.month?MONTHS.find(m=>String(m.value)===String(bsCmpFilters.month))?.label:"",bsCmpFilters?.year,bsCmpFilters?.source,bsCmpFilters?.structure,bsCmpFilters?.company].filter(Boolean).join(" · "):"";
    const bsCmp2Label=bsCompareMode?[bsCmp2Filters?.month?MONTHS.find(m=>String(m.value)===String(bsCmp2Filters.month))?.label:"",bsCmp2Filters?.year,bsCmp2Filters?.source,bsCmp2Filters?.structure,bsCmp2Filters?.company].filter(Boolean).join(" · "):"";
   if(opts.bsSummary){
      const bsSumRows=[];
      const walkBSSum=(node,d)=>{
        if(!hasData(node)||node.accountType!=="B/S")return;
        const total=Number(node.code)>=599999?-sumNode(node):sumNode(node);
        bsSumRows.push({name:node.name,depth:d,isBold:BS_HIGHLIGHTED_CODES.has(String(node.code)),total,isGroup:true});
        node.children?.filter(hasData).forEach(c=>walkBSSum(c,d+1));
      };
      bsRoots.forEach(n=>walkBSSum(n,0));
writeBSSheet("BS Summary",bsSumRows,
        bsCompareMode?bsCmpRoots.flatMap(n=>{const r=[];const w=(node,d)=>{if(!hasData(node)||node.accountType!=="B/S")return;r.push({name:node.name,depth:d,total:Number(node.code)>=599999?-sumNode(node):sumNode(node)});node.children?.filter(hasData).forEach(c=>w(c,d+1));};w(n,0);return r;}):null,
        bsCompareMode?bsCmp2Roots.flatMap(n=>{const r=[];const w=(node,d)=>{if(!hasData(node)||node.accountType!=="B/S")return;r.push({name:node.name,depth:d,total:Number(node.code)>=599999?-sumNode(node):sumNode(node)});node.children?.filter(hasData).forEach(c=>w(c,d+1));};w(n,0);return r;}):null
      );
    }
    if(opts.bsAssets){writeBSSheet("BS Assets",bsFlatRows(bsRoots,n=>isAssetsRoot(n)),bsCompareMode?bsFlatRows(bsCmpRoots,n=>isAssetsRoot(n)):null,bsCompareMode?bsFlatRows(bsCmp2Roots,n=>isAssetsRoot(n)):null);}
    if(opts.bsEquity){writeBSSheet("BS Equity & Liab",bsFlatRows(bsRoots,n=>!isAssetsRoot(n)),bsCompareMode?bsFlatRows(bsCmpRoots,n=>!isAssetsRoot(n)):null,bsCompareMode?bsFlatRows(bsCmp2Roots,n=>!isAssetsRoot(n)):null);}
    if(opts.dimJournal!==false){writeDimJournalSheet();}

    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;
    a.download=`Konsolidator_${year}_${String(month).padStart(2,"0")}.xlsx`;
    a.click();URL.revokeObjectURL(url);
  }

  const load=src=>new Promise((res,rej)=>{
    if(document.querySelector(`script[src="${src}"]`)){res();return;}
    const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });
  load("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js")
    .then(()=>doGenerate(window.ExcelJS))
    .catch(e=>alert("Could not load Excel library: "+e.message));
}

function generateKonsolidatorPdf({
  groupAccounts, uploadedAccounts, prevUploadedAccounts,
  compareMode,
  cmpUploadedAccounts, cmpPrevUploadedAccounts, cmpFilters,
  cmp2UploadedAccounts, cmp2PrevUploadedAccounts, cmp2Filters,
  bsCompareMode = false,
  bsCmpUploadedAccounts = [], bsCmpFilters = {},
  bsCmp2UploadedAccounts = [], bsCmp2Filters = {},
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
      {header:'C Mon',dataKey:'cmp2Mon'},
      {header:'Diff',dataKey:'devMon2'},
      {header:'Diff%',dataKey:'devMon2P'},
      {header:'YTD',dataKey:'ytd'},
      {header:'B YTD',dataKey:'cmpYtd'},
      {header:'Diff',dataKey:'devYtd'},
      {header:'Diff%',dataKey:'devYtdP'},
      {header:'C YTD',dataKey:'cmp2Ytd'},
      {header:'Diff',dataKey:'devYtd2'},
      {header:'Diff%',dataKey:'devYtd2P'},
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
      {header:'C',dataKey:'cmp2'},
      {header:'Diff',dataKey:'devC'},
      {header:'Diff%',dataKey:'devCP'},
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
      const cmpFL=compareMode?bsFlatRows(bsCmpRoots):[];
      const cmp2FL=compareMode?bsFlatRows(bsCmp2Roots):[];
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
  groupAccounts, uploadedAccounts, prevUploadedAccounts = [],
  compareMode, onToggleCompare,
  cmpUploadedAccounts = [], cmpPrevUploadedAccounts = [],
  cmpFilters, onCmpFilterChange,
  cmp2UploadedAccounts = [], cmp2PrevUploadedAccounts = [],
  cmp2Filters, onCmp2FilterChange,
  sources = [], structures = [], companies = [],
  dimGroups = [], cmpFilteredDims = [], cmp2FilteredDims = [],
  loading, error, month, year, source, structure,
  journalEntries = [],
}) {
const [expandedMap, setExpandedMap] = useState({});
  const [summaryMode, setSummaryMode] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
const [jrnPopup, setJrnPopup] = useState(null);
const [dimPopup, setDimPopup] = useState(null);
  
  const tree = useMemo(() => buildTree(groupAccounts, uploadedAccounts), [groupAccounts, uploadedAccounts]);

  const toggle = (code) => setExpandedMap(prev => ({ ...prev, [code]: !prev[code] }));

  // Collect all sum account nodes from P/L tree in ascending code order (post-order = leaves first)
  const allSumRows = useMemo(() => {
    const result = [];
    function walk(node) {
      if (!hasData(node)) return;
      if (!["P/L", "DIS"].includes(node.accountType)) return;
      (node.children || []).forEach(c => walk(c));
      if (node.isSumAccount) result.push(node);
    }
    tree
      .filter(n => hasData(n) && ["P/L","DIS"].includes(n.accountType))
      .sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}))
      .forEach(n => walk(n));
    return result;
  }, [tree]);

  const prevTree = useMemo(
  () => buildTree(groupAccounts, prevUploadedAccounts),
  [groupAccounts, prevUploadedAccounts]
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

const journalByCode = useMemo(() => {
  const idx = new Map();
  (journalEntries || []).forEach(row => {
    const code = String(row.accountCode ?? row.AccountCode ?? row.AccountCode ?? "");
    if (!code) return;
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntries]);

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
  () => compareMode ? buildTree(groupAccounts, cmpUploadedAccounts) : [],
  [groupAccounts, cmpUploadedAccounts, compareMode]
);
const cmpPrevTree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmpPrevUploadedAccounts) : [],
  [groupAccounts, cmpPrevUploadedAccounts, compareMode]
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
  () => compareMode ? buildTree(groupAccounts, cmp2UploadedAccounts) : [],
  [groupAccounts, cmp2UploadedAccounts, compareMode]
);
const cmp2PrevTree = useMemo(
  () => compareMode ? buildTree(groupAccounts, cmp2PrevUploadedAccounts) : [],
  [groupAccounts, cmp2PrevUploadedAccounts, compareMode]
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

const getCmp2Ytd = useCallback((code) => { const n = cmp2NodeByCode.get(code); return n ? sumNode(n) : 0; }, [cmp2NodeByCode]);
const getCmp2Prev = useCallback((code) => {
  if (Number(cmp2Filters?.month) === 1) return 0;
  const n = cmp2PrevNodeByCode.get(code); return n ? sumNode(n) : 0;
}, [cmp2PrevNodeByCode, cmp2Filters]);

const summaryRows = useMemo(() => {
  const plRows = allSumRows.filter(n => n.accountType === "P/L");
  if (!plRows.length) return [];
  

  // Group by level, keep one node per level (lowest code = main chain)
  const byLevel = {};
  plRows.forEach(n => {
    if (!byLevel[n.level] || Number(n.code) < Number(byLevel[n.level].code)) {
      byLevel[n.level] = n;
    }
  });

  return Object.values(byLevel)
    .sort((a,b) => String(a.code).localeCompare(String(b.code), undefined, {numeric:true}));
}, [allSumRows]);

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
      <p className="text-gray-400 text-sm">Loading P&L data…</p>
    </div>
  );

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
      <p className="text-gray-400 text-sm font-semibold">Waiting for data…</p>
    </div>
  );


  return (
<div className="space-y-4">
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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
<div className="bg-[#1a2f8a] px-6 py-4 flex items-center justify-between">
  <div>
    <p className="text-white font-black text-base">Profit & Loss</p>
  </div>
  {/* Hidden export trigger */}
  <button id="__plExportTrigger" onClick={handleExportPdf} className="hidden" />
  <button id="__plXlsxTrigger" onClick={handleExportXlsx} className="hidden" />
  <div className="flex items-center gap-3">
{compareMode && (
      <button onClick={() => setFiltersOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all bg-white/10 text-white/60 hover:text-white hover:bg-white/20">
        <ChevronDown size={12} className={`transition-transform duration-200 ${filtersOpen ? "" : "-rotate-90"}`} />
        {filtersOpen ? "Hide filters" : "Show filters"}
      </button>
    )}
    <button onClick={onToggleCompare}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all
        ${compareMode ? "bg-amber-400 text-[#1a2f8a]" : "bg-white/10 text-white/60 hover:text-white hover:bg-white/20"}`}>
      <GitMerge size={12} /> Compare
    </button>
    <div className="flex items-center gap-1 p-1 bg-white/10 rounded-xl">
      <button onClick={() => setSummaryMode(false)}
        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${!summaryMode ? "bg-white text-[#1a2f8a]" : "text-white/60 hover:text-white"}`}>
        Detailed
      </button>
      <button onClick={() => setSummaryMode(true)}
        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${summaryMode ? "bg-white text-[#1a2f8a]" : "text-white/60 hover:text-white"}`}>
        Summary
      </button>
    </div>
  </div>
</div>

{compareMode && filtersOpen && (
  <div className="border-t border-white/10">
    <div className="bg-[#ffffff] px-6 py-3 flex items-center gap-2 flex-wrap shadow-xl">
      <div className="w-3 h-3 rounded-full border-2 border-[#CF305D] flex-shrink-0" />
      <span className="text-white/40 text-[9px] font-black uppercase tracking-widest flex-shrink-0 shadow-xl"></span>
        

      <FilterPill dark label="Yr" value={cmpFilters.year} onChange={v => onCmpFilterChange("year", v)}
        options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
      <FilterPill dark label="Mnth" value={cmpFilters.month} onChange={v => onCmpFilterChange("month", v)}
        options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
      <FilterPill dark label="Src" value={cmpFilters.source} onChange={v => onCmpFilterChange("source", v)}
        options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
      <FilterPill dark label="Struct" value={cmpFilters.structure} onChange={v => onCmpFilterChange("structure", v)}
        options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
      <FilterPill dark label="Comp" value={cmpFilters.company} onChange={v => onCmpFilterChange("company", v)}
        options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); return { value: v, label: v }; })} />
      <FilterPill dark label="Dim Grp" value={cmpFilters.dimGroup} onChange={v => onCmpFilterChange("dimGroup", v)}
        options={[{ value: "", label: "All" }, ...dimGroups.map(g => ({ value: g, label: g }))]} />
      <FilterPill dark label="Dim" value={cmpFilters.dimension} onChange={v => onCmpFilterChange("dimension", v)}
        options={[{ value: "", label: "All" }, ...cmpFilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })]} />
    </div>
    <div className="bg-[#ffffff] px-6 py-3 flex items-center gap-2 flex-wrap border-t border-white/10">
      <div className="w-3 h-3 rounded-full border-2 border-[#57aa78] flex-shrink-0" />

      <span className="text-white/40 text-[9px] font-black uppercase tracking-widest flex-shrink-0"></span>
      
      <FilterPill dark label="Yr" value={cmp2Filters?.year} onChange={v => onCmp2FilterChange("year", v)}
        options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
      <FilterPill dark label="Mnth" value={cmp2Filters?.month} onChange={v => onCmp2FilterChange("month", v)}
        options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
      <FilterPill dark label="Src" value={cmp2Filters?.source} onChange={v => onCmp2FilterChange("source", v)}
        options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
      <FilterPill dark label="Struct" value={cmp2Filters?.structure} onChange={v => onCmp2FilterChange("structure", v)}
        options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
      <FilterPill dark label="Comp" value={cmp2Filters?.company} onChange={v => onCmp2FilterChange("company", v)}
        options={companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); return { value: v, label: v }; })} />
      <FilterPill dark label="Dim Grp" value={cmp2Filters?.dimGroup} onChange={v => onCmp2FilterChange("dimGroup", v)}
        options={[{ value: "", label: "All" }, ...dimGroups.map(g => ({ value: g, label: g }))]} />
      <FilterPill dark label="Dim" value={cmp2Filters?.dimension} onChange={v => onCmp2FilterChange("dimension", v)}
        options={[{ value: "", label: "All" }, ...cmp2FilteredDims.map(d => { const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d); const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d); return { value: v, label: l }; })]} />
    </div>
  </div>
)}




<div className="overflow-auto" style={{ maxHeight: !compareMode ? "calc(113vh - 320px)" : filtersOpen ? "calc(122.5vh - 530px)" : "calc(120vh - 390px)" }}>
          <table className="w-full">
<thead className="sticky top-0 z-10">
  {compareMode && (() => {
    const cmpLabel  = [cmpFilters.year, MONTHS.find(m => String(m.value) === String(cmpFilters.month))?.label, cmpFilters.source, cmpFilters.structure, cmpFilters.dimension].filter(Boolean).join(" · ") || "Period B";
    const cmp2Label = [cmp2Filters?.year, MONTHS.find(m => String(m.value) === String(cmp2Filters?.month))?.label, cmp2Filters?.source, cmp2Filters?.structure, cmp2Filters?.dimension].filter(Boolean).join(" · ") || "Period C";
    return (
      <tr className="bg-[#1a2f8a]">
        <th className="bg-[#eef1fb]" />
        <th className="bg-[#eef1fb]" />
        <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#CF305D] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10">{cmpLabel}</th>
        <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#57aa78] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10">{cmp2Label}</th>
        <th className="bg-[#eef1fb]" />
        <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#CF305D] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10">{cmpLabel}</th>
        <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#57aa78] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10">{cmp2Label}</th>
      </tr>
    );
  })()}
  <tr className="border-b border-gray-100 bg-[#eef1fb]">
    <th className="text-left px-6 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest bg-[#eef1fb]">Account</th>
    <th className="text-right pr-6 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest w-36 bg-[#eef1fb]">Monthly</th>
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-36 bg-[#eef1fb]">Month (B)</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-28 bg-[#eef1fb]">Month Δ</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-20 bg-[#eef1fb]">Δ%</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-36 bg-[#eef1fb]">Month (C)</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-28 bg-[#eef1fb]">Month Δ</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-20 bg-[#eef1fb]">Δ%</th>}
    <th className="text-right pr-6 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest w-36 bg-[#eef1fb]">YTD</th>
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-36 bg-[#eef1fb]">YTD (B)</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-28 bg-[#eef1fb]">YTD Δ</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-20 bg-[#eef1fb]">Δ%</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-36 bg-[#eef1fb]">YTD (C)</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-28 bg-[#eef1fb]">YTD Δ</th>}
    {compareMode && <th className="text-right pr-6 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-20 bg-[#eef1fb]">Δ%</th>}
  </tr>
</thead>
            <tbody>
{(summaryMode ? summaryRows : allSumRows).map(node => {
const ytd      = -sumNode(node);
const prevYtd  = -getPrevYtd(node.code);
const cmpYtd = compareMode ? -getCmpYtd(node.code) : 0;
const cmpMon = compareMode ? -getCmpYtd(node.code) - (-getCmpPrev(node.code)) : 0;
const mon      = ytd - prevYtd;
const expanded = !!expandedMap[node.code];
const hasKids  = !summaryMode && (node.children||[]).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType)).length > 0;

  return [
<tr key={node.code}
      className={`border-b border-gray-100 cursor-pointer ${PL_HIGHLIGHTED_CODES.has(String(node.code)) ? "bg-[#eef1fb]" : "bg-white"} hover:bg-[#eef1fb]/60 transition-colors`}
      onClick={() => toggle(node.code)}>
      <td className="py-3 px-6">
        <div className="flex items-center gap-2">
          {hasKids
            ? <span className="text-[#1a2f8a]/50">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
            : <span className="w-3"/>}
          <span className={`text-xs ${PL_HIGHLIGHTED_CODES.has(String(node.code)) ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>{node.name}</span>

        </div>
      </td>
<PLAmountCell value={mon} bold />
{compareMode && <PLAmountCell value={cmpMon} bold />}
{compareMode && <DeviationCells a={mon} b={cmpMon} bold />}
{compareMode && (() => {
  const cmp2Ytd = -getCmp2Ytd(node.code);
  const cmp2Mon = cmp2Ytd - (-getCmp2Prev(node.code));
  return <>
    <PLAmountCell value={cmp2Mon} bold />
    <DeviationCells a={mon} b={cmp2Mon} bold />
  </>;
})()}
<PLAmountCell value={ytd} bold />
{compareMode && <PLAmountCell value={cmpYtd} bold />}
{compareMode && <DeviationCells a={ytd} b={cmpYtd} bold />}
{compareMode && (() => {
  const cmp2Ytd = -getCmp2Ytd(node.code);
  return <>
    <PLAmountCell value={cmp2Ytd} bold />
    <DeviationCells a={ytd} b={cmp2Ytd} bold />
  </>;
})()}

    </tr>,
...(expanded ? [
  <tr key={`${node.code}-expanded`}>
    <td colSpan={compareMode ? 15 : 3} className="p-0">
      <div className="bg-[#f8f9ff] border-b border-[#1a2f8a]/10">
        <table className="w-full">
          <tbody>
            {(function renderChildren(children, leaves, depth) {
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

const childBg = depth === 0 ? "bg-[#f4f6fd]" : depth === 1 ? "bg-[#f8f9ff]" : "bg-white";
    rows.push(
      <tr key={child.code}
        className={`border-b border-[#1a2f8a]/5 transition-colors ${childBg} ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : "hover:bg-[#eef1fb]/20"}`}
        onClick={hasMore ? () => setExpandedMap(prev => ({ ...prev, [`drill-${node.code}-${child.code}`]: !prev[`drill-${node.code}-${child.code}`] })): undefined}>
        <td className="py-2" style={{ paddingLeft: `${24 + depth * 20}px` }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-px bg-[#1a2f8a]/20 flex-shrink-0" />
            {hasMore
              ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{childExpanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            <span className={`text-xs ${child.isSumAccount ? "font-bold text-[#1a2f8a]" : depth === 0 ? "text-gray-700 font-medium" : "text-gray-500"}`}>{child.name}</span>
          </div>
        </td>
        <PLAmountCell value={cMon} bold={child.isSumAccount} />
        {compareMode && <PLAmountCell value={cCmpMon} bold={child.isSumAccount} />}
        {compareMode && <DeviationCells a={cMon} b={cCmpMon} bold={child.isSumAccount} />}
        {compareMode && <PLAmountCell value={cCmp2Mon} bold={child.isSumAccount} />}
        {compareMode && <DeviationCells a={cMon} b={cCmp2Mon} bold={child.isSumAccount} />}
        <PLAmountCell value={cYtd} bold={child.isSumAccount} />
        {compareMode && <PLAmountCell value={cCmpYtd} bold={child.isSumAccount} />}
        {compareMode && <DeviationCells a={cYtd} b={cCmpYtd} bold={child.isSumAccount} />}
        {compareMode && <PLAmountCell value={cCmp2Ytd} bold={child.isSumAccount} />}
        {compareMode && <DeviationCells a={cYtd} b={cCmp2Ytd} bold={child.isSumAccount} />}
      </tr>
    );

if (childExpanded && hasMore) {
      rows.push(...renderChildren(grandkids, child.uploadLeaves || [], depth + 1));
    }

    if (childExpanded) {
      const jrnRows = (journalByCode.get(child.code) || []);
      if (jrnRows.length > 0) {
        const jrnKey = `jrn-child-${node.code}-${child.code}`;
        const jrnExpanded = !!expandedMap[jrnKey];
        rows.push(
          <tr key={jrnKey}
            className="border-b border-[#1a2f8a]/5 cursor-pointer hover:bg-indigo-50/40 transition-colors"
            onClick={() => setExpandedMap(prev => ({ ...prev, [jrnKey]: !prev[jrnKey] }))}>
            <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-px bg-indigo-200 flex-shrink-0" />
<span className="text-[#1a2f8a]/40 flex-shrink-0">
                  {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}
                </span>
                <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0">
                  journal
                </span>
                <span className="text-[10px] text-gray-400">{jrnRows.length} entries</span>
              </div>
            </td>
            <td />{compareMode && <><td /><td /><td /><td /><td /></>}<td />{compareMode && <><td /><td /><td /><td /><td /></>}
          </tr>
        );
        if (jrnExpanded) {
          jrnRows.forEach((jrn, k) => {
            const amt = parseAmt(jrn.amountYTD ?? jrn.AmountYTD ?? 0);
            rows.push(
<tr key={`jrn-child-entry-${node.code}-${child.code}-${k}`}
                className="border-b border-[#1a2f8a]/5 hover:bg-indigo-50/40 transition-colors bg-indigo-50/10 cursor-pointer"
                onClick={() => setJrnPopup(jrn)}>
                <td className="py-1" style={{ paddingLeft: `${24 + (depth + 2) * 20}px` }}>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-200 flex-shrink-0" />
                      <span className="text-[10px] font-mono font-bold text-indigo-500 flex-shrink-0 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">{jrn.journalNumber ?? jrn.JournalNumber ?? ""}</span>
                      {(jrn.journalHeader ?? jrn.JournalHeader) && <span className="text-[10px] text-gray-500 flex-shrink-0">{jrn.journalHeader ?? jrn.JournalHeader}</span>}
                      {(jrn.rowText ?? jrn.RowText) && <span className="text-[10px] text-gray-400 italic truncate max-w-[250px]">— {jrn.rowText ?? jrn.RowText}</span>}
                      {(jrn.counterpartyShortName ?? jrn.CounterpartyShortName) && <span className="text-[10px] font-medium text-indigo-300 ml-auto flex-shrink-0">{jrn.counterpartyShortName ?? jrn.CounterpartyShortName}</span>}
                    </div>
                </td>
                <PLAmountCell value={-amt} bold={false} />
                {compareMode && <><td /><td /><td /><td /><td /></>}
                <PLAmountCell value={-amt} bold={false} />
                {compareMode && <><td /><td /><td /><td /><td /></>}
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
    const leafKey = `drill-leaf-${node.code}-${depth}-${i}`;
    const leafExpanded = !!expandedMap[leafKey];
    const hasDims = leaf.type === "localAccount" && leaf.children?.length > 0;
    const amt = leaf.amount ?? 0;

    rows.push(
      <tr key={leafKey}
        className={`border-b border-[#1a2f8a]/5 transition-colors bg-[#fafbff] ${hasDims ? "cursor-pointer hover:bg-amber-50/30" : "hover:bg-[#f0f3ff]"}`}
        onClick={hasDims ? () => setExpandedMap(prev => ({ ...prev, [leafKey]: !prev[leafKey] })) : undefined}>
        <td className="py-1.5" style={{ paddingLeft: `${24 + depth * 20}px` }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-px bg-[#1a2f8a]/10 flex-shrink-0" />
            {hasDims
              ? <span className="text-gray-300 flex-shrink-0">{leafExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            {leaf.code && <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{leaf.code}</span>}
            <span className="text-xs text-gray-500 italic">{leaf.name || ""}</span>
          </div>
        </td>
<PLAmountCell value={-(amt - (leaf.code ? getPrevLeafAmt(leaf.code) : 0))} bold={false} />
        {compareMode && <><td /><td /><td /><td /><td /><td /></>}
        <PLAmountCell value={-amt} bold={false} />
        {compareMode && <><td /><td /><td /><td /><td /><td /></>}
      </tr>
    );

    if (leafExpanded && hasDims) {
      leaf.children.forEach((dim, j) => {
        rows.push(
<tr key={`dim-${depth}-${i}-${j}`}
            className="border-b border-[#1a2f8a]/5 hover:bg-amber-50/40 transition-colors bg-amber-50/10 cursor-pointer"
            onClick={() => setDimPopup(dim)}>
            <td className="py-1" style={{ paddingLeft: `${24 + (depth + 1) * 20}px` }}>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-px bg-amber-200 flex-shrink-0" />
                <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">dim</span>
                <span className="text-xs text-gray-400 italic">{dim.name || dim.code}</span>
              </div>
            </td>
<PLAmountCell value={-(dim.amount - getPrevDimAmt(leaf.code, dim.code))} bold={false} />
            {compareMode && <><td /><td /><td /><td /><td /><td /></>}
            <PLAmountCell value={-dim.amount} bold={false} />
            {compareMode && <><td /><td /><td /><td /><td /><td /></>}
          </tr>
        );
      });
    }
  });

  return rows;
})(node.children || [], node.uploadLeaves || [], 0)}
          </tbody>
        </table>
      </div>
    </td>
  </tr>
] : []),
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
            Expand all
          </button>
          <button onClick={() => setExpandedMap({})}
            className="px-3 py-2 rounded-xl bg-white border border-gray-100 shadow-sm text-xs font-bold text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/20 transition-all">
            Collapse all
          </button>
        </div>
      </div>

      {visibleRoots.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-xl">
          <p className="text-gray-400 text-sm font-semibold">No accounts match this filter</p>
          <p className="text-gray-300 text-xs mt-1">Try a different type filter or clear the search</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-[#1a2f8a]/5">
                  <th className="text-left px-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest">Account</th>
                  <th className="text-right px-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest whitespace-nowrap w-36">Amount Period</th>
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

const PL_HIGHLIGHTED_CODES = new Set([
  '11999',  // Revenue
  '15999',  // Contribution
  '53999',  // EBITDA
  '57999',  // EBIT
  '69999',  // EBT
  '89999',  // Profit/loss for the year
]);




function BalanceSheet({ groupAccounts, uploadedAccounts, loading, error, month, year, source, structure, company, sources, structures, companies, dimGroups, token, journalEntries = [], onCompareChange,
  compareMode, setCompareMode,
  cmpYear, setCmpYear, cmpMonth, setCmpMonth, cmpSource, setCmpSource, cmpStructure, setCmpStructure, cmpCompany, setCmpCompany,
  cmpData, setCmpData,
  cmp2Year, setCmp2Year, cmp2Month, setCmp2Month, cmp2Source, setCmp2Source, cmp2Structure, setCmp2Structure, cmp2Company, setCmp2Company,
  cmp2Data, setCmp2Data,
}) {
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [cmp2Loading, setCmp2Loading] = useState(false);
const [bsView, setBsView] = useState("summary");
  const [bsDrillMap, setBsDrillMap] = useState({});
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
    if (!idx.has(code)) idx.set(code, []);
    idx.get(code).push(row);
  });
  return idx;
}, [journalEntries]);

const [allCompaniesData, setAllCompaniesData] = useState([]);
const [allCompaniesLoading, setAllCompaniesLoading] = useState(false);




const fetchAllCompanies = useCallback(async () => {
  if (!year || !month || !source || !structure) return;
  setAllCompaniesLoading(true);
  try {
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    const res = await fetch(
      `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    const json = res.ok ? await res.json() : { value: [] };
    setAllCompaniesData(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setAllCompaniesData([]); }
  finally { setAllCompaniesLoading(false); }
}, [year, month, source, structure, token]);

useEffect(() => {
  if (bsView !== "summary") fetchAllCompanies();
}, [bsView, fetchAllCompanies]);

const [allCompaniesCmpData, setAllCompaniesCmpData] = useState([]);
const [allCompaniesCmp2Data, setAllCompaniesCmp2Data] = useState([]);

const fetchAllCompaniesCmp = useCallback(async (yr, mo, src, str) => {
  const y = yr ?? cmpYear; const m = mo ?? cmpMonth;
  const s = src ?? cmpSource; const st = str ?? cmpStructure;
  if (!y || !m || !s || !st) return;
  try {
    const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}'`;
    const res = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json = res.ok ? await res.json() : { value: [] };
    setAllCompaniesCmpData(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setAllCompaniesCmpData([]); }
}, [cmpYear, cmpMonth, cmpSource, cmpStructure, token]);

const fetchAllCompaniesCmp2 = useCallback(async (yr, mo, src, str) => {
  const y = yr ?? cmp2Year; const m = mo ?? cmp2Month;
  const s = src ?? cmp2Source; const st = str ?? cmp2Structure;
  if (!y || !m || !s || !st) return;
  try {
    const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}'`;
    const res = await fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json = res.ok ? await res.json() : { value: [] };
    setAllCompaniesCmp2Data(json.value ?? (Array.isArray(json) ? json : []));
  } catch { setAllCompaniesCmp2Data([]); }
}, [cmp2Year, cmp2Month, cmp2Source, cmp2Structure, token]);

useEffect(() => {
  if (bsView !== "summary" && compareMode) {
    fetchAllCompaniesCmp();
    fetchAllCompaniesCmp2();
  }
}, [bsView, compareMode, fetchAllCompaniesCmp, fetchAllCompaniesCmp2]);

const companyColumns = useMemo(() => {
  const seen = new Set();
  const cols = [];
  allCompaniesData.forEach(r => {
    const co = String(r.CompanyShortName ?? r.companyShortName ?? "");
    const cur = String(r.CurrencyCode ?? r.currencyCode ?? "");
    const key = `${co}|||${cur}`;
    if (co && !seen.has(key)) { seen.add(key); cols.push({ company: co, currency: cur }); }
  });
  return cols.sort((a, b) => a.company.localeCompare(b.company));
}, [allCompaniesData]);

const companyTree = useMemo(() => {
  if (!allCompaniesData.length) return [];
  return buildTree(groupAccounts, allCompaniesData);
}, [groupAccounts, allCompaniesData]);


function renderBSDrill(node, parentKey) {
  console.log("renderBSDrill called:", parentKey, "expanded:", !!bsDrillMap[parentKey]);
  if (!bsDrillMap[parentKey]) return null;
  const children = (node.children || []).filter(hasData);
  const leaves = (node.uploadLeaves || []).filter(l => l.type !== "plain");

  const renderDrillChildren = (children, leaves, depth, contextKey) => {
    const rows = [];
    console.log("BS drill children codes:", children.map(c => c.code), "journalByCode keys:", [...journalByCode.keys()]);
    children.forEach(c => {
      const jrns = journalByCode.get(c.code);
      if (jrns) console.log("MATCH FOUND:", c.code, jrns.length, "entries");
      else console.log("NO MATCH:", c.code, "not in", [...journalByCode.keys()]);
    });
    children.forEach(c => {
      const jrns = journalByCode.get(c.code);
      if (jrns) console.log("MATCH FOUND:", c.code, jrns.length, "entries");
      else console.log("NO MATCH:", c.code, "not in", [...journalByCode.keys()]);
    });

    children.filter(hasData).forEach(child => {
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
          <td className="py-2" style={{ paddingLeft: `${24 + depth * 20}px` }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-px bg-[#1a2f8a]/20 flex-shrink-0" />
              {hasMore
                ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{childExpanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
                : <span className="w-3 flex-shrink-0" />}
              <span className={`text-xs ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>{child.name}</span>
            </div>
          </td>
          <td className={`text-right pr-8 py-2 font-mono text-xs whitespace-nowrap ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>
            {total === 0 ? "—" : fmtAmt(total)}
          </td>
        </tr>
      );

if (childExpanded && hasMore) {
        rows.push(...renderDrillChildren(
          grandkids,
          child.uploadLeaves?.filter(l => l.type !== "plain") || [],
          depth + 1,
          childKey
        ));
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
                  <td className="text-right pr-8 py-1 font-mono text-xs text-indigo-400">
                    {amt === 0 ? "—" : fmtAmt(amt)}
                  </td>
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
          className={`border-b border-[#1a2f8a]/5 transition-colors ${hasDims ? "cursor-pointer hover:bg-amber-50/40" : "hover:bg-[#eef1fb]/20"}`}
          onClick={hasDims ? () => setBsDrillMap(prev => ({ ...prev, [leafKey]: !prev[leafKey] })) : undefined}>
          <td className="py-1.5" style={{ paddingLeft: `${24 + depth * 20}px` }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-px bg-[#1a2f8a]/10 flex-shrink-0" />
              {hasDims
                ? <span className="text-gray-300 flex-shrink-0">{leafExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>}</span>
                : <span className="w-3 flex-shrink-0" />}
              {leaf.code && <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{leaf.code}</span>}
              <span className="text-xs text-gray-500 italic">{leaf.name || ""}</span>
            </div>
          </td>
          <td className="text-right pr-8 py-1.5 font-mono text-xs text-gray-600">
            {amt === 0 ? "—" : fmtAmt(amt)}
          </td>
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
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">dim</span>
                  <span className="text-xs text-gray-400 italic">{dim.name || dim.code}</span>
                </div>
              </td>
              <td className="text-right pr-8 py-1 font-mono text-xs text-gray-400">
                {dim.amount === 0 ? "—" : fmtAmt(dim.amount)}
              </td>
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
                    {jrnExpanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>} journal
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
                  <td className="text-right pr-8 py-1 font-mono text-xs text-indigo-400">
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

  return renderDrillChildren(children, leaves, 0, parentKey);
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
    const isBold = BS_HIGHLIGHTED_CODES.has(String(node.code));
    const kids = (node.children || []).filter(hasData);
    const drillKey = `bsmulti-${node.code}`;
    const expanded = !!bsDrillMap[drillKey];
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
            <span className={`text-xs ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>{node.name}</span>
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
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[120px] ${isBold ? "font-bold text-[#CF305D]" : "text-[#CF305D]"}`}>
                  {cmpVal === 0 ? "-" : fmtAmt(cmpVal)}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[90px] ${devColor(devB)}`}>
                  {devB === 0 ? "-" : fmtAmt(devB)}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[70px] font-bold ${devColor(devB)}`}>
                  {devBPct === null ? "—" : `${devBPct >= 0 ? "+" : ""}${devBPct.toFixed(1)}%`}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[120px] ${isBold ? "font-bold text-[#57aa78]" : "text-[#57aa78]"}`}>
                  {cmp2Val === 0 ? "-" : fmtAmt(cmp2Val)}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[90px] ${devColor(devC)}`}>
                  {devC === 0 ? "-" : fmtAmt(devC)}
                </td>
                <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap min-w-[70px] font-bold ${devColor(devC)}`}>
                  {devCPct === null ? "—" : `${devCPct >= 0 ? "+" : ""}${devCPct.toFixed(1)}%`}
                </td>
              </>}
            </React.Fragment>
          );
        })}
      </tr>
    );

    if (expanded && hasMore) {
      const drillRows = renderBSDrill(node, drillKey);
      if (drillRows?.length) {
        rows.push(
          <tr key={`${drillKey}-expanded`}>
            <td colSpan={compareMode ? companyColumns.length * 7 + 1 : companyColumns.length + 1} className="p-0">
              <div className="bg-[#f8f9ff] border-b border-[#1a2f8a]/10">
                <table className="w-full"><tbody>{drillRows}</tbody></table>
              </div>
            </td>
          </tr>
        );
      }
    }
  }
  filteredRoots.forEach(node => renderNode(node));

  
  return rows;
}

function renderBSRows(nodes) {
  const rows = [];
  nodes.filter(hasData).forEach(node => {
    const total = Number(node.code) >= 599999 ? -sumNode(node) : sumNode(node);
    const isBold = BS_HIGHLIGHTED_CODES.has(String(node.code));
    const kids = (node.children || []).filter(hasData).filter(c => c.level <= 4);
    const drillKey = `bsrow-${node.code}`;
    const hasMore = kids.length > 0 || node.uploadLeaves?.filter(l => l.type !== "plain").length > 0;
    const expanded = !!bsDrillMap[drillKey];
console.log("renderBSRows node:", node.code, "drillKey:", drillKey, "expanded:", expanded, "bsDrillMap keys:", Object.keys(bsDrillMap));
    if (kids.length > 0) rows.push(...renderBSRows(kids));

    rows.push(
      <tr key={node.code}
        className={`border-b border-gray-100 ${isBold ? "bg-[#eef1fb]" : "bg-white"} ${hasMore ? "cursor-pointer hover:bg-[#eef1fb]/60" : ""} transition-colors`}
        onClick={hasMore ? () => { console.log("clicking BS row", drillKey); bsDrill(drillKey); } : undefined}>
        <td className="px-6 py-2.5">
          <div className="flex items-center gap-2">
            {hasMore
              ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{expanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
              : <span className="w-3 flex-shrink-0" />}
            <span className={`text-xs ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>{node.name}</span>
          </div>
        </td>
        <td className={`text-right pr-8 py-2.5 font-mono text-xs whitespace-nowrap w-40 ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>
          {total === 0 ? "-" : fmtAmt(total)}
        </td>
      </tr>
    );

if (expanded && hasMore) {
      console.log("calling renderBSDrill for", node.code, drillKey, "expanded:", expanded);
      const drillRows = renderBSDrill(node, drillKey);
      if (drillRows?.length) {
        rows.push(
          <tr key={`${drillKey}-expanded`}>
            <td colSpan={2} className="p-0">
              <div className="bg-[#f8f9ff] border-b border-[#1a2f8a]/10">
                <table className="w-full"><tbody>{drillRows}</tbody></table>
              </div>
            </td>
          </tr>
        );
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

  const tree = useMemo(() => buildTree(groupAccounts, uploadedAccounts), [groupAccounts, uploadedAccounts]);
  const cmpTree = useMemo(() => compareMode ? buildTree(groupAccounts, cmpData) : [], [groupAccounts, cmpData, compareMode]);
  const cmp2Tree = useMemo(() => compareMode ? buildTree(groupAccounts, cmp2Data) : [], [groupAccounts, cmp2Data, compareMode]);

  const bsRoots = useMemo(() => tree.filter(n => hasData(n) && n.accountType === "B/S")
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })), [tree]);

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
    nodes.filter(hasData).forEach(node => {
      const isBold = BS_HIGHLIGHTED_CODES.has(String(node.code));
      const kids = (node.children || []).filter(hasData).filter(c => c.level <= 4);
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

      rows.push(
        <tr key={node.code} className={`border-b border-gray-100 ${isBold ? "bg-[#eef1fb]" : "bg-white"}`}>
          <td className="px-6 py-2.5">
            <span className={`text-xs ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>{node.name}</span>
          </td>
          {/* Actual */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-36 ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-600"}`}>
            {actual === 0 ? "-" : fmtAmt(actual)}
          </td>
          {/* B */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-36 ${isBold ? "font-bold text-[#CF305D]" : "text-[#CF305D]"}`}>
            {cmp === 0 ? "-" : fmtAmt(cmp)}
          </td>
          {/* B Δ */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-28 ${isBold ? "font-bold" : ""} ${devColor(devB)}`}>
            {devB === 0 ? "-" : fmtAmt(devB)}
          </td>
          {/* B Δ% */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-20 ${isBold ? "font-bold" : ""} ${devColor(devB)}`}>
            {devBPct === null ? "—" : `${devBPct >= 0 ? "+" : ""}${devBPct.toFixed(1)}%`}
          </td>
          {/* C */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-36 ${isBold ? "font-bold text-[#57aa78]" : "text-[#57aa78]"}`}>
            {cmp2 === 0 ? "-" : fmtAmt(cmp2)}
          </td>
          {/* C Δ */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-28 ${isBold ? "font-bold" : ""} ${devColor(devC)}`}>
            {devC === 0 ? "-" : fmtAmt(devC)}
          </td>
{/* C Δ% */}
          <td className={`text-right pr-4 py-2.5 font-mono text-xs whitespace-nowrap w-20 ${isBold ? "font-bold" : ""} ${devColor(devC)}`}>
            {devCPct === null ? "—" : `${devCPct >= 0 ? "+" : ""}${devCPct.toFixed(1)}%`}
          </td>
        </tr>
      );
      const drillKeyCmp = `bscmp-${node.code}`;
      const hasMoreCmp = kids.length > 0 || node.uploadLeaves?.filter(l => l.type !== "plain").length > 0;
      if (bsDrillMap[drillKeyCmp] && hasMoreCmp) {
        const drillRows = renderBSDrill(node, drillKeyCmp);
        if (drillRows?.length) {
          rows.push(
            <tr key={`${drillKeyCmp}-expanded`}>
              <td colSpan={8} className="p-0">
                <div className="bg-[#f8f9ff] border-b border-[#1a2f8a]/10">
                  <table className="w-full"><tbody>{drillRows}</tbody></table>
                </div>
              </td>
            </tr>
          );
        }
      }
    });
    return rows;
  }

  if (loading) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
      <Loader2 size={28} className="text-[#1a2f8a] animate-spin mx-auto mb-3" />
      <p className="text-gray-400 text-sm">Loading Balance Sheet…</p>
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

  const cmpLabel = [cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource, cmpStructure].filter(Boolean).join(" · ") || "Period B";
  const cmp2Label = [cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source, cmp2Structure].filter(Boolean).join(" · ") || "Period C";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
      
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
{/* Header */}
      <div className="bg-[#1a2f8a] px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-white font-black text-base">Balance Sheet</p>

        </div>
        <div className="flex items-center gap-3">
{compareMode && (
            <button onClick={() => setFiltersOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all bg-white/10 text-white/60 hover:text-white hover:bg-white/20">
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all
              ${compareMode ? "bg-amber-400 text-[#1a2f8a]" : "bg-white/10 text-white/60 hover:text-white hover:bg-white/20"}`}>
            <GitMerge size={12} /> Compare
          </button>

          <div className="flex items-center gap-1 p-1 bg-white/10 rounded-xl">
            {[["summary","Summary"],["assets","Assets"],["equity","Equity & Liab."]].map(([v, label]) => (
              <button key={v} onClick={() => setBsView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all
                  ${bsView === v ? "bg-white text-[#1a2f8a]" : "text-white/60 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Compare filters */}
      {compareMode && filtersOpen && (
        <div className="border-t border-white/10">
          <div className="bg-[#ffffff] px-6 py-3 flex items-center gap-2 flex-wrap shadow-sm">
            <div className="w-3 h-3 rounded-full border-2 border-[#CF305D] flex-shrink-0" />
            {[
              { label: "Yr", value: cmpYear, set: setCmpYear, opts: YEARS.map(y => ({ value: String(y), label: String(y) })) },
              { label: "Mnth", value: cmpMonth, set: setCmpMonth, opts: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
              { label: "Src", value: cmpSource, set: setCmpSource, opts: sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; }) },
              { label: "Struct", value: cmpStructure, set: setCmpStructure, opts: structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; }) },
              { label: "Comp", value: cmpCompany, set: setCmpCompany, opts: companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); return { value: v, label: v }; }) },
            ].map(({ label, value, set, opts }) => (
              <FilterPill key={label} dark label={label} value={value} onChange={set} options={opts} />
            ))}
          </div>
          <div className="bg-[#ffffff] px-6 py-3 flex items-center gap-2 flex-wrap border-t border-gray-100">
            <div className="w-3 h-3 rounded-full border-2 border-[#57aa78] flex-shrink-0" />
            {[
              { label: "Yr", value: cmp2Year, set: setCmp2Year, opts: YEARS.map(y => ({ value: String(y), label: String(y) })) },
              { label: "Mnth", value: cmp2Month, set: setCmp2Month, opts: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
              { label: "Src", value: cmp2Source, set: setCmp2Source, opts: sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; }) },
              { label: "Struct", value: cmp2Structure, set: setCmp2Structure, opts: structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; }) },
              { label: "Comp", value: cmp2Company, set: setCmp2Company, opts: companies.map(c => { const v = typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "") : String(c); return { value: v, label: v }; }) },
            ].map(({ label, value, set, opts }) => (
              <FilterPill key={label} dark label={label} value={value} onChange={set} options={opts} />
            ))}
          </div>
        </div>
      )}

      {/* Table */}
<div style={{ overflowX: "auto", overflowY: "auto", maxHeight: !compareMode ? "calc(112vh - 320px)" : filtersOpen ? "calc(121.7vh - 530px)" : "calc(120vh - 390px)" }}>
        <table className="w-full">
          <thead>
{bsView === "summary" && compareMode && (
              <tr className="bg-[#1a2f8a]" style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <th className="bg-[#eef1fb]" />
                <th className="bg-[#eef1fb]" />
                <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#CF305D] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10">{cmpLabel}</th>
                <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#57aa78] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10">{cmp2Label}</th>
              </tr>
            )}
         {bsView === "summary" ? (
              <tr className="border-b border-gray-100 bg-[#eef1fb]" style={{ position: "sticky", top: compareMode ? "37px" : 0, zIndex: 10 }}>
                <th className="text-left px-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest">Account</th>
                <th className="text-right pr-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest w-36">
                  Actual<br />
                  <span className="text-[10px] font-bold text-[#1a2f8a]/50 normal-case tracking-normal">{monthLabel?.slice(0, 3)}-{String(year).slice(2)}</span>
                </th>
                {compareMode && <th className="text-right pr-4 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-36">B</th>}
                {compareMode && <th className="text-right pr-4 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-28">B Δ</th>}
                {compareMode && <th className="text-right pr-4 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest w-20">B Δ%</th>}
                {compareMode && <th className="text-right pr-4 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-36">C</th>}
                {compareMode && <th className="text-right pr-4 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-28">C Δ</th>}
                {compareMode && <th className="text-right pr-4 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest w-20">C Δ%</th>}
              </tr>
) : (
  <>
{compareMode && (
  <tr className="bg-[#1a2f8a]">
    <th className="bg-[#eef1fb] sticky left-0 z-20" style={{ position: "sticky", top: 0 }} />
    <th className="bg-[#eef1fb]" style={{ position: "sticky", top: 0 }} />
    {companyColumns.map(({ company }) => (
      <React.Fragment key={company}>
        <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#CF305D] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10" style={{ position: "sticky", top: 0 }}>
          {[cmpYear, MONTHS.find(m => String(m.value) === String(cmpMonth))?.label, cmpSource, cmpStructure].filter(Boolean).join(" · ") || "Period B"}
        </th>
        <th colSpan={3} className="text-center py-2 text-[9px] font-black uppercase tracking-widest text-[#57aa78] bg-[#dae1ff] whitespace-nowrap px-3 border-l border-white/10" style={{ position: "sticky", top: 0 }}>
          {[cmp2Year, MONTHS.find(m => String(m.value) === String(cmp2Month))?.label, cmp2Source, cmp2Structure].filter(Boolean).join(" · ") || "Period C"}
        </th>
      </React.Fragment>
    ))}
  </tr>
)}
<tr className="border-b border-gray-100 bg-[#eef1fb]">
  <th className="text-left px-6 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest bg-[#eef1fb]" style={{ position: "sticky", top: compareMode ? "37px" : 0, left: 0, zIndex: 20 }}>Account</th>
  {companyColumns.map(({ source, currency }) => (
    <React.Fragment key={source}>
      <th className="text-right pr-4 py-3 text-xs font-black text-[#1a2f8a] uppercase tracking-widest whitespace-nowrap min-w-[120px] bg-[#eef1fb]" style={{ position: "sticky", top: compareMode ? "37px" : 0 }}>

        <span className="text-[10px] font-bold text-[#1a2f8a]/40 normal-case">{currency}</span>
      </th>
      {compareMode && <>
        <th className="text-right pr-4 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest whitespace-nowrap min-w-[120px] bg-[#eef1fb]" style={{ position: "sticky", top: "37px" }}>B</th>
        <th className="text-right pr-4 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest whitespace-nowrap min-w-[90px] bg-[#eef1fb]" style={{ position: "sticky", top: "37px" }}>B Δ</th>
        <th className="text-right pr-4 py-3 text-xs font-black text-[#CF305D] uppercase tracking-widest whitespace-nowrap min-w-[70px] bg-[#eef1fb]" style={{ position: "sticky", top: "37px" }}>B Δ%</th>
        <th className="text-right pr-4 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest whitespace-nowrap min-w-[120px] bg-[#eef1fb]" style={{ position: "sticky", top: "37px" }}>C</th>
        <th className="text-right pr-4 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest whitespace-nowrap min-w-[90px] bg-[#eef1fb]" style={{ position: "sticky", top: "37px" }}>C Δ</th>
        <th className="text-right pr-4 py-3 text-xs font-black text-[#57aa78] uppercase tracking-widest whitespace-nowrap min-w-[70px] bg-[#eef1fb]" style={{ position: "sticky", top: "37px" }}>C Δ%</th>
      </>}
    </React.Fragment>
  ))}
</tr>
  </>
)}
          </thead>
<tbody>
            {bsView === "summary" ? (
              bsRoots.length === 0
                ? <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">No Balance Sheet data found</td></tr>
                : compareMode ? renderBSCompareRows(bsRoots, cmpTree, cmp2Tree) : renderBSRows(bsRoots)
            ) : allCompaniesLoading ? (
              <tr><td colSpan={companyColumns.length + 1} className="py-12 text-center">
                <Loader2 size={20} className="animate-spin text-[#1a2f8a] mx-auto" />
              </td></tr>
            ) : (
              renderMultiCompanyRows(companyTree, bsView)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AccountsDashboard({ token, sources = [], structures = [], companies = [], dimensions = [] }) {
const [activeTab, setActiveTab]   = useState("pl");
const [prevTab, setPrevTab]       = useState(null);
const [animKey, setAnimKey]       = useState(0);
  const [dataSubTab, setDataSubTab] = useState("uploaded");

  const TAB_ORDER = ["pl", "bs", "uploaded"];
  const tabsContainerRef = useRef(null);
const [pillStyle, setPillStyle] = useState({});

useLayoutEffect(() => {
  if (!tabsContainerRef.current) return;
  const buttons = tabsContainerRef.current.querySelectorAll("button");
  const idx = TABS.findIndex(t => t.id === activeTab);
  const btn = buttons[idx];
  if (btn) {
    setPillStyle({
      left: btn.offsetLeft + "px",
      width: btn.offsetWidth + "px",
    });
  }
}, [activeTab]);

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
const [upDimGroup, setUpDimGroup] = useState("");
const [upDimension, setUpDimension] = useState("");

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

const [exportModal, setExportModal] = useState(false);
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
    if (sources.length > 0 && !upSource) {
      const s = sources[0];
      setUpSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
    }
  }, [sources, upSource]);

  useEffect(() => {
    if (structures.length > 0 && !upStructure) {
      const s = structures[0];
      setUpStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
    }
  }, [structures, upStructure]);


  useEffect(() => {
    if (companies.length > 0 && !upCompany) {
      const c = companies[0];
      setUpCompany(
        typeof c === "object"
          ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
          : String(c)
      );
    }
  }, [companies, upCompany]);

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
  setCmpLoading(true);
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

  // ── AUTO-LOAD: fire all three fetches once source+structure are known ──
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
const [cmpDimGroup, setCmpDimGroup] = useState("");
const [cmpDimension, setCmpDimension] = useState("");
const [cmpData,     setCmpData]       = useState([]);
const [cmpPrevData, setCmpPrevData]   = useState([]);
const [cmpLoading,  setCmpLoading]    = useState(false);

// ── Compare period 2 ──────────────────────────────────────
const [cmp2Year,      setCmp2Year]      = useState("");
const [cmp2Month,     setCmp2Month]     = useState("");
const [cmp2Source,    setCmp2Source]    = useState("");
const [cmp2Structure, setCmp2Structure] = useState("");
const [cmp2Company,   setCmp2Company]   = useState("");
const [cmp2DimGroup,  setCmp2DimGroup]  = useState("");
const [cmp2Dimension, setCmp2Dimension] = useState("");
const [cmp2Data,      setCmp2Data]      = useState([]);
const [cmp2PrevData,  setCmp2PrevData]  = useState([]);
const [cmp2Loading,   setCmp2Loading]   = useState(false);
  useEffect(() => {
  if (compareMode && cmpSource && cmpStructure && cmpYear && cmpMonth && cmpCompany) {
    fetchCmp(cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany);
  }
}, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, cmpCompany]);

useEffect(() => {
  if (compareMode && cmp2Source && cmp2Structure && cmp2Year && cmp2Month && cmp2Company) {
    fetchCmp2(cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company);
  }
}, [compareMode, cmp2Year, cmp2Month, cmp2Source, cmp2Structure, cmp2Company]);


  const tab        = TABS.find(t => t.id === activeTab);
  const anyLoading = upLoading || prevLoading || cmpLoading || cmp2Loading || mapLoading || grpLoading || jrnLoading;
  console.log("jrnData:", jrnData.length, jrnData[0]);
console.log("jrnFetched:", jrnFetched, "jrnLoading:", jrnLoading, "jrnError:", jrnError);
  const dimGroups = useMemo(() => {
  const seen = new Set();
  return dimensions
    .map(d => typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "")
    .filter(g => g && !seen.has(g) && seen.add(g));
}, [dimensions]);

const filteredDims = useMemo(() => {
  return dimensions.filter(d => {
    if (!upDimGroup) return true;
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return g === upDimGroup;
  });
}, [dimensions, upDimGroup]);

const cmpFilteredDims = useMemo(() => {
  return dimensions.filter(d => {
    if (!cmpDimGroup) return true;
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return g === cmpDimGroup;
  });
}, [dimensions, cmpDimGroup]);

const cmp2FilteredDims = useMemo(() => {
  return dimensions.filter(d => {
    if (!cmp2DimGroup) return true;
    const g = typeof d === "object" ? (d.dimensionGroup ?? d.DimensionGroup ?? "") : "";
    return g === cmp2DimGroup;
  });
}, [dimensions, cmp2DimGroup]);

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
              <p className="text-white font-black text-sm">Export Report</p>
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
          {/* Drill down */}
          <div className="border-t border-gray-50 pt-3">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Options</p>
            <label className="flex items-center gap-2.5 cursor-pointer group">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${exportOpts.drillDown ? "bg-indigo-500 border-indigo-500" : "border-gray-200 group-hover:border-indigo-300"}`}
                onClick={() => setExportOpts(o => ({...o,drillDown:!o.drillDown}))}>
                {exportOpts.drillDown && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
              </div>
              <div>
                <span className="text-xs text-gray-700 font-medium">Include drill-down detail</span>
                <p className="text-[10px] text-gray-400">Expands all children, local accounts & dimensions</p>
              </div>
            </label>
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
                opts: exportOpts,
              };
              if(fmt==='pdf') generateKonsolidatorPdf(commonArgs);
              else generateKonsolidatorXlsx(commonArgs);
            }}
            className="w-full py-2.5 bg-[#1a2f8a] hover:bg-[#1a2f8a]/90 text-white text-xs font-black rounded-xl transition-all">
            Download {(exportOpts.format??'xlsx')==='pdf'?'PDF':'Excel'}
          </button>
        </div>
      </div>
    </div>
) : null;

return (
    <div className="space-y-6">
      {ExportModal}

{/* Page header + Tab switcher + Filters — all in one row */}
<div className="flex items-center gap-4 flex-wrap">
  {/* Left: title */}
  <div className="flex items-center gap-1.5 flex-shrink-0">
    <div className="w-1.5 h-10 rounded-full" style={{ background: tab.accent }} />
    <div>
      <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Accounts</p>
      <h1 className="text-[29px] font-black text-[#1a2f8a] leading-none">{tab.label}</h1>
    </div>
  </div>

  {/* Divider */}
  <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

  {/* Tab pills */}
<div ref={tabsContainerRef} className="flex items-center gap-1 p-1 bg-[#e6e6e6] rounded-2xl flex-shrink-0 shadow-xl relative">
  <span
    style={{
      position: "absolute",
      top: 4, bottom: 4,
      left: pillStyle.left,
      width: pillStyle.width,
      background: "white",
      borderRadius: 12,
      boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
      transition: "left 0.25s cubic-bezier(0.4,0,0.2,1), width 0.25s cubic-bezier(0.4,0,0.2,1)",
    }}
  />
  {TABS.map(t => {
    const Icon = t.icon;
    const active = activeTab === t.id;
    return (
      <button
        key={t.id}
        onClick={() => handleTabChange(t.id)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-black relative z-10"
        style={{ color: active ? "#1a2f8a" : "#636363", transition: "color 0.2s" }}
      >
        <Icon size={14} style={active ? { color: t.accent } : {}} />
        {t.label}
      </button>
    );
  })}
</div>

  {/* Divider */}
  <div className="w-px h-6 bg-gray-100 flex-shrink-0" />

  {/* Filters */}
  <div className="flex items-center gap-2 flex-wrap">
    <FilterPill label="Yr"      value={upYear}      onChange={setUpYear}
      options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
    <FilterPill label="Mnth"     value={upMonth}     onChange={setUpMonth}
      options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
    <FilterPill label="Src"    value={upSource}    onChange={setUpSource}
      options={sources.map(s => { const v = typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s); return { value: v, label: v }; })} />
    <FilterPill label="Struct" value={upStructure} onChange={setUpStructure}
      options={structures.map(s => { const v = typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s); return { value: v, label: v }; })} />
<FilterPill label="Comp"   value={upCompany}   onChange={setUpCompany}
      options={companies.map(c => {
        const v = typeof c === "object"
          ? (c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "")
          : String(c);
        return { value: v, label: v };
      })} />
<FilterPill label="Dim Grp" value={upDimGroup} onChange={v => { setUpDimGroup(v); setUpDimension(""); }}
      options={[
        { value: "", label: "All" },
        ...dimGroups.map(g => ({ value: g, label: g }))
      ]} />
    <FilterPill label="Dim" value={upDimension} onChange={setUpDimension}
      options={[
        { value: "", label: "All" },
        ...filteredDims.map(d => {
          const v = typeof d === "object" ? (d.dimensionCode ?? d.DimensionCode ?? d.code ?? "") : String(d);
          const l = typeof d === "object" ? (d.dimensionName ?? d.DimensionName ?? d.name ?? v) : String(d);
          return { value: v, label: l };
        })
      ]} />
  </div>

<div className="ml-auto flex items-center gap-3 flex-shrink-0 pr-6 mt-1">
    {anyLoading && (
      <span className="flex items-center gap-1 text-xs text-[#1a2f8a] font-semibold">
        <Loader2 size={11} className="animate-spin" /> Loading…
      </span>
    )}
{(activeTab === "pl" || activeTab === "bs") && (
      <>
<button
          onClick={() => { setExportOpts(o=>({...o,format:'xlsx'})); setExportModal(true); }}
          className="transition-all hover:opacity-80 hover:scale-105"
          title="Export Excel"
        >
<img
            src="https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png"
            width="44"
            height="36"
            alt="Excel"
          />
        </button>
<button
          onClick={() => { setExportOpts(o=>({...o,format:'pdf'})); setExportModal(true); }}
          className="transition-all hover:opacity-80 hover:scale-105"
          title="Export PDF"
        >
<img
            src="https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png"
            width="30"
            height="36"
            alt="PDF"
          />
        </button>
      </>
    )}
  </div>
</div>

{/* ── P&L STATEMENT */}
{activeTab === "pl" && (
<div key={`pl-${animKey}`} className="tab-content" style={{ "--slide-from": TAB_ORDER.indexOf("pl") > TAB_ORDER.indexOf(prevTab ?? "pl") ? "30px" : "-30px" }}>
<PLStatement
  groupAccounts={grpData}
uploadedAccounts={upDimension ? upData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === upDimension) : upData}
  prevUploadedAccounts={upDimension ? prevData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === upDimension) : prevData}
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
cmpUploadedAccounts={cmpDimension ? cmpData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmpDimension) : cmpData}
  cmpPrevUploadedAccounts={cmpDimension ? cmpPrevData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmpDimension) : cmpPrevData}
cmpFilters={{
    year: cmpYear,
    month: cmpMonth,
    source: cmpSource,
    structure: cmpStructure,
    company: cmpCompany,
    dimGroup: cmpDimGroup,
    dimension: cmpDimension,
  }}
  onCmpFilterChange={(key, val) => {
    if (key === "year")      setCmpYear(val);
    if (key === "month")     setCmpMonth(val);
    if (key === "source")    setCmpSource(val);
    if (key === "structure") setCmpStructure(val);
    if (key === "company")   setCmpCompany(val);
    if (key === "dimGroup")  { setCmpDimGroup(val); setCmpDimension(""); }
    if (key === "dimension") setCmpDimension(val);
  }}

  sources={sources}
  structures={structures}
  companies={companies}
  dimGroups={dimGroups}
  cmpFilteredDims={cmpFilteredDims}
  cmp2UploadedAccounts={cmp2Dimension ? cmp2Data.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmp2Dimension) : cmp2Data}
  cmp2PrevUploadedAccounts={cmp2Dimension ? cmp2PrevData.filter(r => String(r.dimensionCode ?? r.DimensionCode ?? "") === cmp2Dimension) : cmp2PrevData}
  cmp2Filters={{
    year: cmp2Year, month: cmp2Month, source: cmp2Source,
    structure: cmp2Structure, company: cmp2Company,
    dimGroup: cmp2DimGroup, dimension: cmp2Dimension,
  }}
  onCmp2FilterChange={(key, val) => {
    if (key === "year")      setCmp2Year(val);
    if (key === "month")     setCmp2Month(val);
    if (key === "source")    setCmp2Source(val);
    if (key === "structure") setCmp2Structure(val);
    if (key === "company")   setCmp2Company(val);
    if (key === "dimGroup")  { setCmp2DimGroup(val); setCmp2Dimension(""); }
    if (key === "dimension") setCmp2Dimension(val);
  }}
  cmp2FilteredDims={cmp2FilteredDims}
  loading={anyLoading && (!upData.length || !grpData.length)}
  error={upError || grpError || null}
  month={upMonth}
  year={upYear}
  source={upSource}
  structure={upStructure}
  journalEntries={jrnData}
/>
</div>
)}

{/* ── BALANCE SHEET */}
{activeTab === "bs" && (
<div key={`bs-${animKey}`} className="tab-content" style={{ "--slide-from": TAB_ORDER.indexOf("bs") > TAB_ORDER.indexOf(prevTab ?? "bs") ? "30px" : "-30px" }}>
<BalanceSheet
  groupAccounts={grpData}
  uploadedAccounts={upData}
  loading={anyLoading && (!upData.length || !grpData.length)}
  error={upError || grpError || null}
  month={upMonth}
  year={upYear}
  source={upSource}
  structure={upStructure}
  company={upCompany}
  sources={sources}
  structures={structures}
  companies={companies}
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
/>
</div>
)}


      {/* ── UPLOADED ACCOUNTS */}
      {activeTab === "uploaded" && (
<div key={`uploaded-${animKey}`} className="tab-content" style={{ "--slide-from": TAB_ORDER.indexOf("uploaded") > TAB_ORDER.indexOf(prevTab ?? "uploaded") ? "30px" : "-30px" }}>
      <div className="space-y-6">


<div className={dataSubTab === "uploaded" ? "" : "hidden"}>
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

<div className={dataSubTab === "mapped" ? "" : "hidden"}>
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

<div className={dataSubTab === "group" ? "" : "hidden"}>
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

<div className={dataSubTab === "journal" ? "" : "hidden"}>
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

<div className={dataSubTab === "report" ? "space-y-4" : "hidden"}>
  <div className="flex items-center gap-3 flex-wrap">
    {dataSubTabSelector}
  </div>

  <FinancialReport
    groupAccounts={grpData}
    uploadedAccounts={upData}
    loading={anyLoading && (!upData.length || !grpData.length)}
    error={upError || grpError || null}
  />
</div>
</div>
      </div>
)}

    </div>
  );
}