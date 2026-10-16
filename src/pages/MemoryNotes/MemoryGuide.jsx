/* ════════════════════════════════════════════════════════════════
   Guía de las memorias
   ────────────────────────────────────────────────────────────────
   Recorrido animado, paso a paso, por todo lo que se puede hacer en
   una memoria: crearla, el espacio de trabajo, el periodo, el texto con
   variables, las tablas automáticas y las propias, el cuadro de
   movimientos, de dónde sale cada importe, la revisión, exportar y
   compartir. Mismo formato que las novedades del login (viñeta animada
   a la izquierda, texto a la derecha, puntos, flechas, Esc y deslizar).

   Se abre con <GuideButton> desde la lista de memorias y desde la barra
   de una memoria abierta.
   ════════════════════════════════════════════════════════════════ */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../components/layout/SettingsContext.jsx";
import {
  ArrowRight, Check, ChevronLeft, X, BookOpen, Sparkles, Building, Network, CalendarRange, FileText,
  LayoutGrid, AlignLeft, Braces, Table2, Columns3, ArrowUpDown, Layers, Search, Link2, ListChecks,
  CircleCheck, CircleAlert, Crosshair, Share2, Users, Lock, Eye, EyeOff, Plus, Pencil, Scale, MousePointerClick,
} from "lucide-react";

