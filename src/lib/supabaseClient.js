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
  try {
    // 1. Intentar login en Supabase Auth
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

if (authErr || !authData?.user) {
      // Before offering trial activation, check if the company (derived
      // from the email domain) already exists. If it does, this is a
      // ghost user of a real customer — block with invalid credentials
      // instead of letting them spin up a trial.
const domainPart = email.split("@")[1] ?? "";
      const slug = domainPart.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (slug) {
        const { data: companyExists } = await supabase
          .rpc("company_exists_by_slug", { p_slug: slug });
        if (companyExists === true) {
          return { status: "company_exists_no_user", email };
        }
      }
      return { status: "needs_activation", email, password };
    }

// 2. Comprobar accounts.users
    const { data: userRow, error: userErr } = await sbAccounts
      .from("users")
      .select("*")
      .eq("id", authData.user.id)
      .single();
if (userErr || !userRow) {
      await supabase.auth.signOut();
      // Same guard: if the company already exists, don't offer activation.
const domainPart = email.split("@")[1] ?? "";
      const slug = domainPart.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (slug) {
        const { data: companyExists } = await supabase
          .rpc("company_exists_by_slug", { p_slug: slug });
        if (companyExists === true) {
          return { status: "company_exists_no_user", email };
        }
      }
      return { status: "needs_activation", email, password };
    }

    // 3. ¿Activo?
    if (!userRow.is_active) {
      await supabase.auth.signOut();
      return { status: "inactive", email };
    }

// 4. Empresas
    const { data: links } = await sbAccounts
      .from("user_companies")
      .select("*, company:companies(*)")
      .eq("user_id", authData.user.id)
      .eq("is_active", true);

    // If the user has no active company links, block login.
    if (!links || links.length === 0) {
      await supabase.auth.signOut();
      return { status: "inactive", email };
    }

    const defaultLink = links?.find(l => l.is_default) ?? links?.[0];
    if (!defaultLink?.company) {
      return { status: "active", user: userRow, company: null };
    }

    const company = defaultLink.company;

    // 5. Trial expirado?
    if (company.is_trial && company.trial_ends_at) {
      const endsAt = new Date(company.trial_ends_at);
      if (endsAt < new Date()) {
        await supabase.auth.signOut();
        return { status: "trial_expired", email, company };
      }
    }

    return { status: "active", user: userRow, company };
  } catch (e) {
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