import { useState, useEffect, useRef, useMemo } from "react";
import {
Building2, AlertTriangle, Unlink, Link2, Layers,
  RefreshCw, X, Lock, Unlock, CheckCircle2, XCircle,
  GitBranch, CalendarRange, TrendingUp, Coins,
} from "lucide-react";
import { useSettings, useT } from "./SettingsContext.jsx";
import PageHeader from "./PageHeader.jsx";

const BASE = "";

/* ── Colour system ──────────────────────────────────────────────
   Semantic colours are fixed; the brand family derives from the
   user's primary colour at runtime. Kept restrained and quiet — the
   page reads as a serious tool, not a poster. */
const SEMANTIC = { red: "#e11d48", green: "#059669", amber: "#d97706", gray: "#6b7280" };

function hexToRgba(hex, a) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return `rgba(26,47,138,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function lighten(hex, t) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return "#eef1f8";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const m = (c) => Math.round(c + (255 - c) * t);
  const to2 = (c) => c.toString(16).padStart(2, "0");
  return `#${to2(m(r))}${to2(m(g))}${to2(m(b))}`;
}
function makeTheme(primary) {
  const brand = primary || "#1a2f8a";
  return {
    brand,
    brandL: lighten(brand, 0.92),
    brandM: lighten(brand, 0.55),
    ...SEMANTIC,
  };
}
function useTheme() {
  const { colors } = useSettings();
  return useMemo(() => makeTheme(colors?.primary), [colors?.primary]);
}

const MONTHS_KEYS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

const CCY_COLORS = {
  EUR: "#1a2f8a", USD: "#047857", GBP: "#6d28d9", CNY: "#b45309",
  VND: "#065f46", MAD: "#9a3412", CHF: "#2563eb",
};
const ccyColor = (c) => CCY_COLORS[c] || "#475569";

const TYPE_C = {
  Subsidiary:        { bg: "#eef2fb", text: "#1e40af", dot: "#1e40af" },
  Associate:         { bg: "#fff5e6", text: "#b45309", dot: "#d97706" },
  "Joint operation": { bg: "#f5eefe", text: "#6d28d9", dot: "#8b5cf6" },
};
const typeC = (t) => TYPE_C[t] || { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8" };

const fmt = (n, d = 1) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(n || 0);

function norm(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj)) out[k.charAt(0).toLowerCase() + k.slice(1)] = obj[k];
  return out;
}
function normArr(arr) { return Array.isArray(arr) ? arr.map(norm) : []; }

async function apiFetch(path, token, signal) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
    signal,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  return normArr(json.value ?? (Array.isArray(json) ? json : [json]));
}

const monthFull = (t, idx) => t(`month_${MONTHS_KEYS[idx] ?? "jan"}`);
const monthAbbr = (t, idx) => t(`month_abbr_${MONTHS_KEYS[idx] ?? "jan"}`);

const ownColor = (theme, pct) => (pct < 50 ? theme.red : pct < 80 ? theme.amber : theme.green);

/* ── Small primitives ── */
function Ring({ pct, size = 64, sw = 6, theme }) {
  const r = (size - sw) / 2, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f4" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ownColor(theme, pct)} strokeWidth={sw}
        strokeLinecap="round" strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.4,0,0.2,1)" }} />
    </svg>
  );
}

function TypeBadge({ label }) {
  if (!label) return null;
  const c = typeC(label);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6,
      fontSize: 10, fontWeight: 700, background: c.bg, color: c.text }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot }} />
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   ORG LAYOUT (Reingold–Tilford)
══════════════════════════════════════════════════════════════ */
const NW = 150, NH = 58, HGAP = 28, VGAP = 56;

