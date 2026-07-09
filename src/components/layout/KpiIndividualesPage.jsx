import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { useTypo, useSettings, useSettingsControls } from "./SettingsContext";
import { useLatestPeriod } from "./LatestPeriodContext.jsx";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";

function useAnimatedNumber(target, duration = 800) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const from = Number(fromRef.current) || 0;
    const to = Number(target) || 0;
    if (from === to) { setDisplay(to); return; }
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return display;
}

function AnimatedCell({ value, format, baseStyle }) {
  const isNum = value !== null && value !== undefined && !isNaN(value) && isFinite(value);
  const animated = useAnimatedNumber(isNum ? value : 0);
  if (!isNum) return <span style={{ ...baseStyle, color: "#D1D5DB" }}>—</span>;
  return <span style={{ ...baseStyle, color: value < 0 ? "#EF4444" : "#000000" }}>{fmtValue(animated, format)}</span>;
}

// ════════════════════════════════════════════════════════════════════════════
// KPI RESOLVER (inline) — was previously KpiResolver.js
// Loads KPI library + cc_tag mapping for the active accounting standard from
// Supabase and exposes a formula evaluator that understands cc / section nodes.
//
// SIGN CONVENTION: this resolver does NOT flip signs. Pivot values are used
// raw — Revenue arrives positive, costs/expenses arrive negative.
// Net Result = sum of all P&L cc nodes (no manual negation).
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

// Default KPIs shown on first load. The full library stays in Supabase so
// formulas like net_result -> ebt -> ebit -> ebitda can still resolve via refs.
const DEFAULT_VISIBLE_KPI_IDS = new Set([
  "revenue",
  "gross_profit",
  "net_result",
  "net_margin",
]);
// Grab the user's live JWT so RLS policies see auth.uid() correctly.
// Falls back to the publishable key when no session (safe for public tables).
function getSbAuthToken() {
  try {
    const key = Object.keys(localStorage).find(k => k.includes("auth-token"));
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

function useResolvedKpiList(groupAccounts, companyId, preResolvedStandardKey) {

  const [state, setState] = useState({
    kpiList:      [],
    allKpis:      [],
    ccTagToCodes: new Map(),
    sectionCodes: new Map(),
    standard:     null,
    ready:        false,
    error:        null,
  });

useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, ready: false, error: null }));

    (async () => {
      const standard = await resolveStandardKey(companyId, groupAccounts, preResolvedStandardKey);
      if (cancelled) return;
      if (!standard) {
        setState(s => ({ ...s, ready: true, kpiList: [], standard: null }));
        return;
      }
      try {
        const [mapping, fullKpiList] = await Promise.all([
          loadStandardMapping(standard, groupAccounts),
          loadKpiLibrary(standard, companyId),
        ]);
        if (cancelled) return;
        const { ccTagToCodes, sectionCodes } = mapping ?? { ccTagToCodes: new Map(), sectionCodes: new Map() };
        if (cancelled) return;
        // Only show the 4 default KPIs in the table, but keep the rest in
        // `allKpis` so ref-based formulas (e.g. net_result → ebt → ebit) resolve.
        const visibleKpis = fullKpiList.filter(k => DEFAULT_VISIBLE_KPI_IDS.has(k.id));
        setState({
          kpiList:       visibleKpis,
          allKpis:       fullKpiList,    // for resolving refs internally
          ccTagToCodes,
          sectionCodes,
          standard,
          ready:         true,
          error:         null,
        });
} catch (e) {
        if (cancelled) return;
        console.error("[KpiResolver] load failed:", e);
        setState(s => ({ ...s, ready: true, error: String(e?.message ?? e) }));
      }
    })();

    return () => { cancelled = true; };
  }, [groupAccounts, companyId, preResolvedStandardKey]);

  return state;
}

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

function evalFormulaWithCcTags(node, pivot, cache, kpiList, ccTagToCodes, sectionCodes) {
  if (!node) return 0;

  switch (node.type) {
case "account": {
      if (node.dimGroup || node.dimCode) {
        const key = `${node.accountCode}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
        // Local-code path first, then group-code path
        if (pivot.__localDimPivot && pivot.__localDimPivot.has(key)) {
          return -(pivot.__localDimPivot.get(key) ?? 0);
        }
        if (pivot.__dimPivot) {
          return -(pivot.__dimPivot.get(key) ?? 0);
        }
      }
      if (pivot.__localPivot && pivot.__localPivot.has(node.accountCode)) {
        return -(pivot.__localPivot.get(node.accountCode) ?? 0);
      }
      let total = 0;
      pivot.forEach((val, ac) => { if (ac === node.accountCode) total += val; });
      return -total;
    }
case "accountGroup": {
      // Group + dim → look up in dimPivot (keyed as "code:::dimGroup:::dimCode")
      if (node.groupCode && (node.dimGroup || node.dimCode)) {
        const descendants = pivot.__groupDescendants?.get(node.groupCode);
        const codes = descendants && descendants.size > 0 ? [...descendants] : [node.groupCode];
        let total = 0;
        for (const c of codes) {
          const key = `${c}:::${node.dimGroup ?? ""}:::${node.dimCode ?? ""}`;
          total += (pivot.__dimPivot?.get(key) ?? 0);
        }
        return -total;
      }
      // No dim → sum the group account + its descendants
      if (node.groupCode) {
        const descendants = pivot.__groupDescendants?.get(node.groupCode);
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
      if (ctx.company && party.companies?.length && !party.companies.includes(ctx.company)) return 0;
      const shared = party.sharedAcrossCompanies !== false;
      const yearTree = shared ? (party.values ?? {}) : (party.values?.[ctx.company] ?? {});
      const yearMap = yearTree[String(ctx.year)];
      if (!yearMap) return 0;
      const cacheKey = `party:${node.partyId}:${ctx.company ?? "_"}:${ctx.year}`;
      let computed = cache.get(cacheKey);
      if (!computed) {
        computed = evaluatePartyYear(yearMap, party.dims);
        cache.set(cacheKey, computed);
      }
      const selectedDims = ctx.selectedDims && ctx.selectedDims.size > 0
        ? party.dims.filter(d => ctx.selectedDims.has(d))
        : party.dims;
      const dimsToSum = node.dimCode ? [node.dimCode] : selectedDims;
      let total = 0;
      for (const dim of dimsToSum) {
        const v = computed[dim]?.[ctx.month];
        if (typeof v === "number") total += v;
      }
      return total;
    }
    case "op": {
      const l = evalFormulaWithCcTags(node.left,  pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      const r = evalFormulaWithCcTags(node.right, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? null : l / r;
      return 0;
    }
    case "fn": {
      const a = evalFormulaWithCcTags(node.arg, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
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
      const val = evalFormulaWithCcTags(ref.formula, pivot, cache, kpiList, ccTagToCodes, sectionCodes);
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
            if (override) effectiveNode = override;
          }
          const v = effectiveNode ? evalFormulaWithCcTags(effectiveNode, pivot, cache, kpiList, ccTagToCodes, sectionCodes) : 0;
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

function computeAllKpisResolved(visibleKpis, pivot, ccTagToCodes, sectionCodes, allKpis = null) {
  // Use the full list for ref lookups so chained refs still resolve when only
  // a subset of KPIs is visible. Falls back to visibleKpis if no full list given.
  const refList = allKpis ?? visibleKpis;
  const cache = new Map();
  visibleKpis.forEach(kpi => {
    if (!cache.has(kpi.id)) {
      // Inject the current KPI's variations so the "text" case can pick per-scope overrides.
      pivot.__currentKpiVariations = kpi.variations ?? null;
      const val = evalFormulaWithCcTags(kpi.formula, pivot, cache, refList, ccTagToCodes, sectionCodes);
      cache.set(kpi.id, val);
    }
  });
  pivot.__currentKpiVariations = null;
  return cache;
}
// ════════════════════════════════════════════════════════════════════════════
// END KPI RESOLVER
// ════════════════════════════════════════════════════════════════════════════
import {
  ChevronDown, Loader2, X, Plus, Trash2, Edit3,
  GripVertical, Hash, Percent, DollarSign,
  Check, Sigma, BarChart3, Building2, Layers,
  GitCompareArrows, Library, Download,
  CheckCircle2, AlertTriangle, Search,
} from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill, MultiFilterPill } from "./PageHeader.jsx";
import { t } from "../../lib/i18n";

import {
  listCompanyKpis, createCompanyKpi, updateCompanyKpi, archiveCompanyKpi, deleteCompanyKpi,
  getUserDashboard, saveUserDashboard,
} from "../../lib/kpisApi";
import { getActiveCompanyId } from "../../lib/mappingsApi";
import { supabase } from "../../lib/supabaseClient";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";

function ExcelLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#107C41"/>
      <path d="M19 4v8h8" fill="#0B5E30"/>
      <path d="M14.5 15.5 17 19l-2.5 3.5h1.8L18 20.1l1.7 2.4h1.8L19 19l2.5-3.5h-1.8L18 17.9l-1.7-2.4z" fill="#FFFFFF"/>
    </svg>
  );
}

function PdfLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4H7a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V12l-8-8z" fill="#D93025"/>
      <path d="M19 4v8h8" fill="#A1271B"/>
      <text x="9" y="23" fill="#FFFFFF" fontSize="7" fontWeight="700" fontFamily="Arial, sans-serif">PDF</text>
    </svg>
  );
}

const BASE_URL = "";

// Module-scope cache of dimensions ever seen per company. Survives re-renders
// without needing refs or state. Cleared implicitly on full page reload.
const __ALL_DIMS_CACHE = new Map();
function _getAllDimsCache(companyId) {
  const key = companyId ?? "_default";
  if (!__ALL_DIMS_CACHE.has(key)) __ALL_DIMS_CACHE.set(key, new Map());
  return __ALL_DIMS_CACHE.get(key);
}
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" }, { value: 4, label: "April" },
  { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" }, { value: 12, label: "December" },
];
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtValue(val, format) {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return "—";
  if (format === "percent") return val.toFixed(1) + "%";
  if (format === "currency") return val.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return val.toFixed(2);
}

function getBenchmarkColor(value, benchmark) {
if (!benchmark || value === null || value === undefined || isNaN(value) || !isFinite(value)) return null;
  const check = (range) => {
    if (!range) return false;
    const min = range.min !== "" && range.min !== undefined ? parseFloat(range.min) : null;
    const max = range.max !== "" && range.max !== undefined ? parseFloat(range.max) : null;
    if (min !== null && max !== null) return value > min && value < max;
    if (min !== null) return value > min;
    if (max !== null) return value < max;
    return false;
  };
  if (check(benchmark.vhealthy)) return {
    bg: "linear-gradient(90deg, rgba(26,47,138,0.08) 0%, rgba(26,47,138,0.03) 60%, transparent 100%)",
    border: "rgba(26,47,138,0.25)",
    text: "#1a2f8a",
  };
  if (check(benchmark.healthy)) return {
    bg: "linear-gradient(90deg, rgba(22,163,74,0.10) 0%, rgba(22,163,74,0.04) 60%, transparent 100%)",
    border: "rgba(22,163,74,0.35)",
    text: "#16a34a",
  };
  if (check(benchmark.unhealthy)) return {
    bg: "linear-gradient(90deg, rgba(220,38,38,0.08) 0%, rgba(220,38,38,0.03) 60%, transparent 100%)",
    border: "rgba(220,38,38,0.25)",
    text: "#dc2626",
  };
  return null;
}

// Parses the API's Dimensions field which is a string like "Group:Code" or
// "Group1:Code1||Group2:Code2" when a transaction is tagged with multiple dimensions.
// Returns an array of [group, code] tuples.
function parseDimensions(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw.split("||").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
  }).filter(Boolean);
}

// ── Mapping → KPI override helpers ────────────────────────────────────────────
// When a user applies a custom mapping, we re-bind known cc_tags (revenue,
// ebitda, etc.) to the account codes the user has grouped under each mapping
// section. Matching is fuzzy by label — more specific terms first because the
// first match wins (so "Gastos de personal" doesn't collide with the generic
// "Gastos operativos" bucket).
const CC_TAG_SYNONYMS = {
  personnel_costs:     ["gastos de personal", "personnel costs", "personnel"],
  cost_of_goods:       ["coste de ventas", "costo de ventas", "cost of goods", "cogs", "aprovisionamientos"],
  gross_profit:        ["margen bruto", "beneficio bruto", "resultado bruto", "gross profit", "gross margin"],
  ebitda:              ["ebitda"],
  ebit:                ["resultado de explotacion", "operating income", "resultado operativo", "ebit"],
  ebt:                 ["resultado antes de impuestos", "pre-tax", "ebt", "rai"],
  net_result:          ["resultado neto", "resultado del ejercicio", "net result", "net income", "beneficio neto"],
  current_assets:      ["activo corriente", "activo circulante", "current assets"],
  current_liabilities: ["pasivo corriente", "pasivo circulante", "current liabilities"],
  total_assets:        ["total activo", "activo total", "total assets", "total de activos"],
  total_equity:        ["patrimonio neto", "fondos propios", "total equity", "total de capital"],
  total_liabilities:   ["pasivo total", "total pasivo", "total liabilities", "total de pasivo"],
  // General last — these are broad and would over-match if placed before
  // the specific entries above.
  revenue:             ["ingresos", "revenue", "ventas", "sales", "income", "facturacion"],
  operating_expenses:  ["gastos operativos", "gastos de explotacion", "operating expenses", "opex"],
};

function normalizeLabel(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

// ── Export helpers ────────────────────────────────────────────────────────────
const EXPORT_COLORS = {
  primary:    "FF1A2F8A",
  primaryDk:  "FF1A2B6B",
  highlight:  "FFEEF1FB",
  compareB:   "FFCF305D",
  compareC:   "FF57AA78",
  band1:      "FFFFFFFF",
  band2:      "FFF8F9FF",
  band3:      "FFFAFBFF",
  finalGray:  "FF374151",
  white:      "FFFFFFFF",
  gray400:    "FF9CA3AF",
  gray500:    "FF6B7280",
  green:      "FF059669",
  red:        "FFDC2626",
};

function monthLabel(m) {
  const n = parseInt(m);
  return isNaN(n) ? String(m) : (MONTHS[n - 1]?.label ?? String(m));
}

function buildFilterLines(f) {
  if (!f) return ["—"];
  const lines = [];

  const period = [];
  if (f.year && f.month) period.push(`📅 ${monthLabel(f.month)} ${f.year}`);
  if (f.source)    period.push(`Source: ${f.source}`);
  if (f.structure) period.push(`Structure: ${f.structure}`);
  if (period.length) lines.push(period.join("    ·    "));

  if (Array.isArray(f.companies) && f.companies.length > 0) {
    const txt = f.companies.length > 6
      ? `Companies (${f.companies.length}): ${f.companies.slice(0,4).join(", ")}, …`
      : `Companies: ${f.companies.join(", ")}`;
    lines.push(txt);
  }

  const dimLine = [];
  if (Array.isArray(f.dimGroups) && f.dimGroups.length > 0) dimLine.push(`Dim Groups: ${f.dimGroups.join(", ")}`);
  if (Array.isArray(f.dims)      && f.dims.length      > 0) dimLine.push(`Dims: ${f.dims.join(", ")}`);
  if (dimLine.length) lines.push(dimLine.join("    ·    "));

  if (f.compareMode && f.cmpYear && f.cmpMonth) {
    const cmp = [`🆚 vs ${monthLabel(f.cmpMonth)} ${f.cmpYear}`];
    if (f.cmpSource)    cmp.push(`Source: ${f.cmpSource}`);
    if (f.cmpStructure) cmp.push(`Structure: ${f.cmpStructure}`);
    lines.push(cmp.join("    ·    "));
  }

  return lines.length ? lines : ["—"];
}

function describeFormulaNode(node, kpiList, accountCodeLabels) {
  if (!node) return "—";
  switch (node.type) {
    case "cc": return String(node.tag ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    case "ref": {
      const k = (kpiList || []).find(k => k.id === node.kpiId);
      return k?.label ?? node.kpiId ?? "?";
    }
case "account": {
      const name = accountCodeLabels?.get?.(node.accountCode);
      const base = `Local Account ${node.accountCode ?? "?"}${name ? ` — ${name}` : ""}`;
      if (node.dimGroup || node.dimCode) return `${base} [${node.dimGroup ?? ""}:${node.dimName || node.dimCode || ""}]`;
      return base;
    }
case "accountGroup": {
      const code = node.groupCode ?? node.prefix ?? "?";
      const name = accountCodeLabels?.get?.(code);
      const base = `${code}${name ? ` — ${name}` : ""}`;
      if (node.dimGroup || node.dimCode) {
        return `${base} · ${node.dimGroup}: ${node.dimName || node.dimCode}`;
      }
      return base;
    }
case "manual": return String(node.value ?? 0);
    case "party": return `${node.partyName ?? node.partyId ?? "?"} (partida)`;
    case "op": {
      const sym = { "+": "+", "-": "−", "*": "×", "/": "÷" }[node.op] ?? node.op;
      return `(${describeFormulaNode(node.left, kpiList, accountCodeLabels)} ${sym} ${describeFormulaNode(node.right, kpiList, accountCodeLabels)})`;
    }
    case "fn": {
      const inner = describeFormulaNode(node.arg, kpiList, accountCodeLabels);
      if (node.fn === "neg") return `−(${inner})`;
      if (node.fn === "abs") return `|${inner}|`;
      if (node.fn === "pct") return `(${inner}) × 100`;
      return inner;
    }
    case "text": return node.expression ?? "—";
    default: return "—";
  }
}

function describeBenchmark(b) {
  if (!b) return null;
  const fmtRange = (r) => {
    if (!r) return null;
    const min = r.min !== "" && r.min !== undefined && r.min !== null ? r.min : null;
    const max = r.max !== "" && r.max !== undefined && r.max !== null ? r.max : null;
    if (min !== null && max !== null) return `${min} → ${max}`;
    if (min !== null) return `> ${min}`;
    if (max !== null) return `< ${max}`;
    return null;
  };
  const parts = [];
  const un = fmtRange(b.unhealthy); if (un) parts.push(`Unhealthy: ${un}`);
  const h  = fmtRange(b.healthy);   if (h)  parts.push(`Healthy: ${h}`);
  const vh = fmtRange(b.vhealthy);  if (vh) parts.push(`Excellent: ${vh}`);
  return parts.length ? parts.join("  ·  ") : null;
}

// Convert any formula AST into text-formula shape { expression, variables }.
// Each leaf (ref/account/accountGroup/party/manual/cc) becomes a letter.
// Op/fn nodes turn into infix / function-call strings around the letters.
function flattenFormulaToTextForm(formula) {
  if (!formula) return null;
  // Already text — take as-is.
  if (formula.type === "text") {
    const expr = String(formula.expression ?? "").replace(/^\s*=\s*/, "");
    return { expression: expr, variables: formula.variables ?? {} };
  }
  const variables = {};
  const usedLetters = [];
  const nextLetter = () => {
    // A..Z, then AA..AZ if we ever need more
    const idx = usedLetters.length;
    if (idx < 26) return String.fromCharCode(65 + idx);
    const first = Math.floor(idx / 26) - 1;
    return String.fromCharCode(65 + first) + String.fromCharCode(65 + (idx % 26));
  };
  const assignLetter = (node) => {
    // Deduplicate identical leaves so the same account/ref reuses a letter.
    const key = JSON.stringify(node);
    for (const L of usedLetters) {
      if (variables[L] && JSON.stringify(variables[L]) === key) return L;
    }
    const L = nextLetter();
    variables[L] = node;
    usedLetters.push(L);
    return L;
  };
  const walk = (node) => {
    if (!node) return "0";
    switch (node.type) {
      case "op": {
        const l = walk(node.left);
        const r = walk(node.right);
        return `(${l} ${node.op} ${r})`;
      }
      case "fn": {
        const inner = walk(node.arg);
        if (node.fn === "neg") return `(-${inner})`;
        if (node.fn === "abs") return `ABS(${inner})`;
        if (node.fn === "pct") return `(${inner} * 100)`;
        return inner;
      }
      // Leaves become letter substitutions
      case "ref":
      case "account":
      case "accountGroup":
      case "party":
      case "cc":
      case "manual":
        return assignLetter(node);
      default:
        return "0";
    }
  };
  const expression = walk(formula);
  return { expression, variables };
}

function kpiFormulaSummary(kpi, kpiList, accountCodeLabels) {
  if (!kpi?.formula) return { expression: null, variables: [] };
  const flat = flattenFormulaToTextForm(kpi.formula);
  if (!flat) return { expression: null, variables: [] };
  const vars = Object.entries(flat.variables ?? {}).map(([letter, node]) => ({
    letter,
    desc: node ? describeFormulaNode(node, kpiList, accountCodeLabels) : "—",
  }));
  return { expression: flat.expression ?? "—", variables: vars };
}

async function repairXlsxDimensions(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  for (const f of sheets) {
    let xml = await zip.file(f).async("string");

    // (1) Strip Infinity / NaN cell values — ExcelJS writes them as invalid XML
    //     and Excel pops the "we found a problem with content" recovery dialog
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>-?Infinity<\/v><\/c>/g, "");
    xml = xml.replace(/<c r="[^"]+"[^>]*><v>NaN<\/v><\/c>/g, "");

    // (2) Strip collapsed="1" from grouped row members — only valid on the
    //     summary row, ExcelJS incorrectly puts it on every grouped row
    xml = xml.replace(/(<row[^>]*outlineLevel="\d+"[^>]*?)\s*collapsed="1"/g, "$1");

    // (3) Fix the bogus x14ac:dyDescent="55" that ExcelJS sometimes writes
    xml = xml.replace(/x14ac:dyDescent="55"/g, 'x14ac:dyDescent="0.25"');

    // (4) Recompute dimension based on actual cells
    const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"/g)];
    if (cells.length > 0) {
      const cs = cells.map(c => colToNum(c[1]));
      const rs = cells.map(c => +c[2]);
      const newDim = `${numToCol(Math.min(...cs))}${Math.min(...rs)}:${numToCol(Math.max(...cs))}${Math.max(...rs)}`;
      xml = xml.replace(/<dimension ref="[^"]+"\s*\/>/, `<dimension ref="${newDim}"/>`);
    }

    zip.file(f, xml);
  }
  return await zip.generateAsync({ type: "arraybuffer" });
}

async function exportKpisToXlsx({
  kpiList, kpiListCompany, kpiListDimension, kpiListFull,
  companyCodes, companyLabels, companyResults, companyResultsCmp,
  dimensionCodes, dimensionResults, dimensionResultsCmp, dimensionPivots,
  graphSections, filters, exportOpts = {}, accountCodeLabels = new Map(),
}) {
  const kListCompany   = kpiListCompany   ?? kpiList;
  const kListDimension = kpiListDimension ?? kpiList;
  // For ref-node label lookups, use the full library — even system KPIs
  // not on the current dashboard need to resolve to their friendly label.
  const kListForRefs   = kpiListFull ?? kpiList;
  const C = EXPORT_COLORS;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Konsolidator";
  wb.created = new Date();

const inlineDefs = exportOpts.inlineDefs !== false;
  const cmpEnabled = !!filters?.compareMode;

  const fmtBenchRange = (r) => {
    if (!r) return "—";
    const min = r.min !== "" && r.min !== undefined && r.min !== null ? r.min : null;
    const max = r.max !== "" && r.max !== undefined && r.max !== null ? r.max : null;
    if (min !== null && max !== null) return `${min} → ${max}`;
    if (min !== null) return `> ${min}`;
    if (max !== null) return `< ${max}`;
    return "—";
  };

  const BENCH_HEAD = {
    unhealthy: { label: "Unhealthy", hdrBg: "FFB91C1C", cellBg: "FFFEF2F2", text: "FFB91C1C" },
    healthy:   { label: "Healthy",   hdrBg: "FF15803D", cellBg: "FFF0FDF4", text: "FF15803D" },
    vhealthy:  { label: "Excellent", hdrBg: "FF1E40AF", cellBg: "FFEFF6FF", text: "FF1E40AF" },
  };

const addKpiMatrixSheet = (sheetName, titleText, cols, colLabels, sections, kList) => {
    // sections = [{ label, resultsMap, cmpResultsMap }, …]
    const anyCmp = cmpEnabled && sections.some(s => s.cmpResultsMap);
    const subColsPerCol = anyCmp ? 4 : 1;
    const totalAvgCol = 1 + cols.length * subColsPerCol + 1;
    const benchUnhCol = totalAvgCol + 1;
    const benchHCol   = totalAvgCol + 2;
    const benchVHCol  = totalAvgCol + 3;
    const totalCols   = benchVHCol;

    const subLines = buildFilterLines(filters);
    const frozenY  = 1 + subLines.length + 1; // title + subs + spacer

const ws = wb.addWorksheet(sheetName, {
      views: [{ state: "frozen", xSplit: 1, ySplit: frozenY }],
      properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
    });
    ws.properties.outlineLevelRow = 1;
    ws.properties.outlineLevelCol = 0;
    ws.properties.summaryBelow    = false;
    ws.properties.summaryRight    = false;

    // Title
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = titleText;
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 28;

    // Subtitle lines
    subLines.forEach((line, idx) => {
      const rowN = 2 + idx;
      ws.mergeCells(rowN, 1, rowN, totalCols);
      const c = ws.getCell(rowN, 1);
      c.value = line;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      c.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
      c.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
      ws.getRow(rowN).height = 18;
    });

    const spacerRow = 2 + subLines.length;
    ws.getRow(spacerRow).height = 6;
    let curRow = spacerRow + 1;

    // Section accent colors: YTD navy, Monthly pink
    const SECTION_COLORS = [C.primary, "FFCF305D"];

    sections.forEach((section, sIdx) => {
const sectAccent = C.primary;                                          // headers always navy (clear contrast with Cmp pink)
      const sectBarBg  = SECTION_COLORS[sIdx % SECTION_COLORS.length]; // section divider bar color (YTD navy, Monthly pink)
      const resultsMap    = section.resultsMap;
      const cmpResultsMap = section.cmpResultsMap;
      const showCmp       = anyCmp && cmpResultsMap;

      // Section divider bar (only when multiple sections)
      if (sections.length > 1) {
        ws.mergeCells(curRow, 1, curRow, totalCols);
        const lbl = ws.getCell(curRow, 1);
        lbl.value = section.label;
lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectBarBg } };
        lbl.font = { name: "Calibri", size: 12, bold: true, color: { argb: C.white } };
        lbl.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(curRow).height = 24;
        curRow++;
      }

      // Headers
      if (showCmp) {
        const r1 = curRow, r2 = curRow + 1;
        const superRow = ws.getRow(r1);
        superRow.height = 22;
        const kpiSuper = superRow.getCell(1);
        kpiSuper.value = "KPI";
        kpiSuper.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        kpiSuper.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        kpiSuper.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.mergeCells(r1, 1, r2, 1);
        cols.forEach((_, i) => {
          const startCol = 2 + i * 4;
          const cell = superRow.getCell(startCol);
          cell.value = colLabels[i];
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
          cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          ws.mergeCells(r1, startCol, r1, startCol + 3);
        });
        const totalSuper = superRow.getCell(totalAvgCol);
        totalSuper.value = "Total / Avg";
        totalSuper.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        totalSuper.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        totalSuper.alignment = { vertical: "middle", horizontal: "center" };
        ws.mergeCells(r1, totalAvgCol, r2, totalAvgCol);
        [["unhealthy", benchUnhCol], ["healthy", benchHCol], ["vhealthy", benchVHCol]].forEach(([key, col]) => {
          const cell = superRow.getCell(col);
          cell.value = BENCH_HEAD[key].label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BENCH_HEAD[key].hdrBg } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          ws.mergeCells(r1, col, r2, col);
        });
        const subRow = ws.getRow(r2);
        subRow.height = 18;
        cols.forEach((_, i) => {
          const startCol = 2 + i * 4;
          ["A", "Cmp", "Δ", "Δ %"].forEach((lbl, j) => {
            const c = subRow.getCell(startCol + j);
            c.value = lbl;
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: j === 0 ? sectAccent : (j === 1 ? C.compareB : C.primaryDk) } };
            c.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
            c.alignment = { vertical: "middle", horizontal: "center" };
          });
        });
        curRow = r2 + 1;
      } else {
        const headerRow = ws.getRow(curRow);
        headerRow.height = 24;
        const kpiCell = headerRow.getCell(1);
        kpiCell.value = "KPI";
        kpiCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        kpiCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        kpiCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        colLabels.forEach((label, i) => {
          const cell = headerRow.getCell(2 + i);
          cell.value = label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "right" };
        });
        const totalCell = headerRow.getCell(totalAvgCol);
        totalCell.value = "Total / Avg";
        totalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectAccent } };
        totalCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        totalCell.alignment = { vertical: "middle", horizontal: "center" };
        [["unhealthy", benchUnhCol], ["healthy", benchHCol], ["vhealthy", benchVHCol]].forEach(([key, col]) => {
          const cell = headerRow.getCell(col);
          cell.value = BENCH_HEAD[key].label;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BENCH_HEAD[key].hdrBg } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });
        curRow++;
      }

      // Data rows
kList.forEach((kpi, rowIdx) => {
        const bandColor = rowIdx % 2 === 0 ? C.band1 : C.band2;

        // Per-variable values for this section (only for text-formula KPIs).
        // varsMap: Map<col, Map<kpiId, Map<letter, number>>>
        const varsForKpiByCol = new Map(); // col -> Map<letter, number>
        cols.forEach(col => {
          const perKpi = section.varsMap?.get(col);
          const perLetter = perKpi?.get(kpi.id);
          if (perLetter && perLetter.size > 0) varsForKpiByCol.set(col, perLetter);
        });
        // Union of letters actually used across all columns for this KPI.
        const letters = [];
        {
          const seen = new Set();
          varsForKpiByCol.forEach(m => m.forEach((_, L) => { if (!seen.has(L)) { seen.add(L); letters.push(L); } }));
          letters.sort();
        }
// Flatten formula (works for both text-form and AST-form KPIs).
        const flat = flattenFormulaToTextForm(kpi.formula);
        const hasFormula = flat && letters.length > 0 && flat.expression;
        const expression = hasFormula
          ? flat.expression.replace(/^\s*=\s*/, "")
          : null;

        const values = cols.map(col => {
          const res = resultsMap?.get(col);
          if (!res) return null;
          const v = res.get(kpi.id);
          return Number.isFinite(v) ? v : null;
        });
        const cmpValues = showCmp ? cols.map(col => {
          const res = cmpResultsMap.get(col);
          if (!res) return null;
          const v = res.get(kpi.id);
          return Number.isFinite(v) ? v : null;
        }) : null;

        const validVals = values.filter(v => v !== null);
        const aggregateRaw = validVals.length === 0 ? null
          : kpi.format === "percent"
            ? validVals.reduce((a, b) => a + b, 0) / validVals.length
            : validVals.reduce((a, b) => a + b, 0);
        const aggregate = Number.isFinite(aggregateRaw) ? aggregateRaw : null;

        const dataRowNum = curRow;
        // Pre-compute where each variable row will live so the KPI row's
        // formula cells can reference them.
        const varRowByLetter = new Map();
        if (hasFormula) {
          // description row (if any) will sit right after the KPI row, then
          // one row per variable.
   let base = dataRowNum + 1 + (sIdx === 0 && kpi.description ? 1 : 0);
          letters.forEach((L, i) => varRowByLetter.set(L, base + i));
        }

        const kpiType = kpi._isOverridden
          ? { label: "EDITED", color: "FF7C3AED" }
          : (kpi._kpiType === "custom" || kpi._createdBy)
            ? { label: "CUSTOM", color: "FF15803D" }
            : { label: "SYSTEM", color: "FF6B7280" };
        const labelCell = ws.getCell(dataRowNum, 1);
        labelCell.value = {
          richText: [
            { text: kpi.label, font: { name: "Calibri", size: 11, bold: true, color: { argb: C.primary } } },
            { text: `   ${kpiType.label}`, font: { name: "Calibri", size: 8, bold: true, color: { argb: kpiType.color } } },
          ]
        };
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bandColor } };
        labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

        // Build the Excel formula string for a given column, substituting each
        // variable letter with a cell reference into that column's variable row.
        const buildExcelFormula = (colLetter, colIdx) => {
          if (!hasFormula) return null;
          if (!varsForKpiByCol.has(cols[colIdx])) return null;
          // Substitute LETTER → "{colLetter}{varRow}". Match whole-letter tokens
          // only (avoid replacing letters inside function names like SUM/ABS).
          let expr = expression;
          letters.forEach(L => {
            const row = varRowByLetter.get(L);
            if (!row) return;
            expr = expr.replace(new RegExp(`\\b${L}\\b`, "g"), `${colLetter}${row}`);
          });
          return "=" + expr;
        };

        const writeNumCell = (rowN, colN, val, format, fillArgb, opts = {}) => {
          const cell = ws.getCell(rowN, colN);
          if (opts.formula) {
            cell.value = { formula: opts.formula, result: Number.isFinite(val) ? val : 0 };
            cell.numFmt = format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
            cell.font = {
              name: "Calibri", size: 10, bold: !!opts.bold,
              color: { argb: opts.colorOverride ?? ((val ?? 0) < 0 ? C.red : (format === "percent" && (val ?? 0) >= 0 ? C.green : C.primary)) },
            };
          } else if (!Number.isFinite(val)) {
            cell.value = "—";
            cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: !!opts.bold };
          } else {
            cell.value = val;
            cell.numFmt = format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
            cell.font = {
              name: "Calibri", size: 10, bold: !!opts.bold,
              color: { argb: opts.colorOverride ?? (val < 0 ? C.red : (format === "percent" && val >= 0 ? C.green : C.primary)) },
            };
          }
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
          cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
          cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
        };

        // Convert an Excel column index (1-based) to letter(s): 1→A, 27→AA, …
        const colToLetter = (n) => {
          let s = "";
          while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
          return s;
        };

        cols.forEach((_, i) => {
          if (showCmp) {
            const startCol = 2 + i * 4;
            const a = values[i];
            const c = cmpValues[i];
            const deltaRaw    = (a !== null && c !== null) ? a - c : null;
            const deltaPctRaw = (a !== null && c !== null && kpi.format !== "percent" && Math.abs(c) > 1e-9) ? ((a - c) / Math.abs(c)) * 100 : null;
            const delta    = Number.isFinite(deltaRaw)    ? deltaRaw    : null;
            const deltaPct = Number.isFinite(deltaPctRaw) ? deltaPctRaw : null;
            const primaryFormula = buildExcelFormula(colToLetter(startCol), i);
            writeNumCell(dataRowNum, startCol,     a, kpi.format, bandColor, primaryFormula ? { formula: primaryFormula } : {});
            writeNumCell(dataRowNum, startCol + 1, c, kpi.format, bandColor, { colorOverride: c !== null && c < 0 ? C.red : C.compareB });
            writeNumCell(dataRowNum, startCol + 2, delta, kpi.format, bandColor, { colorOverride: delta === null ? null : (delta < 0 ? C.red : C.green) });
            const pctCell = ws.getCell(dataRowNum, startCol + 3);
            if (deltaPct === null) {
              pctCell.value = "—";
              pctCell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 } };
            } else {
              pctCell.value = deltaPct;
              pctCell.numFmt = '0.0"%"';
              pctCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: deltaPct < 0 ? C.red : C.green } };
            }
            pctCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bandColor } };
            pctCell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
            pctCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
          } else {
            const colN = 2 + i;
            const f = buildExcelFormula(colToLetter(colN), i);
            writeNumCell(dataRowNum, colN, values[i], kpi.format, bandColor, f ? { formula: f } : {});
          }
        });

        writeNumCell(dataRowNum, totalAvgCol, aggregate, kpi.format, C.highlight, { bold: true });

        // Benchmark columns
        [["unhealthy", benchUnhCol], ["healthy", benchHCol], ["vhealthy", benchVHCol]].forEach(([key, col]) => {
          const cell = ws.getCell(dataRowNum, col);
          const txt = fmtBenchRange(kpi.benchmark?.[key]);
          cell.value = txt;
          cell.font = { name: "Calibri", size: 10, bold: txt !== "—", color: { argb: txt === "—" ? C.gray400 : BENCH_HEAD[key].text } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BENCH_HEAD[key].cellBg } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
        });

        curRow++;

        // ── Trailers: description + one row per variable (per section) ──
        if (inlineDefs) {
         const fSum = kpiFormulaSummary(kpi, kListForRefs, accountCodeLabels);
          const trailerBg = "FFF8F9FF";
          const addTextTrailer = (label, value, accentArgb) => {
            if (!value) return;
            const r = ws.getRow(curRow);
            r.height = 16;
            r.outlineLevel = 1;
            r.hidden = true;
            const cell = r.getCell(1);
            cell.value = {
              richText: [
                { text: `  ${label}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: accentArgb } } },
                { text: value, font: { name: "Calibri", size: 9, color: { argb: "FF374151" } } },
              ]
            };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
            cell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
            for (let cc = 2; cc <= totalCols; cc++) {
              const blank = r.getCell(cc);
              blank.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
              blank.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
            }
            curRow++;
          };
          // Description (once, on first section only, so it doesn't duplicate)
          if (sIdx === 0 && kpi.description) addTextTrailer("DESCRIPTION", kpi.description, C.gray500);

          // Variable rows — one per letter, with per-column numeric values.
          if (hasFormula) {
            letters.forEach(L => {
              const r = ws.getRow(curRow);
              r.height = 16;
              r.outlineLevel = 1;
              r.hidden = true;
              // Label: "  A = Net Result"
              const desc = fSum.variables.find(v => v.letter === L)?.desc ?? "";
              const cell = r.getCell(1);
              cell.value = {
                richText: [
                  { text: `    ${L}  `, font: { name: "Calibri", size: 9, bold: true, color: { argb: C.primary } } },
                  { text: `= ${desc}`,  font: { name: "Calibri", size: 9, color: { argb: "FF374151" } } },
                ]
              };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
              cell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
              cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
              // Per-column values
              cols.forEach((col, i) => {
                const v = varsForKpiByCol.get(col)?.get(L);
                if (showCmp) {
                  const startCol = 2 + i * 4;
                  writeNumCell(curRow, startCol, Number.isFinite(v) ? v : null, "", trailerBg);
                  // leave compare/delta/% blank for variable rows
                  [startCol + 1, startCol + 2, startCol + 3].forEach(cc => {
                    const b = r.getCell(cc);
                    b.value = "";
                    b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
                    b.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
                  });
                } else {
                  writeNumCell(curRow, 2 + i, Number.isFinite(v) ? v : null, "", trailerBg);
                }
              });
              // Blank fills for total/bench cols
              for (let cc = totalAvgCol; cc <= totalCols; cc++) {
                const b = r.getCell(cc);
                b.value = "";
                b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: trailerBg } };
                b.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
              }
              curRow++;
            });
} else if (fSum.expression) {
            // No text-formula variables — show the formula description on
            // every section so both YTD and Monthly get their own +/- toggle.
            addTextTrailer("FORMULA", fSum.expression, C.primary);
          }
        }
      });

      // Spacer between sections
      if (sIdx < sections.length - 1) {
        ws.getRow(curRow).height = 14;
        curRow++;
      }
    });

    // Column widths
    ws.getColumn(1).width = 42;
    if (anyCmp) {
      for (let i = 0; i < cols.length; i++) {
        ws.getColumn(2 + i * 4).width     = 16;
        ws.getColumn(2 + i * 4 + 1).width = 14;
        ws.getColumn(2 + i * 4 + 2).width = 12;
        ws.getColumn(2 + i * 4 + 3).width = 10;
      }
    } else {
      for (let i = 2; i <= 1 + cols.length; i++) ws.getColumn(i).width = 18;
    }
    ws.getColumn(totalAvgCol).width = 16;
    ws.getColumn(benchUnhCol).width = 14;
    ws.getColumn(benchHCol).width   = 14;
    ws.getColumn(benchVHCol).width  = 14;
  };

