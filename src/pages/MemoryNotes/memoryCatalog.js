/* ══════════════════════════════════════════════════════════════════════
   Catálogo de notas de la memoria.

   Cada nota con tabla se liga a etiquetas del estándar (cc_tag: BS_02,
   CC_05…), que son las mismas en todos los estándares, y/o a palabras del
   nombre de la cuenta. Así la tabla se rellena sola con cualquier plan de
   cuentas. Tipos de tabla:
     · movement  → cuadro de movimientos (coste, amortización y deterioro:
                   saldo inicial, entradas, salidas, traspasos, saldo final y
                   cuadre), ejercicio actual y anterior. Ver buildMovementTable.
                   bind.pl: cuentas de resultados para contrastar la dotación;
                   bind.labels: nombres propios de las columnas.
     · breakdown → desglose: ejercicio actual y anterior.
     · manual    → filas fijas a rellenar (con variables donde se pueda).
     · text      → solo texto.
   Los textos de partida vienen de las plantillas que ya existían en
   Supabase (memory.template_notes).
   ══════════════════════════════════════════════════════════════════════ */

export const MEMORY_MODELS = [
  { id: "pgc_normal", label: "PGC · Modelo normal", description: "Plan General de Contabilidad, memoria completa (25 notas)." },
  { id: "ifrs_es", label: "NIIF-UE", description: "Normas Internacionales de Información Financiera (20 notas)." },
];

const T = (number, title, description, narrative, extra = {}) => ({ number, title, description, narrative: narrative ?? "", kind: "text", ...extra });
const MOV = (tags, names, extra = {}) => ({ kind: "movement", bind: { tags, names, ...extra } });
// Cuentas de la cuenta de resultados para contrastar el cuadro (dotación y deterioro)
const PL_PPE = { dot: { codes: ["681"], names: ["amortizacion del inmovilizado material", "depreciation of property", "depreciation of tangible"] }, det: { codes: ["691", "791"], names: ["deterioro del inmovilizado material", "reversion del deterioro del inmovilizado material"] } };
const PL_INT = { dot: { codes: ["680"], names: ["amortizacion del inmovilizado intangible", "amortisation of intangible", "amortization of intangible"] }, det: { codes: ["690", "790"], names: ["deterioro del inmovilizado intangible", "reversion del deterioro del inmovilizado intangible"] } };
const PL_INV = { dot: { codes: ["682"], names: ["amortizacion de las inversiones inmobiliarias"] }, det: { codes: ["692", "792"], names: ["deterioro de las inversiones inmobiliarias", "reversion del deterioro de las inversiones inmobiliarias"] } };
const MOV_TEXT = (n) => `El movimiento habido en este epígrafe del balance en los ejercicios {{ejercicio}} y {{ejercicio_anterior}} ha sido el siguiente (en euros). El valor neto contable al cierre asciende a {{n${n}.total.closing}}.`;
const BRK = (tags, names, statement) => ({ kind: "breakdown", bind: { tags, names, statement } });

