import { useState, useRef } from "react";
import {
  Home, Network, FileText, Layers, SlidersHorizontal,
  PieChart, Table, Table2, BookOpen, TrendingUp, BarChart3,
  ChevronRight, Eye, RefreshCw, Filter,
} from "lucide-react";

const NAV = [
  { key: "home",      label: "Home",      icon: Home },
  { key: "structure", label: "Structure", icon: Network },
  {
    key: "individual", label: "Individual", icon: FileText,
    children: [
      { key: "individual-data",        label: "Data",        icon: Table    },
      { key: "individual-contributive",label: "Contributive",icon: PieChart },
      { key: "individual-kpis",        label: "KPIs",        icon: BarChart3 },
      { key: "individual-dimensiones", label: "Dimensiones", icon: Filter   },
    ],
  },
  {
    key: "consolidated", label: "Consolidated", icon: Layers,
    children: [
      { key: "consolidated-sheet", label: "Consolidation Sheet", icon: Table     },
      { key: "consolidated-mgmt",  label: "Consolidating Mgmt",  icon: BarChart3 },
      { key: "consolidated-notes", label: "Memory Notes",        icon: BookOpen  },
    ],
  },
  {
    key: "controlling", label: "Controlling", icon: SlidersHorizontal,
    children: [
      { key: "controlling-forecast",    label: "Forecasting", icon: TrendingUp        },
      { key: "controlling-adjustments", label: "Adjustments", icon: SlidersHorizontal },
      { key: "controlling-kpis",        label: "KPIs",        icon: BarChart3         },
    ],
  },
  { key: "views", label: "Views", icon: Eye },
];

const W_OPEN     = "10vw";
const W_CLOSED   = "4.5vw";
const TRANSITION = "400ms cubic-bezier(0.25,0.1,0.25,1)";

export default function Sidebar({ activePage, onNavigate, user, collapsed, onToggleCollapse, height = "100vh", onRefresh }) {
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
                  className={`w-full flex items-center py-2.5 transition-colors
                    ${isActiveParent
                      ? "text-[#3151e0] bg-[#1a2f8a]/5 border-r-2"
                      : "text-[#2f3138] hover:text-gray-600 hover:bg-gray-100"}`}
                  style={{ justifyContent: "flex-start", paddingLeft: "1.25rem", paddingRight: "1rem" }}
                >
                  <item.icon size={20} className="flex-shrink-0" style={{ minWidth: 16 }} />
                  <span
                    className="text-xs font-semibold text-left overflow-hidden whitespace-nowrap"
                    style={{
                      maxWidth:   collapsed ? 0 : 140,
                      opacity:    collapsed ? 0 : 1,
                      marginLeft: "0.75rem",
                      transition: `max-width ${TRANSITION}, opacity ${TRANSITION}`,
                    }}
                  >
                    {item.label}
                  </span>
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
                          className={`w-full flex items-center gap-2 pl-10 pr-4 py-2 text-left relative
                            ${isActive ? "text-[#1a2f8a]" : "text-gray-400 hover:text-[#1a2f8a]"}`}
                          style={{ animation: (!collapsed && isHovered) ? `navSlideIn 200ms ease ${ci * 45}ms both` : "none" }}
                        >
                          {isActive && <span className="absolute left-5 top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-[#1a2f8a] rounded-full" />}
                          <span className={`text-xs whitespace-nowrap ${isActive ? "font-black" : "font-medium"}`}>
                            {child.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
              <div className="w-7 h-7 bg-[#1a2f8a] rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                {user?.username?.[0]?.toUpperCase() || "U"}
              </div>
              <p className="text-xs font-semibold text-gray-700 truncate">{user?.username}</p>
            </div>
          </div>
     <div className="flex gap-1">
  <button
    onClick={onRefresh}
    className="flex-1 flex items-center justify-center py-1.5 text-gray-400 hover:text-[#1a2f8a] hover:bg-gray-50 rounded-xl transition-colors"
  >
    <RefreshCw size={14} />
  </button>
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
                className={`flex items-center gap-2 px-3 py-2 w-full text-left whitespace-nowrap rounded-lg transition-colors
                  ${isActive ? "text-[#1a2f8a]" : "text-gray-500 hover:text-[#1a2f8a] hover:bg-blue-50/50"}`}
                style={{ animation: `navSlideIn 180ms ease ${ci * 40}ms both` }}
              >
                {isActive && <span className="w-0.5 h-3 bg-[#1a2f8a] rounded-full flex-shrink-0" />}
                <span className={`text-xs ${isActive ? "font-black" : "font-medium"}`}>{child.label}</span>
              </button>
              
            );
          })}
        </div>
      )}
    </>
  );
}