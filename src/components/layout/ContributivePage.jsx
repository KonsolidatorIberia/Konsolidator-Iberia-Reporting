/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTypo, useSettings } from "./SettingsContext";
import {
  ChevronDown, ChevronRight, Loader2, Maximize2, Minimize2,
  X, RefreshCw, Filter, TrendingUp, TrendingDown, BookOpen, GitMerge,
} from "lucide-react";

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
];

/* ─── Formatting ──────────────────────────────────────────────────────────── */

function parseAmt(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  if (s === "" || s === "—" || s === "-") return 0;
  const hasEuropean = /\d\.\d{3},\d/.test(s) || (/,/.test(s) && /\./.test(s) && s.indexOf(".") < s.indexOf(","));
  if (hasEuropean) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (/,/.test(s) && /\./.test(s) && s.indexOf(",") < s.indexOf(".")) return parseFloat(s.replace(/,/g, "")) || 0;
  if (/,/.test(s) && !/\./.test(s)) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

function fmtAmt(n) {
  if (n == null || n === 0) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (isNaN(num) || num === 0) return "—";
  return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n == null || !isFinite(n)) return "—";
  const num = Number(n);
  if (isNaN(num) || num === 0) return "—";
  return `${num >= 0 ? "" : ""}${num.toFixed(1)}%`;
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
  tree, pivot, cols, cmpPivot,
  companies = [], groupStructure = [],
  compareMode = false,
  month, year, source, structure,
  cmpMonth, cmpYear, cmpSource, cmpStructure,
  perspectiveMode = false, perspectiveParent = "",
}) {
  async function doGenerate(ExcelJS) {
    const NAVY    = "FF1A2F8A";
    const NAVY_DK = "FF0F1F5E";
    const LIGHT   = "FFEEF1FB";
    const STRIPE  = "FFF8F9FF";
    const WHITE   = "FFFFFFFF";
    const GRAY    = "FF6B7280";
    const BORDER  = "FFE5E7EB";
    const NUM_FMT = '#,##0.00;[RED]-#,##0.00;"-"';
    const PCT_FMT = '0.0"%";[RED]-0.0"%";"-"';

    const mkFill   = a => ({ type: "pattern", pattern: "solid", fgColor: { argb: a } });
    const mkFont   = (bold, argb, sz = 9) => ({ bold, color: { argb }, name: "Calibri", size: sz });
    const mkBorder = () => ({
      bottom: { style: "thin", color: { argb: BORDER } },
      right:  { style: "thin", color: { argb: BORDER } },
    });

    const getRepCcy = (co) => {
      const node = groupStructure.find(g => (g.CompanyShortName ?? g.companyShortName) === co);
      const parentName = node?.ParentShortName ?? node?.parentShortName;
      if (!node || !parentName) {
        const own = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co);
        return own?.CurrencyCode ?? own?.currencyCode ?? "EUR";
      }
      const parent = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === parentName);
      return parent?.CurrencyCode ?? parent?.currencyCode ?? "EUR";
    };

    const getLegalName = co =>
      companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName ?? co;

    const getVal    = (code, co) => pivot.get(code)?.[co]?.total ?? 0;
    const getCmpVal = (code, co) => compareMode ? (cmpPivot?.get(code)?.[co] ?? 0) : 0;
    const rowTotal  = (code)    => cols.reduce((s, co) => s + getVal(code, co), 0);

    const monthLabel = MONTHS_LABEL[Number(month)] ?? String(month);
    const cmpMoLabel = MONTHS_LABEL[Number(cmpMonth)] ?? String(cmpMonth);

    const TYPE_GROUPS = [
      { types: ["P/L", "DIS"], sheet: "P&L"      },
      { types: ["B/S"],        sheet: "B-S"       },
      { types: ["C/F", "CFS"], sheet: "Cash Flow" },
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = "Konsolidator";
    wb.created = new Date();

    for (const group of TYPE_GROUPS) {
      const groupRoots = tree.filter(n => group.types.includes(n.AccountType ?? n.accountType ?? ""));
      if (!groupRoots.length) continue;

      const ws = wb.addWorksheet(group.sheet);
      ws.properties.outlineLevelRow = 0;
      ws.properties.outlineLevelCol = 0;

      const COL_ACCOUNT = 1;
      let ci = 2;
      // Add parent total column when in perspective mode
      let COL_PARENT = null;
      if (perspectiveMode) {
        COL_PARENT = ci++;
      }
      const companyColMap = {};
      for (const co of cols) {
        companyColMap[co] = { actual: ci++ };
        if (perspectiveMode) companyColMap[co].pct = ci++;
        if (compareMode) { companyColMap[co].cmp = ci++; companyColMap[co].delta = ci++; }
      }
      const COL_TOTAL = ci;
      const totalCols = ci;

      ws.views = [{ state: "frozen", ySplit: compareMode ? 4 : 3, showOutlineSymbols: true }];
      ws.getColumn(COL_ACCOUNT).width = 48;

      if (COL_PARENT) ws.getColumn(COL_PARENT).width = 22;

      for (const co of cols) {
        const cm = companyColMap[co];
        ws.getColumn(cm.actual).width = 18;
        if (cm.pct) ws.getColumn(cm.pct).width = 10;
        if (compareMode) {
          ws.getColumn(cm.cmp).width         = 18;
          ws.getColumn(cm.delta).width        = 14;
          ws.getColumn(cm.cmp).outlineLevel   = 1;
          ws.getColumn(cm.delta).outlineLevel = 1;
        }
      }
      ws.getColumn(COL_TOTAL).width = 20;

      // Title row
      ws.addRow([]);
      const rTitle = ws.lastRow;
      rTitle.height = 30;
      for (let c = 1; c <= totalCols; c++) rTitle.getCell(c).fill = mkFill(NAVY);
      const tc = rTitle.getCell(1);
      const perspLabel = perspectiveMode ? `  ·  Perspective: ${getLegalName(perspectiveParent)}` : "";
      tc.value = `${group.sheet}  ·  ${monthLabel} ${year}  ·  ${source}  ·  ${structure}${perspLabel}`;
      tc.font  = mkFont(true, WHITE, 13);
      tc.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.mergeCells(rTitle.number, 1, rTitle.number, totalCols);

      // Compare label row
      if (compareMode) {
        ws.addRow([]);
        const rCmp = ws.lastRow;
        rCmp.height = 16;
        for (let c = 1; c <= totalCols; c++) rCmp.getCell(c).fill = mkFill(NAVY_DK);
        const cc = rCmp.getCell(1);
        cc.value = `vs.  ${cmpMoLabel} ${cmpYear}  ·  ${cmpSource}  ·  ${cmpStructure}`;
        cc.font  = mkFont(false, "FFFCD34D", 9);
        cc.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
        ws.mergeCells(rCmp.number, 1, rCmp.number, totalCols);
      }

      // Company header row
      ws.addRow([]);
      const rCoHead = ws.lastRow;
      rCoHead.height = 22;
      rCoHead.getCell(COL_ACCOUNT).fill = mkFill(NAVY);

      if (COL_PARENT) {
        const ph = rCoHead.getCell(COL_PARENT);
        ph.value     = `${getLegalName(perspectiveParent)}  ·  CONSOLIDATED`;
        ph.font      = mkFont(true, WHITE, 9);
        ph.fill      = mkFill(NAVY_DK);
        ph.alignment = { horizontal: "center", vertical: "middle" };
      }

      for (const co of cols) {
        const cm  = companyColMap[co];
        const ccy = getRepCcy(co);
        const hc  = rCoHead.getCell(cm.actual);
        hc.value     = `${getLegalName(co)}  ·  ${co}  ·  ${ccy}`;
        hc.font      = mkFont(true, WHITE, 9);
        hc.fill      = mkFill(NAVY);
        hc.alignment = { horizontal: "center", vertical: "middle" };
        hc.border    = { left: { style: "medium", color: { argb: "FF3B5BDB" } } };
        const lastCol = cm.delta ?? cm.cmp ?? cm.pct ?? cm.actual;
        if (lastCol !== cm.actual) ws.mergeCells(rCoHead.number, cm.actual, rCoHead.number, lastCol);
      }
      const thc = rCoHead.getCell(COL_TOTAL);
      thc.value     = "TOTAL";
      thc.font      = mkFont(true, WHITE, 9);
      thc.fill      = mkFill(NAVY_DK);
      thc.alignment = { horizontal: "right", vertical: "middle" };

      // Sub-header row
      ws.addRow([]);
      const rSub = ws.lastRow;
      rSub.height = 18;
      const ahc = rSub.getCell(COL_ACCOUNT);
      ahc.value     = "ACCOUNT";
      ahc.font      = mkFont(true, WHITE, 8);
      ahc.fill      = mkFill(NAVY);
      ahc.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ahc.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };

      if (COL_PARENT) {
        const psc = rSub.getCell(COL_PARENT);
        psc.value     = "Sum of children";
        psc.font      = mkFont(true, WHITE, 8);
        psc.fill      = mkFill(NAVY_DK);
        psc.alignment = { horizontal: "right", vertical: "middle" };
        psc.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };
      }

      for (const co of cols) {
        const cm = companyColMap[co];
        const pc = rSub.getCell(cm.actual);
        pc.value     = `${monthLabel} ${year}`;
        pc.font      = mkFont(true, WHITE, 8);
        pc.fill      = mkFill(NAVY);
        pc.alignment = { horizontal: "right", vertical: "middle" };
        pc.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };

        if (cm.pct) {
          const pctH = rSub.getCell(cm.pct);
          pctH.value     = "% of parent";
          pctH.font      = mkFont(true, "FFA5B4FC", 8);
          pctH.fill      = mkFill(NAVY);
          pctH.alignment = { horizontal: "right", vertical: "middle" };
          pctH.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };
        }

        if (compareMode) {
          const cc2 = rSub.getCell(cm.cmp);
          cc2.value     = `${cmpMoLabel} ${cmpYear}`;
          cc2.font      = mkFont(true, "FFFCD34D", 8);
          cc2.fill      = mkFill(NAVY_DK);
          cc2.alignment = { horizontal: "right", vertical: "middle" };
          cc2.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };
          const dc = rSub.getCell(cm.delta);
          dc.value     = "Δ";
          dc.font      = mkFont(true, "FFFCD34D", 8);
          dc.fill      = mkFill(NAVY_DK);
          dc.alignment = { horizontal: "right", vertical: "middle" };
          dc.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };
        }
      }
      const tsc = rSub.getCell(COL_TOTAL);
      tsc.value     = "Row Total";
      tsc.font      = mkFont(true, WHITE, 8);
      tsc.fill      = mkFill(NAVY_DK);
      tsc.alignment = { horizontal: "right", vertical: "middle" };
      tsc.border    = { bottom: { style: "medium", color: { argb: NAVY_DK } } };

      // Data rows
      let zebraIdx = 0;
      for (const { node, depth } of _flattenTree(groupRoots)) {
        const code      = node.AccountCode;
        const hasKids   = node.children?.length > 0;
        const isSummary = /\.S$/i.test(code) || hasKids;
        const bg        = isSummary ? LIGHT : (zebraIdx % 2 === 0 ? WHITE : STRIPE);
        zebraIdx++;

        ws.addRow([]);
        const dr = ws.lastRow;
        dr.height = isSummary ? 18 : 15;
        if (!isSummary && depth > 0) dr.outlineLevel = Math.min(depth, 7);

        const ac = dr.getCell(COL_ACCOUNT);
        ac.value     = isSummary
          ? (node.AccountName ?? node.accountName ?? "").toUpperCase()
          : node.AccountName ?? node.accountName ?? "";
        ac.font      = mkFont(isSummary, isSummary ? NAVY : "FF1F2937", isSummary ? 9 : 8);
        ac.fill      = mkFill(bg);
        ac.alignment = { horizontal: "left", vertical: "middle", indent: Math.max(1, depth + 1) };
        ac.border    = mkBorder();

        // Parent consolidated total in perspective mode = sum of children
        const parentTotal = perspectiveMode ? cols.reduce((s, co) => s + getVal(code, co), 0) : 0;

        if (COL_PARENT) {
          const pc = dr.getCell(COL_PARENT);
          pc.value     = parentTotal === 0 ? null : parentTotal;
          pc.numFmt    = NUM_FMT;
          pc.font      = mkFont(true, parentTotal > 0 ? NAVY : parentTotal < 0 ? "FFEF4444" : GRAY, isSummary ? 9 : 8);
          pc.fill      = mkFill(isSummary ? LIGHT : "FFEEF1FB");
          pc.alignment = { horizontal: "right", vertical: "middle" };
          pc.border    = mkBorder();
        }

        for (const co of cols) {
          const cm    = companyColMap[co];
          const val   = getVal(code, co);
          const cmpV  = getCmpVal(code, co);
          const delta = compareMode ? val - cmpV : 0;

          const vc = dr.getCell(cm.actual);
          vc.value     = val === 0 ? null : val;
          vc.numFmt    = NUM_FMT;
          vc.font      = mkFont(isSummary, val > 0 ? NAVY : val < 0 ? "FFEF4444" : GRAY, isSummary ? 9 : 8);
          vc.fill      = mkFill(bg);
          vc.alignment = { horizontal: "right", vertical: "middle" };
          vc.border    = mkBorder();

          // Percentage of parent
          if (cm.pct) {
            const pct = parentTotal !== 0 ? (val / parentTotal) * 100 : 0;
            const pctC = dr.getCell(cm.pct);
            pctC.value     = pct === 0 ? null : pct;
            pctC.numFmt    = PCT_FMT;
            pctC.font      = mkFont(false, "FF6366F1", isSummary ? 8 : 7);
            pctC.fill      = mkFill(bg);
            pctC.alignment = { horizontal: "right", vertical: "middle" };
            pctC.border    = mkBorder();
          }

          if (compareMode) {
            const cc3 = dr.getCell(cm.cmp);
            cc3.value     = cmpV === 0 ? null : cmpV;
            cc3.numFmt    = NUM_FMT;
            cc3.font      = mkFont(isSummary, "FFCA8A04", isSummary ? 9 : 8);
            cc3.fill      = mkFill(isSummary ? "FFF9F5DC" : "FFFFF8E1");
            cc3.alignment = { horizontal: "right", vertical: "middle" };
            cc3.border    = mkBorder();

            const dcc = dr.getCell(cm.delta);
            dcc.value     = delta === 0 ? null : delta;
            dcc.numFmt    = NUM_FMT;
            dcc.font      = mkFont(isSummary, delta > 0 ? "FF059669" : delta < 0 ? "FFDC2626" : GRAY, 8);
            dcc.fill      = mkFill(isSummary ? "FFF9F5DC" : "FFFFF8E1");
            dcc.alignment = { horizontal: "right", vertical: "middle" };
            dcc.border    = mkBorder();
          }
        }

        const rt  = rowTotal(code);
        const toc = dr.getCell(COL_TOTAL);
        toc.value     = rt === 0 ? null : rt;
        toc.numFmt    = NUM_FMT;
        toc.font      = mkFont(isSummary, rt > 0 ? NAVY : rt < 0 ? "FFEF4444" : GRAY, isSummary ? 9 : 8);
        toc.fill      = mkFill(isSummary ? LIGHT : bg);
        toc.alignment = { horizontal: "right", vertical: "middle" };
        toc.border    = mkBorder();
      }
    }

    // Fix outline direction
    const fixXlsx = async (buf) => {
      const JSZip = window.JSZip;
      if (!JSZip) return buf;
      const zip = await JSZip.loadAsync(buf);
      const sheets = Object.keys(zip.files).filter(f => f.match(/xl\/worksheets\/sheet\d+\.xml/));
      for (const fname of sheets) {
        let c = await zip.file(fname).async("string");
        c = c.replace(/ collapsed="1"/g, "");
        if (!c.includes("<outlinePr")) {
          const tag = '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>';
          if      (c.includes("<sheetPr/>")) c = c.replace(/<sheetPr\/>/g, tag);
          else if (c.includes("<sheetPr>"))  c = c.replace(/<sheetPr>/g, '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/>');
          else                               c = c.replace(/(<worksheet[^>]*>)/, `$1${tag}`);
        }
        zip.file(fname, c);
      }
      return zip.generateAsync({ type: "arraybuffer" });
    };

    const buf      = await wb.xlsx.writeBuffer();
    const finalBuf = await fixXlsx(buf);
    const blob     = new Blob([finalBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href = url;
    a.download = `Contributive_${year}_${String(month).padStart(2, "0")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const load = src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  Promise.all([
    load("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js"),
    load("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"),
  ]).then(() => doGenerate(window.ExcelJS))
    .catch(e => alert("Could not load ExcelJS: " + e.message));
}

function generateContributivePdf({
  tree, pivot, cols, cmpPivot,
  companies = [], groupStructure = [],
  compareMode = false,
  month, year, source, structure,
  cmpMonth, cmpYear, cmpSource, cmpStructure,
  perspectiveMode = false, perspectiveParent = "",
}) {
  function doGenerate(jsPDF, autoTable) {
    const NAVY    = [26, 47, 138];
    const NAVY_DK = [10, 20, 80];
    const AMBER   = [251, 191, 36];
    const RED     = [239, 68, 68];
    const GREEN   = [16, 185, 129];
    const LIGHT   = [238, 241, 251];
    const STRIPE  = [248, 249, 255];
    const WHITE   = [255, 255, 255];
    const GRAY    = [107, 114, 128];
    const GRAY_LT = [220, 225, 240];
    const INDIGO  = [99, 102, 241];

    const fmtN = n => {
      if (n == null || n === 0) return "—";
      const v = typeof n === "number" ? n : Number(n);
      if (isNaN(v) || v === 0) return "—";
      return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const fmtP = n => {
      if (n == null || !isFinite(n) || n === 0) return "—";
      return `${n.toFixed(1)}%`;
    };

    const getRepCcy = (co) => {
      const node = groupStructure.find(g => (g.CompanyShortName ?? g.companyShortName) === co);
      const parentName = node?.ParentShortName ?? node?.parentShortName;
      if (!node || !parentName) {
        const own = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co);
        return own?.CurrencyCode ?? own?.currencyCode ?? "EUR";
      }
      const parent = companies.find(c => (c.CompanyShortName ?? c.companyShortName) === parentName);
      return parent?.CurrencyCode ?? parent?.currencyCode ?? "EUR";
    };

    const getLegalName = co =>
      companies.find(c => (c.CompanyShortName ?? c.companyShortName) === co)?.CompanyLegalName ?? co;

    const getVal    = (code, co) => pivot.get(code)?.[co]?.total ?? 0;
    const getCmpVal = (code, co) => compareMode ? (cmpPivot?.get(code)?.[co] ?? 0) : 0;
    const rowTotal  = (code)    => cols.reduce((s, co) => s + getVal(code, co), 0);

    const monthLabel = MONTHS_LABEL[Number(month)]   ?? String(month);
    const cmpMoLabel = MONTHS_LABEL[Number(cmpMonth)] ?? String(cmpMonth);

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W   = doc.internal.pageSize.getWidth();
    const H   = doc.internal.pageSize.getHeight();
    let pageNum = 0;
    let currentTitle = "";

    const drawHeader = (title, isFirst) => {
      if (!isFirst) doc.addPage();
      pageNum++;
      currentTitle = title;
      const bandH = compareMode ? 36 : 28;
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, bandH, "F");
      doc.setFillColor(207, 48, 93);
      doc.rect(0, 0, 3, bandH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...WHITE);
      doc.text(title, 8, 11);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(180, 200, 255);
      const perspLabel = perspectiveMode ? `  ·  Perspective: ${getLegalName(perspectiveParent)}` : "";
      doc.text(`${monthLabel} ${year}  ·  ${source}  ·  ${structure}${perspLabel}`, 8, 18);
      if (compareMode) {
        doc.setFillColor(...NAVY_DK);
        doc.roundedRect(8, 21, W - 16, 5, 1, 1, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6);
        doc.setTextColor(...AMBER);
        doc.text("vs.", 10, 24.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...WHITE);
        doc.text(`${cmpMoLabel} ${cmpYear}  ·  ${cmpSource}  ·  ${cmpStructure}`, 18, 24.5);
      }
      doc.setFillColor(...NAVY_DK);
      doc.roundedRect(W - 20, 4, 16, 7, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(160, 185, 255);
      doc.text(`p. ${pageNum}`, W - 12, 8.2, { align: "center" });
      doc.setDrawColor(59, 91, 219);
      doc.setLineWidth(0.3);
      doc.line(0, bandH, W, bandH);
      return bandH + 3;
    };

    const drawFooter = () => {
      doc.setFillColor(...LIGHT);
      doc.rect(0, H - 7, W, 7, "F");
      doc.setDrawColor(...GRAY_LT);
      doc.setLineWidth(0.2);
      doc.line(0, H - 7, W, H - 7);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(...NAVY);
      doc.text("KONSOLIDATOR", 8, H - 2.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text(`${currentTitle}  ·  ${monthLabel} ${year}  ·  ${source}`, 35, H - 2.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY);
      doc.text(String(pageNum), W - 8, H - 2.5, { align: "right" });
    };

    const buildColumns = () => {
      const colDefs   = [{ header: "Account", dataKey: "account" }];
      const accW = compareMode ? 48 : (perspectiveMode ? 48 : 55);
      const colStyles = { account: { cellWidth: accW } };

      if (perspectiveMode) {
        colDefs.push({ header: `${perspectiveParent}\nCONSOLIDATED`, dataKey: "parent_total" });
      }

      const usableW   = W - 16;
      let used = accW;
      if (perspectiveMode) used += 28;
      const remaining = usableW - used;
      const perCoUnits = compareMode ? 2.8 : (perspectiveMode ? 1.4 : 1);
      const divisor   = cols.length * perCoUnits + 1;
      const perCoW    = remaining / divisor;

      if (perspectiveMode) {
        colStyles.parent_total = { cellWidth: 28, halign: "right" };
      }

      for (const co of cols) {
        const ccy = getRepCcy(co);
        colDefs.push({ header: `${co}\n${ccy}`, dataKey: `act_${co}` });
        colStyles[`act_${co}`] = { cellWidth: perCoW, halign: "right" };
        if (perspectiveMode) {
          colDefs.push({ header: `${co}\n%`, dataKey: `pct_${co}` });
          colStyles[`pct_${co}`] = { cellWidth: perCoW * 0.55, halign: "right" };
        }
        if (compareMode) {
          colDefs.push({ header: `${co}\nvs.`, dataKey: `cmp_${co}` });
          colStyles[`cmp_${co}`] = { cellWidth: perCoW, halign: "right" };
          colDefs.push({ header: "Δ", dataKey: `del_${co}` });
          colStyles[`del_${co}`] = { cellWidth: perCoW * 0.8, halign: "right" };
        }
      }
      colDefs.push({ header: "TOTAL", dataKey: "total" });
      colStyles.total = { cellWidth: perCoW * 1.1, halign: "right" };
      return { colDefs, colStyles };
    };

    const buildBody = (roots) =>
      _flattenTree(roots).map(({ node, depth }) => {
        const code      = node.AccountCode;
        const hasKids   = node.children?.length > 0;
        const isSummary = /\.S$/i.test(code) || hasKids;
        const name      = isSummary
          ? (node.AccountName ?? node.accountName ?? "").toUpperCase()
          : node.AccountName ?? node.accountName ?? "";
        const rt  = rowTotal(code);
        const parentTotal = perspectiveMode ? rt : 0;
        const row = {
          account: "  ".repeat(depth) + name,
          total:   fmtN(rt),
          _isSummary: isSummary,
          _depth:     depth,
        };
        if (perspectiveMode) row.parent_total = fmtN(parentTotal);
        for (const co of cols) {
          const val  = getVal(code, co);
          const cmpV = getCmpVal(code, co);
          const dv   = compareMode ? val - cmpV : 0;
          row[`act_${co}`] = fmtN(val);
          if (perspectiveMode) {
            const pct = parentTotal !== 0 ? (val / parentTotal) * 100 : 0;
            row[`pct_${co}`] = fmtP(pct);
          }
          if (compareMode) {
            row[`cmp_${co}`] = fmtN(cmpV);
            row[`del_${co}`] = dv === 0 ? "—" : (dv > 0 ? "+" : "") + fmtN(dv);
          }
        }
        return row;
      });

    const didParse = (data) => {
      const { section, row, column, cell } = data;
      if (section === "head") {
        if (perspectiveMode && column.dataKey === "parent_total") { cell.styles.fillColor = NAVY_DK; cell.styles.textColor = WHITE; }
        if (perspectiveMode && column.dataKey.startsWith("pct_")) { cell.styles.fillColor = [70, 90, 180]; cell.styles.textColor = [200, 210, 255]; }
        if (compareMode && column.dataKey.startsWith("cmp_")) { cell.styles.fillColor = [130, 100, 10]; cell.styles.textColor = AMBER; }
        if (compareMode && column.dataKey.startsWith("del_")) { cell.styles.fillColor = NAVY_DK; cell.styles.textColor = AMBER; }
        if (column.dataKey === "total") cell.styles.fillColor = NAVY_DK;
        cell.styles.halign = column.dataKey === "account" ? "left" : "right";
        return;
      }
      const r = row.raw;
      if (!r) return;
      if (r._isSummary) { cell.styles.fillColor = LIGHT; cell.styles.fontStyle = "bold"; cell.styles.textColor = NAVY; cell.styles.fontSize = 7; }
      else { cell.styles.fontSize = 6; cell.styles.textColor = [31, 41, 55]; }
      if (column.dataKey !== "account") cell.styles.halign = "right";
      const val    = cell.text[0];
      const isNeg  = v => typeof v === "string" && (v.startsWith("-") || v.startsWith("("));
      const isZero = v => v === "—" || v === "";
      if (column.dataKey === "parent_total") {
        cell.styles.fillColor = r._isSummary ? LIGHT : [240, 244, 255];
        cell.styles.fontStyle = "bold";
        cell.styles.textColor = isZero(val) ? GRAY : isNeg(val) ? RED : NAVY;
      } else if (column.dataKey.startsWith("pct_")) {
        cell.styles.textColor = isZero(val) ? GRAY : INDIGO;
      } else if (column.dataKey.startsWith("del_")) {
        cell.styles.textColor = isZero(val) ? GRAY : val.startsWith("+") ? GREEN : RED;
      } else if (column.dataKey.startsWith("cmp_")) {
        cell.styles.textColor  = r._isSummary ? [130, 100, 10] : [161, 130, 40];
        cell.styles.fillColor  = r._isSummary ? [253, 246, 200] : [255, 251, 235];
      } else if (column.dataKey.startsWith("act_") || column.dataKey === "total") {
        if      (isZero(val)) cell.styles.textColor = [200, 200, 200];
        else if (isNeg(val))  cell.styles.textColor = RED;
      }
    };

    const TYPE_GROUPS = [
      { types: ["P/L", "DIS"], label: "Profit & Loss"  },
      { types: ["B/S"],        label: "Balance Sheet"  },
      { types: ["C/F", "CFS"], label: "Cash Flow"      },
    ];

    const { colDefs, colStyles } = buildColumns();
    let isFirst = true;

    for (const group of TYPE_GROUPS) {
      const groupRoots = tree.filter(n => group.types.includes(n.AccountType ?? n.accountType ?? ""));
      if (!groupRoots.length) continue;
      const startY  = drawHeader(group.label, isFirst);
      isFirst       = false;
      const compact = compareMode || cols.length > 3 || perspectiveMode;
      autoTable(doc, {
        startY,
        columns:  colDefs,
        body:     buildBody(groupRoots),
        margin:   { left: 8, right: 8, bottom: 10 },
        tableWidth: "auto",
        styles: {
          fontSize:    compact ? 5.5 : 7,
          cellPadding: { top: compact ? 1.5 : 2.5, bottom: compact ? 1.5 : 2.5, left: 2, right: 2 },
          overflow:    "ellipsize",
          lineColor:   GRAY_LT,
          lineWidth:   0.1,
          font:        "helvetica",
          textColor:   [31, 41, 55],
        },
        headStyles: {
          fillColor:   NAVY,
          textColor:   WHITE,
          fontStyle:   "bold",
          fontSize:    compact ? 5 : 6.5,
          cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
          lineWidth:   0,
          valign:      "middle",
        },
        columnStyles:       colStyles,
        alternateRowStyles: { fillColor: STRIPE },
        didParseCell:       didParse,
        didDrawPage:        () => drawFooter(),
      });
    }

    doc.save(`Contributive_${year}_${String(month).padStart(2, "0")}.pdf`);
  }

  const load = src => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
    .then(() => load("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"))
    .then(() => {
      const { jsPDF } = window.jspdf;
      doGenerate(jsPDF, window.jspdf.jsPDF.autoTable ?? ((d, o) => d.autoTable(o)));
    })
    .catch(e => alert("Could not load PDF library: " + e.message));
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
      {tabs.map((t, i) => (
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
function DrilldownModal({ accountCode, accountName, company, rows, currency, onClose }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
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
              <p className="text-white/40 text-[9px] uppercase tracking-widest">Amount YTD</p>
              <p className={`text-lg font-black ${total >= 0 ? "text-white" : "text-red-300"}`}>{fmtAmt(total)}</p>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
              <X size={13} className="text-white/70" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Local Account Breakdown</p>
          {byLocal.size === 0 ? (
            <p className="text-xs text-gray-400">No detail available.</p>
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

/* ─── Pivot Row ───────────────────────────────────────────────────────────── */
const INDENT = 14;

function PivotRow({
  node, depth, expandedSet, onToggle, cols, pivot, onCellClick,
  expandedColsMap, journalPivot, compareMode, cmpPivot,
  body1Style, body2Style,
  perspectiveMode, parentTotalForRow,
}) {
  const code        = node.AccountCode;
  const hasChildren = node.children?.length > 0;
  const isExpanded  = expandedSet.has(code);
  const isSummary   = /\.S$/i.test(code) || hasChildren;
  const rowStyle    = depth === 0 ? body1Style : body2Style;

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
        ${isSummary ? "bg-[#ffffff] border-[#1a2f8a]/5" : "bg-white border-gray-200 hover:bg-[#f8f9ff]"}`}>

        {/* Account — sticky left */}
        <td className={`py-2.5 sticky left-0 z-10 border-r border-gray-100
          ${isSummary ? "bg-[#ffffff]" : "bg-white group-hover:bg-[#f8f9ff]"}`}
          style={{ paddingLeft: `${16 + depth * INDENT}px`, minWidth: 280 }}>
          <div className={`flex items-center ${hasChildren ? "cursor-pointer" : ""}`}
            onClick={() => hasChildren && onToggle(code)}>
            {hasChildren
              ? <span className="flex-shrink-0 mr-2" style={{ color: rowStyle?.color }}>
                  {isExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
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
            <td key={co}
              className={`px-4 py-2.5 text-center whitespace-nowrap transition-colors
                ${val !== 0 && rows.length > 0 ? "cursor-pointer hover:bg-[#eef1fb]" : ""}`}
              style={{ minWidth: 130, ...cellStyle(saldo) }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}
            >
              {saldo === 0 ? <span className="text-gray-200">—</span> : (
                <span className="flex items-center justify-center gap-1">
                  {!isSummary && (saldo > 0
                    ? <TrendingUp size={9} className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    : <TrendingDown size={9} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                  {fmtAmt(saldo)}
                </span>
              )}
            </td>
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
          const devPct = compareMode && cmpVal !== 0 ? ((dev / Math.abs(cmpVal)) * 100).toFixed(1) : null;
          const cmpTd = compareMode ? (
            <td key={`${co}-cmp`}
              className="px-4 py-2.5 text-center font-mono text-xs whitespace-nowrap"
              style={{ minWidth: 150, borderRight: "2px solid rgba(251,191,36,0.25)", backgroundColor: "white" }}>
              {cmpVal === 0 && dev === 0 ? (
                <span className="text-gray-600">—</span>
              ) : (
                <span className="flex flex-col items-center gap-0.5">
                  <span className={`${isSummary ? "font-bold" : ""} ${cmpVal === 0 ? "text-gray-500" : "text-black"}`}>
                    {cmpVal === 0 ? "—" : fmtAmt(cmpVal)}
                  </span>
                  {dev !== 0 && (
                    <span className={`text-11px] font-bold leading-none ${dev > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {dev > 0 ? "+" : ""}{fmtAmt(dev)}{devPct !== null ? ` (${devPct}%)` : ""}
                    </span>
                  )}
                </span>
              )}
            </td>
          ) : null;

          if (!isExpanded) return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : [])];

          const uploadedTd = (
            <td key={`${co}-uploaded`}
              className="px-3 py-2.5 text-center whitespace-nowrap bg-[#f8f9ff] border-l border-gray-100"
              style={{ minWidth: 110, ...cellStyle(val) }}
              onClick={() => val !== 0 && rows.length > 0 && onCellClick(node, co, rows)}>
              {val === 0 ? "—" : fmtAmt(val)}
            </td>
          );

          const subTds = SUB_COLS.map(sc => {
            const subVal = jp[sc.key] ?? 0;
            return (
              <td key={`${co}-${sc.key}`}
                className="px-3 py-2.5 text-center whitespace-nowrap bg-[#f8f9ff] border-l border-gray-100"
                style={{ minWidth: 100, ...cellStyle(subVal) }}>
                {subVal === 0 ? "—" : fmtAmt(subVal)}
              </td>
            );
          });

          return [mainTd, ...(pctTd ? [pctTd] : []), ...(cmpTd ? [cmpTd] : []), uploadedTd, ...subTds];
        })}

{!perspectiveMode && (
  <td className="px-4 py-2.5 text-center whitespace-nowrap sticky right-0 z-10 border-l border-gray-100"
    style={{ minWidth: 140, backgroundColor: "#fafafa", ...cellStyle(rowTotal) }}>
    {rowTotal === 0 ? "—" : fmtAmt(rowTotal)}
  </td>
)}
      </tr>

      {isExpanded && hasChildren && node.children.map(child => (
        <PivotRow key={child.AccountCode} node={child} depth={depth + 1}
          expandedSet={expandedSet} onToggle={onToggle}
          cols={cols} pivot={pivot} onCellClick={onCellClick}
          expandedColsMap={expandedColsMap} journalPivot={journalPivot}
          compareMode={compareMode} cmpPivot={cmpPivot}
          body1Style={body1Style} body2Style={body2Style}
          perspectiveMode={perspectiveMode}
        />
      ))}
    </>
  );
}

function SyncedTable({
  cols, tree, expandedSet, expandedColsMap, toggleCol, toggleExpand, pivot, journalPivot, accountMap, companies,
  groupStructure, hasData, collapseAll, expandAll, setDrilldown, getReportingCurrency, breakers = {},
  body1Style, body2Style, header2Style, header3Style, underscore1Style, underscore2Style, filterStyle, colors,
  compareMode, onToggleCompare, cmpPivot, cmpLoading,
  cmpYear, setCmpYear, cmpMonth, setCmpMonth, cmpSource, setCmpSource, cmpStructure, setCmpStructure,
  yearOpts = [], monthOpts = [], sourceOpts = [], structureOpts = [],
  perspectiveMode = false, perspectiveParent = "", reorderCols = () => {},
}) {
  const [dragCol, setDragCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const totalColSpan = useMemo(() => {
    let n = perspectiveMode ? 1 : 2;
    if (perspectiveMode) n += 1; // parent consolidated col
    cols.forEach(co => {
      n += 1;
      if (perspectiveMode) n += 1; // pct col
      if (compareMode) n += 1;
      if (expandedColsMap[co]) n += 1 + SUB_COLS.length;
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
      if (compareMode) widths.push(150);
      if (expandedColsMap[co]) {
        widths.push(140);
        SUB_COLS.forEach(() => widths.push(120));
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

  const cmpPeriodLabel = cmpYear && cmpMonth
    ? `${MONTHS.find(m => String(m.value) === String(cmpMonth))?.label ?? cmpMonth} ${cmpYear}`
    : "Compare";

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
        className="px-4 py-3 whitespace-nowrap cursor-move hover:bg-white/10 transition-colors select-none"
        style={{
          backgroundColor: colors.primary,
          opacity: isDragging ? 0.4 : 1,
          boxShadow: isDragOver ? "inset 4px 0 0 0 #fbbf24" : undefined,
        }}
        onClick={() => toggleCol(co)}>
       <div className="flex items-center justify-center">
          
          <div>
            <p className="leading-tight" style={underscore1Style}>{legalName}</p>
            <p className="leading-tight" style={underscore2Style}>{co} · {getReportingCurrency(co, groupStructure, companies)}</p>
          </div>
        </div>
      </th>
    );
    const pctTh = perspectiveMode ? (
      <th key={`${co}-pct`}
        className="px-2 py-3 whitespace-nowrap"
        style={{
          backgroundColor: colors.primary,
          boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.08)",
          borderRight: "1px dashed rgba(255,255,255,0.15)",
        }}>
        <div className="flex justify-center" style={underscore2Style}>%</div>
      </th>
    ) : null;
    const cmpTh = compareMode ? (
      <th key={`${co}-cmp`}
        className="text-right px-4 py-3 whitespace-nowrap text-xs"
        style={{ backgroundColor: "#0c1d55", borderRight: "2px solid rgba(251,191,36,0.35)" }}>
        <p className="font-black text-[11px] text-white leading-tight">{cmpPeriodLabel}</p>
        <p className="font-normal text-white text-[9px]">{co} · Δ</p>
      </th>
    ) : null;
    if (!isExp) return [main, ...(pctTh ? [pctTh] : []), ...(cmpTh ? [cmpTh] : [])];
    const subColsAll = [{ key: "uploaded", label: "UPLOADED" }, ...SUB_COLS];
    const subThs = subColsAll.map((sc, idx) => (
      <th key={`${co}-${sc.key}`}
        className="px-3 py-3 whitespace-nowrap border-l border-white/10"
        style={{
          backgroundColor: colors.primary,
          boxShadow: `inset 0 0 0 9999px rgba(0,0,0,${0.03 * (idx + 1)})`,
        }}>
        <div className="flex justify-center" style={underscore2Style}>{sc.label}</div>
      </th>
    ));
    return [main, ...(pctTh ? [pctTh] : []), ...(cmpTh ? [cmpTh] : []), ...subThs];
  });

  const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 1;

  return (
    <div ref={bodyRef} className="contributive-body"
      style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%", tableLayout: "auto", borderSpacing: 0 }}>
        {colgroup}
        <thead style={{ position: "sticky", top: 0, zIndex: 20 }}>
          <tr style={{ backgroundColor: colors.primary }}>
            <th className="sticky left-0 z-30 text-left px-5 py-3 border-r border-white/20"
              style={{ backgroundColor: colors.primary }}>
              <div className="flex items-center justify-between gap-3">
                <span style={header2Style}>ACCOUNTS</span>
                <div className="flex items-center gap-2">
                  {hasData && (
                    <>
                      <button onClick={() => expandedSet.size > 0 ? collapseAll() : expandAll()}
                        className="flex items-center gap-1 text-[12px] px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all font-bold normal-case tracking-normal"
                        style={{ color: colors.quaternary }}>
                        {expandedSet.size > 0 ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
                      </button>
                      <button onClick={onToggleCompare}
                        className={`flex items-center gap-1 text-[10px] px-3 py-1 rounded-lg transition-all font-bold normal-case tracking-normal ${compareMode ? "" : "bg-white/10 hover:bg-white/20"}`}
                        style={{
                          color: compareMode ? colors.primary : colors.quaternary,
                          backgroundColor: compareMode ? colors.quaternary : undefined,
                        }}>
                        <GitMerge size={12} /> Compare
                      </button>
                    </>
                  )}
                </div>
              </div>
            </th>

            {/* Parent consolidated column header */}
            {perspectiveMode && (
              <th className="px-4 py-3 whitespace-nowrap border-l border-white/30"
                style={{
                  backgroundColor: colors.primary,
                  boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.15)",
                }}>
                <div className="flex flex-col items-center gap-0.5">
                  <span style={underscore1Style}>{parentLegalName}</span>
                  <span style={underscore2Style}>CONSOLIDATED · {perspectiveParent}</span>
                </div>
              </th>
            )}

            {headerCols}
{!perspectiveMode && (
  <th className="sticky right-0 z-10 px-4 py-3 whitespace-nowrap border-l border-white/20"
    style={{ backgroundColor: colors.primary }}>
    <div className="flex justify-center" style={header2Style}>TOTAL</div>
  </th>
)}
          </tr>
          {compareMode && (
            <tr style={{ backgroundColor: "white", borderBottom: "1px solid rgba(251,191,36,0.2)" }}>
              <th className="px-5 py-2 sticky left-0 z-30" style={{ backgroundColor: "white" }}>
                <div className="flex items-center gap-2">
                  <FilterPill label="SRC"    value={cmpSource}    onChange={setCmpSource}    options={sourceOpts}    filterStyle={filterStyle} colors={colors} />
                  <FilterPill label="YR"      value={cmpYear}      onChange={setCmpYear}      options={yearOpts}      filterStyle={filterStyle} colors={colors} />
                  <FilterPill label="MNTH"     value={cmpMonth}     onChange={setCmpMonth}     options={monthOpts}     filterStyle={filterStyle} colors={colors} />
                  <FilterPill label="STRUCT" value={cmpStructure} onChange={setCmpStructure} options={structureOpts} filterStyle={filterStyle} colors={colors} />
                  {cmpLoading && <Loader2 size={11} className="animate-spin text-amber-400 flex-shrink-0" />}
                </div>
              </th>
              <th colSpan={totalColSpan - 1} style={{ backgroundColor: "white" }} />
            </tr>
          )}
        </thead>
        <tbody>
          {tree.map((node, i) => {
            const type = node.AccountType ?? node.accountType ?? "";
            const prevType = i > 0 ? (tree[i-1].AccountType ?? tree[i-1].accountType ?? "") : null;
            const showDivider = type !== prevType;
            const TYPE_LABELS = {
              "P/L": { label: "Profit & Loss",          color: colors.primary,   darken: true },
              "DIS": { label: "Distribution of Result", color: colors.primary,   },
              "B/S": { label: "Balance Sheet",          color: colors.secondary               },
              "C/F": { label: "Cash Flow",              color: colors.tertiary                },
              "CFS": { label: "Cash Flow",              color: colors.tertiary                },
            };
            const divider = showDivider ? (TYPE_LABELS[type] ?? { label: type, color: colors.quaternary }) : null;
            return (
              <>
                {divider && (
                  <tr key={`divider-${node.AccountCode}`}>
                    <td
                      style={{
                        backgroundColor: divider.color,
                        boxShadow: divider.darken ? "inset 0 0 0 9999px rgba(0,0,0,0.2)" : undefined,
                      }}
                      className="px-5 py-1.5 sticky left-0 z-10">
                      <span style={{ ...header3Style, textTransform: "uppercase", position: "relative" }}>
                        {divider.label}
                      </span>
                    </td>
                    <td colSpan={totalColSpan - 1}
                      style={{
                        backgroundColor: divider.color,
                        boxShadow: divider.darken ? "inset 0 0 0 9999px rgba(0,0,0,0.2)" : undefined,
                      }}
                      className="py-1.5">
                    </td>
                  </tr>
                )}
                <PivotRow key={node.AccountCode} node={node} depth={0}
                  expandedSet={expandedSet} onToggle={toggleExpand}
                  cols={cols} pivot={pivot}
                  onCellClick={(node, co, rows) => setDrilldown({ node, company: co, rows })}
                  expandedColsMap={expandedColsMap} journalPivot={journalPivot}
                  compareMode={compareMode} cmpPivot={cmpPivot}
                  body1Style={body1Style} body2Style={body2Style}
                  perspectiveMode={perspectiveMode}
                />
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────────────── */
export default function ContributivePage({ token }) {
  const header1Style = useTypo("header1");
  const header2Style = useTypo("header2");
  const header3Style = useTypo("header3");
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const filterStyle = useTypo("filter");
  const underscore1Style = useTypo("underscore1");
  const underscore2Style = useTypo("underscore2");
  const { colors } = useSettings();
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
  const [expandedSet,setExpandedSet]= useState(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const [cmpYear, setCmpYear] = useState("");
  const [cmpMonth, setCmpMonth] = useState("");
  const [cmpSource, setCmpSource] = useState("");
  const [cmpStructure, setCmpStructure] = useState("");
  const [cmpRawData, setCmpRawData] = useState([]);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [drilldown,       setDrilldown]       = useState(null);
  const [expandedColsMap, setExpandedColsMap] = useState({});
  const _expandedCols = new Set(Object.keys(expandedColsMap).filter(k => expandedColsMap[k]));
  const toggleCol = co => setExpandedColsMap(prev => ({ ...prev, [co]: !prev[co] }));

  const headers = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  }), [token]);

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

  /* ── Auto-find latest period with data ──────────────────── */
  useEffect(() => {
    if (!metaReady || !source || !structure) return;
    if (autoPeriodDone.current) return;
    autoPeriodDone.current = true;
    setProbingPeriod(true);

    (async () => {
      const now = new Date();
      let y = now.getFullYear();
      let m = now.getMonth() + 1;
      for (let i = 0; i < 24; i++) {
        try {
          const filter = `Year eq ${y} and Month eq ${m} and Source eq '${source}' and GroupStructure eq '${structure}'`;
          const res = await fetch(
            `${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}&$top=1`,
            { headers: headers() }
          );
          if (res.ok) {
            const json = await res.json();
            const rows = json.value ?? (Array.isArray(json) ? json : []);
            if (rows.length > 0) {
              setYear(String(y));
              setMonth(String(m));
              setProbingPeriod(false);
              return;
            }
          }
        } catch { /* keep probing */ }
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
      }
      setProbingPeriod(false);
    })();
  }, [metaReady, source, structure, headers]);

  /* ── Fetch breakers from Supabase ───────────────────────── */
  useEffect(() => {
    if (!rawData.length) return;
    if (breakersFetchedRef.current) return;

    const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
    const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";
    const sbHeaders = { apikey: SUPABASE_APIKEY, Authorization: `Bearer ${SUPABASE_APIKEY}` };

    const isPGC        = rawData.some(n => /[a-zA-Z]/.test(String(n.AccountCode ?? n.accountCode ?? "")) && String(n.AccountCode ?? n.accountCode ?? "").endsWith(".S"));
    const isSpanishIFRS = !isPGC && rawData.some(n => /^[A-Z]\.\d/.test(String(n.AccountCode ?? n.accountCode ?? "")));
    const isDanish     = !isPGC && !isSpanishIFRS && rawData.some(n => /^\d{6}$/.test(String(n.AccountCode ?? n.accountCode ?? "")));

    if (!isPGC && !isSpanishIFRS && !isDanish) return;
    breakersFetchedRef.current = true;

    const endpoint = isPGC
      ? `${SUPABASE_URL}/pgc_breakers?select=*`
      : isSpanishIFRS
        ? `${SUPABASE_URL}/spanish_ifrs_breakers?select=*`
        : `${SUPABASE_URL}/danish_breakers?select=*`;

    fetch(endpoint, { headers: sbHeaders })
      .then(r => r.json())
      .then(rows => {
        if (!Array.isArray(rows)) return;
        const grouped = {};
        rows.forEach(({ before_code, label, color }) => {
          grouped[before_code] = { label, color };
        });
        console.log("=== BREAKERS LOADED ===", Object.keys(grouped));
        setBreakers(grouped);
      })
      .catch(() => { breakersFetchedRef.current = false; });
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
      console.log("CONSOLIDATED COUNT:", consolidated.length);
      console.log("SAMPLE ROW:", JSON.stringify(consolidated[0], null, 2));
      console.log("ALL ROLES:", [...new Set(consolidated.map(r => r.CompanyRole ?? r.companyRole ?? ""))]);
      setRawData(consolidated);
      setJournalData(journals);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [year, month, source, structure, metaReady, headers]);

  /* ── Fetch compare data ─────────────────────────────────── */
  useEffect(() => {
    if (!compareMode || !cmpYear || !cmpMonth || !cmpSource || !cmpStructure || !metaReady) return;
    setCmpLoading(true);
    const h = headers();
    const filter = `Year eq ${cmpYear} and Month eq ${cmpMonth} and Source eq '${cmpSource}' and GroupStructure eq '${cmpStructure}'`;
    fetch(`${BASE_URL}/v2/reports/consolidated-accounts?$filter=${encodeURIComponent(filter)}`, { headers: h })
      .then(r => r.json())
      .then(d => { setCmpRawData(d.value ?? (Array.isArray(d) ? d : [])); setCmpLoading(false); })
      .catch(() => { setCmpRawData([]); setCmpLoading(false); });
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

    const opts = [{ value: "", label: "None (all companies)" }, ...parentList];

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
  }, [groupStructure, structure, companies, perspective]);

  const perspectiveMode = !!perspective;

  /* ── Derive pivot data ──────────────────────────────────── */
  const types = ["B/S", "P/L", "C/F"];

  const { accountMap, pivot, tree, cols, journalPivot, cmpPivot } = useMemo(() => {
    if (!rawData.length) return { accountMap: new Map(), pivot: new Map(), tree: [], cols: [], journalPivot: new Map(), cmpPivot: new Map() };

    const accountMap = new Map();

    const filtered = rawData.filter(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Contribution" && role !== "Contributive" && role !== "Subsidiary") return false;
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

    const pivot = new Map();
    filtered.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      if (!code || !co) return;
      if (!pivot.has(code)) pivot.set(code, {});
      const c = pivot.get(code);
      if (!c[co]) c[co] = { total: 0, rows: [] };
      c[co].total += -(Number(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD) || 0);
      c[co].rows.push(r);
    });

    const rawTree = buildTree([...accountMap.values()]);
    const TYPE_ORDER = { "P/L": 0, "DIS": 0, "B/S": 1, "C/F": 2, "CFS": 2 };

    const tree = [...rawTree].sort((a, b) => {
      const tA = TYPE_ORDER[a.AccountType ?? a.accountType ?? ""] ?? 99;
      const tB = TYPE_ORDER[b.AccountType ?? b.accountType ?? ""] ?? 99;
      if (tA !== tB) return tA - tB;
      return pgcSort(a, b);
    });
    const cols = [...new Set(filtered.map(r => r.CompanyShortName ?? r.companyShortName ?? "").filter(Boolean))].sort();

    const journalPivot = new Map();
    const add = (code, co, jt, amt) => {
      if (!code || !co) return;
      if (!journalPivot.has(code)) journalPivot.set(code, {});
      const c = journalPivot.get(code);
      if (!c[co]) c[co] = {};
      c[co][jt] = (c[co][jt] ?? 0) + amt;
    };
    journalData.forEach(r => {
      const code = r.AccountCode ?? r.accountCode ?? "";
      const co   = r.CompanyShortName ?? r.companyShortName ?? "";
      const cpty = r.CounterpartyShortName ?? r.counterpartyShortName ?? "";
      const jt   = String(r.JournalType ?? r.journalType ?? "").toUpperCase();
      const amt  = -parseAmt(r.AmountYTD ?? r.amountYTD);
      add(code, co, jt, amt);
      if (cpty && cpty !== co && cols.includes(cpty)) add(code, cpty, jt, -amt);
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

    const cmpPivot = new Map();
    cmpRawData.filter(r => {
      const role = r.CompanyRole ?? r.companyRole ?? "";
      if (role !== "Contribution" && role !== "Contributive" && role !== "Subsidiary") return false;
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
      c[co] += -(Number(r.ReportingAmountYTD ?? r.reportingAmountYTD ?? r.AmountYTD ?? r.amountYTD) || 0);
    });

    return { accountMap, pivot, tree, cols, journalPivot: rolled, cmpPivot };
  }, [rawData, journalData, typeFilter, cmpRawData, perspectiveMode, childrenOfPerspective]);


  const toggleExpand = useCallback(code => {
    setExpandedSet(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }, []);

  const expandAll   = useCallback(() => setExpandedSet(new Set([...accountMap.keys()])), [accountMap]);
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
    .map(m => ({ value: String(m), label: MONTHS.find(mo => mo.value === m)?.label ?? String(m) }));

  const sourceOpts = [...new Set(sources.map(s => {
    const v = typeof s === "object" ? (s.Source ?? s.source ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const structureOpts = [...new Set(structures.map(s => {
    const v = typeof s === "object" ? (s.GroupStructure ?? s.groupStructure ?? Object.values(s)[0] ?? "") : String(s);
    return String(v);
  }).filter(Boolean))].map(v => ({ value: v, label: v }));

  const hasData = rawData.length > 0 && tree.length > 0;

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
      `}</style>
      {showJournals && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowJournals(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: colors.primary }}>
              <div>
                <p style={header2Style}>Journal Entries</p>
                <p style={underscore2Style}>{journalData.length} entries · {year} · {MONTHS.find(m => m.value === Number(month))?.label} · {source}</p>
              </div>
              <button onClick={() => setShowJournals(false)} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <X size={13} className="text-white/70" />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {["Company","Account","Type","Journal #","Header","J.Type","Layer","Counterparty","Dimension","Amount YTD","CCY","Row Text","Posted","Sys Gen"].map(h => (
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
                  {journalData.map((r, i) => {
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
                        <td className="px-3 py-2 whitespace-nowrap text-right" style={{ color: amt === 0 ? "#D1D5DB" : amt < 0 ? "#EF4444" : "#000000" }}>{fmtAmt(amt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.CurrencyCode ?? r.currencyCode}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate">{r.RowText ?? r.rowText}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded ${(r.Posted ?? r.posted) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{(r.Posted ?? r.posted) ? "Yes" : "No"}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded ${(r.SystemGenerated ?? r.systemGenerated) ? "bg-gray-100 text-gray-500" : "bg-white text-gray-400"}`}>{(r.SystemGenerated ?? r.systemGenerated) ? "Yes" : "No"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Drilldown */}
      {drilldown && (
        <DrilldownModal
          accountCode={drilldown.node.AccountCode}
          accountName={drilldown.node.AccountName ?? drilldown.node.accountName ?? ""}
          company={drilldown.company}
          rows={drilldown.rows}
          currency={getReportingCurrency(drilldown.company, groupStructure, companies)}
          onClose={() => setDrilldown(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: colors.primary }} />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Accounts</p>
            <h1 className="leading-none" style={header1Style}>Contribution</h1>
          </div>
        </div>

        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

        {types.length > 0 && (() => {
          const tabs = [{ key: "", label: "All" }, ...types.map(t => ({ key: t, label: t }))];
          const activeIdx = Math.max(0, tabs.findIndex(t => t.key === typeFilter));
          return <TabSelector tabs={tabs} activeIdx={activeIdx} onSelect={setTypeFilter} filterStyle={filterStyle} />;
        })()}

        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

        <div className="flex items-center gap-2 flex-wrap">
          {sourceOpts.length > 0    && <FilterPill label="SRC"    value={source}    onChange={setSource}    options={sourceOpts}    filterStyle={filterStyle} colors={colors} />}
          {yearOpts.length > 0      && <FilterPill label="YR"      value={year}      onChange={setYear}      options={yearOpts}      filterStyle={filterStyle} colors={colors} />}
          {monthOpts.length > 0     && <FilterPill label="MNTH"     value={month}     onChange={setMonth}     options={monthOpts}     filterStyle={filterStyle} colors={colors} />}
          {structureOpts.length > 0 && <FilterPill label="STURCT" value={structure} onChange={setStructure} options={structureOpts} filterStyle={filterStyle} colors={colors} />}

          {/* NEW: Perspective pill — pick a parent to roll up its children */}
          {parentOptions.length > 1 && (
            <FilterPill
              label="PERSP"
              value={perspective}
              onChange={(v) => { setPerspective(v); setSelectedCompanies([]); }}
              options={parentOptions}
              filterStyle={filterStyle}
              colors={colors}
            />
          )}

          {cols.length > 0 && <CompanyFilterPill cols={cols} selected={selectedCompanies} onChange={setSelectedCompanies} filterStyle={filterStyle} colors={colors} />}
        </div>

        <div className="ml-auto flex items-center gap-3 flex-shrink-0 mr-6">
          {loading && <Loader2 size={13} className="animate-spin text-[#1a2f8a]" />}
          {journalData.length > 0 && (
            <button onClick={() => setShowJournals(true)}
              title={`Journal Entries (${journalData.length})`}
              className="relative flex items-center justify-center w-10 h-10 rounded-xl transition-all hover:scale-110 hover:shadow-md"
              style={{ backgroundColor: `${colors.primary}15` }}>
              <BookOpen size={18} style={{ color: colors.primary }} />
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                style={{ backgroundColor: colors.primary }}>
                {journalData.length}
              </span>
            </button>
          )}
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export Excel"
            onClick={() => generateContributiveXlsx({
              tree, pivot,
              cols: effectiveCols,
              cmpPivot, companies, groupStructure,
              compareMode, month, year, source, structure,
              cmpMonth, cmpYear, cmpSource, cmpStructure,
              perspectiveMode, perspectiveParent: perspective,
            })}>
            <img src="https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png" width="44" height="36" alt="Excel" />
          </button>
          <button className="transition-all hover:opacity-80 hover:scale-105" title="Export PDF"
            onClick={() => generateContributivePdf({
              tree, pivot,
              cols: effectiveCols,
              cmpPivot, companies, groupStructure,
              compareMode, month, year, source, structure,
              cmpMonth, cmpYear, cmpSource, cmpStructure,
              perspectiveMode, perspectiveParent: perspective,
            })}>
            <img src="https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png" width="30" height="36" alt="PDF" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0" style={{ overflow: "hidden" }}>
        {!metaReady || loading || probingPeriod ? (
          <div className="flex items-center justify-center flex-1">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-[#1a2f8a]" />
              <p className="text-xs text-gray-400">{!metaReady ? "Loading metadata…" : probingPeriod ? "Finding latest period…" : "Building contributive view…"}</p>
            </div>
          </div>
        ) : !hasData ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="w-14 h-14 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <RefreshCw size={20} className="text-[#1a2f8a]" />
              </div>
              <p className="text-sm font-bold text-gray-400">No data for selected filters</p>
              <p className="text-xs text-gray-300 mt-1">
                {perspectiveMode
                  ? `No contribution data for children of ${perspective}`
                  : "Try adjusting the source, year or month"}
              </p>
            </div>
          </div>
        ) : (
          <SyncedTable
            cols={effectiveCols}
            tree={tree}
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
            pivot={pivot}
            journalPivot={journalPivot}
            accountMap={accountMap}
            companies={companies}
            groupStructure={groupStructure}
            hasData={hasData}
            collapseAll={collapseAll}
            expandAll={expandAll}
            setDrilldown={setDrilldown}
            getReportingCurrency={getReportingCurrency}
            breakers={breakers}
            compareMode={compareMode}
            onToggleCompare={() => {
              if (!compareMode) {
                setCmpYear(year); setCmpMonth(month);
                setCmpSource(source); setCmpStructure(structure);
              }
              setCompareMode(c => !c);
            }}
            cmpPivot={cmpPivot}
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
          />
        )}
      </div>
    </div>
  );
}