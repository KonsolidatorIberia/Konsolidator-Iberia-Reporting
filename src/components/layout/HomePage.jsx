import { useState, useEffect } from "react";
import {
  Database, Network, Building2, Layers3,
  ArrowLeft, Loader2, AlertCircle, CheckCircle2,
  ChevronRight, Hash, TrendingUp, RefreshCw,
} from "lucide-react";

const BASE_URL = "";

const CARDS = [
  {
    key: "sources",
    label: "Sources",
    description: "Data source connections",
    endpoint: "/v2/sources",
    icon: Database,
    accent: "#1a2f8a",
    lightBg: "#eef1fb",
    stat: "Live feeds",
  },
  {
    key: "structures",
    label: "Perimeters",
    description: "Group consolidation structures",
    endpoint: "/v2/structures",
    icon: Network,
    accent: "#e8394a",
    lightBg: "#fdeef0",
    stat: "Defined scopes",
  },
  {
    key: "companies",
    label: "Companies",
    description: "Entities within the group",
    endpoint: "/v2/companies",
    icon: Building2,
    accent: "#0e7c5b",
    lightBg: "#e6f5f0",
    stat: "Group entities",
  },
  {
    key: "dimensions",
    label: "Dimensions",
    description: "Analytical axes & groupings",
    endpoint: "/v2/dimensions",
    icon: Layers3,
    accent: "#7c3aed",
    lightBg: "#f0ebff",
    stat: "By dimension group",
  },
];

/* ─── helpers ─── */

function formatColumnLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

function formatCellValue(val) {
  if (val === null || val === undefined)
    return <span className="text-gray-300 italic text-xs">—</span>;
  if (typeof val === "boolean")
    return val
      ? <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-xs"><CheckCircle2 size={12} /> Yes</span>
      : <span className="text-gray-400 text-xs">No</span>;
  if (typeof val === "number")
    return <span className="font-mono text-xs">{val}</span>;
  return <span className="text-xs">{String(val)}</span>;
}

/* ─── Dimensions grouped table ─── */

