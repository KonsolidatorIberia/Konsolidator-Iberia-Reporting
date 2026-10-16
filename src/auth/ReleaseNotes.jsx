import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, ChevronLeft, X, Check, Zap, Rows3, Layers, Presentation, BookOpen, Sparkles,
  Eye, ChevronRight, MoveHorizontal, GripVertical, Route, CalendarDays, SlidersHorizontal,
  Share2, Download, Link2, ListChecks, FileText, FileSpreadsheet, File,
  Palette, CalendarRange, Building2, Gauge, Network, UserCog,
} from "lucide-react";

/* ════════════════════════════════════════════════════════════════
   Novedades de la versión 1.1
   · <ReleaseBadge>: insignia "v1.1 · Novedades" de la cabecera del
     login, con un "ping" hasta que el usuario abre las novedades.
   · <ReleaseNotes>: escaparate modal de 13 páginas con viñetas
     animadas (CSS/SVG puro) que imitan la interfaz real. La portada
     es además un índice: cada novedad lleva a su página.
   Mismo enfoque que Login.jsx: CSS en una cadena inyectada con
   <style>, prefijos propios (rb* / rn*) y las mismas curvas.
   ════════════════════════════════════════════════════════════════ */

export const RELEASE_VERSION = "1.1";
export const RELEASE_SEEN_KEY = "konsolidator:seen-release-1.1";

// localStorage puede no existir o lanzar (modo privado, cookies bloqueadas…)
export function hasSeenRelease() {
  try { return window.localStorage.getItem(RELEASE_SEEN_KEY) === "1"; } catch { return false; }
}
export function markReleaseSeen() {
  try { window.localStorage.setItem(RELEASE_SEEN_KEY, "1"); } catch { /* sin persistencia: el ping volverá a salir */ }
}

