/* ══════════════════════════════════════════════════════════════════════
   Sábana de consolidación — exportación a Excel y PDF.
   ══════════════════════════════════════════════════════════════════════ */

/* ─── Repair pass — strip values Excel rejects (Infinity / NaN, outline
   levels > 7, malformed ARGB, etc.). Runs on the buffer right before save. */
async function repairSheetXlsx(buffer) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    wb.eachSheet(ws => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (row.outlineLevel && row.outlineLevel > 7) row.outlineLevel = 7;
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value;
          if (typeof v === "number" && (!Number.isFinite(v) || Number.isNaN(v))) {
            cell.value = null;
          }
        });
      });
      ws.columns.forEach(col => {
        if (col && col.outlineLevel && col.outlineLevel > 7) col.outlineLevel = 7;
      });
    });
    return await wb.xlsx.writeBuffer();
  } catch {
    return buffer;
  }
}

/* ─── Excel export ────────────────────────────────────────────────────────
   Native Excel drill-down vertically (rows) AND horizontally (columns):
   - Account rows are outlined by depth so users can collapse parents.
   - Per-JournalHeader elim columns are grouped so the whole eliminations
     breakdown collapses to a single column.
   - Both groups start collapsed for a clean initial view. */
/**
 * Build a single worksheet given a pre-filtered tree + view name. Called once
 * per requested view ("All" / "P/L" / "B/S") from the multi-sheet entry point
 * below.
 */
async function buildSheetWorksheet(wb, ExcelJS, params) {
const {
    sheetName, viewLabel,
    tree, pivot, elimPivot, elimHeaders,
    effectiveCompanies, topParent,
    getLegal, isRootView, displayCurrency,
    source, structure, year, monthLabel,
compareMode, cmpPivot, cmpPivotPrev, cmpYear, cmpMonth, cmpMoLabel,
pivotPrev = null, ytdOnly = true,
rowMatchesDims = null,
    getRowAmount = null,
activeMapping, mappingDerived, colors,
    perspectiveLegal,
    drillDown, elimDetail,
    isCustomStd = false,
  } = params;
const ws = wb.addWorksheet(sheetName);

  // ── Brand palette in ARGB. Derived from app colors so the workbook
  //    visually matches the on-screen sheet. ───────────────────────────────
  const toArgb = (hex, fallback = "1A2F8A") => {
    const h = String(hex || "").replace("#", "").toUpperCase();
    return "FF" + (h.length === 6 ? h : fallback.toUpperCase());
  };
  const PRIMARY      = toArgb(colors?.primary, "1A2F8A");      // Navy blue
  const PRIMARY_DARK = "FF0F1F5C";                             // Pressed/darker
  const PRIMARY_SOFT = "FFE8ECFB";                             // Very light primary tint
  const ACCENT       = "FFCF305D";                             // Rose/pink
  const ACCENT_SOFT  = "FFFCE7EE";                             // Very light rose tint
  const GREY_DEEP    = "FF1F2937";                             // Body text
  const GREY_MID     = "FF6B7280";                             // Secondary text
  const GREY_BORDER  = "FFE5E7EB";                             // Lines
  const BAND_A       = "FFFFFFFF";                             // Row band 1
  const BAND_B       = "FFFAFBFE";                             // Row band 2 (very subtle)
  const PARENT_ROW   = "FFF1F4FC";                             // Top-level parent row
  const HEADER_BG    = "FFF6F8FF";                             // Header background
  const WHITE        = "FFFFFFFF";
  const NEG_RED      = "FFEF4444";
  const POS_GREEN    = "FF10B981";

// ── Compute totals per row (mirrors SheetRow math EXACTLY) ───────────────
  // Build code → node and code → leaf codes from the export tree, so SUM rows
  // roll up their descendants' leaves (same as the on-screen rollupCodes).
  const nodeByCode = new Map();
  const codeTypeMap = new Map();
  {
    const walkNodes = (ns) => (ns || []).forEach(n => {
      if (n.AccountCode) { nodeByCode.set(n.AccountCode, n); codeTypeMap.set(n.AccountCode, n.AccountType); }
      walkNodes(n.children);
    });
    walkNodes(tree);
  }
  const collectLeafCodes = (n) => {
    if (!n) return [];
    if (n.children && n.children.length > 0) {
      const out = [];
      n.children.forEach(c => out.push(...collectLeafCodes(c)));
      return out;
    }
    return [n.AccountCode];
  };
  const leafCodesFor = (code) => {
    const n = nodeByCode.get(code);
    if (!n) return [code];
    return (n.children && n.children.length > 0) ? collectLeafCodes(n) : [code];
  };
let curNodeDims = null; // set per row before the value helpers run
  const dimOk = (r) => {
    if (!curNodeDims || curNodeDims.length === 0) return true;
    if (typeof rowMatchesDims !== "function") return true;
    return rowMatchesDims(r, curNodeDims);
  };
const amt = (r) => -(typeof getRowAmount === "function" ? Number(getRowAmount(r) || 0) : Number(r.AmountYTD ?? 0));
  const getConsTotal = (code, p) => leafCodesFor(code).reduce((acc, leaf) => {
    const byCo = p?.get(leaf) || {};
    return acc + (byCo[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .filter(dimOk)
      .reduce((s, r) => s + amt(r), 0);
  }, 0);
  const getContrib = (code, company, p) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return leafCodesFor(code).reduce((acc, leaf) => {
      const byCo = p?.get(leaf) || {};
      return acc + (byCo[company] ?? [])
        .filter(r => r.CompanyRole === role)
        .filter(dimOk)
        .reduce((s, r) => s + amt(r), 0);
    }, 0);
  };

  const isPLCode = (code) => {
    const t = codeTypeMap.get(code) ?? "";
    return t === "P/L" || t === "DIS";
  };
const consVal = (code, p, pPrev) => {
    const curr = getConsTotal(code, p);
    // Guard: empty current pivot → no (0 − prevYTD) phantom negatives.
    if (ytdOnly || !pPrev || !isPLCode(code) || !p || p.size === 0) return curr;
    return curr - getConsTotal(code, pPrev);
  };
  const contribVal = (code, company, p, pPrev) => {
    const curr = getContrib(code, company, p);
    if (ytdOnly || !pPrev || !isPLCode(code) || !p || p.size === 0) return curr;
    return curr - getContrib(code, company, pPrev);
  };
  const contribSumVal = (code, p, pPrev) =>
    effectiveCompanies.reduce((s, c) => s + contribVal(code, c, p, pPrev), 0);
  const cons  = (code) => consVal(code, pivot, pivotPrev);
  const consC = (code) => consVal(code, cmpPivot, cmpPivotPrev);
  const contrib  = (code, co) => contribVal(code, co, pivot, pivotPrev);
  const contribC = (code, co) => contribVal(code, co, cmpPivot, cmpPivotPrev);
  const contribSumV  = (code) => contribSumVal(code, pivot, pivotPrev);
  const contribSumCV = (code) => contribSumVal(code, cmpPivot, cmpPivotPrev);

// ── Flatten tree, capturing depth for outline levels ─────────────────────
  // When drillDown is OFF, produce a SUMMARISED report: only top-level (depth 0)
  // rows are emitted, so parents show as roll-up totals with no children.
  const flat = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n._breakerOnly || depth === 0 || drillDown) {
        flat.push({ node: n, depth });
      }
      if (n.children?.length && drillDown) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);

  // ── Column layout ────────────────────────────────────────────────────────
  const consCmpCols    = compareMode ? 3 : 0;
  const elimCmpCols    = compareMode ? 3 : 0;
  const contribCmpCols = compareMode ? 3 : 0;
