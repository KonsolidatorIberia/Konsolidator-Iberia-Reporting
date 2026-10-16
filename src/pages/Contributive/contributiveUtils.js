/* ══════════════════════════════════════════════════════════════════════
   Contribución — utilidades sin React: formato, divisas, árbol de cuentas,
   dimensiones, cálculo sobre mapeos y las reglas de contribución de
   Konsolidator (qué filas son contribución, asientos y tipo de cambio).
   ══════════════════════════════════════════════════════════════════════ */


export const BASE_URL = "";

export const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },
];

export const SUB_COLS = [
  { key: "AJE", label: "AJE", color: "text-indigo-500" },
  { key: "RJE", label: "RJE", color: "text-amber-500"  },
  { key: "EJE", label: "EJE", color: "text-rose-500"   },
  { key: "SYS", label: "SYS", color: "text-gray-400"   },
  { key: "CFA", label: "CFA", color: "text-gray-400"   },
];

/* ─── Formatting ──────────────────────────────────────────────────────────── */

export function fmtAmt(n) {
  if (n == null || n === 0) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (isNaN(num) || num === 0) return "—";
  const s = Math.abs(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `(${s})` : s;
}

/* ─── Reporting currency ──────────────────────────────────────────────────── */
// Divisa en la que va la contribución: la del grupo elegido (todas las
// columnas de un grupo están en su divisa). Sin grupo, la regla de antes.
// Moneda propia de una sociedad (modo "local").
export function getCompanyCurrency(companyShortName, companies) {
  const c = companies.find(x => (x.CompanyShortName ?? x.companyShortName) === companyShortName);
  return c?.CurrencyCode ?? c?.currencyCode ?? "";
}

export function getContributionCurrency(group, companyShortName, groupStructure, companies) {
  if (group) {
    const g = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === group);
    if (g?.CurrencyCode ?? g?.currencyCode) return g.CurrencyCode ?? g.currencyCode;
  }
  return getReportingCurrency(companyShortName, groupStructure, companies);
}

export function getReportingCurrency(companyShortName, groupStructure, companies) {
  const node = groupStructure.find(g =>
    (g.CompanyShortName ?? g.companyShortName) === companyShortName
  );
  const parentName = node?.ParentShortName ?? node?.parentShortName;
  if (!node || !parentName) {
    const own = companies.find(c =>
      (c.CompanyShortName ?? c.companyShortName) === companyShortName
    );
    return own?.CurrencyCode ?? own?.currencyCode ?? "EUR";
  }
  const parent = companies.find(c =>
    (c.CompanyShortName ?? c.companyShortName) === parentName
  );
  return parent?.CurrencyCode ?? parent?.currencyCode ?? "EUR";
}

/* ─── Sort ────────────────────────────────────────────────────────────────── */
export function pgcSort(a, b) {
  const cA = a.AccountCode ?? a.accountCode ?? "";
  const cB = b.AccountCode ?? b.accountCode ?? "";
  const aA = /^[A-Za-z]/.test(cA), bA = /^[A-Za-z]/.test(cB);
  if (aA && !bA) return -1;
  if (!aA && bA) return 1;
  const strip  = c => c.replace(/\.S$/i, "");
  const isSum  = c => /\.S$/i.test(c);
  const bsA = strip(cA), bsB = strip(cB);
  if (bsA === bsB) {
    if (isSum(cA) && !isSum(cB)) return 1;
    if (!isSum(cA) && isSum(cB)) return -1;
    return 0;
  }
  const pA = bsA.split("."), pB = bsB.split(".");
  for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
    const a = pA[i] ?? "", b = pB[i] ?? "";
    if (a === b) continue;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "es", { sensitivity: "base" });
  }
  return 0;
}

/* ─── Tree builder ────────────────────────────────────────────────────────── */
export function buildTree(accounts) {
  const sorted = [...accounts].sort(pgcSort);
  const map    = new Map();
  sorted.forEach(a => {
    const code = a.AccountCode ?? a.accountCode ?? "";
    map.set(code, { ...a, AccountCode: code, children: [] });
  });
  const roots = [];
  sorted.forEach(a => {
    const code      = a.AccountCode ?? a.accountCode ?? "";
    const sumCode   = a.SumAccountCode ?? a.sumAccountCode ?? "";
    const parent    = sumCode ? map.get(sumCode) : null;
    if (parent && !/\.S$/i.test(parent.AccountCode)) {
      parent.children.push(map.get(code));
    } else {
      const isNum   = /^\d/.test(code);
      const missing = sumCode && !map.has(sumCode);
      if (!(isNum && missing)) roots.push(map.get(code));
    }
  });
  return roots;
}

/* ─── Export helpers ──────────────────────────────────────────────────────── */

const MONTHS_LABEL = [
  "", "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function _flattenTree(roots) {
  const out = [];
  function walk(node, depth) {
    out.push({ node, depth });
    if (node.children?.length) node.children.forEach(c => walk(c, depth + 1));
  }
  roots.forEach(r => walk(r, 0));
  return out;
}

