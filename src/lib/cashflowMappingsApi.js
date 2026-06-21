// src/lib/cashflowMappingsApi.js
const SUPABASE_URL = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

function getAccessToken() {
  try {
    const raw = localStorage.getItem("sb-gmcawsapzkzmgrtiqebv-auth-token");
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch { return null; }
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

export async function getActiveCompanyId(userId) {
  if (!userId) return null;
  const res = await fetch(
    `${SUPABASE_URL}/user_companies?select=company_id,is_default,is_active&user_id=eq.${userId}&is_active=eq.true`,
    { headers: authHeaders({ "Accept-Profile": "accounts" }) }
  );
  if (!res.ok) return null;
  const links = await res.json();
  if (!Array.isArray(links) || links.length === 0) return null;
  return (links.find(l => l.is_default) ?? links[0]).company_id;
}

export async function listMappings({ companyId, standard = null }) {
  if (!companyId) return [];
  let url = `${SUPABASE_URL}/cashflow_mappings?select=*&company_id=eq.${companyId}&is_archived=eq.false&order=updated_at.desc`;
  if (standard) url += `&standard=eq.${standard}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) { console.error("[cashflowMappingsApi] list failed:", await res.text()); return []; }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const userIds = new Set();
  rows.forEach(r => { if (r.created_by) userIds.add(r.created_by); if (r.updated_by) userIds.add(r.updated_by); });
  if (userIds.size === 0) return rows;
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
  } catch (e) { console.error("[cashflowMappingsApi] user lookup failed:", e); }
  return rows;
}

export async function getMapping(mappingId) {
  const res = await fetch(
    `${SUPABASE_URL}/cashflow_mappings?select=*&mapping_id=eq.${mappingId}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function createMapping({
  companyId, userId, name, description = null, standard,
  cfTree = [], highlightedIds = [], cfViewMode = "consolidated",
}) {
  const payload = {
    company_id: companyId,
    name, description, standard,
    cf_tree: cfTree,
    highlighted_ids: highlightedIds,
    cf_view_mode: cfViewMode,
    created_by: userId, updated_by: userId,
  };
  const res = await fetch(`${SUPABASE_URL}/cashflow_mappings`, {
    method: "POST",
    headers: authHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err || "Create failed"); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function updateMapping({
  mappingId, userId, name, description, cfTree, highlightedIds, cfViewMode,
}) {
  const payload = { updated_by: userId };
  if (name !== undefined) payload.name = name;
  if (description !== undefined) payload.description = description;
  if (cfTree !== undefined) payload.cf_tree = cfTree;
  if (highlightedIds !== undefined) payload.highlighted_ids = highlightedIds;
  if (cfViewMode !== undefined) payload.cf_view_mode = cfViewMode;
  const res = await fetch(
    `${SUPABASE_URL}/cashflow_mappings?mapping_id=eq.${mappingId}`,
    { method: "PATCH", headers: authHeaders({ Prefer: "return=representation" }), body: JSON.stringify(payload) }
  );
  if (!res.ok) { const err = await res.text(); throw new Error(err || "Update failed"); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function archiveMapping({ mappingId, userId }) {
  const res = await fetch(
    `${SUPABASE_URL}/cashflow_mappings?mapping_id=eq.${mappingId}`,
    { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ is_archived: true, updated_by: userId }) }
  );
  if (!res.ok) { const err = await res.text(); throw new Error(err || "Archive failed"); }
  return true;
}