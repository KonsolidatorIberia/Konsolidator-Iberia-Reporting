import { useState } from "react";
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

  const content = typeof children === "function"
    ? children(activePage, setActivePage)
    : children;

  return (
    <div className="h-screen overflow-hidden bg-[#f8f9ff] flex items-center">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        user={user}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
        height="95.5vh"
        onRefresh={onRefresh}
      />
      <div className="flex-1 overflow-y-auto" style={{ height: "100vh" }}>
        <main className="px-4 py-8 h-full">
          {activePage === "user"
            ? <UserPage user={user} onLogout={onLogout} />
            : content
          }
        </main>
      </div>
    </div>
  );
}