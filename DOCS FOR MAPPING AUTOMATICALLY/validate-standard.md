## Konsolidator Client Onboarding — Standard Generation Prompt (v6)

Paste this ENTIRE prompt when generating a client custom standard. Attach the client's export JSON as a file. Do not modify the prompt.

I need you to generate a `konsolidator_client_standard` JSON for the attached client export.

---

## Your job in one sentence

Take the client's chart of accounts (`group_accounts`) and produce a standard that (a) covers every input row, (b) uses the client's real account codes byte-for-byte, (c) assigns each account to a section based on the account NAME's meaning in its actual language, and (d) sorts everything so that when displayed top-to-bottom it reads like a real financial statement.

The standard drives Contributive, ConsolidationSheet, and every consolidated view. Its structure IS the app's rendering — there is no fallback.

---

## Task steps

1. Read `group_accounts` — the client's full chart of accounts (posting leaves + sum roll-ups).
2. Read `entity_samples` to see which accounts actually receive movement.
3. Read `meta.client_name`, `sources`, `structures` for context.
4. Produce a JSON standard that:
   - Covers **every** row in `group_accounts` (posting AND sum accounts) in `rows[]`.
   - Uses the **client's actual `accountCode`** byte-for-byte (never invented codes).
   - Assigns each row a **statement** (`PL`, `BS`, `CF`) derived from the input's `AccountType` field.
   - Assigns each row a **section_code** (or `null` for cross-section grand totals).
   - Assigns **cc_tag** to P/L leaves (from the `CC_NN` catalog) AND to B/S leaves (from the `BS_NN` catalog) for KPI resolution.
   - Preserves the **parent hierarchy** exactly as in the input's `SumAccountCode`.
   - Assigns **sort_order** so rows read narratively (Revenue at top of PL, Net Result at bottom of PL, grand totals at the head of the block they open, etc.).

---

## Core principles — universal, no exceptions

These are the invariants. They don't depend on any specific chart's coding convention.

### 1. Coverage is total

Every row in `group_accounts` must appear in output `rows[]`. Sum accounts get `is_sum: true`; leaves get `is_sum: false`. No account is dropped. If a code exists in the input and is missing from output, the app will not render it.

### 2. Account codes come from the input, unchanged

Copy `accountCode` byte-for-byte from the input into `account_code`. Do not invent codes like `CF.OP.01` when the client's chart uses `1039`. Do not normalize suffixes (`700000i` stays `700000i`, not `700000_ic`). Runtime data matches against these codes — any transformation breaks the join.

### 3. Statement comes from the input's AccountType

Map directly:

| Input `AccountType` | Output `statement` |
|---------------------|--------------------|
| `P/L`               | `PL`               |
| `DIS`               | `PL`               |
| `B/S`               | `BS`               |
| `C/F`               | `CF`               |
| `CFS`               | `CF`               |

Never infer statement from the account code shape. `1000` might be P/L in one chart and CF in another. Always use the input's `AccountType`.

### 4. parent_code preserved

`row.parent_code` equals the input's `SumAccountCode`. Do not invent a hierarchy. Do not flatten. Do not re-parent.

If the input's parent code doesn't exist as another row (broken chain in source data), set `parent_code: null`.

### 5. Section on sum accounts = section derived from descendants

For each sum account (`is_sum: true`):

- Walk its descendants down to the leaves.
- Collect the set of `section_code` values on those leaves.
- **All descendants in same section** → assign that section to the sum.
- **Descendants span multiple sections** → set `section_code: null` (grand total).
- **No leaves under it (empty roll-up)** → inherit section from parent chain.

This rule is universal. It works whether the sum is called `A.PL`, `EBITDA`, `Total no circulante`, `1039`, or anything else. What matters is the descendants, not the code or name.

### 6. Grand totals never get a section

Any sum whose descendant leaves span more than one section gets `section_code: null`. Universally:

- Overall P/L result (aggregates Revenue + COGS + OPEX + …)
- Total Assets (aggregates NCA + CA)
- Total Equity + Liabilities (aggregates EQ + NCL + CL)
- Total Liabilities alone (aggregates NCL + CL)
- Cash Flow closing balances that span multiple CF subsections

The renderer treats `section_code: null` as "row without a section header above it", so grand totals show as bare anchor rows.

### 7. Section on leaves = semantic classification of the NAME

Read each account NAME in its actual language. Do not pattern-match on codes. Classify each leaf into exactly one section based on what the account describes semantically.

If the name is truly ambiguous (`999`, `TEST`, `varios`) or a placeholder, inherit section from parent and set `cc_tag: null` — don't guess.

### 8. cc_tag on P/L and B/S leaves

Every **P/L leaf** gets a `cc_tag` from the **`CC_NN` catalog** when the name is semantically clear. Aim for ≥70% coverage of P/L leaves.

Every **B/S leaf** gets a `cc_tag` from the **`BS_NN` catalog** when the name is semantically clear. Aim for ≥70% coverage of B/S leaves. The `BS_NN` tag must be consistent with the row's `section_code` (e.g. a `BS_07-Cash and equivalents` leaf lives in section `CA`; a `BS_14-Share capital` leaf lives in section `EQ`). See the "BS classification — semantic guide" and the `BS_NN` catalog for the section→tag mapping.