if (companyCodes && companyCodes.length > 0 && companyResults?.ytd) {
    const labels = (companyLabels && companyLabels.length === companyCodes.length) ? companyLabels : companyCodes;
addKpiMatrixSheet("Company KPIs", "KPI Dashboard — By Company",
      companyCodes, labels,
      [
        { label: "YTD · Year-to-Date",     resultsMap: companyResults.ytd,     cmpResultsMap: companyResultsCmp?.ytd     ?? null, varsMap: companyResults.ytdVars     },
        { label: "Monthly · Period Delta", resultsMap: companyResults.monthly, cmpResultsMap: companyResultsCmp?.monthly ?? null, varsMap: companyResults.monthlyVars },
      ], kListCompany);
  }

  if (dimensionCodes && dimensionCodes.length > 0 && dimensionResults?.ytd) {
    const dimLabels = dimensionCodes.map(dc => dimensionPivots?.get(dc)?.name ?? dc);
addKpiMatrixSheet("Dimension KPIs", "KPI Dashboard — By Dimension",
      dimensionCodes, dimLabels,
      [
        { label: "YTD · Year-to-Date",     resultsMap: dimensionResults.ytd,     cmpResultsMap: dimensionResultsCmp?.ytd     ?? null, varsMap: dimensionResults.ytdVars     },
        { label: "Monthly · Period Delta", resultsMap: dimensionResults.monthly, cmpResultsMap: dimensionResultsCmp?.monthly ?? null, varsMap: dimensionResults.monthlyVars },
      ], kListDimension);
  }

  // ── KPI Definitions sheet ──
  if (exportOpts.defsSheet !== false) {
    const dws = wb.addWorksheet("KPI Definitions", { views: [{ state: "frozen", ySplit: 2 }] });
    dws.mergeCells(1, 1, 1, 5);
    const dTitle = dws.getCell(1, 1);
    dTitle.value = "KPI Definitions · Formulas · Benchmarks";
    dTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
    dTitle.font = { name: "Calibri", size: 14, bold: true, color: { argb: C.white } };
    dTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    dws.getRow(1).height = 26;

    const dHead = dws.getRow(2);
    dHead.height = 22;
    ["KPI", "Category", "Format", "Formula · Variables", "Benchmark"].forEach((h, i) => {
      const cell = dHead.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    });

// Union of both views' KPIs, deduped by id, so definitions cover everything.
    const _allKpisForDefs = (() => {
      const seen = new Set();
      const out = [];
      [...kListCompany, ...kListDimension].forEach(k => {
        if (!seen.has(k.id)) { seen.add(k.id); out.push(k); }
      });
      return out;
    })();
    _allKpisForDefs.forEach((kpi, i) => {
      const r = dws.getRow(3 + i);
      const band = i % 2 === 0 ? C.band1 : C.band2;
      const fSum = kpiFormulaSummary(kpi, kpiList, accountCodeLabels);
      const bDesc = describeBenchmark(kpi.benchmark);
      const formulaTxt = [
        fSum.expression ? `Formula: ${fSum.expression}` : null,
        fSum.variables.length > 0 ? fSum.variables.map(v => `${v.letter} = ${v.desc}`).join("\n") : null,
        kpi.description ? `Description: ${kpi.description}` : null,
      ].filter(Boolean).join("\n");

      const cells = [
        kpi.label,
        kpi.category ?? "",
        kpi.format ?? "",
        formulaTxt || "—",
        bDesc ?? "—",
      ];
      cells.forEach((v, j) => {
        const c = r.getCell(j + 1);
        c.value = v;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        c.font = { name: "Calibri", size: 10, bold: j === 0, color: { argb: j === 0 ? C.primary : "FF374151" } };
        c.alignment = { vertical: "top", horizontal: "left", indent: 1, wrapText: true };
        c.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      });
      const formulaLineCount = formulaTxt.split("\n").length;
      r.height = Math.max(20, formulaLineCount * 15);
    });

    dws.getColumn(1).width = 32;
    dws.getColumn(2).width = 16;
    dws.getColumn(3).width = 12;
    dws.getColumn(4).width = 60;
    dws.getColumn(5).width = 40;
  }

// Graphs tab — one sheet per section: YTD chart+table on top, Monthly chart+table below
  if (graphSections && graphSections.length > 0) {
    for (let secIdx = 0; secIdx < graphSections.length; secIdx++) {
      const section = graphSections[secIdx];
      const { sectionId, company, startY, startM, endY, endM, source: secSource, structure: secStructure,
              dimGroup, dim,
              ytdData, ytdImg, monthlyData, monthlyImg, series } = section;
      const seriesList = Array.isArray(series) ? series : [];

      const sheetName = `Graph ${sectionId}`;
      const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 3 }] });

      // Title row (merged narrow — over data-table cols only, prevents dimension corruption)
      const TBL_COL = 12;                                                  // data table starts at L
      const TBL_END_COL = Math.max(20, TBL_COL + seriesList.length);       // grows with series count
      ws.mergeCells(1, TBL_COL, 1, TBL_END_COL);
      const t = ws.getCell(1, TBL_COL);
      t.value = `Section ${sectionId} — ${company || "—"}`;
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      t.font = { name: "Calibri", size: 14, bold: true, color: { argb: C.white } };
      t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(1).height = 26;

      // Subtitle (filters)
      ws.mergeCells(2, TBL_COL, 2, TBL_END_COL);
      const s = ws.getCell(2, TBL_COL);
      const rangeStr = `${monthLabel(startM)} ${startY} → ${monthLabel(endM)} ${endY}`;
      const descParts = [rangeStr, secSource, secStructure];
const dgArr = Array.isArray(dimGroup) ? dimGroup : (dimGroup ? [dimGroup] : []);
      const dArr  = Array.isArray(dim)      ? dim      : (dim      ? [dim]      : []);
      if (dgArr.length > 0) descParts.push(`Dim Groups: ${dgArr.join(", ")}`);
      if (dArr.length  > 0) descParts.push(`Dims: ${dArr.join(", ")}`);
      s.value = descParts.join(" · ");
      s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      s.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
      s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(2).height = 18;
      ws.getRow(3).height = 6;

// Per-series header background follows the in-app palette: A = section accent, B = pink, C = green
      const headerBgFor = (s, sectAccent) => {
        if (!s || s.barId === "a") return sectAccent;
        if (s.barId === "B") return "FFCF305D";
        if (s.barId === "C") return "FF10B981";
        return sectAccent;
      };

      const renderPeriodSection = (label, accentBg, imgB64, data, startRow) => {
        ws.mergeCells(startRow, TBL_COL, startRow, TBL_END_COL);
        const lbl = ws.getCell(startRow, TBL_COL);
        lbl.value = label;
        lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentBg } };
        lbl.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
        lbl.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(startRow).height = 20;

        if (imgB64) {
          try {
            const imageId = wb.addImage({ base64: imgB64, extension: "png" });
            ws.addImage(imageId, {
              tl: { col: 0, row: startRow },
              br: { col: 10, row: startRow + 19 },
              editAs: "oneCell",
            });
          } catch (e) { console.warn(`Chart embed failed (${label}):`, e); }
        }

        const headerRow = ws.getRow(startRow + 1);
        headerRow.height = 22;
        const periodHdr = headerRow.getCell(TBL_COL);
        periodHdr.value = "Period";
        periodHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentBg } };
        periodHdr.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        periodHdr.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        seriesList.forEach((s, i) => {
          const c = headerRow.getCell(TBL_COL + 1 + i);
          c.value = s.label;
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBgFor(s, accentBg) } };
          c.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
          c.alignment = { vertical: "middle", horizontal: "right", indent: 1, wrapText: true };
        });

        (data || []).forEach((d, idx) => {
          const r = ws.getRow(startRow + 2 + idx);
          r.height = 18;
          const band = idx % 2 === 0 ? C.band1 : C.band2;
          const periodCell = r.getCell(TBL_COL);
          periodCell.value = d.period;
          periodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
          periodCell.font = { name: "Calibri", size: 10, color: { argb: C.primary }, bold: true };
          periodCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
          seriesList.forEach((s, i) => {
            const val = d[s.key];
            const c = r.getCell(TBL_COL + 1 + i);
            if (!Number.isFinite(val)) {
              c.value = "—";
              c.font = { name: "Calibri", size: 9, color: { argb: C.gray400 } };
            } else {
              c.value = val;
              c.numFmt = s.format === "percent" ? '0.0"%"' : '#,##0;[Red]-#,##0';
              c.font = { name: "Calibri", size: 9, color: { argb: val < 0 ? C.red : C.primary } };
            }
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
            c.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
          });
        });

        return startRow + Math.max(22, (data?.length ?? 0) + 3);
      };

      let nextRow = 4;
      nextRow = renderPeriodSection("YTD · Year-to-Date",  C.primary,   ytdImg,     ytdData,     nextRow);
      nextRow += 1;
      renderPeriodSection("Monthly · Period Delta",        "FFCF305D",  monthlyImg, monthlyData, nextRow);

      // Column widths
      for (let i = 1; i <= 10; i++) ws.getColumn(i).width = 10;
      ws.getColumn(11).width = 2;
      ws.getColumn(TBL_COL).width = 14;
      seriesList.forEach((_, i) => { ws.getColumn(TBL_COL + 1 + i).width = 15; });
    }
  }

const buffer   = await wb.xlsx.writeBuffer();
  const repaired = await repairXlsxDimensions(buffer);
  const blob     = new Blob([repaired], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fname    = `Konsolidator_KPIs_${filters?.year ?? ""}_${String(filters?.month ?? "").padStart(2, "0")}.xlsx`;
  saveAs(blob, fname);
}
async function exportKpisToPdf({
  kpiList, kpiListCompany, kpiListDimension, kpiListFull,
  companyCodes, companyLabels, companyResults, companyResultsCmp,
  dimensionCodes, dimensionResults, dimensionResultsCmp, dimensionPivots,
  graphSections, filters, exportOpts = {}, accountCodeLabels = new Map(),
}) {
  const kListCompany   = kpiListCompany   ?? kpiList;
  const kListDimension = kpiListDimension ?? kpiList;
  const kListForRefs   = kpiListFull      ?? kpiList;
  const H = {
    primary:   [26, 47, 138],
    primaryDk: [13, 27, 84],
    compareB:  [207, 48, 93],
    compareC:  [16, 185, 129],
    band2:     [248, 249, 255],
    highlight: [238, 241, 251],
    white:     [255, 255, 255],
    gray400:   [156, 163, 175],
    gray500:   [107, 114, 128],
    gray700:   [55, 65, 81],
    red:       [220, 38, 38],
    green:     [5, 150, 105],
    benchUnBg: [254, 242, 242], benchUnHd: [185, 28, 28],
    benchHeBg: [240, 253, 244], benchHeHd: [21, 128, 61],
    benchVHBg: [239, 246, 255], benchVHHd: [30, 64, 175],
  };

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const fmtBenchRange = (r) => {
    if (!r) return "—";
    const min = r.min !== "" && r.min !== undefined && r.min !== null ? r.min : null;
    const max = r.max !== "" && r.max !== undefined && r.max !== null ? r.max : null;
    if (min !== null && max !== null) return `${min} to ${max}`;
    if (min !== null) return `> ${min}`;
    if (max !== null) return `< ${max}`;
    return "—";
  };

  const kpiTypeBadge = (kpi) => {
    if (kpi._isOverridden) return "EDITED";
    if (kpi._kpiType === "custom" || kpi._createdBy) return "CUSTOM";
    return "SYSTEM";
  };

  // PDF-safe filter line builder — jsPDF's default helvetica can't render emoji or Greek
  // characters, so we strip the calendar/vs emojis from the header version and use plain
  // ASCII labels instead.
  const buildPdfFilterLines = (f) => {
    if (!f) return ["—"];
    const lines = [];
    const period = [];
    if (f.year && f.month) period.push(`PERIOD: ${monthLabel(f.month)} ${f.year}`);
    if (f.source)    period.push(`SOURCE: ${f.source}`);
    if (f.structure) period.push(`STRUCTURE: ${f.structure}`);
    if (period.length) lines.push(period.join("   ·   "));

    if (Array.isArray(f.companies) && f.companies.length > 0) {
      const txt = f.companies.length > 6
        ? `COMPANIES (${f.companies.length}): ${f.companies.slice(0,4).join(", ")} +${f.companies.length - 4} more`
        : `COMPANIES: ${f.companies.join(", ")}`;
      lines.push(txt);
    }

    const dim = [];
    if (Array.isArray(f.dimGroups) && f.dimGroups.length > 0) dim.push(`DIM GROUPS: ${f.dimGroups.join(", ")}`);
    if (Array.isArray(f.dims)      && f.dims.length      > 0) dim.push(`DIMS: ${f.dims.join(", ")}`);
    if (dim.length) lines.push(dim.join("   ·   "));

    if (f.compareMode && f.cmpYear && f.cmpMonth) {
      const cmp = [`COMPARED WITH: ${monthLabel(f.cmpMonth)} ${f.cmpYear}`];
      if (f.cmpSource)    cmp.push(`SOURCE: ${f.cmpSource}`);
      if (f.cmpStructure) cmp.push(`STRUCTURE: ${f.cmpStructure}`);
      lines.push(cmp.join("   ·   "));
    }

    return lines.length ? lines : ["—"];
  };

  // Graph-page filters are different: section-scoped date range, the section's own
  // companies (which can differ from the global multi-select), dim group/dim, and the
  // KPIs being charted.
  const buildGraphFilterLines = (section) => {
    const lines = [];
    const period = [];
    period.push(`RANGE: ${monthLabel(section.startM)} ${section.startY}  to  ${monthLabel(section.endM)} ${section.endY}`);
    if (section.source)    period.push(`SOURCE: ${section.source}`);
    if (section.structure) period.push(`STRUCTURE: ${section.structure}`);
    lines.push(period.join("   ·   "));

    const companies = Array.isArray(section.companies) && section.companies.length > 0
      ? section.companies
      : (section.company ? section.company.split(", ").filter(Boolean) : []);
    if (companies.length > 0) lines.push(`COMPANIES: ${companies.join(", ")}`);

const dim = [];
    const sgs = Array.isArray(section.dimGroup) ? section.dimGroup : (section.dimGroup ? [section.dimGroup] : []);
    const sds = Array.isArray(section.dim)      ? section.dim      : (section.dim      ? [section.dim]      : []);
    if (sgs.length > 0) dim.push(`DIM GROUPS: ${sgs.join(", ")}`);
    if (sds.length > 0) dim.push(`DIMS: ${sds.join(", ")}`);
    if (dim.length) lines.push(dim.join("   ·   "));

    const seriesList = Array.isArray(section.series) ? section.series : [];
    const kpiIds = [...new Set(seriesList.map(s => s.kpiId))];
    const kpiNames = kpiIds.map(id => kpiList.find(k => k.id === id)?.label ?? id);
    if (kpiNames.length > 0) {
      const cmpNote = section.compareMode ? "   ·   WITH COMPARE OVERLAY" : "";
      lines.push(`KPIs: ${kpiNames.join(", ")}${cmpNote}`);
    }

    return lines.length ? lines : ["—"];
  };

  const drawTitleBar = (title) => {
    doc.setFillColor(...H.primary);
    doc.rect(0, 0, pageW, 36, "F");
    doc.setTextColor(...H.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 24, 24);
  };

  const drawSubtitleLines = (startY, lines) => {
    const lineH = 12;
    const totalH = lines.length * lineH + 10;
    doc.setFillColor(...H.primary);
    doc.rect(0, startY, pageW, totalH, "F");
    doc.setTextColor(220, 230, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    lines.forEach((line, i) => {
      doc.text(line, 24, startY + 6 + lineH * (i + 0.7));
    });
    return startY + totalH;
  };

  const drawSectionBar = (label, startY, accentRgb) => {
    doc.setFillColor(...accentRgb);
    doc.rect(0, startY, pageW, 16, "F");
    doc.setTextColor(...H.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, 24, startY + 11);
    return startY + 16;
  };

  // Cover / contents page
  const drawCoverPage = () => {
    drawTitleBar("KPI Dashboard Report");

    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    doc.setTextColor(220, 230, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const todayLabel = `Generated ${today}`;
    doc.text(todayLabel, pageW - 24 - doc.getTextWidth(todayLabel), 24);

    let y = 110;
    doc.setTextColor(...H.primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(38);
    const bigPeriod = `${monthLabel(filters?.month) ?? ""} ${filters?.year ?? ""}`.trim() || "KPI Report";
    doc.text(bigPeriod, 36, y);

    y += 26;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...H.gray700);
    const subPieces = [];
    if (filters?.source)    subPieces.push(filters.source);
    if (filters?.structure) subPieces.push(filters.structure);
    if (subPieces.length > 0) doc.text(subPieces.join("   ·   "), 36, y);

    if (filters?.compareMode && filters?.cmpYear && filters?.cmpMonth) {
      y += 22;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...H.compareB);
      doc.text(`Compared with  ${monthLabel(filters.cmpMonth)} ${filters.cmpYear}`, 36, y);
    }

    if (Array.isArray(filters?.companies) && filters.companies.length > 0) {
      y += 32;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...H.gray500);
      doc.text("COMPANIES IN THIS REPORT", 36, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...H.primary);
      const compText = filters.companies.join("   ·   ");
      const split = doc.splitTextToSize(compText, pageW - 72);
      split.forEach(line => { doc.text(line, 36, y); y += 13; });
    }

    // Contents
    y = Math.max(y + 40, pageH * 0.58);
    doc.setFillColor(...H.primary);
    doc.rect(36, y - 12, 3, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...H.primary);
    doc.text("CONTENTS", 46, y);
    y += 24;

    const tocItems = [];
    if (companyCodes && companyCodes.length > 0)     tocItems.push({ label: "Company KPIs",     desc: "YTD + Monthly Delta per company, with compare period" });
    if (dimensionCodes && dimensionCodes.length > 0) tocItems.push({ label: "Dimension KPIs",   desc: "YTD + Monthly Delta per dimension, with compare period" });
    if (graphSections && graphSections.length > 0) {
      graphSections.forEach(s => tocItems.push({
        label: `Graphs — Section ${s.sectionId}`,
        desc:  `${s.company || "—"}  ·  ${s.compareMode ? "with compare overlay" : "primary period"}`,
      }));
    }
    if (exportOpts.defsSheet !== false) tocItems.push({ label: "KPI Definitions", desc: "Formulas, variables, benchmark ranges" });

    tocItems.forEach((it, idx) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...H.gray400);
      doc.text(String(idx + 1).padStart(2, "0"), 36, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...H.primary);
      doc.text(it.label, 70, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...H.gray500);
      doc.text(it.desc, 70, y + 13);
      doc.setDrawColor(230, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(36, y + 22, pageW - 36, y + 22);
      y += 34;
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...H.gray400);
    doc.text("Konsolidator", 24, pageH - 18);
  };

const renderMatrixTable = (cols, colLabels, resultsMap, cmpResultsMap, startY, kList = kpiList, varsMap = null) => {
    const useCmp = cmpResultsMap != null;

const _kListForAgg = kList;
    const kpiAggregates = _kListForAgg.map(kpi => {
      const allVals = cols.map(col => {
        const res = resultsMap?.get(col);
        if (!res) return null;
        const v = res.get(kpi.id);
        return Number.isFinite(v) ? v : null;
      }).filter(v => v !== null);
      const raw = allVals.length === 0 ? null
        : kpi.format === "percent"
          ? allVals.reduce((a,b) => a+b, 0) / allVals.length
          : allVals.reduce((a,b) => a+b, 0);
      return Number.isFinite(raw) ? raw : null;
    });

const renderChunk = (chunkCols, chunkLabels, sY) => {
      const _kList = kList;
      const _varsMap = varsMap;
      const nCols = chunkCols.length;
      let head, body;
      const totalAvgIdx = 1 + nCols * (useCmp ? 4 : 1);
      const benchUnIdx  = totalAvgIdx + 1;
      const benchHeIdx  = totalAvgIdx + 2;
      const benchVHIdx  = totalAvgIdx + 3;

      if (useCmp) {
        const headSuper = [
          { content: "KPI", rowSpan: 2, styles: { halign: "left", valign: "middle", fillColor: H.primary, textColor: H.white, fontStyle: "bold", fontSize: 7.5 } },
        ];
        chunkLabels.forEach(l => {
          headSuper.push({ content: l, colSpan: 4, styles: { halign: "center", valign: "middle", fillColor: H.primary, textColor: H.white, fontStyle: "bold", fontSize: 7.5 } });
        });
        headSuper.push({ content: "Total/Avg", rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.primary, textColor: H.white, fontStyle: "bold", fontSize: 7 } });
        headSuper.push({ content: "Unhealthy", rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.benchUnHd, textColor: H.white, fontStyle: "bold", fontSize: 7 } });
        headSuper.push({ content: "Healthy",   rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.benchHeHd, textColor: H.white, fontStyle: "bold", fontSize: 7 } });
        headSuper.push({ content: "Excellent", rowSpan: 2, styles: { halign: "center", valign: "middle", fillColor: H.benchVHHd, textColor: H.white, fontStyle: "bold", fontSize: 7 } });

        // Sub-row: A / Cmp / DIFF / DIFF % — no Greek (jsPDF helvetica can't render it)
        const headSub = [];
        chunkCols.forEach(() => {
          headSub.push({ content: "A",       styles: { halign: "center", valign: "middle", fillColor: H.primary,   textColor: H.white, fontStyle: "bold", fontSize: 6.5 } });
          headSub.push({ content: "Cmp",     styles: { halign: "center", valign: "middle", fillColor: H.compareB,  textColor: H.white, fontStyle: "bold", fontSize: 6.5 } });
          headSub.push({ content: "DIFF",    styles: { halign: "center", valign: "middle", fillColor: H.primaryDk, textColor: H.white, fontStyle: "bold", fontSize: 6.5 } });
          headSub.push({ content: "DIFF %",  styles: { halign: "center", valign: "middle", fillColor: H.primaryDk, textColor: H.white, fontStyle: "bold", fontSize: 6.5 } });
        });

        head = [headSuper, headSub];

body = [];
_kList.forEach((kpi) => {
          const ki = _kListForAgg.indexOf(kpi);
          const row = [`${kpi.label}  [${kpiTypeBadge(kpi)}]`];
          chunkCols.forEach(col => {
            const aRes = resultsMap?.get(col);
            const cRes = cmpResultsMap?.get(col);
            const aVal = aRes ? aRes.get(kpi.id) : null;
            const cVal = cRes ? cRes.get(kpi.id) : null;
            const a = Number.isFinite(aVal) ? aVal : null;
            const c = Number.isFinite(cVal) ? cVal : null;
            const delta = (a !== null && c !== null) ? a - c : null;
            const dPct  = (a !== null && c !== null && kpi.format !== "percent" && Math.abs(c) > 1e-9) ? ((a - c) / Math.abs(c)) * 100 : null;
            row.push(a === null ? "—" : fmtValue(a, kpi.format));
            row.push(c === null ? "—" : fmtValue(c, kpi.format));
            row.push(!Number.isFinite(delta) ? "—" : fmtValue(delta, kpi.format));
            row.push(!Number.isFinite(dPct)  ? "—" : `${dPct > 0 ? "+" : ""}${dPct.toFixed(1)}%`);
          });
          const agg = ki >= 0 ? kpiAggregates[ki] : null;
          row.push(agg === null ? "—" : fmtValue(agg, kpi.format));
          row.push(fmtBenchRange(kpi.benchmark?.unhealthy));
          row.push(fmtBenchRange(kpi.benchmark?.healthy));
          row.push(fmtBenchRange(kpi.benchmark?.vhealthy));
          row._kpiId = kpi.id;
          body.push(row);

          // Variable sub-rows for traceability (works for text and AST formulas)
          const flat = flattenFormulaToTextForm(kpi.formula);
          if (flat && flat.variables) {
            const letters = Object.keys(flat.variables).sort();
            letters.forEach(L => {
              const desc = describeFormulaNode(flat.variables[L], kListForRefs, accountCodeLabels);
              const subRow = [`    ${L} = ${desc}`];
              chunkCols.forEach(col => {
                const v = _varsMap?.get(col)?.get(kpi.id)?.get(L);
                subRow.push(Number.isFinite(v) ? fmtValue(v, "") : "—");
                subRow.push(""); subRow.push(""); subRow.push("");
              });
              subRow.push(""); subRow.push(""); subRow.push(""); subRow.push("");
              subRow._isVarRow = true;
              body.push(subRow);
            });
          }
        });
      } else {
        head = [["KPI", ...chunkLabels, "Total/Avg", "Unhealthy", "Healthy", "Excellent"]];
        body = [];
_kList.forEach((kpi) => {
          const ki = _kListForAgg.indexOf(kpi);
          const vals = chunkCols.map(col => {
            const res = resultsMap?.get(col);
            if (!res) return null;
            const v = res.get(kpi.id);
            return Number.isFinite(v) ? v : null;
          });
          const row = [`${kpi.label}  [${kpiTypeBadge(kpi)}]`];
          vals.forEach(v => row.push(v === null ? "—" : fmtValue(v, kpi.format)));
          const agg = ki >= 0 ? kpiAggregates[ki] : null;
          row.push(agg === null ? "—" : fmtValue(agg, kpi.format));
          row.push(fmtBenchRange(kpi.benchmark?.unhealthy));
row.push(fmtBenchRange(kpi.benchmark?.healthy));
          row.push(fmtBenchRange(kpi.benchmark?.vhealthy));
          row._kpiId = kpi.id;
          body.push(row);

          // Variable sub-rows (non-cmp branch)
          const flat = flattenFormulaToTextForm(kpi.formula);
          if (flat && flat.variables) {
            const letters = Object.keys(flat.variables).sort();
            letters.forEach(L => {
              const desc = describeFormulaNode(flat.variables[L], kListForRefs, accountCodeLabels);
              const subRow = [`    ${L} = ${desc}`];
              chunkCols.forEach(col => {
                const v = _varsMap?.get(col)?.get(kpi.id)?.get(L);
                subRow.push(Number.isFinite(v) ? fmtValue(v, "") : "—");
              });
              subRow.push(""); subRow.push(""); subRow.push(""); subRow.push("");
              subRow._isVarRow = true;
              body.push(subRow);
            });
          }
        });
      }

      const colStyles = {
        0: { halign: "left", fontStyle: "bold", cellWidth: useCmp ? 95 : 140 },
      };
      if (useCmp) {
        // Explicit widths per sub-cell so the colSpan-4 super-header spans the right area
        chunkCols.forEach((_, ci) => {
          const start = 1 + ci * 4;
          colStyles[start]     = { halign: "right", cellWidth: 40 };
          colStyles[start + 1] = { halign: "right", cellWidth: 40 };
          colStyles[start + 2] = { halign: "right", cellWidth: 36 };
          colStyles[start + 3] = { halign: "right", cellWidth: 32 };
        });
      }
      colStyles[totalAvgIdx] = { cellWidth: useCmp ? 48 : 60, halign: "right" };
      colStyles[benchUnIdx]  = { cellWidth: useCmp ? 38 : 50, halign: "center" };
      colStyles[benchHeIdx]  = { cellWidth: useCmp ? 38 : 50, halign: "center" };
      colStyles[benchVHIdx]  = { cellWidth: useCmp ? 38 : 50, halign: "center" };

      autoTable(doc, {
        head, body, startY: sY,
        theme: "plain",
        styles: { font: "helvetica", fontSize: useCmp ? 6.5 : 7.5, cellPadding: useCmp ? 2 : 3.5, textColor: H.primary, valign: "middle", overflow: "linebreak", lineColor: [235, 237, 244], lineWidth: 0.25 },
        headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "center", fontSize: useCmp ? 7 : 7, valign: "middle", lineColor: [255, 255, 255], lineWidth: 0.5 },
        columnStyles: colStyles,
        alternateRowStyles: { fillColor: H.band2 },
didParseCell: (data) => {
          if (data.section === "body") {
            const rowRaw = data.row.raw;
            const isVarRow = rowRaw && rowRaw._isVarRow;
            if (isVarRow) {
              data.cell.styles.fontSize = (useCmp ? 5.5 : 6.5);
              data.cell.styles.textColor = H.gray500;
              data.cell.styles.fontStyle = "normal";
              data.cell.styles.fillColor = [251, 252, 255];
              if (data.column.index === 0) data.cell.styles.halign = "left";
              return;
            }
            const ci = data.column.index;
            if (ci === 0) return;
            if (ci === benchUnIdx) { data.cell.styles.fillColor = H.benchUnBg; data.cell.styles.textColor = H.benchUnHd; data.cell.styles.halign = "center"; return; }
            if (ci === benchHeIdx) { data.cell.styles.fillColor = H.benchHeBg; data.cell.styles.textColor = H.benchHeHd; data.cell.styles.halign = "center"; return; }
            if (ci === benchVHIdx) { data.cell.styles.fillColor = H.benchVHBg; data.cell.styles.textColor = H.benchVHHd; data.cell.styles.halign = "center"; return; }
            if (ci === totalAvgIdx) {
              data.cell.styles.fillColor = H.highlight; data.cell.styles.halign = "right"; data.cell.styles.fontStyle = "bold";
              const raw = String(data.cell.raw ?? "");
              if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
              return;
            }
            data.cell.styles.halign = "right";
            const raw = String(data.cell.raw ?? "");
            if (useCmp) {
              const subOff = (ci - 1) % 4;
              if (subOff === 1) {
                if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
                else data.cell.styles.textColor = H.compareB;
              } else if (subOff === 2 || subOff === 3) {
                if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
                else if (raw !== "—" && !raw.startsWith("0")) data.cell.styles.textColor = H.green;
              } else {
                if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
              }
            } else {
              if (raw.startsWith("-")) data.cell.styles.textColor = H.red;
            }
          }
        },
      });

      return doc.lastAutoTable.finalY;
    };

    if (!useCmp) {
      return renderChunk(cols, colLabels, startY);
    }

    const CHUNK = 3;
    let y = startY;
    for (let i = 0; i < cols.length; i += CHUNK) {
      const chunkCols   = cols.slice(i, i + CHUNK);
      const chunkLabels = colLabels.slice(i, i + CHUNK);
      if (i > 0) {
        if (y + 110 > pageH) { doc.addPage(); y = 24; }
        else y += 12;
      }
      y = renderChunk(chunkCols, chunkLabels, y);
    }
    return y;
  };

const renderViewSheet = (title, cols, colLabels, resultsBoth, cmpBoth, kList) => {
    drawTitleBar(title);
    let y = drawSubtitleLines(36, buildPdfFilterLines(filters));

    y = drawSectionBar("YTD · Year-to-Date", y + 6, H.primary);
    y = renderMatrixTable(cols, colLabels, resultsBoth.ytd, cmpBoth?.ytd ?? null, y + 4, kList, resultsBoth.ytdVars ?? null);

    if (y + 100 > pageH) {
      doc.addPage();
      y = 16;
    }

    y = drawSectionBar("Monthly · Period Delta", y + 12, H.compareB);
    renderMatrixTable(cols, colLabels, resultsBoth.monthly, cmpBoth?.monthly ?? null, y + 4, kList, resultsBoth.monthlyVars ?? null);
  };

  // ── Render order: Cover → Company → Dimension → Graphs → Definitions ──
  drawCoverPage();

  if (companyCodes && companyCodes.length > 0 && companyResults?.ytd) {
    doc.addPage();
    const labels = (companyLabels && companyLabels.length === companyCodes.length) ? companyLabels : companyCodes;
renderViewSheet("KPI Dashboard — By Company", companyCodes, labels, companyResults, companyResultsCmp, kListCompany);
  }

  if (dimensionCodes && dimensionCodes.length > 0 && dimensionResults?.ytd) {
    doc.addPage();
    const dimLabels = dimensionCodes.map(dc => dimensionPivots?.get(dc)?.name ?? dc);
renderViewSheet("KPI Dashboard — By Dimension", dimensionCodes, dimLabels, dimensionResults, dimensionResultsCmp, kListDimension);
  }

  if (graphSections && graphSections.length > 0) {
    const PDF_CMP_BG = { B: [207, 48, 93], C: [16, 185, 129] };
    for (const section of graphSections) {
      const { sectionId, company, ytdData, ytdImg, monthlyData, monthlyImg, series } = section;
      const seriesList = Array.isArray(series) ? series : [];
      doc.addPage();
      drawTitleBar(`Graphs — Section ${sectionId} · ${company || "—"}`);
      // Graph pages get section-scoped filters, not the global ones
      let y = drawSubtitleLines(36, buildGraphFilterLines(section));

      const availH = pageH - y - 28;
      const halfH = (availH - 2 * 16 - 10) / 2;
      const imgW = pageW * 0.55 - 36;
      const tableX = pageW * 0.55 + 12;

      const renderTable = (data, sectAccent, sy) => {
        const head = [[
          { content: "Period", styles: { fillColor: sectAccent, textColor: H.white } },
          ...seriesList.map(s => ({
            content: s.label,
            styles: {
              fillColor: s.barId === "a" ? sectAccent : (PDF_CMP_BG[s.barId] ?? sectAccent),
              textColor: H.white,
              halign: "right",
            },
          })),
        ]];
        const body = (data || []).map(d => [
          d.period,
          ...seriesList.map(s => {
            const v = d[s.key];
            return Number.isFinite(v) ? fmtValue(v, s.format) : "—";
          }),
        ]);
        autoTable(doc, {
          head, body, startY: sy,
          margin: { left: tableX, right: 24 },
          theme: "plain",
          styles: { font: "helvetica", fontSize: 6, cellPadding: 2, textColor: H.primary, overflow: "linebreak" },
          headStyles: { fontStyle: "bold", fontSize: 6 },
          columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 30 } },
          alternateRowStyles: { fillColor: H.band2 },
          didParseCell: (info) => {
            if (info.section === "body" && info.column.index > 0) {
              info.cell.styles.halign = "right";
              const raw = String(info.cell.raw ?? "");
              if (raw.startsWith("-")) info.cell.styles.textColor = H.red;
            }
          },
        });
      };

      y = drawSectionBar("YTD · Year-to-Date", y + 6, H.primary);
      if (ytdImg) {
        try { doc.addImage(ytdImg, "PNG", 24, y + 4, imgW, halfH - 8); } catch (e) { console.warn("YTD img:", e); }
      }
      renderTable(ytdData, H.primary, y + 4);
      y = y + halfH;

      y = drawSectionBar("Monthly · Period Delta", y + 8, H.compareB);
      if (monthlyImg) {
        try { doc.addImage(monthlyImg, "PNG", 24, y + 4, imgW, halfH - 8); } catch (e) { console.warn("Monthly img:", e); }
      }
      renderTable(monthlyData, H.compareB, y + 4);
    }
  }

  if (exportOpts.defsSheet !== false) {
    doc.addPage();
    drawTitleBar("KPI Definitions · Formulas · Benchmarks");

    const defHead = [["KPI", "Category", "Format", "Formula · Variables", "Benchmark"]];
// Union of both view lists so definitions cover every KPI that showed up.
    const _allKpisForDefs = (() => {
      const seen = new Set();
      const out = [];
      [...kListCompany, ...kListDimension].forEach(k => {
        if (!seen.has(k.id)) { seen.add(k.id); out.push(k); }
      });
      return out;
    })();
    const defBody = _allKpisForDefs.map(kpi => {
      const fSum = kpiFormulaSummary(kpi, kListForRefs, accountCodeLabels);
      const bDesc = describeBenchmark(kpi.benchmark);
      const formulaTxt = [
        fSum.expression ? `Formula: ${fSum.expression}` : null,
        fSum.variables.length > 0 ? fSum.variables.map(v => `${v.letter} = ${v.desc}`).join("\n") : null,
        kpi.description ? `Description: ${kpi.description}` : null,
      ].filter(Boolean).join("\n");
      return [
        `${kpi.label}  [${kpiTypeBadge(kpi)}]`,
        kpi.category ?? "",
        kpi.format ?? "",
        formulaTxt || "—",
        bDesc ?? "—",
      ];
    });

    autoTable(doc, {
      head: defHead, body: defBody,
      startY: 44,
      theme: "plain",
      styles: { font: "helvetica", fontSize: 7, cellPadding: 4, textColor: H.gray700, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: H.primary, textColor: H.white, fontStyle: "bold", halign: "left" },
      columnStyles: {
        0: { fontStyle: "bold", textColor: H.primary, cellWidth: 140 },
        1: { cellWidth: 80 },
        2: { cellWidth: 60 },
        3: { cellWidth: 320 },
        4: { cellWidth: "auto" },
      },
      alternateRowStyles: { fillColor: H.band2 },
    });
  }

  const fname = `Konsolidator_KPIs_${filters?.year ?? ""}_${String(filters?.month ?? "").padStart(2, "0")}.pdf`;
  doc.save(fname);
}

