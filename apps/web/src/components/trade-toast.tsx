"use client";

import { useEffect, useState } from "react";
import { formatCryptoPrice } from "../lib/format";

export interface TradeToastEvent {
  id: string;
  symbol: string;
  type: "profit" | "loss";
  title: string;
  message?: string;
  pnlUsdt: number;
  pnlPct?: number;
  exitPrice?: number;
  reason?: string;
}

let toastListeners: Array<(event: TradeToastEvent) => void> = [];

export function dispatchTradeToast(event: Omit<TradeToastEvent, "id">) {
  const item: TradeToastEvent = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  };
  toastListeners.forEach((fn) => fn(item));
}

export function TradeToastContainer() {
  const [toasts, setToasts] = useState<TradeToastEvent[]>([]);

  useEffect(() => {
    const handler = (event: TradeToastEvent) => {
      setToasts((prev) => [event, ...prev.slice(0, 3)]);
    };

    toastListeners.push(handler);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== handler);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        maxWidth: "380px",
        width: "calc(100vw - 40px)",
        pointerEvents: "none"
      }}
    >
      {toasts.map((toast) => {
        const isProfit = toast.type === "profit";
        const accentColor = isProfit ? "#42F5B9" : "#FF4F9A";
        const bgGlow = isProfit ? "rgba(66, 245, 185, 0.12)" : "rgba(255, 79, 154, 0.12)";
        const borderGlow = isProfit ? "1px solid #42F5B9" : "1px solid #FF4F9A";

        return (
          <TradeToastItem
            key={toast.id}
            toast={toast}
            accentColor={accentColor}
            bgGlow={bgGlow}
            borderGlow={borderGlow}
            onClose={() => removeToast(toast.id)}
          />
        );
      })}
    </div>
  );
}

function TradeToastItem({
  toast,
  accentColor,
  bgGlow,
  borderGlow,
  onClose
}: {
  toast: TradeToastEvent;
  accentColor: string;
  bgGlow: string;
  borderGlow: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const isProfit = toast.type === "profit";

  return (
    <div
      style={{
        pointerEvents: "auto",
        background: "#0E0B1A",
        border: borderGlow,
        borderRadius: "12px",
        padding: "14px 16px",
        boxShadow: `0 8px 30px rgba(0, 0, 0, 0.7), 0 0 20px ${bgGlow}`,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        animation: "slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>{isProfit ? "🎯" : "🛑"}</span>
          <strong style={{ fontSize: "14px", color: "#FFFFFF" }}>{toast.symbol}</strong>
          <span
            className="tg"
            style={{
              fontSize: "10px",
              fontWeight: 700,
              background: bgGlow,
              color: accentColor,
              border: `1px solid ${accentColor}44`
            }}
          >
            {toast.title}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            color: "#A59CC4",
            cursor: "pointer",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px 6px"
          }}
          aria-label="Закрити"
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: "12px", color: "#A59CC4" }}>
          {toast.message ?? toast.reason ?? (isProfit ? "Позицію закрито з прибутком" : "Позицію закрито по захисному стопу")}
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            fontSize: "15px",
            color: accentColor
          }}
        >
          {toast.pnlUsdt >= 0 ? "+" : ""}{toast.pnlUsdt.toFixed(2)} USDT
          {toast.pnlPct !== undefined ? ` (${toast.pnlPct >= 0 ? "+" : ""}${toast.pnlPct.toFixed(1)}%)` : ""}
        </div>
      </div>

      {toast.exitPrice && (
        <div style={{ fontSize: "11px", color: "#665C84", fontFamily: "'JetBrains Mono', monospace" }}>
          Ціна закриття: ${formatCryptoPrice(toast.exitPrice)}
        </div>
      )}
    </div>
  );
}
