/* ══════════════════════════════════════════════════════════════════════
   Contribución — exportación a Excel y PDF.
   ══════════════════════════════════════════════════════════════════════ */
import { MONTHS, computeLiteralForCompany, computeLiteralJournalForCompany, computeLiteralCounterpartyForCompany } from "./contributiveUtils.js";

export function generateContributiveXlsx({
  T,
tree, plTreeStd = [], bsTreeStd = [], pivot, pivotPrev = new Map(), overrideLiteralPl = null, overrideLiteralBs = null, overrideLiteralCf = null,
  cfTree, cfPivot, cfPivotPrev = new Map(),
cols, cfCols,
  ytdOnly = true,
  cmpPivot, cmpPivotPrev = new Map(), cmpCfPivot,
  typeFilter, activeMapping,
activeMappings = { pl: null, bs: null, cf: null }, codeToStatementFromStd = new Map(), codeToSectionInfo = new Map(),
dimIdx, dimIdxPrev = new Map(), cmpDimIdx, cmpDimIdxPrev = new Map(),
  journalPivot = new Map(), counterpartyPivot = new Map(),
  cfNameLookup = new Map(),
companies = [], exportSheets = { todos: true, pl: true, bs: true, cf: true }, drilldownOpt = true,
  includeAdjustments = true,
  compareMode = false,
  perspectiveMode = false, perspectiveParent = "",
  month, year, source, structure,
  cmpMonth, cmpYear, cmpSource, cmpStructure,
}) {
async function doGenerate(ExcelJS, JSZip) {
    const C = {
      primary:   "FF1A2F8A",
      navyDk:    "FF13225C",
      white:     "FFFFFFFF",
      highlight: "FFEEF1FB",
      band1:     "FFFFFFFF",
      band2:     "FFF8F9FF",
      sumBand:   "FFEEF1FB",
      gray400:   "FF9CA3AF",
      red:       "FFDC2626",
      green:     "FF059669",
      amberDk:   "FFCF305D",
    };
    const toArgb = (hex) => "FF" + String(hex || "1a2f8a").replace("#", "").toUpperCase().padStart(6, "0");

    const getLegal = (co) =>
      companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName ?? co;

    const monthLabel = MONTHS[Number(month) - 1]?.label ?? String(month);
    const cmpMoLabel = MONTHS[Number(cmpMonth) - 1]?.label ?? String(cmpMonth);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Konsolidator";
    wb.created = new Date();

const tt = (k, fb) => (T ? T(k, fb) : fb);
    // Per-tab literal comes from activeMappings (each tab's own mapping), so
    // each sheet renders exactly what its standalone tab shows — custom
    // accounts (999) and breakers included. Falls back to the combined
    // treeLiteral prop when a per-tab mapping isn't loaded.
// Return the tab's active literal — whether it's a user mapping OR the hidden
    // override (the override is what makes an "unmapped" tab look normal, same as
    // the app). Only the synthetic Todos placeholder is excluded.
    const litFor = (tab) => {
      const m = activeMappings?.[tab];
      if (!m?.treeLiteral?.length) return null;
      if (m.name === "__todos_synthetic__") return null;
      return m.treeLiteral;
    };
    // Always emit the 3 statement sheets + the combined Todos sheet, regardless
    // of the tab the user is on. (Previously only the active tab was exported.)
const sheetSpecs = [];
    // Each statement sheet uses its OWN mapping: a user mapping if the tab has one,
    // otherwise the hidden override (the custom-no-user standard for that statement).
    // Falling through to null would make the sheet render from the on-screen `tree`,
    // which is built for whatever tab is currently active — so a PL user mapping would
    // leak into the BS/CF sheets. The override keeps each sheet self-contained.
    sheetSpecs.push({ name: tt("page_pl_full", "Profit & Loss"),  types: ["P/L", "DIS"], literal: litFor("pl") || overrideLiteralPl, isCF: false });
    sheetSpecs.push({ name: tt("page_bs_full", "Balance Sheet"),  types: ["B/S"],        literal: litFor("bs") || overrideLiteralBs, isCF: false });
    sheetSpecs.push({ name: tt("nav_cashflow", "Cash Flow"),      types: ["C/F", "CFS"], literal: litFor("cf") || null, isCF: true  });
    // In "Todos" (no typeFilter) add a combined sheet mirroring the on-screen
// Todos sheet: PL + BS literals, then CF flat. Always emitted (after the 3).
    {
sheetSpecs.push({
name: tt("filter_all", "Todos"),
        types: ["P/L", "DIS", "B/S", "C/F", "CFS"],
        // Todos ALWAYS renders from the custom-no-user standard trees (plTreeStd +
        // bsTreeStd + cfTree), never from a user mapping — so it stays consistent
        // regardless of which tab has a user mapping active. No literal → the
        // STANDARD branch handles it (which walks plTreeStd/bsTreeStd and appends CF).
        literal: null,
isCF: false,
        isCombined: true,
      });
    }

    // Filter sheets by the user's modal selection (Todos/PL/BS/CF).
    const sheetKeyOf = (s) => s.isCombined ? "todos" : s.isCF ? "cf" : (s.types.includes("B/S") ? "bs" : "pl");
const sheetSpecsToRender = sheetSpecs.filter(s => exportSheets?.[sheetKeyOf(s)] !== false);
    for (const spec of sheetSpecsToRender) {
// Union of PL/BS + CF companies on every sheet, so a company that only has
    // CF data (or vice versa) still gets a column everywhere. Matches the app.
    const allCompanies = [...new Set([...(cols ?? []), ...(cfCols ?? [])])];
    const visCo = allCompanies;
const usePivot = spec.isCF ? cfPivot : pivot;
      const usePivotPrev = spec.isCF ? cfPivotPrev : pivotPrev;
      const useCmpPivot = spec.isCF ? cmpCfPivot : cmpPivot;
      if (visCo.length === 0) continue;


// Sub-columns per company:
      //   - "A" amount (always)
      //   - "%" of perspective parent (only when perspectiveMode is on)
      //   - CMP/Δ/Δ% (when compare on)
      //   - Uploaded + 5 journal types + IC (P/L + B/S only)
      const JOURNAL_SUBS = ["Uploaded", "AJE", "RJE", "EJE", "SYS", "CFA", "IC"];
   const journalColCount = (spec.isCF || !includeAdjustments) ? 0 : JOURNAL_SUBS.length;
      const compareColCount = compareMode ? 3 : 0;
      const pctColCount     = perspectiveMode ? 1 : 0;
      const subColsPerCo    = 1 + pctColCount + compareColCount + journalColCount;
const showTotals = true;
      // Parent consolidated col sits BEFORE the per-company cols when perspective on
      const parentColCount = perspectiveMode ? 1 : 0;
      const totalCols = 1 + parentColCount + visCo.length * subColsPerCo + (showTotals ? 1 : 0);

const perspectiveLegal = perspectiveMode
        ? (companies.find(c => (c.CompanyShortName ?? c.companyShortName) === perspectiveParent)?.CompanyLegalName ?? perspectiveParent)
        : "";

const subLines = [];
      if (year && month) {
        const seg = [`📅 ${monthLabel} ${year}`];
        if (source)    seg.push(`${tt("file_field_source", "Source")}: ${source}`);
        if (structure) seg.push(`${tt("file_field_structure", "Structure")}: ${structure}`);
        subLines.push(seg.join("    ·    "));
      }
      const metaLine = [`${tt("file_field_statement", "Statement")}: ${spec.name.toUpperCase()}`, `${tt("kpi_company_plural", "Companies")}: ${visCo.length}`];
      if (perspectiveMode)               metaLine.push(`🎯 ${tt("filter_perspective", "Perspective")}: ${perspectiveLegal} (${perspectiveParent})`);
      if (spec.isMapped && activeMapping) metaLine.push(`${tt("file_field_mapping", "Mapping")}: ${activeMapping.name}`);
      if (compareMode)                    metaLine.push(tt("file_compare_on", "Compare ON"));
      subLines.push(metaLine.join("    ·    "));
      if (compareMode && cmpYear && cmpMonth) {
        const seg = [`🆚 ${tt("file_vs_prefix", "vs")} ${cmpMoLabel} ${cmpYear}`];
        if (cmpSource)    seg.push(`${tt("file_field_source", "Source")}: ${cmpSource}`);
        if (cmpStructure) seg.push(`${tt("file_field_structure", "Structure")}: ${cmpStructure}`);
        subLines.push(seg.join("    ·    "));
      }

      const headerRowCount = 1 + subLines.length + 1 + (compareMode ? 2 : 1);
      const ws = wb.addWorksheet(spec.name, {
      views: [{ state: "frozen", xSplit: 1, ySplit: headerRowCount }],
      properties: { outlineLevelRow: 1, summaryBelow: false },
      });

      let curRow = 1;
      // Banner
      ws.mergeCells(curRow, 1, curRow, totalCols);
      const titleCell = ws.getCell(curRow, 1);
titleCell.value = `Konsolidator · ${spec.name}${compareMode ? "  ·  COMPARE ON" : ""}`;
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.white } };
      titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(curRow).height = 28;
      curRow++;

      // Sub-lines
      subLines.forEach(line => {
        ws.mergeCells(curRow, 1, curRow, totalCols);
        const c = ws.getCell(curRow, 1);
        c.value = line;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        c.font = { name: "Calibri", size: 10, color: { argb: "FFE0E7FF" } };
        c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(curRow).height = 18;
        curRow++;
      });

      // Spacer
      ws.getRow(curRow).height = 6;
      curRow++;

// Column headers — 2 rows always
      const r1 = curRow, r2 = curRow + 1;
      ws.getRow(r1).height = 22;
      ws.getRow(r2).height = 18;
      ws.mergeCells(r1, 1, r2, 1);
const acc = ws.getCell(r1, 1);
      acc.value = tt("file_col_account", "Account").toUpperCase();
      acc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
      acc.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
      acc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

      // Parent consolidated column (perspective mode)
      let cursorCol = 2;
      if (perspectiveMode) {
        ws.mergeCells(r1, cursorCol, r2, cursorCol);
const pCell = ws.getCell(r1, cursorCol);
        pCell.value = `${perspectiveLegal}\n${tt("col_consolidated", "Consolidated").toUpperCase()} · ${perspectiveParent}`;
        pCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navyDk } };
        pCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        pCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cursorCol++;
      }

