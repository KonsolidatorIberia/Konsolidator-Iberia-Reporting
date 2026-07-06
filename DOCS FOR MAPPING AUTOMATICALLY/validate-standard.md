# Client Standard Validator

Use this to verify any JSON standard Claude generates before importing it.

## When to use

- After running the onboarding prompt and getting a standard JSON back
- After making manual edits to a standard file
- Before clicking Import in the Admin Onboarding page

## How to use

1. Open a fresh Claude chat (any: claude.ai, desktop, in-app)
2. Attach BOTH files:
   - The original client export JSON (e.g. `konsolidator-export.json`)
   - The generated standard JSON to validate (e.g. `konsolidator-standard.json`)
3. Paste the ENTIRE prompt below
4. Send

Claude runs the validator and returns a structured report telling you exactly what passes, what warns, and what would block the import.

---

## THE VALIDATOR PROMPT — copy everything below

I need you to validate a Konsolidator client standard JSON against its export.

Attached:
1. **Export file** (`meta.kind: "konsolidator_client_export"`) — the input given to whoever generated the standard.
2. **Standard file** (`meta.kind: "konsolidator_client_standard"`) — the output to validate.

Run the checks below and return a **structured report** at the end. Do NOT fix the standard. Only validate.

## Reference values

Required sections:
- **PL**: REV, COGS, OPEX, OTHER_OP, FIN, TAX, RESULT
- **BS**: NCA, CA, EQ, NCL, CL
- **CF**: CF_OP, CF_INV, CF_FIN

Valid cc_tags (exact strings):
- CC_01-Revenue
- CC_02-Cost Of Sales
- CC_03-Other Operating Income
- CC_05-Lease Expense
- CC_06-General and administrative
- CC_07-Employee Expense
- CC_08-R&D
- CC_09-Impairment Gain (Loss) on Fixed Assets
- CC_10-Depreciation and Amotization
- CC_11-Other Operating Expenses
- CC_13-Interest Income
- CC_14-Other financial income
- CC_15-Interest expense
- CC_16-Other financial expense
- CC_17-Foreign Exchange
- CC_18-Income Tax

## Hard checks (any failure blocks import)

1. **meta.kind** equals exactly `"konsolidator_client_standard"`
2. **meta.client_id** equals `export.meta.client_id`
3. **meta.standard_key** starts with `CUSTOM-`
4. **rows[]** exists and is non-empty
5. **sections[]** exists
6. Every `row.statement` is `PL`, `BS`, or `CF`
7. Every `row.account_code` is present
8. No duplicate `(statement, account_code)` pairs
9. Every `row.section_code` (when set) exists in `sections[]` for the same statement
10. Every `row.parent_code` (when set) exists as another `row.account_code` in the same statement
11. Every `row.cc_tag` (when set) is in the valid cc_tag list above
12. Every required section (PL: 7, BS: 5, CF: 3) is present in `sections[]`
13. Every P/L non-sum leaf account has `is_sum: false` (not null, not missing)

## Soft checks (warnings, do not block import)

1. **P/L leaf coverage**: at least 70% of P/L leaves (non-sum) have a cc_tag
2. **CC_01-Revenue count**: at least 3 accounts tagged as Revenue
3. **BS distribution**: no single BS section holds more than 60% of BS accounts, UNLESS `meta.notes` explicitly justifies it (e.g. granular fixed-asset register)
4. **Equity misclassification**: no accounts named "Reserva", "Capital", "Prima de emisión", "Resultado del ejercicio", "Utilidad/Pérdida", "Diferencias de conversión", "Overført", "Aktiekapital" are in NCA (should be in EQ)
5. **Coverage**: every non-sum P/L and B/S account from `export.group_accounts` (where AccountType is P/L or B/S and IsSumAccount is false) appears in `standard.rows[]`

## Also compute and report

- Total row count by statement (PL, BS, CF)
- Section distribution: how many rows in each section per statement
- cc_tag distribution: which tags are used and how many rows each
- Highest-share BS section (percentage)

## Output format — use exactly this structure

```
═══════════════════════════════════════
STANDARD VALIDATION REPORT
═══════════════════════════════════════

Standard key: <meta.standard_key>
Client:       <meta.client_id> — <export.meta.client_name>
Based on:     <meta.based_on_standard>
Rows:         <total>
Sections:     <total>

HARD CHECKS
───────────────────────────────────────
[✓ or ✗]  1. meta.kind valid
[✓ or ✗]  2. client_id matches export
[✓ or ✗]  3. standard_key format
[✓ or ✗]  4. rows[] non-empty
[✓ or ✗]  5. sections[] present
[✓ or ✗]  6. all row.statement values valid
[✓ or ✗]  7. all row.account_code present
[✓ or ✗]  8. no duplicates
[✓ or ✗]  9. all section refs valid
[✓ or ✗]  10. all parent refs valid
[✓ or ✗]  11. all cc_tags valid
[✓ or ✗]  12. all required sections present
[✓ or ✗]  13. is_sum boolean on all leaves

SOFT CHECKS
───────────────────────────────────────
[✓ or ⚠]  P/L leaf coverage: X.X% (target: 70%)
[✓ or ⚠]  Revenue accounts: N (target: ≥3)
[✓ or ⚠]  BS max section share: X.X% (target: <60% or justified)
[✓ or ⚠]  No equity accounts misplaced in NCA (found: N)
[✓ or ⚠]  Input coverage: X of Y input accounts represented

DISTRIBUTION
───────────────────────────────────────
PL sections: {REV: N, COGS: N, OPEX: N, OTHER_OP: N, FIN: N, TAX: N, RESULT: N}
BS sections: {NCA: N, CA: N, EQ: N, NCL: N, CL: N}
CF sections: {CF_OP: N, CF_INV: N, CF_FIN: N}

CC tag distribution:
  CC_01-Revenue: N
  CC_02-Cost Of Sales: N
  ...

DETAILS ON WARNINGS/FAILURES
───────────────────────────────────────
<For each ✗ or ⚠, list up to 10 specific offending row indices and their account_code + account_name so it's clear what to fix. If everything passes, write "No issues to report.">

═══════════════════════════════════════
VERDICT: [READY TO IMPORT | WARNINGS ONLY, IMPORT OK | HARD ERRORS, DO NOT IMPORT]
═══════════════════════════════════════
```

Return only the report — no preamble, no commentary before or after.