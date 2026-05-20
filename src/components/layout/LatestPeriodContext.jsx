import React, { createContext, useContext, useState, useCallback } from "react";

const LatestPeriodContext = createContext(null);

export function LatestPeriodProvider({ children }) {
  // cache shape: { "source|structure|company": { year, month, foundAt } }
  const [cache, setCache] = useState({});

  const makeKey = (source, structure, company) =>
    `${source ?? "_"}|${structure ?? "_"}|${company ?? "_"}`;

  const getLatestPeriod = useCallback((source, structure, company) => {
    if (!source || !structure || !company) return null;
    const key = makeKey(source, structure, company);
    const entry = cache[key];
    if (!entry) return null;
    // 30-minute TTL — safety net if data is imported mid-session
    if (Date.now() - entry.foundAt > 30 * 60 * 1000) return null;
    return { year: entry.year, month: entry.month };
  }, [cache]);

  const setLatestPeriod = useCallback((source, structure, company, year, month) => {
    if (!source || !structure || !company || !year || !month) return;
    const key = makeKey(source, structure, company);
    setCache(prev => ({
      ...prev,
      [key]: { year: String(year), month: String(month), foundAt: Date.now() },
    }));
  }, []);

  const invalidateLatestPeriod = useCallback((source, structure, company) => {
    const key = makeKey(source, structure, company);
    setCache(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const invalidateAll = useCallback(() => setCache({}), []);

  return (
    <LatestPeriodContext.Provider value={{
      getLatestPeriod,
      setLatestPeriod,
      invalidateLatestPeriod,
      invalidateAll,
    }}>
      {children}
    </LatestPeriodContext.Provider>
  );
}

export function useLatestPeriod() {
  const ctx = useContext(LatestPeriodContext);
if (!ctx) {
    console.error("[LatestPeriodContext] useLatestPeriod called OUTSIDE provider - returning no-ops");
    return {
      getLatestPeriod: () => null,
      setLatestPeriod: () => {},
      invalidateLatestPeriod: () => {},
      invalidateAll: () => {},
    };
  }
  return ctx;
}