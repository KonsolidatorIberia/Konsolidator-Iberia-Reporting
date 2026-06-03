import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const SUPABASE_URL    = "https://gmcawsapzkzmgrtiqebv.supabase.co/rest/v1";
const SUPABASE_APIKEY = "sb_publishable_ijxYPrnd3VplVOFEDv_W8g_3GckzIVA";

export const TOTAL_MS         = 60 * 5 * 1000; // 5 min inactivity
export const WARNING_MS       = 30 * 1000;      // 30s warning before logout
export const HEARTBEAT_MS     = 30 * 1000;      // heartbeat interval
export const SESSION_STALE_MS = 2 * 60 * 1000;  // session considered stale after 2 min

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];

/** keepalive fetch — works even during page unload */
export function clearSessionKeepAlive(email, sessionId) {
  if (!email || !sessionId) return;
  fetch(`${SUPABASE_URL}/rpc/clear_user_session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_APIKEY,
      Authorization: `Bearer ${SUPABASE_APIKEY}`,
    },
    body: JSON.stringify({ p_email: email, p_session_id: sessionId }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * useSessionGuard
 *
 * - Auto-logs out after TOTAL_MS of inactivity, with a 30s warning
 * - Heartbeats Supabase every 30s to keep last_seen fresh
 * - Clears the session on page refresh / tab close / browser close
 *
 * Returns { showWarning, secondsLeft, stayActive, logout }
 */
export function useSessionGuard({ email, sessionId, onLogout, enabled = true }) {
  const [showWarning, setShowWarning]   = useState(false);
  const [secondsLeft, setSecondsLeft]   = useState(30);

  // Single ref bag — avoids stale closures in timers and event listeners
  const r = useRef({
    email, sessionId, onLogout,
    isWarning: false,
    warnTimer: null, logoutTimer: null,
    heartbeat: null, countdown: null,
  });
// Sync latest prop values into ref after render, never during
  useEffect(() => {
    r.current.email     = email;
    r.current.sessionId = sessionId;
    r.current.onLogout  = onLogout;
  });

  // ── Core: perform the actual logout ────────────────────────────────
  const performLogout = useCallback((reason = "inactivity") => {
    clearTimeout(r.current.warnTimer);
    clearTimeout(r.current.logoutTimer);
    clearInterval(r.current.heartbeat);
    clearInterval(r.current.countdown);
    r.current.isWarning = false;
    setShowWarning(false);
    clearSessionKeepAlive(r.current.email, r.current.sessionId);
    r.current.onLogout?.(reason);
  }, []);

  // ── Core: begin the 30s countdown warning ──────────────────────────
  const startWarning = useCallback(() => {
    r.current.isWarning = true;
    setShowWarning(true);
    setSecondsLeft(30);
    r.current.countdown = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(r.current.countdown); return 0; }
        return s - 1;
      });
    }, 1000);
    r.current.logoutTimer = setTimeout(() => performLogout("inactivity"), WARNING_MS);
  }, [performLogout]);

  // ── Core: reset the inactivity timer on user activity ─────────────
  const resetTimer = useCallback(() => {
    if (r.current.isWarning) return;
    clearTimeout(r.current.warnTimer);
    r.current.warnTimer = setTimeout(startWarning, TOTAL_MS - WARNING_MS);
  }, [startWarning]);

  // ── Public: "Stay logged in" button ───────────────────────────────
  const stayActive = useCallback(() => {
    clearTimeout(r.current.logoutTimer);
    clearInterval(r.current.countdown);
    r.current.isWarning = false;
    setShowWarning(false);
    clearTimeout(r.current.warnTimer);
    r.current.warnTimer = setTimeout(startWarning, TOTAL_MS - WARNING_MS);
  }, [startWarning]);

  // ── Public: manual logout (e.g. logout button) ────────────────────
  const logout = useCallback(() => performLogout("manual"), [performLogout]);

  // ── Effect: wire up everything ────────────────────────────────────
useEffect(() => {
    if (!enabled || !email || !sessionId) return;

    const ref = r.current;

    resetTimer();

    ACTIVITY_EVENTS.forEach(e =>
      window.addEventListener(e, resetTimer, { passive: true })
    );

    ref.heartbeat = setInterval(() => {
      if (!ref.email || !ref.sessionId) return;
(async () => {
        try {
          await supabase
            .from("user_sessions")
            .update({ last_seen: new Date().toISOString() })
            .eq("email", r.current.email)
            .eq("session_id", r.current.sessionId);
        } catch { /* non-critical */ }
      })();
    }, HEARTBEAT_MS);

const onUnload = () =>
      clearSessionKeepAlive(ref.email, ref.sessionId);
    window.addEventListener("beforeunload", onUnload);

    return () => {
      const { warnTimer, logoutTimer, heartbeat, countdown } = ref;
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      clearInterval(heartbeat);
      clearInterval(countdown);
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, resetTimer));
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [enabled, email, sessionId, resetTimer]);

  return { showWarning, secondsLeft, stayActive, logout };
}