/* ── Textos (es, en, da, pt; en para el resto) ───────────────────── */
const TEXT = {
  es: {
    dialog: "Guía de las memorias", close: "Cerrar la guía", prev: "Anterior", next: "Siguiente", start: "Empezar",
    pageOf: "Paso {n} de {total}: {t}", goTo: "Ir al paso {n}: {t}", indexLabel: "Qué vas a ver",
    button: "Guía", buttonHint: "Guía paso a paso de las memorias",
    pages: {
      intro: {
        eyebrow: "Guía", short: "Introducción", title: "Las memorias, paso a paso",
        desc: "La memoria de las cuentas anuales, escrita aquí y rellenada sola con los datos de Konsolidator. Esta guía recorre todo lo que puedes hacer; empieza por el principio o salta a lo que te interese.",
      },
      create: {
        eyebrow: "Crear", short: "Crear una memoria", title: "Una memoria en cuatro respuestas",
        desc: "Desde «Nueva memoria» un asistente te hace cuatro preguntas y monta el documento con todas sus notas.",
        bullets: [
          "Individual (una sociedad) o consolidada (un grupo, ya consolidado)",
          "La sociedad o la matriz del grupo",
          "El periodo: normalmente el cierre; el año anterior se usa solo como comparativo",
          "El modelo: PGC normal (25 notas) o NIIF-UE (20 notas). El nombre se propone solo",
        ],
      },
      workspace: {
        eyebrow: "Espacio de trabajo", short: "El espacio de trabajo", title: "Todo a mano en una pantalla",
        desc: "Arriba, la barra de la memoria; a la izquierda, el índice de epígrafes; en el centro, la hoja de la nota que estás editando.",
        bullets: [
          "Barra: nombre (se edita ahí mismo), tipo y sociedad, periodo, revisión, exportar, compartir y esta guía",
          "Índice con el estado de cada epígrafe: revisado, cuadro con diferencias, tabla con datos, sin importes o solo texto",
          "Busca un epígrafe, pliega el índice, añade epígrafes propios o enseña los ocultos",
          "Todo se guarda solo en el servidor; el aviso de guardado desaparece a los pocos segundos",
        ],
      },
      period: {
        eyebrow: "Periodo", short: "Periodo y datos", title: "Cambia el periodo y todo se recalcula",
        desc: "El chip del periodo abre el selector. Al cambiarlo, todas las tablas y variables se vuelven a calcular con los datos de ese cierre.",
        bullets: [
          "Ejercicio, mes de cierre, fuente (Actual, Budget…) y estructura del grupo",
          "Comparativo: cierre del año anterior en balance y mismo mes del año anterior en resultados",
          "Mientras llegan los datos, la barra indica «Calculando…»",
          "Lo escrito a mano se conserva al cambiar de periodo",
        ],
      },
      text: {
        eyebrow: "Texto", short: "Texto con variables", title: "Un texto que escribe las cifras por ti",
        desc: "Cada nota tiene su texto, con formato, y puede llevar variables: importes que se actualizan solos cuando cambian los datos.",
        bullets: [
          "«Insertar variable»: busca cualquier cifra de cualquier nota o un dato general (entidad, ejercicio, fecha de cierre, resultado)",
          "Desde la tabla, «Insertar en el texto» mete el importe de una celda como variable",
          "La variable se ve como una pastilla con su importe; al pulsarla te dice de dónde sale",
          "Negrita, cursiva, listas, alineación, tipo y tamaño de letra",
        ],
      },
      tables: {
        eyebrow: "Tablas", short: "Tablas automáticas", title: "Las tablas se rellenan solas",
        desc: "Cada nota con tabla sabe qué cuentas le tocan por las etiquetas del estándar, así que funciona con cualquier plan de cuentas.",
        bullets: [
          "Desglose (actual y anterior), saldos inicial y final o movimientos del plan, según la nota",
          "El signo se pone solo para que el total salga en positivo; «Signo» lo invierte",
          "Oculta filas que no quieras, añade filas manuales o quita la tabla del documento",
          "Las filas sin importe en ningún ejercicio no aparecen",
        ],
      },
      custom: {
        eyebrow: "Tablas propias", short: "Cambiar la tabla", title: "Monta la tabla que necesites",
        desc: "«Cambiar tabla» abre la biblioteca; «Añadir columna» y las filas con datos te dejan construirla a medida sin perder las cuentas que ya tenía.",
        bullets: [
          "Biblioteca: Recomendada, Desglose, Comparativa con variación, Movimientos, Saldo al cierre o En blanco",
          "Columnas con origen: actual, anterior, variación, variación %, saldos, altas, bajas, traspasos o manual",
          "«Fila con datos» busca cualquier cuenta (también de flujos de efectivo); «Fila manual» para escribir",
          "Cambia el nombre de filas y columnas haciendo clic en ellos",
        ],
      },
      movement: {
        eyebrow: "Movimientos", short: "Cuadro de movimientos", title: "El cuadro de movimientos cuadra solo",
        desc: "Inmovilizado, intangibles, provisiones o subvenciones: saldo inicial, entradas, salidas, traspasos y saldo final, separado en coste, amortización y deterioro, del ejercicio y del anterior.",
        bullets: [
          "Saldos siempre de la contabilidad; si el plan no separa altas y bajas, se deducen y se marcan «Deducido (revisar)»",
          "Escribe entradas o salidas y la otra se calcula para cuadrar; la columna «Cuadre» enseña lo que falta",
          "La dotación se contrasta con la cuenta de resultados (681, 680…) y el deterioro con el suyo",
          "En las consolidadas, además, variaciones del perímetro y diferencias de conversión",
        ],
      },
      source: {
        eyebrow: "Trazabilidad", short: "De dónde sale cada importe", title: "Cada cifra explica su origen",
        desc: "Pulsa una celda y verás de dónde sale: si viene del sistema, del plan, si está deducida, calculada o escrita a mano, con la fórmula y las cuentas que suma.",
        bullets: [
          "Doble clic para escribir un importe; «Volver al cálculo» lo devuelve al del sistema",
          "«Vincular celda»: copia el importe de otra celda de la memoria (eligiéndola en su tabla) o el saldo de una cuenta, en el periodo y con el signo que quieras",
          "Si lo vinculado deja de existir, la celda avisa de que el vínculo está roto",
          "«Insertar en el texto» lleva esa celda al texto de la nota",
        ],
      },
      review: {
        eyebrow: "Revisión", short: "Revisión", title: "Revisa sin dejarte nada",
        desc: "El botón de revisión abre un panel con tres listas y un contador de pendientes en la barra.",
        bullets: [
          "Epígrafes: márcalos como revisados; el índice y el anillo de progreso lo reflejan",
          "Variables: cada cifra del texto; si cambia después de revisarla, vuelve a pendiente y te dice cuánto era",
          "Cuadres: se comprueban solos (movimientos, saldos frente a la contabilidad, dotación, vínculos rotos)",
          "«Modo revisión» salta al siguiente pendiente al marcar; «Solo pendientes» filtra la lista",
        ],
      },
      share: {
        eyebrow: "Exportar y compartir", short: "Exportar y compartir", title: "Lista para entregar y para trabajar en equipo",
        desc: "Exporta el documento cuando quieras y decide quién lo ve y quién lo edita.",
        bullets: [
          "Word y PDF con todas las notas visibles; Excel con una hoja por tabla",
          "Privada, para toda la empresa (en lectura) o para personas concretas, con lectura o edición",
          "Quien solo puede leer la puede duplicar para tener su propia copia",
          "Si dos personas guardan a la vez, nada se pisa: tus cambios quedan en una copia y te avisa",
        ],
      },
      tips: {
        eyebrow: "Para terminar", short: "Consejos", title: "Un flujo que funciona",
        desc: "Una forma rápida de cerrar una memoria de principio a fin.",
        bullets: [
          "Elige el periodo y deja que se calcule; repasa los epígrafes con diferencias primero",
          "Ajusta tablas y signos, y escribe lo que la contabilidad no separa",
          "Redacta los textos con variables para que las cifras no se queden viejas",
          "Abre la revisión en «Modo revisión», déjala a cero y exporta",
        ],
      },
    },
    v: {
      doc: "Memoria 2026 · Grupo Norvia", ppe: "Inmovilizado material", note5: "Nota 5 · Inmovilizado material",
      txt: "El valor neto contable al cierre asciende a", cuadra: "Cuadra",
      fText: "Texto con variables", fTables: "Tablas que se rellenan solas", fReview: "Revisión", fExport: "Word · PDF · Excel",
      newMem: "Nueva memoria", wzSteps: ["Tipo", "Sociedad", "Periodo", "Modelo"], ind: "Individual", cons: "Consolidada",
      indSub: "Una sociedad", consSub: "Un grupo consolidado", pgc: "PGC · Modelo normal", pgcSub: "25 notas", ifrs: "NIIF-UE", ifrsSub: "20 notas", create: "Crear memoria",
      idx: ["Actividad", "Bases de presentación", "Inmovilizado material", "Intangible", "Existencias", "Situación fiscal"],
      idxSt: ["Revisado", "Solo texto", "Cuadro con diferencias", "Tabla con datos", "Tabla sin importes", "Tabla con datos"],
      search: "Buscar epígrafe", add: "Añadir epígrafe", saved: "Guardado", period: "Dic 2026",
      year: "Ejercicio", month: "Mes de cierre", source: "Fuente", structure: "Estructura", calc: "Calculando…",
      months: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
      account: "Cuenta", cur: "Ejercicio actual", prev: "Ejercicio anterior",
      rowsPpe: ["Terrenos", "Construcciones", "Instalaciones técnicas", "Mobiliario"], total: "Total",
      insertVar: "Insertar variable", searchVar: "Buscar variable…", varA: "Valor neto contable · Saldo final", varB: "Resultado del ejercicio", varC: "Fecha de cierre",
      whereFrom: "¿De dónde sale?", sistema: "Sistema", formulaA: "Saldo al cierre del ejercicio",
      lib: "Cambiar tabla", libItems: [["Recomendada", "La del estándar"], ["Desglose", "Actual y anterior"], ["Comparativa", "Con variación y %"], ["Movimientos", "Altas y bajas"], ["Saldo al cierre", "Una columna"], ["En blanco", "Empezar de cero"]],
      addCol: "Añadir columna", colName: "Nombre", colSrc: "Datos de la columna", varPct: "Variación %",
      sign: "Signo", hideRow: "Ocultar fila",
      movCols: ["Inicial", "Entradas", "Salidas", "Final", "Cuadre"], cost: "Coste", aa: "Amortización", inferred: "Deducido (revisar)",
      handTyped: "Escrito a mano", calcd: "Calculado para cuadrar", plCheck: "Dotación vs cuenta 681", ok: "Coincide",
      srcTitle: "Construcciones · Saldo final", srcSys: "Sistema", srcParts: [["2110", "Construcciones"], ["2111", "Reformas"]],
      link: "Vincular celda", linkVar: "Otra celda", linkAcc: "Cuenta", linked: "Vinculada", backCalc: "Volver al cálculo",
      rvTabs: ["Epígrafes", "Variables", "Cuadres"], rvMode: "Modo revisión", rvOnly: "Solo pendientes", rvChanged: "Ha cambiado desde la revisión",
      rvItems: ["Actividad de la empresa", "Bases de presentación", "Aplicación de resultados", "Inmovilizado material"],
      export: "Exportar", shareT: "Compartir", priv: "Privada", comp: "Toda la empresa", people: "Personas", canEdit: "Puede editar", canRead: "Puede ver",
      tipsT: ["Periodo", "Diferencias", "Textos", "Revisión", "Exportar"], ready: "Memoria lista",
      memName: "Memoria 2026", memMeta: "Consolidada · Norvia", textT: "Texto", net: "Valor neto", sched: "Cuadro",
      dataRow: "Fila con datos", manualRow: "Fila manual", rvTitle: "Revisión", rvVarName: "Nota 5 · Saldo final",
      rvBadName: "Cuadre del movimiento 2025", rvBadSub: "1 fila no cuadra", linkA: "Nota 6 · Total · Saldo final", linkB: "Nota 7 · Total · Saldo final",
    },
  },
  en: {
    dialog: "Annual report notes guide", close: "Close the guide", prev: "Previous", next: "Next", start: "Get started",
    pageOf: "Step {n} of {total}: {t}", goTo: "Go to step {n}: {t}", indexLabel: "What you'll see",
    button: "Guide", buttonHint: "Step-by-step guide to annual report notes",
    pages: {
      intro: {
        eyebrow: "Guide", short: "Introduction", title: "Report notes, step by step",
        desc: "The notes to the annual accounts, written here and filled in automatically with Konsolidator data. This guide covers everything you can do; start at the beginning or jump to what you need.",
      },
      create: {
        eyebrow: "Create", short: "Create a report", title: "A report in four answers",
        desc: "From “New report” a wizard asks four questions and builds the document with all its notes.",
        bullets: [
          "Individual (one company) or consolidated (a group, already consolidated)",
          "The company or the group's parent",
          "The period: usually the year end; the prior year is used only as comparative",
          "The model: Spanish GAAP full (25 notes) or IFRS-EU (20 notes). The name is suggested for you",
        ],
      },
      workspace: {
        eyebrow: "Workspace", short: "The workspace", title: "Everything at hand on one screen",
        desc: "At the top, the report bar; on the left, the index of notes; in the centre, the sheet of the note you're editing.",
        bullets: [
          "Bar: name (edit it in place), type and company, period, review, export, share and this guide",
          "Index with the status of each note: reviewed, schedule with differences, table with data, no amounts or text only",
          "Search a note, collapse the index, add your own notes or show hidden ones",
          "Everything is saved to the server automatically; the saved notice fades after a few seconds",
        ],
      },
      period: {
        eyebrow: "Period", short: "Period and data", title: "Change the period and everything recalculates",
        desc: "The period chip opens the picker. When you change it, every table and variable is recalculated with that close's data.",
        bullets: [
          "Year, closing month, source (Actual, Budget…) and group structure",
          "Comparative: prior year end for balance sheet, same month last year for P&L",
          "While data loads, the bar shows “Calculating…”",
          "Anything typed by hand is kept when the period changes",
        ],
      },
      text: {
        eyebrow: "Text", short: "Text with variables", title: "Text that writes the figures for you",
        desc: "Each note has formatted text that can include variables: amounts that update by themselves when the data changes.",
        bullets: [
          "“Insert variable”: search any figure from any note or a general item (entity, year, closing date, result)",
          "From the table, “Insert into text” adds a cell's amount as a variable",
          "A variable shows as a pill with its amount; click it to see where it comes from",
          "Bold, italic, lists, alignment, font and size",
        ],
      },
      tables: {
        eyebrow: "Tables", short: "Automatic tables", title: "Tables fill themselves in",
        desc: "Each note with a table knows its accounts through the standard's tags, so it works with any chart of accounts.",
        bullets: [
          "Breakdown (current and prior), opening and closing balances or plan movements, depending on the note",
          "The sign is set so the total is positive; “Sign” flips it",
          "Hide rows you don't want, add manual rows or leave the table out of the document",
          "Rows with no amount in either year are not shown",
        ],
      },
      custom: {
        eyebrow: "Your own tables", short: "Change the table", title: "Build the table you need",
        desc: "“Change table” opens the library; “Add column” and data rows let you tailor it without losing its accounts.",
        bullets: [
          "Library: Recommended, Breakdown, Comparison with variance, Movements, Closing balance or Blank",
          "Columns with a source: current, prior, variance, variance %, balances, additions, disposals, transfers or manual",
          "“Data row” finds any account (cash flow too); “Manual row” to type",
          "Rename rows and columns by clicking them",
        ],
      },
      movement: {
        eyebrow: "Movements", short: "Movement schedule", title: "The movement schedule reconciles itself",
        desc: "PP&E, intangibles, provisions or grants: opening balance, additions, disposals, transfers and closing balance, split into cost, depreciation and impairment, for the year and the prior year.",
        bullets: [
          "Balances always come from the books; if the plan doesn't split additions and disposals, they're inferred and flagged “Inferred (check)”",
          "Type additions or disposals and the other is calculated; the “Check” column shows what's missing",
          "Depreciation is checked against the P&L (681, 680…) and impairment against its own accounts",
          "Consolidated reports also get scope changes and translation differences",
        ],
      },
      source: {
        eyebrow: "Traceability", short: "Where each amount comes from", title: "Every figure explains its origin",
        desc: "Click a cell to see where it comes from: system, plan, inferred, calculated or typed by hand, with the formula and the accounts it adds up.",
        bullets: [
          "Double-click to type an amount; “Back to calculation” restores the system value",
          "“Link cell”: copy the amount of another cell in the report (picked from its table) or an account balance, in any period and with the sign you want",
          "If the linked item disappears, the cell warns that the link is broken",
          "“Insert into text” takes that cell into the note's text",
        ],
      },
      review: {
        eyebrow: "Review", short: "Review", title: "Review without missing anything",
        desc: "The review button opens a panel with three lists and a pending counter in the bar.",
        bullets: [
          "Notes: mark them as reviewed; the index and the progress ring show it",
          "Variables: each figure in the text; if it changes after review it goes back to pending and shows the old value",
          "Checks: run by themselves (movements, balances vs books, depreciation, broken links)",
          "“Review mode” jumps to the next pending item; “Pending only” filters the list",
        ],
      },
      share: {
        eyebrow: "Export and share", short: "Export and share", title: "Ready to deliver and to work as a team",
        desc: "Export the document whenever you want and decide who sees it and who edits it.",
        bullets: [
          "Word and PDF with all visible notes; Excel with one sheet per table",
          "Private, whole company (read-only) or specific people, with view or edit",
          "Anyone who can only view can duplicate it to get their own copy",
          "If two people save at once, nothing is overwritten: your changes go to a copy and you're told",
        ],
      },
      tips: {
        eyebrow: "To finish", short: "Tips", title: "A workflow that works",
        desc: "A quick way to close a report from start to finish.",
        bullets: [
          "Pick the period and let it calculate; go through notes with differences first",
          "Adjust tables and signs, and type what the books don't split",
          "Write the texts with variables so figures never go stale",
          "Open the review in “Review mode”, clear it and export",
        ],
      },
    },
    v: {
      doc: "Report 2026 · Norvia Group", ppe: "Property, plant & equip.", note5: "Note 5 · Property, plant and equipment",
      txt: "The net book value at year end amounts to", cuadra: "Reconciles",
      fText: "Text with variables", fTables: "Self-filling tables", fReview: "Review", fExport: "Word · PDF · Excel",
      newMem: "New report", wzSteps: ["Type", "Company", "Period", "Model"], ind: "Individual", cons: "Consolidated",
      indSub: "One company", consSub: "A consolidated group", pgc: "Spanish GAAP · Full", pgcSub: "25 notes", ifrs: "IFRS-EU", ifrsSub: "20 notes", create: "Create report",
      idx: ["Activity", "Basis of preparation", "Property, plant and equip.", "Intangible assets", "Inventories", "Tax"],
      idxSt: ["Reviewed", "Text only", "Schedule with differences", "Table with data", "Table without amounts", "Table with data"],
      search: "Search note", add: "Add note", saved: "Saved", period: "Dec 2026",
      year: "Year", month: "Closing month", source: "Source", structure: "Structure", calc: "Calculating…",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      account: "Account", cur: "Current year", prev: "Prior year",
      rowsPpe: ["Land", "Buildings", "Technical installations", "Furniture"], total: "Total",
      insertVar: "Insert variable", searchVar: "Search variable…", varA: "Net book value · Closing", varB: "Profit for the year", varC: "Closing date",
      whereFrom: "Where does it come from?", sistema: "System", formulaA: "Balance at year end",
      lib: "Change table", libItems: [["Recommended", "From the standard"], ["Breakdown", "Current and prior"], ["Comparison", "With variance and %"], ["Movements", "Additions, disposals"], ["Closing balance", "One column"], ["Blank", "Start from scratch"]],
      addCol: "Add column", colName: "Name", colSrc: "Column data", varPct: "Variance %",
      sign: "Sign", hideRow: "Hide row",
      movCols: ["Opening", "Additions", "Disposals", "Closing", "Check"], cost: "Cost", aa: "Depreciation", inferred: "Inferred (check)",
      handTyped: "Typed by hand", calcd: "Calculated to reconcile", plCheck: "Depreciation vs account 681", ok: "Matches",
      srcTitle: "Buildings · Closing balance", srcSys: "System", srcParts: [["2110", "Buildings"], ["2111", "Refurbishments"]],
      link: "Link cell", linkVar: "Another cell", linkAcc: "Account", linked: "Linked", backCalc: "Back to calculation",
      rvTabs: ["Notes", "Variables", "Checks"], rvMode: "Review mode", rvOnly: "Pending only", rvChanged: "Changed since review",
      rvItems: ["Company activity", "Basis of preparation", "Appropriation of result", "Property, plant and equip."],
      export: "Export", shareT: "Share", priv: "Private", comp: "Whole company", people: "People", canEdit: "Can edit", canRead: "Can view",
      tipsT: ["Period", "Differences", "Texts", "Review", "Export"], ready: "Report ready",
      memName: "Report 2026", memMeta: "Consolidated · Norvia", textT: "Text", net: "Net book value", sched: "Schedule",
      dataRow: "Data row", manualRow: "Manual row", rvTitle: "Review", rvVarName: "Note 5 · Closing balance",
      rvBadName: "Movement check 2025", rvBadSub: "1 row does not reconcile", linkA: "Note 6 · Total · Closing", linkB: "Note 7 · Total · Closing",
    },
  },
  da: {
    dialog: "Guide til noter", close: "Luk guiden", prev: "Forrige", next: "Næste", start: "Kom i gang",
    pageOf: "Trin {n} af {total}: {t}", goTo: "Gå til trin {n}: {t}", indexLabel: "Det får du at se",
    button: "Guide", buttonHint: "Trin-for-trin-guide til noter",
    pages: {
      intro: {
        eyebrow: "Guide", short: "Introduktion", title: "Noterne, trin for trin",
        desc: "Noterne til årsregnskabet, skrevet her og udfyldt automatisk med data fra Konsolidator. Guiden gennemgår alt, du kan gøre; start fra begyndelsen, eller spring til det, du har brug for.",
      },
      create: {
        eyebrow: "Opret", short: "Opret noter", title: "Noter på fire svar",
        desc: "Fra “Nye noter” stiller en assistent fire spørgsmål og opbygger dokumentet med alle noterne.",
        bullets: [
          "Individuel (ét selskab) eller konsolideret (en koncern, allerede konsolideret)",
          "Selskabet eller koncernens moderselskab",
          "Perioden: normalt årets afslutning; sidste år bruges kun som sammenligning",
          "Modellen: PGC · fuld model (25 noter) eller IFRS-EU (20 noter). Navnet foreslås automatisk",
        ],
      },
      workspace: {
        eyebrow: "Arbejdsområde", short: "Arbejdsområdet", title: "Alt ved hånden på én skærm",
        desc: "Øverst værktøjslinjen; til venstre indekset over noter; i midten arket med den note, du redigerer.",
        bullets: [
          "Linje: navn (redigeres direkte), type og selskab, periode, gennemgang, eksport, deling og denne guide",
          "Indeks med status for hver note: gennemgået, oversigt med differencer, tabel med data, uden beløb eller kun tekst",
          "Søg efter en note, fold indekset sammen, tilføj egne noter eller vis skjulte",
          "Alt gemmes automatisk på serveren; beskeden om, at det er gemt, forsvinder efter få sekunder",
        ],
      },
      period: {
        eyebrow: "Periode", short: "Periode og data", title: "Skift periode, og alt genberegnes",
        desc: "Periodechippen åbner vælgeren. Når du skifter, genberegnes alle tabeller og variabler med dataene for den afslutning.",
        bullets: [
          "År, afslutningsmåned, kilde (Actual, Budget…) og koncernstruktur",
          "Sammenligning: sidste års ultimo for balancen, samme måned sidste år for resultatopgørelsen",
          "Mens data hentes, viser linjen “Beregner…”",
          "Alt, der er skrevet manuelt, bevares, når perioden skifter",
        ],
      },
      text: {
        eyebrow: "Tekst", short: "Tekst med variabler", title: "Tekst, der skriver tallene for dig",
        desc: "Hver note har formateret tekst, der kan indeholde variabler: beløb, der opdateres af sig selv, når dataene ændres.",
        bullets: [
          "“Indsæt variabel”: søg et tal fra en hvilken som helst note eller en generel oplysning (enhed, år, afslutningsdato, resultat)",
          "Fra tabellen indsætter “Indsæt i tekst” en celles beløb som variabel",
          "En variabel vises som en pille med beløbet; klik på den for at se, hvor den kommer fra",
          "Fed, kursiv, lister, justering, skrifttype og størrelse",
        ],
      },
      tables: {
        eyebrow: "Tabeller", short: "Automatiske tabeller", title: "Tabellerne udfylder sig selv",
        desc: "Hver note med en tabel kender sine konti via standardens tags, så den virker med enhver kontoplan.",
        bullets: [
          "Specifikation (aktuelt og sidste år), primo- og ultimosaldi eller bevægelser fra kontoplanen, afhængigt af noten",
          "Fortegnet sættes, så totalen bliver positiv; “Fortegn” vender det",
          "Skjul rækker, du ikke vil have, tilføj manuelle rækker, eller udelad tabellen fra dokumentet",
          "Rækker uden beløb i begge år vises ikke",
        ],
      },
      custom: {
        eyebrow: "Egne tabeller", short: "Skift tabellen", title: "Byg den tabel, du har brug for",
        desc: "“Skift tabel” åbner biblioteket; “Tilføj kolonne” og datarækker lader dig tilpasse den uden at miste dens konti.",
        bullets: [
          "Bibliotek: Anbefalet, Specifikation, Sammenligning med afvigelse, Bevægelser, Ultimosaldo eller Tom",
          "Kolonner med kilde: aktuelt, sidste år, afvigelse, afvigelse %, saldi, tilgang, afgang, overførsler eller manuel",
          "“Datarække” finder enhver konto (også pengestrømme); “Manuel række” til at skrive",
          "Omdøb rækker og kolonner ved at klikke på dem",
        ],
      },
      movement: {
        eyebrow: "Bevægelser", short: "Bevægelsesoversigt", title: "Bevægelsesoversigten afstemmer sig selv",
        desc: "Materielle og immaterielle anlægsaktiver, hensatte forpligtelser eller tilskud: primo, tilgang, afgang, overførsler og ultimo, opdelt i kostpris, afskrivninger og nedskrivninger, for året og sidste år.",
        bullets: [
          "Saldi kommer altid fra bogføringen; adskiller kontoplanen ikke tilgang og afgang, udledes de og markeres “Udledt (kontrollér)”",
          "Skriv tilgang eller afgang, så beregnes den anden; kolonnen “Kontrol” viser, hvad der mangler",
          "Afskrivninger kontrolleres mod resultatopgørelsen (681, 680…) og nedskrivninger mod deres egne konti",
          "Konsoliderede noter får også ændringer i konsolideringskredsen og omregningsdifferencer",
        ],
      },
      source: {
        eyebrow: "Sporbarhed", short: "Hvor hvert beløb kommer fra", title: "Hvert tal forklarer sin oprindelse",
        desc: "Klik på en celle for at se, hvor den kommer fra: system, kontoplan, udledt, beregnet eller skrevet manuelt, med formlen og de konti, den summerer.",
        bullets: [
          "Dobbeltklik for at skrive et beløb; “Tilbage til beregning” gendanner systemværdien",
          "“Sammenkæd celle”: kopiér beløbet fra en anden celle i noterne (valgt i dens tabel) eller en kontosaldo, i en vilkårlig periode og med det fortegn, du vil",
          "Hvis det sammenkædede forsvinder, advarer cellen om, at linket er brudt",
          "“Indsæt i tekst” fører cellen ind i notens tekst",
        ],
      },
      review: {
        eyebrow: "Gennemgang", short: "Gennemgang", title: "Gennemgå uden at overse noget",
        desc: "Gennemgangsknappen åbner et panel med tre lister og en tæller for udestående i linjen.",
        bullets: [
          "Noter: markér dem som gennemgået; indekset og fremskridtsringen viser det",
          "Variabler: hvert tal i teksten; ændres det efter gennemgang, bliver det udestående igen og viser den gamle værdi",
          "Kontroller: kører af sig selv (bevægelser, saldi mod bogføring, afskrivninger, brudte links)",
          "“Gennemgangstilstand” springer til næste udestående; “Kun udestående” filtrerer listen",
        ],
      },
      share: {
        eyebrow: "Eksport og deling", short: "Eksport og deling", title: "Klar til aflevering og til teamarbejde",
        desc: "Eksportér dokumentet, når du vil, og bestem, hvem der ser det, og hvem der redigerer det.",
        bullets: [
          "Word og PDF med alle synlige noter; Excel med ét ark pr. tabel",
          "Privat, hele virksomheden (kun læsning) eller bestemte personer, med visning eller redigering",
          "Den, der kun kan se, kan duplikere den for at få sin egen kopi",
          "Gemmer to personer samtidig, overskrives intet: dine ændringer lægges i en kopi, og du får besked",
        ],
      },
      tips: {
        eyebrow: "Til sidst", short: "Tips", title: "En arbejdsgang, der virker",
        desc: "En hurtig måde at gøre noterne færdige fra start til slut.",
        bullets: [
          "Vælg perioden, og lad den beregne; gennemgå noter med differencer først",
          "Justér tabeller og fortegn, og skriv det, bogføringen ikke adskiller",
          "Skriv teksterne med variabler, så tallene aldrig bliver forældede",
          "Åbn gennemgangen i “Gennemgangstilstand”, få den ned på nul, og eksportér",
        ],
      },
    },
    v: {
      doc: "Noter 2026 · Norvia-koncernen", ppe: "Materielle anlægsaktiver", note5: "Note 5 · Materielle anlægsaktiver",
      txt: "Den bogførte værdi ultimo udgør", cuadra: "Afstemt",
      fText: "Tekst med variabler", fTables: "Selvudfyldende tabeller", fReview: "Gennemgang", fExport: "Word · PDF · Excel",
      newMem: "Nye noter", wzSteps: ["Type", "Selskab", "Periode", "Model"], ind: "Individuel", cons: "Konsolideret",
      indSub: "Ét selskab", consSub: "En konsolideret koncern", pgc: "PGC · fuld model", pgcSub: "25 noter", ifrs: "IFRS-EU", ifrsSub: "20 noter", create: "Opret noter",
      idx: ["Aktivitet", "Regnskabsgrundlag", "Materielle anlægsaktiver", "Immaterielle anlægsaktiver", "Varebeholdninger", "Skat"],
      idxSt: ["Gennemgået", "Kun tekst", "Oversigt med differencer", "Tabel med data", "Tabel uden beløb", "Tabel med data"],
      search: "Søg note", add: "Tilføj note", saved: "Gemt", period: "Dec 2026",
      year: "År", month: "Afslutningsmåned", source: "Kilde", structure: "Struktur", calc: "Beregner…",
      months: ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"],
      account: "Konto", cur: "Aktuelt år", prev: "Sidste år",
      rowsPpe: ["Grunde", "Bygninger", "Tekniske anlæg", "Inventar"], total: "I alt",
      insertVar: "Indsæt variabel", searchVar: "Søg variabel…", varA: "Bogført værdi · Ultimo", varB: "Årets resultat", varC: "Afslutningsdato",
      whereFrom: "Hvor kommer det fra?", sistema: "System", formulaA: "Saldo ultimo",
      lib: "Skift tabel", libItems: [["Anbefalet", "Fra standarden"], ["Specifikation", "Aktuelt og sidste år"], ["Sammenligning", "Med afvigelse og %"], ["Bevægelser", "Tilgang og afgang"], ["Ultimosaldo", "Én kolonne"], ["Tom", "Start fra bunden"]],
      addCol: "Tilføj kolonne", colName: "Navn", colSrc: "Kolonnedata", varPct: "Afvigelse %",
      sign: "Fortegn", hideRow: "Skjul række",
      movCols: ["Primo", "Tilgang", "Afgang", "Ultimo", "Kontrol"], cost: "Kostpris", aa: "Afskrivninger", inferred: "Udledt (kontrollér)",
      handTyped: "Skrevet manuelt", calcd: "Beregnet til afstemning", plCheck: "Afskrivninger vs konto 681", ok: "Stemmer",
      srcTitle: "Bygninger · Ultimosaldo", srcSys: "System", srcParts: [["2110", "Bygninger"], ["2111", "Ombygninger"]],
      link: "Sammenkæd celle", linkVar: "En anden celle", linkAcc: "Konto", linked: "Sammenkædet", backCalc: "Tilbage til beregning",
      rvTabs: ["Noter", "Variabler", "Kontroller"], rvMode: "Gennemgangstilstand", rvOnly: "Kun udestående", rvChanged: "Ændret siden gennemgang",
      rvItems: ["Selskabets aktivitet", "Regnskabsgrundlag", "Resultatdisponering", "Materielle anlægsaktiver"],
      export: "Eksportér", shareT: "Del", priv: "Privat", comp: "Hele virksomheden", people: "Personer", canEdit: "Kan redigere", canRead: "Kan se",
      tipsT: ["Periode", "Differencer", "Tekster", "Gennemgang", "Eksport"], ready: "Noterne er klar",
      memName: "Noter 2026", memMeta: "Konsolideret · Norvia", textT: "Tekst", net: "Bogført værdi", sched: "Oversigt",
      dataRow: "Datarække", manualRow: "Manuel række", rvTitle: "Gennemgang", rvVarName: "Note 5 · Ultimosaldo",
      rvBadName: "Bevægelseskontrol 2025", rvBadSub: "1 række stemmer ikke", linkA: "Note 6 · I alt · Ultimo", linkB: "Note 7 · I alt · Ultimo",
    },
  },
  pt: {
    dialog: "Guia do anexo", close: "Fechar o guia", prev: "Anterior", next: "Seguinte", start: "Começar",
    pageOf: "Passo {n} de {total}: {t}", goTo: "Ir para o passo {n}: {t}", indexLabel: "O que vai ver",
    button: "Guia", buttonHint: "Guia passo a passo do anexo",
    pages: {
      intro: {
        eyebrow: "Guia", short: "Introdução", title: "O anexo, passo a passo",
        desc: "O anexo às contas anuais, escrito aqui e preenchido automaticamente com os dados do Konsolidator. Este guia percorre tudo o que pode fazer; comece pelo início ou salte para o que lhe interessa.",
      },
      create: {
        eyebrow: "Criar", short: "Criar um anexo", title: "Um anexo em quatro respostas",
        desc: "A partir de «Novo anexo», um assistente faz-lhe quatro perguntas e monta o documento com todas as notas.",
        bullets: [
          "Individual (uma sociedade) ou consolidado (um grupo, já consolidado)",
          "A sociedade ou a empresa-mãe do grupo",
          "O período: normalmente o fecho; o ano anterior usa-se só como comparativo",
          "O modelo: PGC · modelo normal (25 notas) ou IFRS-UE (20 notas). O nome é sugerido automaticamente",
        ],
      },
      workspace: {
        eyebrow: "Área de trabalho", short: "A área de trabalho", title: "Tudo à mão num só ecrã",
        desc: "Em cima, a barra do anexo; à esquerda, o índice das notas; ao centro, a folha da nota que está a editar.",
        bullets: [
          "Barra: nome (edita-se ali mesmo), tipo e sociedade, período, revisão, exportar, partilhar e este guia",
          "Índice com o estado de cada nota: revista, mapa com diferenças, tabela com dados, sem montantes ou só texto",
          "Pesquise uma nota, recolha o índice, adicione notas próprias ou mostre as ocultas",
          "Tudo é guardado automaticamente no servidor; o aviso de guardado desaparece após alguns segundos",
        ],
      },
      period: {
        eyebrow: "Período", short: "Período e dados", title: "Mude o período e tudo é recalculado",
        desc: "O chip do período abre o seletor. Ao mudá-lo, todas as tabelas e variáveis são recalculadas com os dados desse fecho.",
        bullets: [
          "Exercício, mês de fecho, fonte (Actual, Budget…) e estrutura do grupo",
          "Comparativo: fecho do ano anterior no balanço e mesmo mês do ano anterior na demonstração de resultados",
          "Enquanto os dados chegam, a barra mostra «A calcular…»",
          "O que escreveu à mão mantém-se ao mudar de período",
        ],
      },
      text: {
        eyebrow: "Texto", short: "Texto com variáveis", title: "Um texto que escreve os valores por si",
        desc: "Cada nota tem o seu texto, com formatação, e pode incluir variáveis: montantes que se atualizam sozinhos quando os dados mudam.",
        bullets: [
          "«Inserir variável»: pesquise qualquer valor de qualquer nota ou um dado geral (entidade, exercício, data de fecho, resultado)",
          "Na tabela, «Inserir no texto» coloca o montante de uma célula como variável",
          "A variável aparece como uma etiqueta com o montante; ao clicar, mostra de onde vem",
          "Negrito, itálico, listas, alinhamento, tipo e tamanho de letra",
        ],
      },
      tables: {
        eyebrow: "Tabelas", short: "Tabelas automáticas", title: "As tabelas preenchem-se sozinhas",
        desc: "Cada nota com tabela sabe que contas lhe cabem pelas etiquetas da norma, por isso funciona com qualquer plano de contas.",
        bullets: [
          "Discriminação (atual e anterior), saldos inicial e final ou movimentos do plano, conforme a nota",
          "O sinal é ajustado para o total sair positivo; «Sinal» inverte-o",
          "Oculte linhas que não queira, adicione linhas manuais ou retire a tabela do documento",
          "As linhas sem montante em nenhum exercício não aparecem",
        ],
      },
      custom: {
        eyebrow: "Tabelas próprias", short: "Mudar a tabela", title: "Monte a tabela de que precisa",
        desc: "«Mudar tabela» abre a biblioteca; «Adicionar coluna» e as linhas com dados permitem-lhe ajustá-la sem perder as contas que já tinha.",
        bullets: [
          "Biblioteca: Recomendada, Discriminação, Comparativa com variação, Movimentos, Saldo no fecho ou Em branco",
          "Colunas com origem: atual, anterior, variação, variação %, saldos, aumentos, diminuições, transferências ou manual",
          "«Linha com dados» procura qualquer conta (também de fluxos de caixa); «Linha manual» para escrever",
          "Mude o nome de linhas e colunas clicando nelas",
        ],
      },
      movement: {
        eyebrow: "Movimentos", short: "Mapa de movimentos", title: "O mapa de movimentos concilia-se sozinho",
        desc: "Ativos fixos tangíveis, intangíveis, provisões ou subsídios: saldo inicial, aumentos, diminuições, transferências e saldo final, separados em custo, depreciações e imparidades, do exercício e do anterior.",
        bullets: [
          "Saldos sempre da contabilidade; se o plano não separa aumentos e diminuições, são deduzidos e marcados «Deduzido (rever)»",
          "Escreva aumentos ou diminuições e o outro é calculado; a coluna «Controlo» mostra o que falta",
          "As depreciações são confrontadas com a demonstração de resultados (681, 680…) e as imparidades com as suas contas",
          "Nos consolidados, também alterações de perímetro e diferenças de conversão",
        ],
      },
      source: {
        eyebrow: "Rastreabilidade", short: "De onde vem cada montante", title: "Cada valor explica a sua origem",
        desc: "Clique numa célula e veja de onde vem: do sistema, do plano, deduzido, calculado ou escrito à mão, com a fórmula e as contas que soma.",
        bullets: [
          "Duplo clique para escrever um montante; «Voltar ao cálculo» repõe o valor do sistema",
          "«Vincular célula»: copia o montante de outra célula do anexo (escolhida na sua tabela) ou o saldo de uma conta, no período e com o sinal que quiser",
          "Se o vinculado deixar de existir, a célula avisa que o vínculo está quebrado",
          "«Inserir no texto» leva essa célula para o texto da nota",
        ],
      },
      review: {
        eyebrow: "Revisão", short: "Revisão", title: "Reveja sem deixar nada para trás",
        desc: "O botão de revisão abre um painel com três listas e um contador de pendentes na barra.",
        bullets: [
          "Notas: marque-as como revistas; o índice e o anel de progresso refletem-no",
          "Variáveis: cada valor do texto; se mudar depois de revisto, volta a pendente e mostra o valor anterior",
          "Controlos: verificam-se sozinhos (movimentos, saldos vs contabilidade, depreciações, vínculos quebrados)",
          "«Modo revisão» salta para o próximo pendente; «Só pendentes» filtra a lista",
        ],
      },
      share: {
        eyebrow: "Exportar e partilhar", short: "Exportar e partilhar", title: "Pronto a entregar e a trabalhar em equipa",
        desc: "Exporte o documento quando quiser e decida quem o vê e quem o edita.",
        bullets: [
          "Word e PDF com todas as notas visíveis; Excel com uma folha por tabela",
          "Privado, toda a empresa (só leitura) ou pessoas concretas, com leitura ou edição",
          "Quem só pode ver pode duplicá-lo para ter a sua própria cópia",
          "Se duas pessoas guardarem ao mesmo tempo, nada se perde: as suas alterações ficam numa cópia e é avisado",
        ],
      },
      tips: {
        eyebrow: "Para terminar", short: "Dicas", title: "Um fluxo que funciona",
        desc: "Uma forma rápida de fechar um anexo do início ao fim.",
        bullets: [
          "Escolha o período e deixe calcular; reveja primeiro as notas com diferenças",
          "Ajuste tabelas e sinais, e escreva o que a contabilidade não separa",
          "Redija os textos com variáveis para que os valores nunca fiquem desatualizados",
          "Abra a revisão em «Modo revisão», deixe-a a zero e exporte",
        ],
      },
    },
    v: {
      doc: "Anexo 2026 · Grupo Norvia", ppe: "Ativos fixos tangíveis", note5: "Nota 5 · Ativos fixos tangíveis",
      txt: "O valor líquido no fecho ascende a", cuadra: "Concilia",
      fText: "Texto com variáveis", fTables: "Tabelas automáticas", fReview: "Revisão", fExport: "Word · PDF · Excel",
      newMem: "Novo anexo", wzSteps: ["Tipo", "Sociedade", "Período", "Modelo"], ind: "Individual", cons: "Consolidado",
      indSub: "Uma sociedade", consSub: "Um grupo consolidado", pgc: "PGC · modelo normal", pgcSub: "25 notas", ifrs: "IFRS-UE", ifrsSub: "20 notas", create: "Criar anexo",
      idx: ["Atividade", "Bases de apresentação", "Ativos fixos tangíveis", "Ativos intangíveis", "Inventários", "Imposto"],
      idxSt: ["Revista", "Só texto", "Mapa com diferenças", "Tabela com dados", "Tabela sem montantes", "Tabela com dados"],
      search: "Pesquisar nota", add: "Adicionar nota", saved: "Guardado", period: "Dez 2026",
      year: "Exercício", month: "Mês de fecho", source: "Fonte", structure: "Estrutura", calc: "A calcular…",
      months: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
      account: "Conta", cur: "Exercício atual", prev: "Exercício anterior",
      rowsPpe: ["Terrenos", "Edifícios", "Equipamento básico", "Mobiliário"], total: "Total",
      insertVar: "Inserir variável", searchVar: "Pesquisar variável…", varA: "Valor líquido · Saldo final", varB: "Resultado do exercício", varC: "Data de fecho",
      whereFrom: "De onde vem?", sistema: "Sistema", formulaA: "Saldo no fecho do exercício",
      lib: "Mudar tabela", libItems: [["Recomendada", "A da norma"], ["Discriminação", "Atual e anterior"], ["Comparativa", "Com variação e %"], ["Movimentos", "Entradas e saídas"], ["Saldo no fecho", "Uma coluna"], ["Em branco", "Começar do zero"]],
      addCol: "Adicionar coluna", colName: "Nome", colSrc: "Dados da coluna", varPct: "Variação %",
      sign: "Sinal", hideRow: "Ocultar linha",
      movCols: ["Inicial", "Aumentos", "Diminuições", "Final", "Controlo"], cost: "Custo", aa: "Depreciações", inferred: "Deduzido (rever)",
      handTyped: "Escrito à mão", calcd: "Calculado para conciliar", plCheck: "Depreciações vs conta 681", ok: "Coincide",
      srcTitle: "Edifícios · Saldo final", srcSys: "Sistema", srcParts: [["2110", "Edifícios"], ["2111", "Remodelações"]],
      link: "Vincular célula", linkVar: "Outra célula", linkAcc: "Conta", linked: "Vinculada", backCalc: "Voltar ao cálculo",
      rvTabs: ["Notas", "Variáveis", "Controlos"], rvMode: "Modo revisão", rvOnly: "Só pendentes", rvChanged: "Mudou desde a revisão",
      rvItems: ["Atividade da empresa", "Bases de apresentação", "Aplicação de resultados", "Ativos fixos tangíveis"],
      export: "Exportar", shareT: "Partilhar", priv: "Privado", comp: "Toda a empresa", people: "Pessoas", canEdit: "Pode editar", canRead: "Pode ver",
      tipsT: ["Período", "Diferenças", "Textos", "Revisão", "Exportar"], ready: "Anexo pronto",
      memName: "Anexo 2026", memMeta: "Consolidado · Norvia", textT: "Texto", net: "Valor líquido", sched: "Mapa",
      dataRow: "Linha com dados", manualRow: "Linha manual", rvTitle: "Revisão", rvVarName: "Nota 5 · Saldo final",
      rvBadName: "Controlo do movimento 2025", rvBadSub: "1 linha não concilia", linkA: "Nota 6 · Total · Saldo final", linkB: "Nota 7 · Total · Saldo final",
    },
  },
};
function pickLang(locale) {
  const l = String(locale ?? (typeof navigator !== "undefined" ? navigator.language : "es")).slice(0, 2).toLowerCase();
  return TEXT[l] ? l : "en";
}
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

