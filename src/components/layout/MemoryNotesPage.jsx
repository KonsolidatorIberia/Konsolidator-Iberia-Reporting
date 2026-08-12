import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, BookOpen, FileText, Sparkles, Settings2, Download, Save, RefreshCw, Upload, Library, Scale, Bold, Italic, Underline, Plus, Trash2, X, Type, ChevronDown, Check } from "lucide-react";
import { useTypo, useSettings } from "./SettingsContext";
import PageHeader from "./PageHeader.jsx";

const BASE_URL = "";

// Tipos de tabla para epígrafes personalizados (extensible: añade una entrada).
const TABLE_TYPES = {
  none:     { label: "Sin tabla de datos", columns: [] },
  movement: { label: "Movimiento (altas/bajas)", columns: [
    { id: "c-opening",  label: "Saldo inicial", col_type: "opening"  },
    { id: "c-addition", label: "Altas",         col_type: "addition" },
    { id: "c-disposal", label: "Bajas",         col_type: "disposal" },
    { id: "c-transfer", label: "Traspasos",     col_type: "transfer" },
    { id: "c-closing",  label: "Saldo final",   col_type: "closing"  },
  ]},
  simple:   { label: "Importe simple", columns: [
    { id: "c-value", label: "Valor", col_type: "value" },
  ]},
  twoYears: { label: "Dos ejercicios", columns: [
    { id: "c-cur",  label: "Ejercicio actual",   col_type: "value" },
    { id: "c-prev", label: "Ejercicio anterior", col_type: "value" },
  ]},
  related:  { label: "Partes vinculadas", columns: [
    { id: "c-group", label: "Otras empresas del grupo",          col_type: "value" },
    { id: "c-key",   label: "Personal clave de la dirección",    col_type: "value" },
  ]},
  empty:    { label: "Tabla vacía (defines columnas)", columns: [
    { id: "c-value", label: "Valor", col_type: "value" },
  ]},
};
const TABLE_TYPE_LIST = Object.entries(TABLE_TYPES).map(([id, t]) => ({ v: id, n: t.label }));

// ─── Supabase REST helpers ────────────────────────────────────────
const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const sbHeaders = (schema) => ({
  apikey:           SUPABASE_APIKEY,
  Authorization:   `Bearer ${SUPABASE_APIKEY}`,
  "Accept-Profile": schema,
});
const sbGet = (schema, path) => fetch(`${SUPABASE_URL}/${path}`, { headers: sbHeaders(schema) }).then(r => r.json());

