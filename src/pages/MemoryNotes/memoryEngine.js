/* ══════════════════════════════════════════════════════════════════════
   Motor de la memoria: construye las tablas de cada nota a partir del plan
   de cuentas del grupo (con sus cc_tag) y de los importes del periodo.

   ctx = {
     accounts: [{ code, name, type, isSum, depth }] (orden del plan),
     childrenOf: Map(code → [hijos]),
     ccTagToCodes: Map("BS_02-PP&E" → [códigos]),
     value(code, periodKey) → número | null (null = aún cargando),
   }
   periodKey: "cur" (periodo de la memoria), "prevYE" (cierre del año
   anterior) y "prevSame" (mismo mes del año anterior).
   ══════════════════════════════════════════════════════════════════════ */

import { L } from "./memoryI18n.js";

// Par [clave, etiqueta] cuya etiqueta se traduce al leerla (destructuring incluido)
const pair = (k, key, es) => { const a = [k]; Object.defineProperty(a, 1, { get: () => L(key, es), enumerable: true }); return a; };

const strip = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Clasificación de cuentas de movimiento por su nombre (plan con "rollforward")
const KINDS = [
  ["opening", /(al inicio|inicio del ejercicio|a principio|saldo inicial|apertura|beginning|opening)/],
  ["fx", /(tipo de cambio|diferencias de conversion|exchange rate|translation)/],
  ["transfer", /(traspaso|transferencia|reclasific|transfer)/],
  ["disposal", /(baja|enajenac|desinvers|disminuc|retiro|disposal|retirement)/],
  ["charge", /(del ejercicio|dotacion|charge for the year)/],
  ["addition", /(alta|adicion|adquisic|incremento|aumento|inversiones -|additions?|acquisition)/],
];
const classify = (name) => {
  const n = strip(name);
  for (const [k, re] of KINDS) if (re.test(n)) return k;
  return null;
};

export const COLUMN_LABELS = {
  get opening() { return L("me_col_opening", "Saldo inicial"); },
  get addition() { return L("me_col_addition", "Altas"); },
  get disposal() { return L("me_col_disposal", "Bajas"); },
  get transfer() { return L("me_col_transfer", "Traspasos"); },
  get fx() { return L("me_col_fx", "Dif. de cambio"); },
  get charge() { return L("me_col_charge", "Dotación del ejercicio"); },
  get other() { return L("me_col_other", "Otros movimientos"); },
  get variation() { return L("me_col_variation", "Variación"); },
  get closing() { return L("me_col_closing", "Saldo final"); },
  get cur() { return L("me_col_cur", "Ejercicio actual"); },
  get prev() { return L("me_col_prev", "Ejercicio anterior"); },
};

// Cuentas que entran en una nota (por etiqueta y/o por nombre)
export function selectCodes(bind, ctx) {
  const set = new Set();
  const tags = bind?.tags ?? [];
  if (tags.length) {
    ctx.ccTagToCodes.forEach((codes, tag) => {
      const pre = String(tag).split("-")[0];
      if (tags.includes(pre)) codes.forEach(c => set.add(String(c)));
    });
  }
  const names = (bind?.names ?? []).map(strip).filter(Boolean);
  if (names.length) {
    ctx.accounts.forEach(a => {
      if (bind.statement === "PL" && a.type === "B/S") return;
      if (bind.statement === "BS" && a.type !== "B/S") return;
      const nm = strip(a.name);
      if (names.some(w => nm.includes(w))) set.add(a.code);
    });
  }
  if (bind?.statement) {
    const want = bind.statement === "PL" ? (t) => t === "P/L" || t === "DIS" : (t) => t === "B/S";
    const byCode = new Map(ctx.accounts.map(a => [a.code, a]));
    [...set].forEach(c => { const a = byCode.get(c); if (a && !want(a.type)) set.delete(c); });
  }
  return set;
}

// Filas: las cuentas "de arriba" del conjunto; si solo hay una con hijos, sus hijos.
export function selectRows(set, ctx) {
  const parentOf = new Map();
  ctx.childrenOf.forEach((kids, p) => kids.forEach(k => { if (k !== p) parentOf.set(String(k), String(p)); }));
  const isTop = (c) => {
    let p = parentOf.get(c);
    const seen = new Set();
    while (p && !seen.has(p)) { if (set.has(p)) return false; seen.add(p); p = parentOf.get(p); }
    return true;
  };
  const order = new Map(ctx.accounts.map((a, i) => [a.code, i]));
  const sort = (arr) => arr.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  let tops = sort([...set].filter(isTop));
  if (tops.length === 1) {
    const kids = (ctx.childrenOf.get(tops[0]) ?? []).map(String);
    if (kids.length > 1) tops = sort(kids);
  }
  return tops;
}

const leavesOf = (code, ctx) => {
  const out = [];
  const walk = (c, seen) => {
    if (seen.has(c)) return;
    seen.add(c);
    const kids = ctx.childrenOf.get(c) ?? [];
    if (!kids.length) { out.push(c); return; }
    kids.forEach(k => walk(String(k), seen));
  };
  walk(code, new Set());
  return out;
};

/* ── Celdas vinculadas ────────────────────────────────────────────────
   Cualquier celda puede tomar su importe de otro sitio sin crear una fila
   nueva: note.links["fila|columna"] (o "fila|columna@prev" para el ejercicio
   anterior de un cuadro de movimientos) =
     { type: "var", key: "n7.total.closing", sign: 1 | -1 }   ← otra variable
     { type: "acc", code: "6810", pk: "cur", statement, sign } ← saldo de una cuenta
   globals.resolveLink(link, cellKey, note) → { value, label, missing }.
   Una celda vinculada cuenta como importe "puesto" (igual que uno escrito a
   mano): en los cuadros de movimientos la otra columna se calcula para cuadrar. */
export const linkDescription = (l) => (!l ? "" : l.type === "acc"
  ? `${L("me_account", "Cuenta")} ${l.code}${l.name ? ` ${l.name}` : ""} · ${periodLabel(l.pk) ?? l.pk}`
  : `{{${l.key}}}`);
function linkedInputs(note, globals) {
  const ov = { ...(note.overrides ?? {}) };
  const info = {};
  Object.entries(note.links ?? {}).forEach(([k, l]) => {
    if (!l || (l.type !== "var" && l.type !== "acc")) return;
    const r = globals?.resolveLink ? globals.resolveLink(l, k, note) : null;
    const raw = r && Number.isFinite(Number(r.value)) ? Number(r.value) : 0;
    const value = raw * (l.sign === -1 ? -1 : 1);
    ov[k] = value;
    info[k] = { link: l, label: r?.label ?? linkDescription(l), missing: !r || !!r.missing, value };
  });
  return { ov, info };
}
const linkMeta = (inf) => ({
  source: "vinculado",
  formula: inf.missing
    ? L("me_e_link_broken", "Vínculo roto: {x} ya no existe. Vuelve a vincular la celda o quita el vínculo.", { x: linkDescription(inf.link) })
    : (inf.link.sign === -1 ? L("me_e_linked_neg", "Vinculada a {x} (con el signo cambiado)", { x: inf.label }) : L("me_e_linked", "Vinculada a {x}", { x: inf.label })),
  linkLabel: inf.missing ? null : inf.label + (inf.link.sign === -1 ? ` · ${L("me_lk_sign_neg_low", "signo cambiado")}` : ""),
  parts: inf.missing ? [] : [{ name: inf.link.sign === -1 ? `${inf.label} · ${L("me_lk_sign_neg_low", "signo cambiado")}` : inf.label, value: inf.value }],
  link: inf.link, missing: inf.missing,
});
const brokenLinkCheck = (rows, info, year, sfx = "") => {
  const broken = Object.entries(info).filter(([k, inf]) => inf.missing && k.endsWith(sfx) && (sfx || !k.endsWith("@prev")));
  if (!broken.length) return [];
  const [k0] = broken[0];
  const [rowKey, colRaw] = k0.split("|");
  const live = broken.filter(([k]) => rows.some(r => r.key === k.split("|")[0]));
  if (!live.length) return [];
  return [{
    id: `links:${year}`, ok: false, label: L("me_e_ck_links", "Celdas con el vínculo roto"),
    detail: L("me_e_ck_links_d", "{n} celda(s) apuntan a algo que ya no existe", { n: live.length }),
    rowKey, colKey: colRaw.replace("@prev", ""), year, diff: 0,
  }];
};

