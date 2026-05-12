import React, { useState, useRef, useCallback } from "react";
import { Loader2, X } from "lucide-react";

function fmtBig(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function MarkdownLine({ line, colors }) {
  // Bold section headers: **Text**
  if (/^\*\*.*\*\*$/.test(line.trim())) {
    return (
      <p className="text-xs font-black mt-4 mb-1 uppercase tracking-wider"
        style={{ color: colors.primary }}>
        {line.replace(/\*\*/g, "")}
      </p>
    );
  }
  // Numbered list items: 1. Text
  if (/^\d+\./.test(line.trim())) {
    return (
      <p className="text-xs font-black text-gray-700 mt-3 mb-1">
        {line.replace(/\*\*(.*?)\*\*/g, "$1")}
      </p>
    );
  }
  // Bullet items
  if (line.startsWith("- ") || line.startsWith("• ")) {
    return (
      <p className="text-xs text-gray-600 pl-3 mb-1 flex gap-2"
        style={{ borderLeft: `2px solid ${colors.primary}40` }}>
        <span className="text-gray-400 flex-shrink-0">·</span>
        {line.slice(2).replace(/\*\*(.*?)\*\*/g, "$1")}
      </p>
    );
  }
  // Inline bold within a line
  if (line.includes("**")) {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <p className="text-xs text-gray-600 leading-relaxed mb-1">
        {parts.map((part, i) =>
          i % 2 === 1
            ? <strong key={i} className="font-bold text-gray-800">{part}</strong>
            : part
        )}
      </p>
    );
  }
  // Empty line
  if (!line.trim()) return <div className="h-2" />;
  // Normal paragraph
  return <p className="text-xs text-gray-600 leading-relaxed mb-1">{line}</p>;
}