// Per-company sub-col schema (single-character codes A/%/Σ/Δ are conventions — kept as-is)
      const subColSchema = [{ label: tt("file_col_a", "A"), fill: C.primary }];
      if (perspectiveMode) subColSchema.push({ label: "%", fill: "FF4F6BD0" });
      if (compareMode) {
        subColSchema.push({ label: tt("file_col_sigma_cmp", "Σ CMP"), fill: C.amberDk });
        subColSchema.push({ label: "Δ",                                fill: C.navyDk });
        subColSchema.push({ label: tt("file_col_delta_pct", "Δ %"),   fill: C.navyDk });
      }
if (!spec.isCF && includeAdjustments) JOURNAL_SUBS.forEach(jk => {
        const lbl = jk === "Uploaded" ? tt("subtab_uploaded", "Uploaded") : jk;
        subColSchema.push({ label: lbl, fill: jk === "IC" ? C.amberDk : C.primary });
      });

      visCo.forEach((co, i) => {
        const startCol = cursorCol + i * subColsPerCo;
        ws.mergeCells(r1, startCol, r1, startCol + subColsPerCo - 1);
        const sCell = ws.getCell(r1, startCol);
        sCell.value = getLegal(co);
        sCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.primary } };
        sCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        sCell.alignment = { vertical: "middle", horizontal: "center" };
        // Thick left border between companies (skip first)
        if (i > 0) {
          sCell.border = { ...(sCell.border ?? {}), left: { style: "medium", color: { argb: C.navyDk } } };
        }
        subColSchema.forEach((sc, j) => {
          const cc = ws.getCell(r2, startCol + j);
          cc.value = sc.label;
          cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sc.fill } };
          cc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C.white } };
          cc.alignment = { vertical: "middle", horizontal: "center" };
          if (j === 0 && i > 0) {
            cc.border = { left: { style: "medium", color: { argb: C.navyDk } } };
          }
        });
      });

if (showTotals) {
        const tCol = cursorCol + visCo.length * subColsPerCo;
        ws.mergeCells(r1, tCol, r2, tCol);
const tCell = ws.getCell(r1, tCol);
        tCell.value = tt("file_col_total", "Total").toUpperCase();
        tCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navyDk } };
        tCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: C.white } };
        tCell.alignment = { vertical: "middle", horizontal: "center" };
        tCell.border = { left: { style: "medium", color: { argb: C.navyDk } } };
      }
      curRow = r2 + 1;

      let dataIdx = 0;
      let maxDepth = 0;

const writeNum = (rowN, colN, val, fillArgb, opts = {}) => {
        const cell = ws.getCell(rowN, colN);
        // Sentinel: exact zero or non-finite → em-dash. Anything else keeps its exact value.
        const isZero = val == null || !Number.isFinite(val) || Math.abs(val) < 1e-9;
        if (isZero) {
          cell.value = "—";
          cell.font = { name: "Calibri", size: 10, color: { argb: C.gray400 }, bold: !!opts.bold };
        } else {
          cell.value = Number(val);                                // exact, not rounded
cell.numFmt = opts.percent
            ? '0.00"%";[Red](0.00"%")'                             // 2-decimal percent, negatives in parens
            : '#,##0.00;[Red](#,##0.00)';                          // 2-decimal amount, negatives in parens
          cell.font = { name: "Calibri", size: 10, bold: !!opts.bold,
            color: { argb: opts.colorOverride ?? (val < 0 ? C.red : "FF000000") } };
        }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      };

      const writeSectionBar = (label, colorArgb) => {
        ws.mergeCells(curRow, 1, curRow, totalCols);
        const cell = ws.getCell(curRow, 1);
        cell.value = String(label).toUpperCase();
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorArgb } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: C.white } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(curRow).height = 22;
        curRow++;
        dataIdx = 0;
      };

const writeAccountRow = ({ code, name, depth, isBold, isSum, dims, getVal, getCmp, getJp, getIc }) => {
        // Summarised report: when drill-down is off, only emit top-level (depth 0) rows.
        if (!drilldownOpt && depth > 0) return;
        maxDepth = Math.max(maxDepth, depth);
        const band = isSum ? C.sumBand : (dataIdx % 2 === 0 ? C.band1 : C.band2);
        dataIdx++;

        const resolvedName = (String(name ?? "").trim()) ||
                              (spec.isCF ? (cfNameLookup.get(String(code)) ?? "") : "") ||
                              "—";

        const labelCell = ws.getCell(curRow, 1);
        const codeStr = String(code ?? "").trim();
        const runs = [];
        if (codeStr) runs.push({ text: `${codeStr}  `, font: { name: "Calibri", size: 9, color: { argb: "FF6B7280" } } });
        runs.push({ text: resolvedName, font: { name: "Calibri", size: 11, bold: !!isBold || !!isSum, color: { argb: "FF1A2F8A" } } });
        if (Array.isArray(dims) && dims.length > 0) {
          runs.push({ text: `  [${dims.length === 1 ? dims[0] : `${dims.length} dims`}]`, font: { name: "Calibri", size: 9, italic: true, color: { argb: "FFA16207" } } });
        }
        labelCell.value = runs.length === 1 ? resolvedName : { richText: runs };
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
        labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 + Math.min(depth, 6) };
        labelCell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };

        // Compute row total first so we can use it as the % denominator in perspective mode
        let rowTotal = 0;
        const vals = visCo.map(co => {
          const v = getVal(co);
          rowTotal += v;
          return v;
        });
        const parentTotal = perspectiveMode ? rowTotal : 0;

        // Parent consolidated cell
        let cursorCol = 2;
        if (perspectiveMode) {
          writeNum(curRow, cursorCol, parentTotal, "FFEEF1FB", { bold: true });
          cursorCol++;
        }

        // Per-company columns
        visCo.forEach((co, i) => {
          const a = vals[i];
          const startCol = cursorCol + i * subColsPerCo;
          let offset = 0;

          // Main "A"
          writeNum(curRow, startCol + offset, a, band, { bold: isBold || isSum });
          // Thick left border between companies (skip first)
          if (i > 0) {
            const cell = ws.getCell(curRow, startCol + offset);
            cell.border = { ...(cell.border ?? {}), left: { style: "medium", color: { argb: C.navyDk } } };
          }
          offset++;

          // % of parent (perspective mode)
          if (perspectiveMode) {
            const pct = parentTotal !== 0 ? (a / parentTotal) * 100 : null;
            writeNum(curRow, startCol + offset++, pct, "FFEEF1FB", { bold: isBold || isSum, percent: true,
              colorOverride: pct == null || pct === 0 ? null : "FF4F6BD0" });
          }

// Compare cols
          if (compareMode) {
            const b = getCmp(co);
            const delta = a - b;
            const deltaPct = Math.abs(b) > 1e-9 ? ((a - b) / Math.abs(b)) * 100 : null;
            writeNum(curRow, startCol + offset++, b,        "FFFAFBFF", { bold: isBold || isSum });
            writeNum(curRow, startCol + offset++, delta,    "FFF5F7FF", { bold: isBold || isSum,
              colorOverride: (delta == null || Math.abs(delta) < 1e-9) ? null : (delta < 0 ? C.red : C.green) });
            writeNum(curRow, startCol + offset++, deltaPct, "FFF0F3FF", { bold: isBold || isSum, percent: true,
              colorOverride: deltaPct == null ? null : (deltaPct < 0 ? C.red : C.green) });
          }

// Journal cols (ajustes y eliminaciones)
          if (!spec.isCF && includeAdjustments) {
            const jp = getJp ? getJp(co) : {};
            // Igual que en pantalla: Uploaded = carga real (si la hay); si no, por diferencia.
            const journalsTotal = ["AJE", "RJE", "EJE", "SYS", "CFA"].reduce((s, k) => s + (Number(jp[k]) || 0), 0);
            const uploadedVal = Object.prototype.hasOwnProperty.call(jp, "Uploaded") ? Number(jp.Uploaded) || 0 : a - journalsTotal;
            const journalFill = "FFF4F6FB";
            writeNum(curRow, startCol + offset++, uploadedVal, journalFill, { bold: isBold || isSum });
            ["AJE", "RJE", "EJE", "SYS", "CFA"].forEach(jt => {
              writeNum(curRow, startCol + offset++, jp[jt] ?? 0, journalFill, { bold: isBold || isSum });
            });
            const icVal = getIc ? getIc(co) : 0;
            writeNum(curRow, startCol + offset++, icVal, "FFFEF0F4", { bold: isBold || isSum,
              colorOverride: icVal === 0 ? null : (icVal < 0 ? C.red : C.amberDk) });
          }
        });

        if (showTotals) {
          const tCol = cursorCol + visCo.length * subColsPerCo;
          writeNum(curRow, tCol, rowTotal, C.highlight, { bold: true });
          const tcell = ws.getCell(curRow, tCol);
          tcell.border = { ...(tcell.border ?? {}), left: { style: "medium", color: { argb: C.navyDk } } };
        }

        const row = ws.getRow(curRow);
        const cappedDepth = Math.min(7, depth);
        row.outlineLevel = cappedDepth;
