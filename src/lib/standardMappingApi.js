// src/lib/standardMappingApi.js
// CRUD for editing a company's CUSTOM standard directly on
// public.standard_statement_rows + public.standard_statement_sections.
//
// The AI-generated baseline lives in standard_statement_rows_baseline and
// is IMMUTABLE (protected by DB trigger). We use it to distinguish:
//   - ORIGINAL rows/sections: in baseline → readonly (rows) or partially editable (sections: label+color)
//   - CUSTOM rows/sections:   added by user → fully editable/deletable
//
// All writes emit a "custom-standard-updated" window event so downstream
// pages (Contributive, ConsolidationSheet, Dimensiones, KPI pages, Home)
// can re-fetch.

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

function getAccessToken() {
  try {
    const raw = localStorage.getItem("sb-gmcawsapzkzmgrtiqebv-auth-token");
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch { return null; }
}

function authHeaders(extra = {}) {
  const token = getAccessToken();
  return {
    apikey:        SUPABASE_APIKEY,
    Authorization: `Bearer ${token ?? SUPABASE_APIKEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function emitUpdated(standardKey) {
  try {
    console.log("[emit] custom-standard-updated for", standardKey);
    window.dispatchEvent(new CustomEvent("custom-standard-updated", { detail: { standardKey } }));
  } catch { /* window unavailable (SSR) — ignore */ }
}
// ════════════════════════════════════════════════════════════════
// LOAD current live rows + sections + immutable baseline
// ════════════════════════════════════════════════════════════════
export async function loadCustomStandard(standardKey) {
  if (!standardKey || !standardKey.startsWith("CUSTOM-")) {
    throw new Error("loadCustomStandard: only CUSTOM-* standards are supported");
  }

  const [rows, sections, baseArr] = await Promise.all([
    fetchAllRows(
      `${SUPABASE_URL}/standard_statement_rows?select=*` +
      `&standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=in.(PL,BS,CF)` +
      `&order=sort_order.asc`
    ),
    fetch(
      `${SUPABASE_URL}/standard_statement_sections?select=*` +
      `&standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=in.(PL,BS,CF)` +
      `&order=sort_order.asc`,
      { headers: authHeaders() }
    ).then(r => r.ok ? r.json() : []),
    fetch(
      `${SUPABASE_URL}/standard_statement_rows_baseline?select=*` +
      `&standard_key=eq.${encodeURIComponent(standardKey)}`,
      { headers: authHeaders() }
    ).then(r => r.ok ? r.json() : []),
  ]);

  const baseline = Array.isArray(baseArr) && baseArr.length > 0 ? baseArr[0] : null;
  const baseRows = baseline?.rows ?? [];
  const baseSecs = baseline?.sections ?? [];

  const baseRowKeys = new Set(baseRows.map(r => `${r.statement}::${r.account_code}`));
  const baseSectionKeys = new Set(baseSecs.map(s => `${s.statement}::${s.section_code}`));

  return {
    rows,
    sections,
    baseline: {
      rows: baseRowKeys,
      sections: baseSectionKeys,
      raw: { rows: baseRows, sections: baseSecs },
    },
  };
}

async function fetchAllRows(baseUrl) {
  const all = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const url = `${baseUrl}&limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) break;
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) break;
  }
  return all;
}

// Helpers
export function isOriginalRow(baseline, statement, accountCode) {
  return baseline.rows.has(`${statement}::${accountCode}`);
}
export function isOriginalSection(baseline, statement, sectionCode) {
  return baseline.sections.has(`${statement}::${sectionCode}`);
}

