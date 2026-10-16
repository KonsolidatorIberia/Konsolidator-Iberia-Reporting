/* ══════════════════════════════════════════════════════════════════════
   KPIs predefinidos que funcionan con los datos de cada cliente

   Por qué fallaban los de antes:
     · La mayoría eran solo una referencia a un KPI del sistema
       ({ type: "ref", kpiId: "current_ratio" }). Si ese id no existe en
       kpi_definitions, la referencia vale 0 sin avisar.
     · Cobertura de intereses y los 5 de Mercado no tenían fórmula
       (A ÷ B sin A ni B): siempre salían vacíos.
     · Al añadirlos se copiaba esa fórmula rota a un KPI nuevo, y el
       benchmark se guardaba como texto ("> 1.5 saludable"), que no colorea.
     · Las partidas de balance llegan con signo contable (el activo sale
       negativo), así que un ratio como activo ÷ pasivo daba negativo.

   Ahora cada KPI predefinido se describe por sus "ingredientes" (activo
   corriente, existencias, ventas…) y cada ingrediente se busca, por este
   orden, en:
       1. un KPI del sistema que exista (ref)
       2. una etiqueta del estándar contable (cc_tag)
       3. una cuenta del plan de grupo cuyo nombre coincida
   Se prueba cada candidato con los datos cargados y se usa el primero que
   da un valor. Lo que no se encuentra queda como letra sin asignar, y el
   KPI se abre en el asistente para elegir la cuenta, en vez de añadirse
   vacío. Cada tarjeta enseña una vista previa con el valor real.
   ══════════════════════════════════════════════════════════════════════ */

