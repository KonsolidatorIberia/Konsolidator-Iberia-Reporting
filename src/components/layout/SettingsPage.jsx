import { useState, useEffect, useMemo, useRef } from "react";

import {
  Type, Palette, RotateCcw, Check, ChevronDown,
  Hash, AlignLeft, Minus, Save, Eye,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════
   DEFAULTS
   ─────────────────────────────────────────────────────────────────────
   Every style object uses the same shape: { font, size, weight, color }
   so the StyleRow component can render them uniformly.
═══════════════════════════════════════════════════════════════════════ */

const FONT_FAMILIES = [
  { value: "Inter, sans-serif",                label: "Inter" },
  { value: "Lato, sans-serif",                 label: "Lato" },
  { value: "Kanit, sans-serif",                label: "Kanit" },
  { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: "Helvetica" },
  { value: "Arial, sans-serif",                label: "Arial" },
  { value: '"SF Pro Display", system-ui, sans-serif', label: "SF Pro" },
  { value: '"Segoe UI", Tahoma, sans-serif',   label: "Segoe UI" },
  { value: "Roboto, sans-serif",               label: "Roboto" },
  { value: '"IBM Plex Sans", sans-serif',      label: "IBM Plex Sans" },
  { value: "Poppins, sans-serif",              label: "Poppins" },
  { value: '"Source Sans Pro", sans-serif',    label: "Source Sans" },
  { value: 'Georgia, "Times New Roman", serif', label: "Georgia" },
  { value: '"JetBrains Mono", "Courier New", monospace', label: "JetBrains Mono" },
  { value: '"SF Mono", Consolas, monospace',   label: "SF Mono" },
];

const WEIGHTS = [
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extrabold" },
  { value: 900, label: "Black" },
];

const DEFAULT_SETTINGS = {
  typography: {
    header1:      { font: "Inter, sans-serif", size: 29, weight: 900, color: "#1A2F8A" },
    header2:      { font: "Inter, sans-serif", size: 18, weight: 800, color: "#1A2F8A" },
    body1:        { font: "Inter, sans-serif", size: 13, weight: 500, color: "#2F3138" },
    body2:        { font: "Inter, sans-serif", size: 11, weight: 400, color: "#6B7280" },
    underscore1:  { font: "Inter, sans-serif", size: 10, weight: 800, color: "#9CA3AF" },
    underscore2:  { font: "Inter, sans-serif", size: 9,  weight: 700, color: "#B0B4BD" },
    headerNum:    { font: '"JetBrains Mono", "Courier New", monospace', size: 22, weight: 800, color: "#1A2F8A" },
    bodyNum1:     { font: '"JetBrains Mono", "Courier New", monospace', size: 13, weight: 600, color: "#1A2F8A" },
    bodyNum2:     { font: '"JetBrains Mono", "Courier New", monospace', size: 12, weight: 500, color: "#2F3138" },
    bodyNum3:     { font: '"JetBrains Mono", "Courier New", monospace', size: 11, weight: 400, color: "#6B7280" },
    underNum:     { font: '"JetBrains Mono", "Courier New", monospace', size: 10, weight: 500, color: "#9CA3AF" },
  },
  colors: {
    primary:   "#1A2F8A",
    secondary: "#CF305D",
    tertiary:  "#57AA78",
  },
};

const STYLE_GROUPS = [
  {
    title: "Text — Headers",
    icon: Type,
    items: [
      { key: "header1", label: "Header 1", hint: "" },
      { key: "header2", label: "Header 2", hint: "" },
    ],
  },
  {
    title: "Text — Body",
    icon: AlignLeft,
    items: [
      { key: "body1", label: "Body 1", hint: "" },
      { key: "body2", label: "Body 2", hint: "" },
    ],
  },
  {
    title: "Text — Underscore",
    icon: Minus,
    items: [
      { key: "underscore1", label: "Underscore 1", hint: "" },
      { key: "underscore2", label: "Underscore 2", hint: "" },
    ],
  },
  {
    title: "Numbers — Header",
    icon: Hash,
    items: [
      { key: "headerNum", label: "Header Number", hint: "" },
    ],
  },
  {
    title: "Numbers — Body",
    icon: Hash,
    items: [
      { key: "bodyNum1", label: "Body Number 1", hint: "" },
      { key: "bodyNum2", label: "Body Number 2", hint: "" },
      { key: "bodyNum3", label: "Body Number 3", hint: "" },
    ],
  },
  {
    title: "Numbers — Underscore",
    icon: Hash,
    items: [
      { key: "underNum", label: "Underscore Number", hint: "" },
    ],
  },
];

const COLOR_ROLES = [
  { key: "primary",   label: "Primary",   hint: "" },
  { key: "secondary", label: "Secondary", hint: "" },
  { key: "tertiary",  label: "Tertiary",  hint: "" },
];

/* ═══════════════════════════════════════════════════════════════════════
   REUSABLE CONTROLS
═══════════════════════════════════════════════════════════════════════ */

function Dropdown({ value, onChange, options, placeholder = "—", width = 160 }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0, openUp: false });
  const btnRef = useRef(null);
  const display = options.find(o => String(o.value) === String(value))?.label ?? placeholder;

  const openMenu = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const MENU_MAX_H = 256; // matches max-h-64
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < Math.min(MENU_MAX_H, 200) && spaceAbove > spaceBelow;
    setMenuPos({
      top:    openUp ? rect.top - 6 : rect.bottom + 6,
      left:   rect.left,
      width:  rect.width,
      openUp,
    });
    setOpen(true);
  };

  // Close on outside click, Escape, scroll, or resize
  useEffect(() => {
    if (!open) return;
    const closeOnClick = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (e.target.closest?.("[data-dropdown-menu]")) return;
      setOpen(false);
    };
    const closeOnKey = (e) => { if (e.key === "Escape") setOpen(false); };
 const closeOnScroll = (e) => {
      // Ignore scrolls inside the menu itself (so users can scroll the options list)
      if (e.target.closest?.("[data-dropdown-menu]")) return;
      setOpen(false);
    };
    const closeOnResize = () => setOpen(false);

    document.addEventListener("mousedown", closeOnClick);
    document.addEventListener("keydown", closeOnKey);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("mousedown", closeOnClick);
      document.removeEventListener("keydown", closeOnKey);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  return (
    <div className="relative flex-shrink-0" style={{ width }}>
      <button
        ref={btnRef}
        onClick={() => open ? setOpen(false) : openMenu()}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:border-[#1a2f8a]/40 text-xs text-gray-700 font-medium transition-all"
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={11} className={`text-gray-400 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          data-dropdown-menu
          className="bg-white rounded-xl border border-gray-100 shadow-xl overflow-hidden"
          style={{
            position: "fixed",
            top:      menuPos.openUp ? "auto" : menuPos.top,
            bottom:   menuPos.openUp ? window.innerHeight - menuPos.top : "auto",
            left:     menuPos.left,
            width:    menuPos.width,
            zIndex:   9999,
          }}
        >
          <div className="p-1 max-h-64 overflow-y-auto">
            {options.map(o => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between gap-2
                  ${String(o.value) === String(value) ? "bg-[#1a2f8a] text-white" : "text-gray-600 hover:bg-[#eef1fb] hover:text-[#1a2f8a]"}`}
              >
                <span className="truncate">{o.label}</span>
                {String(o.value) === String(value) && <Check size={10} className="flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberStepper({ value, onChange, min = 8, max = 96, step = 1 }) {
  return (
    <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden bg-white flex-shrink-0" style={{ width: 90 }}>
      <button
        onClick={() => onChange(Math.max(min, value - step))}
        className="px-2 py-1.5 text-gray-400 hover:text-[#1a2f8a] hover:bg-gray-50 text-xs font-bold transition-colors"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        onChange={e => {
          const v = parseInt(e.target.value);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="flex-1 w-0 text-center text-xs font-mono text-gray-700 outline-none bg-transparent py-1.5"
      />
      <button
        onClick={() => onChange(Math.min(max, value + step))}
        className="px-2 py-1.5 text-gray-400 hover:text-[#1a2f8a] hover:bg-gray-50 text-xs font-bold transition-colors"
      >
        +
      </button>
    </div>
  );
}

function ColorSwatch({ value, onChange, size = 28 }) {
  return (
    <label className="relative flex-shrink-0 cursor-pointer group" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-lg border border-gray-200 group-hover:border-[#1a2f8a]/40 shadow-sm transition-all"
        style={{ background: value }}
      />
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
    </label>
  );
}

function HexInput({ value, onChange }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => {
        const v = e.target.value;
        if (/^#?[0-9A-Fa-f]{0,6}$/.test(v)) {
          onChange(v.startsWith("#") ? v : `#${v}`);
        }
      }}
      className="w-20 px-2 py-1 rounded-lg border border-gray-200 text-xs font-mono text-gray-700 outline-none focus:border-[#1a2f8a]/40 bg-white uppercase"
      placeholder="#000000"
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   STYLE ROW — one editable typography style
═══════════════════════════════════════════════════════════════════════ */

function StyleRow({ item, style, onChange }) {
  const previewText = /Num/.test(item.key)
    ? "1,234,567.89"
    : /header/i.test(item.key)
      ? "The Quick Brown Fox"
      : /underscore/i.test(item.key)
        ? "UPPERCASE LABEL"
        : "The quick brown fox jumps over the lazy dog";

  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-white border border-gray-100 hover:border-gray-200 transition-all">
      {/* Label column */}
      <div className="w-[160px] flex-shrink-0">
        <p className="text-xs font-bold text-gray-700">{item.label}</p>
        <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{item.hint}</p>
      </div>

      {/* Preview */}
      <div className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-gray-50/70 border border-gray-100 overflow-hidden">
        <span
          className="truncate block"
          style={{
            fontFamily: style.font,
            fontSize:   style.size,
            fontWeight: style.weight,
            color:      style.color,
            lineHeight: 1.2,
          }}
        >
          {previewText}
        </span>
      </div>

      {/* Controls */}
      <Dropdown
        value={style.font}
        onChange={v => onChange({ ...style, font: v })}
        options={FONT_FAMILIES}
        width={150}
      />
      <NumberStepper
        value={style.size}
        onChange={v => onChange({ ...style, size: v })}
        min={8}
        max={72}
      />
      <Dropdown
        value={style.weight}
        onChange={v => onChange({ ...style, weight: v })}
        options={WEIGHTS}
        width={110}
      />
      <div className="flex items-center gap-2">
        <ColorSwatch value={style.color} onChange={v => onChange({ ...style, color: v })} />
        <HexInput value={style.color} onChange={v => onChange({ ...style, color: v })} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PREVIEW PANEL — small live app-like card
═══════════════════════════════════════════════════════════════════════ */

function PreviewPanel({ settings }) {
  const { typography: t, colors: c } = settings;

  const styleOf = (key) => ({
    fontFamily: t[key].font,
    fontSize:   t[key].size,
    fontWeight: t[key].weight,
    color:      t[key].color,
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden">
      {/* Header strip — uses primary color */}
      <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: c.primary }}>
        <span className="text-white font-black text-sm">Live Preview</span>
        <Eye size={14} className="text-white/60" />
      </div>

      <div className="p-5 space-y-4">
        {/* Page title + subtitle */}
        <div>
          <p style={styleOf("underscore1")} className="uppercase tracking-widest mb-1">Dashboard</p>
          <h1 style={styleOf("header1")}>Profit & Loss Summary</h1>
          <p style={styleOf("body2")} className="mt-1">Fiscal Year 2026 · March · Actual vs Budget</p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "REVENUE", value: "1,284,567", color: c.primary },
            { label: "EBITDA",  value: "342,891",   color: c.tertiary },
            { label: "MARGIN",  value: "26.7%",     color: c.secondary },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-gray-100 p-3" style={{ backgroundColor: c.accent }}>
              <p style={styleOf("underscore1")} className="uppercase tracking-widest">{k.label}</p>
              <p style={{ ...styleOf("headerNum"), color: k.color }} className="mt-1">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Section header + body */}
        <div>
          <h2 style={styleOf("header2")} className="mb-2">Operating Performance</h2>
          <p style={styleOf("body1")}>
            The quarter closed with solid operational momentum. Revenue expansion continued across
            core segments, supported by favorable pricing and stable volumes.
          </p>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="grid grid-cols-4 px-4 py-2" style={{ backgroundColor: c.primary }}>
            {["Account", "Actual", "Budget", "Δ"].map((h, i) => (
              <span key={h}
                style={{ ...styleOf("underscore1"), color: "#FFFFFF" }}
                className={`uppercase tracking-widest ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </span>
            ))}
          </div>
          {[
            ["Revenue",        "1,284,567", "1,200,000",  "+84,567"],
            ["Cost of sales",  "-742,103",  "-720,000",   "-22,103"],
            ["Gross profit",   "542,464",   "480,000",    "+62,464"],
            ["Operating exp.", "-199,573",  "-195,000",   "-4,573"],
          ].map((row, i) => (
            <div key={i} className={`grid grid-cols-4 px-4 py-2 border-t border-gray-50 ${i % 2 ? "bg-gray-50/50" : ""}`}>
              <span style={styleOf("body1")}>{row[0]}</span>
              <span style={styleOf("bodyNum1")} className="text-right">{row[1]}</span>
              <span style={styleOf("bodyNum2")} className="text-right">{row[2]}</span>
              <span
                style={{ ...styleOf("bodyNum3"), color: row[3].startsWith("+") ? c.tertiary : c.secondary }}
                className="text-right">
                {row[3]}
              </span>
            </div>
          ))}
        </div>

        {/* Footnote */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-50">
          <p style={styleOf("underscore2")} className="uppercase tracking-widest">Last updated · 21 Apr 2026</p>
          <p style={styleOf("underNum")}>Ref #42-0917</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN SETTINGS PAGE
═══════════════════════════════════════════════════════════════════════ */

export default function SettingsPage() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("konsolidator_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge so new fields in DEFAULT_SETTINGS don't break old saved state
        return {
          typography: { ...DEFAULT_SETTINGS.typography, ...(parsed.typography ?? {}) },
          colors:     { ...DEFAULT_SETTINGS.colors,     ...(parsed.colors     ?? {}) },
        };
      }
    } catch { /* ignore */ }
    return DEFAULT_SETTINGS;
  });

  const [activeTab, setActiveTab] = useState("typography"); // "typography" | "colors"
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(() => {
    try {
      const saved = localStorage.getItem("konsolidator_settings");
      if (!saved) return JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);
      return saved !== JSON.stringify(settings);
    } catch { return false; }
  }, [settings]);

  const updateStyle = (key, newStyle) => {
    setSettings(s => ({ ...s, typography: { ...s.typography, [key]: newStyle } }));
  };
  const updateColor = (key, value) => {
    setSettings(s => ({ ...s, colors: { ...s.colors, [key]: value } }));
  };

  const handleSave = () => {
    localStorage.setItem("konsolidator_settings", JSON.stringify(settings));
    window.dispatchEvent(new Event("konsolidator-settings-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    if (confirm("Reset all settings to defaults? This can't be undone.")) {
      setSettings(DEFAULT_SETTINGS);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Page Header */}
      <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: settings.colors.primary }} />
          <div>
            <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none mb-0.5">Workspace</p>
            <h1 className="text-[29px] font-black leading-none" style={{ color: settings.colors.primary }}>Settings</h1>
          </div>
        </div>

        <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 bg-[#e6e6e6] rounded-2xl flex-shrink-0 shadow-xl">
          {[
            { key: "typography", label: "", icon: Type },
            { key: "colors",     label: "",     icon: Palette },
          ].map(t => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-black transition-colors"
                style={{
                  color: active ? settings.colors.primary : "#636363",
                  backgroundColor: active ? "#fff" : "transparent",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0 pr-6">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-gray-200 text-gray-500 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/30 transition-all"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty && !saved}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: saved ? "#059669" : settings.colors.primary }}
          >
            {saved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save changes</>}
          </button>
        </div>
      </div>

      {/* Body: editor only */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">

          {activeTab === "typography" && (
            <div className="flex flex-col gap-5">
              {STYLE_GROUPS.map(group => {
                const Icon = group.icon;
                return (
                  <section key={group.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <header className="px-5 py-3 border-b border-gray-50 bg-gray-50/40 flex items-center gap-2">
                      <Icon size={13} className="text-[#1a2f8a]/60" />
                      <h2 className="text-xs font-black uppercase tracking-widest text-[#1a2f8a]">{group.title}</h2>
                    </header>
                    <div className="p-3 flex flex-col gap-2">
                      {group.items.map(item => (
                        <StyleRow
                          key={item.key}
                          item={item}
                          style={settings.typography[item.key]}
                          onChange={(newStyle) => updateStyle(item.key, newStyle)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {activeTab === "colors" && (
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <header className="px-5 py-3 border-b border-gray-50 bg-gray-50/40 flex items-center gap-2">
                <Palette size={13} className="text-[#1a2f8a]/60" />
                <h2 className="text-xs font-black uppercase tracking-widest text-[#1a2f8a]">Theme Colors</h2>
              </header>
              <div className="p-4 flex flex-col gap-3">
                {COLOR_ROLES.map(role => (
                  <div key={role.key}
                    className="flex items-center gap-4 py-3 px-4 rounded-xl bg-white border border-gray-100 hover:border-gray-200 transition-all">
                    <div className="w-[160px] flex-shrink-0">
                      <p className="text-xs font-bold text-gray-700">{role.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{role.hint}</p>
                    </div>

                    {/* Large swatch preview */}
                    <div className="flex-1 rounded-lg border border-gray-100 h-12 flex items-center justify-center"
                      style={{ backgroundColor: settings.colors[role.key] }}>
                      <span className="text-white/90 text-xs font-black font-mono uppercase tracking-widest">
                        {settings.colors[role.key]}
                      </span>
                    </div>

                    <ColorSwatch
                      value={settings.colors[role.key]}
                      onChange={v => updateColor(role.key, v)}
                      size={40}
                    />
                    <HexInput
                      value={settings.colors[role.key]}
                      onChange={v => updateColor(role.key, v)}
                    />
                  </div>
                ))}


              </div>
            </section>
          )}

  </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT HELPER — use this from anywhere in the app to read saved settings
═══════════════════════════════════════════════════════════════════════ */

export function loadSavedSettings() {
  try {
    const saved = localStorage.getItem("konsolidator_settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        typography: { ...DEFAULT_SETTINGS.typography, ...(parsed.typography ?? {}) },
        colors:     { ...DEFAULT_SETTINGS.colors,     ...(parsed.colors     ?? {}) },
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

export { DEFAULT_SETTINGS };