function computeLayout(nodes) {
  if (!nodes.length) return {};
  const nodeIds = new Set(nodes.map(n => n.id));
  const children = {};
  nodes.forEach(n => { children[n.id] = []; });
  nodes.forEach(n => { if (n.parent && nodeIds.has(n.parent)) children[n.parent].push(n.id); });

  const subtreeW = {};
  function calcW(id) {
    const kids = children[id];
    if (!kids.length) { subtreeW[id] = NW; return NW; }
    const tot = kids.reduce((s, c) => s + calcW(c), 0) + HGAP * (kids.length - 1);
    subtreeW[id] = Math.max(NW, tot);
    return subtreeW[id];
  }
  const roots = nodes.filter(n => !n.parent || !nodeIds.has(n.parent));
  roots.forEach(r => calcW(r.id));

  const pos = {};
  function assign(id, left, depth) {
    const kids = children[id];
    pos[id] = { x: left + (subtreeW[id] - NW) / 2, y: depth * (NH + VGAP) };
    let cl = left;
    kids.forEach(c => { assign(c, cl, depth + 1); cl += subtreeW[c] + HGAP; });
  }
  let rl = 0;
  roots.forEach(r => { assign(r.id, rl, 0); rl += subtreeW[r.id] + HGAP * 2; });
  return pos;
}

function OrgChart({ nodes, positions, selected, onSelect, theme, t }) {
  // Zoom (Ctrl+wheel, toward cursor) + pan (drag). view = {scale, tx, ty}.
  const containerRef = useRef(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef(null); // { startX, startY, tx0, ty0 } while panning
  const [panning, setPanning] = useState(false);

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // only zoom with Ctrl/Cmd held
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView(v => {
      const factor = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.min(2.5, Math.max(0.3, v.scale * factor));
      // keep the point under the cursor fixed while zooming
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx0: view.tx, ty0: view.ty, moved: false };
    setPanning(true);
  };
  const onMouseMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setView(v => ({ ...v, tx: d.tx0 + dx, ty: d.ty0 + dy }));
  };
  const endPan = () => { dragRef.current = null; setPanning(false); };

  if (!nodes.length) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%",
        color: "#9ca3af", fontSize: 12.5, textAlign: "center", padding: 24 }}>
        {t("st_no_hierarchy")}
      </div>
    );
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  const children = {};
  nodes.forEach(n => { children[n.id] = []; });
  nodes.forEach(n => { if (n.parent && nodeIds.has(n.parent)) children[n.parent].push(n.id); });

const edges = [];
  nodes.forEach(n => {
    if (!n.parent || !positions[n.parent] || !positions[n.id]) return;
    const pp = positions[n.parent], cp = positions[n.id];
    const px = pp.x + NW / 2, py = pp.y + NH, cx = cp.x + NW / 2, cy = cp.y;
    const midY = py + (cy - py) / 2;
    const active = selected && (n.id === selected || n.parent === selected);
    edges.push(
      <path key={`${n.parent}-${n.id}`}
        d={`M ${px} ${py} C ${px} ${midY}, ${cx} ${midY}, ${cx} ${cy}`}
        fill="none" stroke={active ? theme.brand : "#d5dae4"} strokeWidth={active ? 2 : 1.25} />
    );
  });

