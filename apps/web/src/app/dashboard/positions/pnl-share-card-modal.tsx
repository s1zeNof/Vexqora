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
  isPaper?: boolean;
}

type PnlDisplayMode = "both" | "percent" | "usdt";

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

    // Bottom left accent glow (Cyan or Pink)
    const accentGlow = ctx.createRadialGradient(180, H - 80, 20, 180, H - 80, 500);
    accentGlow.addColorStop(0, isProfit ? "rgba(53, 242, 208, 0.18)" : "rgba(255, 79, 154, 0.18)");
    accentGlow.addColorStop(1, "rgba(7, 5, 15, 0)");
    ctx.fillStyle = accentGlow;
    ctx.fillRect(0, 0, W, H);

    // 3. Subtle Modern Circuit / Grid lines
    ctx.strokeStyle = "rgba(42, 33, 69, 0.4)";
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

    // 4. Header Section: Logo + Platform Name
    // Draw Vexqora Stylized Logo Icon
    const logoX = 70;
    const logoY = 65;
    ctx.save();
    ctx.translate(logoX, logoY);

    // Logo diamond chevron
    ctx.fillStyle = "#35F2D0";
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(14, 0);
    ctx.lineTo(24, 0);
    ctx.lineTo(10, 16);
    ctx.closePath();
    ctx.fill();

    const logoGrad = ctx.createLinearGradient(0, 0, 32, 32);
    logoGrad.addColorStop(0, "#7C4DFF");
    logoGrad.addColorStop(1, "#B24BFF");
    ctx.fillStyle = logoGrad;
    ctx.beginPath();
    ctx.moveTo(8, 22);
    ctx.lineTo(22, 6);
    ctx.lineTo(32, 6);
    ctx.lineTo(18, 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Brand text
    ctx.fillStyle = "#F1EEFF";
    ctx.font = "bold 26px 'Plus Jakarta Sans', Inter, sans-serif";
    ctx.fillText("VEXQORA TRADE", logoX + 46, logoY + 16);

    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 13px 'Plus Jakarta Sans', Inter, sans-serif";
    ctx.fillText("Intelligent Trade Execution Platform", logoX + 46, logoY + 34);

    // Mode Pill on Top Right
    const modeText = data.isPaper ? "VEXQORA PAPER" : "BYBIT LIVE PERP";
    ctx.font = "bold 13px 'JetBrains Mono', monospace";
    const modeWidth = ctx.measureText(modeText).width + 24;
    const modeX = W - 70 - modeWidth;
    const modeY = 60;

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
    ctx.moveTo(70, 125);
    ctx.lineTo(W - 70, 125);
    ctx.stroke();

    // 5. Main Hero Section
    // Symbol
    const heroY = 190;
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

    // 7. Trade Fact Grid Box (Bottom half)
    const cardBoxY = 470;
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

    // 4 Column Grid inside Fact Box
    const colW = cardBoxW / 4;

    // Col 1: Entry Price
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 14px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Ціна входу (Entry)", 95, cardBoxY + 45);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 22px 'JetBrains Mono', monospace";
    ctx.fillText(`$${formatCryptoPrice(data.entryPrice)}`, 95, cardBoxY + 85);

    // Col 2: Current / Exit Price
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 14px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(data.isClosed ? "Ціна закриття (Exit)" : "Поточна Mark ціна", 95 + colW, cardBoxY + 45);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 22px 'JetBrains Mono', monospace";
    ctx.fillText(`$${formatCryptoPrice(data.currentOrExitPrice)}`, 95 + colW, cardBoxY + 85);

    // Col 3: Status / Reason
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 14px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Статус угоди", 95 + colW * 2, cardBoxY + 45);
    ctx.fillStyle = isProfit ? "#35F2D0" : "#FF4F9A";
    ctx.font = "bold 20px 'Plus Jakarta Sans', sans-serif";
    const statusLabel = data.isClosed
      ? (data.exitReason === "take_profit" ? "Take Profit 🎯" : data.exitReason === "stop_loss" ? "Stop Loss 🛡" : "Закрито")
      : "Активна позиція ⚡";
    ctx.fillText(statusLabel, 95 + colW * 2, cardBoxY + 85);

    // Col 4: Date
    ctx.fillStyle = "#A59CC4";
    ctx.font = "500 14px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("Дата та час", 95 + colW * 3, cardBoxY + 45);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 18px 'JetBrains Mono', monospace";
    const dateToFormat = data.closedAt || data.openedAt || new Date().toISOString();
    const d = new Date(dateToFormat);
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    ctx.fillText(dateStr, 95 + colW * 3, cardBoxY + 85);

    // 8. Footer Brand Line
    ctx.fillStyle = "#A59CC4";
    ctx.font = "600 14px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("vexqora.com", 70, H - 45);

    ctx.fillStyle = "#7C4DFF";
    ctx.font = "600 14px 'Plus Jakarta Sans', sans-serif";
    const slogan = "Signals · Execution · Risk Management · Automation";
    const sloganW = ctx.measureText(slogan).width;
    ctx.fillText(slogan, W - 70 - sloganW, H - 45);
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
              ✓ {copyStatus}
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

        {/* Action Buttons */}
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
            style={{ padding: "8px 18px", background: "#171229", border: "1px solid #2A2145" }}
          >
            📋 Скопіювати
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="bt pr"
            style={{ padding: "8px 20px" }}
          >
            📥 Завантажити PNG
          </button>
        </div>
      </div>
    </div>
  );
}
