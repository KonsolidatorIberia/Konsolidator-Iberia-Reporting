// src/lib/kpisApi.js
// All Supabase CRUD for public.company_kpis and public.user_kpi_dashboard.
// Mirrors mappingsApi.js — uses publishable key + user's JWT for RLS.

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

function getAccessToken() {
  try {
    const raw = localStorage.getItem("sb-gmcawsapzkzmgrtiqebv-auth-token");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token ?? null;
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const token = getAccessToken();
  return {
    apikey:          SUPABASE_APIKEY,
    Authorization:   `Bearer ${token ?? SUPABASE_APIKEY}`,
    "Content-Type":  "application/json",
    ...extra,
  };
}

// ════════════════════════════════════════════════════════════════
// LIST: all non-archived company KPIs
//
// scope:
//   "individual"   → individual + shared KPIs
//   "consolidated" → consolidated + shared KPIs
//   null / "*"     → everything
//
// contextMappingId:
//   null   → only standard (no mapping) KPIs
//   "uuid" → only KPIs created under that mapping
//   "*"    → all (default)
// ════════════════════════════════════════════════════════════════
export async function listCompanyKpis({
  companyId,
  contextMappingId = "*",
  scope = null,
}) {
  if (!companyId) return [];

  let url = `${SUPABASE_URL}/company_kpis?select=*&company_id=eq.${companyId}&is_archived=eq.false&order=created_at.asc`;

  if (contextMappingId === null) {
    url += `&context_mapping_id=is.null`;
  } else if (contextMappingId !== "*") {
    url += `&context_mapping_id=eq.${contextMappingId}`;
  }

  // Scope filter: include the requested scope + always include "shared"
  if (scope === "individual") {
    url += `&scope=in.(individual,shared)`;
  } else if (scope === "consolidated") {
    url += `&scope=in.(consolidated,shared)`;
  }
  // scope = null / "*" → no filter, return everything

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[kpisApi] listCompanyKpis failed:", await res.text());
    return [];
  }
  return await res.json();
}