/* Construye la tabla de una nota.
   Devuelve { mode, columns: [{ key, label }], rows: [{ key, code, label, values, auto }],
              total: { values }, loading } */
export function buildNoteTable(noteIn, ctx, globals = {}) {
  // Defensa: "custom" solo cuenta si es una tabla de verdad ({ columns, rows })
  const note = noteIn?.custom && !Array.isArray(noteIn.custom.columns) ? { ...noteIn, custom: null } : noteIn;
  const byCode = new Map(ctx.accounts.map(a => [a.code, a]));
  let loading = false;
  const v = (code, pk, statement) => {
    const x = ctx.value(code, pk, statement);
    if (x == null) { loading = true; return 0; }
    return x;
  };

  // ── Tabla editada por el usuario (estructura propia) ──
  if (note.custom) {
    const columns = note.custom.columns.map(c => ({ key: c.key, label: c.label, src: c.src }));
    const rows = (note.custom.rows ?? []).map(r => {
      const isPL = r.statement === "cf" ? true : (() => { const t = byCode.get(r.code)?.type; return t === "P/L" || t === "DIS"; })();
      const val = (src) => {
        if (!r.code || src === "manual") return 0;
        const st = r.statement;
        if (src === "cur" || src === "closing") return v(r.code, "cur", st);
        if (src === "prevYE" || src === "opening") return v(r.code, "prevYE", st);
        if (src === "prevSame") return v(r.code, "prevSame", st);
        if (src === "prev") return v(r.code, isPL ? "prevSame" : "prevYE", st);
        if (src === "variation") return v(r.code, "cur", st) - v(r.code, isPL ? "prevSame" : "prevYE", st);
        if (src === "pct") {
          const c = v(r.code, "cur", st), pv = v(r.code, isPL ? "prevSame" : "prevYE", st);
          return Math.abs(pv) > 0.004 ? ((c - pv) / Math.abs(pv)) * 100 : 0;
        }
        if (src.startsWith("mov:")) {
          const kind = src.slice(4);
          return leavesOf(r.code, ctx).reduce((s, l) => s + ((classify(byCode.get(l)?.name) ?? "other") === kind ? v(l, "cur") : 0), 0);
        }
        return 0;
      };
      return {
        key: r.id, code: r.code ?? null, statement: r.statement ?? null, label: r.label, heading: !!r.heading,
        auto: !!r.code, bound: !!r.code, values: Object.fromEntries(columns.map(c => [c.key, val(c.src)])),
      };
    });
    return finish({ mode: "custom", columns, rows }, note, loading, true, globals);
  }

  // ── Tabla manual (con alguna fila automática) ──
  if (note.kind === "manual" && note.manual) {
    const columns = note.manual.columns.map((label, i) => ({ key: `c${i}`, label }));
    const rows = note.manual.rows.map((r, i) => ({
      key: `m${i}`, code: null, label: r.label, heading: !!r.heading, auto: !!r.auto,
      values: Object.fromEntries(columns.map((c, ci) => [c.key, r.auto && ci === 0 ? (globals[r.auto] ?? 0) : 0])),
    }));
    return finish({ mode: "manual", columns, rows }, note, loading, false, globals);
  }

  // ── Cuadro de movimientos (altas y bajas) ──
  if (usesMovementEngine(note)) return buildMovementTable(note, ctx, globals);

  if (!note.bind) return { mode: "text", columns: [], rows: [], total: null, loading: false };
  const set = selectCodes(note.bind, ctx);
  const rowCodes = selectRows(set, ctx);
  const isPL = rowCodes.length > 0 && rowCodes.every(c => { const t = byCode.get(c)?.type; return t === "P/L" || t === "DIS"; });

  // ── Desglose: ejercicio actual / anterior ──
  if (note.kind === "breakdown") {
    const prevKey = isPL ? "prevSame" : "prevYE";
    const columns = [{ key: "cur", label: COLUMN_LABELS.cur }, { key: "prev", label: COLUMN_LABELS.prev }];
    const rows = rowCodes.map(c => ({
      key: c, code: c, label: byCode.get(c)?.name ?? c, auto: true,
      values: { cur: v(c, "cur"), prev: v(c, prevKey) },
    }));
    return finish({ mode: "breakdown", columns, rows }, note, loading, false, globals);
  }

  // ── Movimientos ──
  // ¿El plan tiene cuentas de movimiento bajo estas filas? (rollforward)
  const rowLeaves = new Map(rowCodes.map(c => [c, leavesOf(c, ctx)]));
  const kindsFound = new Set();
  rowLeaves.forEach(ls => ls.forEach(l => { const k = classify(byCode.get(l)?.name); if (k) kindsFound.add(k); }));
  const rollforward = kindsFound.has("opening") && (kindsFound.has("addition") || kindsFound.has("disposal"));

  if (rollforward) {
    const ORDER = ["opening", "addition", "disposal", "transfer", "fx", "charge", "other", "closing"];
    const rows = rowCodes.map(c => {
      const values = Object.fromEntries(ORDER.map(k => [k, 0]));
      (rowLeaves.get(c) ?? []).forEach(l => {
        const amt = v(l, "cur");
        const k = classify(byCode.get(l)?.name) ?? "other";
        values[k] += amt;
        values.closing += amt;
      });
      return { key: c, code: c, label: byCode.get(c)?.name ?? c, auto: true, values };
    });
    // Solo las columnas con algún importe (saldo inicial y final siempre)
    const used = ORDER.filter(k => k === "opening" || k === "closing" || rows.some(r => Math.abs(r.values[k]) > 0.004));
    const columns = used.map(k => ({ key: k, label: COLUMN_LABELS[k] }));
    return finish({ mode: "rollforward", columns, rows }, note, loading, false, globals);
  }

  const columns = ["opening", "variation", "closing"].map(k => ({ key: k, label: COLUMN_LABELS[k] }));
  const rows = rowCodes.map(c => {
    const opening = v(c, "prevYE"), closing = v(c, "cur");
    return { key: c, code: c, label: byCode.get(c)?.name ?? c, auto: true, values: { opening, variation: closing - opening, closing } };
  });
  return finish({ mode: "balance", columns, rows }, note, loading, false, globals);
}

