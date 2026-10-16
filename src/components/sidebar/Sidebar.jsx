import { useState, useRef, useEffect } from "react";
import {
  Home, Network, FileText, Layers,
  PieChart, Table, BookOpen, TrendingUp, BarChart3,
  Eye, Filter, Settings, Database, Library, ShieldCheck, Presentation,
} from "lucide-react";
import { useTypo, useSettings, useT } from "../layout/SettingsContext";
import { useCurrentUserPermissions } from "../../lib/userPermissionsApi";
import styles from "./Sidebar.module.css";

// Flags de visibilidad:
//  - adminOnly: solo consultores (y además debe pasar can()).
//  - devOnly:   página en desarrollo; solo consultores y fuera del sistema de
//               permisos hasta que se dé de alta (ahora no hay ninguna).
const NAV_KEYS = [
  { key: "home",      labelKey: "nav_home",         icon: Home },
  {
    key: "individual", labelKey: "nav_individual",   icon: FileText,
    children: [
      { key: "individual-data",         labelKey: "nav_data",         icon: Table      },
      { key: "individual-kpis",         labelKey: "nav_kpis",         icon: BarChart3  },
      { key: "individual-dimensiones",  labelKey: "nav_dimensions",   icon: Filter     },
      { key: "individual-cashflow",     labelKey: "nav_cashflow",     icon: TrendingUp },
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
    ],
  },
  {
    key: "views", labelKey: "nav_views", icon: Eye,
    children: [
      { key: "mappings",            labelKey: "nav_mappings",            icon: Library   },
      { key: "statistical-parties", labelKey: "nav_statistical_parties", icon: BarChart3 },
    ],
  },
  // Presentaciones: PowerPoint y Notas de la memoria (las notas, antes en
  // Individual y Consolidado, viven ahora aquí). Abierto a todos los usuarios
  // según sus permisos de páginas (Ajustes › Acceso de usuarios).
  {
    key: "presentations-group", labelKey: "nav_presentations", icon: Presentation,
    children: [
      { key: "presentations",        labelKey: "nav_pres_powerpoint", icon: Presentation },
      { key: "presentations-memory", labelKey: "nav_memory_notes",    icon: BookOpen     },
    ],
  },
  {
    key: "data-explorer", labelKey: "nav_data_explorer", icon: Database,
    children: [
      { key: "structure", labelKey: "nav_structure", icon: Network },
    ],
  },
  {
    key: "admin-onboarding", labelKey: "nav_admin_onboarding", icon: ShieldCheck,
    adminOnly: true,
  },
];

const W_OPEN     = "clamp(190px, 11vw, 230px)";
const W_CLOSED   = "clamp(84px,  5vw, 84px)";
const TRANSITION = "350ms cubic-bezier(0.25,0.1,0.25,1)";

const cx = (...c) => c.filter(Boolean).join(" ");