const PGC_NORMAL = [
  T(1, "Actividad de la empresa", "Descripción de la actividad y régimen legal",
    "{{entidad}} tiene como actividad principal… Las presentes cuentas anuales se refieren al ejercicio terminado el {{fecha_cierre}}."),
  T(2, "Bases de presentación", "Imagen fiel y principios contables aplicados",
    "Las cuentas anuales se han preparado a partir de los registros contables de la sociedad, de acuerdo con la legislación mercantil vigente y las normas del Plan General de Contabilidad, para mostrar la imagen fiel del patrimonio, de la situación financiera y de los resultados del ejercicio {{ejercicio}}."),
  T(3, "Aplicación de resultados", "Propuesta de distribución del resultado del ejercicio",
    "La propuesta de aplicación del resultado del ejercicio {{ejercicio}}, que asciende a {{resultado_ejercicio}}, es la siguiente:",
    { kind: "manual", manual: {
      columns: ["Importe"],
      rows: [
        { label: "Base de reparto", heading: true },
        { label: "Pérdidas y ganancias", auto: "resultado_ejercicio" },
        { label: "Remanente" },
        { label: "Reservas voluntarias" },
        { label: "Aplicación", heading: true },
        { label: "A reserva legal" },
        { label: "A reservas voluntarias" },
        { label: "A dividendos" },
        { label: "A compensación de pérdidas de ejercicios anteriores" },
      ],
    } }),
  T(4, "Normas de registro y valoración", "Criterios contables aplicados a cada partida",
    "Los principios y normas contables aplicados en la elaboración de las cuentas anuales son los siguientes…"),
  T(5, "Inmovilizado material", "Movimientos del ejercicio en inmovilizado material",
    MOV_TEXT(5),
    MOV(["BS_02"], [], { pl: PL_PPE })),
  T(6, "Inversiones inmobiliarias", "Movimientos del ejercicio en inversiones inmobiliarias",
    MOV_TEXT(6),
    MOV([], ["inversiones inmobiliarias", "investment propert"], { statement: "BS", pl: PL_INV })),
  T(7, "Inmovilizado intangible", "Movimientos del ejercicio en inmovilizado intangible",
    MOV_TEXT(7),
    MOV(["BS_01", "BS_03"], [], { pl: PL_INT })),
  T(8, "Arrendamientos y operaciones similares", "Información sobre arrendamientos operativos y financieros",
    "El gasto por arrendamientos del ejercicio asciende a {{n8.total.cur}}.",
    BRK([], ["arrendamiento", "canon", "lease", "rent"], "PL")),
  T(9, "Instrumentos financieros - Activos", "Activos financieros por categorías",
    "El detalle de los activos financieros al cierre del ejercicio es el siguiente:",
    BRK(["BS_04", "BS_05", "BS_08", "BS_10", "BS_11", "BS_12"])),
  T(10, "Instrumentos financieros - Pasivos", "Pasivos financieros por categorías",
    "El detalle de los pasivos financieros al cierre del ejercicio es el siguiente:",
    BRK(["BS_19", "BS_20", "BS_23", "BS_24"])),
  T(11, "Existencias", "Composición de las existencias",
    "La composición de las existencias al cierre del ejercicio es la siguiente:",
    BRK(["BS_09"])),
  T(12, "Moneda extranjera", "Activos y pasivos en moneda extranjera y diferencias de cambio",
    "Las diferencias de cambio reconocidas en el resultado del ejercicio han sido las siguientes:",
    BRK([], ["diferencias de cambio", "diferencias positivas de cambio", "diferencias negativas de cambio", "exchange difference"], "PL")),
  T(13, "Situación fiscal", "Gasto por impuesto, activos y pasivos por impuesto diferido",
    "El gasto por impuesto sobre beneficios del ejercicio asciende a {{n13.total.cur}}.",
    BRK(["BS_06", "BS_21", "CC_18"])),
  T(14, "Ingresos y gastos", "Detalle de la cuenta de pérdidas y ganancias",
    "El detalle de los principales ingresos y gastos del ejercicio es el siguiente:",
    BRK(["CC_01", "CC_02", "CC_03", "CC_04", "CC_05", "CC_06", "CC_07", "CC_08", "CC_10", "CC_11"], [], "PL")),
  T(15, "Provisiones y contingencias", "Movimientos y descripción de provisiones",
    "El movimiento de las provisiones durante el ejercicio {{ejercicio}} ha sido el siguiente (en euros):",
    MOV(["BS_18"], [], { labels: { entradas: "Dotaciones", salidas: "Aplicaciones y excesos" } })),
  T(16, "Información sobre medio ambiente", "Activos, gastos e inversiones ambientales",
    "La sociedad no posee activos ni ha realizado inversiones significativas relacionadas con el medio ambiente."),
  T(17, "Subvenciones, donaciones y legados", "Movimientos de subvenciones recibidas",
    "El movimiento de las subvenciones, donaciones y legados recibidos ha sido el siguiente (en euros):",
    MOV([], ["subvencion", "donacion", "legado", "grant"], { statement: "BS", labels: { entradas: "Aumentos", salidas: "Imputación a resultados y otras disminuciones" } })),
  T(18, "Combinaciones de negocios", "Información sobre combinaciones realizadas",
    "No se han producido combinaciones de negocios durante el ejercicio."),
  T(19, "Negocios conjuntos", "Participación en negocios conjuntos",
    "La sociedad no participa en negocios conjuntos."),
  T(20, "Activos no corrientes mantenidos para la venta", "Activos clasificados como mantenidos para la venta",
    "El detalle de los activos no corrientes mantenidos para la venta es el siguiente:",
    BRK([], ["mantenidos para la venta", "held for sale"])),
  T(21, "Hechos posteriores al cierre", "Eventos relevantes posteriores al cierre del ejercicio",
    "No se han producido hechos posteriores al cierre del ejercicio que afecten significativamente a las cuentas anuales."),
  T(22, "Operaciones con partes vinculadas", "Saldos y operaciones con partes vinculadas",
    "Los saldos y operaciones con empresas del grupo, asociadas y otras partes vinculadas son los siguientes:",
    BRK(["BS_04", "BS_12", "BS_20"], ["empresas del grupo", "empresas asociadas", "partes vinculadas", "related part"])),
  T(23, "Otra información", "Personal, gastos de personal y honorarios del auditor",
    "Los gastos de personal del ejercicio ascienden a {{n23.total.cur}}.",
    BRK(["CC_05"], [], "PL")),
  T(24, "Información segmentada", "Distribución del importe neto de la cifra de negocios",
    "La distribución del importe neto de la cifra de negocios es la siguiente:",
    BRK(["CC_01"], [], "PL")),
  T(25, "Estado de flujos de efectivo", "Efectivo y otros activos líquidos equivalentes",
    "El efectivo y otros activos líquidos equivalentes al cierre ascienden a {{n25.total.cur}}.",
    BRK(["BS_07"])),
];