const perCompanyCols = compareMode ? 4 : 1;

  let colCursor = 1;
  const codeCol       = colCursor++;
  const nameCol       = colCursor++;
  const consCol       = colCursor++;
  colCursor += consCmpCols;
  const elimCol       = colCursor++;
  colCursor += elimCmpCols;
const elimSubHeaders = elimDetail ? elimHeaders : [];
  const elimStartSubCol = colCursor;
  colCursor += elimSubHeaders.length;
  const elimEndSubCol = colCursor - 1; // last elim sub col (may be < start if 0 headers)
  const contribCol    = colCursor++;
  colCursor += contribCmpCols;
const companiesStartCol = colCursor;
  const totalCols = companiesStartCol + effectiveCompanies.length * perCompanyCols - 1;

  // Columns that OPEN a section — they get a thicker left divider so the sheet
  // reads as: Consolidated | Eliminations | Contribution | Company1 | Company2…
  const sectionStartCols = new Set([consCol, elimCol, contribCol]);
  for (let i = 0; i < effectiveCompanies.length; i++) {
    sectionStartCols.add(companiesStartCol + i * perCompanyCols);
  }

  // ── Title rows ───────────────────────────────────────────────────────────
// Top row — accent strip
  for (let col = 1; col <= totalCols; col++) {
    ws.getCell(1, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
  }
  ws.getRow(1).height = 4;

// Title block — full Konsolidator-colored band with white text (matches the
  // other pages' export headers) instead of a plain white header.
  ws.mergeCells(2, 1, 2, Math.max(6, totalCols));
  const titleCell = ws.getCell(2, 1);
  titleCell.value = `${isRootView ? "Consolidated" : "Subgroup"} Sheet`;
  titleCell.font = { name: "Calibri", size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 30;
  for (let col = 1; col <= totalCols; col++) {
    ws.getCell(2, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
  }

  ws.mergeCells(3, 1, 3, Math.max(6, totalCols));
  const subTitleCell = ws.getCell(3, 1);
  subTitleCell.value = `${monthLabel} ${year} · ${perspectiveLegal}${displayCurrency ? ` · ${displayCurrency}` : ""}`;
  subTitleCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  subTitleCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(3).height = 18;
  for (let col = 1; col <= totalCols; col++) {
    ws.getCell(3, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
  }

  // Context line (smaller, secondary info) — now includes the export timestamp.
  ws.mergeCells(4, 1, 4, Math.max(6, totalCols));
  const subParts = [];
  if (source) subParts.push(`Source: ${source}`);
  if (structure) subParts.push(`Structure: ${structure}`);
  if (activeMapping) subParts.push(`Mapping: ${activeMapping.name}`);
if (viewLabel) subParts.push(`View: ${viewLabel}`);
  if (compareMode && cmpYear && cmpMonth) subParts.push(`vs ${cmpMoLabel} ${cmpYear}`);
  subParts.push(`Exportado: ${new Date().toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`);
  ws.getCell(4, 1).value = subParts.join("  ·  ");
  ws.getCell(4, 1).font = { name: "Calibri", size: 9, color: { argb: GREY_MID }, italic: true };
  ws.getCell(4, 1).alignment = { vertical: "middle", indent: 1 };
  ws.getRow(4).height = 16;
  ws.getRow(5).height = 8; // spacer

// ── Section band (row 6) ─────────────────────────────────────────────────
  const bandRow = 6;
  const band = (col, span, label, fill) => {
    if (span <= 0) return;
    ws.mergeCells(bandRow, col, bandRow, col + span - 1);
    const c = ws.getCell(bandRow, col);
    c.value = label;
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.font = { name: "Calibri", size: 9, bold: true, color: { argb: WHITE } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.border = {
      top:    { style: "thin", color: { argb: PRIMARY_DARK } },
      bottom: { style: "thin", color: { argb: PRIMARY_DARK } },
    };
  };
  band(codeCol, 2, "ACCOUNT", PRIMARY);
  band(consCol, 1 + consCmpCols, isRootView ? "CONSOLIDATED" : "SUBGROUP", PRIMARY);
band(elimCol, 1 + elimCmpCols + elimSubHeaders.length, "ELIMINATIONS", PRIMARY_DARK);
  band(contribCol, 1 + contribCmpCols, "CONTRIBUTION SUM", "FF4B5563");
  if (effectiveCompanies.length > 0) {
    band(companiesStartCol, effectiveCompanies.length * perCompanyCols, "PER-COMPANY CONTRIBUTIONS", ACCENT);
  }
  ws.getRow(bandRow).height = 20;

  // ── Detailed header (row 7) ──────────────────────────────────────────────
  const headRow = 7;
  ws.getCell(headRow, codeCol).value = "Code";
  ws.getCell(headRow, nameCol).value = "Account";
  ws.getCell(headRow, consCol).value = getLegal(topParent);
  if (compareMode) {
    ws.getCell(headRow, consCol + 1).value = "CMP";
    ws.getCell(headRow, consCol + 2).value = "Δ";
    ws.getCell(headRow, consCol + 3).value = "Δ%";
  }
  ws.getCell(headRow, elimCol).value = "Elim. Total";
  if (compareMode) {
    ws.getCell(headRow, elimCol + 1).value = "CMP";
    ws.getCell(headRow, elimCol + 2).value = "Δ";
    ws.getCell(headRow, elimCol + 3).value = "Δ%";
  }
elimSubHeaders.forEach((h, i) => {
    ws.getCell(headRow, elimStartSubCol + i).value = h;
  });
  ws.getCell(headRow, contribCol).value = "Contrib. Sum";
  if (compareMode) {
    ws.getCell(headRow, contribCol + 1).value = "CMP";
    ws.getCell(headRow, contribCol + 2).value = "Δ";
    ws.getCell(headRow, contribCol + 3).value = "Δ%";
  }
  effectiveCompanies.forEach((c, i) => {
    const baseCol = companiesStartCol + i * perCompanyCols;
ws.getCell(headRow, baseCol).value = getLegal(c);
    if (compareMode) {
      ws.getCell(headRow, baseCol + 1).value = "CMP";
      ws.getCell(headRow, baseCol + 2).value = "Δ";
      ws.getCell(headRow, baseCol + 3).value = "Δ%";
    }
});

for (let col = 1; col <= totalCols; col++) {
    const c = ws.getCell(headRow, col);
    c.font = { name: "Calibri", size: 9, bold: true, color: { argb: PRIMARY } };
    c.alignment = { horizontal: col <= nameCol ? "left" : "center", vertical: "middle", wrapText: true, indent: col <= nameCol ? 1 : 0 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = {
      top:    { style: "thin", color: { argb: GREY_BORDER } },
      bottom: { style: "medium", color: { argb: PRIMARY } },
      left:   { style: "thin", color: { argb: GREY_BORDER } },
      right:  { style: "thin", color: { argb: GREY_BORDER } },
    };
  }
  ws.getRow(headRow).height = 36;
  ws.getRow(headRow + 1).height = 4; // spacer

  // ── Data rows ────────────────────────────────────────────────────────────
  const DATA_START_ROW = headRow + 2;
  let rowIdx = DATA_START_ROW;

const numBorder = {
    top:    { style: "hair", color: { argb: GREY_BORDER } },
    bottom: { style: "hair", color: { argb: GREY_BORDER } },
    left:   { style: "hair", color: { argb: GREY_BORDER } },
    right:  { style: "hair", color: { argb: GREY_BORDER } },
  };
  // Same as numBorder but with a strong left divider — used on section-start cols.
  const borderFor = (col) => sectionStartCols.has(col)
    ? { ...numBorder, left: { style: "medium", color: { argb: PRIMARY } } }
    : numBorder;

  const writeNum = (row, col, val, isParent) => {
    const cell = ws.getCell(row, col);
const n = Number(val) || 0;
    if (Math.abs(n) < 0.005) {
      cell.value = null;
    } else {
      cell.value = n;
   cell.numFmt = '#,##0.00;[Red](#,##0.00);""';
    }
    cell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    cell.font = {
      name: "Calibri", size: 10,
      bold: !!isParent,
color: { argb: n < 0 ? NEG_RED : GREY_DEEP },
    };
    cell.border = borderFor(col);
  };

  const writeDelta = (row, col, current, compare) => {
    const cell = ws.getCell(row, col);
    const delta = (Number(current) || 0) - (Number(compare) || 0);
if (Math.abs(delta) < 0.005) { cell.value = null; }
else { cell.value = delta; cell.numFmt = '+#,##0.00;-#,##0.00;""'; }
    cell.alignment = { horizontal: "center", vertical: "middle" };
cell.font = { name: "Calibri", size: 10, color: { argb: delta < 0 ? NEG_RED : POS_GREEN } };
    cell.border = borderFor(col);
  };

  const writePct = (row, col, current, compare) => {
    const cell = ws.getCell(row, col);
    const c = Number(compare) || 0;
    if (Math.abs(c) < 1) { cell.value = null; }
    else {
      const pct = ((current - c) / Math.abs(c));
      cell.value = pct;
cell.numFmt = '+0.0%;-0.0%;""';
    }
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: GREY_MID } };
    cell.border = borderFor(col);
  };

// ── Breaker config (matches UI logic) ───────────────────────────────────
  const TYPE_LABELS_EXPORT = {
    "P/L": { label: "PROFIT & LOSS",          color: (colors?.primary || "#1a2f8a") },
    "DIS": { label: "DISTRIBUTION OF RESULT", color: (colors?.primary || "#1a2f8a") },
    "B/S": { label: "BALANCE SHEET",          color: "#CF305D" },
    "C/F": { label: "CASH FLOW",              color: "#374151" },
    "CFS": { label: "CASH FLOW",              color: "#374151" },
  };
  const hexToArgb = (hex) => {
    const h = String(hex || "").replace("#", "");
    return "FF" + (h.length === 6 ? h : "1a2f8a").toUpperCase();
  };
  const mappingBreakers = mappingDerived?.breakers || {};

let prevType = null;
  flat.forEach(({ node, depth }, idx) => {
    const code = node.AccountCode;
    const isParent = !!(node.children && node.children.length > 0);
    const type = node.AccountType ?? "";
    const typeChanged = type !== prevType;
    prevType = type;

// Mapping OR a custom standard owns the structure — no type-change dividers
    // (those would inject stray "Distribution of Result" / "Balance Sheet" bars).
    const structureOwned = !!mappingDerived || isCustomStd;
    const mappingBk = mappingBreakers[code];
    const typeBk = (typeChanged && TYPE_LABELS_EXPORT[type]) ? TYPE_LABELS_EXPORT[type] : null;
    const breaker = structureOwned
      ? (mappingBk ? { label: String(mappingBk.label).toUpperCase(), color: mappingBk.color || "#1a2f8a" } : null)
      : (mappingBk
          ? { label: String(mappingBk.label).toUpperCase(), color: mappingBk.color || "#1a2f8a" }
          : typeBk);

if (breaker) {
      ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
      const bk = ws.getCell(rowIdx, 1);
      bk.value = `  ${breaker.label}`;
      bk.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(breaker.color) } };
      bk.font = { name: "Calibri", size: 10, bold: true, color: { argb: WHITE } };
      bk.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      bk.border = {
        top:    { style: "medium", color: { argb: hexToArgb(breaker.color) } },
        bottom: { style: "medium", color: { argb: hexToArgb(breaker.color) } },
      };
ws.getRow(rowIdx).height = 22;
      // Breakers never get outlineLevel — they stay visible always
      rowIdx++;
    }

    // Placeholder rows only carry a trailing breaker header — no data row.
    if (node._breakerOnly) return;

curNodeDims = node._dims && node._dims.length > 0 ? node._dims : null;
    const consTotal     = cons(code);
    const cmpConsTotal  = compareMode ? consC(code) : 0;
    const contribSumTot = contribSumV(code);
    const cmpContribSum = compareMode ? contribSumCV(code) : 0;
    const elimTotal     = consTotal - contribSumTot;
    const cmpElimTotal  = cmpConsTotal - cmpContribSum;
    const contribSum    = contribSumTot;

// Code + Name. Code col uses small grey monospace-ish. Name col indents
    // by depth so children visually sit under their parents.
    const codeCell = ws.getCell(rowIdx, codeCol);
    codeCell.value = code;
    codeCell.font = { name: "Consolas", size: 9, bold: isParent, color: { argb: GREY_MID } };
    codeCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    codeCell.border = numBorder;

    const nameCell = ws.getCell(rowIdx, nameCol);
    nameCell.value = node.AccountName;
    nameCell.font = {
      name: "Calibri", size: 10,
      bold: isParent,
      color: { argb: isParent ? PRIMARY : GREY_DEEP },
    };
    nameCell.alignment = { horizontal: "left", vertical: "middle", indent: depth };
    nameCell.border = numBorder;

    // Numeric cells
    writeNum(rowIdx, consCol, consTotal, isParent);
    if (compareMode) {
      writeNum(rowIdx, consCol + 1, cmpConsTotal, isParent);
      writeDelta(rowIdx, consCol + 2, consTotal, cmpConsTotal);
      writePct(rowIdx, consCol + 3, consTotal, cmpConsTotal);
    }
    writeNum(rowIdx, elimCol, elimTotal, isParent);
    if (compareMode) {
      writeNum(rowIdx, elimCol + 1, cmpElimTotal, isParent);
      writeDelta(rowIdx, elimCol + 2, elimTotal, cmpElimTotal);
      writePct(rowIdx, elimCol + 3, elimTotal, cmpElimTotal);
    }
const elimBucket = elimPivot.get(code) ?? {};
    elimSubHeaders.forEach((h, i) => {
      writeNum(rowIdx, elimStartSubCol + i, elimBucket[h] ?? 0, isParent);
    });
    writeNum(rowIdx, contribCol, contribSum, isParent);
    if (compareMode) {
      writeNum(rowIdx, contribCol + 1, cmpContribSum, isParent);
      writeDelta(rowIdx, contribCol + 2, contribSum, cmpContribSum);
      writePct(rowIdx, contribCol + 3, contribSum, cmpContribSum);
    }
    effectiveCompanies.forEach((co, i) => {
      const baseCol = companiesStartCol + i * perCompanyCols;
const val = contrib(code, co);
      writeNum(rowIdx, baseCol, val, isParent);
if (compareMode) {
        const cmpVal = contribC(code, co);
        writeNum(rowIdx, baseCol + 1, cmpVal, isParent);
        writeDelta(rowIdx, baseCol + 2, val, cmpVal);
        writePct(rowIdx, baseCol + 3, val, cmpVal);
      }
});

// Row banding: top-level parents get a heavier fill, regular rows get
    // alternating bands so the eye can track across the wide table.
    let rowFill = null;
    if (isParent && depth === 0) {
      rowFill = PARENT_ROW;
    } else {
      rowFill = (idx % 2 === 0) ? BAND_A : BAND_B;
    }
    for (let col = 1; col <= totalCols; col++) {
      const c = ws.getCell(rowIdx, col);
      if (!c.fill) {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      }
    }

// Row-level outline + collapsed initial state (only if drillDown enabled).
    const row = ws.getRow(rowIdx);
    if (drillDown && depth > 0) {
      row.outlineLevel = Math.min(depth, 7);  // Excel caps at 7
      row.hidden = true;
    }
    rowIdx++;
  });

// ── Column-level outline for elim subcolumns ─────────────────────────────
if (elimDetail && elimSubHeaders.length > 0) {
    for (let col = elimStartSubCol; col <= elimEndSubCol; col++) {
      const c = ws.getColumn(col);
      c.outlineLevel = 1;
      c.hidden = true;
    }
  }

  // ── Column widths ────────────────────────────────────────────────────────
  ws.getColumn(codeCol).width = 12;
  ws.getColumn(nameCol).width = 46;
  for (let col = consCol; col <= totalCols; col++) {
    if (col === codeCol || col === nameCol) continue;
    const isSubElim = col >= elimStartSubCol && col <= elimEndSubCol;
   ws.getColumn(col).width = isSubElim ? 18 : 17;
  }

// ── Outline behaviour: summary above (the parent row is ABOVE children) ──
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  // ── Freeze first 2 cols + all header rows (titles + band + detailed header) ──
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: headRow, activeCell: "A1" }];