return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
      style={{ width: "100%", height: "100%", overflow: "hidden",
        cursor: panning ? "grabbing" : "grab", userSelect: "none" }}>
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
        <g>{edges}</g>
        {nodes.map(n => {
          const p = positions[n.id]; if (!p) return null;
          const isSel = n.id === selected;
          const owPct = n.ownership || 0;
          const cc = ccyColor(n.currency);
          return (
    <g key={n.id} onClick={() => { if (!dragRef.current?.moved) onSelect(n.id === selected ? null : n.id); }} style={{ cursor: "pointer" }}>
              <rect x={p.x} y={p.y} width={NW} height={NH} rx={9}
                fill="#fff" stroke={isSel ? theme.brand : "#e5e8ef"} strokeWidth={isSel ? 1.75 : 1} />
         {/* Left brand rail: left corners rounded to the card radius (9),
                  right side square — so it sits flush inside the rounded card. */}
              <path
                d={`M ${p.x + 6} ${p.y}
                    L ${p.x + 9} ${p.y}
                    A 9 9 0 0 0 ${p.x} ${p.y + 9}
                    L ${p.x} ${p.y + NH - 9}
                    A 9 9 0 0 0 ${p.x + 9} ${p.y + NH}
                    L ${p.x + 6} ${p.y + NH}
                    Z`}
                fill={isSel ? theme.brand : cc}
              />
              <text x={p.x + 15} y={p.y + 22} textAnchor="start" fill="#1e293b" fontSize={13} fontWeight={800}
                fontFamily='"Inter","Helvetica Neue",sans-serif'>{n.id}</text>
              <text x={p.x + 15} y={p.y + 38} textAnchor="start" fill="#94a3b8" fontSize={9.5} fontWeight={500}
                fontFamily='"Inter","Helvetica Neue",sans-serif'>
                {(n.label || "").length > 20 ? (n.label || "").slice(0, 18) + "…" : n.label}
              </text>
              <text x={p.x + 15} y={p.y + 51} textAnchor="start" fill="#94a3b8" fontSize={9} fontWeight={700} fontFamily="monospace">{n.currency}</text>
              {owPct > 0 && (
                <text x={p.x + NW - 12} y={p.y + 51} textAnchor="end" fill={ownColor(theme, owPct)} fontSize={11} fontWeight={800} fontFamily="monospace">
                  {Math.round(owPct)}%
                </text>
              )}
              {!n.consolidate && <circle cx={p.x + NW - 11} cy={p.y + 13} r={4} fill={theme.red} stroke="#fff" strokeWidth={1.5} />}
              {n.detached && <circle cx={p.x + NW - (n.consolidate ? 11 : 23)} cy={p.y + 13} r={4} fill={theme.amber} stroke="#fff" strokeWidth={1.5} />}
</g>
          );
        })}
        </g>
      </svg>
    </div>
  );
}