// ── FilterPill ────────────────────────────────────────────────────────────────
function FilterPill({ label, value, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => String(o.value) === String(value))?.label ?? "—";
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
        style={filterStyle}>
        <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
        <span>{display}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {options.map(o => {
              const selected = String(o.value) === String(value);
              return (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
                    ${selected ? "text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
                  style={selected ? { backgroundColor: colors?.primary } : undefined}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formula Node Builder ──────────────────────────────────────────────────────
function NodeBuilder({ node, onChange, onRemove, depth = 0, kpiList, accountCodes, dimCodes }) {
  if (!node || !node.type) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {[
          { t: "accountGroup", label: "Account Group", color: "bg-blue-50 text-blue-700 hover:bg-blue-700 hover:text-white" },
          { t: "account", label: "Single Account", color: "bg-[#eef1fb] text-[#1a2f8a] hover:bg-[#1a2f8a] hover:text-white" },
          { t: "manual", label: "Fixed Number", color: "bg-amber-50 text-amber-700 hover:bg-amber-700 hover:text-white" },
          { t: "ref", label: "KPI Reference", color: "bg-purple-50 text-purple-700 hover:bg-purple-700 hover:text-white" },
          { t: "op", label: "Math Operation", color: "bg-orange-50 text-orange-700 hover:bg-orange-700 hover:text-white" },
          { t: "fn", label: "Function", color: "bg-emerald-50 text-emerald-700 hover:bg-emerald-700 hover:text-white" },
        ].map(({ t, label, color }) => (
          <button key={t} onClick={() => {
            const defaults = {
              accountGroup: { type: "accountGroup", prefix: "" },
              account: { type: "account", accountCode: "" },
              manual: { type: "manual", value: 0 },
              ref: { type: "ref", kpiId: "" },
              op: { type: "op", op: "+", left: null, right: null },
              fn: { type: "fn", fn: "neg", arg: null },
            };
            onChange(defaults[t]);
          }}
            className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all ${color}`}>
            {label}
          </button>
        ))}
      </div>
    );
  }

  const wrap = (children) => (
    <div className={`flex items-start gap-1.5 ${depth > 0 ? "mt-1 pl-3 border-l-2 border-[#eef1fb]" : ""}`}>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">{children}</div>
      {onRemove && (
        <button onClick={onRemove} className="flex-shrink-0 w-5 h-5 rounded-md bg-red-50 text-red-400 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all">
          <X size={9} />
        </button>
      )}
    </div>
  );

  if (node.type === "accountGroup") return wrap(
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">GROUP</span>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-400">prefix</span>
        <input value={node.prefix ?? ""} onChange={e => onChange({ ...node, prefix: e.target.value })}
          placeholder="e.g. 42"
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white w-20" />
      </div>
      <span className="text-[10px] text-gray-300">→ sums all accounts with that prefix</span>
    </div>
  );

  if (node.type === "account") return wrap(
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-[#1a2f8a] bg-[#eef1fb] px-2 py-0.5 rounded-md">ACCOUNT</span>
      <select value={node.accountCode ?? ""} onChange={e => onChange({ ...node, accountCode: e.target.value })}
        className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white max-w-[180px]">
        <option value="">— select account —</option>
        {accountCodes.map(ac => <option key={ac} value={ac}>{ac}</option>)}
      </select>
      {dimCodes.length > 0 && (
        <select value={node.dimCode ?? ""} onChange={e => onChange({ ...node, dimCode: e.target.value || undefined })}
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white max-w-[140px]">
          <option value="">All dimensions</option>
          {dimCodes.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
    </div>
  );

  if (node.type === "manual") return wrap(
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">NUMBER</span>
      <input type="number" value={node.value ?? 0} onChange={e => onChange({ ...node, value: parseFloat(e.target.value) || 0 })}
        className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white w-32" />
    </div>
  );

  if (node.type === "ref") return wrap(
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">KPI REF</span>
      <select value={node.kpiId ?? ""} onChange={e => onChange({ ...node, kpiId: e.target.value })}
        className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white">
        <option value="">— select KPI —</option>
        {kpiList.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>
    </div>
  );

  if (node.type === "fn") return wrap(
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">FUNC</span>
        <select value={node.fn ?? "neg"} onChange={e => onChange({ ...node, fn: e.target.value })}
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white">
          <option value="neg">Negate (−x)</option>
          <option value="abs">Absolute (|x|)</option>
          <option value="pct">To Percent (×100)</option>
        </select>
        <span className="text-[10px] text-gray-400">applied to:</span>
      </div>
      <NodeBuilder node={node.arg} onChange={arg => onChange({ ...node, arg })}
        onRemove={node.arg ? () => onChange({ ...node, arg: null }) : null}
        depth={depth + 1} kpiList={kpiList} accountCodes={accountCodes} dimCodes={dimCodes} />
    </>
  );

  if (node.type === "op") return wrap(
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-black text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md">OPERATION</span>
        <select value={node.op ?? "+"} onChange={e => onChange({ ...node, op: e.target.value })}
          className="text-[10px] border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white">
          <option value="+">Add (+)</option>
          <option value="-">Subtract (−)</option>
          <option value="*">Multiply (×)</option>
          <option value="/">Divide (÷)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 pl-2">
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5 block">Left operand</span>
          <NodeBuilder node={node.left} onChange={left => onChange({ ...node, left })}
            onRemove={node.left ? () => onChange({ ...node, left: null }) : null}
            depth={depth + 1} kpiList={kpiList} accountCodes={accountCodes} dimCodes={dimCodes} />
        </div>
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5 block">Right operand</span>
          <NodeBuilder node={node.right} onChange={right => onChange({ ...node, right })}
            onRemove={node.right ? () => onChange({ ...node, right: null }) : null}
            depth={depth + 1} kpiList={kpiList} accountCodes={accountCodes} dimCodes={dimCodes} />
        </div>
      </div>
    </>
  );

  return null;
}

// ── KPI Editor Modal ──────────────────────────────────────────────────────────
const PRESETS = [
  { label: "Account Group sum",          formula: { type: "text", expression: "A",           variables: { A: null } } },
  { label: "Single account",             formula: { type: "text", expression: "A",           variables: { A: null } } },
  { label: "A ÷ B (ratio/margin)",       formula: { type: "text", expression: "A / B",       variables: { A: null, B: null } } },
  { label: "A − B (variance)",           formula: { type: "text", expression: "A - B",       variables: { A: null, B: null } } },
  { label: "(A ÷ B) × 100 (percent)",    formula: { type: "text", expression: "(A / B) * 100", variables: { A: null, B: null } } },
  { label: "Negate value (−A)",          formula: { type: "text", expression: "-A",          variables: { A: null } } },
  { label: "KPI reference",              formula: { type: "text", expression: "A",           variables: { A: null } } },
  { label: "Fixed number",               formula: { type: "text", expression: "0",           variables: {} } },
];

function buildLibrarySections(tt) {
  const mk = (id, refKpiId, format, category) => ({
    id,
    label:       tt(`kpilib_${id.replace(/^_lib_/, "")}_label`),
    description: tt(`kpilib_${id.replace(/^_lib_/, "")}_desc`),
    benchmark:   tt(`kpilib_${id.replace(/^_lib_/, "")}_bench`),
    format,
    category,
    formula:     refKpiId ? { type: "ref", kpiId: refKpiId } : { type: "op", op: "/", left: null, right: null },
  });
  const mkPct = (id, leftRef, rightRef, format, category) => ({
    id,
    label:       tt(`kpilib_${id.replace(/^_lib_/, "")}_label`),
    description: tt(`kpilib_${id.replace(/^_lib_/, "")}_desc`),
    benchmark:   tt(`kpilib_${id.replace(/^_lib_/, "")}_bench`),
    format,
    category,
    formula:     { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: { type: "ref", kpiId: leftRef }, right: { type: "ref", kpiId: rightRef } } },
  });
  const mkMkt = (id) => ({
    id: `_lib_mkt_${id}`,
    label:       tt(`kpilib_mkt_${id}_label`),
    description: tt(`kpilib_mkt_${id}_desc`),
    benchmark:   tt(`kpilib_mkt_${id}_bench`),
    format:      id === "dividend_yield" ? "percent" : "number",
    category:    tt("kpilib_section_mercado_label"),
    formula:     id === "dividend_yield"
      ? { type: "fn", fn: "pct", arg: { type: "op", op: "/", left: null, right: null } }
      : { type: "op", op: "/", left: null, right: null },
  });

  const liquidez = tt("kpilib_section_liquidez_label");
  const solvencia = tt("kpilib_section_solvencia_label");
  const rentabilidad = tt("kpilib_section_rentabilidad_label");
  const eficiencia = tt("kpilib_section_eficiencia_label");

  return [
    {
      key: "liquidez", label: liquidez, color: "bg-emerald-700",
      kpis: [
        mk("_lib_current_ratio",    "current_ratio",     "number",   liquidez),
        mk("_lib_quick_ratio",      "quick_ratio",       "number",   liquidez),
        mk("_lib_cash_ratio",       "cash_ratio",        "number",   liquidez),
        mk("_lib_working_capital",  "working_capital",   "currency", liquidez),
      ],
    },
    {
      key: "solvencia", label: solvencia, color: "bg-blue-700",
      kpis: [
        mk("_lib_debt_ratio",         "debt_ratio",         "percent", solvencia),
        mk("_lib_debt_to_equity",     "debt_to_equity",     "number",  solvencia),
        mk("_lib_net_debt_ebitda",    "net_debt_to_ebitda", "number",  solvencia),
        mk("_lib_interest_coverage",  null,                 "number",  solvencia),
      ],
    },
    {
      key: "rentabilidad", label: rentabilidad, color: "bg-[#1a2f8a]",
      kpis: [
        mkPct("_lib_gross_margin", "gross_profit", "revenue",      "percent",  rentabilidad),
        mkPct("_lib_ebit_margin",  "ebit",         "revenue",      "percent",  rentabilidad),
        mkPct("_lib_net_margin",   "net_result",   "revenue",      "percent",  rentabilidad),
        mkPct("_lib_roa",          "net_result",   "total_assets", "percent",  rentabilidad),
        mkPct("_lib_roe",          "net_result",   "total_equity", "percent",  rentabilidad),
        mk("_lib_ebitda", "ebitda", "currency", rentabilidad),
        mk("_lib_ebit",   "ebit",   "currency", rentabilidad),
      ],
    },
    {
      key: "eficiencia", label: eficiencia, color: "bg-amber-600",
      kpis: [
        mk("_lib_asset_turnover", "asset_turnover", "number", eficiencia),
        mk("_lib_dio",            "inventory_days", "number", eficiencia),
        mk("_lib_dso",            "dso",            "number", eficiencia),
        mk("_lib_dpo",            "dpo",            "number", eficiencia),
      ],
    },
    {
      key: "mercado", label: tt("kpilib_section_mercado_label"), color: "bg-rose-800",
      kpis: [
        mkMkt("eps"),
        mkMkt("pe"),
        mkMkt("pbv"),
        mkMkt("dividend_yield"),
        mkMkt("ev_ebitda"),
      ],
    },
  ];
}

function LibraryPicker({ onSave, onDuplicate }) {
  const { locale } = useSettings();
  const tt = (k, fb) => t(locale, k, fb);
  const LIBRARY_SECTIONS = useMemo(() => buildLibrarySections(tt), [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeSection, setActiveSection] = useState(null);

  if (!activeSection) {
    const SECTION_META = {
      liquidez:      { icon: "💧", hint: tt("kpilib_section_liquidez_hint") },
      solvencia:     { icon: "🏦", hint: tt("kpilib_section_solvencia_hint") },
      rentabilidad:  { icon: "📈", hint: tt("kpilib_section_rentabilidad_hint") },
      eficiencia:    { icon: "⚙️", hint: tt("kpilib_section_eficiencia_hint") },
      mercado:       { icon: "📊", hint: tt("kpilib_section_mercado_hint") },
    };

// DESPUÉS — añade la tarjeta custom al final del grid:
return (
  <div className="overflow-y-auto flex-1 p-5">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">{tt("kpilib_pick_category")}</p>
    <div className="grid grid-cols-2 gap-3">
      {LIBRARY_SECTIONS.map(sec => {
        const meta = SECTION_META[sec.key] ?? {};
        return (
<button key={sec.key} onClick={() => setActiveSection(sec.key)}
            className="text-left p-5 rounded-2xl border border-gray-100 hover:border-[#1a2f8a]/25 hover:shadow-md transition-all group bg-white hover:bg-[#f8f9ff]">
            <div className="flex items-start justify-between gap-2 mb-4">
              <span className="text-3xl leading-none inline-block group-hover:scale-110 transition-transform duration-200">{meta.icon}</span>
              <span className="text-[10px] font-black text-gray-300 group-hover:text-[#1a2f8a]/40 transition-colors">
                {sec.kpis.length} {tt("kpilib_indicators")}
              </span>
            </div>
            <p className="text-sm font-black text-[#1a2f8a] mb-1.5">{sec.label}</p>
            <p className="text-xs text-gray-400 leading-snug">{meta.hint}</p>
          </button>
        );
      })}

{/* Custom KPI card */}
<button onClick={() => onSave("__custom__")}
className="text-left p-5 rounded-2xl border border-gray-100 hover:border-[#1a2f8a]/25 hover:shadow-md transition-all group bg-white hover:bg-[#f8f9ff]">
        <div className="flex items-start justify-between gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1a2f8a] to-[#4f63c2] flex items-center justify-center flex-shrink-0 shadow-md shadow-[#1a2f8a]/20 group-hover:scale-110 transition-transform">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 4v10M4 9h10" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    </div>
    <span className="text-[9px] font-black text-gray-300 group-hover:text-[#1a2f8a]/40 transition-colors">
      {tt("kpilib_from_scratch")}
    </span>
  </div>
  <p className="text-xs font-black text-[#1a2f8a] mb-1">{tt("kpi_custom_kpi")}</p>
  <p className="text-[10px] text-gray-400 leading-snug">{tt("kpilib_custom_desc")}</p>
</button>
    </div>
  </div>
);
  }

  const sec = LIBRARY_SECTIONS.find(s => s.key === activeSection);
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
<button onClick={() => setActiveSection(null)}
          className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 hover:text-[#1a2f8a] transition-colors">
          <ChevronDown size={11} className="rotate-90" /> {tt("drill_back")}
        </button>
        <span className="text-[10px] text-gray-300">·</span>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md text-white ${sec.color}`}>{sec.label}</span>
      </div>
      <div className="overflow-y-auto flex-1 px-5 pb-5 grid grid-cols-2 gap-2 content-start">
        {sec.kpis.map((k, i) => (
<div key={i} className="relative group">
            <button onClick={() => onSave({ ...k, _fromLibrary: true })}
              className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb] transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-[#1a2f8a] leading-snug">{k.label}</p>
                  <p className="text-xs text-gray-700 mt-1 leading-snug">{k.description}</p>
                </div>
                <span className={`flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-md ${k.format === "percent" ? "bg-emerald-50 text-emerald-700" : k.format === "currency" ? "bg-[#eef1fb] text-[#1a2f8a]" : "bg-gray-50 text-gray-500"}`}>
                  {k.format === "percent" ? "%" : k.format === "currency" ? "€" : "#"}
                </span>
              </div>
              {k.benchmark && (
                <p className="text-[10px] text-gray-600 mt-2 italic">{k.benchmark}</p>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate?.({ ...k, label: k.label + " 2" }); }}
              className="absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
              style={{ background: "#eef1fb", color: "#1a2f8a" }}
              title="Duplicate">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchableList({ items, value, onChange, placeholder = "Buscar..." }) {
  const [search, setSearch] = useState("");
  const filtered = items.filter(i =>
    i.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-[#f8f9ff] pr-7"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <X size={10} />
          </button>
        )}
      </div>
     <div className="max-h-[55vh] overflow-y-auto flex flex-col gap-0.5 border border-gray-100 rounded-xl bg-white">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
        ) : filtered.map(item => (
          <button key={item} onClick={() => onChange(item)}
            className={`text-left px-3 py-2 text-xs transition-all flex items-center justify-between ${value === item ? "bg-[#1a2f8a] text-white font-black" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a] font-medium"}`}>
            {item}
            {value === item && <Check size={10} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiRefPicker({ kpiList, kpiId, setKpiId, builtInIds }) {
  const [search, setSearch] = useState("");
  const filtered = kpiList.filter(k =>
    !search.trim() || k.label.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar KPI..."
          className="w-full rounded-xl px-3 py-2 text-xs text-gray-700 outline-none pr-7"
          style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300"><X size={10} /></button>}
      </div>
<div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
        ) : filtered.map(k => {
          const isSystem = builtInIds?.has(k.id);
          const selected = kpiId === k.id;
          return (
<button key={k.id} onClick={() => setKpiId(k.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all border-b border-gray-50 last:border-0"
              style={{ background: selected ? "#eef1fb" : "transparent", color: selected ? "#1a2f8a" : "#374151" }}
              onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#f8f9ff"; }}
              onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: isSystem ? "#1a2f8a" : "#16a34a" }} />
              <span className="flex-1 font-semibold text-xs truncate">{k.label}</span>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-lg flex-shrink-0"
                style={{ background: isSystem ? "#eef1fb" : "#dcfce7", color: isSystem ? "#1a2f8a" : "#15803d" }}>
                {isSystem ? "sistema" : "custom"}
              </span>
              {selected && <Check size={11} className="flex-shrink-0 text-[#1a2f8a]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccountPicker({ items, value, onChange, dimsByAccount = new Map() }) {
  const [search, setSearch] = useState("");
  const [expandedDims, setExpandedDims] = useState(new Set());

  // value can be "code" or "code:::dimGroup:::dimCode"
  const selectedCode = value?.split(":::")?.[0] ?? value;

  const filtered = items.filter(i =>
    !search.trim() || i.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="relative">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cuenta..."
          className="w-full rounded-xl px-3 py-2 text-xs text-gray-700 outline-none pr-7"
          style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300"><X size={10} /></button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-300 text-center py-4">Sin resultados</p>
        ) : filtered.map(item => {
          const isSelected = selectedCode === item.code && !value?.includes(":::");
          const [code, ...nameParts] = item.label.split(" — ");
          const name = nameParts.join(" — ");
          const dims = dimsByAccount.get(item.code) ?? [];
          const hasDims = dims.length > 0;
          const isDimExpanded = expandedDims.has(item.code);

          return (
            <div key={item.code} className="border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-1">
                <button onClick={() => onChange(item.code)}
                  className="flex-1 text-left px-4 py-3 flex items-center gap-3 transition-all"
                  style={{ background: isSelected ? "#eef1fb" : "transparent" }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f8f9ff"; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                  <span className="font-mono font-black text-[#1a2f8a] flex-shrink-0 w-16 text-xs">{code}</span>
                  {name && <span className="flex-1 text-gray-600 text-xs">{name}</span>}
                  {hasDims && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-black"
                      style={{ background: "#fef3c7", color: "#d97706" }}>
                      dims
                    </span>
                  )}
                  {isSelected && <Check size={11} className="flex-shrink-0 text-[#1a2f8a]" />}
                </button>
                {hasDims && (
                  <button onClick={() => setExpandedDims(prev => {
                    const next = new Set(prev);
                    next.has(item.code) ? next.delete(item.code) : next.add(item.code);
                    return next;
                  })}
                    className="px-2 py-3 text-gray-400 hover:text-amber-600 transition-colors flex-shrink-0"
                    title="Ver dimensiones">
                    <ChevronDown size={11} className={`transition-transform ${isDimExpanded ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>
              {isDimExpanded && hasDims && dims.map((d, di) => {
                const dimKey = `${item.code}:::${d.group}:::${d.code}`;
                const isDimSelected = value === dimKey;
                return (
                  <button key={di} onClick={() => onChange(dimKey)}
                    className="w-full text-left flex items-center gap-2 py-2 transition-all"
                    style={{
                      paddingLeft: 48, paddingRight: 16,
                      background: isDimSelected ? "#fef3c7" : "transparent"
                    }}
                    onMouseEnter={e => { if (!isDimSelected) e.currentTarget.style.background = "#fffbeb"; }}
                    onMouseLeave={e => { if (!isDimSelected) e.currentTarget.style.background = "transparent"; }}>
                    <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                    <span className="text-[9px] font-black uppercase tracking-wider text-amber-500 flex-shrink-0">{d.group}:</span>
                    <span className="text-xs text-gray-600 flex-1">{d.name || d.code}</span>
                    {isDimSelected && <Check size={10} className="flex-shrink-0 text-amber-600" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}



function PartyPicker({ parties, partyContext, evalPartyValue, value, onChange }) {
  const [search, setSearch] = useState("");
  // Filter to parties applicable to the current KPI page context:
  //  1. Selected company must be in the party's `companies`
  //  2. Selected year must be in the party's `years`
  //  3. At least one currently-selected dim must be in the party's `dims`
  //     (if no dims selected, all party dims count)
  const applicable = useMemo(() => {
    if (!partyContext) return parties;
    const { company, year, selectedDims } = partyContext;
    return parties.filter(p => {
      if (company && p.companies?.length && !p.companies.includes(company)) return false;
      if (year && p.years?.length && !p.years.includes(String(year))) return false;
      if (selectedDims && selectedDims.size > 0) {
        return p.dims?.some(d => selectedDims.has(d));
      }
      return true;
    });
  }, [parties, partyContext]);

  const filtered = search.trim()
    ? applicable.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.unit.toLowerCase().includes(search.toLowerCase()))
    : applicable;

  const fmtVal = (n) => typeof n === "number"
    ? n.toLocaleString("de-DE", { maximumFractionDigits: 2 })
    : "—";

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50">
        <Search size={12} className="text-gray-400" />
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar partida..."
          className="text-sm outline-none bg-transparent flex-1"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto border border-gray-100 rounded-xl">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-400">
            {applicable.length === 0
              ? "No hay partidas aplicables al filtro actual (empresa, periodo, dimensiones)"
              : "Sin resultados"}
          </div>
       ) : filtered.map((p) => {
          const selected = value === p.id;
          const preview = evalPartyValue ? evalPartyValue(p.id) : null;
          return (
            <button key={p.id}
              onClick={() => onChange(p.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-100 last:border-b-0"
              style={{ background: selected ? "#ecfdf5" : "transparent" }}
              onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#f9fafb"; }}
              onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: selected ? "#059669" : "#d1fae5", color: selected ? "white" : "#059669" }}>
                <span className="text-sm font-black">◆</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900 truncate">{p.name}</p>
                <p className="text-[10px] font-bold text-gray-400 mt-0.5">
                  {p.dims.length} dims{p.unit ? ` · ${p.unit}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Valor</span>
                <span className="text-sm font-black tabular-nums" style={{ color: "#047857" }}>
                  {fmtVal(preview)}
                </span>
              </div>
              {selected && <Check size={12} className="text-emerald-600 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotPicker({ onSelect, onClose, kpiList, accountCodes, localAccounts = [], groupAccountsList = [], accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), localDimsByAccount = new Map(), parties = [], partyContext = null, evalPartyValue = null }) {
  const [step, setStep] = useState("type");
  const [type, setType] = useState(null);
  const [prefix, setPrefix] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [kpiId, setKpiId] = useState("");
  const [partyId, setPartyId] = useState("");

  // derive group prefixes from accountCodes (unique 1-2 char prefixes)
  const groupPrefixes = useMemo(() => {
    const seen = new Set();
    accountCodes.forEach(ac => {
      for (let len = 1; len <= 4; len++) {
        const p = ac.slice(0, len);
        if (accountCodes.filter(c => c.startsWith(p)).length > 1) seen.add(p);
      }
    });
    return [...seen].sort();
  }, [accountCodes]);
const TYPES = [
    { id: "accountGroup", label: "Cuenta de grupo", desc: "Suma todas las cuentas locales bajo esta cuenta de grupo", color: "bg-blue-50 text-blue-700 border-blue-200" },
    { id: "account",      label: "Cuenta local", desc: "Cuenta de contabilización individual",   color: "bg-[#eef1fb] text-[#1a2f8a] border-[#1a2f8a]/20" },
    { id: "ref",          label: "KPI existente",     desc: "Referencia a otro KPI calculado", color: "bg-purple-50 text-purple-700 border-purple-200" },
    { id: "party",        label: "Partida estadística", desc: "Empleados, superficie, u otras métricas no financieras", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ];

const confirm = () => {
    if (type === "accountGroup") {
      if (prefix.includes(":::")) {
        const [gc, dimGroup, dimCode] = prefix.split(":::");
        const dimEntry = dimsByAccount.get(gc)?.find(d => d.group === dimGroup && d.code === dimCode);
        onSelect({
          type: "accountGroup",
          groupCode: gc, prefix: gc,
          dimGroup: dimGroup || undefined,
          dimCode:  dimCode  || undefined,
          dimName:  dimEntry?.name || dimCode || undefined,
        });
      } else {
        onSelect({ type: "accountGroup", groupCode: prefix, prefix });
      }
    }
    else if (type === "account") {
if (accountCode.includes(":::")) {
        const [ac, dimGroup, dimCode] = accountCode.split(":::");
        const dimEntry = dimsByAccount.get(ac)?.find(d => d.group === dimGroup && d.code === dimCode);
        onSelect({ type: "account", accountCode: ac, dimGroup: dimGroup || undefined, dimCode: dimCode || undefined, dimName: dimEntry?.name || dimCode || undefined });
      } else {
        onSelect({ type: "account", accountCode });
      }
    }
    else if (type === "ref")      onSelect({ type: "ref", kpiId });
    else if (type === "party") {
      const p = parties.find(pp => pp.id === partyId);
      onSelect({ type: "party", partyId, partyName: p?.name });
    }
    onClose();
  };

return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />
<div className="relative flex flex-col bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
        style={{ boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25)", height: "90vh", maxHeight: "90vh" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {step === "detail" && (
              <button onClick={() => setStep("type")}
                className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                style={{ background: "#f3f4f6", color: "#6b7280" }}>
                <ChevronDown size={12} className="rotate-90" />
              </button>
            )}
            <div>
              <p className="font-black text-[14px] text-gray-900 leading-tight">
                {step === "type" ? "Tipo de variable" : TYPES.find(t => t.id === type)?.label}
              </p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                {step === "type" ? "Selecciona cómo calcular esta variable" : TYPES.find(t => t.id === type)?.desc}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "#f3f4f6", color: "#6b7280" }}>
            <X size={12} />
          </button>
        </div>

        <div className="h-px mx-5" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />

{step === "type" && (
          <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
{[
              { id: "accountGroup", label: "Cuenta de grupo", desc: "Suma todas las cuentas locales bajo esta cuenta de grupo", icon: "Σ", iconBg: "#dbeafe", iconColor: "#1d4ed8" },
              { id: "account",      label: "Cuenta local", desc: "Cuenta de contabilización individual", icon: "#", iconBg: "#eef1fb", iconColor: "#1a2f8a" },
              { id: "ref",          label: "KPI existente",     desc: "Referencia a otro KPI calculado", icon: "↗", iconBg: "#f3e8ff", iconColor: "#7c3aed" },
              { id: "party",        label: "Partida estadística", desc: "Empleados, superficie, u otras métricas no financieras", icon: "◆", iconBg: "#d1fae5", iconColor: "#047857" },
            ].map((t) => (
              <button key={t.id} onClick={() => { setType(t.id); setStep("detail"); }}
                className="text-left rounded-2xl border transition-all duration-200 group flex-1 flex items-center"
                style={{ background: "#f8f9ff", borderColor: "#e8eaf0", padding: "24px 24px" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#1a2f8a30"; e.currentTarget.style.background = "#fff"; e.currentTarget.style.boxShadow = "0 4px 20px -4px rgba(26,47,138,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e8eaf0"; e.currentTarget.style.background = "#f8f9ff"; e.currentTarget.style.boxShadow = "none"; }}>
                <div className="flex items-center gap-4 w-full">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl font-black transition-transform duration-200 group-hover:scale-110"
                    style={{ background: t.iconBg, color: t.iconColor }}>
                    {t.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-900 text-base leading-tight">{t.label}</p>
                    <p className="text-xs text-gray-400 mt-1">{t.desc}</p>
                  </div>
                  <ChevronDown size={16} className="-rotate-90 text-gray-300 group-hover:text-[#1a2f8a] transition-colors flex-shrink-0" />
                </div>
              </button>
))}
          </div>
        )}

{step === "detail" &&(
          <div className="p-5 flex flex-col gap-4 flex-1 min-h-0">
<div className="flex-1 min-h-0 overflow-hidden flex flex-col">
{type === "accountGroup" && (() => {
              const items = (groupAccountsList.length > 0 ? groupAccountsList : []).map(g => ({
                code: g.code,
                label: g.name ? `${g.code} — ${g.name}${g.isSum ? "  ·  sum" : ""}` : g.code,
              }));
              if (items.length === 0) {
                return (
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] text-gray-400 leading-snug bg-blue-50 px-3 py-2 rounded-xl">
                      No hay cuentas de grupo cargadas. Usa un prefijo como fallback.
                    </p>
                    <SearchableList items={groupPrefixes} value={prefix} onChange={setPrefix} placeholder="Buscar prefijo..." />
                  </div>
                );
              }
              return (
                <AccountPicker
                  items={items}
                  value={prefix}
                  onChange={setPrefix}
                  dimsByAccount={dimsByAccount}
                />
              );
            })()}
{type === "account" && (() => {
              const source = localAccounts.length > 0
                ? localAccounts
                : accountCodes.map(c => ({ code: c, name: accountCodeLabels.get(c) ?? "" }));
              const items = source.map(({ code, name }) => ({
                code,
                label: name ? `${code} — ${name}` : code,
              }));
              return (
                <AccountPicker
                  items={items}
                  value={accountCode}
                  onChange={setAccountCode}
                  dimsByAccount={localDimsByAccount}
                />
              );
            })()}
{type === "ref" && (
              <KpiRefPicker kpiList={kpiList} kpiId={kpiId} setKpiId={setKpiId} builtInIds={builtInIds} />
            )}
{type === "party" && (
              <PartyPicker parties={parties} partyContext={partyContext} evalPartyValue={evalPartyValue} value={partyId} onChange={setPartyId} />
            )}
</div>
            <button onClick={confirm}
             disabled={(type === "accountGroup" && !prefix) || (type === "account" && !accountCode.split(":::")[0]) || (type === "ref" && !kpiId) || (type === "party" && !partyId)}
              className="w-full py-3 rounded-xl text-white text-sm font-black transition-all disabled:opacity-30 flex items-center justify-center gap-2 flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "0 6px 20px -4px rgba(26,47,138,0.45)" }}>
              <Check size={14} /> Confirmar selección
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SlotLabel({ node, kpiList, accountCodeLabels = new Map(), dimsByAccount = new Map() }) {
  if (!node) return <span className="text-gray-300 italic">vacío</span>;
if (node.type === "accountGroup") {
    // Legacy nodes stored the whole "code:::dimGroup:::dimCode" string inside
    // groupCode/prefix. Detect and split so we can render nicely.
    let code   = node.groupCode ?? node.prefix ?? "?";
    let dimGroup = node.dimGroup;
    let dimCode  = node.dimCode;
    let dimName  = node.dimName;
    if (code.includes(":::") && !dimGroup && !dimCode) {
      const [gc, dg, dc] = code.split(":::");
      code = gc; dimGroup = dg || undefined; dimCode = dc || undefined;
    }
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : code;
if (dimGroup || dimCode) {
      const entry = dimsByAccount.get(code)?.find(d => d.group === dimGroup && d.code === dimCode);
      const label = dimName || entry?.name || dimCode;
      return <span><span className="font-black">{base}</span> <span style={{ color: "#d97706", fontWeight: 700 }}> → {dimGroup}: {label}</span></span>;
    }
    return <span><span className="font-black">{base}</span></span>;
  }
if (node.type === "account") {
    let code    = node.accountCode ?? "?";
    let dimGroup = node.dimGroup;
    let dimCode  = node.dimCode;
    let dimName  = node.dimName;
    if (code.includes(":::") && !dimGroup && !dimCode) {
      const [ac, dg, dc] = code.split(":::");
      code = ac; dimGroup = dg || undefined; dimCode = dc || undefined;
    }
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : code;
if (dimGroup || dimCode) {
      const entry = dimsByAccount.get(code)?.find(d => d.group === dimGroup && d.code === dimCode);
      const label = dimName || entry?.name || dimCode;
      return <span className="font-black">{base} <span style={{ color: "#d97706", fontWeight: 700 }}> → {dimGroup}: {label}</span></span>;
    }
    return <span className="font-black">{base}</span>;
  }
if (node.type === "ref") {
    const k = kpiList.find(k => k.id === node.kpiId);
    return <span className="font-black">{k?.label || node.kpiId || "?"}</span>;
  }
  if (node.type === "party") {
    return <span className="font-black">◆ {node.partyName || node.partyId || "?"}</span>;
  }
  if (node.type === "manual") return <span className="font-black">{node.value}</span>;
  return <span className="text-gray-400 text-[10px]">complejo</span>;
}
function Slot({ node, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), color = "bg-[#eef1fb] text-[#1a2f8a] border-[#1a2f8a]/20" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:shadow-sm ${node ? color : "bg-gray-50 text-gray-400 border-gray-200 border-dashed hover:border-[#1a2f8a]/30 hover:bg-[#f8f9ff]"}`}>
        {node ? <SlotLabel node={node} kpiList={kpiList} accountCodeLabels={accountCodeLabels} dimsByAccount={dimsByAccount} /> : <>
          <Plus size={10} className="opacity-50" /> variable
        </>}
      </button>
{open && <SlotPicker onSelect={onChange} onClose={() => setOpen(false)} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} dimsByAccount={dimsByAccount} />}
    </>
  );
}

const OP_SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷" };

function VisualFormula({ formula, onChange, kpiList, accountCodes, accountCodeLabels = new Map(), builtInIds = new Set() }) {
  if (!formula) return null;

  const updateLeft  = left  => onChange({ ...formula, left });
  const updateRight = right => onChange({ ...formula, right });
  const updateArg   = arg   => onChange({ ...formula, arg });

  if (formula.type === "op") return (
    <div className="flex items-center gap-2 flex-wrap">
      <Slot node={formula.left}  onChange={updateLeft}  kpiList={kpiList} accountCodes={accountCodes} />
      <span className="text-lg font-black text-[#1a2f8a]/50 px-1">{OP_SYMBOL[formula.op]}</span>
      <Slot node={formula.right} onChange={updateRight} kpiList={kpiList} accountCodes={accountCodes} />
    </div>
  );

  if (formula.type === "fn" && formula.fn === "pct") return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">( </span>
      {formula.arg?.type === "op" ? (
        <>
          <Slot node={formula.arg.left}  onChange={l => onChange({ ...formula, arg: { ...formula.arg, left: l } })} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
          <span className="text-lg font-black text-[#1a2f8a]/50 px-1">{OP_SYMBOL[formula.arg.op]}</span>
          <Slot node={formula.arg.right} onChange={r => onChange({ ...formula, arg: { ...formula.arg, right: r } })} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
        </>
      ) : (
        <Slot node={formula.arg} onChange={updateArg} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
      )}
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg"> ) × 100</span>
    </div>
  );

  if (formula.type === "fn" && formula.fn === "neg") return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-lg font-black text-[#1a2f8a]/50 px-1">−</span>
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">( </span>
      <Slot node={formula.arg} onChange={updateArg} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg"> )</span>
    </div>
  );

  if (formula.type === "fn" && formula.fn === "abs") return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">|</span>
      <Slot node={formula.arg} onChange={updateArg} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
      <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">|</span>
    </div>
  );

  // fallback for single node types
  return (
    <Slot node={formula} onChange={onChange} kpiList={kpiList} accountCodes={accountCodes} accountCodeLabels={accountCodeLabels} builtInIds={builtInIds} />
  );
}

// ── Text Formula Builder ──────────────────────────────────────────────────────
const VARIABLE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function TextFormulaBuilder({ formula, onChange, kpiList, accountCodes, localAccounts = [], groupAccountsList = [], accountCodeLabels = new Map(), builtInIds = new Set(), dimsByAccount = new Map(), localDimsByAccount = new Map(), parties = [], partyContext = null, evalPartyValue = null }) {
  const [expression, setExpression] = useState(() => {
    if (formula?.type === "text") return formula.expression ?? "";
    return "";
  });
  const [variables, setVariables] = useState(() => {
    if (formula?.type === "text") return formula.variables ?? {};
    return {};
  });
  const [editingVar, setEditingVar] = useState(null);
  const inputRef = useRef(null);
  const lastSyncRef = useRef(formula);

// Sync internal state when the incoming formula changes (e.g. preset selected).
  // Only fires when the inbound formula actually differs from what's rendered
  // — silences react-hooks/set-state-in-effect.
  useEffect(() => {
    if (formula === lastSyncRef.current) return;
    lastSyncRef.current = formula;

    const nextExpr = formula?.type === "text" ? (formula.expression ?? "") : "";
    const nextVars = formula?.type === "text" ? (formula.variables ?? {})  : {};

    setExpression(prev => prev === nextExpr ? prev : nextExpr);
    setVariables(prev => {
      const a = Object.keys(prev), b = Object.keys(nextVars);
      if (a.length === b.length && a.every(k => prev[k] === nextVars[k])) return prev;
      return nextVars;
    });
  }, [formula]);

  const usedLetters = Object.keys(variables);
  const nextLetter = VARIABLE_LETTERS.find(l => !usedLetters.includes(l)) ?? "?";

  const insertVariable = () => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? expression.length;
    const end = el.selectionEnd ?? expression.length;
    const newExpr = expression.slice(0, start) + nextLetter + expression.slice(end);
    const newVars = { ...variables, [nextLetter]: null };
    setExpression(newExpr);
    setVariables(newVars);
    onChange({ type: "text", expression: newExpr, variables: newVars });
    setTimeout(() => { el.focus(); el.setSelectionRange(start + 1, start + 1); }, 0);
  };

const updateExpr = (val) => {
    const newVars = { ...variables };
    // Remove variables no longer in expression
    Object.keys(newVars).forEach(l => { if (!val.includes(l)) delete newVars[l]; });
    // Auto-add new capital letters found in expression
    const lettersInExpr = [...new Set([...val.matchAll(/[A-Z]/g)].map(m => m[0]))];
    lettersInExpr.forEach(l => {
      if (!(l in newVars)) newVars[l] = null;
    });
    setExpression(val);
    setVariables(newVars);
    onChange({ type: "text", expression: val, variables: newVars });
  };

  const updateVar = (letter, node) => {
    const newVars = { ...variables, [letter]: node };
    setVariables(newVars);
    onChange({ type: "text", expression, variables: newVars });
    setEditingVar(null);
  };

  const removeVar = (letter) => {
    const newVars = { ...variables };
    delete newVars[letter];
    const newExpr = expression.replaceAll(letter, "");
    setExpression(newExpr);
    setVariables(newVars);
    onChange({ type: "text", expression: newExpr, variables: newVars });
  };

  const VAR_COLORS = [
    "bg-blue-50 text-blue-700 border-blue-200",
    "bg-purple-50 text-purple-700 border-purple-200",
    "bg-emerald-50 text-emerald-700 border-emerald-200",
    "bg-amber-50 text-amber-700 border-amber-200",
    "bg-rose-50 text-rose-700 border-rose-200",
    "bg-orange-50 text-orange-700 border-orange-200",
  ];

  const colorFor = (letter) => VAR_COLORS[VARIABLE_LETTERS.indexOf(letter) % VAR_COLORS.length];

  return (
    <div className="flex flex-col gap-3">

      {/* Expression input */}
      <div className="relative">
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Expresión</label>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={expression}
            onChange={e => updateExpr(e.target.value)}
            placeholder="e.g.  (A - B) / C * 100"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white tracking-wide"
          />
          <button onClick={insertVariable}
            title={`Insertar variable ${nextLetter}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1a2f8a] text-white text-xs font-black hover:bg-[#1a2f8a]/90 transition-all flex-shrink-0">
            <Plus size={11} />
            <span className="font-mono">{nextLetter}</span>
          </button>
        </div>
        <p className="text-[10px] text-gray-300 mt-1">

        </p>
      </div>

      {/* Variable mapping */}
      {usedLetters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Mapping de variables</label>
          {usedLetters.sort().map(letter => (
            <div key={letter} className={`flex items-center gap-2 p-2.5 rounded-xl border ${colorFor(letter)}`}>
              <span className="font-mono font-black text-sm w-5 text-center flex-shrink-0">{letter}</span>
              <span className="text-[10px] font-black opacity-40">=</span>
              <div className="flex-1 min-w-0">
                {variables[letter] ? (
<button onClick={() => setEditingVar(letter)}
                    className="text-xs font-black truncate hover:opacity-70 transition-opacity text-left w-full">
                  <SlotLabel node={variables[letter]} kpiList={kpiList} accountCodeLabels={accountCodeLabels} dimsByAccount={dimsByAccount} />
                  </button>
                ) : (
                  <button onClick={() => setEditingVar(letter)}
                    className="text-[10px] font-bold opacity-50 hover:opacity-80 transition-opacity italic">
                    sin asignar — click para definir
                  </button>
                )}
              </div>
              <button onClick={() => setEditingVar(letter)}
                className="flex-shrink-0 w-6 h-6 rounded-lg bg-white/50 hover:bg-white flex items-center justify-center transition-all">
                <Edit3 size={9} />
              </button>
              <button onClick={() => removeVar(letter)}
                className="flex-shrink-0 w-6 h-6 rounded-lg bg-white/50 hover:bg-red-100 hover:text-red-500 flex items-center justify-center transition-all">
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

{/* SlotPicker popover for editing a variable */}
{editingVar && createPortal(
<SlotPicker
          onSelect={(node) => updateVar(editingVar, node)}
          onClose={() => setEditingVar(null)}
          kpiList={kpiList}
          accountCodes={accountCodes}
          localAccounts={localAccounts}
          groupAccountsList={groupAccountsList}
          accountCodeLabels={accountCodeLabels}
          builtInIds={builtInIds}
          dimsByAccount={dimsByAccount}
          localDimsByAccount={localDimsByAccount}
          parties={parties}
          partyContext={partyContext}
          evalPartyValue={evalPartyValue}
        />
      , document.body)}
    </div>
  );
}

function LibTagPill({ value, onChange, allLocalKpis }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";

  const tags = useMemo(() => {
    const seen = new Set();
    allLocalKpis.forEach(k => {
      if (k.tag && k.tag !== "__library__") seen.add(k.tag);
    });
    return [...seen].sort();
  }, [allLocalKpis]);

  const options = [{ value: null, label: "All tags" }, ...tags.map(t => ({ value: t, label: t }))];
  const display = options.find(o => o.value === value)?.label ?? "All tags";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (tags.length === 0) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all"
        style={{ background: value ? colors.primary : "#f8f9ff", color: value ? "#fff" : "#6b7280", border: `1.5px solid ${value ? colors.primary : "#e8eaf0"}` }}>
        <span>{display}</span>
        <ChevronDown size={10} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: `transform 280ms ${SPRING}` }} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 min-w-[160px] rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)", animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          <div className="p-1.5 overflow-y-auto" style={{ maxHeight: "calc(5 * 36px)", scrollbarWidth: "none" }}>
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={String(o.value)} onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{ background: selected ? colors.primary : "transparent", color: selected ? "#fff" : "#475569", transition: `background 180ms ${SMOOTH}` }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LibCategoryPill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";
  const options = [
    { value: null, label: "All categories" },
    ...["Liquidez","Solvencia","Rentabilidad","Eficiencia","Mercado","P&L","Custom"].map(c => ({ value: c, label: c }))
  ];
  const display = options.find(o => o.value === value)?.label ?? "All categories";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all"
        style={{
          background: value ? colors.primary : "#f8f9ff",
          color: value ? "#fff" : "#6b7280",
          border: `1.5px solid ${value ? colors.primary : "#e8eaf0"}`,
        }}>
        <span>{display}</span>
        <ChevronDown size={10} style={{
          opacity: 0.6,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: `transform 280ms ${SPRING}`,
        }} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 min-w-[160px] rounded-2xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.98)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)",
            animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
            <div className="p-1.5 overflow-y-auto" style={{ maxHeight: "calc(5 * 36px)", msOverflowStyle: "none", scrollbarWidth: "none" }}>
            <style>{`.libcat-scroll::-webkit-scrollbar { display: none; }`}</style>
            <div className="libcat-scroll">
            {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={String(o.value)}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{
                    background: selected ? colors.primary : "transparent",
                    color: selected ? "#fff" : "#475569",
                    transition: `background 180ms ${SMOOTH}`,
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_OPTIONS = [
  { value: "Liquidez",      label: "Liquidez" },
  { value: "Solvencia",     label: "Solvencia" },
  { value: "Rentabilidad",  label: "Rentabilidad" },
  { value: "Eficiencia",    label: "Eficiencia" },
  { value: "Mercado",       label: "Mercado" },
  { value: "__custom__",    label: "Custom…" },
];

function CategoryPill({ value, onChange, options: optionsProp }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { colors } = useSettings();
  const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

const options = optionsProp ?? CATEGORY_OPTIONS;
  const display = options.find(o => o.value === value)?.label ?? value ?? "—";

return (
    <div ref={ref} className="relative w-full">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
        style={{ background: "#f8f9ff", border: `1.5px solid ${open ? `${colors.primary}40` : "#e8eaf0"}` }}>
        <span style={{ color: value ? "#1f2937" : "#9ca3af" }}>{display}</span>
        <ChevronDown size={11} style={{
          color: colors.primary,
          opacity: 0.4,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: `transform 280ms ${SPRING}`,
        }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.98)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)",
            animation: `dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)`,
          }}>
          <div className="p-1.5">
          {options.map(o => {
              const selected = value === o.value;
              return (
                <button key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{
                    background: selected ? colors.primary : "transparent",
                    color: selected ? "#fff" : "#475569",
                    transition: `background 180ms ${SMOOTH}, color 180ms ${SMOOTH}`,
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <style>{`@keyframes dropdownIn { from { opacity:0; transform:translateY(-6px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
        </div>
      )}
    </div>
  );
}

function DisintegrationOverlay() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const W = canvas.width = parent.offsetWidth;
    const H = canvas.height = parent.offsetHeight;
    const ctx = canvas.getContext("2d");

    // Sample the parent's visual content via html2canvas-style approach
    // Since we can't do that easily, build dense grid of colored particles
    const COLS = 40, ROWS = 20;
    const pw = W / COLS, ph = H / ROWS;
    const particles = [];

    // Color palette sampled from common card colors
    const colors = [
      "#1a2f8a","#3b54b8","#6b7280","#9ca3af","#e5e7eb",
      "#eef1fb","#f8f9ff","#ffffff","#d1d5db","#4f63c2"
    ];

    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const x = col * pw + pw / 2;
        const y = row * ph + ph / 2;
        // Stagger delay from left to right + slight random
        const delay = (col / COLS) * 0.6 + Math.random() * 0.25;
        // Each particle explodes rightward and downward (Thanos style)
        const spread = Math.random() * 0.4 + 0.8;
        const vx = (Math.random() * 2 + 1) * spread;
        const vy = (Math.random() * 1.5 - 0.3) * spread;
        const size = Math.random() * (pw * 0.6) + 1.5;
        const color = colors[Math.floor(Math.random() * colors.length)];
        // Darker particles for text/border areas
        const isDark = col < 6 || row < 3;
        particles.push({ x, y, ox: x, oy: y, vx, vy, size, delay,
          color: isDark ? "#1a2f8a" : color, alpha: 1, rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.3 });
      }
    }

    let start = null;
    const DURATION = 1400;

    const animate = (ts) => {
      if (!start) start = ts;
      const elapsed = (ts - start) / DURATION;
      ctx.clearRect(0, 0, W, H);

      let anyAlive = false;
      particles.forEach(p => {
        const t = Math.max(0, elapsed - p.delay);
        if (t <= 0) {
          anyAlive = true;
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.ox - p.size / 2, p.oy - p.size / 2, p.size, p.size);
          return;
        }
        const progress = Math.min(1, t / (1 - Math.min(p.delay, 0.7)));
        p.alpha = Math.max(0, 1 - Math.pow(progress, 1.8));
        if (p.alpha <= 0) return;
        anyAlive = true;

        const px = p.ox + p.vx * progress * W * 0.5;
        const py = p.oy + p.vy * progress * H * 0.5 + progress * progress * H * 0.12;
        const s = p.size * (1 - progress * 0.4);
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(px, py);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      });

      ctx.globalAlpha = 1;
      if (anyAlive && elapsed < 2.5) requestAnimationFrame(animate);
      else ctx.clearRect(0, 0, W, H);
    };

    requestAnimationFrame(animate);
  }, []);

return (
    <canvas ref={canvasRef}
      className="absolute inset-0 rounded-xl pointer-events-none"
  style={{ zIndex: 10, width: "100%", height: "100%", animation: "disintCanvasFade 1.6s ease-out forwards" }} />
  );
}

function TagInput({ tag, setTag, allLocalKpis }) {
  const existingTags = [...new Set(allLocalKpis.map(k => k.tag).filter(t => t && t !== "__library__" && !t.startsWith("__")))].sort();
  const [tagOpen, setTagOpen] = useState(false);
  const tagRef = useRef(null);
  useEffect(() => {
    const h = e => { if (tagRef.current && !tagRef.current.contains(e.target)) setTagOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={tagRef} className="relative">
      <div className="flex rounded-xl overflow-hidden" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
        <input value={tag} onChange={e => setTag(e.target.value)}
          placeholder="e.g. Core, Deuda…"
          className="flex-1 px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none bg-transparent"
          onFocus={e => e.currentTarget.parentElement.style.borderColor = "#1a2f8a40"}
          onBlur={e => e.currentTarget.parentElement.style.borderColor = "#e8eaf0"} />
        {existingTags.length > 0 && (
          <button type="button" onClick={() => setTagOpen(o => !o)}
            className="px-2 flex items-center justify-center border-l border-gray-200 hover:bg-gray-100 transition-colors flex-shrink-0">
            <ChevronDown size={11} className={`text-gray-400 transition-transform ${tagOpen ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {tagOpen && existingTags.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)" }}>
          <div className="p-1.5 max-h-48 overflow-y-auto">
            {existingTags.map(t => (
              <button key={t} type="button"
                onClick={() => { setTag(t); setTagOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 transition-all"
                style={{ background: tag === t ? "#1a2f8a" : "transparent", color: tag === t ? "#fff" : "#475569" }}
                onMouseEnter={e => { if (tag !== t) e.currentTarget.style.background = "rgba(26,47,138,0.08)"; }}
                onMouseLeave={e => { if (tag !== t) e.currentTarget.style.background = "transparent"; }}>
                {t}
                {tag === t && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function describeVariationNode(node, accountCodeLabels = new Map()) {
  if (!node) return "";
  const parseCodeWithDim = (raw) => {
    if (typeof raw === "string" && raw.includes(":::")) {
      const [code, dimGroup, dimCode] = raw.split(":::");
      return { code, dimGroup, dimCode };
    }
    return { code: raw };
  };
  if (node.type === "accountGroup") {
    const { code, dimGroup, dimCode } = parseCodeWithDim(node.prefix ?? node.groupCode);
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : `Grupo ${code}`;
    return dimGroup ? `${base} → ${dimGroup}: ${dimCode}` : base;
  }
  if (node.type === "account") {
    const { code, dimGroup, dimCode } = parseCodeWithDim(node.accountCode);
    const name = accountCodeLabels.get(code);
    const base = name ? `${code} — ${name}` : code;
    return dimGroup ? `${base} → ${dimGroup}: ${dimCode}` : base;
  }
  if (node.type === "cc") return `${node.tag}`;
  if (node.type === "section") return `${node.statement} · ${node.section}`;
  if (node.type === "party") return `${node.partyName ?? "Partida"}${node.dimCode ? ` · ${node.dimCode}` : ""}`;
  if (node.type === "ref") return `KPI ref`;
  if (node.type === "manual") return `${node.value}`;
  return node.type;
}

function KpiEditorModal({ kpi, onSave, onClose, onReset, onEditLibraryKpi, onDeleteLibraryKpi, onDuplicate, allLocalKpis = [], systemKpis = [], accountCodes, localAccounts = [], groupAccountsList = [], accountCodeLabels = new Map(), builtInIds = new Set(), currentUserId, dimsByAccount = new Map(), localDimsByAccount = new Map(), parties = [], partyContext = null, evalPartyValue = null, variationCompanies = [], companyLabelsMap = new Map(), variationDimensions = [] }) {
  const [mode, setMode] = useState(kpi ? "custom" : "library");

  const [label, setLabel] = useState(kpi?.label ?? "");
  const [description, setDescription] = useState(kpi?.description ?? "");
const [format] = useState(kpi?.format ?? "currency");
  const [category, setCategory] = useState(kpi?.category ?? "");
const [formula, setFormula] = useState(() => {
    if (!kpi?.formula) return null;
    // If already text type, use as-is
    if (kpi.formula.type === "text") return kpi.formula;
    // Convert AST to text type so TextFormulaBuilder can render it
    const astToText = (node) => {
      if (!node) return { expr: "0", vars: {} };
      if (node.type === "cc") return { expr: "A", vars: { A: { type: "cc", tag: node.tag } } };
      if (node.type === "ref") return { expr: "A", vars: { A: { type: "ref", kpiId: node.kpiId } } };
      if (node.type === "manual") return { expr: String(node.value ?? 0), vars: {} };
      if (node.type === "account") return { expr: "A", vars: { A: { type: "account", accountCode: node.accountCode } } };
      if (node.type === "accountGroup") return { expr: "A", vars: { A: { type: "accountGroup", prefix: node.prefix } } };
if (node.type === "op") {
        const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        const l = astToText(node.left);
        const r = astToText(node.right);
        const sym = { "+": "+", "-": "-", "*": "*", "/": "/" }[node.op] ?? node.op;
        const usedLetters = new Set(Object.keys(l.vars));
        const remapR = {};
        const rVarMap = {};
        Object.entries(r.vars).forEach(([letter, val]) => {
          let newLetter = letter;
          if (usedLetters.has(letter)) {
            newLetter = allLetters.find(ll => !usedLetters.has(ll) && !Object.values(rVarMap).includes(ll)) ?? letter;
          }
          usedLetters.add(newLetter);
          rVarMap[letter] = newLetter;
          remapR[newLetter] = val;
        });
        const rExpr = r.expr.replace(/[A-Z]/g, m => rVarMap[m] ?? m);
        return { expr: `(${l.expr} ${sym} ${rExpr})`, vars: { ...l.vars, ...remapR } };
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
    const { expr, vars } = astToText(kpi.formula);
    return { type: "text", expression: expr, variables: vars };
  });
const [tab, setTab] = useState(kpi ? "builder" : "presets");
const [customCategoryLabel, setCustomCategoryLabel] = useState("");
const [benchmark, setBenchmark] = useState(() => {
    const b = kpi?.benchmark;
    return {
      unhealthy: { min: b?.unhealthy?.min ?? "", max: b?.unhealthy?.max ?? "" },
      healthy:   { min: b?.healthy?.min   ?? "", max: b?.healthy?.max   ?? "" },
      vhealthy:  { min: b?.vhealthy?.min  ?? "", max: b?.vhealthy?.max  ?? "" },
    };
  });
const [tag, setTag] = useState(kpi?.tag ?? "");
  const [variations, setVariations] = useState(() => {
    const v = kpi?.variations ?? null;
    return v && (v.byCompany || v.byDimension) ? { byCompany: v.byCompany ?? {}, byDimension: v.byDimension ?? {} } : { byCompany: {}, byDimension: {} };
  });
  const [variationOpen, setVariationOpen] = useState(false);
  const [variationTab, setVariationTab] = useState("companies");
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [expandedDimension, setExpandedDimension] = useState(null);
  const [slotPickerContext, setSlotPickerContext] = useState(null);
  const variationCount = () => {
    let n = 0;
    Object.values(variations.byCompany).forEach(m => n += Object.keys(m ?? {}).length);
    Object.values(variations.byDimension).forEach(m => n += Object.keys(m ?? {}).length);
    return n;
  };
  const setOverride = (scope, key, letter, node) => {
    setVariations(prev => {
      const bucket = scope === "company" ? "byCompany" : "byDimension";
      const next = { ...prev, [bucket]: { ...prev[bucket] } };
      const entry = { ...(next[bucket][key] ?? {}) };
      if (node) entry[letter] = node;
      else delete entry[letter];
if (Object.keys(entry).length > 0) next[bucket][key] = entry;
      else delete next[bucket][key];
      return next;
    });
  };
const formulaLetters = useMemo(() => {
    if (!formula || formula.type !== "text") return [];
    return Object.keys(formula.variables ?? {});
  }, [formula]);
  // Prune orphaned overrides when the formula's variables change (e.g. user
  // deletes letter B from the builder — any per-company/per-dim override for B
  // must go with it).
  useEffect(() => {
    const validLetters = new Set(formulaLetters);
    setVariations(prev => {
      let changed = false;
      const cleanBucket = (bucket) => {
        const next = {};
        Object.entries(bucket).forEach(([key, letters]) => {
          const filtered = {};
          Object.entries(letters).forEach(([l, node]) => {
            if (validLetters.has(l)) filtered[l] = node;
            else changed = true;
          });
          if (Object.keys(filtered).length > 0) next[key] = filtered;
          else if (Object.keys(letters).length > 0) changed = true;
        });
        return next;
      };
      const nextByCompany = cleanBucket(prev.byCompany ?? {});
      const nextByDimension = cleanBucket(prev.byDimension ?? {});
      return changed ? { byCompany: nextByCompany, byDimension: nextByDimension } : prev;
    });
  }, [formulaLetters]);
const [libSearch, setLibSearch] = useState("");
  const [libCatFilter, setLibCatFilter] = useState(null);
const [libTagFilter, setLibTagFilter] = useState(null);
const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [disintegratingId, setDisintegratingId] = useState(null);
const [removedIds, setRemovedIds] = useState(new Set());
const [dupeLabelWarning, setDupeLabelWarning] = useState(false);
const [formulaWarning, setFormulaWarning] = useState(null);
const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    if (document.getElementById("disint-style")) return;
    const s = document.createElement("style");
    s.id = "disint-style";
    s.textContent = `@keyframes disintCanvasFade { 0%{opacity:1} 85%{opacity:1} 100%{opacity:0} }`;
    document.head.appendChild(s);
  }, []);

const otherKpis = useMemo(() => {
    const seen = new Set();
    const result = [];
    // systemKpis first (built-in), then custom library — dedup by id
    [...(systemKpis ?? []), ...(allLocalKpis ?? [])].forEach(k => {
      if (k.id !== kpi?.id && !seen.has(k.id)) { seen.add(k.id); result.push(k); }
    });
    return result;
  }, [systemKpis, allLocalKpis, kpi?.id]);

const validateFormula = (f) => {
    if (!f) return "No hay fórmula definida.";
    if (f.type === "text") {
      const unassigned = Object.entries(f.variables ?? {}).filter(([, v]) => !v).map(([k]) => k);
      if (unassigned.length > 0) return `Variables sin asignar: ${unassigned.join(", ")}`;
      if (!f.expression?.trim()) return "La expresión está vacía.";
      try {
        let expr = f.expression;
        Object.keys(f.variables ?? {}).forEach(letter => { expr = expr.replaceAll(letter, "(1)"); });
        Function(`"use strict"; return (${expr})`)();
      } catch (e) {
        return `Expresión inválida: ${e.message}`;
      }
      const usedLetters = [...(f.expression ?? "").matchAll(/[A-Z]/g)].map(m => m[0]);
      const definedLetters = new Set(Object.keys(f.variables ?? {}));
      const undefinedLetters = [...new Set(usedLetters)].filter(l => !definedLetters.has(l));
      if (undefinedLetters.length > 0) return `Letras sin mapear: ${undefinedLetters.join(", ")}`;
    }
    return null;
  };

return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
<div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        style={{
          boxShadow: "0 32px 80px -16px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)",
          ...(variationOpen ? { transform: "translateX(-22rem)", transition: "transform 460ms cubic-bezier(0.34,1.56,0.64,1)" } : {}),
        }}>

{dupeLabelWarning && (
  <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl"
    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6"
      style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: "#fef3c7" }}>
        <AlertTriangle size={22} style={{ color: "#d97706" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-black text-gray-900 mb-1">Nombre duplicado</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Ya existe un KPI llamado <span className="font-black text-gray-700">"{label.trim()}"</span>.<br />
          Por favor elige un nombre único antes de guardar.
        </p>
      </div>
      <button
        onClick={() => setDupeLabelWarning(false)}
        className="w-full py-2.5 rounded-xl text-xs font-black text-white transition-all"
        style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)" }}>
        Entendido
      </button>
    </div>
  </div>
)}
{formulaWarning && (
  <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl"
    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6"
      style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: "#fee2e2" }}>
        <AlertTriangle size={22} style={{ color: "#dc2626" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-black text-gray-900 mb-1">Fórmula inválida</p>
        <p className="text-xs text-gray-400 leading-relaxed">{formulaWarning}</p>
      </div>
      <div className="flex gap-2 w-full">
        <button
          onClick={() => setFormulaWarning(null)}
          className="flex-1 py-2.5 rounded-xl text-xs font-black transition-all"
          style={{ background: "#f3f4f6", color: "#6b7280" }}>
          Corregir
        </button>
        <button
          onClick={() => {
            setFormulaWarning(null);
            onSave({ label: label.trim(), description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula });
          }}
          className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all"
          style={{ background: "#dc2626" }}>
          Guardar igual
        </button>
      </div>
    </div>
  </div>
)}

{/* Header */}
<div className="px-6 pt-6 pb-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">

            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 relative"
              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", boxShadow: "0 6px 16px -4px rgba(26,47,138,0.5)" }}>
              <Sigma size={16} className="text-white" />
              {kpi?._isOverridden && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-violet-500 border-2 border-white" />
              )}
            </div>
            <div>
              <p className="font-black text-[15px] text-gray-900 leading-tight">
                {kpi ? kpi.label : mode === "library" ? "KPI Selector" : "New KPI"}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] mt-0.5"
                style={{ color: kpi ? (builtInIds.has(kpi.id) ? "#6d28d9" : "#16a34a") : "#9ca3af" }}>
                {kpi ? (builtInIds.has(kpi.id) ? "⚙ System KPI" : "✦ Custom KPI") : "Library or custom formula"}
              </p>
            </div>
          </div>
<button onClick={() => mode === "custom" ? setConfirmClose(true) : onClose()}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "#f3f4f6", color: "#6b7280" }}>
            <X size={13} />
          </button>
        </div>
        <div className="h-px mx-6 mb-1" style={{ background: "linear-gradient(90deg, transparent, rgba(26,47,138,0.08), transparent)" }} />

{confirmClose && (
  <div className="absolute inset-0 z-[60] flex items-center justify-center rounded-3xl"
    style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white border border-gray-100 mx-6"
      style={{ boxShadow: "0 24px 60px -12px rgba(26,47,138,0.2)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "#fef3c7" }}>
        <AlertTriangle size={22} style={{ color: "#d97706" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-black text-gray-900 mb-1">¿Cerrar sin guardar?</p>
        <p className="text-xs text-gray-400 leading-relaxed max-w-[260px]">
          Si cierras ahora perderás cualquier cambio que no hayas guardado.
        </p>
      </div>
      <div className="flex gap-2 w-full">
        <button onClick={() => setConfirmClose(false)}
          className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
          style={{ background: "#f3f4f6", color: "#6b7280" }}>
          Continuar editando
        </button>
        <button onClick={() => { setConfirmClose(false); onClose(); }}
          className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all"
          style={{ background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)", boxShadow: "0 4px 14px -4px rgba(220,38,38,0.4)" }}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
)}

{/* Library mode */}
{mode === "library" && (
<LibraryPicker
    onSave={(data) => {
      if (data === "__custom__") {
        setMode("customList");
      } else {
        onSave(data);
      }
    }}
    onDuplicate={onDuplicate}
  />
)}
{/* Custom KPI list mode */}
{mode === "customList" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Search + category filter */}
            <div className="px-5 pb-3 flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 flex-1 rounded-xl px-3 py-2"
                style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
                <Search size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />
                <input
                  type="text"
                  value={libSearch}
                  onChange={e => setLibSearch(e.target.value)}
                  placeholder="Search KPIs…"
                  className="flex-1 text-xs font-semibold text-gray-700 outline-none bg-transparent"
                />
                {libSearch && (
                  <button onClick={() => setLibSearch("")}>
                    <X size={10} style={{ color: "#9ca3af" }} />
                  </button>
                )}
              </div>
<LibCategoryPill value={libCatFilter} onChange={setLibCatFilter} />
              <LibTagPill value={libTagFilter} onChange={setLibTagFilter} allLocalKpis={allLocalKpis} />
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-5">
             {(() => {
const filtered = allLocalKpis.filter(k => {
                  if (removedIds.has(k.id)) return false;
                  if (k.tag === "__library__") return false;
                  const matchSearch = !libSearch.trim() || k.label.toLowerCase().includes(libSearch.toLowerCase()) || (k.description ?? "").toLowerCase().includes(libSearch.toLowerCase());
                  const matchCat = !libCatFilter || k.category === libCatFilter;
                  const matchTag = !libTagFilter || k.tag === libTagFilter;
                  return matchSearch && matchCat && matchTag;
                });
                return filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#eef1fb] flex items-center justify-center mb-3">
                    <Sigma size={20} className="text-[#1a2f8a]/40" />
                  </div>
                  <p className="text-xs font-black text-gray-400">Aún no hay KPIs personalizados</p>
                  <p className="text-[10px] text-gray-300 mt-1">Crea tu primero con el botón de abajo</p>
                </div>
) : (
<div className="grid grid-cols-2 gap-2 mb-4 pt-2">
                  {filtered.map(k => (
<div key={k.id}
  onClick={() => (confirmDeleteId === k.id || disintegratingId === k.id) ? null : onSave(k)}
  className={`relative flex flex-col rounded-xl border transition-all group overflow-hidden ${
    disintegratingId === k.id ? "border-gray-100 cursor-default p-4" :
    confirmDeleteId === k.id ? "border-red-200 bg-red-50 cursor-pointer p-4" :
    "border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb]/50 p-4 cursor-pointer"
  }`}
style={{
    pointerEvents: disintegratingId === k.id ? "none" : "auto",
    opacity: disintegratingId === k.id ? 0 : 1,
    transition: disintegratingId === k.id ? "opacity 0.4s ease-in 0.2s" : "none",
  }}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <p className="text-sm font-black text-[#1a2f8a] leading-snug">{k.label}</p>
                            <span className={`flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md ${k.format === "percent" ? "bg-emerald-50 text-emerald-700" : k.format === "currency" ? "bg-[#eef1fb] text-[#1a2f8a]" : "bg-gray-50 text-gray-500"}`}>
                              {k.format === "percent" ? "%" : k.format === "currency" ? "€" : "#"}
                            </span>
                          </div>
                          {k.description && <p className="text-[12px] text-gray-400 leading-snug">{k.description}</p>}
                          {k.category && <p className="text-[11px] text-gray-300 mt-0.5 uppercase tracking-wider font-bold">{k.category}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mb-2">
{k._createdBy && (
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-black text-white"
                              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)" }}>
{k._createdBy === currentUserId ? "Y" : "U"}
                            </div>
                            <span className="text-[11px] text-gray-300 font-bold">
                              {k._createdBy === currentUserId ? "Created by you" : "Created by teammate"}
                            </span>
                          </div>
                        )}
                        {k._updatedAt && (
                          <span className="text-[11px] text-gray-300 font-bold ml-auto">
                            {new Date(k._updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
<div className="flex items-center justify-end gap-1.5 mt-auto pt-2 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button onClick={(e) => { e.stopPropagation(); onDuplicate?.({ ...k, label: k.label + " 2" }); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                          style={{ background: "#f3f4f6", color: "#6b7280" }}
                          title="Duplicate">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onEditLibraryKpi?.(k); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                          style={{ background: "#eef1fb", color: "#1a2f8a" }}>
                          <Edit3 size={10} />
                        </button>
{confirmDeleteId !== k.id && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(k.id); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                            style={{ background: "#fee2e2", color: "#dc2626" }}>
                            <Trash2 size={10} />
                          </button>
                        )}
</div>
{disintegratingId === k.id && (
                      <>
                        <div className="absolute inset-0 rounded-xl z-[9]"
                          style={{ animation: "disintFade 1.4s ease-in forwards" }} />
                        <DisintegrationOverlay />
                        <style>{`@keyframes disintFade { 0% { background: transparent; } 30% { background: rgba(255,255,255,0); } 100% { background: rgba(255,255,255,1); } }`}</style>
                      </>
                    )}
                    {confirmDeleteId === k.id && (
                      <div className="absolute inset-0 rounded-xl flex flex-col items-center justify-center gap-3 p-4"
                        style={{ background: "rgba(254,242,242,0.97)", backdropFilter: "blur(4px)" }}
                        onClick={e => e.stopPropagation()}>
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                          <Trash2 size={16} className="text-red-500" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-black text-red-700">¿Eliminar KPI?</p>
                          <p className="text-[10px] text-red-400 mt-0.5 leading-snug">"{k.label}" será eliminado permanentemente</p>
                        </div>
                        <div className="flex gap-2 w-full">
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            className="flex-1 py-2 rounded-xl text-xs font-black transition-all hover:scale-105"
                            style={{ background: "#f3f4f6", color: "#6b7280" }}>
                            Cancelar
                          </button>
<button onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                            setDisintegratingId(k.id);
                            setTimeout(() => {
                              setRemovedIds(prev => new Set([...prev, k.id]));
                              onDeleteLibraryKpi?.(k.id);
                              setDisintegratingId(null);
                            }, 1600);
                          }}
                            className="flex-1 py-2 rounded-xl text-xs font-black text-white transition-all hover:scale-105"
                            style={{ background: "#dc2626", boxShadow: "0 4px 12px -2px rgba(220,38,38,0.4)" }}>
                            Eliminar
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  ))}
</div>
              );
              })()}
            </div>
            <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setMode("custom")}
                className="w-full py-2.5 rounded-xl bg-[#1a2f8a] text-white text-xs font-black hover:bg-[#1a2f8a]/90 transition-all flex items-center justify-center gap-2">
                <Plus size={12} /> Crear nuevo KPI personalizado
              </button>
            </div>
          </div>
        )}

{/* Custom builder mode */}
        {mode === "custom" && (
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

{/* Label + Category side by side */}
<div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Label *</label>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. EBITDA Margin"
                className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
                style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}
                onFocus={e => e.target.style.borderColor = "#1a2f8a40"}
                onBlur={e => e.target.style.borderColor = "#e8eaf0"} />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Category</label>
{(() => {
  const existingCategories = [...new Set(allLocalKpis.map(k => k.category).filter(c => c && c !== "__custom__"))].sort();
  const dynamicOptions = [
    { value: "Liquidez",     label: "Liquidez" },
    { value: "Solvencia",    label: "Solvencia" },
    { value: "Rentabilidad", label: "Rentabilidad" },
    { value: "Eficiencia",   label: "Eficiencia" },
    { value: "Mercado",      label: "Mercado" },
    ...existingCategories
      .filter(c => !["Liquidez","Solvencia","Rentabilidad","Eficiencia","Mercado"].includes(c))
      .map(c => ({ value: c, label: c })),
    { value: "__custom__", label: "Custom…" },
  ];
  return (
    <CategoryPill
      value={category}
      onChange={v => { setCategory(v); if (v !== "__custom__") setCustomCategoryLabel(""); }}
      options={dynamicOptions}
    />
  );
})()}
              {category === "__custom__" && (
                <input value={customCategoryLabel} onChange={e => setCustomCategoryLabel(e.target.value)}
                  placeholder="Category name"
                  className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none mt-2"
                  style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this KPI measure?"
                className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-800 outline-none transition-all"
                style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}
                onFocus={e => e.target.style.borderColor = "#1a2f8a40"}
                onBlur={e => e.target.style.borderColor = "#e8eaf0"} />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 block" style={{ color: "#9ca3af" }}>Tag</label>
<TagInput tag={tag} setTag={setTag} allLocalKpis={allLocalKpis} />
            </div>
          </div>



{/* Formula */}
          <div>
<div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Formula</label>
              {!kpi && (
                <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "#f0f0f0" }}>
                  <button onClick={() => setTab("presets")} className={`px-3 py-1 rounded-md text-[10px] font-black transition-all ${tab === "presets" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400"}`}>Presets</button>
                  <button onClick={() => setTab("builder")} className={`px-3 py-1 rounded-md text-[10px] font-black transition-all ${tab === "builder" ? "bg-white text-[#1a2f8a] shadow-sm" : "text-gray-400"}`}>Builder</button>
                </div>
              )}
            </div>

{tab === "presets" ? (
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p, i) => (
                  <button key={i} onClick={() => { setFormula(JSON.parse(JSON.stringify(p.formula))); setTab("builder"); }}
                    className="text-left p-3 rounded-xl border border-gray-100 hover:border-[#1a2f8a]/30 hover:bg-[#eef1fb] transition-all group">
                    <p className="text-xs font-black text-[#1a2f8a]">{p.label}</p>
                  </button>
                ))}
              </div>
) : (
              <div className="bg-[#f8f9ff] rounded-xl border border-gray-100 p-4 min-h-[80px]">
<TextFormulaBuilder
                  formula={formula?.type === "text" ? formula : null}
                  onChange={setFormula}
                  kpiList={otherKpis}
                  accountCodes={accountCodes}
                  localAccounts={localAccounts}
                  groupAccountsList={groupAccountsList}
                  accountCodeLabels={accountCodeLabels}
                  builtInIds={builtInIds}
                  dimsByAccount={dimsByAccount}
                  localDimsByAccount={localDimsByAccount}
                  parties={parties}
                  partyContext={partyContext}
                  evalPartyValue={evalPartyValue}
                />
              </div>
            )}
          </div>


{/* Benchmark ranges */}
<div>
  <label className="text-[9px] font-black uppercase tracking-[0.18em] mb-2 block" style={{ color: "#9ca3af" }}>Benchmark Ranges</label>
  <div className="flex flex-col gap-1.5">
    {[
      { key: "unhealthy", label: "Unhealthy", accent: "#dc2626", bg: "#fff8f8" },
      { key: "healthy",   label: "Healthy",   accent: "#16a34a", bg: "#f8fff9" },
      { key: "vhealthy",  label: "Excellent", accent: "#1a2f8a", bg: "#f8f9ff" },
    ].map(({ key, label, accent, bg }) => (
      <div key={key} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: bg }}>
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
        <span className="text-[10px] font-black uppercase tracking-wider flex-shrink-0" style={{ color: accent, width: 68 }}>{label}</span>
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[9px] font-black text-gray-300 flex-shrink-0">MIN</span>
          <input
            value={benchmark[key].min}
            onChange={e => setBenchmark(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value } }))}
            placeholder="—"
            className="w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all"
            style={{ background: "rgba(0,0,0,0.04)", color: "#1f2937" }}
            onFocus={e => { e.target.style.background = "#fff"; e.target.style.boxShadow = `0 0 0 2px ${accent}30`; }}
            onBlur={e => { e.target.style.background = "rgba(0,0,0,0.04)"; e.target.style.boxShadow = "none"; }}
          />
          <span className="text-[9px] font-black text-gray-300 flex-shrink-0">MAX</span>
          <input
            value={benchmark[key].max}
            onChange={e => setBenchmark(prev => ({ ...prev, [key]: { ...prev[key], max: e.target.value } }))}
            placeholder="—"
            className="w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all"
            style={{ background: "rgba(0,0,0,0.04)", color: "#1f2937" }}
            onFocus={e => { e.target.style.background = "#fff"; e.target.style.boxShadow = `0 0 0 2px ${accent}30`; }}
            onBlur={e => { e.target.style.background = "rgba(0,0,0,0.04)"; e.target.style.boxShadow = "none"; }}
          />
        </div>
      </div>
    ))}
  </div>
</div>

        </div>
        )}


{/* Footer — only for custom mode */}
{mode === "custom" && (
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex flex-col gap-2"
          style={{ background: "rgba(248,249,255,0.8)" }}>
          <div className="flex gap-2">
<button onClick={() => {
            const allLabels = new Set([
              ...(allLocalKpis ?? []).map(k => k.label),
              ...(systemKpis ?? []).map(k => k.label),
            ]);
            if (kpi) allLabels.delete(kpi.label);
            const finalLabel = label.trim();
            const finalLabelLower = finalLabel.toLowerCase();
            if ([...allLabels].some(l => l.toLowerCase() === finalLabelLower)) {
              setDupeLabelWarning(true);
              return;
            }
            const formulaErr = validateFormula(formula);
            if (formulaErr) {
              setFormulaWarning(formulaErr);
              return;
            }
            onSave({ label: finalLabel, description, format, tag, benchmark, category: category === "__custom__" ? customCategoryLabel || "Custom" : category, formula, variations });
          }}
            disabled={!label}
            className="flex-1 py-3 rounded-xl text-xs font-black transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)", color: "white", boxShadow: "0 4px 14px -4px rgba(26,47,138,0.5)" }}>
            <Check size={12} /> {kpi ? "Save Changes" : "Create KPI"}
          </button>
          <button onClick={() => setVariationOpen(o => !o)}
            disabled={formulaLetters.length === 0}
            className="flex-shrink-0 py-3 px-4 rounded-xl text-xs font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background: variationOpen ? "linear-gradient(135deg, #ec4899 0%, #f472b6 100%)" : "#fff",
              color: variationOpen ? "#fff" : "#ec4899",
              border: `2px solid ${variationOpen ? "transparent" : "#ec4899"}`,
              boxShadow: variationOpen ? "0 4px 14px -4px rgba(236,72,153,0.5)" : "none",
            }}
            title={formulaLetters.length === 0 ? "Añade una fórmula primero" : "Variación por empresa / dimensión"}>
            <Sigma size={12} /> Variación
            {variationCount() > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: variationOpen ? "rgba(255,255,255,0.25)" : "#ec489915" }}>{variationCount()}</span>}
          </button>
          </div>
          {kpi?._isOverridden && onReset && (
            <button onClick={() => { onReset(kpi.id); onClose(); }}
              className="w-full py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 hover:opacity-80"
              style={{ background: "#fee2e2", color: "#dc2626" }}>
              ↺ Reset to factory defaults
            </button>
          )}
</div>
        )}
      </div>

      {/* ── Variation side panel — same height as modal, paired centered ── */}
      <div className="absolute top-1/2 pointer-events-none"
        style={{
          left: "50%",
          transform: `translateY(-50%) translateX(calc(1rem + ${variationOpen ? "0px" : "-40px"})) scale(${variationOpen ? 1 : 0.94})`,
          transformOrigin: "left center",
          opacity: variationOpen ? 1 : 0,
          transition: "opacity 340ms cubic-bezier(0.4,0,0.2,1), transform 460ms cubic-bezier(0.34,1.56,0.64,1)",
          maxHeight: "92vh",
          width: "min(42rem, 45vw)",
        }}>
        <div className={`${variationOpen ? "pointer-events-auto" : "pointer-events-none"} rounded-3xl shadow-2xl overflow-hidden flex flex-col bg-white h-full`}
          style={{ boxShadow: "0 32px 80px -16px rgba(236,72,153,0.30), 0 8px 24px -8px rgba(0,0,0,0.10)" }}
          onClick={e => e.stopPropagation()}>

          <div className="px-6 pt-6 pb-5 flex items-center justify-between flex-shrink-0 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #ec4899 0%, #f472b6 100%)", boxShadow: "0 6px 16px -4px rgba(236,72,153,0.5)" }}>
                <Sigma size={16} className="text-white" />
              </div>
              <div>
                <p className="font-black text-[15px] text-gray-900 leading-tight">Variación</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] mt-0.5" style={{ color: "#ec4899" }}>✦ Overrides por empresa / dimensión</p>
              </div>
            </div>
            <button onClick={() => setVariationOpen(false)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
              style={{ background: "#f3f4f6", color: "#6b7280" }}><X size={13} /></button>
          </div>

          <div className="px-6 pt-4 pb-2 flex-shrink-0">
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#f8f9ff" }}>
              <button onClick={() => setVariationTab("companies")}
                className="flex-1 py-2 px-3 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2"
                style={{
                  background: variationTab === "companies" ? "#fff" : "transparent",
                  color: variationTab === "companies" ? "#1a2f8a" : "#9ca3af",
                  boxShadow: variationTab === "companies" ? "0 2px 8px -2px rgba(26,47,138,0.15)" : "none",
                }}>
                <Building2 size={11} /> Empresas
                <span className="text-[9px] px-1.5 py-0.5 rounded-md"
                  style={{ background: variationTab === "companies" ? "#eef1fb" : "transparent", color: variationTab === "companies" ? "#1a2f8a" : "#9ca3af" }}>{variationCompanies.length}</span>
              </button>
              <button onClick={() => setVariationTab("dimensions")}
                className="flex-1 py-2 px-3 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2"
                style={{
                  background: variationTab === "dimensions" ? "#fff" : "transparent",
                  color: variationTab === "dimensions" ? "#15803d" : "#9ca3af",
                  boxShadow: variationTab === "dimensions" ? "0 2px 8px -2px rgba(22,163,74,0.15)" : "none",
                }}>
                <Layers size={11} /> Dimensiones
                <span className="text-[9px] px-1.5 py-0.5 rounded-md"
                  style={{ background: variationTab === "dimensions" ? "#dcfce7" : "transparent", color: variationTab === "dimensions" ? "#15803d" : "#9ca3af" }}>{variationDimensions.length}</span>
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 px-6 pb-6 pt-3" style={{ scrollbarWidth: "thin" }}>
            {variationTab === "companies" && (
              <div className="flex flex-col gap-1.5">
                {variationCompanies.length === 0 && <p className="text-[11px] text-gray-300 text-center py-12 font-bold">No hay empresas disponibles</p>}
                {variationCompanies.map(co => {
                  const label = companyLabelsMap.get(co) ?? co;
                  const overrides = variations.byCompany[co] ?? {};
                  const overrideCount = Object.keys(overrides).length;
                  const isExpanded = expandedCompany === co;
                  return (
                    <div key={co} className="rounded-2xl overflow-hidden transition-all"
                      style={{ background: isExpanded ? "#f8f9ff" : "#fff", border: `1px solid ${isExpanded ? "rgba(26,47,138,0.15)" : "#eef1fb"}` }}>
                      <button onClick={() => setExpandedCompany(isExpanded ? null : co)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left transition-all hover:bg-[#f8f9ff]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: overrideCount > 0 ? "#ec489915" : "#eef1fb" }}>
                            <Building2 size={11} style={{ color: overrideCount > 0 ? "#ec4899" : "#1a2f8a" }} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-gray-900 truncate">{label}</span>
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.15em]">{co}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {overrideCount > 0 && <span className="text-[9px] font-black px-2 py-0.5 rounded-md text-white" style={{ background: "#ec4899" }}>{overrideCount}</span>}
                          <ChevronDown size={11} className="text-gray-400" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 flex flex-col gap-2" style={{ animation: "plRowSlideIn 260ms ease-out" }}>
                          {formulaLetters.length === 0 && <p className="text-[10px] text-gray-300 text-center py-3 font-bold">Sin variables en la fórmula</p>}
                          {formulaLetters.map(letter => {
                            const override = overrides[letter];
                            return (
                              <div key={letter} className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black" style={{ background: "#1a2f8a", color: "#fff" }}>{letter}</div>
                                <button onClick={() => setSlotPickerContext({ scope: "company", key: co, letter })}
                                  className="flex-1 text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-all hover:scale-[1.01]"
                                  style={{ background: override ? "#ec489912" : "#fff", color: override ? "#ec4899" : "#9ca3af", border: `1.5px solid ${override ? "#ec489930" : "#e5e7eb"}` }}>
                                  {override ? describeVariationNode(override, accountCodeLabels) : "— usar fórmula base —"}
                                </button>
                                {override && (
                                  <button onClick={() => setOverride("company", co, letter, null)}
                                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 hover:scale-110 transition-all"
                                    style={{ background: "#fee2e2", color: "#dc2626" }}><X size={10} /></button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {variationTab === "dimensions" && (
              <div className="flex flex-col gap-1.5">
                {variationDimensions.length === 0 && <p className="text-[11px] text-gray-300 text-center py-12 font-bold">No hay dimensiones disponibles</p>}
                {variationDimensions.map(d => {
                  const code = d.code ?? d;
                  const name = d.name ?? code;
                  const group = d.group;
                  const overrides = variations.byDimension[code] ?? {};
                  const overrideCount = Object.keys(overrides).length;
                  const isExpanded = expandedDimension === code;
                  return (
                    <div key={code} className="rounded-2xl overflow-hidden transition-all"
                      style={{ background: isExpanded ? "#f0fdf4" : "#fff", border: `1px solid ${isExpanded ? "rgba(22,163,74,0.15)" : "#dcfce780"}` }}>
                      <button onClick={() => setExpandedDimension(isExpanded ? null : code)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left transition-all hover:bg-[#f0fdf4]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: overrideCount > 0 ? "#ec489915" : "#dcfce7" }}>
                            <Layers size={11} style={{ color: overrideCount > 0 ? "#ec4899" : "#15803d" }} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-gray-900 truncate">{name}</span>
                            {group && <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.15em]">{group}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {overrideCount > 0 && <span className="text-[9px] font-black px-2 py-0.5 rounded-md text-white" style={{ background: "#ec4899" }}>{overrideCount}</span>}
                          <ChevronDown size={11} className="text-gray-400" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 flex flex-col gap-2" style={{ animation: "plRowSlideIn 260ms ease-out" }}>
                          {formulaLetters.length === 0 && <p className="text-[10px] text-gray-300 text-center py-3 font-bold">Sin variables en la fórmula</p>}
                          {formulaLetters.map(letter => {
                            const override = overrides[letter];
                            return (
                              <div key={letter} className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black" style={{ background: "#15803d", color: "#fff" }}>{letter}</div>
                                <button onClick={() => setSlotPickerContext({ scope: "dimension", key: code, letter })}
                                  className="flex-1 text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-all hover:scale-[1.01]"
                                  style={{ background: override ? "#ec489912" : "#fff", color: override ? "#ec4899" : "#9ca3af", border: `1.5px solid ${override ? "#ec489930" : "#e5e7eb"}` }}>
                                  {override ? describeVariationNode(override, accountCodeLabels) : "— usar fórmula base —"}
                                </button>
                                {override && (
                                  <button onClick={() => setOverride("dimension", code, letter, null)}
                                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 hover:scale-110 transition-all"
                                    style={{ background: "#fee2e2", color: "#dc2626" }}><X size={10} /></button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {slotPickerContext && createPortal(
        <SlotPicker
          onSelect={(node) => { setOverride(slotPickerContext.scope, slotPickerContext.key, slotPickerContext.letter, node); setSlotPickerContext(null); }}
          onClose={() => setSlotPickerContext(null)}
          kpiList={allLocalKpis}
          accountCodes={accountCodes}
          accountCodeLabels={accountCodeLabels}
          builtInIds={builtInIds}
          dimsByAccount={dimsByAccount}
          parties={parties}
          partyContext={partyContext}
          evalPartyValue={evalPartyValue}
        />,
        document.body
      )}
    </div>
  );
}

// ── Graph Section Component ───────────────────────────────────────────────────
// ── Graph Section Component ───────────────────────────────────────────────────
function GraphSection({
  sectionId, token, source, structure, year, month,
  sourceOpts, structureOpts, companyCodes, dimensions,
  kpiList, allKpis,
  ccTagToCodes, sectionCodes, sumAccountCodes,
  defaultCompany, defaultKpiIds,
  onStateChange,
  companyLegalName,
  viewPeriod,
  compareMode,
  colors,
}) {
  // Default: end = anchor year/month, start = 12 months earlier
  const anchorY = parseInt(year) || new Date().getFullYear();
  const anchorM = parseInt(month) || new Date().getMonth() + 1;
  let startY = anchorY, startM = anchorM - 11;
  while (startM < 1) { startM += 12; startY -= 1; }

 const [secCompanies, setSecCompanies] = useState(defaultCompany ? [defaultCompany] : []);
  const [secStartYear, setSecStartYear] = useState(String(startY));
  const [secStartMonth, setSecStartMonth] = useState(String(startM));
  const [secEndYear, setSecEndYear] = useState(String(anchorY));
  const [secEndMonth, setSecEndMonth] = useState(String(anchorM));
  const [secSource, setSecSource] = useState(source);
  const [secStructure, setSecStructure] = useState(structure);
const [secDimGroup, setSecDimGroup] = useState(null);
  const [secDim, setSecDim] = useState(null);
const secMode = viewPeriod === "ytd" ? "ytd" : "monthly";
const [secXAxis, setSecXAxis] = useState("month");
const [cmpBars, setCmpBars] = useState([
    { id: "B", companies: [], source, structure, dimGroup: null, dim: null },
    { id: "C", companies: [], source, structure, dimGroup: null, dim: null },
  ]);
  const [cmpChartData, setCmpChartData] = useState({});
  const [cmpBarsCollapsed, setCmpBarsCollapsed] = useState(false);
  useEffect(() => {
    if (!compareMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCmpBarsCollapsed(false);
    }
  }, [compareMode]);
  const updateCmpBar = (id, patch) => setCmpBars(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeCmpBar = (id) => setCmpBars(prev => prev.filter(b => b.id !== id));

const [secKpiIds, setSecKpiIds] = useState(defaultKpiIds || []);
  const activeCmpBars = useMemo(() => compareMode ? cmpBars.filter(b => (cmpChartData[b.id]?.length ?? 0) > 0 || b.companies.length > 0) : [], [compareMode, cmpBars, cmpChartData]);
const [kpiPickerOpen, setKpiPickerOpen] = useState(false);
  const [kpiSearch, setKpiSearch] = useState("");
  const [kpiPickerRect, setKpiPickerRect] = useState(null);
  const kpiPickerRef = useRef(null);

const [chartData, setChartData] = useState([]);

  const [loading, setLoading] = useState(false);
const [tableOpen, setTableOpen] = useState(true);
  const chartContainerRef = useRef(null);

  useEffect(() => {
    const h = e => { if (kpiPickerRef.current && !kpiPickerRef.current.contains(e.target)) setKpiPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

// Dim groups derived from the prop dimensions (or fall back to nothing)
  const secDimGroups = useMemo(() => {
    const seen = new Set();
    const groups = [];
    dimensions.forEach(d => {
      const g = d.DimensionGroup ?? d.dimensionGroup ?? "";
      if (g && !seen.has(g)) { seen.add(g); groups.push(g); }
    });
    return groups.sort();
  }, [dimensions]);

const secGroupDimOptions = useMemo(() => {
    const groups = (secDimGroup && secDimGroup.length > 0) ? secDimGroup : secDimGroups;
    const seen = new Map();
    groups.forEach(g => {
      dimensions.forEach(d => {
        const dg = d.DimensionGroup ?? d.dimensionGroup ?? "";
        if (dg !== g) return;
        const code = d.DimensionCode ?? d.dimensionCode ?? "";
        const name = d.DimensionName ?? d.dimensionName ?? "";
        if (code && !seen.has(code)) seen.set(code, name);
      });
    });
    return [...seen.entries()].map(([code, name]) => ({ code, name }));
  }, [dimensions, secDimGroup, secDimGroups]);


// secAdaptedKpis removed — kpiList is already standard-resolved by KpiResolver.

  // Build list of periods [start..end] inclusive (oldest first), plus one prior for monthly deltas
  const periods = useMemo(() => {
    const sY = parseInt(secStartYear), sM = parseInt(secStartMonth);
    const eY = parseInt(secEndYear),   eM = parseInt(secEndMonth);
    if (!sY || !sM || !eY || !eM) return [];
    const list = [];
    // Prior period (for monthly delta at first displayed month)
    let pY = sY, pM = sM - 1;
    if (pM < 1) { pM = 12; pY -= 1; }
    list.push({ y: pY, m: pM, isPrior: true });
    // Main range
    let y = sY, m = sM;
    while (y < eY || (y === eY && m <= eM)) {
      list.push({ y, m, isPrior: false });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (list.length > 120) break; // safety
    }
    return list;
  }, [secStartYear, secStartMonth, secEndYear, secEndMonth]);

useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !secSource || !secStructure || !secCompanies?.length || periods.length < 2) {
        if (!cancelled) setChartData([]);
        return;
      }
      setLoading(true);

      try {
        const results = await Promise.all(periods.map(async ({ y, m, isPrior }) => {
          const companyFilter = secCompanies.map(c => `CompanyShortName eq '${c}'`).join(" or ");
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and (${companyFilter})`;
          const res = await fetch(
            `/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
          );
          if (!res.ok) return { y, m, isPrior, pivot: new Map(), hasData: false };
          const json = await res.json();
          const rows = json.value ?? (Array.isArray(json) ? json : []);
          const p = new Map();
          rows.forEach(r => {
            const ac = r.AccountCode ?? r.accountCode ?? "";
            const acType = r.AccountType ?? r.accountType ?? "";
            if (!ac) return;
            if (sumAccountCodes && sumAccountCodes.has(ac)) return;
            if (acType && acType !== "P/L") return;

            const hasDimFilter   = Array.isArray(secDim)      && secDim.length      > 0;
            const hasGroupFilter = Array.isArray(secDimGroup) && secDimGroup.length > 0;
            if (hasDimFilter || hasGroupFilter) {
              const dimPairs = parseDimensions(r.Dimensions);
              if (hasDimFilter) {
                const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
                if (!secDim.some(d => rowDimCodes.has(d))) return;
              } else if (hasGroupFilter) {
                const rowGroups = new Set(dimPairs.map(([g]) => g));
                if (!secDimGroup.some(g => rowGroups.has(g))) return;
              }
            }
            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            p.set(ac, (p.get(ac) ?? 0) + amt);
          });
          return { y, m, isPrior, pivot: p, hasData: rows.length > 0 };
        }));

        const series = [];
        for (let i = 1; i < results.length; i++) {
          const curr = results[i];
          if (curr.isPrior) continue;

          let pivotForKpi;
          if (secMode === "ytd") {
            pivotForKpi = curr.pivot;
          } else {
            const prev = results[i - 1];
            const mp = new Map();
            const allCodes = new Set([...curr.pivot.keys(), ...prev.pivot.keys()]);
            allCodes.forEach(ac => {
              const currYTD = curr.pivot.get(ac) ?? 0;
              const prevYTD = curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0);
              mp.set(ac, currYTD - prevYTD);
            });
            pivotForKpi = mp;
          }

          const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, allKpis);
          const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
          const row = { period: label, _hasData: curr.hasData };
          secKpiIds.forEach(kid => {
            const v = kpis.get(kid);
            row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v;
          });
          series.push(row);
        }

        if (!cancelled) setChartData(series);
      } catch (e) {
        console.error("Graph fetch error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, secSource, secStructure, secCompanies, periods, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, sumAccountCodes, secMode, secDim, secDimGroup]);

useEffect(() => {
    if (!compareMode || !token) return;
    // No sync reset: stale cmp data is harmless because all consumers gate on
    // `compareMode` before reading from cmpChartData, so when compare is off
    // it's invisible anyway.
cmpBars.forEach(bar => {
      if (!bar.source || !bar.structure || !bar.companies?.length) return;
      const sY = parseInt(secStartYear), sM = parseInt(secStartMonth);
      const eY = parseInt(secEndYear), eM = parseInt(secEndMonth);
      if (!sY || !sM || !eY || !eM) return;
      const list = [];
      let pY = sY, pM = sM - 1;
      if (pM < 1) { pM = 12; pY -= 1; }
      list.push({ y: pY, m: pM, isPrior: true });
      let y = sY, m = sM;
      while (y < eY || (y === eY && m <= eM)) {
        list.push({ y, m, isPrior: false });
        m += 1; if (m > 12) { m = 1; y += 1; }
        if (list.length > 120) break;
      }
      (async () => {
        try {
          const results = await Promise.all(list.map(async ({ y, m, isPrior }) => {
            const cf = bar.companies.map(c => `CompanyShortName eq '${c}'`).join(" or ");
            const filter = `Year eq ${y} and Month eq ${m} and Source eq '${bar.source}' and GroupStructure eq '${bar.structure}' and (${cf})`;
            const res = await fetch(`/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
              { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
            if (!res.ok) return { y, m, isPrior, pivot: new Map() };
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            const p = new Map();
            rows.forEach(r => {
              const ac = r.AccountCode ?? r.accountCode ?? "";
              const acType = r.AccountType ?? r.accountType ?? "";
              if (!ac || (sumAccountCodes && sumAccountCodes.has(ac)) || (acType && acType !== "P/L")) return;
const barHasDim   = Array.isArray(bar.dim)      && bar.dim.length      > 0;
              const barHasGroup = Array.isArray(bar.dimGroup) && bar.dimGroup.length > 0;
              if (barHasDim || barHasGroup) {
                const pairs = parseDimensions(r.Dimensions);
                if (barHasDim) {
                  const rowDimCodes = new Set(pairs.map(([, code]) => code));
                  if (!bar.dim.some(d => rowDimCodes.has(d))) return;
                } else if (barHasGroup) {
                  if (!bar.dimGroup.some(g => pairs.some(([rg]) => rg === g))) return;
                }
              }
              p.set(ac, (p.get(ac) ?? 0) + parseAmt(r.AmountYTD ?? r.amountYTD ?? 0));
            });
            return { y, m, isPrior, pivot: p };
          }));
          const series = [];
          for (let i = 1; i < results.length; i++) {
            const curr = results[i];
            if (curr.isPrior) continue;
            let pivot;
            if (secMode === "ytd") {
              pivot = curr.pivot;
            } else {
              const prev = results[i - 1];
              const mp = new Map();
              new Set([...curr.pivot.keys(), ...prev.pivot.keys()]).forEach(ac => {
                mp.set(ac, (curr.pivot.get(ac) ?? 0) - (curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0)));
              });
              pivot = mp;
            }
            const kpis = computeAllKpisResolved(kpiList, pivot, ccTagToCodes, sectionCodes, allKpis);
            const row = { period: `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}` };
            secKpiIds.forEach(kid => { const v = kpis.get(kid); row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v; });
            series.push(row);
          }
          setCmpChartData(prev => ({ ...prev, [bar.id]: series }));
        } catch (e) { console.error("Cmp fetch error:", e); }
      })();
    });
}, [compareMode, cmpBars, token, secMode, secKpiIds, kpiList, allKpis, ccTagToCodes, sectionCodes, sumAccountCodes, secStartYear, secStartMonth, secEndYear, secEndMonth]);


// Expose state up to parent for export
  useEffect(() => {
    if (onStateChange) {
      const activeBars = compareMode
        ? cmpBars
            .filter(b => Array.isArray(b.companies) && b.companies.length > 0)
            .map(b => ({ id: b.id, companies: b.companies, source: b.source, structure: b.structure, dimGroup: b.dimGroup, dim: b.dim }))
        : [];
      onStateChange(sectionId, {
        sectionId,
        company: Array.isArray(secCompanies) ? secCompanies.join(", ") : "",
        companies: Array.isArray(secCompanies) ? [...secCompanies] : [],
        startY: secStartYear, startM: secStartMonth,
        endY: secEndYear, endM: secEndMonth,
        source: secSource, structure: secStructure,
        dimGroup: secDimGroup, dim: secDim,
mode: secMode, kpiIds: (console.log("[state-emit] kpiIds:", secKpiIds), secKpiIds),
        chartData,
        compareMode,
        cmpBars: activeBars,
        cmpChartData: compareMode ? cmpChartData : {},
        chartContainerRef,
      });
    }
}, [sectionId, secCompanies, secStartYear, secStartMonth, secEndYear, secEndMonth,
      secSource, secStructure, secDimGroup, secDim, secMode, secKpiIds, chartData,
      compareMode, cmpBars, cmpChartData, onStateChange]);

const COLORS = [
    colors?.primary,
    colors?.secondary,
    colors?.tertiary,
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];

const KPI_CAP_COMPARE = 2;
const KPI_CAP_NORMAL = 10;
const kpiCap = compareMode ? KPI_CAP_COMPARE : KPI_CAP_NORMAL;

const toggleKpi = (id) => {
    setSecKpiIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= kpiCap) return prev;
      return [...prev, id];
    });
  };

  // Auto-trim when cap shrinks (e.g., entering compare mode)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSecKpiIds(prev => prev.length > kpiCap ? prev.slice(0, kpiCap) : prev);
  }, [kpiCap]);

  const allPickerKpis = useMemo(() => {
    const seen = new Set();
    const result = [];
    [...(allKpis ?? []), ...(kpiList ?? [])].forEach(k => {
      if (!seen.has(k.id)) { seen.add(k.id); result.push(k); }
    });
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [allKpis, kpiList]);

const graphFilters = [
{ label: "Company", values: secCompanies, onChange: setSecCompanies, options: companyCodes.map(c => ({ value: c, label: companyLegalName(c) })), multiselect: true },
    { label: "Start M", value: secStartMonth, onChange: setSecStartMonth, options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
    { label: "Start Y", value: secStartYear, onChange: setSecStartYear, options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
    { label: "End M", value: secEndMonth, onChange: setSecEndMonth, options: MONTHS.map(m => ({ value: String(m.value), label: m.label })) },
    { label: "End Y", value: secEndYear, onChange: setSecEndYear, options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
    ...(sourceOpts.length > 0 ? [{ label: "Source", value: secSource, onChange: setSecSource, options: sourceOpts }] : []),
    ...(structureOpts.length > 0 ? [{ label: "Structure", value: secStructure, onChange: setSecStructure, options: structureOpts }] : []),
...(secDimGroups.length > 0 ? [{ label: "Dim Grp", values: secDimGroup, onChange: v => { setSecDimGroup(v); setSecDim(null); }, options: secDimGroups.map(g => ({ value: g, label: g })), multiselect: true }] : []),
    ...(secGroupDimOptions.length > 0 ? [{ label: "Dims", values: secDim, onChange: setSecDim, options: secGroupDimOptions.map(d => ({ value: d.code, label: d.name || d.code })), multiselect: true }] : []),

  ];
return (
  <div className="flex flex-col gap-3 flex-1 min-h-0">
{/* Filter card — matches compare filter style */}
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 flex-shrink-0"
      style={{ overflow: "visible", position: "relative", zIndex: 30 }}>
      <div className="px-5 py-3 flex items-center gap-2 no-scrollbar" style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "visible" }}>
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${colors?.primary} 0%, #3b54b8 100%)`, boxShadow: `0 4px 12px -4px ${colors?.primary}80` }}>
            <BarChart3 size={14} className="text-white" />
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: colors?.primary }}>Graph</span>
        </div>
{graphFilters.map((f, i) =>
          f.multiselect ? (
            <MultiFilterPill key={i} label={f.label} values={f.values} onChange={f.onChange} options={f.options} colors={colors} />
          ) : (
            <HeaderFilterPill key={i} label={f.label} value={f.value} onChange={f.onChange} options={f.options} />
          )
        )}
        {/* KPI multiselect */}
        <div ref={kpiPickerRef} className="relative flex-shrink-0">
<button onClick={() => {
            const rect = kpiPickerRef.current?.getBoundingClientRect();
            setKpiPickerRect(rect ?? null);
            setKpiPickerOpen(o => !o);
          }}
            className="flex items-center gap-2 rounded-xl select-none"
            style={{ padding: "8px 12px", background: kpiPickerOpen ? "rgba(26,47,138,0.06)" : "transparent", transition: "background 220ms" }}>
            <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.55 }}>KPIs</span>
            <span className="text-xs font-bold" style={{ color: colors?.primary }}>{secKpiIds.length}</span>
            <ChevronDown size={11} style={{ color: colors?.primary, opacity: 0.4, transform: kpiPickerOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
          </button>
{kpiPickerOpen && (() => {
            const systemKpis = allPickerKpis.filter(k => allKpis?.some(s => s.id === k.id) && !kpiList?.some(c => c.id === k.id && c._createdBy));
            const customKpis = allPickerKpis.filter(k => !systemKpis.some(s => s.id === k.id));
            const filtered = (group) => group.filter(k => !kpiSearch.trim() || k.label.toLowerCase().includes(kpiSearch.toLowerCase()));
            const filteredSystem = filtered(systemKpis);
            const filteredCustom = filtered(customKpis);
            return (
              <div className="fixed z-[9999] rounded-2xl overflow-hidden flex flex-col"
                style={{
top: kpiPickerRect ? kpiPickerRect.bottom + 8 : 0,
                  left: kpiPickerRect ? kpiPickerRect.left : 0,
                  width: 280,
                  maxHeight: 380,
                  background: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)",
                  border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)"
                }}>
                {/* Search */}
                <div className="px-3 pt-3 pb-2 flex-shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f8f9ff", border: "1.5px solid #e8eaf0" }}>
                    <Search size={11} style={{ color: "#9ca3af", flexShrink: 0 }} />
                    <input
                      autoFocus
                      value={kpiSearch}
                      onChange={e => setKpiSearch(e.target.value)}
                      placeholder="Search KPIs…"
                      className="flex-1 text-xs font-semibold text-gray-700 outline-none bg-transparent"
                    />
                    {kpiSearch && <button onClick={() => setKpiSearch("")}><X size={10} style={{ color: "#9ca3af" }} /></button>}
                  </div>
                </div>
                {/* List */}
                <div className="overflow-y-auto flex-1 px-1.5 pb-1.5" style={{ scrollbarWidth: "none" }}>
                  {filteredSystem.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors?.primary }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.5 }}>System</span>
                      </div>
{filteredSystem.map(k => {
                        const atCap = !secKpiIds.includes(k.id) && secKpiIds.length >= kpiCap;
                        return (
                        <button key={k.id} onClick={() => toggleKpi(k.id)} disabled={atCap}
                          className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: secKpiIds.includes(k.id) ? "#eef1fb" : "transparent", color: secKpiIds.includes(k.id) ? "#1a2f8a" : "#475569" }}
                          onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f8f9ff"; }}
                          onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                          <span className="truncate">{k.label}</span>
{secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0" style={{ color: colors?.primary }} />}
                        </button>
                      );
                      })}
                    </>
                  )}
                  {filteredCustom.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#16a34a" }} />
                        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-600" style={{ opacity: 0.7 }}>Custom</span>
                      </div>
{filteredCustom.map(k => {
                        const atCap = !secKpiIds.includes(k.id) && secKpiIds.length >= kpiCap;
                        return (
                        <button key={k.id} onClick={() => toggleKpi(k.id)} disabled={atCap}
                          className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: secKpiIds.includes(k.id) ? "#dcfce7" : "transparent", color: secKpiIds.includes(k.id) ? "#15803d" : "#475569" }}
                          onMouseEnter={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "#f0fdf4"; }}
                          onMouseLeave={e => { if (!secKpiIds.includes(k.id)) e.currentTarget.style.background = "transparent"; }}>
                          <span className="truncate">{k.label}</span>
{secKpiIds.includes(k.id) && <Check size={10} className="flex-shrink-0 text-emerald-600" />}
                        </button>
                      );
                      })}
                    </>
                  )}
                  {filteredSystem.length === 0 && filteredCustom.length === 0 && (
                    <p className="text-[10px] text-gray-300 text-center py-4 font-bold">No results</p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
{loading && <Loader2 size={12} className="animate-spin ml-2" style={{ color: colors?.primary }} />}

{/* X-axis granularity toggle — modern segmented pill */}
        <div className="relative grid grid-cols-2 p-0.5 rounded-xl flex-shrink-0 ml-1"
          style={{ background: `${colors?.primary}10`, width: 132 }}>
          <div className="absolute top-0.5 bottom-0.5 rounded-lg transition-all duration-300 ease-out"
            style={{
              left: secXAxis === "month" ? 2 : "50%",
              width: "calc(50% - 2px)",
              background: colors?.primary,
              boxShadow: `0 2px 8px -2px ${colors?.primary}60`,
            }} />
          {["month","year"].map(x => (
            <button key={x} onClick={() => setSecXAxis(x)}
              className="relative z-10 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.18em] transition-colors duration-200 text-center"
              style={{ color: secXAxis === x ? "#fff" : `${colors?.primary}80` }}>
              {x.charAt(0).toUpperCase() + x.slice(1)}
            </button>
          ))}
        </div>

{compareMode && (() => {
          const CMP_COLORS = ["#CF305D", "#10B981"];
          const allIds = ["B", "C"];
          const missingIds = allIds.filter(id => !cmpBars.some(b => b.id === id));
          if (missingIds.length === 0) return null;
          return (
            <div className="flex items-center gap-1 ml-1">
{missingIds.map(id => {
                const color = CMP_COLORS[allIds.indexOf(id)];
                return (
<button key={id} onClick={() => setCmpBars(prev => [...prev, {
                    id,
                    companies: [],
                    source: secSource,
                    structure: secStructure,
                    dimGroup: null,
                    dim: null,
                  }])}
                    className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] transition-all hover:scale-105 flex-shrink-0"
                    style={{ background: `${color}12`, color, border: `1px solid ${color}30` }}>
                    <Plus size={9} />
                    {id}
                  </button>
                );
              })}
            </div>
          );
        })()}
        {compareMode && (
          <button onClick={() => setCmpBarsCollapsed(v => !v)}
            className="ml-auto flex-shrink-0 w-8 h-8 rounded-xl bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:scale-110 hover:bg-gray-50 transition-all"
            title={cmpBarsCollapsed ? "Mostrar filtros de comparación" : "Ocultar filtros de comparación"}>
            <ChevronDown size={13} style={{
              transition: 'transform 350ms cubic-bezier(0.4,0,0.2,1)',
              transform: cmpBarsCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              color: colors?.primary,
            }} />
          </button>
        )}
      </div>
{compareMode && (
        <div style={{
          maxHeight: cmpBarsCollapsed ? 0 : 600,
          opacity: cmpBarsCollapsed ? 0 : 1,
          overflow: 'hidden',
          transition: 'max-height 450ms cubic-bezier(0.4,0,0.2,1), opacity 300ms ease',
        }}>
{cmpBars.map((bar, bi) => {
        const CMP_COLORS = ["#CF305D", "#10B981"];
        const cmpColor = CMP_COLORS[bi % CMP_COLORS.length];
const cmpDimOptions = (() => {
          const groups = (bar.dimGroup && bar.dimGroup.length > 0) ? bar.dimGroup : secDimGroups;
          const seen = new Map();
          groups.forEach(g => {
            dimensions.forEach(d => {
              const dg = d.DimensionGroup ?? d.dimensionGroup ?? "";
              if (dg !== g) return;
              const code = d.DimensionCode ?? d.dimensionCode ?? "";
              const name = d.DimensionName ?? d.dimensionName ?? "";
              if (code && !seen.has(code)) seen.set(code, name);
            });
          });
          return [...seen.entries()].map(([code, name]) => ({ code, name }));
        })();
        return (
          <div key={bar.id} className="px-5 py-3 flex items-center gap-2 no-scrollbar border-t border-gray-50"
            style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "visible" }}>
            <div className="flex items-center gap-2 mr-2 flex-shrink-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${cmpColor} 0%, ${cmpColor}aa 100%)`, boxShadow: `0 4px 12px -4px ${cmpColor}80` }}>
                <span className="text-white text-[10px] font-black">{bar.id}</span>
              </div>
              <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: cmpColor }}>Compare {bar.id}</span>
            </div>
            <MultiFilterPill label="Company" values={bar.companies} onChange={v => updateCmpBar(bar.id, { companies: v })} options={companyCodes.map(c => ({ value: c, label: companyLegalName(c) }))} colors={{ primary: cmpColor }} />
            {sourceOpts.length > 0 && <HeaderFilterPill label="Source" value={bar.source} onChange={v => updateCmpBar(bar.id, { source: v })} options={sourceOpts} />}
            {structureOpts.length > 0 && <HeaderFilterPill label="Structure" value={bar.structure} onChange={v => updateCmpBar(bar.id, { structure: v })} options={structureOpts} />}
{secDimGroups.length > 0 && <MultiFilterPill label="Dim Grp" values={bar.dimGroup} onChange={v => updateCmpBar(bar.id, { dimGroup: v, dim: null })} options={secDimGroups.map(g => ({ value: g, label: g }))} colors={{ primary: cmpColor }} />}
            {cmpDimOptions.length > 0 && <MultiFilterPill label="Dims" values={bar.dim} onChange={v => updateCmpBar(bar.id, { dim: v })} options={cmpDimOptions.map(d => ({ value: d.code, label: d.name || d.code }))} colors={{ primary: cmpColor }} />}
<button onClick={() => removeCmpBar(bar.id)}
              className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ml-2 transition-all hover:scale-110"
              style={{ background: `${cmpColor}15`, color: cmpColor }}>
              <X size={11} />
            </button>
          </div>
        );
      })}
        </div>
      )}
    </div>

{/* Chart card */}
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">

{/* Chart */}
<div ref={chartContainerRef} className="relative flex-1 min-h-0" style={{ minHeight: 0 }}>
        <div className="absolute inset-0 px-2 py-3">
{loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="relative" style={{ width: 80, height: 80 }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#f3f4f6" strokeWidth="6" />
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke="url(#graphProgGrad)" strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 32}
                    strokeDashoffset={2 * Math.PI * 32 * 0.25}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "40px 40px", animation: "graphSpin 1.1s linear infinite" }}
                  />
                  <defs>
                    <linearGradient id="graphProgGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={colors?.primary ?? "#1a2f8a"} />
                      <stop offset="100%" stopColor="#CF305D" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <BarChart3 size={18} style={{ color: colors?.primary, opacity: 0.4 }} />
                </div>
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">Loading data…</p>
              <style>{`@keyframes graphSpin { from { transform: rotate(-90deg); } to { transform: rotate(270deg); } }`}</style>
            </div>
          ) : chartData.length === 0 || secKpiIds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: `${colors?.primary}10` }}>
                <BarChart3 size={28} style={{ color: colors?.primary, opacity: 0.3 }} />
              </div>
              <p className="text-xs font-bold text-gray-300">
                {secKpiIds.length === 0 ? "Select at least one KPI above" : "No data for selected range"}
              </p>
            </div>
          ) : (() => {
            let displayData = chartData;
            if (secXAxis === "year") {
              const byYear = new Map();
              chartData.forEach(d => {
                const [, yy] = d.period.split("/");
                if (!byYear.has(yy)) byYear.set(yy, { period: `20${yy}`, _months: [] });
                byYear.get(yy)._months.push(d);
              });
              displayData = [...byYear.values()].map(entry => {
                const row = { period: entry.period };
                secKpiIds.forEach(kid => {
                  const kpi = kpiList.find(k => k.id === kid);
                  if (secMode === "ytd") {
                    row[kid] = entry._months[entry._months.length - 1]?.[kid];
                  } else {
                    const vals = entry._months.map(m => m[kid]).filter(v => v !== null && v !== undefined && !isNaN(v));
                    row[kid] = vals.length === 0 ? null : kpi?.format === "percent" ? vals.reduce((a,b) => a+b,0)/vals.length : vals.reduce((a,b) => a+b,0);
                  }
                });
                return row;
              });
            }
const CHART_COLORS = [colors?.primary ?? "#1a2f8a", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4"];
const CMP_COLORS = { B: "#CF305D", C: "#10B981" };
            const activeCmpBars = compareMode ? cmpBars.filter(b => (cmpChartData[b.id]?.length ?? 0) > 0) : [];

            const allPeriods = [...new Set([
              ...displayData.map(d => d.period),
              ...activeCmpBars.flatMap(b => (cmpChartData[b.id] ?? []).map(d => d.period)),
            ])].sort();

            const mergedData = allPeriods.map(period => {
              const main = displayData.find(d => d.period === period) ?? {};
              const row = { period };
              secKpiIds.forEach(kid => { row[`a__${kid}`] = main[kid] ?? null; });
              activeCmpBars.forEach(bar => {
                const barRow = (cmpChartData[bar.id] ?? []).find(d => d.period === period) ?? {};
                secKpiIds.forEach(kid => { row[`${bar.id}__${kid}`] = barRow[kid] ?? null; });
              });
              return row;
            });

            return (
<ResponsiveContainer width="100%" height="100%">
<LineChart data={mergedData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,47,138,0.06)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600 }} axisLine={false} tickLine={false} interval={secXAxis === "year" ? 0 : "preserveStartEnd"} tickMargin={6} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={v => Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} width={40} tickMargin={4} />
                  <Tooltip
                    contentStyle={{ borderRadius: 16, border: "none", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.25)", padding: "12px 16px", fontSize: 12 }}
                    labelStyle={{ fontWeight: 800, color: "#1a2f8a", marginBottom: 6 }}
formatter={(value, name) => {
                      const [prefix, kid] = name.split("__");
                      const kpi = kpiList.find(k => k.id === kid);
                      return [fmtValue(value, kpi?.format), `${prefix.toUpperCase()} · ${kpi?.label ?? kid}`];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 2, lineHeight: '14px' }} iconSize={8} formatter={(value) => {
                    const [prefix, kid] = value.split("__");
                    const kpi = kpiList.find(k => k.id === kid);
                    return `${prefix.toUpperCase()} · ${kpi?.label ?? kid}`;
                  }} />
{secKpiIds.slice(0, kpiCap).map((kid, i) => (
                    <Line key={`a__${kid}`} type="monotone" dataKey={`a__${kid}`}
                      stroke={compareMode ? (colors?.primary ?? "#1a2f8a") : CHART_COLORS[i % CHART_COLORS.length]}
                      strokeDasharray={compareMode && i === 1 ? "5 4" : undefined}
                      strokeWidth={2.5} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls />
                  ))}
{activeCmpBars.flatMap(bar => secKpiIds.slice(0, KPI_CAP_COMPARE).map((kid, i) => (
                    <Line key={`${bar.id}__${kid}`} type="monotone" dataKey={`${bar.id}__${kid}`}
                      stroke={CMP_COLORS[bar.id] ?? "#CF305D"}
                      strokeWidth={2.5}
                      strokeDasharray={i === 1 ? "5 4" : undefined}
                      dot={false} activeDot={{ r: 5, strokeWidth: 0 }} connectNulls />
                  )))}
                </LineChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      </div>

</div>

    {/* Data table card — collapsible */}
<div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-shrink-0 overflow-hidden flex flex-col">
      <button onClick={() => setTableOpen(o => !o)}
        className="flex items-center justify-between px-5 py-3 hover:bg-[#f8f9ff] transition-colors"
        style={{ borderBottom: tableOpen ? "1px solid #f0f0f0" : "none" }}>
        <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: colors?.primary, opacity: 0.6 }}>Data Table</span>
        <div className="flex items-center gap-2">
          {chartData.length > 0 && <span className="text-[9px] font-bold text-gray-400">{chartData.length} periods</span>}
          <ChevronDown size={13} style={{ color: colors?.primary, opacity: 0.4, transform: tableOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)" }} />
        </div>
      </button>
<div style={{
        maxHeight: tableOpen ? "20vh" : "0px",
        overflowY: tableOpen ? "auto" : "hidden",
        scrollbarWidth: "none",
        transition: "max-height 350ms cubic-bezier(0.4,0,0.2,1)",
      }}>
{chartData.length === 0 || secKpiIds.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[10px] text-gray-300 font-bold">
              {secKpiIds.length === 0 ? "Select KPIs to view data" : "—"}
            </div>
          ) : (() => {
          const visibleKpiIds = secKpiIds.slice(0, kpiCap);
            // Build merged rows: { period, a__kid, B__kid, C__kid... }
            const allPeriods = compareMode
              ? [...new Set([
                  ...chartData.map(d => d.period),
                  ...activeCmpBars.flatMap(b => (cmpChartData[b.id] ?? []).map(d => d.period)),
                ])].sort()
              : chartData.map(d => d.period);
            const rows = allPeriods.map(period => {
              const main = chartData.find(d => d.period === period) ?? {};
              const row = { period };
              visibleKpiIds.forEach(kid => { row[`a__${kid}`] = main[kid] ?? null; });
              if (compareMode) {
                activeCmpBars.forEach(bar => {
                  const barRow = (cmpChartData[bar.id] ?? []).find(d => d.period === period) ?? {};
                  visibleKpiIds.forEach(kid => { row[`${bar.id}__${kid}`] = barRow[kid] ?? null; });
                });
              }
              return row;
            });
const renderCell = (v, fmt, prefix, cmpId = null) => {
              const isNull = v === null || v === undefined || isNaN(v);
              const tint = cmpId ? CMP_CELL_TINT[cmpId] : undefined;
              return (
                <td key={prefix} className="px-4 py-2 text-xs font-semibold text-center whitespace-nowrap"
                  style={{
                    color: isNull ? "#d1d5db" : v < 0 ? "#ef4444" : "#111827",
                    background: tint,
                  }}>
                  {isNull ? "—" : fmtValue(v, fmt)}
                </td>
              );
            };
const CMP_HEADER_COLORS = { B: "#CF305D", C: "#10B981" };
            const CMP_CELL_TINT = { B: "rgba(207,48,93,0.05)", C: "rgba(16,185,129,0.05)" };
            const CMP_CELL_BORDER = { B: "#CF305D", C: "#10B981" };
            return (
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="text-center px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/70 whitespace-nowrap"
                      style={{ background: colors?.primary }}>Period</th>
{visibleKpiIds.map(kid => {
                      const k = kpiList.find(k => k.id === kid);
                      const label = k?.label ?? kid;
return (
                        <Fragment key={kid}>
                          <th className="text-center px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/90 whitespace-nowrap"
                            style={{ background: colors?.primary }}>
                            {compareMode ? `A · ${label}` : label}
                          </th>
                          {compareMode && activeCmpBars.map(bar => (
                            <th key={`${kid}-${bar.id}`} className="text-center px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/90 whitespace-nowrap"
                              style={{ background: CMP_HEADER_COLORS[bar.id] ?? colors?.primary }}>
                              {`${bar.id} · ${label}`}
                            </th>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
{rows.map((d, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                      <td className="px-4 py-2 text-xs font-bold whitespace-nowrap text-center" style={{ color: colors?.primary }}>{d.period}</td>
{visibleKpiIds.map(kid => {
                        const k = kpiList.find(k => k.id === kid);
return (
                          <Fragment key={kid}>
                            {renderCell(d[`a__${kid}`], k?.format, `${i}-a-${kid}`)}
                           {compareMode && activeCmpBars.map(bar => renderCell(d[`${bar.id}__${kid}`], k?.format, `${i}-${bar.id}-${kid}`, bar.id))}
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
</div>
</div>
      </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
async function renderChartToImage({ data, series, width = 1100, height = 480 }) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.background = "#ffffff";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      <div style={{ width, height, background: "#fff", padding: 12 }}>
        <LineChart data={data} width={width - 24} height={height - 56} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1fb" />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6b7280" }} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }}
            tickFormatter={v => Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={10} />
          {(series || []).map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
              isAnimationActive={false}
              stroke={s.color} strokeWidth={2.2}
              strokeDasharray={s.dash ?? undefined}
              dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
          ))}
        </LineChart>
      </div>
    );

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 250));

    const canvas = await html2canvas(host, { backgroundColor: "#ffffff", scale: 2, logging: false });
    return canvas.toDataURL("image/png");
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}

function AnimatedTabSelector({
  tabs, activeKey, onSelect, colors,
  pillColor,
  bgColor,
  inactiveColor,
  activeColor,
}) {
  const containerRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const activeIdx = Math.max(0, tabs.findIndex(t => t.key === activeKey));

  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll("button");
    const active = buttons[activeIdx];
    if (active) {
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    }
  }, [activeIdx, tabs.length]);

  const resolvedPill     = pillColor     ?? colors?.primary;
  const resolvedBg       = bgColor       ?? `${colors?.primary}25`;
  const resolvedInactive = inactiveColor ?? "#6b7280";
  const resolvedActive   = activeColor   ?? "#FFFFFF";

  return (
    <div ref={containerRef} className="relative flex items-center gap-0.5 p-0.5 rounded-xl"
      style={{ backgroundColor: resolvedBg, isolation: "isolate" }}>
      <div
        className="absolute top-0.5 bottom-0.5 rounded-lg transition-all duration-300 ease-out shadow-sm"
        style={{
          left: indicator.left,
          width: indicator.width,
          backgroundColor: resolvedPill,
          zIndex: 0,
        }}
      />
      {tabs.map(t => {
        const isActive = t.key === activeKey;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className="relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-colors"
            style={{ color: isActive ? resolvedActive : resolvedInactive }}>
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function KpiIndividualesPage({ token, sources = [], structures = [], companies = [], dimensions = [], groupAccounts: groupAccountsProp = [], activeStandardKey = null }) {
  // Auto-fetch groupAccounts if parent didn't pass them
  const [groupAccountsLocal, setGroupAccountsLocal] = useState([]);
  useEffect(() => {
    if (groupAccountsProp.length > 0) return;
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/v2/group-accounts`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (!res.ok) {
          return;
        }
        const json = await res.json();
        const arr = json.value ?? (Array.isArray(json) ? json : []);
        if (!cancelled) {
          setGroupAccountsLocal(arr);
        }
      } catch (e) {
        console.error("[KpiPage] groupAccounts fetch error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [token, groupAccountsProp.length]);

const groupAccounts = groupAccountsProp.length > 0 ? groupAccountsProp : groupAccountsLocal;


const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const filterStyle = useTypo("filter");
const { colors, locale } = useSettings();
const { companyId: settingsCompanyId } = useSettingsControls();
const tt = (k, fb) => t(locale, k, fb);
  const { getLatestPeriod, setLatestPeriod } = useLatestPeriod();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
// source/structure: state holds the user's explicit override (null = not picked).
  // The displayed value derives from the override-or-prop-default, so first-render
  // already shows a sensible value without a sync setState in an effect.
  const [sourceOverride, setSource] = useState(null);
  const [structureOverride, setStructure] = useState(null);
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
  const source = sourceOverride ?? defaultSource;
  const structure = structureOverride ?? defaultStructure;
  const [metaReady, setMetaReady] = useState(false);
const [loading, setLoading] = useState(false);
  const [cmpLoading, setCmpLoading] = useState(false);
const [companyData, setCompanyData] = useState(new Map());
const [companyDataPrev, setCompanyDataPrev] = useState(new Map()); // previous month for monthly delta
const [companyDataCmp, setCompanyDataCmp] = useState(new Map()); // current period in compare scenario
const [companyDataCmpPrev, setCompanyDataCmpPrev] = useState(new Map()); // previous period in compare scenario
const {
  kpiList: resolvedKpiList,
  allKpis: resolvedAllKpis,
  ccTagToCodes: defaultCcTagToCodes,
  sectionCodes,
} = useResolvedKpiList(groupAccounts, settingsCompanyId, activeStandardKey);

// activeMapping comes from the Views/Mappings modal. When set, we override
// the cc_tag → account-code map so KPIs are computed against the user's
// custom grouping wherever a section label fuzzy-matches a known cc_tag.
// All downstream computation (companyResults, dimensionResults, GraphSection,
// fetchSectionData) reads `ccTagToCodes` from this scope — so they pick up
// the override automatically without further plumbing.
const [activeMapping, setActiveMapping] = useState(null);
const [warningDismissed, setWarningDismissed] = useState(false);

const { ccTagToCodes, mappingMatched, mappingUnmatched } = useMemo(() => {
  if (!activeMapping) {
    return { ccTagToCodes: defaultCcTagToCodes, mappingMatched: [], mappingUnmatched: [] };
  }
  const override = new Map(defaultCcTagToCodes);
  const matched = [];
  const unmatched = [];
  const allSections = new Map([
    ...(activeMapping.plSections || new Map()),
    ...(activeMapping.bsSections || new Map()),
  ]);
  allSections.forEach((codes, label) => {
    if (!codes || codes.length === 0) return;
    const norm = normalizeLabel(label);
    let foundTag = null;
    for (const [ccTag, synonyms] of Object.entries(CC_TAG_SYNONYMS)) {
      if (synonyms.some(syn => norm.includes(normalizeLabel(syn)))) {
        foundTag = ccTag;
        break;
      }
    }
    if (foundTag) {
      override.set(foundTag, codes);
      matched.push({ ccTag: foundTag, label, codeCount: codes.length });
    } else {
      unmatched.push({ label, codeCount: codes.length });
    }
  });
  return { ccTagToCodes: override, mappingMatched: matched, mappingUnmatched: unmatched };
}, [activeMapping, defaultCcTagToCodes]);


// Auth + company resolved from Supabase session (mirrors Mappings pattern).
const [authUserId, setAuthUserId] = useState(null);
const [companyId, setCompanyId]   = useState(null);

// Custom KPIs fetched from Supabase — the company-wide LIBRARY (shared).
const [companyKpis, setCompanyKpis] = useState([]);

// User's PERSONAL dashboard — ordered list of KPI ids (built-in OR custom).
// null = not loaded yet; defaults applied once fetch resolves.
const [dashboardKpiIds, setDashboardKpiIds] = useState(null);
const [dashboardKpiIdsDim, setDashboardKpiIdsDim] = useState(null);

// Resolve session + company on mount
useEffect(() => {
  (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setAuthUserId(uid);
    if (uid) {
      const cid = await getActiveCompanyId(uid);
      setCompanyId(cid);
    }
  })();
}, []);

// Fetch the company's shared KPI library (every saved custom KPI)
const refreshCompanyKpis = useCallback(() => {
  if (!companyId) return;
  listCompanyKpis({ companyId, contextMappingId: "*", scope: "individual" })
    .then(rows => setCompanyKpis(rows ?? []))
    .catch(e => console.error("[KpiPage] listCompanyKpis:", e));
}, [companyId]);

// Kick off the initial fetch as soon as we have a companyId.
useEffect(() => { refreshCompanyKpis(); }, [refreshCompanyKpis]);

// Load statistical parties for the current company (from StatisticalPartiesPage)
const [statParties, setStatParties] = useState([]);
useEffect(() => {
  if (!companyId) return;
  (async () => {
    const { data, error } = await supabase.rpc("list_statistical_parties");
    if (error) {
      console.error("[KpiPage] statistical parties load failed:", error);
      return;
    }
setStatParties((data ?? []).map(r => ({
      id: r.id,
      name: r.name,
      unit: r.unit ?? "",
      companies: r.companies ?? [],
      years:     r.years ?? [],
      dimGroups: r.dim_groups ?? [],
      dims:      r.dims ?? [],
      sharedAcrossCompanies: r.shared_across_companies !== false,
      values:    r.values ?? {},
    })));
  })();
}, [companyId]);

// Fetch this user's personal dashboards (one per tab)
useEffect(() => {
  if (!authUserId || !companyId) return;
  const defaults = ["revenue", "gross_profit", "net_result", "net_margin"];

const loadDash = async (scope, setter) => {
    try {
      const row = await getUserDashboard({ userId: authUserId, companyId, scope });
      if (row && Array.isArray(row.kpi_ids)) {
        const deduped = [...new Set(row.kpi_ids)];
        setter(deduped);
      } else {
        setter(defaults);
        try {
          await saveUserDashboard({ userId: authUserId, companyId, kpiIds: defaults, scope });
        } catch (e) { console.error(`[KpiPage] failed to save defaults for ${scope}:`, e); }
      }
    } catch (e) {
      console.error(`[KpiPage] getUserDashboard ${scope}:`, e);
      setter(defaults);
    }
  };

  loadDash("individual_company", setDashboardKpiIds);
  loadDash("individual_dimension", setDashboardKpiIdsDim);
}, [authUserId, companyId]);

// Adapt Supabase rows to the renderer's KPI shape. _contextMappingId is UI
// metadata for badges + context filtering.
// ── System KPI override helpers ───────────────────────────────────────────
const OVERRIDE_TAG_PREFIX = "__override__:";
const [editingKpi, setEditingKpi] = useState(null);
const [viewMode, setViewMode] = useState("company");

const systemOverrides = useMemo(() => {
  const compMap = new Map();
  const dimMap = new Map();
  companyKpis.forEach(k => {
    if (k.kpi_type === 'system_override' && k.source_system_kpi_id && k.created_by === authUserId) {
      if (k.tag?.includes(":dim")) dimMap.set(k.source_system_kpi_id, k);
      else compMap.set(k.source_system_kpi_id, k);
    }
  });
  return { comp: compMap, dim: dimMap };
}, [companyKpis, authUserId]);

const saveSystemOverride = useCallback(async (originalKpiId, overrideData) => {
  if (!companyId || !authUserId) return;
  const overrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
  const existing = overrideMap.get(originalKpiId);
  try {
    if (existing) {
      const updated = await updateCompanyKpi({
        kpiId:              existing.kpi_id,
        userId:             authUserId,
        label:              overrideData.label,
        description:        overrideData.description ?? null,
        category:           overrideData.category ?? null,
        tag:               `${OVERRIDE_TAG_PREFIX}${originalKpiId}:${viewMode === "dimension" ? "dim" : "comp"}`,
        format:             overrideData.format ?? "currency",
formula:            overrideData.formula,
        benchmark:          overrideData.benchmark ?? null,
        variations:         overrideData.variations ?? null,
        kpiType:            'system_override',
        sourceSystemKpiId:  originalKpiId,
      });
      setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
    } else {
      const created = await createCompanyKpi({
        companyId,
        userId:             authUserId,
        label:              overrideData.label,
        description:        overrideData.description ?? null,
        category:           overrideData.category ?? null,
        tag:               `${OVERRIDE_TAG_PREFIX}${originalKpiId}:${viewMode === "dimension" ? "dim" : "comp"}`,
        format:             overrideData.format ?? "currency",
        formula:            overrideData.formula,
        benchmark:          overrideData.benchmark ?? null,
        variations:         overrideData.variations ?? null,
        contextMappingId:   null,
        scope:              "individual",
        kpiType:            'system_override',
        sourceSystemKpiId:  originalKpiId,
      });
      setCompanyKpis(prev => [...prev, created]);
    }
  } catch (e) {
    alert(`Could not save override: ${e.message}`);
  }
}, [companyId, authUserId, systemOverrides, viewMode]);

const resetSystemOverride = useCallback(async (originalKpiId) => {
  const overrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
  const existing = overrideMap.get(originalKpiId);
  if (!existing) return;
  try {
    await archiveCompanyKpi({ kpiId: existing.kpi_id, userId: authUserId });
    setCompanyKpis(prev => prev.filter(k => k.kpi_id !== existing.kpi_id));
  } catch (e) {
    alert(`Could not reset: ${e.message}`);
  }
}, [systemOverrides, authUserId, viewMode]);

const localKpis = useMemo(() => companyKpis
  .filter(k => k.kpi_type !== 'system_override')
  .map(k => ({
    id:                  k.kpi_id,
    label:               k.label,
    description:         k.description ?? "",
    category:            k.category    ?? "",
    tag:                 k.tag         ?? "",
    format:              k.format,
formula:             k.formula,
    benchmark:           k.benchmark,
    variations:          k.variations ?? null,
    _contextMappingId:   k.context_mapping_id ?? null,
    _createdBy:          k.created_by,
    _updatedBy:          k.updated_by,
    _updatedAt:          k.updated_at,
    _createdAt:          k.created_at,
    _kpiType:            k.kpi_type ?? "custom",
    _sourceSystemKpiId:  k.source_system_kpi_id ?? null,
  })), [companyKpis]);

// Persist dashboard changes to Supabase (optimistic — UI updates first)
const persistDashboard = useCallback(async (ids, scope = "individual_company") => {
  if (!authUserId || !companyId) return;
  try {
    await saveUserDashboard({ userId: authUserId, companyId, kpiIds: ids, scope });
  } catch (e) {
    console.error("[KpiPage] saveUserDashboard:", e);
  }
}, [authUserId, companyId]);



// Visible KPIs: resolve every dashboard id from built-ins or the custom
// library and drop anything that can't be found (e.g. removed from library).
// We DON'T filter by mapping context here — the badge on each row tells the
// user where the KPI was created, and the cc_tag override system already
// recomputes values against the active mapping. Hiding KPIs on mapping change
// is more confusing than helpful.


const builtInKpiIds = useMemo(() => new Set(resolvedAllKpis.map(k => k.id)), [resolvedAllKpis]);

const buildKpiList = useCallback((ids) => {
  if (!ids) return [];
  const byId = new Map();
  resolvedAllKpis.forEach(k => byId.set(k.id, k));
  resolvedKpiList.forEach(k => byId.set(k.id, k));
  localKpis.forEach(k => byId.set(k.id, k));
  const seen = new Set();
  return ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; }).map(id => {
    const base = byId.get(id);
    if (!base) return null;
// Only apply override if the dashboard id IS the system id (not a promoted custom UUID)
if (builtInKpiIds.has(id)) {
      const overrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
      const override = overrideMap.get(id);
      if (override) {
return {
          ...base,
          label:       override.label       ?? base.label,
          description: override.description ?? base.description,
          category:    override.category    ?? base.category,
          format:      override.format      ?? base.format,
          formula:     override.formula     ?? base.formula,
          benchmark:   override.benchmark   ?? base.benchmark,
          variations:  override.variations ?? null,
          tag:         override.tag?.startsWith("__override__:") ? base.tag : (override.tag ?? base.tag),
          _isOverridden:  true,
          _overrideKpiId: override.kpi_id,
        };
      }
    }
    return base;
  }).filter(Boolean);
}, [resolvedAllKpis, resolvedKpiList, localKpis, systemOverrides, builtInKpiIds, viewMode]);

const kpiList = useMemo(() =>
  viewMode === "dimension" ? buildKpiList(dashboardKpiIdsDim) : buildKpiList(dashboardKpiIds),
  [viewMode, dashboardKpiIds, dashboardKpiIdsDim, buildKpiList]
);
const addToDashboard = useCallback((kpiId, scope = "individual_company") => {
  const setter = scope === "individual_dimension" ? setDashboardKpiIdsDim : setDashboardKpiIds;
  setter(prev => {
    if (!prev) return prev;
    if (prev.includes(kpiId)) return prev;
    const next = [...prev, kpiId];
    persistDashboard(next, scope);
    return next;
  });
}, [persistDashboard]);

const removeFromDashboard = useCallback((kpiId, scope = "individual_company") => {
  const setter = scope === "individual_dimension" ? setDashboardKpiIdsDim : setDashboardKpiIds;
  setter(prev => {
    if (!prev) return prev;
    const next = prev.filter(id => id !== kpiId);
    persistDashboard(next, scope);
    return next;
  });
if (builtInKpiIds.has(kpiId)) {
    const overrideMap = scope === "individual_dimension" ? systemOverrides.dim : systemOverrides.comp;
    const override = overrideMap.get(kpiId);
    if (override) {
      archiveCompanyKpi({ kpiId: override.kpi_id, userId: authUserId }).catch(console.error);
      setCompanyKpis(prev => prev.filter(k => k.kpi_id !== override.kpi_id));
    }
  }
}, [persistDashboard, builtInKpiIds, systemOverrides, authUserId]);
const [viewPeriod, setViewPeriod] = useState("ytd"); // "monthly" | "ytd"

// Compare mode: when enabled, show 2 extra columns per existing column
// (compare value + delta) using the comparison filter set below.
const [exportModal, setExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState({
    company: true,
    dimension: true,
    graphs: true,
    inlineDefs: true,
    defsSheet: true,
    format: "xlsx",
  });

  const [compareMode, setCompareMode] = useState(false);
const [compareVisible, setCompareVisible] = useState(false);
const [cmpBarCollapsed, setCmpBarCollapsed] = useState(false);
useEffect(() => {
  if (compareMode) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompareVisible(true);
    return;
  }
setCmpBarCollapsed(false);
  const t = setTimeout(() => setCompareVisible(false), 450);
  return () => clearTimeout(t);
}, [compareMode]);
// Cmp filters: state holds the user's override (null = not picked yet).
// Displayed value derives from override-or-primary-fallback, so first render
// after compareMode flips on already has sensible values and the fetch gate passes.
const [cmpSourceOverride, setCmpSource]       = useState(null);
const [cmpStructureOverride, setCmpStructure] = useState(null);
const [cmpYearOverride, setCmpYear]           = useState(null);
const [cmpMonthOverride, setCmpMonth]         = useState(null);
const cmpSource    = cmpSourceOverride    ?? source;
const cmpStructure = cmpStructureOverride ?? structure;
const cmpYear      = cmpYearOverride      ?? (year ? String(parseInt(year) - 1) : "");
const cmpMonth     = cmpMonthOverride     ?? month;
const [cmpSelGroups, setCmpSelGroups] = useState(null);
const [cmpSelDims, setCmpSelDims] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [colDragIdx, setColDragIdx] = useState(null);
  const [colDragOverIdx, setColDragOverIdx] = useState(null);
  const [colOrder, setColOrder] = useState(null);
const [selGroups, setSelGroups] = useState(null);
  const [selDims, setSelDims] = useState(null);
const [selCompanies, setSelCompanies] = useState(null);
  const graphSectionsRef = useRef({}); // { 1: {...}, 2: {...}, 3: {...} }
const [, setExporting] = useState(false);
  const handleGraphSectionState = useCallback((sid, state) => {
    graphSectionsRef.current[sid] = state;
  }, []);

  // Auto-find the latest period with data once source/structure/company are known
const autoPeriodDone = useRef(false);

const companyCodes = useMemo(() =>
    [...new Set(companies.map(c => typeof c === "object" ? (c.companyShortName ?? c.CompanyShortName ?? "") : String(c)).filter(Boolean))],
    [companies]
  );

const kpiDashProgress = useMemo(() => {
  let pct = 0;
  if (year && month)                                           pct += 15;
  if (sources.length > 0 && structures.length > 0 && companies.length > 0) pct += 15;
  if (groupAccounts.length > 0)                                pct += 25;
  if (companyData.size > 0)                                    pct += 25;
  if (metaReady && !loading)                                   pct += 20;
  return Math.min(100, pct);
}, [year, month, sources.length, structures.length, companies.length, groupAccounts.length, companyData, metaReady, loading]);

const animatedKpiDashProgress = useAnimatedNumber(kpiDashProgress, 700);
const [hasEverLoaded, setHasEverLoaded] = useState(false);
if (kpiDashProgress >= 100 && !hasEverLoaded) setHasEverLoaded(true);
const kpiDashReady = hasEverLoaded || kpiDashProgress >= 100;

  const companyLegalName = useCallback((shortName) => {
    const co = companies.find(c => (c.companyShortName ?? c.CompanyShortName ?? "") === shortName);
    return co?.CompanyLegalName ?? co?.companyLegalName ?? shortName;
  }, [companies]);

// Auto-find the latest period with data once source/structure/company are known.
  // Fast path: LatestPeriodContext (populated by EpicLoader). Slow path: 24-month probe.
useEffect(() => {
    if (autoPeriodDone.current) return;
    if (!token || !source || !structure || companyCodes.length === 0) return;
    autoPeriodDone.current = true;
    let cancelled = false;
    const co = companyCodes[0];

    (async () => {
      // FAST PATH 1: React context cache
      const cached = getLatestPeriod(source, structure, co);
      if (cached) {
        if (cancelled) return;
        setYear(String(cached.year));
        setMonth(String(cached.month));
        setMetaReady(true);
        return;
      }

      // FAST PATH 2: sessionStorage (EpicLoader's prefetchHomeData)
      try {
        const ssKey = `home_latest_period_${source}_${structure}_${co}`;
        const ssRaw = sessionStorage.getItem(ssKey);
        if (ssRaw) {
          const parsed = JSON.parse(ssRaw);
          if (parsed.year && parsed.month) {
            if (cancelled) return;
            setYear(String(parsed.year));
            setMonth(String(parsed.month));
            setLatestPeriod(source, structure, co, parsed.year, parsed.month);
            setMetaReady(true);
            return;
          }
        }
      } catch { /* ignore */ }


      // SLOW PATH: probe backwards from current month
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        if (cancelled) return;
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${co}'`;
          const res = await fetch(
            `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
          );
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            if (rows.length > 0) {
              if (cancelled) return;
              setYear(String(y));
              setMonth(String(m));
              setLatestPeriod(source, structure, co, y, m);
              setMetaReady(true);
              return;
            }
          }
        } catch { /* keep probing */ }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      if (!cancelled) setMetaReady(true);
    })();

    return () => { cancelled = true; };
  }, [token, source, structure, companyCodes, getLatestPeriod, setLatestPeriod]);

// Derive dim groups and codes from the journal's `Dimensions` field — more
// reliable than /v2/dimensions because we know the data is there if we see it
// here.
const { dimGroups, dimsByGroup } = useMemo(() => {
    const groupSet = new Set();
    const byGroup = new Map();
    // Build name lookup from dimensions prop
    const nameLookup = new Map();
    dimensions.forEach(d => {
      const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "").trim();
      const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "").trim();
      if (code && name) nameLookup.set(code, name);
    });
    companyData.forEach(rows => {
      rows.forEach(r => {
        const pairs = parseDimensions(r.Dimensions);
        for (const [group, code] of pairs) {
          if (!group || !code) continue;
          groupSet.add(group);
          if (!byGroup.has(group)) byGroup.set(group, new Map());
          const name = nameLookup.get(code) ?? code;
          byGroup.get(group).set(code, name);
        }
      });
    });
return {
      dimGroups: [...groupSet].sort(),
      dimsByGroup: byGroup,
    };
  }, [companyData, dimensions]);

// Global dim cache — persists across perimeter changes so the variation
  // editor always sees every dim, not just the ones present in current data.
  // We use a module-scope Map keyed by companyId to survive re-renders without
  // ref/state so React doesn't complain about ref-in-render or setState-in-effect.
  const allDimensionsFlat = useMemo(() => {
    const cache = _getAllDimsCache(companyId);
    let changed = false;
    dimsByGroup.forEach((codeMap, group) => {
      if (!cache.has(group)) { cache.set(group, new Map()); changed = true; }
      const target = cache.get(group);
      codeMap.forEach((name, code) => {
        if (!target.has(code) || target.get(code) !== name) {
          target.set(code, name);
          changed = true;
        }
      });
    });
    // `changed` is unused; kept for future observers.
    void changed;
    const out = [];
    const src = cache.size > 0 ? cache : dimsByGroup;
    src.forEach((codeMap, group) => {
      codeMap.forEach((name, code) => out.push({ code, name: name ?? code, group }));
    });
    return out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [dimsByGroup, companyId]);

const groupDimOptions = useMemo(() => {
    const groups = (selGroups && selGroups.length > 0) ? selGroups : [...dimsByGroup.keys()];
    const seen = new Map();
    groups.forEach(g => {
      const m = dimsByGroup.get(g);
      if (!m) return;
      [...m.entries()].forEach(([code, name]) => { if (!seen.has(code)) seen.set(code, name); });
    });
    return [...seen.entries()].map(([code, name]) => ({ code, name }));
  }, [dimsByGroup, selGroups]);

const groupDimCodes = useMemo(() => {
    if (Array.isArray(selDims)) {
      if (selDims.length === 0) return new Set();
      return new Set(selDims);
    }
    if (Array.isArray(selGroups)) {
      if (selGroups.length === 0) return new Set();
      return new Set(groupDimOptions.map(d => d.code));
    }
    return null;
  }, [selGroups, selDims, groupDimOptions]);

  const cmpGroupDimOptions = useMemo(() => {
    const groups = (cmpSelGroups && cmpSelGroups.length > 0) ? cmpSelGroups : [...dimsByGroup.keys()];
    const seen = new Map();
    groups.forEach(g => {
      const m = dimsByGroup.get(g);
      if (!m) return;
      [...m.entries()].forEach(([code, name]) => { if (!seen.has(code)) seen.set(code, name); });
    });
    return [...seen.entries()].map(([code, name]) => ({ code, name }));
  }, [dimsByGroup, cmpSelGroups]);

  const cmpGroupDimCodes = useMemo(() => {
    if (Array.isArray(cmpSelDims)) {
      if (cmpSelDims.length === 0) return new Set();
      return new Set(cmpSelDims);
    }
    if (Array.isArray(cmpSelGroups)) {
      if (cmpSelGroups.length === 0) return new Set();
      return new Set(cmpGroupDimOptions.map(d => d.code));
    }
    return null;
  }, [cmpSelGroups, cmpSelDims, cmpGroupDimOptions]);

// Shared helpers hoisted out of the effects
const _fetchPeriod = useCallback(async (y, m, s, st) => {
  const map = new Map();
  await Promise.all(companyCodes.map(async co => {
    try {
      const filter = `Year eq ${y} and Month eq ${m} and Source eq '${s}' and GroupStructure eq '${st}' and CompanyShortName eq '${co}'`;
      const res = await fetch(
        `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" } }
      );
      if (!res.ok) { map.set(co, []); return; }
      const json = await res.json();
      map.set(co, json.value ?? (Array.isArray(json) ? json : []));
    } catch { map.set(co, []); }
  }));
  return map;
}, [companyCodes, token]);

const _prevOf = (y, m) => {
  let pY = parseInt(y), pM = parseInt(m) - 1;
  if (pM < 1) { pM = 12; pY -= 1; }
  return { y: pY, m: pM };
};

// Fetch MAIN scenario. Independent from cmp — only re-runs when main filters change.
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!metaReady || !year || !month || !source || !structure || companyCodes.length === 0) return;
    setLoading(true);
    const mainPrev = _prevOf(year, month);
    const [curr, prev] = await Promise.all([
      _fetchPeriod(year, month, source, structure),
      _fetchPeriod(mainPrev.y, mainPrev.m, source, structure),
    ]);
    if (cancelled) return;
    setCompanyData(curr);
    setCompanyDataPrev(prev);
    if (!cancelled) setLoading(false);
  })();
  return () => { cancelled = true; };
}, [metaReady, year, month, source, structure, companyCodes, _fetchPeriod]);

// Fetch CMP scenario. Independent from main — only re-runs when cmp filters or compareMode change.
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!metaReady || companyCodes.length === 0) return;
    if (!compareMode || !cmpSource || !cmpStructure || !cmpYear || !cmpMonth) {
      setCompanyDataCmp(new Map());
      setCompanyDataCmpPrev(new Map());
      return;
    }
    setCmpLoading(true);
    const cmpPrev = _prevOf(cmpYear, cmpMonth);
    const [currC, prevC] = await Promise.all([
      _fetchPeriod(cmpYear, cmpMonth, cmpSource, cmpStructure),
      _fetchPeriod(cmpPrev.y, cmpPrev.m, cmpSource, cmpStructure),
    ]);
    if (cancelled) return;
    setCompanyDataCmp(currC);
    setCompanyDataCmpPrev(prevC);
    if (!cancelled) setCmpLoading(false);
  })();
  return () => { cancelled = true; };
}, [metaReady, companyCodes, compareMode, cmpSource, cmpStructure, cmpYear, cmpMonth, _fetchPeriod]);

  // Build flat pivot per company (account code → YTD sum, P/L summary rows only)
// Build a Set of sum account codes from groupAccounts so we can filter them
  // out of the pivot. The API returns both posting and sum rows together;
  // including sums would double-count revenue/etc.
  const sumAccountCodes = useMemo(() => {
    const sums = new Set();
    groupAccounts.forEach(g => {
      const isSum = g.IsSumAccount === true || g.isSumAccount === true;
      if (isSum) {
        const code = String(g.AccountCode ?? g.accountCode ?? "");
        if (code) sums.add(code);
      }
    });
    return sums;
  }, [groupAccounts]);

// groupCode → Set of leaf descendants (incl. self) for accountGroup roll-ups
const groupDescendantsMap = useMemo(() => {
  const childrenOf = new Map();
  groupAccounts.forEach(g => {
    const parent = String(g.sumAccountCode ?? g.SumAccountCode ?? "");
    const code = String(g.accountCode ?? g.AccountCode ?? "");
    if (!code || !parent || parent === code) return;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(code);
  });
  const desc = new Map();
  const collect = (code) => {
    if (desc.has(code)) return desc.get(code);
    const out = new Set([code]);
    (childrenOf.get(code) || []).forEach(c => collect(c).forEach(d => out.add(d)));
    desc.set(code, out);
    return out;
  };
  groupAccounts.forEach(g => {
    const code = String(g.accountCode ?? g.AccountCode ?? "");
    if (code) collect(code);
  });
  return desc;
}, [groupAccounts]);

// Party lookup by id — used for "party" variable nodes during formula eval.
const partiesById = useMemo(() => {
  const m = new Map();
  statParties.forEach(p => m.set(p.id, p));
  return m;
}, [statParties]);

const companyPivots = useMemo(() => {
    // Build dimPivot from ALL rows (no AccountType filter, no sum filter)
    // because dimension tags live on sum/aggregate rows (A.02, A.PL etc), not posting rows
    const buildDimPivotFromRaw = (rows) => {
      const dimPivot = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        if (!ac) return;
        const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
        if (!dimsRaw || dimsRaw === "—") return;
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        parseDimensions(dimsRaw).forEach(([dGroup, dCode]) => {
          if (!dGroup || !dCode) return;
          const key = `${ac}:::${dGroup}:::${dCode}`;
          dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
        });
      });
      return dimPivot;
    };

const buildPivot = (rows) => {
      const p = new Map();
      const localPivot = new Map();
      const localDimPivot = new Map();
      const dimPivot = new Map(); // kept for compat, replaced below
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const lac = String(r.LocalAccountCode ?? r.localAccountCode ?? "").trim();
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (sumAccountCodes.has(ac)) return;
        if (acType && acType !== "P/L") return;

       const dimPairs = parseDimensions(r.Dimensions ?? r.dimensions ?? "");

if (Array.isArray(selDims)) {
          if (selDims.length === 0) return;
          const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
          if (!selDims.some(d => rowDimCodes.has(d))) return;
        } else if (Array.isArray(selGroups)) {
          if (selGroups.length === 0) return;
          const rowGroups = new Set(dimPairs.map(([g]) => g));
          if (!selGroups.some(g => rowGroups.has(g))) return;
        }

        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);
        if (lac && lac !== "—") {
          localPivot.set(lac, (localPivot.get(lac) ?? 0) + amt);
        }

        dimPairs.forEach(([dGroup, dCode]) => {
          if (!dGroup || !dCode) return;
          const key = `${ac}:::${dGroup}:::${dCode}`;
          dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
          if (lac && lac !== "—") {
            const lkey = `${lac}:::${dGroup}:::${dCode}`;
            localDimPivot.set(lkey, (localDimPivot.get(lkey) ?? 0) + amt);
          }
        });
      });
      p.__dimPivot = dimPivot; // will be overwritten below with full raw version
      p.__localPivot = localPivot;
      p.__localDimPivot = localDimPivot;
      return p;
    };

const pivots = new Map();
    companyData.forEach((rows, co) => {
const currPivot = buildPivot(rows);
      // Overwrite with full raw dimPivot (includes sum account rows where dims live)
      currPivot.__dimPivot = buildDimPivotFromRaw(rows);
      currPivot.__groupDescendants = groupDescendantsMap;
      // Attach party context so `party` node evaluation can find applicable
      // parties + resolve values for the current company/year/month/dim scope.
currPivot.__parties = partiesById;
      currPivot.__partyContext = {
        company: co,
        year: parseInt(year),
        month: parseInt(month),
        selectedDims: groupDimCodes ?? null,
      };
      currPivot.__variationScope = { kind: "company", key: co };

      if (viewPeriod === "ytd") {
        pivots.set(co, currPivot);
      } else {
        // Monthly = current YTD - previous month YTD (per account).
        // For January (month=1) the previous month is in the prior year, so
        // the delta equals YTD itself (which is correct: Jan YTD = Jan monthly).
        const prevRows = companyDataPrev.get(co) ?? [];
        const prevPivot = buildPivot(prevRows);
const monthlyPivot = new Map();
        const isJanuary = parseInt(month) === 1;
        const allCodes = new Set([...currPivot.keys(), ...prevPivot.keys()]);
        allCodes.forEach(ac => {
          const currYTD = currPivot.get(ac) ?? 0;
          const prevYTD = isJanuary ? 0 : (prevPivot.get(ac) ?? 0);
          monthlyPivot.set(ac, currYTD - prevYTD);
        });
// Build monthly dimPivot from raw rows (curr YTD - prev YTD)
        const currRawDimPivot = buildDimPivotFromRaw(rows);
        const prevRawDimPivot = buildDimPivotFromRaw(companyDataPrev.get(co) ?? []);
        const monthlyDimPivot = new Map();
        const allDimKeys = new Set([...currRawDimPivot.keys(), ...prevRawDimPivot.keys()]);
        allDimKeys.forEach(key => {
          const currVal = currRawDimPivot.get(key) ?? 0;
          const prevVal = isJanuary ? 0 : (prevRawDimPivot.get(key) ?? 0);
          monthlyDimPivot.set(key, currVal - prevVal);
        });
monthlyPivot.__dimPivot = monthlyDimPivot;
        // Build monthly localPivot
        const currLP = currPivot.__localPivot ?? new Map();
        const prevLP = prevPivot.__localPivot ?? new Map();
        const monthlyLocalPivot = new Map();
        const allLocalCodes = new Set([...currLP.keys(), ...prevLP.keys()]);
        allLocalCodes.forEach(lc => {
          const cv = currLP.get(lc) ?? 0;
          const pv = isJanuary ? 0 : (prevLP.get(lc) ?? 0);
          monthlyLocalPivot.set(lc, cv - pv);
        });
monthlyPivot.__localPivot = monthlyLocalPivot;
        monthlyPivot.__groupDescendants = groupDescendantsMap;
        monthlyPivot.__parties = partiesById;
monthlyPivot.__partyContext = {
          company: co,
          year: parseInt(year),
          month: parseInt(month),
          selectedDims: groupDimCodes ?? null,
        };
        monthlyPivot.__variationScope = { kind: "company", key: co };
        pivots.set(co, monthlyPivot);
      }
    });
    return pivots;
}, [companyData, companyDataPrev, viewPeriod, month, year, selGroups, selDims, sumAccountCodes, groupDescendantsMap, partiesById, groupDimCodes]);

// Compare-scenario company pivots — same logic as companyPivots but reading
  // from companyDataCmp / companyDataCmpPrev.
  const companyPivotsCmp = useMemo(() => {
    const buildPivot = (rows) => {
      const p = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (sumAccountCodes.has(ac)) return;
        if (acType && acType !== "P/L") return;
if (Array.isArray(cmpSelDims)) {
          if (cmpSelDims.length === 0) return;
          const dimPairs = parseDimensions(r.Dimensions);
          const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
          if (!cmpSelDims.some(d => rowDimCodes.has(d))) return;
        } else if (Array.isArray(cmpSelGroups)) {
          if (cmpSelGroups.length === 0) return;
          const dimPairs = parseDimensions(r.Dimensions);
          const rowGroups = new Set(dimPairs.map(([g]) => g));
          if (!cmpSelGroups.some(g => rowGroups.has(g))) return;
        }
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);
      });
      return p;
    };
const pivots = new Map();
    const cmpPartyCtx = (co) => ({
      company: co,
      year: parseInt(cmpYear) || null,
      month: parseInt(cmpMonth) || null,
      selectedDims: (Array.isArray(cmpSelDims) && cmpSelDims.length > 0) ? new Set(cmpSelDims) : null,
    });
companyDataCmp.forEach((rows, co) => {
      const currPivot = buildPivot(rows);
      currPivot.__parties = partiesById;
      currPivot.__partyContext = cmpPartyCtx(co);
      currPivot.__variationScope = { kind: "company", key: co };
      if (viewPeriod === "ytd") {
        pivots.set(co, currPivot);
      } else {
        const prevRows = companyDataCmpPrev.get(co) ?? [];
        const prevPivot = buildPivot(prevRows);
const monthlyPivot = new Map();
        const isJanuary = parseInt(cmpMonth) === 1;
        const allCodes = new Set([...currPivot.keys(), ...prevPivot.keys()]);
        allCodes.forEach(ac => {
          const currYTD = currPivot.get(ac) ?? 0;
          const prevYTD = isJanuary ? 0 : (prevPivot.get(ac) ?? 0);
          monthlyPivot.set(ac, currYTD - prevYTD);
        });
        if (currPivot.__dimPivot) {
          const monthlyDimPivot = new Map();
          const allDimKeys = new Set([
            ...currPivot.__dimPivot.keys(),
            ...(prevPivot.__dimPivot?.keys() ?? []),
          ]);
          allDimKeys.forEach(key => {
            const currVal = currPivot.__dimPivot.get(key) ?? 0;
            const prevVal = isJanuary ? 0 : (prevPivot.__dimPivot?.get(key) ?? 0);
            monthlyDimPivot.set(key, currVal - prevVal);
          });
          monthlyPivot.__dimPivot = monthlyDimPivot;
        }
monthlyPivot.__parties = partiesById;
        monthlyPivot.__partyContext = cmpPartyCtx(co);
        monthlyPivot.__variationScope = { kind: "company", key: co };
        pivots.set(co, monthlyPivot);
      }
    });
    return pivots;
}, [companyDataCmp, companyDataCmpPrev, viewPeriod, cmpMonth, cmpYear, cmpSelGroups, cmpSelDims, sumAccountCodes, partiesById]);

// Dimension-level pivots: one flat pivot per dimension code, aggregating across all companies
  const dimensionPivots = useMemo(() => {
    // Build separate YTD pivots per (dim code) for current and previous, then
    // diff them when viewPeriod === "monthly".
const buildDimPivots = (dataMap) => {
      const pivots = new Map();
      dataMap.forEach((rows, co) => {
if (selCompanies && selCompanies.length > 0 && !selCompanies.includes(co)) return;
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;

          const dimPairs = parseDimensions(r.Dimensions);
          if (dimPairs.length === 0) return;

for (const [group, code] of dimPairs) {
if (groupDimCodes && !groupDimCodes.has(code)) continue;
            if (Array.isArray(selGroups)) {
              if (selGroups.length === 0) continue;
              if (!selGroups.includes(group)) continue;
            }

            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            const key = code;
            const dimEntry = dimensions.find(d => (d.DimensionCode ?? d.dimensionCode ?? "") === code);
          const dimName = dimEntry?.DimensionName ?? dimEntry?.dimensionName ?? code;
if (!pivots.has(key)) {
              const p = new Map();
              p.__dimPivot = new Map();
              p.__groupDescendants = groupDescendantsMap;
              pivots.set(key, { name: dimName, group, pivot: p });
            }
            const entry = pivots.get(key);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
            // Also index every (group, code) dim pair on this row so overrides
            // like "A.05 · Territorio: DK" resolve within a dim column.
            dimPairs.forEach(([g2, c2]) => {
              const k = `${ac}:::${g2}:::${c2}`;
              entry.pivot.__dimPivot.set(k, (entry.pivot.__dimPivot.get(k) ?? 0) + amt);
            });
          }
        });
      });
      return pivots;
    };

    // Attach the party context to every dim pivot so `case "party"` in the
    // evaluator can resolve parties in the dimension view/export too. The
    // context uses the first selected company as the party lookup key.
const attachPartyCtx = (pivots) => {
      const co = selCompanies?.[0] ?? null;
      pivots.forEach((entry, key) => {
        entry.pivot.__parties = partiesById;
        entry.pivot.__partyContext = {
          company: co,
          year: parseInt(year),
          month: parseInt(month),
          selectedDims: groupDimCodes ?? null,
        };
        entry.pivot.__variationScope = { kind: "dimension", key };
      });
      return pivots;
    };

    const currPivots = attachPartyCtx(buildDimPivots(companyData));
    if (viewPeriod === "ytd") return currPivots;

    // Monthly = curr YTD - prev YTD per dim
const prevPivots = buildDimPivots(companyDataPrev);
    const isJanuary = parseInt(month) === 1;
    const result = new Map();
    const allKeys = new Set([...currPivots.keys(), ...prevPivots.keys()]);
    allKeys.forEach(key => {
      const curr = currPivots.get(key);
      const prev = prevPivots.get(key);
      const meta = curr ?? prev;
      const monthlyPivot = new Map();
      const allCodes = new Set([
        ...(curr?.pivot.keys() ?? []),
        ...(prev?.pivot.keys() ?? []),
      ]);
      allCodes.forEach(ac => {
        const currVal = curr?.pivot.get(ac) ?? 0;
        const prevVal = isJanuary ? 0 : (prev?.pivot.get(ac) ?? 0);
        monthlyPivot.set(ac, currVal - prevVal);
      });
      // Diff the per-dim sub-lookup too so overrides work in monthly mode
      const mdp = new Map();
      const cDP = curr?.pivot.__dimPivot ?? new Map();
      const pDP = prev?.pivot.__dimPivot ?? new Map();
      new Set([...cDP.keys(), ...pDP.keys()]).forEach(k => {
        mdp.set(k, (cDP.get(k) ?? 0) - (isJanuary ? 0 : (pDP.get(k) ?? 0)));
      });
      monthlyPivot.__dimPivot = mdp;
      monthlyPivot.__groupDescendants = groupDescendantsMap;
result.set(key, { name: meta.name, group: meta.group, pivot: monthlyPivot });
    });
    return attachPartyCtx(result);
}, [companyData, companyDataPrev, viewPeriod, month, year, groupDimCodes, sumAccountCodes, selGroups, selCompanies, dimensions, partiesById]);
  // Compare-scenario dimension pivots — mirrors dimensionPivots but reads
  // from companyDataCmp / companyDataCmpPrev with cmpMonth as the period.
  const dimensionPivotsCmp = useMemo(() => {
    const buildDimPivots = (dataMap) => {
      const pivots = new Map();
      dataMap.forEach(rows => {
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;

          const dimPairs = parseDimensions(r.Dimensions);
          if (dimPairs.length === 0) return;

for (const [group, code] of dimPairs) {
if (cmpGroupDimCodes && !cmpGroupDimCodes.has(code)) continue;
            if (Array.isArray(cmpSelGroups)) {
              if (cmpSelGroups.length === 0) continue;
              if (!cmpSelGroups.includes(group)) continue;
            }

            const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
            const key = code;
            if (!pivots.has(key)) pivots.set(key, { name: code, group, pivot: new Map() });
            const entry = pivots.get(key);
            entry.pivot.set(ac, (entry.pivot.get(ac) ?? 0) + amt);
          }
        });
      });
      return pivots;
    };

const attachPartyCtx = (pivots) => {
    const co = selCompanies?.[0] ?? null;
      pivots.forEach((entry, key) => {
        entry.pivot.__parties = partiesById;
        entry.pivot.__partyContext = {
          company: co,
          year: parseInt(cmpYear),
          month: parseInt(cmpMonth),
          selectedDims: cmpGroupDimCodes ?? null,
        };
        entry.pivot.__variationScope = { kind: "dimension", key };
      });
      return pivots;
    };

    const currPivots = attachPartyCtx(buildDimPivots(companyDataCmp));
    if (viewPeriod === "ytd") return currPivots;

    const prevPivots = buildDimPivots(companyDataCmpPrev);
    const isJanuary = parseInt(cmpMonth) === 1;
    const result = new Map();
    const allKeys = new Set([...currPivots.keys(), ...prevPivots.keys()]);
    allKeys.forEach(key => {
      const curr = currPivots.get(key);
      const prev = prevPivots.get(key);
      const meta = curr ?? prev;
      const monthlyPivot = new Map();
      const allCodes = new Set([
        ...(curr?.pivot.keys() ?? []),
        ...(prev?.pivot.keys() ?? []),
      ]);
      allCodes.forEach(ac => {
        const currVal = curr?.pivot.get(ac) ?? 0;
        const prevVal = isJanuary ? 0 : (prev?.pivot.get(ac) ?? 0);
        monthlyPivot.set(ac, currVal - prevVal);
      });
result.set(key, { name: meta.name, group: meta.group, pivot: monthlyPivot });
    });
    return attachPartyCtx(result);
}, [companyDataCmp, companyDataCmpPrev, viewPeriod, cmpMonth, cmpYear, cmpGroupDimCodes, sumAccountCodes, cmpSelGroups, selCompanies, partiesById]);

const dimensionCodes = useMemo(() => [...dimensionPivots.keys()].sort(), [dimensionPivots]);

  // Collect all account codes and dim codes available
const allAccountCodes = useMemo(() => {
    const codes = new Set();
    companyPivots.forEach(p => p.forEach((_, ac) => codes.add(ac)));
    return [...codes].sort();
  }, [companyPivots]);

// Local (posting) accounts gathered from journal rows — what the "Cuenta local" picker shows
const allLocalAccounts = useMemo(() => {
  const m = new Map();
  companyData.forEach(rows => {
    rows.forEach(r => {
      const lac = String(r.LocalAccountCode ?? r.localAccountCode ?? "").trim();
      if (!lac || lac === "—") return;
      if (m.has(lac)) return;
      const lan = String(r.LocalAccountName ?? r.localAccountName ?? "").trim();
      m.set(lac, lan);
    });
  });
  return [...m.entries()].map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}, [companyData]);

// Group accounts list (with names + sum flag) — what the "Cuenta de grupo" picker shows
const allGroupAccountsList = useMemo(() => {
  return groupAccounts.map(g => ({
    code: String(g.accountCode ?? g.AccountCode ?? ""),
    name: String(g.accountName ?? g.AccountName ?? ""),
    isSum: !!(g.isSumAccount ?? g.IsSumAccount),
    parent: String(g.sumAccountCode ?? g.SumAccountCode ?? ""),
  })).filter(g => g.code)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}, [groupAccounts]);



const accountCodeLabels = useMemo(() => {
    const map = new Map();
    groupAccounts.forEach(g => {
      const code = String(g.accountCode ?? g.AccountCode ?? "");
      const name = String(g.accountName ?? g.AccountName ?? g.name ?? "");
      if (code) map.set(code, name);
    });
    allLocalAccounts.forEach(({ code, name }) => {
      if (!map.has(code) && name) map.set(code, name);
    });
    return map;
  }, [groupAccounts, allLocalAccounts]);
// Build dimsByAccount from actual data rows: Map<accountCode, [{group, code, name}]>
  const dimsByAccount = useMemo(() => {
    // Build a code → name lookup from the dimensions prop
    const dimNameLookup = new Map();
dimensions.forEach(d => {
      const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "");
      const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "");
      if (code && name) {
        dimNameLookup.set(code, name);
        // Also index by name in case the API returns the name as the "code"
        dimNameLookup.set(name, name);
      }
    });

const map = new Map();
    companyData.forEach(rows => {
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
        if (!ac || !dimsRaw || dimsRaw === "—") return;
        const pairs = parseDimensions(dimsRaw);
        if (!pairs.length) return;
        if (!map.has(ac)) map.set(ac, new Map());
        pairs.forEach(([group, rawCode]) => {
          if (!group || !rawCode) return;
          // rawCode is what appears in the data (could be "2", "1", "UK", etc.)
          // dimNameLookup maps that code → human name ("Producción", "España"…)
          const name = dimNameLookup.get(rawCode) ?? rawCode;
          const key = `${group}:::${rawCode}`;
          if (!map.get(ac).has(key)) {
            map.get(ac).set(key, { group, code: rawCode, name });
          }
        });
      });
    });
    const result = new Map();
    map.forEach((inner, ac) => result.set(ac, [...inner.values()]));
    return result;
  }, [companyData, dimensions]);

// Dims keyed by LOCAL account code (mirrors dimsByAccount but for the local picker)
const localDimsByAccount = useMemo(() => {
  const dimNameLookup = new Map();
  dimensions.forEach(d => {
    const code = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? "");
    const name = String(d.dimensionName ?? d.DimensionName ?? d.name ?? "");
    if (code && name) { dimNameLookup.set(code, name); dimNameLookup.set(name, name); }
  });
  const map = new Map();
  companyData.forEach(rows => {
    rows.forEach(r => {
      const lac = String(r.LocalAccountCode ?? r.localAccountCode ?? "").trim();
      const dimsRaw = r.Dimensions ?? r.dimensions ?? "";
      if (!lac || lac === "—" || !dimsRaw || dimsRaw === "—") return;
      const pairs = parseDimensions(dimsRaw);
      if (!pairs.length) return;
      if (!map.has(lac)) map.set(lac, new Map());
      pairs.forEach(([group, rawCode]) => {
        if (!group || !rawCode) return;
        const name = dimNameLookup.get(rawCode) ?? rawCode;
        const key = `${group}:::${rawCode}`;
        if (!map.get(lac).has(key)) map.get(lac).set(key, { group, code: rawCode, name });
      });
    });
  });
  const result = new Map();
  map.forEach((inner, lac) => result.set(lac, [...inner.values()]));
  return result;
}, [companyData, dimensions]);

// isAlphaStructure removed — KpiResolver detects the standard now.

 // adaptedKpiList removed — KpiResolver loads KPIs already in the active
  // standard's vocabulary via cc_tag mapping.

useEffect(() => { window.__debug_companyPivots = companyPivots; }, [companyPivots]);

const companyResults = useMemo(() => {
    const results = new Map();
companyPivots.forEach((pivot, co) => {
      results.set(co, computeAllKpisResolved(kpiList, pivot, ccTagToCodes, sectionCodes, resolvedAllKpis));
    });
    return results;
  }, [companyPivots, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  const companyResultsCmp = useMemo(() => {
    const results = new Map();
    companyPivotsCmp.forEach((pivot, co) => {
      results.set(co, computeAllKpisResolved(kpiList, pivot, ccTagToCodes, sectionCodes, resolvedAllKpis));
    });
    return results;
  }, [companyPivotsCmp, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

 // Dimension-level results: one KPI map per dimension code
  const dimensionResults = useMemo(() => {
    const results = new Map();
    dimensionPivots.forEach((entry, key) => {
      const r = computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis);
      results.set(key, r);
    });
    return results;
  }, [dimensionPivots, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);

  const dimensionResultsCmp = useMemo(() => {
    const results = new Map();
    dimensionPivotsCmp.forEach((entry, key) => {
      const r = computeAllKpisResolved(kpiList, entry.pivot, ccTagToCodes, sectionCodes, resolvedAllKpis);
      results.set(key, r);
    });
    return results;
  }, [dimensionPivotsCmp, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis]);
// KPI CRUD — three paths:
  //   1. Editing existing → UPDATE library entry (visible to other users too)
  //   2. Clicked existing in library picker → ADD to dashboard only
  //   3. New from preset / custom builder → CREATE in library + ADD to dashboard
  const saveKpi = useCallback(async (data) => {
    if (!companyId || !authUserId) {
      alert("Sesión o empresa no resueltas — no se puede guardar.");
      return;
    }

// Path 1: editing existing KPI from the table pencil icon
    if (editingKpi !== "new" && editingKpi && typeof editingKpi === "object" && editingKpi.id) {
const inLibrary = companyKpis.some(k => k.kpi_id === editingKpi.id && !k.tag?.startsWith(OVERRIDE_TAG_PREFIX));
      const isBuiltIn = builtInKpiIds.has(editingKpi.id);
      const sourceSystemId = editingKpi._sourceSystemKpiId ?? null;
const labelChanged = data.label !== editingKpi.label;

      // If editing a clean system clone, treat as editing the original system KPI
      if (!isBuiltIn && sourceSystemId && builtInKpiIds.has(sourceSystemId)) {
if (!labelChanged) {
          // Benchmark/formula/desc edit on clean clone → promote to independent custom KPI
          // Auto-generate a unique label since the name is taken by the system KPI
          const baseLabel = editingKpi.label;
          const allLabels = new Set([
            ...localKpis.map(k => k.label),
            ...resolvedAllKpis.map(k => k.label),
          ]);
          let n = 2;
          while (allLabels.has(`${baseLabel} ${n}`)) n++;
          const uniqueLabel = `${baseLabel} ${n}`;
          try {
const updated = await updateCompanyKpi({
              kpiId:            editingKpi.id, userId: authUserId,
              label:            uniqueLabel,
              description:      data.description ?? null,
              category:         data.category ?? null,
              tag:              null,
              format:           data.format ?? editingKpi.format,
              formula:          data.formula ?? editingKpi.formula,
              benchmark:        data.benchmark ?? null,
              variations:       data.variations ?? null,
              sourceSystemKpiId: null,
            });
            setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
            setEditingKpi(null);
          } catch (e) { alert(`No se pudo actualizar: ${e.message}`); }
          return;
        } else {
          // Label changed → promote to full custom KPI, clear sourceSystemKpiId
          try {
const updated = await updateCompanyKpi({
              kpiId: editingKpi.id, userId: authUserId,
              label:            data.label,
              description:      data.description ?? null,
              category:         data.category ?? null,
              tag:              null,
              format:           data.format ?? "currency",
              formula:          data.formula,
              benchmark:        data.benchmark ?? null,
              variations:       data.variations ?? null,
              sourceSystemKpiId: null,
            });
            setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
            setEditingKpi(null);
          } catch (e) { alert(`No se pudo actualizar: ${e.message}`); }
          return;
        }
      }

      // If label/description changed on a built-in → promote to full custom KPI


if (isBuiltIn && !labelChanged) {
        // Any edit on built-in without label change → save as system override (shows 'edited')
await saveSystemOverride(editingKpi.id, {
          label:       editingKpi.label,
          description: data.description,
          category:    data.category,
          format:      data.format ?? editingKpi.format,
          formula:     data.formula ?? editingKpi.formula,
          benchmark:   data.benchmark,
          variations:  data.variations ?? null,
        });
        setEditingKpi(null);
        return;
      }

      if (!inLibrary && isBuiltIn && labelChanged) {
        // Promote built-in to full custom KPI
        try {
const created = await createCompanyKpi({
            companyId, userId: authUserId,
            label:       data.label,
            description: data.description ?? null,
            category:    data.category ?? null,
            tag:         data.tag ?? null,
            format:      data.format ?? "currency",
            formula:     data.formula ?? editingKpi.formula,
            benchmark:   data.benchmark ?? null,
            variations:  data.variations ?? null,
            contextMappingId: null,
            scope: "individual",
          });
setCompanyKpis(prev => [...prev, created]);
          // Replace in dashboard
setDashboardKpiIds(prev => {
            if (!prev) return prev;
const next = prev.map(id => id === editingKpi.id ? created.kpi_id : id);
            const scope = viewMode === "dimension" ? "individual_dimension" : "individual_company";
            (async () => {
              try {
                await saveUserDashboard({ userId: authUserId, companyId, kpiIds: next, scope });
              } catch (e) {
                console.error("[KpiPage] dashboard persist FAILED after promote:", e);
              }
            })();
            return next;
          });
          setEditingKpi(null);
        } catch (e) { alert(`Could not promote KPI: ${e.message}`); }
        return;
      }

      if (!inLibrary) {
        setEditingKpi(null);
        return;
      }
try {
const updated = await updateCompanyKpi({
          kpiId:            editingKpi.id, userId: authUserId,
          label:            data.label,
          description:      data.description ?? null,
          category:         data.category    ?? null,
          tag:              data.tag         ?? null,
          format:           data.format      ?? "currency",
          formula:          data.formula,
          benchmark:        data.benchmark   ?? null,
          variations:       data.variations  ?? null,
          sourceSystemKpiId: null,
        });
        setCompanyKpis(prev => prev.map(k => k.kpi_id === updated.kpi_id ? updated : k));
        setEditingKpi(null);
      } catch (e) {
        alert(`No se pudo actualizar: ${e.message}`);
      }
      return;
    }

const activeScope = viewMode === "dimension" ? "individual_dimension" : "individual_company";

    // Path 2a: system KPI from library picker → just add id to dashboard, no library entry
const resolveSystemId = (data) => {
      if (data.id && builtInKpiIds.has(data.id)) return data.id;
      if (data._fromLibrary) {
        const strippedId = (data.id ?? "").replace(/^_lib_/, "");
        if (strippedId && builtInKpiIds.has(strippedId)) return strippedId;
      }
      return null;
    };

const systemId = resolveSystemId(data);
    if (systemId) {
const activeOverrideMap = viewMode === "dimension" ? systemOverrides.dim : systemOverrides.comp;
      if (activeOverrideMap.has(systemId)) {
        // An edited version already exists — create a clean copy with its own UUID
        const base = resolvedAllKpis.find(k => k.id === systemId);
        if (base) {
          try {
const created = await createCompanyKpi({
              companyId, userId: authUserId,
              label:            base.label,
              description:      base.description ?? null,
              category:         base.category ?? null,
              tag:              null,
              format:           base.format ?? "currency",
              formula:          base.formula,
              benchmark:        base.benchmark ?? null,
              variations:       base.variations ?? null,
              contextMappingId: null,
              scope:            "individual",
              kpiType:          "custom",
              sourceSystemKpiId: systemId,
            });
            setCompanyKpis(prev => [...prev, created]);
            addToDashboard(created.kpi_id, activeScope);
            setEditingKpi(null);
            return;
          } catch (e) { alert(`No se pudo crear: ${e.message}`); return; }
        }
      }
      addToDashboard(systemId, activeScope);
      setEditingKpi(null);
      return;
    }

    // Path 2b: existing custom KPI from library picker → just add to dashboard
    const existing = data.id ? companyKpis.find(k => k.kpi_id === data.id) : null;
    if (existing) {
      addToDashboard(existing.kpi_id, activeScope);
      setEditingKpi(null);
      return;
    }

// Path 3: brand-new KPI (preset or custom builder) → create in library + add to dashboard
    try {
const created = await createCompanyKpi({
        companyId, userId: authUserId,
        label:       data.label,
        description: data.description ?? null,
        category:    data.category    ?? null,
        tag:         (data.tag && !data.tag.startsWith("__")) ? data.tag : null,
        format:      data.format      ?? "currency",
        formula:     data.formula,
        benchmark:   data.benchmark   ?? null,
        variations:  data.variations  ?? null,
        contextMappingId: activeMapping?.mapping_id ?? null,
        scope: "individual",
      });
setCompanyKpis(prev => [...prev, created]);
      addToDashboard(created.kpi_id, activeScope);
      setEditingKpi(null);
      refreshCompanyKpis();
    } catch (e) {
      alert(`No se pudo crear: ${e.message}`);
    }
}, [companyId, authUserId, editingKpi, activeMapping, companyKpis, addToDashboard, refreshCompanyKpis,
      builtInKpiIds, localKpis, resolvedAllKpis, saveSystemOverride, systemOverrides.comp, systemOverrides.dim, viewMode]);
  // Trash icon removes the KPI from THIS user's dashboard only — the library
  // entry stays so other users on the company still have it.
const deleteKpi = useCallback((id) => {
    const scope = viewMode === "dimension" ? "individual_dimension" : "individual_company";
    removeFromDashboard(id, scope);
  }, [removeFromDashboard, viewMode]);

const fetchSectionData = useCallback(async (sectionConfig) => {
    const { company, companies: companiesArg, startY, startM, endY, endM, source: secSource, structure: secStructure,
            dimGroup, dim, mode, kpiIds } = sectionConfig;

    const companies = Array.isArray(companiesArg) && companiesArg.length > 0
      ? companiesArg
      : (company ? [company] : []);
    if (!token || !secSource || !secStructure || companies.length === 0) return [];

    const periods = [];
    let pY = parseInt(startY), pM = parseInt(startM) - 1;
    if (pM < 1) { pM = 12; pY -= 1; }
    periods.push({ y: pY, m: pM, isPrior: true });
    let y = parseInt(startY), m = parseInt(startM);
    const eY = parseInt(endY), eM = parseInt(endM);
    while (y < eY || (y === eY && m <= eM)) {
      periods.push({ y, m, isPrior: false });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (periods.length > 120) break;
    }

const cFilter = companies.map(c => `CompanyShortName eq '${c}'`).join(" or ");
    const results = await Promise.all(periods.map(async ({ y, m, isPrior }) => {
      const filter = `Year eq ${y} and Month eq ${m} and Source eq '${secSource}' and GroupStructure eq '${secStructure}' and (${cFilter})`;
      try {
        const res = await fetch(
          `${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );
        if (!res.ok) return { y, m, isPrior, pivot: new Map(), hasData: false };
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        const p = new Map();
        // Same filter logic as on-screen GraphSection.fetchChartData
        rows.forEach(r => {
          const ac = r.AccountCode ?? r.accountCode ?? "";
          const acType = r.AccountType ?? r.accountType ?? "";
          if (!ac) return;
          if (sumAccountCodes && sumAccountCodes.has(ac)) return;
          if (acType && acType !== "P/L") return;
const hasDim   = Array.isArray(dim)      ? dim.length      > 0 : !!dim;
          const hasGroup = Array.isArray(dimGroup) ? dimGroup.length > 0 : !!dimGroup;
          if (hasDim || hasGroup) {
            const dimPairs = parseDimensions(r.Dimensions);
            if (hasDim) {
              const dimArr = Array.isArray(dim) ? dim : [dim];
              const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
              if (!dimArr.some(d => rowDimCodes.has(d))) return;
            } else if (hasGroup) {
              const grpArr = Array.isArray(dimGroup) ? dimGroup : [dimGroup];
              if (!grpArr.some(g => dimPairs.some(([rg]) => rg === g))) return;
            }
          }
          const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
          p.set(ac, (p.get(ac) ?? 0) + amt);
        });
        return { y, m, isPrior, pivot: p, hasData: rows.length > 0 };
      } catch {
        return { y, m, isPrior, pivot: new Map(), hasData: false };
      }
    }));

    const series = [];
    for (let i = 1; i < results.length; i++) {
      const curr = results[i];
      if (curr.isPrior) continue;
      let pivotForKpi;
      if (mode === "ytd") {
        pivotForKpi = curr.pivot;
      } else {
        const prev = results[i - 1];
        const mp = new Map();
        const allCodes = new Set([...curr.pivot.keys(), ...prev.pivot.keys()]);
        allCodes.forEach(ac => {
          const currYTD = curr.pivot.get(ac) ?? 0;
          const prevYTD = curr.m === 1 ? 0 : (prev.pivot.get(ac) ?? 0);
          mp.set(ac, currYTD - prevYTD);
        });
        pivotForKpi = mp;
      }
const kpis = computeAllKpisResolved(kpiList, pivotForKpi, ccTagToCodes, sectionCodes, resolvedAllKpis);
      const label = `${String(curr.m).padStart(2, "0")}/${String(curr.y).slice(-2)}`;
      const row = { period: label };
      kpiIds.forEach(kid => {
        const v = kpis.get(kid);
        row[kid] = (v === null || v === undefined || isNaN(v)) ? null : v;
      });
      series.push(row);
    }
    return series;
}, [token, kpiList, ccTagToCodes, sectionCodes, resolvedAllKpis, sumAccountCodes]);

// Build graph sections — read live state (incl. compare bars), fetch both modes for primary + each cmp bar, merge into wide rows
const buildGraphSections = useCallback(async () => {
    const result = [];
    for (const sid of [1]) {
      const live = graphSectionsRef.current[sid];

      const defaults = (() => {
        const anchorY = parseInt(year) || new Date().getFullYear();
        const anchorM = parseInt(month) || new Date().getMonth() + 1;
        let sY = anchorY, sM = anchorM - 11;
        while (sM < 1) { sM += 12; sY -= 1; }
        return {
          startY: String(sY), startM: String(sM),
          endY:   String(anchorY), endM: String(anchorM),
          source, structure,
        };
      })();

      const baseConfig = {
        sectionId: sid,
        companies: (live?.companies?.length ? live.companies : (companyCodes[0] ? [companyCodes[0]] : [])),
        startY:   live?.startY   ?? defaults.startY,
        startM:   live?.startM   ?? defaults.startM,
        endY:     live?.endY     ?? defaults.endY,
        endM:     live?.endM     ?? defaults.endM,
        source:   live?.source   ?? defaults.source,
        structure: live?.structure ?? defaults.structure,
        dimGroup: live?.dimGroup ?? "",
        dim:      live?.dim      ?? "",
        kpiIds:   (live?.kpiIds?.length ? live.kpiIds : ["revenue", "gross_profit", "net_result"]),
      };

      const cmpBars = Array.isArray(live?.cmpBars) ? live.cmpBars : [];
      const isCompare = cmpBars.length > 0;
      const liveCmpData = live?.cmpChartData ?? {};
      const liveMain = Array.isArray(live?.chartData) ? live.chartData : null;
      const liveMode = live?.mode ?? "ytd";

      // Build series config — primary uses navy (or rainbow when not in compare),
      // each cmp bar gets its own color, dashes differentiate KPIs within a source
      const CMP_COLORS = { B: "#CF305D", C: "#10B981" };
      const RAINBOW    = ["#1a2f8a", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
      const series = [];
      baseConfig.kpiIds.forEach((kid, i) => {
        const kpi = kpiList.find(k => k.id === kid);
        series.push({
          key:    `a__${kid}`,
          label:  isCompare ? `A · ${kpi?.label ?? kid}` : (kpi?.label ?? kid),
          color:  isCompare ? "#1a2f8a" : RAINBOW[i % RAINBOW.length],
          dash:   isCompare && i === 1 ? "5 4" : undefined,
          kpiId:  kid,
          barId:  "a",
          format: kpi?.format,
        });
      });
      cmpBars.forEach(bar => {
        baseConfig.kpiIds.slice(0, 2).forEach((kid, i) => {
          const kpi = kpiList.find(k => k.id === kid);
          series.push({
            key:    `${bar.id}__${kid}`,
            label:  `${bar.id} · ${kpi?.label ?? kid}`,
            color:  CMP_COLORS[bar.id] ?? "#CF305D",
            dash:   i === 1 ? "5 4" : undefined,
            kpiId:  kid,
            barId:  bar.id,
            format: kpi?.format,
          });
        });
      });

      // Merge primary array + cmp data map into wide rows keyed by `barId__kpiId`
      const mergeRows = (primaryArr, cmpDataMap) => {
        const allPeriods = new Set();
        (primaryArr ?? []).forEach(d => allPeriods.add(d.period));
        Object.values(cmpDataMap ?? {}).forEach(arr => (arr ?? []).forEach(d => allPeriods.add(d.period)));
        return [...allPeriods].sort().map(period => {
          const row = { period };
          const pRow = (primaryArr ?? []).find(d => d.period === period) ?? {};
          baseConfig.kpiIds.forEach(kid => { row[`a__${kid}`] = Number.isFinite(pRow[kid]) ? pRow[kid] : null; });
          Object.entries(cmpDataMap ?? {}).forEach(([barId, arr]) => {
            const barRow = (arr ?? []).find(d => d.period === period) ?? {};
            baseConfig.kpiIds.forEach(kid => { row[`${barId}__${kid}`] = Number.isFinite(barRow[kid]) ? barRow[kid] : null; });
          });
          return row;
        });
      };

      // Fetch fresh data for one mode — primary + each cmp bar
      const fetchModeData = async (mode) => {
        const primary = await fetchSectionData({ ...baseConfig, mode });
        const cmpMap = {};
        for (const bar of cmpBars) {
          cmpMap[bar.id] = await fetchSectionData({
            mode,
            companies: bar.companies,
            startY: baseConfig.startY, startM: baseConfig.startM,
            endY:   baseConfig.endY,   endM:   baseConfig.endM,
            source: bar.source, structure: bar.structure,
            dimGroup: bar.dimGroup ?? "", dim: bar.dim ?? "",
            kpiIds: baseConfig.kpiIds,
          });
        }
        return { primary, cmpMap };
      };

      // Use live data for the mode user is currently viewing, fetch the other
      let ytdMerged, monthlyMerged;
      if (liveMain && liveMain.length > 0 && liveMode === "ytd") {
        ytdMerged = mergeRows(liveMain, liveCmpData);
        const m = await fetchModeData("monthly");
        monthlyMerged = mergeRows(m.primary, m.cmpMap);
      } else if (liveMain && liveMain.length > 0 && liveMode === "monthly") {
        monthlyMerged = mergeRows(liveMain, liveCmpData);
        const y = await fetchModeData("ytd");
        ytdMerged = mergeRows(y.primary, y.cmpMap);
      } else {
        const [y, m] = await Promise.all([fetchModeData("ytd"), fetchModeData("monthly")]);
        ytdMerged     = mergeRows(y.primary, y.cmpMap);
        monthlyMerged = mergeRows(m.primary, m.cmpMap);
      }

      const renderImg = async (data) => {
        if (!data || data.length === 0) return null;
        try { return await renderChartToImage({ data, series }); }
        catch (e) { console.warn("Chart render failed:", e); return null; }
      };
      const [ytdImg, monthlyImg] = await Promise.all([renderImg(ytdMerged), renderImg(monthlyMerged)]);

      result.push({
        sectionId: sid,
        company: baseConfig.companies.join(", "),
        companies: baseConfig.companies,
        startY: baseConfig.startY, startM: baseConfig.startM,
        endY:   baseConfig.endY,   endM:   baseConfig.endM,
        source: baseConfig.source, structure: baseConfig.structure,
        dimGroup: baseConfig.dimGroup, dim: baseConfig.dim,
        kpiIds: baseConfig.kpiIds,
        ytdData:     ytdMerged,     ytdImg,
        monthlyData: monthlyMerged, monthlyImg,
        series,
        compareMode: isCompare,
      });
    }
    return result;
}, [companyCodes, source, structure, year, month, kpiList, fetchSectionData]);

const buildExportPayload = async () => {
    const fullCompanyLabels = filteredCompanyCodes.map(c => companyLegalName(c));

    // Each tab has its OWN dashboard selection. Build both KPI lists so the
    // company sheet and the dimension sheet each show their own KPIs.
    const kpiListCompany   = buildKpiList(dashboardKpiIds);
    const kpiListDimension = buildKpiList(dashboardKpiIdsDim);

    // === Compute YTD + Monthly results inline for export ===
    const buildPivotOne = (rows, applyDimFilter, gFilter, dFilter) => {
      const p = new Map();
      const localPivot = new Map();
      const localDimPivot = new Map();
      const dimPivot = new Map();
      rows.forEach(r => {
        const ac = r.AccountCode ?? r.accountCode ?? "";
        const lac = String(r.LocalAccountCode ?? r.localAccountCode ?? "").trim();
        const acType = r.AccountType ?? r.accountType ?? "";
        if (!ac) return;
        if (sumAccountCodes.has(ac)) return;
        if (acType && acType !== "P/L") return;
        const dimPairs = parseDimensions(r.Dimensions ?? r.dimensions ?? "");
        if (applyDimFilter) {
          if (Array.isArray(dFilter)) {
            if (dFilter.length === 0) return;
            const rowDimCodes = new Set(dimPairs.map(([, code]) => code));
            if (!dFilter.some(d => rowDimCodes.has(d))) return;
          } else if (Array.isArray(gFilter)) {
            if (gFilter.length === 0) return;
            const rowGroups = new Set(dimPairs.map(([g]) => g));
            if (!gFilter.some(g => rowGroups.has(g))) return;
          }
        }
        const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
        p.set(ac, (p.get(ac) ?? 0) + amt);
        if (lac && lac !== "—") localPivot.set(lac, (localPivot.get(lac) ?? 0) + amt);
        dimPairs.forEach(([dGroup, dCode]) => {
          if (!dGroup || !dCode) return;
          const key = `${ac}:::${dGroup}:::${dCode}`;
          dimPivot.set(key, (dimPivot.get(key) ?? 0) + amt);
          if (lac && lac !== "—") localDimPivot.set(`${lac}:::${dGroup}:::${dCode}`, (localDimPivot.get(`${lac}:::${dGroup}:::${dCode}`) ?? 0) + amt);
        });
      });
p.__dimPivot      = dimPivot;
      p.__localPivot    = localPivot;
      p.__localDimPivot = localDimPivot;
      p.__groupDescendants = groupDescendantsMap;
      // party context set by caller (needs company/year/month) — see buildResultsFor
      return p;
    };

    const diffPivots = (curr, prev, isJan) => {
      const out = new Map();
      new Set([...curr.keys(), ...prev.keys()]).forEach(k => {
        out.set(k, (curr.get(k) ?? 0) - (isJan ? 0 : (prev.get(k) ?? 0)));
      });
      const diffSub = (a, b) => {
        const r = new Map();
        new Set([...(a ?? new Map()).keys(), ...(b ?? new Map()).keys()]).forEach(k => {
          r.set(k, ((a?.get(k)) ?? 0) - (isJan ? 0 : ((b?.get(k)) ?? 0)));
        });
        return r;
      };
out.__dimPivot      = diffSub(curr.__dimPivot, prev.__dimPivot);
      out.__localPivot    = diffSub(curr.__localPivot, prev.__localPivot);
      out.__localDimPivot = diffSub(curr.__localDimPivot, prev.__localDimPivot);
      out.__groupDescendants = groupDescendantsMap;
      out.__parties = curr.__parties;
      out.__partyContext = curr.__partyContext;
      return out;
    };

// Resolve every variable letter for every KPI against a pivot. Returns
    // Map<kpiId, Map<letter, number>>. Only KPIs with a text-formula have vars.
const resolveVarsFor = (kList, pivot) => {
      const out = new Map();
      const cache = new Map();
      const scope = pivot.__variationScope;
      kList.forEach(kpi => {
        const flat = flattenFormulaToTextForm(kpi.formula);
        if (!flat || !flat.variables) return;
        const letterMap = new Map();
        pivot.__currentKpiVariations = kpi.variations ?? null;
        Object.entries(flat.variables).forEach(([letter, node]) => {
          if (!node) return;
          let effectiveNode = node;
          if (scope && kpi.variations) {
            const map = scope.kind === "company" ? kpi.variations.byCompany
                      : scope.kind === "dimension" ? kpi.variations.byDimension
                      : null;
            const override = map?.[scope.key]?.[letter];
            if (override) {
              // Normalize :::-packed prefix / accountCode into fields
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
          try {
            const v = evalFormulaWithCcTags(effectiveNode, pivot, cache, resolvedAllKpis, ccTagToCodes, sectionCodes);
            if (Number.isFinite(v)) letterMap.set(letter, v);
          } catch { /* ignore */ }
        });
        if (letterMap.size > 0) out.set(kpi.id, letterMap);
      });
      pivot.__currentKpiVariations = null;
      return out;
    };

    const buildResultsFor = (dataMap, prevMap, monthNum, gFilter, dFilter, selectedDims, kList) => {
      const isJan = parseInt(monthNum) === 1;
      const ytdResults = new Map();
      const monthlyResults = new Map();
      const ytdVars = new Map();       // Map<co, Map<kpiId, Map<letter, val>>>
      const monthlyVars = new Map();
      dataMap.forEach((rows, co) => {
        const curr = buildPivotOne(rows, true, gFilter, dFilter);
        const prev = buildPivotOne(prevMap.get(co) ?? [], true, gFilter, dFilter);
        const partyCtx = {
          company: co,
          year: parseInt(year),
          month: parseInt(monthNum),
          selectedDims: selectedDims ?? null,
        };
        curr.__parties = partiesById;
        curr.__partyContext = partyCtx;
        prev.__parties = partiesById;
        prev.__partyContext = partyCtx;
        const monthly = diffPivots(curr, prev, isJan);
        ytdResults.set(co,     computeAllKpisResolved(kList, curr,    ccTagToCodes, sectionCodes, resolvedAllKpis));
        monthlyResults.set(co, computeAllKpisResolved(kList, monthly, ccTagToCodes, sectionCodes, resolvedAllKpis));
        ytdVars.set(co,      resolveVarsFor(kList, curr));
        monthlyVars.set(co,  resolveVarsFor(kList, monthly));
      });
      return {
        ytd: ytdResults, monthly: monthlyResults,
        ytdVars, monthlyVars,
      };
    };

const buildDimResultsFor = (dataMap, prevMap, monthNum, selectedDims, kList) => {
      const isJan = parseInt(monthNum) === 1;
      const buildDim = (dMap) => {
        const out = new Map();
        dMap.forEach((rows, co) => {
          if (selCompanies && selCompanies.length > 0 && !selCompanies.includes(co)) return;
          rows.forEach(r => {
            const ac = r.AccountCode ?? r.accountCode ?? "";
            const acType = r.AccountType ?? r.accountType ?? "";
            if (!ac || sumAccountCodes.has(ac) || (acType && acType !== "P/L")) return;
            const pairs = parseDimensions(r.Dimensions);
            if (pairs.length === 0) return;
            for (const [group, code] of pairs) {
              if (groupDimCodes && !groupDimCodes.has(code)) continue;
              if (Array.isArray(selGroups)) {
                if (selGroups.length === 0) continue;
                if (!selGroups.includes(group)) continue;
              }
              const amt = parseAmt(r.AmountYTD ?? r.amountYTD ?? 0);
              if (!out.has(code)) out.set(code, new Map());
              const m = out.get(code);
              m.set(ac, (m.get(ac) ?? 0) + amt);
            }
          });
        });
        return out;
      };
const currMap = buildDim(dataMap);
      const prevMap2 = buildDim(prevMap);
      const ytdResults = new Map();
      const monthlyResults = new Map();
      const ytdVars = new Map();
      const monthlyVars = new Map();
      const allCodes = new Set([...currMap.keys(), ...prevMap2.keys()]);
      const co = selCompanies?.[0] ?? null;
      allCodes.forEach(code => {
        const curr = currMap.get(code) ?? new Map();
        const prev = prevMap2.get(code) ?? new Map();
        const monthly = new Map();
        new Set([...curr.keys(), ...prev.keys()]).forEach(ac => {
          monthly.set(ac, (curr.get(ac) ?? 0) - (isJan ? 0 : (prev.get(ac) ?? 0)));
        });
        const partyCtx = { company: co, year: parseInt(year), month: parseInt(monthNum), selectedDims: selectedDims ?? null };
        curr.__parties = partiesById;
        curr.__partyContext = partyCtx;
        monthly.__parties = partiesById;
        monthly.__partyContext = partyCtx;
        ytdResults.set(code,     computeAllKpisResolved(kList, curr,    ccTagToCodes, sectionCodes, resolvedAllKpis));
        monthlyResults.set(code, computeAllKpisResolved(kList, monthly, ccTagToCodes, sectionCodes, resolvedAllKpis));
        ytdVars.set(code,      resolveVarsFor(kList, curr));
        monthlyVars.set(code,  resolveVarsFor(kList, monthly));
      });
      return { ytd: ytdResults, monthly: monthlyResults, ytdVars, monthlyVars };
    };

const companyBoth    = buildResultsFor(companyData,    companyDataPrev,    month, selGroups, selDims, groupDimCodes, kpiListCompany);
    const companyCmpBoth = compareMode ? buildResultsFor(companyDataCmp, companyDataCmpPrev, cmpMonth, cmpSelGroups, cmpSelDims, cmpGroupDimCodes, kpiListCompany) : null;
    const dimBoth        = buildDimResultsFor(companyData,    companyDataPrev,    month, groupDimCodes, kpiListDimension);
    const dimCmpBoth     = compareMode ? buildDimResultsFor(companyDataCmp, companyDataCmpPrev, cmpMonth, cmpGroupDimCodes, kpiListDimension) : null;

return {
kpiList: kpiListCompany,             // legacy — used for graphs / single-list callers
      kpiListCompany,
      kpiListDimension,
      // Full resolved list — used for describing ref nodes so variable labels
      // like "A = Revenue" work even when the referenced KPI isn't on the
      // current dashboard tab.
      kpiListFull: resolvedAllKpis,
      companyCodes:        exportOpts.company   ? filteredCompanyCodes : [],
      companyLabels:       exportOpts.company   ? fullCompanyLabels    : [],
      companyResults:      companyBoth,
      companyResultsCmp:   companyCmpBoth,
      dimensionCodes:      exportOpts.dimension ? dimensionCodes : [],
      dimensionResults:    dimBoth,
      dimensionResultsCmp: dimCmpBoth,
      dimensionPivots,
      graphSections:       exportOpts.graphs    ? await buildGraphSections() : [],
      exportOpts,
      accountCodeLabels,
      filters: {
        source, structure, year, month,
        dimGroups: selGroups, dims: selDims,
        companies: fullCompanyLabels,
        compareMode,
        cmpYear, cmpMonth, cmpSource, cmpStructure,
      },
    };
  };

  const _handleExportXlsxRun = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      await exportKpisToXlsx(payload);
    } catch (e) { console.error("Excel export failed:", e); alert("Excel export failed — check console"); }
    finally { setExporting(false); }
  };

  const _handleExportPdfRun = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      await exportKpisToPdf(payload);
    } catch (e) { console.error("PDF export failed:", e); alert("PDF export failed — check console"); }
    finally { setExporting(false); }
  };

  const handleExportXlsx = () => {
    setExportOpts(o => ({ ...o, format: "xlsx" }));
    setExportModal(true);
  };
  const handleExportPdf = () => {
    setExportOpts(o => ({ ...o, format: "pdf" }));
    setExportModal(true);
  };

const handleDragEnd = useCallback(() => {
const activeDashIds = viewMode === "dimension" ? dashboardKpiIdsDim : dashboardKpiIds;
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx && activeDashIds) {
      const newRows = [...kpiList];
      const [moved] = newRows.splice(dragIdx, 1);
      newRows.splice(dragOverIdx, 0, moved);
      const oldVisibleIds = kpiList.map(k => k.id);
      const newVisibleIds = newRows.map(k => k.id);
      const visibleSet = new Set(oldVisibleIds);
      const queue = [...newVisibleIds];
      const newDashboard = activeDashIds.map(id =>
        visibleSet.has(id) ? queue.shift() : id
      );
const scope = viewMode === "dimension" ? "individual_dimension" : "individual_company";
      if (viewMode === "dimension") setDashboardKpiIdsDim(newDashboard);
      else setDashboardKpiIds(newDashboard);
      persistDashboard(newDashboard, scope);
    }
    setDragIdx(null); setDragOverIdx(null);
}, [dragIdx, dragOverIdx, kpiList, dashboardKpiIds, dashboardKpiIdsDim, viewMode, persistDashboard]);

  const handleColDragEnd = () => {
    if (colDragIdx !== null && colDragOverIdx !== null && colDragIdx !== colDragOverIdx) {
      const cols = orderedCols;
      const newCols = [...cols];
      const [moved] = newCols.splice(colDragIdx, 1);
      newCols.splice(colDragOverIdx, 0, moved);
      setColOrder(newCols);
    }
    setColDragIdx(null); setColDragOverIdx(null);
  };



// React Compiler memoizes this automatically; manual useMemo here was blocking optimization.
const filteredCompanyCodes = (!selCompanies || selCompanies.length === 0)
  ? companyCodes
  : companyCodes.filter(c => new Set(selCompanies).has(c));
const activeCols = viewMode === "company" ? filteredCompanyCodes : dimensionCodes;
const activeResults = viewMode === "company" ? companyResults : dimensionResults;
// Falls back to activeCols when colOrder doesn't match the current view's columns
// (either different length or different content). Derived so viewMode swaps don't need a reset effect.
const orderedCols = (colOrder && colOrder.length === activeCols.length && colOrder.every(c => activeCols.includes(c))) ? colOrder : activeCols;

  const sourceOpts = [...new Set(sources.map(s => typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));
  const structureOpts = [...new Set(structures.map(s => typeof s === "object" ? (s.groupStructure ?? s.GroupStructure ?? "") : String(s)).filter(Boolean))].map(v => ({ value: v, label: v }));

return (
    <div className="flex flex-col gap-4 h-full min-h-0 relative">
      {exportModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", animation: "kBadgesPop 280ms cubic-bezier(0.34,1.56,0.64,1)" }}
          onClick={() => setExportModal(false)}>
          <div className="relative bg-white w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col"
            style={{ borderRadius: 28, boxShadow: `0 30px 80px -12px ${colors.primary}40, 0 12px 24px -6px rgba(0,0,0,0.12)`, animation: "plRowSlideIn 340ms cubic-bezier(0.34,1.56,0.64,1)" }}
            onClick={e => e.stopPropagation()}>
            <div className="relative px-7 pt-7 pb-5 flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}dd 100%)`, boxShadow: `0 8px 20px -6px ${colors.primary}60` }}>
                    <Download size={17} className="text-white" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-black text-[20px] tracking-tight" style={{ color: colors.primary, letterSpacing: "-0.02em" }}>Export KPIs</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                        style={{ background: `${colors.primary}10`, color: colors.primary }}>
                        {(exportOpts.format ?? "xlsx") === "pdf" ? "PDF" : "EXCEL"}
                      </span>
                      {compareMode && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] px-2 py-0.5 rounded-md"
                          style={{ background: "#CF305D15", color: "#CF305D" }}>COMPARE</span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => setExportModal(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-[1.05]"
                  style={{ background: "#f3f4f6", color: "#6b7280" }}>
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-7 pb-5 space-y-6 no-scrollbar">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">Views to include</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    ["company",   "Company KPIs",   "KPI values per selected company",     colors.primary],
                    ["dimension", "Dimension KPIs", "KPI values broken down by dimension", "#dc7533"],
                    ["graphs",    "Graphs",         "Time series table + chart image",     "#10B981"],
                  ].map(([k, label, sub, accent]) => {
                    const checked = !!exportOpts[k];
                    return (
                      <label key={k} className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${accent}40` : "#f3f4f6", background: checked ? `${accent}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [k]: !o[k] }))}>
                        <div className="w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? accent : "transparent", borderColor: checked ? accent : "#d1d5db" }}>
                          {checked && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-gray-800">{label}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">KPI definitions (formula · variables · benchmarks)</p>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, #e5e7eb, transparent)" }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["inlineDefs", "Inline under each KPI"],
                    ["defsSheet",  "Separate definitions sheet"],
                  ].map(([k, label]) => {
                    const checked = !!exportOpts[k];
                    return (
                      <label key={k} className="flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all hover:bg-gray-50"
                        style={{ borderColor: checked ? `${colors.primary}40` : "#f3f4f6", background: checked ? `${colors.primary}06` : "white" }}
                        onClick={() => setExportOpts(o => ({ ...o, [k]: !o[k] }))}>
                        <div className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: checked ? colors.primary : "transparent", borderColor: checked ? colors.primary : "#d1d5db" }}>
                          {checked && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                        </div>
                        <span className="text-xs font-bold text-gray-700">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

</div>

            <div className="px-7 py-5 flex items-center gap-3 flex-shrink-0"
              style={{ background: "linear-gradient(180deg, transparent 0%, #f9fafb 100%)" }}>
              <div className="relative flex items-center p-1 rounded-xl" style={{ background: "#f3f4f6" }}>
                {[["xlsx","Excel"], ["pdf","PDF"]].map(([f, l]) => (
                  <button key={f} onClick={() => setExportOpts(o => ({ ...o, format: f }))}
                    className="relative z-10 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-200"
                    style={{
                      background: (exportOpts.format ?? "xlsx") === f ? "white" : "transparent",
                      color: (exportOpts.format ?? "xlsx") === f ? colors.primary : "#9ca3af",
                      boxShadow: (exportOpts.format ?? "xlsx") === f ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                    }}>{l}</button>
                ))}
              </div>
              <button
                onClick={() => {
                  setExportModal(false);
                  const fmt = exportOpts.format ?? "xlsx";
                  if (fmt === "pdf") _handleExportPdfRun?.();
                  else _handleExportXlsxRun?.();
                }}
                disabled={!exportOpts.company && !exportOpts.dimension && !exportOpts.graphs}
                className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primary}e6 100%)`,
                  color: "white",
                  boxShadow: `0 8px 20px -6px ${colors.primary}80, 0 2px 6px -2px ${colors.primary}40`,
                }}>
                <Download size={13} strokeWidth={2.5} />
                Download
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
<style>{`
        @keyframes plRowSlideIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes kBadgesPop {
          0%   { opacity: 0; transform: translateY(8px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cmpBarIn {
          0%   { opacity: 0; transform: translateY(-14px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cmpBarOut {
          0%   { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-14px) scale(0.98); }
        }
        @keyframes cmpCellIn {
          0%   { opacity: 0; transform: translateX(-12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes cmpCellOut {
          0%   { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(12px); }
        }
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

{/* Header — built from shared <PageHeader> */}
<PageHeader
        kicker={tt("nav_individual")}
        title={tt("page_kpis")}
        tabs={[
          { id: "company",   label: tt("tab_company"),       icon: Building2 },
          { id: "dimension", label: tt("filter_dimension"),  icon: Layers },
          { id: "graphs",    label: tt("tab_graphs"),        icon: BarChart3 },
        ]}
        activeTab={viewMode}
        onTabChange={setViewMode}
filters={viewMode === "graphs" ? [] : [
          { label: tt("filter_year"),  value: year,  onChange: setYear,
            options: YEARS.map(y => ({ value: String(y), label: String(y) })) },
          { label: tt("filter_month"), value: month, onChange: setMonth,
            options: MONTHS.map(m => ({ value: String(m.value), label: tt(`month_${m.value}`) })) },
          ...(sourceOpts.length > 0
            ? [{ label: tt("filter_source"), value: source, onChange: setSource, options: sourceOpts }]
            : []),
          ...(structureOpts.length > 0
            ? [{ label: tt("filter_structure"), value: structure, onChange: setStructure, options: structureOpts }]
            : []),
          ...(companyCodes.length > 0 && (viewMode === "company" || viewMode === "dimension")
            ? [{ label: tt("filter_company"), values: selCompanies, onChange: setSelCompanies, options: companyCodes.map(c => ({ value: c, label: companyLegalName(c) })), multiselect: true }]
            : []),
          ...(dimGroups.length > 0
            ? [{
                label: tt("filter_dim_group"),
                values: selGroups,
                onChange: v => { setSelGroups(v); setSelDims(null); },
                options: dimGroups.map(g => ({ value: g, label: g })),
                multiselect: true,
              }]
            : []),
          ...(groupDimOptions.length > 0
            ? [{
                label: tt("filter_dimension"),
                values: selDims,
                onChange: setSelDims,
                options: groupDimOptions.map(d => ({ value: d.code, label: d.name || d.code })),
                multiselect: true,
              }]
            : []),
        ]}
periodToggle={{
          value: viewPeriod,
          onChange: setViewPeriod,
        }}
compareToggle={{
          active: compareMode,
          onChange: (val) => {
            if (val && !compareMode) {
              // Seed the cmp overrides with the current pageheader values (prior year, same month/source/structure)
              // so subsequent changes to the pageheader don't drag cmp along.
              if (cmpYearOverride == null && year)      setCmpYear(String(parseInt(year) - 1));
              if (cmpMonthOverride == null && month)    setCmpMonth(month);
              if (cmpSourceOverride == null && source)  setCmpSource(source);
              if (cmpStructureOverride == null && structure) setCmpStructure(structure);
            }
            setCompareMode(val);
          },
        }}
onExportPdf={handleExportPdf}
        onExportXlsx={handleExportXlsx}
      />



      {activeMapping && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm flex-shrink-0">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
<span className="text-xs text-emerald-700 font-medium">
            {tt("mapping_active")}: <strong className="font-black">{activeMapping.name}</strong>
            <span className="text-emerald-500/70 ml-2">· {activeMapping.standard}</span>
          </span>
          <button
            onClick={() => setActiveMapping(null)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest transition-colors"
            title={tt("clear_mapping_title")}
          >
            <X size={11} />
            {tt("mapping_clear")}
          </button>
        </div>
      )}

      {activeMapping && !warningDismissed && (
        <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 shadow-sm flex-shrink-0">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
<div className="flex-1 text-xs text-amber-800 leading-relaxed">
            <strong className="font-black">{tt("mapping_warning_head")}:</strong> {tt("kpi_mapping_recomputed_body")}
            {mappingMatched.length > 0 && (
              <> <span className="font-black text-amber-900">{mappingMatched.length}</span> {tt(mappingMatched.length === 1 ? "kpi_mapping_section_matched_one" : "kpi_mapping_section_matched_many")} ({mappingMatched.slice(0, 3).map(m => m.label).join(", ")}{mappingMatched.length > 3 ? "…" : ""}).</>
            )}
            {mappingUnmatched.length > 0 && (
              <> <span className="font-black text-amber-900">{mappingUnmatched.length}</span> {tt("kpi_mapping_unmatched_suffix")}</>
            )}
          </div>
          <button
            onClick={() => setWarningDismissed(true)}
            className="flex-shrink-0 w-6 h-6 rounded-md hover:bg-amber-100 text-amber-600 flex items-center justify-center transition-colors"
            title={tt("unmapped_dismiss")}
          >
            <X size={11} />
          </button>
        </div>
      )}


{!kpiDashReady ? (
        <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.78)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            animation: "indOverlayFadeIn 200ms ease-out",
          }}>
          <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
            style={{
              width: 380,
              boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)",
              animation: "indPopIn 320ms cubic-bezier(0.34,1.56,0.64,1)",
            }}>
            <div className="relative" style={{ width: 140, height: 140 }}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                <circle
                  cx="70" cy="70" r="60" fill="none"
                  stroke="url(#kpiProgGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 60}
                  strokeDashoffset={2 * Math.PI * 60 * (1 - animatedKpiDashProgress / 100)}
                  style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
                />
                <defs>
                  <linearGradient id="kpiProgGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                    <stop offset="100%" stopColor={colors.secondary ?? "#CF305D"} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
                  {Math.round(animatedKpiDashProgress)}<span className="text-base text-gray-300">%</span>
                </span>
              </div>
            </div>
<p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
              {!metaReady
                ? tt("loading_overlay_period")
                : sources.length === 0 || structures.length === 0 || companies.length === 0
                  ? tt("kpi_loading_filter_options")
                  : groupAccounts.length === 0
                    ? tt("loading_overlay_group_accounts")
                    : companyData.size === 0
                      ? `${tt("kpi_loading_kpis_for")} ${companyCodes.length} ${tt(companyCodes.length === 1 ? "kpi_company_singular" : "kpi_company_plural")}…`
                      : tt("loading_overlay_finish")}
            </p>
            <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
              {tt("loading_overlay_subtitle")}
            </p>
          </div>
          <style>{`
            @keyframes indOverlayFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes indPopIn {
              0%   { opacity: 0; transform: scale(0.92) translateY(8px); }
              100% { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </div>
) : viewMode === "graphs" ? (
<div className="flex flex-col gap-3 flex-1 min-h-0">
  <GraphSection
    sectionId={1}
    token={token}
    source={source}
    structure={structure}
    year={year}
    month={month}
    sourceOpts={sourceOpts}
    structureOpts={structureOpts}
    companyCodes={companyCodes}
    dimensions={dimensions}
    kpiList={kpiList}
    allKpis={resolvedAllKpis}
    ccTagToCodes={ccTagToCodes}
    sectionCodes={sectionCodes}
    sumAccountCodes={sumAccountCodes}
    defaultCompany={companyCodes[0] || ""}
defaultKpiIds={["revenue", "gross_profit", "net_result"]}
onStateChange={handleGraphSectionState}
viewPeriod={viewPeriod}
    compareMode={compareMode}
    companyLegalName={companyLegalName}
    filterStyle={filterStyle}
    colors={colors}
    body1Style={body1Style}
    body2Style={body2Style}
  />
</div>
) : (
<div className="flex flex-col gap-3 flex-1 min-h-0">
<div className="flex-shrink-0 overflow-hidden" style={{
  maxHeight: compareMode && !cmpBarCollapsed ? 200 : 0,
  marginTop: compareMode && !cmpBarCollapsed ? 0 : -12,
  opacity: cmpBarCollapsed ? 0 : 1,
  transition: 'max-height 450ms cubic-bezier(0.4,0,0.2,1), margin-top 450ms cubic-bezier(0.4,0,0.2,1), opacity 300ms ease',
}}>
{compareVisible && (
<div className="bg-white rounded-2xl shadow-xl border border-gray-100"
    style={{
      overflow: "visible",
      position: "relative",
      zIndex: 30,
      animation: `${compareMode ? 'cmpBarIn' : 'cmpBarOut'} 450ms cubic-bezier(0.4,0,0.2,1) forwards`,
      transformOrigin: 'top center',
    }}>
   <div className="px-5 py-3 flex items-center gap-2 no-scrollbar" style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "visible" }}>
      <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
          <span className="text-white text-[11px] font-black">B</span>
        </div>
       <span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{tt("kpi_compare_with")}</span>
      </div>
      {sourceOpts.length > 0 && (
        <HeaderFilterPill label="Source" value={cmpSource} onChange={setCmpSource} options={sourceOpts} />
      )}
      {structureOpts.length > 0 && (
        <HeaderFilterPill label="Structure" value={cmpStructure} onChange={setCmpStructure} options={structureOpts} />
      )}
      <HeaderFilterPill label="Year" value={cmpYear} onChange={setCmpYear}
        options={YEARS.map(y => ({ value: String(y), label: String(y) }))} />
      <HeaderFilterPill label="Month" value={cmpMonth} onChange={setCmpMonth}
        options={MONTHS.map(m => ({ value: String(m.value), label: m.label }))} />
{dimGroups.length > 0 && (
        <MultiFilterPill label="Dim Grp" values={cmpSelGroups}
          onChange={v => { setCmpSelGroups(v); setCmpSelDims(null); }}
          options={dimGroups.map(g => ({ value: g, label: g }))} />
      )}
      {cmpGroupDimOptions.length > 0 && (
        <MultiFilterPill label="Dims" values={cmpSelDims} onChange={setCmpSelDims}
          options={cmpGroupDimOptions.map(d => ({ value: d.code, label: d.name || d.code }))} />
      )}
    </div>
  </div>
)}
</div>
<div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1" style={{ paddingBottom: "0" }}>
            <table className="w-full text-xs border-collapse">
<thead className="sticky top-0 z-20">
<tr style={{
  background: "rgba(255,255,255,0.95)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)",
}}>
<th className="sticky left-0 top-0 z-20 text-left px-6 py-3 border-r border-gray-100 min-w-[250px]"
  style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: "64px" }}>
<div className="flex items-baseline gap-2.5" style={{ animation: "kBadgesPop 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}>
    <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{tt("col_kpi")}</span>
    <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>{tt("kpi_dashboard_label")}</span>
  </div>
</th>
{orderedCols.flatMap((col, ci) => {
                    const label = viewMode === "dimension" ? (dimensionPivots.get(col)?.name ?? col) : companyLegalName(col);
                    const cells = [
<th key={col}
                        draggable
                        onDragStart={() => setColDragIdx(ci)}
                        onDragOver={e => { e.preventDefault(); setColDragOverIdx(ci); }}
                        onDragEnd={handleColDragEnd}
                        className={`text-center px-4 py-3 whitespace-nowrap min-w-[140px] cursor-grab select-none transition-all ${colDragOverIdx === ci ? "opacity-50" : ""}`}
                        style={{ background: "transparent" }}>
                        <span className="font-black tracking-tight inline-block"
                          style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em", animation: `kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) ${0.10 + ci * 0.03}s both` }}>
                          {label}
                        </span>
                      </th>
                    ];
if (compareVisible) {
                      const cmpAnim = `${compareMode ? 'cmpCellIn' : 'cmpCellOut'} 420ms cubic-bezier(0.4,0,0.2,1) forwards`;
                      cells.push(
<th key={`${col}__cmp`}
                          className="text-center px-4 py-3 whitespace-nowrap min-w-[120px]"
                          style={{ background: "transparent", animation: cmpAnim }}>
<span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}50`, fontSize: 10 }}>{tt("kpi_col_sigma_cmp")}</span>
                        </th>,
                        <th key={`${col}__delta`}
                          className="text-center px-4 py-3 whitespace-nowrap min-w-[100px]"
                          style={{ background: "transparent", animation: cmpAnim, animationDelay: '40ms' }}>
                          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}50`, fontSize: 10 }}>{tt("col_delta_amt")}</span>
                        </th>,
                        <th key={`${col}__deltapct`}
                          className="text-center px-4 py-3 whitespace-nowrap min-w-[90px]"
                          style={{ background: "transparent", animation: cmpAnim, animationDelay: '80ms' }}>
                          <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}50`, fontSize: 10 }}>{tt("kpi_col_delta_pct")}</span>
                        </th>
                      );
                    }
                    return cells;
                  })}
<th className="sticky right-0 top-0 z-20 px-4 py-3 whitespace-nowrap border-l border-gray-100 min-w-[160px] text-center"
  style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
  <span className="font-black tracking-tight inline-block"
style={{ color: colors.primary, fontSize: 14, letterSpacing: "-0.02em", animation: "kBadgesPop 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.22s both" }}>
    {tt("col_total_avg")}
  </span>
</th>
                </tr>
              </thead>
              <tbody>
                {kpiList.map((kpi) => {
                  const globalIdx = kpiList.findIndex(k => k.id === kpi.id);
 const values = orderedCols.map(col => {
                    const res = activeResults.get(col);
                    if (!res) return null;
                    const v = res.get(kpi.id);
                    return (v === undefined || v === null || isNaN(v)) ? null : v;
                  });
                  const validVals = values.filter(v => v !== null);
                  const aggregate = validVals.length === 0 ? null
                    : kpi.format === "percent"
                      ? validVals.reduce((a, b) => a + b, 0) / validVals.length
                      : validVals.reduce((a, b) => a + b, 0);

return (
                    <tr key={kpi.id}
                      draggable
                      onDragStart={() => setDragIdx(globalIdx)}
                      onDragOver={e => { e.preventDefault(); setDragOverIdx(globalIdx); }}
                      onDragEnd={handleDragEnd}
                      className={`border-b border-gray-100 bg-white hover:bg-[#eef1fb]/60 transition-colors group ${dragOverIdx === globalIdx ? "bg-[#eef1fb]" : ""}`}
                      style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(globalIdx, 25) * 40}ms both` }}>

<td className="sticky left-0 z-20 bg-white border-r border-gray-100 group-hover:bg-[#f5f7ff] transition-colors"
  style={{ padding: "14px 20px" }}>
  <div className="flex items-center gap-2.5">
    <div className="opacity-0 group-hover:opacity-30 transition-opacity cursor-grab text-gray-400 flex-shrink-0">
      <GripVertical size={11} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
<span className="truncate" style={{ ...body1Style, fontSize: (parseFloat(body1Style.fontSize) + 2) + "px" }}>
          {kpi.label}
        </span>
{kpi.category && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: `${colors.primary}12`, color: colors.primary, ...body1Style, fontWeight: 900 }}>
            {kpi.category}
          </span>
        )}
{kpi._isOverridden && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0 text-[8px] font-black uppercase tracking-wider"
            style={{ background: "#ede9fe", color: "#6d28d9" }}>
            edited
          </span>
        )}
{kpi._contextMappingId && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0 text-[8px] font-black uppercase tracking-wider"
            style={{ background: "#fef3c7", color: "#92400e" }}>
            mapped
          </span>
        )}
{kpi._kpiType === "custom" && kpi._createdBy && !kpi._contextMappingId && !kpi._sourceSystemKpiId && (
          <span className="px-2 py-0.5 rounded-full flex-shrink-0 text-[8px] font-black uppercase tracking-wider"
            style={{ background: "#dcfce7", color: "#15803d" }}>
            custom
          </span>
        )}
      </div>
{kpi.description && (
        <span className="truncate block" style={body2Style}>
          {kpi.description}
        </span>
      )}
    </div>
    <div className="opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 flex-shrink-0">
      <button onClick={() => setEditingKpi(kpi)}
        className="w-6 h-6 rounded-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: `${colors.primary}12`, color: colors.primary }}>
        <Edit3 size={9} />
      </button>
      <button onClick={() => deleteKpi(kpi.id)}
        className="w-6 h-6 rounded-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: "#fee2e2", color: "#dc2626" }}>
        <Trash2 size={9} />
      </button>
    </div>
  </div>
</td>
{values.flatMap((val, ci) => {
                        const col = orderedCols[ci];
const bColor = getBenchmarkColor(val, kpi.benchmark);
                        const out = [
                          <td key={col}
                            className="px-4 py-3 text-center whitespace-nowrap transition-all"
                            style={bColor ? {
                              background: bColor.bg,
                              borderLeft: `2px solid ${bColor.border}`,
                            } : undefined}>
                            <AnimatedCell value={val} format={kpi.format} baseStyle={{ ...body1Style, color: bColor ? bColor.text : undefined }} />
                          </td>
                        ];
if (compareVisible) {
                          // Compare scenario reads from the matching cmp results
                          // map depending on the current view mode.
                          const cmpResultsMap = viewMode === "dimension" ? dimensionResultsCmp : companyResultsCmp;
                          const cmpRes = cmpResultsMap.get(col);
                          const cmpVal = cmpRes ? cmpRes.get(kpi.id) : null;
                          const cmpCellAnim = `${compareMode ? 'cmpCellIn' : 'cmpCellOut'} 420ms cubic-bezier(0.4,0,0.2,1) forwards`;
                    const cmpCellLoading = compareMode && (cmpLoading || cmpResultsMap.size === 0);
                          const cmpSpinner = (
                            <Loader2 size={11} className="animate-spin mx-auto" style={{ color: `${colors.primary}80` }} />
                          );
const cmpValid = cmpVal !== undefined && cmpVal !== null && !isNaN(cmpVal);

                          // Delta amount + percent (skip percent for percent KPIs to avoid % of %)
let delta = null;
                          let deltaPct = null;
                          if (cmpValid && val !== null) {
                            delta = val - cmpVal;
                            if (kpi.format !== "percent") {
                              if (Math.abs(cmpVal) > 1e-9) {
                                deltaPct = ((val - cmpVal) / Math.abs(cmpVal)) * 100;
                              } else if (Math.abs(val) > 1e-9) {
                                deltaPct = val > 0 ? Infinity : -Infinity;
                              }
                            }
                          }

out.push(
                            <td key={`${col}__cmp`}
                              className="px-4 py-3 text-center whitespace-nowrap bg-[#fafbff]"
                              style={{ animation: cmpCellAnim }}>
{cmpCellLoading
                                ? cmpSpinner
                                : <AnimatedCell value={cmpValid ? cmpVal : null} format={kpi.format} baseStyle={body1Style} />}
                            </td>,
                            <td key={`${col}__delta`}
                              className="px-4 py-3 text-center whitespace-nowrap bg-[#f5f7ff]"
                              style={{ animation: cmpCellAnim, animationDelay: '40ms' }}>
                              {cmpCellLoading
                                ? cmpSpinner
                                : delta === null
                                  ? <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span>
                                  : <AnimatedCell value={delta} format={kpi.format} baseStyle={{ ...body1Style, color: delta < 0 ? "#EF4444" : "#059669" }} />}
                            </td>,
                            <td key={`${col}__deltapct`}
                              className="px-4 py-3 text-center whitespace-nowrap bg-[#f0f3ff]"
                              style={{ animation: cmpCellAnim, animationDelay: '80ms' }}>
                              {cmpLoading
                                ? cmpSpinner
: deltaPct === null
                                  ? <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span>
                                  : !Number.isFinite(deltaPct)
                                    ? <span className="text-xs font-black" style={{ color: deltaPct > 0 ? "#059669" : "#EF4444" }}>
                                        {deltaPct > 0 ? "+∞%" : "-∞%"}
                                      </span>
                                    : <span className="text-xs font-black" style={{ color: deltaPct < 0 ? "#EF4444" : "#059669" }}>
                                        {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
                                      </span>}
                            </td>
                          );
                        }
                        return out;
                      })}

{(() => {
                          const aggColor = getBenchmarkColor(aggregate, kpi.benchmark);
                          return (
<td className="sticky right-0 px-4 py-3 text-center whitespace-nowrap transition-all"
                              style={{
                                background: aggColor ? `${aggColor.bg}, #ffffff` : "#eef1fb",
                                borderLeft: aggColor ? `2px solid ${aggColor.border}` : "1px solid #e5e7eb",
                              }}>
                              {aggregate === null ? (
                                <span style={{ ...body1Style, color: "#D1D5DB" }}>—</span>
                              ) : (
                                <>
                                  <AnimatedCell value={aggregate} format={kpi.format} baseStyle={{ ...body1Style, color: aggColor ? aggColor.text : undefined }} />
                                  <span className="text-[9px] font-normal text-gray-400 ml-1">{kpi.format === "percent" ? "avg" : "Σ"}</span>
                                </>
                              )}
                            </td>
                          );
                        })()}
                    </tr>
                  );
                })}


              </tbody>
            </table>
</div>

          {/* Add KPI — outside scroll, always pinned */}
          <div className="flex-shrink-0 px-4 py-2 border-t border-gray-50">
            <button onClick={() => setEditingKpi("new")}
              className="w-full group flex items-center justify-center gap-2.5 py-2.5 rounded-xl transition-all duration-200 hover:bg-[#eef1fb]"
              style={{ border: `1.5px dashed ${colors.primary}25` }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200 group-hover:scale-110"
                style={{ background: colors.primary, color: "white", boxShadow: `0 4px 10px -2px ${colors.primary}50` }}>
                <Plus size={12} strokeWidth={3} />
              </div>
<span className="text-[11px] font-black uppercase tracking-[0.18em] transition-colors duration-200"
                style={{ color: colors.primary, opacity: 0.6 }}>
                {tt("btn_add_kpi")}
              </span>
            </button>
          </div>

</div>
      </div>
      )}

      {/* Editor modal */}
{editingKpi !== null && (
        <KpiEditorModal
          kpi={editingKpi === "new" ? null : editingKpi}
          onSave={saveKpi}
          onClose={() => setEditingKpi(null)}
          onReset={resetSystemOverride}
          onEditLibraryKpi={(k) => { setEditingKpi(null); setTimeout(() => setEditingKpi(k), 0); }}
onDeleteLibraryKpi={async (id) => {
            try {
              await deleteCompanyKpi({ kpiId: id });
              setCompanyKpis(prev => prev.filter(k => k.kpi_id !== id));
              removeFromDashboard(id, viewMode === "dimension" ? "individual_dimension" : "individual_company");
              refreshCompanyKpis();
            } catch (e) { alert(`Could not delete: ${e.message}`); }
          }}
          onDuplicate={async (data) => {
            if (!companyId || !authUserId) return;
            // Auto-increment suffix: "Label 2" → "Label 3" etc.
            const base = data.label.replace(/ \d+$/, "");
            const existing = [...(localKpis ?? []), ...(resolvedKpiList ?? [])];
            let n = 2;
            while (existing.some(k => k.label === `${base} ${n}`)) n++;
            try {
const created = await createCompanyKpi({
                companyId, userId: authUserId,
                label:       `${base} ${n}`,
                description: data.description ?? null,
                category:    data.category ?? null,
                tag:         null,
                format:      data.format ?? "currency",
                formula:     data.formula,
                benchmark:   data.benchmark ?? null,
                variations:  data.variations ?? null,
                contextMappingId: null,
                scope: "individual",
              });
              setCompanyKpis(prev => [...prev, created]);
            } catch (e) { alert(`Could not duplicate: ${e.message}`); }
          }}
kpiList={kpiList}
          allLocalKpis={localKpis}
          systemKpis={resolvedAllKpis}
          accountCodes={allAccountCodes}
localAccounts={allLocalAccounts}
          groupAccountsList={allGroupAccountsList}
          accountCodeLabels={accountCodeLabels}
builtInIds={new Set(resolvedAllKpis.map(k => k.id))}
currentUserId={authUserId}
          dimsByAccount={dimsByAccount}
          localDimsByAccount={localDimsByAccount}
          parties={statParties}
          partyContext={{
            company: companyCodes[0] ?? null,
            year: parseInt(year || 0) || null,
            month: parseInt(month || 0) || null,
            selectedDims: groupDimCodes ?? null,
          }}
evalPartyValue={(partyId) => {
            const p = partiesById.get(partyId);
            if (!p) return null;
            const co = companyCodes[0];
            if (co && p.companies?.length && !p.companies.includes(co)) return null;
            const shared = p.sharedAcrossCompanies !== false;
            const yearTree = shared ? (p.values ?? {}) : (p.values?.[co] ?? {});
            const yr = yearTree[String(year)];
            if (!yr) return null;
            const computed = evaluatePartyYear(yr, p.dims);
            const dimsToSum = groupDimCodes && groupDimCodes.size > 0
              ? p.dims.filter(d => groupDimCodes.has(d))
              : p.dims;
            let total = 0;
            const mo = parseInt(month);
            for (const dim of dimsToSum) {
              const v = computed[dim]?.[mo];
if (typeof v === "number") total += v;
            }
            return total;
          }}
          variationCompanies={companyCodes}
          companyLabelsMap={(() => {
            const m = new Map();
            companyCodes.forEach(c => m.set(c, companyLegalName(c)));
            return m;
          })()}
          variationDimensions={allDimensionsFlat}
        />
      )}
    </div>
  );
}