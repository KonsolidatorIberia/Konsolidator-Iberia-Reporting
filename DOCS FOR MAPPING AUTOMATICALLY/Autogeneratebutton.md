DOCUMENTO 1 — Context para auto-generate button (Opción A)Estado actual
Prompt en docs/onboarding-prompt.md (v3): reglas semánticas, hierarchy, sort order narrativo, multilingual, phantom accounts, placeholders
Validator en docs/validate-standard.md: 13 hard checks + soft checks + distribuciones + verdict
Export handler en AdminOnboardingPage.jsx: función buildClientSnapshot({ client, token, onProgress }) que devuelve { meta, sources, structures, entities, group_structure, group_accounts, entity_samples }
Import handler en AdminOnboardingPage.jsx: función applyImport({ json, userId, onProgress }) con DELETE verification
Arquitectura del "Auto-generate" cuando lo montesFrontend (Admin Onboarding page):

Añadir tercer botón "🪄 Auto-generate" al lado de Export/Import
Estado: { generating, progress, generatedJson, validationReport }
Click → llama backend → renderiza preview con Apply
Backend (endpoint nuevo, probablemente Supabase Edge Function o Vercel serverless):

Route: POST /api/generate-standard { clientId }
Auth: verifica que el user es admin sobre ese client
Steps:

Fetch client desde accounts.companies para tener slug + id
Fetch Konsolidator API para entities, group_accounts, samples (reusa buildClientSnapshot lógica en el backend)
Read docs/onboarding-prompt.md (guárdalo en el bundle del backend)
Call Anthropic API con: system: prompt, user: JSON.stringify(export). Modelo recomendado: claude-opus-4-5 o el más reciente
Parse response, extraer solo el JSON (por si Claude añadió preamble)
Ejecutar validator server-side (traduce validate-standard.md a JS/Python)
Return { generatedJson, validationReport, verdict }


Anthropic API call básica:
javascriptimport Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const prompt = await readFile("docs/onboarding-prompt.md", "utf-8");
const exportJson = await buildClientSnapshot({ client, token });

const response = await anthropic.messages.create({
  model: "claude-opus-4-5",
  max_tokens: 16000,
  system: prompt,
  messages: [{
    role: "user",
    content: `Attached export JSON:\n\n${JSON.stringify(exportJson, null, 2)}`
  }]
});

const rawText = response.content[0].text;
// Strip preamble/fences defensively
const jsonMatch = rawText.match(/\{[\s\S]*\}$/);
const generatedJson = JSON.parse(jsonMatch[0]);Costo estimado por generación: $0.50 – $2.50 dependiendo del tamaño del export (input ~50-200k tokens) y del output (~30-80k tokens). Konsolidator (1190 group_accounts + 6 entity samples) ≈ $1.50.Validator server-side traducido a JS:

Copia mental los 13 hard checks + 5 soft checks + distribuciones del validate-standard.md
Ya tienes el esqueleto en AdminOnboardingPage.jsx → validateImport() — expándelo con: verificación cc_tag catalog, sort_order narrative check, name-based BS check, sum-account section_code check
Estructura de retorno: { hardErrors: [...], warnings: [...], distributions: {...}, verdict: "READY" | "WARNINGS_ONLY" | "HARD_ERRORS" }
UI flow:
Click 🪄 Auto-generate
  → spinner "Fetching client data..."
  → spinner "Generating standard (this may take 30-60s)..."
  → spinner "Validating..."
  → modal shows: preview table + validation report + [Apply] [Discard] buttons
Click Apply
  → same import flow as manual Import button
  → success messageCosas a NO olvidar
Rate limiting: Anthropic tiene límites. Añade retry con exponential backoff
Timeout: la generación puede tardar 60-90s. Frontend spinner debe estar preparado
Error UI: si el validador devuelve hard errors, mostrar el reporte y NO permitir Apply. Ofrecer botón "Regenerate" que llama otra vez a Anthropic pero pasando el hardError report como parte del user message
Guardar el generatedJson aunque no se apply. Usuario puede querer descargarlo, editarlo manualmente, y re-importar