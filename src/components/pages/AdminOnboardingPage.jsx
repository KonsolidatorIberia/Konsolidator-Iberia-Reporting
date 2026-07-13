// src/components/pages/AdminOnboardingPage.jsx
//
// Admin-only client onboarding console.
// - Lists every SaaS client (accounts.companies) with their currently
//   bound accounting standard from public.company_active_standard.
// - Two per-row actions:
//     Export → downloads a JSON snapshot of the client's chart of
//     accounts + entity list + last-month sample so it can be sent to
//     Claude for custom standard generation.
//     Import → opens a drop zone that ingests Claude's generated
//     standard JSON, validates it, previews the write, and applies
//     atomically (rows + sections + KPI overrides + binding).
//
// Access: any user with role='admin' on at least one user_companies row.

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  Building2, Download, Upload, Loader2, Search, AlertTriangle,
  CheckCircle2, X, FileJson, ShieldCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useSettings, useT } from "../layout/SettingsContext.jsx";

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
const KONSOLIDATOR_API_BASE = "";

async function sbHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    apikey: SUPABASE_APIKEY,
    Authorization: `Bearer ${session?.access_token ?? SUPABASE_APIKEY}`,
    "Content-Type": "application/json",
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT — build the client snapshot JSON
// ═══════════════════════════════════════════════════════════════════

async function buildClientSnapshot({ client, token, onProgress }) {
  const meta = {
    kind: "konsolidator_client_export",
    version: 1,
    client_id: client.id,
    client_name: client.name,
    client_slug: client.slug,
    client_tier: client.tier,
    generated_at: new Date().toISOString(),
  };

  const fetchJson = async (path) => {
    const res = await fetch(`${KONSOLIDATOR_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.value ?? (Array.isArray(json) ? json : []);
  };

  onProgress?.("Fetching entities…");
  const entities = (await fetchJson("/v2/companies")) ?? [];
  if (!entities.length) throw new Error("Entities fetch returned empty");

  onProgress?.("Fetching group accounts…");
  const groupAccounts = (await fetchJson("/v2/group-accounts")) ?? [];

  onProgress?.("Fetching group structure…");
  const groupStructure = (await fetchJson("/v2/group-structure")) ?? [];

  onProgress?.("Fetching sources…");
  const sourcesRaw = (await fetchJson("/v2/sources")) ?? [];
  const sources = sourcesRaw
    .map(s => (typeof s === "object" ? (s.source ?? s.Source ?? "") : String(s)))
    .filter(Boolean);

  // Structures list comes from group_structure — pull distinct values
  const structures = [...new Set(
    (groupStructure ?? [])
      .map(g => g.groupStructure ?? g.GroupStructure)
      .filter(Boolean)
  )];

  onProgress?.(`Sampling ${entities.length} entities across ${sources.length} sources × ${structures.length} structures…`);

  // For each entity, try every (source × structure) combination and probe
  // 24 months back to find the latest period with data.
  const now = new Date();
  const latestSample = [];
  let done = 0;

  for (let i = 0; i < entities.length; i += 3) {
    const batch = entities.slice(i, i + 3);
    const batchResults = await Promise.all(batch.map(async (entity) => {
      const shortName = entity.companyShortName ?? entity.CompanyShortName;
      if (!shortName) return null;

      // Try every (source, structure) combo and grab the newest hit
      for (const source of sources) {
        for (const structure of structures) {
          let y = now.getFullYear(), m = now.getMonth() + 1;
          for (let k = 0; k < 24; k++) {
            const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}' and CompanyShortName eq '${shortName}'`;
            const res = await fetch(
              `${KONSOLIDATOR_API_BASE}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}&$top=200`,
              { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
            );
            if (res.ok) {
              const json = await res.json();
              const rows = json.value ?? (Array.isArray(json) ? json : []);
              if (rows.length > 0) {
                return { entity: shortName, year: y, month: m, source, structure, sample_rows: rows };
              }
            }
            m -= 1; if (m < 1) { m = 12; y -= 1; }
          }
        }
      }
      return { entity: shortName, sample_rows: [], note: "no period with data found in last 24 months across any source/structure" };
    }));

    latestSample.push(...batchResults.filter(Boolean));
    done += batch.length;
    onProgress?.(`Sampled ${done}/${entities.length} entities…`);
  }

  return {
    meta,
    sources,
    structures,
    entities,
    group_structure: groupStructure,
    group_accounts: groupAccounts,
    entity_samples: latestSample,
  };
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════
// IMPORT — validate + write atomically
// ═══════════════════════════════════════════════════════════════════