// (single-sheet build complete — the multi-sheet entry below handles save)
}

/**
 * Multi-sheet entry. Builds one worksheet per requested view (All / P&L / B/S)
 * using filterTreeByType to derive each tab's tree from the shared rawData
 * pivot. The user picks which views via the export modal.
 */
export async function generateSheetXlsxMulti({
  pivot, elimPivot, elimHeaders,
  effectiveCompanies, topParent, rootParent,
  getLegal, isRootView, displayCurrency,
  source, structure, year, month, monthLabel,
compareMode, cmpPivot, cmpPivotPrev, cmpYear, cmpMonth, cmpMoLabel,
pivotPrev = null, ytdOnly = true,
rowMatchesDims = null,
  getRowAmount = null,
activeMapping, mappingDerivedAll, mappingDerivedPL, mappingDerivedBS,
  treeAll, treePL, treeBS,
  colors, perspectiveLegal,
  views,           // ["all", "pl", "bs"] - which sheets to generate
  drillDown, elimDetail,
  isCustomStd = false,
}) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const fileSaver = await import("file-saver");
  const saveAs = fileSaver.saveAs ?? fileSaver.default?.saveAs;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Konsolidator";
  wb.created = new Date();

  const sheetSpecs = [];
  if (views.includes("all")) sheetSpecs.push({ name: "All",         label: "All Accounts",  tree: treeAll, derived: mappingDerivedAll });
  if (views.includes("pl"))  sheetSpecs.push({ name: "P&L",         label: "Profit & Loss", tree: treePL,  derived: mappingDerivedPL  });
  if (views.includes("bs"))  sheetSpecs.push({ name: "Balance Sheet", label: "Balance Sheet", tree: treeBS,  derived: mappingDerivedBS });

  if (sheetSpecs.length === 0) {
    alert("Select at least one sheet to export.");
    return;
  }

  for (const spec of sheetSpecs) {
    await buildSheetWorksheet(wb, ExcelJS, {
      sheetName: spec.name, viewLabel: spec.label,
      tree: spec.tree, pivot, elimPivot, elimHeaders,
      effectiveCompanies, topParent, rootParent,
      getLegal, isRootView, displayCurrency,
      source, structure, year, month, monthLabel,
compareMode, cmpPivot, cmpPivotPrev, cmpYear, cmpMonth, cmpMoLabel,
pivotPrev, ytdOnly,
rowMatchesDims,
      getRowAmount,
activeMapping, mappingDerived: spec.derived, colors,
      perspectiveLegal,
      drillDown, elimDetail,
      isCustomStd,
    });
  }

  const safePerspective = String(perspectiveLegal || "Sheet").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const fileName = `Consolidation_Sheet_${safePerspective}_${year}-${String(month).padStart(2, "0")}.xlsx`;
  let buffer = await wb.xlsx.writeBuffer();
  buffer = await repairSheetXlsx(buffer);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, fileName);
}