/* ── Textos (es, en, da, pt; en como alternativa para otros idiomas) ── */
const TEXT = {
  es: {
    badgeVer: "v1.1",
    badgeLabel: "Novedades",
    badgeAria: "Ver las novedades de la versión 1.1",
    badgeTip: "12 novedades · Diseño, multiperiodo, KPIs, estructura…",
    dialog: "Novedades de Konsolidator Report 1.1",
    prev: "Anterior", next: "Siguiente", start: "Empezar", close: "Cerrar",
    goTo: "Ir a la página {n}: {t}", pageOf: "Página {n} de {total}: {t}",
    indexLabel: "Qué hay en esta versión",
    pages: {
      intro: {
        eyebrow: "Versión 1.1", tag: null,
        title: "Konsolidator Report 1.1",
        desc: "Más rápida, con un mismo diseño en todas las páginas y herramientas nuevas para analizar, presentar y decidir quién ve qué. Elige por dónde empezar o recórrela entera.",
        short: "Inicio",
      },
      perf: {
        eyebrow: "Rendimiento", tag: "Más rápido", short: "Rendimiento",
        title: "Más rápido desde el primer clic",
        desc: "Mientras inicias sesión, la pantalla de carga ya va trayendo tus datos. Al entrar, cada página se abre sobre información que ya está cargada.",
        bullets: [
          "Precarga de datos durante la pantalla de carga",
          "Las páginas se abren con los datos ya listos",
          "Menos peticiones, y más ligeras: el contributivo encuentra el último periodo con datos sin sondear mes a mes",
          "Si la API va saturada se reintenta sola; los KPI y las dimensiones ya no aparecen a 0 en la primera carga",
        ],
      },
      look: {
        eyebrow: "Diseño", tag: "Renovado", short: "Diseño común",
        title: "Un mismo diseño en todas las páginas",
        desc: "Individuales, Dimensiones, KPIs, Cash flow, Contributivo y la Sábana hablan ahora el mismo idioma visual, con el mismo cargador.",
        bullets: [
          "Un único cargador con el progreso real y sus fases, que sigue sin saltos desde que abres la página",
          "Separadores de sección animados, filas que reaccionan al ratón e importes en píldora",
          "La comparación con otro periodo se abre y se cierra con una animación continua; las desviaciones salen en verde o en rojo",
          "Mientras llega el periodo de comparación, sus celdas brillan en vez de mostrar diferencias contra cero",
        ],
      },
      multi: {
        eyebrow: "Multiperiodo", tag: "Nuevo", short: "Varios periodos",
        title: "Varios meses a la vez, sumados",
        desc: "En Individuales, Dimensiones y Cash flow eliges varios meses, incluso de años distintos, y los ves como un único periodo.",
        bullets: [
          "Meses sueltos o años enteros, desde el selector de mes",
          "Cada tramo se calcula con los cierres de sus extremos: solo se piden los datos necesarios",
          "Una etiqueta junto a la tabla dice exactamente qué se está sumando",
          "En Dimensiones, el desglose por empresa suma la misma selección",
        ],
      },
      indiv: {
        eyebrow: "Individuales", tag: "Nuevo", short: "Individuales",
        title: "Histórico, varias empresas y hasta tres comparativas",
        desc: "Los estados individuales ganan tres formas nuevas de mirar los datos sin salir de la tabla.",
        bullets: [
          "Histórico: pulsa la cabecera y la tabla se despliega mes a mes",
          "Multiempresa: elige varias sociedades y míralas columna a columna",
          "Compara con hasta tres periodos (B, C y D) a la vez",
          "La columna de cuentas no salta al abrir o cerrar ninguna de estas vistas",
        ],
      },
      dims: {
        eyebrow: "Dimensiones", tag: "Renovado", short: "Dimensiones",
        title: "Dimensiones, con el desglose por empresa",
        desc: "Las dimensiones individual y consolidada estrenan el nuevo diseño y una forma rápida de ver qué sociedad aporta cada importe.",
        bullets: [
          "Despliega cualquier cuenta por empresa, con su razón social y su color",
          "Comparativo con otro periodo, animado como en el resto de páginas",
          "Multiperiodo: suma varios meses también por dimensión",
        ],
      },
      kpis: {
        eyebrow: "KPIs", tag: "Nuevo", short: "KPIs",
        title: "KPIs: biblioteca, asistente y gráficos",
        desc: "Indicadores listos para usar, un asistente para crear los tuyos y una vista de gráficos para seguir su evolución.",
        bullets: [
          "KPIs predefinidos por familia que se conectan solos a tus cuentas y enseñan su valor antes de añadirlos",
          "Si falta una cuenta, el KPI te lleva a configurarla en vez de añadirse vacío",
          "Asistente en tres pasos: identidad, fórmula con letras (A ÷ B) y reglas con benchmarks y variaciones por empresa o dimensión",
          "Gráficos de evolución con la tabla de datos al lado, por mes o por año, y comparación entre periodos",
        ],
      },
      cf: {
        eyebrow: "Cash flow", tag: "Optimizado", short: "Cash flow",
        title: "Cash flow fluido, aunque lo despliegues entero",
        desc: "La tabla de cash flow individual está virtualizada: solo se pintan las filas visibles, así que un estado desplegado con miles de filas se desplaza con suavidad.",
        bullets: [
          "Columna de cuentas redimensionable, y recuerda su ancho",
          "Arrastra las columnas de sociedades para reordenarlas",
          "Drill-down: línea de cash flow → cuenta de grupo → líneas locales y asientos",
          "Las cifras se animan cuando cambian",
        ],
      },
      contrib: {
        eyebrow: "Contributivo y Sábana", tag: "Renovado", short: "Contributivo",
        title: "Contributivo, Sábana y el rastro de cada dato",
        desc: "La contribución de cada sociedad, desglosada en datos subidos y asientos SYS, AJE y RJE (y eliminaciones EJE en subgrupos), cuadrada con el modelo de Konsolidator / Power BI.",
        bullets: [
          "Impacto de las contrapartes (intercompañía) y columnas que se reordenan arrastrándolas",
          "Desglose de cada celda por cuenta local, con el peso de cada una sobre el total",
          "Ayuda junto a cada subcolumna (Uploaded, AJE, RJE, EJE, SYS, CFA e IC), en tu idioma",
          "En la Sábana, el panel «Rastro del dato» explica cualquier importe hasta la línea local",
        ],
      },
      structure: {
        eyebrow: "Estructura", tag: "Renovado", short: "Estructura",
        title: "La estructura del grupo, en un organigrama vivo",
        desc: "Cada enlace lleva la participación de la matriz y cada sociedad, el color de su moneda. Elige una y verás su línea completa y su ficha.",
        bullets: [
          "Busca una sociedad, encaja el árbol, ponlo en horizontal y pliega ramas",
          "Ficha con la ruta en el grupo, la participación y su línea de tiempo, la consolidación y las filiales",
          "Tabla de empresas ordenable con filtros, que te lleva al organigrama",
          "Mapa de calor de periodos: cerrados, abiertos y parcialmente abiertos",
        ],
      },
      pres: {
        eyebrow: "Presentaciones", tag: "Nuevo", short: "Presentaciones",
        title: "Presentaciones sobre datos vivos",
        desc: "Prepara las presentaciones para el consejo o el comité directamente sobre los datos de consolidación, sin copiar y pegar.",
        bullets: [
          "10 diseños y 18 layouts",
          "KPI con comparativas, gráficos de línea, tablas de cuentas, hoja de consolidación, contributivo y texto enriquecido",
          "Cambia el periodo y los filtros de toda la presentación en un solo paso",
          "Compártela con toda la empresa o con personas concretas (ver o editar) y expórtala a PowerPoint",
        ],
      },
      notes: {
        eyebrow: "Notas de la memoria", tag: "Renovado", short: "Memoria",
        title: "La memoria, ahora dentro de Presentaciones",
        desc: "Un asistente crea la memoria individual o consolidada, con PGC normal (25 notas) o NIIF-UE (20 notas), y cada cifra queda conectada con su origen.",
        bullets: [
          "Cuadros de movimientos del ejercicio actual y anterior, con cuadre automático y control frente a la amortización de PyG",
          "Vincula cualquier celda a una variable o a una cuenta de PyG, balance o cash flow; «¿De dónde sale?» explica cada importe",
          "Panel de revisión con notas, variables y controles",
          "Exporta a Word, PDF y Excel",
        ],
      },
      access: {
        eyebrow: "Ajustes", tag: "Nuevo", short: "Accesos",
        title: "Quién ve qué, de un vistazo",
        desc: "Los administradores ven en una sola tabla lo que puede ver cada persona y lo cambian sin perderse.",
        bullets: [
          "Estado de cada usuario (desactivado, regular o admin) en un clic",
          "Seis indicadores por usuario: páginas, empresas, estructuras, fuentes, dimensiones y mapeos",
          "Panel lateral con interruptores por sección y listas con buscador",
          "Los cambios se acumulan y se guardan o se descartan juntos",
        ],
      },
    },
    v: {
      nodes: { perf: "Rendimiento", look: "Diseño", multi: "Multiperiodo", kpis: "KPIs", structure: "Estructura", pres: "Presentaciones", notes: "Memoria", access: "Accesos" },
      version: "Versión", isNew: "Nuevo",
      signing: "Iniciando sesión", prefetch: "Precarga en paralelo",
      loads: ["Sociedades", "Periodos", "Cuentas de grupo", "Dimensiones", "KPI"],
      home: "Inicio", ready: "Datos listos", onEnter: "Al entrar",
      kpis: ["Ingresos", "EBITDA", "Margen"],
      cfTitle: "Cash flow individual", expanded: "Todo desplegado", account: "Cuenta",
      cfRows: [
        [0, "Flujos de explotación"], [1, "Resultado antes de impuestos"], [1, "Ajustes del resultado"],
        [2, "Amortización del inmovilizado"], [2, "Variación de provisiones"], [1, "Cambios en el capital corriente"],
        [2, "Existencias"], [2, "Deudores y otras cuentas a cobrar"], [2, "Acreedores y otras cuentas a pagar"],
        [0, "Flujos de inversión"], [1, "Pagos por inversiones"], [1, "Cobros por desinversiones"],
        [0, "Flujos de financiación"], [1, "Cobros y pagos de pasivo financiero"],
      ],
      cfTotal: "Variación neta de efectivo", visible: "Solo se pintan las filas visibles",
      drill: ["Línea de cash flow", "Cuenta de grupo", "Líneas locales", "Asientos"],
      contribTitle: "Contributivo", groupCcy: "Moneda de grupo", subgroup: "subgrupo",
      legend: { data: "Datos subidos", sys: "SYS", aje: "AJE", rje: "RJE", eje: "EJE", ic: "Contrapartes" },
      reconciled: "Cuadra con Konsolidator / Power BI",
      trail: "Rastro del dato", consolidated: "Importe consolidado", localTitle: "Desglose por cuenta local",
      trailSteps: ["Contribución por sociedad", "Asientos SYS · AJE · RJE", "Tipo de cambio", "Subgrupos", "Redondeo", "Línea local"],
      period: "Dic 2025", periodNew: "Nov 2025", filters: "Filtros", share: "Compartir",
      slideEyebrow: "Resultados del grupo", slideTitle: "Cierre de diciembre", slideTitleNew: "Cierre de noviembre",
      accounts: ["Ventas", "Gastos de personal", "Amortización"], designs: "10 diseños · 18 layouts",
      wizard: "Asistente", individual: "Individual", consolidatedShort: "Consolidada", pgc: "PGC · 25 notas", niif: "NIIF-UE · 20 notas",
      noteTitle: "Nota 5 · Inmovilizado material",
      moves: ["Saldo inicial", "Altas", "Bajas", "Traspasos", "Saldo final"],
      cuadre: "Cuadre", amortCheck: "Amortización PyG",
      whereFrom: "¿De dónde sale?", linkedKind: "Cuenta de balance", linkedTo: "Inmovilizado material",
      review: "Revisión", reviewRows: ["Notas", "Variables", "Controles"], export: "Exportar",
      look: {
        loading: "Construyendo la vista", phases: ["Metadatos", "Periodo", "Datos"],
        title: "Pérdidas y ganancias", cur: "Sep 26", cmp: "B · Ago 26",
        breakers: ["Ingresos", "Gastos"],
        rows: [["A.1.1", "Ventas"], ["A.1.2", "Otros ingresos"], ["A.2.1", "Aprovisionamientos"], ["A.2.2", "Gastos de personal"], ["A.2.4", "Amortización"]],
        pages: ["Individuales", "Dimensiones", "KPIs", "Cash flow", "Contributivo", "Sábana"],
      },
      multi: {
        month: "Mes", nMonths: "4 meses", months: ["Jun", "Jul", "Ago", "Sep"], prevMonths: ["Nov", "Dic"],
        reading: "Leyendo 4 cierres", sum: "Se suma", ytd: "Acumulado", total: "Total",
        badge: "2026: Jul–Sep · 2025: Dic", table: "Individuales · P&G", rows: ["Ventas", "Gastos", "Resultado"],
      },
      indiv: {
        monthly: "Mensual", history: "Histórico", months: ["Ago", "Jul", "Jun", "May"],
        rows: ["Ventas", "Gastos", "Resultado"], multi: "Multiempresa", compare: "Comparar con",
        cmp: [["B", "Ago 2026"], ["C", "Sep 2025"], ["D", "Sep 2024"]], base: "Sep 2026", pl: "P&G",
      },
      dims: {
        title: "Dimensiones", dim: "Centro de coste · Ventas", byCo: "Por empresa",
        accounts: [["A.1.1", "Ventas"], ["A.2.2", "Gastos de personal"], ["A.2.4", "Amortización"]],
        cos: [["Grupo Norvia S.A.", "#2440a8"], ["Norvia Ibérica S.L.", "#0f8a62"], ["Norvia France SAS", "#7c3aed"]],
        chips: ["Comparativo", "Multiperiodo", "Individual y consolidado"],
      },
      kpi: {
        library: "Biblioteca de KPIs", k1: "Endeudamiento", works: "Funciona", k2: "Deuda neta / EBITDA",
        missing: "Falta asignar", configure: "Configurar", steps: ["Identidad", "Fórmula", "Reglas"],
        mapA: "Ventas", mapB: "Coste de ventas", chart: "Evolución", month: "Mes", year: "Año",
        series: ["Margen bruto", "EBITDA"], families: ["Liquidez", "Solvencia", "Rentabilidad"],
      },
      st: {
        find: "Buscar", fit: "Encajar", horiz: "Horizontal", ownership: "Participación",
        path: "Ruta", since: "Mar 2019 → hoy", periods: "Periodos", consolidated: "Consolidada",
      },
      acc: {
        users: "7 usuarios", active: "6 activos", admins: "3 admins", states: ["Off", "Regular", "Admin"],
        chips: ["Páginas", "Empresas", "Dimensiones"], all: "Todas", none: "Ninguna",
        pending: "1 usuario con cambios", discard: "Descartar", save: "Guardar",
      },
    },
  },
  en: {
    badgeVer: "v1.1",
    badgeLabel: "What's new",
    badgeAria: "See what's new in version 1.1",
    badgeTip: "12 updates · Design, multi-period, KPIs, structure…",
    dialog: "What's new in Konsolidator Report 1.1",
    prev: "Previous", next: "Next", start: "Get started", close: "Close",
    goTo: "Go to page {n}: {t}", pageOf: "Page {n} of {total}: {t}",
    indexLabel: "What's in this release",
    pages: {
      intro: {
        eyebrow: "Version 1.1", tag: null,
        title: "Konsolidator Report 1.1",
        desc: "Faster, with one design across every page and new tools to analyse, present and decide who sees what. Pick where to start or take the full tour.",
        short: "Start",
      },
      perf: {
        eyebrow: "Performance", tag: "Faster", short: "Performance",
        title: "Faster from the very first click",
        desc: "While you sign in, the loading screen is already fetching your data. Once you're in, every page opens on data that's already loaded.",
        bullets: [
          "Data prefetched during the loading screen",
          "Pages open with their data ready",
          "Fewer, lighter requests: the contribution view finds the latest period with data without probing month by month",
          "If the API is busy it retries on its own; KPI cards and dimensions no longer show 0 on first load",
        ],
      },
      look: {
        eyebrow: "Design", tag: "Renewed", short: "Shared design",
        title: "One design across every page",
        desc: "Individual statements, Dimensions, KPIs, Cash flow, Contribution and the Consolidation sheet now share one visual language and one loader.",
        bullets: [
          "A single loader with real progress and its phases, carrying on seamlessly from the moment you open the page",
          "Animated section dividers, rows that react to the pointer and amounts in pills",
          "Comparing with another period opens and closes in one continuous motion; deviations show in green or red",
          "While the comparison period loads, its cells shimmer instead of showing differences against zero",
        ],
      },
      multi: {
        eyebrow: "Multi-period", tag: "New", short: "Several periods",
        title: "Several months at once, added up",
        desc: "In Individual statements, Dimensions and Cash flow you can pick several months, even from different years, and see them as a single period.",
        bullets: [
          "Single months or whole years, from the month picker",
          "Each run is calculated from the closes at its ends, so only the data needed is requested",
          "A label next to the table says exactly what is being added up",
          "In Dimensions, the company breakdown adds up the same selection",
        ],
      },
      indiv: {
        eyebrow: "Individual statements", tag: "New", short: "Individual",
        title: "History, several companies and up to three comparisons",
        desc: "Individual statements gain three new ways to look at the data without leaving the table.",
        bullets: [
          "History: click the header and the table unfolds month by month",
          "Multi-company: pick several companies and see them column by column",
          "Compare with up to three periods (B, C and D) at once",
          "The account column stays put when any of these views opens or closes",
        ],
      },
      dims: {
        eyebrow: "Dimensions", tag: "Renewed", short: "Dimensions",
        title: "Dimensions, with a breakdown by company",
        desc: "Individual and consolidated dimensions get the new design and a quick way to see which company contributes each amount.",
        bullets: [
          "Expand any account by company, with its legal name and colour",
          "Compare with another period, animated like every other page",
          "Multi-period: add up several months by dimension too",
        ],
      },
      kpis: {
        eyebrow: "KPIs", tag: "New", short: "KPIs",
        title: "KPIs: library, wizard and charts",
        desc: "Ready-to-use indicators, a wizard to build your own and a chart view to follow how they evolve.",
        bullets: [
          "Predefined KPIs by family that connect to your accounts on their own and show their value before you add them",
          "If an account is missing, the KPI takes you to set it up instead of being added empty",
          "Three-step wizard: identity, a formula with letters (A ÷ B) and rules with benchmarks and variations per company or dimension",
          "Trend charts with the data table alongside, by month or by year, and comparison between periods",
        ],
      },
      cf: {
        eyebrow: "Cash flow", tag: "Optimised", short: "Cash flow",
        title: "Smooth cash flow, even fully expanded",
        desc: "The individual cash flow table is virtualised: only the visible rows are painted, so a fully expanded statement with thousands of rows scrolls smoothly.",
        bullets: [
          "Resizable account column that remembers its width",
          "Drag company columns to reorder them",
          "Drill-down: cash flow line → group account → local lines and journals",
          "Numbers animate when they change",
        ],
      },
      contrib: {
        eyebrow: "Contribution and Sheet", tag: "Renewed", short: "Contribution",
        title: "Contribution, the Sheet and the trail behind every number",
        desc: "Each company's contribution, split into uploaded data and SYS, AJE and RJE journals (plus EJE eliminations for subgroups), reconciled with the Konsolidator / Power BI model.",
        bullets: [
          "Counterparty (intercompany) impact, and company columns you reorder by dragging",
          "Breakdown of any cell by local account, with each one's share of the total",
          "Help next to every sub-column (Uploaded, AJE, RJE, EJE, SYS, CFA and IC), in your language",
          "In the Consolidation sheet, the “Data trail” panel explains any amount down to the local line",
        ],
      },
      structure: {
        eyebrow: "Structure", tag: "Renewed", short: "Structure",
        title: "Your group structure, as a living org chart",
        desc: "Every link carries the parent's ownership and every company the colour of its currency. Pick one to see its whole line and its profile.",
        bullets: [
          "Find a company, fit the tree, switch it to horizontal and fold branches",
          "Profile with its path in the group, ownership and its timeline, consolidation details and subsidiaries",
          "Sortable company table with filters that takes you to the org chart",
          "Period heatmap: closed, open and partly open",
        ],
      },
      pres: {
        eyebrow: "Presentations", tag: "New", short: "Presentations",
        title: "Presentations on live data",
        desc: "Build board and committee decks directly on your consolidation data — no copy and paste.",
        bullets: [
          "10 designs and 18 layouts",
          "KPI cards with comparisons, line charts, account tables, consolidation sheet, contribution and rich text",
          "Change the period and filters of the whole deck in one step",
          "Share with the whole company or specific people (view or edit) and export to PowerPoint",
        ],
      },
      notes: {
        eyebrow: "Notes to the accounts", tag: "Renewed", short: "Notes",
        title: "Notes, now inside Presentations",
        desc: "A wizard creates individual or consolidated notes, under Spanish GAAP (25 notes) or EU-IFRS (20 notes), and every figure stays connected to its source.",
        bullets: [
          "Movement tables for the current and prior year, with automatic reconciliation and a check against P&L depreciation",
          "Link any cell to a variable or to any P&L, balance sheet or cash flow account; “Where does it come from?” explains every amount",
          "Review panel with notes, variables and checks",
          "Export to Word, PDF and Excel",
        ],
      },
      access: {
        eyebrow: "Settings", tag: "New", short: "Access",
        title: "Who sees what, at a glance",
        desc: "Admins see in one table what each person can access and change it without getting lost.",
        bullets: [
          "Each user's status (off, regular or admin) in one click",
          "Six indicators per user: pages, companies, structures, sources, dimensions and mappings",
          "Side panel with switches by section and searchable lists",
          "Changes add up and are saved or discarded together",
        ],
      },
    },
    v: {
      nodes: { perf: "Performance", look: "Design", multi: "Multi-period", kpis: "KPIs", structure: "Structure", pres: "Presentations", notes: "Notes", access: "Access" },
      version: "Version", isNew: "New",
      signing: "Signing in", prefetch: "Parallel prefetch",
      loads: ["Companies", "Periods", "Group accounts", "Dimensions", "KPIs"],
      home: "Home", ready: "Data ready", onEnter: "On entry",
      kpis: ["Revenue", "EBITDA", "Margin"],
      cfTitle: "Individual cash flow", expanded: "Fully expanded", account: "Account",
      cfRows: [
        [0, "Operating cash flows"], [1, "Profit before tax"], [1, "Adjustments to profit"],
        [2, "Depreciation and amortisation"], [2, "Change in provisions"], [1, "Changes in working capital"],
        [2, "Inventories"], [2, "Trade and other receivables"], [2, "Trade and other payables"],
        [0, "Investing cash flows"], [1, "Payments for investments"], [1, "Proceeds from disposals"],
        [0, "Financing cash flows"], [1, "Financial liabilities, net"],
      ],
      cfTotal: "Net change in cash", visible: "Only visible rows are painted",
      drill: ["Cash flow line", "Group account", "Local lines", "Journals"],
      contribTitle: "Contribution", groupCcy: "Group currency", subgroup: "subgroup",
      legend: { data: "Uploaded", sys: "SYS", aje: "AJE", rje: "RJE", eje: "EJE", ic: "Counterparty" },
      reconciled: "Matches Konsolidator / Power BI",
      trail: "Data trail", consolidated: "Consolidated amount", localTitle: "Breakdown by local account",
      trailSteps: ["Contribution by company", "SYS · AJE · RJE journals", "FX rate", "Subgroups", "Rounding", "Local line"],
      period: "Dec 2025", periodNew: "Nov 2025", filters: "Filters", share: "Share",
      slideEyebrow: "Group results", slideTitle: "December close", slideTitleNew: "November close",
      accounts: ["Revenue", "Staff costs", "Depreciation"], designs: "10 designs · 18 layouts",
      wizard: "Wizard", individual: "Individual", consolidatedShort: "Consolidated", pgc: "PGC · 25 notes", niif: "EU-IFRS · 20 notes",
      noteTitle: "Note 5 · Property, plant & equipment",
      moves: ["Opening balance", "Additions", "Disposals", "Transfers", "Closing balance"],
      cuadre: "Reconciled", amortCheck: "P&L depreciation",
      whereFrom: "Where does it come from?", linkedKind: "Balance sheet account", linkedTo: "Property, plant & equipment",
      review: "Review", reviewRows: ["Notes", "Variables", "Checks"], export: "Export",
      look: {
        loading: "Building the view", phases: ["Metadata", "Period", "Data"],
        title: "Profit and loss", cur: "Sep 26", cmp: "B · Aug 26",
        breakers: ["Income", "Expenses"],
        rows: [["A.1.1", "Revenue"], ["A.1.2", "Other income"], ["A.2.1", "Supplies"], ["A.2.2", "Staff costs"], ["A.2.4", "Depreciation"]],
        pages: ["Individual", "Dimensions", "KPIs", "Cash flow", "Contribution", "Sheet"],
      },
      multi: {
        month: "Month", nMonths: "4 months", months: ["Jun", "Jul", "Aug", "Sep"], prevMonths: ["Nov", "Dec"],
        reading: "Reading 4 closes", sum: "Adds up", ytd: "YTD", total: "Total",
        badge: "2026: Jul–Sep · 2025: Dec", table: "Individual · P&L", rows: ["Revenue", "Expenses", "Result"],
      },
      indiv: {
        monthly: "Monthly", history: "History", months: ["Aug", "Jul", "Jun", "May"],
        rows: ["Revenue", "Expenses", "Result"], multi: "Multi-company", compare: "Compare with",
        cmp: [["B", "Aug 2026"], ["C", "Sep 2025"], ["D", "Sep 2024"]], base: "Sep 2026", pl: "P&L",
      },
      dims: {
        title: "Dimensions", dim: "Cost centre · Sales", byCo: "By company",
        accounts: [["A.1.1", "Revenue"], ["A.2.2", "Staff costs"], ["A.2.4", "Depreciation"]],
        cos: [["Grupo Norvia S.A.", "#2440a8"], ["Norvia Ibérica S.L.", "#0f8a62"], ["Norvia France SAS", "#7c3aed"]],
        chips: ["Comparison", "Multi-period", "Individual and consolidated"],
      },
      kpi: {
        library: "KPI library", k1: "Debt ratio", works: "Works", k2: "Net debt / EBITDA",
        missing: "Needs an account", configure: "Set up", steps: ["Identity", "Formula", "Rules"],
        mapA: "Revenue", mapB: "Cost of sales", chart: "Trend", month: "Month", year: "Year",
        series: ["Gross margin", "EBITDA"], families: ["Liquidity", "Solvency", "Profitability"],
      },
      st: {
        find: "Find", fit: "Fit", horiz: "Horizontal", ownership: "Ownership",
        path: "Path", since: "Mar 2019 → today", periods: "Periods", consolidated: "Consolidated",
      },
      acc: {
        users: "7 users", active: "6 active", admins: "3 admins", states: ["Off", "Regular", "Admin"],
        chips: ["Pages", "Companies", "Dimensions"], all: "All", none: "None",
        pending: "1 user with changes", discard: "Discard", save: "Save",
      },
    },
  },
  da: {
    badgeVer: "v1.1",
    badgeLabel: "Nyheder",
    badgeAria: "Se nyhederne i version 1.1",
    badgeTip: "12 nyheder · Design, flere perioder, KPI'er, struktur…",
    dialog: "Nyheder i Konsolidator Report 1.1",
    prev: "Forrige", next: "Næste", start: "Kom i gang", close: "Luk",
    goTo: "Gå til side {n}: {t}", pageOf: "Side {n} af {total}: {t}",
    indexLabel: "Det er nyt i denne version",
    pages: {
      intro: {
        eyebrow: "Version 1.1", tag: null,
        title: "Konsolidator Report 1.1",
        desc: "Hurtigere, med ét design på alle sider og nye værktøjer til at analysere, præsentere og styre, hvem der ser hvad. Vælg, hvor du vil starte, eller tag hele turen.",
        short: "Start",
      },
      perf: {
        eyebrow: "Ydeevne", tag: "Hurtigere", short: "Ydeevne",
        title: "Hurtigere fra første klik",
        desc: "Mens du logger ind, henter indlæsningsskærmen allerede dine data. Når du er inde, åbner hver side med data, der allerede er indlæst.",
        bullets: [
          "Data hentes på forhånd under indlæsningsskærmen",
          "Siderne åbner med data klar",
          "Færre og lettere forespørgsler: bidragsvisningen finder den seneste periode med data uden at afsøge måned for måned",
          "Er API'et travlt, prøver det selv igen; KPI-kort og dimensioner viser ikke længere 0 ved første indlæsning",
        ],
      },
      look: {
        eyebrow: "Design", tag: "Fornyet", short: "Fælles design",
        title: "Ét design på alle sider",
        desc: "Selskabsregnskaber, Dimensioner, KPI'er, Pengestrømme, Bidrag og Konsolideringsarket taler nu samme visuelle sprog og har samme indlæser.",
        bullets: [
          "Én indlæser med reel fremdrift og faser, der fortsætter uden spring, fra du åbner siden",
          "Animerede sektionsdelere, rækker der reagerer på markøren, og beløb i piller",
          "Sammenligning med en anden periode åbner og lukker i én glidende bevægelse; afvigelser vises i grønt eller rødt",
          "Mens sammenligningsperioden indlæses, glimter cellerne i stedet for at vise afvigelser mod nul",
        ],
      },
      multi: {
        eyebrow: "Flere perioder", tag: "Nyt", short: "Flere perioder",
        title: "Flere måneder på én gang, lagt sammen",
        desc: "I Selskabsregnskaber, Dimensioner og Pengestrømme kan du vælge flere måneder, også fra forskellige år, og se dem som én periode.",
        bullets: [
          "Enkelte måneder eller hele år fra månedsvælgeren",
          "Hvert interval beregnes ud fra lukningerne i dets ender, så kun de nødvendige data hentes",
          "En etiket ved tabellen viser præcis, hvad der lægges sammen",
          "I Dimensioner lægger fordelingen pr. selskab det samme valg sammen",
        ],
      },
      indiv: {
        eyebrow: "Selskabsregnskaber", tag: "Nyt", short: "Selskaber",
        title: "Historik, flere selskaber og op til tre sammenligninger",
        desc: "Selskabsregnskaberne får tre nye måder at se data på uden at forlade tabellen.",
        bullets: [
          "Historik: klik på overskriften, og tabellen folder sig ud måned for måned",
          "Flere selskaber: vælg flere selskaber, og se dem kolonne for kolonne",
          "Sammenlign med op til tre perioder (B, C og D) på én gang",
          "Kontokolonnen bliver på plads, når en af disse visninger åbnes eller lukkes",
        ],
      },
      dims: {
        eyebrow: "Dimensioner", tag: "Fornyet", short: "Dimensioner",
        title: "Dimensioner med fordeling pr. selskab",
        desc: "Selskabs- og koncerndimensioner får det nye design og en hurtig måde at se, hvilket selskab der bidrager med hvert beløb.",
        bullets: [
          "Fold enhver konto ud pr. selskab med juridisk navn og farve",
          "Sammenlign med en anden periode, animeret som på de øvrige sider",
          "Flere perioder: læg også flere måneder sammen pr. dimension",
        ],
      },
      kpis: {
        eyebrow: "KPI'er", tag: "Nyt", short: "KPI'er",
        title: "KPI'er: bibliotek, guide og grafer",
        desc: "Færdige nøgletal, en guide til at bygge dine egne og en grafvisning til at følge, hvordan de udvikler sig.",
        bullets: [
          "Foruddefinerede KPI'er pr. kategori, der selv kobles til dine konti og viser værdien, før du tilføjer dem",
          "Mangler en konto, fører KPI'en dig til opsætningen i stedet for at blive tilføjet tom",
          "Guide i tre trin: identitet, en formel med bogstaver (A ÷ B) og regler med benchmarks og variationer pr. selskab eller dimension",
          "Udviklingsgrafer med datatabellen ved siden af, pr. måned eller år, og sammenligning mellem perioder",
        ],
      },
      cf: {
        eyebrow: "Pengestrømme", tag: "Optimeret", short: "Pengestrømme",
        title: "Glidende pengestrømme, selv helt udfoldet",
        desc: "Selskabets pengestrømstabel er virtualiseret: kun de synlige rækker tegnes, så en helt udfoldet opgørelse med tusindvis af rækker scroller glidende.",
        bullets: [
          "Kontokolonne, der kan ændre bredde og husker den",
          "Træk selskabskolonnerne for at ændre rækkefølgen",
          "Drill-down: pengestrømslinje → koncernkonto → lokale linjer og posteringer",
          "Tallene animeres, når de ændrer sig",
        ],
      },
      contrib: {
        eyebrow: "Bidrag og Ark", tag: "Fornyet", short: "Bidrag",
        title: "Bidrag, Arket og sporet bag hvert tal",
        desc: "Hvert selskabs bidrag, opdelt i uploadede data og SYS-, AJE- og RJE-posteringer (plus EJE-elimineringer for underkoncerner), afstemt med Konsolidator / Power BI-modellen.",
        bullets: [
          "Effekt af modparter (koncerninterne) og selskabskolonner, du flytter ved at trække",
          "Fordeling af enhver celle pr. lokal konto med hver kontos andel af totalen",
          "Hjælp ved hver underkolonne (Uploaded, AJE, RJE, EJE, SYS, CFA og IC) på dit sprog",
          "I Konsolideringsarket forklarer panelet »Dataspor« ethvert beløb ned til den lokale linje",
        ],
      },
      structure: {
        eyebrow: "Struktur", tag: "Fornyet", short: "Struktur",
        title: "Koncernstrukturen som et levende koncerndiagram",
        desc: "Hver forbindelse viser moderselskabets ejerandel, og hvert selskab har sin valutas farve. Vælg et for at se hele linjen og selskabskortet.",
        bullets: [
          "Find et selskab, tilpas træet, vend det vandret, og fold grene sammen",
          "Selskabskort med sti i koncernen, ejerandel og tidslinje, konsolidering og datterselskaber",
          "Sorterbar selskabstabel med filtre, der fører dig til koncerndiagrammet",
          "Heatmap over perioder: lukkede, åbne og delvist åbne",
        ],
      },
      pres: {
        eyebrow: "Præsentationer", tag: "Nyt", short: "Præsentationer",
        title: "Præsentationer på levende data",
        desc: "Byg præsentationer til bestyrelse og direktion direkte på dine konsolideringsdata – uden at kopiere og indsætte.",
        bullets: [
          "10 designs og 18 layouts",
          "KPI-kort med sammenligninger, linjegrafer, kontotabeller, konsolideringsark, bidrag og formateret tekst",
          "Skift periode og filtre for hele præsentationen i ét trin",
          "Del med hele virksomheden eller udvalgte personer (se eller redigere), og eksportér til PowerPoint",
        ],
      },
      notes: {
        eyebrow: "Noter til regnskabet", tag: "Fornyet", short: "Noter",
        title: "Noterne, nu i Præsentationer",
        desc: "En guide opretter noter til selskabs- eller koncernregnskabet efter spansk GAAP (25 noter) eller EU-IFRS (20 noter), og hvert tal forbliver koblet til sin kilde.",
        bullets: [
          "Bevægelsesoversigter for indeværende og forrige år med automatisk afstemning og kontrol mod resultatopgørelsens afskrivninger",
          "Kobl enhver celle til en variabel eller en konto i resultatopgørelse, balance eller pengestrømme; »Hvor kommer det fra?« forklarer hvert beløb",
          "Gennemgangspanel med noter, variabler og kontroller",
          "Eksportér til Word, PDF og Excel",
        ],
      },
      access: {
        eyebrow: "Indstillinger", tag: "Nyt", short: "Adgang",
        title: "Hvem ser hvad – med ét blik",
        desc: "Administratorer ser i én tabel, hvad hver person har adgang til, og ændrer det uden at fare vild.",
        bullets: [
          "Hver brugers status (deaktiveret, normal eller admin) med ét klik",
          "Seks indikatorer pr. bruger: sider, selskaber, strukturer, kilder, dimensioner og mappinger",
          "Sidepanel med kontakter pr. sektion og søgbare lister",
          "Ændringer samles og gemmes eller kasseres samlet",
        ],
      },
    },
    v: {
      nodes: { perf: "Ydeevne", look: "Design", multi: "Flere perioder", kpis: "KPI'er", structure: "Struktur", pres: "Præsentationer", notes: "Noter", access: "Adgang" },
      version: "Version", isNew: "Nyt",
      signing: "Logger ind", prefetch: "Parallel forhåndshentning",
      loads: ["Selskaber", "Perioder", "Koncernkonti", "Dimensioner", "KPI'er"],
      home: "Forside", ready: "Data klar", onEnter: "Ved login",
      kpis: ["Omsætning", "EBITDA", "Margin"],
      cfTitle: "Selskabets pengestrømme", expanded: "Helt udfoldet", account: "Konto",
      cfRows: [
        [0, "Pengestrømme fra drift"], [1, "Resultat før skat"], [1, "Reguleringer"],
        [2, "Af- og nedskrivninger"], [2, "Ændring i hensættelser"], [1, "Ændring i driftskapital"],
        [2, "Varebeholdninger"], [2, "Tilgodehavender"], [2, "Leverandørgæld og anden gæld"],
        [0, "Pengestrømme fra investering"], [1, "Køb af anlægsaktiver"], [1, "Salg af anlægsaktiver"],
        [0, "Pengestrømme fra finansiering"], [1, "Finansielle forpligtelser, netto"],
      ],
      cfTotal: "Ændring i likvider", visible: "Kun synlige rækker tegnes",
      drill: ["Pengestrømslinje", "Koncernkonto", "Lokale linjer", "Posteringer"],
      contribTitle: "Bidrag", groupCcy: "Koncernvaluta", subgroup: "underkoncern",
      legend: { data: "Uploadet", sys: "SYS", aje: "AJE", rje: "RJE", eje: "EJE", ic: "Modpart" },
      reconciled: "Stemmer med Konsolidator / Power BI",
      trail: "Dataspor", consolidated: "Konsolideret beløb", localTitle: "Fordeling pr. lokal konto",
      trailSteps: ["Bidrag pr. selskab", "SYS · AJE · RJE-posteringer", "Valutakurs", "Underkoncerner", "Afrunding", "Lokal linje"],
      period: "Dec 2025", periodNew: "Nov 2025", filters: "Filtre", share: "Del",
      slideEyebrow: "Koncernens resultat", slideTitle: "Afslutning december", slideTitleNew: "Afslutning november",
      accounts: ["Omsætning", "Personaleomkostninger", "Afskrivninger"], designs: "10 designs · 18 layouts",
      wizard: "Guide", individual: "Selskab", consolidatedShort: "Koncern", pgc: "PGC · 25 noter", niif: "EU-IFRS · 20 noter",
      noteTitle: "Note 5 · Materielle anlægsaktiver",
      moves: ["Saldo primo", "Tilgang", "Afgang", "Overførsler", "Saldo ultimo"],
      cuadre: "Afstemt", amortCheck: "Afskr. i resultatet",
      whereFrom: "Hvor kommer det fra?", linkedKind: "Balancekonto", linkedTo: "Materielle anlægsaktiver",
      review: "Gennemgang", reviewRows: ["Noter", "Variabler", "Kontroller"], export: "Eksportér",
      look: {
        loading: "Bygger visningen", phases: ["Metadata", "Periode", "Data"],
        title: "Resultatopgørelse", cur: "Sep 26", cmp: "B · Aug 26",
        breakers: ["Indtægter", "Omkostninger"],
        rows: [["A.1.1", "Omsætning"], ["A.1.2", "Andre indtægter"], ["A.2.1", "Råvarer"], ["A.2.2", "Personaleomkostninger"], ["A.2.4", "Afskrivninger"]],
        pages: ["Selskaber", "Dimensioner", "KPI'er", "Pengestrømme", "Bidrag", "Ark"],
      },
      multi: {
        month: "Måned", nMonths: "4 måneder", months: ["Jun", "Jul", "Aug", "Sep"], prevMonths: ["Nov", "Dec"],
        reading: "Læser 4 lukninger", sum: "Lægges sammen", ytd: "ÅTD", total: "I alt",
        badge: "2026: Jul–Sep · 2025: Dec", table: "Selskab · Resultat", rows: ["Omsætning", "Omkostninger", "Resultat"],
      },
      indiv: {
        monthly: "Månedlig", history: "Historik", months: ["Aug", "Jul", "Jun", "Maj"],
        rows: ["Omsætning", "Omkostninger", "Resultat"], multi: "Flere selskaber", compare: "Sammenlign med",
        cmp: [["B", "Aug 2026"], ["C", "Sep 2025"], ["D", "Sep 2024"]], base: "Sep 2026", pl: "Resultat",
      },
      dims: {
        title: "Dimensioner", dim: "Omkostningssted · Salg", byCo: "Pr. selskab",
        accounts: [["A.1.1", "Omsætning"], ["A.2.2", "Personaleomkostninger"], ["A.2.4", "Afskrivninger"]],
        cos: [["Grupo Norvia S.A.", "#2440a8"], ["Norvia Ibérica S.L.", "#0f8a62"], ["Norvia France SAS", "#7c3aed"]],
        chips: ["Sammenligning", "Flere perioder", "Selskab og koncern"],
      },
      kpi: {
        library: "KPI-bibliotek", k1: "Gældsgrad", works: "Virker", k2: "Nettogæld / EBITDA",
        missing: "Mangler konto", configure: "Opsæt", steps: ["Identitet", "Formel", "Regler"],
        mapA: "Omsætning", mapB: "Vareforbrug", chart: "Udvikling", month: "Måned", year: "År",
        series: ["Bruttomargin", "EBITDA"], families: ["Likviditet", "Soliditet", "Rentabilitet"],
      },
      st: {
        find: "Søg", fit: "Tilpas", horiz: "Vandret", ownership: "Ejerandel",
        path: "Sti", since: "Mar 2019 → i dag", periods: "Perioder", consolidated: "Konsolideret",
      },
      acc: {
        users: "7 brugere", active: "6 aktive", admins: "3 admins", states: ["Fra", "Normal", "Admin"],
        chips: ["Sider", "Selskaber", "Dimensioner"], all: "Alle", none: "Ingen",
        pending: "1 bruger med ændringer", discard: "Kassér", save: "Gem",
      },
    },
  },
  pt: {
    badgeVer: "v1.1",
    badgeLabel: "Novidades",
    badgeAria: "Ver as novidades da versão 1.1",
    badgeTip: "12 novidades · Design, multiperíodo, KPIs, estrutura…",
    dialog: "Novidades do Konsolidator Report 1.1",
    prev: "Anterior", next: "Seguinte", start: "Começar", close: "Fechar",
    goTo: "Ir para a página {n}: {t}", pageOf: "Página {n} de {total}: {t}",
    indexLabel: "O que há nesta versão",
    pages: {
      intro: {
        eyebrow: "Versão 1.1", tag: null,
        title: "Konsolidator Report 1.1",
        desc: "Mais rápida, com um só design em todas as páginas e novas ferramentas para analisar, apresentar e decidir quem vê o quê. Escolha por onde começar ou faça a visita completa.",
        short: "Início",
      },
      perf: {
        eyebrow: "Desempenho", tag: "Mais rápido", short: "Desempenho",
        title: "Mais rápido desde o primeiro clique",
        desc: "Enquanto inicia sessão, o ecrã de carregamento já vai buscar os seus dados. Ao entrar, cada página abre com dados que já estão carregados.",
        bullets: [
          "Dados pré-carregados durante o ecrã de carregamento",
          "As páginas abrem com os dados já prontos",
          "Menos pedidos, e mais leves: a contribuição encontra o último período com dados sem sondar mês a mês",
          "Se a API estiver ocupada, tenta de novo sozinha; os KPIs e as dimensões já não aparecem a 0 no primeiro carregamento",
        ],
      },
      look: {
        eyebrow: "Design", tag: "Renovado", short: "Design comum",
        title: "Um só design em todas as páginas",
        desc: "Individuais, Dimensões, KPIs, Fluxos de caixa, Contribuição e a Folha de consolidação falam agora a mesma linguagem visual, com o mesmo carregador.",
        bullets: [
          "Um único carregador com o progresso real e as suas fases, que continua sem saltos desde que abre a página",
          "Separadores de secção animados, linhas que reagem ao rato e montantes em pílula",
          "A comparação com outro período abre e fecha num só movimento contínuo; os desvios surgem a verde ou a vermelho",
          "Enquanto o período de comparação carrega, as células brilham em vez de mostrar diferenças contra zero",
        ],
      },
      multi: {
        eyebrow: "Multiperíodo", tag: "Novo", short: "Vários períodos",
        title: "Vários meses de uma vez, somados",
        desc: "Em Individuais, Dimensões e Fluxos de caixa escolhe vários meses, mesmo de anos diferentes, e vê-os como um único período.",
        bullets: [
          "Meses soltos ou anos inteiros, a partir do seletor de mês",
          "Cada intervalo é calculado com os fechos dos seus extremos: só se pedem os dados necessários",
          "Uma etiqueta junto à tabela indica exatamente o que está a ser somado",
          "Em Dimensões, a decomposição por empresa soma a mesma seleção",
        ],
      },
      indiv: {
        eyebrow: "Individuais", tag: "Novo", short: "Individuais",
        title: "Histórico, várias empresas e até três comparações",
        desc: "As demonstrações individuais ganham três novas formas de olhar para os dados sem sair da tabela.",
        bullets: [
          "Histórico: clique no cabeçalho e a tabela desdobra-se mês a mês",
          "Multiempresa: escolha várias empresas e veja-as coluna a coluna",
          "Compare com até três períodos (B, C e D) ao mesmo tempo",
          "A coluna de contas não salta ao abrir ou fechar qualquer destas vistas",
        ],
      },
      dims: {
        eyebrow: "Dimensões", tag: "Renovado", short: "Dimensões",
        title: "Dimensões, com decomposição por empresa",
        desc: "As dimensões individuais e consolidadas estreiam o novo design e uma forma rápida de ver que empresa contribui com cada montante.",
        bullets: [
          "Desdobre qualquer conta por empresa, com a sua denominação social e a sua cor",
          "Comparação com outro período, animada como nas restantes páginas",
          "Multiperíodo: soma vários meses também por dimensão",
        ],
      },
      kpis: {
        eyebrow: "KPIs", tag: "Novo", short: "KPIs",
        title: "KPIs: biblioteca, assistente e gráficos",
        desc: "Indicadores prontos a usar, um assistente para criar os seus e uma vista de gráficos para acompanhar a sua evolução.",
        bullets: [
          "KPIs predefinidos por família que se ligam sozinhos às suas contas e mostram o seu valor antes de os adicionar",
          "Se faltar uma conta, o KPI leva-o a configurá-la em vez de ser adicionado vazio",
          "Assistente em três passos: identidade, fórmula com letras (A ÷ B) e regras com benchmarks e variações por empresa ou dimensão",
          "Gráficos de evolução com a tabela de dados ao lado, por mês ou por ano, e comparação entre períodos",
        ],
      },
      cf: {
        eyebrow: "Fluxos de caixa", tag: "Otimizado", short: "Fluxos de caixa",
        title: "Fluxos de caixa ágeis, mesmo todos expandidos",
        desc: "A tabela de fluxos de caixa individual está virtualizada: só se desenham as linhas visíveis, por isso uma demonstração expandida com milhares de linhas desliza com suavidade.",
        bullets: [
          "Coluna de contas redimensionável, que se lembra da largura",
          "Arraste as colunas das empresas para as reordenar",
          "Drill-down: linha de fluxo de caixa → conta de grupo → linhas locais e lançamentos",
          "Os valores animam-se quando mudam",
        ],
      },
      contrib: {
        eyebrow: "Contribuição e Folha", tag: "Renovado", short: "Contribuição",
        title: "Contribuição, a Folha e o rasto de cada valor",
        desc: "A contribuição de cada empresa, decomposta em dados carregados e lançamentos SYS, AJE e RJE (e eliminações EJE em subgrupos), conciliada com o modelo Konsolidator / Power BI.",
        bullets: [
          "Impacto das contrapartes (intragrupo) e colunas que se reordenam arrastando-as",
          "Decomposição de cada célula por conta local, com o peso de cada uma no total",
          "Ajuda junto a cada subcoluna (Uploaded, AJE, RJE, EJE, SYS, CFA e IC), no seu idioma",
          "Na Folha de consolidação, o painel «Rasto dos dados» explica qualquer montante até à linha local",
        ],
      },
      structure: {
        eyebrow: "Estrutura", tag: "Renovado", short: "Estrutura",
        title: "A estrutura do grupo, num organigrama vivo",
        desc: "Cada ligação mostra a participação da empresa-mãe e cada empresa, a cor da sua moeda. Escolha uma para ver a sua linha completa e a sua ficha.",
        bullets: [
          "Procure uma empresa, ajuste a árvore, ponha-a na horizontal e recolha ramos",
          "Ficha com o caminho no grupo, a participação e a sua cronologia, a consolidação e as subsidiárias",
          "Tabela de empresas ordenável com filtros, que o leva ao organigrama",
          "Mapa de calor de períodos: fechados, abertos e parcialmente abertos",
        ],
      },
      pres: {
        eyebrow: "Apresentações", tag: "Novo", short: "Apresentações",
        title: "Apresentações sobre dados vivos",
        desc: "Prepare as apresentações para a administração ou a comissão executiva diretamente sobre os dados de consolidação, sem copiar e colar.",
        bullets: [
          "10 designs e 18 layouts",
          "KPIs com comparações, gráficos de linhas, tabelas de contas, folha de consolidação, contribuição e texto formatado",
          "Mude o período e os filtros de toda a apresentação num só passo",
          "Partilhe-a com toda a empresa ou com pessoas concretas (ver ou editar) e exporte-a para PowerPoint",
        ],
      },
      notes: {
        eyebrow: "Notas às contas", tag: "Renovado", short: "Anexo",
        title: "O anexo, agora dentro de Apresentações",
        desc: "Um assistente cria o anexo individual ou consolidado, segundo o PGC espanhol (25 notas) ou as IFRS-UE (20 notas), e cada valor fica ligado à sua origem.",
        bullets: [
          "Mapas de movimentos do exercício atual e anterior, com conciliação automática e controlo face às amortizações da DR",
          "Ligue qualquer célula a uma variável ou a uma conta da DR, do balanço ou dos fluxos de caixa; «De onde vem?» explica cada montante",
          "Painel de revisão com notas, variáveis e controlos",
          "Exporte para Word, PDF e Excel",
        ],
      },
      access: {
        eyebrow: "Definições", tag: "Novo", short: "Acessos",
        title: "Quem vê o quê, num relance",
        desc: "Os administradores veem numa só tabela o que cada pessoa pode ver e alteram-no sem se perderem.",
        bullets: [
          "Estado de cada utilizador (desativado, normal ou admin) num clique",
          "Seis indicadores por utilizador: páginas, empresas, estruturas, fontes, dimensões e mapeamentos",
          "Painel lateral com interruptores por secção e listas com pesquisa",
          "As alterações acumulam-se e guardam-se ou descartam-se em conjunto",
        ],
      },
    },
    v: {
      nodes: { perf: "Desempenho", look: "Design", multi: "Multiperíodo", kpis: "KPIs", structure: "Estrutura", pres: "Apresentações", notes: "Anexo", access: "Acessos" },
      version: "Versão", isNew: "Novo",
      signing: "A iniciar sessão", prefetch: "Pré-carga em paralelo",
      loads: ["Empresas", "Períodos", "Contas de grupo", "Dimensões", "KPIs"],
      home: "Início", ready: "Dados prontos", onEnter: "Ao entrar",
      kpis: ["Receitas", "EBITDA", "Margem"],
      cfTitle: "Fluxos de caixa individuais", expanded: "Tudo expandido", account: "Conta",
      cfRows: [
        [0, "Fluxos operacionais"], [1, "Resultado antes de impostos"], [1, "Ajustamentos ao resultado"],
        [2, "Depreciações e amortizações"], [2, "Variação de provisões"], [1, "Variação do fundo de maneio"],
        [2, "Inventários"], [2, "Clientes e outras contas a receber"], [2, "Fornecedores e outras contas a pagar"],
        [0, "Fluxos de investimento"], [1, "Pagamentos de investimentos"], [1, "Recebimentos de alienações"],
        [0, "Fluxos de financiamento"], [1, "Passivos financeiros, líquido"],
      ],
      cfTotal: "Variação líquida de caixa", visible: "Só se desenham as linhas visíveis",
      drill: ["Linha de fluxo de caixa", "Conta de grupo", "Linhas locais", "Lançamentos"],
      contribTitle: "Contribuição", groupCcy: "Moeda do grupo", subgroup: "subgrupo",
      legend: { data: "Carregados", sys: "SYS", aje: "AJE", rje: "RJE", eje: "EJE", ic: "Contrapartes" },
      reconciled: "Concilia com Konsolidator / Power BI",
      trail: "Rasto dos dados", consolidated: "Montante consolidado", localTitle: "Decomposição por conta local",
      trailSteps: ["Contribuição por empresa", "Lançamentos SYS · AJE · RJE", "Taxa de câmbio", "Subgrupos", "Arredondamento", "Linha local"],
      period: "Dez 2025", periodNew: "Nov 2025", filters: "Filtros", share: "Partilhar",
      slideEyebrow: "Resultados do grupo", slideTitle: "Fecho de dezembro", slideTitleNew: "Fecho de novembro",
      accounts: ["Vendas", "Gastos com pessoal", "Amortizações"], designs: "10 designs · 18 layouts",
      wizard: "Assistente", individual: "Individual", consolidatedShort: "Consolidado", pgc: "PGC · 25 notas", niif: "IFRS-UE · 20 notas",
      noteTitle: "Nota 5 · Ativos fixos tangíveis",
      moves: ["Saldo inicial", "Aquisições", "Alienações", "Transferências", "Saldo final"],
      cuadre: "Conciliado", amortCheck: "Amortizações DR",
      whereFrom: "De onde vem?", linkedKind: "Conta de balanço", linkedTo: "Ativos fixos tangíveis",
      review: "Revisão", reviewRows: ["Notas", "Variáveis", "Controlos"], export: "Exportar",
      look: {
        loading: "A construir a vista", phases: ["Metadados", "Período", "Dados"],
        title: "Demonstração de resultados", cur: "Set 26", cmp: "B · Ago 26",
        breakers: ["Rendimentos", "Gastos"],
        rows: [["A.1.1", "Vendas"], ["A.1.2", "Outros rendimentos"], ["A.2.1", "Matérias consumidas"], ["A.2.2", "Gastos com pessoal"], ["A.2.4", "Amortizações"]],
        pages: ["Individuais", "Dimensões", "KPIs", "Fluxos de caixa", "Contribuição", "Folha"],
      },
      multi: {
        month: "Mês", nMonths: "4 meses", months: ["Jun", "Jul", "Ago", "Set"], prevMonths: ["Nov", "Dez"],
        reading: "A ler 4 fechos", sum: "Soma-se", ytd: "Acumulado", total: "Total",
        badge: "2026: Jul–Set · 2025: Dez", table: "Individuais · DR", rows: ["Vendas", "Gastos", "Resultado"],
      },
      indiv: {
        monthly: "Mensal", history: "Histórico", months: ["Ago", "Jul", "Jun", "Mai"],
        rows: ["Vendas", "Gastos", "Resultado"], multi: "Multiempresa", compare: "Comparar com",
        cmp: [["B", "Ago 2026"], ["C", "Set 2025"], ["D", "Set 2024"]], base: "Set 2026", pl: "DR",
      },
      dims: {
        title: "Dimensões", dim: "Centro de custo · Vendas", byCo: "Por empresa",
        accounts: [["A.1.1", "Vendas"], ["A.2.2", "Gastos com pessoal"], ["A.2.4", "Amortizações"]],
        cos: [["Grupo Norvia S.A.", "#2440a8"], ["Norvia Ibérica S.L.", "#0f8a62"], ["Norvia France SAS", "#7c3aed"]],
        chips: ["Comparação", "Multiperíodo", "Individual e consolidado"],
      },
      kpi: {
        library: "Biblioteca de KPIs", k1: "Endividamento", works: "Funciona", k2: "Dívida líquida / EBITDA",
        missing: "Falta atribuir", configure: "Configurar", steps: ["Identidade", "Fórmula", "Regras"],
        mapA: "Vendas", mapB: "Custo das vendas", chart: "Evolução", month: "Mês", year: "Ano",
        series: ["Margem bruta", "EBITDA"], families: ["Liquidez", "Solvabilidade", "Rendibilidade"],
      },
      st: {
        find: "Procurar", fit: "Ajustar", horiz: "Horizontal", ownership: "Participação",
        path: "Caminho", since: "Mar 2019 → hoje", periods: "Períodos", consolidated: "Consolidada",
      },
      acc: {
        users: "7 utilizadores", active: "6 ativos", admins: "3 admins", states: ["Off", "Normal", "Admin"],
        chips: ["Páginas", "Empresas", "Dimensões"], all: "Todas", none: "Nenhuma",
        pending: "1 utilizador com alterações", discard: "Descartar", save: "Guardar",
      },
    },
  },
};

