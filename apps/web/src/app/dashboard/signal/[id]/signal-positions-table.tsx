"use client";

import { useState } from "react";
import { formatPrice, formatCryptoPrice } from "../../../../lib/format";
import { closeTradePosition } from "../../actions";
import { PnlShareButton } from "../../positions/pnl-share-button";

export interface SignalTradeItem {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  markPrice: number;
  qty: number;
  pnlUsdt: number;
  pnlPct: number;
  sl: number | null;
  tp1: number | null;
  status: string;
  opened_at?: string | undefined;
  closed_at?: string | undefined;
  exitReason?: string | null;
  exitPrice?: number | null;
  controlMode?: "auto" | "manual";
  trailingStop?: Record<string, unknown> | null;
}

interface SignalPositionsTableProps {
  symbol: string;
  trades: SignalTradeItem[];
  historyTrades: SignalTradeItem[];
  livePrice?: number;
}

export function SignalPositionsTable({ symbol, trades, historyTrades, livePrice }: SignalPositionsTableProps) {
  const [tab, setTab] = useState<"position" | "orders" | "history">("position");

  const activePosition = trades.find((t) => t.status === "active" || t.status === "entry_open");
  const positionCount = activePosition ? 1 : 0;
  const orderCount = activePosition?.tp1 || activePosition?.sl ? 2 : 0;

  const currentMarkPrice = livePrice && livePrice > 0 && activePosition ? livePrice : (activePosition?.markPrice ?? 0);
  const direction = activePosition?.side === "long" ? 1 : -1;
  const priceDiff = activePosition ? (currentMarkPrice - activePosition.entryPrice) * direction : 0;
  const currentPnlUsdt = activePosition && activePosition.qty > 0 && livePrice
    ? priceDiff * activePosition.qty
    : (activePosition?.pnlUsdt ?? 0);
  const currentPnlPct = activePosition && activePosition.entryPrice > 0 && livePrice
    ? (priceDiff / activePosition.entryPrice) * 100 * activePosition.leverage
    : (activePosition?.pnlPct ?? 0);

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
          History ({historyTrades.length})
        </button>
      </div>

      {tab === "position" && (
        <>
          {!activePosition ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#9A9A9A", fontSize: "13px" }}>
              Немає активної позиції для {symbol}. Скористайтеся панеллю виконання праворуч для входу.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr .6fr .7fr 1fr 1fr 1.3fr 1fr 1.4fr",
                  gap: "8px",
                  padding: "10px 0 6px"
                }}
              >
                <span className="lb">Символ</span>
                <span className="lb">Напрямок</span>
                <span className="lb">Розмір</span>
                <span className="lb">Вхід</span>
                <span className="lb">Mark</span>
                <span className="lb">Live PnL</span>
                <span className="lb">SL / TP1</span>
                <span className="lb">Дії</span>
              </div>

              {/* Position Row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr .6fr .7fr 1fr 1fr 1.3fr 1fr 1.4fr",
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
                <span>{activePosition.qty}</span>
                <span>${formatCryptoPrice(activePosition.entryPrice)}</span>
                <span>${formatCryptoPrice(currentMarkPrice)}</span>
                <span style={{ color: currentPnlUsdt >= 0 ? "#42F5B9" : "#FF5A6E", fontWeight: 700 }}>
                  {currentPnlUsdt >= 0 ? "+" : ""}{currentPnlUsdt.toFixed(2)} USDT ({currentPnlPct >= 0 ? "+" : ""}{currentPnlPct.toFixed(2)}%)
                </span>
                <span style={{ color: "#9A9A9A", fontSize: "13px" }}>
                  <span style={{ color: "#FF5A6E" }}>{activePosition.sl ? `$${formatCryptoPrice(activePosition.sl)}` : "—"}</span> /{" "}
                  <span style={{ color: "#42F5B9" }}>{activePosition.tp1 ? `$${formatCryptoPrice(activePosition.tp1)}` : "—"}</span>
                </span>
                <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <PnlShareButton
                    label=""
                    className="bt sm"
                    title="Отримати картку результату угоди"
                    data={{
                      symbol: activePosition.symbol,
                      side: activePosition.side,
                      leverage: activePosition.leverage,
                      entryPrice: activePosition.entryPrice,
                      currentOrExitPrice: currentMarkPrice,
                      pnlUsdt: currentPnlUsdt,
                      pnlPct: currentPnlPct,
                      isClosed: false,
                      openedAt: activePosition.opened_at,
                      isPaper: true
                    }}
                  />
                  <form action={closeTradePosition}>
                    <input type="hidden" name="tradeId" value={activePosition.id} />
                    <input type="hidden" name="qtyPct" value="50" />
                    <button type="submit" className="bt sm" style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}>
                      50%
                    </button>
                  </form>
                  <form action={closeTradePosition}>
                    <input type="hidden" name="tradeId" value={activePosition.id} />
                    <input type="hidden" name="qtyPct" value="100" />
                    <button type="submit" className="bt dn sm" style={{ height: "28px", padding: "0 10px", fontSize: "12px" }}>
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
              Немає активних умовних SL/TP ордерів на біржі.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {activePosition.sl && (
                <div className="row">
                  <span>Stop Loss Trigger ({activePosition.symbol})</span>
                  <span style={{ color: "#FF5A6E", fontWeight: 600 }}>${formatCryptoPrice(activePosition.sl)} (Exchange-Hosted)</span>
                </div>
              )}
              {activePosition.tp1 && (
                <div className="row">
                  <span>Take Profit 1 Limit ({activePosition.symbol})</span>
                  <span style={{ color: "#42F5B9", fontWeight: 600 }}>${formatCryptoPrice(activePosition.tp1)} (Reduce-Only)</span>
                </div>
              )}
              {activePosition.controlMode === "manual" && (
                <div style={{ marginTop: "6px", padding: "6px 10px", background: "#261E14", border: "1px solid #FFC24B44", borderRadius: "4px", color: "#FFE2A6", fontSize: "12px" }}>
                  ⏸️ <b>Ручний режим:</b> Автоматичне зіставлення цих рівнів призупинено. Трейдер контролює закриття позиції самостійно.
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
              Немає попередніх закритих угод для {symbol}.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {historyTrades.map((t) => (
                <div key={t.id} className="row" style={{ fontSize: "13px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className={`tg ${t.side === "long" ? "lg" : "sh"}`}>{t.side.toUpperCase()}</span>
                    <span>Вхід: ${formatPrice(t.entryPrice)}</span>
                    <span className="tg gy">
                      {t.exitReason === "take_profit" ? "Take Profit" :
                        t.exitReason === "stop_loss" ? "Stop Loss" :
                          t.exitReason === "trailing_stop" ? "Trailing Stop" :
                            t.exitReason === "manual" ? "Manual" : "Closed"}
                      {t.exitPrice ? ` @ $${formatCryptoPrice(t.exitPrice)}` : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span style={{ color: t.pnlUsdt >= 0 ? "#42F5B9" : "#FF5A6E", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {t.pnlUsdt >= 0 ? "+" : ""}{t.pnlUsdt.toFixed(2)} USDT ({t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%)
                    </span>
                    <PnlShareButton
                      label=""
                      className="bt sm"
                      title="Картка результату угоди"
                      data={{
                        symbol: t.symbol,
                        side: t.side,
                        leverage: t.leverage,
                        entryPrice: t.entryPrice,
                        currentOrExitPrice: t.exitPrice ?? t.markPrice,
                        pnlUsdt: t.pnlUsdt,
                        pnlPct: t.pnlPct,
                        isClosed: true,
                        exitReason: t.exitReason,
                        openedAt: t.opened_at,
                        closedAt: t.closed_at,
                        isPaper: true
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
