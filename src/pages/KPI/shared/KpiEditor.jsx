/* ══════════════════════════════════════════════════════════════════════
   Editor de KPIs compartido (individual y consolidado)

   Dos pantallas en el mismo diálogo:
     · Biblioteca: KPIs predefinidos por familia y KPIs personalizados del
       equipo, con búsqueda, filtros y acciones (añadir, duplicar, editar,
       eliminar).
     · Asistente paso a paso para crear o editar un KPI:
         1. Identidad  — nombre, categoría, descripción, etiqueta, tipo
         2. Fórmula    — plantillas o constructor + "¿Cómo funciona?"
         3. Reglas     — benchmarks y variaciones, cada uno con su explicación

   Lo que depende de cada página (constructor de fórmulas, selector de
   cuentas, plantillas, secciones de la biblioteca) llega por props, así el
   editor es el mismo en las dos páginas.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Check, ChevronLeft, ChevronRight, Search, Plus, Copy, Edit3, Trash2, RotateCcw,
  Library, Sparkles, Sigma, Tag, Building2, Layers, Info, Play, Droplets, Landmark,
  TrendingUp, Gauge, LineChart as LineIcon, Wand2, Calculator, ShieldCheck, GitBranch, Clock,
} from "lucide-react";
import { useSettings, useLocale } from "../../../components/layout/SettingsContext";
import { useKpiText } from "./kpiText.js";
import k from "./kpiShared.module.css";

const cx = (...a) => a.filter(Boolean).join(" ");

const FMT_META = {
  currency: { short: "€", key: "fmt_currency" },
  percent:  { short: "%", key: "fmt_percent" },
  number:   { short: "#", key: "fmt_number" },
};

const SECTION_ICON = { liquidez: Droplets, solvencia: Landmark, rentabilidad: TrendingUp, eficiencia: Gauge, mercado: LineIcon };
const SECTION_TONE = { liquidez: "#0f9f6e", solvencia: "#2563eb", rentabilidad: "#1a2f8a", eficiencia: "#d97706", mercado: "#be185d" };

const BASE_CATEGORIES = ["Liquidez", "Solvencia", "Rentabilidad", "Eficiencia", "Mercado"];

// ── Fórmula guardada → formato de texto del constructor ────────────────
function toTextFormula(f) {
  if (!f) return null;
  if (f.type === "text") return f;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const astToText = (node) => {
    if (!node) return { expr: "0", vars: {} };
    if (node.type === "cc") return { expr: "A", vars: { A: { type: "cc", tag: node.tag } } };
    if (node.type === "ref") return { expr: "A", vars: { A: { type: "ref", kpiId: node.kpiId } } };
    if (node.type === "manual") return { expr: String(node.value ?? 0), vars: {} };
    if (node.type === "account") return { expr: "A", vars: { A: { type: "account", accountCode: node.accountCode } } };
    if (node.type === "accountGroup") return { expr: "A", vars: { A: { type: "accountGroup", prefix: node.prefix } } };
    if (node.type === "op") {
      const l = astToText(node.left);
      const r = astToText(node.right);
      const sym = { "+": "+", "-": "-", "*": "*", "/": "/" }[node.op] ?? node.op;
      const used = new Set(Object.keys(l.vars));
      const map = {};
      const remap = {};
      Object.entries(r.vars).forEach(([letter, val]) => {
        let nl = letter;
        if (used.has(letter)) nl = letters.find(x => !used.has(x) && !Object.values(map).includes(x)) ?? letter;
        used.add(nl);
        map[letter] = nl;
        remap[nl] = val;
      });
      const rExpr = r.expr.replace(/[A-Z]/g, m => map[m] ?? m);
      return { expr: `(${l.expr} ${sym} ${rExpr})`, vars: { ...l.vars, ...remap } };
    }
    if (node.type === "fn") {
      const inner = astToText(node.arg);
      if (node.fn === "neg") return { expr: `-(${inner.expr})`, vars: inner.vars };
      if (node.fn === "abs") return { expr: `Math.abs(${inner.expr})`, vars: inner.vars };
      if (node.fn === "pct") return { expr: `(${inner.expr}) * 100`, vars: inner.vars };
      return inner;
    }
    return { expr: "0", vars: {} };
  };
  const { expr, vars } = astToText(f);
  return { type: "text", expression: expr, variables: vars };
}

function validateFormula(f) {
  if (!f) return "No hay fórmula definida.";
  if (f.type === "text") {
    const unassigned = Object.entries(f.variables ?? {}).filter(([, v]) => !v).map(([x]) => x);
    if (unassigned.length > 0) return `Variables sin asignar: ${unassigned.join(", ")}`;
    if (!f.expression?.trim()) return "La expresión está vacía.";
    try {
      let expr = f.expression;
      Object.keys(f.variables ?? {}).forEach(letter => { expr = expr.replaceAll(letter, "(1)"); });
      Function(`"use strict"; return (${expr})`)();
    } catch (e) {
      return `Expresión inválida: ${e.message}`;
    }
    const used = [...String(f.expression ?? "").replace(/Math\.[a-z]+/g, "").matchAll(/[A-Z]/g)].map(m => m[0]);
    const defined = new Set(Object.keys(f.variables ?? {}));
    const missing = [...new Set(used)].filter(x => !defined.has(x));
    if (missing.length > 0) return `Letras sin mapear: ${missing.join(", ")}`;
  }
  return null;
}

// Expresión bonita: × ÷ − y letras resaltadas
function ExprView({ expression, small = false }) {
  const pretty = String(expression ?? "").replace(/Math\.abs/g, "abs").replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");
  return (
    <span className={cx(k.expr, small && k.exprSmall)}>
      {pretty.split(/([A-Z])/).map((part, i) => (/^[A-Z]$/.test(part)
        ? <b key={i} className={k.exprLetter}>{part}</b>
        : <span key={i}>{part}</span>))}
    </span>
  );
}

function FmtBadge({ format, kt }) {
  const m = FMT_META[format] ?? FMT_META.number;
  return <span className={cx(k.fmtBadge, k[`fmt_${format}`])} title={kt(m.key)}>{m.short}</span>;
}

// ════════════════════════════════════════════════════════════════════════
// Editor
// ════════════════════════════════════════════════════════════════════════
export default function KpiEditor({
  kpi, onSave, onClose, onReset, onEditLibraryKpi, onDeleteLibraryKpi, onDuplicate,
  allLocalKpis = [], systemKpis = [], builtInIds = new Set(), currentUserId,
  librarySections = [], presets = [],
  variationCompanies = [], companyLabelsMap = new Map(), variationDimensions = [],
  initialVariations = null,
  describeNode = (n) => n?.type ?? "",
  renderFormulaBuilder, renderSlotPicker,
  formatValue,
}) {
  const { colors } = useSettings();
  const locale = useLocale();
  const kt = useKpiText(locale);
  const primary = colors?.primary ?? "#1a2f8a";

  const [mode, setMode] = useState(kpi ? "wizard" : "library");
  const [libTab, setLibTab] = useState("presets");

  // ── Datos del KPI ──
  const [label, setLabel] = useState(kpi?.label ?? "");
  const [description, setDescription] = useState(kpi?.description ?? "");
  const [format, setFormat] = useState(kpi?.format ?? "currency");
  const [category, setCategory] = useState(kpi?.category ?? "");
  const [customCategoryLabel, setCustomCategoryLabel] = useState("");
  // Las etiquetas internas ("__library__", "__override__:…") no se muestran,
  // pero se conservan al guardar si el usuario no escribe otra.
  const internalTag = typeof kpi?.tag === "string" && kpi.tag.startsWith("__") ? kpi.tag : null;
  const [tag, setTag] = useState(kpi?.tag && !internalTag ? kpi.tag : "");
  const [formula, setFormula] = useState(() => toTextFormula(kpi?.formula));
  const [formulaTab, setFormulaTab] = useState(kpi ? "builder" : "templates");
  // KPI predefinido que se abre en el asistente (para asignar lo que falta)
  const [seed, setSeed] = useState(null);       // { missing: [{ letter, ingredient }], startStep }
  const [benchmark, setBenchmark] = useState(() => {
    const b = kpi?.benchmark && typeof kpi.benchmark === "object" ? kpi.benchmark : null;
    return {
      unhealthy: { min: b?.unhealthy?.min ?? "", max: b?.unhealthy?.max ?? "" },
      healthy:   { min: b?.healthy?.min ?? "",   max: b?.healthy?.max ?? "" },
      vhealthy:  { min: b?.vhealthy?.min ?? "",  max: b?.vhealthy?.max ?? "" },
    };
  });
  const [variations, setVariations] = useState(() => {
    const v = initialVariations ?? kpi?.variations ?? null;
    return v && (v.byCompany || v.byDimension) ? { byCompany: v.byCompany ?? {}, byDimension: v.byDimension ?? {} } : { byCompany: {}, byDimension: {} };
  });
  const [rulesTab, setRulesTab] = useState("bench");
  const [varTab, setVarTab] = useState("companies");
  const [expanded, setExpanded] = useState(null);
  const [slotCtx, setSlotCtx] = useState(null);

  // ── Avisos ──
  const [dupe, setDupe] = useState(false);
  const [formulaWarning, setFormulaWarning] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const setOverride = (scope, key, letter, node) => {
    setVariations(prev => {
      const bucket = scope === "company" ? "byCompany" : "byDimension";
      const next = { ...prev, [bucket]: { ...prev[bucket] } };
      const entry = { ...(next[bucket][key] ?? {}) };
      if (node) entry[letter] = node; else delete entry[letter];
      if (Object.keys(entry).length > 0) next[bucket][key] = entry; else delete next[bucket][key];
      return next;
    });
  };
  const letters = useMemo(() => (formula?.type === "text" ? Object.keys(formula.variables ?? {}) : []), [formula]);
  // Variaciones podadas: si una letra desaparece de la fórmula, sus cambios también
  const pruned = useMemo(() => {
    const valid = new Set(letters);
    const clean = (bucket) => {
      const out = {};
      Object.entries(bucket ?? {}).forEach(([key, ls]) => {
        const f = {};
        Object.entries(ls ?? {}).forEach(([l, node]) => { if (valid.has(l)) f[l] = node; });
        if (Object.keys(f).length) out[key] = f;
      });
      return out;
    };
    return { byCompany: clean(variations.byCompany), byDimension: clean(variations.byDimension) };
  }, [variations, letters]);
  const variationCount = Object.values(pruned.byCompany).reduce((a, m) => a + Object.keys(m).length, 0)
    + Object.values(pruned.byDimension).reduce((a, m) => a + Object.keys(m).length, 0);

  const otherKpis = useMemo(() => {
    const seen = new Set();
    const out = [];
    [...(systemKpis ?? []), ...(allLocalKpis ?? [])].forEach(x => { if (x.id !== kpi?.id && !seen.has(x.id)) { seen.add(x.id); out.push(x); } });
    return out;
  }, [systemKpis, allLocalKpis, kpi?.id]);

  // Las referencias a otros KPIs se describen con su nombre, no con "KPI ref"
  const describeAny = (n) => {
    if (n?.type === "ref") return otherKpis.find(x => x.id === n.kpiId)?.label ?? (systemKpis ?? []).find(x => x.id === n.kpiId)?.label ?? n.kpiId;
    return describeNode(n);
  };
  const finalCategory = category === "__custom__" ? (customCategoryLabel || "Custom") : category;
  const payload = () => ({
    label: label.trim(), description, format, tag: tag.trim() || internalTag || "", benchmark,
    category: finalCategory, formula, variations: pruned,
  });
  const save = () => {
    const labels = new Set([...(allLocalKpis ?? []).map(x => x.label), ...(systemKpis ?? []).map(x => x.label)]);
    if (kpi) labels.delete(kpi.label);
    const lower = label.trim().toLowerCase();
    if ([...labels].some(l => String(l).toLowerCase() === lower)) { setDupe(true); return; }
    const err = validateFormula(formula);
    if (err) { setFormulaWarning(err); return; }
    onSave(payload());
  };
  const requestClose = () => (mode === "wizard" ? setConfirmClose(true) : onClose());

  // Predefinido → asistente con todo relleno; empieza en la fórmula si falta algo
  const openPresetInWizard = (x) => {
    const b = x.benchmark && typeof x.benchmark === "object" ? x.benchmark : null;
    setLabel(x.label ?? "");
    setDescription(x.description ?? "");
    setFormat(x.format ?? "number");
    setCategory(x.category ?? "");
    setTag("");
    setFormula(toTextFormula(x.formula));
    setBenchmark({
      unhealthy: { min: b?.unhealthy?.min ?? "", max: b?.unhealthy?.max ?? "" },
      healthy:   { min: b?.healthy?.min ?? "",   max: b?.healthy?.max ?? "" },
      vhealthy:  { min: b?.vhealthy?.min ?? "",  max: b?.vhealthy?.max ?? "" },
    });
    setFormulaTab("builder");
    const missing = x._preset?.missing ?? [];
    setSeed({ missing, startStep: missing.length ? 1 : 0 });
    setMode("wizard");
  };
  // Añadir un predefinido:
  //   · el KPI del sistema ya da valor → se añade ese
  //   · la fórmula se ha podido montar → se crea un KPI con ella
  //   · le falta alguna cuenta → asistente para asignarla
  const addPreset = (x) => {
    const p = x._preset;
    if (!p) return onSave({ ...x, _fromLibrary: true });
    if (p.status === "setup") return openPresetInWizard(x);
    if (p.systemId) return onSave({ id: p.systemId, _fromLibrary: true, label: x.label });
    return onSave({
      label: x.label, description: x.description ?? "", format: x.format, tag: "",
      category: x.category ?? "", formula: x.formula, benchmark: x.benchmark ?? null, variations: null,
    });
  };

  // Escape cierra (o pregunta en el asistente)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (slotCtx || dupe || formulaWarning || confirmClose) return;
      if (mode === "wizard") setConfirmClose(true); else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <div className={k.overlay} onMouseDown={requestClose} style={{ "--k-primary": primary }}>
      <div className={cx(k.dialog, mode === "library" ? k.dialogLib : k.dialogWz)} role="dialog" aria-modal="true"
        onMouseDown={e => e.stopPropagation()}>
        {mode === "library" ? (
          <LibraryView kt={kt} tab={libTab} setTab={setLibTab} sections={librarySections}
            customKpis={allLocalKpis} currentUserId={currentUserId}
            onClose={onClose}
            onCreate={() => setMode("wizard")}
            onPick={(x) => onSave(x)}
            onAddPreset={addPreset} onCustomizePreset={openPresetInWizard} formatValue={formatValue}
            onDuplicate={onDuplicate} onEdit={onEditLibraryKpi} onDelete={onDeleteLibraryKpi} />
        ) : (
          <Wizard kt={kt} kpi={kpi} builtInIds={builtInIds} initialStep={seed?.startStep ?? 0}
            onClose={requestClose} onFinish={save}
            onBackToLibrary={kpi ? null : () => setMode("library")}
            footExtra={kpi?._isOverridden && onReset ? (
              <button type="button" className={k.btnDangerGhost} onClick={() => { onReset(kpi.id); onClose(); }}>
                <RotateCcw size={13} /> {kt("wz_reset")}
              </button>
            ) : null}
            steps={[
              {
                id: "identity", icon: Tag, title: kt("s1_title"), rail: kt("s1_rail"), hint: kt("s1_hint"),
                valid: label.trim().length > 0,
                summary: label.trim() ? [label.trim(), finalCategory].filter(Boolean).join(" · ") : null,
                content: (
                  <IdentityStep kt={kt} label={label} setLabel={setLabel} description={description} setDescription={setDescription}
                    category={category} setCategory={setCategory} customCategoryLabel={customCategoryLabel} setCustomCategoryLabel={setCustomCategoryLabel}
                    tag={tag} setTag={setTag} format={format} setFormat={setFormat} allLocalKpis={allLocalKpis} finalCategory={finalCategory} />
                ),
              },
              {
                id: "formula", icon: Calculator, title: kt("s2_title"), rail: kt("s2_rail"), hint: kt("s2_hint"),
                valid: !!formula && (formula.type !== "text" || !!String(formula.expression ?? "").trim()),
                summary: formula?.type === "text" && formula.expression ? <ExprView expression={formula.expression} small /> : null,
                content: (
                  <FormulaStep kt={kt} isEdit={!!kpi} missing={seed?.missing} tab={formulaTab} setTab={setFormulaTab} presets={presets}
                    formula={formula} setFormula={setFormula} describeNode={describeAny}
                    builder={renderFormulaBuilder?.({ formula: formula?.type === "text" ? formula : null, onChange: setFormula, kpiList: otherKpis })} />
                ),
              },
              {
                id: "rules", icon: ShieldCheck, title: kt("s3_title"), rail: kt("s3_rail"), hint: kt("s3_hint"), optional: true,
                summary: [
                  ["unhealthy", "healthy", "vhealthy"].some(z => benchmark[z].min !== "" || benchmark[z].max !== "") ? kt("s3_bench") : null,
                  variationCount ? kt("v_overrides", { n: variationCount }) : null,
                ].filter(Boolean).join(" · ") || null,
                content: (
                  <RulesStep kt={kt} tab={rulesTab} setTab={setRulesTab} benchmark={benchmark} setBenchmark={setBenchmark} format={format}
                    letters={letters} pruned={pruned} variationCount={variationCount} varTab={varTab} setVarTab={setVarTab}
                    expanded={expanded} setExpanded={setExpanded} companies={variationCompanies} companyLabels={companyLabelsMap}
                    dimensions={variationDimensions} describeNode={describeAny}
                    onPick={(scope, key, letter) => setSlotCtx({ scope, key, letter })}
                    onClear={(scope, key, letter) => setOverride(scope, key, letter, null)} />
                ),
              },
            ]} />
        )}

        {/* ── Avisos ── */}
        {dupe && (
          <Notice tone="amber" title={kt("w_dupe_title")} body={kt("w_dupe_body", { name: label.trim() })}
            actions={<button type="button" className={k.btnPrimary} onClick={() => setDupe(false)}>{kt("w_ok")}</button>} />
        )}
        {formulaWarning && (
          <Notice tone="red" title={kt("w_formula_title")} body={formulaWarning}
            actions={<>
              <button type="button" className={k.btnGhost} onClick={() => setFormulaWarning(null)}>{kt("w_fix")}</button>
              <button type="button" className={k.btnDanger} onClick={() => { setFormulaWarning(null); onSave(payload()); }}>{kt("w_save_anyway")}</button>
            </>} />
        )}
        {confirmClose && (
          <Notice tone="amber" title={kt("w_close_title")} body={kt("w_close_body")}
            actions={<>
              <button type="button" className={k.btnGhost} onClick={() => setConfirmClose(false)}>{kt("w_keep")}</button>
              <button type="button" className={k.btnDanger} onClick={() => { setConfirmClose(false); onClose(); }}>{kt("w_close")}</button>
            </>} />
        )}

        {/* Dentro del diálogo (en el árbol de React) para que sus clics no
            lleguen al fondo y abran el aviso de "¿cerrar sin guardar?" */}
        {slotCtx && renderSlotPicker && createPortal(
          renderSlotPicker({
            onSelect: (node) => { setOverride(slotCtx.scope, slotCtx.key, slotCtx.letter, node); setSlotCtx(null); },
            onClose: () => setSlotCtx(null),
          }),
          document.body
        )}
      </div>
    </div>,
    document.body
  );
}

