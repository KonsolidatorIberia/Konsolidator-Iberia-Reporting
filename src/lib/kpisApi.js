// src/lib/kpisApi.js
// All Supabase CRUD for public.company_kpis.
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
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${token ?? SUPABASE_APIKEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// ════════════════════════════════════════════════════════════════
// LIST: all non-archived company KPIs (optionally filtered by context)
// Pass contextMappingId = null  → only standard KPIs
// Pass contextMappingId = "uuid"→ only KPIs created under that mapping
// Pass contextMappingId = "*"   → everything (default)
// ════════════════════════════════════════════════════════════════
export async function listCompanyKpis({ companyId, contextMappingId = "*" }) {
  if (!companyId) return [];
  let url = `${SUPABASE_URL}/company_kpis?select=*&company_id=eq.${companyId}&is_archived=eq.false&order=created_at.asc`;
  if (contextMappingId === null) {
    url += `&context_mapping_id=is.null`;
  } else if (contextMappingId !== "*") {
    url += `&context_mapping_id=eq.${contextMappingId}`;
  }
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[kpisApi] listCompanyKpis failed:", await res.text());
    return [];
  }
  return await res.json();
}

// ════════════════════════════════════════════════════════════════
// CREATE: new custom KPI
// ════════════════════════════════════════════════════════════════
export async function createCompanyKpi({
  companyId, userId,
  label, description = null, category = null, tag = null,
  format = "currency", formula, benchmark = null,
  contextMappingId = null,
}) {
  const payload = {
    company_id: companyId,
    label,
    description,
    category,
    tag,
    format,
    formula,
    benchmark,
    context_mapping_id: contextMappingId,
    created_by: userId,
    updated_by: userId,
  };
  const res = await fetch(`${SUPABASE_URL}/company_kpis`, {
    method: "POST",
    headers: authHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
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
// UPDATE: edit an existing KPI
// ════════════════════════════════════════════════════════════════
export async function updateCompanyKpi({
  kpiId, userId,
  label, description, category, tag, format, formula, benchmark,
}) {
  const payload = { updated_by: userId };
  if (label !== undefined)       payload.label = label;
  if (description !== undefined) payload.description = description;
  if (category !== undefined)    payload.category = category;
  if (tag !== undefined)         payload.tag = tag;
  if (format !== undefined)      payload.format = format;
  if (formula !== undefined)     payload.formula = formula;
  if (benchmark !== undefined)   payload.benchmark = benchmark;

  const res = await fetch(
    `${SUPABASE_URL}/company_kpis?kpi_id=eq.${kpiId}`,
    {
      method: "PATCH",
      headers: authHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
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
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_archived: true, updated_by: userId }),
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
// USER DASHBOARD — per-user selection of which KPIs to display
// ════════════════════════════════════════════════════════════════
export async function getUserDashboard({ userId, companyId }) {
  if (!userId || !companyId) return null;
  const url = `${SUPABASE_URL}/user_kpi_dashboards?select=*&user_id=eq.${userId}&company_id=eq.${companyId}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[kpisApi] getUserDashboard:", await res.text());
    return null;
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function saveUserDashboard({ userId, companyId, kpiIds }) {
  if (!userId || !companyId) throw new Error("Missing userId/companyId");
  const res = await fetch(`${SUPABASE_URL}/user_kpi_dashboards`, {
    method: "POST",
    headers: authHeaders({ Prefer: "return=representation,resolution=merge-duplicates" }),
    body: JSON.stringify({
      user_id:    userId,
      company_id: companyId,
      kpi_ids:    kpiIds,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[kpisApi] saveUserDashboard:", err);
    throw new Error(err);
  }
  return await res.json();
}