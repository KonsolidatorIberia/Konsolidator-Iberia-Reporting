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

export async function listResourceAccess({ companyId, resourceKind }) {
  const headers = await getAuthHeaders();
  let url = `${SUPABASE_URL}/role_resource_access?select=*&company_id=eq.${companyId}`;
  if (resourceKind) url += `&resource_kind=eq.${resourceKind}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`listResourceAccess ${res.status}`);
  return res.json();
}

export async function upsertResourceAccess({ companyId, role, resourceKind, resourceId, allowed, userId }) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/role_resource_access?on_conflict=company_id,role,resource_kind,resource_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify({
      company_id: companyId,
      role,
      resource_kind: resourceKind,
      resource_id: String(resourceId),
      allowed,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`upsertResourceAccess ${res.status}: ${txt}`);
  }
  return res.json();
}