// Canonical cc_tag catalog — must match the framework prompt
const VALID_CC_TAGS = new Set([
  "CC_01-Revenue",
  "CC_02-Cost Of Sales",
  "CC_03-Other Operating Income",
  "CC_05-Lease Expense",
  "CC_06-General and administrative",
  "CC_07-Employee Expense",
  "CC_08-R&D",
  "CC_09-Impairment Gain (Loss) on Fixed Assets",
  "CC_10-Depreciation and Amotization",
  "CC_11-Other Operating Expenses",
  "CC_13-Interest Income",
  "CC_14-Other financial income",
  "CC_15-Interest expense",
  "CC_16-Other financial expense",
  "CC_17-Foreign Exchange",
  "CC_18-Income Tax",
]);

// Required section codes per statement — enforces the standard structure
const REQUIRED_SECTIONS = {
  PL: ["REV", "COGS", "OPEX", "OTHER_OP", "FIN", "TAX", "RESULT"],
  BS: ["NCA", "CA", "EQ", "NCL", "CL"],
  CF: ["CF_OP", "CF_INV", "CF_FIN"],
};

function validateImport(json) {
  const errors = [];

  // ── 1. Basic shape ──
  if (!json || typeof json !== "object") { errors.push("File is not valid JSON"); return errors; }
  if (json.meta?.kind !== "konsolidator_client_standard")
    errors.push(`meta.kind must be "konsolidator_client_standard" (got "${json.meta?.kind}")`);
  if (!json.meta?.client_id)    errors.push("meta.client_id is required");
  if (!json.meta?.standard_key) errors.push("meta.standard_key is required");
  if (json.meta?.standard_key && !json.meta.standard_key.startsWith("CUSTOM-"))
    errors.push(`meta.standard_key must start with "CUSTOM-" (got "${json.meta.standard_key}")`);
  if (!Array.isArray(json.rows) || !json.rows.length) errors.push("rows[] is required and must be non-empty");
  if (!Array.isArray(json.sections)) errors.push("sections[] is required");

  if (errors.length) return errors; // bail early — nothing else will make sense

  // ── 2. Row-level validation ──
  const validStatements = new Set(["PL", "BS", "CF"]);
  const codesByStmt = { PL: new Set(), BS: new Set(), CF: new Set() };
  const dupeGuard = new Set();

  json.rows.forEach((r, i) => {
    if (!r.statement || !validStatements.has(r.statement))
      errors.push(`rows[${i}].statement must be PL/BS/CF`);
    if (!r.account_code)
      errors.push(`rows[${i}].account_code required`);

    const dupeKey = `${r.statement}::${r.account_code}`;
    if (dupeGuard.has(dupeKey))
      errors.push(`rows[${i}] duplicate (${r.statement}, ${r.account_code})`);
    dupeGuard.add(dupeKey);

    if (r.statement && r.account_code) codesByStmt[r.statement].add(r.account_code);

    if (r.cc_tag && !VALID_CC_TAGS.has(r.cc_tag))
      errors.push(`rows[${i}].cc_tag "${r.cc_tag}" not in catalog`);

    if (typeof r.is_sum !== "boolean" && r.is_sum != null)
      errors.push(`rows[${i}].is_sum must be boolean`);
  });

  // ── 3. Parent integrity — every parent must exist as an account in same statement ──
  json.rows.forEach((r, i) => {
    if (r.parent_code && !codesByStmt[r.statement]?.has(r.parent_code))
      errors.push(`rows[${i}] parent_code "${r.parent_code}" not found in ${r.statement}`);
  });

  // ── 4. Section integrity ──
  const sectionKeysByStmt = { PL: new Set(), BS: new Set(), CF: new Set() };
  json.sections.forEach((s, i) => {
    if (!validStatements.has(s.statement))
      errors.push(`sections[${i}].statement must be PL/BS/CF`);
    if (!s.section_code) errors.push(`sections[${i}].section_code required`);
    if (!s.label)        errors.push(`sections[${i}].label required`);
    if (s.statement && s.section_code) sectionKeysByStmt[s.statement].add(s.section_code);
  });

  // Every row.section_code must exist in sections for the same statement
  json.rows.forEach((r, i) => {
    if (r.section_code && !sectionKeysByStmt[r.statement]?.has(r.section_code))
      errors.push(`rows[${i}] references section ${r.section_code} not defined for ${r.statement}`);
  });

  // Required sections must all be present
  Object.entries(REQUIRED_SECTIONS).forEach(([stmt, required]) => {
    const present = sectionKeysByStmt[stmt];
    required.forEach(code => {
      if (!present.has(code))
        errors.push(`Required section missing: ${stmt}::${code}`);
    });
  });

// ── 5. WARNINGS (non-blocking) — surfaced separately so import can proceed ──
  const warnings = [];
  const untaggedLeaves = json.rows.filter(r =>
    r.statement === "PL" && r.is_sum === false && !r.cc_tag
  );
  if (untaggedLeaves.length > 0) {
    warnings.push(
      `${untaggedLeaves.length} P/L leaf accounts have no cc_tag ` +
      `(first: ${untaggedLeaves[0].account_code}). KPIs may under-report.`
    );
  }

  return { errors, warnings };
}