function DimensionsTable({ data }) {
  const groups = data.reduce((acc, row) => {
    const g = row.dimensionGroup || "Ungrouped";
    if (!acc[g]) acc[g] = [];
    acc[g].push(row);
    return acc;
  }, {});

  const groupNames = Object.keys(groups).sort();

  return (
    <div className="space-y-5">
      {groupNames.map((group) => {
        const rows = groups[group];
        const cols = Object.keys(rows[0]);
        return (
          <div key={group} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#7c3aed]/10 flex items-center gap-2" style={{ background: "#f0ebff" }}>
              <div className="w-2 h-2 rounded-full bg-[#7c3aed]" />
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#7c3aed" }}>{group}</span>
              <span className="ml-auto text-xs text-gray-400">{rows.length} dimension{rows.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    {cols.map((col) => (
                      <th key={col} className="text-left px-5 py-3 text-xs font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">
                        {formatColumnLabel(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors ${i % 2 !== 0 ? "bg-gray-50/30" : ""}`}>
                      {cols.map((col, j) => (
                        <td key={j} className="px-5 py-3 text-gray-700">{formatCellValue(row[col])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Generic flat table ─── */

function FlatTable({ data, accent }) {
  if (!data.length) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
      <p className="text-gray-300 text-sm">No data available</p>
    </div>
  );

  const cols = Object.keys(data[0]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100" style={{ background: `${accent}10` }}>
              <th className="text-left px-5 py-3.5 text-xs font-black text-gray-400 uppercase tracking-widest w-10">#</th>
              {cols.map((col) => (
                <th key={col} className="text-left px-5 py-3.5 text-xs font-black uppercase tracking-widest whitespace-nowrap" style={{ color: accent }}>
                  {formatColumnLabel(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors ${i % 2 !== 0 ? "bg-gray-50/30" : ""}`}>
                <td className="px-5 py-3 text-gray-300 text-xs font-mono">{i + 1}</td>
                {cols.map((col, j) => (
                  <td key={j} className="px-5 py-3 text-gray-700">{formatCellValue(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Detail view — uses already-fetched data, no extra fetch ─── */

function DetailView({ card, data, onBack }) {
  const Icon = card.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-[#1a2f8a] transition-colors group"
        >
          <div className="w-8 h-8 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center group-hover:border-[#1a2f8a]/20 transition-colors">
            <ArrowLeft size={14} />
          </div>
          Back
        </button>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center shadow-sm" style={{ background: card.lightBg }}>
            <Icon size={16} style={{ color: card.accent }} />
          </div>
          <div>
            <h2 className="text-lg font-black text-[#1a2f8a]">{card.label}</h2>
            <p className="text-xs text-gray-400">{card.description}</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background: card.lightBg, color: card.accent }}>
          <Hash size={11} />
          {data.length} {data.length === 1 ? "entry" : "entries"}
        </div>
      </div>

      {data.length > 0 && (
        card.key === "dimensions"
          ? <DimensionsTable data={data} />
          : <FlatTable data={data} accent={card.accent} />
      )}

      {data.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-300 text-sm">No entries found</p>
        </div>
      )}
    </div>
  );
}

/* ─── Single card on home ─── */

function DataCard({ card, data, loading, error, onClick }) {
  const Icon = card.icon;
  const count = data?.length ?? null;

  return (
    <button
      onClick={onClick}
      className="group text-left bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 p-6 flex flex-col gap-5 hover:-translate-y-1 relative overflow-hidden w-full"
    >
      <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: card.lightBg }} />

      <div className="flex items-start justify-between relative z-10">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm transition-transform duration-300 group-hover:scale-110"
          style={{ background: card.lightBg }}>
          <Icon size={22} style={{ color: card.accent }} />
        </div>
        <div className="w-7 h-7 rounded-xl bg-gray-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:bg-gray-100">
          <ChevronRight size={13} className="text-gray-400" />
        </div>
      </div>

      <div className="relative z-10">
        <p className="text-xl font-black text-[#1a2f8a] mb-0.5">{card.label}</p>
        <p className="text-xs text-gray-400 leading-relaxed">{card.description}</p>
      </div>

      <div className="relative z-10 flex items-end justify-between">
        <div>
          {loading
            ? <div className="w-10 h-7 bg-gray-100 rounded-lg animate-pulse" />
            : error
              ? <p className="text-3xl font-black text-gray-200">!</p>
              : count !== null
                ? <p className="text-3xl font-black" style={{ color: card.accent }}>{count}</p>
                : <p className="text-3xl font-black text-gray-200">—</p>
          }
          <p className="text-xs text-gray-400 mt-0.5">{card.stat}</p>
        </div>
        <div className="px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background: card.lightBg, color: card.accent }}>
          View all →
        </div>
      </div>
    </button>
  );
}

/* ─── HomePage — fetches all data once, shares with cards and detail view ─── */

export default function HomePage({ token, onDataLoaded }) {
  const [cardData, setCardData] = useState({});   // { key: [] }
  const [loading, setLoading]   = useState(true);
  const [errors, setErrors]     = useState({});   // { key: message }
  const [activeCard, setActiveCard] = useState(null);

const fetchAll = async () => {
  setLoading(true);
  setErrors({});
  const results = {};
  const errs = {};

  await Promise.all(
    CARDS.map(async (card) => {
      try {
        const res = await fetch(`${BASE_URL}${card.endpoint}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Cache-Control": "no-cache, no-store",
            Pragma: "no-cache",
          },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        results[card.key] = json.value ?? (Array.isArray(json) ? json : [json]);
      } catch (e) {
        errs[card.key] = e.message;
        results[card.key] = [];
      }
    })
  );

  setCardData(results);
  setErrors(errs);

  if (onDataLoaded) {

    onDataLoaded(results);
  }

  setLoading(false);
};

  useEffect(() => { fetchAll(); }, [token]);

  if (!token) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle size={28} className="text-red-300" />
          <p className="text-sm font-bold text-gray-400">No auth token — please log in again.</p>
        </div>
      </div>
    );
  }

  if (activeCard) {
    return (
      <DetailView
        card={activeCard}
        data={cardData[activeCard.key] ?? []}
        onBack={() => setActiveCard(null)}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
          </div>
          <h1 className="text-3xl font-black text-[#1a2f8a]">Data Explorer</h1>
          <p className="text-sm text-gray-400 mt-1">Select a category to browse all entries and fields.</p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-100 shadow-sm text-xs font-bold text-gray-400 hover:text-[#1a2f8a] hover:border-[#1a2f8a]/20 transition-all disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {CARDS.map((card) => (
          <DataCard
            key={card.key}
            card={card}
            data={cardData[card.key]}
            loading={loading}
            error={errors[card.key]}
            onClick={() => !loading && setActiveCard(card)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-300">
        <TrendingUp size={12} />
        <span>All data fetched in a single pass on load. Click Refresh to reload.</span>
      </div>
    </div>
  );
}