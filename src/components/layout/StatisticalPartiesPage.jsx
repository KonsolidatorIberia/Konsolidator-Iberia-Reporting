import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Users, Building2, Camera, Plus, X, Trash2, Package, Briefcase,
  BarChart3, Calendar, Search, Layers, TrendingUp, Filter, Check,
  Pencil, ChevronDown,
  Factory, Truck, Store, Globe, Zap, Leaf, Droplet, Wind,
  Heart, Award, Target, Cpu,
  Home, ShoppingCart, Wrench, Flame,
} from "lucide-react";
import PageHeader from "./PageHeader.jsx";
import { useTypo, useSettings } from "./SettingsContext";
import { t } from "../../lib/i18n";
import { supabase } from "../../lib/supabaseClient";
import * as XLSX from "xlsx-js-style";

const BASE_URL = "";

const NAVY_DEEP = "#0a1647";
const NAVY      = "#1a2f8a";
const RED       = "#e8394a";

const ICON_MAP = {
  users: Users, building: Building2, camera: Camera, package: Package,
  briefcase: Briefcase, chart: BarChart3, layers: Layers, trending: TrendingUp,
  factory: Factory, truck: Truck, store: Store, globe: Globe,
  zap: Zap, leaf: Leaf, droplet: Droplet, wind: Wind,
  heart: Heart, award: Award, target: Target, cpu: Cpu,
  home: Home, cart: ShoppingCart, wrench: Wrench, flame: Flame,
};
const ICON_KEYS = Object.keys(ICON_MAP);

const YEARS  = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
// A = Jan, B = Feb, ..., L = Dec
const COL_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const COL_INDEX = Object.fromEntries(COL_LETTERS.map((c, i) => [c, i])); // "A" -> 0