// ════════════════════════════════════════════════════════════════
// CREATE: new custom KPI
// scope: "individual" | "consolidated" | "shared"  (default: "individual")
// ════════════════════════════════════════════════════════════════
export async function createCompanyKpi({
  companyId, userId,
  label, description = null, category = null, tag = null,
  format = "currency", formula, benchmark = null,
  contextMappingId = null,
  scope = "individual",
  kpiType = "custom",
  sourceSystemKpiId = null,
}) {
  const payload = {
    company_id:           companyId,
    label,
    description,
    category,
    tag,
    format,
    formula,
    benchmark,
    context_mapping_id:   contextMappingId,
    created_by:           userId,
    updated_by:           userId,
    scope,
    kpi_type:             kpiType,
    source_system_kpi_id: sourceSystemKpiId,
  };

  const res = await fetch(`${SUPABASE_URL}/company_kpis`, {
    method:  "POST",
    headers: authHeaders({ Prefer: "return=representation" }),
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[kpisApi] createCompanyKpi failed:", err);
    throw new Error(err || "Create failed");
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ════════════════════════════════════════════════════════════════
// UPDATE: edit an existing KPI (label, formula, etc.)
// ════════════════════════════════════════════════════════════════
export async function updateCompanyKpi({
  kpiId, userId,
  label, description, category, tag, format, formula, benchmark,
  kpiType, sourceSystemKpiId,
}) {
  const payload = { updated_by: userId };
  if (label              !== undefined) payload.label                = label;
  if (description        !== undefined) payload.description          = description;
  if (category           !== undefined) payload.category             = category;
  if (tag                !== undefined) payload.tag                  = tag;
  if (format             !== undefined) payload.format               = format;
  if (formula            !== undefined) payload.formula              = formula;
  if (benchmark          !== undefined) payload.benchmark            = benchmark;
  if (kpiType            !== undefined) payload.kpi_type             = kpiType;
  if (sourceSystemKpiId  !== undefined) payload.source_system_kpi_id = sourceSystemKpiId;

  const res = await fetch(
    `${SUPABASE_URL}/company_kpis?kpi_id=eq.${kpiId}`,
    {
      method:  "PATCH",
      headers: authHeaders({ Prefer: "return=representation" }),
      body:    JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[kpisApi] updateCompanyKpi failed:", err);
    throw new Error(err || "Update failed");
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ════════════════════════════════════════════════════════════════
// ARCHIVE: soft delete
// ════════════════════════════════════════════════════════════════
export async function deleteCompanyKpi({ kpiId }) {
  const res = await fetch(
    `${SUPABASE_URL}/company_kpis?kpi_id=eq.${kpiId}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[kpisApi] deleteCompanyKpi failed:", err);
    throw new Error(err || "Delete failed");
  }
  return true;
}

export async function archiveCompanyKpi({ kpiId, userId }) {
  const res = await fetch(
    `${SUPABASE_URL}/company_kpis?kpi_id=eq.${kpiId}`,
    {
      method:  "PATCH",
      headers: authHeaders(),
      body:    JSON.stringify({ is_archived: true, updated_by: userId }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[kpisApi] archiveCompanyKpi failed:", err);
    throw new Error(err || "Archive failed");
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
// IMPORT: copy an existing KPI into a different scope
// e.g. copy an "individual" KPI → "consolidated" (or vice versa)
// Returns the newly created KPI row.
// ════════════════════════════════════════════════════════════════
export async function importKpiToScope({ kpiId, targetScope, companyId, userId }) {
  // 1. Fetch the source KPI
  const srcRes = await fetch(
    `${SUPABASE_URL}/company_kpis?kpi_id=eq.${kpiId}&select=*`,
    { headers: authHeaders() }
  );
  if (!srcRes.ok) throw new Error("Could not fetch source KPI");
  const rows = await srcRes.json();
  const src = Array.isArray(rows) ? rows[0] : rows;
  if (!src) throw new Error("KPI not found");

  // 2. Create a copy with the target scope
  return createCompanyKpi({
    companyId,
    userId,
    label:            src.label,
    description:      src.description,
    category:         src.category,
    tag:              src.tag,
    format:           src.format,
    formula:          src.formula,
    benchmark:        src.benchmark,
    contextMappingId: null,   // import starts without a mapping context
    scope:            targetScope,
  });
}

// ════════════════════════════════════════════════════════════════
// USER DASHBOARD
// Separate saved KPI list per user × company × scope.
// Table: public.user_kpi_dashboard  (singular — has scope column)
//   UNIQUE (user_id, company_id, scope)
// ════════════════════════════════════════════════════════════════
export async function getUserDashboard({ userId, companyId, scope = "individual_company" }) {
  if (!userId || !companyId) return null;
  const dbScope = scope.startsWith("consolidated") ? "consolidated" : "individual";
  const url = `${SUPABASE_URL}/user_kpi_dashboard?select=*&user_id=eq.${userId}&company_id=eq.${companyId}&scope=eq.${dbScope}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) { console.error("[kpisApi] getUserDashboard:", await res.text()); return null; }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  const ids = Array.isArray(row.kpi_ids) ? row.kpi_ids : [];
  const marker = `__tab:${scope}__`;
  const markerIdx = ids.indexOf(marker);
  if (markerIdx === -1) {
    return ids.length > 0 ? { ...row, kpi_ids: [...new Set(ids.filter(id => !id.startsWith("__tab:")))] } : null;
  }
  const nextMarkerIdx = ids.findIndex((id, i) => i > markerIdx && id.startsWith("__tab:"));
  const tabIds = nextMarkerIdx === -1 ? ids.slice(markerIdx + 1) : ids.slice(markerIdx + 1, nextMarkerIdx);
  return { ...row, kpi_ids: [...new Set(tabIds)] };
}

export async function saveUserDashboard({ userId, companyId, kpiIds, scope = "individual_company" }) {
  if (!userId || !companyId) throw new Error("Missing userId/companyId");
  const safeIds = Array.isArray(kpiIds) ? [...new Set(kpiIds)] : [];
  const isConsolidated = scope.startsWith("consolidated");
  const dbScope = isConsolidated ? "consolidated" : "individual";
  const allTabs = isConsolidated
    ? ["consolidated_company", "consolidated_dimension"]
    : ["individual_company", "individual_dimension"];

  let existingIds = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/user_kpi_dashboard?select=kpi_ids&user_id=eq.${userId}&company_id=eq.${companyId}&scope=eq.${dbScope}`, { headers: authHeaders() });
    if (r.ok) { const rows = await r.json(); existingIds = Array.isArray(rows?.[0]?.kpi_ids) ? rows[0].kpi_ids : []; }
  } catch {}

  const sections = {};
  let currentTab = null;
  for (const id of existingIds) {
    if (id.startsWith("__tab:")) { currentTab = id.slice(6, -2); sections[currentTab] = []; }
    else if (currentTab) sections[currentTab].push(id);
  }
  sections[scope] = safeIds;

  const merged = [];
  for (const tab of allTabs) {
    merged.push(`__tab:${tab}__`);
    merged.push(...(sections[tab] ?? []));
  }

  const res = await fetch(`${SUPABASE_URL}/user_kpi_dashboard?on_conflict=user_id,company_id,scope`, {
    method: "POST",
    headers: authHeaders({ Prefer: "return=representation,resolution=merge-duplicates" }),
    body: JSON.stringify({ user_id: userId, company_id: companyId, kpi_ids: merged, scope: dbScope }),
  });
  if (!res.ok) { const err = await res.text(); console.error("[kpisApi] saveUserDashboard:", err); throw new Error(err); }
  return await res.json();
}

