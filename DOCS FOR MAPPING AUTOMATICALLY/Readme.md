# Konsolidator Onboarding Documentation

## The three files that matter

### 1. `CLIENT-ONBOARDING.md`
The playbook — step-by-step process from export to import. Start here.

### 2. `onboarding-prompt.md`
The prompt template — paste into a fresh Claude chat with the export file to generate a client's custom standard.

### 3. `VALIDATE-STANDARD.md`
The validator prompt — paste into a fresh Claude chat with the export AND the generated standard to verify it's correct before importing.

## The end-to-end flow

```
1. EXPORT      → Admin Onboarding page → Export button → save JSON
2. GENERATE    → Fresh Claude chat + onboarding-prompt.md + export JSON → save standard JSON
3. VALIDATE    → Fresh Claude chat + VALIDATE-STANDARD.md + both JSONs → read report
4. IMPORT      → Admin Onboarding page → Import button → drop standard JSON → Apply
5. VERIFY      → Hard reload → check HomePage shows correct values + header shows CUSTOM-<slug>
```

## When it fails

- **Generate fails** → Claude drifts from schema, produces invalid JSON, or misclassifies accounts. Tighten `onboarding-prompt.md` with a new rule.
- **Validate fails hard checks** → tell Claude in the same chat: "Fix these hard errors: <paste list>. Return corrected JSON only."
- **Validate warns** → decide case-by-case. Warnings are OK if `meta.notes` explains them (e.g. granular fixed-asset register).
- **Import fails** → app-side validator caught something the Claude validator missed. Update BOTH validators to catch it next time.
- **Values wrong after import** → cc_tag mapping issue. Compare untagged accounts against Konsolidator's actual chart, generate a correction JSON, re-import.