/* ── Movimiento reducido ───────────────────────────────────────────── */
const RM_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb) => {
  const mq = window.matchMedia?.(RM_QUERY);
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
};
const getRM = () => !!window.matchMedia?.(RM_QUERY).matches;
function useReducedMotion() { return useSyncExternalStore(subscribeRM, getRM, () => false); }

/* ════════════════════════════════════════════════════════════════
   Viñetas (lienzo fijo de 460 × 400, escalado al escenario)
   ════════════════════════════════════════════════════════════════ */
const ART_W = 460, ART_H = 400;
const d = (ms) => ({ "--d": ms });
const nf = (n, lang) => new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-GB", { maximumFractionDigits: 0 }).format(n);

// Un valor que cambia a otro a los «at» ms
function Swap({ from, to, at, className = "" }) {
  return (
    <span className={`mgSwap ${className}`}>
      <i className="mgSwapOld" style={d(at)}>{from}</i>
      <i className="mgSwapNew" style={d(at)}>{to}</i>
    </span>
  );
}
// Toque de dedo / clic en un punto
const Tap = ({ x, y, at }) => <i className="mgTap" style={{ left: x, top: y, ...d(at) }} />;

/* 1) Portada: una memoria que se escribe y se rellena sola */
function VIntro({ L, lang }) {
  return (
    <>
      <div className="mgCard mgUp mgDoc" style={{ left: 74, top: 42, width: 312, height: 318, ...d(60) }}>
        <div className="mgDocHead"><b><FileText size={13} strokeWidth={2.4} />{L.doc}</b><span className="mgPill mgPillOk mgPop" style={d(2600)}><Check size={10} strokeWidth={3} />{L.saved}</span></div>
        <p className="mgDocKicker mgFade" style={d(300)}>{L.note5}</p>
        <div className="mgLines">
          {[100, 94, 72].map((w, i) => <i key={i} className="mgLine" style={{ width: `${w}%`, ...d(420 + i * 120) }} />)}
        </div>
        <p className="mgDocTxt mgFade" style={d(900)}>{L.txt} <span className="mgVarPill mgPop" style={d(1500)}>{nf(1465000, lang)} €</span></p>
        <div className="mgMiniTable">
          {L.rowsPpe.slice(0, 3).map((r, i) => (
            <div key={r} className="mgMiniRow mgUp" style={d(1200 + i * 140)}><span>{r}</span><b>{nf([420000, 795000, 250000][i], lang)}</b></div>
          ))}
          <div className="mgMiniRow mgMiniTot mgUp" style={d(1700)}><span>{L.total}</span><b>{nf(1465000, lang)}</b></div>
        </div>
        <span className="mgPill mgPillOk mgPop" style={{ position: "absolute", right: 14, bottom: 14, ...d(2100) }}><CircleCheck size={11} strokeWidth={2.6} />{L.cuadra}</span>
      </div>
      <span className="mgFloat mgPop" style={{ left: 10, top: 6, ...d(2300) }}><AlignLeft size={12} />{L.fText}</span>
      <span className="mgFloat mgPop" style={{ right: 10, top: 6, ...d(2500) }}><Table2 size={12} />{L.fTables}</span>
      <span className="mgFloat mgPop" style={{ left: 30, top: 368, ...d(2700) }}><ListChecks size={12} />{L.fReview}</span>
      <span className="mgFloat mgPop" style={{ right: 30, top: 368, ...d(2900) }}><FileText size={12} />{L.fExport}</span>
    </>
  );
}

