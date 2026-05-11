// src/lib/mappingsApi.js
// All Supabase CRUD for the public.mappings table.
// Uses the publishable key + the user's session token for RLS.

const SUPABASE_URL = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

// Lazily get the current session token from localStorage so RLS works.
// (We're not importing supabase-js here to keep this lib dependency-free.)
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
// Resolve the active user's company_id from accounts.user_companies
// Returns the default company; falls back to the first active one.
// ════════════════════════════════════════════════════════════════
export async function getActiveCompanyId(userId) {
  if (!userId) return null;
  const res = await fetch(
    `${SUPABASE_URL}/user_companies?select=company_id,is_default,is_active&user_id=eq.${userId}&is_active=eq.true`,
    { headers: authHeaders({ "Accept-Profile": "accounts" }) }
  );
  if (!res.ok) {
    console.error("[mappingsApi] getActiveCompanyId failed:", await res.text());
    return null;
  }
  const links = await res.json();
  if (!Array.isArray(links) || links.length === 0) return null;
  const def = links.find(l => l.is_default) ?? links[0];
  return def.company_id;
}

// ════════════════════════════════════════════════════════════════
// LIST: all non-archived mappings for the user's company
// Optionally filter by standard
// ════════════════════════════════════════════════════════════════
export async function listMappings({ companyId, standard = null }) {
  if (!companyId) return [];
  let url = `${SUPABASE_URL}/mappings?select=*&company_id=eq.${companyId}&is_archived=eq.false&order=updated_at.desc`;
  if (standard) url += `&standard=eq.${standard}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[mappingsApi] listMappings failed:", await res.text());
    return [];
  }
  return await res.json();
}

// ════════════════════════════════════════════════════════════════
// GET: single mapping by id
// ════════════════════════════════════════════════════════════════
export async function getMapping(mappingId) {
  const res = await fetch(
    `${SUPABASE_URL}/mappings?select=*&mapping_id=eq.${mappingId}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    console.error("[mappingsApi] getMapping failed:", await res.text());
    return null;
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// ════════════════════════════════════════════════════════════════
// CREATE: new mapping. Returns the inserted row (with mapping_id).
// ════════════════════════════════════════════════════════════════
export async function createMapping({
  companyId, userId, name, description = null, standard,
  plTree = [], bsTree = [],
}) {
  const payload = {
    company_id: companyId,
    name,
    description,
    standard,
    pl_tree: plTree,
    bs_tree: bsTree,
    created_by: userId,
    updated_by: userId,
  };
  const res = await fetch(`${SUPABASE_URL}/mappings`, {
    method: "POST",
    headers: authHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[mappingsApi] createMapping failed:", err);
    throw new Error(err || "Create failed");
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ════════════════════════════════════════════════════════════════
// UPDATE: edit an existing mapping
// ════════════════════════════════════════════════════════════════
export async function updateMapping({
  mappingId, userId,
  name, description, plTree, bsTree,
}) {
  const payload = { updated_by: userId };
  if (name !== undefined) payload.name = name;
  if (description !== undefined) payload.description = description;
  if (plTree !== undefined) payload.pl_tree = plTree;
  if (bsTree !== undefined) payload.bs_tree = bsTree;

  const res = await fetch(
    `${SUPABASE_URL}/mappings?mapping_id=eq.${mappingId}`,
    {
      method: "PATCH",
      headers: authHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[mappingsApi] updateMapping failed:", err);
    throw new Error(err || "Update failed");
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ════════════════════════════════════════════════════════════════
// ARCHIVE: soft delete
// ════════════════════════════════════════════════════════════════
export async function archiveMapping({ mappingId, userId }) {
  const res = await fetch(
    `${SUPABASE_URL}/mappings?mapping_id=eq.${mappingId}`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_archived: true, updated_by: userId }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[mappingsApi] archiveMapping failed:", err);
    throw new Error(err || "Archive failed");
  }
  return true;
}