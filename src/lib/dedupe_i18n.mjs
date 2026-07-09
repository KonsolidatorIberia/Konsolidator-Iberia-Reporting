// Usage: node dedupe_i18n.mjs src/lib/i18n.js
import { readFileSync, writeFileSync } from "fs";

const path = process.argv[2];
if (!path) { console.error("usage: node dedupe_i18n.mjs <path>"); process.exit(1); }

const src = readFileSync(path, "utf8");
const lines = src.split("\n");

// Walk the file tracking brace depth. We consider a "locale block" to be the
// top-level object under `translations = { en: {...}, es: {...}, ... }`.
// Within each locale block we track which keys we've already seen and mark
// the earlier occurrences for removal (keep last).
const keyPat = /^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;

// First pass: build a map of localeStart -> Map<key, [lineIdx, ...]>
const localeStarts = []; // { start, end, keyLines: Map<key, number[]> }
let depth = 0;
let inTranslations = false;
let currentLocale = null; // { startLine, name, keyLines }

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Detect start of translations object
  if (!inTranslations && /const\s+translations\s*=\s*\{/.test(line)) {
    inTranslations = true;
    depth = 1;
    continue;
  }
  if (!inTranslations) continue;

  // Detect locale block start: e.g.  "en: {"
  if (depth === 1 && !currentLocale) {
    const m = line.match(/^\s*(en|es|da|pt)\s*:\s*\{/);
    if (m) {
      currentLocale = { name: m[1], startLine: i, keyLines: new Map() };
      depth = 2;
      continue;
    }
  }

  // Inside a locale block: track keys
  if (currentLocale && depth === 2) {
    const m = line.match(keyPat);
    if (m) {
      const key = m[2];
      if (!currentLocale.keyLines.has(key)) currentLocale.keyLines.set(key, []);
      currentLocale.keyLines.get(key).push(i);
    }
  }

  // Track braces to know when the locale ends
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;
  depth += opens - closes;

  if (currentLocale && depth <= 1) {
    localeStarts.push(currentLocale);
    currentLocale = null;
  }
  if (inTranslations && depth <= 0) break;
}

// Build set of line indices to delete: for each key with >1 occurrence, keep the LAST
const toDelete = new Set();
let totalDupes = 0;
for (const loc of localeStarts) {
  let dupesHere = 0;
  for (const [key, idxs] of loc.keyLines) {
    if (idxs.length > 1) {
      // Delete all but the last
      for (let i = 0; i < idxs.length - 1; i++) {
        toDelete.add(idxs[i]);
        dupesHere++;
      }
    }
  }
  console.log(`  ${loc.name}: ${dupesHere} duplicate lines removed`);
  totalDupes += dupesHere;
}

const outLines = lines.filter((_, i) => !toDelete.has(i));
writeFileSync(path, outLines.join("\n"));
console.log(`\nTotal: ${totalDupes} duplicate key lines removed from ${path}`);