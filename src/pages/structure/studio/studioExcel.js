/* ══════════════════════════════════════════════════════════════════════
   Excel de estructuras: exportar lo que hay (o la plantilla vacía), leer
   un archivo rellenado y comparar con lo que hay antes de aplicarlo.

   Hojas (por posición de columna, los títulos son solo orientativos):
     Empresas    código, nombre legal, país, CIF, moneda local, tipo, alta, baja, origen, etiquetas
     Propiedad   tenedora, participada, desde, hasta (incluido), % económico, % voto
     Estructura  estructura, empresa, matriz, desde, hasta (incluido), clasificación, método,
                 método filiales, método asociadas
     Mapeo       empresa, desde, hasta (incluido), estructura (vacío = todas), cuenta local,
                 cuenta de grupo, signo
   En el archivo "hasta" es el último día incluido; en la base de datos el
   rango es [desde, hasta+1).
   ══════════════════════════════════════════════════════════════════════ */
import { addDays, parseRange } from "./studioApi.js";
import { labelIndex } from "./studioText.js";

const SHEETS = ["entities", "ownership", "structure", "mapping"];
const HEAD_COLOR = "FF1A2F8A";

const isoOf = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") { // número de serie de Excel
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "object") return v.result != null ? isoOf(v.result) : isoOf(txt(v) || null);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "invalid";
};
const txt = (v) => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(r => r.text).join("").trim();
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
  }
  return String(v).trim();
};
const num = (v) => {
  const s = txt(v).replace("%", "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
// "hasta" incluido (archivo) ↔ fin exclusivo (base de datos)
const toInclusive = (to) => (to ? addDays(to, -1) : null);
const toExclusive = (to) => (to ? addDays(to, 1) : null);

async function download(wb, name) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function styleSheet(ws, widths) {
  ws.columns = widths.map(w => ({ width: w }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_COLOR } };
  head.alignment = { vertical: "middle" };
  head.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/* ── Exportar (con datos o como plantilla) ────────────────────────────── */
export async function exportStructures(data, tx, { template = false, fileName } = {}) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Konsolidator Report";
  const byId = new Map(data.entities.map(e => [e.id, e]));
  const code = (id) => byId.get(id)?.code ?? "";
  const stName = new Map(data.structures.map(s => [s.id, s.name]));

  const wsE = wb.addWorksheet(tx("xl_sheet_entities"));
  wsE.addRow([tx("f_code"), tx("f_legal_name"), tx("f_country"), tx("f_tax_id"), tx("f_currency"), tx("f_type"), tx("f_start"), tx("f_end"), tx("f_source"), tx("f_tags")]);
  const wsO = wb.addWorksheet(tx("xl_sheet_ownership"));
  wsO.addRow([tx("holder"), tx("held"), tx("version_from"), tx("xl_to_incl"), tx("economic"), tx("voting")]);
  const wsS = wb.addWorksheet(tx("xl_sheet_structure"));
  wsS.addRow([tx("structure"), tx("col_company"), tx("col_parent"), tx("version_from"), tx("xl_to_incl"), tx("node_class"), tx("node_method"), tx("node_sub_method"), tx("node_assoc_method")]);
  const wsM = wb.addWorksheet(tx("xl_sheet_mapping"));
  wsM.addRow([tx("col_company"), tx("version_from"), tx("xl_to_incl"), tx("xl_structure_blank"), tx("xl_local_account"), tx("xl_group_account"), tx("xl_sign")]);

  if (template) {
    wsE.addRow(["HOLD", "Holding, S.A.", "ES", "A00000000", "EUR", "company", "2020-01-01", "", "excel", "Iberia"]);
    wsE.addRow(["SUB1", "Filial Uno, S.L.", "ES", "", "EUR", "company", "2021-06-15", "", "excel", ""]);
    wsO.addRow(["HOLD", "SUB1", "2021-06-15", "", 80, 80]);
    wsS.addRow(["DefaultStructure", "HOLD", "", "2020-01-01", "", "parent", "full", "full", "equity"]);
    wsS.addRow(["DefaultStructure", "SUB1", "HOLD", "2021-06-15", "", "subsidiary", "full", "full", "equity"]);
    wsM.addRow(["SUB1", "2021-06-15", "", "", "5720001", "57200000", 1]);
  } else {
    data.entities.forEach(e => wsE.addRow([e.code, e.legal_name ?? "", e.country ?? "", e.tax_id ?? "", e.currency, e.entity_type, e.start_date ?? "", e.end_date ?? "", e.data_source ?? "", (e.tags ?? []).join(", ")]));
    [...data.ownerships].sort((a, b) => code(a.held_entity_id).localeCompare(code(b.held_entity_id)) || String(a._range.from).localeCompare(String(b._range.from)))
      .forEach(o => wsO.addRow([code(o.holder_entity_id), code(o.held_entity_id), o._range.from, toInclusive(o._range.to) ?? "", Number(o.economic_pct), Number(o.voting_pct)]));
    [...data.nodes].filter(n => n.entity_id)
      .sort((a, b) => String(stName.get(a.structure_id)).localeCompare(String(stName.get(b.structure_id))) || code(a.entity_id).localeCompare(code(b.entity_id)) || String(a._range.from).localeCompare(String(b._range.from)))
      .forEach(n => wsS.addRow([stName.get(n.structure_id) ?? "", code(n.entity_id), n.parent_entity_id ? code(n.parent_entity_id) : "", n._range.from, toInclusive(n._range.to) ?? "", n.classification, n.method, n.sub_method, n.assoc_method]));
    (data.mappingLines ?? []).forEach(l => wsM.addRow([l.entity, l.from, toInclusive(l.to) ?? "", l.structure ?? "", l.local, l.group, l.sign]));
  }
  styleSheet(wsE, [14, 36, 10, 16, 12, 14, 13, 13, 14, 24]);
  styleSheet(wsO, [14, 14, 13, 16, 14, 12]);
  styleSheet(wsS, [22, 14, 14, 13, 16, 18, 18, 18, 18]);
  styleSheet(wsM, [14, 13, 16, 22, 18, 18, 8]);

  const wsI = wb.addWorksheet(tx("xl_sheet_help"));
  wsI.columns = [{ width: 120 }];
  ["xl_help_1", "xl_help_2", "xl_help_3", "xl_help_4", "xl_help_5", "xl_help_6", "xl_help_7", "xl_help_8"].forEach((k, i) => {
    const r = wsI.addRow([tx(k)]);
    if (i === 0) r.font = { bold: true, size: 13, color: { argb: HEAD_COLOR } };
    r.alignment = { wrapText: true, vertical: "top" };
  });
  await download(wb, fileName ?? (template ? `${tx("xl_file_template")}.xlsx` : `${tx("xl_file_export")}.xlsx`));
}

/* ── Leer un archivo ──────────────────────────────────────────────────── */
// knownCodes: códigos que ya existen; se respeta su mayúscula/minúscula para
// no crear la misma empresa dos veces ("HoldCo" y "HOLDCO").
export async function parseStructuresFile(file, tx, knownCodes = []) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  // Hojas por su nombre (en cualquier idioma); si no se reconocen, por posición sin la de instrucciones
  const names = labelIndex("xl_sheet_");
  const visible = wb.worksheets.filter(w => w.state !== "hidden");
  const byName = {};
  visible.forEach(w => { const id = names.get(String(w.name).trim().toLowerCase()); if (id && !byName[id]) byName[id] = w; });
  const positional = visible.filter(w => names.get(String(w.name).trim().toLowerCase()) !== "help");
  const pick = (id, i) => byName[id] ?? (Object.keys(byName).length >= 3 ? null : positional[i]);
  const wsE = pick("entities", 0), wsO = pick("ownership", 1), wsS = pick("structure", 2), wsM = pick("mapping", 3);
  if (!wsE || !wsO || !wsS) return { error: tx("imp_bad_file") };

  const errors = [];
  const rowsOf = (ws, n) => {
    const out = [];
    ws?.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1) return;
      const cells = Array.from({ length: n }, (_, k) => row.getCell(k + 1));
      const vals = cells.map(c => c.value);
      if (vals.every(v => txt(v) === "")) return;
      out.push({ i, vals, cells });
    });
    return out;
  };
  // Un 80 % escrito con formato de porcentaje llega como 0,8
  const pct = (cell) => {
    const n = num(cell.value);
    return n != null && !Number.isNaN(n) && typeof cell.value === "number" && String(cell.numFmt ?? "").includes("%") ? +(n * 100).toFixed(6) : n;
  };
  const err = (sheet, r, key, vars) => errors.push({ sheet, row: r, msg: tx(key, vars) });
  const types = labelIndex("type_"), classes = labelIndex("cls_"), methods = labelIndex("mth_");
  const sources = labelIndex("src_");
  const canon = new Map();
  knownCodes.forEach(c => canon.set(String(c).toLowerCase(), c));
  const code = (v) => {
    const c = txt(v);
    if (!c) return "";
    const k = c.toLowerCase();
    if (!canon.has(k)) canon.set(k, c);
    return canon.get(k);
  };
  const range = (sheet, i, fromV, toV) => {
    const from = isoOf(fromV), toIncl = isoOf(toV);
    if (!from || from === "invalid" || toIncl === "invalid") { err(sheet, i, "xl_err_date"); return { from, to: null }; }
    if (toIncl && toIncl < from) err(sheet, i, "xl_err_range");
    return { from, to: toExclusive(toIncl) };
  };

  const entities = rowsOf(wsE, 10).map(({ i, vals }) => {
    const e = {
      code: code(vals[0]), legal_name: txt(vals[1]) || null, country: txt(vals[2]).toUpperCase() || null,
      tax_id: txt(vals[3]) || null, currency: txt(vals[4]).toUpperCase(),
      entity_type: types.get(txt(vals[5]).toLowerCase()) ?? (txt(vals[5]) ? null : "company"),
      start_date: isoOf(vals[6]), end_date: isoOf(vals[7]),
      data_source: sources.get(txt(vals[8]).toLowerCase()) ?? null,
      tags: txt(vals[9]) ? txt(vals[9]).split(",").map(x => x.trim()).filter(Boolean) : [],
    };
    if (!e.code) err("E", i, "xl_err_code");
    if (!/^[A-Z]{3}$/.test(e.currency)) err("E", i, "xl_err_currency", { v: e.currency || "—" });
    if (e.entity_type == null) err("E", i, "xl_err_value", { v: txt(vals[5]) });
    if (e.start_date === "invalid" || e.end_date === "invalid") err("E", i, "xl_err_date");
    else if (e.start_date && e.end_date && e.end_date < e.start_date) err("E", i, "xl_err_range");
    return e;
  });
  const codes = new Set(entities.map(e => e.code));
  const ownerships = rowsOf(wsO, 6).map(({ i, vals, cells }) => {
    const o = { holder: code(vals[0]), held: code(vals[1]), ...range("O", i, vals[2], vals[3]), economic: pct(cells[4]), voting: pct(cells[5]) };
    if (!o.holder || !o.held) err("O", i, "xl_err_code");
    if (o.economic == null || Number.isNaN(o.economic) || o.economic <= 0 || o.economic > 100) err("O", i, "xl_err_pct");
    if (o.voting != null && (Number.isNaN(o.voting) || o.voting < 0 || o.voting > 100)) err("O", i, "xl_err_pct");
    return o;
  });
  const nodes = rowsOf(wsS, 9).map(({ i, vals }) => {
    const n = {
      structure: txt(vals[0]) || "DefaultStructure",
      entity: code(vals[1]), parent: code(vals[2]) || null,
      ...range("S", i, vals[3], vals[4]),
      classification: classes.get(txt(vals[5]).toLowerCase()) ?? (txt(vals[5]) ? null : undefined),
      method: methods.get(txt(vals[6]).toLowerCase()) ?? (txt(vals[6]) ? null : undefined),
      sub_method: methods.get(txt(vals[7]).toLowerCase()) ?? "full",
      assoc_method: methods.get(txt(vals[8]).toLowerCase()) ?? "equity",
    };
    if (!n.entity) err("S", i, "xl_err_code");
    if (n.classification === null) err("S", i, "xl_err_value", { v: txt(vals[5]) });
    if (n.method === null) err("S", i, "xl_err_value", { v: txt(vals[6]) });
    if (n.classification === undefined || (n.classification === "parent" && n.parent)) n.classification = n.parent ? "subsidiary" : "parent";
    if (n.method === undefined) n.method = "full";
    return n;
  });
  // Mapeo: una versión por empresa + fecha + ámbito
  const mapGroups = new Map();
  rowsOf(wsM, 7).forEach(({ i, vals }) => {
    const entity = code(vals[0]);
    if (!entity) { err("M", i, "xl_err_code"); return; }
    const { from, to } = range("M", i, vals[1], vals[2]);
    if (!from || from === "invalid") return;
    const structure = txt(vals[3]) || null;
    const key = `${entity}|${from}|${structure ?? ""}`;
    if (!mapGroups.has(key)) mapGroups.set(key, { entity, from, to, structure, all_structures: !structure, lines: [] });
    const sign = num(vals[6]);
    mapGroups.get(key).lines.push({ local: txt(vals[4]), group: txt(vals[5]), sign: sign === -1 ? -1 : 1 });
  });
  const mappings = [...mapGroups.values()];

  // Códigos que no están en la hoja de empresas (se comprueban también contra la base)
  const unknown = new Set();
  [...ownerships.flatMap(o => [o.holder, o.held]), ...nodes.flatMap(n => [n.entity, n.parent]), ...mappings.map(m => m.entity)]
    .filter(Boolean).forEach(c => { if (!codes.has(c)) unknown.add(c); });
  return { entities, ownerships, nodes, mappings, errors, unknownCodes: [...unknown] };
}

