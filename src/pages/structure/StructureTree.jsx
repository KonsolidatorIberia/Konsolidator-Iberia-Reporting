/* ══════════════════════════════════════════════════════════════════════
   Estructura del grupo — organigrama.

   Lienzo con el árbol de sociedades: cada enlace lleva la participación de
   la matriz en la filial; las tarjetas llevan el color de su moneda. Se
   mueve arrastrando (o con la rueda), Ctrl + rueda hace zoom hacia el
   cursor, y la barra de arriba busca una sociedad, encaja el árbol, cambia
   entre vertical y horizontal y pliega o despliega ramas. Al elegir una
   sociedad se resalta su línea (matrices y filiales) y se abre su ficha.
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  X, Search, Plus, Minus, Maximize2, ChevronDown, ChevronsDownUp, ChevronsUpDown,
  Unlink, Link2, Layers, Crown, Info, ArrowDownFromLine, ArrowRightFromLine,
} from "lucide-react";
import {
  NODE_W, NODE_H, computeLayout, ccyColor, ownColor, initials, fmtPct, monthFull, OWN, useStText,
} from "./structureShared.js";
import s from "./structure.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const PANEL_W = 360;

/* ── Enlace matriz → filial: codo con esquinas redondeadas ───────────── */
function edgePath(p, c, vert) {
  if (vert) {
    const sx = p.x + NODE_W / 2, sy = p.y + NODE_H, ex = c.x + NODE_W / 2, ey = c.y;
    const my = sy + (ey - sy) / 2;
    const dx = ex - sx;
    if (Math.abs(dx) < 1) return { d: `M ${sx} ${sy} V ${ey}`, lx: ex, ly: my + (ey - my) / 2 };
    const r = Math.min(14, Math.abs(dx) / 2, (ey - sy) / 2);
    const sg = Math.sign(dx);
    return {
      d: `M ${sx} ${sy} V ${my - r} Q ${sx} ${my} ${sx + sg * r} ${my} H ${ex - sg * r} Q ${ex} ${my} ${ex} ${my + r} V ${ey}`,
      lx: ex, ly: my + (ey - my) / 2,
    };
  }
  const sx = p.x + NODE_W, sy = p.y + NODE_H / 2, ex = c.x, ey = c.y + NODE_H / 2;
  const mx = sx + (ex - sx) / 2;
  const dy = ey - sy;
  if (Math.abs(dy) < 1) return { d: `M ${sx} ${sy} H ${ex}`, lx: mx + (ex - mx) / 2, ly: ey };
  const r = Math.min(14, Math.abs(dy) / 2, (ex - sx) / 2);
  const sg = Math.sign(dy);
  return {
    d: `M ${sx} ${sy} H ${mx - r} Q ${mx} ${sy} ${mx} ${sy + sg * r} V ${ey - sg * r} Q ${mx} ${ey} ${mx + r} ${ey} H ${ex}`,
    lx: mx + (ex - mx) / 2, ly: ey,
  };
}

/* ── Tarjeta de una sociedad ─────────────────────────────────────────── */
function NodeCard({ n, p, isRoot, kidsCount, collapsed, selected, dim, lineage, vert, depth, onPick, onToggle, tx, t }) {
  const cc = ccyColor(n.currency);
  return (
    <div
      className={cx(s.node, isRoot && s.nodeRoot, selected && s.nodeSel, dim && s.nodeDim, lineage && s.nodeLine)}
      style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H, "--cc": cc, "--d": depth }}
      role="button" tabIndex={0} aria-pressed={selected}
      onClick={(e) => onPick(n.id, e)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n.id, e); } }}>
      <span className={s.avatar}>{initials(n.id)}</span>
      <div className={s.nodeText}>
        <span className={s.nodeName}>{n.id}</span>
        <span className={s.nodeLegal} title={n.label}>{n.label}</span>
        <span className={s.nodeMeta}>
          {n.currency ? <span className={s.ccy}>{n.currency}</span> : null}
          {isRoot
            ? <span className={s.rootTag}><Crown size={10} strokeWidth={2.6} />{tx.parent}</span>
            : <span className={s.typeTag}>{n.type}</span>}
        </span>
      </div>
      <span className={s.flags}>
        {!n.consolidate && <i className={s.flagRed} title={t("st_not_consolidated")} />}
      </span>
      {kidsCount > 0 && (
        <button type="button" className={cx(s.fold, vert ? s.foldV : s.foldH, collapsed && s.foldOn)}
          title={collapsed ? tx.showChildren : tx.hideChildren} aria-expanded={!collapsed}
          onClick={(e) => { e.stopPropagation(); onToggle(n.id); }}
          onPointerDown={(e) => e.stopPropagation()}>
          {collapsed ? <span>+{kidsCount}</span> : <ChevronDown size={12} strokeWidth={2.8} />}
        </button>
      )}
    </div>
  );
}

