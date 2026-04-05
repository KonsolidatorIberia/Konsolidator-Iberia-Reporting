import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
console.log("RAW:", new Date().getMonth(), new Date().toISOString());
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

function DataTable({ data, hiddenCols = new Set(), search, setSearch, onRefresh, subTab, onSubTabChange }) {
  const cols = data.length > 0 ? Object.keys(data[0]).filter((c) => !hiddenCols.has(c)) : [];
  const filtered = search.trim()
    ? data.filter((row) => Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(search.toLowerCase())))
    : data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 bg-gray-100/70 rounded-xl">
  {["uploaded","mapped","group","report"].map(t => (
    <button key={t} onClick={() => onSubTabChange(t)}
      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all capitalize
        ${subTab === t ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
      {t}
    </button>
  ))}
</div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#eef1fb] text-[#1a2f8a]">
          <Hash size={11} />{data.length} records
        </div>
        {search && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">
            {filtered.length} matching
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
          <Search size={13} className="text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search results…"
            className="text-xs outline-none text-gray-700 w-40 bg-transparent placeholder:text-gray-300" />
          {search && <button onClick={() => setSearch("")}><X size={12} className="text-gray-400 hover:text-gray-600" /></button>}
        </div>
        <button onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-100 shadow-sm text-xs font-bold text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/20 transition-all">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {filtered.length > 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: 'calc(115vh - 320px)' }}>
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
className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all select-none
          ${value
            ? dark
              ? "bg-[#474b70] border-white/30 text-white hover:bg-white/30"
              : "bg-[#ffffff] border-[#c2c2c2] text-[#505050] shadow-[0_2px_8px_rgba(0,0,0,0.10)]"
            : dark
              ? "bg-[#474b70] border-white/30 text-white hover:bg-white/30"
              : "bg-[#ffffff] border-[#c2c2c2] text-[#505050] shadow-[0_2px_8px_rgba(0,0,0,0.10)]"
          }`}>
<span className={`text-[9px] font-black uppercase tracking-widest ${labelStyle || (value ? (dark ? "text-white/50" : "text-[#1a2f8a]/50") : dark ? "text-white/50" : "text-[#1a2f8a]/50")}`}>{label}</span>
<span className={valueStyle || (value ? (dark ? "text-white" : "text-[#1a2f8a]") : dark ? "text-white/100" : "text-[#1a2f8a]")}>{display ?? "—"}</span>
<ChevronDown size={10} className={`transition-transform duration-200 ${open ? "rotate-180" : ""} ${value ? (dark ? "text-white/50" : "text-[#1a2f8a]/40") : dark ? "text-white/30" : "text-gray-300"}`} />
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

function PLStatement({
  groupAccounts, uploadedAccounts, prevUploadedAccounts = [],
  compareMode, onToggleCompare,
  cmpUploadedAccounts = [], cmpPrevUploadedAccounts = [],
  cmpFilters, onCmpFilterChange,
  cmp2UploadedAccounts = [], cmp2PrevUploadedAccounts = [],
  cmp2Filters, onCmp2FilterChange,
  sources = [], structures = [], companies = [],
  dimGroups = [], cmpFilteredDims = [], cmp2FilteredDims = [],
  loading, error, month, year, source, structure
}) {
const [expandedMap, setExpandedMap] = useState({});
  const [summaryMode, setSummaryMode] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
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
  console.log("allSumRows:", allSumRows.map(n => `${n.code} ${n.name} type:${n.accountType}`));

  const prevTree = useMemo(
  () => buildTree(groupAccounts, prevUploadedAccounts),
  [groupAccounts, prevUploadedAccounts]
);

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



  function getChildRows(node, depth) {
    const rows = [];
    const kids = (node.children || []).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType));
    kids.forEach(child => {
const ytd     = -sumNode(child);
const prevYtd = -getPrevYtd(child.code);
const mon     = ytd - prevYtd;
const isBold  = child.isSumAccount;
const hasKids = (child.children||[]).filter(c => hasData(c) && ["P/L","DIS"].includes(c.accountType)).length > 0;
const expanded = !!expandedMap[child.code];
      rows.push(
        <tr key={child.code}
          className={`border-b border-gray-50 ${hasKids ? "cursor-pointer hover:bg-blue-50/30" : ""} transition-colors`}
          onClick={hasKids ? () => toggle(child.code) : undefined}>
          <td className="py-2" style={{ paddingLeft: 16 + depth * 20 }}>
            <div className="flex items-center gap-2">
              {hasKids
                ? <span className="text-[#1a2f8a]/40 flex-shrink-0">{expanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</span>
                : <span className="w-3 flex-shrink-0"/>}
              <span className={`text-xs ${isBold ? "font-bold text-[#1a2f8a]" : "text-gray-500"}`}>{child.name}</span>
            </div>
          </td>
<PLAmountCell value={mon} bold={isBold} />
<PLAmountCell value={ytd} bold={isBold} />
        </tr>
      );
      if (expanded) rows.push(...getChildRows(child, depth + 1));
      
    });
    
    return rows;
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
      <p className="text-gray-400 text-sm font-semibold">Waiting for data…</p>
    </div>
  );


  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
<div className="bg-[#1a2f8a] px-6 py-4 flex items-center justify-between">
  <div>
    <p className="text-white/60 text-xs font-bold uppercase tracking-widest">Profit & Loss</p>
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
    <div className="bg-[#0f1f5e] px-6 py-3 flex items-center gap-2 flex-wrap">
      <span className="text-white/40 text-[9px] font-black uppercase tracking-widest flex-shrink-0"></span>
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
    <div className="bg-[#0f1f5e] px-6 py-3 flex items-center gap-2 flex-wrap border-t border-white/10">
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




<div className="overflow-auto" style={{ maxHeight: !compareMode ? "calc(113vh - 320px)" : filtersOpen ? "calc(123vh - 530px)" : "calc(120.5vh - 390px)" }}>
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
      className={`border-b border-gray-100 bg-[#1a2f8a]/[0.04] ${hasKids ? "cursor-pointer hover:bg-[#1a2f8a]/10" : ""} transition-colors`}
      onClick={hasKids ? () => toggle(node.code) : undefined}>
      <td className="py-3 px-6">
        <div className="flex items-center gap-2">
          {hasKids
            ? <span className="text-[#1a2f8a]/50">{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span>
            : <span className="w-3"/>}
          <span className="text-xs font-bold text-[#1a2f8a]">{node.name}</span>
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
    ...(expanded && !summaryMode ? getChildRows(node, 1) : [])
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
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm font-semibold">No accounts match this filter</p>
          <p className="text-gray-300 text-xs mt-1">Try a different type filter or clear the search</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
  { id: "uploaded", label: "Uploaded", icon: Upload,    accent: "#e8394a", desc: "Raw uploaded account data" },
];

/* ═══════════════════════════════════════════════════════════════
   ROOT COMPONENT
   Auto-loads all three data sources on mount (once valid
   source/structure props are available). The Financial Report
   tab is shown first by default.
═══════════════════════════════════════════════════════════════ */
export default function AccountsDashboard({ token, sources = [], structures = [], companies = [], dimensions = [] }) {
  const [activeTab, setActiveTab] = useState("pl");
  const [dataSubTab, setDataSubTab] = useState("uploaded");

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

  console.log("sources:", sources);
console.log("structures:", structures);
console.log("companies:", companies);

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
      console.log("ROW 0:", JSON.stringify((json.value ?? json)[0]));
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
  }
}, [upSource, upStructure, upYear, upMonth, upCompany]);

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
  }, []); // fire once on mount regardless of filters

  // ── Manual re-fetch for uploaded when filters change ───────