/* 2) Crear: el asistente de cuatro pasos */
function VCreate({ L }) {
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 30, top: 24, width: 400, height: 352, ...d(40) }}>
        <div className="mgCardHead"><b><Sparkles size={13} strokeWidth={2.4} />{L.newMem}</b></div>
        <div className="mgSteps">
          {L.wzSteps.map((s, i) => (
            <span key={s} className="mgStep" style={{ "--on": `${400 + i * 900}ms` }}><i>{i + 1}</i>{s}</span>
          ))}
        </div>
        <div className="mgWzBody">
          <div className="mgWzRow mgUp" style={d(300)}>
            <span className="mgOpt mgOptPick" style={{ "--pick": "900ms" }}><Building size={16} /><b>{L.ind}</b><em>{L.indSub}</em></span>
            <span className="mgOpt"><Network size={16} /><b>{L.cons}</b><em>{L.consSub}</em></span>
          </div>
          <div className="mgWzField mgUp" style={d(1300)}><Building size={13} /><span>Grupo Norvia S.A.</span><i className="mgCaret" /></div>
          <div className="mgWzField mgUp" style={d(2200)}><CalendarRange size={13} /><span>{L.period} · Actual</span><i className="mgCaret" /></div>
          <div className="mgWzRow mgUp" style={d(3000)}>
            <span className="mgOpt mgOptPick" style={{ "--pick": "3500ms" }}><FileText size={16} /><b>{L.pgc}</b><em>{L.pgcSub}</em></span>
            <span className="mgOpt"><FileText size={16} /><b>{L.ifrs}</b><em>{L.ifrsSub}</em></span>
          </div>
        </div>
        <span className="mgBtn mgPop" style={{ position: "absolute", right: 16, bottom: 16, ...d(3900) }}>{L.create}<ArrowRight size={13} strokeWidth={2.6} /></span>
      </div>
      <Tap x={118} y={150} at={850} />
      <Tap x={118} y={302} at={3450} />
      <Tap x={385} y={352} at={4300} />
    </>
  );
}

/* 3) Espacio de trabajo: barra, índice y hoja */
function VWorkspace({ L }) {
  const st = ["ok", "text", "warn", "data", "empty", "data"];
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 12, top: 18, width: 436, height: 364, ...d(40) }}>
        <div className="mgBar mgHi" style={{ "--hi": "1200ms" }}>
          <span className="mgBarName"><b>{L.memName}</b><em>{L.memMeta}</em></span>
          <span className="mgSaved" style={d(500)}><Check size={10} strokeWidth={3} />{L.saved}</span>
          <span className="mgChip"><CalendarRange size={11} />{L.period}</span>
          <span className="mgIco"><ListChecks size={12} /><i className="mgBadge">4</i></span>
          <span className="mgIco"><Share2 size={12} /></span>
          <span className="mgIco mgIcoOn"><BookOpen size={12} /></span>
        </div>
        <div className="mgWs">
          <div className="mgIdx2 mgHi" style={{ "--hi": "2600ms" }}>
            <span className="mgIdxSearch"><Search size={10} />{L.search}</span>
            {L.idx.map((t, i) => (
              <span key={t} className={`mgIdxRow ${i === 2 ? "isSel" : ""} mgUp`} style={d(300 + i * 90)}>
                <i className={`mgSt mgSt_${st[i]}`}>{st[i] === "ok" ? <Check size={9} strokeWidth={3.4} /> : i + 1}</i>
                <span><b>{t}</b><em>{L.idxSt[i]}</em></span>
              </span>
            ))}
            <span className="mgIdxAdd"><Plus size={10} />{L.add}</span>
          </div>
          <div className="mgSheet mgHi" style={{ "--hi": "4000ms" }}>
            <p className="mgDocKicker">{L.note5}</p>
            <div className="mgLines">{[96, 88, 64].map((w, i) => <i key={i} className="mgLine" style={{ width: `${w}%`, ...d(600 + i * 100) }} />)}</div>
            <div className="mgMiniTable" style={{ marginTop: 10 }}>
              {[0, 1, 2].map(i => <div key={i} className="mgMiniRow mgUp" style={d(900 + i * 100)}><span><i className="mgLine" style={{ width: 70 }} /></span><b><i className="mgLine" style={{ width: 40 }} /></b></div>)}
            </div>
          </div>
        </div>
      </div>
      <span className="mgNumB mgPop" style={{ left: 1, top: 7, ...d(1200) }}>1</span>
      <span className="mgNumB mgPop" style={{ left: 159, top: 230, ...d(2600) }}>2</span>
      <span className="mgNumB mgPop" style={{ left: 437, top: 200, ...d(4000) }}>3</span>
    </>
  );
}

/* 4) Periodo: selector y recálculo */
function VPeriod({ L, lang }) {
  return (
    <>
      <div className="mgPanel mgUp" style={{ left: 10, top: 34, width: 226, ...d(40) }}>
        <p className="mgEyeSm">{L.year}</p>
        <div className="mgYears">{["2024", "2025", "2026"].map((y, i) => <span key={y} className={i === 2 ? "mgPickOn" : ""} style={i === 2 ? { "--pick": "500ms" } : undefined}>{y}</span>)}</div>
        <p className="mgEyeSm" style={{ marginTop: 12 }}>{L.month}</p>
        <div className="mgMonths">{L.months.map((m, i) => <span key={m} className={i === 11 ? "mgPickOn" : ""} style={i === 11 ? { "--pick": "1100ms" } : undefined}>{m}</span>)}</div>
        <p className="mgEyeSm" style={{ marginTop: 12 }}>{L.source} · {L.structure}</p>
        <div className="mgYears"><span className="mgPickOn" style={{ "--pick": "0ms" }}>Actual</span><span>Budget</span><span>Default</span></div>
      </div>
      <Tap x={191} y={82} at={450} />
      <Tap x={207} y={170} at={1050} />
      <div className="mgCard mgUp" style={{ left: 246, top: 92, width: 204, height: 234, ...d(300) }}>
        <div className="mgCardHead"><b><Table2 size={12} />{L.ppe}</b></div>
        {L.rowsPpe.map((r, i) => (
          <div key={r} className="mgTRow"><span>{r}</span><Swap from={nf([410000, 760000, 230000, 98000][i], lang)} to={nf([420000, 795000, 250000, 104000][i], lang)} at={2300 + i * 110} /></div>
        ))}
        <div className="mgTRow mgTTot"><span>{L.total}</span><Swap from={nf(1498000, lang)} to={nf(1569000, lang)} at={2800} /></div>
        <span className="mgPill mgPillOk mgPop" style={{ position: "absolute", right: 12, bottom: 12, ...d(3200) }}><Check size={10} strokeWidth={3} />{L.period}</span>
        <span className="mgCalc" style={{ position: "absolute", left: 14, bottom: 17, ...d(1400) }}>{L.calc}</span>
      </div>
    </>
  );
}

/* 5) Texto con variables */
function VText({ L, lang }) {
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 16, top: 22, width: 428, height: 150, ...d(40) }}>
        <div className="mgCardHead"><b><AlignLeft size={12} />{L.textT}</b><span className="mgChip mgPressed" style={{ "--press": "1300ms" }}><Braces size={11} />{L.insertVar}</span></div>
        <div className="mgFmt mgFade" style={d(200)}><b>B</b><i>I</i><u>U</u><span>≡</span><span>•</span><span>1.</span></div>
        <p className="mgTyped">
          <span className="mgType" style={{ "--w": "392px", ...d(300) }}>{L.txt}</span>
          <span className="mgVarPill mgPop" style={d(2700)}>{nf(1465000, lang)} €</span>
        </p>
        <p className="mgTyped mgFade" style={d(3000)}>{L.year} <span className="mgVarPill">2026</span> · {L.varC} <span className="mgVarPill mgVarSoft">31/12/2026</span></p>
      </div>
      <div className="mgPanel mgPop" style={{ left: 196, top: 158, width: 240, padding: 10, ...d(1500) }}>
        <span className="mgSearchBox"><Search size={11} />{L.searchVar}</span>
        {[[L.varA, nf(1465000, lang)], [L.varB, nf(318400, lang)], [L.varC, "31/12/2026"]].map(([a, b], i) => (
          <span key={a} className={`mgVarRow ${i === 0 ? "mgVarRowPick" : ""}`} style={i === 0 ? { "--pick": "2300ms" } : undefined}><span>{a}</span><b>{b}</b></span>
        ))}
      </div>
      <Tap x={316} y={213} at={2250} />
      <div className="mgPanel mgPop mgTipCard" style={{ left: 22, top: 286, width: 236, ...d(3600) }}>
        <p className="mgMicro"><MousePointerClick size={10} /> {L.whereFrom}</p>
        <b className="mgBigN">{nf(1465000, lang)} €</b>
        <span className="mgSrcBadge">{L.sistema}</span><em className="mgSrcF">{L.varA}</em>
      </div>
      <Tap x={305} y={111} at={3450} />
    </>
  );
}

/* 6) Tablas automáticas */
function VTables({ L, lang }) {
  const vals = [[420000, 410000], [795000, 760000], [250000, 230000], [13200, 12900]];
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 16, top: 50, width: 428, height: 252, ...d(40) }}>
        <div className="mgCardHead">
          <b><Table2 size={12} />{L.ppe} · {L.libItems[1][0]}</b>
          <span className="mgChip mgPressed" style={{ "--press": "2600ms" }}><ArrowUpDown size={11} />{L.sign}</span>
        </div>
        <div className="mgTHead"><span>{L.account}</span><span>{L.cur}</span><span>{L.prev}</span></div>
        {L.rowsPpe.map((r, i) => (
          <div key={r} className={`mgTRow3 mgUp ${i === 3 ? "mgRowHide" : ""}`} style={{ ...d(400 + i * 160), "--hide": "3800ms" }}>
            <span><i className="mgCode">BS_02</i>{r}</span>
            <Swap from={nf(-vals[i][0], lang)} to={nf(vals[i][0], lang)} at={2700 + i * 60} />
            <Swap from={nf(-vals[i][1], lang)} to={nf(vals[i][1], lang)} at={2700 + i * 60} />
          </div>
        ))}
        <div className="mgTRow3 mgTTot mgUp" style={d(1200)}>
          <span>{L.total}</span>
          <Swap from={nf(-1465000, lang)} to={nf(1465000, lang)} at={3000} />
          <Swap from={nf(-1400000, lang)} to={nf(1400000, lang)} at={3000} />
        </div>
      </div>
      <span className="mgFloat mgPop" style={{ left: 24, top: 318, ...d(4000) }}><EyeOff size={12} />{L.hideRow}</span>
      <span className="mgFloat mgPop" style={{ right: 24, top: 318, ...d(1700) }}><Layers size={12} />BS_02 · PP&E</span>
      <Tap x={404} y={70} at={2550} />
    </>
  );
}