// Aplica lo que ha tocado el usuario: filas ocultas, filas añadidas,
// importes sobrescritos y signo; y calcula el total.
function finish(table, note, loading, custom = false, globals = {}) {
  const hidden = new Set(note.hiddenRows ?? []);
  let rows = table.rows.filter(r => !hidden.has(r.key));
  // filas sin importe fuera (salvo las manuales y las de tablas propias)
  if (table.mode !== "manual" && !custom) rows = rows.filter(r => Object.values(r.values).some(x => Math.abs(x) > 0.004));
  const extra = (custom ? [] : (note.extraRows ?? [])).map(r => ({
    key: r.id, code: null, label: r.label, auto: false, extra: true,
    values: Object.fromEntries(table.columns.map(c => [c.key, Number(r.values?.[c.key]) || 0])),
  }));
  rows = [...rows, ...extra];
  // signo: automático = que el total salga positivo
  const lastNum = [...table.columns].reverse().find(c => c.src !== "pct" && c.src !== "manual") ?? table.columns[table.columns.length - 1];
  const rawTotal = rows.reduce((s, r) => s + (r.bound === false ? 0 : (r.values[lastNum?.key] ?? 0)), 0);
  const flip = note.signFlip ?? (table.mode !== "manual" && rawTotal < 0 ? -1 : 1);
  const { ov, info } = linkedInputs(note, globals);
  rows = rows.map(r => {
    const values = {};
    const manual = {};
    const linked = {};
    const meta = {};
    const sys = {};
    table.columns.forEach(c => {
      const k = `${r.key}|${c.key}`;
      const sysV = r.extra || table.mode === "manual" || c.src === "pct" || (custom && !r.bound) ? r.values[c.key] : r.values[c.key] * flip;
      sys[c.key] = sysV;
      if (info[k]) { values[c.key] = info[k].value; linked[c.key] = true; meta[c.key] = linkMeta(info[k]); }
      else if (Object.prototype.hasOwnProperty.call(ov, k)) { values[c.key] = Number(ov[k]) || 0; manual[c.key] = true; }
      else values[c.key] = sysV;
    });
    return { ...r, values, manual, linked, meta, sys };
  });
  // Sin total en tablas manuales con apartados (p. ej. base de reparto / aplicación)
  let total = rows.some(r => r.heading) ? null
    : { values: Object.fromEntries(table.columns.map(c => [c.key, rows.reduce((s, r) => s + (r.values[c.key] ?? 0), 0)])) };
  // % de variación del total: sobre los totales, no la suma de porcentajes
  if (total) table.columns.filter(c => c.src === "pct").forEach(c => {
    const cur = table.columns.find(x => x.src === "cur"), prev = table.columns.find(x => x.src === "prev" || x.src === "prevYE" || x.src === "prevSame");
    const a = cur ? total.values[cur.key] : 0, b = prev ? total.values[prev.key] : 0;
    total.values[c.key] = Math.abs(b) > 0.004 ? ((a - b) / Math.abs(b)) * 100 : 0;
  });
  return { ...table, rows, total, flip, loading, checks: brokenLinkCheck(rows, info, "cur") };
}

// Variables de una nota (para el texto). Cada celda es una variable:
//   n5.<fila>.<columna>        (ejercicio actual)
//   n5.<fila>.<columna>.prev   (ejercicio anterior, en los cuadros de movimientos)
//   n5.total.<columna>         (fila de total)
// Cada variable lleva "ref" para poder enseñar de dónde sale.
export function noteVariables(note, table) {
  const out = {};
  if (!table || !table.columns?.length) return out;
  const base = `n${note.number}`;
  const isMov = table.mode === "movement";
  // "parts": la misma información que la etiqueta, por piezas, para enseñarla
  // de forma legible (nota › grupo › fila › columna › año) en vez del código.
  const parts = (row, col, year, extra = {}) => ({
    noteNumber: note.number, noteTitle: note.title, row, col,
    year: isMov ? (year === "prev" ? table.years?.prev : table.years?.cur) ?? null : null, ...extra,
  });
  const put = (rows, year) => {
    let group = null;
    rows.forEach(r => {
      if (r.heading) { group = r.label; return; }
      table.columns.forEach(c => {
        if (c.key === "check") return;
        const suffix = year === "prev" ? ".prev" : "";
        const yLabel = isMov ? ` · ${year === "prev" ? table.years?.prev : table.years?.cur}` : "";
        out[`${base}.${r.key}.${c.key}${suffix}`] = {
          value: r.values[c.key] ?? 0,
          label: `${note.title} · ${r.label} · ${c.label}${yLabel}`,
          ref: { noteId: note.id, rowKey: r.key, colKey: c.key, year },
          parts: parts(r.label, c.label, year, { group: r.net ? null : group, total: !!r.subtotal }),
          source: r.meta?.[c.key]?.source ?? (r.manual?.[c.key] ? "manual" : r.code ? "sistema" : "manual"),
        };
      });
    });
  };
  put(table.rows, "cur");
  if (table.prevRows) put(table.prevRows, "prev");
  if (table.total) table.columns.forEach(c => {
    out[`${base}.total.${c.key}`] = { value: table.total.values?.[c.key] ?? 0, label: `${note.title} · ${L("me_total", "Total")} · ${c.label}`, ref: { noteId: note.id, rowKey: "__total", colKey: c.key, year: "cur" }, parts: parts(L("me_total", "Total"), c.label, "cur", { total: true }), source: "sistema" };
  });
  // Compatibilidad con textos antiguos ({{n5.total.closing}}…): en los cuadros
  // de movimientos el "total" es el valor neto contable.
  if (isMov) {
    const net = table.rows.find(r => r.key === "net");
    if (net) table.columns.forEach(c => {
      if (c.key === "check") return;
      out[`${base}.total.${c.key}`] = { value: net.values[c.key] ?? 0, label: `${note.title} · ${L("me_e_net", "Valor neto contable")} · ${c.label}`, ref: { noteId: note.id, rowKey: "net", colKey: c.key, year: "cur" }, parts: parts(L("me_e_net", "Valor neto contable"), c.label, "cur", { total: true }), source: "sistema" };
    });
  }
  return out;
}

// Sustituye {{variable}} por su valor (o lo deja marcado si no existe)
export function renderNarrative(text, vars, fmt) {
  return String(text ?? "").split(/(\{\{[^}]+\}\})/g).map((part) => {
    const m = /^\{\{([^}]+)\}\}$/.exec(part);
    if (!m) return { text: part };
    const v = vars[m[1].trim()];
    if (!v) return { variable: m[1].trim(), missing: true, text: `{{${m[1].trim()}}}` };
    return { variable: m[1].trim(), text: typeof v.value === "number" ? fmt(v.value) : String(v.value) };
  });
}


/* ══ Tablas editables ════════════════════════════════════════════════════
   Al cambiar la estructura (otra tabla de la biblioteca, columnas o filas
   con datos) la tabla pasa a ser "propia": filas ligadas a cuentas y
   columnas con un origen de datos. */
export const COLUMN_SOURCES = [
  pair("cur", "me_col_cur", "Ejercicio actual"),
  pair("prev", "me_col_prev", "Ejercicio anterior"),
  pair("variation", "me_col_variation", "Variación"),
  pair("pct", "me_col_pct", "Variación %"),
  pair("opening", "me_src_opening", "Saldo inicial (cierre anterior)"),
  pair("closing", "me_col_closing", "Saldo final"),
  pair("mov:addition", "me_src_addition", "Altas (cuentas de movimiento)"),
  pair("mov:disposal", "me_src_disposal", "Bajas (cuentas de movimiento)"),
  pair("mov:transfer", "me_src_transfer", "Traspasos (cuentas de movimiento)"),
  pair("manual", "me_src_manual", "Manual (a rellenar)"),
];

