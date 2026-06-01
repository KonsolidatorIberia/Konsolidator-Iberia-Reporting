const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

function getToken() {
  try {
    const raw = localStorage.getItem("sb-gmcawsapzkzmgrtiqebv-auth-token");
    return raw ? (JSON.parse(raw)?.access_token ?? null) : null;
  } catch { return null; }
}
function hdr(extra = {}) {
  const t = getToken();
  return { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${t ?? SUPABASE_APIKEY}`, "Content-Type": "application/json", ...extra };
}

export async function listBreakdownStructures({ companyId }) {
  if (!companyId) return [];
  const res = await fetch(
    `${SUPABASE_URL}/company_breakdown_structures?company_id=eq.${companyId}&is_archived=eq.false&order=created_at.asc`,
    { headers: hdr() }
  );
  if (!res.ok) { console.error("[breakdownApi] list:", await res.text()); return []; }
  return res.json();
}

export async function createBreakdownStructure({ companyId, userId, name, description, items }) {
  const res = await fetch(`${SUPABASE_URL}/company_breakdown_structures`, {
    method: "POST",
    headers: hdr({ Prefer: "return=representation" }),
    body: JSON.stringify({ company_id: companyId, name, description: description ?? null, items: items ?? [], created_by: userId, updated_by: userId }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e || "Create failed"); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function updateBreakdownStructure({ id, userId, name, description, items }) {
  const body = { updated_by: userId, updated_at: new Date().toISOString() };
  if (name        !== undefined) body.name        = name;
  if (description !== undefined) body.description = description;
  if (items       !== undefined) body.items       = items;
  const res = await fetch(`${SUPABASE_URL}/company_breakdown_structures?id=eq.${id}`, {
    method: "PATCH",
    headers: hdr({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e || "Update failed"); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function archiveBreakdownStructure({ id, userId }) {
  const res = await fetch(`${SUPABASE_URL}/company_breakdown_structures?id=eq.${id}`, {
    method: "PATCH", headers: hdr(),
    body: JSON.stringify({ is_archived: true, updated_by: userId }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e || "Archive failed"); }
  return true;
}

export async function getBreakdownPreference({ userId, companyId }) {
  if (!userId || !companyId) return null;
  const res = await fetch(
    `${SUPABASE_URL}/user_breakdown_preferences?user_id=eq.${userId}&company_id=eq.${companyId}`,
    { headers: hdr() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function saveBreakdownPreference({ userId, companyId, activeViewId }) {
  const res = await fetch(
    `${SUPABASE_URL}/user_breakdown_preferences?on_conflict=user_id,company_id`,
    {
      method: "POST",
      headers: hdr({ Prefer: "return=representation,resolution=merge-duplicates" }),
      body: JSON.stringify({ user_id: userId, company_id: companyId, active_view_id: activeViewId, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) console.error("[breakdownApi] savePreference:", await res.text());
  return res.ok;
}