import { useState, useRef } from "react";
import {
  Home, Network, FileText, Layers, SlidersHorizontal,
  PieChart, Table, Table2, BookOpen, TrendingUp, BarChart3,
  ChevronRight, Eye, RefreshCw, Filter, Settings, Database,
} from "lucide-react";
import { useTypo, useSettings, useT } from "./SettingsContext";

const NAV_KEYS = [
  { key: "home",      labelKey: "nav_home",         icon: Home },
  {
    key: "individual", labelKey: "nav_individual",   icon: FileText,
    children: [
      { key: "individual-data",         labelKey: "nav_data",         icon: Table      },
      { key: "individual-kpis",         labelKey: "nav_kpis",         icon: BarChart3  },
      { key: "individual-dimensiones",  labelKey: "nav_dimensions",   icon: Filter     },
      { key: "individual-cashflow",     labelKey: "nav_cashflow",     icon: TrendingUp },
      { key: "individual-memory-notes", labelKey: "nav_memory_notes", icon: BookOpen   },
    ],
  },
  {
    key: "consolidated", labelKey: "nav_consolidated", icon: Layers,
    children: [
      { key: "individual-contributive",  labelKey: "nav_contributive",  icon: PieChart   },
      { key: "consolidated-sheet",       labelKey: "nav_sheet",         icon: Table      },
      { key: "consolidated-kpis",        labelKey: "nav_kpis",          icon: BarChart3  },
      { key: "consolidated-dimensiones",  labelKey: "nav_dimensions",    icon: Filter     },
      { key: "consolidated-cashflow",    labelKey: "nav_cashflow",      icon: TrendingUp },
      { key: "consolidated-notes",       labelKey: "nav_memory_notes",  icon: BookOpen   },
    ],
  },
  {
    key: "controlling", labelKey: "nav_controlling", icon: SlidersHorizontal,
    children: [
      { key: "controlling-forecast",    labelKey: "nav_forecasting",  icon: TrendingUp        },
      { key: "controlling-adjustments", labelKey: "nav_adjustments",  icon: SlidersHorizontal },
      { key: "controlling-kpis",        labelKey: "nav_kpis",         icon: BarChart3         },
    ],
  },
  { key: "views",        labelKey: "nav_views",        icon: Eye      },
  {
    key: "data-explorer", labelKey: "nav_data_explorer", icon: Database,
    children: [
      { key: "structure", labelKey: "nav_structure", icon: Network },
    ],
  },
];

const W_OPEN     = "10vw";
const W_CLOSED   = "4.5vw";
const TRANSITION = "400ms cubic-bezier(0.25,0.1,0.25,1)";

