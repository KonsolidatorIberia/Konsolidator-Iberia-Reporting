/* ══════════════════════════════════════════════════════════════════════
   Estructura del grupo — utilidades compartidas: textos nuevos (es / en /
   da / pt), lectura de la API, colores por moneda y participación, nodos
   del organigrama y su disposición.
   ══════════════════════════════════════════════════════════════════════ */
import { useLocale } from "../../components/layout/SettingsContext.jsx";

/* ── Textos nuevos (los de siempre siguen viniendo de i18n: st_*) ───── */
const TX = {
  es: {
    inTree: "en el organigrama", structure: "Estructura",
    group: "Grupo", parent: "Matriz", levels: (n) => `${n} ${n === 1 ? "nivel" : "niveles"}`,
    companies: (n) => `${n} ${n === 1 ? "empresa" : "empresas"}`, consolidatedN: (n) => `${n} consolidadas`,
    avgOwnership: "participación media", currencies: (n) => `${n} ${n === 1 ? "moneda" : "monedas"}`,
    detachedN: (n) => `${n} ${n === 1 ? "desvinculada" : "desvinculadas"}`, allLinked: "Todas enlazadas",
    zoomIn: "Acercar", zoomOut: "Alejar", fit: "Encajar en pantalla", vertical: "Vertical", horizontal: "Horizontal",
    expandAll: "Desplegar todo", collapseAll: "Plegar todo", find: "Buscar empresa", noMatches: "Ninguna empresa coincide",
    legend: "Leyenda", notConsolidated: "No consolidada", detached: "Desvinculada", ownershipHigh: "80 % o más",
    ownershipMid: "50–80 %", ownershipLow: "Menos del 50 %", path: "Ruta en el grupo", subsidiaries: "Filiales directas",
    noSubsidiaries: "Sin filiales", today: "hoy", hidden: (n) => `${n} ocultas`, showChildren: "Mostrar filiales",
    hideChildren: "Ocultar filiales", all: "Todas", consolidated: "Consolidadas", notConsolidatedF: "No consolidadas",
    showing: (a, b) => `${a} de ${b}`, openInTree: "Ver en el organigrama", parentCol: "Matriz", level: "Nivel",
    closedLegend: "Cerrado", openLegend: "Abierto", partialLegend: "Parcialmente abierto", emptyLegend: "Sin periodo",
    lastClosed: "Último cierre", none: "Ninguno", coverage: "Meses con periodo", openNow: "Abiertos ahora",
    closedOf: (a, b) => `${a}/${b} cerrados`, dragHint: "Arrastra para moverte · Ctrl + rueda para el zoom",
    loadSteps: { gs: "Estructura", co: "Empresas", ow: "Participaciones", pe: "Periodos" },
    loadTitle: "Cargando la estructura del grupo", errorTitle: "No se ha podido cargar la estructura del grupo",
    errorHint: "Comprueba la conexión y vuelve a intentarlo.", retry: "Reintentar", minimap: "Mapa",
    sortBy: "Ordenar por", ownershipFrom: "desde", untilWord: "hasta",
  },
  en: {
    inTree: "in the chart", structure: "Structure",
    group: "Group", parent: "Parent", levels: (n) => `${n} ${n === 1 ? "level" : "levels"}`,
    companies: (n) => `${n} ${n === 1 ? "company" : "companies"}`, consolidatedN: (n) => `${n} consolidated`,
    avgOwnership: "average ownership", currencies: (n) => `${n} ${n === 1 ? "currency" : "currencies"}`,
    detachedN: (n) => `${n} detached`, allLinked: "All linked",
    zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to screen", vertical: "Vertical", horizontal: "Horizontal",
    expandAll: "Expand all", collapseAll: "Collapse all", find: "Find a company", noMatches: "No company matches",
    legend: "Legend", notConsolidated: "Not consolidated", detached: "Detached", ownershipHigh: "80% or more",
    ownershipMid: "50–80%", ownershipLow: "Under 50%", path: "Path in the group", subsidiaries: "Direct subsidiaries",
    noSubsidiaries: "No subsidiaries", today: "today", hidden: (n) => `${n} hidden`, showChildren: "Show subsidiaries",
    hideChildren: "Hide subsidiaries", all: "All", consolidated: "Consolidated", notConsolidatedF: "Not consolidated",
    showing: (a, b) => `${a} of ${b}`, openInTree: "Show in org chart", parentCol: "Parent", level: "Level",
    closedLegend: "Closed", openLegend: "Open", partialLegend: "Partly open", emptyLegend: "No period",
    lastClosed: "Last close", none: "None", coverage: "Months with a period", openNow: "Open now",
    closedOf: (a, b) => `${a}/${b} closed`, dragHint: "Drag to move · Ctrl + wheel to zoom",
    loadSteps: { gs: "Structure", co: "Companies", ow: "Ownership", pe: "Periods" },
    loadTitle: "Loading the group structure", errorTitle: "Couldn't load the group structure",
    errorHint: "Check the connection and try again.", retry: "Try again", minimap: "Map",
    sortBy: "Sort by", ownershipFrom: "from", untilWord: "until",
  },
  da: {
    inTree: "i diagrammet", structure: "Struktur",
    group: "Koncern", parent: "Moderselskab", levels: (n) => `${n} ${n === 1 ? "niveau" : "niveauer"}`,
    companies: (n) => `${n} ${n === 1 ? "selskab" : "selskaber"}`, consolidatedN: (n) => `${n} konsolideret`,
    avgOwnership: "gns. ejerandel", currencies: (n) => `${n} ${n === 1 ? "valuta" : "valutaer"}`,
    detachedN: (n) => `${n} frakoblet`, allLinked: "Alle forbundet",
    zoomIn: "Zoom ind", zoomOut: "Zoom ud", fit: "Tilpas til skærmen", vertical: "Lodret", horizontal: "Vandret",
    expandAll: "Fold alt ud", collapseAll: "Fold alt sammen", find: "Find selskab", noMatches: "Intet selskab matcher",
    legend: "Forklaring", notConsolidated: "Ikke konsolideret", detached: "Frakoblet", ownershipHigh: "80 % eller mere",
    ownershipMid: "50–80 %", ownershipLow: "Under 50 %", path: "Sti i koncernen", subsidiaries: "Direkte datterselskaber",
    noSubsidiaries: "Ingen datterselskaber", today: "i dag", hidden: (n) => `${n} skjult`, showChildren: "Vis datterselskaber",
    hideChildren: "Skjul datterselskaber", all: "Alle", consolidated: "Konsolideret", notConsolidatedF: "Ikke konsolideret",
    showing: (a, b) => `${a} af ${b}`, openInTree: "Vis i organisationen", parentCol: "Moderselskab", level: "Niveau",
    closedLegend: "Lukket", openLegend: "Åben", partialLegend: "Delvist åben", emptyLegend: "Ingen periode",
    lastClosed: "Seneste lukning", none: "Ingen", coverage: "Måneder med periode", openNow: "Åbne nu",
    closedOf: (a, b) => `${a}/${b} lukket`, dragHint: "Træk for at flytte · Ctrl + hjul for zoom",
    loadSteps: { gs: "Struktur", co: "Selskaber", ow: "Ejerandele", pe: "Perioder" },
    loadTitle: "Indlæser koncernstrukturen", errorTitle: "Koncernstrukturen kunne ikke indlæses",
    errorHint: "Tjek forbindelsen og prøv igen.", retry: "Prøv igen", minimap: "Kort",
    sortBy: "Sortér efter", ownershipFrom: "fra", untilWord: "til",
  },
  pt: {
    inTree: "no organograma", structure: "Estrutura",
    group: "Grupo", parent: "Empresa-mãe", levels: (n) => `${n} ${n === 1 ? "nível" : "níveis"}`,
    companies: (n) => `${n} ${n === 1 ? "empresa" : "empresas"}`, consolidatedN: (n) => `${n} consolidadas`,
    avgOwnership: "participação média", currencies: (n) => `${n} ${n === 1 ? "moeda" : "moedas"}`,
    detachedN: (n) => `${n} desvinculadas`, allLinked: "Todas ligadas",
    zoomIn: "Aproximar", zoomOut: "Afastar", fit: "Ajustar ao ecrã", vertical: "Vertical", horizontal: "Horizontal",
    expandAll: "Expandir tudo", collapseAll: "Recolher tudo", find: "Procurar empresa", noMatches: "Nenhuma empresa coincide",
    legend: "Legenda", notConsolidated: "Não consolidada", detached: "Desvinculada", ownershipHigh: "80 % ou mais",
    ownershipMid: "50–80 %", ownershipLow: "Menos de 50 %", path: "Caminho no grupo", subsidiaries: "Filiais diretas",
    noSubsidiaries: "Sem filiais", today: "hoje", hidden: (n) => `${n} ocultas`, showChildren: "Mostrar filiais",
    hideChildren: "Ocultar filiais", all: "Todas", consolidated: "Consolidadas", notConsolidatedF: "Não consolidadas",
    showing: (a, b) => `${a} de ${b}`, openInTree: "Ver no organograma", parentCol: "Empresa-mãe", level: "Nível",
    closedLegend: "Fechado", openLegend: "Aberto", partialLegend: "Parcialmente aberto", emptyLegend: "Sem período",
    lastClosed: "Último fecho", none: "Nenhum", coverage: "Meses com período", openNow: "Abertos agora",
    closedOf: (a, b) => `${a}/${b} fechados`, dragHint: "Arraste para mover · Ctrl + roda para o zoom",
    loadSteps: { gs: "Estrutura", co: "Empresas", ow: "Participações", pe: "Períodos" },
    loadTitle: "A carregar a estrutura do grupo", errorTitle: "Não foi possível carregar a estrutura do grupo",
    errorHint: "Verifique a ligação e tente de novo.", retry: "Tentar de novo", minimap: "Mapa",
    sortBy: "Ordenar por", ownershipFrom: "desde", untilWord: "até",
  },
};
export function useStText() {
  const locale = useLocale();
  return TX[locale] ?? TX[String(locale ?? "").slice(0, 2)] ?? TX.en;
}

