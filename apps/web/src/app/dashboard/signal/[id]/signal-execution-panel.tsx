"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCryptoPrice } from "../../../../lib/format";

interface SignalExecutionPanelProps {
  symbol: string;
  side: "long" | "short";
  currentPrice: number;
  availableBalance: number;
  defaultLeverage?: number;
  defaultRiskPct?: number;
  stopLossPrice?: number;
  tp1Price?: number;
  onExecute: (data: { orderType: "Market" | "Limit"; margin: number; leverage: number }) => Promise<void>;
}

export function SignalExecutionPanel({
  symbol,
  side: initialSide,
  currentPrice,
  availableBalance,
  defaultLeverage = 5,
  defaultRiskPct = 1.0,
  stopLossPrice,
  tp1Price,
  onExecute
}: SignalExecutionPanelProps) {
  const [side, setSide] = useState<"long" | "short">(initialSide);
  const [orderType, setOrderType] = useState<"Market" | "Limit">("Market");
  const [leverage, setLeverage] = useState<number>(defaultLeverage);
  const [margin, setMargin] = useState<number>(100);
  const [customMarginInput, setCustomMarginInput] = useState<string>("100");
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const presets = [25, 50, 100, 250, 500, 1000];
  const percentPresets = [10, 25, 50, 100];

  const handleSelectPreset = (val: number) => {
    setMargin(val);
    setCustomMarginInput(val.toString());
  };

  const handleSelectPercent = (pct: number) => {
    const val = Math.max(10, Math.floor((availableBalance * (pct / 100))));
    setMargin(val);
    setCustomMarginInput(val.toString());
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomMarginInput(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      setMargin(parsed);
    }
  };

  // Calculations
  const notionalSize = margin * leverage;
  const approxQty = currentPrice > 0 ? (notionalSize / currentPrice) : 0;

  // Approx liquidation price
  const maintenanceMarginRate = 0.005;
  const liqDistance = leverage > 1 ? (currentPrice * (1 / leverage - maintenanceMarginRate)) : currentPrice * 0.9;
  const estLiqPrice = side === "long"
    ? Math.max(0, currentPrice - liqDistance)
    : (currentPrice + liqDistance);

  // Profit & Loss calculations
  const sl = stopLossPrice ?? (side === "long" ? currentPrice * 0.975 : currentPrice * 1.025);
  const tp = tp1Price ?? (side === "long" ? currentPrice * 1.045 : currentPrice * 0.955);

  const slDiffPct = currentPrice > 0 ? Math.abs((currentPrice - sl) / currentPrice) * 100 : 2.5;
  const tpDiffPct = currentPrice > 0 ? Math.abs((tp - currentPrice) / currentPrice) * 100 : 4.5;

  const estSlLossUsdt = (margin * (slDiffPct / 100) * leverage).toFixed(2);
  const estTpGainUsdt = (margin * (tpDiffPct / 100) * leverage).toFixed(2);

  const router = useRouter();

  const handleSubmit = () => {
    setStatusMsg(null);
    startTransition(async () => {
      try {
        await onExecute({ orderType, margin, leverage });
        setStatusMsg({ text: `Позицію успішно відкрито! ${side.toUpperCase()} ${symbol} на $${margin} (${leverage}x).` });
        router.refresh();
      } catch (err) {
        setStatusMsg({ text: err instanceof Error ? err.message : "Помилка відкриття ордера", error: true });
      }
    });
  };

  const isLong = side === "long";

  return (
    <div
      className="cd"
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        background: "#111111",
        border: "1px solid #262626"
      }}
    >
      {/* Terminal Title & Account Status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <b style={{ font: "700 15px Inter, sans-serif", color: "#FFFFFF" }}>Торговий термінал</b>
        <span className="tg gy" style={{ fontSize: "11px", color: "#42F5B9" }}>
          OKX Pro Engine
        </span>
      </div>

      {/* Direction Switcher (LONG / SHORT) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        <button
          type="button"
          onClick={() => setSide("long")}
          style={{
            height: "36px",
            font: "700 13px Inter, sans-serif",
            borderRadius: "6px",
            cursor: "pointer",
            border: isLong ? "1px solid #42F5B9" : "1px solid #262626",
            background: isLong ? "#42F5B9" : "#1A1A1A",
            color: isLong ? "#000000" : "#9A9A9A"
          }}
        >
          LONG
        </button>
        <button
          type="button"
          onClick={() => setSide("short")}
          style={{
            height: "36px",
            font: "700 13px Inter, sans-serif",
            borderRadius: "6px",
            cursor: "pointer",
            border: !isLong ? "1px solid #FF5A6E" : "1px solid #262626",
            background: !isLong ? "#FF5A6E" : "#1A1A1A",
            color: !isLong ? "#FFFFFF" : "#9A9A9A"
          }}
        >
          SHORT
        </button>
      </div>

      {/* Order Type Tabs & Available Balance */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            onClick={() => setOrderType("Market")}
            className={`tab ${orderType === "Market" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px" }}
          >
            Market
          </button>
          <button
            type="button"
            onClick={() => setOrderType("Limit")}
            className={`tab ${orderType === "Limit" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px" }}
          >
            Limit
          </button>
        </div>

        <span className="lb" style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
          Баланс: <b style={{ color: "#FFFFFF" }}>${availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
        </span>
      </div>

      {/* Leverage Selector & Risk pill */}
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: 1, background: "#1A1A1A", borderRadius: "8px", padding: "8px 12px", border: "1px solid #262626" }}>
          <div className="lb" style={{ fontSize: "11px" }}>Кредитне плече</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              style={{
                width: "100%",
                background: "transparent",
                border: 0,
                color: "#FFFFFF",
                fontWeight: 700,
                fontSize: "14px",
                padding: 0,
                cursor: "pointer",
                outline: "none"
              }}
            >
              {[1, 2, 3, 5, 10, 20, 50].map((l) => (
                <option key={l} value={l} style={{ background: "#1A1A1A", color: "#FFFFFF" }}>
                  {l}x Cross
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ flex: 1, background: "#1A1A1A", borderRadius: "8px", padding: "8px 12px", border: "1px solid #262626" }}>
          <div className="lb" style={{ fontSize: "11px" }}>Ризик на угоду</div>
          <div className="v" style={{ margin: "4px 0 0", fontSize: "14px" }}>
            {defaultRiskPct.toFixed(1)}% балансу
          </div>
        </div>
      </div>

      {/* Margin Input & Presets */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
          <span className="lb" style={{ fontSize: "12px" }}>Сума маржі (USDT)</span>
          <span className="lb" style={{ fontSize: "11px", color: "#9A9A9A" }}>
            Плече: {leverage}x
          </span>
        </div>

        {/* Currency Input Field */}
        <div style={{ position: "relative", marginBottom: "8px" }}>
          <input
            type="number"
            min="5"
            max="100000"
            step="5"
            value={customMarginInput}
            onChange={handleCustomChange}
            placeholder="Введіть суму"
            style={{
              width: "100%",
              height: "40px",
              padding: "0 55px 0 12px",
              fontSize: "15px",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              background: "#1A1A1A",
              border: "1px solid #262626",
              borderRadius: "6px",
              color: "#FFFFFF"
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "12px",
              top: "10px",
              color: "#9A9A9A",
              font: "600 13px Inter, sans-serif"
            }}
          >
            USDT
          </span>
        </div>

        {/* Quick Amount Presets */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handleSelectPreset(p)}
              className="tab"
              style={{
                flex: "1 1 auto",
                padding: "4px 8px",
                fontSize: "12px",
                background: margin === p ? "#262626" : "transparent",
                border: "1px solid #262626",
                color: margin === p ? "#42F5B9" : "#FFFFFF"
              }}
            >
              ${p}
            </button>
          ))}
        </div>

        {/* Quick Percent Presets */}
        <div style={{ display: "flex", gap: "6px" }}>
          {percentPresets.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handleSelectPercent(pct)}
              className="tab"
              style={{
                flex: 1,
                padding: "3px 4px",
                fontSize: "11px",
                background: "transparent",
                border: "1px solid #262626",
                color: "#9A9A9A"
              }}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Live Order Calculations Breakdown */}
      <div
        style={{
          background: "#1A1A1A",
          borderRadius: "8px",
          padding: "12px",
          border: "1px solid #262626",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Розмір позиції</span>
          <span className="v" style={{ fontSize: "13px" }}>
            ${notionalSize.toFixed(2)} USDT ({approxQty.toFixed(approxQty >= 10 ? 2 : 4)} {symbol.replace("USDT", "")})
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Ціна ліквідації</span>
          <span className="v" style={{ fontSize: "13px", color: "#F5C451" }}>
            ${formatCryptoPrice(estLiqPrice)}
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Прибуток на TP1 (+{tpDiffPct.toFixed(1)}%)</span>
          <span className="v" style={{ fontSize: "13px", color: "#42F5B9" }}>
            +${estTpGainUsdt} USDT
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Ризик на SL (-{slDiffPct.toFixed(1)}%)</span>
          <span className="v" style={{ fontSize: "13px", color: "#FF5A6E" }}>
            -${estSlLossUsdt} USDT
          </span>
        </div>
      </div>

      {/* Status Notice */}
      {statusMsg && (
        <div
          className="notice"
          style={{
            color: statusMsg.error ? "#FF5A6E" : "#42F5B9",
            borderColor: statusMsg.error ? "#FF5A6E33" : "#42F5B933",
            fontSize: "12px",
            padding: "8px 12px"
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Primary Execution Button (OKX Big Action) */}
      <button
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
        style={{
          height: "46px",
          width: "100%",
          borderRadius: "6px",
          font: "700 15px Inter, sans-serif",
          cursor: isPending ? "not-allowed" : "pointer",
          border: 0,
          background: isPending ? "#262626" : (isLong ? "#42F5B9" : "#FF5A6E"),
          color: isPending ? "#9A9A9A" : (isLong ? "#000000" : "#FFFFFF"),
          transition: "opacity 0.15s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px"
        }}
      >
        {isPending
          ? "⏳ Відкриваю ордер..."
          : `⚡ Відкрити ${isLong ? "LONG" : "SHORT"} ${symbol} ($${margin})`}
      </button>
    </div>
  );
}
