/* ══════════════════════════════════════════════════════════════════════
   Datos de las presentaciones: KPIs individuales y consolidados.

   El motor de cálculo (carga de la biblioteca de KPIs, mapeo del estándar y
   evaluación de fórmulas) está copiado TAL CUAL de KpiIndividualesPage.jsx y
   ConsolidatedKpiPage.jsx, para que un KPI dé en la presentación exactamente
   el mismo valor que en su página. Si se cambia el motor allí, hay que
   replicarlo aquí (o, mejor, moverlo a un módulo compartido en la reforma).
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { listCompanyKpis } from "../../lib/kpisApi";
import { getActiveCompanyId } from "../../lib/mappingsApi";


/* ── Supabase (copiado de KpiIndividualesPage.jsx) ── */

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

function getSbAuthToken() {
  try {
    const key = "sb-gmcawsapzkzmgrtiqebv-auth-token";
    if (!key) return null;
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed?.access_token ?? parsed?.data?.session?.access_token ?? null;
  } catch { return null; }
}



// Paginated fetch — PostgREST caps individual responses at 1000 rows
// regardless of Range header. Standard tables can exceed this (Konsolidator: 1089).
// Fetch in 1000-row pages and concatenate.
const sbGet = async (path) => {
  const token = getSbAuthToken();
  const baseHeaders = {
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${token ?? SUPABASE_APIKEY}`,
    Prefer: "count=exact",
  };

  const PAGE = 1000;
  const all = [];
  let offset = 0;

  for (let safety = 0; safety < 20; safety++) {
    const rangeEnd = offset + PAGE - 1;
    const res = await fetch(`${SUPABASE_URL}/${path}`, {
      headers: { ...baseHeaders, Range: `${offset}-${rangeEnd}` },
    });
    const chunk = await res.json();
    if (!Array.isArray(chunk)) return chunk;
    all.push(...chunk);
    if (chunk.length < PAGE) break;
    const cr = res.headers.get("content-range");
    if (!cr) break;
    const parts = cr.split("/");
    const total = parseInt(parts[1], 10);
    if (!isNaN(total) && all.length >= total) break;
    offset += PAGE;
  }

  return all;
};

/* ── Estándar contable y biblioteca de KPIs (copiado de KpiIndividualesPage.jsx) ── */

function detectStandard(groupAccounts) {
  if (!groupAccounts?.length) {
    return null;
  }

  // Inspect BOTH accountCode and parentCode — the standard markers (.S, .PL,
  // alpha codes like "A.01") often live in the parent column, not the leaf.
  const codes = [];
  groupAccounts.forEach(n => {
    const ac = String(n.accountCode ?? n.AccountCode ?? "");
    const pc = String(n.parentCode  ?? n.ParentCode  ?? "");
    if (ac) codes.push(ac);
    if (pc) codes.push(pc);
  });

  if (codes.length === 0) return null;

  // PGC: presence of a code ending in ".S" anywhere in the chart of accounts
  const isPGC = codes.some(c => c.endsWith(".S"));

  // Spanish IFRS-ES: presence of ".PL" suffix
  const isSpanishIfrsEs = !isPGC && codes.some(c => c.endsWith(".PL"));

  // Spanish IFRS (classic): alpha codes like "A.01", "B.12" — but NOT PGC/ES variants
  const isSpanishIFRS = !isPGC && !isSpanishIfrsEs &&
                        codes.some(c => /^[A-Z]\.\d/.test(c));

  // Danish IFRS: pure-numeric 5-6 digit codes
  const isDanishIFRS = !isPGC && !isSpanishIfrsEs && !isSpanishIFRS &&
                       codes.some(c => /^\d{5,6}$/.test(c));

  let standard = null;
  if      (isPGC)           standard = "PGC";
  else if (isSpanishIfrsEs) standard = "SpanishIFRS-ES";
  else if (isSpanishIFRS)   standard = "SpanishIFRS";
  else if (isDanishIFRS)    standard = "DanishIFRS";

return standard;
}

const STANDARD_TO_TABLE = {
  PGC:               { pl: "pgc_pl_rows",             bs: "pgc_bs_rows" },
  DanishIFRS:        { pl: "danish_ifrs_pl_rows",     bs: "danish_ifrs_bs_rows" },
  "SpanishIFRS-ES":  { pl: "spanish_ifrs_es_pl_rows", bs: "spanish_ifrs_es_bs_rows" },
};
const STANDARD_TO_PL_TABLE = {
  PGC: "pgc_pl_rows",
  DanishIFRS: "danish_ifrs_pl_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_pl_rows",
};

const STANDARD_TO_BS_TABLE = {
  PGC: "pgc_bs_rows",
  DanishIFRS: "danish_ifrs_bs_rows",
  "SpanishIFRS-ES": "spanish_ifrs_es_bs_rows",
};

async function loadStandardMapping(standard, groupAccounts) {
  if (!standard) return null;

  const isCustom = standard.startsWith("CUSTOM-");

  let allRows = [];
  if (isCustom) {
    // Unified schema: one table, filter by standard_key + statement.
    const rows = await sbGet(
      `standard_statement_rows?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag` +
      `&standard_key=eq.${encodeURIComponent(standard)}` +
      `&statement=in.(PL,BS)`
    );
    allRows = Array.isArray(rows) ? rows : [];
  } else {
    const plTable = STANDARD_TO_PL_TABLE[standard];
    const bsTable = STANDARD_TO_BS_TABLE[standard];
    if (!plTable) return null;

    const [plRows, bsRows] = await Promise.all([
      sbGet(`${plTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`),
      sbGet(`${bsTable}?select=account_code,account_name,section_code,parent_code,is_sum,cc_tag`).catch(() => []),
    ]);
    allRows = [...(Array.isArray(plRows) ? plRows : []), ...(Array.isArray(bsRows) ? bsRows : [])];
  }

  // STEP 1: build codeCcTag and codeSection from taxonomy (ignore is_sum filter)
  const codeCcTag = new Map();
  const codeSection = new Map();
  for (const r of allRows) {
    if (r.cc_tag) codeCcTag.set(String(r.account_code), r.cc_tag);
    if (r.section_code) codeSection.set(String(r.account_code), r.section_code);
  }

// STEP 2: build parentOf — first from standard mapping table's parent_code,
  // then overridden by groupAccounts.SumAccountCode for runtime leaves.
  const parentOf = new Map();
  for (const r of allRows) {
    if (r.account_code && r.parent_code) {
      parentOf.set(String(r.account_code), String(r.parent_code));
    }
  }
  for (const ga of (groupAccounts || [])) {
    if (ga.AccountCode && ga.SumAccountCode) {
      parentOf.set(String(ga.AccountCode), String(ga.SumAccountCode));
    }
  }

  // STEP 3: invert into ccTagToCodes and sectionCodes
  const ccTagToCodes = new Map();
  const sectionCodes = new Map();
for (const ga of (groupAccounts || [])) {
    const code = String(ga.AccountCode);
    let cur = code;
    let hops = 0;
    let foundTag = null;
    let foundSection = null;
    while (cur && hops < 25) {
      if (codeCcTag.has(cur) && !foundTag) foundTag = codeCcTag.get(cur);
      if (codeSection.has(cur) && !foundSection) foundSection = codeSection.get(cur);
      if (foundTag && foundSection) break;
      cur = parentOf.get(cur);
      hops++;
    }
if (foundTag) {
      if (!ccTagToCodes.has(foundTag)) ccTagToCodes.set(foundTag, []);
      ccTagToCodes.get(foundTag).push(code);
      if (foundSection) {
        const key = `${foundTag}::${foundSection}`;
        if (!sectionCodes.has(key)) sectionCodes.set(key, []);
        sectionCodes.get(key).push(code);
      }
    }
  }


  return { ccTagToCodes, sectionCodes };
}
async function loadKpiLibrary(standard, companyId) {
  const [defs, standardOverrides, companyOverrides] = await Promise.all([
    sbGet("kpi_definitions?select=*&order=sort_order.asc"),
    standard
      ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}&company_id=is.null`)
      : Promise.resolve([]),
    companyId
      ? sbGet(`kpi_definitions_override?select=*&company_id=eq.${encodeURIComponent(companyId)}`)
      : Promise.resolve([]),
  ]);

  if (!Array.isArray(defs)) {
    console.error("[KpiResolver] kpi_definitions returned non-array:", defs);
    return [];
  }

const overrideByKpi = new Map();
  // Standard-level overrides applied first
  if (Array.isArray(standardOverrides)) {
    standardOverrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  }
  // Company-level overrides win over standard-level
  if (Array.isArray(companyOverrides)) {
    companyOverrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  }


  return defs.map(d => ({
    id:          d.id,
    label:       d.label,
    description: d.description ?? "",
    category:    d.category ?? "",
    format:      d.format ?? "currency",
    tag:         d.tag ?? "",
    benchmark:   d.benchmark ?? null,
    formula:     overrideByKpi.get(d.id) ?? d.formula,
  }));
}

// Resolve the standard for a company:
//   1. If activeStandardKey is passed in (from EpicLoader prefetch) → use it
//   2. Otherwise if companyId is known → check binding
//   3. Otherwise → fall back to code-pattern sniff
async function resolveStandardKey(companyId, groupAccounts, preResolvedKey) {
  if (preResolvedKey) return preResolvedKey;
  if (companyId) {
    try {
      const rows = await sbGet(
        `company_active_standard?select=standard_key&company_id=eq.${companyId}`
      );
      const boundKey = Array.isArray(rows) && rows[0]?.standard_key;
      if (boundKey) return boundKey;
    } catch { /* fall through to sniff */ }
  }
  return detectStandard(groupAccounts);
}

/* ── Biblioteca de KPIs consolidada (copiado de ConsolidatedKpiPage.jsx) ── */

async function loadKpiLibraryConsolidated(standard) {
  const [defs, overrides] = await Promise.all([
    sbGet("kpi_definitions?select=*&order=sort_order.asc"),
    standard ? sbGet(`kpi_definitions_override?select=*&standard=eq.${encodeURIComponent(standard)}`).catch(() => []) : Promise.resolve([]),
  ]);
  if (!Array.isArray(defs)) return [];
  const overrideByKpi = new Map();
  if (Array.isArray(overrides)) overrides.forEach(o => overrideByKpi.set(o.kpi_id, o.formula));
  return defs.map(d => ({
    id: d.id, label: d.label, description: d.description ?? "",
    category: d.category ?? "", format: d.format ?? "currency",
    tag: d.tag ?? "", benchmark: d.benchmark ?? null,
    formula: overrideByKpi.get(d.id) ?? d.formula,
  }));
}

