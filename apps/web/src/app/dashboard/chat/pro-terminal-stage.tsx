"use client";

import { useEffect, useState } from "react";
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

interface ProTerminalStageProps {
  activeTrade: ActiveTradeInfo | null;
  currentMark: number;
  activeTradeTargets: TradeTarget[];
  unrealizedPnl: number;
  unrealizedRoiPct: number;
  closeTradeAction: (formData: FormData) => Promise<void>;
  closeAllAction: (formData: FormData) => Promise<void>;
  defaultSymbol?: string;
  signalSymbols?: string[];
}

export function ProTerminalStage({
  activeTrade,
  currentMark,
  activeTradeTargets,
  unrealizedPnl,
  unrealizedRoiPct,
  closeTradeAction,
  closeAllAction,
  defaultSymbol = "BTCUSDT",
  signalSymbols = []
}: ProTerminalStageProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(activeTrade?.symbol ?? defaultSymbol);
  const [interval, setInterval] = useState<"1" | "5" | "15" | "60" | "240" | "D">("15");

  // If active trade changes or user selects new trade, sync chart
  useEffect(() => {
    if (activeTrade?.symbol) {
      setSelectedSymbol(activeTrade.symbol);
    }
  }, [activeTrade?.symbol]);

  // Unique list of pair switcher chips (fallback to top popular pairs)
  const availablePairs = Array.from(new Set([
    activeTrade?.symbol,
    selectedSymbol,
    ...signalSymbols,
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "SUIUSDT"
  ].filter(Boolean) as string[])).slice(0, 6);

  return (
    <div className="pro-terminal-stage">
      {/* 1. Large Pro TradingView Candlestick Chart Card (OKX Style) */}
      <div className="pro-chart-card">
        {/* Header toolbar */}
        <div className="pro-chart-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "16px", color: "var(--text-main)", letterSpacing: "-0.2px" }}>
              {selectedSymbol}
            </strong>
            <span className="badge demo" style={{ fontSize: "10px" }}>
              Bybit Linear · {interval}m
            </span>

            {/* Quick pair switcher chips */}
            <div style={{ display: "inline-flex", gap: "4px", alignItems: "center", marginLeft: "6px" }}>
              {availablePairs.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSelectedSymbol(sym)}
                  className="ai-chip"
                  style={{
                    border: selectedSymbol === sym ? "1px solid var(--aqua)" : "1px solid var(--line)",
                    background: selectedSymbol === sym ? "rgba(53, 242, 208, 0.15)" : "#171229",
                    color: selectedSymbol === sym ? "var(--aqua)" : "var(--text-main)",
                    fontWeight: selectedSymbol === sym ? "700" : "500",
                    cursor: "pointer",
                    padding: "2px 8px",
                    fontSize: "11px"
                  }}
                >
                  {sym.replace("USDT", "")}
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe selector pills */}
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {(["1", "5", "15", "60", "240", "D"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setInterval(tf)}
                style={{
                  minHeight: "26px",
                  padding: "0 8px",
                  fontSize: "11px",
                  fontWeight: interval === tf ? "700" : "500",
                  background: interval === tf ? "var(--violet)" : "#171229",
                  color: interval === tf ? "#fff" : "var(--text-dim)",
                  border: "1px solid var(--line)",
                  borderRadius: "5px",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                {tf === "60" ? "1H" : tf === "240" ? "4H" : tf === "D" ? "1D" : `${tf}m`}
              </button>
            ))}
          </div>
        </div>

        {/* Expansive 540px High Chart Body (100% Stage Width) */}
        <div className="pro-chart-body">
          <TradingViewChart symbol={selectedSymbol} height="540px" interval={interval} />
        </div>
      </div>

      {/* 2. Institutional Active Position & Risk Controls Bar (Directly below chart) */}
      <div className="pro-position-bar">
        {activeTrade ? (
          <>
            <div className="pro-pos-header">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div>
                  <strong style={{ fontSize: "16px", color: "var(--text-main)" }}>{activeTrade.symbol}</strong>
                  <span className={`badge ${activeTrade.side}`} style={{ marginLeft: "8px" }}>
                    {activeTrade.side.toUpperCase()} {activeTrade.leverage ?? 1}x
                  </span>
                </div>
                <div className={`pnl mono ${unrealizedPnl >= 0 ? "positive" : "negative"}`} style={{ fontSize: "16px", fontWeight: "700" }}>
                  {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
                  <small style={{ fontSize: "12px", marginLeft: "6px" }}>
                    ({unrealizedRoiPct >= 0 ? "+" : ""}{unrealizedRoiPct.toFixed(2)}% ROI)
                  </small>
                </div>
              </div>

              {/* Quick Close Trade Actions */}
              <div style={{ display: "flex", gap: "8px" }}>
                <form action={closeTradeAction}>
                  <input type="hidden" name="tradeId" value={activeTrade.id} />
                  <input type="hidden" name="percentage" value="50" />
                  <button className="button secondary" style={{ fontSize: "11px", minHeight: "30px", padding: "0 10px" }} type="submit">
                    Close 50%
                  </button>
                </form>
                <form action={closeTradeAction}>
                  <input type="hidden" name="tradeId" value={activeTrade.id} />
                  <input type="hidden" name="percentage" value="100" />
                  <button className="button secondary" style={{ fontSize: "11px", minHeight: "30px", padding: "0 10px" }} type="submit">
                    Market Close
                  </button>
                </form>
                <form action={closeAllAction}>
                  <button className="button danger" style={{ fontSize: "11px", minHeight: "30px", padding: "0 10px" }} type="submit">
                    Close all
                  </button>
                </form>
              </div>
            </div>

            {/* Position Metrics Grid */}
            <div className="pro-pos-grid">
              <div className="pro-pos-item">
                <span>Mark Price</span>
                <strong className="mono">{currentMark > 0 ? `$${formatCryptoPrice(currentMark)}` : "—"}</strong>
              </div>
              <div className="pro-pos-item">
                <span>Entry Avg</span>
                <strong className="mono">{activeTrade.entry_avg ? `$${formatCryptoPrice(Number(activeTrade.entry_avg))}` : "—"}</strong>
              </div>
              <div className="pro-pos-item">
                <span>Quantity</span>
                <strong className="mono">{activeTrade.qty ?? "—"}</strong>
              </div>
              <div className="pro-pos-item">
                <span className="negative">Stop Loss</span>
                <strong className="mono negative">{activeTrade.sl ? `$${formatCryptoPrice(Number(activeTrade.sl))}` : "—"}</strong>
              </div>
              {activeTradeTargets.map((t) => (
                <div className="pro-pos-item" key={t.target_index}>
                  <span style={{ color: t.status === "filled" ? "var(--aqua)" : "var(--muted)" }}>
                    TP{t.target_index} ({t.share_pct}%)
                  </span>
                  <strong className="mono positive">
                    {t.price ? `$${formatCryptoPrice(Number(t.price))}` : "—"}
                  </strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="badge demo">Термінал</span>
              <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>
                Немає відкритої позиції. Оберіть сигнал у стрічці ліворуч або введіть пару в поле пошуку.
              </span>
            </div>
            <span className="mono" style={{ fontSize: "12px", color: "var(--soft-violet)" }}>
              24/7 Bybit Linear Perpetual Feed
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
