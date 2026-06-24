/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { ChevronDown, Loader2, Layers, FileText, Library, CheckCircle2, Pencil, X } from "lucide-react";
import { useTypo, useSettings } from "./SettingsContext";
import PageHeader, { MultiFilterPill, FilterPill as HeaderFilterPill } from "./PageHeader.jsx";
import { useCurrentUserResourceAccess } from "../../lib/userPermissionsApi";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const BASE = "https://api.konsolidator.com/v2";

const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },

];

function useCountUp(target, duration = 900) {
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

function useAnimatedNumber(target, duration = 700) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(null);
  const fromRef = useRef(0);
  const rafRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    const to = Number(target) || 0;
    startRef.current = null;
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (to - from) * eased;
      setDisplay(val);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else { fromRef.current = to; }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

function AnimatedAmountCell({ value, style, className }) {
  const animated = useCountUp(Math.round(value ?? 0), 900);
  const rounded = Math.round(value ?? 0);
  const color = rounded === 0 ? "#D1D5DB" : rounded < 0 ? "#EF4444" : "#000000";
  return (
    <td className={className ?? "px-4 py-2.5 text-center whitespace-nowrap tabular-nums border-l border-gray-100"}
      style={{ minWidth: 120, ...style, color }}>
      {rounded === 0 ? "—" : fmt(animated)}
    </td>
  );
}

const fmt = (n) => {
  if (n == null || n === "") return "—";
  const rounded = Math.round(Number(n));
  if (rounded === 0) return "—";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(rounded);
};

function parseDimensionsField(str) {
  if (!str || typeof str !== "string") return [];
  return str.split("||").map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return { group: pair.slice(0, idx).trim(), code: pair.slice(idx + 1).trim() };
  }).filter(Boolean);
}

function rowMatchesDimMulti(r, groups, codes) {
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

const parseAmt = (val) => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

/* ─── CF mapping converters (cf_tree → {rows, sections} + literal) ─────── */
// Flat ordering + section breakers — drives orderedRows / dividerMap
function convertCfMappingTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return null;
  const rows = new Map();
  const sections = new Map();
  let sortCounter = 0;
  let defaultSecCounter = 0;
  function walk(nodes, depth, parentSection) {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "breaker") {
        const secCode = node.sectionCode || `section_${defaultSecCounter++}`;
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
          isSum: !!node.isSum,
          showInSummary: !!node.showInSummary,
          level: depth,
        });
        walk(node.children || [], depth + 1, sec);
      }
    }
  }
  walk(tree, 0, null);
  if (rows.size === 0) return null;
  return { rows, sections };
}

// Literal tree — preserves hierarchy + custom names + sum-grouping for render
function buildCfMappingLiteral(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return null;
  const sections = [];
  let current = { label: null, color: null, nodes: [] };
  sections.push(current);

  function literal(node, depth, visited = new WeakSet()) {
    if (!node || depth > 50 || visited.has(node)) {
      return {
        id: String(node?.id ?? `truncated-${Math.random()}`),
        code: String(node?.code ?? ""),
        name: String(node?.name ?? ""),
        isSum: false, depth, children: [],
      };
    }
    visited.add(node);
    return {
      id: String(node.id ?? `${node.code}-${Math.random()}`),
      code: String(node.code ?? ""),
      name: String(node.name ?? ""),
      isSum: !!node.isSum || !!node.isSumAccount,
      depth,
      children: (node.children || [])
        .filter(c => c && c.kind !== "breaker")
        .map(c => literal(c, depth + 1, visited)),
    };
  }

  for (const node of tree) {
    if (!node) continue;
    if (node.kind === "breaker") {
      current = { label: String(node.name ?? ""), color: node.color || "#1a2f8a", nodes: [] };
      sections.push(current);
      (node.children || [])
        .filter(c => c && c.kind !== "breaker")
        .forEach(c => current.nodes.push(literal(c, 0)));
    } else {
      current.nodes.push(literal(node, 0));
    }
  }
  const cleaned = sections.filter((s, i) => i > 0 || s.nodes.length > 0);
  return cleaned.length === 0 ? null : cleaned;
}

