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
export async function listMappings({ companyId, standard = null, includeHidden = false }) {
  if (!companyId) return [];
 let url = `${SUPABASE_URL}/mappings?select=*&company_id=eq.${companyId}&order=updated_at.desc`;
  if (!includeHidden) url += `&is_hidden=eq.false`;
  if (standard) url += `&standard=eq.${standard}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    console.error("[mappingsApi] listMappings failed:", await res.text());
    return [];
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  // Collect unique user UUIDs from created_by + updated_by
  const userIds = new Set();
  rows.forEach(r => {
    if (r.created_by) userIds.add(r.created_by);
    if (r.updated_by) userIds.add(r.updated_by);
  });
  if (userIds.size === 0) return rows;
  // Fetch user names from accounts.users via PostgREST schema header
  try {
    const idList = [...userIds].map(id => `"${id}"`).join(",");
    const usersRes = await fetch(
      `${SUPABASE_URL}/users?select=id,username,email&id=in.(${idList})`,
      { headers: { ...authHeaders(), "Accept-Profile": "accounts" } }
    );
    if (usersRes.ok) {
      const users = await usersRes.json();
      const byId = new Map();
      (Array.isArray(users) ? users : []).forEach(u => byId.set(u.id, u));
      rows.forEach(r => {
        const c = r.created_by ? byId.get(r.created_by) : null;
        const u = r.updated_by ? byId.get(r.updated_by) : null;
        r.created_by_name = c ? (c.username ?? c.email ?? null) : null;
        r.updated_by_name = u ? (u.username ?? u.email ?? null) : null;
      });
    }
  } catch (e) {
    console.error("[mappingsApi] user lookup failed:", e);
  }
  return rows;
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
  plTree = [], bsTree = [], highlightedIds = [],
}) {
  const payload = {
    company_id: companyId,
    name,
    description,
    standard,
    pl_tree: plTree,
    bs_tree: bsTree,
    highlighted_ids: highlightedIds,
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
  name, description, plTree, bsTree, highlightedIds,
}) {
  const payload = { updated_by: userId };
  if (name !== undefined) payload.name = name;
  if (description !== undefined) payload.description = description;
  if (plTree !== undefined) payload.pl_tree = plTree;
  if (bsTree !== undefined) payload.bs_tree = bsTree;
  if (highlightedIds !== undefined) payload.highlighted_ids = highlightedIds;

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
// DELETE: hard delete
// ════════════════════════════════════════════════════════════════
export async function archiveMapping({ mappingId }) {
  const res = await fetch(
    `${SUPABASE_URL}/mappings?mapping_id=eq.${mappingId}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[mappingsApi] deleteMapping failed:", err);
    throw new Error(err || "Delete failed");
  }
  return true;
}
// ════════════════════════════════════════════════════════════════
// HIDDEN OVERRIDE mapping — one per company. Never appears in the
// user-facing list. Backs the CUSTOM-editor flow: the account tree
// with client nodes lives here, the standard structure edits live
// in standard_statement_rows. Both together = a single logical
// "custom mapping" that is transparently active.
// ════════════════════════════════════════════════════════════════
export async function getHiddenOverrideMapping({ companyId, standard }) {
  if (!companyId || !standard) return null;
  const url = `${SUPABASE_URL}/mappings?select=*&company_id=eq.${companyId}` +
    `&standard=eq.${encodeURIComponent(standard)}&is_hidden=eq.true&limit=1`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function deleteHiddenOverrideMapping({ companyId, standard }) {
  if (!companyId || !standard) return false;
  const existing = await getHiddenOverrideMapping({ companyId, standard });
  if (!existing) return true;
  const res = await fetch(
    `${SUPABASE_URL}/mappings?mapping_id=eq.${existing.mapping_id}`,
    { method: "DELETE", headers: authHeaders() }
  );
  return res.ok;
}

export async function upsertHiddenOverrideMapping({
  companyId, userId, standard,
  plTree, bsTree, cfTree, highlightedIds = [],
}) {
  const existing = await getHiddenOverrideMapping({ companyId, standard });
  const payload = {
    highlighted_ids: highlightedIds,
    updated_by: userId,
  };
  if (plTree !== undefined) payload.pl_tree = plTree;
  if (bsTree !== undefined) payload.bs_tree = bsTree;
  if (cfTree !== undefined) payload.cf_tree = cfTree;
  if (existing) {
    const res = await fetch(
      `${SUPABASE_URL}/mappings?mapping_id=eq.${existing.mapping_id}`,
      {
        method: "PATCH",
        headers: authHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }
const insertPayload = {
    pl_tree: plTree ?? [],
    bs_tree: bsTree ?? [],
    cf_tree: cfTree ?? [],
    ...payload,
    company_id: companyId,
    created_by: userId,
    name: "__custom_override__",
    description: "Auto-generated override for the company's CUSTOM standard. Not listed in the UI.",
    standard,
    is_hidden: true,
  };
  const res = await fetch(`${SUPABASE_URL}/mappings`, {
    method: "POST",
    headers: authHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(insertPayload),
  });
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// Set a mapping as the active one for the current user
// (writes to user_settings.preferences.standard_mapping_id)
export async function setActiveMappingSilently({ userId, mappingId }) {
  if (!userId || !mappingId) return false;
  // Read current preferences
  const readRes = await fetch(
    `${SUPABASE_URL}/user_settings?select=preferences&user_id=eq.${userId}`,
    { headers: authHeaders() }
  );
  const rows = readRes.ok ? await readRes.json() : [];
  const currentPref = (Array.isArray(rows) && rows.length > 0) ? (rows[0].preferences ?? {}) : {};
  const nextPref = { ...currentPref, standard_mapping_id: mappingId };
  // Upsert user_settings
  const upsertRes = await fetch(
    `${SUPABASE_URL}/user_settings?on_conflict=user_id`,
    {
      method: "POST",
      headers: authHeaders({ Prefer: "return=minimal,resolution=merge-duplicates" }),
      body: JSON.stringify({ user_id: userId, preferences: nextPref }),
    }
  );
  return upsertRes.ok;
}