async function applyImport({ json, userId, onProgress }) {
  const H = await sbHeaders();
  const key    = json.meta.standard_key;
  const client = json.meta.client_id;

onProgress?.("Clearing previous version of this standard…");
  // Nuke prior version of this standard_key (idempotent re-import).
  // Verify DELETE succeeded — silent failures here cause orphan rows
  // that break resolver lookups downstream.
  const delRowsRes = await fetch(
    `${SUPABASE_URL}/standard_statement_rows?standard_key=eq.${encodeURIComponent(key)}`,
    { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } }
  );
  if (!delRowsRes.ok) throw new Error(`Delete prior rows failed: ${await delRowsRes.text()}`);

  const delSecsRes = await fetch(
    `${SUPABASE_URL}/standard_statement_sections?standard_key=eq.${encodeURIComponent(key)}`,
    { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } }
  );
  if (!delSecsRes.ok) throw new Error(`Delete prior sections failed: ${await delSecsRes.text()}`);

  // Verify the wipe actually happened
  const checkRes = await fetch(
    `${SUPABASE_URL}/standard_statement_rows?standard_key=eq.${encodeURIComponent(key)}&select=account_code&limit=1`,
    { headers: H }
  );
  const remaining = await checkRes.json();
  if (Array.isArray(remaining) && remaining.length > 0) {
    throw new Error(`Delete verification failed — ${remaining.length}+ rows still present`);
  }

  onProgress?.(`Inserting ${json.sections.length} sections…`);
  if (json.sections.length) {
    const secPayload = json.sections.map(s => ({
      standard_key: key,
      statement:    s.statement,
      section_code: s.section_code,
      label:        s.label,
      label_en:     s.label_en ?? null,
      label_da:     s.label_da ?? null,
      label_es:     s.label_es ?? null,
      color:        s.color ?? null,
      sort_order:   s.sort_order ?? null,
    }));
    const r = await fetch(`${SUPABASE_URL}/standard_statement_sections`, {
      method: "POST", headers: H, body: JSON.stringify(secPayload),
    });
    if (!r.ok) throw new Error(`Section insert failed: ${await r.text()}`);
  }

  onProgress?.(`Inserting ${json.rows.length} rows…`);
  const rowPayload = json.rows.map(r => ({
    standard_key:    key,
    statement:       r.statement,
    account_code:    r.account_code,
    account_name:    r.account_name    ?? null,
    account_name_en: r.account_name_en ?? null,
    account_name_da: r.account_name_da ?? null,
    account_name_es: r.account_name_es ?? null,
    parent_code:     r.parent_code     ?? null,
    section_code:    r.section_code    ?? null,
    cc_tag:          r.cc_tag          ?? null,
    is_sum:          r.is_sum          ?? false,
    sort_order:      r.sort_order      ?? null,
    level:           r.level           ?? null,
    show_in_summary: r.show_in_summary ?? true,
  }));
  // Chunk to avoid payload size limits
  for (let i = 0; i < rowPayload.length; i += 500) {
    const chunk = rowPayload.slice(i, i + 500);
    const r = await fetch(`${SUPABASE_URL}/standard_statement_rows`, {
      method: "POST", headers: H, body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`Row insert failed at chunk ${i}: ${await r.text()}`);
    onProgress?.(`Inserted rows ${Math.min(i+500, rowPayload.length)}/${rowPayload.length}…`);
  }

  if (Array.isArray(json.kpi_overrides) && json.kpi_overrides.length) {
    onProgress?.(`Applying ${json.kpi_overrides.length} KPI overrides…`);
    // Delete existing per-company overrides for this client, then insert
    await fetch(`${SUPABASE_URL}/kpi_definitions_override?company_id=eq.${client}`, {
      method: "DELETE", headers: H,
    });
    const ovPayload = json.kpi_overrides.map(o => ({
      kpi_id:     o.kpi_id,
      standard:   key,
      company_id: client,
      formula:    o.formula,
    }));
    const r = await fetch(`${SUPABASE_URL}/kpi_definitions_override`, {
      method: "POST", headers: H, body: JSON.stringify(ovPayload),
    });
    if (!r.ok) throw new Error(`KPI overrides insert failed: ${await r.text()}`);
  }

  onProgress?.("Binding client to standard…");
  // Upsert the binding
  const bindRes = await fetch(
    `${SUPABASE_URL}/company_active_standard?on_conflict=company_id`,
    {
      method: "POST",
      headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        company_id:   client,
        standard_key: key,
        is_custom:    true,
        onboarded_by: userId,
        onboarded_at: new Date().toISOString(),
        notes:        json.meta.notes ?? null,
      }),
    }
  );
  if (!bindRes.ok) throw new Error(`Binding upsert failed: ${await bindRes.text()}`);

  // Clear session cache so HomePage picks up the new standard immediately
  try {
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith("resolver_mapping_") || k.startsWith("resolver_library_")) sessionStorage.removeItem(k);
    });
  } catch { /* ignore */ }

  onProgress?.("Done.");
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AdminOnboardingPage({ token, onNavigate }) {
  const { colors } = useSettings();
  const t = useT();

  const [isAdmin, setIsAdmin]     = useState(null);
  const [userId,  setUserId]      = useState(null);
  const [clients, setClients]     = useState([]);
  const [bindings, setBindings]   = useState(new Map());
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");

  const [exportingId, setExportingId] = useState(null);
  const [exportProgress, setExportProgress] = useState("");

  const [importOpen, setImportOpen]         = useState(null); // client object
  const [importJson, setImportJson]         = useState(null);
const [importErrors, setImportErrors]     = useState([]);
  const [importWarnings, setImportWarnings] = useState([]);
  const [importProgress, setImportProgress] = useState("");
  const [importDone, setImportDone]         = useState(false);
  const dropRef = useRef(null);

  // ── Auth + admin check ──
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      setUserId(uid);
      if (!uid) { setIsAdmin(false); setLoading(false); return; }
      const { data } = await supabase.schema("accounts").from("user_companies")
        .select("role").eq("user_id", uid).eq("is_active", true);
      const admin = (data ?? []).some(r => r.role === "admin");
      setIsAdmin(admin);
      if (!admin) setLoading(false);
    })();
  }, []);

  // ── Load clients + bindings ──
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const [{ data: cos }, { data: binds }] = await Promise.all([
        supabase.schema("accounts").from("companies")
          .select("id, name, slug, tier, is_trial, created_at")
          .order("name"),
        supabase.from("company_active_standard").select("*"),
      ]);
      setClients(cos ?? []);
      const m = new Map();
      (binds ?? []).forEach(b => m.set(b.company_id, b));
      setBindings(m);
      setLoading(false);
    })();
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q
      ? clients
      : clients.filter(c => c.name?.toLowerCase().includes(q) || c.slug?.toLowerCase().includes(q));
  }, [clients, search]);

  const summary = useMemo(() => {
    const buckets = { PGC: 0, DanishIFRS: 0, "SpanishIFRS-ES": 0, Custom: 0, "Auto-detected": 0 };
    clients.forEach(c => {
      const b = bindings.get(c.id);
      if (!b) buckets["Auto-detected"]++;
      else if (b.is_custom) buckets.Custom++;
      else if (buckets[b.standard_key] !== undefined) buckets[b.standard_key]++;
      else buckets.Custom++;
    });
    return buckets;
  }, [clients, bindings]);

  // ── Export handler ──
  const handleExport = useCallback(async (client) => {
    if (!token) { alert("No API token available."); return; }
    setExportingId(client.id);
    setExportProgress("Starting…");
    try {
      const snapshot = await buildClientSnapshot({ client, token, onProgress: setExportProgress });
      downloadJson(`konsolidator-${client.slug}-export.json`, snapshot);
      setExportProgress("Downloaded ✓");
      setTimeout(() => { setExportingId(null); setExportProgress(""); }, 1200);
    } catch (e) {
      alert(`Export failed:\n\n${e.message}`);
      setExportingId(null); setExportProgress("");
    }
  }, [token]);

  // ── Import handlers ──