if (cappedDepth > 0) row.hidden = true;
curRow++;
      };

      // Renders the CF section like the on-screen tab: cfTree flat + a colored
      // breaker bar before the first node of each section (via codeToSectionInfo).
      // Defined here so it can use writeSectionBar / writeAccountRow (loop-scoped).
const writeCfFlatWithBreakers = (sectionsOverride = null) => {
        const seen = new Set();
        // Section lookup: prefer the CF literal sections when provided (Todos override
        // or a user CF mapping); otherwise fall back to codeToSectionInfo — the same
        // per-code section map the on-screen CF tab uses (custom-no-user standards have
        // no treeLiteral but DO populate codeToSectionInfo).
        const codeToCfSection = new Map();
        (sectionsOverride || activeMappings?.cf?.treeLiteral || []).forEach(sec => {
          if (!sec.label) return;
          const info = { section: sec.label, label: sec.label, color: sec.color };
          const mark = (n) => {
            codeToCfSection.set(String(n.code ?? n.AccountCode), info);
            (n.children || []).forEach(mark);
          };
          (sec.nodes || []).forEach(mark);
        });
          const sectionOf = (node) => {
            const stack = [node];
            while (stack.length) {
            const n = stack.pop();
            const info = codeToCfSection.get(String(n.AccountCode))
              ?? (codeToSectionInfo.get(String(n.AccountCode))?.section
                    ? { section: codeToSectionInfo.get(String(n.AccountCode)).section,
                        label: codeToSectionInfo.get(String(n.AccountCode)).label,
                        color: codeToSectionInfo.get(String(n.AccountCode)).color }
                    : null);
            if (info?.section) return info;
            const ch = n.children || [];
            for (let k = ch.length - 1; k >= 0; k--) stack.push(ch[k]);
        }
        return null;
        };
            const walkCf = (node, depth) => {
            if (node._sectionAnchor && node._sectionInfo) {
            const key = node._sectionInfo.section ?? node._sectionInfo.label;
            if (!seen.has(key)) {
            seen.add(key);
            writeSectionBar(node._sectionInfo.label, toArgb(node._sectionInfo.color));
            }
            return;
          }
          const code = node.AccountCode;
          const hasChildren = node.children?.length > 0;
          const isSum = /\.S$/i.test(code) || hasChildren;
const getVal = (co) => {
            const direct = Number(cfPivot.get(code)?.[co]?.total ?? 0);
            // Sum nodes: cfPivot may hold only leaf values, so roll up children.
            if (hasChildren) {
              let sum = 0;
              const walk = (n) => { const ch = n.children || []; if (ch.length) ch.forEach(walk); else sum += Number(cfPivot.get(n.AccountCode)?.[co]?.total ?? 0); };
              walk(node);
              return sum;
            }
            return direct;
          };
const getCmp = (co) => {
            if (!compareMode) return 0;
            // Sum nodes: cmpCfPivot may hold only leaves, so roll up children (CF always YTD).
            if (hasChildren) {
              let sum = 0;
              const walk = (n) => { const ch = n.children || []; if (ch.length) ch.forEach(walk); else sum += Number(cmpCfPivot?.get(n.AccountCode)?.[co] ?? 0); };
              walk(node);
              return sum;
            }
            return Number(cmpCfPivot?.get(code)?.[co] ?? 0);
          };
writeAccountRow({ code, name: node.AccountName ?? node.accountName ?? cfNameLookup.get(String(code)) ?? code, depth, isBold: depth === 0, isSum, getVal, getCmp, getJp: () => ({}), getIc: () => 0 });
if (hasChildren && !node._noExpand) node.children.forEach(c => walkCf(c, depth + 1));
        };
        let __wrote = 0;
        const __origWalk = walkCf;
        (cfTree || []).forEach(node => {
          const info = sectionOf(node);
          if (info && !seen.has(info.section)) {
            seen.add(info.section);
            writeSectionBar(info.label, toArgb(info.color));
          }
          __wrote++;
          walkCf(node, 0);
        });
      };

// Does the CF tab have a USER mapping active (not the hidden override /
      // todos synthetic)? If so, render CF from its literal like PL/BS so the
      // export mirrors the mapped on-screen view. Otherwise use the standard flat.
const cfUserMapped = spec.isCF && activeMappings?.cf?.treeLiteral?.length > 0
        && activeMappings.cf.name !== "__custom_override__"
        && activeMappings.cf.name !== "__todos_synthetic__";

      if (spec.isCF && !spec.isCombined && !cfUserMapped && (cfTree && cfTree.length > 0)) {
        // No user mapping AND cfTree is populated: render flat from cfTree with
        // section breakers — like the on-screen standard CF tab.
        writeCfFlatWithBreakers();
      } else if (spec.literal && spec.literal.length > 0) {
        // LITERAL MODE — walk this sheet's own literal (with custom accts + breakers)
spec.literal.forEach(section => {
       if (section.label) writeSectionBar(section.label, toArgb(section.color));
          const renderNode = (node, depth) => {
         const hasChildren = Array.isArray(node.children) && node.children.length > 0 && !node._noExpand;
            const isSum = !!node.isSum && hasChildren;
const getVal = (co) => {
              const curr = computeLiteralForCompany(node, usePivot, co, "object", spec.isCF ? null : dimIdx);
              if (window.__dimLog === undefined) window.__dimLog = 0;
              if (window.__dimLog < 10 && String(node.code) === '600000' && co === 'RCA') {
                window.__dimLog++;
              }
              if (ytdOnly || spec.isCF) return curr;
// Monthly: subtract the recursively-computed previous period, but
              // only for P/L. B/S stays YTD. In the combined "Todos" sheet each
              // section is tagged with _stmt (P/L vs B/S) so custom accounts under
              // a BS breaker stay YTD instead of falling back to the sheet's type.
const stmt = section._stmt
               ?? codeToStatementFromStd.get(String(node.code))
?? spec.types[0] ?? "";
              const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
              if (!isPL) return curr;
const prev = computeLiteralForCompany(node, usePivotPrev, co, "object", spec.isCF ? null : dimIdxPrev);
              return curr - prev;
            };
           const getCmp = (co) => {
              if (!compareMode) return 0;
              const cmpCurr = computeLiteralForCompany(node, useCmpPivot, co, "scalar", spec.isCF ? null : cmpDimIdx);
              if (ytdOnly || spec.isCF) return cmpCurr;
              const stmt = section._stmt ?? codeToStatementFromStd.get(String(node.code)) ?? spec.types[0] ?? "";
              const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
if (!isPL) return cmpCurr;
              const cmpPrev = computeLiteralForCompany(node, cmpPivotPrev, co, "scalar", spec.isCF ? null : cmpDimIdxPrev);
              return cmpCurr - cmpPrev;
            };
            const getJp  = (co) => spec.isCF ? {} : computeLiteralJournalForCompany(node, journalPivot, co, null);
            const getIc  = (co) => spec.isCF ? 0  : computeLiteralCounterpartyForCompany(node, counterpartyPivot, co, null);
            writeAccountRow({ code: node.code, name: node.name, depth, isBold: depth === 0, isSum, dims: node.dims, getVal, getCmp, getJp, getIc });
            if (hasChildren) node.children.forEach(c => renderNode(c, depth + 1));
          };
(section.nodes || []).forEach(n => renderNode(n, 0));
        });
// Combined "Todos" sheet: append CF flat below PL+BS with breakers.
if (spec.isCombined) {
          // Use standard CF sections (override), not the user's CF mapping.
          writeCfFlatWithBreakers(overrideLiteralCf);
        }
} else {
        // STANDARD MODE — mirror the on-screen render exactly. The tree comes pre-shaped
        // like the app (section anchors flat, grand totals as loose rows, breakers via
        // codeToSectionInfo). Values roll up children via computeLiteralForCompany — the
        // SAME function the app uses — instead of reading the pivot directly (which is
        // empty for sum rows and produced blank exports).
// Pick the statement's OWN standard tree so a user mapping on another tab
        // can't leak in: BS uses bsTreeStd, PL uses plTreeStd, CF uses cfTree.
        // The combined "Todos" sheet walks PL then BS from the standard trees.
        const isBsSheet = !spec.isCF && spec.types.includes("B/S") && !spec.types.includes("P/L");
        const useTree = spec.isCF ? (cfTree || [])
                      : spec.isCombined ? [...(plTreeStd || []), ...(bsTreeStd || [])]
                      : isBsSheet ? (bsTreeStd && bsTreeStd.length ? bsTreeStd : (tree || []))
                      : (plTreeStd && plTreeStd.length ? plTreeStd : (tree || []));
        const filtered = useTree.filter(n => spec.types.includes(n.AccountType ?? n.accountType ?? ""));

        // Breaker resolution: section info per code, same source as the app.
        const secInfoOf = (code) => codeToSectionInfo.get(String(code)) ?? null;
        const seenSections = new Set();

        // Adapt a standard tree node into the shape computeLiteralForCompany expects
        // (it reads node.code / node.isSum / node.children / node.dims).
        const asLit = (node) => ({
          code: node.AccountCode,
          isSum: (node.children?.length > 0),
          dims: node.dims ?? null,
          children: (node.children || []).map(asLit),
        });

        const stmtOf = (node) => codeToStatementFromStd.get(String(node.AccountCode))
          ?? node.AccountType ?? node.accountType ?? spec.types[0] ?? "";

        const walk = (node, depth) => {
          const code = node.AccountCode;
          const hasChildren = node.children?.length > 0;
          const isSummary = /\.S$/i.test(String(code)) || hasChildren;
          const litNode = asLit(node);

          // Section breaker before the first row of each section (top level only).
          if (depth === 0) {
            const info = secInfoOf(code);
            if (info?.section && !seenSections.has(info.section)) {
              seenSections.add(info.section);
              writeSectionBar(info.label ?? info.section, toArgb(info.color));
            }
          }

          const getVal = (co) => {
            const curr = computeLiteralForCompany(litNode, usePivot, co, "object", spec.isCF ? null : dimIdx);
            if (ytdOnly || spec.isCF) return curr;
            const stmt = stmtOf(node);
            const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
            if (!isPL) return curr;
            const prev = computeLiteralForCompany(litNode, usePivotPrev, co, "object", spec.isCF ? null : dimIdxPrev);
            return curr - prev;
          };
          const getCmp = (co) => {
            if (!compareMode) return 0;
            const cmpCurr = computeLiteralForCompany(litNode, useCmpPivot, co, "scalar", spec.isCF ? null : cmpDimIdx);
            if (ytdOnly || spec.isCF) return cmpCurr;
            const stmt = stmtOf(node);
            const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
            if (!isPL) return cmpCurr;
            const cmpPrev = computeLiteralForCompany(litNode, cmpPivotPrev, co, "scalar", spec.isCF ? null : cmpDimIdxPrev);
            return cmpCurr - cmpPrev;
          };
          const getJp  = (co) => spec.isCF ? {} : computeLiteralJournalForCompany(litNode, journalPivot, co, null);
          const getIc  = (co) => spec.isCF ? 0  : computeLiteralCounterpartyForCompany(litNode, counterpartyPivot, co, null);

          writeAccountRow({
            code, name: node.AccountName ?? node.accountName ?? "",
            depth, isBold: depth === 0 || isSummary, isSum: false, dims: node.dims ?? null,
            getVal, getCmp, getJp, getIc,
          });

          // Don't recurse into _noExpand grand totals (they sum via children but render
          // as a single loose row, exactly like the app).
          if (!node._noExpand) (node.children || []).forEach(c => walk(c, depth + 1));
        };
filtered.forEach(n => walk(n, 0));
        // Todos combined sheet: the CF statement lives in cfTree (not in `tree`), so the
        // type-filtered STANDARD walk above never emits it. Append the CF flat here, same
        // renderer the standalone CF sheet uses, so Todos ends with the Cash Flow block.
        if (spec.isCombined && cfTree && cfTree.length > 0) {
          writeCfFlatWithBreakers(overrideLiteralCf && overrideLiteralCf.length ? overrideLiteralCf : null);
        }
      }

