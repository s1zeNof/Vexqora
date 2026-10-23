"use client";

import { useEffect, useRef, useState } from "react";
import { formatCryptoPrice } from "../../../lib/format";

export interface PnlShareData {
  symbol: string;
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  currentOrExitPrice: number;
  pnlUsdt: number;
  pnlPct: number;
  isClosed: boolean;
  exitReason?: string | null | undefined;
  openedAt?: string | null | undefined;
  closedAt?: string | null | undefined;
  isPaper?: boolean | undefined;
}

type PnlDisplayMode = "both" | "percent" | "usdt";

function formatDuration(openedAt?: string | null, closedAt?: string | null): string {
  if (!openedAt) return "—";
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  const min = Math.floor(diffSec / 60);
  const hours = Math.floor(min / 60);
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  const remainMin = min % 60;

  if (days > 0) {
    return `${days} д ${remainHours} год`;
  }
  if (hours > 0) {
    return `${hours} год ${remainMin} хв`;
  }
  if (min > 0) {
    return `${min} хв`;
  }
  return `${diffSec} сек`;
}

function draw3DCandlesticks(
  ctx: CanvasRenderingContext2D,
  isProfit: boolean
) {
  ctx.save();

  // Color Palettes
  const mainGradStart = isProfit ? "#42F5B9" : "#FF5A6E";
  const mainGradEnd = isProfit ? "#1EB885" : "#BA123B";
  const topFaceColor = isProfit ? "#7EFFD4" : "#FF879E";
  const sideFaceColor = isProfit ? "#147A58" : "#800A25";
  const wickColor = isProfit ? "rgba(66, 245, 185, 0.85)" : "rgba(255, 90, 110, 0.85)";
  const splineColor = isProfit ? "#35F2D0" : "#FF4F9A";

  // 3D Depth Offsets (isometric projection)
  const depthX = 14;
  const depthY = 9;

  // Candle definitions: [x, y, width, height, wickTop, wickBottom]
  const candleWidth = 44;
  let candles: Array<{ x: number; y: number; w: number; h: number; wickTop: number; wickBottom: number }>;

  if (isProfit) {
    candles = [
      { x: 670, y: 320, w: candleWidth, h: 55, wickTop: 18, wickBottom: 15 },
      { x: 760, y: 275, w: candleWidth, h: 70, wickTop: 22, wickBottom: 16 },
      { x: 850, y: 260, w: candleWidth, h: 42, wickTop: 14, wickBottom: 20 },
      { x: 940, y: 200, w: candleWidth, h: 95, wickTop: 28, wickBottom: 18 },
      { x: 1030, y: 155, w: candleWidth, h: 125, wickTop: 36, wickBottom: 22 }
    ];
  } else {
    candles = [
      { x: 670, y: 165, w: candleWidth, h: 55, wickTop: 16, wickBottom: 20 },
      { x: 760, y: 215, w: candleWidth, h: 68, wickTop: 14, wickBottom: 24 },
      { x: 850, y: 270, w: candleWidth, h: 40, wickTop: 20, wickBottom: 16 },
      { x: 940, y: 300, w: candleWidth, h: 90, wickTop: 18, wickBottom: 26 },
      { x: 1030, y: 350, w: candleWidth, h: 115, wickTop: 22, wickBottom: 34 }
    ];
  }

  // 1. Draw glowing ascending/descending trend spline & arrow
  ctx.save();
  ctx.strokeStyle = splineColor;
  ctx.lineWidth = 3.5;
  ctx.shadowColor = splineColor;
  ctx.shadowBlur = 18;

  ctx.beginPath();
  if (isProfit) {
    ctx.moveTo(630, 395);
    ctx.bezierCurveTo(740, 360, 880, 260, 1100, 130);
  } else {
    ctx.moveTo(630, 145);
    ctx.bezierCurveTo(740, 190, 880, 320, 1100, 435);
  }
  ctx.stroke();

  // Arrow Head
  ctx.fillStyle = splineColor;
  ctx.beginPath();
  if (isProfit) {
    const tipX = 1100;
    const tipY = 130;
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 22, tipY + 4);
    ctx.lineTo(tipX - 10, tipY + 16);
    ctx.closePath();
  } else {
    const tipX = 1100;
    const tipY = 435;
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 22, tipY - 4);
    ctx.lineTo(tipX - 10, tipY - 16);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();

  // 2. Draw each 3D candle
  for (const c of candles) {
    // A. Shadows on floor / background
    ctx.save();
    ctx.fillStyle = isProfit ? "rgba(53, 242, 208, 0.08)" : "rgba(255, 79, 154, 0.08)";
    ctx.beginPath();
    ctx.ellipse(c.x + c.w / 2 + depthX, c.y + c.h + c.wickBottom + 10, c.w * 0.7, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // B. Upper Wick
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, c.y - c.wickTop);
    ctx.lineTo(c.x + c.w / 2, c.y);
    ctx.stroke();

    // C. Lower Wick
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, c.y + c.h);
    ctx.lineTo(c.x + c.w / 2, c.y + c.h + c.wickBottom);
    ctx.stroke();

    // D. Right Face (3D extrusion shadow face)
    ctx.fillStyle = sideFaceColor;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w, c.y);
    ctx.lineTo(c.x + c.w + depthX, c.y - depthY);
    ctx.lineTo(c.x + c.w + depthX, c.y + c.h - depthY);
    ctx.lineTo(c.x + c.w, c.y + c.h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // E. Top Face (3D highlight facet)
    ctx.fillStyle = topFaceColor;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + depthX, c.y - depthY);
    ctx.lineTo(c.x + c.w + depthX, c.y - depthY);
    ctx.lineTo(c.x + c.w, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.stroke();

    // F. Front Face (Primary candle body with gradient)
    const frontGrad = ctx.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
    frontGrad.addColorStop(0, mainGradStart);
    frontGrad.addColorStop(1, mainGradEnd);
    ctx.fillStyle = frontGrad;
    ctx.fillRect(c.x, c.y, c.w, c.h);

    // Front Face subtle glass highlight stroke
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
  }

  // 3. Floating 3D Badge Indicator
  const badgeX = isProfit ? 920 : 920;
  const badgeY = isProfit ? 95 : 105;
  const badgeText = isProfit ? "BULLISH RUN" : "BEARISH DROP";

  ctx.save();
  ctx.font = "bold 12px 'JetBrains Mono', monospace";
  const bw = ctx.measureText(badgeText).width + 24;
  ctx.fillStyle = "#171229";
  ctx.strokeStyle = splineColor;
  ctx.lineWidth = 1.2;
  ctx.shadowColor = splineColor;
  ctx.shadowBlur = 10;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, bw, 28, 6);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(badgeX, badgeY, bw, 28);
    ctx.strokeRect(badgeX, badgeY, bw, 28);
  }
  ctx.fillStyle = splineColor;
  ctx.fillText(badgeText, badgeX + 12, badgeY + 18);
  ctx.restore();

  ctx.restore();
}

