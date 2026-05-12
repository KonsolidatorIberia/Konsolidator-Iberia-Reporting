import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, BookOpen, FileText, Sparkles, Settings2, Download, Save, RefreshCw, Library, Scale } from "lucide-react";
import { useTypo, useSettings } from "./SettingsContext.jsx";
import PageHeader from "./PageHeader.jsx";
import MappingsModal from "./Mappings.jsx";

const BASE_URL = "";

// ─── Supabase REST helpers ─────────────────────────────────────────
const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = (schema) => ({
  apikey:           SUPABASE_APIKEY,
  Authorization:   `Bearer ${SUPABASE_APIKEY}`,
  "Accept-Profile": schema,
});
const sbGet = (schema, path) =>
  fetch(`${SUPABASE_URL}/${path}`, { headers: sbHeaders(schema) }).then(r => r.json());

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ─── Constants ────────────────────────────────────────────────────
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" }, { value: 4, label: "April" },
  { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" }, { value: 12, label: "December" },
];
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ─── Format helpers ───────────────────────────────────────────────
const fmt = (n) => {
  if (n == null || n === 0) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (isNaN(num) || num === 0) return "—";
  return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseAmt = (val) => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  return parseFloat(String(val).replace(/,/g, "")) || 0;
};

function codeMatchesPrefix(accountCode, prefixes) {
  const ac = String(accountCode);
  return prefixes.some(p => {
    const pp = String(p);
    return ac === pp || ac.startsWith(pp);
  });
}

// ─── Export icon components ───────────────────────────────────────
function ExcelIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#107C41"/>
      <path d="M19 4v8h8" fill="#0B5E30"/>
      <path d="M14.5 15.5 17 19l-2.5 3.5h1.8L18 20.1l1.7 2.4h1.8L19 19l2.5-3.5h-1.8L18 17.9l-1.7-2.4z" fill="#fff"/>
    </svg>
  );
}
function PdfIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#D93025"/>
      <path d="M19 4v8h8" fill="#A1271B"/>
      <text x="9" y="23" fill="#fff" fontSize="7" fontWeight="700" fontFamily="Arial,sans-serif">PDF</text>
    </svg>
  );
}
function WordIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#2B579A"/>
      <path d="M19 4v8h8" fill="#1E3F7A"/>
      <text x="8" y="23" fill="#fff" fontSize="7" fontWeight="700" fontFamily="Arial,sans-serif">DOC</text>
    </svg>
  );
}

// ─── NoteSidebarItem ───────────────────────────────────────────────
function NoteSidebarItem({ note, active, onClick }) {
  const { colors } = useSettings();
  return (
    <button onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5"
      style={{
        backgroundColor: active ? `${colors.primary}10` : "transparent",
        borderLeft: active ? `3px solid ${colors.primary}` : "3px solid transparent",
      }}>
      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black"
        style={{
          backgroundColor: active ? colors.primary : "#f3f4f6",
          color: active ? "#ffffff" : "#9ca3af",
        }}>
        {note.note_number}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black truncate" style={{ color: active ? colors.primary : "#374151" }}>
          {note.title}
        </p>
        {!note.is_required && (
          <p className="text-[9px] font-bold mt-0.5 text-gray-400">Optional</p>
        )}
      </div>
    </button>
  );
}

