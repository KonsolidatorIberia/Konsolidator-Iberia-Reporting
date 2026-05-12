import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { t as tFn } from "../../lib/i18n";
import { supabase } from "../../lib/supabaseClient";
import { getUserSettings, saveUserSettings } from "../../lib/settingsApi";

// Default styles for the whole app. Defined here (NOT in SettingsPage) so this
// file has no import dependency on SettingsPage — otherwise the two files would
// import each other and the bundler would fail to resolve `useSettingsControls`.
export const DEFAULT_SETTINGS = {
  typography: {
    header1:      { font: "Inter, sans-serif", size: 29, weight: 900, color: "#1A2F8A" },
    header2:      { font: "Inter, sans-serif", size: 12, weight: 800, color: "#ffffff" },
    header3:      { font: "Inter, sans-serif", size: 12, weight: 700, color: "#FFFFFF" },
    body1:        { font: "Inter, sans-serif", size: 12, weight: 600, color: "#2F3138" },
    body2:        { font: "Inter, sans-serif", size: 11, weight: 400, color: "#5b5d62" },
    subbody1:     { font: "Inter, sans-serif", size: 10, weight: 400, color: "#9CA3AF" },
    subbody2:     { font: "Inter, sans-serif", size: 10, weight: 400, color: "#9CA3AF" },
    underscore1:  { font: "Inter, sans-serif", size: 12, weight: 700, color: "#ffffff" },
    underscore2:  { font: "Inter, sans-serif", size: 10, weight: 600, color: "#ffffff" },
    underscore3:  { font: "Inter, sans-serif", size: 10, weight: 600, color: "#9CA3AF" },
    headerNum:    { font: '"JetBrains Mono", "Courier New", monospace', size: 22, weight: 800, color: "#1A2F8A" },
    bodyNum1:     { font: '"JetBrains Mono", "Courier New", monospace', size: 13, weight: 600, color: "#1A2F8A" },
    bodyNum2:     { font: '"JetBrains Mono", "Courier New", monospace', size: 12, weight: 500, color: "#2F3138" },
    bodyNum3:     { font: '"JetBrains Mono", "Courier New", monospace', size: 11, weight: 400, color: "#6B7280" },
    underNum:     { font: '"JetBrains Mono", "Courier New", monospace', size: 10, weight: 500, color: "#9CA3AF" },
    filter:       { font: "Inter, sans-serif", size: 12, weight: 600, color: "#1A2F8A" },
  },
colors: {
    primary:     "#1A2F8A",
    secondary:   "#CF305D",
    tertiary:    "#57AA78",
    quaternary:  "#ffffff",
  },
  locale: "auto",  // "auto" | "en" | "da" | "es"
};

const SettingsContext = createContext(null);

function mergeWithDefaults(row) {
  if (!row) return DEFAULT_SETTINGS;
  return {
    typography: { ...DEFAULT_SETTINGS.typography, ...(row.typography ?? {}) },
    colors:     { ...DEFAULT_SETTINGS.colors,     ...(row.colors     ?? {}) },
    locale:     row.locale ?? DEFAULT_SETTINGS.locale,
  };
}

export function SettingsProvider({ children }) {
const [settings, setSettings]           = useState(DEFAULT_SETTINGS);
  const [userId, setUserId]               = useState(null);
  const [loading, setLoading]             = useState(true);
  const [detectedLocale, setDetectedLocale] = useState(null); // set by EpicLoader
  const lastFetchedUserRef = useRef(null);

  // Track auth — initial session + auth-state changes (login / logout / refresh)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setUserId(session?.user?.id ?? null);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  // Fetch the user's settings from Supabase whenever the user changes
useEffect(() => {
    let cancelled = false;
    setDetectedLocale(null); // reset on every user change so the new user's standard is detected fresh
    if (!userId) {
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      lastFetchedUserRef.current = null;
      return;
    }
    setLoading(true);
    lastFetchedUserRef.current = userId;
    getUserSettings(userId)
      .then(row => {
        if (cancelled || lastFetchedUserRef.current !== userId) return;
        setSettings(mergeWithDefaults(row));
      })
      .catch(() => { if (!cancelled) setSettings(DEFAULT_SETTINGS); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  // Apply settings as CSS variables on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-primary",    settings.colors.primary);
    root.style.setProperty("--color-secondary",  settings.colors.secondary);
    root.style.setProperty("--color-tertiary",   settings.colors.tertiary);
    root.style.setProperty("--color-quaternary", settings.colors.quaternary ?? "#F59E0B");

    Object.entries(settings.typography).forEach(([key, s]) => {
      root.style.setProperty(`--font-${key}-family`, s.font);
      root.style.setProperty(`--font-${key}-size`,   `${s.size}px`);
      root.style.setProperty(`--font-${key}-weight`, String(s.weight));
      root.style.setProperty(`--font-${key}-color`,  s.color);
    });
  }, [settings]);

const saveSettings = useCallback(async (newSettings) => {
    if (!userId) throw new Error("You must be signed in to save settings.");
    const saved = await saveUserSettings({
      userId,
      typography: newSettings.typography,
      colors:     newSettings.colors,
      locale:     newSettings.locale ?? "auto",
    });
    setSettings(mergeWithDefaults(saved));
    return saved;
  }, [userId]);

const resetSettings = useCallback(async () => {
    if (!userId) { setSettings(DEFAULT_SETTINGS); return; }
    const saved = await saveUserSettings({
      userId,
      typography: DEFAULT_SETTINGS.typography,
      colors:     DEFAULT_SETTINGS.colors,
      locale:     DEFAULT_SETTINGS.locale,
    });
    setSettings(mergeWithDefaults(saved));
    return saved;
  }, [userId]);

return (
    <SettingsContext.Provider value={{ settings, saveSettings, resetSettings, loading, userId, detectedLocale, setDetectedLocale }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  return ctx?.settings ?? DEFAULT_SETTINGS;
}

/**
 * Returns the effective locale string ("en" | "da" | "es").
 * Priority: explicit user setting → accounting-standard auto-detection
 * → browser language → "en".
 */
export function useLocale() {
  const ctx = useContext(SettingsContext);
  const explicit = ctx?.settings?.locale;
  if (explicit && explicit !== "auto") return explicit;
  // Set by EpicLoader after detecting the accounting standard
  if (ctx?.detectedLocale) return ctx.detectedLocale;
  // Safe default while EpicLoader is still running
  return "en";
}

/** Returns a translation function bound to the current locale. */
export function useT() {
  const locale = useLocale();
  return (key, fallback) => tFn(locale, key, fallback);
}

export function useSettingsControls() {
  const ctx = useContext(SettingsContext);
  return ctx ?? {
    settings:            DEFAULT_SETTINGS,
    saveSettings:        async () => { throw new Error("SettingsProvider not mounted"); },
    resetSettings:       async () => { throw new Error("SettingsProvider not mounted"); },
    loading:             false,
    userId:              null,
    detectedLocale:      null,
    setDetectedLocale:   () => {},
  };
}

export function useTypo(key) {
  const { typography } = useSettings();
  const s = typography[key];
  if (!s) return {};
  return {
    fontFamily: s.font,
    fontSize:   s.size,
    fontWeight: s.weight,
    color:      s.color,
  };
}