// ════════════════════════════════════════════════════════════════
// SAVE a diff
// changes = {
//   rowsAdded:      [row objects],
//   rowsUpdated:    [{ statement, account_code, patch }],
//   rowsDeleted:    [{ statement, account_code }],
//   sectionsAdded:  [section objects],
//   sectionsUpdated:[{ statement, section_code, patch }],
//   sectionsDeleted:[{ statement, section_code }],
// }
// ════════════════════════════════════════════════════════════════
export async function saveCustomStandard({ standardKey, changes, baseline, liveRows, liveSections }) {
  if (!standardKey || !standardKey.startsWith("CUSTOM-")) {
    throw new Error("saveCustomStandard: only CUSTOM-* standards are supported");
  }
  const errors = validateChanges({ standardKey, changes, baseline, liveRows, liveSections });
  if (errors.length > 0) {
    const err = new Error("Validation failed");
    err.details = errors;
    throw err;
  }

  const {
    rowsAdded       = [],
    rowsUpdated     = [],
    rowsDeleted     = [],
    sectionsAdded   = [],
    sectionsUpdated = [],
    sectionsDeleted = [],
  } = changes;

// 1. Sections: UPSERT new (in case a previous save partially applied)
  if (sectionsAdded.length > 0) {
    const payload = sectionsAdded.map(s => ({ ...s, standard_key: standardKey }));
    const res = await fetch(
      `${SUPABASE_URL}/standard_statement_sections?on_conflict=standard_key,statement,section_code`,
      {
        method: "POST",
        headers: authHeaders({ Prefer: "return=minimal,resolution=merge-duplicates" }),
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(`UPSERT sections failed: ${await res.text()}`);
  }

// 2. Rows: UPSERT new (in case a previous save partially applied and left rows)
  if (rowsAdded.length > 0) {
    const payload = rowsAdded.map(r => ({ ...r, standard_key: standardKey }));
    const res = await fetch(
      `${SUPABASE_URL}/standard_statement_rows?on_conflict=standard_key,statement,account_code`,
      {
        method: "POST",
        headers: authHeaders({ Prefer: "return=minimal,resolution=merge-duplicates" }),
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(`UPSERT rows failed: ${await res.text()}`);
  }

  // 3. Rows: PATCH updates
  for (const u of rowsUpdated) {
    const url = `${SUPABASE_URL}/standard_statement_rows` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(u.statement)}` +
      `&account_code=eq.${encodeURIComponent(u.account_code)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(u.patch),
    });
    if (!res.ok) throw new Error(`UPDATE row ${u.statement}/${u.account_code} failed: ${await res.text()}`);
  }

  // 4. Rows: DELETE (bottom-up: delete children before their parents)
  const orderedDeletes = orderDeletesLeafFirst(rowsDeleted, liveRows);
  for (const d of orderedDeletes) {
    const url = `${SUPABASE_URL}/standard_statement_rows` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(d.statement)}` +
      `&account_code=eq.${encodeURIComponent(d.account_code)}`;
    const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`DELETE row ${d.statement}/${d.account_code} failed: ${await res.text()}`);
  }

  // 5. Sections: PATCH updates
  for (const u of sectionsUpdated) {
    const url = `${SUPABASE_URL}/standard_statement_sections` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(u.statement)}` +
      `&section_code=eq.${encodeURIComponent(u.section_code)}`;
    const patch = {};
    if (u.patch.label !== undefined) patch.label = u.patch.label;
    if (u.patch.color !== undefined) patch.color = u.patch.color;
    if (u.patch.sort_order !== undefined) patch.sort_order = u.patch.sort_order;
    if (Object.keys(patch).length === 0) continue;
    const res = await fetch(url, {
      method: "PATCH",
      headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`UPDATE section ${u.statement}/${u.section_code} failed: ${await res.text()}`);
  }

  // 6. Sections: DELETE (only CUSTOM ones — validation guaranteed)
  for (const d of sectionsDeleted) {
    const url = `${SUPABASE_URL}/standard_statement_sections` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(d.statement)}` +
      `&section_code=eq.${encodeURIComponent(d.section_code)}`;
    const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`DELETE section ${d.statement}/${d.section_code} failed: ${await res.text()}`);
  }

  emitUpdated(standardKey);
  return true;
}

function orderDeletesLeafFirst(rowsDeleted, liveRows) {
  const delSet = new Set(rowsDeleted.map(d => `${d.statement}::${d.account_code}`));
  const parentOf = new Map();
  liveRows.forEach(r => parentOf.set(`${r.statement}::${r.account_code}`, r.parent_code));
  const scored = rowsDeleted.map(d => {
    let depth = 0;
    let key = `${d.statement}::${d.account_code}`;
    while (parentOf.get(key)) {
      const pKey = `${d.statement}::${parentOf.get(key)}`;
      if (!delSet.has(pKey)) break;
      depth++;
      key = pKey;
      if (depth > 100) break;
    }
    return { d, depth };
  });
  scored.sort((a, b) => b.depth - a.depth);
  return scored.map(s => s.d);
}

// ════════════════════════════════════════════════════════════════
// Validation
// ════════════════════════════════════════════════════════════════
function validateChanges({ standardKey, changes, baseline, liveRows, liveSections }) {
  const errors = [];
  const {
    rowsAdded       = [],
    rowsUpdated     = [],
    rowsDeleted     = [],
    sectionsAdded   = [],
    sectionsUpdated = [],
    sectionsDeleted = [],
  } = changes;

  const liveByKey = new Map();
  liveRows.forEach(r => liveByKey.set(`${r.statement}::${r.account_code}`, r));
  const liveSectionByKey = new Map();
  liveSections.forEach(s => liveSectionByKey.set(`${s.statement}::${s.section_code}`, s));

// Rows: ORIGINAL rows may only be moved (parent_code / section_code / sort_order),
  // not renamed or have their tag/isSum changed.
  const positionOnlyFields = new Set(["parent_code", "section_code", "sort_order"]);
  for (const u of rowsUpdated) {
    if (isOriginalRow(baseline, u.statement, u.account_code)) {
      const forbidden = Object.keys(u.patch ?? {}).filter(k => !positionOnlyFields.has(k));
      if (forbidden.length > 0) {
        errors.push(`Cannot edit fields [${forbidden.join(", ")}] on original row ${u.statement}/${u.account_code}. Only position (parent/section/sort_order) may change.`);
      }
    }
  }
  for (const d of rowsDeleted) {
    if (isOriginalRow(baseline, d.statement, d.account_code)) {
      errors.push(`Cannot delete original row ${d.statement}/${d.account_code}. Only user-added rows may be deleted.`);
    }
  }

  // Rows added: unique, valid parent/section, valid statement
  const addedRowKeys = new Set();
  const addedSectionKeys = new Set(sectionsAdded.map(s => `${s.statement}::${s.section_code}`));
  for (const r of rowsAdded) {
    if (!r.statement || !["PL", "BS", "CF"].includes(r.statement)) {
      errors.push(`Row missing valid statement: ${JSON.stringify(r)}`);
      continue;
    }
    if (!r.account_code || String(r.account_code).trim() === "") {
      errors.push(`Row missing account_code`);
      continue;
    }
    const key = `${r.statement}::${r.account_code}`;
    if (addedRowKeys.has(key)) errors.push(`Duplicate new row ${key}`);
    if (liveByKey.has(key))     errors.push(`account_code ${r.account_code} already exists in ${r.statement}`);
    if (baseline.rows.has(key)) errors.push(`account_code ${r.account_code} collides with an original row in ${r.statement}`);
    addedRowKeys.add(key);

    if (r.parent_code) {
      const pKey = `${r.statement}::${r.parent_code}`;
      if (!liveByKey.has(pKey) && !addedRowKeys.has(pKey)) {
        errors.push(`Row ${key}: parent_code ${r.parent_code} not found in ${r.statement}`);
      }
    }
    if (r.section_code) {
      const sKey = `${r.statement}::${r.section_code}`;
      if (!liveSectionByKey.has(sKey) && !addedSectionKeys.has(sKey)) {
        errors.push(`Row ${key}: section_code ${r.section_code} does not exist`);
      }
    }
  }

  // Rows deleted: not referenced as parent unless the child is also being deleted
  const deletedRowKeys = new Set(rowsDeleted.map(d => `${d.statement}::${d.account_code}`));
  for (const r of liveRows) {
    if (!r.parent_code) continue;
    const pKey = `${r.statement}::${r.parent_code}`;
    if (deletedRowKeys.has(pKey)) {
      const cKey = `${r.statement}::${r.account_code}`;
      if (!deletedRowKeys.has(cKey)) {
        errors.push(`Cannot delete ${pKey}: it is parent of ${cKey}`);
      }
    }
  }

  // Sections: cannot delete an ORIGINAL section
  for (const d of sectionsDeleted) {
    if (isOriginalSection(baseline, d.statement, d.section_code)) {
      errors.push(`Cannot delete original section ${d.statement}/${d.section_code}. Only user-added sections may be deleted.`);
    }
  }

  // Sections added: unique code
  for (const s of sectionsAdded) {
    if (!s.statement || !["PL", "BS", "CF"].includes(s.statement)) {
      errors.push(`Section missing valid statement`);
      continue;
    }
    if (!s.section_code) { errors.push("Section missing section_code"); continue; }
    const key = `${s.statement}::${s.section_code}`;
    if (liveSectionByKey.has(key)) errors.push(`Section ${key} already exists`);
    if (baseline.sections.has(key)) errors.push(`Section ${key} collides with an original section`);
  }

  // Sections deleted: cannot have rows still in them (unless those rows are also being deleted)
  const survivingRows = liveRows.filter(r => !deletedRowKeys.has(`${r.statement}::${r.account_code}`));
  const deletedSectionKeys = new Set(sectionsDeleted.map(d => `${d.statement}::${d.section_code}`));
  for (const key of deletedSectionKeys) {
    const [statement, code] = key.split("::");
    const stillUsed = survivingRows.some(r => r.statement === statement && r.section_code === code);
    if (stillUsed) errors.push(`Cannot delete section ${key}: it still contains rows`);
  }

  // Sections updated: only editable fields
  const allowedSectionKeys = new Set(["label", "color", "sort_order"]);
  for (const u of sectionsUpdated) {
    const key = `${u.statement}::${u.section_code}`;
    if (!liveSectionByKey.has(key)) errors.push(`Section ${key} does not exist`);
    for (const k of Object.keys(u.patch ?? {})) {
      if (!allowedSectionKeys.has(k)) {
        errors.push(`Section ${key}: field "${k}" is not editable`);
      }
    }
  }

  return errors;
}

// ════════════════════════════════════════════════════════════════
// RESTORE baseline
// ════════════════════════════════════════════════════════════════
export async function restoreBaseline({ standardKey, baseline, liveRows, liveSections }) {
  if (!standardKey || !standardKey.startsWith("CUSTOM-")) {
    throw new Error("restoreBaseline: only CUSTOM-* standards are supported");
  }
  if (!baseline?.raw?.rows) throw new Error("No baseline available");

  // 1. Delete CUSTOM rows (leaf-first for parent_code safety)
  const customRows = liveRows.filter(r => !isOriginalRow(baseline, r.statement, r.account_code));
  const orderedDeletes = orderDeletesLeafFirst(
    customRows.map(r => ({ statement: r.statement, account_code: r.account_code })),
    liveRows
  );
  for (const r of orderedDeletes) {
    const url = `${SUPABASE_URL}/standard_statement_rows` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(r.statement)}` +
      `&account_code=eq.${encodeURIComponent(r.account_code)}`;
    const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`Restore: DELETE row ${r.statement}/${r.account_code} failed: ${await res.text()}`);
  }

// 2b. Bulk UPSERT all baseline rows back to their original values.
  if (baseline.raw.rows?.length) {
    const payload = baseline.raw.rows.map(r => ({ ...r, standard_key: standardKey }));
    console.log("[restore-api] bulk upsert:", payload.length, "rows, first:", payload[0]);
    const res = await fetch(
      `${SUPABASE_URL}/standard_statement_rows?on_conflict=standard_key,statement,account_code`,
      {
        method: "POST",
        headers: authHeaders({ Prefer: "return=minimal,resolution=merge-duplicates" }),
        body: JSON.stringify(payload),
      }
    );
    const bodyText = await res.text();
    console.log("[restore-api] bulk upsert response:", res.status, bodyText.slice(0, 500));
    if (!res.ok) throw new Error(`Restore: bulk UPSERT rows failed: ${bodyText}`);
  }

  // 2. Delete CUSTOM sections
  const customSections = liveSections.filter(s => !isOriginalSection(baseline, s.statement, s.section_code));
  for (const s of customSections) {
    const url = `${SUPABASE_URL}/standard_statement_sections` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(s.statement)}` +
      `&section_code=eq.${encodeURIComponent(s.section_code)}`;
    const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`Restore: DELETE section ${s.statement}/${s.section_code} failed: ${await res.text()}`);
  }

  // 3. Reset ORIGINAL sections label + color + sort_order to baseline
  for (const s of baseline.raw.sections) {
    const url = `${SUPABASE_URL}/standard_statement_sections` +
      `?standard_key=eq.${encodeURIComponent(standardKey)}` +
      `&statement=eq.${encodeURIComponent(s.statement)}` +
      `&section_code=eq.${encodeURIComponent(s.section_code)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: authHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ label: s.label, color: s.color, sort_order: s.sort_order }),
    });
    if (!res.ok) throw new Error(`Restore: PATCH section ${s.statement}/${s.section_code} failed: ${await res.text()}`);
  }

  emitUpdated(standardKey);
  return true;
}

// ════════════════════════════════════════════════════════════════
// KPI usage check (for delete 2-step confirm)
// ════════════════════════════════════════════════════════════════
export async function findKpisUsingCode({ companyId, accountCode }) {
  if (!companyId || !accountCode) return [];
  const url = `${SUPABASE_URL}/company_kpis?select=kpi_id,label,scope,formula,variations,is_archived` +
    `&company_id=eq.${companyId}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return [];
  const all = await res.json();
  const hits = [];
  const needle = String(accountCode);
  for (const k of all) {
    const asText = JSON.stringify(k.formula ?? {}) + "|" + JSON.stringify(k.variations ?? {});
    if (asText.includes(`"${needle}"`) || asText.includes(`"${needle}:::`)) {
      hits.push({ kpi_id: k.kpi_id, label: k.label, scope: k.scope, is_archived: k.is_archived });
    }
  }
  return hits;
}