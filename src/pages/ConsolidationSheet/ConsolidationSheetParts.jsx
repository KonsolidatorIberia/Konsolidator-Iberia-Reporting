/* ══════════════════════════════════════════════════════════════════════
   Sábana de consolidación — piezas de interfaz: filtros y vistas de
   mapeos.
   ══════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef } from "react";
import { ChevronDown, X, Library, Layers, FileText, Loader2 } from "lucide-react";

// ── FilterPill ────────────────────────────────────────────────────────────────
function FilterPill({ label, value, onChange, options, filterStyle, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const display = options.find(o => String(o.value) === String(value))?.label ?? "—";
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative flex-shrink-0">
<button onClick={() => setOpen(o => !o)}
  className="flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all select-none bg-white border-[#c2c2c2] shadow-xl hover:border-[#1a2f8a]/40"
  style={filterStyle}>
  <span className="text-[9px] font-black uppercase tracking-widest text-[#1a2f8a]/50">{label}</span>
  <span>{display}</span>
  <ChevronDown size={10} className={`transition-transform duration-200 opacity-40 ${open ? "rotate-180" : ""}`} />
</button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px] bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-64 overflow-y-auto">
           {options.map(o => {
  const selected = String(o.value) === String(value);
  return (
    <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-3
        ${selected ? "text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
      style={selected ? { backgroundColor: colors?.primary } : undefined}>
      {o.label}
      {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
    </button>
  );
})}
          </div>
        </div>
      )}
    </div>
  );
}

// El cargador de la sábana es ahora el común de la aplicación:
// src/components/framework/ProgressLoader.jsx

/* ─── MappingsLanding — 2 cards: Structure + Report ──────────────────────── */
export function MappingsLanding({ colors, onPickStructure, onPickReport, T }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const PRIMARY_SOFT = "#3b54b8";
  const ACCENT = "#CF305D";
  const ACCENT_SOFT = "#e0558d";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Structure card */}
        <button onClick={onPickStructure}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: "linear-gradient(135deg, #ffffff 0%, #f4f6ff 40%, #eef1fb 100%)",
            boxShadow: `0 8px 32px -8px ${PRIMARY}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = PRIMARY; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${PRIMARY}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${PRIMARY}18 0%, transparent 70%)`,
              animation: "sheetMapOrb1 8s ease-in-out infinite",
            }} />
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${PRIMARY_SOFT}20 0%, transparent 70%)`,
              animation: "sheetMapOrb2 11s ease-in-out 2s infinite",
            }} />
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpin 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={PRIMARY} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpinR 20s linear infinite" }} />
            </svg>
          </div>

          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                  filter: "blur(12px)", transform: "translateY(4px)", opacity: 0.2,
                }} />
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: `linear-gradient(145deg, ${PRIMARY} 0%, ${PRIMARY_SOFT} 100%)`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}>
                  <Layers size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("views_structure_mappings")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_structure_desc")}
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
                {["PGC", "Spanish IFRS", "Danish IFRS"].map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                    style={{ background: `${PRIMARY}15`, color: PRIMARY }}>{s}</span>
                ))}
              </div>
<span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: PRIMARY }}>{T("btn_open_arrow")}</span>
            </div>
          </div>
        </button>

        {/* Report card */}
        <button onClick={onPickReport}
          className="group relative overflow-hidden rounded-2xl border-2 text-left transition-all"
          style={{
            borderColor: "rgba(243,244,246,1)",
            background: "linear-gradient(135deg, #ffffff 0%, #fff4f7 40%, #fef1f5 100%)",
            boxShadow: `0 8px 32px -8px ${ACCENT}2e`,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(243,244,246,1)"; }}>

          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(${ACCENT}0d 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="absolute" style={{
              width: 150, height: 150, top: -30, right: -30,
              background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
              animation: "sheetMapOrb1 9s ease-in-out infinite",
            }} />
            <div className="absolute" style={{
              width: 100, height: 100, bottom: 20, right: 40,
              background: `radial-gradient(circle, ${ACCENT_SOFT}20 0%, transparent 70%)`,
              animation: "sheetMapOrb2 13s ease-in-out 1.5s infinite",
            }} />
            <svg className="absolute" style={{ width: 180, height: 180, top: 20, right: 20, opacity: 0.07 }} viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="70" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="8 6" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpinR 30s linear infinite" }} />
              <circle cx="90" cy="90" r="48" fill="none" stroke={ACCENT} strokeWidth="0.8" strokeDasharray="4 8" style={{ transformOrigin: "90px 90px", animation: "sheetMapSpin 20s linear infinite" }} />
            </svg>
          </div>

          <div className="relative z-10 p-8 flex flex-col h-full">
            <div className="mb-auto">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-300" style={{
                  background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                  filter: "blur(12px)", transform: "translateY(4px)", opacity: 0.2,
                }} />
                <div className="relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    background: `linear-gradient(145deg, ${ACCENT} 0%, ${ACCENT_SOFT} 100%)`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}>
                  <FileText size={26} className="text-white" strokeWidth={1.8} />
                </div>
              </div>
<h3 className="font-black text-xl text-gray-800 mb-2 tracking-tight">{T("views_report_mappings")}</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                {T("cf_landing_report_desc")}
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1.5">
<span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider"
                  style={{ background: `${ACCENT}15`, color: ACCENT }}>{T("badge_coming_soon")}</span>
              </div>
<span className="text-xs font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: ACCENT }}>{T("btn_preview_arrow")}</span>
            </div>
          </div>
        </button>
      </div>

      <style>{`
        @keyframes sheetMapOrb1 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(20px,-30px) scale(1.1); } }
        @keyframes sheetMapOrb2 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(-15px,20px) scale(0.95); } }
        @keyframes sheetMapSpin  { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        @keyframes sheetMapSpinR { from { transform:rotate(0deg); } to { transform:rotate(-360deg); } }
      `}</style>
    </div>
  );
}

/* ─── MappingsLibrary — saved mappings list ─────────────────────────────── */
export function MappingsLibrary({ colors, kind, activeMapping, mappings, loading, error, onApply, onClearActive, onRetry, T }) {
  const PRIMARY = colors.primary || "#1a2f8a";
  const ACCENT = kind === "report" ? "#CF305D" : PRIMARY;
  const Icon = kind === "report" ? FileText : Layers;
  const kindLabel = kind === "report" ? T("views_saved_report_mappings") : T("views_saved_mappings");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div>
         <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">{T("views_library")}</p>
          <h2 className="font-black tracking-tight mt-0.5 text-gray-800" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
            {kindLabel}
          </h2>
        </div>
        {activeMapping && (
          <button onClick={onClearActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.15)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; }}>
<X size={10} strokeWidth={3} />
            {T("btn_clear_active")}
          </button>
        )}
      </div>

      <div className="overflow-y-auto flex-1 p-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin mb-3" style={{ color: ACCENT }} />
           <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{T("loading_mappings")}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "rgba(220,38,38,0.1)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
           <p className="text-sm font-bold text-red-600 mb-1">{T("sheet_couldnt_load", "Couldn't load mappings")}</p>
            <p className="text-xs text-gray-400 mb-4">{error}</p>
            {onRetry && (
<button onClick={onRetry} className="text-xs font-black uppercase tracking-widest underline" style={{ color: ACCENT }}>
                {T("btn_retry")}
              </button>
            )}
          </div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${ACCENT}10` }}>
              <Library size={20} style={{ color: ACCENT }} />
            </div>
