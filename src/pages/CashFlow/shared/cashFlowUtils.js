/* ══════════════════════════════════════════════════════════════════════
   Utilidades del cash flow (individual y consolidado): formato, parseo, filtros por
   dimensión, reparación del XLSX exportado y conversión de mapeos.
   Sin React: se pueden probar y reutilizar por separado.
   ══════════════════════════════════════════════════════════════════════ */
import JSZip from "jszip";

export const BASE = "https://api.konsolidator.com/v2";


export const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },

];

export const fmt = (n) => {
  if (n == null || n === "") return "—";
  const num = Number(n);
  if (!isFinite(num)) return "—";
  // Treat values that round to 0.00 as empty, matching the previous behaviour.
  if (Math.round(num * 100) === 0) return "—";
  const s = Math.abs(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `(${s})` : s;
};

export function parseDimensionsField(str) {
  if (!str || typeof str !== "string") return [];
  return str.split("||").map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return { group: pair.slice(0, idx).trim(), code: pair.slice(idx + 1).trim() };
  }).filter(Boolean);
}

export function rowMatchesDimMulti(r, groups, codes) {
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

export const parseAmt = (val) => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

// Strips Infinity/NaN cells + ExcelJS quirks so Excel doesn't pop "recovered content"
export async function repairCfXlsx(buffer) {
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
export function convertCfMappingTree(tree) {
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
export function buildCfMappingLiteral(tree) {
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

/* GET JSON a la API con tiempo máximo. Devuelve d.value ?? d. Si falla o
   tarda más de `timeout` ms: devuelve `fallback` si se indicó; si no, lanza.
   `signal` permite cancelar desde fuera (al desmontar o cambiar de periodo). */
export async function fetchJson(url, { token, timeout = 30000, fallback, signal } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    const d = await res.json();
    return d?.value ?? d;
  } catch (err) {
    if (fallback !== undefined && !signal?.aborted) return fallback;
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Multiperiodo (igual que Individuales y Dimensiones)
   periods: [{ year: "2026", months: [7, 8, 9] }, …]
   ══════════════════════════════════════════════════════════════════════ */

// ¿La selección suma más de un mes?
export function isMultiSelection(periods) {
  const withMonths = (periods || []).filter(p => p.months?.length);
  return withMonths.length > 1 || (withMonths.length === 1 && withMonths[0].months.length > 1);
}

// Clave estable de una selección (para saber si hay que recalcular)
export function periodsKey(periods) {
  return (periods || []).filter(p => p.months?.length)
    .map(p => `${p.year}:${[...p.months].sort((a, b) => a - b).join(",")}`).join("|");
}

// Meses → tramos seguidos: [1,2,3,7,8] → [[1,2,3],[7,8]]
export function splitContiguous(months) {
  const ms = [...new Set((months || []).map(Number))].sort((a, b) => a - b);
  const runs = [];
  let run = [];
  ms.forEach(m => {
    if (run.length && m === run[run.length - 1] + 1) run.push(m);
    else { if (run.length) runs.push(run); run = [m]; }
  });
  if (run.length) runs.push(run);
  return runs;
}

// Cierres que hay que leer: el último mes de cada tramo y el anterior al primero
export function closesNeeded(periods) {
  const need = new Set();
  (periods || []).forEach(p => splitContiguous(p.months).forEach(run => {
    need.add(`${p.year}-${run[run.length - 1]}`);
    if (run[0] > 1) need.add(`${p.year}-${run[0] - 1}`);
  }));
  return need.size;
}

// Campos que distinguen una línea (cuenta, cuenta local, sociedad, rol,
// asiento…): dos meses se restan línea a línea con esta clave.
const ROW_KEY_FIELDS = ["AccountCode", "LocalAccountCode", "CompanyShortName", "CompanyRole", "AccountType",
  "Origin", "JournalNumber", "JournalType", "Dimensions"];
const rowKeyOf = (r) => ROW_KEY_FIELDS.map(f => r[f] ?? r[f.charAt(0).toLowerCase() + f.slice(1)] ?? "").join("\u0000");

/* Suma de los periodos elegidos a partir de los YTD de cada cierre: para un
   tramo seguido [a..b] el total es YTD(b) − YTD(a−1), así solo se leen los
   meses frontera. Las filas devueltas tienen la misma forma que las de la
   API (con AmountYTD = suma del rango): la página las trata como un mes más.
   fetchMonth(year, month) → Promise<rows[]>; onProgress() se llama al llegar
   cada cierre. */
export async function sumPeriodRows(periods, fetchMonth, onProgress) {
  const need = new Map();
  const plan = [];
  (periods || []).forEach(p => {
    splitContiguous(p.months).forEach(run => {
      const first = run[0], last = run[run.length - 1];
      const addKey = `${p.year}-${last}`;
      const subKey = first > 1 ? `${p.year}-${first - 1}` : null;
      need.set(addKey, { year: p.year, month: last });
      if (subKey) need.set(subKey, { year: p.year, month: first - 1 });
      plan.push({ addKey, subKey });
    });
  });
  const entries = [...need.values()];
  const results = await Promise.all(entries.map(e => Promise.resolve(fetchMonth(e.year, e.month))
    .then(r => { onProgress?.(); return Array.isArray(r) ? r : []; })));
  const ytdBy = new Map();
  entries.forEach((e, i) => {
    const m = new Map();
    results[i].forEach(r => {
      const k = rowKeyOf(r);
      const v = parseAmt(r.AmountYTD ?? r.amountYTD);
      if (m.has(k)) m.get(k).ytd += v; else m.set(k, { row: r, ytd: v });
    });
    ytdBy.set(`${e.year}-${e.month}`, m);
  });
  const acc = new Map();
  plan.forEach(({ addKey, subKey }) => {
    const add = ytdBy.get(addKey) ?? new Map();
    const sub = subKey ? (ytdBy.get(subKey) ?? new Map()) : new Map();
    add.forEach((en, k) => {
      if (!acc.has(k)) acc.set(k, { row: en.row, amount: 0 });
      acc.get(k).amount += en.ytd - (sub.get(k)?.ytd ?? 0);
    });
    // Líneas que había en el mes anterior al tramo y ya no: se restan
    sub.forEach((en, k) => {
      if (add.has(k)) return;
      if (!acc.has(k)) acc.set(k, { row: en.row, amount: 0 });
      acc.get(k).amount -= en.ytd;
    });
  });
  return [...acc.values()].map(({ row, amount }) => ({
    ...row, AmountYTD: amount, amountYTD: amount, AmountPeriod: amount, amountPeriod: amount,
  }));
}

// [{year, months}] → líneas por año ("Jul–Sep, Dic") y nº de meses
export function describePeriods(periods, monthName) {
  const short = (m) => String(monthName(Number(m)) ?? m).slice(0, 3);
  let count = 0;
  const lines = (periods || []).filter(p => p.months?.length).map(p => {
    const runs = splitContiguous(p.months);
    count += runs.reduce((n, r) => n + r.length, 0);
    return { year: String(p.year), text: runs.map(r => (r.length === 1 ? short(r[0]) : `${short(r[0])}–${short(r[r.length - 1])}`)).join(", ") };
  });
  return { lines, count };
}