export default function Sidebar({ activePage, onNavigate, user, collapsed, onToggleCollapse, height = "100vh", onRefresh }) {
  const { colors } = useSettings();
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const t = useT();

  // Resolve translated labels at render time
  const NAV = NAV_KEYS.map(item => ({
    ...item,
    label: t(item.labelKey, item.labelKey),
    children: item.children?.map(c => ({
      ...c,
      label: t(c.labelKey, c.labelKey),
    })),
  }));

  const [hoveredKey, setHoveredKey] = useState(null);
  const [flyoutTop,  setFlyoutTop]  = useState(0);
  const rowRefs      = useRef({});
  const closeTimer   = useRef(null);
  const hoveredKeyRef = useRef(null);

  const activeParent = NAV.find(n =>
    n.key === activePage || n.children?.some(c => c.key === activePage)
  )?.key;

  const hoveredItem = NAV.find(n => n.key === hoveredKey);

  const handleMouseEnter = (key, hasChildren) => {
    if (!hasChildren) { setHoveredKey(null); return; }
    const el = rowRefs.current[key];
    if (el) setFlyoutTop(el.getBoundingClientRect().top);
    hoveredKeyRef.current = key;
    setHoveredKey(key);
  };

  return (
    <>
      <style>{`
        @keyframes navSlideIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <aside
        className="flex-shrink-0 z-40 flex flex-col gap-3 p-3"
        style={{ width: collapsed ? W_CLOSED : W_OPEN, height, transition: `width ${TRANSITION}` }}
      >

        {/* ── Logo ── */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 flex items-center justify-center overflow-hidden relative"
          style={{ height: "7vh" }}>
          <img src="/logo-full.png" alt="Konsolidator" className="absolute object-contain h-6"
            style={{ opacity: collapsed ? 0 : 1, transition: `opacity ${TRANSITION}`, pointerEvents: "none" }} />
          <img src="/logo-icon.png" alt="K" className="absolute object-contain h-8 w-8"
            style={{ opacity: collapsed ? 1 : 0, transition: `opacity ${TRANSITION}`, pointerEvents: "none" }} />
        </div>

{/* ── Nav ── */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 flex-1 flex flex-col py-3 overflow-visible">
          {NAV.map((item) => {
            const isActiveParent = activeParent === item.key;
            const hasChildren    = !!item.children?.length;
            const isHovered      = hoveredKey === item.key;

            return (
              <div
                key={item.key}
                ref={el => rowRefs.current[item.key] = el}
                className="relative"
                onMouseEnter={() => { clearTimeout(closeTimer.current); handleMouseEnter(item.key, hasChildren); }}
                onMouseLeave={() => { closeTimer.current = setTimeout(() => setHoveredKey(null), 300); }}
              >
<button
                  onClick={() => !hasChildren && onNavigate?.(item.key)}
                  onMouseEnter={(e) => { if (!isActiveParent) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                  onMouseLeave={(e) => { if (!isActiveParent) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body1Style?.color ?? "#2f3138"; } }}
                  className="w-full flex items-center py-2.5 transition-all duration-200"
                  style={{
                    justifyContent: "flex-start",
                    paddingLeft: "1.25rem",
                    paddingRight: "1rem",
                    color: isActiveParent ? colors.primary : (body1Style?.color ?? "#2f3138"),
                    backgroundColor: "transparent",
                  }}
                >
                  <item.icon size={20} className="flex-shrink-0" style={{ minWidth: 16 }} />
                  <span
                    className="text-left overflow-hidden whitespace-nowrap"
                    style={{
                      ...body1Style,
                      color: isActiveParent ? colors.primary : body1Style?.color,
                      maxWidth:   collapsed ? 0 : 140,
                      opacity:    collapsed ? 0 : 1,
                      marginLeft: "0.75rem",
                      transition: `max-width ${TRANSITION}, opacity ${TRANSITION}`,
                    }}
                  >
                    {item.label}
                  </span>
                  {isActiveParent && !collapsed && (
                    <span className="ml-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.primary }} />
                  )}
                </button>

                {/* Inline submenu */}
                {hasChildren && (
                  <div className="overflow-hidden" style={{
                    maxHeight:  (!collapsed && isHovered) ? `${item.children.length * 36}px` : 0,
                    opacity:    (!collapsed && isHovered) ? 1 : 0,
                    transition: `max-height 300ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease`,
                  }}>
                    {item.children.map((child, ci) => {
                      const isActive = activePage === child.key;
                      return (
<button
                          key={child.key}
                          onClick={() => { onNavigate?.(child.key); setHoveredKey(null); }}
                          onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                          onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body2Style?.color ?? "#9ca3af"; } }}
                          className="w-full flex items-center gap-2 pl-10 pr-4 py-2 text-left relative transition-all duration-200"
                          style={{
                            color: isActive ? colors.primary : (body2Style?.color ?? "#9ca3af"),
                            animation: (!collapsed && isHovered) ? `navSlideIn 200ms ease ${ci * 45}ms both` : "none",
                          }}
                        >
                          <span className="whitespace-nowrap" style={{ ...body2Style, fontSize: 12, color: isActive ? colors.primary : body2Style?.color }}>
                            {child.label}
                          </span>
                          {isActive && (
                            <span className="ml-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.primary }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Settings — pinned to bottom */}
          <div className="mt-auto pt-2 border-t border-gray-100">
            {(() => {
              const isActive = activePage === "settings";
              return (
<button
                  onClick={() => onNavigate?.("settings")}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body1Style?.color ?? "#2f3138"; } }}
                  className="w-full flex items-center py-2.5 transition-all duration-200"
                  style={{
                    justifyContent: "flex-start",
                    paddingLeft: "1.25rem",
                    paddingRight: "1rem",
                    color: isActive ? colors.primary : (body1Style?.color ?? "#2f3138"),
                    backgroundColor: "transparent",
                  }}
                >
                  <Settings size={20} className="flex-shrink-0" style={{ minWidth: 16 }} />
                  <span
                    className="text-left overflow-hidden whitespace-nowrap"
                    style={{
                      ...body1Style,
                      color: isActive ? colors.primary : body1Style?.color,
                      maxWidth:   collapsed ? 0 : 140,
                      opacity:    collapsed ? 0 : 1,
                      marginLeft: "0.75rem",
                      transition: `max-width ${TRANSITION}, opacity ${TRANSITION}`,
                    }}
>
                    {t("nav_settings")}
                  </span>
                  {isActive && !collapsed && (
                    <span className="ml-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.primary }} />
                  )}
                </button>
              );
            })()}
          </div>
        </div>

        {/* ── User ── */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-3 flex flex-col gap-2 overflow-hidden" style={{ minHeight: "6vh" }}>
          <div style={{
            maxHeight:  collapsed ? 0 : 48,
            opacity:    collapsed ? 0 : 1,
            overflow:   "hidden",
            transition: `max-height ${TRANSITION}, opacity ${TRANSITION}`,
          }}>
            <div className="flex items-center gap-2 px-2 pb-1 cursor-pointer" onClick={() => onNavigate?.("user")}>
<div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0" style={{ backgroundColor: colors.primary }}>
                {user?.username?.[0]?.toUpperCase() || "U"}
              </div>
              <p className="text-xs font-semibold text-gray-700 truncate">{user?.username}</p>
            </div>
          </div>
<div className="flex">
  <button
    onClick={onToggleCollapse}
    className="flex-1 flex items-center justify-center py-1.5 text-gray-400 hover:text-[#1a2f8a] hover:bg-gray-50 rounded-xl transition-colors"
  >
    <ChevronRight size={14} style={{ transition: `transform ${TRANSITION}`, transform: collapsed ? "rotate(0deg)" : "rotate(180deg)" }} />
  </button>
</div>
</div>
      </aside>

      {/* ── Collapsed flyout ── */}
      {collapsed && hoveredItem?.children && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-2 px-1"
          style={{ left: "calc(4.5vw + 4px)", top: flyoutTop }}
          onMouseEnter={() => { clearTimeout(closeTimer.current); setHoveredKey(hoveredKeyRef.current); }}
          onMouseLeave={() => { closeTimer.current = setTimeout(() => setHoveredKey(null), 300); }}
        >
          
          {hoveredItem.children.map((child, ci) => {
            const isActive = activePage === child.key;
            return (
<button
                key={child.key}
                onClick={() => { onNavigate?.(child.key); setHoveredKey(null); }}
                onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body2Style?.color ?? "#6b7280"; } }}
                className="flex items-center gap-2 px-3 py-2 w-full text-left whitespace-nowrap rounded-lg transition-all duration-200"
                style={{
                  color: isActive ? colors.primary : (body2Style?.color ?? "#6b7280"),
                  animation: `navSlideIn 180ms ease ${ci * 40}ms both`,
                }}
              >
                <span className="whitespace-nowrap" style={{ ...body2Style, fontSize: 12, color: isActive ? colors.primary : body2Style?.color }}>{child.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.primary }} />
                )}
              </button>
              
            );
          })}
        </div>
      )}
    </>
  );
}