/* ── Detail slide-in panel ── */
function DetailPanel({ node, companies, ownership, groupStructure, onClose, theme, t }) {
  const co = node ? companies.find(c => c.companyShortName === node.id) : null;
  const ow = node ? ownership.find(o => o.companyShortName === node.id) : null;
  const gs = node ? groupStructure.filter(g => g.companyShortName === node.id) : [];
  const open = !!(node && co);

  const metaRow = (k, v) => (
    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f3f7" }}>
      <span style={{ fontSize: 11, color: theme.gray }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b" }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 280,
      background: "#fff", borderLeft: "1px solid #e5e8ef", borderRadius: "0 12px 12px 0",
      transform: open ? "translateX(0)" : "translateX(105%)",
      transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
      display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 10,
      boxShadow: "-8px 0 24px rgba(15,23,42,0.06)",
    }}>
      {open && co && (
        <>
          <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid #f1f3f7", flexShrink: 0, position: "relative" }}>
            <button onClick={onClose} style={{ position: "absolute", top: 12, right: 12, background: "#f1f3f7",
              border: "none", borderRadius: 7, width: 26, height: 26, cursor: "pointer", color: theme.gray,
              display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingRight: 30 }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: theme.brandL, display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: theme.brand }}>{(co.companyShortName || "").slice(0, 4)}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "#1e293b", margin: 0, lineHeight: 1.25 }}>{co.companyShortName}</p>
                <p style={{ fontSize: 10.5, color: theme.gray, margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.companyLegalName}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {co.recognizeAs && <TypeBadge label={co.recognizeAs} />}
              {co.currencyCode && (
                <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "#f1f5f9", color: "#475569", fontFamily: "monospace" }}>{co.currencyCode}</span>
              )}
              <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                background: co.consolidate ? "#ecfdf5" : "#fef2f2", color: co.consolidate ? "#047857" : "#b91c1c" }}>
                {co.consolidate ? t("st_consolidated") : t("st_not_consolidated")}
              </span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {ow && (
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Ring pct={ow.ownershipPercentage || 0} size={60} sw={6} theme={theme} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: ownColor(theme, ow.ownershipPercentage || 0) }}>
                      {Math.round(ow.ownershipPercentage || 0)}%
                    </span>
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em", margin: 0 }}>{t("st_ownership")}</p>
                  {ow.fromMonth && ow.fromYear && (
                    <p style={{ fontSize: 12, color: "#334155", margin: "5px 0 2px", fontWeight: 600 }}>{t("st_since")} {monthFull(t, (ow.fromMonth || 1) - 1)} {ow.fromYear}</p>
                  )}
                  {(ow.toYear && ow.toYear > 0)
                    ? <p style={{ fontSize: 10.5, color: theme.red, margin: 0 }}>{t("st_until")} {monthFull(t, (ow.toMonth || 1) - 1)} {ow.toYear}</p>
                    : <p style={{ fontSize: 10.5, color: theme.green, margin: 0 }}>{t("st_open_ended")}</p>}
                </div>
              </div>
            )}

            <div>
              <p style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em", margin: "0 0 6px" }}>{t("st_consolidation")}</p>
              {[
                [t("st_method"), co.accountingPrinciple],
                [t("st_associates"), co.accountingPrincipleAssociates],
                [t("st_mapping"), co.mappingName],
                [t("st_type"), co.type],
                [t("st_from"), co.consolidate && co.consolidateFromMonth ? `${monthFull(t, (co.consolidateFromMonth || 1) - 1)} ${co.consolidateFromYear}` : null],
              ].filter(([, v]) => v).map(([k, v]) => metaRow(k, v))}
            </div>

            {gs.length > 0 && (
              <div>
                <p style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.12em", margin: "0 0 6px" }}>{t("st_in_structures")}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {gs.map(g => (
                    <div key={g.groupStructure} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: "#f8fafc", borderRadius: 8, padding: "7px 10px", border: "1px solid #eef1f6" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {g.detached ? <Unlink size={11} color={theme.amber} /> : g.parentShortName ? <Link2 size={11} color={theme.green} /> : <Layers size={11} color={theme.brand} />}
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#334155" }}>{g.groupStructure}</span>
                      </div>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: g.detached ? "#b45309" : g.parentShortName ? theme.brand : "#047857" }}>
                        {g.detached ? t("st_detached") : g.parentShortName ? `↑ ${g.parentShortName}` : t("st_root")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Detached panel ── */
function DetachedPanel({ detached, ownership, selected, onSelect, theme, t }) {
  if (!detached.length) return null;
  return (
    <div style={{ width: 196, flexShrink: 0, display: "flex", flexDirection: "column",
      background: "#fff", borderRadius: 12, border: "1px solid #e5e8ef", overflow: "hidden" }}>
      <div style={{ padding: "11px 14px", borderBottom: "1px solid #f1f3f7", flexShrink: 0, display: "flex", alignItems: "center", gap: 7 }}>
        <Unlink size={12} color={theme.amber} />
        <p style={{ fontSize: 9.5, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>{t("st_detached")}</p>
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: theme.amber, background: "#fff7ed", padding: "1px 7px", borderRadius: 10 }}>{detached.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
        {detached.map(n => {
          const ow = ownership.find(o => o.companyShortName === n.id);
          const isSel = selected === n.id;
          const owPct = n.ownership || 0;
          return (
            <div key={n.id} onClick={() => onSelect(isSel ? null : n.id)}
              style={{ padding: "9px 11px", borderRadius: 9, cursor: "pointer",
                border: `1px solid ${isSel ? theme.brand : "#eef1f6"}`, background: isSel ? theme.brandL : "#fff", transition: "all 0.12s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ow ? 7 : 0 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: ccyColor(n.currency),
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff" }}>{(n.id || "").slice(0, 3)}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: isSel ? theme.brand : "#1e293b", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.id}</p>
                  <span style={{ fontSize: 9, color: theme.gray, fontFamily: "monospace" }}>{n.currency}</span>
                </div>
              </div>
              {ow && (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ flex: 1, height: 4, background: "#eef0f4", borderRadius: 9999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${owPct}%`, background: ownColor(theme, owPct), borderRadius: 9999 }} />
                  </div>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: ownColor(theme, owPct) }}>{fmt(owPct)}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildNodes(groupStructure, structKey, companies, ownership) {
  return groupStructure.filter(r => r.groupStructure === structKey).map(r => {
    const co = companies.find(c => c.companyShortName === r.companyShortName);
    const ow = ownership.find(o => o.companyShortName === r.companyShortName);
    return {
      id: r.companyShortName,
      label: r.companyLegalName || r.companyShortName,
      parent: r.parentShortName || null,
      detached: r.detached,
      currency: r.currencyCode,
      type: co?.recognizeAs || "Subsidiary",
      ownership: ow?.ownershipPercentage || 0,
      consolidate: co?.consolidate ?? true,
    };
  });
}

/* ── TAB: ORG TREE ── */
function GraphTab({ nodes, companies, ownership, groupStructure, selected, onSelect, theme, t }) {
  const connected = useMemo(() => nodes.filter(n => !n.detached), [nodes]);
  const detached = useMemo(() => nodes.filter(n => n.detached), [nodes]);
  const positions = useMemo(() => computeLayout(connected), [connected]);
  const selNode = selected ? nodes.find(n => n.id === selected) : null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
      <div style={{ flex: 1, position: "relative", background: "#fbfcfe", borderRadius: 12,
        border: "1px solid #e5e8ef", overflow: "hidden" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.6, zIndex: 0 }}>
          <defs><pattern id="grid-dots" x="0" y="0" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#dfe4ec" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#grid-dots)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, height: "100%" }}>
          <OrgChart nodes={connected} positions={positions} selected={selected} onSelect={onSelect} theme={theme} t={t} />
        </div>
        <DetailPanel node={selNode} companies={companies} ownership={ownership} groupStructure={groupStructure} onClose={() => onSelect(null)} theme={theme} t={t} />
      </div>
      <DetachedPanel detached={detached} ownership={ownership} selected={selected} onSelect={onSelect} theme={theme} t={t} />
    </div>
  );
}

/* ── TAB: COMPANIES (compact table) ── */
function CompaniesTab({ companies, ownership, structKey, groupStructure, search = "", theme, t }) {
  const structCompanies = structKey
    ? companies.filter(c => groupStructure.some(g => g.groupStructure === structKey && g.companyShortName === c.companyShortName))
    : companies;
  const filtered = structCompanies.filter(c => !search ||
    (c.companyShortName || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.companyLegalName || "").toLowerCase().includes(search.toLowerCase()));

  const th = { textAlign: "left", padding: "9px 14px", fontWeight: 800, color: "#94a3b8", fontSize: 9.5,
    textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" };
  const td = { padding: "10px 14px", verticalAlign: "middle" };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e8ef", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #eef1f6", background: "#fafbfd" }}>
              <th style={th}>{t("st_col_short_name")}</th>
              <th style={th}>{t("st_col_ownership")}</th>
              <th style={th}>{t("st_col_type")}</th>
              <th style={{ ...th, textAlign: "center" }}>{t("st_col_currency")}</th>
              <th style={{ ...th, textAlign: "center" }}>{t("st_col_consolidate")}</th>
              <th style={th}>{t("st_col_from")}</th>
              <th style={th}>{t("st_col_mapping")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const ow = ownership?.find(o => o.companyShortName === c.companyShortName);
              const pct = ow?.ownershipPercentage || 0;
              const toYear = ow?.toYear && ow.toYear > 0;
              return (
                <tr key={i} style={{ borderBottom: i === filtered.length - 1 ? "none" : "1px solid #f4f6f9" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#fafbfd"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, background: ccyColor(c.currencyCode),
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff" }}>{(c.companyShortName || "").slice(0, 3)}</span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, fontWeight: 800, color: "#1e293b", margin: 0 }}>{c.companyShortName}</p>
                        <p style={{ fontSize: 10.5, color: theme.gray, margin: "1px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{c.companyLegalName}</p>
                      </div>
                    </div>
                  </td>
                  <td style={td}>
                    {ow ? (
                      <div style={{ minWidth: 150 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 3 }}>
                          <div style={{ flex: 1, height: 5, background: "#eef0f4", borderRadius: 9999, overflow: "hidden", maxWidth: 110 }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: ownColor(theme, pct), borderRadius: 9999 }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 800, color: ownColor(theme, pct), minWidth: 38 }}>{fmt(pct)}%</span>
                        </div>
                        <div style={{ fontSize: 9, color: "#94a3b8" }}>
                          {ow.fromMonth && ow.fromYear && <span>{t("st_from")} {monthAbbr(t, (ow.fromMonth || 1) - 1)} {ow.fromYear}</span>}
                          {toYear ? <span style={{ color: theme.red }}> · {t("st_until")} {monthAbbr(t, (ow.toMonth || 1) - 1)} {ow.toYear}</span> : <span style={{ color: theme.green }}> · {t("st_open")}</span>}
                        </div>
                      </div>
                    ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={td}>{c.type || c.recognizeAs ? <TypeBadge label={c.type || c.recognizeAs} /> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: "#f1f5f9", color: "#475569", fontFamily: "monospace" }}>{c.currencyCode}</span>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {c.consolidate
                      ? <CheckCircle2 size={15} color={theme.green} style={{ display: "inline" }} />
                      : <XCircle size={15} color="#cbd5e1" style={{ display: "inline" }} />}
                  </td>
                  <td style={{ ...td, color: theme.gray, whiteSpace: "nowrap", fontSize: 11 }}>
                    {c.consolidateFromMonth && c.consolidateFromYear ? `${monthAbbr(t, (c.consolidateFromMonth || 1) - 1)} ${c.consolidateFromYear}` : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ ...td, color: theme.gray, fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.mappingName || <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 13 }}>{t("st_no_data")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── TAB: PERIODS ── */
function PeriodsTab({ periods, filterStruct = "all", filterSource = "all", theme, t }) {
  const filtered = periods.filter(p =>
    (filterStruct === "all" || p.groupStructure === filterStruct) &&
    (filterSource === "all" || p.source === filterSource));
  const closed = filtered.filter(p => p.closed).length;
  const open = filtered.filter(p => !p.closed).length;
  const byYear = filtered.reduce((acc, p) => { const y = p.year ?? "?"; (acc[y] = acc[y] || []).push(p); return acc; }, {});
  const years = Object.keys(byYear).sort((a, b) => b - a);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: theme.red, fontWeight: 700 }}><Lock size={11} /> {t("st_n_closed").replace("{n}", closed)}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: theme.green, fontWeight: 700 }}><Unlock size={11} /> {t("st_n_open").replace("{n}", open)}</span>
      </div>
      {years.map(year => {
        const yp = byYear[year];
        const monthMap = Object.fromEntries(yp.map(p => [p.month, p]));
        return (
          <div key={year} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e8ef", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f3f7", display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>{year}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{t("st_n_periods").replace("{n}", yp.length)}</span>
            </div>
            <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 5 }}>
              {MONTHS_KEYS.map((mKey, idx) => {
                const m = idx + 1;
                const p = monthMap[m];
                const mName = monthAbbr(t, idx);
                return (
                  <div key={m} title={p ? `${monthFull(t, idx)} ${year} · ${p.source ?? ""} · ${p.closed ? t("st_closed") : t("st_open_label")}` : `${monthFull(t, idx)} — ${t("st_no_data")}`}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "7px 2px", borderRadius: 8,
                      background: !p ? "#fafbfd" : p.closed ? "#fef2f2" : "#f0fdf4",
                      border: `1px solid ${!p ? "#eef1f6" : p.closed ? "#fecaca" : "#bbf7d0"}` }}>
                    <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: !p ? "#cbd5e1" : p.closed ? theme.red : theme.green }}>{mName}</span>
                    {p ? (p.closed ? <Lock size={10} color={theme.red} /> : <Unlock size={10} color={theme.green} />) : <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#e2e8f0" }} />}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "0 16px 12px", display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...new Set(yp.map(p => p.source).filter(Boolean))].map(src => <span key={src} style={{ padding: "2px 8px", borderRadius: 6, fontSize: 9, fontWeight: 700, background: "#f1f5f9", color: theme.gray }}>{src}</span>)}
              {[...new Set(yp.map(p => p.groupStructure).filter(Boolean))].map(gs => <span key={gs} style={{ padding: "2px 8px", borderRadius: 6, fontSize: 9, fontWeight: 700, background: theme.brandL, color: theme.brand }}>{gs}</span>)}
            </div>
          </div>
        );
      })}
      {years.length === 0 && <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e8ef", padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 13 }}>{t("st_no_period_data")}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function StructurePage({ token, structures: sharedStructures = [], companies: sharedCompanies = [] }) {
  const theme = useTheme();
  const t = useT();

  const [raw, setRaw] = useState({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [tab, setTab] = useState("tree");
  const [structKey, setStructKey] = useState(null);
  const [selected, setSelected] = useState(null);
const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [periodStruct, setPeriodStruct] = useState("all");
  const [periodSource, setPeriodSource] = useState("all");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) { setLoading(true); setErrors({}); } });
    const ctrl = new AbortController();
    const eps = [
      { key: "groupStructure", path: "/v2/group-structure" },
      { key: "companies", path: "/v2/companies" },
      { key: "currencies", path: "/v2/currencies" },
      { key: "ownership", path: "/v2/ownership" },
      { key: "settings", path: "/v2/group-settings" },
      { key: "periods", path: "/v2/periods" },
      { key: "structures", path: "/v2/structures" },
    ];
    Promise.allSettled(eps.map(({ path }) => apiFetch(path, token, ctrl.signal))).then(results => {
      if (ctrl.signal.aborted || cancelled) return;
      const out = {}, errs = {};
      results.forEach((r, i) => { if (r.status === "fulfilled") out[eps[i].key] = r.value; else errs[eps[i].key] = r.reason?.message || "error"; });
      setRaw(out);
      setErrors(errs);
      setStructKey(prev => {
        const structs = out.structures || [];
        if (structs.find(s => s.groupStructure === prev)) return prev;
        return structs[0]?.groupStructure || out.groupStructure?.[0]?.groupStructure || null;
      });
      setLoading(false);
    });
    return () => { cancelled = true; ctrl.abort(); };
  }, [token, tick]);

  const companies = raw.companies?.length ? raw.companies : sharedCompanies;
  const { groupStructure = [], ownership = [], periods = [], structures = sharedStructures } = raw;
  const nodes = structKey ? buildNodes(groupStructure, structKey, companies, ownership) : [];

  const consolidatedCount = companies.filter(c => c.consolidate).length;
  const detachedCount = nodes.filter(n => n.detached).length;
  const ccys = [...new Set(companies.map(c => c.currencyCode).filter(Boolean))];
  const avgOwn = ownership.length ? ownership.reduce((s, o) => s + (o.ownershipPercentage || 0), 0) / ownership.length : 0;

const stats = [
    { icon: Building2,   label: t("st_kpi_companies"),     value: companies.length,  sub: t("st_kpi_consolidated").replace("{n}", consolidatedCount),                                                        accent: theme.brand },
    { icon: TrendingUp,  label: t("st_kpi_avg_ownership"), value: `${fmt(avgOwn)}%`, sub: t("st_kpi_wholly_owned").replace("{n}", ownership.filter(o => (o.ownershipPercentage || 0) >= 100).length),  accent: avgOwn >= 75 ? theme.green : theme.amber },
    { icon: Coins,       label: t("st_kpi_currencies"),    value: ccys.length,       sub: ccys.slice(0, 4).join(" · ") + (ccys.length > 4 ? " …" : ""),                                                     accent: theme.brand },
    { icon: Unlink,      label: t("st_kpi_detached"),      value: detachedCount,     sub: t("st_kpi_outside_structure"),                                                                                     accent: detachedCount > 0 ? theme.amber : theme.green, warn: detachedCount > 0 },
  ];
  const headerTabs = [
    { id: "tree",      label: t("st_tab_tree"),      icon: GitBranch },
    { id: "companies", label: t("st_tab_companies"), icon: Building2 },
    { id: "periods",   label: t("st_tab_periods"),   icon: CalendarRange },
  ];

// Header filters depend on the active tab.
  //  · tree / companies → structure switcher (when >1 structure exists)
  //  · periods          → structure + source filters (moved out of the tab)
  const structFilter = structures.length > 1
    ? [{
        label: t("st_col_short_name"),
        value: structKey || "",
        onChange: (v) => { setStructKey(v); setSelected(null); },
        options: structures.map(s => ({ value: s.groupStructure, label: `${s.groupStructure}${s.isDefault ? " ★" : ""}` })),
      }]
    : [];

  const periodStructOpts = ["all", ...new Set(periods.map(p => p.groupStructure).filter(Boolean))];
  const periodSourceOpts = ["all", ...new Set(periods.map(p => p.source).filter(Boolean))];
  const periodFilters = [
    {
      label: t("st_all_structures"),
      value: periodStruct,
      onChange: setPeriodStruct,
      options: periodStructOpts.map(s => ({ value: s, label: s === "all" ? t("st_all_structures") : s })),
    },
    {
      label: t("st_all_sources"),
      value: periodSource,
      onChange: setPeriodSource,
      options: periodSourceOpts.map(s => ({ value: s, label: s === "all" ? t("st_all_sources") : s })),
    },
  ];

  const headerFilters = tab === "periods" ? periodFilters : structFilter;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, fontFamily: '"Inter","Helvetica Neue",sans-serif' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Shared page header (title, kicker, tabs, filters) ── */}
      <PageHeader
        kicker={t("st_kicker")}
        title={t("st_title")}
        tabs={headerTabs}
        activeTab={tab}
        onTabChange={(v) => { setTab(v); setSelected(null); }}
        filters={headerFilters}
        showAllFilters
        headerSearch={tab === "companies" ? { value: search, onChange: setSearch, placeholder: t("st_search_companies") } : undefined}
        headerActions={[{ icon: RefreshCw, label: t("st_refresh"), onClick: () => setTick(x => x + 1) }]}
      />

{/* ── KPI cards ── */}
      {!loading && (
        <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #e5e8ef", borderRadius: 14,
              padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.11em" }}>{s.label}</span>
                <div style={{ width: 28, height: 28, borderRadius: 9, background: hexToRgba(s.accent, 0.1),
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <s.icon size={14} color={s.accent} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 26, fontWeight: 900, color: s.warn ? theme.amber : "#1e293b", lineHeight: 1, letterSpacing: "-0.02em" }}>{s.value}</div>
                <div style={{ fontSize: 10.5, color: theme.gray, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: `2.5px solid ${theme.brand}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <p style={{ fontSize: 12, color: theme.gray, margin: 0 }}>{t("st_loading")}</p>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!loading && (
        <>
          {tab === "tree" && <GraphTab nodes={nodes} companies={companies} ownership={ownership} groupStructure={groupStructure} selected={selected} onSelect={setSelected} theme={theme} t={t} />}
          {tab === "companies" && <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}><CompaniesTab companies={companies} ownership={ownership} structKey={structKey} groupStructure={groupStructure} search={search} theme={theme} t={t} /></div>}
        {tab === "periods" && <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}><PeriodsTab periods={periods} filterStruct={periodStruct} filterSource={periodSource} theme={theme} t={t} /></div>}
        </>
      )}

      {/* ── Errors ── */}
      {Object.entries(errors).length > 0 && !loading && (
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {Object.entries(errors).map(([k, e]) => (
            <div key={k} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 13px", fontSize: 11, color: theme.red, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={11} /> {k}: {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}