/* ══════════════════════════════════════════════════════════════════════
   Estructura del grupo para los planes Pro y Max: estructuras propias con
   fechas, propiedad como grafo, clasificación y método por separado, % de
   voto y económico, % efectivo y de minoritarios calculados, operaciones
   con fecha, avisos, importación (Konsolidator o Excel) e historial.

   Carpeta studio/:
     StructureStudio.jsx  → datos, barra de fecha, pestañas y ventanas
     StudioViews.jsx      → ficha del grupo, árbol, empresas, configuración, historial
     EntityDrawer.jsx     → ficha de empresa
     StudioDialogs.jsx    → operaciones (compra, venta…), alta, cambios
     ImportDialog.jsx     → importar con vista previa
     studioApi.js         → Supabase (esquema ledger) y Konsolidator
     studioExcel.js       → plantilla, exportación y lectura del Excel
     studioText.js        → textos
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch, Network, Building2, Settings2, History, RefreshCw, Plus, ArrowRightLeft, Download, Upload, FileSpreadsheet,
  ChevronDown, Lock, AlertTriangle, Pencil, CheckCircle2, X, Sparkles, Loader2,
} from "lucide-react";
import { useLocale, useSettings, useT } from "../../../components/layout/SettingsContext.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { treeIndex } from "../structureShared.js";
import { OrgCanvas } from "../StructureTree.jsx";
import { loadStudio, loadPerimeter, loadCompanyUsers, loadMappingLines, parseLedgerError, todayIso } from "./studioApi.js";
import { makeTx, errorText } from "./studioText.js";
import { exportStructures, mappingLinesForExport } from "./studioExcel.js";
import { OperationDialog, AddCompanyDialog, NodeDialog, ExitDialog, StructureDialog } from "./StudioDialogs.jsx";
import { GroupBand, DateBar, TreeTable, WarningsPanel, CompaniesView, SettingsView, HistoryView, EmptyState } from "./StudioViews.jsx";
import EntityDrawer from "./EntityDrawer.jsx";
import ImportDialog from "./ImportDialog.jsx";
import s from "../structure.module.css";
import st from "./studio.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");

function Menu({ label, icon: Icon, items, primary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className={st.menuWrap} ref={ref}>
      <button type="button" className={primary ? st.btnPrimary : st.btnGhost} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {Icon && <Icon size={14} />}{label}<ChevronDown size={13} />
      </button>
      {open && (
        <div className={st.menu} role="menu">
          {items.filter(Boolean).map(it => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}>
              <it.icon size={14} /><span><b>{it.label}</b>{it.hint && <small>{it.hint}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StructureStudio({ token, access }) {
  const locale = useLocale();
  const tx = useMemo(() => makeTx(locale), [locale]);
  const t = useT();
  const { colors } = useSettings();
  const primary = colors?.primary || "#1a2f8a";
  const { companyId, canEdit } = access;

  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [version, setVersion] = useState(0);
  const [structureId, setStructureId] = useState(null);
  const [date, setDate] = useState(todayIso);
  const [per, setPer] = useState({ perimeter: [], warnings: [], loading: false, key: null });
  const [tab, setTab] = useState("tree");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [showWarn, setShowWarn] = useState(false);
  const [toast, setToast] = useState(null);
  const [users, setUsers] = useState(() => new Map());
  const [exporting, setExporting] = useState(false);

  // Las ventanas y la ficha lateral van en un portal: el color primario se publica en la raíz
  useEffect(() => { document.documentElement.style.setProperty("--studio-pr", primary); }, [primary]);

  const reload = useCallback(() => setVersion(v => v + 1), []);
  const notify = useCallback((text, kind = "ok") => setToast({ text, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const h = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(h);
  }, [toast]);

  // Datos del grupo
  useEffect(() => {
    let off = false;
    loadStudio(companyId)
      .then(d => {
        if (off) return;
        setData(d);
        setLoadErr(null);
        setStructureId(prev => (d.structures.some(x => x.id === prev) ? prev : d.structures.find(x => x.is_primary)?.id ?? d.structures[0]?.id ?? null));
      })
      .catch(e => { if (!off) setLoadErr(parseLedgerError(e)); });
    return () => { off = true; };
  }, [companyId, version]);
  useEffect(() => {
    let off = false;
    loadCompanyUsers(companyId).then(list => { if (!off) setUsers(new Map(list.map(u => [u.id, u.name]))); });
    return () => { off = true; };
  }, [companyId]);

  // Perímetro y avisos a la fecha
  const perKey = `${structureId}|${date}|${version}`;
  useEffect(() => {
    if (!structureId || !data) return undefined;
    let off = false;
    Promise.resolve().then(() => { if (!off) setPer(p => ({ ...p, loading: true })); });
    loadPerimeter(structureId, date)
      .then(r => { if (!off) setPer({ ...r, loading: false, key: perKey }); })
      .catch(e => { if (!off) { setPer({ perimeter: [], warnings: [], loading: false, key: perKey }); notify(errorText(tx, parseLedgerError(e)), "bad"); } });
    return () => { off = true; };
  }, [structureId, date, data, perKey, notify, tx]);

  const structure = data?.structures.find(x => x.id === structureId) ?? null;
  const { perimeter, warnings } = per;
  const warningsBy = useMemo(() => {
    const m = new Map();
    warnings.forEach(w => { if (w.entity_id) m.set(w.entity_id, [...(m.get(w.entity_id) ?? []), w]); });
    return m;
  }, [warnings]);

  // Fechas en las que cambia algo de la estructura o de la propiedad de sus empresas
  const changeDates = useMemo(() => {
    if (!data || !structure) return [];
    const nodes = data.nodes.filter(n => n.structure_id === structure.id);
    const ents = new Set(nodes.map(n => n.entity_id).filter(Boolean));
    const set = new Set();
    nodes.forEach(n => { if (n._range.from) set.add(n._range.from); if (n._range.to) set.add(n._range.to); });
    data.ownerships.filter(o => ents.has(o.held_entity_id)).forEach(o => { if (o._range.from) set.add(o._range.from); if (o._range.to) set.add(o._range.to); });
    return [...set].sort();
  }, [data, structure]);
  const structureEmpty = !!data && (!structure || !data.nodes.some(n => n.structure_id === structure.id));

  // Organigrama: el perímetro en el formato del lienzo de siempre
  const chart = useMemo(() => {
    const nodes = perimeter.map(p => ({
      id: p.code, label: p.legal_name || p.code, parent: p.parent_code || null, detached: false,
      currency: p.functional_currency || p.local_currency, type: tx(`cls_${p.classification}`),
      ownership: Number(p.direct_pct ?? 0), consolidate: p.method !== "none",
    }));
    return {
      nodes, idx: treeIndex(nodes),
      companies: perimeter.map(p => ({ companyShortName: p.code, companyLegalName: p.legal_name, currencyCode: p.local_currency, consolidate: p.method !== "none", type: tx(`cls_${p.classification}`) })),
      ownership: perimeter.map(p => ({ companyShortName: p.code, ownershipPercentage: Number(p.direct_pct ?? 0) })),
    };
  }, [perimeter, tx]);
  const idByCode = useMemo(() => new Map((data?.entities ?? []).map(e => [e.code, e.id])), [data]);

  // Ventanas
  const open = (type, props = {}) => setDialog({ type, props });
  const close = () => setDialog(null);
  const done = (msg) => { close(); notify(msg); reload(); };
  const onAction = (type, p) => {
    if (type === "operation") open("operation", { preset: p.holder_id ? { holderId: p.holder_id } : { heldId: p.entity_id, holderId: perimeter.find(x => x.entity_id === p.entity_id)?.parent_entity_id ?? null } });
    if (type === "node") open("node", { entityId: p.entity_id });
    if (type === "exit") open("exit", { entityId: p.entity_id });
  };
  const doExport = async (template) => {
    setExporting(true);
    try {
      const lines = template ? [] : mappingLinesForExport(data, await loadMappingLines(companyId));
      await exportStructures({ ...data, mappingLines: lines }, tx, { template });
    } catch (e) { notify(errorText(tx, parseLedgerError(e)), "bad"); } finally { setExporting(false); }
  };

  const headerTabs = [
    { id: "tree", label: tx("tab_tree"), icon: GitBranch },
    { id: "chart", label: tx("tab_chart"), icon: Network },
    { id: "companies", label: tx("tab_companies"), icon: Building2 },
    { id: "settings", label: tx("tab_settings"), icon: Settings2 },
    { id: "history", label: tx("tab_history"), icon: History },
  ];

  /* ── Errores de carga ─────────────────────────────────────────────── */
  if (loadErr) {
    return (
      <div className={s.page} style={{ "--pr": primary }}>
        <PageHeader kicker={tx("kicker")} title={tx("title")} headerActions={[{ icon: RefreshCw, label: tx("reload"), onClick: reload }]} />
        <div className={s.errorBox} role="alert">
          <span className={s.errorIc}><AlertTriangle size={20} /></span>
          <h3>{errorText(tx, { ...loadErr, code: ["schema_not_exposed", "not_installed", "forbidden"].includes(loadErr.code) ? loadErr.code : "load" })}</h3>
          <p className={st.mono}>{loadErr.message}</p>
          <button type="button" onClick={reload}><RefreshCw size={13} />{tx("retry")}</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={s.page} style={{ "--pr": primary }}>
        <PageHeader kicker={tx("kicker")} title={tx("title")} />
        <div className={st.loadingBox}><Loader2 size={20} className={st.spin} /><p>{tx("loading")}</p></div>
      </div>
    );
  }

  const importItems = [
    token && { label: tx("import_konsolidator"), hint: tx("empty_from_k_desc"), icon: Building2, onClick: () => open("import", { mode: "konsolidator" }) },
    { label: tx("import_excel"), hint: tx("empty_from_excel_desc"), icon: FileSpreadsheet, onClick: () => open("import", { mode: "excel" }) },
    { label: tx("export_excel"), icon: Download, onClick: () => doExport(false) },
    { label: tx("download_template"), icon: FileSpreadsheet, onClick: () => doExport(true) },
  ];

  return (
    <div className={cx(s.page, st.studio)} style={{ "--pr": primary }}>
      <PageHeader
        kicker={<span className={st.kicker}>{tx("kicker")}<em><Sparkles size={10} />{tx("pro_badge")}</em></span>}
        title={tx("title")}
        tabs={headerTabs}
        activeTab={tab}
        onTabChange={setTab}
        headerSearch={tab === "companies" ? { value: search, onChange: setSearch, placeholder: tx("search_company") } : undefined}
        headerActions={[{ icon: RefreshCw, label: tx("reload"), onClick: reload }]}
      />

      {/* Barra: estructura, fecha y acciones */}
      <div className={st.toolbar}>
        <div className={st.structPick}>
          <Network size={14} />
          <select className={st.structSelect} value={structureId ?? ""} onChange={e => setStructureId(e.target.value)} aria-label={tx("structure")}>
            {!data.structures.length && <option value="">—</option>}
            {data.structures.map(x => <option key={x.id} value={x.id}>{x.name}{x.is_primary ? " ★" : ""}</option>)}
          </select>
          {canEdit && structure && <button type="button" className={st.iconBtn} title={tx("edit_structure")} onClick={() => open("structure", { structure })}><Pencil size={13} /></button>}
          {canEdit && <button type="button" className={st.iconBtn} title={tx("new_structure")} onClick={() => open("structure", {})}><Plus size={14} /></button>}
        </div>
        {!structureEmpty && ["tree", "chart", "companies"].includes(tab) && <DateBar tx={tx} date={date} setDate={setDate} changeDates={changeDates} yearEndMonth={data.settings?.fiscal_year_end_month ?? 12} />}
        <div className={st.toolActions}>
          {canEdit ? (
            <>
              {!structureEmpty && <button type="button" className={st.btnGhost} onClick={() => open("add")}><Plus size={14} />{tx("add_company")}</button>}
              {!structureEmpty && <button type="button" className={st.btnPrimary} onClick={() => open("operation", { preset: {} })}><ArrowRightLeft size={14} />{tx("record_operation")}</button>}
              <Menu label={exporting ? tx("saving") : tx("import")} icon={exporting ? Loader2 : Upload} items={importItems} />
            </>
          ) : (
            <>
              <span className={st.readOnly} title={tx("read_only_hint")}><Lock size={12} />{tx("read_only")}</span>
              {!structureEmpty && <button type="button" className={st.btnGhost} onClick={() => doExport(false)}><Download size={14} />{tx("export_excel")}</button>}
            </>
          )}
        </div>
      </div>

      {/* Contenido */}
      {structureEmpty && (tab === "tree" || tab === "chart") ? (
        <EmptyState tx={tx} canEdit={canEdit} hasToken={!!token}
          onKonsolidator={() => open("import", { mode: "konsolidator" })}
          onExcel={() => open("import", { mode: "excel" })}
          onTemplate={() => doExport(true)}
          onScratch={() => (structure ? open("add") : open("structure", { isFirst: true, thenAdd: true }))} />
      ) : (
        <>
          {(tab === "tree" || tab === "chart") && (
            <GroupBand tx={tx} perimeter={perimeter} warnings={warnings} structure={structure} date={date} onWarnings={() => setShowWarn(v => !v)} />
          )}
          <div className={cx(s.body, st.body)}>
            {per.loading && (tab === "tree" || tab === "chart") && <div className={st.veil}><Loader2 size={18} className={st.spin} /></div>}
            {tab === "tree" && (
              <div className={st.treeRow}>
                <TreeTable tx={tx} perimeter={perimeter} canEdit={canEdit} onOpen={setDrawer} onAction={onAction} warningsBy={warningsBy} />
                {showWarn && <WarningsPanel tx={tx} warnings={warnings} onOpen={setDrawer} onClose={() => setShowWarn(false)} />}
              </div>
            )}
            {tab === "chart" && (
              <div className={cx(s.treeRow, st.chartRow)}>
                <OrgCanvas key={`${structureId}|${date}`} nodes={chart.nodes} detached={[]} idx={chart.idx} companies={chart.companies}
                  ownership={chart.ownership} groupStructure={[]} selected={null}
                  onSelect={(code) => { const id = code && idByCode.get(code); if (id) setDrawer(id); }}
                  focus={null} primary={primary} t={t} structKey={structure?.name} />
                {showWarn && <WarningsPanel tx={tx} warnings={warnings} onOpen={setDrawer} onClose={() => setShowWarn(false)} />}
              </div>
            )}
            {tab === "companies" && (
              <div className={s.scroll}><CompaniesView tx={tx} data={data} perimeter={perimeter} date={date} search={search} onOpen={setDrawer} /></div>
            )}
            {tab === "settings" && (
              <div className={s.scroll}><SettingsView key={`${version}`} tx={tx} data={data} companyId={companyId} canEdit={canEdit} onChanged={reload} notify={notify} /></div>
            )}
            {tab === "history" && (
              <div className={s.scroll}><HistoryView key={`${version}`} tx={tx} data={data} companyId={companyId} users={users} onOpen={setDrawer} /></div>
            )}
          </div>
        </>
      )}

      {drawer && (
        <EntityDrawer key={`${drawer}|${version}`} tx={tx} data={data} companyId={companyId} entityId={drawer} perimeter={perimeter} structure={structure}
          date={date} canEdit={canEdit} users={users} onClose={() => setDrawer(null)} onAction={onAction} onChanged={reload} notify={notify} />
      )}

      {dialog?.type === "operation" && (
        <OperationDialog tx={tx} data={data} companyId={companyId} structure={structure} perimeter={perimeter} date={date}
          preset={dialog.props.preset} onDone={done} onClose={close} />
      )}
      {dialog?.type === "add" && (
        <AddCompanyDialog tx={tx} data={data} companyId={companyId} structure={dialog.props.structure ?? structure} perimeter={dialog.props.structure ? [] : perimeter} date={date} onDone={done} onClose={close} />
      )}
      {dialog?.type === "node" && structure && (
        <NodeDialog tx={tx} data={data} structure={structure} perimeter={perimeter} entityId={dialog.props.entityId} date={date} onDone={done} onClose={close} />
      )}
      {dialog?.type === "exit" && structure && (
        <ExitDialog tx={tx} data={data} structure={structure} entityId={dialog.props.entityId} date={date} onDone={done} onClose={close} />
      )}
      {dialog?.type === "structure" && (
        <StructureDialog tx={tx} companyId={companyId} structure={dialog.props.structure} isFirst={dialog.props.isFirst ?? !data.structures.length}
          onClose={close}
          onDone={(msg, row) => {
            notify(msg);
            if (row?.id) setStructureId(row.id);
            if (dialog.props.thenAdd && row?.id) setDialog({ type: "add", props: { structure: row } }); else close();
            reload();
          }} />
      )}
      {dialog?.type === "import" && (
        <ImportDialog tx={tx} mode={dialog.props.mode} token={token} data={data} companyId={companyId} onClose={close}
          onDone={(msg, newStructureId) => {
            close(); notify(msg);
            if (newStructureId) setStructureId(newStructureId);
            setDate(todayIso());
            reload();
          }} />
      )}

      {toast && (
        <div key={toast.id} className={cx(st.toast, toast.kind === "bad" && st.toastBad)} role="status">
          {toast.kind === "bad" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label={tx("close")}><X size={13} /></button>
        </div>
      )}
    </div>
  );
}