/* ─── PDF export — multi-sheet with column chunking for legibility ────────
   Each requested view (All / P&L / B/S) generates its own section. Within a
   section, columns are split across multiple pages so text stays readable:
   page 1 has Consolidated + Eliminations, page 2 has Per-Company breakdowns,
   etc. The Account column is repeated on every page as a frozen reference. */
export async function generateSheetPdf({
  pivot, elimPivot, elimHeaders,
  effectiveCompanies, topParent,
  getLegal, isRootView, displayCurrency,
  source, structure, year, month, monthLabel,
  compareMode, cmpPivot, cmpPivotPrev, cmpYear, cmpMonth, cmpMoLabel,
pivotPrev = null, ytdOnly = true,
rowMatchesDims = null, drillDown = true,
  getRowAmount = null,
  activeMapping,
  treeAll, treePL, treeBS,
  mappingDerivedAll, mappingDerivedPL, mappingDerivedBS,
colors, perspectiveLegal,
  views,
  elimDetail,
  isCustomStd = false,
}) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  // ── Brand palette as RGB tuples (jsPDF format) ─────────────────────────
  const hexToRgb = (hex, fallback = [26, 47, 138]) => {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return fallback;
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };
  const NAVY     = hexToRgb(colors?.primary, [26, 47, 138]);
  const NAVY_DK  = [Math.max(0, NAVY[0]-12), Math.max(0, NAVY[1]-20), Math.max(0, NAVY[2]-40)];
  const ROSE     = [207, 48, 93];
  const ROSE_DK  = [160, 30, 65];
  const GREEN    = [16, 185, 129];
  const RED      = [239, 68, 68];
  const LIGHT    = [238, 241, 251];
  const OFFWHITE = [250, 251, 255];
  const GREY     = [140, 150, 175];
  const GREY_LT  = [210, 215, 230];
  const TEXT_DK  = [20, 35, 80];
  const WHITE    = [255, 255, 255];

  // ── Compute totals (mirrors UI math) ───────────────────────────────────
