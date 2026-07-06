# Client Onboarding Playbook

The end-to-end process for onboarding a new client with a custom accounting standard.

## Prerequisites

- Admin access (`role='admin'` on any `accounts.user_companies` row)
- The three docs in this folder: this file, `onboarding-prompt.md`, `VALIDATE-STANDARD.md`
- The client already exists in Supabase (`accounts.companies`) with data flowing from the Konsolidator API

## The flow

```
EXPORT → GENERATE → VALIDATE → IMPORT → VERIFY
  30s      5-10min     1min      30s      1min
```

---

## Step 1 — Export the client snapshot

1. Log in as admin
2. Sidebar → **Client onboarding**
3. Find the client in the list
4. Click **Export**
5. Watch progress: "Fetching entities…" → "Sampling entities…" → "Downloaded ✓"
6. Save the downloaded file (e.g. `konsolidator-<slug>-export.json`)

What's inside: full chart of accounts (`group_accounts`), all operating entities, sample uploaded rows per entity, sources and structures. Everything Claude needs to understand the client's data.

## Step 2 — Generate the standard

1. Open a **fresh Claude chat** (claude.ai, desktop app, or in-app — any of them)
2. Attach the export JSON from Step 1
3. Copy-paste the ENTIRE contents of `docs/onboarding-prompt.md` into the message
4. Send
5. Claude returns raw JSON — no preamble, no markdown fences
6. Copy the JSON, save as `konsolidator-<slug>-standard.json`

**If the response includes preamble or code fences**, ask Claude to "Return only the JSON, no other text." Save the corrected response.

## Step 3 — Validate the standard

1. Open **another fresh Claude chat**
2. Attach BOTH files: the export JSON AND the standard JSON
3. Copy-paste the ENTIRE contents of `docs/VALIDATE-STANDARD.md` into the message
4. Send
5. Read the structured report

### Reading the verdict

- **READY TO IMPORT** → proceed to Step 4
- **WARNINGS ONLY, IMPORT OK** → review warnings. If `meta.notes` in the standard explains them (e.g. granular fixed-asset register), proceed. Otherwise consider iterating.
- **HARD ERRORS, DO NOT IMPORT** → go back to Step 2. In the same chat that generated the standard, paste the specific hard errors and ask "Fix these hard errors. Return corrected JSON only."

## Step 4 — Import

1. Back in **Client onboarding**, click **Import** on the same client
2. Drop the standard JSON
3. Preview panel shows:
   - Standard key
   - Based-on reference
   - Row counts by statement (PL / BS / CF)
   - Section counts
   - KPI override counts
4. Green "Ready to apply" chip = go. Yellow warnings = go with awareness.
5. Click **Apply**
6. Wait for "Standard applied" confirmation

Import is atomic: if any step fails, nothing is written.

## Step 5 — Verify

1. Log out or open incognito
2. Log in as a user of that client
3. On HomePage, check:
   - Header pill shows `CUSTOM-<slug>` (not the auto-detected standard)
   - Hero KPI cards show real values (Revenue, EBITDA, EBIT, Net Result)
   - Cost structure card (right side) shows meaningful buckets with amounts
4. Go to Mappings → Structure → Create new mapping. You should see the client's custom standard as the recommended first card (in your brand color).
5. Same in Cash Flow mappings.

## Troubleshooting

### Values are all zero after import

The resolver isn't picking up the new standard on first load. Try:
- Hard reload (`Cmd+Shift+R`)
- Clear session cache: browser console → `Object.keys(sessionStorage).filter(k => k.startsWith('resolver_')).forEach(k => sessionStorage.removeItem(k));`
- Log out and back in

If still broken, check network tab for a request to `standard_statement_rows?standard_key=eq.CUSTOM-<slug>` — should return rows, not `[]`.

### Header still shows old standard

EpicLoader isn't fetching the binding. Check browser console for errors. If none, run the diagnostic query from the previous debugging session to confirm `company_active_standard` has the row.

### Validation flags an equity account as misplaced in NCA

Two possibilities:
- **Claude got it wrong**: ask Claude to move those accounts from NCA to EQ and return corrected JSON.
- **Claude was right and `meta.notes` explains it**: some clients legitimately have FX retranslation lines nested inside fixed-asset roll-forwards. If `meta.notes` argues this, warnings can be ignored.

### Import validator flags something the Claude validator missed

Update BOTH validators (the one in `AdminOnboardingPage.jsx` and the one in `docs/VALIDATE-STANDARD.md`) so future clients catch it.

### Client wants to change the mapping later

They don't touch the imported standard. They use the MappingsPage to build their own custom mapping views on top of it — those are stored in the `mappings` table with `pl_tree` / `bs_tree` JSON. The `standard_statement_rows` binding remains as their baseline.

## What's NOT in this playbook

- Adding a NEW required section (e.g. splitting OPEX into two): requires updating the prompt, the validator, and the app-side validator. Not routine.
- Adding a NEW cc_tag: same as above — three files to update, then regenerate any standards affected.
- Removing a client's custom standard: `DELETE FROM company_active_standard WHERE company_id = '<uuid>'` — reverts them to code-pattern sniff (PGC/DanishIFRS/SpanishIFRS-ES auto-detected).