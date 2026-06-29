/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { useTypo, useSettings } from "./SettingsContext";
import { t } from "../../lib/i18n";
import {
  ChevronDown, ChevronRight, Loader2, Maximize2, Minimize2,
X, RefreshCw, Filter, TrendingUp, TrendingDown, GitMerge,
  Download, BarChart2, Layers, Search, FileText, Library, CheckCircle2,
} from "lucide-react";
import PageHeader, { FilterPill as HeaderFilterPill } from "./PageHeader.jsx";

const BASE_URL = "";

const MONTHS = [
  { value: 1,  label: "January"   }, { value: 2,  label: "February"  },
  { value: 3,  label: "March"     }, { value: 4,  label: "April"     },
  { value: 5,  label: "May"       }, { value: 6,  label: "June"      },
  { value: 7,  label: "July"      }, { value: 8,  label: "August"    },
  { value: 9,  label: "September" }, { value: 10, label: "October"   },
  { value: 11, label: "November"  }, { value: 12, label: "December"  },
];

const SUB_COLS = [
  { key: "AJE", label: "AJE", color: "text-indigo-500" },
  { key: "RJE", label: "RJE", color: "text-amber-500"  },
  { key: "EJE", label: "EJE", color: "text-rose-500"   },
  { key: "SYS", label: "SYS", color: "text-gray-400"   },
  { key: "CFA", label: "CFA", color: "text-gray-400"   },
];

/* ─── Formatting ──────────────────────────────────────────────────────────── */

function fmtAmt(n) {
  if (n == null || n === 0) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (isNaN(num) || num === 0) return "—";
  return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Reporting currency ──────────────────────────────────────────────────── */
function getReportingCurrency(companyShortName, groupStructure, companies) {
  const node = groupStructure.find(g =>
    (g.CompanyShortName ?? g.companyShortName) === companyShortName
  );
  const parentName = node?.ParentShortName ?? node?.parentShortName;
  if (!node || !parentName) {
    const own = companies.find(c =>
      (c.CompanyShortName ?? c.companyShortName) === companyShortName
    );
    return own?.CurrencyCode ?? own?.currencyCode ?? "EUR";
  }
  const parent = companies.find(c =>
    (c.CompanyShortName ?? c.companyShortName) === parentName
  );
  return parent?.CurrencyCode ?? parent?.currencyCode ?? "EUR";
}

/* ─── Sort ────────────────────────────────────────────────────────────────── */
function pgcSort(a, b) {
  const cA = a.AccountCode ?? a.accountCode ?? "";
  const cB = b.AccountCode ?? b.accountCode ?? "";
  const aA = /^[A-Za-z]/.test(cA), bA = /^[A-Za-z]/.test(cB);
  if (aA && !bA) return -1;
  if (!aA && bA) return 1;
  const strip  = c => c.replace(/\.S$/i, "");
  const isSum  = c => /\.S$/i.test(c);
  const bsA = strip(cA), bsB = strip(cB);
  if (bsA === bsB) {
    if (isSum(cA) && !isSum(cB)) return 1;
    if (!isSum(cA) && isSum(cB)) return -1;
    return 0;
  }
  const pA = bsA.split("."), pB = bsB.split(".");
  for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
    const a = pA[i] ?? "", b = pB[i] ?? "";
    if (a === b) continue;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "es", { sensitivity: "base" });
  }
  return 0;
}

/* ─── Tree builder ────────────────────────────────────────────────────────── */
function buildTree(accounts) {
  const sorted = [...accounts].sort(pgcSort);
  const map    = new Map();
  sorted.forEach(a => {
    const code = a.AccountCode ?? a.accountCode ?? "";
    map.set(code, { ...a, AccountCode: code, children: [] });
  });
  const roots = [];
  sorted.forEach(a => {
    const code      = a.AccountCode ?? a.accountCode ?? "";
    const sumCode   = a.SumAccountCode ?? a.sumAccountCode ?? "";
    const parent    = sumCode ? map.get(sumCode) : null;
    if (parent && !/\.S$/i.test(parent.AccountCode)) {
      parent.children.push(map.get(code));
    } else {
      const isNum   = /^\d/.test(code);
      const missing = sumCode && !map.has(sumCode);
      if (!(isNum && missing)) roots.push(map.get(code));
    }
  });
  return roots;
}

/* ─── Export helpers ──────────────────────────────────────────────────────── */

const MONTHS_LABEL = [
  "", "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function _flattenTree(roots) {
  const out = [];
  function walk(node, depth) {
    out.push({ node, depth });
    if (node.children?.length) node.children.forEach(c => walk(c, depth + 1));
  }
  roots.forEach(r => walk(r, 0));
  return out;
}