// ── Compute totals per row (mirrors SheetRow math EXACTLY) ───────────────
  // Build code → node & code → leaf codes from the export tree so SUM rows roll
  // up their descendants' leaves (like the on-screen rollupCodes). A per-row
  // dimension filter (curNodeDims) narrows rows to a mapping instance's dims.
const nodeByCode = new Map();
  const codeTypeMap = new Map();
  // Se reconstruyen por vista (igual que el xlsx, que los arma desde el árbol
  // de SU hoja) para que un P/L con mapping no contamine la vista All.
  const setTreeContext = (t) => {
    nodeByCode.clear();
    codeTypeMap.clear();
    const walkN = (ns) => (ns || []).forEach(n => {
      if (n.AccountCode) { nodeByCode.set(n.AccountCode, n); codeTypeMap.set(n.AccountCode, n.AccountType); }
      walkN(n.children);
    });
    walkN(t);
  };
  const collectLeafCodes = (n) => {
    if (!n) return [];
    if (n.children && n.children.length > 0) {
      const out = [];
      n.children.forEach(c => out.push(...collectLeafCodes(c)));
      return out;
    }
    return [n.AccountCode];
  };
  const leafCodesFor = (code) => {
    const n = nodeByCode.get(code);
    if (!n) return [code];
    return (n.children && n.children.length > 0) ? collectLeafCodes(n) : [code];
  };
  let curNodeDims = null; // set per row before calling the value helpers
  const dimOk = (r) => {
    if (!curNodeDims || curNodeDims.length === 0) return true;
    if (typeof rowMatchesDims !== "function") return true;
    return rowMatchesDims(r, curNodeDims);
  };
const amt = (r) => -(typeof getRowAmount === "function" ? Number(getRowAmount(r) || 0) : Number(r.AmountYTD ?? 0));

  const getConsTotal = (code, p) => leafCodesFor(code).reduce((acc, leaf) => {
    const byCo = p?.get(leaf) || {};
    return acc + (byCo[topParent] ?? [])
      .filter(r => r.CompanyRole === "Group")
      .filter(r => !r.OriginCompanyShortName?.trim() && !r.CounterpartyShortName?.trim())
      .filter(dimOk)
      .reduce((s, r) => s + amt(r), 0);
  }, 0);
  const getContrib = (code, company, p) => {
    const role = company === topParent ? "Parent" : "Contribution";
    return leafCodesFor(code).reduce((acc, leaf) => {
      const byCo = p?.get(leaf) || {};
      return acc + (byCo[company] ?? [])
        .filter(r => r.CompanyRole === role)
        .filter(dimOk)
        .reduce((s, r) => s + amt(r), 0);
    }, 0);
  };

  // Monthly vs YTD: for P/L accounts in monthly mode, current period = YTD(curr)
  // - YTD(prev). B/S stays YTD. Type comes from the export tree node.
const isPLCode = (code) => {
    const t = codeTypeMap.get(code) ?? "";
    return t === "P/L" || t === "DIS";
  };
const consMonthly = (code) => {
    const curr = getConsTotal(code, pivot);
    // Guard: empty current period → no (0 − prevYTD) phantom negatives.
    if (ytdOnly || !pivotPrev || !isPLCode(code) || pivot.size === 0) return curr;
    return curr - getConsTotal(code, pivotPrev);
  };
  const contribMonthly = (code, company) => {
    const curr = getContrib(code, company, pivot);
    if (ytdOnly || !pivotPrev || !isPLCode(code) || pivot.size === 0) return curr;
    return curr - getContrib(code, company, pivotPrev);
  };
  const contribSumMonthly = (code) =>
    effectiveCompanies.reduce((s, c) => s + contribMonthly(code, c), 0);

