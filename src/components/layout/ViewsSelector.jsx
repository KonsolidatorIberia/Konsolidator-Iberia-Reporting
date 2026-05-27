import React, { useState, useEffect, useMemo } from "react";
import {
  X, Search, Layers, Library, Clock, FileText, CheckCircle2, Trash2,
} from "lucide-react";
import { useSettings } from "./SettingsContext.jsx";
import PageHeader from "./PageHeader.jsx";
import { listMappings, getActiveCompanyId } from "../../lib/mappingsApi.js";
import { supabase } from "../../lib/supabaseClient.js";

// ─── Constants ────────────────────────────────────────────────
const STANDARD_META = {
  PGC:        { label: "PGC",          accent: "#1a2f8a", accentBg: "#eef1fb" },
  SpanishIFRS:{ label: "Spanish IFRS", accent: "#dc7533", accentBg: "#fef3c7" },
  DanishIFRS: { label: "Danish IFRS",  accent: "#57aa78", accentBg: "#dcfce7" },
  Scratch:    { label: "Custom",        accent: "#1a2f8a", accentBg: "#eef1fb" },
};

// ─── Main export ──────────────────────────────────────────────
// Props:
//   open          boolean
//   onClose       () => void
//   activeMapping object | null   — the currently active mapping
//   onApply       (mapping) => void
//   onClear       () => void
export default function ViewsSelector({ open, onClose, activeMapping, onApply, onClear }) {
  const { colors } = useSettings();
  const [selected, setSelected] = useState(null); // null | "structure" | "report"
  const [search, setSearch]     = useState("");

  // Reset to landing whenever panel opens
  useEffect(() => { if (open) { setSelected(null); setSearch(""); } }, [open]);

  if (!open) return null;

  if (selected === "structure") {
    return (
      <LibraryView
        kind="structure"
        search={search}
        setSearch={setSearch}
        activeMapping={activeMapping}
        onApply={m => { onApply(m); onClose(); }}
        onClear={() => { onClear(); onClose(); }}
        onBack={() => { setSelected(null); setSearch(""); }}
        colors={colors}
      />
    );
  }

  if (selected === "report") {
    return (
      <LibraryView
        kind="report"
        search={search}
        setSearch={setSearch}
        activeMapping={activeMapping}
        onApply={m => { onApply(m); onClose(); }}
        onClear={() => { onClear(); onClose(); }}
        onBack={() => { setSelected(null); setSearch(""); }}
        colors={colors}
      />
    );
  }

  // ── Landing ─────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#f8f9ff]">
      <style>{`
        @keyframes floatOrb1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.1)}}
        @keyframes floatOrb2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-15px,20px) scale(.95)}}
        @keyframes floatOrb3{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(25px,15px) scale(1.05)}}
        @keyframes spinSlow{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes spinSlowR{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
        @keyframes dashMove{from{stroke-dashoffset:200}to{stroke-dashoffset:0}}
        @keyframes pulseDot{0%,100%{opacity:.3;transform:scale(1)}50%{opacity:.8;transform:scale(1.4)}}
      `}</style>
      <PageHeader
        kicker="Views"
        title="Mappings"
        tabs={[]} activeTab={null} onTabChange={() => {}} filters={[]}
        onBack={onClose}
      />
      <div className="flex-1 flex px-0 pt-3 pb-0 min-h-0">
        <div className="w-full h-full px-4 pb-4">
          <div className="grid grid-cols-2 gap-5 h-full">

            {/* Structure Mappings card — exact copy from MappingsPage */}
            <button onClick={() => setSelected("structure")}
              className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#1a2f8a] flex flex-col h-full"
              style={{ background: "linear-gradient(135deg,#ffffff 0%,#f4f6ff 40%,#eef1fb 100%)", boxShadow: "0 8px 32px -8px rgba(26,47,138,0.18),0 2px 8px -2px rgba(0,0,0,0.06)" }}>
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute" style={{top:"15%",right:"10%",width:180,height:180,borderRadius:"50%",background:"radial-gradient(circle,#1a2f8a18 0%,transparent 70%)",animation:"floatOrb1 8s ease-in-out infinite"}}/>
                <div className="absolute" style={{bottom:"10%",right:"25%",width:120,height:120,borderRadius:"50%",background:"radial-gradient(circle,#3b54b820 0%,transparent 70%)",animation:"floatOrb2 11s ease-in-out 2s infinite"}}/>
                <div className="absolute" style={{top:"50%",left:"60%",width:80,height:80,borderRadius:"50%",background:"radial-gradient(circle,#1a2f8a12 0%,transparent 70%)",animation:"floatOrb3 9s ease-in-out 1s infinite"}}/>
                <svg className="absolute" style={{top:"8%",right:"8%",width:200,height:200,opacity:0.07}}>
                  <circle cx="100" cy="100" r="80" fill="none" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="8 6" style={{animation:"spinSlow 30s linear infinite",transformOrigin:"100px 100px"}}/>
                  <circle cx="100" cy="100" r="55" fill="none" stroke="#1a2f8a" strokeWidth="0.8" strokeDasharray="4 8" style={{animation:"spinSlowR 20s linear infinite",transformOrigin:"100px 100px"}}/>
                </svg>
                <div className="absolute inset-0" style={{backgroundImage:"radial-gradient(#1a2f8a0d 1px,transparent 1px)",backgroundSize:"28px 28px"}}/>
                <svg className="absolute inset-0 w-full h-full" style={{opacity:0.08}}>
                  <line x1="70%" y1="20%" x2="85%" y2="50%" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="6 4" style={{animation:"dashMove 4s linear infinite"}}/>
                  <line x1="75%" y1="70%" x2="90%" y2="40%" stroke="#1a2f8a" strokeWidth="1" strokeDasharray="6 4" style={{animation:"dashMove 5s linear infinite 1s"}}/>
                  <circle cx="70%" cy="20%" r="3" fill="#1a2f8a" style={{animation:"pulseDot 3s ease-in-out infinite"}}/>
                  <circle cx="85%" cy="50%" r="3" fill="#1a2f8a" style={{animation:"pulseDot 3s ease-in-out 1s infinite"}}/>
                  <circle cx="90%" cy="40%" r="3" fill="#1a2f8a" style={{animation:"pulseDot 3s ease-in-out 0.5s infinite"}}/>
                </svg>
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{background:"linear-gradient(135deg,#eef1fb 0%,#ffffff 50%,#dde3f8 100%)"}}/>
              <div className="relative z-10 flex flex-col h-full p-10">
                <div className="mb-auto">
                  <div className="mb-8 relative w-20 h-20">
                    <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{background:"#1a2f8a",filter:"blur(12px)",transform:"translateY(4px)"}}/>
                    <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{background:"linear-gradient(145deg,#1a2f8a 0%,#3b54b8 100%)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.2)"}}>
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                        <rect x="4" y="8" width="10" height="10" rx="2" fill="white" opacity="0.9"/><rect x="4" y="22" width="10" height="6" rx="1.5" fill="white" opacity="0.5"/><rect x="17" y="8" width="15" height="4" rx="1.5" fill="white" opacity="0.7"/><rect x="17" y="15" width="10" height="4" rx="1.5" fill="white" opacity="0.5"/><rect x="17" y="22" width="12" height="4" rx="1.5" fill="white" opacity="0.4"/>
                      </svg>
                    </div>
                  </div>
                  <p className="font-black text-2xl text-gray-800 mb-3">Structure Mappings</p>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs">Map your chart of accounts to standard structures like PGC, Spanish IFRS, or Danish IFRS. Control how accounts are grouped and labeled across all reports.</p>
                </div>
                <div className="mt-10 flex items-center justify-between">
                  <div className="flex gap-2">{["PGC","Spanish IFRS","Danish IFRS"].map(tag=><span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{background:"#1a2f8a15",color:"#1a2f8a"}}>{tag}</span>)}</div>
                  <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{color:"#1a2f8a"}}>Open →</span>
                </div>
              </div>
            </button>

            {/* Report Mappings card — exact copy from MappingsPage */}
            <button onClick={() => setSelected("report")}
              className="relative text-left rounded-2xl border-2 border-gray-100 overflow-hidden transition-all group hover:border-[#CF305D] flex flex-col h-full"
              style={{ background: "linear-gradient(135deg,#ffffff 0%,#fff4f7 40%,#fef1f5 100%)", boxShadow: "0 8px 32px -8px rgba(207,48,93,0.18),0 2px 8px -2px rgba(0,0,0,0.06)" }}>
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute" style={{top:"15%",right:"10%",width:180,height:180,borderRadius:"50%",background:"radial-gradient(circle,#CF305D18 0%,transparent 70%)",animation:"floatOrb2 9s ease-in-out infinite"}}/>
                <div className="absolute" style={{bottom:"10%",right:"25%",width:120,height:120,borderRadius:"50%",background:"radial-gradient(circle,#e0558520 0%,transparent 70%)",animation:"floatOrb1 12s ease-in-out 1s infinite"}}/>
                <div className="absolute" style={{top:"50%",left:"60%",width:80,height:80,borderRadius:"50%",background:"radial-gradient(circle,#CF305D10 0%,transparent 70%)",animation:"floatOrb3 10s ease-in-out 3s infinite"}}/>
                <svg className="absolute" style={{top:"8%",right:"8%",width:200,height:200,opacity:0.07}}>
                  <circle cx="100" cy="100" r="80" fill="none" stroke="#CF305D" strokeWidth="1" strokeDasharray="8 6" style={{animation:"spinSlowR 25s linear infinite",transformOrigin:"100px 100px"}}/>
                  <circle cx="100" cy="100" r="55" fill="none" stroke="#CF305D" strokeWidth="0.8" strokeDasharray="4 8" style={{animation:"spinSlow 18s linear infinite",transformOrigin:"100px 100px"}}/>
                </svg>
                <div className="absolute inset-0" style={{backgroundImage:"radial-gradient(#CF305D0d 1px,transparent 1px)",backgroundSize:"28px 28px"}}/>
                <svg className="absolute inset-0 w-full h-full" style={{opacity:0.08}}>
                  <line x1="65%" y1="25%" x2="82%" y2="55%" stroke="#CF305D" strokeWidth="1" strokeDasharray="6 4" style={{animation:"dashMove 5s linear infinite"}}/>
                  <line x1="78%" y1="65%" x2="88%" y2="35%" stroke="#CF305D" strokeWidth="1" strokeDasharray="6 4" style={{animation:"dashMove 4s linear infinite 2s"}}/>
                  <circle cx="65%" cy="25%" r="3" fill="#CF305D" style={{animation:"pulseDot 3.5s ease-in-out infinite"}}/>
                  <circle cx="82%" cy="55%" r="3" fill="#CF305D" style={{animation:"pulseDot 3.5s ease-in-out 1.2s infinite"}}/>
                  <circle cx="88%" cy="35%" r="3" fill="#CF305D" style={{animation:"pulseDot 3.5s ease-in-out 0.6s infinite"}}/>
                </svg>
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{background:"linear-gradient(135deg,#fef1f5 0%,#ffffff 50%,#fde0ea 100%)"}}/>
              <div className="relative z-10 flex flex-col h-full p-10">
                <div className="mb-auto">
                  <div className="mb-8 relative w-20 h-20">
                    <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{background:"#CF305D",filter:"blur(12px)",transform:"translateY(4px)"}}/>
                    <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-105" style={{background:"linear-gradient(145deg,#CF305D 0%,#e05585 100%)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.2)"}}>
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                        <rect x="4" y="5" width="28" height="5" rx="2" fill="white" opacity="0.9"/><rect x="4" y="13" width="28" height="3.5" rx="1.5" fill="white" opacity="0.6"/><rect x="4" y="19.5" width="20" height="3.5" rx="1.5" fill="white" opacity="0.5"/><rect x="4" y="26" width="14" height="3.5" rx="1.5" fill="white" opacity="0.4"/><circle cx="29" cy="27" r="5" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5"/><path d="M27 25.5l2 1.5 3-3" stroke="rgba(255,255,255,0.9)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <p className="font-black text-2xl text-gray-800 mb-3">Report Mappings</p>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs">Define custom report templates and layouts. Control which sections, KPIs, and account groups appear in your financial reports.</p>
                </div>
                <div className="mt-10 flex items-center justify-between">
                  <div className="flex gap-2">{["PGC","Spanish IFRS","Danish IFRS"].map(tag=><span key={tag} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider" style={{background:"#CF305D15",color:"#CF305D"}}>{tag}</span>)}</div>
                  <span className="text-sm font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-2" style={{color:"#CF305D"}}>Open →</span>
                </div>
              </div>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LibraryView ──────────────────────────────────────────────
function LibraryView({ kind, search, setSearch, activeMapping, onApply, onClear, onBack, colors }) {
  const [mappings, setMappings]     = useState([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const cid = await getActiveCompanyId(uid);
        if (!cid) return;
        const rows = await listMappings({ companyId: cid });
        setMappings(Array.isArray(rows) ? rows : []);
      } catch { setMappings([]); }
      finally { setLoading(false); }
    })();
  }, [kind]);

  const kindLabel = kind === "report" ? "Report Mappings" : "Structure Mappings";

  const filtered = search.trim()
    ? mappings.filter(m => String(m.name ?? "").toLowerCase().includes(search.toLowerCase()))
    : mappings;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#f8f9ff]">
      <PageHeader
        kicker={`Views · Mappings`}
        title={kindLabel}
        tabs={[]} activeTab={null} onTabChange={() => {}} filters={[]}
        onBack={onBack}
        headerSearch={{ value: search, onChange: setSearch, placeholder: "Search mappings…" }}
        headerActions={activeMapping ? [{ label: "Clear active", onClick: onClear, danger: true }] : undefined}
      />

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col mt-3 mx-4 mb-4 rounded-2xl bg-white shadow-xl border border-gray-100">
        {search && filtered.length !== mappings.length && (
          <div className="flex items-center gap-3 p-4 pb-0">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-600">
              {filtered.length} of {mappings.length} matching
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-[#1a2f8a]/20 border-t-[#1a2f8a] rounded-full animate-spin"/>
            <p className="text-xs text-gray-400">Loading mappings…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-[#f8f9ff] to-white m-4 rounded-2xl border border-gray-100">
            <div className="w-16 h-16 bg-[#eef1fb] rounded-2xl flex items-center justify-center mx-auto mb-5">
              <Library size={28} className="text-[#1a2f8a]"/>
            </div>
            <p className="text-gray-700 font-black text-base mb-2">
              {search.trim() ? "No mappings match your search" : "No mappings yet"}
            </p>
            <p className="text-gray-400 text-xs max-w-sm mx-auto leading-relaxed text-center">
              {search.trim() ? "Try a different search term." : "Create one from the Mappings page in the sidebar."}
            </p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(m => (
                <MappingCard
                  key={m.mapping_id}
                  mapping={m}
                  isActive={activeMapping?.mapping_id === m.mapping_id}
                  onApply={() => onApply(m)}
                  onClear={onClear}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MappingCard ──────────────────────────────────────────────
function MappingCard({ mapping, isActive, onApply, onClear }) {
  const standardMeta = STANDARD_META[mapping.standard];
  return (
    <div className="bg-white rounded-2xl border-2 p-5 hover:shadow-lg transition-all group flex flex-col"
      style={{ borderColor: isActive ? "#1a2f8a" : "#f3f4f6", background: isActive ? "#1a2f8a06" : "white" }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: isActive ? "#1a2f8a" : (standardMeta?.accentBg ?? "#eef1fb") }}>
          <FileText size={16} style={{ color: isActive ? "white" : (standardMeta?.accent ?? "#1a2f8a") }}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-black text-sm text-gray-800 truncate">{mapping.name ?? "Untitled"}</p>
            {isActive && (
              <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0 text-white" style={{ background: "#1a2f8a" }}>
                Active
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5"
            style={{ color: standardMeta?.accent ?? "#1a2f8a" }}>
            {standardMeta?.label ?? mapping.standard}
          </p>
        </div>
      </div>

      {mapping.description && (
        <p className="text-[11px] text-gray-500 mb-3 line-clamp-2">{mapping.description}</p>
      )}

      <div className="flex flex-col gap-1 pt-3 border-t border-gray-50 mt-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <Clock size={11} className="text-gray-300 flex-shrink-0"/>
            <span className="truncate">
              Updated {new Date(mapping.updated_at).toLocaleDateString()}
              {mapping.updated_by_name ? ` · ${mapping.updated_by_name}` : ""}
            </span>
          </div>
          {isActive ? (
            <button onClick={onClear}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all hover:scale-105"
              style={{ background: "#fee2e2", color: "#dc2626" }}>
              <X size={9}/> Clear
            </button>
          ) : (
            <button onClick={onApply}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-white transition-all hover:scale-105"
              style={{ background: "#22c55e", boxShadow: "0 2px 8px -2px rgba(34,197,94,0.5)" }}>
              <CheckCircle2 size={9}/> Apply
            </button>
          )}
        </div>
        {mapping.created_by_name && mapping.created_by_name !== mapping.updated_by_name && (
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="w-2.5 flex-shrink-0"/>
            <span className="truncate">Created by {mapping.created_by_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}