**Sum accounts do not get cc_tags** (neither P/L nor B/S) — aggregates are computed by the KPI engine from the leaves via `ref`, so tagging a sum account would double-count.

**CF accounts do not get cc_tags** — no KPI resolves against cash-flow tags. CF rows get `cc_tag: null`.

### 8a. Balance-sheet rollforward leaves — tag the WHOLE branch with the same tag

Many clients track fixed assets (and equity, and provisions) as a **rollforward**: one asset is split into many movement leaves — "Coste al inicio del ejercicio", "Adquisiciones", "Enajenaciones", "Ajustes por tipo de cambio", "Depreciación del ejercicio", "Revalorización", "Bajas", "Altas"… These names are generic and say nothing on their own. **Do not leave them untagged.**

The rule: every movement leaf inherits the `BS_NN` of the asset/branch it belongs to. If a branch is "Propiedad, planta y equipo" (`BS_02`), then ALL its leaves — cost, accumulated depreciation, revaluation, additions, disposals, FX — get `BS_02`. The KPI engine sums them, so cost minus depreciation plus revaluation nets to the correct carrying amount. Tagging only "Coste al inicio" and skipping "Depreciación" would overstate the asset; tagging none leaves the KPI at zero.

Concretely: walk up `parent_code` to the nearest named branch anchor (e.g. `B.2 Propiedad planta y equipo`, `B.1 Activos Intangibles`, `E.2 Préstamos`), decide that anchor's `BS_NN` once, and stamp it on every non-sum descendant. Depreciation/impairment contra-movements stay in the SAME tag as their asset (they reduce it — that's correct).

### 8b. Non-controlling interests override — "minoritarios" always wins

Any equity leaf whose name contains **"minoritari"**, **"no controlado"**, or **"non-controlling"** gets `BS_17-Non controlling interests` — **even if it sits under a reserves branch**. Equity rollforwards routinely nest minority-interest movements (e.g. "OCI Intereses minoritarios - ajustes del tipo de cambio") inside reserve or FX sub-trees. Those belong to NCI, not to `BS_15-Reserves`. Getting this wrong inflates owners' equity and understates NCI, breaking ROE and the equity split. This name rule overrides the branch rule in 8a for equity only.

### 8c. Sum-account code suffixes (`s`)

Some clients emit intermediate sum accounts with codes ending in a literal `s` (e.g. `430000s`, `200200s`, `114100s`) alongside dotted anchors (`D.1.1`, `B.2`). Treat these exactly like any other sum: `is_sum: true`, `cc_tag: null`. Never tag an `…s`-suffixed code; its children (the real movement leaves) carry the tags. The `s` is not a data code — it's a roll-up node.

### 9. Sort order = narrative reading order, with disjoint ranges per statement

`sort_order` is a global integer. When rows are sorted ascending, they must read like a real financial statement top-to-bottom.

**Disjoint ranges per statement — non-negotiable:**

- **PL rows**: sort_order ∈ [1000000, 1999999]
- **BS rows**: sort_order ∈ [2000000, 2999999]
- **CF rows**: sort_order ∈ [3000000, 3999999]

Why: consolidated views (Contributive, ConsolidationSheet) render PL + BS + CF in a single sortable view. If ranges overlap between statements, a BS grand total with sort_order 99 in legacy standards would render before Revenue (sort_order 100+) and break the narrative. Disjoint million-ranges guarantee the entire PL renders first, then BS, then CF — regardless of the client chart's shape.

**Within each statement, order sections in narrative sequence:**

**PL sections and their sort_order ranges:**
1. REV — 1000000–1099999
2. COGS — 1100000–1199999
3. OPEX — 1200000–1299999
4. OTHER_OP — 1300000–1399999
5. FIN — 1400000–1499999
6. TAX — 1500000–1599999
7. RESULT — 1600000–1699999
8. PL grand totals with section=null — 1700000–1799999
9. DIS distribution rows — 1800000–1899999

**BS sections and their sort_order ranges** — grand totals precede the block they open:

1. `2000000` — Grand total Assets (opens the Assets block; section=null)
2. `2100000–2199999` — NCA rows
3. `2200000–2299999` — CA rows
4. `2350000` — Grand total Equity + Liabilities (opens the equity+liabilities block; section=null)
5. `2400000–2499999` — EQ rows
6. `2450000` — Grand total Liabilities alone if it exists (opens the liabilities-only block; section=null)
7. `2500000–2599999` — NCL rows
8. `2600000–2699999` — CL rows
9. `2700000+` — any remaining BS grand totals

Note: grand-total `account_code`s are often **alphabetic**, not numeric (e.g. `C` = Total de activos, `H` = Total de pasivo y capital, `G` = Total de pasivo). That's fine — copy the code verbatim from the input, set `is_sum: true`, `section_code: null`, `cc_tag: null`, and place it at the sort_order slot above. The alphabetic code is not an error.

**CF sections and their sort_order ranges:**

1. CF_OP — 3000000–3299999
2. CF_INV — 3300000–3599999
3. CF_FIN — 3600000–3899999
4. CF grand totals (net cash flow, cash at end of year, etc.) — 3900000–3999999