const DEC = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const fmt = (v) => {
    const n = Number(v) || 0;
    if (Math.abs(n) < 0.005) return "—";
   return n < 0 ? `(${Math.abs(n).toLocaleString("de-DE", DEC)})` : n.toLocaleString("de-DE", DEC);
  };
  const fmtDelta = (v) => {
    const n = Number(v) || 0;
    if (Math.abs(n) < 0.005) return "—";
    return (n > 0 ? "+" : "") + n.toLocaleString("de-DE", DEC);
  };
const fmtPct = (cur, cmp) => {
    if (!cmp || Math.abs(cmp) < 1) return "—";
    const p = ((cur - cmp) / Math.abs(cmp)) * 100;
    return (p >= 0 ? "+" : "") + p.toFixed(1) + "%";
  };

  // ── Doc setup: A3 landscape ────────────────────────────────────────────
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const pageManifest = []; // { displayedPage, title }
  let isFirstContentPage = true;

  // ── Page header drawer ─────────────────────────────────────────────────
  const drawPageHeader = (viewLabel, partLabel) => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 36, "F");
    doc.setFillColor(...ROSE);
    doc.rect(0, 0, 5, 36, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(`${isRootView ? "Consolidated" : "Subgroup"} Sheet · ${viewLabel}`, 12, 14);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`${monthLabel} ${year}  ·  ${perspectiveLegal}${displayCurrency ? `  ·  ${displayCurrency}` : ""}`, 12, 22);
    doc.setFontSize(8.5);
    const ctx = [];
    if (source) ctx.push(`Source: ${source}`);
    if (structure) ctx.push(`Structure: ${structure}`);
    if (activeMapping) ctx.push(`Mapping: ${activeMapping.name}`);
    doc.text(ctx.join("  ·  "), 12, 28);
    // Part badge in top-right
    if (partLabel) {
      doc.setFillColor(...ROSE);
      const badgeW = 36, badgeH = 8;
      doc.roundedRect(W - badgeW - 12, 6, badgeW, badgeH, 2, 2, "F");
      doc.setTextColor(...WHITE);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(partLabel, W - badgeW / 2 - 12, 11.5, { align: "center" });
    }
    if (compareMode && cmpYear && cmpMonth) {
      doc.setFillColor(...ROSE_DK);
      doc.rect(0, 36, W, 6, "F");
      doc.setTextColor(...WHITE);
      doc.setFontSize(8);
      doc.text(`Compared with: ${cmpMoLabel} ${cmpYear}`, 12, 40);
      return 46;
    }
    return 40;
  };

  const drawFooter = (viewLabel) => {
    doc.setFillColor(...LIGHT);
    doc.rect(0, H - 10, W, 10, "F");
    doc.setTextColor(...TEXT_DK);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(`KONSOLIDATOR  ·  ${viewLabel.toUpperCase()}`, 12, H - 4);
    doc.setFont("helvetica", "normal");
    doc.text(`${monthLabel} ${year} · ${perspectiveLegal}`, W / 2, H - 4, { align: "center" });
    const pageNo = doc.internal.getNumberOfPages();
    doc.text(`Page ${pageNo}`, W - 12, H - 4, { align: "right" });
  };

  // ── Flatten tree to rows (with breakers) ───────────────────────────────
  const flattenForPdf = (tree, mappingDerived) => {
const flat = [];
    // drillDown OFF = informe resumido: solo depth 0 (más los placeholders
    // _breakerOnly, que arrastran la cabecera final). Igual que el walk del xlsx.
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        if (n._breakerOnly || depth === 0 || drillDown) flat.push({ node: n, depth });
        if (n.children?.length && drillDown) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);

    const TYPE_LABELS_PDF = {
      "P/L": "PROFIT & LOSS",
      "DIS": "DISTRIBUTION OF RESULT",
      "B/S": "BALANCE SHEET",
      "C/F": "CASH FLOW",
      "CFS": "CASH FLOW",
    };
    const mappingBreakers = mappingDerived?.breakers || {};
    const rows = [];
    let prevType = null;
    flat.forEach(({ node, depth }) => {
      const type = node.AccountType ?? "";
      const typeChanged = type !== prevType;
      prevType = type;
const mappingBk = mappingBreakers[node.AccountCode];
      const typeBk = (typeChanged && TYPE_LABELS_PDF[type]) ? TYPE_LABELS_PDF[type] : null;
      // Mapping OR custom standard owns the structure — suppress type-dividers.
      const structureOwned = !!mappingDerived || isCustomStd;
      const breakerLabel = structureOwned
        ? (mappingBk ? String(mappingBk.label).toUpperCase() : null)
        : (mappingBk ? String(mappingBk.label).toUpperCase() : typeBk);
if (breakerLabel) {
        rows.push({ isBreaker: true, label: breakerLabel, color: mappingBk?.color || null });
      }
      // Los placeholders solo llevan la cabecera del breaker — sin fila de datos.
      if (node._breakerOnly) return;
      rows.push({ node, depth, isBreaker: false });
    });
    return rows;
  };

  // ── Build the list of "column groups" for chunking ─────────────────────
  // Account always reappears as fixed prefix on every chunk.
  const buildColumnGroups = () => {
    const groups = [];
    // Group 1: Consolidated (+ compare cols)
// Compare-period monthly helper (YTD(cmp) - YTD(cmpPrev) for P/L).
const consMonthlyCmp = (code) => {
      const curr = getConsTotal(code, cmpPivot);
      // Guard: empty compare period → no phantom negatives.
      if (ytdOnly || !cmpPivotPrev || !isPLCode(code) || cmpPivot.size === 0) return curr;
      return curr - getConsTotal(code, cmpPivotPrev);
    };
    const contribSumMonthlyCmp = (code) =>
      effectiveCompanies.reduce((s, c) => {
        const curr = getContrib(code, c, cmpPivot);
        if (ytdOnly || !cmpPivotPrev || !isPLCode(code) || cmpPivot.size === 0) return s + curr;
        return s + (curr - getContrib(code, c, cmpPivotPrev));
      }, 0);

    const g1 = { label: "Consolidated", cols: [
      { key: "cons", header: getLegal(topParent), value: (code) => consMonthly(code) },
    ]};
    if (compareMode) {
      g1.cols.push({ key: "cons-cmp",   header: "CMP",   value: (code) => consMonthlyCmp(code), isCompare: true });
      g1.cols.push({ key: "cons-delta", header: "Δ",     value: (code) => consMonthly(code) - consMonthlyCmp(code), isDelta: true });
      g1.cols.push({ key: "cons-pct",   header: "Δ%",    valueText: (code) => fmtPct(consMonthly(code), consMonthlyCmp(code)), isPct: true });
    }
    groups.push(g1);

    // Group 2: Eliminations
    const g2 = { label: "Eliminations", cols: [
      { key: "elim", header: "Elim. Total", value: (code) => consMonthly(code) - contribSumMonthly(code) },
    ]};
if (compareMode) {
      g2.cols.push({ key: "elim-cmp",   header: "CMP", value: (code) => consMonthlyCmp(code) - contribSumMonthlyCmp(code), isCompare: true });
      g2.cols.push({ key: "elim-delta", header: "Δ",   value: (code) => (consMonthly(code) - contribSumMonthly(code)) - (consMonthlyCmp(code) - contribSumMonthlyCmp(code)), isDelta: true });
      g2.cols.push({ key: "elim-pct",   header: "Δ%",  valueText: (code) => fmtPct(consMonthly(code) - contribSumMonthly(code), consMonthlyCmp(code) - contribSumMonthlyCmp(code)), isPct: true });
    }
    if (elimDetail) {
      elimHeaders.forEach(h => {
        g2.cols.push({ key: `elim-${h}`, header: h, value: (code) => (elimPivot.get(code) ?? {})[h] ?? 0, isElimDetail: true });
      });
    }
    groups.push(g2);

// Per-company compare monthly helper.
const contribMonthlyCmp = (code, company) => {
      const curr = getContrib(code, company, cmpPivot);
      if (ytdOnly || !cmpPivotPrev || !isPLCode(code) || cmpPivot.size === 0) return curr;
      return curr - getContrib(code, company, cmpPivotPrev);
    };
    // Group 3: Contribution sum + per-company columns
    const g3 = { label: "Per-Company Contributions", cols: [
      { key: "contrib", header: "Contrib. Sum", value: (code) => contribSumMonthly(code) },
    ]};
if (compareMode) {
      g3.cols.push({ key: "contrib-cmp",   header: "CMP", value: (code) => contribSumMonthlyCmp(code), isCompare: true });
      g3.cols.push({ key: "contrib-delta", header: "Δ",   value: (code) => contribSumMonthly(code) - contribSumMonthlyCmp(code), isDelta: true });
      g3.cols.push({ key: "contrib-pct",   header: "Δ%",  valueText: (code) => fmtPct(contribSumMonthly(code), contribSumMonthlyCmp(code)), isPct: true });
    }
effectiveCompanies.forEach(co => {
      g3.cols.push({ key: `co-${co}`, header: getLegal(co), value: (code) => contribMonthly(code, co) });
      if (compareMode) {
        g3.cols.push({ key: `co-${co}-cmp`,   header: `${getLegal(co)} · CMP`, value: (code) => contribMonthlyCmp(code, co), isCompare: true });
        g3.cols.push({ key: `co-${co}-delta`, header: `${getLegal(co)} · Δ`,   value: (code) => contribMonthly(code, co) - contribMonthlyCmp(code, co), isDelta: true });
        g3.cols.push({ key: `co-${co}-pct`,   header: `${getLegal(co)} · Δ%`,  valueText: (code) => fmtPct(contribMonthly(code, co), contribMonthlyCmp(code, co)), isPct: true });
      }
    });
    groups.push(g3);

    return groups;
  };

