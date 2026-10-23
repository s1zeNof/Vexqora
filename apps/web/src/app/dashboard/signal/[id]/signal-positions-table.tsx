"use client";

import { useState } from "react";
import { formatPrice } from "../../../../lib/format";
import { closeTradePosition } from "../../actions";

interface TradeItem {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  sl: number | null;
  tp1: number | null;
  status: string;
}

interface SignalPositionsTableProps {
  symbol: string;
  trades: TradeItem[];
  historyTrades: TradeItem[];
}

export function SignalPositionsTable({ symbol, trades, historyTrades }: SignalPositionsTableProps) {
  const [tab, setTab] = useState<"position" | "orders" | "history">("position");

  const activePosition = trades.find((t) => t.status === "active" || t.status === "entry_open");
  const positionCount = activePosition ? 1 : 0;
  const orderCount = activePosition?.tp1 || activePosition?.sl ? 2 : 0;

  return (
    <div className="cd" style={{ padding: "8px 16px" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", padding: "8px 0", borderBottom: "1px solid #1A1A1A" }}>
        <button
          type="button"
          onClick={() => setTab("position")}
          className={`tab ${tab === "position" ? "on" : ""}`}
        >
          Position ({positionCount})
        </button>
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`tab ${tab === "orders" ? "on" : ""}`}
        >
          Open orders ({orderCount})
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`tab ${tab === "history" ? "on" : ""}`}
        >
          History
        </button>
      </div>

      {tab === "position" && (
        <>
          {!activePosition ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#9A9A9A", fontSize: "13px" }}>
              No active position for {symbol}. Use the execution panel on the right to enter.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr .6fr 1fr 1fr 1fr 1.3fr 1.2fr",
                  gap: "8px",
                  padding: "10px 0 6px"
                }}
              >
                <span className="lb">Symbol</span>
                <span className="lb">Side</span>
                <span className="lb">Entry</span>
                <span className="lb">Mark</span>
                <span className="lb">PnL</span>
                <span className="lb">SL / TP1</span>
                <span className="lb">Actions</span>
              </div>

              {/* Position Row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr .6fr 1fr 1fr 1fr 1.3fr 1.2fr",
                  gap: "8px",
                  alignItems: "center",
                  padding: "10px 0",
                  font: "600 14px Inter, sans-serif",
                  fontVariantNumeric: "tabular-nums"
                }}
              >
                <span>{activePosition.symbol} {activePosition.leverage}x</span>
                <span className={`tg ${activePosition.side === "long" ? "lg" : "sh"}`} style={{ width: "fit-content" }}>
                  {activePosition.side.toUpperCase()}
                </span>
                <span>{formatPrice(activePosition.entryPrice)}</span>
                <span>{formatPrice(activePosition.markPrice)}</span>
                <span style={{ color: activePosition.pnl >= 0 ? "#42F5B9" : "#FF5A6E" }}>
                  {activePosition.pnl >= 0 ? "+" : ""}{activePosition.pnl.toFixed(2)} USDT
                </span>
                <span style={{ color: "#9A9A9A", fontSize: "13px" }}>
                  <span style={{ color: "#FF5A6E" }}>{activePosition.sl ? formatPrice(activePosition.sl) : "—"}</span> /{" "}
                  <span style={{ color: "#42F5B9" }}>{activePosition.tp1 ? formatPrice(activePosition.tp1) : "—"}</span>
                </span>
                <span style={{ display: "flex", gap: "6px" }}>
                  <form action={closeTradePosition}>
                    <input type="hidden" name="tradeId" value={activePosition.id} />
                    <input type="hidden" name="closeFraction" value="0.5" />
                    <button type="submit" className="bt" style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}>
                      50%
                    </button>
                  </form>
                  <form action={closeTradePosition}>
                    <input type="hidden" name="tradeId" value={activePosition.id} />
                    <button type="submit" className="bt dn" style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}>
                      Close
                    </button>
                  </form>
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "orders" && (
        <div style={{ padding: "16px 0", fontSize: "13px" }}>
          {!activePosition?.sl && !activePosition?.tp1 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#9A9A9A" }}>
              No open conditional SL/TP orders on exchange.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {activePosition.sl && (
                <div className="row">
                  <span>Stop Loss Trigger ({activePosition.symbol})</span>
                  <span style={{ color: "#FF5A6E" }}>{formatPrice(activePosition.sl)} (Exchange-Hosted)</span>
                </div>
              )}
              {activePosition.tp1 && (
                <div className="row">
                  <span>Take Profit 1 Limit ({activePosition.symbol})</span>
                  <span style={{ color: "#42F5B9" }}>{formatPrice(activePosition.tp1)} (Reduce-Only)</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div style={{ padding: "12px 0" }}>
          {historyTrades.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#9A9A9A", fontSize: "13px" }}>
              No previous closed trades recorded for {symbol}.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {historyTrades.map((t) => (
                <div key={t.id} className="row" style={{ fontSize: "13px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className={`tg ${t.side === "long" ? "lg" : "sh"}`}>{t.side.toUpperCase()}</span>
                    <span>Entry: {formatPrice(t.entryPrice)}</span>
                  </div>
                  <span style={{ color: t.pnl >= 0 ? "#42F5B9" : "#FF5A6E" }}>
                    {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)} USDT
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
