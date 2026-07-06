/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useMemo, Fragment, useCallback, useDeferredValue } from "react";
import { ChevronDown, Loader2, Layers, FileText, Library, CheckCircle2, Pencil, X } from "lucide-react";
import { useTypo, useSettings } from "./SettingsContext";
import PageHeader, { MultiFilterPill, FilterPill as HeaderFilterPill } from "./PageHeader.jsx";
import { useCurrentUserResourceAccess } from "../../lib/userPermissionsApi";
import { t } from "../../lib/i18n";

import ExcelJS from "exceljs";
import JSZip from "jszip";
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

// Strips Infinity/NaN cells + ExcelJS quirks so Excel doesn't pop "recovered content"
async function repairCfXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  for (const f of sheets) {
    let xml = await zip.file(f).async("string");
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>-?Infinity<\/v><\/c>/g, "");
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>NaN<\/v><\/c>/g, "");
    xml = xml.replace(/(<row[^>]*outlineLevel="\d+"[^>]*?)\s*collapsed="1"/g, "$1");
    xml = xml.replace(/x14ac:dyDescent="55"/g, 'x14ac:dyDescent="0.25"');
    xml = xml.replace(/outlineLevel="(\d+)"/g, (_, n) => `outlineLevel="${Math.min(7, parseInt(n))}"`);
    xml = xml.replace(/<c r="[^"]+"[^>]*><v><\/v><\/c>/g, "");
    const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"/g)];
    if (cells.length > 0) {
      const cs = cells.map(c => colToNum(c[1]));
      const rs = cells.map(c => +c[2]);
      const ref = `${numToCol(Math.min(...cs))}${Math.min(...rs)}:${numToCol(Math.max(...cs))}${Math.max(...rs)}`;
      xml = xml.replace(/<dimension ref="[^"]+"\s*\/>/, `<dimension ref="${ref}"/>`);
    }
    zip.file(f, xml);
  }
  return await zip.generateAsync({ type: "arraybuffer" });
}

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

function CfLoadingSpinner({ colors, metaReady, T }) {
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
          {!metaReady ? T("cf_loading_finding_period") : T("cf_loading_building")}
        </p>
        <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
          {T("cf_individual_title")}
        </p>
      </div>
    </div>
  );
}


/* ─── DrillGroupRow ─────────────────────────────────────────────────── */
function DrillGroupRow({ groupCode, groupName, localRows, visibleCompanies, colors, body2Style, subbody1Style, compareMode, groupIndex = 0, cmpDrillMap = new Map(), searchQuery = "" }) {
  const [open, setOpen] = useState(false);
  const searchActive = !!searchQuery.trim();
  const q = searchQuery.trim().toLowerCase();
  const effectiveOpen = open || searchActive;
  const isMatchSelf = q && (groupCode.toLowerCase().includes(q) || (groupName || "").toLowerCase().includes(q));
  const amtByCompany = useMemo(() => {
    const m = {};
    visibleCompanies.forEach(c => {
      m[c] = localRows.filter(r => r.co === c).reduce((s, r) => s + r.amt, 0);
    });
    return m;
  }, [localRows, visibleCompanies]);

  const cmpAmtByCompany = useMemo(() => {
    const m = {};
    visibleCompanies.forEach(c => {
      m[c] = cmpDrillMap.get(`GRP::${groupCode}::${c}`) ?? 0;
    });
    return m;
  }, [cmpDrillMap, visibleCompanies, groupCode]);

  return (
    <>
<tr className="group/drill border-b cursor-pointer transition-colors"
        style={{ background: isMatchSelf ? "#fef3c7" : "#f4f6fb", animation: `drillSlideIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${groupIndex * 40}ms both`, transformOrigin: "top center" }}
        onClick={() => setOpen(o => !o)}>
        <td className="sticky left-0 z-10 py-2 pr-4 border-r border-gray-100 group-hover/drill:bg-[#e4e9f5]"
          style={{ paddingLeft: 32, minWidth: 260, width: 260, background: isMatchSelf ? "#fef3c7" : "#f4f6fb" }}>
          <div className="flex items-center gap-2">
<ChevronDown size={10} className={`transition-transform duration-200 flex-shrink-0`}
              style={{ color: colors.primary, transform: effectiveOpen ? "rotate(180deg)" : "rotate(-90deg)" }} />
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
{compareMode && (() => {
                const cmpV = Math.round(cmpAmtByCompany[c] ?? 0);
                const delta = v - cmpV;
                const pct = cmpV !== 0 ? ((v - cmpV) / Math.abs(cmpV)) * 100 : null;
                const devColor = delta === 0 ? "#D1D5DB" : delta > 0 ? "#059669" : "#EF4444";
                return (
                  <>
                    <td className="px-4 py-2 text-center tabular-nums border-l border-gray-100" style={{ ...body2Style, minWidth: 110, background: `${colors.primary}08`, color: cmpV === 0 ? "#D1D5DB" : cmpV < 0 ? "#EF4444" : "#000" }}>
                      {cmpV === 0 ? "—" : fmt(cmpV)}
                    </td>
                    <td className="px-4 py-2 text-center tabular-nums border-l border-gray-100" style={{ ...body2Style, minWidth: 100, background: `${colors.primary}12`, color: devColor }}>
                      {delta === 0 ? "—" : fmt(delta)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums border-l border-gray-100" style={{ ...body2Style, minWidth: 80, background: `${colors.primary}1e`, color: pct === null ? "#D1D5DB" : pct > 0 ? "#059669" : "#EF4444" }}>
                      {pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
                    </td>
                  </>
                );
              })()}
            </Fragment>
          );
        })}
        {!compareMode && (() => {
          const total = visibleCompanies.reduce((s, c) => s + Math.round(amtByCompany[c] ?? 0), 0);
          return (
            <td className="px-4 py-2 text-center tabular-nums" style={{ ...body2Style, background: "#f4f6fb", color: total === 0 ? "#D1D5DB" : total < 0 ? "#EF4444" : "#000", position: "sticky", right: 0, zIndex: 10, borderLeft: "1px solid #f3f4f6", minWidth: 150, fontWeight: 800 }}>
              {total === 0 ? "—" : fmt(total)}
            </td>
          );
        })()}
      </tr>
{effectiveOpen && localRows.map((r, i) => {
        const localMatch = q && ((r.localCode || "").toLowerCase().includes(q) || (r.localName || "").toLowerCase().includes(q));
        return (
        <tr key={i} className="group/local border-b hover:bg-[#eef1fb]" style={{ background: localMatch ? "#fef3c7" : "#f9fafd", animation: `drillSlideIn 220ms cubic-bezier(0.34,1.56,0.64,1) ${i * 25}ms both`, transformOrigin: "top center" }}>
          <td className="sticky left-0 z-10 py-1.5 pr-4 border-r border-gray-100 group-hover/local:bg-[#eef1fb]"
            style={{ paddingLeft: 52, minWidth: 260, width: 260, background: localMatch ? "#fef3c7" : "#f9fafd" }}>
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
{compareMode && (() => {
                  const localKey = r.isJournal ? `JRN::${groupCode}::${r.localCode}::${c}` : `ERP::${groupCode}::${r.localCode}::${c}`;
                  const cmpV = Math.round(cmpDrillMap.get(localKey) ?? 0);
                  // only show cmp data if this row matches the company
                  const showCmp = r.co === c;
                  const myV = showCmp ? Math.round(r.amt) : 0;
                  const delta = myV - cmpV;
                  const pct = cmpV !== 0 ? ((myV - cmpV) / Math.abs(cmpV)) * 100 : null;
                  const devColor = delta === 0 ? "#D1D5DB" : delta > 0 ? "#059669" : "#EF4444";
                  return (
                    <>
                      <td className="px-4 py-1.5 text-center tabular-nums border-l border-gray-100" style={{ ...subbody1Style, minWidth: 110, background: `${colors.primary}08`, color: !showCmp || cmpV === 0 ? "#D1D5DB" : cmpV < 0 ? "#EF4444" : "#000" }}>
                        {!showCmp || cmpV === 0 ? "—" : fmt(cmpV)}
                      </td>
                      <td className="px-4 py-1.5 text-center tabular-nums border-l border-gray-100" style={{ ...subbody1Style, minWidth: 100, background: `${colors.primary}12`, color: devColor }}>
                        {!showCmp || delta === 0 ? "—" : fmt(delta)}
                      </td>
                      <td className="px-3 py-1.5 text-center tabular-nums border-l border-gray-100" style={{ ...subbody1Style, minWidth: 80, background: `${colors.primary}1e`, color: !showCmp || pct === null ? "#D1D5DB" : pct > 0 ? "#059669" : "#EF4444" }}>
                        {!showCmp || pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
                      </td>
                    </>
                  );
                })()}
              </Fragment>
            );
          })}
{!compareMode && (
            <td className="px-4 py-1.5 text-center tabular-nums" style={{ ...subbody1Style, background: "#f9fafd", color: r.amt === 0 ? "#D1D5DB" : r.amt < 0 ? "#EF4444" : "#000", position: "sticky", right: 0, zIndex: 10, borderLeft: "1px solid #f3f4f6", minWidth: 150 }}>
              {r.amt === 0 ? "—" : fmt(Math.round(r.amt))}
            </td>
          )}
        </tr>
      );
      })}
    </>
  );
}

