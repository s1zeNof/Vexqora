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
      padding: "8px 12px",
      background: "#111111",
      border: "1px solid #262626",
      borderRadius: "8px",
      fontSize: "12px",
      color: "#9A9A9A",
      marginBottom: "8px"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "4px", background: "#42F5B9", display: "inline-block" }} />
        <span>24/7 Universe Scanner: <strong style={{ color: "#FFFFFF" }}>916 Bybit pairs</strong> (Updated {secondsAgo}s ago)</span>
      </div>
      <button
        type="button"
        onClick={() => {
          router.refresh();
          setLastRefreshed(Date.now());
        }}
        className="bt"
        style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}
      >
        Refresh
      </button>
    </div>
  );
}

