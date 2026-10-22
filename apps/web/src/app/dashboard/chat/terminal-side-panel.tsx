"use client";

import { useState } from "react";
import { TradingViewChart } from "../../../components/trading-view-chart";
import { formatCryptoPrice } from "../../../lib/format";

interface TradeTarget {
  target_index: number;
  price: number;
  share_pct: number;
  status: string;
}

interface ActiveTradeInfo {
  id: string;
  symbol: string;
  side: "long" | "short";
  status: string;
  entry_avg: number | null;
  qty: number | null;
  leverage: number | null;
  sl: number | null;
  realized_pnl: number | null;
}

interface TerminalSidePanelProps {
  activeTrade: ActiveTradeInfo | null;
  currentMark: number;
  activeTradeTargets: TradeTarget[];
  unrealizedPnl: number;
  unrealizedRoiPct: number;
  closeTradeAction: (formData: FormData) => Promise<void>;
  closeAllAction: (formData: FormData) => Promise<void>;
  defaultSymbol?: string;
}

export function TerminalSidePanel({
  activeTrade,
  currentMark,
  activeTradeTargets,
  unrealizedPnl,
  unrealizedRoiPct,
  closeTradeAction,
  closeAllAction,
  defaultSymbol = "BTCUSDT"
}: TerminalSidePanelProps) {
  const [viewMode, setViewMode] = useState<"position" | "chart">(activeTrade ? "position" : "chart");
  const chartSymbol = activeTrade?.symbol ?? defaultSymbol;

  return (
    <aside className="panel active-trade" style={{ display: "flex", flexDirection: "column" }}>
      {/* Panel Top Tabs */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px", borderBottom: "1px solid var(--line)", paddingBottom: "8px" }}>
        <button
          type="button"
          onClick={() => setViewMode("position")}
          className={`channel-tab ${viewMode === "position" ? "active" : ""}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: "11px", justifyContent: "center" }}
        >
          <span>⚡ Позиція</span>
          {activeTrade ? <span className="ai-score-badge" style={{ padding: "1px 5px", fontSize: "10px" }}>Active</span> : null}
        </button>
        <button
          type="button"
          onClick={() => setViewMode("chart")}
          className={`channel-tab ${viewMode === "chart" ? "active" : ""}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: "11px", justifyContent: "center" }}
        >
          <span>📈 Графік OKX</span>
          <span className="memory-badge" style={{ padding: "1px 5px", fontSize: "10px" }}>{chartSymbol}</span>
        </button>
      </div>

      {viewMode === "chart" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "14px", color: "var(--text-main)" }}>{chartSymbol}</strong>
            <span className="badge demo" style={{ fontSize: "10px" }}>Bybit Linear · 15m</span>
          </div>
          <div style={{ flex: 1, minHeight: "360px" }}>
            <TradingViewChart symbol={chartSymbol} height="360px" interval="15" />
          </div>
        </div>
      ) : activeTrade ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div className="active-title">
            <div>
              <strong>{activeTrade.symbol}</strong>
              <span className={`badge ${activeTrade.side}`}>{activeTrade.side} {activeTrade.leverage ?? 1}x</span>
            </div>
            <span className="badge demo">{activeTrade.status}</span>
          </div>
          <div className={`pnl mono ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
            {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
            <small style={{ fontSize: "12px", marginLeft: "6px" }}>
              ({unrealizedRoiPct >= 0 ? "+" : ""}{unrealizedRoiPct.toFixed(2)}% ROI)
            </small>
          </div>
          <span className="kicker">Position Levels</span>
          <div className="level">
            <span className="demo-text">Mark Price</span>
            <span className="mono">{currentMark > 0 ? formatCryptoPrice(currentMark) : "—"}</span>
          </div>
          <div className="level">
            <span className="demo-text">Entry Avg</span>
            <span className="mono">{activeTrade.entry_avg ? formatCryptoPrice(Number(activeTrade.entry_avg)) : "—"}</span>
          </div>
          <div className="level">
            <span>Quantity</span>
            <span className="mono">{activeTrade.qty ?? "—"}</span>
          </div>
          <div className="level">
            <span className="negative">Stop Loss</span>
            <span className="mono">{activeTrade.sl ? formatCryptoPrice(Number(activeTrade.sl)) : "—"}</span>
          </div>

          {activeTradeTargets.length > 0 ? (
            <div style={{ marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
              <span className="kicker">Take Profit Targets</span>
              {activeTradeTargets.map((t) => (
                <div className="level" key={t.target_index}>
                  <span style={{ color: t.status === "filled" ? "var(--aqua)" : "var(--muted)" }}>
                    TP{t.target_index} ({t.share_pct}%) {t.status === "filled" ? "✓ Filled" : "Open"}
                  </span>
                  <span className="mono">{t.price ? formatCryptoPrice(Number(t.price)) : "—"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <span className="kicker">Active trade</span>
          <h2>Немає відкритої позиції</h2>
          <p>Оберіть сигнал ліворуч та натисніть «Увійти в угоду», щоб відкрити позицію на біржі або Paper.</p>
          <button
            type="button"
            className="button secondary"
            style={{ marginTop: "10px", fontSize: "12px", alignSelf: "center" }}
            onClick={() => setViewMode("chart")}
          >
            📈 Переглянути графік ринку
          </button>
        </div>
      )}

      {/* Trade Controls (Close buttons) */}
      <div className="trade-controls" style={{ marginTop: "auto", paddingTop: "12px" }}>
        <form action={closeTradeAction} style={{ flex: 1 }}>
          <input type="hidden" name="tradeId" value={activeTrade?.id ?? ""} />
          <input type="hidden" name="percentage" value="50" />
          <button className="button secondary" style={{ width: "100%", fontSize: "12px", padding: "0 8px" }} disabled={!activeTrade} type="submit">
            Close 50%
          </button>
        </form>
        <form action={closeTradeAction} style={{ flex: 1 }}>
          <input type="hidden" name="tradeId" value={activeTrade?.id ?? ""} />
          <input type="hidden" name="percentage" value="100" />
          <button className="button secondary" style={{ width: "100%", fontSize: "12px", padding: "0 8px" }} disabled={!activeTrade} type="submit">
            Market Close
          </button>
        </form>
        <form action={closeAllAction} style={{ flex: 1 }}>
          <button className="button danger" style={{ width: "100%", fontSize: "12px", padding: "0 8px" }} disabled={!activeTrade} type="submit">
            Close all
          </button>
        </form>
      </div>
    </aside>
  );
}