// Nombre normalizado: minúsculas, sin acentos, sin numeración "A)", "II.",
// sin paréntesis finales "(A+B)" ni signos.
export function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*[a-z0-9]*\d[a-z0-9.-]*[.)]?\s+/, "")
    .replace(/^\s*(?:[a-z]|[ivxlc]+|\d+)\s*[.)]\s*(?:(?:[ivxlc]+|\d+)\s*[.)]\s*)?/, "")
    .replace(/[^a-z0-9æøå ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Ingredientes ────────────────────────────────────────────────────────
export const INGREDIENTS = {
  revenue: {
    refs: ["revenue"], cc: ["revenue"],
    names: ["importe neto de la cifra de negocios", "cifra de negocios", "ventas", "ingresos", "ingresos de explotacion", "ingresos ordinarios", "revenue", "net revenue", "sales", "turnover", "nettoomsætning", "omsætning"],
  },
  gross_profit: {
    refs: ["gross_profit"], cc: ["gross_profit"],
    names: ["margen bruto", "beneficio bruto", "resultado bruto", "gross profit", "gross margin", "bruttofortjeneste", "bruttoresultat"],
  },
  ebitda: { refs: ["ebitda"], cc: ["ebitda"], names: ["ebitda", "resultado bruto de explotacion"] },
  ebit: {
    refs: ["ebit"], cc: ["ebit"],
    names: ["resultado de explotacion", "resultado operativo", "beneficio de explotacion", "operating income", "operating profit", "operating result", "ebit", "resultat af primær drift", "driftsresultat", "resultat før finansielle poster"],
  },
  net_result: {
    refs: ["net_result"], cc: ["net_result"],
    names: ["resultado del ejercicio", "resultado neto", "beneficio neto", "resultado consolidado del ejercicio", "net result", "net income", "profit for the year", "årets resultat", "periodens resultat"],
  },
  cost_of_goods: {
    refs: ["cost_of_goods"], cc: ["cost_of_goods"],
    names: ["aprovisionamientos", "coste de ventas", "costo de ventas", "consumo de mercaderias", "cost of sales", "cost of goods sold", "vareforbrug", "produktionsomkostninger"],
  },
  financial_expenses: {
    refs: ["financial_expenses"], cc: ["financial_expenses", "finance_costs", "interest_expense"],
    names: ["gastos financieros", "financial expenses", "finance costs", "interest expense", "finansielle omkostninger"],
  },
  total_assets: {
    refs: ["total_assets"], cc: ["total_assets"],
    names: ["total activo", "activo total", "activo", "total de activos", "total assets", "assets", "aktiver i alt", "aktiver"],
  },
  current_assets: {
    refs: ["current_assets"], cc: ["current_assets"],
    names: ["activo corriente", "activo circulante", "current assets", "total current assets", "omsætningsaktiver i alt", "omsætningsaktiver"],
  },
  inventory: {
    refs: ["inventory"], cc: ["inventory", "inventories", "stocks"],
    names: ["existencias", "inventarios", "inventories", "inventory", "stocks", "varebeholdninger"],
  },
  receivables: {
    refs: ["receivables"], cc: ["trade_receivables", "receivables", "accounts_receivable"],
    names: ["deudores comerciales y otras cuentas a cobrar", "deudores comerciales", "clientes por ventas y prestaciones de servicios", "clientes", "trade receivables", "trade and other receivables", "accounts receivable", "tilgodehavender fra salg og tjenesteydelser", "tilgodehavender"],
  },
  cash: {
    refs: ["cash"], cc: ["cash", "cash_and_equivalents", "cash_and_cash_equivalents"],
    names: ["efectivo y otros activos liquidos equivalentes", "efectivo y equivalentes", "tesoreria", "efectivo", "cash and cash equivalents", "cash", "likvide beholdninger"],
  },
  total_equity: {
    refs: ["total_equity"], cc: ["total_equity"],
    names: ["patrimonio neto", "fondos propios", "total patrimonio neto", "total equity", "equity", "egenkapital i alt", "egenkapital"],
  },
  total_liabilities: {
    refs: ["total_liabilities"], cc: ["total_liabilities"],
    names: ["pasivo total", "total pasivo", "total liabilities", "liabilities", "gældsforpligtelser i alt", "forpligtelser i alt"],
  },
  current_liabilities: {
    refs: ["current_liabilities"], cc: ["current_liabilities"],
    names: ["pasivo corriente", "pasivo circulante", "current liabilities", "total current liabilities", "kortfristede gældsforpligtelser i alt", "kortfristede gældsforpligtelser"],
  },
  payables: {
    refs: ["payables"], cc: ["trade_payables", "payables", "accounts_payable"],
    names: ["acreedores comerciales y otras cuentas a pagar", "acreedores comerciales", "proveedores", "trade payables", "trade and other payables", "accounts payable", "leverandører af varer og tjenesteydelser", "leverandørgæld"],
  },
  financial_debt: {
    refs: ["financial_debt"], cc: ["financial_debt", "borrowings", "bank_debt", "interest_bearing_debt"],
    names: ["deudas con entidades de credito", "deuda financiera", "deudas financieras", "borrowings", "bank loans", "loans and borrowings", "gæld til kreditinstitutter", "kreditinstitutter"],
  },
  // Datos de mercado: no están en la contabilidad, se asignan a mano
  // (normalmente a una partida estadística).
  shares: { refs: [], cc: [], names: [], manual: true },
  share_price: { refs: [], cc: [], names: [], manual: true },
  dividend_per_share: { refs: [], cc: [], names: [], manual: true },
};

// ── KPIs predefinidos (mismo id que la biblioteca: _lib_<id>) ──────────
// recipes: primera receta que se puede montar entera; si ninguna, la
// primera con letras sin asignar. `positive`: un KPI del sistema solo se
// acepta si su valor es > 0 (los ratios de balance no pueden ser negativos).
const lowGood = (vh, h) => ({ vhealthy: { min: "", max: String(vh) }, healthy: { min: String(vh), max: String(h) }, unhealthy: { min: String(h), max: "" } });
const highGood = (u, h) => ({ unhealthy: { min: "", max: String(u) }, healthy: { min: String(u), max: String(h) }, vhealthy: { min: String(h), max: "" } });
const positiveOnly = { unhealthy: { min: "", max: "0" }, healthy: { min: "0", max: "" }, vhealthy: { min: "", max: "" } };

export const PRESET_SPECS = {
  // Liquidez
  _lib_current_ratio:   { system: "current_ratio", positive: true, bench: highGood(1, 1.5),
    recipes: [{ expr: "Math.abs(A) / Math.abs(B)", vars: { A: "current_assets", B: "current_liabilities" } }] },
  _lib_quick_ratio:     { system: "quick_ratio", positive: true, bench: highGood(0.8, 1),
    recipes: [{ expr: "(Math.abs(A) - Math.abs(B)) / Math.abs(C)", vars: { A: "current_assets", B: "inventory", C: "current_liabilities" } }] },
  _lib_cash_ratio:      { system: "cash_ratio", positive: true, bench: highGood(0.1, 0.2),
    recipes: [{ expr: "Math.abs(A) / Math.abs(B)", vars: { A: "cash", B: "current_liabilities" } }] },
  _lib_working_capital: { system: "working_capital", bench: positiveOnly,
    recipes: [{ expr: "Math.abs(A) - Math.abs(B)", vars: { A: "current_assets", B: "current_liabilities" } }] },
  // Solvencia
  _lib_debt_ratio:      { system: "debt_ratio", positive: true, bench: lowGood(50, 70),
    recipes: [
      { expr: "Math.abs(A) / Math.abs(B) * 100", vars: { A: "total_liabilities", B: "total_assets" } },
      { expr: "(Math.abs(A) - Math.abs(B)) / Math.abs(A) * 100", vars: { A: "total_assets", B: "total_equity" } },
    ] },
  _lib_debt_to_equity:  { system: "debt_to_equity", positive: true, bench: lowGood(1, 2),
    recipes: [
      { expr: "Math.abs(A) / Math.abs(B)", vars: { A: "total_liabilities", B: "total_equity" } },
      { expr: "(Math.abs(A) - Math.abs(B)) / Math.abs(B)", vars: { A: "total_assets", B: "total_equity" } },
    ] },
  _lib_net_debt_ebitda: { system: "net_debt_to_ebitda", bench: lowGood(3, 5),
    recipes: [{ expr: "(Math.abs(A) - Math.abs(B)) / C", vars: { A: "financial_debt", B: "cash", C: "ebitda" } }] },
  _lib_interest_coverage: { system: "interest_coverage", bench: highGood(1.5, 3),
    recipes: [{ expr: "A / Math.abs(B)", vars: { A: "ebit", B: "financial_expenses" } }] },
  // Rentabilidad
  _lib_gross_margin: { system: "gross_margin", bench: { unhealthy: { min: "", max: "0" }, healthy: { min: "", max: "" }, vhealthy: { min: "", max: "" } },
    recipes: [{ expr: "A / B * 100", vars: { A: "gross_profit", B: "revenue" } }] },
  _lib_ebit_margin:  { system: "ebit_margin", bench: highGood(0, 10),
    recipes: [{ expr: "A / B * 100", vars: { A: "ebit", B: "revenue" } }] },
  _lib_net_margin:   { system: "net_margin", bench: highGood(0, 10),
    recipes: [{ expr: "A / B * 100", vars: { A: "net_result", B: "revenue" } }] },
  _lib_roa:          { system: "roa", bench: highGood(0, 5),
    recipes: [{ expr: "A / Math.abs(B) * 100", vars: { A: "net_result", B: "total_assets" } }] },
  _lib_roe:          { system: "roe", bench: highGood(0, 15),
    recipes: [{ expr: "A / Math.abs(B) * 100", vars: { A: "net_result", B: "total_equity" } }] },
  _lib_ebitda:       { system: "ebitda", bench: positiveOnly, recipes: [{ expr: "A", vars: { A: "ebitda" } }] },
  _lib_ebit:         { system: "ebit", bench: positiveOnly, recipes: [{ expr: "A", vars: { A: "ebit" } }] },
  // Eficiencia
  _lib_asset_turnover: { system: "asset_turnover", positive: true, bench: highGood(0.5, 1),
    recipes: [{ expr: "A / Math.abs(B)", vars: { A: "revenue", B: "total_assets" } }] },
  _lib_dio: { system: "inventory_days", positive: true, bench: lowGood(60, 120),
    recipes: [{ expr: "Math.abs(A) / Math.abs(B) * 365", vars: { A: "inventory", B: "cost_of_goods" } }] },
  _lib_dso: { system: "dso", positive: true, bench: lowGood(60, 90),
    recipes: [{ expr: "Math.abs(A) / Math.abs(B) * 365", vars: { A: "receivables", B: "revenue" } }] },
  _lib_dpo: { system: "dpo", positive: true, bench: null,
    recipes: [{ expr: "Math.abs(A) / Math.abs(B) * 365", vars: { A: "payables", B: "cost_of_goods" } }] },
  // Mercado (necesitan datos que no están en la contabilidad)
  _lib_mkt_eps:            { system: "eps", bench: positiveOnly, recipes: [{ expr: "A / B", vars: { A: "net_result", B: "shares" } }] },
  _lib_mkt_pe:             { system: "pe", bench: null, recipes: [{ expr: "A / (B / C)", vars: { A: "share_price", B: "net_result", C: "shares" } }] },
  _lib_mkt_pbv:            { system: "pbv", bench: null, recipes: [{ expr: "A / (Math.abs(B) / C)", vars: { A: "share_price", B: "total_equity", C: "shares" } }] },
  _lib_mkt_dividend_yield: { system: "dividend_yield", bench: null, recipes: [{ expr: "A / B * 100", vars: { A: "dividend_per_share", B: "share_price" } }] },
  _lib_mkt_ev_ebitda:      { system: "ev_ebitda", bench: null,
    recipes: [{ expr: "(A * B + Math.abs(C) - Math.abs(D)) / E", vars: { A: "share_price", B: "shares", C: "financial_debt", D: "cash", E: "ebitda" } }] },
};

export const SECTION_CATEGORY = { liquidez: "Liquidez", solvencia: "Solvencia", rentabilidad: "Rentabilidad", eficiencia: "Eficiencia", mercado: "Mercado" };

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/*
  ctx = {
    hasKpi(id)          → existe en kpi_definitions
    ccTags              → Set de etiquetas con cuentas
    accounts            → [{ code, name }] del plan de grupo
    probe(formulaNode)  → primer valor ≠ 0 en los datos cargados (o 0)
    hasData             → hay datos cargados con los que probar
  }
*/
export function makePresetResolver(ctx) {
  const byName = new Map();
  (ctx.accounts ?? []).forEach(a => {
    const n = normName(a.name);
    if (!n) return;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(a.code);
  });
  const memo = new Map();

  const candidates = (key) => {
    const ing = INGREDIENTS[key];
    if (!ing) return [];
    const out = [];
    (ing.refs ?? []).forEach(id => { if (ctx.hasKpi?.(id)) out.push({ type: "ref", kpiId: id }); });
    (ing.cc ?? []).forEach(tag => { if (ctx.ccTags?.has(tag)) out.push({ type: "cc", tag }); });
    (ing.names ?? []).forEach(n => {
      (byName.get(normName(n)) ?? []).forEach(code => out.push({ type: "accountGroup", groupCode: code, prefix: code }));
    });
    return out;
  };

  // Ingrediente → { node, live } (live: da un valor con los datos cargados)
  const pick = (key) => {
    if (memo.has(key)) return memo.get(key);
    const list = candidates(key);
    let res = { node: null, live: false };
    for (const node of list) {
      const v = ctx.probe?.(node);
      if (finite(v) && v !== 0) { res = { node, live: true }; break; }
    }
    if (!res.node && list.length) res = { node: list[0], live: false };
    memo.set(key, res);
    return res;
  };

  const resolve = (libId) => {
    const spec = PRESET_SPECS[libId];
    if (!spec) return null;

    // 1) KPI del sistema que ya da un valor razonable → se usa tal cual
    if (spec.system && ctx.hasKpi?.(spec.system)) {
      const v = ctx.probe?.({ type: "ref", kpiId: spec.system });
      if (finite(v) && v !== 0 && (!spec.positive || v > 0)) {
        return { systemId: spec.system, formula: { type: "ref", kpiId: spec.system }, status: "ready", preview: v, missing: [], bench: spec.bench };
      }
    }

    // 2) Montar la fórmula con los ingredientes
    // Menos letras sin asignar es mejor; a igualdad, la que da valor
    const score = (c) => c.missing.length * 10 + (c.allLive ? 0 : 1);
    let best = null;
    for (const r of spec.recipes) {
      const variables = {};
      const missing = [];
      let allLive = true;
      Object.entries(r.vars).forEach(([letter, ing]) => {
        const p = pick(ing);
        variables[letter] = p.node;
        if (!p.node) missing.push({ letter, ingredient: ing });
        else if (!p.live) allLive = false;
      });
      const cand = { formula: { type: "text", expression: r.expr, variables }, missing, allLive };
      if (!missing.length && allLive) { best = cand; break; }
      if (!best || score(cand) < score(best)) best = cand;
    }
    const preview = !best.missing.length ? ctx.probe?.(best.formula) : null;
    const status = best.missing.length ? "setup" : (finite(preview) && preview !== 0 ? "ready" : "nodata");
    return { systemId: null, formula: best.formula, status, preview: finite(preview) ? preview : null, missing: best.missing, bench: spec.bench };
  };

  return { resolve };
}

// Añade a cada KPI de la biblioteca su fórmula montada, el benchmark con
// rangos (no texto), el estado y la vista previa.
export function enhancePresetLibrary(sections, ctx) {
  const { resolve } = makePresetResolver(ctx);
  return sections.map(sec => ({
    ...sec,
    kpis: sec.kpis.map(k => {
      const r = resolve(k.id);
      if (!r) return k;
      return {
        ...k,
        category: SECTION_CATEGORY[sec.key] ?? k.category,
        benchmarkText: typeof k.benchmark === "string" ? k.benchmark : null,
        benchmark: r.bench ?? null,
        formula: r.formula,
        _preset: { status: ctx.hasData ? r.status : (r.missing.length ? "setup" : "unknown"), preview: r.preview, missing: r.missing, systemId: r.systemId },
      };
    }),
  }));
}