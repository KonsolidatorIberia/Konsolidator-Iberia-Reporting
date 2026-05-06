import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { loadSavedSettings, DEFAULT_SETTINGS } from "./SettingsPage.jsx";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => loadSavedSettings());

  // Refresh when Settings page saves (same tab) or another tab saves
  useEffect(() => {
    const refresh = () => setSettings(loadSavedSettings());
    window.addEventListener("storage", refresh);
    window.addEventListener("konsolidator-settings-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("konsolidator-settings-changed", refresh);
    };
  }, []);

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

  const refresh = useCallback(() => setSettings(loadSavedSettings()), []);

  return (
    <SettingsContext.Provider value={{ settings, refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  return ctx?.settings ?? DEFAULT_SETTINGS;
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