export const TABLE_LIBRARY = [
  { id: "breakdown", get label() { return L("me_tpl_breakdown", "Desglose"); }, get description() { return L("me_tpl_breakdown_d", "Ejercicio actual y anterior por partida."); },
    columns: [pair("cur", "me_col_cur", "Ejercicio actual"), pair("prev", "me_col_prev", "Ejercicio anterior")] },
  { id: "compare", get label() { return L("me_tpl_compare", "Comparativa con variación"); }, get description() { return L("me_tpl_compare_d", "Actual, anterior, variación y variación %."); },
    columns: [pair("cur", "me_col_cur", "Ejercicio actual"), pair("prev", "me_col_prev", "Ejercicio anterior"), pair("variation", "me_col_variation", "Variación"), pair("pct", "me_col_pct", "Variación %")] },
  { id: "movement", engine: true, get label() { return L("me_tpl_movement", "Movimientos del ejercicio (altas y bajas)"); }, get description() { return L("me_tpl_movement_d", "Coste, amortización y deterioro: saldo inicial, entradas, salidas, traspasos y saldo final, con cuadre. Ejercicio actual y anterior."); },
    columns: [pair("opening", "me_col_opening", "Saldo inicial"), pair("entradas", "me_mc_in", "Entradas"), pair("salidas", "me_mc_out_short", "Salidas"), pair("traspasos", "me_col_transfer", "Traspasos"), pair("closing", "me_col_closing", "Saldo final")] },
  { id: "closing", get label() { return L("me_tpl_closing", "Saldo al cierre"); }, get description() { return L("me_tpl_closing_d", "Una sola columna con el saldo del periodo."); },
    columns: [pair("cur", "me_tpl_closing", "Saldo al cierre")] },
  { id: "blank", get label() { return L("me_tpl_blank", "En blanco"); }, get description() { return L("me_tpl_blank_d", "Tabla vacía con una columna manual, para empezar de cero."); },
    columns: [pair("manual", "me_amount", "Importe")], empty: true },
];

const srcForColumn = (mode, key) => {
  if (mode === "breakdown") return key === "cur" ? "cur" : "prev";
  if (mode === "balance") return key === "opening" ? "opening" : key === "closing" ? "closing" : "variation";
  if (mode === "rollforward") return key === "opening" ? "opening" : key === "closing" ? "closing" : `mov:${key}`;
  return "manual";
};

// Convierte la tabla calculada en una tabla propia (mismas filas y columnas).
export function materialize(note, table) {
  if (table?.mode === "movement") {
    const rows = table.rows.filter(r => !r.heading && !r.subtotal && r.code).map(r => ({ id: r.key, label: r.label, code: r.code, statement: null }));
    return { custom: { columns: [{ key: "cur", label: COLUMN_LABELS.cur, src: "cur" }, { key: "prev", label: COLUMN_LABELS.prev, src: "prev" }], rows }, movementOn: false, overrides: {}, extraRows: [], hiddenRows: [] };
  }
  const columns = (table?.columns ?? []).map(c => ({ key: c.key, label: c.label, src: c.src ?? srcForColumn(table.mode, c.key) }));
  const overrides = { ...(note.overrides ?? {}) };
  const rows = (table?.rows ?? []).map(r => {
    if (r.extra || !r.code) {
      // los importes de filas manuales pasan a ser importes escritos
      columns.forEach(c => { if (Math.abs(r.values[c.key] ?? 0) > 0.004 && overrides[`${r.key}|${c.key}`] == null) overrides[`${r.key}|${c.key}`] = r.values[c.key]; });
      return { id: r.key, label: r.label, code: null, heading: !!r.heading };
    }
    return { id: r.key, label: r.label, code: r.code, statement: r.statement ?? null };
  });
  return { custom: { columns, rows }, overrides, extraRows: [], hiddenRows: [] };
}

// Aplica una tabla de la biblioteca conservando las filas (salvo "En blanco").
export function applyTemplate(note, table, templateId) {
  const tpl = TABLE_LIBRARY.find(x => x.id === templateId);
  if (!tpl) return {};
  // Cuadro de movimientos: lo monta el motor con las cuentas de la nota
  if (tpl.engine) {
    const codes = (note.custom?.rows ?? []).map(r => r.code).filter(Boolean);
    return { custom: null, movementOn: true, movCodes: [...new Set([...(note.movCodes ?? []), ...codes])], overrides: {}, links: {}, extraRows: [], hiddenRows: [], signFlip: null };
  }
  const base = materialize(note, table);
  // Claves estables por tipo de dato (cur, prev, closing…): así las variables
  // del texto ({{n5.total.cur}}) siguen funcionando al cambiar de tabla.
  const columns = tpl.columns.map(([src, label]) => ({ key: src === "mov:addition" ? "addition" : src === "mov:disposal" ? "disposal" : src === "mov:transfer" ? "transfer" : src, label, src }));
  const rows = tpl.empty ? [] : base.custom.rows;
  return { custom: { columns, rows, template: templateId }, movementOn: false, overrides: {}, links: {}, extraRows: [], hiddenRows: [], signFlip: null };
}


/* ══ Cuadro de movimientos: altas, bajas, traspasos… ═════════════════════
   Konsolidator da saldos (balances de sumas y saldos) y asientos de
   consolidación, pero no el detalle de altas y bajas de cada activo. Por eso
   el cuadro es un motor de conciliación:

     saldo inicial + perímetro + entradas + salidas + traspasos + dif. conversión
       = saldo final

   · Saldo inicial y final: siempre del sistema (cierre anterior y actual).
   · Si el plan tiene cuentas de movimiento (altas, bajas, traspasos…) se usan.
   · Si no, se deducen y se marcan como "inferido":
       - Amortización: si la amortización acumulada crece es dotación; si
         baja, son bajas. Se contrasta con la dotación de la cuenta de
         resultados (681, 680, 682…).
       - Coste: la variación neta va a entradas (o a salidas si es negativa);
         si la amortización tuvo bajas, se supone que esos activos salieron
         totalmente amortizados (bajas de coste = bajas de amortización).
       - Deterioro: si aumenta, dotación; si disminuye, reversión.
   · Lo que se escribe a mano manda: si se escribe solo una de entradas o
     salidas, la otra se calcula para cuadrar. Si se escriben las dos, la
     columna "Cuadre" enseña lo que falta.
   Ejercicio actual y anterior (cierre de hace dos años → cierre anterior).
   ══════════════════════════════════════════════════════════════════════ */

export const MOVEMENT_COLUMNS = [
  { key: "opening", get label() { return L("me_col_opening", "Saldo inicial"); } },
  { key: "perimeter", get label() { return L("me_mc_perimeter", "Variaciones del perímetro"); }, consolidatedOnly: true, optional: true, input: true },
  { key: "entradas", get label() { return L("me_mc_in", "Entradas"); }, input: true },
  { key: "salidas", get label() { return L("me_mc_out", "Salidas, bajas o reducciones"); }, input: true },
  { key: "traspasos", get label() { return L("me_col_transfer", "Traspasos"); }, optional: true, input: true },
  { key: "fx", get label() { return L("me_mc_fx", "Diferencias de conversión"); }, consolidatedOnly: true, optional: true, input: true },
  { key: "closing", get label() { return L("me_col_closing", "Saldo final"); } },
  { key: "check", get label() { return L("me_mc_check", "Cuadre"); }, control: true },
];
export const LAYERS = [
  { id: "cost", get label() { return L("me_layer_cost", "Coste"); }, get total() { return L("me_layer_cost_t", "Total coste"); } },
  { id: "aa", get label() { return L("me_layer_aa", "Amortizaciones"); }, get total() { return L("me_layer_aa_t", "Total amortización"); } },
  { id: "det", get label() { return L("me_layer_det", "Deterioros"); }, get total() { return L("me_layer_det_t", "Total deterioro"); } },
];
export const SOURCE_LABELS = {
  get sistema() { return L("me_sl_system", "Sistema"); },
  get plan() { return L("me_sl_plan", "Cuentas de movimiento del plan"); },
  get inferido() { return L("me_sl_inferred", "Deducido (revisar)"); },
  get calculado() { return L("me_lg_calc", "Calculado para cuadrar"); },
  get manual() { return L("me_kind_manual", "Escrito a mano"); },
  get vinculado() { return L("me_lg_linked", "Vinculada"); },
  get pyg() { return L("me_sl_pl", "Cuenta de resultados"); },
};

