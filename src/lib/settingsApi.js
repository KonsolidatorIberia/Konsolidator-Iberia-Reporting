const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const AUTH_STORAGE_KEY = "sb-gmcawsapzkzmgrtiqebv-auth-token";

function getAccessToken() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token ?? null;
  } catch { return null; }
}

function authHeaders() {
  const token = getAccessToken();
  return {
    apikey: SUPABASE_APIKEY,
    Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_APIKEY}`,
    "Content-Type": "application/json",
  };
}

export async function getUserSettings(userId) {
  if (!userId) return null;
  const url = `${SUPABASE_URL}/user_settings?user_id=eq.${encodeURIComponent(userId)}&select=*`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 406) return null;
    throw new Error(`getUserSettings failed: ${res.status}`);
  }
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

export async function saveUserSettings({ userId, typography, colors, locale }) {
  if (!userId) throw new Error("userId is required to save settings");
  const url = `${SUPABASE_URL}/user_settings?on_conflict=user_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ user_id: userId, typography, colors, locale: locale ?? "auto" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`saveUserSettings failed: ${res.status} ${text}`);
  }
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}