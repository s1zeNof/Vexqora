"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { TradeRow } from "@crypto-bot/shared";
import { formatCryptoPrice } from "../../../lib/format";
import { PnlShareButton } from "../positions/pnl-share-button";

interface DayTradesModalProps {
  dateStr: string; // YYYY-MM-DD
  trades: TradeRow[];
  onClose: () => void;
}

const exitLabels: Record<string, { label: string; icon: string; tagClass: string }> = {
  take_profit: { label: "Take Profit", icon: "🎯", tagClass: "lg" },
  stop_loss: { label: "Stop Loss", icon: "🛑", tagClass: "sh" },
  trailing_stop: { label: "Trailing Stop", icon: "⚡", tagClass: "lg" },
  manual: { label: "Manual close", icon: "👤", tagClass: "gy" },
  close_all: { label: "Close all", icon: "🚪", tagClass: "gy" },
  exchange: { label: "Exchange fill", icon: "🏦", tagClass: "gy" }
};

export function DayTradesModal({ dateStr, trades, onClose }: DayTradesModalProps) {
  // ESC key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Aggregate stats
  const totalTrades = trades.length;
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;

  for (const t of trades) {
    const pnl = Number(t.realized_pnl ?? 0);
    totalPnl += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }

  const isProfit = totalPnl > 0;
  const isLoss = totalPnl < 0;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(0) : "0";

  // Format Ukrainian Date
  const dateObj = new Date(`${dateStr}T12:00:00Z`);
  const formattedDate = dateObj.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(7, 5, 15, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px"
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cd"
        style={{
          width: "100%",
          maxWidth: "720px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#0E0B1A",
          border: isProfit
            ? "1px solid #7C4DFF"
            : isLoss
            ? "1px solid #FF4F9A"
            : "1px solid #2A2145",
          boxShadow: isProfit
            ? "0 0 24px rgba(124, 77, 255, 0.25)"
            : isLoss
            ? "0 0 24px rgba(255, 79, 154, 0.25)"
            : "0 12px 36px rgba(0, 0, 0, 0.6)",
          borderRadius: "8px",
          overflow: "hidden"
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #2A2145",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            background: "#141026"
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "18px" }}>📅</span>
              <h2 style={{ margin: 0, font: "700 20px Inter, sans-serif", color: "#FFFFFF" }}>
                Історія торгів: {formattedDate}
              </h2>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  border: isProfit
                    ? "1px solid #7C4DFF"
                    : isLoss
                    ? "1px solid #FF4F9A"
                    : "1px solid #2A2145",
                  background: isProfit
                    ? "rgba(124, 77, 255, 0.15)"
                    : isLoss
                    ? "rgba(255, 79, 154, 0.15)"
                    : "#171229",
                  color: isProfit ? "#B9A2FF" : isLoss ? "#FF4F9A" : "#F1EEFF",
                  boxShadow: isProfit
                    ? "0 0 10px rgba(124, 77, 255, 0.3)"
                    : isLoss
                    ? "0 0 10px rgba(255, 79, 154, 0.3)"
                    : "none"
                }}
              >
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} USDT
              </span>
            </div>

            <div style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "12px", color: "#A59CC4" }}>
              <span>Всього угод: <b style={{ color: "#F1EEFF" }}>{totalTrades}</b></span>
              <span>Вінрейт: <b style={{ color: Number(winRate) >= 50 ? "#35F2D0" : "#FF4F9A" }}>{winRate}%</b> ({wins}W / {losses}L)</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="bt sm"
            style={{
              padding: "6px 10px",
              background: "#171229",
              border: "1px solid #2A2145",
              color: "#A59CC4",
              fontSize: "14px",
              cursor: "pointer",
              lineHeight: 1
            }}
            title="Закрити"
          >
            ✕
          </button>
        </div>

        {/* Modal Body - Trades List */}
        <div
          style={{
            padding: "20px 24px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}
        >
          {trades.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#A59CC4" }}>
              Немає угод за цей день.
            </div>
          ) : (
            trades.map((trade) => {
              const pnl = Number(trade.realized_pnl ?? 0);
              const isTradeProfit = pnl >= 0;
              const exitMeta = trade.exit_reason ? exitLabels[trade.exit_reason] : null;

              const closedTime = trade.closed_at
                ? new Date(trade.closed_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : trade.opened_at
                ? new Date(trade.opened_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "—";

              const entryPrice = trade.entry_avg ? Number(trade.entry_avg) : 0;
              const exitPrice = trade.exit_price ? Number(trade.exit_price) : 0;
              const qty = Number(trade.qty ?? 0);
              const leverage = Number(trade.leverage ?? 1);

              const pnlPct = entryPrice > 0 && qty > 0
                ? (pnl / ((entryPrice * qty) / leverage)) * 100
                : 0;

              return (
                <div
                  key={trade.id}
                  style={{
                    background: "#171229",
                    border: "1px solid #2A2145",
                    borderRadius: "6px",
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    transition: "border-color 0.2s"
                  }}
                >
                  {/* Row 1: Symbol, Side, Reason, PnL */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Link
                        href={`/dashboard/signal/${trade.symbol}`}
                        style={{
                          fontWeight: 700,
                          fontSize: "15px",
                          color: "#F1EEFF",
                          textDecoration: "underline",
                          textUnderlineOffset: "3px"
                        }}
                      >
                        {trade.symbol}
                      </Link>

                      <span className={`tg ${trade.side === "long" ? "lg" : "sh"}`}>
                        {trade.side.toUpperCase()} {leverage}x
                      </span>

                      {exitMeta ? (
                        <span className={`tg ${exitMeta.tagClass}`} style={{ fontSize: "11px" }}>
                          {exitMeta.icon} {exitMeta.label}
                        </span>
                      ) : (
                        <span className="tg gy" style={{ fontSize: "11px" }}>{trade.status}</span>
                      )}
                    </div>

                    <div
                      style={{
                        font: "700 15px JetBrains Mono, monospace",
                        color: isTradeProfit ? "#35F2D0" : "#FF4F9A",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                      }}
                    >
                      <span>{isTradeProfit ? "+" : ""}{pnl.toFixed(2)} USDT</span>
                      <span style={{ fontSize: "12px", opacity: 0.85 }}>
                        ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Metrics (Entry -> Exit, Qty, Time, PnL Share Card) */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                      paddingTop: "8px",
                      borderTop: "1px solid #231B3D",
                      fontSize: "12px",
                      color: "#A59CC4"
                    }}
                  >
                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                      <div>
                        <span>Вхід: </span>
                        <b style={{ color: "#F1EEFF", fontVariantNumeric: "tabular-nums" }}>
                          ${entryPrice ? formatCryptoPrice(entryPrice) : "—"}
                        </b>
                      </div>
                      <div>
                        <span>Вихід: </span>
                        <b style={{ color: "#F1EEFF", fontVariantNumeric: "tabular-nums" }}>
                          ${exitPrice ? formatCryptoPrice(exitPrice) : "—"}
                        </b>
                      </div>
                      <div>
                        <span>Розмір: </span>
                        <b style={{ color: "#F1EEFF", fontVariantNumeric: "tabular-nums" }}>
                          {qty}
                        </b>
                      </div>
                      <div>
                        <span>Час: </span>
                        <b style={{ color: "#F1EEFF" }}>{closedTime}</b>
                      </div>
                    </div>

                    <div>
                      <PnlShareButton
                        data={{
                          symbol: trade.symbol,
                          side: trade.side,
                          leverage,
                          entryPrice,
                          currentOrExitPrice: exitPrice || entryPrice,
                          pnlUsdt: pnl,
                          pnlPct,
                          isClosed: true,
                          exitReason: trade.exit_reason,
                          openedAt: trade.opened_at,
                          closedAt: trade.closed_at,
                          isPaper: true
                        }}
                        label="Поділитись PnL"
                        className="bt sm"
                        title="Згенерувати картку PnL з логотипом Vexqora"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
