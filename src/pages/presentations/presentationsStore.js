/* ══════════════════════════════════════════════════════════════════════
   Presentaciones guardadas en Supabase (antes, en el navegador).

   Tablas (ver presentations_supabase.sql):
     · presentations        → una fila por presentación; el contenido
                              (diapositivas, temas, filtros…) va en "content"
     · presentation_shares  → con quién se comparte y si puede editar
   Visibilidad: private (solo quien la crea) · company (toda la empresa,
   lectura) · shared (las personas elegidas).

   Guardado: los cambios se aplican al momento en pantalla y se escriben en
   Supabase agrupados (700 ms sin cambios). saveState indica "saving",
   "saved", "error" o "conflict". Al entrar por primera vez se suben las
   presentaciones que hubiera en el navegador (como privadas) y se deja una
   copia local.

   Para no perder nada:
     · Cada guardado comprueba que la fila no ha cambiado desde que se leyó
       (updated_at). Si otra persona u otra pestaña guardó entre medias, no se
       pisa su versión: la nuestra se guarda como copia privada, se carga la
       suya y se avisa (notice).
     · Un guardado que no toca ninguna fila (sin permiso o borrada) ya no se
       da por bueno: también se guarda como copia.
     · Si falla la red, se reintenta solo (3 s, 10 s, 30 s, 60 s…).
     · Se guarda lo pendiente al cambiar de pestaña, al ocultar la página y
       al salir.
     · Los guardados van en fila, uno detrás de otro (nunca dos a la vez).
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const LOCAL_KEY = "konsolidator:presentations:v1";
const SAVE_DELAY = 700;
const META = ["id", "name", "createdAt", "updatedAt", "createdBy", "visibility", "ownerId", "isOwner", "canEdit", "shares", "companyId", "docType"];

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

// Fila de Supabase → objeto que usa la página (mismo formato que antes).
function fromRow(row, me, shares) {
  const mine = shares.filter(s => s.presentation_id === row.id);
  const meShare = mine.find(s => s.user_id === me?.id);
  const isOwner = row.owner_id === me?.id;
  return {
    ...(row.content ?? {}),
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: { id: row.owner_id, name: row.owner_name ?? "" },
    ownerId: row.owner_id,
    companyId: row.company_id,
    visibility: row.visibility,
    docType: row.doc_type ?? "deck",   // "deck" (PowerPoint) | "memory" (memoria)
    isOwner,
    canEdit: isOwner || !!meShare?.can_edit,
    shares: isOwner ? mine.map(s => ({ userId: s.user_id, canEdit: !!s.can_edit })) : [],
  };
}

// Objeto de la página → contenido a guardar (todo menos los metadatos).
function contentOf(p) {
  const out = {};
  Object.keys(p).forEach(k => { if (!META.includes(k)) out[k] = p[k]; });
  return out;
}

export function usePresentationsStore({ companyId: companyIdProp, me, meChecked = true }) {
  const [presentations, setPresentations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error | conflict
  const [notice, setNotice] = useState(null);          // { kind, name, copyName } tras un conflicto
  const pending = useRef(new Map());   // id → presentación pendiente de guardar
  const stamps = useRef(new Map());    // id → updated_at del servidor (última versión leída o escrita)
  const chain = useRef(Promise.resolve());
  const creating = useRef(new Map());  // id → alta en curso (el primer guardado la espera)
  const retry = useRef({ timer: null, n: 0 });
  const timer = useRef(null);
  // Empresa: la de los ajustes; si no viene, la primera empresa activa del
  // usuario en accounts.user_companies. Sin empresa o sin sesión no se queda
  // "cargando": se avisa.
  const [fallbackCompany, setFallbackCompany] = useState(null);
  const companyId = companyIdProp || fallbackCompany;
  useEffect(() => {
    if (!meChecked) return;
    let alive = true;
    (async () => {
      if (!me?.id) {
        if (alive) { setError("No hay sesión de usuario."); setLoading(false); }
        return;
      }
      if (companyIdProp) return;
      const { data, error: e } = await supabase.schema("accounts").from("user_companies")
        .select("company_id").eq("user_id", me.id).eq("is_active", true).limit(1);
      if (!alive) return;
      const cid = data?.[0]?.company_id ?? null;
      if (cid) setFallbackCompany(cid);
      else { setError(e?.message ?? "No se ha encontrado la empresa del usuario."); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [companyIdProp, me, meChecked]);

  const latest = useRef([]);
  useLayoutEffect(() => { latest.current = presentations; }, [presentations]);

  // ── Carga ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!companyId || !me?.id) return;
    let res;
    try {
      res = await Promise.race([
        Promise.all([
          supabase.from("presentations").select("*").eq("company_id", companyId).order("updated_at", { ascending: false }),
          supabase.from("presentation_shares").select("presentation_id, user_id, can_edit"),
        ]),
        new Promise((_, rej) => setTimeout(() => rej(new Error("El servidor tarda demasiado en responder.")), 15000)),
      ]);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const [{ data: rows, error: e1 }, { data: shares, error: e2 }] = res;
    if (e1 || e2) {
      setError((e1 ?? e2).message);
      setLoading(false);
      return;
    }
    setError(null);
    (rows ?? []).forEach(r => { if (!pending.current.has(r.id)) stamps.current.set(r.id, r.updated_at); });
    // No pisar lo que el usuario está editando y aún no se ha guardado.
    setPresentations(prev => {
      const fresh = (rows ?? []).map(r => fromRow(r, me, shares ?? []));
      return fresh.map(p => (pending.current.has(p.id) ? (prev.find(x => x.id === p.id) ?? p) : p));
    });
    setLoading(false);
  }, [companyId, me]);

  // Carga al entrar y al cambiar de empresa (diferida: no se pinta dentro del efecto).
  useEffect(() => { queueMicrotask(load); }, [load]);

  // Al volver a la pestaña, se recargan (cambios de compañeros).
  useEffect(() => {
    const onFocus = () => { if (!pending.current.size) load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // ── Migración única desde el navegador ───────────────────────────────
  const migrated = useRef(false);
  useEffect(() => {
    if (loading || migrated.current || !companyId || !me?.id) return;
    migrated.current = true;
    const flag = `${LOCAL_KEY}:migrated:${companyId}:${me.id}`;
    let local = [];
    try {
      if (localStorage.getItem(flag)) return;
      local = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    } catch { return; }
    if (!Array.isArray(local) || local.length === 0) {
      try { localStorage.setItem(flag, "1"); } catch { /* sin almacenamiento */ }
      return;
    }
    (async () => {
      const rows = local.map(p => ({
        id: uuid(), company_id: companyId, owner_id: me.id, owner_name: me.name ?? "",
        name: p.name ?? "", visibility: "private", content: contentOf(p),
        created_at: p.createdAt ?? new Date().toISOString(),
      }));
      const { error: e } = await supabase.from("presentations").insert(rows);
      if (!e) {
        // Se suben una sola vez por navegador: se retiran de la clave antigua
        // (queda una copia de seguridad) para que otro usuario que entre en
        // este mismo navegador no las importe otra vez como suyas.
        try {
          localStorage.setItem(`${LOCAL_KEY}:backup`, JSON.stringify(local));
          localStorage.removeItem(LOCAL_KEY);
          localStorage.setItem(flag, "1");
        } catch { /* sin almacenamiento */ }
        load();
      }
    })();
  }, [loading, companyId, me, load]);

  // ── Guardado diferido ────────────────────────────────────────────────
  // Guarda una copia privada con nuestra versión (cuando no se puede escribir
  // encima de la original sin pisar lo de otra persona).
  const saveAsCopy = useCallback(async (p) => {
    const hhmm = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const copyName = `${p.name ?? ""} (${hhmm})`.trim();
    const { error: e } = await supabase.from("presentations").insert({
      id: uuid(), company_id: p.companyId ?? companyId, owner_id: me?.id, owner_name: me?.name ?? "",
      name: copyName, visibility: "private", content: contentOf(p), doc_type: p.docType ?? "deck",
    });
    return e ? null : copyName;
  }, [companyId, me]);

  const flushNow = useCallback(async () => {
    clearTimeout(timer.current);
    clearTimeout(retry.current.timer);
    const items = [...pending.current.values()];
    pending.current.clear();
    if (!items.length) return;
    setSaveState("saving");
    let failed = null;
    let conflict = null;
    for (const p of items) {
      if (creating.current.has(p.id)) await creating.current.get(p.id);
      const stamp = stamps.current.get(p.id);
      let q = supabase.from("presentations")
        .update({ name: p.name ?? "", content: contentOf(p), updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (stamp) q = q.eq("updated_at", stamp);
      const { data, error: e } = await q.select("id, updated_at");
      if (e) {
        failed = e;
        // Se vuelve a intentar (salvo que ya haya una versión más nueva en cola)
        if (!pending.current.has(p.id)) pending.current.set(p.id, p);
        continue;
      }
      if (data?.length) { stamps.current.set(p.id, data[0].updated_at); continue; }
      // No se ha escrito ninguna fila: otra versión más nueva, borrada o sin permiso
      const { data: row } = await supabase.from("presentations").select("id, updated_at").eq("id", p.id).maybeSingle();
      const newest = pending.current.get(p.id) ?? p;   // lo último que ha escrito el usuario
      const copyName = await saveAsCopy(newest);
      pending.current.delete(p.id);
      const sameVersion = row && stamp && new Date(row.updated_at).getTime() === new Date(stamp).getTime();
      if (row) stamps.current.set(p.id, row.updated_at);
      conflict = { kind: !row ? "gone" : sameVersion ? "denied" : "conflict", name: p.name ?? "", copyName };
    }
    if (conflict) {
      setNotice(conflict);
      setSaveState("conflict");
      load();
      return;
    }
    if (failed) {
      setSaveState("error");
      setError(failed.message);
      const n = ++retry.current.n;
      const wait = [3000, 10000, 30000, 60000][Math.min(n - 1, 3)];
      retry.current.timer = setTimeout(() => retry.current.run?.(), wait);
      return;
    }
    retry.current.n = 0;
    setSaveState(pending.current.size ? "saving" : "saved");
  }, [saveAsCopy, load]);

  // Los guardados van en fila: nunca dos a la vez sobre la misma presentación
  const flush = useCallback(() => {
    chain.current = chain.current.then(flushNow, flushNow);
    return chain.current;
  }, [flushNow]);
  useLayoutEffect(() => { retry.current.run = flush; }, [flush]);

  const schedule = useCallback((p) => {
    pending.current.set(p.id, p);
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  // Guardar lo pendiente al cambiar de pestaña, al ocultar la página y al salir.
  useEffect(() => {
    const onHide = () => { if (pending.current.size) flush(); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("beforeunload", onHide);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      onHide();
    };
  }, [flush]);

  // ── Operaciones ──────────────────────────────────────────────────────
  const create = useCallback(({ name, slides, docType = "deck", ...rest }) => {
    const id = uuid();
    const now = new Date().toISOString();
    const p = {
      ...rest, slides, id, name, createdAt: now, updatedAt: now,
      createdBy: { id: me?.id, name: me?.name ?? "" }, ownerId: me?.id, companyId,
      visibility: "private", isOwner: true, canEdit: true, shares: [], docType,
    };
    setPresentations(prev => [p, ...prev]);
    const job = supabase.from("presentations").insert({
      id, company_id: companyId, owner_id: me?.id, owner_name: me?.name ?? "",
      name, visibility: "private", content: contentOf(p), doc_type: docType, updated_at: now,
    }).select("updated_at").then(({ data, error: e }) => {
      if (e) {
        setError(e.message);
        setPresentations(prev => prev.filter(x => x.id !== id));
        return;
      }
      if (data?.[0]?.updated_at && !stamps.current.has(id)) stamps.current.set(id, data[0].updated_at);
    });
    creating.current.set(id, job);
    job.finally(() => creating.current.delete(id));
    return id;
  }, [companyId, me]);

  const update = useCallback((id, fn) => {
    const cur = latest.current.find(p => p.id === id);
    if (!cur || !cur.canEdit) return;
    const next = { ...fn(cur), updatedAt: new Date().toISOString() };
    latest.current = latest.current.map(p => (p.id === id ? next : p));
    setPresentations(prev => prev.map(p => (p.id === id ? next : p)));
    schedule(next);
  }, [schedule]);

  const remove = useCallback(async (id) => {
    const before = latest.current;
    pending.current.delete(id);
    setPresentations(prev => prev.filter(p => p.id !== id));
    const { error: e } = await supabase.from("presentations").delete().eq("id", id);
    if (e) { setError(e.message); setPresentations(before); }
  }, []);

  const duplicate = useCallback((id, suffix, newSlideId) => {
    const src = latest.current.find(p => p.id === id);
    if (!src) return null;
    const copy = contentOf(src);
    return create({
      ...copy,
      docType: src.docType ?? "deck",
      name: `${src.name} ${suffix}`.trim(),
      slides: (src.slides ?? []).map(s => ({ ...s, id: newSlideId ? newSlideId() : uuid() })),
    });
  }, [create]);

  // Visibilidad y personas: solo quien la crea.
  const share = useCallback(async (id, { visibility, shares }) => {
    // Antes de cambiar la visibilidad se guarda lo pendiente (va con su sello)
    await flush();
    const now = new Date().toISOString();
    const { data: d1, error: e1 } = await supabase.from("presentations").update({ visibility, updated_at: now }).eq("id", id).select("updated_at");
    if (e1) { setError(e1.message); return false; }
    if (d1?.[0]?.updated_at) stamps.current.set(id, d1[0].updated_at);
    const { error: e2 } = await supabase.from("presentation_shares").delete().eq("presentation_id", id);
    if (e2) { setError(e2.message); return false; }
    const rows = visibility === "shared"
      ? (shares ?? []).map(s => ({ presentation_id: id, user_id: s.userId, can_edit: !!s.canEdit }))
      : [];
    if (rows.length) {
      const { error: e3 } = await supabase.from("presentation_shares").insert(rows);
      if (e3) { setError(e3.message); return false; }
    }
    setPresentations(prev => prev.map(p => (p.id === id ? { ...p, visibility, shares: visibility === "shared" ? (shares ?? []) : [] } : p)));
    return true;
  }, [flush]);

  // Usuarios de la empresa (para el diálogo de compartir).
  const companyUsers = useCallback(async () => {
    if (!companyId) return [];
    const { data, error: e } = await supabase.rpc("pres_company_users", { cid: companyId });
    if (e) { setError(e.message); return []; }
    return (data ?? []).map(u => ({ id: u.user_id, name: u.name, email: u.email }));
  }, [companyId]);

  return useMemo(() => ({
    presentations, loading, error, saveState, notice,
    create, update, remove, duplicate, share, companyUsers, reload: load, clearError: () => setError(null),
    clearNotice: () => { setNotice(null); setSaveState(st => (st === "conflict" ? "saved" : st)); },
  }), [presentations, loading, error, saveState, notice, create, update, remove, duplicate, share, companyUsers, load]);
}
