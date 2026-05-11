import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, BookOpen, FileText, Sparkles, Settings2, Download, Save, RefreshCw, Upload, Library, Scale } from "lucide-react";import { useTypo, useSettings } from "./SettingsContext";
import PageHeader from "./PageHeader.jsx";
import MappingsModal from "./Mappings.jsx";

const BASE_URL = "";

// ─── Supabase REST helpers ────────────────────────────────────────
const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = (schema) => ({
  apikey:           SUPABASE_APIKEY,
  Authorization:   `Bearer ${SUPABASE_APIKEY}`,
  "Accept-Profile": schema,
});
const sbGet = (schema, path) => fetch(`${SUPABASE_URL}/${path}`, { headers: sbHeaders(schema) }).then(r => r.json());

// ─── External script loader (for ExcelJS, JSZip) ──────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
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

// Returns true if `accountCode` belongs to (starts with) any of the
// `prefixes`. We do prefix matching because account_codes in templates are
// short (e.g. "210") and actual posting accounts can be deeper (e.g. "21000",
// "210000"). Treating template codes as prefixes catches sub-accounts.
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

// ─── FilterPill ────────────────────────────────────────────────────
function FilterPill({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const filterTypo = useTypo("filter");
  const display = options.find(o => String(o.value) === String(value))?.label ?? "—";
  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
        style={filterTypo}>
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
        <span>{display}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 z-50 min-w-[180px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
            <div className="p-1.5 max-h-64 overflow-y-auto">
              {options.map(o => {
                const selected = String(o.value) === String(value);
                return (
                  <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all
                      ${selected ? "bg-[#1a2f8a] text-white" : "hover:bg-[#eef1fb]"}`}
                    style={filterTypo}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── StandardSelector ─────────────────────────────────────────────
function StandardSelector({ value, onChange, templates }) {
  const { colors } = useSettings();
  return (
    <div className="flex items-center gap-2 p-1 rounded-2xl bg-gray-50 border border-gray-100">
      {templates.map(t => {
        const active = value === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            className="px-4 py-2 rounded-xl text-[11px] font-black tracking-wider uppercase transition-all"
            style={{
              backgroundColor: active ? colors.primary : "transparent",
              color: active ? "#ffffff" : "#6b7280",
              boxShadow: active ? `0 4px 12px -2px ${colors.primary}50` : "none",
            }}>
            {t.label}
          </button>
        );
      })}
    </div>
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
          <p className="text-[9px] font-bold mt-0.5 text-gray-400">Opcional</p>
        )}
      </div>
    </button>
  );
}
// ─── ExportMenu — cinematic hover-reveal: Excel / PDF / Word ──────
function ExportMenu({ onExportExcel, onExportPdf, onExportWord, disabled }) {
  const { colors } = useSettings();
  const [open, setOpen] = useState(false);

  // Order matters: rightmost is closest to the trigger, animates first
  const items = [
    { onClick: onExportWord,  title: "Export to Word",  alt: "Word",
      src: "https://logodownload.org/wp-content/uploads/2017/05/word-logo-1.png" },
    { onClick: onExportPdf,   title: "Export to PDF",   alt: "PDF",
      src: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png" },
    { onClick: onExportExcel, title: "Export to Excel", alt: "Excel",
      src: "https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png" },
  ];

  return (
    <div className="relative flex items-center justify-end"
      style={{ minWidth: 110, height: 36 }}
      onMouseEnter={() => !disabled && setOpen(true)}
      onMouseLeave={() => setOpen(false)}>

      {/* Cinematic icon trail */}
      <div className="flex items-center gap-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none">
        {items.map((it, i) => (
          <button
            key={it.alt}
            onClick={it.onClick}
            title={it.title}
            disabled={disabled}
            className="pointer-events-auto transition-all ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-125 active:scale-95 bg-transparent border-0 p-0"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? "translateX(0) scale(1) rotate(0deg)"
                              : `translateX(${(i + 1) * 22}px) scale(0.3) rotate(-15deg)`,
              transitionDuration: open ? "440ms" : "240ms",
              transitionDelay: open ? `${i * 80}ms` : `${(items.length - 1 - i) * 30}ms`,
              filter: open ? "drop-shadow(0 4px 10px rgba(0,0,0,0.15))" : "none",
            }}>
            <img src={it.src} alt={it.alt} className="block object-contain"
              style={{ width: 32, height: 32 }} />
          </button>
        ))}
      </div>

      {/* Trigger — only the Download icon, no text, fades out on hover */}
      <button
        disabled={disabled}
        title="Export"
        className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ease-out
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50"}`}
        style={{
          opacity: open ? 0 : 1,
          transform: open ? "scale(0.85)" : "scale(1)",
          transitionDuration: "240ms",
          pointerEvents: open ? "none" : "auto",
          color: colors.primary,
        }}>
        <Download size={18} strokeWidth={2.5} />
      </button>
    </div>
  );
}
// ─── MovementsTable ──────────────────────────────────────────────
// Renders a table for one note. Rows + columns come from template definitions;
// values come from the auto-built pivot keyed by (rowId, colId).
function MovementsTable({ note, rows, columns, pivot }) {
  const { colors } = useSettings();
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");

  if (!rows.length || !columns.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
        <FileText size={24} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Sin estructura definida</p>
        <p className="text-[11px] text-gray-400 mt-1">Esta nota aún no tiene tabla configurada.</p>
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
                <span style={header2Style}>Concepto</span>
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

// ═══════════════════════════════════════════════════════════════════════
//   AUTO-GENERATION ENGINE
//   Builds a pivot keyed by `${rowId}|${colId}` from uploaded-accounts.
// ═══════════════════════════════════════════════════════════════════════
function buildPivot({ note, rows, columns, currentRows, prevRows }) {
  // currentRows  = uploaded-accounts for current period (e.g. 2025-12)
  // prevRows     = uploaded-accounts for previous period (e.g. 2024-12) → opening balances
  const pivot = new Map();

  rows.forEach(row => {
    if (row.is_total) return; // totals computed at the end
    const prefixes = row.account_codes ?? [];
    if (prefixes.length === 0) return;

    columns.forEach(col => {
      const key = `${row.id}|${col.id}`;
      let value = 0;

      switch (col.col_type) {
        case "opening": {
          // Sum prev period closing balances for matching codes
          prevRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "";
            if (lac && lac !== "—") return; // only group rows
            if (codeMatchesPrefix(code, prefixes)) {
              value += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            }
          });
          break;
        }
        case "closing": {
          // If the column has a formula like "opening + additions - disposals + transfers",
          // we'll resolve it at the row-total step below. Here we just pre-fill from
          // current period totals so columns without formulas still work.
          if (col.formula) {
            value = NaN; // sentinel — formula resolved below
          } else {
            currentRows.forEach(r => {
              const code = r.AccountCode ?? r.accountCode ?? "";
              const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "";
              if (lac && lac !== "—") return;
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
          // Movement = current YTD - prev YTD. With no detailed journal entries
          // available, we approximate "additions" as the positive delta and
          // "disposals" as the negative delta. This is a heuristic — user can
          // override manually later.
          let curTotal = 0, prevTotal = 0;
          currentRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "";
            if (lac && lac !== "—") return;
            if (codeMatchesPrefix(code, prefixes)) curTotal += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          });
          prevRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "";
            if (lac && lac !== "—") return;
            if (codeMatchesPrefix(code, prefixes)) prevTotal += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          });
          const delta = curTotal - prevTotal;
          if (col.col_type === "addition")    value = delta > 0 ? delta : 0;
          else if (col.col_type === "disposal") value = delta < 0 ? Math.abs(delta) : 0;
          else value = 0; // transfers / generic movements: no auto-source available
          break;
        }
        case "depreciation": {
          // Sum amortization-related accounts. Heuristic: prefix '28' for PGC Spain
          // (amortización acumulada del inmovilizado material/intangible).
          // We sum codes 28X + 29X (deterioros) only if the row's account_codes
          // are inmovilizado-class (2X), not for unrelated rows.
          const isInmov = prefixes.some(p => /^2/.test(String(p)));
          if (!isInmov) break;
          currentRows.forEach(r => {
            const code = r.AccountCode ?? r.accountCode ?? "";
            const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "";
            if (lac && lac !== "—") return;
            // Match amortization codes that "shadow" this row
            const acStr = String(code);
            const matchesAmort = prefixes.some(p => {
              const pStr = String(p);
              const amortPrefix = "28" + pStr.slice(1); // 210 → 2810
              const deterPrefix = "29" + pStr.slice(1); // 210 → 2910
              return acStr.startsWith(amortPrefix) || acStr.startsWith(deterPrefix);
            });
            if (matchesAmort) value += parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          });
          break;
        }
        default:
          value = 0;
      }

      pivot.set(key, value);
    });
  });

  // Resolve formulas for closing-with-formula columns (e.g.
  // "opening + additions - disposals + transfers")
  rows.forEach(row => {
    if (row.is_total) return;
    columns.forEach(col => {
      if (!col.formula) return;
      const key = `${row.id}|${col.id}`;
      if (!Number.isNaN(pivot.get(key))) return; // already populated

      // Tokenize formula → operate on column types
      const colByType = new Map();
      columns.forEach(c => colByType.set(c.col_type, `${row.id}|${c.id}`));

      let result = 0;
      try {
        // Map keywords to actual values
        const env = {
          opening:     pivot.get(colByType.get("opening")) ?? 0,
          additions:   pivot.get(colByType.get("addition")) ?? 0,
          disposals:   pivot.get(colByType.get("disposal")) ?? 0,
          transfers:   pivot.get(colByType.get("transfer")) ?? 0,
          closing:     pivot.get(colByType.get("closing"))  ?? 0,
          depreciation: pivot.get(colByType.get("depreciation")) ?? 0,
        };
        // Replace tokens with values — safe because formulas are seeded by us
        let expr = col.formula;
        Object.entries(env).forEach(([k, v]) => {
          expr = expr.replaceAll(k, `(${Number.isFinite(v) ? v : 0})`);
        });
        // eslint-disable-next-line no-new-func
        result = Function(`"use strict"; return (${expr})`)();
        if (!Number.isFinite(result)) result = 0;
      } catch {
        result = 0;
      }
      pivot.set(key, result);
    });
  });

  // Compute totals row (sum of all non-total non-subtotal rows)
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

// ═══════════════════════════════════════════════════════════════════════
//   MAIN
// ═══════════════════════════════════════════════════════════════════════
export default function MemoryNotesPage({
  token, sources = [], structures = [], companies = [],
}) {
  const { colors } = useSettings();
  const header1Style = useTypo("header1");

  // Filters
  const [year, setYear]           = useState(String(new Date().getFullYear() - 1));
  const [month, setMonth]         = useState("12");
  const [source, setSource]       = useState("");
  const [structure, setStructure] = useState("");
  const [company, setCompany]     = useState("");
const [templateId, setTemplateId] = useState("pgc_normal");
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [viewsModalOpen, setViewsModalOpen] = useState(false);

  // Data
  const [templates, setTemplates] = useState([]);
  const [notes, setNotes]         = useState([]);
  const [rows, setRows]           = useState([]); // ALL rows for current template
  const [cols, setCols]           = useState([]); // ALL cols for current template
  const [loadingTemplate, setLoadingTemplate] = useState(true);

  const [currentRows, setCurrentRows] = useState([]); // uploaded-accounts current period
  const [prevRows, setPrevRows]       = useState([]); // uploaded-accounts prev period
  const [loadingData, setLoadingData] = useState(false);

  // Defaults from props
  useEffect(() => {
    if (sources.length > 0 && !source) {
      const s = sources[0];
      setSource(typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s));
    }
  }, [sources]); // eslint-disable-line
  useEffect(() => {
    if (structures.length > 0 && !structure) {
      const s = structures[0];
      setStructure(typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s));
    }
  }, [structures]); // eslint-disable-line
  useEffect(() => {
    if (companies.length > 0 && !company) {
      const c = companies[0];
      setCompany(typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c));
    }
  }, [companies]); // eslint-disable-line

  // Load templates list
  useEffect(() => {
    sbGet("memory", "templates?select=*&order=sort_order.asc&scope=eq.individual").then(d => {
      if (Array.isArray(d)) setTemplates(d);
    });
  }, []);

  // Load notes + rows + cols for current template
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

  // Fetch current and prev period uploaded-accounts
  const fetchUploaded = useCallback(async (yr, mo) => {
    if (!yr || !mo || !source || !structure || !company) return [];
    const filter = `Year eq ${yr} and Month eq ${mo} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${company}'`;
    try {
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.value ?? (Array.isArray(json) ? json : []);
    } catch {
      return [];
    }
  }, [token, source, structure, company]);

  // Load uploaded data when filters change
  useEffect(() => {
    if (!year || !month || !source || !structure || !company) return;
    setLoadingData(true);
    Promise.all([
      fetchUploaded(year, month),
      fetchUploaded(String(parseInt(year) - 1), month),
    ]).then(([cur, prev]) => {
      setCurrentRows(cur);
      setPrevRows(prev);
      setLoadingData(false);
    });
  }, [year, month, source, structure, company, fetchUploaded]);

  // Memoized lookups by note
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

  // Build pivot for active note
  const pivot = useMemo(() => {
    if (!activeNote || !activeNote.has_table) return new Map();
    if (currentRows.length === 0 && prevRows.length === 0) return new Map();
    return buildPivot({
      note: activeNote,
      rows: activeRows,
      columns: activeCols,
      currentRows, prevRows,
    });
  }, [activeNote, activeRows, activeCols, currentRows, prevRows]);

  // Filter options
  const sourceOpts    = [...new Set(sources.map(s  => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const companyOpts = companies
    .map(c => typeof c === "object"
      ? { value: c.companyShortName ?? c.CompanyShortName ?? "", label: c.companyLegalName ?? c.CompanyLegalName ?? c.companyShortName ?? c.CompanyShortName ?? "" }
      : { value: String(c), label: String(c) })
    .filter(o => o.value);

// ─── Export handlers ────────────────────────────────────────────
  const buildExportData = useCallback(() => {
    const allNotes = notes.filter(n => n.has_table);
    return allNotes.map(n => {
      const nRows = rowsByNote.get(n.id) ?? [];
      const nCols = colsByNote.get(n.id) ?? [];
      if (!nRows.length || !nCols.length) return null;
      const nPivot = buildPivot({ note: n, rows: nRows, columns: nCols, currentRows, prevRows });
      return { note: n, rows: nRows, columns: nCols, pivot: nPivot };
    }).filter(Boolean);
  }, [notes, rowsByNote, colsByNote, currentRows, prevRows]);

  const handleExportExcel = useCallback(async () => {
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js");
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Konsolidator";
      wb.created = new Date();

      const exportData = buildExportData();
      const tplLabel = templates.find(t => t.id === templateId)?.label ?? templateId;

      const cover = wb.addWorksheet("Memoria");
      cover.mergeCells("A1:D1");
      cover.getCell("A1").value = `Memoria — ${tplLabel}`;
      cover.getCell("A1").font = { size: 18, bold: true, color: { argb: "FF1A2F8A" } };
      cover.getCell("A3").value = "Empresa:";   cover.getCell("B3").value = company;
      cover.getCell("A4").value = "Periodo:";   cover.getCell("B4").value = `${month}/${year}`;
      cover.getCell("A5").value = "Source:";    cover.getCell("B5").value = source;
      cover.getCell("A6").value = "Estructura:";cover.getCell("B6").value = structure;
      cover.columns = [{ width: 14 }, { width: 40 }, { width: 14 }, { width: 14 }];

      exportData.forEach(({ note, rows: nRows, columns: nCols, pivot: nPivot }) => {
        const sheetName = `N${note.note_number}`.slice(0, 31);
        const ws = wb.addWorksheet(sheetName);

        ws.mergeCells(1, 1, 1, nCols.length + 1);
        ws.getCell(1, 1).value = `Nota ${note.note_number} — ${note.title}`;
        ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: "FF1A2F8A" } };

        if (note.description) {
          ws.mergeCells(2, 1, 2, nCols.length + 1);
          ws.getCell(2, 1).value = note.description;
          ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
        }

        const headerRow = ws.getRow(4);
        headerRow.getCell(1).value = "Concepto";
        nCols.forEach((c, i) => { headerRow.getCell(i + 2).value = c.label; });
        headerRow.eachCell(cell => {
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
      const a = document.createElement("a");
      a.href = url;
      a.download = `memoria_${company}_${year}_${month}_${tplLabel}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Error exportando Excel: " + e.message);
    }
  }, [buildExportData, templates, templateId, company, year, month, source, structure]);

  const handleExportPdf = useCallback(() => {
    const exportData = buildExportData();
    const tplLabel = templates.find(t => t.id === templateId)?.label ?? templateId;
    const fmtN = (n) => {
      if (n == null || n === 0) return "—";
      const num = typeof n === "number" ? n : Number(n);
      if (isNaN(num) || num === 0) return "—";
      return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const pages = exportData.map(({ note, rows: nRows, columns: nCols, pivot: nPivot }) => `
      <section class="note-page">
        <h2>Nota ${note.note_number} — ${note.title}</h2>
        ${note.description ? `<p class="desc">${note.description}</p>` : ""}
        ${note.default_narrative ? `<p class="narrative">${note.default_narrative}</p>` : ""}
        <table>
          <thead>
            <tr>
              <th>Concepto</th>
              ${nCols.map(c => `<th class="num">${c.label}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${nRows.map(r => `
              <tr class="${r.is_total ? "total" : ""}">
                <td>${r.label}</td>
                ${nCols.map(c => `<td class="num">${fmtN(nPivot.get(`${r.id}|${c.id}`) ?? 0)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `).join("");

    const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Memoria ${company} ${year}-${month}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color:#1f2937; margin:0; }
  .cover { padding:40mm 20mm; text-align:center; page-break-after:always; }
  .cover h1 { color:#1A2F8A; font-size:36px; margin-bottom:24px; }
  .cover p { font-size:14px; color:#6b7280; margin:6px 0; }
  .note-page { page-break-after:always; }
  h2 { color:#1A2F8A; font-size:20px; margin:0 0 4px 0; border-bottom:2px solid #1A2F8A; padding-bottom:6px; }
  .desc { color:#6b7280; font-size:11px; font-style:italic; margin:4px 0 12px 0; }
  .narrative { color:#374151; font-size:11px; margin:6px 0 16px 0; line-height:1.5; }
  table { width:100%; border-collapse:collapse; font-size:10px; }
  th { background:#1A2F8A; color:#fff; text-align:left; padding:6px 8px; font-weight:700; }
  th.num, td.num { text-align:right; }
  td { padding:5px 8px; border-bottom:1px solid #f3f4f6; }
  tr.total td { background:#f9fafb; font-weight:700; color:#1A2F8A; }
  @media print { .no-print { display:none !important; } }
</style></head>
<body>
  <div class="cover">
    <h1>Memoria — ${tplLabel}</h1>
    <p><strong>${company}</strong></p>
    <p>${month}/${year} · ${source} · ${structure}</p>
  </div>
  ${pages}
</body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  }, [buildExportData, templates, templateId, company, year, month, source, structure]);

  const handleExportWord = useCallback(() => {
    const exportData = buildExportData();
    const tplLabel = templates.find(t => t.id === templateId)?.label ?? templateId;
    const fmtN = (n) => {
      if (n == null || n === 0) return "—";
      const num = typeof n === "number" ? n : Number(n);
      if (isNaN(num) || num === 0) return "—";
      return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const sections = exportData.map(({ note, rows: nRows, columns: nCols, pivot: nPivot }) => `
      <h2 style="color:#1A2F8A;font-size:18pt;margin-top:18pt;border-bottom:1pt solid #1A2F8A;padding-bottom:4pt;">
        Nota ${note.note_number} — ${note.title}
      </h2>
      ${note.description ? `<p style="color:#666;font-style:italic;font-size:10pt;">${note.description}</p>` : ""}
      ${note.default_narrative ? `<p style="font-size:11pt;margin:8pt 0;">${note.default_narrative}</p>` : ""}
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:10pt;font-family:Calibri,Arial,sans-serif;">
        <thead>
          <tr style="background:#1A2F8A;color:#ffffff;">
            <th style="text-align:left;">Concepto</th>
            ${nCols.map(c => `<th style="text-align:right;">${c.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${nRows.map(r => {
            const isTotal = r.is_total;
            return `<tr ${isTotal ? 'style="background:#f3f4f6;font-weight:bold;color:#1A2F8A;"' : ""}>
              <td>${r.label}</td>
              ${nCols.map(c => `<td style="text-align:right;">${fmtN(nPivot.get(`${r.id}|${c.id}`) ?? 0)}</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `).join("");

    const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8" />
<title>Memoria</title>
<!--[if gte mso 9]><xml>
  <w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
</xml><![endif]-->
<style>
  @page Section1 { size: 297mm 210mm; mso-page-orientation: landscape; margin: 1.5cm; }
  div.Section1 { page: Section1; }
  body { font-family: Calibri, Arial, sans-serif; }
</style></head>
<body>
  <div class="Section1">
    <h1 style="color:#1A2F8A;font-size:24pt;text-align:center;">Memoria — ${tplLabel}</h1>
    <p style="text-align:center;font-size:12pt;"><strong>${company}</strong></p>
    <p style="text-align:center;font-size:11pt;color:#666;">${month}/${year} · ${source} · ${structure}</p>
    ${sections}
  </div>
</body></html>`;

    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memoria_${company}_${year}_${month}_${tplLabel}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildExportData, templates, templateId, company, year, month, source, structure]);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

 <PageHeader
        kicker="Individual"
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
          ...(companyOpts.length > 0
            ? [{ label: "Company", value: company, onChange: setCompany, options: companyOpts }]
            : []),
        ]}
        fabActions={[
          {
            id: "views",
            icon: Library,
            label: "Views",
            onClick: () => setViewsModalOpen(true),
          },
          {
            id: "save",
            icon: Save,
            label: "Save",
            onClick: () => {},
          },
          {
            id: "export",
            icon: Download,
            label: "Export",
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

        <div className="w-[280px] flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <BookOpen size={13} style={{ color: colors.primary }} />
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>
              Notas · {templates.find(t => t.id === templateId)?.label}
            </p>
            <span className="ml-auto text-[10px] font-bold text-gray-400">{notes.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {loadingTemplate ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={16} className="animate-spin text-gray-300" />
              </div>
            ) : (
              notes.map(n => (
                <NoteSidebarItem key={n.id} note={n}
                  active={n.id === activeNoteId}
                  onClick={() => setActiveNoteId(n.id)} />
              ))
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden flex flex-col">
          {!activeNote ? (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-300 font-black uppercase tracking-widest">
              Selecciona una nota
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-10 flex flex-col gap-6">

              <div className="flex items-start gap-3 pb-5 border-b border-gray-100">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-black text-white shadow-lg shrink-0"
                  style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)` }}>
                  {activeNote.note_number}
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Nota {activeNote.note_number}
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
                      <FileText size={9} /> Con tabla
                    </span>
                  )}
                  {!activeNote.is_required && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-500">
                      Opcional
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={12} style={{ color: colors.primary }} />
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    Texto narrativo
                  </p>
                </div>
                <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-4">
                  <p className="text-sm text-gray-600 leading-relaxed italic">
                    {activeNote.default_narrative ?? "Aquí irá el texto narrativo de la nota. Edición avanzada en próxima entrega."}
                  </p>
                </div>
              </div>

              {activeNote.has_table && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Settings2 size={12} style={{ color: colors.primary }} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                      Tabla de movimientos
                    </p>
                    {loadingData && <Loader2 size={11} className="animate-spin text-gray-400" />}
                  </div>
                  {(currentRows.length === 0 && !loadingData) ? (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
                      <RefreshCw size={20} className="mx-auto text-gray-300 mb-2" />
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Sin datos para los filtros</p>
                      <p className="text-[11px] text-gray-400 mt-1">No se encontraron datos contables en {month}/{year} para {company}</p>
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