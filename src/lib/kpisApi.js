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
}) {
  const payload = {
    company_id:         companyId,
    label,
    description,
    category,
    tag,
    format,
    formula,
    benchmark,
    context_mapping_id: contextMappingId,
    created_by:         userId,
    updated_by:         userId,
    scope,
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
}) {
  const payload = { updated_by: userId };
  if (label       !== undefined) payload.label       = label;
  if (description !== undefined) payload.description = description;
  if (category    !== undefined) payload.category    = category;
  if (tag         !== undefined) payload.tag         = tag;
  if (format      !== undefined) payload.format      = format;
  if (formula     !== undefined) payload.formula     = formula;
  if (benchmark   !== undefined) payload.benchmark   = benchmark;

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
export async function getUserDashboard({ userId, companyId, scope = "individual" }) {
  if (!userId || !companyId) return null;

  const url = `${SUPABASE_URL}/user_kpi_dashboard?select=*&user_id=eq.${userId}&company_id=eq.${companyId}&scope=eq.${scope}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[kpisApi] getUserDashboard:", await res.text());
    return null;
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function saveUserDashboard({ userId, companyId, kpiIds, scope = "individual" }) {
  if (!userId || !companyId) throw new Error("Missing userId/companyId");

  // Use merge-duplicates upsert — conflicts on (user_id, company_id, scope)
  const res = await fetch(`${SUPABASE_URL}/user_kpi_dashboard`, {
    method:  "POST",
    headers: authHeaders({
      Prefer: "return=representation,resolution=merge-duplicates",
    }),
    body: JSON.stringify({
      user_id:    userId,
      company_id: companyId,
      kpi_ids:    kpiIds,   // TEXT[] — plain JS array is fine
      scope,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[kpisApi] saveUserDashboard:", err);
    throw new Error(err);
  }
  return await res.json();
}