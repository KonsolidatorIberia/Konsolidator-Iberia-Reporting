# Client Standard Validator (v2)

Use this to verify any JSON standard Claude generates before importing it. Catches every rule from `onboarding-prompt.md v4`.

## When to use

- After running the onboarding prompt and getting a standard JSON back
- After making manual edits to a standard file
- Before clicking Import in the Admin Onboarding page

## How to use

1. Open a fresh Claude chat (any: claude.ai, desktop, in-app)
2. Attach BOTH files:
   - The original client export JSON (e.g. `konsolidator-export.json`)
   - The generated standard JSON to validate
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

**Required sections (15 total):**
- **PL**: REV, COGS, OPEX, OTHER_OP, FIN, TAX, RESULT
- **BS**: NCA, CA, EQ, NCL, CL
- **CF**: CF_OP, CF_INV, CF_FIN

**Valid cc_tags (exact strings, 16 total):**
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

**Sort_order disjoint ranges per statement (non-negotiable):**
- PL: [1000000, 1999999]
- BS: [2000000, 2999999]
- CF: [3000000, 3999999]

**Section sort_order sub-ranges within each statement:**

PL:
- REV: 1000000–1099999
- COGS: 1100000–1199999
- OPEX: 1200000–1299999
- OTHER_OP: 1300000–1399999
- FIN: 1400000–1499999
- TAX: 1500000–1599999
- RESULT: 1600000–1699999
- PL grand totals (section=null aggregating full PL): 1700000–1799999
- DIS distribution rows: 1800000–1899999

BS (grand totals precede the block they open):
- Assets grand total (section=null, aggregates NCA+CA): 2000000
- NCA: 2100000–2199999
- CA: 2200000–2299999
- Equity+Liabilities grand total (section=null, aggregates EQ+NCL+CL): 2350000
- EQ: 2400000–2499999
- Liabilities-only grand total (section=null, aggregates NCL+CL): 2450000
- NCL: 2500000–2599999
- CL: 2600000–2699999
- Other BS grand totals: 2700000+

CF:
- CF_OP: 3000000–3299999
- CF_INV: 3300000–3599999
- CF_FIN: 3600000–3899999
- CF grand totals: 3900000–3999999

## Hard checks (any failure blocks import)

1. **meta.kind** equals exactly `"konsolidator_client_standard"`
2. **meta.client_id** equals `export.meta.client_id`
3. **meta.standard_key** starts with `CUSTOM-`
4. **rows[]** exists and is non-empty
5. **sections[]** exists and is non-empty
6. Every `row.statement` is `PL`, `BS`, or `CF`
7. Every `row.account_code` is present (non-empty string)
8. No duplicate `(statement, account_code)` pairs
9. Every `row.section_code` (when not null) exists in `sections[]` for the same statement
10. Every `row.parent_code` (when not null) exists as another `row.account_code` in the same statement
11. Every `row.cc_tag` (when not null) is in the valid cc_tag catalog
12. All 15 required sections are present in `sections[]` (7 PL + 5 BS + 3 CF)
13. Every row has `is_sum` as a boolean (not null, not missing)

## Structural checks — sort_order integrity

14. Every PL row has `sort_order ∈ [1000000, 1999999]`
15. Every BS row has `sort_order ∈ [2000000, 2999999]`
16. Every CF row has `sort_order ∈ [3000000, 3999999]`
17. Every row's `sort_order` matches its section's sub-range (per table above); for `section_code: null` rows, sort_order matches the grand-total slot for its statement

## Coverage checks

18. Every code in `export.group_accounts[].accountCode` appears in `standard.rows[].account_code` (100% coverage — no missing rows)
19. For every `export.group_accounts` row: if input `IsSumAccount === true`, output has `is_sum: true`; if false, output has `is_sum: false`
20. For every `export.group_accounts` row: output `statement` matches the input's `AccountType` mapping (P/L→PL, DIS→PL, B/S→BS, C/F→CF, CFS→CF)
21. For every `export.group_accounts` row with a non-empty `SumAccountCode`: output `parent_code` equals that value byte-for-byte
22. No output `account_code` was invented — every code in `standard.rows[].account_code` exists in `export.group_accounts[].accountCode`

## Semantic checks (grand totals and cross-section sums)

23. For every sum account (`is_sum: true`), its descendant leaves' sections are either all one section (→ that section) or multiple sections (→ `section_code: null`). No sum has a section_code that its descendants don't share.
24. No account whose name matches EQ patterns is placed in NCA. Patterns: `Reserva`, `Capital`, `Prima de emisión`, `Resultado del ejercicio`, `Utilidad/Pérdida del ejercicio` or `del año`, `Diferencias de conversión`, `Ajustes por tipo de cambio`, `Overført`, `Aktiekapital`
25. No account whose name includes "circulante" (without "no") / "current" / "corto plazo" / "kortfristet" is placed in NCA. Should be CA.
26. No account whose name includes "no circulante" / "non-current" / "largo plazo" / "langfristet" is placed in CA. Should be NCA.
27. Intercompany variants (codes with `_i`, `i` suffix, or containing "intercompañ" / "intercompany" in name) carry the SAME `cc_tag` as their non-intercompany counterpart (where identifiable)