/* ── Lienzo ──────────────────────────────────────────────────────────── */
export function OrgCanvas({
  nodes, detached = [], idx, companies, ownership, groupStructure, selected, onSelect, focus, primary, t, structKey,
}) {
  const tx = useStText();
  const wrapRef = useRef(null);
  const [orient, setOrient] = useState("v");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [view, setView] = useState({ k: 1, x: 40, y: 40 });
  const [smooth, setSmooth] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [legendOpen, setLegendOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const drag = useRef(null);
  const moved = useRef(false);
  const smoothTimer = useRef(0);
  const pendingCenter = useRef(null);

  const vert = orient === "v";
  const positions = useMemo(() => computeLayout(nodes, idx, collapsed, orient), [nodes, idx, collapsed, orient]);
  const byId = useMemo(() => new Map([...nodes, ...detached].map(n => [n.id, n])), [nodes, detached]);
  const visible = useMemo(() => nodes.filter(n => positions[n.id]), [nodes, positions]);

  // Caja que ocupa el árbol (coordenadas del lienzo)
  const bbox = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    Object.values(positions).forEach(p => {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + NODE_W); y1 = Math.max(y1, p.y + NODE_H);
    });
    return Number.isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
  }, [positions]);

  // Tamaño del lienzo
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const animate = useCallback((next) => {
    setSmooth(true);
    setView(next);
    clearTimeout(smoothTimer.current);
    smoothTimer.current = setTimeout(() => setSmooth(false), 520);
  }, []);
  useEffect(() => () => clearTimeout(smoothTimer.current), []);

  const fit = useCallback((instant = false) => {
    if (!bbox || !box.w || !box.h) return;
    const k = clamp(Math.min((box.w - 120) / bbox.w, (box.h - 150) / bbox.h), 0.32, 1.05);
    const next = { k, x: (box.w - bbox.w * k) / 2 - bbox.x0 * k, y: Math.max(76, (box.h - bbox.h * k) / 2 + 20) - bbox.y0 * k };
    if (instant) setView(next); else animate(next);
  }, [bbox, box.w, box.h, animate]);

  // Encaja el árbol al entrar, al cambiar de estructura o de orientación
  const fitKey = `${structKey}|${orient}|${box.w > 0}`;
  const lastFit = useRef("");
  useEffect(() => {
    if (!bbox || !box.w || lastFit.current === fitKey) return;
    const first = !lastFit.current;
    lastFit.current = fitKey;
    fit(first);
  }, [fitKey, bbox, box.w, fit]);

  // Centrar una sociedad (búsqueda, ficha, tabla de empresas) dejando sitio a la ficha
  const centerOn = useCallback((id) => {
    const p = positions[id];
    if (!p || !box.w) return;
    const k = Math.max(view.k, 0.8);
    const areaW = box.w - (box.w > 900 ? PANEL_W + 24 : 0);
    animate({ k, x: areaW / 2 - (p.x + NODE_W / 2) * k, y: box.h / 2 - (p.y + NODE_H / 2) * k });
  }, [positions, box.w, box.h, view.k, animate]);

  // Mostrar una sociedad: abre las ramas que la esconden y la centra
  const reveal = useCallback((id) => {
    const anc = [];
    let cur = idx.parentOf.get(id);
    const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); anc.push(cur); cur = idx.parentOf.get(cur); }
    if (anc.some(a => collapsed.has(a))) {
      setCollapsed(prev => { const nx = new Set(prev); anc.forEach(a => nx.delete(a)); return nx; });
      pendingCenter.current = id;
    } else {
      centerOn(id);
    }
  }, [idx, collapsed, centerOn]);
  useEffect(() => {
    if (pendingCenter.current && positions[pendingCenter.current]) {
      const id = pendingCenter.current;
      pendingCenter.current = null;
      centerOn(id);
    }
  }, [positions, centerOn]);

  // Petición externa (tabla de empresas → "Ver en el organigrama")
  const lastFocus = useRef(null);
  useEffect(() => {
    if (!focus || focus === lastFocus.current || !box.w) return;
    lastFocus.current = focus;
    reveal(focus.id);
  }, [focus, box.w, reveal]);

  // Rueda: desplaza; con Ctrl / Cmd hace zoom hacia el cursor. Se escucha a
  // mano (no pasiva) para que el navegador no haga zoom de la página entera.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.target.closest?.("[data-no-pan]")) return;
      e.preventDefault();
      setSmooth(false);
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setView(v => {
          const k = clamp(v.k * Math.exp(-e.deltaY * 0.0022), 0.25, 2.4);
          const f = k / v.k;
          return { k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f };
        });
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Arrastrar para moverse por el lienzo
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest("[data-no-pan]")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    moved.current = false;
    setSmooth(false);
    const move = (ev) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (!moved.current && Math.hypot(dx, dy) < 4) return;
      moved.current = true;
      wrapRef.current?.classList.add(s.grabbing);
      setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    };
    const up = () => {
      drag.current = null;
      wrapRef.current?.classList.remove(s.grabbing);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const zoomBy = (f) => {
    const mx = box.w / 2, my = box.h / 2;
    const k = clamp(view.k * f, 0.25, 2.4);
    const r = k / view.k;
    animate({ k, x: mx - (mx - view.x) * r, y: my - (my - view.y) * r });
  };

  // Al elegir una sociedad en el lienzo, si la ficha la tapa, el lienzo se
  // desplaza lo justo para que siga a la vista
  const pick = (id) => {
    if (moved.current) return;
    const next = id === selected ? null : id;
    onSelect(next);
    const p = next ? positions[next] : null;
    if (!p || box.w < 760) return;
    const right = view.x + (p.x + NODE_W) * view.k;
    const limit = box.w - PANEL_W - 36;
    if (right > limit) animate({ ...view, x: view.x - (right - limit) });
  };
  const toggle = (id) => setCollapsed(prev => {
    const nx = new Set(prev);
    if (nx.has(id)) nx.delete(id); else nx.add(id);
    return nx;
  });
  const parents = useMemo(() => nodes.filter(n => (idx.kids.get(n.id) ?? []).length > 0).map(n => n.id), [nodes, idx]);
  const allOpen = collapsed.size === 0;
  const toggleAll = () => {
    // Plegar todo deja a la vista la matriz y su primer nivel
    setCollapsed(allOpen ? new Set(parents.filter(id => !idx.roots.includes(id))) : new Set());
    lastFit.current = "";
  };

  // Línea de la sociedad elegida: sus matrices y todas sus filiales
  const lineage = useMemo(() => {
    if (!selected || !byId.has(selected)) return null;
    const set = new Set([selected]);
    let cur = idx.parentOf.get(selected);
    while (cur && !set.has(cur)) { set.add(cur); cur = idx.parentOf.get(cur); }
    const down = (id) => (idx.kids.get(id) ?? []).forEach(c => { if (!set.has(c)) { set.add(c); down(c); } });
    down(selected);
    return set;
  }, [selected, byId, idx]);

  // Búsqueda
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...nodes, ...detached].filter(n => `${n.id} ${n.label}`.toLowerCase().includes(q)).slice(0, 7);
  }, [query, nodes, detached]);
  const choose = (id) => {
    setQuery("");
    setSearchOpen(false);
    onSelect(id);
    reveal(id);
  };

  const onChoose = (e) => choose(e.currentTarget.dataset.id);

  // Mapa (solo si el árbol no cabe entero)
  const fitsAll = bbox && view.x + bbox.x0 * view.k >= -2 && view.y + bbox.y0 * view.k >= -2
    && view.x + bbox.x1 * view.k <= box.w + 2 && view.y + bbox.y1 * view.k <= box.h + 2;
  const MM_W = 176, MM_H = 112;
  const mm = bbox ? Math.min((MM_W - 16) / bbox.w, (MM_H - 16) / bbox.h) : 1;
  const mmOx = bbox ? (MM_W - bbox.w * mm) / 2 - bbox.x0 * mm : 0;
  const mmOy = bbox ? (MM_H - bbox.h * mm) / 2 - bbox.y0 * mm : 0;
  const onMiniClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left - mmOx) / mm, wy = (e.clientY - r.top - mmOy) / mm;
    animate({ k: view.k, x: box.w / 2 - wx * view.k, y: box.h / 2 - wy * view.k });
  };

  // Monedas presentes (leyenda)
  const ccys = useMemo(() => [...new Set([...nodes, ...detached].map(n => n.currency).filter(Boolean))], [nodes, detached]);

  const edges = [];
  visible.forEach(n => {
    const par = idx.parentOf.get(n.id);
    if (!par || !positions[par]) return;
    const { d, lx, ly } = edgePath(positions[par], positions[n.id], vert);
    const on = lineage ? lineage.has(n.id) && lineage.has(par) : false;
    edges.push({ key: `${par}>${n.id}`, d, lx, ly, on, dim: !!lineage && !on, pct: n.ownership, depth: idx.depth.get(n.id) ?? 1 });
  });

  const selNode = selected ? byId.get(selected) : null;

  return (
    <div ref={wrapRef} className={cx(s.canvas, selNode && s.canvasPanel)} style={{ "--pr": primary }} onPointerDown={onPointerDown}>
      {!nodes.length ? <div className={s.canvasEmpty}><Layers size={22} /><p>{t("st_no_hierarchy")}</p></div> : <>
      <div className={cx(s.world, smooth && s.worldSmooth)} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className={s.edges} width={1} height={1} aria-hidden="true">
          {edges.map(e => (
            <path key={e.key} d={e.d} className={cx(s.edge, e.on && s.edgeOn, e.dim && s.edgeDim)} style={{ "--d": e.depth }} />
          ))}
          {edges.filter(e => e.pct > 0).map(e => {
            const label = `${fmtPct(e.pct, e.pct % 1 ? 1 : 0)}%`;
            const w = 12 + label.length * 6.4;
            return (
              <g key={`l-${e.key}`} className={cx(s.edgePill, e.dim && s.edgeDim)} transform={`translate(${e.lx} ${e.ly})`} style={{ "--d": e.depth }}>
                <rect x={-w / 2} y={-10} width={w} height={20} rx={10} style={{ stroke: ownColor(e.pct) }} />
                <text y={4} textAnchor="middle" style={{ fill: ownColor(e.pct) }}>{label}</text>
              </g>
            );
          })}
        </svg>
        {visible.map(n => (
          <NodeCard key={n.id} n={n} p={positions[n.id]} isRoot={idx.roots.includes(n.id)}
            kidsCount={(idx.kids.get(n.id) ?? []).length} collapsed={collapsed.has(n.id)}
            selected={n.id === selected} dim={!!lineage && !lineage.has(n.id)} lineage={!!lineage && lineage.has(n.id) && n.id !== selected}
            vert={vert} depth={idx.depth.get(n.id) ?? 0} onPick={pick} onToggle={toggle} tx={tx} t={t} />
        ))}
      </div>

      {/* Barra de herramientas */}
      <div className={s.toolbar} data-no-pan>
        <div className={s.find}>
          <Search size={14} />
          <input value={query} placeholder={tx.find} aria-label={tx.find}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 140)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) choose(matches[0].id);
              if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); }
            }} />
          {searchOpen && query.trim() && (
            <div className={s.findList}>
              {matches.length === 0 ? <p className={s.findEmpty}>{tx.noMatches}</p> : matches.map(n => (
                <button key={n.id} type="button" data-id={n.id} className={s.findItem} onMouseDown={(e) => e.preventDefault()} onClick={onChoose}>
                  <span className={s.miniAv} style={{ "--cc": ccyColor(n.currency) }}>{initials(n.id)}</span>
                  <span className={s.findText}><b>{n.id}</b><small>{n.label}</small></span>
                  {n.detached ? <Unlink size={12} className={s.findWarn} /> : null}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={s.tbSep} />
        <button type="button" className={s.tbBtn} onClick={() => zoomBy(1 / 1.25)} title={tx.zoomOut} aria-label={tx.zoomOut}><Minus size={14} /></button>
        <button type="button" className={s.tbZoom} onClick={() => animate({ k: 1, x: view.x, y: view.y })} title="100 %">{Math.round(view.k * 100)}%</button>
        <button type="button" className={s.tbBtn} onClick={() => zoomBy(1.25)} title={tx.zoomIn} aria-label={tx.zoomIn}><Plus size={14} /></button>
        <button type="button" className={s.tbBtn} onClick={() => fit()} title={tx.fit} aria-label={tx.fit}><Maximize2 size={14} /></button>
        <span className={s.tbSep} />
        <div className={s.seg} role="group">
          <button type="button" className={cx(s.segBtn, vert && s.segOn)} onClick={() => setOrient("v")} title={tx.vertical} aria-pressed={vert}><ArrowDownFromLine size={14} /></button>
          <button type="button" className={cx(s.segBtn, !vert && s.segOn)} onClick={() => setOrient("h")} title={tx.horizontal} aria-pressed={!vert}><ArrowRightFromLine size={14} /></button>
        </div>
        {parents.length > 1 && (
          <button type="button" className={s.tbBtn} onClick={toggleAll} title={allOpen ? tx.collapseAll : tx.expandAll}>
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          </button>
        )}
      </div>

      {/* Leyenda */}
      <div className={cx(s.legend, legendOpen && s.legendOpen)} data-no-pan>
        <button type="button" className={s.legendBtn} onClick={() => setLegendOpen(o => !o)} aria-expanded={legendOpen}>
          <Info size={13} />{tx.legend}
        </button>
        {legendOpen && (
          <div className={s.legendBody}>
            <div className={s.legendRow}>
              <span className={s.legendPct} style={{ "--c": OWN.high }}>100%</span>{tx.ownershipHigh}
            </div>
            <div className={s.legendRow}><span className={s.legendPct} style={{ "--c": OWN.mid }}>60%</span>{tx.ownershipMid}</div>
            <div className={s.legendRow}><span className={s.legendPct} style={{ "--c": OWN.low }}>30%</span>{tx.ownershipLow}</div>
            <div className={s.legendRow}><i className={s.flagRed} />{tx.notConsolidated}</div>
            <div className={s.legendCcys}>
              {ccys.map(c => <span key={c} className={s.ccyDot} style={{ "--cc": ccyColor(c) }}>{c}</span>)}
            </div>
          </div>
        )}
      </div>
      {!selNode && fitsAll && <p className={s.hint}>{tx.dragHint}</p>}

      {/* Mapa */}
      {bbox && !fitsAll && (
        <div className={s.minimap} data-no-pan style={{ width: MM_W, height: MM_H }} onClick={onMiniClick} title={tx.minimap}>
          <svg width={MM_W} height={MM_H}>
            {visible.map(n => {
              const p = positions[n.id];
              return <rect key={n.id} x={mmOx + p.x * mm} y={mmOy + p.y * mm} width={Math.max(2, NODE_W * mm)} height={Math.max(2, NODE_H * mm)} rx={2}
                fill={n.id === selected ? primary : ccyColor(n.currency)} opacity={lineage && !lineage.has(n.id) ? 0.25 : 0.75} />;
            })}
            <rect className={s.mmView} x={mmOx + (-view.x / view.k) * mm} y={mmOy + (-view.y / view.k) * mm}
              width={(box.w / view.k) * mm} height={(box.h / view.k) * mm} rx={4} />
          </svg>
        </div>
      )}
      </>}

      <DetailPanel node={selNode} idx={idx} byId={byId} companies={companies} ownership={ownership}
        groupStructure={groupStructure} onClose={() => onSelect(null)} onGo={choose} t={t} tx={tx} />
    </div>
  );
}

/* ── Ficha de la sociedad ────────────────────────────────────────────── */
function DetailPanel({ node, idx, byId, companies, ownership, groupStructure, onClose, onGo, t, tx }) {
  const [shown, setShown] = useState(node);
  if (node && node !== shown) setShown(node);
  const n = node ?? shown;
  const open = !!node;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!n) return <aside className={s.panel} aria-hidden="true" />;
  const co = companies.find(c => c.companyShortName === n.id);
  const ow = ownership.find(o => o.companyShortName === n.id);
  const gs = groupStructure.filter(g => g.companyShortName === n.id);
  const pct = ow?.ownershipPercentage ?? n.ownership ?? 0;
  const isRoot = idx.roots.includes(n.id) && !n.detached;

  const path = [];
  let cur = idx.parentOf.get(n.id);
  const seen = new Set();
  while (cur && !seen.has(cur)) { seen.add(cur); path.unshift(cur); cur = idx.parentOf.get(cur); }
  const kids = (idx.kids.get(n.id) ?? []).map(id => byId.get(id)).filter(Boolean);

  const R = 34, C = 2 * Math.PI * R;
  const since = ow?.fromMonth && ow?.fromYear ? `${monthFull(t, ow.fromMonth - 1)} ${ow.fromYear}` : null;
  const until = ow?.toYear > 0 ? `${monthFull(t, (ow.toMonth || 12) - 1)} ${ow.toYear}` : null;
  const facts = [
    [t("st_method"), co?.accountingPrinciple],
    [t("st_associates"), co?.accountingPrincipleAssociates],
    [t("st_mapping"), co?.mappingName],
    [t("st_type"), co?.type],
    [t("st_from"), co?.consolidate && co?.consolidateFromMonth ? `${monthFull(t, co.consolidateFromMonth - 1)} ${co.consolidateFromYear}` : null],
  ].filter(([, v]) => v);

  return (
    <aside className={cx(s.panel, open && s.panelOpen)} data-no-pan aria-hidden={!open} style={{ "--cc": ccyColor(n.currency) }}>
      <div className={s.panelHead}>
        <span className={s.panelAv}>{initials(n.id)}</span>
        <div className={s.panelTitle}>
          <h3>{n.id}</h3>
          <p title={co?.companyLegalName || n.label}>{co?.companyLegalName || n.label}</p>
        </div>
        <button type="button" className={s.panelClose} onClick={onClose} aria-label="Close"><X size={15} /></button>
      </div>
      <div className={s.panelTags}>
        {isRoot ? <span className={s.tagRoot}><Crown size={11} />{tx.parent}</span> : <span className={s.tag}>{co?.recognizeAs || n.type}</span>}
        {n.currency ? <span className={s.tagCcy}>{n.currency}</span> : null}
        <span className={(co?.consolidate ?? n.consolidate) ? s.tagOk : s.tagBad}>
          {(co?.consolidate ?? n.consolidate) ? t("st_consolidated") : t("st_not_consolidated")}
        </span>
        {n.detached ? <span className={s.tagWarn}><Unlink size={11} />{tx.detached}</span> : null}
      </div>

      <div className={s.panelBody}>
        {path.length > 0 && (
          <section>
            <h4>{tx.path}</h4>
            <div className={s.crumbs}>
              {path.map(id => (
                <span key={id} className={s.crumbStep}>
                  <button type="button" className={s.crumb} onClick={() => onGo(id)}>
                    <span className={s.miniAv} style={{ "--cc": ccyColor(byId.get(id)?.currency) }}>{initials(id)}</span>{id}
                  </button>
                  <span className={s.crumbSep} aria-hidden="true">›</span>
                </span>
              ))}
              <span className={cx(s.crumb, s.crumbHere)}>{n.id}</span>
            </div>
          </section>
        )}

        {!isRoot && (
          <section className={s.ownCard} style={{ "--oc": ownColor(pct) }}>
            <svg width={84} height={84} viewBox="-42 -42 84 84" className={s.ownRing}>
              <circle r={R} className={s.ownTrack} />
              <circle key={n.id} r={R} className={s.ownArc} strokeDasharray={`${C * clamp(pct / 100, 0, 1)} ${C}`} transform="rotate(-90)" />
            </svg>
            <div className={s.ownText}>
              <span className={s.ownPct}>{fmtPct(pct)}%</span>
              <span className={s.ownLabel}>{t("st_ownership")}</span>
              {since && (
                <div className={s.timeline}>
                  <span>{since}</span>
                  <i className={until ? s.tlEnd : s.tlOpen} />
                  <span>{until ?? tx.today}</span>
                </div>
              )}
              {!since && !until && <span className={s.ownSub}>{t("st_open_ended")}</span>}
            </div>
          </section>
        )}

        {facts.length > 0 && (
          <section>
            <h4>{t("st_consolidation")}</h4>
            <dl className={s.facts}>
              {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={String(v)}>{v}</dd></div>)}
            </dl>
          </section>
        )}

        <section>
          <h4>{tx.subsidiaries}<span className={s.count}>{kids.length}</span></h4>
          {kids.length === 0 ? <p className={s.muted}>{tx.noSubsidiaries}</p> : (
            <div className={s.kids}>
              {kids.map(k => (
                <button key={k.id} type="button" className={s.kid} onClick={() => onGo(k.id)}>
                  <span className={s.miniAv} style={{ "--cc": ccyColor(k.currency) }}>{initials(k.id)}</span>
                  <span className={s.kidText}><b>{k.id}</b><small>{k.label}</small></span>
                  <span className={s.kidPct} style={{ "--oc": ownColor(k.ownership) }}>
                    <span className={s.kidBar}><i style={{ width: `${clamp(k.ownership, 0, 100)}%` }} /></span>{fmtPct(k.ownership)}%
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {gs.length > 0 && (
          <section>
            <h4>{t("st_in_structures")}</h4>
            <div className={s.structs}>
              {gs.map(g => (
                <div key={g.groupStructure} className={s.struct}>
                  {g.detached ? <Unlink size={12} className={s.icWarn} /> : g.parentShortName ? <Link2 size={12} className={s.icOk} /> : <Layers size={12} className={s.icBrand} />}
                  <span>{g.groupStructure}</span>
                  <em>{g.detached ? t("st_detached") : g.parentShortName ? `${tx.parent}: ${g.parentShortName}` : t("st_root")}</em>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

/* ── Sociedades desvinculadas (fuera del árbol) ──────────────────────── */
export function DetachedRail({ detached, selected, onSelect, tx }) {
  if (!detached.length) return null;
  return (
    <aside className={s.rail}>
      <div className={s.railHead}>
        <Unlink size={13} />
        <span>{tx.detachedN(detached.length)}</span>
      </div>
      <div className={s.railList}>
        {detached.map(n => (
          <button key={n.id} type="button" className={cx(s.railItem, selected === n.id && s.railSel)}
            onClick={() => onSelect(selected === n.id ? null : n.id)}>
            <span className={s.miniAv} style={{ "--cc": ccyColor(n.currency) }}>{initials(n.id)}</span>
            <span className={s.kidText}><b>{n.id}</b><small>{n.label}</small></span>
            {n.ownership > 0 && <span className={s.railPct} style={{ color: ownColor(n.ownership) }}>{fmtPct(n.ownership)}%</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}