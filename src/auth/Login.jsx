import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { supabase, sbAccounts, getReportingStatus } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Check } from "lucide-react";
import BlockedPanel from "./BlockedPanel";
import ReleaseNotes, { ReleaseBadge, hasSeenRelease, markReleaseSeen } from "./ReleaseNotes";

const TOKEN_URL = "https://konsolidatorsignin.b2clogin.com/konsolidatorsignin.onmicrosoft.com/B2C_1_ropc/oauth2/v2.0/token";
const CLIENT_ID = "20e20379-2661-4066-b297-90c2e089e899";
const SCOPE = "https://konsolidatorsignin.onmicrosoft.com/1c72d99d-de80-416c-94d0-f84300b7d77e/User.Read";

/* ════════════════════════════════════════════════════════════════
   Transición al EpicLoader
   El login termina "consolidándose" en un núcleo en el mismo punto
   donde el EpicLoader tiene el suyo (centro, 43 % de alto). Antes de
   llamar a onLogin se deja en el <body> un "puente" con el mismo fondo
   y el mismo núcleo; el EpicLoader lo retira al montarse, así no hay
   ni un fotograma en blanco entre las dos pantallas.
   ════════════════════════════════════════════════════════════════ */
const LOGIN_HANDOFF_KEY = "k_login_handoff";
const HANDOFF_BG = "radial-gradient(120% 90% at 50% 38%, #3456d1 0%, #1a2f8a 46%, #0c1a5a 100%)";
const hubPoint = () => ({ x: window.innerWidth / 2, y: Math.round(window.innerHeight * 0.43) });

function mountHandoffBridge() {
  try {
    document.getElementById("k-handoff-bridge")?.remove();
    const { x, y } = hubPoint();
    const el = document.createElement("div");
    el.id = "k-handoff-bridge";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = `position:fixed;inset:0;z-index:10000;pointer-events:none;background:${HANDOFF_BG};transition:opacity 420ms ease;`;
    el.innerHTML = `
      <div style="position:absolute;left:${x}px;top:${y}px;width:900px;height:900px;margin:-450px 0 0 -450px;border-radius:50%;
        background:radial-gradient(circle, rgba(140,175,255,0.42) 0%, rgba(140,175,255,0.1) 38%, transparent 64%);"></div>
      <div style="position:absolute;left:${x - 80}px;top:${y - 80}px;width:160px;height:160px;border-radius:50%;display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;color:#fff;
        background:radial-gradient(circle at 35% 28%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 62%);
        box-shadow:inset 0 0 0 1px rgba(255,255,255,0.35), 0 24px 60px -18px rgba(5,12,50,0.8), 0 0 70px rgba(168,197,255,0.55);">
        <img src="/favicon.svg" alt="" style="width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 8px 18px rgba(5,12,50,0.45))" />
        <span style="font-size:15px;font-weight:900;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums">0<small style="font-size:10px;opacity:0.6;margin-left:1px">%</small></span>
      </div>`;
    document.body.appendChild(el);
    sessionStorage.setItem(LOGIN_HANDOFF_KEY, String(Date.now()));
    // Red de seguridad: si el cargador no llega a montarse, el puente se va solo
    setTimeout(() => {
      const b = document.getElementById("k-handoff-bridge");
      if (!b) return;
      b.style.opacity = "0";
      setTimeout(() => b.remove(), 450);
    }, 2600);
  } catch { /* sin puente: la transición sigue funcionando con el fundido normal */ }
}

/* ════════════════════════════════════════════════════════════════
   Universo de fondo (canvas): red de partículas que sigue al ratón
   y el grafo de consolidación (sociedades → núcleo) interactivo.
   ════════════════════════════════════════════════════════════════ */
