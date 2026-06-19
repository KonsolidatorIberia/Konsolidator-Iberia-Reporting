import { useState, useRef, useEffect } from "react";
import {
  Home, Network, FileText, Layers, SlidersHorizontal,
  PieChart, Table, BookOpen, TrendingUp, BarChart3,
 Eye, Filter, Settings, Database, Library,
} from "lucide-react";
import { useTypo, useSettings, useT } from "./SettingsContext";
import { useCurrentUserPermissions } from "../../lib/userPermissionsApi";

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
      { key: "consolidated-dimensiones", labelKey: "nav_dimensions",    icon: Filter     },
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
{
    key: "views", labelKey: "nav_views", icon: Eye,
    children: [
      { key: "mappings", labelKey: "nav_mappings", icon: Library },
    ],
  },
  {
    key: "data-explorer", labelKey: "nav_data_explorer", icon: Database,
    children: [
      { key: "structure", labelKey: "nav_structure", icon: Network },
    ],
  },
];


const W_OPEN     = "clamp(190px, 11vw, 230px)";
const W_CLOSED   = "clamp(84px,  5vw, 84px)";
const TRANSITION = "350ms cubic-bezier(0.25,0.1,0.25,1)";

export default function Sidebar({ activePage, onNavigate, user, height = "100vh" }) {
  const { colors } = useSettings();
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const t = useT();
  const { can, loaded: permsLoaded } = useCurrentUserPermissions();

  // Filter NAV based on permissions: drop children with allowed=false,
  // drop parents whose all children are hidden (unless the parent itself is a leaf with its own key).
  const NAV = NAV_KEYS
    .map(item => {
      const label = t(item.labelKey, item.labelKey);
      if (!item.children?.length) {
        return can(item.key) ? { ...item, label } : null;
      }
      const visibleChildren = item.children
        .filter(c => can(c.key))
        .map(c => ({ ...c, label: t(c.labelKey, c.labelKey) }));
      if (visibleChildren.length === 0) return null;
      return { ...item, label, children: visibleChildren };
    })
    .filter(Boolean);

  const canSettings = can("settings-personalization") || can("settings-security");

  const [hovered, setHovered]       = useState(false);
  const [hoveredKey, setHoveredKey] = useState(null);
  const rowRefs    = useRef({});
  const closeTimer = useRef(null);

  const isOpen = hovered;

  const activeParent = NAV.find(n =>
    n.key === activePage || n.children?.some(c => c.key === activePage)
  )?.key;

  const handleNavMouseEnter = (key, hasChildren) => {
    if (!hasChildren) { setHoveredKey(null); return; }
    setHoveredKey(key);
  };

const handleNavigate = (key) => {
    // Block disallowed pages. "user" is the avatar-click target, always allowed.
    if (key !== "user") {
      if (key === "settings") {
        if (!canSettings) return;
      } else if (!can(key)) {
        return;
      }
    }
    const go = () => {
      onNavigate?.(key);
      setHoveredKey(null);
      setHovered(false);
    };
    if (typeof window.__navGuard === "function") {
      window.__navGuard(go);
    } else {
      go();
    }
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
        style={{ width: isOpen ? W_OPEN : W_CLOSED, height, transition: `width ${TRANSITION}` }}
        onMouseEnter={() => { clearTimeout(closeTimer.current); setHovered(true); }}
        onMouseLeave={() => {
          closeTimer.current = setTimeout(() => {
            setHovered(false);
            setHoveredKey(null);
          }, 120);
        }}
      >

        {/* ── Logo ── */}
        <div
          className="bg-white rounded-2xl shadow-xl border border-gray-100 flex items-center justify-center overflow-hidden relative"
          style={{ height: "7vh" }}
        >
          <img src="/logo-full.png" alt="Konsolidator" className="absolute object-contain h-6"
            style={{ opacity: isOpen ? 1 : 0, transition: `opacity ${TRANSITION}`, pointerEvents: "none" }} />
          <img src="/logo-icon.png" alt="K" className="absolute object-contain h-8 w-8"
            style={{ opacity: isOpen ? 0 : 1, transition: `opacity ${TRANSITION}`, pointerEvents: "none" }} />
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
                ref={el => { rowRefs.current[item.key] = el; }}
                className="relative"
                onMouseEnter={() => { clearTimeout(closeTimer.current); handleNavMouseEnter(item.key, hasChildren); }}
                onMouseLeave={() => { closeTimer.current = setTimeout(() => setHoveredKey(null), 150); }}
              >
                <button
                  onClick={() => !hasChildren ? handleNavigate(item.key) : undefined}
                  onMouseEnter={(e) => { if (!isActiveParent) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                  onMouseLeave={(e) => { if (!isActiveParent) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body1Style?.color ?? "#2f3138"; } }}
className="w-full flex items-center py-2.5 transition-all duration-200"
                  style={{
                    justifyContent: isOpen ? "flex-start" : "center",
                    paddingLeft: isOpen ? "1.25rem" : 0,
                    paddingRight: isOpen ? "1rem" : 0,
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
maxWidth:   isOpen ? 140 : 0,
                      opacity:    isOpen ? 1 : 0,
                      marginLeft: isOpen ? "0.75rem" : 0,
                      transition: `max-width ${TRANSITION}, opacity ${TRANSITION}`,
                    }}
                  >
                    {item.label}
                  </span>
                  {isActiveParent && isOpen && (
                    <span className="ml-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.primary }} />
                  )}
                </button>

                {/* Inline submenu */}
                {hasChildren && (
                  <div className="overflow-hidden" style={{
                    maxHeight:  (isOpen && isHovered) ? `${item.children.length * 36}px` : 0,
                    opacity:    (isOpen && isHovered) ? 1 : 0,
                    transition: `max-height 300ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease`,
                  }}>
                    {item.children.map((child, ci) => {
                      const isActive = activePage === child.key;
                      return (
                        <button
                          key={child.key}
                          onClick={() => handleNavigate(child.key)}
                          onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                          onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body2Style?.color ?? "#9ca3af"; } }}
                          className="w-full flex items-center gap-2 pl-10 pr-4 py-2 text-left transition-all duration-200"
                          style={{
                            color: isActive ? colors.primary : (body2Style?.color ?? "#9ca3af"),
                            animation: (isOpen && isHovered) ? `navSlideIn 200ms ease ${ci * 45}ms both` : "none",
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
          {canSettings && (
          <div className="mt-auto pt-2 border-t border-gray-100">
            {(() => {
              const isActive = activePage === "settings";
              return (
                <button
                  onClick={() => handleNavigate("settings")}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = `${colors.primary}10`; e.currentTarget.style.color = colors.primary; } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = body1Style?.color ?? "#2f3138"; } }}
className="w-full flex items-center py-2.5 transition-all duration-200"
                  style={{
                    justifyContent: isOpen ? "flex-start" : "center",
                    paddingLeft: isOpen ? "1.25rem" : 0,
                    paddingRight: isOpen ? "1rem" : 0,
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
                      maxWidth:   isOpen ? 140 : 0,
                      opacity:    isOpen ? 1 : 0,
                      marginLeft: "0.75rem",
                      transition: `max-width ${TRANSITION}, opacity ${TRANSITION}`,
                    }}
                  >
                    {t("nav_settings")}
                  </span>
                  {isActive && isOpen && (
                    <span className="ml-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.primary }} />
                  )}
</button>
              );
            })()}
          </div>
          )}
        </div>

        {/* ── User ── */}
<div
          className="bg-white rounded-2xl shadow-xl border border-gray-100 p-3 overflow-hidden flex items-center justify-center"
          style={{ minHeight: "6vh" }}
          onClick={() => handleNavigate("user")}
        >
<div className="flex items-center cursor-pointer w-full" style={{ justifyContent: isOpen ? "flex-start" : "center" }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0"
              style={{ backgroundColor: colors.primary }}
            >
              {user?.username?.[0]?.toUpperCase() || "U"}
            </div>
            <p
              className="text-xs font-semibold text-gray-700 truncate overflow-hidden whitespace-nowrap"
              style={{
                maxWidth:   isOpen ? 140 : 0,
                opacity:    isOpen ? 1 : 0,
                marginLeft: isOpen ? 8 : 0,
                transition: `max-width ${TRANSITION}, opacity ${TRANSITION}, margin-left ${TRANSITION}`,
              }}
            >
              {user?.username ?? user?.email?.split("@")[0] ?? "—"}
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}