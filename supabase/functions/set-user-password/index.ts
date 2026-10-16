// supabase/functions/set-user-password/index.ts
//
// Pone en Supabase la misma contraseña que el usuario tiene en Konsolidator
// (primer acceso de un usuario creado por un admin, o resincronizar si la
// cambió en Konsolidator). Lo llama el Login.
//
// ANTES: no comprobaba nada (verify_jwt = false y sin validación), así que
// cualquiera con un user_id podía cambiar la contraseña de esa persona.
// AHORA: solo se cambia si esa contraseña es de verdad la de Konsolidator
// para el email de ese usuario: se comprueba contra Azure AD B2C (el mismo
// inicio de sesión que usa el Login). B2C ya bloquea los intentos repetidos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Inicio de sesión de Konsolidator (Azure AD B2C, flujo ROPC; mismos datos que Login.jsx)
const B2C_TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const B2C_CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const B2C_SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function konsolidatorAccepts(email: string, password: string): Promise<boolean> {
  const params = new URLSearchParams();
  params.append("grant_type", "password");
  params.append("client_id", B2C_CLIENT_ID);
  params.append("scope", B2C_SCOPE);
  params.append("username", email);
  params.append("password", password);
  const res = await fetch(B2C_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return typeof data?.access_token === "string" && data.access_token.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { user_id, password } = await req.json().catch(() => ({}));
    if (!user_id || !password || typeof password !== "string") {
      return json({ error: "Missing user_id or password" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Email del usuario (de Supabase, nunca del que llama)
    const { data: found, error: findErr } = await admin.auth.admin.getUserById(user_id);
    const email = found?.user?.email?.trim().toLowerCase();
    if (findErr || !email) return json({ error: "Unknown user" }, 404);

    // La contraseña tiene que ser la de Konsolidator para ese email
    if (!(await konsolidatorAccepts(email, password))) {
      return json({ error: "Invalid credentials" }, 401);
    }

    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