// ─────────────────────────────────────────────────────────────
// Legacy → normalized cells. Old rows stored `{ [month]: number }`.
// New rows store `{ [month]: { value, formula } }`. Convert both.
// ─────────────────────────────────────────────────────────────
function normalizeValues(values) {
  const out = {};
  for (const [year, dims] of Object.entries(values ?? {})) {
    out[year] = {};
    for (const [dim, months] of Object.entries(dims ?? {})) {
      out[year][dim] = {};
      for (const [m, v] of Object.entries(months ?? {})) {
        if (v == null) continue;
        if (typeof v === "object" && ("value" in v || "formula" in v)) {
          out[year][dim][m] = { value: v.value ?? null, formula: v.formula ?? null };
        } else {
          out[year][dim][m] = { value: Number(v), formula: null };
        }
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Formula parsing. Grammar (Excel-flavoured):
//   =expr
//   expr = term (('+'|'-') term)*
//   term = factor (('*'|'/') factor)*
//   factor = unary ('%' | '^' factor)?     (% means /100)
//   unary  = ('-'|'+')? primary
//   primary = number | ref | range-func | '(' expr ')'
//   ref = [A-L] number       e.g. A1, L23
//   range-func = NAME '(' ref ':' ref ')'   NAME ∈ SUM|AVG|MIN|MAX
// Refs are relative to the current year's grid: column A..L = month 1..12,
// row 1..N = group.dims[0..N-1].
// ─────────────────────────────────────────────────────────────
function parseRef(tok) {
  const m = /^([A-La-l])(\d+)$/.exec(tok);
  if (!m) return null;
  const col = COL_INDEX[m[1].toUpperCase()];
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { row, col };
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if ("+-*/()%^:,".includes(ch)) { tokens.push({ t: ch }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const asRef = parseRef(word);
      if (asRef) tokens.push({ t: "ref", v: asRef, raw: word });
      else tokens.push({ t: "name", v: word.toUpperCase() });
      i = j; continue;
    }
    // Unknown char — abort
    return null;
  }
  return tokens;
}

function evalFormula(formulaStr, computed, dims, resolving) {
  const src = formulaStr.trim().replace(/^=/, "");
  const tokens = tokenize(src);
  if (!tokens) return NaN;
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => { const tok = tokens[pos]; if (tok && tok.t === t) { pos++; return tok; } return null; };

  const resolveRef = (ref) => {
    if (ref.row < 0 || ref.row >= dims.length) return 0;
    const dimCode = dims[ref.row];
    const month = ref.col + 1;
    const key = `${dimCode}:${month}`;
    if (resolving.has(key)) return 0; // cycle guard
    const cached = computed[dimCode]?.[month];
    if (cached != null) return cached;
    return 0;
  };

  const parseExpr = () => {
    let left = parseTerm();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = tokens[pos++].t;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = () => {
    let left = parseFactor();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = tokens[pos++].t;
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parseFactor = () => {
    let val = parseUnary();
    if (peek() && peek().t === "%") { pos++; val = val / 100; }
    if (peek() && peek().t === "^") { pos++; val = Math.pow(val, parseFactor()); }
    return val;
  };
  const parseUnary = () => {
    if (peek() && peek().t === "-") { pos++; return -parseUnary(); }
    if (peek() && peek().t === "+") { pos++; return parseUnary(); }
    return parsePrimary();
  };
  const parsePrimary = () => {
    const tok = peek();
    if (!tok) return 0;
    if (tok.t === "num") { pos++; return tok.v; }
    if (tok.t === "ref") { pos++; return resolveRef(tok.v); }
    if (tok.t === "(") {
      pos++;
      const v = parseExpr();
      eat(")");
      return v;
    }
    if (tok.t === "name") {
      const name = tok.v; pos++;
      if (!eat("(")) return 0;
      // range: ref ':' ref (only form supported)
      const first = eat("ref");
      if (first && eat(":")) {
        const last = eat("ref");
        eat(")");
        if (!last) return 0;
        const r0 = Math.min(first.v.row, last.v.row);
        const r1 = Math.max(first.v.row, last.v.row);
        const c0 = Math.min(first.v.col, last.v.col);
        const c1 = Math.max(first.v.col, last.v.col);
        const vals = [];
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            vals.push(resolveRef({ row: r, col: c }));
          }
        }
        if (name === "SUM") return vals.reduce((s, v) => s + v, 0);
        if (name === "AVG" || name === "AVERAGE") return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        if (name === "MIN") return vals.length ? Math.min(...vals) : 0;
        if (name === "MAX") return vals.length ? Math.max(...vals) : 0;
        return 0;
      }
      // Single-arg function fallback
      const v = parseExpr();
      eat(")");
      if (name === "ABS") return Math.abs(v);
      return v;
    }
    return 0;
  };

  try {
    const result = parseExpr();
    return Number.isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

// Evaluate a full year's cells, resolving formulas iteratively so cells that
// depend on other cells' results eventually settle.
function evaluateYear(yearVals, dims) {
  const computed = {};
  // Seed with raw values
  for (const dim of dims) {
    computed[dim] = {};
    const dimMap = yearVals[dim] ?? {};
    for (const m of MONTHS) {
      const cell = dimMap[m];
      if (!cell) continue;
      if (cell.formula == null && cell.value != null) computed[dim][m] = cell.value;
    }
  }
  // Iterate formulas up to 20 passes to resolve chains
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const dim of dims) {
      const dimMap = yearVals[dim] ?? {};
      for (const m of MONTHS) {
        const cell = dimMap[m];
        if (!cell?.formula) continue;
        const key = `${dim}:${m}`;
        const resolving = new Set([key]);
        const v = evalFormula(cell.formula, computed, dims, resolving);
        const prev = computed[dim][m];
        if (Number.isFinite(v) && prev !== v) {
          computed[dim][m] = v;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return computed;
}

// Shift refs in a formula by (dCol, dRow). Used by the fill handle.
function shiftFormula(formula, dCol, dRow, maxRows) {
  return formula.replace(/([A-La-l])(\d+)/g, (m, letter, digits) => {
    const col = COL_INDEX[letter.toUpperCase()];
    const row = Number(digits) - 1;
    const newCol = col + dCol;
    const newRow = row + dRow;
    if (newCol < 0 || newCol > 11) return m; // out of range → keep original
    if (newRow < 0 || newRow >= maxRows) return m;
    return `${COL_LETTERS[newCol]}${newRow + 1}`;
  });
}

// ─────────────────────────────────────────────────────────────
// EXCEL BLUEPRINT — download / upload
// ─────────────────────────────────────────────────────────────

const MONTH_HEADERS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Build the blueprint workbook and trigger a download.
function downloadBlueprint({ companyOpts, dimGroups, dimsByGroup }) {
  // Konsolidator palette
  const NAVY_HEX     = "0A1647"; // deep navy
  const NAVY_MID_HEX = "1A2F8A"; // brand navy
  const RED_HEX      = "E8394A";
  const NAVY_TINT    = "E8ECF7"; // pale navy for row shading
  const NAVY_TINT_2  = "F4F6FC"; // even paler for alternating
  const WHITE        = "FFFFFF";
  const INK_HEX      = "0A1647";
  const MUTED_HEX    = "5B6690";

  // Style factories
  const borderThin  = { style: "thin",   color: { rgb: "D5DAEA" } };
  const borderMed   = { style: "medium", color: { rgb: NAVY_MID_HEX } };
  const allBorders = (b = borderThin) => ({ top: b, bottom: b, left: b, right: b });

// Helper: xlsx-js-style needs patternType: "solid" on every fill, otherwise
  // the color is ignored and cells render white. Wrap once here so every
  // style below is guaranteed to actually paint.
  const solidFill = (rgb) => ({ patternType: "solid", fgColor: { rgb }, bgColor: { rgb } });

  const titleStyle = {
    font: { name: "Inter", sz: 20, bold: true, color: { rgb: WHITE } },
    fill: solidFill(NAVY_HEX),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
  };
  const kickerStyle = {
    font: { name: "Inter", sz: 9, bold: true, color: { rgb: RED_HEX } },
    fill: solidFill(NAVY_HEX),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
  };
  const subtitleStyle = {
    font: { name: "Inter", sz: 11, italic: true, color: { rgb: MUTED_HEX } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true, indent: 1 },
  };
  const sectionHeaderStyle = {
    font: { name: "Inter", sz: 11, bold: true, color: { rgb: WHITE } },
    fill: solidFill(NAVY_MID_HEX),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: allBorders(borderMed),
  };
  const fieldLabelStyle = {
    font: { name: "Inter", sz: 10, bold: true, color: { rgb: INK_HEX } },
    fill: solidFill(NAVY_TINT),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: allBorders(borderThin),
  };
  const fieldInputStyle = {
    font: { name: "Inter", sz: 11, color: { rgb: INK_HEX } },
    fill: solidFill(WHITE),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: allBorders(borderThin),
  };
  const columnHeaderStyle = {
    font: { name: "Inter", sz: 10, bold: true, color: { rgb: WHITE } },
    fill: solidFill(NAVY_HEX),
    alignment: { horizontal: "center", vertical: "center" },
    border: allBorders(borderMed),
  };
  const dataCellStyle = (odd) => ({
    font: { name: "Inter", sz: 10, color: { rgb: INK_HEX } },
    fill: solidFill(odd ? NAVY_TINT_2 : WHITE),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: allBorders(borderThin),
  });
  const codeCellStyle = (odd) => ({
    font: { name: "JetBrains Mono", sz: 10, bold: true, color: { rgb: NAVY_MID_HEX } },
    fill: solidFill(odd ? NAVY_TINT_2 : WHITE),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: allBorders(borderThin),
  });
  const selectCellStyle = (odd) => ({
    font: { name: "Inter", sz: 12, bold: true, color: { rgb: RED_HEX } },
    fill: solidFill(odd ? NAVY_TINT_2 : WHITE),
    alignment: { horizontal: "center", vertical: "center" },
    border: allBorders(borderThin),
  });
  const numberCellStyle = (odd) => ({
    font: { name: "JetBrains Mono", sz: 10, color: { rgb: INK_HEX } },
    fill: solidFill(odd ? NAVY_TINT_2 : WHITE),
    alignment: { horizontal: "right", vertical: "center", indent: 1 },
    border: allBorders(borderThin),
    numFmt: "#,##0.00;-#,##0.00;—",
  });
  const monthHeaderStyle = {
    font: { name: "Inter", sz: 10, bold: true, color: { rgb: WHITE } },
    fill: solidFill(NAVY_MID_HEX),
    alignment: { horizontal: "center", vertical: "center" },
    border: allBorders(borderMed),
  };
  const groupBadgeStyle = (odd) => ({
    font: { name: "Inter", sz: 9, bold: true, color: { rgb: NAVY_MID_HEX } },
    fill: solidFill(odd ? "E1E7F5" : "EDF0F9"),
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: allBorders(borderThin),
  });

  const wb = XLSX.utils.book_new();
  const lastYears = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  // Helper: apply a style to a range of cells
  const styleRange = (sheet, r0, c0, r1, c1, style) => {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!sheet[addr]) sheet[addr] = { t: "s", v: "" };
        sheet[addr].s = style;
      }
    }
  };
  const setCell = (sheet, r, c, value, style) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    const isNum = typeof value === "number";
    sheet[addr] = { t: isNum ? "n" : "s", v: value };
    if (style) sheet[addr].s = style;
    // Extend the ref if needed
    const ref = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r, c }, e: { r, c } };
    ref.s.r = Math.min(ref.s.r, r);
    ref.s.c = Math.min(ref.s.c, c);
    ref.e.r = Math.max(ref.e.r, r);
    ref.e.c = Math.max(ref.e.c, c);
    sheet["!ref"] = XLSX.utils.encode_range(ref);
  };

  // ═════════════════════════════════════════════════════════
  // CONFIG SHEET
  // ═════════════════════════════════════════════════════════
  const cfg = {};
  cfg["!ref"] = "A1:C1";
  cfg["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 52 }];
  cfg["!rows"] = [];

  let r = 0;
  // Cover kicker + title
  setCell(cfg, r, 0, "KONSOLIDATOR · STATISTICAL PARTY", kickerStyle);
  setCell(cfg, r, 1, "", kickerStyle);
  setCell(cfg, r, 2, "", kickerStyle);
  cfg["!rows"][r] = { hpt: 20 };
  r++;

  setCell(cfg, r, 0, "Configuration blueprint", titleStyle);
  setCell(cfg, r, 1, "", titleStyle);
  setCell(cfg, r, 2, "", titleStyle);
  cfg["!rows"][r] = { hpt: 36 };
  r++;

  setCell(cfg, r, 0, "Fill the fields below. In the two lists, mark X on the rows you want to include. Then fill values in the year sheets.", subtitleStyle);
  setCell(cfg, r, 1, "", subtitleStyle);
  setCell(cfg, r, 2, "", subtitleStyle);
  cfg["!rows"][r] = { hpt: 32 };
  r += 2;

  // Identity block
  setCell(cfg, r, 0, "IDENTITY", sectionHeaderStyle);
  setCell(cfg, r, 1, "", sectionHeaderStyle);
  setCell(cfg, r, 2, "", sectionHeaderStyle);
  cfg["!rows"][r] = { hpt: 22 };
  r++;

  const identityFields = [
    ["Name", "", "Required — e.g. Employees, Buildings, Contracts"],
    ["Description", "", "Optional"],
    ["Unit", "", "e.g. headcount, m², units"],
   ["Icon", "chart", "Options: " + ICON_KEYS.join(" · ")],
  ];
  identityFields.forEach(([label, value, hint]) => {
    setCell(cfg, r, 0, label, fieldLabelStyle);
    setCell(cfg, r, 1, value, fieldInputStyle);
    setCell(cfg, r, 2, hint, { ...subtitleStyle, alignment: { ...subtitleStyle.alignment, wrapText: false } });
    cfg["!rows"][r] = { hpt: 22 };
    r++;
  });
  r++;

  // Companies section
  setCell(cfg, r, 0, "COMPANIES", sectionHeaderStyle);
  setCell(cfg, r, 1, "", sectionHeaderStyle);
  setCell(cfg, r, 2, "", sectionHeaderStyle);
  cfg["!rows"][r] = { hpt: 22 };
  r++;

  setCell(cfg, r, 0, "SELECT", columnHeaderStyle);
  setCell(cfg, r, 1, "Code",   columnHeaderStyle);
  setCell(cfg, r, 2, "Name",   columnHeaderStyle);
  cfg["!rows"][r] = { hpt: 22 };
  r++;

  companyOpts.forEach((c, i) => {
    const odd = i % 2 === 1;
    setCell(cfg, r, 0, "", selectCellStyle(odd));
    setCell(cfg, r, 1, c.value, codeCellStyle(odd));
    setCell(cfg, r, 2, c.label, dataCellStyle(odd));
    cfg["!rows"][r] = { hpt: 20 };
    r++;
  });
  r++;

  // Years section
  setCell(cfg, r, 0, "YEARS", sectionHeaderStyle);
  setCell(cfg, r, 1, "", sectionHeaderStyle);
  setCell(cfg, r, 2, "", sectionHeaderStyle);
  cfg["!rows"][r] = { hpt: 22 };
  r++;

  setCell(cfg, r, 0, "SELECT", columnHeaderStyle);
  setCell(cfg, r, 1, "Year",   columnHeaderStyle);
  setCell(cfg, r, 2, "",       columnHeaderStyle);
  cfg["!rows"][r] = { hpt: 22 };
  r++;

  lastYears.forEach((y, i) => {
    const odd = i % 2 === 1;
    setCell(cfg, r, 0, "", selectCellStyle(odd));
    setCell(cfg, r, 1, String(y), codeCellStyle(odd));
    setCell(cfg, r, 2, "", dataCellStyle(odd));
    cfg["!rows"][r] = { hpt: 20 };
    r++;
  });

  // Merges for the cover rows and section bars
  cfg["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
  ];
  // Merge section header bars (Identity / Companies / Years)
  const sectionBarRows = [4, 9 + identityFields.length - 4, /* set below */];
  // Simpler: compute by scanning cells we already wrote
  cfg["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
  ];
  // Add merges for each section header we drew
  for (let rr = 0; rr <= r; rr++) {
    const addr = XLSX.utils.encode_cell({ r: rr, c: 0 });
    const cell = cfg[addr];
    if (cell && cell.s === sectionHeaderStyle) {
      cfg["!merges"].push({ s: { r: rr, c: 0 }, e: { r: rr, c: 2 } });
    }
  }

  XLSX.utils.book_append_sheet(wb, cfg, "Config");

  // ═════════════════════════════════════════════════════════
  // YEAR SHEETS
  // ═════════════════════════════════════════════════════════
  const allDims = [];
  dimGroups.forEach(g => {
    const inner = dimsByGroup.get(g);
    if (!inner) return;
    inner.forEach((name, code) => allDims.push({ code, name, group: g }));
  });

  for (const year of lastYears) {
    const sh = {};
    sh["!ref"] = "A1:O1";
    sh["!cols"] = [
      { wch: 22 }, { wch: 14 }, { wch: 42 },
      ...Array(12).fill({ wch: 12 }),
    ];
    sh["!rows"] = [];

    let rr = 0;

    // Cover strip
    setCell(sh, rr, 0, "KONSOLIDATOR", kickerStyle);
    for (let c = 1; c <= 14; c++) setCell(sh, rr, c, "", kickerStyle);
    sh["!rows"][rr] = { hpt: 18 };
    rr++;

    setCell(sh, rr, 0, `Year ${year}`, titleStyle);
    for (let c = 1; c <= 14; c++) setCell(sh, rr, c, "", titleStyle);
    sh["!rows"][rr] = { hpt: 32 };
    rr++;

    setCell(sh, rr, 0, "Fill values in the month columns for the dimensions you want to track. Leave a row blank to skip it. Formulas like =C4*1.05 are supported.", subtitleStyle);
    for (let c = 1; c <= 14; c++) setCell(sh, rr, c, "", subtitleStyle);
    sh["!rows"][rr] = { hpt: 32 };
    rr += 2;

    // Column headers
    const headers = ["Group", "Code", "Dimension name", ...MONTH_HEADERS];
    headers.forEach((h, i) => {
      const style = i < 3 ? columnHeaderStyle : monthHeaderStyle;
      setCell(sh, rr, i, h, style);
    });
    sh["!rows"][rr] = { hpt: 26 };
    rr++;

    const dataStartRow = rr;
    allDims.forEach((d, i) => {
      const odd = i % 2 === 1;
      setCell(sh, rr, 0, d.group, groupBadgeStyle(odd));
      setCell(sh, rr, 1, d.code, codeCellStyle(odd));
      setCell(sh, rr, 2, d.name, dataCellStyle(odd));
      for (let m = 0; m < 12; m++) {
        setCell(sh, rr, 3 + m, "", numberCellStyle(odd));
      }
      sh["!rows"][rr] = { hpt: 20 };
      rr++;
    });

    // Merges for cover strip
    sh["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 14 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 14 } },
    ];

    // Freeze the header rows + first 3 columns
    sh["!freeze"] = { xSplit: 3, ySplit: dataStartRow };
    sh["!views"] = [{ state: "frozen", xSplit: 3, ySplit: dataStartRow, showGridLines: false }];

    XLSX.utils.book_append_sheet(wb, sh, String(year));
  }

  XLSX.writeFile(wb, `konsolidator-party-blueprint-${Date.now()}.xlsx`);
}

// Parse an uploaded blueprint back into a create-party payload. Returns
// { draft, values } or throws with a friendly message.
async function parseBlueprint(file, { dimsByGroup, companyOpts }) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  // ── CONFIG ───────────────────────────────────────────────
  const configSheet = wb.Sheets["Config"];
  if (!configSheet) throw new Error("Missing 'Config' sheet");
  const configRows = XLSX.utils.sheet_to_json(configSheet, { header: 1, defval: "" });

  // Parse the top field/value block
  const getField = (label) => {
    for (const row of configRows) {
      if (String(row[0] ?? "").trim().toLowerCase() === label.toLowerCase()) {
        return String(row[1] ?? "").trim();
      }
    }
    return "";
  };
  const name = getField("Name");
  if (!name) throw new Error("Config: 'Name' is required");
  const description = getField("Description");
  const unit = getField("Unit");
  let icon = getField("Icon").toLowerCase() || "chart";
  if (!ICON_KEYS.includes(icon)) icon = "chart";

  // Parse the two mark-with-X lists
  const readSection = (headerMatch, valueColIdx) => {
    let inSection = false;
    let headerFound = false;
    const picked = [];
    for (const row of configRows) {
      const first = String(row[0] ?? "").trim();
      if (!inSection && first.toUpperCase().includes(headerMatch)) {
        inSection = true;
        continue;
      }
      if (inSection && !headerFound) {
        // The next row after the section header is the column titles
        if (first.toUpperCase() === "SELECT") { headerFound = true; }
        continue;
      }
      if (inSection && headerFound) {
        if (first === "" && String(row[valueColIdx] ?? "").trim() === "") break;
        if (String(first).trim().toLowerCase() === "x") {
          const v = String(row[valueColIdx] ?? "").trim();
          if (v) picked.push(v);
        }
      }
    }
    return picked;
  };
  const companies = readSection("COMPANIES", 1);
  const years = readSection("YEARS", 1);
  if (companies.length === 0) throw new Error("Config: mark at least one company with X");
  if (years.length === 0) throw new Error("Config: mark at least one year with X");

  // ── YEAR SHEETS → values ─────────────────────────────────
  // Build a lookup { code -> group } so we can rebuild dimGroups.
  const dimToGroup = new Map();
  dimsByGroup.forEach((inner, groupName) => {
    inner.forEach((_, code) => dimToGroup.set(code, groupName));
  });

  const values = {};
  const usedDims = new Set();
  for (const y of years) {
    const sheet = wb.Sheets[y];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // Find the header row ("Group","Code","Dimension name","Jan"...)
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(c => String(c ?? "").trim().toLowerCase());
      if (cells[0] === "group" && cells[1] === "code" && cells[3] === "jan") {
        headerIdx = i; break;
      }
    }
    if (headerIdx < 0) continue;

    values[y] = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const code = String(row[1] ?? "").trim();
      if (!code) continue;
      const dimMap = {};
      let any = false;
      for (let m = 0; m < 12; m++) {
        const cell = row[3 + m];
        if (cell === "" || cell === null || cell === undefined) continue;
        const s = String(cell).trim();
        if (!s) continue;
        if (s.startsWith("=")) {
          dimMap[m + 1] = { value: null, formula: s };
          any = true;
        } else {
          const num = Number(s.replace(",", "."));
          if (Number.isFinite(num)) {
            dimMap[m + 1] = { value: num, formula: null };
            any = true;
          }
        }
      }
if (any) {
        values[y][code] = dimMap;
        usedDims.add(code);
      }
    }
  }

  const dims = [...usedDims];
  if (dims.length === 0) throw new Error("No values found in any year sheet");
  const dimGroupsUsed = [...new Set(dims.map(c => dimToGroup.get(c)).filter(Boolean))];

  return {
    draft: {
      name, description, unit, icon,
      companies, years, dimGroups: dimGroupsUsed, dims,
    },
    values,
  };
}