/* ─── MappedSheetRow — renders a node from a custom cf_tree mapping ──── */
function MappedSheetRow({
  node, depth, pivot, visibleCompanies,
  body1Style, body2Style, subbody1Style,
  compareMode = false, cmpPivot = new Map(), colors, rowIndex = 0,
  uploadedData = [], journalEntries = [], groupToCf, nameFor, T,
  cmpUploadedData = [], cmpJournalEntries = [],
  expandAllVersion = 0, expandAllState = false,
  searchQuery = "",
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(expandAllState);
  }, [expandAllVersion, expandAllState]);

  const searchActive = !!searchQuery.trim();
  const effectiveExpanded = expanded || searchActive;
  const q = searchQuery.trim().toLowerCase();
  const isMatchSelf = q && (
    String(node.code).toLowerCase().includes(q) ||
    String(node.name || nameFor(node.code) || "").toLowerCase().includes(q)
  );
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
    if (!effectiveExpanded || hasMappingChildren) return [];
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

let result = [...byGroup.values()]
      .map(g => ({
        ...g,
        localRows: [...g.rowMap.values()].sort((a, b) => {
          if (a.isJournal !== b.isJournal) return a.isJournal ? 1 : -1;
          return (a.localCode || a.localName).localeCompare(b.localCode || b.localName);
        }),
      }))
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode));

    if (searchActive) {
      result = result
        .map(g => {
          const gcMatch = g.groupCode.toLowerCase().includes(q) || (g.groupName || "").toLowerCase().includes(q);
          const filteredLocals = g.localRows.filter(lr =>
            gcMatch
            || (lr.localCode || "").toLowerCase().includes(q)
            || (lr.localName || "").toLowerCase().includes(q)
          );
          return { ...g, localRows: filteredLocals, _groupSelfMatch: gcMatch };
        })
        .filter(g => g._groupSelfMatch || g.localRows.length > 0);
    }

    return result;
  }, [effectiveExpanded, hasMappingChildren, uploadedData, journalEntries, groupToCf, node.code, searchActive, q]);

