/* ══════════════════════════════════════════════════════════════════════
   Contributivo — vista de gráficos
   ──────────────────────────────────────────────────────────────────────
   Tres lecturas de la misma cuenta, todas en la divisa del grupo (es la
   única en la que se pueden sumar sociedades):
     1. Cifras clave: consolidado, quién más aporta, cuánto viene de
        asientos y cuántas sociedades aportan.
     2. Aportación por sociedad: barras horizontales divididas por el
        origen del importe (carga, AJE, RJE, SYS, EJE, CFA).
     3. Cómo se forma: cascada desde la carga hasta el total, del grupo o
        de la sociedad elegida.
     4. Mapa por cuenta: qué parte de cada subcuenta aporta cada sociedad;
        al pulsar una fila se baja un nivel.
   Los importes salen de los mismos datos que la tabla (pivotG y el
   desglose por asientos en divisa de grupo), así que cuadran con ella.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronRight, Info, Layers, Rows3, Search, X } from "lucide-react";
import { t } from "../../lib/i18n";
import { fmtAmt, getCompanyCurrency } from "./contributiveUtils.js";
import styles from "./ContributiveCharts.module.css";

/* ─── Origen de cada importe: orden de apilado y color (paleta validada) ── */
export const ORIGINS = ["Uploaded", "AJE", "RJE", "SYS", "EJE", "CFA"];
const ORIGIN_COLOR = { Uploaded: "#2a78d6", AJE: "#eb6834", RJE: "#1baf7a", SYS: "#eda100", EJE: "#e34948", CFA: "#6250d6" };
const PL_TYPES = ["P/L", "DIS"];
const BS_TYPES = ["B/S"];
const ROOT = "__ROOT__";
const UP = "#2a78d6", DOWN = "#e34948", INK = "#1a2f8a";   // escalones que suben / bajan y total
const TOP_COS = 9;     // sociedades visibles en las barras antes de agrupar el resto
const HEAT_COS = 7;    // columnas de sociedad en el mapa
const HEAT_ROWS = 14;  // filas de cuenta en el mapa

/* ─── Textos (src/lib/i18n.js, claves ctg_*) ─────────────────────────── */
const fill = (str, v) => String(str).replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? ""));
export function chartsText(locale) {
  const g = (k) => t(locale, `ctg_${k}`);
  const each = (prefix) => Object.fromEntries(ORIGINS.map(k => [k, g(`${prefix}_${k}`)]));
  return {
    analyze: g("analyze"), plResult: g("pl_result"), bsAll: g("bs_all"), cfAll: g("cf_all"),
    groupCcy: (c) => fill(g("group_ccy"), { c }), ytd: (p) => fill(g("ytd"), { p }), month: (p) => fill(g("month"), { p }),
    std: g("std"), search: g("search"), noMatch: g("no_match"),
    kTotal: g("k_total"), kTop: g("k_top"), kAdj: g("k_adj"), kCos: g("k_cos"), kMain: g("k_main"),
    ofTotal: g("of_total"), ofTotalShort: g("of_total"), ofGross: g("of_gross"),
    cosOf: (n, m) => fill(g("cos_of"), { n, m }), top3: (p) => fill(g("top3"), { p }), adjNone: g("adj_none"), mainNone: g("main_none"),
    byCo: g("by_co"), byCoSub: g("by_co_sub"), byCoSubCf: g("by_co_sub_cf"),
    build: g("build"), buildGroup: g("build_group"), buildCo: (c) => fill(g("build_co"), { c }),
    buildLines: g("build_lines"), buildLinesCo: (c) => fill(g("build_lines_co"), { c }), buildCos: g("build_cos"),
    heat: g("heat"), heatSub: g("heat_sub"), heatSubLeaf: g("heat_sub_leaf"),
    total: g("total"), net: g("net"), share: g("share"), amount: g("amount"), account: g("account"),
    rest: (n) => fill(g("rest"), { n }), restShort: g("rest_short"), otherAcc: (n) => fill(g("other_acc"), { n }), otherItems: (n) => fill(g("other_items"), { n }),
    showAll: (n) => fill(g("show_all"), { n }), showLess: g("show_less"), backGroup: g("back_group"),
    orient: g("orient"), grossNote: g("gross_note"), empty: g("empty"), pickBs: g("pick_bs"), pickCf: g("pick_cf"), noCf: g("no_cf"), flow: g("flow"),
    scale: g("scale"), drill: g("drill"), focus: g("focus"), info: g("info"), infoHow: g("info_how"), close: g("close"),
    origin: each("origin"), originLong: each("originlong"),
    help: {
      byCo: [g("info_byco_what"), g("info_byco_how")], byCoCf: [g("info_byco_cf_what"), g("info_byco_cf_how")],
      build: [g("info_build_what"), g("info_build_how")], buildLines: [g("info_build_lines_what"), g("info_build_lines_how")],
      heat: [g("info_heat_what"), g("info_heat_how")],
    },
  };
}
const INTL = { es: "es-ES", en: "en-GB", da: "da-DK", pt: "pt-PT" };

