/* ══════════════════════════════════════════════════════════════════════
   Panel lateral "Rastro del dato" de la Sábana de Consolidación.

   Al elegir una cuenta en la sábana, el panel enseña de dónde sale su
   consolidado: contributivo de cada sociedad (carga, asientos y, en filiales
   en otra divisa, el tipo de cambio), subgrupos abiertos igual, eliminaciones
   asiento a asiento y, si hace falta, el redondeo. Se despliega nivel a nivel
   hasta la línea local de la carga o la línea de asiento.

   Datos: la sábana ya trae la consolidación de la raíz, la carga y los
   asientos del periodo. El panel pide además la consolidación de cada
   subgrupo y los tipos de cambio (y, en mensual, el mes anterior). Cálculo:
   consolidationTrail.js.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, Layers, Network, Building2, Building, Upload, FileText, Hash, CornerDownRight,
  Scissors, AlertTriangle, ChevronRight, ChevronLeft, Loader2, GitBranch, Search, ListTree, Compass,
} from "lucide-react";
import { buildTrail, diffTrees, makeFx } from "./consolidationTrail.js";
import styles from "./ConsolidationTrail.module.css";

const BASE = "https://api.konsolidator.com/v2";
const cache = new Map(); // url → promesa de filas (se comparte entre aperturas)

function getRows(url, token) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : { value: [] }))
      .then(d => d.value ?? (Array.isArray(d) ? d : []))
      .catch(() => { cache.delete(url); return []; }));
  }
  return cache.get(url);
}

const ICONS = {
  root: Layers, subgroup: Network, contrib: Building2, company: Building, load: Upload,
  journals: FileText, journal: Hash, journalLine: CornerDownRight, line: CornerDownRight,
  elim: Scissors, roundGroup: AlertTriangle, roundCompany: AlertTriangle,
};

const cx = (...c) => c.filter(Boolean).join(" ");
const fmt = (v) => {
  const n = Math.round((v ?? 0) * 100) / 100;
  const s = Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
};

export default function ConsolidationTrail({
  token, account, root, year, month, source, structure, ytdOnly, companies,
  consRoot, consRootPrev, uploaded, journals, colors, T = (k, f) => f ?? k, onClose,
}) {
  const [state, setState] = useState({ loading: true, tree: null, error: null });
  const [open, setOpen] = useState(() => new Set(["root", "root~contrib", "root~elim"]));
  const [view, setView] = useState("nav");        // nav (navegar nivel a nivel) | outline (esquema)
  const [path, setPath] = useState(["root"]);    // claves desde la raíz hasta el nodo abierto
  const [dir, setDir] = useState(1);             // 1 = entrar, -1 = volver
  const [q, setQ] = useState("");
  const panelRef = useRef(null);

  // ── Ancho del panel: se arrastra desde su borde izquierdo ──────────────
  // Vive en la variable CSS --cs-trail-w de <html> (la usan el panel y la
  // sábana), así arrastrar no repinta la tabla. Se recuerda entre sesiones.
  const W_KEY = "konsolidator:trail-width";
  const clampW = (w) => Math.round(Math.max(380, Math.min(w, window.innerWidth - 480, 1100)));
  useEffect(() => {
    let w = 560;
    try { w = Number(localStorage.getItem(W_KEY)) || 560; } catch { /* sin almacenamiento */ }
    document.documentElement.style.setProperty("--cs-trail-w", `${clampW(w)}px`);
  }, []);
  const [dragging, setDragging] = useState(false);
  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelRef.current?.getBoundingClientRect().width ?? 560;
    let next = startW, raf = 0;
    setDragging(true);
    document.documentElement.classList.add("cs-trail-resizing");
    const move = (ev) => {
      next = clampW(startW + (startX - ev.clientX));
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; document.documentElement.style.setProperty("--cs-trail-w", `${next}px`); });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      document.documentElement.style.setProperty("--cs-trail-w", `${next}px`);
      document.documentElement.classList.remove("cs-trail-resizing");
      try { localStorage.setItem(W_KEY, String(next)); } catch { /* sin almacenamiento */ }
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const curOf = useMemo(() => {
    const m = new Map(companies.map(c => [c.CompanyShortName, c.CurrencyCode]));
    return (co) => m.get(co) ?? "";
  }, [companies]);
  const nameOf = useMemo(() => {
    const m = new Map(companies.map(c => [c.CompanyShortName, c.CompanyLegalName || c.CompanyShortName]));
    return (co) => m.get(co) ?? co;
  }, [companies]);

  const monthly = !ytdOnly && (account?.AccountType === "P/L" || account?.AccountType === "DIS");
  const codesKey = (account?.codes ?? []).join(",");

  useEffect(() => {
    if (!account || !root) return;
    let alive = true;
    // Cambia la cuenta: se queda el árbol anterior visible (atenuado) mientras carga.
    queueMicrotask(() => alive && setState(s => ({ ...s, loading: true, error: null })));
    const y = Number(year), m = Number(month);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const consUrl = (g, yy, mm) => `${BASE}/reports/consolidated-accounts?$filter=${encodeURIComponent(
      `Year eq ${yy} and Month eq ${mm} and Source eq '${source}' and GroupStructure eq '${structure}' and GroupShortName eq '${g}'`)}`;
    const ratesUrl = (yy, mm) => `${BASE}/exchange-rates?$filter=${encodeURIComponent(`Year eq ${yy} and Month eq ${mm} and Source eq '${source}'`)}`;
    const baseUrl = (path, yy, mm) => `${BASE}/${path}?$filter=${encodeURIComponent(
      `Year eq ${yy} and Month eq ${mm} and Source eq '${source}' and GroupStructure eq '${structure}'`)}`;

    // Consolidaciones del grupo y de todos sus subgrupos (recursivo).
    const loadGroups = async (yy, mm, rootRows) => {
      const byGroup = new Map([[root, rootRows]]);
      const queue = [root];
      while (queue.length) {
        const g = queue.shift();
        const rows = byGroup.get(g) ?? [];
        const members = [...new Set(rows
          .filter(r => (r.CompanyRole ?? r.companyRole) === "Contribution")
          .map(r => r.CompanyShortName ?? r.companyShortName))];
        const fetched = await Promise.all(members.filter(c => !byGroup.has(c)).map(async c => [c, await getRows(consUrl(c, yy, mm), token)]));
        fetched.forEach(([c, rs]) => {
          if (rs.some(r => (r.CompanyRole ?? r.companyRole) === "Group")) { byGroup.set(c, rs); queue.push(c); }
        });
      }
      return byGroup;
    };

    (async () => {
      try {
        const codes = new Set(account.codes ?? [account.AccountCode]);
        const typeOf = () => account.AccountType;
        const [groups, rates] = await Promise.all([loadGroups(y, m, consRoot), getRows(ratesUrl(y, m), token)]);
        let tree = buildTrail({
          root, codes, sign: -1, consByGroup: groups, uploaded, journals,
          curOf, nameOf, fx: makeFx(rates, curOf(root)), accountTypeOf: typeOf,
        });
        if (monthly && m !== 1) { // enero: el mes es el acumulado
          const [pRoot, pUp, pJr, pRates] = await Promise.all([
            consRootPrev?.length ? Promise.resolve(consRootPrev) : getRows(consUrl(root, prev.y, prev.m), token),
            getRows(baseUrl("reports/uploaded-accounts", prev.y, prev.m), token),
            getRows(baseUrl("journal-entries", prev.y, prev.m), token),
            getRows(ratesUrl(prev.y, prev.m), token),
          ]);
          const pGroups = await loadGroups(prev.y, prev.m, pRoot);
          const prevTree = buildTrail({
            root, codes, sign: -1, consByGroup: pGroups, uploaded: pUp, journals: pJr,
            curOf, nameOf, fx: makeFx(pRates, curOf(root)), accountTypeOf: typeOf,
          });
          tree = diffTrees(tree, prevTree);
        }
        if (alive) setState({ loading: false, tree, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, tree: null, error: String(e?.message ?? e) });
      }
    })();
    return () => { alive = false; };
  }, [account, codesKey, root, year, month, source, structure, monthly, token, consRoot, consRootPrev, uploaded, journals, curOf, nameOf]);

  // Escape cierra
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tree = state.tree;
  const rootCur = curOf(root);
  const monthName = T(`month_${Number(month)}`, String(month));

  // Rótulos traducidos de los nodos fijos
  const typeLabel = {
    contrib: T("trail_contrib", "Contributivo"), elim: T("trail_elim", "Eliminaciones"), load: T("trail_load", "Carga"),
    journals: T("trail_journals", "Asientos"), roundGroup: T("trail_round_group", "Redondeo"), roundCompany: T("trail_round_company", "Redondeo"),
  };
  const roleLabel = { Matriz: T("trail_parent", "Matriz"), Filial: T("trail_subsidiary", "Filial") };
  const labelOf = (n) => typeLabel[n.type] ?? n.label;
  const detailOf = (n) => {
    if (n.type === "company") return roleLabel[n.detail] ?? n.detail;
    if (n.type === "subgroup") return T("trail_subgroup", "Subgrupo");
    if (n.type === "roundGroup" || n.type === "roundCompany") return T("trail_round_hint", "Diferencia de conversión y redondeo");
    return [n.detail, n.counterparty && `↔ ${n.counterparty}`].filter(Boolean).join(" · ");
  };

  // Al cambiar de cuenta se vuelve a la raíz.
  useEffect(() => { queueMicrotask(() => { setPath(["root"]); setQ(""); }); }, [account?.AccountCode]);

  // Nodo abierto según la ruta (si ya no existe, se corta la ruta).
  const trail = useMemo(() => {
    if (!tree) return [];
    const out = [tree];
    for (const k of path.slice(1)) {
      const next = out[out.length - 1].children.find(c => c.key === k);
      if (!next) break;
      out.push(next);
    }
    return out;
  }, [tree, path]);
  const current = trail[trail.length - 1];
  const goTo = (i) => { setDir(-1); setQ(""); setPath(p => p.slice(0, i + 1)); };
  const drill = (n) => { if (!n.children.length) return; setDir(1); setQ(""); setPath(p => [...p, n.key]); };

  // ← o Retroceso: subir un nivel
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.key === "ArrowLeft" || e.key === "Backspace") && path.length > 1) { e.preventDefault(); goTo(path.length - 2); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Paleta para la composición (una por hijo, en orden)
  const PALETTE = ["var(--tr-primary)", "#6d5bd0", "#0ea5a4", "#3b82f6", "#ec4899", "#84cc16", "#a855f7", "#64748b"];
  const colorOf = (n, i) => (n.type === "elim" || n.type === "journal" ? "#f59e0b"
    : n.type?.startsWith("round") ? "#cbd5e1"
    : n.type === "load" ? "#10b981" : n.type === "journals" ? "#6366f1" : PALETTE[i % PALETTE.length]);

  // Sobre la tarjeta (fondo de color) el primer color pasa a blanco
  const heroColorOf = (n, i) => { const c = colorOf(n, i); return c === "var(--tr-primary)" ? "rgba(255,255,255,0.92)" : c; };
  const kids = current ? current.children : [];
  const query = q.trim().toLowerCase();
  const shownKids = query ? kids.filter(c => `${labelOf(c)} ${detailOf(c)}`.toLowerCase().includes(query)) : kids;
  const totalAbs = kids.reduce((s, c) => s + Math.abs(c.amount), 0) || 1;
  const pctOfRoot = tree && current && Math.abs(tree.amount) > 0.004 ? (current.amount / tree.amount) * 100 : null;
  const avatar = (n) => {
    const Icon = ICONS[n.type] ?? GitBranch;
    return <span className={cx(styles.avatar, styles[`av_${n.type}`])}><Icon size={15} strokeWidth={2.2} /></span>;
  };
  const amountBlock = (n, big = false) => (
    <span className={cx(styles.amt, big && styles.amtBig)}>
      <span className={cx(styles.amtMain, n.amount < 0 && styles.neg)}>{fmt(n.amount)}</span>
      {n.local && n.local.currency && n.local.currency !== rootCur && (
        <span className={styles.amtLocal}>{fmt(n.local.amount)} <b>{n.local.currency}</b></span>
      )}
    </span>
  );

  // ── Esquema: el árbol entero, con conectores, etiqueta de tipo en cada
  //    fila y, en cada nodo abierto, la fórmula de lo que lo compone. ──
  const toggle = (k) => setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const TYPE_TAG = {
    root: T("trail_tag_group", "Grupo"), subgroup: T("trail_subgroup", "Subgrupo"), contrib: T("trail_contrib", "Contributivo"),
    elim: T("trail_elim", "Eliminaciones"), load: T("trail_load", "Carga"), journals: T("trail_journals", "Asientos"),
    journal: T("trail_tag_journal", "Asiento"), line: T("trail_tag_line", "Línea"), journalLine: T("trail_tag_line", "Línea"),
    roundGroup: T("trail_round_group", "Redondeo"), roundCompany: T("trail_round_company", "Redondeo"),
  };
  const tagOf = (n) => (n.type === "company" ? (roleLabel[n.detail] ?? n.detail) : TYPE_TAG[n.type] ?? "");
  // Nombre del nodo en el esquema: para los fijos (Contributivo, Carga…) basta la etiqueta.
  const outlineName = (n) => (["contrib", "elim", "load", "journals", "roundGroup", "roundCompany"].includes(n.type) ? "" : n.label);
  const formula = (n) => {
    const parts = n.children.map(c => (["contrib", "elim", "load", "journals", "roundGroup", "roundCompany"].includes(c.type) ? labelOf(c) : c.label));
    const shown = parts.slice(0, 3).join(" + ");
    return parts.length > 3 ? `${shown} + ${fill(T("trail_more", "{n} más"), { n: parts.length - 3 })}` : shown;
  };
  const outlineNode = (n, depth, i, last) => {
    const has = n.children.length > 0;
    const isOpen = open.has(n.key);
    const name = outlineName(n);
    const tag = tagOf(n);
    const showLocal = n.local && n.local.currency && n.local.currency !== rootCur;
    const leaf = n.type === "line" || n.type === "journalLine";
    return (
      <div key={n.key} className={cx(styles.oNode, depth > 0 && styles.oChild, last && styles.oLast)} style={{ "--i": Math.min(i, 16) }}>
        <div
          className={cx(styles.oRow, styles[`o_${n.type}`], has && styles.oClick, isOpen && styles.oOpen, leaf && styles.oLeaf)}
          onClick={has ? () => toggle(n.key) : undefined}
          role={has ? "button" : undefined}
          tabIndex={has ? 0 : undefined}
          aria-expanded={has ? isOpen : undefined}
          onKeyDown={has ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(n.key); } }) : undefined}>
          <span className={cx(styles.oChev, isOpen && styles.oChevOn)}>{has && <ChevronRight size={13} strokeWidth={2.6} />}</span>
          <span className={styles.oMain}>
            <span className={styles.oLine1}>
              {tag && <span className={cx(styles.oTag, styles[`tag_${n.type}`])}>{tag}</span>}
              {name && (
                <span className={styles.oName} title={name}>
                  {leaf && / · /.test(name)
                    ? <><span className={styles.leafCode}>{name.split(" · ")[0]}</span>{name.split(" · ").slice(1).join(" · ")}</>
                    : name}
                </span>
              )}
              {has && !isOpen && <span className={styles.oCount}>{n.children.length}</span>}
            </span>
            {leaf && n.detail && <span className={styles.oDetail} title={n.detail}>{n.detail}</span>}
            {!leaf && n.type === "journal" && n.detail && <span className={styles.oDetail} title={n.detail}>{n.detail}{n.counterparty ? ` · ↔ ${n.counterparty}` : ""}</span>}
          </span>
          <span className={styles.oAmts}>
            <span className={cx(styles.oAmt, n.amount < 0 && styles.neg)}>{fmt(n.amount)}</span>
            {showLocal && <span className={styles.oLocal}>{fmt(n.local.amount)} {n.local.currency}</span>}
          </span>
        </div>
        {has && isOpen && (
          <>
            <div className={styles.oFormula}><span>=</span>{formula(n)}</div>
            <div className={styles.oKids}>
              {n.children.map((c, k) => outlineNode(c, depth + 1, k, k === n.children.length - 1))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <aside ref={panelRef} className={cx(styles.panel, dragging && styles.panelDragging)} style={{ "--tr-primary": colors?.primary ?? "#1a2f8a" }} aria-label={T("trail_title", "Rastro del dato")}>
      <span className={cx(styles.resizer, dragging && styles.resizerOn)} role="separator" aria-orientation="vertical"
        title={T("trail_resize", "Arrastra para cambiar el ancho")} onPointerDown={startResize}
        onDoubleClick={() => { document.documentElement.style.setProperty("--cs-trail-w", "560px"); try { localStorage.setItem(W_KEY, "560"); } catch { /* sin almacenamiento */ } }} />
      {/* ── Cabecera ── */}
      <header className={styles.head}>
        <div className={styles.headRow}>
          <span className={styles.kicker}><GitBranch size={12} strokeWidth={2.6} />{T("trail_title", "Rastro del dato")}</span>
          <div className={styles.viewSwitch} role="tablist">
            <span className={styles.viewPill} style={{ transform: `translateX(${view === "nav" ? 0 : 100}%)` }} aria-hidden="true" />
            <button type="button" role="tab" aria-selected={view === "nav"} className={cx(view === "nav" && styles.viewOn)} onClick={() => setView("nav")}>
              <Compass size={13} />{T("trail_view_nav", "Navegar")}
            </button>
            <button type="button" role="tab" aria-selected={view === "outline"} className={cx(view === "outline" && styles.viewOn)} onClick={() => setView("outline")}>
              <ListTree size={13} />{T("trail_view_outline", "Esquema")}
            </button>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={T("btn_close", "Cerrar")}><X size={16} /></button>
        </div>
        <h2 className={styles.title}>
          <span className={styles.code}>{account?.AccountCode}</span>
          <span className={styles.name} title={account?.AccountName}>{account?.AccountName}</span>
        </h2>
        <p className={styles.meta} title={`${source} · ${structure}`}>
          {nameOf(root)}<i />{monthName} {year}<i />{monthly ? T("mode_monthly", "Mensual") : T("mode_ytd", "YTD")}<i /><b>{rootCur}</b>
          {(account?.codes?.length ?? 1) > 1 && <><i />{fill(T("trail_n_accounts", "{n} cuentas"), { n: account.codes.length })}</>}
          {state.loading && <span className={styles.loading}><Loader2 size={12} className={styles.spin} /></span>}
        </p>
      </header>

      {state.error && <p className={styles.error}>{state.error}</p>}
      {!tree && state.loading && (
        <div className={styles.skeleton}>{Array.from({ length: 6 }, (_, i) => <span key={i} style={{ "--i": i }} />)}</div>
      )}

      {tree && view === "nav" && current && (
        <div className={cx(styles.navBody, state.loading && styles.dim)}>
          {/* Migas de pan */}
          {path.length > 1 && <nav className={styles.crumbs} aria-label={T("trail_path", "Ruta")}>
            {path.length > 1 && (
              <button type="button" className={styles.back} onClick={() => goTo(path.length - 2)} aria-label={T("trail_up", "Subir un nivel")}>
                <ChevronLeft size={15} strokeWidth={2.6} />
              </button>
            )}
            {trail.map((n, i) => (
              <span key={n.key} className={styles.crumbWrap}>
                {i > 0 && <ChevronRight size={12} className={styles.crumbSep} />}
                <button type="button" className={cx(styles.crumb, i === trail.length - 1 && styles.crumbOn)} onClick={() => goTo(i)} disabled={i === trail.length - 1}>
                  {labelOf(n)}
                </button>
              </span>
            ))}
          </nav>}

          <div key={current.key} className={cx(styles.level, dir > 0 ? styles.inNext : styles.inPrev)}>
            {/* Tarjeta del nodo abierto */}
            <section className={cx(styles.hero, styles[`hero_${current.type}`])}>
              <div className={styles.heroTop}>
                {avatar(current)}
                <div className={styles.heroText}>
                  <span className={styles.heroLabel}>{labelOf(current)}</span>
                  {detailOf(current) && <span className={styles.heroDetail}>{detailOf(current)}</span>}
                </div>
                {pctOfRoot != null && path.length > 1 && (
                  <span className={styles.heroPct}>{Math.abs(pctOfRoot).toFixed(1).replace(".", ",")}%</span>
                )}
              </div>
              {amountBlock(current, true)}
              {/* Composición */}
              {kids.length > 0 && (
                <div className={styles.bar}>
                  {kids.map((c, i) => (
                    <span key={c.key} style={{ flexGrow: Math.max(Math.abs(c.amount) / totalAbs, 0.012), background: heroColorOf(c, i), "--i": i }}
                      title={`${labelOf(c)}: ${fmt(c.amount)}`} />
                  ))}
                </div>
              )}
            </section>

            {/* Lo que lo forma */}
            {kids.length > 0 && (
              <div className={styles.listHead}>
                <span>{fill(T("trail_made_of", "Se compone de {n}"), { n: kids.length })}</span>
                {kids.length > 10 && (
                  <label className={styles.search}>
                    <Search size={13} />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder={T("trail_search", "Buscar")} />
                  </label>
                )}
              </div>
            )}
            <ul className={styles.list}>
              {shownKids.map((c, i) => {
                const idx = kids.indexOf(c);
                const can = c.children.length > 0;
                const leaf = c.type === "line" || c.type === "journalLine";
                const pct = Math.abs(c.amount) / totalAbs;
                return (
                  <li key={c.key} style={{ "--i": Math.min(i, 18) }}>
                    <button type="button" className={cx(styles.item, leaf && styles.itemLeaf, c.type?.startsWith("round") && styles.itemRound, can && styles.itemCan)}
                      onClick={() => drill(c)} disabled={!can}>
                      <span className={styles.itemDot} style={{ background: colorOf(c, idx) }} />
                      {!leaf && avatar(c)}
                      <span className={styles.itemText}>
                        <span className={styles.itemLabel} title={labelOf(c)}>
                          {leaf && / · /.test(labelOf(c))
                            ? <><span className={styles.leafCode}>{labelOf(c).split(" · ")[0]}</span>{labelOf(c).split(" · ").slice(1).join(" · ")}</>
                            : labelOf(c)}
                        </span>
                        {detailOf(c) && <span className={styles.itemDetail} title={detailOf(c)}>{detailOf(c)}</span>}
                      </span>
                      {amountBlock(c)}
                      {!leaf && !c.type?.startsWith("round") && (
                        <span className={styles.itemPct} aria-hidden="true">
                          <span style={{ width: `${Math.round(pct * 100)}%`, background: colorOf(c, idx) }} />
                        </span>
                      )}
                      <span className={styles.itemGo}>{can && <ChevronRight size={15} strokeWidth={2.4} />}</span>
                    </button>
                  </li>
                );
              })}
              {kids.length === 0 && <li className={styles.empty}>{T("trail_origin", "Este es el origen del dato.")}</li>}
            </ul>
          </div>
        </div>
      )}

      {tree && view === "outline" && (
        <div className={cx(styles.outline, state.loading && styles.dim)}>
          <div className={styles.outlineTools}>
            <button type="button" onClick={() => {
              const all = [];
              const walk = (n) => { if (n.children.length) { all.push(n.key); n.children.forEach(walk); } };
              walk(tree); setOpen(new Set(all));
            }}>{T("btn_expand_all", "Expandir todo")}</button>
            <button type="button" onClick={() => setOpen(new Set(["root"]))}>{T("btn_collapse_all", "Contraer")}</button>
          </div>
          {outlineNode(tree, 0, 0, true)}
        </div>
      )}

      <footer className={styles.foot}>
        {T("trail_foot_short", "Importes en la divisa del grupo, con el signo de la sábana.")}
      </footer>
    </aside>
  );
}

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