const openImport = useCallback((client) => {
    setImportOpen(client);
    setImportJson(null);
    setImportErrors([]);
    setImportWarnings([]);
    setImportProgress("");
    setImportDone(false);
  }, []);

const handleFile = useCallback(async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const { errors: errs, warnings: warns } = validateImport(parsed);
      // Also check the file matches the client we're importing FOR
      if (importOpen && parsed?.meta?.client_id !== importOpen.id) {
        errs.push(`This file targets client_id ${parsed?.meta?.client_id}, but you opened import for ${importOpen.id} (${importOpen.name}).`);
      }
      setImportJson(parsed);
      setImportErrors(errs);
      setImportWarnings(warns);
    } catch (e) {
      setImportErrors([`Failed to parse JSON: ${e.message}`]);
      setImportWarnings([]);
      setImportJson(null);
    }
  }, [importOpen]);

  const applyImportNow = useCallback(async () => {
    if (!importJson || importErrors.length) return;
    try {
      await applyImport({ json: importJson, userId, onProgress: setImportProgress });
      setImportDone(true);
      // Refresh bindings
      const { data: binds } = await supabase.from("company_active_standard").select("*");
      const m = new Map();
      (binds ?? []).forEach(b => m.set(b.company_id, b));
      setBindings(m);
    } catch (e) {
      alert(`Import failed:\n\n${e.message}`);
      setImportProgress("");
    }
  }, [importJson, importErrors, userId]);

  // ── Render ──
  if (isAdmin === null || loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
        <ShieldCheck size={32} className="text-gray-300" />
        <p className="text-sm font-black text-gray-600">Admin access required</p>
        <p className="text-xs text-gray-400 max-w-sm">
          You need role=admin on at least one company to access the onboarding console.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-5 py-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Konsolidator staff</p>
          <p className="text-lg font-black text-gray-800">Client onboarding</p>
        </div>
        <div className="flex items-center gap-2">
          {Object.entries(summary).map(([k, v]) => v > 0 && (
            <div key={k} className="px-3 py-1.5 rounded-xl bg-white border border-gray-100 flex items-center gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">{k}</span>
              <span className="text-[11px] font-black tabular-nums" style={{ color: colors.primary }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-100">
        <Search size={12} className="text-gray-400 flex-shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or slug…"
          className="flex-1 text-xs outline-none bg-transparent text-gray-700 placeholder:text-gray-300"
        />
      </div>

      {/* Client list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
        {filtered.map(client => {
          const b = bindings.get(client.id);
          const isExporting = exportingId === client.id;
          const stdLabel = !b
            ? "— auto-detected —"
            : b.is_custom
              ? `Custom (${b.standard_key})`
              : b.standard_key;
          const stdColor = !b ? "#9ca3af" : b.is_custom ? "#7c3aed" : colors.primary;

          return (
            <div key={client.id}
              className="rounded-2xl bg-white border border-gray-100 px-4 py-3 flex items-center gap-4"
              style={{ boxShadow: "0 2px 8px -2px rgba(26,47,138,0.05)" }}>

              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${colors.primary}15`, color: colors.primary }}>
                <Building2 size={15} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-black text-sm text-gray-800 truncate">{client.name}</p>
                  {client.is_trial && (
                    <span className="px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider bg-amber-50 text-amber-600">Trial</span>
                  )}
                </div>
                <p className="text-[10px] font-mono text-gray-400 mt-0.5">{client.slug} · {client.tier}</p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Standard</span>
                <span className="px-2 py-1 rounded-lg text-[10px] font-black"
                  style={{ background: `${stdColor}12`, color: stdColor }}>
                  {stdLabel}
                </span>
              </div>
<div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleExport(client)}
                  disabled={isExporting || !token}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all disabled:opacity-40"
                  style={{ background: `${colors.primary}12`, color: colors.primary }}>
                  {isExporting
                    ? <><Loader2 size={11} className="animate-spin" /><span>{exportProgress || "Exporting…"}</span></>
                    : <><Download size={11} /><span>Export</span></>}
                </button>
                <button
                  onClick={() => openImport(client)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all text-white"
                  style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)` }}>
                  <Upload size={11} /><span>Import</span>
                </button>
<button
                  onClick={() => {
                    try {
                      sessionStorage.setItem("mappings:openForEdit", JSON.stringify({
                        openCustom: true,
                        standard: `CUSTOM-${client.slug}`,
                      }));
                    } catch { /* ignore */ }
                    onNavigate?.("mappings");
                  }}
                  title="Edit PL/BS custom standard"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all"
                  style={{ background: "#57aa7815", color: "#3d8c5c" }}>
                  <span>PL/BS</span>
                </button>
                <button
                  onClick={() => {
                    try {
                      sessionStorage.setItem("cashflow-mappings:openForEdit", JSON.stringify({
                        openCustom: true,
                        standard: `CUSTOM-${client.slug}`,
                      }));
                    } catch { /* ignore */ }
                    onNavigate?.("cashflow-mappings");
                  }}
                  title="Edit Cash Flow custom standard"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all"
                  style={{ background: "#0891b215", color: "#0891b2" }}>
                  <span>CF</span>
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="text-xs text-gray-300 text-center py-8">No clients found</p>
        )}
      </div>

      {/* Import modal */}
      {importOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-6"
          style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(8px)" }}>
          <div className="bg-white rounded-3xl flex flex-col"
            style={{ width: 540, maxHeight: "88vh", boxShadow: "0 32px 80px -12px rgba(26,47,138,0.28)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400 mb-0.5">Import standard for</p>
                <p className="text-base font-black text-gray-800">{importOpen.name}</p>
              </div>
              <button onClick={() => setImportOpen(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100">
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {importDone ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <CheckCircle2 size={40} className="text-emerald-500" />
                  <p className="text-sm font-black text-gray-800">Standard applied</p>
                  <p className="text-xs text-gray-400 text-center max-w-xs">
                    {importOpen.name} is now bound to <span className="font-mono">{importJson?.meta?.standard_key}</span>. Users will see the new structure on next page load.
                  </p>
                </div>
              ) : !importJson ? (
                <label ref={dropRef}
                  onDragOver={e => { e.preventDefault(); dropRef.current?.classList.add("ring-2"); }}
                  onDragLeave={() => dropRef.current?.classList.remove("ring-2")}
                  onDrop={e => {
                    e.preventDefault();
                    dropRef.current?.classList.remove("ring-2");
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFile(f);
                  }}
                  className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:border-gray-300 transition-colors">
                  <FileJson size={32} className="text-gray-300 mb-3" />
                  <p className="text-sm font-black text-gray-500">Drop Claude's JSON here</p>
                  <p className="text-[11px] text-gray-400 mt-1">or click to browse</p>
                  <input type="file" accept="application/json,.json" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </label>
              ) : (
                <div className="space-y-4">
                  {/* Preview */}
                  <div className="rounded-2xl border border-gray-100 p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2">Preview</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="font-bold text-gray-400">Standard key:</span> <span className="font-mono font-black text-gray-800">{importJson.meta?.standard_key}</span></div>
                      <div><span className="font-bold text-gray-400">Based on:</span> <span className="font-black text-gray-800">{importJson.meta?.based_on_standard ?? "—"}</span></div>
                      <div><span className="font-bold text-gray-400">Rows:</span> <span className="font-black text-gray-800">{importJson.rows?.length ?? 0}</span></div>
                      <div><span className="font-bold text-gray-400">Sections:</span> <span className="font-black text-gray-800">{importJson.sections?.length ?? 0}</span></div>
                      <div><span className="font-bold text-gray-400">KPI overrides:</span> <span className="font-black text-gray-800">{importJson.kpi_overrides?.length ?? 0}</span></div>
                      <div><span className="font-bold text-gray-400">PL / BS / CF:</span> <span className="font-black text-gray-800">
                        {["PL","BS","CF"].map(s => (importJson.rows ?? []).filter(r => r.statement === s).length).join(" · ")}
                      </span></div>
                    </div>
                  </div>

{/* Hard errors — blocking */}
                  {importErrors.length > 0 && (
                    <div className="rounded-2xl border border-red-100 bg-red-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={14} className="text-red-500" />
                        <p className="text-[10px] font-black uppercase tracking-wider text-red-600">
                          {importErrors.length} validation error{importErrors.length > 1 ? "s" : ""}
                        </p>
                      </div>
                      <ul className="text-[11px] text-red-700 space-y-1 max-h-32 overflow-y-auto">
                        {importErrors.map((e, i) => <li key={i}>· {e}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Warnings — informational, non-blocking */}
                  {importWarnings.length > 0 && (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={14} className="text-amber-500" />
                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">
                          {importWarnings.length} warning{importWarnings.length > 1 ? "s" : ""} (non-blocking)
                        </p>
                      </div>
                      <ul className="text-[11px] text-amber-700 space-y-1 max-h-32 overflow-y-auto">
                        {importWarnings.map((w, i) => <li key={i}>· {w}</li>)}
                      </ul>
                    </div>
                  )}

                  {importErrors.length === 0 && !importProgress && (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 px-4 py-3 flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500" />
                      <p className="text-[11px] font-black text-emerald-700">
                        {importWarnings.length > 0
                          ? "Ready to apply (review warnings above)"
                          : "Ready to apply"}
                      </p>
                    </div>
                  )}

                  {importProgress && (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/50 px-4 py-3 flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin text-blue-500" />
                      <p className="text-[11px] font-black text-blue-700">{importProgress}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {!importDone && (
              <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex items-center gap-2">
                <button onClick={() => setImportOpen(null)}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-600">Cancel</button>
                <div className="flex-1" />
                {importJson && importErrors.length === 0 && !importProgress && (
                  <button onClick={applyImportNow}
                    className="px-5 py-2 rounded-xl text-xs font-black text-white"
                    style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, #3b54b8 100%)` }}>
                    Apply to {importOpen.name}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}