// Column widths + per-column outline (journal & compare collapsible)
      ws.getColumn(1).width = 44;
      let widthCursor = 2;
      if (perspectiveMode) { ws.getColumn(widthCursor).width = 20; widthCursor++; }   // Parent consolidated
      visCo.forEach((co, i) => {
        const startCol = widthCursor + i * subColsPerCo;
        let off = 0;
        ws.getColumn(startCol + off).width = 16; off++;                              // A
        if (perspectiveMode) {
        ws.getColumn(startCol + off).width = 9;
        ws.getColumn(startCol + off).outlineLevel = 0;                              // % stays visible
        off++;
        }
if (compareMode) {
ws.getColumn(startCol + off).width = 14; ws.getColumn(startCol + off).outlineLevel = 1; ws.getColumn(startCol + off).hidden = true; off++;
          ws.getColumn(startCol + off).width = 13; ws.getColumn(startCol + off).outlineLevel = 1; ws.getColumn(startCol + off).hidden = true; off++;
          ws.getColumn(startCol + off).width = 11; ws.getColumn(startCol + off).outlineLevel = 1; ws.getColumn(startCol + off).hidden = true; off++;
        }
if (!spec.isCF && includeAdjustments) {
          for (let k = 0; k < 6; k++) {
            ws.getColumn(startCol + off).width = 13;
            ws.getColumn(startCol + off).outlineLevel = 2;
ws.getColumn(startCol + off).hidden = true;
            off++;
          }
          ws.getColumn(startCol + off).width = 13;
          ws.getColumn(startCol + off).outlineLevel = 2;
          ws.getColumn(startCol + off).hidden = true;
          off++;
        }
      });
      if (showTotals) ws.getColumn(widthCursor + visCo.length * subColsPerCo).width = 18;
      ws.properties.outlineLevelRow = Math.min(7, Math.max(1, maxDepth));
      ws.properties.outlineLevelCol = !spec.isCF ? 2 : (compareMode ? 1 : 0);
      ws.properties.summaryBelow = false;
      ws.properties.summaryRight = false;
    }

    // Repair pass — strips ExcelJS quirks that cause "Recovered Content" popup
    async function repairXlsx(buf) {
      const zip = await JSZip.loadAsync(buf);
      const sheets = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
      const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
      const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
      for (const f of sheets) {
        let xml = await zip.file(f).async("string");
        xml = xml.replace(/<c r="[^"]+"[^>]*><v>-?Infinity<\/v><\/c>/g, "");
        xml = xml.replace(/<c r="[^"]+"[^>]*><v>NaN<\/v><\/c>/g, "");
        xml = xml.replace(/(<row[^>]*outlineLevel="\d+"[^>]*?)\s*collapsed="1"/g, "$1");
        xml = xml.replace(/x14ac:dyDescent="55"/g, 'x14ac:dyDescent="0.25"');
        xml = xml.replace(/outlineLevel="(\d+)"/g, (_, n) => `outlineLevel="${Math.min(7, parseInt(n))}"`);
        xml = xml.replace(/<c r="[^"]+"[^>]*><v><\/v><\/c>/g, "");
        const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"/g)];
        if (cells.length > 0) {
          const cs = cells.map(c => colToNum(c[1]));
          const rs = cells.map(c => +c[2]);
          const ref = `${numToCol(Math.min(...cs))}${Math.min(...rs)}:${numToCol(Math.max(...cs))}${Math.max(...rs)}`;
          xml = xml.replace(/<dimension ref="[^"]+"\s*\/>/, `<dimension ref="${ref}"/>`);
        }
        zip.file(f, xml);
      }
      return await zip.generateAsync({ type: "arraybuffer" });
    }

    let buf;
    try { buf = await wb.xlsx.writeBuffer(); }
   catch (e) { alert((T ? T("error_load_excel_lib") : "Excel write failed: ") + " " + e.message); return; }
    let final;
    try { final = await repairXlsx(buf); } catch { final = buf; }

    const blob = new Blob([final], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const tabSuffix = typeFilter ? `_${typeFilter.replace("/", "")}` : "";
    a.href = url;
    a.download = `Konsolidator_Contributive${tabSuffix}_${year}_${String(month).padStart(2, "0")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const load = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  Promise.all([
    load("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js"),
    load("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"),
]).then(() => doGenerate(window.ExcelJS, window.JSZip))
    .catch(e => alert((T ? T("error_load_excel_lib") : "Could not load ExcelJS") + ": " + e.message));
}

export function generateContributivePdf({
  T,
tree, treeLiteral, pivot, pivotPrev = new Map(), overrideLiteralPl = null, overrideLiteralBs = null, overrideLiteralCf = null,
  cfTree, cfPivot, cfPivotPrev = new Map(),
  cols, cfCols,
cmpPivot, cmpPivotPrev, cmpCfPivot,
ytdOnly = true,
  typeFilter, activeMapping, mappingTab,
activeMappings = { pl: null, bs: null, cf: null },
codeToStatementFromStd = new Map(), codeToSectionInfo = new Map(),
  dimIdx, dimIdxPrev = new Map(), cmpDimIdx, cmpDimIdxPrev = new Map(),
  journalPivot = new Map(), counterpartyPivot = new Map(),
  cfNameLookup = new Map(),
companies = [], exportSheets = { todos: true, pl: true, bs: true, cf: true }, drilldownOpt = true,
  compareMode = false,
  perspectiveMode = false, perspectiveParent = "",
  month, year, source, structure,
  cmpMonth, cmpYear, cmpSource, cmpStructure,
}) {
  function doGenerate(jsPDF, autoTable) {
    const NAVY    = [26, 47, 138];
    const NAVY_DK = [10, 20, 80];
    const NAVY_LT = [70, 90, 180];
    const AMBER   = [251, 191, 36];
    const ROSE    = [207, 48, 93];
    const ROSE_DK = [160, 30, 65];
    const RED     = [220, 38, 38];
    const GREEN   = [5, 150, 105];
    const LIGHT   = [238, 241, 251];
    const STRIPE  = [248, 249, 255];
    const WHITE   = [255, 255, 255];
    const GRAY    = [107, 114, 128];
    const GRAY_LT = [220, 225, 240];
    const INDIGO  = [99, 102, 241];

const fmtN = n => {
      if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.005) return "—";
      const s = Math.abs(Number(n)).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return Number(n) < 0 ? `(${s})` : s;
    };
    const fmtP = n => {
      if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.05) return "—";
      return `${n.toFixed(2)}%`;
    };
    const hexToRgb = (hex) => {
      const m = String(hex || "#1a2f8a").replace("#", "");
      return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
    };
const monthLabel = T ? T(`month_${Number(month)}`, String(month)) : (MONTHS[Number(month) - 1]?.label ?? String(month));
    const cmpMoLabel = T ? T(`month_${Number(cmpMonth)}`, String(cmpMonth)) : (MONTHS[Number(cmpMonth) - 1]?.label ?? String(cmpMonth));
    const perspectiveLegal = perspectiveMode
      ? (companies.find(c => (c.CompanyShortName ?? c.companyShortName) === perspectiveParent)?.CompanyLegalName ?? perspectiveParent)
      : "";

const tt = (k, fb) => (T ? T(k, fb) : fb);
const tabIsMapped = (tab) => activeMapping && mappingTab === tab && treeLiteral;
    // Only a REAL user mapping produces a literal here; the hidden override and
    // the synthetic Todos placeholder render from the standard tree instead.
    const litFor = (tab) => {
      const m = activeMappings?.[tab];
      if (!m?.treeLiteral?.length) return null;
      if (m.name === "__todos_synthetic__") return null;
      return m.treeLiteral;
    };
    const sheetSpecs = [];
    sheetSpecs.push({ name: tt("page_pl_full", "Profit & Loss"), types: ["P/L", "DIS"], literal: litFor("pl"), isMapped: !!tabIsMapped("pl"), isCF: false });
    sheetSpecs.push({ name: tt("page_bs_full", "Balance Sheet"), types: ["B/S"],        literal: litFor("bs"), isMapped: !!tabIsMapped("bs"), isCF: false });
    sheetSpecs.push({ name: tt("nav_cashflow", "Cash Flow"),     types: ["C/F", "CFS"], literal: litFor("cf"), isMapped: !!tabIsMapped("cf"), isCF: true  });
    {
      sheetSpecs.push({
        name: tt("filter_all", "Todos"),
        types: ["P/L", "DIS", "B/S", "C/F", "CFS"],
        literal: [
          ...((overrideLiteralPl || litFor("pl")) || []).map(s => ({ ...s, _stmt: "P/L" })),
          ...((overrideLiteralBs || litFor("bs")) || []).map(s => ({ ...s, _stmt: "B/S" })),
        ],
isCF: false, isCombined: true,
      });
    }
    // Filter sheets by the user's modal selection (Todos/PL/BS/CF).
    const sheetKeyOf = (s) => s.isCombined ? "todos" : s.isCF ? "cf" : (s.types.includes("B/S") ? "bs" : "pl");
    const sheetSpecsToRender = sheetSpecs.filter(s => exportSheets?.[sheetKeyOf(s)] !== false);
    const showJournals = !!typeFilter && (typeFilter === "P/L" || typeFilter === "B/S") && !compareMode;
    const JOURNAL_SUBS = ["Up", "AJE", "RJE", "EJE", "SYS", "CFA", "IC"];

    // Always use A3 landscape — gives more horizontal space for finance tables.
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    // Compute how many companies fit comfortably per page based on sub-col count.
    // Each company gets a fixed minimum width: ~24mm for plain "A" only, more if
    // it has more sub-cols. We back-calculate maxCompanies per spec.
    const ACCOUNT_W       = 80;   // mm reserved for account column (constant)
    const PARENT_W        = 36;   // mm for parent consolidated col when perspective on
    const COL_W = {
      A:     24,
      pct:   16,
      cmp:   24,
      delta: 22,
      dpct:  18,
      jrn:   18,
      ic:    18,
      total: 28,
    };

    const computeCompanyWidth = (journalsHere) => {
      let w = COL_W.A;
      if (perspectiveMode) w += COL_W.pct;
      if (compareMode)     w += COL_W.cmp + COL_W.delta + COL_W.dpct;
      if (journalsHere)    w += COL_W.jrn * 6 + COL_W.ic; // Up+5 jrn + IC
      return w;
    };

    const usableW = W - 16; // 8mm margin each side
    const availableForCompanies = (extraFixed) => usableW - ACCOUNT_W - (perspectiveMode ? PARENT_W : 0) - extraFixed;

    const pageManifest = []; // {displayedPage, title, badge1, badge2}

    // jsPDF starts with page 1 already created → reserved for TOC.

    const drawPageHeader = (spec, partIdx, totalParts) => {
      doc.addPage();
      const bandH = 38;
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, bandH, "F");
      doc.setFillColor(...ROSE);
      doc.rect(0, 0, 5, bandH, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.setTextColor(...WHITE);
const titleTxt = `${tt("contrib_label", "Contribution").toUpperCase()} · ${spec.name.toUpperCase()}` + (totalParts > 1 ? `  ·  ${tt("badge_part", "PART")} ${partIdx + 1}/${totalParts}` : "");
      doc.text(titleTxt, 12, 13);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(180, 200, 255);
const sub1 = [];
      if (year && month) sub1.push(`${monthLabel} ${year}`);
      if (source)        sub1.push(`${tt("file_field_source", "Source")}: ${source}`);
      if (structure)     sub1.push(`${tt("file_field_structure", "Structure")}: ${structure}`);
      doc.text(sub1.join("    ·    "), 12, 19);

      const sub2 = [];
      const visCo = (spec.isCF ? cfCols : cols) ?? [];
      sub2.push(`${tt("kpi_company_plural", "Companies")}: ${visCo.length}`);
      if (spec.isMapped && activeMapping) sub2.push(`${tt("file_field_mapping", "Mapping")}: ${activeMapping.name}`);
      if (perspectiveMode) sub2.push(`${tt("filter_perspective", "Perspective")}: ${perspectiveLegal} (${perspectiveParent})`);
      doc.text(sub2.join("    ·    "), 12, 24);

      if (compareMode) {
        doc.setFillColor(...ROSE_DK);
        doc.roundedRect(12, 28, W - 24, 7, 1.5, 1.5, "F");
doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...AMBER);
        doc.text(`${tt("file_vs_prefix", "vs")}.`, 15, 32.8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...WHITE);
        const cmpSeg = [];
        if (cmpYear && cmpMonth) cmpSeg.push(`${cmpMoLabel} ${cmpYear}`);
        if (cmpSource)           cmpSeg.push(`${tt("file_field_source", "Source")}: ${cmpSource}`);
        if (cmpStructure)        cmpSeg.push(`${tt("file_field_structure", "Structure")}: ${cmpStructure}`);
        doc.text(cmpSeg.join("    ·    "), 24, 32.8);
      }

      let bx = W - 8;
      const badges = [];
      const badge = (txt, bg, fg) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        const tw = doc.getTextWidth(txt);
        const bw = tw + 6;
        doc.setFillColor(...bg);
        doc.roundedRect(bx - bw, 5, bw, 6.5, 1.4, 1.4, "F");
        doc.setTextColor(...fg);
        doc.text(txt, bx - bw + 3, 9.5);
        bx -= bw + 2.5;
        badges.push(txt);
      };
if (totalParts > 1)    badge(`${tt("badge_part", "PART")} ${partIdx + 1}/${totalParts}`, WHITE, NAVY_DK);
      if (compareMode)       badge(tt("badge_compare", "COMPARE"), ROSE, WHITE);
      if (perspectiveMode)   badge(tt("filter_perspective", "PERSPECTIVE").toUpperCase(), WHITE, ROSE);
      if (spec.isMapped)     badge(tt("badge_mapped", "MAPPED"), AMBER, NAVY_DK);
      if (showJournals && !spec.isCF) badge(tt("export_journal_entries", "JOURNALS").toUpperCase(), WHITE, NAVY);

      return { startY: bandH + 4, badges };
    };

    const drawFooter = (spec) => {
      doc.setFillColor(...LIGHT);
      doc.rect(0, H - 11, W, 11, "F");
      doc.setDrawColor(...GRAY_LT);
      doc.setLineWidth(0.2);
      doc.line(0, H - 11, W, H - 11);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...NAVY);
      doc.text("KONSOLIDATOR", 12, H - 4);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      const ctr = `${spec.name} · ${monthLabel} ${year} · ${source}${compareMode ? `  vs.  ${cmpMoLabel} ${cmpYear}` : ""}`;
      doc.text(ctr, W / 2, H - 4, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY);
      doc.text(`p. ${doc.internal.getCurrentPageInfo().pageNumber}`, W - 12, H - 4, { align: "right" });
    };

// Build columns for a subset of companies (a "part")
    // Widths are computed to sum exactly to usableW — no empty space on the right.
    const buildColumnsForPart = (spec, visCoPart, journalsHere) => {
      // Ideal proportions (not mm) — they get normalized to fill usableW.
      const propAccount = 4.5;       // wide for account names + indentation
      const propParent  = perspectiveMode ? 2.2 : 0;
      const propA       = 1.6;
      const propPct     = perspectiveMode ? 1.0 : 0;
      const propCmp     = compareMode ? 1.5 : 0;
      const propDelta   = compareMode ? 1.3 : 0;
      const propDpct    = compareMode ? 1.1 : 0;
      const propJrn     = journalsHere ? 1.05 : 0;
      const propIc      = journalsHere ? 1.05 : 0;
      const propTotal   = !compareMode ? 1.8 : 0;

      const propsPerCo = propA + propPct + propCmp + propDelta + propDpct
                       + (journalsHere ? propJrn * 6 + propIc : 0);

      const propsTotal = propAccount + propParent + visCoPart.length * propsPerCo + propTotal;
      const unit = usableW / propsTotal;

     const colDefs = [{ header: tt("file_col_account", "Account"), dataKey: "account" }];
      const colStyles = { account: { cellWidth: propAccount * unit, halign: "left" } };

if (perspectiveMode) {
        colDefs.push({ header: `${perspectiveParent}\n${tt("col_consolidated", "Consolidated").toUpperCase()}`, dataKey: "parent" });
        colStyles.parent = { cellWidth: propParent * unit, halign: "right" };
      }

const lblA   = tt("file_col_a", "A");
      const lblCmp = tt("pivot_col_sigma_cmp", "CMP");
      visCoPart.forEach(co => {
        colDefs.push({ header: `${co}\n${lblA}`, dataKey: `act_${co}` });
        colStyles[`act_${co}`] = { cellWidth: propA * unit, halign: "right" };
        if (perspectiveMode) {
          colDefs.push({ header: `${co}\n%`, dataKey: `pct_${co}` });
          colStyles[`pct_${co}`] = { cellWidth: propPct * unit, halign: "right" };
        }
        if (compareMode) {
          colDefs.push({ header: `${co}\n${lblCmp}`, dataKey: `cmp_${co}` });
          colDefs.push({ header: `${co}\nΔ`,         dataKey: `del_${co}` });
          colDefs.push({ header: `${co}\nΔ%`,        dataKey: `dpc_${co}` });
          colStyles[`cmp_${co}`] = { cellWidth: propCmp   * unit, halign: "right" };
          colStyles[`del_${co}`] = { cellWidth: propDelta * unit, halign: "right" };
          colStyles[`dpc_${co}`] = { cellWidth: propDpct  * unit, halign: "right" };
        }
        if (journalsHere) {
          JOURNAL_SUBS.forEach(jk => {
            colDefs.push({ header: `${co}\n${jk}`, dataKey: `${jk}_${co}` });
            colStyles[`${jk}_${co}`] = { cellWidth: (jk === "IC" ? propIc : propJrn) * unit, halign: "right" };
          });
        }
      });

if (!compareMode) {
        colDefs.push({ header: tt("file_col_total", "Total").toUpperCase(), dataKey: "total" });
        colStyles.total = { cellWidth: propTotal * unit, halign: "right" };
      }

      // Track first column of each company for thick border
      const companyStartIdx = new Set();
      let idx = 1 + (perspectiveMode ? 1 : 0);
      visCoPart.forEach((_, i) => {
        if (i > 0) companyStartIdx.add(idx);
        idx += 1 + (perspectiveMode ? 1 : 0) + (compareMode ? 3 : 0) + (journalsHere ? JOURNAL_SUBS.length : 0);
      });
      if (!compareMode) companyStartIdx.add(idx);

      return { colDefs, colStyles, companyStartIdx };
    };

    const buildBodyForPart = (spec, visCoPart, journalsHere) => {
const usePivot = spec.isCF ? cfPivot : pivot;
      const usePivotPrev = spec.isCF ? cfPivotPrev : pivotPrev;
      const useCmpPivot = spec.isCF ? cmpCfPivot : cmpPivot;
      const useDim = spec.isCF ? null : dimIdx;
      const useDimPrev = spec.isCF ? null : dimIdxPrev;
      const useCmpDim = spec.isCF ? null : cmpDimIdx;
      const useCmpDimPrev = spec.isCF ? null : cmpDimIdxPrev;
const rows = [];

      const pushBreaker = (label, color) => {
        rows.push({ _isBreaker: true, _label: String(label).toUpperCase(), _color: color });
      };

      // ALL companies are needed for parentTotal (so % stays consistent across parts)
      const allVisCo = (spec.isCF ? cfCols : cols) ?? [];

const pushNode = ({ code, name, depth, isSum, dims, getVal, getCmp, getJp, getIc }) => {
        // Summarised report: when drill-down is off, only emit top-level (depth 0) rows.
        if (!drilldownOpt && depth > 0) return;
        const indent = "  ".repeat(Math.min(depth, 6));
        const resolvedName = (String(name ?? "").trim()) ||
                              (spec.isCF ? (cfNameLookup.get(String(code)) ?? "") : "") ||
                              "—";
        const dimSuffix = Array.isArray(dims) && dims.length > 0
          ? `  [${dims.length === 1 ? dims[0] : dims.length + " dims"}]`
          : "";
        const row = {
          account: `${indent}${code ? code + "  " : ""}${resolvedName}${dimSuffix}`,
          _depth: depth,
          _isSum: !!isSum,
        };

        // parentTotal is the sum across ALL companies (not just this part)
        let parentTotal = 0;
        if (perspectiveMode) {
          parentTotal = allVisCo.reduce((s, co) => s + getVal(co), 0);
          row.parent = fmtN(parentTotal);
        }

        // rowTotal across companies in THIS part
        let rowTotal = 0;
        visCoPart.forEach(co => {
          const a = getVal(co);
          rowTotal += a;
          row[`act_${co}`] = fmtN(a);
          if (perspectiveMode) {
            const pct = parentTotal !== 0 ? (a / parentTotal) * 100 : null;
            row[`pct_${co}`] = fmtP(pct);
          }
          if (compareMode) {
            const b = getCmp(co);
            const delta = a - b;
            const deltaPct = Math.abs(b) > 1e-9 ? ((a - b) / Math.abs(b)) * 100 : null;
            row[`cmp_${co}`] = fmtN(b);
          row[`del_${co}`] = (delta == null || Math.abs(delta) < 0.005) ? "—" : (delta > 0 ? "+" : "") + fmtN(Math.abs(delta) === delta ? delta : delta);
            row[`dpc_${co}`] = deltaPct == null ? "—" : (deltaPct > 0 ? "+" : "") + deltaPct.toFixed(1) + "%";
          }
          if (journalsHere) {
            const jp = getJp ? getJp(co) : {};
            const journalsTotal = ["AJE", "RJE", "EJE", "SYS", "CFA"].reduce((s, k) => s + (Number(jp[k]) || 0), 0);
            row[`Up_${co}`]  = fmtN(Object.prototype.hasOwnProperty.call(jp, "Uploaded") ? Number(jp.Uploaded) || 0 : a - journalsTotal);
            row[`AJE_${co}`] = fmtN(jp.AJE ?? 0);
            row[`RJE_${co}`] = fmtN(jp.RJE ?? 0);
            row[`EJE_${co}`] = fmtN(jp.EJE ?? 0);
            row[`SYS_${co}`] = fmtN(jp.SYS ?? 0);
            row[`CFA_${co}`] = fmtN(jp.CFA ?? 0);
            row[`IC_${co}`]  = fmtN(getIc ? getIc(co) : 0);
          }
        });

        if (!compareMode) row.total = fmtN(rowTotal);
        rows.push(row);
      };

if (spec.isCF && !spec.isCombined && !(activeMappings?.cf?.treeLiteral?.length > 0 && activeMappings.cf.name !== "__custom_override__" && activeMappings.cf.name !== "__todos_synthetic__") && (cfTree && cfTree.length > 0)) {
        // CF sheet without a user mapping: flat cfTree + breakers from cf literal.
        writeCfFlatPdf();
      } else if (spec.literal && spec.literal.length > 0) {
        // LITERAL MODE — walk this sheet's own literal (custom accts + breakers)
        spec.literal.forEach(section => {
          if (section.label) pushBreaker(section.label, section.color || "#1a2f8a");
          const renderNode = (node, depth) => {
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const isSum = !!node.isSum && hasChildren;
            const getVal = (co) => {
              const curr = computeLiteralForCompany(node, usePivot, co, "object", useDim);
              if (ytdOnly || spec.isCF) return curr;
              const stmt = section._stmt ?? codeToStatementFromStd.get(String(node.code)) ?? spec.types[0] ?? "";
              const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
              if (!isPL) return curr;
              const prev = computeLiteralForCompany(node, usePivotPrev, co, "object", useDimPrev);
              return curr - prev;
            };
            const getCmp = (co) => {
              if (!compareMode) return 0;
              const cmpCurr = computeLiteralForCompany(node, useCmpPivot, co, "scalar", useCmpDim);
              if (ytdOnly || spec.isCF) return cmpCurr;
              const stmt = section._stmt ?? codeToStatementFromStd.get(String(node.code)) ?? spec.types[0] ?? "";
              const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
              if (!isPL) return cmpCurr;
              const cmpPrev = computeLiteralForCompany(node, cmpPivotPrev, co, "scalar", useCmpDimPrev);
              return cmpCurr - cmpPrev;
            };
            const getJp  = (co) => spec.isCF ? {} : computeLiteralJournalForCompany(node, journalPivot, co, null);
            const getIc  = (co) => spec.isCF ? 0  : computeLiteralCounterpartyForCompany(node, counterpartyPivot, co, null);
            pushNode({ code: node.code, name: node.name, depth, isSum, dims: node.dims, getVal, getCmp, getJp, getIc });
            if (hasChildren) node.children.forEach(c => renderNode(c, depth + 1));
          };
(section.nodes || []).forEach(n => renderNode(n, 0));
        });
        // Combined "Todos": append CF flat (standard override) below PL+BS.
        if (spec.isCombined && cfTree && cfTree.length > 0) writeCfFlatPdf();
} else {
        // Mirror the on-screen render, same as the Excel STANDARD path: values roll up
        // children via computeLiteralForCompany, breakers come from codeToSectionInfo,
        // and _noExpand grand totals (CF.D1s) render as a single loose row.
        const useTree = spec.isCF ? (cfTree || []) : (tree || []);
        const filtered = useTree.filter(n => spec.types.includes(n.AccountType ?? n.accountType ?? ""));
const findSectionOfSubtree = (node) => {
          const stack = [node];
          while (stack.length) {
            const n = stack.pop();
            const info = codeToSectionInfo.get(String(n.AccountCode));
            if (info?.section) return info;
            const children = n.children || [];
            for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]);
          }
          return null;
        };
        const seenSecStd = new Set();
        const asLit = (node) => ({
          code: node.AccountCode,
          isSum: (node.children?.length > 0),
          dims: node.dims ?? null,
          children: (node.children || []).map(asLit),
        });
        const stmtOf = (node) => codeToStatementFromStd.get(String(node.AccountCode))
          ?? node.AccountType ?? node.accountType ?? spec.types[0] ?? "";
        const walk = (node, depth) => {
          const code = node.AccountCode;
          const hasChildren = node.children?.length > 0;
          const isSum = /\.S$/i.test(String(code)) || hasChildren;
          const litNode = asLit(node);
if (depth === 0) {
            const info = findSectionOfSubtree(node);
            if (info?.section && !seenSecStd.has(info.section)) {
              seenSecStd.add(info.section);
              pushBreaker(info.label ?? info.section, info.color || "#1a2f8a");
            }
          }
          const getVal = (co) => {
            const curr = computeLiteralForCompany(litNode, usePivot, co, "object", spec.isCF ? null : dimIdx);
            if (ytdOnly || spec.isCF) return curr;
            const stmt = stmtOf(node);
            const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
            if (!isPL) return curr;
            const prev = computeLiteralForCompany(litNode, usePivotPrev, co, "object", spec.isCF ? null : dimIdxPrev);
            return curr - prev;
          };
          const getCmp = (co) => {
            if (!compareMode) return 0;
            const cmpCurr = computeLiteralForCompany(litNode, useCmpPivot, co, "scalar", spec.isCF ? null : cmpDimIdx);
            if (ytdOnly || spec.isCF) return cmpCurr;
            const stmt = stmtOf(node);
            const isPL = stmt === "P/L" || stmt === "DIS" || stmt === "PL";
            if (!isPL) return cmpCurr;
            const cmpPrev = computeLiteralForCompany(litNode, cmpPivotPrev, co, "scalar", spec.isCF ? null : cmpDimIdxPrev);
            return cmpCurr - cmpPrev;
          };
          const getJp  = (co) => spec.isCF ? {} : computeLiteralJournalForCompany(litNode, journalPivot, co, null);
          const getIc  = (co) => spec.isCF ? 0  : computeLiteralCounterpartyForCompany(litNode, counterpartyPivot, co, null);
          pushNode({ code, name: node.AccountName ?? node.accountName ?? "", depth, isSum, dims: node.dims ?? null, getVal, getCmp, getJp, getIc });
          if (!node._noExpand) (node.children || []).forEach(c => walk(c, depth + 1));
        };
        filtered.forEach(n => walk(n, 0));
        if (spec.isCombined && cfTree && cfTree.length > 0) writeCfFlatPdf();
      }
      return rows;

      // CF flat for PDF: cfTree flat + breakers from cf literal, with rollup.
      function writeCfFlatPdf() {
        const seen = new Set();
        const codeToCfSection = new Map();
        ((spec.isCombined ? overrideLiteralCf : activeMappings?.cf?.treeLiteral) || []).forEach(sec => {
          if (!sec.label) return;
          const info = { section: sec.label, label: sec.label, color: sec.color };
          const mark = (n) => { codeToCfSection.set(String(n.code ?? n.AccountCode), info); (n.children || []).forEach(mark); };
          (sec.nodes || []).forEach(mark);
        });
const sectionOf = (node) => {
          const stack = [node];
          while (stack.length) {
            const n = stack.pop();
            const info = codeToCfSection.get(String(n.AccountCode))
              ?? (codeToSectionInfo.get(String(n.AccountCode))?.section
                    ? { section: codeToSectionInfo.get(String(n.AccountCode)).section,
                        label: codeToSectionInfo.get(String(n.AccountCode)).label,
                        color: codeToSectionInfo.get(String(n.AccountCode)).color }
                    : null);
            if (info?.section) return info;
            const ch = n.children || [];
            for (let k = ch.length - 1; k >= 0; k--) stack.push(ch[k]);
          }
          return null;
        };
        const walkCf = (node, depth) => {
          const code = node.AccountCode;
          const hasChildren = node.children?.length > 0;
          const isSum = /\.S$/i.test(code) || hasChildren;
          const getVal = (co) => {
            if (hasChildren) { let sum = 0; const w = (n) => { const ch = n.children || []; if (ch.length) ch.forEach(w); else sum += Number(cfPivot.get(n.AccountCode)?.[co]?.total ?? 0); }; w(node); return sum; }
            return Number(cfPivot.get(code)?.[co]?.total ?? 0);
          };
          const getCmp = (co) => {
            if (!compareMode) return 0;
            if (hasChildren) { let sum = 0; const w = (n) => { const ch = n.children || []; if (ch.length) ch.forEach(w); else sum += Number(cmpCfPivot?.get(n.AccountCode)?.[co] ?? 0); }; w(node); return sum; }
            return Number(cmpCfPivot?.get(code)?.[co] ?? 0);
          };
pushNode({ code, name: node.AccountName ?? node.accountName ?? cfNameLookup.get(String(code)) ?? code, depth, isSum, getVal, getCmp, getJp: () => ({}), getIc: () => 0 });
          if (hasChildren && !node._noExpand) node.children.forEach(c => walkCf(c, depth + 1));
        };
        (cfTree || []).forEach(node => {
          const info = sectionOf(node);
          if (info && !seen.has(info.section)) { seen.add(info.section); pushBreaker(info.label, info.color || "#1a2f8a"); }
          walkCf(node, 0);
        });
      }
    };

    // ─── For each sheet, paginate companies ────────────────────────────
sheetSpecsToRender.forEach((spec) => {
      const visCo = (spec.isCF ? cfCols : cols) ?? [];
      if (visCo.length === 0) return;

      const journalsHere = showJournals && !spec.isCF;
      const perCoW = computeCompanyWidth(journalsHere);
      const totalAvail = availableForCompanies(!compareMode ? COL_W.total : 0);
      let maxCompaniesPerPage = Math.max(1, Math.floor(totalAvail / perCoW));
      // Hard cap so account names aren't squeezed
      maxCompaniesPerPage = Math.min(maxCompaniesPerPage, journalsHere ? 2 : (compareMode ? 3 : 6));

      const parts = [];
      for (let i = 0; i < visCo.length; i += maxCompaniesPerPage) {
        parts.push(visCo.slice(i, i + maxCompaniesPerPage));
      }
      const totalParts = parts.length;

parts.forEach((visCoPart, partIdx) => {
        const { startY, badges } = drawPageHeader(spec, partIdx, totalParts);
        const partStartPage = doc.internal.getNumberOfPages();

        const { colDefs, colStyles, companyStartIdx } = buildColumnsForPart(spec, visCoPart, journalsHere);
        const body = buildBodyForPart(spec, visCoPart, journalsHere);

        // Count actual data rows (excludes breakers)
        const dataRowCount = body.filter(r => !r._isBreaker).length;
        const sectionCount = body.filter(r => r._isBreaker).length;

        // Record TOC entry — we'll fill pageEnd after autoTable finishes
const companiesLbl = visCoPart.length === 1
          ? tt("kpi_company_singular", "company")
          : tt("kpi_company_plural", "companies");
        const partOfTxt = totalParts > 1
          ? `${tt("badge_part", "Part")} ${partIdx + 1} ${tt("am_matching_count_of", "of")} ${totalParts}  ·  ${visCoPart.length} ${companiesLbl}: ${visCoPart.join(", ")}`
          : `${visCoPart.length} ${companiesLbl}: ${visCoPart.join(", ")}`;
        const rowsLbl = tt("table_rows", "rows");
        const sectionsLbl = tt("table_sections", "sections");
        const mappedSuffix = spec.isMapped ? ` (${tt("badge_mapped", "Mapped")})` : "";
        const tocEntry = {
          pageStart: partStartPage,
          pageEnd: partStartPage, // updated below
          title: spec.name + mappedSuffix,
          subtitle: partOfTxt
            + `  ·  ${dataRowCount} ${rowsLbl}`
            + (sectionCount > 0 ? `  ·  ${sectionCount} ${sectionsLbl}` : ""),
          badges,
        };
        pageManifest.push(tocEntry);

        const bodyFont = 9;
        const headFont = 8;

        autoTable(doc, {
          startY,
          columns: colDefs,
          body: body.map(r => {
            if (r._isBreaker) {
              const cells = {};
              cells.account = {
                content: r._label,
                colSpan: colDefs.length,
                _breakerColor: r._color,
              };
              return cells;
            }
            return r;
          }),
margin: { left: 8, right: 8, bottom: 14 },
          tableWidth: usableW,
          styles: {
            fontSize:    bodyFont,
            cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
            overflow:    "linebreak", // wrap long content onto multiple lines instead of ...
            lineColor:   GRAY_LT,
            lineWidth:   0.1,
            font:        "helvetica",
            textColor:   [31, 41, 55],
            valign:      "middle",
          },
          headStyles: {
            fillColor:   NAVY,
            textColor:   WHITE,
            fontStyle:   "bold",
            fontSize:    headFont,
            cellPadding: { top: 3.5, bottom: 3.5, left: 2, right: 2 },
            valign:      "middle",
            halign:      "center",
          },
          columnStyles: colStyles,
          alternateRowStyles: { fillColor: STRIPE },
          didParseCell: (data) => {
            const key = data.column.dataKey;

            if (data.section === "head") {
              if (key === "parent")              { data.cell.styles.fillColor = NAVY_DK; }
              else if (key.startsWith("pct_"))   { data.cell.styles.fillColor = NAVY_LT; }
              else if (key.startsWith("cmp_"))   { data.cell.styles.fillColor = ROSE_DK; data.cell.styles.textColor = AMBER; }
              else if (key.startsWith("del_") ||
                       key.startsWith("dpc_"))   { data.cell.styles.fillColor = NAVY_DK; data.cell.styles.textColor = AMBER; }
              else if (key.startsWith("Up_"))    { data.cell.styles.fillColor = [60, 80, 160]; }
              else if (key.startsWith("AJE_") ||
                       key.startsWith("RJE_") ||
                       key.startsWith("EJE_") ||
                       key.startsWith("SYS_") ||
                       key.startsWith("CFA_"))   { data.cell.styles.fillColor = [50, 70, 150]; }
              else if (key.startsWith("IC_"))    { data.cell.styles.fillColor = ROSE; }
              else if (key === "total")          { data.cell.styles.fillColor = NAVY_DK; }
              data.cell.styles.halign = key === "account" ? "left" : "center";
              return;
            }

            const r = data.row.raw;
            if (!r) return;

            if (r._isBreaker || (data.cell.raw && data.cell.raw._breakerColor)) {
              const color = data.cell.raw?._breakerColor ?? r._color ?? "#1a2f8a";
              data.cell.styles.fillColor = hexToRgb(color);
              data.cell.styles.textColor = WHITE;
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.fontSize  = bodyFont + 1;
              data.cell.styles.halign    = "left";
              data.cell.styles.cellPadding = { top: 3, bottom: 3, left: 3.5, right: 3.5 };
              return;
            }

            const isSum = r._isSum;
            const depth = r._depth ?? 0;
            if (isSum || depth === 0) {
              data.cell.styles.fillColor = LIGHT;
              data.cell.styles.fontStyle = "bold";
              if (key === "account") data.cell.styles.textColor = NAVY;
            }
            const txt = data.cell.text[0];
            const isZero = txt === "—" || txt === "";
            const isNeg  = typeof txt === "string" && (txt.startsWith("-") || txt.startsWith("("));

            if (key === "parent") {
              data.cell.styles.fillColor = LIGHT;
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.textColor = isZero ? GRAY : (isNeg ? RED : NAVY);
            } else if (key.startsWith("pct_")) {
              if (!(isSum || depth === 0)) data.cell.styles.fillColor = STRIPE;
              data.cell.styles.textColor = isZero ? GRAY : INDIGO;
            } else if (key.startsWith("del_") || key.startsWith("dpc_")) {
              data.cell.styles.textColor = isZero ? GRAY : (txt.startsWith("+") ? GREEN : RED);
            } else if (key.startsWith("cmp_")) {
              data.cell.styles.textColor = isSum ? [161, 130, 40] : [180, 150, 60];
              data.cell.styles.fillColor = isSum ? [253, 246, 200] : [255, 251, 235];
            } else if (key.startsWith("Up_") || key.startsWith("AJE_") || key.startsWith("RJE_") ||
                       key.startsWith("EJE_") || key.startsWith("SYS_") || key.startsWith("CFA_")) {
              data.cell.styles.fillColor = isSum ? [220, 228, 245] : [240, 244, 252];
              data.cell.styles.textColor = isZero ? GRAY : (isNeg ? RED : [40, 60, 130]);
            } else if (key.startsWith("IC_")) {
              data.cell.styles.fillColor = [254, 240, 244];
              data.cell.styles.textColor = isZero ? GRAY : (isNeg ? RED : ROSE);
            } else if (key.startsWith("act_") || key === "total") {
              if (isZero) data.cell.styles.textColor = [200, 200, 200];
              else if (isNeg) data.cell.styles.textColor = RED;
            }
          },
          didDrawCell: (data) => {
            if (companyStartIdx.has(data.column.index)) {
              const { x, y, height } = data.cell;
              doc.setDrawColor(...NAVY_DK);
              doc.setLineWidth(0.8);
              doc.line(x, y, x, y + height);
            }
          },
didDrawPage: () => drawFooter(spec),
        });

        // Update TOC entry with the final page count for this part
        tocEntry.pageEnd = doc.internal.getNumberOfPages();
      });
    });

    // ─── Fill TOC (page 1) — multi-line entries with full info ──────────
    doc.setPage(1);
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 62, "F");
    doc.setFillColor(...ROSE);
    doc.rect(0, 0, 5, 62, "F");
doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...WHITE);
    doc.text(`${tt("contrib_label", "Contribution").toUpperCase()} ${tt("export_financial_report", "Report").toUpperCase()}`, 14, 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(180, 200, 255);
const titleSub = [`${monthLabel} ${year}`];
    if (source)    titleSub.push(`${tt("file_field_source", "Source")}: ${source}`);
    if (structure) titleSub.push(`${tt("file_field_structure", "Structure")}: ${structure}`);
    if (perspectiveMode) titleSub.push(`${tt("filter_perspective", "Perspective")}: ${perspectiveLegal}`);
    doc.text(titleSub.join("  ·  "), 14, 38);
    doc.setFontSize(10);
    doc.setTextColor(160, 180, 230);
const mods = [];
    mods.push(compareMode ? tt("export_compare_mode_on", "compare mode on") : tt("file_single_period", "single period"));
    if (activeMapping) mods.push(`${tt("export_mapping_applied", "mapping applied")}: ${activeMapping.name} (${activeMapping.standard ?? tt("am_filter_custom", "Custom")})`);
    if (showJournals) mods.push(tt("export_journal_breakdown", "journal breakdown included"));
    if (compareMode && cmpYear && cmpMonth) mods.push(`${tt("export_compared_to", "compared to")} ${cmpMoLabel} ${cmpYear}`);
    mods.push(`${tt("file_generated", "Generated").toLowerCase()} ${new Date().toLocaleString()}`);
    const pageCount = doc.internal.getNumberOfPages() - 1;
    mods.push(`${pageCount} ${pageCount === 1 ? tt("file_content_page_one", "content page") : tt("file_content_page_many", "content pages")}`);
    doc.text(mods.join("  ·  "), 14, 48);

    // CONTENTS heading
doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...NAVY);
    doc.text(tt("file_contents", "Contents").toUpperCase(), 14, 78);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.6);
    doc.line(14, 80, W - 14, 80);

    // Entries
    let yEntry = 90;
    const entryH = 16;
    const tocBottom = H - 18;

    pageManifest.forEach((m, idx) => {
      if (yEntry + entryH > tocBottom) return;

      // Row background
      if (idx % 2 === 1) {
        doc.setFillColor(245, 247, 252);
        doc.rect(12, yEntry - 5, W - 24, entryH, "F");
      }

// Title (line 1)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text(m.title, 16, yEntry);

      // Page range on the right
      const numText = m.pageEnd > m.pageStart
        ? `${m.pageStart}–${m.pageEnd}`
        : String(m.pageStart);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text(numText, W - 16, yEntry, { align: "right" });

      // Dotted leader between
      doc.setFont("helvetica", "normal");
      const titleW = doc.getTextWidth(m.title);
      const numW = doc.getTextWidth(numText);
      const dotW = doc.getTextWidth(". ");
      const dotStart = 16 + titleW + 4;
      const dotEnd = W - 16 - numW - 4;
      const dotCount = Math.max(0, Math.floor((dotEnd - dotStart) / dotW));
      doc.setTextColor(...GRAY_LT);
      doc.text(". ".repeat(dotCount), dotStart, yEntry);

      // Subtitle (line 2) — companies, part info
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...GRAY);
      doc.text(m.subtitle, 16, yEntry + 5);

      // Badges (line 3 - small chips)
      if (m.badges && m.badges.length > 0) {
        let bx = 16;
        m.badges.forEach(b => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6.5);
          const tw = doc.getTextWidth(b);
          const bw = tw + 4;
          doc.setFillColor(220, 228, 245);
          doc.roundedRect(bx, yEntry + 7.5, bw, 4.5, 0.8, 0.8, "F");
          doc.setTextColor(...NAVY);
          doc.text(b, bx + 2, yEntry + 10.7);
          bx += bw + 2;
        });
      }

      yEntry += entryH;
    });

    // TOC footer
    doc.setFillColor(...LIGHT);
    doc.rect(0, H - 11, W, 11, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text("KONSOLIDATOR", 12, H - 4);
doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(`${tt("contrib_label", "Contribution")} · ${monthLabel} ${year}`, W / 2, H - 4, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("p. 1", W - 12, H - 4, { align: "right" });

    const tabSuffix = typeFilter ? `_${typeFilter.replace("/", "")}` : "";
    doc.save(`Konsolidator_Contributive${tabSuffix}_${year}_${String(month).padStart(2, "0")}.pdf`);
  }

// Wait for a global to appear (polling) — handles bundles that initialize async
const waitForGlobal = (key, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window[key]) { resolve(window[key]); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`Global window.${key} never appeared`)); return; }
      setTimeout(check, 30);
    };
    check();
  });

const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });

// Clear any stale tags from prior failed loads
  document.querySelectorAll('script[src*="jspdf"]').forEach(s => s.remove());
  if (window.jspdf) { try { delete window.jspdf; } catch { window.jspdf = undefined; } }

load("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js")
    .then(() => waitForGlobal("jspdf"))
.then(() => {
      return load("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js");
    })
    .then(() => {
      const jspdfNs = window.jspdf;
      if (!jspdfNs) throw new Error("window.jspdf is undefined after script load");
      const { jsPDF } = jspdfNs;
      if (!jsPDF) throw new Error("jsPDF constructor missing on window.jspdf");
      const probe = new jsPDF();

      let at;
      if (typeof probe.autoTable === "function") {
        at = (d, o) => d.autoTable(o);
      } else if (typeof jsPDF.API?.autoTable === "function") {
        at = (d, o) => jsPDF.API.autoTable.call(d, o);
      } else if (typeof jspdfNs.autoTable === "function") {
        at = (d, o) => jspdfNs.autoTable(d, o);
      } else {
        console.error("FULL window.jspdf:", jspdfNs);
        console.error("FULL jsPDF.API:", jsPDF.API);
        throw new Error("autoTable plugin failed to register");
      }
      doGenerate(jsPDF, at);
    })
.catch(e => {
      console.error("[pdf] full error:", e);
      alert("Could not load PDF library: " + (e?.message || String(e) || "unknown error"));
    });
}