/* ─── Números ─────────────────────────────────────────────────────────── */
const near0 = (v) => Math.abs(v) < 0.005;
function makeFmt(locale) {
  const tag = INTL[String(locale ?? "").slice(0, 2)] ?? "es-ES";
  const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(tag, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return {
    short: (v) => (near0(v) ? "—" : `${v < 0 ? "−" : ""}${compact.format(Math.abs(v))}`),
    axis: (v) => (near0(v) ? "0" : `${v < 0 ? "−" : ""}${compact.format(Math.abs(v))}`),
    signed: (v) => (near0(v) ? "0" : `${v < 0 ? "−" : "+"}${compact.format(Math.abs(v))}`),
    pct: (p) => (p == null || !Number.isFinite(p) ? "—" : `${pct.format(p)} %`),
    pct0: (p) => (p == null || !Number.isFinite(p) ? "—" : `${Math.abs(p) < 10 ? pct.format(p) : Math.round(p)} %`),
    full: (v) => fmtAmt(v),
  };
}

function niceTicks(lo, hi, count = 4) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/* ─── Árbol: hojas, valor y desglose ─────────────────────────────────── */
const leafCache = new WeakMap();
function leavesOf(node) {
  if (leafCache.has(node)) return leafCache.get(node);
  const out = [];
  const walk = (n) => {
    if (n._sectionAnchor) return;
    if (n.children?.length) n.children.forEach(walk); else if (n.AccountCode) out.push(n.AccountCode);
  };
  walk(node);
  leafCache.set(node, out);
  return out;
}
const kids = (n) => (n?.children ?? []).filter(c => !c._sectionAnchor);

function useEngine({ pivotG, pivotPrevG, jpG, jpPrevG, monthly, cfPivotG, isCF }) {
  return useMemo(() => {
    if (isCF) {
      // Flujo de caja: siempre acumulado y sin desglose por asientos
      const value = (node, co) => leavesOf(node).reduce((v, code) => v + Number(cfPivotG?.get(code)?.[co]?.total ?? 0), 0);
      const parts = (node, co) => ({ ...Object.fromEntries(ORIGINS.map(k => [k, 0])), Uploaded: value(node, co) });
      return { value, parts };
    }
    const isPL = (n) => PL_TYPES.includes(n?.AccountType ?? n?.accountType ?? "");
    const sub = (n) => monthly && isPL(n);
    const value = (node, co) => {
      const curP = pivotG, prvP = pivotPrevG;
      let v = 0;
      leavesOf(node).forEach(code => {
        v += Number(curP?.get(code)?.[co]?.total ?? 0);
        if (sub(node)) v -= Number(prvP?.get(code)?.[co]?.total ?? 0);
      });
      return v;
    };
    const parts = (node, co) => {
      const out = Object.fromEntries(ORIGINS.map(k => [k, 0]));
      leavesOf(node).forEach(code => {
        const cur = jpG?.get(code)?.[co];
        if (cur) ORIGINS.forEach(k => { out[k] += Number(cur[k] ?? 0); });
        if (sub(node)) {
          const prv = jpPrevG?.get(code)?.[co];
          if (prv) ORIGINS.forEach(k => { out[k] -= Number(prv[k] ?? 0); });
        }
      });
      return out;
    };
    return { value, parts };
  }, [pivotG, pivotPrevG, jpG, jpPrevG, monthly, cfPivotG, isCF]);
}

/* Cifra que sube suavemente cuando cambia */
function useTween(target, ms = 650) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { fromRef.current = target; const id = requestAnimationFrame(() => setShown(target)); return () => cancelAnimationFrame(id); }
    let raf; const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      const v = from + (target - from) * e;
      fromRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
function Tween({ value, format }) {
  const v = useTween(value);
  return <>{format(v)}</>;
}

/* ═══════════════════════════════════════════════════════════════════════
   Componente principal
   ═══════════════════════════════════════════════════════════════════════ */
export default function ContributiveCharts({
  locale, tree, cfTree, typeFilter, pivotG, pivotPrevG, jpG, jpPrevG, cfPivotG, cols, companies, perspective,
  ytdOnly, year, month, mappingActive, nav, setNav,
}) {
  const L = useMemo(() => chartsText(locale), [locale]);
  const F = useMemo(() => makeFmt(locale), [locale]);
  const rootRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // El estado (P&G, Balance o Flujo de caja) lo marca la pestaña de la cabecera
  const stmt = typeFilter === "B/S" ? "B/S" : typeFilter === "C/F" ? "C/F" : "P/L";
  const isCF = stmt === "C/F";
  const monthly = !ytdOnly && !isCF;
  const engine = useEngine({ pivotG, pivotPrevG, jpG, jpPrevG, monthly, cfPivotG, isCF });
  const ccy = getCompanyCurrency(perspective, companies) || "EUR";
  const coName = (co) => companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName ?? co;
  const periodLabel = useMemo(() => {
    const tag = INTL[String(locale ?? "").slice(0, 2)] ?? "es-ES";
    if (!year || !month) return "";
    const d = new Date(Number(year), Number(month) - 1, 1);
    return new Intl.DateTimeFormat(tag, { month: "short", year: "numeric" }).format(d).replace(".", "");
  }, [locale, year, month]);

  // Raíz del estado elegido (sintética si hay varias cuentas de primer nivel)
  const root = useMemo(() => {
    const types = stmt === "B/S" ? BS_TYPES : PL_TYPES;
    const tops = isCF
      ? (cfTree ?? []).filter(n => !n._sectionAnchor)
      : (tree ?? []).filter(n => !n._sectionAnchor && types.includes(n.AccountType ?? n.accountType ?? ""));
    if (tops.length === 1) return { node: tops[0], synthetic: false };
    return {
      node: { AccountCode: ROOT, AccountName: isCF ? L.cfAll : stmt === "B/S" ? L.bsAll : L.plResult, AccountType: isCF ? "C/F" : types[0], children: tops },
      synthetic: true,
    };
  }, [tree, cfTree, stmt, isCF, L]);
  // La suma de todo el balance (o de todos los flujos, que ya incluyen sus
  // totales) no dice nada: esa raíz solo enseña el mapa
  // (en flujo de caja la suma de las secciones sí es la variación neta, salvo
  // que ya venga una fila de total general que las incluye)
  const rootFocusable = !(root.synthetic && (stmt === "B/S" || (isCF && kids(root.node).some(n => n._noExpand))));

  // Ruta hasta la cuenta analizada
  const findPath = (target) => {
    if (!target) return null;
    const queue = [[root.node, [root.node]]];
    while (queue.length) {
      const [n, p] = queue.shift();
      if (n.AccountCode === target) return p;
      kids(n).forEach(c => queue.push([c, [...p, c]]));
    }
    return null;
  };
  const defaultPath = () => {
    if (rootFocusable) return [root.node];
    // En flujo de caja, el total general (la fila que suma las secciones) si existe
    const grand = isCF ? kids(root.node).find(n => n._noExpand) : null;
    const best = grand ?? [...kids(root.node)].sort((a, b) => Math.abs(totalOf(b)) - Math.abs(totalOf(a)))[0];
    return best ? [root.node, best] : [root.node];
  };
  const totalOf = (n) => cols.reduce((s, co) => s + engine.value(n, co), 0);
  const path = (nav.focus && findPath(nav.focus)) || defaultPath();
  const focus = path[path.length - 1];
  const focusHasKids = kids(focus).length > 0;
  const browse = focusHasKids ? focus : (path[path.length - 2] ?? focus);

  /* ── Cifras de la cuenta analizada ───────────────────────────────── */
  const data = useMemo(() => {
    const rows = cols.map(co => {
      const v = engine.value(focus, co);
      const p = engine.parts(focus, co);
      return { co, v, p };
    });
    const total = rows.reduce((s, r) => s + r.v, 0);
    const gp = Object.fromEntries(ORIGINS.map(k => [k, rows.reduce((s, r) => s + r.p[k], 0)]));
    const active = rows.filter(r => !near0(r.v)).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    // Peso: sobre el total si todas van en su mismo sentido; si no, sobre el volumen bruto
    const sameSign = active.every(r => Math.sign(r.v) === Math.sign(total));
    const gross = active.reduce((a, r) => a + Math.abs(r.v), 0);
    return { rows, total, gp, active, sameSign, gross };
  }, [cols, engine, focus]);
  const { total, gp, active, sameSign, gross } = data;
  const s = 1;
  const pickRow = nav.co ? data.rows.find(r => r.co === nav.co) : null;

  /* ── Mapa por cuenta ─────────────────────────────────────────────── */
  const heat = useMemo(() => {
    const children = kids(browse);
    const accRows = children.map(n => {
      const byCo = Object.fromEntries(cols.map(co => [co, engine.value(n, co)]));
      const t = cols.reduce((a, co) => a + byCo[co], 0);
      const vals = cols.map(co => byCo[co]).filter(v => !near0(v));
      const same = vals.every(v => Math.sign(v) === Math.sign(t));
      const base = same ? t : vals.reduce((a, v) => a + Math.abs(v), 0);
      return { node: n, byCo, t, base, gross: !same };
    }).filter(r => !near0(r.t) || cols.some(co => !near0(r.byCo[co])));
    accRows.sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
    // Columnas: las sociedades que más pesan en la cuenta que se recorre
    const weight = Object.fromEntries(cols.map(co => [co, accRows.reduce((a, r) => a + Math.abs(r.byCo[co]), 0)]));
    const ranked = cols.filter(co => weight[co] > 0).sort((a, b) => weight[b] - weight[a]);
    const shown = ranked.slice(0, HEAT_COS);
    const rest = ranked.slice(HEAT_COS);
    const top = accRows.slice(0, HEAT_ROWS);
    const tail = accRows.slice(HEAT_ROWS);
    const maxAbs = Math.max(1e-9, ...accRows.map(r => Math.abs(r.t)));
    return { top, tail, shown, rest, maxAbs, anyGross: top.some(r => r.gross) };
  }, [browse, cols, engine]);

  /* ── Navegación ──────────────────────────────────────────────────── */
  const go = (code, extra = {}) => { setNav(n => ({ ...n, focus: code, co: null, ...extra })); setShowAll(false); setTip(null); };
  const pickCo = (co) => setNav(n => ({ ...n, co: n.co === co ? null : co }));

  // Todas las cuentas del estado, para el buscador
  const allNodes = useMemo(() => {
    const out = [];
    const walk = (n, depth) => { kids(n).forEach(c => { out.push({ node: c, depth }); walk(c, depth + 1); }); };
    walk(root.node, 0);
    return out;
  }, [root]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNodes.slice(0, 60);
    return allNodes.filter(({ node }) => `${node.AccountCode} ${node.AccountName ?? ""}`.toLowerCase().includes(q)).slice(0, 60);
  }, [allNodes, query]);

  /* ── Tooltip ─────────────────────────────────────────────────────── */
  const showTip = (e, content) => {
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    let x, y;
    if (e.type === "focus") {
      const r = e.currentTarget.getBoundingClientRect();
      x = r.left + r.width / 2 - box.left; y = r.top - box.top + rootRef.current.scrollTop;
    } else {
      x = e.clientX - box.left; y = e.clientY - box.top + rootRef.current.scrollTop;
    }
    setTip({ x, y, flip: x > box.width - 300, ...content });
  };
  const hideTip = () => setTip(null);
  const partsTip = (title, sub, v, p) => ({
    title, sub,
    lead: { label: L.net, value: F.full(v) },
    rows: isCF ? [] : ORIGINS.filter(k => !near0(p[k])).map(k => ({ color: ORIGIN_COLOR[k], label: `${L.origin[k]} · ${L.originLong[k]}`, value: F.full(p[k]) })),
  });

  /* ── Flujo de caja sin datos ────────────────────────────────────── */
  if (isCF && !(cfTree ?? []).some(n => !n._sectionAnchor)) {
    return <div className={styles.root}><div className={styles.emptyNote}>{L.noCf}</div></div>;
  }

  /* ── Escalas ─────────────────────────────────────────────────────── */
  const visible = showAll ? active : active.slice(0, TOP_COS);
  const restRows = showAll ? [] : active.slice(TOP_COS);
  const restAgg = restRows.length ? {
    v: restRows.reduce((a, r) => a + r.v, 0),
    p: Object.fromEntries(ORIGINS.map(k => [k, restRows.reduce((a, r) => a + r.p[k], 0)])),
  } : null;
  const barRows = [
    ...visible.map(r => ({ key: r.co, label: coName(r.co), code: r.co, v: r.v, p: r.p, kind: "co" })),
    ...(restAgg ? [{ key: "__rest", label: L.rest(restRows.length), code: "", v: restAgg.v, p: restAgg.p, kind: "rest" }] : []),
  ];
  const extent = (p) => {
    let pos = 0, neg = 0;
    ORIGINS.forEach(k => { const o = s * p[k]; if (o > 0) pos += o; else neg += o; });
    return [neg, pos];
  };
  const allExt = barRows.map(r => extent(r.p));
  const xLo = Math.min(0, ...allExt.map(e => e[0]));
  const xHi = Math.max(0, ...allExt.map(e => e[1]));
  const xTicks = niceTicks(xLo, xHi, 4);
  const dLo = Math.min(xLo, xTicks[0]), dHi = Math.max(xHi, xTicks[xTicks.length - 1]);
  const xp = (v) => ((v - dLo) / (dHi - dLo || 1)) * 100;

  // Cascada: por tipo de asiento (P&G y Balance) o por partidas / sociedades (flujo de caja)
  const wfTotal = pickRow ? pickRow.v : total;
  const MAX_STEPS = 6;
  const stack = (items) => items.reduce((acc, it) => {
    const from = acc.length ? acc[acc.length - 1].to : 0;
    return [...acc, { ...it, from, to: from + it.raw }];
  }, []);
  let wfMode = "origins";
  let rawSteps;
  if (!isCF) {
    const wfParts = pickRow ? pickRow.p : gp;
    rawSteps = ORIGINS.filter(k => k === "Uploaded" || !near0(wfParts[k])).map(k => ({
      key: k, raw: wfParts[k], color: ORIGIN_COLOR[k], label: L.origin[k], tip: `${L.origin[k]} · ${L.originLong[k]}`,
    }));
  } else {
    const ofCo = (n) => (pickRow ? engine.value(n, pickRow.co) : cols.reduce((a, co) => a + engine.value(n, co), 0));
    const items = focusHasKids
      ? kids(focus).map(n => ({ key: n.AccountCode, raw: ofCo(n), label: n.AccountName ?? n.AccountCode, code: n.AccountCode }))
      : active.map(r => ({ key: r.co, raw: r.v, label: coName(r.co), code: r.co }));
    wfMode = focusHasKids ? "lines" : "cos";
    const nz = items.filter(it => !near0(it.raw)).sort((a, b) => Math.abs(b.raw) - Math.abs(a.raw));
    const head = nz.slice(0, MAX_STEPS);
    const tail = nz.slice(MAX_STEPS);
    rawSteps = [...head, ...(tail.length ? [{ key: "__other", raw: tail.reduce((a, it) => a + it.raw, 0), label: L.otherItems(tail.length), code: "" }] : [])]
      .map(it => ({ ...it, color: it.raw >= 0 ? UP : DOWN, tip: it.code && it.code !== it.label ? `${it.code} · ${it.label}` : it.label }));
  }
  const steps = stack(rawSteps);
  steps.push({ key: "__total", from: 0, to: wfTotal, raw: wfTotal, total: true, color: INK,
    label: pickRow ? pickRow.co : L.total, tip: pickRow ? coName(pickRow.co) : L.total });
  const yVals = steps.flatMap(st => [st.from, st.to]);
  const yTicks = niceTicks(Math.min(0, ...yVals), Math.max(0, ...yVals), 4);
  const yLo = Math.min(0, ...yVals, yTicks[0]), yHi = Math.max(0, ...yVals, yTicks[yTicks.length - 1]);
  const yp = (v) => ((v - yLo) / (yHi - yLo || 1)) * 100;

  const adj = ORIGINS.filter(k => k !== "Uploaded").reduce((a, k) => a + gp[k], 0);
  const adjTop = ORIGINS.filter(k => k !== "Uploaded" && !near0(gp[k])).sort((a, b) => Math.abs(gp[b]) - Math.abs(gp[a])).slice(0, 3);
  const topCo = active[0];
  const shareOf = (v) => (sameSign ? (near0(total) ? null : (v / total) * 100) : (near0(gross) ? null : (v / gross) * 100));
  const ofLabel = sameSign ? L.ofTotal : L.ofGross;
  const top3 = active.slice(0, 3).reduce((a, r) => a + r.v, 0);
  const isEmpty = near0(total) && active.length === 0;
  // Partida principal (flujo de caja): la subpartida que más pesa
  const mainLine = (() => {
    const ks = kids(focus).map(n => ({ node: n, v: cols.reduce((a, co) => a + engine.value(n, co), 0) })).filter(r => !near0(r.v));
    if (!ks.length) return null;
    const same = ks.every(r => Math.sign(r.v) === Math.sign(total));
    const base = same ? Math.abs(total) : ks.reduce((a, r) => a + Math.abs(r.v), 0);
    const best = ks.sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    return { ...best, base, gross: !same };
  })();
  // Raíz del balance: su suma no dice nada, así que solo se muestra el mapa
  const overview = focus.AccountCode === ROOT && !rootFocusable;
  const focusLabel = focus.AccountCode === ROOT ? focus.AccountName : `${focus.AccountCode} · ${focus.AccountName ?? ""}`;
  const animKey = `${stmt}|${focus.AccountCode}`;

  /* ═══ Render ═════════════════════════════════════════════════════════ */
  return (
    <div ref={rootRef} className={styles.root} onPointerLeave={hideTip}>
      {/* Barra superior: ruta, buscador y contexto */}
      <div className={styles.top}>
        <nav className={styles.crumbs} aria-label={L.account}>
          {path.map((n, i) => {
            const last = i === path.length - 1;
            const label = n.AccountCode === ROOT ? n.AccountName : (i === 0 ? (n.AccountName ?? n.AccountCode) : (n.AccountName ?? n.AccountCode));
            const clickable = !last;
            return (
              <span key={n.AccountCode} className={styles.crumbStep}>
                {i > 0 && <ChevronRight size={13} strokeWidth={2.4} className={styles.crumbSep} aria-hidden="true" />}
                {clickable
                  ? <button type="button" className={styles.crumb} onClick={() => go(n.AccountCode)}>{label}</button>
                  : <span className={`${styles.crumb} ${last ? styles.crumbOn : styles.crumbFlat}`}>
                      {!last || n.AccountCode === ROOT ? label : <><i className={styles.crumbCode}>{n.AccountCode}</i>{label}</>}
                    </span>}
              </span>
            );
          })}
        </nav>

        <div className={styles.topRight}>
          <div className={styles.picker}>
            <Search size={13} strokeWidth={2.4} className={styles.pickerIco} aria-hidden="true" />
            <input value={query} placeholder={L.search} aria-label={L.search}
              onChange={e => { setQuery(e.target.value); setPickerOpen(true); }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 140)}
              onKeyDown={e => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }} />
            {query && <button type="button" className={styles.pickerClear} onClick={() => setQuery("")} aria-label="×"><X size={12} strokeWidth={2.6} /></button>}
            {pickerOpen && (
              <div className={styles.pickerList} role="listbox">
                {matches.length === 0 && <p className={styles.pickerNone}>{L.noMatch}</p>}
                {matches.map(({ node, depth }) => (
                  <button type="button" key={node.AccountCode} role="option" aria-selected={node.AccountCode === focus.AccountCode}
                    className={`${styles.pickerItem} ${node.AccountCode === focus.AccountCode ? styles.pickerItemOn : ""}`}
                    style={{ paddingLeft: 10 + Math.min(depth, 5) * 12 }}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { go(node.AccountCode); setQuery(""); setPickerOpen(false); }}>
                    <i>{node.AccountCode}</i><span>{node.AccountName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className={styles.chip}><i className={styles.chipDot} />{L.groupCcy(ccy)}</span>
          {periodLabel && <span className={styles.chip}>{monthly && stmt === "P/L" ? L.month(periodLabel) : L.ytd(periodLabel)}</span>}
          {mappingActive && <span className={`${styles.chip} ${styles.chipSoft}`}>{L.std}</span>}
        </div>
      </div>

      {overview && <div className={styles.hint}><Rows3 size={14} strokeWidth={2.4} />{isCF ? L.pickCf : L.pickBs}</div>}

      {/* Cifras clave */}
      {!overview && <div className={styles.kpis} key={`k-${animKey}`}>
        <div className={`${styles.kpi} ${styles.kpiHero}`} style={{ "--i": 0 }}>
          <span className={styles.kLabel}>{L.kTotal}</span>
          <strong className={styles.kHero} title={F.full(total)}><Tween value={total} format={F.short} /></strong>
          <span className={styles.kSub}>{focusLabel}</span>
          <span className={styles.kFull}>{F.full(total)} {ccy}</span>
        </div>
        <div className={styles.kpi} style={{ "--i": 1 }}>
          <span className={styles.kLabel}>{L.kTop}</span>
          {topCo ? (
            <>
              <strong className={styles.kName} title={coName(topCo.co)}>{coName(topCo.co)}</strong>
              <span className={styles.kValue}><Tween value={Math.abs(shareOf(topCo.v) ?? 0)} format={F.pct} /> <em>{ofLabel}</em></span>
              <span className={styles.meter}><i style={{ width: `${Math.max(0, Math.min(100, Math.abs(shareOf(topCo.v) ?? 0)))}%` }} /></span>
            </>
          ) : <span className={styles.kMuted}>—</span>}
        </div>
        {isCF ? (
        <div className={styles.kpi} style={{ "--i": 2 }}>
          <span className={styles.kLabel}>{L.kMain}</span>
          {mainLine ? (
            <>
              <strong className={styles.kName} title={mainLine.node.AccountName}>{mainLine.node.AccountName ?? mainLine.node.AccountCode}</strong>
              <span className={styles.kValue}>{F.short(mainLine.v)} · {F.pct(near0(mainLine.base) ? null : (Math.abs(mainLine.v) / mainLine.base) * 100)} <em>{mainLine.gross ? L.ofGross : L.ofTotal}</em></span>
              <span className={styles.meter}><i style={{ width: `${near0(mainLine.base) ? 0 : Math.min(100, (Math.abs(mainLine.v) / mainLine.base) * 100)}%` }} /></span>
            </>
          ) : <span className={styles.kSub}>{L.mainNone}</span>}
        </div>
        ) : (
        <div className={styles.kpi} style={{ "--i": 2 }}>
          <span className={styles.kLabel}>{L.kAdj}</span>
          <strong className={styles.kValueBig}><Tween value={adj} format={F.signed} /></strong>
          {adjTop.length ? (
            <span className={styles.kOrigins}>
              {adjTop.map(k => <span key={k}><i style={{ background: ORIGIN_COLOR[k] }} />{L.origin[k]} {F.signed(gp[k])}</span>)}
            </span>
          ) : <span className={styles.kSub}>{L.adjNone}</span>}
          {sameSign && !near0(total) && adjTop.length > 0 && <span className={styles.kFoot}>{F.pct((adj / total) * 100)} {L.ofTotalShort}</span>}
        </div>
        )}
        <div className={styles.kpi} style={{ "--i": 3 }}>
          <span className={styles.kLabel}>{L.kCos}</span>
          <strong className={styles.kValueBig}>{L.cosOf(active.length, cols.length)}</strong>
          <span className={styles.dots} aria-hidden="true">
            {cols.slice(0, 24).map((co, i) => <i key={co} className={i < active.length ? styles.dotOn : ""} style={{ "--i": i }} />)}
          </span>
          {active.length >= 3 && <span className={styles.kFoot}>{L.top3(F.pct(sameSign ? shareOf(top3) : (active.slice(0, 3).reduce((a, r) => a + Math.abs(r.v), 0) / (gross || 1)) * 100))}</span>}
        </div>
      </div>}

      {overview ? null : isEmpty ? (
        <div className={styles.emptyNote}>{L.empty}</div>
      ) : (
        <div className={styles.grid2}>
          {/* Aportación por sociedad */}
          <section className={styles.panel} style={{ "--i": 0 }}>
            <header className={styles.pHead}>
              <div>
                <h4><Building2 size={14} strokeWidth={2.4} />{L.byCo}</h4>
                <p>{isCF ? L.byCoSubCf : L.byCoSub}</p>
              </div>
              <InfoTip L={L} title={L.byCo} help={isCF ? L.help.byCoCf : L.help.byCo} />
            </header>
            <div className={styles.legend}>
              {!isCF && ORIGINS.filter(k => barRows.some(r => !near0(r.p[k])) || k === "Uploaded").map(k => (
                <span key={k}><i style={{ background: ORIGIN_COLOR[k] }} />{L.origin[k]}</span>
              ))}
            </div>
            <div className={styles.bars} key={`b-${animKey}`}>
              {barRows.map((r, ri) => {
                const share = r.kind === "total" ? (sameSign && !near0(total) ? 100 : null) : shareOf(r.v);
                const sel = r.kind === "co" && nav.co === r.code;
                let pos = 0, neg = 0;
                const segs = ORIGINS.map(k => {
                  const o = s * r.p[k];
                  if (near0(o)) return null;
                  const a = o > 0 ? pos : neg + o;
                  if (o > 0) pos += o; else neg += o;
                  return { k, left: xp(a), width: xp(a + Math.abs(o)) - xp(a), outerPos: false, outerNeg: false, neg: o < 0 };
                }).filter(Boolean);
                const lastPos = [...segs].reverse().find(g => !g.neg); if (lastPos) lastPos.outerPos = true;
                const lastNeg = segs.find(g => g.neg); if (lastNeg) lastNeg.outerNeg = true;
                const posSum = segs.filter(g => !g.neg).reduce((a, g) => a + g.width, 0);
                const negSum = segs.filter(g => g.neg).reduce((a, g) => a + g.width, 0);
                const mixed = Math.min(posSum, negSum) > 0.06 * (posSum + negSum) && Math.min(posSum, negSum) > 0.8;
                const clickable = r.kind === "co";
                return (
                  <div key={r.key}
                    className={`${styles.barRow} ${r.kind === "total" ? styles.barTotal : ""} ${r.kind === "rest" ? styles.barRest : ""} ${sel ? styles.barSel : ""} ${nav.co && !sel && r.kind === "co" ? styles.barDim : ""}`}
                    style={{ "--i": ri }}
                    role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                    aria-pressed={clickable ? sel : undefined}
                    onClick={clickable ? () => pickCo(r.code) : undefined}
                    onKeyDown={clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickCo(r.code); } }) : undefined}
                    onPointerMove={e => showTip(e, partsTip(r.label, r.code && r.code !== r.label ? r.code : (share != null ? `${F.pct(share)} ${ofLabel}` : ""), r.v, r.p))}
                    onFocus={e => showTip(e, partsTip(r.label, r.code, r.v, r.p))}
                    onBlur={hideTip} onPointerLeave={hideTip}>
                    <span className={styles.barName}>
                      {r.kind === "co" && <i className={styles.barCode}>{r.code}</i>}
                      <span title={r.label}>{r.label}</span>
                    </span>
                    <span className={styles.barPlot}>
                      {xTicks.map(t => <i key={`g${t}`} className={`${styles.gLine} ${t === 0 ? styles.zeroLine : ""}`} style={{ left: `${xp(t)}%` }} aria-hidden="true" />)}
                      {segs.map((g, gi) => (
                        <i key={g.k} className={`${styles.seg} ${g.outerPos ? styles.segEndR : ""} ${g.outerNeg ? styles.segEndL : ""}`}
                          style={{ left: `${g.left}%`, width: `${g.width}%`, background: ORIGIN_COLOR[g.k], "--d": `${ri * 45 + gi * 35}ms`, transformOrigin: `${g.neg ? 100 : 0}% 50%` }} />
                      ))}
                      {mixed && <b className={styles.netTick} style={{ left: `${xp(s * r.v)}%` }} />}
                    </span>
                    <span className={styles.barVal}>{F.short(r.v)}</span>
                    <span className={styles.barPct}>{share == null ? "" : F.pct0(share)}</span>
                  </div>
                );
              })}
              <div className={styles.axisRow} aria-hidden="true">
                <span />
                <span className={styles.axisPlot}>
                  {xTicks.map(t => <em key={t} style={{ left: `${xp(t)}%` }}>{F.axis(t)}</em>)}
                </span>
                <span /><span />
              </div>
              <div className={styles.barFoot}>
                <span>{L.total}</span>
                <span />
                <b>{F.short(total)}</b>
                <em>{sameSign && !near0(total) ? "100 %" : ""}</em>
              </div>
            </div>
            {active.length > TOP_COS && (
              <button type="button" className={styles.more} onClick={() => setShowAll(v => !v)}>
                {showAll ? L.showLess : L.showAll(active.length)}
              </button>
            )}
          </section>

          {/* Cómo se forma */}
          <section className={styles.panel} style={{ "--i": 1 }}>
            <header className={styles.pHead}>
              <div>
                <h4><Layers size={14} strokeWidth={2.4} />{L.build}</h4>
                <p>{wfMode === "origins" ? (pickRow ? L.buildCo(coName(pickRow.co)) : L.buildGroup)
                  : wfMode === "lines" ? (pickRow ? L.buildLinesCo(coName(pickRow.co)) : L.buildLines) : L.buildCos}</p>
              </div>
              <div className={styles.pHeadRight}>
                {pickRow && (
                  <button type="button" className={styles.pill} onClick={() => pickCo(pickRow.co)}>
                    <X size={11} strokeWidth={2.8} />{L.backGroup}
                  </button>
                )}
                <InfoTip L={L} title={L.build} help={wfMode === "origins" ? L.help.build : L.help.buildLines} />
              </div>
            </header>
            <div className={styles.wf} key={`w-${animKey}-${nav.co ?? ""}`}>
              <div className={styles.wfAxis} aria-hidden="true">
                {yTicks.map(t => <em key={t} style={{ bottom: `${yp(t)}%` }}>{F.axis(t)}</em>)}
              </div>
              <div className={styles.wfPlot}>
                {yTicks.map(t => <i key={t} className={`${styles.hLine} ${t === 0 ? styles.hZero : ""}`} style={{ bottom: `${yp(t)}%` }} aria-hidden="true" />)}
                {steps.map((st, i) => {
                  const lo = Math.min(st.from, st.to), hi = Math.max(st.from, st.to);
                  const up = st.to >= st.from;
                  const color = st.color;
                  const label = st.tip;
                  const n = steps.length;
                  return (
                    <div key={st.key} className={styles.wfCol} style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }}
                      tabIndex={0}
                      onPointerMove={e => showTip(e, { title: label, sub: focusLabel, lead: { label: L.amount, value: F.full(st.raw) }, rows: [] })}
                      onFocus={e => showTip(e, { title: label, sub: focusLabel, lead: { label: L.amount, value: F.full(st.raw) }, rows: [] })}
                      onBlur={hideTip} onPointerLeave={hideTip}>
                      <span className={`${styles.wfBar} ${st.total ? styles.wfTotal : ""} ${near0(st.raw) ? styles.wfZero : ""}`}
                        style={{ bottom: `${yp(lo)}%`, height: `max(2px, ${yp(hi) - yp(lo)}%)`, background: color, "--d": `${i * 110}ms`,
                          borderRadius: up ? "5px 5px 1px 1px" : "1px 1px 5px 5px", transformOrigin: up ? "50% 100%" : "50% 0%" }} />
                      <b className={styles.wfVal} style={{ bottom: `calc(${yp(hi)}% + 6px)`, "--d": `${i * 110 + 260}ms` }}>
                        {st.total ? F.short(st.raw) : F.signed(st.raw)}
                      </b>
                      {i < n - 1 && <i className={styles.wfLink} style={{ bottom: `${yp(st.to)}%`, "--d": `${i * 110 + 200}ms` }} aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
              <div className={styles.wfLabels} aria-hidden="true">
                {steps.map(st => (
                  <span key={st.key} className={st.total ? styles.wfLabelTotal : ""} title={st.tip}>
                    <i style={{ background: st.color }} />
                    <b>{st.label}</b>
                  </span>
                ))}
              </div>
            </div>
            <p className={styles.note}>{L.orient}</p>
          </section>
        </div>
      )}

      {/* Mapa por cuenta */}
      {heat.top.length > 0 && (
        <section className={`${styles.panel} ${styles.heatPanel}`} style={{ "--i": 2 }}>
          <header className={styles.pHead}>
            <div>
              <h4><Rows3 size={14} strokeWidth={2.4} />{L.heat}<span className={styles.pHeadCtx}>{browse.AccountCode === ROOT ? browse.AccountName : `${browse.AccountCode} · ${browse.AccountName ?? ""}`}</span></h4>
              <p>{focusHasKids ? L.heatSub : L.heatSubLeaf}</p>
            </div>
            <div className={styles.pHeadRight}>
              <div className={styles.scale} aria-hidden="true">
                <em>−100 %</em><i /><em>0</em><i className={styles.scalePos} /><em>100 %</em>
                <span>{L.scale}</span>
              </div>
              <InfoTip L={L} title={L.heat} help={L.help.heat} />
            </div>
          </header>
          <div className={styles.heatWrap} key={`h-${stmt}|${browse.AccountCode}`}>
            <table className={styles.heat}>
              <thead>
                <tr>
                  <th className={styles.hAcc}>{L.account}</th>
                  {heat.shown.map(co => (
                    <th key={co} className={nav.co === co ? styles.hColOn : ""} title={coName(co)}>
                      <b>{co}</b><span>{coName(co)}</span>
                    </th>
                  ))}
                  {heat.rest.length > 0 && <th title={heat.rest.map(coName).join(", ")}><b>{L.restShort}</b><span>{heat.rest.length}</span></th>}
                  <th className={styles.hTot}>{L.total}</th>
                </tr>
              </thead>
              <tbody>
                {heat.top.map((r, ri) => {
                  const on = r.node.AccountCode === focus.AccountCode;
                  const canDrill = kids(r.node).length > 0;
                  const restV = heat.rest.reduce((a, co) => a + r.byCo[co], 0);
                  const cell = (co, v, key, extra = "") => {
                    const sh = near0(r.base) ? null : (v / r.base) * 100;
                    const k = sh == null ? 0 : Math.max(-1, Math.min(1, sh / 100));
                    // Raíz cuadrada: más contraste en pesos pequeños sin romper el orden
                    const kk = Math.sqrt(Math.abs(k));
                    const strong = kk > 0.62;
                    const bg = near0(v) ? "transparent"
                      : k >= 0 ? `color-mix(in srgb, #1d4ed8 ${Math.round(6 + kk * 84)}%, #f4f6fb)`
                      : `color-mix(in srgb, #dc2626 ${Math.round(8 + kk * 78)}%, #fbf4f4)`;
                    return (
                      <td key={key} className={`${styles.hCell} ${extra}`}
                        onPointerMove={e => showTip(e, { title: `${r.node.AccountCode} · ${r.node.AccountName ?? ""}`, sub: co === "__rest" ? heat.rest.map(coName).join(", ") : coName(co),
                          lead: { label: r.gross ? `${L.share} · ${L.ofGross}` : L.share, value: sh == null ? "—" : F.pct(sh) }, rows: [{ color: "#1a2f8a", label: L.amount, value: F.full(v) }] })}
                        onPointerLeave={hideTip}>
                        <span className={`${styles.hChip} ${strong ? styles.hChipStrong : ""} ${near0(v) ? styles.hChipNone : ""}`}
                          style={{ background: bg, "--d": `${ri * 35}ms` }}>
                          {near0(v) ? "—" : F.pct0(sh)}
                        </span>
                      </td>
                    );
                  };
                  return (
                    <tr key={r.node.AccountCode} className={`${styles.hRow} ${on ? styles.hRowOn : ""}`} style={{ "--i": ri }}
                      tabIndex={0} role="button" aria-label={`${canDrill ? L.drill : L.focus}: ${r.node.AccountName ?? r.node.AccountCode}`}
                      onClick={() => go(r.node.AccountCode)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(r.node.AccountCode); } }}>
                      <th className={styles.hAccCell}>
                        <span className={styles.hAccIn}>
                          <i className={styles.hCode}>{r.node.AccountCode}</i>
                          <span className={styles.hName} title={r.node.AccountName}>{r.node.AccountName}</span>
                          {canDrill && <ChevronRight size={13} strokeWidth={2.6} className={styles.hGo} aria-hidden="true" />}
                        </span>
                      </th>
                      {heat.shown.map(co => cell(co, r.byCo[co], co, nav.co === co ? styles.hColOn : ""))}
                      {heat.rest.length > 0 && cell("__rest", restV, "__rest")}
                      <td className={styles.hTotCell}>
                        <span className={styles.hTotIn}>
                          <b>{F.short(r.t)}{r.gross && <sup className={styles.hStar} title={L.grossNote}>*</sup>}</b>
                          <i className={styles.hMag}><em style={{ width: `${(Math.abs(r.t) / heat.maxAbs) * 100}%`, background: r.t < 0 ? "#c2410c" : "#1a2f8a" }} /></i>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {heat.tail.length > 0 && (
                  <tr className={styles.hTail}>
                    <th className={styles.hAccCell} colSpan={1}><span className={styles.hAccIn}><span className={styles.hName}>{L.otherAcc(heat.tail.length)}</span></span></th>
                    <td colSpan={heat.shown.length + (heat.rest.length ? 1 : 0)} />
                    <td className={styles.hTotCell}><span className={styles.hTotIn}><b>{F.short(heat.tail.reduce((a, r) => a + r.t, 0))}</b></span></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {heat.anyGross && <p className={styles.note}>* {L.grossNote}</p>}
        </section>
      )}

      {/* Tooltip */}
      {tip && (
        <div className={`${styles.tip} ${tip.flip ? styles.tipFlip : ""}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
          <p className={styles.tipTitle}>{tip.title}</p>
          {tip.sub ? <p className={styles.tipSub}>{tip.sub}</p> : null}
          {tip.lead && <p className={styles.tipLead}><b>{tip.lead.value}</b><span>{tip.lead.label}</span></p>}
          {tip.rows?.map((r, i) => (
            <p key={i} className={styles.tipRow}><i style={{ background: r.color }} /><span>{r.label}</span><b>{r.value}</b></p>
          ))}
        </div>
      )}
    </div>
  );
}

/* Botón de ayuda de cada gráfico: qué se ve y cómo leerlo */
function InfoTip({ L, title, help }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const [what, how] = help;
  return (
    <span ref={ref} className={styles.info}>
      <button type="button" className={`${styles.infoBtn} ${open ? styles.infoBtnOn : ""}`} aria-expanded={open} aria-label={`${L.info} · ${title}`}
        title={L.info} onClick={() => setOpen(o => !o)}>
        <Info size={14} strokeWidth={2.4} />
      </button>
      {open && (
        <span className={styles.infoPop} role="dialog" aria-label={title}>
          <span className={styles.infoKicker}>{L.info}</span>
          <b className={styles.infoTitle}>{title}</b>
          <span className={styles.infoText}>{what}</span>
          <span className={styles.infoKicker}>{L.infoHow}</span>
          <span className={styles.infoList}>
            {String(how).split("|").map((line, i) => <span key={i}><i />{line}</span>)}
          </span>
        </span>
      )}
    </span>
  );
}

/* ─── Botón «Gráficos» de la cabecera ────────────────────────────────────
   Interruptor propio (va en headerExtra, junto a «Asientos contables»): el
   icono son tres filas de tabla que se levantan y se convierten en barras al
   pasar a gráficos, y vuelven a ser filas al volver a la tabla. */
const MORPH = {
  table:  [[3, 5, 18, 3], [3, 10.5, 18, 3], [3, 16, 18, 3]],
  charts: [[3.5, 12, 4.5, 8], [9.75, 5, 4.5, 15], [16, 9, 4.5, 11]],
};
function ViewMorphIcon({ view, size = 16 }) {
  const on = view === "charts";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={`${styles.morph} ${on ? styles.morphOn : ""}`}>
      <path className={styles.morphBase} d="M2.5 21.25h19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {MORPH[on ? "charts" : "table"].map(([x, y, w, h], i) => (
        <rect key={i} className={styles.morphBar} x="0" y="0" width="1" height="1"
          style={{ transform: `translate(${x}px, ${y}px) scale(${w}, ${h})`, transitionDelay: `${i * 70}ms` }} />
      ))}
    </svg>
  );
}
export function ChartsToggle({ locale, view, onToggle }) {
  const on = view === "charts";
  return (
    <button type="button" className={`${styles.chartsToggle} ${on ? styles.chartsToggleOn : ""}`} aria-pressed={on}
      title={t(locale, on ? "ctg_view_table_hint" : "ctg_view_charts_hint")} onClick={onToggle}>
      <ViewMorphIcon view={view} />
      <span>{t(locale, "ctg_view_charts")}</span>
      <i className={styles.chartsToggleSw} aria-hidden="true"><b /></i>
    </button>
  );
}
