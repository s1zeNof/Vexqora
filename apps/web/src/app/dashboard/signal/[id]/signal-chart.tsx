"use client";

import { useState } from "react";
import type { Kline } from "@crypto-bot/shared";
import { formatPrice } from "../../../../lib/format";

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
    pnl: number;
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
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1H" | "4H" | "1D">("15m");
  const [klines] = useState<Kline[]>(initialKlines);
  const [currentPrice] = useState<number>(initialCurrentPrice);
  const [showTVWidget, setShowTVWidget] = useState<boolean>(false);

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

  // Calculate scales for 840x440 chart
  const width = 840;
  const height = 440;
  const chartRight = 776; // leave room for price axis labels on right

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
    <div className="cd" style={{ overflow: "hidden" }}>
      {/* Timeframe Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "10px 12px",
          borderBottom: "1px solid #262626",
          background: "#111111"
        }}
      >
        {(["1m", "5m", "15m", "1H", "4H", "1D"] as const).map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={`tab ${timeframe === tf ? "on" : ""}`}
            style={{ padding: "6px 10px", fontSize: "13px" }}
          >
            {tf}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowTVWidget((prev) => !prev)}
          className="tab"
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            fontSize: "13px",
            background: showTVWidget ? "#1A1A1A" : "transparent",
            color: showTVWidget ? "#42F5B9" : "#9A9A9A"
          }}
        >
          {showTVWidget ? "Overlay Levels" : "Indicators / TV"}
        </button>
      </div>

      {/* SVG Canvas Candlestick Chart with Overlaid Levels */}
      <div style={{ position: "relative", width: "100%", height: "440px", background: "#000000" }}>
        <svg
          width="100%"
          height="440"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${symbol} ${timeframe} chart with Entry, SL, TP levels`}
          style={{ display: "block" }}
        >
          {/* Horizontal Grid lines */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio, idx) => {
            const y = height - 40 - ratio * (height - 80);
            return (
              <line
                key={idx}
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

            const yHigh = getY(k.high);
            const yLow = getY(k.low);
            const yOpen = getY(k.open);
            const yClose = getY(k.close);

            const rectY = Math.min(yOpen, yClose);
            const rectHeight = Math.max(1.5, Math.abs(yClose - yOpen));

            return (
              <g key={k.time || idx}>
                {/* Wick */}
                <line
                  x1={x}
                  x2={x}
                  y1={yHigh}
                  y2={yLow}
                  stroke={color}
                  strokeWidth="1.2"
                />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={rectY}
                  width={candleWidth}
                  height={rectHeight}
                  fill={color}
                />
              </g>
            );
          })}

          {/* Level: TP3 */}
          {tp3 > 0 && (
            <g>
              <line
                x1={0}
                x2={chartRight}
                y1={getY(tp3)}
                y2={getY(tp3)}
                stroke="#42F5B9"
                strokeDasharray="5 4"
                strokeWidth="1.2"
              />
              <text x="8" y={getY(tp3) - 6} fill="#42F5B9" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                TP3
              </text>
              <rect x={chartRight + 4} y={getY(tp3) - 10} width="60" height="20" rx="4" fill="#42F5B9" />
              <text x={chartRight + 8} y={getY(tp3) + 4} fill="#000000" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                {formatPrice(tp3)}
              </text>
            </g>
          )}

          {/* Level: TP2 */}
          {tp2 > 0 && (
            <g>
              <line
                x1={0}
                x2={chartRight}
                y1={getY(tp2)}
                y2={getY(tp2)}
                stroke="#42F5B9"
                strokeDasharray="5 4"
                strokeWidth="1.2"
              />
              <text x="8" y={getY(tp2) - 6} fill="#42F5B9" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                TP2
              </text>
              <rect x={chartRight + 4} y={getY(tp2) - 10} width="60" height="20" rx="4" fill="#42F5B9" />
              <text x={chartRight + 8} y={getY(tp2) + 4} fill="#000000" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                {formatPrice(tp2)}
              </text>
            </g>
          )}

          {/* Level: TP1 */}
          {tp1 > 0 && (
            <g>
              <line
                x1={0}
                x2={chartRight}
                y1={getY(tp1)}
                y2={getY(tp1)}
                stroke="#42F5B9"
                strokeDasharray="5 4"
                strokeWidth="1.2"
              />
              <text x="8" y={getY(tp1) - 6} fill="#42F5B9" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                TP1
              </text>
              <rect x={chartRight + 4} y={getY(tp1) - 10} width="60" height="20" rx="4" fill="#42F5B9" />
              <text x={chartRight + 8} y={getY(tp1) + 4} fill="#000000" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                {formatPrice(tp1)}
              </text>
            </g>
          )}

          {/* Level: Entry */}
          {entry > 0 && (
            <g>
              <line
                x1={0}
                x2={chartRight}
                y1={getY(entry)}
                y2={getY(entry)}
                stroke="#FFFFFF"
                strokeDasharray="5 4"
                strokeWidth="1.2"
              />
              <text x="8" y={getY(entry) - 6} fill="#FFFFFF" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                Entry
              </text>
              <rect x={chartRight + 4} y={getY(entry) - 10} width="60" height="20" rx="4" fill="#FFFFFF" />
              <text x={chartRight + 8} y={getY(entry) + 4} fill="#000000" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                {formatPrice(entry)}
              </text>
            </g>
          )}

          {/* Level: Stop Loss */}
          {stopLoss > 0 && (
            <g>
              <line
                x1={0}
                x2={chartRight}
                y1={getY(stopLoss)}
                y2={getY(stopLoss)}
                stroke="#FF5A6E"
                strokeDasharray="5 4"
                strokeWidth="1.2"
              />
              <text x="8" y={getY(stopLoss) - 6} fill="#FF5A6E" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                SL
              </text>
              <rect x={chartRight + 4} y={getY(stopLoss) - 10} width="60" height="20" rx="4" fill="#FF5A6E" />
              <text x={chartRight + 8} y={getY(stopLoss) + 4} fill="#000000" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                {formatPrice(stopLoss)}
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

          {/* Active Position Badge on Entry line */}
          {position && entry > 0 && (
            <g>
              <rect
                x="500"
                y={getY(entry) - 13}
                width="220"
                height="26"
                rx="6"
                fill="#1A1A1A"
                stroke="#42F5B9"
                strokeWidth="1"
              />
              <text
                x="510"
                y={getY(entry) + 4}
                fill="#FFFFFF"
                fontSize="12"
                fontWeight="600"
                fontFamily="Inter, sans-serif"
              >
                {position.isPaper ? "Paper" : "Live"} {position.side.toUpperCase()} {position.leverage}x · {position.pnl >= 0 ? "+" : ""}{position.pnl.toFixed(2)} USDT
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
    </div>
  );
}