/* ── Comparar con lo que hay ──────────────────────────────────────────── */
const key = (o) => Object.values(o).map(v => (v == null ? "" : typeof v === "number" ? String(+v.toFixed(6)) : String(v))).join("|");

export function diffImport(data, parsed, targetStructures) {
  const byCode = new Map(data.entities.map(e => [e.code, e]));
  const codeOf = new Map(data.entities.map(e => [e.id, e.code]));
  const out = { entities: { added: [], changed: [], same: 0 }, ownerships: { added: [], removed: [], same: 0 }, nodes: { added: [], removed: [], same: 0 }, mappings: parsed.mappings?.length ?? 0 };

  parsed.entities.forEach(e => {
    const cur = byCode.get(e.code);
    if (!cur) { out.entities.added.push(e); return; }
    // Igual que import_structure: estos campos solo cambian si vienen rellenos…
    const kept = ["legal_name", "country", "tax_id", "currency", "start_date", "data_source"]
      .filter(f => (e[f] ?? null) !== null && String(e[f]) !== String(cur[f] ?? ""));
    // …y estos se sustituyen siempre que vengan en el archivo, aunque sea vacíos
    const norm = (f, v) => (f === "tags" ? (v ?? []).join(", ") : String(v ?? ""));
    const replaced = ["entity_type", "end_date", "tags"].filter(f => f in e && norm(f, e[f]) !== norm(f, cur[f]));
    const changed = [...kept, ...replaced];
    if (changed.length) out.entities.changed.push({ ...e, fields: changed });
    else out.entities.same += 1;
  });

  // Propiedad: se sustituye la de las participadas que vienen en el archivo
  const heldSet = new Set(parsed.ownerships.map(o => o.held));
  const curO = data.ownerships.filter(o => heldSet.has(codeOf.get(o.held_entity_id))).map(o => ({
    holder: codeOf.get(o.holder_entity_id), held: codeOf.get(o.held_entity_id), from: o._range.from, to: o._range.to,
    economic: Number(o.economic_pct), voting: Number(o.voting_pct),
  }));
  const normO = (o) => ({ holder: o.holder, held: o.held, from: o.from, to: o.to ?? null, economic: Number(o.economic), voting: Number(o.voting ?? o.economic) });
  const curOK = new Map(curO.map(o => [key(normO(o)), o]));
  const newOK = new Map(parsed.ownerships.map(o => [key(normO(o)), o]));
  newOK.forEach((o, k) => (curOK.has(k) ? (out.ownerships.same += 1) : out.ownerships.added.push(o)));
  curOK.forEach((o, k) => { if (!newOK.has(k)) out.ownerships.removed.push(o); });

  // Nodos: se sustituyen los de las estructuras que vienen en el archivo
  const stByName = new Map(data.structures.map(s => [s.name, s]));
  targetStructures.forEach(name => {
    const s = stByName.get(name);
    const cur = s ? data.nodes.filter(n => n.structure_id === s.id && n.entity_id).map(n => ({
      structure: name, entity: codeOf.get(n.entity_id), parent: n.parent_entity_id ? codeOf.get(n.parent_entity_id) : null,
      from: n._range.from, to: n._range.to, classification: n.classification, method: n.method,
    })) : [];
    const normN = (n) => ({ structure: n.structure, entity: n.entity, parent: n.parent ?? null, from: n.from, to: n.to ?? null, classification: n.classification, method: n.method });
    const curK = new Map(cur.map(n => [key(normN(n)), n]));
    const newK = new Map(parsed.nodes.filter(n => n.structure === name).map(n => [key(normN(n)), n]));
    newK.forEach((n, k) => (curK.has(k) ? (out.nodes.same += 1) : out.nodes.added.push(n)));
    curK.forEach((n, k) => { if (!newK.has(k)) out.nodes.removed.push(n); });
  });
  return out;
}

