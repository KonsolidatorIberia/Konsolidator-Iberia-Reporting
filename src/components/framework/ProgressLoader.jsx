/* ══════════════════════════════════════════════════════════════════════
   ProgressLoader — cargador común de la aplicación (mismo aspecto que el
   de la Home): anillo de progreso con degradado, órbita punteada lenta,
   arco rápido, logo en el centro, porcentaje, título, subtítulo, fases y
   una línea de detalle opcional.

   El porcentaje sale de datos reales y nunca baja:
     · `steps`: fases con peso y avance real, p. ej.
         [{ key: "meta", label: "Metadatos", weight: 2, state: "done" },
          { key: "data", label: "Datos",     weight: 6, state: "active", progress: 0.5 }]
       state: "pending" | "active" | "done" · progress: 0..1 dentro de la fase
     · o bien `progress` (0..100) si la página ya lo calcula.
   Mientras una fase sigue activa el número avanza despacio hacia el final de
   esa fase (para que se vea vivo), pero no la da por terminada hasta que lo
   está de verdad. Al pasar `visible` a false sube al 100 % y se desvanece
   (con `failed` se desvanece sin completar: la carga ha terminado en error).

   Relevo (`relay`): el cargador de las rutas (mientras se descarga el código
   de la página) pasa el testigo al cargador de la página que aparece justo
   después: este empieza en el mismo porcentaje, sin volver a "saltar" con la
   animación de entrada, y se desliza desde donde estaba el anterior. Así se
   ve un único cargador de principio a fin, en vez de un círculo pequeño y
   luego el bueno.

   Uso:
     <ProgressLoader visible={busy} steps={steps} title="Cargando…" />
     — dentro de un contenedor con position: relative (cubre solo ese
       contenedor), o con `fixed` para cubrir toda la pantalla.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import s from "./ProgressLoader.module.css";

const FINISH_MS = 280;   // subida al 100 % antes de desvanecerse
const FADE_MS = 420;     // desvanecido
const CREEP_MS = 3800;   // ritmo del avance "vivo" dentro de una fase
const RELAY_MS = 1500;   // margen para recoger el testigo de un cargador `relay`

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Testigo del último cargador `relay`: su porcentaje y dónde estaba su tarjeta.
// Vive fuera de React porque el cargador que lo recoge se monta en el mismo
// instante en que el anterior desaparece.
const relay = { live: false, pct: 0, rect: null, at: 0 };
const relayFresh = () => relay.live || performance.now() - relay.at < RELAY_MS;

// Avance real y techo (hasta dónde puede avanzar solo) a partir de las fases
function measure(steps, progress) {
  if (!steps?.length) {
    const real = clamp(Number(progress) || 0, 0, 100);
    return { real, ceil: real >= 100 ? 100 : Math.min(97, real + (100 - real) * 0.6) };
  }
  let total = 0, real = 0, ceil = 0;
  for (const st of steps) {
    const w = Math.max(0, st.weight ?? 1);
    const f = st.state === "done" ? 1 : clamp(Number(st.progress) || 0, 0, 1);
    total += w;
    real += w * f;
    ceil += w * (st.state === "active" ? Math.max(f, 0.92) : f);
  }
  if (!total) return { real: 0, ceil: 0 };
  return { real: (real / total) * 100, ceil: (ceil / total) * 100 };
}

export default function ProgressLoader({
  visible = true,
  steps,
  progress,
  title,
  subtitle,
  detail,
  primary = "#1a2f8a",
  secondary = "#CF305D",
  logo = "/favicon.svg",
  fixed = false,
  failed = false,
  relay: isRelay = false,
  hideSteps = false,
  className = "",
  style,
}) {
  const gradId = `pl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { real, ceil } = measure(steps, progress);

  // Fase de la animación: "on" (cargando) → "finish" (al 100 %) → "fade" → "off"
  const [phase, setPhase] = useState(visible ? "on" : "off");
  // ¿Recoge el testigo de un cargador anterior? (se decide al montarse)
  const [relayed] = useState(() => (visible && !isRelay && relayFresh() ? { pct: relay.pct, rect: relay.rect } : null));
  const [shown, setShown] = useState(() => relayed?.pct ?? 0);
  const cardRef = useRef(null);
  const shownRef = useRef(shown);

  // Cargador que pasa el testigo: publica su avance y, al desmontarse, deja
  // apuntado dónde estaba su tarjeta (la limpieza de un efecto de diseño
  // corre antes de quitarlo del DOM).
  useLayoutEffect(() => {
    if (!isRelay) return undefined;
    relay.live = true;
    const card = cardRef.current;
    return () => {
      relay.live = false;
      relay.pct = shownRef.current;
      relay.rect = card?.isConnected ? card.getBoundingClientRect() : null;
      relay.at = performance.now();
    };
  }, [isRelay]);
  useEffect(() => {
    shownRef.current = shown;
    if (isRelay) relay.pct = shown;
  }, [isRelay, shown]);

  // Cargador que recoge el testigo: se desliza desde la posición del anterior
  useLayoutEffect(() => {
    if (!relayed) return;
    relay.at = 0;
    const el = cardRef.current;
    const from = relay.rect ?? relayed.rect;
    if (!el || !from || typeof el.animate !== "function") return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [relayed]);
  // Patrón "ajustar estado al cambiar una prop": un nuevo ciclo de carga
  // vuelve a empezar desde cero; uno que termina pasa a "finish".
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) { setPhase("on"); setShown(0); }
    else if (phase !== "off") setPhase(failed ? "fade" : "finish");
  }

  // Encadena finish → fade → off
  useEffect(() => {
    if (phase === "finish") {
      const t = setTimeout(() => setPhase("fade"), FINISH_MS);
      return () => clearTimeout(t);
    }
    if (phase === "fade") {
      const t = setTimeout(() => setPhase("off"), FADE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  // Objetivo vivo para el bucle de animación (se lee solo dentro del rAF)
  const target = useRef({ real: 0, ceil: 0, since: 0, finishing: false });
  useEffect(() => {
    const cur = target.current;
    const now = performance.now();
    if (real !== cur.real) cur.since = now;
    cur.real = real;
    cur.ceil = Math.max(real, ceil);
    cur.finishing = phase === "finish" || (phase === "fade" && !failed);
  }, [real, ceil, phase, failed]);

  // Bucle de animación: solo mientras el cargador está en pantalla
  const running = phase !== "off";
  useEffect(() => {
    if (!running) return undefined;
    let raf = 0;
    const tick = () => {
      const { real: r, ceil: c, since, finishing } = target.current;
      const age = performance.now() - since;
      const goal = finishing ? 100 : r + (c - r) * (1 - Math.exp(-age / CREEP_MS));
      setShown(prev => {
        const next = prev + (goal - prev) * (finishing ? 0.22 : 0.08);
        const mono = Math.max(prev, Math.min(100, next));
        return Math.abs(mono - prev) < 0.02 ? prev : mono;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  if (phase === "off") return null;

  const R = 64;
  const C = 2 * Math.PI * R;
  const pct = phase === "on" || failed ? Math.min(99, Math.round(shown)) : Math.round(shown);
  const rootCls = [s.root, fixed ? s.fixed : s.inline, phase === "fade" ? s.gone : "", className].filter(Boolean).join(" ");

  return (
    <div className={rootCls} style={{ "--pl-primary": primary, "--pl-secondary": secondary, ...style }}
      role="status" aria-live="polite" aria-busy={phase === "on"}>
      <div ref={cardRef} className={relayed ? `${s.card} ${s.relayed}` : s.card}>
        <div className={s.hub}>
          <svg width="168" height="168" viewBox="-84 -84 168 168" aria-hidden="true">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={primary} />
                <stop offset="100%" stopColor={secondary} />
              </linearGradient>
            </defs>
            <circle r="78" fill="none" stroke="#e8ecf5" strokeDasharray="2 6" className={s.spinSlow} />
            <circle r={R} fill="none" stroke="#eef1f7" strokeWidth="8" />
            <circle r={R} fill="none" stroke={`url(#${gradId})`} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${C * clamp(shown / 100, 0.02, 1)} ${C}`} transform="rotate(-90)" />
            <g className={s.spinFast}>
              <circle r="52" fill="none" stroke={primary} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 52 * 0.14} ${2 * Math.PI * 52}`} />
            </g>
          </svg>
          <div className={s.core}>
            {logo ? <img src={logo} alt="" draggable={false} /> : null}
          </div>
        </div>

        <p className={s.pct} style={{ color: primary }}>{pct}<small>%</small></p>
        {title ? <p className={s.title}>{title}</p> : null}
        {subtitle ? <p className={s.sub}>{subtitle}</p> : null}

        {steps?.length > 1 && !hideSteps ? (
          <ol className={s.steps}>
            {steps.map(st => (
              <li key={st.key ?? st.label} className={s.step} data-state={st.state ?? "pending"}>
                <span className={s.stepDot} aria-hidden="true">
                  {st.state === "done" ? <Check size={9} strokeWidth={3.4} /> : null}
                </span>
                {st.label}
              </li>
            ))}
          </ol>
        ) : null}

        {detail ? <p className={s.detail}>{detail}</p> : null}
      </div>
    </div>
  );
}
