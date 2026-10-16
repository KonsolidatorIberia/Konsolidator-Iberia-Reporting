/* ══════════════════════════════════════════════════════════════════════
   Editor de una memoria (notas de las cuentas anuales).

   · Índice de notas a la izquierda (estado: con tabla, solo texto,
     revisada, oculta) y "Añadir nota".
   · En el centro, la nota elegida como una hoja: título, texto con
     variables ({{n5.total.closing}}, {{entidad}}…) que se ven ya con su
     valor, y la tabla calculada desde el estándar y los datos.
   · Todo editable: importes (quedan marcados y se pueden devolver al
     cálculo), filas añadidas u ocultas, signo, nota revisada u oculta.
   · Cuadros de movimientos (altas y bajas) con cuadre y ejercicio anterior.
   · Cualquier celda se puede seleccionar: insertarla en el texto como
     variable o ver de dónde sale (cuentas, periodo, fórmula).
   · Exportación a Word, PDF y Excel con todas las notas visibles.
   Datos: el mismo motor que las presentaciones (presentationData.js).
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowRight, Plus, Eye, EyeOff, Check, Table2, AlignLeft, RotateCcw, Trash2, Braces,
  Share2, Copy, CalendarRange, ChevronDown, Loader2, AlertTriangle, PlusCircle, ArrowUpDown,
  PanelLeftClose, PanelLeftOpen, LayoutGrid, Columns3, Database, Search, X, ListChecks, Crosshair,
  Bold, Italic, Underline, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, RemoveFormatting,
  Link2, Unlink, Sparkles, TrendingUp, Info, ChevronRight, FileText, Landmark, Waves, Pencil, GitBranch, CircleCheck, CircleAlert, MousePointerClick, Scale,
} from "lucide-react";
import { usePresentationData } from "../presentations/presentationData.js";
import {
  buildNoteTable, noteVariables, materialize, applyTemplate, TABLE_LIBRARY, COLUMN_SOURCES,
  explainCell, SOURCE_LABELS, LAYERS,
} from "./memoryEngine.js";
import styles from "./MemoryEditor.module.css";
import { GuideButton } from "./MemoryGuide.jsx";
import { useLocale, useT } from "../../components/layout/SettingsContext.jsx";
import { L, setMemoryT } from "./memoryI18n.js";

const cx = (...c) => c.filter(Boolean).join(" ");
const fmt = (v) => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  const s = Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
};
const parseNum = (s) => {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-") || t.startsWith("−");
  const n = Number(t.replace(/[()−-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const uid = () => Math.random().toString(36).slice(2, 10);

// Bloques de una tabla para exportar: los cuadros de movimientos salen como dos
// tablas (ejercicio actual y anterior) sin la columna de cuadre y sin las
// columnas opcionales vacías (traspasos, perímetro, diferencias de conversión).
const exportBlocks = (t) => {
  if (t.mode !== "movement") return [{ title: null, columns: t.columns, rows: t.rows, total: t.total }];
  return [["cur", t.rows], ["prev", t.prevRows ?? []]].filter(([, rows]) => rows.some(r => !r.heading)).map(([yr, rows]) => ({
    title: L("me_year_n", "Ejercicio {y}", { y: t.years?.[yr] ?? "" }),
    columns: t.columns.filter(c => !c.control && (!c.optional || rows.some(r => !r.heading && !r.net && Math.abs(r.values[c.key] ?? 0) > 0.004))),
    rows, total: null,
  }));
};
// En la fila de valor neto solo se enseñan los saldos inicial y final
const blankCell = (r, c) => !!r.net && c.key !== "opening" && c.key !== "closing";
// Notas guardadas con el fallo antiguo (custom: true en vez de una tabla):
// se reparan al leerlas para que el motor y el editor no se rompan.
const fixNote = (n) => (n && n.custom != null && !Array.isArray(n.custom?.columns)
  ? { ...n, custom: null, userAdded: n.userAdded ?? n.custom === true }
  : n);
// Meses en español para el texto del documento (fecha de cierre); en la interfaz, monthName (idioma de la app)
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (m) => L(`month_${m}`, MONTHS[m - 1] ?? "");

export default function MemoryEditor({
  presentation, onChange, onBack, token, activeStandardKey, sources = [], structures = [], companies = [],
  readOnly = false, saveState = "idle", onShare = null, onDuplicate = null, colors = { primary: "#1a2f8a" },
}) {
  // Idioma de la app: lo usan el editor y el motor (L)
  const T = useT();
  setMemoryT(T);
  const locale = useLocale();
  const mem = presentation.memory ?? {};
  const notes = useMemo(() => (mem.notes ?? []).map(fixNote), [mem.notes]);
  const period = mem.period ?? {};
  const scope = mem.scope ?? "individual";
  const entity = mem.entity ?? "";
  const [selId, setSelId] = useState(notes[0]?.id ?? null);
  const [showHidden, setShowHidden] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [idxQ, setIdxQ] = useState("");
  const [focus, setFocus] = useState(null); // { noteId, key, n } → resaltar una variable o fila
  const [source, setSource] = useState(null); // { noteId, ref, varKey } → ventana "¿De dónde sale?"
  // Índice de notas plegable (se recuerda)
  const [idxCollapsed, setIdxCollapsed] = useState(() => { try { return localStorage.getItem("konsolidator:mem-index") === "1"; } catch { return false; } });
  const toggleIdx = () => setIdxCollapsed(v => { try { localStorage.setItem("konsolidator:mem-index", v ? "0" : "1"); } catch { /* sin almacenamiento */ } return !v; });
  const sel = notes.find(n => n.id === selId) ?? notes[0];

  // Estado de guardado: ya no ocupa sitio en la barra. Aparece como una
  // pastilla flotante en cada cambio de estado; "Guardado" se va sola a los
  // 2 segundos y los avisos (sin conexión, copia) se quedan hasta resolverse.
  // Al abrir la memoria no se enseña nada hasta que haya un cambio.
  const [lastSave, setLastSave] = useState(saveState);
  const [saveSeq, setSaveSeq] = useState(0);
  if (saveState !== lastSave) { setLastSave(saveState); setSaveSeq(n => n + 1); }
  const saveAlert = saveState === "error" || saveState === "conflict";
  const showSave = !readOnly && saveState !== "idle" && (saveSeq > 0 || saveAlert);

  const setMem = (fn) => { if (!readOnly) onChange(p => ({ ...p, memory: fn(p.memory ?? {}) })); };
  const setNote = (id, patch) => setMem(m => ({ ...m, notes: (m.notes ?? []).map(n0 => {
    if (n0.id !== id) return n0;
    const n = fixNote(n0);
    return { ...n, ...(typeof patch === "function" ? patch(n) : patch) };
  }) }));

  // ── Datos: periodo de la memoria, cierre del año anterior y mismo mes del año anterior ──
  const y = Number(period.year), m = Number(period.month);
  const periods = useMemo(() => ({
    cur: { source: period.source, structure: period.structure, year: String(y), month: String(m), mode: "ytd" },
    prevYE: { source: period.source, structure: period.structure, year: String(y - 1), month: "12", mode: "ytd" },
    prevSame: { source: period.source, structure: period.structure, year: String(y - 1), month: String(m), mode: "ytd" },
    // Cierre de hace dos ejercicios: saldo inicial del cuadro de movimientos del año anterior
    prevYE2: { source: period.source, structure: period.structure, year: String(y - 2), month: "12", mode: "ytd" },
  }), [period.source, period.structure, y, m]);
  const wanted = useMemo(() => (entity ? Object.values(periods).map(p => ({ scope, entity, ...p })) : []), [periods, scope, entity]);
  const data = usePresentationData({ token, standardKey: activeStandardKey, period: periods.cur, wanted });

  const ctx = useMemo(() => ({
    scope,
    accounts: data?.accounts ?? [],
    childrenOf: data?.childrenOf ?? new Map(),
    ccTagToCodes: data?.ccTagToCodes ?? new Map(),
    value: (code, pk, statement) => {
      const r = data?.resolveAccount?.({ scope, entity, accountCode: code, statement: statement === "cf" ? "cf" : undefined }, periods[pk]);
      if (!r || r.status === "loading") return null;
      return r.status === "ok" ? r.value : 0;
    },
  }), [data, scope, entity, periods]);

  const entityName = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === entity)?.CompanyLegalName ?? entity;
  const lastDay = new Date(y, m, 0).getDate();
  const resultKpi = data?.resolveKpi?.({ scope, entity, kpiId: "net_result" }, periods.cur);
  const globals = useMemo(() => ({
    entidad: { value: entityName, label: L("me_g_entity", "Nombre de la sociedad o grupo") },
    ejercicio: { value: String(y), label: L("me_g_year", "Ejercicio") },
    ejercicio_anterior: { value: String(y - 1), label: L("me_g_prev_year", "Ejercicio anterior") },
    fecha_cierre: { value: `${lastDay} de ${MONTHS[m - 1] ?? ""} de ${y}`, label: L("me_g_close_date", "Fecha de cierre") },
    resultado_ejercicio: { value: resultKpi?.status === "ok" ? resultKpi.value : 0, label: L("me_g_result", "Resultado del ejercicio") },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entityName, y, m, lastDay, resultKpi?.status, resultKpi?.value, locale]);

  // Nombres de los periodos para vincular celdas a cuentas
  const periodLabels = useMemo(() => ({
    cur: `${monthName(m)} ${y}`,
    prevYE: `${monthName(12)} ${y - 1}`,
    prevSame: `${monthName(m)} ${y - 1}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [y, m, locale]);
  // Tablas de todas las notas (las variables de una nota se pueden usar en otra).
  // Las celdas vinculadas a variables se resuelven en varias pasadas: primero
  // las tablas sin esos vínculos, luego con las variables de la pasada anterior
  // (así un vínculo a una celda que a su vez está vinculada también se llena).
  const { tables, vars } = useMemo(() => {
    const accName = new Map([...(data?.accounts ?? []), ...(data?.cfAccounts ?? [])].map(a => [String(a.code), a.name]));
    const build = (prevVars) => {
      const g = {
        resultado_ejercicio: globals.resultado_ejercicio.value, year: y,
        resolveLink: (l, cellKey, note) => {
          if (l.type === "acc") {
            const v = ctx.value(l.code, l.pk ?? "cur", l.statement);
            return { value: v ?? 0, label: `${l.code} ${accName.get(String(l.code)) ?? l.name ?? ""}`.trim() + ` · ${l.statement === "cf" ? `${L("me_cf_short", "flujos")} · ` : ""}${periodLabels[l.pk ?? "cur"] ?? ""}` };
          }
          // Una celda no se puede vincular a sí misma
          const [rk, ck] = cellKey.split("|");
          const own = `n${note.number}.${rk}.${ck.replace("@prev", "")}${ck.endsWith("@prev") ? ".prev" : ""}`;
          if (l.key === own) return { missing: true };
          if (!prevVars) return { value: 0, label: l.key };
          const v = prevVars[l.key];
          if (!v || typeof v.value !== "number") return { missing: true };
          return { value: v.value, label: v.label ?? l.key };
        },
      };
      const t = new Map();
      notes.forEach(n => t.set(n.id, n.kind === "text" && !n.custom ? null : buildNoteTable(n, ctx, g)));
      const v = { ...globals };
      notes.forEach(n => Object.assign(v, noteVariables(n, t.get(n.id))));
      return { tables: t, vars: v };
    };
    const varLinks = notes.some(n => Object.values(n.links ?? {}).some(l => l?.type === "var"));
    let res = build(null);
    if (varLinks) for (let i = 0; i < 3; i++) res = build(res.vars);
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, ctx, globals, y, data?.accounts, data?.cfAccounts, periodLabels, locale]);

  // ── Exportaciones: Word, PDF (impresión) y Excel (una hoja por tabla) ──
  const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const visible = notes.filter(n => !n.hidden);
  const fileBase = (presentation.name || L("me_file_base", "memoria")).replace(/[\\/:*?"<>|]+/g, "-");
  const download = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const pctTxt = (v) => `${(v ?? 0).toFixed(1).replace(".", ",")}%`;
  const docHtml = () => {
    const body = visible.map((n, i) => {
      const t = tables.get(n.id);
      const text = narrativeToHtml(n.narrative, vars, fmt);
      const table = t && n.tableOn !== false && t.columns.length ? exportBlocks(t).map(b => `
        ${b.title ? `<p class="y">${esc(b.title)}</p>` : ""}
        <table><thead><tr><th></th>${b.columns.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
        ${b.rows.map(r => (r.heading
          ? `<tr class="h"><td colspan="${b.columns.length + 1}">${esc(r.label)}</td></tr>`
          : `<tr class="${r.subtotal ? "t" : ""}"><td>${esc(r.label)}</td>${b.columns.map(c => `<td class="n">${blankCell(r, c) ? "" : c.src === "pct" ? pctTxt(r.values[c.key]) : t.mode === "movement" && Math.abs(r.values[c.key] ?? 0) < 0.005 ? "-" : fmt(r.values[c.key])}</td>`).join("")}</tr>`)).join("")}
        ${b.total ? `<tr class="t"><td>${esc(L("me_total", "Total"))}</td>${b.columns.map(c => `<td class="n">${c.src === "pct" ? pctTxt(b.total.values[c.key]) : fmt(b.total.values[c.key])}</td>`).join("")}</tr>` : ""}
        </tbody></table>`).join("") : "";
      return `<h2>${i + 1}. ${esc(n.title)}</h2><div class="txt">${text}</div>${table}`;
    }).join("\n");
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(presentation.name)}</title>
      <style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;margin:24pt}h1{font-size:18pt;color:#1a2f8a}h2{font-size:13pt;color:#1a2f8a;margin-top:18pt;page-break-after:avoid}
      table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:9.5pt;page-break-inside:avoid}th{background:#1a2f8a;color:#fff;padding:4pt 6pt;text-align:right}th:first-child{text-align:left}
      td{border-bottom:1px solid #ddd;padding:3pt 6pt}td.n{text-align:right}tr.h td{font-weight:bold;background:#f1f3f9}tr.t td{font-weight:bold;border-top:1.5pt solid #1a2f8a}p.y{margin:10pt 0 2pt;font-weight:bold;color:#1a2f8a}
      @media print{th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
      <body><h1>${esc(presentation.name)}</h1><p>${esc(entityName)} · ${globals.fecha_cierre.value}</p>${body}</body></html>`;
  };
  const exportWord = () => download(new Blob(["\ufeff", docHtml()], { type: "application/msword" }), `${fileBase}.doc`);
  const exportPdf = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(docHtml()); w.document.close();
    w.onload = () => { w.focus(); w.print(); };
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* ventana cerrada */ } }, 600);
  };
  const exportExcel = () => {
    // Libro de Excel (SpreadsheetML): hoja "Índice" + una hoja por nota con tabla
    const used = new Set();
    const sheetName = (n, i) => {
      let base = `${i + 1} ${n.title}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim();
      let name = base, k = 2;
      while (used.has(name)) name = `${base.slice(0, 28)} ${k++}`;
      used.add(name);
      return name;
    };
    const cell = (v, style) => (typeof v === "number"
      ? `<Cell ss:StyleID="${style ?? "num"}"><Data ss:Type="Number">${Math.round(v * 100) / 100}</Data></Cell>`
      : `<Cell ss:StyleID="${style ?? "txt"}"><Data ss:Type="String">${esc(v)}</Data></Cell>`);
    const index = `<Worksheet ss:Name="${esc(L("me_x_index", "Índice"))}"><Table><Column ss:Width="40"/><Column ss:Width="320"/>
      <Row>${cell(presentation.name, "title")}</Row><Row>${cell(`${entityName} · ${globals.fecha_cierre.value}`)}</Row><Row/>
      ${visible.map((n, i) => `<Row>${cell(i + 1)}${cell(n.title)}</Row>`).join("")}</Table></Worksheet>`;
    const sheets = visible.map((n, i) => {
      const t = tables.get(n.id);
      if (!t || n.tableOn === false || !t.columns.length) return "";
      const blocks = exportBlocks(t);
      const width = Math.max(...blocks.map(b => b.columns.length));
      return `<Worksheet ss:Name="${esc(sheetName(n, i))}"><Table><Column ss:Width="300"/>${Array.from({ length: width }, () => '<Column ss:Width="110"/>').join("")}
        <Row>${cell(`${i + 1}. ${n.title}`, "title")}</Row>
        ${blocks.map(b => `<Row/>${b.title ? `<Row>${cell(b.title, "bold")}</Row>` : ""}
        <Row>${cell("", "head")}${b.columns.map(c => cell(c.label, "head")).join("")}</Row>
        ${b.rows.map(r => `<Row>${cell(r.label, r.heading || r.subtotal ? "bold" : "txt")}${b.columns.map(c => (r.heading || blankCell(r, c) ? cell("") : cell(r.values[c.key] ?? 0, c.src === "pct" ? "pct" : r.subtotal ? "numB" : "num"))).join("")}</Row>`).join("")}
        ${b.total ? `<Row>${cell(L("me_total", "Total"), "bold")}${b.columns.map(c => cell(b.total.values[c.key] ?? 0, c.src === "pct" ? "pctB" : "numB")).join("")}</Row>` : ""}`).join("")}
        </Table></Worksheet>`;
    }).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Styles><Style ss:ID="txt"/><Style ss:ID="title"><Font ss:Bold="1" ss:Size="14" ss:Color="#1A2F8A"/></Style>
      <Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1A2F8A" ss:Pattern="Solid"/></Style>
      <Style ss:ID="bold"><Font ss:Bold="1"/></Style><Style ss:ID="num"><NumberFormat ss:Format="#,##0.00;(#,##0.00)"/></Style>
      <Style ss:ID="numB"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00;(#,##0.00)"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders></Style>
      <Style ss:ID="pct"><NumberFormat ss:Format="0.0&quot;%&quot;"/></Style><Style ss:ID="pctB"><Font ss:Bold="1"/><NumberFormat ss:Format="0.0&quot;%&quot;"/></Style></Styles>
      ${index}${sheets}</Workbook>`;
    download(new Blob([xml], { type: "application/vnd.ms-excel" }), `${fileBase}.xls`);
  };

  // ── Notas: añadir, mover, ocultar ──
  const addNote = () => {
    const number = Math.max(0, ...notes.map(n => n.number)) + 1;
    // "custom" es la tabla propia de la nota ({ columns, rows }); que la nota la
    // ha creado el usuario se marca aparte (antes custom: true rompía el motor)
    const n = { id: `c${uid()}`, number, title: L("me_new_note", "Nueva nota"), description: "", narrative: "", kind: "manual", custom: null, userAdded: true,
      manual: { columns: [L("me_col_cur", "Ejercicio actual"), L("me_col_prev", "Ejercicio anterior")], rows: [] }, tableOn: false, hidden: false,
      overrides: {}, extraRows: [], hiddenRows: [], signFlip: null, reviewed: false };
    setMem(mm => ({ ...mm, notes: [...(mm.notes ?? []), n] }));
    setSelId(n.id);
  };

  const visibleNotes = notes.filter(n => showHidden || !n.hidden);
  const visibleCount = notes.filter(n => !n.hidden).length;
  const reviewedCount = notes.filter(n => !n.hidden && n.reviewed).length;
  const usedVars = useMemo(() => collectUsedVars(notes, tables, vars), [notes, tables, vars]);
  // Comprobaciones (cuadres) de todas las notas visibles
  const checks = useMemo(() => notes.flatMap((n, ni) => (n.hidden ? [] : (tables.get(n.id)?.checks ?? []).map(c => ({ ...c, noteId: n.id, noteNo: ni + 1, noteTitle: n.title })))), [notes, tables]);
  const failingChecks = checks.filter(c => !c.ok).length;
  // Variables revisadas cuyo importe ha cambiado después (se guarda el valor al revisar)
  const changedKeys = useMemo(() => {
    const out = new Set();
    usedVars.forEach(v => {
      const snap = mem.review?.vars?.[v.key];
      if (snap && typeof snap === "object" && typeof v.value === "number" && Math.abs((Number(snap.v) || 0) - v.value) > 0.005) out.add(v.key);
    });
    return out;
  }, [usedVars, mem.review]);
  const changedVarKeys = useMemo(() => new Set(usedVars.filter(v => v.kind === "text" && changedKeys.has(v.key)).map(v => v.focusKey)), [usedVars, changedKeys]);
  const reviewPending = (visibleCount - reviewedCount) + usedVars.filter(v => !mem.review?.vars?.[v.key] || changedKeys.has(v.key)).length + failingChecks;
  const selTable = sel ? tables.get(sel.id) : null;
  const loadingData = !data?.ready || [...tables.values()].some(t => t?.loading);

  return (
    <div className={styles.shell} style={{ "--me-primary": colors.primary }} data-me-shell="">
      {/* ── Barra superior ── */}
      <header className={styles.bar}>
        <button type="button" className={styles.back} onClick={onBack} aria-label={L("me_back_aria", "Volver a las memorias")} data-tip={L("me_back", "Volver")}><ArrowLeft size={16} /></button>
        <div className={styles.barTitle}>
          <input className={styles.docName} value={presentation.name ?? ""} readOnly={readOnly}
            onChange={e => onChange(p => ({ ...p, name: e.target.value }))} aria-label={L("me_name_aria", "Nombre de la memoria")} />
          <span className={styles.barMeta}>
            <b>{scope === "consolidated" ? L("mem_consolidated", "Consolidada") : L("mem_individual", "Individual")}</b><i />{entityName}
            {loadingData && <span className={styles.barLoading}><Loader2 size={12} className={styles.spin} />{L("me_calculating", "Calculando…")}</span>}
          </span>
        </div>
        {readOnly && <span className={styles.saved}><Eye size={13} />{L("me_readonly", "Solo lectura")}</span>}

        {/* Periodo: chip con el periodo actual; abre el selector */}
        <div className={styles.popWrap}>
          <button type="button" className={cx(styles.periodChip, periodOpen && styles.chipOn)} disabled={readOnly}
            onClick={() => setPeriodOpen(o => !o)} data-tip={L("me_period_tip", "Periodo de la memoria")}>
            <CalendarRange size={15} />
            <span><b>{monthName(m).slice(0, 3)} {y}</b><em>{period.source} · {period.structure}</em></span>
          </button>
          {periodOpen && !readOnly && (
            <PeriodPicker period={period} sources={sources} structures={structures}
              onChange={(patch) => setMem(mm => ({ ...mm, period: { ...mm.period, ...patch } }))}
              onClose={() => setPeriodOpen(false)} />
          )}
        </div>

        <span className={styles.barSep} />

        {/* Revisor */}
        <button type="button" className={cx(styles.iconBtn, reviewOpen && styles.iconOn)} onClick={() => setReviewOpen(o => !o)} data-tip={L("me_review_tip", "Revisión: epígrafes, variables y cuadres")}>
          <ListChecks size={17} />
          {reviewPending > 0 && <span className={styles.badge}>{reviewPending}</span>}
        </button>

        {/* Exportar: como en las demás páginas, el botón se abre en Word · PDF · Excel con sus logos */}
        <ExportButtons onWord={exportWord} onPdf={exportPdf} onExcel={exportExcel} />
        {onShare && <button type="button" className={styles.iconBtn} onClick={onShare} data-tip={L("me_share", "Compartir")}><Share2 size={17} /></button>}
        <GuideButton className={cx(styles.iconBtn, styles.tipEnd)} label={false} />
        {readOnly && onDuplicate && <button type="button" className={cx(styles.barBtn, styles.barPrimary)} onClick={onDuplicate}><Copy size={14} />{L("me_duplicate_edit", "Duplicar para editar")}</button>}
      </header>

      {showSave && createPortal(
        <span key={saveSeq} role="status" aria-live="polite"
          className={cx(styles.saveToast, saveState === "saved" && styles.saveToastFade, saveAlert && styles.saveToastErr)}>
          {saveState === "saving" ? <><Loader2 size={13} className={styles.spin} />{L("pres_saving", "Guardando…")}</>
            : saveState === "error" ? <><AlertTriangle size={13} />{L("pres_save_retrying", "Sin conexión · reintentando")}</>
            : saveState === "conflict" ? <><AlertTriangle size={13} />{L("pres_conflict_short", "Guardado como copia")}</>
            : <><Check size={13} strokeWidth={2.6} />{L("pres_saved", "Guardado")}</>}
        </span>,
        document.body,
      )}

      <div className={cx(styles.body, idxCollapsed && styles.bodyCollapsed, reviewOpen && styles.bodyReview)}>
        {/* ── Índice de epígrafes (plegable) ── */}
        <nav className={cx(styles.index, idxCollapsed && styles.indexCollapsed)}>
          {/* Progreso de revisión: solo con el revisor abierto */}
          {reviewOpen && !idxCollapsed && (
            <div className={styles.idxProgress}>
              <span className={styles.ring} style={{ "--p": visibleCount ? reviewedCount / visibleCount : 0 }}>
                <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" /></svg>
              </span>
              <span><b>{L("me_review", "Revisión")}</b><em>{L("me_reviewed_of", "{n} de {total} epígrafes revisados", { n: reviewedCount, total: visibleCount })}</em></span>
            </div>
          )}
          <div className={styles.indexHead}>
            {!idxCollapsed && (
              <label className={styles.idxSearch}>
                <Search size={13} />
                <input value={idxQ} onChange={e => setIdxQ(e.target.value)} placeholder={L("me_search_note", "Buscar epígrafe")} />
              </label>
            )}
            <button type="button" className={styles.idxToggle} onClick={toggleIdx} data-tip={idxCollapsed ? L("me_expand", "Desplegar") : L("me_collapse", "Plegar")}>
              {idxCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
          <ol>
            {visibleNotes.filter(n => !idxQ || n.title.toLowerCase().includes(idxQ.toLowerCase())).map((n, i) => {
              const t = tables.get(n.id);
              const hasData = t && t.rows?.some(r => !r.heading && Object.values(r.values).some(v => Math.abs(v) > 0.004));
              const warn = (t?.checks ?? []).some(c => !c.ok);
              const state = n.reviewed ? "ok" : warn ? "warn" : t ? (hasData ? "data" : "empty") : "text";
              return (
                <li key={n.id} style={{ "--i": Math.min(i, 20) }}>
                  <button type="button" className={cx(styles.idxItem, sel?.id === n.id && styles.idxOn, n.hidden && styles.idxHidden)} onClick={() => setSelId(n.id)} title={n.title}>
                    <span className={cx(styles.idxNum, styles[`st_${state}`])}>{n.reviewed ? <Check size={12} strokeWidth={3} /> : notes.indexOf(n) + 1}</span>
                    <span className={styles.idxText}>
                      <span className={styles.idxTitle}>{n.title}</span>
                      <span className={styles.idxSub}>
                        {state === "ok" ? L("me_st_ok", "Revisado") : state === "warn" ? L("me_st_warn", "Cuadro con diferencias") : state === "data" ? (t?.mode === "movement" ? L("me_st_mov", "Cuadro de movimientos") : L("me_st_data", "Tabla con datos")) : state === "empty" ? L("me_st_empty", "Tabla sin importes") : L("me_st_text", "Solo texto")}
                        {n.hidden && ` · ${L("me_hidden_low", "oculto")}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {!idxCollapsed && (
            <div className={styles.idxFoot}>
              {!readOnly && <button type="button" className={styles.addNote} onClick={addNote}><Plus size={14} />{L("me_add_note", "Añadir epígrafe")}</button>}
              <button type="button" className={styles.idxGhost} onClick={() => setShowHidden(v => !v)} data-tip={showHidden ? L("me_hide_hidden", "Ocultar los epígrafes ocultos") : L("me_show_hidden", "Ver los epígrafes ocultos")}>
                {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          )}
        </nav>

        {/* ── Nota ── */}
        <main className={styles.paperWrap}>
          {sel && (
            <article key={sel.id} className={styles.paper}>
              <NoteView
                focus={focus?.noteId === sel.id ? focus : null}
                note={sel} index={notes.indexOf(sel)} table={selTable} vars={vars} readOnly={readOnly}
                changedVarKeys={changedVarKeys}
                onExplain={(ref, varKey) => setSource({ noteId: sel.id, ref, varKey })}
                onPillClick={(key) => setSource(vars[key]?.ref ? { noteId: vars[key].ref.noteId, ref: vars[key].ref, varKey: key, fromText: true } : { varKey: key, fromText: true })}
                accounts={data?.accounts ?? []} cfAccounts={data?.cfAccounts ?? []} valueNow={(code, st) => ctx.value(code, "cur", st)} valueAt={(code, pk, st) => ctx.value(code, pk, st)} periodLabels={periodLabels}
                onPatch={(patch) => setNote(sel.id, patch)}
                onDelete={sel.userAdded ? () => { setMem(mm => ({ ...mm, notes: mm.notes.filter(n => n.id !== sel.id) })); setSelId(notes[0]?.id); } : null}
              />
            </article>
          )}
        </main>

        {reviewOpen && (
          <ReviewPanel
            notes={notes} vars={vars} used={usedVars} review={mem.review ?? {}} readOnly={readOnly} selId={sel?.id}
            checks={checks} changedKeys={changedKeys}
            onGoCheck={(c) => { setSelId(c.noteId); if (c.rowKey) setFocus({ noteId: c.noteId, key: c.rowKey, col: c.colKey, year: c.year, n: Date.now() }); }}
            onClose={() => setReviewOpen(false)}
            onGoNote={(id) => { setSelId(id); setFocus(null); }}
            onGoVar={(item) => { setSelId(item.noteId); setFocus({ noteId: item.noteId, key: item.focusKey, col: item.col, year: item.year, n: Date.now() }); }}
            onToggleNote={(id) => setNote(id, n => ({ reviewed: !n.reviewed }))}
            onToggleVar={(item) => setMem(mm => {
              const cur = mm.review?.vars?.[item.key];
              // Al revisar se guarda el importe: si después cambia, vuelve a pendiente
              const next = cur && !changedKeys.has(item.key) ? false : { v: typeof item.value === "number" ? item.value : null };
              return { ...mm, review: { ...(mm.review ?? {}), vars: { ...(mm.review?.vars ?? {}), [item.key]: next } } };
            })}
          />
        )}
      </div>

      {/* ¿De dónde sale? */}
      {source && (() => {
        const n = notes.find(x => x.id === source.noteId);
        const info = n && source.ref
          ? explainCell(n, tables.get(n.id), source.ref, ctx)
          : vars[source.varKey] ? { rowLabel: vars[source.varKey].label, colLabel: "", value: vars[source.varKey].value, source: "sistema", formula: L("me_general_data", "Dato general del documento"), parts: [] } : null;
        const goCell = n && source.ref && source.fromText ? () => {
          setSource(null); setSelId(n.id);
          setFocus({ noteId: n.id, key: source.ref.rowKey, col: source.ref.colKey, year: source.ref.year, n: Date.now() });
        } : null;
        return info ? <CellSource info={info} note={n} years={n ? tables.get(n.id)?.years : null} varKey={source.varKey} onGoCell={goCell} onClose={() => setSource(null)} /> : null;
      })()}
    </div>
  );
}

/* ── Exportar: mismo botón y mismos logos que la cabecera de las demás
      páginas (Individual, Contributivo, Sábana): "Exportar" se abre en
      pastillas con el logo de cada formato. ─────────────────────────────── */
const LOGO = {
  pdf: "https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png",
  excel: "https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png",
};
// Logo de Word al estilo del de Microsoft 365 (hojas en azules + loseta con la W)
function WordLogo({ size = 20 }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}><rect x="13" y="6" width="31" height="36" rx="3.5" /></clipPath>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2368C4" /><stop offset="1" stopColor="#1A4FA0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect x="13" y="6" width="31" height="12" fill="#41A5EE" />
        <rect x="13" y="18" width="31" height="12" fill="#2B7CD3" />
        <rect x="13" y="30" width="31" height="12" fill="#185ABD" />
      </g>
      <rect x="4" y="13" width="22" height="22" rx="3" fill={`url(#${id}g)`} />
      <path d="M8.6 18.6h2.6l1.6 7.4 1.9-7.4h2.3l1.9 7.4 1.6-7.4h2.6l-2.9 10.8h-2.4l-1.9-7.1-1.9 7.1h-2.4z" fill="#fff" />
    </svg>
  );
}
function Logo({ kind, size }) {
  const [broken, setBroken] = useState(false);
  if (kind === "word") return <WordLogo size={size} />;
  if (broken) {
    const fill = { pdf: "#D93025", excel: "#107C41", word: "#2B579A" }[kind];
    const txt = { pdf: "PDF", excel: "XLS", word: "DOC" }[kind];
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill={fill} />
        <text x="7.5" y="23" fill="#fff" fontSize="7" fontWeight="700" fontFamily="Arial,sans-serif">{txt}</text>
      </svg>
    );
  }
  return <img src={LOGO[kind]} alt={kind} onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: "contain", display: "block" }} />;
}
function ExportButtons({ onWord, onPdf, onExcel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const pill = (kind, label, color, rgb, fn, i) => (
    <button key={kind} type="button" className={styles.expPill} title={label}
      style={{ color, borderColor: `rgba(${rgb},0.25)`, boxShadow: `0 4px 12px -2px rgba(${rgb},0.18)`, animationDelay: `${i * 60}ms` }}
      onClick={() => { setOpen(false); fn(); }}>
      <Logo kind={kind} size={kind === "excel" ? 22 : kind === "word" ? 20 : 18} />
      <span>{label}</span>
    </button>
  );
  return (
    <div ref={ref} className={styles.expWrap}>
      {open ? (
        <>
          {pill("word", "Word", "#2B579A", "43,87,154", onWord, 0)}
          {pill("pdf", "PDF", "#CD202C", "205,32,44", onPdf, 1)}
          {pill("excel", "Excel", "#217346", "33,115,70", onExcel, 2)}
        </>
      ) : (
        <button type="button" className={styles.expMain} onClick={() => setOpen(true)} data-tip={L("me_export", "Exportar")}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{L("me_export", "Exportar")}</span>
        </button>
      )}
    </div>
  );
}

/* ── Selector de periodo: año en pastillas, meses en rejilla, fuente y
      perímetro ─────────────────────────────────────────────────────────── */
function PeriodPicker({ period, sources, structures, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const yearNow = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => String(yearNow - i));
  const val = (x, k1, k2) => x?.[k1] ?? x?.[k2] ?? x;
  return (
    <div ref={ref} className={styles.periodPop}>
      <div className={styles.ppHead}><CalendarRange size={15} /><b>{L("me_period_tip", "Periodo de la memoria")}</b><span>{L("me_pp_hint", "El año anterior se usa como comparativo.")}</span></div>
      <p className={styles.ppLabel}>{L("me_g_year", "Ejercicio")}</p>
      <div className={styles.ppYears}>
        {years.map(yv => <button key={yv} type="button" className={cx(String(period.year) === yv && styles.ppOn)} onClick={() => onChange({ year: yv })}>{yv}</button>)}
      </div>
      <p className={styles.ppLabel}>{L("me_pp_month", "Mes de cierre")}</p>
      <div className={styles.ppMonths}>
        {MONTHS.map((mn, i) => (
          <button key={mn} type="button" className={cx(String(period.month) === String(i + 1) && styles.ppOn)} onClick={() => onChange({ month: String(i + 1) })}>
            {monthName(i + 1).slice(0, 3)}
          </button>
        ))}
      </div>
      <div className={styles.ppRow}>
        <label><span className={styles.ppLabel}>{L("me_pp_source", "Fuente")}</span>
          <div className={styles.ppChips}>
            {sources.map(x => { const v = val(x, "Source", "source"); return <button key={v} type="button" className={cx(period.source === v && styles.ppOn)} onClick={() => onChange({ source: v })}>{v}</button>; })}
          </div>
        </label>
        <label><span className={styles.ppLabel}>{L("me_pp_structure", "Perímetro")}</span>
          <div className={styles.ppChips}>
            {structures.map(x => { const v = val(x, "GroupStructure", "groupStructure"); return <button key={v} type="button" className={cx(period.structure === v && styles.ppOn)} onClick={() => onChange({ structure: v })}>{v}</button>; })}
          </div>
        </label>
      </div>
    </div>
  );
}

/* ── Qué hay que revisar: variables en los textos, filas con datos y
      importes escritos a mano ──────────────────────────────────────────── */
function collectUsedVars(notes, tables, vars) {
  const out = [];
  const seen = new Set();
  notes.forEach((n, ni) => {
    if (n.hidden) return;
    const push = (item) => { if (!seen.has(item.key)) { seen.add(item.key); out.push({ ...item, noteId: n.id, noteNo: ni + 1, noteTitle: n.title }); } };
    String(n.narrative ?? "").replace(/\{\{([^}]+)\}\}/g, (_, k) => {
      const key = k.trim();
      push({ key: `txt:${n.id}:${key}`, focusKey: key, kind: "text", label: vars[key]?.label ?? key, value: vars[key]?.value, missing: !vars[key] });
      return "";
    });
    const t = tables.get(n.id);
    (n.custom?.rows ?? []).filter(r => r.code).forEach(r => {
      const row = t?.rows.find(x => x.key === r.id);
      const col = t?.columns[0];
      push({ key: `row:${n.id}:${r.id}`, focusKey: r.id, kind: "row", label: `${r.label} (${r.code})`, value: row && col ? row.values[col.key] : null });
    });
    Object.entries(n.overrides ?? {}).forEach(([cell, v]) => {
      const [rk, ckRaw] = cell.split("|");
      const prev = String(ckRaw).endsWith("@prev");
      const ck = String(ckRaw).replace("@prev", "");
      const row = (prev ? t?.prevRows : t?.rows)?.find(x => x.key === rk);
      const col = t?.columns.find(x => x.key === ck);
      if (!row || !col) return;
      const yl = t?.mode === "movement" ? ` · ${prev ? t.years?.prev : t.years?.cur}` : "";
      push({ key: `ov:${n.id}:${cell}`, focusKey: rk, col: ck, year: prev ? "prev" : "cur", kind: "manual", label: `${row.label} · ${col.label}${yl}`, value: Number(v) });
    });
    // Celdas vinculadas (a otra variable o al saldo de una cuenta)
    Object.keys(n.links ?? {}).forEach((cell) => {
      const [rk, ckRaw] = cell.split("|");
      const prev = String(ckRaw).endsWith("@prev");
      const ck = String(ckRaw).replace("@prev", "");
      const row = (prev ? t?.prevRows : t?.rows)?.find(x => x.key === rk);
      const col = t?.columns.find(x => x.key === ck);
      if (!row || !col) return;
      const yl = t?.mode === "movement" ? ` · ${prev ? t.years?.prev : t.years?.cur}` : "";
      push({ key: `ln:${n.id}:${cell}`, focusKey: rk, col: ck, year: prev ? "prev" : "cur", kind: "link", label: `${row.label} · ${col.label}${yl}`, value: row.values[ck] ?? 0, missing: !!row.meta?.[ck]?.missing });
    });
  });
  return out;
}

/* ── Revisor: epígrafes, variables y cuadres, con modo revisión ──────── */
function ReviewPanel({ notes, used, review, readOnly, selId, checks = [], changedKeys = new Set(), onClose, onGoNote, onGoVar, onGoCheck, onToggleNote, onToggleVar }) {
  const [tab, setTab] = useState("notes");
  const [mode, setMode] = useState(false); // modo revisión: al marcar, pasa al siguiente pendiente
  const [onlyPending, setOnlyPending] = useState(false);
  const visible = notes.filter(n => !n.hidden);
  const notesDone = visible.filter(n => n.reviewed).length;
  const varDone = (v) => !!review.vars?.[v.key] && !changedKeys.has(v.key);
  const varsDone = used.filter(varDone).length;
  const checksOk = checks.filter(c => c.ok).length;
  const list = tab === "notes" ? visible : tab === "vars" ? used : checks;
  const isDone = (it) => (tab === "notes" ? !!it.reviewed : tab === "vars" ? varDone(it) : it.ok);
  const shown = onlyPending ? list.filter(it => !isDone(it)) : list;
  const go = (it) => (tab === "notes" ? onGoNote(it.id) : tab === "vars" ? onGoVar(it) : onGoCheck(it));
  const toggle = (it) => {
    if (readOnly || tab === "checks") return;
    if (tab === "notes") onToggleNote(it.id); else onToggleVar(it);
    if (mode && !isDone(it)) {
      const idx = list.indexOf(it);
      const next = [...list.slice(idx + 1), ...list.slice(0, idx)].find(x => x !== it && !isDone(x));
      if (next) setTimeout(() => go(next), 120);
    }
  };
  const kindLabel = { text: L("me_kind_text", "Texto"), row: L("me_kind_row", "Fila con datos"), manual: L("me_kind_manual", "Escrito a mano"), link: L("me_kind_link", "Celda vinculada") };
  const total = list.length;
  const done = tab === "notes" ? notesDone : tab === "vars" ? varsDone : checksOk;
  return (
    <aside className={styles.review}>
      <div className={styles.rvHead}>
        <b><ListChecks size={15} />{L("me_review", "Revisión")}</b>
        <button type="button" className={styles.modalClose} onClick={onClose}><X size={15} /></button>
      </div>
      <div className={cx(styles.segTabs, styles.rvTabs)}>
        <button type="button" className={cx(tab === "notes" && styles.segOn)} onClick={() => setTab("notes")}>{L("me_rv_notes", "Epígrafes")} · {notesDone}/{visible.length}</button>
        <button type="button" className={cx(tab === "vars" && styles.segOn)} onClick={() => setTab("vars")}>{L("me_rv_vars", "Variables")} · {varsDone}/{used.length}</button>
        <button type="button" className={cx(tab === "checks" && styles.segOn)} onClick={() => setTab("checks")}>
          {L("me_rv_checks", "Cuadres")} · {checksOk}/{checks.length}{checks.length - checksOk > 0 && <i className={styles.rvDot} />}
        </button>
      </div>
      <div className={styles.rvBar}><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <div className={styles.rvTools}>
        {tab !== "checks" ? (
          <button type="button" className={cx(styles.rvMode, mode && styles.rvModeOn)} onClick={() => setMode(m => !m)} title={L("me_rv_mode_tip", "Al marcar un elemento como revisado, salta solo al siguiente pendiente")}>
            <Crosshair size={13} />{L("me_rv_mode", "Modo revisión")}
          </button>
        ) : <span className={styles.rvHint}>{L("me_rv_checks_hint", "Se comprueban solos al cambiar los datos.")}</span>}
        <label className={styles.rvOnly}><input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} />{L("me_rv_only", "Solo pendientes")}</label>
      </div>
      <ul className={styles.rvList}>
        {shown.map((it, i) => {
          const doneIt = isDone(it);
          const active = tab === "notes" ? selId === it.id : false;
          const changed = tab === "vars" && changedKeys.has(it.key);
          const snap = review.vars?.[it.key];
          return (
            <li key={tab === "notes" ? it.id : tab === "vars" ? it.key : `${it.noteId}:${it.id}`} style={{ "--i": Math.min(i, 20) }}
              className={cx(styles.rvItem, doneIt && tab !== "checks" && styles.rvDone, active && styles.rvActive, changed && styles.rvChanged)}>
              {tab === "checks" ? (
                <span className={cx(styles.rvCheckIcon, it.ok ? styles.rvOk : styles.rvBad)}>{it.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}</span>
              ) : (
                <button type="button" className={cx(styles.rvCheck, doneIt && styles.rvCheckOn)} onClick={() => toggle(it)} aria-pressed={doneIt} disabled={readOnly}>
                  {doneIt && <Check size={11} strokeWidth={3} />}
                </button>
              )}
              <button type="button" className={styles.rvGo} onClick={() => go(it)}>
                {tab === "notes" ? (
                  <><span className={styles.rvNo}>{notes.indexOf(it) + 1}</span><span className={styles.rvLabel}>{it.title}</span></>
                ) : tab === "vars" ? (
                  <>
                    <span className={styles.rvNo}>{it.noteNo}</span>
                    <span className={styles.rvText}>
                      <span className={styles.rvLabel}>{it.label}</span>
                      <em>
                        {changed ? L("me_rv_changed", "Ha cambiado desde la revisión (antes {v})", { v: fmt(Number(snap?.v) || 0) }) : kindLabel[it.kind]}
                        {it.missing ? ` · ${L("me_rv_missing", "variable que ya no existe")}` : ""}
                      </em>
                    </span>
                    <b className={cx(styles.rvVal, it.missing && styles.rvMissing, changed && styles.rvMissing)}>{typeof it.value === "number" ? fmt(it.value) : it.value ?? "—"}</b>
                  </>
                ) : (
                  <>
                    <span className={styles.rvNo}>{it.noteNo}</span>
                    <span className={styles.rvText}>
                      <span className={styles.rvLabel}>{it.label}</span>
                      <em>{it.noteTitle} · {it.detail}</em>
                    </span>
                    {!it.ok && <b className={cx(styles.rvVal, styles.rvMissing)}>{fmt(it.diff)}</b>}
                  </>
                )}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className={styles.empty}>
            {tab === "vars" && used.length === 0 ? L("me_rv_empty_vars", "Todavía no hay variables en los textos, filas con datos ni importes escritos a mano.")
              : tab === "checks" && checks.length === 0 ? L("me_rv_empty_checks", "No hay cuadros de movimientos que comprobar.")
              : L("me_rv_all_done", "Todo revisado.")}
          </li>
        )}
      </ul>
    </aside>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Texto con variables como píldoras.
   El texto se guarda con marcas {{variable}}; en pantalla cada variable es
   una píldora (no se puede partir ni escribir dentro: se borra entera).
   ══════════════════════════════════════════════════════════════════════ */
const pillClass = (key, vars, changed) => {
  const v = vars[key];
  return cx(styles.pill, !v && styles.pillMissing, v?.source === "inferido" && styles.pillInfer, (v?.source === "manual" || v?.source === "calculado") && styles.pillManual, v?.source === "vinculado" && styles.pillLink, changed?.has(key) && styles.pillChanged);
};
const pillTitle = (key, vars, changed) => {
  const v = vars[key];
  if (!v) return L("me_var_gone", "Esta variable ya no existe");
  return `${v.label}\n${L("me_origin", "Origen")}: ${SOURCE_LABELS[v.source] ?? SOURCE_LABELS.sistema}${changed?.has(key) ? `\n${L("me_changed_since", "Ha cambiado desde la revisión")}` : ""}\n${L("me_click_origin", "Clic para ver de dónde sale")}`;
};
const pillHtml = (key, vars, changed) => {
  const v = vars[key];
  const val = !v ? "¿?" : typeof v.value === "number" ? fmt(v.value) : String(v.value);
  const e = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<span class="${pillClass(key, vars, changed)}" contenteditable="false" data-var="${e(key)}" title="${e(pillTitle(key, vars, changed))}"><i></i>${e(val)}</span>`;
};
// El texto se guarda como HTML sencillo (negrita, cursiva, tamaño, letra,
// listas…) con {{variable}} donde va cada píldora. Los textos antiguos sin
// etiquetas se leen como texto plano.
const isHtml = (t) => /<\/?(b|i|u|strong|em|span|font|br|div|p|ul|ol|li)\b/i.test(String(t ?? ""));
const toHtml = (text, vars, changed) => {
  const src = String(text ?? "");
  const html = isHtml(src) ? src : src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  return html.replace(/\{\{([^}]+)\}\}/g, (_, k) => pillHtml(k.trim(), vars, changed));
};
const fromDom = (el) => {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("[data-var]").forEach(sp => sp.replaceWith(document.createTextNode(`{{${sp.dataset.var}}}`)));
  return clone.innerHTML.replace(/&nbsp;/g, " ").trim();
};
// Texto con formato → HTML para exportar (píldoras sustituidas por su valor)
const narrativeToHtml = (text, vars, fmtFn) => {
  const src = String(text ?? "");
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = isHtml(src) ? src : esc(src).replace(/\n/g, "<br>");
  return html.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
    const v = vars[k.trim()];
    return esc(!v ? `{{${k}}}` : typeof v.value === "number" ? fmtFn(v.value) : String(v.value));
  });
};

const FONTS = [["Inter, system-ui, sans-serif", "Inter"], ["Calibri, Arial, sans-serif", "Calibri"], ["Arial, Helvetica, sans-serif", "Arial"], ["Georgia, serif", "Georgia"], ["'Times New Roman', Times, serif", "Times New Roman"], ["'Courier New', monospace", "Courier"]];
const SIZES = ["11", "12", "13", "14", "16", "18", "20", "24"];

function FmtBtn({ on, title, onClick, children }) {
  return (
    <button type="button" className={cx(styles.fmtBtn, on && styles.fmtOn)} title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
  );
}

// Barra de formato (como un Word básico)
function FormatBar({ editorRef, onChanged }) {
  const [state, setState] = useState({});
  useEffect(() => {
    const read = () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel?.anchorNode || !el.contains(sel.anchorNode)) return;
      setState({
        bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"), ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
        align: ["justifyCenter", "justifyRight", "justifyFull"].find(c => document.queryCommandState(c)) ?? "justifyLeft",
      });
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [editorRef]);
  const run = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(cmd, false, val);
    onChanged();
  };
  const setSize = (px) => {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, false);
    document.execCommand("fontSize", false, "7");
    editorRef.current?.querySelectorAll('font[size="7"]').forEach(f => {
      const sp = document.createElement("span");
      sp.style.fontSize = `${px}px`;
      while (f.firstChild) sp.appendChild(f.firstChild);
      f.replaceWith(sp);
    });
    onChanged();
  };
  return (
    <div className={styles.fmtBar}>
      <select className={styles.fmtSelect} defaultValue="" title={L("me_fmt_font_tip", "Tipo de letra")} onMouseDown={e => e.stopPropagation()} onChange={e => { if (e.target.value) run("fontName", e.target.value); e.target.value = ""; }}>
        <option value="" disabled>{L("me_fmt_font", "Letra")}</option>
        {FONTS.map(([v, l]) => <option key={l} value={v} style={{ fontFamily: v }}>{l}</option>)}
      </select>
      <select className={styles.fmtSelect} defaultValue="" title={L("me_fmt_size", "Tamaño")} onChange={e => { if (e.target.value) setSize(e.target.value); e.target.value = ""; }}>
        <option value="" disabled>{L("me_fmt_size", "Tamaño")}</option>
        {SIZES.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <span className={styles.fmtSep} />
      <FmtBtn on={state.bold} title={L("me_fmt_bold", "Negrita (⌘B)")} onClick={() => run("bold")}><Bold size={14} strokeWidth={2.6} /></FmtBtn>
      <FmtBtn on={state.italic} title={L("me_fmt_italic", "Cursiva (⌘I)")} onClick={() => run("italic")}><Italic size={14} /></FmtBtn>
      <FmtBtn on={state.underline} title={L("me_fmt_underline", "Subrayado (⌘U)")} onClick={() => run("underline")}><Underline size={14} /></FmtBtn>
      <span className={styles.fmtSep} />
      <FmtBtn on={state.align === "justifyLeft"} title={L("me_fmt_left", "Alinear a la izquierda")} onClick={() => run("justifyLeft")}><AlignLeft size={14} /></FmtBtn>
      <FmtBtn on={state.align === "justifyCenter"} title={L("me_fmt_center", "Centrar")} onClick={() => run("justifyCenter")}><AlignCenter size={14} /></FmtBtn>
      <FmtBtn on={state.align === "justifyRight"} title={L("me_fmt_right", "Alinear a la derecha")} onClick={() => run("justifyRight")}><AlignRight size={14} /></FmtBtn>
      <FmtBtn on={state.align === "justifyFull"} title={L("me_fmt_justify", "Justificar")} onClick={() => run("justifyFull")}><AlignJustify size={14} /></FmtBtn>
      <span className={styles.fmtSep} />
      <FmtBtn on={state.ul} title={L("me_fmt_ul", "Lista con viñetas")} onClick={() => run("insertUnorderedList")}><List size={14} /></FmtBtn>
      <FmtBtn on={state.ol} title={L("me_fmt_ol", "Lista numerada")} onClick={() => run("insertOrderedList")}><ListOrdered size={14} /></FmtBtn>
      <span className={styles.fmtSep} />
      <FmtBtn on={false} title={L("me_fmt_clear", "Quitar formato")} onClick={() => run("removeFormat")}><RemoveFormatting size={14} /></FmtBtn>
    </div>
  );
}

function PillEditor({ value, vars, readOnly, onChange, editorRef, changedKeys, onPillClick }) {
  const ref = useRef(null);
  const last = useRef(null);
  useEffect(() => { if (editorRef) editorRef.current = ref.current; });
  // Pinta el contenido solo si cambia desde fuera (no mientras se escribe)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (last.current !== value) { el.innerHTML = toHtml(value, vars, changedKeys); last.current = value; }
  }, [value, vars, changedKeys]);
  // Los valores (y el aspecto) de las píldoras se actualizan solos al cambiar los datos
  useEffect(() => {
    ref.current?.querySelectorAll("[data-var]").forEach(sp => {
      const key = sp.dataset.var;
      const v = vars[key];
      const txt = !v ? "¿?" : typeof v.value === "number" ? fmt(v.value) : String(v.value);
      if (sp.lastChild?.nodeValue !== txt) { sp.innerHTML = "<i></i>"; sp.appendChild(document.createTextNode(txt)); }
      const cls = pillClass(key, vars, changedKeys);
      if (sp.className !== cls) sp.className = cls;
      sp.title = pillTitle(key, vars, changedKeys);
    });
  }, [vars, changedKeys]);
  const emit = () => { const t = fromDom(ref.current); last.current = t; onChange(t); };
  return (
    <div className={styles.richWrap}>
    {!readOnly && <FormatBar editorRef={ref} onChanged={emit} />}
    <div ref={ref} className={cx(styles.richText, readOnly && styles.richReadOnly)} contentEditable={!readOnly} suppressContentEditableWarning
      onInput={emit} onBlur={emit}
      onClick={e => { const p = e.target.closest?.("[data-var]"); if (p && onPillClick) onPillClick(p.dataset.var); }}
      onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}
      data-placeholder={L("me_text_ph", "Escribe el texto de la nota. Selecciona una celda de la tabla y pulsa «Insertar en el texto», o usa «Insertar variable».")} />
    </div>
  );
}

/* ── Una nota: cabecera, texto con variables y tabla ─────────────────── */
function NoteView({ note, index, table, vars, readOnly, onPatch, onDelete, accounts, cfAccounts, valueNow, valueAt, periodLabels, focus = null, changedVarKeys, onExplain, onPillClick }) {
  const editorRef = useRef(null);
  // Revisor: llevar a la variable o fila elegida y resaltarla un momento
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => {
      const k = CSS.escape(focus.key);
      const el = document.querySelector(`[data-var="${k}"]`) ?? document.querySelector(`[data-row="${k}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove(styles.flash);
      void el.offsetWidth;
      el.classList.add(styles.flash);
    }, 180);
    return () => clearTimeout(t);
  }, [focus]);
  const savedRange = useRef(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [q, setQ] = useState("");
  const [libOpen, setLibOpen] = useState(false);
  const [colOpen, setColOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);

  // Recordar dónde estaba el cursor en el texto antes de abrir el menú
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel?.rangeCount && editorRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);
  const insertVar = (key) => {
    const el = editorRef.current;
    if (!el) return;
    const tmp = document.createElement("span");
    tmp.innerHTML = pillHtml(key, vars);
    const pill = tmp.firstChild;
    const space = document.createTextNode("\u00a0");
    const r = savedRange.current && el.contains(savedRange.current.startContainer) ? savedRange.current : null;
    if (r) { r.deleteContents(); r.insertNode(space); r.insertNode(pill); }
    else { el.appendChild(pill); el.appendChild(space); }
    const sel = window.getSelection();
    const after = document.createRange();
    after.setStartAfter(space); after.collapse(true);
    sel.removeAllRanges(); sel.addRange(after);
    savedRange.current = after.cloneRange();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setVarsOpen(false);
    // Que se vea dónde ha entrado
    pill.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    pill.classList.add(styles.flash);
    setTimeout(() => pill.classList?.remove(styles.flash), 1500);
  };
  const own = `n${note.number}.`;
  const varList = Object.entries(vars)
    .filter(([k, v]) => !q || `${k} ${v.label}`.toLowerCase().includes(q.toLowerCase()))
    .sort(([a], [b]) => (b.startsWith(own) - a.startsWith(own)) || a.localeCompare(b))
    .slice(0, 80);

  // Cambios de estructura: la tabla pasa a ser "propia"
  const ensureCustom = (fn) => onPatch(nn => {
    const base = nn.custom ? {} : materialize(nn, table);
    const merged = { ...nn, ...base };
    return { ...base, ...fn(merged) };
  });
  const addColumn = (label, src) => ensureCustom(nn => ({
    custom: { ...nn.custom, columns: [...nn.custom.columns, { key: `u${uid()}`, label: label || COLUMN_SOURCES.find(x => x[0] === src)?.[1] || L("me_column", "Columna"), src }] },
  }));
  const addDataRow = ({ code, label, statement }) => ensureCustom(nn => ({
    custom: { ...nn.custom, rows: [...nn.custom.rows, { id: `r${uid()}`, label, code, statement }] },
  }));
  const isMov = table?.mode === "movement";
  const addMovRow = ({ code }) => onPatch(nn => ({ movCodes: [...new Set([...(nn.movCodes ?? []), String(code)])], hiddenRows: (nn.hiddenRows ?? []).filter(k => !String(k).startsWith(`${code}~`)) }));
  const addManualRow = () => (note.custom
    ? ensureCustom(nn => ({ custom: { ...nn.custom, rows: [...nn.custom.rows, { id: `r${uid()}`, label: L("me_new_row", "Nueva fila"), code: null }] } }))
    : onPatch(nn => ({ extraRows: [...(nn.extraRows ?? []), { id: `x${uid()}`, label: L("me_new_row", "Nueva fila"), values: {} }] })));

  return (
    <>
      <div className={styles.noteHead}>
        <span className={styles.noteKicker}>{L("me_note_n", "Nota {n}", { n: index + 1 })}{note.description ? ` · ${note.description}` : ""}</span>
        <div className={styles.noteTools}>
          {!readOnly && <>
            <button type="button" onClick={() => onPatch({ hidden: !note.hidden })}>{note.hidden ? <><Eye size={14} />{L("me_show", "Mostrar")}</> : <><EyeOff size={14} />{L("me_hide", "Ocultar")}</>}</button>
            {onDelete && <button type="button" className={styles.toolDanger} onClick={onDelete}><Trash2 size={14} /></button>}
          </>}
        </div>
      </div>
      <input className={styles.noteTitle} value={note.title} readOnly={readOnly} onChange={e => onPatch({ title: e.target.value })} aria-label={L("me_note_title_aria", "Título de la nota")} />

      {/* Texto */}
      <section className={styles.textBlock}>
        <div className={styles.blockHead}>
          <span><AlignLeft size={13} />{L("me_kind_text", "Texto")}</span>
          {!readOnly && (
            <div className={styles.varWrap}>
              <button type="button" className={styles.varBtn} onMouseDown={e => e.preventDefault()} onClick={() => setVarsOpen(o => !o)}><Braces size={13} />{L("me_insert_var", "Insertar variable")}</button>
              {varsOpen && (
                <div className={styles.varPop}>
                  <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L("me_search_var", "Buscar variable…")} />
                  <ul>
                    {varList.map(([k, v]) => (
                      <li key={k}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertVar(k)}>
                        <span>{v.label}</span><b>{typeof v.value === "number" ? fmt(v.value) : v.value}</b>
                      </button></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <PillEditor value={note.narrative ?? ""} vars={vars} readOnly={readOnly} editorRef={editorRef} onChange={(t) => onPatch({ narrative: t })}
          changedKeys={changedVarKeys} onPillClick={onPillClick} />
      </section>

      {/* Tabla */}
      <section className={styles.tableBlock}>
        <div className={styles.blockHead}>
          <span><Table2 size={13} />{L("me_table", "Tabla")}{note.custom ? ` · ${TABLE_LIBRARY.find(x => x.id === note.custom.template)?.label ?? L("me_tm_custom", "personalizada")}` : isMov ? ` · ${L("me_tm_mov", "cuadro de movimientos")}` : table?.mode === "rollforward" ? ` · ${L("me_tm_roll", "movimientos del plan")}` : table?.mode === "balance" ? ` · ${L("me_tm_balance", "saldo inicial y final")}` : table?.mode === "breakdown" ? ` · ${L("me_tm_breakdown", "desglose")}` : ""}
            {isMov && table.checks?.length > 0 && (table.checks.every(c => c.ok)
              ? <em className={styles.okChip}><CircleCheck size={12} />{L("me_reconciles", "Cuadra")}</em>
              : <em className={styles.warnChip}><CircleAlert size={12} />{L("me_to_review", "{n} por revisar", { n: table.checks.filter(c => !c.ok).length })}</em>)}
          </span>
          {!readOnly && (
            <div className={styles.tableTools}>
              <button type="button" onClick={() => setLibOpen(true)}><LayoutGrid size={13} />{L("me_change_table", "Cambiar tabla")}</button>
              {(note.custom || note.kind !== "text") && !isMov && <div className={styles.varWrap}>
                <button type="button" onClick={() => setColOpen(o => !o)}><Columns3 size={13} />{L("me_add_column", "Añadir columna")}</button>
                {colOpen && <AddColumnPop onAdd={(label, src) => { addColumn(label, src); setColOpen(false); }} onClose={() => setColOpen(false)} />}
              </div>}
              {note.kind !== "text" || note.custom ? <>
                <button type="button" onClick={() => onPatch({ tableOn: !(note.tableOn !== false) })}>{note.tableOn !== false ? <><EyeOff size={13} />{L("me_exclude_doc", "Quitar del documento")}</> : <><Eye size={13} />{L("me_include", "Incluir")}</>}</button>
                {table?.mode !== "manual" && <button type="button" onClick={() => onPatch({ signFlip: (table?.flip ?? 1) * -1 })} title={L("me_sign_tip", "Cambiar el signo de las cuentas")}><ArrowUpDown size={13} />{L("me_sign", "Signo")}</button>}
              </> : null}
            </div>
          )}
        </div>
        {note.kind === "text" && !note.custom ? (
          <p className={styles.tableOff}>{L("me_no_table", "Esta nota no tiene tabla.")} {!readOnly && <button type="button" className={styles.linkBtn} onClick={() => setLibOpen(true)}>{L("me_add_table", "Añadir una tabla")}</button>}</p>
        ) : table && note.tableOn !== false ? (
          <NoteTable note={note} table={table} readOnly={readOnly} onPatch={onPatch} ensureCustom={ensureCustom}
            onAddManual={isMov ? null : addManualRow} onAddData={() => setPickOpen(true)}
            onInsertVar={insertVar} onExplain={onExplain} focus={focus} vars={vars} accounts={accounts} cfAccounts={cfAccounts} valueAt={valueAt} periodLabels={periodLabels} />
        ) : (
          <p className={styles.tableOff}>{L("me_table_excluded", "La tabla no se incluye en el documento.")}</p>
        )}
      </section>

      {libOpen && (
        <TableLibrary current={note.custom?.template} hasRecommended={!!(note.bind || note.manual)}
          onPick={(id) => { onPatch(nn => (id === "__recommended" ? { custom: null, overrides: {}, links: {}, extraRows: [], hiddenRows: [], signFlip: null, tableOn: true } : { ...applyTemplate(nn, table, id), tableOn: true })); setLibOpen(false); }}
          onRemove={() => { onPatch({ tableOn: false }); setLibOpen(false); }}
          onClose={() => setLibOpen(false)} />
      )}
      {pickOpen && (
        <AccountPicker accounts={accounts} cfAccounts={cfAccounts} valueNow={valueNow} balanceOnly={isMov}
          onPick={(r) => { if (isMov) addMovRow(r); else addDataRow(r); setPickOpen(false); }} onClose={() => setPickOpen(false)} />
      )}
    </>
  );
}

/* ── Ventana a pantalla completa: se pinta en <body> para que nada (la hoja
      animada, el scroll) la recorte, centrada y con el fondo difuminado. ── */
function Overlay({ onClose, children }) {
  const primary = typeof document !== "undefined"
    ? getComputedStyle(document.querySelector("[data-me-shell]") ?? document.body).getPropertyValue("--me-primary").trim() || "#1a2f8a"
    : "#1a2f8a";
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className={styles.overlay} style={{ "--me-primary": primary }} onMouseDown={onClose}>{children}</div>,
    document.body,
  );
}

/* ── Biblioteca de tablas ────────────────────────────────────────────── */
function TableLibrary({ current, hasRecommended, onPick, onRemove, onClose }) {
  return (
    <Overlay onClose={onClose}>
      <div className={styles.modal} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={L("me_change_table", "Cambiar tabla")}>
        <div className={styles.modalHead}>
          <div><h3>{L("me_change_table", "Cambiar tabla")}</h3><p>{L("me_lib_hint", "Elige un tipo de tabla. Se conservan las filas (cuentas) que ya tenía la nota.")}</p></div>
          <button type="button" className={styles.modalClose} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.libGrid}>
          {hasRecommended && (
            <button type="button" className={cx(styles.libCard, !current && styles.libOn)} onClick={() => onPick("__recommended")}>
              <span className={styles.libIcon}><RotateCcw size={18} /></span>
              <b>{L("me_lib_rec", "Recomendada")}</b><em>{L("me_lib_rec_desc", "La tabla que el sistema monta para esta nota a partir del estándar.")}</em>
            </button>
          )}
          {TABLE_LIBRARY.map(tpl => (
            <button key={tpl.id} type="button" className={cx(styles.libCard, current === tpl.id && styles.libOn)} onClick={() => onPick(tpl.id)}>
              <span className={styles.libIcon}><Table2 size={18} /></span>
              <b>{tpl.label}</b><em>{tpl.description}</em>
              <span className={styles.libCols}>{tpl.columns.map(([, l]) => <i key={l}>{l}</i>)}</span>
            </button>
          ))}
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.dangerLink} onClick={onRemove}><Trash2 size={13} />{L("me_lib_remove", "Quitar la tabla de la nota")}</button>
        </div>
      </div>
    </Overlay>
  );
}

/* ── Añadir columna ──────────────────────────────────────────────────── */
function AddColumnPop({ onAdd, onClose }) {
  const [label, setLabel] = useState("");
  const [src, setSrc] = useState("cur");
  return (
    <div className={styles.colPop} onMouseLeave={onClose}>
      <label>{L("me_col_name", "Nombre")}<input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder={COLUMN_SOURCES.find(x => x[0] === src)?.[1]} /></label>
      <label>{L("me_col_data", "Datos de la columna")}
        <select value={src} onChange={e => setSrc(e.target.value)}>
          {COLUMN_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => onAdd(label.trim(), src)}><Plus size={13} />{L("me_add_column", "Añadir columna")}</button>
    </div>
  );
}

/* ── Elegir cuenta para una fila con datos (PyG, balance o flujos) ───── */
function AccountPicker({ accounts, cfAccounts, valueNow, onPick, onClose, balanceOnly = false }) {
  const [tab, setTab] = useState(balanceOnly ? "bs" : "pl");
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState(null);
  const list = tab === "cf" ? cfAccounts : accounts.filter(a => (tab === "bs" ? a.type === "B/S" : a.type === "P/L" || a.type === "DIS"));
  const query = q.trim().toLowerCase();
  const shown = list.filter(a => !query || `${a.code} ${a.name}`.toLowerCase().includes(query)).slice(0, 400);
  return (
    <Overlay onClose={onClose}>
      <div className={cx(styles.modal, styles.pickModal)} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={L("me_kind_row", "Fila con datos")}>
        <div className={styles.modalHead}>
          <div><h3>{L("me_kind_row", "Fila con datos")}</h3><p>{balanceOnly ? L("me_pick_hint_bs", "Elige la cuenta de balance. Se añade al cuadro de movimientos separada en coste, amortización y deterioro.") : L("me_pick_hint", "Elige la cuenta. El importe se calcula con el periodo de la memoria y cada celda queda como variable para el texto.")}</p></div>
          <button type="button" className={styles.modalClose} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.pickBar}>
          <div className={styles.segTabs}>
            {(balanceOnly ? [["bs", L("me_bs", "Balance")]] : [["pl", L("me_pl", "Pérdidas y ganancias")], ["bs", L("me_bs", "Balance")], ["cf", L("me_cf", "Flujos de efectivo")]]).map(([k, l]) => (
              <button key={k} type="button" className={cx(tab === k && styles.segOn)} onClick={() => { setTab(k); setPicked(null); }}>{l}</button>
            ))}
          </div>
          <label className={styles.pickSearch}><Search size={14} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L("me_search_code", "Buscar por código o nombre")} /></label>
        </div>
        <ul className={styles.pickList}>
          {shown.map(a => {
            const st = tab === "cf" ? "cf" : null;
            const v = valueNow(a.code, st);
            const on = picked?.code === a.code;
            return (
              <li key={a.code}>
                <button type="button" className={cx(styles.pickItem, on && styles.pickOn)} style={{ paddingLeft: 10 + Math.min(a.depth ?? 0, 6) * 12 }}
                  onClick={() => { setPicked({ code: a.code, name: a.name, statement: st }); setLabel(a.name); }}>
                  <span className={styles.pickCode}>{a.code}</span>
                  <span className={cx(styles.pickName, a.isSum && styles.pickSum)}>{a.name}</span>
                  <span className={cx(styles.pickVal, v < 0 && styles.neg)}>{v == null ? "…" : fmt(v)}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className={styles.empty}>{L("me_no_accounts", "No hay cuentas que coincidan.")}</li>}
        </ul>
        <div className={styles.modalFoot}>
          <label className={styles.pickLabel}>{L("me_row_name", "Nombre de la fila")}<input value={label} onChange={e => setLabel(e.target.value)} placeholder={L("me_row_name_ph", "Nombre que se verá en la tabla")} /></label>
          <button type="button" className={styles.primaryBtn} disabled={!picked} onClick={() => onPick({ code: picked.code, statement: picked.statement, label: label.trim() || picked.name })}>
            <Database size={14} />{L("me_add_row", "Añadir fila")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ── Tabla editable ──────────────────────────────────────────────────────
   · Clic en una celda: la selecciona. Arriba aparece la barra de la celda
     (como la barra de fórmulas de una hoja de cálculo): de dónde sale el
     importe y botones para editarlo, insertarlo en el texto como variable,
     ver su origen o devolverlo al cálculo.
   · Doble clic (o Intro) para escribir el importe. Flechas para moverse.
   · Cuadros de movimientos: ejercicio actual / anterior, bloques de coste,
     amortización y deterioro con subtotales, valor neto y columna de cuadre. */
const SRC_CLASS = { inferido: "srcInfer", calculado: "srcCalc", plan: "srcPlan", vinculado: "srcLink" };

function NoteTable({ note, table, readOnly, onPatch, ensureCustom, onAddManual, onAddData, onInsertVar, onExplain, focus = null, vars = {}, accounts = [], cfAccounts = [], valueAt = () => null, periodLabels = {} }) {
  const isMov = table.mode === "movement";
  const [year, setYear] = useState("cur");
  const [sel, setSel] = useState(null);       // { r: rowKey, c: colKey }
  const [editing, setEditing] = useState(null); // "fila|columna"
  const [draft, setDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const wrapRef = useRef(null);
  const custom = !!note.custom;
  const rows = isMov && year === "prev" ? (table.prevRows ?? []) : table.rows;
  const sfx = isMov && year === "prev" ? "@prev" : "";

  // El revisor puede pedir una fila del ejercicio anterior
  // y, si trae columna, deja la celda seleccionada
  useEffect(() => {
    if (!focus) return;
    if (focus.year && isMov) setYear(focus.year);
    if (focus.col) setSel({ r: focus.key, c: focus.col });
  }, [focus, isMov]);
  // Clic fuera de la tabla: se quita la selección
  useEffect(() => {
    if (!sel) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setSel(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sel]);

  const isPct = (c) => c.src === "pct";
  const editable = (r, c) => !readOnly && !r.heading && !r.subtotal && c.key !== "check" && !isPct(c);
  const varKeyOf = (r, c) => (r.key === "__total" ? `n${note.number}.total.${c.key}` : `n${note.number}.${r.key}.${c.key}${isMov && year === "prev" ? ".prev" : ""}`);
  const cellKey = (r, c) => `${r.key}|${c.key}${sfx}`;
  const show = (v, c) => (Math.abs(v) < 0.005 ? "—" : isPct(c) ? `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%` : fmt(v));

  const startEdit = (r, c) => {
    if (!editable(r, c)) return;
    const v = r.values[c.key] ?? 0;
    setEditing(cellKey(r, c));
    setDraft(fmt(v).replace(/[()]/g, m => (m === "(" ? "-" : "")));
  };
  const commit = (key) => {
    setEditing(null);
    // {{variable}} o =variable: la celda queda vinculada a esa variable
    const m = /^\s*(?:\{\{\s*([^}]+?)\s*\}\}|=\s*(-)?\s*([\w.~@-]+))\s*$/.exec(draft);
    if (m) {
      const k = (m[1] ?? m[3] ?? "").trim();
      if (vars[k] && typeof vars[k].value === "number") setLink(key, { type: "var", key: k, sign: m[2] ? -1 : 1 });
      return;
    }
    const n = parseNum(draft);
    if (n == null) return;
    if (note.links?.[key]) onPatch(nn => { const l = { ...(nn.links ?? {}) }; delete l[key]; return { links: l }; });
    const [rowKey] = key.split("|");
    const row = rows.find(r => r.key === rowKey);
    if (row?.extra) {
      const colKey = key.split("|")[1];
      onPatch(nn => ({ extraRows: (nn.extraRows ?? []).map(r => (r.id === rowKey ? { ...r, values: { ...(r.values ?? {}), [colKey]: n } } : r)) }));
    } else onPatch(nn => ({ overrides: { ...(nn.overrides ?? {}), [key]: n } }));
  };
  const resetCell = (key) => onPatch(nn => { const o = { ...(nn.overrides ?? {}) }; delete o[key]; return { overrides: o }; });
  // Vincular una celda a una variable o al saldo de una cuenta (sin crear filas)
  const setLink = (key, link) => onPatch(nn => {
    const o = { ...(nn.overrides ?? {}) }; delete o[key];
    return { links: { ...(nn.links ?? {}), [key]: link }, overrides: o };
  });
  const unlink = (key) => onPatch(nn => { const l = { ...(nn.links ?? {}) }; delete l[key]; return { links: l }; });
  const renameRow = (r, label) => (custom
    ? onPatch(nn => ({ custom: { ...nn.custom, rows: nn.custom.rows.map(x => (x.id === r.key ? { ...x, label } : x)) } }))
    : onPatch(nn => ({ extraRows: (nn.extraRows ?? []).map(x => (x.id === r.key ? { ...x, label } : x)) })));
  const removeRow = (r) => {
    if (custom) return onPatch(nn => ({ custom: { ...nn.custom, rows: nn.custom.rows.filter(x => x.id !== r.key) } }));
    if (r.extra) return onPatch(nn => ({ extraRows: (nn.extraRows ?? []).filter(x => x.id !== r.key) }));
    return onPatch(nn => ({ hiddenRows: [...(nn.hiddenRows ?? []), r.key] }));
  };
  const renameCol = (c, label) => (isMov
    ? onPatch(nn => ({ movLabels: { ...(nn.movLabels ?? {}), [c.key]: label } }))
    : ensureCustom(nn => ({ custom: { ...nn.custom, columns: nn.custom.columns.map(x => (x.key === c.key ? { ...x, label } : x)) } })));
  const removeCol = (c) => ensureCustom(nn => ({ custom: { ...nn.custom, columns: nn.custom.columns.filter(x => x.key !== c.key) } }));

  // Celda seleccionada
  const allRows = table.total && !isMov ? [...rows, { key: "__total", label: L("me_total", "Total"), values: table.total.values, subtotal: true }] : rows;
  const selRow = sel ? allRows.find(r => r.key === sel.r) : null;
  const selCol = sel ? table.columns.find(c => c.key === sel.c) : null;
  const selMeta = selRow && selCol ? selRow.meta?.[selCol.key] ?? null : null;
  const selManual = !!(selRow && selCol && selRow.manual?.[selCol.key]);
  const selLinked = !!(selRow && selCol && selRow.linked?.[selCol.key]);
  const selSource = selLinked ? "vinculado" : selManual ? "manual" : selMeta?.source ?? (selRow?.subtotal || selRow?.code || selRow?.key === "__total" ? "sistema" : "vacia");
  const selKey = selRow && selCol ? cellKey(selRow, selCol) : null;
  const selOwnVar = selRow && selCol ? varKeyOf(selRow, selCol) : null;
  const pick = (r, c) => { if (!r.heading && c.key !== "check") { setSel({ r: r.key, c: c.key }); setLinkOpen(false); } };

  // Teclado: flechas para moverse, Intro para editar, Escape para salir
  const onKeyDown = (e) => {
    if (!sel || editing || linkOpen) return;
    const body = allRows.filter(r => !r.heading);
    const cols = table.columns.filter(c => c.key !== "check");
    const ri = body.findIndex(r => r.key === sel.r);
    const ci = cols.findIndex(c => c.key === sel.c);
    if (ri < 0 || ci < 0) return;
    const move = (dr, dc) => {
      const r = body[Math.max(0, Math.min(body.length - 1, ri + dr))];
      const c = cols[Math.max(0, Math.min(cols.length - 1, ci + dc))];
      setSel({ r: r.key, c: c.key });
      e.preventDefault();
    };
    if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "Enter" && selRow && selCol) { e.preventDefault(); startEdit(selRow, selCol); }
    else if (e.key === "Escape") setSel(null);
  };

  const failing = isMov ? (table.checks ?? []).filter(c => !c.ok && c.year === year) : [];

  return (
    <div ref={wrapRef} className={styles.tableWrap} onKeyDown={onKeyDown} tabIndex={-1}>
      {/* Barra de la celda */}
      <div className={cx(styles.cellBar, sel && styles.cellBarOn)}>
        {isMov && (
          <div className={styles.segTabs}>
            {["cur", "prev"].map(yr => (
              <button key={yr} type="button" className={cx(year === yr && styles.segOn)} onClick={() => { setYear(yr); setSel(null); }}>
                {L("me_year_n", "Ejercicio {y}", { y: table.years?.[yr] ?? "" })}
              </button>
            ))}
          </div>
        )}
        {selRow && selCol ? (
          <>
            <span className={styles.cbWhere} title={`${selRow.label} · ${selCol.label}`}>
              <b>{selRow.label}</b><em>{selCol.label}{isMov && <><i>·</i>{table.years?.[year]}</>}</em>
            </span>
            <span className={cx(styles.cbValue, (selRow.values[selCol.key] ?? 0) < 0 && styles.neg)}>{show(selRow.values[selCol.key] ?? 0, selCol)}</span>
            <span className={cx(styles.srcBadge, styles[`sb_${selSource}`], selMeta?.missing && styles.sb_broken)}>{selMeta?.missing ? L("me_broken_link", "Vínculo roto") : selSource === "vacia" ? L("me_to_fill", "Para rellenar") : SOURCE_LABELS[selSource] ?? SOURCE_LABELS.sistema}</span>
            {selLinked && <span className={styles.cbLink} title={selMeta?.formula}><Link2 size={12} />{selMeta?.link?.type === "acc" ? (selMeta.linkLabel ?? selMeta.formula) : vars[selMeta?.link?.key] ? varPathText(vars[selMeta.link.key]) : selMeta?.link?.key}</span>}
            <span className={styles.cbActions}>
              {editable(selRow, selCol) && selRow.key !== "__total" && (
                <button type="button" className={styles.cbIcon} onClick={() => startEdit(selRow, selCol)} title={L("me_cb_edit_tip", "Escribir el importe (doble clic). También puedes escribir {{variable}} para vincular")}><Pencil size={13} /><span>{L("me_cb_edit", "Editar")}</span></button>
              )}
              {!readOnly && editable(selRow, selCol) && selRow.key !== "__total" && (
                <button type="button" className={cx(linkOpen && styles.cbOn)} title={L("me_cb_link_tip", "Copiar el importe de otra celda de la memoria o del saldo de una cuenta, sin añadir filas")} onClick={() => setLinkOpen(o => !o)}>
                  <Link2 size={13} /><span>{selLinked ? L("me_cb_relink", "Cambiar vínculo") : L("me_cb_link", "Vincular")}</span>
                </button>
              )}
              {selLinked && !readOnly && (
                <button type="button" className={styles.cbIcon} title={L("me_cb_unlink_tip", "Quitar el vínculo y volver al importe calculado")} onClick={() => { unlink(selKey); setLinkOpen(false); }}><Unlink size={13} /><span>{L("me_cb_unlink", "Quitar vínculo")}</span></button>
              )}
              {!readOnly && (
                <button type="button" className={styles.cbPrimary} title={L("me_cb_insert_tip", "Insertar el importe en el texto como variable")} onMouseDown={e => e.preventDefault()} onClick={() => onInsertVar(varKeyOf(selRow, selCol))}>
                  <Braces size={13} /><span>{L("me_cb_insert", "Insertar en el texto")}</span>
                </button>
              )}
              <button type="button" className={styles.cbIcon} title={L("me_cb_where_tip", "¿De dónde sale este importe?")} onClick={() => onExplain({ rowKey: selRow.key, colKey: selCol.key, year: isMov ? year : "cur" }, varKeyOf(selRow, selCol))}><GitBranch size={13} /><span>{L("me_cb_where", "¿De dónde sale?")}</span></button>
              {selManual && !readOnly && (
                <button type="button" className={styles.cbIcon} title={L("me_cb_reset_tip", "Volver al importe calculado")} onClick={() => resetCell(cellKey(selRow, selCol))}><RotateCcw size={13} /><span>{L("me_cb_reset", "Volver al cálculo")}</span></button>
              )}
            </span>
          </>
        ) : (
          <span className={styles.cbHint}><MousePointerClick size={13} /><span>{L("me_cb_hint", "Selecciona una celda para insertarla en el texto o ver de dónde sale. Doble clic para escribir un importe.")}</span></span>
        )}
      </div>

      {linkOpen && selRow && selCol && !readOnly && (
        <LinkDialog vars={vars} accounts={accounts} cfAccounts={cfAccounts} valueAt={valueAt} periodLabels={periodLabels}
          ownKey={selOwnVar} current={note.links?.[selKey] ?? null} cellValue={selRow.values[selCol.key] ?? 0}
          targetParts={[`${L("me_note_n", "Nota {n}", { n: note.number })} · ${note.title}`, selRow.layer && !selRow.subtotal ? LAYERS.find(l => l.id === selRow.layer)?.label : null, selRow.label, selCol.label, isMov ? table.years?.[year] : null].filter(Boolean).map(String)}
          notePrefix={`n${note.number}.`} colKey={selCol.key} isPrev={isMov && year === "prev"}
          plCodes={table.plCodes} rowCode={selRow.code}
          onPick={(link) => { setLink(selKey, link); setLinkOpen(false); }} onClose={() => setLinkOpen(false)} />
      )}

      {failing.length > 0 && (
        <div className={styles.checkBox}>
          {failing.map(c => (
            <button key={c.id} type="button" onClick={() => { if (c.rowKey && rows.some(r => r.key === c.rowKey)) setSel({ r: c.rowKey, c: c.colKey ?? "closing" }); }}>
              <CircleAlert size={14} /><span><b>{c.label}</b>{c.detail}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.tableScroll}>
        <table className={cx(styles.table, isMov && styles.movTable)}>
          <thead>
            <tr>
              <th />
              {table.columns.map(c => (
                <th key={c.key} className={cx(styles.colHead, c.key === "check" && styles.thCheck)}>
                  {!readOnly && c.key !== "check"
                    ? (isMov
                      ? <textarea className={cx(styles.colName, styles.colNameWrap)} rows={c.label.length > 15 ? 2 : 1} value={c.label} onChange={e => renameCol(c, e.target.value.replace(/\n/g, " "))} title={L("me_rename_col", "Cambiar el nombre de la columna")} />
                      : <input className={styles.colName} value={c.label} onChange={e => renameCol(c, e.target.value)} title={COLUMN_SOURCES.find(x => x[0] === c.src)?.[1] ?? ""} />)
                    : c.label}
                  {!readOnly && !isMov && table.columns.length > 1 && (
                    <button type="button" className={styles.colDel} title={L("me_remove_col", "Quitar columna")} onClick={() => removeCol(c)}><X size={10} strokeWidth={3} /></button>
                  )}
                </th>
              ))}
              {!readOnly && <th className={styles.thTools} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={table.columns.length + 2} className={styles.empty}>
                {table.loading ? L("me_calculating", "Calculando…") : isMov ? L("me_empty_mov", "No hay cuentas con saldo en esta nota. Añádelas con «Añadir cuenta».") : L("me_empty_table", "La tabla está vacía. Añade filas manuales o filas con datos de cualquier cuenta.")}
              </td></tr>
            )}
            {rows.map((r, i) => (r.heading ? (
              <tr key={r.key} className={styles.rowLayer} style={{ "--i": Math.min(i, 20) }}>
                <td colSpan={table.columns.length + (readOnly ? 1 : 2)}>{r.label}</td>
              </tr>
            ) : (
              <tr key={r.key} data-row={r.key} style={{ "--i": Math.min(i, 20) }}
                className={cx(r.subtotal && styles.rowSub, r.net && styles.rowNet, (r.extra || (custom && !r.bound)) && styles.rowExtra)}>
                <td className={styles.label}>
                  {!readOnly && !r.subtotal && (r.extra || custom)
                    ? <span className={styles.labelEdit}>{r.code && <span className={styles.code}>{r.code}</span>}<input value={r.label} onChange={e => renameRow(r, e.target.value)} />{r.bound && <Database size={11} className={styles.boundIcon} title={L("me_kind_row", "Fila con datos")} />}</span>
                    : <>{r.code && !r.subtotal && <span className={styles.code}>{r.code}</span>}{r.label}</>}
                </td>
                {table.columns.map(c => {
                  const key = cellKey(r, c);
                  const isEdit = editing === key;
                  const v = r.values[c.key] ?? 0;
                  const on = sel?.r === r.key && sel?.c === c.key;
                  if (c.key === "check") {
                    return (
                      <td key={c.key} className={cx(styles.num, styles.checkCell)}>
                        {r.net ? null : Math.abs(v) < 0.5
                          ? <span className={styles.checkOk}><Check size={12} strokeWidth={3} /></span>
                          : <span className={styles.checkBad} title={L("me_check_formula", "Saldo final − (saldo inicial + movimientos)")}>{fmt(v)}</span>}
                      </td>
                    );
                  }
                  if (blankCell(r, c)) return <td key={c.key} className={styles.num} />;
                  const src = r.manual?.[c.key] ? null : r.meta?.[c.key]?.source;
                  const isLinked = !!r.linked?.[c.key];
                  return (
                    <td key={c.key}
                      className={cx(styles.num, r.manual?.[c.key] && styles.numManual, src && styles[SRC_CLASS[src]], isLinked && r.meta?.[c.key]?.missing && styles.srcBroken, on && styles.cellOn)}
                      title={isLinked ? r.meta?.[c.key]?.formula : undefined}
                      onClick={() => { if (!isEdit) pick(r, c); }}
                      onDoubleClick={() => startEdit(r, c)}>
                      {isEdit ? (
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                          onBlur={() => commit(key)} onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); commit(key); } if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
                      ) : (
                        <span className={cx(styles.val, v < 0 && styles.neg, Math.abs(v) < 0.005 && !isLinked && styles.zero)}>
                          {isLinked && <Link2 size={10} className={styles.linkIcon} />}
                          {show(v, c)}
                          {r.manual?.[c.key] && !readOnly && (
                            <button type="button" className={styles.reset} title={L("me_cb_reset_tip", "Volver al importe calculado")} onClick={e => { e.stopPropagation(); resetCell(key); }}><RotateCcw size={10} /></button>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
                {!readOnly && (
                  <td className={styles.rowTools}>
                    {!r.subtotal && <button type="button" onClick={() => removeRow(r)} title={r.extra || custom ? L("me_remove_row", "Quitar fila") : L("me_hide_row", "Ocultar fila")}><Trash2 size={12} /></button>}
                  </td>
                )}
              </tr>
            )))}
            {table.total && rows.length > 0 && (
              <tr className={styles.rowTotal}>
                <td className={styles.label}>{L("me_total", "Total")}</td>
                {table.columns.map(c => {
                  const on = sel?.r === "__total" && sel?.c === c.key;
                  return (
                    <td key={c.key} className={cx(styles.num, on && styles.cellOn)} onClick={() => setSel({ r: "__total", c: c.key })}>
                      <span className={cx(styles.val, table.total.values[c.key] < 0 && styles.neg)}>{show(table.total.values[c.key] ?? 0, c)}</span>
                    </td>
                  );
                })}
                {!readOnly && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFoot}>
        {!readOnly && <>
          {onAddManual && <button type="button" onClick={onAddManual}><PlusCircle size={13} />{L("me_manual_row", "Fila manual")}</button>}
          <button type="button" onClick={onAddData}><Database size={13} />{isMov ? L("me_add_account", "Añadir cuenta") : L("me_kind_row", "Fila con datos")}</button>
          {(note.hiddenRows ?? []).length > 0 && (
            <button type="button" onClick={() => onPatch({ hiddenRows: [] })}><Eye size={13} />{L("me_show_hidden_rows", "Mostrar {n} filas ocultas", { n: note.hiddenRows.length })}</button>
          )}
        </>}
        {isMov ? (
          <span className={styles.legend}>
            <i className={styles.lgInfer} />{L("me_lg_inferred", "Deducido")}
            <i className={styles.lgCalc} />{L("me_lg_calc", "Calculado para cuadrar")}
            <i className={styles.lgManual} />{L("me_lg_manual", "A mano")}
            <i className={styles.lgLink} />{L("me_lg_linked", "Vinculada")}
          </span>
        ) : (
          <span className={styles.legend}>
            <i className={styles.lgManual} />{L("me_lg_manual", "A mano")}
            <i className={styles.lgLink} />{L("me_lg_linked", "Vinculada")}
            <em>· {L("me_lg_hint", "Clic en una celda para vincularla o escribir un importe")}</em>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Vincular una celda ───────────────────────────────────────────────────
   Ventana centrada. La celda deja de calcularse sola y copia siempre el
   importe que se elija (si el origen cambia, la celda cambia con él):
     · De esta memoria
         - Sugerencias: lo que suele tener que coincidir con esta celda.
         - Otra celda de la memoria: se elige la nota y se pulsa la celda en
           una copia de su tabla (o se busca por nombre en todas las notas).
     · De la contabilidad: saldo de una cuenta de pérdidas y ganancias, de
       balance o de flujos de efectivo, en el periodo y con el signo elegidos.
   Los códigos internos de las variables ({{n5.fila.columna}}) no se enseñan:
   cada importe se describe como nota › grupo › fila › columna › año. */
const linkSources = () => [
  { k: "rec", sec: "memo", label: L("me_lk_rec", "Sugerencias"), desc: L("me_lk_rec_desc", "Lo más habitual para esta celda"), Icon: Sparkles },
  { k: "var", sec: "memo", label: L("me_lk_var", "Otra celda de la memoria"), desc: L("me_lk_var_desc", "Un importe de cualquier nota"), Icon: Table2 },
  { k: "pl", sec: "acc", label: L("me_pl", "Pérdidas y ganancias"), desc: L("me_lk_pl_desc", "Cuentas de resultados"), Icon: TrendingUp },
  { k: "bs", sec: "acc", label: L("me_bs", "Balance"), desc: L("me_lk_bs_desc", "Cuentas de balance"), Icon: Landmark },
  { k: "cf", sec: "acc", label: L("me_cf", "Flujos de efectivo"), desc: L("me_lk_cf_desc", "Partidas del estado de flujos"), Icon: Waves },
];
const linkSections = () => [["memo", L("me_lk_sec_memo", "De esta memoria")], ["acc", L("me_lk_sec_acc", "De la contabilidad")]];
const linkHelp = (k) => ({
  rec: L("me_lk_help_rec", "Lo que normalmente tiene que coincidir con esta celda: la cuenta de resultados que contrasta esta nota, la cuenta de la propia fila, otras filas de la misma columna y los totales de otras notas."),
  var: L("me_lk_help_var", "Elige la nota y pulsa la celda cuyo importe quieres copiar. Si ese importe cambia, esta celda cambia con él."),
  pl: L("me_lk_help_pl", "Saldo de una cuenta de pérdidas y ganancias en el periodo que elijas. Las cuentas en negrita son sumas de las que tienen debajo."),
  bs: L("me_lk_help_bs", "Saldo de una cuenta de balance en el periodo que elijas. Las cuentas en negrita son sumas de las que tienen debajo."),
  cf: L("me_lk_help_cf", "Importe de una partida del estado de flujos de efectivo en el periodo que elijas."),
}[k]);
// Ruta legible de un importe de la memoria: ["Nota 5 · Inmovilizado material", "Amortizaciones", "Construcciones", "Saldo inicial", "2026"]
function varCrumbs(v, { note = true } = {}) {
  const p = v?.parts;
  if (!p) return [v?.label ?? ""];
  return [note && `${L("me_note_n", "Nota {n}", { n: p.noteNumber })} · ${p.noteTitle}`, p.group, p.row, p.col, p.year].filter(Boolean).map(String);
}
const varPathText = (v) => varCrumbs(v).join(" › ");

function Crumbs({ items, className }) {
  return (
    <span className={cx(styles.lkCrumbs, className)}>
      {items.map((c, i) => <span key={i}>{i > 0 && <ChevronRight size={11} />}<i>{c}</i></span>)}
    </span>
  );
}

/* ── Explicaciones de «Vincular celda» ────────────────────────────────────
   Cada tipo de origen tiene un botón (i) que abre aquí mismo una explicación
   completa: qué es, un ejemplo con los datos reales de esta celda (origen →
   tu celda), cuándo usarlo, qué pasa después y qué tener en cuenta. La
   explicación general ("¿Qué es vincular?") sale sola la primera vez. */
const LINK_INTRO_KEY = "konsolidator:mem-link-intro";
const linkExplain = () => ({
  general: {
    eyebrow: L("me_lx_general_eyebrow", "Cómo funciona"), title: L("me_lx_general_title", "¿Qué es vincular una celda?"), Icon: Link2,
    lead: L("me_lx_general_lead", "Normalmente cada celda de la tabla calcula su importe sola con los datos de la contabilidad. Al vincularla le dices: «no calcules nada; copia siempre este otro importe». Desde ese momento la celda va enganchada a su origen."),
    flowNote: L("me_lx_general_flownote", "Ejemplo con esta celda"),
    blocks: [
      [L("me_lx_general_b0", "¿Para qué sirve?"), [
        L("me_lx_general_b0_0", "Cuando el plan de cuentas no separa un dato y está en otra cuenta (por ejemplo, la dotación del año en la 681)."),
        L("me_lx_general_b0_1", "Para que dos notas enseñen siempre la misma cifra sin copiarla a mano."),
        L("me_lx_general_b0_2", "Para usar el saldo de otro periodo, o el de una cuenta con el signo al revés."),
      ]],
      [L("me_lx_general_b1", "Qué pasa después"), [
        L("me_lx_general_b1_0", "La celda queda marcada como «Vinculada» y «¿De dónde sale?» te dice exactamente de dónde viene."),
        L("me_lx_general_b1_1", "Si el origen cambia (otro periodo, nuevos datos, alguien lo edita), la celda cambia sola."),
        L("me_lx_general_b1_2", "El resto de la fila y de la tabla siguen calculándose como siempre."),
        L("me_lx_general_b1_3", "Puedes deshacerlo cuando quieras con «Quitar vínculo»: la celda vuelve a su cálculo."),
      ]],
      [L("me_lx_general_b2", "Las opciones de la izquierda"), [
        L("me_lx_general_b2_0", "Sugerencias: un atajo con lo que más probablemente buscas para esta celda."),
        L("me_lx_general_b2_1", "Otra celda de la memoria: el importe de cualquier celda de cualquier nota."),
        L("me_lx_general_b2_2", "Pérdidas y ganancias, Balance y Flujos de efectivo: el saldo de una cuenta de la contabilidad."),
      ]],
    ],
  },
  rec: {
    eyebrow: L("me_lx_rec_eyebrow", "De esta memoria"), title: L("me_lx_rec_title", "Sugerencias"), Icon: Sparkles,
    lead: L("me_lx_rec_lead", "No es una fuente distinta: es un atajo. Aquí juntamos, sacados de las demás pestañas, los importes que con más probabilidad quieres poner en esta celda, para que no tengas que buscarlos."),
    flowNote: L("me_lx_rec_flownote", "La primera sugerencia para esta celda"),
    blocks: [
      [L("me_lx_rec_b0", "Qué te sugerimos y por qué"), [
        L("me_lx_rec_b0_0", "Cuenta de resultados de esta nota: en inmovilizado, intangibles o deterioros, la dotación del año tiene que coincidir con su cuenta de gasto (681, 680, 691…)."),
        L("me_lx_rec_b0_1", "Cuenta de esta fila: el saldo de la cuenta que ya tiene la fila, por si lo quieres de otro periodo o con el signo cambiado."),
        L("me_lx_rec_b0_2", "Misma columna de esta tabla: otras filas de esta nota en esa misma columna."),
        L("me_lx_rec_b0_3", "Totales de otras notas y datos generales, como el resultado del ejercicio."),
      ]],
      [L("me_lx_rec_b1", "Cuándo usarlo"), [
        L("me_lx_rec_b1_0", "Casi siempre: empieza por aquí. Si lo que buscas no está, ve a «Otra celda de la memoria» o a las cuentas."),
      ]],
    ],
  },
  var: {
    eyebrow: L("me_lx_var_eyebrow", "De esta memoria"), title: L("me_lx_var_title", "Otra celda de la memoria"), Icon: Table2,
    lead: L("me_lx_var_lead", "Copia el importe de una celda de cualquier nota de esta misma memoria, incluida esta nota. La eliges igual que la verías en la nota: escoges la nota en el desplegable y pulsas la celda en su tabla."),
    flowNote: L("me_lx_var_flownote", "Por ejemplo"),
    blocks: [
      [L("me_lx_var_b0", "Cuándo usarlo"), [
        L("me_lx_var_b0_0", "Cuando una cifra tiene que ser la misma en dos notas (un total que aparece en otra nota, un saldo que se repite…)."),
        L("me_lx_var_b0_1", "Cuando una celda debe salir de otra fila ya calculada de la misma tabla."),
      ]],
      [L("me_lx_var_b1", "Qué pasa después"), [
        L("me_lx_var_b1_0", "Si la celda de origen cambia, esta cambia con ella, aunque la hayas escrito a mano."),
        L("me_lx_var_b1_1", "Si la celda de origen desaparece (se quita la fila o la nota), verás «Vínculo roto» y te avisará la revisión."),
      ]],
      [L("me_lx_var_b2", "Ten en cuenta"), [
        L("me_lx_var_b2_0", "No puedes vincular una celda consigo misma: sale marcada como «Esta celda»."),
        L("me_lx_var_b2_1", "En los cuadros de movimientos elige arriba el ejercicio (actual o anterior) antes de pulsar."),
        L("me_lx_var_b2_2", "Con el buscador encuentras celdas de todas las notas a la vez por fila, columna o año."),
      ]],
    ],
  },
  pl: {
    eyebrow: L("me_lx_pl_eyebrow", "De la contabilidad"), title: L("me_lx_pl_title", "Pérdidas y ganancias"), Icon: TrendingUp,
    lead: L("me_lx_pl_lead", "Copia el saldo de una cuenta de la cuenta de resultados, tal como está en Konsolidator para esta sociedad o grupo, en el periodo que elijas."),
    flowNote: L("me_lx_pl_flownote", "Por ejemplo"),
    blocks: [
      [L("me_lx_pl_b0", "Cuándo usarlo"), [
        L("me_lx_pl_b0_0", "Para llevar a la tabla un gasto o ingreso del año: la dotación de amortización (681), un deterioro (691), los arrendamientos (621)…"),
      ]],
      [L("me_lx_pl_b1", "Periodo y signo"), [
        L("me_lx_pl_b1_0", "Elige el periodo arriba: el de la memoria o el mismo mes del año anterior."),
        L("me_lx_pl_b1_1", "Los gastos vienen en negativo en contabilidad. Si en la tabla los quieres en positivo, pulsa «Signo cambiado»."),
      ]],
      [L("me_lx_pl_b2", "Ten en cuenta"), [
        L("me_lx_pl_b2_0", "Las cuentas en negrita son agrupaciones: suman todas las que tienen debajo."),
        L("me_lx_pl_b2_1", "Si la cuenta deja de tener saldo, la celda pasa a 0."),
      ]],
    ],
  },
  bs: {
    eyebrow: L("me_lx_bs_eyebrow", "De la contabilidad"), title: L("me_lx_bs_title", "Balance"), Icon: Landmark,
    lead: L("me_lx_bs_lead", "Copia el saldo de una cuenta de balance (activo, pasivo o patrimonio neto) en el periodo que elijas: el cierre de la memoria o el cierre del año anterior."),
    flowNote: L("me_lx_bs_flownote", "Por ejemplo"),
    blocks: [
      [L("me_lx_bs_b0", "Cuándo usarlo"), [
        L("me_lx_bs_b0_0", "Para un saldo inicial o final que no sale solo: el saldo de la cuenta a diciembre del año anterior es el saldo inicial de este año."),
        L("me_lx_bs_b0_1", "Para traer una cuenta que la nota no incluye por sus etiquetas."),
      ]],
      [L("me_lx_bs_b1", "Periodo y signo"), [
        L("me_lx_bs_b1_0", "El pasivo, el patrimonio neto y las amortizaciones acumuladas suelen venir en negativo. Para verlos en positivo, pulsa «Signo cambiado»."),
      ]],
      [L("me_lx_bs_b2", "Ten en cuenta"), [
        L("me_lx_bs_b2_0", "Las cuentas en negrita son agrupaciones: suman todas las que tienen debajo."),
      ]],
    ],
  },
  cf: {
    eyebrow: L("me_lx_cf_eyebrow", "De la contabilidad"), title: L("me_lx_cf_title", "Flujos de efectivo"), Icon: Waves,
    lead: L("me_lx_cf_lead", "Copia el importe de una partida del estado de flujos de efectivo. No son cuentas del plan, sino las líneas del estado (cobros, pagos, flujos de explotación, de inversión…)."),
    flowNote: L("me_lx_cf_flownote", "Por ejemplo"),
    blocks: [
      [L("me_lx_cf_b0", "Cuándo usarlo"), [
        L("me_lx_cf_b0_0", "Para las notas que piden importes del estado de flujos: pagos por inversiones, cobros por desinversiones, dividendos pagados…"),
      ]],
      [L("me_lx_cf_b1", "Periodo y signo"), [
        L("me_lx_cf_b1_0", "Elige el periodo arriba. Los pagos vienen en negativo; si los quieres en positivo, pulsa «Signo cambiado»."),
      ]],
    ],
  },
});

function LinkExplain({ kind, origin, targetParts, cellValue, sign, onDone, doneLabel }) {
  const ex = linkExplain();
  const e = ex[kind] ?? ex.general;
  const Icon = e.Icon;
  const after = origin?.value == null ? null : origin.value * sign;
  return (
    <div className={styles.lkExplain} key={kind}>
      <div className={styles.lkExHead}>
        <span className={styles.lkExIco}><Icon size={20} /></span>
        <div>
          <p className={styles.lkExEyebrow}>{e.eyebrow}</p>
          <h4 className={styles.lkExTitle}>{e.title}</h4>
        </div>
      </div>
      <p className={styles.lkExLead}>{e.lead}</p>

      {origin && (
        <div className={styles.lkExFlowWrap}>
          <p className={styles.lkExFlowNote}>{e.flowNote}</p>
          <div className={styles.lkExFlow}>
            <div className={styles.lkExCard}>
              <em>{L("me_origin", "Origen")}</em>
              <Crumbs items={origin.crumbs} />
              <b className={cx(origin.value < 0 && styles.neg)}>{origin.value == null ? "…" : fmt(origin.value)}</b>
            </div>
            <div className={styles.lkExArrow} aria-hidden="true">
              <span>{sign === -1 ? L("me_lk_copies_neg", "copia con el signo cambiado") : L("me_lk_copies", "copia")}</span>
              <i><i /></i>
            </div>
            <div className={cx(styles.lkExCard, styles.lkExCardTo)}>
              <em>{L("me_lk_your_cell", "Tu celda")}</em>
              <Crumbs items={targetParts} />
              <b><s>{fmt(cellValue)}</s><ArrowRight size={13} /><span className={cx(after < 0 && styles.neg)}>{after == null ? "…" : fmt(after)}</span></b>
            </div>
          </div>
        </div>
      )}

      <div className={styles.lkExBlocks}>
        {e.blocks.map(([t, items]) => (
          <div key={t} className={styles.lkExBlock}>
            <p>{t}</p>
            <ul>{items.map(it => <li key={it}><Check size={12} strokeWidth={3} /><span>{it}</span></li>)}</ul>
          </div>
        ))}
      </div>
      <div className={styles.lkExFoot}>
        <button type="button" className={styles.primaryBtn} onClick={onDone}>{doneLabel}<ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

function LinkDialog({ vars, accounts, cfAccounts, valueAt, periodLabels, ownKey, current, targetParts, cellValue, notePrefix, colKey, isPrev, plCodes, rowCode, onPick, onClose }) {
  const accType = (a) => (a.type === "B/S" ? "bs" : "pl");
  const curAcc = current?.type === "acc" ? (current.statement === "cf" ? "cf" : accType(accounts.find(a => String(a.code) === String(current.code)) ?? {})) : null;
  const curVarNote = current?.type === "var" ? vars[current.key]?.parts?.noteNumber ?? null : null;
  const ownNote = Number(String(notePrefix).replace(/\D/g, "")) || null;
  const [tab, setTab] = useState(current?.type === "var" ? "var" : curAcc ?? "rec");
  const [q, setQ] = useState("");
  const [sign, setSign] = useState(current?.sign === -1 ? -1 : 1);
  const [pk, setPk] = useState(current?.type === "acc" ? current.pk ?? "cur" : isPrev ? "prevYE" : "cur");
  const [picked, setPicked] = useState(current ? { ...current } : null);
  const [noteSel, setNoteSel] = useState(curVarNote ?? ownNote);
  // Explicación abierta: null | "general" | rec | var | pl | bs | cf (la general sale sola la primera vez)
  const [info, setInfo] = useState(() => { try { return localStorage.getItem(LINK_INTRO_KEY) ? null : "general"; } catch { return null; } });
  const closeInfo = () => { if (info === "general") { try { localStorage.setItem(LINK_INTRO_KEY, "1"); } catch { /* sin almacenamiento */ } } setInfo(null); };
  const [gridYear, setGridYear] = useState(current?.type === "var" ? vars[current.key]?.ref?.year ?? "cur" : isPrev ? "prev" : "cur");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (txt) => words.every(w => txt.toLowerCase().includes(w));
  const periods = Object.entries(periodLabels).filter(([k]) => !(k === "prevSame" && periodLabels.prevSame === periodLabels.prevYE));
  const allNum = useMemo(() => Object.entries(vars).filter(([, v]) => typeof v.value === "number"), [vars]);
  const numVars = useMemo(() => allNum.filter(([k]) => k !== ownKey), [allNum, ownKey]);
  const accVal = (code, statement, p = pk) => valueAt(code, p, statement);
  const sameNote = (k) => k.startsWith(notePrefix);

  // Elementos de las listas: { id, kind: "var" | "acc", título, migas, importe }
  const varItem = ([k, v], { note = true } = {}) => {
    const crumbs = varCrumbs(v, { note });
    return { id: `v:${k}`, kind: "var", key: k, title: v.parts ? crumbs[crumbs.length - (v.parts.year ? 3 : 2)] : v.label ?? k,
      crumbs: v.parts ? crumbs.filter((c, i) => i !== crumbs.length - (v.parts.year ? 3 : 2)) : [], value: v.value, isSum: !!v.parts?.total };
  };
  const stmtLabel = (statement, code) => (statement === "cf" ? L("me_cf", "Flujos de efectivo")
    : accounts.find(a => String(a.code) === String(code))?.type === "B/S" ? L("me_bs", "Balance") : L("me_pl", "Pérdidas y ganancias"));
  const accItem = (a, statement, withCrumbs = false) => ({ id: `a:${statement ?? ""}:${a.code}`, kind: "acc", code: a.code, title: a.name, statement, depth: a.depth ?? 0, isSum: a.isSum,
    crumbs: withCrumbs ? [stmtLabel(statement, a.code), periodLabels[pk]] : [], value: accVal(a.code, statement) });

  // Sugerencias y búsqueda en todas las notas (listas con grupos)
  const groups = useMemo(() => {
    const filt = (l) => l.filter(it => !words.length || match(`${it.title} ${(it.crumbs ?? []).join(" ")} ${it.code ?? ""}`));
    if (tab === "rec") {
      const out = [];
      const plAcc = [...new Set([...(plCodes?.dot ?? []), ...(plCodes?.det ?? [])])].map(c => accounts.find(a => String(a.code) === String(c))).filter(Boolean);
      if (plAcc.length) out.push([L("me_lk_g_pl", "Cuenta de resultados de esta nota"), L("me_lk_g_pl_desc", "La dotación o el deterioro del ejercicio que esta nota tiene que cuadrar con la cuenta de resultados."), plAcc.map(a => accItem(a, null, true))]);
      if (rowCode) { const a = accounts.find(x => String(x.code) === String(rowCode)); if (a) out.push([L("me_lk_g_row", "Cuenta de esta fila"), L("me_lk_g_row_desc", "El saldo contable de la cuenta que ya tiene esta fila, en otro periodo o con otro signo."), [accItem(a, null, true)]]); }
      const sameCol = numVars.filter(([k, v]) => sameNote(k) && v.ref?.colKey === colKey && (v.ref?.year === "prev") === !!isPrev);
      if (sameCol.length) out.push([L("me_lk_g_col", "Misma columna de esta tabla"), L("me_lk_g_col_desc", "Otras filas de esta nota en la misma columna."), sameCol.slice(0, 30).map(e => varItem(e, { note: false }))]);
      const otherTotals = numVars.filter(([k, v]) => /^n\d+\.total\./.test(k) && !sameNote(k) && v.ref?.year !== "prev");
      if (otherTotals.length) out.push([L("me_lk_g_tot", "Totales de otras notas"), L("me_lk_g_tot_desc", "El total de cada columna de las demás notas."), otherTotals.slice(0, 40).map(e => varItem(e))]);
      const gen = numVars.filter(([k]) => !/^n\d+\./.test(k));
      if (gen.length) out.push([L("me_lk_g_gen", "Datos generales"), L("me_lk_g_gen_desc", "Importes generales de la memoria."), gen.map(e => varItem(e))]);
      return out.map(([t, d, l]) => [t, d, filt(l)]).filter(([, , l]) => l.length);
    }
    if (tab === "var") {
      if (!words.length) return [];
      const byNote = new Map();
      numVars.forEach(e => {
        const p = e[1].parts;
        const g = p ? `${L("me_note_n", "Nota {n}", { n: p.noteNumber })} · ${p.noteTitle}` : L("me_lk_g_gen", "Datos generales");
        const it = varItem(e, { note: false });
        if (!match(`${g} ${it.title} ${it.crumbs.join(" ")}`)) return;
        if (!byNote.has(g)) byNote.set(g, []);
        byNote.get(g).push(it);
      });
      return [...byNote.entries()].map(([g, l]) => [g, null, l.slice(0, 60)]);
    }
    const list = tab === "cf" ? cfAccounts : accounts.filter(a => (tab === "bs" ? a.type === "B/S" : a.type !== "B/S"));
    const shown = list.filter(a => !words.length || match(`${a.code} ${a.name}`)).slice(0, 500);
    return [[null, null, shown.map(a => accItem(a, tab === "cf" ? "cf" : a.statement ?? null))]];
  }, [tab, q, pk, numVars, accounts, cfAccounts, plCodes, rowCode, colKey, isPrev, notePrefix, periodLabels]);

  // Notas con importes, y la tabla de la nota elegida (para pulsar la celda)
  const noteList = useMemo(() => {
    const m = new Map();
    allNum.forEach(([, v]) => { const p = v.parts; if (p && !m.has(p.noteNumber)) m.set(p.noteNumber, { number: p.noteNumber, title: p.noteTitle, count: 0 }); if (p) m.get(p.noteNumber).count++; });
    return [...m.values()].sort((a, b) => a.number - b.number);
  }, [allNum]);
  const activeNote = noteList.some(n => n.number === noteSel) ? noteSel : noteList[0]?.number ?? null;
  const grid = useMemo(() => {
    const entries = allNum.filter(([, v]) => v.parts?.noteNumber === activeNote);
    const years = [...new Set(entries.map(([, v]) => v.ref?.year ?? "cur"))];
    const yearLabels = Object.fromEntries(entries.filter(([, v]) => v.parts?.year).map(([, v]) => [v.ref.year, v.parts.year]));
    const yr = years.includes(gridYear) ? gridYear : years[0] ?? "cur";
    const cols = new Map(), rows = new Map(), cells = new Map();
    entries.filter(([, v]) => (v.ref?.year ?? "cur") === yr).forEach(([k, v]) => {
      const rk = v.ref?.rowKey ?? k, ck = v.ref?.colKey ?? k;
      if (!cols.has(ck)) cols.set(ck, v.parts.col);
      if (!rows.has(rk)) rows.set(rk, { key: rk, label: v.parts.row, group: v.parts.group ?? null, total: !!v.parts.total });
      const id = `${rk}|${ck}`;
      if (!cells.has(id)) cells.set(id, [k, v]);   // el primero gana: n5.net… antes que n5.total…
    });
    return { years, yearLabels, yr, cols: [...cols.entries()], rows: [...rows.values()], cells };
  }, [allNum, activeNote, gridYear]);

  const toLink = (it) => (it.kind === "var"
    ? { type: "var", key: it.key, sign }
    : { type: "acc", code: it.code, name: it.title, pk, statement: it.statement ?? null, sign });
  const isOn = (it) => picked && (it.kind === "var"
    ? picked.type === "var" && picked.key === it.key
    : picked.type === "acc" && String(picked.code) === String(it.code) && (picked.statement ?? null) === (it.statement ?? null));
  const pickedValue = picked ? (picked.type === "var" ? vars[picked.key]?.value ?? null : accVal(picked.code, picked.statement, pk)) : null;
  const pickedCrumbs = !picked ? []
    : picked.type === "var" ? (vars[picked.key] ? varCrumbs(vars[picked.key]) : [picked.key])
    : [stmtLabel(picked.statement, picked.code), `${picked.code} · ${picked.name ?? accounts.find(a => String(a.code) === String(picked.code))?.name ?? ""}`, periodLabels[pk]];
  const confirm = (link) => { if (link) onPick({ ...link, sign, ...(link.type === "acc" ? { pk } : {}) }); };
  const showPeriods = tab === "pl" || tab === "bs" || tab === "cf" || (tab === "rec" && picked?.type === "acc");
  const counts = { var: numVars.length, pl: accounts.filter(a => a.type !== "B/S").length, bs: accounts.filter(a => a.type === "B/S").length, cf: cfAccounts.length };
  const placeholder = { rec: L("me_lk_ph_rec", "Filtrar sugerencias"), var: L("me_lk_ph_var", "Buscar en todas las notas: fila, columna, año…"), pl: L("me_lk_ph_acc", "Buscar cuenta por código o nombre"), bs: L("me_lk_ph_acc", "Buscar cuenta por código o nombre"), cf: L("me_lk_ph_cf", "Buscar partida por código o nombre") }[tab];
  const showGrid = tab === "var" && !words.length;

  // Ejemplo real para cada explicación: un origen posible → esta celda
  const accEx = (a, statement) => (a ? { crumbs: [stmtLabel(statement, a.code), `${a.code} · ${a.name}`, periodLabels[pk]], value: accVal(a.code, statement) } : null);
  const varEx = (e) => (e ? { crumbs: varCrumbs(e[1]), value: e[1].value } : null);
  const findAcc = (code) => accounts.find(a => String(a.code) === String(code));
  const leaf = (list) => list.find(a => !a.isSum) ?? list[0];
  const plEx = () => { const c = [...(plCodes?.dot ?? []), ...(plCodes?.det ?? [])].map(findAcc).find(Boolean); return accEx(c ?? leaf(accounts.filter(a => a.type !== "B/S")), null); };
  const bsEx = () => { const r = findAcc(rowCode); return accEx(r?.type === "B/S" ? r : leaf(accounts.filter(a => a.type === "B/S")), null); };
  const recEx = () => {
    const c = [...(plCodes?.dot ?? []), ...(plCodes?.det ?? [])].map(findAcc).find(Boolean) ?? findAcc(rowCode);
    if (c) return accEx(c, null);
    return varEx(numVars.find(([k, v]) => sameNote(k) && v.ref?.colKey === colKey) ?? numVars[0]);
  };
  const example = (kind) => ({
    general: recEx, rec: recEx,
    var: () => varEx(numVars.find(([k, v]) => !sameNote(k) && v.parts?.total && v.ref?.year !== "prev") ?? numVars.find(([, v]) => v.parts) ?? null),
    pl: plEx, bs: bsEx,
    cf: () => accEx(leaf(cfAccounts), "cf"),
  }[kind] ?? (() => null))();
  const sources = linkSources();
  const srcLabel = (k) => sources.find(x => x.k === k)?.label ?? "";

  const itemButton = (it) => {
    const v = it.value == null ? null : it.value * sign;
    return (
      <button key={it.id} type="button" className={cx(styles.pickItem, styles.lkItem, isOn(it) && styles.pickOn)}
        style={it.kind === "acc" && tab !== "rec" ? { paddingLeft: 12 + Math.min(it.depth, 6) * 14 } : undefined}
        onClick={() => setPicked(toLink(it))} onDoubleClick={() => confirm(toLink(it))}
        title={it.kind === "var" ? `${L("me_lk_use_in_text", "Para usarlo en un texto")}: {{${it.key}}}` : undefined}>
        {it.kind === "acc"
          ? <span className={styles.pickCode}>{it.code}</span>
          : <span className={styles.lkVarDot}><Table2 size={12} /></span>}
        <span className={styles.lkText}>
          <b className={cx(it.isSum && styles.pickSum)}>{it.title}</b>
          {it.crumbs?.length > 0 && <Crumbs items={it.crumbs} />}
        </span>
        <span className={cx(styles.pickVal, v < 0 && styles.neg)}>{v == null ? "…" : fmt(v)}</span>
      </button>
    );
  };

  return (
    <Overlay onClose={onClose}>
      <div className={cx(styles.modal, styles.linkModal)} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={L("me_lk_title", "Vincular celda")}>
        <div className={styles.modalHead}>
          <div>
            <h3 className={styles.lkTitle}><Link2 size={17} />{L("me_lk_title", "Vincular celda")}
              <button type="button" className={cx(styles.lkHowBtn, info === "general" && styles.lkHowOn)} onClick={() => setInfo(i => (i === "general" ? null : "general"))}>
                <Info size={13} />{L("me_lk_how", "¿Cómo funciona?")}
              </button>
            </h3>
            <p>{L("me_lk_intro", "La celda dejará de calcularse sola y copiará siempre el importe que elijas aquí. Si el origen cambia, la celda se actualiza. El resto de la fila no cambia.")}</p>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label={L("me_close", "Cerrar")}><X size={16} /></button>
        </div>
        <div className={styles.lkTarget}>
          <span className={styles.lkTargetTag}>{L("me_lk_cell", "Celda")}</span>
          <Crumbs items={targetParts} className={styles.lkTargetPath} />
          <span className={styles.lkNow}><em>{L("me_lk_now", "Ahora")}</em><b className={cx(cellValue < 0 && styles.neg)}>{fmt(cellValue)}</b></span>
        </div>
        <div className={styles.lkBody}>
          <nav className={styles.lkNav} aria-label={L("me_lk_nav_aria", "De dónde tomar el importe")}>
            {linkSections().map(([sec, secLabel]) => (
              <div key={sec} className={styles.lkNavSec}>
                <p className={styles.lkNavHead}>{secLabel}</p>
                {sources.filter(s => s.sec === sec).map(({ k, label, desc, Icon }) => (
                  <div key={k} className={cx(styles.lkNavRow, tab === k && styles.lkNavOn)}>
                    <button type="button" className={styles.lkNavItem} onClick={() => { setTab(k); setQ(""); closeInfo(); }} aria-pressed={tab === k}>
                      <span className={styles.lkNavIco}><Icon size={15} /></span>
                      <span className={styles.lkNavTxt}><b>{label}</b><em>{desc}</em></span>
                      {counts[k] != null && <i>{counts[k]}</i>}
                    </button>
                    <button type="button" className={cx(styles.lkNavInfo, info === k && styles.lkNavInfoOn)}
                      onClick={() => { setTab(k); setQ(""); setInfo(i => (i === k ? null : k)); }}
                      aria-label={L("me_lk_what_is", "Qué es «{x}»", { x: label })} title={L("me_lk_what_is_q", "¿Qué es «{x}»?", { x: label })}>
                      <Info size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <section className={styles.lkMain}>
            {info ? (
              <LinkExplain kind={info} origin={example(info)} targetParts={targetParts} cellValue={cellValue} sign={sign}
                onDone={closeInfo} doneLabel={info === "general" ? L("me_lk_got_it", "Entendido, elegir el origen") : L("me_lk_see", "Ver: {x}", { x: srcLabel(info) })} />
            ) : <>
            <p className={styles.lkHelp}><Info size={14} /><span>{linkHelp(tab)} <button type="button" className={styles.lkMore} onClick={() => setInfo(tab)}>{L("me_lk_more", "Más información")}</button></span></p>
            <div className={styles.lkTools}>
              <label className={styles.pickSearch}><Search size={14} />
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
                {q && <button type="button" className={styles.lkClear} onClick={() => setQ("")} aria-label={L("me_clear_search", "Borrar búsqueda")}><X size={13} /></button>}
              </label>
              <button type="button" className={cx(styles.lpSign, sign === -1 && styles.lpSignOn)} onClick={() => setSign(x => -x)}
                title={sign === -1 ? L("me_lk_sign_neg_tip", "Se copiará el importe con el signo cambiado (p. ej. 500 → −500)") : L("me_lk_sign_tip", "Se copiará el importe tal cual. Pulsa para cambiarle el signo")}>
                <ArrowUpDown size={13} />{sign === -1 ? L("me_lk_sign_neg", "Signo cambiado") : L("me_lk_sign_same", "Mismo signo")}
              </button>
            </div>
            {showPeriods && (
              <div className={styles.lkPeriods}>
                <span>{L("me_lk_period", "Periodo del saldo")}</span>
                <div className={styles.segTabs}>
                  {periods.map(([k, l]) => <button key={k} type="button" className={cx(pk === k && styles.segOn)} onClick={() => setPk(k)}>{l}</button>)}
                </div>
              </div>
            )}
            {showGrid ? (
              <div className={styles.lkGridArea}>
                <div className={styles.lkGridTools}>
                  <label className={styles.lkNoteSel}>
                    <FileText size={14} />
                    <select value={activeNote ?? ""} onChange={e => setNoteSel(Number(e.target.value))} aria-label={L("me_lk_note", "Nota")}>
                      {noteList.map(n => <option key={n.number} value={n.number}>{L("me_note_n", "Nota {n}", { n: n.number })} · {n.title}{n.number === ownNote ? ` (${L("me_lk_this_note", "esta nota")})` : ""}</option>)}
                    </select>
                    <ChevronDown size={14} />
                  </label>
                  {grid.years.length > 1 && (
                    <div className={styles.segTabs}>
                      {grid.years.map(yk => <button key={yk} type="button" className={cx(grid.yr === yk && styles.segOn)} onClick={() => setGridYear(yk)}>{grid.yearLabels[yk] ? L("me_year_n", "Ejercicio {y}", { y: grid.yearLabels[yk] }) : yk === "prev" ? L("me_col_prev", "Ejercicio anterior") : L("me_col_cur", "Ejercicio actual")}</button>)}
                    </div>
                  )}
                </div>
                {grid.rows.length === 0 ? <p className={styles.lpEmpty}>{L("me_lk_note_empty", "Esta nota no tiene importes.")}</p> : (
                  <div className={styles.lkGridScroll}>
                    <table className={styles.lkGrid}>
                      <thead><tr><th />{grid.cols.map(([ck, cl]) => <th key={ck}>{cl}</th>)}</tr></thead>
                      <tbody>
                        {grid.rows.map((r, i) => {
                          const head = r.group && r.group !== grid.rows[i - 1]?.group;
                          return [
                            head && <tr key={`g~${r.key}`} className={styles.lkGridGroup}><td colSpan={grid.cols.length + 1}><span>{r.group}</span></td></tr>,
                            <tr key={r.key} className={cx(r.total && styles.lkGridTot)}>
                              <th scope="row" title={r.label}>{r.label}</th>
                              {grid.cols.map(([ck]) => {
                                const e = grid.cells.get(`${r.key}|${ck}`);
                                if (!e) return <td key={ck} />;
                                const [k, v] = e;
                                if (k === ownKey) return <td key={ck}><span className={styles.lkGridOwn}>{L("me_lk_this_cell", "Esta celda")}</span></td>;
                                const it = { kind: "var", key: k };
                                const val = v.value * sign;
                                return (
                                  <td key={ck}>
                                    <button type="button" className={cx(styles.lkCell, isOn(it) && styles.lkCellOn, val < 0 && styles.neg)}
                                      onClick={() => setPicked(toLink(it))} onDoubleClick={() => confirm(toLink(it))}
                                      title={`${varPathText(v)}\n${L("me_lk_use_in_text", "Para usarlo en un texto")}: {{${k}}}`}>
                                      {fmt(val)}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>,
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.lkList}>
                {groups.length === 0 && <p className={styles.lpEmpty}>{L("me_no_match", "No hay nada que coincida.")}</p>}
                {groups.map(([title, desc, list]) => (
                  <div key={title ?? "all"}>
                    {title && <p className={styles.lpGroup}>{title}</p>}
                    {desc && <p className={styles.lkGroupDesc}>{desc}</p>}
                    {list.map(itemButton)}
                  </div>
                ))}
              </div>
            )}
            </>}
          </section>
        </div>
        <div className={styles.modalFoot}>
          <div className={styles.lkPreview}>
            {picked ? (
              <>
                <span className={styles.lkPrevTag}>{L("me_origin", "Origen")}</span>
                <Crumbs items={[...pickedCrumbs, ...(sign === -1 ? [L("me_lk_sign_neg_low", "signo cambiado")] : [])]} className={styles.lkPrevPath} />
                <b className={cx(pickedValue * sign < 0 && styles.neg)}>{pickedValue == null ? "…" : fmt(pickedValue * sign)}</b>
              </>
            ) : <span className={styles.lkPrevHint}><MousePointerClick size={14} />{L("me_lk_pick_hint", "Elige un importe. Con doble clic se vincula directamente.")}</span>}
          </div>
          <div className={styles.lkActions}>
            <button type="button" className={styles.lkCancel} onClick={onClose}>{L("me_cancel", "Cancelar")}</button>
            <button type="button" className={styles.primaryBtn} disabled={!picked} onClick={() => confirm(picked)}><Link2 size={14} />{L("me_lk_title", "Vincular celda")}</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

/* ── ¿De dónde sale este importe? ─────────────────────────────────────── */
function CellSource({ info, note, years, varKey, onGoCell, onClose }) {
  const partsTotal = (info.parts ?? []).reduce((s, p) => s + (Number(p.value) || 0), 0);
  const isNum = typeof info.value === "number";
  return (
    <Overlay onClose={onClose}>
      <div className={cx(styles.modal, styles.srcModal)} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={L("me_src_aria", "De dónde sale el importe")}>
        <div className={styles.modalHead}>
          <div>
            <h3><GitBranch size={16} />{L("me_cb_where", "¿De dónde sale?")}</h3>
            <p>{note ? `${note.title} · ` : ""}{info.rowLabel}{info.colLabel ? ` · ${info.colLabel}` : ""}{info.year && years ? ` · ${years[info.year]}` : ""}</p>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.srcBody}>
          <div className={styles.srcTop}>
            <span className={cx(styles.srcValue, isNum && info.value < 0 && styles.neg)}>{isNum ? fmt(info.value) : String(info.value ?? "")}</span>
            <span className={cx(styles.srcBadge, styles[`sb_${info.source}`])}>{SOURCE_LABELS[info.source] ?? SOURCE_LABELS.sistema}</span>
          </div>
          {info.formula && <p className={styles.srcFormula}><Scale size={14} />{info.formula}</p>}
          {info.systemValue !== undefined && isNum && Math.abs(info.systemValue - info.value) > 0.005 && (
            <p className={styles.srcNote}>{info.source === "vinculado" ? L("me_src_from_link", "Importe tomado del vínculo. Sin el vínculo, el sistema daría") : L("me_src_by_hand", "Importe escrito a mano. Sin él, el sistema daría")} <b>{fmt(info.systemValue)}</b>.</p>
          )}
          {info.source === "inferido" && (
            <p className={styles.srcNote}>{L("me_src_inferred", "El plan de cuentas no separa altas y bajas: el importe se ha deducido de la variación de los saldos. Si hubo altas y bajas en el mismo año, escribe una de las dos y la otra se calcula sola para cuadrar.")}</p>
          )}
          {(info.parts ?? []).length > 0 && (
            <table className={styles.srcTable}>
              <thead><tr><th>{L("me_account", "Cuenta")}</th><th>{L("me_amount", "Importe")}</th></tr></thead>
              <tbody>
                {info.parts.map((p, i) => (
                  <tr key={`${p.code ?? ""}-${i}`}>
                    <td>{p.code && <span className={styles.code}>{p.code}</span>}{p.name}</td>
                    <td className={cx(styles.num, p.value < 0 && styles.neg)}>{fmt(p.value)}</td>
                  </tr>
                ))}
                {info.parts.length > 1 && (
                  <tr className={styles.srcTotal}><td>{L("me_total", "Total")}</td><td className={cx(styles.num, partsTotal < 0 && styles.neg)}>{fmt(partsTotal)}</td></tr>
                )}
              </tbody>
            </table>
          )}
          {(varKey || onGoCell) && (
            <div className={styles.srcFoot}>
              {varKey && <p className={styles.srcKey}>{L("me_variable", "Variable")} <code>{`{{${varKey}}}`}</code></p>}
              {onGoCell && <button type="button" className={styles.srcGo} onClick={onGoCell}><Table2 size={13} />{L("me_src_go", "Ver en la tabla")}</button>}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}