/* ── Motor individual (copiado de KpiIndividualesPage.jsx) ── */

function pivotSum(pivot, codes) {
  if (!codes || codes.size === 0) return 0;
  let total = 0;
  codes.forEach(code => { total += (pivot.get(code) ?? 0); });
  return total;
}

// ── Party cell formula resolver (ported from StatisticalPartiesPage.jsx) ──
const PARTY_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PARTY_COL_LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L"];
const PARTY_COL_INDEX = Object.fromEntries(PARTY_COL_LETTERS.map((c, i) => [c, i]));
function _partyParseRef(tok) {
  const m = /^([A-La-l])(\d+)$/.exec(tok);
  if (!m) return null;
  const col = PARTY_COL_INDEX[m[1].toUpperCase()];
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { row, col };
}
function _partyTokenize(src) {
  const tokens = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if ("+-*/()%^:,".includes(ch)) { tokens.push({ t: ch }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const asRef = _partyParseRef(word);
      if (asRef) tokens.push({ t: "ref", v: asRef, raw: word });
      else tokens.push({ t: "name", v: word.toUpperCase() });
      i = j; continue;
    }
    return null;
  }
  return tokens;
}
function _partyEvalFormula(formulaStr, computed, dims, resolving) {
  const src = formulaStr.trim().replace(/^=/, "");
  const tokens = _partyTokenize(src);
  if (!tokens) return NaN;
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => { const tok = tokens[pos]; if (tok && tok.t === t) { pos++; return tok; } return null; };
  const resolveRef = (ref) => {
    if (ref.row < 0 || ref.row >= dims.length) return 0;
    const dimCode = dims[ref.row];
    const month = ref.col + 1;
    const key = `${dimCode}:${month}`;
    if (resolving.has(key)) return 0;
    const cached = computed[dimCode]?.[month];
    if (cached != null) return cached;
    return 0;
  };
  const parseExpr = () => {
    let left = parseTerm();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = tokens[pos++].t;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = () => {
    let left = parseFactor();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = tokens[pos++].t;
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parseFactor = () => {
    let val = parseUnary();
    if (peek() && peek().t === "%") { pos++; val = val / 100; }
    if (peek() && peek().t === "^") { pos++; val = Math.pow(val, parseFactor()); }
    return val;
  };
  const parseUnary = () => {
    if (peek() && peek().t === "-") { pos++; return -parseUnary(); }
    if (peek() && peek().t === "+") { pos++; return parseUnary(); }
    return parsePrimary();
  };
  const parsePrimary = () => {
    const tok = peek();
    if (!tok) return 0;
    if (tok.t === "num") { pos++; return tok.v; }
    if (tok.t === "ref") { pos++; return resolveRef(tok.v); }
    if (tok.t === "(") { pos++; const v = parseExpr(); eat(")"); return v; }
    if (tok.t === "name") {
      const name = tok.v; pos++;
      if (!eat("(")) return 0;
      const first = eat("ref");
      if (first && eat(":")) {
        const last = eat("ref");
        eat(")");
        if (!last) return 0;
        const r0 = Math.min(first.v.row, last.v.row);
        const r1 = Math.max(first.v.row, last.v.row);
        const c0 = Math.min(first.v.col, last.v.col);
        const c1 = Math.max(first.v.col, last.v.col);
        const vals = [];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) vals.push(resolveRef({ row: r, col: c }));
        if (name === "SUM") return vals.reduce((s, v) => s + v, 0);
        if (name === "AVG" || name === "AVERAGE") return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        if (name === "MIN") return vals.length ? Math.min(...vals) : 0;
        if (name === "MAX") return vals.length ? Math.max(...vals) : 0;
        return 0;
      }
      const v = parseExpr(); eat(")");
      if (name === "ABS") return Math.abs(v);
      return v;
    }
    return 0;
  };
  try { const r = parseExpr(); return Number.isFinite(r) ? r : NaN; } catch { return NaN; }
}
function evaluatePartyYear(yearVals, dims) {
  const computed = {};
  for (const dim of dims) {
    computed[dim] = {};
    const dimMap = yearVals[dim] ?? {};
    for (const m of PARTY_MONTHS) {
      const cell = dimMap[m];
      if (!cell) continue;
      if (cell.formula == null && cell.value != null) computed[dim][m] = cell.value;
    }
  }
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const dim of dims) {
      const dimMap = yearVals[dim] ?? {};
      for (const m of PARTY_MONTHS) {
        const cell = dimMap[m];
        if (!cell?.formula) continue;
        const key = `${dim}:${m}`;
        const resolving = new Set([key]);
        const v = _partyEvalFormula(cell.formula, computed, dims, resolving);
        const prev = computed[dim][m];
        if (Number.isFinite(v) && prev !== v) { computed[dim][m] = v; changed = true; }
      }
    }
    if (!changed) break;
  }
  return computed;
}