/* ── API ──────────────────────────────────────────────────────────────── */
const BASE = "";
function norm(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj)) out[k.charAt(0).toLowerCase() + k.slice(1)] = obj[k];
  return out;
}
const normArr = (arr) => (Array.isArray(arr) ? arr.map(norm) : []);

// Si la API responde 429 (demasiadas peticiones a la vez) o un error
// temporal, se reintenta con espera creciente en lugar de fallar.
export async function apiFetch(path, token, signal) {
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
      signal,
    });
    if (res.ok || ![429, 502, 503, 504].includes(res.status)) break;
    const retryAfter = Number(res.headers.get("Retry-After"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * (attempt + 1);
    await new Promise(r => setTimeout(r, wait));
    if (signal?.aborted) throw new Error("aborted");
  }
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  return normArr(json.value ?? (Array.isArray(json) ? json : [json]));
}

/* ── Formato y color ──────────────────────────────────────────────────── */
export const MONTHS_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const monthFull = (t, idx) => t(`month_${MONTHS_KEYS[idx] ?? "jan"}`);
export const monthAbbr = (t, idx) => t(`month_abbr_${MONTHS_KEYS[idx] ?? "jan"}`);
export const fmtPct = (n, d = 1) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(n || 0);

// Cada moneda tiene su color: se reconoce de un vistazo qué sociedades
// reportan en la misma divisa.
const CCY_COLORS = {
  EUR: "#2440a8", USD: "#0f8a62", GBP: "#7c3aed", CNY: "#c2410c", VND: "#0e7490",
  MAD: "#b45309", CHF: "#be123c", DKK: "#9d174d", SEK: "#1d4ed8", NOK: "#0369a1",
  PLN: "#4d7c0f", MXN: "#15803d", BRL: "#047857", JPY: "#a21caf",
};
const FALLBACK = ["#475569", "#6d28d9", "#0f766e", "#b91c1c", "#a16207", "#1e40af"];
export function ccyColor(c) {
  if (!c) return "#64748b";
  if (CCY_COLORS[c]) return CCY_COLORS[c];
  let h = 0;
  for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
export const OWN = { high: "#0f9f6e", mid: "#d97706", low: "#e11d48" };
export const ownColor = (pct) => (pct >= 80 ? OWN.high : pct >= 50 ? OWN.mid : OWN.low);
export const initials = (s) => String(s || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";

/* ── Nodos ────────────────────────────────────────────────────────────── */
export function buildNodes(groupStructure, structKey, companies, ownership) {
  const coBy = new Map(companies.map(c => [c.companyShortName, c]));
  const owBy = new Map(ownership.map(o => [o.companyShortName, o]));
  return groupStructure.filter(r => r.groupStructure === structKey).map(r => {
    const co = coBy.get(r.companyShortName);
    const ow = owBy.get(r.companyShortName);
    return {
      id: r.companyShortName,
      label: r.companyLegalName || co?.companyLegalName || r.companyShortName,
      parent: r.parentShortName || null,
      detached: !!r.detached,
      currency: r.currencyCode || co?.currencyCode || "",
      type: co?.recognizeAs || co?.type || "Subsidiary",
      ownership: ow?.ownershipPercentage || 0,
      consolidate: co?.consolidate ?? true,
    };
  });
}

// Hijos por nodo, raíces y profundidad (solo nodos enlazados)
export function treeIndex(nodes) {
  const ids = new Set(nodes.map(n => n.id));
  const kids = new Map(nodes.map(n => [n.id, []]));
  nodes.forEach(n => { if (n.parent && ids.has(n.parent) && n.parent !== n.id) kids.get(n.parent).push(n.id); });
  const roots = nodes.filter(n => !n.parent || !ids.has(n.parent) || n.parent === n.id).map(n => n.id);
  const depth = new Map();
  const parentOf = new Map(nodes.map(n => [n.id, n.parent && ids.has(n.parent) ? n.parent : null]));
  const walk = (id, d, seen) => {
    if (seen.has(id)) return;
    seen.add(id);
    depth.set(id, d);
    kids.get(id).forEach(c => walk(c, d + 1, seen));
  };
  const seen = new Set();
  roots.forEach(r => walk(r, 0, seen));
  return { kids, roots, depth, parentOf };
}

/* ── Disposición del organigrama (árbol ordenado, Reingold–Tilford) ─────
   Vertical: las filiales debajo de su matriz. Horizontal: a su derecha.
   Las ramas plegadas no ocupan sitio. */
export const NODE_W = 212, NODE_H = 78;
export function computeLayout(nodes, idx, collapsed, orient) {
  const vert = orient !== "h";
  const breadth = vert ? NODE_W : NODE_H;           // tamaño a lo ancho de un nivel
  const gap = vert ? 30 : 16;                         // separación entre hermanos
  const step = vert ? NODE_H + 70 : NODE_W + 84;      // distancia entre niveles
  const size = new Map();
  const visibleKids = (id) => (collapsed.has(id) ? [] : idx.kids.get(id) ?? []);
  const calc = (id, guard) => {
    if (guard.has(id)) return breadth;
    guard.add(id);
    const k = visibleKids(id);
    const w = k.length ? Math.max(breadth, k.reduce((s, c) => s + calc(c, guard), 0) + gap * (k.length - 1)) : breadth;
    size.set(id, w);
    return w;
  };
  const guard = new Set();
  idx.roots.forEach(r => calc(r, guard));
  const pos = {};
  const place = (id, start, d, seen) => {
    if (seen.has(id)) return;
    seen.add(id);
    const b = start + ((size.get(id) ?? breadth) - breadth) / 2;
    pos[id] = vert ? { x: b, y: d * step } : { x: d * step, y: b };
    let cur = start;
    visibleKids(id).forEach(c => { place(c, cur, d + 1, seen); cur += (size.get(c) ?? breadth) + gap; });
  };
  let start = 0;
  const seen = new Set();
  idx.roots.forEach(r => { place(r, start, 0, seen); start += (size.get(r) ?? breadth) + gap * 3; });
  return pos;
}