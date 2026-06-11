import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MoreHorizontal, GitCompareArrows, Calendar, CalendarRange, Search, X } from "lucide-react";
import { useSettings, useTypo, useT } from "./SettingsContext.jsx";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SMOOTH = "cubic-bezier(0.4, 0, 0.2, 1)";

/* ═══════════════════════════════════════════════════════════════
   FilterPill — value-only collapsed; LABEL slides in to the LEFT
   on hover. Now lives inside the glass shell, no individual border.
═══════════════════════════════════════════════════════════════ */
export function FilterPill({ label, value, onChange, options = [] }) {

const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownRect, setDropdownRect] = useState(null);
const ref = useRef(null);
  const dropdownRef = useRef(null);
  const filterTypo = useTypo("filter");
  const { colors } = useSettings();
  const t = useT();

const showSearch = options.length >= 6;
const filteredOptions = search.trim()
  ? options.filter(o => String(o.label ?? "").toLowerCase().includes(search.toLowerCase()))
  : options;

const [highlightIdx, setHighlightIdx] = useState(0);

const [prevOpen, setPrevOpen] = useState(open);
if (open !== prevOpen) {
  setPrevOpen(open);
  if (!open) { setSearch(""); setHighlightIdx(0); }
}
const [prevSearch, setPrevSearch] = useState(search);
if (search !== prevSearch) {
  setPrevSearch(search);
  setHighlightIdx(0);
}
const handleKeyDown = (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHighlightIdx(i => Math.min(i + 1, filteredOptions.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setHighlightIdx(i => Math.max(i - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const picked = filteredOptions[highlightIdx];
    if (picked) { onChange(picked.value); setOpen(false); }
  } else if (e.key === "Escape") {
    e.preventDefault();
    setOpen(false);
  }
};
const matchedOption = options.find(o => String(o.value) === String(value));
const display = matchedOption?.displayLabel ?? matchedOption?.label ?? "—";

useEffect(() => {
    function handler(e) {
      const inPill = ref.current && ref.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inPill && !inDropdown) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

useEffect(() => {
    if (!open) return;
    let rafId;
    const track = () => {
      if (ref.current) setDropdownRect(ref.current.getBoundingClientRect());
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  const showLabel = hover || open;

  return (
    <div ref={ref} className="relative flex-shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
<button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl select-none overflow-hidden group"
        style={{
          padding: "8px 12px",
          background: open || hover ? "rgba(26,47,138,0.06)" : "transparent",
          transition: `background 220ms ${SMOOTH}`,
          lineHeight: 1,
        }}>
        <span className="inline-flex items-center overflow-hidden whitespace-nowrap"
          style={{
            maxWidth: showLabel ? 100 : 0,
            opacity: showLabel ? 1 : 0,
            marginRight: showLabel ? 6 : 0,
            transition: `max-width 320ms ${SPRING}, opacity 220ms ${SMOOTH}, margin-right 320ms ${SPRING}`,
          }}>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none"
            style={{ color: colors.primary, opacity: 0.55 }}>
            {label}
          </span>
        </span>
        <span style={display !== "—" ? {
          fontFamily: filterTypo.fontFamily,
          fontSize:   filterTypo.fontSize,
          fontWeight: filterTypo.fontWeight,
          color:      filterTypo.color,
          letterSpacing: "-0.005em",
          lineHeight: 1,
        } : { color: "rgba(100,120,180,0.4)", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
          {display}
        </span>
        <ChevronDown size={11}
          style={{
            color: colors.primary,
            opacity: 0.4,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: `transform 280ms ${SPRING}`,
          }} />
      </button>

{open && createPortal(
        <div ref={dropdownRef} className="fixed z-[9999] min-w-[180px] rounded-2xl overflow-hidden"
          style={{
            top: dropdownRect ? dropdownRect.bottom + 8 : 0,
            left: dropdownRect ? dropdownRect.left : 0,
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(26,47,138,0.08)",
            boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18), 0 0 0 1px rgba(255,255,255,0.5) inset",
            animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
          {showSearch && (
            <div className="px-2 pt-2 pb-1.5 border-b border-gray-50">
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                style={{ background: "rgba(26,47,138,0.04)" }}>
                <Search size={11} style={{ color: colors.primary, opacity: 0.5 }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
autoFocus
                  placeholder={t("search_placeholder")}
                  className="text-xs outline-none bg-transparent flex-1 min-w-0"
                  style={{ color: colors.primary }}
                />
                {search && (
                  <button onClick={() => setSearch("")}>
                    <X size={10} style={{ color: colors.primary, opacity: 0.4 }} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="p-1.5 max-h-72 overflow-y-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-gray-300 italic">
                {t("no_matches")}
              </div>
            ) : filteredOptions.map((o, idx) => {
              const selected = String(value) === String(o.value);
              const highlighted = idx === highlightIdx;
              return (
                <button key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-3"
                  style={{
                    background: selected
                      ? colors.primary
                      : highlighted ? "rgba(26,47,138,0.10)" : "transparent",
                    color: selected ? "#fff" : "#475569",
                    transition: `background 180ms ${SMOOTH}, color 180ms ${SMOOTH}`,
                  }}>
                  {o.label}
                  {selected && <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
                </button>
              );
})}
          </div>
</div>,
        document.body
)}

      <style>{`
        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MultiFilterPill — same aesthetic as FilterPill, multi-select
═══════════════════════════════════════════════════════════════ */
export function MultiFilterPill({ label, values, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownRect, setDropdownRect] = useState(null);
const ref = useRef(null);
  const dropdownRef = useRef(null);
  const filterTypo = useTypo("filter");
  const { colors } = useSettings();
  const t = useT();

const showSearch = options.length >= 6;
const filteredOptions = search.trim()
  ? options.filter(o => String(o.label ?? "").toLowerCase().includes(search.toLowerCase()))
  : options;

const [highlightIdx, setHighlightIdx] = useState(0);

const [prevOpen, setPrevOpen] = useState(open);
if (open !== prevOpen) {
  setPrevOpen(open);
  if (!open) { setSearch(""); setHighlightIdx(0); }
}
const [prevSearch, setPrevSearch] = useState(search);
if (search !== prevSearch) {
  setPrevSearch(search);
  setHighlightIdx(0);
}

const handleKeyDown = (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHighlightIdx(i => Math.min(i + 1, filteredOptions.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setHighlightIdx(i => Math.max(i - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const picked = filteredOptions[highlightIdx];
    if (picked) toggle(picked.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    setOpen(false);
  }
};

useEffect(() => {
    function handler(e) {
      const inPill = ref.current && ref.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inPill && !inDropdown) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

useEffect(() => {
    if (!open) return;
    let rafId;
    const track = () => {
      if (ref.current) setDropdownRect(ref.current.getBoundingClientRect());
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [open]);
const allSelected = !values || values.length === options.length;
const noneSelected = Array.isArray(values) && values.length === 0;
const isDefault = allSelected || noneSelected;
const display = isDefault
  ? label
  : values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? "1") : `${values.length} ${t("active").toLowerCase()}`;

  const toggle = (v) => {
    const current = values ?? options.map(o => o.value);
    const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v];
    onChange(next.length === options.length ? null : next);
  };

  const showLabel = hover || open;

  return (
    <div ref={ref} className="relative flex-shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl select-none overflow-hidden"
        style={{
          padding: "8px 12px",
          background: open || hover ? "rgba(26,47,138,0.06)" : "transparent",
          transition: `background 220ms ${SMOOTH}`,
        }}>
{!isDefault && (
          <span className="inline-flex items-center overflow-hidden whitespace-nowrap"
            style={{
              maxWidth: showLabel ? 100 : 0, opacity: showLabel ? 1 : 0, marginRight: showLabel ? 6 : 0,
              transition: `max-width 320ms ${SPRING}, opacity 220ms ${SMOOTH}, margin-right 320ms ${SPRING}`,
            }}>
            <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none"
              style={{ color: colors.primary, opacity: 0.55 }}>{label}</span>
          </span>
        )}
        <span style={{ ...filterTypo, letterSpacing: "-0.005em", lineHeight: 1 }}>{display}</span>
        <ChevronDown size={11} style={{ color: colors.primary, opacity: 0.4, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: `transform 280ms ${SPRING}` }} />
      </button>

{open && createPortal(
        <div ref={dropdownRef} className="fixed z-[9999] min-w-[220px] rounded-2xl overflow-hidden"
          style={{
            top: dropdownRect ? dropdownRect.bottom + 8 : 0,
            left: dropdownRect ? dropdownRect.left : 0,
            background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 20px 50px -12px rgba(26,47,138,0.18)", animation: "dropdownIn 240ms cubic-bezier(0.34,1.56,0.64,1)" }}>
          {showSearch && (
            <div className="px-2 pt-2 pb-1.5 border-b border-gray-50">
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                style={{ background: "rgba(26,47,138,0.04)" }}>
                <Search size={11} style={{ color: colors.primary, opacity: 0.5 }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
autoFocus
                  placeholder={t("search_placeholder")}
                  className="text-xs outline-none bg-transparent flex-1 min-w-0"
                  style={{ color: colors.primary }}
                />
                {search && (
                  <button onClick={() => setSearch("")}>
                    <X size={10} style={{ color: colors.primary, opacity: 0.4 }} />
                  </button>
                )}
              </div>
            </div>
          )}
         <div className="p-1.5 max-h-72 overflow-y-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
            <button onClick={() => onChange(allSelected ? [] : null)}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-3 border-b border-gray-100 mb-1"
              style={{ color: colors.primary }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(26,47,138,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: allSelected ? colors.primary : "#fff", borderColor: allSelected ? colors.primary : "#d4d4d8" }}>
                {allSelected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
              {allSelected ? t("deselect_all") : t("select_all")}
            </button>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-gray-300 italic">
                {t("no_matches")}
              </div>
            ) : filteredOptions.map((o, idx) => {
              const selected = (values ?? options.map(x => x.value)).includes(o.value);
              const highlighted = idx === highlightIdx;
              return (
                <button key={o.value}
                  onClick={() => toggle(o.value)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-3"
                  style={{
                    color: "#475569",
                    background: highlighted ? "rgba(26,47,138,0.10)" : "transparent",
                    transition: `background 180ms ${SMOOTH}`,
                  }}>
                  <span className="w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: selected ? colors.primary : "#fff", borderColor: selected ? colors.primary : "#d4d4d8" }}>
                    {selected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
);
            })}
          </div>
</div>,
        document.body
)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TabSwitcher— icons-only collapsed. Hover a tab → it expands
   inline (icon + label). Active tab stays icon-only when not
   hovered (label-driven hover applies equally to all tabs).
   Sliding pill follows whichever tab is active OR hovered, with
   ResizeObserver for stable measurement (no jitter).
═══════════════════════════════════════════════════════════════ */
export function TabSwitcher({ tabs, activeTab, onChange, onHoverChange }) {
  const containerRef = useRef(null);
  const pillRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  const hoveredIdRef = useRef(null);
  const [hoveredId, setHoveredId] = useState(null);
  const { colors } = useSettings();

  // Keep a ref of the live activeTab so the rAF loop reads the latest value
  // without restarting on every change.
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Per-frame lerp: pill smoothly chases the active tab's current position.
  // Direct DOM writes (not setState) + no CSS transition on left/width means
  // there's never a stacked in-flight transition chasing a stale target.
  useLayoutEffect(() => {
    let rafId;
    let curLeft = null;
    let curWidth = null;

    const tick = () => {
      const container = containerRef.current;
      const pill = pillRef.current;
      if (container && pill) {
        const btn = container.querySelector(`[data-tab="${activeTabRef.current}"]`);
        if (btn) {
          const targetLeft = btn.offsetLeft;
          const targetWidth = btn.offsetWidth;
          if (curLeft === null) {
            curLeft = targetLeft;
            curWidth = targetWidth;
          } else {
            const k = 0.22;
            curLeft += (targetLeft - curLeft) * k;
            curWidth += (targetWidth - curWidth) * k;
            if (Math.abs(targetLeft - curLeft) < 0.3) curLeft = targetLeft;
            if (Math.abs(targetWidth - curWidth) < 0.3) curWidth = targetWidth;
          }
          pill.style.left = `${curLeft}px`;
          pill.style.width = `${curWidth}px`;
          pill.style.opacity = "1";
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Geometry-based hover detection. Single source of truth (mousemove on the
  // container) replaces per-tab onMouseEnter/onMouseLeave — same cursor x →
  // same tab, always. Eliminates the boundary flicker where rapid enter/leave
  // events between adjacent tabs (and the 2px inter-tab gap) thrashed the
  // hovered state and oscillated the label-expand animation.
  const handleMouseMove = (e) => {
    const buttons = containerRef.current?.querySelectorAll("[data-tab]");
    if (!buttons) return;
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right) {
        const id = btn.dataset.tab;
        if (hoveredIdRef.current !== id) {
          hoveredIdRef.current = id;
          setHoveredId(id);
        }
        return;
      }
    }
    // Cursor is in the small inter-tab gap — keep last hover state. This is
    // what prevents the "stationary between two tabs" glitch. We only clear
    // hover when the cursor truly leaves the strip (handled by onMouseLeave).
  };

  const handleMouseLeave = () => {
    hoveredIdRef.current = null;
    setHoveredId(null);
  };

  // Surface hover to parent so the title can morph
  useEffect(() => {
    onHoverChange?.(hoveredId);
  }, [hoveredId, onHoverChange]);

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-0.5 relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <span
        ref={pillRef}
        style={{
          position: "absolute",
          top: 4, bottom: 4,
          left: 0,
          width: 0,
          opacity: 0,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 2px 8px -2px rgba(26,47,138,0.18), 0 0 0 1px rgba(26,47,138,0.04)",
          transition: `opacity 200ms ${SMOOTH}`,
        }}
      />
      {tabs.map(t => {
        const Icon = t.icon;
        const active = activeTab === t.id;
        const hovered = hoveredId === t.id;
// const expanded = hovered;
        return (
          <button
            key={t.id}
            data-tab={t.id}
            onClick={() => onChange(t.id)}
            className="flex items-center gap-1.5 rounded-xl relative z-10 overflow-hidden"
            style={{
              padding: "8px 12px",
              color: active ? colors.primary : (hovered ? colors.primary : "#7d8aa3"),
              transition: `color 240ms ${SMOOTH}, transform 280ms ${SPRING}`,
              transform: hovered && !active ? "translateY(-0.5px)" : "translateY(0)",
            }}>
<Icon size={15} strokeWidth={active ? 2.5 : 2} />
{t.label && (
              <span className="overflow-hidden whitespace-nowrap text-[12px] font-bold tracking-tight"
                style={{
                  maxWidth: 140,
                  opacity: 1,
                  marginLeft: 2,
                  color: active ? colors.primary : hovered ? colors.primary : "#7d8aa3",
                  transform: hovered && !active ? "scale(1.06)" : "scale(1)",
                  transition: `color 240ms ${SMOOTH}, transform 280ms ${SPRING}`,
                  display: "inline-block",
                }}>
                {t.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ActionFAB — embedded at the right edge of the bar. Click toggles.
   Actions fan radially. Sub-actions reveal on hover of parent.
   Each fanned icon now has a small caption that fades in below.
═══════════════════════════════════════════════════════════════ */
export function ActionFAB({ actions = [] }) {
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState(null);
  const ref = useRef(null);
  const { colors } = useSettings();
  const t = useT();

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setHoveredId(null); } }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const useVertical = actions.length >= 3;

  if (useVertical) {
    return (
      <div ref={ref} className="relative flex-shrink-0" style={{ width: 36, height: 36 }}>
        {actions.map((action, i) => {
          const Icon = action.icon;
          const isHovered = hoveredId === action.id;
          const hasSubs = Array.isArray(action.subActions) && action.subActions.length > 0;
          return (
            <div key={action.id} className="absolute z-30"
              style={{
                left: '50%', top: '50%',
                transform: open
                  ? `translate(-50%, ${(i + 1) * 52}px) scale(1)`
                  : `translate(-50%, 0px) scale(0.3)`,
                opacity: open ? 1 : 0,
                transition: open
                  ? `transform 380ms ${SPRING} ${i * 60}ms, opacity 260ms ${SMOOTH} ${i * 60}ms`
                  : `transform 200ms ${SMOOTH} ${(actions.length - 1 - i) * 30}ms, opacity 160ms ${SMOOTH}`,
                pointerEvents: open ? 'auto' : 'none',
              }}
              onMouseEnter={() => setHoveredId(action.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Sub-actions expanding LEFT */}
              {hasSubs && (
                <div className="absolute flex flex-row-reverse items-center gap-2"
style={{
                    right: '100%', top: '50%',
                    transform: 'translateY(-50%)',
                    paddingRight: '12px',
                    pointerEvents: isHovered ? 'auto' : 'none',
                  }}
                >
                  {action.subActions.map((sub, j) => (
                    <div key={sub.id}
                      style={{
                        transform: isHovered ? 'scale(1)' : 'scale(0)',
                        opacity: isHovered ? 1 : 0,
                        transition: isHovered
                          ? `transform 320ms ${SPRING} ${j * 55}ms, opacity 220ms ${SMOOTH} ${j * 55}ms`
                          : `transform 160ms ${SMOOTH}, opacity 120ms ${SMOOTH}`,
                      }}
                    >
                      <div className="relative group/sub">
                        <button
                          onClick={(e) => { e.stopPropagation(); sub.onClick?.(); setOpen(false); setHoveredId(null); }}
                          title={sub.label}
                          className="flex items-center justify-center w-9 h-9 rounded-full transition-transform hover:scale-110"
                          style={{
                            background: 'white',
                            border: '1px solid rgba(26,47,138,0.08)',
                            boxShadow: '0 6px 16px -4px rgba(26,47,138,0.22), 0 0 0 1px rgba(255,255,255,0.5) inset',
                          }}
                        >
{sub.src
                            ? <img src={sub.src} alt={sub.alt ?? sub.label} className="w-7 h-7 object-contain" />
                            : sub.icon && React.createElement(sub.icon, { size: 26, strokeWidth: 2.2, style: { color: colors.primary } })
                          }
                        </button>
                        <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md whitespace-nowrap pointer-events-none opacity-0 group-hover/sub:opacity-100 transition-opacity"
                          style={{ background: colors.primary, color: 'white' }}>
                          {sub.label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Action button */}
              <button
                onClick={hasSubs ? undefined : action.onClick}
                title={action.label}
                className="flex items-center justify-center w-10 h-10 rounded-full relative z-10"
                style={{
                  background: 'white',
                  border: '1px solid rgba(26,47,138,0.08)',
                  boxShadow: isHovered
                    ? '0 12px 28px -8px rgba(26,47,138,0.35), 0 0 0 1px rgba(26,47,138,0.12)'
                    : '0 6px 16px -4px rgba(26,47,138,0.18)',
                  color: colors.primary,
                  transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                  transition: `all 280ms ${SPRING}`,
                }}
              >
                {Icon && <Icon size={16} strokeWidth={2.4} />}
              </button>

              {/* Label left (no subs only) */}
              {!hasSubs && (
                <div className="absolute right-full mr-2 top-1/2 pointer-events-none"
                  style={{ transform: 'translateY(-50%)', opacity: isHovered ? 1 : 0, transition: `opacity 200ms ${SMOOTH}` }}>
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] px-2 py-1 rounded-md whitespace-nowrap"
                    style={{ background: colors.primary, color: 'white', boxShadow: '0 4px 12px -2px rgba(26,47,138,0.4)' }}>
                    {action.label}
                  </span>
                </div>
              )}
            </div>
          );
        })}

<button onClick={() => setOpen(o => !o)} title={t("more_actions")}
          className="relative flex items-center justify-center w-9 h-9 rounded-full z-40"
          style={{
            background: open ? colors.primary : 'rgba(26,47,138,0.06)',
            color: open ? 'white' : colors.primary,
            border: open ? `1px solid ${colors.primary}` : '1px solid rgba(26,47,138,0.1)',
            boxShadow: open ? '0 10px 28px -6px rgba(26,47,138,0.5), 0 0 0 4px rgba(26,47,138,0.08)' : '0 2px 6px -2px rgba(26,47,138,0.15)',
            transform: open ? 'rotate(90deg) scale(1.05)' : 'rotate(0deg) scale(1)',
            transition: `all 360ms ${SPRING}`,
          }}>
          <MoreHorizontal size={17} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  // Radial mode for < 3 actions
  const RADIUS = 70;
  const SUB_RADIUS = 60;
  const startAngle = 125;
  const endAngle = 185;
  const span = endAngle - startAngle;

  return (
    <div ref={ref} className="relative flex-shrink-0" style={{ width: 36, height: 36 }}>
      {actions.map((action, i) => {
        const t = actions.length === 1 ? 0.5 : i / (actions.length - 1);
        const angle = (startAngle + span * t) * Math.PI / 180;
        const dx = Math.cos(angle) * RADIUS;
        const dy = Math.sin(angle) * RADIUS;
        const Icon = action.icon;
        const isHovered = hoveredId === action.id;
        const hasSubs = Array.isArray(action.subActions) && action.subActions.length > 0;
        return (
          <div key={action.id} className="absolute pointer-events-none"
            style={{
              top: 18, left: 18,
              transform: open
                ? `translate(${dx}px, ${dy}px) translate(-50%, -50%) scale(1)`
                : "translate(0,0) translate(-50%, -50%) scale(0.3)",
              opacity: open ? 1 : 0,
              transition: open
                ? `transform 480ms ${SPRING} ${i * 70}ms, opacity 320ms ${SMOOTH} ${i * 70}ms`
                : `transform 240ms ${SMOOTH} ${(actions.length - 1 - i) * 30}ms, opacity 200ms ${SMOOTH} ${(actions.length - 1 - i) * 30}ms`,
              zIndex: 30 - i,
            }}>
            <div className="pointer-events-auto relative"
              onMouseEnter={() => setHoveredId(action.id)}
              onMouseLeave={() => setHoveredId(null)}>
              {hasSubs && isHovered && (
                <div className="absolute"
                  style={{ top: "50%", left: "50%", width: SUB_RADIUS * 2 + 80, height: SUB_RADIUS * 2 + 80, transform: "translate(-50%, -50%)", pointerEvents: "auto", zIndex: 35 }} />
              )}
              <button onClick={action.onClick} title={action.label}
                className="flex items-center justify-center w-11 h-11 rounded-full"
                style={{
                  background: "white", border: "1px solid rgba(26,47,138,0.08)",
                  boxShadow: isHovered ? "0 12px 28px -8px rgba(26,47,138,0.35), 0 0 0 1px rgba(26,47,138,0.12)" : "0 6px 16px -4px rgba(26,47,138,0.18), 0 0 0 1px rgba(255,255,255,0.5) inset",
                  color: colors.primary, transform: isHovered ? "scale(1.1)" : "scale(1)", transition: `all 280ms ${SPRING}`,
                }}>
                {Icon && <Icon size={16} strokeWidth={2.4} />}
              </button>
              <div className="absolute left-1/2 pointer-events-none whitespace-nowrap"
                style={{ bottom: "calc(100% + 8px)", transform: `translateX(-50%) translateY(${isHovered ? 0 : 3}px)`, opacity: isHovered && !hasSubs ? 1 : 0, transition: `opacity 200ms ${SMOOTH}, transform 240ms ${SPRING}` }}>
                <span className="text-[9px] font-black uppercase tracking-[0.16em] px-2 py-1 rounded-md"
                  style={{ background: colors.primary, color: "white", boxShadow: "0 4px 12px -2px rgba(26,47,138,0.4)" }}>
                  {action.label}
                </span>
              </div>
              {hasSubs && action.subActions.map((sub, j) => {
                const subT = action.subActions.length === 1 ? 0.5 : j / (action.subActions.length - 1);
                const subAngle = (135 + 50 * subT) * Math.PI / 180;
                const sdx = Math.cos(subAngle) * SUB_RADIUS;
                const sdy = Math.sin(subAngle) * SUB_RADIUS;
                return (
                  <div key={sub.id} className="absolute"
                    style={{
                      top: "50%", left: "50%",
                      transform: isHovered ? `translate(${sdx}px, ${sdy}px) translate(-50%, -50%) scale(1)` : "translate(0,0) translate(-50%, -50%) scale(0.3)",
                      opacity: isHovered ? 1 : 0,
                      transition: isHovered ? `transform 420ms ${SPRING} ${j * 60}ms, opacity 300ms ${SMOOTH} ${j * 60}ms` : `transform 220ms ${SMOOTH}, opacity 180ms ${SMOOTH}`,
                      pointerEvents: isHovered ? "auto" : "none", zIndex: 40,
                    }}>
                    <button onClick={(e) => { e.stopPropagation(); sub.onClick?.(); setOpen(false); setHoveredId(null); }}
                      title={sub.label} className="flex items-center justify-center w-10 h-10 rounded-full"
                      style={{ background: "white", border: "1px solid rgba(26,47,138,0.08)", boxShadow: "0 8px 20px -4px rgba(26,47,138,0.25), 0 0 0 1px rgba(255,255,255,0.5) inset", transition: `transform 240ms ${SPRING}, box-shadow 240ms ${SMOOTH}` }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.15)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}>
                      {sub.src ? <img src={sub.src} alt={sub.alt ?? sub.label} className="w-6 h-6 object-contain" />
                        : sub.icon && React.createElement(sub.icon, { size: 14, strokeWidth: 2.4, style: { color: colors.primary } })}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
<button onClick={() => setOpen(o => !o)} title={t("more_actions")}
        className="relative flex items-center justify-center w-9 h-9 rounded-full z-40"
        style={{
          background: open ? colors.primary : "rgba(26,47,138,0.06)",
          color: open ? "white" : colors.primary,
          border: open ? `1px solid ${colors.primary}` : "1px solid rgba(26,47,138,0.1)",
          boxShadow: open ? "0 10px 28px -6px rgba(26,47,138,0.5), 0 0 0 4px rgba(26,47,138,0.08)" : "0 2px 6px -2px rgba(26,47,138,0.15)",
          transform: open ? "rotate(90deg) scale(1.05)" : "rotate(0deg) scale(1)",
          transition: `all 360ms ${SPRING}`,
        }}>
        <MoreHorizontal size={17} strokeWidth={2.5} />
      </button>
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════════
   PageHeader — glass shell with internal segmentation.
   Title morphs to reflect the hovered tab (or active when no hover).
═══════════════════════════════════════════════════════════════ */
export default function PageHeader({
  kicker,
  titleSuffix,
  title,
  tabs,
  activeTab,
  onTabChange,
  filters = [],
  periodToggle,
  compareToggle,
aiToggle,
  onBack,
  headerSearch,
  headerActions,
  headerExtra,
  onExportPdf,
  onExportXlsx,
  onMappingsClick,
}) {
const { colors } = useSettings();
  const headerStyle = useTypo("header1");
  const t = useT();
  const activeTabObj = tabs?.find(t => t.id === activeTab);
  const displayTitle = activeTabObj?.label ?? title;

// Always show the first 3 filters (Year, Month, Company by convention); rest go behind "More filters"
  const primaryFilters = filters.slice(0, 3);
  const secondaryFilters = filters.slice(3);

const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [moreFiltersClosing, setMoreFiltersClosing] = useState(false);
  const moreFiltersHoverRef = useRef(false);
  const moreFiltersCloseTimerRef = useRef(null);
  const [exportMode, setExportMode] = useState(false); // false = [Export, Mappings], true = [PDF, Excel]
  const exportButtonsRef = useRef(null);

useEffect(() => {
    if (!exportMode) return;
    const handler = (e) => {
      if (exportButtonsRef.current && !exportButtonsRef.current.contains(e.target)) {
        setExportMode(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMode]);

  // When moreFiltersOpen is on but mouse is no longer hovering and no dropdown is open, close it.
  // Re-check periodically while open.
useEffect(() => {
    if (!moreFiltersOpen) return;
    const interval = setInterval(() => {
      if (moreFiltersHoverRef.current) return;
      const anyDropdownOpen = document.querySelector(".fixed.z-\\[9999\\]");
      if (!anyDropdownOpen) {
        setMoreFiltersClosing(true);
        setMoreFiltersOpen(false);
        setTimeout(() => setMoreFiltersClosing(false), 500);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [moreFiltersOpen]);
return (
<div className="sticky top-0 z-50 bg-[#f8f9ff] overflow-visible">
      {/* Match sidebar's logo card height (7vh) and rounded card vibe */}
<div className="flex items-stretch gap-0 relative overflow-visible bg-white rounded-2xl shadow-xl border border-gray-100"
style={{
          height: "7vh",
          padding: "0 18px 0 18px",
          paddingRight: 6,
        }}>

        {/* Brand block — title morphs based on hovered tab */}
<div className="flex items-center gap-2.5 min-w-0 pr-4">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
             title={t("back")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: colors.primary }}>
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
          )}
          <div className="w-1 h-9 rounded-full"
            style={{
              background: `linear-gradient(180deg, ${colors.primary} 0%, ${colors.primary}88 100%)`,
            }} />
<div className="overflow-visible min-w-0">
            {kicker && (
              <p className="uppercase tracking-[0.22em] leading-none mb-1 text-[10px] font-black"
                style={{ color: colors.primary, opacity: 0.5 }}>
                {kicker}
              </p>
            )}
<h1 key={displayTitle}
              style={{
                ...headerStyle,
                lineHeight: 1,
                letterSpacing: "-0.018em",
                animation: `titleMorph 380ms ${SPRING}`,
                whiteSpace: "nowrap",
                overflow: "visible",
              }}>
              {displayTitle}
            </h1>
          </div>
        </div>

        {/* Divider */}
        {titleSuffix && (<><SoftDivider /><div className="px-3 flex items-center"><span className="text-sm font-bold" style={{ color: colors.primary, opacity: 0.65 }}>{titleSuffix}</span></div></>)}
        {(tabs || filters.length > 0) && <SoftDivider />}

        {/* Tabs */}
        {tabs && (
          <div className="flex items-center px-3">
            <TabSwitcher tabs={tabs} activeTab={activeTab} onChange={onTabChange} />
          </div>
        )}

        {/* Divider */}
        {tabs && filters.length > 0 && <SoftDivider />}

{/* Filters — primary always visible; secondary revealed on More filters hover */}
{filters.length > 0 && (
<div
    className="no-scrollbar flex items-center gap-1 px-3 overflow-x-auto relative"
    style={{ flexWrap: "nowrap", pointerEvents: moreFiltersClosing ? "none" : "auto" }}
onMouseEnter={() => {
      moreFiltersHoverRef.current = true;
      if (moreFiltersCloseTimerRef.current) {
        clearTimeout(moreFiltersCloseTimerRef.current);
        moreFiltersCloseTimerRef.current = null;
      }
      setMoreFiltersOpen(true);
    }}
onMouseLeave={() => {
      moreFiltersHoverRef.current = false;
      moreFiltersCloseTimerRef.current = setTimeout(() => {
        const anyDropdownOpen = document.querySelector(".fixed.z-\\[9999\\]");
        if (!anyDropdownOpen && !moreFiltersHoverRef.current) {
          setMoreFiltersClosing(true);
          setMoreFiltersOpen(false);
          setTimeout(() => setMoreFiltersClosing(false), 500);
        }
      }, 150);
    }}
  >
    {primaryFilters.map((f, i) =>
      f.render
        ? <span key={i}>{f.render()}</span>
        : f.multiselect
          ? <MultiFilterPill key={f.label + i} {...f} />
          : <FilterPill key={f.label + i} {...f} />
    )}

{secondaryFilters.length > 0 && (
      <div className="flex items-center gap-1 flex-shrink-0 relative">
        {/* More filters button — same look as a FilterPill, collapses when hovered */}
        <button
          className="flex items-center gap-2 rounded-xl select-none overflow-hidden flex-shrink-0"
          style={{
            padding: "8px 12px",
            background: moreFiltersOpen ? "transparent" : "transparent",
            maxWidth: moreFiltersOpen ? 0 : 200,
            opacity: moreFiltersOpen ? 0 : 1,
            paddingLeft: moreFiltersOpen ? 0 : 12,
            paddingRight: moreFiltersOpen ? 0 : 12,
            transition: `max-width 320ms ${SPRING}, opacity 220ms ${SMOOTH}, padding 320ms ${SPRING}, background 220ms ${SMOOTH}`,
            pointerEvents: moreFiltersOpen ? "none" : "auto",
            lineHeight: 1,
          }}
          onMouseEnter={e => {
            if (!moreFiltersOpen) e.currentTarget.style.background = "rgba(26,47,138,0.06)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none whitespace-nowrap"
            style={{ color: colors.primary, opacity: 0.55 }}>
          {t("more_filters")}
          </span>
          <span className="text-[10px] font-bold leading-none"
            style={{ color: colors.primary, opacity: 0.4 }}>
            +{secondaryFilters.length}
          </span>
        </button>

        {/* Secondary filters appear in place of the More button */}
        <div
          className="flex items-center gap-1 overflow-hidden"
          style={{
            maxWidth: moreFiltersOpen ? 1400 : 0,
            opacity: moreFiltersOpen ? 1 : 0,
            transition: `max-width 420ms ${SPRING}, opacity 240ms ${SMOOTH}`,
            pointerEvents: moreFiltersOpen ? "auto" : "none",
          }}
        >
          {secondaryFilters.map((f, i) =>
            f.render
              ? <span key={i}>{f.render()}</span>
              : f.multiselect
                ? <MultiFilterPill key={f.label + i} {...f} />
                : <FilterPill key={f.label + i} {...f} />
          )}
        </div>
      </div>
    )}
  </div>
)}

{/* Spacer pushes FAB to the right edge */}
        <div className="flex-grow" />

{/* Inline toggles (period + compare + AI) + Export/Mappings — collapse when More filters hover is active */}
        {(periodToggle || compareToggle || aiToggle || onExportPdf || onMappingsClick) && (
          <>
            <SoftDivider />
<div
              className="flex items-center gap-1.5 px-3 flex-shrink-0 overflow-hidden"
              style={{
                maxWidth: moreFiltersOpen ? 0 : 1200,
                opacity: moreFiltersOpen ? 0 : 1,
                paddingLeft: moreFiltersOpen ? 0 : 12,
                paddingRight: moreFiltersOpen ? 0 : 12,
                transition: `max-width 420ms ${SPRING}, opacity 240ms ${SMOOTH}, padding 320ms ${SMOOTH}`,
                pointerEvents: moreFiltersOpen ? "none" : "auto",
              }}
            >
              {aiToggle && (
                <button
                  onClick={aiToggle.onClick}
                  title={t("ai_finance_analyst")}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 transition-all duration-200"
                  style={{
                    background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary ?? "#CF305D"} 100%)`,
                    boxShadow: `0 4px 14px -4px ${colors.primary}70`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.04)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                  <span className="text-[10px] font-black text-white uppercase tracking-wider">AI</span>
                </button>
              )}
{periodToggle && (
                <button
                  onClick={() => periodToggle.onChange(periodToggle.value === "monthly" ? "ytd" : "monthly")}
                  title={periodToggle.value === "ytd" ? `${t("mode_ytd")} — click for ${t("mode_monthly")}` : `${t("mode_monthly")} — click for ${t("mode_ytd")}`}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0"
                  style={{
                    background: "rgba(26,47,138,0.06)",
                    color: colors.primary,
                    border: "1px solid rgba(26,47,138,0.1)",
                    boxShadow: "0 1px 3px -1px rgba(26,47,138,0.1)",
                    transition: `all 240ms ${SMOOTH}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${colors.primary}12`; e.currentTarget.style.transform = "scale(1.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(26,47,138,0.06)"; e.currentTarget.style.transform = "scale(1)"; }}>
                  {periodToggle.value === "ytd"
                    ? <CalendarRange size={13} strokeWidth={2.4} />
                    : <Calendar size={13} strokeWidth={2.4} />}
<span className="hidden 2xl:inline text-[10px] font-black uppercase tracking-wider">
                    {periodToggle.value === "ytd" ? t("mode_ytd") : t("mode_monthly")}
                  </span>
                </button>
              )}
{compareToggle && (
                <button
onClick={() => { if (!compareToggle.disabled) compareToggle.onChange(!compareToggle.active); }}
                  title={compareToggle.disabled ? t("disable_history_first") : compareToggle.active ? `${t("btn_compare")} ✕` : t("btn_compare_with")}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0"
                  style={{
                    background: compareToggle.disabled ? "rgba(26,47,138,0.03)" : compareToggle.active ? colors.primary : "rgba(26,47,138,0.06)",
                    color: compareToggle.disabled ? "rgba(26,47,138,0.25)" : compareToggle.active ? "white" : colors.primary,
                    cursor: compareToggle.disabled ? "not-allowed" : "pointer",
                    border: compareToggle.active ? `1px solid ${colors.primary}` : "1px solid rgba(26,47,138,0.1)",
                    boxShadow: compareToggle.active
                      ? "0 4px 12px -2px rgba(26,47,138,0.35)"
                      : "0 1px 3px -1px rgba(26,47,138,0.1)",
                    transition: `all 240ms ${SMOOTH}`,
                  }}
                  onMouseEnter={e => { if (!compareToggle.active) { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.background = `${colors.primary}12`; } }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; if (!compareToggle.active) e.currentTarget.style.background = "rgba(26,47,138,0.06)"; }}>
                  <GitCompareArrows size={13} strokeWidth={compareToggle.active ? 2.4 : 2} />
<span className="hidden 2xl:inline text-[10px] font-black uppercase tracking-wider">
                    {t("btn_compare") ?? "CMP"}
                  </span>
                </button>
              )}

{(onExportPdf || onExportXlsx || onMappingsClick) && (
                <div ref={exportButtonsRef} className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      if (exportMode) {
                        onExportPdf?.();
                        setExportMode(false);
                      } else {
                        setExportMode(true);
                      }
                    }}
                    title={exportMode ? t("download_pdf") : t("export")}
                    className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0"
                    style={{
                      background: exportMode ? "white" : "rgba(26,47,138,0.06)",
                      color: exportMode ? "#CD202C" : colors.primary,
                      border: exportMode ? "1px solid rgba(205,32,44,0.25)" : "1px solid rgba(26,47,138,0.1)",
                      boxShadow: exportMode
                        ? "0 4px 12px -2px rgba(205,32,44,0.18)"
                        : "0 1px 3px -1px rgba(26,47,138,0.1)",
                      transition: `all 240ms ${SMOOTH}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                  >
{exportMode ? (
                      <img src="https://logodownload.org/wp-content/uploads/2021/05/adobe-acrobat-reader-logo-1.png"
                        alt="PDF" style={{ width: 16, height: 16, objectFit: "contain", display: "block" }} />
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                    )}
<span className="hidden 2xl:inline text-[10px] font-black uppercase tracking-wider">
                     {exportMode ? "PDF" : t("export")}
                    </span>
                  </button>

<button
                    onClick={() => {
                      if (exportMode) {
                        onExportXlsx?.();
                        setExportMode(false);
                      } else {
                        onMappingsClick?.();
                      }
                    }}
                    title={exportMode ? t("download_excel") : t("mappings")}
                    className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0"
                    style={{
                      background: exportMode ? "white" : "rgba(26,47,138,0.06)",
                      color: exportMode ? "#217346" : colors.primary,
                      border: exportMode ? "1px solid rgba(33,115,70,0.25)" : "1px solid rgba(26,47,138,0.1)",
                      boxShadow: exportMode
                        ? "0 4px 12px -2px rgba(33,115,70,0.18)"
                        : "0 1px 3px -1px rgba(26,47,138,0.1)",
                      transition: `all 240ms ${SMOOTH}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                  >
{exportMode ? (
                      <img src="https://logodownload.org/wp-content/uploads/2020/04/excel-logo-0.png"
                        alt="Excel" style={{ width: 22, height: 22, objectFit: "contain", display: "block" }} />
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                        <polyline points="2 17 12 22 22 17"/>
                        <polyline points="2 12 12 17 22 12"/>
                      </svg>
                    )}
<span className="hidden 2xl:inline text-[10px] font-black uppercase tracking-wider">
                   {exportMode ? "Excel" : t("mappings")}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}

{/* Header search */}
        {headerSearch && (
          <>
            <SoftDivider />
            <div className="flex items-center gap-2 px-3">
              <div className="flex items-center gap-2 rounded-xl px-3 py-1.5 border border-gray-100 bg-gray-50">
                <Search size={12} className="text-gray-400 flex-shrink-0" />
               <input type="text" value={headerSearch.value} onChange={e => headerSearch.onChange(e.target.value)} placeholder={headerSearch.placeholder ?? t("search_placeholder")} className="text-xs outline-none bg-transparent text-gray-700 placeholder:text-gray-300 w-40" />
                {headerSearch.value && <button onClick={() => headerSearch.onChange("")}><X size={11} className="text-gray-400 hover:text-gray-600" /></button>}
              </div>
            </div>
          </>
        )}
        {/* Header actions */}
        {headerActions?.length > 0 && (
          <>
            <SoftDivider />
            <div className="flex items-center gap-2 px-3">
              {headerActions.map((action, i) => {
                const Icon = action.icon;
                return (
                  <button key={i} onClick={action.onClick} title={action.label} className="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:scale-105" style={{ background: colors.primary, color: "white", boxShadow: `0 4px 12px -4px ${colors.primary}60` }}>
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
          </>
        )}
{/* Header extra — raw JSX slot */}
        {headerExtra && (
          <>
            <SoftDivider />
            <div className="flex items-center gap-2 px-3">
              {headerExtra}
            </div>
          </>
        )}
        
      </div>

<style>{`
        @keyframes titleMorph {
          0%   { opacity: 0; transform: translateY(4px); filter: blur(2px); }
          60%  { opacity: 1; filter: blur(0px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0px); }
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
    </div>
  );
}

/* Internal soft divider — hairline that fades at the ends */
function SoftDivider() {
  return (
    <div className="flex-shrink-0 self-stretch flex items-center" aria-hidden>
      <span style={{
        width: 1,
        height: "60%",
        background: "linear-gradient(180deg, transparent 0%, rgba(26,47,138,0.12) 30%, rgba(26,47,138,0.12) 70%, transparent 100%)",
      }} />
    </div>
  );
}