## Soft checks (warnings, do not block import)

28. **P/L leaf coverage**: at least 70% of P/L leaves (`is_sum: false`) have a non-null cc_tag
29. **CC_01-Revenue count**: at least 3 accounts tagged as Revenue
30. **BS distribution**: no single BS section holds more than 60% of BS accounts, UNLESS `meta.notes` explicitly justifies it (e.g. granular fixed-asset rollforward)
31. **CC_02-Cost Of Sales presence**: if entity_samples show meaningful COGS-like activity (accounts with names matching Costo/Compras/Vareforbrug/COGS), at least 1 account tagged
32. **Placeholder cc_tag**: placeholder accounts (`TEST`, `Nuevo`, `KON_x`, `Placeholder`, `TBD`, corrupt/symbol-only names) have `cc_tag: null`

## Also compute and report

- Total row count by statement (PL, BS, CF)
- Section distribution: how many rows in each section per statement
- cc_tag distribution: which tags are used and how many rows each
- Highest-share BS section (percentage)
- List of any input `group_accounts` code missing from output (coverage gap)
- List of any output `account_code` not present in input (invented codes)

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

HARD CHECKS (block import if any ✗)
───────────────────────────────────────
[✓/✗]  1.  meta.kind valid
[✓/✗]  2.  client_id matches export
[✓/✗]  3.  standard_key format
[✓/✗]  4.  rows[] non-empty
[✓/✗]  5.  sections[] non-empty
[✓/✗]  6.  all row.statement values valid
[✓/✗]  7.  all row.account_code present
[✓/✗]  8.  no duplicate (statement, account_code)
[✓/✗]  9.  all section refs valid
[✓/✗]  10. all parent refs valid
[✓/✗]  11. all cc_tags valid
[✓/✗]  12. all 15 required sections present
[✓/✗]  13. is_sum boolean everywhere

STRUCTURAL CHECKS (sort_order integrity)
───────────────────────────────────────
[✓/✗]  14. PL sort_order in [1M, 2M)
[✓/✗]  15. BS sort_order in [2M, 3M)
[✓/✗]  16. CF sort_order in [3M, 4M)
[✓/✗]  17. sort_order matches section sub-range

COVERAGE CHECKS (input vs output)
───────────────────────────────────────
[✓/✗]  18. every input group_accounts row present in output
[✓/✗]  19. is_sum matches input IsSumAccount
[✓/✗]  20. statement matches input AccountType mapping
[✓/✗]  21. parent_code matches input SumAccountCode
[✓/✗]  22. no invented codes (every output code exists in input)

SEMANTIC CHECKS
───────────────────────────────────────
[✓/✗]  23. sum section = descendant section (single) or null (multi)
[✓/✗]  24. no equity-name accounts placed in NCA
[✓/✗]  25. no "current" accounts placed in NCA
[✓/✗]  26. no "non-current" accounts placed in CA
[✓/✗]  27. intercompany variants share cc_tag with non-IC counterpart

SOFT CHECKS (warnings)
───────────────────────────────────────
[✓/⚠]  28. P/L leaf cc_tag coverage: X.X% (target: ≥70%)
[✓/⚠]  29. Revenue accounts: N (target: ≥3)
[✓/⚠]  30. BS max section share: X.X% (target: <60% or justified in meta.notes)
[✓/⚠]  31. Cost of Sales coverage when COGS activity present
[✓/⚠]  32. Placeholder accounts have cc_tag: null

DISTRIBUTION
───────────────────────────────────────
PL sections: {REV: N, COGS: N, OPEX: N, OTHER_OP: N, FIN: N, TAX: N, RESULT: N, null: N}
BS sections: {NCA: N, CA: N, EQ: N, NCL: N, CL: N, null: N}
CF sections: {CF_OP: N, CF_INV: N, CF_FIN: N, null: N}

Input group_accounts total: N
Output rows total:          N
Coverage:                   X.X%

CC tag distribution:
  CC_01-Revenue: N
  CC_02-Cost Of Sales: N
  ...
  (untagged P/L leaves): N

DETAILS ON FAILURES/WARNINGS
───────────────────────────────────────
<For each ✗ or ⚠, list up to 15 specific offending row indices with account_code + account_name + reason.
For coverage gaps (#18), list up to 20 missing codes.
For invented codes (#22), list all.
For placement errors (#24-#26), list account_code + name + current section + should-be section.
If everything passes, write "No issues to report.">

═══════════════════════════════════════
VERDICT: [READY TO IMPORT | WARNINGS ONLY, IMPORT OK | HARD ERRORS, DO NOT IMPORT]
═══════════════════════════════════════
```

Return only the report — no preamble, no commentary before or after.