const handleLoadUploaded = () => {
  fetchUploaded(upYear, upMonth, upSource, upStructure, upCompany);
  fetchPrev(upYear, upMonth, upSource, upStructure, upCompany);
};

// ── Compare mode state ─────────────────────────────────────
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
  const anyLoading = upLoading || prevLoading || cmpLoading || cmp2Loading || mapLoading || grpLoading;

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

  return (
    <div className="space-y-6">

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
  <div className="flex items-center gap-1 p-1 bg-[#e6e6e6] rounded-xl flex-shrink-0" >
    {TABS.map(t => {
      const Icon = t.icon;
      const active = activeTab === t.id;
      return (
        <button key={t.id} onClick={() => setActiveTab(t.id)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${active ? "bg-white text-[#1a2f8a] shadow-sm" : "text-[#636363] hover:text-gray-600"}`}>
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
{activeTab === "pl" && (
      <>
<button
          onClick={() => document.getElementById("__plXlsxTrigger")?.click()}
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
          onClick={() => document.getElementById("__plExportTrigger")?.click()}
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
<div className={activeTab === "pl" ? "" : "hidden"}>
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
/>
</div>


      {/* ── UPLOADED ACCOUNTS */}
      <div className={activeTab === "uploaded" ? "" : "hidden"}>
      <div className="space-y-6">
  {dataSubTab === "uploaded" && upError && <ErrorBox error={upError} onRetry={handleLoadUploaded} />}
  {dataSubTab === "uploaded" && upFetched && !upError &&
    <DataTable data={upData} hiddenCols={UPLOADED_HIDDEN} search={upSearch} setSearch={setUpSearch} onRefresh={handleLoadUploaded} subTab={dataSubTab} onSubTabChange={setDataSubTab} />}

  {dataSubTab === "mapped" && mapError && <ErrorBox error={mapError} onRetry={fetchMapped} />}
  {dataSubTab === "mapped" && mapFetched && !mapError &&
    <DataTable data={mapData} hiddenCols={new Set()} search={mapSearch} setSearch={setMapSearch} onRefresh={fetchMapped} subTab={dataSubTab} onSubTabChange={setDataSubTab} />}

  {dataSubTab === "group" && grpError && <ErrorBox error={grpError} onRetry={fetchGroup} />}
  {dataSubTab === "group" && grpFetched && !grpError &&
    <DataTable data={grpData} hiddenCols={new Set()} search={grpSearch} setSearch={setGrpSearch} onRefresh={fetchGroup} subTab={dataSubTab} onSubTabChange={setDataSubTab} />}

{dataSubTab === "report" && <>
  <div className="flex items-center gap-1 p-1 bg-gray-100/70 rounded-xl w-fit">
    {["uploaded","mapped","group","report"].map(t => (
      <button key={t} onClick={() => setDataSubTab(t)}
        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all capitalize
          ${dataSubTab === t ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
        {t}
      </button>
    ))}
  </div>
  <FinancialReport groupAccounts={grpData} uploadedAccounts={upData}
    loading={anyLoading && (!upData.length || !grpData.length)}
    error={upError || grpError || null} />
</>}
</div>
      </div>


    </div>
  );
}