function evalIndividual(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;
  switch (node.type) {
case "account": {
      // Cuenta ligada a una dimensión concreta: busca la clave exacta,
      // primero por código LOCAL y luego por código de grupo.
      if (node.dimGroup || node.dimCode) {
        const key = `${node.accountCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
        if (pivot.__localDimPivot && pivot.__localDimPivot.has(key)) {
          return -(pivot.__localDimPivot.get(key) ?? 0);
        }
        if (pivot.__dimPivot) {
          return -(pivot.__dimPivot.get(key) ?? 0);
        }
      }
      // Cuenta local presente directamente en el pivot local (vista empresa).
      if (pivot.__localPivot && pivot.__localPivot.has(node.accountCode)) {
        return -(pivot.__localPivot.get(node.accountCode) ?? 0);
      }
      // Cuenta simple presente en el pivot principal → úsalo directamente.
      if (pivot.has(node.accountCode)) {
        return -(pivot.get(node.accountCode) ?? 0);
      }
      // Pivot con scope de dimensión: el importe de la cuenta para ESTA columna
      // de dimensión vive en las sub-tablas por dimensión, no en el pivot
      // principal. Una cuenta LOCAL se indexa en __localDimPivot como
      // `local:::grupoDim:::dimCode`; una cuenta con código de grupo vive en
      // __dimPivot. Escanea ambos y suma las entradas de la columna actual.
      const _vs = pivot.__variationScope;
      if (_vs && _vs.kind === "dimension" && _vs.key) {
        let t = 0, found = false;
        const scan = (map) => {
          if (!map) return;
          map.forEach((val, k) => {
            const parts = k.split(":::");
            if (parts[0] === node.accountCode && parts[2] === _vs.key) { t += val; found = true; }
          });
        };
        scan(pivot.__localDimPivot);
        scan(pivot.__dimPivot);
        if (found) return -t;
      }
      let total = 0;
      pivot.forEach((val, ac) => { if (ac === node.accountCode) total += val; });
      return -total;
    }
case "accountGroup": {
      // Group + dim → look up in dimPivot (keyed as "code:::dimGroup:::dimCode")
      // Use ONLY the group code itself, not descendants — the sum-row already
      // carries the aggregate, and descendant rows would double-count.
      if (node.groupCode && (node.dimGroup || node.dimCode)) {
        const key = `${node.groupCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
        const total = pivot.__dimPivot?.get(key) ?? 0;
        return -total;
      }
// No dim → sum the group account + its descendants
      if (node.groupCode) {
        const descendants = pivot.__groupDescendants?.get(node.groupCode);
        // Pivot con scope de dimensión: los importes por dimensión de los
        // descendientes viven en __dimPivot/__localDimPivot (`code:::grupo:::dimKey`),
        // no en el pivot principal. Suma ahí los de ESTA dimensión.
        const _vs = pivot.__variationScope;
        if (_vs && _vs.kind === "dimension" && _vs.key) {
          const codes = (descendants && descendants.size > 0)
            ? new Set([...descendants, node.groupCode])
            : new Set([node.groupCode]);
          let t = 0, found = false;
          const scan = (map) => {
            if (!map) return;
            map.forEach((val, k) => {
              const parts = k.split(":::");
              if (codes.has(parts[0]) && parts[2] === _vs.key) { t += val; found = true; }
            });
          };
          scan(pivot.__dimPivot);
          scan(pivot.__localDimPivot);
          if (found) return -t;
        }
        let total = 0;
        if (descendants && descendants.size > 0) {
          descendants.forEach(c => { total += (pivot.get(c) ?? 0); });
        } else {
          total = pivot.get(node.groupCode) ?? 0;
        }
        return -total;
      }
      // Legacy prefix path (older saved formulas)
      let total = 0;
      pivot.forEach((val, ac) => { if (node.prefix && ac.startsWith(node.prefix)) total += val; });
      return -total;
    }
case "manual": return Number(node.value) || 0;
case "party": {
      if (!pivot.__parties || !pivot.__partyContext) return 0;
      const party = pivot.__parties.get(node.partyId);
      if (!party) return 0;
      const ctx = pivot.__partyContext;
      const shared = party.sharedAcrossCompanies !== false;

      // Empresas sobre las que sumar. Shared → se evalúa una sola vez (la
      // partida no depende de empresa). Per-company → suma la aportación de
      // cada empresa seleccionada que tenga la partida asignada. Reactivo a la
      // selección de empresas (ctx.companies), con fallback a la única
      // ctx.company (que usa la vista principal, un pivot por empresa).
      let companies;
      if (shared) {
        companies = ["__shared__"];
      } else {
        const sel = (ctx.companies && ctx.companies.length)
          ? ctx.companies
          : (ctx.company ? [ctx.company] : []);
        companies = sel.filter(c => !party.companies?.length || party.companies.includes(c));
      }
      if (!companies.length) return 0;

      // Dimensiones a sumar: la del nodo si es específica; si no, las del
      // contexto (ya acotadas por columna en el dim view); si no, todas.
      const dimFilter = ctx.selectedDims && ctx.selectedDims.size > 0
        ? party.dims.filter(d => ctx.selectedDims.has(d))
        : party.dims;
      const dimsToSum = node.dimCode ? [node.dimCode] : dimFilter;

      let total = 0;
      for (const co of companies) {
        const yearTree = shared ? (party.values ?? {}) : (party.values?.[co] ?? {});
        const yearMap = yearTree[String(ctx.year)];
        if (!yearMap) continue;
        const cacheKey = `party:${node.partyId}:${co}:${ctx.year}`;
        let computed = cache.get(cacheKey);
        if (!computed) {
          computed = evaluatePartyYear(yearMap, party.dims);
          cache.set(cacheKey, computed);
        }
        for (const dim of dimsToSum) {
          const v = computed[dim]?.[ctx.month];
          if (typeof v === "number") total += v;
        }
      }
      return total;
    }
    case "op": {
      const l = evalIndividual(node.left,  pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      const r = evalIndividual(node.right, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? null : l / r;
      return 0;
    }
    case "fn": {
      const a = evalIndividual(node.arg, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      if (a === null) return null;
      if (node.fn === "abs") return Math.abs(a);
      if (node.fn === "neg") return -a;
      if (node.fn === "pct") return a * 100;
      return a;
    }
    case "ref": {
      if (cache.has(node.kpiId)) return cache.get(node.kpiId);
      const ref = kpiList.find(k => k.id === node.kpiId);
      if (!ref) return 0;
      const val = evalIndividual(ref.formula, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      cache.set(node.kpiId, val);
      return val;
    }
case "text": {
      if (!node.expression || !node.variables) return 0;
      try {
        let expr = node.expression;
        const scope = pivot.__variationScope;
        const variations = pivot.__currentKpiVariations;
        Object.entries(node.variables).forEach(([letter, varNode]) => {
          let effectiveNode = varNode;
          if (scope && variations) {
            const map = scope.kind === "company" ? variations.byCompany : (scope.kind === "dimension" ? variations.byDimension : null);
            const override = map?.[scope.key]?.[letter];
            if (override) {
              const norm = { ...override };
              if (norm.type === "accountGroup" && typeof norm.prefix === "string" && norm.prefix.includes(":::")) {
                const [gc, dg, dc] = norm.prefix.split(":::");
                norm.prefix = gc; norm.groupCode = gc;
                if (!norm.dimGroup) norm.dimGroup = dg || undefined;
                if (!norm.dimCode)  norm.dimCode  = dc || undefined;
              }
              if (norm.type === "account" && typeof norm.accountCode === "string" && norm.accountCode.includes(":::")) {
                const [ac, dg, dc] = norm.accountCode.split(":::");
                norm.accountCode = ac;
                if (!norm.dimGroup) norm.dimGroup = dg || undefined;
                if (!norm.dimCode)  norm.dimCode  = dc || undefined;
              }
effectiveNode = norm;
            }
          }
          const v = effectiveNode ? evalIndividual(effectiveNode, pivot, cache, kpiList, ccTagToCodes, sectionCodes) : 0;
          expr = expr.replaceAll(letter, `(${v ?? 0})`);
        });
        return Function(`"use strict"; return (${expr})`)() ?? 0;
      } catch { return null; }
    }
case "cc": {
      const codes = ccTagToCodes.get(node.tag);
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
    case "section": {
      const key = `${node.statement}::${node.section}`;
      const codes = sectionCodes.get(key);
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
    default: return 0;
  }
}

function computeIndividual(visibleKpis, pivot, ccTagToCodes, sectionCodes, allKpis = null) {
  // Use the full list for ref lookups so chained refs still resolve when only
  // a subset of KPIs is visible. Falls back to visibleKpis if no full list given.
  const refList = allKpis ?? visibleKpis;
  const cache = new Map();
  visibleKpis.forEach(kpi => {
    if (!cache.has(kpi.id)) {
      // Inject the current KPI's variations so the "text" case can pick per-scope overrides.
      pivot.__currentKpiVariations = kpi.variations ?? null;
      const val = evalIndividual(kpi.formula, pivot, cache, refList, ccTagToCodes, sectionCodes);
      cache.set(kpi.id, val);
    }
  });
  pivot.__currentKpiVariations = null;
  return cache;
}

/* ── Motor consolidado (copiado de ConsolidatedKpiPage.jsx) ── */

function evalConsolidated(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;
  switch (node.type) {
    case "manual": return Number(node.value) || 0;
    case "op": {
      const l = evalConsolidated(node.left, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      const r = evalConsolidated(node.right, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? null : l / r;
      return 0;
    }
    case "fn": {
      const a = evalConsolidated(node.arg, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      if (a === null) return null;
      if (node.fn === "abs") return Math.abs(a);
      if (node.fn === "neg") return -a;
      if (node.fn === "pct") return a * 100;
      return a;
    }
    case "ref": {
      if (cache.has(node.kpiId)) return cache.get(node.kpiId);
      const ref = kpiList.find(k => k.id === node.kpiId);
      if (!ref) return 0;
      const val = evalConsolidated(ref.formula, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      cache.set(node.kpiId, val);
      return val;
    }
case "text": {
      if (!node.expression || !node.variables) return 0;
      try {
        let expr = node.expression;
        // Variation overrides: if the pivot has a variation scope and the
        // current KPI defines variations for it, per-letter nodes can be swapped.
        const scope = pivot.__variationScope;
        const variations = pivot.__currentKpiVariations;
Object.entries(node.variables).forEach(([letter, varNode]) => {
          let effectiveNode = varNode;
if (scope && variations) {
const map = scope.kind === "company" ? variations.byCompany : (scope.kind === "dimension" ? variations.byDimension : null);
            const override = map?.[scope.key]?.[letter];
            if (override) {
              let normalized = override;
              if (override.prefix && typeof override.prefix === "string" && override.prefix.includes(":::") && !override.dimGroup && !override.dimCode) {
                const [p, g, c] = override.prefix.split(":::");
                normalized = { ...override, prefix: p, dimGroup: g, dimCode: c };
              } else if (override.accountCode && typeof override.accountCode === "string" && override.accountCode.includes(":::") && !override.dimGroup && !override.dimCode) {
                const [a, g, c] = override.accountCode.split(":::");
                normalized = { ...override, accountCode: a, dimGroup: g, dimCode: c };
              }
              effectiveNode = normalized;
            }
          }
          const v = effectiveNode ? evalConsolidated(effectiveNode, pivot, cache, kpiList, ccTagToCodes, sectionCodes) : 0;
          expr = expr.replaceAll(letter, `(${v ?? 0})`);
        });
        return Function(`"use strict"; return (${expr})`)() ?? 0;
      } catch { return null; }
    }
    case "cc": {
      const codes = ccTagToCodes.get(node.tag);
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
    case "section": {
      const key = `${node.statement}::${node.section}`;
      const codes = sectionCodes.get(key);
      if (!codes) return 0;
      return -pivotSum(pivot, codes);
    }
case "account": {
      let t = 0;
      // Node may carry {accountCode, dimGroup, dimCode} for scoped variations.
      // Also handle legacy "accountCode:::dimGroup:::dimCode" packed into accountCode.
      let ac = node.accountCode ?? "";
      let dg = node.dimGroup, dc = node.dimCode;
      if (typeof ac === "string" && ac.includes(":::") && !dg && !dc) {
        const [a, g, c] = ac.split(":::"); ac = a; dg = g || undefined; dc = c || undefined;
      }
      if (dg && dc) {
        const key = `${ac}:::${dg}:::${dc}`;
        t = pivot.__dimPivot?.get(key) ?? 0;
      } else {
        pivot.forEach((v, k) => { if (k === ac) t += v; });
      }
      return -t;
    }
case "accountGroup": {
      let t = 0;
      let code = String(node.prefix ?? "");
      let dg = node.dimGroup, dc = node.dimCode;
      if (code.includes(":::") && !dg && !dc) {
        const [a, g, c] = code.split(":::"); code = a; dg = g || undefined; dc = c || undefined;
      }
if (!code) return 0;
if (dg && dc) {
        // Mirror the no-dimension branch below: prefer the sum account's OWN
        // dimension row (post-eliminations, no double count). Only if the sum
        // has no direct dim row do we sum its descendant leaves' dim rows.
        // Without this, a sum whose own row carries the dimension AND whose
        // children also carry it gets counted twice (e.g. Pasivos E: direct
        // -510707 but direct+children -1021414 = exactly 2x).
        const directKey = `${code}:::${dg}:::${dc}`;
        if (pivot.__dimPivot?.has(directKey)) {
          t = pivot.__dimPivot.get(directKey);
        } else {
          const descendants = pivot.__descendants?.get(code);
          const bases = new Set(descendants ?? []);
          if (bases.size === 0) bases.add(code);
          pivot.__dimPivot?.forEach((v, key) => {
            const [ac, grp, cd] = key.split(":::");
            if (grp === dg && cd === dc && bases.has(ac)) t += v;
          });
        }
        return -t;
      }
      // Prefer the direct row for sum accounts (post-eliminations, matches Sabana).
      // Fall back to summing descendants only if the sum account has no direct row.
      if (pivot.has(code)) {
        t = pivot.get(code);
      } else {
        const descendants = pivot.__descendants?.get(code);
        if (descendants && descendants.length > 0) {
          descendants.forEach(d => { if (pivot.has(d)) t += pivot.get(d); });
        }
      }
      if (t === 0 && !pivot.__descendants?.has(code)) {
        pivot.forEach((v, ac) => { if (ac.startsWith(code)) t += v; });
      }
      return -t;
    }
case "party": {
      // Statistical party (partida estadística). Consolidated scope: a
      // sharedAcrossCompanies party is a group-wide metric (counted once);
      // a per-company party sums its per-company values across every company
      // in ctx.companies. On a subsidiary column ctx.companies is [that co].
      if (!pivot.__parties || !pivot.__partyContext) return 0;
      const party = pivot.__parties.get(node.partyId);
      if (!party) return 0;
      const ctx = pivot.__partyContext;
      const companies = (ctx.companies && ctx.companies.length)
        ? ctx.companies
        : (ctx.company ? [ctx.company] : []);
      const dims = party.dims || [];
      const sumTree = (yearTree, cacheScope) => {
        const yearMap = yearTree?.[String(ctx.year)];
        if (!yearMap) return 0;
        const cacheKey = `party:${node.partyId}:${cacheScope}:${ctx.year}`;
        let computed = cache.get(cacheKey);
        if (!computed) {
          computed = evaluatePartyYear(yearMap, dims);
          cache.set(cacheKey, computed);
        }
        const dimList = (ctx.selectedDims && ctx.selectedDims.size > 0)
          ? dims.filter(d => ctx.selectedDims.has(d))
          : dims;
        const dimsToSum = node.dimCode ? [node.dimCode] : dimList;
        let t = 0;
        for (const dim of dimsToSum) {
          const v = computed[dim]?.[ctx.month];
          if (typeof v === "number") t += v;
        }
        return t;
      };
      if (party.sharedAcrossCompanies !== false) return sumTree(party.values ?? {}, "_shared");
      let total = 0;
      for (const co of companies) {
        if (party.companies?.length && !party.companies.includes(co)) continue;
        total += sumTree(party.values?.[co] ?? {}, co);
      }
      return total;
    }
    default: return 0;
  }
}

function computeConsolidated(visibleKpis, pivot, ccTagToCodes, sectionCodes, allKpis) {
  const refList = allKpis ?? visibleKpis;
  const cache = new Map();
  visibleKpis.forEach(kpi => {
    if (!cache.has(kpi.id)) {
      // Inject the current KPI's variations so the "text" case can pick per-scope overrides.
pivot.__currentKpiVariations = kpi.variations ?? null;
      const val = evalConsolidated(kpi.formula, pivot, cache, refList, ccTagToCodes, sectionCodes);
      cache.set(kpi.id, val);
    }
  });
  pivot.__currentKpiVariations = null;
  return cache;
}

/* ── Utilidades (copiado de KpiIndividualesPage.jsx) ── */

function fmtValue(val, format) {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return "—";
  if (format === "percent") return val.toFixed(1) + "%";
  // Accounting style: negatives shown in parentheses, not with a minus sign.
  const paren = (s, neg) => neg ? `(${s})` : s;
  if (format === "currency") {
    const neg = val < 0;
    const s = Math.abs(val).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return paren(s, neg);
  }
  const neg = val < 0;
  return paren(Math.abs(val).toFixed(2), neg);
}

function parseDimensions(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("||").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
  }).filter(Boolean);
}

function parseAmt(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (!s || s === "—" || s === "-") return 0;
  if (/\d\.\d{3},\d/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (/,/.test(s) && /\./.test(s) && s.indexOf(",") < s.indexOf(".")) return parseFloat(s.replace(/,/g, "")) || 0;
  if (/,/.test(s) && !/\./.test(s)) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}
/* ══════════════════════════════════════════════════════════════════════
   A partir de aquí: código propio de Presentaciones.
   ══════════════════════════════════════════════════════════════════════ */

export const formatKpiValue = fmtValue;

async function apiGet(token, path) {
  return (await apiGetStrict(token, path)) ?? [];
}

// Igual que apiGet, pero con reintentos ante 429 / errores temporales y
// devolviendo null si al final falla (para no guardar un "vacío" que no es
// real y poder volver a pedirlo).
async function apiGetStrict(token, path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (res.ok) {
        const json = await res.json();
        return json.value ?? (Array.isArray(json) ? json : []);
      }
      if (![429, 500, 502, 503, 504].includes(res.status)) return null;
      const ra = Number(res.headers.get("Retry-After"));
      await new Promise(r => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 600 * (attempt + 1)));
    } catch {
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return null;
}

const prevMonthOf = (y, m) => (Number(m) === 1 ? { y: Number(y) - 1, m: 12 } : { y: Number(y), m: Number(m) - 1 });

function fetchRows(token, scope, entity, p, y, m) {
  const base = `Year eq ${y} and Month eq ${m} and Source eq '${p.source}' and GroupStructure eq '${p.structure}'`;
  if (scope === "consolidated") {
    const f = `${base} and GroupShortName eq '${entity}'`;
    return apiGetStrict(token, `/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(f)}`);
  }
  if (scope === "journals") {
    // Asientos de una sociedad (para el desglose del contributivo)
    const f = `${base} and CompanyShortName eq '${entity}'`;
    return apiGetStrict(token, `/v2/journal-entries?$filter=${encodeURIComponent(f)}`);
  }
  const f = `${base} and CompanyShortName eq '${entity}'`;
  return apiGetStrict(token, `/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(f)}`);
}

/* ══════════════════════════════════════════════════════════════════════
   Contributivo de una sociedad (como la página de Contribución): por cuenta,
   en su moneda local,
     · Uploaded → su carga (uploaded-accounts, Origin = Upload)
     · AJE, RJE, EJE, SYS, CFA → sus asientos contabilizados (journal-entries)
     · total = Uploaded + asientos
   Se suman las cuentas de detalle subiendo por la cuenta suma del plan de
   cuentas. En mensual, PyG y DIS restan el mes anterior.
   ══════════════════════════════════════════════════════════════════════ */
export const CONTRIB_PARTS = ["Uploaded", "AJE", "RJE", "EJE", "SYS", "CFA"];
function makeContribResolver({ base, rowsByKey, defaultPeriod }) {
  const parentOf = new Map();
  (base.childrenOf ?? new Map()).forEach((kids, parent) => kids.forEach(k => { if (k !== parent) parentOf.set(k, parent); }));
  const isSum = (code) => !!base.accountsByCode?.get(code)?.isSum;
  const cache = new Map();
  const isPosted = (r) => {
    const v = r.Posted ?? r.posted;
    return v === true || v === "true" || v === "True" || v === 1;
  };
  const build = (co, key) => {
    const ck = `${co}|${key}`; // por sociedad y periodo
    if (cache.has(ck)) return cache.get(ck);
    const ups = rowsByKey.get(`individual|${co}|${key}`);
    const jrs = rowsByKey.get(`journals|${co}|${key}`);
    if (!ups || !jrs) return null;
    const out = new Map(); // code → { part → importe }
    const add = (code, part, amt) => {
      let c = code;
      const seen = new Set();
      while (c && !seen.has(c)) {
        seen.add(c);
        if (!out.has(c)) out.set(c, {});
        const o = out.get(c);
        o[part] = (o[part] ?? 0) + amt;
        c = parentOf.get(c);
      }
    };
    ups.forEach(r => {
      const code = String(r.AccountCode ?? r.accountCode ?? "");
      if (!code || isSum(code) || (r.Origin ?? r.origin) !== "Upload") return;
      add(code, "Uploaded", parseAmt(r.AmountYTD ?? r.amountYTD ?? 0));
    });
    jrs.forEach(r => {
      const code = String(r.AccountCode ?? r.accountCode ?? "");
      const jt = String(r.JournalType ?? r.journalType ?? "").toUpperCase();
      if (!code || isSum(code) || !CONTRIB_PARTS.includes(jt) || !isPosted(r)) return;
      add(code, jt, parseAmt(r.AmountYTD ?? r.amountYTD ?? 0));
    });
    cache.set(ck, out);
    return out;
  };
  return (content, periodArg) => {
    const co = content?.entity;
    const code = String(content?.accountCode ?? "");
    if (!co || !code) return { status: "empty" };
    if (!base.ready) return { status: "loading" };
    const acc = base.accountsByCode.get(code);
    if (!acc) return { status: "missing" };
    const p = periodArg ?? defaultPeriod;
    const mode = p.mode ?? defaultPeriod.mode;
    const key = `${p.source}|${p.structure}|${p.year}|${p.month}`;
    const cur = build(co, key);
    if (!cur) return { status: "loading", account: acc };
    const parts = { ...(cur.get(code) ?? {}) };
    const flow = acc.type === "P/L" || acc.type === "DIS";
    if (mode === "monthly" && flow && Number(p.month) !== 1) {
      const pm = prevMonthOf(p.year, p.month);
      const prv = build(co, `${p.source}|${p.structure}|${pm.y}|${pm.m}`);
      if (!prv) return { status: "loading", account: acc };
      const pp = prv.get(code) ?? {};
      Object.keys(pp).forEach(k => { parts[k] = (parts[k] ?? 0) - pp[k]; });
    }
    const total = CONTRIB_PARTS.reduce((sum, k) => sum + (parts[k] ?? 0), 0);
    const part = content.part ?? "total";
    return { status: "ok", account: acc, value: part === "total" ? total : (parts[part] ?? 0), parts, total };
  };
}

/* ── Pivot individual: misma lógica que companyPivots en KpiIndividualesPage,
      sin filtros de dimensión (la presentación usa la empresa completa). ── */
function buildIndividualPivot({ rows, prevRows, mode, year, month, company, sumAccountCodes, groupDescendants, partiesById, selDims = null }) {
  // selDims: null = sin filtro; array de códigos = solo filas con esa dimensión
  // (el balance ignora el filtro, como en la página de KPIs).
  const buildDimPivotFromRaw = (rs) => {
    const dimPivot = new Map();
    rs.forEach(r => {
      const ac = r.AccountCode ?? r.accountCode ?? "";
      if (!ac) return;
      const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
      if (!dimsRaw || dimsRaw === "—") return;
      const pairs = parseDimensions(dimsRaw);
      if (Array.isArray(selDims)) {
        if (selDims.length === 0) return;
        const rowDimCodes = new Set(pairs.map(([, code]) => code));
        if (!selDims.some(d => rowDimCodes.has(d))) return;
      }
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      pairs.forEach(([dGroup, dCode]) => {
        if (!dGroup || !dCode) return;
        const key = `${ac}:::${dGroup}:::${dCode}`;
        dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
      });
    });
    return dimPivot;
  };

  const buildPivot = (rs) => {
    const p = new Map();
    const localPivot = new Map();
    const localDimPivot = new Map();
    const bsCodes = new Set();
    const bsLocalCodes = new Set();
    rs.forEach(r => {
      const ac = r.AccountCode ?? r.accountCode ?? "";
      const lac = String(r.LocalAccountCode ?? r.localAccountCode ?? "").trim();
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (sumAccountCodes.has(ac)) return;
      if (acType && acType !== "P/L" && acType !== "B/S") return;
      if (acType === "B/S") bsCodes.add(ac);
      const dimPairs = parseDimensions(r.Dimensions ?? r.dimensions ?? "");
      if (acType !== "B/S" && Array.isArray(selDims)) {
        if (selDims.length === 0) return;
        const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
        if (!selDims.some(d => rowDimCodes.has(d))) return;
      }
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      p.set(ac, (p.get(ac) ?? 0) + amt);
      if (lac && lac !== "—") {
        localPivot.set(lac, (localPivot.get(lac) ?? 0) + amt);
        if (acType === "B/S") bsLocalCodes.add(lac);
      }
      dimPairs.forEach(([dGroup, dCode]) => {
        if (!dGroup || !dCode || !lac || lac === "—") return;
        const lkey = `${lac}:::${dGroup}:::${dCode}`;
        localDimPivot.set(lkey, (localDimPivot.get(lkey) ?? 0) + amt);
      });
    });
    p.__localPivot = localPivot;
    p.__localDimPivot = localDimPivot;
    p.__bsCodes = bsCodes;
    p.__bsLocalCodes = bsLocalCodes;
    return p;
  };

  const ctx = { company, year: parseInt(year), month: parseInt(month), selectedDims: Array.isArray(selDims) && selDims.length ? new Set(selDims) : null };
  const finish = (pv) => {
    pv.__groupDescendants = groupDescendants;
    pv.__parties = partiesById;
    pv.__partyContext = ctx;
    pv.__variationScope = { kind: "company", key: company };
    return pv;
  };

  const curr = buildPivot(rows);
  curr.__dimPivot = buildDimPivotFromRaw(rows);
  if (mode === "ytd") return finish(curr);

  if (rows.length === 0) {
    const e = new Map();
    e.__dimPivot = new Map();
    e.__localPivot = new Map();
    e.__bsCodes = curr.__bsCodes;
    e.__bsLocalCodes = curr.__bsLocalCodes;
    return finish(e);
  }

  const isJanuary = parseInt(month) === 1;
  const prev = buildPivot(prevRows);
  const bs = curr.__bsCodes;
  const monthly = new Map();
  new Set([...curr.keys(), ...prev.keys()]).forEach(ac => {
    const c = curr.get(ac) ?? 0;
    const p = isJanuary ? 0 : (prev.get(ac) ?? 0);
    monthly.set(ac, bs.has(ac) ? c : c - p);
  });
  const currDim = curr.__dimPivot;
  const prevDim = buildDimPivotFromRaw(prevRows);
  const monthlyDim = new Map();
  new Set([...currDim.keys(), ...prevDim.keys()]).forEach(key => {
    const acPart = key.split(":::")[0];
    const c = currDim.get(key) ?? 0;
    const p = isJanuary ? 0 : (prevDim.get(key) ?? 0);
    monthlyDim.set(key, bs.has(acPart) ? c : c - p);
  });
  monthly.__dimPivot = monthlyDim;
  const bsLocal = curr.__bsLocalCodes;
  const monthlyLocal = new Map();
  new Set([...curr.__localPivot.keys(), ...prev.__localPivot.keys()]).forEach(lc => {
    const c = curr.__localPivot.get(lc) ?? 0;
    const p = isJanuary ? 0 : (prev.__localPivot.get(lc) ?? 0);
    monthlyLocal.set(lc, bsLocal.has(lc) ? c : c - p);
  });
  monthly.__localPivot = monthlyLocal;
  monthly.__bsCodes = bs;
  monthly.__bsLocalCodes = bsLocal;
  return finish(monthly);
}

/* ── Pivot consolidado: misma lógica que buildPivots en ConsolidatedKpiPage
      (columna "consolidado": filas Group sin origen ni contraparte). ── */
function buildConsolidatedPivot({ rows, prevRows, mode, year, month, companies, descendants, partiesById, selDims = null }) {
  const hasDimFilter = Array.isArray(selDims) && selDims.length > 0;
  const isJanuary = parseInt(month) === 1;
  const buildRaw = (rs) => {
    const p = new Map();
    const dimP = new Map();
    const bsCodes = new Set();
    rs.forEach(r => {
      const ac = r.AccountCode ?? r.accountCode ?? "";
      const acType = r.AccountType ?? r.accountType ?? "";
      if (!ac) return;
      if (acType && acType !== "P/L" && acType !== "B/S") return;
      const rowPairs = parseDimensions(r.Dimensions ?? "");
      if (hasDimFilter) {
        if (rowPairs.length === 0) return;
        if (!rowPairs.some(([, code]) => selDims.includes(code))) return;
      }
      const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      p.set(ac, (p.get(ac) ?? 0) + amt);
      if (acType === "B/S") bsCodes.add(ac);
      rowPairs.forEach(([grp, code]) => {
        const k = `${ac}:::${grp}:::${code}`;
        dimP.set(k, (dimP.get(k) ?? 0) + amt);
      });
    });
    p.__dimPivot = dimP;
    p.__bsCodes = bsCodes;
    return p;
  };
  const toMonthly = (curr, prev) => {
    const mp = new Map();
    const bs = curr.__bsCodes ?? new Set();
    const currHasData = curr.size > 0;
    new Set([...curr.keys(), ...prev.keys()]).forEach(ac => {
      mp.set(ac, bs.has(ac) ? (curr.get(ac) ?? 0) : (curr.get(ac) ?? 0) - ((isJanuary || !currHasData) ? 0 : (prev.get(ac) ?? 0)));
    });
    const currDim = curr.__dimPivot ?? new Map();
    const prevDim = prev.__dimPivot ?? new Map();
    const mpDim = new Map();
    new Set([...currDim.keys(), ...prevDim.keys()]).forEach(k => {
      const acPart = k.split(":::")[0];
      mpDim.set(k, bs.has(acPart) ? (currDim.get(k) ?? 0) : (currDim.get(k) ?? 0) - ((isJanuary || !currHasData) ? 0 : (prevDim.get(k) ?? 0)));
    });
    mp.__dimPivot = mpDim;
    mp.__bsCodes = bs;
    return mp;
  };
  const isGroupPure = r => (r.CompanyRole ?? r.companyRole ?? "") === "Group" && !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim();
  const ytd = buildRaw(rows.filter(isGroupPure));
  const pivot = mode === "ytd" ? ytd : toMonthly(ytd, buildRaw(prevRows.filter(isGroupPure)));
  pivot.__parties = partiesById;
  pivot.__partyContext = { companies, year: parseInt(year) || null, month: parseInt(month) || null, selectedDims: hasDimFilter ? new Set(selDims) : null };
  pivot.__descendants = descendants;
  pivot.__variationScope = { kind: "consolidated", key: "__consolidated__" };
  return pivot;
}

/* ── Catálogo: biblioteca (con overrides de sistema del usuario) + KPIs
      personalizados de la empresa, como en las páginas de KPIs. ── */
function buildCatalog(library, companyRows, userId) {
  const overrides = new Map();
  const customs = [];
  (companyRows ?? []).forEach(k => {
    if (k.kpi_type === "system_override") {
      if (k.source_system_kpi_id && k.created_by === userId && !String(k.tag ?? "").includes(":dim")) {
        overrides.set(k.source_system_kpi_id, k);
      }
      return;
    }
    customs.push({
      id: k.kpi_id, label: k.label, description: k.description ?? "", category: k.category ?? "", tag: k.tag ?? "",
      format: k.format ?? "currency", formula: k.formula, benchmark: k.benchmark ?? null,
      variations: k.variations ?? null, custom: true,
    });
  });
  const system = (library ?? []).map(k => {
    const o = overrides.get(k.id);
    return o ? { ...k, formula: o.formula ?? k.formula, format: o.format ?? k.format, variations: o.variations ?? null } : k;
  });
  return [...system, ...customs];
}

const periodKeyOf = (p) => `${p.source}|${p.structure}|${p.year}|${p.month}`;

/* Periodo de comparación de un KPI a partir del periodo de la presentación.
   Los presets siguen al periodo (si cambias el mes, el comparativo también);
   en "custom" cada campo vacío hereda el de la presentación. */
export function resolveComparePeriod(period, compare) {
  if (!compare?.preset || compare.preset === "none") return null;
  const basePeriod = { ...period, year: String(period.year), month: String(period.month) };
  if (compare.preset === "prev_year") return { ...basePeriod, year: String(Number(period.year) - 1) };
  if (compare.preset === "prev_month") {
    const pm = prevMonthOf(period.year, period.month);
    return { ...basePeriod, year: String(pm.y), month: String(pm.m) };
  }
  return {
    ...basePeriod,
    source:    compare.source    || basePeriod.source,
    structure: compare.structure || basePeriod.structure,
    year:      String(compare.year  || basePeriod.year),
    month:     String(compare.month || basePeriod.month),
  };
}

/* Periodo efectivo de un KPI: sus filtros propios y, lo que deje vacío, los
   de la presentación. dims: null = todas las dimensiones. */
export function slotPeriod(period, content) {
  const f = content?.filters ?? {};
  return {
    source:    f.source    || period.source,
    structure: f.structure || period.structure,
    year:      String(f.year  || period.year),
    month:     String(f.month || period.month),
    mode:      f.mode      || period.mode,
    dims:      Array.isArray(f.dims) && f.dims.length ? f.dims : null,
  };
}

/* Campos en los que un KPI NO sigue los filtros generales del header: sus
   filtros propios de fuente, perímetro, año, mes o modo, y un comparativo
   personalizado con año o mes fijos. Las dimensiones no cuentan, porque el
   header no tiene filtro de dimensiones. */
export function slotFixedFields(content) {
  if (content?.kind === "accounts" || content?.kind === "sheet" || content?.kind === "contrib") {
    const f = content.filters ?? {};
    return ["source", "structure", "year", "month", "mode"].filter(k => f[k]);
  }
  if (content?.kind === "chart") {
    const out = new Set();
    const addFilters = (f) => ["source", "structure", "mode"].forEach(k => { if (f?.[k]) out.add(k); });
    if (content.mode === "shared") addFilters(content.shared?.filters);
    else (content.series ?? []).forEach(sr => addFilters(sr.filters));
    if (content.range?.type === "fixed") out.add("range");
    return [...out];
  }
  if (content?.kind !== "kpi") return [];
  const f = content.filters ?? {};
  const out = ["source", "structure", "year", "month", "mode"].filter(k => f[k]);
  const c = content.compare;
  if (c?.preset === "custom" && (c.year || c.month)) out.push("compare");
  return out;
}

/* Meses de una gráfica: "relative" = los últimos N meses hasta el periodo
   (sigue a la presentación); "fixed" = de un mes a otro. Máximo 36. */
export function chartMonths(range, endPeriod) {
  const out = [];
  if (range?.type === "fixed" && range.fromYear && range.fromMonth && range.toYear && range.toMonth) {
    let y = Number(range.fromYear), m = Number(range.fromMonth);
    const ty = Number(range.toYear), tm = Number(range.toMonth);
    while ((y < ty || (y === ty && m <= tm)) && out.length < 36) {
      out.push({ year: String(y), month: String(m) });
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }
  const n = Math.min(36, Math.max(2, Number(range?.months) || 12));
  let y = Number(endPeriod.year), m = Number(endPeriod.month);
  for (let i = 0; i < n; i++) {
    out.unshift({ year: String(y), month: String(m) });
    m -= 1; if (m < 1) { m = 12; y -= 1; }
  }
  return out;
}

/* Variación entre el valor actual y el comparativo. Para KPIs en % la
   diferencia se da en puntos; para el resto, en valor y en %. */
export function kpiDelta(current, compare, format) {
  if (current == null || compare == null || !isFinite(current) || !isFinite(compare)) return null;
  // Diferencias de redondeo (p. ej. 40% frente a 40%) cuentan como cero.
  const raw = current - compare;
  const diff = Math.abs(raw) < 1e-9 * Math.max(1, Math.abs(compare)) ? 0 : raw;
  if (format === "percent") return { diff, pct: null, points: true };
  return { diff, pct: compare !== 0 ? (diff / Math.abs(compare)) * 100 : null, points: false };
}

/* Crea la función que resuelve el valor de un KPI para una empresa o grupo y
   un periodo (por defecto, el de la presentación). Tiene su propia caché de
   pivots y valores, que vive mientras no cambien los datos. */
function makeResolver({ base, rowsByKey, defaultPeriod, holdings }) {
  const pivots = new Map();
  const values = new Map();
  return (content, periodArg) => {
    if (!content?.kpiId || !content?.scope || !content?.entity) return { status: "empty" };
    if (!base.ready) return { status: "loading" };
    const catalog = base.catalogs[content.scope] ?? [];
    const kpi = catalog.find(k => k.id === content.kpiId);
    if (!kpi) return { status: "missing" };
    const p = periodArg ?? defaultPeriod;
    const mode = p.mode ?? defaultPeriod.mode;
    const selDims = Array.isArray(p.dims) && p.dims.length ? p.dims : null;
    const dataKey = `${content.scope}|${content.entity}|${periodKeyOf(p)}`;
    const curr = rowsByKey.get(dataKey);
    let prev = [];
    if (mode === "monthly" && Number(p.month) !== 1) {
      const pm = prevMonthOf(p.year, p.month);
      prev = rowsByKey.get(`${content.scope}|${content.entity}|${p.source}|${p.structure}|${pm.y}|${pm.m}`);
    }
    if (!curr || !prev) return { status: "loading", kpi };
    const data = { curr, prev };
    const pKey = `${dataKey}|${mode}|${selDims ? selDims.join(",") : "*"}`;
    const vKey = `${pKey}|${kpi.id}`;
    if (values.has(vKey)) return values.get(vKey);
    let pivot = pivots.get(pKey);
    if (!pivot) {
      pivot = content.scope === "consolidated"
        ? buildConsolidatedPivot({
            rows: data.curr, prevRows: data.prev, mode, year: p.year, month: p.month,
            companies: holdings.membersOf(content.entity), descendants: base.descendants, partiesById: base.partiesById, selDims,
          })
        : buildIndividualPivot({
            rows: data.curr, prevRows: data.prev, mode, year: p.year, month: p.month,
            company: content.entity, sumAccountCodes: base.sumAccountCodes,
            groupDescendants: base.groupDescendants, partiesById: base.partiesById, selDims,
          });
      pivots.set(pKey, pivot);
    }
    const compute = content.scope === "consolidated" ? computeConsolidated : computeIndividual;
    const cache = compute([kpi], pivot, base.ccTagToCodes, base.sectionCodes, catalog);
    const res = { status: data.curr.length ? "ok" : "nodata", kpi, value: cache.get(kpi.id) };
    values.set(vKey, res);
    return res;
  };
}

/* Valor de una cuenta para una empresa (individual) o un grupo (consolidado)
   y un periodo. En ambos casos una cuenta con hijas es la suma de sus hijas
   (se ignoran sus apuntes propios) y una sin hijas, sus apuntes.

   Individual (como IndividualesPage): PyG en negativo del saldo (ingresos
   positivos, gastos negativos) y balance con su saldo.

   Consolidado (como ConsolidationSheetPage): todas las cuentas en negativo
   del saldo, y tres vistas:
     · "consolidated"  → filas Group del grupo (todas, también las que llevan
                          origen/contraparte, como la hoja).
     · "contribution"  → filas Parent (el propio grupo) o Contribution (sus
                          sociedades) de una sociedad.
     · "eliminations"  → consolidado − suma de contribuciones del grupo y sus
                          sociedades directas.

   Mensual: PyG (y DIS en consolidado) = diferencia de acumulados; balance
   siempre acumulado. */
function makeAccountResolver({ base, rowsByKey, defaultPeriod, holdings }) {
  const rollups = new Map();
  const values = new Map();
  const rollupOf = (cacheKey, rows, keep, sign) => {
    if (rollups.has(cacheKey)) return rollups.get(cacheKey);
    const raw = new Map();
    rows.forEach(r => {
      const ac = String(r.AccountCode ?? r.accountCode ?? "");
      if (!ac || !keep(r)) return;
      raw.set(ac, (raw.get(ac) ?? 0) + sign * parseAmt(r.AmountYTD ?? r.amountYTD ?? 0));
    });
    const memo = new Map();
    const val = (code) => {
      if (memo.has(code)) return memo.get(code);
      memo.set(code, 0); // protección ante ciclos
      const kids = base.childrenOf.get(code);
      let v = 0;
      if (kids?.length) kids.forEach(c => { v += val(c); });
      else v = raw.get(code) ?? 0;
      memo.set(code, v);
      return v;
    };
    rollups.set(cacheKey, val);
    return val;
  };

  // Flujo de caja: cada fila va a las líneas de flujo de su cuenta de grupo;
  // una línea suma sus apuntes directos más los de todas sus hijas.
  const cfRollupOf = (cacheKey, rows, keep, signed) => {
    if (rollups.has(cacheKey)) return rollups.get(cacheKey);
    const direct = new Map();
    rows.forEach(r => {
      if (!keep(r)) return;
      const ga = String(r.AccountCode ?? r.accountCode ?? "");
      const cfs = base.groupToCf.get(ga);
      if (!cfs) return;
      const raw = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
      const amt = signed && base.cfInvert?.has(ga) ? -raw : raw;
      cfs.forEach(cf => direct.set(cf, (direct.get(cf) ?? 0) + amt));
    });
    const memo = new Map();
    const val = (code) => {
      if (memo.has(code)) return memo.get(code);
      memo.set(code, 0);
      let v = direct.get(code) ?? 0;
      (base.cfChildren.get(code) ?? []).forEach(c => { v += val(c); });
      memo.set(code, v);
      return v;
    };
    rollups.set(cacheKey, val);
    return val;
  };

  /* Flujo de caja individual (IndividualCashFlowPage): filas de la empresa.
     Consolidado (CashFlowPage): la columna de una sociedad son todas sus filas
     del informe consolidado; el total, la suma de las sociedades del grupo
     (el propio grupo y sus sociedades directas). Sin cambio de signo. En
     mensual, la diferencia de acumulados. */
  const resolveCf = (content, periodArg) => {
    const acc = base.cfAccountsByCode.get(String(content.accountCode));
    if (!acc) return { status: "missing" };
    const consolidated = content.scope === "consolidated";
    const p = periodArg ?? defaultPeriod;
    const mode = p.mode ?? defaultPeriod.mode;
    const selDims = Array.isArray(p.dims) && p.dims.length ? p.dims : null;
    const scopeKey = consolidated ? "consolidated" : "individual";
    const key = `${scopeKey}|${content.entity}|${periodKeyOf(p)}`;
    const curr = rowsByKey.get(key);
    const needPrev = mode === "monthly" && Number(p.month) !== 1;
    let prev = null;
    let prevKey = "";
    if (needPrev) {
      const pm = prevMonthOf(p.year, p.month);
      prevKey = `${scopeKey}|${content.entity}|${p.source}|${p.structure}|${pm.y}|${pm.m}`;
      prev = rowsByKey.get(prevKey);
    }
    if (!curr || (needPrev && !prev)) return { status: "loading", account: acc };
    const view = consolidated ? (content.view === "company" ? "company" : "total") : "individual";
    const company = content.company || content.entity;
    const dimTag = selDims ? selDims.join(",") : "*";
    const vKey = `cf|${key}|${mode}|${dimTag}|${view}|${company}|${acc.code}`;
    if (values.has(vKey)) return values.get(vKey);
    const dimOk = (r) => !selDims || parseDimensions(r.Dimensions ?? r.dimensions ?? "").some(([, c]) => selDims.includes(c));
    const co = (r) => r.CompanyShortName ?? r.companyShortName ?? "";
    const role = (r) => r.CompanyRole ?? r.companyRole ?? "";

    // Consolidado como el Power BI ([Importes CF], EF Consolidados): se leen
    // las filas C/F y CFS que calcula Konsolidator, línea a línea (también los
    // subtotales), con signo ×−1 salvo CF.E1s y CF.F1s.
    //   · total   → filas Group del grupo (el consolidado)
    //   · company → contribución de la sociedad (Contribution; Parent si es
    //               el propio grupo)
    // Comprobado contra el modelo del .pbix: todas las líneas cuadran.
    const consValue = (rows, rk) => {
      const ck = `cfc|${rk}|${view}|${company}|${dimTag}`;
      if (!rollups.has(ck)) {
        const m = new Map();
        rows.forEach(r => {
          const t = r.AccountType ?? r.accountType ?? "";
          if ((t !== "C/F" && t !== "CFS") || !dimOk(r)) return;
          const keep = view === "company"
            ? co(r) === company && (role(r) === "Contribution" || (role(r) === "Parent" && company === content.entity))
            : co(r) === content.entity && role(r) === "Group";
          if (!keep) return;
          const code = String(r.AccountCode ?? r.accountCode ?? "");
          m.set(code, (m.get(code) ?? 0) + parseAmt(r.AmountYTD ?? r.amountYTD ?? 0));
        });
        rollups.set(ck, m);
      }
      const raw = rollups.get(ck).get(acc.code) ?? 0;
      return acc.code === "CF.E1s" || acc.code === "CF.F1s" ? raw : -raw;
    };
    const valueFor = (rows, rk) => (consolidated
      ? consValue(rows, rk)
      : cfRollupOf(`cf|${rk}|ind|${dimTag}|sig`, rows, r => dimOk(r), true)(acc.code));
    let v = valueFor(curr, key);
    if (needPrev) v -= valueFor(prev, prevKey);
    const res = { status: curr.length ? "ok" : "nodata", account: acc, value: v };
    values.set(vKey, res);
    return res;
  };

  return (content, periodArg) => {
    if (!content?.accountCode || !content?.entity) return { status: "empty" };
    if (!base.ready) return { status: "loading" };
    if (content.statement === "cf") return resolveCf(content, periodArg);
    const acc = base.accountsByCode.get(String(content.accountCode));
    if (!acc) return { status: "missing" };
    const consolidated = content.scope === "consolidated";
    const view = consolidated ? (content.view ?? "consolidated") : "individual";
    const p = periodArg ?? defaultPeriod;
    const mode = p.mode ?? defaultPeriod.mode;
    const selDims = Array.isArray(p.dims) && p.dims.length ? p.dims : null;
    const scopeKey = consolidated ? "consolidated" : "individual";
    const key = `${scopeKey}|${content.entity}|${periodKeyOf(p)}`;
    const curr = rowsByKey.get(key);
    const deltaTypes = consolidated ? ["P/L", "DIS"] : null;
    const isFlow = consolidated ? deltaTypes.includes(acc.type) : acc.type !== "B/S";
    const needPrev = mode === "monthly" && isFlow && Number(p.month) !== 1;
    let prev = null;
    let prevKey = "";
    if (needPrev) {
      const pm = prevMonthOf(p.year, p.month);
      prevKey = `${scopeKey}|${content.entity}|${p.source}|${p.structure}|${pm.y}|${pm.m}`;
      prev = rowsByKey.get(prevKey);
    }
    if (!curr || (needPrev && !prev)) return { status: "loading", account: acc };

    const company = content.company || content.entity;
    const vKey = `${key}|${mode}|${selDims ? selDims.join(",") : "*"}|${view}|${company}|${acc.code}`;
    if (values.has(vKey)) return values.get(vKey);

    // Filtro de dimensiones: en individual solo afecta a PyG; en consolidado
    // a todas las filas (como la hoja de consolidación).
    const dimOk = (r) => {
      if (!selDims) return true;
      if (!consolidated && (r.AccountType ?? r.accountType) === "B/S") return true;
      const pairs = parseDimensions(r.Dimensions ?? r.dimensions ?? "");
      return pairs.some(([, code]) => selDims.includes(code));
    };
    const dimTag = selDims ? selDims.join(",") : "*";
    const role = (r) => r.CompanyRole ?? r.companyRole ?? "";
    const co = (r) => r.CompanyShortName ?? r.companyShortName ?? "";

    const valueFor = (rows, rk) => {
      if (!consolidated) return rollupOf(`${rk}|ind|${dimTag}`, rows, dimOk, 1)(acc.code);
      const group = content.entity;
      const cons = () => rollupOf(`${rk}|cons|${dimTag}`, rows, r => co(r) === group && role(r) === "Group" && dimOk(r), -1)(acc.code);
      const contrib = (c) => rollupOf(`${rk}|contrib|${c}|${dimTag}`, rows,
        r => co(r) === c && role(r) === (c === group ? "Parent" : "Contribution") && dimOk(r), -1)(acc.code);
      if (view === "contribution") return contrib(company);
      if (view === "eliminations") return cons() - holdings.membersOf(group).reduce((sum, c) => sum + contrib(c), 0);
      return cons();
    };

    let raw = valueFor(curr, key);
    if (needPrev) raw -= valueFor(prev, prevKey);
    const value = consolidated ? raw : (acc.type !== "B/S" ? -raw : raw);
    const res = { status: curr.length ? "ok" : "nodata", account: acc, value };
    values.set(vKey, res);
    return res;
  };
}

/* ══════════════════════════════════════════════════════════════════════
   Hook principal. Carga una sola vez la base (plan de cuentas, estructura,
   biblioteca y KPIs de empresa) y, bajo demanda, los datos del periodo de
   cada empresa o grupo que usen las diapositivas.
   ══════════════════════════════════════════════════════════════════════ */
export function usePresentationData({ token, standardKey, period, wanted }) {
  const [base, setBase] = useState({ ready: false });
  const [rowsByKey, setRowsByKey] = useState(() => new Map());
  const [extraWanted, setExtraWanted] = useState([]);
  const inflight = useRef(new Set());
  const failures = useRef(new Map()); // clave → intentos fallidos
  const [retryTick, setRetryTick] = useState(0);
  const [baseTick, setBaseTick] = useState(0);

  // Base: se carga una vez por token/estándar.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const [groupAccountsRaw, groupStructure, consolidations, cfMapping] = await Promise.all([
        apiGetStrict(token, "/v2/group-accounts"),
        apiGet(token, "/v2/group-structure"),
        apiGet(token, "/v2/consolidations"),
        apiGet(token, "/v2/mapped-cashflow-accounts"),
      ]);
      if (cancelled) return;
      // Sin plan de cuentas no hay nada que calcular: se reintenta al rato
      // en lugar de quedarse "lista" pero vacía.
      if (groupAccountsRaw == null) {
        setTimeout(() => { if (!cancelled) setBaseTick(t => t + 1); }, 3000);
        return;
      }
      const groupAccounts = groupAccountsRaw;
      // Si algo de lo que sigue falla, la página conserva al menos la
      // estructura del grupo y las consolidaciones (grupos consolidables).
      try {
      let userId = null;
      let companyId = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        userId = session?.user?.id ?? null;
        if (userId) companyId = await getActiveCompanyId(userId);
      } catch { /* sin sesión: solo biblioteca estándar */ }

      const standard = await resolveStandardKey(companyId, groupAccounts, standardKey).catch(() => standardKey ?? null);
      const [mapping, libInd, libCons, rowsInd, rowsCons, partiesRes] = await Promise.all([
        standard ? loadStandardMapping(standard, groupAccounts).catch(() => null) : null,
        standard ? loadKpiLibrary(standard, companyId).catch(() => []) : [],
        standard ? loadKpiLibraryConsolidated(standard).catch(() => []) : [],
        companyId ? listCompanyKpis({ companyId, contextMappingId: "*", scope: "individual" }).catch(() => []) : [],
        companyId ? listCompanyKpis({ companyId, contextMappingId: "*", scope: "consolidated" }).catch(() => []) : [],
        Promise.resolve(supabase.rpc("list_statistical_parties")).catch(() => ({ data: [] })),
      ]);
      if (cancelled) return;

      const sumAccountCodes = new Set();
      groupAccounts.forEach(g => {
        if (g.IsSumAccount === true || g.isSumAccount === true) {
          const code = String(g.AccountCode ?? g.accountCode ?? "");
          if (code) sumAccountCodes.add(code);
        }
      });

      // Descendientes (Set con el propio código) para el motor individual.
      const childrenOf = new Map();
      groupAccounts.forEach(g => {
        const parent = String(g.sumAccountCode ?? g.SumAccountCode ?? "");
        const code = String(g.accountCode ?? g.AccountCode ?? "");
        if (!code || !parent || parent === code) return;
        if (!childrenOf.has(parent)) childrenOf.set(parent, []);
        childrenOf.get(parent).push(code);
      });
      const groupDescendants = new Map();
      const collectSet = (code) => {
        if (groupDescendants.has(code)) return groupDescendants.get(code);
        const out = new Set([code]);
        groupDescendants.set(code, out);
        (childrenOf.get(code) || []).forEach(c => collectSet(c).forEach(d => out.add(d)));
        return out;
      };
      groupAccounts.forEach(g => { const c = String(g.accountCode ?? g.AccountCode ?? ""); if (c) collectSet(c); });

      // Descendientes (array sin el propio código) para el motor consolidado.
      const descendants = new Map();
      const collectArr = (code) => {
        if (descendants.has(code)) return descendants.get(code);
        descendants.set(code, []);
        const direct = childrenOf.get(code) ?? [];
        const all = new Set(direct);
        direct.forEach(ch => collectArr(ch).forEach(x => all.add(x)));
        const arr = [...all];
        descendants.set(code, arr);
        return arr;
      };
      [...childrenOf.keys()].forEach(collectArr);

      const partiesById = new Map();
      (partiesRes?.data ?? []).forEach(r => partiesById.set(r.id, {
        id: r.id, name: r.name, unit: r.unit ?? "",
        companies: r.companies ?? [], years: r.years ?? [],
        dimGroups: r.dim_groups ?? [], dims: r.dims ?? [],
        sharedAcrossCompanies: r.shared_across_companies !== false,
        values: r.values ?? {},
      }));

      // Plan de cuentas del grupo en orden de árbol (como en IndividualesPage):
      // padres antes que hijos, códigos en orden numérico.
      const gaByCode = new Map();
      groupAccounts.forEach(g => {
        const code = String(g.accountCode ?? g.AccountCode ?? "");
        if (code) gaByCode.set(code, g);
      });
      const numSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });
      const accounts = [];
      const visit = (code, depth) => {
        const g = gaByCode.get(code);
        accounts.push({
          code,
          name: String(g.accountName ?? g.AccountName ?? ""),
          type: String(g.accountType ?? g.AccountType ?? ""),
          isSum: !!(g.isSumAccount ?? g.IsSumAccount) || (childrenOf.get(code)?.length ?? 0) > 0,
          depth,
        });
        [...(childrenOf.get(code) ?? [])].sort(numSort).forEach(c => { if (gaByCode.has(c)) visit(c, depth + 1); });
      };
      [...gaByCode.keys()]
        .filter(code => {
          const parent = String(gaByCode.get(code).sumAccountCode ?? gaByCode.get(code).SumAccountCode ?? "");
          return !parent || parent === code || !gaByCode.has(parent);
        })
        .sort(numSort)
        .forEach(code => visit(code, 0));

      // Flujo de caja, igual que la medida [Importe Individual CF] del Power BI
      // "Cockpit" (comprobado al céntimo contra el modelo del .pbix):
      //  · Las líneas de cash flow son las cuentas C/F y CFS del plan de grupo,
      //    con su árbol (SumAccountCode) hasta los totales CF.A5s, CF.D1s…
      //  · Cada fila activa de mapped-cashflow-accounts lleva el importe de su
      //    cuenta de grupo a su línea; una línea suma las de todo su subárbol.
      //  · Signo: ×−1 si la cuenta de grupo es de patrimonio/pasivo
      //    (LadoBalance "L") o de resultados (P/L, DIS).
      const isCfType = (t) => t === "C/F" || t === "CFS";
      const finAccounts = accounts.filter(a => !isCfType(a.type));
      const cfList = accounts.filter(a => isCfType(a.type));
      const cfMinDepth = cfList.length ? Math.min(...cfList.map(a => a.depth)) : 0;
      const cfAccounts = cfList.map(a => ({ ...a, depth: a.depth - cfMinDepth, statement: "cf" }));
      accounts.length = 0;
      finAccounts.forEach(a => accounts.push(a));

      const groupToCf = new Map();
      (Array.isArray(cfMapping) ? cfMapping : []).forEach(m => {
        if (!m || typeof m !== "object") return;
        if ((m.enabled ?? m.Enabled) === false) return;
        const code = String(m.cashFlowAccountCode ?? m.CashFlowAccountCode ?? "");
        const ga = String(m.groupAccountCode ?? m.GroupAccountCode ?? "");
        if (!code || !ga) return;
        if (!groupToCf.has(ga)) groupToCf.set(ga, []);
        groupToCf.get(ga).push(code);
      });

      // Lado del balance como la columna LadoBalance del modelo.
      const parentOfGa = (code) => {
        const g = gaByCode.get(code);
        const pa = String(g?.sumAccountCode ?? g?.SumAccountCode ?? "");
        return pa && pa !== code && gaByCode.has(pa) ? pa : "";
      };
      const pathHas = (code, target) => {
        let c = code;
        const seen = new Set();
        while (c && !seen.has(c)) { if (c === target) return true; seen.add(c); c = parentOfGa(c); }
        return false;
      };
      const cfInvert = new Set();
      gaByCode.forEach((g, code) => {
        const type = String(g.accountType ?? g.AccountType ?? "");
        if (type === "P/L" || type === "DIS") { cfInvert.add(code); return; }
        if (type !== "B/S") return;
        const bst = String(g.balanceSheetType ?? g.BalanceSheetType ?? "");
        const lado = bst === "A" || bst === "L" ? bst : pathHas(code, "G.PYC") ? "L" : pathHas(code, "C.ACT") ? "A" : "";
        if (lado === "L") cfInvert.add(code);
      });

      setBase({
        ready: true,
        childrenOf,
        cfAccounts,
        cfAccountsByCode: new Map(cfAccounts.map(a => [a.code, a])),
        cfChildren: childrenOf,
        cfInvert,
        groupToCf,
        accounts,
        accountsByCode: new Map(accounts.map(a => [a.code, a])),
        standard,
        groupStructure,
        consolidations,
        sumAccountCodes,
        groupDescendants,
        descendants,
        partiesById,
        ccTagToCodes: mapping?.ccTagToCodes ?? new Map(),
        sectionCodes: mapping?.sectionCodes ?? new Map(),
        catalogs: {
          individual: buildCatalog(libInd, rowsInd, userId),
          consolidated: buildCatalog(libCons, rowsCons, userId),
        },
      });
      } catch (err) {
        console.error("Presentaciones: error cargando datos base", err);
        if (cancelled) return;
        setBase({
          ready: true, groupStructure, consolidations,
          childrenOf: new Map(), accounts: [], accountsByCode: new Map(),
          cfAccounts: [], cfAccountsByCode: new Map(), cfChildren: new Map(), groupToCf: new Map(),
          sumAccountCodes: new Set(), groupDescendants: new Map(), descendants: new Map(), partiesById: new Map(),
          ccTagToCodes: new Map(), sectionCodes: new Map(), catalogs: { individual: [], consolidated: [] },
        });
      }
    })();
    return () => { cancelled = true; };
  }, [token, standardKey, baseTick]);

  // Grupos consolidables y sus sociedades. Misma idea que la hoja de
  // consolidación (raíz + sociedades con hijas, cruzado con las consolidaciones
  // que existen para el periodo), pero tolerante con los datos:
  //  · si ninguna fila coincide con el perímetro, se usan todas;
  //  · "tiene hijas" también se deduce de que alguien la tenga como padre;
  //  · si el cruce con las consolidaciones deja la lista vacía, se usan las
  //    consolidaciones del periodo (y, si tampoco hay, los candidatos).
  const holdings = useMemo(() => {
    const all = (base.groupStructure ?? []).map(g => ({
      company:   String(g.companyShortName ?? g.CompanyShortName ?? ""),
      parent:    String(g.parentShortName  ?? g.ParentShortName  ?? ""),
      structure: String(g.groupStructure   ?? g.GroupStructure   ?? ""),
      hasChild:  g.hasChild === true || g.HasChild === true || g.hasChild === "true" || g.HasChild === "true",
      detached:  g.detached === true || g.Detached === true,
    })).filter(g => g.company && !g.detached);
    const inStructure = all.filter(g => !g.structure || g.structure === period.structure);
    const rows = inStructure.length ? inStructure : all;
    const known = new Set(rows.map(g => g.company));
    const parents = new Set(rows.map(g => g.parent).filter(pa => pa && known.has(pa)));
    const root = rows.find(g => !g.parent || g.parent === g.company || !known.has(g.parent))?.company || "";
    const candidates = [...new Set(rows.filter(g => g.hasChild || parents.has(g.company) || g.company === root).map(g => g.company))];

    const consolidated = [...new Set((base.consolidations ?? [])
      .filter(c =>
        String(c.Year ?? c.year) === String(period.year) &&
        String(c.Month ?? c.month) === String(period.month) &&
        (c.Source ?? c.source) === period.source &&
        (c.GroupStructure ?? c.groupStructure) === period.structure)
      .map(c => String(c.GroupShortName ?? c.groupShortName ?? ""))
      .filter(Boolean))];

    let list = consolidated.length ? candidates.filter(c => consolidated.includes(c)) : candidates;
    if (!list.length) list = consolidated.length ? consolidated : candidates;
    // Último recurso: grupos que tengan alguna consolidación (de cualquier
    // periodo) y, si tampoco, las sociedades de la estructura.
    if (!list.length) {
      list = [...new Set((base.consolidations ?? []).map(c => String(c.GroupShortName ?? c.groupShortName ?? "")).filter(Boolean))];
    }
    if (!list.length) list = [...known];
    const membersOf = (grp) => [grp, ...rows.filter(g => g.parent === grp && g.company !== grp).map(g => g.company)];
    return { list, root: list.includes(root) ? root : (list[0] ?? root), membersOf };
  }, [base.groupStructure, base.consolidations, period.structure, period.year, period.month, period.source]);

  // Cada petición es empresa/grupo + periodo (+ modo); si no trae periodo usa
  // el de la presentación. Se descompone en meses sueltos: el mes pedido y,
  // solo en modo mensual, también el anterior. Cada mes se pide una vez y lo
  // comparten KPIs, comparativos y gráficas.
  const { source, structure, year, month, mode } = period;
  const monthKeys = useMemo(() => {
    const out = new Map();
    [...(wanted ?? []), ...extraWanted].forEach(w => {
      if (!w?.scope || !w?.entity) return;
      const p = {
        source: w.source ?? source, structure: w.structure ?? structure,
        year: String(w.year ?? year), month: String(w.month ?? month),
      };
      if (!p.source || !p.structure || !p.year || !p.month) return;
      out.set(`${w.scope}|${w.entity}|${periodKeyOf(p)}`, { scope: w.scope, entity: w.entity, p });
      if ((w.mode ?? mode) === "monthly" && Number(p.month) !== 1) {
        const pm = prevMonthOf(p.year, p.month);
        const pp = { ...p, year: String(pm.y), month: String(pm.m) };
        out.set(`${w.scope}|${w.entity}|${periodKeyOf(pp)}`, { scope: w.scope, entity: w.entity, p: pp });
      }
    });
    return [...out.entries()];
  }, [wanted, extraWanted, source, structure, year, month, mode]);

  // Pide los meses que faltan, nunca dos veces a la vez (inflight), aunque la
  // página se re-renderice mientras cargan.
  useEffect(() => {
    if (!token) return;
    monthKeys.forEach(([key, w]) => {
      if (rowsByKey.has(key) || inflight.current.has(key)) return;
      inflight.current.add(key);
      fetchRows(token, w.scope, w.entity, w.p, w.p.year, w.p.month).then(rows => {
        inflight.current.delete(key);
        if (rows == null) {
          // Falló (sesión caducada, límite de peticiones…): se reintenta en unos segundos.
          const n = (failures.current.get(key) ?? 0) + 1;
          failures.current.set(key, n);
          if (n <= 5) setTimeout(() => setRetryTick(t => t + 1), 2500 * n);
          return;
        }
        failures.current.delete(key);
        setRowsByKey(prevMap => {
          const next = new Map(prevMap);
          next.set(key, rows);
          return next;
        });
      });
    });
  }, [token, monthKeys, rowsByKey, retryTick]);

  const resolveKpi = useMemo(
    () => makeResolver({ base, rowsByKey, defaultPeriod: { source, structure, year: String(year), month: String(month), mode }, holdings }),
    [base, rowsByKey, source, structure, year, month, mode, holdings],
  );

  const resolveAccount = useMemo(
    () => makeAccountResolver({ base, rowsByKey, defaultPeriod: { source, structure, year: String(year), month: String(month), mode }, holdings }),
    [base, rowsByKey, source, structure, year, month, mode, holdings],
  );

  const resolveContrib = useMemo(
    () => makeContribResolver({ base, rowsByKey, defaultPeriod: { source, structure, year: String(year), month: String(month), mode } }),
    [base, rowsByKey, source, structure, year, month, mode],
  );

  // Pedir datos aunque todavía no estén en ninguna diapositiva (lo usan los
  // selectores para enseñar valores y gráficas en vivo). Acepta uno o varios.
  const ensure = useCallback((scope, entity, p = null) => {
    const items = Array.isArray(scope) ? scope : [{ scope, entity, ...(p ?? {}) }];
    const keyOf = (w) => [w.scope, w.entity, w.source, w.structure, w.year, w.month, w.mode].join("|");
    setExtraWanted(prev => {
      const have = new Set(prev.map(keyOf));
      const add = items.filter(w => w?.scope && w?.entity && !have.has(keyOf(w)));
      return add.length ? [...prev, ...add] : prev;
    });
  }, []);

  // Último periodo con consolidación hecha para un grupo (según
  // /v2/consolidations), en o antes del periodo dado. Sirve para avisar cuando
  // el mes del header aún no está consolidado.
  const latestConsolidated = useCallback((group, p) => {
    const lim = Number(p.year) * 100 + Number(p.month);
    let best = null;
    (base.consolidations ?? []).forEach(c => {
      if (String(c.GroupShortName ?? c.groupShortName ?? "") !== String(group)) return;
      if ((c.Source ?? c.source) !== p.source || (c.GroupStructure ?? c.groupStructure) !== p.structure) return;
      const y = Number(c.Year ?? c.year), m = Number(c.Month ?? c.month);
      const k = y * 100 + m;
      if (k <= lim && (!best || k > best.k)) best = { k, year: String(y), month: String(m) };
    });
    return best ? { year: best.year, month: best.month } : null;
  }, [base.consolidations]);

  return {
    ready: base.ready,
    latestConsolidated,
    standard: base.standard,
    catalogs: base.catalogs ?? { individual: [], consolidated: [] },
    holdings,
    resolveKpi,
    resolveAccount,
    resolveContrib,
    accounts: base.accounts ?? [],
    cfAccounts: base.cfAccounts ?? [],
    // Para la memoria: árbol del plan y cuentas por etiqueta (cc_tag)
    childrenOf: base.childrenOf ?? new Map(),
    ccTagToCodes: base.ccTagToCodes ?? new Map(),
    ensure,
  };
}