/* ─── FilterPill ────────────────────────────────────────────────────────── */
function FilterPill({ label, value, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => String(o.value) === String(value))?.label ?? "—";
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
        style={filterStyle}>
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
        <span>{display}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {options.map(o => {
              const selected = String(o.value) === String(value);
              return (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
                    ${selected ? "text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
                  style={selected ? { backgroundColor: colors?.primary } : undefined}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MultiSelectPill ──────────────────────────────────────────────────── */
function MsCheckbox({ checked, indeterminate, color }) {
  return (
    <span
      className="flex-shrink-0 w-4 h-4 rounded-md border flex items-center justify-center transition-all"
      style={{
        backgroundColor: checked || indeterminate ? color : "#fff",
        borderColor: checked || indeterminate ? color : "#d4d4d8",
      }}>
      {checked && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {indeterminate && !checked && (
        <span className="w-2 h-0.5 rounded bg-white" />
      )}
    </span>
  );
}

function MultiSelectPill({ label, values, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const allSelected = !values || values.length === options.length;
  const display = allSelected
    ? `All (${options.length})`
    : values.length === 0
      ? "None"
      : values.length === 1
        ? options.find(o => o.value === values[0])?.label ?? "1 selected"
        : `${values.length} selected`;
  const toggle = (v) => {
    const current = values || options.map(o => o.value);
    const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v];
    onChange(next.length === options.length ? null : next);
  };
  const someSelected = values && values.length > 0 && values.length < options.length;
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
        style={filterStyle}>
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
        <span>{display}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[220px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            <button onClick={() => onChange(allSelected ? [] : null)}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-3 text-[#1a2f8a] hover:bg-[#eef1fb] border-b border-gray-100 mb-1">
              <MsCheckbox checked={allSelected} indeterminate={someSelected} color={colors?.primary} />
              <span>{allSelected ? "Deselect all" : "Select all"}</span>
            </button>
            {options.map(o => {
              const selected = (values ?? options.map(x => x.value)).includes(o.value);
              return (
                <button key={o.value} onClick={() => toggle(o.value)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-3 text-gray-700 hover:bg-[#eef1fb] hover:text-[#1a2f8a]">
                  <MsCheckbox checked={selected} color={colors?.primary} />
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
/* ─── CfLoadingSpinner ──────────────────────────────────────────────── */
// Lives entirely outside React. Survives remounts, StrictMode, re-renders.
const cfAnim = { startedAt: null, raf: null, subs: new Set(), idleTimer: null };

function cfStart() {
  if (cfAnim.idleTimer) { clearTimeout(cfAnim.idleTimer); cfAnim.idleTimer = null; }
  if (cfAnim.startedAt !== null) return;
  cfAnim.startedAt = performance.now();
  const tick = () => {
    cfAnim.subs.forEach(fn => fn());
    cfAnim.raf = requestAnimationFrame(tick);
  };
  cfAnim.raf = requestAnimationFrame(tick);
}
function cfMaybeReset() {
  // Only reset when nobody has subscribed for a while (true unmount, not a remount)
  cfAnim.idleTimer = setTimeout(() => {
    if (cfAnim.subs.size === 0) {
      if (cfAnim.raf) cancelAnimationFrame(cfAnim.raf);
      cfAnim.raf = null;
      cfAnim.startedAt = null;
    }
    cfAnim.idleTimer = null;
  }, 500);
}
function cfGetProgress() {
  if (cfAnim.startedAt === null) return 0;
  const elapsed = performance.now() - cfAnim.startedAt;
  const t = 1 - Math.exp(-elapsed / 2500);
  return Math.min(95, t * 100);
}

function CfLoadingSpinner({ colors, metaReady }) {
  const R = 60;
  const CIRC = 2 * Math.PI * R;
  const [, force] = useState(0);

  useEffect(() => {
    cfStart();
    const sub = () => force(n => n + 1);
    cfAnim.subs.add(sub);
    return () => { cfAnim.subs.delete(sub); cfMaybeReset(); };
  }, []);

  const progress = cfGetProgress();

  return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
      style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
        style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
        <div className="relative" style={{ width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={R} fill="none" stroke="#f3f4f6" strokeWidth="10" />
            <circle cx="70" cy="70" r={R} fill="none"
              stroke="url(#cfProgGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress / 100)}
              style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
            />
            <defs>
              <linearGradient id="cfProgGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                <stop offset="100%" stopColor="#CF305D" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
              {Math.round(progress)}<span className="text-base text-gray-300">%</span>
            </span>
          </div>
        </div>
        <p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
          {!metaReady ? "Finding latest period…" : "Building cash flow…"}
        </p>
        <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
          Individual Cash Flow
        </p>
      </div>
    </div>
  );
}


/* ─── DrillGroupRow ─────────────────────────────────────────────────── */
function DrillGroupRow({ groupCode, groupName, localRows, visibleCompanies, colors, body1Style, body2Style, subbody1Style, compareMode, groupIndex = 0 }) {
  const [open, setOpen] = useState(false);
  const amtByCompany = useMemo(() => {
    const m = {};
    visibleCompanies.forEach(c => {
      m[c] = localRows.filter(r => r.co === c).reduce((s, r) => s + r.amt, 0);
    });
    return m;
  }, [localRows, visibleCompanies]);

  return (
    <>
<tr className="border-b cursor-pointer hover:bg-[#eef1fb]/60 transition-colors"
        style={{ background: `${colors.primary}05`, animation: `drillSlideIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${groupIndex * 40}ms both`, transformOrigin: "top center" }}
        onClick={() => setOpen(o => !o)}>
        <td className="sticky left-0 z-10 py-2 pr-4 border-r border-gray-100"
          style={{ paddingLeft: 32, minWidth: 260, width: 260, background: `${colors.primary}05` }}>
          <div className="flex items-center gap-2">
            <ChevronDown size={10} className={`transition-transform duration-200 flex-shrink-0`}
              style={{ color: colors.primary, transform: open ? "rotate(180deg)" : "rotate(-90deg)" }} />
<span className="font-mono" style={subbody1Style}>{groupCode}</span>
            {groupName && <span className="truncate" style={body2Style}>{groupName}</span>}
          </div>
        </td>
{visibleCompanies.map(c => {
          const v = Math.round(amtByCompany[c] ?? 0);
          return (
            <Fragment key={c}>
              <td className="px-4 py-2 text-center tabular-nums border-l border-gray-100"
                style={{ ...body2Style, color: v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000", minWidth: 120 }}>
                {v === 0 ? "—" : fmt(v)}
              </td>
              {compareMode && <td className="px-4 py-2 text-center border-l border-gray-100" style={{ minWidth: 110, background: `${colors.primary}08` }} />}
              {compareMode && <td className="px-4 py-2 text-center border-l border-gray-100" style={{ minWidth: 100, background: `${colors.primary}12` }} />}
              {compareMode && <td className="px-3 py-2 text-center border-l border-gray-100" style={{ minWidth: 80, background: `${colors.primary}1e` }} />}
            </Fragment>
          );
        })}
      </tr>
      {open && localRows.map((r, i) => (
        <tr key={i} className="border-b" style={{ background: `${colors.primary}03`, animation: `drillSlideIn 220ms cubic-bezier(0.34,1.56,0.64,1) ${i * 25}ms both`, transformOrigin: "top center" }}>
          <td className="sticky left-0 z-10 py-1.5 pr-4 border-r border-gray-100"
            style={{ paddingLeft: 52, minWidth: 260, width: 260, background: `${colors.primary}03` }}>
<div className="flex items-center gap-2">
              <span className="font-mono flex-shrink-0" style={subbody1Style}>{r.localCode}</span>
              <span className="truncate" style={subbody1Style}>{r.localName}</span>
            </div>
          </td>
{visibleCompanies.map(c => {
            const v = r.co === c ? Math.round(r.amt) : 0;
            return (
              <Fragment key={c}>
                <td className="px-4 py-1.5 text-center tabular-nums border-l border-gray-100"
                  style={{ ...subbody1Style, color: v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000" }}>
                  {v === 0 ? "—" : fmt(v)}
                </td>
                {compareMode && <td className="px-4 py-1.5 text-center border-l border-gray-100" style={{ minWidth: 110, background: `${colors.primary}08` }} />}
                {compareMode && <td className="px-4 py-1.5 text-center border-l border-gray-100" style={{ minWidth: 100, background: `${colors.primary}12` }} />}
                {compareMode && <td className="px-3 py-1.5 text-center border-l border-gray-100" style={{ minWidth: 80, background: `${colors.primary}1e` }} />}
              </Fragment>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/* ─── MappedSheetRow — renders a node from a custom cf_tree mapping ──── */
function MappedSheetRow({
  node, depth, pivot, visibleCompanies,
  body1Style, body2Style, subbody1Style,
  compareMode = false, cmpPivot = new Map(), colors, rowIndex = 0,
  uploadedData = [], journalEntries = [], groupToCf, nameFor,
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMappingChildren = node.children && node.children.length > 0;

  // Collect all leaf codes under this node (recursive) — used for rollup.
  // If node has children: it's a sum, value = sum of all descendant leaves.
  // If node has no children: it's a leaf, value = its own pivot row.
  const allLeafCodes = useMemo(() => {
    const out = [];
    const walk = (n) => {
      if (!n.children || n.children.length === 0) {
        out.push(n.code);
      } else {
        n.children.forEach(walk);
      }
    };
    walk(node);
    return out;
  }, [node]);

  const getContrib = (company) => {
    let total = 0;
    for (const code of allLeafCodes) {
      const rows = pivot.get(code)?.[company] ?? [];
      for (const r of rows) total += Number(r._cfAmount ?? 0);
    }
    return total;
  };

  const getCmpContrib = (company) => {
    let total = 0;
    for (const code of allLeafCodes) {
      const rows = cmpPivot?.get(code)?.[company] ?? [];
      for (const r of rows) total += Number(r._cfAmount ?? 0);
    }
    return total;
  };

  // Drill-down only for LEAF mapping nodes (real underlying accounts).
  // Sum nodes expand into their mapping children instead.
  const drillGroups = useMemo(() => {
    if (!expanded || hasMappingChildren) return [];
    const byGroup = new Map();
    const ensureBucket = (groupCode, groupName) => {
      if (!byGroup.has(groupCode)) {
        byGroup.set(groupCode, { groupCode, groupName: groupName ?? "", rowMap: new Map() });
      }
      return byGroup.get(groupCode);
    };

    uploadedData.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      const cfs = groupToCf?.get(groupCode) ?? [];
      if (!cfs.includes(node.code)) return;
      const origin = r.Origin ?? r.origin ?? "";
      const rawLocalCode = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (origin === "Journal" || !rawLocalCode) return;
      const bucket = ensureBucket(groupCode, r.AccountName ?? r.accountName);
      const key = `ERP::${rawLocalCode}::${co}`;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      if (!bucket.rowMap.has(key)) {
        bucket.rowMap.set(key, {
          localCode: rawLocalCode,
          localName: r.LocalAccountName ?? r.localAccountName ?? "",
          isJournal: false, co, amt: 0,
        });
      }
      bucket.rowMap.get(key).amt += amt;
    });

    journalEntries.forEach(j => {
      const groupCode = String(j.AccountCode ?? j.accountCode ?? "");
      const co = j.CompanyShortName ?? j.companyShortName ?? "";
      const cfs = groupToCf?.get(groupCode) ?? [];
      if (!cfs.includes(node.code)) return;
      const journalNumber = String(j.JournalNumber ?? j.journalNumber ?? "");
      const journalHeader = j.JournalHeader ?? j.journalHeader ?? "";
      const journalType = j.JournalType ?? j.journalType ?? "";
      const bucket = ensureBucket(groupCode, j.AccountName ?? j.accountName);
      const key = `JRN::${journalNumber}::${co}`;
      const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
      if (!bucket.rowMap.has(key)) {
        bucket.rowMap.set(key, {
          localCode: journalNumber || "JRN",
          localName: journalHeader || journalType || "Journal",
          isJournal: true, co, amt: 0,
        });
      }
      bucket.rowMap.get(key).amt += amt;
    });

    return [...byGroup.values()]
      .map(g => ({
        ...g,
        localRows: [...g.rowMap.values()].sort((a, b) => {
          if (a.isJournal !== b.isJournal) return a.isJournal ? 1 : -1;
          return (a.localCode || a.localName).localeCompare(b.localCode || b.localName);
        }),
      }))
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode));
  }, [expanded, hasMappingChildren, uploadedData, journalEntries, groupToCf, node.code]);

  const totalCols = 1 + visibleCompanies.length * (compareMode ? 4 : 1);
  const isExpandable = hasMappingChildren || true; // leaves can drill too

  return (
    <>
      <tr className="group border-b border-gray-100 transition-colors hover:bg-[#eef1fb]/40 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
        style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both` }}>
        <td className="sticky left-0 z-10 py-2.5 pr-6 border-r border-gray-100 bg-white group-hover:bg-[#eef1fb]/40"
          style={{ paddingLeft: `${24 + depth * 16}px`, minWidth: 260, width: 260 }}>
          <div className="flex items-center gap-2 select-none">
            {isExpandable ? (
              <ChevronDown size={10} className="flex-shrink-0 transition-transform duration-200"
                style={{ color: `${colors.primary}60`, transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }} />
            ) : (
              <span className="flex-shrink-0" style={{ width: 10 }} />
            )}
            <span className="flex-shrink-0 mr-1" style={subbody1Style}>{node.code}</span>
            <span className="truncate" style={{ ...body1Style, fontWeight: hasMappingChildren ? 800 : body1Style.fontWeight }}>
              {node.name || nameFor(node.code) || ""}
            </span>
          </div>
        </td>
        {visibleCompanies.map(c => {
          const val = getContrib(c);
          const cmpVal = compareMode ? getCmpContrib(c) : null;
          const delta = cmpVal !== null ? Math.round(val) - Math.round(cmpVal) : null;
          const pct = (cmpVal !== null && Math.round(cmpVal) !== 0)
            ? ((Math.round(val) - Math.round(cmpVal)) / Math.abs(Math.round(cmpVal))) * 100
            : null;
          const devColor = !delta ? "#D1D5DB" : delta > 0 ? "#059669" : "#EF4444";
          return (
            <Fragment key={c}>
              <AnimatedAmountCell value={val} style={{ ...body1Style, fontWeight: hasMappingChildren ? 800 : body1Style.fontWeight }} />
              {compareMode && (
                <AnimatedAmountCell value={cmpVal ?? 0}
                  style={{ ...body1Style, background: `${colors.primary}08` }} />
              )}
              {compareMode && (
                <td className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums border-l border-gray-100"
                  style={{ minWidth: 100, ...body1Style, color: devColor, background: `${colors.primary}12` }}>
                  {delta ? fmt(delta) : "—"}
                </td>
              )}
              {compareMode && (
                <td className="px-3 py-2.5 text-center whitespace-nowrap tabular-nums"
                  style={{ minWidth: 80, ...body1Style, color: !pct ? "#D1D5DB" : pct > 0 ? "#059669" : "#EF4444", background: `${colors.primary}1e` }}>
                  {pct !== null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                </td>
              )}
            </Fragment>
          );
        })}
      </tr>

      {/* Sum node expanded → render mapping children */}
      {expanded && hasMappingChildren && node.children.map((child, ci) => (
        <MappedSheetRow key={child.id ?? `${child.code}-${ci}`}
          node={child} depth={depth + 1}
          pivot={pivot} visibleCompanies={visibleCompanies}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
          compareMode={compareMode} cmpPivot={cmpPivot} colors={colors} rowIndex={rowIndex + ci + 1}
          uploadedData={uploadedData} journalEntries={journalEntries} groupToCf={groupToCf} nameFor={nameFor} />
      ))}

      {/* Leaf node expanded → drill into ERP / journal entries */}
      {expanded && !hasMappingChildren && drillGroups.length === 0 && (
        <tr>
          <td colSpan={totalCols} className="px-8 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300">
            No underlying accounts
          </td>
        </tr>
      )}
      {expanded && !hasMappingChildren && drillGroups.map((g, gi) => (
        <DrillGroupRow key={g.groupCode} groupIndex={gi}
          groupCode={g.groupCode} groupName={g.groupName} localRows={g.localRows}
          visibleCompanies={visibleCompanies} colors={colors}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} compareMode={compareMode} />
      ))}
    </>
  );
}

/* ─── SheetRow (individual flat) ─────────────────────────────────────── */
function SheetRow({
  node, depth, pivot, visibleCompanies,
  body1Style, body2Style, subbody1Style,
  isSubtotal, compareMode = false, cmpPivot = new Map(), colors, rowIndex = 0,
  uploadedData = [], journalEntries = [], groupToCf,
}) {
  const [expanded, setExpanded] = useState(false);
  const byCompany = pivot.get(node.AccountCode) || {};
  const getContrib = (company) =>
    (byCompany[company] ?? []).reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0);

  // Level 1: group codes that map to this CF code, with their local rows
const drillGroups = useMemo(() => {
    if (!expanded) return [];
    const byGroup = new Map();

    const ensureBucket = (groupCode, groupName) => {
      if (!byGroup.has(groupCode)) {
        byGroup.set(groupCode, { groupCode, groupName: groupName ?? "", rowMap: new Map() });
      }
      return byGroup.get(groupCode);
    };

    // ── ERP rows from uploaded-accounts (excluding journals) ──
    uploadedData.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      const cfs = groupToCf?.get(groupCode) ?? [];
      if (!cfs.includes(node.AccountCode)) return;

      const origin = r.Origin ?? r.origin ?? "";
      const rawLocalCode = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (origin === "Journal" || !rawLocalCode) return; // journals go through journalEntries below

      const bucket = ensureBucket(groupCode, r.AccountName ?? r.accountName);
      const key = `ERP::${rawLocalCode}::${co}`;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      if (!bucket.rowMap.has(key)) {
        bucket.rowMap.set(key, {
          localCode: rawLocalCode,
          localName: r.LocalAccountName ?? r.localAccountName ?? "",
          isJournal: false,
          co,
          amt: 0,
        });
      }
      bucket.rowMap.get(key).amt += amt;
    });

    // ── Journal rows from journal-entries, grouped per JournalNumber ──
    journalEntries.forEach(j => {
      const groupCode = String(j.AccountCode ?? j.accountCode ?? "");
      const co = j.CompanyShortName ?? j.companyShortName ?? "";
      const cfs = groupToCf?.get(groupCode) ?? [];
      if (!cfs.includes(node.AccountCode)) return;

      const journalNumber = String(j.JournalNumber ?? j.journalNumber ?? "");
      const journalHeader = j.JournalHeader ?? j.journalHeader ?? "";
      const journalType   = j.JournalType   ?? j.journalType   ?? "";

      const bucket = ensureBucket(groupCode, j.AccountName ?? j.accountName);
      const key = `JRN::${journalNumber}::${co}`;
      const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
      if (!bucket.rowMap.has(key)) {
        bucket.rowMap.set(key, {
          localCode: journalNumber || "JRN",
          localName: journalHeader || journalType || "Journal",
          isJournal: true,
          co,
          amt: 0,
        });
      }
      bucket.rowMap.get(key).amt += amt;
    });

    return [...byGroup.values()]
      .map(g => ({
        ...g,
        localRows: [...g.rowMap.values()].sort((a, b) => {
          if (a.isJournal !== b.isJournal) return a.isJournal ? 1 : -1;
          return (a.localCode || a.localName).localeCompare(b.localCode || b.localName);
        }),
      }))
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode));
  }, [expanded, uploadedData, journalEntries, groupToCf, node.AccountCode]);

  const totalCols = 1 + visibleCompanies.length * (compareMode ? 4 : 1);

  return (
    <>
      <tr className="group border-b border-gray-100 transition-colors hover:bg-[#eef1fb]/40 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
        style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both` }}>
        <td className="sticky left-0 z-10 py-2.5 pr-6 border-r border-gray-100 bg-white group-hover:bg-[#eef1fb]/40"
          style={{ paddingLeft: `${24 + depth * 16}px`, minWidth: 260, width: 260 }}>
          <div className="flex items-center gap-2 select-none">
            <ChevronDown size={10} className="flex-shrink-0 transition-transform duration-200"
              style={{ color: `${colors.primary}60`, transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }} />
            <span className="flex-shrink-0 mr-1" style={subbody1Style}>{node.AccountCode}</span>
            <span className="truncate" style={body1Style}>{node.AccountName}</span>
          </div>
        </td>
        {visibleCompanies.map(c => {
          const val = getContrib(c);
          const cmpVal = compareMode
            ? (cmpPivot?.get(node.AccountCode)?.[c] ?? []).reduce((s, r) => s + Number(r._cfAmount ?? 0), 0)
            : null;
          const delta = cmpVal !== null ? Math.round(val) - Math.round(cmpVal) : null;
          const pct = (cmpVal !== null && Math.round(cmpVal) !== 0)
            ? ((Math.round(val) - Math.round(cmpVal)) / Math.abs(Math.round(cmpVal))) * 100
            : null;
          const devColor = !delta ? "#D1D5DB" : delta > 0 ? "#059669" : "#EF4444";
          return (
            <Fragment key={c}>
              <AnimatedAmountCell value={val} style={{ ...body1Style, fontWeight: isSubtotal ? 800 : body1Style.fontWeight }} />
              {compareMode && (
                <AnimatedAmountCell value={cmpVal ?? 0}
                  style={{ ...body1Style, background: `${colors.primary}08`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 60ms both", transformOrigin: "left center" }} />
              )}
              {compareMode && (
                <td className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums border-l border-gray-100"
                  style={{ minWidth: 100, ...body1Style, color: devColor, background: `${colors.primary}12`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 120ms both", transformOrigin: "left center" }}>
                  {delta ? fmt(delta) : "—"}
                </td>
              )}
              {compareMode && (
                <td className="px-3 py-2.5 text-center whitespace-nowrap tabular-nums"
                  style={{ minWidth: 80, ...body1Style, color: !pct ? "#D1D5DB" : pct > 0 ? "#059669" : "#EF4444", background: `${colors.primary}1e`, animation: "cmpColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 180ms both", transformOrigin: "left center" }}>
                  {pct !== null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                </td>
              )}
            </Fragment>
          );
        })}
      </tr>
      {expanded && drillGroups.length === 0 && (
        <tr>
          <td colSpan={totalCols} className="px-8 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300">
            No underlying accounts
          </td>
        </tr>
      )}
{expanded && drillGroups.map((g, gi) => (
        <DrillGroupRow key={g.groupCode} groupIndex={gi}
          groupCode={g.groupCode} groupName={g.groupName} localRows={g.localRows}
          visibleCompanies={visibleCompanies} colors={colors}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} compareMode={compareMode} />
      ))}
    </>
  );
}
 
/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */
export default function IndividualCashFlowPage({ token, onNavigate }) {
  const header1Style = useTypo("header1");
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const subbody1Style = useTypo("subbody1");
  const underscore1Style = useTypo("underscore1");
  const underscore2Style = useTypo("underscore2");
const filterStyle = useTypo("filter");
  const { colors } = useSettings();
const { access: resourceAccess } = useCurrentUserResourceAccess();

  const [periods,        setPeriods]        = useState([]);
  const [sources,        setSources]        = useState([]);
  const [structures,     setStructures]     = useState([]);
  const [companies,      setCompanies]      = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);
  const [cfMapping,      setCfMapping]      = useState([]);
  const [mappedAccounts, setMappedAccounts] = useState([]);
  const [cfNameDict,     setCfNameDict]     = useState({});

  const [pgcCfMapping,           setPgcCfMapping]           = useState(null);
  const [danishIfrsCfMapping,    setDanishIfrsCfMapping]    = useState(null);
  const [spanishIfrsEsCfMapping, setSpanishIfrsEsCfMapping] = useState(null);

  const [year,      setYear]      = useState("");
  const [month,     setMonth]     = useState("");
  const [source,    setSource]    = useState("");
  const [structure, setStructure] = useState("DefaultStructure");
const [selectedCompanies, setSelectedCompanies] = useState(null);
const [upDimGroups, setUpDimGroups] = useState(null);
  const [upDimensions, setUpDimensions] = useState(null);
  const [dimensionsMeta, setDimensionsMeta] = useState([]);

const [uploadedData,   setUploadedData]   = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [metaReady,      setMetaReady]      = useState(false);

const autoPeriodDone = useRef(false);

  /* ─── Metadata ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${BASE}/periods`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/sources`,                  { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/structures`,               { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/companies`,                { headers: h }).then(r => r.json()).then(d => d.value || d),
      fetch(`${BASE}/group-structure`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
      fetch(`${BASE}/mapped-cashflow-accounts`, { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
fetch(`${BASE}/mapped-accounts`,          { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
      fetch(`${BASE}/dimensions`,               { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
    ]).then(([p, s, st, co, gs, cf, ma, dims]) => {
      if (cancelled) return;
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      setCfMapping(Array.isArray(cf) ? cf : []);
      setMappedAccounts(Array.isArray(ma) ? ma : []);
      setDimensionsMeta(Array.isArray(dims) ? dims : []);

      const structureNames = (st || []).map(x => x.GroupStructure ?? x);
      const defaultFlagged = (st || []).find(x => x.IsDefault === true || x.isDefault === true)?.GroupStructure;
      let chosenStructure;
      if (structureNames.includes("DefaultStructure")) chosenStructure = "DefaultStructure";
      else if (defaultFlagged) chosenStructure = defaultFlagged;
      else if (structureNames.length > 0) chosenStructure = structureNames[0];
      if (chosenStructure) setStructure(chosenStructure);

      const latest = p
        .filter(x => x.Source === "Actual" && x.Closed === true)
        .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0]
        ?? p
        .filter(x => x.Source === "Actual")
        .sort((a, b) => b.Year !== a.Year ? b.Year - a.Year : b.Month - a.Month)[0];
      if (latest) { setYear(String(latest.Year)); setMonth(String(latest.Month)); setSource("Actual"); }
      setMetaReady(true);
    });
    return () => { cancelled = true; };
  }, [token]);

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
    const sb = { apikey: SB_APIKEY, Authorization: `Bearer ${SB_APIKEY}` };
    Promise.all([
      fetch(`${SB_URL}/${table_rows}?select=*&order=sort_order.asc`,    { headers: sb }).then(r => r.json()),
      fetch(`${SB_URL}/${table_sections}?select=*&order=sort_order.asc`, { headers: sb }).then(r => r.json()),
    ]).then(([rowsArr, secsArr]) => {
      if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
      const rows = new Map();
      rowsArr.forEach(r => rows.set(String(r.account_code), {
        section: String(r.section_code), sortOrder: Number(r.sort_order),
        isSum: !!r.is_sum, showInSummary: !!r.show_in_summary, level: Number(r.level ?? 0),
      }));
      const sections = new Map();
      secsArr.forEach(s => sections.set(String(s.section_code), { label: String(s.label), color: String(s.color) }));
      setter({ rows, sections });
    }).catch(() => setter(null));
  };

  useEffect(() => {
    if (cfStandard !== "pgc")            { setPgcCfMapping(null); return; }
    loadCfStandardMapping("pgc_cf_rows", "pgc_cf_sections", setPgcCfMapping);
  }, [cfStandard]);

  useEffect(() => {
    if (cfStandard !== "danish_ifrs")    { setDanishIfrsCfMapping(null); return; }
    loadCfStandardMapping("danish_ifrs_cf_rows", "danish_ifrs_cf_sections", setDanishIfrsCfMapping);
  }, [cfStandard]);

  useEffect(() => {
    if (cfStandard !== "spanish_ifrs_es") { setSpanishIfrsEsCfMapping(null); return; }
    loadCfStandardMapping("spanish_ifrs_es_cf_rows", "spanish_ifrs_es_cf_sections", setSpanishIfrsEsCfMapping);
  }, [cfStandard]);

  const activeCfMapping = pgcCfMapping ?? danishIfrsCfMapping ?? spanishIfrsEsCfMapping;

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

const visibleCompanies = useMemo(() => {
    if (!selectedCompanies) return effectiveContributionCompanies;
    return effectiveContributionCompanies.filter(c => selectedCompanies.includes(c));
  }, [effectiveContributionCompanies, selectedCompanies]);

  const [colOrder, setColOrder] = useState(null);
  const [draggingCol, setDraggingCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const orderedVisibleCompanies = useMemo(() => {
    if (!colOrder) return visibleCompanies;
    const map = new Map(visibleCompanies.map(c => [c, c]));
    return colOrder.map(c => map.get(c)).filter(Boolean);
  }, [visibleCompanies, colOrder]);

  const visibleCompaniesKey = useMemo(() => visibleCompanies.join(","), [visibleCompanies]);
  useEffect(() => { setColOrder(null); }, [visibleCompaniesKey]);

/* ─── Fetch uploaded data + CF names (with auto walk-back if empty) ──── */
  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure) return;
    let cancelled = false;
    setLoading(true);

    const auth = { headers: { Authorization: `Bearer ${token}` } };

    (async () => {
      let tryY = parseInt(year), tryM = parseInt(month);
      const maxAttempts = autoPeriodDone.current ? 1 : 24;

      for (let i = 0; i < maxAttempts; i++) {
        if (cancelled) return;
        const baseFilter = `Year eq ${tryY} and Month eq ${tryM} and Source eq '${source}' and GroupStructure eq '${structure}'`;
        try {
          const [uploaded, cons, journals] = await Promise.all([
            fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, auth)
              .then(r => r.json()).then(d => d.value || []),
            fetch(`${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(baseFilter)}`, auth)
              .then(r => r.json()).then(d => d.value || []).catch(() => []),
            fetch(`${BASE}/journal-entries?$filter=${encodeURIComponent(baseFilter)}`, auth)
              .then(r => r.json()).then(d => d.value || []).catch(() => []),
          ]);
          if (cancelled) return;

          if (uploaded.length > 0 || autoPeriodDone.current) {
            const cfRowsForNames = cons.filter(r => {
              const t = r.AccountType ?? r.accountType ?? "";
              return t === "C/F" || t === "CFS";
            });
            setCfNameDict(prev => {
              const next = { ...prev };
              cfRowsForNames.forEach(r => {
                const code = r.AccountCode ?? r.accountCode;
                const name = r.AccountName ?? r.accountName;
                if (code && name && !next[code]) next[code] = name;
              });
              return next;
            });
            setUploadedData(uploaded);
            setJournalEntries(Array.isArray(journals) ? journals : []);
            if (String(tryY) !== year || String(tryM) !== month) {
              setYear(String(tryY)); setMonth(String(tryM));
            }
            autoPeriodDone.current = true;
            setLoading(false);
            return;
          }
        } catch {
          if (!cancelled) setLoading(false);
          return;
        }
        tryM -= 1;
        if (tryM < 1) { tryM = 12; tryY -= 1; }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [token, metaReady, year, month, source, structure]);

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
    let added = true;
    while (added) {
      added = false;
      for (const node of [...m.values()]) {
        const p = node.sumParent;
        if (p && !m.has(p)) {
          m.set(p, { name: cfNameDict[p] || "", sumParent: "" });
          added = true;
        }
      }
    }
    return m;
  }, [cfMapping, cfNameDict]);

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

    const leafCodes = [...piv.keys()];
    leafCodes.forEach(leafCode => {
      const meta = cfMetadata.get(leafCode);
      if (!meta) return;
      let parent = meta.sumParent;
      const seen = new Set([leafCode]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const leafPiv = piv.get(leafCode) || {};
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
  const nameFor = (code) => {
    const meta = cfMetadata.get(code);
    if (meta?.name) return meta.name;
    if (cfNameDict[code]) return cfNameDict[code];
    return "";
  };

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
  const availableMonths = [...new Set(periods.map(p => p.Month))].sort((a,b) => a-b).map(m => ({ value: String(m), label: MONTHS.find(x => x.value === m)?.label ?? String(m) }));

 const getLegal = co => companies.find(c => c.CompanyShortName === co)?.CompanyLegalName || co;
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
  const [viewsModalOpen, setViewsModalOpen] = useState(false);

  // ── Cash flow mappings ────────────────────────────────────────────────
  const [activeMapping, setActiveMapping] = useState(null);
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
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { listMappings: listStruct, getActiveCompanyId } = await import("../../lib/cashflowMappingsApi");
        const { listMappings: listReport } = await import("../../lib/cashflowReportMappingsApi");
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
      } catch (err) { console.error("[cf recent-mappings]", err); }
    })();
  }, []);

  const fetchSavedMappings = async () => {
    setSavedMappingsLoading(true); setSavedMappingsError(null);
    try {
      const { supabase } = await import("../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { listMappings, getActiveCompanyId } = await import("../../lib/cashflowMappingsApi");
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
      const { supabase } = await import("../../lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("Not authenticated");
      const { listMappings, getActiveCompanyId } = await import("../../lib/cashflowReportMappingsApi");
      const cid = await getActiveCompanyId(uid);
      if (!cid) throw new Error("No active company");
      const rows = await listMappings({ companyId: cid });
      setReportMappings(Array.isArray(rows) ? rows : []);
    } catch (e) { setReportMappingsError(e.message); setReportMappings([]); }
    finally { setReportMappingsLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (viewsMode === "structure") fetchSavedMappings(); }, [viewsMode]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (viewsMode === "report") fetchReportMappings(); }, [viewsMode]);
const [compareMode, setCompareMode] = useState(false);
  const [cmpVisible, setCmpVisible] = useState(false);
  const [cmpExiting, setCmpExiting] = useState(false);
  const [cmpYear,  setCmpYear]  = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
  const [cmpSource, setCmpSource] = useState("");
  const [cmpPivot, setCmpPivot] = useState(new Map());
  const [cmpLoading, setCmpLoading] = useState(false);

  useEffect(() => {
    if (compareMode) {
      setCmpVisible(true); setCmpExiting(false);
    } else if (cmpVisible) {
      setCmpExiting(true);
      const t = setTimeout(() => { setCmpVisible(false); setCmpExiting(false); }, 350);
      return () => clearTimeout(t);
    }
  }, [compareMode]);

 // Fetch compare period when compare mode is active
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !structure) { setCmpPivot(new Map()); return; }
    let cancelled = false;
    setCmpLoading(true);
    const baseFilter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${structure}'`;
    fetch(`${BASE}/reports/uploaded-accounts?$filter=${encodeURIComponent(baseFilter)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        if (cancelled) return;
        const rows = d.value || [];
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
        // bubble up to parents
        [...piv.keys()].forEach(leafCode => {
          const meta = cfMetadata.get(leafCode);
          if (!meta) return;
          let parent = meta.sumParent;
          const seen = new Set([leafCode]);
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            const lp = piv.get(leafCode) || {};
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

  const filterStr = [source, structure,
    year && month ? `${MONTHS.find(m => m.value === parseInt(month))?.label ?? month} ${year}` : ""
  ].filter(Boolean).join(" · ");

  const handleExportXlsx = async () => {
    const C = { primary: "FF1A2F8A", white: "FFFFFFFF", highlight: "FFEEF1FB", band2: "FFF8F9FF", red: "FFDC2626", gray: "FF9CA3AF" };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cash Flow", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const totalCols = 1 + visibleCompanies.length;

    ws.mergeCells(1, 1, 1, totalCols);
    Object.assign(ws.getCell(1, 1), { value: "Cash Flow — By Company", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 16, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, totalCols);
    Object.assign(ws.getCell(2, 1), { value: filterStr || "—", fill: { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } }, font: { name: "Calibri", size: 10, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 6;

    const hRow = ws.getRow(4);
    hRow.height = 24;
    ["Account", ...visibleCompanies.map(c => getLegal(c))].forEach((h, i) => {
      const c = hRow.getCell(i + 1);
      c.value = h;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
    });

    let rn = 5;
    sectionOrder.forEach(sec => {
      const codes = bySection.get(sec);
      if (!codes?.length) return;
      const secInfo = activeCfMapping?.sections?.get(sec);

      ws.mergeCells(rn, 1, rn, totalCols);
      const sc = ws.getCell(rn, 1);
      sc.value = (secInfo?.label || sec).toUpperCase();
      sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + (secInfo?.color || "#1a2f8a").replace("#", "").toUpperCase().padStart(6, "0") } };
      sc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
      sc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(rn).height = 18;
      rn++;

      codes.forEach((code, idx) => {
        const name = nameFor(code);
        const isSubtotal = subtotalCodes.has(code);
        const band = idx % 2 === 0 ? "FFFFFFFF" : C.band2;
        const lc = ws.getCell(rn, 1);
        lc.value = `${code}  ${name}`.trim();
        lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        lc.font = { name: "Calibri", size: 10, bold: isSubtotal, color: { argb: C.primary } };
        lc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        visibleCompanies.forEach((co, ci) => {
          const byCo = pivot.get(code) || {};
          const val = Math.round((byCo[co] ?? []).reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0));
          const vc = ws.getCell(rn, 2 + ci);
          if (val !== 0) { vc.value = val; vc.numFmt = '#,##0;[Red]-#,##0'; vc.font = { name: "Calibri", size: 10, bold: isSubtotal, color: { argb: val < 0 ? C.red : "FF000000" } }; }
          else { vc.font = { name: "Calibri", size: 10, color: { argb: C.gray } }; }
          vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
          vc.alignment = { vertical: "middle", horizontal: "right" };
        });
        ws.getRow(rn).height = 18;
        rn++;
      });
    });

    ws.getColumn(1).width = 42;
    visibleCompanies.forEach((_, i) => { ws.getColumn(2 + i).width = 18; });
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `CashFlow_${year}_${String(month).padStart(2, "0")}.xlsx`);
  };

  const handleExportPdf = () => {
    const H = { primary: "#1A2F8A", white: "#FFFFFF", band2: "#F8F9FF", red: "#DC2626" };
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(H.primary); doc.rect(0, 0, pageWidth, 60, "F");
    doc.setTextColor(H.white); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Cash Flow — By Company", 24, 28);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(filterStr || "—", 24, 46);

    const head = [["Account", ...visibleCompanies.map(c => getLegal(c))]];
    const body = [];
    sectionOrder.forEach(sec => {
      const codes = bySection.get(sec);
      if (!codes?.length) return;
      const secInfo = activeCfMapping?.sections?.get(sec);
      body.push([{ content: (secInfo?.label || sec).toUpperCase(), colSpan: 1 + visibleCompanies.length, styles: { fillColor: secInfo?.color || H.primary, textColor: H.white, fontStyle: "bold" } }]);
      codes.forEach(code => {
        const name = nameFor(code);
        const isSubtotal = subtotalCodes.has(code);
        const fmtVal = v => { const r = Math.round(v); return r === 0 ? "—" : r.toLocaleString("de-DE"); };
        body.push([
          { content: `${code}  ${name}`.trim(), styles: { fontStyle: isSubtotal ? "bold" : "normal", halign: "left" } },
          ...visibleCompanies.map(co => {
            const byCo = pivot.get(code) || {};
            const val = (byCo[co] ?? []).reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
            return { content: fmtVal(val), styles: { halign: "right", textColor: val < 0 ? H.red : "#000000" } };
          }),
        ]);
      });
    });

    autoTable(doc, { head, body, startY: 80, theme: "plain",
      styles: { font: "helvetica", fontSize: 7, cellPadding: 3, textColor: H.primary },
      headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "right" },
      columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 130 } },
      alternateRowStyles: { fillColor: H.band2 },
    });
    doc.save(`CashFlow_${year}_${String(month).padStart(2, "0")}.pdf`);
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <style>{`
        .cf-scroll-outer { position: relative; overflow: hidden; }
        .cf-scroll {
          overflow: auto; height: 100%;
          scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9;
        }
.cf-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .cf-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .cf-scroll::-webkit-scrollbar-thumb { background: transparent; }
        .cf-scroll::-webkit-scrollbar-track { background: transparent; }
.cf-scroll thead { background: rgba(255,255,255,0.95); }
        .cf-scroll thead th { border-color: transparent !important; box-shadow: none !important; }
@keyframes cmpBarIn    { from { opacity:0; transform:translateY(-12px) scaleY(0.7); } to { opacity:1; transform:translateY(0) scaleY(1); } }
        @keyframes cmpBarOut   { from { opacity:1; transform:translateY(0) scaleY(1); } to { opacity:0; transform:translateY(-12px) scaleY(0.7); } }
        @keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
@keyframes cmpColIn    { from { opacity:0; transform:scaleX(0.6); } to { opacity:1; transform:scaleX(1); } }
        @keyframes cmpColOut   { from { opacity:1; transform:scaleX(1); } to { opacity:0; transform:scaleX(0.6); } }
        @keyframes drillSlideIn { 0% { opacity:0; transform:translateY(-6px) scaleY(0.85); } 100% { opacity:1; transform:translateY(0) scaleY(1); } }
@keyframes pageIn { 0% { opacity:0; transform:translateY(16px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes cfBarSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
      `}</style>

<PageHeader
        kicker={viewsMode ? "Mappings" : "Reports"}
        title={
          viewsMode === "landing"   ? "Mappings"
          : viewsMode === "structure" ? "Structure Mappings"
          : viewsMode === "report"    ? "Report Mappings"
          : "Cash Flow"
        }
        onBack={viewsMode ? () => { if (viewsMode === "landing") setViewsMode(null); else setViewsMode("landing"); } : undefined}
        filters={viewsMode ? [] : [
...(effectiveSources.length > 0
            ? [{ label: "Source", value: source, onChange: setSource,
                options: effectiveSources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s })) }]
            : []),
          ...(availableYears.length > 0
            ? [{ label: "Year", value: year, onChange: setYear, options: availableYears }]
            : []),
          ...(availableMonths.length > 0
            ? [{ label: "Month", value: month, onChange: setMonth, options: availableMonths }]
            : []),
          ...(effectiveStructures.length > 0
            ? [{ label: "Structure", value: structure, onChange: setStructure,
                options: effectiveStructures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s })) }]
            : []),
...(effectiveContributionCompanies.length > 1
            ? [{
                label: "Companies",
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
            ? [{ label: "Dim Group", multiselect: true, values: upDimGroups,
                onChange: vs => { setUpDimGroups(vs); setUpDimensions(null); },
               options: dimGroups.map(g => ({ value: g, label: g })) }]
            : []),
          ...(filteredDims.length > 0
            ? [{ label: "Dims", multiselect: true, values: upDimensions,
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
compareToggle={viewsMode ? null : { active: compareMode, onChange: setCompareMode }}
        onExportPdf={viewsMode ? undefined : handleExportPdf}
        onExportXlsx={viewsMode ? undefined : async () => {
          setExporting(true);
          try { await handleExportXlsx(); }
          finally { setExporting(false); }
        }}
        onMappingsClick={viewsMode ? undefined : () => setViewsMode("landing")}
        mappingsQuickAccess={viewsMode ? [] : recentMappings}
        onQuickApplyMapping={async (m) => {
          try {
            const mod = await import(m.kind === "report" ? "../../lib/cashflowReportMappingsApi" : "../../lib/cashflowMappingsApi");
            const full = await mod.getMapping(m.id);
            handleApplyMapping(full ?? m.raw, m.kind);
          } catch (err) {
            console.error("[cf quick apply mapping]", err);
          }
        }}
      />

{activeMapping && !viewsMode && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm flex-shrink-0">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
          <span className="text-xs text-emerald-700 font-medium">
            Mapping active: <strong className="font-black">{activeMapping.name}</strong>
            <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
          </span>
          <button
            onClick={() => {
              try {
                sessionStorage.setItem("cashflow-mappings:openForEdit", JSON.stringify({
                  mapping_id: activeMapping.mapping_id,
                  kind: activeMapping.kind ?? "structure",
                }));
              } catch { /* ignore quota errors */ }
              onNavigate?.("cashflow-mappings");
            }}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
            title="Edit this mapping"
          >
            <Pencil size={11} />
            Edit
          </button>
          <button
            onClick={() => setActiveMapping(null)}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
            title="Clear active mapping"
          >
            <X size={11} />
            Clear
          </button>
        </div>
      )}

{cmpVisible && !viewsMode && <div className="flex-shrink-0 overflow-hidden" style={{
        maxHeight: cmpExiting ? 0 : 200,
        opacity: cmpExiting ? 0 : 1,
        marginBottom: cmpExiting ? 0 : undefined,
        transition: "max-height 380ms cubic-bezier(0.4,0,0.2,1), opacity 280ms cubic-bezier(0.4,0,0.2,1), margin-bottom 380ms cubic-bezier(0.4,0,0.2,1)",
      }}>
      <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm"
        style={{ transformOrigin: "top center", animation: cmpExiting ? undefined : "cmpBarIn 400ms cubic-bezier(0.34,1.56,0.64,1) both" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>Compare with</span>
          </div>
          <HeaderFilterPill label="Source" value={cmpSource} onChange={setCmpSource}
            options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          <HeaderFilterPill label="Year" value={cmpYear} onChange={setCmpYear}
            options={availableYears} />
          <HeaderFilterPill label="Month" value={cmpMonth} onChange={setCmpMonth}
            options={availableMonths} />
          <HeaderFilterPill label="Structure" value={structure} onChange={() => {}}
            options={structures.map(s => ({ value: s.GroupStructure ?? s, label: s.GroupStructure ?? s }))} />
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
                    <p className="font-black text-xl text-gray-800 mb-2">Structure Mappings</p>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-xs">Reorganize the cash flow account hierarchy. Group, rename, and define the structural breakdown.</p>
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
                    <p className="font-black text-xl text-gray-800 mb-2">Report Mappings</p>
                    <p className="text-xs text-gray-500 leading-relaxed max-w-xs">Custom presentation layouts for cash flow reports. Tailor the output for specific audiences.</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {viewsMode === "structure" && (
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0">
              <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Library</p>
                <p className="font-black text-xs text-gray-700">Saved Structure Mappings</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {savedMappingsLoading && <div className="py-16 text-center"><Loader2 size={24} className="text-[#1a2f8a] animate-spin mx-auto mb-2" /><p className="text-gray-400 text-xs">Loading mappings…</p></div>}
                {savedMappingsError && !savedMappingsLoading && <div className="py-12 text-center"><p className="text-red-500 text-xs font-bold">{savedMappingsError}</p></div>}
                {!savedMappingsLoading && !savedMappingsError && savedMappings.length === 0 && <div className="py-16 text-center"><Library size={24} className="text-[#1a2f8a] mx-auto mb-2" /><p className="text-gray-700 font-black text-sm">No mappings yet</p></div>}
                {!savedMappingsLoading && !savedMappingsError && savedMappings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {savedMappings.map(m => {
                      const isActive = activeMapping?.mapping_id === m.mapping_id;
                      return (
                        <button key={m.mapping_id}
                          onClick={async () => {
                            try {
                              const { getMapping } = await import("../../lib/cashflowMappingsApi");
                              const full = await getMapping(m.mapping_id);
                              handleApplyMapping(full ?? m, "structure");
                              setViewsMode(null);
                            } catch (err) {
                              console.error("[cf apply structure mapping]", err);
                            }
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
                            <span className="text-[9px] text-gray-400">Updated {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white"><CheckCircle2 size={9} />Apply</span>
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
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Library</p>
                <p className="font-black text-xs text-gray-700">Saved Report Mappings</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {reportMappingsLoading && <div className="py-16 text-center"><Loader2 size={24} className="text-[#CF305D] animate-spin mx-auto mb-2" /><p className="text-gray-400 text-xs">Loading report mappings…</p></div>}
                {reportMappingsError && !reportMappingsLoading && <div className="py-12 text-center"><p className="text-red-500 text-xs font-bold">{reportMappingsError}</p></div>}
                {!reportMappingsLoading && !reportMappingsError && reportMappings.length === 0 && <div className="py-16 text-center"><FileText size={24} className="text-[#CF305D] mx-auto mb-2" /><p className="text-gray-700 font-black text-sm">No report mappings yet</p></div>}
                {!reportMappingsLoading && !reportMappingsError && reportMappings.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {reportMappings.map(m => {
                      const isActive = activeMapping?.mapping_id === m.mapping_id;
                      return (
                        <button key={m.mapping_id}
                          onClick={async () => {
                            try {
                              const { getMapping } = await import("../../lib/cashflowReportMappingsApi");
                              const full = await getMapping(m.mapping_id);
                              handleApplyMapping(full ?? m, "report");
                              setViewsMode(null);
                            } catch (err) {
                              console.error("[cf apply report mapping]", err);
                            }
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
                            <span className="text-[9px] text-gray-400">Updated {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—"}</span>
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 group-hover:bg-emerald-600 text-white"><CheckCircle2 size={9} />Apply</span>
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
{(loading && uploadedData.length === 0) || !metaReady ? (
            <CfLoadingSpinner colors={colors} metaReady={metaReady} />
          ) : !hasData ? (
            <div className="flex items-center justify-center flex-1 text-xs text-gray-300 font-black uppercase tracking-widest">
              No data for selected filters
            </div>
          ) : (
<div className="cf-scroll-outer flex-1 min-h-0 relative" style={{ minWidth: 0, animation: "pageIn 400ms cubic-bezier(0.34,1.56,0.64,1) both" }}>
              {loading && (
                <div className="absolute top-0 left-0 right-0 z-50 overflow-hidden" style={{ height: 2, background: "rgba(26,47,138,0.08)" }}>
                  <div style={{
                    height: "100%",
                    width: "30%",
                    background: `linear-gradient(90deg, transparent, ${colors.primary}, #CF305D, transparent)`,
                    animation: "cfBarSlide 1.2s ease-in-out infinite",
                  }} />
                </div>
              )}
              <div className="cf-scroll" style={{ minWidth: 0 }}>
                <table className="text-xs border-collapse" style={{ borderSpacing: 0, width: "100%", minWidth: "max-content", tableLayout: "auto" }}>
<thead className="sticky top-0 z-30">
                    <tr style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
                      <th className="sticky left-0 z-40 text-left px-6" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: "64px", minWidth: 220, width: 220 }}>
                        <div className="flex items-baseline gap-2.5">
                          <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>Account</span>
                          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>Cash Flow</span>
                        </div>
                      </th>
                      {orderedVisibleCompanies.map(c => {
                        const ccy = companies.find(x => x.CompanyShortName === c)?.CurrencyCode || "—";
                        return (
                          <Fragment key={c}>
<th className="text-center px-4 select-none"
                              draggable
                              onDragStart={() => setDraggingCol(c)}
                              onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
                              onDragLeave={() => setDragOverCol(null)}
                              onDrop={e => {
                                e.preventDefault();
                                if (!draggingCol || draggingCol === c) { setDraggingCol(null); setDragOverCol(null); return; }
                                const cols = colOrder ?? [...orderedVisibleCompanies];
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
                              style={{
                                background: dragOverCol === c ? `${colors.primary}15` : "rgba(255,255,255,0.95)",
                                borderLeft: "1px solid #f0f0f0",
                                cursor: "grab",
                                outline: dragOverCol === c ? `2px solid ${colors.primary}` : "none",
                                opacity: draggingCol === c ? 0.4 : 1,
                                transition: "background 150ms ease, outline 150ms ease",
                              }}>
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="font-black tracking-tight truncate max-w-[140px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} title={getLegal(c)}>{getLegal(c)}</span>
                                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{ccy}</span>
                              </div>
                            </th>
{compareMode && (
<th className="text-center px-3" style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15` }}>
                                <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
                              </th>
                            )}
                            {compareMode && (
                              <th className="text-center px-3" style={{ background: `${colors.primary}08` }}>
                                <span className="font-black" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
                              </th>
                            )}
                            {compareMode && (
                              <th className="text-center px-3" style={{ background: `${colors.primary}08` }}>
                                <span className="font-black" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
                              </th>
                            )}
                          </Fragment>
                        );
                      })}
                    </tr>
                  </thead>

<tbody>
{activeMapping?.cfLiteral ? (
                      // ── CUSTOM MAPPING RENDER ───────────────────────────
                      activeMapping.cfLiteral.map((section, secIdx) => {
                        const totalCols = 1 + visibleCompanies.length * (compareMode ? 4 : 1);
                        return (
                          <Fragment key={`cfmap-sec-${secIdx}`}>
                            {section.label && (
                              <tr>
                                <td className="sticky left-0 z-10 whitespace-nowrap"
                                  style={{
                                    backgroundColor: section.color || colors.primary,
                                    color: "#fff", padding: "8px 16px",
                                    fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                                    minWidth: 220, width: 220,
                                  }}>
                                  {section.label}
                                </td>
                                <td colSpan={totalCols - 1}
                                  style={{ backgroundColor: section.color || colors.primary }} />
                              </tr>
                            )}
                            {section.nodes.map((n, idx) => (
                              <MappedSheetRow key={n.id ?? `${n.code}-${idx}`}
                                node={n} depth={0}
                                pivot={pivot} visibleCompanies={orderedVisibleCompanies}
                                body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                                compareMode={compareMode} cmpPivot={cmpPivot} colors={colors} rowIndex={idx}
                                uploadedData={filteredUploadedData} journalEntries={journalEntries} groupToCf={groupToCf} nameFor={nameFor} />
                            ))}
                          </Fragment>
                        );
                      })
                    ) : (
                      // ── DEFAULT STANDARD RENDER (PGC / Danish / Spanish IFRS) ──
                      sectionOrder.map(sec => {
                        const codes = bySection.get(sec);
                        if (!codes || codes.length === 0) return null;

                        const secInfo = activeCfMapping?.sections?.get(sec);
                        const totalCols = 1 + visibleCompanies.length * (compareMode ? 4 : 1);

                        return (
                          <Fragment key={`section-${sec}`}>
                            <tr>
                              <td className="sticky left-0 z-10 whitespace-nowrap"
                                style={{
                                  backgroundColor: secInfo?.color || colors.primary,
                                  color: "#fff", padding: "8px 16px",
                                  fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                                  minWidth: 220, width: 220,
                                }}>
                                {secInfo?.label || sec}
                              </td>
                              <td colSpan={totalCols - 1}
                                style={{ backgroundColor: secInfo?.color || colors.primary }} />
                            </tr>
                            {codes.map((code, idx) => {
                              const isSubtotal = subtotalCodes.has(code);
                              const node = {
                                AccountCode: code,
                                AccountName: nameFor(code),
                              };
                              return (
                                <SheetRow key={code} node={node} depth={0}
                                  pivot={pivot} visibleCompanies={orderedVisibleCompanies}
                                  body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                                  isSubtotal={isSubtotal} rowIndex={idx}
                                  compareMode={compareMode} cmpPivot={cmpPivot} colors={colors}
                                  uploadedData={filteredUploadedData} journalEntries={journalEntries} groupToCf={groupToCf} />
                              );
                            })}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
</div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}