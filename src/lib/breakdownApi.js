const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

async function getToken() {
  try {
    // Try localStorage first (fast path)
    const keys = Object.keys(localStorage);
    const authKey = keys.find(k => k.includes("supabase") && k.includes("auth-token"));
    if (authKey) {
      const parsed = JSON.parse(localStorage.getItem(authKey));
      const token = parsed?.access_token ?? parsed?.data?.session?.access_token ?? null;
      if (token) return token;
    }
  } catch { /* fall through */ }
  try {
    // Slow path — ask Supabase client directly
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      "https://gmcawsapzkzmgrtiqebv.supabase.co",
      SUPABASE_APIKEY
    );
    const { data: { session } } = await client.auth.getSession();
    return session?.access_token ?? null;
  } catch { return null; }
}

async function hdr(extra = {}) {
  const t = await getToken();
  return { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${t ?? SUPABASE_APIKEY}`, "Content-Type": "application/json", ...extra };
}

export async function listBreakdownStructures({ companyId }) {
  if (!companyId) return [];
const res = await fetch(
    `${SUPABASE_URL}/company_breakdown_structures?company_id=eq.${companyId}&is_archived=eq.false&order=created_at.asc`,
    { headers: await hdr() }
  );
  if (!res.ok) { console.error("[breakdownApi] list:", await res.text()); return []; }
  return res.json();
}

export async function createBreakdownStructure({ companyId, userId, name, description, items }) {
const res = await fetch(`${SUPABASE_URL}/company_breakdown_structures`, {
    method: "POST",
    headers: await hdr({ Prefer: "return=representation" }),
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
    headers: await hdr({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e || "Update failed"); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function archiveBreakdownStructure({ id }) {
  const res = await fetch(`${SUPABASE_URL}/company_breakdown_structures?id=eq.${id}`, {
    method: "DELETE", headers: await hdr(),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e || "Delete failed"); }
  return true;
}

export async function getBreakdownPreference({ userId, companyId }) {
  if (!userId || !companyId) return null;
const res = await fetch(
    `${SUPABASE_URL}/user_breakdown_preferences?user_id=eq.${userId}&company_id=eq.${companyId}`,
    { headers: await hdr() }
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
      headers: await hdr({ Prefer: "return=representation,resolution=merge-duplicates" }),
      body: JSON.stringify({ user_id: userId, company_id: companyId, active_view_id: activeViewId, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) console.error("[breakdownApi] savePreference:", await res.text());
  return res.ok;
}