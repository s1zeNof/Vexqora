"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh", width: "100%", padding: "24px" }}>
      <div className="panel" style={{ maxWidth: "560px", width: "100%", padding: "32px", textAlign: "center", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
        <div style={{ fontSize: "36px" }}>⚠️</div>
        <h2 style={{ fontSize: "22px" }}>Dashboard Encountered an Issue</h2>
        <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
          {error.message || "A temporary server rendering issue occurred while loading this view."}
        </p>
        {error.digest ? (
          <span className="mono" style={{ fontSize: "11px", color: "var(--muted)", background: "var(--plum)", padding: "4px 8px", borderRadius: "4px" }}>
            Ref: {error.digest}
          </span>
        ) : null}
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <button className="button primary" onClick={() => reset()}>
            🔄 Retry
          </button>
          <Link href="/dashboard/chat" className="button secondary">
            ⚡ Go to Signals
          </Link>
          <Link href="/dashboard/accounts" className="button secondary">
            🔑 Accounts
          </Link>
        </div>
      </div>
    </div>
  );
}