/* ─── Literal-mode helpers ───────────────────────────────────────────────── */

// Build every possible string form of a row's dimension(s), using the dim
// metadata catalogue to expand code-form values to name-form (and vice versa).
// A mapping node may store dims as any of:
//   "Centro de Coste:2", "Centro de Coste:Producción", "2", "Producción"
// We index ALL representations against the same amount so matching is O(1).
//
// `dimResolver` is a function code-or-name → { groupName, groupCode, name, code }[]
// because the same bare value (e.g. "2") might refer to multiple dimension groups.
export function buildDimKeys(r, dimResolver) {
  const keys = new Set();
  const addAllForms = (gn, gc, n, c) => {
    if (n)  keys.add(n);
    if (c)  keys.add(c);
    if (gn && n) keys.add(`${gn}:${n}`);
    if (gn && c) keys.add(`${gn}:${c}`);
    if (gc && n) keys.add(`${gc}:${n}`);
    if (gc && c) keys.add(`${gc}:${c}`);
  };

  // 1) Direct fields on the row (consolidated-accounts / journal-entries)
  const dn  = String(r.DimensionName       ?? r.dimensionName       ?? "").trim();
  const dc  = String(r.DimensionCode       ?? r.dimensionCode       ?? "").trim();
  const dgn = String(r.DimensionGroupName  ?? r.dimensionGroupName  ?? "").trim();
  const dgc = String(r.DimensionGroupCode  ?? r.dimensionGroupCode  ?? "").trim();
  if (dn || dc) {
    addAllForms(dgn, dgc, dn, dc);
    // Resolve missing name/code using the catalogue
    if (dimResolver) {
      const hits = dimResolver(dn || dc, dgn || dgc);
      hits.forEach(h => addAllForms(h.groupName, h.groupCode, h.name, h.code));
    }
  }

  // 2) Concatenated "Dimensions" field "G1:V1||G2:V2"
  const dimsField = String(r.Dimensions ?? r.dimensions ?? "").trim();
  if (dimsField) {
    dimsField.split("||").forEach(part => {
      const p = part.trim();
      if (!p) return;
      keys.add(p);
      const colon = p.indexOf(":");
      if (colon > 0) {
        const group = p.slice(0, colon);
        const value = p.slice(colon + 1);
        keys.add(value);
        if (dimResolver) {
          const hits = dimResolver(value, group);
          hits.forEach(h => addAllForms(h.groupName, h.groupCode, h.name, h.code));
        }
      }
    });
  }

  return keys;
}

// Compute a value for a literal node against a pivot.
// - isSum + children → recursive sum of children
// - dims present    → sum only matching dim keys from dimIdx
// - leaf no dims    → direct lookup in pivot
// mode: "object" → reads `pivot.get(code)?.[co]?.total`
//       "scalar" → reads `pivot.get(code)?.[co]`
export function computeLiteralForCompany(node, pivot, co, mode = "object", dimIdx = null) {
  if (!pivot) return 0;
  if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
    return node.children.reduce((s, c) => s + computeLiteralForCompany(c, pivot, co, mode, dimIdx), 0);
  }
  if (Array.isArray(node.dims) && node.dims.length > 0 && dimIdx) {
    const m = dimIdx.get(`${node.code}|${co}`);
    if (!m) return 0;
    let total = 0;
    node.dims.forEach(d => { total += (m.get(String(d)) ?? 0); });
    return total;
  }
  const cell = pivot.get(node.code);
  if (!cell) return 0;
  if (mode === "scalar") return Number(cell[co] ?? 0);
  return Number(cell[co]?.total ?? 0);
}

// Same for journal pivot (returns the object {AJE, RJE, ...} aggregated for sums)
export function computeLiteralJournalForCompany(node, journalPivot, co, journalDimIdx = null) {
  if (!journalPivot) return {};
  if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
    const out = {};
    node.children.forEach(c => {
      const childJp = computeLiteralJournalForCompany(c, journalPivot, co, journalDimIdx);
      Object.entries(childJp).forEach(([jt, amt]) => { out[jt] = (out[jt] ?? 0) + amt; });
    });
    return out;
  }
  if (Array.isArray(node.dims) && node.dims.length > 0 && journalDimIdx) {
    const m = journalDimIdx.get(`${node.code}|${co}`);
    if (!m) return {};
    const out = {};
    node.dims.forEach(d => {
      const bucket = m.get(String(d));
      if (bucket) Object.entries(bucket).forEach(([jt, amt]) => { out[jt] = (out[jt] ?? 0) + amt; });
    });
    return out;
  }
  return journalPivot.get(node.code)?.[co] ?? {};
}