const cmpDrillMap = useMemo(() => {
    if (!effectiveExpanded || hasMappingChildren || !compareMode) return new Map();
    const m = new Map();
    const add = (k, v) => m.set(k, (m.get(k) ?? 0) + v);
    cmpUploadedData.forEach(r => {
      const gc = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      const cfs = groupToCf?.get(gc) ?? [];
      if (!cfs.includes(node.code)) return;
      const origin = r.Origin ?? r.origin ?? "";
      const lc = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (origin === "Journal" || !lc) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      add(`GRP::${gc}::${co}`, amt);
      add(`ERP::${gc}::${lc}::${co}`, amt);
    });
    cmpJournalEntries.forEach(j => {
      const gc = String(j.AccountCode ?? j.accountCode ?? "");
      const co = j.CompanyShortName ?? j.companyShortName ?? "";
      const cfs = groupToCf?.get(gc) ?? [];
      if (!cfs.includes(node.code)) return;
      const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
      const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
      add(`GRP::${gc}::${co}`, amt);
      add(`JRN::${gc}::${jn}::${co}`, amt);
    });
    return m;
}, [effectiveExpanded, hasMappingChildren, compareMode, cmpUploadedData, cmpJournalEntries, groupToCf, node.code]);

  const totalCols = 1 + visibleCompanies.length * (compareMode ? 4 : 1);
  const isExpandable = hasMappingChildren || true; // leaves can drill too

  return (
    <>
<tr className="group border-b border-gray-100 transition-colors hover:bg-[#eef1fb] cursor-pointer"
        onClick={() => setExpanded(e => !e)}
        style={{ background: isMatchSelf ? "#fef3c7" : undefined, animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both` }}>
        <td className="sticky left-0 z-10 py-2.5 pr-6 border-r border-gray-100 group-hover:bg-[#eef1fb]"
          style={{ paddingLeft: `${24 + depth * 16}px`, minWidth: 260, width: 260, background: isMatchSelf ? "#fef3c7" : "#fff" }}>
          <div className="flex items-center gap-2 select-none">
            {isExpandable ? (
              <ChevronDown size={10} className="flex-shrink-0 transition-transform duration-200"
                style={{ color: `${colors.primary}60`, transform: effectiveExpanded ? "rotate(0deg)" : "rotate(-90deg)" }} />
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
        {!compareMode && (() => {
          const total = visibleCompanies.reduce((s, c) => s + getContrib(c), 0);
          return (
            <AnimatedAmountCell value={total}
              style={{ ...body1Style, fontWeight: hasMappingChildren ? 800 : 800, background: "#fafafa", position: "sticky", right: 0, zIndex: 10, borderLeft: "1px solid #f3f4f6", minWidth: 150 }} />
          );
        })()}
      </tr>

{/* Sum node expanded → render mapping children */}
{effectiveExpanded && hasMappingChildren && node.children.map((child, ci) => (
        <MappedSheetRow key={child.id ?? `${child.code}-${ci}`}
          node={child} depth={depth + 1}
          pivot={pivot} visibleCompanies={visibleCompanies}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
          compareMode={compareMode} cmpPivot={cmpPivot} colors={colors} rowIndex={rowIndex + ci + 1}
          uploadedData={uploadedData} journalEntries={journalEntries} groupToCf={groupToCf} nameFor={nameFor} T={T}
          cmpUploadedData={cmpUploadedData} cmpJournalEntries={cmpJournalEntries}
          expandAllVersion={expandAllVersion} expandAllState={expandAllState}
          searchQuery={searchQuery} />
      ))}

{/* Leaf node expanded → drill into ERP / journal entries */}
      {effectiveExpanded && !hasMappingChildren && drillGroups.length === 0 && (
        <tr>
<td colSpan={totalCols} className="px-8 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300">
            {T ? T("cf_no_underlying") : "No underlying accounts"}
          </td>
        </tr>
      )}
{effectiveExpanded && !hasMappingChildren && drillGroups.map((g, gi) => (
        <DrillGroupRow key={g.groupCode} groupIndex={gi}
          groupCode={g.groupCode} groupName={g.groupName} localRows={g.localRows}
          visibleCompanies={visibleCompanies} colors={colors}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} compareMode={compareMode}
          cmpDrillMap={cmpDrillMap} searchQuery={searchQuery} />
      ))}
    </>
  );
}

/* ─── SheetRow (individual flat) ─────────────────────────────────────── */
function SheetRow({
  node, depth, pivot, visibleCompanies,
  body1Style, body2Style, subbody1Style,
  isSubtotal, compareMode = false, cmpPivot = new Map(), colors, rowIndex = 0,
  uploadedData = [], journalEntries = [], groupToCf, T,
  cmpUploadedData = [], cmpJournalEntries = [],
  expandAllVersion = 0, expandAllState = false,
  searchQuery = "",
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (isSubtotal) return;
    setExpanded(expandAllState);
  }, [expandAllVersion, expandAllState, isSubtotal]);

  // When searching, force-open this row so user sees matches inside drill
  const searchActive = !!searchQuery.trim();
  const effectiveExpanded = expanded || (searchActive && !isSubtotal);

  // Self match highlight
  const q = searchQuery.trim().toLowerCase();
  const isMatchSelf = q && (
    String(node.AccountCode).toLowerCase().includes(q) ||
    String(node.AccountName || "").toLowerCase().includes(q)
  );
  const byCompany = pivot.get(node.AccountCode) || {};
  const getContrib = (company) =>
    (byCompany[company] ?? []).reduce((s, r) => s + (Number(r._cfAmount ?? 0)), 0);

  // Level 1: group codes that map to this CF code, with their local rows
const drillGroups = useMemo(() => {
    if (!effectiveExpanded) return [];
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

let result = [...byGroup.values()]
      .map(g => ({
        ...g,
        localRows: [...g.rowMap.values()].sort((a, b) => {
          if (a.isJournal !== b.isJournal) return a.isJournal ? 1 : -1;
          return (a.localCode || a.localName).localeCompare(b.localCode || b.localName);
        }),
      }))
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode));

    // If searching, filter to groups that have any matching content
    if (searchActive) {
      result = result
        .map(g => {
          const gcMatch = g.groupCode.toLowerCase().includes(q) || (g.groupName || "").toLowerCase().includes(q);
          const filteredLocals = g.localRows.filter(lr =>
            gcMatch
            || (lr.localCode || "").toLowerCase().includes(q)
            || (lr.localName || "").toLowerCase().includes(q)
          );
          return { ...g, localRows: filteredLocals, _groupSelfMatch: gcMatch };
        })
        .filter(g => g._groupSelfMatch || g.localRows.length > 0);
    }

    return result;
  }, [effectiveExpanded, uploadedData, journalEntries, groupToCf, node.AccountCode, searchActive, q]);

  // Map of comparison-period amounts keyed exactly like drill rows
  // group:    `GRP::${groupCode}::${co}`
  // ERP leaf: `ERP::${groupCode}::${localCode}::${co}`
  // Journal:  `JRN::${groupCode}::${journalNumber}::${co}`
const cmpDrillMap = useMemo(() => {
    if (!effectiveExpanded || !compareMode) return new Map();
    const m = new Map();
    const add = (k, v) => m.set(k, (m.get(k) ?? 0) + v);
    cmpUploadedData.forEach(r => {
      const gc = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      const cfs = groupToCf?.get(gc) ?? [];
      if (!cfs.includes(node.AccountCode)) return;
      const origin = r.Origin ?? r.origin ?? "";
      const lc = r.LocalAccountCode ?? r.localAccountCode ?? "";
      if (origin === "Journal" || !lc) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      add(`GRP::${gc}::${co}`, amt);
      add(`ERP::${gc}::${lc}::${co}`, amt);
    });
    cmpJournalEntries.forEach(j => {
      const gc = String(j.AccountCode ?? j.accountCode ?? "");
      const co = j.CompanyShortName ?? j.companyShortName ?? "";
      const cfs = groupToCf?.get(gc) ?? [];
      if (!cfs.includes(node.AccountCode)) return;
      const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
      const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
      add(`GRP::${gc}::${co}`, amt);
      add(`JRN::${gc}::${jn}::${co}`, amt);
    });
    return m;
}, [effectiveExpanded, compareMode, cmpUploadedData, cmpJournalEntries, groupToCf, node.AccountCode]);

  const totalCols = 1 + visibleCompanies.length * (compareMode ? 4 : 1);

  return (
    <>
<tr className={`group border-b border-gray-100 transition-colors hover:bg-[#eef1fb] ${isSubtotal ? "" : "cursor-pointer"}`}
        onClick={isSubtotal ? undefined : () => setExpanded(e => !e)}
        style={{ background: isMatchSelf ? "#fef3c7" : undefined, animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both` }}>
        <td className="sticky left-0 z-10 py-2.5 pr-6 border-r border-gray-100 group-hover:bg-[#eef1fb]"
          style={{ paddingLeft: `${24 + depth * 16}px`, minWidth: 260, width: 260, background: isMatchSelf ? "#fef3c7" : "#fff" }}>
          <div className="flex items-center gap-2 select-none">
            {isSubtotal ? (
              <span className="flex-shrink-0" style={{ width: 10 }} />
            ) : (
              <ChevronDown size={10} className="flex-shrink-0 transition-transform duration-200"
                style={{ color: `${colors.primary}60`, transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }} />
            )}
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
        {!compareMode && (() => {
          const total = visibleCompanies.reduce((s, c) => s + getContrib(c), 0);
          return (
            <AnimatedAmountCell value={total}
              style={{ ...body1Style, fontWeight: 800, background: "#fafafa", position: "sticky", right: 0, zIndex: 10, borderLeft: "1px solid #f3f4f6", minWidth: 150 }} />
          );
        })()}
      </tr>
{effectiveExpanded && drillGroups.length === 0 && (
        <tr>
          <td colSpan={totalCols} className="px-8 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300">
            {T ? T("cf_no_underlying") : "No underlying accounts"}
          </td>
        </tr>
      )}
{effectiveExpanded && drillGroups.map((g, gi) => (
        <DrillGroupRow key={g.groupCode} groupIndex={gi}
          groupCode={g.groupCode} groupName={g.groupName} localRows={g.localRows}
          visibleCompanies={visibleCompanies} colors={colors}
          body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style} compareMode={compareMode}
          cmpDrillMap={cmpDrillMap} searchQuery={searchQuery} />
      ))}
    </>
  );
}
 
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
  const [cfNameDict,     setCfNameDict]     = useState({});

const [pgcCfMapping,           setPgcCfMapping]           = useState(null);
  const [danishIfrsCfMapping,    setDanishIfrsCfMapping]    = useState(null);
  const [spanishIfrsEsCfMapping, setSpanishIfrsEsCfMapping] = useState(null);
  const [customCfMapping,        setCustomCfMapping]        = useState(null);

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
      fetch(`${BASE}/dimensions`,               { headers: h }).then(r => r.json()).then(d => d.value || d || []).catch(() => []),
    ]).then(([p, s, st, co, gs, cf, dims]) => {
      if (cancelled) return;
      setPeriods(p); setSources(s); setStructures(st); setCompanies(co);
      setGroupStructure(Array.isArray(gs) ? gs : []);
      setCfMapping(Array.isArray(cf) ? cf : []);
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
    let sbToken = SB_APIKEY;
    try {
      const key = Object.keys(localStorage).find(k => k.includes("auth-token"));
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
      const key = Object.keys(localStorage).find(k => k.includes("auth-token"));
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

// Expand/collapse-all: bump version to re-sync every row to expandAllState
  const [expandAllVersion, setExpandAllVersion] = useState(0);
  const [expandAllState, setExpandAllState] = useState(false);
  const toggleExpandAll = () => {
    setExpandAllState(s => !s);
    setExpandAllVersion(v => v + 1);
  };

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

const [, setExporting] = useState(false);

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
      } catch { /* ignore */ }
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

useEffect(() => { if (viewsMode === "structure") fetchSavedMappings(); }, [viewsMode]);
  useEffect(() => { if (viewsMode === "report") fetchReportMappings(); }, [viewsMode]);
const [compareMode, setCompareMode] = useState(false);
  const [cmpVisible, setCmpVisible] = useState(false);
  const [cmpExiting, setCmpExiting] = useState(false);
  const [cmpYear,  setCmpYear]  = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
  const [cmpSource, setCmpSource] = useState("");
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
    ]).then(([rows, journals]) => {
        if (cancelled) return;
        setCmpUploadedData(Array.isArray(rows) ? rows : []);
        setCmpJournalEntries(Array.isArray(journals) ? journals : []);
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

const handleExportXlsx = async () => {
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
    const sheetCompare = cmpVisible;
    const showTotals = !sheetCompare;
    const subColsPerCo = sheetCompare ? 4 : 1;
    const totalCols = 1 + visCo.length * subColsPerCo + (showTotals ? 1 : 0);

// Sub-header lines (filters preview)
    const subLines = [];
    if (year && month) {
      const seg = [`📅 ${periodLabel(year, month)}`];
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
        c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
      });
      curRow++;
    }

    // Cell writer
    const writeNum = (rowN, colN, val, fillArgb, opts = {}) => {
      const cell = ws.getCell(rowN, colN);
      if (val == null || !Number.isFinite(val) || Math.round(val) === 0) {
        cell.value = "—";
        cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: !!opts.bold };
      } else {
        cell.value = Math.round(val);
        cell.numFmt = opts.percent ? '0.0"%"' : '#,##0;[Red]-#,##0';
        cell.font = {
          name: "Calibri", size: 10, bold: !!opts.bold,
          color: { argb: opts.colorOverride ?? (val < 0 ? C.red : "FF000000") },
        };
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

    // Build cmp drill map for a CF code: GRP::{gc}::{co}, ERP::{gc}::{lc}::{co}, JRN::{gc}::{jn}::{co}
    const buildCmpDrillMap = (cfCode) => {
      const m = new Map();
      const add = (k, v) => m.set(k, (m.get(k) ?? 0) + v);
      cmpUploadedData.forEach(r => {
        const gc = String(r.AccountCode ?? r.accountCode ?? "");
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const origin = r.Origin ?? r.origin ?? "";
        const lc = r.LocalAccountCode ?? r.localAccountCode ?? "";
        if (origin === "Journal" || !lc) return;
        const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
        add(`GRP::${gc}::${co}`, amt);
        add(`ERP::${gc}::${lc}::${co}`, amt);
      });
      cmpJournalEntries.forEach(j => {
        const gc = String(j.AccountCode ?? j.accountCode ?? "");
        const co = j.CompanyShortName ?? j.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
        const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
        add(`GRP::${gc}::${co}`, amt);
        add(`JRN::${gc}::${jn}::${co}`, amt);
      });
      return m;
    };

    // Build drill groups for a given CF code (same logic as SheetRow)
    const buildDrillGroups = (cfCode) => {
      const byGroup = new Map();
      const ensure = (gc, gn) => {
        if (!byGroup.has(gc)) byGroup.set(gc, { groupCode: gc, groupName: gn ?? "", rowMap: new Map() });
        return byGroup.get(gc);
      };
      filteredUploadedData.forEach(r => {
        const gc = String(r.AccountCode ?? r.accountCode ?? "");
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const origin = r.Origin ?? r.origin ?? "";
        const lc = r.LocalAccountCode ?? r.localAccountCode ?? "";
        if (origin === "Journal" || !lc) return;
        const b = ensure(gc, r.AccountName ?? r.accountName);
        const key = `ERP::${lc}::${co}`;
        const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
        if (!b.rowMap.has(key)) b.rowMap.set(key, { localCode: lc, localName: r.LocalAccountName ?? r.localAccountName ?? "", isJournal: false, co, amt: 0 });
        b.rowMap.get(key).amt += amt;
      });
      journalEntries.forEach(j => {
        const gc = String(j.AccountCode ?? j.accountCode ?? "");
        const co = j.CompanyShortName ?? j.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
        const jh = j.JournalHeader ?? j.journalHeader ?? "";
        const jt = j.JournalType ?? j.journalType ?? "";
        const b = ensure(gc, j.AccountName ?? j.accountName);
        const key = `JRN::${jn}::${co}`;
        const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
        if (!b.rowMap.has(key)) b.rowMap.set(key, { localCode: jn || "JRN", localName: jh || jt || "Journal", isJournal: true, co, amt: 0 });
        b.rowMap.get(key).amt += amt;
      });
      return [...byGroup.values()].map(g => ({
        ...g,
        localRows: [...g.rowMap.values()].sort((a, b) => a.isJournal !== b.isJournal ? (a.isJournal ? 1 : -1) : (a.localCode || "").localeCompare(b.localCode || "")),
      })).sort((a, b) => a.groupCode.localeCompare(b.groupCode));
    };

    let dataIdx = 0;
    let maxDepth = 0;

const writeAccountRow = ({ code, name, depth, isBold }) => {
      maxDepth = Math.max(maxDepth, depth);
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
        const a = getValAt(code, co);
        rowTotal += a;
        if (sheetCompare) {
          const b = getCmpValAt(code, co);
          const delta = a - b;
          const deltaPct = Math.abs(b) > 1e-9 ? ((a - b) / Math.abs(b)) * 100 : null;
          const startCol = 2 + i * 4;
          writeNum(curRow, startCol,     a,        band,        { bold: isBold });
          writeNum(curRow, startCol + 1, b,        "FFFAFBFF",  { bold: isBold });
          writeNum(curRow, startCol + 2, delta,    "FFF5F7FF", {
            bold: isBold,
            colorOverride: (delta == null || Math.round(delta) === 0) ? null : (delta < 0 ? C.red : C.green),
          });
          writeNum(curRow, startCol + 3, deltaPct, "FFF0F3FF", {
            bold: isBold, percent: true,
            colorOverride: deltaPct == null ? null : (deltaPct < 0 ? C.red : C.green),
          });
        } else {
          writeNum(curRow, 2 + i, a, band, { bold: isBold });
        }
      });
      if (showTotals) writeNum(curRow, 2 + visCo.length, rowTotal, C.highlight, { bold: true });

      const row = ws.getRow(curRow);
      const cappedDepth = Math.min(7, depth);
      row.outlineLevel = cappedDepth;
      if (cappedDepth > 0) row.hidden = true;
      curRow++;
      return rowTotal;
    };

const writeDrillGroupRow = ({ groupCode, groupName, depth, localRows, cmpMap }) => {
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
          writeNum(curRow, startCol,     v,     "FFF4F6FB", { bold: true });
          writeNum(curRow, startCol + 1, cmpV,  "FFFAFBFF", { bold: true });
          writeNum(curRow, startCol + 2, delta, "FFF5F7FF", { bold: true, colorOverride: delta === 0 ? null : (delta < 0 ? C.red : C.green) });
          writeNum(curRow, startCol + 3, pct,   "FFF0F3FF", { bold: true, percent: true, colorOverride: pct === null ? null : (pct < 0 ? C.red : C.green) });
        } else {
          writeNum(curRow, 2 + i, v, "FFF4F6FB", { bold: true });
        }
      });
      if (showTotals) writeNum(curRow, 2 + visCo.length, rowTotal, C.highlight, { bold: true });

      const row = ws.getRow(curRow);
      row.outlineLevel = Math.min(7, depth);
      row.hidden = true;
      curRow++;
    };

const writeLocalRow = ({ localCode, localName, isJournal, co, amt, depth, groupCode, cmpMap }) => {
      maxDepth = Math.max(maxDepth, depth);
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
          writeNum(curRow, startCol,     v,     "FFF9FAFD");
          writeNum(curRow, startCol + 1, cmpV,  "FFFAFBFF");
          writeNum(curRow, startCol + 2, delta, "FFF5F7FF", { colorOverride: delta === 0 ? null : (delta < 0 ? C.red : C.green) });
          writeNum(curRow, startCol + 3, pct,   "FFF0F3FF", { percent: true, colorOverride: pct === null ? null : (pct < 0 ? C.red : C.green) });
        } else {
          writeNum(curRow, 2 + i, v, "FFF9FAFD");
        }
      });
      if (showTotals) writeNum(curRow, 2 + visCo.length, amt, C.highlight);

      const row = ws.getRow(curRow);
      row.outlineLevel = Math.min(7, depth);
      row.hidden = true;
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

const writeLeafWithDrill = (code, name, depth, isBold) => {
      writeAccountRow({ code, name, depth, isBold });
      const groups = buildDrillGroups(code);
      const cmpMap = sheetCompare ? buildCmpDrillMap(code) : null;
      groups.forEach(g => {
        writeDrillGroupRow({ groupCode: g.groupCode, groupName: g.groupName, depth: depth + 1, localRows: g.localRows, cmpMap });
        g.localRows.forEach(lr => {
          writeLocalRow({
            localCode: lr.localCode, localName: lr.localName,
            isJournal: lr.isJournal, co: lr.co, amt: lr.amt, depth: depth + 2,
            groupCode: g.groupCode, cmpMap,
          });
        });
      });
    };

    // ── RENDER: custom mapping literal OR default standard ─────────────
    if (activeMapping?.cfLiteral) {
      const renderNode = (node, depth) => {
        const hasChildren = node.children && node.children.length > 0;
        if (hasChildren) {
          writeAccountRow({ code: node.code, name: node.name || nameFor(node.code), depth, isBold: true });
          node.children.forEach(c => renderNode(c, depth + 1));
        } else {
          writeLeafWithDrill(node.code, node.name || nameFor(node.code), depth, false);
        }
      };
      activeMapping.cfLiteral.forEach(section => {
        if (section.label) writeSectionBar(section.label, toArgbHex(section.color));
        section.nodes.forEach(n => renderNode(n, 0));
      });
    } else {
      sectionOrder.forEach(sec => {
        const codes = bySection.get(sec);
        if (!codes?.length) return;
        const secInfo = activeCfMapping?.sections?.get(sec);
        writeSectionBar(secInfo?.label || sec, toArgbHex(secInfo?.color || "#1a2f8a"));
        codes.forEach(code => {
          const isSubtotal = subtotalCodes.has(code);
          if (isSubtotal) {
            writeAccountRow({ code, name: nameFor(code), depth: 0, isBold: true });
          } else {
            writeLeafWithDrill(code, nameFor(code), 0, false);
          }
        });
      });
    }

    // Column widths
    ws.getColumn(1).width = 44;
    if (sheetCompare) {
      for (let i = 0; i < visCo.length; i++) {
        ws.getColumn(2 + i * 4).width = 15;
        ws.getColumn(2 + i * 4 + 1).width = 14;
        ws.getColumn(2 + i * 4 + 2).width = 12;
        ws.getColumn(2 + i * 4 + 3).width = 10;
      }
    } else {
      for (let i = 0; i < visCo.length; i++) ws.getColumn(2 + i).width = 18;
      if (showTotals) ws.getColumn(2 + visCo.length).width = 18;
    }

    ws.properties.outlineLevelRow = Math.min(7, Math.max(1, maxDepth));
    ws.properties.summaryBelow = false;

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

const handleExportPdf = () => {
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
    const includeCompare = cmpVisible;
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

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    // pageNum tracks the physical jsPDF page (page 1 reserved for TOC).
    let pageNum = 1;

    // Manifest: one entry PER PHYSICAL PAGE. Filled by autoTable hooks.
    // { displayedPage, chunkIdx, chunkCompanies: [], firstAccount, lastAccount }
    const pageManifest = [];

    // ─── Drill builder (same as XLSX) ────────────────────────────────
    const buildDrillForCode = (cfCode) => {
      const byGroup = new Map();
      const ensure = (gc, gn) => {
        if (!byGroup.has(gc)) byGroup.set(gc, { groupCode: gc, groupName: gn ?? "", rowMap: new Map() });
        return byGroup.get(gc);
      };
      filteredUploadedData.forEach(r => {
        const gc = String(r.AccountCode ?? r.accountCode ?? "");
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const origin = r.Origin ?? r.origin ?? "";
        const lc = r.LocalAccountCode ?? r.localAccountCode ?? "";
        if (origin === "Journal" || !lc) return;
        const b = ensure(gc, r.AccountName ?? r.accountName);
        const key = `ERP::${lc}::${co}`;
        const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
        if (!b.rowMap.has(key)) b.rowMap.set(key, { localCode: lc, localName: r.LocalAccountName ?? r.localAccountName ?? "", isJournal: false, co, amt: 0 });
        b.rowMap.get(key).amt += amt;
      });
      journalEntries.forEach(j => {
        const gc = String(j.AccountCode ?? j.accountCode ?? "");
        const co = j.CompanyShortName ?? j.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
        const jh = j.JournalHeader ?? j.journalHeader ?? "";
        const jt = j.JournalType ?? j.journalType ?? "";
        const b = ensure(gc, j.AccountName ?? j.accountName);
        const key = `JRN::${jn}::${co}`;
        const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
        if (!b.rowMap.has(key)) b.rowMap.set(key, { localCode: jn || "JRN", localName: jh || jt || "Journal", isJournal: true, co, amt: 0 });
        b.rowMap.get(key).amt += amt;
      });
      return [...byGroup.values()].map(g => ({
        ...g,
        localRows: [...g.rowMap.values()].sort((a, b) => a.isJournal !== b.isJournal ? (a.isJournal ? 1 : -1) : (a.localCode || "").localeCompare(b.localCode || "")),
      })).sort((a, b) => a.groupCode.localeCompare(b.groupCode));
    };

    const getValAt = (code, co) => {
      const rows = pivot.get(code)?.[co] ?? [];
      return rows.reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
    };
const getCmpValAt = (code, co) => {
      const rows = cmpPivot.get(code)?.[co] ?? [];
      return rows.reduce((s, r) => s + Number(r._cfAmount ?? 0), 0);
    };

    const buildCmpDrillForCode = (cfCode) => {
      const m = new Map();
      const add = (k, v) => m.set(k, (m.get(k) ?? 0) + v);
      cmpUploadedData.forEach(r => {
        const gc = String(r.AccountCode ?? r.accountCode ?? "");
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const origin = r.Origin ?? r.origin ?? "";
        const lc = r.LocalAccountCode ?? r.localAccountCode ?? "";
        if (origin === "Journal" || !lc) return;
        const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
        add(`GRP::${gc}::${co}`, amt);
        add(`ERP::${gc}::${lc}::${co}`, amt);
      });
      cmpJournalEntries.forEach(j => {
        const gc = String(j.AccountCode ?? j.accountCode ?? "");
        const co = j.CompanyShortName ?? j.companyShortName ?? "";
        const cfs = groupToCf?.get(gc) ?? [];
        if (!cfs.includes(cfCode)) return;
        const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
        const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
        add(`GRP::${gc}::${co}`, amt);
        add(`JRN::${gc}::${jn}::${co}`, amt);
      });
      return m;
    };

    const fmt = v => {
      const r = Math.round(v);
      if (r === 0 || !Number.isFinite(r)) return "—";
      const abs = Math.abs(r).toLocaleString("de-DE");
      return r < 0 ? `(${abs})` : abs;
    };
    const fmtPct = v => {
      if (v == null || !Number.isFinite(v)) return "—";
      return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
    };

    // Build rows for a chunk, but ALSO tag each row with the parent CF account
    // code it belongs to — autoTable's didDrawCell hook reads this tag to know
    // which CF accounts ended up on which physical page.
    const buildRowsForChunk = (chunkCompanies) => {
      const rows = [];
      const rowTags = []; // parallel array: rowTags[i] = { cfCode, cfName } for rows[i]
      let currentCfCode = null;
      let currentCfName = null;

      const pushAccountRow = ({ code, name, depth, isBold }) => {
        currentCfCode = code;
        currentCfName = name;
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
            const dColor = (delta == null || Math.round(delta) === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(a), styles: { fontStyle: isBold ? "bold" : "normal", textColor: a < 0 ? RED : TEXTDK } });
            cells.push({ content: fmt(b), styles: { fontStyle: isBold ? "bold" : "normal", textColor: REDDK } });
            cells.push({ content: fmt(delta), styles: { fontStyle: isBold ? "bold" : "normal", textColor: dColor } });
            cells.push({ content: fmtPct(pct), styles: { fontStyle: isBold ? "bold" : "normal", textColor: dColor } });
          } else {
            cells.push({ content: fmt(a), styles: { fontStyle: isBold ? "bold" : "normal", textColor: a < 0 ? RED : TEXTDK } });
          }
        });
        if (!includeCompare) {
          const total = chunkCompanies.reduce((s, co) => s + getValAt(code, co), 0);
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
            const dColor = (delta === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(v),    styles: { fontStyle: "bold", fillColor: SUBBG, textColor: v < 0 ? RED : NAVY } });
            cells.push({ content: fmt(cmpV), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: cmpV < 0 ? RED : REDDK } });
            cells.push({ content: fmt(delta), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: dColor } });
            cells.push({ content: fmtPct(pct), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: dColor } });
          } else {
            cells.push({ content: fmt(v), styles: { fontStyle: "bold", fillColor: SUBBG, textColor: v < 0 ? RED : NAVY } });
          }
        });
        if (!includeCompare) {
          const total = chunkCompanies.reduce((s, co) => s + (amtByCo[co] ?? 0), 0);
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
            const dColor = (delta === 0) ? GRAY : (delta > 0 ? GRN : RED);
            cells.push({ content: fmt(v),    styles: { fillColor: LOCALBG, textColor: v < 0 ? RED : TEXTDK } });
            cells.push({ content: fmt(cmpV), styles: { fillColor: LOCALBG, textColor: cmpV < 0 ? RED : REDDK } });
            cells.push({ content: fmt(delta), styles: { fillColor: LOCALBG, textColor: dColor } });
            cells.push({ content: fmtPct(pct), styles: { fillColor: LOCALBG, textColor: dColor } });
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

const pushLeafWithDrill = (code, name, depth, isBold) => {
        pushAccountRow({ code, name, depth, isBold });
        const groups = buildDrillForCode(code);
        const cmpMap = includeCompare ? buildCmpDrillForCode(code) : null;
        groups.forEach(g => {
          pushGroupRow({ groupCode: g.groupCode, groupName: g.groupName, depth: depth + 1, localRows: g.localRows, cmpMap });
          g.localRows.forEach(lr => {
            pushLocalRow({
              localCode: lr.localCode, localName: lr.localName,
              isJournal: lr.isJournal, co: lr.co, amt: lr.amt, depth: depth + 2,
              groupCode: g.groupCode, cmpMap,
            });
          });
        });
      };

      if (activeMapping?.cfLiteral) {
        const renderNode = (node, depth) => {
          const hasChildren = node.children && node.children.length > 0;
          if (hasChildren) {
            pushAccountRow({ code: node.code, name: node.name || nameFor(node.code), depth, isBold: true });
            node.children.forEach(c => renderNode(c, depth + 1));
          } else {
            pushLeafWithDrill(node.code, node.name || nameFor(node.code), depth, false);
          }
        };
        activeMapping.cfLiteral.forEach(section => {
          if (section.label) pushBreaker(section.label, section.color);
          section.nodes.forEach(n => renderNode(n, 0));
        });
      } else {
        sectionOrder.forEach(sec => {
          const codes = bySection.get(sec);
          if (!codes?.length) return;
          const secInfo = activeCfMapping?.sections?.get(sec);
          pushBreaker(secInfo?.label || sec, secInfo?.color);
          codes.forEach(code => {
            const isSubtotal = subtotalCodes.has(code);
            if (isSubtotal) {
              pushAccountRow({ code, name: nameFor(code), depth: 0, isBold: true });
            } else {
              pushLeafWithDrill(code, nameFor(code), 0, false);
            }
          });
        });
      }
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
      const sub = [`${monthLabel} ${year}`, source, structure].filter(Boolean).join("  ·  ");
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
      doc.text(`${monthLabel} ${year}  ·  ${source}${setPart}`, 36, H - 4.5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...NAVY);
      doc.text(`${pageNum}`, W - 10, H - 4.5, { align: "right" });
    };

    // ─── Render one chunk (set of companies) — autoTable handles pagination ──
    const renderChunk = (chunkInfo) => {
      const { companies: chunkCompanies } = chunkInfo;
      const subColsPerCo = includeCompare ? 4 : 1;
      const totalColCount = 1 + chunkCompanies.length * subColsPerCo + (includeCompare ? 0 : 1);

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
        head = [[T("col_account"), ...chunkCompanies.map(co => getLegal(co)), T("col_total")]];
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
        const tocSub = [`${monthLabel} ${year}`, source, structure].filter(Boolean).join("  ·  ");
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
      doc.text(`${T("file_index")} ${tocPageIdx + 1}/${tocPagesNeeded}  ·  ${monthLabel} ${year}  ·  ${source}`, 50, H - 4.5);
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
        @keyframes iconMorph { 0% { opacity:0; transform: rotate(-90deg) scale(0.4); } 100% { opacity:1; transform: rotate(0deg) scale(1); } }
      `}</style>

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
            ? [{ label: T("filter_year"), value: year, onChange: setYear, options: availableYears }]
            : []),
          ...(availableMonths.length > 0
            ? [{ label: T("filter_month"), value: month, onChange: setMonth, options: availableMonths.map(o => ({ value: o.value, label: T(`month_${o.value}`) })) }]
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
          } catch { /* ignore */ }
        }}
      />

{activeMapping && !viewsMode && (
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
            onClick={() => setActiveMapping(null)}
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
      <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm"
        style={{ transformOrigin: "top center", animation: cmpExiting ? undefined : "cmpBarIn 400ms cubic-bezier(0.34,1.56,0.64,1) both" }}>
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("btn_compare_with")}</span>
          </div>
          <HeaderFilterPill label={T("filter_source")} value={cmpSource} onChange={setCmpSource}
            options={sources.map(s => ({ value: s.Source ?? s, label: s.Source ?? s }))} />
          <HeaderFilterPill label={T("filter_year")} value={cmpYear} onChange={setCmpYear}
            options={availableYears} />
          <HeaderFilterPill label={T("filter_month")} value={cmpMonth} onChange={setCmpMonth}
            options={availableMonths.map(o => ({ value: o.value, label: T(`month_${o.value}`) }))} />
          <HeaderFilterPill label={T("filter_structure")} value={structure} onChange={() => {}}
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
                              const { getMapping } = await import("../../lib/cashflowMappingsApi");
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
                          onClick={async () => {
                            try {
                              const { getMapping } = await import("../../lib/cashflowReportMappingsApi");
                              const full = await getMapping(m.mapping_id);
handleApplyMapping(full ?? m, "report");
                              setViewsMode(null);
                            } catch { /* ignore */ }
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
{(loading && uploadedData.length === 0) || !metaReady ? (
            <CfLoadingSpinner colors={colors} metaReady={metaReady} T={T} />
) : !hasData ? (
            <div className="flex items-center justify-center flex-1 text-xs text-gray-300 font-black uppercase tracking-widest">
              {T("no_data")}
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
<div className="flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <button
                              onClick={() => setSearchActive(a => !a)}
                              title={T("dim_search_tooltip") || "Search"}
                              className="flex-shrink-0 p-1 transition-colors duration-[240ms]"
                              style={{ color: searchActive ? colors.primary : "#94a3b8" }}
                              onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                              onMouseLeave={e => { if (!searchActive) e.currentTarget.style.color = "#94a3b8"; }}
                            >
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="7" cy="7" r="5" />
                                <path d="M11 11 L14 14" />
                              </svg>
                            </button>
                            {searchActive ? (
                              <>
                                <input
                                  ref={searchInputRef}
                                  type="text"
                                  value={searchQuery}
                                  onChange={e => setSearchQuery(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Escape") { setSearchActive(false); setSearchQuery(""); } }}
                                  placeholder={T("search_code_or_name") || "Search code or name"}
                                  className="bg-transparent border-0 outline-none flex-1 min-w-0"
                                  style={{ color: colors.primary, fontWeight: 700, fontSize: 16, width: 240 }}
                                />
                                <button
                                  onClick={() => { setSearchActive(false); setSearchQuery(""); }}
                                  className="flex-shrink-0 p-1 transition-colors"
                                  style={{ color: "#94a3b8" }}
                                  onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
                                  title={T("close_search") || "Close"}
                                >
                                  <X size={12} strokeWidth={2.2} />
                                </button>
                              </>
                            ) : (
                              <button onClick={() => setSearchActive(true)} className="flex items-baseline gap-2.5 cursor-text">
                                <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{T("col_account")}</span>
                                <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>{T("nav_cashflow")}</span>
                              </button>
                            )}
                          </div>
                          <button
                            onClick={toggleExpandAll}
                            title={expandAllState ? T("pl_collapse_all") : T("pl_expand_all")}
                            className="flex-shrink-0 p-1 transition-colors duration-[240ms]"
                            style={{ color: "#94a3b8" }}
                            onMouseEnter={e => { e.currentTarget.style.color = colors.primary; }}
                            onMouseLeave={e => { e.currentTarget.style.color = "#94a3b8"; }}
                          >
                            <span key={expandAllState ? "collapse" : "expand"} style={{ display: "inline-flex", animation: "iconMorph 360ms cubic-bezier(0.34,1.56,0.64,1) both" }}>
{expandAllState ? (
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 3 L13 13" />
                                  <path d="M13 3 L3 13" />
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 6 L8 2 L14 6" />
                                  <path d="M2 10 L8 14 L14 10" />
                                </svg>
                              )}
                            </span>
                          </button>
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
                      {!compareMode && (
                        <th className="sticky right-0 z-30 text-center px-4" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderLeft: "1px solid #f0f0f0" }}>
                          <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}>Total</span>
                        </th>
                      )}
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
                                <td colSpan={totalCols - 1 + (!compareMode ? 1 : 0)}
                                  style={{ backgroundColor: section.color || colors.primary }} />
                              </tr>
                            )}
{section.nodes.filter(n => !matchedCfCodes || matchedCfCodes.extended.has(String(n.code))).map((n, idx) => (
<MappedSheetRow key={n.id ?? `${n.code}-${idx}`}
                                node={n} depth={0}
                                pivot={pivot} visibleCompanies={orderedVisibleCompanies}
                                body1Style={body1Style} body2Style={body2Style} subbody1Style={subbody1Style}
                                compareMode={compareMode} cmpPivot={cmpPivot} colors={colors} rowIndex={idx}
                                uploadedData={filteredUploadedData} journalEntries={journalEntries} groupToCf={groupToCf} nameFor={nameFor} T={T}
                                cmpUploadedData={cmpUploadedData} cmpJournalEntries={cmpJournalEntries}
                                expandAllVersion={expandAllVersion} expandAllState={expandAllState}
                                searchQuery={searchQuery} />
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
                              <td colSpan={totalCols - 1 + (!compareMode ? 1 : 0)}
                                style={{ backgroundColor: secInfo?.color || colors.primary }} />
                            </tr>
{codes.filter(code => !matchedCfCodes || matchedCfCodes.direct.has(String(code))).map((code, idx) => {
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
                                  uploadedData={filteredUploadedData} journalEntries={journalEntries} groupToCf={groupToCf} T={T}
                                  cmpUploadedData={cmpUploadedData} cmpJournalEntries={cmpJournalEntries}
                                  expandAllVersion={expandAllVersion} expandAllState={expandAllState}
                                  searchQuery={searchQuery} />
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