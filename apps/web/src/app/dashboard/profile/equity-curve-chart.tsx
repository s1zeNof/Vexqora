"use client";

import { useEffect, useRef, useState } from "react";
import { formatCryptoPrice } from "../../../lib/format";

export interface EquityPoint {
  timestamp: number;
  dateStr: string;
  equity: number;
  changeUsdt: number;
  changePct: number;
  tradeSymbol?: string;
}

export interface EquityCurveChartProps {
  currentBalance: number;
  trades: Array<{
    id: string;
    symbol: string;
    side: string;
    status: string;
    realized_pnl: number | string | null;
    opened_at?: string | null;
    closed_at?: string | null;
    exit_reason?: string | null;
  }>;
}

export function EquityCurveChart({ currentBalance, trades }: EquityCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [timeframe, setTimeframe] = useState<"7D" | "30D" | "90D" | "ALL">("30D");
  const [hoveredPoint, setHoveredPoint] = useState<EquityPoint | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // 1. Build chronological equity time series
  const points: EquityPoint[] = (() => {
    // Sort closed trades chronologically
    const sortedTrades = [...trades]
      .filter((t) => t.status === "closed" && t.closed_at)
      .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());

    const totalRealizedPnl = sortedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
    const initialDeposit = Math.max(10, Number((currentBalance - totalRealizedPnl).toFixed(2)));

    const now = Date.now();
    const timeframeMs =
      timeframe === "7D"
        ? 7 * 24 * 60 * 60 * 1000
        : timeframe === "30D"
          ? 30 * 24 * 60 * 60 * 1000
          : timeframe === "90D"
            ? 90 * 24 * 60 * 60 * 1000
            : 365 * 24 * 60 * 60 * 1000;

    const startTime = now - timeframeMs;

    // Filter trades within timeframe
    const relevantTrades = timeframe === "ALL"
      ? sortedTrades
      : sortedTrades.filter((t) => new Date(t.closed_at!).getTime() >= startTime);

    let rollingEquity = initialDeposit;

    // For ALL timeframe, if trades exist before startTime, fast-forward rollingEquity
    if (timeframe !== "ALL") {
      const priorTrades = sortedTrades.filter((t) => new Date(t.closed_at!).getTime() < startTime);
      const priorPnl = priorTrades.reduce((s, t) => s + Number(t.realized_pnl ?? 0), 0);
      rollingEquity = Math.max(10, Number((initialDeposit + priorPnl).toFixed(2)));
    }

    const curve: EquityPoint[] = [];

    // Anchor point at start of window
    const firstTimestamp = relevantTrades.length > 0
      ? Math.min(new Date(relevantTrades[0]!.closed_at!).getTime() - 3600000, startTime)
      : startTime;

    const baselineEquity = rollingEquity;
    curve.push({
      timestamp: firstTimestamp,
      dateStr: new Date(firstTimestamp).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      equity: rollingEquity,
      changeUsdt: 0,
      changePct: 0
    });

    for (const t of relevantTrades) {
      const pnl = Number(t.realized_pnl ?? 0);
      rollingEquity = Number((rollingEquity + pnl).toFixed(2));
      const ts = new Date(t.closed_at!).getTime();
      const changeUsdt = Number((rollingEquity - baselineEquity).toFixed(2));
      const changePct = baselineEquity > 0 ? Number(((changeUsdt / baselineEquity) * 100).toFixed(2)) : 0;

      curve.push({
        timestamp: ts,
        dateStr: new Date(ts).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        equity: rollingEquity,
        changeUsdt,
        changePct,
        tradeSymbol: t.symbol
      });
    }

    // Anchor point at current moment
    const latestChangeUsdt = Number((currentBalance - baselineEquity).toFixed(2));
    const latestChangePct = baselineEquity > 0 ? Number(((latestChangeUsdt / baselineEquity) * 100).toFixed(2)) : 0;
    curve.push({
      timestamp: now,
      dateStr: "Зараз",
      equity: currentBalance,
      changeUsdt: latestChangeUsdt,
      changePct: latestChangePct
    });

    return curve;
  })();

  const latestPoint = points[points.length - 1] ?? {
    timestamp: Date.now(),
    dateStr: "Зараз",
    equity: currentBalance,
    changeUsdt: 0,
    changePct: 0
  };

  const activeDisplay = hoveredPoint || latestPoint;
  const isProfit = activeDisplay.changeUsdt >= 0;

  // 2. Render Canvas Chart
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = 240;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 20, right: 60, bottom: 30, left: 16 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const equities = points.map((p) => p.equity);
    const minVal = Math.min(...equities) * 0.995;
    const maxVal = Math.max(...equities) * 1.005;
    const rangeVal = Math.max(1, maxVal - minVal);

    const minTs = points[0]!.timestamp;
    const maxTs = points[points.length - 1]!.timestamp;
    const rangeTs = Math.max(1, maxTs - minTs);

    const getX = (ts: number) => padding.left + ((ts - minTs) / rangeTs) * chartW;
    const getY = (val: number) => padding.top + (1 - (val - minVal) / rangeVal) * chartH;

    // Draw horizontal dotted gridlines & price markers
    const gridRows = 4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(42, 33, 69, 0.6)";
    ctx.fillStyle = "#8E88A8";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.setLineDash([3, 4]);

    for (let i = 0; i <= gridRows; i++) {
      const val = minVal + (rangeVal / gridRows) * (gridRows - i);
      const y = padding.top + (chartH / gridRows) * i;

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      ctx.fillText(`$${formatCryptoPrice(val)}`, width - padding.right + 8, y + 3);
    }
    ctx.setLineDash([]);

    // Draw bottom date labels
    const dateSteps = 4;
    ctx.textAlign = "center";
    for (let i = 0; i <= dateSteps; i++) {
      const ts = minTs + (rangeTs / dateSteps) * i;
      const x = getX(ts);
      const label = new Date(ts).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
      ctx.fillText(label, x, height - 10);
    }

    // Build curve line path
    ctx.beginPath();
    points.forEach((p, idx) => {
      const x = getX(p.timestamp);
      const y = getY(p.equity);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Gradient fill under curve
    const fillGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    fillGradient.addColorStop(0, isProfit ? "rgba(53, 242, 208, 0.22)" : "rgba(255, 79, 154, 0.22)");
    fillGradient.addColorStop(1, "rgba(7, 5, 15, 0.0)");

    ctx.save();
    ctx.lineTo(getX(maxTs), height - padding.bottom);
    ctx.lineTo(getX(minTs), height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = fillGradient;
    ctx.fill();
    ctx.restore();

    // Stroke the neon equity line
    ctx.beginPath();
    points.forEach((p, idx) => {
      const x = getX(p.timestamp);
      const y = getY(p.equity);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = isProfit ? "#35F2D0" : "#FF4F9A";
    ctx.shadowColor = isProfit ? "rgba(53, 242, 208, 0.5)" : "rgba(255, 79, 154, 0.5)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw interactive hover crosshair & target point
    if (hoveredPoint && hoverPos) {
      const hx = getX(hoveredPoint.timestamp);
      const hy = getY(hoveredPoint.equity);

      // Vertical dashed crosshair line
      ctx.save();
      ctx.strokeStyle = "rgba(185, 162, 255, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, padding.top);
      ctx.lineTo(hx, height - padding.bottom);
      ctx.stroke();
      ctx.restore();

      // Outer glow circle
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, Math.PI * 2);
      ctx.fillStyle = isProfit ? "rgba(53, 242, 208, 0.35)" : "rgba(255, 79, 154, 0.35)";
      ctx.fill();

      // Inner target dot
      ctx.beginPath();
      ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isProfit ? "#35F2D0" : "#FF4F9A";
      ctx.fill();
      ctx.strokeStyle = "#07050F";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [points, hoveredPoint, hoverPos, isProfit]);

  // Handle Mouse / Touch Movement
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || points.length === 0) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = { left: 16, right: 60 };
    const chartW = rect.width - padding.left - padding.right;

    const clampedX = Math.max(padding.left, Math.min(rect.width - padding.right, mouseX));
    const ratio = (clampedX - padding.left) / chartW;

    const minTs = points[0]!.timestamp;
    const maxTs = points[points.length - 1]!.timestamp;
    const targetTs = minTs + ratio * (maxTs - minTs);

    // Find closest point
    let closest = points[0]!;
    let minDiff = Infinity;
    for (const p of points) {
      const diff = Math.abs(p.timestamp - targetTs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    setHoveredPoint(closest);
    setHoverPos({ x: mouseX, y: e.clientY - rect.top });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
    setHoverPos(null);
  };

  return (
    <div
      className="cd"
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        background: "#0E0B1A",
        border: "1px solid #2A2145"
      }}
    >
      {/* Top Header: Title, Telemetry & Timeframe Switcher */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>📈</span>
            <b style={{ font: "700 16px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
              Динаміка депозиту (Equity Curve)
            </b>
            <span
              className="tg gy"
              style={{
                fontSize: "10px",
                color: "#B9A2FF",
                border: "1px solid #7C4DFF44",
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              OKX / Bybit Live
            </span>
          </div>

          {/* Large Live Value and PnL indicator */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                font: "700 24px 'JetBrains Mono', monospace",
                color: "#FFFFFF",
                fontVariantNumeric: "tabular-nums"
              }}
            >
              ${formatCryptoPrice(activeDisplay.equity)} USDT
            </span>

            <span
              className="tg"
              style={{
                background: isProfit ? "rgba(53, 242, 208, 0.12)" : "rgba(255, 79, 154, 0.12)",
                color: isProfit ? "#35F2D0" : "#FF4F9A",
                border: `1px solid ${isProfit ? "#35F2D044" : "#FF4F9A44"}`,
                fontWeight: 700,
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              {isProfit ? "+" : ""}${activeDisplay.changeUsdt.toFixed(2)} ({isProfit ? "+" : ""}{activeDisplay.changePct.toFixed(2)}%)
            </span>

            <span className="lb" style={{ fontSize: "12px" }}>
              {hoveredPoint ? `Точка: ${activeDisplay.dateStr}${activeDisplay.tradeSymbol ? ` · ${activeDisplay.tradeSymbol}` : ""}` : "Поточний розмір депозиту"}
            </span>
          </div>
        </div>

        {/* Timeframe Filter Buttons */}
        <div style={{ display: "flex", gap: "4px", background: "#171229", padding: "3px", borderRadius: "8px", border: "1px solid #2A2145" }}>
          {(["7D", "30D", "90D", "ALL"] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              style={{
                border: "none",
                borderRadius: "6px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                background: timeframe === tf ? "#7C4DFF" : "transparent",
                color: timeframe === tf ? "#FFFFFF" : "#A59CC4",
                transition: "background 0.2s, color 0.2s"
              }}
            >
              {tf === "ALL" ? "Ввесь час" : tf}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Canvas Area */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          position: "relative",
          width: "100%",
          height: "240px",
          background: "#07050F",
          borderRadius: "8px",
          border: "1px solid #1E1735",
          cursor: "crosshair",
          overflow: "hidden"
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block" }} />

        {/* Floating Tooltip Follower */}
        {hoveredPoint && hoverPos && (
          <div
            style={{
              position: "absolute",
              left: `${Math.min(Math.max(10, hoverPos.x - 70), (containerRef.current?.clientWidth || 300) - 150)}px`,
              top: "12px",
              pointerEvents: "none",
              background: "#171229EE",
              backdropFilter: "blur(6px)",
              border: "1px solid #2A2145",
              borderRadius: "6px",
              padding: "6px 10px",
              fontSize: "11px",
              color: "#F1EEFF",
              fontFamily: "'JetBrains Mono', monospace",
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              zIndex: 10
            }}
          >
            <div style={{ color: "#A59CC4", fontSize: "10px" }}>{hoveredPoint.dateStr}</div>
            <div style={{ fontWeight: 700, color: "#FFFFFF" }}>
              ${formatCryptoPrice(hoveredPoint.equity)} USDT
            </div>
            <div style={{ color: isProfit ? "#35F2D0" : "#FF4F9A", fontSize: "10px" }}>
              {isProfit ? "+" : ""}{hoveredPoint.changeUsdt.toFixed(2)} USDT ({isProfit ? "+" : ""}{hoveredPoint.changePct.toFixed(2)}%)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