export function usesMovementEngine(note) {
  if (note.custom && Array.isArray(note.custom.columns)) return false;
  if (note.movementOn === true) return true;
  return note.kind === "movement" && note.movementOn !== false;
}

const DET_RE = /(deterioro|impairment|provision (por |de |para )?depreciacion|correccion(es)? (valorativa|de valor))/;
const AA_RE = /(amortizacion|amortisation|amortization|depreciation|depreciacion acumulada|amort\.)/;
// Capa de una cuenta: por su nombre o el de sus padres (hasta la fila)
const layerHint = (name) => {
  const n = strip(name);
  if (DET_RE.test(n)) return "det";
  if (AA_RE.test(n)) return "aa";
  return null;
};
// Nombre "limpio" para las filas de amortización / deterioro
const cleanName = (name) => {
  const s = String(name ?? "").replace(/^\s*(amortizaci[oó]n(es)? acumulada(s)?|amort\. acum\.?|deterioro(s)? de valor|deterioro(s)?|correcciones valorativas por deterioro|provisi[oó]n (por |de )?depreciaci[oó]n)\s*(de(l)?\s+)?(las?\s+|los?\s+|el\s+)?/i, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(name ?? "");
};
const pairKey = (name) => strip(cleanName(name)).replace(/[^a-z0-9]+/g, " ").trim();

function buildTree(ctx) {
  const byCode = new Map(ctx.accounts.map(a => [a.code, a]));
  const parentOf = new Map();
  ctx.childrenOf.forEach((kids, p) => kids.forEach(k => { if (String(k) !== String(p)) parentOf.set(String(k), String(p)); }));
  return { byCode, parentOf };
}

// Cuentas de la cuenta de resultados de la nota (dotación, deterioro…)
function plCodes(spec, ctx) {
  if (!spec) return [];
  const prefixes = (spec.codes ?? []).map(String);
  const words = (spec.names ?? []).map(strip);
  const set = new Set();
  ctx.accounts.forEach(a => {
    if (a.type === "B/S") return;
    const code = String(a.code);
    const nm = strip(a.name);
    const byCode = prefixes.some(p => code === p || code.startsWith(p));
    const byName = words.some(w => nm.includes(w));
    if (byCode || byName) set.add(code);
  });
  // Solo las de arriba (sin contar dos veces padre e hijo)
  const { parentOf } = buildTree(ctx);
  return [...set].filter(c => {
    let p = parentOf.get(c); const seen = new Set();
    while (p && !seen.has(p)) { if (set.has(p)) return false; seen.add(p); p = parentOf.get(p); }
    return true;
  });
}

export function buildMovementTable(note, ctx, globals = {}) {
  const { byCode, parentOf } = buildTree(ctx);
  const consolidated = ctx.scope === "consolidated";
  let loading = false;
  const val = (code, pk) => {
    const x = ctx.value(code, pk);
    if (x == null) { loading = true; return 0; }
    return x;
  };
  const kidsOf = (c) => (ctx.childrenOf.get(c) ?? []).map(String).filter(k => k !== c);
  const leavesOf = (code) => {
    const out = []; const seen = new Set();
    const walk = (c) => { if (seen.has(c)) return; seen.add(c); const k = kidsOf(c); if (!k.length) { out.push(c); return; } k.forEach(walk); };
    walk(code);
    return out;
  };
  // Capa de una hoja: su nombre o el de algún padre hasta la fila de arriba
  const layerOfLeaf = (leaf, stopAt) => {
    let c = leaf; const seen = new Set();
    while (c && !seen.has(c)) {
      const h = layerHint(byCode.get(c)?.name);
      if (h) return h;
      if (c === stopAt) break;
      seen.add(c); c = parentOf.get(c);
    }
    return "cost";
  };

  // ── Filas: cuentas de la nota, separadas por capa (coste / amortización / deterioro)
  const set = note.bind ? selectCodes(note.bind, ctx) : new Set();
  (note.movCodes ?? []).forEach(c => set.add(String(c)));
  const tops = selectRows(set, ctx);
  const pure = []; // { code, layer }
  const expand = (code) => {
    const leaves = leavesOf(code);
    const layers = new Set(leaves.map(l => layerOfLeaf(l, code)));
    if (layers.size <= 1 || !kidsOf(code).length) {
      // Una cuenta de una sola capa: una fila por cada subcuenta (como en las
      // memorias: Terrenos, Construcciones, Mobiliario…), salvo que sean
      // demasiadas o sea ya una hoja.
      const layer = layerHint(byCode.get(code)?.name) ?? [...layers][0] ?? "cost";
      const kids = kidsOf(code);
      if (kids.length >= 2 && kids.length <= 25 && !kids.some(k => classify(byCode.get(k)?.name))) {
        kids.forEach(k => pure.push({ code: k, layer: layerHint(byCode.get(k)?.name) ?? layer, leaves: leavesOf(k) }));
      } else pure.push({ code, layer, leaves });
      return;
    }
    kidsOf(code).forEach(expand);
  };
  tops.forEach(expand);

  // Cuentas de movimiento del plan (altas, bajas…): las hojas con esos nombres
  const leafKind = (l) => classify(byCode.get(l)?.name);

  const { ov, info: linkInfo } = linkedInputs(note, globals);
  const flipAuto = (() => {
    const costClose = pure.filter(p => p.layer === "cost").reduce((s, p) => s + p.leaves.reduce((t, l) => t + val(l, "cur"), 0), 0);
    return costClose < 0 ? -1 : 1;
  })();
  const flip = note.signFlip ?? flipAuto;

  // Dotación y deterioro de la cuenta de resultados (para contrastar)
  const pl = note.bind?.pl ?? {};
  const dotCodes = plCodes(pl.dot, ctx);
  const detCodes = plCodes(pl.det, ctx);
  const plSum = (codes, pk) => codes.reduce((s, c) => s + val(c, pk), 0);

  const labelsFor = note.bind?.labels ?? {};
  const visibleCols = MOVEMENT_COLUMNS
    .filter(c => !c.consolidatedOnly || consolidated)
    .map(c => ({ ...c, label: note.movLabels?.[c.key] || labelsFor[c.key] || c.label }));

  const years = { cur: String(globals.year ?? ""), prev: String(globals.year ? Number(globals.year) - 1 : "") };

  const buildYear = (year) => {
    const pkOpen = year === "cur" ? "prevYE" : "prevYE2";
    const pkClose = year === "cur" ? "cur" : "prevYE";
    const sfx = year === "cur" ? "" : "@prev";
    const has = (rowKey, col) => Object.prototype.hasOwnProperty.call(ov, `${rowKey}|${col}${sfx}`);
    const get = (rowKey, col) => Number(ov[`${rowKey}|${col}${sfx}`]) || 0;

    const rows = pure.map(p => {
      const key = `${p.code}~${p.layer}`;
      const acc = byCode.get(p.code);
      const parts = (pk) => p.leaves.map(l => ({ code: l, name: byCode.get(l)?.name ?? l, value: val(l, pk) * flip })).filter(x => Math.abs(x.value) > 0.004);
      const leavesMov = p.leaves.filter(l => leafKind(l));
      const plan = leavesMov.length > 0 && p.leaves.some(l => leafKind(l) === "opening");
      const values = {}; const meta = {}; const manual = {}; const sys = {};
      const setV = (col, v, m) => { values[col] = v; meta[col] = m; sys[col] = v; };
      // Saldos
      if (plan) {
        // Plan con cuentas de movimiento: el saldo final es la suma de todo y el
        // inicial la cuenta de "saldo inicial".
        const sumKind = (k, pk) => p.leaves.filter(l => (leafKind(l) ?? "other") === k).reduce((s, l) => s + val(l, pk) * flip, 0);
        const closeV = p.leaves.reduce((s, l) => s + val(l, pkClose) * flip, 0);
        setV("opening", sumKind("opening", pkClose), { source: "plan", formula: L("me_f_plan_opening", "Cuenta de saldo inicial del plan"), parts: parts(pkClose).filter(x => leafKind(x.code) === "opening") });
        setV("closing", closeV, { source: "sistema", formula: year === "cur" ? L("me_f_close_cur", "Saldo al cierre del ejercicio") : L("me_f_close_prev", "Saldo al cierre del ejercicio anterior"), parts: parts(pkClose) });
        const add = sumKind("addition", pkClose) + (p.layer !== "cost" ? sumKind("charge", pkClose) : 0);
        const dis = sumKind("disposal", pkClose);
        const tr = sumKind("transfer", pkClose);
        const fx = sumKind("fx", pkClose);
        const other = sumKind("other", pkClose) + (p.layer === "cost" ? sumKind("charge", pkClose) : 0);
        const mk = (kind) => ({ source: "plan", formula: L("me_sl_plan", "Cuentas de movimiento del plan"), parts: parts(pkClose).filter(x => (leafKind(x.code) ?? "other") === kind) });
        setV("entradas", add + other, mk("addition"));
        setV("salidas", dis, mk("disposal"));
        setV("traspasos", tr, mk("transfer"));
        setV("fx", fx, mk("fx"));
        setV("perimeter", 0, { source: "manual", formula: L("me_f_to_fill", "A rellenar"), parts: [] });
      } else {
        const o = p.leaves.reduce((s, l) => s + val(l, pkOpen), 0) * flip;
        const c = p.leaves.reduce((s, l) => s + val(l, pkClose), 0) * flip;
        setV("opening", o, { source: "sistema", formula: year === "cur" ? L("me_f_close_prev", "Saldo al cierre del ejercicio anterior") : L("me_f_close_prev2", "Saldo al cierre de hace dos ejercicios"), parts: parts(pkOpen) });
        setV("closing", c, { source: "sistema", formula: year === "cur" ? L("me_f_close_cur", "Saldo al cierre del ejercicio") : L("me_f_close_prev", "Saldo al cierre del ejercicio anterior"), parts: parts(pkClose) });
        ["entradas", "salidas"].forEach(k => setV(k, 0, { source: "sistema", formula: "", parts: [] }));
        // La contabilidad no separa estos movimientos: se escriben a mano y las
        // entradas o salidas se ajustan solas para cuadrar con el saldo final.
        const INPUT_HINT = {
          perimeter: L("me_f_nosplit_perimeter", "La contabilidad no separa las variaciones del perímetro: si las hubo, escribe el importe y las entradas o salidas se recalculan solas"),
          traspasos: L("me_f_nosplit_transfer", "La contabilidad no separa los traspasos entre partidas: si los hubo, escribe el importe y las entradas o salidas se recalculan solas"),
          fx: L("me_f_nosplit_fx", "La contabilidad no separa las diferencias de conversión: si las hubo, escribe el importe y las entradas o salidas se recalculan solas"),
        };
        ["perimeter", "traspasos", "fx"].forEach(k => setV(k, 0, { source: "sistema", formula: INPUT_HINT[k], parts: [] }));
      }
      return { key, code: p.code, layer: p.layer, label: p.layer === "cost" ? (acc?.name ?? p.code) : cleanName(acc?.name ?? p.code), auto: true, values, meta, manual, sys, plan, pair: pairKey(acc?.name), codeTail: String(p.code).replace(/^2[89]/, "2") };
    });

    // Lo escrito a mano manda
    const applyInputs = (r) => {
      ["opening", "closing", "perimeter", "traspasos", "fx"].forEach(k => {
        if (has(r.key, k)) { r.values[k] = get(r.key, k); r.manual[k] = true; r.meta[k] = { ...r.meta[k], source: "manual", formula: L("me_kind_manual", "Escrito a mano") }; }
      });
    };
    rows.forEach(applyInputs);

    const fixed = (r) => r.values.opening + r.values.perimeter + r.values.traspasos + r.values.fx;
    const solve = (r, guessIn) => {
      // guessIn(delta) → { entradas, salidas, why } para cuando no hay nada escrito
      if (r.plan) {
        ["entradas", "salidas"].forEach(k => { if (has(r.key, k)) { r.values[k] = get(r.key, k); r.manual[k] = true; r.meta[k] = { ...r.meta[k], source: "manual", formula: L("me_kind_manual", "Escrito a mano") }; } });
        return;
      }
      const delta = r.values.closing - fixed(r);
      const hasIn = has(r.key, "entradas"), hasOut = has(r.key, "salidas");
      const deltaParts = [
        { name: L("me_col_closing", "Saldo final"), value: r.values.closing }, { name: `− ${L("me_col_opening", "Saldo inicial")}`, value: -r.values.opening },
        ...(Math.abs(r.values.perimeter) > 0.004 ? [{ name: `− ${L("me_mc_perimeter", "Variaciones del perímetro")}`, value: -r.values.perimeter }] : []),
        ...(Math.abs(r.values.traspasos) > 0.004 ? [{ name: `− ${L("me_col_transfer", "Traspasos")}`, value: -r.values.traspasos }] : []),
        ...(Math.abs(r.values.fx) > 0.004 ? [{ name: `− ${L("me_mc_fx", "Diferencias de conversión")}`, value: -r.values.fx }] : []),
      ];
      if (hasIn && hasOut) {
        r.values.entradas = get(r.key, "entradas"); r.values.salidas = get(r.key, "salidas");
        r.manual.entradas = r.manual.salidas = true;
        r.meta.entradas = { source: "manual", formula: L("me_kind_manual", "Escrito a mano"), parts: [] };
        r.meta.salidas = { source: "manual", formula: L("me_kind_manual", "Escrito a mano"), parts: [] };
      } else if (hasIn) {
        r.values.entradas = get(r.key, "entradas"); r.manual.entradas = true;
        r.meta.entradas = { source: "manual", formula: L("me_kind_manual", "Escrito a mano"), parts: [] };
        r.values.salidas = delta - r.values.entradas;
        r.meta.salidas = { source: "calculado", formula: L("me_f_delta_minus_in", "Variación del saldo − entradas escritas a mano"), parts: [...deltaParts, { name: `− ${L("me_mc_in", "Entradas")}`, value: -r.values.entradas }] };
      } else if (hasOut) {
        r.values.salidas = get(r.key, "salidas"); r.manual.salidas = true;
        r.meta.salidas = { source: "manual", formula: L("me_kind_manual", "Escrito a mano"), parts: [] };
        r.values.entradas = delta - r.values.salidas;
        r.meta.entradas = { source: "calculado", formula: L("me_f_delta_minus_out", "Variación del saldo − salidas escritas a mano"), parts: [...deltaParts, { name: `− ${L("me_mc_out_short", "Salidas")}`, value: -r.values.salidas }] };
      } else {
        const g = guessIn(delta, r);
        r.values.entradas = g.entradas; r.values.salidas = g.salidas;
        r.meta.entradas = { source: Math.abs(g.entradas) > 0.004 ? "inferido" : "sistema", formula: g.why, parts: deltaParts };
        r.meta.salidas = { source: Math.abs(g.salidas) > 0.004 ? "inferido" : "sistema", formula: g.why, parts: deltaParts };
      }
      r.sys.entradas = r.values.entradas; r.sys.salidas = r.values.salidas;
    };

    // 1) Amortización y deterioro: dotación si crece (en valor absoluto), bajas si baja
    rows.filter(r => r.layer !== "cost").forEach(r => solve(r, (d) => (d <= 0
      ? { entradas: d, salidas: 0, why: r.layer === "aa" ? L("me_why_aa_up", "Aumento de la amortización acumulada → dotación del ejercicio") : L("me_why_det_up", "Aumento del deterioro → deterioro reconocido en el ejercicio") }
      : { entradas: 0, salidas: d, why: r.layer === "aa" ? L("me_why_aa_down", "Disminución de la amortización acumulada → bajas de elementos amortizados") : L("me_why_det_down", "Disminución del deterioro → reversión o aplicación") })));
    // 2) Coste: altas si crece; si su amortización tuvo bajas, se supone que
    //    esos elementos salieron totalmente amortizados.
    const aaOf = (r) => rows.find(x => x.layer === "aa" && (x.pair === r.pair || x.codeTail === String(r.code)));
    rows.filter(r => r.layer === "cost").forEach(r => solve(r, (d) => {
      const aa = aaOf(r);
      const aaOut = aa && aa.values.salidas > 0.004 ? aa.values.salidas : 0;
      if (aaOut > 0) {
        // Salieron elementos amortizados: se supone que lo estaban del todo
        // (bajas de coste = bajas de amortización) y el resto de la variación son altas.
        const out = -aaOut;
        const inn = d - out;
        if (inn >= -0.004) return { entradas: Math.max(0, inn), salidas: out, why: L("me_why_cost_mixed", "Las bajas de la amortización indican salidas de elementos totalmente amortizados; el resto de la variación son altas") };
      }
      return d >= 0
        ? { entradas: d, salidas: 0, why: L("me_why_cost_up", "Aumento del saldo → altas del ejercicio") }
        : { entradas: 0, salidas: d, why: L("me_why_cost_down", "Disminución del saldo → bajas del ejercicio") };
    }));

    // Cuadre por fila
    rows.forEach(r => {
      r.values.check = r.values.closing - (fixed(r) + r.values.entradas + r.values.salidas);
      if (Math.abs(r.values.check) < 0.005) r.values.check = 0;
      r.meta.check = { source: "sistema", formula: L("me_check_formula", "Saldo final − (saldo inicial + movimientos)"), parts: [] };
      // Celdas vinculadas: se trataron como importes puestos; aquí se marcan
      r.linked = {};
      MOVEMENT_COLUMNS.forEach(({ key: col }) => {
        const inf = linkInfo[`${r.key}|${col}${sfx}`];
        if (!inf) return;
        r.linked[col] = true; r.manual[col] = false;
        r.meta[col] = linkMeta(inf);
      });
    });

    // Filas sin nada en los dos ejercicios fuera (se decide fuera, con ambos)
    // Bloques por capa con subtotales y valor neto
    const out = [];
    const cols = MOVEMENT_COLUMNS.map(c => c.key);
    const sumRows = (rs) => Object.fromEntries(cols.map(k => [k, rs.reduce((s, r) => s + (r.values[k] ?? 0), 0)]));
    LAYERS.forEach(Ly => {
      const rs = rows.filter(r => r.layer === Ly.id);
      if (!rs.length) return;
      out.push({ key: `h~${Ly.id}`, label: Ly.label, heading: true, layer: Ly.id, values: {} });
      out.push(...rs);
      out.push({ key: `tot~${Ly.id}`, label: Ly.total, subtotal: true, layer: Ly.id, values: sumRows(rs), meta: {}, manual: {}, sys: {} });
    });
    const layersUsed = new Set(rows.map(r => r.layer));
    if (layersUsed.size > 1) out.push({ key: "net", label: L("me_e_net", "Valor neto contable"), subtotal: true, net: true, values: sumRows(rows), meta: {}, manual: {}, sys: {} });

    // Contraste con la cuenta de resultados
    const checks = [];
    const yl = year === "cur" ? years.cur : years.prev;
    const diffRows = rows.filter(r => Math.abs(r.values.check) > 0.5);
    checks.push({
      id: `mov:${year}`, ok: diffRows.length === 0,
      label: L("me_ck_mov", "Cuadre del movimiento {y}", { y: yl }),
      detail: diffRows.length ? L("me_ck_mov_bad", "{n} fila(s) no cuadran: {rows}", { n: diffRows.length, rows: diffRows.slice(0, 3).map(r => r.label).join(", ") }) : L("me_ck_mov_ok", "Todas las filas cuadran con el saldo final"),
      diff: diffRows.reduce((s, r) => s + Math.abs(r.values.check), 0), rowKey: diffRows[0]?.key ?? null, year,
    });
    // Saldos escritos a mano que ya no coinciden con la contabilidad
    const offBooks = rows.filter(r => ["opening", "closing"].some(k => (r.manual[k] || r.linked[k]) && Math.abs(r.values[k] - r.sys[k]) > 0.5));
    if (offBooks.length) {
      checks.push({
        id: `books:${year}`, ok: false, label: L("me_ck_books", "Saldos {y} distintos de la contabilidad", { y: yl }),
        detail: L("me_ck_books_d", "{n} saldo(s) escritos a mano o vinculados no coinciden con el balance: {rows}. Vuelve al cálculo si no es intencionado.", { n: offBooks.length, rows: offBooks.slice(0, 3).map(r => r.label).join(", ") }),
        diff: offBooks.reduce((s, r) => s + ["opening", "closing"].reduce((a, k) => a + (r.manual[k] || r.linked[k] ? Math.abs(r.values[k] - r.sys[k]) : 0), 0), 0),
        rowKey: offBooks[0].key, colKey: offBooks[0].manual.closing || offBooks[0].linked.closing ? "closing" : "opening", year,
      });
    }
    const pk = year === "cur" ? "cur" : "prevYE";
    if (dotCodes.length && layersUsed.has("aa")) {
      const plDot = Math.abs(plSum(dotCodes, pk));
      const tableDot = Math.abs(rows.filter(r => r.layer === "aa").reduce((s, r) => s + r.values.entradas, 0));
      const diff = tableDot - plDot;
      checks.push({
        id: `dot:${year}`, ok: Math.abs(diff) < 1, label: L("me_ck_dot", "Dotación a la amortización {y} vs cuenta de resultados", { y: yl }),
        detail: Math.abs(diff) < 1 ? L("me_ck_pl_ok", "Coincide con la cuenta de resultados") : L("me_ck_dot_bad", "Cuadro {a} · cuenta de resultados {b}. Si hubo bajas de elementos amortizados en el año, escribe la dotación o las bajas en la fila que corresponda.", { a: fmtN(tableDot), b: fmtN(plDot) }),
        diff, plCodes: dotCodes, year, rowKey: rows.find(r => r.layer === "aa")?.key ?? null, colKey: "entradas",
      });
    }
    if (detCodes.length && layersUsed.has("det")) {
      const plDet = plSum(detCodes, pk);
      const tableDet = rows.filter(r => r.layer === "det").reduce((s, r) => s + r.values.entradas + r.values.salidas, 0);
      const diff = Math.abs(tableDet) - Math.abs(plDet);
      checks.push({
        id: `det:${year}`, ok: Math.abs(diff) < 1, label: L("me_ck_det", "Deterioro neto {y} vs cuenta de resultados", { y: yl }),
        detail: Math.abs(diff) < 1 ? L("me_ck_pl_ok", "Coincide con la cuenta de resultados") : L("me_ck_det_bad", "Cuadro {a} · cuenta de resultados {b}", { a: fmtN(Math.abs(tableDet)), b: fmtN(Math.abs(plDet)) }),
        diff, plCodes: detCodes, year, rowKey: rows.find(r => r.layer === "det")?.key ?? null, colKey: "entradas",
      });
    }
    checks.push(...brokenLinkCheck(rows, linkInfo, year, year === "cur" ? "" : "@prev"));
    return { rows: out, checks };
  };

  const cur = buildYear("cur");
  const prev = buildYear("prev");
  // Fuera las filas sin importes en ninguno de los dos ejercicios y las ocultadas
  const hidden = new Set(note.hiddenRows ?? []);
  const live = new Set();
  [cur.rows, prev.rows].forEach(rs => rs.forEach(r => { if (!r.heading && !r.subtotal && MOVEMENT_COLUMNS.some(c => Math.abs(r.values[c.key] ?? 0) > 0.004)) live.add(r.key); }));
  const prune = (rs) => {
    const keep = rs.filter(r => r.heading || r.subtotal || (live.has(r.key) && !hidden.has(r.key)));
    // Bloques sin filas fuera
    return keep.filter((r, i) => {
      if (r.heading) return keep.slice(i + 1).some(x => !x.heading && !x.subtotal && x.layer === r.layer);
      if (r.subtotal && !r.net) return keep.some(x => !x.heading && !x.subtotal && x.layer === r.layer);
      if (r.net) return new Set(keep.filter(x => !x.heading && !x.subtotal).map(x => x.layer)).size > 1;
      return true;
    });
  };
  // Subtotales recalculados tras quitar filas
  const resum = (rs) => {
    const body = rs.filter(r => !r.heading && !r.subtotal);
    return rs.map(r => {
      if (!r.subtotal) return r;
      const src = r.net ? body : body.filter(x => x.layer === r.layer);
      return { ...r, values: Object.fromEntries(MOVEMENT_COLUMNS.map(c => [c.key, src.reduce((s, x) => s + (x.values[c.key] ?? 0), 0)])) };
    });
  };
  const rows = resum(prune(cur.rows));
  const prevRows = resum(prune(prev.rows));
  const anyBody = rows.some(r => !r.heading && !r.subtotal);
  return {
    mode: "movement", columns: visibleCols, rows, prevRows, total: null, flip, loading,
    years, consolidated, checks: anyBody ? [...cur.checks, ...prev.checks] : [],
    plCodes: { dot: dotCodes, det: detCodes },
  };
}
const fmtN = (v) => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  const s = Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
};

