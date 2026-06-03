import { useEffect, useRef } from "react";
import { useT } from "./layout/SettingsContext.jsx";

export default function InactivityWarning({ secondsLeft, onStay, onLogout }) {
  const t = useT();
  const barRef = useRef(null);

  useEffect(() => {
    if (barRef.current) {
      barRef.current.style.width = `${(secondsLeft / 30) * 100}%`;
    }
  }, [secondsLeft]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      style={{ background: "rgba(15,23,42,0.6)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="relative bg-white rounded-3xl overflow-hidden flex flex-col"
        style={{
          width: 380,
          boxShadow: "0 32px 80px -12px rgba(26,47,138,0.35)",
          animation: "warnPop 320ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <style>{`
          @keyframes warnPop {
            from { opacity: 0; transform: scale(0.88) translateY(12px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100 w-full">
          <div
            ref={barRef}
            className="h-full transition-all duration-1000 linear"
            style={{
              width: "100%",
              background: secondsLeft > 10
                ? "linear-gradient(90deg, #1a2f8a, #3b54b8)"
                : "linear-gradient(90deg, #dc2626, #ef4444)",
            }}
          />
        </div>

        <div className="px-8 pt-7 pb-8 flex flex-col items-center text-center gap-5">
          {/* Icon */}
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>

          {/* Text */}
          <div>
<p className="text-xl font-black text-gray-900 mb-1">
              {t("session_warning_title")}
            </p>
            <p className="text-sm text-gray-500 leading-relaxed">
              {t("session_warning_desc")}
            </p>
          </div>

          {/* Countdown */}
          <div
            className="text-5xl font-black tabular-nums"
            style={{ color: secondsLeft > 10 ? "#1a2f8a" : "#dc2626" }}
          >
            {secondsLeft}s
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2 w-full">
<button
              onClick={onStay}
              className="w-full py-3 rounded-2xl text-white text-sm font-black transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #1a2f8a 0%, #3b54b8 100%)",
                boxShadow: "0 6px 20px -4px rgba(26,47,138,0.45)",
              }}
            >
              {t("session_warning_stay")}
            </button>
            <button
              onClick={onLogout}
              className="w-full py-2.5 rounded-2xl text-sm font-black text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all"
            >
              {t("session_warning_logout")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}