function LoginUniverse({ engineRef, graphRef, rootRef }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current, root = rootRef.current;
    if (!canvas || !root) return undefined;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, raf = 0, last = performance.now();
    let particles = [], packets = [], shocks = [];
    const mouse = { x: -9999, y: -9999, inside: false, px: 0, py: 0 };
    const graph = { cx: 0, cy: 0, r: 150, rot: 0, nodes: [], hubPulse: 0, hidden: false };
    let activity = 0;                 // sube al escribir, al pasar por encima y al enviar
    let implode = null;               // { x, y, t0 } durante la salida
    let loading = false;

    const placeGraph = () => {
      const host = graphRef.current;
      if (host) {
        const r = host.getBoundingClientRect();
        graph.hidden = r.width < 10; // en pantallas estrechas el hero no se muestra
        graph.cx = r.left + r.width / 2; graph.cy = r.top + r.height / 2;
        graph.r = Math.max(90, Math.min(190, Math.min(r.width, r.height) * 0.36));
      } else { graph.cx = W * 0.3; graph.cy = H * 0.5; graph.r = 150; }
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = reduce ? 40 : Math.round(Math.min(120, (W * H) / 13000));
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: 0.8 + Math.random() * 1.5, a: 0.25 + Math.random() * 0.45,
      }));
      placeGraph();
      graph.nodes = Array.from({ length: 6 }, (_, i) => ({ base: (i / 6) * Math.PI * 2, ox: 0, oy: 0, x: 0, y: 0 }));
    };
    resize();
    window.addEventListener("resize", resize);
    const placeTimer = setInterval(placeGraph, 600); // el hero entra animado: se recoloca

    const sendPacket = (x0, y0, x1, y1, color = "255,255,255", speed = 0.55) => {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const bend = (Math.random() - 0.5) * 0.4 * len;
      packets.push({ x0, y0, x1, y1, cx: (x0 + x1) / 2 + (-dy / len) * bend, cy: (y0 + y1) / 2 + (dx / len) * bend,
        t: 0, speed: speed + Math.random() * 0.3, color });
    };
    const shock = (x, y, power = 1) => {
      shocks.push({ x, y, r: 4, a: 0.6 * power, power });
      particles.forEach(p => {
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
        if (d < 260 * power) { const f = (1 - d / (260 * power)) * 4.5 * power; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      });
    };

    engineRef.current = {
      pulse(amount = 0.35) { activity = Math.min(3, activity + amount); },
      setLoading(v) { loading = v; },
      implode(x, y) { implode = { x, y, t0: performance.now() }; shock(x, y, 1.2); },
      shockAt(x, y) { shock(x, y, 1); if (!graph.hidden) for (let i = 0; i < 8; i++) sendPacket(x, y, graph.cx, graph.cy, "255,214,170", 0.7); },
    };

    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; };
    const onLeave = () => { mouse.inside = false; };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);

    const bez = (p, t) => {
      const u = 1 - t;
      return { x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1, y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1 };
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const tx = mouse.inside ? (mouse.x / W - 0.5) * 2 : 0, ty = mouse.inside ? (mouse.y / H - 0.5) * 2 : 0;
      mouse.px += (tx - mouse.px) * (reduce ? 1 : 0.06);
      mouse.py += (ty - mouse.py) * (reduce ? 1 : 0.06);
      if (!reduce) {
        root.style.setProperty("--px", mouse.px.toFixed(4));
        root.style.setProperty("--py", mouse.py.toFixed(4));
        root.style.setProperty("--mx", `${Math.round(mouse.inside ? mouse.x : W / 2)}px`);
        root.style.setProperty("--my", `${Math.round(mouse.inside ? mouse.y : H / 3)}px`);
      }
      activity *= Math.pow(0.45, dt);
      const k = implode ? Math.min(1, (now - implode.t0) / 900) : 0;   // progreso de la implosión

      ctx.clearRect(0, 0, W, H);

      // ── Partículas
      for (const p of particles) {
        if (implode) {
          const dx = implode.x - p.x, dy = implode.y - p.y, d = Math.hypot(dx, dy) || 1;
          const f = 0.4 + k * 2.4;
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
          p.vx *= 0.9; p.vy *= 0.9;
        } else {
          if (mouse.inside && !reduce) {
            const dx = mouse.x - p.x, dy = mouse.y - p.y, d = Math.hypot(dx, dy);
            if (d < 200 && d > 1) { const f = (1 - d / 200) * 0.035; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
          }
          p.vx += (Math.random() - 0.5) * 0.015; p.vy += (Math.random() - 0.5) * 0.015;
          p.vx *= 0.975; p.vy *= 0.975;
          const sp = Math.hypot(p.vx, p.vy); if (sp > 3) { p.vx *= 3 / sp; p.vy *= 3 / sp; }
        }
        if (!reduce || implode) { p.x += p.vx; p.y += p.vy; }
        if (!implode) {
          if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20;
          if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20;
        }
      }
      const fade = 1 - k;
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120) {
            ctx.strokeStyle = `rgba(210,225,255,${(1 - Math.sqrt(d2) / 120) * 0.17 * (0.4 + fade * 0.6)})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        if (mouse.inside && !implode) {
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (d < 200) {
            ctx.strokeStyle = `rgba(255,255,255,${(1 - d / 200) * 0.42})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
          }
        }
      }
      for (const p of particles) {
        ctx.fillStyle = `rgba(255,255,255,${p.a * (0.3 + fade * 0.7)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }

      // ── Grafo de consolidación
      if (!graph.hidden) {
      graph.rot += dt * (0.06 + activity * 0.05 + (loading ? 0.25 : 0));
      const gx = implode ? graph.cx + (implode.x - graph.cx) * k : graph.cx + mouse.px * -10;
      const gy = implode ? graph.cy + (implode.y - graph.cy) * k : graph.cy + mouse.py * -10;
      const gr = graph.r * (1 - k * 0.9);
      ctx.setLineDash([2, 6]);
      [1, 0.72, 0.46].forEach((m, i) => {
        ctx.strokeStyle = `rgba(255,255,255,${(0.07 - i * 0.015) * (0.5 + fade * 0.5)})`;
        ctx.beginPath(); ctx.arc(gx, gy, gr * m * 1.12, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.setLineDash([]);
      graph.nodes.forEach((n, i) => {
        const ang = n.base + graph.rot;
        let nx = gx + Math.cos(ang) * gr, ny = gy + Math.sin(ang) * gr;
        // El ratón atrae a las sociedades cercanas
        if (mouse.inside && !implode) {
          const dx = mouse.x - nx, dy = mouse.y - ny, d = Math.hypot(dx, dy);
          const pull = d < 160 ? (1 - d / 160) * 26 : 0;
          n.ox += ((d ? dx / d : 0) * pull - n.ox) * 0.12; n.oy += ((d ? dy / d : 0) * pull - n.oy) * 0.12;
        } else { n.ox *= 0.9; n.oy *= 0.9; }
        nx += n.ox; ny += n.oy; n.x = nx; n.y = ny;
        const near = mouse.inside && Math.hypot(mouse.x - nx, mouse.y - ny) < 60;
        // conducto al núcleo
        ctx.setLineDash([3, 7]); ctx.lineDashOffset = -now / (loading ? 12 : 40);
        ctx.strokeStyle = `rgba(255,255,255,${(near ? 0.5 : 0.18 + activity * 0.08) * (0.4 + fade * 0.6)})`;
        ctx.lineWidth = near ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(gx, gy); ctx.stroke();
        ctx.setLineDash([]);
        // nodo
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, near ? 18 : 12);
        g.addColorStop(0, `rgba(255,255,255,${0.35 * fade + 0.1})`); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx, ny, near ? 18 : 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.95 * fade + 0.05})`;
        ctx.beginPath(); ctx.arc(nx, ny, near ? 4.2 : 3.2, 0, Math.PI * 2); ctx.fill();
        // paquetes hacia el núcleo
        const rate = 0.35 + activity * 1.2 + (loading ? 3 : 0) + (near ? 2 : 0);
        if (!reduce && !implode && Math.random() < rate * dt) sendPacket(nx, ny, gx, gy, i % 3 === 0 ? "255,190,200" : "255,255,255");
      });
      // núcleo
      graph.hubPulse += dt * (1.6 + activity + (loading ? 4 : 0));
      const hp = 14 + Math.sin(graph.hubPulse) * 4 + activity * 3;
      const hg = ctx.createRadialGradient(gx, gy, 0, gx, gy, hp * 2.4);
      hg.addColorStop(0, `rgba(232,57,74,${0.55 * fade})`); hg.addColorStop(1, "rgba(232,57,74,0)");
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(gx, gy, hp * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(232,57,74,${fade})`;
      ctx.beginPath(); ctx.arc(gx, gy, 7 + activity, 0, Math.PI * 2); ctx.fill();
      }

      // ── Paquetes
      ctx.globalCompositeOperation = "lighter";
      packets = packets.filter(p => {
        p.t += dt * p.speed;
        if (p.t >= 1) { activity = Math.min(3, activity + 0.02); return false; }
        for (let s = 5; s >= 0; s--) {
          const q = bez(p, Math.max(0, p.t - s * 0.02));
          ctx.fillStyle = `rgba(${p.color},${(1 - s / 6) * 0.55 * (0.3 + fade * 0.7)})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, 2 * (1 - s / 8), 0, Math.PI * 2); ctx.fill();
        }
        return true;
      });
      shocks = shocks.filter(s => {
        s.r += dt * 480 * Math.max(0.6, s.power * 0.8); s.a *= Math.pow(0.08, dt);
        ctx.strokeStyle = `rgba(255,255,255,${s.a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
        return s.a > 0.02;
      });
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(placeTimer);
      window.removeEventListener("resize", resize);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      engineRef.current = null;
    };
  }, [engineRef, graphRef, rootRef]);
  return <canvas ref={canvasRef} className="lgCanvas" aria-hidden="true" />;
}

const EQUATIONS = [
  "EBITDA = Revenue − COGS − OpEx",
  "NPV = Σ CFₜ / (1+r)ᵗ",
  "WACC = (E/V)·Rₑ + (D/V)·R_d·(1−T)",
  "ROIC = NOPAT / Invested Capital",
  "FCF = EBIT(1−t) + D&A − ΔWC − CapEx",
  "P/E = Price / EPS",
  "DSO = (AR / Revenue) × 365",
  "Net Margin = NI / Revenue",
  "Gross Margin = (Rev − COGS) / Rev",
  "DCF: Σ FCFₜ / (1+WACC)ᵗ + TV",
  "Quick Ratio = (CA − Inv) / CL",
  "D/E = Total Debt / Equity",
  "EV = MktCap + Debt − Cash",
];

const TICKERS = [
  { l: "EUR/USD", v: "1.0942", c: "#fbbf24" },
  { l: "GROUP NI", v: "+12.3%", c: "#34d399" },
  { l: "EBITDA",   v: "+8.4%",  c: "#34d399" },
  { l: "REVENUE",  v: "€42.1M", c: "#ffffff" },
  { l: "MARGIN",   v: "18.0%",  c: "#34d399" },
  { l: "CASH",     v: "€8.7M",  c: "#ffffff" },
  { l: "DSO",      v: "42 d",   c: "#fbbf24" },
  { l: "ROIC",     v: "14.2%",  c: "#34d399" },
];

const FEATURES = [
  { label: "Consolidated P&L", desc: "Live data" },
  { label: "Group KPIs",       desc: "Interactive" },
  { label: "Multi-currency",   desc: "Auto FX" },
  { label: "By Dimensions",    desc: "Drill down" },
];

// Botón "magnético": se desplaza un poco hacia el cursor
function useMagnet(strength = 0.18) {
  const ref = useRef(null);
  const onPointerMove = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mgx", `${(e.clientX - (r.left + r.width / 2)) * strength}px`);
    el.style.setProperty("--mgy", `${(e.clientY - (r.top + r.height / 2)) * strength}px`);
    el.style.setProperty("--hx", `${e.clientX - r.left}px`);
    el.style.setProperty("--hy", `${e.clientY - r.top}px`);
  };
  const onPointerLeave = () => {
    const el = ref.current; if (!el) return;
    el.style.setProperty("--mgx", "0px"); el.style.setProperty("--mgy", "0px");
  };
  return { ref, onPointerMove, onPointerLeave };
}


const LOGIN_CSS = `
.lgRoot { position: relative; height: 100vh; display: flex; flex-direction: column; overflow: hidden; isolation: isolate;
  --px: 0; --py: 0; --mx: 50vw; --my: 30vh;
  background: linear-gradient(180deg, #1a2f8a 0%, #3a5cd9 50%, #7a9fef 70%, #d8e4ff 100%); }
.lgHandoffBg { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0; background: ${HANDOFF_BG}; transition: opacity 820ms cubic-bezier(0.4,0,0.2,1); }
.lgOut .lgHandoffBg { opacity: 1; }
.lgBlob { position: absolute; z-index: 0; border-radius: 50%; pointer-events: none; transition: opacity 600ms ease; }
.lgBlobA { top: 8%; left: 6%; width: 620px; height: 620px; background: radial-gradient(circle, rgba(255,255,255,0.42), transparent 65%); filter: blur(60px);
  transform: translate(calc(var(--px) * -40px), calc(var(--py) * -30px)); }
.lgBlobB { top: 28%; right: 4%; width: 520px; height: 520px; background: radial-gradient(circle, rgba(168,197,255,0.55), transparent 65%); filter: blur(70px);
  transform: translate(calc(var(--px) * 30px), calc(var(--py) * 24px)); }
.lgGrain { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0.04; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.lgEqs { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; transition: opacity 500ms ease;
  transform: translate(calc(var(--px) * -14px), calc(var(--py) * -10px)); }
.lgEq { position: absolute; bottom: -10%; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; color: rgba(255,255,255,0.55); font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.lgCanvas { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.lgSpot { position: absolute; inset: 0; z-index: 1; pointer-events: none; background: radial-gradient(560px circle at var(--mx) var(--my), rgba(255,255,255,0.13), transparent 60%); transition: opacity 400ms ease; }

.lgTickers { position: absolute; z-index: 2; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.lgTickersTop { top: 28px; right: 40px; flex-direction: row; align-items: center; transform: translate(calc(var(--px) * 22px), calc(var(--py) * 16px)); }
.lgTickersBottom { bottom: 24px; right: 40px; flex-direction: row; align-items: center; transform: translate(calc(var(--px) * 30px), calc(var(--py) * 22px)); }
.lgTicker { display: flex; align-items: center; gap: 8px; padding: 5px 9px; border-radius: 8px; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
  color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.09); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16); backdrop-filter: blur(6px); white-space: nowrap;
  animation: lgFadeUp 700ms cubic-bezier(0.22,1,0.36,1) backwards; }
.lgTickerL { opacity: 0.6; }
.lgTicker i { width: 6px; height: 6px; border-radius: 50%; background: #34d399; animation: lgBlink 1.6s ease-in-out infinite; }

.lgHeader { position: absolute; top: 0; left: 0; right: 0; z-index: 30; display: flex; align-items: center; padding: 24px 40px; }
.lgBrand { display: flex; align-items: center; gap: 12px; animation: lgFadeUp 600ms cubic-bezier(0.22,1,0.36,1) backwards; }
.lgBrandMark { width: 36px; height: 36px; border-radius: 14px; background: #fff; display: grid; place-items: center; box-shadow: 0 10px 24px -10px rgba(5,12,50,0.6);
  transition: transform 400ms cubic-bezier(0.34,1.56,0.64,1); }
.lgBrand:hover .lgBrandMark { transform: rotate(-8deg) scale(1.08); }
.lgBrandMark span { color: #1a2f8a; font-weight: 900; font-size: 14px; }
.lgBrandName { color: #fff; font-weight: 900; font-size: 12px; letter-spacing: 0.2em; }
@media (max-width: 520px) { .lgHeader { padding: 20px; } }

.lgMain { position: relative; z-index: 10; flex: 1; display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; align-items: center;
  width: 100%; max-width: 1400px; margin: 0 auto; padding: 0 40px; }
@media (max-width: 1023px) { .lgMain { grid-template-columns: 1fr; padding: 90px 20px 30px; } .lgHero { display: none; } .lgTickers { display: none; } }
.lgHero { position: relative; padding: 0 32px 0 8px; transform: translate(calc(var(--px) * -8px), calc(var(--py) * -6px)); }
.lgGraphSlot { position: absolute; left: 50%; top: 50%; width: min(560px, 100%); aspect-ratio: 1; transform: translate(-50%, -50%); pointer-events: none; }
.lgHeroText { position: relative; z-index: 1; }
.lgEyebrow { margin: 0 0 12px; font-size: 10px; font-weight: 900; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.9);
  animation: lgFadeUp 700ms cubic-bezier(0.22,1,0.36,1) 80ms backwards; }
.lgTitle { margin: 0; color: #fff; font-weight: 900; line-height: 0.95; letter-spacing: -0.035em; font-size: clamp(48px, 6.5vw, 78px);
  text-shadow: 0 0 40px rgba(255,255,255,0.45), 0 0 80px rgba(168,197,255,0.55); perspective: 600px; }
.lgWord { display: inline-block; white-space: pre; transform-origin: 50% 100%; animation: lgWordIn 900ms cubic-bezier(0.22,1,0.36,1) calc(140ms + var(--w) * 80ms) backwards;
  transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1), color 300ms ease; }
.lgWord:hover { transform: translateY(-4px) rotate(-1.5deg); }
.lgWordDark { color: #0a1647; text-shadow: none; }
.lgLead { margin: 20px 0 0; max-width: 28rem; color: rgba(255,255,255,0.86); font-size: 16px; font-weight: 500; animation: lgFadeUp 800ms cubic-bezier(0.22,1,0.36,1) 520ms backwards; }
.lgFeatures { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 32px; max-width: 28rem; }
.lgFeature { padding: 10px 14px; border-radius: 16px; background: rgba(255,255,255,0.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22); backdrop-filter: blur(12px); cursor: default;
  transition: transform 360ms cubic-bezier(0.34,1.56,0.64,1), background 220ms ease, box-shadow 220ms ease; animation: lgFadeUp 700ms cubic-bezier(0.22,1,0.36,1) backwards; }
.lgFeature:hover { transform: translateY(-3px) scale(1.02); background: rgba(255,255,255,0.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4), 0 14px 30px -18px rgba(5,12,50,0.7); }
.lgFeatureL { margin: 0; color: #fff; font-weight: 900; font-size: 12px; }
.lgFeatureD { margin: 2px 0 0; color: rgba(255,255,255,0.65); font-size: 10px; font-weight: 500; }

/* Tarjeta de acceso */
.lgCard { position: relative; justify-self: end; width: 100%; max-width: 440px; border-radius: 36px; padding: 40px;
  background: rgba(255,255,255,0.62); border: 1px solid rgba(255,255,255,0.85);
  backdrop-filter: blur(28px) saturate(150%); -webkit-backdrop-filter: blur(28px) saturate(150%);
  box-shadow: 0 40px 100px -20px rgba(15,31,92,0.42), 0 12px 32px -10px rgba(15,31,92,0.2);
  transform: perspective(1200px) rotateX(calc(var(--rx, 0deg) + var(--py) * -1.5deg)) rotateY(calc(var(--ry, 0deg) + var(--px) * 2deg));
  transition: transform 500ms cubic-bezier(0.22,1,0.36,1), box-shadow 300ms ease;
  animation: lgCardIn 900ms cubic-bezier(0.22,1,0.36,1) 120ms backwards; }
@media (max-width: 1023px) { .lgCard { justify-self: center; padding: 30px; } }
.lgCard::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity 300ms ease;
  background: radial-gradient(420px circle at var(--cx, 50%) var(--cy, 0%), rgba(255,255,255,0.6), transparent 45%); }
.lgCard::after { content: ""; position: absolute; inset: -1px; border-radius: inherit; padding: 1.5px; pointer-events: none; opacity: 0; transition: opacity 300ms ease;
  background: radial-gradient(320px circle at var(--cx, 50%) var(--cy, 0%), rgba(232,57,74,0.85), rgba(122,159,239,0.7) 40%, transparent 70%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.lgCard:hover::before, .lgCard:hover::after, .lgCard:focus-within::after { opacity: 1; }
.lgCard:hover { box-shadow: 0 50px 110px -24px rgba(15,31,92,0.5), 0 14px 36px -10px rgba(15,31,92,0.24); }
.lgCard.lgShake { animation: lgShake 480ms cubic-bezier(0.36,0.07,0.19,0.97) both; }
.lgCardIn { position: relative; z-index: 1; }
.lgCardEyebrow { margin: 0 0 12px; font-size: 10px; font-weight: 900; letter-spacing: 0.22em; text-transform: uppercase; color: #e8394a; }
.lgCardTitle { margin: 0 0 4px; color: #0a1647; font-weight: 900; letter-spacing: -0.03em; font-size: clamp(28px, 2.6vw, 36px); line-height: 1.05; }
.lgCardTitle span { color: #e8394a; display: inline-block; animation: lgDot 2.4s ease-in-out 1.2s infinite; }
.lgCardSub { margin: 0 0 30px; color: rgba(26,47,138,0.55); font-size: 14px; font-weight: 500; }
.lgFields { display: flex; flex-direction: column; gap: 16px; }
.lgField { display: block; }
.lgFieldL { display: block; margin-bottom: 8px; font-size: 10px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,47,138,0.55); transition: color 200ms ease; }
.lgField:focus-within .lgFieldL { color: #1a2f8a; }
.lgInputWrap { position: relative; display: block; }
.lgInputIco { position: absolute; left: 16px; top: 50%; margin-top: -8px; color: rgba(26,47,138,0.35); transition: color 200ms ease, transform 300ms cubic-bezier(0.34,1.56,0.64,1); pointer-events: none; }
.lgField:focus-within .lgInputIco { color: #1a2f8a; transform: scale(1.12); }
.lgInput { width: 100%; box-sizing: border-box; padding: 14px 18px 14px 44px; border-radius: 16px; font-size: 14px; color: #0a1647; outline: none;
  background: rgba(255,255,255,0.65); border: 1px solid rgba(26,47,138,0.12); transition: border-color 200ms ease, background 200ms ease, box-shadow 250ms ease; }
.lgInputPw { padding-right: 46px; }
.lgInput::placeholder { color: rgba(26,47,138,0.3); }
.lgInput:hover { border-color: rgba(26,47,138,0.25); background: rgba(255,255,255,0.8); }
.lgInput:focus { border-color: #1a2f8a; background: #fff; box-shadow: 0 0 0 4px rgba(26,47,138,0.12), 0 10px 24px -14px rgba(26,47,138,0.5); }
.lgEye { position: absolute; right: 8px; top: 50%; width: 32px; height: 32px; margin-top: -16px; border: 0; border-radius: 10px; background: transparent; color: rgba(26,47,138,0.45);
  display: grid; place-items: center; cursor: pointer; transition: background 160ms ease, color 160ms ease; }
.lgEye:hover { background: rgba(26,47,138,0.08); color: #1a2f8a; }
.lgError { border-radius: 16px; padding: 12px 16px; background: rgba(232,57,74,0.08); border: 1px solid rgba(232,57,74,0.22); animation: lgFadeUp 300ms ease both; }
.lgError p { margin: 0; color: #e8394a; font-size: 12px; font-weight: 700; }

.lgBtn { position: relative; overflow: hidden; margin-top: 8px; width: 100%; padding: 16px; border: 0; border-radius: 20px; cursor: pointer; color: #fff; font: inherit; font-size: 14px; font-weight: 900; letter-spacing: 0.02em;
  background: linear-gradient(90deg, #e8394a 0%, #e8394a 40%, #ff5563 50%, #e8394a 60%, #e8394a 100%); background-size: 200% 100%; animation: lgShimmer 3s linear infinite;
  box-shadow: 0 14px 36px -10px rgba(232,57,74,0.6), inset 0 1px 0 rgba(255,255,255,0.2);
  transform: translate(var(--mgx, 0px), var(--mgy, 0px)); transition: transform 280ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 250ms ease; }
.lgBtn:hover { box-shadow: 0 20px 44px -12px rgba(232,57,74,0.75), inset 0 1px 0 rgba(255,255,255,0.25); }
.lgBtn:active { transform: translate(var(--mgx, 0px), var(--mgy, 0px)) scale(0.98); }
.lgBtn:focus-visible { outline: 3px solid rgba(26,47,138,0.4); outline-offset: 3px; }
.lgBtn.isLoading { cursor: progress; animation: none; background: repeating-linear-gradient(115deg, #e8394a 0 14px, #f04d5d 14px 28px); background-size: 200% 100%; animation: lgStripes 0.9s linear infinite; }
.lgBtn.isDone { animation: none; background: #16a34a; box-shadow: 0 14px 36px -10px rgba(22,163,74,0.6); }
.lgBtnGlow { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 250ms ease;
  background: radial-gradient(160px circle at var(--hx, 50%) var(--hy, 50%), rgba(255,255,255,0.35), transparent 60%); }
.lgBtn:hover .lgBtnGlow { opacity: 1; }
.lgBtnRow { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.lgBtnArrow { transition: transform 300ms cubic-bezier(0.34,1.56,0.64,1); }
.lgBtn:hover .lgBtnArrow { transform: translateX(4px); }
.lgSpin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; animation: lgRot 0.9s linear infinite; }
.lgRipple { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: rgba(255,255,255,0.55); pointer-events: none; animation: lgRipple 650ms ease-out forwards; }
.lgFoot1 { margin: 24px 0 0; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: rgba(26,47,138,0.55); }
.lgFoot2 { margin: 6px 0 0; text-align: center; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: rgba(26,47,138,0.4); }

/* Núcleo final (mismo que el del EpicLoader) */
.lgCoreGlow { position: absolute; z-index: 20; left: 50%; top: 43vh; width: 900px; height: 900px; margin: -450px 0 0 -450px; border-radius: 50%; pointer-events: none; opacity: 0;
  background: radial-gradient(circle, rgba(140,175,255,0.42) 0%, rgba(140,175,255,0.1) 38%, transparent 64%); }
.lgCore { position: absolute; z-index: 21; left: 50%; top: 43vh; width: 160px; height: 160px; margin: -80px 0 0 -80px; border-radius: 50%; pointer-events: none; opacity: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #fff;
  background: radial-gradient(circle at 35% 28%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 62%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35), 0 24px 60px -18px rgba(5,12,50,0.8), 0 0 70px rgba(168,197,255,0.55); }
.lgCore img { width: 64px; height: 64px; object-fit: contain; filter: drop-shadow(0 8px 18px rgba(5,12,50,0.45)); }
.lgCore span { font-size: 15px; font-weight: 900; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.lgCore small { font-size: 10px; opacity: 0.6; margin-left: 1px; }
.lgOut .lgCore { animation: lgCoreIn 600ms cubic-bezier(0.34,1.56,0.64,1) 520ms forwards; }
.lgOut .lgCoreGlow { animation: lgFadeIn 700ms ease 420ms forwards; }

/* Salida: todo converge en el núcleo */
.lgOut [data-piece] { animation: none !important; pointer-events: none;
  transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(0.08) !important; opacity: 0;
  transition: transform 640ms cubic-bezier(0.36,0.05,0.6,0.35) var(--d, 0ms), opacity 220ms ease-in calc(var(--d, 0ms) + 440ms) !important; }
.lgOut .lgEqs, .lgOut .lgSpot, .lgOut .lgBlob, .lgOut .lgGrain { opacity: 0; }
.lgOut .lgTickers { transform: none; }

@keyframes lgFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes lgFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes lgWordIn { from { opacity: 0; transform: translateY(45%) rotateX(-60deg); filter: blur(10px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes lgCardIn { from { opacity: 0; transform: perspective(1200px) translateY(26px) rotateX(10deg) scale(0.97); } to { opacity: 1; } }
@keyframes lgCoreIn { 0% { opacity: 0; transform: scale(0.15); } 60% { opacity: 1; } 100% { opacity: 1; transform: scale(1); } }
@keyframes lgShake { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-8px); } 40%, 60% { transform: translateX(8px); } }
@keyframes lgDot { 0%, 100% { transform: none; } 50% { transform: translateY(-3px) scale(1.25); } }
@keyframes lgShimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
@keyframes lgStripes { from { background-position: 0 0; } to { background-position: -56px 0; } }
@keyframes lgRipple { to { transform: scale(40); opacity: 0; } }
@keyframes lgRot { to { transform: rotate(360deg); } }
@keyframes lgBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes lgDrift { 0% { transform: translateY(0) rotate(0deg); opacity: 0; } 10% { opacity: 0.55; } 90% { opacity: 0.55; } 100% { transform: translateY(-80vh) rotate(8deg); opacity: 0; } }
@keyframes lgDriftSlow { 0% { transform: translateY(0) rotate(0deg); opacity: 0; } 10% { opacity: 0.45; } 90% { opacity: 0.45; } 100% { transform: translateY(-90vh) rotate(-6deg); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .lgWord, .lgCard, .lgFeature, .lgTicker, .lgBrand, .lgLead, .lgEyebrow, .lgEq, .lgBtn, .lgCardTitle span { animation: none !important; }
  .lgHero, .lgTickersTop, .lgTickersBottom, .lgBlobA, .lgBlobB, .lgEqs { transform: none !important; }
}
`;

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
const [syncPrompt, setSyncPrompt] = useState(null); // { acctUser, b2cToken, reporting, userEmail } | null
  const [syncing, setSyncing] = useState(false);
  const [dismantling, setDismantling] = useState(false);
  const [blocked, setBlocked] = useState(null); // { variant, email, company? } | null
  const [showPw, setShowPw] = useState(false);
  // Novedades de la 1.1: el "ping" de la insignia se apaga para siempre al abrirlas
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseSeen, setReleaseSeen] = useState(hasSeenRelease);

  const rootRef = useRef(null);
  const graphRef = useRef(null);
  const engineRef = useRef(null);
  const cardRef = useRef(null);
  const magnet = useMagnet(0.2);

  // El grafo se acelera mientras se valida el acceso
  useEffect(() => { engineRef.current?.setLoading(loading || syncing); }, [loading, syncing]);

  // Error → la tarjeta tiembla
  useEffect(() => {
    const el = cardRef.current;
    if (!error || !el) return;
    el.classList.remove("lgShake");
    void el.offsetWidth;
    el.classList.add("lgShake");
  }, [error]);

  // Salida: cada pieza calcula su viaje hasta el núcleo y el canvas implosiona ahí
  useLayoutEffect(() => {
    if (!dismantling || !rootRef.current) return;
    const { x, y } = hubPoint();
    rootRef.current.querySelectorAll("[data-piece]").forEach(el => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--tx", `${x - (r.left + r.width / 2)}px`);
      el.style.setProperty("--ty", `${y - (r.top + r.height / 2)}px`);
    });
    engineRef.current?.implode(x, y);
  }, [dismantling]);

const navigate = useNavigate();

// ──────────────────────────────────────────────────────────────
// finalizeSession: session-guard + onLogin tail. Extracted so the
// resync flow can reuse it after fixing a stale local password.
// ──────────────────────────────────────────────────────────────
const finalizeSession = async ({ b2cToken, acctUser, reporting, userEmail }) => {
  const SESSION_STALE_MS = 2 * 60 * 1000;

  const { data: existingSession } = await supabase
    .from("user_sessions")
    .select("last_seen")
    .eq("email", userEmail)
    .maybeSingle();

  if (existingSession) {
    const age = Date.now() - new Date(existingSession.last_seen).getTime();
    if (age < SESSION_STALE_MS) {
      setError("Another active session exists for this account. Please wait a moment and try again.");
      setLoading(false);
      setSyncing(false);
      return;
    }
  }

  const newSessionId = crypto.randomUUID();
  await supabase.from("user_sessions").upsert({
    email:      userEmail,
    session_id: newSessionId,
    last_seen:  new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  setLoading(false);
  setSyncing(false);

// Salida animada: el login se "consolida" en el núcleo y el EpicLoader
  // arranca desde ese mismo núcleo (puente en el <body> para no parpadear).
  setDismantling(true);
  setTimeout(() => {
    mountHandoffBridge();
    onLogin(
      b2cToken,
      { username, displayName: acctUser?.username ?? null },
      { username, password },
      reporting,
      newSessionId,
    );
  }, 1080);
};

const handleLogin = async () => {
  if (!username || !password) { setError("Invalid credentials. Please try again."); return; }
  setLoading(true);
  setError("");

// ════════════════════════════════════════════════════════
  // PASO 0: parallel independent calls
  // ════════════════════════════════════════════════════════
  const b2cPromise = (async () => {
    // Dev bypass — mirrors the one in Signup.jsx so the whole
    // signup-from-login flow is testable without real B2C users.
    const isDummyTest =
      import.meta.env.DEV &&
      username.trim().toLowerCase().endsWith("@dummytest.dev") &&
      password === "dummytest123";
    if (isDummyTest) return "dev-bypass-token";

    try {
      const params = new URLSearchParams();
      params.append("grant_type", "password");
      params.append("client_id", CLIENT_ID);
      params.append("scope", SCOPE);
      params.append("username", username);
      params.append("password", password);
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = await res.json();
      if (!res.ok) return null;
      return data.access_token;
    } catch { return null; }
  })();

  const rpcPromise = supabase
    .rpc("get_user_by_email", { p_email: username.trim().toLowerCase() })
    .then(({ data }) => (Array.isArray(data) ? data[0] : null))
    .catch(() => null);

  // ════════════════════════════════════════════════════════
  // PASO 1: Supabase super-admin probe
  // ════════════════════════════════════════════════════════
  try {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: username,
      password,
    });

    if (!authErr && authData?.user) {
      const { data: userRow } = await sbAccounts
        .from("users")
        .select("is_super_admin, is_active")
        .eq("id", authData.user.id)
        .single();

      if (userRow?.is_super_admin && userRow?.is_active) {
        setLoading(false);
        navigate("/admin");
        return;
      }
      await supabase.auth.signOut();
    }
  } catch { /* ignore */ }

  // ════════════════════════════════════════════════════════
  // PASO 2: B2C
  // ════════════════════════════════════════════════════════
  const b2cToken = await b2cPromise;
  if (!b2cToken) {
    setError("Invalid credentials. Please try again.");
    setLoading(false);
    return;
  }

  // PASO 3: clear stale session
  await supabase.auth.signOut();

  // PASO 4: admin-created lookup + reporting status
  let reporting;
  const acctUser = await rpcPromise;
  const userEmail = username.trim().toLowerCase();

  if (acctUser?.admin_created) {
    if (!acctUser.is_active) {
      reporting = { status: "inactive", email: username };
    } else {
      try {
        const { data: links } = await supabase
          .rpc("get_user_company_links", { p_user_id: acctUser.id });

const defaultLink = links?.find(l => l.is_default) ?? links?.[0];
        const company = defaultLink ? {
          name: defaultLink.company_name,
          slug: defaultLink.company_slug,
          is_trial: defaultLink.is_trial,
          trial_ends_at: defaultLink.trial_ends_at,
        } : null;

        // Link deactivated by the company admin → same UX as inactive user
        if (defaultLink && defaultLink.is_active === false) {
          setBlocked({ variant: "inactive", email: userEmail });
          setLoading(false);
          return;
        }

        if (!links || links.length === 0) {
          reporting = { status: "inactive", email: username };
        } else if (company?.is_trial && company?.trial_ends_at && new Date(company.trial_ends_at) < new Date()) {
          reporting = { status: "trial_expired", email: username, company };
        } else {
          reporting = { status: "active", user: acctUser, company };
        }
      } catch {
        reporting = { status: "active", user: acctUser, company: null };
      }
    }
} else {
    reporting = await getReportingStatus(username, password);
  }

// Ghost user of an existing company → user has valid B2C creds but no
  // reporting account. Show BlockedPanel instead of a fake "invalid" message.
  if (reporting?.status === "company_exists_no_user") {
    setBlocked({ variant: "no_account", email: userEmail });
    setLoading(false);
    return;
  }

  // B2C accepted but user has no reporting account at all → before sending
  // them to signup, check if any OTHER user shares the same email domain.
  // If yes, the company already exists (slug just doesn't match the domain).
  // Treat the same way as company_exists_no_user → invalid credentials.
  if (reporting?.status === "needs_activation") {
    const domain = userEmail.split("@")[1] ?? "";
    if (domain) {
      const { data: peers, error: peerErr } = await sbAccounts
        .from("users")
        .select("id, email")
        .ilike("email", `%@${domain}`)
        .neq("email", userEmail)
        .limit(1);

if (!peerErr && peers && peers.length > 0) {
        setBlocked({ variant: "no_account", email: userEmail });
        setLoading(false);
        return;
      }
    }

    // No existing peers → genuine new signup, proceed
    sessionStorage.setItem("signup_autoverify", JSON.stringify({
      email: username.trim(),
      password,
      ts: Date.now(),
    }));
    setLoading(false);
    navigate("/signup");
    return;
  }

  // ════════════════════════════════════════════════════════
  // PASO 5: First-time admin_created activation
  // ════════════════════════════════════════════════════════
  if (acctUser?.admin_created && acctUser?.has_password === false) {
    try {
      const res = await fetch(
        "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/set-user-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
            Authorization: `Bearer ${b2cToken}`,
          },
          body: JSON.stringify({ user_id: acctUser.id, password }),
        }
      );
      if (res.ok) {
        await supabase.rpc("mark_user_has_password", { p_user_id: acctUser.id });
        await supabase.auth.signInWithPassword({ email: userEmail, password });
      }
    } catch { /* silent */ }

    return finalizeSession({ b2cToken, acctUser, reporting, userEmail });
  }

  // ════════════════════════════════════════════════════════
  // PASO 6: Returning admin_created user — Supabase RLS session.
  // If sign-in fails here, the local password is stale (user
  // most likely changed it upstream in Konsolidator B2C). The
  // B2C token we hold is proof of identity → offer to resync.
  // ════════════════════════════════════════════════════════
  if (acctUser?.admin_created && acctUser?.has_password === true) {
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password,
    });

    if (signInErr) {
      setSyncPrompt({ acctUser, b2cToken, reporting, userEmail });
      setLoading(false);
      return;
    }
  }

  return finalizeSession({ b2cToken, acctUser, reporting, userEmail });
};

const handleConfirmSync = async () => {
  if (!syncPrompt) return;
  const { acctUser, b2cToken, reporting, userEmail } = syncPrompt;

  setSyncing(true);
  setError("");

  try {
    const res = await fetch(
      "https://gmcawsapzkzmgrtiqebv.supabase.co/functions/v1/set-user-password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA",
          Authorization: `Bearer ${b2cToken}`,
        },
        body: JSON.stringify({ user_id: acctUser.id, password }),
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      setSyncing(false);
      setSyncPrompt(null);
      setError(`Could not sync password (${res.status}). ${txt}`);
      return;
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password,
    });
    if (signInErr) {
      setSyncing(false);
      setSyncPrompt(null);
      setError("Password was updated but sign-in still failed. Please try again or contact support.");
      return;
    }

    setSyncPrompt(null);
    await finalizeSession({ b2cToken, acctUser, reporting, userEmail });
  } catch (e) {
    setSyncing(false);
    setSyncPrompt(null);
    setError(`Sync failed: ${e.message}`);
  }
};

const handleCancelSync = () => {
  setSyncPrompt(null);
  setSyncing(false);
  setError("Sign-in cancelled. Your local password was not changed.");
};


// If the user is blocked, show the panel instead of the login form.
  if (blocked) {
    return (
      <BlockedPanel
        variant={blocked.variant}
        email={blocked.email}
        company={blocked.company}
        onLogout={() => { setBlocked(null); setUsername(""); setPassword(""); setError(""); }}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={`lgRoot ${dismantling ? "lgOut" : ""}`}
      onPointerDown={(e) => {
        if (dismantling) return;
        if (e.target.closest("form, button, a, input, [data-no-shock]")) return;
        engineRef.current?.shockAt(e.clientX, e.clientY);
      }}
    >
      <style>{LOGIN_CSS}</style>

      {/* ─── Fondo vivo ─────────────────────────────────────── */}
      <div className="lgHandoffBg" aria-hidden="true" />
      <div className="lgBlob lgBlobA" aria-hidden="true" />
      <div className="lgBlob lgBlobB" aria-hidden="true" />
      <div className="lgGrain" aria-hidden="true" />
      <div className="lgEqs" aria-hidden="true">
        {EQUATIONS.map((eq, i) => {
          const dur = 28 + (i % 7) * 3;
          return (
            <span key={eq} className="lgEq" style={{
              left: `${(i * 17 + 5) % 90}%`, fontSize: 11 + (i % 4),
              animation: `${i % 2 === 0 ? "lgDrift" : "lgDriftSlow"} ${dur}s linear ${-((i * 2.2) % dur)}s infinite`,
            }}>{eq}</span>
          );
        })}
      </div>
      <LoginUniverse engineRef={engineRef} graphRef={graphRef} rootRef={rootRef} />
      <div className="lgSpot" aria-hidden="true" />

      <div className="lgTickers lgTickersTop" aria-hidden="true">
        {TICKERS.slice(0, 4).map((tk, i) => (
          <div key={tk.l} className="lgTicker" data-piece style={{ "--d": `${i * 30}ms`, animationDelay: `${0.5 + i * 0.08}s` }}>
            <span className="lgTickerL">{tk.l}</span>
            <span style={{ color: tk.c }}>{tk.v}</span>
            <i />
          </div>
        ))}
      </div>
      <div className="lgTickers lgTickersBottom" aria-hidden="true">
        {TICKERS.slice(4).map((tk, i) => (
          <div key={tk.l} className="lgTicker" data-piece style={{ "--d": `${i * 30}ms`, animationDelay: `${0.7 + i * 0.08}s` }}>
            <span className="lgTickerL">{tk.l}</span>
            <span style={{ color: tk.c }}>{tk.v}</span>
          </div>
        ))}
      </div>

      {/* ─── Barra superior ─────────────────────────────────── */}
      <header className="lgHeader">
        <div className="lgBrand" data-piece style={{ "--d": "0ms" }}>
          <div className="lgBrandMark"><span>[K</span></div>
          <span className="lgBrandName">KONSOLIDATOR</span>
        </div>
        <ReleaseBadge
          seen={releaseSeen}
          onOpen={() => { markReleaseSeen(); setReleaseSeen(true); setReleaseOpen(true); }}
        />
      </header>

      {/* ─── Cuerpo ─────────────────────────────────────────── */}
      <main className="lgMain">
        <section className="lgHero">
          <div ref={graphRef} className="lgGraphSlot" aria-hidden="true" />
          <div className="lgHeroText">
            <p className="lgEyebrow" data-piece style={{ "--d": "60ms" }}>Financial Intelligence</p>
            <h1 className="lgTitle" data-piece style={{ "--d": "90ms" }}>
              {["Welcome", "back."].map((w, i) => (
                <span key={w} className="lgWord" style={{ "--w": i }}>{w}{" "}</span>
              ))}
              <br />
              {["Let's", "get", "you", "in."].map((w, i) => (
                <span key={w} className="lgWord lgWordDark" style={{ "--w": i + 2 }}>{w}{" "}</span>
              ))}
            </h1>
            <p className="lgLead" data-piece style={{ "--d": "120ms" }}>
              Real-time consolidated financials, KPIs, and group analytics — all in one place.
            </p>
            <div className="lgFeatures">
              {FEATURES.map((f, i) => (
                <div key={f.label} className="lgFeature" data-piece
                  style={{ "--d": `${150 + i * 40}ms`, animationDelay: `${0.55 + i * 0.07}s` }}
                  onPointerEnter={() => engineRef.current?.pulse(0.6)}>
                  <p className="lgFeatureL">{f.label}</p>
                  <p className="lgFeatureD">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <form
          ref={cardRef}
          className="lgCard"
          data-piece
          style={{ "--d": "260ms" }}
          noValidate
          onSubmit={(e) => { e.preventDefault(); if (!loading) handleLogin(); }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty("--cx", `${e.clientX - r.left}px`);
            e.currentTarget.style.setProperty("--cy", `${e.clientY - r.top}px`);
            e.currentTarget.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - 0.5) * -5}deg`);
            e.currentTarget.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 6}deg`);
          }}
          onPointerLeave={(e) => {
            e.currentTarget.style.setProperty("--rx", "0deg");
            e.currentTarget.style.setProperty("--ry", "0deg");
          }}
        >
          <div className="lgCardIn">
            <p className="lgCardEyebrow">Sign in</p>
            <h2 className="lgCardTitle">Your dashboard<span>.</span></h2>
            <p className="lgCardSub">Pick up where you left off.</p>

            <div className="lgFields">
              <label className="lgField">
                <span className="lgFieldL">Email</span>
                <span className="lgInputWrap">
                  <Mail size={16} className="lgInputIco" />
                  <input
                    type="email"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); engineRef.current?.pulse(); }}
                    placeholder="you@konsolidator.com"
                    className="lgInput"
                  />
                </span>
              </label>
              <label className="lgField">
                <span className="lgFieldL">Password</span>
                <span className="lgInputWrap">
                  <Lock size={16} className="lgInputIco" />
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); engineRef.current?.pulse(); }}
                    placeholder="••••••••"
                    className="lgInput lgInputPw"
                  />
                  <button type="button" className="lgEye" onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"} tabIndex={-1}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </label>

              {error && (
                <div className="lgError" role="alert">
                  <p>{error}</p>
                </div>
              )}

              <button
                type="submit"
                ref={magnet.ref}
                onPointerMove={magnet.onPointerMove}
                onPointerLeave={magnet.onPointerLeave}
                onPointerDown={(e) => {
                  const b = e.currentTarget, r = b.getBoundingClientRect();
                  const s = document.createElement("span");
                  s.className = "lgRipple";
                  s.style.left = `${e.clientX - r.left}px`; s.style.top = `${e.clientY - r.top}px`;
                  b.appendChild(s);
                  setTimeout(() => s.remove(), 650);
                }}
                disabled={loading || dismantling}
                className={`lgBtn ${loading ? "isLoading" : ""} ${dismantling ? "isDone" : ""}`}
              >
                <span className="lgBtnGlow" aria-hidden="true" />
                {dismantling ? (
                  <span className="lgBtnRow">
                    <Check size={16} strokeWidth={3} /> Access granted
                  </span>
                ) : loading ? (
                  <span className="lgBtnRow">
                    <span className="lgSpin" />
                    Signing in…
                  </span>
                ) : (
                  <span className="lgBtnRow">
                    Sign In <ArrowRight size={16} strokeWidth={2.6} className="lgBtnArrow" />
                  </span>
                )}
              </button>
            </div>

            <p className="lgFoot1">IFRS · MULTI-CURRENCY · EU HOSTED</p>
            <p className="lgFoot2">VERSION 1.1 · BALANCE</p>
          </div>
        </form>
      </main>

      {/* ─── Núcleo en el que se "consolida" el login ────────── */}
      <div className="lgCoreGlow" aria-hidden="true" />
      <div className="lgCore" aria-hidden="true">
        <img src="/favicon.svg" alt="" draggable={false} />
        <span>0<small>%</small></span>
      </div>

      {/* ─── Novedades de la versión 1.1 ────────────────────── */}
      {releaseOpen && <ReleaseNotes onClose={() => setReleaseOpen(false)} />}

      {/* Sync prompt — unchanged */}
      {syncPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(10,22,71,0.55)", backdropFilter: "blur(12px)" }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white overflow-hidden"
            style={{ boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5)" }}
          >
            <div
              className="px-7 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #0f1f5c 100%)" }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-300 mb-1">
                Password change detected
              </p>
              <h3 className="text-2xl font-black leading-tight">Sync your password?</h3>
            </div>

            <div className="px-7 py-6 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Your Konsolidator credentials were accepted, but the password stored
                in our reporting platform is out of date — most likely because you
                changed it in Konsolidator.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                We can update your reporting-platform password to match the one you
                just used. This is required to grant the access permissions for your account.
              </p>
              <div className="rounded-xl px-3 py-2.5 bg-amber-50 border border-amber-200">
                <p className="text-[11px] font-bold text-amber-700">
                  Account: <span className="font-mono">{syncPrompt.userEmail}</span>
                </p>
              </div>
            </div>

            <div className="px-7 py-4 flex items-center justify-end gap-2 bg-gray-50 border-t border-gray-100">
              <button
                onClick={handleCancelSync}
                disabled={syncing}
                className="px-5 py-2.5 text-xs font-black rounded-xl text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSync}
                disabled={syncing}
                className="px-6 py-2.5 text-xs font-black text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #1a2f8a 0%, #0f1f5c 100%)",
                  boxShadow: "0 8px 20px -4px rgba(26,47,138,0.5)",
                }}
              >
                {syncing && (
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white login-spin" />
                )}
                {syncing ? "Syncing…" : "Yes, sync password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}