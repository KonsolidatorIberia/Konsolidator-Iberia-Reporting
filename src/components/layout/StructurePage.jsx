import { useState, useEffect, useRef, useMemo } from "react";
import {
  Building2, Globe, AlertTriangle, Unlink, Link2,
  Layers, Percent, TrendingUp, GitBranch,
  RefreshCw, X, Lock, Unlock, MapPin, Mail, Phone,
  Hash, Users, Calendar, CheckCircle2, XCircle,
} from "lucide-react";

const BASE = "";

const T = {
  navy:  "#1a2f8a",
  navyL: "#e8ecf8",
  navyM: "#3d5adb",
  red:   "#e8394a",
  green: "#10b981",
  amber: "#f59e0b",
  gray:  "#6b7280",
};

const MONTHS      = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CCY_COLORS = {
  EUR: { bg: "#1a2f8a", border: "#3d5adb" },
  USD: { bg: "#14532d", border: "#166534" },
  GBP: { bg: "#3b0764", border: "#6d28d9" },
  CNY: { bg: "#7c3400", border: "#b45309" },
  VND: { bg: "#064e3b", border: "#065f46" },
  MAD: { bg: "#7c2d12", border: "#9a3412" },
  CHF: { bg: "#1e3a5f", border: "#2563eb" },
};
const ccyColor = (c) => CCY_COLORS[c] || { bg: "#374151", border: "#6b7280" };

const TYPE_C = {
  Subsidiary:        { bg: "#e8ecf8", text: "#1a2f8a", dot: "#1a2f8a" },
  Associate:         { bg: "#fef3e2", text: "#b45309", dot: "#f59e0b" },
  "Joint operation": { bg: "#f3e8ff", text: "#6d28d9", dot: "#8b5cf6" },
};
const typeC = (t) => TYPE_C[t] || { bg: "#f3f4f6", text: "#374151", dot: "#9ca3af" };

const fmt = (n, d = 1) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(n || 0);

/* ─── normalize: handle PascalCase or camelCase API responses ─── */
function norm(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const lo = k.charAt(0).toLowerCase() + k.slice(1);
    out[lo] = obj[k];
  }
  return out;
}
function normArr(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(norm);
}

/* ─── fetch helper ─── */
async function apiFetch(path, token, signal) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-cache" },
    signal,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  return normArr(json.value ?? (Array.isArray(json) ? json : [json]));
}

/* ─── AnimBar ─── */
function AnimBar({ pct, color, h = 5 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.width = "0%";
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => { if (ref.current) ref.current.style.width = pct + "%"; })
    );
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div style={{ width: "100%", height: h, background: "#f0f0f0", borderRadius: 9999, overflow: "hidden" }}>
      <div ref={ref} style={{ height: "100%", background: color, borderRadius: 9999, width: "0%", transition: "width 0.75s cubic-bezier(0.34,1.56,0.64,1)" }} />
    </div>
  );
}

/* ─── Ownership Ring ─── */
function Ring({ pct, size = 72, sw = 7 }) {
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const color = pct < 50 ? T.red : pct < 80 ? T.amber : T.green;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        style={{ transition: "stroke-dasharray 0.85s cubic-bezier(0.34,1.56,0.64,1)" }}
      />
    </svg>
  );
}

/* ─── Badge ─── */
function Badge({ label, color, tiny }) {
  if (!label) return null;
  return (
    <span style={{
      background: color.bg, color: color.text || "#fff", borderRadius: 20,
      fontWeight: 700, whiteSpace: "nowrap",
      fontSize: tiny ? 9 : 10, padding: tiny ? "1px 5px" : "2px 7px",
      display: "inline-flex", alignItems: "center", gap: 3,
    }}>
      {color.dot && (
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color.dot, flexShrink: 0 }} />
      )}
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   ORG LAYOUT  (Reingold–Tilford)
══════════════════════════════════════════════════════════════ */
const NW = 160, NH = 72, HGAP = 36, VGAP = 80;