<p className="text-sm font-bold text-gray-500 mb-1">{T("views_no_mappings")}</p>
            <p className="text-xs text-gray-400">{T("views_no_mappings_hint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mappings.map(m => {
              const isActive = activeMapping?.mapping_id === m.mapping_id;
              return (
                <button key={m.mapping_id} onClick={() => onApply(m)}
                  className="relative text-left p-4 rounded-xl transition-all flex flex-col"
                  style={{
                    background: isActive ? `${ACCENT}06` : "white",
                    border: `2px solid ${isActive ? ACCENT : "rgba(0,0,0,0.05)"}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 12px -2px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>
                  <div className="flex items-start gap-2.5 mb-3">
                    <div className="rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 36, height: 36,
                        background: isActive ? "white" : `${ACCENT}15`,
                        color: ACCENT,
                        border: isActive ? `1px solid ${ACCENT}30` : "none",
                      }}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
<p className="font-black text-sm text-gray-800 truncate" style={{ letterSpacing: "-0.01em" }}>
                          {m.name ?? T("views_untitled")}
                        </p>
                        {isActive && (
                          <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md flex-shrink-0"
                            style={{ background: ACCENT, color: "white" }}>{T("views_active")}</span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: ACCENT, opacity: 0.7 }}>
                        {m.standard ?? T("am_filter_custom")}
                      </p>
                    </div>
                  </div>
                  {m.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-3">{m.description}</p>
                  )}
                  <div className="mt-auto pt-3 border-t border-gray-50 flex items-center justify-between">
<span className="text-[10px] text-gray-400">
                      {m.updated_at ? `${T("views_updated")} ${new Date(m.updated_at).toLocaleDateString()}` : "—"}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#059669" }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
<path d="M20 6L9 17l-5-5" />
                      </svg>
                      {T("views_apply")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}