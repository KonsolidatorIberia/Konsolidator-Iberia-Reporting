/* Enciende el tracker de uso mientras la app está abierta y le pasa la
   página activa. Se monta una vez dentro de la Shell (ver app/App.jsx). */
import { useEffect } from "react";
import { startUsageTracking, stopUsageTracking, trackPage } from "./usageTracker.js";

export default function UsageBeacon({ page }) {
  useEffect(() => {
    startUsageTracking();
    return () => { stopUsageTracking(); };
  }, []);
  useEffect(() => { if (page) trackPage(page); }, [page]);
  return null;
}