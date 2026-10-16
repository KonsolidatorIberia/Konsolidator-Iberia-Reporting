import { Fragment, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Check, Copy, Trash2, X, Layers, Presentation, Gauge, BarChart3, Table2, AlignLeft, RotateCcw, ChevronDown, Search, Pin, ListChecks, Calendar, CalendarRange, LineChart, Bold, Italic, Underline, Strikethrough, List, ListOrdered, AlignCenter, AlignRight, AlignJustify, Type, Highlighter, RemoveFormatting, Baseline, AlertTriangle, Building2, ChevronLeft, ChevronRight, Filter, ArrowLeftRight, Eye, LayoutGrid, Lock, Users, Share2, Loader2, Download, RefreshCw, FileText, Network, Building,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import { supabase } from "../../lib/supabaseClient";
import { useSettings, useSettingsControls, useT } from "../../components/layout/SettingsContext.jsx";
import { usePresentationsStore } from "./presentationsStore.js";
import MemoryEditor from "../MemoryNotes/MemoryEditor.jsx";
import { GuideButton } from "../MemoryNotes/MemoryGuide.jsx";
import { MEMORY_MODELS, notesForModel } from "../MemoryNotes/memoryCatalog.js";
import { createPortal } from "react-dom";
import { usePresentationData, formatKpiValue, resolveComparePeriod, kpiDelta, slotPeriod, slotFixedFields, chartMonths } from "./presentationData.js";
import { useLatestPeriod } from "../../components/layout/LatestPeriodContext.jsx";
import styles from "./PresentationsPage.module.css";
import slideStyles from "./SlideDesigns.module.css";

/* ══════════════════════════════════════════════════════════════════════
   Diseños de diapositiva. El aspecto de cada uno está en
   SlideDesigns.module.css, en la clase con el mismo id. colors son los
   colores editables del diseño (se pasan al CSS como --c-<clave>);
   "primary" significa el color primario del tema de la app.
   ══════════════════════════════════════════════════════════════════════ */
const PRIMARY = "primary";

const DESIGNS = [
  { id: "clean",     nameKey: "pres_d_clean",     fallback: "Limpio",
    colors: { bg: "#ffffff", title: "#0f1a3d", text: "#566089", accent: PRIMARY } },
  { id: "navy",      nameKey: "pres_d_navy",      fallback: "Konsolidator",
    colors: { bg: "#0b1233", title: "#ffffff", text: "#c3c8db", accent: PRIMARY, deco: "#5b8cff", deco2: "#2dc8b3" } },
  { id: "aurora",    nameKey: "pres_d_aurora",    fallback: "Aurora",
    colors: { bg: "#120b33", title: "#ffffff", text: "#d6d3e8", deco: "#7c3aed", deco2: "#2563eb", deco3: "#14b8a6" } },
  { id: "geometric", nameKey: "pres_d_geometric", fallback: "Geométrico",
    colors: { bg: "#f4f6fb", title: "#0f1a3d", text: "#566089", accent: PRIMARY } },
  { id: "editorial", nameKey: "pres_d_editorial", fallback: "Editorial",
    colors: { bg: "#faf7f2", title: "#1c1917", text: "#57534e", accent: "#dc2626", deco: "#1c1917", deco2: "#a8a29e" } },
  { id: "grid",      nameKey: "pres_d_grid",      fallback: "Técnico",
    colors: { bg: "#0f172a", title: "#e2e8f0", text: "#94a3b8", accent: "#22d3ee", deco: "#94a3b8" } },
  { id: "diagonal",  nameKey: "pres_d_diagonal",  fallback: "Diagonal",
    colors: { bg: "#ffffff", title: "#0f1a3d", text: "#566089", accent: PRIMARY } },
  { id: "glass",     nameKey: "pres_d_glass",     fallback: "Cristal",
    colors: { bg: "#ff9a8b", bg2: "#a18cd1", bg3: "#6a8dff", title: "#ffffff", text: "#ffffff" } },
  { id: "waves",     nameKey: "pres_d_waves",     fallback: "Ondas",
    colors: { bg: "#ffffff", title: "#0f1a3d", text: "#566089", accent: PRIMARY } },
  { id: "minimal",   nameKey: "pres_d_minimal",   fallback: "Minimal oscuro",
    colors: { bg: "#09090b", title: "#fafafa", text: "#a1a1aa", accent: "#10b981" } },
];
const DEFAULT_DESIGN_ID = "clean";
const getDesign = (id) => DESIGNS.find(d => d.id === id) ?? DESIGNS[0];

// Nombre visible de cada color editable.
const COLOR_LABELS = {
  bg:     { labelKey: "pres_c_bg",     fallback: "Fondo" },
  bg2:    { labelKey: "pres_c_bg2",    fallback: "Fondo (2)" },
  bg3:    { labelKey: "pres_c_bg3",    fallback: "Fondo (3)" },
  title:  { labelKey: "pres_c_title",  fallback: "Título" },
  text:   { labelKey: "pres_c_text",   fallback: "Texto" },
  accent: { labelKey: "pres_c_accent", fallback: "Acento" },
  deco:   { labelKey: "pres_c_deco",   fallback: "Decoración" },
  deco2:  { labelKey: "pres_c_deco2",  fallback: "Decoración (2)" },
  deco3:  { labelKey: "pres_c_deco3",  fallback: "Decoración (3)" },
};

const HEX6 = /^#[0-9a-f]{6}$/i;

// Colores efectivos de un diseño: valores por defecto + los del cliente.
function resolveColors(design, overrides, primary) {
  const prim = HEX6.test(primary ?? "") ? primary : "#1a2f8a";
  const out = {};
  Object.entries(design.colors).forEach(([k, def]) => {
    const v = overrides?.[k];
    out[k] = v && HEX6.test(v) ? v : (def === PRIMARY ? prim : def);
  });
  return out;
}

// Acepta "#abc", "abc", "#aabbcc" o "aabbcc"; devuelve "#aabbcc" o null.
function normalizeHex(raw) {
  let v = String(raw ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split("").map(c => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}

/* ══════════════════════════════════════════════════════════════════════
   Distribuciones: cómo se reparte la diapositiva entre el título y los
   espacios de datos. Cada espacio (slot) declara qué tipo de contenido
   admite; más adelante se rellenará con texto, KPIs, cuentas o gráficos.
   group decide en qué sección del panel aparece.
   cols/rows son grid-template-*; area es grid-area (fila/col inicio/fin).
   ══════════════════════════════════════════════════════════════════════ */
const SLOT_TYPES = {
  kpi:   { icon: Gauge,     labelKey: "pres_slot_kpi",   fallback: "KPI" },
  chart: { icon: BarChart3, labelKey: "pres_slot_chart", fallback: "Gráfico" },
  table: { icon: Table2,    labelKey: "pres_slot_table", fallback: "Cuentas" },
  text:  { icon: AlignLeft, labelKey: "pres_slot_text",  fallback: "Texto" },
};

const LAYOUT_GROUPS = [
  { id: "general", labelKey: "pres_lg_general", fallback: "General" },
  { id: "data",    labelKey: "pres_lg_data",    fallback: "Datos" },
  { id: "mixed",   labelKey: "pres_lg_mixed",   fallback: "Datos y texto" },
];

const kpis = (n) => Array.from({ length: n }, (_, i) => ({ id: `kpi${i + 1}`, type: "kpi" }));

const text = (id = "text1", area) => ({ id, type: "text", ...(area ? { area } : {}) });

const LAYOUTS = [
  /* General */
  { id: "cover",     group: "general", nameKey: "pres_l_cover",     fallback: "Portada", slots: [] },
  { id: "text",      group: "general", nameKey: "pres_l_text",      fallback: "Texto",
    cols: "1fr", rows: "1fr", slots: [text()] },
  { id: "text-2col", group: "general", nameKey: "pres_l_text_2col", fallback: "Texto a dos columnas",
    cols: "1fr 1fr", rows: "1fr", slots: [text("text1"), text("text2")] },

  /* Solo datos */
  { id: "kpi-2x2",   group: "data", nameKey: "pres_l_kpi_2x2",   fallback: "4 KPIs (2×2)",
    cols: "1fr 1fr", rows: "1fr 1fr", slots: kpis(4) },
  { id: "kpi-row",   group: "data", nameKey: "pres_l_kpi_row",   fallback: "4 KPIs en línea",
    cols: "repeat(4, 1fr)", rows: "1fr", slots: kpis(4) },
  { id: "kpi-rows",  group: "data", nameKey: "pres_l_kpi_rows",  fallback: "4 KPIs apilados",
    cols: "1fr", rows: "repeat(4, 1fr)", slots: kpis(4) },
  { id: "kpi-6",     group: "data", nameKey: "pres_l_kpi_6",     fallback: "6 KPIs (3×2)",
    cols: "repeat(3, 1fr)", rows: "1fr 1fr", slots: kpis(6) },
  { id: "chart",     group: "data", nameKey: "pres_l_chart",     fallback: "Gráfico",
    cols: "1fr", rows: "1fr", slots: [{ id: "chart1", type: "chart" }] },
  { id: "chart-kpi", group: "data", nameKey: "pres_l_chart_kpi", fallback: "Gráfico + 2 KPIs",
    cols: "2fr 1fr", rows: "1fr 1fr",
    slots: [
      { id: "chart1", type: "chart", area: "1 / 1 / 3 / 2" },
      { id: "kpi1", type: "kpi", area: "1 / 2 / 2 / 3" },
      { id: "kpi2", type: "kpi", area: "2 / 2 / 3 / 3" },
    ] },
  { id: "kpi-chart", group: "data", nameKey: "pres_l_kpi_chart", fallback: "3 KPIs + gráfico",
    cols: "repeat(3, 1fr)", rows: "1fr 2fr",
    slots: [...kpis(3), { id: "chart1", type: "chart", area: "2 / 1 / 3 / 4" }] },
  { id: "charts-2",  group: "data", nameKey: "pres_l_charts_2",  fallback: "2 gráficos",
    cols: "1fr 1fr", rows: "1fr",
    slots: [{ id: "chart1", type: "chart" }, { id: "chart2", type: "chart" }] },
  { id: "table",     group: "data", nameKey: "pres_l_table",     fallback: "Tabla de cuentas",
    cols: "1fr", rows: "1fr", slots: [{ id: "table1", type: "table" }] },

  /* Datos y texto */
  { id: "text-kpi2",  group: "mixed", nameKey: "pres_l_text_kpi2",  fallback: "Texto + 2 KPIs",
    cols: "1.2fr 1fr", rows: "1fr 1fr",
    slots: [
      text("text1", "1 / 1 / 3 / 2"),
      { id: "kpi1", type: "kpi", area: "1 / 2 / 2 / 3" },
      { id: "kpi2", type: "kpi", area: "2 / 2 / 3 / 3" },
    ] },
  { id: "kpi4-text",  group: "mixed", nameKey: "pres_l_kpi4_text",  fallback: "4 KPIs + texto",
    cols: "1fr 1fr 1.1fr", rows: "1fr 1fr",
    slots: [
      { id: "kpi1", type: "kpi", area: "1 / 1 / 2 / 2" },
      { id: "kpi2", type: "kpi", area: "1 / 2 / 2 / 3" },
      { id: "kpi3", type: "kpi", area: "2 / 1 / 3 / 2" },
      { id: "kpi4", type: "kpi", area: "2 / 2 / 3 / 3" },
      text("text1", "1 / 3 / 3 / 4"),
    ] },
  { id: "kpi3-text",  group: "mixed", nameKey: "pres_l_kpi3_text",  fallback: "3 KPIs + texto",
    cols: "repeat(3, 1fr)", rows: "1fr 1.3fr",
    slots: [...kpis(3), text("text1", "2 / 1 / 3 / 4")] },
  { id: "chart-text", group: "mixed", nameKey: "pres_l_chart_text", fallback: "Gráfico + texto",
    cols: "1.8fr 1fr", rows: "1fr",
    slots: [{ id: "chart1", type: "chart" }, text()] },
  { id: "table-text", group: "mixed", nameKey: "pres_l_table_text", fallback: "Cuentas + texto",
    cols: "1.8fr 1fr", rows: "1fr",
    slots: [{ id: "table1", type: "table" }, text()] },
  { id: "chart-kpi-text", group: "mixed", nameKey: "pres_l_chart_kpi_text", fallback: "Gráfico + KPI + texto",
    cols: "2fr 1fr", rows: "1fr 1.4fr",
    slots: [
      { id: "chart1", type: "chart", area: "1 / 1 / 3 / 2" },
      { id: "kpi1", type: "kpi", area: "1 / 2 / 2 / 3" },
      text("text1", "2 / 2 / 3 / 3"),
    ] },
  { id: "text-chart-2", group: "mixed", nameKey: "pres_l_text_charts", fallback: "Texto + 2 gráficos",
    cols: "1fr 1fr", rows: "0.7fr 1fr",
    slots: [
      text("text1", "1 / 1 / 2 / 3"),
      { id: "chart1", type: "chart" },
      { id: "chart2", type: "chart" },
    ] },
];
const DEFAULT_CONTENT_LAYOUT_ID = "kpi-2x2";
const getLayout = (id) => LAYOUTS.find(l => l.id === id) ?? LAYOUTS[0];

/* ══════════════════════════════════════════════════════════════════════
   Utilidades
   ══════════════════════════════════════════════════════════════════════ */
const cx = (...c) => c.filter(Boolean).join(" ");
const fill = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return ""; }
};
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
// slots queda reservado para el contenido de cada espacio (KPI, cuenta, gráfico).
const makeSlide = (designId = DEFAULT_DESIGN_ID, extra = {}) =>
  ({ id: newId(), designId, layoutId: "cover", title: "", subtitle: "", slots: {}, ...extra });

/* El guardado vive en presentationsStore.js (Supabase). */

/* ══════════════════════════════════════════════════════════════════════
   Diapositiva: lienzo lógico 1280×720 escalado al ancho del contenedor.
   Se usa en librería, carril, escenario y selectores, así que todas las
   vistas se ven idénticas. Los valores de KPI llegan por SlideDataContext
   (solo existe dentro del editor). Con `edit` (solo en el escenario) el
   título, el subtítulo y los textos se escriben directamente y los KPIs se
   eligen al hacer clic.
   ══════════════════════════════════════════════════════════════════════ */
const SLIDE_W = 1280;
const SlideDataContext = createContext(null);

// Texto editable en el sitio. Se guarda al salir del campo; la key remonta
// el nodo cuando el valor cambia desde fuera, para no pelear con el cursor.
/* ── Texto enriquecido ─────────────────────────────────────────────────
   Los textos se guardan como HTML saneado: solo etiquetas y estilos de
   formato (negrita, cursiva, subrayado, tachado, listas, alineación,
   tamaño y color). Los textos antiguos en texto plano se convierten solos. */
const RICH_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "P", "DIV", "SPAN", "FONT", "UL", "OL", "LI"]);
const RICH_STYLES = ["color", "background-color", "text-align", "font-weight", "font-style", "text-decoration", "text-decoration-line"];
const richCache = new Map();

function sanitizeRich(html) {
  if (!html) return "";
  if (richCache.has(html)) return richCache.get(html);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  const walk = (node) => {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { ch.remove(); return; }
      walk(ch);
      if (!RICH_TAGS.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); return; }
      [...ch.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name === "style") {
          const kept = RICH_STYLES.map(prop => {
            const v = ch.style.getPropertyValue(prop);
            return v ? `${prop}: ${v}` : "";
          }).filter(Boolean).join("; ");
          if (kept) ch.setAttribute("style", kept); else ch.removeAttribute("style");
        } else if (!(ch.tagName === "FONT" && (name === "size" || name === "color")) && name !== "align") {
          ch.removeAttribute(attr.name);
        }
      });
    });
  };
  walk(root);
  const out = root.innerHTML;
  if (richCache.size > 500) richCache.clear();
  richCache.set(html, out);
  return out;
}

const escapeHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const looksHtml = (v) => /<[a-z][\s\S]*>/i.test(String(v ?? ""));
const toRichHtml = (v) => (!v ? "" : looksHtml(v) ? sanitizeRich(v) : escapeHtml(v).replace(/\n/g, "<br>"));
function htmlToText(v) {
  if (!v) return "";
  if (!looksHtml(v)) return String(v);
  const doc = new DOMParser().parseFromString(`<div>${v}</div>`, "text/html");
  return doc.body.textContent ?? "";
}