/* 7) Cambiar la tabla y añadir columnas */
function VCustom({ L, lang }) {
  return (
    <>
      <div className="mgPanel mgUp" style={{ left: 14, top: 18, width: 432, ...d(40) }}>
        <div className="mgPanelHead"><LayoutGrid size={13} />{L.lib}</div>
        <div className="mgLib">
          {L.libItems.map(([t, s], i) => (
            <span key={t} className={`mgLibCard mgUp ${i === 2 ? "mgLibPick" : ""}`} style={{ ...d(200 + i * 90), "--pick": "1400ms" }}>
              <Table2 size={13} /><b>{t}</b><em>{s}</em>
            </span>
          ))}
        </div>
      </div>
      <Tap x={366} y={78} at={1350} />
      <div className="mgCard mgUp" style={{ left: 10, top: 206, width: 282, height: 160, ...d(1800) }}>
        <div className="mgTHead mgTHead4"><span>{L.account}</span><span>{L.cur}</span><span>{L.prev}</span><span className="mgColNew" style={d(3600)}>{L.varPct}</span></div>
        {L.rowsPpe.slice(0, 3).map((r, i) => (
          <div key={r} className="mgTRow4 mgUp" style={d(2000 + i * 120)}>
            <span>{r}</span><b>{nf([420000, 795000, 250000][i], lang)}</b><b>{nf([410000, 760000, 230000][i], lang)}</b>
            <b className="mgColNew mgPos" style={d(3700 + i * 80)}>+{[2.4, 4.6, 8.7][i].toLocaleString(lang === "es" ? "es-ES" : "en-GB")} %</b>
          </div>
        ))}
        <div className="mgTRow4 mgAddRow mgFade" style={d(2600)}><span><Plus size={10} />{L.dataRow}</span><span><Pencil size={10} />{L.manualRow}</span></div>
      </div>
      <div className="mgPanel mgPop" style={{ left: 300, top: 206, width: 150, padding: 10, ...d(2700) }}>
        <p className="mgEyeSm" style={{ margin: "0 0 6px" }}>{L.addCol}</p>
        <span className="mgField">{L.colName}<i>{L.varPct}</i></span>
        <span className="mgField">{L.colSrc}<i>{L.varPct}<span className="mgCaret" /></i></span>
        <span className="mgBtn mgBtnSm mgPressed" style={{ "--press": "3400ms" }}><Columns3 size={11} />{L.addCol}</span>
      </div>
    </>
  );
}

/* 8) Cuadro de movimientos */
function VMovement({ L, lang }) {
  const N = (n) => nf(n, lang);
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 10, top: 22, width: 440, height: 250, ...d(40) }}>
        <div className="mgCardHead"><b><Scale size={12} />{L.ppe}</b><span className="mgPill mgPillOk mgPop" style={d(3400)}><CircleCheck size={10} />{L.cuadra}</span></div>
        <div className="mgMHead"><span />{L.movCols.map(c => <span key={c}>{c}</span>)}</div>
        <div className="mgMLayer mgFade" style={d(300)}>{L.cost}</div>
        <div className="mgMRow mgUp" style={d(400)}>
          <span>{L.rowsPpe[1]}</span><b>{N(760000)}</b>
          <b className="mgInf">{N(35000)}</b><b>0</b><b>{N(795000)}</b><b className="mgOkC">0</b>
        </div>
        <div className="mgMRow mgUp" style={d(520)}>
          <span>{L.rowsPpe[2]}</span><b>{N(230000)}</b>
          <b><Swap from={<span className="mgInf">{N(20000)}</span>} to={<span className="mgCalcV">{N(32000)}</span>} at={2300} /></b>
          <b><Swap from="0" to={<span className="mgHand">−{N(12000)}</span>} at={1900} /></b>
          <b>{N(250000)}</b><b className="mgOkC">0</b>
        </div>
        <div className="mgMLayer mgFade" style={d(700)}>{L.aa}</div>
        <div className="mgMRow mgUp" style={d(800)}>
          <span>{L.rowsPpe[1]}</span><b>−{N(152000)}</b><b className="mgInf">−{N(31800)}</b><b>0</b><b>−{N(183800)}</b><b className="mgOkC">0</b>
        </div>
        <div className="mgMRow mgMNet mgUp" style={d(950)}>
          <span>{L.net}</span><b>{N(838000)}</b><b /><b /><b>{N(861200)}</b><b />
        </div>
      </div>
      <Tap x={232} y={127} at={1800} />
      <span className="mgFloat mgLegend mgPop" style={{ left: 10, top: 286, ...d(1200) }}><i className="mgDotInf" />{L.inferred}</span>
      <span className="mgFloat mgLegend mgPop" style={{ left: 10, top: 321, ...d(2000) }}><i className="mgDotHand" />{L.handTyped}</span>
      <span className="mgFloat mgLegend mgPop" style={{ left: 10, top: 356, ...d(2400) }}><i className="mgDotCalc" />{L.calcd}</span>
      <div className="mgPanel mgPop" style={{ left: 236, top: 296, width: 214, padding: 11, ...d(3000) }}>
        <p className="mgMicro">{L.plCheck}</p>
        <span className="mgCheckLine"><span>{L.sched} {N(31800)}</span><span>681 {N(31800)}</span><i className="mgTick"><Check size={9} strokeWidth={3.4} /></i></span>
      </div>
    </>
  );
}

/* 9) De dónde sale cada importe y vincular */
function VSource({ L, lang }) {
  const N = (n) => nf(n, lang);
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 12, top: 34, width: 220, height: 132, ...d(40) }}>
        <div className="mgTHead mgTHead2"><span>{L.account}</span><span>{L.cur}</span></div>
        {L.rowsPpe.slice(0, 3).map((r, i) => (
          <div key={r} className={`mgTRow2 ${i === 1 ? "mgCellPick" : ""}`} style={i === 1 ? { "--pick": "700ms" } : undefined}>
            <span>{r}</span><b>{i === 1 ? <Swap from={N(795000)} to={<span className="mgLinkedV"><Link2 size={9} />{N(801500)}</span>} at={3900} /> : N([420000, 795000, 250000][i])}</b>
          </div>
        ))}
      </div>
      <Tap x={196} y={108} at={650} />
      <div className="mgPanel mgSlideIn" style={{ left: 246, top: 18, width: 202, ...d(900) }}>
        <p className="mgMicro">{L.whereFrom}</p>
        <b className="mgSrcTitle">{L.srcTitle}</b>
        <b className="mgBigN">{N(795000)}</b>
        <span className="mgSrcBadge">{L.srcSys}</span>
        <em className="mgSrcF">{L.formulaA}</em>
        {L.srcParts.map(([c, n], i) => <span key={c} className="mgPart mgUp" style={d(1300 + i * 140)}><i className="mgCode">{c}</i>{n}<b>{N([640000, 155000][i])}</b></span>)}
        <span className="mgBtn mgBtnGhost mgPressed" style={{ "--press": "2300ms", marginTop: 8 }}><Link2 size={11} />{L.link}</span>
      </div>
      <Tap x={346} y={244} at={2250} />
      <div className="mgPanel mgPop" style={{ left: 22, top: 226, width: 250, padding: 11, ...d(2600) }}>
        <div className="mgSeg2"><span className="mgSegOn">{L.linkVar}</span><span>{L.linkAcc}</span></div>
        <span className="mgVarRow mgVarRowPick" style={{ "--pick": "3300ms" }}><span>{L.linkA}</span><b>{N(801500)}</b></span>
        <span className="mgVarRow"><span>{L.linkB}</span><b>{N(312900)}</b></span>
        <span className="mgLinkFoot mgFade" style={d(3900)}><span className="mgSrcBadge mgSrcLinked">{L.linked}</span><em>{L.backCalc}</em></span>
      </div>
      <Tap x={140} y={272} at={3250} />
    </>
  );
}

/* 10) Revisión */
function VReview({ L, lang }) {
  return (
    <>
      <div className="mgPanel mgUp" style={{ left: 120, top: 30, width: 316, height: 340, ...d(40) }}>
        <div className="mgPanelHead"><ListChecks size={13} />{L.rvTitle}</div>
        <div className="mgSeg3">{L.rvTabs.map((t, i) => <span key={t} className={i === 0 ? "mgSegOn" : ""}>{t} · {["2/4", "3/5", "5/6"][i]}</span>)}</div>
        <div className="mgRvBar"><i style={d(400)} /><i className="mgRvBar2" style={d(2600)} /></div>
        <div className="mgRvTools"><span className="mgChip mgChipDark"><Crosshair size={11} />{L.rvMode}</span><span className="mgRvOnly"><i />{L.rvOnly}</span></div>
        {L.rvItems.map((t, i) => (
          <span key={t} className={`mgRvItem mgUp ${i === 2 ? "mgRvCur" : ""}`} style={{ ...d(500 + i * 120), "--cur": "1700ms", "--next": "2700ms" }}>
            <i className={`mgRvBox ${i < 2 ? "isOn" : ""} ${i === 2 ? "mgRvTick" : ""}`} style={i === 2 ? { "--tick": "2200ms" } : undefined}><Check size={9} strokeWidth={3.4} /></i>
            <span className="mgRvNo">{i + 1}</span><span>{t}</span>
          </span>
        ))}
        <div className="mgRvVar mgUp" style={d(3200)}>
          <span><b>{L.rvVarName}</b><em>{L.rvChanged} ({nf(1440000, lang)})</em></span><b className="mgWarnV">{nf(1465000, lang)}</b>
        </div>
        <div className="mgRvVar mgRvBad mgUp" style={d(3500)}>
          <CircleAlert size={13} /><span><b>{L.rvBadName}</b><em>{L.rvBadSub}</em></span><b className="mgWarnV">{nf(12400, lang)}</b>
        </div>
      </div>
      <div className="mgCard mgUp mgRingCard" style={{ left: 18, top: 54, width: 88, height: 112, ...d(200) }}>
        <svg viewBox="0 0 36 36" className="mgRing"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="mgRingFg" style={d(600)} /></svg>
        <b>3/4</b><em>{L.rvTabs[0]}</em>
      </div>
      <Tap x={136} y={252} at={2150} />
    </>
  );
}

/* 11) Exportar y compartir */
function VShare({ L }) {
  return (
    <>
      <div className="mgCard mgUp" style={{ left: 16, top: 22, width: 428, height: 58, ...d(40) }}>
        <div className="mgExpRow">
          <span className="mgChip"><FileText size={11} />{L.export}</span>
          <span className="mgExpPill mgPop" style={{ "--c": "#2B579A", ...d(600) }}><i>W</i><b>Word</b></span>
          <span className="mgExpPill mgPop" style={{ "--c": "#CD202C", ...d(720) }}><i>P</i><b>PDF</b></span>
          <span className="mgExpPill mgPop" style={{ "--c": "#217346", ...d(840) }}><i>X</i><b>Excel</b></span>
        </div>
      </div>
      <div className="mgPanel mgUp" style={{ left: 16, top: 98, width: 428, ...d(1100) }}>
        <div className="mgPanelHead"><Share2 size={13} />{L.shareT}</div>
        <div className="mgVis">
          <span><Lock size={14} /><b>{L.priv}</b></span>
          <span><Building size={14} /><b>{L.comp}</b></span>
          <span className="mgVisPick" style={{ "--pick": "1900ms" }}><Users size={14} /><b>{L.people}</b></span>
        </div>
        {[["AS", "Ana Sousa", true, "#e8394a"], ["CR", "Carlos Ruiz", false, "#16a34a"], ["LM", "Laura Martín", true, "#3a5cd9"]].map(([ini, name, edit, c], i) => (
          <span key={ini} className="mgPerson mgUp" style={d(2200 + i * 150)}>
            <i style={{ background: c }}>{ini}</i><span>{name}</span>
            <em className={edit ? "isEdit" : ""}>{edit ? <><Pencil size={10} />{L.canEdit}</> : <><Eye size={10} />{L.canRead}</>}</em>
          </span>
        ))}
      </div>
      <Tap x={385} y={162} at={1850} />
      <span className="mgSavedFloat mgPop" style={{ left: 176, top: 356, ...d(2900) }}><Check size={11} strokeWidth={3} />{L.saved}</span>
    </>
  );
}

/* 12) Consejos: el flujo completo */
function VTips({ L }) {
  const icons = [CalendarRange, CircleAlert, Braces, ListChecks, FileText];
  return (
    <>
      <svg className="mgSvg" width={ART_W} height={ART_H} viewBox={`0 0 ${ART_W} ${ART_H}`} aria-hidden="true">
        <path d="M110 70 C 200 70, 300 80, 295 118 S 270 170, 264 204 S 160 240, 157 284 S 300 330, 341 326" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeDasharray="5 7" className="mgDash" />
      </svg>
      {L.tipsT.map((t, i) => {
        const pos = [[40, 48], [210, 96], [196, 182], [82, 262], [266, 304]][i];
        const Ico = icons[i];
        return (
          <span key={t} className="mgTipStep mgPop" style={{ left: pos[0], top: pos[1], ...d(300 + i * 380) }}>
            <i>{i + 1}</i><Ico size={14} strokeWidth={2.4} /><b>{t}</b>
          </span>
        );
      })}
      <span className="mgSavedFloat mgPop" style={{ left: 300, top: 362, ...d(2300) }}><CircleCheck size={12} strokeWidth={2.6} />{L.ready}</span>
    </>
  );
}

const PAGES = [
  { id: "intro", Vignette: VIntro, blob: [0, -10], Icon: BookOpen },
  { id: "create", Vignette: VCreate, blob: [-14, -6], Icon: Sparkles },
  { id: "workspace", Vignette: VWorkspace, blob: [10, 6], Icon: LayoutGrid },
  { id: "period", Vignette: VPeriod, blob: [-8, 10], Icon: CalendarRange },
  { id: "text", Vignette: VText, blob: [12, -8], Icon: AlignLeft },
  { id: "tables", Vignette: VTables, blob: [-12, 6], Icon: Table2 },
  { id: "custom", Vignette: VCustom, blob: [8, -12], Icon: Columns3 },
  { id: "movement", Vignette: VMovement, blob: [-6, 12], Icon: Scale },
  { id: "source", Vignette: VSource, blob: [14, 4], Icon: Link2 },
  { id: "review", Vignette: VReview, blob: [-10, -10], Icon: ListChecks },
  { id: "share", Vignette: VShare, blob: [6, 10], Icon: Share2 },
  { id: "tips", Vignette: VTips, blob: [0, 0], Icon: CircleCheck },
];

/* ── Botón para abrir la guía (lista de memorias y barra de una memoria) ──
   Sin className se pinta como una pastilla propia; con className (p. ej. el
   botón de icono de la barra) toma ese estilo y muestra el texto como tooltip. */
export function GuideButton({ locale, className, label = true }) {
  const [open, setOpen] = useState(false);
  const settings = useSettings();
  const lc = locale ?? settings?.locale;
  const L = TEXT[pickLang(lc)];
  return (
    <>
      {!className && <style>{GUIDE_BTN_CSS}</style>}
      <button type="button" className={className ?? `mgGuideBtn ${label ? "" : "isIcon"}`} onClick={() => setOpen(true)} aria-haspopup="dialog"
        aria-label={L.buttonHint} data-tip={className && !label ? L.buttonHint : undefined} title={className ? undefined : L.buttonHint}>
        <BookOpen size={label ? 15 : 17} strokeWidth={label ? 2.3 : 2} />
        {label && <span>{L.button}</span>}
      </button>
      {open && <MemoryGuide locale={lc} onClose={() => setOpen(false)} />}
    </>
  );
}
const GUIDE_BTN_CSS = `
.mgGuideBtn { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 13px; border: 0; border-radius: 12px; cursor: pointer; white-space: nowrap;
  font: inherit; font-size: 12px; font-weight: 800; color: var(--k-primary, #1a2f8a); background: color-mix(in srgb, var(--k-primary, #1a2f8a) 7%, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--k-primary, #1a2f8a) 14%, transparent); transition: background 180ms ease, transform 150ms ease; }
.mgGuideBtn.isIcon { width: 32px; padding: 0; justify-content: center; }
.mgGuideBtn:hover { transform: scale(1.04); background: color-mix(in srgb, var(--k-primary, #1a2f8a) 12%, #fff); }
.mgGuideBtn:focus-visible { outline: 2px solid color-mix(in srgb, var(--k-primary, #1a2f8a) 45%, transparent); outline-offset: 2px; }
`;

