"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveUniversePoller() {
  const router = useRouter();
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastRefreshed) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastRefreshed]);

  // Periodic soft refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
      setLastRefreshed(Date.now());
    }, 60000);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "6px 12px",
      background: "#0c0919",
      border: "1px solid var(--line)",
      borderRadius: "8px",
      fontSize: "11px",
      color: "var(--muted)",
      marginBottom: "8px"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span className="status-dot" style={{ background: "var(--aqua)", boxShadow: "0 0 6px var(--aqua)" }} />
        <span>24/7 Universe Scanner: <strong>916 Bybit пар у моніторингу</strong> (Оновлено: {secondsAgo}с тому)</span>
      </div>
      <button
        type="button"
        onClick={() => {
          router.refresh();
          setLastRefreshed(Date.now());
        }}
        className="button secondary"
        style={{ minHeight: "24px", padding: "0 8px", fontSize: "11px" }}
      >
        🔄 Оновити стрічку
      </button>
    </div>
  );
}