function generateContributiveXlsx({
  T,
  tree, treeLiteral, pivot,
  cfTree, cfPivot,
  cols, cfCols,
  cmpPivot, cmpCfPivot,
  typeFilter, activeMapping, mappingTab,
  dimIdx, cmpDimIdx,
  journalPivot = new Map(), counterpartyPivot = new Map(),
  cfNameLookup = new Map(),
companies = [],
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

    const tabIsMapped = (tab) => activeMapping && mappingTab === tab && treeLiteral;
const tt = (k, fb) => (T ? T(k, fb) : fb);
    const sheetSpecs = [];
    if (!typeFilter || typeFilter === "P/L") sheetSpecs.push({ name: tt("page_pl_full", "Profit & Loss"),  types: ["P/L", "DIS"], isMapped: !!tabIsMapped("pl"), isCF: false });
    if (!typeFilter || typeFilter === "B/S") sheetSpecs.push({ name: tt("page_bs_full", "Balance Sheet"),  types: ["B/S"],        isMapped: !!tabIsMapped("bs"), isCF: false });
    if (!typeFilter || typeFilter === "C/F") sheetSpecs.push({ name: tt("nav_cashflow", "Cash Flow"),      types: ["C/F", "CFS"], isMapped: !!tabIsMapped("cf"), isCF: true  });

    for (const spec of sheetSpecs) {
      const visCo = spec.isCF ? (cfCols ?? []) : (cols ?? []);
      const usePivot = spec.isCF ? cfPivot : pivot;
      const useCmpPivot = spec.isCF ? cmpCfPivot : cmpPivot;
      if (visCo.length === 0) continue;

// Sub-columns per company:
      //   - "A" amount (always)
      //   - "%" of perspective parent (only when perspectiveMode is on)
      //   - CMP/Δ/Δ% (when compare on)
      //   - Uploaded + 5 journal types + IC (P/L + B/S only)
      const JOURNAL_SUBS = ["Uploaded", "AJE", "RJE", "EJE", "SYS", "CFA", "IC"];
      const journalColCount = spec.isCF ? 0 : JOURNAL_SUBS.length;
      const compareColCount = compareMode ? 3 : 0;
      const pctColCount     = perspectiveMode ? 1 : 0;
      const subColsPerCo    = 1 + pctColCount + compareColCount + journalColCount;
      const showTotals = !compareMode;
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
      titleCell.value = `Konsolidator · ${spec.name}`;
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
      if (!spec.isCF) JOURNAL_SUBS.forEach(jk => {
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
            ? '0.00"%";[Red]-0.00"%"'                              // 2-decimal percent
            : '#,##0.00;[Red]-#,##0.00';                           // 2-decimal amount
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

          // Journal cols
          if (!spec.isCF) {
            const jp = getJp ? getJp(co) : {};
            const journalsTotal = Object.values(jp).reduce((s, v) => s + (Number(v) || 0), 0);
            const uploadedVal = a - journalsTotal;
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

if (spec.isMapped) {
        // LITERAL MODE — walk treeLiteral
        treeLiteral.forEach(section => {
          if (section.label) writeSectionBar(section.label, toArgb(section.color));
          const renderNode = (node, depth) => {
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const isSum = !!node.isSum && hasChildren;
            const getVal = (co) => computeLiteralForCompany(node, usePivot, co, "object", spec.isCF ? null : dimIdx);
            const getCmp = (co) => compareMode ? computeLiteralForCompany(node, useCmpPivot, co, "scalar", spec.isCF ? null : cmpDimIdx) : 0;
            const getJp  = (co) => spec.isCF ? {} : computeLiteralJournalForCompany(node, journalPivot, co, null);
            const getIc  = (co) => spec.isCF ? 0  : computeLiteralCounterpartyForCompany(node, counterpartyPivot, co, null);
            writeAccountRow({ code: node.code, name: node.name, depth, isBold: depth === 0, isSum, dims: node.dims, getVal, getCmp, getJp, getIc });
            if (hasChildren) node.children.forEach(c => renderNode(c, depth + 1));
          };
          (section.nodes || []).forEach(n => renderNode(n, 0));
        });
      } else {
        // STANDARD MODE — flatten tree filtered by types
        const useTree = spec.isCF ? (cfTree || []) : (tree || []);
        const filtered = useTree.filter(n => spec.types.includes(n.AccountType ?? n.accountType ?? ""));
        writeSectionBar(spec.name, C.primary);
        const walk = (node, depth) => {
          const code = node.AccountCode;
          const hasChildren = node.children?.length > 0;
          const isSummary = /\.S$/i.test(code) || hasChildren;
          const getVal = (co) => Number(usePivot.get(code)?.[co]?.total ?? 0);
          const getCmp = (co) => compareMode ? Number(useCmpPivot?.get(code)?.[co] ?? 0) : 0;
          const getJp  = (co) => spec.isCF ? {} : (journalPivot.get(code)?.[co] ?? {});
          const getIc  = (co) => spec.isCF ? 0  : Number(counterpartyPivot.get(code)?.[co] ?? 0);
          writeAccountRow({
            code, name: node.AccountName ?? node.accountName ?? "",
            depth, isBold: depth === 0 || isSummary, isSum: false, dims: null, getVal, getCmp, getJp, getIc,
          });
          (node.children || []).forEach(c => walk(c, depth + 1));
        };
        filtered.forEach(n => walk(n, 0));
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
          ws.getColumn(startCol + off).width = 14; ws.getColumn(startCol + off).outlineLevel = 1; off++;
          ws.getColumn(startCol + off).width = 13; ws.getColumn(startCol + off).outlineLevel = 1; off++;
          ws.getColumn(startCol + off).width = 11; ws.getColumn(startCol + off).outlineLevel = 1; off++;
        }
        if (!spec.isCF) {
          for (let k = 0; k < 6; k++) {
            ws.getColumn(startCol + off).width = 13;
            ws.getColumn(startCol + off).outlineLevel = 2;
            off++;
          }
          ws.getColumn(startCol + off).width = 13;
          ws.getColumn(startCol + off).outlineLevel = 2;
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

function generateContributivePdf({
  T,
  tree, treeLiteral, pivot,
  cfTree, cfPivot,
  cols, cfCols,
  cmpPivot, cmpCfPivot,
  typeFilter, activeMapping, mappingTab,
  dimIdx, cmpDimIdx,
  journalPivot = new Map(), counterpartyPivot = new Map(),
  cfNameLookup = new Map(),
companies = [],
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
      return Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    const sheetSpecs = [];
    if (!typeFilter || typeFilter === "P/L") sheetSpecs.push({ name: tt("page_pl_full", "Profit & Loss"), types: ["P/L", "DIS"], isMapped: !!tabIsMapped("pl"), isCF: false });
    if (!typeFilter || typeFilter === "B/S") sheetSpecs.push({ name: tt("page_bs_full", "Balance Sheet"), types: ["B/S"],        isMapped: !!tabIsMapped("bs"), isCF: false });
    if (!typeFilter || typeFilter === "C/F") sheetSpecs.push({ name: tt("nav_cashflow", "Cash Flow"),     types: ["C/F", "CFS"], isMapped: !!tabIsMapped("cf"), isCF: true  });

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
      const useCmpPivot = spec.isCF ? cmpCfPivot : cmpPivot;
      const useDim = spec.isCF ? null : dimIdx;
      const useCmpDim = spec.isCF ? null : cmpDimIdx;
      const rows = [];

      const pushBreaker = (label, color) => {
        rows.push({ _isBreaker: true, _label: String(label).toUpperCase(), _color: color });
      };

      // ALL companies are needed for parentTotal (so % stays consistent across parts)
      const allVisCo = (spec.isCF ? cfCols : cols) ?? [];

      const pushNode = ({ code, name, depth, isSum, dims, getVal, getCmp, getJp, getIc }) => {
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
            row[`del_${co}`] = (delta == null || Math.abs(delta) < 0.005) ? "—" : (delta > 0 ? "+" : "") + fmtN(delta);
            row[`dpc_${co}`] = deltaPct == null ? "—" : (deltaPct > 0 ? "+" : "") + deltaPct.toFixed(1) + "%";
          }
          if (journalsHere) {
            const jp = getJp ? getJp(co) : {};
            const journalsTotal = Object.values(jp).reduce((s, v) => s + (Number(v) || 0), 0);
            row[`Up_${co}`]  = fmtN(a - journalsTotal);
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

      if (spec.isMapped) {
        (treeLiteral || []).forEach(section => {
          if (section.label) pushBreaker(section.label, section.color);
          const renderNode = (node, depth) => {
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const isSum = !!node.isSum && hasChildren;
            const getVal = (co) => computeLiteralForCompany(node, usePivot, co, "object", useDim);
            const getCmp = (co) => compareMode ? computeLiteralForCompany(node, useCmpPivot, co, "scalar", useCmpDim) : 0;
            const getJp  = (co) => spec.isCF ? {} : computeLiteralJournalForCompany(node, journalPivot, co, null);
            const getIc  = (co) => spec.isCF ? 0  : computeLiteralCounterpartyForCompany(node, counterpartyPivot, co, null);
            pushNode({ code: node.code, name: node.name, depth, isSum, dims: node.dims, getVal, getCmp, getJp, getIc });
            if (hasChildren) node.children.forEach(c => renderNode(c, depth + 1));
          };
          (section.nodes || []).forEach(n => renderNode(n, 0));
        });
      } else {
        const useTree = spec.isCF ? (cfTree || []) : (tree || []);
        const filtered = useTree.filter(n => spec.types.includes(n.AccountType ?? n.accountType ?? ""));
        pushBreaker(spec.name, "#1a2f8a");
        const walk = (node, depth) => {
          const code = node.AccountCode;
          const hasChildren = node.children?.length > 0;
          const isSum = /\.S$/i.test(code) || hasChildren;
          const getVal = (co) => Number(usePivot.get(code)?.[co]?.total ?? 0);
          const getCmp = (co) => compareMode ? Number(useCmpPivot?.get(code)?.[co] ?? 0) : 0;
          const getJp  = (co) => spec.isCF ? {} : (journalPivot.get(code)?.[co] ?? {});
          const getIc  = (co) => spec.isCF ? 0  : Number(counterpartyPivot.get(code)?.[co] ?? 0);
          pushNode({ code, name: node.AccountName ?? node.accountName ?? "", depth, isSum, getVal, getCmp, getJp, getIc });
          (node.children || []).forEach(c => walk(c, depth + 1));
        };
        filtered.forEach(n => walk(n, 0));
      }
      return rows;
    };

    // ─── For each sheet, paginate companies ────────────────────────────
    sheetSpecs.forEach((spec) => {
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
      console.log("[pdf debug] jsPDF.API has autoTable?", typeof jsPDF.API?.autoTable);
      const probe = new jsPDF();
      console.log("[pdf debug] probe has autoTable?", typeof probe.autoTable);

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

/* ─── useCountUp ─────────────────────────────────────────────────────────── */
function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    fromRef.current = display;
    startRef.current = null;
    const from = Number(fromRef.current) || 0;
    const to = Number(target) || 0;
    if (from === to) { setDisplay(to); return; }
    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);
  return display;
}

/* ─── ContributiveLoadingSpinner ─────────────────────────────────────────── */
// Global animation state lives outside React, survives remounts.
const contribAnim = { startedAt: null, raf: null, subs: new Set(), idleTimer: null };

function contribAnimStart() {
  if (contribAnim.idleTimer) { clearTimeout(contribAnim.idleTimer); contribAnim.idleTimer = null; }
  if (contribAnim.startedAt !== null) return;
  contribAnim.startedAt = performance.now();
  const tick = () => {
    contribAnim.subs.forEach(fn => fn());
    contribAnim.raf = requestAnimationFrame(tick);
  };
  contribAnim.raf = requestAnimationFrame(tick);
}
function contribAnimMaybeReset() {
  contribAnim.idleTimer = setTimeout(() => {
    if (contribAnim.subs.size === 0) {
      if (contribAnim.raf) cancelAnimationFrame(contribAnim.raf);
      contribAnim.raf = null;
      contribAnim.startedAt = null;
    }
    contribAnim.idleTimer = null;
  }, 500);
}
function contribAnimProgress() {
  if (contribAnim.startedAt === null) return 0;
  const elapsed = performance.now() - contribAnim.startedAt;
  const t = 1 - Math.exp(-elapsed / 2500);
  return Math.min(95, t * 100);
}

function ContributiveLoadingSpinner({ T, colors, metaReady, probingPeriod }) {
  const [, force] = useState(0);
  useEffect(() => {
    contribAnimStart();
    const sub = () => force(n => n + 1);
    contribAnim.subs.add(sub);
    return () => { contribAnim.subs.delete(sub); contribAnimMaybeReset(); };
  }, []);
  const progress = contribAnimProgress();
return (
    <div className="relative flex-1 min-h-0 flex items-center justify-center rounded-2xl"
      style={{ background: "rgba(255,255,255,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div className="relative rounded-3xl bg-white border border-gray-100 p-10 flex flex-col items-center"
        style={{ width: 380, boxShadow: "0 24px 80px -12px rgba(26,47,138,0.25), 0 8px 24px -8px rgba(0,0,0,0.08)" }}>
        <div className="relative" style={{ width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="60" fill="none" stroke="#f3f4f6" strokeWidth="10" />
            <circle cx="70" cy="70" r="60" fill="none"
              stroke="url(#contribProgGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 60}
              strokeDashoffset={2 * Math.PI * 60 * (1 - progress / 100)}
              style={{ transform: "rotate(-90deg)", transformOrigin: "70px 70px" }}
            />
            <defs>
              <linearGradient id="contribProgGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={colors.primary ?? "#1a2f8a"} />
                <stop offset="100%" stopColor="#CF305D" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black tabular-nums" style={{ color: colors.primary }}>
              {Math.round(progress)}<span className="text-base text-gray-300">%</span>
            </span>
          </div>
        </div>
<p className="text-sm font-black text-gray-800 mt-6 tracking-wide">
          {!metaReady ? T("loading_meta") : probingPeriod ? T("loading_overlay_period") : T("contrib_building", "Building contributive view…")}
        </p>
        <p className="text-[10px] text-gray-300 mt-1.5 uppercase tracking-widest font-bold">
          {T("contrib_label", "Contribution")}
        </p>
      </div>
    </div>
  );
}

/* ─── FilterPill ──────────────────────────────────────────────────────────── */
function CompanyFilterPill({ cols, selected, onChange, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const allSelected = selected.length === 0 || selected.length === cols.length;
  const toggle = co => {
    if (selected.includes(co)) onChange(selected.filter(c => c !== co));
    else onChange([...selected, co]);
  };
  const selectAll = () => onChange([]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
        style={filterStyle}>
<span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">COMP</span>
        <span>{allSelected ? "All" : `${selected.length} selected`}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[200px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-72 overflow-y-auto">
            <button onClick={selectAll}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2.5 text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]">
              <span className="w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all"
                style={allSelected ? { backgroundColor: colors?.primary, borderColor: colors?.primary } : { borderColor: "#d1d5db", backgroundColor: "white" }}>
                {allSelected && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              All companies
            </button>
            <div className="my-1 border-t border-gray-100" />
            {cols.map(co => {
              const isSel = selected.includes(co);
              return (
                <button key={co} onClick={() => toggle(co)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2.5 text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]">
                  <span className="w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all"
                    style={isSel ? { backgroundColor: colors?.primary, borderColor: colors?.primary } : { borderColor: "#d1d5db", backgroundColor: "white" }}>
                    {isSel && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  {co}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({ label, value, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => String(o.value) === String(value))?.label ?? "—";

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
        style={filterStyle}>
        <span style={{ ...filterStyle, fontSize: 9, fontWeight: 800, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <span>{display}</span>
        <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {options.map(o => {
              const selected = String(o.value) === String(value);
              return (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
                    ${selected ? "text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
                  style={selected ? { backgroundColor: colors?.primary } : undefined}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TabSelector({ tabs, activeIdx, onSelect, filterStyle }) {
  const containerRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll("button");
    const active = buttons[activeIdx];
    if (active) {
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
      });
    }
  }, [activeIdx, tabs.length]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-1 p-1 bg-[#e6e6e6] rounded-2xl flex-shrink-0 shadow-xl">
      <div
        className="absolute top-1 bottom-1 bg-white shadow-sm rounded-2xl transition-all duration-300 ease-out"
        style={{
          left: indicator.left,
          width: indicator.width,
        }}
      />
      {tabs.map((t) => (
        <button
          key={t.key || "all"}
          onClick={() => onSelect(t.key === tabs[activeIdx]?.key && t.key !== "" ? "" : t.key)}
          className="relative z-10 px-3 py-2 rounded-2xl transition-all"
          style={filterStyle}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Drilldown modal ─────────────────────────────────────────────────────── */
function DrilldownModal({ T, accountCode, accountName, company, rows, currency, onClose }) {
  const total = rows.reduce((s, r) => s + (-(Number(r.AmountYTD ?? r.amountYTD) || 0)), 0);

  const byLocal = new Map();
  rows.forEach(r => {
    const lac  = r.LocalAccountCode ?? r.localAccountCode ?? "__none__";
    const lanm = r.LocalAccountName ?? r.localAccountName ?? "";
    const dim  = r.DimensionName    ?? r.dimensionName    ?? "";
    const amt  = -(Number(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD) || 0);
    if (!byLocal.has(lac)) byLocal.set(lac, { code: lac === "__none__" ? null : lac, name: lanm, amt: 0, dims: [] });
    const e = byLocal.get(lac);
    e.amt += amt;
    if (dim) e.dims.push(dim);
  });

return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
<div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="bg-[#1a2f8a] px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-white font-black text-sm">{accountName}</p>
            <p className="text-white/50 text-[10px] mt-0.5">{company} · {accountCode} · {currency}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-white/40 text-[9px] uppercase tracking-widest">{T("jrn_amount_ytd")}</p>
              <p className={`text-lg font-black ${total >= 0 ? "text-white" : "text-red-300"}`}>{fmtAmt(total)}</p>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
              <X size={13} className="text-white/70" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
<p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">{T("drill_local_breakdown", "Local Account Breakdown")}</p>
          {byLocal.size === 0 ? (
            <p className="text-xs text-gray-400">{T("drill_no_detail", "No detail available.")}</p>
          ) : (
            <div className="space-y-1">
              {[...byLocal.values()].map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {entry.code && <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{entry.code}</span>}
                    <span className="text-xs text-gray-600 truncate">{entry.name || "—"}</span>
                    {entry.dims.length > 0 && (
                      <span className="text-[9px] font-bold text-amber-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        {[...new Set(entry.dims)].join(", ")}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-mono font-bold flex-shrink-0 ml-4 ${entry.amt >= 0 ? "text-[#1a2f8a]" : "text-red-500"}`}>
                    {fmtAmt(entry.amt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnimatedValueCell({ value, className, style, onClick, isSummary }) {
  const animated = useCountUp(value ?? 0, 900);
  const rounded = Math.round(value ?? 0);
  return (
    <td className={className} style={style} onClick={onClick}>
      {rounded === 0 ? <span className="text-gray-200">—</span> : (
        <span className="flex items-center justify-center gap-1">
          {!isSummary && (rounded > 0
            ? <TrendingUp size={9} className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            : <TrendingDown size={9} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
          {fmtAmt(animated)}
        </span>
      )}
    </td>
  );
}

/* ─── Literal-mode helpers ───────────────────────────────────────────────── */

// Build every possible string form of a row's dimension(s), using the dim
// metadata catalogue to expand code-form values to name-form (and vice versa).
// A mapping node may store dims as any of:
//   "Centro de Coste:2", "Centro de Coste:Producción", "2", "Producción"
// We index ALL representations against the same amount so matching is O(1).
//
// `dimResolver` is a function code-or-name → { groupName, groupCode, name, code }[]
// because the same bare value (e.g. "2") might refer to multiple dimension groups.
function buildDimKeys(r, dimResolver) {
  const keys = new Set();
  const addAllForms = (gn, gc, n, c) => {
    if (n)  keys.add(n);
    if (c)  keys.add(c);
    if (gn && n) keys.add(`${gn}:${n}`);
    if (gn && c) keys.add(`${gn}:${c}`);
    if (gc && n) keys.add(`${gc}:${n}`);
    if (gc && c) keys.add(`${gc}:${c}`);
  };

  // 1) Direct fields on the row (consolidated-accounts / journal-entries)
  const dn  = String(r.DimensionName       ?? r.dimensionName       ?? "").trim();
  const dc  = String(r.DimensionCode       ?? r.dimensionCode       ?? "").trim();
  const dgn = String(r.DimensionGroupName  ?? r.dimensionGroupName  ?? "").trim();
  const dgc = String(r.DimensionGroupCode  ?? r.dimensionGroupCode  ?? "").trim();
  if (dn || dc) {
    addAllForms(dgn, dgc, dn, dc);
    // Resolve missing name/code using the catalogue
    if (dimResolver) {
      const hits = dimResolver(dn || dc, dgn || dgc);
      hits.forEach(h => addAllForms(h.groupName, h.groupCode, h.name, h.code));
    }
  }

  // 2) Concatenated "Dimensions" field "G1:V1||G2:V2"
  const dimsField = String(r.Dimensions ?? r.dimensions ?? "").trim();
  if (dimsField) {
    dimsField.split("||").forEach(part => {
      const p = part.trim();
      if (!p) return;
      keys.add(p);
      const colon = p.indexOf(":");
      if (colon > 0) {
        const group = p.slice(0, colon);
        const value = p.slice(colon + 1);
        keys.add(value);
        if (dimResolver) {
          const hits = dimResolver(value, group);
          hits.forEach(h => addAllForms(h.groupName, h.groupCode, h.name, h.code));
        }
      }
    });
  }

  return keys;
}

// Compute a value for a literal node against a pivot.
// - isSum + children → recursive sum of children
// - dims present    → sum only matching dim keys from dimIdx
// - leaf no dims    → direct lookup in pivot
// mode: "object" → reads `pivot.get(code)?.[co]?.total`
//       "scalar" → reads `pivot.get(code)?.[co]`
function computeLiteralForCompany(node, pivot, co, mode = "object", dimIdx = null) {
  if (!pivot) return 0;
  if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
    return node.children.reduce((s, c) => s + computeLiteralForCompany(c, pivot, co, mode, dimIdx), 0);
  }
  if (Array.isArray(node.dims) && node.dims.length > 0 && dimIdx) {
    const m = dimIdx.get(`${node.code}|${co}`);
    if (!m) return 0;
    let total = 0;
    node.dims.forEach(d => { total += (m.get(String(d)) ?? 0); });
    return total;
  }
  const cell = pivot.get(node.code);
  if (!cell) return 0;
  if (mode === "scalar") return Number(cell[co] ?? 0);
  return Number(cell[co]?.total ?? 0);
}

// Same for journal pivot (returns the object {AJE, RJE, ...} aggregated for sums)
function computeLiteralJournalForCompany(node, journalPivot, co, journalDimIdx = null) {
  if (!journalPivot) return {};
  if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
    const out = {};
    node.children.forEach(c => {
      const childJp = computeLiteralJournalForCompany(c, journalPivot, co, journalDimIdx);
      Object.entries(childJp).forEach(([jt, amt]) => { out[jt] = (out[jt] ?? 0) + amt; });
    });
    return out;
  }
  if (Array.isArray(node.dims) && node.dims.length > 0 && journalDimIdx) {
    const m = journalDimIdx.get(`${node.code}|${co}`);
    if (!m) return {};
    const out = {};
    node.dims.forEach(d => {
      const bucket = m.get(String(d));
      if (bucket) Object.entries(bucket).forEach(([jt, amt]) => { out[jt] = (out[jt] ?? 0) + amt; });
    });
    return out;
  }
  return journalPivot.get(node.code)?.[co] ?? {};
}

// Counterparty: scalar like cmpPivot, keyed by counterparty company instead of own company
function computeLiteralCounterpartyForCompany(node, cptyPivot, co, cptyDimIdx = null) {
  if (!cptyPivot) return 0;
  if (node.isSum && Array.isArray(node.children) && node.children.length > 0) {
    return node.children.reduce((s, c) => s + computeLiteralCounterpartyForCompany(c, cptyPivot, co, cptyDimIdx), 0);
  }
  if (Array.isArray(node.dims) && node.dims.length > 0 && cptyDimIdx) {
    const m = cptyDimIdx.get(`${node.code}|${co}`);
    if (!m) return 0;
    let total = 0;
    node.dims.forEach(d => { total += (m.get(String(d)) ?? 0); });
    return total;
  }
  return Number(cptyPivot.get(node.code)?.[co] ?? 0);
}

/* ─── Pivot Row ───────────────────────────────────────────────────────────── */
const INDENT = 14;


function PivotRow({
  node, depth, expandedSet, onToggle, cols, pivot, onCellClick,
  expandedColsMap, journalPivot, compareMode, cmpPivot,
  counterpartyPivot = new Map(),
  isOpen = null, rowMatchesSelf = () => false,
  body1Style, body2Style, colors,
  perspectiveMode, rowIndex = 0,
  breakers = {}, totalColSpan = 10, breakerSortOrder = new Map(),
}) {
  const code        = node.AccountCode;
  const hasChildren = node.children?.length > 0;
  const isExpanded  = isOpen ? isOpen(code) : expandedSet.has(code);
  const isSummary   = /\.S$/i.test(code) || hasChildren;
  const rowStyle    = depth === 0 ? body1Style : body2Style;
  const isMatch     = rowMatchesSelf(node);

  const getVal   = co => pivot.get(code)?.[co]?.total ?? 0;
  const getJp    = co => journalPivot?.get(code)?.[co] ?? {};
  const getSaldo = co => getVal(co);

  const rowTotal    = cols.reduce((s, co) => s + getVal(co), 0);
  // In perspective mode, the consolidated parent total IS the sum of children
  const parentTotal = perspectiveMode ? rowTotal : 0;

  const cellStyle = (v) => {
    const baseColor = v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000";
    return { ...rowStyle, color: baseColor };
  };

  return (
    <>
<tr className={`border-b transition-colors group
        ${isMatch ? "bg-[#fef3c7] border-amber-200" : (isSummary ? "bg-[#ffffff] border-[#1a2f8a]/5" : "bg-white border-gray-200 hover:bg-[#f8f9ff]")}`}
style={{ animation: depth === 0
          ? `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both`
          : `rowExpandIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 15) * 25}ms both`,
          transformOrigin: "top center" }}>

        {/* Account — sticky left */}
        <td className={`py-2.5 sticky left-0 z-10 border-r border-gray-100
          ${isMatch ? "bg-[#fef3c7]" : (isSummary ? "bg-[#ffffff]" : "bg-white group-hover:bg-[#f8f9ff]")}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 280 }}>
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}
            onClick={() => hasChildren && onToggle(code)}>
{hasChildren
              ? <span className="flex-shrink-0 mr-2" style={{ color: rowStyle?.color, display: "inline-flex", transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)", transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
                  <ChevronDown size={12}/>
                </span>
              : <span className="inline-block mr-2" style={{ width: 12 }} />}
            <span className="flex-shrink-0 mr-2" style={rowStyle}>
              {code}
            </span>
            <span className="truncate max-w-[280px]" style={rowStyle}>
              {node.AccountName ?? node.accountName ?? ""}
            </span>
          </div>
        </td>

{/* Parent consolidated column (only in perspective mode) */}
        {perspectiveMode && (
          <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200"
            style={{ minWidth: 160, backgroundColor: "#eef1fb", ...cellStyle(parentTotal) }}>
            {parentTotal === 0 ? <span className="text-gray-300">—</span> : fmtAmt(parentTotal)}
          </td>
        )}

        {/* Per-company values */}
        {cols.flatMap(co => {
          const val        = getVal(co);
          const rows       = pivot.get(code)?.[co]?.rows ?? [];
          const isExpanded = !!expandedColsMap[co];
          const jp         = getJp(co);
          const saldo      = getSaldo(co);

          // Percentage of parent (only meaningful in perspective mode)
          const pct = perspectiveMode && parentTotal !== 0
            ? (saldo / parentTotal) * 100
            : null;

const mainTd = (
            <AnimatedValueCell key={co}
              value={saldo}
              className={`px-4 py-2.5 text-center whitespace-nowrap transition-colors
                ${val !== 0 && rows.length > 0 ? "cursor-pointer hover:bg-[#eef1fb]" : ""}`}
              style={{ minWidth: 130, ...cellStyle(saldo) }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}
              isSummary={isSummary}
            />
          );

          // Percentage cell (perspective mode only)
          const pctTd = perspectiveMode ? (
            <td key={`${co}-pct`}
              className="px-2 py-2.5 text-center whitespace-nowrap"
              style={{ minWidth: 70, backgroundColor: "#fafbff", borderRight: "1px dashed #e0e6f5", ...rowStyle }}>
              {pct === null || pct === 0 || !isFinite(pct) ? (
                <span className="text-gray-300 text-[10px]">—</span>
              ) : (
                <span className={`text-[10px] font-bold ${Math.abs(pct) >= 50 ? "text-indigo-700" : "text-indigo-500"}`}>
                  {pct.toFixed(1)}%
                </span>
              )}
            </td>
          ) : null;

const cmpVal = compareMode ? (cmpPivot?.get(code)?.[co] ?? 0) : 0;
          const dev = compareMode ? saldo - cmpVal : 0;
          const devPct = compareMode && cmpVal !== 0 ? (dev / Math.abs(cmpVal)) * 100 : null;
          const devColor = dev === 0 ? "#D1D5DB" : dev > 0 ? "#059669" : "#EF4444";
          const cmpTd = compareMode ? (
            <AnimatedValueCell key={`${co}-cmp`}
              value={cmpVal}
              className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{ minWidth: 130, ...rowStyle, background: `${colors.primary}08`, animation: "subColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 60ms both", transformOrigin: "left center" }}
              isSummary={isSummary}
            />
          ) : null;
          const deltaTd = compareMode ? (
            <td key={`${co}-delta`}
              className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{ minWidth: 110, ...rowStyle, color: devColor, background: `${colors.primary}12`, animation: "subColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 120ms both", transformOrigin: "left center" }}>
              {dev === 0 ? "—" : `${dev > 0 ? "+" : ""}${fmtAmt(dev)}`}
            </td>
          ) : null;
          const pctDeltaTd = compareMode ? (
            <td key={`${co}-deltapct`}
              className="px-3 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{ minWidth: 80, ...rowStyle, color: !devPct ? "#D1D5DB" : devPct > 0 ? "#059669" : "#EF4444", background: `${colors.primary}1e`, animation: "subColIn 380ms cubic-bezier(0.34,1.56,0.64,1) 180ms both", transformOrigin: "left center" }}>
              {devPct !== null ? `${devPct > 0 ? "+" : ""}${devPct.toFixed(1)}%` : "—"}
            </td>
          ) : null;
          if (!isExpanded) return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : [])];

// Uploaded = Total - Σ(all journal types). This is the ERP carry (pre-journals).
          const journalsTotal = Object.values(jp).reduce((s, v) => s + (Number(v) || 0), 0);
          const uploadedVal = val - journalsTotal;
          const uploadedTd = (
            <td key={`${co}-uploaded`}
              className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
              style={{ minWidth: 110, ...cellStyle(uploadedVal), background: `${colors.primary}06`,
                transformOrigin: "left center",
                animation: `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) 0ms both` }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}>
              {Math.abs(uploadedVal) < 0.005 ? "—" : fmtAmt(uploadedVal)}
            </td>
          );

const subTds = SUB_COLS.map((sc, idx) => {
            const subVal = jp[sc.key] ?? 0;
            return (
              <td key={`${co}-${sc.key}`}
                className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-100"
                style={{ minWidth: 100, ...cellStyle(subVal), background: `${colors.primary}${String(Math.min(4 + (idx+1) * 2, 14)).padStart(2, "0")}`,
                  transformOrigin: "left center",
                  animation: `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) ${(idx+1) * 30}ms both` }}>
                {subVal === 0 ? "—" : fmtAmt(subVal)}
              </td>
            );
          });

// IC cell — counterparty impact (always shown when company is expanded)
          const icVal = counterpartyPivot.get(code)?.[co] ?? 0;
          const icTd = (
            <td key={`${co}-ic`}
              className="px-3 py-2.5 text-center whitespace-nowrap"
              style={{
                minWidth: 110,
                ...rowStyle,
                color: icVal === 0 ? "#D1D5DB" : icVal < 0 ? "#EF4444" : "#CF305D",
                background: "#CF305D08",
                borderLeft: `2px dashed #CF305D30`,
                transformOrigin: "left center",
                animation: `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) ${(SUB_COLS.length + 1) * 30}ms both`,
              }}>
              {icVal === 0 ? "—" : fmtAmt(icVal)}
            </td>
          );

          return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : []), uploadedTd, ...subTds, icTd];
        })}

{!perspectiveMode && (
  <td className="px-4 py-2.5 text-center whitespace-nowrap sticky right-0 z-10 border-l border-gray-100"
    style={{ minWidth: 140, backgroundColor: "#fafafa", ...cellStyle(rowTotal) }}>
    {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
  </td>
)}
      </tr>

{isExpanded && hasChildren && (() => {
        const inMapping = node.children.filter(c => breakerSortOrder.has(c.AccountCode));
        const notInMapping = node.children.filter(c => !breakerSortOrder.has(c.AccountCode));
        const hasAnyMapping = inMapping.length > 0;
        const sorted = hasAnyMapping
          ? [
              ...notInMapping.sort((a, b) => pgcSort(a, b)),
              ...inMapping.sort((a, b) => (breakerSortOrder.get(a.AccountCode) ?? 9999) - (breakerSortOrder.get(b.AccountCode) ?? 9999)),
            ]
          : node.children;
        return sorted.map((child, ci) => {
        const breaker = breakers[child.AccountCode] ?? null;
        return (
          <React.Fragment key={child.AccountCode}>
            {breaker && (
              <tr style={{ animation: `rowExpandIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(ci, 15) * 25}ms both`, transformOrigin: "top center" }}>
                <td className="sticky left-0 z-10 px-5 py-1.5"
                  style={{ paddingLeft: `${16 + (depth + 1) * INDENT}px`, backgroundColor: breaker.color }}>
                  <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "#fff", opacity: 0.92 }}>
                    {breaker.label}
                  </span>
                </td>
                <td colSpan={totalColSpan - 1} style={{ backgroundColor: breaker.color, opacity: 0.85 }} />
              </tr>
            )}
<PivotRow node={child} depth={depth + 1}
              expandedSet={expandedSet} onToggle={onToggle}
              isOpen={isOpen} rowMatchesSelf={rowMatchesSelf}
              cols={cols} pivot={pivot} onCellClick={onCellClick}
              expandedColsMap={expandedColsMap} journalPivot={journalPivot}
              counterpartyPivot={counterpartyPivot}
              compareMode={compareMode} cmpPivot={cmpPivot}
              body1Style={body1Style} body2Style={body2Style} colors={colors}
              perspectiveMode={perspectiveMode} rowIndex={ci}
              breakers={breakers}
            breakerSortOrder={breakerSortOrder} totalColSpan={totalColSpan} breakerSortOrder={breakerSortOrder}
            />
</React.Fragment>
        );
        });
      })()}
    </>
  );
}

/* ─── LiteralPivotRow — recursive render of a saved-mapping literal node ── */
function LiteralPivotRow({
  node, depth, expandedSet, onToggle, cols, pivot, onCellClick,
  expandedColsMap, journalPivot, counterpartyPivot,
  compareMode, cmpPivot,
  body1Style, body2Style, colors,
  perspectiveMode, rowIndex = 0,
  totalColSpan = 10,
  accountMapForDrill,
  highlightedIds,
  dimIdx = null, journalDimIdx = null, cptyDimIdx = null, cmpDimIdx = null,
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isSum = !!node.isSum && hasChildren;
  const isLeaf = !hasChildren;
  const isExpanded = expandedSet.has(node.id);
  const rowStyle = depth === 0 ? body1Style : body2Style;
  const isHighlighted = highlightedIds && (highlightedIds.has(node.id) || (node.originalId && highlightedIds.has(node.originalId)));

const getVal = (co) => computeLiteralForCompany(node, pivot, co, "object", dimIdx);
  const getJp  = (co) => computeLiteralJournalForCompany(node, journalPivot, co, journalDimIdx);
  const getCmp = (co) => compareMode ? computeLiteralForCompany(node, cmpPivot, co, "scalar", cmpDimIdx) : 0;
  const getIc  = (co) => computeLiteralCounterpartyForCompany(node, counterpartyPivot, co, cptyDimIdx);

  const rowTotal    = cols.reduce((s, co) => s + getVal(co), 0);
  const parentTotal = perspectiveMode ? rowTotal : 0;

  const cellStyle = (v) => ({
    ...rowStyle,
    color: v === 0 ? "#D1D5DB" : v < 0 ? "#EF4444" : "#000000",
  });

  // Drill is only meaningful for real leaves (the code exists in the standard
  // accountMap and has rows). Sums and abstract aggregates → no drill.
  const drillRowsFor = (co) => {
    if (!isLeaf) return [];
    return pivot.get(node.code)?.[co]?.rows ?? [];
  };

  return (
    <>
      <tr className={`border-b transition-colors group
        ${isHighlighted ? "bg-amber-50/60 border-amber-200"
          : isSum ? "bg-[#f8f9ff] border-[#1a2f8a]/10 font-semibold"
          : depth === 0 ? "bg-white border-[#1a2f8a]/5"
          : "bg-white border-gray-200 hover:bg-[#f8f9ff]"}`}
        style={{
          animation: depth === 0
            ? `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 25) * 35 + 50}ms both`
            : `rowExpandIn 280ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(rowIndex, 15) * 25}ms both`,
          transformOrigin: "top center",
        }}>

        {/* Account column — sticky */}
        <td className={`py-2.5 sticky left-0 z-10 border-r border-gray-100
          ${isHighlighted ? "bg-amber-50/60"
            : isSum ? "bg-[#f8f9ff]"
            : "bg-white group-hover:bg-[#f8f9ff]"}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 280 }}>
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}
            onClick={() => hasChildren && onToggle(node.id)}>
            {hasChildren ? (
              <span className="flex-shrink-0 mr-2" style={{
                color: rowStyle?.color,
                display: "inline-flex",
                transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1)",
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
              }}>
                <ChevronDown size={12} />
              </span>
            ) : (
              <span className="inline-block mr-2" style={{ width: 12 }} />
            )}
            {isHighlighted && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" className="mr-1.5 flex-shrink-0">
                <polygon points="12,2 15,9 22,9.5 17,15 18.5,22 12,18 5.5,22 7,15 2,9.5 9,9" />
              </svg>
            )}
            <span className="flex-shrink-0 mr-2 opacity-60 tabular-nums" style={{ ...rowStyle, fontSize: 11 }}>
              {node.code}
            </span>
            <span className="truncate max-w-[280px]" style={rowStyle}>
              {node.name}
            </span>
            {Array.isArray(node.dims) && node.dims.length > 0 && (
              <span className="ml-2 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">
                {node.dims.length === 1 ? node.dims[0] : `${node.dims.length} dims`}
              </span>
            )}
            {isSum && (
              <span className="ml-2 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: `${colors.primary}12`, color: colors.primary }}>
                Σ
              </span>
            )}
          </div>
        </td>

        {/* Perspective parent col */}
        {perspectiveMode && (
          <td className="px-4 py-2.5 text-center whitespace-nowrap border-l border-gray-200"
            style={{ minWidth: 160, backgroundColor: "#eef1fb", ...cellStyle(parentTotal) }}>
            {parentTotal === 0 ? <span className="text-gray-300">—</span> : fmtAmt(parentTotal)}
          </td>
        )}

        {/* Per-company cells */}
        {cols.flatMap(co => {
          const val = getVal(co);
          const cmpVal = getCmp(co);
          const dev = val - cmpVal;
          const devPct = compareMode && cmpVal !== 0 ? (dev / Math.abs(cmpVal)) * 100 : null;
          const pct = perspectiveMode && parentTotal !== 0 ? (val / parentTotal) * 100 : null;
          const expanded = !!expandedColsMap[co];
          const drillRows = drillRowsFor(co);

          const mainTd = (
            <td key={co}
              className={`px-4 py-2.5 text-center whitespace-nowrap transition-colors tabular-nums
                ${val !== 0 && drillRows.length > 0 ? "cursor-pointer hover:bg-[#eef1fb]" : ""}`}
              style={{ minWidth: 130, ...cellStyle(val) }}
              onClick={() => val !== 0 && drillRows.length > 0 && onCellClick(node, co, drillRows)}>
              {val === 0 ? <span className="text-gray-200">—</span> : fmtAmt(val)}
            </td>
          );

          const pctTd = perspectiveMode ? (
            <td key={`${co}-pct`}
              className="px-2 py-2.5 text-center whitespace-nowrap"
              style={{ minWidth: 70, backgroundColor: "#fafbff", borderRight: "1px dashed #e0e6f5", ...rowStyle }}>
              {pct === null || pct === 0 ? (
                <span className="text-gray-300 text-[10px]">—</span>
              ) : (
                <span className="text-[10px] font-bold" style={{ color: "#6366f1" }}>{pct.toFixed(1)}%</span>
              )}
            </td>
          ) : null;

          const cmpTd = compareMode ? (
            <td key={`${co}-cmp`}
              className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{ minWidth: 130, ...rowStyle, background: `${colors.primary}08` }}>
              {cmpVal === 0 ? <span className="text-gray-300">—</span> : fmtAmt(cmpVal)}
            </td>
          ) : null;
          const deltaTd = compareMode ? (
            <td key={`${co}-delta`}
              className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{ minWidth: 110, ...rowStyle, color: dev === 0 ? "#D1D5DB" : dev > 0 ? "#059669" : "#EF4444", background: `${colors.primary}12` }}>
              {dev === 0 ? "—" : `${dev > 0 ? "+" : ""}${fmtAmt(dev)}`}
            </td>
          ) : null;
          const pctDeltaTd = compareMode ? (
            <td key={`${co}-deltapct`}
              className="px-3 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{ minWidth: 80, ...rowStyle, color: !devPct ? "#D1D5DB" : devPct > 0 ? "#059669" : "#EF4444", background: `${colors.primary}1e` }}>
              {devPct !== null ? `${devPct > 0 ? "+" : ""}${devPct.toFixed(1)}%` : "—"}
            </td>
          ) : null;

          if (!expanded) return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : [])];

          const jp = getJp(co);
          const journalsTotal = Object.values(jp).reduce((s, v) => s + (Number(v) || 0), 0);
          const uploadedVal = val - journalsTotal;
          const uploadedTd = (
            <td key={`${co}-uploaded`}
              className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-100 tabular-nums"
              style={{ minWidth: 110, ...cellStyle(uploadedVal), background: `${colors.primary}06` }}>
              {Math.abs(uploadedVal) < 0.005 ? "—" : fmtAmt(uploadedVal)}
            </td>
          );
          const subTds = SUB_COLS.map((sc, idx) => {
            const subVal = jp[sc.key] ?? 0;
            return (
              <td key={`${co}-${sc.key}`}
                className="px-3 py-2.5 text-center whitespace-nowrap border-l border-gray-100 tabular-nums"
                style={{ minWidth: 100, ...cellStyle(subVal), background: `${colors.primary}${String(Math.min(4 + (idx+1) * 2, 14)).padStart(2, "0")}` }}>
                {subVal === 0 ? "—" : fmtAmt(subVal)}
              </td>
            );
          });
          const icVal = getIc(co);
          const icTd = (
            <td key={`${co}-ic`}
              className="px-3 py-2.5 text-center whitespace-nowrap tabular-nums"
              style={{
                minWidth: 110,
                ...rowStyle,
                color: icVal === 0 ? "#D1D5DB" : icVal < 0 ? "#EF4444" : "#CF305D",
                background: "#CF305D08",
                borderLeft: "2px dashed #CF305D30",
              }}>
              {icVal === 0 ? "—" : fmtAmt(icVal)}
            </td>
          );

          return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), ...(deltaTd ? [deltaTd] : []), ...(pctDeltaTd ? [pctDeltaTd] : []), uploadedTd, ...subTds, icTd];
        })}

        {!perspectiveMode && (
          <td className="px-4 py-2.5 text-center whitespace-nowrap sticky right-0 z-10 border-l border-gray-100 tabular-nums"
            style={{ minWidth: 140, backgroundColor: "#fafafa", ...cellStyle(rowTotal) }}>
            {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
          </td>
        )}
      </tr>

{isExpanded && hasChildren && node.children.map((child, ci) => (
        <LiteralPivotRow key={child.id}
          node={child} depth={depth + 1}
          expandedSet={expandedSet} onToggle={onToggle}
          cols={cols} pivot={pivot} onCellClick={onCellClick}
          expandedColsMap={expandedColsMap} journalPivot={journalPivot}
          counterpartyPivot={counterpartyPivot}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style} colors={colors}
          perspectiveMode={perspectiveMode} rowIndex={ci}
          totalColSpan={totalColSpan}
          accountMapForDrill={accountMapForDrill}
          highlightedIds={highlightedIds}
          dimIdx={dimIdx} journalDimIdx={journalDimIdx} cptyDimIdx={cptyDimIdx} cmpDimIdx={cmpDimIdx}
        />
      ))}
    </>
  );
}

function SyncedTable({
  T,
  cols, tree, expandedSet, expandedColsMap, toggleCol, toggleExpand, pivot, journalPivot, accountMap, companies,
  counterpartyPivot = new Map(),
 groupStructure, hasData, collapseAll, expandAll, setDrilldown, getReportingCurrency, breakers = {}, breakerSortOrder = new Map(),
  body1Style, body2Style, header3Style, colors,
compareMode, cmpPivot,
  perspectiveMode = false, perspectiveParent = "", reorderCols = () => {},
  treeLiteral = null, highlightedIds = null,
  dimIdx = null, journalDimIdx = null, cptyDimIdx = null, cmpDimIdx = null,
}) {
const [dragCol, setDragCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [exitingCols, setExitingCols] = useState(new Set());
  const [headerHover, setHeaderHover] = useState(null);
  const onHeaderHover = setHeaderHover;

  // ── Search state ─────────────────────────────────────────────────────
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef(null);

  // Build the set of account codes whose subtree contains a match. Used to
  // force-open ancestors of matching rows so they're visible.
  const searchExpansionSet = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return null;
    const out = new Set();
    const matchesSelf = (node) => {
      const code = String(node.AccountCode ?? "").toLowerCase();
      const name = String(node.AccountName ?? node.accountName ?? "").toLowerCase();
      return code.includes(q) || name.includes(q);
    };
    const walk = (node) => {
      let descendantMatch = false;
      (node.children || []).forEach(child => { if (walk(child)) descendantMatch = true; });
      const self = matchesSelf(node);
      if (descendantMatch && node.children?.length > 0) out.add(node.AccountCode);
      return self || descendantMatch;
    };
    tree.forEach(walk);
    return out;
  }, [debouncedQuery, tree]);

  // Combined open-check — search forces nodes open without touching expandedSet.
  const isOpen = useCallback((code) => {
    if (searchExpansionSet?.has(code)) return true;
    return expandedSet.has(code);
  }, [expandedSet, searchExpansionSet]);

  // Per-row self-match (uses non-deferred query for instant highlight feedback).
  const rowMatchesSelf = useCallback((node) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return false;
    const code = String(node.AccountCode ?? "").toLowerCase();
    const name = String(node.AccountName ?? node.accountName ?? "").toLowerCase();
    return code.includes(q) || name.includes(q);
  }, [searchQuery]);

  // Autofocus the input when search activates.
  useEffect(() => {
    if (searchActive && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchActive]);
const totalColSpan = useMemo(() => {
    let n = perspectiveMode ? 1 : 2;
    if (perspectiveMode) n += 1; // parent consolidated col
    cols.forEach(co => {
      n += 1;
      if (perspectiveMode) n += 1; // pct col
     if (compareMode) n += 3;
      if (expandedColsMap[co]) n += 1 + SUB_COLS.length + 1; // uploaded + journals + IC
    });
    return n;
  }, [cols, expandedColsMap, compareMode, perspectiveMode]);

  const bodyRef = useRef(null);

  // Compute column widths once based on expandedColsMap
const colWidths = useMemo(() => {
    const widths = [320];
    if (perspectiveMode) widths.push(180); // parent total
    cols.forEach(co => {
      widths.push(160);
      if (perspectiveMode) widths.push(80); // pct
      if (compareMode) { widths.push(130); widths.push(110); widths.push(80); }
if (expandedColsMap[co]) {
        widths.push(140);
        SUB_COLS.forEach(() => widths.push(120));
        widths.push(140); // IC col
      }
    });
if (!perspectiveMode) widths.push(160);
return widths;
  }, [cols, expandedColsMap, compareMode, perspectiveMode]);

  const colgroup = (
    <colgroup>
      {colWidths.map((w, i) => <col key={i} style={{ width: w, minWidth: w }} />)}
    </colgroup>
  );

  const parentLegalName = perspectiveMode
    ? (companies.find(c => (c.CompanyShortName ?? c.companyShortName) === perspectiveParent)?.CompanyLegalName
       ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === perspectiveParent)?.companyLegalName
       ?? perspectiveParent)
    : "";

  const headerCols = cols.flatMap(co => {
    const isExp = !!expandedColsMap[co];
    const legalName = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName
      ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.companyLegalName ?? co;
const isDragging = dragCol === co;
    const isDragOver = dragOverCol === co && dragCol !== co;
const main = (
      <th key={co}
        draggable
        onDragStart={(e) => {
          setDragCol(co);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", co);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dragOverCol !== co) setDragOverCol(co);
        }}
        onDragLeave={() => { if (dragOverCol === co) setDragOverCol(null); }}
        onDrop={(e) => {
          e.preventDefault();
          const from = e.dataTransfer.getData("text/plain") || dragCol;
          if (from && from !== co) reorderCols(from, co);
          setDragCol(null);
          setDragOverCol(null);
        }}
        onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
        onMouseEnter={() => isExp && onHeaderHover?.({
          kind: "company",
          title: legalName,
          body: `Contribution column for ${legalName} (${co}). This is the company's amount already consolidated to the parent's reporting currency, with all of its own journals applied. The breakdown to the right shows: Uploaded (raw ERP) + AJE + RJE + EJE + SYS + CFA = this total. The IC column shows journals posted by OTHER companies that reference ${co} as counterparty (not included in the total).`,
        })}
        onMouseLeave={() => onHeaderHover?.(null)}
className="px-4 select-none cursor-grab"
        style={{
          background: isDragOver ? `${colors.primary}15` : "rgba(255,255,255,0.95)",
          borderLeft: "1px solid #f0f0f0",
          opacity: isDragging ? 0.4 : 1,
          outline: isDragOver ? `2px solid ${colors.primary}` : "none",
          transition: "background 150ms ease, outline 150ms ease",
        }}
        onClick={() => {
          const isExp = !!expandedColsMap[co];
          if (isExp) {
            setExitingCols(prev => new Set([...prev, co]));
            setTimeout(() => {
              toggleCol(co);
              setExitingCols(prev => { const n = new Set(prev); n.delete(co); return n; });
            }, 250);
          } else {
            toggleCol(co);
          }
        }}>
<div className="flex flex-col items-center gap-0.5 py-4">
          <span className="font-black tracking-tight truncate max-w-[140px]" style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }} title={legalName}>{legalName}</span>
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>{getReportingCurrency(co, groupStructure, companies)}</span>
        </div>
      </th>
    );
const pctTh = perspectiveMode ? (
      <th key={`${co}-pct`}
        className="px-2 whitespace-nowrap"
        style={{ background: `${colors.primary}08`, borderLeft: "1px dashed #f0f0f0" }}>
        <div className="flex justify-center py-4 font-black text-[11px]" style={{ color: `${colors.primary}70` }}>%</div>
      </th>
    ) : null;
const cmpTh = compareMode ? (
      <>
<th key={`${co}-cmp`} className="text-center px-4 whitespace-nowrap"
          style={{ background: `${colors.primary}08`, borderLeft: `2px solid ${colors.primary}15` }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>CMP</span>
        </th>
        <th key={`${co}-delta`} className="text-center px-3 whitespace-nowrap"
          style={{ background: `${colors.primary}12` }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ</span>
        </th>
        <th key={`${co}-deltapct`} className="text-center px-3 whitespace-nowrap"
          style={{ background: `${colors.primary}1e` }}>
          <span className="font-black py-4 block" style={{ color: colors.primary, fontSize: 12, opacity: 0.7 }}>Δ%</span>
        </th>
      </>
    ) : null;
if (!isExp) return [main, ...(pctTh ? [pctTh] : []), ...(cmpTh ? [cmpTh] : [])];
const SUB_COL_DESCRIPTIONS = {
      uploaded: { title: "Uploaded", body: "Raw ERP carry, before any manual or system journals. This is what the company originally uploaded for this account." },
      AJE:      { title: "AJE — Adjustment Journal Entry", body: "Manual accounting adjustments posted directly to this company on this account (e.g. provisions, accruals, corrections)." },
      RJE:      { title: "RJE — Reclassification Journal Entry", body: "Manual reclassifications between accounts (e.g. moving an amount from \"Other income\" to \"Revenue\")." },
      EJE:      { title: "EJE — Elimination Journal Entry", body: "Inter-company elimination postings registered by this company. Used to remove intra-group transactions in consolidation." },
      SYS:      { title: "SYS — System Journal", body: "System-generated journal, typically result-distribution postings that move profit/loss into retained earnings at year-end." },
      CFA:      { title: "CFA — Carry Forward Adjustment", body: "System-generated counter-entry to SYS. Records the profit/loss of the year on the corresponding B/S and DIS accounts." },
    };

    const subColsAll = [{ key: "uploaded", label: "Uploaded" }, ...SUB_COLS];
    const subThs = subColsAll.map((sc, idx) => {
      const desc = SUB_COL_DESCRIPTIONS[sc.key];
      return (
        <th key={`${co}-${sc.key}`}
          className="px-3 whitespace-nowrap"
          onMouseEnter={() => desc && onHeaderHover?.({ ...desc, kind: "subcol" })}
          onMouseLeave={() => onHeaderHover?.(null)}
          style={{
            background: idx === 0 ? `${colors.primary}06` : `${colors.primary}${String(Math.min(4 + idx * 2, 14)).padStart(2, "0")}`,
            borderLeft: `1px solid ${colors.primary}15`,
            transformOrigin: "left center",
            animation: exitingCols.has(co)
              ? `subColIn 220ms cubic-bezier(0.4,0,0.2,1) reverse both`
              : `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) ${idx * 30}ms both`,
          }}>
          <div className="flex flex-col items-center gap-0.5 py-4">
            <span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 11, opacity: 0.6 + idx * 0.08 }}>{sc.label}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}40` }}>{legalName}</span>
          </div>
        </th>
      );
    });

    // IC column — always visible when company is expanded (no toggle)
    const icTh = (
      <th key={`${co}-ic`}
        className="px-3 whitespace-nowrap"
        onMouseEnter={() => onHeaderHover?.({
          kind: "subcol",
          title: "IC — Counterparty Impact",
          body: "Sum of all journals (AJE/RJE/EJE/SYS/CFA) posted by OTHER companies that name this company as counterparty. These are not journals this company posted; they are cross-company entries that touch it.",
        })}
        onMouseLeave={() => onHeaderHover?.(null)}
        style={{
          background: "#CF305D08",
          borderLeft: `2px dashed #CF305D30`,
          transformOrigin: "left center",
          animation: `subColIn 320ms cubic-bezier(0.34,1.56,0.64,1) ${(SUB_COLS.length + 1) * 30}ms both`,
        }}>
        <div className="flex flex-col items-center gap-0.5 py-4">
          <span className="font-black tracking-tight" style={{ color: "#CF305D", fontSize: 11 }}>↪ IC</span>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#CF305D80" }}>{legalName}</span>
        </div>
      </th>
    );

    return [main, ...(pctTh ? [pctTh] : []), ...(cmpTh ? [cmpTh] : []), ...subThs, icTh];
  });

return (
    <>
    {headerHover && (
      <div className="fixed z-[9998] pointer-events-none rounded-2xl"
        style={{
          top: 80, right: 24, maxWidth: 360,
          background: headerHover.kind === "company"
            ? "linear-gradient(135deg, rgba(26,47,138,0.97) 0%, rgba(40,64,168,0.97) 100%)"
            : "linear-gradient(135deg, rgba(207,48,93,0.97) 0%, rgba(224,85,141,0.97) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.15) inset",
          padding: "16px 18px",
          animation: "tooltipIn 220ms cubic-bezier(0.34,1.56,0.64,1)",
        }}>
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/55 mb-1.5">
          {headerHover.kind === "company" ? "Company column" : "Subcolumn"}
        </p>
        <p className="font-black text-white text-base mb-2 leading-tight">{headerHover.title}</p>
        <p className="text-[12px] text-white/85 leading-relaxed">{headerHover.body}</p>
      </div>
    )}
    <style>{`
      @keyframes tooltipIn {
        from { opacity: 0; transform: translateX(8px) scale(0.96); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
    `}</style>
    <div ref={bodyRef} className="contributive-body"
      style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%", tableLayout: "auto", borderSpacing: 0 }}>
        {colgroup}
<thead style={{ position: "sticky", top: 0, zIndex: 20 }}>
          <tr style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 4px 24px -8px rgba(26,47,138,0.10), 0 1px 3px rgba(0,0,0,0.04)" }}>
<th className="sticky left-0 z-30 text-left px-6 border-r border-gray-100"
              style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", height: 64 }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* Search icon — always visible, toggles input on/off */}
<button
                    onClick={() => setSearchActive(a => !a)}
                    title={T("search_accounts_placeholder")}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      color: searchActive ? colors.primary : "#94a3b8",
                      transition: "color 240ms cubic-bezier(0.4,0,0.2,1)",
                      padding: 2,
                    }}>
                    <Search size={13} strokeWidth={2.4} />
                  </button>

                  {searchActive ? (
                    <>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Escape") {
                            setSearchActive(false);
                            setSearchQuery("");
                          }
                        }}
                        placeholder={T("search_code_or_name")}
                        className="bg-transparent outline-none flex-1 min-w-0"
                        style={{
                          color: colors.primary,
                          fontWeight: 800,
                          fontSize: 16,
                          letterSpacing: "-0.01em",
                          width: 240,
                        }}
                      />
<button
                        onClick={() => { setSearchActive(false); setSearchQuery(""); }}
                        title={T("close_search")}
                        className="flex items-center justify-center flex-shrink-0"
                        style={{ color: "#94a3b8", padding: 2 }}>
                        <X size={14} strokeWidth={2.4} />
                      </button>
                    </>
                  ) : (
                    <div
                      onClick={() => setSearchActive(true)}
                      className="flex items-baseline gap-2.5 cursor-pointer select-none">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 18, letterSpacing: "-0.02em" }}>{T("kicker_accounts")}</span>
                      <span className="font-black uppercase tracking-[0.22em]" style={{ color: `${colors.primary}80`, fontSize: 10 }}>{T("contrib_label", "Contribution")}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
{hasData && (() => {
                    const anyExpanded = expandedSet.size > 0;
                    return (
                      <button
                        onClick={() => anyExpanded ? collapseAll() : expandAll()}
                        title={anyExpanded ? T("btn_collapse_all") : T("btn_expand_all")}
                        className="flex items-center justify-center w-8 h-8 rounded-lg relative overflow-hidden"
style={{
                          color: anyExpanded ? colors.primary : "#94a3b8",
                          background: "transparent",
                          transition: "color 240ms cubic-bezier(0.4,0,0.2,1)",
                        }}>
{/* Collapsed: two chevrons (^ on top, v on bottom). Expanded: X. */}
                        <span key={anyExpanded ? "collapse" : "expand"}
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ animation: "iconMorph 360ms cubic-bezier(0.34,1.56,0.64,1)" }}>
                          {anyExpanded ? (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 3 L13 13" />
                              <path d="M13 3 L3 13" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6 L8 1 L13 6" />
                              <path d="M3 10 L8 15 L13 10" />
                            </svg>
                          )}
                        </span>
                      </button>
                    );
                  })()}
                </div>
              </div>
            </th>

{/* Parent consolidated column header */}
{perspectiveMode && (
              <th className="px-4 py-3 whitespace-nowrap border-l border-gray-100"
                style={{ background: "rgba(255,255,255,0.95)" }}>
                <div className="flex flex-col items-center gap-0.5 py-4">
                  <span className="font-black tracking-tight truncate max-w-[160px]"
                    style={{ color: colors.primary, fontSize: 13, letterSpacing: "-0.01em" }}
                    title={parentLegalName}>
                    {parentLegalName}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-widest"
                    style={{ color: `${colors.primary}60` }}>
                    {T("col_consolidated").toUpperCase()} · {perspectiveParent}
                  </span>
                </div>
              </th>
            )}

            {headerCols}
{!perspectiveMode && (
  <th className="sticky right-0 z-10 px-4 whitespace-nowrap border-l border-gray-100"
    style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px)" }}>
    <div className="flex flex-col items-center gap-0.5 py-4">
<span className="font-black tracking-tight" style={{ color: colors.primary, fontSize: 13 }}>{T("col_total")}</span>
      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: `${colors.primary}60` }}>/ {T("col_avg")}</span>
    </div>
  </th>
)}
          </tr>

        </thead>
<tbody>
{treeLiteral ? (
  // ── LITERAL MODE — render sections + recursive nodes ────────────────
  treeLiteral.map((section, secIdx) => (
    <React.Fragment key={`lit-sec-${secIdx}`}>
      {section.label && (
        <tr style={{ height: 28 }}>
          <td colSpan={totalColSpan}
            style={{ backgroundColor: section.color || colors.primary, padding: 0, height: 28 }}>
            <div className="sticky left-0 px-5 py-1.5" style={{ width: "fit-content" }}>
              <span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "#fff", opacity: 0.95 }}>
                {section.label}
              </span>
            </div>
          </td>
        </tr>
      )}
{section.nodes.map((n, ni) => (
        <LiteralPivotRow key={n.id}
          node={n} depth={0}
          expandedSet={expandedSet} onToggle={toggleExpand}
          cols={cols} pivot={pivot}
          onCellClick={(node, co, rows) => setDrilldown({ node, company: co, rows })}
          expandedColsMap={expandedColsMap} journalPivot={journalPivot}
          counterpartyPivot={counterpartyPivot}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style} colors={colors}
          perspectiveMode={perspectiveMode} rowIndex={ni}
          totalColSpan={totalColSpan}
          accountMapForDrill={accountMap}
          highlightedIds={highlightedIds}
          dimIdx={dimIdx} journalDimIdx={journalDimIdx} cptyDimIdx={cptyDimIdx} cmpDimIdx={cmpDimIdx}
        />
      ))}
    </React.Fragment>
  ))
) : (
  // ── STANDARD MODE — original render path ───────────────────────────
  tree.map((node, i) => {
            const type = node.AccountType ?? node.accountType ?? "";
            const prevType = i > 0 ? (tree[i-1].AccountType ?? tree[i-1].accountType ?? "") : null;
            const showDivider = type !== prevType;
const TYPE_LABELS = {
              "P/L": { label: T("page_pl_full"),                                       color: colors.primary,   darken: true },
              "DIS": { label: T("contrib_dist_result", "Distribution of Result"),      color: colors.primary,   },
              "B/S": { label: T("page_bs_full"),                                       color: colors.secondary               },
              "C/F": { label: T("nav_cashflow"),                                       color: colors.tertiary                },
              "CFS": { label: T("nav_cashflow"),                                       color: colors.tertiary                },
            };
            const divider = showDivider ? (TYPE_LABELS[type] ?? { label: type, color: colors.quaternary }) : null;
            return (
              <>
{breakers[node.AccountCode] && (
              <tr key={`breaker-${node.AccountCode}`}
                style={{ animation: `plRowSlideIn 400ms cubic-bezier(0.34,1.56,0.64,1) ${Math.min(i, 25) * 35}ms both`, height: 24 }}>
                <td colSpan={totalColSpan}
                  style={{ backgroundColor: breakers[node.AccountCode].color, padding: 0, height: 24 }}>
                  <div className="sticky left-0 px-5 py-1.5" style={{ width: "fit-content" }}>
                    <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "#fff", opacity: 0.92 }}>
                      {breakers[node.AccountCode].label}
                    </span>
                  </div>
                </td>
              </tr>
            )}
{divider && (
                  <tr key={`divider-${node.AccountCode}`} style={{ height: 28 }}>
                    <td
                      colSpan={totalColSpan}
                      style={{
                        backgroundColor: divider.color,
                        boxShadow: divider.darken ? "inset 0 0 0 9999px rgba(0,0,0,0.2)" : undefined,
                        padding: 0,
                        height: 28,
                      }}>
                      <div className="sticky left-0 px-5 py-1.5" style={{ width: "fit-content" }}>
                        <span style={{ ...header3Style, textTransform: "uppercase", color: "#fff" }}>
                          {divider.label}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
<PivotRow key={node.AccountCode} node={node} depth={0}
                  expandedSet={expandedSet} onToggle={toggleExpand}
                  isOpen={isOpen} rowMatchesSelf={rowMatchesSelf}
                  cols={cols} pivot={pivot}
                  onCellClick={(node, co, rows) => setDrilldown({ node, company: co, rows })}
                  expandedColsMap={expandedColsMap} journalPivot={journalPivot}
                  counterpartyPivot={counterpartyPivot}
                  compareMode={compareMode} cmpPivot={cmpPivot}
                  body1Style={body1Style} body2Style={body2Style} colors={colors}
                  perspectiveMode={perspectiveMode} rowIndex={i}
                  breakers={breakers}
            breakerSortOrder={breakerSortOrder} totalColSpan={totalColSpan} breakerSortOrder={breakerSortOrder}
                />
              </>
            );
          })
)}
</tbody>
      </table>
    </div>
    </>
  );
}

/* ─── JournalsPill — multi-select pill (extracted to module scope so its state survives parent re-renders) */
function JournalsPill({ T, label, values, onChange, options, colors }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  const ddRef = useRef(null);

  useEffect(() => {
    const h = e => {
      const inPill = ref.current && ref.current.contains(e.target);
      const inDd = ddRef.current && ddRef.current.contains(e.target);
      if (!inPill && !inDd) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (!open) return;
    let rafId;
    const track = () => {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  const active = values.length > 0;
  const showLabel = active || hover || open;
const display = !active
    ? T("all")
    : values.length === 1
      ? values[0]
      : `${values.length} ${T("jrn_selected", "selected")}`;

  const toggle = (o) => {
    if (values.includes(o)) onChange(values.filter(v => v !== o));
    else onChange([...values, o]);
  };

  return (
    <div ref={ref} className="relative flex-shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl select-none overflow-hidden"
        style={{
          padding: "7px 12px",
          background: active
            ? `${colors.primary}10`
            : (open || hover ? "rgba(26,47,138,0.05)" : "transparent"),
          border: `1px solid ${active ? `${colors.primary}40` : "rgba(26,47,138,0.08)"}`,
          transition: "background 200ms, border-color 200ms",
          lineHeight: 1,
        }}>
        <span className="inline-flex items-center overflow-hidden whitespace-nowrap"
          style={{
            maxWidth: showLabel ? 110 : 0,
            opacity: showLabel ? 1 : 0,
            marginRight: showLabel ? 5 : 0,
            transition: "max-width 280ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease, margin-right 280ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none"
            style={{ color: colors.primary, opacity: active ? 0.7 : 0.5 }}>
            {label}
          </span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: active ? colors.primary : "rgba(100,120,180,0.7)", lineHeight: 1 }}>
          {display}
        </span>
        {active && (
          <button
            onClick={e => { e.stopPropagation(); onChange([]); }}
            className="flex items-center justify-center rounded-full ml-0.5"
            style={{ width: 14, height: 14, background: `${colors.primary}15` }}
            title={T("btn_clear")}>
            <X size={8} style={{ color: colors.primary }} strokeWidth={3} />
          </button>
        )}
        {!active && (
          <ChevronDown size={10}
            style={{ color: colors.primary, opacity: 0.4, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 240ms cubic-bezier(0.34,1.56,0.64,1)" }} />
        )}
      </button>

      {open && createPortal(
        <div ref={ddRef}
          className="fixed z-[70] min-w-[220px] max-h-[320px] overflow-y-auto rounded-2xl"
          style={{
            top: rect ? rect.bottom + 6 : 0,
            left: rect ? rect.left : 0,
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.22), 0 0 0 1px rgba(255,255,255,0.5) inset",
            animation: "ddIn 220ms cubic-bezier(0.34,1.56,0.64,1)",
            padding: 6,
          }}>
          <button
            onClick={() => onChange(active ? [] : [...options])}
            className="w-full text-left px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2.5 border-b border-gray-100 mb-1"
            style={{ color: colors.primary }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(26,47,138,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: !active ? colors.primary : "#fff",
                borderColor: !active ? colors.primary : "#d4d4d8",
              }}>
              {!active && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            {active ? T("jrn_clear_selection", "Clear selection") : T("all")}
          </button>
          {options.map(o => {
            const selected = values.includes(o);
            return (
              <button key={o}
                onClick={() => toggle(o)}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2.5"
                style={{
                  background: selected ? "rgba(26,47,138,0.08)" : "transparent",
                  color: "#475569",
                }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(26,47,138,0.04)"; }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: selected ? colors.primary : "#fff",
                    borderColor: selected ? colors.primary : "#d4d4d8",
                  }}>
                  {selected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                <span className="truncate">{o}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ─── JournalsModal — modern search + filter UI over journal entries ────── */
function JournalsModal({ T, journalData, onClose, year, month, source, colors, header2Style, underscore1Style, underscore2Style, body2Style }) {
const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState([]);
  const [filterCounterparty, setFilterCounterparty] = useState([]);
  const [filterJournalType, setFilterJournalType] = useState([]);
  const [filterAccountType, setFilterAccountType] = useState([]);

  // Derive option lists from data
  const opts = useMemo(() => {
    const companies = new Set();
    const counterparties = new Set();
    const journalTypes = new Set();
    const accountTypes = new Set();
    journalData.forEach(r => {
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      const cpty = r.CounterpartyShortName ?? r.counterpartyShortName ?? "";
      const jt = r.JournalType ?? r.journalType ?? "";
      const at = r.AccountType ?? r.accountType ?? "";
      if (co) companies.add(co);
      if (cpty) counterparties.add(cpty);
      if (jt) journalTypes.add(jt);
      if (at) accountTypes.add(at);
    });
    return {
      companies: [...companies].sort(),
      counterparties: [...counterparties].sort(),
      journalTypes: [...journalTypes].sort(),
      accountTypes: [...accountTypes].sort(),
    };
  }, [journalData]);

// Apply all filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journalData.filter(r => {
      if (filterCompany.length      && !filterCompany.includes(r.CompanyShortName ?? r.companyShortName)) return false;
      if (filterCounterparty.length && !filterCounterparty.includes(r.CounterpartyShortName ?? r.counterpartyShortName)) return false;
      if (filterJournalType.length  && !filterJournalType.includes(r.JournalType ?? r.journalType)) return false;
      if (filterAccountType.length  && !filterAccountType.includes(r.AccountType ?? r.accountType)) return false;
      if (q) {
        const fields = [
          r.AccountCode, r.accountCode,
          r.AccountName, r.accountName,
          r.JournalNumber, r.journalNumber,
          r.JournalHeader, r.journalHeader,
          r.RowText, r.rowText,
          r.DimensionName, r.dimensionName,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!fields.includes(q)) return false;
      }
      return true;
    });
  }, [journalData, search, filterCompany, filterCounterparty, filterJournalType, filterAccountType]);

  const anyFilterActive = !!(search || filterCompany.length || filterCounterparty.length || filterJournalType.length || filterAccountType.length);

  const clearAll = () => {
    setSearch(""); setFilterCompany([]); setFilterCounterparty([]);
    setFilterJournalType([]); setFilterAccountType([]);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: colors.primary }}>
          <div>
            <p style={header2Style}>{T("export_journal_entries")}</p>
            <p style={underscore2Style}>
             {anyFilterActive ? `${filtered.length} ${T("am_matching_count_of")} ${journalData.length}` : `${journalData.length}`} {T("entries")} · {year} · {T(`month_${Number(month)}`)} · {source}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
            <X size={13} className="text-white/70" />
          </button>
        </div>

{/* Filter bar — clean glass shell with search + pills */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap flex-shrink-0"
          style={{ background: "linear-gradient(180deg, #fafbff 0%, #f4f6fc 100%)" }}>
          {/* Search */}
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1 min-w-[260px] max-w-md"
            style={{
              background: "white",
              border: "1px solid rgba(26,47,138,0.08)",
              boxShadow: "0 1px 3px -1px rgba(26,47,138,0.06)",
            }}>
            <Search size={13} style={{ color: colors.primary, opacity: 0.5 }} className="flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={T("jrn_search_placeholder", "Search account, journal #, header, row text…")}
              className="text-xs outline-none bg-transparent flex-1 min-w-0 placeholder:text-gray-300"
              style={{ color: colors.primary, fontWeight: 600 }}
            />
            {search && (
              <button onClick={() => setSearch("")}
                className="flex items-center justify-center rounded-full"
                style={{ width: 16, height: 16, background: "rgba(26,47,138,0.08)" }}>
                <X size={10} style={{ color: colors.primary }} strokeWidth={3} />
              </button>
            )}
          </div>

          <div className="w-px h-6 mx-1" style={{ background: "rgba(26,47,138,0.1)" }} />

<JournalsPill T={T} colors={colors} label={T("jrn_company")}   values={filterCompany}      onChange={setFilterCompany}      options={opts.companies} />
          <JournalsPill colors={colors} label={T("jrn_counterparty")} values={filterCounterparty} onChange={setFilterCounterparty} options={opts.counterparties} />
          <JournalsPill colors={colors} label={T("jrn_journal_type")} values={filterJournalType}  onChange={setFilterJournalType}  options={opts.journalTypes} />
          <JournalsPill colors={colors} label={T("jrn_account_type")} values={filterAccountType}  onChange={setFilterAccountType}  options={opts.accountTypes} />

          {anyFilterActive && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ml-auto transition-all"
              style={{
                background: "rgba(207,48,93,0.08)",
                color: "#CF305D",
                border: "1px solid rgba(207,48,93,0.15)",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(207,48,93,0.14)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(207,48,93,0.08)"; }}>
<X size={10} strokeWidth={3} />
              {T("jrn_clear_all", "Clear all")}
            </button>
          )}
        </div>

        <style>{`
          @keyframes ddIn {
            from { opacity: 0; transform: translateY(-6px) scale(0.96); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                <Search size={18} className="text-gray-400" />
              </div>
<p className="text-sm font-bold text-gray-500">{T("jrn_no_match", "No journals match your filters")}</p>
              <p className="text-xs text-gray-400 mt-1">{T("jrn_no_match_hint", "Try removing some filters or adjusting your search")}</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                 {[
                    T("jrn_company"),
                    T("jrn_account"),
                    T("jrn_account_type"),
                    T("jrn_number"),
                    T("jrn_header"),
                    T("jrn_journal_type"),
                    T("jrn_journal_layer"),
                    T("jrn_counterparty"),
                    T("jrn_dimension"),
                    T("jrn_amount_ytd"),
                    T("jrn_currency"),
                    T("jrn_row_text"),
                    T("jrn_posted"),
                    T("jrn_system_generated"),
                  ].map(h => (
                    <th key={h}
                      className="text-left px-3 py-2.5 whitespace-nowrap"
                      style={{
                        backgroundColor: colors.primary,
                        boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.1)",
                      }}>
                      <span style={{ ...underscore1Style, position: "relative" }}>{h}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const amt = Number(r.AmountYTD ?? r.amountYTD) || 0;
                  return (
                    <tr key={i} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/40"}`} style={body2Style}>
                      <td className="px-3 py-2 whitespace-nowrap">{r.CompanyShortName ?? r.companyShortName}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="mr-1 opacity-60">{r.AccountCode ?? r.accountCode}</span><span>{r.AccountName ?? r.accountName}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.AccountType ?? r.accountType}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.JournalNumber ?? r.journalNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap max-w-[180px] truncate">{r.JournalHeader ?? r.journalHeader}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{r.JournalType ?? r.journalType}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.JournalLayer ?? r.journalLayer}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.CounterpartyShortName ?? r.counterpartyShortName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.DimensionName ?? r.dimensionName}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums" style={{ color: amt === 0 ? "#D1D5DB" : amt < 0 ? "#EF4444" : "#000000" }}>{fmtAmt(amt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.CurrencyCode ?? r.currencyCode}</td>
                      <td className="px-3 py-2 max-w-[160px] truncate">{r.RowText ?? r.rowText}</td>
<td className="px-3 py-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded ${(r.Posted ?? r.posted) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{(r.Posted ?? r.posted) ? T("cell_yes") : T("cell_no")}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded ${(r.SystemGenerated ?? r.systemGenerated) ? "bg-gray-100 text-gray-500" : "bg-white text-gray-400"}`}>{(r.SystemGenerated ?? r.systemGenerated) ? T("cell_yes") : T("cell_no")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── MappingsLanding — 2 GIANT cards with full decoration stack ─────────── */
function MappingsLanding({ T, colors, onPickStructure, onPickReport }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const PRIMARY_SOFT = "#3b54b8";
  const ACCENT = "#CF305D";
  const ACCENT_SOFT = "#e0558d";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* ─── Structure card (blue) ─── */}
        <button
          onClick={onPickStructure}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: `linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)`,
            boxShadow: `0 8px 32px -8px ${PRIMARY}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = PRIMARY; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          {/* Decoration layer */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {/* Dotted pattern */}
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${PRIMARY}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            {/* Big orb top-right */}
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${PRIMARY}18 0%, transparent 70%)`,
              animation: "floatOrb1 8s ease-in-out infinite",
            }} />
            {/* Small orb bottom-right */}
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${PRIMARY_SOFT}20 0%, transparent 70%)`,
              animation: "floatOrb2 11s ease-in-out 2s infinite",
            }} />
            {/* SVG rotating circles top-right */}
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "spinSlow 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "spinSlowR 20s linear infinite" }} />
            </svg>
          </div>

          {/* Content */}
          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              {/* Icon with glow */}
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                  filter: "blur(12px)",
                  transform: "translateY(4px)",
                  opacity: 0.2,
                }} />
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}>
                  <Layers size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>

<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("am_card_structure_title")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_structure_desc")}
              </p>
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
               {[T("am_std_pgc_full").includes("Plan") ? "PGC" : "PGC", T("am_std_spanish_ifrs_label"), T("am_std_danish_ifrs_full")].map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                    style={{ background: `${PRIMARY}15`, color: PRIMARY }}>
                    {s}
                  </span>
                ))}
              </div>
<span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: PRIMARY }}>
                {T("am_cta_open")}
              </span>
            </div>
          </div>
        </button>

        {/* ─── Report card (rose) ─── */}
        <button
          onClick={onPickReport}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)",
            boxShadow: `0 8px 32px -8px ${ACCENT}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          {/* Decoration layer */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${ACCENT}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
              animation: "floatOrb1 9s ease-in-out infinite",
            }} />
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${ACCENT_SOFT}20 0%, transparent 70%)`,
              animation: "floatOrb2 13s ease-in-out 1.5s infinite",
            }} />
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "spinSlowR 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "spinSlow 20s linear infinite" }} />
            </svg>
          </div>

          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                  filter: "blur(12px)",
                  transform: "translateY(4px)",
                  opacity: 0.2,
                }} />
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}>
                  <FileText size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>

<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("am_card_report_title")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_report_desc")}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
<span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                  style={{ background: `${ACCENT}15`, color: ACCENT }}>
                  {T("badge_coming_soon")}
                </span>
              </div>
              <span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: ACCENT }}>
                {T("btn_preview_arrow")}
              </span>
            </div>
          </div>
        </button>
      </div>

      <style>{`
        @keyframes floatOrb1 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(20px,-30px) scale(1.1); }
        }
        @keyframes floatOrb2 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-15px,20px) scale(0.95); }
        }
        @keyframes floatOrb3 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(25px,15px) scale(1.05); }
        }
        @keyframes spinSlow  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinSlowR { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
      `}</style>
    </div>
  );
}

/* ─── MappingsLibrary — list with compact mapping cards ──────────────────── */
function MappingsLibrary({ T, colors, kind, activeMapping, mappings, loading, error, onApply, onClearActive, onRetry }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const ACCENT = kind === "report" ? "#CF305D" : PRIMARY;
  const Icon = kind === "report" ? FileText : Layers;
  const kindLabel = kind === "report" ? T("views_saved_report_mappings") : T("views_saved_mappings");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("views_library")}</p>
          <h2 className="font-black tracking-tight mt-0.5 text-gray-800" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
            {kindLabel}
          </h2>
        </div>
        {activeMapping && (
          <button onClick={onClearActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.15)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; }}>
<X size={10} strokeWidth={3} />
            {T("btn_clear_active")}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="overflow-y-auto flex-1 p-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin mb-3" style={{ color: ACCENT }} />
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{T("views_loading_mappings")}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "rgba(220,38,38,0.1)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
<p className="text-sm font-bold text-red-600 mb-1">{T("error_failed_load")}</p>
            <p className="text-xs text-gray-400 mb-4">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="text-xs font-black uppercase tracking-widest underline" style={{ color: ACCENT }}>
                {T("btn_retry")}
              </button>
            )}
          </div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${ACCENT}10` }}>
              <Library size={20} style={{ color: ACCENT }} />
            </div>
<p className="text-sm font-bold text-gray-500 mb-1">{T("views_no_mappings")}</p>
            <p className="text-xs text-gray-400">{T("views_no_mappings_hint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mappings.map(m => {
              const isActive = activeMapping?.mapping_id === m.mapping_id;
              return (
                <button key={m.mapping_id}
                  onClick={() => onApply(m)}
                  className="relative text-left p-4 rounded-xl transition-all flex flex-col"
                  style={{
                    background: isActive ? `${ACCENT}06` : "white",
                    border: `2px solid ${isActive ? ACCENT : "rgba(0,0,0,0.05)"}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 12px -2px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>

                  {/* Top: icon + title + active badge */}
                  <div className="flex items-start gap-2.5 mb-3">
                    <div className="rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 36, height: 36,
                        background: isActive ? "white" : `${ACCENT}15`,
                        color: ACCENT,
                        border: isActive ? `1px solid ${ACCENT}30` : "none",
                      }}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
<p className="font-black text-sm text-gray-800 truncate" style={{ letterSpacing: "-0.01em" }}>
                          {m.name ?? T("views_untitled")}
                        </p>
                        {isActive && (
                          <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md flex-shrink-0"
                            style={{ background: ACCENT, color: "white" }}>
                            {T("views_active")}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: ACCENT, opacity: 0.7 }}>
                        {m.standard ?? T("am_filter_custom")}
                      </p>
                    </div>
                  </div>

                  {/* Description */}
                  {m.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-3">
                      {m.description}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="mt-auto pt-3 border-t border-gray-50 flex items-center justify-between">
<span className="text-[10px] text-gray-400">
                      {m.updated_at ? `${T("views_updated")} ${new Date(m.updated_at).toLocaleDateString()}` : "—"}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#059669" }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      {T("views_apply")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── SpinnerOverlay — debounced visibility to avoid flashing ─────────────── */
function SpinnerOverlay({ T, show, colors, metaReady, probingPeriod }) {
  const [visible, setVisible] = useState(show);
  const [fading, setFading] = useState(false);
  const showRef = useRef(show);
  const timerRef = useRef(null);

  useEffect(() => {
    showRef.current = show;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (show) {
      // Becoming visible — show immediately, cancel any fade-out.
      setFading(false);
      setVisible(true);
    } else {
      // Becoming hidden — wait a tick to absorb micro-flickers between flags,
      // then fade out.
      timerRef.current = setTimeout(() => {
        if (!showRef.current) {
          setFading(true);
          timerRef.current = setTimeout(() => {
            if (!showRef.current) setVisible(false);
          }, 280);
        }
      }, 120);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [show]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center" style={{
      animation: fading ? "spinnerFadeOut 280ms ease forwards" : "spinnerFadeIn 220ms ease",
      background: "rgba(255,255,255,0.78)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
    }}>
     <ContributiveLoadingSpinner T={T} colors={colors} metaReady={metaReady} probingPeriod={probingPeriod} />
      <style>{`
        @keyframes spinnerFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spinnerFadeOut { from { opacity: 1; } to { opacity: 0; } }
      `}</style>
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────────────── */
export default function ContributivePage({ token, onNavigate }) {
const header2Style = useTypo("header2");
  const header3Style = useTypo("header3");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const filterStyle = useTypo("filter");
  const underscore1Style = useTypo("underscore1");
  const underscore2Style = useTypo("underscore2");
const { colors, locale } = useSettings();
  const T = useCallback((k, fb) => t(locale, k, fb), [locale]);
  const [periods,       setPeriods]       = useState([]);
  const [sources,       setSources]       = useState([]);
  const [structures,    setStructures]    = useState([]);
  const [companies,     setCompanies]     = useState([]);
  const [groupStructure,setGroupStructure]= useState([]);

  const [year,       setYear]       = useState("");
  const [month,      setMonth]      = useState("");
  const [source,     setSource]     = useState("");
  const [structure,  setStructure]  = useState("DefaultStructure");
const [typeFilter, setTypeFilter] = useState("");
  // Also reset expansion when a mapping flips on/off (the id space changes).
  const [selectedCompanies, setSelectedCompanies] = useState([]);
// User-defined column order (drag-and-drop). Empty array = use natural order.
  const [colOrder, setColOrder] = useState([]);
  // NEW: perspective filter — "" means none/all (default), or a parent shortName
const [perspective, setPerspective] = useState("");

  const [rawData,      setRawData]      = useState([]);
  const [journalData,  setJournalData]  = useState([]);
  const [showJournals, setShowJournals] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [metaReady,    setMetaReady]    = useState(false);
  const [probingPeriod, setProbingPeriod] = useState(false);
  const autoPeriodDone = useRef(false);
const breakersFetchedRef = useRef(false);
const [breakers, setBreakers] = useState({});
  const [breakerSortOrder, setBreakerSortOrder] = useState(new Map());
const [pgcSections] = useState({});
const [expandedSet,setExpandedSet]= useState(new Set());
  useEffect(() => { setExpandedSet(new Set()); }, [typeFilter]);
  const [compareMode, setCompareMode] = useState(false);
  const [cmpYear, setCmpYear] = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
  const [cmpSource, setCmpSource] = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
const [cfUploadedData, setCfUploadedData] = useState([]);
  const [cfMapping, setCfMapping] = useState([]);
  const [cfMetadata, setCfMetadata] = useState(new Map());
  const [cfGroupToCf, setCfGroupToCf] = useState(new Map());
const [, setCfLoading] = useState(false);
  // Plain dict {cfCode: name} accumulated from consolidated rows with
  // AccountType C/F or CFS. This is the most reliable name source — the
  // mapping endpoint often returns blank names for sum/system accounts.
  const [cfNameDict, setCfNameDict] = useState({});
const [cmpRawData, setCmpRawData] = useState([]);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [currencyMode, setCurrencyMode] = useState("reporting");
const [drilldown,       setDrilldown]       = useState(null);

  // ── Mappings state ──────────────────────────────────────────────────────
  // activeMapping holds the currently-applied mapping (derived from typeFilter).
  // We key it by tab so switching between P/L → B/S → C/F doesn't lose state.
  const [activeMappings, setActiveMappings] = useState({ pl: null, bs: null, cf: null });
  // viewsMode controls the mappings UI overlay: null | "landing" | "structure" | "report"
  const [viewsMode, setViewsMode] = useState(null);
  // Lists fetched on demand
  const [savedMappings, setSavedMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState(null);
  // Quick-access dropdown (combined structure + report, sorted by recency)
  const [recentMappings, setRecentMappings] = useState([]);

  // Which tab is "mapping-capable"? Only P/L, B/S, C/F. "All" (typeFilter === "") is not.
  const mappingTab = typeFilter === "P/L" ? "pl"
                   : typeFilter === "B/S" ? "bs"
                   : typeFilter === "C/F" ? "cf"
                   : null;
  const mappingsEnabled = !!mappingTab;
  const activeMapping = mappingsEnabled ? activeMappings[mappingTab] : null;
useEffect(() => { setExpandedSet(new Set()); }, [activeMapping?.mapping_id]);
const [expandedColsMap, setExpandedColsMap] = useState({});
  const _expandedCols = new Set(Object.keys(expandedColsMap).filter(k => expandedColsMap[k]));
const toggleCol = co => setExpandedColsMap(prev => ({ ...prev, [co]: !prev[co] }));

const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

  // Convert a saved mapping tree → flat { rows, sections } map for standard-style
  // rendering. Used when we want the literal to interop with our existing sortOrder.
  const convertMappingTree = useCallback((tree) => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    const rows = new Map();
    const sections = new Map();
    let sortCounter = 0;
    let defaultSecCounter = 0;
    const walk = (nodes, depth, parentSection) => {
      for (const node of nodes || []) {
        if (node?.kind === "breaker") {
          const secCode = node.sectionCode || `section_${defaultSecCounter++}`;
          sections.set(secCode, {
            label: String(node.name ?? "Section"),
            color: node.color || "#1a2f8a",
          });
          walk(node.children, depth, secCode);
        } else if (node?.code) {
          const code = String(node.code);
          const sec = parentSection || "_default";
          if (!sections.has(sec)) sections.set(sec, { label: "", color: "#1a2f8a" });
          rows.set(code, {
            section: sec,
            sortOrder: sortCounter++,
            isSum: !!node.isSum,
            showInSummary: !!node.showInSummary,
            level: depth,
          });
          walk(node.children, depth + 1, sec);
        }
      }
    };
    walk(tree, 0, null);
    return rows.size > 0 ? { rows, sections } : null;
  }, []);

  // Preserve the original hierarchy (with duplicates, sums, dims). Used by the
  // literal render path.
  const buildMappingLiteral = useCallback((tree) => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    const sections = [];
    let current = { label: null, color: null, nodes: [] };
    sections.push(current);
    const visited = new WeakSet();
    const literal = (node, depth) => {
      if (!node || depth > 50 || visited.has(node)) {
        return { id: `${node?.code ?? "?"}-${Math.random()}`, code: String(node?.code ?? ""), name: String(node?.name ?? ""), isSum: false, depth, children: [] };
      }
      visited.add(node);
      return {
        id: String(node.id ?? `${node.code}-${Math.random()}`),
        originalId: node.id,
        code: String(node.code ?? ""),
        name: String(node.name ?? ""),
        dims: Array.isArray(node.dims) ? node.dims : null,
        isSum: !!node.isSum,
        depth,
        children: (node.children || [])
          .filter(c => c && c.kind !== "breaker")
          .map(c => literal(c, depth + 1)),
      };
    };
    for (const node of tree) {
      if (node?.kind === "breaker") {
        current = { label: String(node.name ?? ""), color: node.color || "#1a2f8a", nodes: [] };
        sections.push(current);
        (node.children || []).filter(c => c?.kind !== "breaker").forEach(c => current.nodes.push(literal(c, 0)));
      } else if (node) {
        current.nodes.push(literal(node, 0));
      }
    }
    return sections.filter((s, i) => i > 0 || s.nodes.length > 0);
  }, []);

  // Apply a mapping for the current tab. `kind` = "structure" | "report".
  const handleApplyMapping = useCallback((m, kind = "structure") => {
    if (!mappingTab) return;
    // The tree field depends on the tab: pl_tree, bs_tree, cf_tree.
    const treeField = mappingTab === "pl" ? "pl_tree" : mappingTab === "bs" ? "bs_tree" : "cf_tree";
    const tree = m?.[treeField] ?? m?.tree ?? [];
    setActiveMappings(prev => ({
      ...prev,
      [mappingTab]: {
        mapping_id: m.mapping_id,
        kind,
        tab: mappingTab,
        name: m.name,
        standard: m.standard,
        treeRaw: tree,
        treeConverted: convertMappingTree(tree),
        treeLiteral: buildMappingLiteral(tree),
        highlightedIds: Array.isArray(m.highlighted_ids) ? new Set(m.highlighted_ids) : new Set(),
      },
    }));
    setViewsMode(null);
  }, [mappingTab, convertMappingTree, buildMappingLiteral]);

const clearActiveMapping = useCallback(() => {
    if (!mappingTab) return;
    setActiveMappings(prev => ({ ...prev, [mappingTab]: null }));
  }, [mappingTab]);

  // Dynamically pick which API to use based on mappingTab + viewsMode.
  // pl & bs → mappingsApi / reportMappingsApi (the ones from Individuales)
  // cf      → cashflowMappingsApi / cashflowReportMappingsApi
  const pickMappingApi = useCallback(async (tab, kind) => {
    if (tab === "cf") {
      const mod = kind === "report"
        ? await import("../../lib/cashflowReportMappingsApi")
        : await import("../../lib/cashflowMappingsApi");
      return mod;
    }
    // pl & bs share the same APIs (they store both pl_tree and bs_tree in the same row)
    const mod = kind === "report"
      ? await import("../../lib/reportMappingsApi")
      : await import("../../lib/mappingsApi");
    return mod;
  }, []);

  // Fetch the list of saved mappings when entering structure/report library
  useEffect(() => {
    if (!viewsMode || viewsMode === "landing") return;
    if (!mappingTab) return;
    let cancelled = false;
    (async () => {
      setMappingsLoading(true);
      setMappingsError(null);
      setSavedMappings([]);
      try {
        const api = await pickMappingApi(mappingTab, viewsMode);
        const supa = await import("../../lib/supabaseClient");
        const { data: { session } } = await supa.supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) throw new Error("No session");
        const cid = await api.getActiveCompanyId(uid);
        if (!cid) throw new Error("No active company");
        const rows = await api.listMappings({ companyId: cid });
        if (!cancelled) setSavedMappings(rows || []);
      } catch (e) {
        if (!cancelled) setMappingsError(e?.message || String(e));
      } finally {
        if (!cancelled) setMappingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewsMode, mappingTab, pickMappingApi]);

  // Fetch recent mappings (combined structure + report) once at mount per tab
  useEffect(() => {
    if (!mappingTab) { setRecentMappings([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const supa = await import("../../lib/supabaseClient");
        const { data: { session } } = await supa.supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const structApi = await pickMappingApi(mappingTab, "structure");
        const reportApi = await pickMappingApi(mappingTab, "report");
        const cid = await structApi.getActiveCompanyId(uid);
        if (!cid) return;
        const [structRows, reportRows] = await Promise.all([
          structApi.listMappings({ companyId: cid }).catch(() => []),
          reportApi.listMappings({ companyId: cid }).catch(() => []),
        ]);
        if (cancelled) return;
        setRecentMappings([
          ...(structRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "structure", updated_at: r.updated_at, raw: r })),
          ...(reportRows || []).map(r => ({ id: r.mapping_id, name: r.name, kind: "report",    updated_at: r.updated_at, raw: r })),
        ]);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [mappingTab, pickMappingApi]);

  // Click a card → fetch the full mapping (with cf_tree / pl_tree / bs_tree) and apply
  const handleApplyFromCard = useCallback(async (m, kind) => {
    try {
      const api = await pickMappingApi(mappingTab, kind);
      const full = await api.getMapping(m.mapping_id);
      handleApplyMapping(full ?? m, kind);
} catch {
      handleApplyMapping(m, kind);
    }
  }, [mappingTab, pickMappingApi, handleApplyMapping]);

  /* ── Load metadata ──────────────────────────────────────── */
  useEffect(() => {
    if (!token) return;
    const h = headers();
    Promise.all([
      fetch(`${BASE_URL}/v2/periods`,        { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/sources`,        { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/structures`,     { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/companies`,      { headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/group-structure`,{ headers: h }).then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([per, src, str, co, gs]) => {
      setPeriods(per);
      setSources(src);
      setStructures(str);
      setCompanies(co);
      setGroupStructure(gs);

      // Default: latest Actual period
      setSource("Actual");

      // Default structure
      if (str.length > 0) {
        const s = str[0];
        const v = typeof s === "object"
          ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "")
          : String(s);
        setStructure(String(v));
      }

      setMetaReady(true);
    });
  }, [token, headers]);

/* ── Auto-find latest period with data — exhaustive probe ─────────
     Strategy:
       1. Try current source+structure going back 24 months
       2. If nothing, sweep ALL combinations of source × structure for
          the last 12 months (newest period first) and switch filters
          to the first hit
       3. If still nothing, give up and show the empty state */
  useEffect(() => {
    if (!metaReady) return;
    if (autoPeriodDone.current) return;
    if (!source || !structure || sources.length === 0 || structures.length === 0) return;
    autoPeriodDone.current = true;
    setProbingPeriod(true);

    const probe = async (y, m, src, str) => {
      try {
        const filter = `Year eq ${y} and Month eq ${m} and Source eq '${src}' and GroupStructure eq '${str}'`;
        const res = await fetch(
          `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
          { headers: headers() }
        );
        if (!res.ok) return false;
        const json = await res.json();
        const rows = json.value ?? (Array.isArray(json) ? json : []);
        return rows.length > 0;
      } catch { return false; }
    };

    (async () => {
      const now = new Date();
      const monthsBack = (max) => {
        const out = [];
        let y = now.getFullYear();
        let m = now.getMonth() + 1;
        for (let i = 0; i < max; i++) {
          out.push({ y, m });
          m -= 1;
          if (m < 1) { m = 12; y -= 1; }
        }
        return out;
      };

      // Pass 1 — current source+structure, 24 months back
      for (const { y, m } of monthsBack(24)) {
        if (await probe(y, m, source, structure)) {
          setYear(String(y));
          setMonth(String(m));
          setProbingPeriod(false);
          return;
        }
      }

      // Pass 2 — sweep all source × structure for last 12 months
      const allSources = [...new Set(sources.map(s =>
        typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s)
      ).filter(Boolean))];
      const allStructures = [...new Set(structures.map(s =>
        typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s)
      ).filter(Boolean))];

      for (const { y, m } of monthsBack(12)) {
        for (const src of allSources) {
          for (const str of allStructures) {
            if (src === source && str === structure) continue; // already tried
            if (await probe(y, m, src, str)) {
              setSource(src);
              setStructure(str);
              setYear(String(y));
              setMonth(String(m));
              setProbingPeriod(false);
              return;
            }
          }
        }
      }

      // Nothing found anywhere — leave filters as-is, table will show empty state
      setProbingPeriod(false);
    })();
  }, [metaReady, source, structure, sources, structures, headers]);

  /* ── Fetch breakers from Supabase ───────────────────────── */
useEffect(() => {
    if (!rawData.length) return;
    breakersFetchedRef.current = false;

    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

    const isPGC           = rawData.some(n => { const c = String(n.AccountCode ?? n.accountCode ?? ""); return /[a-zA-Z]/.test(c) && c.endsWith(".S"); });
    const isSpanishIfrsEs = !isPGC && rawData.some(n => /\.PL$/i.test(String(n.AccountCode ?? n.accountCode ?? "").trim()));
    const isSpanishIFRS   = !isPGC && !isSpanishIfrsEs && rawData.some(n => /^[A-Z]\.\d/.test(String(n.AccountCode ?? n.accountCode ?? "")));
    const isDanish        = !isPGC && !isSpanishIFRS && !isSpanishIfrsEs && rawData.some(n => /^\d{5,6}$/.test(String(n.AccountCode ?? n.accountCode ?? "")));

    if (!isPGC && !isSpanishIFRS && !isSpanishIfrsEs && !isDanish) return;

const rowsTable = isPGC ? "pgc_pl_rows"
      : isSpanishIfrsEs ? "contributive_pl_rows"
      : isDanish ? "danish_ifrs_pl_rows"
      : null;
    const secsTable = isPGC ? "pgc_pl_sections"
      : isSpanishIfrsEs ? "contributive_pl_sections"
      : isDanish ? "danish_ifrs_pl_sections"
      : null;

    if (rowsTable && secsTable) {
      Promise.all([
        fetch(`${SUPABASE_URL}/${rowsTable}?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
        fetch(`${SUPABASE_URL}/${secsTable}?select=*&order=sort_order.asc`, { headers: sbHeaders }).then(r => r.json()),
      ]).then(([rowsArr, secsArr]) => {
        if (!Array.isArray(rowsArr) || !Array.isArray(secsArr)) return;
        const secByCode = new Map(secsArr.map(s => [s.section_code, { label: s.label, color: s.color }]));
        const seen = new Set();
        const out = {};
const sortOrder = new Map();
        rowsArr.forEach((r, idx) => {
          sortOrder.set(r.account_code, idx);
          if (seen.has(r.section_code)) return;
          seen.add(r.section_code);
          const sec = secByCode.get(r.section_code);
          if (sec) out[r.account_code] = { label: sec.label, color: sec.color };
        });
const breakerOrder = new Map();
        rowsArr.forEach((r, idx) => breakerOrder.set(r.account_code, idx));
setBreakers(out);
        setBreakerSortOrder(breakerOrder);
      }).catch(() => {});
      return;
    }

    // Spanish IFRS non-ES fallback
    fetch(`${SUPABASE_URL}/spanish_ifrs_breakers?select=*`, { headers: sbHeaders })
      .then(r => r.json())
      .then(rows => {
        if (!Array.isArray(rows)) return;
        const grouped = {};
        rows.forEach(({ before_code, label, color }) => { grouped[before_code] = { label, color }; });
        setBreakers(grouped);
      })
      .catch(e => console.error("BREAKERS FETCH ERROR:", e));
  }, [rawData]);
  /* ── Fetch consolidated-accounts ────────────────────────── */
  useEffect(() => {
    if (!metaReady || !year || !month || !source || !structure) return;

    setLoading(true);
    setRawData([]);
    setJournalData([]);
    setExpandedSet(new Set());
    setExpandedColsMap({});

    const h = headers();
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;

    Promise.all([
      fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/journal-entries?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([consolidated, journals]) => {

setRawData(consolidated);
      setJournalData(journals);
      // Extract CF/CFS names from consolidated rows — accumulate across periods.
      setCfNameDict(prev => {
        const next = { ...prev };
        consolidated.forEach(r => {
          const t = r.AccountType ?? r.accountType ?? "";
          if (t !== "C/F" && t !== "CFS") return;
          const code = r.AccountCode ?? r.accountCode;
          const name = r.AccountName ?? r.accountName;
          if (code && name && !next[code]) next[code] = name;
        });
        return next;
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [year, month, source, structure, metaReady, headers]);

/* ── Probe for a flat CF accounts catalogue (4th name source) ──────────── */
  useEffect(() => {
    if (!token || !metaReady) return;
    const h = headers();
    // Try a few common paths. First one that responds 200 with rows wins.
    const candidates = [
      `${BASE_URL}/v2/cashflow-accounts`,
      `${BASE_URL}/v2/cash-flow-accounts`,
      `${BASE_URL}/v2/cf-accounts`,
    ];
    (async () => {
      for (const url of candidates) {
        try {
          const r = await fetch(url, { headers: h });
          if (!r.ok) continue;
          const d = await r.json();
          const rows = d.value ?? (Array.isArray(d) ? d : []);
          if (!rows.length) continue;
          // Seed cfNameDict with whatever name field exists
          setCfNameDict(prev => {
            const next = { ...prev };
            rows.forEach(r => {
              const code = r.CashFlowAccountCode ?? r.cashFlowAccountCode ?? r.AccountCode ?? r.accountCode ?? r.Code ?? r.code;
              const name = r.CashFlowAccountName ?? r.cashFlowAccountName ?? r.AccountName ?? r.accountName ?? r.Name ?? r.name;
              if (code && name && !next[code]) next[code] = name;
            });
            return next;
          });
          return; // stop after first hit
        } catch { /* try next */ }
      }
    })();
  }, [token, metaReady, headers]);

  /* ── Fetch CF mapping + uploaded data ───────────────────── */
  useEffect(() => {
    if (!token || !metaReady) return;
    const h = headers();
    fetch(`${BASE_URL}/v2/mapped-cashflow-accounts`, { headers: h })
      .then(r => r.json()).then(d => {
        const rows = d.value ?? (Array.isArray(d) ? d : []);
        setCfMapping(rows);
        // Build metadata and groupToCf maps
        const meta = new Map();
        rows.forEach(map => {
          if (map.enabled === false || map.Enabled === false) return;
          const code = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
          const name = map.cashFlowAccountName ?? map.CashFlowAccountName ?? "";
          const sumParent = map.cashFlowAccountSumAccountCode ?? map.CashFlowAccountSumAccountCode ?? "";
          if (!code) return;
          if (!meta.has(code)) meta.set(code, { name, sumParent });
        });
        // Bubble up missing parents
        let added = true;
        while (added) {
          added = false;
          for (const node of [...meta.values()]) {
            if (node.sumParent && !meta.has(node.sumParent)) {
              meta.set(node.sumParent, { name: "", sumParent: "" });
              added = true;
            }
          }
        }
        setCfMetadata(meta);
        // groupToCf
        const g2cf = new Map();
        rows.forEach(map => {
          if (map.enabled === false || map.Enabled === false) return;
          const ga = map.groupAccountCode ?? map.GroupAccountCode ?? "";
          const cf = map.cashFlowAccountCode ?? map.CashFlowAccountCode ?? "";
          if (!ga || !cf) return;
          if (!g2cf.has(ga)) g2cf.set(ga, []);
          g2cf.get(ga).push(cf);
        });
        setCfGroupToCf(g2cf);
      }).catch(() => {});
  }, [token, metaReady, headers]);

  useEffect(() => {
    if (!token || !metaReady || !year || !month || !source || !structure) return;
    setCfLoading(true);
    const h = headers();
    const filter = `Year eq ${year} and Month eq ${month} and Source eq '${source}' and GroupStructure eq '${structure}'`;
    fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
      .then(r => r.json()).then(d => {
        setCfUploadedData(d.value ?? (Array.isArray(d) ? d : []));
        setCfLoading(false);
      }).catch(() => setCfLoading(false));
  }, [token, metaReady, year, month, source, structure, headers]);
  
const [cmpCfUploadedData, setCmpCfUploadedData] = useState([]);
  const [dimensionsMeta, setDimensionsMeta] = useState([]); // [{DimensionGroupName, DimensionGroupCode, DimensionName, DimensionCode}]

  /* ── Fetch dimensions metadata (for code↔name mirror in dim index) ── */
  useEffect(() => {
    if (!token || !metaReady) return;
    const h = headers();
fetch(`${BASE_URL}/v2/dimensions`, { headers: h })
.then(d => {
        const arr = d.value ?? (Array.isArray(d) ? d : []);
        console.log("🗂️ /v2/dimensions count:", arr.length);
        console.log("🗂️ /v2/dimensions FIRST ROW (full):", JSON.stringify(arr[0], null, 2));
        console.log("🗂️ /v2/dimensions SECOND ROW (full):", JSON.stringify(arr[1], null, 2));
        console.log("🗂️ /v2/dimensions all field names:", arr[0] ? Object.keys(arr[0]) : []);
        setDimensionsMeta(arr);
      })
      .catch((e) => {
        console.error("🗂️ /v2/dimensions FAILED:", e);
        setDimensionsMeta([]);
      });
  }, [token, metaReady, headers]);

  /* ── Fetch compare data ─────────────────────────────────── */
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !metaReady) return;
    setCmpLoading(true);
    const h = headers();
    const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}'`;
    Promise.all([
      fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
      fetch(`${BASE_URL}/v2/reports/uploaded-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
        .then(r => r.json()).then(d => d.value ?? (Array.isArray(d) ? d : [])).catch(() => []),
    ]).then(([cons, uploaded]) => {
      setCmpRawData(cons);
      setCmpCfUploadedData(uploaded);
      setCmpLoading(false);
    }).catch(() => { setCmpRawData([]); setCmpCfUploadedData([]); setCmpLoading(false); });
  }, [compareMode, cmpYear, cmpMonth, cmpSource, cmpStructure, metaReady, headers]);

  /* ── Derive parent options & children-of-perspective from groupStructure ── */
  // A "parent" is any company that has at least one child in the current
  // structure. The empty option means "no perspective" (default flat view).
  const { parentOptions, childrenOfPerspective } = useMemo(() => {
    const gsRows = groupStructure.map(g => ({
      company:   g.CompanyShortName ?? g.companyShortName ?? "",
      parent:    g.ParentShortName  ?? g.parentShortName  ?? "",
      structure: g.GroupStructure   ?? g.groupStructure   ?? "",
      hasChild:  g.HasChild         ?? g.hasChild         ?? false,
      detached:  g.Detached         ?? g.detached         ?? false,
    })).filter(g => !g.detached && (!g.structure || g.structure === structure));

    // Parents = companies that have at least one child OR have hasChild flag
    const childCountByParent = new Map();
    gsRows.forEach(g => {
      if (g.parent) childCountByParent.set(g.parent, (childCountByParent.get(g.parent) ?? 0) + 1);
    });

    const parentSet = new Set();
    gsRows.forEach(g => {
      if (g.hasChild || childCountByParent.has(g.company)) parentSet.add(g.company);
    });

    const parentList = [...parentSet]
      .map(p => {
        const legal = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === p)?.CompanyLegalName
          ?? companies.find(c => (c.CompanyShortName ?? c.companyShortName) === p)?.companyLegalName
          ?? p;
        return { value: p, label: legal };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

   const opts = [{ value: "", label: T("perspective_none", "None (all companies)") }, ...parentList];

    // Contributors to the selected perspective = the parent itself + its
    // direct children. The parent is a contributor too because it has its own
    // operational amounts (it's both the holding entity AND an operating
    // company in its own right). This mirrors the consolidation sheet's
    // `[selected, ...kids]` pattern.
    const kids = perspective
      ? gsRows.filter(g => g.parent === perspective).map(g => g.company)
      : [];
    const contributors = perspective ? [perspective, ...kids] : [];

    return { parentOptions: opts, childrenOfPerspective: contributors };
  }, [groupStructure, structure, companies, perspective, T]);

  const perspectiveMode = !!perspective;

/* ── Derive pivot data ──────────────────────────────────── */

// When a mapping is active, derive its sortOrder + breakers + the set of
  // mapped account codes. We use the *converted* form which gives us a flat
  // Map<code, {section, sortOrder, isSum}> — perfect for swapping in for
  // the standard breakerSortOrder/breakers pair without changing the renderer.
  //
  // IMPORTANT: When `treeLiteral` is available (Phase E), we skip this entire
  // derivation because the literal render path handles ordering, breakers,
  // filtering, duplicates and sum nodes itself. Phase D would interfere.
  const mappingDerived = useMemo(() => {
    if (activeMapping?.treeLiteral) return null;
    if (!activeMapping?.treeConverted) return null;
    const { rows, sections } = activeMapping.treeConverted;
    const sortOrder = new Map();
    const mappedCodes = new Set();
    rows.forEach((info, code) => {
      sortOrder.set(code, info.sortOrder);
      // Skip sum nodes from the data table — they have no direct values
      // (they'd need a recursive sum render path which is Phase E).
      if (!info.isSum) mappedCodes.add(code);
    });
    // For each section, find the lowest-sortOrder code and attach the breaker
    // there — the renderer paints the breaker as a row ABOVE that account.
    const firstBySection = new Map();
    rows.forEach((info, code) => {
      if (info.isSum) return;
      const cur = firstBySection.get(info.section);
      if (!cur || info.sortOrder < cur.sortOrder) {
        firstBySection.set(info.section, { code, sortOrder: info.sortOrder });
      }
    });
    const breakers = {};
    firstBySection.forEach(({ code }, section) => {
      const secInfo = sections.get(section);
      if (secInfo && secInfo.label) {
        breakers[code] = { label: secInfo.label, color: secInfo.color || "#1a2f8a" };
      }
    });
    return { sortOrder, breakers, mappedCodes };
  }, [activeMapping]);

const { accountMap, pivot, tree, cols, journalPivot, counterpartyPivot, cmpPivot, dimIdx, journalDimIdx, cptyDimIdx, cmpDimIdx } = useMemo(() => {
    if (!rawData.length) return { accountMap: new Map(), pivot: new Map(), tree: [], cols: [], journalPivot: new Map(), cmpPivot: new Map() };

    const accountMap = new Map();
const filtered = rawData.filter(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Contribution") return false;

      // When a mapping is active, restrict the dataset to ONLY the accounts
      // present in the mapping. This is what "applying" the mapping means
      // visually: foreign codes don't pollute the view.
      if (mappingDerived) {
        const code = r.AccountCode ?? r.accountCode ?? "";
        if (!mappingDerived.mappedCodes.has(code)) return false;
      }

      if (typeFilter) {
        const t = r.AccountType ?? r.accountType ?? "";
        const matchesPL = typeFilter === "P/L" && (t === "P/L" || t === "DIS");
        const matchesCF = typeFilter === "C/F" && (t === "C/F" || t === "CFS");
        if (!matchesPL && !matchesCF && t !== typeFilter) return false;
      }
      // PERSPECTIVE FILTER: only keep companies that are children of the selected parent
      if (perspectiveMode) {
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        if (!childrenOfPerspective.includes(co)) return false;
      }
      return true;
    });

    // Build accountMap from filtered rows
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      if (code && !accountMap.has(code)) {
        accountMap.set(code, {
          AccountCode:    code,
          AccountName:    r.AccountName    ?? r.accountName    ?? "",
          AccountType:    r.AccountType    ?? r.accountType    ?? "",
          SumAccountCode: r.SumAccountCode ?? r.sumAccountCode ?? "",
        });
      }
    });

// Catalogue of all dimension values: code/name/groupCode/groupName.
    // Resolver: given a value (code or name) and optional group hint, return
    // every catalogue entry that matches → lets buildDimKeys expand all forms.
const dimCatalogue = (dimensionsMeta || []).map(d => {
      // The API returns a single `DimensionGroup` field — use it as both
      // groupName and groupCode since we don't have separate values.
      const grp = String(d.DimensionGroup ?? d.dimensionGroup ?? d.DimensionGroupName ?? d.dimensionGroupName ?? "").trim();
      return {
        groupName: grp,
        groupCode: String(d.DimensionGroupCode ?? d.dimensionGroupCode ?? grp).trim(),
        name:      String(d.DimensionName      ?? d.dimensionName      ?? "").trim(),
        code:      String(d.DimensionCode      ?? d.dimensionCode      ?? "").trim(),
      };
    });

    const dimResolver = (value, groupHint) => {
      const v = String(value || "").trim();
      const g = String(groupHint || "").trim();
      if (!v) return [];
      return dimCatalogue.filter(d => {
        const matchVal = d.name === v || d.code === v;
        if (!matchVal) return false;
        if (!g) return true;
        return d.groupName === g || d.groupCode === g;
      });
    };

    const pivot = new Map();
    const dimIdx = new Map(); // `${code}|${co}` → Map<dimKey, amount>
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!code || !co) return;
      if (!pivot.has(code)) pivot.set(code, {});
      const c = pivot.get(code);
      if (!c[co]) c[co] = { total: 0, rows: [] };
const reportingAmt = Number(r.ReportingAmountYTD ?? r.reportingAmountYTD);
      const localAmt     = Number(r.AmountYTD ?? r.amountYTD);
      const amt = currencyMode === "local"
        ? (Number.isFinite(localAmt) ? localAmt : 0)
        : (Number.isFinite(reportingAmt) ? reportingAmt : (Number.isFinite(localAmt) ? localAmt : 0));
      c[co].total += amt;
      c[co].rows.push(r);

// Dim index for literal-mode dim filters
      const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${co}`;
        if (!dimIdx.has(k)) dimIdx.set(k, new Map());
        const m = dimIdx.get(k);
        dimKeys.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
      }
    });
const TYPE_ORDER = { "P/L": 0, "DIS": 0, "B/S": 1, "C/F": 2, "CFS": 2 };

// Effective sort order: mapping overrides standard.
    const effectiveSortOrder = mappingDerived?.sortOrder ?? breakerSortOrder;

    let tree;
    if (effectiveSortOrder.size > 0) {
      // Flat list sorted by mapping (or standard) sort_order
      tree = [...accountMap.values()]
        .filter(n => {
          const type = n.AccountType ?? "";
          return type === "P/L" || type === "DIS" || type === "B/S" || type === "C/F" || type === "CFS";
        })
        .sort((a, b) => {
          const sA = effectiveSortOrder.get(a.AccountCode) ?? 9999;
          const sB = effectiveSortOrder.get(b.AccountCode) ?? 9999;
          if (sA !== sB) return sA - sB;
          const tA = TYPE_ORDER[a.AccountType ?? ""] ?? 99;
          const tB = TYPE_ORDER[b.AccountType ?? ""] ?? 99;
          return tA - tB;
        })
        .map(n => ({ ...n, children: [] }));
    } else {
      const rawTree = buildTree([...accountMap.values()]);
      tree = [...rawTree].sort((a, b) => {
        const tA = TYPE_ORDER[a.AccountType ?? a.accountType ?? ""] ?? 99;
        const tB = TYPE_ORDER[b.AccountType ?? b.accountType ?? ""] ?? 99;
        if (tA !== tB) return tA - tB;
        return pgcSort(a, b);
      });
    }
    const cols = [...new Set(filtered.map(r => r.CompanyShortName ?? r.companyShortName ?? "").filter(Boolean))].sort();

// Journal pivot — Phase 1 fixes:
    //  • Use currencyMode to pick reporting vs local amount (same as main pivot)
    //  • Sign matches main pivot (no inversion)
    //  • Only count journals where CompanyShortName === target company
    //    (counterparty impact moved to a separate pivot in a later phase)
    const journalPivot = new Map();
    const add = (code, co, jt, amt) => {
      if (!code || !co) return;
      if (!journalPivot.has(code)) journalPivot.set(code, {});
      const c = journalPivot.get(code);
      if (!c[co]) c[co] = {};
      c[co][jt] = (c[co][jt] ?? 0) + amt;
    };
const journalDimIdx = new Map(); // `${code}|${co}` → Map<dimKey, {AJE, RJE, ...}>
    journalData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      const jt   = String(r.JournalType ?? r.journalType ?? "").toUpperCase();
      if (!code || !co || !jt) return;

      // journal-entries returns AmountYTD with INVERTED sign vs consolidated-accounts.
      // Negate it so the journal pivot matches the main pivot's sign convention.
      const reportingAmt = Number(r.ReportingAmountYTD ?? r.reportingAmountYTD);
      const localAmt     = Number(r.AmountYTD ?? r.amountYTD);
      const amt = currencyMode === "local"
        ? (Number.isFinite(localAmt) ? -localAmt : 0)
        : (Number.isFinite(reportingAmt) ? -reportingAmt : (Number.isFinite(localAmt) ? -localAmt : 0));

      add(code, co, jt, amt);

const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${co}`;
        if (!journalDimIdx.has(k)) journalDimIdx.set(k, new Map());
        const m = journalDimIdx.get(k);
        dimKeys.forEach(dk => {
          if (!m.has(dk)) m.set(dk, {});
          const bucket = m.get(dk);
          bucket[jt] = (bucket[jt] ?? 0) + amt;
        });
      }
    });

    const rolled = new Map();
    const rollUp = (node) => {
      const code = node.AccountCode;
      const result = {};
      const direct = journalPivot.get(code) ?? {};
      Object.entries(direct).forEach(([co, jtMap]) => {
        if (!result[co]) result[co] = {};
        Object.entries(jtMap).forEach(([jt, amt]) => { result[co][jt] = (result[co][jt] ?? 0) + amt; });
      });
      (node.children || []).forEach(child => {
        const childRolled = rollUp(child);
        Object.entries(childRolled).forEach(([co, jtMap]) => {
          if (!result[co]) result[co] = {};
          Object.entries(jtMap).forEach(([jt, amt]) => { result[co][jt] = (result[co][jt] ?? 0) + amt; });
        });
      });
      rolled.set(code, result);
      return result;
    };
tree.forEach(rollUp);

    // ─── Counterparty pivot — Phase 3 ───────────────────────────────
    // For each (account, company), sum journals where THAT company appears
    // as CounterpartyShortName (not as CompanyShortName). This is the
    // "indirect impact" — journals other companies posted referencing
    // this one. Used in the opt-in IC column.
const counterpartyPivot = new Map();
    const cptyDimIdx = new Map();
    journalData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const cpty = r.CounterpartyShortName ?? r.counterpartyShortName ?? "";
      if (!code || !cpty) return;
      const reportingAmt = Number(r.ReportingAmountYTD ?? r.reportingAmountYTD);
      const localAmt     = Number(r.AmountYTD ?? r.amountYTD);
      const amt = currencyMode === "local"
        ? (Number.isFinite(localAmt) ? -localAmt : 0)
        : (Number.isFinite(reportingAmt) ? -reportingAmt : (Number.isFinite(localAmt) ? -localAmt : 0));
      if (!counterpartyPivot.has(code)) counterpartyPivot.set(code, {});
      const c = counterpartyPivot.get(code);
      c[cpty] = (c[cpty] ?? 0) + amt;

const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${cpty}`;
        if (!cptyDimIdx.has(k)) cptyDimIdx.set(k, new Map());
        const m = cptyDimIdx.get(k);
        dimKeys.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
      }
    });

    // Roll up counterparty pivot through the tree (same as journal pivot)
    const rolledCpty = new Map();
    const rollUpCpty = (node) => {
      const code = node.AccountCode;
      const result = {};
      const direct = counterpartyPivot.get(code) ?? {};
      Object.entries(direct).forEach(([co, amt]) => {
        result[co] = (result[co] ?? 0) + amt;
      });
      (node.children || []).forEach(child => {
        const childRolled = rollUpCpty(child);
        Object.entries(childRolled).forEach(([co, amt]) => {
          result[co] = (result[co] ?? 0) + amt;
        });
      });
      rolledCpty.set(code, result);
      return result;
    };
    tree.forEach(rollUpCpty);

const cmpPivot = new Map();
    const cmpDimIdx = new Map();
    cmpRawData.filter(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Contribution") return false;
      if (perspectiveMode) {
        const co = r.CompanyShortName ?? r.companyShortName ?? "";
        if (!childrenOfPerspective.includes(co)) return false;
      }
      return true;
}).forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!code || !co) return;
      if (!cmpPivot.has(code)) cmpPivot.set(code, {});
      const c = cmpPivot.get(code);
      if (!c[co]) c[co] = 0;
      const reportingAmt = Number(r.ReportingAmountYTD ?? r.reportingAmountYTD);
      const localAmt     = Number(r.AmountYTD ?? r.amountYTD);
      const amt = currencyMode === "local"
        ? (Number.isFinite(localAmt) ? localAmt : 0)
        : (Number.isFinite(reportingAmt) ? reportingAmt : (Number.isFinite(localAmt) ? localAmt : 0));
      c[co] += amt;

const dimKeys = buildDimKeys(r, dimResolver);
      if (dimKeys.size > 0) {
        const k = `${code}|${co}`;
        if (!cmpDimIdx.has(k)) cmpDimIdx.set(k, new Map());
        const m = cmpDimIdx.get(k);
        dimKeys.forEach(dk => m.set(dk, (m.get(dk) ?? 0) + amt));
      }
    });

return { accountMap, pivot, tree, cols, journalPivot: rolled, counterpartyPivot: rolledCpty, cmpPivot, dimIdx, journalDimIdx, cptyDimIdx, cmpDimIdx };
}, [rawData, journalData, typeFilter, cmpRawData, perspectiveMode, childrenOfPerspective, breakerSortOrder, currencyMode, mappingDerived, dimensionsMeta]);

// CF-specific pivot from uploaded data
 const { cfTree, cfPivot, cfCols, cmpCfPivot } = useMemo(() => {
if (typeFilter !== "C/F" || !cfUploadedData.length || !cfMetadata.size) {
      return { cfTree: [], cfPivot: new Map(), cfCols: [], cmpCfPivot: new Map() };
    }
    // When a CF mapping is active, mappingDerived tells us which CF account
    // codes to keep and how to order them. Sum nodes excluded (MVP).
    const cfMappingActive = mappingTab === "cf" ? mappingDerived : null;

    const piv = new Map();
    const filteredUploaded = perspectiveMode
      ? cfUploadedData.filter(r => childrenOfPerspective.includes(r.CompanyShortName ?? r.companyShortName ?? ""))
      : cfUploadedData;

    filteredUploaded.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!groupCode || !co) return;
      const cfs = cfGroupToCf.get(groupCode);
      if (!cfs) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      cfs.forEach(cfCode => {
        if (!piv.has(cfCode)) piv.set(cfCode, {});
        const c = piv.get(cfCode);
        if (!c[co]) c[co] = { total: 0, rows: [] };
        c[co].total += amt;
        c[co].rows.push(r);
      });
    });

// Bubble up to parents — only from direct children, not all descendants
    const directChildren = new Map(); // parent -> [child codes]
    cfMetadata.forEach(({ sumParent }, code) => {
      if (sumParent && piv.has(code)) {
        if (!directChildren.has(sumParent)) directChildren.set(sumParent, []);
        directChildren.get(sumParent).push(code);
      }
    });

    // Process bottom-up: find all codes that have no children in piv (leaves)
    // then sum upward level by level
    const allCodes = new Set([...piv.keys()]);
cfMetadata.forEach(({ sumParent }) => {
      if (sumParent) allCodes.add(sumParent);
    });

    // Topological sort - process leaves first
    const processed = new Set();
    const processCode = (code) => {
      if (processed.has(code)) return;
      const children = directChildren.get(code) || [];
      children.forEach(c => processCode(c));
      // Sum direct children into this parent
      if (children.length > 0 && !piv.has(code)) {
        piv.set(code, {});
      }
      if (children.length > 0) {
        const pp = piv.get(code);
        children.forEach(childCode => {
          const cp = piv.get(childCode) || {};
Object.entries(cp).forEach(([co, { total }]) => {
            if (!pp[co]) pp[co] = { total: 0, rows: [] };
            pp[co].total += total;
          });
        });
      }
      processed.add(code);
      // Bubble to parent
      const meta = cfMetadata.get(code);
      if (meta?.sumParent) {
        const parent = meta.sumParent;
        if (!piv.has(parent)) piv.set(parent, {});
        const pp = piv.get(parent);
        const cp = piv.get(code) || {};
        Object.entries(cp).forEach(([co, { total }]) => {
          if (!pp[co]) pp[co] = { total: 0, rows: [] };
          pp[co].total += total;
        });
      }
    };

// Only process leaf nodes (those with no children in piv)
    [...piv.keys()].forEach(code => {
      const hasChildren = directChildren.has(code);
      if (!hasChildren) processCode(code);
    });

    // Build tree nodes from cfMetadata
    const cfAccountMap = new Map();
// Build a name lookup combining all 3 sources (priority order):
    //  1. cfMetadata (from /v2/mapped-cashflow-accounts — cashFlowAccountName)
    //  2. cfMapping rows (sumAccountName fallback for parents)
    //  3. cfNameDict (from consolidated rows with AccountType C/F or CFS)
    const cfNameLookup = new Map();
    // Source 3 first (lowest priority — used as fallback only)
    Object.entries(cfNameDict).forEach(([code, name]) => {
      if (code && name) cfNameLookup.set(String(code), String(name));
    });
    // Source 2 — override with mapping rows
    cfMapping.forEach(map => {
      const code    = map.cashFlowAccountCode            ?? map.CashFlowAccountCode            ?? "";
      const name    = map.cashFlowAccountName            ?? map.CashFlowAccountName            ?? "";
      const sumCode = map.cashFlowAccountSumAccountCode  ?? map.CashFlowAccountSumAccountCode  ?? "";
      const sumName = map.cashFlowAccountSumAccountName  ?? map.CashFlowAccountSumAccountName  ?? "";
      if (code && name)    cfNameLookup.set(String(code), String(name));
      if (sumCode && sumName && !cfNameLookup.has(String(sumCode))) cfNameLookup.set(String(sumCode), String(sumName));
    });
    // Source 1 — highest priority (cfMetadata is authoritative)
cfMetadata.forEach(({ name }, code) => {
      if (name && code) cfNameLookup.set(String(code), String(name));
    });



// Synthetic parents (reconstructed from sumAccountCode chains but with no
    // name available anywhere) are noise — exclude them. Their children will
    // bubble up to the next named ancestor automatically.
    const resolveNamedAncestor = (startCode) => {
      let cur = cfMetadata.get(startCode)?.sumParent ?? "";
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const name = cfNameLookup.get(cur);
        if (name) return cur;
        cur = cfMetadata.get(cur)?.sumParent ?? "";
      }
      return "";
    };

    cfMetadata.forEach(({ name, sumParent }, code) => {
      if (!piv.has(code)) return;
      const resolvedName = cfNameLookup.get(code) || name || "";
      if (!resolvedName) return; // skip synthetic parents
      cfAccountMap.set(code, {
        AccountCode: code,
        AccountName: resolvedName,
        AccountType: "C/F",
        // If the immediate parent has no name, climb up to find one
        SumAccountCode: (sumParent && cfNameLookup.get(sumParent))
          ? sumParent
          : resolveNamedAncestor(code),
      });
    });

// If a CF mapping is active: drop unmapped accounts and order flat by mapping sortOrder.
    // If not: use the standard bubble-up tree as before.
    let cfTree;
    if (cfMappingActive) {
      const filteredMap = new Map();
      cfAccountMap.forEach((node, code) => {
        if (cfMappingActive.mappedCodes.has(code)) filteredMap.set(code, node);
      });
      cfTree = [...filteredMap.values()]
        .sort((a, b) => {
          const sA = cfMappingActive.sortOrder.get(a.AccountCode) ?? 9999;
          const sB = cfMappingActive.sortOrder.get(b.AccountCode) ?? 9999;
          return sA - sB;
        })
        .map(n => ({ ...n, children: [] }));
    } else {
      cfTree = buildTree([...cfAccountMap.values()]);
    }
    const cfCols = [...new Set(filteredUploaded.map(r => r.CompanyShortName ?? r.companyShortName ?? "").filter(Boolean))].sort();

// Build compare CF pivot
    const cmpPivCf = new Map();
    const cmpFiltered = perspectiveMode
      ? cmpCfUploadedData.filter(r => childrenOfPerspective.includes(r.CompanyShortName ?? r.companyShortName ?? ""))
      : cmpCfUploadedData;

    cmpFiltered.forEach(r => {
      const groupCode = String(r.AccountCode ?? r.accountCode ?? "");
      const co = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!groupCode || !co) return;
      const cfs = cfGroupToCf.get(groupCode);
      if (!cfs) return;
      const amt = Number(r.AmountYTD ?? r.amountYTD ?? 0);
      cfs.forEach(cfCode => {
        if (!cmpPivCf.has(cfCode)) cmpPivCf.set(cfCode, {});
        const c = cmpPivCf.get(cfCode);
        if (!c[co]) c[co] = 0;
        c[co] += amt;
      });
    });

    // Bubble up compare pivot
    [...cmpPivCf.keys()].forEach(leafCode => {
      const meta = cfMetadata.get(leafCode);
      if (!meta) return;
      let parent = meta.sumParent;
      const seen = new Set([leafCode]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const lp = cmpPivCf.get(leafCode) || {};
        if (!cmpPivCf.has(parent)) cmpPivCf.set(parent, {});
        const pp = cmpPivCf.get(parent);
        Object.entries(lp).forEach(([co, total]) => {
          pp[co] = (pp[co] ?? 0) + total;
        });
        parent = cfMetadata.get(parent)?.sumParent || "";
      }
    });

return { cfTree, cfPivot: piv, cfCols, cmpCfPivot: cmpPivCf };
  }, [typeFilter, cfUploadedData, cfMetadata, cfGroupToCf, perspectiveMode, childrenOfPerspective, cmpCfUploadedData, mappingDerived, mappingTab, cfNameDict, cfMapping]);



  const toggleExpand = useCallback(code => {
    setExpandedSet(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }, []);

// Walk the visible tree, collect ids/codes of nodes that have children.
  // In literal mode nodes use `id`; in standard mode they use `AccountCode`.
  const collectExpandableCodes = useCallback((nodes, useId = false) => {
    const out = [];
    const walk = (n) => {
      if (n.children?.length > 0) {
        out.push(useId ? n.id : n.AccountCode);
        n.children.forEach(walk);
      }
    };
    nodes.forEach(walk);
    return out;
  }, []);

const expandAll = useCallback(() => {
    if (activeMapping?.treeLiteral) {
      // Literal mode — flatten all sections' nodes and collect by id
      const all = [];
      activeMapping.treeLiteral.forEach(sec => (sec.nodes || []).forEach(n => all.push(n)));
      setExpandedSet(new Set(collectExpandableCodes(all, true)));
      return;
    }
    const activeTree = typeFilter === "C/F" ? cfTree : tree;
    setExpandedSet(new Set(collectExpandableCodes(activeTree)));
  }, [tree, cfTree, typeFilter, collectExpandableCodes, activeMapping]);

  const collapseAll = useCallback(() => setExpandedSet(new Set()), []);

  // Grand totals
  const colTotal = co => [...accountMap.keys()].reduce((s, code) => s + (pivot.get(code)?.[co]?.total ?? 0), 0);
  const _grandTotal = cols.reduce((s, co) => s + colTotal(co), 0);

  // Filter options
  const getP = (p, k) => p[k] ?? p[k.charAt(0).toUpperCase() + k.slice(1)];

  const yearOpts = [...new Set(periods.map(p => Number(getP(p,"year")||0)).filter(n => n > 0))]
    .sort((a,b) => b - a).map(y => ({ value: String(y), label: String(y) }));

const monthOpts = [...new Set(periods.map(p => Number(getP(p,"month")||0)).filter(n => n > 0))]
    .sort((a,b) => a - b)
    .map(m => ({ value: String(m), label: T(`month_${m}`, String(m)) }));

  const sourceOpts = [...new Set(sources.map(s => {
    const v = typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const structureOpts = [...new Set(structures.map(s => {
    const v = typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const hasData = rawData.length > 0;

  // Effective cols after company filter — always derived from current `cols`,
  // which is already perspective-filtered.
const baseEffectiveCols = selectedCompanies.length === 0
    ? cols
    : cols.filter(c => selectedCompanies.includes(c));

  // Apply user's drag-and-drop ordering. Any cols not yet in colOrder
  // (e.g. newly-arrived after a perspective change) get appended at the end.
  const effectiveCols = useMemo(() => {
    if (colOrder.length === 0) return baseEffectiveCols;
    const ordered = colOrder.filter(c => baseEffectiveCols.includes(c));
    const rest = baseEffectiveCols.filter(c => !ordered.includes(c));
    return [...ordered, ...rest];
  }, [baseEffectiveCols, colOrder]);

  const reorderCols = useCallback((from, to) => {
    setColOrder(prev => {
      const current = prev.length > 0 ? [...prev] : [...effectiveCols];
      const fromIdx = current.indexOf(from);
      const toIdx = current.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = current.splice(fromIdx, 1);
      current.splice(toIdx, 0, moved);
      return current;
    });
  }, [effectiveCols]);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
<style>{`
        .contributive-body::-webkit-scrollbar { width: 0px; height: 6px; }
        .contributive-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .contributive-body::-webkit-scrollbar-track { background: transparent; }
.contributive-body thead { background: rgba(255,255,255,0.95); }
        .contributive-body thead th { border-color: transparent !important; box-shadow: none !important; }
@keyframes subColIn    { 0% { opacity:0; transform:translateX(-10px) scaleX(0.85); } 100% { opacity:1; transform:translateX(0) scaleX(1); } }
        @keyframes plRowSlideIn { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @keyframes rowExpandIn  { 0% { opacity:0; transform:translateY(-4px) scaleY(0.92); } 100% { opacity:1; transform:translateY(0) scaleY(1); } }
        @keyframes iconMorph    { 0% { opacity:0; transform: scale(0.4) rotate(-90deg); } 60% { opacity:1; } 100% { opacity:1; transform: scale(1) rotate(0deg); } }
        @keyframes floatOrb1    { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(20px,-30px) scale(1.1); } }
        @keyframes floatOrb2    { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-15px,20px) scale(0.95); } }
        @keyframes spinSlow     { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinSlowR    { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
      `}</style>
{showJournals && (
<JournalsModal
          T={T}
          journalData={journalData}
          onClose={() => setShowJournals(false)}
          year={year}
          month={month}
          source={source}
          colors={colors}
          header2Style={header2Style}
          underscore1Style={underscore1Style}
          underscore2Style={underscore2Style}
          body2Style={body2Style}
        />
      )}

{/* Drilldown */}
      {drilldown && (
<DrilldownModal
          T={T}
          accountCode={drilldown.node.AccountCode}
          accountName={drilldown.node.AccountName ?? drilldown.node.accountName ?? ""}
          company={drilldown.company}
          rows={drilldown.rows}
          currency={getReportingCurrency(drilldown.company, groupStructure, companies)}
          onClose={() => setDrilldown(null)}
        />
      )}

<PageHeader
kicker={viewsMode ? T("mappings") : T("kicker_accounts")}
        title={viewsMode === "landing" ? T("mappings")
             : viewsMode === "structure" ? T("am_card_structure_title")
             : viewsMode === "report" ? T("am_card_report_title")
             : T("contrib_label", "Contribution")}
        onBack={viewsMode ? () => {
          if (viewsMode === "landing") setViewsMode(null);
          else setViewsMode("landing");
        } : undefined}
        mappingsQuickAccess={!viewsMode ? recentMappings : []}
        onQuickApplyMapping={async (m) => {
          const api = await pickMappingApi(mappingTab, m.kind);
          const full = await api.getMapping(m.id);
          handleApplyMapping(full ?? m.raw, m.kind);
        }}
tabs={viewsMode ? [] : [
          { id: "",    label: T("all"),                 icon: Filter    },
          { id: "P/L", label: T("tab_pl"),              icon: TrendingUp },
          { id: "B/S", label: T("tab_bs_short"),        icon: BarChart2 },
          { id: "C/F", label: T("nav_cashflow"),        icon: Layers },
        ]}
        activeTab={viewsMode ? null : typeFilter}
        onTabChange={viewsMode ? undefined : setTypeFilter}
        filters={viewsMode ? [] : [
          ...(sourceOpts.length > 0
? [{ label: T("filter_source"), value: source, onChange: setSource, options: sourceOpts }]
            : []),
          ...(yearOpts.length > 0
            ? [{ label: T("filter_year"), value: year, onChange: setYear, options: yearOpts }]
            : []),
          ...(monthOpts.length > 0
            ? [{ label: T("filter_month"), value: month, onChange: setMonth, options: monthOpts }]
            : []),
...(structureOpts.length > 0
            ? [{ label: T("filter_structure"), value: structure, onChange: setStructure, options: structureOpts }]
            : []),
          { label: T("filter_currency", "Currency"), value: currencyMode, onChange: setCurrencyMode,
            options: [
              { value: "reporting", label: T("currency_reporting", "Reporting") },
              { value: "local",     label: T("currency_local", "Local")         },
            ] },
          ...(parentOptions.length > 1
            ? [{ label: T("filter_perspective"), value: perspective, onChange: (v) => { setPerspective(v); setSelectedCompanies([]); }, options: parentOptions }]
            : []),
...(cols.length > 0
            ? [{
                label: T("filter_company"),
                multiselect: true,
                values: selectedCompanies.length === 0 ? null : selectedCompanies,
                onChange: (v) => setSelectedCompanies(v ?? []),
                options: cols.map(co => ({
                  value: co,
                  label: companies.find(c =>
                    (c.CompanyShortName ?? c.companyShortName) === co
                  )?.CompanyLegalName ?? co,
                })),
              }]
            : []),
        ]}
compareToggle={viewsMode ? null : {
          active: compareMode,
          onChange: (newVal) => {
            if (newVal && !compareMode) {
              setCmpYear(year); setCmpMonth(month);
              setCmpSource(source); setCmpStructure(structure);
            }
            setCompareMode(newVal);
          },
        }}
headerActions={viewsMode ? [] : (journalData.length > 0 ? [
          {
            label: `${T("export_journal_entries")} (${journalData.length})`,
            icon: FileText,
            onClick: () => setShowJournals(true),
          },
        ] : [])}
        onMappingsClick={viewsMode ? undefined : (mappingsEnabled ? () => setViewsMode("landing") : undefined)}
onExportPdf={viewsMode ? undefined : () => {
          const cfNameLookup = new Map();
          Object.entries(cfNameDict).forEach(([code, name]) => {
            if (code && name) cfNameLookup.set(String(code), String(name));
          });
          cfMapping.forEach(m => {
            const code    = m.cashFlowAccountCode            ?? m.CashFlowAccountCode            ?? "";
            const name    = m.cashFlowAccountName            ?? m.CashFlowAccountName            ?? "";
            const sumCode = m.cashFlowAccountSumAccountCode  ?? m.CashFlowAccountSumAccountCode  ?? "";
            const sumName = m.cashFlowAccountSumAccountName  ?? m.CashFlowAccountSumAccountName  ?? "";
            if (code && name) cfNameLookup.set(String(code), String(name));
            if (sumCode && sumName && !cfNameLookup.has(String(sumCode))) cfNameLookup.set(String(sumCode), String(sumName));
          });
          cfMetadata.forEach(({ name }, code) => {
            if (name && code) cfNameLookup.set(String(code), String(name));
          });

generateContributivePdf({
            T,
            tree,
            treeLiteral: activeMapping?.treeLiteral ?? null,
            pivot,
            cfTree, cfPivot,
            cols: effectiveCols, cfCols,
            cmpPivot, cmpCfPivot,
            typeFilter, activeMapping, mappingTab,
            dimIdx, cmpDimIdx,
            journalPivot, counterpartyPivot,
            cfNameLookup,
            companies, groupStructure,
            compareMode,
            perspectiveMode, perspectiveParent: perspective,
            month, year, source, structure,
            cmpMonth, cmpYear, cmpSource, cmpStructure,
          });
        }}
onExportXlsx={viewsMode ? undefined : () => {
          // Build a CF code → name lookup combining all 3 sources, same priority
          // as the in-app cfTree useMemo: cfNameDict (lowest) ← cfMapping ← cfMetadata (highest).
          const cfNameLookup = new Map();
          Object.entries(cfNameDict).forEach(([code, name]) => {
            if (code && name) cfNameLookup.set(String(code), String(name));
          });
          cfMapping.forEach(m => {
            const code    = m.cashFlowAccountCode            ?? m.CashFlowAccountCode            ?? "";
            const name    = m.cashFlowAccountName            ?? m.CashFlowAccountName            ?? "";
            const sumCode = m.cashFlowAccountSumAccountCode  ?? m.CashFlowAccountSumAccountCode  ?? "";
            const sumName = m.cashFlowAccountSumAccountName  ?? m.CashFlowAccountSumAccountName  ?? "";
            if (code && name) cfNameLookup.set(String(code), String(name));
            if (sumCode && sumName && !cfNameLookup.has(String(sumCode))) cfNameLookup.set(String(sumCode), String(sumName));
          });
          cfMetadata.forEach(({ name }, code) => {
            if (name && code) cfNameLookup.set(String(code), String(name));
          });

generateContributiveXlsx({
            T,
            tree,
            treeLiteral: activeMapping?.treeLiteral ?? null,
            pivot,
            cfTree, cfPivot,
            cols: effectiveCols, cfCols,
            cmpPivot, cmpCfPivot,
            typeFilter, activeMapping, mappingTab,
            dimIdx, cmpDimIdx,
            journalPivot, counterpartyPivot,
            cfNameLookup,
companies, groupStructure,
            compareMode,
            perspectiveMode, perspectiveParent: perspective,
            month, year, source, structure,
            cmpMonth, cmpYear, cmpSource, cmpStructure,
          });
        }}
      />

{activeMapping && !viewsMode && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            borderColor: "rgba(16,185,129,0.25)",
            boxShadow: "0 2px 8px -2px rgba(16,185,129,0.15)",
          }}>
          <div className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
            style={{ background: "rgba(16,185,129,0.18)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
<p className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#047857", opacity: 0.7 }}>
              {T("mapping_active")} · {mappingTab.toUpperCase()}
            </p>
            <p className="text-sm font-black truncate" style={{ color: "#064e3b" }}>
              {activeMapping.name} <span className="font-bold opacity-50">· {activeMapping.standard ?? T("am_filter_custom")} · {activeMapping.kind === "report" ? T("am_tag_report") : T("am_tag_structure")}</span>
            </p>
          </div>
<button
            onClick={() => {
              // CF uses its own mapper page + storage key; PL/BS share the
              // "mappings" page with Individuales since they hit the same APIs.
              const isCf = activeMapping.tab === "cf";
              const storageKey = isCf ? "cashflow-mappings:openForEdit" : "mappings:openForEdit";
              const route = isCf ? "cashflow-mappings" : "mappings";
              try {
                sessionStorage.setItem(storageKey, JSON.stringify({
                  mapping_id: activeMapping.mapping_id,
                  kind: activeMapping.kind ?? "structure",
                }));
              } catch { /* ignore quota errors */ }
              if (typeof onNavigate === "function") {
                onNavigate(route);
              } else {
                // Fallback: hash routing in case the parent didn't wire onNavigate
                window.location.hash = `#/${route}`;
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "white", color: "#047857", border: "1px solid rgba(16,185,129,0.2)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f0fdf4"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; }}>
<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            {T("btn_edit")}
          </button>
          <button
            onClick={clearActiveMapping}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "rgba(207,48,93,0.08)", color: "#CF305D", border: "1px solid rgba(207,48,93,0.15)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(207,48,93,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(207,48,93,0.08)"; }}>
            <X size={10} strokeWidth={3} />
            {T("btn_clear")}
          </button>
        </div>
      )}

{compareMode && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-2 mr-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #CF305D 0%, #e0558d 100%)", boxShadow: "0 4px 12px -4px rgba(207,48,93,0.5)" }}>
              <span className="text-white text-[11px] font-black">B</span>
            </div>
<span className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: "#CF305D" }}>{T("btn_compare_with")}</span>
          </div>
          <HeaderFilterPill label={T("filter_source")}    value={cmpSource}    onChange={setCmpSource}    options={sourceOpts} />
          <HeaderFilterPill label={T("filter_year")}      value={cmpYear}      onChange={setCmpYear}      options={yearOpts} />
          <HeaderFilterPill label={T("filter_month")}     value={cmpMonth}     onChange={setCmpMonth}     options={monthOpts} />
          <HeaderFilterPill label={T("filter_structure")} value={cmpStructure} onChange={setCmpStructure} options={structureOpts} />
          {cmpLoading && <Loader2 size={11} className="animate-spin ml-2" style={{ color: colors.primary }} />}
        </div>
      )}

{/* Mappings landing / library — replaces the table when viewsMode is set */}
      {viewsMode === "landing" && (
<MappingsLanding
          T={T}
          colors={colors}
          mappingTab={mappingTab}
          onPickStructure={() => setViewsMode("structure")}
          onPickReport={() => setViewsMode("report")}
        />
      )}
{(viewsMode === "structure" || viewsMode === "report") && (
<MappingsLibrary
          T={T}
          colors={colors}
          kind={viewsMode}
          mappingTab={mappingTab}
          activeMapping={activeMapping}
          mappings={savedMappings}
          loading={mappingsLoading}
          error={mappingsError}
          onApply={(m) => handleApplyFromCard(m, viewsMode)}
          onClearActive={clearActiveMapping}
          onRetry={() => {
            // Re-trigger fetch by bouncing viewsMode
            const m = viewsMode;
            setViewsMode("landing");
            setTimeout(() => setViewsMode(m), 50);
          }}
        />
      )}

      {/* Table — only when not in views mode */}
      {!viewsMode && (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0 relative" style={{ overflow: "hidden" }}>
<SpinnerOverlay
          T={T}
          show={!metaReady || loading || probingPeriod}
          colors={colors}
          metaReady={metaReady}
          probingPeriod={probingPeriod}
        />
{!metaReady || loading || probingPeriod ? (
          <div className="flex-1 min-h-0" />
) : !hasData ? (
          <div className="flex items-center justify-center flex-1 p-8">
            <div className="relative max-w-md w-full text-center"
              style={{ animation: "plRowSlideIn 500ms cubic-bezier(0.34,1.56,0.64,1)" }}>

              {/* Decorative background orbs */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                <div className="absolute" style={{
                  width: 180, height: 180, top: -40, right: -40,
                  background: `radial-gradient(circle, ${colors.primary}12 0%, transparent 70%)`,
                  animation: "floatOrb1 8s ease-in-out infinite",
                }} />
                <div className="absolute" style={{
                  width: 120, height: 120, bottom: -20, left: -20,
                  background: "radial-gradient(circle, rgba(207,48,93,0.10) 0%, transparent 70%)",
                  animation: "floatOrb2 11s ease-in-out 2s infinite",
                }} />
              </div>

              <div className="relative z-10 p-10 rounded-3xl"
                style={{
                  background: "linear-gradient(135deg, #ffffff 0%, #fafbff 100%)",
                  border: "1px solid rgba(26,47,138,0.06)",
                  boxShadow: "0 20px 60px -12px rgba(26,47,138,0.08)",
                }}>

                {/* Icon with concentric rings */}
                <div className="relative mx-auto mb-6" style={{ width: 88, height: 88 }}>
                  <svg width="88" height="88" viewBox="0 0 88 88" className="absolute inset-0">
                    <circle cx="44" cy="44" r="40" fill="none"
                      stroke={`${colors.primary}15`} strokeWidth="1.5"
                      strokeDasharray="4 6"
                      style={{ transformOrigin: "44px 44px", animation: "spinSlow 20s linear infinite" }} />
                    <circle cx="44" cy="44" r="28" fill="none"
                      stroke={`${colors.primary}25`} strokeWidth="1.5"
                      strokeDasharray="3 5"
                      style={{ transformOrigin: "44px 44px", animation: "spinSlowR 14s linear infinite" }} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{
                        background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                        boxShadow: `0 8px 24px -6px ${colors.primary}50, inset 0 1px 0 rgba(255,255,255,0.2)`,
                      }}>
                      <Search size={20} className="text-white" strokeWidth={2.2} />
                    </div>
                  </div>
                </div>

                <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
                  style={{ color: colors.primary, opacity: 0.6 }}>
                  {T("contrib_empty_kicker", "Búsqueda completada")}
                </p>

                <h3 className="font-black text-xl text-gray-800 mb-3 tracking-tight"
                  style={{ letterSpacing: "-0.02em" }}>
                  {perspectiveMode
                    ? T("contrib_empty_perspective_title", "Sin datos para esta perspectiva")
                    : T("contrib_empty_title", "No encontramos datos")}
                </h3>

                <p className="text-sm text-gray-500 leading-relaxed mb-6">
                  {perspectiveMode
                    ? T("contrib_no_perspective_data") + ` ${perspective}.`
                    : T("contrib_empty_desc", "Hemos probado varias combinaciones de fuente, estructura y periodo sin éxito. Es posible que otra combinación de filtros sí tenga datos.")}
                </p>

                {/* Suggestion chips */}
                <div className="flex flex-col gap-2 mb-6">
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                    style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: `${colors.primary}15`, color: colors.primary }}>
                      <Filter size={13} strokeWidth={2.4} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-700">
                        {T("contrib_empty_tip1_title", "Prueba otra fuente o estructura")}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {T("contrib_empty_tip1_desc", "Usa los filtros de arriba para cambiar el origen de los datos")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                    style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}10` }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: `${colors.primary}15`, color: colors.primary }}>
                      <RefreshCw size={13} strokeWidth={2.4} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-700">
                        {T("contrib_empty_tip2_title", "Ajusta el periodo")}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {T("contrib_empty_tip2_desc", "Selecciona otro año o mes desde la cabecera")}
                      </p>
                    </div>
                  </div>

                  {perspectiveMode && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                      style={{ background: "rgba(207,48,93,0.05)", border: "1px solid rgba(207,48,93,0.10)" }}>
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(207,48,93,0.12)", color: "#CF305D" }}>
                        <X size={13} strokeWidth={2.4} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-700">
                          {T("contrib_empty_tip3_title", "Quita la perspectiva")}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {T("contrib_empty_tip3_desc", "Selecciona \"Ninguna\" en el filtro Perspectiva")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    autoPeriodDone.current = false;
                    setProbingPeriod(true);
                    // Bump deps to retrigger the probe effect
                    setStructure(s => s);
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                  style={{
                    background: `linear-gradient(145deg, ${colors.primary} 0%, #3b54b8 100%)`,
                    color: "white",
                    boxShadow: `0 6px 16px -4px ${colors.primary}40`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
                  <RefreshCw size={12} strokeWidth={2.6} />
                  {T("contrib_empty_retry", "Probar de nuevo")}
                </button>
              </div>
            </div>
          </div>
        ) : (
<SyncedTable
            T={T}
            cols={typeFilter === "C/F" ? cfCols : effectiveCols}
            tree={typeFilter === "C/F" ? cfTree : tree}
            pivot={typeFilter === "C/F" ? cfPivot : undefined}
treeLiteral={activeMapping?.treeLiteral ?? null}
            highlightedIds={activeMapping?.highlightedIds ?? null}
            dimIdx={dimIdx}
            journalDimIdx={journalDimIdx}
            cptyDimIdx={cptyDimIdx}
            cmpDimIdx={cmpDimIdx}
            body1Style={body1Style}
            body2Style={body2Style}
            header2Style={header2Style}
            header3Style={header3Style}
            underscore1Style={underscore1Style}
            underscore2Style={underscore2Style}
            filterStyle={filterStyle}
            colors={colors}
            expandedSet={expandedSet}
            expandedColsMap={expandedColsMap}
            toggleCol={toggleCol}
            toggleExpand={toggleExpand}
            pivot={typeFilter === "C/F" ? cfPivot : pivot}
            journalPivot={journalPivot}
            accountMap={accountMap}
            companies={companies}
            groupStructure={groupStructure}
            hasData={hasData}
            collapseAll={collapseAll}
            expandAll={expandAll}
            setDrilldown={setDrilldown}
            getReportingCurrency={getReportingCurrency}
            breakers={mappingDerived?.breakers ?? (Object.keys(pgcSections).length > 0 ? pgcSections : breakers)}
            compareMode={compareMode}
            onToggleCompare={() => {
              if (!compareMode) {
                setCmpYear(year); setCmpMonth(month);
                setCmpSource(source); setCmpStructure(structure);
              }
              setCompareMode(c => !c);
            }}
cmpPivot={typeFilter === "C/F" ? cmpCfPivot : cmpPivot}
            counterpartyPivot={counterpartyPivot}
            cmpLoading={cmpLoading}
            cmpYear={cmpYear} setCmpYear={setCmpYear}
            cmpMonth={cmpMonth} setCmpMonth={setCmpMonth}
            cmpSource={cmpSource} setCmpSource={setCmpSource}
            cmpStructure={cmpStructure} setCmpStructure={setCmpStructure}
            yearOpts={yearOpts}
            monthOpts={monthOpts}
            sourceOpts={sourceOpts}
structureOpts={structureOpts}
perspectiveMode={perspectiveMode}
            perspectiveParent={perspective}
            reorderCols={reorderCols}
onShowJournals={journalData.length > 0 ? () => setShowJournals(true) : null}
            journalCount={journalData.length}
          />
        )}
      </div>
      )}
    </div>
  );
}