// Idioma pedido (o el del navegador) si existe en TEXT; si no, inglés
export function pickReleaseLang(locale) {
  const raw = locale && locale !== "auto" ? locale : (typeof navigator !== "undefined" ? navigator.language : "es");
  const l = String(raw || "es").slice(0, 2).toLowerCase();
  return TEXT[l] ? l : "en";
}
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

/* ── Movimiento reducido (suscripción al media query, sin estado propio) ── */
const RM_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb) => {
  const mq = window.matchMedia?.(RM_QUERY);
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
};
const getRM = () => !!window.matchMedia?.(RM_QUERY).matches;
function useReducedMotion() { return useSyncExternalStore(subscribeRM, getRM, () => false); }

/* ── Formato de cifras de las viñetas ─────────────────────────────── */
function fmtNum(n, dec, lang) {
  const neg = n < 0, abs = Math.abs(n);
  const [int, frac] = abs.toFixed(dec).split(".");
  const dc = lang !== "en"; // es, da, pt: coma decimal y punto de miles
  const th = dc ? "." : ",", dp = dc ? "," : ".";
  const s = int.replace(/\B(?=(\d{3})+(?!\d))/g, th) + (frac ? dp + frac : "");
  return neg ? `(${s})` : s;
}

// Cifra que "cuenta" hasta su valor (las cifras se animan al cambiar)
function CountUp({ to, lang, dec = 0, delay = 0, ms = 900 }) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return undefined;
    let raf = 0, t0 = 0;
    const step = (now) => {
      if (!t0) t0 = now;
      const k = Math.min(1, (now - t0) / ms);
      setV(to * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(step); }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [to, delay, ms, reduce]);
  return <>{fmtNum(reduce ? to : v, dec, lang)}</>;
}

/* ════════════════════════════════════════════════════════════════
   Insignia de la cabecera
   ════════════════════════════════════════════════════════════════ */
const BADGE_CSS = `
.rbWrap { position: relative; display: inline-flex; align-items: center; margin-left: 18px; padding-left: 18px;
  animation: rbIn 700ms cubic-bezier(0.22,1,0.36,1) 260ms backwards; }
.rbWrap::before { content: ""; position: absolute; left: 0; top: 50%; width: 1px; height: 18px; margin-top: -9px; background: rgba(255,255,255,0.28); }
.rbBadge { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px 0 11px; border: 0; border-radius: 999px; cursor: pointer;
  font: inherit; color: #fff; background: rgba(255,255,255,0.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.24); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: transform 360ms cubic-bezier(0.34,1.56,0.64,1), background 220ms ease, box-shadow 260ms ease; }
.rbBadge:hover { transform: translateY(-1px) scale(1.04); background: rgba(255,255,255,0.2);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5), 0 12px 28px -12px rgba(5,12,50,0.7), 0 0 26px rgba(168,197,255,0.55); }
.rbBadge:active { transform: scale(0.98); }
.rbBadge:focus-visible { outline: 3px solid rgba(255,255,255,0.75); outline-offset: 3px; }
.rbGlow { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 250ms ease;
  background: radial-gradient(90px circle at var(--hx, 50%) var(--hy, 50%), rgba(255,255,255,0.32), transparent 65%); }
.rbBadge:hover .rbGlow { opacity: 1; }
.rbDot { position: relative; width: 8px; height: 8px; flex: none; border-radius: 50%; background: rgba(255,255,255,0.7); transition: background 300ms ease; }
.rbBadge.isNew .rbDot { background: #ff5563; box-shadow: 0 0 10px rgba(255,85,99,0.85); }
.rbBadge.isNew .rbDot::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: #ff5563; animation: rbPing 1.9s cubic-bezier(0,0,0.2,1) infinite; }
.rbVer { position: relative; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; }
.rbSep { position: relative; opacity: 0.5; font-weight: 900; }
.rbLabel { position: relative; font-size: 12px; font-weight: 800; letter-spacing: 0.01em; white-space: nowrap; }
.rbArrow { position: relative; opacity: 0.8; transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease; }
.rbBadge:hover .rbArrow, .rbBadge:focus-visible .rbArrow { transform: translateX(3px); opacity: 1; }
.rbTip { position: absolute; left: 18px; top: calc(100% + 10px); z-index: 40; display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 10px; white-space: nowrap; pointer-events: none;
  font-size: 11px; font-weight: 700; color: #fff; background: rgba(10,22,71,0.82); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 14px 30px -12px rgba(5,12,50,0.7);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  opacity: 0; transform: translateY(-4px); transition: opacity 200ms ease, transform 300ms cubic-bezier(0.22,1,0.36,1); }
.rbTip::before { content: ""; position: absolute; left: 22px; top: -4px; width: 8px; height: 8px; background: inherit; transform: rotate(45deg); border-radius: 2px; }
.rbTip svg { color: #fbbf24; flex: none; }
.rbWrap:hover .rbTip, .rbWrap:focus-within .rbTip { opacity: 1; transform: none; transition-delay: 120ms; }
@media (max-width: 520px) { .rbWrap { margin-left: 12px; padding-left: 12px; } .rbArrow, .rbSep { display: none; } .rbBadge { gap: 7px; padding: 0 11px 0 10px; } .rbTip { display: none; } }
@keyframes rbIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes rbPing { 0% { transform: scale(1); opacity: 0.75; } 80%, 100% { transform: scale(2.8); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .rbWrap, .rbBadge.isNew .rbDot::after { animation: none !important; }
  .rbBadge.isNew .rbDot::after { opacity: 0; }
  .rbBadge, .rbArrow, .rbTip { transition: none !important; }
  .rbBadge:hover { transform: none; }
}
`;

export function ReleaseBadge({ seen, onOpen, locale, triggerRef }) {
  const L = TEXT[pickReleaseLang(locale)];
  return (
    <span className="rbWrap" data-piece style={{ "--d": "30ms" }}>
      <style>{BADGE_CSS}</style>
      <button
        ref={triggerRef}
        type="button"
        className={`rbBadge ${seen ? "" : "isNew"}`}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={L.badgeAria}
        aria-describedby="rb-release-tip"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--hx", `${e.clientX - r.left}px`);
          e.currentTarget.style.setProperty("--hy", `${e.clientY - r.top}px`);
        }}
      >
        <span className="rbGlow" aria-hidden="true" />
        <span className="rbDot" aria-hidden="true" />
        <span className="rbVer">{L.badgeVer}</span>
        <span className="rbSep" aria-hidden="true">·</span>
        <span className="rbLabel">{L.badgeLabel}</span>
        <ArrowRight size={13} strokeWidth={2.6} className="rbArrow" aria-hidden="true" />
      </button>
      <span id="rb-release-tip" role="tooltip" className="rbTip">
        <Sparkles size={12} strokeWidth={2.4} aria-hidden="true" />{L.badgeTip}
      </span>
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════
   Viñetas: interfaces en miniatura sobre un lienzo fijo de 460×400
   que se escala para encajar en el escenario. Se vuelven a montar al
   entrar en cada página, así sus animaciones arrancan de cero.
   ════════════════════════════════════════════════════════════════ */
const ART_W = 460, ART_H = 400;
const d = (ms) => ({ "--d": ms }); // retardo de entrada en ms

/* a) Intro: el grafo de consolidación, ahora con las novedades */
const INTRO_C = { x: 230, y: 196 };
const INTRO_NODES = [
  { k: "perf", Icon: Zap, x: 118, y: 90 },
  { k: "look", Icon: Palette, x: 230, y: 44 },
  { k: "multi", Icon: CalendarRange, x: 342, y: 90 },
  { k: "kpis", Icon: Gauge, x: 386, y: 196 },
  { k: "structure", Icon: Network, x: 342, y: 302 },
  { k: "pres", Icon: Presentation, x: 230, y: 348, isNew: true },
  { k: "notes", Icon: BookOpen, x: 118, y: 302 },
  { k: "access", Icon: UserCog, x: 74, y: 196 },
];
function VIntro({ L }) {
  const { x: cx, y: cy } = INTRO_C;
  return (
    <>
      <svg className="rnSvg" viewBox={`0 0 ${ART_W} ${ART_H}`} width={ART_W} height={ART_H}>
        <ellipse cx={cx} cy={cy} rx="170" ry="158" className="rnRing rnFade" style={d(100)} />
        <g className="rnOrbit"><circle cx={cx} cy={cy} r="104" className="rnRing rnRingB rnFade" style={d(160)} /></g>
        {INTRO_NODES.map((n, i) => (
          <g key={n.k}>
            <line x1={n.x} y1={n.y} x2={cx} y2={cy} pathLength="1" className="rnLine rnDraw" style={d(380 + i * 70)} />
            <line x1={n.x} y1={n.y} x2={cx} y2={cy} className="rnLineFlow rnFade" style={d(1000 + i * 70)} />
          </g>
        ))}
      </svg>
      {INTRO_NODES.map((n, i) => (
        <span key={n.k} className="rnPacket" style={{ offsetPath: `path("M ${n.x} ${n.y} L ${cx} ${cy}")`, animationDelay: `${1200 + i * 300}ms` }} />
      ))}
      <div className="rnHalo" style={{ left: cx, top: cy }} />
      <div className="rnCoreV rnPop" style={{ left: cx, top: cy, ...d(120) }}>
        <small>{L.version}</small>
        <b>1.1</b>
      </div>
      {INTRO_NODES.map((n, i) => (
        <div key={n.k} className="rnNode rnPop" style={{ left: n.x, top: n.y, ...d(520 + i * 80) }}>
          <span className="rnNodeIco"><n.Icon size={13} strokeWidth={2.4} /></span>
          {L.nodes[n.k]}
          {n.isNew && <em>{L.isNew}</em>}
        </div>
      ))}
    </>
  );
}