/* ══ ¿De dónde sale este importe? ═══════════════════════════════════════
   Explica una celda: origen (sistema, plan, deducido, calculado, a mano),
   fórmula y cuentas con su importe. */
const periodLabel = (pk) => ({ cur: L("me_pk_cur", "Cierre del ejercicio"), prevYE: L("me_pk_prevYE", "Cierre del ejercicio anterior"), prevSame: L("me_pk_prevSame", "Mismo periodo del ejercicio anterior"), prevYE2: L("me_pk_prevYE2", "Cierre de hace dos ejercicios") }[pk]);
export function explainCell(note, table, ref, ctx) {
  if (!table || !ref) return null;
  const rows = ref.year === "prev" ? (table.prevRows ?? []) : table.rows;
  const col = table.columns.find(c => c.key === ref.colKey);
  if (ref.rowKey === "__total") {
    const v = table.total?.values?.[ref.colKey] ?? 0;
    return { rowLabel: L("me_total", "Total"), colLabel: col?.label ?? ref.colKey, value: v, source: "sistema", formula: L("me_f_sum_table", "Suma de las filas de la tabla"), parts: table.rows.filter(r => !r.heading).map(r => ({ code: r.code, name: r.label, value: r.values[ref.colKey] ?? 0 })) };
  }
  const row = rows.find(r => r.key === ref.rowKey);
  if (!row) return null;
  const value = row.values?.[ref.colKey] ?? 0;
  const base = { rowLabel: row.label, colLabel: col?.label ?? ref.colKey, value, year: ref.year };
  if (row.subtotal) {
    const body = rows.filter(r => !r.heading && !r.subtotal && (row.net || r.layer === row.layer));
    return { ...base, source: "sistema", formula: row.net ? L("me_f_net", "Coste − amortización − deterioro") : L("me_f_sum_layer", "Suma de las filas de {x}", { x: LAYERS.find(l => l.id === row.layer)?.label.toLowerCase() ?? "" }), parts: body.map(r => ({ code: r.code, name: r.label, value: r.values[ref.colKey] ?? 0 })) };
  }
  if (table.mode === "movement") {
    const m = row.meta?.[ref.colKey] ?? {};
    const sysV = row.sys?.[ref.colKey];
    return { ...base, source: m.source ?? "sistema", formula: m.formula ?? "", parts: m.parts ?? [], link: m.link ?? null, missing: !!m.missing, systemValue: row.manual?.[ref.colKey] || row.linked?.[ref.colKey] ? sysV : undefined };
  }
  // Tablas normales: cuentas de la fila en el periodo de la columna
  if (row.linked?.[ref.colKey]) {
    const m = row.meta[ref.colKey];
    return { ...base, source: "vinculado", formula: m.formula, parts: m.parts, link: m.link, missing: m.missing, systemValue: row.code || row.extra ? row.sys?.[ref.colKey] : undefined };
  }
  if (row.manual?.[ref.colKey]) return { ...base, source: "manual", formula: L("me_kind_manual", "Escrito a mano"), parts: [], systemValue: row.sys?.[ref.colKey] };
  if (!row.code) return { ...base, source: "manual", formula: L("me_manual_row", "Fila manual"), parts: [] };
  const src = col?.src ?? (table.mode === "breakdown" ? ref.colKey : table.mode === "balance" ? ref.colKey : "cur");
  const t = ctx.accounts.find(a => a.code === row.code)?.type;
  const isPL = t === "P/L" || t === "DIS";
  const pk = src === "cur" || src === "closing" ? "cur" : src === "prevYE" || src === "opening" ? "prevYE" : src === "prevSame" ? "prevSame" : src === "prev" ? (isPL ? "prevSame" : "prevYE") : null;
  const flip = table.flip ?? 1;
  const leaves = [];
  const walk = (c, seen = new Set()) => { if (seen.has(c)) return; seen.add(c); const k = (ctx.childrenOf.get(c) ?? []).map(String).filter(x => x !== c); if (!k.length) leaves.push(c); else k.forEach(x => walk(x, seen)); };
  walk(String(row.code));
  const byCode = new Map(ctx.accounts.map(a => [a.code, a]));
  if (pk) {
    return { ...base, source: "sistema", formula: L("me_f_acc_period", "{p} de la cuenta {c}", { p: periodLabel(pk), c: row.code }), parts: leaves.map(l => ({ code: l, name: byCode.get(l)?.name ?? l, value: (ctx.value(l, pk, row.statement) ?? 0) * flip })).filter(x => Math.abs(x.value) > 0.004) };
  }
  const formula = src === "variation" ? L("me_f_variation", "Ejercicio actual − ejercicio anterior") : src === "pct" ? L("me_f_pct", "(Actual − anterior) / anterior") : src.startsWith("mov:") ? L("me_sl_plan", "Cuentas de movimiento del plan") : "";
  return { ...base, source: "sistema", formula, parts: [] };
}