**Within a section, order sum accounts BEFORE their leaves.** A section anchor sum (e.g. the account named "Ingresos" that aggregates all revenue lines, at sort_order 1000000) reads above its posting leaves (`1000010`, `1000020`, etc.). This mirrors how a real income statement is printed: subtotal label above the detail lines.

---

## Section catalog

Every standard MUST include these 15 sections with these exact codes.

**PL sections:**

| section_code | label            | color   |
|--------------|------------------|---------|
| REV          | Revenue          | #57aa78 |
| COGS         | Cost of Sales    | #CF305D |
| OPEX         | Operating Expenses | #d97706 |
| OTHER_OP     | Other Operating  | #0891b2 |
| FIN          | Financial Result | #1a2f8a |
| TAX          | Income Tax       | #7c3aed |
| RESULT       | Net Result       | #7c3aed |

**BS sections:**

| section_code | label                    | color   |
|--------------|--------------------------|---------|
| NCA          | Non-Current Assets       | #57aa78 |
| CA           | Current Assets           | #0891b2 |
| EQ           | Equity                   | #1a2f8a |
| NCL          | Non-Current Liabilities  | #CF305D |
| CL           | Current Liabilities      | #d97706 |

**CF sections:**

| section_code | label               | color   |
|--------------|---------------------|---------|
| CF_OP        | Operating Cash Flow | #57aa78 |
| CF_INV       | Investing Cash Flow | #0891b2 |
| CF_FIN       | Financing Cash Flow | #1a2f8a |

Sub-sections beyond these are allowed when the client's chart has intermediate subtotals. The 15 codes above must always be present.

---

## CC tag catalog — exact strings

| cc_tag | What accounts belong here |
|--------|---------------------------|
| CC_01-Revenue | Sales of goods/services; net revenue lines |
| CC_02-Cost Of Sales | Purchases, direct materials, direct cost of sales |
| CC_03-Other Operating Income | Subsidies, other operating income, non-core operating income |
| CC_05-Lease Expense | Rent, lease payments (operational and financial) |
| CC_06-General and administrative | Professional services, office supplies, admin costs |
| CC_07-Employee Expense | Wages, salaries, social security, bonuses, personnel benefits |
| CC_08-R&D | Research and development costs |
| CC_09-Impairment Gain (Loss) on Fixed Assets | Impairments, write-downs |
| CC_10-Depreciation and Amotization | Depreciation charge, amortization charge (P&L, not BS contra) |
| CC_11-Other Operating Expenses | Utilities, insurance, transport, other opex catch-all |
| CC_12-Share of profit (loss) from associates | Equity-method share of associates' results (P&L) |
| CC_13-Interest Income | Interest income earned |
| CC_14-Other financial income | Dividends received, gains on financial assets |
| CC_15-Interest expense | Interest paid on debt |
| CC_16-Other financial expense | Losses on financial assets, financial fees |
| CC_17-Foreign Exchange | FX gains and losses |
| CC_18-Income Tax | Corporate income tax expense |
| CC_19-Profit (loss) from discontinued operations | Results of operations held for sale / discontinued |

### B/S tag catalog — exact strings

Assign these to **B/S leaves** (`is_sum: false`). Each tag maps to exactly one `section_code` (shown in the "sec" column). The tag you assign must be consistent with the row's section.

| cc_tag | sec | What accounts belong here |
|--------|-----|---------------------------|
| BS_01-Intangible assets | NCA | Patents, licenses, software, concessions (not goodwill) |
| BS_02-PP&E | NCA | Land, buildings, machinery, equipment + their accumulated depreciation contras |
| BS_03-Goodwill | NCA | Goodwill / Fondo de comercio de consolidación |
| BS_04-Investments in associates | NCA | Long-term equity-method investments in associates |
| BS_05-Investments | NCA | Other long-term financial investments (non-associate) |
| BS_06-Deferred tax assets | NCA | Deferred tax assets (asset side) |
| BS_07-Cash and equivalents | CA | Cash, bank, short-term deposits, cash equivalents |
| BS_08-Accounts receivable | CA | Trade receivables (Clientes, Deudores, Trade debtors) |
| BS_09-Inventories | CA | Stock, raw materials, WIP, finished goods |
| BS_10-Short term investments and financial receivables | CA | ST financial investments and financial receivables |
| BS_11-Available for sale investments | CA | AFS financial assets |
| BS_12-Short term investments in associates | CA | ST investments in associates |
| BS_13-Other current assets | CA | Prepayments, other current assets, sundry debtors |
| BS_14-Share capital | EQ | Capital, Capital social, Kapital, Aktiekapital |
| BS_15-Reserves | EQ | Reserves, legal reserve, share premium, FX translation reserve |
| BS_15.1-Other equity instruments | EQ | Other equity instruments (hybrid/compound, treasury-linked) |
| BS_16-Retained earnings | EQ | Retained earnings, prior-year results, current-year result |
| BS_17-Non controlling interests | EQ | Minority / non-controlling interests |
| BS_18-Provisions | NCL | Long-term provisions |
| BS_19-Long term debt | NCL | Long-term bank debt, long-term leases, bonds |
| BS_20-Long term debt with associates | NCL | Long-term intercompany / associate debt |
| BS_21-Deferred tax liabilities | NCL | Deferred tax liabilities |
| BS_22-Other non current liabilities | NCL | Other long-term obligations |
| BS_23-Accounts payable | CL | Trade payables (Proveedores, Kreditorer) |
| BS_24-Short term debt | CL | Short-term bank debt, current portion of long-term debt |
| BS_25-Short term debt with associates | CL | Short-term intercompany / associate debt |
| BS_26-Short term provisions | CL | Short-term provisions |
| BS_27-income tax liabilities | CL | Income tax payable |
| BS_28-Other current liabilities | CL | Tax payables, payroll payables, other current obligations |