const MG_CSS = `
.mgRoot { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 24px; font-family: inherit; line-height: 1.4; color: #0a1647; text-align: left; }
/* Reinicio local: la ventana se ve igual con o sin los estilos base de la app (Tailwind, etc.) */
.mgRoot *, .mgRoot *::before, .mgRoot *::after { box-sizing: border-box; }
.mgRoot :where(h2, h3, p, ol, ul, li) { margin: 0; padding: 0; }
.mgRoot :where(ol, ul) { list-style: none; }
.mgRoot :where(svg) { display: block; flex: none; }
.mgRoot :where(button) { line-height: inherit; }
.mgBackdrop { position: absolute; inset: 0; background: rgba(10,22,71,0.5); backdrop-filter: blur(14px) saturate(130%); -webkit-backdrop-filter: blur(14px) saturate(130%);
  animation: mgFadeIn 380ms ease both; }
.mgRoot.isClosing .mgBackdrop { animation: mgFadeOut 260ms ease both; }

.mgDialog { position: relative; display: flex; flex-direction: column; width: min(1180px, 100%); height: min(700px, calc(100vh - 48px)); height: min(700px, calc(100dvh - 48px)); border-radius: 34px; padding: 10px; outline: none;
  background: rgba(255,255,255,0.95); border: 1px solid #fff;
  backdrop-filter: blur(28px) saturate(150%); -webkit-backdrop-filter: blur(28px) saturate(150%);
  box-shadow: 0 50px 120px -30px rgba(5,12,50,0.65), 0 16px 40px -14px rgba(5,12,50,0.35);
  animation: mgDialogIn 640ms cubic-bezier(0.22,1,0.36,1) both; }
.mgRoot.isClosing .mgDialog { animation: mgDialogOut 260ms cubic-bezier(0.4,0,1,1) both; }
.mgBody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; touch-action: pan-y; }

/* Escenario: el mismo cielo azul del login */
.mgStage { position: relative; overflow: hidden; border-radius: 26px; isolation: isolate;
  background: linear-gradient(160deg, #1a2f8a 0%, #2c47b8 42%, #3a5cd9 70%, #7a9fef 100%); }
.mgStage::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0.5;
  background-image: radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1.2px); background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 85%); mask-image: radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 85%); }
.mgStage::after { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0.05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.mgBlob { position: absolute; z-index: 0; left: 50%; top: 45%; width: 460px; height: 460px; margin: -230px 0 0 -230px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,0.34), rgba(168,197,255,0.12) 45%, transparent 68%); filter: blur(30px);
  transition: transform 900ms cubic-bezier(0.22,1,0.36,1); }
.mgStageStack { position: absolute; inset: 0; z-index: 1; display: grid; }
.mgArtLayer { grid-area: 1 / 1; position: relative; }
.mgArt { position: absolute; left: 50%; top: 50%; width: ${ART_W}px; height: ${ART_H}px; margin: -${ART_H / 2}px 0 0 -${ART_W / 2}px; transform: scale(var(--s, 1)); }

/* Columna de texto */
.mgCopy { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 54px 44px 24px 38px; container-type: inline-size; }
.mgCopyStack { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.mgCopyStack::-webkit-scrollbar { display: none; }
.mgText { zoom: var(--fit, 1); }
.mgText { grid-area: 1 / 1; align-self: start; }
.mgMeta { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; }
.mgNum { font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: rgba(26,47,138,0.4); letter-spacing: 0.06em; }
.mgEyebrow { font-size: 10px; font-weight: 900; letter-spacing: 0.22em; text-transform: uppercase; color: #e8394a; }
.mgTag { padding: 3px 8px; border-radius: 999px; font-size: 9px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #1a2f8a; background: rgba(26,47,138,0.08); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgTag.isNew { color: #fff; background: #e8394a; box-shadow: 0 6px 14px -6px rgba(232,57,74,0.8); }
.mgTitle { margin: 0 0 14px; font-size: clamp(26px, 2.6vw, 37px); line-height: 1.06; font-weight: 900; letter-spacing: -0.03em; color: #0a1647; }
.mgDesc { margin: 0 0 24px; font-size: 15px; line-height: 1.55; font-weight: 500; color: rgba(26,47,138,0.66); max-width: 34rem; }
.mgList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
.mgList li { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 1.45; font-weight: 600; color: rgba(10,22,71,0.84); }
.mgList .mgTickL { flex: none; width: 20px; height: 20px; margin-top: -1px; border-radius: 7px; display: grid; place-items: center; color: #1a2f8a; background: rgba(26,47,138,0.08); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }

/* Pie: puntos de progreso y navegación */
.mgFoot { flex: none; display: flex; align-items: center; gap: 12px; min-width: 0; padding-top: 18px; margin-top: 12px; border-top: 1px solid rgba(26,47,138,0.08); }
.mgDots { display: flex; align-items: center; gap: 2px; min-width: 0; }
.mgDot { position: relative; width: 14px; height: 26px; border: 0; padding: 0; background: transparent; cursor: pointer; border-radius: 8px; }
.mgDot::before { content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 999px; background: rgba(26,47,138,0.2);
  transition: width 420ms cubic-bezier(0.22,1,0.36,1), margin 420ms cubic-bezier(0.22,1,0.36,1), background 300ms ease; }
.mgDot:hover::before { background: rgba(26,47,138,0.45); }
.mgDot.isOn { width: 28px; }
.mgDot.isOn::before { width: 20px; margin-left: -10px; background: #e8394a; }
.mgDot.isDone::before { background: rgba(26,47,138,0.5); }
.mgDot:focus-visible { outline: 2px solid rgba(26,47,138,0.45); outline-offset: 1px; }
.mgCounter { white-space: nowrap; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: rgba(26,47,138,0.45); font-variant-numeric: tabular-nums; }
.mgNav { flex: none; margin-left: auto; display: flex; align-items: center; gap: 8px; }
.mgPrev { width: 46px; height: 46px; border-radius: 16px; border: 0; display: grid; place-items: center; cursor: pointer; color: #1a2f8a; background: rgba(26,47,138,0.07);
  box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); transition: background 200ms ease, transform 300ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease; }
.mgPrev:hover { background: rgba(26,47,138,0.13); transform: translateX(-2px); }
.mgPrev[aria-disabled="true"] { opacity: 0.35; cursor: default; transform: none; background: rgba(26,47,138,0.07); }
.mgNext { position: relative; overflow: hidden; height: 46px; padding: 0 20px 0 22px; border: 0; border-radius: 16px; cursor: pointer; color: #fff; font: inherit; font-size: 13.5px; font-weight: 900; letter-spacing: 0.02em;
  display: inline-flex; align-items: center; gap: 8px; min-width: 124px; justify-content: center; white-space: nowrap;
  background: #e8394a; box-shadow: 0 14px 30px -12px rgba(232,57,74,0.7), inset 0 1px 0 rgba(255,255,255,0.2);
  transition: transform 280ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 250ms ease, background 250ms ease; }
.mgNext:hover { transform: translateY(-1px); box-shadow: 0 18px 36px -12px rgba(232,57,74,0.8), inset 0 1px 0 rgba(255,255,255,0.25); }
.mgNext:active { transform: scale(0.98); }
.mgNext.isLast { background: linear-gradient(90deg, #e8394a 0%, #e8394a 40%, #ff5563 50%, #e8394a 60%, #e8394a 100%); background-size: 200% 100%; animation: mgShimmer 3s linear infinite; }
.mgNext svg { transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1); }
.mgNext:hover svg { transform: translateX(3px); }
.mgPrev:focus-visible, .mgNext:focus-visible, .mgClose:focus-visible { outline: 3px solid rgba(26,47,138,0.4); outline-offset: 3px; }
.mgClose { position: absolute; top: 18px; right: 18px; z-index: 5; width: 38px; height: 38px; border-radius: 13px; border: 0; display: grid; place-items: center; cursor: pointer;
  color: #1a2f8a; background: rgba(255,255,255,0.85); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.12), 0 8px 20px -10px rgba(5,12,50,0.4);
  transition: background 200ms ease, transform 300ms cubic-bezier(0.34,1.56,0.64,1); }
.mgClose:hover { background: #fff; transform: rotate(90deg); }
.mgSr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Transición entre páginas (sensible a la dirección: --dir = 1 | -1) */
.mgArtLayer.isEnter { animation: mgArtIn 640ms cubic-bezier(0.22,1,0.36,1) 110ms both; }
.mgArtLayer.isLeave, .mgText.isLeave { pointer-events: none; animation: mgLeave 260ms cubic-bezier(0.4,0,1,1) both; }
.mgText.isLeave { animation-duration: 190ms; }
.mgText.isEnter > :not(ul), .mgText.isEnter li { animation: mgTextIn 620ms cubic-bezier(0.22,1,0.36,1) calc(170ms + var(--k, 0) * 55ms) both; }

/* ── Piezas de las viñetas ───────────────────────────────────────── */
.mgArt { --navy: #1a2f8a; --ink: #0a1647; --red: #e8394a; --sky: #7a9fef; --ok: #16a34a; font-size: 11px; line-height: 1.22; }
.mgArt > * { position: absolute; }
.mgSvg { left: 0; top: 0; overflow: visible; pointer-events: none; }
.mgUp { animation: mgUp 640ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.mgPop { animation: mgPop 560ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--d, 0) * 1ms) both; }
.mgFade { animation: mgFadeIn 600ms ease calc(var(--d, 0) * 1ms) both; }
.mgDraw { stroke-dasharray: 1; animation: mgDraw 900ms cubic-bezier(0.65,0,0.35,1) calc(var(--d, 0) * 1ms) both; }
.mgSlideIn { animation: mgSlideIn 760ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }

.mgCard { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 60px -26px rgba(5,12,50,0.7), 0 0 0 1px rgba(255,255,255,0.7); }
.mgPanel { background: rgba(255,255,255,0.96); border-radius: 16px; padding: 14px; box-shadow: 0 30px 60px -20px rgba(5,12,50,0.75), 0 0 0 1px rgba(255,255,255,0.8); }
.mgCardHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 40px; padding: 0 14px; border-bottom: 1px solid rgba(26,47,138,0.07); }
.mgCardHead b, .mgPanelHead { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 900; color: var(--ink); letter-spacing: -0.01em; white-space: nowrap; }
.mgCardHead b svg, .mgPanelHead svg { color: var(--red); }
.mgPill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 800; color: var(--navy); background: rgba(26,47,138,0.07); white-space: nowrap; }
.mgPillOk { color: #0f7a36; background: rgba(22,163,74,0.12); box-shadow: inset 0 0 0 1px rgba(22,163,74,0.2); }
.mgMicro { margin: 0; font-size: 9px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(26,47,138,0.5); white-space: nowrap; }
.mgEyeSm { margin: 0 0 10px; font-size: 9px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; color: var(--red); }
.mgTick { flex: none; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--ok); box-shadow: 0 4px 10px -4px rgba(22,163,74,0.8); }
.mgChip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 8px; font-size: 10px; font-weight: 800; color: var(--navy); background: #f2f5fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); white-space: nowrap; }
.mgChipDark { color: #fff; background: var(--navy); box-shadow: none; }
.mgFloat { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 10px; font-size: 10.5px; font-weight: 800; color: #fff; white-space: nowrap;
  background: rgba(10,22,71,0.5); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.mgFloat svg { color: #a8c5ff; }


/* ── Piezas propias de la guía de memorias ───────────────────────── */
.mgArt b, .mgArt em, .mgArt i { font-style: normal; }
.mgArt em { font-weight: 600; }
.mgCode { display: inline-block; margin-right: 6px; padding: 1px 4px; border-radius: 4px; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 8px; font-weight: 800; color: rgba(26,47,138,0.6); background: rgba(26,47,138,0.07); }
.mgCaret { display: inline-block; width: 0; height: 0; margin-left: auto; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid rgba(26,47,138,0.5); }
.mgBtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 10px; font-size: 11px; font-weight: 900; color: #fff; background: var(--red); box-shadow: 0 10px 22px -10px rgba(232,57,74,0.9); white-space: nowrap; }
.mgBtnSm { width: 100%; height: 26px; margin-top: 4px; font-size: 10px; border-radius: 8px; background: rgba(26,47,138,0.08); color: var(--navy); box-shadow: none; }
.mgBtnGhost { width: 100%; height: 28px; font-size: 10px; color: var(--navy); background: rgba(26,47,138,0.07); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgNumB { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; z-index: 6; font-size: 11px; font-weight: 900; color: #fff; background: var(--red); box-shadow: 0 0 0 3px rgba(255,255,255,0.9), 0 8px 18px -6px rgba(232,57,74,0.9); }
.mgFloat.mgLegend { gap: 8px; }
.mgLegend i { width: 9px; height: 9px; border-radius: 3px; }
.mgDotInf { background: #f59e0b; } .mgDotHand { background: #3a5cd9; } .mgDotCalc { background: #8b5cf6; }

/* Interacciones simuladas */
.mgTap { z-index: 20; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; pointer-events: none; opacity: 0;
  background: rgba(232,57,74,0.28); box-shadow: 0 0 0 2px rgba(255,255,255,0.95), 0 0 0 5px rgba(232,57,74,0.45);
  animation: mgTap 720ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.mgPressed { animation: mgPress 620ms cubic-bezier(0.34,1.56,0.64,1) var(--press, 0ms) both; }
.mgHi { animation: mgHiRing 1500ms ease var(--hi, 0ms) both; }
.mgPickOn { animation: mgPickFill 380ms ease var(--pick, 0ms) both; }
.mgOptPick, .mgLibPick, .mgVisPick { animation: mgSelOn 420ms ease var(--pick, 0ms) forwards; }
.mgArt .mgLibCard.mgLibPick { animation: mgUp 640ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both, mgSelOn 420ms ease var(--pick, 0ms) forwards; }
.mgVarRowPick, .mgCellPick { animation: mgLinkHi 380ms ease var(--pick, 0ms) forwards; }
.mgSwap { display: inline-grid; vertical-align: bottom; }
.mgSwap > i { grid-area: 1 / 1; justify-self: end; font-style: normal; }
.mgSwapOld { animation: mgSwapOut 320ms ease calc(var(--d, 0) * 1ms) both; }
.mgSwapNew { animation: mgSwapNew 900ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms + 120ms) both; border-radius: 4px; }

/* 1 · Portada */
.mgDocHead { display: flex; align-items: center; justify-content: space-between; height: 42px; padding: 0 14px; border-bottom: 1px solid rgba(26,47,138,0.07); }
.mgDocHead b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 900; color: var(--ink); }
.mgDocHead b svg { color: var(--red); }
.mgDocKicker { margin: 14px 16px 8px; font-size: 8.5px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: var(--red); }
.mgSheet .mgDocKicker { margin: 0 0 8px; }
.mgLines { display: flex; flex-direction: column; gap: 6px; margin: 0 16px; }
.mgSheet .mgLines { margin: 0; }
.mgLine { display: block; height: 6px; border-radius: 3px; background: rgba(26,47,138,0.09); transform-origin: left; animation: mgGrowX 700ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.mgMiniRow .mgLine { display: inline-block; }
.mgDocTxt { margin: 12px 16px 0; font-size: 11px; line-height: 1.7; font-weight: 600; color: rgba(10,22,71,0.8); }
.mgVarPill { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 6px; font-weight: 900; color: var(--navy); background: rgba(58,92,217,0.12); box-shadow: inset 0 0 0 1px rgba(58,92,217,0.25); white-space: nowrap; }
.mgVarSoft { color: #6d28d9; background: rgba(139,92,246,0.1); box-shadow: inset 0 0 0 1px rgba(139,92,246,0.22); }
.mgMiniTable { margin: 14px 16px 0; border-radius: 10px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.08); }
.mgSheet .mgMiniTable { margin-left: 0; margin-right: 0; }
.mgMiniRow { display: flex; align-items: center; justify-content: space-between; height: 26px; padding: 0 10px; font-size: 10px; font-weight: 600; color: rgba(10,22,71,0.78); border-top: 1px solid rgba(26,47,138,0.06); }
.mgMiniRow:first-child { border-top: 0; }
.mgMiniRow b { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ink); }
.mgMiniTot { background: #f4f6fd; font-weight: 900; }

/* 2 · Asistente */
.mgSteps { display: flex; gap: 6px; padding: 12px 14px 4px; }
.mgStep { flex: 1; display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 9px; font-size: 9.5px; font-weight: 800; color: rgba(26,47,138,0.45); background: rgba(26,47,138,0.04);
  animation: mgStepOn 380ms ease var(--on, 0ms) both; }
.mgStep i { width: 16px; height: 16px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 9px; font-weight: 900; color: rgba(26,47,138,0.5); background: #fff; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.15);
  animation: mgStepDot 380ms ease var(--on, 0ms) both; }
.mgWzBody { display: flex; flex-direction: column; gap: 9px; padding: 10px 14px; }
.mgWzRow { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.mgOpt { display: grid; grid-template-columns: auto 1fr; column-gap: 9px; align-items: center; padding: 10px 11px; border-radius: 12px; background: #f7f8fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgOpt svg { grid-row: span 2; color: var(--navy); }
.mgOpt b { font-size: 11px; font-weight: 900; color: var(--ink); }
.mgOpt em { font-size: 9.5px; color: rgba(26,47,138,0.55); }
.mgWzField { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: 10px; font-size: 11px; font-weight: 700; color: var(--ink); background: #f7f8fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgWzField svg { color: var(--red); }

/* 3 · Espacio de trabajo */
.mgBar { display: flex; align-items: center; gap: 6px; height: 46px; padding: 0 10px; border-bottom: 1px solid rgba(26,47,138,0.08); }
.mgBarName { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
.mgBarName b { font-size: 11.5px; font-weight: 900; color: var(--ink); white-space: nowrap; }
.mgBarName em { font-size: 9px; color: rgba(26,47,138,0.55); white-space: nowrap; }
.mgSaved { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 800; color: #0f7a36; white-space: nowrap; animation: mgSavedFlash 2600ms ease calc(var(--d, 0) * 1ms) both; }
.mgIco { position: relative; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: var(--navy); background: #f2f5fd; }
.mgIcoOn { color: #fff; background: var(--navy); box-shadow: 0 0 0 3px rgba(232,57,74,0.25); }
.mgBadge { position: absolute; top: -4px; right: -4px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px; display: grid; place-items: center; font-size: 8px; font-weight: 900; color: #fff; background: var(--red); box-shadow: 0 0 0 2px #fff; }
.mgWs { display: grid; grid-template-columns: 158px 1fr; height: calc(100% - 46px); }
.mgIdx2 { display: flex; flex-direction: column; gap: 3px; padding: 8px; background: #f8f9fe; border-right: 1px solid rgba(26,47,138,0.07); }
.mgIdxSearch { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; margin-bottom: 4px; border-radius: 7px; font-size: 9px; font-weight: 600; color: rgba(26,47,138,0.45); background: #fff; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgIdxRow { display: flex; align-items: center; gap: 7px; padding: 5px 6px; border-radius: 8px; }
.mgIdxRow.isSel { background: #fff; box-shadow: 0 6px 14px -10px rgba(5,12,50,0.6), inset 0 0 0 1px rgba(26,47,138,0.12); }
.mgIdxRow > span { display: flex; flex-direction: column; min-width: 0; }
.mgIdxRow b { font-size: 9.5px; font-weight: 800; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgIdxRow em { font-size: 8px; color: rgba(26,47,138,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgSt { width: 17px; height: 17px; flex: none; border-radius: 6px; display: grid; place-items: center; font-size: 8.5px; font-weight: 900; }
.mgSt_ok { color: #fff; background: var(--ok); }
.mgSt_text { color: rgba(26,47,138,0.55); background: rgba(26,47,138,0.08); }
.mgSt_warn { color: #fff; background: #f59e0b; }
.mgSt_data { color: #fff; background: var(--navy); }
.mgSt_empty { color: rgba(26,47,138,0.5); background: #fff; box-shadow: inset 0 0 0 1.5px rgba(26,47,138,0.2); }
.mgIdxAdd { display: flex; align-items: center; gap: 6px; margin-top: auto; padding: 6px; border-radius: 8px; font-size: 9px; font-weight: 800; color: var(--red); box-shadow: inset 0 0 0 1px rgba(232,57,74,0.25); }
.mgSheet { padding: 16px 18px; }

/* 4 · Periodo */
.mgYears { display: flex; gap: 6px; }
.mgYears span, .mgMonths span { flex: 1; display: grid; place-items: center; height: 26px; border-radius: 8px; font-size: 10px; font-weight: 800; color: var(--navy); background: #f2f5fd; }
.mgMonths { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
.mgMonths span { height: 24px; font-size: 9.5px; }
.mgCalc { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 800; color: #b45309; animation: mgCalcFlash 1100ms ease calc(var(--d, 0) * 1ms) both; }
.mgCalc::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; }
.mgTRow, .mgTRow2 { display: flex; align-items: center; justify-content: space-between; height: 30px; padding: 0 14px; font-size: 10.5px; font-weight: 600; color: rgba(10,22,71,0.8); border-top: 1px solid rgba(26,47,138,0.06); }
.mgTRow > :last-child, .mgTRow2 b { font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.mgTTot { font-weight: 900; background: #f4f6fd; }
.mgTTot > span:first-child { font-weight: 900; color: var(--ink); }

/* 5 · Texto */
.mgFmt { display: flex; gap: 4px; padding: 8px 14px 0; }
.mgFmt > * { width: 22px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 10px; font-weight: 900; color: var(--navy); background: #f2f5fd; }
.mgFmt i { font-style: italic; font-family: Georgia, serif; }
.mgTyped { margin: 10px 14px 0; font-size: 11.5px; line-height: 1.75; font-weight: 600; color: rgba(10,22,71,0.82); }
.mgType { display: inline-block; vertical-align: bottom; overflow: hidden; white-space: nowrap; max-width: var(--w); border-right: 2px solid var(--red);
  animation: mgType 1900ms steps(42, end) calc(var(--d, 0) * 1ms) both, mgCaretOff 1ms linear calc(var(--d, 0) * 1ms + 2300ms) forwards; }
.mgSearchBox { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; margin-bottom: 6px; border-radius: 8px; font-size: 9.5px; font-weight: 600; color: rgba(26,47,138,0.45); background: #f4f6fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgVarRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 8px; font-size: 9.5px; font-weight: 700; color: rgba(10,22,71,0.8); }
.mgVarRow span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mgVarRow b { font-weight: 900; color: var(--navy); white-space: nowrap; font-variant-numeric: tabular-nums; }
.mgTipCard { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; }
.mgBigN { font-size: 20px; font-weight: 900; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
.mgSrcBadge { display: inline-flex; padding: 2px 7px; border-radius: 6px; font-size: 9px; font-weight: 900; color: #0f7a36; background: rgba(22,163,74,0.12); }
.mgSrcLinked { color: #3a5cd9; background: rgba(58,92,217,0.12); }
.mgSrcF { font-size: 9.5px; color: rgba(26,47,138,0.6); }

/* 6 y 7 · Tablas */
.mgTHead, .mgTRow3 { display: grid; grid-template-columns: 1.5fr 1fr 1fr; align-items: center; gap: 8px; padding: 0 14px; }
.mgTHead { height: 30px; font-size: 8.5px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,47,138,0.5); background: #f8f9fe; }
.mgTHead > :not(:first-child) { text-align: right; }
.mgTHead2 { grid-template-columns: 1.5fr 1fr; }
.mgTHead4 { font-size: 7.5px; letter-spacing: 0.06em; line-height: 1.15; height: 34px; }
.mgTHead4 > :not(:first-child) { text-align: right; }
.mgTRow3 { height: 36px; font-size: 10.5px; font-weight: 600; color: rgba(10,22,71,0.8); border-top: 1px solid rgba(26,47,138,0.06); }
.mgTRow3 > :not(:first-child) { justify-self: end; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.mgTRow3 > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgArt .mgTRow3.mgRowHide { animation: mgUp 640ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both, mgRowOff 500ms ease var(--hide, 0ms) forwards; }
.mgTRow3.mgTTot { font-weight: 900; }
.mgLib { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 10px; }
.mgLibCard { display: grid; grid-template-columns: auto 1fr; column-gap: 7px; align-items: center; padding: 9px; border-radius: 11px; background: #f7f8fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgLibCard svg { grid-row: span 2; color: var(--navy); }
.mgLibCard b { font-size: 10px; font-weight: 900; color: var(--ink); white-space: nowrap; }
.mgLibCard em { font-size: 8.5px; color: rgba(26,47,138,0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgTHead4, .mgTRow4 { display: grid; grid-template-columns: 1.3fr 1fr 1fr 0.9fr; align-items: center; gap: 6px; padding: 0 12px; }
.mgTRow4 { height: 30px; font-size: 10px; font-weight: 600; color: rgba(10,22,71,0.8); border-top: 1px solid rgba(26,47,138,0.06); }
.mgTRow4 > b { justify-self: end; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.mgTRow4 > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgColNew { animation: mgColIn 520ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.mgTHead .mgColNew { color: var(--red); }
.mgTRow4 > b.mgPos { color: #0f7a36; }
.mgAddRow { grid-template-columns: 1fr 1fr; gap: 6px; height: 36px; }
.mgAddRow span { display: flex; align-items: center; justify-content: center; gap: 5px; height: 24px; border-radius: 7px; font-size: 9px; font-weight: 800; color: var(--navy); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.18); }
.mgField { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; font-size: 8.5px; font-weight: 800; color: rgba(26,47,138,0.55); }
.mgField > i { display: flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 7px; font-size: 10px; font-weight: 800; color: var(--ink); background: #f4f6fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }

/* 8 · Movimientos */
.mgMHead, .mgMRow { display: grid; grid-template-columns: 1.35fr repeat(5, 1fr); align-items: center; gap: 4px; padding: 0 12px; }
.mgMHead { height: 28px; font-size: 7.5px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(26,47,138,0.5); background: #f8f9fe; }
.mgMHead > span { text-align: right; } .mgMHead > span:first-child { text-align: left; }
.mgMLayer { padding: 7px 12px 3px; font-size: 8px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--red); }
.mgMRow { height: 32px; font-size: 9.5px; font-weight: 600; color: rgba(10,22,71,0.8); border-top: 1px solid rgba(26,47,138,0.06); }
.mgMRow > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgMRow > b { justify-self: end; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mgMNet { background: #f4f6fd; font-weight: 900; }
.mgMNet > span:first-child { font-weight: 900; color: var(--ink); }
.mgInf { color: #b45309; padding: 1px 3px; border-radius: 4px; background: rgba(245,158,11,0.14); }
.mgHand { color: #3a5cd9; padding: 1px 3px; border-radius: 4px; background: rgba(58,92,217,0.12); }
.mgCalcV { color: #6d28d9; padding: 1px 3px; border-radius: 4px; background: rgba(139,92,246,0.12); }
.mgOkC { color: #0f7a36 !important; }
.mgCheckLine { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 10px; font-weight: 800; color: var(--ink); }
.mgCheckLine span { padding: 3px 6px; border-radius: 6px; background: #f4f6fd; white-space: nowrap; }
.mgCheckLine .mgTick { margin-left: auto; }

/* 9 · Origen y vínculos */
.mgTRow2.mgCellPick { position: relative; }
.mgSrcTitle { display: block; margin: 6px 0 2px; font-size: 10px; font-weight: 800; color: rgba(10,22,71,0.75); }
.mgSlideIn.mgPanel, .mgArt .mgPanel { display: flex; flex-direction: column; }
.mgArt .mgPanel > .mgSrcBadge, .mgArt .mgPanel > .mgBigN { align-self: flex-start; }
.mgSrcF { margin: 4px 0 6px; }
.mgPart { display: flex; align-items: center; gap: 4px; padding: 5px 0; font-size: 9.5px; font-weight: 700; color: rgba(10,22,71,0.8); border-top: 1px solid rgba(26,47,138,0.06); }
.mgPart b { margin-left: auto; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; }
.mgSeg2, .mgSeg3 { display: flex; gap: 3px; padding: 3px; margin-bottom: 8px; border-radius: 9px; background: #f2f5fd; }
.mgSeg2 span, .mgSeg3 span { flex: 1; display: grid; place-items: center; height: 22px; border-radius: 7px; font-size: 9.5px; font-weight: 800; color: rgba(26,47,138,0.6); white-space: nowrap; }
.mgSegOn { color: var(--ink) !important; background: #fff; box-shadow: 0 2px 6px -2px rgba(5,12,50,0.3); }
.mgLinkFoot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.mgLinkFoot em { font-size: 9.5px; font-weight: 800; color: rgba(26,47,138,0.55); text-decoration: underline; text-underline-offset: 2px; }
.mgLinkedV { display: inline-flex; align-items: center; gap: 3px; color: #3a5cd9; }

/* 10 · Revisión */
.mgRvBar { position: relative; height: 5px; margin: 0 0 10px; border-radius: 3px; background: rgba(26,47,138,0.08); overflow: hidden; }
.mgRvBar i { position: absolute; left: 0; top: 0; bottom: 0; width: 50%; border-radius: 3px; background: var(--ok); transform-origin: left; animation: mgGrowX 700ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }
.mgRvBar i.mgRvBar2 { left: 50%; width: 25%; border-radius: 0 3px 3px 0; }
.mgRvTools { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.mgRvOnly { display: inline-flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 800; color: rgba(26,47,138,0.6); }
.mgRvOnly i { width: 22px; height: 12px; border-radius: 6px; background: rgba(26,47,138,0.15); position: relative; }
.mgRvOnly i::after { content: ""; position: absolute; left: 2px; top: 2px; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
.mgRvItem { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 9px; font-size: 10px; font-weight: 700; color: rgba(10,22,71,0.82); }
.mgArt .mgRvItem.mgRvCur { animation: mgUp 640ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both, mgLinkHi 380ms ease var(--cur, 0ms) forwards; }
.mgRvBox { width: 15px; height: 15px; flex: none; border-radius: 5px; display: grid; place-items: center; color: transparent; box-shadow: inset 0 0 0 1.5px rgba(26,47,138,0.25); }
.mgRvBox.isOn { color: #fff; background: var(--ok); box-shadow: none; }
.mgRvTick { animation: mgTickOn 360ms cubic-bezier(0.34,1.56,0.64,1) var(--tick, 0ms) both; }
.mgRvNo { width: 16px; font-size: 9px; font-weight: 900; color: rgba(26,47,138,0.4); }
.mgRvVar { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(245,158,11,0.08); box-shadow: inset 0 0 0 1px rgba(245,158,11,0.25); }
.mgRvVar > span { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mgRvVar > span b { font-size: 10px; font-weight: 900; color: var(--ink); }
.mgRvVar > span em { font-size: 8.5px; color: #b45309; }
.mgRvBad { background: rgba(232,57,74,0.06); box-shadow: inset 0 0 0 1px rgba(232,57,74,0.22); }
.mgRvBad > svg { color: var(--red); }
.mgRvBad > span em { color: #be123c; }
.mgWarnV { font-size: 10.5px; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; }
.mgRingCard { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.mgRingCard b { font-size: 14px; font-weight: 900; color: var(--ink); }
.mgRingCard em { font-size: 8.5px; color: rgba(26,47,138,0.55); }
.mgRing { width: 46px; height: 46px; transform: rotate(-90deg); }
.mgRing circle { fill: none; stroke: rgba(26,47,138,0.1); stroke-width: 4; }
.mgRing .mgRingFg { stroke: var(--ok); stroke-linecap: round; stroke-dasharray: 94.25; animation: mgRingTo 1100ms cubic-bezier(0.22,1,0.36,1) calc(var(--d, 0) * 1ms) both; }

/* 11 · Exportar y compartir */
.mgExpRow { display: flex; align-items: center; gap: 8px; height: 100%; padding: 0 14px; }
.mgExpRow .mgChip { margin-right: auto; }
.mgExpPill { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 11px 0 5px; border-radius: 10px; font-size: 10px; font-weight: 900; color: #fff; background: var(--c); box-shadow: 0 8px 16px -8px var(--c); }
.mgExpPill b { font-weight: 800; }
.mgExpPill > i { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 10px; font-weight: 900; background: rgba(255,255,255,0.22); }
.mgVis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin: 10px 0; }
.mgVis span { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 6px; border-radius: 11px; background: #f7f8fd; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); color: var(--navy); }
.mgVis b { font-size: 10px; font-weight: 900; color: var(--ink); white-space: nowrap; }
.mgPerson { display: flex; align-items: center; gap: 9px; padding: 7px 4px; border-top: 1px solid rgba(26,47,138,0.06); font-size: 10.5px; font-weight: 700; color: var(--ink); }
.mgPerson > i { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 8.5px; font-weight: 900; color: #fff; }
.mgPerson > em { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: 9px; font-weight: 800; color: rgba(26,47,138,0.65); background: #f2f5fd; }
.mgPerson > em.isEdit { color: #fff; background: var(--navy); }
.mgSavedFloat { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; font-size: 10.5px; font-weight: 900; color: #0f7a36; background: #fff; box-shadow: 0 14px 30px -12px rgba(5,12,50,0.7); }

/* 12 · Consejos */
.mgDash { stroke-dashoffset: 0; animation: mgFlow 1.4s linear infinite; }
.mgTipStep { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px 8px 8px; border-radius: 14px; background: #fff; color: var(--navy); box-shadow: 0 20px 40px -18px rgba(5,12,50,0.75); }
.mgTipStep > i { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 10.5px; font-weight: 900; color: #fff; background: var(--red); }
.mgTipStep b { font-size: 12px; font-weight: 900; color: var(--ink); white-space: nowrap; }

@keyframes mgTap { 0% { opacity: 0; transform: scale(0.4); } 30% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.9); } }
@keyframes mgPress { 0% { transform: none; } 40% { transform: scale(0.9); } 100% { transform: none; color: #fff; background: var(--navy); box-shadow: none; } }
@keyframes mgHiRing { 0% { box-shadow: inset 0 0 0 0 rgba(232,57,74,0); } 25%, 70% { box-shadow: inset 0 0 0 2px #e8394a, 0 0 0 4px rgba(232,57,74,0.18); } 100% { box-shadow: inset 0 0 0 0 rgba(232,57,74,0); } }
@keyframes mgPickFill { to { color: #fff; background: #1a2f8a; } }
@keyframes mgSwapOut { to { opacity: 0; transform: translateY(-7px); } }
@keyframes mgSwapNew { 0% { opacity: 0; transform: translateY(7px); background: rgba(232,57,74,0); } 30% { opacity: 1; transform: none; background: rgba(232,57,74,0.14); color: #e8394a; } 100% { opacity: 1; transform: none; background: rgba(232,57,74,0); } }
@keyframes mgStepOn { to { color: #0a1647; background: rgba(232,57,74,0.08); } }
@keyframes mgStepDot { to { color: #fff; background: #e8394a; box-shadow: none; } }
@keyframes mgSavedFlash { 0% { opacity: 0; transform: translateY(4px); } 10%, 78% { opacity: 1; transform: none; } 100% { opacity: 0; } }
@keyframes mgCalcFlash { 0% { opacity: 0; } 15%, 75% { opacity: 1; } 100% { opacity: 0; } }
@keyframes mgType { from { max-width: 0; } to { max-width: var(--w); } }
@keyframes mgCaretOff { to { border-right-color: transparent; } }
@keyframes mgRowOff { to { opacity: 0.3; text-decoration: line-through; } }
@keyframes mgColIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
@keyframes mgTickOn { from { color: transparent; background: transparent; transform: scale(0.6); } to { color: #fff; background: #16a34a; box-shadow: none; transform: none; } }
@keyframes mgRingTo { from { stroke-dashoffset: 94.25; } to { stroke-dashoffset: 23.56; } }
@keyframes mgSelOn { to { background: #fff; box-shadow: 0 0 0 3px rgba(26,47,138,0.18), 0 12px 24px -14px rgba(26,47,138,0.8), inset 0 0 0 1.5px #1a2f8a; } }

.mgArt .mgMicro { display: flex; align-items: center; gap: 5px; }
/* Índice de la portada */
.mgIndexLabel { margin: 0 0 10px; font-size: 11px; font-weight: 800; color: rgba(26,47,138,0.5); }
.mgIndex { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.mgIdx { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 8px 10px 8px 8px; border: 0; border-radius: 13px; cursor: pointer; text-align: left; font: inherit;
  font-size: 13px; font-weight: 750; color: rgba(10,22,71,0.86); background: rgba(26,47,138,0.04); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.07);
  transition: background 200ms ease, transform 280ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease; }
.mgIdx:hover { background: #fff; transform: translateY(-1px); box-shadow: inset 0 0 0 1px rgba(26,47,138,0.14), 0 10px 22px -14px rgba(5,12,50,0.5); }
.mgIdx:focus-visible { outline: 2px solid rgba(26,47,138,0.45); outline-offset: 2px; }
.mgIdxIco { width: 26px; height: 26px; flex: none; border-radius: 9px; display: grid; place-items: center; color: #1a2f8a; background: #fff; box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); }
.mgIdxTxt { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mgIdx em { flex: none; font-style: normal; font-size: 8px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 5px; border-radius: 5px; color: #fff; background: #e8394a; }
.mgIdx em.isRenew { color: #1a2f8a; background: rgba(26,47,138,0.1); }
.mgText.isEnter .mgIdx { animation: mgTextIn 620ms cubic-bezier(0.22,1,0.36,1) calc(260ms + var(--k, 0) * 40ms) both; }


/* ── Responsive ──────────────────────────────────────────────────── */
/* Diálogo más estrecho que su ancho máximo: los 12 puntos y los botones no dejan sitio al contador */
/* El pie se adapta al ancho real de la columna, no al de la pantalla */
@container (max-width: 480px) { .mgCounter { display: none; } }
@container (max-width: 440px) { .mgDot { width: 12px; } .mgDot.isOn { width: 24px; } .mgDot.isOn::before { width: 16px; margin-left: -8px; } .mgNext { min-width: 0; padding: 0 16px 0 18px; } }
@media (max-width: 820px) {
  .mgRoot { padding: 16px; }
  .mgDialog { width: min(680px, 100%); height: min(940px, calc(100vh - 32px)); height: min(940px, calc(100dvh - 32px)); border-radius: 30px; }
  .mgBody { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 38%) 1fr; }
  .mgCopy { padding: 22px 22px 16px; }
  .mgClose { background: rgba(255,255,255,0.9); }
  .mgArt { top: calc(50% + 14px); }
}
@media (max-width: 560px) {
  .mgRoot { padding: 0; place-items: end stretch; }
  .mgDialog { width: 100%; height: calc(100vh - 10px); height: calc(100dvh - 10px); border-radius: 28px 28px 0 0; padding: 8px 8px 0; border-bottom: 0;
    animation-name: mgSheetIn; }
  .mgRoot.isClosing .mgDialog { animation-name: mgSheetOut; }
  .mgBody { grid-template-rows: minmax(200px, 36%) 1fr; gap: 8px; }
  .mgStage { border-radius: 22px; }
  .mgCopy { padding: 16px 12px calc(14px + env(safe-area-inset-bottom)); }
  .mgTitle { font-size: 25px; }
  .mgDesc { font-size: 14px; margin-bottom: 16px; }
  .mgList li { font-size: 13px; }
  .mgFoot { gap: 8px; padding-top: 14px; }
  /* Con 12 páginas los puntos no caben: en móvil se ve el contador */
  .mgDots { display: none; }
  .mgCounter { display: inline; }
  .mgNext { min-width: 0; padding: 0 16px 0 18px; }
  .mgIdx { padding: 6px 8px 6px 6px; font-size: 12px; }
  .mgIdx em { display: none; }
  .mgClose { top: 16px; right: 16px; width: 36px; height: 36px; }
}

@keyframes mgFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes mgFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes mgDialogIn { from { opacity: 0; transform: perspective(1200px) translateY(28px) rotateX(8deg) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes mgDialogOut { to { opacity: 0; transform: translateY(14px) scale(0.97); } }
@keyframes mgSheetIn { from { transform: translateY(100%); } to { transform: none; } }
@keyframes mgSheetOut { to { transform: translateY(100%); } }
@keyframes mgArtIn { from { opacity: 0; transform: translateX(calc(var(--dir, 1) * 56px)) scale(0.98); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes mgLeave { to { opacity: 0; transform: translateX(calc(var(--dir, 1) * -40px)) scale(0.985); } }
@keyframes mgTextIn { from { opacity: 0; transform: translateX(calc(var(--dir, 1) * 26px)); } to { opacity: 1; transform: none; } }
@keyframes mgUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes mgPop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
@keyframes mgSlideIn { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: none; } }
@keyframes mgDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes mgFlow { to { stroke-dashoffset: -24; } }
@keyframes mgHalo { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.18); opacity: 1; } }
@keyframes mgGrowX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes mgGrowY { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes mgRingPulse { 0% { box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); } 30% { box-shadow: 0 0 0 4px rgba(232,57,74,0.25), inset 0 0 0 1px #e8394a; background: #fff; color: #e8394a; }
  100% { box-shadow: inset 0 0 0 1px rgba(26,47,138,0.1); } }
@keyframes mgSwapIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes mgLinkHi { from { background: transparent; box-shadow: none; } to { background: rgba(58,92,217,0.1); box-shadow: 0 0 0 1.5px #3a5cd9; } }
@keyframes mgShimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }

/* Movimiento reducido: todo salta a su estado final y no hay bucles */
@media (prefers-reduced-motion: reduce) {
  .mgRoot, .mgRoot *, .mgRoot *::before, .mgRoot *::after {
    animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
  .mgTap { display: none; }
  .mgDash { animation: none; }
  .mgBlob { transition: none; }
}
`;