function computeLayout(nodes) {
  if (!nodes.length) return {};
  const nodeIds  = new Set(nodes.map(n => n.id));
  const children = {};
  nodes.forEach(n => { children[n.id] = []; });
  nodes.forEach(n => {
    if (n.parent && nodeIds.has(n.parent)) children[n.parent].push(n.id);
  });

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

/* ─── SVG Org Chart ─── */
function OrgChart({ nodes, positions, selected, onSelect }) {
  if (!nodes.length) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: T.gray, fontSize: 13 }}>
        No hierarchy data — companies may not have parent relationships configured.
      </div>
    );
  }

  const nodeIds  = new Set(nodes.map(n => n.id));
  const children = {};
  nodes.forEach(n => { children[n.id] = []; });
  nodes.forEach(n => { if (n.parent && nodeIds.has(n.parent)) children[n.parent].push(n.id); });

  const allPos = Object.values(positions);
  const totalW = Math.max(...allPos.map(p => p.x)) + NW + 40;
  const totalH = Math.max(...allPos.map(p => p.y)) + NH + 40;

  const edges = [];
  nodes.forEach(n => {
    if (!n.parent || !positions[n.parent] || !positions[n.id]) return;
    const pp = positions[n.parent], cp = positions[n.id];
    const px = pp.x + NW / 2, py = pp.y + NH;
    const cx = cp.x + NW / 2, cy = cp.y;
    const midY = py + (cy - py) / 2;
    const active = selected && (n.id === selected || n.parent === selected);
    edges.push(
      <path key={`${n.parent}-${n.id}`}
        d={`M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`}
        fill="none" stroke={active ? T.navyM : "rgba(107,114,128,0.28)"}
        strokeWidth={active ? 2.5 : 1.5}
      />
    );
  });

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 24 }}>
      <svg width={totalW} height={totalH} style={{ display: "block", minWidth: totalW }}>
        <g>{edges}</g>
        {nodes.map(n => {
          const p = positions[n.id]; if (!p) return null;
          const isSel  = n.id === selected;
          const cc     = ccyColor(n.currency);
          const owPct  = n.ownership || 0;
          const owCol  = owPct < 50 ? T.red : owPct < 80 ? T.amber : T.green;

          return (
            <g key={n.id} onClick={() => onSelect(n.id === selected ? null : n.id)} style={{ cursor: "pointer" }}>
              {isSel && (
                <rect x={p.x - 3} y={p.y - 3} width={NW + 6} height={NH + 6}
                  rx={8} fill="none" stroke={T.navyM} strokeWidth={2.5} opacity={0.7} />
              )}
              <rect x={p.x} y={p.y} width={NW} height={NH} rx={6}
                fill={isSel ? T.navy : cc.bg}
                stroke={isSel ? T.navyM : cc.border}
                strokeWidth={isSel ? 2 : 1.5}
              />
{/* ownership % text */}
              {owPct > 0 && (
                <text x={p.x + NW / 2} y={p.y + NH - 6} textAnchor="middle" dominantBaseline="middle"
                  fill={owCol} fontSize={12} fontWeight={600} fontFamily="monospace">
                  {Math.round(owPct)}%
                </text>
              )}
              {/* not-consolidated dot */}
              {!n.consolidate && (
                <circle cx={p.x + 9} cy={p.y + 9} r={4.5} fill={T.red} stroke="#fff" strokeWidth={1.5} />
              )}
              {/* detached dot */}
              {n.detached && (
                <circle cx={p.x + NW - 9} cy={p.y + 9} r={4.5} fill={T.amber} stroke="#fff" strokeWidth={1.5} />
              )}
{/* short name */}
              <text x={p.x + NW / 2} y={p.y + 26} textAnchor="middle" dominantBaseline="middle"
                fill="#fff" fontSize={14} fontWeight={800}
                fontFamily='"Inter","Helvetica Neue",sans-serif'>
                {n.id}
              </text>
              {/* legal name */}
              <text x={p.x + NW / 2} y={p.y + 46} textAnchor="middle" dominantBaseline="middle"
                fill="rgba(255,255,255,0.65)" fontSize={12} fontWeight={400}
                fontFamily='"Inter","Helvetica Neue",sans-serif'>
                {(n.label || "").length > 22 ? (n.label || "").slice(0, 20) + "…" : n.label}
              </text>
              {/* currency */}
              <text x={p.x + NW - 6} y={p.y + NH - 9} textAnchor="end" dominantBaseline="middle"
                fill="rgba(255,255,255,0.4)" fontSize={12} fontWeight={600} fontFamily="monospace">
                {n.currency}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ─── Detail slide-in panel ─── */
function DetailPanel({ node, companies, ownership, groupStructure, onClose }) {
  const co   = node ? companies.find(c => c.companyShortName === node.id) : null;
  const ow   = node ? ownership.find(o => o.companyShortName === node.id) : null;
  const gs   = node ? groupStructure.filter(g => g.companyShortName === node.id) : [];
  const open = !!(node && co);

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 284,
      background: "rgba(255,255,255,0.97)", backdropFilter: "blur(16px)",
      borderLeft: "1px solid rgba(26,47,138,0.1)",
      borderRadius: "0 16px 16px 0",
      transform: open ? "translateX(0)" : "translateX(110%)",
      transition: "transform 0.38s cubic-bezier(0.34,1.56,0.64,1)",
      display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 10,
      boxShadow: "-4px 0 24px rgba(26,47,138,0.1)",
    }}>
      {open && co && (
        <>
          <div style={{ background: T.navy, padding: "18px 16px 14px", position: "relative", flexShrink: 0 }}>
            <button onClick={onClose} style={{
              position: "absolute", top: 10, right: 10,
              background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 7,
              width: 26, height: 26, cursor: "pointer", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><X size={13} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Building2 size={18} color="#fff" />
              </div>
              <div>
                <p style={{ color: "#fff", fontWeight: 800, fontSize: 12, margin: 0, lineHeight: 1.3 }}>{co.companyLegalName}</p>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, margin: "3px 0 0", fontFamily: "monospace" }}>{co.companyShortName}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {co.recognizeAs && <Badge label={co.recognizeAs}  color={{ bg: "rgba(255,255,255,0.18)", text: "#fff" }} />}
              {co.currencyCode && <Badge label={co.currencyCode} color={{ bg: "rgba(255,255,255,0.13)", text: "#fff" }} />}
              <Badge label={co.consolidate ? "Consolidated" : "Not consolidated"}
                color={co.consolidate
                  ? { bg: "rgba(16,185,129,0.22)", text: "#6ee7b7" }
                  : { bg: "rgba(232,57,74,0.22)",  text: "#fca5a5" }} />
              {node.detached && <Badge label="Detached" color={{ bg: "rgba(245,158,11,0.25)", text: "#fcd34d" }} />}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {ow && (
              <div style={{ background: "#f8f9ff", borderRadius: 12, padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Ring pct={ow.ownershipPercentage || 0} size={64} sw={6} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: (ow.ownershipPercentage || 0) < 50 ? T.red : (ow.ownershipPercentage || 0) < 80 ? T.amber : T.green }}>
                      {Math.round(ow.ownershipPercentage || 0)}%
                    </span>
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: T.gray, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>Ownership</p>
                  {ow.fromMonth && ow.fromYear && (
                    <p style={{ fontSize: 12, color: "#374151", margin: "4px 0 2px" }}>
                      Since {MONTH_FULL[(ow.fromMonth || 1) - 1]} {ow.fromYear}
                    </p>
                  )}
                  {(ow.toYear && ow.toYear > 0)
                    ? <p style={{ fontSize: 10, color: T.red, margin: 0 }}>Until {MONTH_FULL[(ow.toMonth || 1) - 1]} {ow.toYear}</p>
                    : <p style={{ fontSize: 10, color: T.green, margin: 0 }}>Open-ended</p>
                  }
                </div>
              </div>
            )}

            <div style={{ background: "#f8f9ff", borderRadius: 12, padding: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: T.gray, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Consolidation</p>
              {[
                ["Method",     co.accountingPrinciple],
                ["Associates", co.accountingPrincipleAssociates],
                ["Mapping",    co.mappingName],
                ["Type",       co.type],
                ["From",       co.consolidate && co.consolidateFromMonth
                  ? `${MONTH_FULL[(co.consolidateFromMonth || 1) - 1]} ${co.consolidateFromYear}` : null],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #ebebeb" }}>
                  <span style={{ fontSize: 11, color: T.gray }}>{k}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1f2937" }}>{v}</span>
                </div>
              ))}
            </div>

            {gs.length > 0 && (
              <div style={{ background: "#f8f9ff", borderRadius: 12, padding: 14 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: T.gray, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>In Structures</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {gs.map(g => (
                    <div key={g.groupStructure} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", borderRadius: 8, padding: "6px 10px", border: "1px solid #ebebeb" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        {g.detached ? <Unlink size={10} color={T.amber} /> : g.parentShortName ? <Link2 size={10} color={T.green} /> : <Layers size={10} color={T.navy} />}
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#374151" }}>{g.groupStructure}</span>
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 9999,
                        background: g.detached ? "#fef3e2" : g.parentShortName ? T.navyL : "#ecfdf5",
                        color: g.detached ? "#b45309" : g.parentShortName ? T.navy : "#065f46",
                      }}>
                        {g.detached ? "Detached" : g.parentShortName ? `↑ ${g.parentShortName}` : "Root"}
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

/* ─── Detached side panel ─── */
function DetachedPanel({ detached, companies, ownership, selected, onSelect }) {
  if (!detached.length) return null;
  return (
    <div style={{
      width: 204, flexShrink: 0, display: "flex", flexDirection: "column",
      background: "#fffbf0", borderRadius: 16, border: `1.5px dashed ${T.amber}80`, overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid #f5e6c0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Unlink size={13} color={T.amber} />
          <p style={{ fontSize: 10, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>Detached</p>
        </div>
        <p style={{ fontSize: 9, color: T.gray, margin: "3px 0 0" }}>
          {detached.length} node{detached.length !== 1 ? "s" : ""} outside hierarchy
        </p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
        {detached.map(n => {
          const ow    = ownership.find(o => o.companyShortName === n.id);
          const isSel = selected === n.id;
          const cc    = ccyColor(n.currency);
          const owPct = n.ownership || 0;
          const owCol = owPct < 50 ? T.red : owPct < 80 ? T.amber : T.green;
          return (
            <div key={n.id} onClick={() => onSelect(isSel ? null : n.id)}
              style={{
                padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                border: `1.5px solid ${isSel ? T.navy : "#e9d8a6"}`,
                background: isSel ? T.navyL : "#fff", transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: ow ? 7 : 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: 7, flexShrink: 0, background: isSel ? T.navy : cc.bg, border: `2px solid ${cc.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: "#fff" }}>{n.id}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: isSel ? T.navy : "#1f2937", margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</p>
                  <span style={{ fontSize: 9, color: T.gray, fontFamily: "monospace" }}>{n.currency}</span>
                </div>
              </div>
              {ow && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: T.gray }}>Ownership</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: owCol }}>{fmt(owPct)}%</span>
                  </div>
                  <AnimBar pct={owPct} color={owCol} h={3} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   BUILD NODES
══════════════════════════════════════════════════════════════ */
function buildNodes(groupStructure, structKey, companies, ownership) {
  return groupStructure
    .filter(r => r.groupStructure === structKey)
    .map(r => {
      const co = companies.find(c => c.companyShortName === r.companyShortName);
      const ow = ownership.find(o => o.companyShortName === r.companyShortName);
      return {
        id:          r.companyShortName,
        label:       r.companyLegalName || r.companyShortName,
        parent:      r.parentShortName  || null,
        detached:    r.detached,
        currency:    r.currencyCode,
        type:        co?.recognizeAs    || "Subsidiary",
        ownership:   ow?.ownershipPercentage || 0,
        consolidate: co?.consolidate    ?? true,
      };
    });
}

/* ══════════════════════════════════════════════════════════════
   TAB: ORG TREE
══════════════════════════════════════════════════════════════ */
function GraphTab({ nodes, companies, ownership, groupStructure, selected, onSelect }) {
  const connected = useMemo(() => nodes.filter(n => !n.detached), [nodes]);
  const detached  = useMemo(() => nodes.filter(n =>  n.detached), [nodes]);
  const positions = useMemo(() => computeLayout(connected), [connected]);
  const selNode   = selected ? nodes.find(n => n.id === selected) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* legend */}


      {/* chart area */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
        <div style={{
          flex: 1, position: "relative",
          background: "linear-gradient(140deg,#f4f6ff 0%,#eef1ff 60%,#f8f4ff 100%)",
          borderRadius: 20, border: "1px solid #e0e6ff", overflow: "hidden",
        }}>
         {/* dot grid */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.35, zIndex: 0 }}>
            <defs>
              <pattern id="grid-dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#a5b4fc" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-dots)" />
          </svg>

         <div style={{ position: "relative", zIndex: 1, height: "100%" }}>
            <OrgChart nodes={connected} positions={positions} selected={selected} onSelect={onSelect} />
          </div>

          <DetailPanel
            node={selNode} companies={companies}
            ownership={ownership} groupStructure={groupStructure}
            onClose={() => onSelect(null)}
          />
        </div>

        <DetachedPanel
          detached={detached} companies={companies}
          ownership={ownership} selected={selected} onSelect={onSelect}
        />
      </div>

    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: COMPANIES
══════════════════════════════════════════════════════════════ */
function CompaniesTab({ companies, ownership, structKey, groupStructure, search = "" }) {
  const structCompanies = structKey
    ? companies.filter(c => groupStructure.some(g => g.groupStructure === structKey && g.companyShortName === c.companyShortName))
    : companies;
  const filtered = structCompanies.filter(c =>
    !search ||
    (c.companyShortName || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.companyLegalName  || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>


      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: `${T.navy}08`, borderBottom: "1px solid #f0f0f0" }}>
                {["#", "SHORT NAME", "LEGAL NAME", "CURRENCY", "OWNERSHIP", "TYPE", "CONSOLIDATE", "FROM", "MAPPING", "RECOGNIZE AS"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontWeight: 800, color: T.navy, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const ow    = ownership?.find(o => o.companyShortName === c.companyShortName);
                const pct   = ow?.ownershipPercentage || 0;
                const owCol = pct < 50 ? T.red : pct < 80 ? T.amber : T.green;
                const toYear = ow?.toYear && ow.toYear > 0;
                return (
                  <tr key={i}
                    style={{ borderBottom: "1px solid #f5f5f5", background: i % 2 ? "#fafafa" : "#fff", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0f4ff"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "#fafafa" : "#fff"}
                  >
                    <td style={{ padding: "10px 14px", color: "#d1d5db", fontSize: 10, fontFamily: "monospace" }}>{i + 1}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ display: "inline-flex", padding: "3px 8px", borderRadius: 8, fontSize: 11, fontWeight: 800, background: T.navyL, color: T.navy }}>{c.companyShortName}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.companyLegalName}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ padding: "2px 7px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "#f3f4f6", color: "#374151", fontFamily: "monospace" }}>{c.currencyCode}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {ow ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 5, background: "#f0f0f0", borderRadius: 9999, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: owCol, borderRadius: 9999 }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 800, color: owCol, minWidth: 34 }}>{fmt(pct)}%</span>
                          </div>
                          <div style={{ display: "flex", gap: 6, fontSize: 9, color: T.gray }}>
                            {ow.fromMonth && ow.fromYear && (
                              <span>From {MONTH_FULL[(ow.fromMonth || 1) - 1].slice(0, 3)} {ow.fromYear}</span>
                            )}
                            {toYear
                              ? <span style={{ color: T.red }}>· Until {MONTH_FULL[(ow.toMonth || 1) - 1].slice(0, 3)} {ow.toYear}</span>
                              : <span style={{ color: T.green }}>· Open</span>
                            }
                          </div>
                        </div>
                      ) : <span style={{ color: "#e5e7eb" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {c.type ? <Badge label={c.type} color={typeC(c.type)} tiny /> : <span style={{ color: "#e5e7eb" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {c.consolidate
                        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#10b981", fontSize: 10, fontWeight: 700 }}><CheckCircle2 size={12} /> Yes</span>
                        : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#d1d5db", fontSize: 10 }}><XCircle size={12} /> No</span>
                      }
                    </td>
                    <td style={{ padding: "10px 14px", color: T.gray, whiteSpace: "nowrap" }}>
                      {c.consolidateFromMonth && c.consolidateFromYear
                        ? `${MONTH_FULL[(c.consolidateFromMonth || 1) - 1].slice(0, 3)} ${c.consolidateFromYear}`
                        : <span style={{ color: "#e5e7eb" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px", color: T.gray }}>{c.mappingName || <span style={{ color: "#e5e7eb" }}>—</span>}</td>
<td style={{ padding: "10px 14px" }}>
                      {c.recognizeAs ? <Badge label={c.recognizeAs} color={typeC(c.recognizeAs)} tiny /> : <span style={{ color: "#e5e7eb" }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: OWNERSHIP
══════════════════════════════════════════════════════════════ */
function OwnershipTab({ ownership, companies }) {
  const avgOwn = ownership.length
    ? ownership.reduce((s, o) => s + (o.ownershipPercentage || 0), 0) / ownership.length
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          { icon: Percent,    label: "Ownership records",  value: ownership.length, color: "#7c3aed", bg: "#f0ebff" },
          { icon: TrendingUp, label: "Avg ownership",      value: `${fmt(avgOwn)}%`, color: T.green, bg: "#e6f5f0" },
          { icon: Users,      label: "Fully owned (100%)", value: ownership.filter(o => (o.ownershipPercentage || 0) >= 100).length, color: T.navy, bg: T.navyL },
        ].map((k, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 16, padding: "14px 18px", border: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: k.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <k.icon size={16} color={k.color} />
            </div>
            <div>
              <p style={{ fontSize: 22, fontWeight: 900, color: k.color, margin: 0, lineHeight: 1 }}>{k.value}</p>
              <p style={{ fontSize: 10, color: T.gray, margin: "3px 0 0" }}>{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f0ff", borderBottom: "1px solid #f0f0f0" }}>
                {["#", "COMPANY", "LEGAL NAME", "OWNERSHIP %", "FROM", "TO"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontWeight: 800, color: "#7c3aed", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...ownership].sort((a, b) => (b.ownershipPercentage || 0) - (a.ownershipPercentage || 0)).map((o, i) => {
                const pct   = o.ownershipPercentage || 0;
                const color = pct < 50 ? T.red : pct < 80 ? T.amber : T.green;
                return (
                  <tr key={i}
                    style={{ borderBottom: "1px solid #f5f5f5", background: i % 2 ? "#fafafa" : "#fff", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f9f5ff"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "#fafafa" : "#fff"}
                  >
                    <td style={{ padding: "10px 14px", color: "#d1d5db", fontSize: 10, fontFamily: "monospace" }}>{i + 1}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ display: "inline-flex", padding: "3px 8px", borderRadius: 8, fontSize: 11, fontWeight: 800, background: "#f5f0ff", color: "#7c3aed" }}>{o.companyShortName}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.companyLegalName}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 80, height: 5, background: "#f0f0f0", borderRadius: 9999, overflow: "hidden", flexShrink: 0 }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 9999 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color }}>{fmt(pct)}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", color: T.gray, whiteSpace: "nowrap" }}>
                      {o.fromMonth && o.fromYear
                        ? `${MONTH_FULL[(o.fromMonth || 1) - 1].slice(0, 3)} ${o.fromYear}`
                        : <span style={{ color: "#e5e7eb" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      {(o.toYear && o.toYear > 0)
                        ? <span style={{ color: T.red }}>{MONTH_FULL[(o.toMonth || 1) - 1].slice(0, 3)} {o.toYear}</span>
                        : <span style={{ color: T.green, fontStyle: "italic" }}>Open</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: GROUP SETTINGS
══════════════════════════════════════════════════════════════ */
function GroupSettingsTab({ settings, currencies }) {
  const s = settings?.[0] ?? {};
  const rows = (icon, label, val) => ({ icon, label, val });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Identity */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
          <div style={{ background: T.navyL, padding: "12px 18px", borderBottom: "1px solid #e0e6f8", display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={15} color={T.navy} />
            <span style={{ fontSize: 11, fontWeight: 800, color: T.navy, textTransform: "uppercase", letterSpacing: "0.07em" }}>Group Identity</span>
          </div>
          <div style={{ padding: "2px 18px 12px" }}>
            {[
              [<MapPin size={12} color={T.gray} />,   "Address",    s.address],
              [<MapPin size={12} color={T.gray} />,   "City / ZIP", s.city ? `${s.city}${s.zipCode ? ", " + s.zipCode : ""}` : null],
              [<Globe  size={12} color={T.gray} />,   "Country",    s.country ? `${s.country}${s.countryCode ? " (" + s.countryCode + ")" : ""}` : null],
              [<Hash   size={12} color={T.gray} />,   "VAT",        s.vat],
              [<Calendar size={12} color={T.gray} />, "Period End", s.periodEnd ? MONTH_FULL[s.periodEnd - 1] : null],
            ].map(([icon, label, val], i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: "1px solid #f5f5f5" }}>
                <div style={{ marginTop: 2, flexShrink: 0 }}>{icon}</div>
                <div>
                  <p style={{ fontSize: 9, fontWeight: 800, color: T.gray, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{label}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#1f2937", margin: "3px 0 0" }}>
                    {val || <span style={{ color: "#d1d5db", fontStyle: "italic", fontWeight: 400 }}>—</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
          <div style={{ background: "#e6f5f0", padding: "12px 18px", borderBottom: "1px solid #b6ddd2", display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={15} color={T.green} />
            <span style={{ fontSize: 11, fontWeight: 800, color: T.green, textTransform: "uppercase", letterSpacing: "0.07em" }}>Contact</span>
          </div>
          <div style={{ padding: "2px 18px 12px" }}>
            {[
              [<Users size={12} color={T.gray} />, "Name",  s.contactName],
              [<Phone size={12} color={T.gray} />, "Phone", s.contactPhone],
              [<Mail  size={12} color={T.gray} />, "Email", s.contactEmail],
            ].map(([icon, label, val], i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: "1px solid #f5f5f5" }}>
                <div style={{ marginTop: 2, flexShrink: 0 }}>{icon}</div>
                <div>
                  <p style={{ fontSize: 9, fontWeight: 800, color: T.gray, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{label}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#1f2937", margin: "3px 0 0" }}>
                    {val || <span style={{ color: "#d1d5db", fontStyle: "italic", fontWeight: 400 }}>—</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {currencies.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
          <div style={{ background: "#f5f0ff", padding: "12px 18px", borderBottom: "1px solid #e0d8ff", display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={15} color="#7c3aed" />
            <span style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.07em" }}>Available Currencies</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: T.gray }}>{currencies.length} currencies</span>
          </div>
          <div style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {currencies.map(c => (
              <div key={c.currencyCode} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 10, border: "1px solid #f0f0f0", background: "#fafafa" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#1f2937", fontFamily: "monospace" }}>{c.currencyCode}</span>
                <span style={{ fontSize: 11, color: T.gray }}>{c.currencyName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: PERIODS
══════════════════════════════════════════════════════════════ */
function PeriodsTab({ periods }) {
  const [filterStruct, setFilterStruct] = useState("all");
  const [filterSource, setFilterSource] = useState("all");

  const structOpts = ["all", ...new Set(periods.map(p => p.groupStructure).filter(Boolean))];
  const sourceOpts = ["all", ...new Set(periods.map(p => p.source).filter(Boolean))];

  const filtered = periods.filter(p =>
    (filterStruct === "all" || p.groupStructure === filterStruct) &&
    (filterSource === "all" || p.source === filterSource)
  );

  const closed = filtered.filter(p =>  p.closed).length;
  const open   = filtered.filter(p => !p.closed).length;

  const byYear = filtered.reduce((acc, p) => {
    const y = p.year ?? "?";
    if (!acc[y]) acc[y] = [];
    acc[y].push(p);
    return acc;
  }, {});
  const years = Object.keys(byYear).sort((a, b) => b - a);

  const sel = { fontSize: 11, border: "1px solid #e5e7eb", borderRadius: 10, padding: "7px 12px", background: "#fff", color: "#374151", outline: "none", cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <select value={filterStruct} onChange={e => setFilterStruct(e.target.value)} style={sel}>
          {structOpts.map(s => <option key={s} value={s}>{s === "all" ? "All structures" : s}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={sel}>
          {sourceOpts.map(s => <option key={s} value={s}>{s === "all" ? "All sources" : s}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: T.red, fontWeight: 700 }}>
            <Lock size={11} /> {closed} closed
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: T.green, fontWeight: 700 }}>
            <Unlock size={11} /> {open} open
          </span>
        </div>
      </div>

      {years.map(year => {
        const yp = byYear[year];
        const monthMap = Object.fromEntries(yp.map(p => [p.month, p]));
        return (
          <div key={year} style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
            <div style={{ background: T.navyL, padding: "10px 18px", borderBottom: "1px solid #e0e6f8", display: "flex", alignItems: "center", gap: 8 }}>
              <Calendar size={14} color={T.navy} />
              <span style={{ fontSize: 12, fontWeight: 800, color: T.navy }}>{year}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: T.gray }}>{yp.length} period{yp.length !== 1 ? "s" : ""}</span>
            </div>
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 6 }}>
              {MONTHS.map((mName, idx) => {
                const m = idx + 1;
                const p = monthMap[m];
                return (
                  <div key={m}
                    title={p ? `${MONTH_FULL[idx]} ${year} · ${p.source ?? ""} · ${p.closed ? "Closed" : "Open"}` : `${MONTH_FULL[idx]} — no data`}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      padding: "8px 2px", borderRadius: 10,
                      background: !p ? "#f9fafb" : p.closed ? "#fff1f2" : "#f0fdf4",
                      border: `1.5px solid ${!p ? "#f3f4f6" : p.closed ? T.red + "30" : T.green + "30"}`,
                    }}>
                    <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: !p ? "#d1d5db" : p.closed ? T.red : T.green }}>
                      {mName}
                    </span>
                    {p
                      ? p.closed
                        ? <Lock size={11} color={T.red} />
                        : <Unlock size={11} color={T.green} />
                      : <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#e5e7eb" }} />
                    }
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "0 16px 12px", display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...new Set(yp.map(p => p.source).filter(Boolean))].map(src => (
                <span key={src} style={{ padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: "#f3f4f6", color: T.gray }}>{src}</span>
              ))}
              {[...new Set(yp.map(p => p.groupStructure).filter(Boolean))].map(gs => (
                <span key={gs} style={{ padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: T.navyL, color: T.navy }}>{gs}</span>
              ))}
            </div>
          </div>
        );
      })}

      {years.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", padding: 48, textAlign: "center", color: "#d1d5db", fontSize: 13 }}>
          No period data available
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function StructurePage({
  token,
  structures: sharedStructures = [],
  companies:  sharedCompanies  = [],
}) {
  const [raw,       setRaw]       = useState({});
  const [loading,   setLoading]   = useState(true);
  const [errors,    setErrors]    = useState({});
  const [tab,       setTab]       = useState("tree");
  const [structKey, setStructKey] = useState(null);
const [selected,  setSelected]  = useState(null);
  const [tick,      setTick]      = useState(0);
  const [search,    setSearch]    = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setErrors({});
    const ctrl = new AbortController();

    const eps = [
      { key: "groupStructure", path: "/v2/group-structure" },
      { key: "companies",      path: "/v2/companies"       },
      { key: "currencies",     path: "/v2/currencies"      },
      { key: "ownership",      path: "/v2/ownership"       },
      { key: "settings",       path: "/v2/group-settings"  },
      { key: "periods",        path: "/v2/periods"         },
      { key: "structures",     path: "/v2/structures"      },
    ];

    Promise.allSettled(
      eps.map(({ path }) => apiFetch(path, token, ctrl.signal))
    ).then(results => {
      if (ctrl.signal.aborted) return;
      const out = {}, errs = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled") out[eps[i].key] = r.value;
        else errs[eps[i].key] = r.reason?.message || "error";
      });
      setRaw(out);
      setErrors(errs);
      setStructKey(prev => {
        const structs = out.structures || [];
        if (structs.find(s => s.groupStructure === prev)) return prev;
        // try to auto-detect from groupStructure list
        const fromGs = out.groupStructure?.[0]?.groupStructure;
        return structs[0]?.groupStructure || fromGs || null;
      });
      setLoading(false);
    });

    return () => ctrl.abort();
  }, [token, tick]);

  const companies = raw.companies?.length ? raw.companies : sharedCompanies;
  const {
    groupStructure = [],
    currencies     = [],
    ownership      = [],
    settings       = [],
    periods        = [],
    structures     = sharedStructures,
  } = raw;

  const nodes = structKey ? buildNodes(groupStructure, structKey, companies, ownership) : [];

  const consolidatedCount = companies.filter(c => c.consolidate).length;
  const detachedCount     = nodes.filter(n => n.detached).length;
  const ccys              = [...new Set(companies.map(c => c.currencyCode).filter(Boolean))];
  const avgOwn            = ownership.length
    ? ownership.reduce((s, o) => s + (o.ownershipPercentage || 0), 0) / ownership.length
    : 0;

  const TABS = [
    { key: "tree",      label: "Org Tree",       count: groupStructure.filter(g => g.groupStructure === structKey).length, color: T.navy    },
{ key: "companies", label: "Companies",      count: companies.length,                                                   color: "#0e7c5b" },
    { key: "periods",   label: "Periods",        count: periods.length,                                                     color: T.red     },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, height: "100%", minHeight: 0 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: T.navy, margin: 0, lineHeight: 1 }}>Structure</h1>
          <p style={{ fontSize: 13, color: T.gray, margin: "5px 0 0" }}>Group hierarchy, ownership, periods &amp; settings.</p>
        </div>
        <button
          onClick={() => setTick(t => t + 1)}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "8px 16px",
            borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff",
            cursor: loading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700,
            color: T.gray, opacity: loading ? 0.5 : 1, transition: "all 0.15s",
          }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.color = T.navy; e.currentTarget.style.borderColor = T.navy + "40"; }}}
          onMouseLeave={e => { e.currentTarget.style.color = T.gray; e.currentTarget.style.borderColor = "#e5e7eb"; }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>

      {/* KPI cards */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, flexShrink: 0 }}>
          {[
            { icon: Building2,     label: "Companies",     value: companies.length,  sub: `${consolidatedCount} consolidated`,                                                          accent: T.navy  },
            { icon: TrendingUp,    label: "Avg Ownership", value: `${fmt(avgOwn)}%`, sub: `${ownership.filter(o => (o.ownershipPercentage || 0) >= 100).length} wholly owned`,          accent: avgOwn >= 75 ? T.green : T.amber },
            { icon: Globe,         label: "Currencies",    value: ccys.length,       sub: ccys.slice(0, 5).join(" · ") + (ccys.length > 5 ? " …" : ""),                                accent: T.navy  },
            { icon: AlertTriangle, label: "Detached",      value: detachedCount,     sub: "nodes outside structure",                                                                    accent: detachedCount > 0 ? T.amber : T.green },
          ].map((k, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 16, padding: "14px 18px", border: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <p style={{ fontSize: 10, fontWeight: 800, color: T.gray, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>{k.label}</p>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.navyL, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <k.icon size={13} color={T.navy} />
                </div>
              </div>
              <p style={{ fontSize: 24, fontWeight: 900, color: k.accent, margin: 0, lineHeight: 1 }}>{k.value}</p>
              <p style={{ fontSize: 10, color: T.gray, margin: "5px 0 0" }}>{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar + structure switcher */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 12, padding: 4 }}>
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); setSelected(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, fontWeight: 700, padding: "6px 13px", borderRadius: 8, border: "none", cursor: "pointer",
                background: tab === t.key ? "#fff" : "transparent",
                color:      tab === t.key ? t.color : T.gray,
                boxShadow:  tab === t.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}>
              {t.label}
              {t.count !== undefined && (
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 20,
                  background: tab === t.key ? t.color : "#e5e7eb",
                  color: tab === t.key ? "#fff" : T.gray,
                }}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

       {tab === "companies" && (
          <div style={{ position: "relative" }}>
            <input
              type="text" placeholder="Search companies…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7, fontSize: 11, borderRadius: 10, border: "1px solid #e5e7eb", outline: "none", background: "#fff", width: 220 }}
            />
            <Building2 size={12} color={T.gray} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          </div>
        )}
        {structures.length > 1 && (
          <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 12, padding: 4 }}>
            {structures.map(s => (
              <button key={s.groupStructure}
                onClick={() => { setStructKey(s.groupStructure); setSelected(null); }}
                style={{
                  fontSize: 11, fontWeight: 700, padding: "6px 13px", borderRadius: 8, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                  background: structKey === s.groupStructure ? "#fff" : "transparent",
                  color:      structKey === s.groupStructure ? T.navy : T.gray,
                  boxShadow:  structKey === s.groupStructure ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.15s",
                }}>
                {s.groupStructure}{s.isDefault ? " ★" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading spinner */}
      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${T.navy}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <p style={{ fontSize: 12, color: T.gray, margin: 0 }}>Loading structure data…</p>
          </div>
        </div>
      )}

      {/* Tab content */}
      {!loading && (
        <>
          {tab === "tree"      && <GraphTab nodes={nodes} companies={companies} ownership={ownership} groupStructure={groupStructure} selected={selected} onSelect={setSelected} />}
{tab === "companies" && (
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 24 }}>
                            <CompaniesTab companies={companies} ownership={ownership} structKey={structKey} groupStructure={groupStructure} search={search} />

             </div>
          )}
          {tab === "periods"   && <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}><PeriodsTab      periods={periods} /></div>}
        </>
      )}

      {/* Error toasts */}
      {Object.entries(errors).length > 0 && !loading && (
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {Object.entries(errors).map(([k, e]) => (
            <div key={k} style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, padding: "7px 14px", fontSize: 11, color: T.red, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={11} /> {k}: {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}