CF accounts get `cc_tag: null`.

---

## Semantic classification — read the NAME in its actual language

Never assume Spanish. Never skim.

### Revenue-side terms
- Spanish/LatAm: Ventas, Ingresos, Facturación
- Danish: Omsætning, Salg, Indtægter
- English: Revenue, Sales, Income, Turnover
- Portuguese: Receitas, Vendas, Faturamento

### Cost of Sales
- Spanish/LatAm: Coste de ventas, Costo de productos vendidos, Compras, Consumos
- Danish: Vareforbrug, Kostpris, Direkte omkostninger
- English: Cost of Sales, COGS, Cost of Goods Sold
- Portuguese: Custo das vendas, CMV

### Employee expenses
- Spanish: Sueldos, Salarios, Gastos de personal, Seguridad social, Nómina
- Danish: Løn, Personaleomkostninger, Pensionsomkostninger
- English: Wages, Salaries, Personnel, Payroll, Benefits, Pension
- Portuguese: Salários, Encargos sociais

### Depreciation / Amortization
- Spanish: Amortización, Depreciación, Deterioro
- Danish: Afskrivninger, Nedskrivninger
- English: Depreciation, Amortization, Impairment
- Portuguese: Depreciação, Amortização

### Financial items
- Spanish: Intereses, Gastos financieros, Diferencias de cambio
- Danish: Renter, Finansielle omkostninger, Kursreguleringer
- English: Interest, Financial expenses, FX
- Portuguese: Juros, Despesas financeiras, Câmbio

### Balance sheet terms
- "current" / "circulante" / "corto plazo" / "kortfristet" / "corrente" → CA or CL
- "non-current" / "no circulante" / "largo plazo" / "langfristet" / "não corrente" → NCA or NCL
- "equity" / "capital" / "patrimonio" / "egenkapital" / "reservas" / "reserver" → EQ

### Read the FULL name — the "no" traps

Common trap: skimming past key modifiers.

- `Total activo circulante` → CA (short-term assets)
- `Total activo NO circulante` → NCA (long-term assets) — the "NO" flips it
- `Deudas a largo plazo` → NCL
- `Deudas a corto plazo` → CL — same family, opposite section
- `Amortización acumulada` → BS (contra-asset in NCA)
- `Dotación a la amortización` → PL (expense)

Whenever "no", "not", "acumulada", "corto", "largo", "diferido" appears, PAUSE and re-check.

---

## BS classification — semantic guide

Balance sheets are where uncertain accounts most often get miscategorized. Reason each account by name:

### EQ (Equity)

Owner claims:
- Share capital: Capital, Capital social, Kapital, Share capital, Aktiekapital
- Retained earnings & reserves: Reservas, Reserva legal, Retained earnings, Overført resultat
- Current-year result: Resultado del ejercicio, Utilidad del ejercicio, Årets resultat, Net profit for the year
- Share premium: Prima de emisión, Share premium, Overkurs
- FX translation reserves: Ajustes por tipo de cambio, Diferencias de conversión, Kursreguleringsreserve — these are equity, NOT assets, even though they touch FX
- Deferred tax booked against equity: Impuesto diferido en Capital, Deferred tax on equity

Rule of thumb: if the name contains {Reserva, Capital, Prima de emisión, Resultado del ejercicio, Utilidad, Ajustes por tipo de cambio, Diferencias de conversión, Overført, Kapital} → EQ. No exceptions.

Tags: `BS_14-Share capital` (capital), `BS_15-Reserves` (reserves/premium/FX-reserve), `BS_15.1-Other equity instruments`, `BS_16-Retained earnings` (retained + current/prior-year result), `BS_17-Non controlling interests` (minorities).

### NCA (Non-Current Assets)

Long-term owned things (useful life > 1 year):
- Tangible fixed assets and their accumulated depreciation contras
- Intangible assets (Patentes, Concesiones, Fondo de comercio, Aplicaciones informáticas)
- Long-term financial investments
- Investment property
- Deferred tax **assets** (asset side)

Depreciation/impairment contra-accounts DO belong here — they reduce gross NCA.

Tags: `BS_01-Intangible assets`, `BS_02-PP&E` (tangibles + their accumulated depreciation contras), `BS_03-Goodwill`, `BS_04-Investments in associates`, `BS_05-Investments` (other LT financial), `BS_06-Deferred tax assets`.

### CA (Current Assets)