/* ════════════════════════════════════════════════════════════════
   Escaparate modal
   ════════════════════════════════════════════════════════════════ */
const LEAVE_MS = 300, CLOSE_MS = 260;
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function MemoryGuide({ onClose, locale, startAt = 0 }) {
  const lang = pickLang(locale);
  const L = TEXT[lang];
  const reduce = useReducedMotion();
  const total = PAGES.length;

  // page: página visible · prev: la que sale (se anima y desaparece) · dir: sentido
  const [nav, setNav] = useState({ page: Math.max(0, Math.min(PAGES.length - 1, startAt)), prev: null, dir: 1 });
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
      box.querySelectorAll(".mgText").forEach((el) => {
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
  const titleId = "mg-title";
  const blob = PAGES[page].blob;

  return createPortal(
    <div className={`mgRoot ${closing ? "isClosing" : ""}`} style={{ "--dir": dir }}>
      <style>{MG_CSS}</style>
      <div className="mgBackdrop" onClick={requestClose} aria-hidden="true" />
      <div ref={dialogRef} className="mgDialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="mgSr">{L.dialog}</h2>
        <p className="mgSr" aria-live="polite">{fill(L.pageOf, { n: page + 1, total, t: pageText(page).title })}</p>
        <button type="button" className="mgClose" onClick={requestClose} aria-label={L.close}><X size={17} strokeWidth={2.6} /></button>

        <div className="mgBody" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeRef.current = null; }}>
          {/* Escenario con la viñeta animada */}
          <div ref={stageRef} className="mgStage" aria-hidden="true">
            <div className="mgBlob" style={{ transform: `translate(${blob[0]}%, ${blob[1]}%)` }} />
            <div className="mgStageStack">
              {layers.map(i => {
                const { Vignette } = PAGES[i];
                const leaving = i !== page;
                return (
                  <div key={PAGES[i].id} className={`mgArtLayer ${leaving ? "isLeave" : "isEnter"}`}>
                    <div className="mgArt"><Vignette L={L.v} lang={lang} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Texto */}
          <div className="mgCopy">
            <div ref={copyRef} className="mgCopyStack">
              {layers.map(i => {
                const t = pageText(i);
                const leaving = i !== page;
                const id = PAGES[i].id;
                const tagNew = false;
                return (
                  <div key={PAGES[i].id} className={`mgText ${leaving ? "isLeave" : "isEnter"}`} inert={leaving} aria-hidden={leaving || undefined}>
                    <div className="mgMeta" style={{ "--k": 0 }}>
                      <span className="mgNum">{String(i + 1).padStart(2, "0")}</span>
                      <span className="mgEyebrow">{t.eyebrow}</span>
                      {t.tag && <span className={`mgTag ${tagNew ? "isNew" : ""}`}>{t.tag}</span>}
                    </div>
                    <h3 className="mgTitle" style={{ "--k": 1 }}>{t.title}</h3>
                    <p className="mgDesc" style={{ "--k": 2 }}>{t.desc}</p>
                    {id === "intro" ? (
                      <>
                        <p className="mgIndexLabel" style={{ "--k": 3 }}>{L.indexLabel}</p>
                        <div className="mgIndex">
                          {PAGES.slice(1).map((p, pi) => {
                            const pt = L.pages[p.id];
                            return (
                              <button key={p.id} type="button" className="mgIdx" style={{ "--k": pi }} onClick={() => go(pi + 1)}
                                tabIndex={leaving ? -1 : 0} aria-label={fill(L.goTo, { n: pi + 2, t: pt.title })}>
                                <span className="mgIdxIco" aria-hidden="true"><p.Icon size={13} strokeWidth={2.4} /></span>
                                <span className="mgIdxTxt">{pt.short}</span>
                                {null}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <ul className="mgList">
                        {t.bullets.map((b, bi) => (
                          <li key={b} style={{ "--k": 3 + bi }}>
                            <span className="mgTickL" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mgFoot">
              <div className="mgDots" role="group" aria-label={L.dialog}>
                {PAGES.map((p, i) => (
                  <button key={p.id} type="button" className={`mgDot ${i === page ? "isOn" : ""} ${i < page ? "isDone" : ""}`}
                    onClick={() => go(i)} aria-label={fill(L.goTo, { n: i + 1, t: L.pages[p.id].title })}
                    aria-current={i === page ? "step" : undefined} />
                ))}
              </div>
              <span className="mgCounter" aria-hidden="true">{String(page + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
              <div className="mgNav">
                <button type="button" className="mgPrev" aria-label={L.prev} aria-disabled={page === 0}
                  onClick={() => { if (page > 0) go(page - 1); }}>
                  <ChevronLeft size={18} strokeWidth={2.6} />
                </button>
                <button ref={nextRef} type="button" className={`mgNext ${isLast ? "isLast" : ""}`}
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