// ── Geometría de página (A3 apaisado) ──────────────────────────────────
  // El chunker anterior vaciaba la página en cuanto aparecía un grupo grande
  // (elim. detail), dejando páginas con una sola columna estirada. Ahora las
  // columnas se empaquetan hasta llenar el ancho útil.
  const PAGE_INNER = W - 16;   // ancho de página menos márgenes (8 + 8)
  const CODE_W     = 18;
  const NAME_W_MIN = 58;
  const NUM_W_MIN  = 24;       // cabe "-3.860.600,00" a 7pt con padding
  const NUM_W_MAX  = 34;
  const TARGET_COLS_PER_PAGE = Math.max(
    4,
    Math.floor((PAGE_INNER - CODE_W - NAME_W_MIN) / NUM_W_MIN)
  );

  // Aplana los grupos en un solo flujo ordenado (cada col conserva su grupo)
  // y lo corta por capacidad, de modo que ninguna página queda a medias.
  const chunkColumnGroups = (groups) => {
    const stream = [];
    groups.forEach(g => g.cols.forEach(c => stream.push({ col: c, group: g.label })));
    const chunks = [];
    for (let i = 0; i < stream.length; i += TARGET_COLS_PER_PAGE) {
      const slice = stream.slice(i, i + TARGET_COLS_PER_PAGE);
      const parts = [];
      slice.forEach(s => { if (!parts.includes(s.group)) parts.push(s.group); });
      chunks.push({ label: parts[0], cols: slice.map(s => s.col), parts });
    }
    return chunks;
  };

  // ── Build pages for a given view ───────────────────────────────────────
