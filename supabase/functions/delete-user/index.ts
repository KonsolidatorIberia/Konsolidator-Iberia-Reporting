// supabase/functions/delete-user/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const supabaseAuth = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ─── 1. JWT ───────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing auth" }, 401);

    const userJwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser(userJwt);

    console.log("[delete-user] auth user:", user?.id, user?.email, "err:", userErr);

    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    // ─── 2. Direct REST call to accounts.users ────────────────
    const callerUrl =
      `${SB_URL}/rest/v1/users?select=is_super_admin,is_active,email&id=eq.${user.id}`;

    const callerRes = await fetch(callerUrl, {
      headers: {
        apikey:           SB_KEY,
        Authorization:    `Bearer ${SB_KEY}`,
        "Accept-Profile": "accounts",
      },
    });
    const callerRows = await callerRes.json();

    console.log("[delete-user] caller fetch status:", callerRes.status, "rows:", JSON.stringify(callerRows));

    if (!callerRes.ok) {
      return json({ error: `Failed to read caller: ${callerRes.status}`, detail: callerRows }, 500);
    }
    if (!Array.isArray(callerRows) || callerRows.length === 0) {
      return json({ error: "Caller not found", user_id: user.id }, 403);
    }

    const callerRow = callerRows[0];
    if (!callerRow.is_super_admin || !callerRow.is_active) {
      return json({ error: "Insufficient permissions" }, 403);
    }

    // ─── 3. Body ──────────────────────────────────────────────
    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id required" }, 400);
    if (user_id === user.id) return json({ error: "Cannot delete yourself" }, 400);

    // ─── 4. Delete from auth.users ────────────────────────────
    const { error: deleteErr } = await supabaseAuth.auth.admin.deleteUser(user_id);

    if (deleteErr) {
      console.error("[delete-user] delete failed:", deleteErr);
      return json({ error: deleteErr.message }, 500);
    }

    console.log("[delete-user] deleted user:", user_id);
    return json({ ok: true, deleted_user_id: user_id });

  } catch (e) {
    console.error("[delete-user] caught:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}