export default function Sidebar({ activePage, onNavigate, user, height = "100vh" }) {
  const { colors } = useSettings();
  const body1Style = useTypo("body1");
  const body2Style = useTypo("body2");
  const t = useT();
  const { can } = useCurrentUserPermissions();

  // Async consultant check — user has role='consultant' on any active
  // user_companies row. Consultants are Konsolidator staff and get access
  // to onboarding-only pages that clients (regular/admin) don't see.
  const [isConsultant, setIsConsultant] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("../../lib/supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { data } = await supabase.schema("accounts").from("user_companies")
          .select("role").eq("user_id", uid).eq("is_active", true);
        if (!cancelled) setIsConsultant((data ?? []).some(r => r.role === "consultant"));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Filter NAV based on permissions + consultant flag for onboarding entries.
  const NAV = NAV_KEYS
    .map(item => {
      if (item.adminOnly && !isConsultant) return null;
      const label = t(item.labelKey, item.labelKey);
      if (item.devOnly) {
        if (!isConsultant) return null;
        return { ...item, label, children: item.children?.map(c => ({ ...c, label: t(c.labelKey, c.labelKey) })) };
      }
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
  const btnRefs    = useRef({});
  const navBoxRef  = useRef(null);
  const closeTimer = useRef(null);
  // Sliding active-indicator geometry (measured from the active row).
  const [indicator, setIndicator] = useState({ top: 0, height: 0, visible: false });

  const isOpen = hovered;

  // Expose sidebar state on <body> so other components (large tables) can
  // apply a compensating transform during the width transition. Avoids reflow.
  useEffect(() => {
    document.body.dataset.sidebar = isOpen ? "open" : "closed";
    return () => { delete document.body.dataset.sidebar; };
  }, [isOpen]);

  const activeParent = NAV.find(n =>
    n.key === activePage || n.children?.some(c => c.key === activePage)
  )?.key;

  // Measure the active row so the sliding indicator can align to it. Re-runs
  // when the active item, the NAV list, or the open/closed width changes.
  useEffect(() => {
    const row = activeParent ? btnRefs.current[activeParent] : null;
    const box = navBoxRef.current;
    if (!row || !box) { setIndicator(i => ({ ...i, visible: false })); return; }
    const measure = () => {
      const rowRect = row.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      setIndicator({ top: rowRect.top - boxRect.top, height: rowRect.height, visible: true });
    };
    // Follow the active row in real time for ~420ms so the pill stays glued to
    // it while the submenu expands/collapses above (which shifts its position).
    let raf;
    const start = performance.now();
    const loop = (now) => {
      measure();
      if (now - start < 420) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [activeParent, isOpen, NAV.length, hoveredKey]);

  const handleNavMouseEnter = (key, hasChildren) => {
    if (!hasChildren) { setHoveredKey(null); return; }
    setHoveredKey(key);
  };

  const handleNavigate = (key) => {
    // Block disallowed pages. "user" is the avatar-click target, always allowed.
    // Admin-only and dev-only items bypass `can()` since they gate on the
    // consultant flag instead.
    const consultantKeys = new Set(NAV_KEYS.filter(n => n.adminOnly || n.devOnly)
      .flatMap(n => [n.key, ...(n.children ?? []).map(c => c.key)]));
    if (key !== "user") {
      if (key === "settings") {
        if (!canSettings) return;
      } else if (consultantKeys.has(key)) {
        if (!isConsultant) return;
      } else if (!can(key)) {
        return;
      }
    }
    const go = () => {
      // Aviso para la página: si ya estaba abierta (p. ej. dentro de una
      // memoria), vuelve a su librería.
      try { window.dispatchEvent(new CustomEvent("konsolidator:nav", { detail: key })); } catch { /* sin ventana */ }
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

  // Colores del tema expuestos como variables CSS para Sidebar.module.css
  // (hover, indicador, avatar). Los valores dinámicos por estado siguen inline.
  const cssVars = {
    "--k-primary": colors.primary,
    "--k-primary-soft": `${colors.primary}10`,
    "--k-text": body1Style?.color ?? "#2f3138",
    "--k-text-sub": body2Style?.color ?? "#9ca3af",
  };

  const labelStyle = (active, activeColor) => ({
    ...body1Style,
    color: active ? activeColor : body1Style?.color,
    maxWidth:   isOpen ? 140 : 0,
    opacity:    isOpen ? 1 : 0,
    marginLeft: isOpen ? "0.75rem" : 0,
    transition: `max-width ${TRANSITION}, opacity ${TRANSITION}`,
  });

  return (
    <aside
      className={styles.aside}
      style={{ ...cssVars, width: isOpen ? W_OPEN : W_CLOSED, height }}
      onMouseEnter={() => { clearTimeout(closeTimer.current); setHovered(true); }}
      onMouseLeave={() => {
        closeTimer.current = setTimeout(() => {
          setHovered(false);
          setHoveredKey(null);
        }, 120);
      }}
    >
      {/* ── Logo ── */}
      <div className={cx(styles.card, styles.logo)}>
        <img src="/logo-full.png" alt="Konsolidator" className={styles.logoFull}
          style={{ opacity: isOpen ? 1 : 0, transition: `opacity ${TRANSITION}` }} />
        <img src="/logo-icon.png" alt="K" className={styles.logoIcon}
          style={{ opacity: isOpen ? 0 : 1, transition: `opacity ${TRANSITION}` }} />
      </div>

      {/* ── Nav ── */}
      <div ref={navBoxRef} className={cx(styles.card, styles.nav)}>
        {/* Sliding active indicator — square when collapsed, rounded rect when open.
            Left edge is fixed so the pill only grows to the right on expand. */}
        <div
          aria-hidden
          className={styles.indicator}
          style={{
            top: indicator.top,
            width: isOpen ? "calc(100% - 20px)" : 40,
            height: indicator.height ? Math.min(indicator.height, 44) : 40,
            marginTop: indicator.height ? (indicator.height - Math.min(indicator.height, 44)) / 2 : 0,
            borderRadius: isOpen ? 14 : 12,
            opacity: indicator.visible ? 1 : 0,
            transition: `width ${TRANSITION}, border-radius ${TRANSITION}, opacity 200ms ease`,
          }}
        />

        {NAV.map((item) => {
          const isActiveParent = activeParent === item.key;
          const hasChildren    = !!item.children?.length;
          const isHovered      = hoveredKey === item.key;
          const submenuOpen    = isOpen && isHovered;

          return (
            <div
              key={item.key}
              ref={el => { rowRefs.current[item.key] = el; }}
              className={styles.row}
              onMouseEnter={() => { clearTimeout(closeTimer.current); handleNavMouseEnter(item.key, hasChildren); }}
              onMouseLeave={() => { closeTimer.current = setTimeout(() => setHoveredKey(null), 150); }}
            >
              <button
                ref={el => { btnRefs.current[item.key] = el; }}
                onClick={() => !hasChildren ? handleNavigate(item.key) : undefined}
                className={cx(styles.navBtn, isActiveParent && styles.onPill)}
              >
                <item.icon size={20} className={styles.icon} />
                <span className={styles.label} style={labelStyle(isActiveParent, "#fff")}>
                  {item.label}
                </span>
                {isActiveParent && isOpen && <span className={cx(styles.dot, styles.dotWhite)} />}
              </button>

              {/* Inline submenu */}
              {hasChildren && (
                <div className={styles.submenu} style={{
                  maxHeight: submenuOpen ? `${item.children.length * 36}px` : 0,
                  opacity:   submenuOpen ? 1 : 0,
                }}>
                  {item.children.map((child, ci) => {
                    const isActive = activePage === child.key;
                    return (
                      <button
                        key={child.key}
                        onClick={() => handleNavigate(child.key)}
                        className={cx(styles.childBtn, isActive && styles.childActive, submenuOpen && styles.childIn)}
                        style={submenuOpen ? { animationDelay: `${ci * 45}ms` } : undefined}
                      >
                        <span className={styles.childLabel}
                          style={{ ...body2Style, fontSize: 12, color: isActive ? colors.primary : body2Style?.color }}>
                          {child.label}
                        </span>
                        {isActive && <span className={cx(styles.dot, styles.dotPrimary, styles.dotChild)} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Settings — pinned to bottom */}
        {canSettings && (() => {
          const isActive = activePage === "settings";
          return (
            <div className={styles.settingsWrap}>
              <button
                onClick={() => handleNavigate("settings")}
                className={cx(styles.navBtn, isActive && styles.settingsActive)}
              >
                <Settings size={20} className={styles.icon} />
                <span className={styles.label} style={labelStyle(isActive, colors.primary)}>
                  {t("nav_settings")}
                </span>
                {isActive && isOpen && <span className={cx(styles.dot, styles.dotPrimary)} />}
              </button>
            </div>
          );
        })()}
      </div>

      {/* ── User ── */}
      <div className={cx(styles.card, styles.userCard)} onClick={() => handleNavigate("user")}>
        <div className={styles.userInner} style={{ justifyContent: isOpen ? "flex-start" : "center" }}>
          <div className={styles.avatar}>
            {user?.username?.[0]?.toUpperCase() || "U"}
          </div>
          <p
            className={styles.username}
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
  );
}