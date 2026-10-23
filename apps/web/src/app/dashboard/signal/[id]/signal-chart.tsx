"use client";

import { useState } from "react";
import type { Kline } from "@crypto-bot/shared";
import { formatPrice } from "../../../../lib/format";
import { TradingViewChart } from "../../../../components/trading-view-chart";

interface SignalChartProps {
  symbol: string;
  initialKlines: Kline[];
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  currentPrice: number;
  position: {
    side: "long" | "short";
    leverage: number;
    entryPrice: number;
    pnlUsdt: number;
    pnlPct: number;
    isPaper: boolean;
  } | null;
}

export function SignalChart({
  symbol,
  initialKlines,
  entry,
  stopLoss,
  tp1,
  tp2,
  tp3,
  currentPrice: initialCurrentPrice,
  position
}: SignalChartProps) {
  const [chartMode, setChartMode] = useState<"tradingview" | "svg">("tradingview");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1H" | "4H" | "1D">("15m");
  const [klines] = useState<Kline[]>(initialKlines);
  const [currentPrice] = useState<number>(initialCurrentPrice);

  // Fallback synthetic candles if API returned empty
  const activeKlines: Kline[] = klines.length >= 5 ? klines : (() => {
    const list: Kline[] = [];
    const base = entry || 100;
    const now = Date.now();
    for (let i = 25; i >= 0; i--) {
      const t = now - i * 15 * 60 * 1000;
      const variation = Math.sin(i * 0.4) * (base * 0.015);
      const open = base + variation;
      const close = open + (Math.cos(i * 0.3) * (base * 0.01));
      const high = Math.max(open, close) + base * 0.005;
      const low = Math.min(open, close) - base * 0.005;
      list.push({ time: t, open, high, low, close, volume: 1000 + i * 50 });
    }
    return list;
  })();

  // Calculate scales for 840x500 chart
  const width = 840;
  const height = 500;
  const chartRight = 776;

  const allPrices = [
    ...activeKlines.map((k) => k.high),
    ...activeKlines.map((k) => k.low),
    entry,
    stopLoss,
    tp1,
    tp2,
    tp3,
    currentPrice
  ].filter(Boolean);

  const minPrice = Math.min(...allPrices) * 0.995;
  const maxPrice = Math.max(...allPrices) * 1.005;
  const priceRange = Math.max(0.0000001, maxPrice - minPrice);

  const getY = (price: number) => {
    const ratio = (price - minPrice) / priceRange;
    return height - 40 - ratio * (height - 80);
  };

  const candleCount = activeKlines.length;
  const candleSlot = chartRight / Math.max(1, candleCount);
  const candleWidth = Math.max(3, candleSlot * 0.65);

  return (
    <div className="cd" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Top Chart Header: Controls & Level Targets Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          padding: "10px 14px",
          borderBottom: "1px solid #262626",
          background: "#111111"
        }}
      >
        {/* View Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            onClick={() => setChartMode("tradingview")}
            className={`tab ${chartMode === "tradingview" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
          >
            TradingView (Bybit Perp)
          </button>
          <button
            type="button"
            onClick={() => setChartMode("svg")}
            className={`tab ${chartMode === "svg" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
          >
            OKX Рівні & Свічки
          </button>
        </div>

        {/* Level Badges in Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {entry > 0 && (
            <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
              <span className="lb">Вхід:</span> <b style={{ color: "#FFFFFF" }}>{formatPrice(entry)}</b>
            </span>
          )}
          {stopLoss > 0 && (
            <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
              <span className="lb">SL:</span> <b style={{ color: "#FF5A6E" }}>{formatPrice(stopLoss)}</b>
            </span>
          )}
          {tp1 > 0 && (
            <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
              <span className="lb">TP1:</span> <b style={{ color: "#42F5B9" }}>{formatPrice(tp1)}</b>
            </span>
          )}
          {tp2 > 0 && (
            <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
              <span className="lb">TP2:</span> <b style={{ color: "#42F5B9" }}>{formatPrice(tp2)}</b>
            </span>
          )}
        </div>
      </div>

      {/* Main Chart Body */}
      {chartMode === "tradingview" ? (
        <div style={{ position: "relative", width: "100%", height: "540px", background: "#000000" }}>
          <TradingViewChart symbol={symbol} height="540px" interval="15" showToolbar={true} />
        </div>
      ) : (
        <div style={{ position: "relative", width: "100%", height: "500px", background: "#000000" }}>
          {/* Timeframe Bar for SVG */}
          <div
            style={{
              position: "absolute",
              top: "10px",
              left: "14px",
              zIndex: 2,
              display: "flex",
              gap: "4px"
            }}
          >
            {(["1m", "5m", "15m", "1H", "4H", "1D"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`tab ${timeframe === tf ? "on" : ""}`}
                style={{ padding: "4px 8px", fontSize: "11px" }}
              >
                {tf}
              </button>
            ))}
          </div>

          <svg
            width="100%"
            height="500"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${symbol} chart with Entry, SL, TP levels`}
            style={{ display: "block" }}
          >
            {/* Horizontal Grid lines */}
            {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
              const y = height - 40 - ratio * (height - 80);
              return (
                <line
                  key={ratio}
                  x1={0}
                  x2={chartRight}
                  y1={y}
                  y2={y}
                  stroke="#1A1A1A"
                  strokeWidth="1"
                />
              );
            })}

            {/* Candlesticks */}
            {activeKlines.map((k, idx) => {
              const x = idx * candleSlot + candleSlot / 2;
              const isUp = k.close >= k.open;
              const color = isUp ? "#42F5B9" : "#FF5A6E";

              const wickY1 = getY(k.high);
              const wickY2 = getY(k.low);
              const bodyY = getY(Math.max(k.open, k.close));
              const bodyHeight = Math.max(2, Math.abs(getY(k.open) - getY(k.close)));

              return (
                <g key={k.time}>
                  <line
                    x1={x}
                    x2={x}
                    y1={wickY1}
                    y2={wickY2}
                    stroke={color}
                    strokeWidth="1"
                  />
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyY}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                  />
                </g>
              );
            })}

            {/* Level: Entry (White Dashed) */}
            {entry > 0 && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(entry)}
                  y2={getY(entry)}
                  stroke="#FFFFFF"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <rect x={chartRight + 4} y={getY(entry) - 10} width="60" height="20" rx="4" fill="#1A1A1A" stroke="#FFFFFF" strokeWidth="1" />
                <text x={chartRight + 8} y={getY(entry) + 4} fill="#FFFFFF" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                  {formatPrice(entry)}
                </text>
              </g>
            )}

            {/* Level: Stop Loss (Red Dashed) */}
            {stopLoss > 0 && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(stopLoss)}
                  y2={getY(stopLoss)}
                  stroke="#FF5A6E"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <rect x={chartRight + 4} y={getY(stopLoss) - 10} width="60" height="20" rx="4" fill="#FF5A6E" />
                <text x={chartRight + 8} y={getY(stopLoss) + 4} fill="#FFFFFF" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                  {formatPrice(stopLoss)}
                </text>
              </g>
            )}

            {/* Level: TP1 (Mint Dashed) */}
            {tp1 > 0 && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(tp1)}
                  y2={getY(tp1)}
                  stroke="#42F5B9"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <rect x={chartRight + 4} y={getY(tp1) - 10} width="60" height="20" rx="4" fill="#42F5B9" />
                <text x={chartRight + 8} y={getY(tp1) + 4} fill="#000000" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">
                  {formatPrice(tp1)}
                </text>
              </g>
            )}

            {/* Level: Current Price (Solid Line) */}
            {currentPrice > 0 && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(currentPrice)}
                  y2={getY(currentPrice)}
                  stroke="#42F5B9"
                  strokeWidth="1.5"
                />
                <rect x={chartRight + 4} y={getY(currentPrice) - 10} width="60" height="20" rx="4" fill="#42F5B9" />
                <text x={chartRight + 8} y={getY(currentPrice) + 4} fill="#000000" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">
                  {formatPrice(currentPrice)}
                </text>
              </g>
            )}

            {/* Active Position Badge */}
            {position && entry > 0 && (
              <g>
                <rect
                  x="460"
                  y={getY(entry) - 13}
                  width="270"
                  height="26"
                  rx="6"
                  fill="#1A1A1A"
                  stroke="#42F5B9"
                  strokeWidth="1"
                />
                <text
                  x="470"
                  y={getY(entry) + 4}
                  fill="#FFFFFF"
                  fontSize="12"
                  fontWeight="600"
                  fontFamily="Inter, sans-serif"
                >
                  {position.isPaper ? "Paper" : "Live"} {position.side.toUpperCase()} {position.leverage}x · {position.pnlUsdt >= 0 ? "+" : ""}{position.pnlUsdt.toFixed(2)} USDT ({position.pnlPct >= 0 ? "+" : ""}{position.pnlPct.toFixed(2)}%)
                </text>
              </g>
            )}

            {/* Bottom Time Axis */}
            {activeKlines.filter((_, i) => i % 5 === 0).map((k, i) => {
              const x = i * 5 * candleSlot + candleSlot / 2;
              const date = new Date(k.time);
              const timeStr = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
              return (
                <text
                  key={k.time}
                  x={x}
                  y={height - 12}
                  fill="#9A9A9A"
                  fontSize="11"
                  fontFamily="Inter, sans-serif"
                >
                  {timeStr}
                </text>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