// Texto editable en el sitio. Se guarda (como HTML saneado) al salir del
// campo; la key remonta el nodo cuando el valor cambia desde fuera, para no
// pelear con el cursor. Al pegar se pega solo el texto, sin formatos ajenos.
function EditableText({ as = "div", value, placeholder, editable, multiline = false, onCommit, onFocusChange, className, phClassName }) {
  const Tag = as;
  const html = toRichHtml(value ?? "");
  const empty = !htmlToText(html).trim();
  if (!editable) {
    if (empty) return <Tag className={cx(className, phClassName)}>{placeholder}</Tag>;
    return <Tag className={cx(className, slideStyles.rich)} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <Tag
      key={html}
      className={cx(className, slideStyles.editable, slideStyles.rich)}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-ph={placeholder}
      dangerouslySetInnerHTML={{ __html: empty ? "" : html }}
      onFocus={() => onFocusChange?.(true)}
      onBlur={e => {
        onFocusChange?.(false);
        const raw = e.currentTarget.innerHTML;
        const v = htmlToText(raw).trim() ? sanitizeRich(raw) : "";
        if (v !== (empty ? "" : html)) onCommit(v);
      }}
      onPaste={e => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
      onKeyDown={e => {
        if (e.key === "Escape") e.currentTarget.blur();
        if (e.key === "Enter" && !multiline) { e.preventDefault(); e.currentTarget.blur(); }
      }}
    />
  );
}

// Etiqueta corta del comparativo: "vs jun 2024", "vs Budget", etc.
function compareLabel(t, period, cp) {
  if (!cp) return "";
  const monthShort = (m) => t(`month_${m}`, String(m)).slice(0, 3).toLowerCase();
  const parts = [];
  if (cp.source !== period.source) parts.push(cp.source);
  if (cp.structure !== period.structure) parts.push(cp.structure);
  if (cp.year !== String(period.year) || cp.month !== String(period.month) || parts.length === 0) {
    parts.push(`${monthShort(cp.month)} ${cp.year}`);
  }
  return `${t("pres_cmp_vs", "vs")} ${parts.join(" · ")}`;
}

// Qué filtros propios tiene un KPI respecto a la presentación.
function filtersLabel(t, period, sp) {
  if (!sp) return "";
  const monthShort = (m) => t(`month_${m}`, String(m)).slice(0, 3).toLowerCase();
  const parts = [];
  if (sp.source !== period.source) parts.push(sp.source);
  if (sp.structure !== period.structure) parts.push(sp.structure);
  if (sp.year !== String(period.year) || sp.month !== String(period.month)) parts.push(`${monthShort(sp.month)} ${sp.year}`);
  if (sp.mode !== period.mode) parts.push(sp.mode === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"));
  if (sp.dims?.length) parts.push(fill(t("pres_n_dims", "{n} dim."), { n: sp.dims.length }));
  return parts.join(" · ");
}

// Nombres legibles de los campos que un KPI fija (para el aviso).
function fixedFieldNames(t, fields) {
  const names = {
    source: t("filter_source", "Fuente"),
    structure: t("filter_structure", "Perímetro"),
    year: t("filter_year", "Año"),
    month: t("filter_month", "Mes"),
    mode: t("pres_mode", "Modo"),
    compare: t("pres_compare", "Comparar con"),
    range: t("pres_chart_range", "Periodo"),
  };
  return fields.map(f => names[f] ?? f).join(", ");
}

// Qué se enseña en una tarjeta de KPI (se puede ajustar por KPI).
const DEFAULT_KPI_DISPLAY = { origin: true, filters: true, delta: true, deltaAbs: false, cmpValue: false };

// Texto de la variación: "+12.3%" o, para KPIs en %, "+2.3 pp".
function deltaText(delta) {
  if (!delta) return "—";
  const sign = delta.diff > 0 ? "+" : delta.diff < 0 ? "−" : "±";
  if (delta.points) return `${sign}${Math.abs(delta.diff).toFixed(1)} pp`;
  if (delta.pct == null) return "—";
  return `${sign}${Math.abs(delta.pct).toFixed(1)}%`;
}

// Espacio de KPI: nombre, valor y de dónde sale (individual/consolidado).
function KpiSlot({ slot, content, edit, style, highlight = false }) {
  const t = useT();
  const data = useContext(SlideDataContext);
  const s = slideStyles;
  const clickable = !!edit;
  const open = () => edit?.onPickKpi(slot.id);
  const common = {
    style,
    role: clickable ? "button" : undefined,
    tabIndex: clickable ? 0 : undefined,
    onClick: clickable ? open : undefined,
    onKeyDown: clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }) : undefined,
  };

  if (!content?.kpiId) {
    const meta = SLOT_TYPES.kpi;
    const Icon = meta.icon;
    return (
      <div {...common} className={cx(s.slot, clickable && s.slotClickable, highlight && s.slotHighlight)}>
        <Icon size={40} strokeWidth={1.8} />
        <span className={s.slotLabel}>
          {clickable ? t("pres_pick_kpi", "Elegir KPI") : t(meta.labelKey, meta.fallback)}
        </span>
      </div>
    );
  }

  const sp = data?.period ? slotPeriod(data.period, content) : null;
  const res = data ? data.resolveKpi(content, sp) : null;
  const label = res?.kpi?.label ?? content.label ?? content.kpiId;
  const format = res?.kpi?.format ?? content.format;
  let value = "—";
  if (res?.status === "ok") value = formatKpiValue(res.value, format);
  else if (res?.status === "loading") value = "…";
  const scopeLabel = content.scope === "consolidated"
    ? t("pres_kpi_consolidated", "Consolidado")
    : t("pres_kpi_individual", "Individual");

  // Comparativo (otro periodo, fuente o perímetro), si lo tiene.
  const cp = sp ? resolveComparePeriod(sp, content.compare) : null;
  let deltaEl = null;
  const show = { ...DEFAULT_KPI_DISPLAY, ...(content.display ?? {}) };
  if (cp && (show.delta || show.deltaAbs || show.cmpValue)) {
    const cres = data.resolveKpi(content, cp);
    const delta = res?.status === "ok" && cres?.status === "ok" ? kpiDelta(res.value, cres.value, format) : null;
    const dir = delta ? (delta.diff > 0 ? s.kpiUp : delta.diff < 0 ? s.kpiDown : null) : null;
    const loadingCmp = cres?.status === "loading";
    const parts = [];
    if (show.delta) parts.push(loadingCmp ? "…" : deltaText(delta));
    if (show.deltaAbs && !delta?.points) {
      parts.push(loadingCmp ? "…" : delta ? `${delta.diff > 0 ? "+" : delta.diff < 0 ? "−" : "±"}${formatKpiValue(Math.abs(delta.diff), format)}` : "—");
    }
    const vs = compareLabel(t, sp, cp);
    const cmpText = show.cmpValue && cres?.status === "ok" ? `${vs}: ${formatKpiValue(cres.value, format)}` : vs;
    deltaEl = (
      <span className={cx(s.kpiDelta, (show.delta || show.deltaAbs) && dir)}>
        {(show.delta || show.deltaAbs) && delta ? (delta.diff > 0 ? "▲ " : delta.diff < 0 ? "▼ " : "") : ""}
        {parts.join("  ")}
        <span className={s.kpiDeltaVs}>{parts.length ? " " : ""}{cmpText}</span>
      </span>
    );
  }

  // Aviso: este KPI no cambia con los filtros generales. Solo se pinta en
  // el editor (hay contexto de datos), no en la presentación final.
  const fixed = data ? slotFixedFields(content) : [];
  const fixedTip = fixed.length
    ? fill(t("pres_kpi_fixed_tip", "Este KPI usa sus propios filtros ({fields}) y no cambia con los filtros generales del header. Si reutilizas esta presentación, revísalo."),
      { fields: fixedFieldNames(t, fixed) })
    : "";

  return (
    <div {...common} className={cx(s.slot, s.slotKpi, clickable && s.slotClickable, highlight && s.slotHighlight)}
      title={(clickable && fixedTip) || undefined}>
      {fixed.length > 0 && (
        <span className={s.kpiFixed} role="img" aria-label={fixedTip}>
          <Pin size={16} strokeWidth={2.4} />
        </span>
      )}
      <span className={s.kpiLabel}>{label}</span>
      <span className={cx(s.kpiValue, res?.status === "loading" && s.kpiLoading)}>{value}</span>
      {deltaEl}
      {(show.origin || (show.filters && sp && filtersLabel(t, data.period, sp))) && (
        <span className={s.kpiMeta}>
          {[
            show.origin ? `${scopeLabel} · ${content.entityLabel ?? content.entity}` : "",
            show.filters && sp ? filtersLabel(t, data.period, sp) : "",
          ].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Gráficas de KPIs. Dos modos: "shared" (hasta 5 KPIs con los mismos
   filtros) e "independent" (hasta 3 KPIs, cada uno con los suyos). El
   rango es "los últimos N meses hasta el periodo" o de un mes a otro.
   ══════════════════════════════════════════════════════════════════════ */
const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
// Trazo de cada empresa en el modo de filtros comunes: continuo, discontinuo
// y punteado. El color distingue el KPI/cuenta; el trazo, la empresa.
const CHART_DASHES = ["", "12 7", "3 6"];
const MAX_CHART_ENTITIES = 3;

// Límite de KPIs/cuentas: 3 con filtros propios; con filtros comunes, 5 con
// una empresa y uno menos por cada empresa extra (3 empresas × 3 = 9 líneas).
function chartItemLimit(mode, nEntities = 1) {
  return mode === "independent" ? 3 : Math.max(1, 6 - Math.max(1, nEntities));
}

// Empresas del modo común (compatible con gráficas guardadas con una sola).
function sharedEntities(shared) {
  if (Array.isArray(shared?.entities) && shared.entities.length) return shared.entities.slice(0, MAX_CHART_ENTITIES);
  return shared?.entity ? [{ entity: shared.entity, entityLabel: shared.entityLabel }] : [];
}

// Líneas efectivas de una gráfica: KPI o cuenta + empresa + filtros resueltos.
function chartSeriesSpecs(content, period) {
  const mode = content?.mode === "independent" ? "independent" : "shared";
  const dataKind = content?.data === "accounts" ? "accounts" : "kpi";
  const statement = dataKind === "accounts" && content?.statement === "cf" ? "cf" : undefined;
  const idOf = (sr) => (dataKind === "accounts" ? sr.accountCode : sr.kpiId);
  const lines = [];
  if (mode === "shared") {
    const sh = content.shared ?? {};
    const ents = sharedEntities(sh);
    const items = (content.series ?? []).filter(idOf).slice(0, chartItemLimit("shared", ents.length));
    const sp = slotPeriod(period, { filters: sh.filters });
    items.forEach((sr, ii) => ents.forEach((en, ei) => lines.push({
      i: lines.length, itemIndex: ii, entityIndex: ei, dataKind, statement,
      kpiId: sr.kpiId, accountCode: sr.accountCode, label: sr.label, format: sr.format,
      color: sr.color || CHART_COLORS[ii % CHART_COLORS.length], dash: CHART_DASHES[ei] ?? "",
      scope: sh.scope ?? "individual",
      entity: en.entity, entityLabel: en.entityLabel ?? en.entity, multiEntity: ents.length > 1,
      source: sp.source, structure: sp.structure, mode: sp.mode, dims: sp.dims,
    })));
    return lines;
  }
  (content.series ?? []).filter(idOf).slice(0, 3).forEach((sr, ii) => {
    const sp = slotPeriod(period, { filters: sr.filters });
    lines.push({
      i: lines.length, itemIndex: ii, entityIndex: 0, dataKind, statement,
      kpiId: sr.kpiId, accountCode: sr.accountCode, label: sr.label, format: sr.format,
      color: sr.color || CHART_COLORS[ii % CHART_COLORS.length], dash: "",
      scope: sr.scope ?? "individual",
      entity: sr.entity, entityLabel: sr.entityLabel ?? sr.entity, multiEntity: true,
      source: sp.source, structure: sp.structure, mode: sp.mode, dims: sp.dims,
    });
  });
  return lines;
}

// Peticiones de datos que necesita una gráfica (todos los meses de cada línea).
function chartWanted(content, period) {
  const months = chartMonths(content?.range, period);
  const out = [];
  chartSeriesSpecs(content, period).forEach(sp => {
    if (!sp.entity) return;
    months.forEach(m => out.push({
      scope: sp.scope, entity: sp.entity, source: sp.source, structure: sp.structure, year: m.year, month: m.month, mode: sp.mode,
    }));
  });
  return out;
}

// Valores de cada línea para cada mes del rango.
function chartData(content, period, data) {
  const months = chartMonths(content?.range, period);
  const series = chartSeriesSpecs(content, period).map(sp => {
    let loading = false;
    let label = sp.label;
    let format = sp.format;
    const values = months.map(m => {
      if (!data || !sp.entity) return null;
      const per = { source: sp.source, structure: sp.structure, year: m.year, month: m.month, mode: sp.mode, dims: sp.dims };
      const r = sp.dataKind === "accounts"
        ? data.resolveAccount({ statement: sp.statement, scope: sp.scope, entity: sp.entity, accountCode: sp.accountCode,
            view: sp.statement === "cf" ? "total" : "consolidated" }, per)
        : data.resolveKpi({ scope: sp.scope, entity: sp.entity, kpiId: sp.kpiId }, per);
      if (r.kpi?.label) label = r.kpi.label;
      if (r.kpi?.format) format = r.kpi.format;
      if (r.account) { label = r.account.name ? `${r.account.code} · ${r.account.name}` : r.account.code; format = "currency"; }
      if (r.status === "loading") { loading = true; return null; }
      return r.status === "ok" && isFinite(r.value) ? r.value : null;
    });
    return { ...sp, label: label ?? sp.kpiId ?? sp.accountCode, format, values, loading };
  });
  return { months, series };
}

// Número compacto para los ejes: 1,2 M · 350 k · 12%.
function compactNumber(v, format) {
  if (v == null || !isFinite(v)) return "";
  if (format === "percent") return `${Math.round(v)}%`;
  const a = Math.abs(v);
  const fmt = (n, d) => n.toLocaleString("es-ES", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  if (a >= 1e9) return `${fmt(v / 1e9, 1)} MM`;
  if (a >= 1e6) return `${fmt(v / 1e6, 1)} M`;
  if (a >= 1e3) return `${fmt(v / 1e3, 0)} k`;
  return fmt(v, 0);
}

// Trazo suave que se corta donde falten datos. Interpolación monótona
// (Fritsch–Carlson): la curva nunca se pasa de los puntos reales, así que
// no inventa picos ni valles que no existen.
function smoothPath(pts) {
  const segs = [];
  let cur = [];
  pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  return segs.map(seg => {
    const n = seg.length;
    if (n === 1) return `M${seg[0].x},${seg[0].y}`;
    if (n === 2) return `M${seg[0].x},${seg[0].y} L${seg[1].x},${seg[1].y}`;
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) {
      dx.push(seg[i + 1].x - seg[i].x);
      dy.push(seg[i + 1].y - seg[i].y);
      m.push(dy[i] / dx[i]);
    }
    const tan = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) tan.push(0);
      else {
        const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
        tan.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
      }
    }
    tan.push(m[n - 2]);
    let d = `M${seg[0].x},${seg[0].y}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${seg[i].x + h},${seg[i].y + tan[i] * h} ${seg[i + 1].x - h},${seg[i + 1].y - tan[i + 1] * h} ${seg[i + 1].x},${seg[i + 1].y}`;
    }
    return d;
  }).join(" ");
}

// Dibujo de la gráfica con su leyenda. La leyenda nunca se oculta: va a la
// derecha si el espacio es ancho y debajo si no; la gráfica ocupa el resto.
function ChartView({ content, period }) {
  const t = useT();
  const data = useContext(SlideDataContext);
  const boxRef = useRef(null);
  const outerRef = useRef(null);
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [size, setSize] = useState({ w: 0, h: 0 });   // área de dibujo
  const [outer, setOuter] = useState({ w: 0, h: 0 }); // espacio completo (decide dónde va la leyenda)
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => entries.forEach(e => {
      const v = { w: e.contentRect.width, h: e.contentRect.height };
      if (e.target === boxRef.current) setSize(v); else setOuter(v);
    }));
    if (boxRef.current) ro.observe(boxRef.current);
    if (outerRef.current) ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, []);

  const s = slideStyles;
  const p = period ?? data?.period;
  const { months, series } = p ? chartData(content, p, data) : { months: [], series: [] };
  const monthShort = (m) => t(`month_${m.month}`, String(m.month)).slice(0, 3).toLowerCase();
  const xLabel = (m, i) => (i === 0 || m.month === "1" ? `${monthShort(m)} ${String(m.year).slice(2)}` : monthShort(m));
  const scopeName = (sc) => (sc === "consolidated" ? t("pres_kpi_consolidated", "Consolidado") : t("pres_kpi_individual", "Individual"));
  const first = series[0];
  const rangeText = months.length ? `${xLabel(months[0], 0)} – ${monthShort(months[months.length - 1])} ${String(months[months.length - 1].year).slice(2)}` : "";
  // En modo común con una sola empresa, la empresa va en el encabezado; si
  // hay varias (o cada línea tiene la suya), va en la leyenda.
  const singleEntity = first && !first.multiEntity;
  const caption = singleEntity ? `${scopeName(first.scope)} · ${first.entityLabel ?? ""} · ${rangeText}` : rangeText;
  // Se decide con el espacio completo, no con el área de dibujo: si no,
  // mover la leyenda cambiaría el área y volvería a mover la leyenda.
  const legendRight = outer.w > outer.h * 2.1 && series.length <= 5;

  // Geometría del área de dibujo.
  const all = series.flatMap(sr => sr.values.filter(v => v != null));
  let min = all.length ? Math.min(...all, 0) : 0;
  let max = all.length ? Math.max(...all, 0) : 1;
  if (min === max) { max = min + 1; }
  const pad = (max - min) * 0.08; max += pad; if (min < 0) min -= pad;
  const fmt = first?.format;

  const chartBox = (w, h) => {
    const L = 76, R = 18, T = 14, B = 34;
    const iw = Math.max(10, w - L - R), ih = Math.max(10, h - T - B);
    const x = (i) => L + (months.length <= 1 ? iw / 2 : (i / (months.length - 1)) * iw);
    const y = (v) => T + ih - ((v - min) / (max - min)) * ih;
    const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
    const step = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(iw / 70))));
    return { L, R, T, B, iw, ih, x, y, ticks, step };
  };

  return (
    <div ref={outerRef} className={cx(s.chart, legendRight && s.chartRow)}>
      <div className={s.chartMain}>
        {caption && <span className={s.chartCaption}>{caption}</span>}
        <div ref={boxRef} className={s.chartPlot}>
          {size.w > 0 && size.h > 0 && series.length > 0 && (() => {
            const g = chartBox(size.w, size.h);
            return (
              <svg width={size.w} height={size.h} className={s.chartSvg}>
                <defs>
                  {series.map(sr => (
                    <linearGradient key={sr.i} id={`area-${gid}-${sr.i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sr.color} stopOpacity="0.18" />
                      <stop offset="100%" stopColor={sr.color} stopOpacity="0" />
                    </linearGradient>
                  ))}
                </defs>
                {g.ticks.map((tv, i) => (
                  <g key={i}>
                    <line x1={g.L} x2={g.L + g.iw} y1={g.y(tv)} y2={g.y(tv)} className={s.chartGrid} />
                    <text x={g.L - 12} y={g.y(tv)} className={s.chartAxis} textAnchor="end" dominantBaseline="middle">
                      {compactNumber(tv, fmt)}
                    </text>
                  </g>
                ))}
                {min < 0 && max > 0 && <line x1={g.L} x2={g.L + g.iw} y1={g.y(0)} y2={g.y(0)} className={s.chartZero} />}
                {months.map((m, i) => (i % g.step === 0 || i === months.length - 1) && (
                  <text key={i} x={g.x(i)} y={g.T + g.ih + 22} className={s.chartAxis} textAnchor="middle">{xLabel(m, i)}</text>
                ))}
                {series.map(sr => {
                  const pts = sr.values.map((v, i) => (v == null ? null : { x: g.x(i), y: g.y(v) }));
                  const line = smoothPath(pts);
                  const valid = pts.filter(Boolean);
                  const area = valid.length > 1
                    ? `${smoothPath(pts)} L${valid[valid.length - 1].x},${g.T + g.ih} L${valid[0].x},${g.T + g.ih} Z`
                    : "";
                  return (
                    <g key={sr.i}>
                      {area && series.length <= 3 && !sr.dash && <path d={area} fill={`url(#area-${gid}-${sr.i})`} />}
                      <path d={line} fill="none" stroke={sr.color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                        strokeDasharray={sr.dash || undefined} />
                      {valid.map((pt, j) => (
                        <circle key={j} cx={pt.x} cy={pt.y} r={j === valid.length - 1 ? 5.5 : 3.2}
                          fill={j === valid.length - 1 ? sr.color : "var(--c-bg)"} stroke={sr.color} strokeWidth="2.5" />
                      ))}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
          {series.length === 0 && <span className={s.chartEmpty}>{t("pres_chart_empty", "Añade KPIs a la gráfica")}</span>}
        </div>
      </div>
      <div className={s.chartLegend}>
        {series.map(sr => {
          const sub = sr.multiEntity ? `${scopeName(sr.scope)} · ${sr.entityLabel ?? ""}` : "";
          return (
            <div key={sr.i} className={s.legendItem}>
              <svg className={s.legendSwatch} width="28" height="8" aria-hidden="true">
                <line x1="2" y1="4" x2="26" y2="4" stroke={sr.color} strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={sr.dash ? sr.dash.split(" ").map(n => Number(n) * 0.55).join(" ") : undefined} />
              </svg>
              <span className={s.legendText}>
                <span className={s.legendLabel}>{sr.loading ? `${sr.label} …` : sr.label}</span>
                {sub && <span className={s.legendSub}>{sub}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Espacio de gráfica: la gráfica si está configurada; si no, el hueco.
function ChartSlot({ slot, content, edit, style, highlight = false }) {
  const t = useT();
  const data = useContext(SlideDataContext);
  const s = slideStyles;
  const clickable = !!edit;
  const open = () => edit?.onPickChart(slot.id);
  const common = {
    style,
    role: clickable ? "button" : undefined,
    tabIndex: clickable ? 0 : undefined,
    onClick: clickable ? open : undefined,
    onKeyDown: clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }) : undefined,
  };
  if (content?.kind !== "chart") {
    const Icon = SLOT_TYPES.chart.icon;
    return (
      <div {...common} className={cx(s.slot, clickable && s.slotClickable, highlight && s.slotHighlight)}>
        <Icon size={40} strokeWidth={1.8} />
        <span className={s.slotLabel}>{clickable ? t("pres_pick_chart", "Crear gráfica") : t("pres_slot_chart", "Gráfico")}</span>
      </div>
    );
  }
  const fixed = data ? slotFixedFields(content) : [];
  const fixedTip = fixed.length
    ? fill(t("pres_kpi_fixed_tip", "Este KPI usa sus propios filtros ({fields}) y no cambia con los filtros generales del header. Si reutilizas esta presentación, revísalo."),
      { fields: fixedFieldNames(t, fixed) })
    : "";
  return (
    <div {...common} className={cx(s.slot, s.slotChart, clickable && s.slotClickable, highlight && s.slotHighlight)}
      title={(clickable && fixedTip) || undefined}>
      {fixed.length > 0 && (
        <span className={s.kpiFixed} role="img" aria-label={fixedTip}><Pin size={16} strokeWidth={2.4} /></span>
      )}
      <ChartView content={content} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Bloque de cuentas individuales: una lista (o un rango) de cuentas de una
   empresa con su valor. Las filas se ajustan al espacio: se ven las que
   caben y, si sobran, se indica cuántas.
   ══════════════════════════════════════════════════════════════════════ */
const ACC_MIN_ROW = 30; // alto mínimo de fila (px lógicos del lienzo)

// Cuentas seleccionadas, en orden de árbol, con su valor.
function accountsRows(content, period, data) {
  const all = (content?.statement === "cf" ? data?.cfAccounts : data?.accounts) ?? [];
  if (!all.length || !content) return [];
  let list;
  if (content.selection?.type === "range") {
    const i1 = all.findIndex(a => a.code === content.selection.from);
    const i2 = all.findIndex(a => a.code === content.selection.to);
    if (i1 < 0 || i2 < 0) return [];
    list = all.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  } else {
    const want = new Set(content.selection?.codes ?? []);
    list = all.filter(a => want.has(a.code));
  }
  const sp = slotPeriod(period, content);
  const rows = list.map(a => {
    const r = data.resolveAccount({
      statement: content.statement, scope: content.scope, entity: content.entity, view: content.view, company: content.company, accountCode: a.code,
    }, sp);
    return { ...a, status: r.status, value: r.value };
  });
  const shown = content.hideZero ? rows.filter(r => r.status !== "ok" || Math.abs(r.value ?? 0) > 0.004) : rows;
  const minDepth = Math.min(...shown.map(r => r.depth), 99);
  return shown.map(r => ({ ...r, indent: r.depth - (isFinite(minDepth) ? minDepth : 0) }));
}

// Filas que caben en un espacio de alto h (px lógicos).
const accountsCapacity = (h) => Math.max(1, Math.floor((h - 56) / ACC_MIN_ROW));

function AccountsSlot({ slot, content, edit, style, highlight = false }) {
  const t = useT();
  const data = useContext(SlideDataContext);
  const s = slideStyles;
  const boxRef = useRef(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clickable = !!edit;
  const open = (el) => edit?.onPickAccounts(slot.id, accountsCapacity(el?.offsetHeight ?? h));
  const common = {
    style,
    role: clickable ? "button" : undefined,
    tabIndex: clickable ? 0 : undefined,
    onClick: clickable ? (e => open(e.currentTarget)) : undefined,
    onKeyDown: clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e.currentTarget); } }) : undefined,
  };

  if (content?.kind !== "accounts") {
    const Icon = SLOT_TYPES.table.icon;
    return (
      <div {...common} ref={boxRef} className={cx(s.slot, clickable && s.slotClickable, highlight && s.slotHighlight)}>
        <Icon size={40} strokeWidth={1.8} />
        <span className={s.slotLabel}>{clickable ? t("pres_pick_accounts", "Elegir cuentas") : t("pres_slot_table", "Cuentas")}</span>
      </div>
    );
  }

  const period = data?.period;
  const rows = period ? accountsRows(content, period, data) : [];
  const cap = h ? accountsCapacity(h) : rows.length;
  const visible = rows.slice(0, cap);
  const hidden = rows.length - visible.length;
  const rowH = h && visible.length ? Math.min(46, Math.max(ACC_MIN_ROW, (h - 56) / visible.length)) : 36;
  const fontSize = Math.round(Math.min(21, Math.max(13, rowH * 0.46)));
  const sp = period ? slotPeriod(period, content) : null;
  const fixed = data ? slotFixedFields(content) : [];
  const monthShort = (m) => t(`month_${m}`, String(m)).slice(0, 3).toLowerCase();
  const cfLabel = content.statement === "cf" ? t("pres_cf", "Flujo de caja") : "";
  const viewLabel = content.statement === "cf"
    ? (content.scope === "consolidated"
      ? (content.view === "company" ? `${t("pres_cf_company", "Sociedad")} · ${content.companyLabel ?? content.company ?? ""}` : t("pres_cf_total", "Total del grupo"))
      : "")
    : content.scope === "consolidated"
    ? (content.view === "eliminations" ? t("pres_acc_view_elim", "Eliminaciones")
      : content.view === "contribution" ? `${t("pres_acc_view_contrib", "Contribución")} · ${content.companyLabel ?? content.company ?? ""}`
      : t("pres_kpi_consolidated", "Consolidado"))
    : "";
  const sameCompany = (content.view === "contribution" || content.view === "company") && content.company === content.entity;
  const caption = sp ? [
    cfLabel,
    viewLabel,
    sameCompany ? "" : (content.entityLabel ?? content.entity),
    `${monthShort(sp.month)} ${sp.year}`,
    sp.mode === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"),
    filtersLabel(t, { ...period, year: sp.year, month: sp.month, mode: sp.mode }, sp),
  ].filter(Boolean).join(" · ") : (content.entityLabel ?? "");

  return (
    <div {...common} ref={boxRef} className={cx(s.slot, s.slotAccounts, clickable && s.slotClickable, highlight && s.slotHighlight)}>
      {fixed.length > 0 && <span className={s.kpiFixed} role="img"><Pin size={16} strokeWidth={2.4} /></span>}
      <span className={s.accCaption}>{caption}</span>
      <div className={s.accTable} style={{ fontSize }}>
        {visible.map(r => (
          <div key={r.code} className={cx(s.accRow, r.isSum && s.accSum)} style={{ height: rowH }}>
            <span className={s.accName} style={{ paddingLeft: `${r.indent * 1.1}em` }}>
              {content.showCodes !== false && <span className={s.accCode}>{r.code}</span>}
              {r.name}
            </span>
            <span className={s.accValue}>
              {r.status === "ok" ? formatKpiValue(r.value, "currency") : r.status === "loading" ? "…" : "—"}
            </span>
          </div>
        ))}
        {rows.length === 0 && <span className={s.chartEmpty}>{t("pres_acc_empty", "Sin cuentas que mostrar")}</span>}
      </div>
      {hidden > 0 && <span className={s.accMore}>{fill(t("pres_acc_more", "+{n} cuentas que no caben"), { n: hidden })}</span>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Bloque "Sábana de consolidación" (o parte de ella): para un grupo y unas
   cuentas, columnas Consolidado · Eliminaciones · Contribución (total) y
   después las sociedades elegidas, con el resto sumado en "Resto". Mismo
   cálculo que la hoja de consolidación: consolidado = filas Group del grupo;
   contribución de cada sociedad = sus filas Parent / Contribution;
   eliminaciones = consolidado − contribuciones.
   ══════════════════════════════════════════════════════════════════════ */
function sheetColumns(content, data, companies, t) {
  const members = data?.holdings?.membersOf?.(content.entity) ?? [];
  const show = content.columns ?? { consolidated: true, eliminations: true, contribution: true };
  const picked = content.companiesMode === "some"
    ? (content.companies ?? []).filter(c => members.includes(c))
    : members;
  const cols = [];
  if (show.consolidated) cols.push({ key: "cons", kind: "cons", label: t("pres_sheet_cons", "Consolidado") });
  if (show.eliminations) cols.push({ key: "elim", kind: "elim", label: t("pres_sheet_elim", "Eliminaciones") });
  if (show.contribution) cols.push({ key: "contrib", kind: "contrib", label: t("pres_sheet_contrib", "Contribución") });
  picked.forEach(c => cols.push({ key: `co:${c}`, kind: "company", company: c, label: companyName(companies, c) }));
  const rest = members.filter(c => !picked.includes(c));
  if (content.companiesMode === "some" && content.showRest !== false && rest.length) {
    cols.push({ key: "rest", kind: "rest", label: fill(t("pres_sheet_rest", "Resto ({n})"), { n: rest.length }), rest });
  }
  return { cols, members };
}

function sheetRows(content, period, data, companies, t) {
  const all = data?.accounts ?? [];
  if (!all.length || !content?.entity) return { cols: [], rows: [] };
  let list;
  if (content.selection?.type === "range") {
    const i1 = all.findIndex(a => a.code === content.selection.from);
    const i2 = all.findIndex(a => a.code === content.selection.to);
    if (i1 < 0 || i2 < 0) return { cols: [], rows: [] };
    list = all.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  } else {
    const want = new Set(content.selection?.codes ?? []);
    list = all.filter(a => want.has(a.code));
  }
  const { cols, members } = sheetColumns(content, data, companies, t);
  const sp = slotPeriod(period, content);
  const get = (view, code, company) => data.resolveAccount({ scope: "consolidated", entity: content.entity, view, company, accountCode: code }, sp);
  const rows = list.map(a => {
    let status = "ok";
    const val = (view, company) => {
      const r = get(view, a.code, company);
      if (r.status === "loading") status = "loading";
      return r.status === "ok" ? r.value : 0;
    };
    const contribOf = {};
    members.forEach(c => { contribOf[c] = val("contribution", c); });
    const contribTotal = members.reduce((s, c) => s + contribOf[c], 0);
    const vals = cols.map(col => {
      if (col.kind === "cons") return val("consolidated");
      if (col.kind === "elim") return val("eliminations");
      if (col.kind === "contrib") return contribTotal;
      if (col.kind === "company") return contribOf[col.company] ?? 0;
      if (col.kind === "rest") return col.rest.reduce((s, c) => s + (contribOf[c] ?? 0), 0);
      return 0;
    });
    return { ...a, vals, status };
  });
  const shown = content.hideZero ? rows.filter(r => r.status !== "ok" || r.vals.some(v => Math.abs(v) > 0.004)) : rows;
  const minDepth = Math.min(...shown.map(r => r.depth), 99);
  return { cols, rows: shown.map(r => ({ ...r, indent: r.depth - (isFinite(minDepth) ? minDepth : 0) })) };
}

/* ── Contributivo: varias sociedades comprimidas (una columna por sociedad
   con su total) o una sociedad desplegada (Uploaded, AJE, RJE, EJE, SYS,
   CFA y total). Moneda local de cada sociedad. ───────────────────────── */
const CONTRIB_COLS = ["Uploaded", "AJE", "RJE", "EJE", "SYS", "CFA"];
function contribRows(content, period, data, companies, t) {
  const all = data?.accounts ?? [];
  const cos = (content?.companies ?? []).filter(Boolean);
  if (!all.length || !cos.length) return { cols: [], rows: [] };
  let list;
  if (content.selection?.type === "range") {
    const i1 = all.findIndex(a => a.code === content.selection.from);
    const i2 = all.findIndex(a => a.code === content.selection.to);
    if (i1 < 0 || i2 < 0) return { cols: [], rows: [] };
    list = all.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  } else {
    const want = new Set(content.selection?.codes ?? []);
    list = all.filter(a => want.has(a.code));
  }
  const sp = slotPeriod(period, content);
  const detail = content.mode === "detail";
  const curOf = (c) => companies.find(x => optCompany(x) === c)?.CurrencyCode ?? companies.find(x => optCompany(x) === c)?.currencyCode ?? "";
  let cols = detail
    ? [...CONTRIB_COLS.map(k => ({ key: k, kind: k === "Uploaded" ? "upload" : "journal", part: k, label: k === "Uploaded" ? t("pres_contrib_uploaded", "Cargado") : k })),
       { key: "total", kind: "contrib", part: "total", label: t("pres_contrib_total", "Total") }]
    : cos.map(c => ({ key: `co:${c}`, kind: "company", company: c, label: `${companyName(companies, c)}${curOf(c) ? ` · ${curOf(c)}` : ""}` }));
  const rows = list.map(a => {
    let status = "ok";
    const vals = cols.map(col => {
      const r = data.resolveContrib({ entity: detail ? cos[0] : col.company, accountCode: a.code, part: col.part ?? "total" }, sp);
      if (r.status === "loading") status = "loading";
      return r.status === "ok" ? r.value : 0;
    });
    return { ...a, vals, status };
  });
  let shown = content.hideZero ? rows.filter(r => r.status !== "ok" || r.vals.some(v => Math.abs(v) > 0.004)) : rows;
  // Desplegado: las columnas de asientos que vienen vacías en todas las cuentas no se pintan.
  if (detail && shown.length && shown.every(r => r.status === "ok")) {
    const keep = cols.map((c, i) => c.kind !== "journal" || shown.some(r => Math.abs(r.vals[i]) > 0.004));
    cols = cols.filter((_, i) => keep[i]);
    shown = shown.map(r => ({ ...r, vals: r.vals.filter((_, i) => keep[i]) }));
  }
  const minDepth = Math.min(...shown.map(r => r.depth), 99);
  return { cols, rows: shown.map(r => ({ ...r, indent: r.depth - (isFinite(minDepth) ? minDepth : 0) })) };
}

// Importe compacto para tablas anchas (1,2M · 350K).
function fmtCompactAmount(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1).replace(".", ",")}MM`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1).replace(".", ",")}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

function SheetSlot({ slot, content, edit, style, highlight = false }) {
  const t = useT();
  const data = useContext(SlideDataContext);
  const s = slideStyles;
  const boxRef = useRef(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clickable = !!edit;
  const isContrib = content?.kind === "contrib";
  const open = (el) => edit?.onPickAccounts(slot.id, accountsCapacity((el?.offsetHeight ?? h) - 34), isContrib ? "contrib" : "sheet");
  const period = data?.period;
  const companies = data?.companies ?? [];
  const { cols, rows } = period
    ? (isContrib ? contribRows(content, period, data, companies, t) : sheetRows(content, period, data, companies, t))
    : { cols: [], rows: [] };
  const cap = h ? accountsCapacity(h - 34) : rows.length;
  const visible = rows.slice(0, cap);
  const hidden = rows.length - visible.length;
  const rowH = h && visible.length ? Math.min(44, Math.max(ACC_MIN_ROW, (h - 90) / visible.length)) : 34;
  const fontSize = Math.round(Math.min(19, Math.max(12, rowH * 0.44)));
  const compact = cols.length > 5;
  const fmt = (v) => (Math.abs(v) < 0.005 ? "—" : compact ? fmtCompactAmount(v) : formatKpiValue(v, "currency"));
  const sp = period ? slotPeriod(period, content) : null;
  const fixed = data ? slotFixedFields(content) : [];
  const monthShort = (m) => t(`month_${m}`, String(m)).slice(0, 3).toLowerCase();
  const caption = sp ? [
    isContrib
      ? (content.mode === "detail"
        ? `${t("pres_contrib_title", "Contributivo")} · ${companyName(companies, content.companies?.[0] ?? "")}`
        : t("pres_contrib_title", "Contributivo"))
      : t("pres_sheet_title", "Sábana de consolidación"),
    isContrib ? "" : (content.entityLabel ?? content.entity),
    `${monthShort(sp.month)} ${sp.year}`,
    sp.mode === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"),
  ].filter(Boolean).join(" · ") : "";
  // La columna de cuentas ocupa más cuanto menos columnas de importes haya.
  const nameFr = cols.length <= 3 ? 2.4 : cols.length <= 6 ? 2 : 1.6;
  const grid = { gridTemplateColumns: `minmax(0, ${nameFr}fr) repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr))` };
  const common = {
    style,
    role: clickable ? "button" : undefined,
    tabIndex: clickable ? 0 : undefined,
    onClick: clickable ? (e => open(e.currentTarget)) : undefined,
    onKeyDown: clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e.currentTarget); } }) : undefined,
  };
  return (
    <div {...common} ref={boxRef} className={cx(s.slot, s.slotAccounts, clickable && s.slotClickable, highlight && s.slotHighlight)}>
      {fixed.length > 0 && <span className={s.kpiFixed} role="img"><Pin size={16} strokeWidth={2.4} /></span>}
      <span className={s.accCaption}>{caption}</span>
      <div className={s.sheetHead} style={{ ...grid, fontSize: Math.max(11, fontSize - 3) }}>
        <span />
        {cols.map(c => {
          // Con muchas columnas, rótulos cortos (sin partir palabras).
          const short = { cons: t("pres_sheet_cons_short", "Cons."), elim: t("pres_sheet_elim_short", "Elim."), contrib: t("pres_sheet_contrib_short", "Contrib.") }[c.kind];
          return (
            <span key={c.key} className={cx(s.sheetHeadCell, s[`sheetCol_${c.kind}`])} title={c.label}>{compact && short ? short : c.label}</span>
          );
        })}
      </div>
      <div className={s.accTable} style={{ fontSize }}>
        {visible.map(r => (
          <div key={r.code} className={cx(s.sheetRow, r.isSum && s.accSum)} style={{ ...grid, height: rowH }}>
            <span className={s.accName} style={{ paddingLeft: `${r.indent * 1.1}em` }}>
              {content.showCodes !== false && <span className={s.accCode}>{r.code}</span>}
              {r.name}
            </span>
            {r.vals.map((v, i) => (
              <span key={cols[i].key} className={cx(s.sheetCell, s[`sheetCol_${cols[i].kind}`], v < 0 && s.sheetNeg)}>
                {r.status === "loading" ? "…" : fmt(v)}
              </span>
            ))}
          </div>
        ))}
        {rows.length === 0 && <span className={s.chartEmpty}>{t("pres_acc_empty", "Sin cuentas que mostrar")}</span>}
      </div>
      {hidden > 0 && <span className={s.accMore}>{fill(t("pres_acc_more", "+{n} cuentas que no caben"), { n: hidden })}</span>}
    </div>
  );
}

function SlideCanvas({ designId, layoutId, themes, title, subtitle, slots, number, className, edit, highlight = null, exportMode = false }) {
  const t = useT();
  const { colors: appColors } = useSettings();
  const frameRef = useRef(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / SLIDE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const s = slideStyles;
  const design = getDesign(designId);
  const layout = getLayout(layoutId);
  const palette = resolveColors(design, themes?.[design.id], appColors?.primary);
  const colorVars = Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--c-${k}`, v]));
  const isCover = layout.id === "cover";
  const editable = !!edit;
  const titlePh = t("pres_slide_title_ph", "Título de la diapositiva");
  const subPh = t("pres_slide_sub_ph", "Subtítulo");

  return (
    <div ref={frameRef} className={cx(s.frame, exportMode && s.exporting, className)}>
      <div
        className={cx(s.slide, s[design.id], !isCover && s.isContent)}
        style={{ ...colorVars, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}
      >
        <span className={s.decorA} aria-hidden="true" />
        <span className={s.decorB} aria-hidden="true" />

        {isCover ? (
          <div className={s.content}>
            <span className={s.accent} aria-hidden="true" />
            <EditableText as="h2" className={s.title} phClassName={s.ph} value={title} placeholder={titlePh}
              editable={editable} onCommit={v => edit.onTitle(v)} onFocusChange={edit?.onFormatFocus} />
            <EditableText as="p" className={s.subtitle} phClassName={s.ph} value={subtitle} placeholder={subPh}
              editable={editable} onCommit={v => edit.onSubtitle(v)} onFocusChange={edit?.onFormatFocus} />
          </div>
        ) : (
          <div className={s.area}>
            <div className={s.head}>
              <span className={s.accent} aria-hidden="true" />
              <EditableText as="h2" className={cx(s.title, s.hTitle)} phClassName={s.ph} value={title} placeholder={titlePh}
                editable={editable} onCommit={v => edit.onTitle(v)} onFocusChange={edit?.onFormatFocus} />
              {(editable || (subtitle && subtitle.trim())) && (
                <EditableText as="p" className={cx(s.subtitle, s.hSub)} phClassName={s.ph} value={subtitle}
                  placeholder={t("pres_subtitle_optional", "Subtítulo (opcional)")}
                  editable={editable} onCommit={v => edit.onSubtitle(v)} onFocusChange={edit?.onFormatFocus} />
              )}
            </div>
            <div className={s.slots} style={{ gridTemplateColumns: layout.cols, gridTemplateRows: layout.rows }}>
              {layout.slots.map(slot => {
                const meta = SLOT_TYPES[slot.type];
                const Icon = meta.icon;
                const style = slot.area ? { gridArea: slot.area } : undefined;
                const content = slots?.[slot.id];
                if (slot.type === "kpi") {
                  return <KpiSlot key={slot.id} slot={slot} content={content} edit={edit} style={style} highlight={highlight === slot.id} />;
                }
                if (slot.type === "chart") {
                  return <ChartSlot key={slot.id} slot={slot} content={content} edit={edit} style={style} highlight={highlight === slot.id} />;
                }
                if (slot.type === "table") {
                  if (content?.kind === "sheet" || content?.kind === "contrib") {
                    return <SheetSlot key={slot.id} slot={slot} content={content} edit={edit} style={style} highlight={highlight === slot.id} />;
                  }
                  return <AccountsSlot key={slot.id} slot={slot} content={content} edit={edit} style={style} highlight={highlight === slot.id} />;
                }
                if (slot.type === "text") {
                  const txt = content?.text ?? "";
                  if (!htmlToText(txt).trim() && !editable) {
                    return (
                      <div key={slot.id} className={cx(s.slot, s.slotText)} style={style}>
                        <span className={s.textHead}>
                          <Icon size={26} strokeWidth={2} />
                          <span className={s.slotLabel}>{t(meta.labelKey, meta.fallback)}</span>
                        </span>
                        <span className={s.textLines} aria-hidden="true">
                          <span /><span /><span /><span /><span />
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={slot.id} className={cx(s.slot, s.slotText, s.slotTextFilled, highlight === slot.id && s.slotHighlight)} style={style}>
                      <EditableText className={s.textBody} value={txt} multiline editable={editable}
                        placeholder={t("pres_text_ph", "Escribe aquí el texto…")}
                        onCommit={v => edit.onText(slot.id, v)} onFocusChange={edit?.onFormatFocus} />
                    </div>
                  );
                }
                return (
                  <div key={slot.id} className={s.slot} style={style}>
                    <Icon size={40} strokeWidth={1.8} />
                    <span className={s.slotLabel}>{t(meta.labelKey, meta.fallback)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {number != null && <span className={s.num}>{number}</span>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Modales: se pintan en un portal sobre <body> (así la rueda del ratón no
   hace scroll de la página de fondo) y bloquean el scroll mientras están
   abiertos. Llevan su propio --k-primary porque quedan fuera de la página.
   ══════════════════════════════════════════════════════════════════════ */
function ModalPortal({ onClose, children, instant = false }) {
  const { colors } = useSettings();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div className={cx(styles.overlay, instant && styles.noIntro)} onMouseDown={onClose} style={{ "--k-primary": colors.primary }}>
      {children}
    </div>,
    document.body,
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Datos de una presentación (lo usan el editor y la exportación).
   ══════════════════════════════════════════════════════════════════════ */
// Periodo por defecto: primera fuente/perímetro y último periodo con datos.
function usePeriodDefaults(sources, structures, companies) {
  const { getLatestPeriod } = useLatestPeriod();
  return useMemo(() => {
    const src = optSource(sources[0]);
    const str = optStructure(structures[0]);
    const lp = getLatestPeriod?.(src, str, optCompany(companies[0]));
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth();
    if (m === 0) { m = 12; y -= 1; }
    return { source: src, structure: str, year: String(lp?.year ?? y), month: String(lp?.month ?? m), mode: "ytd" };
  }, [sources, structures, companies, getLatestPeriod]);
}

// Empresas, grupos y periodos que necesitan las diapositivas.
function wantedForSlides(slides, period) {
  const pp = { source: period.source, structure: period.structure, year: period.year, month: period.month };
  const out = [];
  slides.forEach(sl => Object.values(sl.slots ?? {}).forEach(c => {
    if (c?.kind === "chart") {
      chartWanted(c, { ...pp, mode: period.mode }).forEach(w => out.push(w));
      return;
    }
    if (c?.kind === "contrib") {
      const sp = slotPeriod({ ...pp, mode: period.mode }, c);
      (c.companies ?? []).forEach(co => {
        out.push({ scope: "individual", entity: co, source: sp.source, structure: sp.structure, year: sp.year, month: sp.month, mode: sp.mode });
        out.push({ scope: "journals", entity: co, source: sp.source, structure: sp.structure, year: sp.year, month: sp.month, mode: sp.mode });
      });
      return;
    }
    if (c?.kind === "sheet") {
      const sp = slotPeriod({ ...pp, mode: period.mode }, c);
      if (c.entity) out.push({ scope: "consolidated", entity: c.entity, source: sp.source, structure: sp.structure, year: sp.year, month: sp.month, mode: sp.mode });
      return;
    }
    if (c?.kind === "accounts") {
      const sp = slotPeriod({ ...pp, mode: period.mode }, c);
      if (c.entity) out.push({ scope: c.scope ?? "individual", entity: c.entity, source: sp.source, structure: sp.structure, year: sp.year, month: sp.month, mode: sp.mode });
      return;
    }
    if (c?.kind !== "kpi" || !c.scope || !c.entity) return;
    const sp = slotPeriod({ ...pp, mode: period.mode }, c);
    out.push({ scope: c.scope, entity: c.entity, source: sp.source, structure: sp.structure, year: sp.year, month: sp.month, mode: sp.mode });
    const cp = resolveComparePeriod(sp, c.compare);
    if (cp) out.push({ scope: c.scope, entity: c.entity, source: cp.source, structure: cp.structure, year: cp.year, month: cp.month, mode: cp.mode });
  }));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
   Exportar a PowerPoint (.pptx)
   Monta las diapositivas fuera de la pantalla a tamaño real (1280×720)
   con sus datos, espera a que no quede nada cargando y fotografía cada una
   (html-to-image, a doble resolución). Después crea el .pptx en 16:9 con
   una diapositiva por imagen (pptxgenjs) y lo descarga. Se ve igual que en
   la app: diseño, colores, KPIs, gráficas y tablas.
   Librerías (se cargan solo al exportar): npm i pptxgenjs html-to-image
   ══════════════════════════════════════════════════════════════════════ */
function PptxExporter({ presentation, token, activeStandardKey, sources, structures, companies, onDone }) {
  const t = useT();
  const { colors } = useSettings();
  const defaults = usePeriodDefaults(sources, structures, companies);
  const period = useMemo(() => ({ ...defaults, ...(presentation.data ?? {}) }), [defaults, presentation.data]);
  // Se fija la presentación al empezar: si cambia mientras se exporta, no afecta.
  const [snapshot] = useState(presentation);
  const slides = useMemo(() => snapshot.slides ?? [], [snapshot]);
  const wanted = useMemo(() => wantedForSlides(slides, period), [slides, period]);
  const data = usePresentationData({ token, standardKey: activeStandardKey, period, wanted });
  const stageRef = useRef(null);
  const onDoneRef = useRef(onDone);
  useLayoutEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  const cancelled = useRef(false);
  const [phase, setPhase] = useState("loading"); // loading | capturing | building | done | error
  const [done, setDone] = useState(0);
  const [error, setError] = useState(null);
  const dataReady = !!data?.ready;

  useEffect(() => {
    if (!dataReady) return;
    let alive = true;
    (async () => {
      try {
        // 1) Esperar a que las diapositivas no tengan nada cargando ("…")
        //    durante un momento seguido (máximo 25 s).
        const start = Date.now();
        let calm = 0;
        while (alive && Date.now() - start < 25000 && calm < 3) {
          await new Promise(r => setTimeout(r, 350));
          const txt = stageRef.current?.innerText ?? "";
          calm = txt.includes("…") ? 0 : calm + 1;
        }
        if (!alive || cancelled.current) return;
        const [{ toPng }, pptxMod] = await Promise.all([import("html-to-image"), import("pptxgenjs")]);
        const PptxGenJS = pptxMod.default ?? pptxMod;
        // 2) Fotografiar cada diapositiva
        setPhase("capturing");
        const nodes = [...(stageRef.current?.querySelectorAll("[data-export-slide]") ?? [])];
        const images = [];
        for (let i = 0; i < nodes.length; i++) {
          if (!alive || cancelled.current) return;
          const opts = { pixelRatio: 2, cacheBust: true, width: 1280, height: 720, backgroundColor: "#ffffff" };
          let png;
          try { png = await toPng(nodes[i], opts); }
          catch { png = await toPng(nodes[i], { ...opts, skipFonts: true }); }
          images.push(png);
          setDone(i + 1);
        }
        // 3) Montar el .pptx (16:9) y descargarlo
        setPhase("building");
        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE"; // 13,33 × 7,5 pulgadas
        pptx.title = snapshot.name || "Presentación";
        pptx.company = "Konsolidator";
        images.forEach((img, i) => {
          const sl = pptx.addSlide();
          sl.addImage({ data: img, x: 0, y: 0, w: 13.333, h: 7.5 });
          const s0 = slides[i];
          const note = [s0?.title, s0?.subtitle].filter(Boolean).join(" — ").replace(/<[^>]+>/g, "");
          if (note) sl.addNotes(note);
        });
        const safe = (snapshot.name || "presentacion").replace(/[\\/:*?"<>|]+/g, "-").trim();
        await pptx.writeFile({ fileName: `${safe}.pptx` });
        if (!alive) return;
        setPhase("done");
        setTimeout(() => onDoneRef.current?.(), 900);
      } catch (e) {
        if (!alive) return;
        setError(String(e?.message ?? e));
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, [dataReady, slides, snapshot]);

  const total = slides.length;
  const pct = phase === "loading" ? 6 : phase === "capturing" ? 10 + (done / Math.max(total, 1)) * 80 : phase === "building" ? 94 : 100;
  const label = phase === "loading" ? t("pres_pptx_loading", "Cargando los datos de las diapositivas…")
    : phase === "capturing" ? fill(t("pres_pptx_capturing", "Preparando diapositiva {i} de {n}…"), { i: Math.min(done + 1, total), n: total })
    : phase === "building" ? t("pres_pptx_building", "Creando el archivo de PowerPoint…")
    : phase === "done" ? t("pres_pptx_done", "¡Listo! Descargando…")
    : t("pres_pptx_error", "No se ha podido exportar");

  return (
    <>
      {/* Escenario fuera de pantalla a tamaño real */}
      <div ref={stageRef} className={styles.exportStage} aria-hidden="true">
        <SlideDataContext.Provider value={{ ...data, period, companies }}>
          {slides.map((sl, i) => (
            <div key={sl.id} data-export-slide={i} className={styles.exportSlide}>
              <SlideCanvas designId={sl.designId} layoutId={sl.layoutId} themes={snapshot.themes}
                title={sl.title} subtitle={sl.subtitle} slots={sl.slots} number={i + 1} exportMode />
            </div>
          ))}
        </SlideDataContext.Provider>
      </div>

      <ModalPortal onClose={() => { cancelled.current = true; onDone?.(); }}>
        <div className={cx(styles.dialog, styles.exDialog)} role="dialog" aria-modal="true" aria-live="polite"
          onMouseDown={e => e.stopPropagation()} style={{ "--k-primary": colors.primary }}>
          <div className={cx(styles.exIcon, phase === "done" && styles.exIconDone, phase === "error" && styles.exIconError)}>
            {phase === "done" ? <Check size={26} strokeWidth={3} /> : phase === "error" ? <AlertTriangle size={24} /> : <Presentation size={24} />}
          </div>
          <h2 className={styles.exTitle}>{t("pres_pptx_title", "Exportar a PowerPoint")}</h2>
          <p className={styles.exName}>{presentation.name}</p>
          <div className={styles.exBar}><span style={{ width: `${pct}%` }} /></div>
          <p className={styles.exLabel}>{label}</p>
          {error && <p className={styles.exError}>{error}</p>}
          {phase === "capturing" && total > 0 && (
            <div className={styles.exDots}>
              {slides.map((sl, i) => <span key={sl.id} className={cx(styles.exDot, i < done && styles.exDotOn)} />)}
            </div>
          )}
          {phase !== "done" && (
            <button type="button" className={styles.btnGhost} onClick={() => { cancelled.current = true; onDone?.(); }}>
              {phase === "error" ? t("pres_close", "Cerrar") : t("pres_cancel", "Cancelar")}
            </button>
          )}
        </div>
      </ModalPortal>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Actualizar periodo y filtros de golpe (fuente, perímetro, año, mes y
   modo YTD/mensual) en todas las diapositivas o en las elegidas.
     · Todas las diapositivas: cambia el periodo general de la presentación
       y, si se marca, también los bloques que tenían valores propios.
     · Algunas: los bloques de esas diapositivas reciben el valor fijado
       (el resto de la presentación no cambia).
   Gráficas: fuente, perímetro y modo en sus filtros; año y mes mueven su
   rango para que termine en el mes elegido (los "últimos N meses" ya
   siguen el periodo general).
   ══════════════════════════════════════════════════════════════════════ */
const PERIOD_FIELDS = ["source", "structure", "year", "month", "mode"];

function rangeEndingAt(range, year, month) {
  // Rango fijo de una gráfica desplazado para que termine en year/month.
  const len = (r) => (Number(r.toYear) - Number(r.fromYear)) * 12 + (Number(r.toMonth) - Number(r.fromMonth));
  const n = range?.type === "fixed" && range.fromYear ? len(range) : Math.max(1, (Number(range?.months) || 12) - 1);
  let fy = Number(year), fm = Number(month) - n;
  while (fm < 1) { fm += 12; fy -= 1; }
  return { type: "fixed", fromYear: String(fy), fromMonth: String(fm), toYear: String(year), toMonth: String(month) };
}

function updateSlotPeriod(content, values, { force, explicit }) {
  if (!content || !["kpi", "chart", "accounts", "sheet", "contrib"].includes(content.kind)) return { content, touched: false };
  const fields = Object.keys(values);
  let touched = false;
  const patchFilters = (filters, allowed) => {
    const f = { ...(filters ?? {}) };
    allowed.filter(k => fields.includes(k)).forEach(k => {
      const own = f[k] != null && f[k] !== "";
      if (own && !force) return;                 // bloque fijado a mano: se respeta
      if (explicit || own) { if (f[k] !== values[k]) { f[k] = values[k]; touched = true; } }
    });
    return Object.keys(f).length ? f : null;
  };
  if (content.kind === "chart") {
    const next = { ...content };
    if (next.shared) next.shared = { ...next.shared, filters: patchFilters(next.shared.filters, ["source", "structure", "mode"]) };
    if (Array.isArray(next.series)) next.series = next.series.map(sr => (sr.filters ? { ...sr, filters: patchFilters(sr.filters, ["source", "structure", "mode"]) } : sr));
    if (values.year || values.month) {
      const fixed = next.range?.type === "fixed";
      if (fixed || explicit) {
        const end = { year: values.year ?? next.range?.toYear, month: values.month ?? next.range?.toMonth };
        if (end.year && end.month) { next.range = rangeEndingAt(next.range, end.year, end.month); touched = true; }
      }
    }
    return { content: next, touched };
  }
  return { content: { ...content, filters: patchFilters(content.filters, PERIOD_FIELDS) }, touched };
}

function BulkPeriodModal({ presentation, period, sources, structures, onApply, onClose, labelOf = (c) => c.label ?? c.kpiId, entityName = (e) => e }) {
  const t = useT();
  const slides = useMemo(() => presentation.slides ?? [], [presentation.slides]);
  const monthName = (m) => t(`month_${m}`, String(m));
  const modeName = (m) => (m === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"));
  const yearNow = new Date().getFullYear();
  const years = [...new Set([...Array.from({ length: 8 }, (_, i) => String(yearNow - i)), String(period.year)])].sort((a, b) => b - a);
  const [values, setValues] = useState({ ...period });
  const [on, setOn] = useState({ source: false, structure: false, year: true, month: true, mode: false });
  const [scope, setScope] = useState("all"); // all | some
  const [picked, setPicked] = useState(() => new Set(slides.map(s => s.id)));
  const [force, setForce] = useState(true);
  const chosen = Object.fromEntries(PERIOD_FIELDS.filter(k => on[k]).map(k => [k, String(values[k] ?? "")]));
  const targetIds = scope === "all" ? slides.map(s => s.id) : slides.filter(s => picked.has(s.id)).map(s => s.id);

  // ── Comparativos: KPIs que se comparan con otro periodo ─────────────
  const cmpBlocks = useMemo(() => {
    const out = [];
    slides.forEach((sl, i) => Object.entries(sl.slots ?? {}).forEach(([slotId, c]) => {
      if (c?.kind === "kpi" && c.kpiId && c.compare?.preset && c.compare.preset !== "none") {
        out.push({ key: `${sl.id}:${slotId}`, slideId: sl.id, slotId, n: i + 1, content: c });
      }
    }));
    return out;
  }, [slides]);
  const [cmpEdits, setCmpEdits] = useState({}); // key → comparativo nuevo
  const cmpOf = (b) => cmpEdits[b.key] ?? b.content.compare;
  const setCmp = (key, patch) => setCmpEdits(e => {
    const base = e[key] ?? cmpBlocks.find(b => b.key === key)?.content.compare ?? {};
    return { ...e, [key]: { ...base, ...patch } };
  });
  const setAllCmp = (preset) => setCmpEdits(Object.fromEntries(cmpBlocks
    .filter(b => targetIds.includes(b.slideId))
    .map(b => [b.key, preset === "custom"
      ? { preset, year: String(Number(values.year ?? period.year) - 1), month: String(values.month ?? period.month), source: b.content.compare?.source, structure: b.content.compare?.structure }
      : { preset }])));
  const cmpTargets = cmpBlocks.filter(b => targetIds.includes(b.slideId));
  const cmpChanged = cmpTargets.filter(b => cmpEdits[b.key] && JSON.stringify(cmpEdits[b.key]) !== JSON.stringify(b.content.compare)).length;
  const presetName = (p) => ({ none: t("pres_cmp_none", "Sin comparar"), prev_year: t("pres_cmp_prev_year", "Año anterior"), prev_month: t("pres_cmp_prev_month", "Mes anterior"), custom: t("pres_cmp_custom", "Personalizado") }[p ?? "none"]);
  // Con qué periodo se comparará cada KPI tras la actualización
  const cmpTargetText = (b) => {
    const c = cmpOf(b);
    const sp = slotPeriod({ ...period, ...(scope === "all" ? chosen : {}) }, scope === "all" ? b.content : updateSlotPeriod(b.content, chosen, { force, explicit: true }).content);
    const cp = resolveComparePeriod(sp, c);
    return cp ? `${monthName(cp.month)} ${cp.year}${cp.source !== sp.source ? ` · ${cp.source}` : ""}` : "—";
  };
  // Vista previa: cuántos bloques cambian en cada diapositiva
  const impact = slides.map(sl => {
    const target = targetIds.includes(sl.id);
    let n = 0, blocks = 0;
    Object.values(sl.slots ?? {}).forEach(c => {
      if (!c || !["kpi", "chart", "accounts", "sheet", "contrib"].includes(c.kind)) return;
      blocks += 1;
      const r = updateSlotPeriod(c, chosen, { force, explicit: scope !== "all" });
      if (r.touched) n += 1;
    });
    return { id: sl.id, n, blocks, target };
  });
  const totalBlocks = impact.filter(x => x.target).reduce((s, x) => s + x.blocks, 0);
  const changing = Object.keys(chosen).length;
  const fieldRow = (key, label, control) => (
    <div className={cx(styles.bpRow, on[key] && styles.bpRowOn)}>
      <button type="button" className={cx(styles.ddCheck, on[key] && styles.ddCheckOn)} aria-pressed={on[key]}
        onClick={() => setOn(o => ({ ...o, [key]: !o[key] }))}>{on[key] && <Check size={11} strokeWidth={3} />}</button>
      <span className={styles.bpLabel}>{label}</span>
      <div className={styles.bpControl}>{control}</div>
    </div>
  );
  const set = (k) => (v) => { setValues(x => ({ ...x, [k]: v })); setOn(o => ({ ...o, [k]: true })); };
  const summaryText = PERIOD_FIELDS.filter(k => on[k]).map(k => (
    k === "month" ? monthName(values.month) : k === "mode" ? modeName(values.mode) : values[k]
  )).join(" · ");

  const steps = [
    {
      id: "what", icon: CalendarRange, title: t("pres_bulk_what", "¿Qué datos quieres actualizar?"),
      hint: t("pres_bulk_what_hint", "Marca lo que cambia y elige el valor nuevo. Lo que no marques se queda como está."),
      summary: summaryText, valid: changing > 0 || cmpBlocks.length > 0,
      content: (
        <div className={styles.bpRows}>
          {fieldRow("year", t("filter_year", "Año"), <Dropdown value={String(values.year)} options={years.map(v => ({ value: v, label: v }))} onChange={set("year")} ariaLabel={t("filter_year", "Año")} />)}
          {fieldRow("month", t("filter_month", "Mes"), <Dropdown value={String(values.month)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))} onChange={set("month")} ariaLabel={t("filter_month", "Mes")} />)}
          {fieldRow("mode", t("pres_mode", "Modo"), (
            <div className={styles.tabs} role="tablist">
              {["ytd", "monthly"].map(m => (
                <button key={m} type="button" role="tab" aria-selected={values.mode === m}
                  className={cx(styles.tab, values.mode === m && styles.tabActive)} onClick={() => set("mode")(m)}>{modeName(m)}</button>
              ))}
            </div>
          ))}
          {fieldRow("source", t("filter_source", "Fuente"), <Dropdown value={values.source ?? ""} options={sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }))} onChange={set("source")} ariaLabel={t("filter_source", "Fuente")} />)}
          {fieldRow("structure", t("filter_structure", "Perímetro"), <Dropdown value={values.structure ?? ""} options={structures.map(x => optStructure(x)).filter(Boolean).map(v => ({ value: v, label: v }))} onChange={set("structure")} ariaLabel={t("filter_structure", "Perímetro")} />)}
        </div>
      ),
    },
    {
      id: "where", icon: Layers, title: t("pres_bulk_where", "¿En qué diapositivas?"),
      hint: t("pres_bulk_where_hint", "En todas, o solo en las que elijas."),
      summary: scope === "all" ? t("pres_bulk_all_slides", "Todas") : fill(t("pres_bulk_n_slides", "{n} diapositivas"), { n: targetIds.length }),
      valid: targetIds.length > 0,
      content: (
        <>
          <div className={styles.tabs} role="tablist" style={{ maxWidth: 420 }}>
            {[["all", t("pres_bulk_all_slides", "Todas")], ["some", t("pres_bulk_some_slides", "Elegir diapositivas")]].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={scope === id}
                className={cx(styles.tab, scope === id && styles.tabActive)} onClick={() => setScope(id)}>{label}</button>
            ))}
          </div>
          <div className={styles.bpSlides}>
            {slides.map((sl, i) => {
              const sel = scope === "all" || picked.has(sl.id);
              const imp = impact.find(x => x.id === sl.id);
              return (
                <button key={sl.id} type="button" disabled={scope === "all"}
                  className={cx(styles.bpSlide, sel && styles.bpSlideOn)} style={{ "--i": Math.min(i, 16) }}
                  onClick={() => setPicked(prev => { const n = new Set(prev); if (n.has(sl.id)) n.delete(sl.id); else n.add(sl.id); return n; })}>
                  <span className={styles.bpThumb}>
                    <SlideCanvas designId={sl.designId} layoutId={sl.layoutId} themes={presentation.themes} title={sl.title} subtitle={sl.subtitle} slots={sl.slots} />
                  </span>
                  <span className={styles.bpSlideMeta}>
                    <b>{i + 1}</b>
                    <em>
                      {imp?.blocks ? fill(t("pres_bulk_blocks", "{n} bloques con datos"), { n: imp.blocks }) : t("pres_bulk_no_blocks", "Sin datos")}
                      {cmpBlocks.some(b => b.slideId === sl.id) && <span className={styles.bpCmpTag}><ArrowLeftRight size={10} />{cmpBlocks.filter(b => b.slideId === sl.id).length}</span>}
                    </em>
                  </span>
                  {sel && scope !== "all" && <span className={styles.wzCardCheck}><Check size={12} strokeWidth={3} /></span>}
                </button>
              );
            })}
          </div>
          <label className={styles.vpSwitch}>
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
            <span className={styles.vpSwitchTrack}><span className={styles.vpSwitchThumb} /></span>
            <span>{t("pres_bulk_force", "Cambiar también los bloques con periodo o filtros propios (fijados a mano)")}</span>
          </label>
        </>
      ),
    },
    ...(cmpTargets.length ? [{
      id: "compare", icon: ArrowLeftRight, optional: true,
      title: t("pres_bulk_cmp", "¿Y los comparativos?"),
      hint: t("pres_bulk_cmp_hint", "Estos KPIs se comparan con otro periodo. Ajústalos aquí, uno a uno o todos a la vez."),
      summary: cmpChanged ? fill(t("pres_bulk_cmp_changed", "{n} cambiados"), { n: cmpChanged }) : fill(t("pres_bulk_cmp_count", "{n} comparativos"), { n: cmpTargets.length }),
      content: (
        <>
          <div className={styles.bpCmpAll}>
            <span>{t("pres_bulk_cmp_all", "Poner todos en")}</span>
            {["prev_year", "prev_month", "custom", "none"].map(pr => (
              <button key={pr} type="button" className={styles.chip} onClick={() => setAllCmp(pr)}>{presetName(pr)}</button>
            ))}
          </div>
          <div className={styles.bpCmpList}>
            {cmpTargets.map((b, i) => {
              const c = cmpOf(b);
              const changed = !!cmpEdits[b.key] && JSON.stringify(cmpEdits[b.key]) !== JSON.stringify(b.content.compare);
              return (
                <div key={b.key} className={cx(styles.bpCmpRow, changed && styles.bpCmpRowOn)} style={{ "--i": Math.min(i, 14) }}>
                  <span className={styles.bpCmpSlide}>{b.n}</span>
                  <span className={styles.bpCmpWho}>
                    <b>{labelOf(b.content)}</b>
                    <em>{entityName(b.content.entity)} · {t("pres_bulk_cmp_vs", "compara con")} <strong>{cmpTargetText(b)}</strong></em>
                  </span>
                  <div className={styles.bpCmpCtl}>
                    <div className={styles.tabs} role="tablist">
                      {["prev_year", "prev_month", "custom", "none"].map(pr => (
                        <button key={pr} type="button" role="tab" aria-selected={c?.preset === pr}
                          className={cx(styles.tab, c?.preset === pr && styles.tabActive)}
                          onClick={() => setCmp(b.key, pr === "custom"
                            ? { preset: pr, year: c?.year || String(Number(values.year ?? period.year) - 1), month: c?.month || String(values.month ?? period.month) }
                            : { preset: pr })}>
                          {presetName(pr)}
                        </button>
                      ))}
                    </div>
                    {c?.preset === "custom" && (
                      <div className={styles.bpCmpCustom}>
                        <Dropdown value={String(c.year ?? "")} options={years.map(v => ({ value: v, label: v }))} onChange={v => setCmp(b.key, { year: v })} ariaLabel={t("filter_year", "Año")} />
                        <Dropdown value={String(c.month ?? "")} options={Array.from({ length: 12 }, (_, k) => ({ value: String(k + 1), label: monthName(k + 1) }))} onChange={v => setCmp(b.key, { month: v })} ariaLabel={t("filter_month", "Mes")} />
                        <Dropdown value={c.source ?? ""} options={[{ value: "", label: t("pres_bulk_same_source", "Misma fuente") }, ...sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }))]} onChange={v => setCmp(b.key, { source: v })} ariaLabel={t("filter_source", "Fuente")} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ),
    }] : []),
  ];
  const preview = (
    <>
      <div className={styles.bpBig}>
        <span>{t("pres_bulk_blocks_total", "Bloques afectados")}</span>
        <b>{totalBlocks}</b>
        <em>{fill(t("pres_bulk_in_slides", "en {n} diapositivas"), { n: targetIds.length })}</em>
      </div>
      {cmpTargets.length > 0 && (
        <div className={styles.bpCmpNote}>
          <ArrowLeftRight size={14} />
          <span>
            {fill(t("pres_bulk_cmp_note", "{n} KPIs con comparativo"), { n: cmpTargets.length })}
            {cmpChanged > 0 && <b> · {fill(t("pres_bulk_cmp_changed", "{n} cambiados"), { n: cmpChanged })}</b>}
          </span>
        </div>
      )}
      <ul className={styles.wzFacts}>
        {PERIOD_FIELDS.filter(k => on[k]).map(k => (
          <li key={k}>
            <span>{{ source: t("filter_source", "Fuente"), structure: t("filter_structure", "Perímetro"), year: t("filter_year", "Año"), month: t("filter_month", "Mes"), mode: t("pres_mode", "Modo") }[k]}</span>
            <b>
              <s>{k === "month" ? monthName(period.month) : k === "mode" ? modeName(period.mode) : period[k]}</s>
              {" → "}{k === "month" ? monthName(values.month) : k === "mode" ? modeName(values.mode) : values[k]}
            </b>
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <Wizard
      title={t("pres_bulk_title", "Actualizar periodo y filtros")}
      steps={steps}
      preview={preview}
      onClose={onClose}
      finishLabel={t("pres_bulk_apply", "Actualizar")}
      onFinish={() => {
        if ((changing || cmpChanged) && targetIds.length) {
          const compares = {};
          cmpTargets.forEach(b => { if (cmpEdits[b.key]) compares[b.key] = cmpEdits[b.key]; });
          onApply({ values: chosen, slideIds: targetIds, all: scope === "all", force, compares });
          onClose();
        }
      }}
    />
  );
}

/* Menú desplegable del botón principal del editor */
function ActionMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className={styles.amWrap}>
      <button type="button" className={cx(styles.hdrBtn, styles.hdrPill, styles.hdrPrimary, styles.amTrigger, open && styles.amTriggerOn)}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Plus size={15} strokeWidth={2.4} className={styles.amPlus} />
        <span>{label}</span>
        <ChevronDown size={14} className={styles.amChev} />
      </button>
      {open && (
        <div className={styles.amMenu} role="menu">
          {items.filter(Boolean).map((it, i) => (it === "sep" ? <span key={`s${i}`} className={styles.amSep} /> : (
            <button key={it.id} type="button" role="menuitem" className={cx(styles.amItem, it.accent && styles.amItemAccent)}
              style={{ "--i": i }} onClick={() => { setOpen(false); it.onClick(); }} disabled={it.disabled}>
              <span className={styles.amIcon}><it.icon size={16} strokeWidth={2.1} /></span>
              <span className={styles.amText}><b>{it.label}</b>{it.hint && <em>{it.hint}</em>}</span>
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Asistente paso a paso (todos los selectores de bloques: KPI, gráfica,
   cuentas, sábana y contributivo).
     · Riel a la izquierda: los pasos numerados; los completados muestran lo
       elegido y se puede volver a cualquiera ya alcanzado.
     · Centro: el paso actual (título, explicación y controles), que entra
       deslizándose en la dirección del avance.
     · Derecha (opcional): vista previa en vivo de lo que se está montando.
     · Pie: barra de progreso, Atrás / Siguiente y Guardar en cuanto todo lo
       obligatorio está listo.
   Cada paso: { id, title, hint, icon, summary, valid, optional, content }.
   "content" puede ser una función ({ next }) para avanzar sola (p. ej. al
   elegir un KPI de la lista).
   ══════════════════════════════════════════════════════════════════════ */
function Wizard({ title, steps, onClose, onFinish, finishLabel, extraFoot = null, preview = null, previewWide = false, headExtra = null, startAt = 0, instant = false, swapAnim = false }) {
  const t = useT();
  const [idx, setIdx] = useState(Math.min(startAt, steps.length - 1));
  const [dir, setDir] = useState(1);
  const [reached, setReached] = useState(Math.min(startAt, steps.length - 1));
  const step = steps[Math.min(idx, steps.length - 1)];
  const allValid = steps.every(st => st.valid !== false);
  const canGo = (i) => i <= reached || steps.slice(0, i).every(st => st.valid !== false);
  const go = (i) => {
    if (i < 0 || i >= steps.length || i === idx || !canGo(i)) return;
    setDir(i > idx ? 1 : -1);
    setIdx(i);
    setReached(r => Math.max(r, i));
  };
  const next = () => { if (step.valid !== false) go(idx + 1); };
  const last = idx === steps.length - 1;
  // Avance automático desde el contenido (p. ej. al elegir un KPI): se pide
  // aquí y se hace en el siguiente render, cuando el paso ya es válido.
  const [pendingNext, setPendingNext] = useState(false);
  const requestNext = () => setPendingNext(true);
  useEffect(() => {
    if (!pendingNext) return;
    const id = setTimeout(() => {
      setPendingNext(false);
      if (step.valid !== false && !last) go(idx + 1);
    }, 240);
    return () => clearTimeout(id);
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      const tag = (e.target?.tagName ?? "").toLowerCase();
      if (e.key === "Enter" && tag !== "textarea" && tag !== "input" && !e.target?.closest?.("[role=listbox]")) {
        if (last && allValid) onFinish(); else if (!last && step.valid !== false) next();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const progress = ((idx + 1) / steps.length) * 100;
  const content = typeof step.content === "function" ? step.content({ next: requestNext }) : step.content;
  return (
    <ModalPortal onClose={onClose} instant={instant}>
      <div className={cx(styles.dialog, styles.wzDialog, instant && styles.noIntro)} role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={e => e.stopPropagation()}>
        <div className={styles.wzHead}>
          <div className={styles.wzHeadText}>
            <span className={styles.wzKicker}>{fill(t("pres_wz_step_of", "Paso {i} de {n}"), { i: idx + 1, n: steps.length })}</span>
            <h2 className={styles.wzTitle}>{title}</h2>
          </div>
          {headExtra}
          <button type="button" className={styles.mClose} onClick={onClose} aria-label={t("pres_cancel", "Cancelar")}><X size={16} /></button>
        </div>

        <div className={cx(styles.wzBody, preview && styles.wzBodyPreview, preview && previewWide && styles.wzBodyPreviewWide, swapAnim && styles.kindSwap)}>
          <ol className={styles.wzRail}>
            {steps.map((st, i) => {
              const done = i < idx && st.valid !== false;
              const Icon = st.icon;
              return (
                <li key={st.id}>
                  <button type="button" disabled={!canGo(i)} onClick={() => go(i)}
                    className={cx(styles.wzRailItem, i === idx && styles.wzRailOn, done && styles.wzRailDone)}
                    style={{ "--i": i }}>
                    <span className={styles.wzDot}>
                      {done ? <Check size={13} strokeWidth={3} /> : Icon ? <Icon size={14} strokeWidth={2.2} /> : i + 1}
                    </span>
                    <span className={styles.wzRailText}>
                      <span className={styles.wzRailTitle}>
                        {st.title}{st.optional && <em className={styles.wzOptional}>{t("pres_wz_optional", "opcional")}</em>}
                      </span>
                      {st.summary && (i < idx || i <= reached) && <span className={styles.wzRailSummary}>{st.summary}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className={styles.wzMain}>
            <div key={step.id} className={cx(styles.wzStep, dir > 0 ? styles.wzInNext : styles.wzInPrev)}>
              <header className={styles.wzStepHead}>
                <h3 className={styles.wzStepTitle}>{step.title}</h3>
                {step.hint && <p className={styles.wzStepHint}>{step.hint}</p>}
              </header>
              <div className={styles.wzStepBody}>{content}</div>
            </div>
          </section>

          {preview && (
            <aside className={styles.wzPreview}>
              <span className={styles.wzPreviewLabel}>{t("pres_wz_preview", "Vista previa")}</span>
              <div className={styles.wzPreviewBox}>{preview}</div>
            </aside>
          )}
        </div>

        <div className={styles.wzFoot}>
          <span className={styles.wzProgress} aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
          <div className={styles.wzFootLeft}>{extraFoot}</div>
          <button type="button" className={styles.btnGhost} onClick={idx === 0 ? onClose : () => go(idx - 1)}>
            {idx === 0 ? t("pres_cancel", "Cancelar") : <><ChevronLeft size={14} />{t("pres_wz_back", "Atrás")}</>}
          </button>
          {!last && (
            <button type="button" className={cx(allValid ? styles.btnGhost : styles.btnPrimary, styles.wzNext)} disabled={step.valid === false} onClick={next}>
              {t("pres_wz_next", "Siguiente")}<ChevronRight size={14} />
            </button>
          )}
          {(last || allValid) && (
            <button type="button" className={cx(styles.btnPrimary, styles.wzFinish)} disabled={!allValid} onClick={onFinish}>
              <Check size={14} strokeWidth={3} />{finishLabel}
            </button>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

// Rango de fechas del filtro "Creada". Se calcula al elegir la opción.
function createdRange(value) {
  if (!value) return { value: "" };
  const now = new Date();
  if (value.endsWith("d")) return { value, from: now.getTime() - parseInt(value, 10) * 864e5, to: Infinity };
  if (value === "year") return { value, from: new Date(now.getFullYear(), 0, 1).getTime(), to: Infinity };
  if (value === "lastyear") return { value, from: new Date(now.getFullYear() - 1, 0, 1).getTime(), to: new Date(now.getFullYear(), 0, 1).getTime() - 1 };
  return { value: "" };
}

/* ══════════════════════════════════════════════════════════════════════
   Librería
   ══════════════════════════════════════════════════════════════════════ */
function Library({ presentations, search, created, creator, scope = "", onOpen, onCreate, onDuplicate, onDelete, onShare, onExport, docType = "deck" }) {
  const t = useT();
  const filtering = !!(search.trim() || created?.value || creator || scope);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...presentations]
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .filter(p => !q || (p.name ?? "").toLowerCase().includes(q))
      .filter(p => {
        if (!created?.value) return true;
        const d = Date.parse(p.createdAt ?? p.updatedAt ?? "");
        return d >= created.from && d <= created.to;
      })
      .filter(p => !creator || (creator === "__none__" ? !p.createdBy?.id : p.createdBy?.id === creator))
      .filter(p => {
        if (!scope) return true;
        if (scope === "mine") return p.isOwner;
        if (scope === "shared") return !p.isOwner && p.visibility === "shared";
        if (scope === "company") return p.visibility === "company";
        return true;
      });
  }, [presentations, search, created, creator, scope]);

  if (presentations.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}><Presentation size={30} strokeWidth={2} /></div>
        <h2 className={styles.emptyTitle}>{docType === "memory" ? t("mem_empty_title", "Todavía no hay memorias") : t("pres_empty_title", "Todavía no hay presentaciones")}</h2>
        <p className={styles.emptyText}>{docType === "memory" ? t("mem_empty_text", "Crea la primera: elige sociedad o grupo, periodo y modelo, y las notas se rellenan solas.") : t("pres_empty_text", "Crea la primera a partir de una plantilla de diseño.")}</p>
        <button type="button" className={styles.btnPrimary} onClick={onCreate}>
          <Plus size={15} strokeWidth={2.4} />
          {docType === "memory" ? t("mem_new", "Nueva memoria") : t("pres_new", "Nueva presentación")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.libGrid}>
      {!filtering && (
        <button type="button" className={styles.createTile} onClick={onCreate}>
          <span className={styles.createIcon}><Plus size={22} strokeWidth={2.2} /></span>
          <span className={styles.createLabel}>{docType === "memory" ? t("mem_new", "Nueva memoria") : t("pres_new", "Nueva presentación")}</span>
        </button>
      )}

      {items.map(p => {
        const n = p.slides?.length ?? 0;
        const slidesLabel = n === 1
          ? t("pres_slides_one", "1 diapositiva")
          : fill(t("pres_slides_other", "{n} diapositivas"), { n });
        const first = p.slides?.[0];
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            className={styles.card}
            onClick={() => onOpen(p.id)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.id); } }}
          >
            <div className={styles.cardThumb}>
              {p.docType === "memory" ? (
                <div className={styles.memThumb}>
                  <span className={styles.memThumbKicker}>{p.memory?.scope === "consolidated" ? t("mem_consolidated", "Consolidada") : t("mem_individual", "Individual")} · {p.memory?.period?.year}</span>
                  <span className={styles.memThumbTitle}>{p.name}</span>
                  {(p.memory?.notes ?? []).filter(n => !n.hidden).slice(0, 5).map((n, i) => (
                    <span key={n.id} className={styles.memThumbLine}><b>{i + 1}</b>{n.title}</span>
                  ))}
                </div>
              ) : (
                <SlideCanvas className={styles.cardSlide} designId={first?.designId} layoutId={first?.layoutId} themes={p.themes} title={first?.title} subtitle={first?.subtitle} slots={first?.slots} />
              )}
            </div>
            <div className={styles.cardMeta}>
              <p className={styles.cardName} title={p.name}>
                {p.name}
              </p>
              <div className={styles.cardBadges}>
                <VisibilityBadge visibility={p.visibility} />
                {!p.canEdit && <span className={cx(styles.visBadge, styles.vis_readonly)}><Eye size={11} strokeWidth={2.4} />{t("pres_readonly_short", "Solo lectura")}</span>}
              </div>
              <p className={styles.cardSub}>
                {slidesLabel}
                <span className={styles.dotSep} aria-hidden="true" />
                {fill(t("pres_edited", "Editada el {date}"), { date: fmtDate(p.updatedAt) })}
              </p>
              {p.createdBy?.name && (
                <p className={styles.cardBy}>
                  <span className={styles.cardAvatar}>{p.createdBy.name.trim().charAt(0).toUpperCase()}</span>
                  {p.createdBy.name}
                </p>
              )}
            </div>
            <div className={styles.cardActions}>
              {p.isOwner && (
                <button type="button" className={styles.iconBtn} title={t("pres_share", "Compartir")}
                  onClick={e => { e.stopPropagation(); onShare?.(p.id); }}>
                  <Share2 size={14} />
                </button>
              )}
              {p.docType !== "memory" && (
                <button type="button" className={styles.iconBtn} title={t("pres_pptx_title", "Exportar a PowerPoint")}
                  onClick={e => { e.stopPropagation(); onExport?.(p.id); }}>
                  <Download size={14} />
                </button>
              )}
              <button type="button" className={styles.iconBtn} title={t("pres_duplicate", "Duplicar")}
                onClick={e => { e.stopPropagation(); onDuplicate(p.id); }}>
                <Copy size={14} />
              </button>
              {p.isOwner && (
                <button type="button" className={cx(styles.iconBtn, styles.iconDanger)} title={t("pres_delete", "Eliminar")}
                  onClick={e => { e.stopPropagation(); onDelete(p.id); }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {items.length === 0 && (
        <p className={styles.noResults}>{t("pres_no_results", "No hay presentaciones que coincidan con la búsqueda.")}</p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Nueva memoria: ámbito → sociedad o grupo → periodo → modelo y nombre.
   Al terminar se crean todas las notas del modelo, ya rellenas con datos.
   ══════════════════════════════════════════════════════════════════════ */
function NewMemoryWizard({ companies, sources, structures, onCreate, onClose }) {
  const t = useT();
  const defaults = usePeriodDefaults(sources, structures, companies);
  const [scope, setScope] = useState("individual");
  const [entity, setEntity] = useState("");
  const [period, setPeriod] = useState(null);
  const [model, setModel] = useState("pgc_normal");
  const [name, setName] = useState("");
  const p = period ?? { source: defaults.source, structure: defaults.structure, year: String(defaults.year), month: String(defaults.month) };
  const monthName = (mm) => t(`month_${mm}`, String(mm));
  const yearNow = new Date().getFullYear();
  const companyOpts = companies.map(c => ({ value: optCompany(c), label: companyName(companies, optCompany(c)) })).filter(o => o.value);
  const ent = entity || companyOpts[0]?.value || "";
  const autoName = `${t("mem_doc", "Memoria")} ${companyName(companies, ent) || ent} ${p.year}`;
  const card = (on, Icon, title, text, onClick) => (
    <button type="button" className={cx(styles.wzCard, on && styles.wzCardOn)} aria-pressed={on} onClick={onClick}>
      {on && <span className={styles.wzCardCheck}><Check size={12} strokeWidth={3} /></span>}
      <span className={styles.wzCardIcon}><Icon size={20} strokeWidth={2} /></span>
      <span className={styles.wzCardTitle}>{title}</span>
      <span className={styles.wzCardText}>{text}</span>
    </button>
  );
  const steps = [
    {
      id: "scope", icon: Layers, title: t("mem_wz_scope", "¿Memoria individual o consolidada?"),
      hint: t("mem_wz_scope_hint", "Individual: las cuentas de una sociedad. Consolidada: las de un grupo, ya consolidadas."),
      summary: scope === "consolidated" ? t("mem_consolidated", "Consolidada") : t("mem_individual", "Individual"), valid: true,
      content: ({ next }) => (
        <div className={styles.wzCards}>
          {card(scope === "individual", Building, t("mem_individual", "Individual"), t("mem_wz_ind", "Cuentas anuales de una sociedad."), () => { setScope("individual"); next(); })}
          {card(scope === "consolidated", Network, t("mem_consolidated", "Consolidada"), t("mem_wz_cons", "Cuentas anuales consolidadas de un grupo."), () => { setScope("consolidated"); next(); })}
        </div>
      ),
    },
    {
      id: "entity", icon: Building2, title: scope === "consolidated" ? t("mem_wz_group", "¿De qué grupo?") : t("mem_wz_company", "¿De qué sociedad?"),
      hint: t("mem_wz_entity_hint", "Elige la sociedad o la matriz del grupo."),
      summary: companyName(companies, ent) || ent, valid: !!ent,
      content: (
        <div style={{ maxWidth: 520 }}>
          <Dropdown value={ent} options={companyOpts} onChange={setEntity} ariaLabel={t("mem_wz_company", "Sociedad")} />
        </div>
      ),
    },
    {
      id: "period", icon: CalendarRange, title: t("mem_wz_period", "¿De qué periodo?"),
      hint: t("mem_wz_period_hint", "Normalmente, el cierre del ejercicio. El año anterior se toma solo como comparativo."),
      summary: `${monthName(p.month)} ${p.year} · ${p.source}`, valid: !!(p.year && p.month && p.source && p.structure),
      content: (
        <div className={styles.kpGrid2} style={{ maxWidth: 620 }}>
          <Dropdown value={String(p.year)} options={Array.from({ length: 8 }, (_, i) => ({ value: String(yearNow - i), label: String(yearNow - i) }))} onChange={v => setPeriod({ ...p, year: v })} ariaLabel={t("filter_year", "Año")} />
          <Dropdown value={String(p.month)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))} onChange={v => setPeriod({ ...p, month: v })} ariaLabel={t("filter_month", "Mes")} />
          <Dropdown value={p.source} options={sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }))} onChange={v => setPeriod({ ...p, source: v })} ariaLabel={t("filter_source", "Fuente")} />
          <Dropdown value={p.structure} options={structures.map(x => optStructure(x)).filter(Boolean).map(v => ({ value: v, label: v }))} onChange={v => setPeriod({ ...p, structure: v })} ariaLabel={t("filter_structure", "Perímetro")} />
        </div>
      ),
    },
    {
      id: "model", icon: FileText, title: t("mem_wz_model", "¿Qué modelo de memoria?"),
      hint: t("mem_wz_model_hint", "Las notas con tabla se rellenan solas con los datos; después puedes editarlo todo."),
      summary: t(`mem_model_${model}`, MEMORY_MODELS.find(x => x.id === model)?.label), valid: true,
      content: (
        <>
          <div className={styles.wzCards}>
            {MEMORY_MODELS.map(mm => <Fragment key={mm.id}>{card(model === mm.id, FileText, t(`mem_model_${mm.id}`, mm.label), t(`mem_model_${mm.id}_d`, mm.description), () => setModel(mm.id))}</Fragment>)}
          </div>
          <div style={{ maxWidth: 520, marginTop: 18 }}>
            <p className={styles.mLabel}>{t("mem_wz_name", "Nombre")}</p>
            <input className={styles.mInput} value={name} onChange={e => setName(e.target.value)} placeholder={autoName} />
          </div>
        </>
      ),
    },
  ];
  return (
    <Wizard
      title={t("mem_new", "Nueva memoria")}
      steps={steps}
      onClose={onClose}
      finishLabel={t("mem_create", "Crear memoria")}
      onFinish={() => onCreate({
        name: name.trim() || autoName,
        memory: { scope, entity: ent, model, period: { source: p.source, structure: p.structure, year: String(p.year), month: String(p.month) }, notes: notesForModel(model) },
      })}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Compartir una presentación (solo quien la crea): solo yo · toda la
   empresa · personas concretas (cada una con o sin permiso de edición).
   ══════════════════════════════════════════════════════════════════════ */
const VISIBILITY = [
  ["private", Lock, "pres_vis_private", "Solo yo", "pres_vis_private_hint", "Nadie más la ve."],
  ["company", Building2, "pres_vis_company", "Toda la empresa", "pres_vis_company_hint", "Todos los usuarios de la empresa pueden verla."],
  ["shared", Users, "pres_vis_shared", "Personas concretas", "pres_vis_shared_hint", "Solo las personas que elijas; tú decides quién puede editar."],
];

function VisibilityBadge({ visibility }) {
  const t = useT();
  const v = VISIBILITY.find(x => x[0] === visibility) ?? VISIBILITY[0];
  const Icon = v[1];
  return (
    <span className={cx(styles.visBadge, styles[`vis_${v[0]}`])} title={t(v[4], v[5])}>
      <Icon size={11} strokeWidth={2.4} />{t(v[2], v[3])}
    </span>
  );
}

function ShareDialog({ presentation, me, loadUsers, onSave, onClose }) {
  const t = useT();
  const [visibility, setVisibility] = useState(presentation.visibility ?? "private");
  const [shares, setShares] = useState(presentation.shares ?? []);
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    loadUsers().then(list => { if (alive) setUsers(list.filter(u => u.id !== me?.id)); });
    return () => { alive = false; };
  }, [loadUsers, me]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const has = (id) => shares.some(s => s.userId === id);
  const toggle = (id) => setShares(list => (has(id) ? list.filter(s => s.userId !== id) : [...list, { userId: id, canEdit: false }]));
  const setEdit = (id, v) => setShares(list => list.map(s => (s.userId === id ? { ...s, canEdit: v } : s)));
  const query = q.trim().toLowerCase();
  const shown = (users ?? []).filter(u => !query || `${u.name} ${u.email ?? ""}`.toLowerCase().includes(query));
  const canSave = visibility !== "shared" || shares.length > 0;
  const save = async () => {
    setSaving(true);
    const ok = await onSave({ visibility, shares });
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <ModalPortal onClose={onClose}>
      <div className={cx(styles.dialog, styles.shDialog)} role="dialog" aria-modal="true" aria-labelledby="pres-share-title"
        onMouseDown={e => e.stopPropagation()}>
        <div className={styles.mHead}>
          <div>
            <h2 id="pres-share-title" className={styles.mTitle}>{t("pres_share_title", "Compartir presentación")}</h2>
            <p className={styles.shSub}>{presentation.name}</p>
          </div>
          <button type="button" className={styles.mClose} onClick={onClose} aria-label={t("pres_cancel", "Cancelar")}><X size={16} /></button>
        </div>
        <div className={styles.shBody}>
          <p className={styles.shLabel}>{t("pres_share_who", "¿Quién puede verla?")}</p>
          <div className={styles.wzCards}>
            {VISIBILITY.map(v => {
              const [id, Icon, k1, f1, k2, f2] = v;
              const on = visibility === id;
              return (
                <button key={id} type="button" className={cx(styles.wzCard, on && styles.wzCardOn)} aria-pressed={on} onClick={() => setVisibility(id)}>
                  {on && <span className={styles.wzCardCheck}><Check size={12} strokeWidth={3} /></span>}
                  <span className={styles.wzCardIcon}><Icon size={20} strokeWidth={2} /></span>
                  <span className={styles.wzCardTitle}>{t(k1, f1)}</span>
                  <span className={styles.wzCardText}>{t(k2, f2)}</span>
                </button>
              );
            })}
          </div>

          {visibility === "company" && (
            <p className={styles.shNote}>{t("pres_share_company_note", "Tus compañeros podrán verla y duplicarla; solo tú (y quien tenga permiso de edición) puede cambiarla.")}</p>
          )}

          {visibility === "shared" && (
            <div className={styles.shPeople}>
              <div className={styles.shPeopleHead}>
                <p className={styles.shLabel}>{fill(t("pres_share_people", "Personas ({n})"), { n: shares.length })}</p>
                <input className={cx(styles.mInput, styles.shSearch)} value={q} onChange={e => setQ(e.target.value)}
                  placeholder={t("pres_share_search", "Buscar por nombre o correo")} aria-label={t("pres_share_search", "Buscar por nombre o correo")} />
              </div>
              <div className={styles.shList}>
                {users === null && <p className={styles.kpEmpty}>{t("pres_kpi_loading", "Cargando…")}</p>}
                {users && shown.length === 0 && <p className={styles.kpEmpty}>{t("pres_share_nobody", "No hay más usuarios en la empresa.")}</p>}
                {shown.map((u, i) => {
                  const on = has(u.id);
                  const sh = shares.find(s => s.userId === u.id);
                  return (
                    <div key={u.id} className={cx(styles.shRow, on && styles.shRowOn)} style={{ "--i": Math.min(i, 12) }}>
                      <button type="button" className={styles.shWho} onClick={() => toggle(u.id)} aria-pressed={on}>
                        <span className={cx(styles.ddCheck, on && styles.ddCheckOn)}>{on && <Check size={11} strokeWidth={3} />}</span>
                        <span className={styles.shAvatar}>{(u.name || "?").trim().charAt(0).toUpperCase()}</span>
                        <span className={styles.shName}>
                          <b>{u.name}</b>
                          {u.email && u.email !== u.name && <em>{u.email}</em>}
                        </span>
                      </button>
                      {on && (
                        <div className={styles.shPerm} role="tablist">
                          {[[false, t("pres_share_can_view", "Ver")], [true, t("pres_share_can_edit", "Editar")]].map(([v, label]) => (
                            <button key={String(v)} type="button" role="tab" aria-selected={!!sh?.canEdit === v}
                              className={cx(styles.shPermBtn, !!sh?.canEdit === v && styles.shPermOn)} onClick={() => setEdit(u.id, v)}>{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className={styles.mFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>{t("pres_cancel", "Cancelar")}</button>
          <button type="button" className={styles.btnPrimary} disabled={!canSave || saving} onClick={save}>
            {saving ? <Loader2 size={14} className={styles.spin} /> : <Share2 size={14} />}
            {t("pres_share_save", "Guardar")}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Modal de nueva presentación: nombre + diseño de partida, con vista
   previa en vivo.
   ══════════════════════════════════════════════════════════════════════ */
function NewPresentationModal({ onClose, onCreate }) {
  const t = useT();
  const [name, setName] = useState("");
  const [designId, setDesignId] = useState(DEFAULT_DESIGN_ID);
  const [hoverId, setHoverId] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = getDesign(hoverId ?? designId);
  const submit = () => onCreate(name, designId);

  return (
    <ModalPortal onClose={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="pres-new-title"
        onMouseDown={e => e.stopPropagation()}>
        <div className={styles.mHead}>
          <h2 id="pres-new-title" className={styles.mTitle}>{t("pres_new", "Nueva presentación")}</h2>
          <button type="button" className={styles.mClose} onClick={onClose} aria-label={t("pres_cancel", "Cancelar")}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.mBody}>
          <div className={styles.mCol}>
            <label className={styles.mLabel} htmlFor="pres-new-name">{t("pres_name", "Nombre")}</label>
            <input
              id="pres-new-name"
              className={styles.mInput}
              value={name}
              autoFocus
              placeholder={t("pres_name_ph", "Ej. Cierre julio 2026")}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
            />
            <div className={styles.mPreview}>
              <SlideCanvas className={styles.mPreviewSlide} designId={preview.id}
                title={name.trim() || t("pres_untitled", "Presentación sin título")} />
              <p className={styles.mCaption}>{t(preview.nameKey, preview.fallback)}</p>
            </div>
          </div>

          <div className={styles.mCol}>
            <p className={styles.mLabel}>{t("pres_pick_design", "Diseño de partida")}</p>
            <div className={styles.pickGrid}>
              {DESIGNS.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={cx(styles.pick, d.id === designId && styles.pickActive)}
                  onClick={() => setDesignId(d.id)}
                  onMouseEnter={() => setHoverId(d.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onFocus={() => setHoverId(d.id)}
                  onBlur={() => setHoverId(null)}
                >
                  <span className={styles.pickBox}>
                    <SlideCanvas designId={d.id} title={t(d.nameKey, d.fallback)} subtitle=" " />
                  </span>
                  <span className={styles.pickName}>
                    {d.id === designId && <Check size={12} strokeWidth={3} />}
                    {t(d.nameKey, d.fallback)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.mFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>{t("pres_cancel", "Cancelar")}</button>
          <button type="button" className={styles.btnPrimary} onClick={submit}>{t("pres_create", "Crear presentación")}</button>
        </div>
      </div>
    </ModalPortal>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Fila de color: muestra, selector nativo y código hexadecimal. El campo
   de texto se remonta (key) cuando cambia el valor desde fuera.
   ══════════════════════════════════════════════════════════════════════ */
function ColorRow({ label, value, custom, resetLabel, onChange, onReset }) {
  const commit = (el) => {
    const hex = normalizeHex(el.value);
    if (hex) { if (hex !== value) onChange(hex); el.value = hex; }
    else el.value = value;
  };
  return (
    <div className={styles.colorRow}>
      <label className={styles.colorSwatch} style={{ background: value }}>
        <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label={label} />
      </label>
      <span className={styles.colorLabel}>
        {label}
        {custom && <span className={styles.colorDot} aria-hidden="true" />}
      </span>
      <input
        key={value}
        className={styles.hexInput}
        defaultValue={value}
        spellCheck={false}
        maxLength={7}
        aria-label={`${label} (hex)`}
        onBlur={e => commit(e.currentTarget)}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      <button type="button" className={styles.colorReset} onClick={onReset} disabled={!custom}
        title={resetLabel} aria-label={resetLabel}>
        <RotateCcw size={12} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Opciones de datos (fuentes, perímetros, empresas) tal como llegan de la
   API, con sus distintas mayúsculas según el endpoint.
   ══════════════════════════════════════════════════════════════════════ */
const optSource    = (x) => (typeof x === "object" && x ? (x.Source ?? x.source ?? "") : String(x ?? ""));
const optStructure = (x) => (typeof x === "object" && x ? (x.GroupStructure ?? x.groupStructure ?? "") : String(x ?? ""));
const optCompany   = (x) => (typeof x === "object" && x ? (x.CompanyShortName ?? x.companyShortName ?? "") : String(x ?? ""));
const companyName  = (companies, short) => {
  const c = companies.find(x => optCompany(x) === short);
  return (c && (c.CompanyLegalName ?? c.companyLegalName)) || short;
};

/* ══════════════════════════════════════════════════════════════════════
   Desplegable propio (en lugar del <select> del sistema). Se pinta en un
   portal para que no lo recorte el modal; admite búsqueda, grupos, teclado
   y selección múltiple.
   ══════════════════════════════════════════════════════════════════════ */
// meta(o): texto a la derecha de cada opción (p. ej. su valor); toolbar: controles
// propios bajo el buscador (p. ej. filtros); wide: lista más ancha que el botón.
function Dropdown({ value, options, onChange, multiple = false, placeholder = "", ariaLabel, meta = null, toolbar = null, wide = false }) {
  const t = useT();
  const { colors } = useSettings();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);

  const selected = multiple ? new Set(value ?? []) : null;
  const current = multiple ? null : options.find(o => o.value === value);
  const searchable = options.length > 8 || !!toolbar;
  const query = q.trim().toLowerCase();
  const shown = query ? options.filter(o => String(o.label).toLowerCase().includes(query)) : options;

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Si abajo no hay sitio (p. ej. botón al final de un modal), se abre hacia arriba.
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    if (below < 280 && above > below) {
      setRect({ left: r.left, bottom: window.innerHeight - r.top + 6, width: r.width, maxH: above });
    } else {
      setRect({ left: r.left, top: r.bottom + 6, width: r.width, maxH: below });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    (searchRef.current ?? popRef.current)?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const openMenu = () => {
    place();
    setQ("");
    setHi(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  };
  const choose = (o) => {
    if (multiple) {
      const next = new Set(selected);
      if (next.has(o.value)) next.delete(o.value); else next.add(o.value);
      onChange([...next]);
    } else {
      onChange(o.value);
      setOpen(false);
      btnRef.current?.focus();
    }
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && shown[hi]) { e.preventDefault(); choose(shown[hi]); }
  };

  let display = current?.label ?? placeholder;
  if (multiple) {
    const n = selected.size;
    display = n === 0 ? placeholder
      : n === 1 ? (options.find(o => selected.has(o.value))?.label ?? placeholder)
      : fill(t("pres_n_selected", "{n} seleccionadas"), { n });
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx(styles.ddBtn, open && styles.ddBtnOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={e => {
          if (open) { onKey(e); return; }
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openMenu(); }
        }}
      >
        <span className={cx(styles.ddValue, !current && !(multiple && selected.size) && styles.ddPlaceholder)}>{display}</span>
        <ChevronDown size={14} className={styles.ddChevron} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          tabIndex={-1}
          className={styles.ddPop}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          onKeyDown={onKey}
          onMouseDown={e => e.stopPropagation()}
          style={{
            "--k-primary": colors.primary,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, wide ? 480 : 200) - 12)),
            ...(rect.bottom != null ? { bottom: rect.bottom } : { top: rect.top }),
            minWidth: Math.max(rect.width, wide ? 480 : 200),
            maxHeight: Math.max(160, Math.min(wide ? 420 : 340, rect.maxH)),
          }}
        >
          {searchable && (
            <div className={styles.ddSearch}>
              <Search size={13} />
              <input ref={searchRef} value={q} placeholder={t("pres_dd_search", "Buscar…")}
                onChange={e => { setQ(e.target.value); setHi(0); }} />
            </div>
          )}
          {toolbar && <div className={styles.ddToolbar} onMouseDown={e => e.preventDefault()}>{toolbar}</div>}
          <div className={styles.ddList}>
            {shown.length === 0 && <p className={styles.ddEmpty}>{t("pres_no_options", "Sin resultados")}</p>}
            {shown.map((o, i) => {
              // Cabecera de grupo cuando cambia respecto a la opción anterior.
              const header = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
              const isSel = multiple ? selected.has(o.value) : o.value === value;
              return (
                <Fragment key={`${o.group ?? ""}|${o.value}`}>
                  {header && <p className={styles.ddGroup}>{header}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={cx(styles.ddItem, isSel && styles.ddItemSel, i === hi && styles.ddItemHi)}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(o)}
                  >
                    {multiple && (
                      <span className={cx(styles.ddCheck, isSel && styles.ddCheckOn)}>
                        {isSel && <Check size={11} strokeWidth={3} />}
                      </span>
                    )}
                    <span className={styles.ddItemLabel}>{o.label}</span>
                    {meta && <span className={styles.ddMeta}>{meta(o)}</span>}
                    {!multiple && isSel && <Check size={13} strokeWidth={2.6} className={styles.ddTick} />}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Selector de KPI para un espacio: individual (por empresa) o consolidado
   (por grupo), con el valor de cada KPI en vivo para el periodo de la
   presentación.
   ══════════════════════════════════════════════════════════════════════ */
function KpiPickerModal({ data, companies, sources, structures, dimensions, period, initial, onPick, onRemove, onClose }) {
  const t = useT();
  const [scope, setScope] = useState(initial?.scope ?? "individual");
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState(initial?.filters ?? {});
  const [compare, setCompare] = useState(initial?.compare ?? { preset: "none" });
  const [display, setDisplay] = useState({ ...DEFAULT_KPI_DISPLAY, ...(initial?.display ?? {}) });
  const [kindFilter, setKindFilter] = useState("all"); // all | system | custom
  const [catFilter, setCatFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const { ensure, holdings, catalogs, resolveKpi, ready } = data;

  const companyOpts = useMemo(
    () => companies.map(c => ({ value: optCompany(c), label: companyName(companies, optCompany(c)) })).filter(o => o.value),
    [companies],
  );
  const groupOpts = useMemo(
    () => holdings.list.map(g => ({ value: g, label: companyName(companies, g) })),
    [holdings.list, companies],
  );
  const options = scope === "consolidated" ? groupOpts : companyOpts;
  const fallback = scope === "consolidated" ? (holdings.root || options[0]?.value) : options[0]?.value;
  const effEntity = options.some(o => o.value === entity) ? entity : (fallback ?? "");

  // Periodo efectivo del KPI (sus filtros + los de la presentación) y el
  // periodo con el que se compara.
  const sp = slotPeriod(period, { filters });
  const cp = resolveComparePeriod(sp, compare);
  const spKey = `${sp.source}|${sp.structure}|${sp.year}|${sp.month}`;
  const cpKey = cp ? `${cp.source}|${cp.structure}|${cp.year}|${cp.month}` : "";
  const spMode = sp.mode;
  useEffect(() => {
    const [source, structure, year, month] = spKey.split("|");
    ensure(scope, effEntity, { source, structure, year, month, mode: spMode });
  }, [ensure, scope, effEntity, spKey, spMode]);
  useEffect(() => {
    if (!cpKey) return;
    const [source, structure, year, month] = cpKey.split("|");
    ensure(scope, effEntity, { source, structure, year, month, mode: spMode });
  }, [ensure, scope, effEntity, cpKey, spMode]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }));
  const setCmp = (patch) => setCompare(c => ({ ...c, ...patch }));

  // Opciones de los desplegables.
  // "General · Legal": hereda el filtro del header (y muestra su valor actual).
  const inherit = (v) => `${t("pres_inherit", "General")} · ${v}`;
  const monthName = (m) => t(`month_${m}`, String(m));
  const modeName = (m) => (m === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"));
  const yearNow = new Date().getFullYear();
  const years = [...new Set([...Array.from({ length: 7 }, (_, i) => String(yearNow - i)), String(period.year)])]
    .sort((a, b) => Number(b) - Number(a));
  const sourceOpts = sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const structureOpts = structures.map(x => optStructure(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const yearOpts = years.map(v => ({ value: v, label: v }));
  const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }));
  const modeOpts = [{ value: "ytd", label: modeName("ytd") }, { value: "monthly", label: modeName("monthly") }];
  const dimOpts = useMemo(() => {
    const seen = new Set();
    return (dimensions ?? []).map(d => {
      const code = String(d.DimensionCode ?? d.dimensionCode ?? d.Code ?? d.code ?? "");
      const name = String(d.DimensionName ?? d.dimensionName ?? d.Name ?? d.name ?? code);
      const group = String(d.DimensionGroup ?? d.dimensionGroup ?? d.Group ?? d.group ?? "");
      return { value: code, label: name && name !== code ? `${name} (${code})` : code, group };
    }).filter(o => o.value && !seen.has(o.value) && seen.add(o.value))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [dimensions]);

  const catalog = catalogs[scope] ?? [];
  // Etiquetas internas (las que empiezan por "__") no se enseñan.
  const tagOf = (k) => (k.tag && !String(k.tag).startsWith("__") ? String(k.tag) : "");
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const catOpts = uniq(catalog.map(k => k.category)).map(v => ({ value: v, label: v }));
  const tagOpts = uniq(catalog.map(tagOf)).map(v => ({ value: v, label: v }));
  const query = q.trim().toLowerCase();
  const matches = catalog.filter(k => {
    if (kindFilter === "system" && k.custom) return false;
    if (kindFilter === "custom" && !k.custom) return false;
    if (catFilter && k.category !== catFilter) return false;
    if (tagFilter && tagOf(k) !== tagFilter) return false;
    if (!query) return true;
    return [k.label, k.category, tagOf(k), k.description].some(v => String(v ?? "").toLowerCase().includes(query));
  });
  const groups = [
    { id: "system", label: t("pres_kpi_system", "Biblioteca"), items: matches.filter(k => !k.custom) },
    { id: "custom", label: t("pres_kpi_custom", "Personalizados"), items: matches.filter(k => k.custom) },
  ].filter(g => g.items.length);

  const cleanFilters = () => {
    const out = {};
    ["source", "structure", "year", "month", "mode"].forEach(k => { if (filters[k]) out[k] = filters[k]; });
    if (Array.isArray(filters.dims) && filters.dims.length) out.dims = filters.dims;
    return Object.keys(out).length ? out : null;
  };
  const pick = (k) => onPick({
    kind: "kpi", scope, entity: effEntity, entityLabel: companyName(companies, effEntity),
    kpiId: k.id, label: k.label, format: k.format,
    filters: cleanFilters(),
    compare: compare.preset && compare.preset !== "none" ? compare : null,
    display,
  });
  const currentKpi = initial?.kpiId ? catalog.find(k => k.id === initial.kpiId) : null;
  const [chosenState, setChosen] = useState(null);
  const chosen = chosenState ?? currentKpi;

  // Al abrir con un KPI ya puesto, la lista se coloca en él (una sola vez,
  // cuando el catálogo está listo).
  const listRef = useRef(null);
  const activeRowRef = useRef(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !ready || !activeRowRef.current || !listRef.current) return;
    scrolledRef.current = true;
    const list = listRef.current;
    const row = activeRowRef.current;
    list.scrollTop = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
  });

  const withInherit = (opts, current) => [{ value: "", label: inherit(current) }, ...opts];

  // Asistente: el KPI elegido se guarda al final (no al hacer clic en la lista)
  const res0 = chosen ? resolveKpi({ scope, entity: effEntity, kpiId: chosen.id }, sp) : null;
  const cres0 = chosen && cp ? resolveKpi({ scope, entity: effEntity, kpiId: chosen.id }, cp) : null;
  const delta0 = res0?.status === "ok" && cres0?.status === "ok" ? kpiDelta(res0.value, cres0.value, chosen.format) : null;
  const entityName = companyName(companies, effEntity) || effEntity;
  const ownFilters = ["source", "structure", "year", "month", "mode"].filter(k => filters[k]).length + ((filters.dims ?? []).length ? 1 : 0);
  const cmpName = { none: t("pres_cmp_none", "Sin comparar"), prev_year: t("pres_cmp_prev_year", "Año anterior"), prev_month: t("pres_cmp_prev_month", "Mes anterior"), custom: t("pres_cmp_custom", "Personalizado") }[compare.preset ?? "none"];
  const steps = [
    {
      id: "scope", icon: Building2, title: t("pres_wz_kpi_scope", "¿De qué sociedad o grupo?"),
      hint: t("pres_wz_kpi_scope_hint", "Elige si el KPI es de una sociedad (individual) o de un grupo (consolidado), y cuál."),
      summary: `${scope === "consolidated" ? t("pres_kpi_consolidated", "Consolidado") : t("pres_kpi_individual", "Individual")} · ${entityName}`,
      valid: !!effEntity,
      content: (
            <div className={styles.kpRow2}>
              <div className={styles.kpField}>
                <span className={styles.mLabel}>{t("pres_kpi_scope", "Ámbito")}</span>
                <div className={styles.tabs} role="tablist">
                  {[["individual", t("pres_kpi_individual", "Individual")], ["consolidated", t("pres_kpi_consolidated", "Consolidado")]].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={scope === id}
                      className={cx(styles.tab, scope === id && styles.tabActive)}
                      onClick={() => { setScope(id); setEntity(""); }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.kpField}>
                <span className={styles.mLabel}>{scope === "consolidated" ? t("pres_kpi_group", "Grupo") : t("pres_kpi_company", "Empresa")}</span>
                <Dropdown value={effEntity} options={options} onChange={setEntity}
                  placeholder={scope === "consolidated" ? t("pres_no_groups", "No hay grupos consolidables") : ""}
                  ariaLabel={scope === "consolidated" ? t("pres_kpi_group", "Grupo") : t("pres_kpi_company", "Empresa")} />
              </div>
            </div>
      ),
    },
    {
      id: "kpi", icon: Gauge, title: t("pres_wz_kpi_pick", "¿Qué KPI quieres mostrar?"),
      hint: t("pres_wz_kpi_pick_hint", "Busca o filtra y haz clic en uno: al lado ves su valor para esa sociedad y periodo."),
      summary: chosen?.label ?? "", valid: !!chosen,
      content: ({ next }) => (
        <div className={styles.wzFill} style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            <div className={styles.kpFilterBar}>
                <input className={cx(styles.mInput, styles.kpSearch)} value={q} onChange={e => setQ(e.target.value)}
                  placeholder={t("pres_kpi_search", "Buscar KPI")} aria-label={t("pres_kpi_search", "Buscar KPI")} />
                <div className={cx(styles.tabs, styles.kpKindTabs)} role="tablist">
                  {[["all", t("pres_kpi_all", "Todos")], ["system", t("pres_kpi_system", "Biblioteca")], ["custom", t("pres_kpi_custom", "Personalizados")]].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={kindFilter === id}
                      className={cx(styles.tab, kindFilter === id && styles.tabActive)} onClick={() => setKindFilter(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <Dropdown value={catFilter} onChange={setCatFilter} ariaLabel={t("pres_kpi_category", "Categoría")}
                  options={[{ value: "", label: t("pres_all_categories", "Todas las categorías") }, ...catOpts]} />
                <Dropdown value={tagFilter} onChange={setTagFilter} ariaLabel={t("pres_kpi_tag", "Etiqueta")}
                  options={[{ value: "", label: t("pres_all_tags", "Todas las etiquetas") }, ...tagOpts]} />
              </div>
  
            <div className={styles.kpList} ref={listRef}>
              {!ready && <p className={styles.kpEmpty}>{t("pres_kpi_loading", "Cargando KPIs…")}</p>}
              {ready && groups.length === 0 && <p className={styles.kpEmpty}>{t("pres_kpi_none", "No hay KPIs que coincidan.")}</p>}
              {ready && groups.map(g => (
                <div key={g.id}>
                  <p className={styles.dpGroup}>{g.label}</p>
                  {g.items.map(k => {
                    const content = { scope, entity: effEntity, kpiId: k.id };
                    const res = resolveKpi(content, sp);
                    const val = res.status === "ok" ? formatKpiValue(res.value, k.format) : res.status === "loading" ? "…" : "—";
                    const cres = cp ? resolveKpi(content, cp) : null;
                    const delta = cres && res.status === "ok" && cres.status === "ok" ? kpiDelta(res.value, cres.value, k.format) : null;
                    const active = chosen?.id === k.id;
                    return (
                      <button key={k.id} ref={active ? activeRowRef : undefined} type="button"
                        className={cx(styles.kpRow, active && styles.kpRowActive)} onClick={() => { setChosen(k); next(); }}>
                        <span className={styles.kpRowMain}>
                          <span className={styles.kpRowLabel}>{k.label}</span>
                          <span className={styles.kpRowMeta}>
                            {k.custom && <span className={cx(styles.kpBadge, styles.kpBadgeCustom)}>{t("pres_kpi_custom_one", "Personalizado")}</span>}
                            {k.category && <span className={styles.kpRowCat}>{k.category}</span>}
                            {tagOf(k) && <span className={styles.kpBadge}>#{tagOf(k)}</span>}
                          </span>
                        </span>
                        <span className={styles.kpRowRight}>
                          <span className={styles.kpRowValue}>{val}</span>
                          {cp && (
                            <span className={cx(styles.kpRowDelta, delta && (delta.diff > 0 ? styles.kpUp : delta.diff < 0 ? styles.kpDown : null))}>
                              {cres?.status === "loading" ? "…" : deltaText(delta)}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
        </div>
      ),
    },
    {
      id: "filters", icon: Filter, optional: true, title: t("pres_wz_kpi_filters", "Periodo y filtros"),
      hint: t("pres_kpi_filters_hint", "Lo que dejes en «General» sigue los filtros del header de la presentación."),
      summary: ownFilters ? fill(t("pres_wz_own_filters", "{n} filtros propios"), { n: ownFilters }) : t("pres_wz_general", "Los de la presentación"),
      content: (
              <div className={styles.kpGrid3}>
                <div className={styles.kpField}>
                  <span className={styles.mLabel}>{t("filter_source", "Fuente")}</span>
                  <Dropdown value={filters.source ?? ""} options={withInherit(sourceOpts, period.source)}
                    onChange={v => setFilter({ source: v })} ariaLabel={t("filter_source", "Fuente")} />
                </div>
                <div className={styles.kpField}>
                  <span className={styles.mLabel}>{t("filter_structure", "Perímetro")}</span>
                  <Dropdown value={filters.structure ?? ""} options={withInherit(structureOpts, period.structure)}
                    onChange={v => setFilter({ structure: v })} ariaLabel={t("filter_structure", "Perímetro")} />
                </div>
                <div className={styles.kpField}>
                  <span className={styles.mLabel}>{t("pres_mode", "Modo")}</span>
                  <Dropdown value={filters.mode ?? ""} options={withInherit(modeOpts, modeName(period.mode))}
                    onChange={v => setFilter({ mode: v })} ariaLabel={t("pres_mode", "Modo")} />
                </div>
                <div className={styles.kpField}>
                  <span className={styles.mLabel}>{t("filter_year", "Año")}</span>
                  <Dropdown value={filters.year ?? ""} options={withInherit(yearOpts, period.year)}
                    onChange={v => setFilter({ year: v })} ariaLabel={t("filter_year", "Año")} />
                </div>
                <div className={styles.kpField}>
                  <span className={styles.mLabel}>{t("filter_month", "Mes")}</span>
                  <Dropdown value={filters.month ?? ""} options={withInherit(monthOpts, monthName(period.month))}
                    onChange={v => setFilter({ month: v })} ariaLabel={t("filter_month", "Mes")} />
                </div>
                <div className={styles.kpField}>
                  <span className={styles.mLabel}>{t("pres_dims", "Dimensiones")}</span>
                  <Dropdown multiple value={filters.dims ?? []} options={dimOpts}
                    placeholder={t("pres_all_dims", "Todas las dimensiones")}
                    onChange={v => setFilter({ dims: v })} ariaLabel={t("pres_dims", "Dimensiones")} />
                </div>
              </div>
      ),
    },
    {
      id: "compare", icon: ArrowLeftRight, optional: true, title: t("pres_wz_kpi_compare", "¿Comparar con otro periodo?"),
      hint: t("pres_wz_kpi_compare_hint", "Añade una referencia para ver la variación en la tarjeta."),
      summary: cmpName,
      content: (
        <>
              <div className={styles.tabs} role="tablist">
                {[
                  ["none", t("pres_cmp_none", "Sin comparar")],
                  ["prev_year", t("pres_cmp_prev_year", "Año anterior")],
                  ["prev_month", t("pres_cmp_prev_month", "Mes anterior")],
                  ["custom", t("pres_cmp_custom", "Personalizado")],
                ].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={compare.preset === id}
                    className={cx(styles.tab, compare.preset === id && styles.tabActive)}
                    onClick={() => setCmp({ preset: id })}>
                    {label}
                  </button>
                ))}
              </div>
              {compare.preset === "custom" && (
                <div className={styles.kpGrid4}>
                  <Dropdown value={compare.source || sp.source} options={sourceOpts}
                    onChange={v => setCmp({ source: v })} ariaLabel={t("filter_source", "Fuente")} />
                  <Dropdown value={compare.structure || sp.structure} options={structureOpts}
                    onChange={v => setCmp({ structure: v })} ariaLabel={t("filter_structure", "Perímetro")} />
                  <Dropdown value={String(compare.year || sp.year)} options={yearOpts}
                    onChange={v => setCmp({ year: v })} ariaLabel={t("filter_year", "Año")} />
                  <Dropdown value={String(compare.month || sp.month)} options={monthOpts}
                    onChange={v => setCmp({ month: v })} ariaLabel={t("filter_month", "Mes")} />
                </div>
              )}
        </>
      ),
    },
    {
      id: "show", icon: Eye, title: t("pres_wz_kpi_show", "¿Qué enseña la tarjeta?"),
      hint: t("pres_wz_kpi_show_hint", "Activa o desactiva lo que se ve debajo del valor."),
      summary: "",
      content: (
              <div className={styles.chips}>
                {[
                  ["origin", t("pres_show_origin", "Ámbito y empresa"), true],
                  ["filters", t("pres_show_filters", "Filtros propios"), true],
                  ["delta", t("pres_show_delta", "Variación %"), !!cp],
                  ["deltaAbs", t("pres_show_delta_abs", "Diferencia"), !!cp],
                  ["cmpValue", t("pres_show_cmp_value", "Valor comparado"), !!cp],
                ].map(([key, label, enabled]) => (
                  <button key={key} type="button" disabled={!enabled}
                    className={cx(styles.chip, display[key] && enabled && styles.chipOn)}
                    aria-pressed={!!display[key]}
                    onClick={() => setDisplay(d => ({ ...d, [key]: !d[key] }))}>
                    {display[key] && enabled && <Check size={11} strokeWidth={3} />}
                    {label}
                  </button>
                ))}
              </div>
      ),
    },
  ];

  const preview = chosen ? (
    <>
      <div className={styles.wzKpiCard}>
        <div className={styles.wzKpiLabel}>{chosen.label}</div>
        <div className={styles.wzKpiValue}>{res0?.status === "ok" ? formatKpiValue(res0.value, chosen.format) : res0?.status === "loading" ? "…" : "—"}</div>
        {display.origin && <div className={styles.wzKpiMeta}>{entityName}</div>}
        {cp && delta0 && (display.delta || display.deltaAbs) && <span className={styles.wzKpiDelta}>{deltaText(delta0)}</span>}
      </div>
      <ul className={styles.wzFacts}>
        <li><span>{t("pres_mode", "Modo")}</span><b>{modeName(sp.mode)}</b></li>
        <li><span>{t("filter_month", "Mes")}</span><b>{monthName(sp.month)} {sp.year}</b></li>
        <li><span>{t("pres_compare", "Comparar con")}</span><b>{cmpName}</b></li>
      </ul>
    </>
  ) : <div className={styles.wzEmptyPreview}>{t("pres_wz_kpi_preview_empty", "Elige un KPI para ver cómo quedará la tarjeta.")}</div>;

  return (
    <Wizard
      title={t("pres_pick_kpi", "Elegir KPI")}
      steps={steps}
      startAt={initial?.kpiId ? 1 : 0}
      onClose={onClose}
      onFinish={() => chosen && pick(chosen)}
      finishLabel={initial?.kpiId ? t("pres_save_changes", "Guardar cambios") : t("pres_wz_add_kpi", "Añadir KPI")}
      preview={preview}
      extraFoot={initial?.kpiId ? (
        <button type="button" className={cx(styles.btnGhost, styles.kpRemove)} onClick={onRemove}>
          <Trash2 size={14} />{t("pres_kpi_remove", "Quitar KPI")}
        </button>
      ) : null}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Selector de gráfica: modo (filtros comunes o por KPI), rango de meses,
   KPIs con su color y vista previa en vivo con el diseño de la diapositiva.
   ══════════════════════════════════════════════════════════════════════ */
function ChartPickerModal({ data, companies, sources, structures, dimensions, period, initial, designId, themes, fullSlide, onSave, onRemove, onClose }) {
  const t = useT();
  const { ensure, holdings, catalogs, ready } = data;
  const [dataKind, setDataKind] = useState(initial?.data === "accounts" ? "accounts" : "kpi");
  const [statement, setStatement] = useState(initial?.statement === "cf" ? "cf" : "fin");
  const accounts = statement === "cf" ? data.cfAccounts : data.accounts;
  const [mode, setMode] = useState(initial?.mode ?? "shared");
  const [range, setRange] = useState(initial?.range ?? { type: "relative", months: 12 });
  const [shared, setShared] = useState(() => {
    const sh = initial?.shared ?? { scope: "individual", filters: {} };
    return { ...sh, entities: sharedEntities(sh) };
  });
  const [series, setSeries] = useState(initial?.series ?? []);
  const [useFull, setUseFull] = useState(!!fullSlide);
  // Filtros de la lista de cuentas (comunes a todas las filas).
  const [accType, setAccType] = useState("all");      // all | pl | bs
  const [accSign, setAccSign] = useState("nonzero");  // all | nonzero | positive | negative

  const companyOpts = useMemo(
    () => companies.map(c => ({ value: optCompany(c), label: companyName(companies, optCompany(c)) })).filter(o => o.value),
    [companies],
  );
  const groupOpts = useMemo(
    () => holdings.list.map(g => ({ value: g, label: companyName(companies, g) })),
    [holdings.list, companies],
  );
  const scopeOf = (sc) => sc ?? "individual";
  const entityOpts = (scope) => (scopeOf(scope) === "consolidated" ? groupOpts : companyOpts);
  const defaultEntity = (scope) => (scopeOf(scope) === "consolidated" ? (holdings.root || groupOpts[0]?.value) : companyOpts[0]?.value) ?? "";
  const fixEntity = (scope, entity) => (entityOpts(scope).some(o => o.value === entity) ? entity : defaultEntity(scope));

  // Opciones de los desplegables.
  const inherit = (v) => `${t("pres_inherit", "General")} · ${v}`;
  const modeName = (m) => (m === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"));
  const monthName = (m) => t(`month_${m}`, String(m));
  const sourceOpts = sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const structureOpts = structures.map(x => optStructure(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const modeOpts = [{ value: "ytd", label: modeName("ytd") }, { value: "monthly", label: modeName("monthly") }];
  const yearNow = new Date().getFullYear();
  const yearOpts = Array.from({ length: 8 }, (_, i) => String(yearNow - i)).map(v => ({ value: v, label: v }));
  const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }));
  const dimOpts = useMemo(() => {
    const seen = new Set();
    return (dimensions ?? []).map(d => {
      const code = String(d.DimensionCode ?? d.dimensionCode ?? d.Code ?? d.code ?? "");
      const name = String(d.DimensionName ?? d.dimensionName ?? d.Name ?? d.name ?? code);
      const group = String(d.DimensionGroup ?? d.dimensionGroup ?? d.Group ?? d.group ?? "");
      return { value: code, label: name && name !== code ? `${name} (${code})` : code, group };
    }).filter(o => o.value && !seen.has(o.value) && seen.add(o.value));
  }, [dimensions]);
  const accountOpts = useMemo(() => (accounts ?? []).map(a => ({
    value: a.code,
    label: a.name ? `${a.code} · ${a.name}` : a.code,
    group: a.statement === "cf" ? t("pres_cf", "Flujo de caja") : a.type === "B/S" ? t("pres_acc_bs", "Balance") : t("pres_acc_pl", "Cuenta de resultados"),
  })), [accounts, t]);
  const itemOpts = (scope) => (dataKind === "accounts" ? accountOpts : (catalogs[scopeOf(scope)] ?? []).map(k => ({
    value: k.id,
    label: k.custom ? `${k.label} · ${t("pres_kpi_custom_one", "Personalizado")}` : k.label,
    group: k.category || (k.custom ? t("pres_kpi_custom", "Personalizados") : t("pres_kpi_system", "Biblioteca")),
  })));
  const idKey = dataKind === "accounts" ? "accountCode" : "kpiId";

  // Cuentas con su valor en el último mes del rango que tenga datos para esa
  // empresa y filtros; se pueden filtrar por tipo y por saldo.
  const months = chartMonths(range, period);
  const accountChoices = (scope, entity, filters) => {
    const sp = slotPeriod(period, { filters });
    const probe = (accounts ?? []).find(a => !a.isSum)?.code ?? accounts?.[0]?.code;
    let at = null;
    let loading = false;
    for (let i = months.length - 1; i >= 0 && probe; i--) {
      const r = data.resolveAccount({ statement: statement === "cf" ? "cf" : undefined, scope, entity, accountCode: probe, view: statement === "cf" ? "total" : "consolidated" },
        { ...sp, year: months[i].year, month: months[i].month });
      if (r.status === "loading") { loading = true; continue; }
      if (r.status === "ok") { at = months[i]; break; }
    }
    const per = at ? { ...sp, year: at.year, month: at.month } : null;
    const valueOf = (code) => (per ? data.resolveAccount({
      statement: statement === "cf" ? "cf" : undefined, scope, entity, accountCode: code, view: statement === "cf" ? "total" : "consolidated",
    }, per) : null);
    const opts = accountOpts.filter(o => {
      const a = (accounts ?? []).find(x => x.code === o.value);
      if (statement !== "cf" && accType === "pl" && a?.type === "B/S") return false;
      if (statement !== "cf" && accType === "bs" && a?.type !== "B/S") return false;
      if (accSign === "all" || !per) return true;
      const r = valueOf(o.value);
      if (r?.status !== "ok") return accSign === "all";
      const v = r.value ?? 0;
      if (accSign === "nonzero") return Math.abs(v) > 0.004;
      if (accSign === "positive") return v > 0.004;
      return v < -0.004;
    });
    const meta = (o) => {
      if (!per) return loading ? "…" : "—";
      const r = valueOf(o.value);
      return r?.status === "ok" ? formatKpiValue(r.value, "currency") : r?.status === "loading" ? "…" : "—";
    };
    const monthShort = (m) => t(`month_${m}`, String(m)).slice(0, 3).toLowerCase();
    const note = at
      ? fill(t("pres_acc_values_at", "Valores a {period}: último mes del rango con datos."), { period: `${monthShort(at.month)} ${at.year}` })
      : loading ? t("pres_kpi_loading", "Cargando…") : t("pres_acc_no_data_range", "Esta empresa no tiene datos en el rango.");
    return { opts, meta, note };
  };
  const accToolbar = (note) => (
    <div className={styles.ddTools}>
      {statement !== "cf" && (
        <div className={styles.ddSeg}>
          {[["all", t("pres_kpi_all", "Todos")], ["pl", t("pres_acc_pl_short", "PyG")], ["bs", t("pres_acc_bs", "Balance")]].map(([id, label]) => (
            <button key={id} type="button" className={cx(styles.ddSegBtn, accType === id && styles.ddSegOn)} onClick={() => setAccType(id)}>{label}</button>
          ))}
        </div>
      )}
      <div className={styles.ddSeg}>
        {[["all", t("pres_acc_sign_all_short", "Todas")], ["nonzero", t("pres_acc_sign_nonzero_short", "Con saldo")],
          ["positive", t("pres_acc_sign_pos_short", "Positivas")], ["negative", t("pres_acc_sign_neg_short", "Negativas")]].map(([id, label]) => (
          <button key={id} type="button" className={cx(styles.ddSegBtn, accSign === id && styles.ddSegOn)} onClick={() => setAccSign(id)}>{label}</button>
        ))}
      </div>
      <p className={styles.ddNote}>{note}</p>
    </div>
  );

  // Empresas del modo común y límite de líneas.
  const ents = (shared.entities?.length ? shared.entities : [{ entity: "" }])
    .map(en => { const e = fixEntity(shared.scope, en.entity); return { entity: e, entityLabel: companyName(companies, e) }; });
  const limit = chartItemLimit(mode, mode === "shared" ? ents.length : 1);
  const effShared = { ...shared, scope: scopeOf(shared.scope), entities: ents };
  const effSeries = series.slice(0, limit).map(sr => (mode === "independent"
    ? { filters: {}, ...sr, scope: scopeOf(sr.scope), entity: fixEntity(sr.scope, sr.entity),
        entityLabel: companyName(companies, fixEntity(sr.scope, sr.entity)) }
    : sr));

  const firstItem = (scope, used) => {
    if (dataKind === "accounts") {
      const a = (accounts ?? []).find(x => !used.has(x.code) && !x.isSum) ?? (accounts ?? [])[0];
      return a ? { accountCode: a.code, label: a.name ? `${a.code} · ${a.name}` : a.code, format: "currency" } : { accountCode: "" };
    }
    const k = (catalogs[scopeOf(scope)] ?? []).find(x => !used.has(x.id));
    return k ? { kpiId: k.id, label: k.label, format: k.format } : { kpiId: "" };
  };
  const addSeries = () => {
    const used = new Set(effSeries.map(sr => sr[idKey]));
    setSeries(list => [...list.slice(0, limit), {
      ...firstItem(mode === "shared" ? effShared.scope : "individual", used),
      color: CHART_COLORS[list.length % CHART_COLORS.length],
      ...(mode === "independent" ? { scope: "individual", entity: "", filters: {} } : {}),
    }]);
  };
  const setSer = (i, patch) => setSeries(list => list.map((sr, j) => (j === i ? { ...sr, ...patch } : sr)));
  const removeSer = (i) => setSeries(list => list.filter((_, j) => j !== i));
  const setItem = (i, scope, id) => {
    if (dataKind === "accounts") {
      const a = (accounts ?? []).find(x => x.code === id);
      setSer(i, { accountCode: id, kpiId: undefined, label: a ? (a.name ? `${a.code} · ${a.name}` : a.code) : id, format: "currency" });
    } else {
      const k = (catalogs[scopeOf(scope)] ?? []).find(x => x.id === id);
      setSer(i, { kpiId: id, accountCode: undefined, label: k?.label ?? id, format: k?.format ?? "currency" });
    }
  };
  const setEntities = (fn) => setShared(sh => {
    const list = fn(sh.entities?.length ? sh.entities : [{ entity: "" }]);
    return { ...sh, entities: list.slice(0, MAX_CHART_ENTITIES) };
  });
  // Al añadir empresas baja el límite de KPIs/cuentas: se recortan los que sobran.
  const addEntity = () => {
    const used = new Set(ents.map(e => e.entity));
    const next = entityOpts(effShared.scope).find(o => !used.has(o.value))?.value ?? "";
    setEntities(list => [...list, { entity: next }]);
    setSeries(list => list.slice(0, chartItemLimit("shared", ents.length + 1)));
  };

  // Tipo de datos: al cambiar, las series se reinician con el primer elemento.
  const switchKind = (kind) => {
    if (kind === dataKind) return;
    setDataKind(kind);
    setSeries([]);

  };

  // Primera serie automática cuando los datos base están listos.
  useEffect(() => {
    if (!ready || series.length) return;
    const first = firstItem("individual", new Set());
    if (first[idKey]) queueMicrotask(() => setSeries([{ ...first, color: CHART_COLORS[0] }]));
  });

  const draft = {
    kind: "chart", data: dataKind, statement: dataKind === "accounts" && statement === "cf" ? "cf" : undefined, mode, range,
    shared: mode === "shared" ? effShared : null,
    series: effSeries,
  };

  // Datos para la vista previa.
  const wanted = chartWanted(draft, period);
  const wantedKey = JSON.stringify(wanted);
  useEffect(() => { ensure(JSON.parse(wantedKey)); }, [ensure, wantedKey]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cleanFilters = (f) => {
    const out = {};
    ["source", "structure", "mode"].forEach(k => { if (f?.[k]) out[k] = f[k]; });
    if (Array.isArray(f?.dims) && f.dims.length) out.dims = f.dims;
    return out;
  };
  const pickItem = (sr) => (dataKind === "accounts"
    ? { accountCode: sr.accountCode, label: sr.label, format: "currency", color: sr.color }
    : { kpiId: sr.kpiId, label: sr.label, format: sr.format, color: sr.color });
  const save = () => onSave({
    ...draft,
    shared: draft.shared ? { scope: effShared.scope, entities: ents, filters: cleanFilters(effShared.filters) } : null,
    series: draft.series.filter(sr => sr[idKey]).map(sr => (mode === "independent"
      ? { ...pickItem(sr), scope: sr.scope, entity: sr.entity, entityLabel: sr.entityLabel, filters: cleanFilters(sr.filters) }
      : pickItem(sr))),
  }, useFull);

  const formats = new Set(effSeries.filter(sr => sr[idKey]).map(sr => sr.format));
  const filterFields = (src, onPatch) => (
    <div className={styles.kpGrid2}>
      <Dropdown value={src.filters?.source ?? ""} options={[{ value: "", label: inherit(period.source) }, ...sourceOpts]}
        onChange={v => onPatch({ source: v })} ariaLabel={t("filter_source", "Fuente")} />
      <Dropdown value={src.filters?.structure ?? ""} options={[{ value: "", label: inherit(period.structure) }, ...structureOpts]}
        onChange={v => onPatch({ structure: v })} ariaLabel={t("filter_structure", "Perímetro")} />
      <Dropdown value={src.filters?.mode ?? ""} options={[{ value: "", label: inherit(modeName(period.mode)) }, ...modeOpts]}
        onChange={v => onPatch({ mode: v })} ariaLabel={t("pres_mode", "Modo")} />
      <Dropdown multiple value={src.filters?.dims ?? []} options={dimOpts} placeholder={t("pres_all_dims", "Todas las dimensiones")}
        onChange={v => onPatch({ dims: v })} ariaLabel={t("pres_dims", "Dimensiones")} />
    </div>
  );
  const scopeTabs = (value, onChange) => ((
    <div className={styles.tabs} role="tablist">
      {[["individual", t("pres_kpi_individual", "Individual")], ["consolidated", t("pres_kpi_consolidated", "Consolidado")]].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id}
          className={cx(styles.tab, value === id && styles.tabActive)} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  ));
  const itemName = dataKind === "accounts" ? t("pres_chart_accounts_label", "Cuentas") : t("pres_chart_kpis_label", "KPIs");

  const seriesValid = effSeries.some(sr => sr[idKey]);
  const steps = [
    {
      id: "what", icon: LineChart, title: t("pres_wz_chart_what", "¿Qué quieres ver y cómo?"),
      hint: t("pres_wz_chart_what_hint", "Elige si la gráfica muestra KPIs o cuentas, y el tipo de gráfica."),
      summary: dataKind === "accounts" ? t("pres_chart_accounts", "Cuentas") : t("pres_chart_kpis", "KPIs"),
      valid: true,
      content: (
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_chart_data", "Qué quieres ver")}</p>
              <div className={styles.tabs} role="tablist">
                {[["kpi", t("pres_chart_kpis_label", "KPIs")], ["accounts", t("pres_chart_accounts_any", "Cuentas")]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={dataKind === id}
                    className={cx(styles.tab, dataKind === id && styles.tabActive)} onClick={() => switchKind(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {dataKind === "accounts" && (
                <div className={styles.tabs} role="tablist" style={{ marginTop: 8 }}>
                  {[["fin", t("pres_acc_fin", "PyG y balance")], ["cf", t("pres_cf", "Flujo de caja")]].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={statement === id}
                      className={cx(styles.tab, statement === id && styles.tabActive)}
                      onClick={() => { if (id !== statement) { setStatement(id); setSeries([]); } }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <p className={styles.kpSectionTitle} style={{ marginTop: 14 }}>{t("pres_chart_type", "Tipo de gráfica")}</p>
              <div className={styles.tabs} role="tablist">
                {[
                  ["shared", fill(t("pres_chart_shared_n", "Filtros comunes · hasta {n}"), { n: `5 ${itemName}` })],
                  ["independent", fill(t("pres_chart_independent_n", "Filtros por línea · hasta {n}"), { n: `3 ${itemName}` })],
                ].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={mode === id}
                    className={cx(styles.tab, mode === id && styles.tabActive)}
                    onClick={() => { setMode(id); setSeries(list => list.slice(0, chartItemLimit(id, id === "shared" ? ents.length : 1))); }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
      ),
    },
    ...(mode === "shared" ? [{
      id: "who", icon: Building2, title: t("pres_wz_chart_who", "¿De qué sociedades?"),
      hint: t("pres_wz_chart_who_hint", "Hasta 3 sociedades o grupos; cada una se dibuja con su propio trazo."),
      summary: "", valid: true,
      content: (
              <div className={styles.kpSection}>
                <p className={styles.kpSectionTitle}>{t("pres_chart_common", "Filtros comunes")}</p>
                {scopeTabs(effShared.scope, sc => { setShared(sh => ({ ...sh, scope: sc, entities: [{ entity: "" }] })); setSeries([]); })}
                <p className={styles.kpSectionHint} style={{ margin: "10px 0 6px" }}>
                  {t("pres_chart_entities_hint", "Hasta 3 empresas. Cada empresa extra resta un elemento: 3 empresas × 3 = 9 líneas.")}
                </p>
                <div className={styles.chEntities}>
                  {ents.map((en, i) => (
                    <div key={i} className={styles.chEntity}>
                      <svg width="28" height="8" aria-hidden="true" className={styles.chDash}>
                        <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                          strokeDasharray={CHART_DASHES[i] ? CHART_DASHES[i].split(" ").map(n => Number(n) * 0.55).join(" ") : undefined} />
                      </svg>
                      <div className={styles.chKpi}>
                        <Dropdown value={en.entity} options={entityOpts(effShared.scope)}
                          onChange={v => setEntities(list => list.map((x, j) => (j === i ? { entity: v } : x)))}
                          ariaLabel={t("pres_kpi_company", "Empresa")} />
                      </div>
                      {ents.length > 1 && (
                        <button type="button" className={styles.colorReset} style={{ opacity: 1 }}
                          onClick={() => setEntities(list => list.filter((_, j) => j !== i))} aria-label={t("pres_delete", "Eliminar")}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" className={styles.chAdd} onClick={addEntity} disabled={ents.length >= MAX_CHART_ENTITIES}>
                  <Plus size={14} strokeWidth={2.4} />
                  {t("pres_chart_add_company", "Añadir empresa")}
                </button>
                {filterFields(effShared, patch => setShared(sh => ({ ...sh, filters: { ...(sh.filters ?? {}), ...patch } })))}
              </div>
      ),
    }] : []),
    {
      id: "series", icon: Gauge, title: dataKind === "accounts" ? t("pres_wz_chart_series_acc", "¿Qué cuentas dibujar?") : t("pres_wz_chart_series", "¿Qué KPIs dibujar?"),
      hint: t("pres_wz_chart_series_hint", "Añade las series y elige su color. Mira la vista previa a la derecha."),
      summary: fill(t("pres_wz_n_series", "{n} series"), { n: effSeries.filter(sr => sr[idKey]).length }),
      valid: seriesValid,
      content: (
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>
                {dataKind === "accounts" ? t("pres_chart_accounts", "Cuentas de la gráfica") : t("pres_chart_kpis", "KPIs de la gráfica")}
                <span className={styles.chCount}>{effSeries.length}/{limit}</span>
              </p>
              {formats.size > 1 && (
                <p className={styles.chWarn}>{t("pres_chart_mixed", "Hay KPIs con formatos distintos (importe y %): comparten el mismo eje.")}</p>
              )}
              <div className={styles.chSeries}>
                {effSeries.map((sr, i) => {
                  const scope = mode === "shared" ? effShared.scope : sr.scope;
                  return (
                    <div key={i} className={styles.chSerie}>
                      <div className={styles.chSerieMain}>
                        <label className={styles.colorSwatch} style={{ background: sr.color || CHART_COLORS[i] }}
                          title={t("pres_line_color", "Color de la línea")}>
                          <input type="color" value={sr.color || CHART_COLORS[i]} onChange={e => setSer(i, { color: e.target.value })}
                            aria-label={t("pres_line_color", "Color de la línea")} />
                        </label>
                        <div className={styles.chKpi}>
                          {dataKind === "accounts" ? (() => {
                            // En modo común, los valores son los de la primera empresa.
                            const src = mode === "shared" ? { scope, entity: ents[0]?.entity, filters: effShared.filters } : sr;
                            const ch = accountChoices(scope, src.entity, src.filters);
                            const current = accountOpts.find(o => o.value === sr.accountCode);
                            const opts = current && !ch.opts.some(o => o.value === current.value) ? [current, ...ch.opts] : ch.opts;
                            return (
                              <Dropdown value={sr.accountCode} options={opts} wide meta={ch.meta} toolbar={accToolbar(ch.note)}
                                placeholder={t("pres_pick_account", "Elegir cuenta")} onChange={v => setItem(i, scope, v)}
                                ariaLabel={t("pres_pick_account", "Elegir cuenta")} />
                            );
                          })() : (
                            <Dropdown value={sr[idKey]} options={itemOpts(scope)} placeholder={t("pres_pick_kpi", "Elegir KPI")}
                              onChange={v => setItem(i, scope, v)} ariaLabel={t("pres_pick_kpi", "Elegir KPI")} />
                          )}
                        </div>
                        <button type="button" className={styles.colorReset} style={{ opacity: 1 }} onClick={() => removeSer(i)}
                          aria-label={t("pres_delete", "Eliminar")} title={t("pres_delete", "Eliminar")}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {mode === "independent" && (
                        <div className={styles.chSerieFilters}>
                          <div className={styles.kpRow2}>
                            {scopeTabs(sr.scope, sc => setSer(i, { scope: sc, entity: "", kpiId: "" }))}
                            <Dropdown value={sr.entity} options={entityOpts(sr.scope)} onChange={v => setSer(i, { entity: v })}
                              ariaLabel={t("pres_kpi_company", "Empresa")} />
                          </div>
                          {filterFields(sr, patch => setSer(i, { filters: { ...(sr.filters ?? {}), ...patch } }))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button type="button" className={styles.chAdd} onClick={addSeries} disabled={effSeries.length >= limit || !ready}>
                <Plus size={14} strokeWidth={2.4} />
                {dataKind === "accounts" ? t("pres_chart_add_account", "Añadir cuenta") : t("pres_chart_add", "Añadir KPI")}
              </button>
            </div>
      ),
    },
    {
      id: "range", icon: CalendarRange, title: t("pres_wz_chart_range", "¿Qué periodo y qué tamaño?"),
      hint: t("pres_wz_chart_range_hint", "El rango de meses de la gráfica y si ocupa toda la diapositiva."),
      summary: "", valid: true,
      content: (
        <>
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_chart_range", "Periodo")}</p>
              <div className={styles.tabs} role="tablist">
                {[["relative", t("pres_range_relative", "Últimos meses")], ["fixed", t("pres_range_fixed", "Rango fijo")]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={range.type === id}
                    className={cx(styles.tab, range.type === id && styles.tabActive)}
                    onClick={() => setRange(r => (id === "fixed"
                      ? { type: "fixed", fromYear: r.fromYear ?? String(Number(period.year) - 1), fromMonth: r.fromMonth ?? String(period.month),
                          toYear: r.toYear ?? String(period.year), toMonth: r.toMonth ?? String(period.month) }
                      : { type: "relative", months: r.months ?? 12 }))}>
                    {label}
                  </button>
                ))}
              </div>
              {range.type === "fixed" ? (
                <div className={styles.kpGrid4}>
                  <Dropdown value={range.fromMonth} options={monthOpts} onChange={v => setRange(r => ({ ...r, fromMonth: v }))} ariaLabel={t("pres_from", "Desde")} />
                  <Dropdown value={range.fromYear} options={yearOpts} onChange={v => setRange(r => ({ ...r, fromYear: v }))} ariaLabel={t("pres_from", "Desde")} />
                  <Dropdown value={range.toMonth} options={monthOpts} onChange={v => setRange(r => ({ ...r, toMonth: v }))} ariaLabel={t("pres_to", "Hasta")} />
                  <Dropdown value={range.toYear} options={yearOpts} onChange={v => setRange(r => ({ ...r, toYear: v }))} ariaLabel={t("pres_to", "Hasta")} />
                </div>
              ) : (
                <div className={styles.chRangeRow}>
                  <Dropdown value={String(range.months ?? 12)} ariaLabel={t("pres_chart_range", "Periodo")}
                    options={[6, 12, 18, 24, 36].map(n => ({ value: String(n), label: fill(t("pres_last_n_months", "Últimos {n} meses"), { n }) }))}
                    onChange={v => setRange({ type: "relative", months: Number(v) })} />
                  <span className={styles.kpSectionHint}>{t("pres_range_relative_hint", "Hasta el mes del header: se mueve con él.")}</span>
                </div>
              )}
            </div>
            <label className={styles.vpSwitch}>
              <input type="checkbox" checked={useFull} onChange={e => setUseFull(e.target.checked)} />
              <span className={styles.vpSwitchTrack}><span className={styles.vpSwitchThumb} /></span>
              <span>{t("pres_chart_full", "Ocupar toda la diapositiva")}</span>
            </label>
        </>
      ),
    },
  ];
  return (
    <Wizard
      title={t("pres_chart_title_any", "Gráfica")}
      steps={steps}
      startAt={initial ? 2 : 0}
      onClose={onClose}
      onFinish={() => seriesValid && save()}
      finishLabel={initial ? t("pres_save_changes", "Guardar cambios") : t("pres_chart_save", "Guardar gráfica")}
      previewWide
      preview={
        <>
            <SlideCanvas className={styles.mPreviewSlide} designId={designId} themes={themes}
              layoutId="chart" title={t("pres_chart_title_any", "Gráfica")} slots={{ chart1: draft }} />
          <ul className={styles.wzFacts}>
            <li><span>{t("pres_chart_data", "Qué quieres ver")}</span><b>{dataKind === "accounts" ? t("pres_chart_accounts", "Cuentas") : t("pres_chart_kpis", "KPIs")}</b></li>
            <li><span>{t("pres_wz_series", "Series")}</span><b>{effSeries.filter(sr => sr[idKey]).length}</b></li>
            <li><span>{t("pres_chart_range", "Periodo")}</span><b>{range.type === "fixed" ? t("pres_chart_range_fixed", "Rango fijo") : t("pres_chart_range_last", "Últimos meses")}</b></li>
          </ul>
        </>
      }
      extraFoot={initial ? (
        <button type="button" className={cx(styles.btnGhost, styles.kpRemove)} onClick={onRemove}>
          <Trash2 size={14} />{t("pres_chart_remove", "Quitar gráfica")}
        </button>
      ) : null}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Selector de cuentas individuales: empresa, filtros, cuentas sueltas o un
   rango, y cuántas caben en el espacio elegido.
   ══════════════════════════════════════════════════════════════════════ */
// Primer paso de los selectores de tablas: qué tipo de bloque poner.
function BlockKindCards({ value, onChange }) {
  const t = useT();
  const items = [
    ["accounts", Table2, t("pres_block_accounts", "Cuentas"), t("pres_wz_kind_accounts", "Saldos de las cuentas que elijas, de una sociedad o de un grupo.")],
    ["sheet", Layers, t("pres_sheet_title", "Sábana de consolidación"), t("pres_wz_kind_sheet", "Consolidado, eliminaciones, contribución y sociedades, una al lado de otra.")],
    ["contrib", Building2, t("pres_contrib_title", "Contributivo"), t("pres_wz_kind_contrib", "Lo que aporta cada sociedad, o una sola desplegada: cargado y asientos.")],
  ];
  return (
    <div className={styles.wzCards}>
      {items.map((item) => {
        const [id, Icon, label, text] = item;
        const on = value === id;
        return (
          <button key={id} type="button" className={cx(styles.wzCard, on && styles.wzCardOn)} aria-pressed={on}
            onClick={() => (on ? null : onChange?.(id))}>
            {on && <span className={styles.wzCardCheck}><Check size={12} strokeWidth={3} /></span>}
            <span className={styles.wzCardIcon}><Icon size={20} strokeWidth={2} /></span>
            <span className={styles.wzCardTitle}>{label}</span>
            <span className={styles.wzCardText}>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

function AccountsPickerModal({ data, companies, sources, structures, dimensions, period, initial, capacity, onSave, onRemove, onClose, onSwitchKind, switchedFrom = null }) {
  const t = useT();
  const { ensure, resolveAccount, ready, holdings } = data;
  const [statement, setStatement] = useState(initial?.statement === "cf" ? "cf" : "fin"); // fin = PyG y balance
  const isCf = statement === "cf";
  const accounts = isCf ? data.cfAccounts : data.accounts;
  const [scope, setScope] = useState(initial?.scope ?? "individual");
  const [view, setView] = useState(initial?.view ?? (initial?.statement === "cf" ? "total" : "consolidated"));
  const [company, setCompany] = useState(initial?.company ?? "");
  const [signFilter, setSignFilter] = useState("all"); // all | nonzero | positive | negative
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [filters, setFilters] = useState(initial?.filters ?? {});
  const [selType, setSelType] = useState(initial?.selection?.type === "range" ? "range" : "list");
  const [codes, setCodes] = useState(initial?.selection?.type === "list" ? (initial.selection.codes ?? []) : []);
  const [from, setFrom] = useState(initial?.selection?.type === "range" ? initial.selection.from : "");
  const [to, setTo] = useState(initial?.selection?.type === "range" ? initial.selection.to : "");
  const [hideZero, setHideZero] = useState(initial?.hideZero ?? true);
  const [showCodes, setShowCodes] = useState(initial?.showCodes ?? true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | pl | bs

  const companyOpts = useMemo(
    () => companies.map(c => ({ value: optCompany(c), label: companyName(companies, optCompany(c)) })).filter(o => o.value),
    [companies],
  );
  const groupOpts = useMemo(
    () => holdings.list.map(g => ({ value: g, label: companyName(companies, g) })),
    [holdings.list, companies],
  );
  const consolidated = scope === "consolidated";
  const entityOpts = consolidated ? groupOpts : companyOpts;
  const effEntity = entityOpts.some(o => o.value === entity) ? entity
    : (consolidated ? (holdings.root || groupOpts[0]?.value) : companyOpts[0]?.value) ?? "";
  // Sociedades de la consolidación (el grupo y sus sociedades directas).
  const memberOpts = consolidated ? holdings.membersOf(effEntity).map(c => ({ value: c, label: companyName(companies, c) })) : [];
  const effCompany = memberOpts.some(o => o.value === company) ? company : (memberOpts[0]?.value ?? "");
  const sp = slotPeriod(period, { filters });
  const spKey = `${sp.source}|${sp.structure}|${sp.year}|${sp.month}|${sp.mode}`;
  useEffect(() => {
    const [source, structure, year, month, mode] = spKey.split("|");
    ensure(scope, effEntity, { source, structure, year, month, mode });
  }, [ensure, scope, effEntity, spKey]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inherit = (v) => `${t("pres_inherit", "General")} · ${v}`;
  const modeName = (m) => (m === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"));
  const monthName = (m) => t(`month_${m}`, String(m));
  const yearNow = new Date().getFullYear();
  const years = [...new Set([...Array.from({ length: 7 }, (_, i) => String(yearNow - i)), String(period.year)])].sort((a, b) => Number(b) - Number(a));
  const sourceOpts = sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const structureOpts = structures.map(x => optStructure(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const dimOpts = useMemo(() => {
    const seen = new Set();
    return (dimensions ?? []).map(d => {
      const code = String(d.DimensionCode ?? d.dimensionCode ?? d.Code ?? d.code ?? "");
      const name = String(d.DimensionName ?? d.dimensionName ?? d.Name ?? d.name ?? code);
      const group = String(d.DimensionGroup ?? d.dimensionGroup ?? d.Group ?? d.group ?? "");
      return { value: code, label: name && name !== code ? `${name} (${code})` : code, group };
    }).filter(o => o.value && !seen.has(o.value) && seen.add(o.value));
  }, [dimensions]);
  const accountOpts = useMemo(() => (accounts ?? []).map(a => ({
    value: a.code, label: a.name ? `${a.code} · ${a.name}` : a.code,
    group: a.statement === "cf" ? t("pres_cf", "Flujo de caja") : a.type === "B/S" ? t("pres_acc_bs", "Balance") : t("pres_acc_pl", "Cuenta de resultados"),
  })), [accounts, t]);
  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }));

  // En flujo de caja, las vistas del consolidado son total del grupo o una sociedad.
  const effView = isCf ? (view === "company" ? "company" : "total") : (["consolidated", "eliminations", "contribution"].includes(view) ? view : "consolidated");
  const needsCompany = consolidated && (effView === "contribution" || effView === "company");
  const draft = {
    kind: "accounts", statement: isCf ? "cf" : undefined, scope, entity: effEntity, entityLabel: companyName(companies, effEntity), filters,
    ...(consolidated ? { view: effView, ...(needsCompany ? { company: effCompany, companyLabel: companyName(companies, effCompany) } : {}) } : {}),
    selection: selType === "range" ? { type: "range", from, to } : { type: "list", codes },
    hideZero, showCodes,
  };
  const selected = accountsRows(draft, period, data);
  const over = capacity && selected.length > capacity;

  // Lista de la derecha: todas las cuentas (con búsqueda y tipo).
  const query = q.trim().toLowerCase();
  const inRange = new Set(selType === "range" ? selected.map(r => r.code) : []);
  const valueOf = (code) => resolveAccount({
    statement: isCf ? "cf" : undefined, scope, entity: effEntity, view: consolidated ? effView : undefined, company: effCompany, accountCode: code,
  }, sp);
  const listed = (accounts ?? []).map(a => ({ a, r: valueOf(a.code) })).filter(({ a, r }) => {
    if (!isCf && typeFilter === "pl" && a.type === "B/S") return false;
    if (!isCf && typeFilter === "bs" && a.type !== "B/S") return false;
    // Filtro por saldo (solo cuando el valor ya está calculado).
    if (signFilter !== "all" && r.status === "ok") {
      const v = r.value ?? 0;
      if (signFilter === "nonzero" && Math.abs(v) <= 0.004) return false;
      if (signFilter === "positive" && !(v > 0.004)) return false;
      if (signFilter === "negative" && !(v < -0.004)) return false;
    } else if (signFilter !== "all" && r.status !== "loading") return false;
    return !query || a.code.toLowerCase().includes(query) || a.name.toLowerCase().includes(query);
  }).slice(0, 600);
  const visibleCodes = listed.map(({ a }) => a.code);
  const allVisibleOn = visibleCodes.length > 0 && visibleCodes.every(c => codes.includes(c));
  const toggleVisible = () => setCodes(list => (allVisibleOn
    ? list.filter(c => !visibleCodes.includes(c))
    : [...new Set([...list, ...visibleCodes])]));
  const toggle = (code) => setCodes(list => (list.includes(code) ? list.filter(c => c !== code) : [...list, code]));

  // Selección como en el explorador de archivos:
  //  · clic            → marca/desmarca una cuenta y la deja como ancla;
  //  · Shift + clic    → marca (o desmarca, si la cuenta pulsada ya estaba
  //                      marcada) todas las cuentas visibles entre el ancla y
  //                      la pulsada, respetando búsqueda y filtros;
  //  · Ctrl/⌘ + clic   → igual que un clic (añade o quita sin tocar el resto).
  const anchorRef = useRef(null);
  const clickList = (e, code) => {
    const anchor = anchorRef.current;
    if (e.shiftKey && anchor && anchor !== code) {
      const i1 = visibleCodes.indexOf(anchor);
      const i2 = visibleCodes.indexOf(code);
      if (i1 >= 0 && i2 >= 0) {
        const span = visibleCodes.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
        const removing = codes.includes(code);
        setCodes(list => (removing
          ? list.filter(c => !span.includes(c))
          : [...new Set([...list, ...span])]));
        anchorRef.current = code;
        return;
      }
    }
    toggle(code);
    anchorRef.current = code;
  };

  const cleanFilters = () => {
    const out = {};
    ["source", "structure", "year", "month", "mode"].forEach(k => { if (filters[k]) out[k] = filters[k]; });
    if (Array.isArray(filters.dims) && filters.dims.length) out.dims = filters.dims;
    return Object.keys(out).length ? out : null;
  };
  const canSave = selType === "range" ? !!(from && to) : codes.length > 0;

  // ¿Hay datos para la empresa/grupo en el periodo? En consolidado es normal
  // que el último mes aún no esté consolidado: se avisa y se propone el
  // último periodo consolidado (se guarda como filtro propio de año/mes).
  const probeCode = (accounts ?? []).find(a => !a.isSum)?.code ?? accounts?.[0]?.code;
  const probe = probeCode ? valueOf(probeCode) : null;
  const noData = ready && probe?.status === "nodata";
  const latest = noData && consolidated ? data.latestConsolidated(effEntity, sp) : null;
  const monthShortP = (m) => t(`month_${m}`, String(m)).slice(0, 3).toLowerCase();

  const entityName0 = companyName(companies, effEntity) || effEntity || "";
  const steps = [
    {
      id: "kind", icon: LayoutGrid, title: t("pres_wz_block_kind", "¿Qué quieres poner en este espacio?"),
      hint: t("pres_wz_block_kind_hint", "Elige el tipo de tabla. Podrás cambiarlo más tarde."),
      summary: t("pres_block_accounts", "Cuentas"), valid: true,
      content: <BlockKindCards value={"accounts"} onChange={onSwitchKind} />,
    },
    {
      id: "source", icon: Building2, title: t("pres_wz_acc_source", "¿De dónde salen los datos?"),
      hint: t("pres_wz_acc_source_hint", "Elige el estado (resultados y balance o cash flow), si es una sociedad o un grupo, y cuál."),
      summary: entityName0, valid: !!effEntity,
      content: (
        <>
            <div className={styles.kpField}>
              <span className={styles.mLabel}>{t("pres_acc_statement", "Estado")}</span>
              <div className={styles.tabs} role="tablist">
                {[["fin", t("pres_acc_fin", "PyG y balance")], ["cf", t("pres_cf", "Flujo de caja")]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={statement === id}
                    className={cx(styles.tab, statement === id && styles.tabActive)}
                    onClick={() => { if (id !== statement) { setStatement(id); setCodes([]); setFrom(""); setTo(""); } }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.kpRow2}>
              <div className={styles.kpField}>
                <span className={styles.mLabel}>{t("pres_kpi_scope", "Ámbito")}</span>
                <div className={styles.tabs} role="tablist">
                  {[["individual", t("pres_kpi_individual", "Individual")], ["consolidated", t("pres_kpi_consolidated", "Consolidado")]].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={scope === id}
                      className={cx(styles.tab, scope === id && styles.tabActive)} onClick={() => { setScope(id); setEntity(""); }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.kpField}>
                <span className={styles.mLabel}>{consolidated ? t("pres_kpi_group", "Grupo") : t("pres_kpi_company", "Empresa")}</span>
                <Dropdown value={effEntity} options={entityOpts} onChange={setEntity}
                  placeholder={consolidated ? t("pres_no_groups", "No hay grupos consolidables") : ""}
                  ariaLabel={consolidated ? t("pres_kpi_group", "Grupo") : t("pres_kpi_company", "Empresa")} />
              </div>
            </div>
            {consolidated && (
              <div className={styles.kpSection}>
                <p className={styles.kpSectionTitle}>{t("pres_acc_view", "Qué columna de la consolidación")}</p>
                <div className={styles.tabs} role="tablist">
                  {(isCf ? [
                    ["total", t("pres_cf_total", "Total del grupo")],
                    ["company", t("pres_cf_company", "Sociedad")],
                  ] : [
                    ["consolidated", t("pres_kpi_consolidated", "Consolidado")],
                    ["eliminations", t("pres_acc_view_elim", "Eliminaciones")],
                    ["contribution", t("pres_acc_view_contrib", "Contribución")],
                  ]).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={effView === id}
                      className={cx(styles.tab, effView === id && styles.tabActive)} onClick={() => setView(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                {needsCompany && (
                  <div style={{ marginTop: 10 }}>
                    <Dropdown value={effCompany} options={memberOpts} onChange={setCompany} ariaLabel={t("pres_kpi_company", "Empresa")} />
                  </div>
                )}
              </div>
            )}
        </>
      ),
    },
    {
      id: "filters", icon: Filter, optional: true, title: t("pres_wz_kpi_filters", "Periodo y filtros"),
      hint: t("pres_kpi_filters_hint", "Lo que dejes en «General» sigue los filtros del header de la presentación."),
      summary: "",
      content: (
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_acc_filters", "Filtros")}</p>
              <p className={styles.kpSectionHint}>{t("pres_kpi_filters_hint", "Lo que dejes en «General» sigue los filtros del header de la presentación.")}</p>
              <div className={styles.kpGrid3}>
                <Dropdown value={filters.source ?? ""} options={[{ value: "", label: inherit(period.source) }, ...sourceOpts]}
                  onChange={v => setFilter({ source: v })} ariaLabel={t("filter_source", "Fuente")} />
                <Dropdown value={filters.structure ?? ""} options={[{ value: "", label: inherit(period.structure) }, ...structureOpts]}
                  onChange={v => setFilter({ structure: v })} ariaLabel={t("filter_structure", "Perímetro")} />
                <Dropdown value={filters.mode ?? ""} options={[{ value: "", label: inherit(modeName(period.mode)) },
                  { value: "ytd", label: modeName("ytd") }, { value: "monthly", label: modeName("monthly") }]}
                  onChange={v => setFilter({ mode: v })} ariaLabel={t("pres_mode", "Modo")} />
                <Dropdown value={filters.year ?? ""} options={[{ value: "", label: inherit(period.year) }, ...years.map(v => ({ value: v, label: v }))]}
                  onChange={v => setFilter({ year: v })} ariaLabel={t("filter_year", "Año")} />
                <Dropdown value={filters.month ?? ""} options={[{ value: "", label: inherit(monthName(period.month)) },
                  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))]}
                  onChange={v => setFilter({ month: v })} ariaLabel={t("filter_month", "Mes")} />
                <Dropdown multiple value={filters.dims ?? []} options={dimOpts} placeholder={t("pres_all_dims", "Todas las dimensiones")}
                  onChange={v => setFilter({ dims: v })} ariaLabel={t("pres_dims", "Dimensiones")} />
              </div>
            </div>
      ),
    },
    {
      id: "accounts", icon: Table2, title: t("pres_wz_acc_pick", "¿Qué cuentas?"),
      hint: t("pres_wz_acc_pick_hint", "Márcalas en la lista (Shift + clic para un tramo) o elige un rango."),
      summary: fill(t("pres_wz_n_accounts", "{n} cuentas"), { n: selected.length }), valid: !!canSave,
      content: (
        <div className={styles.wzSplit}>
          <div className={styles.wzSplitSide}>
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_acc_selection", "Selección")}</p>
              <div className={styles.tabs} role="tablist">
                {[["list", t("pres_acc_list", "Cuentas sueltas")], ["range", t("pres_acc_range", "Rango de cuentas")]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={selType === id}
                    className={cx(styles.tab, selType === id && styles.tabActive)} onClick={() => setSelType(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {selType === "range" ? (
                <div className={styles.kpGrid2}>
                  <Dropdown value={from} options={accountOpts} placeholder={t("pres_from", "Desde")} onChange={setFrom} ariaLabel={t("pres_from", "Desde")} />
                  <Dropdown value={to} options={accountOpts} placeholder={t("pres_to", "Hasta")} onChange={setTo} ariaLabel={t("pres_to", "Hasta")} />
                </div>
              ) : (
                <p className={styles.kpSectionHint} style={{ marginTop: 10 }}>{t("pres_acc_list_hint", "Marca en la lista de la derecha las cuentas que quieres mostrar. Mantén Shift y haz clic en otra cuenta para marcar todo el tramo entre ambas.")}</p>
              )}
              <div className={styles.chips} style={{ marginTop: 12 }}>
                <button type="button" className={cx(styles.chip, hideZero && styles.chipOn)} aria-pressed={hideZero} onClick={() => setHideZero(v => !v)}>
                  {hideZero && <Check size={11} strokeWidth={3} />}{t("pres_acc_hide_zero", "Ocultar cuentas sin saldo")}
                </button>
                <button type="button" className={cx(styles.chip, showCodes && styles.chipOn)} aria-pressed={showCodes} onClick={() => setShowCodes(v => !v)}>
                  {showCodes && <Check size={11} strokeWidth={3} />}{t("pres_acc_show_codes", "Mostrar código")}
                </button>
              </div>
            </div>
            {noData && (
              <div className={cx(styles.accFit, styles.accFitOver)}>
                <strong>
                  {fill(t("pres_acc_no_data", "No hay datos de {entity} en {period}."), {
                    entity: companyName(companies, effEntity), period: `${monthShortP(sp.month)} ${sp.year}`,
                  })}
                </strong>
                {latest && (latest.year !== sp.year || latest.month !== sp.month) ? (
                  <span>
                    {fill(t("pres_acc_latest_cons", "Último periodo consolidado: {period}."), { period: `${monthShortP(latest.month)} ${latest.year}` })}{" "}
                    <button type="button" className={styles.linkBtn} onClick={() => setFilter({ year: latest.year, month: latest.month })}>
                      {t("pres_acc_use_period", "Usar ese periodo")}
                    </button>
                  </span>
                ) : consolidated ? (
                  <span>{t("pres_acc_no_cons_hint", "Comprueba que el grupo está consolidado para esta fuente y perímetro.")}</span>
                ) : null}
              </div>
            )}
            <div className={cx(styles.accFit, over && styles.accFitOver)}>
              <strong>{fill(t("pres_acc_selected", "{n} cuentas seleccionadas"), { n: selected.length })}</strong>
              {capacity ? <span>{fill(t("pres_acc_capacity", "En este espacio caben {n}."), { n: capacity })}</span> : null}
              {over && <span>{fill(t("pres_acc_over", "Se verán las {n} primeras."), { n: capacity })}</span>}
            </div>
          </div>
          <div className={styles.wzSplitMain}>
            <div className={styles.kpFilterBar}>
              <input className={cx(styles.mInput, styles.kpSearch)} value={q} onChange={e => setQ(e.target.value)}
                placeholder={t("pres_acc_search", "Buscar por código o nombre")} aria-label={t("pres_acc_search", "Buscar por código o nombre")} />
              {!isCf && <Dropdown value={typeFilter} onChange={setTypeFilter} ariaLabel={t("pres_acc_type", "Tipo de cuenta")}
                options={[
                  { value: "all", label: t("pres_acc_all_types", "Todas las cuentas") },
                  { value: "pl", label: t("pres_acc_pl", "Cuenta de resultados") },
                  { value: "bs", label: t("pres_acc_bs", "Balance") },
                ]} />}
              <Dropdown value={signFilter} onChange={setSignFilter} ariaLabel={t("pres_acc_sign", "Saldo")}
                options={[
                  { value: "all", label: t("pres_acc_sign_all", "Cualquier saldo") },
                  { value: "nonzero", label: t("pres_acc_sign_nonzero", "Solo con saldo") },
                  { value: "positive", label: t("pres_acc_sign_pos", "Solo positivas") },
                  { value: "negative", label: t("pres_acc_sign_neg", "Solo negativas") },
                ]} />
              {selType === "list" && (
                <button type="button" className={cx(styles.chip, styles.accMarkAll)} onClick={toggleVisible} disabled={!visibleCodes.length}>
                  <Check size={11} strokeWidth={3} />
                  {allVisibleOn
                    ? t("pres_acc_unmark_visible", "Desmarcar las visibles")
                    : fill(t("pres_acc_mark_visible", "Marcar las {n} visibles"), { n: visibleCodes.length })}
                </button>
              )}
            </div>
            <div className={styles.kpList}>
              {!ready && <p className={styles.kpEmpty}>{t("pres_kpi_loading", "Cargando KPIs…")}</p>}
              {ready && listed.length === 0 && <p className={styles.kpEmpty}>{t("pres_acc_none", "No hay cuentas con esos filtros.")}</p>}
              {ready && listed.map(({ a, r }) => {
                const on = selType === "list" ? codes.includes(a.code) : inRange.has(a.code);
                return (
                  <button key={a.code} type="button"
                    className={cx(styles.accItem, on && styles.accItemOn, a.isSum && styles.accItemSum)}
                    onMouseDown={e => { if (e.shiftKey) e.preventDefault(); /* sin seleccionar texto */ }}
                    onClick={e => (selType === "list" ? clickList(e, a.code) : (!from || (from && to) ? (setFrom(a.code), setTo("")) : setTo(a.code)))}
                    style={{ paddingLeft: 10 + Math.min(a.depth, 6) * 14 }}>
                    <span className={cx(styles.ddCheck, on && styles.ddCheckOn)}>{on && <Check size={11} strokeWidth={3} />}</span>
                    <span className={styles.accItemCode}>{a.code}</span>
                    <span className={styles.accItemName}>{a.name}</span>
                    <span className={styles.kpRowValue}>
                      {r.status === "ok" ? formatKpiValue(r.value, "currency") : r.status === "loading" ? "…" : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ),
    },
  ];
  return (
    <Wizard
      title={t("pres_pick_accounts", "Elegir cuentas")}
      steps={steps}
      startAt={switchedFrom ? 1 : initial ? 1 : 0}
      instant={!!switchedFrom}
      swapAnim={!!switchedFrom}
      onClose={onClose}
      onFinish={() => canSave && onSave({ ...draft, filters: cleanFilters() })}
      finishLabel={initial ? t("pres_save_changes", "Guardar cambios") : t("pres_acc_save", "Guardar cuentas")}
      extraFoot={initial ? (
        <button type="button" className={cx(styles.btnGhost, styles.kpRemove)} onClick={onRemove}>
          <Trash2 size={14} />{t("pres_acc_remove", "Quitar cuentas")}
        </button>
      ) : null}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Selector de la sábana de consolidación: grupo, filtros, qué columnas,
   qué sociedades (todas o algunas + "Resto" sumado) y qué cuentas.
   ══════════════════════════════════════════════════════════════════════ */
function SheetPickerModal({ data, companies, sources, structures, period, initial, capacity, onSave, onRemove, onClose, onSwitchKind, variant = "sheet", switchedFrom = null }) {
  const t = useT();
  const isContrib = variant === "contrib";
  const { ensure, accounts, resolveAccount, ready, holdings } = data;
  // Contributivo: comprimido (varias sociedades) o desplegado (una, con su desglose)
  const [contribMode, setContribMode] = useState(initial?.mode === "detail" ? "detail" : "compact");
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [filters, setFilters] = useState(initial?.filters ?? {});
  const [columns, setColumns] = useState(initial?.columns ?? { consolidated: true, eliminations: true, contribution: true });
  const [companiesMode, setCompaniesMode] = useState(initial?.companiesMode ?? "all");
  const [picked, setPicked] = useState(initial?.companies ?? []);
  const [showRest, setShowRest] = useState(initial?.showRest ?? true);
  const [selType, setSelType] = useState(initial?.selection?.type === "range" ? "range" : "list");
  const [codes, setCodes] = useState(initial?.selection?.type === "list" ? (initial.selection.codes ?? []) : []);
  const [from, setFrom] = useState(initial?.selection?.type === "range" ? initial.selection.from : "");
  const [to, setTo] = useState(initial?.selection?.type === "range" ? initial.selection.to : "");
  const [hideZero, setHideZero] = useState(initial?.hideZero ?? true);
  const [showCodes, setShowCodes] = useState(initial?.showCodes ?? true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const groupOpts = useMemo(() => holdings.list.map(g => ({ value: g, label: companyName(companies, g) })), [holdings.list, companies]);
  const effEntity = groupOpts.some(o => o.value === entity) ? entity : (holdings.root || groupOpts[0]?.value || "");
  const members = holdings.membersOf(effEntity);
  const sp = slotPeriod(period, { filters });
  const spKey = `${sp.source}|${sp.structure}|${sp.year}|${sp.month}|${sp.mode}`;
  const pickedKey = picked.join(",");
  useEffect(() => {
    if (!effEntity) return;
    const [source, structure, year, month, mode] = spKey.split("|");
    if (isContrib) {
      const cos = pickedKey ? pickedKey.split(",") : [];
      ensure(cos.flatMap(co => [
        { scope: "individual", entity: co, source, structure, year, month, mode },
        { scope: "journals", entity: co, source, structure, year, month, mode },
      ]));
    } else {
      ensure("consolidated", effEntity, { source, structure, year, month, mode });
    }
  }, [ensure, effEntity, spKey, isContrib, pickedKey]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inherit = (v) => `${t("pres_inherit", "General")} · ${v}`;
  const modeName = (m) => (m === "monthly" ? t("mode_monthly", "Mensual") : t("mode_ytd", "YTD"));
  const monthName = (m) => t(`month_${m}`, String(m));
  const yearNow = new Date().getFullYear();
  const years = [...new Set([...Array.from({ length: 7 }, (_, i) => String(yearNow - i)), String(period.year)])].sort((a, b) => Number(b) - Number(a));
  const sourceOpts = sources.map(x => optSource(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const structureOpts = structures.map(x => optStructure(x)).filter(Boolean).map(v => ({ value: v, label: v }));
  const accountOpts = useMemo(() => (accounts ?? []).map(a => ({
    value: a.code, label: a.name ? `${a.code} · ${a.name}` : a.code,
    group: a.type === "B/S" ? t("pres_acc_bs", "Balance") : t("pres_acc_pl", "Cuenta de resultados"),
  })), [accounts, t]);
  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }));

  const draft = isContrib ? {
    kind: "contrib", entity: effEntity, entityLabel: companyName(companies, effEntity), filters,
    mode: contribMode, companies: contribMode === "detail" ? picked.slice(0, 1) : picked,
    selection: selType === "range" ? { type: "range", from, to } : { type: "list", codes },
    hideZero, showCodes,
  } : {
    kind: "sheet", scope: "consolidated", entity: effEntity, entityLabel: companyName(companies, effEntity), filters,
    columns, companiesMode, companies: picked, showRest,
    selection: selType === "range" ? { type: "range", from, to } : { type: "list", codes },
    hideZero, showCodes,
  };
  const preview = isContrib
    ? contribRows(draft, period, { ...data, accounts }, companies, t)
    : sheetRows(draft, period, { ...data, accounts }, companies, t);
  const over = capacity && preview.rows.length > capacity;

  // Lista de cuentas (con el consolidado al lado) y selección con Shift
  const query = q.trim().toLowerCase();
  const listed = (accounts ?? []).filter(a => {
    if (typeFilter === "pl" && a.type === "B/S") return false;
    if (typeFilter === "bs" && a.type !== "B/S") return false;
    return !query || a.code.toLowerCase().includes(query) || a.name.toLowerCase().includes(query);
  }).slice(0, 600);
  const visibleCodes = listed.map(a => a.code);
  const anchorRef = useRef(null);
  const inRange = new Set(selType === "range" ? preview.rows.map(r => r.code) : []);
  const clickList = (e, code) => {
    const anchor = anchorRef.current;
    if (e.shiftKey && anchor && anchor !== code) {
      const i1 = visibleCodes.indexOf(anchor), i2 = visibleCodes.indexOf(code);
      if (i1 >= 0 && i2 >= 0) {
        const span = visibleCodes.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
        const removing = codes.includes(code);
        setCodes(list => (removing ? list.filter(c => !span.includes(c)) : [...new Set([...list, ...span])]));
        anchorRef.current = code;
        return;
      }
    }
    setCodes(list => (list.includes(code) ? list.filter(c => c !== code) : [...list, code]));
    anchorRef.current = code;
  };
  const togglePicked = (c) => setPicked(list => (
    isContrib && contribMode === "detail" ? [c] : (list.includes(c) ? list.filter(x => x !== c) : [...list, c])
  ));
  const canSave = !!effEntity && (selType === "range" ? !!(from && to) : codes.length > 0)
    && (isContrib
      ? picked.length > 0
      : (columns.consolidated || columns.eliminations || columns.contribution || companiesMode === "all" || picked.length > 0));
  const cleanFilters = () => {
    const out = {};
    ["source", "structure", "year", "month", "mode"].forEach(k => { if (filters[k]) out[k] = filters[k]; });
    return Object.keys(out).length ? out : null;
  };
  const chip = (on, label, onClick) => (
    <button type="button" className={cx(styles.chip, on && styles.chipOn)} aria-pressed={on} onClick={onClick}>
      {on && <Check size={11} strokeWidth={3} />}{label}
    </button>
  );

  const steps = [
    {
      id: "kind", icon: LayoutGrid, title: t("pres_wz_block_kind", "¿Qué quieres poner en este espacio?"),
      hint: t("pres_wz_block_kind_hint", "Elige el tipo de tabla. Podrás cambiarlo más tarde."),
      summary: isContrib ? t("pres_contrib_title", "Contributivo") : t("pres_sheet_title", "Sábana de consolidación"), valid: true,
      content: <BlockKindCards value={isContrib ? "contrib" : "sheet"} onChange={onSwitchKind} />,
    },
    {
      id: "group", icon: Building2,
      title: isContrib ? t("pres_wz_contrib_who", "¿Qué sociedades y cómo?") : t("pres_wz_sheet_who", "¿Qué grupo y qué columnas?"),
      hint: isContrib
        ? t("pres_wz_contrib_who_hint", "Elige el grupo, si quieres varias sociedades comprimidas o una desplegada, y cuáles.")
        : t("pres_wz_sheet_who_hint", "Elige el grupo, las columnas (consolidado, eliminaciones, contribución) y las sociedades."),
      summary: `${companyName(companies, effEntity) || effEntity}${isContrib && picked.length ? ` · ${picked.map(c => companyName(companies, c)).join(", ")}` : ""}`,
      valid: !!effEntity && (!isContrib || picked.length > 0),
      content: (
        <>
            <div className={styles.kpField}>
              <span className={styles.mLabel}>{t("pres_kpi_group", "Grupo")}</span>
              <Dropdown value={effEntity} options={groupOpts} onChange={(v) => { setEntity(v); setPicked([]); }}
                placeholder={t("pres_no_groups", "No hay grupos consolidables")} ariaLabel={t("pres_kpi_group", "Grupo")} />
            </div>
            {isContrib && (
              <div className={styles.kpSection}>
                <p className={styles.kpSectionTitle}>{t("pres_contrib_view", "Vista")}</p>
                <div className={styles.tabs} role="tablist">
                  {[["compact", t("pres_contrib_compact", "Varias sociedades")], ["detail", t("pres_contrib_detail", "Una sociedad desplegada")]].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={contribMode === id}
                      className={cx(styles.tab, contribMode === id && styles.tabActive)}
                      onClick={() => { setContribMode(id); if (id === "detail") setPicked(list => list.slice(0, 1)); }}>{label}</button>
                  ))}
                </div>
                <p className={styles.kpSectionHint} style={{ marginTop: 8 }}>
                  {contribMode === "detail"
                    ? t("pres_contrib_detail_hint", "Cargado + asientos (AJE, RJE, EJE, SYS, CFA) = total, en la moneda de la sociedad.")
                    : t("pres_contrib_compact_hint", "Una columna por sociedad con su total (cargado + asientos), cada una en su moneda.")}
                </p>
                <p className={styles.kpSectionTitle} style={{ marginTop: 14 }}>{t("pres_sheet_companies", "Sociedades")}</p>
                <div className={styles.chips}>
                  {members.map(c => chip(picked.includes(c), companyName(companies, c), () => togglePicked(c)))}
                </div>
              </div>
            )}
            {!isContrib && (
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_sheet_columns", "Columnas")}</p>
              <div className={styles.chips}>
                {chip(columns.consolidated, t("pres_sheet_cons", "Consolidado"), () => setColumns(c => ({ ...c, consolidated: !c.consolidated })))}
                {chip(columns.eliminations, t("pres_sheet_elim", "Eliminaciones"), () => setColumns(c => ({ ...c, eliminations: !c.eliminations })))}
                {chip(columns.contribution, t("pres_sheet_contrib", "Contribución"), () => setColumns(c => ({ ...c, contribution: !c.contribution })))}
              </div>
              <p className={styles.kpSectionTitle} style={{ marginTop: 14 }}>{t("pres_sheet_companies", "Sociedades")}</p>
              <div className={styles.tabs} role="tablist">
                {[["all", t("pres_sheet_all", "Todas")], ["some", t("pres_sheet_some", "Algunas + resto")]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={companiesMode === id}
                    className={cx(styles.tab, companiesMode === id && styles.tabActive)} onClick={() => setCompaniesMode(id)}>{label}</button>
                ))}
              </div>
              {companiesMode === "some" && (
                <>
                  <div className={styles.chips} style={{ marginTop: 10 }}>
                    {members.map(c => chip(picked.includes(c), companyName(companies, c), () => togglePicked(c)))}
                  </div>
                  <div className={styles.chips} style={{ marginTop: 10 }}>
                    {chip(showRest, t("pres_sheet_show_rest", "Mostrar el resto sumado"), () => setShowRest(v => !v))}
                  </div>
                </>
              )}
            </div>
            )}
        </>
      ),
    },
    {
      id: "filters", icon: Filter, optional: true, title: t("pres_wz_kpi_filters", "Periodo y filtros"),
      hint: t("pres_kpi_filters_hint", "Lo que dejes en «General» sigue los filtros del header de la presentación."),
      summary: "",
      content: (
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_acc_filters", "Filtros")}</p>
              <p className={styles.kpSectionHint}>{t("pres_kpi_filters_hint", "Lo que dejes en «General» sigue los filtros del header de la presentación.")}</p>
              <div className={styles.kpGrid3}>
                <Dropdown value={filters.source ?? ""} options={[{ value: "", label: inherit(period.source) }, ...sourceOpts]} onChange={v => setFilter({ source: v })} ariaLabel={t("filter_source", "Fuente")} />
                <Dropdown value={filters.structure ?? ""} options={[{ value: "", label: inherit(period.structure) }, ...structureOpts]} onChange={v => setFilter({ structure: v })} ariaLabel={t("filter_structure", "Perímetro")} />
                <Dropdown value={filters.mode ?? ""} options={[{ value: "", label: inherit(modeName(period.mode)) }, { value: "ytd", label: modeName("ytd") }, { value: "monthly", label: modeName("monthly") }]} onChange={v => setFilter({ mode: v })} ariaLabel={t("pres_mode", "Modo")} />
                <Dropdown value={filters.year ?? ""} options={[{ value: "", label: inherit(period.year) }, ...years.map(v => ({ value: v, label: v }))]} onChange={v => setFilter({ year: v })} ariaLabel={t("filter_year", "Año")} />
                <Dropdown value={filters.month ?? ""} options={[{ value: "", label: inherit(monthName(period.month)) }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))]} onChange={v => setFilter({ month: v })} ariaLabel={t("filter_month", "Mes")} />
              </div>
            </div>
      ),
    },
    {
      id: "accounts", icon: Table2, title: t("pres_wz_acc_pick", "¿Qué cuentas?"),
      hint: t("pres_wz_acc_pick_hint", "Márcalas en la lista (Shift + clic para un tramo) o elige un rango."),
      summary: fill(t("pres_sheet_summary", "{n} cuentas · {c} columnas"), { n: preview.rows.length, c: preview.cols.length }),
      valid: !!canSave,
      content: (
        <div className={styles.wzSplit}>
          <div className={styles.wzSplitSide}>
            <div className={styles.kpSection}>
              <p className={styles.kpSectionTitle}>{t("pres_acc_selection", "Selección")}</p>
              <div className={styles.tabs} role="tablist">
                {[["list", t("pres_acc_list", "Cuentas sueltas")], ["range", t("pres_acc_range", "Rango de cuentas")]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={selType === id}
                    className={cx(styles.tab, selType === id && styles.tabActive)} onClick={() => setSelType(id)}>{label}</button>
                ))}
              </div>
              {selType === "range" && (
                <div className={styles.kpGrid2}>
                  <Dropdown value={from} options={accountOpts} placeholder={t("pres_from", "Desde")} onChange={setFrom} ariaLabel={t("pres_from", "Desde")} />
                  <Dropdown value={to} options={accountOpts} placeholder={t("pres_to", "Hasta")} onChange={setTo} ariaLabel={t("pres_to", "Hasta")} />
                </div>
              )}
              <div className={styles.chips} style={{ marginTop: 12 }}>
                {chip(hideZero, t("pres_acc_hide_zero", "Ocultar cuentas sin saldo"), () => setHideZero(v => !v))}
                {chip(showCodes, t("pres_acc_show_codes", "Mostrar código"), () => setShowCodes(v => !v))}
              </div>
            </div>
            <div className={cx(styles.accFit, over && styles.accFitOver)}>
              <strong>{fill(t("pres_sheet_summary", "{n} cuentas · {c} columnas"), { n: preview.rows.length, c: preview.cols.length })}</strong>
              {capacity ? <span>{fill(t("pres_acc_capacity", "En este espacio caben {n}."), { n: capacity })}</span> : null}
            </div>
          </div>
          <div className={styles.wzSplitMain}>
            <div className={styles.kpFilterBar}>
              <input className={cx(styles.mInput, styles.kpSearch)} value={q} onChange={e => setQ(e.target.value)}
                placeholder={t("pres_acc_search", "Buscar por código o nombre")} aria-label={t("pres_acc_search", "Buscar por código o nombre")} />
              <Dropdown value={typeFilter} onChange={setTypeFilter} ariaLabel={t("pres_acc_type", "Tipo de cuenta")}
                options={[{ value: "all", label: t("pres_acc_all_types", "Todas las cuentas") }, { value: "pl", label: t("pres_acc_pl", "Cuenta de resultados") }, { value: "bs", label: t("pres_acc_bs", "Balance") }]} />
            </div>
            <div className={styles.kpList}>
              {!ready && <p className={styles.kpEmpty}>{t("pres_kpi_loading", "Cargando…")}</p>}
              {ready && listed.map(a => {
                const r = isContrib
                  ? (picked[0] ? data.resolveContrib({ entity: picked[0], accountCode: a.code }, sp) : { status: "empty" })
                  : resolveAccount({ scope: "consolidated", entity: effEntity, view: "consolidated", accountCode: a.code }, sp);
                const on = selType === "list" ? codes.includes(a.code) : inRange.has(a.code);
                return (
                  <button key={a.code} type="button" className={cx(styles.accItem, on && styles.accItemOn, a.isSum && styles.accItemSum)}
                    onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
                    onClick={e => (selType === "list" ? clickList(e, a.code) : (!from || (from && to) ? (setFrom(a.code), setTo("")) : setTo(a.code)))}
                    style={{ paddingLeft: 10 + Math.min(a.depth, 6) * 14 }}>
                    <span className={cx(styles.ddCheck, on && styles.ddCheckOn)}>{on && <Check size={11} strokeWidth={3} />}</span>
                    <span className={styles.accItemCode}>{a.code}</span>
                    <span className={styles.accItemName}>{a.name}</span>
                    <span className={styles.kpRowValue}>{r.status === "ok" ? formatKpiValue(r.value, "currency") : r.status === "loading" ? "…" : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ),
    },
  ];
  return (
    <Wizard
      title={isContrib ? t("pres_contrib_title", "Contributivo") : t("pres_sheet_title", "Sábana de consolidación")}
      steps={steps}
      startAt={switchedFrom ? 1 : initial ? 1 : 0}
      instant={!!switchedFrom}
      swapAnim={!!switchedFrom}
      onClose={onClose}
      onFinish={() => canSave && onSave({ ...draft, filters: cleanFilters() })}
      finishLabel={initial ? t("pres_save_changes", "Guardar cambios") : isContrib ? t("pres_contrib_save", "Guardar contributivo") : t("pres_sheet_save", "Guardar sábana")}
      extraFoot={initial ? (
        <button type="button" className={cx(styles.btnGhost, styles.kpRemove)} onClick={onRemove}>
          <Trash2 size={14} />{isContrib ? t("pres_contrib_remove", "Quitar contributivo") : t("pres_sheet_remove", "Quitar sábana")}
        </button>
      ) : null}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Panel de variables: todo lo que se ha metido en las diapositivas (KPIs y
   textos). Clic = ir a la diapositiva y resaltar el espacio. El modo
   revisión añade casillas para ir marcando lo repasado; una marca se pierde
   sola si esa variable cambia después de marcarla.
   ══════════════════════════════════════════════════════════════════════ */
function VariablesPanel({ items, data, period, companies = [], reviewMode, onReviewMode, isChecked, onToggle, onReset, onGo, onClose }) {
  const t = useT();
  const checkedCount = items.filter(isChecked).length;
  const pct = items.length ? Math.round((checkedCount / items.length) * 100) : 0;

  return (
    <>
      <div className={styles.vpHead}>
        <div className={styles.vpTitleRow}>
          <p className={styles.dpTitle}>
            {t("pres_variables", "Variables")}
            <span className={styles.vpCount}>{items.length}</span>
          </p>
          <button type="button" className={styles.mClose} onClick={onClose} aria-label={t("pres_close", "Cerrar")}>
            <X size={15} />
          </button>
        </div>
        <label className={styles.vpSwitch}>
          <input type="checkbox" checked={reviewMode} onChange={e => onReviewMode(e.target.checked)} />
          <span className={styles.vpSwitchTrack}><span className={styles.vpSwitchThumb} /></span>
          <span>{t("pres_review_mode", "Modo revisión")}</span>
        </label>
        {reviewMode && (
          <div className={styles.vpProgress}>
            <div className={styles.vpBar}><span style={{ width: `${pct}%` }} /></div>
            <span className={styles.vpProgressText}>
              {fill(t("pres_reviewed", "{done} de {total} revisadas"), { done: checkedCount, total: items.length })}
            </span>
            <button type="button" className={styles.vpReset} onClick={onReset} disabled={!checkedCount}>
              <RotateCcw size={12} />
              {t("pres_review_reset", "Reiniciar")}
            </button>
          </div>
        )}
      </div>

      <div className={styles.vpList}>
        {items.length === 0 && (
          <p className={styles.kpEmpty}>{t("pres_variables_empty", "Todavía no hay KPIs ni textos en las diapositivas.")}</p>
        )}
        {items.map((it, i) => {
          const showHeader = i === 0 || items[i - 1].slideIndex !== it.slideIndex;
          const checked = isChecked(it);
          let name, sub, value = null, fixed = false;
          if (it.content.kind === "kpi") {
            const sp = slotPeriod(period, it.content);
            const res = data.resolveKpi(it.content, sp);
            name = res?.kpi?.label ?? it.content.label ?? it.content.kpiId;
            const scopeLabel = it.content.scope === "consolidated" ? t("pres_kpi_consolidated", "Consolidado") : t("pres_kpi_individual", "Individual");
            const extra = filtersLabel(t, period, sp);
            sub = `${scopeLabel} · ${it.content.entityLabel ?? it.content.entity}${extra ? ` · ${extra}` : ""}`;
            value = res?.status === "ok" ? formatKpiValue(res.value, res.kpi.format) : res?.status === "loading" ? "…" : "—";
            fixed = slotFixedFields(it.content).length > 0;
          } else if (it.content.kind === "contrib") {
            name = t("pres_contrib_title", "Contributivo");
            const cr = contribRows(it.content, period, data, companies, t);
            sub = `${fill(t("pres_sheet_summary", "{n} cuentas · {c} columnas"), { n: cr.rows.length, c: cr.cols.length })} · ${(it.content.companies ?? []).map(c => companyName(companies, c)).join(", ")}`;
            fixed = slotFixedFields(it.content).length > 0;
          } else if (it.content.kind === "sheet") {
            name = t("pres_sheet_title", "Sábana de consolidación");
            const sr = sheetRows(it.content, period, data, companies, t);
            sub = `${fill(t("pres_sheet_summary", "{n} cuentas · {c} columnas"), { n: sr.rows.length, c: sr.cols.length })} · ${it.content.entityLabel ?? it.content.entity}`;
            fixed = slotFixedFields(it.content).length > 0;
          } else if (it.content.kind === "accounts") {
            const n = accountsRows(it.content, period, data).length;
            name = t("pres_slot_table", "Cuentas");
            sub = `${fill(t("pres_acc_n", "{n} cuentas"), { n })} · ${it.content.entityLabel ?? it.content.entity}`;
            fixed = slotFixedFields(it.content).length > 0;
          } else if (it.content.kind === "chart") {
            name = t("pres_chart_title", "Gráfica de KPIs");
            sub = chartSeriesSpecs(it.content, period).map(sp => sp.label ?? sp.kpiId).join(" · ");
            fixed = slotFixedFields(it.content).length > 0;
          } else {
            name = t("pres_slot_text", "Texto");
            sub = htmlToText(it.content.text);
          }
          const Icon = it.content.kind === "kpi" ? Gauge : it.content.kind === "chart" ? LineChart : (it.content.kind === "accounts" || it.content.kind === "sheet" || it.content.kind === "contrib") ? Table2 : AlignLeft;
          return (
            <Fragment key={it.key}>
              {showHeader && (
                <p className={styles.dpGroup}>
                  {fill(t("pres_slide_n", "Diapositiva {n}"), { n: it.slideIndex + 1 })}
                  {it.slideTitle ? ` · ${it.slideTitle}` : ""}
                </p>
              )}
              <div className={cx(styles.vpRow, checked && styles.vpRowDone)}>
                {reviewMode && (
                  <button type="button" role="checkbox" aria-checked={checked}
                    className={cx(styles.vpCheck, checked && styles.vpCheckOn)} onClick={() => onToggle(it)}
                    aria-label={t("pres_mark_reviewed", "Marcar como revisada")}>
                    {checked && <Check size={11} strokeWidth={3} />}
                  </button>
                )}
                <button type="button" className={styles.vpMain} onClick={() => onGo(it)}>
                  <Icon size={14} className={styles.vpIcon} />
                  <span className={styles.vpText}>
                    <span className={styles.vpName}>
                      {name}
                      {fixed && <Pin size={11} strokeWidth={2.4} className={styles.vpPin} />}
                    </span>
                    <span className={styles.vpSub}>{sub}</span>
                  </span>
                  {value != null && <span className={styles.vpValue}>{value}</span>}
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Barra de formato de texto. Aparece (animada) entre el header y el editor
   mientras hay un texto de la diapositiva en edición. Todos sus controles
   usan onMouseDown + preventDefault para no quitar el foco ni la selección
   del texto; por eso los menús de tamaño y color son propios y no usan
   desplegables que roben el foco.
   ══════════════════════════════════════════════════════════════════════ */
const FMT_TEXT_COLORS = ["#0f1a3d", "#1a2f8a", "#3b82f6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#6b7280", "#ffffff"];
const FMT_MARK_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "transparent"];
const FMT_SIZES = [
  { value: "2", labelKey: "pres_fmt_small", fallback: "Pequeño" },
  { value: "3", labelKey: "pres_fmt_normal", fallback: "Normal" },
  { value: "5", labelKey: "pres_fmt_large", fallback: "Grande" },
  { value: "6", labelKey: "pres_fmt_xlarge", fallback: "Muy grande" },
];

// Botón de la barra de formato (no quita el foco del texto).
function FmtBtn({ icon, active, label, onClick }) {
  const Icon = icon;
  return (
    <button type="button" className={cx(styles.fmtBtn, active && styles.fmtBtnOn)} title={label} aria-label={label}
      aria-pressed={!!active} onMouseDown={e => e.preventDefault()} onClick={onClick}>
      <Icon size={15} strokeWidth={2.3} />
    </button>
  );
}

function FormatBar({ visible }) {
  const t = useT();
  const [state, setState] = useState({});
  const [menu, setMenu] = useState(null); // "size" | "color" | "mark"

  // Estado de los botones según la selección actual.
  useEffect(() => {
    const read = () => {
      const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
      setState({
        bold: q("bold"), italic: q("italic"), underline: q("underline"), strike: q("strikeThrough"),
        ul: q("insertUnorderedList"), ol: q("insertOrderedList"),
        left: q("justifyLeft"), center: q("justifyCenter"), right: q("justifyRight"), full: q("justifyFull"),
      });
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

  const keep = (e) => e.preventDefault();
  const exec = (cmd, val = null) => {
    try {
      document.execCommand("styleWithCSS", false, cmd === "foreColor" || cmd === "hiliteColor");
      document.execCommand(cmd, false, val);
    } catch { /* comando no soportado */ }
    setMenu(null);
  };
  return (
    <div className={cx(styles.fmtWrap, visible && styles.fmtWrapOn)} aria-hidden={!visible}>
      <div className={styles.fmtInner}>
        <div className={styles.fmtBar} role="toolbar" aria-label={t("pres_fmt_toolbar", "Formato de texto")} onMouseDown={keep}>
          <FmtBtn icon={Bold} active={state.bold} label={t("pres_fmt_bold", "Negrita")} onClick={() => exec("bold")} />
          <FmtBtn icon={Italic} active={state.italic} label={t("pres_fmt_italic", "Cursiva")} onClick={() => exec("italic")} />
          <FmtBtn icon={Underline} active={state.underline} label={t("pres_fmt_underline", "Subrayado")} onClick={() => exec("underline")} />
          <FmtBtn icon={Strikethrough} active={state.strike} label={t("pres_fmt_strike", "Tachado")} onClick={() => exec("strikeThrough")} />
          <span className={styles.fmtSep} />

          <div className={styles.fmtMenuWrap}>
            <button type="button" className={cx(styles.fmtBtn, styles.fmtBtnText, menu === "size" && styles.fmtBtnOn)} onMouseDown={keep}
              onClick={() => setMenu(m => (m === "size" ? null : "size"))} aria-label={t("pres_fmt_size", "Tamaño")}>
              <Type size={15} strokeWidth={2.3} />
              <span>{t("pres_fmt_size", "Tamaño")}</span>
              <ChevronDown size={12} />
            </button>
            {menu === "size" && (
              <div className={styles.fmtMenu} onMouseDown={keep}>
                {FMT_SIZES.map(sz => (
                  <button key={sz.value} type="button" className={styles.fmtMenuItem} onMouseDown={keep}
                    onClick={() => exec("fontSize", sz.value)}>
                    <span className={slideStyles.rich}><font size={sz.value}>{t(sz.labelKey, sz.fallback)}</font></span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.fmtMenuWrap}>
            <button type="button" className={cx(styles.fmtBtn, menu === "color" && styles.fmtBtnOn)} onMouseDown={keep}
              onClick={() => setMenu(m => (m === "color" ? null : "color"))} title={t("pres_fmt_color", "Color del texto")}
              aria-label={t("pres_fmt_color", "Color del texto")}>
              <Baseline size={15} strokeWidth={2.3} />
            </button>
            {menu === "color" && (
              <div className={cx(styles.fmtMenu, styles.fmtSwatches)} onMouseDown={keep}>
                {FMT_TEXT_COLORS.map(c => (
                  <button key={c} type="button" className={styles.fmtSwatch} style={{ background: c }} onMouseDown={keep}
                    onClick={() => exec("foreColor", c)} aria-label={c} />
                ))}
              </div>
            )}
          </div>
          <div className={styles.fmtMenuWrap}>
            <button type="button" className={cx(styles.fmtBtn, menu === "mark" && styles.fmtBtnOn)} onMouseDown={keep}
              onClick={() => setMenu(m => (m === "mark" ? null : "mark"))} title={t("pres_fmt_mark", "Resaltado")}
              aria-label={t("pres_fmt_mark", "Resaltado")}>
              <Highlighter size={15} strokeWidth={2.3} />
            </button>
            {menu === "mark" && (
              <div className={cx(styles.fmtMenu, styles.fmtSwatches)} onMouseDown={keep}>
                {FMT_MARK_COLORS.map(c => (
                  <button key={c} type="button" className={cx(styles.fmtSwatch, c === "transparent" && styles.fmtSwatchNone)}
                    style={{ background: c }} onMouseDown={keep} onClick={() => exec("hiliteColor", c)} aria-label={c} />
                ))}
              </div>
            )}
          </div>
          <span className={styles.fmtSep} />

          <FmtBtn icon={AlignLeft} active={state.left} label={t("pres_fmt_left", "Alinear a la izquierda")} onClick={() => exec("justifyLeft")} />
          <FmtBtn icon={AlignCenter} active={state.center} label={t("pres_fmt_center", "Centrar")} onClick={() => exec("justifyCenter")} />
          <FmtBtn icon={AlignRight} active={state.right} label={t("pres_fmt_right", "Alinear a la derecha")} onClick={() => exec("justifyRight")} />
          <FmtBtn icon={AlignJustify} active={state.full} label={t("pres_fmt_justify", "Justificar")} onClick={() => exec("justifyFull")} />
          <span className={styles.fmtSep} />

          <FmtBtn icon={List} active={state.ul} label={t("pres_fmt_bullets", "Viñetas")} onClick={() => exec("insertUnorderedList")} />
          <FmtBtn icon={ListOrdered} active={state.ol} label={t("pres_fmt_numbers", "Lista numerada")} onClick={() => exec("insertOrderedList")} />
          <span className={styles.fmtSep} />

          <FmtBtn icon={RemoveFormatting} label={t("pres_fmt_clear", "Quitar formato")} onClick={() => exec("removeFormat")} />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Confirmación propia (en lugar de window.confirm).
   ══════════════════════════════════════════════════════════════════════ */
function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <ModalPortal onClose={onCancel}>
      <div className={cx(styles.dialog, styles.cfDialog)} role="alertdialog" aria-modal="true" aria-labelledby="pres-confirm-title"
        onMouseDown={e => e.stopPropagation()}>
        <div className={styles.cfBody}>
          <span className={styles.cfIcon}><AlertTriangle size={20} strokeWidth={2.2} /></span>
          <div>
            <h2 id="pres-confirm-title" className={styles.mTitle}>{title}</h2>
            <p className={styles.cfText}>{message}</p>
          </div>
        </div>
        <div className={styles.mFoot}>
          <button type="button" className={styles.btnGhost} onClick={onCancel}>{t("pres_cancel", "Cancelar")}</button>
          <button type="button" className={cx(styles.btnPrimary, styles.btnDanger)} onClick={onConfirm} autoFocus>
            <Trash2 size={14} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Nombre de la presentación editable en el propio título del header: clic
   para editar, Enter o salir para guardar, Escape para cancelar.
   ══════════════════════════════════════════════════════════════════════ */
function EditableTitle({ value, placeholder, onCommit, label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    setEditing(false);
  };
  if (!editing) {
    return (
      <button type="button" className={styles.titleBtn} title={label} aria-label={label}
        onClick={() => { setDraft(value); setEditing(true); }}>
        {value || placeholder}
      </button>
    );
  }
  return (
    <input
      className={styles.titleInput}
      value={draft}
      autoFocus
      aria-label={label}
      size={Math.max(8, draft.length + 1)}
      onFocus={e => e.currentTarget.select()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Editor: miniaturas | diapositiva | diseños. Pinta su propio PageHeader
   para que las acciones de diapositiva vivan en el header y tengan acceso
   a la selección. onChange(fn) recibe un actualizador puro.
   ══════════════════════════════════════════════════════════════════════ */
function Editor({ presentation, onChange, onBack, token, activeStandardKey, sources = [], structures = [], companies = [], dimensions = [], readOnly = false, saveState = "idle", onShare = null, onDuplicate = null, onExport = null }) {
  const t = useT();
  const { colors: appColors } = useSettings();
  const slides = presentation.slides;
  const themes = presentation.themes ?? {};
  const [selectedId, setSelectedId] = useState(slides[0]?.id ?? null);
  const [panelTab, setPanelTab] = useState("design");
  const [previewId, setPreviewId] = useState(null);
  const [previewLayoutId, setPreviewLayoutId] = useState(null);
  // "Guardado" aparece tras cada cambio y se oculta a los 2 segundos.
  const [savedVisible, setSavedVisible] = useState(false);
  const lastSavedAt = useRef(presentation.updatedAt);
  const savedTimer = useRef(null);
  useEffect(() => {
    if (presentation.updatedAt === lastSavedAt.current) return;
    lastSavedAt.current = presentation.updatedAt;
    queueMicrotask(() => setSavedVisible(true));
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedVisible(false), 2000);
  }, [presentation.updatedAt]);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const [kpiPicker, setKpiPicker] = useState(null); // { slotId }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [chartPicker, setChartPicker] = useState(null); // { slotId }
  const [accPicker, setAccPicker] = useState(null);     // { slotId, capacity, kind: "accounts" | "sheet" }
  const [fmtActive, setFmtActive] = useState(false);     // hay un texto en edición
  const fmtTimer = useRef(null);
  const [dragId, setDragId] = useState(null);         // diapositiva que se arrastra
  const [dropAt, setDropAt] = useState(null);         // { id, pos: "before" | "after" }
  const [reviewMode, setReviewMode] = useState(false);
  const [highlight, setHighlight] = useState(null); // { slideId, slotId }
  const highlightTimer = useRef(null);
  const thumbRefs = useRef({});

  // Periodo de los datos: guardado en la presentación; por defecto la
  // primera fuente/perímetro y el último periodo con datos conocido.
  const defaults = usePeriodDefaults(sources, structures, companies);
  const period = useMemo(() => ({ ...defaults, ...(presentation.data ?? {}) }), [defaults, presentation.data]);
  // Actualización masiva del periodo (ver BulkPeriodModal)
  const applyBulk = ({ values, slideIds, all, force, compares = {} }) => onChange(p => {
    const ids = new Set(slideIds);
    const nextSlides = (p.slides ?? []).map(sl => {
      if (!ids.has(sl.id)) return sl;
      const slots = {};
      Object.entries(sl.slots ?? {}).forEach(([k, c]) => {
        let next = updateSlotPeriod(c, values, { force, explicit: !all }).content;
        const cmp = compares[`${sl.id}:${k}`];
        if (cmp && next?.kind === "kpi") next = { ...next, compare: cmp };
        slots[k] = next;
      });
      return { ...sl, slots };
    });
    return { ...p, slides: nextSlides, data: all ? { ...period, ...(p.data ?? {}), ...values } : p.data };
  });

  // Empresas y grupos que usan las diapositivas: el hook carga solo esos.
  // Con comparativo se pide también el periodo con el que se compara.
  const wanted = useMemo(() => wantedForSlides(slides, period), [slides, period]);
  const data = usePresentationData({ token, standardKey: activeStandardKey, period, wanted });

  const found = slides.findIndex(s => s.id === selectedId);
  const selIndex = found >= 0 ? found : 0;
  const selected = slides[selIndex];

  useEffect(() => {
    thumbRefs.current[selected?.id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected?.id]);

  if (!selected) return null;

  const updateSlides = (fn) => onChange(p => ({ ...p, slides: fn(p.slides) }));
  const insertAfterSelected = (slide) => {
    updateSlides(list => {
      const i = list.findIndex(x => x.id === selected.id);
      return [...list.slice(0, i + 1), slide, ...list.slice(i + 1)];
    });
    setSelectedId(slide.id);
  };

  // Una diapositiva nueva hereda diseño y distribución; tras la portada se
  // propone una distribución de contenido.
  const addSlide = () => insertAfterSelected(makeSlide(selected.designId, {
    layoutId: selected.layoutId && selected.layoutId !== "cover" ? selected.layoutId : DEFAULT_CONTENT_LAYOUT_ID,
  }));
  // Duplicar o eliminar una diapositiva concreta (acciones del carril).
  const duplicateSlide = (id = selected.id) => {
    const src = slides.find(x => x.id === id);
    if (!src) return;
    const copy = makeSlide(src.designId, {
      layoutId: src.layoutId, title: src.title, subtitle: src.subtitle, slots: { ...(src.slots ?? {}) },
    });
    updateSlides(list => {
      const i = list.findIndex(x => x.id === id);
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
    setSelectedId(copy.id);
  };

  const deleteSlide = (id = selected.id) => {
    if (slides.length <= 1) return;
    const i = slides.findIndex(x => x.id === id);
    if (i < 0) return;
    if (id === selected.id) {
      const neighbour = slides[i + 1] ?? slides[i - 1];
      setSelectedId(neighbour?.id ?? null);
    }
    updateSlides(list => list.filter(x => x.id !== id));
  };

  const pickDesign = (designId) => {
    updateSlides(list => list.map(x => (x.id === selected.id ? { ...x, designId } : x)));
    setPreviewId(null);
  };

  const pickLayout = (layoutId) => {
    updateSlides(list => list.map(x => (x.id === selected.id ? { ...x, layoutId } : x)));
    setPreviewLayoutId(null);
  };

  // Colores del cliente por diseño; se aplican a todas las diapositivas de
  // esta presentación que usan ese diseño.
  const setColor = (designId, key, value) => onChange(p => ({
    ...p, themes: { ...(p.themes ?? {}), [designId]: { ...(p.themes?.[designId] ?? {}), [key]: value } },
  }));
  const resetColor = (designId, key) => onChange(p => {
    const next = { ...(p.themes?.[designId] ?? {}) };
    delete next[key];
    return { ...p, themes: { ...(p.themes ?? {}), [designId]: next } };
  });
  const resetDesignColors = (designId) => onChange(p => {
    const next = { ...(p.themes ?? {}) };
    delete next[designId];
    return { ...p, themes: next };
  });

  const switchTab = (tab) => { setPanelTab(tab); setPreviewId(null); setPreviewLayoutId(null); };

  const applyAll = () => updateSlides(list => list.map(x => ({ ...x, designId: selected.designId })));

  // Contenido de la diapositiva seleccionada (título, textos y KPIs).
  const updateSelected = (fn) => updateSlides(list => list.map(x => (x.id === selected.id ? fn(x) : x)));
  const setSlot = (slotId, content) => updateSelected(x => {
    const next = { ...(x.slots ?? {}) };
    if (content) next[slotId] = content; else delete next[slotId];
    return { ...x, slots: next };
  });
  const edit = {
    onTitle:    (v) => updateSelected(x => ({ ...x, title: v })),
    onSubtitle: (v) => updateSelected(x => ({ ...x, subtitle: v })),
    onText:     (slotId, v) => setSlot(slotId, htmlToText(v).trim() ? { kind: "text", text: v } : null),
    onPickKpi:  (slotId) => setKpiPicker({ slotId }),
    onPickChart: (slotId) => setChartPicker({ slotId }),
    onPickAccounts: (slotId, capacity, kind) => setAccPicker({ slotId, capacity, kind: kind ?? (["sheet", "contrib"].includes(selected.slots?.[slotId]?.kind) ? selected.slots[slotId].kind : "accounts") }),
    // Mostrar/ocultar la barra de formato; el retardo evita parpadeos al
    // saltar de un texto a otro.
    onFormatFocus: (on) => {
      clearTimeout(fmtTimer.current);
      if (on) setFmtActive(true);
      else fmtTimer.current = setTimeout(() => setFmtActive(false), 180);
    },
  };

  // Guardar una gráfica; con "toda la diapositiva" la diapositiva pasa a la
  // distribución de gráfica única y la gráfica ocupa su espacio.
  const saveChart = (slotId, content, full) => {
    if (full && selected.layoutId !== "chart") {
      updateSelected(x => ({ ...x, layoutId: "chart", slots: { ...(x.slots ?? {}), chart1: content } }));
    } else {
      setSlot(slotId, content);
    }
    setChartPicker(null);
  };

  // Variables de toda la presentación, en el orden de las diapositivas y de
  // los espacios de cada distribución.
  const variables = [];
  slides.forEach((sl, slideIndex) => {
    getLayout(sl.layoutId).slots.forEach(slot => {
      const c = sl.slots?.[slot.id];
      if (!c || (c.kind === "kpi" && !c.kpiId) || (c.kind === "text" && !htmlToText(c.text).trim())) return;
      variables.push({ key: `${sl.id}:${slot.id}`, slideId: sl.id, slideIndex, slideTitle: htmlToText(sl.title), slotId: slot.id, content: c });
    });
  });

  // Revisión: se guarda en la presentación con una "firma" del contenido; si
  // la variable cambia después de marcarla, la marca deja de valer.
  const signature = (c) => JSON.stringify(c.kind === "chart" || c.kind === "accounts" || c.kind === "sheet" || c.kind === "contrib"
    ? c
    : [c.kind, c.kpiId, c.scope, c.entity, c.filters, c.compare, c.text, c.display]);
  const review = presentation.review ?? {};
  const isChecked = (it) => review[it.key] === signature(it.content);
  const toggleCheck = (it) => onChange(p => {
    const next = { ...(p.review ?? {}) };
    if (next[it.key] === signature(it.content)) delete next[it.key];
    else next[it.key] = signature(it.content);
    return { ...p, review: next };
  });
  const resetChecks = () => onChange(p => ({ ...p, review: {} }));

  // Ir a una variable: selecciona su diapositiva y la resalta unos segundos.
  const goToVariable = (it) => {
    setSelectedId(it.slideId);
    setHighlight({ slideId: it.slideId, slotId: it.slotId });
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 2600);
  };

  // KPIs que no siguen los filtros generales, en toda la presentación.
  const fixedSlides = slides
    .map((sl, i) => ({ i, n: Object.values(sl.slots ?? {}).filter(c => slotFixedFields(c).length).length }))
    .filter(x => x.n > 0);
  const fixedCount = fixedSlides.reduce((sum, x) => sum + x.n, 0);
  const goToNextFixed = () => {
    const next = fixedSlides.find(x => x.i > selIndex) ?? fixedSlides[0];
    if (next) setSelectedId(slides[next.i].id);
  };


  // Reordenar: mueve una diapositiva antes o después de otra.
  const moveSlide = (fromId, toId, pos) => {
    if (!fromId || fromId === toId) return;
    updateSlides(list => {
      const from = list.find(x => x.id === fromId);
      if (!from) return list;
      const rest = list.filter(x => x.id !== fromId);
      let idx = rest.findIndex(x => x.id === toId);
      if (idx < 0) return list;
      if (pos === "after") idx += 1;
      return [...rest.slice(0, idx), from, ...rest.slice(idx)];
    });
  };
  const endDrag = () => { setDragId(null); setDropAt(null); };

  const onRailKey = (e) => {
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // Alt + flechas: mover la diapositiva seleccionada.
      e.preventDefault();
      const target = slides[selIndex + (e.key === "ArrowDown" ? 1 : -1)];
      if (target) moveSlide(selected.id, target.id, e.key === "ArrowDown" ? "after" : "before");
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(selIndex + 1, slides.length - 1) : Math.max(selIndex - 1, 0);
      setSelectedId(slides[next].id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSlide();
    }
  };

  const stageDesign = getDesign(previewId ?? selected.designId);
  const stageLayout = getLayout(previewLayoutId ?? selected.layoutId);
  const canApplyAll = slides.length > 1 && !slides.every(x => x.designId === selected.designId);

  return (
    <>
      <PageHeader
        kicker={t("presentations_title", "Presentaciones")}
        title={
          <EditableTitle
            value={presentation.name}
            placeholder={t("pres_untitled", "Presentación sin título")}
            label={t("pres_rename", "Cambiar nombre")}
            onCommit={name => onChange(p => ({ ...p, name }))}
          />
        }
        onBack={onBack}
        headerExtra={
          <div className={styles.hdrGroup}>
            {readOnly ? (
              <span className={cx(styles.visBadge, styles.vis_readonly, styles.hdrReadonly)} title={t("pres_readonly_hint", "No tienes permiso para editarla. Duplícala para tener tu propia copia.")}>
                <Eye size={12} strokeWidth={2.4} />{t("pres_readonly_short", "Solo lectura")}
              </span>
            ) : saveState === "error" || saveState === "conflict" ? (
              <span className={cx(styles.saved, styles.savedOn, styles.savedError)} aria-live="polite">
                <AlertTriangle size={13} strokeWidth={2.6} />{saveState === "conflict" ? t("pres_conflict_short", "Guardado como copia") : t("pres_save_retrying", "Sin conexión · reintentando")}
              </span>
            ) : (
              <span className={cx(styles.saved, (savedVisible || saveState === "saving") && styles.savedOn)} aria-live="polite">
                {saveState === "saving" ? <Loader2 size={13} className={styles.spin} /> : <Check size={13} strokeWidth={2.6} />}
                {saveState === "saving" ? t("pres_saving", "Guardando…") : t("pres_saved", "Guardado")}
              </span>
            )}

            {fixedCount > 0 && (
              <button type="button" className={cx(styles.hdrBtn, styles.hdrPill, styles.hdrFixed)} onClick={goToNextFixed}
                title={`${fixedCount === 1
                  ? t("pres_fixed_count_one", "1 KPI con filtros propios")
                  : fill(t("pres_fixed_count_other", "{n} KPIs con filtros propios"), { n: fixedCount })}. ${t("pres_fixed_chip_tip", "Estos KPIs no cambian con los filtros generales. Haz clic para ir al siguiente.")}`}>
                <Pin size={13} strokeWidth={2.4} />
                <span className={styles.hdrNum}>{fixedCount}</span>
              </button>
            )}
            <button type="button" className={cx(styles.hdrBtn, styles.hdrPill, styles.hdrExpand, panelTab === "variables" && styles.hdrBtnOn)}
              onClick={() => switchTab(panelTab === "variables" ? "design" : "variables")}
              aria-label={t("pres_variables", "Variables")}>
              <ListChecks size={14} />
              <span className={styles.hdrLabel}>{t("pres_variables", "Variables")}</span>
              {variables.length > 0 && <span className={styles.hdrNum}>{variables.length}</span>}
            </button>
            <ActionMenu
              label={t("pres_actions", "Acciones")}
              items={[
                !readOnly && { id: "slide", icon: Plus, label: t("pres_add_slide", "Nueva diapositiva"), hint: t("pres_add_slide_hint", "Después de la seleccionada"), onClick: addSlide, accent: true },
                !readOnly && { id: "bulk", icon: RefreshCw, label: t("pres_bulk_title", "Actualizar periodo y filtros"), hint: t("pres_bulk_menu_hint", "Año, mes, YTD/mensual, fuente y perímetro de todos los bloques"), onClick: () => setBulkOpen(true) },
                "sep",
                onExport && { id: "pptx", icon: Download, label: t("pres_pptx_title", "Exportar a PowerPoint"), hint: t("pres_pptx_menu_hint", "Descarga un .pptx con todas las diapositivas"), onClick: onExport },
                onShare && { id: "share", icon: Share2, label: t("pres_share", "Compartir"), hint: t("pres_share_menu_hint", "Solo yo, toda la empresa o personas concretas"), onClick: onShare },
                readOnly && onDuplicate && { id: "dup", icon: Copy, label: t("pres_dup_to_edit", "Duplicar para editar"), onClick: onDuplicate },
              ]}
            />
          </div>
        }
      />

    {bulkOpen && (
      <BulkPeriodModal presentation={presentation} period={period} sources={sources} structures={structures}
        labelOf={(c) => data.resolveKpi?.(c, slotPeriod(period, c))?.kpi?.label ?? c.label ?? c.kpiId}
        entityName={(e) => companyName(companies, e) || e}
        onApply={applyBulk} onClose={() => setBulkOpen(false)} />
    )}
    <SlideDataContext.Provider value={{ ...data, period, companies }}>
    <div className={cx(styles.editor, fmtActive && styles.editorFmt)}>
      <FormatBar visible={fmtActive} />
      <div className={styles.edBody}>
        {/* Carril de miniaturas */}
        <nav className={styles.rail} tabIndex={0} onKeyDown={onRailKey} aria-label={t("presentations_title", "Presentaciones")}>
          {slides.map((s, i) => (
            <div
              key={s.id}
              ref={el => { thumbRefs.current[s.id] = el; }}
              role="button"
              tabIndex={-1}
              draggable
              className={cx(
                styles.railRow, s.id === selected.id && styles.railActive,
                dragId === s.id && styles.railDragging,
                dropAt?.id === s.id && dragId !== s.id && (dropAt.pos === "before" ? styles.dropBefore : styles.dropAfter),
              )}
              onClick={() => setSelectedId(s.id)}
              onDragStart={e => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", s.id);
                setDragId(s.id);
              }}
              onDragOver={e => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = e.currentTarget.getBoundingClientRect();
                const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
                if (dropAt?.id !== s.id || dropAt?.pos !== pos) setDropAt({ id: s.id, pos });
              }}
              onDrop={e => {
                e.preventDefault();
                if (dragId && dropAt) moveSlide(dragId, dropAt.id, dropAt.pos);
                endDrag();
              }}
              onDragEnd={endDrag}
              aria-label={fill(t("pres_slide_n", "Diapositiva {n}"), { n: i + 1 })}
            >
              <span className={styles.railNum}>{i + 1}</span>
              <span className={styles.railBox}>
                <SlideCanvas designId={s.designId} layoutId={s.layoutId} themes={themes} title={s.title} subtitle={s.subtitle} slots={s.slots} />
                <span className={styles.railActions}>
                  <button type="button" className={styles.railAct} title={t("pres_duplicate", "Duplicar")}
                    aria-label={t("pres_duplicate", "Duplicar")}
                    onClick={e => { e.stopPropagation(); duplicateSlide(s.id); }}>
                    <Copy size={12} />
                  </button>
                  {slides.length > 1 && (
                    <button type="button" className={cx(styles.railAct, styles.railActDanger)} title={t("pres_delete", "Eliminar")}
                      aria-label={t("pres_delete", "Eliminar")}
                      onClick={e => { e.stopPropagation(); deleteSlide(s.id); }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              </span>
            </div>
          ))}
          <button type="button" tabIndex={-1} className={styles.railAdd} onClick={addSlide}>
            <Plus size={16} />
          </button>
        </nav>

        {/* Escenario */}
        <section className={styles.stage}>
          <div className={styles.stageInner}>
            <SlideCanvas className={styles.stageSlide} designId={stageDesign.id} layoutId={stageLayout.id} themes={themes}
              title={selected.title} subtitle={selected.subtitle} slots={selected.slots} number={selIndex + 1} edit={edit}
              highlight={highlight?.slideId === selected.id ? highlight.slotId : null} />
            <p className={styles.caption}>
              {fill(t("pres_slide_n", "Diapositiva {n}"), { n: `${selIndex + 1} / ${slides.length}` })}
              <span className={styles.dotSep} aria-hidden="true" />
              <span className={previewId ? styles.captionPreview : undefined}>{t(stageDesign.nameKey, stageDesign.fallback)}</span>
              <span className={styles.dotSep} aria-hidden="true" />
              <span className={previewLayoutId ? styles.captionPreview : undefined}>{t(stageLayout.nameKey, stageLayout.fallback)}</span>
            </p>
          </div>
        </section>

        {/* Panel derecho: diseño y distribución. Hover = vista previa, clic = aplicar */}
        <aside className={styles.dp}>
          {panelTab === "variables" && (
            <VariablesPanel companies={companies}
              items={variables}
              data={data}
              period={period}
              reviewMode={reviewMode}
              onReviewMode={setReviewMode}
              isChecked={isChecked}
              onToggle={toggleCheck}
              onReset={resetChecks}
              onGo={goToVariable}
              onClose={() => switchTab("design")}
            />
          )}
          {panelTab !== "variables" && (
          <div className={styles.dpHead}>
            <div className={styles.tabs} role="tablist">
              {[
                ["design", t("pres_tab_design", "Diseño")],
                ["layout", t("pres_tab_layout", "Distribución")],
                ["colors", t("pres_tab_colors", "Colores")],
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={panelTab === id}
                  className={cx(styles.tab, panelTab === id && styles.tabActive)} onClick={() => switchTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <p className={styles.dpHint}>
              {panelTab === "design" && t("pres_designs_hint", "Pasa el ratón para previsualizar y haz clic para aplicarlo a la diapositiva seleccionada.")}
              {panelTab === "layout" && t("pres_layouts_hint", "Elige cómo se reparte la diapositiva entre el título y los espacios para texto, KPIs, gráficos o cuentas.")}
              {panelTab === "colors" && fill(
                t("pres_colors_hint", "Colores del diseño {design}. Se aplican a todas las diapositivas de esta presentación que lo usan."),
                { design: t(getDesign(selected.designId).nameKey, getDesign(selected.designId).fallback) },
              )}
            </p>
          </div>
          )}

          {panelTab === "colors" && (() => {
            const design = getDesign(selected.designId);
            const overrides = themes[design.id] ?? {};
            const palette = resolveColors(design, overrides, appColors?.primary);
            return (
              <div className={styles.colorList}>
                {Object.keys(design.colors).map(key => (
                  <ColorRow
                    key={key}
                    label={t(COLOR_LABELS[key].labelKey, COLOR_LABELS[key].fallback)}
                    value={palette[key]}
                    custom={!!overrides[key]}
                    resetLabel={t("pres_color_reset_one", "Volver al color original")}
                    onChange={v => setColor(design.id, key, v)}
                    onReset={() => resetColor(design.id, key)}
                  />
                ))}
              </div>
            );
          })()}

          {panelTab === "design" && (
            <div className={styles.dpList} onMouseLeave={() => setPreviewId(null)}>
              {DESIGNS.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={cx(styles.pick, d.id === selected.designId && styles.pickActive)}
                  onClick={() => pickDesign(d.id)}
                  onMouseEnter={() => setPreviewId(d.id)}
                  onFocus={() => setPreviewId(d.id)}
                  onBlur={() => setPreviewId(null)}
                >
                  <span className={styles.pickBox}>
                    <SlideCanvas designId={d.id} layoutId={selected.layoutId} themes={themes} title={selected.title} subtitle={selected.subtitle} slots={selected.slots} />
                  </span>
                  <span className={styles.pickName}>
                    {d.id === selected.designId && <Check size={12} strokeWidth={3} />}
                    {t(d.nameKey, d.fallback)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {panelTab === "layout" && (
            <div className={styles.dpList} onMouseLeave={() => setPreviewLayoutId(null)}>
              {LAYOUT_GROUPS.flatMap(g => [
                <p key={`g-${g.id}`} className={styles.dpGroup}>{t(g.labelKey, g.fallback)}</p>,
                ...LAYOUTS.filter(l => l.group === g.id).map(l => (
                <button
                  key={l.id}
                  type="button"
                  className={cx(styles.pick, l.id === getLayout(selected.layoutId).id && styles.pickActive)}
                  onClick={() => pickLayout(l.id)}
                  onMouseEnter={() => setPreviewLayoutId(l.id)}
                  onFocus={() => setPreviewLayoutId(l.id)}
                  onBlur={() => setPreviewLayoutId(null)}
                >
                  <span className={styles.pickBox}>
                    <SlideCanvas designId={selected.designId} layoutId={l.id} themes={themes} title={selected.title} subtitle={selected.subtitle} slots={selected.slots} />
                  </span>
                  <span className={styles.pickName}>
                    {l.id === getLayout(selected.layoutId).id && <Check size={12} strokeWidth={3} />}
                    {t(l.nameKey, l.fallback)}
                  </span>
                </button>
                )),
              ])}
            </div>
          )}

          {panelTab === "colors" && (
            <div className={styles.dpFoot}>
              <button type="button" className={styles.applyAll}
                onClick={() => resetDesignColors(selected.designId)}
                disabled={!Object.keys(themes[selected.designId] ?? {}).length}>
                <RotateCcw size={14} />
                {t("pres_colors_reset", "Restablecer colores")}
              </button>
            </div>
          )}

          {panelTab === "design" && (
            <div className={styles.dpFoot}>
              <button type="button" className={styles.applyAll} onClick={applyAll} disabled={!canApplyAll}>
                <Layers size={14} />
                {t("pres_apply_all", "Aplicar a todas las diapositivas")}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>

    {(accPicker?.kind === "sheet" || accPicker?.kind === "contrib") && (
      <SheetPickerModal
        key={accPicker.kind}
        variant={accPicker.kind}
        data={data}
        companies={companies}
        sources={sources}
        structures={structures}
        period={period}
        capacity={accPicker.capacity}
        initial={selected.slots?.[accPicker.slotId]?.kind === accPicker.kind ? selected.slots[accPicker.slotId] : null}
        onSave={content => { setSlot(accPicker.slotId, content); setAccPicker(null); }}
        onRemove={() => { setSlot(accPicker.slotId, null); setAccPicker(null); }}
        onClose={() => setAccPicker(null)}
        onSwitchKind={(k) => setAccPicker(p => ({ ...p, kind: k, switchedFrom: p.kind }))}
        switchedFrom={accPicker.switchedFrom ?? null}
      />
    )}

    {accPicker && accPicker.kind === "accounts" && (
      <AccountsPickerModal
        data={data}
        companies={companies}
        sources={sources}
        structures={structures}
        dimensions={dimensions}
        period={period}
        capacity={accPicker.capacity}
        initial={selected.slots?.[accPicker.slotId]?.kind === "accounts" ? selected.slots[accPicker.slotId] : null}
        onSave={content => { setSlot(accPicker.slotId, content); setAccPicker(null); }}
        onRemove={() => { setSlot(accPicker.slotId, null); setAccPicker(null); }}
        onClose={() => setAccPicker(null)}
        onSwitchKind={(k) => setAccPicker(p => ({ ...p, kind: k, switchedFrom: p.kind }))}
        switchedFrom={accPicker.switchedFrom ?? null}
      />
    )}

    {chartPicker && (
      <ChartPickerModal
        data={data}
        companies={companies}
        sources={sources}
        structures={structures}
        dimensions={dimensions}
        period={period}
        designId={selected.designId}
        themes={themes}
        fullSlide={selected.layoutId === "chart"}
        initial={selected.slots?.[chartPicker.slotId]?.kind === "chart" ? selected.slots[chartPicker.slotId] : null}
        onSave={(content, full) => saveChart(chartPicker.slotId, content, full)}
        onRemove={() => { setSlot(chartPicker.slotId, null); setChartPicker(null); }}
        onClose={() => setChartPicker(null)}
      />
    )}
    </SlideDataContext.Provider>

    {kpiPicker && (
      <KpiPickerModal
        data={data}
        companies={companies}
        sources={sources}
        structures={structures}
        dimensions={dimensions}
        period={period}
        initial={selected.slots?.[kpiPicker.slotId]?.kind === "kpi" ? selected.slots[kpiPicker.slotId] : null}
        onPick={content => { setSlot(kpiPicker.slotId, content); setKpiPicker(null); }}
        onRemove={() => { setSlot(kpiPicker.slotId, null); setKpiPicker(null); }}
        onClose={() => setKpiPicker(null)}
      />
    )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Historial del navegador: abrir el editor o el modal añade una entrada, así
   el botón "atrás" vuelve a la librería en vez de salir de la app. Se
   conserva el estado que ya tuviera la entrada (el del router).
   ══════════════════════════════════════════════════════════════════════ */
const pushEntry = (patch) => window.history.pushState({ ...(window.history.state ?? {}), ...patch }, "");
const replaceEntry = (patch) => window.history.replaceState({ ...(window.history.state ?? {}), ...patch }, "");

/* ══════════════════════════════════════════════════════════════════════
   Página. Recibe desde routes.jsx token, sources, structures, companies y
   dimensions para cuando las diapositivas lean datos del reporting.
   ══════════════════════════════════════════════════════════════════════ */
export default function PresentationsPage({ token, activeStandardKey = null, sources = [], structures = [], companies = [], dimensions = [], docType: docTypeProp = null, initialDocTab = "deck" }) {
  const { colors } = useSettings();
  const t = useT();
  const { companyId } = useSettingsControls();
  const [me, setMe] = useState(null);
  const [meChecked, setMeChecked] = useState(false);
  const store = usePresentationsStore({ companyId, me, meChecked });
  const { presentations, create, update, remove, duplicate, share, companyUsers, saveState, loading: libLoading, error: libError, notice: saveNotice, clearNotice } = store;
  const [sharing, setSharing] = useState(null); // id de la presentación que se comparte
  // deck (PowerPoint) | memory (notas de la memoria). Lo decide el menú lateral
  // (dos entradas); sin docType, la página muestra sus propias pestañas.
  const [docTabState, setDocTab] = useState(initialDocTab === "memory" ? "memory" : "deck");
  const docTab = docTypeProp ?? docTabState;
  const [memWizard, setMemWizard] = useState(false);
  const [exporting, setExporting] = useState(null); // id de la presentación que se exporta
  const [scope, setScope] = useState("");
  // Si se recarga estando en el editor, la entrada del historial lo recuerda.
  // Al entrar desde el menú lateral (docType fijado) siempre se empieza en la
  // librería, no en el último documento abierto.
  const [editingId, setEditingId] = useState(() => (docTypeProp ? null : window.history.state?.presEditor ?? null));
  // Volver a pulsar la entrada del menú estando dentro de un documento → librería
  useEffect(() => {
    const onNav = (e) => {
      const key = e.detail;
      const mine = (key === "presentations" && docTypeProp !== "memory") || (key === "presentations-memory" && docTypeProp === "memory");
      if (!mine) return;
      setEditingId(null);
      try { window.history.replaceState({ ...(window.history.state ?? {}), presEditor: null, presModal: false }, ""); } catch { /* sin historial */ }
    };
    window.addEventListener("konsolidator:nav", onNav);
    return () => window.removeEventListener("konsolidator:nav", onNav);
  }, [docTypeProp]);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [created, setCreated] = useState({ value: "" });
  const [creator, setCreator] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // id

  // Usuario actual, para guardar quién crea cada presentación.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user;
      if (u) setMe({ id: u.id, name: u.user_metadata?.full_name || u.user_metadata?.name || u.email || "" });
      setMeChecked(true);
    }).catch(() => setMeChecked(true));
  }, []);

  // Personas que han creado presentaciones (para el filtro).
  const creators = useMemo(() => {
    const byId = new Map();
    let unknown = false;
    presentations.forEach(p => {
      if (p.createdBy?.id) byId.set(p.createdBy.id, p.createdBy.name || p.createdBy.id);
      else unknown = true;
    });
    return { list: [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), unknown };
  }, [presentations]);

  const editing = useMemo(() => presentations.find(p => p.id === editingId) ?? null, [presentations, editingId]);

  // Historial: ver pushEntry/replaceEntry más arriba.
  useEffect(() => {
    // Un modal no se reabre al recargar: se limpia la marca si quedó puesta.
    if (window.history.state?.presModal) replaceEntry({ presModal: false });
    const onPop = (e) => {
      const st = e.state ?? {};
      setEditingId(st.presEditor ?? null);
      setModalOpen(!!st.presModal);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openEditor = (id) => {
    pushEntry({ presEditor: id, presModal: false });
    setEditingId(id);
  };

  const closeEditor = () => {
    if (window.history.state?.presEditor) window.history.back();
    else setEditingId(null);
  };

  const openModal = useCallback(() => {
    pushEntry({ presModal: true, presEditor: null });
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (window.history.state?.presModal) window.history.back();
    else setModalOpen(false);
  }, []);

  const handleCreate = (name, designId) => {
    const title = name.trim() || t("pres_untitled", "Presentación sin título");
    const id = create({ name: title, slides: [makeSlide(designId, { title })] });
    // La entrada del modal pasa a ser la del editor: "atrás" vuelve a la librería.
    replaceEntry({ presModal: false, presEditor: id });
    setModalOpen(false);
    setEditingId(id);
  };

  const handleDelete = (id) => setConfirmDelete(id);

  return (
    <div className={styles.page} style={{ "--k-primary": colors.primary }}>
      {/* Aviso tras un guardado que no se pudo hacer encima (otra persona guardó
          a la vez, sin permiso o borrada): los cambios están en una copia */}
      {saveNotice && (
        <div className={styles.saveNotice} role="alert">
          <AlertTriangle size={16} strokeWidth={2.4} />
          <span>
            {(saveNotice.kind === "conflict" ? t("pres_conflict_msg", "Otra persona (u otra pestaña) ha guardado «{name}» a la vez. Se muestra su versión y tus cambios están en la copia «{copy}».")
              : saveNotice.kind === "denied" ? t("pres_denied_msg", "No tienes permiso para guardar cambios en «{name}». Tus cambios están en la copia «{copy}».")
              : t("pres_gone_msg", "«{name}» ya no existe. Tus cambios están en la copia «{copy}»."))
              .replace("{name}", saveNotice.name || "—").replace("{copy}", saveNotice.copyName || "—")}
            {!saveNotice.copyName && <em> {t("pres_copy_failed", "No se ha podido guardar la copia; no cierres la página y vuelve a intentarlo.")}</em>}
          </span>
          <button type="button" onClick={clearNotice}>{t("pres_notice_ok", "Entendido")}</button>
        </div>
      )}
      {editing && editing.docType === "memory" ? (
        <MemoryEditor
          key={editing.id}
          presentation={editing}
          onChange={fn => update(editing.id, fn)}
          readOnly={!editing.canEdit}
          saveState={saveState}
          onShare={editing.isOwner ? () => setSharing(editing.id) : null}
          onDuplicate={() => { const id = duplicate(editing.id, t("pres_copy_suffix", "(copia)")); if (id) { replaceEntry({ presEditor: id, presModal: false }); setEditingId(id); } }}
          onBack={closeEditor}
          token={token}
          activeStandardKey={activeStandardKey}
          sources={sources}
          structures={structures}
          companies={companies}
          colors={colors}
        />
      ) : editing ? (
        <Editor
          key={editing.id}
          presentation={editing}
          onChange={fn => update(editing.id, fn)}
          readOnly={!editing.canEdit}
          saveState={saveState}
          onShare={editing.isOwner ? () => setSharing(editing.id) : null}
          onExport={() => setExporting(editing.id)}
          onDuplicate={() => { const id = duplicate(editing.id, t("pres_copy_suffix", "(copia)")); if (id) { replaceEntry({ presEditor: id, presModal: false }); setEditingId(id); } }}
          onBack={closeEditor}
          token={token}
          activeStandardKey={activeStandardKey}
          sources={sources}
          structures={structures}
          companies={companies}
          dimensions={dimensions}
        />
      ) : (
        <>
          <PageHeader
            title={docTab === "memory" ? t("nav_memory_notes", "Notas de la memoria") : t("presentations_title", "Presentaciones")}
            headerSearch={{ value: search, onChange: setSearch, placeholder: t("pres_search", "Buscar presentaciones") }}
            showAllFilters
            filters={[
              { label: t("pres_filter_created", "Creada"), value: created.value, onChange: v => setCreated(createdRange(v)),
                options: [
                  { value: "", label: t("pres_any_date", "Cualquier fecha") },
                  { value: "7d", label: t("pres_last_7d", "Últimos 7 días") },
                  { value: "30d", label: t("pres_last_30d", "Últimos 30 días") },
                  { value: "90d", label: t("pres_last_90d", "Últimos 90 días") },
                  { value: "year", label: t("pres_this_year", "Este año") },
                  { value: "lastyear", label: t("pres_last_year", "Año anterior") },
                ] },
              { label: t("pres_filter_scope", "Visibilidad"), value: scope, onChange: setScope,
                options: [
                  { value: "", label: t("pres_scope_all", "Todas") },
                  { value: "mine", label: t("pres_scope_mine", "Mías") },
                  { value: "shared", label: t("pres_scope_shared", "Compartidas conmigo") },
                  { value: "company", label: t("pres_scope_company", "De toda la empresa") },
                ] },
              { label: t("pres_filter_creator", "Creada por"), value: creator, onChange: setCreator,
                options: [
                  { value: "", label: t("pres_anyone", "Cualquier persona") },
                  ...creators.list,
                  ...(creators.unknown ? [{ value: "__none__", label: t("pres_no_author", "Sin autor") }] : []),
                ] },
            ]}
            headerExtra={
              <div className={styles.docTabsWrap}>
                {!docTypeProp && <div className={styles.docTabs} role="tablist">
                  <span className={styles.docTabPill} style={{ transform: `translateX(${docTab === "deck" ? 0 : 100}%)` }} aria-hidden="true" />
                  <button type="button" role="tab" aria-selected={docTab === "deck"} className={cx(docTab === "deck" && styles.docTabOn)} onClick={() => setDocTab("deck")}>
                    <Presentation size={14} />{t("mem_tab_decks", "PowerPoint")}
                  </button>
                  <button type="button" role="tab" aria-selected={docTab === "memory"} className={cx(docTab === "memory" && styles.docTabOn)} onClick={() => setDocTab("memory")}>
                    <FileText size={14} />{t("mem_tab_memories", "Memorias")}
                  </button>
                </div>}
                {docTab === "memory" && <GuideButton label={false} />}
                <button type="button" className={styles.newBtn} onClick={docTab === "memory" ? () => setMemWizard(true) : openModal}>
                  <Plus size={15} strokeWidth={2.4} />
                  {docTab === "memory" ? t("mem_new", "Nueva memoria") : t("pres_new", "Nueva presentación")}
                </button>
              </div>
            }
          />
          {libError && (
            <div className={styles.libError} role="alert">
              <AlertTriangle size={14} />
              <span>{t("pres_store_error", "No se ha podido sincronizar con el servidor.")} <em>{libError}</em></span>
              <button type="button" onClick={() => { store.clearError(); store.reload(); }}>{t("btn_retry", "Reintentar")}</button>
            </div>
          )}
          {libLoading && !presentations.length ? (
            <div className={styles.libLoading}><Loader2 size={22} className={styles.spin} />{t("pres_loading_library", "Cargando presentaciones…")}</div>
          ) : (
            <Library
              docType={docTab}
              presentations={presentations.filter(p => (p.docType ?? "deck") === docTab)}
              search={search}
              created={created}
              creator={creator}
              scope={scope}
              onOpen={openEditor}
              onCreate={docTab === "memory" ? () => setMemWizard(true) : openModal}
              onDuplicate={id => duplicate(id, t("pres_copy_suffix", "(copia)"))}
              onDelete={handleDelete}
              onShare={setSharing}
              onExport={setExporting}
            />
          )}
        </>
      )}

      {modalOpen && <NewPresentationModal onClose={closeModal} onCreate={handleCreate} />}
      {memWizard && (
        <NewMemoryWizard companies={companies} sources={sources} structures={structures}
          onClose={() => setMemWizard(false)}
          onCreate={({ name, memory }) => {
            const id = create({ name, docType: "memory", memory });
            setMemWizard(false);
            // Entrada nueva en el historial: "atrás" vuelve a la librería de memorias.
            pushEntry({ presModal: false, presEditor: id });
            setEditingId(id);
          }} />
      )}
      {exporting && presentations.find(p => p.id === exporting) && (
        <PptxExporter
          presentation={presentations.find(p => p.id === exporting)}
          token={token}
          activeStandardKey={activeStandardKey}
          sources={sources}
          structures={structures}
          companies={companies}
          onDone={() => setExporting(null)}
        />
      )}
      {sharing && presentations.find(p => p.id === sharing) && (
        <ShareDialog
          presentation={presentations.find(p => p.id === sharing)}
          me={me}
          loadUsers={companyUsers}
          onSave={(v) => share(sharing, v)}
          onClose={() => setSharing(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t("pres_delete_title", "¿Eliminar la presentación?")}
          message={fill(t("pres_delete_confirm_named", "«{name}» se eliminará con todas sus diapositivas. No se puede deshacer."),
            { name: presentations.find(p => p.id === confirmDelete)?.name ?? "" })}
          confirmLabel={t("pres_delete", "Eliminar")}
          onConfirm={() => { remove(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
