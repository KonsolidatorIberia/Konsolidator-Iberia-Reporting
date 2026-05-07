import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_APIKEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  db: { schema: "public" },
});

export const sbAccounts = supabase.schema("accounts");

// ════════════════════════════════════════════════════════════════
// Reporting access status
//
// Después de un login Konsolidator B2C exitoso, esta función
// determina qué acceso tiene el usuario al reporting.
//
// Retorna uno de:
//   { status: "active",           user, company }      → acceso completo
//   { status: "needs_activation", email, password }    → panel de activación
//   { status: "inactive",         email }              → cuenta desactivada
//   { status: "trial_expired",    email, company }     → trial caducado
//   { status: "error",            message }            → error técnico
// ════════════════════════════════════════════════════════════════
export async function getReportingStatus(email, password) {
  console.log("[getReportingStatus] START email=", email);
  try {
    // 1. Intentar login en Supabase Auth
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log("[getReportingStatus] signIn result:", {
      hasUser: !!authData?.user,
      userId: authData?.user?.id,
      error: authErr?.message,
    });

    if (authErr || !authData?.user) {
      console.warn("[getReportingStatus] → needs_activation (Auth failed)", authErr);
      return { status: "needs_activation", email, password };
    }

    // 2. Comprobar accounts.users
    const { data: userRow, error: userErr } = await sbAccounts
      .from("users")
      .select("*")
      .eq("id", authData.user.id)
      .single();

    console.log("[getReportingStatus] accounts.users:", {
      found: !!userRow,
      is_active: userRow?.is_active,
      is_super_admin: userRow?.is_super_admin,
      error: userErr?.message,
    });

    if (userErr || !userRow) {
      console.warn("[getReportingStatus] → needs_activation (no row in accounts.users)");
      await supabase.auth.signOut();
      return { status: "needs_activation", email, password };
    }

    // 3. ¿Activo?
    if (!userRow.is_active) {
      console.warn("[getReportingStatus] → inactive");
      await supabase.auth.signOut();
      return { status: "inactive", email };
    }

    // 4. Empresas
    const { data: links, error: linksErr } = await sbAccounts
      .from("user_companies")
      .select("*, company:companies(*)")
      .eq("user_id", authData.user.id)
      .eq("is_active", true);

    console.log("[getReportingStatus] user_companies:", {
      count: links?.length ?? 0,
      links,
      error: linksErr?.message,
    });

    const defaultLink = links?.find(l => l.is_default) ?? links?.[0];
    if (!defaultLink?.company) {
      console.log("[getReportingStatus] → active (no company)");
      return { status: "active", user: userRow, company: null };
    }

    const company = defaultLink.company;
    console.log("[getReportingStatus] company:", {
      name: company.name,
      slug: company.slug,
      is_trial: company.is_trial,
      trial_ends_at: company.trial_ends_at,
    });

    // 5. Trial expirado?
    if (company.is_trial && company.trial_ends_at) {
      const endsAt = new Date(company.trial_ends_at);
      if (endsAt < new Date()) {
        console.warn("[getReportingStatus] → trial_expired");
        await supabase.auth.signOut();
        return { status: "trial_expired", email, company };
      }
    }

    console.log("[getReportingStatus] → active");
    return { status: "active", user: userRow, company };
  } catch (e) {
    console.error("[getReportingStatus] EXCEPTION:", e);
    return { status: "error", message: String(e?.message ?? e) };
  }
}

// ════════════════════════════════════════════════════════════════
// Provisioning: crear usuario + empresa (si no existe) + link
//
// Llamado desde ReportingActivationPanel cuando el cliente confirma
// la activación de la prueba de 5 días.
// ════════════════════════════════════════════════════════════════
export async function activateReporting(email, password) {
  // Slug = parte entre @ y .
  // ej: "indera@konsolidator.com" → "konsolidator"
  const domainPart = email.split("@")[1] ?? "";
  const slug = domainPart.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!slug) return { ok: false, error: "Email inválido para activación" };
  const companyName = slug.charAt(0).toUpperCase() + slug.slice(1);

  try {
    // 1. Crear Supabase Auth user
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: email.split("@")[0] } },
    });

    if (signUpErr || !signUpData?.user) {
      return { ok: false, error: signUpErr?.message ?? "No se pudo crear la cuenta" };
    }
    const userId = signUpData.user.id;

    // Esperar al trigger que crea accounts.users
    await new Promise(r => setTimeout(r, 700));

    // 2. Buscar o crear empresa
    let companyId;
    let isNewCompany = false;

    const { data: existingCompany } = await sbAccounts
      .from("companies")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (existingCompany) {
      // La empresa ya existe (otro usuario la activó antes).
      // OJO: el trial ya está corriendo, lo heredamos.
      companyId = existingCompany.id;
    } else {
      // Crear empresa nueva con trial 5 días
      const now = new Date();
      const ends = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      const { data: newCo, error: coErr } = await sbAccounts
        .from("companies")
        .insert({
          name: companyName,
          slug,
          tier: "base",
          is_trial: true,
          trial_started_at: now.toISOString(),
          trial_ends_at: ends.toISOString(),
        })
        .select()
        .single();
      if (coErr || !newCo) {
        return { ok: false, error: coErr?.message ?? "No se pudo crear la empresa" };
      }
      companyId = newCo.id;
      isNewCompany = true;
    }

    // 3. Crear link user_companies
    const { error: linkErr } = await sbAccounts
      .from("user_companies")
      .insert({
        user_id: userId,
        company_id: companyId,
        role: "base",
        is_default: true,
        is_active: true,
      });

    if (linkErr) {
      return { ok: false, error: linkErr.message };
    }

    return { ok: true, companyId, slug, companyName, isNewCompany };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}