// Segmented toggle: two pills with a sliding navy indicator underneath.
// Matches the aesthetic of the year switcher but with an animated pill.
function DecimalToggle({ mode, onChange }) {
  const isInt = mode === "integer";
  const BTN_W = 32;
  const BTN_H = 22;
  const PAD = 2;
  return (
    <div
      className="relative flex items-center rounded-lg"
      style={{
        background: "rgba(26,47,138,0.06)",
        border: "1px solid rgba(26,47,138,0.10)",
        padding: PAD,
        boxSizing: "content-box",
        width: BTN_W * 2,
        height: BTN_H,
      }}
      title={isInt ? "Rounded to integers" : "Showing decimals"}
    >
      <span
        aria-hidden
        className="absolute rounded-md"
        style={{
          top: PAD,
          height: BTN_H,
          left: isInt ? PAD + BTN_W : PAD,
          width: BTN_W,
          background: NAVY,
          boxShadow: `0 2px 6px -1px ${NAVY}55`,
          transition: "left 260ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
      <button
        onClick={() => onChange("auto")}
        className="relative z-10 flex items-center justify-center rounded-md transition-colors"
        style={{ width: BTN_W, height: BTN_H, color: isInt ? NAVY : "white" }}
      >
        <span className="font-mono tabular-nums font-black text-[11px] leading-none">1.5</span>
      </button>
      <button
        onClick={() => onChange("integer")}
        className="relative z-10 flex items-center justify-center rounded-md transition-colors"
        style={{ width: BTN_W, height: BTN_H, color: isInt ? "white" : NAVY }}
      >
        <span className="font-mono tabular-nums font-black text-[11px] leading-none">1</span>
      </button>
    </div>
  );
}

// Format a number based on the current decimal mode. Underlying stored/
// computed values are untouched — this only affects display.
function formatNumber(n, mode) {
  if (typeof n !== "number" || n === 0) return "—";
  if (mode === "integer") return Math.round(n).toLocaleString("de-DE");
  return n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────────────────────
// Drill-mode header: year switcher + filled % + total for year
// ─────────────────────────────────────────────────────────────
function DrillHeaderExtra({
  group, year, onYearChange, decimalMode, onDecimalModeChange,
  companyOpts, onEditCompanies, onEditYears,
}) {
  const effectiveYear = group.years.includes(year) ? year : (group.years[0] ?? String(new Date().getFullYear()));
  const yearVals = group.values[effectiveYear] ?? {};
  const computed = useMemo(() => evaluateYear(yearVals, group.dims), [yearVals, group.dims]);
  const grandTotal = group.dims.reduce((s, d) => s + MONTHS.reduce((ss, m) => ss + (computed[d]?.[m] ?? 0), 0), 0);
  const filled = group.dims.reduce((s, d) => s + Object.keys(yearVals[d] ?? {}).length, 0);
  const capacity = group.dims.length * 12;
  const pct = capacity > 0 ? (filled / capacity) * 100 : 0;
  const fmt = (n) => formatNumber(n, decimalMode);

return (
    <div className="flex items-center gap-2 h-full pr-1">
      {/* Total for year — the hero metric, sits leftmost */}
      <div className="flex items-baseline gap-1.5 pr-3">
        <span className="font-black tabular-nums tracking-tight leading-none"
          style={{ color: NAVY_DEEP, fontSize: 22, letterSpacing: "-0.02em" }}>
          {fmt(grandTotal)}
        </span>
        <span className="text-[10px] font-black tabular-nums leading-none"
          style={{ color: NAVY, opacity: 0.4 }}>
          {effectiveYear}
        </span>
      </div>

{/* Circular fill gauge — replaces the linear bar */}
      <div className="relative flex items-center justify-center" style={{ width: 48, height: 48 }}>
        <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(26,47,138,0.10)" strokeWidth="3.5" />
          <circle
            cx="24" cy="24" r="20" fill="none"
            stroke={pct >= 66 ? RED : NAVY}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 20}
            strokeDashoffset={2 * Math.PI * 20 * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset 500ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <span className="absolute font-black tabular-nums leading-none"
          style={{ color: NAVY_DEEP, fontSize: 12 }}>
          {Math.round(pct)}
        </span>
      </div>

      <ToolbarDivider />

      {/* Controls — one visual language: hairline chips */}
      <CompaniesPicker
        selected={group.companies}
        options={companyOpts}
        onChange={onEditCompanies}
      />

      <YearsControl
        years={group.years}
        effectiveYear={effectiveYear}
        onYearChange={onYearChange}
        onEditYears={onEditYears}
      />

      <ToolbarDivider />

      <DecimalToggle mode={decimalMode} onChange={onDecimalModeChange} />
    </div>
  );
}

// Vertical hairline between control groups. Very quiet — the shape of the
// controls is what does the grouping; this is just a breath.
function ToolbarDivider() {
  return (
    <span aria-hidden className="flex-shrink-0 mx-1"
      style={{
        width: 1,
        height: 20,
        background: "linear-gradient(180deg, transparent 0%, rgba(26,47,138,0.14) 25%, rgba(26,47,138,0.14) 75%, transparent 100%)",
      }} />
  );
}

// Year switcher — segmented control with a pencil that reveals on hover.
// The pencil's slot collapses to zero width when not hovered, so the
// controls to its right don't get pushed around.
function YearsControl({ years, effectiveYear, onYearChange, onEditYears }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="flex items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {years.length > 1 ? (
        <div className="flex items-center rounded-lg overflow-hidden h-7"
          style={{ border: "1px solid rgba(26,47,138,0.12)", background: "white" }}>
          {years.map((y, i) => {
            const active = effectiveYear === y;
            return (
              <button key={y} onClick={() => onYearChange(y)}
                className="px-2.5 h-full text-[11px] font-black tabular-nums transition-all"
                style={{
                  background: active ? NAVY : "transparent",
                  color: active ? "white" : NAVY,
                  borderLeft: i > 0 ? "1px solid rgba(26,47,138,0.12)" : "none",
                }}>
                {y}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="px-2.5 h-7 flex items-center rounded-lg text-[11px] font-black tabular-nums bg-white"
          style={{ color: NAVY, border: "1px solid rgba(26,47,138,0.12)" }}>
          {effectiveYear}
        </span>
      )}
      <button
        onClick={onEditYears}
        className="h-7 rounded-lg flex items-center justify-center overflow-hidden"
        style={{
          width: hover ? 28 : 0,
          marginLeft: hover ? 4 : 0,
          opacity: hover ? 1 : 0,
          background: `${NAVY}0d`,
          color: NAVY,
          transition: "width 260ms cubic-bezier(0.34, 1.56, 0.64, 1), margin-left 260ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease",
          pointerEvents: hover ? "auto" : "none",
        }}
        title="Edit years"
      >
        <Pencil size={11} strokeWidth={2.2} />
      </button>
    </div>
  );
}

// Multi-select companies dropdown. Shows count/label collapsed, opens a
// checklist on click.
function CompaniesPicker({ selected, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (v) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };

  const label = selected.length === 0
    ? "No companies"
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} companies`;

  return (
    <div ref={ref} className="relative">
<button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2.5 h-7 rounded-lg text-[11px] font-black tabular-nums transition-all bg-white"
        style={{
          color: NAVY,
          border: `1px solid ${open ? NAVY : "rgba(26,47,138,0.12)"}`,
          boxShadow: open ? `0 0 0 3px ${NAVY}14` : "none",
        }}
      >
        <Building2 size={11} strokeWidth={2.2} style={{ opacity: 0.7 }} />
        <span className="truncate max-w-[160px]">{label}</span>
        {selected.length > 1 && (
          <span className="text-[9px] font-black tabular-nums px-1 py-0.5 rounded"
            style={{ background: `${NAVY}12`, color: NAVY }}>
            {selected.length}
          </span>
        )}
        <ChevronDown size={10} style={{ opacity: 0.5, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 200ms" }} />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 rounded-2xl bg-white overflow-hidden"
          style={{
            minWidth: 260,
            zIndex: 9999,
            border: "1px solid rgba(26,47,138,0.10)",
            boxShadow: "0 20px 50px -12px rgba(15,31,92,0.28)",
          }}
        >
          <div className="max-h-[320px] overflow-y-auto sp-scroll py-1">
            {options.length === 0 ? (
              <div className="px-4 py-3 text-[12px] font-semibold" style={{ color: NAVY, opacity: 0.5 }}>
                No companies available
              </div>
            ) : options.map(o => {
              const active = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                  style={{ background: active ? `${NAVY}0d` : "transparent" }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(26,47,138,0.03)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{ border: `2px solid ${active ? NAVY : "rgba(26,47,138,0.25)"}`, background: active ? NAVY : "transparent" }}>
                    {active && (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-[13px] font-bold truncate flex-1" style={{ color: NAVY_DEEP }}>{o.label}</span>
                  {o.label !== o.value && (
                    <span className="text-[10px] font-mono font-bold" style={{ color: NAVY, opacity: 0.4 }}>{o.value}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Group shape (now multi-scope):
// {
//   id, name, icon, unit, description,
//   companies: string[],   // multiple
//   years:     string[],   // multiple
//   dimGroups: string[],   // multiple
//   dims:      string[],   // codes selected across selected groups
//   values:    { [year]: { [dimCode]: { [month]: number } } }
// }
// ─────────────────────────────────────────────────────────────

export default function StatisticalPartiesPage({
  token,
  companies: propCompanies = [],
  dimensions: propDimensions = [],
}) {
  const { colors, locale } = useSettings();
  const T = useCallback((k, fb) => t(locale, k, fb), [locale]);

  // ── Self-fetch fallback ────────────────────────────────────
  const [internalCompanies,  setInternalCompanies]  = useState([]);
  const [internalDimensions, setInternalDimensions] = useState([]);
  const [metaLoading,        setMetaLoading]        = useState(false);
  const metaFetchedRef = useRef(false);

  const fetchMetadata = useCallback(async () => {
    if (metaFetchedRef.current || metaLoading || !token) return;
    metaFetchedRef.current = true;
    setMetaLoading(true);
    const h = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
      Pragma: "no-cache",
    };
    const tryGet = async (url) => {
      try {
        const res = await fetch(url, { headers: h });
        if (!res.ok) return null;
        const json = await res.json();
        const arr = json.value ?? (Array.isArray(json) ? json : null);
        return arr?.length > 0 ? arr : null;
      } catch { return null; }
    };
    const [coData, dimData] = await Promise.all([
      tryGet(`${BASE_URL}/v2/companies`),
      tryGet(`${BASE_URL}/v2/dimensions`),
    ]);
    if (coData)  setInternalCompanies(coData);
    if (dimData) setInternalDimensions(dimData);
    setMetaLoading(false);
  }, [token, metaLoading]);

  useEffect(() => {
    if (propCompanies.length > 0 && propDimensions.length > 0) return;
    const t = setTimeout(() => {
      if (propCompanies.length === 0 || propDimensions.length === 0) {
        metaFetchedRef.current = false;
        fetchMetadata();
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [propCompanies.length, propDimensions.length, fetchMetadata]);

  useEffect(() => {
    if (!token) return;
    if (propCompanies.length > 0 && propDimensions.length > 0) return;
    metaFetchedRef.current = false;
    fetchMetadata();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const effectiveCompanies  = propCompanies.length  > 0 ? propCompanies  : internalCompanies;
  const effectiveDimensions = propDimensions.length > 0 ? propDimensions : internalDimensions;

const [groups, setGroups]          = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [activeGroupId, setActiveId] = useState(null);
  const [createOpen, setCreateOpen]  = useState(false);
const [landingQuery, setLandingQuery] = useState("");
  const [drillYear, setDrillYear]    = useState(null);
 const [decimalMode, setDecimalMode] = useState("auto"); // "auto" | "integer"
  const [yearsModalOpen, setYearsModalOpen] = useState(false);
  const [addDimModalOpen, setAddDimModalOpen] = useState(false);

  // Load parties from Supabase on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGroupsLoading(true);
      const { data, error } = await supabase.rpc("list_statistical_parties");
      if (cancelled) return;
      if (error) {
        console.error("[SP] load failed:", error);
        setGroupsLoading(false);
        return;
      }
const mapped = (data ?? []).map(r => ({
        id: r.id,
        name: r.name,
        icon: r.icon ?? "chart",
        unit: r.unit ?? "",
        description: r.description ?? "",
        companies: r.companies ?? [],
        years: r.years ?? [],
        dimGroups: r.dim_groups ?? [],
        dims: r.dims ?? [],
        values: normalizeValues(r.values ?? {}),
        createdBy: r.created_by,
        creatorName: r.creator_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      setGroups(mapped);
      setGroupsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const activeGroup = useMemo(
    () => groups.find(g => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  const companyOpts = useMemo(() => {
    if (!effectiveCompanies.length) return [];
    if (typeof effectiveCompanies[0] === "object") {
      return effectiveCompanies
        .map(c => ({
          value: c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "",
          label: c.companyLegalName ?? c.CompanyLegalName ?? c.companyShortName ?? c.CompanyShortName ?? c.company ?? c.Company ?? "",
        }))
        .filter(o => o.value);
    }
    return [...new Set(effectiveCompanies.map(String))].map(v => ({ value: v, label: v }));
  }, [effectiveCompanies]);

  const { dimGroups, dimsByGroup } = useMemo(() => {
    const byGroup = new Map();
    effectiveDimensions.forEach(d => {
      if (typeof d !== "object") return;
      const g = d.dimensionGroup ?? d.DimensionGroup ?? d.group ?? d.Group ?? "General";
      const c = String(d.dimensionCode ?? d.DimensionCode ?? d.code ?? d.Code ?? "");
      const n = String(d.dimensionName ?? d.DimensionName ?? d.name ?? d.Name ?? c);
      if (!c) return;
      if (!byGroup.has(g)) byGroup.set(g, new Map());
      byGroup.get(g).set(c, n);
    });
    return { dimGroups: [...byGroup.keys()].sort(), dimsByGroup: byGroup };
  }, [effectiveDimensions]);

const handleCreate = async (draft) => {
    const { data, error } = await supabase.rpc("create_statistical_party", {
      p_name:        draft.name.trim(),
      p_description: draft.description.trim() || null,
      p_unit:        draft.unit.trim() || null,
      p_icon:        draft.icon,
      p_companies:   draft.companies,
      p_years:       draft.years,
      p_dim_groups:  draft.dimGroups,
      p_dims:        draft.dims,
    });
    if (error) {
      console.error("[SP] create failed:", error);
      alert(`Failed to create party: ${error.message}`);
      return;
    }
    // Re-fetch creator_name via list (or fetch just this one)
    const { data: fresh } = await supabase.rpc("list_statistical_parties");
    const row = (fresh ?? []).find(r => r.id === data.id) ?? data;
const mapped = {
      id: row.id,
      name: row.name,
      icon: row.icon ?? "chart",
      unit: row.unit ?? "",
      description: row.description ?? "",
      companies: row.companies ?? [],
      years: row.years ?? [],
      dimGroups: row.dim_groups ?? [],
      dims: row.dims ?? [],
      values: normalizeValues(row.values ?? {}),
      createdBy: row.created_by,
      creatorName: row.creator_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    setGroups(prev => [mapped, ...prev]);
    setCreateOpen(false);
    setActiveId(mapped.id);
  };

const handleDelete = async (id) => {
    if (!window.confirm("Delete this statistical party?")) return;
    const { error } = await supabase
      .from("statistical_parties")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[SP] delete failed:", error);
      alert(`Failed to delete: ${error.message}`);
      return;
    }
    setGroups(prev => prev.filter(g => g.id !== id));
    if (activeGroupId === id) setActiveId(null);
  };

const saveTimerRef = useRef(null);
  const pendingValuesRef = useRef(null);

const flushValues = useCallback(async () => {
    const payload = pendingValuesRef.current;
    if (!payload) return;
    pendingValuesRef.current = null;
    console.log("[SP] flushing values for", payload.id, payload.values);
    const { data, error } = await supabase.rpc("update_statistical_party_values", {
      p_id: payload.id,
      p_values: payload.values,
    });
    if (error) {
      console.error("[SP] values sync FAILED:", error);
      alert(`Save failed: ${error.message}`);
    } else {
      console.log("[SP] values saved:", data?.id);
    }
  }, []);

 // Write a cell. `raw` is what the user typed. If it starts with "=" we store
  // a formula; otherwise a raw number. Empty string clears the cell.
  const setCellValue = (year, dimCode, month, raw) => {
    if (!activeGroup) return;
    const currentGroup = groups.find(g => g.id === activeGroup.id);
    if (!currentGroup) return;

    const yr = currentGroup.values[year] ? { ...currentGroup.values[year] } : {};
    const dimMap = yr[dimCode] ? { ...yr[dimCode] } : {};

    const trimmed = String(raw ?? "").trim();
    if (trimmed === "") {
      delete dimMap[month];
    } else if (trimmed.startsWith("=")) {
      dimMap[month] = { value: null, formula: trimmed };
    } else {
      const cleaned = trimmed.replace(/[^\d.-]/g, "");
      const num = cleaned === "" || cleaned === "-" ? null : Number(cleaned);
      if (num === null || Number.isNaN(num)) delete dimMap[month];
      else dimMap[month] = { value: num, formula: null };
    }
    yr[dimCode] = dimMap;
    const nextValues = { ...currentGroup.values, [year]: yr };

    setGroups(prev => prev.map(g => g.id === activeGroup.id ? { ...g, values: nextValues } : g));

    pendingValuesRef.current = { id: activeGroup.id, values: nextValues };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushValues, 750);
  };

  // Save any scope change (companies / years / dimGroups / dims). Uses direct
  // .update() on the table — swap for supabase.rpc if you add one later.
  const saveScope = async (patch) => {
    if (!activeGroup) return;
    // Compute next scope + prune values for removed years / dims
    const currentGroup = groups.find(g => g.id === activeGroup.id);
    if (!currentGroup) return;
    const next = { ...currentGroup, ...patch };
    // Prune values under removed years
    const yearsSet = new Set(next.years);
    const dimsSet  = new Set(next.dims);
    const cleanedValues = {};
    for (const [yr, dimMap] of Object.entries(next.values ?? {})) {
      if (!yearsSet.has(yr)) continue;
      cleanedValues[yr] = {};
      for (const [dim, months] of Object.entries(dimMap ?? {})) {
        if (!dimsSet.has(dim)) continue;
        cleanedValues[yr][dim] = months;
      }
    }
    next.values = cleanedValues;

    setGroups(prev => prev.map(g => g.id === next.id ? next : g));

    const { error } = await supabase
      .from("statistical_parties")
      .update({
        companies:  next.companies,
        years:      next.years,
        dim_groups: next.dimGroups,
        dims:       next.dims,
        values:     next.values,
      })
      .eq("id", next.id);
    if (error) {
      console.error("[SP] scope update failed:", error);
      alert(`Failed to save: ${error.message}`);
    }
  };

  const removeDim = (code) => {
    if (!activeGroup) return;
    if (!window.confirm("Remove this dimension? All values in this row will be lost.")) return;
    saveScope({ dims: activeGroup.dims.filter(c => c !== code) });
  };

  const addDims = (codes) => {
    if (!activeGroup || codes.length === 0) return;
    const merged = [...activeGroup.dims];
    for (const c of codes) if (!merged.includes(c)) merged.push(c);
    // Also make sure the containing dim groups are selected
    const groupsToAdd = new Set(activeGroup.dimGroups);
    codes.forEach(code => {
      for (const [g, inner] of dimsByGroup) {
        if (inner.has(code)) groupsToAdd.add(g);
      }
    });
    saveScope({ dims: merged, dimGroups: [...groupsToAdd] });
  };

  // Blueprint upload — parse the workbook, create the party, then push
  // its values (formulas + numbers) in a follow-up call.
  const handleBlueprintUpload = async (file) => {
    try {
      const { draft, values } = await parseBlueprint(file, { dimsByGroup, companyOpts });
      const { data, error } = await supabase.rpc("create_statistical_party", {
        p_name:        draft.name,
        p_description: draft.description || null,
        p_unit:        draft.unit || null,
        p_icon:        draft.icon,
        p_companies:   draft.companies,
        p_years:       draft.years,
        p_dim_groups:  draft.dimGroups,
        p_dims:        draft.dims,
      });
      if (error) throw new Error(error.message);
      // Push values in a second call so formulas / drag data land immediately.
      const { error: vErr } = await supabase.rpc("update_statistical_party_values", {
        p_id: data.id,
        p_values: values,
      });
      if (vErr) throw new Error(`Party created but values failed: ${vErr.message}`);
      // Refresh the list
      const { data: fresh } = await supabase.rpc("list_statistical_parties");
      const row = (fresh ?? []).find(r => r.id === data.id) ?? data;
      const mapped = {
        id: row.id, name: row.name, icon: row.icon ?? "chart",
        unit: row.unit ?? "", description: row.description ?? "",
        companies: row.companies ?? [], years: row.years ?? [],
        dimGroups: row.dim_groups ?? [], dims: row.dims ?? [],
        values: normalizeValues(row.values ?? {}),
        createdBy: row.created_by, creatorName: row.creator_name,
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
      setGroups(prev => [mapped, ...prev]);
      setActiveId(mapped.id);
    } catch (err) {
      console.error("[SP] blueprint upload failed:", err);
      alert(`Blueprint failed: ${err.message}`);
    }
  };

  const setYears = (years) => saveScope({ years });
  const setCompanies = (companies) => saveScope({ companies });

  // Bulk-write many cells at once (used by the fill handle). `cells` is an
  // array of { year, dimCode, month, raw }.
  const setCells = (cells) => {
    if (!activeGroup || cells.length === 0) return;
    const currentGroup = groups.find(g => g.id === activeGroup.id);
    if (!currentGroup) return;

    const nextValues = { ...currentGroup.values };
    for (const { year, dimCode, month, raw } of cells) {
      const yr = nextValues[year] ? { ...nextValues[year] } : {};
      const dimMap = yr[dimCode] ? { ...yr[dimCode] } : {};
      const trimmed = String(raw ?? "").trim();
      if (trimmed === "") {
        delete dimMap[month];
      } else if (trimmed.startsWith("=")) {
        dimMap[month] = { value: null, formula: trimmed };
      } else {
        const cleaned = trimmed.replace(/[^\d.-]/g, "");
        const num = cleaned === "" || cleaned === "-" ? null : Number(cleaned);
        if (num === null || Number.isNaN(num)) delete dimMap[month];
        else dimMap[month] = { value: num, formula: null };
      }
      yr[dimCode] = dimMap;
      nextValues[year] = yr;
    }

    setGroups(prev => prev.map(g => g.id === activeGroup.id ? { ...g, values: nextValues } : g));

    pendingValuesRef.current = { id: activeGroup.id, values: nextValues };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushValues, 750);
  };

  // Flush on unmount
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    flushValues();
  }, [flushValues]);

  const isDrill = !!activeGroup;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
<PageHeader
        kicker={isDrill ? "Statistical parties · Detail" : "Views · Statistical Parties"}
        title={isDrill ? activeGroup.name : "Statistical Parties"}
        onBack={isDrill ? () => setActiveId(null) : undefined}
        headerExtra={
          !isDrill ? (
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 bg-white rounded-xl px-3 py-1.5 border"
                style={{ borderColor: "rgba(26,47,138,0.12)" }}
              >
                <Search size={12} style={{ color: NAVY, opacity: 0.5 }} />
                <input
                  type="text"
                  value={landingQuery}
                  onChange={e => setLandingQuery(e.target.value)}
                  placeholder="Search"
                  className="text-[12px] font-semibold outline-none bg-transparent w-40"
                  style={{ color: NAVY_DEEP }}
                />
                {landingQuery && (
                  <button onClick={() => setLandingQuery("")}>
                    <X size={11} style={{ color: NAVY, opacity: 0.5 }} />
                  </button>
                )}
              </div>
<button
                onClick={() => downloadBlueprint({ companyOpts, dimGroups, dimsByGroup })}
                className="flex items-center gap-1.5 px-3 h-9 rounded-full text-[11px] font-black tracking-wide transition-all uppercase"
                style={{
                  background: "white",
                  color: NAVY,
                  border: `1px solid ${NAVY}22`,
                  boxShadow: `0 2px 6px -1px ${NAVY}18`,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `${NAVY}08`;
                  e.currentTarget.style.borderColor = `${NAVY}40`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "white";
                  e.currentTarget.style.borderColor = `${NAVY}22`;
                }}
                title="Download an Excel blueprint to fill offline"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Blueprint
              </button>
              <button
                onClick={() => setCreateOpen(true)}
                className="sp-shimmer-btn flex items-center gap-1.5 px-3 h-9 rounded-full text-white font-black text-[11px] tracking-wide transition-all hover:shadow-xl uppercase"
                style={{ boxShadow: `0 8px 20px -6px ${RED}60` }}
              >
                <Plus size={12} strokeWidth={2.8} />
                New party
              </button>
            </div>
) : (
<DrillHeaderExtra
              group={activeGroup}
              year={drillYear ?? activeGroup.years[0] ?? String(new Date().getFullYear())}
              onYearChange={setDrillYear}
              decimalMode={decimalMode}
              onDecimalModeChange={setDecimalMode}
              companyOpts={companyOpts}
              onEditCompanies={setCompanies}
              onEditYears={() => setYearsModalOpen(true)}
            />
          )
        }
      />

{!isDrill ? (
<LandingView
          groups={groups}
          groupsLoading={groupsLoading}
          onOpen={setActiveId}
          onDelete={handleDelete}
          onCreate={() => setCreateOpen(true)}
          query={landingQuery}
          setQuery={setLandingQuery}
          onBlueprintUpload={handleBlueprintUpload}
        />
) : (
<DrillView
          group={activeGroup}
          dimsByGroup={dimsByGroup}
          onSetCell={setCellValue}
          onSetCells={setCells}
          locale={locale}
          year={drillYear ?? activeGroup.years[0] ?? String(new Date().getFullYear())}
          onYearChange={setDrillYear}
          decimalMode={decimalMode}
          onRemoveDim={removeDim}
          onOpenAddDim={() => setAddDimModalOpen(true)}
        />
      )}

      {yearsModalOpen && activeGroup && (
        <YearsModal
          selected={activeGroup.years}
          onCancel={() => setYearsModalOpen(false)}
          onSave={(years) => { setYears(years); setYearsModalOpen(false); }}
        />
      )}

      {addDimModalOpen && activeGroup && (
        <AddDimensionsModal
          group={activeGroup}
          dimGroups={dimGroups}
          dimsByGroup={dimsByGroup}
          onCancel={() => setAddDimModalOpen(false)}
          onAdd={(codes) => { addDims(codes); setAddDimModalOpen(false); }}
        />
      )}

      {createOpen && (
        <CreateModal
          companyOpts={companyOpts}
          dimGroups={dimGroups}
          dimsByGroup={dimsByGroup}
          metaLoading={metaLoading}
          onCancel={() => setCreateOpen(false)}
          onCreate={handleCreate}
        />
      )}

      <style>{`
        @keyframes spFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .sp-shimmer-btn {
          background: linear-gradient(90deg, ${RED} 0%, ${RED} 40%, #ff5563 50%, ${RED} 60%, ${RED} 100%);
          background-size: 200% 100%;
          animation: spShimmer 3s linear infinite;
        }
        .sp-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .sp-scroll::-webkit-scrollbar-track { background: transparent; }
        .sp-scroll::-webkit-scrollbar-thumb { background: rgba(26,47,138,0.14); border-radius: 4px; }
        .sp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(26,47,138,0.24); }
        .sp-input {
          width: 100%;
          background: rgba(255,255,255,0.65);
          border: 1px solid rgba(26,47,138,0.12);
          border-radius: 12px;
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 600;
          color: ${NAVY_DEEP};
          outline: none;
          transition: all 0.2s ease;
        }
        .sp-input::placeholder { color: rgba(26,47,138,0.3); }
        .sp-input:focus {
          border-color: ${NAVY};
          background: #fff;
          box-shadow: 0 0 0 4px rgba(26,47,138,0.12);
        }
.sp-kicker {
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.22em;
        }
        .sp-glass {
          backdrop-filter: blur(28px) saturate(150%);
          -webkit-backdrop-filter: blur(28px) saturate(150%);
          border: 1px solid rgba(255,255,255,0.75);
          box-shadow: 0 20px 50px -12px rgba(15,31,92,0.28), 0 0 0 1px rgba(255,255,255,0.4) inset;
        }
        .sp-glass-input {
          width: 100%;
          background: rgba(255,255,255,0.55);
          border: 1px solid rgba(26,47,138,0.14);
          border-radius: 14px;
          padding: 12px 16px;
          font-size: 13px;
          font-weight: 700;
          color: ${NAVY_DEEP};
          outline: none;
          transition: all 0.2s ease;
          backdrop-filter: blur(8px);
        }
        .sp-glass-input::placeholder { color: rgba(26,47,138,0.35); }
        .sp-glass-input:focus {
          border-color: ${NAVY};
          background: rgba(255,255,255,0.9);
          box-shadow: 0 0 0 4px rgba(26,47,138,0.14);
        }
        .sp-glass-search {
          background: rgba(255,255,255,0.45);
          border: 1px solid rgba(26,47,138,0.14);
          border-radius: 12px;
          backdrop-filter: blur(8px);
        }
        .sp-glass-row {
          background: rgba(255,255,255,0.35);
          border-radius: 14px;
          border: 1px solid rgba(26,47,138,0.10);
          backdrop-filter: blur(8px);
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LANDING
// ═══════════════════════════════════════════════════════════════
function LandingView({
  groups, groupsLoading, onOpen, onDelete, onCreate,
  query, setQuery, onBlueprintUpload,
}) {
  const filtered = query.trim()
    ? groups.filter(g =>
        g.name.toLowerCase().includes(query.toLowerCase()) ||
        g.companies?.some(c => c.toLowerCase().includes(query.toLowerCase())) ||
        g.dimGroups?.some(d => d.toLowerCase().includes(query.toLowerCase()))
      )
    : groups;

const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer?.types?.includes("Files")) setDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = async (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      alert("Please drop an .xlsx file");
      return;
    }
    setUploading(true);
    try { await onBlueprintUpload(file); }
    finally { setUploading(false); }
  };


  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-4 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
<div className="flex-1 min-h-0 overflow-y-auto sp-scroll pr-1">
        {groupsLoading ? (
          <div className="flex items-center justify-center py-20 gap-2">
            <div className="w-4 h-4 rounded-full border-2 animate-spin"
              style={{ borderColor: "rgba(26,47,138,0.15)", borderTopColor: NAVY }} />
            <span className="text-[13px] font-semibold" style={{ color: NAVY, opacity: 0.6 }}>Loading parties…</span>
          </div>
        ) : groups.length === 0 ? (
          <EmptyState onCreate={onCreate} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[13px] font-semibold" style={{ color: NAVY, opacity: 0.5 }}>
            No parties match "{query}"
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((g, i) => (
              <PartyCard key={g.id} group={g} index={i} onOpen={onOpen} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Drop overlay */}
      {(dragging || uploading) && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl pointer-events-none"
          style={{
            background: `${NAVY}12`,
            border: `2px dashed ${NAVY}`,
            backdropFilter: "blur(6px)",
            animation: "spFade 180ms ease-out",
          }}
        >
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-white"
            style={{ boxShadow: `0 20px 50px -12px ${NAVY}40` }}>
            {uploading ? (
              <>
                <div className="w-8 h-8 rounded-full border-4 animate-spin"
                  style={{ borderColor: `${NAVY}20`, borderTopColor: NAVY }} />
                <span className="text-[13px] font-black uppercase tracking-wider" style={{ color: NAVY }}>
                  Reading blueprint…
                </span>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ background: `${NAVY}0d`, color: NAVY }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <span className="text-[15px] font-black tracking-tight" style={{ color: NAVY_DEEP }}>
                  Drop to create party
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: NAVY, opacity: 0.55 }}>
                  .xlsx blueprint
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 max-w-md mx-auto text-center"
      style={{ animation: "spRise 500ms ease-out both" }}>
      <p className="sp-kicker mb-4" style={{ color: RED }}>Non-financial data</p>
      <h2 className="font-black tracking-tight leading-[1.05] mb-3"
        style={{ color: NAVY_DEEP, fontSize: "clamp(28px, 3vw, 40px)" }}>
        Nothing here yet<span style={{ color: RED }}>.</span>
      </h2>
      <p className="text-[14px] font-medium leading-relaxed mb-8" style={{ color: NAVY, opacity: 0.6 }}>
        Statistical parties track non-financial values — headcount, area, units — across companies, years and dimensions.
      </p>
      <button
        onClick={onCreate}
        className="sp-shimmer-btn flex items-center gap-2 px-5 py-3 rounded-2xl text-white font-black text-[13px] tracking-wide transition-all hover:shadow-xl"
        style={{ boxShadow: `0 14px 36px -10px ${RED}60` }}
      >
        <Plus size={14} strokeWidth={2.8} />
        Create your first party
      </button>
    </div>
  );
}

function PartyCard({ group: g, index, onOpen, onDelete }) {
  const Icon = ICON_MAP[g.icon] ?? BarChart3;
const totalCells = Object.values(g.values).reduce(
    (s, yr) => s + Object.values(yr).reduce((ss, dm) => ss + Object.keys(dm).length, 0), 0);
  const capacity = g.dims.length * 12 * g.years.length;
  const pct = capacity > 0 ? Math.round((totalCells / capacity) * 100) : 0;

// sparkline: sum per month across all years/dims. Resolves formulas via
  // evaluateYear so formula-only cells contribute their computed value
  // instead of 0.
  const monthly = MONTHS.map(() => 0);
  Object.entries(g.values ?? {}).forEach(([, yearVals]) => {
    const computed = evaluateYear(yearVals, g.dims);
    g.dims.forEach(dim => {
      MONTHS.forEach((m, i) => {
        const v = computed[dim]?.[m];
        if (typeof v === "number") monthly[i] += v;
      });
    });
  });
  const maxM = Math.max(...monthly, 1);

  const summarize = (arr) => {
    if (!arr || arr.length === 0) return "—";
    if (arr.length === 1) return arr[0];
    return `${arr[0]} +${arr.length - 1}`;
  };

  return (
    <div
      onClick={() => onOpen(g.id)}
      className="group relative rounded-2xl bg-white overflow-hidden cursor-pointer transition-all"
      style={{
        border: "1px solid rgba(26,47,138,0.10)",
        boxShadow: "0 4px 20px -8px rgba(15,31,92,0.10)",
        animation: `spRise 380ms cubic-bezier(0.34,1.56,0.64,1) ${index * 40}ms both`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = NAVY;
        e.currentTarget.style.boxShadow = `0 16px 40px -12px rgba(26,47,138,0.25)`;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "rgba(26,47,138,0.10)";
        e.currentTarget.style.boxShadow = "0 4px 20px -8px rgba(15,31,92,0.10)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${NAVY}0d`, color: NAVY }}>
              <Icon size={14} strokeWidth={2.2} />
            </div>
            <p className="font-black text-[15px] truncate tracking-tight" style={{ color: NAVY_DEEP }}>
              {g.name}
            </p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDelete(g.id); }}
            className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: `${RED}12`, color: RED }}
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>

        {g.description ? (
          <p className="text-[12px] font-medium leading-snug line-clamp-2 mb-3" style={{ color: NAVY, opacity: 0.6 }}>
            {g.description}
          </p>
        ) : (
          <p className="text-[12px] italic mb-3" style={{ color: NAVY, opacity: 0.3 }}>No description</p>
        )}

        <div className="flex items-center gap-1.5 text-[11px] font-bold mb-3" style={{ color: NAVY, opacity: 0.65 }}>
          <span className="truncate">{summarize(g.companies)}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span className="tabular-nums truncate">{summarize(g.years)}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span className="truncate">{summarize(g.dimGroups)}</span>
        </div>

        <div className="flex items-end gap-[2px] h-7 mb-3">
          {monthly.map((v, i) => (
            <div key={i} className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(8, (v / maxM) * 100)}%`,
                background: v > 0 ? `linear-gradient(180deg, ${NAVY} 0%, ${NAVY}88 100%)` : "rgba(26,47,138,0.06)",
              }} />
          ))}
        </div>

<div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: "rgba(26,47,138,0.08)" }}>
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: NAVY, opacity: 0.5 }}>
            {g.dims.length} {g.dims.length === 1 ? "dim" : "dims"}
            {g.unit && <span className="ml-1.5" style={{ opacity: 0.5 }}>· {g.unit}</span>}
          </span>
          <span className="text-[11px] font-black tabular-nums" style={{ color: pct > 0 ? NAVY : NAVY_DEEP, opacity: pct > 0 ? 1 : 0.4 }}>
            {pct}%
          </span>
        </div>
        {g.creatorName && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold" style={{ color: NAVY, opacity: 0.5 }}>
            <span>By {g.creatorName}</span>
            {g.createdAt && <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{timeAgo(g.createdAt)}</span>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ═══════════════════════════════════════════════════════════════
// DRILL — with a year switcher when multiple years
// ═══════════════════════════════════════════════════════════════
function DrillView({ group, dimsByGroup, onSetCell, onSetCells, locale, year, onYearChange, decimalMode, onRemoveDim, onOpenAddDim }) {
  // Fall back to first year if the parent hasn't picked one yet
  const effectiveYear = year && group.years.includes(year) ? year : (group.years[0] ?? String(new Date().getFullYear()));

  // Merge lookup across selected dim groups
  const nameLookup = useMemo(() => {
    const m = new Map();
    group.dimGroups.forEach(g => {
      const inner = dimsByGroup.get(g);
      if (!inner) return;
      inner.forEach((name, code) => m.set(code, name));
    });
    return m;
  }, [group.dimGroups, dimsByGroup]);

const fmt = (n) => formatNumber(n, decimalMode);

  // Compute displayed values for this year (formulas resolved)
  const yearVals = group.values[effectiveYear] ?? {};
  const computed = useMemo(() => evaluateYear(yearVals, group.dims), [yearVals, group.dims]);

  const monthTotals = MONTHS.map(m => group.dims.reduce((s, d) => s + (computed[d]?.[m] ?? 0), 0));
  const rowTotals   = group.dims.map(d => MONTHS.reduce((s, m) => s + (computed[d]?.[m] ?? 0), 0));

  const maxVal = Math.max(
    ...group.dims.flatMap(d => MONTHS.map(m => computed[d]?.[m] ?? 0)),
    1,
  );

  // ── Editing state ─────────────────────────────────────────
  // While editing, show the raw formula string; on blur, commit.
  const [editing, setEditing] = useState(null); // { dimCode, month }
  const [editingText, setEditingText] = useState("");

  const beginEdit = (dimCode, month) => {
    const cell = yearVals[dimCode]?.[month];
    const raw = cell?.formula ?? (cell?.value != null ? String(cell.value) : "");
    setEditing({ dimCode, month });
    setEditingText(raw);
  };
  const commitEdit = () => {
    if (!editing) return;
    onSetCell(effectiveYear, editing.dimCode, editing.month, editingText);
    setEditing(null);
    setEditingText("");
  };
  const cancelEdit = () => { setEditing(null); setEditingText(""); };

  // ── Fill handle (drag to copy) ───────────────────────────
  // anchor = the source cell; drag = the current furthest cell under the cursor.
  const [fillAnchor, setFillAnchor] = useState(null); // { dimIdx, monthIdx }
  const [fillTarget, setFillTarget] = useState(null); // { dimIdx, monthIdx }

  const isInFillRange = (dimIdx, monthIdx) => {
    if (!fillAnchor || !fillTarget) return false;
    const [d0, d1] = [fillAnchor.dimIdx, fillTarget.dimIdx].sort((a, b) => a - b);
    const [m0, m1] = [fillAnchor.monthIdx, fillTarget.monthIdx].sort((a, b) => a - b);
    return dimIdx >= d0 && dimIdx <= d1 && monthIdx >= m0 && monthIdx <= m1;
  };

const onFillMouseDown = (dimIdx, monthIdx) => (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Capture the anchor + target in refs so listeners see live values (React
    // state setters are async and the mouseup handler would otherwise see
    // stale nulls).
    const anchor = { dimIdx, monthIdx };
    let target = { dimIdx, monthIdx };
    setFillAnchor(anchor);
    setFillTarget(target);

    const onMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el?.closest("[data-cell]");
      if (!cell) return;
      const di = Number(cell.dataset.dimIdx);
      const mi = Number(cell.dataset.monthIdx);
      if (Number.isFinite(di) && Number.isFinite(mi)) {
        target = { dimIdx: di, monthIdx: mi };
        setFillTarget(target);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (target.dimIdx !== anchor.dimIdx || target.monthIdx !== anchor.monthIdx) {
        applyFill(anchor, target);
      }
      setFillAnchor(null);
      setFillTarget(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const applyFill = (anchor, target) => {
    const srcDim = group.dims[anchor.dimIdx];
    const srcMonth = MONTHS[anchor.monthIdx];
    const srcCell = yearVals[srcDim]?.[srcMonth];
    if (srcCell == null) return;

    const [d0, d1] = [anchor.dimIdx, target.dimIdx].sort((a, b) => a - b);
    const [m0, m1] = [anchor.monthIdx, target.monthIdx].sort((a, b) => a - b);

    const writes = [];
    for (let di = d0; di <= d1; di++) {
      for (let mi = m0; mi <= m1; mi++) {
        if (di === anchor.dimIdx && mi === anchor.monthIdx) continue;
        const dimCode = group.dims[di];
        const month = MONTHS[mi];
        let raw;
        if (srcCell.formula) {
          // Shift refs by (di - anchor.dimIdx) rows and (mi - anchor.monthIdx) cols
          raw = shiftFormula(srcCell.formula, mi - anchor.monthIdx, di - anchor.dimIdx, group.dims.length);
        } else {
          raw = String(srcCell.value);
        }
        writes.push({ year: effectiveYear, dimCode, month, raw });
      }
    }
    onSetCells(writes);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="bg-white rounded-2xl flex-1 min-h-0 overflow-hidden flex flex-col"
        style={{ border: "1px solid rgba(26,47,138,0.10)", boxShadow: "0 8px 32px -12px rgba(15,31,92,0.12)" }}>
        <div className="flex-1 overflow-auto sp-scroll" onMouseDown={() => { if (editing) commitEdit(); }}>
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 z-20">
              <tr style={{ background: "rgba(26,47,138,0.04)" }}>
<th className="text-left px-5 py-3 sp-kicker sticky left-0 z-40"
                  style={{
                    color: NAVY,
                    background: "#f2f4fb",
                    minWidth: 240,
                    borderRight: "1px solid rgba(26,47,138,0.06)",
                  }}>
                  Dimension
                </th>
                {MONTHS.map((m, mi) => (
                  <th key={m} className="text-center px-3 py-3 sp-kicker"
                    style={{ color: NAVY, background: "rgba(26,47,138,0.04)" }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{t(locale, `month_${m}`, `month_${m}`).slice(0, 3)}</span>
                      <span className="text-[8px] font-mono opacity-40">{COL_LETTERS[mi]}</span>
                    </div>
                  </th>
                ))}
<th className="text-right px-4 py-3 sp-kicker sticky right-0 z-40"
                  style={{
                    color: NAVY,
                    background: "#f2f4fb",
                    minWidth: 90,
                    borderLeft: "1px solid rgba(26,47,138,0.06)",
                  }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {group.dims.map((code, di) => {
                const name = nameLookup.get(code) ?? code;
                return (
                  <tr key={code} className="border-b hover:bg-[rgba(26,47,138,0.02)]"
                    style={{ borderColor: "rgba(26,47,138,0.06)" }}>
<td className="px-5 py-2 sticky left-0 z-20 group/dim"
                      style={{
                        minWidth: 240,
                        borderRight: "1px solid rgba(26,47,138,0.06)",
                        background: "white",
                      }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold w-5 text-center" style={{ color: NAVY, opacity: 0.35 }}>
                          {di + 1}
                        </span>
                        <span className="text-[10px] font-mono font-bold" style={{ color: NAVY, opacity: 0.4 }}>{code}</span>
                        <span className="text-[13px] font-bold truncate flex-1" style={{ color: NAVY_DEEP }}>{name}</span>
                        <button
                          onClick={() => onRemoveDim(code)}
                          className="opacity-0 group-hover/dim:opacity-100 w-6 h-6 rounded-md flex items-center justify-center transition-all flex-shrink-0"
                          style={{ background: `${RED}12`, color: RED }}
                          title="Remove dimension"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
{MONTHS.map((m, mi) => {
                      const cell = yearVals[code]?.[m];
                      const val = computed[code]?.[m];
                      const hasFormula = !!cell?.formula;
                      const intensity = val && val > 0 ? Math.min(val / maxVal, 1) : 0;
                      const isEditing = editing?.dimCode === code && editing?.month === m;
                      const inFill = isInFillRange(di, mi);
                      const isFilled = val != null;

return (
                        <td key={m} className="p-1 relative group/cell"
                          data-cell="1" data-dim-idx={di} data-month-idx={mi}
                          style={{ width: 100, minWidth: 100 }}>
{isEditing ? (
                            <input
                              autoFocus
                              type="text"
                              value={editingText}
                              onChange={e => setEditingText(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={e => {
                                if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                                else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                              }}
                              className="w-full text-center px-1 py-1.5 rounded-lg font-mono tabular-nums font-black text-[12px] outline-none"
style={{
                                background: "white",
                                border: `1px solid ${NAVY}`,
                                color: NAVY,
minWidth: 84,
                                boxSizing: "border-box",
                                display: "block",
                              }}
                            />
                          ) : (
                            <div
                              onClick={() => beginEdit(code, m)}
                              className="w-full text-center px-1 py-1.5 rounded-lg font-mono tabular-nums font-black text-[12px] cursor-cell relative"
style={{
                                background: inFill
                                  ? `${NAVY}22`
                                  : val !== undefined && val > 0
                                    ? `${NAVY}${Math.round(intensity * 22 + 8).toString(16).padStart(2, "0")}`
                                    : "transparent",
                                border: inFill
                                  ? `1px dashed ${NAVY}`
                                  : "1px solid transparent",
color: val !== undefined && val !== 0 ? NAVY : "rgba(26,47,138,0.25)",
                                minWidth: 84,
                              }}
                            >
                              {val == null ? "—" : fmt(val)}
                              {hasFormula && (
                                <span
                                  className="absolute top-0 right-0 pointer-events-none"
                                  title={cell.formula}
                                  style={{
                                    width: 0, height: 0,
                                    borderTop: `6px solid ${RED}`,
                                    borderLeft: "6px solid transparent",
                                  }}
                                />
                              )}
                            </div>
                          )}
                          {/* Hover-driven fill handle. Lives OUTSIDE the clickable cell div
                              so mousedown doesn't bubble into beginEdit. */}
                          {!isEditing && isFilled && (
                            <span
                              onMouseDown={onFillMouseDown(di, mi)}
                              onClick={e => e.stopPropagation()}
                              className="absolute w-3 h-3 rounded-sm opacity-0 group-hover/cell:opacity-100 transition-opacity"
                              style={{
                                bottom: 2,
                                right: 2,
                                background: NAVY,
                                border: "1.5px solid white",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                                cursor: "crosshair",
                                zIndex: 10,
                              }}
                              title="Drag to fill"
                            />
                          )}
                        </td>
                      );
                    })}
<td className="px-4 py-2 text-right font-mono tabular-nums font-black text-[12px] sticky right-0 z-20"
                      style={{
                        borderLeft: "1px solid rgba(26,47,138,0.06)",
                        color: NAVY,
                        background: "white",
                      }}>
                      {fmt(rowTotals[di])}
                    </td>
                  </tr>
                );
              })}
{/* Add-dimension row */}
<tr className="border-b" style={{ borderColor: "rgba(26,47,138,0.06)" }}>
                <td className="px-5 py-1.5 sticky left-0 z-20"
                  style={{
                    minWidth: 240,
                    borderRight: "1px solid rgba(26,47,138,0.06)",
                    background: "white",
                  }}>
                  <button
                    onClick={onOpenAddDim}
                    className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider transition-colors"
                    style={{ color: NAVY, opacity: 0.55 }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = 1; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; }}
                  >
                    <span className="w-4 h-4 rounded-md flex items-center justify-center" style={{ background: `${NAVY}12` }}>
                      <Plus size={10} strokeWidth={3} />
                    </span>
                    Add dimension
                  </button>
                </td>
                <td colSpan={13} />
              </tr>
<tr className="sticky bottom-0 z-20" style={{ borderTop: `2px solid ${NAVY}`, background: "white" }}>
                <td className="px-5 py-3 sticky left-0 sp-kicker z-30"
                  style={{
                    minWidth: 240,
                    borderRight: "1px solid rgba(26,47,138,0.06)",
                    color: NAVY,
                    background: "white",
                  }}>
                  Total
                </td>
{MONTHS.map((m, i) => (
                  <td key={m} className="px-3 py-3 text-center font-mono tabular-nums font-black text-[12px]"
                    style={{
                      color: monthTotals[i] > 0 ? NAVY_DEEP : "rgba(26,47,138,0.25)",
                      background: "white",
                    }}>
                    {monthTotals[i] === 0 ? "—" : fmt(monthTotals[i])}
                  </td>
                ))}
<td className="px-4 py-3 text-right font-mono tabular-nums font-black text-[14px] sticky right-0 z-30"
                  style={{
                    background: "linear-gradient(135deg, #dee3f5 0%, #edeff8 100%)",
                    borderLeft: "1px solid rgba(26,47,138,0.06)",
                    color: NAVY,
                  }}>
                  {fmt(rowTotals.reduce((s, v) => s + v, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t flex items-center gap-3 text-[10px] font-bold" style={{ borderColor: "rgba(26,47,138,0.08)", color: NAVY, opacity: 0.55 }}>
          <span>Tip: start with <span className="font-mono" style={{ color: RED }}>=</span> for formulas — e.g. <span className="font-mono">=A1*1.05</span>, <span className="font-mono">=SUM(A1:L1)</span></span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Drag the corner of a cell to fill across rows or columns</span>
        </div>
      </div>
    </div>
  );
}



function Meta({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="sp-kicker" style={{ color: NAVY, opacity: 0.5 }}>{label}</span>
      <span className="text-[13px] font-black tracking-tight truncate max-w-[180px]" style={{ color: NAVY_DEEP }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function MetaMulti({ label, values }) {
  const first = values?.[0] ?? "—";
  const extra = values && values.length > 1 ? values.length - 1 : 0;
  return (
    <div className="flex flex-col">
      <span className="sp-kicker" style={{ color: NAVY, opacity: 0.5 }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-black tracking-tight truncate max-w-[140px]" style={{ color: NAVY_DEEP }}>
          {first}
        </span>
        {extra > 0 && (
          <span className="text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md"
            style={{ background: `${NAVY}0d`, color: NAVY }}>
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// YEARS MODAL — quick multi-select of years for an existing party
// ═══════════════════════════════════════════════════════════════
function YearsModal({ selected, onCancel, onSave }) {
  const [picked, setPicked] = useState(selected);
  const toggle = (y) => setPicked(p => p.includes(y) ? p.filter(x => x !== y) : [...p, y].sort());
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(26,47,138,0.32)", backdropFilter: "blur(10px)", animation: "spFade 200ms ease-out" }}
      onClick={onCancel}>
      <div className="bg-white rounded-3xl overflow-hidden"
        style={{ maxWidth: 480, width: "100%", boxShadow: "0 30px 80px -20px rgba(15,31,92,0.4)", animation: "spRise 380ms cubic-bezier(0.34,1.56,0.64,1)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid rgba(26,47,138,0.06)" }}>
          <div>
            <p className="sp-kicker mb-1" style={{ color: RED }}>Edit scope</p>
            <h3 className="font-black tracking-tight leading-none" style={{ color: NAVY_DEEP, fontSize: 22 }}>Years</h3>
          </div>
          <button onClick={onCancel} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(26,47,138,0.06)", color: NAVY }}>
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-2">
            {YEARS.map(y => {
              const active = picked.includes(String(y));
              return (
                <button key={y} onClick={() => toggle(String(y))}
                  className="py-2.5 rounded-xl text-[13px] font-black tabular-nums transition-all"
                  style={{
                    background: active ? NAVY : "rgba(255,255,255,0.65)",
                    color: active ? "white" : NAVY,
                    border: `1px solid ${active ? NAVY : "rgba(26,47,138,0.12)"}`,
                    boxShadow: active ? `0 6px 16px -4px ${NAVY}50` : "none",
                  }}>
                  {y}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-6 py-4 flex items-center gap-3" style={{ background: "rgba(26,47,138,0.03)" }}>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: NAVY, opacity: 0.6 }}>
            {picked.length} selected
          </span>
          <div className="flex-1" />
          <button onClick={onCancel}
            className="px-4 py-2 text-[11px] font-black uppercase tracking-wider rounded-xl"
            style={{ color: NAVY, opacity: 0.7 }}>Cancel</button>
          <button
            onClick={() => onSave(picked)}
            disabled={picked.length === 0}
            className="sp-shimmer-btn px-5 py-2 rounded-xl text-white font-black text-[11px] tracking-wider uppercase disabled:opacity-40"
            style={{ boxShadow: `0 10px 28px -8px ${RED}60` }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADD DIMENSIONS MODAL — pick more dimensions from any group
// ═══════════════════════════════════════════════════════════════
function AddDimensionsModal({ group, dimGroups, dimsByGroup, onCancel, onAdd }) {
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState("");
  const alreadyIn = new Set(group.dims);

  const rows = useMemo(() => {
    const out = [];
    dimGroups.forEach(g => {
      const inner = dimsByGroup.get(g);
      if (!inner) return;
      inner.forEach((name, code) => {
        if (alreadyIn.has(code)) return;
        out.push({ code, name, group: g });
      });
    });
    return out;
  }, [dimGroups, dimsByGroup, group.dims]);

  const filtered = search.trim()
    ? rows.filter(r =>
        r.code.toLowerCase().includes(search.toLowerCase()) ||
        r.name.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const toggle = (code) => setPicked(p => p.includes(code) ? p.filter(x => x !== code) : [...p, code]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(26,47,138,0.32)", backdropFilter: "blur(10px)", animation: "spFade 200ms ease-out" }}
      onClick={onCancel}>
      <div className="bg-white rounded-3xl overflow-hidden flex flex-col"
        style={{ maxWidth: 560, width: "100%", maxHeight: "80vh", boxShadow: "0 30px 80px -20px rgba(15,31,92,0.4)", animation: "spRise 380ms cubic-bezier(0.34,1.56,0.64,1)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(26,47,138,0.06)" }}>
          <div>
            <p className="sp-kicker mb-1" style={{ color: RED }}>Edit scope</p>
            <h3 className="font-black tracking-tight leading-none" style={{ color: NAVY_DEEP, fontSize: 22 }}>Add dimensions</h3>
          </div>
          <button onClick={onCancel} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(26,47,138,0.06)", color: NAVY }}>
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
        <div className="px-6 pt-4 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(26,47,138,0.04)" }}>
            <Search size={12} style={{ color: NAVY, opacity: 0.5 }} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search dimensions"
              className="text-[13px] font-semibold outline-none bg-transparent flex-1"
              style={{ color: NAVY_DEEP }}
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X size={11} style={{ color: NAVY, opacity: 0.5 }} />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto sp-scroll px-3 pb-3">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[12px] font-semibold" style={{ color: NAVY, opacity: 0.4 }}>
              {rows.length === 0 ? "All dimensions already added" : "No matches"}
            </div>
          ) : filtered.map(({ code, name, group: g }, i) => {
            const active = picked.includes(code);
            return (
              <button key={code} onClick={() => toggle(code)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors"
                style={{ background: active ? `${NAVY}0d` : "transparent" }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(26,47,138,0.03)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={{ border: `2px solid ${active ? NAVY : "rgba(26,47,138,0.25)"}`, background: active ? NAVY : "transparent" }}>
                  {active && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] font-mono font-bold" style={{ color: NAVY, opacity: 0.45 }}>{code}</span>
                <span className="text-[13px] font-bold truncate flex-1" style={{ color: NAVY_DEEP }}>{name}</span>
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                  style={{ background: `${NAVY}0d`, color: NAVY }}>{g}</span>
              </button>
            );
          })}
        </div>
        <div className="px-6 py-4 flex items-center gap-3 flex-shrink-0" style={{ background: "rgba(26,47,138,0.03)" }}>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: NAVY, opacity: 0.6 }}>
            {picked.length} selected
          </span>
          <div className="flex-1" />
          <button onClick={onCancel} className="px-4 py-2 text-[11px] font-black uppercase tracking-wider rounded-xl"
            style={{ color: NAVY, opacity: 0.7 }}>Cancel</button>
          <button
            onClick={() => onAdd(picked)}
            disabled={picked.length === 0}
            className="sp-shimmer-btn px-5 py-2 rounded-xl text-white font-black text-[11px] tracking-wider uppercase disabled:opacity-40"
            style={{ boxShadow: `0 10px 28px -8px ${RED}60` }}>
            Add {picked.length > 0 ? `${picked.length}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}


function CreateModal({ companyOpts, dimGroups, dimsByGroup, metaLoading, onCancel, onCreate }) {

  const [draft, setDraft] = useState({
    name: "",
    icon: "chart",
    unit: "",
    description: "",
    companies: [],
    years: [String(new Date().getFullYear())],
    dimGroups: [],
    dims: [],
  });
  const [dimSearch, setDimSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");

  // Auto-select ALL companies when they arrive (only once, and only if the
  // user hasn't touched the selection yet). Selecting all is a much better
  // default than one — for scope like this, "everything" is the common case,
  // and it means the "All" button in MultiHint works even before options load.
  const companyInitDone = useRef(false);
  const userTouchedCompanies = useRef(false);
  useEffect(() => {
    if (companyInitDone.current) return;
    if (companyOpts.length === 0) return;
    if (userTouchedCompanies.current) { companyInitDone.current = true; return; }
    setDraft(d => ({ ...d, companies: companyOpts.map(c => c.value) }));
    companyInitDone.current = true;
  }, [companyOpts]);

  // All dims available across the selected groups
  const availableDims = useMemo(() => {
    if (draft.dimGroups.length === 0) return [];
    const out = [];
    draft.dimGroups.forEach(g => {
      const inner = dimsByGroup.get(g);
      if (!inner) return;
      inner.forEach((name, code) => out.push([code, name, g]));
    });
    return out;
  }, [draft.dimGroups, dimsByGroup]);

  const filteredDims = dimSearch.trim()
    ? availableDims.filter(([code, name]) =>
        code.toLowerCase().includes(dimSearch.toLowerCase()) ||
        name.toLowerCase().includes(dimSearch.toLowerCase())
      )
    : availableDims;

  const filteredCompanies = companySearch.trim()
    ? companyOpts.filter(c =>
        c.label.toLowerCase().includes(companySearch.toLowerCase()) ||
        c.value.toLowerCase().includes(companySearch.toLowerCase())
      )
    : companyOpts;

  const canCreate = draft.name.trim().length > 0
    && draft.companies.length > 0
    && draft.years.length > 0
    && draft.dimGroups.length > 0
    && draft.dims.length > 0;

const toggle = (field, value) => {
    if (field === "companies") userTouchedCompanies.current = true;
    setDraft(d => ({
      ...d,
      [field]: d[field].includes(value) ? d[field].filter(x => x !== value) : [...d[field], value],
    }));
  };

  // When dim groups change, prune dims that no longer belong to any selected group
  useEffect(() => {
    const validCodes = new Set(availableDims.map(([code]) => code));
    setDraft(d => {
      const kept = d.dims.filter(c => validCodes.has(c));
      if (kept.length === d.dims.length) return d;
      return { ...d, dims: kept };
    });
  }, [availableDims]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{
background: "rgba(26,47,138,0.32)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        animation: "spFade 200ms ease-out",
      }}
      onClick={onCancel}
    >
<div
        className="relative w-full overflow-hidden flex flex-col"
        style={{
          maxWidth: "96vw",
          width: "96vw",
          borderRadius: 32,
          height: "96vh",
          maxHeight: "96vh",
background: "transparent",
          boxShadow: "none",
          animation: "spRise 380ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
        onClick={e => e.stopPropagation()}
      >
{/* Header */}
<div className="px-8 py-6 flex items-start justify-between flex-shrink-0 relative z-10">
          <div>
            <p className="sp-kicker mb-2" style={{ color: "#ff7080" }}>New statistical party</p>
            <h3 className="font-black tracking-tight leading-[1.02] text-white"
              style={{ fontSize: 34, letterSpacing: "-0.018em", textShadow: "0 0 40px rgba(255,255,255,0.25)" }}>
              Set up scope<span style={{ color: RED }}>.</span>
            </h3>
            <p className="text-[13px] font-medium mt-2 text-white/75">
              Pick one or more companies, years, and dimensions to track.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all hover:scale-105"
            style={{
              background: "rgba(255,255,255,0.6)",
              color: NAVY,
              border: "1px solid rgba(26,47,138,0.12)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

{/* Body: 3 glass cards */}
        <div className="flex-1 min-h-0 overflow-hidden relative z-10">
          <div className="grid grid-cols-3 gap-5 px-6 pb-2 h-full">
{/* ── CARD 1: Identity — cool white ─────────── */}
            <div className="sp-glass rounded-3xl overflow-hidden flex flex-col min-w-0"
              style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.75) 0%, rgba(232,240,255,0.68) 100%)" }}>
            <div className="p-6 flex-1 min-w-0 overflow-hidden">
              <Section label="Identity">
                <Field label="Name" required>
                  <input
                    autoFocus
                    type="text"
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="Employees, Buildings…"
                    className="sp-input"
                  />
                </Field>
                <Field label="Unit">
                  <input
                    type="text"
                    value={draft.unit}
                    onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))}
                    placeholder="headcount, m²…"
                    className="sp-input"
                  />
                </Field>
                <Field label="Description">
                  <input
                    type="text"
                    value={draft.description}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                    placeholder="Optional"
                    className="sp-input"
                  />
                </Field>
<Field label="Icon">
                  <div className="grid grid-cols-8 gap-1.5">
                    {ICON_KEYS.map(k => {
                      const I = ICON_MAP[k];
                      const active = draft.icon === k;
                      return (
                        <button
                          key={k}
                          onClick={() => setDraft(d => ({ ...d, icon: k }))}
                          className="aspect-square rounded-lg flex items-center justify-center transition-all"
                          style={{
                            background: active ? NAVY : "rgba(255,255,255,0.65)",
                            color: active ? "white" : NAVY,
                            border: `1px solid ${active ? NAVY : "rgba(26,47,138,0.12)"}`,
                            boxShadow: active ? `0 4px 10px -2px ${NAVY}50` : "none",
                          }}
                          title={k}
                        >
                          <I size={14} strokeWidth={2} />
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field
                  label="Years"
                  required
                  right={
                    <MultiHint
                      count={draft.years.length}
                      total={YEARS.length}
                      onAll={() => setDraft(d => ({ ...d, years: YEARS.map(String) }))}
                      onNone={() => setDraft(d => ({ ...d, years: [] }))}
                    />
                  }
                >
                  <div className="grid grid-cols-3 gap-1.5">
                    {YEARS.map(y => {
                      const active = draft.years.includes(String(y));
                      return (
                        <button
                          key={y}
                          onClick={() => toggle("years", String(y))}
                          className="py-2 rounded-xl text-[12px] font-black tabular-nums transition-all"
                          style={{
                            background: active ? NAVY : "rgba(255,255,255,0.65)",
                            color: active ? "white" : NAVY,
                            border: `1px solid ${active ? NAVY : "rgba(26,47,138,0.12)"}`,
                            boxShadow: active ? `0 6px 16px -4px ${NAVY}50` : "none",
                          }}
                        >
                          {y}
                        </button>
                      );
                    })}
                  </div>
</Field>
              </Section>
            </div>
            </div>

            {/* ── CARD 2: Scope — neutral glass ─────────── */}
            <div className="sp-glass rounded-3xl overflow-hidden flex flex-col min-w-0"
              style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.68) 0%, rgba(240,244,255,0.62) 100%)" }}>
            <div className="p-6 flex-1 min-w-0 overflow-y-auto sp-scroll">
              <Section label="Scope">
<Field
                  label="Companies"
                  required
                  right={
                    <MultiHint
                      count={draft.companies.length}
                      total={companyOpts.length}
                      onAll={() => {
                        userTouchedCompanies.current = true;
                        // Use companyOpts (not filteredCompanies) so "All" means
                        // all available, not "all matching the current search".
                        setDraft(d => ({ ...d, companies: companyOpts.map(c => c.value) }));
                      }}
                      onNone={() => {
                        userTouchedCompanies.current = true;
                        setDraft(d => ({ ...d, companies: [] }));
                      }}
                    />
                  }
                >
                  {companyOpts.length > 5 && (
                    <div className="flex items-center gap-2 mb-2 px-3 py-2 sp-glass-search">
                      <Search size={11} style={{ color: NAVY, opacity: 0.5 }} />
                      <input
                        type="text"
                        value={companySearch}
                        onChange={e => setCompanySearch(e.target.value)}
                        placeholder="Search companies"
                        className="text-[12px] font-semibold outline-none bg-transparent flex-1"
                        style={{ color: NAVY_DEEP }}
                      />
                      {companySearch && (
                        <button onClick={() => setCompanySearch("")}>
                          <X size={11} style={{ color: NAVY, opacity: 0.5 }} />
                        </button>
                      )}
                    </div>
                  )}
                  {companyOpts.length === 0 ? (
                    <LoadingOrEmpty metaLoading={metaLoading} label="companies" />
                  ) : filteredCompanies.length > 0 ? (
                    <div className="max-h-[280px] overflow-y-auto sp-scroll sp-glass-row">
                      {filteredCompanies.map((c, i) => {
                        const active = draft.companies.includes(c.value);
                        return (
                          <button
                            key={c.value}
                            onClick={() => toggle("companies", c.value)}
                            className="w-full flex items-center gap-3 px-3.5 py-2 transition-colors text-left"
                            style={{
                              background: active ? `${NAVY}0d` : "transparent",
                              borderTop: i > 0 ? "1px solid rgba(26,47,138,0.06)" : "none",
                            }}
                            onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(26,47,138,0.03)"; }}
                            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                          >
                            <Checkbox active={active} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-black truncate" style={{ color: NAVY_DEEP }}>
                                {c.label}
                              </p>
                            </div>
                            {c.label !== c.value && (
                              <span className="text-[10px] font-mono font-bold" style={{ color: NAVY, opacity: 0.4 }}>
                                {c.value}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyBox>No matches</EmptyBox>
                  )}
                </Field>

</Section>
            </div>
            </div>

            {/* ── CARD 3: Dimensions — warm rose glass ─── */}
            <div className="sp-glass rounded-3xl overflow-hidden flex flex-col min-w-0"
              style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(255,238,242,0.66) 100%)" }}>
            <div className="p-6 flex-1 min-w-0 overflow-y-auto sp-scroll">
              <Section label="Dimensions">
                <Field
                  label="Groups"
                  required
                  right={
                    <MultiHint
                      count={draft.dimGroups.length}
                      total={dimGroups.length}
                      onAll={() => setDraft(d => ({ ...d, dimGroups: [...dimGroups] }))}
                      onNone={() => setDraft(d => ({ ...d, dimGroups: [], dims: [] }))}
                    />
                  }
                >
                  {dimGroups.length === 0 ? (
                    <LoadingOrEmpty metaLoading={metaLoading} label="dimension groups" />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {dimGroups.map(g => {
                        const active = draft.dimGroups.includes(g);
                        const count = dimsByGroup.get(g)?.size ?? 0;
                        return (
                          <button
                            key={g}
                            onClick={() => toggle("dimGroups", g)}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-black transition-all"
                            style={{
                              background: active ? NAVY : "rgba(255,255,255,0.65)",
                              color: active ? "white" : NAVY,
                              border: `1px solid ${active ? NAVY : "rgba(26,47,138,0.12)"}`,
                              boxShadow: active ? `0 6px 16px -4px ${NAVY}50` : "none",
                            }}
                          >
                            <span>{g}</span>
                            <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-md"
                              style={{
                                background: active ? "rgba(255,255,255,0.2)" : `${NAVY}0d`,
                                color: active ? "white" : NAVY,
                              }}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Field>

                <Field
                  label="Dimensions"
                  required
                  right={
                    <MultiHint
                      count={draft.dims.length}
                      total={availableDims.length}
                      onAll={() => setDraft(d => ({ ...d, dims: filteredDims.map(([code]) => code) }))}
                      onNone={() => setDraft(d => ({ ...d, dims: [] }))}
                    />
                  }
                >
                  {draft.dimGroups.length === 0 ? (
                    <EmptyBox>Pick one or more groups first</EmptyBox>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2 px-3 py-2 sp-glass-search">
                        <Search size={11} style={{ color: NAVY, opacity: 0.5 }} />
                        <input
                          type="text"
                          value={dimSearch}
                          onChange={e => setDimSearch(e.target.value)}
                          placeholder="Search dimensions"
                          className="text-[12px] font-semibold outline-none bg-transparent flex-1"
                          style={{ color: NAVY_DEEP }}
                        />
                        {dimSearch && (
                          <button onClick={() => setDimSearch("")}>
                            <X size={11} style={{ color: NAVY, opacity: 0.5 }} />
                          </button>
                        )}
                      </div>
                      <div className="max-h-[340px] overflow-y-auto sp-scroll sp-glass-row">
                        {filteredDims.length === 0 ? (
                          <div className="py-6 text-center text-[12px] font-semibold" style={{ color: NAVY, opacity: 0.4 }}>
                            {dimSearch ? "No matches" : "No dimensions"}
                          </div>
                        ) : filteredDims.map(([code, name, group], i) => {
                          const active = draft.dims.includes(code);
                          return (
                            <button
                              key={code}
                              onClick={() => toggle("dims", code)}
                              className="w-full flex items-center gap-3 px-4 py-2 transition-colors text-left"
                              style={{
                                background: active ? `${NAVY}0d` : "transparent",
                                borderTop: i > 0 ? "1px solid rgba(26,47,138,0.06)" : "none",
                              }}
                              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(26,47,138,0.03)"; }}
                              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                            >
                              <Checkbox active={active} />
                              <span className="text-[10px] font-mono font-bold" style={{ color: NAVY, opacity: 0.45 }}>{code}</span>
                              <span className="text-[13px] font-bold truncate flex-1" style={{ color: NAVY_DEEP }}>{name}</span>
                              {draft.dimGroups.length > 1 && (
                                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                                  style={{ background: `${NAVY}0d`, color: NAVY }}>
                                  {group}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
</Field>
              </Section>
            </div>
            </div>
          </div>
        </div>

{/* Footer */}
        <div
          className="px-8 py-4 flex items-center gap-3 flex-shrink-0 relative z-10 mt-3"
        >
<button
            onClick={onCancel}
            className="px-4 py-2.5 text-[11px] font-black rounded-xl transition-all uppercase tracking-wider hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Cancel
          </button>
          <div className="flex-1" />
          {canCreate ? (
            <span className="text-[11px] font-bold tabular-nums text-white/80">
              {draft.companies.length} co · {draft.years.length} yr · {draft.dimGroups.length} grp · {draft.dims.length} dim
            </span>
          ) : (
            <span className="text-[11px] font-bold text-white/60">
              Fill required fields
            </span>
          )}
          <button
            onClick={() => onCreate(draft)}
            disabled={!canCreate}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-black text-[12px] tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed ${canCreate ? "sp-shimmer-btn hover:shadow-xl" : ""}`}
            style={{
              background: canCreate ? undefined : RED,
              boxShadow: canCreate ? `0 14px 36px -10px ${RED}80` : "none",
            }}
          >
            Create party →
          </button>
        </div>
      </div>
    </div>
  );
}

function Checkbox({ active }) {
  return (
    <div
      className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-all"
      style={{
        border: `2px solid ${active ? NAVY : "rgba(26,47,138,0.25)"}`,
        background: active ? NAVY : "transparent",
      }}
    >
      {active && (
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

function MultiHint({ count, total, onAll, onNone }) {
  return (
    <div className="flex items-center gap-2.5 text-[11px] font-bold">
      <span className="tabular-nums" style={{ color: NAVY, opacity: 0.6 }}>
        {count} / {total}
      </span>
      <span style={{ color: NAVY, opacity: 0.3 }}>·</span>
      <button
        onClick={onAll}
        className="transition-colors font-black uppercase tracking-widest text-[10px]"
        style={{ color: NAVY }}
      >
        All
      </button>
      <button
        onClick={onNone}
        className="transition-colors font-black uppercase tracking-widest text-[10px]"
        style={{ color: NAVY, opacity: 0.5 }}
      >
        None
      </button>
    </div>
  );
}

function LoadingOrEmpty({ metaLoading, label }) {
  return (
    <div className="rounded-xl px-4 py-5 flex items-center justify-center gap-2 text-[12px] font-semibold"
      style={{ background: "rgba(255,255,255,0.6)", border: "1px dashed rgba(26,47,138,0.18)" }}>
      {metaLoading ? (
        <>
          <div className="w-3 h-3 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(26,47,138,0.15)", borderTopColor: NAVY }} />
          <span style={{ color: NAVY, opacity: 0.6 }}>Loading {label}…</span>
        </>
      ) : (
        <span style={{ color: NAVY, opacity: 0.4 }}>No {label} available</span>
      )}
    </div>
  );
}

function EmptyBox({ children }) {
  return (
    <div className="rounded-xl px-4 py-5 text-center text-[12px] font-semibold"
      style={{ background: "rgba(255,255,255,0.6)", border: "1px dashed rgba(26,47,138,0.18)", color: `${NAVY}66` }}>
      {children}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <p className="sp-kicker mb-3" style={{ color: RED }}>
        {label}
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children, span, right }) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: NAVY, opacity: 0.55 }}>
          {label}{required && <span style={{ color: RED, marginLeft: 3 }}>*</span>}
        </label>
        {right}
      </div>
      {children}
    </div>
  );
}