Owned/receivable within 1 year:
- Cash and equivalents
- Trade receivables (Clientes, Deudores, Trade debtors, Debitorer)
- Inventory
- Short-term financial investments

Tags: `BS_07-Cash and equivalents`, `BS_08-Accounts receivable`, `BS_09-Inventories`, `BS_10-Short term investments and financial receivables`, `BS_11-Available for sale investments`, `BS_12-Short term investments in associates`, `BS_13-Other current assets`.

### NCL (Non-Current Liabilities)

Obligations > 1 year:
- Long-term bank debt, long-term leases
- Long-term provisions, deferred tax **liabilities**
- Long-term intercompany debt

Tags: `BS_18-Provisions` (LT), `BS_19-Long term debt`, `BS_20-Long term debt with associates`, `BS_21-Deferred tax liabilities`, `BS_22-Other non current liabilities`.

### CL (Current Liabilities)

Obligations < 1 year:
- Trade payables (Proveedores, Kreditorer)
- Short-term bank debt
- Tax payables, payroll payables
- Short-term intercompany debt

Tags: `BS_23-Accounts payable`, `BS_24-Short term debt`, `BS_25-Short term debt with associates`, `BS_26-Short term provisions`, `BS_27-income tax liabilities`, `BS_28-Other current liabilities`.

### BS sanity check

After classifying, count:

- **Section-share sanity (rollforward-aware).** Real balance sheets distribute roughly 30% NCA, 25% CA, 20% EQ, 15% NCL, 10% CL *by carrying amount* — but NOT by row count when the client uses rollforwards. A client tracking fixed assets per-asset (cost/depreciation/revaluation/additions/disposals/FX movement leaves) will legitimately put 75–85%+ of BS ROWS in NCA. That is normal and expected — do NOT flag it. The real red flags are: (a) `CA` holding > 40% of BS rows (cash/receivables/inventory don't rollforward, so a fat CA means misclassification — likely NCA assets dumped into CA), or (b) `EQ` > 40% of rows without an equity rollforward. When NCA is the fat section AND its bulk is movement leaves, just state the rollforward in `meta.notes` with the sub-account count and move on.
- **Zero in any of NCA/CA/EQ/NCL/CL** → almost certainly wrong. Virtually every real group has all five.

If off, re-read especially for equity-side accounts (Reservas, Capital, Ajustes por tipo de cambio, Utilidad del ejercicio) that MUST go to EQ.

### PL sanity check

- **< 3 accounts tagged CC_01-Revenue** → suspicious for any real business. Revenue lines multiply because clients track by product line, region, entity.
- **> 60% of P/L leaves untagged** → too conservative. Almost every P&L account has a semantic home.
- **Zero in CC_02-Cost Of Sales** for a client whose entity samples show COGS-like activity → wrong.

### BS tag sanity check

- **> 30% of B/S leaves untagged** → too conservative. Most balance-sheet accounts map cleanly to a `BS_NN` tag. Re-read especially cash, receivables, payables, debt, capital and reserves.
- **Zero in `BS_07-Cash and equivalents`** → almost certainly wrong; every real group holds cash.
- **A `BS_NN` tag inconsistent with its `section_code`** (e.g. `BS_14-Share capital` on a row whose section is `CA`) → wrong. Tag and section must agree per the catalog's "sec" column.

---

## Sum accounts — how to place them

Sum accounts anchor sections and drive the tree render. Assign section by rule 5 (descendant-set rule).

### Semantic sums that need a specific section

Some charts include named subtotals (whatever their code) that semantically belong to a specific section. Read the sum's NAME:

- A sum whose name conveys "EBIT" / "EBITDA" / "Operating profit" / "Utilidad operativa" → OTHER_OP (the last operating subtotal before financial items)
- A sum whose name conveys "Profit before tax" / "Utilidad antes de impuestos" / "Result before tax" → FIN (comes after financial items)
- A sum whose name conveys "Profit from continuing operations" / "Utilidad de operaciones continuas" → RESULT
- A sum whose name aggregates the entire P/L (e.g. "Net profit for the year", "Utilidad del año", the account that all P/L rolls up to) → `null` (grand total)
- A sum whose name conveys "Distribution of profit" / "Distribución del resultado" and its children (retained earnings, dividends) → RESULT for the header; individual distribution rows may be RESULT or `null` depending on whether they aggregate

If in doubt, apply rule 5: same descendant section → that section; multiple → null.

### Section anchors

The FIRST sum in each section (by sort_order within that section) IS the section anchor. It receives the section breaker in the render. Put it at the low end of the section's sort_order range (e.g. sort_order 1000000 for the first REV sum).

---

## Grand totals — the anchor rule

A grand total is a sum with `section_code: null`. It aggregates multiple sections.

Grand totals must appear **at the head of the block they open**, not at the end of the block they close, and never wedged between sections.

### Correct placement — universal, independent of chart codes

For **PL**: grand totals go at 1700000–1799999 (end of the operating narrative).

For **BS**: grand totals precede the block they open (section=null anchor above the sections it aggregates).

- Assets grand total → 2000000 (opens Assets block: NCA + CA below it)
- Equity+Liabilities grand total → 2350000 (opens equity+liabilities block: EQ + NCL + CL below)
- Liabilities-alone grand total (if it exists as a separate roll-up spanning NCL+CL) → 2450000 (opens liabilities-only block: NCL + CL below)

For **CF**: grand totals go at 3900000+ (end of the CF narrative).

### Common wrong placements — do NOT do these

- ❌ Grand total between two sections at the "natural" numeric slot — renders as an orphan row without a section header, looks broken
- ❌ Grand total at the very end of the statement — reads bottom-up, backwards
- ❌ Grand total INSIDE a section it aggregates (`section_code: "NCA"` on Total Assets) — renderer attaches wrong breaker

---

## Placeholder and phantom accounts

The client's chart may include accounts that aren't real posting accounts:

- **Placeholders**: `TEST`, `Nuevo`, `Nuevo1`, `KON_1`, `Placeholder`, `TBD`, `Provisional`
- **Consolidation adjustments**: `Dif. conso`, `Ajuste conso`, `Consolidation diff`, `Elimination`
- **Corrupt/malformed names**: `S¤F`, `???`, single-char, symbols-only
- **Bare codes**: `999`, single-digit codes without descriptive text

Handle each:

1. **Placeholders** — include in `rows[]`, section inherited from parent, `cc_tag: null`.
2. **Consolidation adjustments** — include with `cc_tag: null`, section inherited from parent. Do not tag as Revenue/COGS just because "sales" or "cost" appears in the name.
3. **Corrupt names** — include with `cc_tag: null`, section inherited from parent. If many, note in `meta.notes`.
4. **Intercompany variants** (`700000i`, `600000i`, `_i` suffix, etc.) — SAME `cc_tag` as the non-IC counterpart. Non-IC `700000` gets CC_01-Revenue → IC `700000i` also gets CC_01-Revenue.

---

## Output — this exact schema, no deviations

```json
{
  "meta": {
    "kind": "konsolidator_client_standard",
    "version": 1,
    "client_id": "<COPY FROM INPUT meta.client_id>",
    "standard_key": "CUSTOM-<client_slug from input meta.client_slug>",
    "based_on_standard": "PGC" | "DanishIFRS" | "SpanishIFRS-ES",
    "generated_by": "claude",
    "generated_at": "<ISO 8601 timestamp>",
    "notes": "<1-2 sentence rationale; note deviations, granular fixed-asset registers, or any BS concentration justification>"
  },
  "sections": [
    {
      "statement": "PL",
      "section_code": "REV",
      "label": "Revenue",
      "label_en": "Revenue",
      "label_da": "Omsætning",
      "label_es": "Ingresos",
      "color": "#57aa78",
      "sort_order": 10
    }
  ],
  "rows": [
    {
      "statement": "PL",
      "account_code": "<COPY FROM INPUT accountCode>",
      "account_name": "<COPY FROM INPUT accountName>",
      "account_name_en": "<English translation if reasonable, else null>",
      "account_name_da": null,
      "account_name_es": "<Spanish original if input was Spanish, else translation or null>",
      "parent_code": "<COPY FROM INPUT SumAccountCode, or null>",
      "section_code": "REV",
      "cc_tag": "CC_01-Revenue",
      "is_sum": false,
      "sort_order": 1000010,
      "level": 3,
      "show_in_summary": true
    },
    {
      "statement": "BS",
      "account_code": "<COPY FROM INPUT accountCode>",
      "account_name": "<COPY FROM INPUT accountName>",
      "account_name_en": "<English translation if reasonable, else null>",
      "account_name_da": null,
      "account_name_es": "<Spanish original if input was Spanish, else translation or null>",
      "parent_code": "<COPY FROM INPUT SumAccountCode, or null>",
      "section_code": "CA",
      "cc_tag": "BS_07-Cash and equivalents",
      "is_sum": false,
      "sort_order": 2000010,
      "level": 3,
      "show_in_summary": true
    }
  ],
  "kpi_overrides": []
}
```

---

## Reference standards to guide (not dictate)

- PGC (Spanish Plan General Contable) — numeric codes like `700000`, `600000`
- DanishIFRS — 5-6 digit codes
- SpanishIFRS-ES — alphanumeric hierarchical (`A.01`, `B.PL`, `D.1.4`)

Set `meta.based_on_standard` to the closest match by structure and coding shape. If the client's chart matches none, pick closest and explain the deviation in `meta.notes`.

---

## Hard validation the import will run — any failure blocks

- `meta.kind == "konsolidator_client_standard"` (exact string)
- `meta.client_id` matches input export
- `meta.standard_key` starts with `CUSTOM-`
- All 15 required sections present (7 PL + 5 BS + 3 CF)
- Every `row.statement ∈ {PL, BS, CF}`
- Every `row.section_code` exists in `sections[]` for the same statement (or is null)
- Every non-null `row.parent_code` exists as another row's `account_code` in the same statement
- Every non-null `row.cc_tag` is from the catalog above — `CC_NN` tags only on PL rows, `BS_NN` tags only on BS rows
- Every non-null `BS_NN` cc_tag sits on a row whose `section_code` matches the tag's "sec" column in the catalog
- Every `cc_tag` sits on a leaf (`is_sum: false`) — sum accounts must have `cc_tag: null`
- No duplicate `(statement, account_code)` pairs
- Every row from input `group_accounts` appears in output `rows[]`

## Soft validation — surfaces warnings

- < 70% of P/L leaves have cc_tag
- < 70% of B/S leaves have cc_tag
- < 3 CC_01-Revenue accounts
- `CA` or `EQ` holding > 40% of BS rows (misclassification signal — NCA is allowed to be large due to rollforwards, CA/EQ are not); or NCA > 85% without a rollforward note in `meta.notes`
- Any sort_order outside disjoint ranges (PL 1M-2M, BS 2M-3M, CF 3M-4M)
- Missing coverage vs input group_accounts

---

## Anti-patterns — real failures observed in prior generations

These are actual mistakes the model has made when generating standards. Each is explained so you can recognize and avoid it.

### AP-1. Inventing account codes for CF

Wrong: outputting `"account_code": "CF.OP.01"` when the client's chart uses numeric CF codes like `1039`, `1049`, `1799`, `2999`, `3999`, `4999`, `8999`, `9999`.

Right: copy the input's `accountCode` verbatim. Runtime CF data joins on this code. Any invented value renders as an empty row with no amount.

### AP-2. Grand totals inside a section

Wrong: `Total activos` (aggregates NCA + CA) with `section_code: "NCA"` and sort_order somewhere in NCA range.

Right: `section_code: null`, sort_order at the head-of-block anchor slot (2000000 for Assets, 2350000 for Equity+Liabilities, 2450000 for Liabilities-only).

Consequence of the wrong version: the renderer treats the grand total as an ordinary NCA row and paints "Non-Current Assets" breaker above it. Users see `NON-CURRENT ASSETS ▸ Total activos: 80M` which is nonsense.

### AP-3. Grand totals sorted after their block

Wrong: `Total pasivo y capital` at sort_order 2999999 (after CL). The block reads NCA → CA → EQ → NCL → CL → Total pasivo y capital.

Right: sort_order 2350000. Block reads NCA → CA → **Total pasivo y capital** → EQ → NCL → CL. Grand total OPENS the block it aggregates.

Consequence of wrong version: the total appears bottom-up like an afterthought instead of anchoring the block.

### AP-4. EBIT/EBITDA classified by descendant vote

Wrong: EBIT sum's descendants are Revenue + COGS + OPEX + Depreciation → multiple sections → assign `section_code: null`.

Right: EBIT is semantically the LAST operating subtotal before financial items. Assign OTHER_OP regardless of descendant vote.

The descendant-vote rule (Core Principle 5) is the DEFAULT. Named sums like EBIT/EBITDA/Profit before tax override the default because they have canonical narrative positions.

### AP-5. Sort_order overlap between statements

Wrong: PL rows in [0, 999], BS rows in [1000, 1999], CF rows in [2000, 2999]. Any narrow-range scheme.

Right: PL in [1000000, 1999999], BS in [2000000, 2999999], CF in [3000000, 3999999]. Millions, disjoint.

Why: consolidated views (Contributive "Todos" tab, ConsolidationSheet) sort PL+BS+CF together by sort_order. Narrow ranges mean a BS grand total at 1500 renders BETWEEN Revenue at 1200 and COGS at 1800. Only million-range disjoint ranges guarantee "entire PL renders first, entire BS second, entire CF third."

### AP-6. Missing coverage of sum accounts

Wrong: outputting only `is_sum: false` rows and skipping the sums, thinking the app will reconstruct hierarchy from `parent_code`.

Right: EVERY row from `group_accounts` appears in output — sums AND leaves. Contributive builds its tree from the standard's rows. If a sum is missing, its children float without a parent, break the render, and skip the section breaker.

### AP-7. Equity accounts misclassified as NCA

Wrong: `Ajustes por tipo de cambio` classified as NCA because it "touches FX assets."

Right: EQ. FX translation reserves are equity movements, not asset movements. Same for `Diferencias de conversión`, `Overført resultat`, `Reservas`, `Prima de emisión`, `Utilidad del ejercicio`.

The trap: these names contain neutral finance terms. The classifier must recognize the SPECIFIC name pattern, not skim for "asset-like" words.

### AP-8. Placeholder or corrupt names given semantic tags

Wrong: an account literally named `TEST` or `Nuevo1` or `S¤F` or `999` gets `cc_tag: CC_11-Other Operating Expenses` because "something needed to go there."

Right: `cc_tag: null`, section inherited from parent. Placeholders and corrupt-name accounts must not be tagged. They exist in the client's chart as unused slots or corrupt data — tagging them contaminates KPI resolution.

### AP-9. Intercompany variants tagged differently from their counterpart

Wrong: `700000 Ingresos con terceros` → CC_01-Revenue, but `700000i Ingresos Intercompañía` → CC_03-Other Operating Income because the model thought "intercompany is not real revenue."

Right: BOTH get CC_01-Revenue. Intercompany variants track the same semantic activity, eliminated later during consolidation. Same cc_tag.

### AP-10. Normalizing account codes

Wrong: input `700000i` → output `700000_ic` or `700000-i` or `IC-700000`.

Right: output `700000i` byte-for-byte. Runtime data brings amounts keyed on the exact input code. Any normalization breaks the join and the amount column shows —.

---

## Self-verification — run BEFORE emitting the JSON

After you've drafted the standard, execute these checks mentally on the drafted output. Fix any failure and re-check. Do not emit until all pass.

1. **Coverage sanity**: count input `group_accounts` rows. Count output `rows[]`. Difference must be 0. If negative, you dropped rows. If positive, you invented rows.

2. **Byte-for-byte codes**: pick 10 random codes from input `group_accounts`. Find each in output `rows[]`. String equality must hold. If any differ, you normalized — undo it.

3. **Statement mapping**: for 10 random input rows, verify output statement matches AccountType (P/L→PL, DIS→PL, B/S→BS, C/F→CF, CFS→CF). If any mismatch, you inferred from code shape — undo it.

4. **parent_code chain**: pick 5 leaves. Walk parent_code up. Each hop's parent_code must be another row's account_code in the same statement. If chain breaks, the leaf shows up as an orphan root.

5. **Range check**: quick-scan sort_orders. PL should ALL be in [1M, 2M). BS all in [2M, 3M). CF all in [3M, 4M). If any PL row has sort_order < 1000000 or ≥ 2000000, fix it.

6. **Grand total placement**: find every row with `section_code: null`. Check its sort_order.
   - PL grand totals → [1700000, 1799999]
   - BS Assets grand total → 2000000
   - BS Equity+Liabilities grand total → 2350000
   - BS Liabilities-only grand total → 2450000
   - CF grand totals → [3900000, 3999999]

7. **Section anchor placement**: for each of the 15 sections, find the FIRST row (lowest sort_order) with that section_code. Its sort_order must be at the low end of the section's sub-range. That row IS the section anchor.

8. **BS distribution (rollforward-aware)**: count rows per BS section, compute % of BS total. NCA being 75–85%+ is NORMAL with per-asset rollforwards — note it in `meta.notes` and don't flag. Flag only if `CA` > 40% or `EQ` > 40% of rows (those sections don't rollforward, so a large share means NCA assets were misclassified into them), or NCA > 85% with no rollforward note.