function Notice({ tone, title, body, actions }) {
  return (
    <div className={k.noticeWrap}>
      <div className={k.notice}>
        <span className={cx(k.noticeIcon, tone === "red" && k.noticeRed)}><Info size={20} /></span>
        <strong>{title}</strong>
        <p>{body}</p>
        <div className={k.noticeActions}>{actions}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Biblioteca
// ════════════════════════════════════════════════════════════════════════
function LibraryView({ kt, tab, setTab, sections, customKpis, currentUserId, onClose, onCreate, onPick, onAddPreset, onCustomizePreset, formatValue, onDuplicate, onEdit, onDelete }) {
  const customs = useMemo(() => (customKpis ?? []).filter(x => x.tag !== "__library__"), [customKpis]);
  return (
    <>
      <header className={k.libHead}>
        <span className={k.libHeadIcon}><Library size={18} /></span>
        <div className={k.libHeadText}>
          <h2>{kt("lib_title")}</h2>
          <p>{kt("lib_sub")}</p>
        </div>
        <div className={k.segmented} role="tablist">
          {[["presets", kt("lib_tab_presets"), sections.reduce((a, s) => a + s.kpis.length, 0)], ["custom", kt("lib_tab_custom"), customs.length]].map(([id, lbl, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={cx(k.segBtn, tab === id && k.segOn)} onClick={() => setTab(id)}>
              {lbl}<b>{n}</b>
            </button>
          ))}
        </div>
        <button type="button" className={k.btnPrimary} onClick={onCreate}><Plus size={15} strokeWidth={2.6} /> {kt("lib_create")}</button>
        <button type="button" className={k.iconClose} onClick={onClose} aria-label={kt("wz_cancel")}><X size={16} /></button>
      </header>
      {tab === "presets"
        ? <PresetLibrary kt={kt} sections={sections} onAdd={onAddPreset} onCustomize={onCustomizePreset} formatValue={formatValue} onDuplicate={onDuplicate} />
        : <CustomLibrary kt={kt} kpis={customs} currentUserId={currentUserId} onPick={onPick} onCreate={onCreate}
            onDuplicate={onDuplicate} onEdit={onEdit} onDelete={onDelete} />}
    </>
  );
}

const STATUS_TONE = { ready: "#0f9f6e", nodata: "#d97706", setup: "#d9365b", unknown: "#94a3b8" };

function PresetLibrary({ kt, sections, onAdd, onCustomize, formatValue, onDuplicate }) {
  const [active, setActive] = useState(null);   // null = todas
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const all = sections.flatMap(s => s.kpis);
  const readyCount = all.some(x => x._preset) ? all.filter(x => x._preset?.status === "ready").length : null;
  const fmt = (v, f) => (formatValue ? formatValue(v, f) : String(Math.round(v * 100) / 100));
  const visible = sections
    .filter(s => !active || s.key === active)
    .map(s => ({ ...s, kpis: s.kpis.filter(x => !needle || `${x.label} ${x.description}`.toLowerCase().includes(needle)) }))
    .filter(s => s.kpis.length > 0);
  return (
    <div className={k.libBody}>
      <nav className={k.libNav}>
        <button type="button" className={cx(k.libNavItem, !active && k.libNavOn)} onClick={() => setActive(null)}>
          <span className={k.libNavIcon} style={{ "--tone": "var(--k-primary)" }}><Sparkles size={15} /></span>
          <span className={k.libNavText}><b>{kt("lib_all")}</b><small>{readyCount !== null ? kt("lib_ready_n", { n: readyCount }) : kt("lib_indicators", { n: sections.reduce((a, s) => a + s.kpis.length, 0) })}</small></span>
        </button>
        {sections.map((s, i) => {
          const Icon = SECTION_ICON[s.key] ?? Sigma;
          return (
            <button key={s.key} type="button" className={cx(k.libNavItem, active === s.key && k.libNavOn)} onClick={() => setActive(s.key)}
              style={{ "--i": i + 1 }}>
              <span className={k.libNavIcon} style={{ "--tone": SECTION_TONE[s.key] ?? "var(--k-primary)" }}><Icon size={15} /></span>
              <span className={k.libNavText}><b>{s.label}</b><small>{kt("lib_indicators", { n: s.kpis.length })}</small></span>
            </button>
          );
        })}
      </nav>
      <section className={k.libMain}>
        <label className={k.search}>
          <Search size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={kt("lib_search")} />
          {q ? <button type="button" onClick={() => setQ("")} aria-label="clear"><X size={13} /></button> : null}
        </label>
        <div className={k.libScroll}>
          {visible.length === 0 ? (
            <Empty icon={Search} title={kt("lib_no_results")} hint={kt("lib_no_results_hint")} />
          ) : visible.map(s => (
            <div key={s.key} className={k.libGroup}>
              {!active && <h4 className={k.libGroupTitle} style={{ "--tone": SECTION_TONE[s.key] ?? "var(--k-primary)" }}><i />{s.label}</h4>}
              <div className={k.cardGrid}>
                {s.kpis.map((x, i) => {
                  const p = x._preset;
                  const legacySetup = !p && x.formula?.type === "op" && !x.formula.left && !x.formula.right;
                  const setup = p?.status === "setup" || legacySetup;
                  const benchText = x.benchmarkText ?? (typeof x.benchmark === "string" ? x.benchmark : null);
                  return (
                    <article key={x.id} className={k.kCard} style={{ "--i": i, "--tone": SECTION_TONE[s.key] ?? "var(--k-primary)" }}>
                      <div className={k.kCardTop}>
                        <FmtBadge format={x.format} kt={kt} />
                        <h5>{x.label}</h5>
                      </div>
                      <p className={k.kCardDesc}>{x.description}</p>
                      {benchText ? (
                        <p className={k.kCardBench}><Gauge size={12} /> <span>{benchText}</span></p>
                      ) : null}
                      {p ? (
                        <div className={k.kStatus} style={{ "--st": STATUS_TONE[p.status] ?? STATUS_TONE.unknown }}>
                          <i />
                          <span className={k.kStatusText}>
                            <b>{kt(`lib_status_${p.status}`)}</b>
                            {p.status === "setup" && p.missing?.length
                              ? <small>{kt("lib_missing", { list: p.missing.map(m => kt(`ing_${m.ingredient}`)).join(", ") })}</small>
                              : p.systemId ? <small>{kt("lib_from_system")}</small> : null}
                          </span>
                          {p.status === "ready" && p.preview !== null
                            ? <span className={k.kStatusVal}><small>{kt("lib_preview")}</small>{fmt(p.preview, x.format)}</span>
                            : null}
                        </div>
                      ) : null}
                      <div className={k.kCardFoot}>
                        {legacySetup ? <span className={k.kCardFlag}>{kt("lib_needs_setup")}</span> : <span />}
                        <div className={k.kCardActions}>
                          <button type="button" className={k.iconBtn} title={kt("lib_duplicate")}
                            onClick={() => onDuplicate?.({ ...x, label: `${x.label} 2` })}><Copy size={13} /></button>
                          {p && onCustomize ? (
                            <button type="button" className={k.iconBtn} title={kt("lib_customize")} onClick={() => onCustomize(x)}><Edit3 size={13} /></button>
                          ) : null}
                          <button type="button" className={cx(k.btnAdd, setup && k.btnSetup)} onClick={() => onAdd(x)}>
                            {setup ? <><Wand2 size={13} /> {kt("lib_configure")}</> : <><Plus size={13} strokeWidth={2.8} /> {kt("lib_add")}</>}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CustomLibrary({ kt, kpis, currentUserId, onPick, onCreate, onDuplicate, onEdit, onDelete }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(null);
  const [tagF, setTagF] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [removed, setRemoved] = useState(() => new Set());
  const cats = [...new Set(kpis.map(x => x.category).filter(Boolean))].sort();
  const tags = [...new Set(kpis.map(x => x.tag).filter(t => t && !t.startsWith("__")))].sort();
  const needle = q.trim().toLowerCase();
  const list = kpis.filter(x => !removed.has(x.id)
    && (!needle || `${x.label} ${x.description ?? ""}`.toLowerCase().includes(needle))
    && (!cat || x.category === cat) && (!tagF || x.tag === tagF));
  const del = (x) => {
    setConfirmId(null);
    setLeaving(x.id);
    setTimeout(() => {
      setRemoved(prev => new Set([...prev, x.id]));
      setLeaving(null);
      onDelete?.(x.id);
    }, 420);
  };
  return (
    <div className={k.libBodyCustom}>
      <div className={k.customBar}>
        <label className={k.search}>
          <Search size={15} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={kt("lib_search")} />
          {q ? <button type="button" onClick={() => setQ("")} aria-label="clear"><X size={13} /></button> : null}
        </label>
        {cats.length > 0 && (
          <div className={k.chipRow} aria-label={kt("lib_categories")}>
            <button type="button" className={cx(k.chip, !cat && k.chipOn)} onClick={() => setCat(null)}>{kt("lib_all")}</button>
            {cats.map(c => <button key={c} type="button" className={cx(k.chip, cat === c && k.chipOn)} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
          </div>
        )}
        {tags.length > 0 && (
          <div className={k.chipRow} aria-label={kt("lib_tags")}>
            {tags.map(t => <button key={t} type="button" className={cx(k.chip, k.chipTag, tagF === t && k.chipOn)} onClick={() => setTagF(tagF === t ? null : t)}><Tag size={11} />{t}</button>)}
          </div>
        )}
      </div>
      <div className={k.libScroll}>
        {kpis.length === 0 ? (
          <Empty icon={Wand2} title={kt("lib_custom_empty")} hint={kt("lib_custom_empty_hint")}
            action={<button type="button" className={k.btnPrimary} onClick={onCreate}><Plus size={15} strokeWidth={2.6} /> {kt("lib_create")}</button>} />
        ) : list.length === 0 ? (
          <Empty icon={Search} title={kt("lib_no_results")} hint={kt("lib_no_results_hint")} />
        ) : (
          <div className={k.cardGrid}>
            {list.map((x, i) => (
              <article key={x.id} className={cx(k.kCard, k.kCardClick, leaving === x.id && k.kCardLeave)} style={{ "--i": i }}
                onClick={() => (confirmId === x.id ? null : onPick(x))}>
                <div className={k.kCardTop}>
                  <FmtBadge format={x.format} kt={kt} />
                  <h5>{x.label}</h5>
                </div>
                {x.description ? <p className={k.kCardDesc}>{x.description}</p> : null}
                <div className={k.kCardMeta}>
                  {x.category ? <span className={k.metaChip}>{x.category}</span> : null}
                  {x.tag && !x.tag.startsWith("__") ? <span className={cx(k.metaChip, k.metaTag)}><Tag size={10} />{x.tag}</span> : null}
                </div>
                <div className={k.kCardFoot}>
                  <span className={k.kCardWho}>
                    {x._createdBy ? <i>{x._createdBy === currentUserId ? "Y" : "T"}</i> : null}
                    {x._createdBy ? (x._createdBy === currentUserId ? kt("lib_by_you") : kt("lib_by_team")) : null}
                    {x._updatedAt ? <em><Clock size={10} /> {new Date(x._updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</em> : null}
                  </span>
                  <div className={cx(k.kCardActions, k.kCardHoverActions)} onClick={e => e.stopPropagation()}>
                    <button type="button" className={k.iconBtn} title={kt("lib_duplicate")} onClick={() => onDuplicate?.({ ...x, label: `${x.label} 2` })}><Copy size={13} /></button>
                    <button type="button" className={k.iconBtn} title={kt("lib_edit")} onClick={() => onEdit?.(x)}><Edit3 size={13} /></button>
                    <button type="button" className={cx(k.iconBtn, k.iconBtnDanger)} title={kt("lib_delete")} onClick={() => setConfirmId(x.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
                {confirmId === x.id && (
                  <div className={k.kCardConfirm} onClick={e => e.stopPropagation()}>
                    <strong>{kt("lib_delete_q", { name: x.label })}</strong>
                    <small>{kt("lib_delete_body")}</small>
                    <div>
                      <button type="button" className={k.btnGhost} onClick={() => setConfirmId(null)}>{kt("lib_cancel")}</button>
                      <button type="button" className={k.btnDanger} onClick={() => del(x)}><Trash2 size={13} /> {kt("lib_delete")}</button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div className={k.empty}>
      <span><Icon size={22} /></span>
      <strong>{title}</strong>
      <small>{hint}</small>
      {action}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Asistente
// ════════════════════════════════════════════════════════════════════════
function Wizard({ kt, kpi, builtInIds, steps, onClose, onFinish, onBackToLibrary, footExtra, initialStep = 0 }) {
  const [idx, setIdx] = useState(initialStep);
  const [dir, setDir] = useState(1);
  const [reached, setReached] = useState(kpi ? steps.length - 1 : initialStep);
  const step = steps[idx];
  const last = idx === steps.length - 1;
  const requiredOk = steps.every(s => s.optional || s.valid !== false);
  const canGo = (i) => i <= reached || steps.slice(0, i).every(s => s.optional || s.valid !== false);
  const go = (i) => {
    if (i < 0 || i >= steps.length || i === idx || !canGo(i)) return;
    setDir(i > idx ? 1 : -1);
    setIdx(i);
    setReached(r => Math.max(r, i));
  };
  const isSystem = kpi && builtInIds.has(kpi.id);
  return (
    <>
      <header className={k.wzHead}>
        <span className={k.wzHeadIcon}><Sigma size={17} /></span>
        <div className={k.wzHeadText}>
          <span className={k.wzKicker}>{kt("wz_step_of", { i: idx + 1, n: steps.length })}{kpi ? ` · ${isSystem ? kt("wz_system") : kt("wz_custom")}` : ""}</span>
          <h2 className={k.wzTitle}>{kpi ? kpi.label : kt("wz_new")}</h2>
        </div>
        <button type="button" className={k.iconClose} onClick={onClose} aria-label={kt("wz_cancel")}><X size={16} /></button>
      </header>

      <div className={k.wzBody}>
        <ol className={k.wzRail}>
          {steps.map((s, i) => {
            const done = i !== idx && i <= reached && (s.optional || s.valid !== false) && (i < idx || !!kpi);
            const Icon = s.icon;
            return (
              <li key={s.id}>
                <button type="button" disabled={!canGo(i)} onClick={() => go(i)} style={{ "--i": i }}
                  className={cx(k.wzRailItem, i === idx && k.wzRailOn, done && k.wzRailDone)}>
                  <span className={k.wzDot}>{done ? <Check size={13} strokeWidth={3} /> : <Icon size={14} strokeWidth={2.2} />}</span>
                  <span className={k.wzRailText}>
                    <span className={k.wzRailTitle}>{s.title}{s.optional ? <em>{kt("s3_optional")}</em> : null}</span>
                    <span className={k.wzRailSub}>{(i <= reached && s.summary) ? s.summary : s.rail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <section className={k.wzMain}>
          <div key={step.id} className={cx(k.wzStep, dir > 0 ? k.wzInNext : k.wzInPrev)}>
            <header className={k.wzStepHead}>
              <h3>{step.title}</h3>
              <p>{step.hint}</p>
            </header>
            <div className={k.wzStepBody}>{step.content}</div>
          </div>
        </section>
      </div>

      <footer className={k.wzFoot}>
        <span className={k.wzProgress} aria-hidden="true"><span style={{ width: `${((idx + 1) / steps.length) * 100}%` }} /></span>
        <div className={k.wzFootLeft}>{footExtra}</div>
        <button type="button" className={k.btnGhost}
          onClick={idx === 0 ? (onBackToLibrary ?? onClose) : () => go(idx - 1)}>
          {idx === 0 ? (onBackToLibrary ? <><ChevronLeft size={15} />{kt("lib_title")}</> : kt("wz_cancel")) : <><ChevronLeft size={15} />{kt("wz_back")}</>}
        </button>
        {!last && (
          <button type="button" className={cx(requiredOk && kpi ? k.btnGhost : k.btnPrimary, k.wzNext)} disabled={step.valid === false} onClick={() => go(idx + 1)}>
            {kt("wz_next")}<ChevronRight size={15} />
          </button>
        )}
        {(last || (kpi && requiredOk)) && (
          <button type="button" className={cx(k.btnPrimary, k.wzFinish)} disabled={!requiredOk} onClick={onFinish}>
            <Check size={15} strokeWidth={3} />{kpi ? kt("wz_save") : kt("wz_create")}
          </button>
        )}
      </footer>
    </>
  );
}

// ── Paso 1: identidad ───────────────────────────────────────────────────
function IdentityStep({ kt, label, setLabel, description, setDescription, category, setCategory, customCategoryLabel, setCustomCategoryLabel, tag, setTag, format, setFormat, allLocalKpis, finalCategory }) {
  const existingCats = [...new Set((allLocalKpis ?? []).map(x => x.category).filter(c => c && c !== "__custom__"))]
    .filter(c => !BASE_CATEGORIES.includes(c)).sort();
  const cats = [...BASE_CATEGORIES, ...existingCats];
  const existingTags = [...new Set((allLocalKpis ?? []).map(x => x.tag).filter(t => t && !t.startsWith("__")))].sort();
  const firstRef = useRef(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  return (
    <div className={k.split}>
      <div className={k.form}>
        <label className={k.field}>
          <span className={k.fieldLabel}>{kt("s1_label")} <em>{kt("s1_label_req")}</em></span>
          <input ref={firstRef} className={k.input} value={label} onChange={e => setLabel(e.target.value)} placeholder={kt("s1_label_ph")} maxLength={80} />
        </label>

        <div className={k.field}>
          <span className={k.fieldLabel}>{kt("s1_category")}</span>
          <div className={k.chipRow}>
            {cats.map(c => (
              <button key={c} type="button" className={cx(k.chip, category === c && k.chipOn)} onClick={() => setCategory(category === c ? "" : c)}>
                {category === c ? <Check size={12} strokeWidth={3} /> : null}{c}
              </button>
            ))}
            <button type="button" className={cx(k.chip, k.chipDashed, category === "__custom__" && k.chipOn)} onClick={() => setCategory("__custom__")}>
              <Plus size={12} strokeWidth={2.6} />{kt("s1_category_other")}
            </button>
          </div>
          {category === "__custom__" && (
            <input className={cx(k.input, k.inputSm)} autoFocus value={customCategoryLabel} onChange={e => setCustomCategoryLabel(e.target.value)} placeholder={kt("s1_category_ph")} />
          )}
        </div>

        <label className={k.field}>
          <span className={k.fieldLabel}>{kt("s1_description")}</span>
          <textarea className={cx(k.input, k.textarea)} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={kt("s1_description_ph")} />
        </label>

        <div className={k.fieldRow}>
          <label className={k.field}>
            <span className={k.fieldLabel}>{kt("s1_tag")}</span>
            <div className={k.inputIcon}>
              <Tag size={14} />
              <input className={k.input} value={tag} onChange={e => setTag(e.target.value)} placeholder={kt("s1_tag_ph")} list="kpi-tag-suggestions" />
              <datalist id="kpi-tag-suggestions">{existingTags.map(t => <option key={t} value={t} />)}</datalist>
            </div>
            <small className={k.fieldHint}>{kt("s1_tag_hint")}</small>
            {existingTags.length > 0 && (
              <div className={k.chipRow}>
                {existingTags.slice(0, 8).map(t => (
                  <button key={t} type="button" className={cx(k.chip, k.chipTag, tag === t && k.chipOn)} onClick={() => setTag(tag === t ? "" : t)}><Tag size={10} />{t}</button>
                ))}
              </div>
            )}
          </label>
          <div className={k.field}>
            <span className={k.fieldLabel}>{kt("s1_format")}</span>
            <div className={k.fmtPick}>
              {["currency", "percent", "number"].map(f => (
                <button key={f} type="button" className={cx(k.fmtOpt, format === f && k.fmtOptOn)} onClick={() => setFormat(f)}>
                  <b>{FMT_META[f].short}</b>{kt(FMT_META[f].key)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className={k.previewCol}>
        <span className={k.previewLabel}>{kt("s1_preview")}</span>
        <div className={k.rowPreview}>
          <div className={k.rowPreviewName}>
            <div>
              <strong>{label.trim() || kt("s1_label_ph")}</strong>
              {finalCategory ? <span className={k.metaChip}>{finalCategory}</span> : null}
            </div>
            {description ? <small>{description}</small> : null}
          </div>
          <span className={k.rowPreviewVal}>{format === "percent" ? "24,6%" : format === "number" ? "1,84" : "1.284.500,00"}</span>
        </div>
        {tag ? <p className={k.previewTag}><Tag size={11} /> {tag}</p> : null}
      </aside>
    </div>
  );
}

// ── Paso 2: fórmula ─────────────────────────────────────────────────────

function FormulaStep({ kt, isEdit, missing, tab, setTab, presets, formula, setFormula, describeNode, builder }) {
  // Letras que el KPI predefinido no pudo asignar solo y siguen vacías
  const pending = (missing ?? []).filter(m => formula?.type === "text" && formula.variables && m.letter in formula.variables && !formula.variables[m.letter]);
  return (
    <div className={k.formulaLayout}>
      <div className={k.formulaMain}>
        {pending.length > 0 && (
          <div className={k.missingBox}>
            <span className={k.howIcon}><Wand2 size={14} /></span>
            <div>
              <strong>{kt("s2_missing_title")}</strong>
              <ul>
                {pending.map(m => <li key={m.letter}><b className={k.exprLetter}>{m.letter}</b>{kt(`ing_${m.ingredient}`)}</li>)}
              </ul>
              <small>{kt("s2_missing_hint")}</small>
            </div>
          </div>
        )}
        <div className={k.segmented} role="tablist">
          {[["templates", kt("s2_templates"), Wand2], ["builder", kt("s2_builder"), Calculator]].map(([id, lbl, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={cx(k.segBtn, tab === id && k.segOn)} onClick={() => setTab(id)}>
              <Icon size={13} />{lbl}
            </button>
          ))}
        </div>

        {tab === "templates" ? (
          <div className={k.tplGrid}>
            {presets.map((p, i) => {
              // Las 8 plantillas de las dos páginas van en el mismo orden: se
              // les pone nombre y explicación en el idioma del usuario.
              const named = presets.length === 8;
              return (
                <button key={i} type="button" className={k.tplCard} style={{ "--i": i }}
                  onClick={() => { setFormula(JSON.parse(JSON.stringify(p.formula))); setTab("builder"); }}>
                  <span className={k.tplExpr}><ExprView expression={p.formula.expression} /></span>
                  <strong>{named ? kt(`tpl_${i + 1}_name`) : p.label}</strong>
                  {named ? <p className={k.tplDesc}>{kt(`tpl_${i + 1}_desc`)}</p> : null}
                  <span className={k.tplUse}>{kt("s2_use")} <ChevronRight size={13} /></span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={k.builderBox}>{builder}</div>
        )}

        {formula?.type === "text" && formula.expression ? (
          <div className={k.formulaNow}>
            <span className={k.previewLabel}>{kt("s2_current")}</span>
            <ExprView expression={formula.expression} />
            <ul>
              {Object.entries(formula.variables ?? {}).map(([letter, node]) => (
                <li key={letter}><b className={k.exprLetter}>{letter}</b>{node ? <span>{describeNode(node)}</span> : <span className={k.unassigned}>{kt("s2_unassigned")}</span>}</li>
              ))}
            </ul>
          </div>
        ) : !isEdit && tab === "builder" ? <p className={k.fieldHint}>{kt("s2_none")}</p> : null}
      </div>

      <aside className={k.howCol}>
        <FormulaExplainer kt={kt} />
      </aside>
    </div>
  );
}

// "¿Cómo funciona?": tres escenas que se reproducen solas
function useStages(count, ms) {
  const [stage, setStage] = useState(0);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const id = setTimeout(() => setStage(s => (s + 1) % count), ms);
    return () => clearTimeout(id);
  }, [stage, paused, count, ms, run]);
  return {
    stage, run,
    go: (i) => setStage(i),
    replay: () => { setStage(0); setRun(r => r + 1); },
    hover: { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) },
  };
}

function FormulaExplainer({ kt }) {
  const st = useStages(3, 3800);
  const scenes = [
    { title: kt("hw1_title"), body: kt("hw1_body") },
    { title: kt("hw2_title"), body: kt("hw2_body") },
    { title: kt("hw3_title"), body: kt("hw3_body") },
  ];
  const tokens = ["(", "A", "−", "B", ")", "÷", "A", "×", "100"];
  const rows = [["Norvia", 2298000, 886000], ["Ibérica", 1263900, 702400], ["Portugal", 873240, 531600]];
  return (
    <div className={k.how} {...st.hover}>
      <div className={k.howHead}>
        <span className={k.howIcon}><Info size={15} /></span>
        <strong>{kt("s2_how")}</strong>
        <button type="button" className={k.linkBtn} onClick={st.replay}><Play size={12} /> {kt("s2_replay")}</button>
      </div>
      <div className={k.howStage} key={`${st.stage}-${st.run}`}>
        {st.stage === 0 && (
          <div className={k.hwExpr}>
            {tokens.map((t, i) => (
              <span key={i} className={/^[A-Z]$/.test(t) ? k.hwLetter : k.hwTok} style={{ animationDelay: `${i * 140}ms` }}>{t}</span>
            ))}
            <span className={k.hwCaret} style={{ animationDelay: `${tokens.length * 140}ms` }} />
          </div>
        )}
        {st.stage === 1 && (
          <div className={k.hwMap}>
            {[["A", "7000", kt("hw_sales")], ["B", "6000", kt("hw_costs")]].map(([l, code, name], i) => (
              <div key={l} className={k.hwMapRow} style={{ "--d": `${i * 420}ms` }}>
                <span className={k.hwLetter}>{l}</span>
                <span className={k.hwLine} />
                <span className={k.hwAcc}><code>{code}</code>{name}</span>
              </div>
            ))}
          </div>
        )}
        {st.stage === 2 && (
          <div className={k.hwTable}>
            {rows.map(([co, a, b], i) => (
              <div key={co} className={k.hwTableRow} style={{ "--d": `${i * 260}ms` }}>
                <span>{co}</span>
                <span className={k.hwNum}>{a.toLocaleString("de-DE")}</span>
                <span className={k.hwNum}>{b.toLocaleString("de-DE")}</span>
                <b className={k.hwRes}>{(((a - b) / a) * 100).toFixed(1).replace(".", ",")}%</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={k.howText}>
        <strong>{scenes[st.stage].title}</strong>
        <p>{scenes[st.stage].body}</p>
      </div>
      <div className={k.howDots}>
        {scenes.map((_, i) => (
          <button key={i} type="button" className={cx(k.howDot, i === st.stage && k.howDotOn)} onClick={() => st.go(i)} aria-label={`${i + 1}`}>
            {i === st.stage ? <i key={st.run} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Paso 3: reglas ──────────────────────────────────────────────────────
const ZONES = [
  { key: "unhealthy", tone: "#dc2626" },
  { key: "healthy", tone: "#16a34a" },
  { key: "vhealthy", tone: "#1a2f8a" },
];

function RulesStep({ kt, tab, setTab, benchmark, setBenchmark, format, letters, pruned, variationCount, varTab, setVarTab, expanded, setExpanded, companies, companyLabels, dimensions, describeNode, onPick, onClear }) {
  return (
    <div className={k.rules}>
      <div className={k.segmented} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "bench"} className={cx(k.segBtn, tab === "bench" && k.segOn)} onClick={() => setTab("bench")}>
          <Gauge size={13} />{kt("s3_bench")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "vars"} className={cx(k.segBtn, tab === "vars" && k.segOn)} onClick={() => setTab("vars")}>
          <GitBranch size={13} />{kt("s3_vars")}{variationCount ? <b>{variationCount}</b> : null}
        </button>
      </div>

      {tab === "bench" ? (
        <div className={k.split}>
          <div className={k.form}>
            {ZONES.map(z => (
              <div key={z.key} className={k.zoneRow} style={{ "--tone": z.tone }}>
                <span className={k.zoneName}><i />{kt(`b_${z.key}`)}</span>
                <label className={k.zoneInput}>
                  <span>{kt("b_min")}</span>
                  <input inputMode="decimal" value={benchmark[z.key].min} placeholder="—"
                    onChange={e => setBenchmark(prev => ({ ...prev, [z.key]: { ...prev[z.key], min: e.target.value } }))} />
                </label>
                <label className={k.zoneInput}>
                  <span>{kt("b_max")}</span>
                  <input inputMode="decimal" value={benchmark[z.key].max} placeholder="—"
                    onChange={e => setBenchmark(prev => ({ ...prev, [z.key]: { ...prev[z.key], max: e.target.value } }))} />
                </label>
              </div>
            ))}
            <div className={k.explain}>
              <span className={k.howIcon}><Info size={14} /></span>
              <div><strong>{kt("b_what")}</strong><p>{kt("b_what_body")}</p></div>
            </div>
          </div>
          <aside className={k.howCol}>
            <BenchmarkExplainer kt={kt} benchmark={benchmark} format={format} />
          </aside>
        </div>
      ) : (
        <div className={k.split}>
          <div className={k.form}>
            {letters.length === 0 ? (
              <div className={k.explain}><span className={k.howIcon}><Info size={14} /></span><div><p>{kt("v_need_formula")}</p></div></div>
            ) : (
              <>
                <div className={k.segmentedSm}>
                  <button type="button" className={cx(k.segBtn, varTab === "companies" && k.segOn)} onClick={() => setVarTab("companies")}><Building2 size={12} />{kt("v_companies")}<b>{companies.length}</b></button>
                  <button type="button" className={cx(k.segBtn, varTab === "dimensions" && k.segOn)} onClick={() => setVarTab("dimensions")}><Layers size={12} />{kt("v_dimensions")}<b>{dimensions.length}</b></button>
                </div>
                <div className={k.varList}>
                  {(varTab === "companies" ? companies : dimensions).length === 0 && (
                    <p className={k.fieldHint}>{varTab === "companies" ? kt("v_none_companies") : kt("v_none_dims")}</p>
                  )}
                  {(varTab === "companies" ? companies : dimensions).map(item => {
                    const scope = varTab === "companies" ? "company" : "dimension";
                    const key = scope === "company" ? item : (item.code ?? item);
                    const name = scope === "company" ? (companyLabels.get(item) ?? item) : (item.name ?? key);
                    const sub = scope === "company" ? item : item.group;
                    const ov = (scope === "company" ? pruned.byCompany[key] : pruned.byDimension[key]) ?? {};
                    const n = Object.keys(ov).length;
                    const open = expanded === `${scope}:${key}`;
                    return (
                      <div key={key} className={cx(k.varItem, open && k.varItemOpen, n > 0 && k.varItemSet)}>
                        <button type="button" className={k.varHead} onClick={() => setExpanded(open ? null : `${scope}:${key}`)}>
                          <span className={k.varIcon}>{scope === "company" ? <Building2 size={13} /> : <Layers size={13} />}</span>
                          <span className={k.varName}><b>{name}</b>{sub && String(sub) !== String(name) ? <small>{sub}</small> : null}</span>
                          {n > 0 ? <span className={k.varCount}>{kt("v_overrides", { n })}</span> : null}
                          <ChevronRight size={14} className={k.varChevron} />
                        </button>
                        {open && (
                          <div className={k.varBody}>
                            {letters.map(letter => (
                              <div key={letter} className={k.varSlot}>
                                <b className={k.exprLetter}>{letter}</b>
                                <button type="button" className={cx(k.varPick, ov[letter] && k.varPickSet)} onClick={() => onPick(scope, key, letter)}>
                                  {ov[letter] ? describeNode(ov[letter]) : `— ${kt("v_base")} —`}
                                </button>
                                {ov[letter] ? <button type="button" className={cx(k.iconBtn, k.iconBtnDanger)} onClick={() => onClear(scope, key, letter)}><X size={12} /></button> : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <aside className={k.howCol}>
            <VariationExplainer kt={kt} />
          </aside>
        </div>
      )}
    </div>
  );
}

// Escala animada con los rangos que escribe el usuario
function inZone(value, range) {
  const min = range.min !== "" && range.min !== undefined ? parseFloat(String(range.min).replace(",", ".")) : null;
  const max = range.max !== "" && range.max !== undefined ? parseFloat(String(range.max).replace(",", ".")) : null;
  const okMin = min === null || Number.isNaN(min) || value > min;
  const okMax = max === null || Number.isNaN(max) || value < max;
  if ((min === null || Number.isNaN(min)) && (max === null || Number.isNaN(max))) return false;
  return okMin && okMax;
}
function zoneOf(value, bench) {
  if (inZone(value, bench.vhealthy)) return ZONES[2];
  if (inZone(value, bench.healthy)) return ZONES[1];
  if (inZone(value, bench.unhealthy)) return ZONES[0];
  return null;
}

function BenchmarkExplainer({ kt, benchmark, format }) {
  const nums = ZONES.flatMap(z => [benchmark[z.key].min, benchmark[z.key].max])
    .map(v => parseFloat(String(v ?? "").replace(",", "."))).filter(v => Number.isFinite(v));
  const demo = nums.length === 0;
  const bench = demo ? { unhealthy: { min: "", max: "5" }, healthy: { min: "5", max: "15" }, vhealthy: { min: "15", max: "" } } : benchmark;
  const pool = demo ? [5, 15] : nums;
  const lo = Math.min(...pool), hi = Math.max(...pool);
  const pad = Math.max(1, (hi - lo) * 0.35 || Math.abs(hi) * 0.5 || 5);
  const d0 = lo - pad, d1 = hi + pad;
  const N = 48;
  const cells = Array.from({ length: N }, (_, i) => zoneOf(d0 + ((i + 0.5) / N) * (d1 - d0), bench));
  const samples = [0.08, 0.3, 0.5, 0.72, 0.93].map(f => d0 + f * (d1 - d0));
  const [si, setSi] = useState(0);
  useEffect(() => { const id = setInterval(() => setSi(i => (i + 1) % samples.length), 1500); return () => clearInterval(id); }, [samples.length]);
  const v = samples[si];
  const z = zoneOf(v, bench);
  const pct = ((v - d0) / (d1 - d0)) * 100;
  const fmt = (x) => format === "percent" ? `${x.toFixed(1).replace(".", ",")}%` : Math.abs(x) >= 1000 ? x.toLocaleString("de-DE", { maximumFractionDigits: 0 }) : x.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return (
    <div className={k.how}>
      <div className={k.howHead}>
        <span className={k.howIcon}><Gauge size={15} /></span>
        <strong>{kt("b_scale")}</strong>
        {demo ? <em className={k.howTag}>demo</em> : null}
      </div>
      <div className={k.scaleWrap}>
        <div className={k.scale}>
          {cells.map((c, i) => <i key={i} style={{ background: c ? c.tone : "#e8ebf2", opacity: c ? 0.85 : 1 }} />)}
          <span className={k.scaleMarker} style={{ left: `${pct}%`, "--tone": z?.tone ?? "#94a3b8" }} />
        </div>
        <div className={k.scaleAxis}><span>{fmt(d0)}</span><span>{fmt(d1)}</span></div>
      </div>
      <div className={k.scaleDemo}>
        <span className={k.scaleRow}>
          <span>KPI</span>
          <b className={k.scalePill} style={{ "--tone": z?.tone ?? "#475569" }} key={si}>{z ? <i /> : null}{fmt(v)}</b>
        </span>
        <small>{z ? kt(`b_${z.key}`) : "—"}</small>
      </div>
      {demo ? <p className={k.fieldHint}>{kt("b_scale_empty")}</p> : null}
    </div>
  );
}

function VariationExplainer({ kt }) {
  return (
    <div className={k.how}>
      <div className={k.howHead}>
        <span className={k.howIcon}><GitBranch size={15} /></span>
        <strong>{kt("v_what")}</strong>
      </div>
      <div className={k.vxBase}>
        <span className={k.previewLabel}>{kt("hwv_base")}</span>
        <ExprView expression="A - B" />
        <div className={k.vxVars}>
          <span><b className={k.exprLetter}>A</b> 7000 · {kt("hw_sales")}</span>
          <span><b className={k.exprLetter}>B</b> 6000 · {kt("hw_costs")}</span>
        </div>
      </div>
      <div className={k.vxRow}>
        <span className={k.vxCo}><Building2 size={13} /> {kt("hwv_company_a")}</span>
        <span className={k.vxSlot}><b className={k.exprLetter}>A</b><span>7000</span></span>
        <small>{kt("hwv_uses_base")}</small>
      </div>
      <div className={cx(k.vxRow, k.vxRowSwap)}>
        <span className={k.vxCo}><Building2 size={13} /> {kt("hwv_company_b")}</span>
        <span className={k.vxSlot}>
          <b className={k.exprLetter}>A</b>
          <span className={k.vxSwap}><span className={k.vxOld}>7000</span><span className={k.vxNew}>7050</span></span>
        </span>
        <small>{kt("hwv_override")}</small>
      </div>
      <p className={k.howBody}>{kt("v_what_body")}</p>
    </div>
  );
}