// Counterparty: scalar like cmpPivot, keyed by counterparty company instead of own company
export function computeLiteralCounterpartyForCompany(node, cptyPivot, co, cptyDimIdx = null) {
  if (!cptyPivot) return 0;
  if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
    return node.children.reduce((s, c) => s + computeLiteralCounterpartyForCompany(c, cptyPivot, co, cptyDimIdx), 0);
  }
  if (Array.isArray(node.dims) && node.dims.length > 0 && cptyDimIdx) {
    const m = cptyDimIdx.get(`${node.code}|${co}`);
    if (!m) return 0;
    let total = 0;
    node.dims.forEach(d => { total += (m.get(String(d)) ?? 0); });
    return total;
  }
  return Number(cptyPivot.get(node.code)?.[co] ?? 0);
}

/* ─── Pivot Row ───────────────────────────────────────────────────────────── */
export const INDENT = 14;

/* ─── Main ────────────────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════
   Contribución como Konsolidator / Power BI ("Sábana de Consolidación",
   bloque Contribución, y su "Rastro del dato"). Comprobado contra el modelo:
     · Columnas del grupo G: la matriz (filas Parent de G) y cada sociedad que
       aporta a G (filas Contribution con GroupShortName = G). Importe en la
       divisa del grupo (AmountYTD).
     · Desglose de una sociedad = carga + asientos SYS, AJE y RJE
       CONTABILIZADOS, con su signo y convertidos a la divisa del grupo
       (cierre en balance, medio en PyG y DIS; el Custom manda si es > 0).
     · Desglose de un subgrupo = su consolidado convertido = lo que aportan sus
       sociedades + sus eliminaciones (EJE) contabilizadas.
     · EJE de las filiales y CFA no forman parte de la contribución.
   ══════════════════════════════════════════════════════════════════════ */
export const amountOf = (r) => {
  const v = Number(r.AmountYTD ?? r.amountYTD);
  return Number.isFinite(v) ? v : 0;
};

export const isPostedJournal = (r) => {
  const p = r.Posted ?? r.posted;
  return p === true || p === "true" || p === "True" || p === 1;
};

// ¿Fila de contribución al grupo G? (matriz: Parent; resto: Contribution)
export function isContributionRow(r, G) {
  if (!G) return false;
  const role = r.CompanyRole ?? r.companyRole ?? "";
  const grp = r.GroupShortName ?? r.groupShortName ?? "";
  if (grp !== G) return false;
  if (role === "Contribution") return true;
  return role === "Parent" && (r.CompanyShortName ?? r.companyShortName ?? "") === G;
}

// Factor de conversión de la divisa de una sociedad a la del grupo G.
export function makeFxToGroup(exchangeRates, companies, G) {
  const curOf = (co) => {
    const c = companies.find(x => (x.CompanyShortName ?? x.companyShortName) === co);
    return c?.CurrencyCode ?? c?.currencyCode ?? "";
  };
  const rates = new Map();
  (exchangeRates ?? []).forEach(r => rates.set(String(r.CurrencyCode ?? r.currencyCode ?? ""), r));
  const rateOf = (cur, bs) => {
    const r = rates.get(cur);
    if (!r) return null;
    const pick = (custom, dflt) => (Number(custom) > 0 ? Number(custom) : Number(dflt));
    return bs
      ? pick(r.CustomEndRate ?? r.customEndRate, r.DefaultEndRate ?? r.defaultEndRate)
      : pick(r.CustomAvgRate ?? r.customAvgRate, r.DefaultAvgRate ?? r.defaultAvgRate);
  };
  const gCur = curOf(G);
  return (co, accountType) => {
    const cCur = curOf(co);
    if (!cCur || !gCur || cCur === gCur) return 1;
    const bs = !(accountType === "P/L" || accountType === "DIS");
    const a = rateOf(cCur, bs), b = rateOf(gCur, bs);
    return a && b ? a / b : 1;
  };
}

// Periodo inicial a partir de las consolidaciones hechas (como la sábana):
// el último del mismo escenario y estructura (como mucho `before`, en meses
// año*12+mes); si no hay, el último del escenario; si no, el último de todos.
export function pickPeriodFromRuns(runs, { source = "Actual", structure, before } = {}) {
  const ym = (y, m) => Number(y) * 12 + Number(m);
  const list = (Array.isArray(runs) ? runs : [])
    .map(c => ({
      y: Number(c.Year ?? c.year),
      m: Number(c.Month ?? c.month),
      source: c.Source ?? c.source ?? "",
      structure: c.GroupStructure ?? c.groupStructure ?? "",
    }))
    .filter(r => r.y && r.m && r.source && r.structure);
  if (!list.length) return null;
  const latest = (arr) => arr.reduce((best, r) => (!best || ym(r.y, r.m) > ym(best.y, best.m) ? r : best), null);
  const same = list.filter(r => r.source === source && r.structure === structure);
  const limit = before ?? Infinity;
  return latest(same.filter(r => ym(r.y, r.m) <= limit))
    ?? latest(same)
    ?? latest(list.filter(r => r.source === source))
    ?? latest(list);
}