9. **PL cc_tag coverage**: count P/L `is_sum: false` rows. Count those with non-null cc_tag. Ratio ≥ 70%. If below, you were too conservative — most PL accounts have a semantic home.

9b. **BS cc_tag coverage + consistency**: count B/S `is_sum: false` rows. Count those with non-null cc_tag. Ratio ≥ 70%. Then, for every tagged BS leaf, verify its `BS_NN` tag's section (catalog "sec" column) equals the row's `section_code`. Any mismatch → fix the tag or the section so they agree.

10. **Grand total descendants**: for each `section_code: null` sum, list its immediate children. Their section_codes should span multiple different values (that's WHY the sum is section=null). If all children share one section, you misassigned null — assign the shared section.

---

## Final checklist — walk through BEFORE you output

- [ ] Every row in `group_accounts` appears in `rows[]` (posting AND sum accounts)
- [ ] `account_code` is copied byte-for-byte from input (no invented codes, no normalization)
- [ ] `statement` derived from input's `AccountType` (never inferred from code shape)
- [ ] `parent_code` copied from input's `SumAccountCode`
- [ ] Every `section_code` referenced by rows exists in `sections[]`
- [ ] Every parent_code exists as another row's account_code in the same statement
- [ ] Every cc_tag is from the catalog (`CC_NN` on PL leaves, `BS_NN` on BS leaves, never on sum accounts, never on CF)
- [ ] Every `BS_NN` tag's section matches the row's `section_code` (catalog "sec" column)
- [ ] No duplicate `(statement, account_code)` pairs
- [ ] PL rows in [1000000, 1999999]; BS rows in [2000000, 2999999]; CF rows in [3000000, 3999999]
- [ ] Section anchor sums appear BEFORE their leaves within their section's sort_order range
- [ ] Grand totals (section=null) appear at the head of the block they open, per the sort_order table above
- [ ] Sum accounts have `section_code` derived from descendant leaves (single section → that section; multiple → null)
- [ ] Sums named "EBIT" / "EBITDA" / "Profit before tax" / "Result before tax" placed by semantic rule, not just descendant vote
- [ ] No equity-side names (Reservas, Capital, Ajustes por tipo de cambio, Utilidad del ejercicio) misclassified in NCA
- [ ] All accounts with "no circulante" / "non-current" / "largo plazo" / "long-term" in NCA, not CA
- [ ] All accounts with "circulante" (without "no") / "current" / "corto plazo" in CA, not NCA
- [ ] ≥ 70% of P/L leaves have cc_tag
- [ ] ≥ 70% of B/S leaves have cc_tag
- [ ] ≥ 3 CC_01-Revenue
- [ ] Placeholder accounts (TEST, Nuevo, KON_x, TBD, corrupt names) have `cc_tag: null`
- [ ] Intercompany variants carry SAME cc_tag as their non-IC counterpart
- [ ] Every account name was READ in its actual language (not skimmed)
- [ ] JSON is valid and parseable

Output ONLY the JSON. No preamble, no markdown fences, no commentary. Start with `{` and end with `}`.