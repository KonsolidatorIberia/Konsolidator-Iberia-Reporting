/* ══════════════════════════════════════════════════════════════════════
   Rastro del dato (como el de Power BI, "Cockpit", capítulo 11).

   Para un grupo (la raíz de la sábana) y una cuenta (de detalle o suma:
   se suman sus cuentas de detalle) descompone el importe con las mismas
   identidades con que Konsolidator construye el consolidado:

     Grupo        = Contributivo (filas Parent + Contribution) + Eliminaciones
                    (asientos EJE contabilizados del grupo) [+ redondeo]
     Matriz       = Carga (Origin = Upload) + Asientos SYS/AJE/RJE contabilizados
     Filial       = (Carga + Asientos) × tipo de cambio            [+ redondeo]
     Subgrupo     = Grupo del subgrupo × tipo de cambio  → se vuelve a abrir
     Tipo cambio  = tipo(divisa sociedad) / tipo(divisa raíz); cierre para
                    balance, medio para PyG y DIS; Custom manda si es > 0.

   Todos los importes salen en la divisa de la raíz y con el signo de la
   sábana. Cada nodo de sociedad lleva además su importe en divisa local.
   Las líneas de "Redondeo" muestran lo que falta para cuadrar un nodo con la
   suma de sus hijos (solo si llega a 0,005).
   ══════════════════════════════════════════════════════════════════════ */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const get = (r, k) => r?.[k] ?? r?.[k.charAt(0).toLowerCase() + k.slice(1)];
const isPosted = (r) => {
  const v = get(r, "Posted");
  return v === true || v === "true" || v === "True" || v === 1;
};
const isFlow = (t) => t === "P/L" || t === "DIS";
const ROUND = 0.005;

// Factor de conversión de una divisa a la de la raíz, por tipo de cuenta.
export function makeFx(rates, rootCurrency) {
  const byCur = new Map();
  (rates ?? []).forEach(r => byCur.set(String(get(r, "CurrencyCode") ?? ""), r));
  const rate = (cur, bs) => {
    const r = byCur.get(cur);
    if (!r) return null;
    const pick = (c, d) => (num(c) > 0 ? num(c) : num(d));
    return bs ? pick(get(r, "CustomEndRate"), get(r, "DefaultEndRate")) : pick(get(r, "CustomAvgRate"), get(r, "DefaultAvgRate"));
  };
  return (cur, accountType) => {
    if (!cur || !rootCurrency || cur === rootCurrency) return 1;
    const bs = !isFlow(accountType);
    const a = rate(cur, bs), b = rate(rootCurrency, bs);
    return a && b ? a / b : 1;
  };
}

/* Construye el árbol.
   input = {
     root, codes (Set de cuentas de detalle), sign (−1 en la sábana),
     consByGroup: Map(grupo → filas de consolidated-accounts con GroupShortName = grupo),
     uploaded: filas de uploaded-accounts del periodo (todas las sociedades),
     journals: filas de journal-entries del periodo (todas las sociedades),
     curOf(sociedad) → divisa, nameOf(sociedad) → nombre legal,
     fx (makeFx), accountTypeOf(code)
   } */