/* b) Rendimiento: la precarga corre mientras se inicia sesión */
const LOAD_BARS = [
  { dur: 620, d: 240 }, { dur: 380, d: 300 }, { dur: 1050, d: 360 }, { dur: 760, d: 420 }, { dur: 900, d: 480 },
];
const SPARKS = ["M0 16 L10 13 L20 14 L30 9 L40 10 L50 5 L60 3", "M0 14 L10 15 L20 11 L30 12 L40 8 L50 7 L60 4", "M0 12 L10 12 L20 10 L30 11 L40 7 L50 8 L60 6"];
function VPerf({ L }) {
  const vals = ["42,1 M€", "7,6 M€", "18,0 %"], deltas = ["+8,4 %", "+5,1 %", "+0,6 pp"];
  return (
    <>
      <div className="rnCard rnUp" style={{ left: 20, top: 18, width: 420, height: 200, ...d(60) }}>
        <div className="rnPerfGrid">
          <div className="rnPerfCore">
            <div className="rnMiniCore">
              <svg viewBox="0 0 80 80" className="rnSpinRing"><circle cx="40" cy="40" r="34" /></svg>
              <span className="rnMiniCoreK">[K</span>
              <span className="rnMiniCoreOk rnPop" style={d(1620)}><Check size={16} strokeWidth={3.2} /></span>
            </div>
            <p className="rnMicro">{L.signing}</p>
          </div>
          <div>
            <p className="rnEyeSm">{L.prefetch}</p>
            {L.loads.map((lab, i) => (
              <div key={lab} className="rnLoadRow">
                <span className="rnLoadL">{lab}</span>
                <span className="rnTrack"><i className="rnFillBar" style={{ animationDuration: `${LOAD_BARS[i].dur}ms`, animationDelay: `${LOAD_BARS[i].d}ms` }} /></span>
                <span className="rnTick rnPop" style={d(LOAD_BARS[i].d + LOAD_BARS[i].dur + 40)}><Check size={10} strokeWidth={3.4} /></span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rnConnector rnFade" style={d(1500)}>
        <span>{L.onEnter}</span>
      </div>
      <div className="rnCard rnUp" style={{ left: 20, top: 252, width: 420, height: 130, ...d(1680) }}>
        <div className="rnCardHead">
          <b>{L.home}</b>
          <span className="rnPill rnPillOk"><Check size={10} strokeWidth={3.2} />{L.ready}</span>
        </div>
        <div className="rnKpis">
          {L.kpis.map((k, i) => (
            <div key={k} className="rnKpi rnUp" style={d(1820 + i * 90)}>
              <span className="rnKpiL">{k}</span>
              <span className="rnKpiV">{vals[i]}</span>
              <span className="rnKpiFoot">
                <span className="rnDelta">{deltas[i]}</span>
                <svg viewBox="0 0 60 18" className="rnSpark"><path d={SPARKS[i]} pathLength="1" className="rnDraw" style={d(1960 + i * 90)} /></svg>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* c) Cash flow: tabla virtualizada, columna redimensionable, columnas arrastrables */
const CF_VALUES = [
  [4820, 2310, 3105], [3960, 1840, 2650], [1210, 560, 830], [940, 410, 615], [270, 150, 215], [-350, -90, -375],
  [-210, -60, -145], [-480, -220, -390], [340, 190, 160], [-1620, -730, -1180], [-1790, -810, -1240], [170, 80, 60],
  [-910, -480, -620], [-910, -480, -620],
];
const CF_TOTAL = [2290, 1100, 1305];
function VCashflow({ L, lang }) {
  const rows = L.cfRows.map((r, i) => ({ lvl: r[0], label: r[1], vals: CF_VALUES[i] }));
  const cos = ["ES01", "PT02", "MX03"];
  const swap = ["rnSwapA", "rnSwapB", ""];
  return (
    <>
      <div className="rnCard rnUp rnCf" style={{ left: 14, top: 12, width: 432, height: 300, ...d(40) }}>
        <div className="rnCardHead">
          <b><Rows3 size={13} strokeWidth={2.4} />{L.cfTitle}</b>
          <span className="rnPill">{L.expanded}</span>
        </div>
        <div className="rnCfHead">
          <span className="rnCfAcc rnCfResize">
            {L.account}
            <i className="rnHandle" />
            <span className="rnHandleTip"><MoveHorizontal size={11} strokeWidth={2.6} /></span>
          </span>
          {cos.map((c, i) => (
            <span key={c} className={`rnCfCo ${swap[i]}`}><GripVertical size={10} strokeWidth={2.4} />{c}</span>
          ))}
        </div>
        <div className="rnCfBody">
          <div className="rnCfScroll">
            {[0, 1].map(copy => rows.map((r, i) => (
              <div key={`${copy}-${i}`} className={`rnCfRow lvl${r.lvl}`}>
                <span className="rnCfAcc rnCfResize" style={{ paddingLeft: 10 + r.lvl * 10 }}>{r.label}</span>
                {r.vals.map((v, j) => <span key={j} className={`rnCfCo ${swap[j]} ${v < 0 ? "isNeg" : ""}`}>{fmtNum(v, 0, lang)}</span>)}
              </div>
            )))}
          </div>
          <span className="rnScrollbar"><i /></span>
        </div>
        <div className="rnCfRow rnCfTotal">
          <span className="rnCfAcc rnCfResize">{L.cfTotal}</span>
          {CF_TOTAL.map((v, j) => <span key={j} className={`rnCfCo ${swap[j]}`}><CountUp to={v} lang={lang} delay={500 + j * 120} ms={1100} /></span>)}
        </div>
      </div>
      <div className="rnFloat rnUp" style={{ left: 14, top: 324, ...d(1300) }}>
        <Eye size={12} strokeWidth={2.4} />{L.visible}
      </div>
      <div className="rnDrill" style={{ left: 14, top: 362 }}>
        {L.drill.map((s, i) => (
          <span key={s} className="rnDrillStep rnUp" style={d(1500 + i * 110)}>
            {i > 0 && <ChevronRight size={11} strokeWidth={2.6} className="rnDrillArr" />}
            <span className="rnDrillChip" style={{ animationDelay: `${2300 + i * 900}ms` }}>{s}</span>
          </span>
        ))}
      </div>
    </>
  );
}

/* d) Contributivo + panel "Rastro del dato" */
const SEG_KINDS = ["data", "sys", "aje", "rje", "eje", "ic"];
const CONTRIB_COLS = [
  { co: "ES01", segs: [["data", 92], ["sys", 14], ["aje", 20], ["rje", 10], ["ic", 14]] },
  { co: "PT02", segs: [["data", 66], ["sys", 10], ["aje", 14], ["rje", 8], ["ic", 10]] },
  { co: "MX03", sub: true, segs: [["data", 82], ["sys", 12], ["aje", 10], ["rje", 8], ["eje", 16], ["ic", 12]] },
];
function VContrib({ L, lang }) {
  return (
    <>
      <div className="rnCard rnUp" style={{ left: 12, top: 16, width: 262, height: 364, ...d(40) }}>
        <div className="rnCardHead">
          <b><Layers size={13} strokeWidth={2.4} />{L.contribTitle}</b>
          <span className="rnPill">EUR · {L.groupCcy}</span>
        </div>
        <div className="rnBars">
          {CONTRIB_COLS.map((c, ci) => (
            <div key={c.co} className="rnBarCol">
              <div className="rnStack">
                {c.segs.map(([k, h], si) => (
                  <i key={k} className={`rnSeg seg-${k}`} style={{ height: h, ...d(300 + ci * 160 + si * 90) }} />
                ))}
              </div>
              <span className="rnBarLab"><GripVertical size={10} strokeWidth={2.4} />{c.co}</span>
              <span className="rnBarSub">{c.sub ? L.subgroup : " "}</span>
            </div>
          ))}
        </div>
        <div className="rnLegend">
          {SEG_KINDS.map((k, i) => (
            <span key={k} className="rnLegendI rnFade" style={d(900 + i * 60)}><i className={`seg-${k}`} />{L.legend[k]}</span>
          ))}
        </div>
        <span className="rnPill rnPillOk rnPop rnRecon" style={d(1900)}><Check size={11} strokeWidth={3.2} />{L.reconciled}</span>
      </div>
      <div className="rnPanel rnUp rnDrillCard" style={{ left: 254, top: 284, width: 196, ...d(2300) }}>
        <div className="rnPanelHead"><Rows3 size={12} strokeWidth={2.4} />{L.localTitle}</div>
        {[["70000", 0.62], ["70500", 0.27], ["75900", 0.11]].map(([code, share], i) => (
          <span key={code} className="rnDrillLine rnUp" style={d(2450 + i * 110)}>
            <i className="rnLkCode">{code}</i>
            <span className="rnDmShare"><i style={{ width: `${share * 100}%`, "--c": "#1a2f8a", background: "#1a2f8a" }} /></span>
            <em>{fmtNum(share * 100, 0, lang)}%</em>
          </span>
        ))}
      </div>
      <div className="rnPanel rnSlideIn" style={{ left: 254, top: 16, width: 196, ...d(1050) }}>
        <div className="rnPanelHead"><Route size={13} strokeWidth={2.4} />{L.trail}</div>
        <p className="rnMicro rnMicroL">{L.consolidated}</p>
        <p className="rnBig"><CountUp to={1284300} lang={lang} delay={1250} ms={1000} /></p>
        <ol className="rnTrail">
          <i className="rnTrailLine" />
          {L.trailSteps.map((s, i) => (
            <li key={s} className="rnUp" style={d(1400 + i * 140)}>
              <span className={`rnTrailDot ${i === L.trailSteps.length - 1 ? "isEnd" : ""}`} />
              {s}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/* e) Presentaciones: una diapositiva que se monta sola y se actualiza en un paso */
const PRES_KPI = [
  { v: "42,1 M€", n: "38,7 M€", dl: "+8,4 %", dn: "+6,9 %" },
  { v: "7,6 M€", n: "6,9 M€", dl: "+5,1 %", dn: "+4,2 %" },
  { v: "18,0 %", n: "17,8 %", dl: "+0,6 pp", dn: "+0,4 pp" },
];
const DESIGNS = [["#1a2f8a", "#e8394a"], ["#ffffff", "#1a2f8a"], ["#0a1647", "#7a9fef"], ["#f4efe6", "#16a34a"], ["#111827", "#fbbf24"]];
function VPres({ L }) {
  return (
    <>
      <div className="rnCard rnUp" style={{ left: 10, top: 26, width: 440, ...d(40) }}>
        <div className="rnPresBar">
          <span className="rnChip rnChipPeriod"><CalendarDays size={11} strokeWidth={2.4} />
            <span className="rnSwapTxt"><span className="rnOld">{L.period}</span><span className="rnNew">{L.periodNew}</span></span>
          </span>
          <span className="rnChip"><SlidersHorizontal size={11} strokeWidth={2.4} />{L.filters}</span>
          <span style={{ flex: 1 }} />
          <span className="rnAvatars rnFade" style={d(700)}><i style={{ background: "#e8394a" }}>LM</i><i style={{ background: "#3a5cd9" }}>JR</i><i style={{ background: "#16a34a" }}>AS</i></span>
          <span className="rnChip rnChipDark rnPop" style={d(800)}><Share2 size={11} strokeWidth={2.4} />{L.share}</span>
          <span className="rnChip rnPop" style={d(900)}><Download size={11} strokeWidth={2.4} />PPTX</span>
        </div>
        <div className="rnPresBody">
          <div className="rnRail">
            {[0, 1, 2].map(i => (
              <span key={i} className={`rnThumb rnUp ${i === 0 ? "isOn" : ""}`} style={d(200 + i * 80)}>
                <i /><i /><i />
              </span>
            ))}
          </div>
          <div className="rnSlide rnPop" style={d(160)}>
            <p className="rnSlideEye rnUp" style={d(380)}>{L.slideEyebrow}</p>
            <p className="rnSlideTitle rnUp" style={d(440)}>
              <span className="rnSwapTxt"><span className="rnOld">{L.slideTitle}</span><span className="rnNew">{L.slideTitleNew}</span></span>
            </p>
            <div className="rnSlideKpis">
              {PRES_KPI.map((k, i) => (
                <div key={i} className="rnSlideKpi rnPop" style={d(600 + i * 90)}>
                  <span className="rnSlideKpiL">{L.kpis[i]}</span>
                  <b className="rnSwapTxt"><span className="rnOld">{k.v}</span><span className="rnNew">{k.n}</span></b>
                  <span className="rnDelta rnSwapTxt"><span className="rnOld">{k.dl}</span><span className="rnNew">{k.dn}</span></span>
                </div>
              ))}
            </div>
            <div className="rnSlideBottom">
              <svg viewBox="0 0 180 64" className="rnSlideChart">
                <path d="M0 52 H180 M0 32 H180 M0 12 H180" className="rnGrid" />
                <path d="M4 48 L30 44 L56 46 L82 36 L108 38 L134 26 L160 22 L176 14" pathLength="1" className="rnDraw rnSerA" style={d(900)} />
                <path d="M4 50 L30 49 L56 47 L82 44 L108 42 L134 38 L160 34 L176 30" pathLength="1" className="rnDraw rnSerB" style={d(1000)} />
              </svg>
              <div className="rnSlideTable">
                {L.accounts.map((a, i) => (
                  <span key={a} className="rnUp" style={d(1150 + i * 80)}><em>{a}</em><b>{["42.130", "(9.870)", "(2.410)"][i]}</b></span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="rnDesigns" style={{ left: 10, top: 330 }}>
        {DESIGNS.map(([bg, ac], i) => (
          <span key={i} className="rnDesign rnPop" style={{ background: bg, ...d(1300 + i * 70) }}><i style={{ background: ac }} /><i /></span>
        ))}
        <span className="rnFloat rnFade" style={d(1700)}>{L.designs}</span>
      </div>
    </>
  );
}

/* f) Notas de la memoria: cuadro de movimientos que cuadra y se vincula */
const MOVES = [[1240, 1105], [310, 215], [-85, -80], [0, 0], [1465, 1240]];
function VNotes({ L, lang }) {
  return (
    <>
      <div className="rnWizard rnUp" style={{ left: 12, top: 14, ...d(40) }}>
        <span className="rnMicro">{L.wizard}</span>
        <span className="rnSeg2"><span>{L.individual}</span><span className="isOn">{L.consolidatedShort}</span></span>
        <span className="rnSeg2"><span className="isOn">{L.pgc}</span><span>{L.niif}</span></span>
      </div>
      <div className="rnCard rnUp" style={{ left: 12, top: 56, width: 290, height: 268, ...d(140) }}>
        <div className="rnCardHead"><b><BookOpen size={13} strokeWidth={2.4} />{L.noteTitle}</b></div>
        <div className="rnMoves">
          <div className="rnMoveRow rnMoveHead"><span /><span>2025</span><span>2024</span></div>
          {L.moves.map((m, i) => (
            <div key={m} className={`rnMoveRow rnUp ${i === 4 ? "isTotal" : ""}`} style={d(300 + i * 90)}>
              <span>{m}</span>
              {MOVES[i].map((v, j) => (
                <span key={j} className={i === 4 && j === 0 ? "rnLinkSrc" : ""}>
                  <CountUp to={v} dec={1} lang={lang} delay={400 + i * 90} ms={900} />
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="rnMoveFoot">
          <span className="rnPill rnPillOk rnPop" style={d(1450)}><Check size={10} strokeWidth={3.2} />{L.cuadre}</span>
          <span className="rnPill rnPillOk rnPop" style={d(1600)}><Check size={10} strokeWidth={3.2} />{L.amortCheck}</span>
        </div>
      </div>
      <svg className="rnSvg" viewBox={`0 0 ${ART_W} ${ART_H}`} width={ART_W} height={ART_H}>
        <path d="M 296 250 C 312 250, 304 232, 318 232" pathLength="1" className="rnLinkPath rnDraw" style={d(1750)} />
        <circle cx="296" cy="250" r="3" className="rnLinkEnd rnPop" style={d(1720)} />
      </svg>
      <div className="rnPanel rnUp rnReview" style={{ left: 318, top: 56, width: 132, ...d(700) }}>
        <div className="rnPanelHead"><ListChecks size={13} strokeWidth={2.4} />{L.review}</div>
        {L.reviewRows.map((r, i) => (
          <span key={r} className="rnReviewRow">{r}<span className="rnTick rnPop" style={d(1000 + i * 150)}><Check size={10} strokeWidth={3.4} /></span></span>
        ))}
      </div>
      <div className="rnPanel rnPop rnWhere" style={{ left: 318, top: 196, width: 132, ...d(1950) }}>
        <p className="rnWhereQ">{L.whereFrom}</p>
        <p className="rnWhereA"><Link2 size={12} strokeWidth={2.6} /><span><small>{L.linkedKind}</small>{L.linkedTo}</span></p>
        <p className="rnWhereV">{fmtNum(1465, 1, lang)}</p>
      </div>
      <div className="rnExport" style={{ left: 12, top: 342 }}>
        <span className="rnMicro rnFade" style={d(2050)}>{L.export}</span>
        <span className="rnChip rnPop" style={d(2100)}><FileText size={11} strokeWidth={2.4} color="#2b579a" />Word</span>
        <span className="rnChip rnPop" style={d(2180)}><File size={11} strokeWidth={2.4} color="#e8394a" />PDF</span>
        <span className="rnChip rnPop" style={d(2260)}><FileSpreadsheet size={11} strokeWidth={2.4} color="#16a34a" />Excel</span>
      </div>
    </>
  );
}

/* ── Cifras con signo para las desviaciones de las viñetas ────────────── */
const sgn = (n, dec, lang) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n), dec, lang)}`;

/* g) Diseño común: el cargador se aparta y deja la tabla nueva, con su
      comparación animada y las celdas del periodo B que brillan al cargar */
const LOOK_ROWS = [
  { v: 2953.9, b: 2742.5 }, { v: 158.8, b: 149.0 }, { v: -1415.4, b: -1320.1 }, { v: -1139.8, b: -1096.3 }, { v: -115.8, b: -102.9 },
];
function VLook({ L, lang }) {
  const T = L.look;
  const R = 26, C = 2 * Math.PI * R;
  const row = (r, i) => {
    const [code, name] = T.rows[i];
    const dv = r.v - r.b, pct = (dv / Math.abs(r.b)) * 100;
    const good = dv >= 0;
    return (
      <div key={code} className="rnLkRow" style={{ "--i": i }}>
        <span className="rnLkAcc"><i className="rnLkCode">{code}</i>{name}</span>
        <span className="rnLkVal"><b className={r.v < 0 ? "isNeg" : ""}>{fmtNum(r.v, 1, lang)}</b></span>
        <span className="rnLkCmp">
          <span className="rnLkC c1"><i className="rnShim" /><em className="rnLkIn">{fmtNum(r.b, 1, lang)}</em></span>
          <span className="rnLkC c2"><i className="rnShim" /><em className={`rnLkIn rnDev ${good ? "isUp" : "isDown"}`}>{sgn(dv, 1, lang)}</em></span>
          <span className="rnLkC c3"><i className="rnShim" /><em className={`rnLkIn rnDev ${good ? "isUp" : "isDown"}`}>{sgn(pct, 1, lang)}%</em></span>
        </span>
      </div>
    );
  };
  return (
    <>
      <div className="rnCard rnUp rnLook" style={{ left: 14, top: 14, width: 432, height: 302, ...d(40) }}>
        <div className="rnCardHead">
          <b><Rows3 size={13} strokeWidth={2.4} />{T.title}</b>
          <span className="rnPill">{T.cur} · k€</span>
        </div>
        <div className="rnLkRow rnLkHead">
          <span className="rnLkAcc">{L.account}</span>
          <span className="rnLkVal">{T.cur}</span>
          <span className="rnLkCmp"><span className="rnLkC c1">{T.cmp}</span><span className="rnLkC c2">Δ</span><span className="rnLkC c3">Δ %</span></span>
        </div>
        <div className="rnLkBk" style={{ "--sec": "#1a2f8a", ...d(1500) }}><span>{T.breakers[0]}</span></div>
        {LOOK_ROWS.slice(0, 2).map((r, i) => row(r, i))}
        <div className="rnLkBk" style={{ "--sec": "#e8394a", ...d(1620) }}><span>{T.breakers[1]}</span></div>
        {LOOK_ROWS.slice(2).map((r, i) => row(r, i + 2))}

        {/* El cargador común: progreso real por fases y se aparta */}
        <div className="rnLkLoader">
          <div className="rnLkRing">
            <svg viewBox="-32 -32 64 64"><circle r={R} className="rnLkTrack" /><circle r={R} className="rnLkArc" style={{ strokeDasharray: `${C} ${C}`, "--c": C }} transform="rotate(-90)" /></svg>
            <span><CountUp to={100} lang={lang} delay={150} ms={1150} />%</span>
          </div>
          <p>{T.loading}</p>
          <div className="rnLkPhases">
            {T.phases.map((ph, i) => (
              <span key={ph} className="rnLkPh" style={d(300 + i * 360)}><i><Check size={8} strokeWidth={3.6} /></i>{ph}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="rnPages" style={{ left: 14, top: 334 }}>
        {T.pages.map((p, i) => <span key={p} className="rnPageChip rnPop" style={d(3500 + i * 80)}>{p}</span>)}
      </div>
    </>
  );
}

/* h) Multiperiodo: se eligen meses de dos años y se suman */
const MULTI_VALS = [9_412_300, -7_118_640, 2_293_660];
function VMulti({ L, lang }) {
  const T = L.multi;
  const box = (on, delay) => (
    <span className={`rnBox ${on ? "isOn" : ""}`} style={on ? d(delay) : undefined}>{on && <Check size={9} strokeWidth={3.6} />}</span>
  );
  return (
    <>
      <div className="rnCard rnUp rnPick" style={{ left: 14, top: 14, width: 190, ...d(40) }}>
        <div className="rnCardHead">
          <b><CalendarDays size={13} strokeWidth={2.4} />{T.month}</b>
          <span className="rnPill rnPop" style={d(1250)}>{T.nMonths}</span>
        </div>
        <div className="rnPickBody">
          <span className="rnPickYear">2026</span>
          {T.months.map((m, i) => <span key={m} className="rnPickRow">{box(i > 0, 380 + i * 170)}{m}</span>)}
          <span className="rnPickYear">2025</span>
          {T.prevMonths.map((m, i) => <span key={m} className="rnPickRow">{box(i === 1, 1020)}{m}</span>)}
        </div>
      </div>

      <div className="rnPanel rnSlideIn rnSum" style={{ left: 216, top: 14, width: 230, ...d(900) }}>
        <div className="rnPanelHead"><Layers size={13} strokeWidth={2.4} />{T.sum}</div>
        {[[`${T.months[1]}–${T.months[3]} 2026`, `${T.ytd} ${T.months[3]}`, `${T.ytd} ${T.months[0]}`], [`${T.prevMonths[1]} 2025`, `${T.ytd} ${T.prevMonths[1]}`, `${T.ytd} ${T.prevMonths[0]}`]].map(([lab, a, b], i) => (
          <div key={lab} className="rnSumRow rnUp" style={d(1250 + i * 160)}>
            <span className="rnSumLab">{lab}</span>
            <span className="rnSumEq"><i className="rnKey">{a}</i><em>−</em><i className="rnKey isSoft">{b}</i></span>
          </div>
        ))}
        <div className="rnLoadRow rnSumLoad rnFade" style={d(1500)}>
          <span className="rnLoadL">{T.reading}</span>
          <span className="rnTrack"><i className="rnFillBar" style={{ animationDuration: "900ms", animationDelay: "1600ms" }} /></span>
          <span className="rnTick rnPop" style={d(2520)}><Check size={10} strokeWidth={3.4} /></span>
        </div>
      </div>

      <div className="rnCard rnUp" style={{ left: 14, top: 250, width: 432, height: 140, ...d(2300) }}>
        <div className="rnCardHead">
          <b><Rows3 size={13} strokeWidth={2.4} />{T.table}</b>
          <span className="rnMultiBadge rnPop" style={d(2500)}><b>{T.nMonths}</b>{T.badge}</span>
        </div>
        <div className="rnMtHead"><span>{L.account}</span><span>{T.total}</span></div>
        {T.rows.map((r, i) => (
          <div key={r} className={`rnMtRow ${i === 2 ? "isTotal" : ""}`}>
            <span>{r}</span>
            <span className={MULTI_VALS[i] < 0 ? "isNeg" : ""}><CountUp to={MULTI_VALS[i]} lang={lang} delay={2550 + i * 90} ms={1000} /></span>
          </div>
        ))}
      </div>
    </>
  );
}

/* i) Individuales: el histórico se despliega mes a mes; multiempresa y
      hasta tres periodos de comparación */
const IND_ROWS = [
  [255.3, [255.3, 255.3, 255.4, 255.3]],
  [-195.3, [-195.3, -195.4, -195.2, -195.3]],
  [44.1, [44.1, 44.0, 44.2, 44.0]],
];
function VIndiv({ L, lang }) {
  const T = L.indiv;
  return (
    <>
      <div className="rnCard rnUp rnInd" style={{ left: 12, top: 14, width: 436, height: 172, ...d(40) }}>
        <div className="rnCardHead">
          <b><Rows3 size={13} strokeWidth={2.4} />{T.pl} · k€</b>
          <span className="rnPill">{T.base}</span>
        </div>
        <div className="rnIndRow rnIndHead">
          <span className="rnIndAcc">{L.account}</span>
          <span className="rnIndMon"><b>{T.monthly}</b><i className="rnHistPill"><CalendarDays size={9} strokeWidth={2.6} />{T.history}</i></span>
          {T.months.map((m, i) => <span key={m} className="rnIndM" style={d(1150 + i * 130)}>{m}</span>)}
        </div>
        {IND_ROWS.map(([v, ms], r) => (
          <div key={r} className={`rnIndRow ${r === 2 ? "isTotal" : ""}`}>
            <span className="rnIndAcc">{T.rows[r]}</span>
            <span className={`rnIndMon ${v < 0 ? "isNeg" : ""}`}>{fmtNum(v, 1, lang)}</span>
            {ms.map((x, i) => <span key={i} className={`rnIndM ${x < 0 ? "isNeg" : ""}`} style={d(1150 + i * 130)}>{fmtNum(x, 1, lang)}</span>)}
          </div>
        ))}
      </div>

      <div className="rnCard rnUp" style={{ left: 12, top: 200, width: 216, height: 186, ...d(1700) }}>
        <div className="rnCardHead"><b><Building2 size={13} strokeWidth={2.4} />{T.multi}</b></div>
        <div className="rnMcHead">
          <span />
          {[["NORVIA", "#2440a8", 0], ["NIB", "#0f8a62", 0], ["NFR", "#7c3aed", 2300]].map(([c, col, dl]) => (
            <span key={c} className={dl ? "rnMcNew" : ""} style={dl ? d(dl) : undefined}><i style={{ background: col }} />{c}</span>
          ))}
        </div>
        {[[255.3, 140.4, 86.8], [-195.3, -107.4, -66.4], [44.1, 24.2, 15.0]].map((vals, r) => (
          <div key={r} className={`rnMcRow ${r === 2 ? "isTotal" : ""}`}>
            <span>{T.rows[r]}</span>
            {vals.map((x, i) => <span key={i} className={`${x < 0 ? "isNeg" : ""} ${i === 2 ? "rnMcNew" : ""}`} style={i === 2 ? d(2300) : undefined}>{fmtNum(x, 1, lang)}</span>)}
          </div>
        ))}
      </div>

      <div className="rnPanel rnUp rnCmpList" style={{ left: 240, top: 200, width: 208, ...d(1850) }}>
        <div className="rnPanelHead"><Layers size={13} strokeWidth={2.4} />{T.compare}</div>
        <span className="rnCmpItem"><i className="isA">A</i>{T.base}</span>
        {T.cmp.map(([k, p], i) => (
          <span key={k} className="rnCmpItem rnPop" style={d(2100 + i * 200)}><i className={`is${k}`}>{k}</i>{p}</span>
        ))}
      </div>
    </>
  );
}

/* j) Dimensiones: una cuenta se despliega por empresa */
const DIM_VALS = [1_284_300, -642_150, -118_400];
const DIM_CO = [612_400, 438_900, 233_000];
function VDims({ L, lang }) {
  const T = L.dims;
  const total = DIM_CO.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="rnCard rnUp" style={{ left: 12, top: 14, width: 436, height: 304, ...d(40) }}>
        <div className="rnCardHead">
          <b><Layers size={13} strokeWidth={2.4} />{T.title}</b>
          <span className="rnPill">{T.dim}</span>
        </div>
        <div className="rnMtHead rnDmHead"><span>{L.account}</span><span>{L.multi.total}</span></div>
        <div className="rnLkBk" style={{ "--sec": "#1a2f8a", ...d(400) }}><span>{L.look.breakers[0]}</span></div>
        <div className="rnDmRow">
          <span className="rnLkAcc"><i className="rnLkCode">{T.accounts[0][0]}</i>{T.accounts[0][1]}</span>
          <span className="rnDmBtn"><Building2 size={10} strokeWidth={2.6} />{T.byCo}</span>
          <b>{fmtNum(DIM_VALS[0], 0, lang)}</b>
        </div>
        {T.cos.map(([co, col], i) => (
          <div key={co} className="rnDmCo" style={{ "--i": i, "--c": col }}>
            <span className="rnDmName"><i />{co}</span>
            <span className="rnDmShare"><i style={{ width: `${(DIM_CO[i] / total) * 100}%` }} /></span>
            <span className="rnDmV">{fmtNum(DIM_CO[i], 0, lang)}</span>
          </div>
        ))}
        <div className="rnLkBk" style={{ "--sec": "#e8394a", ...d(520) }}><span>{L.look.breakers[1]}</span></div>
        {T.accounts.slice(1).map(([code, name], i) => (
          <div key={code} className="rnDmRow">
            <span className="rnLkAcc"><i className="rnLkCode">{code}</i>{name}</span>
            <span />
            <b className="isNeg">{fmtNum(DIM_VALS[i + 1], 0, lang)}</b>
          </div>
        ))}
      </div>
      <div className="rnPages" style={{ left: 12, top: 334 }}>
        {T.chips.map((c, i) => <span key={c} className="rnPageChip rnPop" style={d(2300 + i * 110)}>{c}</span>)}
      </div>
    </>
  );
}

/* k) KPIs: biblioteca que comprueba si funcionan, asistente y gráficos */
function VKpis({ L, lang }) {
  const T = L.kpi;
  const formula = ["(", "A", "−", "B", ")", "÷", "A"];
  return (
    <>
      <div className="rnCard rnUp rnKpiLib" style={{ left: 12, top: 12, width: 262, height: 232, ...d(40) }}>
        <div className="rnCardHead">
          <b><BookOpen size={13} strokeWidth={2.4} />{T.library}</b>
          <span className="rnPill">24</span>
        </div>
        <div className="rnKlBody">
          <div className="rnKlFam">
            {T.families.map((f, i) => <span key={f} className={i === 1 ? "isOn" : ""}>{f}</span>)}
          </div>
          <div className="rnKlCards">
            <div className="rnKlCard rnUp" style={d(300)}>
              <b>{T.k1}</b>
              <span className="rnKlOk rnPop" style={d(800)}><i />{T.works}<em><CountUp to={44.4} dec={1} lang={lang} delay={850} ms={800} /> %</em></span>
            </div>
            <div className="rnKlCard rnUp" style={d(420)}>
              <b>{T.k2}</b>
              <span className="rnKlBad rnPop" style={d(1000)}><i />{T.missing}</span>
              <span className="rnKlCfg rnPop" style={d(1150)}><Sparkles size={9} strokeWidth={2.6} />{T.configure}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rnPanel rnSlideIn rnWiz" style={{ left: 284, top: 12, width: 164, ...d(900) }}>
        {T.steps.map((s, i) => (
          <span key={s} className={`rnWizStep ${i === 0 ? "isDone" : i === 1 ? "isOn" : ""}`}>
            <i>{i === 0 ? <Check size={9} strokeWidth={3.6} /> : i + 1}</i>{s}
          </span>
        ))}
        <div className="rnFormula">
          {formula.map((t, i) => (
            <span key={i} className={`rnTok rnPop ${/[A-Z]/.test(t) ? `isVar is${t}` : ""}`} style={d(1300 + i * 90)}>{t}</span>
          ))}
        </div>
        <span className="rnMap rnUp" style={d(2000)}><i className="isA">A</i>{T.mapA}</span>
        <span className="rnMap rnUp" style={d(2120)}><i className="isB">B</i>{T.mapB}</span>
      </div>

      <div className="rnCard rnUp" style={{ left: 12, top: 256, width: 436, height: 130, ...d(1500) }}>
        <div className="rnCardHead">
          <b><Zap size={13} strokeWidth={2.4} />{T.chart}</b>
          <span className="rnSeg2 rnSegLight"><span className="isOn">{T.month}</span><span>{T.year}</span></span>
        </div>
        <svg viewBox="0 0 420 78" className="rnKpiChart">
          <path d="M0 70 H420 M0 46 H420 M0 22 H420" className="rnGrid" />
          <path d="M6 56 L58 50 L110 52 L162 40 L214 42 L266 30 L318 24 L370 20 L414 12 L414 78 L6 78 Z" className="rnArea rnFade" style={d(2300)} />
          <path d="M6 56 L58 50 L110 52 L162 40 L214 42 L266 30 L318 24 L370 20 L414 12" pathLength="1" className="rnDraw rnSerA" style={d(1700)} />
          <path d="M6 66 L58 64 L110 62 L162 58 L214 57 L266 52 L318 48 L370 47 L414 42" pathLength="1" className="rnDraw rnSerB" style={d(1850)} />
          <line x1="266" y1="6" x2="266" y2="76" className="rnCursor rnFade" style={d(2500)} />
          <circle cx="266" cy="30" r="3.5" className="rnDotA rnPop" style={d(2550)} />
          <circle cx="266" cy="52" r="3.5" className="rnDotB rnPop" style={d(2600)} />
        </svg>
        <div className="rnTip rnPop" style={{ left: 282, ...d(2650) }}>
          <b>06/26</b>
          <span><i className="isA" />{T.series[0]}<em>38,2 %</em></span>
          <span><i className="isB" />{T.series[1]}<em>14,6 %</em></span>
        </div>
      </div>
    </>
  );
}

/* l) Estructura: organigrama con participaciones, línea resaltada y ficha */
const ST_NODES = [
  { id: "NORVIA", x: 96, y: 18, w: 116, c: "#2440a8", root: true },
  { id: "NIB", x: 10, y: 106, w: 84, c: "#2440a8", pct: 70, sel: true },
  { id: "NUK", x: 112, y: 106, w: 84, c: "#7c3aed", pct: 100, dim: true },
  { id: "NUS", x: 214, y: 106, w: 84, c: "#0f8a62", pct: 85, dim: true },
  { id: "NPT", x: 10, y: 194, w: 84, c: "#2440a8", pct: 60, parent: "NIB" },
  { id: "NMX", x: 214, y: 194, w: 84, c: "#15803d", pct: 51, parent: "NUS", dim: true },
];
const ST_H = 40;
const stCol = (p) => (p >= 80 ? "#0f9f6e" : p >= 50 ? "#d97706" : "#e11d48");
function VStructure({ L, lang }) {
  const T = L.st;
  const byId = Object.fromEntries(ST_NODES.map(n => [n.id, n]));
  const edges = ST_NODES.filter(n => !n.root).map(n => {
    const p = byId[n.parent ?? "NORVIA"];
    const sx = p.x + p.w / 2, sy = p.y + ST_H, ex = n.x + n.w / 2, ey = n.y, my = sy + (ey - sy) / 2;
    const r = Math.min(8, Math.abs(ex - sx) / 2), sg = Math.sign(ex - sx);
    const dd = Math.abs(ex - sx) < 1 ? `M ${sx} ${sy} V ${ey}`
      : `M ${sx} ${sy} V ${my - r} Q ${sx} ${my} ${sx + sg * r} ${my} H ${ex - sg * r} Q ${ex} ${my} ${ex} ${my + r} V ${ey}`;
    return { k: n.id, d: dd, lx: ex, ly: my + (ey - my) / 2, pct: n.pct, on: !n.dim, depth: n.parent ? 2 : 1 };
  });
  const R = 22, C = 2 * Math.PI * R;
  return (
    <>
      <div className="rnCard rnUp rnStCanvas" style={{ left: 12, top: 12, width: 436, height: 290, ...d(40) }}>
        <svg className="rnStEdges" width="436" height="290">
          {edges.map(e => (
            <path key={e.k} d={e.d} pathLength="1" className={`rnDraw rnStEdge ${e.on ? "isOn" : "isDim"}`} style={d(350 + e.depth * 260)} />
          ))}
          {edges.map(e => (
            <g key={`p-${e.k}`} className={`rnPop rnStPill ${e.on ? "" : "isDim"}`} style={{ ...d(900 + e.depth * 200), transformOrigin: `${e.lx}px ${e.ly}px` }}>
              <rect x={e.lx - 17} y={e.ly - 8} width="34" height="16" rx="8" style={{ stroke: stCol(e.pct) }} />
              <text x={e.lx} y={e.ly + 3.5} textAnchor="middle" style={{ fill: stCol(e.pct) }}>{e.pct}%</text>
            </g>
          ))}
        </svg>
        {ST_NODES.map((n, i) => (
          <div key={n.id} className={`rnStNode rnPop ${n.root ? "isRoot" : ""} ${n.sel ? "isSel" : ""} ${n.dim ? "isDim" : ""}`}
            style={{ left: n.x, top: n.y, width: n.w, "--c": n.c, ...d(200 + i * 90) }}>
            <i>{n.id.slice(0, 3)}</i><b>{n.id}</b>
          </div>
        ))}
        <div className="rnStTools rnFade" style={d(1600)}>
          <span><Eye size={10} strokeWidth={2.6} />{T.find}</span><span>{T.fit}</span><span>{T.horiz}</span>
        </div>
        <div className="rnPanel rnSlideIn rnStPanel" style={d(1500)}>
          <div className="rnStPHead"><i>NIB</i><span><b>NIB</b><small>Norvia Ibérica S.L.</small></span></div>
          <div className="rnStPath rnUp" style={d(1800)}><em>NORVIA</em><ChevronRight size={9} strokeWidth={3} /><em className="isHere">NIB</em></div>
          <div className="rnStOwn rnUp" style={d(1950)}>
            <svg viewBox="-28 -28 56 56"><circle r={R} className="rnStTrack" /><circle r={R} className="rnStArc" style={{ strokeDasharray: `${C * 0.7} ${C}` }} transform="rotate(-90)" /></svg>
            <span><b><CountUp to={70} lang={lang} delay={2050} ms={900} />%</b><small>{T.ownership}</small></span>
          </div>
          <span className="rnStSince rnFade" style={d(2300)}>{T.since}</span>
          <span className="rnPill rnPillOk rnPop" style={d(2450)}><Check size={10} strokeWidth={3.2} />{T.consolidated}</span>
        </div>
      </div>
      <div className="rnHeat" style={{ left: 12, top: 318 }}>
        <span className="rnHeatL rnFade" style={d(2400)}><Route size={11} strokeWidth={2.6} />{T.periods}</span>
        {["c", "c", "c", "c", "c", "c", "c", "c", "p", "o", "n", "n"].map((st, i) => (
          <i key={i} className={`rnCell is-${st} rnPop`} style={d(2450 + i * 50)} />
        ))}
      </div>
    </>
  );
}

/* m) Acceso de usuarios: estado, seis indicadores y guardar juntos */
const ACC_USERS = [
  { n: "Ana Sousa", ini: "AS", c: "#d97706", st: 1, chips: [["18", "20"], ["1", "5"], [null, null]], changed: true },
  { n: "Carlos Ruiz", ini: "CR", c: "#16a34a", st: 1, chips: [[null, null], [null, null], [null, null]] },
  { n: "Laura Martín", ini: "LM", c: "#0284c7", st: 2, chips: [[null, null], [null, null], [null, null]] },
  { n: "Diego Hernández", ini: "DH", c: "#7c3aed", st: 1, chips: [[null, null], [null, null], ["0", "4"]], promote: true },
  { n: "Marta Gil", ini: "MG", c: "#94a3b8", st: 0, chips: [["2", "20"], [null, null], [null, null]] },
];
function VAccess({ L }) {
  const T = L.acc;
  const chipTxt = ([a, b]) => (a === null ? T.all : a === "0" ? T.none : `${a}/${b}`);
  return (
    <>
      <div className="rnCard rnUp rnAcc" style={{ left: 10, top: 14, width: 440, height: 296, ...d(40) }}>
        <div className="rnAccStats">
          {[T.users, T.active, T.admins].map((s, i) => <span key={s} className="rnPop" style={d(200 + i * 90)}>{s}</span>)}
        </div>
        <div className="rnAccHead"><span /><span /><span>{T.chips[0]}</span><span>{T.chips[1]}</span><span>{T.chips[2]}</span></div>
        {ACC_USERS.map((u, r) => (
          <div key={u.n} className={`rnAccRow rnUp ${u.st === 0 ? "isOff" : ""} ${u.changed ? "isChanged" : ""}`} style={d(300 + r * 90)}>
            <span className="rnAccWho"><i style={{ background: u.c }}>{u.ini}</i>{u.n}</span>
            <span className={`rnAccSeg ${u.promote ? "isPromote" : ""}`} data-st={u.st}>
              <em className="rnAccKnob" />
              {T.states.map(s => <span key={s}>{s}</span>)}
            </span>
            {u.chips.map((ch, i) => (
              <span key={i} className={`rnAccChip ${ch[0] === "0" ? "isNone" : ch[0] !== null ? "isPart" : ""}`}>{chipTxt(ch)}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="rnSaveBar rnPop" style={{ left: 50, top: 326, ...d(2100) }}>
        <i className="rnSaveDot" />{T.pending}
        <span className="rnSaveGhost">{T.discard}</span>
        <span className="rnSaveBtn"><Check size={11} strokeWidth={3} />{T.save}</span>
      </div>
    </>
  );
}

const PAGES = [
  { id: "intro", Vignette: VIntro, blob: [-30, -40], Icon: Sparkles },
  { id: "perf", Vignette: VPerf, blob: [40, -20], Icon: Zap },
  { id: "look", Vignette: VLook, blob: [-36, 24], Icon: Palette },
  { id: "multi", Vignette: VMulti, blob: [34, 30], Icon: CalendarRange },
  { id: "indiv", Vignette: VIndiv, blob: [-26, -30], Icon: Rows3 },
  { id: "dims", Vignette: VDims, blob: [30, -36], Icon: Layers },
  { id: "kpis", Vignette: VKpis, blob: [-40, 20], Icon: Gauge },
  { id: "cf", Vignette: VCashflow, blob: [-40, 30], Icon: Rows3 },
  { id: "contrib", Vignette: VContrib, blob: [30, 40], Icon: Route },
  { id: "structure", Vignette: VStructure, blob: [-30, 36], Icon: Network },
  { id: "pres", Vignette: VPres, blob: [-20, 10], Icon: Presentation },
  { id: "notes", Vignette: VNotes, blob: [40, -40], Icon: BookOpen },
  { id: "access", Vignette: VAccess, blob: [24, -26], Icon: UserCog },
];

/* ════════════════════════════════════════════════════════════════
   Estilos del escaparate
   ════════════════════════════════════════════════════════════════ */
const RN_CSS = `
.rnRoot { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 24px; font-family: inherit; line-height: 1.4; color: #0a1647; text-align: left; }
/* Reinicio local: la ventana se ve igual con o sin los estilos base de la app (Tailwind, etc.) */
.rnRoot *, .rnRoot *::before, .rnRoot *::after { box-sizing: border-box; }
.rnRoot :where(h2, h3, p, ol, ul, li) { margin: 0; padding: 0; }
.rnRoot :where(ol, ul) { list-style: none; }
.rnRoot :where(svg) { display: block; flex: none; }
.rnRoot :where(button) { line-height: inherit; }
.rnBackdrop { position: absolute; inset: 0; background: rgba(10,22,71,0.5); backdrop-filter: blur(14px) saturate(130%); -webkit-backdrop-filter: blur(14px) saturate(130%);
  animation: rnFadeIn 380ms ease both; }
.rnRoot.isClosing .rnBackdrop { animation: rnFadeOut 260ms ease both; }

.rnDialog { position: relative; display: flex; flex-direction: column; width: min(1180px, 100%); height: min(700px, calc(100vh - 48px)); height: min(700px, calc(100dvh - 48px)); border-radius: 34px; padding: 10px; outline: none;
  background: rgba(255,255,255,0.95); border: 1px solid #fff;
  backdrop-filter: blur(28px) saturate(150%); -webkit-backdrop-filter: blur(28px) saturate(150%);
  box-shadow: 0 50px 120px -30px rgba(5,12,50,0.65), 0 16px 40px -14px rgba(5,12,50,0.35);
  animation: rnDialogIn 640ms cubic-bezier(0.22,1,0.36,1) both; }
.rnRoot.isClosing .rnDialog { animation: rnDialogOut 260ms cubic-bezier(0.4,0,1,1) both; }
.rnBody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; touch-action: pan-y; }

/* Escenario: el mismo cielo azul del login */
.rnStage { position: relative; overflow: hidden; border-radius: 26px; isolation: isolate;
  background: linear-gradient(160deg, #1a2f8a 0%, #2c47b8 42%, #3a5cd9 70%, #7a9fef 100%); }
.rnStage::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0.5;
  background-image: radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1.2px); background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 85%); mask-image: radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 85%); }
.rnStage::after { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0.05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.rnBlob { position: absolute; z-index: 0; left: 50%; top: 45%; width: 460px; height: 460px; margin: -230px 0 0 -230px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,0.34), rgba(168,197,255,0.12) 45%, transparent 68%); filter: blur(30px);
  transition: transform 900ms cubic-bezier(0.22,1,0.36,1); }
.rnStageStack { position: absolute; inset: 0; z-index: 1; display: grid; }
.rnArtLayer { grid-area: 1 / 1; position: relative; }
.rnArt { position: absolute; left: 50%; top: 50%; width: ${ART_W}px; height: ${ART_H}px; margin: -${ART_H / 2}px 0 0 -${ART_W / 2}px; transform: scale(var(--s, 1)); }

/* Columna de texto */
.rnCopy { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 54px 44px 24px 38px; container-type: inline-size; }
.rnCopyStack { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.rnCopyStack::-webkit-scrollbar { display: none; }
.rnText { zoom: var(--fit, 1); }
.rnText { grid-area: 1 / 1; align-self: start; }
.rnMeta { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; }
.rnNum { font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: rgba(26,47,138,0.4); letter-spacing: 0.06em; }
.rnEyebrow { font-size: 10px; font-weight: 900; letter-spacing: 0.22em; text-transform: uppercase; color: #e8394a; }
.rnTag { padding: 3px 8px; border-radius: 999px; font-size: 9px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #1a2f8a; background: rgba(26,47,138,0.08); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.rnTag.isNew { color: #fff; background: #e8394a; box-shadow: 0 6px 14px -6px rgba(232,57,74,0.8); }
.rnTitle { margin: 0 0 14px; font-size: clamp(26px, 2.6vw, 37px); line-height: 1.06; font-weight: 900; letter-spacing: -0.03em; color: #0a1647; }
.rnDesc { margin: 0 0 24px; font-size: 15px; line-height: 1.55; font-weight: 500; color: rgba(26,47,138,0.66); max-width: 34rem; }
.rnList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
.rnList li { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 1.45; font-weight: 600; color: rgba(10,22,71,0.84); }
.rnList .rnTickL { flex: none; width: 20px; height: 20px; margin-top: -1px; border-radius: 7px; display: grid; place-items: center; color: #1a2f8a; background: rgba(26,47,138,0.08); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }

/* Pie: puntos de progreso y navegación */
.rnFoot { flex: none; display: flex; align-items: center; gap: 12px; min-width: 0; padding-top: 18px; margin-top: 12px; border-top: 1px solid rgba(26,47,138,0.08); }
.rnDots { display: flex; align-items: center; gap: 2px; min-width: 0; }
.rnDot { position: relative; width: 14px; height: 26px; border: 0; padding: 0; background: transparent; cursor: pointer; border-radius: 8px; }
.rnDot::before { content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 999px; background: rgba(26,47,138,0.2);
  transition: width 420ms cubic-bezier(0.22,1,0.36,1), margin 420ms cubic-bezier(0.22,1,0.36,1), background 300ms ease; }
.rnDot:hover::before { background: rgba(26,47,138,0.45); }
.rnDot.isOn { width: 28px; }
.rnDot.isOn::before { width: 20px; margin-left: -10px; background: #e8394a; }
.rnDot.isDone::before { background: rgba(26,47,138,0.5); }
.rnDot:focus-visible { outline: 2px solid rgba(26,47,138,0.45); outline-offset: 1px; }
.rnCounter { white-space: nowrap; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: rgba(26,47,138,0.45); font-variant-numeric: tabular-nums; }
.rnNav { flex: none; margin-left: auto; display: flex; align-items: center; gap: 8px; }
.rnPrev { width: 46px; height: 46px; border-radius: 16px; border: 0; display: grid; place-items: center; cursor: pointer; color: #1a2f8a; background: rgba(26,47,138,0.07);
  box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); transition: background 200ms ease, transform 300ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease; }
.rnPrev:hover { background: rgba(26,47,138,0.13); transform: translateX(-2px); }
.rnPrev[aria-disabled="true"] { opacity: 0.35; cursor: default; transform: none; background: rgba(26,47,138,0.07); }
.rnNext { position: relative; overflow: hidden; height: 46px; padding: 0 20px 0 22px; border: 0; border-radius: 16px; cursor: pointer; color: #fff; font: inherit; font-size: 13.5px; font-weight: 900; letter-spacing: 0.02em;
  display: inline-flex; align-items: center; gap: 8px; min-width: 124px; justify-content: center; white-space: nowrap;
  background: #e8394a; box-shadow: 0 14px 30px -12px rgba(232,57,74,0.7), inset 0 1px 0 rgba(255,255,255,0.2);
  transition: transform 280ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 250ms ease, background 250ms ease; }
.rnNext:hover { transform: translateY(-1px); box-shadow: 0 18px 36px -12px rgba(232,57,74,0.8), inset 0 1px 0 rgba(255,255,255,0.25); }
.rnNext:active { transform: scale(0.98); }
.rnNext.isLast { background: linear-gradient(90deg, #e8394a 0%, #e8394a 40%, #ff5563 50%, #e8394a 60%, #e8394a 100%); background-size: 200% 100%; animation: rnShimmer 3s linear infinite; }
.rnNext svg { transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1); }
.rnNext:hover svg { transform: translateX(3px); }
.rnPrev:focus-visible, .rnNext:focus-visible, .rnClose:focus-visible { outline: 3px solid rgba(26,47,138,0.4); outline-offset: 3px; }
.rnClose { position: absolute; top: 18px; right: 18px; z-index: 5; width: 38px; height: 38px; border-radius: 13px; border: 0; display: grid; place-items: center; cursor: pointer;
  color: #1a2f8a; background: rgba(255,255,255,0.85); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.12), 0 8px 20px -10px rgba(5,12,50,0.4);
  transition: background 200ms ease, transform 300ms cubic-bezier(0.34,1.56,0.64,1); }
.rnClose:hover { background: #fff; transform: rotate(90deg); }
.rnSr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Transición entre páginas (sensible a la dirección: --dir = 1 | -1) */
.rnArtLayer.isEnter { animation: rnArtIn 640ms cubic-bezier(0.22,1,0.36,1) 110ms both; }
.rnArtLayer.isLeave, .rnText.isLeave { pointer-events: none; animation: rnLeave 260ms cubic-bezier(0.4,0,1,1) both; }
.rnText.isLeave { animation-duration: 190ms; }
.rnText.isEnter > :not(ul), .rnText.isEnter li { animation: rnTextIn 620ms cubic-bezier(0.22,1,0.36,1) calc(170ms + var(--k, 0) * 55ms) both; }

/* ── Piezas de las viñetas ───────────────────────────────────────── */
.rnArt { --navy: #1a2f8a; --ink: #0a1647; --red: #e8394a; --sky: #7a9fef; --ok: #16a34a; font-size: 11px; line-height: 1.22; }
.rnArt > * { position: absolute; }
.rnSvg { left: 0; top: 0; overflow: visible; pointer-events: none; }
.rnUp { animation: rnUp 640ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.rnPop { animation: rnPop 560ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both; }
.rnFade { animation: rnFadeIn 600ms ease calc(var(--d, 0) * 1ms) both; }
.rnDraw { stroke-dasharray: 1; animation: rnDraw 900ms cubic-bezier(0.65,0,0.35,1) calc(var(--d, 0) * 1ms) both; }
.rnSlideIn { animation: rnSlideIn 760ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }

.rnCard { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 60px -26px rgba(5,12,50,0.7), 0 0 0 1px rgba(255,255,255,0.7); }
.rnPanel { background: rgba(255,255,255,0.96); border-radius: 16px; padding: 14px; box-shadow: 0 30px 60px -20px rgba(5,12,50,0.75), 0 0 0 1px rgba(255,255,255,0.8); }
.rnCardHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 40px; padding: 0 14px; border-bottom: 1px solid rgba(26,47,138,0.07); }
.rnCardHead b, .rnPanelHead { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 900; color: var(--ink); letter-spacing: -0.01em; white-space: nowrap; }
.rnCardHead b svg, .rnPanelHead svg { color: var(--red); }
.rnPill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 800; color: var(--navy); background: rgba(26,47,138,0.07); white-space: nowrap; }
.rnPillOk { color: #0f7a36; background: rgba(22,163,74,0.12); box-shadow: inset 0 0 0 1px rgba(22,163,74,0.2); }
.rnMicro { margin: 0; font-size: 9px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(26,47,138,0.5); white-space: nowrap; }
.rnEyeSm { margin: 0 0 10px; font-size: 9px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; color: var(--red); }
.rnTick { flex: none; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--ok); box-shadow: 0 4px 10px -4px rgba(22,163,74,0.8); }
.rnChip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 8px; font-size: 10px; font-weight: 800; color: var(--navy); background: #f2f5fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); white-space: nowrap; }
.rnChipDark { color: #fff; background: var(--navy); box-shadow: none; }
.rnFloat { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 10px; font-size: 10.5px; font-weight: 800; color: #fff; white-space: nowrap;
  background: rgba(10,22,71,0.5); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.rnFloat svg { color: #a8c5ff; }

/* a) Intro */
.rnRing { fill: none; stroke: rgba(255,255,255,0.22); stroke-width: 1; stroke-dasharray: 2 6; }
.rnRingB { stroke: rgba(255,255,255,0.16); }
.rnOrbit { transform-origin: ${INTRO_C.x}px ${INTRO_C.y}px; animation: rnRot 60s linear infinite; }
.rnLine { fill: none; stroke: rgba(255,255,255,0.32); stroke-width: 1.2; }
.rnLineFlow { stroke: rgba(255,255,255,0.75); stroke-width: 1.2; stroke-dasharray: 3 9; animation: rnFadeIn 600ms ease calc(var(--d, 0) * 1ms) both, rnFlow 1.6s linear infinite; }
.rnPacket { left: 0; top: 0; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #ffd6aa; box-shadow: 0 0 10px 2px rgba(255,214,170,0.7);
  offset-rotate: 0deg; animation: rnTravel 2.1s cubic-bezier(0.45,0,0.55,1) infinite both; }
.rnHalo { width: 150px; height: 150px; margin: -75px 0 0 -75px; border-radius: 50%; background: radial-gradient(circle, rgba(168,197,255,0.5), transparent 68%); animation: rnHalo 3.2s ease-in-out 900ms infinite both; }
.rnCoreV { width: 132px; height: 132px; margin: -66px 0 0 -66px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff;
  background: radial-gradient(circle at 35% 28%, #6f8ff0 0%, #3a5cd9 45%, #22399e 100%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 10px 24px rgba(255,255,255,0.18), 0 24px 60px -18px rgba(5,12,50,0.8), 0 0 70px rgba(168,197,255,0.55); }
.rnCoreV small { font-size: 9px; font-weight: 900; letter-spacing: 0.24em; text-transform: uppercase; opacity: 0.75; margin-bottom: 2px; }
.rnCoreV b { font-size: 50px; font-weight: 900; letter-spacing: -0.05em; line-height: 0.95; text-shadow: 0 0 30px rgba(255,255,255,0.5); }
.rnNode { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px 6px 6px; border-radius: 12px; transform: translate(-50%, -50%); white-space: nowrap;
  font-size: 11.5px; font-weight: 800; color: var(--ink); background: #fff; box-shadow: 0 16px 30px -14px rgba(5,12,50,0.75); }
.rnNode.rnPop { animation-name: rnPopC; }
.rnNodeIco { width: 22px; height: 22px; border-radius: 8px; display: grid; place-items: center; color: var(--navy); background: rgba(26,47,138,0.08); }
.rnNode em { font-style: normal; font-size: 8px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #fff; background: var(--red); padding: 2px 5px; border-radius: 5px; }

/* b) Rendimiento */
.rnPerfGrid { display: grid; grid-template-columns: 112px 1fr; gap: 18px; padding: 20px 20px 18px 16px; height: 100%; box-sizing: border-box; }
.rnPerfCore { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border-right: 1px dashed rgba(26,47,138,0.12); padding-right: 14px; }
.rnMiniCore { position: relative; width: 78px; height: 78px; border-radius: 50%; display: grid; place-items: center; color: #fff;
  background: radial-gradient(circle at 35% 28%, #4a6be0, #1a2f8a 70%); box-shadow: 0 14px 30px -12px rgba(26,47,138,0.8), inset 0 0 0 1px rgba(255,255,255,0.25); }
.rnMiniCoreK { font-weight: 900; font-size: 18px; letter-spacing: -0.02em; animation: rnFadeOut 300ms ease 1500ms both; }
.rnMiniCoreOk { position: absolute; inset: 0; margin: auto; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--ok); box-shadow: 0 0 0 6px rgba(22,163,74,0.18); }
.rnSpinRing { position: absolute; inset: -6px; width: 90px; height: 90px; animation: rnRot 1s linear infinite, rnFadeOut 300ms ease 1500ms both; }
.rnSpinRing circle { fill: none; stroke: var(--red); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 60 200; }
.rnLoadRow { display: grid; grid-template-columns: 102px 1fr 16px; align-items: center; gap: 10px; height: 26px; }
.rnLoadL { font-size: 11px; font-weight: 700; color: rgba(10,22,71,0.78); white-space: nowrap; }
.rnTrack { position: relative; height: 6px; border-radius: 99px; overflow: hidden; background: rgba(26,47,138,0.08); }
.rnFillBar { position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(90deg, #1a2f8a, #3a5cd9 70%, #7a9fef); transform-origin: left;
  animation-name: rnGrowX; animation-timing-function: cubic-bezier(0.55,0,0.25,1); animation-fill-mode: both; }
.rnConnector { left: 230px; top: 222px; width: 1px; height: 26px; background: repeating-linear-gradient(180deg, rgba(255,255,255,0.8) 0 3px, transparent 3px 7px); }
.rnConnector span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 9px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.85); white-space: nowrap; }
.rnKpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px 14px; }
.rnKpi { display: flex; flex-direction: column; gap: 3px; padding: 9px 10px; border-radius: 11px; background: #f6f8fe; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.07); }
.rnKpiL { font-size: 9px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(26,47,138,0.5); }
.rnKpiV { font-size: 16px; font-weight: 900; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rnKpiFoot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.rnDelta { font-size: 9px; font-weight: 900; color: #0f7a36; white-space: nowrap; }
.rnSpark { width: 46px; height: 16px; overflow: visible; }
.rnSpark path { fill: none; stroke: var(--navy); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* c) Cash flow */
.rnCf { display: flex; flex-direction: column; }
.rnCfHead, .rnCfRow { display: flex; align-items: center; }
.rnCfHead { height: 28px; background: #f4f6fc; border-bottom: 1px solid rgba(26,47,138,0.07); font-size: 9.5px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,47,138,0.55); }
.rnCfAcc { position: relative; flex: none; width: 196px; box-sizing: border-box; padding-left: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rnCfHead .rnCfAcc { overflow: visible; }
.rnCfResize { animation: rnResize 760ms cubic-bezier(0.65,0,0.35,1) 900ms both; }
.rnCfCo { flex: none; width: 72px; box-sizing: border-box; padding-right: 12px; display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; font-variant-numeric: tabular-nums; }
.rnCfHead .rnCfCo { height: 22px; border-radius: 7px; }
.rnCfHead .rnCfCo svg { opacity: 0.45; }
.rnSwapA { animation: rnSwapA 900ms cubic-bezier(0.65,0,0.35,1) 1900ms both; }
.rnSwapB { position: relative; z-index: 2; animation: rnSwapB 900ms cubic-bezier(0.65,0,0.35,1) 1900ms both; }
.rnCfHead .rnSwapB { animation-name: rnSwapBLift; }
.rnHandle { position: absolute; right: 0; top: 4px; bottom: 4px; width: 3px; border-radius: 3px; background: #3a5cd9; opacity: 0; animation: rnHandle 1300ms ease 700ms both; }
.rnHandleTip { position: absolute; right: -11px; top: -3px; width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; color: #fff; background: #3a5cd9; opacity: 0; box-shadow: 0 6px 14px -6px rgba(58,92,217,0.9);
  animation: rnHandle 1300ms ease 700ms both; }
.rnCfBody { position: relative; flex: 1; min-height: 0; overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 14px, #000 calc(100% - 14px), transparent); mask-image: linear-gradient(180deg, transparent, #000 14px, #000 calc(100% - 14px), transparent); }
.rnCfScroll { animation: rnScroll 18s linear 500ms infinite both; }
.rnCfRow { height: 24px; font-size: 10.5px; font-weight: 600; color: rgba(10,22,71,0.8); border-bottom: 1px solid rgba(26,47,138,0.04); }
.rnCfRow.lvl0 { font-weight: 900; color: var(--ink); background: rgba(26,47,138,0.03); }
.rnCfRow.lvl2 { color: rgba(10,22,71,0.62); font-weight: 500; }
.rnCfRow .isNeg { color: var(--red); }
.rnCfTotal { height: 30px; flex: none; font-weight: 900; color: var(--ink); background: #f4f6fc; border-top: 1.5px solid rgba(26,47,138,0.18); }
.rnScrollbar { position: absolute; right: 3px; top: 6px; bottom: 6px; width: 4px; border-radius: 4px; background: rgba(26,47,138,0.06); }
.rnScrollbar i { position: absolute; left: 0; right: 0; top: 0; height: 26px; border-radius: 4px; background: rgba(26,47,138,0.35); animation: rnThumb 18s linear 500ms infinite both; }
.rnDrill { display: flex; align-items: center; flex-wrap: nowrap; }
.rnDrillStep { display: inline-flex; align-items: center; }
.rnDrillArr { color: rgba(255,255,255,0.7); margin: 0 3px; }
.rnDrillChip { padding: 6px 9px; border-radius: 9px; font-size: 10.5px; font-weight: 800; white-space: nowrap; color: var(--navy); background: rgba(255,255,255,0.88);
  box-shadow: 0 10px 20px -12px rgba(5,12,50,0.7); animation: rnLit 3600ms ease infinite both; }

/* d) Contributivo */
.rnBars { display: flex; justify-content: flex-start; gap: 22px; align-items: flex-end; height: 202px; padding: 16px 18px 0 20px; border-bottom: 1px solid rgba(26,47,138,0.08); }
.rnBarCol { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.rnStack { display: flex; flex-direction: column-reverse; width: 46px; }
.rnSeg { display: block; width: 100%; box-sizing: border-box; border-top: 1.5px solid #fff; transform-origin: bottom; animation: rnGrowY 520ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.rnStack .rnSeg:first-child { border-radius: 0 0 5px 5px; }
.rnStack .rnSeg:last-child { border-radius: 5px 5px 0 0; }
.seg-data { background: #1a2f8a; } .seg-sys { background: #3a5cd9; } .seg-aje { background: #7a9fef; } .seg-rje { background: #fbbf24; }
.seg-eje { background: repeating-linear-gradient(135deg, #e8394a 0 4px, #f2707c 4px 7px); }
.seg-ic { background: repeating-linear-gradient(135deg, #10b981 0 3px, #8fe3c3 3px 6px); }
.rnBarLab { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; font-weight: 900; color: var(--ink); letter-spacing: 0.04em; }
.rnBarLab svg { opacity: 0.4; }
.rnBarSub { margin-top: -5px; margin-bottom: 8px; font-size: 8.5px; font-weight: 800; color: var(--red); text-transform: uppercase; letter-spacing: 0.12em; }
.rnLegend { display: grid; grid-template-columns: repeat(2, auto); justify-content: start; gap: 7px 22px; padding: 12px 16px 0 20px; }
.rnLegendI { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 700; color: rgba(10,22,71,0.7); white-space: nowrap; }
.rnLegendI i { width: 9px; height: 9px; border-radius: 3px; }
.rnRecon { position: absolute; left: 14px; bottom: 14px; }
.rnPanelHead { margin-bottom: 12px; }
.rnDrillCard { box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; }
.rnDrillCard .rnPanelHead { margin-bottom: 2px; font-size: 11px; }
.rnDrillLine { display: grid; grid-template-columns: 50px 1fr 30px; align-items: center; gap: 8px; }
.rnDrillLine em { font-style: normal; font-size: 9.5px; font-weight: 900; color: var(--ink); text-align: right; font-variant-numeric: tabular-nums; }
.rnMicroL { margin-bottom: 3px; }
.rnBig { margin: 0 0 14px; font-size: 21px; font-weight: 900; letter-spacing: -0.03em; color: var(--ink); font-variant-numeric: tabular-nums; }
.rnTrail { position: relative; list-style: none; margin: 0; padding: 0 0 0 2px; display: flex; flex-direction: column; gap: 11px; }
.rnTrail li { position: relative; display: flex; align-items: center; gap: 10px; font-size: 10.5px; font-weight: 700; color: rgba(10,22,71,0.78); white-space: nowrap; }
.rnTrailLine { position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; margin-left: -0.5px; border-radius: 2px; background: linear-gradient(180deg, rgba(26,47,138,0.3), rgba(232,57,74,0.5)); transform-origin: top; animation: rnGrowY 900ms cubic-bezier(0.65,0,0.35,1) 1400ms both; }
.rnTrailDot { position: relative; flex: none; width: 10px; height: 10px; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 2px var(--navy); }
.rnTrailDot.isEnd { background: var(--red); box-shadow: 0 0 0 4px rgba(232,57,74,0.18); }
.rnTrail li:last-child { color: var(--ink); font-weight: 900; }

/* e) Presentaciones */
.rnPresBar { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 10px; border-bottom: 1px solid rgba(26,47,138,0.07); }
.rnChipPeriod { animation: rnRingPulse 1000ms ease 2300ms both; }
.rnAvatars { display: inline-flex; margin-right: 2px; }
.rnAvatars i:nth-child(1) { z-index: 3; } .rnAvatars i:nth-child(2) { z-index: 2; }
.rnAvatars i { position: relative; width: 22px; height: 22px; margin-left: -6px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 8px; font-weight: 900; color: #fff; box-shadow: 0 0 0 2px #fff; }
.rnPresBody { display: flex; gap: 12px; padding: 12px 12px 12px 10px; }
.rnRail { display: flex; flex-direction: column; gap: 8px; }
.rnThumb { position: relative; display: flex; flex-direction: column; gap: 3px; width: 58px; height: 33px; padding: 5px; box-sizing: border-box; border-radius: 6px; background: #f4f6fc; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); overflow: hidden; }
.rnThumb i { display: block; height: 3px; border-radius: 2px; background: rgba(26,47,138,0.2); }
.rnThumb i:first-child { width: 60%; background: rgba(26,47,138,0.45); }
.rnThumb i:nth-child(2) { width: 85%; } .rnThumb i:nth-child(3) { width: 40%; background: rgba(232,57,74,0.5); }
.rnThumb.isOn { box-shadow: 0 0 0 2px var(--red); background: #fff; }
.rnThumb::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(122,159,239,0.45) 50%, transparent 70%); transform: translateX(-110%); animation: rnSweep 900ms ease 2450ms both; }
.rnSlide { position: relative; flex: 1; height: 202px; box-sizing: border-box; padding: 12px 14px; border-radius: 8px; background: #fff; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(26,47,138,0.1), 0 12px 24px -16px rgba(5,12,50,0.5); }
.rnSlide::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--red); }
.rnSlideEye { margin: 0; font-size: 7.5px; font-weight: 900; letter-spacing: 0.2em; text-transform: uppercase; color: var(--red); }
.rnSlideTitle { margin: 2px 0 9px; font-size: 14px; font-weight: 900; letter-spacing: -0.02em; color: var(--ink); }
.rnSlideKpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.rnSlideKpi { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: 7px; background: #f6f8fe; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.07); }
.rnSlideKpiL { font-size: 7px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(26,47,138,0.5); }
.rnSlideKpi b { font-size: 13px; font-weight: 900; color: var(--ink); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.rnSlideKpi .rnDelta { font-size: 8px; }
.rnSlideBottom { display: grid; grid-template-columns: 1.25fr 1fr; gap: 10px; margin-top: 9px; align-items: center; }
.rnSlideChart { width: 100%; height: 66px; overflow: visible; }
.rnGrid { stroke: rgba(26,47,138,0.07); stroke-width: 1; fill: none; }
.rnSerA { fill: none; stroke: var(--navy); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.rnSerB { fill: none; stroke: rgba(232,57,74,0.6); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.rnSlideTable { display: flex; flex-direction: column; gap: 5px; }
.rnSlideTable span { display: flex; justify-content: space-between; gap: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(26,47,138,0.07); font-size: 8.5px; }
.rnSlideTable em { font-style: normal; font-weight: 700; color: rgba(10,22,71,0.7); white-space: nowrap; }
.rnSlideTable b { font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; }
.rnSwapTxt { display: inline-grid; }
.rnSwapTxt > span { grid-area: 1 / 1; }
.rnOld { animation: rnFadeOut 260ms ease 2450ms both; }
.rnNew { animation: rnSwapIn 520ms cubic-bezier(0.22,1,0.36,1) 2600ms both; }
.rnDesigns { display: flex; align-items: center; gap: 8px; }
.rnDesign { position: relative; width: 40px; height: 25px; border-radius: 5px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,0.5), 0 8px 16px -8px rgba(5,12,50,0.7); }
.rnDesign i:first-child { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.rnDesign i:last-child { position: absolute; left: 9px; top: 7px; width: 18px; height: 3px; border-radius: 2px; background: currentColor; opacity: 0.35; }
.rnDesigns .rnFloat { margin-left: 6px; }

/* f) Memoria */
.rnWizard { display: flex; align-items: center; gap: 8px; }
.rnWizard .rnMicro { color: rgba(255,255,255,0.75); margin-right: 2px; }
.rnSeg2 { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(10,22,71,0.35); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); }
.rnSeg2 span { padding: 4px 8px; border-radius: 7px; font-size: 9.5px; font-weight: 800; color: rgba(255,255,255,0.75); white-space: nowrap; }
.rnSeg2 span.isOn { color: var(--navy); background: #fff; box-shadow: 0 4px 10px -4px rgba(5,12,50,0.6); }
.rnMoves { padding: 8px 14px 0; }
.rnMoveRow { display: grid; grid-template-columns: 1fr 66px 66px; align-items: center; height: 29px; font-size: 11px; font-weight: 600; color: rgba(10,22,71,0.8); border-bottom: 1px solid rgba(26,47,138,0.05); }
.rnMoveRow > span:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; padding-right: 4px; }
.rnMoveRow > span:nth-child(3) { color: rgba(10,22,71,0.5); }
.rnMoveHead { height: 22px; font-size: 9px; font-weight: 900; letter-spacing: 0.12em; color: rgba(26,47,138,0.5); }
.rnMoveRow.isTotal { font-weight: 900; color: var(--ink); border-top: 1.5px solid rgba(26,47,138,0.3); border-bottom: 0; }
.rnLinkSrc { position: relative; border-radius: 6px; animation: rnLinkHi 600ms ease 1650ms both; }
.rnMoveFoot { display: flex; gap: 6px; padding: 12px 14px; }
.rnLinkPath { fill: none; stroke: #fff; stroke-width: 1.6; stroke-dasharray: 1; filter: drop-shadow(0 0 4px rgba(255,255,255,0.8)); }
.rnLinkEnd { fill: #fff; transform-box: fill-box; transform-origin: center; }
.rnReview { display: flex; flex-direction: column; gap: 7px; padding: 12px; }
.rnReview .rnPanelHead { margin-bottom: 3px; }
.rnReviewRow { display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; font-weight: 700; color: rgba(10,22,71,0.78); }
.rnWhere { padding: 10px 12px; box-shadow: 0 30px 60px -20px rgba(5,12,50,0.75), 0 0 0 2px rgba(255,255,255,0.9), 0 0 24px rgba(255,255,255,0.35); transform-origin: left center; }
.rnWhereQ { margin: 0 0 5px; font-size: 8.5px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: var(--red); }
.rnWhereA { display: flex; gap: 5px; align-items: flex-start; margin: 0; font-size: 10px; line-height: 1.3; font-weight: 800; color: var(--ink); }
.rnWhereA svg { flex: none; color: #3a5cd9; margin-top: 1px; }
.rnWhereA small { display: block; font-size: 8.5px; font-weight: 700; color: rgba(26,47,138,0.55); margin-bottom: 1px; }
.rnWhereV { margin: 5px 0 0 17px; font-size: 13px; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; }
.rnExport { display: flex; align-items: center; gap: 7px; }
.rnExport .rnMicro { color: rgba(255,255,255,0.75); margin-right: 3px; }
.rnExport .rnChip { background: #fff; }


/* g) Diseño común */
.rnLook { display: flex; flex-direction: column; }
.rnLkRow { position: relative; display: flex; align-items: center; height: 30px; flex: none; font-size: 10.5px; font-weight: 600; color: rgba(10,22,71,0.82); border-bottom: 1px solid rgba(26,47,138,0.05);
  animation: rnRowHover 5s ease calc(2400ms + var(--i, 0) * 1000ms) infinite both; }
.rnLkRow::before { content: ""; position: absolute; left: 3px; top: 50%; width: 3px; height: 0; margin-top: 0; border-radius: 3px; background: var(--navy);
  animation: rnRowBar 5s ease calc(2400ms + var(--i, 0) * 1000ms) infinite both; }
.rnLkHead { height: 26px; font-size: 9px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,47,138,0.55); background: #f4f6fc; animation: none; }
.rnLkHead::before { display: none; }
.rnLkAcc { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px; padding-left: 14px; white-space: nowrap; overflow: hidden; }
.rnLkCode { font-style: normal; font-family: 'SF Mono', Menlo, monospace; font-size: 8.5px; font-weight: 700; padding: 2px 5px; border-radius: 5px; color: #7c879c; background: #f3f5fa; }
.rnLkVal { flex: none; width: 82px; text-align: center; }
.rnLkVal b { display: inline-block; padding: 3px 7px; border-radius: 999px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.rnLkVal b.isNeg, .isNeg { color: #e11d48; }
.rnLkCmp { flex: none; display: flex; overflow: hidden; width: 0; animation: rnLkOpen 900ms cubic-bezier(0.22,1,0.36,1) 2500ms both; }
.rnLkC { position: relative; flex: none; height: 30px; display: grid; place-items: center; font-variant-numeric: tabular-nums; }
.rnLkHead .rnLkC { height: 26px; }
.rnLkC.c1 { width: 70px; background: rgba(26,47,138,0.025); border-left: 2px solid rgba(26,47,138,0.1); }
.rnLkC.c2 { width: 66px; background: rgba(26,47,138,0.05); }
.rnLkC.c3 { width: 56px; background: rgba(26,47,138,0.08); }
.rnShim { position: absolute; inset: 8px 8px; border-radius: 999px; background: linear-gradient(90deg, #eef1f7 0%, #dfe6fb 45%, #eef1f7 90%); background-size: 220% 100%;
  animation: rnShimmerBg 1.1s ease-in-out infinite, rnFadeOut 260ms ease 3350ms both; }
.rnLkIn { font-style: normal; font-weight: 800; color: var(--ink); animation: rnSwapIn 420ms cubic-bezier(0.22,1,0.36,1) 3450ms both; }
.rnDev { padding: 2px 6px; border-radius: 999px; font-size: 9.5px; }
.rnDev.isUp { color: #0f7a36; background: rgba(22,163,74,0.1); }
.rnDev.isDown { color: #c81e4a; background: rgba(225,29,72,0.09); }
.rnLkBk { position: relative; flex: none; height: 22px; margin: 6px 0 2px; overflow: hidden; border-radius: 6px; transform-origin: left;
  background: linear-gradient(90deg, var(--sec) 0%, color-mix(in srgb, var(--sec) 60%, #fff) 55%, color-mix(in srgb, var(--sec) 6%, #fff) 100%);
  animation: rnBkGrow 760ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.rnLkBk::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 30%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent); transform: translateX(-120%);
  animation: rnBkShine 3.6s ease-in-out calc(var(--d, 0) * 1ms + 700ms) infinite; }
.rnLkBk span { position: relative; z-index: 1; display: block; padding-left: 12px; line-height: 22px; font-size: 8.5px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: #fff; }
.rnLkLoader { position: absolute; inset: 40px 0 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  background: rgba(246,248,252,0.9); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: rnFadeOut 380ms ease 1420ms both; pointer-events: none; }
.rnLkLoader p { margin: 0; font-size: 11px; font-weight: 800; color: var(--ink); }
.rnLkRing { position: relative; width: 74px; height: 74px; display: grid; place-items: center; }
.rnLkRing svg { position: absolute; inset: 0; width: 74px; height: 74px; overflow: visible; }
.rnLkTrack { fill: none; stroke: #e8ecf5; stroke-width: 6; }
.rnLkArc { fill: none; stroke: var(--navy); stroke-width: 6; stroke-linecap: round; stroke-dashoffset: var(--c); animation: rnArcFill 1150ms cubic-bezier(0.55,0,0.25,1) 150ms both; }
.rnLkRing span { font-size: 16px; font-weight: 900; color: var(--navy); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.rnLkPhases { display: flex; gap: 5px; }
.rnLkPh { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px 3px 4px; border-radius: 999px; font-size: 9px; font-weight: 800; color: rgba(26,47,138,0.45); background: #fff;
  box-shadow: inset 0 0 0 1px rgba(26,47,138,0.08); animation: rnPhDone 300ms ease calc(var(--d, 0) * 1ms) both; }
.rnLkPh i { width: 13px; height: 13px; border-radius: 50%; display: grid; place-items: center; color: transparent; box-shadow: inset 0 0 0 1.5px #d5dbe6; animation: rnPhDot 300ms ease calc(var(--d, 0) * 1ms) both; }
.rnPages { display: flex; flex-wrap: wrap; gap: 6px; max-width: 432px; }
.rnPageChip { padding: 5px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 800; color: #fff; white-space: nowrap;
  background: rgba(10,22,71,0.32); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.3); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }

/* h) Multiperiodo */
.rnPickBody { display: flex; flex-direction: column; padding: 8px 10px 10px; }
.rnPickYear { margin: 4px 0 2px; font-size: 9px; font-weight: 900; letter-spacing: 0.12em; color: rgba(26,47,138,0.45); }
.rnPickRow { display: flex; align-items: center; gap: 8px; height: 22px; padding: 0 4px; border-radius: 7px; font-size: 11px; font-weight: 700; color: var(--ink); }
.rnBox { width: 14px; height: 14px; flex: none; border-radius: 4px; display: grid; place-items: center; color: #fff; box-shadow: inset 0 0 0 1.5px #cfd6e4; }
.rnBox.isOn { background: var(--navy); box-shadow: none; animation: rnBoxOn 360ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both; }
.rnSum, .rnCmpList, .rnWiz { box-sizing: border-box; }
.rnSum { display: flex; flex-direction: column; gap: 9px; }
.rnSum .rnPanelHead { margin-bottom: 0; }
.rnSumRow { display: flex; flex-direction: column; gap: 5px; padding: 8px 9px; border-radius: 11px; background: #f6f8fe; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.07); }
.rnSumLab { font-size: 10.5px; font-weight: 900; color: var(--ink); }
.rnSumEq { display: flex; align-items: center; gap: 5px; }
.rnSumEq em { font-style: normal; font-weight: 900; color: var(--red); }
.rnKey { font-style: normal; padding: 3px 7px; border-radius: 7px; font-size: 9.5px; font-weight: 800; color: #fff; background: var(--navy); white-space: nowrap; }
.rnKey.isSoft { color: var(--navy); background: rgba(26,47,138,0.1); }
.rnSumLoad { grid-template-columns: 1fr 52px 16px; height: 22px; }
.rnMultiBadge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 9px 4px 4px; border-radius: 999px; font-size: 9.5px; font-weight: 700; color: var(--navy); background: rgba(26,47,138,0.06); white-space: nowrap; }
.rnMultiBadge b { padding: 2px 7px; border-radius: 999px; font-size: 9px; color: #fff; background: var(--navy); }
.rnMtHead, .rnMtRow { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
.rnMtHead { height: 22px; font-size: 9px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,47,138,0.5); background: #f4f6fc; }
.rnMtRow { height: 22px; font-size: 11px; font-weight: 600; color: rgba(10,22,71,0.82); border-bottom: 1px solid rgba(26,47,138,0.05); }
.rnMtRow span:last-child { font-weight: 800; font-variant-numeric: tabular-nums; }
.rnMtRow.isTotal { font-weight: 900; color: var(--ink); border-bottom: 0; }

/* i) Individuales */
.rnIndRow { display: flex; align-items: center; height: 30px; font-size: 10.5px; font-weight: 600; color: rgba(10,22,71,0.82); border-bottom: 1px solid rgba(26,47,138,0.05); }
.rnIndHead { height: 40px; font-size: 9.5px; font-weight: 900; color: var(--navy); background: #f8f9fd; }
.rnIndRow.isTotal { font-weight: 900; color: var(--ink); border-bottom: 0; }
.rnIndAcc { flex: none; width: 92px; padding-left: 14px; box-sizing: border-box; white-space: nowrap; }
.rnIndHead .rnIndAcc { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,47,138,0.55); }
.rnIndMon { flex: none; width: 88px; display: flex; flex-direction: column; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; font-weight: 800; }
.rnIndMon b { font-size: 10.5px; font-weight: 900; }
.rnHistPill { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 999px; font-style: normal; font-size: 7.5px; font-weight: 800; color: var(--navy); background: rgba(26,47,138,0.08);
  animation: rnHistPress 700ms ease 700ms both; }
.rnIndM { flex: none; width: 0; overflow: hidden; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums;
  animation: rnColOpen 620ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.rnIndHead .rnIndM { font-weight: 900; color: var(--navy); }
.rnMcHead, .rnMcRow { display: grid; grid-template-columns: 1fr 48px 48px 48px; align-items: center; padding: 0 10px; gap: 2px; }
.rnMcHead { height: 28px; font-size: 9px; font-weight: 900; color: var(--navy); background: #f8f9fd; }
.rnMcHead span { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
.rnMcHead i { width: 6px; height: 6px; border-radius: 50%; }
.rnMcRow { height: 30px; font-size: 10px; font-weight: 600; color: rgba(10,22,71,0.82); border-bottom: 1px solid rgba(26,47,138,0.05); }
.rnMcRow span:not(:first-child) { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
.rnMcRow.isTotal { font-weight: 900; color: var(--ink); border-bottom: 0; }
.rnMcNew { animation: rnSwapIn 520ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.rnCmpList { display: flex; flex-direction: column; gap: 6px; }
.rnCmpList .rnPanelHead { margin-bottom: 4px; }
.rnCmpItem { display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px 0 4px; border-radius: 9px; font-size: 11px; font-weight: 800; color: var(--ink); background: #f6f8fe; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.07); }
.rnCmpItem i { width: 18px; height: 18px; border-radius: 6px; display: grid; place-items: center; font-style: normal; font-size: 9.5px; font-weight: 900; color: #fff; }
.rnCmpItem i.isA { background: var(--navy); } .rnCmpItem i.isB { background: var(--red); } .rnCmpItem i.isC { background: #7c3aed; } .rnCmpItem i.isD { background: #0d9488; }

/* j) Dimensiones */
.rnDmHead { padding: 0 16px; }
.rnDmRow { display: grid; grid-template-columns: 1fr auto 92px; align-items: center; height: 30px; padding-right: 16px; font-size: 10.5px; font-weight: 600; color: rgba(10,22,71,0.82); border-bottom: 1px solid rgba(26,47,138,0.05); }
.rnDmRow b { text-align: right; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; }
.rnDmRow b.isNeg { color: #e11d48; }
.rnDmBtn { display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; padding: 3px 8px; border-radius: 999px; font-size: 9px; font-weight: 800; color: var(--navy); background: rgba(26,47,138,0.07);
  animation: rnBtnPress 700ms ease 800ms both; }
.rnDmCo { display: grid; grid-template-columns: 1fr 70px 80px; align-items: center; gap: 10px; height: 0; padding: 0 16px 0 34px; overflow: hidden; opacity: 0; font-size: 10px; font-weight: 700; color: rgba(10,22,71,0.75);
  background: color-mix(in srgb, var(--c) 4%, #fff); animation: rnFoldIn 520ms cubic-bezier(0.22,1,0.36,1) calc(1100ms + var(--i) * 120ms) both; }
.rnDmName { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.rnDmName i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 20%, transparent); }
.rnDmShare { height: 5px; border-radius: 99px; background: rgba(26,47,138,0.08); overflow: hidden; }
.rnDmShare i { display: block; height: 100%; border-radius: inherit; background: var(--c); transform-origin: left; animation: rnGrowX 700ms cubic-bezier(0.22,1,0.36,1) calc(1300ms + var(--i) * 120ms) both; }
.rnDmV { text-align: right; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }

/* k) KPIs */
.rnKlBody { display: grid; grid-template-columns: 82px 1fr; height: calc(100% - 40px); }
.rnKlFam { display: flex; flex-direction: column; gap: 4px; padding: 10px 6px 10px 10px; background: #f8f9fd; border-right: 1px solid rgba(26,47,138,0.06); }
.rnKlFam span { padding: 6px 7px; border-radius: 8px; font-size: 9.5px; font-weight: 800; color: rgba(10,22,71,0.6); }
.rnKlFam span.isOn { color: #fff; background: var(--navy); box-shadow: 0 6px 12px -6px rgba(26,47,138,0.8); }
.rnKlCards { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.rnKlCard { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; border-radius: 11px; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.09); }
.rnKlCard b { font-size: 11px; font-weight: 900; color: var(--ink); }
.rnKlOk, .rnKlBad { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 8px; font-size: 9.5px; font-weight: 800; }
.rnKlOk { color: #0f7a36; background: rgba(22,163,74,0.1); box-shadow: inset 0 0 0 1px rgba(22,163,74,0.2); }
.rnKlOk em { margin-left: auto; font-style: normal; font-size: 12px; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; }
.rnKlBad { color: #be123c; background: rgba(225,29,72,0.07); box-shadow: inset 0 0 0 1px rgba(225,29,72,0.18); }
.rnKlOk i, .rnKlBad i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.rnKlCfg { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 8px; font-size: 9px; font-weight: 900; color: #be123c; background: #fff;
  box-shadow: inset 0 0 0 1px rgba(225,29,72,0.25); animation: rnPop 560ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both, rnCfgPulse 1.6s ease 1.8s infinite; }
.rnWiz { display: flex; flex-direction: column; gap: 6px; padding: 12px; }
.rnWizStep { display: flex; align-items: center; gap: 7px; font-size: 10.5px; font-weight: 800; color: rgba(10,22,71,0.45); }
.rnWizStep i { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 9px; font-weight: 900; color: rgba(26,47,138,0.5); box-shadow: inset 0 0 0 1.5px rgba(26,47,138,0.2); }
.rnWizStep.isDone { color: rgba(10,22,71,0.75); } .rnWizStep.isDone i { color: #fff; background: #16a34a; box-shadow: none; }
.rnWizStep.isOn { color: var(--ink); } .rnWizStep.isOn i { color: #fff; background: var(--navy); box-shadow: 0 0 0 4px rgba(26,47,138,0.14); }
.rnFormula { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin: 6px 0 2px; padding: 10px 8px; border-radius: 10px; background: #f6f8fe; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.08); }
.rnTok { font-size: 13px; font-weight: 900; color: var(--ink); font-family: 'SF Mono', Menlo, monospace; }
.rnTok.isVar { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 10.5px; color: #fff; background: var(--navy); }
.rnTok.isB { background: #7c3aed; }
.rnMap { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; color: rgba(10,22,71,0.8); }
.rnMap i { width: 16px; height: 16px; border-radius: 5px; display: grid; place-items: center; font-style: normal; font-size: 9px; font-weight: 900; color: #fff; background: var(--navy); }
.rnMap i.isB { background: #7c3aed; }
.rnSegLight { background: #f1f3f8; box-shadow: none; }
.rnSegLight span { color: rgba(26,47,138,0.55); padding: 3px 8px; }
.rnSegLight span.isOn { color: var(--navy); }
.rnKpiChart { position: absolute; left: 8px; top: 46px; width: 420px; height: 78px; overflow: visible; }
.rnArea { fill: rgba(26,47,138,0.07); stroke: none; }
.rnCursor { stroke: rgba(26,47,138,0.25); stroke-width: 1; stroke-dasharray: 3 3; }
.rnDotA { fill: #fff; stroke: var(--navy); stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.rnDotB { fill: #fff; stroke: #e8394a; stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.rnTip { position: absolute; left: 186px; top: 48px; display: flex; flex-direction: column; gap: 3px; padding: 7px 9px; border-radius: 10px; background: #fff;
  box-shadow: 0 14px 30px -12px rgba(5,12,50,0.5), inset 0 0 0 1px rgba(26,47,138,0.08); transform-origin: right center; }
.rnTip b { font-size: 9px; font-weight: 900; color: var(--navy); letter-spacing: 0.06em; }
.rnTip span { display: flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 700; color: rgba(10,22,71,0.75); white-space: nowrap; }
.rnTip span i { width: 6px; height: 6px; border-radius: 50%; background: var(--navy); }
.rnTip span i.isB { background: #e8394a; }
.rnTip em { margin-left: 8px; font-style: normal; font-weight: 900; color: var(--ink); }

/* l) Estructura */
.rnStCanvas { background-color: #f7f8fb; background-image: radial-gradient(circle at 1px 1px, #dde2ec 1px, transparent 0); background-size: 16px 16px; }
.rnStEdges { position: absolute; left: 0; top: 0; overflow: visible; }
.rnStEdge { fill: none; stroke-width: 1.5; stroke-linecap: round; }
.rnStEdge.isOn { stroke: var(--navy); stroke-width: 1.8; }
.rnStEdge.isDim { stroke: #c9d0dd; animation: rnDraw 900ms cubic-bezier(0.65,0,0.35,1) calc(var(--d, 0) * 1ms) both, rnDimOut 400ms ease 1500ms forwards; }
.rnStPill rect { fill: #fff; stroke-width: 1.2; }
.rnStPill text { font-size: 9px; font-weight: 900; font-variant-numeric: tabular-nums; }
.rnStPill.isDim { animation: rnPop 560ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both, rnDimOut 400ms ease 1500ms forwards; }
.rnStNode { position: absolute; height: 40px; box-sizing: border-box; display: flex; align-items: center; gap: 7px; padding: 0 8px; border-radius: 11px; background: #fff;
  box-shadow: 0 1px 2px rgba(15,23,42,0.05), 0 8px 18px -12px rgba(15,23,42,0.4), inset 0 0 0 1px #e3e7ef; }
.rnStNode::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--c); }
.rnStNode i { width: 24px; height: 24px; flex: none; border-radius: 8px; display: grid; place-items: center; font-style: normal; font-size: 8px; font-weight: 900; color: #fff;
  background: linear-gradient(140deg, var(--c), color-mix(in srgb, var(--c) 60%, #0f172a)); }
.rnStNode b { font-size: 10.5px; font-weight: 900; color: var(--ink); }
.rnStNode.isRoot { box-shadow: 0 10px 22px -12px rgba(26,47,138,0.6), inset 0 0 0 1.5px rgba(26,47,138,0.3); }
.rnStNode.isSel { animation: rnPop 560ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both, rnSelRing 500ms ease 1450ms both; }
.rnStNode.isDim { animation: rnPop 560ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both, rnDimOut 400ms ease 1500ms forwards; }
.rnStTools { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 4px; padding: 4px; border-radius: 10px; background: rgba(255,255,255,0.9); box-shadow: 0 8px 18px -12px rgba(15,23,42,0.45), inset 0 0 0 1px rgba(15,23,42,0.06); }
.rnStTools span { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 7px; font-size: 9px; font-weight: 800; color: rgba(10,22,71,0.7); }
.rnStTools span:first-child { background: #f1f3f8; }
.rnStPanel { position: absolute; left: 306px; top: 10px; width: 120px; bottom: 10px; box-sizing: border-box; display: flex; flex-direction: column; gap: 9px; padding: 11px; }
.rnStPHead { display: flex; align-items: center; gap: 7px; }
.rnStPHead i { width: 28px; height: 28px; flex: none; border-radius: 9px; display: grid; place-items: center; font-style: normal; font-size: 8.5px; font-weight: 900; color: #fff;
  background: linear-gradient(140deg, #2440a8, #15255e); }
.rnStPHead span { display: flex; flex-direction: column; min-width: 0; }
.rnStPHead b { font-size: 11px; font-weight: 900; color: var(--ink); }
.rnStPHead small { font-size: 8px; color: rgba(10,22,71,0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rnStPath { display: flex; align-items: center; gap: 3px; color: rgba(26,47,138,0.4); }
.rnStPath em { font-style: normal; font-size: 8.5px; font-weight: 800; padding: 2px 6px; border-radius: 999px; color: rgba(10,22,71,0.7); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.12); }
.rnStPath em.isHere { color: var(--navy); background: rgba(26,47,138,0.08); box-shadow: none; }
.rnStOwn { display: flex; align-items: center; gap: 8px; padding: 7px; border-radius: 10px; background: rgba(217,119,6,0.06); box-shadow: inset 0 0 0 1px rgba(217,119,6,0.16); }
.rnStOwn svg { width: 46px; height: 46px; flex: none; overflow: visible; }
.rnStTrack { fill: none; stroke: #edf0f5; stroke-width: 6; }
.rnStArc { fill: none; stroke: #d97706; stroke-width: 6; stroke-linecap: round; animation: rnRingIn 900ms cubic-bezier(0.22,1,0.36,1) 2050ms both; }
.rnStOwn span { display: flex; flex-direction: column; }
.rnStOwn b { font-size: 15px; font-weight: 900; color: #d97706; font-variant-numeric: tabular-nums; }
.rnStOwn small { font-size: 8.5px; font-weight: 700; color: rgba(10,22,71,0.6); }
.rnStSince { font-size: 9px; font-weight: 700; color: rgba(10,22,71,0.6); }
.rnStPanel .rnPill { align-self: flex-start; }
.rnHeat { display: flex; align-items: center; gap: 5px; }
.rnHeatL { display: inline-flex; align-items: center; gap: 5px; margin-right: 6px; font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.9); white-space: nowrap; }
.rnCell { width: 24px; height: 24px; border-radius: 7px; box-shadow: 0 6px 12px -8px rgba(5,12,50,0.7); }
.rnCell.is-c { background: linear-gradient(160deg, #2a44b3, #1a2f8a); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25), 0 6px 12px -8px rgba(5,12,50,0.7); }
.rnCell.is-p { background: linear-gradient(135deg, #1a2f8a 0 50%, #d6f3e3 50% 100%); }
.rnCell.is-o { background: #d6f3e3; box-shadow: inset 0 0 0 1.5px #16a34a; }
.rnCell.is-n { background: repeating-linear-gradient(135deg, rgba(255,255,255,0.35) 0 4px, rgba(255,255,255,0.15) 4px 8px); }

/* m) Acceso de usuarios */
.rnAccStats { display: flex; gap: 6px; padding: 12px 14px 8px; }
.rnAccStats span { padding: 5px 10px; border-radius: 9px; font-size: 10px; font-weight: 900; color: var(--navy); background: #f4f6fc; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.08); }
.rnAccStats span:first-child { color: #fff; background: var(--navy); box-shadow: none; }
.rnAccHead, .rnAccRow { display: grid; grid-template-columns: 1fr 104px 52px 52px 58px; align-items: center; gap: 6px; padding: 0 14px; }
.rnAccHead { height: 24px; font-size: 7.5px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(26,47,138,0.5); border-bottom: 1px solid rgba(26,47,138,0.07); }
.rnAccHead span:not(:first-child) { text-align: center; }
.rnAccRow { position: relative; height: 41px; border-bottom: 1px solid rgba(26,47,138,0.05); }
.rnAccRow.isOff .rnAccWho, .rnAccRow.isOff .rnAccChip { opacity: 0.45; }
.rnAccRow.isChanged::after { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: #f59e0b; animation: rnFadeIn 300ms ease 1900ms both; }
.rnAccWho { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 10px; font-weight: 800; color: var(--ink); white-space: nowrap; }
.rnAccWho i { width: 24px; height: 24px; flex: none; border-radius: 8px; display: grid; place-items: center; font-style: normal; font-size: 8.5px; font-weight: 900; color: #fff; }
.rnAccSeg { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); padding: 2px; border-radius: 9px; background: #f1f3f8; }
.rnAccSeg span { position: relative; z-index: 1; text-align: center; padding: 4px 0; font-size: 8.5px; font-weight: 800; color: rgba(10,22,71,0.5); }
.rnAccKnob { position: absolute; z-index: 0; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / 3); border-radius: 7px; background: #fff; box-shadow: 0 2px 6px -3px rgba(15,23,42,0.4); }
.rnAccSeg[data-st="1"] .rnAccKnob { transform: translateX(100%); background: var(--navy); }
.rnAccSeg[data-st="1"] span:nth-child(3) { color: #fff; }
.rnAccSeg[data-st="2"] .rnAccKnob { transform: translateX(200%); background: #f59e0b; }
.rnAccSeg[data-st="2"] span:nth-child(4) { color: #fff; }
.rnAccSeg.isPromote .rnAccKnob { animation: rnKnobMove 600ms cubic-bezier(0.65,0,0.35,1) 1500ms both; }
.rnAccSeg.isPromote span:nth-child(3) { animation: rnTxtOff 300ms ease 1550ms both; }
.rnAccSeg.isPromote span:nth-child(4) { animation: rnTxtOn 300ms ease 1850ms both; }
.rnAccChip { text-align: center; padding: 5px 0; border-radius: 8px; font-size: 9px; font-weight: 900; color: rgba(10,22,71,0.75); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.rnAccChip.isPart { color: var(--navy); background: rgba(26,47,138,0.06); box-shadow: inset 0 0 0 1.5px rgba(26,47,138,0.3); }
.rnAccChip.isNone { color: rgba(10,22,71,0.4); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); background: repeating-linear-gradient(135deg, #f6f7fa 0 4px, #fff 4px 8px); }
.rnSaveBar { display: inline-flex; align-items: center; gap: 10px; padding: 7px 7px 7px 14px; border-radius: 14px; font-size: 10.5px; font-weight: 800; color: #fff; white-space: nowrap;
  background: rgba(10,22,71,0.92); box-shadow: 0 20px 40px -18px rgba(5,12,50,0.9), inset 0 0 0 1px rgba(255,255,255,0.12); }
.rnSaveDot { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 10px rgba(245,158,11,0.9); }
.rnSaveGhost { padding: 6px 10px; border-radius: 9px; color: rgba(255,255,255,0.75); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2); }
.rnSaveBtn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 9px; color: var(--navy); background: #fff; animation: rnSavePulse 1.8s ease 2.6s infinite; }

/* Índice de la portada */
.rnIndexLabel { margin: 0 0 10px; font-size: 11px; font-weight: 800; color: rgba(26,47,138,0.5); }
.rnIndex { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.rnIdx { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 8px 10px 8px 8px; border: 0; border-radius: 13px; cursor: pointer; text-align: left; font: inherit;
  font-size: 13px; font-weight: 750; color: rgba(10,22,71,0.86); background: rgba(26,47,138,0.04); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.07);
  transition: background 200ms ease, transform 280ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease; }
.rnIdx:hover { background: #fff; transform: translateY(-1px); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.14), 0 10px 22px -14px rgba(5,12,50,0.5); }
.rnIdx:focus-visible { outline: 2px solid rgba(26,47,138,0.45); outline-offset: 2px; }
.rnIdxIco { width: 26px; height: 26px; flex: none; border-radius: 9px; display: grid; place-items: center; color: #1a2f8a; background: #fff; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.rnIdxTxt { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rnIdx em { flex: none; font-style: normal; font-size: 8px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 5px; border-radius: 5px; color: #fff; background: #e8394a; }
.rnIdx em.isRenew { color: #1a2f8a; background: rgba(26,47,138,0.1); }
.rnText.isEnter .rnIdx { animation: rnTextIn 620ms cubic-bezier(0.22,1,0.36,1) calc(260ms + var(--k, 0) * 40ms) both; }

@keyframes rnRowHover { 0%, 3% { background: transparent; } 6%, 17% { background: rgba(26,47,138,0.04); } 22%, 100% { background: transparent; } }
@keyframes rnRowBar { 0%, 3% { height: 0; margin-top: 0; } 6%, 17% { height: 16px; margin-top: -8px; } 22%, 100% { height: 0; margin-top: 0; } }
@keyframes rnLkOpen { from { width: 0; } to { width: 192px; } }
@keyframes rnShimmerBg { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes rnBkGrow { from { transform: scaleX(0.04); opacity: 0.4; } to { transform: none; opacity: 1; } }
@keyframes rnBkShine { 0% { transform: translateX(-120%); } 45%, 100% { transform: translateX(420%); } }
@keyframes rnArcFill { to { stroke-dashoffset: 0; } }
@keyframes rnPhDone { to { color: #0f7a36; background: rgba(22,163,74,0.1); box-shadow: inset 0 0 0 1px rgba(22,163,74,0.2); } }
@keyframes rnPhDot { to { color: #fff; background: #16a34a; box-shadow: none; } }
@keyframes rnBoxOn { from { transform: scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes rnHistPress { 0% { transform: none; } 40% { transform: scale(0.9); background: var(--navy); color: #fff; } 100% { transform: none; background: var(--navy); color: #fff; } }
@keyframes rnColOpen { from { width: 0; opacity: 0; } to { width: 64px; opacity: 1; } }
@keyframes rnBtnPress { 0% { transform: none; } 40% { transform: scale(0.92); } 100% { transform: none; color: #fff; background: var(--navy); } }
@keyframes rnFoldIn { from { height: 0; opacity: 0; } to { height: 28px; opacity: 1; } }
@keyframes rnCfgPulse { 0%, 100% { box-shadow: inset 0 0 0 1px rgba(225,29,72,0.25); } 50% { box-shadow: inset 0 0 0 1px rgba(225,29,72,0.5), 0 0 0 4px rgba(225,29,72,0.12); } }
@keyframes rnDimOut { to { opacity: 0.32; } }
@keyframes rnSelRing { to { box-shadow: 0 0 0 3px rgba(26,47,138,0.2), 0 14px 26px -14px rgba(26,47,138,0.8), inset 0 0 0 1.5px #1a2f8a; } }
@keyframes rnRingIn { from { stroke-dasharray: 0 999; } }
@keyframes rnKnobMove { from { transform: translateX(100%); background: var(--navy); } to { transform: translateX(200%); background: #f59e0b; } }
@keyframes rnTxtOff { to { color: rgba(10,22,71,0.5); } }
@keyframes rnTxtOn { to { color: #fff; } }
@keyframes rnSavePulse { 0%, 100% { box-shadow: none; } 50% { box-shadow: 0 0 0 4px rgba(255,255,255,0.22); } }

/* ── Responsive ──────────────────────────────────────────────────── */
/* Diálogo más estrecho que su ancho máximo: los 13 puntos y los botones no dejan sitio al contador */
/* El pie se adapta al ancho real de la columna, no al de la pantalla */
@container (max-width: 480px) { .rnCounter { display: none; } }
@container (max-width: 440px) { .rnDot { width: 12px; } .rnDot.isOn { width: 24px; } .rnDot.isOn::before { width: 16px; margin-left: -8px; } .rnNext { min-width: 0; padding: 0 16px 0 18px; } }
@media (max-width: 820px) {
  .rnRoot { padding: 16px; }
  .rnDialog { width: min(680px, 100%); height: min(940px, calc(100vh - 32px)); height: min(940px, calc(100dvh - 32px)); border-radius: 30px; }
  .rnBody { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 38%) 1fr; }
  .rnCopy { padding: 22px 22px 16px; }
  .rnClose { background: rgba(255,255,255,0.9); }
  .rnArt { top: calc(50% + 14px); }
}
@media (max-width: 560px) {
  .rnRoot { padding: 0; place-items: end stretch; }
  .rnDialog { width: 100%; height: calc(100vh - 10px); height: calc(100dvh - 10px); border-radius: 28px 28px 0 0; padding: 8px 8px 0; border-bottom: 0;
    animation-name: rnSheetIn; }
  .rnRoot.isClosing .rnDialog { animation-name: rnSheetOut; }
  .rnBody { grid-template-rows: minmax(200px, 36%) 1fr; gap: 8px; }
  .rnStage { border-radius: 22px; }
  .rnCopy { padding: 16px 12px calc(14px + env(safe-area-inset-bottom)); }
  .rnTitle { font-size: 25px; }
  .rnDesc { font-size: 14px; margin-bottom: 16px; }
  .rnList li { font-size: 13px; }
  .rnFoot { gap: 8px; padding-top: 14px; }
  /* Con 13 páginas los puntos no caben: en móvil se ve el contador */
  .rnDots { display: none; }
  .rnCounter { display: inline; }
  .rnNext { min-width: 0; padding: 0 16px 0 18px; }
  .rnIdx { padding: 6px 8px 6px 6px; font-size: 12px; }
  .rnIdx em { display: none; }
  .rnClose { top: 16px; right: 16px; width: 36px; height: 36px; }
}

@keyframes rnFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes rnFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes rnDialogIn { from { opacity: 0; transform: perspective(1200px) translateY(28px) rotateX(8deg) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes rnDialogOut { to { opacity: 0; transform: translateY(14px) scale(0.97); } }
@keyframes rnSheetIn { from { transform: translateY(100%); } to { transform: none; } }
@keyframes rnSheetOut { to { transform: translateY(100%); } }
@keyframes rnArtIn { from { opacity: 0; transform: translateX(calc(var(--dir, 1) * 56px)) scale(0.98); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes rnLeave { to { opacity: 0; transform: translateX(calc(var(--dir, 1) * -40px)) scale(0.985); } }
@keyframes rnTextIn { from { opacity: 0; transform: translateX(calc(var(--dir, 1) * 26px)); } to { opacity: 1; transform: none; } }
@keyframes rnUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes rnPop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
@keyframes rnPopC { from { opacity: 0; transform: translate(-50%, -50%) scale(0.6); } to { opacity: 1; transform: translate(-50%, -50%); } }
@keyframes rnSlideIn { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: none; } }
@keyframes rnDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes rnFlow { to { stroke-dashoffset: -24; } }
@keyframes rnRot { to { transform: rotate(360deg); } }
@keyframes rnTravel { 0% { offset-distance: 0%; opacity: 0; } 15%, 80% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
@keyframes rnHalo { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.18); opacity: 1; } }
@keyframes rnGrowX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes rnGrowY { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes rnResize { from { width: 150px; } to { width: 196px; } }
@keyframes rnHandle { 0% { opacity: 0; } 15%, 70% { opacity: 1; } 100% { opacity: 0; } }
@keyframes rnSwapA { from { transform: none; } to { transform: translateX(72px); } }
@keyframes rnSwapB { from { transform: none; } to { transform: translateX(-72px); } }
@keyframes rnSwapBLift { 0% { transform: none; background: transparent; box-shadow: none; }
  20% { transform: translateY(-2px) scale(1.06); background: #fff; color: #1a2f8a; box-shadow: 0 10px 20px -8px rgba(5,12,50,0.45); }
  80% { transform: translateX(-72px) translateY(-2px) scale(1.06); background: #fff; color: #1a2f8a; box-shadow: 0 10px 20px -8px rgba(5,12,50,0.45); }
  100% { transform: translateX(-72px); background: transparent; box-shadow: none; } }
@keyframes rnScroll { from { transform: translateY(0); } to { transform: translateY(-50%); } }
@keyframes rnThumb { from { transform: translateY(0); } to { transform: translateY(150px); } }
@keyframes rnLit { 0%, 22% { background: #fff; color: #1a2f8a; box-shadow: 0 0 0 2px rgba(255,255,255,0.6), 0 10px 22px -10px rgba(5,12,50,0.8); }
  30%, 100% { background: rgba(255,255,255,0.88); } }
@keyframes rnRingPulse { 0% { box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); } 30% { box-shadow: 0 0 0 4px rgba(232,57,74,0.25), inset 0 0 0 1px #e8394a; background: #fff; color: #e8394a; }
  100% { box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); } }
@keyframes rnSweep { from { transform: translateX(-110%); } to { transform: translateX(110%); } }
@keyframes rnSwapIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes rnLinkHi { from { background: transparent; box-shadow: none; } to { background: rgba(58,92,217,0.1); box-shadow: 0 0 0 1.5px #3a5cd9; } }
@keyframes rnShimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }

/* Movimiento reducido: todo salta a su estado final y no hay bucles */
@media (prefers-reduced-motion: reduce) {
  .rnRoot, .rnRoot *, .rnRoot *::before, .rnRoot *::after {
    animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
  .rnPacket, .rnHalo, .rnSpinRing { display: none; }
  .rnBlob { transition: none; }
}
`;

/* ════════════════════════════════════════════════════════════════
   Escaparate modal
   ════════════════════════════════════════════════════════════════ */
const LEAVE_MS = 300, CLOSE_MS = 260;
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function ReleaseNotes({ onClose, locale }) {
  const lang = pickReleaseLang(locale);
  const L = TEXT[lang];
  const reduce = useReducedMotion();
  const total = PAGES.length;

  // page: página visible · prev: la que sale (se anima y desaparece) · dir: sentido
  const [nav, setNav] = useState({ page: 0, prev: null, dir: 1 });
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const copyRef = useRef(null);
  const nextRef = useRef(null);
  const swipeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const go = (target) => {
    setNav(n => {
      const to = Math.max(0, Math.min(total - 1, target));
      if (to === n.page) return n;
      return { page: to, prev: n.page, dir: to > n.page ? 1 : -1 };
    });
  };
  const requestClose = () => setClosing(true);

  // La página que sale se retira cuando acaba su animación
  useEffect(() => {
    if (nav.prev === null) return undefined;
    const t = setTimeout(() => setNav(n => ({ ...n, prev: null })), reduce ? 0 : LEAVE_MS);
    return () => clearTimeout(t);
  }, [nav.prev, nav.page, reduce]);

  // Cierre animado
  useEffect(() => {
    if (!closing) return undefined;
    const t = setTimeout(() => onCloseRef.current?.(), reduce ? 0 : CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing, reduce]);

  // Foco: entra en el botón principal y vuelve al disparador al cerrar
  useEffect(() => {
    const opener = document.activeElement;
    nextRef.current?.focus({ preventScroll: true });
    return () => { if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true }); };
  }, []);

  // Teclado: flechas, Inicio/Fin, Esc y foco atrapado dentro del diálogo
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); setClosing(true); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setNav(n => n.page >= total - 1 ? n : { page: n.page + 1, prev: n.page, dir: 1 }); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); setNav(n => n.page <= 0 ? n : { page: n.page - 1, prev: n.page, dir: -1 }); return; }
      if (e.key === "Home") { e.preventDefault(); setNav(n => n.page === 0 ? n : { page: 0, prev: n.page, dir: -1 }); return; }
      if (e.key === "End") { e.preventDefault(); setNav(n => n.page === total - 1 ? n : { page: total - 1, prev: n.page, dir: 1 }); return; }
      if (e.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter(el => !el.closest("[inert]") && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (!dialogRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [total]);

  // El lienzo de la viñeta se escala para caber en el escenario
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const stacked = window.innerWidth <= 820; // el botón de cerrar flota sobre el escenario
      const s = Math.min((width - 28) / ART_W, (height - (stacked ? 56 : 28)) / ART_H, 1.22);
      el.style.setProperty("--s", Math.max(0.3, s).toFixed(4));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // El texto nunca necesita scroll: si en una pantalla baja no cabe, se reduce lo justo
  useLayoutEffect(() => {
    const box = copyRef.current;
    if (!box) return undefined;
    const fit = () => {
      const avail = box.clientHeight;
      if (!avail) return;
      box.querySelectorAll(".rnText").forEach((el) => {
        el.style.setProperty("--fit", "1");
        const need = el.offsetHeight;
        const z = need > avail ? Math.max(0.62, Math.floor((avail / need) * 1000) / 1000) : 1;
        if (z < 1) el.style.setProperty("--fit", String(z));
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) fit(); });
    return () => { alive = false; ro.disconnect(); };
  }, [nav.page, nav.prev, lang]);

  // Deslizar en pantallas táctiles
  const onPointerDown = (e) => {
    if (e.pointerType === "mouse") return;
    swipeRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(nav.page + (dx < 0 ? 1 : -1));
  };

  const { page, prev, dir } = nav;
  const isLast = page === total - 1;
  const layers = prev === null ? [page] : [prev, page];
  const pageText = (i) => L.pages[PAGES[i].id];
  const titleId = "rn-title";
  const blob = PAGES[page].blob;

  return createPortal(
    <div className={`rnRoot ${closing ? "isClosing" : ""}`} style={{ "--dir": dir }}>
      <style>{RN_CSS}</style>
      <div className="rnBackdrop" onClick={requestClose} aria-hidden="true" />
      <div ref={dialogRef} className="rnDialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="rnSr">{L.dialog}</h2>
        <p className="rnSr" aria-live="polite">{fill(L.pageOf, { n: page + 1, total, t: pageText(page).title })}</p>
        <button type="button" className="rnClose" onClick={requestClose} aria-label={L.close}><X size={17} strokeWidth={2.6} /></button>

        <div className="rnBody" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeRef.current = null; }}>
          {/* Escenario con la viñeta animada */}
          <div ref={stageRef} className="rnStage" aria-hidden="true">
            <div className="rnBlob" style={{ transform: `translate(${blob[0]}%, ${blob[1]}%)` }} />
            <div className="rnStageStack">
              {layers.map(i => {
                const { Vignette } = PAGES[i];
                const leaving = i !== page;
                return (
                  <div key={PAGES[i].id} className={`rnArtLayer ${leaving ? "isLeave" : "isEnter"}`}>
                    <div className="rnArt"><Vignette L={L.v} lang={lang} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Texto */}
          <div className="rnCopy">
            <div ref={copyRef} className="rnCopyStack">
              {layers.map(i => {
                const t = pageText(i);
                const leaving = i !== page;
                const id = PAGES[i].id;
                const tagNew = t.tag === L.pages.pres.tag;
                return (
                  <div key={PAGES[i].id} className={`rnText ${leaving ? "isLeave" : "isEnter"}`} inert={leaving} aria-hidden={leaving || undefined}>
                    <div className="rnMeta" style={{ "--k": 0 }}>
                      <span className="rnNum">{String(i + 1).padStart(2, "0")}</span>
                      <span className="rnEyebrow">{t.eyebrow}</span>
                      {t.tag && <span className={`rnTag ${tagNew ? "isNew" : ""}`}>{t.tag}</span>}
                    </div>
                    <h3 className="rnTitle" style={{ "--k": 1 }}>{t.title}</h3>
                    <p className="rnDesc" style={{ "--k": 2 }}>{t.desc}</p>
                    {id === "intro" ? (
                      <>
                        <p className="rnIndexLabel" style={{ "--k": 3 }}>{L.indexLabel}</p>
                        <div className="rnIndex">
                          {PAGES.slice(1).map((p, pi) => {
                            const pt = L.pages[p.id];
                            return (
                              <button key={p.id} type="button" className="rnIdx" style={{ "--k": pi }} onClick={() => go(pi + 1)}
                                tabIndex={leaving ? -1 : 0} aria-label={fill(L.goTo, { n: pi + 2, t: pt.title })}>
                                <span className="rnIdxIco" aria-hidden="true"><p.Icon size={13} strokeWidth={2.4} /></span>
                                <span className="rnIdxTxt">{pt.short}</span>
                                {pt.tag === L.pages.pres.tag ? <em>{pt.tag}</em> : null}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <ul className="rnList">
                        {t.bullets.map((b, bi) => (
                          <li key={b} style={{ "--k": 3 + bi }}>
                            <span className="rnTickL" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="rnFoot">
              <div className="rnDots" role="group" aria-label={L.dialog}>
                {PAGES.map((p, i) => (
                  <button key={p.id} type="button" className={`rnDot ${i === page ? "isOn" : ""} ${i < page ? "isDone" : ""}`}
                    onClick={() => go(i)} aria-label={fill(L.goTo, { n: i + 1, t: L.pages[p.id].title })}
                    aria-current={i === page ? "step" : undefined} />
                ))}
              </div>
              <span className="rnCounter" aria-hidden="true">{String(page + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
              <div className="rnNav">
                <button type="button" className="rnPrev" aria-label={L.prev} aria-disabled={page === 0}
                  onClick={() => { if (page > 0) go(page - 1); }}>
                  <ChevronLeft size={18} strokeWidth={2.6} />
                </button>
                <button ref={nextRef} type="button" className={`rnNext ${isLast ? "isLast" : ""}`}
                  onClick={() => (isLast ? requestClose() : go(page + 1))}>
                  {isLast ? L.start : L.next}
                  <ArrowRight size={16} strokeWidth={2.6} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}