// ─── MovementsTable ───────────────────────────────────────────────
function MovementsTable({ note, rows, columns, pivot }) {
  const { colors } = useSettings();
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");

  if (!rows.length || !columns.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
        <FileText size={24} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">No structure defined</p>
        <p className="text-[11px] text-gray-400 mt-1">This note has no table configured yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse" style={{ borderSpacing: 0 }}>
          <thead style={{ backgroundColor: colors.primary }}>
            <tr>
              <th className="text-left px-5 py-3" style={{ minWidth: 280 }}>
                <span style={header2Style}>Concept</span>
              </th>
              {columns.map(col => (
                <th key={col.id} className="text-right px-4 py-3 whitespace-nowrap" style={{ minWidth: 120 }}>
                  <span style={header2Style}>{col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isTotal = row.is_total;
              const rowStyle = isTotal ? { ...body1Style, fontWeight: 900 } : body2Style;
              return (
                <tr key={row.id}
                  className={`border-b border-gray-50 ${isTotal ? "bg-gray-50" : "hover:bg-gray-50/40"} transition-colors`}>
                  <td className="px-5 py-2.5" style={{ paddingLeft: `${20 + (row.level || 0) * 16}px`, ...rowStyle }}>
                    {row.label}
                  </td>
                  {columns.map(col => {
                    const v = pivot.get(`${row.id}|${col.id}`) ?? 0;
                    const color = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : (isTotal ? colors.primary : "#000000");
                    return (
                      <td key={col.id} className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
                        style={{ ...rowStyle, color }}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── buildPivot (consolidated) ────────────────────────────────────
// Same engine as individual but currentRows/prevRows come from
// consolidated-accounts (Group role, no eliminations).
function buildPivot({ note, rows, columns, currentRows, prevRows }) {
  const pivot = new Map();

  rows.forEach(row => {
    if (row.is_total) return;
    const prefixes = row.account_codes ?? [];
    if (prefixes.length === 0) return;

    columns.forEach(col => {
      const key = `${row.id}|${col.id}`;
      let value = 0;

      switch (col.col_type) {
        case "opening": {
          prevRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            if (codeMatchesPrefix(code, prefixes)) {
              value += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            }
          });
          break;
        }
        case "closing": {
          if (col.formula) {
            value = NaN;
          } else {
            currentRows.forEach(r => {
              const code = r.AccountCode ?? r.accountCode ?? "";
              if (codeMatchesPrefix(code, prefixes)) {
                value += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
              }
            });
          }
          break;
        }
        case "addition":
        case "disposal":
        case "transfer":
        case "movement": {
          let curTotal = 0, prevTotal = 0;
          currentRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            if (codeMatchesPrefix(code, prefixes)) curTotal += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          });
          prevRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            if (codeMatchesPrefix(code, prefixes)) prevTotal += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          });
          const delta = curTotal - prevTotal;
          if (col.col_type === "addition")      value = delta > 0 ? delta : 0;
          else if (col.col_type === "disposal") value = delta < 0 ? Math.abs(delta) : 0;
          else value = 0;
          break;
        }
        case "depreciation": {
          const isInmov = prefixes.some(p => /^2/.test(String(p)));
          if (!isInmov) break;
          currentRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            const acStr = String(code);
            const matchesAmort = prefixes.some(p => {
              const pStr = String(p);
              return acStr.startsWith("28" + pStr.slice(1)) || acStr.startsWith("29" + pStr.slice(1));
            });
            if (matchesAmort) value += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          });
          break;
        }
        default: value = 0;
      }

      pivot.set(key, value);
    });
  });

  // Resolve formula columns
  rows.forEach(row => {
    if (row.is_total) return;
    columns.forEach(col => {
      if (!col.formula) return;
      const key = `${row.id}|${col.id}`;
      if (!Number.isNaN(pivot.get(key))) return;
      const colByType = new Map();
      columns.forEach(c => colByType.set(c.col_type, `${row.id}|${c.id}`));
      let result = 0;
      try {
        const env = {
          opening:      pivot.get(colByType.get("opening"))      ?? 0,
          additions:    pivot.get(colByType.get("addition"))      ?? 0,
          disposals:    pivot.get(colByType.get("disposal"))      ?? 0,
          transfers:    pivot.get(colByType.get("transfer"))      ?? 0,
          closing:      pivot.get(colByType.get("closing"))       ?? 0,
          depreciation: pivot.get(colByType.get("depreciation"))  ?? 0,
        };
        let expr = col.formula;
        Object.entries(env).forEach(([k, v]) => {
          expr = expr.replaceAll(k, `(${Number.isFinite(v) ? v : 0})`);
        });
        result = Function(`"use strict"; return (${expr})`)();
        if (!Number.isFinite(result)) result = 0;
      } catch { result = 0; }
      pivot.set(key, result);
    });
  });

  // Totals row
  const totalRow = rows.find(r => r.is_total);
  if (totalRow) {
    columns.forEach(col => {
      const key = `${totalRow.id}|${col.id}`;
      let total = 0;
      rows.forEach(r => {
        if (r.is_total || r.is_subtotal) return;
        total += pivot.get(`${r.id}|${col.id}`) ?? 0;
      });
      pivot.set(key, total);
    });
  }

  return pivot;
}

// ═══════════════════════════════════════════════════════════════════
//   MAIN
// ═══════════════════════════════════════════════════════════════════
export default function ConsolidatedMemoryNotesPage({ token }) {
  const { colors } = useSettings();

  // ── Filters ──────────────────────────────────────────────────────
  const [year,      setYear]      = useState(String(new Date().getFullYear() - 1));
  const [month,     setMonth]     = useState("12");
  const [source,    setSource]    = useState("Actual");
  const [structure, setStructure] = useState("DefaultStructure");
  const [topParent, setTopParent] = useState("");
  const [templateId, setTemplateId] = useState("pgc_normal");
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [viewsModalOpen, setViewsModalOpen] = useState(false);

  // ── Metadata ──────────────────────────────────────────────────────
  const [consolidations, setConsolidations] = useState([]);
  const [groupStructure, setGroupStructure] = useState([]);
  const [companies,      setCompanies]      = useState([]);
  const [sources,        setSources]        = useState([]);
  const [structures,     setStructures]     = useState([]);
  const [metaReady,      setMetaReady]      = useState(false);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    Promise.all([
      fetch(`${BASE_URL}/v2/sources`,         { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/structures`,      { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/companies`,       { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/consolidations`,  { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
      fetch(`${BASE_URL}/v2/group-structure`, { headers: h }).then(r => r.json()).then(d => d.value ?? d ?? []).catch(() => []),
    ]).then(([src, str, co, cons, gs]) => {
      setSources(Array.isArray(src)  ? src  : []);
      setStructures(Array.isArray(str)  ? str  : []);
      setCompanies(Array.isArray(co)   ? co   : []);
      setConsolidations(Array.isArray(cons) ? cons : []);
      setGroupStructure(Array.isArray(gs)   ? gs   : []);
      if (src.length > 0) setSource(src[0].Source ?? src[0].source ?? "Actual");
      if (str.length > 0) {
        const s = str[0];
        setStructure(s.GroupStructure ?? s.groupStructure ?? "DefaultStructure");
      }
      setMetaReady(true);
    });
  }, [token]);

  // ── Holding options (same logic as other consolidated pages) ─────
  const { holdingOptions, rootParent } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.companyShortName ?? g.CompanyShortName ?? "",
      parent:    g.parentShortName  ?? g.ParentShortName  ?? "",
      structure: g.groupStructure   ?? g.GroupStructure   ?? "",
      hasChild:  g.hasChild         ?? g.HasChild         ?? false,
      detached:  g.detached         ?? g.Detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    const root = gsRows.find(g => !g.parent)?.company || "";

    const consolidatedGroups = new Set(
      consolidations
        .filter(c =>
          String(c.Year ?? c.year) === year &&
          String(c.Month ?? c.month) === month &&
          (c.Source ?? c.source) === source &&
          (c.GroupStructure ?? c.groupStructure) === structure
        )
        .map(c => c.GroupShortName ?? c.groupShortName)
        .filter(Boolean)
    );

    const candidates = gsRows
      .filter(g => g.hasChild || g.company === root)
      .map(g => g.company);

    const holdings = consolidatedGroups.size > 0
      ? candidates.filter(c => consolidatedGroups.has(c))
      : candidates;

    const opts = holdings.map(h => {
      const co = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === h);
      const label = co?.CompanyLegalName ?? co?.companyLegalName ?? h;
      return { value: h, label };
    }).sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

    return { holdingOptions: opts, rootParent: root };
  }, [groupStructure, structure, consolidations, year, month, source, companies]);

  // Auto-pick topParent
  useEffect(() => {
    if (holdingOptions.length === 0) return;
    if (holdingOptions.some(h => h.value === topParent)) return;
    const fallback = holdingOptions.find(h => h.value === rootParent)
      ? rootParent
      : holdingOptions[0]?.value ?? "";
    setTopParent(fallback);
  }, [holdingOptions, rootParent, topParent]);

  // ── Template data from Supabase ───────────────────────────────────
  const [templates,        setTemplates]        = useState([]);
  const [notes,            setNotes]            = useState([]);
  const [rows,             setRows]             = useState([]);
  const [cols,             setCols]             = useState([]);
  const [loadingTemplate,  setLoadingTemplate]  = useState(true);

  useEffect(() => {
    sbGet("memory", "templates?select=*&order=sort_order.asc&scope=eq.individual")
      .then(d => { if (Array.isArray(d)) setTemplates(d); });
  }, []);

  useEffect(() => {
    if (!templateId) return;
    setLoadingTemplate(true);
    Promise.all([
      sbGet("memory", `template_notes?select=*&template_id=eq.${templateId}&order=sort_order.asc`),
      sbGet("memory", `template_rows?select=*&note_id=like.${templateId}%3A*&order=sort_order.asc`),
      sbGet("memory", `template_columns?select=*&note_id=like.${templateId}%3A*&order=sort_order.asc`),
    ]).then(([n, r, c]) => {
      setNotes(Array.isArray(n) ? n : []);
      setRows(Array.isArray(r) ? r : []);
      setCols(Array.isArray(c) ? c : []);
      if (Array.isArray(n) && n.length > 0) {
        setActiveNoteId(prev => (prev && n.find(x => x.id === prev)) ? prev : n[0].id);
      }
      setLoadingTemplate(false);
    });
  }, [templateId]);

  // ── Fetch consolidated-accounts (Group role only) ─────────────────
  const [currentRows,  setCurrentRows]  = useState([]);
  const [prevRows,     setPrevRows]     = useState([]);
  const [loadingData,  setLoadingData]  = useState(false);

  const fetchConsolidated = useCallback(async (yr, mo) => {
    if (!yr || !mo || !source || !structure || !topParent) return [];
    const filter = `Year eq ${yr} and Month eq ${mo} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${topParent}'`;
    try {
      const res = await fetch(
        `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const json = await res.json();
      // Only Group role rows (post-elimination consolidated totals)
      return (json.value ?? (Array.isArray(json) ? json : []))
        .filter(r => (r.CompanyRole ?? r.companyRole ?? "") === "Group")
        .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim());
    } catch {
      return [];
    }
  }, [token, source, structure, topParent]);

  useEffect(() => {
    if (!year || !month || !source || !structure || !topParent) return;
    setLoadingData(true);
    const prevYear  = String(parseInt(year) - 1);
    Promise.all([
      fetchConsolidated(year, month),
      fetchConsolidated(prevYear, month),
    ]).then(([cur, prev]) => {
      setCurrentRows(cur);
      setPrevRows(prev);
      setLoadingData(false);
    });
  }, [year, month, source, structure, topParent, fetchConsolidated]);

  // ── Memoized lookups ──────────────────────────────────────────────
  const rowsByNote = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      if (!m.has(r.note_id)) m.set(r.note_id, []);
      m.get(r.note_id).push(r);
    });
    return m;
  }, [rows]);

  const colsByNote = useMemo(() => {
    const m = new Map();
    cols.forEach(c => {
      if (!m.has(c.note_id)) m.set(c.note_id, []);
      m.get(c.note_id).push(c);
    });
    return m;
  }, [cols]);

  const activeNote = useMemo(() => notes.find(n => n.id === activeNoteId), [notes, activeNoteId]);
  const activeRows = activeNote ? (rowsByNote.get(activeNote.id) ?? []) : [];
  const activeCols = activeNote ? (colsByNote.get(activeNote.id) ?? []) : [];

  const pivot = useMemo(() => {
    if (!activeNote?.has_table) return new Map();
    if (!currentRows.length && !prevRows.length) return new Map();
    return buildPivot({ note: activeNote, rows: activeRows, columns: activeCols, currentRows, prevRows });
  }, [activeNote, activeRows, activeCols, currentRows, prevRows]);

  // ── Filter options ────────────────────────────────────────────────
  const sourceOpts    = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));

  // ── Export helpers ────────────────────────────────────────────────
  const buildExportData = useCallback(() => {
    return notes.filter(n => n.has_table).map(n => {
      const nRows = rowsByNote.get(n.id) ?? [];
      const nCols = colsByNote.get(n.id) ?? [];
      if (!nRows.length || !nCols.length) return null;
      const nPivot = buildPivot({ note: n, rows: nRows, columns: nCols, currentRows, prevRows });
      return { note: n, rows: nRows, columns: nCols, pivot: nPivot };
    }).filter(Boolean);
  }, [notes, rowsByNote, colsByNote, currentRows, prevRows]);

  const tplLabel = templates.find(t => t.id === templateId)?.label ?? templateId;
  const groupLabel = holdingOptions.find(h => h.value === topParent)?.label ?? topParent;

  const handleExportExcel = useCallback(async () => {
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js");
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Konsolidator"; wb.created = new Date();
      const exportData = buildExportData();

      const cover = wb.addWorksheet("Notes");
      cover.mergeCells("A1:D1");
      cover.getCell("A1").value = `Consolidated Memory Notes — ${tplLabel}`;
      cover.getCell("A1").font = { size: 18, bold: true, color: { argb: "FF1A2F8A" } };
      cover.getCell("A3").value = "Group:";     cover.getCell("B3").value = groupLabel;
      cover.getCell("A4").value = "Period:";    cover.getCell("B4").value = `${month}/${year}`;
      cover.getCell("A5").value = "Source:";    cover.getCell("B5").value = source;
      cover.getCell("A6").value = "Structure:"; cover.getCell("B6").value = structure;
      cover.columns = [{ width: 14 }, { width: 40 }, { width: 14 }, { width: 14 }];

      exportData.forEach(({ note, rows: nRows, columns: nCols, pivot: nPivot }) => {
        const ws = wb.addWorksheet(`N${note.note_number}`.slice(0, 31));
        ws.mergeCells(1, 1, 1, nCols.length + 1);
        ws.getCell(1, 1).value = `Note ${note.note_number} — ${note.title}`;
        ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: "FF1A2F8A" } };

        const hr = ws.getRow(4);
        hr.getCell(1).value = "Concept";
        nCols.forEach((c, i) => { hr.getCell(i + 2).value = c.label; });
        hr.eachCell(cell => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2F8A" } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });

        nRows.forEach((row, ri) => {
          const r = ws.getRow(5 + ri);
          r.getCell(1).value = row.label;
          if (row.is_total) r.getCell(1).font = { bold: true };
          nCols.forEach((c, ci) => {
            const v = nPivot.get(`${row.id}|${c.id}`) ?? 0;
            const cell = r.getCell(2 + ci);
            cell.value = v === 0 ? null : Number(v);
            cell.numFmt = "#,##0.00;[Red]-#,##0.00";
            cell.alignment = { horizontal: "right" };
            if (row.is_total) {
              cell.font = { bold: true };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
            }
          });
        });
        ws.getColumn(1).width = 40;
        for (let i = 2; i <= nCols.length + 1; i++) ws.getColumn(i).width = 18;
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `consolidated_notes_${topParent}_${year}_${month}_${tplLabel}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert("Export error: " + e.message); }
  }, [buildExportData, tplLabel, groupLabel, topParent, year, month, source, structure]);

  const handleExportPdf = useCallback(() => {
    const exportData = buildExportData();
    const fmtN = n => { if (!n || n === 0) return "—"; const v = Number(n); return isNaN(v) || v === 0 ? "—" : v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    const pages = exportData.map(({ note, rows: nRows, columns: nCols, pivot: nPivot }) => `
      <section class="note-page">
        <h2>Note ${note.note_number} — ${note.title}</h2>
        ${note.description ? `<p class="desc">${note.description}</p>` : ""}
        ${note.default_narrative ? `<p class="narrative">${note.default_narrative}</p>` : ""}
        <table><thead><tr><th>Concept</th>${nCols.map(c => `<th class="num">${c.label}</th>`).join("")}</tr></thead>
        <tbody>${nRows.map(r => `<tr class="${r.is_total ? "total" : ""}"><td>${r.label}</td>${nCols.map(c => `<td class="num">${fmtN(nPivot.get(`${r.id}|${c.id}`) ?? 0)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      </section>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>@page{size:A4 landscape;margin:14mm}body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1f2937;margin:0}.cover{padding:40mm 20mm;text-align:center;page-break-after:always}.cover h1{color:#1A2F8A;font-size:36px;margin-bottom:24px}.note-page{page-break-after:always}h2{color:#1A2F8A;font-size:20px;margin:0 0 4px 0;border-bottom:2px solid #1A2F8A;padding-bottom:6px}.desc{color:#6b7280;font-size:11px;font-style:italic}.narrative{color:#374151;font-size:11px;line-height:1.5}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#1A2F8A;color:#fff;text-align:left;padding:6px 8px;font-weight:700}th.num,td.num{text-align:right}td{padding:5px 8px;border-bottom:1px solid #f3f4f6}tr.total td{background:#f9fafb;font-weight:700;color:#1A2F8A}</style></head>
<body><div class="cover"><h1>Consolidated Notes — ${tplLabel}</h1><p><strong>${groupLabel}</strong></p><p>${month}/${year} · ${source} · ${structure}</p></div>${pages}</body></html>`;
    const win = window.open("", "_blank");
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => win.print(), 500);
  }, [buildExportData, tplLabel, groupLabel, year, month, source, structure]);

  const handleExportWord = useCallback(() => {
    const exportData = buildExportData();
    const fmtN = n => { if (!n || n === 0) return "—"; const v = Number(n); return isNaN(v) || v === 0 ? "—" : v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    const sections = exportData.map(({ note, rows: nRows, columns: nCols, pivot: nPivot }) => `
      <h2 style="color:#1A2F8A;font-size:18pt;margin-top:18pt;border-bottom:1pt solid #1A2F8A;padding-bottom:4pt;">Note ${note.note_number} — ${note.title}</h2>
      ${note.description ? `<p style="color:#666;font-style:italic;font-size:10pt;">${note.description}</p>` : ""}
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:10pt;font-family:Calibri,Arial,sans-serif;">
        <thead><tr style="background:#1A2F8A;color:#fff;"><th style="text-align:left;">Concept</th>${nCols.map(c => `<th style="text-align:right;">${c.label}</th>`).join("")}</tr></thead>
        <tbody>${nRows.map(r => { const isTotal = r.is_total; return `<tr ${isTotal ? 'style="background:#f3f4f6;font-weight:bold;color:#1A2F8A;"' : ""}><td>${r.label}</td>${nCols.map(c => `<td style="text-align:right;">${fmtN(nPivot.get(`${r.id}|${c.id}`) ?? 0)}</td>`).join("")}</tr>`; }).join("")}</tbody>
      </table>`).join("");
    const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><style>@page Section1{size:297mm 210mm;mso-page-orientation:landscape;margin:1.5cm}div.Section1{page:Section1}body{font-family:Calibri,Arial,sans-serif;}</style></head>
<body><div class="Section1"><h1 style="color:#1A2F8A;font-size:24pt;text-align:center;">Consolidated Notes — ${tplLabel}</h1><p style="text-align:center;font-size:12pt;"><strong>${groupLabel}</strong></p><p style="text-align:center;font-size:11pt;color:#666;">${month}/${year} · ${source} · ${structure}</p>${sections}</div></body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `consolidated_notes_${topParent}_${year}_${month}_${tplLabel}.doc`;
    a.click(); URL.revokeObjectURL(url);
  }, [buildExportData, tplLabel, groupLabel, topParent, year, month, source, structure]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

      <PageHeader
        kicker="Consolidated"
        title="Memory Notes"
        tabs={templates.map(t => ({
          id: t.id,
          label: t.label,
          icon: t.id?.includes("ifrs") ? Scale : t.id?.includes("pymes") ? BookOpen : FileText,
        }))}
        activeTab={templateId}
        onTabChange={setTemplateId}
        filters={[
          ...(sourceOpts.length > 0
            ? [{ label: "Source", value: source, onChange: setSource, options: sourceOpts }]
            : []),
          { label: "Year", value: year, onChange: setYear,
            options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
          { label: "Month", value: month, onChange: setMonth,
            options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
          ...(structureOpts.length > 0
            ? [{ label: "Structure", value: structure, onChange: setStructure, options: structureOpts }]
            : []),
          ...(holdingOptions.length > 0
            ? [{ label: "Perspective", value: topParent, onChange: setTopParent, options: holdingOptions }]
            : []),
        ]}
        fabActions={[
          { id: "views",  icon: Library,  label: "Views",  onClick: () => setViewsModalOpen(true) },
          { id: "save",   icon: Save,     label: "Save",   onClick: () => {} },
          {
            id: "export", icon: Download, label: "Export",
            subActions: [
              { id: "excel", label: "Excel", src: "https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png", alt: "Excel", onClick: handleExportExcel },
              { id: "pdf",   label: "PDF",   src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png", alt: "PDF", onClick: handleExportPdf },
              { id: "word",  label: "Word",  icon: WordIcon, onClick: handleExportWord },
            ],
          },
        ]}
      />

      <MappingsModal
        open={viewsModalOpen}
        onClose={() => setViewsModalOpen(false)}
        groupAccounts={[]}
        onApply={() => {}}
      />

      <div className="flex-1 min-h-0 flex gap-4">

        {/* ── Notes sidebar ── */}
        <div className="w-[280px] flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <BookOpen size={13} style={{ color: colors.primary }} />
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>
              Notes · {tplLabel}
            </p>
            <span className="ml-auto text-[10px] font-bold text-gray-400">{notes.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {loadingTemplate ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={16} className="animate-spin text-gray-300" />
              </div>
            ) : notes.map(n => (
              <NoteSidebarItem key={n.id} note={n}
                active={n.id === activeNoteId}
                onClick={() => setActiveNoteId(n.id)} />
            ))}
          </div>
        </div>

        {/* ── Note detail ── */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden flex flex-col">
          {!activeNote ? (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-300 font-black uppercase tracking-widest">
              Select a note
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-10 flex flex-col gap-6">

              {/* Header */}
              <div className="flex items-start gap-3 pb-5 border-b border-gray-100">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-black text-white shadow-lg shrink-0"
                  style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)` }}>
                  {activeNote.note_number}
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Note {activeNote.note_number}
                  </p>
                  <h2 className="text-2xl font-black leading-tight" style={{ color: colors.primary }}>
                    {activeNote.title}
                  </h2>
                  {activeNote.description && (
                    <p className="text-xs text-gray-500 mt-1.5">{activeNote.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {activeNote.has_table && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider"
                      style={{ background: `${colors.primary}15`, color: colors.primary }}>
                      <FileText size={9} /> With table
                    </span>
                  )}
                  {!activeNote.is_required && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-500">
                      Optional
                    </span>
                  )}
                  {loadingData && (
                    <Loader2 size={13} className="animate-spin ml-2" style={{ color: colors.primary }} />
                  )}
                </div>
              </div>

              {/* Narrative */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={12} style={{ color: colors.primary }} />
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Narrative text</p>
                </div>
                <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-4">
                  <p className="text-sm text-gray-600 leading-relaxed italic">
                    {activeNote.default_narrative ?? "Narrative text will appear here. Advanced editing coming soon."}
                  </p>
                </div>
              </div>

              {/* Movements table */}
              {activeNote.has_table && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Settings2 size={12} style={{ color: colors.primary }} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                      Movements table
                    </p>
                  </div>
                  {currentRows.length === 0 && !loadingData ? (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
                      <RefreshCw size={20} className="mx-auto text-gray-300 mb-2" />
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">No data for selected filters</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        No consolidated data found for {month}/{year} · {groupLabel}
                      </p>
                    </div>
                  ) : (
                    <MovementsTable note={activeNote} rows={activeRows} columns={activeCols} pivot={pivot} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}