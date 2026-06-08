import { useState, useEffect } from "react";
import { getActiveCompanyId } from "./mappingsApi";

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

export async function listUserPermissions({ companyId }) {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/user_permissions?select=*&company_id=eq.${companyId}`,
    { headers }
  );
  if (!res.ok) throw new Error(`listUserPermissions ${res.status}`);
  return res.json();
}

export async function upsertUserPermissions(rows) {
  // rows: [{ company_id, user_id, page_key, allowed, updated_by, updated_at }]
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/user_permissions?on_conflict=company_id,user_id,page_key`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) { const t = await res.text(); throw new Error(`upsertUserPermissions ${res.status}: ${t}`); }
  return res.json();
}

export async function listUserResourceAccess({ companyId }) {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/user_resource_access?select=*&company_id=eq.${companyId}`,
    { headers }
  );
  if (!res.ok) throw new Error(`listUserResourceAccess ${res.status}`);
  return res.json();
}

export async function upsertUserResourceAccess(rows) {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/user_resource_access?on_conflict=company_id,user_id,resource_kind,resource_id`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) { const t = await res.text(); throw new Error(`upsertUserResourceAccess ${res.status}: ${t}`); }
  return res.json();
}

// ─── Current user page permissions hook ─────────────────────────────

export function useCurrentUserPermissions() {
  const [pagePerms, setPagePerms] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) { if (!cancelled) { setPagePerms({}); setLoaded(true); } return; }
        const cid = await getActiveCompanyId(uid);
        if (!cid) { if (!cancelled) { setPagePerms({}); setLoaded(true); } return; }
        const rows = await listUserPermissions({ companyId: cid }).catch(() => []);
        if (cancelled) return;
        const myRows = (rows ?? []).filter(r => r.user_id === uid);
        const m = {};
        myRows.forEach(r => { m[r.page_key] = r.allowed; });
        setPagePerms(m);
      } catch (e) {
        console.warn("[useCurrentUserPermissions] failed:", e?.message);
        setPagePerms({});
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

const can = (pageKey) => {
    if (pagePerms === null) return true;
    if (pageKey in pagePerms) return pagePerms[pageKey];
    return true;
  };

  return { can, loaded };
}

// ─── Current user resource access hook ──────────────────────────────
// Returns { loaded, access } where access is { company?: Set, structure?: Set,
// source?: Set, dimension?: Set, mapping?: Set }. A missing key for a kind
// means "no restriction" — the user can access all resources of that kind.

export function useCurrentUserResourceAccess() {
  const [access, setAccess] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) { if (!cancelled) setAccess({}); return; }
        const cid = await getActiveCompanyId(uid);
        if (!cid) { if (!cancelled) setAccess({}); return; }

        const rows = await listUserResourceAccess({ companyId: cid }).catch(() => []);
        if (cancelled) return;
        const myRows = (rows ?? []).filter(r => r.user_id === uid);

        const result = {};
        ["company", "structure", "source", "dimension", "mapping"].forEach(kind => {
          const kindRows = myRows.filter(r => r.resource_kind === kind);
          if (kindRows.length > 0) {
            result[kind] = new Set(
              kindRows.filter(r => r.allowed).map(r => String(r.resource_id))
            );
          }
          // no rows for this kind → no restriction → all allowed
        });
        if (!cancelled) setAccess(result);
      } catch (e) {
        console.warn("[useCurrentUserResourceAccess] failed:", e?.message);
        if (!cancelled) setAccess({});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { loaded: access !== null, access: access ?? {} };
}