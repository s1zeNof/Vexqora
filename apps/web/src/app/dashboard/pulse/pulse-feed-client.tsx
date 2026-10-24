"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatPrice } from "../../../lib/format";
import { formatTimeAgo } from "../../../lib/date";

export interface PulseSignalItem {
  id: string;
  symbol: string;
  exchange: "bybit" | "binance";
  market: "linear";
  side: "long" | "short";
  trigger: string;
  triggerType: "spike" | "volume" | "breakout" | "rejection" | "whale" | "sweep";
  microstructureTag?: string | undefined;
  entry: number;
  stopLoss: number;
  tp1: number;
  rr: number;
  confidence: number;
  createdAt: string;
  age: string;
  status: "active" | "expired" | "taken";
}

export function PulseFeedClient({ initialSignals }: { initialSignals: PulseSignalItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "long" | "short" | "whale" | "sweep" | "spike" | "volume">("all");
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"newest" | "confidence" | "rr">("newest");
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const [, setTick] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastRefreshed) / 1000));
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [lastRefreshed]);

  // Periodic soft refresh of scanner feed every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
      setLastRefreshed(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, [router]);

  let filtered = initialSignals.filter((s) => {
    if (filter === "long" && s.side !== "long") return false;
    if (filter === "short" && s.side !== "short") return false;
    if (filter === "whale" && s.triggerType !== "whale") return false;
    if (filter === "sweep" && s.triggerType !== "sweep") return false;
    if (filter === "spike" && s.triggerType !== "spike") return false;
    if (filter === "volume" && s.triggerType !== "volume") return false;
    if (minConfidence > 0 && s.confidence < minConfidence) return false;
    return true;
  });

  if (sortBy === "confidence") {
    filtered = [...filtered].sort((a, b) => b.confidence - a.confidence);
  } else if (sortBy === "rr") {
    filtered = [...filtered].sort((a, b) => b.rr - a.rr);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Status Bar */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <h1 style={{ margin: 0, font: "700 28px Inter, sans-serif" }}>Pulse</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", font: "500 13px Inter, sans-serif", color: "#9A9A9A" }}>
            <i style={{ width: "8px", height: "8px", borderRadius: "4px", background: "#42F5B9", display: "inline-block" }} />
            916 pairs · Bybit linear · updated {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
          </div>
          <button
            type="button"
            onClick={() => {
              router.refresh();
              setLastRefreshed(Date.now());
            }}
            className="bt sm"
            style={{ padding: "4px 8px", fontSize: "12px", color: "#A59CC4" }}
            title="Оновити зараз"
          >
            ↻ Оновити
          </button>
        </div>
      </div>

      {/* Filter Tabs & Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`tab ${filter === "all" ? "on" : ""}`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFilter("whale")}
          className={`tab ${filter === "whale" ? "on" : ""}`}
        >
          🐋 Whale
        </button>
        <button
          type="button"
          onClick={() => setFilter("sweep")}
          className={`tab ${filter === "sweep" ? "on" : ""}`}
        >
          🎯 Sweep
        </button>
        <button
          type="button"
          onClick={() => setFilter("long")}
          className={`tab ${filter === "long" ? "on" : ""}`}
        >
          Long
        </button>
        <button
          type="button"
          onClick={() => setFilter("short")}
          className={`tab ${filter === "short" ? "on" : ""}`}
        >
          Short
        </button>
        <button
          type="button"
          onClick={() => setFilter("volume")}
          className={`tab ${filter === "volume" ? "on" : ""}`}
        >
          Volume
        </button>
        <button
          type="button"
          onClick={() => setFilter("spike")}
          className={`tab ${filter === "spike" ? "on" : ""}`}
        >
          Spike
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setMinConfidence((prev) => (prev === 60 ? 0 : 60))}
            className="bt"
            style={{
              background: minConfidence >= 60 ? "#1A1A1A" : "transparent",
              color: minConfidence >= 60 ? "#42F5B9" : "#FFFFFF"
            }}
          >
            Confidence ≥ 60%
          </button>
          <button
            type="button"
            onClick={() => {
              if (sortBy === "newest") setSortBy("confidence");
              else if (sortBy === "confidence") setSortBy("rr");
              else setSortBy("newest");
            }}
            className="bt"
          >
            {sortBy === "newest" ? "Newest" : sortBy === "confidence" ? "Top Confidence" : "Highest R:R"}
          </button>
        </div>
      </div>

      {/* 3-Column Card Grid */}
      {filtered.length === 0 ? (
        <div className="cd" style={{ padding: "40px 20px", textAlign: "center", color: "#9A9A9A" }}>
          No signals match the selected filters.
        </div>
      ) : (
        <div className="pulse-grid">
          {filtered.map((item) => (
            <div key={item.id} className="cd" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Row 1: Symbol, Tag, Age */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <b style={{ font: "700 18px Inter, sans-serif", color: "#FFFFFF" }}>{item.symbol}</b>
                <span className={`tg ${item.side === "long" ? "lg" : "sh"}`}>
                  {item.side.toUpperCase()}
                </span>
                <span className="lb" style={{ marginLeft: "auto" }}>
                  {item.createdAt ? formatTimeAgo(item.createdAt) : item.age}
                </span>
              </div>

              {/* Row 2: Trigger & Microstructure Badge */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ font: "500 14px Inter, sans-serif", color: "#9A9A9A" }}>
                  {item.trigger}
                </div>
                {item.microstructureTag && (
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    fontFamily: "JetBrains Mono, monospace",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: "rgba(66, 245, 185, 0.08)",
                    border: "1px solid rgba(66, 245, 185, 0.25)",
                    color: "#42F5B9",
                    width: "fit-content"
                  }}>
                    {item.microstructureTag}
                  </div>
                )}
              </div>

              {/* Row 3: Entry, Stop loss, TP1, R:R */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.2fr .8fr", gap: "8px" }}>
                <div>
                  <div className="lb">Entry</div>
                  <div className="v">{formatPrice(item.entry)}</div>
                </div>
                <div>
                  <div className="lb">Stop loss</div>
                  <div className="v" style={{ color: "#FF5A6E" }}>{formatPrice(item.stopLoss)}</div>
                </div>
                <div>
                  <div className="lb">TP1</div>
                  <div className="v" style={{ color: "#42F5B9" }}>{formatPrice(item.tp1)}</div>
                </div>
                <div>
                  <div className="lb">R:R</div>
                  <div className="v">1:{item.rr.toFixed(1)}</div>
                </div>
              </div>

              {/* Row 4: Confidence */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="lb">Confidence</span>
                <span className="v" style={{ margin: 0 }}>{item.confidence}%</span>
                <div style={{ flex: 1, height: "4px", borderRadius: "2px", background: "#262626" }}>
                  <div
                    style={{
                      width: `${item.confidence}%`,
                      height: "4px",
                      borderRadius: "2px",
                      background: "#42F5B9"
                    }}
                  />
                </div>
              </div>

              {/* Row 5: Action buttons */}
              <div style={{ display: "flex", gap: "8px" }}>
                <Link
                  href={`/dashboard/signal/${item.id}`}
                  className="bt"
                  style={{ flex: 1, textAlign: "center" }}
                >
                  Open
                </Link>
                <Link
                  href={`/dashboard/signal/${item.id}?trade=1`}
                  className="bt pr"
                  style={{ flex: 1, textAlign: "center" }}
                >
                  Trade
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
