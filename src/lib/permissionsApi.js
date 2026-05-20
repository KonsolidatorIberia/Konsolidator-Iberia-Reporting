import { supabase } from "./supabaseClient";

const SUPABASE_URL = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_APIKEY;
  return {
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function listPermissions({ companyId }) {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/role_permissions?select=*&company_id=eq.${companyId}`,
    { headers }
  );
  if (!res.ok) throw new Error(`listPermissions ${res.status}`);
  return res.json();
}

export async function upsertPermission({ companyId, role, pageKey, allowed, userId }) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/role_permissions?on_conflict=company_id,role,page_key`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify({
      company_id: companyId,
      role,
      page_key: pageKey,
      allowed,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`upsertPermission ${res.status}: ${txt}`);
  }
  return res.json();
}