export function PnlShareCardModal({
  data,
  onClose
}: {
  data: PnlShareData | null;
  onClose: () => void;
}) {
  const [displayMode, setDisplayMode] = useState<PnlDisplayMode>("both");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Redraw canvas whenever data or displayMode changes
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-resolution 1280 x 720 (16:9 HD)
    const W = 1280;
    const H = 720;
    canvas.width = W;
    canvas.height = H;

    const isLong = data.side === "long";
    const isProfit = data.pnlUsdt >= 0;
    const accentColor = isProfit ? "#35F2D0" : "#FF4F9A";

    // 1. Base Dark Background
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, "#07050F");
    bgGrad.addColorStop(0.5, "#0A0716");
    bgGrad.addColorStop(1, "#0E0B1A");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Ambient Glow Spheres
    // Top right purple glow
    const purpleGlow = ctx.createRadialGradient(W - 150, 100, 20, W - 150, 100, 450);
    purpleGlow.addColorStop(0, "rgba(124, 77, 255, 0.22)");
    purpleGlow.addColorStop(1, "rgba(14, 11, 26, 0)");
    ctx.fillStyle = purpleGlow;
    ctx.fillRect(0, 0, W, H);

    // Left accent glow
    const accentGlow = ctx.createRadialGradient(180, H - 120, 20, 180, H - 120, 500);
    accentGlow.addColorStop(0, isProfit ? "rgba(53, 242, 208, 0.18)" : "rgba(255, 79, 154, 0.18)");
    accentGlow.addColorStop(1, "rgba(7, 5, 15, 0)");
    ctx.fillStyle = accentGlow;
    ctx.fillRect(0, 0, W, H);

    // Right candles area ambient glow
    const rightGlow = ctx.createRadialGradient(920, 260, 20, 920, 260, 400);
    rightGlow.addColorStop(0, isProfit ? "rgba(53, 242, 208, 0.15)" : "rgba(255, 79, 154, 0.15)");
    rightGlow.addColorStop(1, "rgba(14, 11, 26, 0)");
    ctx.fillStyle = rightGlow;
    ctx.fillRect(0, 0, W, H);

    // 3. Subtle Modern Circuit / Grid lines
    ctx.strokeStyle = "rgba(42, 33, 69, 0.35)";
    ctx.lineWidth = 1;
    for (let x = 60; x < W; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 60; y < H; y += 120) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Outer Border
    ctx.strokeStyle = "#2A2145";
    ctx.lineWidth = 2;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(16, 16, W - 32, H - 32, 24);
      ctx.stroke();
    } else {
      ctx.strokeRect(16, 16, W - 32, H - 32);
    }

    // 4. Header Section: Exact Vexqora Logo from header
    const logoX = 70;
    const logoY = 52;
    const logoHeight = 44;
    const logoScale = logoHeight / 466; // 466 is SVG viewBox height

    ctx.save();
    ctx.translate(logoX, logoY);
    ctx.scale(logoScale, logoScale);
    ctx.translate(-319, -282);

    const path1 = new Path2D("M366.92 292.7C391.61 293.3 417.44 293.08 442.17 293.04C449.89 305.25 457.21 320.05 464.16 332.76C476.25 354.4 488.2 376.12 500.01 397.92L593.11 568.5C585.36 581.31 576.95 599.19 570.05 612.92C565.9 620.89 561.77 629.07 557.31 636.86C549.62 624.56 543.02 611 535.99 598.26C528.62 584.91 521.16 571.69 513.82 558.32L442.21 429.46L388.09 331.44C384.09 323.99 380.04 316.58 375.92 309.21C373.63 305.17 368.52 296.64 366.92 292.7Z");
    const path2 = new Path2D("M325.32 409.77C351.01 409.97 376.7 410 402.39 409.86C414.72 434.75 430.64 462.5 444 487C475.78 544.66 507.26 602.48 538.45 660.45C530.23 675.82 522.18 691.28 514.28 706.82C510.18 714.91 506.07 723.02 501.5 730.86C495.29 718.42 487.27 705.14 480.55 692.85C465.58 665.15 450.44 637.54 435.13 610.02L325.32 409.77Z");
    const path3 = new Path2D("M473.42 292.8C498.6 293.01 523.78 293.05 548.96 292.94C574.35 338.21 598.71 384.94 623.89 430.46L665.23 506.28C674.89 523.81 687.59 545.7 696.4 563.57C671.69 564.17 646.98 563.38 622.45 563.92C617.2 555.44 611.41 544.16 606.34 535.25C588.75 504.01 571.42 472.63 554.34 441.11L504.42 350.56C494.27 332.09 482.54 311.7 473.42 292.8Z");

    ctx.fillStyle = "#42F5B9";
    ctx.fill(path1);
    ctx.fillStyle = "#27D8A0";
    ctx.fill(path2);
    ctx.fillStyle = "#1EB885";
    ctx.fill(path3);
    ctx.restore();

    // Brand text: exact clean "Vexqora"
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 32px 'Plus Jakarta Sans', Inter, sans-serif";
    const textX = logoX + Math.round((logoHeight * 383) / 466) + 16;
    ctx.fillText("Vexqora", textX, logoY + 34);

    // Mode Pill on Top Right
    const modeText = data.isPaper ? "VEXQORA PAPER" : "BYBIT LIVE PERP";
    ctx.font = "bold 13px 'JetBrains Mono', monospace";
    const modeWidth = ctx.measureText(modeText).width + 24;
    const modeX = W - 70 - modeWidth;
    const modeY = 56;

    ctx.fillStyle = "#171229";
    ctx.strokeStyle = "#2A2145";
    ctx.lineWidth = 1.5;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(modeX, modeY, modeWidth, 32, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(modeX, modeY, modeWidth, 32);
      ctx.strokeRect(modeX, modeY, modeWidth, 32);
    }

    ctx.fillStyle = "#B9A2FF";
    ctx.fillText(modeText, modeX + 12, modeY + 21);

    // Horizontal Separator
    ctx.strokeStyle = "#2A2145";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(70, 118);
    ctx.lineTo(W - 70, 118);
    ctx.stroke();

    // 5. Main Hero Section (Left side)
    const heroY = 185;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 44px 'JetBrains Mono', monospace";
    ctx.fillText(data.symbol, 70, heroY);

    const symWidth = ctx.measureText(data.symbol).width;

    // Side & Leverage Badge
    const badgeText = `${data.side.toUpperCase()} ${data.leverage}X`;
    ctx.font = "bold 16px 'JetBrains Mono', monospace";
    const badgeWidth = ctx.measureText(badgeText).width + 20;
    const badgeX = 70 + symWidth + 18;
    const badgeY = heroY - 34;

    ctx.fillStyle = isLong ? "rgba(53, 242, 208, 0.12)" : "rgba(255, 79, 154, 0.12)";
    ctx.strokeStyle = isLong ? "#35F2D0" : "#FF4F9A";
    ctx.lineWidth = 1.5;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeWidth, 38, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(badgeX, badgeY, badgeWidth, 38);
      ctx.strokeRect(badgeX, badgeY, badgeWidth, 38);
    }
    ctx.fillStyle = isLong ? "#35F2D0" : "#FF4F9A";
    ctx.fillText(badgeText, badgeX + 10, badgeY + 25);

    // 6. Huge Hero PnL Display
    const pnlSign = isProfit ? "+" : "";
    const pnlPctFormatted = `${pnlSign}${data.pnlPct.toFixed(2)}%`;
    const pnlUsdtFormatted = `${pnlSign}${data.pnlUsdt.toFixed(2)} USDT`;

    ctx.fillStyle = accentColor;

    if (displayMode === "percent") {
      ctx.font = "800 96px 'JetBrains Mono', monospace";
      ctx.fillText(pnlPctFormatted, 70, heroY + 120);

      ctx.fillStyle = "#A59CC4";
      ctx.font = "600 16px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText("PROFIT RATE (ROI)", 74, heroY + 160);
    } else if (displayMode === "usdt") {
      ctx.font = "800 86px 'JetBrains Mono', monospace";
      ctx.fillText(pnlUsdtFormatted, 70, heroY + 115);

      ctx.fillStyle = "#A59CC4";
      ctx.font = "600 16px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(data.isClosed ? "REALIZED PROFIT" : "UNREALIZED PROFIT", 74, heroY + 155);
    } else {
      // Both: Percentage primary + USDT secondary
      ctx.font = "800 86px 'JetBrains Mono', monospace";
      ctx.fillText(pnlPctFormatted, 70, heroY + 100);

      ctx.fillStyle = isProfit ? "rgba(53, 242, 208, 0.85)" : "rgba(255, 79, 154, 0.85)";
      ctx.font = "bold 38px 'JetBrains Mono', monospace";
      ctx.fillText(pnlUsdtFormatted, 74, heroY + 155);
    }

    // 7. Right Hero Area: 3D Candlesticks Graphic
    draw3DCandlesticks(ctx, isProfit);

    // 8. Trade Fact Grid Box (5 Column Grid with Duration)
    const cardBoxY = 480;
    const cardBoxW = W - 140;
    const cardBoxH = 135;

    ctx.fillStyle = "#171229";
    ctx.strokeStyle = "#2A2145";
    ctx.lineWidth = 1.5;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(70, cardBoxY, cardBoxW, cardBoxH, 16);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(70, cardBoxY, cardBoxW, cardBoxH);
      ctx.strokeRect(70, cardBoxY, cardBoxW, cardBoxH);
    }

    const colW = cardBoxW / 5;

    // Col 1: Entry Price
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Ціна входу", 95, cardBoxY + 45);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 20px 'JetBrains Mono', monospace";
    ctx.fillText(`$${formatCryptoPrice(data.entryPrice)}`, 95, cardBoxY + 85);

    // Col 2: Current / Exit Price
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(data.isClosed ? "Ціна закриття" : "Поточна Mark", 95 + colW, cardBoxY + 45);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 20px 'JetBrains Mono', monospace";
    ctx.fillText(`$${formatCryptoPrice(data.currentOrExitPrice)}`, 95 + colW, cardBoxY + 85);

    // Col 3: Duration (Тривалість)
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Тривалість", 95 + colW * 2, cardBoxY + 45);
    ctx.fillStyle = "#35F2D0";
    ctx.font = "bold 20px 'JetBrains Mono', monospace";
    ctx.fillText(formatDuration(data.openedAt, data.closedAt), 95 + colW * 2, cardBoxY + 85);

    // Col 4: Status / Reason (NO EMOJIS)
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Статус угоди", 95 + colW * 3, cardBoxY + 45);
    ctx.fillStyle = isProfit ? "#35F2D0" : "#FF4F9A";
    ctx.font = "bold 18px 'Plus Jakarta Sans', sans-serif";
    const statusLabel = data.isClosed
      ? (data.exitReason === "take_profit" ? "Take Profit" : data.exitReason === "stop_loss" ? "Stop Loss" : "Закрито")
      : "Активна позиція";
    ctx.fillText(statusLabel, 95 + colW * 3, cardBoxY + 85);

    // Col 5: Date & Time
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Дата та час", 95 + colW * 4, cardBoxY + 45);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 18px 'JetBrains Mono', monospace";
    const dateToFormat = data.closedAt || data.openedAt || new Date().toISOString();
    const d = new Date(dateToFormat);
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    ctx.fillText(dateStr, 95 + colW * 4, cardBoxY + 85);

    // Footer lines completely removed as requested
  }, [data, displayMode]);

  if (!data) return null;

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `vexqora-pnl-${data.symbol}-${data.side}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopy = () => {
    if (!canvasRef.current) return;
    try {
      canvasRef.current.toBlob((blob) => {
        if (!blob) return;
        void navigator.clipboard
          .write([new ClipboardItem({ "image/png": blob })])
          .then(() => {
            setCopyStatus("Зображення скопійовано в буфер!");
            setTimeout(() => setCopyStatus(null), 3000);
          })
          .catch(() => {
            handleDownload();
            setCopyStatus("Завантажено як файл PNG!");
            setTimeout(() => setCopyStatus(null), 3000);
          });
      }, "image/png");
    } catch {
      handleDownload();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(7, 5, 15, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cd"
        style={{
          width: "100%",
          maxWidth: "840px",
          background: "#0E0B1A",
          border: "1px solid #2A2145",
          borderRadius: "16px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "18px"
        }}
      >
        {/* Modal Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, font: "700 20px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
              Картка результату PnL
            </h2>
            <p className="lb" style={{ margin: "4px 0 0", fontSize: "13px" }}>
              Генерація фірмової картки профіту для публікації в соцмережах або збереження.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="bt sm"
            style={{ width: "32px", height: "32px", padding: 0, fontSize: "16px" }}
          >
            ✕
          </button>
        </div>

        {/* Display Mode Switcher (PnL % vs USDT vs Both) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span className="lb" style={{ fontSize: "13px", fontWeight: 600 }}>Показувати:</span>
          <button
            type="button"
            onClick={() => setDisplayMode("both")}
            className={`tab ${displayMode === "both" ? "on" : ""}`}
            style={{ padding: "6px 14px", fontSize: "12px", fontWeight: 600 }}
          >
            Обидва (% та USDT)
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode("percent")}
            className={`tab ${displayMode === "percent" ? "on" : ""}`}
            style={{ padding: "6px 14px", fontSize: "12px", fontWeight: 600 }}
          >
            Тільки % (ROI)
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode("usdt")}
            className={`tab ${displayMode === "usdt" ? "on" : ""}`}
            style={{ padding: "6px 14px", fontSize: "12px", fontWeight: 600 }}
          >
            Тільки USDT ($)
          </button>

          {copyStatus && (
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "#35F2D0", fontWeight: 600 }}>
              {copyStatus}
            </span>
          )}
        </div>

        {/* Live Canvas Preview */}
        <div
          style={{
            position: "relative",
            width: "100%",
            borderRadius: "12px",
            overflow: "hidden",
            border: "1px solid #2A2145",
            background: "#07050F",
            aspectRatio: "16 / 9"
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: "contain"
            }}
          />
        </div>

        {/* Action Buttons with clean SVG icons (NO EMOJIS) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
          <button
            type="button"
            onClick={onClose}
            className="bt"
            style={{ padding: "8px 18px" }}
          >
            Закрити
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="bt"
            style={{
              padding: "8px 18px",
              background: "#171229",
              border: "1px solid #2A2145",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>Скопіювати</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="bt pr"
            style={{
              padding: "8px 20px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Завантажити PNG</span>
          </button>
        </div>
      </div>
    </div>
  );
}
