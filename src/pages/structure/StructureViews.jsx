/* ══════════════════════════════════════════════════════════════════════
   Estructura del grupo — pestañas de Empresas y Periodos.

   Empresas: tabla ordenable con filtros rápidos (consolidadas, tipo); cada
   fila lleva al organigrama con la sociedad elegida.
   Periodos: mapa de calor año × mes con el estado de cada cierre y un
   resumen arriba (último cierre, abiertos ahora, meses con periodo).
   ══════════════════════════════════════════════════════════════════════ */
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, GitBranch, Lock, Unlock, CheckCircle2, Building2 } from "lucide-react";
import { ccyColor, ownColor, initials, fmtPct, monthAbbr, monthFull, MONTHS_KEYS, useStText } from "./structureShared.js";
import s from "./structure.module.css";

const cx = (...c) => c.filter(Boolean).join(" ");

/* ── Empresas ─────────────────────────────────────────────────────────── */
export function CompaniesView({ companies, ownership, structKey, groupStructure, idx, search = "", onOpenInTree, t }) {
  const tx = useStText();
  const [cons, setCons] = useState("all");
  const [type, setType] = useState(null);
  const [sort, setSort] = useState({ key: "name", dir: 1 });

  const inStruct = useMemo(() => {
    const gsBy = new Map(groupStructure.filter(g => g.groupStructure === structKey).map(g => [g.companyShortName, g]));
    const owBy = new Map(ownership.map(o => [o.companyShortName, o]));
    return companies
      .filter(c => !structKey || gsBy.has(c.companyShortName))
      .map(c => {
        const g = gsBy.get(c.companyShortName);
        const ow = owBy.get(c.companyShortName);
        return {
          ...c,
          _type: c.recognizeAs || c.type || "",
          _parent: g?.parentShortName || "",
          _detached: !!g?.detached,
          _level: idx?.depth.get(c.companyShortName),
          _ow: ow,
          _pct: ow?.ownershipPercentage ?? null,
        };
      });
  }, [companies, ownership, structKey, groupStructure, idx]);

  const types = useMemo(() => {
    const m = new Map();
    inStruct.forEach(c => { if (c._type) m.set(c._type, (m.get(c._type) ?? 0) + 1); });
    return [...m.entries()];
  }, [inStruct]);

  const q = search.trim().toLowerCase();
  const rows = inStruct
    .filter(c => cons === "all" || (cons === "yes" ? c.consolidate : !c.consolidate))
    .filter(c => !type || c._type === type)
    .filter(c => !q || `${c.companyShortName} ${c.companyLegalName} ${c._parent} ${c.currencyCode}`.toLowerCase().includes(q));
  const val = {
    name: c => c.companyShortName || "",
    parent: c => c._parent,
    own: c => c._pct ?? -1,
    type: c => c._type,
    ccy: c => c.currencyCode || "",
    cons: c => (c.consolidate ? 1 : 0),
    from: c => (c.consolidateFromYear || 0) * 12 + (c.consolidateFromMonth || 0),
    map: c => c.mappingName || "",
  };
  rows.sort((a, b) => {
    const va = val[sort.key](a), vb = val[sort.key](b);
    return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "es", { sensitivity: "base" })) * sort.dir;
  });
  const nYes = inStruct.filter(c => c.consolidate).length;

  const th = (k, children, center) => (
    <th key={k} className={cx(center && s.thC)} aria-sort={sort.key === k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
      <button type="button" className={cx(s.thBtn, sort.key === k && s.thOn)}
        onClick={() => setSort(p => ({ key: k, dir: p.key === k ? -p.dir : 1 }))} title={`${tx.sortBy} ${children}`}>
        {children}
        {sort.key === k ? (sort.dir > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUp size={11} className={s.thGhost} />}
      </button>
    </th>
  );

  return (
    <div className={s.sheet}>
      <div className={s.sheetBar}>
        <div className={s.seg} role="group">
          {[["all", tx.all, inStruct.length], ["yes", tx.consolidated, nYes], ["no", tx.notConsolidatedF, inStruct.length - nYes]].map(([k, l, n]) => (
            <button key={k} type="button" className={cx(s.segBtn, s.segText, cons === k && s.segOn)} onClick={() => setCons(k)} aria-pressed={cons === k}>
              {l}<span className={s.segCount}>{n}</span>
            </button>
          ))}
        </div>
        {types.length > 1 && (
          <div className={s.chips}>
            {types.map(([ty, n]) => (
              <button key={ty} type="button" className={cx(s.chip, type === ty && s.chipOn)} onClick={() => setType(type === ty ? null : ty)} aria-pressed={type === ty}>
                {ty}<span>{n}</span>
              </button>
            ))}
          </div>
        )}
        <span className={s.sheetCount}>{tx.showing(rows.length, inStruct.length)}</span>
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              {th("name", t("st_col_short_name"))}
              {th("parent", tx.parentCol)}
              {th("own", t("st_col_ownership"))}
              {th("type", t("st_col_type"))}
              {th("ccy", t("st_col_currency"), true)}
              {th("cons", t("st_col_consolidate"), true)}
              {th("from", t("st_col_from"))}
              {th("map", t("st_col_mapping"))}
              <th aria-label={tx.openInTree} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const pct = c._pct;
              const to = c._ow?.toYear > 0;
              return (
                <tr key={c.companyShortName} className={s.tr} style={{ "--i": Math.min(i, 24) }}
                  onClick={() => !c._detached && onOpenInTree?.(c.companyShortName)}>
                  <td>
                    <div className={s.coCell}>
                      <span className={s.miniAv} style={{ "--cc": ccyColor(c.currencyCode) }}>{initials(c.companyShortName)}</span>
                      <span className={s.kidText}><b>{c.companyShortName}</b><small title={c.companyLegalName}>{c.companyLegalName}</small></span>
                    </div>
                  </td>
                  <td>{c._parent ? <span className={s.parentChip}>{c._parent}</span> : c._detached ? <span className={s.tagWarn}>{tx.detached}</span> : <span className={s.dash}>—</span>}</td>
                  <td>
                    {pct != null ? (
                      <div className={s.ownCell} style={{ "--oc": ownColor(pct) }}>
                        <div className={s.ownBarRow}>
                          <span className={s.ownBar}><i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></span>
                          <b>{fmtPct(pct)}%</b>
                        </div>
                        <small>
                          {c._ow?.fromMonth && c._ow?.fromYear ? `${tx.ownershipFrom} ${monthAbbr(t, c._ow.fromMonth - 1)} ${c._ow.fromYear}` : ""}
                          {to ? <em className={s.until}> · {tx.untilWord} {monthAbbr(t, (c._ow.toMonth || 12) - 1)} {c._ow.toYear}</em> : null}
                        </small>
                      </div>
                    ) : <span className={s.dash}>—</span>}
                  </td>
                  <td>{c._type ? <span className={s.tag}>{c._type}</span> : <span className={s.dash}>—</span>}</td>
                  <td className={s.tdC}><span className={s.tagCcy} style={{ "--cc": ccyColor(c.currencyCode) }}>{c.currencyCode}</span></td>
                  <td className={s.tdC}>
                    {c.consolidate
                      ? <span className={s.consYes}><CheckCircle2 size={13} />{t("st_yes")}</span>
                      : <span className={s.consNo}>{t("st_no")}</span>}
                  </td>
                  <td className={s.soft}>{c.consolidateFromMonth && c.consolidateFromYear ? `${monthAbbr(t, c.consolidateFromMonth - 1)} ${c.consolidateFromYear}` : <span className={s.dash}>—</span>}</td>
                  <td className={cx(s.soft, s.clip)} title={c.mappingName}>{c.mappingName || <span className={s.dash}>—</span>}</td>
                  <td className={s.tdGo}>
                    {!c._detached && <span className={s.goBtn} title={tx.openInTree}><GitBranch size={13} /></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className={s.emptyBlock}><Building2 size={20} /><p>{t("st_no_data")}</p></div>
        )}
      </div>
    </div>
  );
}

/* ── Periodos ─────────────────────────────────────────────────────────── */
export function PeriodsView({ periods, filterStruct = "all", filterSource = "all", t }) {
  const tx = useStText();
  const list = periods.filter(p =>
    (filterStruct === "all" || p.groupStructure === filterStruct) &&
    (filterSource === "all" || p.source === filterSource));

  const byYM = new Map();
  list.forEach(p => {
    const k = `${p.year}-${p.month}`;
    if (!byYM.has(k)) byYM.set(k, []);
    byYM.get(k).push(p);
  });
  const years = [...new Set(list.map(p => p.year).filter(Boolean))].sort((a, b) => b - a);
  const closed = list.filter(p => p.closed).length;
  const open = list.length - closed;
  const lastClosed = list.filter(p => p.closed).sort((a, b) => (b.year - a.year) || (b.month - a.month))[0];
  const openMonths = [...byYM.entries()].filter(([, ps]) => ps.some(p => !p.closed))
    .map(([k]) => k.split("-").map(Number)).sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
  const now = new Date();
  const nowY = now.getFullYear(), nowM = now.getMonth() + 1;
  const totalMonths = years.length * 12;
  const withPeriod = byYM.size;

  if (!list.length) {
    return <div className={s.emptyBlock}><Lock size={20} /><p>{t("st_no_period_data")}</p></div>;
  }

  return (
    <div className={s.periods}>
      <div className={s.pSummary}>
        <div className={s.pStat}>
          <span className={s.pStatLabel}>{tx.lastClosed}</span>
          <span className={s.pStatValue}>{lastClosed ? `${monthFull(t, lastClosed.month - 1)} ${lastClosed.year}` : tx.none}</span>
        </div>
        <div className={s.pStat}>
          <span className={s.pStatLabel}>{tx.openNow}</span>
          <span className={s.pStatValue}>{openMonths.length}</span>
          <span className={s.pStatSub}>{openMonths.slice(0, 3).map(([y, m]) => `${monthAbbr(t, m - 1)} ${y}`).join(", ")}{openMonths.length > 3 ? "…" : ""}</span>
        </div>
        <div className={s.pStat}>
          <span className={s.pStatLabel}>{tx.coverage}</span>
          <span className={s.pStatValue}>{withPeriod}<small>/{totalMonths}</small></span>
        </div>
        <div className={cx(s.pStat, s.pStatWide)}>
          <div className={s.pSplit}>
            <span><Lock size={12} />{t("st_n_closed").replace("{n}", closed)}</span>
            <span><Unlock size={12} />{t("st_n_open").replace("{n}", open)}</span>
          </div>
          <span className={s.pBar}><i style={{ width: `${list.length ? (closed / list.length) * 100 : 0}%` }} /></span>
        </div>
      </div>

      <div className={s.heat}>
        <div className={s.heatHead}>
          <span />
          {MONTHS_KEYS.map((_, i) => <span key={i}>{monthAbbr(t, i)}</span>)}
        </div>
        {years.map((y, yi) => {
          let yClosed = 0, yAny = 0;
          for (let m = 1; m <= 12; m++) {
            const ps = byYM.get(`${y}-${m}`);
            if (ps) { yAny++; if (ps.every(p => p.closed)) yClosed++; }
          }
          return (
            <div key={y} className={s.heatRow} style={{ "--r": yi }}>
              <div className={s.heatYear}>
                <b>{y}</b>
                <small>{tx.closedOf(yClosed, yAny)}</small>
              </div>
              {MONTHS_KEYS.map((_, i) => {
                const m = i + 1;
                const ps = byYM.get(`${y}-${m}`) ?? [];
                const state = !ps.length ? "none" : ps.every(p => p.closed) ? "closed" : ps.some(p => p.closed) ? "partial" : "open";
                const isNow = y === nowY && m === nowM;
                const title = ps.length
                  ? `${monthFull(t, i)} ${y}\n${ps.map(p => `${p.source ?? ""} · ${p.groupStructure ?? ""} · ${p.closed ? t("st_closed") : t("st_open_label")}`).join("\n")}`
                  : `${monthFull(t, i)} ${y} — ${t("st_no_data")}`;
                return (
                  <div key={m} className={cx(s.cell, s[`cell_${state}`], isNow && s.cellNow)} title={title} style={{ "--c": i }}>
                    {state === "closed" ? <Lock size={12} /> : state === "open" ? <Unlock size={12} /> : state === "partial" ? <Unlock size={12} /> : null}
                    {ps.length > 1 ? <span className={s.cellN}>{ps.length}</span> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className={s.heatLegend}>
        <span><i className={cx(s.lgSq, s.cell_closed)} />{tx.closedLegend}</span>
        <span><i className={cx(s.lgSq, s.cell_partial)} />{tx.partialLegend}</span>
        <span><i className={cx(s.lgSq, s.cell_open)} />{tx.openLegend}</span>
        <span><i className={cx(s.lgSq, s.cell_none)} />{tx.emptyLegend}</span>
      </div>
    </div>
  );
}