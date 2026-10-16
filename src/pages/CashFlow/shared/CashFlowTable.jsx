/* ══════════════════════════════════════════════════════════════════════
   Tabla del cash flow (virtualizada). La usan el individual y el consolidado.

   Cabecera (buscador, expandir/contraer, ancho ajustable de la columna de
   cuentas, columnas por sociedad que se pueden arrastrar, comparación y
   total) y cuerpo:
     · con mapeo personalizado (cf_tree)  → árbol propio de nodos
     · con estándar (PGC / IFRS…)          → secciones + líneas
   Cada línea se despliega en sus cuentas de grupo y éstas en sus líneas
   locales y asientos.

   RENDIMIENTO: el árbol visible se aplana en una lista de filas y solo se
   pintan las que caben en pantalla (más un margen). Con todo expandido
   puede haber miles de filas; antes estaban todas en el DOM y abrir la
   barra lateral o ajustar el ancho iba a 1-2 fotogramas por segundo.
   El estado de qué está abierto vive aquí (no en cada fila), así una fila
   que sale de pantalla y vuelve conserva su estado.
   ══════════════════════════════════════════════════════════════════════ */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { fmt } from "./cashFlowUtils.js";
import { CfMultiBadge } from "./CashFlowParts.jsx";
import styles from "./CashFlow.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");

// Ancho de la columna de cuentas: por defecto, mínimo (buscador + expandir)
// y máximo; se recuerda entre visitas.
const NAME_DEFAULT = 320;
const NAME_MIN = 116;
const NAME_MAX = 640;
const NAME_KEY = "konsolidator:cf-individual:name-width";
const clampName = (w) => Math.max(NAME_MIN, Math.min(NAME_MAX, Math.round(w)));
// Anchos fijos del resto de columnas (px).
const COL_CO = 168;
// Comparación: periodo B tan ancho como el valor, Δ casi igual y Δ% estrecha.
const COL_CMP_VAL = 168;
const COL_CMP_DELTA = 156;
const COL_CMP_PCT = 108;
const COL_CMP = COL_CMP_VAL + COL_CMP_DELTA + COL_CMP_PCT;
const COL_TOTAL = 184;

// Alto de cada tipo de fila (px). Deben coincidir con el CSS (.rowH*).
const ROW_H = { section: 50, cf: 46, group: 40, local: 34, empty: 34 };
const OVERSCAN = 480; // px pintados por encima y por debajo de lo visible

// Clase de color de un importe: cero (gris), negativo (rojo) o normal.
const toneOf = (v) => (Math.round((v ?? 0) * 100) === 0 ? styles.zero : v < 0 ? styles.neg : null);
// Clase de color de una variación: sube (verde), baja (rojo) o sin cambio.
// Variación: sube (verde) / baja (rojo) / sin cambio, con un tinte suave.
const deltaTone = (v) => (!v ? styles.zero : v > 0 ? styles.up : styles.down);
const deltaPill = (v) => (!v ? null : v > 0 ? styles.deltaUp : styles.deltaDown);
// Signo explícito (+ / −) en la diferencia y en el porcentaje.
export const signed = (v, text) => (v > 0 ? `+${text}` : v < 0 ? `−${text}` : text);
export const deltaText = (d) => (Math.round(d * 100) === 0 ? "—" : signed(d, fmt(Math.abs(d))));
const pctFmt = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctRound = (p) => (p === null ? null : Math.round(p * 10) / 10);
export const pctText = (p) => {
  const r = pctRound(p);
  if (r === null) return "—";
  return `${signed(r, pctFmt.format(Math.abs(r)))}%`;
};

