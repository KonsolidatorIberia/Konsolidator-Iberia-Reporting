/* ══════════════════════════════════════════════════════════════════════
   Estructuras propias (nivel Pro y Max): lectura y operaciones contra el
   esquema ledger de Supabase (migración 002_ledger_estructuras.sql).

   La interfaz no edita filas de propiedad ni de estructura: llama a
   operaciones con fecha (record_ownership, set_node, exit_node…) que
   cierran la versión vigente y abren otra. Las reglas duras están en la
   base de datos y vuelven como errores "ledger:<código>" (parseLedgerError).
   ══════════════════════════════════════════════════════════════════════ */
import { supabase } from "../../../lib/supabaseClient";

const L = () => supabase.schema("ledger");
const PRO_TIERS = ["pro", "max"];
export const isProTier = (tier) => PRO_TIERS.includes(String(tier ?? "").toLowerCase());

// "[2023-01-01,2025-03-15)" → { from: "2023-01-01", to: "2025-03-15" | null }
export function parseRange(r) {
  if (!r) return { from: null, to: null };
  const m = /^[[(]\s*"?([^,"]*)"?\s*,\s*"?([^)\]"]*)"?\s*[)\]]$/.exec(String(r));
  if (!m) return { from: null, to: null };
  return { from: m[1] || null, to: m[2] || null };
}
// Fecha ISO de hoy (en local) y aritmética de días
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const addDays = (iso, n) => {
  if (!iso) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// ¿La versión [from, to) está vigente en la fecha?
export const coversDate = (row, iso) => {
  const { from, to } = row._range ?? parseRange(row.valid);
  return (!from || from <= iso) && (!to || iso < to);
};
const withRange = (rows) => (rows ?? []).map(r => ({ ...r, _range: parseRange(r.valid) }));

// Error de la base de datos → { code, detail, message }
export function parseLedgerError(err) {
  const msg = String(err?.message ?? err ?? "");
  const m = /ledger:([a-z_0-9]+)/.exec(msg);
  let detail = {};
  try { detail = err?.details ? JSON.parse(err.details) : {}; } catch { detail = {}; }
  if (m) return { code: m[1], detail, message: msg };
  if (/row-level security|permission denied/i.test(msg)) return { code: "forbidden", detail, message: msg };
  if (/conflicting key value violates exclusion constraint/i.test(msg)) return { code: "overlap", detail, message: msg };
  if (/duplicate key value/i.test(msg)) return { code: "duplicate", detail, message: msg };
  if (/schema must be one of|Invalid schema/i.test(msg)) return { code: "schema_not_exposed", detail, message: msg };
  if (/does not exist/i.test(msg) && /ledger\./.test(msg)) return { code: "not_installed", detail, message: msg };
  return { code: "unknown", detail, message: msg };
}
const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/* ── Cliente actual, nivel y permisos ─────────────────────────────────── */
export async function loadAccess(userId, companyIdHint) {
  let companyId = companyIdHint ?? null;
  if (!companyId && userId) {
    const { data } = await supabase.schema("accounts").from("user_companies")
      .select("company_id, is_default").eq("user_id", userId).eq("is_active", true)
      .order("is_default", { ascending: false }).limit(1);
    companyId = data?.[0]?.company_id ?? null;
  }
  if (!companyId) return { companyId: null, tier: null, name: null, canEdit: false };
  const { data: co } = await supabase.schema("accounts").from("companies")
    .select("id, name, tier").eq("id", companyId).maybeSingle();
  let canEdit = false;
  if (isProTier(co?.tier)) {
    const { data: ok } = await L().rpc("can_edit_structures", { p_company_id: companyId });
    canEdit = !!ok;
  }
  return { companyId, tier: co?.tier ?? null, name: co?.name ?? null, canEdit };
}

/* ── Todo lo de la página de una vez ──────────────────────────────────── */
// La API devuelve como mucho 1.000 filas por consulta: se pide por páginas
async function all(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

export async function loadStudio(companyId) {
  const q = (table, cols = "*") => () => L().from(table).select(cols).eq("company_id", companyId).order("id");
  const [settings, entities, structures, nodes, ownerships, currencies, mappings, oEvents, sEvents, periods] = await Promise.all([
    L().from("group_settings").select("*").eq("company_id", companyId).maybeSingle().then(check),
    all(q("entities")),
    L().from("structures").select("*").eq("company_id", companyId).order("is_primary", { ascending: false }).order("name").then(check),
    all(q("structure_nodes")),
    all(q("ownerships")),
    all(q("entity_currencies")),
    all(q("account_mappings", "id, entity_id, structure_id, name, valid, account_mapping_lines(count)")),
    L().from("ownership_events").select("*").eq("company_id", companyId).order("effective_date", { ascending: false }).order("id", { ascending: false }).limit(1000).then(check),
    L().from("structure_events").select("*").eq("company_id", companyId).order("effective_date", { ascending: false }).order("id", { ascending: false }).limit(1000).then(check),
    L().from("periods").select("id, period_type, fiscal_year, fiscal_month, fiscal_week, start_date, end_date, is_locked")
      .eq("company_id", companyId).eq("period_type", "month").order("start_date").limit(1000).then(check),
  ]);
  entities.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return {
    settings: settings ?? null,
    entities,
    structures: structures ?? [],
    nodes: withRange(nodes),
    ownerships: withRange(ownerships),
    currencies: withRange(currencies),
    mappings: withRange(mappings).map(m => ({ ...m, lines: m.account_mapping_lines?.[0]?.count ?? 0 })),
    ownershipEvents: oEvents ?? [],
    structureEvents: sEvents ?? [],
    months: periods ?? [],
  };
}

export async function loadPerimeter(structureId, date) {
  const [per, warn] = await Promise.all([
    L().rpc("perimeter", { p_structure: structureId, p_date: date }).then(check),
    L().rpc("structure_warnings", { p_structure: structureId, p_date: date }).then(check),
  ]);
  return { perimeter: per ?? [], warnings: warn ?? [] };
}

export async function loadAudit(companyId, entityId, limit = 200) {
  let q = L().from("audit_log").select("*").eq("company_id", companyId).order("at", { ascending: false }).limit(limit);
  if (entityId) q = q.eq("entity_id", entityId);
  return check(await q);
}

export async function loadCompanyUsers(companyId) {
  const { data, error } = await supabase.rpc("pres_company_users", { cid: companyId });
  if (error) return [];
  return (data ?? []).map(u => ({ id: u.user_id, name: u.name || u.email, email: u.email }));
}

/* ── Operaciones ──────────────────────────────────────────────────────── */
export const recordOwnership = (a) => L().rpc("record_ownership", {
  p_company: a.companyId, p_holder: a.holderId, p_held: a.heldId, p_date: a.date,
  p_economic: Number(a.economic), p_voting: a.voting === "" || a.voting == null ? null : Number(a.voting),
  p_event: a.event, p_note: a.note || null, p_acquisition: a.acquisition ?? {},
}).then(check);

export const setNode = (a) => L().rpc("set_node", {
  p_structure: a.structureId, p_entity: a.entityId, p_date: a.date, p_parent: a.parentId || null,
  p_classification: a.classification, p_method: a.method,
  p_sub_method: a.subMethod ?? "full", p_assoc_method: a.assocMethod ?? "equity", p_note: a.note || null,
}).then(check);

export const exitNode = (a) => L().rpc("exit_node", {
  p_structure: a.structureId, p_entity: a.entityId, p_date: a.date, p_note: a.note || null,
}).then(check);

export const setFunctionalCurrency = (a) => L().rpc("set_functional_currency", {
  p_company: a.companyId, p_entity: a.entityId, p_date: a.date, p_currency: a.currency,
}).then(check);

export const importStructure = (companyId, payload) =>
  L().rpc("import_structure", { p_company: companyId, p_payload: payload }).then(check);

export const generatePeriods = (companyId, fromYear, toYear, replace = false) =>
  L().rpc("generate_periods", { p_company: companyId, p_from_year: fromYear, p_to_year: toYear, p_replace: replace }).then(check);

export async function saveSettings(companyId, patch) {
  return check(await L().from("group_settings")
    .upsert({ company_id: companyId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "company_id" })
    .select().maybeSingle());
}

export async function saveEntity(companyId, entity) {
  const row = {
    company_id: companyId,
    code: String(entity.code ?? "").trim(),
    legal_name: entity.legal_name || null,
    currency: String(entity.currency ?? "").toUpperCase(),
    country: entity.country ? String(entity.country).toUpperCase() : null,
    tax_id: entity.tax_id || null,
    entity_type: entity.entity_type || "company",
    start_date: entity.start_date || null,
    end_date: entity.end_date || null,
    tags: entity.tags ?? [],
    data_owner: entity.data_owner || null,
    data_source: entity.data_source || null,
  };
  if (entity.id) return check(await L().from("entities").update(row).eq("id", entity.id).select().maybeSingle());
  return check(await L().from("entities").insert(row).select().maybeSingle());
}

export async function createStructure(companyId, { name, kind = "legal", isPrimary = false, description = null }) {
  if (isPrimary) await L().from("structures").update({ is_primary: false }).eq("company_id", companyId).eq("is_primary", true);
  return check(await L().from("structures")
    .insert({ company_id: companyId, name: String(name).trim(), kind, is_primary: isPrimary, description })
    .select().maybeSingle());
}

export async function updateStructure(companyId, id, patch) {
  if (patch.is_primary) await L().from("structures").update({ is_primary: false }).eq("company_id", companyId).eq("is_primary", true);
  return check(await L().from("structures").update(patch).eq("id", id).select().maybeSingle());
}

export async function setMonthLocked(periodId, locked) {
  return check(await L().from("periods").update({ is_locked: locked }).eq("id", periodId).select("id, is_locked").maybeSingle());
}

/* ── Konsolidator (API v2): estructura de partida ─────────────────────── */
function normRow(obj) {
  const out = {};
  Object.keys(obj ?? {}).forEach(k => { out[k.charAt(0).toLowerCase() + k.slice(1)] = obj[k]; });
  return out;
}
async function kFetch(path, token) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  const arr = json.value ?? (Array.isArray(json) ? json : [json]);
  return arr.map(normRow);
}
const firstOfMonth = (y, m) => (y && m ? `${y}-${String(m).padStart(2, "0")}-01` : null);
const firstAfterMonth = (y, m) => {
  if (!y || y <= 0) return null;
  const mm = Number(m) || 12;
  return mm === 12 ? `${Number(y) + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, "0")}-01`;
};
// "Reconocer como" de Konsolidator → clasificación y método por separado
function classify(recognizeAs, isRoot) {
  if (isRoot) return { classification: "parent", method: "full" };
  const r = String(recognizeAs ?? "").toLowerCase();
  if (/equity|puesta|associate|asociad|capital/.test(r)) return { classification: "associate", method: "equity" };
  if (/proportional|proporcional|joint|multigrupo/.test(r)) return { classification: "joint_venture", method: "proportional" };
  if (/invest|financ/.test(r)) return { classification: "investment", method: "none" };
  return { classification: "subsidiary", method: "full" };
}

// Lee la estructura de Konsolidator y la convierte en el formato de import_structure
export async function readKonsolidator(token, structureName) {
  const [gs, companies, ownership, structs] = await Promise.all([
    kFetch("/v2/group-structure", token), kFetch("/v2/companies", token),
    kFetch("/v2/ownership", token), kFetch("/v2/structures", token).catch(() => []),
  ]);
  const names = [...new Set(gs.map(r => r.groupStructure).filter(Boolean))];
  const chosen = structureName && names.includes(structureName) ? structureName
    : structs.find(s => s.isDefault)?.groupStructure ?? names[0];
  const rows = gs.filter(r => r.groupStructure === chosen && !r.detached);
  const coBy = new Map(companies.map(c => [c.companyShortName, c]));
  const fallbackFrom = "2000-01-01";
  const entities = companies.map(c => ({
    code: c.companyShortName,
    legal_name: c.companyLegalName || null,
    currency: c.currencyCode || "EUR",
    start_date: null,
  }));
  rows.forEach(r => {
    if (!coBy.has(r.companyShortName)) entities.push({ code: r.companyShortName, legal_name: r.companyLegalName || null, currency: r.currencyCode || "EUR" });
  });
  const parentOf = new Map(rows.map(r => [r.companyShortName, r.parentShortName && r.parentShortName !== r.companyShortName ? r.parentShortName : null]));
  const nodes = rows.map(r => {
    const co = coBy.get(r.companyShortName) ?? {};
    const parent = parentOf.get(r.companyShortName);
    const cls = co.consolidate === false && parent
      ? { classification: "investment", method: "none" }
      : classify(co.recognizeAs ?? co.type, !parent);
    return {
      entity: r.companyShortName, parent,
      from: firstOfMonth(co.consolidateFromYear, co.consolidateFromMonth) ?? fallbackFrom,
      to: null, ...cls,
    };
  });
  // Varias filas por empresa = historial: se ordenan y se recortan para que no se solapen
  const byHeld = new Map();
  ownership.forEach(o => {
    const parent = parentOf.get(o.companyShortName);
    if (!parent || !(Number(o.ownershipPercentage) > 0)) return;
    const row = {
      holder: parent, held: o.companyShortName,
      from: firstOfMonth(o.fromYear, o.fromMonth) ?? fallbackFrom,
      to: firstAfterMonth(o.toYear, o.toMonth),
      economic: Number(o.ownershipPercentage), voting: Number(o.ownershipPercentage),
    };
    if (!byHeld.has(row.held)) byHeld.set(row.held, []);
    byHeld.get(row.held).push(row);
  });
  const ownerships = [];
  byHeld.forEach(list => {
    list.sort((a, b) => a.from.localeCompare(b.from));
    list.forEach((r, i) => {
      const next = list[i + 1];
      if (next && (!r.to || r.to > next.from)) r.to = next.from;
      if (!r.to || r.to > r.from) ownerships.push(r);
    });
  });
  // La primera consolidación no puede ser anterior al alta: se usa como alta la primera fecha conocida
  const firstSeen = new Map();
  [...nodes.map(n => [n.entity, n.from]), ...ownerships.map(o => [o.held, o.from])].forEach(([code, d]) => {
    if (d && (!firstSeen.has(code) || d < firstSeen.get(code))) firstSeen.set(code, d);
  });
  entities.forEach(e => { e.start_date = firstSeen.get(e.code) ?? null; });
  return {
    structureNames: names,
    payload: {
      source: "konsolidator", replace: true,
      structure: { name: chosen || "DefaultStructure", kind: "legal", is_primary: true },
      entities, ownerships, nodes,
    },
  };
}

// Líneas de todos los mapeos (para exportar a Excel)
export async function loadMappingLines(companyId) {
  return all(() => L().from("account_mapping_lines")
    .select("mapping_id, local_account_code, group_account_code, sign")
    .eq("company_id", companyId).order("mapping_id").order("local_account_code"));
}