const buildPagesForView = (viewLabel, tree, mappingDerived) => {
    setTreeContext(tree);
    const groups = buildColumnGroups();
    const chunks = chunkColumnGroups(groups);
    const flatRows = flattenForPdf(tree, mappingDerived);

    chunks.forEach((chunk, ci) => {
      if (!isFirstContentPage) doc.addPage();
      isFirstContentPage = false;
      const partLabel = chunks.length > 1 ? `Part ${ci + 1}/${chunks.length}` : null;
      const chunkTitle = `${viewLabel}${partLabel ? ` · ${partLabel}` : ""} (${chunk.parts.join(" + ")})`;
      pageManifest.push({ displayedPage: doc.internal.getNumberOfPages(), title: chunkTitle });

      const startY = drawPageHeader(viewLabel, partLabel);

      // ── Head: Code + Account always, then chunk's columns ────────────
      const headRow = [
        { content: "Code", styles: { halign: "left" } },
        { content: "Account", styles: { halign: "left" } },
      ];
      chunk.cols.forEach(c => {
headRow.push({ content: c.header, styles: { halign: "center", fontSize: c.isElimDetail ? 6 : 7 } });
      });
      const head = [headRow];

      // ── Body ──────────────────────────────────────────────────────────
      const body = [];
      const totalCols = headRow.length;
      flatRows.forEach(r => {
        if (r.isBreaker) {
          body.push([{
            content: r.label,
            colSpan: totalCols,
            styles: {
       fillColor: r.color ? hexToRgb(r.color, NAVY_DK) : NAVY_DK, textColor: WHITE, fontStyle: "bold",
              halign: "left", fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
            },
          }]);
          return;
        }
const { node, depth } = r;
        const code = node.AccountCode;
        // Acota la matemática de TODAS las columnas a los dims de esta instancia
        // antes de evaluarlas (dimOk cierra sobre curNodeDims).
        curNodeDims = node._dims && node._dims.length > 0 ? node._dims : null;
        const isParent = !!(node.children && node.children.length > 0);
        const indent = "  ".repeat(Math.min(depth, 6));
        const row = [
          { content: code, styles: { fontStyle: isParent ? "bold" : "normal", textColor: GREY } },
          { content: indent + (node.AccountName ?? code), styles: { fontStyle: isParent ? "bold" : "normal", textColor: TEXT_DK } },
        ];
        chunk.cols.forEach(c => {
          let txt, color;
          if (c.valueText) {
            txt = c.valueText(code);
            color = GREY;
          } else {
            const v = c.value(code);
            if (c.isDelta) {
              txt = fmtDelta(v);
              color = v === 0 ? GREY : v < 0 ? RED : GREEN;
            } else {
              txt = fmt(v);
              color = v < 0 ? RED : TEXT_DK;
            }
          }
     row.push({ content: txt, styles: { halign: "center", textColor: color, fontSize: c.isElimDetail ? 6 : undefined } });
        });
        body.push(row);
      });

// Adaptive font sizing
      const bodyFontSize = totalCols <= 8 ? 8 : totalCols <= 12 ? 7.5 : 7;

      // Anchos explícitos: las numéricas reparten el espacio a partes iguales
      // (con tope) y Account absorbe el resto, así nada se estira.
      const nNum  = chunk.cols.length;
      const numW  = Math.min(NUM_W_MAX, Math.max(NUM_W_MIN, (PAGE_INNER - CODE_W - NAME_W_MIN) / nNum));
      const nameW = Math.max(NAME_W_MIN, PAGE_INNER - CODE_W - numW * nNum);
      const colStyles = { 0: { halign: "left", cellWidth: CODE_W }, 1: { halign: "left", cellWidth: nameW } };
     chunk.cols.forEach((c, i) => { colStyles[i + 2] = { halign: "center", cellWidth: numW }; });

      autoTable(doc, {
        startY, head, body,
        margin: { left: 8, right: 8, bottom: 14 },
        styles: {
          fontSize: bodyFontSize, cellPadding: 1.3, overflow: "linebreak",
          font: "helvetica", textColor: TEXT_DK, lineColor: GREY_LT, lineWidth: 0.1, valign: "middle",
        },
        headStyles: {
          fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: bodyFontSize, halign: "center",
          minCellHeight: 10,
        },
tableWidth: "wrap",
        columnStyles: colStyles,
        alternateRowStyles: { fillColor: OFFWHITE },
        didDrawPage: () => drawFooter(viewLabel),
      });
    });
  };

  // ── Generate pages per requested view ──────────────────────────────────
  if (views.includes("all")) buildPagesForView("All Accounts",  treeAll, mappingDerivedAll);
  if (views.includes("pl"))  buildPagesForView("Profit & Loss", treePL,  mappingDerivedPL);
  if (views.includes("bs"))  buildPagesForView("Balance Sheet", treeBS,  mappingDerivedBS);

  // ── Build TOC on page 1 ────────────────────────────────────────────────
  doc.insertPage(1);
  doc.setPage(1);
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 50, "F");
  doc.setFillColor(...ROSE);
  doc.rect(0, 0, 5, 50, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("Consolidation Report", 12, 22);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`${monthLabel} ${year}  ·  ${perspectiveLegal}`, 12, 32);
  doc.setFontSize(9);
  const ctxParts = [];
  if (source) ctxParts.push(`Source: ${source}`);
  if (structure) ctxParts.push(`Structure: ${structure}`);
  if (activeMapping) ctxParts.push(`Mapping: ${activeMapping.name}`);
  if (compareMode && cmpYear && cmpMonth) ctxParts.push(`vs ${cmpMoLabel} ${cmpYear}`);
  ctxParts.push(`Generated ${new Date().toLocaleDateString("es-ES")}`);
  doc.text(ctxParts.join("  ·  "), 12, 40);

  doc.setTextColor(...NAVY);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CONTENTS", 12, 68);
  doc.setDrawColor(...GREY_LT);
  doc.setLineWidth(0.3);
  doc.line(12, 70, W - 12, 70);

  doc.setTextColor(...TEXT_DK);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  let tocY = 80;
  const tocBottom = H - 16;
  pageManifest.forEach((entry, i) => {
    if (tocY > tocBottom) return;
    if (i % 2 === 1) {
      doc.setFillColor(...OFFWHITE);
      doc.rect(10, tocY - 5, W - 20, 8, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.text(entry.title, 14, tocY);
    const pageStr = String(entry.displayedPage + 1);
    const titleW = doc.getTextWidth(entry.title);
    const pageW = doc.getTextWidth(pageStr);
    const dotsStart = 14 + titleW + 4;
    const dotsEnd = W - 14 - pageW - 2;
    const dotW = doc.getTextWidth(". ");
    let x = dotsStart;
    doc.setTextColor(...GREY);
    while (x < dotsEnd) {
      doc.text(".", x, tocY);
      x += dotW;
    }
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.text(pageStr, W - 14, tocY, { align: "right" });
    doc.setTextColor(...TEXT_DK);
    tocY += 9;
  });

  doc.setFillColor(...LIGHT);
  doc.rect(0, H - 10, W, 10, "F");
  doc.setTextColor(...TEXT_DK);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("KONSOLIDATOR  ·  INDEX", 12, H - 4);
  doc.setFont("helvetica", "normal");
  doc.text(`${monthLabel} ${year} · ${perspectiveLegal}`, W / 2, H - 4, { align: "center" });
  doc.text("Page 1", W - 12, H - 4, { align: "right" });

  const safePerspective = String(perspectiveLegal || "Sheet").replace(/[^a-zA-Z0-9_-]+/g, "_");
  doc.save(`Consolidation_Sheet_${safePerspective}_${year}-${String(month).padStart(2, "0")}.pdf`);
}