/* ─── Número que cuenta hasta su valor (solo cuando cambia) ─────────── */
function useCountUp(target, duration) {
  const to = Number(target) || 0;
  const [display, setDisplay] = useState(to);
  const shownRef = useRef(to);
  const rafRef = useRef(null);
  useEffect(() => {
    const from = shownRef.current;
    if (from === to) return undefined;
    cancelAnimationFrame(rafRef.current);
    let start = null;
    const tick = (ts) => {
      if (start === null) start = ts;
      const k = Math.min(1, (ts - start) / duration);
      const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      shownRef.current = v;
      setDisplay(v);
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to, duration]);
  return display;
}

const AmountCell = memo(function AmountCell({ value, col, className, style }) {
  const animated = useCountUp(value ?? 0, 700);
  const empty = Math.round((value ?? 0) * 100) === 0;
  return (
    <td data-col={col} className={cx(styles.amt, toneOf(value), className)} style={style}>
      <span className={styles.amtVal}>{empty ? "—" : fmt(animated)}</span>
    </td>
  );
});

const StaticCell = ({ value, col, className, style }) => (
  <td data-col={col} className={cx(styles.amt, toneOf(value), className)} style={style}>
    <span className={styles.amtVal}>{Math.round((value ?? 0) * 100) === 0 ? "—" : fmt(value)}</span>
  </td>
);

/* ─── Texto que, si no cabe, se desplaza de lado a lado al pasar el ratón ─ */
function MarqueeText({ text, className }) {
  const ref = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const extra = el.scrollWidth - el.clientWidth;
      setShift(extra > 1 ? extra + 6 : 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={ref} title={text}
      className={cx(styles.marquee, shift > 0 && styles.marqueeOn, className)}
      style={{ "--shift": `-${shift}px`, "--dur": `${Math.max(2.2, shift / 28).toFixed(2)}s` }}>
      <span className={styles.marqueeText}>{text}</span>
    </span>
  );
}

// Celdas de comparación de una sociedad: periodo B, Δ y Δ%.
function CompareCells({ col, val, cmpVal, typo, rowClass }) {
  const delta = Math.round((val - cmpVal) * 100) / 100;
  const pct = Math.abs(cmpVal) > 1e-9 ? ((val - cmpVal) / Math.abs(cmpVal)) * 100 : null;
  const pr = pctRound(pct);
  return (
    <>
      <td data-col={col + 1} className={cx(styles.amt, styles.cmp1, toneOf(cmpVal), rowClass)} style={typo}>
        <span className={styles.amtVal}>{Math.round(cmpVal * 100) === 0 ? "—" : fmt(cmpVal)}</span>
      </td>
      <td data-col={col + 2} className={cx(styles.amt, styles.cmp2, deltaTone(delta), deltaPill(delta), rowClass)} style={typo}>
        <span className={styles.amtVal}>{deltaText(delta)}</span>
      </td>
      <td data-col={col + 3} className={cx(styles.amt, styles.cmp3, pr === null ? styles.zero : deltaTone(pr), deltaPill(pr), rowClass)} style={typo}>
        <span className={styles.amtVal}>{pctText(pct)}</span>
      </td>
    </>
  );
}

const EmptyCmp = ({ col }) => (
  <>
    <td data-col={col + 1} className={cx(styles.amt, styles.cmp1, styles.zero)}>—</td>
    <td data-col={col + 2} className={cx(styles.amt, styles.cmp2, styles.zero)}>—</td>
    <td data-col={col + 3} className={cx(styles.amt, styles.cmp3, styles.zero)}>—</td>
  </>
);

// Nº de columna (1-based, la 1 es la de cuentas) de la sociedad i.
const colOf = (i, compareMode) => 2 + i * (compareMode ? 4 : 1);

/* ─── Desglose de una línea en cuentas de grupo, líneas locales y asientos ─
   Misma agrupación para las dos filas (estándar y mapeo personalizado).  */
function buildDrillGroups({ code, uploadedData, journalEntries, groupToCf, q }) {
  const byGroup = new Map();
  const bucket = (groupCode, groupName) => {
    if (!byGroup.has(groupCode)) byGroup.set(groupCode, { groupCode, groupName: groupName ?? "", rowMap: new Map() });
    return byGroup.get(groupCode);
  };
  uploadedData.forEach(r => {
    const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
    const co = r.CompanyShortName ?? r.companyShortName ?? "";
    if (!(groupToCf?.get(groupCode) ?? []).includes(code)) return;
    const origin = r.Origin ?? r.origin ?? "";
    const local = r.LocalAccountCode ?? r.localAccountCode ?? "";
    if (origin === "Journal" || !local) return; // los asientos van por journalEntries
    const b = bucket(groupCode, r.AccountName ?? r.accountName);
    const key = `ERP::${local}::${co}`;
    if (!b.rowMap.has(key)) b.rowMap.set(key, { localCode: local, localName: r.LocalAccountName ?? r.localAccountName ?? "", isJournal: false, co, amt: 0 });
    b.rowMap.get(key).amt += Number(r.AmountYTD ?? r.amountYTD ?? 0);
  });
  journalEntries.forEach(j => {
    const groupCode = String(j.AccountCode ?? j.accountCode ?? "");
    const co = j.CompanyShortName ?? j.companyShortName ?? "";
    if (!(groupToCf?.get(groupCode) ?? []).includes(code)) return;
    const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
    const b = bucket(groupCode, j.AccountName ?? j.accountName);
    const key = `JRN::${jn}::${co}`;
    if (!b.rowMap.has(key)) {
      b.rowMap.set(key, {
        localCode: jn || "JRN",
        localName: (j.JournalHeader ?? j.journalHeader) || (j.JournalType ?? j.journalType) || "Journal",
        isJournal: true, co, amt: 0,
      });
    }
    b.rowMap.get(key).amt += Number(j.AmountYTD ?? j.amountYTD ?? 0);
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
  if (q) {
    result = result
      .map(g => {
        const self = g.groupCode.toLowerCase().includes(q) || (g.groupName || "").toLowerCase().includes(q);
        const locals = g.localRows.filter(lr => self || (lr.localCode || "").toLowerCase().includes(q) || (lr.localName || "").toLowerCase().includes(q));
        return { ...g, localRows: locals, _self: self };
      })
      .filter(g => g._self || g.localRows.length > 0);
  }
  return result;
}

// Importes del periodo de comparación con las mismas claves que el desglose.
function buildCmpDrillMap({ code, cmpUploadedData, cmpJournalEntries, groupToCf }) {
  const m = new Map();
  const add = (k, v) => m.set(k, (m.get(k) ?? 0) + v);
  cmpUploadedData.forEach(r => {
    const gc = String(r.AccountCode ?? r.accountCode ?? "");
    const co = r.CompanyShortName ?? r.companyShortName ?? "";
    if (!(groupToCf?.get(gc) ?? []).includes(code)) return;
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
    if (!(groupToCf?.get(gc) ?? []).includes(code)) return;
    const jn = String(j.JournalNumber ?? j.journalNumber ?? "");
    const amt = Number(j.AmountYTD ?? j.amountYTD ?? 0);
    add(`GRP::${gc}::${co}`, amt);
    add(`JRN::${gc}::${jn}::${co}`, amt);
  });
  return m;
}

// Hojas de un nodo del mapeo (cacheadas por nodo).
const leafCache = new WeakMap();
export function leafCodesOf(node) {
  if (leafCache.has(node)) return leafCache.get(node);
  const out = [];
  const walk = (n) => { if (!n.children?.length) out.push(n.code); else n.children.forEach(walk); };
  walk(node);
  leafCache.set(node, out);
  return out;
}

// Cachés por línea del desglose y de la comparación (se crean de nuevo cuando
// cambian los datos o la búsqueda).
export function makeDrillCache(args) {
  const cache = new Map();
  return (code) => {
    if (!cache.has(code)) cache.set(code, buildDrillGroups({ ...args, code }));
    return cache.get(code);
  };
}
export function makeCmpCache(args) {
  const cache = new Map();
  return (code) => {
    if (!cache.has(code)) cache.set(code, buildCmpDrillMap({ ...args, code }));
    return cache.get(code);
  };
}

// Líneas de cash flow con algo debajo (alguna cuenta de grupo con datos).
export function underlyingCodes(lists, groupToCf) {
  const set = new Set();
  lists.forEach(list => list.forEach(r => {
    const gc = String(r.AccountCode ?? r.accountCode ?? "");
    (groupToCf?.get(gc) ?? []).forEach(cf => set.add(cf));
  }));
  return set;
}

const sumLeaves = (pv, leafCodes, company) => {
  let total = 0;
  for (const lc of leafCodes) for (const r of pv?.get(lc)?.[company] ?? []) total += Number(r._cfAmount ?? 0);
  return total;
};

/* ══════════════════════════════════════════════════════════════════════
   Filas del cash flow en orden de pantalla (secciones, líneas, cuentas de
   grupo y líneas locales). Lo usan la tabla y la exportación a Excel/PDF,
   así las tres salen con las mismas filas, en el mismo orden y con los
   mismos importes.
     · openState / collapsed: qué está abierto en pantalla.
     · full = false → solo lo visible en pantalla.
     · full = true  → todo el árbol; cada fila lleva `shown` (si se ve en
       pantalla), para que el Excel la deje desplegada o agrupada.
   ══════════════════════════════════════════════════════════════════════ */
export function buildCfItems({
  cfLiteral, sectionOrder, bySection, activeCfMapping, subtotalCodes, matchedCfCodes, nameFor,
  primary, q, openState, collapsed, underlying, drillFor, cmpFor, compareMode, full = false,
}) {
  const out = [];
  const isOpen = (key) => (q ? true : openState.all ? !openState.toggled.has(key) : openState.toggled.has(key));
  const matches = (code, name) => !!q && (String(code).toLowerCase().includes(q) || String(name || "").toLowerCase().includes(q));
  const emptyMap = new Map();

  const pushCf = ({ key, code, name, depth, isSum, node, children, rowIndex, shown }) => {
    const hasChildren = !!children?.length;
    const expandable = hasChildren || (!isSum && underlying.has(code));
    const open = expandable && isOpen(key);
    out.push({
      type: "cf", key, code, name, depth, rowIndex, expandable, open, shown,
      isSum: isSum || hasChildren, leafCodes: node ? leafCodesOf(node) : [code], match: matches(code, name),
    });
    if (!expandable || (!open && !full)) return;
    const childShown = shown && open;
    if (hasChildren) {
      children.forEach((ch, ci) => pushCf({
        key: `${key}/${ch.code}-${ci}`, code: ch.code, name: ch.name || nameFor(ch.code) || "",
        depth: depth + 1, isSum: !!ch.children?.length, node: ch, children: ch.children, rowIndex: rowIndex + ci + 1,
        shown: childShown,
      }));
      return;
    }
    const groups = drillFor(code);
    if (!groups.length) { out.push({ type: "empty", key: `${key}#empty`, depth, shown: childShown }); return; }
    const cmpMap = compareMode ? cmpFor(code) : emptyMap;
    groups.forEach(g => {
      const gkey = `${key}#${g.groupCode}`;
      const gOpen = isOpen(gkey);
      out.push({ type: "group", key: gkey, g, cmpMap, depth, open: gOpen, shown: childShown, match: matches(g.groupCode, g.groupName) });
      if (gOpen || full) g.localRows.forEach((r, li) => out.push({
        type: "local", key: `${gkey}#${li}`, r, g, cmpMap, depth, shown: childShown && gOpen, match: matches(r.localCode, r.localName),
      }));
    });
  };

  if (cfLiteral) {
    cfLiteral.forEach((section, secIdx) => {
      const skey = `map-${secIdx}`;
      const nodes = section.nodes.filter(n => !matchedCfCodes || matchedCfCodes.extended.has(String(n.code)));
      const isCollapsed = collapsed.has(skey) && !q;
      if (section.label) out.push({ type: "section", key: `sec:${skey}`, skey, label: section.label, color: section.color || primary, count: nodes.length, collapsed: isCollapsed, shown: true });
      if (isCollapsed && !full) return;
      nodes.forEach((n, idx) => pushCf({
        key: `m:${secIdx}:${n.id ?? n.code}-${idx}`, code: n.code, name: n.name || nameFor(n.code) || "",
        depth: 0, isSum: !!n.children?.length, node: n, children: n.children, rowIndex: idx, shown: !isCollapsed,
      }));
    });
  } else {
    sectionOrder.forEach(sec => {
      const codes = bySection.get(sec);
      if (!codes || codes.length === 0) return;
      const secInfo = activeCfMapping?.sections?.get(sec);
      const shownCodes = codes.filter(code => !matchedCfCodes || matchedCfCodes.direct.has(String(code)));
      const isCollapsed = collapsed.has(sec) && !q;
      out.push({ type: "section", key: `sec:${sec}`, skey: sec, label: secInfo?.label || sec, color: secInfo?.color || primary, count: shownCodes.length, collapsed: isCollapsed, shown: true });
      if (isCollapsed && !full) return;
      shownCodes.forEach((code, idx) => pushCf({
        key: `s:${code}`, code, name: nameFor(code), depth: 0, isSum: subtotalCodes.has(code), node: null, children: null, rowIndex: idx,
        shown: !isCollapsed,
      }));
    });
  }
  return out;
}

/* ─── Filas (memorizadas: solo se repintan si cambia su propia fila) ──── */
const CfRowView = memo(function CfRowView({ it, onToggle, ctx }) {
  const { visibleCompanies, compareMode, typo, num, pivot, cmpPivot, intro } = ctx;
  const bold = it.isSum;
  const total = visibleCompanies.reduce((s, c) => s + sumLeaves(pivot, it.leafCodes, c), 0);
  return (
    <tr className={cx(styles.row, styles.cfRow, styles.rowHcf, intro && it.rowIndex < 36 && it.depth === 0 && styles.rowAnim,
        it.isSum && styles.sumRow, it.expandable && styles.clickable, it.open && styles.rowOpen, it.match && styles.match)}
      style={{ "--i": Math.min(it.rowIndex, 25), "--depth": it.depth }}
      onClick={it.expandable ? () => onToggle(it.key) : undefined}
      aria-expanded={it.expandable ? it.open : undefined}>
      <td data-col={1} className={styles.nameCell}>
        <div className={styles.nameInner}>
          {it.expandable
            ? <ChevronDown size={11} className={cx(styles.chev, it.open && styles.chevOpen)} />
            : <span className={styles.chevSpace} />}
          <span className={styles.code} style={typo.sub}>{it.code}</span>
          <span className={styles.name} style={bold ? typo.body1Bold : typo.body1}>{it.name}</span>
        </div>
      </td>
      {visibleCompanies.map((c, i) => {
        const col = colOf(i, compareMode);
        const val = sumLeaves(pivot, it.leafCodes, c);
        return (
          <Fragment key={c}>
            <AmountCell value={val} col={col} style={bold ? num.body1Bold : num.body1} />
            {compareMode && <CompareCells col={col} val={val} cmpVal={sumLeaves(cmpPivot, it.leafCodes, c)} typo={bold ? num.body1Bold : num.body1} />}
          </Fragment>
        );
      })}
      {!compareMode && (
        <AmountCell value={total} col={colOf(visibleCompanies.length, false)} className={styles.totalCell} style={num.body1Bold} />
      )}
    </tr>
  );
});

const GroupRowView = memo(function GroupRowView({ it, onToggle, ctx }) {
  const { visibleCompanies, compareMode, typo, num } = ctx;
  const { g, cmpMap } = it;
  const byCo = {};
  visibleCompanies.forEach(c => { byCo[c] = g.localRows.filter(r => r.co === c).reduce((s, r) => s + r.amt, 0); });
  const total = visibleCompanies.reduce((s, c) => s + byCo[c], 0);
  return (
    <tr className={cx(styles.row, styles.drillRow, styles.rowHgroup, it.match && styles.match)} style={{ "--depth": it.depth }}
      onClick={() => onToggle(it.key)} aria-expanded={it.open}>
      <td data-col={1} className={cx(styles.nameCell, styles.drillName)}>
        <div className={styles.nameInner}>
          <ChevronDown size={11} className={cx(styles.chev, it.open && styles.chevOpen)} />
          <span className={styles.code} style={typo.sub}>{g.groupCode}</span>
          {g.groupName && <span className={styles.name} style={typo.body2}>{g.groupName}</span>}
        </div>
      </td>
      {visibleCompanies.map((c, i) => {
        const col = colOf(i, compareMode);
        return (
          <Fragment key={c}>
            <StaticCell value={byCo[c]} col={col} style={num.body2} />
            {compareMode && <CompareCells col={col} val={byCo[c]} cmpVal={cmpMap.get(`GRP::${g.groupCode}::${c}`) ?? 0} typo={num.body2} />}
          </Fragment>
        );
      })}
      {!compareMode && <StaticCell value={total} col={colOf(visibleCompanies.length, false)} className={styles.totalCell} style={num.body2} />}
    </tr>
  );
});

const LocalRowView = memo(function LocalRowView({ it, ctx }) {
  const { visibleCompanies, compareMode, typo, num } = ctx;
  const { r, g, cmpMap } = it;
  return (
    <tr className={cx(styles.row, styles.localRow, styles.rowHlocal, it.match && styles.match)} style={{ "--depth": it.depth }}>
      <td data-col={1} className={cx(styles.nameCell, styles.localName)}>
        <div className={styles.nameInner}>
          <span className={cx(styles.code, r.isJournal && styles.journalTag)} style={typo.sub}>{r.localCode}</span>
          <span className={styles.name} style={typo.sub}>{r.localName}</span>
        </div>
      </td>
      {visibleCompanies.map((c, ci) => {
        const col = colOf(ci, compareMode);
        const mine = r.co === c;
        const v = mine ? r.amt : 0;
        const localKey = r.isJournal ? `JRN::${g.groupCode}::${r.localCode}::${c}` : `ERP::${g.groupCode}::${r.localCode}::${c}`;
        return (
          <Fragment key={c}>
            <StaticCell value={v} col={col} style={num.sub} />
            {compareMode && (mine ? <CompareCells col={col} val={v} cmpVal={cmpMap.get(localKey) ?? 0} typo={num.sub} /> : <EmptyCmp col={col} />)}
          </Fragment>
        );
      })}
      {!compareMode && <StaticCell value={r.amt} col={colOf(visibleCompanies.length, false)} className={styles.totalCell} style={num.sub} />}
    </tr>
  );
});

/* ─── Fila de sección (Explotación / Inversión / Financiación…) ───────── */
function SectionRow({ label, color, span, count, collapsed, onToggle }) {
  // Una sola celda que ocupa toda la fila: la barra es continua (sin cortes
  // entre columnas) y el título se queda fijo a la izquierda al desplazar.
  return (
    <tr className={cx(styles.sectionRow, styles.rowHsection, collapsed && styles.sectionCollapsed)} style={{ "--sec": color }}
      onClick={onToggle} aria-expanded={!collapsed}>
      <td colSpan={span + 1} className={styles.sectionCell}>
        <div className={styles.sectionBar}>
          <span className={styles.sectionInner}>
            <ChevronDown size={13} strokeWidth={2.6} className={styles.sectionChev} />
            <span className={styles.sectionTitle}>{label}</span>
            {count != null && <span className={styles.sectionCount}>{count}</span>}
          </span>
        </div>
      </td>
    </tr>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   Tabla completa
   ══════════════════════════════════════════════════════════════════════ */
export default function CashFlowTable({
  T, colors, typo, loading,
  // columnas
  companies, orderedVisibleCompanies, getLegal, compareMode,
  colOrder, setColOrder, draggingCol, setDraggingCol, dragOverCol, setDragOverCol,
  // buscador y expandir
  searchActive, setSearchActive, searchQuery, setSearchQuery, searchInputRef,
  toggleExpandAll, anyRowOpen, expandAllState, expandAllVersion, bumpOpenCount,
  // datos
  cfLiteral, sectionOrder, bySection, activeCfMapping, subtotalCodes, matchedCfCodes, nameFor,
  pivot, cmpPivot, uploadedData, journalEntries, cmpUploadedData, cmpJournalEntries, groupToCf,
  onViewState = null,
  // Multiperiodo: qué se está sumando (null con un solo mes)
  multiPeriods = null,
}) {
  // ── Ancho de la columna de cuentas (arrastrando su borde) ──────────
  const outerRef = useRef(null);
  const scrollRef = useRef(null);
  const [nameW, setNameW] = useState(() => {
    try { return clampName(Number(localStorage.getItem(NAME_KEY)) || NAME_DEFAULT); } catch { return NAME_DEFAULT; }
  });
  const [resizing, setResizing] = useState(false);
  useEffect(() => { try { localStorage.setItem(NAME_KEY, String(nameW)); } catch { /* sin almacenamiento */ } }, [nameW]);
  // Mientras se arrastra se cambia la variable CSS directamente en el DOM
  // (una vez por fotograma); el estado se actualiza al soltar.
  const startResize = (e) => {
    e.preventDefault();
    const el = outerRef.current;
    const startX = e.clientX;
    const startW = nameW;
    let next = startW;
    let raf = 0;
    setResizing(true);
    const move = (ev) => {
      next = clampName(startW + ev.clientX - startX);
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; el?.style.setProperty("--cf-name-w", `${next}px`); });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      el?.style.setProperty("--cf-name-w", `${next}px`);
      setResizing(false);
      setNameW(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Ancho visible (separadores de sección) en el DOM; alto visible y scroll
  // en el estado (solo para decidir qué filas se pintan).
  const [viewH, setViewH] = useState(800);
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    const el = outerRef.current;
    const sc = scrollRef.current;
    if (!el || !sc || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      el.style.setProperty("--cf-view-w", `${Math.round(el.clientWidth)}px`);
      setViewH(h => (Math.abs(h - sc.clientHeight) > 40 ? sc.clientHeight : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scrollRaf = useRef(0);
  const onScroll = () => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const top = scrollRef.current?.scrollTop ?? 0;
      // Solo se re-renderiza cuando el desplazamiento cambia lo bastante como
      // para que entren o salgan filas (no en cada píxel).
      setScrollTop(prev => (Math.abs(prev - top) > 120 ? top : prev));
    });
  };

  const nCols = 1 + orderedVisibleCompanies.length * (compareMode ? 4 : 1) + (compareMode ? 0 : 1);
  const fixedColsW = orderedVisibleCompanies.length * (COL_CO + (compareMode ? COL_CMP : 0)) + (compareMode ? 0 : COL_TOTAL);

  // ── Qué está abierto: modo "todo abierto/cerrado" + excepciones ───────
  const [openState, setOpenState] = useState(() => ({ all: expandAllState, toggled: new Set() }));
  const [seenVersion, setSeenVersion] = useState(expandAllVersion);
  if (seenVersion !== expandAllVersion) {
    setSeenVersion(expandAllVersion);
    setOpenState({ all: expandAllState, toggled: new Set() });
  }
  // El aviso al padre (bumpOpenCount) va fuera del actualizador de estado:
  // dentro, React avisa de que se actualiza un componente mientras se pinta otro.
  const openStateRef = useRef(openState);
  useLayoutEffect(() => { openStateRef.current = openState; }, [openState]);
  const onToggle = useCallback((key) => {
    const prev = openStateRef.current;
    const toggled = new Set(prev.toggled);
    if (toggled.has(key)) toggled.delete(key); else toggled.add(key);
    const next = { ...prev, toggled };
    openStateRef.current = next;
    setOpenState(next);
    if (!prev.all) bumpOpenCount?.((prev.all ? !toggled.has(key) : toggled.has(key)) ? 1 : -1);
  }, [bumpOpenCount]);

  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleSection = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Animación de entrada solo durante la primera carga de cada conjunto de datos.
  const [intro, setIntro] = useState(true);
  const [introFor, setIntroFor] = useState(pivot);
  if (introFor !== pivot) { setIntroFor(pivot); setIntro(true); }
  useEffect(() => {
    const id = setTimeout(() => setIntro(false), 1600);
    return () => clearTimeout(id);
  }, [pivot]);

  // ── Árbol visible aplanado ───────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  const underlying = useMemo(
    () => underlyingCodes([uploadedData, journalEntries, cmpUploadedData], groupToCf),
    [uploadedData, journalEntries, cmpUploadedData, groupToCf],
  );
  const drillFor = useMemo(() => makeDrillCache({ uploadedData, journalEntries, groupToCf, q }), [uploadedData, journalEntries, groupToCf, q]);
  const cmpFor = useMemo(() => makeCmpCache({ cmpUploadedData, cmpJournalEntries, groupToCf }), [cmpUploadedData, cmpJournalEntries, groupToCf]);

  const items = useMemo(() => buildCfItems({
    cfLiteral, sectionOrder, bySection, activeCfMapping, subtotalCodes, matchedCfCodes, nameFor,
    primary: colors.primary, q, openState, collapsed, underlying, drillFor, cmpFor, compareMode,
  }), [cfLiteral, sectionOrder, bySection, activeCfMapping, subtotalCodes, matchedCfCodes, nameFor, colors.primary,
    q, openState, collapsed, underlying, drillFor, cmpFor, compareMode]);

  // Estado de la vista para la exportación (qué está abierto / plegado):
  // así el Excel y el PDF salen con la misma estructura que la pantalla.
  useLayoutEffect(() => {
    onViewState?.({ openState, collapsed });
  }, [onViewState, openState, collapsed]);

  // ── Ventana visible ──────────────────────────────────────────────────
  const offsets = useMemo(() => {
    const o = new Array(items.length + 1);
    o[0] = 0;
    for (let i = 0; i < items.length; i++) o[i + 1] = o[i] + ROW_H[items[i].type];
    return o;
  }, [items]);
  const totalH = offsets[items.length];
  const findIndex = (y) => {
    let lo = 0, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid + 1] <= y) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const from = findIndex(Math.max(0, scrollTop - OVERSCAN));
  const to = Math.min(items.length, findIndex(scrollTop + viewH + OVERSCAN) + 1);
  const padTop = offsets[from];
  const padBottom = totalH - offsets[to];

  // Para las cifras se usa la tipografía SIN su color: el color lo ponen las
  // clases (negativo, sube, baja…). Con el color de la tipografía en línea,
  // las variaciones salían todas en el color del texto.
  const ctx = useMemo(() => {
    const noColor = (st) => { if (!st) return st; const { color: _color, ...rest } = st; return rest; };
    const num = { body1: noColor(typo.body1), body1Bold: noColor(typo.body1Bold), body2: noColor(typo.body2), sub: noColor(typo.sub) };
    return { visibleCompanies: orderedVisibleCompanies, compareMode, typo, num, pivot, cmpPivot, intro };
  }, [orderedVisibleCompanies, compareMode, typo, pivot, cmpPivot, intro]);

  const dropOn = (c) => {
    if (!draggingCol || draggingCol === c) { setDraggingCol(null); setDragOverCol(null); return; }
    const cols = colOrder ?? [...orderedVisibleCompanies];
    const fromI = cols.indexOf(draggingCol);
    const toI = cols.indexOf(c);
    if (fromI === -1 || toI === -1) { setDraggingCol(null); setDragOverCol(null); return; }
    const next = [...cols];
    next.splice(fromI, 1);
    next.splice(toI, 0, draggingCol);
    setColOrder(next);
    setDraggingCol(null);
    setDragOverCol(null);
  };

  return (
    <div ref={outerRef} className={styles.scrollOuter}
      style={{ "--cf-primary": colors.primary, "--cf-name-w": `${nameW}px`, "--cf-fixed-w": `${fixedColsW}px` }}>
      {loading && <div className={styles.loadingBar}><span /></div>}
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
        <table className={styles.table}>
          <colgroup>
            <col className={styles.colName} />
            {orderedVisibleCompanies.map(c => (
              <Fragment key={c}>
                <col style={{ width: COL_CO }} />
                {compareMode && <><col style={{ width: COL_CMP_VAL }} /><col style={{ width: COL_CMP_DELTA }} /><col style={{ width: COL_CMP_PCT }} /></>}
              </Fragment>
            ))}
            {!compareMode && <col style={{ width: COL_TOTAL }} />}
          </colgroup>
          <thead className={styles.thead}>
            <tr>
              <th data-col={1} className={styles.thName}>
                <span className={cx(styles.resizer, resizing && styles.resizerOn)} role="separator" aria-orientation="vertical"
                  aria-label={T("cf_resize_names", "Ancho de la columna de cuentas")}
                  title={T("cf_resize_names", "Ancho de la columna de cuentas")}
                  aria-valuemin={NAME_MIN} aria-valuemax={NAME_MAX} aria-valuenow={nameW} tabIndex={0}
                  onPointerDown={startResize} onDoubleClick={() => setNameW(NAME_DEFAULT)}
                  onKeyDown={e => {
                    if (e.key === "ArrowLeft") setNameW(w => clampName(w - 20));
                    if (e.key === "ArrowRight") setNameW(w => clampName(w + 20));
                  }} />
                <div className={styles.thNameInner}>
                  <div className={styles.searchWrap}>
                    <button type="button" className={cx(styles.iconBtn, searchActive && styles.iconBtnOn)}
                      onClick={() => setSearchActive(a => !a)} title={T("dim_search_tooltip") || "Search"}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="7" cy="7" r="5" /><path d="M11 11 L14 14" />
                      </svg>
                    </button>
                    {searchActive ? (
                      <>
                        <input ref={searchInputRef} type="text" value={searchQuery} className={styles.searchInput}
                          onChange={e => setSearchQuery(e.target.value)}
                          onKeyDown={e => { if (e.key === "Escape") { setSearchActive(false); setSearchQuery(""); } }}
                          placeholder={T("search_code_or_name") || "Search code or name"} />
                        <button type="button" className={styles.iconBtn} title={T("close_search") || "Close"}
                          onClick={() => { setSearchActive(false); setSearchQuery(""); }}>
                          <X size={12} strokeWidth={2.2} />
                        </button>
                      </>
                    ) : (
                      <button type="button" className={styles.thTitle} onClick={() => setSearchActive(true)}>
                        <span className={styles.thTitleMain}>{T("col_account")}</span>
                        <span className={styles.thTitleSub}>{T("nav_cashflow")}</span>
                      </button>
                    )}
                    {!searchActive && multiPeriods?.length ? <CfMultiBadge periods={multiPeriods} /> : null}
                  </div>
                  <button type="button" className={styles.iconBtn} onClick={toggleExpandAll}
                    title={anyRowOpen ? T("pl_collapse_all") : T("pl_expand_all")}>
                    <span key={anyRowOpen ? "collapse" : "expand"} className={styles.iconMorph}>
                      {expandAllState ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 3 L13 13" /><path d="M13 3 L3 13" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 6 L8 2 L14 6" /><path d="M2 10 L8 14 L14 10" />
                        </svg>
                      )}
                    </span>
                  </button>
                </div>
              </th>
              {orderedVisibleCompanies.map((c, i) => {
                const ccy = companies.find(x => x.CompanyShortName === c)?.CurrencyCode || "—";
                const col = colOf(i, compareMode);
                return (
                  <Fragment key={c}>
                    <th data-col={col} draggable
                      className={cx(styles.thCo, dragOverCol === c && styles.thDrop, draggingCol === c && styles.thDragging)}
                      onDragStart={() => setDraggingCol(c)}
                      onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
                      onDragLeave={() => setDragOverCol(null)}
                      onDrop={e => { e.preventDefault(); dropOn(c); }}
                      onDragEnd={() => { setDraggingCol(null); setDragOverCol(null); }}>
                      <MarqueeText text={getLegal(c)} className={styles.thCoName} />
                      <span className={styles.thCoCcy}>{ccy}</span>
                    </th>
                    {compareMode && <th data-col={col + 1} className={cx(styles.thCmp, styles.cmp1)}>CMP</th>}
                    {compareMode && <th data-col={col + 2} className={cx(styles.thCmp, styles.cmp2)}>Δ</th>}
                    {compareMode && <th data-col={col + 3} className={cx(styles.thCmp, styles.cmp3)}>Δ%</th>}
                  </Fragment>
                );
              })}
              {!compareMode && (
                <th data-col={colOf(orderedVisibleCompanies.length, false)} className={styles.thTotal}>{T("col_total")}</th>
              )}
            </tr>
          </thead>

          <tbody>
            {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={nCols} className={styles.spacer} /></tr>}
            {items.slice(from, to).map(it => {
              if (it.type === "section") {
                return (
                  <SectionRow key={it.key} label={it.label} color={it.color} span={nCols - 1}
                    count={it.count} collapsed={it.collapsed} onToggle={() => toggleSection(it.skey)} />
                );
              }
              if (it.type === "cf") return <CfRowView key={it.key} it={it} onToggle={onToggle} ctx={ctx} />;
              if (it.type === "group") return <GroupRowView key={it.key} it={it} onToggle={onToggle} ctx={ctx} />;
              if (it.type === "local") return <LocalRowView key={it.key} it={it} ctx={ctx} />;
              return (
                <tr key={it.key} className={cx(styles.emptyRow, styles.rowHlocal)}>
                  <td colSpan={nCols}>{T ? T("cf_no_underlying") : "No underlying accounts"}</td>
                </tr>
              );
            })}
            {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={nCols} className={styles.spacer} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}