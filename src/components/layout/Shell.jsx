import { useState, useRef, useLayoutEffect } from "react";
import Sidebar from "./Sidebar.jsx";

function UserPage({ user, onLogout }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 w-full max-w-sm text-center space-y-6">
        <div className="w-16 h-16 bg-[#1a2f8a] rounded-full flex items-center justify-center text-white text-2xl font-black mx-auto">
          {user?.username?.[0]?.toUpperCase() || "U"}
        </div>
        <div>
          <p className="text-lg font-black text-[#1a2f8a]">{user?.username}</p>
          <p className="text-xs text-gray-400 mt-1">Konsolidator user</p>
        </div>
        <button
          onClick={onLogout}
          className="w-full bg-[#e8394a] hover:bg-[#d02e3e] text-white font-black py-3 rounded-2xl transition-all text-sm tracking-wide shadow-lg shadow-red-100"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function Shell({ user, onRefresh, onLogout, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [activePage, setActivePage] = useState("home");
  const asideWrapRef = useRef(null);
  const [geom, setGeom] = useState(null);

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = asideWrapRef.current;
      if (!wrap) return;
      const aside = wrap.querySelector("aside");
      if (!aside) return;
      const cards = aside.querySelectorAll(":scope > div");
      if (cards.length < 3) return;
      const logo = cards[0].getBoundingClientRect();
      const nav  = cards[1].getBoundingClientRect();
      const usr  = cards[2].getBoundingClientRect();
      setGeom({
        headerTop: logo.top,
        headerHeight: logo.height,
        bodyTop: nav.top,
        bodyHeight: usr.bottom - nav.top,
      });
    };
measure();
    requestAnimationFrame(() => requestAnimationFrame(measure));
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    const ro = new ResizeObserver(measure);
    if (asideWrapRef.current) ro.observe(asideWrapRef.current);
    document.querySelectorAll("aside > div").forEach(card => ro.observe(card));
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
    const t = setInterval(measure, 100);
    setTimeout(() => clearInterval(t), 4000);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("load", measure); clearInterval(t); };
  }, [collapsed]);

  const content = typeof children === "function"
    ? children(activePage, setActivePage)
    : children;

  return (
    <div className="h-screen overflow-hidden bg-[#f8f9ff] flex items-stretch relative">
      <div ref={asideWrapRef} className="contents">
<Sidebar
          activePage={activePage}
          onNavigate={setActivePage}
          user={user}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(c => !c)}
          height="100vh"
          onRefresh={onRefresh}
        />
      </div>
<div className="flex-1 relative h-full" style={{ overflow: "visible" }}>
  <div
    style={{
      position: "absolute",
      top: geom ? geom.headerTop - 12 : 12,
      height: geom ? (geom.bodyTop + geom.bodyHeight) - geom.headerTop + 24 : "calc(100% - 24px)",
      left: 0,
      right: 0,
      padding: "12px 12px 12px 0",
      overflow: "visible",
    }}
  >
    <div style={{ height: "100%", overflow: "visible", display: "flex", flexDirection: "column" }}>
      {activePage === "user"
        ? <UserPage user={user} onLogout={onLogout} />
        : content
      }
    </div>
  </div>
</div>
    </div>
  );
}