export function buildTrail(input) {
  const { root, codes, sign = -1, consByGroup, uploaded, journals, curOf, nameOf, fx, accountTypeOf } = input;
  const inCodes = (r) => codes.has(String(get(r, "AccountCode") ?? ""));
  const typeOf = (r) => get(r, "AccountType") ?? accountTypeOf?.(String(get(r, "AccountCode") ?? "")) ?? "";
  // Suma de filas convertida a la divisa de la raíz (factor por fila según su tipo de cuenta)
  const sumConv = (rows, cur) => rows.reduce((s, r) => s + sign * num(get(r, "AmountYTD")) * fx(cur, typeOf(r)), 0);
  const sumLocal = (rows) => rows.reduce((s, r) => s + sign * num(get(r, "AmountYTD")), 0);

  const uploadsBy = new Map();
  (uploaded ?? []).forEach(r => {
    if (get(r, "Origin") !== "Upload" || !inCodes(r)) return;
    const co = get(r, "CompanyShortName");
    if (!uploadsBy.has(co)) uploadsBy.set(co, []);
    uploadsBy.get(co).push(r);
  });
  const journalsBy = new Map();
  (journals ?? []).forEach(r => {
    if (!isPosted(r) || !inCodes(r)) return;
    const co = get(r, "CompanyShortName");
    if (!journalsBy.has(co)) journalsBy.set(co, []);
    journalsBy.get(co).push(r);
  });

  const node = (key, type, label, extra = {}) => ({ key, type, label, amount: 0, children: [], ...extra });
  const withRounding = (n, official, kind) => {
    const sum = n.children.reduce((s, c) => s + c.amount, 0);
    const diff = official - sum;
    if (Math.abs(diff) >= ROUND) n.children.push(node(`${n.key}~round`, kind, kind === "roundGroup" ? "Redondeo grupo" : "Redondeo empresa", { amount: diff }));
    n.amount = official;
    return n;
  };
  // Agrupa líneas de asiento por número de asiento
  const journalNodes = (rows, cur, keyBase) => {
    const byNum = new Map();
    rows.forEach(r => {
      const jn = String(get(r, "JournalNumber") ?? "—");
      if (!byNum.has(jn)) byNum.set(jn, []);
      byNum.get(jn).push(r);
    });
    return [...byNum.entries()].map(([jn, rs]) => {
      const head = rs[0];
      const n = node(`${keyBase}~${jn}`, "journal", jn, {
        detail: [get(head, "JournalType"), get(head, "JournalHeader")].filter(Boolean).join(" · "),
        counterparty: get(head, "CounterpartyShortName") || "",
        local: { amount: sumLocal(rs), currency: cur },
        amount: sumConv(rs, cur),
      });
      n.children = rs.map((r, i) => node(`${n.key}~${i}`, "journalLine", `${get(r, "AccountCode")} · ${get(r, "AccountName") ?? ""}`.trim(), {
        detail: [get(r, "RowText"), get(r, "CounterpartyShortName") && `↔ ${get(r, "CounterpartyShortName")}`, get(r, "Dimensions")].filter(Boolean).join(" · "),
        local: { amount: sign * num(get(r, "AmountYTD")), currency: cur },
        amount: sign * num(get(r, "AmountYTD")) * fx(cur, typeOf(r)),
      }));
      return n;
    }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  };

  // Empresa (matriz o filial): carga + asientos, en su divisa
  const companyNode = (co, official, keyBase, roleLabel) => {
    const cur = curOf(co);
    const ups = uploadsBy.get(co) ?? [];
    const jrs = (journalsBy.get(co) ?? []).filter(r => ["SYS", "AJE", "RJE"].includes(String(get(r, "JournalType") ?? "").toUpperCase()));
    const n = node(keyBase, "company", nameOf(co) || co, { company: co, detail: roleLabel, currency: cur });
    if (ups.length) {
      const load = node(`${keyBase}~load`, "load", "Carga", { local: { amount: sumLocal(ups), currency: cur }, amount: sumConv(ups, cur) });
      load.children = ups.map((r, i) => node(`${keyBase}~load~${i}`, "line",
        [get(r, "LocalAccountCode"), get(r, "LocalAccountName")].filter(Boolean).join(" · ") || `${get(r, "AccountCode")}`, {
          detail: [get(r, "AccountCode") && `→ ${get(r, "AccountCode")}`, get(r, "CounterpartyShortName") && `↔ ${get(r, "CounterpartyShortName")}`, get(r, "Dimensions")].filter(Boolean).join(" · "),
          local: { amount: sign * num(get(r, "AmountYTD")), currency: cur },
          amount: sign * num(get(r, "AmountYTD")) * fx(cur, typeOf(r)),
        })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      n.children.push(load);
    }
    if (jrs.length) {
      const jn = node(`${keyBase}~jrn`, "journals", "Asientos", { detail: "SYS · AJE · RJE", local: { amount: sumLocal(jrs), currency: cur }, amount: sumConv(jrs, cur) });
      jn.children = journalNodes(jrs, cur, `${keyBase}~jrn`);
      n.children.push(jn);
    }
    n.local = { amount: sumLocal([...ups, ...jrs]), currency: cur };
    return withRounding(n, official, "roundCompany");
  };

  // Grupo (raíz o subgrupo)
  const groupNode = (g, official, keyBase, seen) => {
    const cur = curOf(g);
    const rows = (consByGroup.get(g) ?? []).filter(inCodes);
    const n = node(keyBase, keyBase === "root" ? "root" : "subgroup", nameOf(g) || g, { company: g, currency: cur });
    // Contributivo
    const contribRows = rows.filter(r => {
      const role = get(r, "CompanyRole");
      return role === "Contribution" || (role === "Parent" && get(r, "CompanyShortName") === g);
    });
    const members = [...new Set(contribRows.map(r => get(r, "CompanyShortName")))];
    // la matriz primero, después de mayor a menor importe
    const contrib = node(`${keyBase}~contrib`, "contrib", "Contributivo", { amount: sumConv(contribRows, cur) });
    contrib.children = members.map(co => {
      const own = contribRows.filter(r => get(r, "CompanyShortName") === co);
      const off = sumConv(own, cur);
      const key = `${keyBase}~co~${co}`;
      const isSub = co !== g && !seen.has(co) && (consByGroup.get(co) ?? []).some(r => get(r, "CompanyRole") === "Group");
      if (isSub) {
        const sub = groupNode(co, off, key, new Set([...seen, co]));
        sub.local = { amount: sumLocal((consByGroup.get(co) ?? []).filter(r => inCodes(r) && get(r, "CompanyRole") === "Group")), currency: curOf(co) };
        return sub;
      }
      return companyNode(co, off, key, co === g ? "Matriz" : "Filial");
    }).sort((a, b) => (a.company === g ? -1 : b.company === g ? 1 : Math.abs(b.amount) - Math.abs(a.amount)));
    n.children.push(contrib);
    // Eliminaciones (EJE contabilizados del grupo)
    const eje = (journalsBy.get(g) ?? []).filter(r => String(get(r, "JournalType") ?? "").toUpperCase() === "EJE");
    if (eje.length) {
      const el = node(`${keyBase}~elim`, "elim", "Eliminaciones", { detail: "EJE", local: { amount: sumLocal(eje), currency: cur }, amount: sumConv(eje, cur) });
      el.children = journalNodes(eje, cur, `${keyBase}~elim`);
      n.children.push(el);
    }
    return withRounding(n, official, "roundGroup");
  };

  const rootRows = (consByGroup.get(root) ?? []).filter(r => inCodes(r) && get(r, "CompanyRole") === "Group");
  const rootCur = curOf(root);
  const official = rootRows.reduce((s, r) => s + sign * num(get(r, "AmountYTD")) * fx(rootCur, typeOf(r)), 0);
  return groupNode(root, official, "root", new Set([root]));
}

// Mensual: importe del mes = árbol del periodo − árbol del mes anterior,
// nodo a nodo (mismas claves).
export function diffTrees(cur, prev) {
  if (!prev) return cur;
  const byKey = new Map(prev.children.map(c => [c.key, c]));
  const out = { ...cur, amount: cur.amount - prev.amount };
  if (cur.local && prev.local) out.local = { ...cur.local, amount: cur.local.amount - prev.local.amount };
  const kids = cur.children.map(c => diffTrees(c, byKey.get(c.key)));
  // nodos que solo existían el mes anterior
  prev.children.forEach(p => {
    if (!cur.children.some(c => c.key === p.key)) kids.push(negate(p));
  });
  out.children = kids.filter(k => Math.abs(k.amount) >= ROUND || k.children.length);
  return out;
}
function negate(n) {
  return { ...n, amount: -n.amount, local: n.local ? { ...n.local, amount: -n.local.amount } : n.local, children: n.children.map(negate) };
}

// Comprobación: nodos cuyo importe no es la suma de sus hijos (debería no haber ninguno).
export function checkTree(n, out = []) {
  if (n.children.length) {
    const s = n.children.reduce((a, c) => a + c.amount, 0);
    if (Math.abs(s - n.amount) > 0.01) out.push({ key: n.key, amount: n.amount, sum: s });
    n.children.forEach(c => checkTree(c, out));
  }
  return out;
}