// ─── Authenticated Supabase REST (for the `memory` save/note_state tables) ──
// These tables have RLS `to authenticated`, so requests must carry the user's
// JWT (session.access_token) — the publishable key is rol anon and gets blocked.
async function sbMemAuth(method, path, { body, prefer } = {}) {
  const { supabase } = await import("../../lib/supabaseClient");
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error("No hay sesión de usuario para guardar memorias.");
  const headers = {
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${jwt}`,
    "Accept-Profile": "memory",
    "Content-Profile": "memory",
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${method} ${path} → ${res.status} ${txt}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Resolve the current user's id + display name for the "edited by" record.
async function getMemUser() {
  const { supabase } = await import("../../lib/supabaseClient");
  const { data: { session } } = await supabase.auth.getSession();
  const u = session?.user;
  if (!u) return { id: null, name: null };
  const md = u.user_metadata || {};
  return { id: u.id, name: md.full_name || md.name || u.email || null };
}

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
// ─── Hierarchy + rollup helpers ───────────────────────────────────
// Mismo patrón que DimensionesPage e IndividualCashFlowPage.

// AccountCode → SumAccountCode. Se construye desde group-accounts
// y también desde los postings (por si hay códigos huérfanos).
function buildParentOf(groupAccounts, ...uploadedBuckets) {
  const parentOf = new Map();
  const add = (ac, sum) => {
    const a = String(ac ?? ""), s = String(sum ?? "");
    if (a && s && a !== s) parentOf.set(a, s);
  };
  (groupAccounts ?? []).forEach(g =>
    add(g.AccountCode ?? g.accountCode, g.SumAccountCode ?? g.sumAccountCode));
  uploadedBuckets.forEach(bucket => (bucket ?? []).forEach(r =>
    add(r.AccountCode ?? r.accountCode, r.SumAccountCode ?? r.sumAccountCode)));
  return parentOf;
}

// Resuelve AccountType de un código caminando padre arriba por parentOf
// hasta que algún ancestro tenga tipo declarado en typeByCode.
function resolveAccountType(code, typeByCode, parentOf) {
  let cur = String(code ?? "");
  let hops = 0;
  while (cur && hops < 30) {
    if (typeByCode.has(cur)) return typeByCode.get(cur);
    cur = parentOf.get(cur);
    hops++;
  }
  return null;
}

// Pivot crudo Map<accountCode, totalAmt>.
// Si se pasa accountTypes, filtra usando AccountType de la fila o, si está
// vacío (lo más habitual en uploaded-accounts), resolviendo vía el chart.
// Si no se puede resolver el tipo y hay filtro, mantiene la fila — preferimos
// over-include a perder datos silenciosamente.
function buildPostingsPivot(uploadedRows, accountTypes, typeByCode, parentOf) {
  const p = new Map();
  (uploadedRows ?? []).forEach(r => {
    const code = String(r.AccountCode ?? r.accountCode ?? "");
    if (!code) return;
    if (accountTypes && accountTypes.length > 0) {
      const rowType = r.AccountType ?? r.accountType ?? "";
      const t = rowType || resolveAccountType(code, typeByCode, parentOf);
      if (t && !accountTypes.includes(t)) return; // tipo conocido y no encaja → fuera
      // si t es null (desconocido), dejamos pasar para no perder data
    }
    const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
    p.set(code, (p.get(code) ?? 0) + amt);
  });
  return p;
}

// Rolled-up pivot: cada posting suma a sí mismo + a cada ancestro.
// Tras esto pivot.get(code) === total del subárbol bajo ese código.
function rollUpPivot(postings, parentOf) {
  const out = new Map();
  if (!postings || postings.size === 0) return out;
  postings.forEach((amt, code) => {
    out.set(code, (out.get(code) ?? 0) + amt);
    let cur = parentOf.get(code);
    let hops = 0;
    while (cur && hops < 30) {
      out.set(cur, (out.get(cur) ?? 0) + amt);
      cur = parentOf.get(cur);
      hops++;
    }
  });
  return out;
}

// Suma de códigos con doble estrategia:
//  1) exact lookup contra el rolled-up pivot (códigos que existen tal cual)
//  2) si falla, prefix-match contra los leaves (rawPivot) — captura casos
//     como '210' en charts que sólo tienen '210000', '210100', etc.
// El rawPivot tiene SOLO leaves (postings), así que no hay doble conteo
// con ancestros agregados.
function sumCodes(rolledPivot, codes, rawPivot = null) {
  if (!codes || codes.length === 0 || !rolledPivot) return 0;
  let total = 0;
  for (const c of codes) {
    const code = String(c);
    const exact = rolledPivot.get(code);
    if (exact !== undefined && exact !== 0) {
      total += exact;
      continue;
    }
    if (rawPivot) {
      rawPivot.forEach((amt, leafCode) => {
        if (String(leafCode).startsWith(code)) total += amt;
      });
    }
  }
  return total;
}

// ─── Cash-flow mapping indexes ─────────────────────────────────────
function buildCfIndexes(cfMapping) {
  const cfCodeByGroupCode = new Map();
  const cfParentOf = new Map();
  (cfMapping ?? []).forEach(m => {
    const enabled = m.enabled ?? m.Enabled;
    if (enabled === false) return;
    const ga = String(m.groupAccountCode ?? m.GroupAccountCode ?? "");
    const cf = String(m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? "");
    const cfp = String(m.cashFlowAccountSumAccountCode ?? m.CashFlowAccountSumAccountCode ?? "");
    if (ga && cf) cfCodeByGroupCode.set(ga, cf);
    if (cf && cfp && cf !== cfp) cfParentOf.set(cf, cfp);
  });
  return { cfCodeByGroupCode, cfParentOf };
}

// Proyecta postings a códigos CF vía el mapping. Devuelve pivot crudo CF
// que después rolas con cfParentOf.
function buildCashflowPostingsPivot(uploadedRows, cfCodeByGroupCode) {
  const p = new Map();
  (uploadedRows ?? []).forEach(r => {
    const ga = String(r.AccountCode ?? r.accountCode ?? "");
    const cf = cfCodeByGroupCode.get(ga);
    if (!cf) return;
    const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
    p.set(cf, (p.get(cf) ?? 0) + amt);
  });
  return p;
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
// ─── EditableCell ────────────────────────────────────────────────
// Celda click-to-edit. Read-only para totales. Enter/blur commitea, Escape
// cancela. Acepta formatos ES/DE (1.234,56) e inglés (1234.56). Devolver
// null al padre limpia el override y la celda vuelve al valor calculado.
function parseUserNumber(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  const hasDot = t.includes("."), hasComma = t.includes(",");
  let norm;
  if (hasDot && hasComma) norm = t.replace(/\./g, "").replace(",", ".");
  else if (hasComma)      norm = t.replace(",", ".");
  else                    norm = t;
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}

// ─── VariableBuilder ─────────────────────────────────────────────
// Popover para construir una variable de celda: lista de términos { code, sign }
// sobre una fuente (balance/pyg). El valor de la celda = Σ(sign × importe cuenta).
function VariableBuilder({ items, initial, onSave, onClear, onClose, resolvePreview }) {
  const [terms, setTerms]   = useState(() => (initial?.terms ?? []).map(t => ({ ...t })));
  const [source, setSource] = useState(initial?.source ?? "balance");
  const [search, setSearch] = useState("");
const filtered = search.trim()
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : items;
  const addTerm = (code, sign) => {
    setTerms(prev => prev.some(t => t.code === code) ? prev : [...prev, { code, sign }]);
    setSearch("");
  };
  const toggleSign = (code) => setTerms(prev => prev.map(t => t.code === code ? { ...t, sign: t.sign < 0 ? 1 : -1 } : t));
  const removeTerm = (code) => setTerms(prev => prev.filter(t => t.code !== code));
  const preview = resolvePreview ? resolvePreview({ terms, source }) : null;

return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}>
      <div className="w-[560px] max-w-full max-h-[85vh] rounded-2xl border border-gray-200 bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-black uppercase tracking-widest text-gray-600">Variable · asignar cuentas</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>

        {/* Fuente */}
        <div className="flex gap-1.5 px-5 pt-3">
          {[["balance", "Balance"], ["pyg", "PyG"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setSource(v)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${source === v ? "bg-[#1a2f8a] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {lbl}
            </button>
          ))}
          <div className="flex-1" />
          {preview != null && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#eef1fb]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#1a2f8a]">Resultado</span>
              <span className="font-mono font-black text-sm text-[#1a2f8a] tabular-nums">{fmt(preview)}</span>
            </div>
          )}
        </div>

        {/* Términos elegidos */}
        {terms.length > 0 && (
          <div className="px-5 pt-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Cuentas en la variable</p>
            <div className="flex flex-wrap gap-1.5">
              {terms.map(t => (
                <div key={t.code} className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg bg-gray-50 border border-gray-100">
                  <button onClick={() => toggleSign(t.code)} title="Cambiar signo (+/−)"
                    className={`w-5 h-5 rounded-md flex items-center justify-center font-black text-xs flex-shrink-0 ${t.sign < 0 ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"}`}>
                    {t.sign < 0 ? "−" : "+"}
                  </button>
                  <span className="font-mono text-[11px] text-gray-700">{t.code}</span>
                  <button onClick={() => removeTerm(t.code)} className="text-gray-300 hover:text-red-500 flex-shrink-0"><X size={11} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Buscador */}
        <div className="px-5 pt-3">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filtrar cuentas… (o desplázate por la lista)"
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        </div>

        {/* Lista de cuentas (siempre visible, scrolleable) */}
        <div className="flex-1 min-h-0 overflow-y-auto mx-5 my-3 rounded-lg border border-gray-100">
          {filtered.length === 0 ? (
            <p className="text-[11px] text-gray-300 text-center py-6">Sin resultados</p>
          ) : filtered.map(it => {
            const chosen = terms.find(t => t.code === it.code);
            return (
              <div key={it.code} className="flex items-center border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                <span className="flex-1 px-3 py-2 text-[11px] text-gray-700 truncate">{it.label}</span>
                {chosen && (
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded mr-1 ${chosen.sign < 0 ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"}`}>
                    {chosen.sign < 0 ? "− en var" : "+ en var"}
                  </span>
                )}
                <button onClick={() => addTerm(it.code, 1)} title="Sumar"
                  className="px-2.5 py-2 text-emerald-600 hover:bg-emerald-50 font-black">+</button>
                <button onClick={() => addTerm(it.code, -1)} title="Restar"
                  className="px-2.5 py-2 text-red-500 hover:bg-red-50 font-black">−</button>
              </div>
            );
          })}
        </div>

        {/* Acciones */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={() => onSave({ terms, source })}
            disabled={terms.length === 0}
            className="flex-1 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-white bg-[#1a2f8a] disabled:opacity-40 hover:opacity-90">
            Asignar
          </button>
          {initial && (
            <button onClick={onClear}
              className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-red-600 bg-red-50 hover:bg-red-100">
              Quitar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditableCell({ rowId, colId, value, readOnly, onCellEdit, baseStyle, color,
                        variable, accountItems, onSetVariable, resolveVariablePreview }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const [showVar, setShowVar] = useState(false);
  const hasVar = !!variable;
  const varEnabled = !!onSetVariable && Array.isArray(accountItems);

  if (readOnly) {
    return (
      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
        style={{ ...baseStyle, color }}>
        {fmt(value)}
      </td>
    );
  }

  const startEdit = () => {
    const isZero = value == null || value === 0 || Number.isNaN(value);
    setDraft(isZero ? "" : String(value).replace(".", ","));
    setEditing(true);
  };
  const commit = () => {
    onCellEdit?.(rowId, colId, parseUserNumber(draft));
    setEditing(false);
  };
  const cancel = () => { setEditing(false); setDraft(""); };

  if (editing) {
    return (
      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
        style={{ ...baseStyle, color }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter")       { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          className="w-full text-right bg-transparent outline-none tabular-nums"
          style={{ ...baseStyle, color: "#000", border: "none", padding: 0, margin: 0 }}
        />
      </td>
    );
  }

return (
    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums transition-colors hover:bg-blue-50/40 relative group/cell"
      style={{ ...baseStyle, color }}>
      <span className="inline-flex items-center justify-end gap-1">
        {varEnabled && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowVar(v => !v); }}
            title={hasVar ? "Editar variable" : "Asignar cuenta (variable)"}
            className={`opacity-0 group-hover/cell:opacity-100 transition-opacity p-0.5 rounded ${hasVar ? "opacity-100 text-emerald-600" : "text-gray-400 hover:text-[#1a2f8a]"}`}>
            <Library size={12} />
          </button>
        )}
        <span onClick={hasVar ? undefined : startEdit}
          className={hasVar ? "cursor-default" : "cursor-text"}
          style={hasVar ? { color: "#0B7A54", fontWeight: 700 } : undefined}>
          {fmt(value)}
        </span>
      </span>
      {showVar && varEnabled && (
        <VariableBuilder
          items={accountItems}
          initial={variable}
          resolvePreview={resolveVariablePreview}
          onSave={(v) => { onSetVariable(rowId, colId, v); setShowVar(false); }}
          onClear={() => { onSetVariable(rowId, colId, null); setShowVar(false); }}
          onClose={() => setShowVar(false)}
        />
      )}
    </td>
  );
}
// ─── MovementsTable ──────────────────────────────────────────────
// Renders a table for one note. Rows + columns come from template definitions;
// values come from the auto-built pivot keyed by (rowId, colId).
function MovementsTable({ rows, columns, pivot, overrides, onCellEdit, onAddRow, onRenameRow, onDeleteRow, onEnable,
                         cellVariables, accountItems, onSetVariable, resolveVariable }) {
  const { colors } = useSettings();
  const header2Style = useTypo("header2");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const [editingRowId, setEditingRowId] = useState(null);
  const [rowDraft, setRowDraft] = useState("");
  const startRename = (row) => { setEditingRowId(row.id); setRowDraft(row.label ?? ""); };
  const commitRename = () => {
    if (editingRowId != null && rowDraft.trim()) onRenameRow?.(editingRowId, rowDraft.trim());
    setEditingRowId(null); setRowDraft("");
  };
  const editable = !!(onAddRow || onRenameRow || onDeleteRow);

if (!rows.length || !columns.length) {
    return (
      <button
        onClick={onEnable}
        disabled={!onEnable}
        className={`w-full rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center transition-colors ${onEnable ? "hover:border-gray-300 hover:bg-gray-100 cursor-pointer" : ""}`}>
        <Plus size={24} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Sin estructura definida</p>
        <p className="text-[11px] text-gray-400 mt-1">{onEnable ? "Haz clic para crear una tabla y empezar a añadir filas." : "Esta nota aún no tiene tabla configurada."}</p>
      </button>
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
                  className={`group border-b border-gray-50 ${isTotal ? "bg-gray-50" : "hover:bg-gray-50/40"} transition-colors`}>
                  <td className="px-5 py-2.5" style={{ paddingLeft: `${20 + (row.level || 0) * 16}px`, ...rowStyle }}>
                    {editingRowId === row.id ? (
                      <input
                        autoFocus
                        value={rowDraft}
                        onChange={e => setRowDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setEditingRowId(null); setRowDraft(""); } }}
                        className="w-full px-1.5 py-0.5 rounded border border-gray-300 text-xs"
                        style={rowStyle}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{row.label}</span>
                        {editable && !isTotal && (
<span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1.5 ml-2">
                            <button onClick={() => startRename(row)} title="Renombrar fila"
                              className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800"><Settings2 size={14} /></button>
                            <button onClick={() => onDeleteRow?.(row.id)} title="Eliminar fila"
                              className="p-1 rounded hover:bg-red-100 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
                          </span>
                        )}
                      </span>
                    )}
                  </td>
{columns.map(col => {
                    // Valor efectivo de una celda (col dada) = override si existe, si no el pivot.
                    const cellValFor = (rid, cid) => {
                      const k = `${rid}|${cid}`;
                      const o = overrides?.get(k);
                      return (o !== undefined && o !== null) ? o : (pivot.get(k) ?? 0);
                    };
const cellVal = (rid) => cellValFor(rid, col.id);
                    const cellVar = cellVariables?.[`${row.id}|${col.id}`] ?? null;
                    // Valor efectivo de OTRA columna de la misma fila (para fórmulas y closing):
                    // override > variable > pivot.
                    const effVal = (rid, cid) => {
                      const k = `${rid}|${cid}`;
                      const o = overrides?.get(k);
                      if (o !== undefined && o !== null) return o;
                      const vr = cellVariables?.[k] ?? null;
                      if (vr && resolveVariable) return resolveVariable(vr);
                      return pivot.get(k) ?? 0;
                    };
const colByType = {};
                    columns.forEach(c => {
                      // No pisar un col_type ya asignado con uno que trae fórmula: el
                      // "Saldo final" (closing sin fórmula) debe ganar sobre "Valor neto"
                      // (closing CON fórmula) para la clave "closing".
                      if (colByType[c.col_type] == null || !c.formula) colByType[c.col_type] = c.id;
                    });
                    // El closing "real" (saldo final) es el que NO tiene fórmula.
                    const realClosingCol = columns.find(c => c.col_type === "closing" && !c.formula);
                    const closingId = realClosingCol?.id ?? colByType["closing"];
                    const isDerivedClosing = col.col_type === "closing" && !col.formula && !!closingId
                      && overrides?.get(`${row.id}|${closingId}`) == null;
                    const ownOverride = overrides?.get(`${row.id}|${col.id}`);
                    const hasOwnOverride = ownOverride !== undefined && ownOverride !== null;
                    let v;
if (isTotal) {
                      v = rows.reduce((s, r) => {
                        if (r.is_total || r.is_subtotal) return s;
                        return s + effVal(r.id, col.id);
                      }, 0);
                    } else if (hasOwnOverride) {
                      // Un valor puesto a mano en esta celda manda sobre todo.
                      v = ownOverride;
                    } else if (cellVar && resolveVariable) {
                      // Variable (cuenta[s]) se recalcula por periodo.
                      v = resolveVariable(cellVar);
                    } else if (col.formula) {
                      // Columna calculada (p.ej. Valor neto): evaluar la fórmula con los
                      // valores efectivos de las otras columnas de ESTA fila. Funciona
                      // también para filas custom (que el pivot no calcula).
                      const env = {
                        opening:          colByType["opening"]          ? effVal(row.id, colByType["opening"])          : 0,
                        additions:        colByType["addition"]         ? effVal(row.id, colByType["addition"])         : 0,
                        disposals:        colByType["disposal"]         ? effVal(row.id, colByType["disposal"])         : 0,
                        transfers:        colByType["transfer"]         ? effVal(row.id, colByType["transfer"])         : 0,
closing:          closingId
                                            ? (overrides?.get(`${row.id}|${closingId}`) != null
                                                ? overrides.get(`${row.id}|${closingId}`)
                                                : (effVal(row.id, colByType["opening"] ?? "") + effVal(row.id, colByType["addition"] ?? "") - effVal(row.id, colByType["disposal"] ?? "") + effVal(row.id, colByType["transfer"] ?? "")))
                                            : 0,
                        depreciation:     colByType["depreciation"]     ? effVal(row.id, colByType["depreciation"])     : 0,
                        pyg_current:      colByType["pyg_current"]      ? effVal(row.id, colByType["pyg_current"])      : 0,
                        pyg_prev:         colByType["pyg_prev"]         ? effVal(row.id, colByType["pyg_prev"])         : 0,
                        balance_delta:    colByType["balance_delta"]    ? effVal(row.id, colByType["balance_delta"])    : 0,
                        treasury_opening: colByType["treasury_opening"] ? effVal(row.id, colByType["treasury_opening"]) : 0,
                        treasury_closing: colByType["treasury_closing"] ? effVal(row.id, colByType["treasury_closing"]) : 0,
                      };
                      try {
                        let expr = col.formula;
                        Object.entries(env).forEach(([k, val]) => { expr = expr.replaceAll(k, `(${Number.isFinite(val) ? val : 0})`); });
                        const r = Function(`"use strict"; return (${expr})`)();
                        v = Number.isFinite(r) ? r : 0;
                      } catch { v = 0; }
                    } else if (isDerivedClosing) {
                      v = effVal(row.id, colByType["opening"] ?? "") + effVal(row.id, colByType["addition"] ?? "")
                        - effVal(row.id, colByType["disposal"] ?? "") + effVal(row.id, colByType["transfer"] ?? "");
                    } else {
                      v = cellVal(row.id);
                    }
                    const color = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : (isTotal ? colors.primary : "#000000");
                    return (
<EditableCell key={col.id}
                        rowId={row.id}
                        colId={col.id}
                        value={v}
                        readOnly={isTotal || isDerivedClosing}
                        onCellEdit={onCellEdit}
                        baseStyle={rowStyle}
                        color={color}
                        variable={cellVar}
                        accountItems={accountItems}
                        onSetVariable={onSetVariable}
                        resolveVariablePreview={resolveVariable} />
                    );
                  })}
                </tr>
              );
            })}
</tbody>
        </table>
      </div>
{editable && onAddRow && (
        <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/50">
          <button onClick={() => {
              // Insertar antes de la primera fila de total (para que la nueva quede
              // encima del total); si no hay total, al final.
              const totalIdx = rows.findIndex(r => r.is_total);
              const afterId = totalIdx > 0 ? rows[totalIdx - 1].id
                            : totalIdx === 0 ? null
                            : (rows.length ? rows[rows.length - 1].id : null);
              onAddRow(afterId, "Nueva fila");
            }}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-800 transition-colors">
            <Plus size={12} /> Añadir fila
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//   NARRATIVE EDITOR — rich text with live {{rowId.colId}} variables that
//   pull formatted values from the note's pivot and update automatically.
//   Toolbar: font, size, spacing, bold/italic/underline, insert variable.
// ═══════════════════════════════════════════════════════════════════════
function fmtVal(n) {
  if (n === 0 || n == null || (typeof n === "number" && isNaN(n))) return "—";
  if (typeof n !== "number") return String(n);
  const s = Math.abs(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

const NARR_FONTS = [
  { v: "'Newsreader',Georgia,serif", n: "Newsreader" },
  { v: "Georgia,serif", n: "Georgia" },
  { v: "'Inter',system-ui,sans-serif", n: "Inter" },
  { v: "'Times New Roman',serif", n: "Times" },
];
const NARR_SIZES = ["13", "14", "15", "16", "17", "19", "22"];
const NARR_SPACING = [{ v: "1.5", n: "Compacto" }, { v: "1.75", n: "Normal" }, { v: "2.1", n: "Amplio" }];

// ─── AddNoteModal — crear un epígrafe personalizado ───────────────
function AddNoteModal({ colors, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hasNarrative, setHasNarrative] = useState(true);
  const [tableType, setTableType] = useState("none");
  const canCreate = title.trim().length > 0;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
<div className="w-[520px] max-w-full rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Plus size={16} style={{ color: colors.primary }} />
          <p className="text-sm font-black text-gray-800">Nuevo epígrafe de memoria</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Nombre del epígrafe *</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              placeholder="p. ej. Operaciones con partes vinculadas"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Descripción (opcional)</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Breve descripción del epígrafe"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={hasNarrative} onChange={e => setHasNarrative(e.target.checked)}
              className="w-4 h-4 rounded" style={{ accentColor: colors.primary }} />
            <span className="text-sm text-gray-700">Incluir cuadro de texto (narrativa)</span>
          </label>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Tabla de datos</label>
            <FancyDropdown
              value={tableType}
              options={TABLE_TYPE_LIST}
              onChange={setTableType}
            />
            {tableType !== "none" && TABLE_TYPES[tableType]?.columns?.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-1.5">
                Columnas: {TABLE_TYPES[tableType].columns.map(c => c.label).join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-100">
            Cancelar
          </button>
          <button onClick={() => onCreate({ title, description, hasNarrative, tableType })}
            disabled={!canCreate}
            className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-white disabled:opacity-40" style={{ background: colors.primary }}>
            Crear epígrafe
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FancyDropdown — dropdown custom para el pop-up de formato ────
function FancyDropdown({ value, options, onChange, renderOption, width }) {
  const { colors } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const current = options.find(o => String(o.v) === String(value));
  return (
    <div ref={ref} className="relative" style={{ width: width || "100%" }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm bg-white transition-colors"
        style={{ borderColor: open ? colors.primary : "#e5e7eb" }}>
        <span className="truncate" style={renderOption ? renderOption(current) : undefined}>{current?.n ?? "—"}</span>
        <ChevronDown size={15} className="text-gray-400 flex-shrink-0" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-xl py-1">
          {options.map(o => {
            const active = String(o.v) === String(value);
            return (
              <button key={o.v} type="button"
                onClick={() => { onChange(o.v); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-50 flex items-center justify-between"
                style={{ color: active ? colors.primary : "#374151", fontWeight: active ? 800 : 500, ...(renderOption ? renderOption(o) : {}) }}>
                <span className="truncate">{o.n}</span>
                {active && <Check size={13} style={{ color: colors.primary }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NarrativeEditor({ note, rows, columns, pivot, onChange, textSettings }) {
  const edRef = useRef(null);
  const savedRange = useRef(null);
  const font = textSettings?.font ?? NARR_FONTS[0].v;
  const size = String(textSettings?.size ?? 16);
  const spacing = String(textSettings?.spacing ?? 1.75);
  const weight = textSettings?.weight ?? 400;
  const [picker, setPicker] = useState(null);

  const template = note.default_narrative ?? note.narrative ?? "";

  const rowLabel = useCallback((rid) => {
    const r = rows.find((x) => String(x.id) === String(rid));
    return r ? (r.label ?? r.name ?? rid) : rid;
  }, [rows]);

const renderHtml = useCallback((tpl) => {
    // Formato nuevo {{rid|cid}} y compat con el antiguo {{rid.cid}}.
    return String(tpl || "").replace(/\{\{([^{}]+?)\}\}/g, (m, inner) => {
      let rid, cid;
      if (inner.includes("|")) {
        const bar = inner.lastIndexOf("|");
        rid = inner.slice(0, bar); cid = inner.slice(bar + 1);
      } else {
        // Legacy: separado por punto; el cid legacy termina en _col_<algo>.
        const dot = inner.lastIndexOf(".");
        if (dot < 0) return m;
        rid = inner.slice(0, dot); cid = inner.slice(dot + 1);
      }
      const val = pivot.get(`${rid}|${cid}`);
      return `<span data-var="${rid}|${cid}" contenteditable="false" title="${rowLabel(rid)}" style="display:inline-flex;padding:1px 7px;margin:0 1px;border-radius:6px;background:#E7F6EF;color:#0B7A54;font-family:'Inter',sans-serif;font-weight:700;font-size:0.92em;cursor:pointer;">${fmtVal(val)}</span>`;
    });
  }, [pivot, rowLabel]);

  useEffect(() => {
    if (!edRef.current || document.activeElement === edRef.current) return;
    edRef.current.innerHTML = renderHtml(template) || '<p style="color:#9CA3AF;font-style:italic">Escribe el texto de la memoria… usa “Variable” para insertar valores de la tabla.</p>';
  }, [template, renderHtml]);

  useEffect(() => {
    if (!edRef.current) return;
    edRef.current.querySelectorAll("[data-var]").forEach((el) => {
      el.style.animation = "none"; void el.offsetWidth; el.style.animation = "mnVarPulse 1s ease-out";
    });
  }, [pivot]);

  const saveSel = () => { const s = window.getSelection(); if (s.rangeCount) savedRange.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { if (savedRange.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange.current); } };

const serialize = () => {
    if (!edRef.current) return template;
    const clone = edRef.current.cloneNode(true);
    clone.querySelectorAll("[data-var]").forEach((el) => el.replaceWith(document.createTextNode(`{{${el.getAttribute("data-var")}}}`)));
    let html = clone.innerHTML.replace(/<div>/g, "<p>").replace(/<\/div>/g, "</p>");
    // No persistir el placeholder como contenido real.
    const text = clone.textContent.replace(/\u00A0/g, " ").trim();
    if (text.startsWith("Escribe el texto de la memoria")) return "";
    return html;
  };
  const pushChange = () => onChange && onChange(serialize());
  const exec = (cmd, val) => { edRef.current.focus(); restore(); document.execCommand(cmd, false, val || null); saveSel(); pushChange(); };

  const openPicker = (e) => { saveSel(); const r = e.currentTarget.getBoundingClientRect(); setPicker({ x: Math.min(r.left, window.innerWidth - 360), y: r.bottom + 6 }); };
const insertVar = (rid, cid, val) => {
    if (!edRef.current) return;
    edRef.current.focus(); restore();
    const chip = document.createElement("span");
chip.setAttribute("data-var", `${rid}|${cid}`); chip.setAttribute("contenteditable", "false");
    chip.title = rowLabel(rid); chip.textContent = fmtVal(val);
    Object.assign(chip.style, { display: "inline-flex", padding: "1px 7px", margin: "0 1px", borderRadius: "6px", background: "#E7F6EF", color: "#0B7A54", fontFamily: "'Inter',sans-serif", fontWeight: "700", fontSize: "0.92em", cursor: "pointer" });
    const sel = window.getSelection();
    // Sólo insertar en la selección si está DENTRO del editor; si no (p.ej. el foco
    // estaba en el título del índice), añadir al final del editor para no inyectar
    // el chip en otro elemento del DOM.
    const anchor = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
    const insideEditor = anchor && edRef.current.contains(anchor);
    if (insideEditor) {
      const rg = sel.getRangeAt(0);
      rg.deleteContents(); rg.insertNode(chip);
      const sp = document.createTextNode("\u00A0");
      chip.after(sp); rg.setStartAfter(sp); rg.collapse(true);
      sel.removeAllRanges(); sel.addRange(rg);
    } else {
      edRef.current.appendChild(chip);
      edRef.current.appendChild(document.createTextNode("\u00A0"));
    }
    setPicker(null); pushChange();
  };

const tbBtn = { width: 32, height: 32, borderRadius: 7, display: "grid", placeItems: "center", color: "#5A5F6E", background: "none", border: "none", cursor: "pointer" };

  return (
    <div>
      <style>{`@keyframes mnVarPulse{0%{background:#BFE9D5}100%{background:#E7F6EF}}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "7px 9px", background: "#fff", border: "1px solid #E5E7EB", borderRadius: "12px 12px 0 0", borderBottom: "none", flexWrap: "wrap" }}>
<button style={tbBtn} title="Negrita" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}><Bold size={15} /></button>
        <button style={tbBtn} title="Cursiva" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}><Italic size={15} /></button>
        <button style={tbBtn} title="Subrayado" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}><Underline size={15} /></button>
      {rows.length > 0 && columns.length > 0 && (
          <button onMouseDown={(e) => { e.preventDefault(); openPicker(e); }} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 8, background: "#E7F6EF", color: "#0F9B6C", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}><Sparkles size={14} /> Variable</button>
        )}
      </div>
      <div ref={edRef} contentEditable suppressContentEditableWarning onInput={pushChange} onMouseUp={saveSel} onKeyUp={saveSel}
style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: "0 0 12px 12px", padding: "22px 26px", minHeight: 150, outline: "none", fontFamily: font, fontSize: size + "px", lineHeight: spacing, fontWeight: weight, color: "#22252E" }} />
      {picker && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setPicker(null)} />
          <div style={{ position: "fixed", left: picker.x, top: picker.y, zIndex: 50, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, boxShadow: "0 12px 32px rgba(20,24,40,.14)", width: 340, overflow: "hidden" }}>
            <div style={{ padding: "13px 15px 9px", borderBottom: "1px solid #F1F2F6" }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Insertar variable</h4>
              <p style={{ fontSize: 11.5, color: "#9298A6", margin: "2px 0 0" }}>Mostrará el valor de la tabla y se actualizará solo.</p>
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto", padding: 6 }}>
              {rows.flatMap((row) => columns.map((col) => (
                <div key={row.id + col.id} onClick={() => insertVar(row.id, col.id, pivot.get(`${row.id}|${col.id}`))}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#EEF0FA")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{row.label ?? row.name}</div>
                    <div style={{ fontSize: 10.5, color: "#9298A6" }}>{col.label}</div>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F9B6C", fontVariantNumeric: "tabular-nums" }}>{fmtVal(pivot.get(`${row.id}|${col.id}`))}</span>
                </div>
              )))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//   AUTO-GENERATION ENGINE
//   Builds a pivot keyed by `${rowId}|${colId}` from uploaded-accounts.
// ═══════════════════════════════════════════════════════════════════════
function buildPivot({ note, rows, columns, sources, overrides }) {
  // sources lleva rolled + raw por bucket; raw es el fallback de prefix-match.
  const {
    curBalance, curBalanceRaw, prevBalance, prevBalanceRaw,
    curPyg,     curPygRaw,     prevPyg,     prevPygRaw,
    curCashflow, curCashflowRaw, prevCashflow, prevCashflowRaw,
  } = sources;
  const noteSource = note?.source_type ?? "balance";
  const pivot = new Map();

  const pickPair = (colSource) => {
    const s = colSource ?? noteSource;
    if (s === "pyg") {
      return { cur: curPyg, curRaw: curPygRaw, prev: prevPyg, prevRaw: prevPygRaw };
    }
    if (s === "cashflow") {
      return { cur: curCashflow, curRaw: curCashflowRaw, prev: prevCashflow, prevRaw: prevCashflowRaw };
    }
    return { cur: curBalance, curRaw: curBalanceRaw, prev: prevBalance, prevRaw: prevBalanceRaw };
  };

  rows.forEach(row => {
    if (row.is_total) return;
    const codes = row.account_codes ?? [];
    if (codes.length === 0) return;

columns.forEach(col => {
      const key = `${row.id}|${col.id}`;
      // Edición manual del usuario gana sobre el valor calculado.
      // Como pivot.get(key) es un número finito (no NaN), la pasada de
      // fórmulas lo respeta y los totales lo recogen automáticamente.
      if (overrides?.has(key)) {
        pivot.set(key, overrides.get(key));
        return;
      }
      const { cur, curRaw, prev, prevRaw } = pickPair(col.source_type);
      let value = 0;

      switch (col.col_type) {
        case "opening":
          value = sumCodes(prev, codes, prevRaw);
          break;
case "closing":
          // Diferido. Closing = opening + additions − disposals + transfers
          // se calcula en una segunda pasada (más abajo). Si no hay columnas
          // de movimiento, fallback a la suma directa del periodo actual.
          // Si col.formula está definida, la pasada de fórmulas también lo
          // procesa porque el sentinel es NaN.
          value = NaN;
          break;
        case "pyg_current":
          value = sumCodes(curPyg, codes, curPygRaw);
          break;
        case "pyg_prev":
          value = sumCodes(prevPyg, codes, prevPygRaw);
          break;
        case "addition":
        case "disposal":
        case "transfer":
        case "movement": {
          const curT  = sumCodes(cur,  codes, curRaw);
          const prevT = sumCodes(prev, codes, prevRaw);
          const delta = curT - prevT;
          if (col.col_type === "addition")      value = delta > 0 ? delta : 0;
          else if (col.col_type === "disposal") value = delta < 0 ? Math.abs(delta) : 0;
          else value = 0;
          break;
        }
        case "balance_delta":
          value = sumCodes(curBalance, codes, curBalanceRaw) - sumCodes(prevBalance, codes, prevBalanceRaw);
          break;
        case "treasury_opening":
          value = sumCodes(prevBalance, codes.length ? codes : ["57"], prevBalanceRaw);
          break;
        case "treasury_closing":
          value = sumCodes(curBalance, codes.length ? codes : ["57"], curBalanceRaw);
          break;
        case "depreciation": {
          const depCodes = (row.depreciation_codes && row.depreciation_codes.length)
            ? row.depreciation_codes
            : codes.flatMap(c => {
                const s = String(c);
                return s.length >= 2 ? ["28" + s.slice(1), "29" + s.slice(1)] : [];
              });
          value = sumCodes(curBalance, depCodes, curBalanceRaw);
          break;
        }
        case "manual":
          value = 0;
          break;
        default:
          value = 0;
      }
pivot.set(key, value);
    });

    // Roll-forward de "closing" sin fórmula:
    //   closing = opening + additions − disposals + transfers
    // usando los valores ya escritos en pivot para esta fila. Esto hace que
    // las ediciones manuales en Altas/Bajas/Saldo inicial se propaguen
    // automáticamente al Saldo final, y desde ahí a Valor neto vía su fórmula.
    // Si el override del propio closing está set, gana sobre todo el resto.
    columns.forEach(col => {
      if (col.col_type !== "closing" || col.formula) return;
      const key = `${row.id}|${col.id}`;
      if (overrides?.has(key)) return;
      let opening = 0, additions = 0, disposals = 0, transfers = 0;
      let hasMov = false;
      columns.forEach(c2 => {
        const v = pivot.get(`${row.id}|${c2.id}`) ?? 0;
        if (c2.col_type === "opening")  { opening   = v; hasMov = true; }
        if (c2.col_type === "addition") { additions = v; hasMov = true; }
        if (c2.col_type === "disposal") { disposals = v; hasMov = true; }
        if (c2.col_type === "transfer") { transfers = v; hasMov = true; }
      });
      if (hasMov) {
        pivot.set(key, opening + additions - disposals + transfers);
      } else {
        const { cur, curRaw } = pickPair(col.source_type);
        pivot.set(key, sumCodes(cur, codes, curRaw));
      }
    });
  });

  // Resolver fórmulas (igual que antes; nuevos tokens disponibles)
  rows.forEach(row => {
    if (row.is_total) return;
    columns.forEach(col => {
      if (!col.formula) return;
      const key = `${row.id}|${col.id}`;
      if (!Number.isNaN(pivot.get(key))) return;

      const colByType = new Map();
      columns.forEach(c => colByType.set(c.col_type, `${row.id}|${c.id}`));

      const env = {
        opening:          pivot.get(colByType.get("opening")) ?? 0,
        additions:        pivot.get(colByType.get("addition")) ?? 0,
        disposals:        pivot.get(colByType.get("disposal")) ?? 0,
        transfers:        pivot.get(colByType.get("transfer")) ?? 0,
        closing:          pivot.get(colByType.get("closing")) ?? 0,
        depreciation:     pivot.get(colByType.get("depreciation")) ?? 0,
        pyg_current:      pivot.get(colByType.get("pyg_current")) ?? 0,
        pyg_prev:         pivot.get(colByType.get("pyg_prev")) ?? 0,
        balance_delta:    pivot.get(colByType.get("balance_delta")) ?? 0,
        treasury_opening: pivot.get(colByType.get("treasury_opening")) ?? 0,
        treasury_closing: pivot.get(colByType.get("treasury_closing")) ?? 0,
      };

      let result = 0;
      try {
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

  // Totales
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

  // Filters
  const [year, setYear]           = useState(String(new Date().getFullYear() - 1));
  const [month, setMonth]         = useState("12");
const [sourceOverride, setSource]       = useState(null);
  const [structureOverride, setStructure] = useState(null);
  const [companyOverride, setCompany]     = useState(null);
  const defaultSource = useMemo(() => {
    if (sources.length === 0) return "";
    const s = sources[0];
    return typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s);
  }, [sources]);
  const defaultStructure = useMemo(() => {
    if (structures.length === 0) return "";
    const s = structures[0];
    return typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s);
  }, [structures]);
  const defaultCompany = useMemo(() => {
    if (companies.length === 0) return "";
    const c = companies[0];
    return typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c);
  }, [companies]);
  const source = sourceOverride ?? defaultSource;
  const structure = structureOverride ?? defaultStructure;
  const company = companyOverride ?? defaultCompany;
const [templateId, setTemplateId] = useState(null);
const [activeNoteId, setActiveNoteId] = useState(null);
  const [textSettings, setTextSettings] = useState({ font: NARR_FONTS[0].v, size: 16, spacing: 1.75, weight: 400 });
  const [textPopupOpen, setTextPopupOpen] = useState(false);
// Overrides manuales por nota. Map<noteId, Map<"rowId|colId", number>>.
  // null como valor elimina el override (la celda vuelve a su valor calculado).
const [overridesByNote, setOverridesByNote] = useState(() => new Map());

  // Data (declarado antes de los handlers que hacen setNotes)
  const [templates, setTemplates] = useState([]);
  const [notes, setNotes]         = useState([]);
  const [rows, setRows]           = useState([]); // ALL rows for current template
  const [cols, setCols]           = useState([]); // ALL cols for current template
  const [loadingTemplate, setLoadingTemplate] = useState(true);

// ── Persistencia de memorias (Supabase) ──
  // eslint-disable-next-line no-unused-vars
  const [saveId, setSaveId]         = useState(null);   // id del set actual, si existe
  const [saving, setSaving]         = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [loadingSave, setLoadingSave] = useState(false);
  const [lastSavedInfo, setLastSavedInfo] = useState(null); // { by, at } — se muestra en Fase E
  // Narrativas editadas por nota que aún no están en `notes`. Persistimos leyendo
  // de `notes[].default_narrative`, que es donde el editor escribe (onChange).

const handleCellEdit = useCallback((rowId, colId, value) => {
    if (!activeNoteId) return;
    setOverridesByNote(prev => {
      const next = new Map(prev);
      const noteOv = new Map(next.get(activeNoteId) ?? new Map());
      const key = `${rowId}|${colId}`;
      if (value === null) noteOv.delete(key);
      else noteOv.set(key, value);
      if (noteOv.size === 0) next.delete(activeNoteId);
      else next.set(activeNoteId, noteOv);
      return next;
    });
  }, [activeNoteId]);

  // ── Edición de filas de tabla (Fase B) ────────────────────────────
  // custom_rows de cada nota es un array de operaciones aplicadas sobre las
  // filas de plantilla: { op:"add", id, label, after }, { op:"rename", id, label },
  // { op:"hide", id }. Se guarda en note._custom_rows y se persiste en jsonb.
  const mutateCustomRows = useCallback((fn) => {
    if (!activeNoteId) return;
    setNotes(prev => prev.map(n => {
      if (n.id !== activeNoteId) return n;
      const current = Array.isArray(n._custom_rows) ? n._custom_rows : [];
      return { ...n, _custom_rows: fn(current) };
    }));
  }, [activeNoteId]);

  const addCustomRow = useCallback((afterRowId, label) => {
    const id = `custom-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    mutateCustomRows(ops => [...ops, { op: "add", id, label: label || "Nueva fila", after: afterRowId ?? null }]);
  }, [mutateCustomRows]);

  const renameRow = useCallback((rowId, label) => {
    mutateCustomRows(ops => {
      // Si es una fila custom "add", renombra in situ; si es de plantilla, añade/actualiza un "rename".
      const isCustomAdd = ops.some(o => o.op === "add" && o.id === rowId);
      if (isCustomAdd) return ops.map(o => (o.op === "add" && o.id === rowId) ? { ...o, label } : o);
      const others = ops.filter(o => !(o.op === "rename" && o.id === rowId));
      return [...others, { op: "rename", id: rowId, label }];
    });
  }, [mutateCustomRows]);

const enableTable = useCallback(() => {
    if (!activeNoteId) return;
    setNotes(prev => prev.map(n => n.id === activeNoteId ? { ...n, _table_enabled: true } : n));
  }, [activeNoteId]);

  // Crear un epígrafe personalizado (número 26+). config: { title, description,
  // hasNarrative, tableType }. Vive en el estado `notes` y persiste como custom.
  const addCustomNote = useCallback((config) => {
    const maxNum = notes.reduce((m, n) => Math.max(m, n.note_number ?? 0), 0);
    const num = Math.max(25, maxNum) + 1;
    const tableType = config.tableType ?? "none";
    const hasTable = tableType !== "none";
    const id = `custom-note-${Date.now()}`;
    const newNote = {
      id,
      note_number: num,
      title: config.title?.trim() || `Epígrafe ${num}`,
      description: config.description?.trim() || "",
      default_narrative: "",
      has_table: hasTable,
      is_required: false,
      _is_custom_note: true,
      _custom_title: config.title?.trim() || `Epígrafe ${num}`,
      _custom_description: config.description?.trim() || "",
      _has_narrative: config.hasNarrative !== false,
      _table_type: tableType,
      _table_enabled: hasTable,
      _custom_rows: [],
      _cell_variables: {},
    };
    setNotes(prev => [...prev, newNote]);
    setActiveNoteId(id);
  }, [notes]);

  const deleteCustomNote = useCallback((noteId) => {
    setNotes(prev => {
      const filtered = prev.filter(n => n.id !== noteId);
      return filtered;
    });
    setActiveNoteId(prev => {
      if (prev !== noteId) return prev;
      const remaining = notes.filter(n => n.id !== noteId);
      return remaining.length ? remaining[0].id : null;
    });
  }, [notes]);

  const [addNoteModal, setAddNoteModal] = useState(false);

const deleteRow = useCallback((rowId) => {
    mutateCustomRows(ops => {
      const isCustomAdd = ops.some(o => o.op === "add" && o.id === rowId);
      if (isCustomAdd) {
        // Eliminar una fila custom = quitar su "add" (y cualquier rename suyo).
        return ops.filter(o => o.id !== rowId);
      }
      // Fila de plantilla: marcar "hide" (sin duplicar).
      if (ops.some(o => o.op === "hide" && o.id === rowId)) return ops;
      return [...ops, { op: "hide", id: rowId }];
    });
    // Limpiar del texto las referencias {{rowId.colId}} de esa fila, y sus variables
    // y overrides de celda — la fila ya no existe, sus referencias no deben quedar.
    if (!activeNoteId) return;
const escId = String(rowId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // colId puede contener ":" (p.ej. pgc_normal:nota_07_col_addition), así que
    // aceptamos cualquier cosa que no sea "}" tras el punto separador.
    const refRe = new RegExp(`\\{\\{${escId}\\.[^}]+\\}\\}`, "g");
    setNotes(prev => prev.map(n => {
      if (n.id !== activeNoteId) return n;
      const narr = (n.default_narrative ?? n.narrative ?? "").replace(refRe, "");
      const cv = { ...(n._cell_variables || {}) };
      Object.keys(cv).forEach(k => { if (k.startsWith(`${rowId}|`)) delete cv[k]; });
      return { ...n, default_narrative: narr, _cell_variables: cv };
    }));
    setOverridesByNote(prev => {
      const noteOv = prev.get(activeNoteId);
      if (!noteOv) return prev;
      let changed = false;
      const m = new Map(noteOv);
      m.forEach((_, k) => { if (k.startsWith(`${rowId}|`)) { m.delete(k); changed = true; } });
      if (!changed) return prev;
      const next = new Map(prev);
      if (m.size === 0) next.delete(activeNoteId); else next.set(activeNoteId, m);
      return next;
    });
  }, [mutateCustomRows, activeNoteId]);

  // Aplica las ops de custom_rows sobre las filas base de plantilla → filas a renderizar.
  const applyCustomRows = useCallback((baseRows, customOps) => {
    const ops = Array.isArray(customOps) ? customOps : [];
    const hidden = new Set(ops.filter(o => o.op === "hide").map(o => String(o.id)));
    const renames = new Map(ops.filter(o => o.op === "rename").map(o => [String(o.id), o.label]));
    // 1) Filas de plantilla, sin ocultas, con renombrados aplicados.
    let out = (baseRows || [])
      .filter(r => !hidden.has(String(r.id)))
      .map(r => renames.has(String(r.id)) ? { ...r, label: renames.get(String(r.id)), _renamed: true } : r);
    // 2) Insertar las filas "add" en su posición (after). Las sin `after` van al final.
    ops.filter(o => o.op === "add").forEach(o => {
      const newRow = { id: o.id, label: o.label, level: 0, is_total: false, _custom: true };
      if (o.after == null) { out = [...out, newRow]; return; }
      const idx = out.findIndex(r => String(r.id) === String(o.after));
      if (idx < 0) out = [...out, newRow];
      else out = [...out.slice(0, idx + 1), newRow, ...out.slice(idx + 1)];
    });
    return out;
}, []);

const [currentRows, setCurrentRows] = useState([]); // uploaded-accounts current period
  const [prevRows, setPrevRows]       = useState([]); // uploaded-accounts prev period
const [groupAccounts, setGroupAccounts] = useState([]); // chart of accounts del grupo
  const [cfMapping, setCfMapping] = useState([]); // mapped-cashflow-accounts
  const [loadingData, setLoadingData] = useState(false);

  // Defaults from props

// Load templates list
  useEffect(() => {
    sbGet("memory", "templates?select=*&order=sort_order.asc&scope=eq.individual").then(d => {
      if (Array.isArray(d)) {
        setTemplates(d);
        // Default to first available template only if none selected yet
        if (!templateId && d.length > 0) {
          setTemplateId(d[0].id);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

// Load chart of accounts (group-accounts) — para clasificar por AccountType real
  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/v2/group-accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    })
      .then(r => r.ok ? r.json() : { value: [] })
      .then(j => {
        const arr = j.value ?? (Array.isArray(j) ? j : []);
        setGroupAccounts(arr);
      })
      .catch(() => setGroupAccounts([]));
  }, [token]);

  // Load cash-flow mapping (group account → CF account)
  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/v2/mapped-cashflow-accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    })
      .then(r => r.ok ? r.json() : { value: [] })
      .then(j => {
        const arr = j.value ?? (Array.isArray(j) ? j : []);
        setCfMapping(arr);
      })
      .catch(() => setCfMapping([]));
  }, [token]);

// Load notes + rows + cols for current template
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setLoadingTemplate(true); });
    Promise.all([
      sbGet("memory", `template_notes?select=*&template_id=eq.${templateId}&order=sort_order.asc`),
sbGet("memory", `template_rows?select=*&note_id=like.${templateId}%3A*&order=sort_order.asc`),
sbGet("memory", `template_columns?select=*&note_id=like.${templateId}%3A*&order=sort_order.asc`),
]).then(([n, r, c]) => {
const dedupeBy = (arr, keyFn) => {
        if (!Array.isArray(arr)) return [];
        const seen = new Set();
        return arr.filter(x => {
          const k = keyFn(x);
          if (k == null || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };

      // 1) Dedupe notes by note_number — keep the first occurrence
      const uniqNotes = dedupeBy(n, x => x?.note_number);

      // 2) Build a map: note_number -> kept note id
      const keptIdByNumber = new Map(uniqNotes.map(x => [x.note_number, x.id]));
      // And a map from ANY duplicate note id -> kept note id, so we can
      // remap orphaned rows/cols whose note_id points to a dropped duplicate.
      const remapNoteId = new Map();
      (Array.isArray(n) ? n : []).forEach(note => {
        const keptId = keptIdByNumber.get(note?.note_number);
        if (keptId) remapNoteId.set(note.id, keptId);
      });

      // 3) Remap rows/cols' note_id to the kept note id, then dedupe by
      //    (note_id, sort_order, label) so true duplicates collapse but
      //    legitimately distinct rows survive.
      const remap = (arr) => (Array.isArray(arr) ? arr : []).map(x => ({
        ...x,
        note_id: remapNoteId.get(x.note_id) ?? x.note_id,
      }));
      const uniqRows = dedupeBy(
        remap(r),
        x => `${x.note_id}|${x.sort_order ?? ""}|${x.label ?? ""}`
      );
      const uniqCols = dedupeBy(
        remap(c),
        x => `${x.note_id}|${x.sort_order ?? ""}|${x.label ?? ""}`
      );
// Preserva la narrativa original de plantilla en _original_narrative para el reset.
      setNotes(uniqNotes.map(n => ({ ...n, _original_narrative: n.default_narrative ?? n.narrative ?? "" })));
      setRows(uniqRows);
      setCols(uniqCols);
      if (uniqNotes.length > 0) {
        setActiveNoteId(prev => (prev && uniqNotes.find(x => x.id === prev)) ? prev : uniqNotes[0].id);
      }
setLoadingTemplate(false);
    });
    return () => { cancelled = true; };
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
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setLoadingData(true); });
    Promise.all([
      fetchUploaded(year, month),
      fetchUploaded(String(parseInt(year) - 1), month),
    ]).then(([cur, prev]) => {
      setCurrentRows(cur);
setPrevRows(prev);
      setLoadingData(false);
    });
    return () => { cancelled = true; };
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
const activeRows = useMemo(
    () => activeNote ? (rowsByNote.get(activeNote.id) ?? []) : [],
    [activeNote, rowsByNote]
  );
  // Filas a renderizar = filas de plantilla + operaciones custom (add/rename/hide).
const activeRowsCustom = useMemo(
    () => applyCustomRows(activeRows, activeNote?._custom_rows),
    [activeRows, activeNote, applyCustomRows]
  );
const activeCols = useMemo(
    () => activeNote ? (colsByNote.get(activeNote.id) ?? []) : [],
    [activeNote, colsByNote]
  );
  // Tabla activada manualmente (Fase C): nota sin filas/cols de plantilla pero con
  // _table_enabled. Generamos una columna "Valor" y una fila de total por defecto,
  // sobre las que operan las filas custom (add/rename/hide) igual que una tabla normal.
const tableManuallyEnabled = !!activeNote?._table_enabled && (activeRows.length === 0 || activeCols.length === 0 || !!activeNote?._is_custom_note);
  const DEFAULT_TOTAL_ID = "custom-total";
const effectiveCols = useMemo(() => {
    if (!tableManuallyEnabled) return activeCols;
    // Epígrafe custom con un tipo de tabla elegido → usa sus columnas.
    const tt = activeNote?._table_type;
    if (tt && TABLE_TYPES[tt] && TABLE_TYPES[tt].columns.length > 0) {
      return TABLE_TYPES[tt].columns.map(c => ({ ...c }));
    }
    // Por defecto (tabla activada a mano sin tipo): formato de movimiento.
    return [
      { id: "custom-opening",  label: "Saldo inicial", col_type: "opening"  },
      { id: "custom-addition", label: "Altas",         col_type: "addition" },
      { id: "custom-disposal", label: "Bajas",         col_type: "disposal" },
      { id: "custom-transfer", label: "Traspasos",     col_type: "transfer" },
      { id: "custom-closing",  label: "Saldo final",   col_type: "closing"  },
    ];
  }, [tableManuallyEnabled, activeCols, activeNote]);
  const effectiveRows = useMemo(() => {
    if (!tableManuallyEnabled) return activeRowsCustom;
    // filas custom + una fila de total al final
    const customOps = Array.isArray(activeNote?._custom_rows) ? activeNote._custom_rows : [];
    const base = applyCustomRows([], customOps);
    return [...base, { id: DEFAULT_TOTAL_ID, label: "Total", level: 0, is_total: true }];
  }, [tableManuallyEnabled, activeRowsCustom, activeNote, applyCustomRows]);

  // ── Guardar / cargar memorias en Supabase ─────────────────────────
  // Clave del set: company + year + month + structure + source + template_id.
  // Guardar sobre la MISMA clave sobreescribe; cambiar cualquiera crea otro set.
  const saveKey = useMemo(() => ({
    company, year: Number(year), month: Number(month), structure, source, template_id: templateId,
  }), [company, year, month, structure, source, templateId]);

  const saveKeyReady = !!(company && year && month && structure && source && templateId);

  // Serializa un Map<"rowId|colId", number> a objeto plano para jsonb.
  const serializeOverrides = useCallback((noteId) => {
    const m = overridesByNote.get(noteId);
    if (!m || m.size === 0) return {};
    const out = {};
    m.forEach((v, k) => { out[k] = v; });
    return out;
  }, [overridesByNote]);

const loadTextSettings = useCallback(async () => {
    if (!company) return;
    try {
      const rows = await sbMemAuth("GET", `memory_company_settings?select=text_settings&company=eq.${encodeURIComponent(company)}&limit=1`);
      const ts = Array.isArray(rows) && rows[0]?.text_settings ? rows[0].text_settings : null;
      if (ts && Object.keys(ts).length) setTextSettings(s => ({ ...s, ...ts }));
    } catch (e) { console.error("[loadTextSettings]", e); }
  }, [company]);

  const saveTextSettings = useCallback(async (next) => {
    if (!company) return;
    setTextSettings(next);
    try {
      const user = await getMemUser();
      await sbMemAuth("POST", `memory_company_settings?on_conflict=company`, {
        body: { company, text_settings: next, updated_at: new Date().toISOString(), updated_by: user.id, updated_by_name: user.name },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (e) { console.error("[saveTextSettings]", e); }
  }, [company]);

const textSettingsLoadedRef = useRef(null);
  useEffect(() => {
    if (!company || textSettingsLoadedRef.current === company) return;
    textSettingsLoadedRef.current = company;
    loadTextSettings();
  }, [company, loadTextSettings]);

  const saveMemories = useCallback(async () => {
    if (!saveKeyReady) return;
    setSaving(true);
    try {
      const user = await getMemUser();
      // 1) Upsert del set (memory_saves) por la clave única. resolution=merge-duplicates
      //    + on_conflict con las 6 columnas → sobreescribe el set existente.
      const nowIso = new Date().toISOString();
      const savePayload = {
        ...saveKey,
        updated_at: nowIso,
        updated_by: user.id,
        updated_by_name: user.name,
      };
      const conflictCols = "company,year,month,structure,source,template_id";
      const savedRows = await sbMemAuth(
        "POST",
        `memory_saves?on_conflict=${conflictCols}`,
        { body: savePayload, prefer: "resolution=merge-duplicates,return=representation" }
      );
      const setRow = Array.isArray(savedRows) ? savedRows[0] : savedRows;
      const sid = setRow?.id;
      if (!sid) throw new Error("No se pudo obtener el id del set guardado.");
      setSaveId(sid);

      // 2) Upsert del estado por nota (memory_note_state). Una fila por epígrafe
      //    que tenga contenido (narrativa editada u overrides).
      const statePayload = notes.map(n => {
        const overrides = serializeOverrides(n.id);
        const narrative = n.default_narrative ?? n.narrative ?? null;
return {
          save_id: sid,
          note_number: n.note_number,
          narrative,
          cell_overrides: overrides,
          custom_rows: n._custom_rows ?? [],
          cell_variables: n._cell_variables ?? {},
          table_enabled: !!n._table_enabled,
          // Epígrafes personalizados (26+): guardar su metadata para recrearlos al cargar.
          is_custom: !!n._is_custom_note,
          custom_title: n._is_custom_note ? (n._custom_title ?? n.title) : null,
          custom_description: n._is_custom_note ? (n._custom_description ?? n.description ?? "") : null,
          has_narrative: n._is_custom_note ? (n._has_narrative !== false) : true,
          table_type: n._is_custom_note ? (n._table_type ?? "none") : null,
          updated_at: nowIso,
        };
      });
      if (statePayload.length > 0) {
        await sbMemAuth(
          "POST",
          `memory_note_state?on_conflict=save_id,note_number`,
          { body: statePayload, prefer: "resolution=merge-duplicates,return=minimal" }
        );
      }
      setLastSavedInfo({ by: user.name, at: nowIso });
    } catch (err) {
      console.error("[saveMemories] error:", err);
      alert("No se pudieron guardar las memorias: " + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }, [saveKeyReady, saveKey, notes, serializeOverrides]);

  // Carga el set guardado (si existe) al cambiar la clave. Hidrata narrativas y overrides.
  const hydrateFromSave = useCallback((states) => {
    if (!Array.isArray(states)) return;
    // Overrides → Map<noteId, Map<key, number>>, resolviendo note_number → note.id
    const idByNumber = new Map(notes.map(n => [n.note_number, n.id]));
    setOverridesByNote(() => {
      const next = new Map();
      states.forEach(s => {
        const noteId = idByNumber.get(s.note_number);
        if (!noteId) return;
        const ov = s.cell_overrides || {};
        const keys = Object.keys(ov);
        if (keys.length === 0) return;
        const m = new Map();
        keys.forEach(k => m.set(k, ov[k]));
        next.set(noteId, m);
      });
      return next;
    });
// Narrativas + campos de fases B-D → sobre `notes`; y recrear epígrafes custom.
    setNotes(prev => {
      const updated = prev.map(n => {
        const s = states.find(x => x.note_number === n.note_number);
        if (!s) return n;
        return {
          ...n,
          default_narrative: s.narrative ?? n.default_narrative,
          _custom_rows: s.custom_rows ?? [],
          _cell_variables: s.cell_variables ?? {},
          _table_enabled: !!s.table_enabled,
        };
      });
      // Epígrafes personalizados guardados (is_custom) que no están ya en la lista.
      const existingNums = new Set(updated.map(n => n.note_number));
      const customStates = states.filter(s => s.is_custom && !existingNums.has(s.note_number));
      const recreated = customStates.map(s => {
        const tt = s.table_type ?? "none";
        const hasTable = tt !== "none";
        return {
          id: `custom-note-${s.note_number}-${s.save_id ?? "x"}`,
          note_number: s.note_number,
          title: s.custom_title ?? `Epígrafe ${s.note_number}`,
          description: s.custom_description ?? "",
          default_narrative: s.narrative ?? "",
          has_table: hasTable,
          is_required: false,
          _is_custom_note: true,
          _custom_title: s.custom_title ?? `Epígrafe ${s.note_number}`,
          _custom_description: s.custom_description ?? "",
          _has_narrative: s.has_narrative !== false,
          _table_type: tt,
          _table_enabled: hasTable,
          _custom_rows: s.custom_rows ?? [],
          _cell_variables: s.cell_variables ?? {},
        };
      });
      return [...updated, ...recreated].sort((a, b) => (a.note_number ?? 0) - (b.note_number ?? 0));
    });
  }, [notes]);

  const loadMemories = useCallback(async () => {
    if (!saveKeyReady || notes.length === 0) return;
    setLoadingSave(true);
    try {
      const q = `company=eq.${encodeURIComponent(saveKey.company)}`
        + `&year=eq.${saveKey.year}&month=eq.${saveKey.month}`
        + `&structure=eq.${encodeURIComponent(saveKey.structure)}`
        + `&source=eq.${encodeURIComponent(saveKey.source)}`
        + `&template_id=eq.${encodeURIComponent(saveKey.template_id)}`;
      const found = await sbMemAuth("GET", `memory_saves?select=*&${q}&limit=1`);
      const setRow = Array.isArray(found) ? found[0] : null;
      if (!setRow) {
        // No hay set guardado para esta combinación → empezar limpio.
        setSaveId(null);
        setLastSavedInfo(null);
        setOverridesByNote(new Map());
        return;
      }
      setSaveId(setRow.id);
      setLastSavedInfo({ by: setRow.updated_by_name, at: setRow.updated_at });
      const states = await sbMemAuth(
        "GET",
        `memory_note_state?select=*&save_id=eq.${setRow.id}`
      );
      hydrateFromSave(states);
    } catch (err) {
      console.error("[loadMemories] error:", err);
    } finally {
      setLoadingSave(false);
    }
  }, [saveKeyReady, saveKey, notes, hydrateFromSave]);

// Carga automática del set guardado al cambiar la clave o al cargar las notas.
  const lastLoadedKeyRef = useRef(null);
  useEffect(() => {
    if (!saveKeyReady || notes.length === 0) return;
    const keyStr = JSON.stringify(saveKey);
    if (lastLoadedKeyRef.current === keyStr) return;
    lastLoadedKeyRef.current = keyStr;
    loadMemories();
  }, [saveKeyReady, saveKey, notes.length, loadMemories]);

// Hierarchy index del chart de cuentas grupo (incluye fallback a códigos
  // huérfanos que sólo aparecen en los postings).
  const parentOf = useMemo(
    () => buildParentOf(groupAccounts, currentRows, prevRows),
    [groupAccounts, currentRows, prevRows]
  );

// Cash flow mapping: groupCode → cfCode  y  cfChild → cfParent.
  const { cfCodeByGroupCode, cfParentOf } = useMemo(
    () => buildCfIndexes(cfMapping),
    [cfMapping]
  );

  // AccountCode → AccountType, desde el chart. Usado para clasificar los
  // postings cuando uploaded-accounts no trae el campo AccountType.
  const typeByCode = useMemo(() => {
    const m = new Map();
    (groupAccounts ?? []).forEach(a => {
      const code = a.AccountCode ?? a.accountCode;
      const type = a.AccountType ?? a.accountType;
      if (code != null && type) m.set(String(code), String(type));
    });
    return m;
  }, [groupAccounts]);

// Pivots por bucket. Guardamos rolled (con ancestros agregados) Y raw
  // (sólo postings) para que sumCodes pueda hacer prefix-fallback.
  const accountSources = useMemo(() => {
    const PYG_TYPES = ["P/L", "DIS"];
    const BS_TYPES  = ["B/S"];

    const curBalRaw  = buildPostingsPivot(currentRows, BS_TYPES,  typeByCode, parentOf);
    const prevBalRaw = buildPostingsPivot(prevRows,    BS_TYPES,  typeByCode, parentOf);
    const curPygRaw  = buildPostingsPivot(currentRows, PYG_TYPES, typeByCode, parentOf);
    const prevPygRaw = buildPostingsPivot(prevRows,    PYG_TYPES, typeByCode, parentOf);
    const curCfRaw   = buildCashflowPostingsPivot(currentRows, cfCodeByGroupCode);
    const prevCfRaw  = buildCashflowPostingsPivot(prevRows,    cfCodeByGroupCode);

    return {
      curBalance:      rollUpPivot(curBalRaw,  parentOf),
      curBalanceRaw:   curBalRaw,
      prevBalance:     rollUpPivot(prevBalRaw, parentOf),
      prevBalanceRaw:  prevBalRaw,
      curPyg:          rollUpPivot(curPygRaw,  parentOf),
      curPygRaw:       curPygRaw,
      prevPyg:         rollUpPivot(prevPygRaw, parentOf),
      prevPygRaw:      prevPygRaw,
      curCashflow:     rollUpPivot(curCfRaw,   cfParentOf),
      curCashflowRaw:  curCfRaw,
      prevCashflow:    rollUpPivot(prevCfRaw,  cfParentOf),
      prevCashflowRaw: prevCfRaw,
    };
}, [currentRows, prevRows, parentOf, typeByCode, cfCodeByGroupCode, cfParentOf]);

  // ── Variables de celda (Fase D) ───────────────────────────────────
  // Una variable = lista de términos { code, sign } sobre una fuente (balance/pyg).
  // Valor = Σ(sign × importe de la cuenta en el periodo actual). Se recalcula cada
  // periodo, así que al cambiar mes/año se actualiza sola.
  const resolveVariableValue = useCallback((variable) => {
    if (!variable || !Array.isArray(variable.terms) || variable.terms.length === 0) return 0;
    const src = variable.source === "pyg"
      ? { cur: accountSources.curPyg, raw: accountSources.curPygRaw }
      : { cur: accountSources.curBalance, raw: accountSources.curBalanceRaw };
    let total = 0;
    variable.terms.forEach(t => {
      const amt = sumCodes(src.cur, [t.code], src.raw);
      total += (t.sign < 0 ? -1 : 1) * amt;
    });
    return total;
  }, [accountSources]);

  // Lista de cuentas para el picker: [{ code, label }], desde el plan de cuentas.
  const accountItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    (groupAccounts || []).forEach(g => {
      const code = String(g.AccountCode ?? g.accountCode ?? "");
      if (!code || seen.has(code)) return;
      seen.add(code);
      const name = g.AccountName ?? g.accountName ?? "";
      items.push({ code, label: name ? `${code} — ${name}` : code });
    });
    return items.sort((a, b) => a.code.localeCompare(b.code));
  }, [groupAccounts]);

// Handler para asignar/quitar la variable de una celda de la nota activa.
  const setCellVariable = useCallback((rowId, colId, variable) => {
    if (!activeNoteId) return;
    setNotes(prev => prev.map(n => {
      if (n.id !== activeNoteId) return n;
      const cv = { ...(n._cell_variables || {}) };
      const key = `${rowId}|${colId}`;
      if (variable == null) delete cv[key];
      else cv[key] = variable;
      return { ...n, _cell_variables: cv };
    }));
  }, [activeNoteId]);

  // ── Reset (Fase E) ────────────────────────────────────────────────
  // Devuelve una nota a su punto de partida: narrativa original de plantilla,
  // sin overrides, sin filas custom, sin variables, sin tabla activada a mano.
  const resetNoteToOrigin = useCallback((noteId) => {
    setNotes(prev => prev.map(n => n.id === noteId ? {
      ...n,
      default_narrative: n._original_narrative ?? n.default_narrative,
      _custom_rows: [],
      _cell_variables: {},
      _table_enabled: false,
    } : n));
    setOverridesByNote(prev => {
      const next = new Map(prev);
      next.delete(noteId);
      return next;
    });
  }, []);

  const resetCurrentNote = useCallback(() => {
    if (activeNoteId) resetNoteToOrigin(activeNoteId);
  }, [activeNoteId, resetNoteToOrigin]);

  const resetAllNotes = useCallback(() => {
    setNotes(prev => prev.map(n => ({
      ...n,
      default_narrative: n._original_narrative ?? n.default_narrative,
      _custom_rows: [],
      _cell_variables: {},
      _table_enabled: false,
    })));
    setOverridesByNote(new Map());
  }, []);

  // Estado del diálogo de reset.
  const [resetDialog, setResetDialog] = useState(false);

  // Build pivot for active note
  const pivot = useMemo(() => {
    if (!activeNote || !activeNote.has_table) return new Map();
    if (currentRows.length === 0 && prevRows.length === 0) return new Map();
return buildPivot({
      note: activeNote,
      rows: activeRows,
      columns: activeCols,
      sources: accountSources,
      overrides: overridesByNote.get(activeNote.id) ?? null,
    });
}, [activeNote, activeRows, activeCols, accountSources, overridesByNote, currentRows.length, prevRows.length]);

  // Pivot efectivo: valor real de cada celda (variable > override > pivot base),
  // sobre las filas/columnas efectivas (incluye filas custom). Lo usa el editor de
  // narrativa para que el picker ofrezca TODAS las celdas y el valor correcto.
  const effectivePivot = useMemo(() => {
    const out = new Map(pivot); // parte del pivot base
    const ov = overridesByNote.get(activeNote?.id) ?? null;
    const cvars = activeNote?._cell_variables ?? null;
    // overrides
    if (ov) ov.forEach((v, k) => out.set(k, v));
    // variables de celda (ganan sobre override y pivot; se recalculan por periodo)
    if (cvars) {
      Object.entries(cvars).forEach(([k, variable]) => {
        out.set(k, resolveVariableValue(variable));
      });
    }
    // closing derivado de tablas custom (opening + altas − bajas + traspasos)
    const closingCol = effectiveCols.find(c => c.col_type === "closing");
    if (closingCol) {
      const byType = {};
      effectiveCols.forEach(c => { byType[c.col_type] = c.id; });
      effectiveRows.forEach(r => {
        if (r.is_total || r.is_subtotal) return;
        const ck = `${r.id}|${closingCol.id}`;
        if (ov?.has(ck)) return; // override manual del closing gana
        const val = (t) => byType[t] ? (out.get(`${r.id}|${byType[t]}`) ?? 0) : 0;
        out.set(ck, val("opening") + val("addition") - val("disposal") + val("transfer"));
      });
    }
    return out;
  }, [pivot, overridesByNote, activeNote, resolveVariableValue, effectiveCols, effectiveRows]);

  // Filter options
  const sourceOpts    = [...new Set(sources.map(s  => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const companyOpts = companies
    .map(c => typeof c === "object"
      ? { value: c.companyShortName ?? c.CompanyShortName ?? "", label: c.companyLegalName ?? c.CompanyLegalName ?? c.companyShortName ?? c.CompanyShortName ?? "" }
      : { value: String(c), label: String(c) })
    .filter(o => o.value);

// ─── Export handlers ────────────────────────────────────────────
  // Construye los datos COMPLETOS de exportación por nota: texto narrativo con las
  // variables resueltas a su valor, y la tabla efectiva (filas custom + columnas
  // efectivas + valores efectivos: variable > override > fórmula > closing > pivot).
  const buildExportData = useCallback(() => {
    return notes.map(n => {
      const ov = overridesByNote.get(n.id) ?? null;
      const cvars = n._cell_variables ?? null;
      const customOps = Array.isArray(n._custom_rows) ? n._custom_rows : [];
      const baseRows = rowsByNote.get(n.id) ?? [];
      const baseCols = colsByNote.get(n.id) ?? [];

      // ¿Tabla activada manualmente sin plantilla? → columnas de movimiento + total.
      const manual = !!n._table_enabled && (baseRows.length === 0 || baseCols.length === 0);
      let nCols, nRows;
      if (manual) {
        nCols = [
          { id: "custom-opening",  label: "Saldo inicial", col_type: "opening"  },
          { id: "custom-addition", label: "Altas",         col_type: "addition" },
          { id: "custom-disposal", label: "Bajas",         col_type: "disposal" },
          { id: "custom-transfer", label: "Traspasos",     col_type: "transfer" },
          { id: "custom-closing",  label: "Saldo final",   col_type: "closing"  },
        ];
        nRows = [...applyCustomRows([], customOps), { id: "custom-total", label: "Total", level: 0, is_total: true }];
      } else {
        nCols = baseCols;
        nRows = applyCustomRows(baseRows, customOps);
      }

      // Pivot base de esta nota (para valores calculados de plantilla).
      const basePivot = (baseRows.length && baseCols.length)
        ? buildPivot({ note: n, rows: baseRows, columns: baseCols, sources: accountSources, overrides: ov })
        : new Map();

      // Valor efectivo de una celda (misma prioridad que en pantalla).
      const colByType = {};
      nCols.forEach(c => { if (colByType[c.col_type] == null || !c.formula) colByType[c.col_type] = c.id; });
      const realClosingCol = nCols.find(c => c.col_type === "closing" && !c.formula);
      const closingId = realClosingCol?.id ?? colByType["closing"];
      const effVal = (rid, cid) => {
        const k = `${rid}|${cid}`;
        const o = ov?.get(k);
        if (o !== undefined && o !== null) return o;
        const vr = cvars?.[k] ?? null;
        if (vr) return resolveVariableValue(vr);
        return basePivot.get(k) ?? 0;
      };
      const cellValue = (row, col) => {
        if (row.is_total) {
          return nRows.reduce((s, r) => (r.is_total || r.is_subtotal) ? s : s + effVal(r.id, col.id), 0);
        }
        const ownOv = ov?.get(`${row.id}|${col.id}`);
        if (ownOv !== undefined && ownOv !== null) return ownOv;
        const vr = cvars?.[`${row.id}|${col.id}`] ?? null;
        if (vr) return resolveVariableValue(vr);
        if (col.formula) {
          const clo = closingId
            ? (ov?.get(`${row.id}|${closingId}`) != null ? ov.get(`${row.id}|${closingId}`)
               : effVal(row.id, colByType["opening"] ?? "") + effVal(row.id, colByType["addition"] ?? "") - effVal(row.id, colByType["disposal"] ?? "") + effVal(row.id, colByType["transfer"] ?? ""))
            : 0;
          const env = {
            opening: effVal(row.id, colByType["opening"] ?? ""), additions: effVal(row.id, colByType["addition"] ?? ""),
            disposals: effVal(row.id, colByType["disposal"] ?? ""), transfers: effVal(row.id, colByType["transfer"] ?? ""),
            closing: clo, depreciation: effVal(row.id, colByType["depreciation"] ?? ""),
            pyg_current: effVal(row.id, colByType["pyg_current"] ?? ""), pyg_prev: effVal(row.id, colByType["pyg_prev"] ?? ""),
            balance_delta: effVal(row.id, colByType["balance_delta"] ?? ""), treasury_opening: effVal(row.id, colByType["treasury_opening"] ?? ""),
            treasury_closing: effVal(row.id, colByType["treasury_closing"] ?? ""),
          };
          try { let e = col.formula; Object.entries(env).forEach(([k, v]) => { e = e.replaceAll(k, `(${Number.isFinite(v) ? v : 0})`); }); const r = Function(`"use strict"; return (${e})`)(); return Number.isFinite(r) ? r : 0; } catch { return 0; }
        }
        if (col.col_type === "closing" && !col.formula && closingId && ov?.get(`${row.id}|${closingId}`) == null) {
          return effVal(row.id, colByType["opening"] ?? "") + effVal(row.id, colByType["addition"] ?? "") - effVal(row.id, colByType["disposal"] ?? "") + effVal(row.id, colByType["transfer"] ?? "");
        }
        return effVal(row.id, col.id);
      };

      // Matriz de valores { rowId: { colId: number } } lista para pintar.
      const values = {};
      nRows.forEach(row => { values[row.id] = {}; nCols.forEach(col => { values[row.id][col.id] = cellValue(row, col); }); });

      // Narrativa con variables {{rid|cid}} (y legacy {{rid.cid}}) → valor formateado.
      const rawNarr = n.default_narrative ?? n.narrative ?? "";
      const resolvedNarrative = String(rawNarr).replace(/\{\{([^{}]+?)\}\}/g, (m, inner) => {
        let rid, cid;
        if (inner.includes("|")) { const b = inner.lastIndexOf("|"); rid = inner.slice(0, b); cid = inner.slice(b + 1); }
        else { const d = inner.lastIndexOf("."); if (d < 0) return m; rid = inner.slice(0, d); cid = inner.slice(d + 1); }
        const v = values[rid]?.[cid];
        const num = (v == null || v === 0) ? "—" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<b style="color:#0B7A54">${num}</b>`;
      });

      const hasTable = nRows.length > 0 && nCols.length > 0;
      return { note: n, rows: nRows, columns: nCols, values, resolvedNarrative, hasTable };
    });
  }, [notes, rowsByNote, colsByNote, accountSources, overridesByNote, applyCustomRows, resolveVariableValue]);

  const handleExportExcel = useCallback(async () => {
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js");
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Konsolidator";
      wb.created = new Date();

      const exportData = buildExportData();
      const tplLabel = templates.find(t => t.id === templateId)?.label ?? templateId;

const NAVY = "FF1A2F8A";
      const stripHtml = (h) => String(h ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      const monthName = new Date(2000, Number(month) - 1, 1).toLocaleDateString("es-ES", { month: "long" });

      // ── Portada ──
      const cover = wb.addWorksheet("Memoria");
      cover.columns = [{ width: 16 }, { width: 46 }, { width: 16 }, { width: 16 }];
      cover.getCell("A1").value = "KONSOLIDATOR";
      cover.getCell("A1").font = { size: 11, bold: true, color: { argb: NAVY } };
      cover.mergeCells("A3:D3");
      cover.getCell("A3").value = `Memoria económica — ${tplLabel}`;
      cover.getCell("A3").font = { size: 22, bold: true, color: { argb: NAVY } };
      const meta = [["Empresa", company], ["Periodo", `${monthName} de ${year}`], ["Source", source], ["Estructura", structure]];
      meta.forEach(([k, v], i) => {
        const row = 5 + i;
        cover.getCell(`A${row}`).value = k; cover.getCell(`A${row}`).font = { bold: true, color: { argb: NAVY } };
        cover.getCell(`B${row}`).value = v;
      });
      cover.getCell("A10").value = `Generado el ${new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      cover.getCell("A10").font = { size: 9, italic: true, color: { argb: "FF9CA3AF" } };
      // Índice
      cover.getCell("A12").value = "Índice de epígrafes";
      cover.getCell("A12").font = { size: 13, bold: true, color: { argb: NAVY } };
      exportData.forEach(({ note }, i) => {
        const row = 13 + i;
        cover.getCell(`A${row}`).value = note.note_number;
        cover.getCell(`A${row}`).font = { bold: true, color: { argb: NAVY } };
        cover.getCell(`A${row}`).alignment = { horizontal: "center" };
        cover.mergeCells(`B${row}:D${row}`);
        cover.getCell(`B${row}`).value = note.title;
      });

      exportData.forEach(({ note, rows: nRows, columns: nCols, values, resolvedNarrative, hasTable }) => {
        const sheetName = `N${note.note_number}`.slice(0, 31);
        const ws = wb.addWorksheet(sheetName);
        const lastCol = Math.max(nCols.length + 1, 2);

        ws.mergeCells(1, 1, 1, lastCol);
        ws.getCell(1, 1).value = `Nota ${note.note_number} — ${note.title}`;
        ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: NAVY } };

        let cursor = 2;
        if (note.description) {
          ws.mergeCells(cursor, 1, cursor, lastCol);
          ws.getCell(cursor, 1).value = note.description;
          ws.getCell(cursor, 1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
          cursor++;
        }
        const narrText = stripHtml(resolvedNarrative);
        if (narrText) {
          cursor++;
          ws.mergeCells(cursor, 1, cursor, lastCol);
          const nc = ws.getCell(cursor, 1);
          nc.value = narrText;
          nc.font = { size: 10, color: { argb: "FF374151" } };
          nc.alignment = { wrapText: true, vertical: "top" };
          ws.getRow(cursor).height = Math.min(120, 18 + Math.floor(narrText.length / 90) * 14);
          cursor++;
        }

        if (hasTable) {
          const headerRowIdx = cursor + 1;
          const headerRow = ws.getRow(headerRowIdx);
          headerRow.getCell(1).value = "Concepto";
          nCols.forEach((c, i) => { headerRow.getCell(i + 2).value = c.label; });
          headerRow.eachCell(cell => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
            cell.alignment = { vertical: "middle", horizontal: "center" };
          });

          nRows.forEach((row, ri) => {
            const r = ws.getRow(headerRowIdx + 1 + ri);
            r.getCell(1).value = row.label;
            if (row.is_total) r.getCell(1).font = { bold: true, color: { argb: NAVY } };
            nCols.forEach((c, ci) => {
              const v = values[row.id]?.[c.id] ?? 0;
              const cell = r.getCell(2 + ci);
              cell.value = v === 0 ? null : Number(v);
              cell.numFmt = '#,##0.00;[Red](#,##0.00);"—"';
              cell.alignment = { horizontal: "right" };
              if (row.is_total) {
                cell.font = { bold: true, color: { argb: NAVY } };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6FB" } };
              } else if (ri % 2 === 1) {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBFCFF" } };
              }
            });
          });

          ws.getColumn(1).width = 42;
          for (let i = 2; i <= lastCol; i++) ws.getColumn(i).width = 18;
        }
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
    const primary = colors?.primary ?? "#1A2F8A";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cell = (v) => {
      if (v == null || v === 0) return `<td class="num zero">—</td>`;
      const num = Number(v);
      const txt = Math.abs(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return num < 0 ? `<td class="num neg">(${txt})</td>` : `<td class="num">${txt}</td>`;
    };
    const monthName = new Date(2000, Number(month) - 1, 1).toLocaleDateString("es-ES", { month: "long" });
    const stamp = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const toc = exportData.map(({ note }) =>
      `<div class="toc-row"><span class="toc-n">${note.note_number}</span><span class="toc-t">${esc(note.title)}</span></div>`
    ).join("");

    const pages = exportData.map(({ note, rows: nRows, columns: nCols, values, resolvedNarrative, hasTable }) => `
      <section class="note-page">
        <div class="note-head">
          <span class="note-badge">${note.note_number}</span>
          <h2>${esc(note.title)}</h2>
        </div>
        ${note.description ? `<p class="desc">${esc(note.description)}</p>` : ""}
        ${resolvedNarrative ? `<div class="narrative">${resolvedNarrative}</div>` : ""}
        ${hasTable ? `
        <table>
          <thead>
            <tr>
              <th>Concepto</th>
              ${nCols.map(c => `<th class="num">${esc(c.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${nRows.map(r => `
              <tr class="${r.is_total ? "total" : ""}">
                <td>${esc(r.label)}</td>
                ${nCols.map(c => cell(values[r.id]?.[c.id])).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>` : ""}
      </section>
    `).join("");

    const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Memoria ${esc(company)} ${year}-${month}</title>
<style>
  @page { size: A4 portrait; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color:#1f2937; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .cover { height:calc(100vh - 32mm); display:flex; flex-direction:column; justify-content:center; page-break-after:always; }
  .cover .brand { font-size:12px; letter-spacing:3px; font-weight:800; color:${primary}; text-transform:uppercase; border-bottom:3px solid ${primary}; padding-bottom:10px; }
  .cover h1 { color:${primary}; font-size:40px; margin:28px 0 6px; }
  .cover .sub { font-size:16px; color:#6b7280; font-style:italic; margin-bottom:28px; }
  .cover .meta { font-size:13px; color:#374151; line-height:1.9; }
  .cover .meta b { color:${primary}; }
  .cover .stamp { margin-top:auto; font-size:10px; color:#9ca3af; }
  .toc-page { page-break-after:always; }
  .toc-title { color:${primary}; font-size:22px; font-weight:800; border-bottom:2px solid ${primary}; padding-bottom:8px; margin-bottom:16px; }
  .toc-row { display:flex; gap:12px; padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px; align-items:baseline; }
  .toc-n { width:26px; font-weight:800; color:${primary}; }
  .note-page { page-break-inside:avoid; margin-bottom:14px; }
  .note-head { display:flex; align-items:center; gap:10px; border-bottom:2px solid ${primary}; padding-bottom:8px; margin-top:14px; }
  .note-badge { width:26px; height:26px; border-radius:50%; background:${primary}; color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  h2 { color:${primary}; font-size:17px; margin:0; }
  .desc { color:#6b7280; font-size:10px; font-style:italic; margin:6px 0 10px; }
  .narrative { color:#374151; font-size:11px; margin:8px 0 14px; line-height:1.6; text-align:justify; }
  table { width:100%; border-collapse:collapse; font-size:10px; margin-top:6px; }
  th { background:${primary}; color:#fff; text-align:left; padding:7px 9px; font-weight:700; font-size:9px; text-transform:uppercase; letter-spacing:0.4px; }
  th.num { text-align:right; }
  td { padding:6px 9px; border-bottom:1px solid #f3f4f6; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.zero { color:#cbd5e1; }
  td.neg { color:#dc2626; }
  tr.total td { background:#f4f6fb; font-weight:800; color:${primary}; border-top:2px solid ${primary}; }
  tbody tr:nth-child(even):not(.total) td { background:#fbfcff; }
</style></head>
<body>
  <div class="cover">
    <div class="brand">Konsolidator</div>
    <h1>Memoria económica</h1>
    <div class="sub">${esc(tplLabel)}</div>
    <div class="meta">
      <div><b>Empresa:</b> ${esc(company)}</div>
      <div><b>Periodo:</b> ${esc(monthName)} de ${year}</div>
      <div><b>Source:</b> ${esc(source)}</div>
      <div><b>Estructura:</b> ${esc(structure)}</div>
    </div>
    <div class="stamp">Generado el ${stamp}</div>
  </div>
  <div class="toc-page">
    <div class="toc-title">Índice de epígrafes</div>
    ${toc}
  </div>
  ${pages}
</body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  }, [buildExportData, templates, templateId, company, year, month, source, structure, colors]);

const handleExportWord = useCallback(() => {
    const exportData = buildExportData();
    const tplLabel = templates.find(t => t.id === templateId)?.label ?? templateId;
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const monthName = new Date(2000, Number(month) - 1, 1).toLocaleDateString("es-ES", { month: "long" });
    const wcell = (v) => {
      if (v == null || v === 0) return `<td style="text-align:right;color:#cbd5e1;">—</td>`;
      const num = Number(v);
      const txt = Math.abs(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return num < 0
        ? `<td style="text-align:right;color:#dc2626;">(${txt})</td>`
        : `<td style="text-align:right;">${txt}</td>`;
    };

    const toc = exportData.map(({ note }) =>
      `<tr><td style="width:34pt;font-weight:bold;color:#1A2F8A;">${note.note_number}</td><td>${esc(note.title)}</td></tr>`
    ).join("");

    const sections = exportData.map(({ note, rows: nRows, columns: nCols, values, resolvedNarrative, hasTable }) => `
      <h2 style="color:#1A2F8A;font-size:16pt;margin-top:18pt;border-bottom:1.5pt solid #1A2F8A;padding-bottom:4pt;">
        Nota ${note.note_number} — ${esc(note.title)}
      </h2>
      ${note.description ? `<p style="color:#666;font-style:italic;font-size:10pt;">${esc(note.description)}</p>` : ""}
      ${resolvedNarrative ? `<p style="font-size:11pt;margin:8pt 0;line-height:1.5;text-align:justify;">${resolvedNarrative}</p>` : ""}
      ${hasTable ? `
      <table border="0" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:10pt;font-family:Calibri,Arial,sans-serif;">
        <thead>
          <tr style="background:#1A2F8A;color:#ffffff;">
            <th style="text-align:left;padding:6pt 8pt;">Concepto</th>
            ${nCols.map(c => `<th style="text-align:right;padding:6pt 8pt;">${esc(c.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${nRows.map(r => {
            const isTotal = r.is_total;
            const rowStyle = isTotal
              ? 'style="background:#f4f6fb;font-weight:bold;color:#1A2F8A;border-top:1.5pt solid #1A2F8A;"'
              : 'style="border-bottom:0.5pt solid #eef1f6;"';
            return `<tr ${rowStyle}>
              <td style="padding:5pt 8pt;">${esc(r.label)}</td>
              ${nCols.map(c => wcell(values[r.id]?.[c.id])).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>` : ""}
    `).join("");

    const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8" />
<title>Memoria</title>
<!--[if gte mso 9]><xml>
  <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
</xml><![endif]-->
<style>
  @page Section1 { size: 210mm 297mm; mso-page-orientation: portrait; margin: 1.8cm; }
  div.Section1 { page: Section1; }
  body { font-family: Calibri, Arial, sans-serif; color:#1f2937; }
  .brand { font-size:10pt; letter-spacing:2pt; font-weight:bold; color:#1A2F8A; text-transform:uppercase; }
</style></head>
<body>
  <div class="Section1">
    <p class="brand">Konsolidator</p>
    <h1 style="color:#1A2F8A;font-size:26pt;margin:6pt 0 2pt;">Memoria económica</h1>
    <p style="font-size:13pt;color:#6b7280;font-style:italic;margin:0 0 14pt;">${esc(tplLabel)}</p>
    <table style="font-size:11pt;margin-bottom:8pt;">
      <tr><td style="font-weight:bold;color:#1A2F8A;padding-right:10pt;">Empresa:</td><td>${esc(company)}</td></tr>
      <tr><td style="font-weight:bold;color:#1A2F8A;">Periodo:</td><td>${esc(monthName)} de ${year}</td></tr>
      <tr><td style="font-weight:bold;color:#1A2F8A;">Source:</td><td>${esc(source)}</td></tr>
      <tr><td style="font-weight:bold;color:#1A2F8A;">Estructura:</td><td>${esc(structure)}</td></tr>
    </table>
    <br style="mso-special-character:line-break;page-break-before:always;" />
    <h2 style="color:#1A2F8A;font-size:18pt;border-bottom:1.5pt solid #1A2F8A;padding-bottom:6pt;">Índice de epígrafes</h2>
    <table style="font-size:11pt;width:100%;">${toc}</table>
    <br style="mso-special-character:line-break;page-break-before:always;" />
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
onExportPdf={handleExportPdf}
        onExportXlsx={handleExportExcel}
        onExportWord={handleExportWord}
headerActions={[
          { icon: saving ? Loader2 : Save, label: saving ? "Guardando…" : "Guardar", onClick: () => { if (!saving) saveMemories(); } },
{ icon: RefreshCw, label: "Reset", onClick: () => setResetDialog(true) },
          { icon: Type, label: "Texto", onClick: () => setTextPopupOpen(true) },
        ]}
      />


      <div className="flex-1 min-h-0 flex gap-4">

        <div className="w-[280px] flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col overflow-hidden">
<div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <BookOpen size={13} style={{ color: colors.primary }} />
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>
                Notas · {templates.find(t => t.id === templateId)?.label}
              </p>
              <span className="ml-auto text-[10px] font-bold text-gray-400">{notes.length}</span>
            </div>
            {lastSavedInfo && (
              <p className="text-[9px] text-gray-400 mt-1 truncate" title={`Guardado por ${lastSavedInfo.by ?? "—"}`}>
                Última edición: {lastSavedInfo.by ?? "—"}
                {lastSavedInfo.at ? ` · ${new Date(lastSavedInfo.at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {loadingTemplate ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={16} className="animate-spin text-gray-300" />
              </div>
            ) : (
<>
                {notes.map(n => (
                  <NoteSidebarItem key={n.id} note={n}
                    active={n.id === activeNoteId}
                    onClick={() => setActiveNoteId(n.id)} />
                ))}
                <button onClick={() => setAddNoteModal(true)}
                  className="w-full mt-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 border-dashed transition-colors hover:bg-gray-50"
                  style={{ borderColor: `${colors.primary}40` }}>
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${colors.primary}12`, color: colors.primary }}>
                    <Plus size={15} />
                  </div>
                  <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: colors.primary }}>
                    Añadir epígrafe
                  </span>
                </button>
              </>
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
                  {activeNote._is_custom_note && (
                    <button onClick={() => {
                        if (window.confirm(`¿Eliminar el epígrafe "${activeNote.title}"? Se borrará al guardar.`)) {
                          deleteCustomNote(activeNote.id);
                        }
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-50 transition-colors"
                      title="Eliminar epígrafe personalizado">
                      <Trash2 size={12} /> Eliminar
                    </button>
                  )}
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
                <div className="rounded-xl overflow-hidden">
<NarrativeEditor
                    note={activeNote}
                    rows={effectiveRows}
                    columns={effectiveCols}
                    pivot={effectivePivot}
                    colors={colors}
                    textSettings={textSettings}
                    onChange={(tpl) => {
                      setNotes(prev => prev.map(n => n.id === activeNote.id ? { ...n, default_narrative: tpl } : n));
                    }}
                  />
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
{(currentRows.length === 0 && !loadingData && !tableManuallyEnabled) ? (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
                      <RefreshCw size={20} className="mx-auto text-gray-300 mb-2" />
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Sin datos para los filtros</p>
                      <p className="text-[11px] text-gray-400 mt-1">No se encontraron datos contables en {month}/{year} para {company}</p>
                    </div>
                  ) : (
<MovementsTable note={activeNote} rows={effectiveRows} columns={effectiveCols} pivot={pivot} onCellEdit={handleCellEdit}
                     overrides={overridesByNote.get(activeNote.id) ?? null}
                     onAddRow={addCustomRow} onRenameRow={renameRow} onDeleteRow={deleteRow}
                     onEnable={enableTable}
                     cellVariables={activeNote._cell_variables ?? null}
                     accountItems={accountItems}
                     onSetVariable={setCellVariable}
                     resolveVariable={resolveVariableValue} />
                  )}
</div>
              )}
            </div>
          )}
        </div>
      </div>

{addNoteModal && (
        <AddNoteModal
          colors={colors}
          onClose={() => setAddNoteModal(false)}
          onCreate={(cfg) => { addCustomNote(cfg); setAddNoteModal(false); }}
        />
      )}
      {textPopupOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setTextPopupOpen(false)}>
          <div className="w-[460px] max-w-full rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Type size={16} style={{ color: colors.primary }} />
              <p className="text-sm font-black text-gray-800">Formato de texto de la memoria</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-[11px] text-gray-400 -mt-1">Se aplica a todos los cuadros de la memoria de esta empresa.</p>
<div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Fuente</label>
                <FancyDropdown
                  value={textSettings.font}
                  options={NARR_FONTS.map(f => ({ v: f.v, n: f.n }))}
                  onChange={v => setTextSettings(s => ({ ...s, font: v }))}
                  renderOption={(o) => o ? { fontFamily: o.v } : {}}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Tamaño</label>
                  <FancyDropdown
                    value={String(textSettings.size)}
                    options={NARR_SIZES.map(s => ({ v: String(s), n: `${s}px` }))}
                    onChange={v => setTextSettings(s => ({ ...s, size: Number(v) }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Interlineado</label>
                  <FancyDropdown
                    value={String(textSettings.spacing)}
                    options={NARR_SPACING.map(s => ({ v: String(s.v), n: s.n }))}
                    onChange={v => setTextSettings(s => ({ ...s, spacing: Number(v) }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 block">Peso</label>
                  <FancyDropdown
                    value={String(textSettings.weight)}
                    options={[["300","Ligero"],["400","Normal"],["500","Medio"],["600","Semi"],["700","Negrita"]].map(([v,n]) => ({ v, n }))}
                    onChange={v => setTextSettings(s => ({ ...s, weight: Number(v) }))}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Vista previa</p>
                <p style={{ fontFamily: textSettings.font, fontSize: textSettings.size, lineHeight: textSettings.spacing, fontWeight: textSettings.weight, color: "#22252E" }}>
                  La sociedad tiene como actividad principal la fabricación de equipos.
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setTextPopupOpen(false)}
                className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={() => { saveTextSettings(textSettings); setTextPopupOpen(false); }}
                className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-white" style={{ background: colors.primary }}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {resetDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setResetDialog(false)}>
          <div className="w-[440px] max-w-full rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <RefreshCw size={16} style={{ color: colors.primary }} />
              <p className="text-sm font-black text-gray-800">Restablecer memorias</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-gray-500 leading-relaxed mb-4">
                Vuelve al punto de partida de la plantilla: descarta el texto editado, los valores
                introducidos a mano, las filas añadidas y las variables. Esto solo afecta a la pantalla;
                se guardará al pulsar <span className="font-bold">Guardar</span>.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { resetCurrentNote(); setResetDialog(false); }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors">
                  <p className="text-xs font-black text-gray-800 uppercase tracking-wider">Solo el epígrafe actual</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Restablece el texto y la tabla de la nota abierta.</p>
                </button>
                <button
                  onClick={() => { resetAllNotes(); setResetDialog(false); }}
                  className="w-full text-left px-4 py-3 rounded-xl border-2 border-red-200 hover:border-red-300 hover:bg-red-50 transition-colors">
                  <p className="text-xs font-black text-red-600 uppercase tracking-wider">Todos los epígrafes (1–25)</p>
                  <p className="text-[11px] text-red-400 mt-0.5">Borra TODO el progreso y vuelve al punto de partida.</p>
                </button>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button onClick={() => setResetDialog(false)}
                className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-100">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}