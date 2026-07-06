
## Konsolidator Client Onboarding — Standard Generation Prompt (v2)
Paste this ENTIRE prompt when generating a client custom standard. Attach the client's export JSON as a file. Do not modify the prompt.
I need you to generate a konsolidator_client_standard JSON for the attached client export.
### Your task
1. Analyze the group_accounts array — this is the tenant's full chart of accounts.
2. Look at entity_samples to see which accounts have real movement (helps you validate names against actual usage).
3. Look at meta.client_name, sources, and structures for context.
4. Generate a full custom accounting standard that organizes every P/L and B/S account into the right section, assigns proper cc_tags to every P/L leaf so KPIs resolve correctly, and builds a matching CF section structure.
### Reference standards to guide (not dictate) your work
Use these as inspiration for structure and naming patterns. Do NOT assume the client's chart matches one of them.
- PGC (Spanish Plan General Contable) — numeric codes like 700000, 600000, 640000
- DanishIFRS — 5-6 digit codes
- SpanishIFRS-ES — alphanumeric hierarchical codes (A.01, B.PL, D.1.4)
Pick the base standard whose STRUCTURE most closely resembles the client's, and put it in meta.based_on_standard. If the client's chart doesn't match any reference, pick the closest and note the deviation in meta.notes.
### Classification method — SEMANTIC not SYNTACTIC
Do not classify accounts based on their code number or letter prefix alone. Chart-of-accounts conventions vary by client, country, and internal accounting policy — pattern-matching codes will misclassify.
Do classify each account based on its name (account_name), what the account describes, and what section it logically belongs to. Read the name in whatever language it's written in — Spanish, Danish, English — and reason about what the account represents.
Examples of semantic reasoning:
- "Ventas de mercadería" → this literally means "merchandise sales" → PL, section REV, cc_tag: CC_01-Revenue
- "Amortización acumulada del inmovilizado material" → accumulated depreciation on tangible fixed assets → BS, section NCA, no cc_tag (it's a contra-asset on the BS, not an expense line)
- "Dotaciones para amortización del inmovilizado" → depreciation charge for the period → PL, section OPEX, cc_tag: CC_10-Depreciation and Amotization
- "Sueldos y salarios" → wages and salaries → PL, section OPEX, cc_tag: CC_07-Employee Expense
- "Bancos e instituciones de crédito c/c vista, euros" → cash on hand at bank → BS, section CA
- "Deudas a largo plazo con entidades de crédito" → long-term bank debt → BS, section NCL
- "Reservas voluntarias" → voluntary reserves → BS, section EQ
Every account name in the input contains enough information to classify it correctly. If a name is truly ambiguous (e.g. just a code like "999" or "varios"), leave cc_tag: null and place it in the most likely section — do not guess wildly.
### Section structure — required
Every custom standard MUST include these sections. Use exact codes:
PL sections (in this order):
			section_code
			label
			color
			REV
			Revenue
			#57aa78
			COGS
			Cost of Sales
			#CF305D
			OPEX
			Operating Expenses
			#d97706
			OTHER_OP
			Other Operating
			#0891b2
			FIN
			Financial Result
			#1a2f8a
			TAX
			Income Tax
			#7c3aed
			RESULT
			Net Result
			#7c3aed
BS sections (in this order):
			section_code
			label
			color
			NCA
			Non-Current Assets
			#57aa78
			CA
			Current Assets
			#0891b2
			EQ
			Equity
			#1a2f8a
			NCL
			Non-Current Liabilities
			#CF305D
			CL
			Current Liabilities
			#d97706
CF sections (in this order):
			section_code
			label
			color
			CF_OP
			Operating Cash Flow
			#57aa78
			CF_INV
			Investing Cash Flow
			#0891b2
			CF_FIN
			Financing Cash Flow
			#1a2f8a
Sub-sections are allowed beyond these, but the codes above must all exist.
### CC tag catalog — use exactly these strings
			cc_tag
			What accounts belong here
			CC_01-Revenue
			Sales of goods/services; net revenue lines
			CC_02-Cost Of Sales
			Purchases, direct materials, direct cost of sales
			CC_03-Other Operating Income
			Subsidies, other operating income, non-core operating income
			CC_05-Lease Expense
			Rent, lease payments (operational and financial)
			CC_06-General and administrative
			Professional services, office supplies, admin costs
			CC_07-Employee Expense
			Wages, salaries, social security, bonuses, personnel benefits
			CC_08-R&D
			Research and development costs
			CC_09-Impairment Gain (Loss) on Fixed Assets
			Impairments, write-downs
			CC_10-Depreciation and Amotization
			Depreciation charge, amortization charge (P&L, not BS contra)
			CC_11-Other Operating Expenses
			Utilities, insurance, transport, other opex catch-all
			CC_13-Interest Income
			Interest income earned
			CC_14-Other financial income
			Dividends received, gains on financial assets
			CC_15-Interest expense
			Interest paid on debt
			CC_16-Other financial expense
			Losses on financial assets, financial fees
			CC_17-Foreign Exchange
			FX gains and losses
			CC_18-Income Tax
			Corporate income tax expense
B/S and CF accounts do NOT get a cc_tag — leave null.
### Placeholder and phantom accounts — mark them but do not fabricate

Some accounts in `group_accounts` are NOT real posting accounts. They are:

- **Placeholders**: names like `TEST`, `Nuevo`, `Nuevo1`, `Nuevo2`, `KON_1`, `KON_2`, `KON_3`, `KON_x`, `Placeholder`, `TBD`, `Provisional`
- **Consolidation adjustments**: names like `Dif. conso`, `Ajuste conso`, `Consolidation diff`, `Elimination`
- **Corrupt/malformed names**: names like `S¤F`, `???`, `-`, single-char names, names containing only symbols
- **Bare codes with no meaning**: names like `999`, single-digit codes without descriptive text

### How to handle each type

1. **Placeholders** (TEST, Nuevo, KON_x, TBD):
   - Include in output rows[] (coverage requirement)
   - Assign to the section their PARENT is in (inherit from parent chain)
   - Set `cc_tag: null` — do NOT guess a tag from the meaningless name
   - `is_sum: false` (unless explicitly a sum in input)

2. **Consolidation adjustments**:
   - Include in rows[] with `cc_tag: null` (they're group-level adjustments, not P&L operating items)
   - Section inherited from parent
   - Do NOT tag them as Revenue/COGS just because the name mentions "sales" or "cost"

3. **Corrupt/malformed names**:
   - Include with `cc_tag: null`
   - Section inherited from parent
   - Note in `meta.notes` if there are many such accounts

4. **Intercompany variants** (e.g. `700000i`, `600000i`, `_i` suffix):
   - Read the semantic root (the parent-level meaning)
   - Assign the SAME cc_tag as their non-intercompany counterpart
   - `700000 Ingresos con terceros` → CC_01-Revenue AND `700000i Ingresos Intercompañía` → CC_01-Revenue
   - Same for costs, employee expenses, etc.

### Phantom accounts (in chart but nobody posts to them)

Some clients have accounts that exist in `group_accounts` but have zero movement across all `entity_samples`. These are typically "roll-up spots" or unused legacy accounts.

- Still include them in rows[] (they may be used in the future)
- Assign section based on their name and parent chain
- Only tag with cc_tag if the name is semantically clear
- Do NOT tag with cc_tag just to hit the 70% coverage floor if the name is ambiguous

### Coverage requirement — CRITICAL
You MUST tag with a cc_tag:
- Minimum 70% of all P/L leaf accounts (non-sum accounts where AccountType='P/L' and IsSumAccount=false)
- If you can't hit 70%, re-read the account names more carefully. Almost every P/L account name describes what it is in plain language.
You MUST place every account in a section:
- Every P/L row → one of REV/COGS/OPEX/OTHER_OP/FIN/TAX/RESULT
- Every B/S row → one of NCA/CA/EQ/NCL/CL
- Every CF row → one of CF_OP/CF_INV/CF_FIN


## Hierarchy vs section — READ CAREFULLY

Not every account belongs to exactly one section. Roll-up accounts that AGGREGATE MULTIPLE sections must NOT be assigned a `section_code`.

### Rule for `section_code` on sum accounts

A sum account (`is_sum: true`) inherits its section from its CHILDREN, not from itself:

- **If all its descendant leaves belong to the SAME section** → assign that section.
  - Example: `A - Total activo circulante` has children like Cash, Receivables, Inventory (all current assets) → `section_code: "CA"`.
- **If its descendant leaves span MULTIPLE sections** → set `section_code: null` and leave `is_sum: true`. The renderer will show it as a top-level total row without a section header.
  - Example: `C - Total de activos` is the roll-up of BOTH `A - Total activo circulante` (CA) AND `B - Total activos no circulantes` (NCA). It spans two BS sections → `section_code: null`.
  - Example: `H - Total de pasivo y capital` is the roll-up of `D - Total de capital` (EQ) AND `G - Total de pasivo` (NCL + CL). It spans equity + liabilities → `section_code: null`.
  - Example (PL): `Resultado del ejercicio` is the roll-up of the entire P&L → `section_code: "RESULT"` (this specific case has a dedicated section).

### How to check

For each sum account, look at its children (`parent_code == this.account_code` in your output). Then look at the children's children, recursively down to leaves. Collect the set of section_codes on those leaves.
- Set size = 1 → assign that section.
- Set size > 1 → set `section_code: null`.
- Set size = 0 (no leaves under it yet) → assign the same section as its own PARENT.

### Common mistakes to avoid

- **Don't** assign the "grand total" of Assets to either NCA or CA. It belongs to neither.
- **Don't** assign the "grand total" of Liabilities+Equity to either EQ, NCL, or CL. It belongs to neither.
- **Don't** put a "Non-Current" bucket under Current Assets just because the name is similar. Always re-check the account name says "no circulante" / "non-current" / "largo plazo" / "long-term" vs "circulante" / "current" / "corto plazo" / "short-term".

## Multilingual reading — the chart of accounts is in ANY language

Konsolidator serves clients across Spain, Denmark, Portugal, Latin America and beyond. Account names in `group_accounts` can be in Spanish, Danish, English, Portuguese, or any other language. Do not assume Spanish. Read each name in its actual language.

### Key equivalents to recognize

**Revenue-side terms:**
- Spanish/LatAm: `Ventas`, `Ingresos`, `Facturación`
- Danish: `Omsætning`, `Salg`, `Indtægter`
- English: `Revenue`, `Sales`, `Income`, `Turnover`
- Portuguese: `Receitas`, `Vendas`, `Faturamento`

**Cost of Sales:**
- Spanish/LatAm: `Coste de ventas`, `Costo de productos vendidos`, `Compras`, `Consumos`
- Danish: `Vareforbrug`, `Kostpris`, `Direkte omkostninger`
- English: `Cost of Sales`, `COGS`, `Cost of Goods Sold`, `Direct Costs`
- Portuguese: `Custo das vendas`, `CMV`

**Employee expenses:**
- Spanish: `Sueldos`, `Salarios`, `Gastos de personal`, `Seguridad social`, `Nómina`
- Danish: `Løn`, `Personaleomkostninger`, `Pensionsomkostninger`
- English: `Wages`, `Salaries`, `Personnel`, `Payroll`, `Benefits`, `Pension`
- Portuguese: `Salários`, `Encargos sociais`

**Depreciation/Amortization:**
- Spanish: `Amortización`, `Depreciación`, `Deterioro`
- Danish: `Afskrivninger`, `Nedskrivninger`
- English: `Depreciation`, `Amortization`, `Impairment`
- Portuguese: `Depreciação`, `Amortização`

**Financial:**
- Spanish: `Intereses`, `Gastos financieros`, `Diferencias de cambio`
- Danish: `Renter`, `Finansielle omkostninger`, `Kursreguleringer`
- English: `Interest`, `Financial expenses`, `FX`, `Exchange differences`
- Portuguese: `Juros`, `Despesas financeiras`, `Câmbio`

**Balance sheet — key hints:**
- "current" / "circulante" / "corto plazo" / "kortfristet" / "corrente" → CA or CL
- "non-current" / "no circulante" / "largo plazo" / "langfristet" / "não corrente" → NCA or NCL
- "equity" / "capital" / "patrimonio" / "egenkapital" / "reservas" / "reserver" → EQ

### Danish special notation

Danish uses characters like `æ`, `ø`, `å`. Reading `Omsætning` (revenue) as "Om..." and skipping doesn't work — you need to recognize the full word regardless of unusual characters.

## Name-reading discipline — DO NOT skim

Before assigning section, READ THE FULL ACCOUNT NAME, not just the first word.

Common naming traps:
- `Total activo circulante` → CA (short-term assets)
- `Total activo NO circulante` → NCA (long-term assets) — the "NO" flips the meaning
- `Deudas a largo plazo` → NCL (long-term debt)
- `Deudas a corto plazo` → CL (short-term debt) — same account family, opposite section
- `Amortización acumulada` → belongs on BS (contra-asset in NCA), NOT on PL as an expense
- `Dotación a la amortización` → belongs on PL (expense line), NOT on BS

Whenever you see "no", "not", "acumulada", "corto", "largo", "diferido" in an account name, PAUSE and re-read the classification.

## BS classification guide — semantic rules (READ CAREFULLY)
The single most common failure on BS classification is defaulting uncertain accounts to NCA. Balance Sheet accounts fall into five buckets — here's how to reason semantically about each.
#### EQ (Equity) — anything representing owner claims
An account belongs to EQ if its name refers to:
- Share capital: Capital, Capital social, Capital emitido, Kapital, Share capital, Aktiekapital
- Retained earnings & reserves: Reservas, Reserva legal, Reserva voluntaria, Retained earnings, Overført resultat
- Current-year result: Resultado del ejercicio, Utilidad del ejercicio, Pérdida del ejercicio, Utilidad/Pérdida Neta, Årets resultat, Net profit for the year
- Share premium: Prima de emisión, Share premium, Overkurs
- Other equity components: Otras aportaciones de socios, Subvenciones de capital, Ajustes por cambio de valor (equity valuation adjustments)
- Foreign currency translation reserves: Ajustes por tipo de cambio, Diferencias de conversión, Reserva de conversión, Foreign exchange reserve, Kursreguleringsreserve — these are equity, NOT assets, even though they touch FX
- Deferred tax booked against equity: Impuesto diferido en Capital, Impuestos diferidos en OCI, Deferred tax on equity
Rule of thumb: if the name contains any of {"Reserva", "Capital", "Prima de emisión", "Resultado del ejercicio", "Utilidad", "Ajustes por tipo de cambio", "Diferencias de conversión", "Overført", "Kapital"} → EQ. No exceptions.
#### NCA (Non-Current Assets) — long-term things the entity OWNS
An account belongs to NCA if it represents an asset with useful life > 1 year:
- Tangible fixed assets and their accumulated depreciation contra: Terrenos, Construcciones, Instalaciones técnicas, Maquinaria, Mobiliario, Amortización acumulada del inmovilizado material
- Intangible assets: Investigación, Desarrollo, Concesiones, Patentes, Fondo de comercio, Aplicaciones informáticas, Amortización acumulada del inmovilizado intangible
- Long-term financial investments: Inversiones financieras a largo plazo, Créditos a largo plazo, Depósitos a largo plazo
- Investment property: Inversiones inmobiliarias
- Deferred tax ASSETS (not equity-side): Activos por impuesto diferido
Depreciation/impairment contra-accounts DO belong here — they reduce gross NCA.
#### CA (Current Assets) — things owned/receivable within 1 year
- Cash and equivalents: Bancos, Caja, Efectivo, Cash at bank, Bankindestående
- Trade receivables: Clientes, Deudores comerciales, Trade debtors, Debitorer
- Inventory: Existencias, Mercaderías, Productos terminados, Materias primas, Lager
- Short-term financial investments: Inversiones financieras a corto plazo
- Other current assets: Anticipos, Gastos anticipados, Cuentas corrientes con UTEs/joint ventures (if short-term)
#### NCL (Non-Current Liabilities) — obligations > 1 year
- Long-term bank debt: Deudas a largo plazo con entidades de crédito, Préstamos bancarios a largo plazo
- Long-term financial leases: Acreedores por arrendamiento financiero a largo plazo
- Provisions long-term: Provisiones a largo plazo, Provisión para pensiones
- Deferred tax LIABILITIES: Pasivos por impuesto diferido
- Long-term intercompany debt: Deudas con empresas del grupo a largo plazo
#### CL (Current Liabilities) — obligations < 1 year
- Trade payables: Proveedores, Acreedores comerciales, Trade creditors, Kreditorer
- Short-term bank debt: Deudas a corto plazo con entidades de crédito
- Tax payables: Hacienda Pública acreedora, IVA a pagar, Retenciones y pagos a cuenta
- Payroll payables: Remuneraciones pendientes de pago, Seguridad Social acreedora
- Short-term intercompany debt: Deudas con empresas del grupo a corto plazo
#### When you can't tell if an account is long-term or short-term
Some account names don't say "a largo plazo" (long-term) or "a corto plazo" (short-term) explicitly. In that case:
- Look at the parent account name or sum account — inherit the term.
- If still unclear, look at the account code position within the input's hierarchy — deeper accounts inherit from their SumAccountCode parent's classification.
- Only default to NCA / NCL when the account is clearly long-term in nature (fixed asset, long-term investment).
- Do NOT default to NCA for equity-adjustment or FX-translation accounts. Those belong to EQ.
### BS sanity check — MANDATORY before output

After classifying all BS accounts, count how many accounts landed in each section. If ANY of these is true, RE-CLASSIFY:
- More than 60% of BS accounts in a single section → suspicious. Real balance sheets distribute roughly ~30% NCA, ~25% CA, ~20% EQ, ~15% NCL, ~10% CL (± sizeable variance). BS lopsidedness > 60% is acceptable ONLY if the client's chart genuinely tracks fixed assets at granular per-asset level (in which case NCA can legitimately exceed 60% AND you must state this explicitly in meta.notes with count of fixed-asset sub-accounts). If lopsidedness is due to unclear/uncertain accounts defaulted to NCA → GO BACK AND RE-READ NAMES, especially checking for equity-side accounts (Reservas, Capital, Ajustes por tipo de cambio, Utilidad del ejercicio, Diferencias de conversión, Impuesto diferido en Capital) which MUST go to EQ. BS lopsidedness > 60% is acceptable ONLY if the client's chart genuinely tracks fixed assets at granular per-asset level (in which case NCA can legitimately exceed 60% AND you must state this explicitly in meta.notes with count of fixed-asset sub-accounts). If lopsidedness is due to unclear/uncertain accounts defaulted to NCA → GO BACK AND RE-READ NAMES, especially checking for equity-side accounts (Reservas, Capital, Ajustes por tipo de cambio, Utilidad del ejercicio, Diferencias de conversión, Impuesto diferido en Capital) which MUST go to EQ.
- Zero accounts in any of NCA, CA, EQ, NCL, CL → wrong, virtually every group has all five
If the distribution looks off, the most likely error is that you defaulted uncertain accounts to NCA — go back and re-read those names.
### PL sanity check — MANDATORY before output
After classifying, count P/L accounts per cc_tag. If ANY of these is true, RE-CLASSIFY:
- Fewer than 3 accounts tagged CC_01-Revenue → suspicious for any real business. Revenue lines multiply because clients track by product line, region, entity type. Look harder.
- More than 60% of P/L leaves untagged → you're being too conservative. Almost every P&L account has a semantic home.
- Zero accounts in CC_02-Cost Of Sales for a client whose entity samples show high COGS-like activity → wrong.

### Hierarchy rules
- Preserve parent/child structure from group_accounts.SumAccountCode → your parent_code
- Every non-root account MUST have a parent_code that also exists as another account_code for the same statement, OR be null (a section root)
- is_sum: true for roll-up accounts (mirrors input's IsSumAccount)
- level = depth in tree

### Sort order — CRITICAL
`sort_order` MUST follow the NARRATIVE reading order of a financial statement, NOT the hierarchical order of the source chart of accounts.

Rows are sorted GLOBALLY across the statement. The FIRST section reads first, the LAST section reads last. Within each section, rows appear in a logical top-down order.

**For P/L rows, narrative order is:**

1. REV (Revenue) → sort_order 100–199
2. COGS (Cost of Sales) → sort_order 200–299
3. OPEX (Operating Expenses) → sort_order 300–399
4. OTHER_OP (Other Operating) → sort_order 400–499
5. FIN (Financial Result) → sort_order 500–599
6. TAX (Income Tax) → sort_order 600–699
7. RESULT (Net Result and grand totals) → sort_order 700–799

Grand totals (`Utilidad/Pérdida del año`, `Net income`, `EBIT`, `EBITDA`, `Result before tax`) belong in RESULT at the END, not at the beginning — even though they sit at the TOP of the hierarchy tree in the source data.

**For B/S rows, narrative order is:**

1. NCA (Non-Current Assets) → sort_order 100–199
2. CA (Current Assets) → sort_order 200–299
3. EQ (Equity) → sort_order 300–399
4. NCL (Non-Current Liabilities) → sort_order 400–499
5. CL (Current Liabilities) → sort_order 500–599

### Grand totals with `section_code: null` — sort_order rules

Grand totals like `Total activos`, `Total pasivo y capital`, `Total equity and liabilities` must get sort_order matching the family they **OPEN**, not close.

- `Total activos` OPENS the Assets family (NCA + CA) → sort_order **at the very start of the NCA range**, e.g. `100` or lower (like `50` if you want it clearly first).
- `Total pasivo y capital` OPENS the Equity+Liabilities family (EQ + NCL + CL) → sort_order **at the very start of the EQ range**, e.g. `300` or slightly below (like `299`).

**Do NOT put grand totals between two sections.** Common mistake:
- ❌ `Total pasivo y capital` with sort_order `250798` (between CA and EQ) — makes it render inside the Assets block visually
- ✅ `Total pasivo y capital` with sort_order `299` — renders at the start of the Equity+Liabilities block

### Verification

After sorting BS rows by sort_order and reading top-to-bottom, the sequence must be:
1. `Total activos` (grand total, section=null)
2. All NCA rows
3. All CA rows
4. `Total pasivo y capital` (grand total, section=null)
5. All EQ rows
6. All NCL rows
7. All CL rows

If `Total pasivo y capital` appears BEFORE all CA rows are done, its sort_order is too low. Renumber.

**For CF rows, narrative order is:**

1. CF_OP (Operating) → sort_order 100–199
2. CF_INV (Investing) → sort_order 200–299
3. CF_FIN (Financing) → sort_order 300–399

### Common mistake to avoid

Do NOT number sort_order by following the hierarchy top-down (root → leaves). Roots of P/L trees are usually Net Result which reads LAST. Number by section narrative position first, then top-down WITHIN each section.

### How to verify

After assigning sort_order, sort your rows by sort_order and read them from top to bottom. It must read like a normal P&L statement:
- First: Revenue lines
- Then: Cost of Sales lines
- Then: OpEx lines
- ... etc ...
- Last: Net Result and grand totals

If the first row when sorted by sort_order says "Net Result" or "Utilidad del año", you've sorted backwards. Renumber.
### Output — this exact schema, no deviations
```{
  "meta": {
    "kind": "konsolidator_client_standard",
    "version": 1,
    "client_id": "<COPY FROM INPUT meta.client_id>",
    "standard_key": "CUSTOM-<client_slug from input meta.client_slug>",
    "based_on_standard": "PGC" | "DanishIFRS" | "SpanishIFRS-ES",
    "generated_by": "claude",
    "generated_at": "<ISO 8601 timestamp>",
    "notes": "<1-2 sentence rationale + note any deviations from the base standard>"
  },
  "sections": [
    {
      "statement": "PL" | "BS" | "CF",
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
      "statement": "PL" | "BS" | "CF",
      "account_code": "700000",
      "account_name": "Ventas de mercadería",
      "account_name_en": "Merchandise sales",
      "account_name_da": null,
      "account_name_es": "Ventas de mercadería",
      "parent_code": "A.01.A",
      "section_code": "REV",
      "cc_tag": "CC_01-Revenue",
      "is_sum": false,
      "sort_order": 10,
      "level": 3,
      "show_in_summary": true
    }
  ],
  "kpi_overrides": []
}
```
### Validation the import will run — reject if any of these fail
- meta.kind == "konsolidator_client_standard" (exact string)
- meta.client_id matches the input export
- meta.standard_key starts with CUSTOM-
- All required sections present
- Every row.statement is PL/BS/CF
- Every row.section_code exists in sections[] for the same statement
- Every non-null row.parent_code exists as another row's account_code in the same statement
- Every non-null row.cc_tag is from the catalog
- No duplicate (statement, account_code) pairs
### Warnings the import will surface (not blocking, but visible to the reviewer)
- Fewer than 70% of P/L leaves have a cc_tag
- BS distribution shows > 60% in one section
- Fewer than 3 accounts tagged as CC_01-Revenue
If any of these warnings would apply to your output, GO BACK AND FIX before outputting.
### Coverage requirement — completeness
Every P/L and B/S account in the input group_accounts (regardless of IsSumAccount) MUST appear in your output rows. Sum accounts get is_sum: true; leaves get is_sum: false. CF section is generated by you — populate with representative CF line items appropriate to the base standard.
#### Final check before you output — walk through this checklist

- [ ] Every group_accounts row is represented in output rows[]
- [ ] Every section_code referenced by rows exists in sections[]
- [ ] Every parent_code exists as another row's account_code in the same statement
- [ ] Every cc_tag is from the catalog
- [ ] No duplicate (statement, account_code) pairs
- [ ] BS distribution is either <60% max share, OR the concentration is legitimate (fixed-asset register) and explained in meta.notes
- [ ] No equity-side accounts (Reservas, Capital, Resultado del ejercicio, Ajustes por tipo de cambio, Utilidad/Pérdida Neta, Impuesto diferido en Capital) are misclassified as NCA
- [ ] At least 70% of P/L leaves have a cc_tag
- [ ] At least 3 accounts tagged CC_01-Revenue
- [ ] Every sum account's section_code was validated against its descendant leaves — if leaves span multiple sections, section_code is null
- [ ] No account named "Total de activos" or similar grand asset total is inside NCA or CA (should have section_code: null)
- [ ] No account named "Total de pasivo y capital" or similar grand total is inside EQ (should be null)
- [ ] All accounts with "no circulante" / "non-current" / "largo plazo" / "long-term" / "langfristet" in their names are in NCA, not CA
- [ ] All accounts with "circulante" (without "no") / "current" / "corto plazo" / "kortfristet" in their names are in CA, not NCA
- [ ] After sorting rows by sort_order, the first row is Revenue-related (not Net Result)
- [ ] Grand totals like "Utilidad del año" / "Net income" appear at the END of the P/L in sort_order (RESULT section, 700+)
- [ ] BS grand totals appear at the START of the family they open: "Total activos" at sort_order <100 (opens Assets), "Total pasivo y capital" at sort_order ~299 (opens Equity+Liabilities)
- [ ] Reading BS rows sorted by sort_order gives: Total activos → all NCA → all CA → Total pasivo y capital → all EQ → all NCL → all CL (no grand total wedged between sections)
- [ ] Placeholder accounts (TEST, Nuevo, KON_x, TBD, corrupt names) have cc_tag: null (not guessed based on name)
- [ ] Intercompany variants (700000i, 600000i, etc.) carry the SAME cc_tag as their non-intercompany counterpart
- [ ] Every account name was read semantically in its ACTUAL language (Spanish, Danish, English, Portuguese) — no skimming
- [ ] JSON is valid and parseable

Output ONLY the JSON. No preamble, no markdown fences, no commentary. Start with `{` and end with `}`.

- [ ] Every group_accounts row is represented in output rows[]
- [ ] Every section_code referenced by rows exists in sections[]
- [ ] Every parent_code exists as another row's account_code in the same statement
- [ ] Every cc_tag is from the catalog
- [ ] No duplicate (statement, account_code) pairs
- [ ] BS distribution is either <60% max share, OR the concentration is legitimate (fixed-asset register) and explained in meta.notes
- [ ] No equity-side accounts (Reservas, Capital, Resultado del ejercicio, Ajustes por tipo de cambio, Utilidad/Pérdida Neta, Impuesto diferido en Capital) are misclassified as NCA
- [ ] At least 70% of P/L leaves have a cc_tag
- [ ] At least 3 accounts tagged CC_01-Revenue
- [ ] Every sum account's section_code was validated against its descendant leaves — if leaves span multiple sections, section_code is null
- [ ] No account named "Total de activos" or similar grand asset total is inside NCA or CA (should have section_code: null)
- [ ] No account named "Total de pasivo y capital" or similar grand total is inside EQ (should be null)
- [ ] All accounts with "no circulante" / "non-current" / "largo plazo" / "long-term" in their names are in NCA, not CA
- [ ] All accounts with "circulante" (without "no") / "current" / "corto plazo" in their names are in CA, not NCA
- [ ] After sorting rows by sort_order, the first row is Revenue-related (not Net Result)
- [ ] Grand totals like "Utilidad del año" / "Net income" / "Total activos" appear at the END of their statement in sort_order, not the beginning
- [ ] JSON is valid and parseable

Output ONLY the JSON. No preamble, no markdown fences, no commentary. Start with `{` and end with `}`.