const IFRS = [
  T(1, "Información corporativa", "Identificación de la entidad y actividad", "{{entidad}} fue constituida… Las presentes cuentas se refieren al ejercicio terminado el {{fecha_cierre}}."),
  T(2, "Bases de preparación", "Marco contable aplicable y declaración de cumplimiento NIIF-UE", "Las cuentas anuales han sido preparadas conforme a las NIIF adoptadas por la Unión Europea…"),
  T(3, "Resumen de políticas contables significativas", "Políticas relevantes", "Las principales políticas contables aplicadas son las siguientes…"),
  T(4, "Estimaciones y juicios significativos", "Áreas con incertidumbre material", "La preparación requiere juicios y estimaciones que afectan…"),
  T(5, "Información por segmentos", "NIIF 8", "La distribución de los ingresos ordinarios es la siguiente:", BRK(["CC_01"], [], "PL")),
  T(6, "Combinaciones de negocios", "NIIF 3", "No se han realizado combinaciones de negocios."),
  T(7, "Inmovilizado material (PP&E)", "NIC 16", MOV_TEXT(7), MOV(["BS_02"], [], { pl: PL_PPE })),
  T(8, "Activos intangibles", "NIC 38", MOV_TEXT(8), MOV(["BS_01", "BS_03"], [], { pl: PL_INT })),
  T(9, "Inversiones inmobiliarias", "NIC 40", MOV_TEXT(9), MOV([], ["inversiones inmobiliarias", "investment propert"], { statement: "BS", pl: PL_INV })),
  T(10, "Arrendamientos", "NIIF 16", "Los importes reconocidos por arrendamientos son los siguientes:", BRK([], ["arrendamiento", "derecho de uso", "lease", "right of use"])),
  T(11, "Instrumentos financieros", "NIIF 9 / NIIF 7", "El detalle de los instrumentos financieros es el siguiente:", BRK(["BS_04", "BS_05", "BS_08", "BS_10", "BS_11", "BS_12", "BS_19", "BS_20", "BS_23", "BS_24"])),
  T(12, "Existencias", "NIC 2", "La composición de las existencias es la siguiente:", BRK(["BS_09"])),
  T(13, "Cuentas a cobrar comerciales", "NIC 1 / NIIF 9", "El detalle de las cuentas a cobrar es el siguiente:", BRK(["BS_08"])),
  T(14, "Efectivo y equivalentes", "NIC 7", "El efectivo y equivalentes al cierre asciende a {{n14.total.cur}}.", BRK(["BS_07"])),
  T(15, "Capital y reservas", "NIC 1", "El detalle del patrimonio neto es el siguiente:", BRK(["BS_14", "BS_15", "BS_16", "BS_17"])),
  T(16, "Provisiones", "NIC 37", "El movimiento de las provisiones durante el ejercicio {{ejercicio}} ha sido el siguiente (en euros):", MOV(["BS_18"], [], { labels: { entradas: "Dotaciones", salidas: "Aplicaciones y reversiones" } })),
  T(17, "Impuesto sobre las ganancias", "NIC 12", "El gasto por impuesto del ejercicio asciende a {{n17.total.cur}}.", BRK(["BS_06", "BS_21", "CC_18"])),
  T(18, "Ingresos por contratos con clientes", "NIIF 15", "El detalle de los ingresos ordinarios es el siguiente:", BRK(["CC_01"], [], "PL")),
  T(19, "Partes vinculadas", "NIC 24", "Los saldos con partes vinculadas son los siguientes:", BRK(["BS_04", "BS_12", "BS_20"], ["empresas del grupo", "empresas asociadas", "partes vinculadas", "related part"])),
  T(20, "Hechos posteriores", "NIC 10", "No se han producido hechos posteriores significativos."),
];

export function notesForModel(modelId) {
  const src = modelId === "ifrs_es" ? IFRS : PGC_NORMAL;
  return src.map(n => ({
    id: `n${n.number}`,
    number: n.number,
    title: n.title,
    description: n.description,
    narrative: n.narrative,
    kind: n.kind,
    bind: n.bind ?? null,
    manual: n.manual ?? null,
    // Estado editable por el usuario
    hidden: false,
    tableOn: n.kind !== "text",
    overrides: {},      // "fila|columna" → número
    extraRows: [],      // filas añadidas a mano
    hiddenRows: [],     // filas automáticas ocultadas
    signFlip: null,     // null = automático
    reviewed: false,
  }));
}
