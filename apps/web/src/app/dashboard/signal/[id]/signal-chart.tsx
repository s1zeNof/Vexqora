"use client";

import { useEffect, useRef, useState } from "react";
import type { Kline } from "@crypto-bot/shared";
import { formatPrice, formatCryptoPrice } from "../../../../lib/format";
import { TradingViewChart } from "../../../../components/trading-view-chart";

type TimeframeOption = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";

const TF_MAP: Record<TimeframeOption, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1H": "60",
  "4H": "240",
  "1D": "D"
};

interface SignalChartProps {
  symbol: string;
  initialKlines: Kline[];
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  currentPrice: number;
  livePrice?: number;
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
  livePrice,
  position
}: SignalChartProps) {
  const [chartMode, setChartMode] = useState<"tradingview" | "terminal">("terminal");
  const [timeframe, setTimeframe] = useState<TimeframeOption>("15m");
  const [klines, setKlines] = useState<Kline[]>(initialKlines);
  const [isLoadingKlines, setIsLoadingKlines] = useState(false);

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1.0); // 0.5 (wide view) to 2.5 (zoomed in)
  const [panOffset, setPanOffset] = useState(0); // number of candles shifted into the past
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; initialOffset: number } | null>(null);

  // Hover crosshair state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const activeCurrentPrice = livePrice && livePrice > 0 ? livePrice : initialCurrentPrice;

  // Fetch real klines when user clicks a timeframe
  const handleTimeframeChange = async (tf: TimeframeOption) => {
    if (tf === timeframe && klines.length > 0) return;
    setTimeframe(tf);
    setIsLoadingKlines(true);
    setPanOffset(0);

    try {
      const interval = TF_MAP[tf];
      const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${interval}&limit=70`, {
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json() as { success: boolean; klines: Kline[] };
        if (json.success && Array.isArray(json.klines) && json.klines.length > 0) {
          setKlines(json.klines);
        }
      }
    } catch {
      // Keep existing klines on network error
    } finally {
      setIsLoadingKlines(false);
    }
  };

  // Update current live candle with live price
  useEffect(() => {
    if (!activeCurrentPrice || klines.length === 0) return;
    setKlines((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last) {
        copy[copy.length - 1] = {
          ...last,
          close: activeCurrentPrice,
          high: Math.max(last.high, activeCurrentPrice),
          low: Math.min(last.low, activeCurrentPrice)
        };
      }
      return copy;
    });
  }, [activeCurrentPrice]);

  // Fallback synthetic candles if API returned empty
  const rawKlines: Kline[] = klines.length >= 5 ? klines : (() => {
    const list: Kline[] = [];
    const base = entry || 100;
    const now = Date.now();
    for (let i = 40; i >= 0; i--) {
      const t = now - i * 15 * 60 * 1000;
      const variation = Math.sin(i * 0.4) * (base * 0.015);
      const open = base + variation;
      const close = open + Math.cos(i * 0.3) * (base * 0.01);
      const high = Math.max(open, close) + base * 0.005;
      const low = Math.min(open, close) - base * 0.005;
      list.push({ time: t, open, high, low, close, volume: 1000 + i * 50 });
    }
    return list;
  })();

  // Zoom and Pan slicing
  const baseVisibleCount = 35;
  const visibleCount = Math.min(
    rawKlines.length,
    Math.max(12, Math.round(baseVisibleCount / Math.max(0.4, zoom)))
  );

  const maxPanOffset = Math.max(0, rawKlines.length - visibleCount);
  const clampedPanOffset = Math.min(maxPanOffset, Math.max(0, panOffset));

  const endIndex = rawKlines.length - clampedPanOffset;
  const startIndex = Math.max(0, endIndex - visibleCount);
  const visibleKlines = rawKlines.slice(startIndex, endIndex);

  // SVG Chart Dimensions
  const width = 840;
  const height = 500;
  const chartRight = 760;
  const chartBottom = height - 32;
  const chartTop = 32;

  // Price range calculation
  const allPrices = [
    ...visibleKlines.map((k) => k.high),
    ...visibleKlines.map((k) => k.low),
    entry,
    stopLoss,
    tp1,
    tp2,
    tp3,
    activeCurrentPrice
  ].filter((p): p is number => typeof p === "number" && p > 0);

  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const padding = (rawMax - rawMin) * 0.06 || rawMin * 0.01;
  const minPrice = rawMin - padding;
  const maxPrice = rawMax + padding;
  const priceRange = Math.max(0.0000001, maxPrice - minPrice);

  const getY = (price: number) => {
    const ratio = (price - minPrice) / priceRange;
    return chartBottom - ratio * (chartBottom - chartTop);
  };

  const getPriceFromY = (y: number) => {
    const ratio = (chartBottom - y) / (chartBottom - chartTop);
    return minPrice + ratio * priceRange;
  };

  const candleCount = visibleKlines.length;
  const candleSlot = chartRight / Math.max(1, candleCount);
  const candleWidth = Math.max(3, Math.min(32, candleSlot * 0.68));

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      // Zoom in
      setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))));
    } else {
      // Zoom out
      setZoom((z) => Math.max(0.45, Number((z - 0.15).toFixed(2))));
    }
  };

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { clientX: e.clientX, initialOffset: clampedPanOffset };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (mouseX >= 0 && mouseX <= chartRight && mouseY >= chartTop && mouseY <= chartBottom) {
      const idx = Math.floor(mouseX / candleSlot);
      setHoverIndex(Math.min(visibleKlines.length - 1, Math.max(0, idx)));
      setHoverY(mouseY);
    } else {
      setHoverIndex(null);
      setHoverY(null);
    }

    if (isDragging && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.clientX;
      const candleShift = Math.round(dx / candleSlot);
      const newOffset = dragStartRef.current.initialOffset + candleShift;
      setPanOffset(Math.min(maxPanOffset, Math.max(0, newOffset)));
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    setPanOffset(0);
  };

  // Hovered candle data for OHLC header
  const hoveredCandle = hoverIndex !== null ? visibleKlines[hoverIndex] : visibleKlines[visibleKlines.length - 1];

  return (
    <div className="cd" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Top Chart Header: Controls & Target Levels Bar */}
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
            onClick={() => setChartMode("terminal")}
            className={`tab ${chartMode === "terminal" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
          >
            Термінал Vexqora
          </button>
          <button
            type="button"
            onClick={() => setChartMode("tradingview")}
            className={`tab ${chartMode === "tradingview" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
          >
            TradingView (Bybit Perp)
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
          {tp3 > 0 && (
            <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
              <span className="lb">TP3:</span> <b style={{ color: "#42F5B9" }}>{formatPrice(tp3)}</b>
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
        <div
          style={{ position: "relative", width: "100%", height: "500px", background: "#050505", userSelect: "none" }}
          onWheel={handleWheel}
        >
          {/* Top Sub-Bar: Timeframe Switcher + Zoom Tools + OHLC Bar */}
          <div
            style={{
              position: "absolute",
              top: "10px",
              left: "14px",
              right: "14px",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              pointerEvents: "none",
              flexWrap: "wrap",
              gap: "8px"
            }}
          >
            {/* Timeframe Buttons & Zoom */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px", pointerEvents: "auto" }}>
              {(["1m", "5m", "15m", "1H", "4H", "1D"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => {
                    void handleTimeframeChange(tf);
                  }}
                  disabled={isLoadingKlines}
                  className={`tab ${timeframe === tf ? "on" : ""}`}
                  style={{
                    padding: "4px 9px",
                    fontSize: "11px",
                    fontWeight: 600,
                    opacity: isLoadingKlines && timeframe === tf ? 0.6 : 1
                  }}
                >
                  {tf}
                </button>
              ))}

              <span style={{ width: "1px", height: "16px", background: "#262626", margin: "0 4px" }} />

              {/* Zoom Buttons */}
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.2).toFixed(2))))}
                className="bt sm"
                title="Збільшити графік (Zoom In)"
                style={{ padding: "2px 7px", fontSize: "12px", height: "24px" }}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.2).toFixed(2))))}
                className="bt sm"
                title="Зменшити графік (Zoom Out)"
                style={{ padding: "2px 7px", fontSize: "12px", height: "24px" }}
              >
                −
              </button>
              {(zoom !== 1.0 || panOffset !== 0) && (
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="bt sm"
                  title="Скинути зум і панорамування"
                  style={{ padding: "2px 8px", fontSize: "11px", height: "24px", color: "#A0A0A0" }}
                >
                  ↺ Скинути
                </button>
              )}

              {isLoadingKlines && (
                <span style={{ fontSize: "11px", color: "#42F5B9", marginLeft: "6px" }}>
                  Оновлення свічок...
                </span>
              )}
            </div>

            {/* OHLCV Info Bar of hovered/latest candle */}
            {hoveredCandle && (
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  fontSize: "11px",
                  fontVariantNumeric: "tabular-nums",
                  background: "#141414AA",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  border: "1px solid #222222"
                }}
              >
                <span>O: <b style={{ color: "#E0E0E0" }}>${formatCryptoPrice(hoveredCandle.open)}</b></span>
                <span>H: <b style={{ color: "#42F5B9" }}>${formatCryptoPrice(hoveredCandle.high)}</b></span>
                <span>L: <b style={{ color: "#FF5A6E" }}>${formatCryptoPrice(hoveredCandle.low)}</b></span>
                <span>C: <b style={{ color: hoveredCandle.close >= hoveredCandle.open ? "#42F5B9" : "#FF5A6E" }}>${formatCryptoPrice(hoveredCandle.close)}</b></span>
                <span>V: <b style={{ color: "#A0A0A0" }}>{hoveredCandle.volume ? Math.round(hoveredCandle.volume) : "—"}</b></span>
              </div>
            )}
          </div>

          {/* SVG Candlestick & Levels Canvas */}
          <svg
            width="100%"
            height="500"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${symbol} interactive chart with Entry, SL, TP levels`}
            style={{ display: "block", cursor: isDragging ? "grabbing" : "crosshair" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              handleMouseUp();
              setHoverIndex(null);
              setHoverY(null);
            }}
          >
            {/* Horizontal Grid lines */}
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((ratio) => {
              const y = chartBottom - ratio * (chartBottom - chartTop);
              const priceAtGrid = minPrice + ratio * priceRange;
              return (
                <g key={ratio}>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={y}
                    y2={y}
                    stroke="#161616"
                    strokeWidth="1"
                  />
                  <text
                    x={chartRight + 6}
                    y={y + 3}
                    fill="#5A5A5A"
                    fontSize="10"
                    fontFamily="Inter, sans-serif"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatPrice(priceAtGrid)}
                  </text>
                </g>
              );
            })}

            {/* Target Level Lines: Stop Loss (Red) */}
            {stopLoss > 0 && stopLoss >= minPrice && stopLoss <= maxPrice && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(stopLoss)}
                  y2={getY(stopLoss)}
                  stroke="#FF5A6E"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
                <rect
                  x={chartRight + 2}
                  y={getY(stopLoss) - 9}
                  width="70"
                  height="18"
                  fill="#FF5A6E22"
                  stroke="#FF5A6E"
                  strokeWidth="0.8"
                  rx="3"
                />
                <text
                  x={chartRight + 6}
                  y={getY(stopLoss) + 3}
                  fill="#FF5A6E"
                  fontSize="10"
                  fontWeight="600"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  SL {formatPrice(stopLoss)}
                </text>
              </g>
            )}

            {/* Entry Price Line (White) */}
            {entry > 0 && entry >= minPrice && entry <= maxPrice && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(entry)}
                  y2={getY(entry)}
                  stroke="#FFFFFF"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
                <rect
                  x={chartRight + 2}
                  y={getY(entry) - 9}
                  width="70"
                  height="18"
                  fill="#2A2A2A"
                  stroke="#555555"
                  strokeWidth="0.8"
                  rx="3"
                />
                <text
                  x={chartRight + 6}
                  y={getY(entry) + 3}
                  fill="#FFFFFF"
                  fontSize="10"
                  fontWeight="600"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  Вхід {formatPrice(entry)}
                </text>
              </g>
            )}

            {/* Take Profit 1 Line (Green) */}
            {tp1 > 0 && tp1 >= minPrice && tp1 <= maxPrice && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(tp1)}
                  y2={getY(tp1)}
                  stroke="#42F5B9"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
                <rect
                  x={chartRight + 2}
                  y={getY(tp1) - 9}
                  width="70"
                  height="18"
                  fill="#42F5B922"
                  stroke="#42F5B9"
                  strokeWidth="0.8"
                  rx="3"
                />
                <text
                  x={chartRight + 6}
                  y={getY(tp1) + 3}
                  fill="#42F5B9"
                  fontSize="10"
                  fontWeight="600"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  TP1 {formatPrice(tp1)}
                </text>
              </g>
            )}

            {/* Take Profit 2 Line */}
            {tp2 > 0 && tp2 >= minPrice && tp2 <= maxPrice && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(tp2)}
                  y2={getY(tp2)}
                  stroke="#42F5B9"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={chartRight + 6}
                  y={getY(tp2) + 3}
                  fill="#42F5B9"
                  fontSize="10"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  TP2 {formatPrice(tp2)}
                </text>
              </g>
            )}

            {/* Take Profit 3 Line */}
            {tp3 > 0 && tp3 >= minPrice && tp3 <= maxPrice && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(tp3)}
                  y2={getY(tp3)}
                  stroke="#42F5B9"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={chartRight + 6}
                  y={getY(tp3) + 3}
                  fill="#42F5B9"
                  fontSize="10"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  TP3 {formatPrice(tp3)}
                </text>
              </g>
            )}

            {/* Live Current Price Line with solid bright label */}
            {activeCurrentPrice > 0 && activeCurrentPrice >= minPrice && activeCurrentPrice <= maxPrice && (
              <g>
                <line
                  x1={0}
                  x2={chartRight}
                  y1={getY(activeCurrentPrice)}
                  y2={getY(activeCurrentPrice)}
                  stroke="#42F5B9"
                  strokeWidth="1"
                />
                <rect
                  x={chartRight + 2}
                  y={getY(activeCurrentPrice) - 10}
                  width="74"
                  height="20"
                  fill="#42F5B9"
                  rx="3"
                />
                <text
                  x={chartRight + 6}
                  y={getY(activeCurrentPrice) + 4}
                  fill="#000000"
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="Inter, sans-serif"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatPrice(activeCurrentPrice)}
                </text>
              </g>
            )}

            {/* Render Candlesticks */}
            {visibleKlines.map((candle, i) => {
              const x = i * candleSlot + candleSlot / 2;
              const isUp = candle.close >= candle.open;
              const color = isUp ? "#42F5B9" : "#FF5A6E";

              const yHigh = getY(candle.high);
              const yLow = getY(candle.low);
              const yOpen = getY(candle.open);
              const yClose = getY(candle.close);

              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

              return (
                <g key={candle.time}>
                  {/* High - Low Wick */}
                  <line
                    x1={x}
                    x2={x}
                    y1={yHigh}
                    y2={yLow}
                    stroke={color}
                    strokeWidth="1"
                  />
                  {/* Candle Body */}
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                    rx="1"
                  />
                </g>
              );
            })}

            {/* Active Position Badge overlaying Entry line */}
            {position && entry > 0 && (
              <g>
                <rect
                  x="450"
                  y={getY(entry) - 13}
                  width="280"
                  height="26"
                  rx="6"
                  fill="#141414"
                  stroke="#42F5B9"
                  strokeWidth="1"
                />
                <text
                  x="460"
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

            {/* Interactive Crosshair */}
            {hoverIndex !== null && hoverY !== null && (
              <g>
                {/* Horizontal crosshair */}
                <line
                  x1={0}
                  x2={chartRight}
                  y1={hoverY}
                  y2={hoverY}
                  stroke="#666666"
                  strokeWidth="0.8"
                  strokeDasharray="2 2"
                />
                {/* Price pill on right axis */}
                <rect
                  x={chartRight + 2}
                  y={hoverY - 9}
                  width="72"
                  height="18"
                  fill="#333333"
                  rx="3"
                />
                <text
                  x={chartRight + 6}
                  y={hoverY + 3}
                  fill="#FFFFFF"
                  fontSize="10"
                  fontFamily="Inter, sans-serif"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatPrice(getPriceFromY(hoverY))}
                </text>

                {/* Vertical crosshair */}
                {visibleKlines[hoverIndex] && (
                  <>
                    <line
                      x1={hoverIndex * candleSlot + candleSlot / 2}
                      x2={hoverIndex * candleSlot + candleSlot / 2}
                      y1={chartTop}
                      y2={chartBottom}
                      stroke="#666666"
                      strokeWidth="0.8"
                      strokeDasharray="2 2"
                    />
                    {/* Time pill on bottom axis */}
                    <rect
                      x={hoverIndex * candleSlot + candleSlot / 2 - 25}
                      y={height - 20}
                      width="50"
                      height="16"
                      fill="#333333"
                      rx="3"
                    />
                    <text
                      x={hoverIndex * candleSlot + candleSlot / 2}
                      y={height - 8}
                      fill="#FFFFFF"
                      fontSize="9"
                      textAnchor="middle"
                      fontFamily="Inter, sans-serif"
                    >
                      {new Date(visibleKlines[hoverIndex].time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </text>
                  </>
                )}
              </g>
            )}

            {/* Bottom Time Axis Labels */}
            {visibleKlines.filter((_, i) => i % Math.max(1, Math.round(visibleKlines.length / 7)) === 0).map((k) => {
              const candleIdx = visibleKlines.indexOf(k);
              const x = candleIdx * candleSlot + candleSlot / 2;
              const date = new Date(k.time);
              const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
              return (
                <text
                  key={k.time}
                  x={x}
                  y={height - 8}
                  fill="#666666"
                  fontSize="10"
                  textAnchor="middle"
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