export default function AiPanel({
  open,
  onClose,
  colors,
  // Context props from HomePage
  periodLabel,
  companyName,
  detectedStandard,
  reportingCurrency,
  viewScope,
  company,
  slottedKpis,
  kpiValues,
  costBreakdown,
  activeViewLabel,
  topByRevenue,
  trendSeries,
}) {
  const [stream, setStream] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const runAnalysis = useCallback(async () => {
    if (loading) return;
    setStream("");
    setLoading(true);

    // Build KPI summary
    const kpiLines = slottedKpis?.map((kpi, i) => {
      const vals = kpiValues?.[i];
      if (!kpi || !vals) return null;
      const curr = vals.current ?? 0;
      const prev = vals.prev ?? 0;
      const chg = prev !== 0 ? (((curr - prev) / Math.abs(prev)) * 100).toFixed(1) : null;
      return `- ${kpi.label}: ${fmtBig(curr)}${chg ? ` (${Number(chg) > 0 ? "+" : ""}${chg}% vs prev month)` : ""}`;
    }).filter(Boolean).join("\n") ?? "No KPI data available";

    // Build cost/revenue breakdown summary
    const breakdownLines = costBreakdown.slice(0, 6).map(c =>
      `- ${c.name}: ${fmtBig(Math.abs(c.value))}${c.change != null ? ` (${c.change > 0 ? "+" : ""}${c.change.toFixed(1)}%)` : ""}`
    ).join("\n") || "No breakdown data available";

    // Build ranking summary
    const rankLines = topByRevenue.slice(0, 5).map((r, i) =>
      `${i + 1}. ${r.name}: ${fmtBig(r.value)} ${reportingCurrency}`
    ).join("\n") || "No ranking data";

    // Build trend summary (last 3 months)
    const last3 = trendSeries.slice(-3).map(t =>
      `${t.fullLabel}: Revenue ${fmtBig(t.slot0 ?? 0)}`
    ).join(", ") || "No trend data";

    const prompt = `You are a senior CFO analyst assistant embedded in a financial dashboard. Analyze the following live financial data and provide a clear, insightful narrative finance summary. Be direct, use concrete numbers, highlight what's notable, flag any concerns, and suggest specific things to investigate.

COMPANY CONTEXT:
- Company: ${companyName ?? "Unknown"}
- Accounting Standard: ${detectedStandard ?? "Unknown"}
- Reporting Period: ${periodLabel}
- View scope: ${viewScope} (${company})
- Reporting Currency: ${reportingCurrency}

KEY KPIs (monthly vs prior month):
${kpiLines}

${activeViewLabel?.toUpperCase() ?? "BREAKDOWN"}:
${breakdownLines}

REVENUE TREND (last 3 months):
${last3}

COMPANY REVENUE RANKING (in ${reportingCurrency}):
${rankLines}

Provide your analysis in this exact structure:
**Executive Summary**
2-3 sentences covering the most important takeaway from this period.

**Performance Highlights**
What is working well — with specific numbers.

**Areas of Concern**
What needs attention — with specific numbers and % changes.

**Key Questions to Investigate**
2-3 specific, actionable questions a CFO should ask based on this data.

Keep it under 400 words. Use actual numbers from the data. Be a real analyst, not generic. Avoid filler phrases.`;

    try {
const response = await fetch("/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        setStream("Error contacting AI. Please try again.");
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      abortRef.current = reader;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
const parsed = JSON.parse(data);
const delta = parsed?.type === "content_block_delta"
  ? parsed?.delta?.text ?? ""
  : parsed?.type === "message_delta"
  ? ""
  : parsed?.delta?.text ?? "";
if (delta) setStream(s => s + delta);
          } catch {}
        }
      }
} catch (e) {
      console.error("[AiPanel] fetch error:", e);
      setStream(`Analysis failed: ${e?.message ?? "Unknown error"}. Check console for details.`);
    } finally {
      setLoading(false);
    }
  }, [
    loading, slottedKpis, kpiValues, costBreakdown, topByRevenue,
    trendSeries, reportingCurrency, companyName, detectedStandard,
    periodLabel, viewScope, company, activeViewLabel,
  ]);

  const handleClose = () => {
    if (abortRef.current) {
      try { abortRef.current.cancel(); } catch {}
      abortRef.current = null;
    }
    onClose();
  };

  return (
    <>
      {/* Sliding panel */}
      <div
        className="fixed top-0 right-0 h-full z-[600] flex flex-col bg-white border-l border-gray-100"
        style={{
          width: 420,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 420ms cubic-bezier(0.34,1.20,0.64,1)",
          boxShadow: open ? "-8px 0 40px -8px rgba(26,47,138,0.18)" : "none",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${colors.primary}08 0%, transparent 100%)` }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary ?? "#CF305D"} 100%)`,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-black text-gray-800">AI Finance Analyst</p>
              <p className="text-[9px] text-gray-400 font-medium">
                {periodLabel} · {companyName ?? company}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400"
          >
            <X size={13} />
          </button>
        </div>

        {/* Analyze button */}
        <div className="px-5 py-3 border-b border-gray-50 flex-shrink-0">
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-black text-white transition-all duration-200 flex items-center justify-center gap-2"
            style={{
              background: loading
                ? "#e5e7eb"
                : `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary ?? "#CF305D"} 100%)`,
              color: loading ? "#9ca3af" : "#fff",
              boxShadow: loading ? "none" : `0 4px 14px -4px ${colors.primary}60`,
            }}
          >
            {loading ? (
              <><Loader2 size={13} className="animate-spin" /> Analyzing…</>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                </svg>
                Analyze {periodLabel}
              </>
            )}
          </button>
          <p className="text-[9px] text-gray-300 text-center mt-1.5">
            Reads your live KPIs · {activeViewLabel} · ranking
          </p>
        </div>

        {/* Stream output */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "none" }}>
          {stream ? (
            <div>
              {stream.split("\n").map((line, i) => (
                <MarkdownLine key={i} line={line} colors={colors} />
              ))}
              {loading && (
                <span className="inline-block w-1.5 h-3 bg-gray-400 animate-pulse ml-0.5 rounded-sm" />
              )}
            </div>
          ) : !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-12">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: `${colors.primary}10` }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-black text-gray-700 mb-1">Ready to analyze</p>
                <p className="text-xs text-gray-400 max-w-[260px] leading-relaxed">
                  Click the button above to get an AI-powered narrative analysis of your {periodLabel} financials.
                </p>
              </div>
              <div
                className="w-full rounded-xl p-3 mt-2"
                style={{ background: `${colors.primary}06`, border: `1px solid ${colors.primary}12` }}
              >
                <p className="text-[9px] font-black uppercase tracking-wider mb-2" style={{ color: colors.primary }}>
                  What I'll analyze
                </p>
                {[
                  `${slottedKpis?.filter(Boolean).length ?? 0} KPIs vs prior month`,
                  `${costBreakdown?.length ?? 0} ${activeViewLabel ?? "breakdown"} items`,
                  `${topByRevenue?.length ?? 0} companies in ranking`,
                  `${trendSeries?.length ?? 0} months of trend data`,
                ].map((item, i) => (
                  <p key={i} className="text-[10px] text-gray-500 flex items-center gap-1.5 mb-0.5">
                    <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: colors.primary }} />
                    {item}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-50 flex-shrink-0">
          <p className="text-[8px] text-gray-300 text-center">
            Powered by Claude · Analysis based on displayed data only · Not financial advice
          </p>
        </div>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[599] bg-black/10 backdrop-blur-[2px]"
          onClick={handleClose}
          style={{ animation: "fadeIn 200ms ease-out both" }}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}