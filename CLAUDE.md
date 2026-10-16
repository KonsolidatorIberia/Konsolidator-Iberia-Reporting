# Konsolidator Report (konsolidator-dashboard)

React 19 + Vite 6 + Tailwind + CSS Modules. Datos de la API v2 de Konsolidator (proxy `/v2`) y de Supabase
(proyecto gmcawsapzkzmgrtiqebv; esquemas `accounts`, `public`, `ledger`). Se publica en Vercel desde `main`.

- Responde en español.
- Se pueden crear archivos nuevos, pero pregunta siempre antes de hacerlo.
- Comprueba con `npx eslint <carpeta>` y `npx vite build` antes de dar algo por terminado.
- Idioma de la app: usa `useLocale()` (resuelve "auto"), nunca `settings.locale`. Los textos van en es / en / da / pt
  (portugués de Portugal, trato formal).
- Migraciones SQL en `supabase/sql/` (001, 002…), se ejecutan a mano en el SQL Editor de Supabase. El esquema
  `ledger` tiene RLS en todas las tablas y los cambios con fecha van por funciones (`record_ownership`, `set_node`…).
- Planes de cliente (`accounts.companies.tier`): low, base, pro, max. Pro y Max usan las estructuras propias
  (`src/pages/structure/studio/`).
- No subas secretos: el token personal de Supabase solo va en los secrets de las Edge Functions.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
- Pregunta al grafo en inglés o con nombres del código (`StructureStudio`, `loadPerimeter`…): en español
  las coincidencias son peores.
- Si `graphify` no se encuentra: `export PATH="$HOME/.local/bin:$PATH"`.
