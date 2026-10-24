"use client";

import { useState } from "react";
import Link from "next/link";
import type { TradeRow } from "@crypto-bot/shared";
import { formatCryptoPrice } from "../../../lib/format";
import { TradingCalendar } from "./trading-calendar";
import { PnlShareButton } from "../positions/pnl-share-button";

interface HistoryViewProps {
  trades: TradeRow[];
}

const exitLabels: Record<string, { label: string; tagClass: string; icon: string }> = {
  take_profit: { label: "Take Profit", tagClass: "lg", icon: "🎯" },
  stop_loss: { label: "Stop Loss", tagClass: "sh", icon: "🛑" },
  trailing_stop: { label: "Trailing Stop", tagClass: "lg", icon: "⚡" },
  manual: { label: "Manual close", tagClass: "gy", icon: "👤" },
  close_all: { label: "Close all", tagClass: "gy", icon: "🚪" },
  exchange: { label: "Exchange fill", tagClass: "gy", icon: "🏦" }
};

export function HistoryView({ trades }: HistoryViewProps) {
  const [viewMode, setViewMode] = useState<"calendar" | "table">("calendar");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
      {/* Top Header with Title and Mode Switcher */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px"
        }}
      >
        <div>
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif", color: "#FFFFFF" }}>
            Trade & Order History
          </h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Торговий PnL календар, виконані ордери, тейк-профіти, стоп-лоси та реалізований прибуток.
          </p>
        </div>

        {/* View Toggle Tabs */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px",
            background: "#141026",
            borderRadius: "6px",
            border: "1px solid #2A2145"
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
              background: viewMode === "calendar" ? "#7C4DFF" : "transparent",
              color: viewMode === "calendar" ? "#FFFFFF" : "#A59CC4",
              boxShadow: viewMode === "calendar" ? "0 0 12px rgba(124, 77, 255, 0.4)" : "none"
            }}
          >
            📅 Календар PnL
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
              background: viewMode === "table" ? "#7C4DFF" : "transparent",
              color: viewMode === "table" ? "#FFFFFF" : "#A59CC4",
              boxShadow: viewMode === "table" ? "0 0 12px rgba(124, 77, 255, 0.4)" : "none"
            }}
          >
            📋 Журнал угод ({trades.length})
          </button>
        </div>
      </div>

      {/* Main View Content */}
      {viewMode === "calendar" ? (
        <TradingCalendar trades={trades} />
      ) : (
        <div className="cd" style={{ overflow: "hidden" }}>
          <div className="table-responsive">
            <table className="dt-table">
              <thead>
                <tr>
                  <th>Час</th>
                  <th>Символ</th>
                  <th>Тип</th>
                  <th>К-сть</th>
                  <th>Вхід</th>
                  <th>Вихід</th>
                  <th>Ціна виходу</th>
                  <th>Realized PnL</th>
                  <th>Картка</th>
                </tr>
              </thead>
              <tbody>
                {trades.length > 0 ? (
                  trades.map((trade) => {
                    const pnl = Number(trade.realized_pnl ?? 0);
                    const isProfit = pnl >= 0;
                    const exitMeta = trade.exit_reason ? exitLabels[trade.exit_reason] : null;
                    const entryPrice = trade.entry_avg ? Number(trade.entry_avg) : 0;
                    const exitPrice = trade.exit_price ? Number(trade.exit_price) : 0;
                    const qty = Number(trade.qty ?? 0);
                    const leverage = Number(trade.leverage ?? 1);
                    const pnlPct =
                      entryPrice > 0 && qty > 0
                        ? (pnl / ((entryPrice * qty) / leverage)) * 100
                        : 0;

                    return (
                      <tr key={trade.id}>
                        <td style={{ color: "#9A9A9A", fontSize: "12px", whiteSpace: "nowrap" }}>
                          {new Date(trade.closed_at || trade.opened_at || Date.now()).toLocaleString("uk-UA", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/signal/${trade.symbol}`}
                            style={{
                              fontWeight: 600,
                              color: "#FFFFFF",
                              textDecoration: "underline",
                              textUnderlineOffset: "3px"
                            }}
                          >
                            {trade.symbol}
                          </Link>
                        </td>
                        <td>
                          <span className={`tg ${trade.side === "long" ? "lg" : "sh"}`}>
                            {trade.side.toUpperCase()} {leverage}x
                          </span>
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{trade.qty}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {trade.entry_avg ? `$${formatCryptoPrice(Number(trade.entry_avg))}` : "—"}
                        </td>
                        <td>
                          {exitMeta ? (
                            <span className={`tg ${exitMeta.tagClass}`} style={{ fontSize: "11px" }}>
                              {exitMeta.icon} {exitMeta.label}
                            </span>
                          ) : (
                            <span className="tg gy" style={{ fontSize: "11px" }}>
                              {trade.exit_reason || trade.status}
                            </span>
                          )}
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {trade.exit_price ? `$${formatCryptoPrice(Number(trade.exit_price))}` : "—"}
                        </td>
                        <td
                          style={{
                            color: isProfit ? "#35F2D0" : "#FF4F9A",
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {isProfit ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
                        </td>
                        <td>
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
                            label="Картка"
                            className="bt sm"
                          />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", padding: "48px 16px", color: "#9A9A9A" }}>
                      <p style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF" }}>
                        Немає записів про завершені угоди
                      </p>
                      <p className="lb" style={{ marginTop: "4px" }}>
                        Тут з&apos;являться закриті позиції, спрацювання Take Profit та Stop Loss.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
