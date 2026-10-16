/* ══════════════════════════════════════════════════════════════════════
   Cálculos de las vistas: texto de los avisos, árbol del perímetro y
   eventos del historial en un formato común.
   ══════════════════════════════════════════════════════════════════════ */
import { fmtPctN, fmtDate } from "./studioText.js";

/* ── Texto de un aviso ────────────────────────────────────────────────── */
export function warnText(tx, w) {
  const d = w.detail ?? {};
  return tx(`w_${w.code}`, {
    e: w.entity_code ?? "—",
    c: d.classification ? tx(`cls_${d.classification}`).toLowerCase() : "",
    m: d.method ? tx(`mth_${d.method}`).toLowerCase() : "",
    v: fmtPctN(d.voting ?? 0, tx.lang),
    p: d.parent ?? "—",
    w: d.with ?? "—",
    d: fmtDate(d.end_date, tx.lang),
  });
}

// Los avisos de falta de mapeo se agrupan cuando son muchos
export function groupWarnings(tx, warnings) {
  const noMap = warnings.filter(w => w.code === "no_mapping");
  const rest = warnings.filter(w => w.code !== "no_mapping" || noMap.length <= 2).map(w => ({ ...w, text: warnText(tx, w) }));
  if (noMap.length > 2) {
    rest.push({ code: "no_mapping_many", entity_id: null, text: tx("w_no_mapping_many", { n: noMap.length, list: noMap.map(w => w.entity_code).join(", ") }) });
  }
  return rest;
}

/* ── Árbol a partir del perímetro ─────────────────────────────────────── */
export function perimeterTree(perimeter) {
  const ids = new Set(perimeter.map(p => p.entity_id));
  const kids = new Map(perimeter.map(p => [p.entity_id, []]));
  perimeter.forEach(p => { if (p.parent_entity_id && ids.has(p.parent_entity_id)) kids.get(p.parent_entity_id).push(p); });
  kids.forEach(list => list.sort((a, b) => (b.effective_pct ?? 0) - (a.effective_pct ?? 0) || a.code.localeCompare(b.code)));
  const roots = perimeter.filter(p => !p.parent_entity_id || !ids.has(p.parent_entity_id))
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.code.localeCompare(b.code));
  return { kids, roots };
}

const SOURCES = ["konsolidator", "excel", "import"];
const par = (x) => x.parent ?? x.parent_entity_id ?? null;

export function eventItems(tx, data, { entityId } = {}) {
  const code = new Map(data.entities.map(e => [e.id, e.code]));
  const stName = new Map(data.structures.map(s => [s.id, s.name]));
  const own = data.ownershipEvents
    .filter(e => !entityId || e.held_entity_id === entityId || e.holder_entity_id === entityId)
    .map(e => ({
      key: `o${e.id}`, kind: "ownership", date: e.effective_date, at: e.created_at, by: e.created_by, entityId: e.held_entity_id,
      title: tx(`ev_${e.event_type}`),
      text: tx("hist_pct_change", { h: code.get(e.holder_entity_id) ?? "?", d: code.get(e.held_entity_id) ?? "?", b: fmtPctN(e.economic_before, tx.lang), a: fmtPctN(e.economic_after, tx.lang) }),
      note: SOURCES.includes(e.note) ? null : e.note, tone: Number(e.economic_after) > Number(e.economic_before) ? "up" : Number(e.economic_after) < Number(e.economic_before) ? "down" : "flat",
    }));
  const str = data.structureEvents
    .filter(e => !entityId || e.entity_id === entityId)
    .map(e => {
      const a = e.after ?? {}, b = e.before ?? {};
      let text = stName.get(e.structure_id) ?? "";
      if (e.entity_id) {
        const parts = [code.get(e.entity_id) ?? "?"];
        if (e.event_type === "move") parts.push(`${code.get(par(b)) ?? "—"} → ${code.get(par(a)) ?? "—"}`);
        else if (par(a)) parts.push(`${tx("col_parent").toLowerCase()} ${code.get(par(a)) ?? "—"}`);
        if (e.event_type === "change" && b.classification) parts.push(`${tx(`cls_${b.classification}`)} · ${tx(`mth_${b.method}`)} → ${tx(`cls_${a.classification}`)} · ${tx(`mth_${a.method}`)}`);
        else if (a.classification && e.event_type !== "move") parts.push(`${tx(`cls_${a.classification}`)} · ${tx(`mth_${a.method}`)}`);
        text = `${parts.join(" · ")} — ${text}`;
      } else if (e.event_type === "import") {
        text = `${text} · ${tx("hist_import", { e: a.entities ?? 0, o: a.ownerships ?? 0, n: a.nodes ?? 0 })}`;
      }
      return {
        key: `s${e.id}`, kind: "structure", date: e.effective_date, at: e.created_at, by: e.created_by, entityId: e.entity_id,
        title: tx(`sev_${e.event_type}`), text, note: SOURCES.includes(e.note) ? null : e.note,
        tone: e.event_type === "exit" ? "down" : e.event_type === "enter" ? "up" : "flat",
      };
    });
  return [...own, ...str].sort((x, y) => String(y.date).localeCompare(String(x.date)) || String(y.at).localeCompare(String(x.at)));
}