// Paquetes para import_structure, uno por estructura y en orden: el primero
// lleva las empresas, la propiedad y los mapeos comunes; cada estructura
// lleva sus nodos y sus mapeos propios. Si una estructura solo aparece en
// la hoja Mapeo, su paquete no sustituye los nodos (replace = false).
export function buildPayloads(parsed, source, primaryName) {
  const withNodes = [...new Set(parsed.nodes.map(n => n.structure))];
  const mapOnly = [...new Set(parsed.mappings.map(m => m.structure).filter(Boolean))].filter(n => !withNodes.includes(n));
  const strip = (m) => { const c = { ...m }; delete c.structure; return c; };
  const common = parsed.mappings.filter(m => !m.structure).map(m => ({ ...strip(m), all_structures: true }));
  const own = (name) => parsed.mappings.filter(m => m.structure === name).map(m => ({ ...strip(m), all_structures: false }));
  const out = [];
  if (!withNodes.length) {
    out.push({ source, replace: true, entities: parsed.entities, ownerships: parsed.ownerships, nodes: [], mappings: common });
  }
  withNodes.forEach((name, i) => out.push({
    source, replace: true,
    structure: { name, kind: "legal", is_primary: name === primaryName },
    entities: i === 0 ? parsed.entities : [],
    ownerships: i === 0 ? parsed.ownerships : [],
    nodes: parsed.nodes.filter(n => n.structure === name).map(strip),
    mappings: [...(i === 0 ? common : []), ...own(name)],
  }));
  mapOnly.forEach(name => out.push({
    source, replace: false, structure: { name, kind: "legal", is_primary: false },
    entities: [], ownerships: [], nodes: [], mappings: own(name),
  }));
  return out;
}

// Líneas de mapeo actuales para exportarlas
export function mappingLinesForExport(data, lines) {
  const codeOf = new Map(data.entities.map(e => [e.id, e.code]));
  const stName = new Map(data.structures.map(s => [s.id, s.name]));
  const mapBy = new Map(data.mappings.map(m => [m.id, m]));
  return (lines ?? []).map(l => {
    const m = mapBy.get(l.mapping_id);
    const r = m?._range ?? parseRange(m?.valid);
    return { entity: codeOf.get(m?.entity_id) ?? "", from: r.from, to: r.to, structure: m?.structure_id ? stName.get(m.structure_id) : "", local: l.local_account_code, group: l.group_account_code, sign: l.sign };
  });
}
export const SHEET_KEYS = SHEETS;
